import iconCheck from '@tabler/icons/outline/check.svg?raw';
import iconX from '@tabler/icons/outline/x.svg?raw';
import { t } from './i18n.js';

const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function notifyAlert(message, title, hint = '') {
  const resolvedTitle = title ?? t('dlg.notice');
  /* hint (path/filename) is shown in a .confirm-hint above the message, same as the delete popup. */
  const hintHtml = hint ? `<div class="confirm-hint">${esc(hint)}</div>` : '';
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="alertdialog" aria-modal="true">
        <div class="confirm-title">${esc(resolvedTitle)}</div>
        <div class="confirm-message">${hintHtml}${esc(message)}</div>
        <div class="confirm-actions">
          <button class="confirm-btn primary" data-confirm="ok">${t('dlg.confirm')}</button>
        </div>
      </section>
    `;

    const close = () => {
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
      resolve();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape' || event.key === 'Enter') {
        event.preventDefault();
        close();
      }
    };

    backdrop.addEventListener('click', (event) => {
      if (event.target.closest('[data-confirm]')) close();
    });

    document.body.appendChild(backdrop);
    backdrop.querySelector('.primary')?.focus();
    window.addEventListener('keydown', onKeyDown);
  });
}

export function confirmTrashFile(count = 1, isRemote = false, name = '') {
  return new Promise((resolve) => {
    /* Local moves to trash (recoverable), remote deletes permanently (no trash) — branch the wording. */
    const message = isRemote
      ? (count > 1 ? t('dlg.deleteFile.multi', { n: count }) : t('dlg.deleteFile.single'))
      : (count > 1 ? t('dlg.trashFile.multi', { n: count }) : t('dlg.trashFile.single'));
    const nameHtml = (count === 1 && name) ? `<div class="confirm-hint">${esc(name)}</div>` : '';
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="${t('dlg.trashFile.title')}">
        <div class="confirm-title">${t('dlg.trashFile.title')}</div>
        <div class="confirm-message">${nameHtml}${message}</div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn danger" data-confirm="ok">${t('dlg.delete')}</button>
        </div>
      </section>
    `;
    return wireConfirm(backdrop, resolve);
  });
}

export function confirmTrashFolder(isRemote = false, name = '') {
  return new Promise((resolve) => {
    const nameHtml = name ? `<div class="confirm-hint">${esc(name)}</div>` : '';
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="${t('dlg.trashFolder.title')}">
        <div class="confirm-title">${t('dlg.trashFolder.title')}</div>
        <div class="confirm-message">${nameHtml}${isRemote ? t('dlg.deleteFolder.message') : t('dlg.trashFolder.message')}</div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn danger" data-confirm="ok">${t('dlg.delete')}</button>
        </div>
      </section>
    `;
    return wireConfirm(backdrop, resolve);
  });
}

function wireConfirm(backdrop, resolve) {
  const close = (confirmed) => {
    backdrop.remove();
    window.removeEventListener('keydown', onKeyDown);
    resolve(confirmed);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') close(false);
    if (event.key === 'Enter') close(true);
  };

  backdrop.addEventListener('click', (event) => {
    const button = event.target.closest('[data-confirm]');
    if (!button) return;
    close(button.dataset.confirm === 'ok');
  });

  document.body.appendChild(backdrop);
  backdrop.querySelector('.danger')?.focus();
  window.addEventListener('keydown', onKeyDown);
}

export function confirmReload(title, message, confirmLabel, cancelLabel, hint = '') {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    const hintHtml = hint ? `<div class="confirm-hint">${esc(hint)}</div>` : '';
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true">
        <div class="confirm-title">${title}</div>
        <div class="confirm-message">${hintHtml}${message}</div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${cancelLabel}</button>
          <button class="confirm-btn primary" data-confirm="ok">${confirmLabel}</button>
        </div>
      </section>
    `;
    return wireConfirm(backdrop, resolve);
  });
}

/**
 * SSH host key verification dialog (FileZilla style).
 * payload: { authority, algorithm, fingerprint, kind: 'new' | 'changed' }
 * returns: { decision: 'trust' | 'reject', remember: boolean }
 */
