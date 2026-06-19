import iconDelete from '@tabler/icons/outline/trash.svg?raw';
import iconGrip from '@tabler/icons/outline/grip-vertical.svg?raw';
import iconPencil from '@tabler/icons/outline/pencil.svg?raw';
import { promptFileName, confirmRemoveProject, confirmRemoveSite } from './dialogs.js';
import { editRemoteProfileDialog } from './remote-profile-dialog.js';
import { t } from './i18n.js';

const esc = (v) => String(v || '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function isLocalProject(p) {
  return !!p && (!p.type || p.type === 'local') && !!p.path;
}

export function isRemoteProject(p) {
  return !!p && (p.type === 'sftp' || p.type === 'ftp') && !!p.host;
}

const hasSecretInput = (s) => !!(s && (s.password || s.passphrase || s.jumpPassword || s.jumpPassphrase));

const getRowIndex = (row) => {
  const v = Number(row?.dataset?.index);
  return Number.isInteger(v) ? v : -1;
};

/**
 * Project panel UI/CRUD.
 *
 * deps:
 *  - el: projectListEl
 *  - getSettings(): live settings reference
 *  - saveAndRefresh(activeKeyOverride?): persist settings to disk + refresh root selector options + renderList
 *  - remoteApi: window.oyen.remote
 *  - isRootActiveKey(key): whether the current active root is this key
 *  - pickFallbackRootKey(): root key to fall back to if the active one disappears on remove (excludes project:)
 *  - applyRoot(key, mode): switch root
 */
