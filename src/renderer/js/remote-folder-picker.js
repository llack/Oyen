import iconServer from '@tabler/icons/outline/server-2.svg?raw';
import iconDesktop from '@tabler/icons/outline/device-desktop.svg?raw';
import iconFolder from '@tabler/icons/outline/folder.svg?raw';
import iconArrowUp from '@tabler/icons/outline/arrow-up.svg?raw';
import { t } from './i18n.js';
import { notifyAlert } from './dialogs.js';

const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function profileUriLabel(p) {
  const userPart = p.username ? `${p.username}@` : '';
  if (p.type === 'ftp') {
    const scheme = p.secure ? 'ftps' : 'ftp';
    return `${scheme}://${userPart}${p.host}:${p.port || 21}`;
  }
  return `sftp://${userPart}${p.host}:${p.port || 22}`;
}

function uriPathname(uri) {
  try { return new URL(uri).pathname || '/'; } catch { return '/'; }
}

/* Ctrl+O entry chooser — "This Computer" (local native) + list of registered remote profiles.
   Returns: {type:'local'} | {type:'remote', profile} | null (cancelled). */
export function openFolderSourceChooser({ remoteProjects = [] } = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
      resolve(val);
    };
    const onKeyDown = (e) => { if (e.key === 'Escape') { e.preventDefault(); done(null); } };

    const remoteRows = remoteProjects.map((p, i) => `
      <button type="button" class="rfp-source-row" data-remote-index="${i}">
        ${iconServer}
        <span class="rfp-source-body">
          <span class="rfp-source-name">${esc(p.name)}</span>
          <span class="rfp-source-uri">${esc(profileUriLabel(p))}</span>
        </span>
      </button>
    `).join('');

    backdrop.innerHTML = `
      <section class="confirm-dialog large" role="dialog" aria-modal="true" aria-label="${esc(t('openFolder.chooser.title'))}">
        <div class="confirm-title">${esc(t('openFolder.chooser.title'))}</div>
        <div class="rfp-source-list">
          <button type="button" class="rfp-source-row" data-source="local">
            ${iconDesktop}
            <span class="rfp-source-body">
              <span class="rfp-source-name">${esc(t('openFolder.chooser.thisComputer'))}</span>
              <span class="rfp-source-uri">${esc(t('openFolder.chooser.thisComputerSub'))}</span>
            </span>
          </button>
          ${remoteRows}
        </div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-act="cancel">${esc(t('dlg.cancel'))}</button>
        </div>
      </section>
    `;

    backdrop.querySelector('[data-source="local"]')?.addEventListener('click', () => done({ type: 'local' }));
    backdrop.querySelectorAll('[data-remote-index]').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = Number(row.dataset.remoteIndex);
        const profile = remoteProjects[idx];
        if (profile) done({ type: 'remote', profile });
      });
    });
    backdrop.querySelector('[data-act="cancel"]')?.addEventListener('click', () => done(null));
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) done(null); });

    document.body.appendChild(backdrop);
    window.addEventListener('keydown', onKeyDown);
  });
}

/* Remote folder browser — navigates directories only, designating the root via "Select This Folder".
   Returns: the selected folder URI string | null (cancelled).
   listDir(uri) → safeList result (entries with {name,path,type}). connect(authority) → {ok, path?}. */