export function confirmHostKey({ authority, algorithm, fingerprint, kind }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const isChanged = kind === 'changed';
    const title = isChanged ? t('dlg.hostkey.changedTitle') : t('dlg.hostkey.newTitle');
    const warningBlock = isChanged
      ? `<div class="hostkey-warning">${t('dlg.hostkey.changedWarning')}</div>`
      : '';
    backdrop.innerHTML = `
      <section class="confirm-dialog hostkey-dialog" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="confirm-title ${isChanged ? 'danger' : ''}">${title}</div>
        <div class="confirm-message">
          ${warningBlock}
          <div class="hostkey-grid">
            <div class="hostkey-label">${t('dlg.hostkey.host')}</div>
            <div class="hostkey-value">${esc(authority)}</div>
            <div class="hostkey-label">${t('dlg.hostkey.algorithm')}</div>
            <div class="hostkey-value">${esc(algorithm || 'unknown')}</div>
            <div class="hostkey-label">${t('dlg.hostkey.fingerprint')}</div>
            <div class="hostkey-value mono">${esc(fingerprint)}</div>
          </div>
          <label class="hostkey-remember">
            <input type="checkbox" data-remember ${isChanged ? '' : 'checked'} />
            <span>${t('dlg.hostkey.remember')}</span>
          </label>
        </div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn ${isChanged ? 'danger' : 'accent'}" data-confirm="ok">${t('dlg.trust')}</button>
        </div>
      </section>
    `;
    const close = (decision) => {
      const remember = !!backdrop.querySelector('[data-remember]')?.checked;
      backdrop.remove();
      resolve({ decision, remember });
    };
    backdrop.querySelector('[data-confirm="ok"]').addEventListener('click', () => close('trust'));
    backdrop.querySelector('[data-confirm="cancel"]').addEventListener('click', () => close('reject'));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close('reject');
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-confirm="ok"]')?.focus();
  });
}

/* Overwrite confirmation when a same-named file exists. names: array of conflicting filenames. returns: boolean. */
export function confirmOverwrite(names) {
  return new Promise((resolve) => {
    const list = Array.isArray(names) ? names : [];
    const count = list.length;
    const single = count === 1;
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const title = single
      ? t('dlg.overwrite.single', { name: esc(list[0]) })
      : t('dlg.overwrite.multi', { n: count });
    const more = count > 20 ? `<br>${t('dlg.overwriteMore', { n: count - 20 })}` : '';
    const listBlock = single ? '' : `
      <div class="overwrite-list">${list.slice(0, 20).map(esc).join('<br>')}${more}</div>
    `;
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true">
        <div class="confirm-title">${t('dlg.overwrite.title')}</div>
        <div class="confirm-message">
          ${title}<br>${t('dlg.overwrite.confirm')}
          ${listBlock}
        </div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn danger" data-confirm="ok">${t('dlg.overwrite')}</button>
        </div>
      </section>
    `;
    return wireConfirm(backdrop, resolve);
  });
}

export function confirmRemoveProject() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="${t('dlg.removeProject.title')}">
        <div class="confirm-title">${t('dlg.removeProject.title')}</div>
        <div class="confirm-message">${t('dlg.removeProject.message')}</div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn danger" data-confirm="ok">${t('dlg.remove')}</button>
        </div>
      </section>
    `;
    return wireConfirm(backdrop, resolve);
  });
}