export function createProjectPanel({
  el,
  getSettings,
  saveAndRefresh,
  remoteApi,
  isRootActiveKey,
  pickFallbackRootKey,
  applyRoot
}) {
  let keyInfoCache = null;
  async function getKeyInfo() {
    if (keyInfoCache) return keyInfoCache;
    try { keyInfoCache = await remoteApi?.getDefaultKeyInfo?.(); } catch (_) {}
    return keyInfoCache || { dir: '~/.ssh', filenames: ['id_ed25519', 'id_rsa', 'id_ecdsa'] };
  }

  function renderList() {
    if (!el) return;
    /* Panel = local projects + folder projects (derivedRemote). Pure connection profiles are excluded
       (managed in the FTP menu/site manager). Avoids the confusion of a connection profile being deleted from the panel and losing credentials.
       data-index keeps the original settings.projects index — so delete/edit/reorder target the correct item. */
    const all = getSettings().projects || [];
    const rows = all.map((p, i) => {
      if (!(p?.name && (isLocalProject(p) || (isRemoteProject(p) && p.derivedRemote)))) return '';
      const remote = isRemoteProject(p);
      const kind = remote ? 'remote' : 'local';
      const key = `project:${p.id}`;
      const subtitle = remote ? `${p.type}://${p.username ? p.username + '@' : ''}${p.host}${p.port ? ':' + p.port : ''}` : p.path;
      const titleAttr = remote ? subtitle : p.path;
      return `
        <div class="project-row" data-key="${esc(key)}" data-index="${i}" data-kind="${kind}" title="${esc(titleAttr)}">
          <span class="project-drag" title="${t('project.dragReorder')}">${iconGrip}</span>
          <div class="project-row-body">
            <span class="project-row-name"><span class="project-row-text">${esc(p.name)}</span></span>
            <span class="project-row-path">${esc(subtitle)}</span>
          </div>
          <button class="project-action project-edit" title="${t('project.rename')}">${iconPencil}</button>
          <button class="project-action project-delete" title="${t('project.remove')}">${iconDelete}</button>
        </div>
      `;
    }).filter(Boolean);
    if (!rows.length) {
      el.innerHTML = `<div class="project-list-empty">${t('sidebar.projectsEmpty')}</div>`;
      return;
    }
    el.innerHTML = rows.join('');
  }

  async function addRemote() {
    const keyInfo = await getKeyInfo();
    /* Only connection profiles own a quick-open key — derived folder projects carry an inherited copy, so exclude them from the uniqueness source. */
    const takenApiKeys = ((getSettings().projects) || []).filter((p) => !p.derivedRemote).map((p) => (p.apiKey || '').trim()).filter(Boolean);
    const result = await editRemoteProfileDialog(null, { keyInfo, takenApiKeys });
    if (!result) return;
    const { profile, secret } = result;
    const settings = getSettings();
    const list = settings.projects || [];
    list.push(profile);
    settings.projects = list;
    if (hasSecretInput(secret)) {
      try { await remoteApi.setSecret(profile.id, secret); } catch (_) {}
    }
    await saveAndRefresh();
  }

  async function editRemoteAt(idx) {
    const settings = getSettings();
    const list = settings.projects || [];
    const cur = list[idx];
    if (!cur || !isRemoteProject(cur)) return;
    const keyInfo = await getKeyInfo();
    /* Exclude self (id) and all derived folder projects (their keys are inherited copies, not independent registrations). */
    const takenApiKeys = list.filter((p) => p.id !== cur.id && !p.derivedRemote).map((p) => (p.apiKey || '').trim()).filter(Boolean);
    const result = await editRemoteProfileDialog(cur, { keyInfo, takenApiKeys });
    if (!result) return;
    const { profile, secret } = result;
    const wasActive = isRootActiveKey(`project:${cur.id}`);
    list[idx] = { ...cur, ...profile, id: cur.id || profile.id };
    settings.projects = list;
    if (hasSecretInput(secret)) {
      try { await remoteApi.setSecret(list[idx].id, secret); } catch (_) {}
    }
    await saveAndRefresh(wasActive ? `project:${cur.id}` : undefined);
  }

  async function renameAt(idx) {
    const settings = getSettings();
    const list = settings.projects || [];
    const cur = list[idx];
    if (!cur) return;
    const nextName = await promptFileName(t('prompt.renameProject'), cur.name, t('dlg.rename'), t('prompt.projectName'), '', cur.path || cur.defaultPath || '');
    if (!nextName || nextName === cur.name) return;
    const wasActive = isRootActiveKey(`project:${cur.id}`);
    list[idx] = { ...cur, name: nextName };
    settings.projects = list;
    await saveAndRefresh(wasActive ? `project:${cur.id}` : undefined);
  }

  async function removeAt(idx, { isSite = false } = {}) {
    const settings = getSettings();
    const list = settings.projects || [];
    const cur = list[idx];
    if (!cur) return;
    /* Deleting from the site list removes the connection info itself → a different confirmation message. Projects are "removed from list only". */
    if (!(await (isSite ? confirmRemoveSite() : confirmRemoveProject()))) return;
    const wasActive = isRootActiveKey(`project:${cur.id}`);
    if (isRemoteProject(cur) && cur.id) {
      try { await remoteApi.removeSecret(cur.id); } catch (_) {}
    }
    list.splice(idx, 1);
    settings.projects = list;
    const fallbackKey = wasActive ? pickFallbackRootKey() : undefined;
    await saveAndRefresh(fallbackKey);
    if (wasActive && fallbackKey) await applyRoot(fallbackKey, 'top');
  }

  el?.addEventListener('click', async (event) => {
    const row = event.target.closest('.project-row');
    if (!row) return;
    const idx = getRowIndex(row);
    if (idx < 0) return;
    const cur = (getSettings().projects || [])[idx];
    if (event.target.closest('.project-edit')) {
      /* The pencil in the project panel = rename only. SFTP connection editing is done in the site list (editRemoteAt is used there). */
      await renameAt(idx);
      return;
    }
    if (event.target.closest('.project-delete')) {
      await removeAt(idx);
    }
  });

  /* HTML5 drag-and-drop reorder. Enable draggable only on the grip and reorder on drop. */
  let dragSrcIndex = -1;
  el?.addEventListener('mousedown', (event) => {
    const grip = event.target.closest('.project-drag');
    if (!grip) return;
    grip.closest('.project-row')?.setAttribute('draggable', 'true');
  });
  el?.addEventListener('mouseup', (event) => {
    const grip = event.target.closest('.project-drag');
    if (!grip) return;
    grip.closest('.project-row')?.setAttribute('draggable', 'false');
  });
  el?.addEventListener('dragstart', (event) => {
    const row = event.target.closest('.project-row');
    if (!row) return;
    dragSrcIndex = getRowIndex(row);
    event.dataTransfer.effectAllowed = 'move';
    try { event.dataTransfer.setData('text/plain', String(dragSrcIndex)); } catch (_) {}
    row.classList.add('dragging');
  });
  el?.addEventListener('dragover', (event) => {
    if (dragSrcIndex < 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const row = event.target.closest('.project-row');
    el.querySelectorAll('.project-row.drag-over-top, .project-row.drag-over-bottom')
      .forEach((r) => r.classList.remove('drag-over-top', 'drag-over-bottom'));
    if (!row || row.classList.contains('dragging')) return;
    const rect = row.getBoundingClientRect();
    const below = event.clientY > rect.top + rect.height / 2;
    row.classList.add(below ? 'drag-over-bottom' : 'drag-over-top');
  });
  el?.addEventListener('dragleave', (event) => {
    event.target.closest('.project-row')?.classList.remove('drag-over-top', 'drag-over-bottom');
  });
  el?.addEventListener('drop', async (event) => {
    event.preventDefault();
    const targetRow = event.target.closest('.project-row');
    el.querySelectorAll('.project-row.drag-over-top, .project-row.drag-over-bottom, .project-row.dragging')
      .forEach((r) => r.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging'));
    if (dragSrcIndex < 0 || !targetRow) { dragSrcIndex = -1; return; }
    let targetIdx = getRowIndex(targetRow);
    if (targetIdx === dragSrcIndex || targetIdx < 0) { dragSrcIndex = -1; return; }
    const rect = targetRow.getBoundingClientRect();
    const below = event.clientY > rect.top + rect.height / 2;
    let insertAt = below ? targetIdx + 1 : targetIdx;
    const settings = getSettings();
    const list = settings.projects.slice();
    const [moved] = list.splice(dragSrcIndex, 1);
    if (dragSrcIndex < insertAt) insertAt -= 1;
    list.splice(insertAt, 0, moved);
    settings.projects = list;
    dragSrcIndex = -1;
    await saveAndRefresh();
  });
  el?.addEventListener('dragend', () => {
    dragSrcIndex = -1;
    el.querySelectorAll('.project-row.drag-over-top, .project-row.drag-over-bottom, .project-row.dragging')
      .forEach((r) => r.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging'));
    el.querySelectorAll('.project-row[draggable="true"]')
      .forEach((r) => r.setAttribute('draggable', 'false'));
  });

  return { renderList, addRemote, editRemoteAt, removeAt };
}