export function openRemoteFolderPicker({ profile, authority, startPath, listDir, connect, preferHome = false }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    let settled = false;
    let current = '';
    let alertOpen = false;  /* Ignore picker key input while an alert popup is shown on top (prevents Escape from closing both). */
    const done = (val) => {
      if (settled) return;
      settled = true;
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
      resolve(val);
    };
    const onKeyDown = (e) => { if (alertOpen) return; if (e.key === 'Escape') { e.preventDefault(); done(null); } };

    backdrop.innerHTML = `
      <section class="confirm-dialog rfp-dialog" role="dialog" aria-modal="true" aria-label="${esc(t('openFolder.remote.title'))}">
        <div class="confirm-title">${esc(t('openFolder.remote.title'))} — ${esc(profile?.name || '')}</div>
        <div class="rfp-pathbar">
          <button type="button" class="rfp-up" data-act="up" title="${esc(t('openFolder.remote.up'))}">${iconArrowUp}</button>
          <span class="rfp-path" id="rfpPath">/</span>
        </div>
        <div class="rfp-list" id="rfpList"></div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-act="cancel">${esc(t('dlg.cancel'))}</button>
          <button class="confirm-btn primary" data-act="select">${esc(t('openFolder.remote.select'))}</button>
        </div>
      </section>
    `;

    const pathEl = backdrop.querySelector('#rfpPath');
    const listEl = backdrop.querySelector('#rfpList');
    const upBtn = backdrop.querySelector('[data-act="up"]');
    const selectBtn = backdrop.querySelector('[data-act="select"]');

    function setBusy(busy) {
      if (selectBtn) selectBtn.disabled = busy;
      if (upBtn) upBtn.disabled = busy || uriPathname(current) === '/';
    }

    function renderMessage(msg, kind = 'empty') {
      listEl.innerHTML = `<div class="rfp-${kind === 'error' ? 'error' : 'empty'}">${esc(msg)}</div>`;
    }

    /* Only swap current/list once navigation succeeds. On failure (permission denied, etc.), keep the current folder list and just show the error
       → can still go back (↑) and won't get stuck in a blocked folder (Mac EditPlus-style UX). */
    async function navigate(uri) {
      const hasList = !!listEl.querySelector('.rfp-row');
      setBusy(true);
      if (!hasList) renderMessage(t('openFolder.remote.loading'));
      let res;
      try {
        res = await listDir(uri);
      } catch (err) {
        res = { ok: false, error: err?.message };
      }
      setBusy(false);
      if (!res || res.ok === false) {
        if (!hasList) renderMessage(t('openFolder.remote.loadError'), 'error');
        /* Alert the server-provided error message once in a popup as-is, keeping the current folder list (navigation cancelled). */
        alertOpen = true;
        await notifyAlert(res?.error || t('openFolder.remote.loadError'), t('openFolder.remote.title'));
        alertOpen = false;
        return;
      }
      current = uri;
      pathEl.textContent = uriPathname(uri);
      if (upBtn) upBtn.disabled = uriPathname(current) === '/';
      const dirs = (res.entries || []).filter((e) => e.type === 'directory' && !e.isLink);
      if (!dirs.length) {
        renderMessage(t('openFolder.remote.noSubfolders'));
        return;
      }
      listEl.innerHTML = dirs.map((d) => `
        <button type="button" class="rfp-row" data-uri="${esc(d.path)}">
          ${iconFolder}
          <span class="rfp-row-name">${esc(d.name)}</span>
        </button>
      `).join('');
      listEl.querySelectorAll('.rfp-row').forEach((row) => {
        row.addEventListener('click', () => navigate(row.dataset.uri));
      });
    }

    function goUp() {
      const p = uriPathname(current).replace(/\/+$/, '');
      if (!p || p === '') return;
      const idx = p.lastIndexOf('/');
      const parent = idx <= 0 ? '/' : p.slice(0, idx);
      navigate(authority + parent);
    }

    upBtn?.addEventListener('click', goUp);
    selectBtn?.addEventListener('click', () => { if (current) done(current); });
    backdrop.querySelector('[data-act="cancel"]')?.addEventListener('click', () => done(null));

    document.body.appendChild(backdrop);
    window.addEventListener('keydown', onKeyDown);

    const isFtp = /^ftps?:\/\//i.test(authority || '');

    /* Connect + determine the start path.
       - FTP (+preferHome): pwd is unreliable across servers → open '/' first to guarantee the connection/listing, then move to the home path
         (a pwd failure/delay won't block "open"). If home can't be found, stay at '/'.
       - SFTP / explicit path: realpath is reliable, so go straight to home (or the given path). */
    (async () => {
      setBusy(true);
      if (isFtp && preferHome) {
        /* Open '/' first (EditPlus-style). But root access may be denied, so fall back to home (pwd) if '/' fails.
           If '/' opens, then move to the home path. pwd runs after the '/' attempt, so it won't block "open". */
        await navigate(`${authority}/`);
        let home = '/';
        try {
          const r = await connect(authority);
          if (r?.ok && r.path) home = r.path.startsWith('/') ? r.path : `/${r.path}`;
        } catch {}
        if (!current) {
          if (home !== '/') await navigate(`${authority}${home}`);  // root not accessible → fall back to home
        } else if (home !== uriPathname(current)) {
          await navigate(`${authority}${home}`);                    // root opened → move to home
        }
        if (!current) setBusy(false);  // both '/' and home failed → navigate shows the error
        return;
      }
      renderMessage(t('openFolder.remote.connecting'));
      let homePath = '/';
      let connectFailed = false;
      try {
        const r = await connect(authority);
        if (r && r.ok && r.path) homePath = r.path.startsWith('/') ? r.path : `/${r.path}`;
        else if (r && r.ok === false) connectFailed = true;
      } catch {
        connectFailed = true;
      }
      if (connectFailed) {
        renderMessage(t('openFolder.remote.connectError'), 'error');
        setBusy(false);
        return;
      }
      let startAt = homePath;
      if (!preferHome) {
        const sp = (startPath || profile?.defaultPath || '').trim();
        if (sp) startAt = sp.startsWith('/') ? sp : `/${sp}`;
      }
      await navigate(authority + startAt);
    })();
  });
}