/* Delete a site (connection profile) — unlike a project's "remove from list only", the connection info itself is deleted. */
export function confirmRemoveSite() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="${t('dlg.removeSite.title')}">
        <div class="confirm-title">${t('dlg.removeSite.title')}</div>
        <div class="confirm-message">${t('dlg.removeSite.message')}</div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn danger" data-confirm="ok">${t('dlg.delete')}</button>
        </div>
      </section>
    `;
    return wireConfirm(backdrop, resolve);
  });
}

export function promptFileName(title, defaultValue = '', confirmLabel = null, placeholder = '', hint = '', pathInfo = '') {
  confirmLabel = confirmLabel ?? t('dlg.create');
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    /* hint: preview of the creation path (appends the input value). pathInfo: static display of the save path (not appended). */
    const hintHtml = (hint || pathInfo) ? `<div class="confirm-hint" title="${esc(hint || pathInfo)}"></div>` : '';
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="confirm-title">${esc(title)}</div>
        ${hintHtml}
        <input class="confirm-input" type="text" spellcheck="false" autocomplete="off" placeholder="${esc(placeholder)}" />
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn primary" data-confirm="ok">${esc(confirmLabel)}</button>
        </div>
      </section>
    `;

    const input = backdrop.querySelector('.confirm-input');
    input.value = defaultValue;

    const close = (value) => {
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
      resolve(value);
    };
    const submit = () => {
      const value = input.value.trim();
      close(value || null);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(null); }
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
    };

    backdrop.addEventListener('click', (event) => {
      const button = event.target.closest('[data-confirm]');
      if (!button) return;
      if (button.dataset.confirm === 'ok') submit();
      else close(null);
    });

    document.body.appendChild(backdrop);
    if (hint) {
      const hintEl = backdrop.querySelector('.confirm-hint');
      /* Path separator: '\' for Windows local, '/' for remote (sftp)/POSIX. Appends the input value live to preview the creation path. */
      const sep = hint.includes('\\') ? '\\' : '/';
      const renderHint = () => {
        if (!hintEl) return;
        const v = input.value.trim();
        applyPathMiddleEllipsis(hintEl, v ? `${hint}${sep}${v}` : hint);
      };
      renderHint();
      input.addEventListener('input', renderHint);
    } else if (pathInfo) {
      /* Static display of the save path — shown as-is, independent of the input (name). */
      const hintEl = backdrop.querySelector('.confirm-hint');
      if (hintEl) applyPathMiddleEllipsis(hintEl, pathInfo);
    }
    input.focus();
    const dot = defaultValue.lastIndexOf('.');
    if (dot > 0) input.setSelectionRange(0, dot);
    else input.select();
    window.addEventListener('keydown', onKeyDown);
  });
}

/* Go-to-line dialog — enter a line number → jump to that line (EditPlus "Go to Line" style).
   Clamped to the maxLine range; null if invalid or cancelled. */
export function promptGoToLine(maxLine, currentLine = 1) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="${esc(t('gotoLine.title'))}">
        <div class="confirm-title">${esc(t('gotoLine.title'))}</div>
        <div class="confirm-hint">${esc(t('gotoLine.label', { max: maxLine }))}</div>
        <input class="confirm-input" type="number" min="1" max="${maxLine}" step="1" inputmode="numeric" />
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn primary" data-confirm="ok">${t('dlg.confirm')}</button>
        </div>
      </section>
    `;
    const input = backdrop.querySelector('.confirm-input');
    input.value = String(currentLine);

    const close = (value) => {
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
      resolve(value);
    };
    const submit = () => {
      const n = parseInt(input.value, 10);
      if (!Number.isFinite(n) || n < 1) { close(null); return; }
      close(Math.min(n, maxLine));
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(null); }
      if (event.key === 'Enter') { event.preventDefault(); submit(); }
    };

    backdrop.addEventListener('click', (event) => {
      const button = event.target.closest('[data-confirm]');
      if (!button) return;
      if (button.dataset.confirm === 'ok') submit();
      else close(null);
    });

    document.body.appendChild(backdrop);
    input.focus();
    input.select();
    window.addEventListener('keydown', onKeyDown);
  });
}

function applyPathMiddleEllipsis(el, fullPath) {
  const display = stripRemoteAuthority(fullPath);
  el.textContent = display;
  if (el.scrollWidth <= el.clientWidth) return;
  const sep = display.includes('\\') ? '\\' : '/';
  const parts = display.split(/[\\/]/);
  if (parts.length <= 3) return;
  const first = parts[0] || sep;
  const tail = parts.slice(-2).join(sep);
  el.textContent = `${first}${sep}…${sep}${tail}`;
}

function stripRemoteAuthority(fullPath) {
  const m = String(fullPath).match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*(\/.*)?$/i);
  return m ? (m[1] || '/') : fullPath;
}

export function friendlyConnectError(rawMessage) {
  if (!rawMessage) return t('connect.unknown');
  const m = String(rawMessage);
  if (m.includes('ECONNREFUSED')) return t('connect.refused');
  if (m.includes('ENOTFOUND')) return t('connect.notFound');
  if (m.includes('EHOSTUNREACH') || m.includes('ENETUNREACH')) return t('connect.unreachable');
  if (m.includes('ETIMEDOUT') || /timed?\s*out|timeout/i.test(m)) return t('connect.timeout');
  if (m.includes('All configured authentication methods failed')) return t('connect.authMethodsFailed');
  if (/Cannot parse privateKey|Encrypted (?:OpenSSH )?private key/i.test(m)) return t('connect.keyParseFailed');
  if (/Permission denied/i.test(m)) return t('connect.permissionDenied');
  if (/Handshake failed|Protocol error/i.test(m)) return t('connect.handshakeFailed');
  if (/authentication/i.test(m)) return t('connect.authFailed');
  const firstLine = m.split('\n')[0].trim();
  return firstLine.length > 140 ? firstLine.slice(0, 140) + '…' : firstLine;
}


/* Section selection for settings export/import. sections: [{id,label,checked,disabled}]. returns: array of selected ids or null (cancel). */
export function selectSectionsDialog({ title, message, confirmLabel, sections }) {
  return new Promise((resolve) => {
    const items = Array.isArray(sections) ? sections : [];
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    const rows = items.map((s) => `
      <label class="section-pick-row${s.disabled ? ' disabled' : ''}">
        <input type="checkbox" data-section="${esc(s.id)}" ${s.checked && !s.disabled ? 'checked' : ''} ${s.disabled ? 'disabled' : ''} />
        <span>${esc(s.label)}</span>
      </label>
    `).join('');
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="confirm-title">${esc(title)}</div>
        ${message ? `<div class="confirm-message">${esc(message)}</div>` : ''}
        <div class="section-pick-list">${rows}</div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn primary" data-confirm="ok">${esc(confirmLabel)}</button>
        </div>
      </section>
    `;
    const okBtn = backdrop.querySelector('[data-confirm="ok"]');
    const picked = () => Array.from(backdrop.querySelectorAll('input[data-section]:checked')).map((c) => c.dataset.section);
    const syncOk = () => { okBtn.disabled = picked().length === 0; };
    const close = (value) => {
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close(null); }
      if (event.key === 'Enter') { event.preventDefault(); if (!okBtn.disabled) close(picked()); }
    };
    backdrop.addEventListener('change', (e) => { if (e.target.matches('input[data-section]')) syncOk(); });
    backdrop.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-confirm]');
      if (!btn) return;
      if (btn.dataset.confirm === 'ok') { if (!okBtn.disabled) close(picked()); }
      else close(null);
    });
    document.body.appendChild(backdrop);
    syncOk();
    okBtn.focus();
    window.addEventListener('keydown', onKeyDown);
  });
}

export function confirmDirtyClose() {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';
    backdrop.innerHTML = `
      <section class="confirm-dialog" role="dialog" aria-modal="true" aria-label="${t('dlg.dirty.title')}">
        <div class="confirm-title">${t('dlg.dirty.title')}</div>
        <div class="confirm-message">${t('dlg.dirty.message')}</div>
        <div class="confirm-actions">
          <button class="confirm-btn" data-confirm="cancel">${t('dlg.cancel')}</button>
          <button class="confirm-btn" data-confirm="discard">${t('dlg.dirty.discard')}</button>
          <button class="confirm-btn primary" data-confirm="save">${t('dlg.dirty.save')}</button>
        </div>
      </section>
    `;

    const close = (value) => {
      backdrop.remove();
      window.removeEventListener('keydown', onKeyDown);
      resolve(value);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); close('cancel'); }
      if (event.key === 'Enter') { event.preventDefault(); close('save'); }
    };

    backdrop.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-confirm]');
      if (!btn) return;
      close(btn.dataset.confirm);
    });

    document.body.appendChild(backdrop);
    backdrop.querySelector('.primary')?.focus();
    window.addEventListener('keydown', onKeyDown);
  });
}
