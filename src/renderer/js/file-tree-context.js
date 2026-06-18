import { notifyAlert, confirmTrashFile, confirmTrashFolder, promptFileName } from './dialogs.js';
import { runBusy } from './busy-lock.js';
import { friendlyFsError } from './friendly-error.js';
import { t } from './i18n.js';

export function createFileTreeContextMenu({
  treeRoot,
  getCurrentRootPath,
  getActivePath,
  normalizePath,
  joinPath,
  dirname,
  refreshTree,
  showFiles,
  focusFilePath,
  activateDirectory,
  selectFileRow,
  onFileOpen,
  onFileClose,
  onFileRename,
  onFolderRename,
  onProjectAdd,
  openTerminalAt,
  onMultiDelete,
  onDownload,
  onMultiDownload,
  onDownloadFolder,
  createFile,
  saveAs,
  onRevealActiveFile,
  getActiveEditorPath
}) {
  let contextMenu = null;

  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
    document.querySelectorAll('.file-row.context-target, .tree-row.context-target')
      .forEach((node) => node.classList.remove('context-target'));
  }

  function placeContextMenu(event) {
    document.body.appendChild(contextMenu);
    const rect = contextMenu.getBoundingClientRect();
    const x = Math.min(event.clientX, window.innerWidth - rect.width - 6);
    const y = Math.min(event.clientY, window.innerHeight - rect.height - 6);
    contextMenu.style.left = `${Math.max(6, x)}px`;
    contextMenu.style.top = `${Math.max(6, y)}px`;
  }

  function showFileContextMenu(event, row = null, selectedPaths = []) {
    closeContextMenu();
    if (row) row.classList.add('context-target');

    const filePath = row?.dataset.path || '';
    const fileName = row?.dataset.name || '';
    const isRemote = /^[a-z]+:\/\//i.test(filePath || selectedPaths[0] || getCurrentRootPath() || '');
    /* chmod is SFTP-only (Unix permissions) — FTP has no chmod concept/implementation. */
    const isSftp = /^sftp:\/\//i.test(filePath || selectedPaths[0] || getCurrentRootPath() || '');
    const rowSelected = !!row && selectedPaths.includes(row.dataset.path);
    const isMulti = selectedPaths.length >= 2 && (!row || rowSelected);

    /* Reveal in tree — targets the active editor file, not the right-clicked one (same single entry point as toolbar/tab context).
       Only shown when a file is open. */
    const hasActiveEditor = typeof getActiveEditorPath === 'function' && !!getActiveEditorPath();
    const revealItem = hasActiveEditor
      ? `<button class="context-menu-item" data-action="reveal-active">${t('ctx.reveal')}</button>`
      : '';
    const commonItems = `
      <button class="context-menu-item" data-action="new-file">${t('ctx.newFile')}</button>
      <button class="context-menu-item" data-action="refresh">${t('ctx.refresh')}</button>
    `;
    let menuItems;
    if (isMulti) {
      const downloadItem = isRemote
        ? `<button class="context-menu-item" data-action="download-selected">${t('ctx.downloadCount', { n: selectedPaths.length })}</button>`
        : '';
      menuItems = `
        ${downloadItem}
        <button class="context-menu-item danger" data-action="delete-selected">${t('ctx.deleteCount', { n: selectedPaths.length })}</button>
        <div class="context-menu-separator"></div>
        ${commonItems}
      `;
    } else if (row) {
      menuItems = `
        <button class="context-menu-item" data-action="open">${t('ctx.open')}</button>
        ${isRemote
          ? `<button class="context-menu-item" data-action="download">${t('ctx.download')}</button>`
          : `<button class="context-menu-item" data-action="save-as">${t('ctx.saveAs')}</button>
        <button class="context-menu-item" data-action="open-pc">${t('ctx.openInPc')}</button>`}
        <div class="context-menu-separator"></div>
        ${commonItems}
        <div class="context-menu-separator"></div>
        <button class="context-menu-item" data-action="copy-path">${t('ctx.copyPath')}</button>
        <button class="context-menu-item" data-action="copy-name">${t('ctx.copyName')}</button>
        ${revealItem}
        <button class="context-menu-item" data-action="rename">${t('ctx.rename')}</button>
        ${isSftp ? `<button class="context-menu-item" data-action="chmod">${t('ctx.chmod')}</button>` : ''}
        <button class="context-menu-item danger" data-action="delete">${t('ctx.delete')}</button>
        ${(isRemote || window.oyen?.platform !== 'win32') ? '' : `<div class="context-menu-separator"></div>
        <button class="context-menu-item" data-action="properties">${t('ctx.properties')}</button>`}
      `;
    } else {
      menuItems = `${revealItem ? `${revealItem}<div class="context-menu-separator"></div>` : ''}${commonItems}`;
    }
    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.innerHTML = menuItems;

    contextMenu.addEventListener('click', async (clickEvent) => {
      const item = clickEvent.target.closest('.context-menu-item');
      if (!item) return;
      const action = item.dataset.action;
      closeContextMenu();
      if (action === 'reveal-active') {
        if (typeof onRevealActiveFile === 'function') onRevealActiveFile();
        return;
      }
      if (action === 'delete-selected') {
        if (typeof onMultiDelete === 'function') await onMultiDelete();
        return;
      }
      if (action === 'download-selected') {
        if (typeof onMultiDownload === 'function') await onMultiDownload();
        return;
      }
      if (action === 'download') {
        if (typeof onDownload === 'function') await onDownload(filePath);
        return;
      }
      await runFileContextAction(action, filePath, fileName);
    });

    placeContextMenu(event);
  }

  function showTreeContextMenu(event, row) {
    closeContextMenu();
    if (row) row.classList.add('context-target');

    const isFolderRow = !!row && row.dataset.type === 'directory';
    const folderPath = isFolderRow ? row.dataset.path : getActivePath();
    const isRemote = /^[a-z]+:\/\//i.test(folderPath || '');
    /* chmod is SFTP-only (Unix permissions) — same as the file menu. FTP has no chmod concept/implementation. */
    const isSftp = /^sftp:\/\//i.test(folderPath || '');

    contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.innerHTML = isFolderRow ? `
      <button class="context-menu-item" data-action="new-folder">${t('ctx.newFolder')}</button>
      ${isRemote ? `<button class="context-menu-item" data-action="download-folder">${t('ctx.download')}</button>` : `<button class="context-menu-item" data-action="open-terminal">${t('ctx.openTerminal')}</button>`}
      <div class="context-menu-separator"></div>
      <button class="context-menu-item" data-action="add-project">${t('ctx.addProject')}</button>
      <button class="context-menu-item" data-action="rename-folder">${t('ctx.renameFolder')}</button>
      ${isSftp ? `<button class="context-menu-item" data-action="chmod">${t('ctx.chmod')}</button>` : ''}
      <div class="context-menu-separator"></div>
      <button class="context-menu-item danger" data-action="delete-folder">${t('ctx.deleteFolder')}</button>
    ` : `
      <button class="context-menu-item" data-action="new-folder">${t('ctx.newFolder')}</button>
      <button class="context-menu-item" data-action="refresh">${t('ctx.refresh')}</button>
    `;

    contextMenu.addEventListener('click', async (clickEvent) => {
      const item = clickEvent.target.closest('.context-menu-item');
      if (!item) return;
      const action = item.dataset.action;
      closeContextMenu();
      if (action === 'download-folder') {
        if (typeof onDownloadFolder === 'function') await onDownloadFolder(folderPath);
        return;
      }
      await runFolderContextAction(action, folderPath);
    });

    placeContextMenu(event);
  }

  /* Shared chmod — changes SFTP permissions for both files and folders. Prefills the current permissions → promptFileName focuses and selects all.
     chmod is meaningless on Windows SFTP servers (NTFS) → notify and abort. */
  async function applyChmod(targetPath, displayName, errLabel) {
    let cur = '';
    try {
      const r = await window.oyen.localFs.statMode(targetPath);
      if (r?.ok && r.windows) { await notifyAlert(t('chmod.unsupported')); return; }
      if (r?.ok && typeof r.mode === 'number') cur = r.mode.toString(8).padStart(3, '0');
    } catch (_) {}
    const input = await promptFileName(t('ctx.chmod'), cur, t('dlg.save'), '755', '', displayName);
    if (input == null) return;
    if (!/^[0-7]{3,4}$/.test(input)) { await notifyAlert(t('chmod.invalid')); return; }
    await runBusy(async () => {
      const res = await window.oyen.localFs.chmod(targetPath, parseInt(input, 8));
      if (!res?.ok) await notifyAlert(friendlyFsError(res?.error, errLabel || t('fserr.file')));
    });
  }

  async function runFileContextAction(action, filePath, fileName) {
    const activePath = getActivePath();
    const rootPath = getCurrentRootPath();

    if (action === 'open') {
      if (filePath && typeof onFileOpen === 'function') onFileOpen(filePath, fileName);
      return;
    }

    if (action === 'chmod') {
      await applyChmod(filePath, fileName);
      return;
    }

    if (action === 'copy-path') {
      await navigator.clipboard?.writeText(filePath);
      return;
    }

    if (action === 'copy-name') {
      await navigator.clipboard?.writeText(fileName);
      return;
    }

    if (action === 'refresh') {
      await runBusy(() => refreshTree(rootPath, 'preserve'));
      return;
    }

    if (action === 'properties') {
      // The OS-native dialog call is fire-and-forget. Showing busy while the dialog is up
      // makes the user perceive the pause as "loading" rather than "lag". Since it's detached, we can't get a real ready signal.
      // Durations are measured per-platform averages: Win (PowerShell+COM) ~1.2s, Mac (osascript) ~400ms.
      const waitMs = window.oyen?.platform === 'darwin' ? 400 : 1200;
      await runBusy(async () => {
        window.oyen.localFs.showFileProperties(filePath);
        await new Promise((r) => setTimeout(r, waitMs));
      });
      return;
    }

    if (action === 'open-terminal') {
      const target = filePath ? dirname(filePath) : rootPath;
      if (typeof openTerminalAt === 'function' && target) await openTerminalAt(target);
      return;
    }

    if (action === 'new-file') {
      await createFile?.(activePath);
      return;
    }

    if (action === 'save-as') {
      await saveAs?.(filePath, fileName);
      return;
    }

    if (action === 'rename') {
      const nextName = await promptFileName(t('ctx.rename'), fileName, t('dlg.rename'), '', dirname(filePath));
      if (!nextName || nextName === fileName) return;
      await runBusy(async () => {
        try {
          const result = await window.oyen.localFs.renameFile(filePath, nextName);
          if (!result?.ok) {
            await notifyAlert(friendlyFsError(result?.message, t('fserr.file')));
            return;
          }
          const newPath = result.path || joinPath(dirname(filePath), nextName);
          const newName = result.name || nextName;
          if (typeof onFileRename === 'function') onFileRename(filePath, newPath, newName);
          await showFiles(dirname(newPath) || activePath, { fresh: true });
        } catch (err) {
          await notifyAlert(friendlyFsError(err, t('fserr.file')));
        }
      });
      return;
    }

    if (action === 'open-pc') {
      await window.oyen.localFs.revealFile(filePath);
      return;
    }

    if (action === 'delete') {
      if (!(await confirmTrashFile(1, /^[a-z]+:\/\//i.test(filePath), fileName))) return;
      await runBusy(async () => {
        try {
          const result = await window.oyen.localFs.trashFile(filePath);
          if (!result?.ok) {
            await notifyAlert(friendlyFsError(result?.message, t('fserr.file')));
            return;
          }
          if (typeof onFileClose === 'function') onFileClose(filePath);
          await showFiles(activePath, { fresh: true });
        } catch (err) {
          await notifyAlert(friendlyFsError(err, t('fserr.file')));
        }
      });
    }
  }

  /* Saves the currently open remote folder as a project. Finds the profile used for the connection and clones it (new id) + copies the secret +
     defaultPath = this folder. Next time that project is opened, this folder becomes the tree / git root. */
  async function addRemoteFolderAsProject(folderUri) {
    let u;
    try { u = new URL(folderUri); } catch { return; }
    const settings = await window.oyen.appConfig.getSettings();
    const projects = Array.isArray(settings.projects) ? settings.projects : [];
    const proto = u.protocol.replace(':', '').toLowerCase();
    const matchType = proto === 'ftps' ? 'ftp' : proto;
    const host = u.hostname;
    const username = u.username ? decodeURIComponent(u.username) : '';
    /* Use the profile with the same host+user+type as the source (it holds the credentials). port is excluded from matching due to default-value drift. */
    const source = projects.find((p) =>
      (p?.type === 'sftp' || p?.type === 'ftp') && p.host &&
      p.type === matchType && p.host === host && (p.username || '') === username);
    if (!source) {
      await notifyAlert(t('alert.noRemoteProfile'));
      return;
    }
    const defaultPath = decodeURIComponent(u.pathname || '/') || '/';
    const defaultName = defaultPath.replace(/\/+$/, '').split('/').pop() || source.name;
    /* Project name input — statically shows the folder path to be saved (defaultPath), independent of the name input, to make clear what gets saved. */
    const name = await promptFileName(t('prompt.saveProject'), defaultName, t('prompt.saveLabel'), t('prompt.projectName'), '', defaultPath);
    if (!name) return;
    const newId = window.crypto?.randomUUID?.() ?? `r${Date.now()}`;
    /* derivedRemote: marks a "folder project" as distinct from a connection profile. It shows in the project panel
       but not in the site manager, and deleting it leaves the connection profile safe (it holds its own copy of the secret). */
    const project = { ...source, id: newId, name, defaultPath, derivedRemote: true };
    /* The secret (password/passphrase) is keyed by id, so copy it under the new id — keeps it linked even if order changes. */
    try {
      const secret = await window.oyen.remote.getSecret(source.id);
      if (secret && (secret.password || secret.passphrase)) {
        await window.oyen.remote.setSecret(newId, secret);
      }
    } catch (_) {}
    projects.push(project);
    settings.projects = projects;
    await window.oyen.appConfig.saveSettings(settings);
    if (typeof onProjectAdd === 'function') onProjectAdd(project);
  }

  async function runFolderContextAction(action, folderPath) {
    const rootPath = getCurrentRootPath();

    if (action === 'refresh') {
      await runBusy(() => refreshTree(rootPath, 'preserve'));
      return;
    }

    if (action === 'open-terminal') {
      if (typeof openTerminalAt === 'function') await openTerminalAt(folderPath);
      return;
    }

    if (action === 'chmod') {
      const name = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
      await applyChmod(folderPath, name, t('fserr.folder'));
      return;
    }

    if (action === 'new-folder') {
      const nextName = await promptFileName(t('ctx.newFolder'), '', t('dlg.create'), '', folderPath);
      if (!nextName) return;
      await runBusy(async () => {
        try {
          const fullPath = joinPath(folderPath, nextName);
          const result = await window.oyen.localFs.createDirectory(fullPath);
          if (!result?.ok) {
            const exists = /EEXIST|exists/i.test(result?.message || '');
            await notifyAlert(exists ? t('alert.sameNameFolder') : friendlyFsError(result?.message, t('fserr.folder')));
            return;
          }
          await activateDirectory(fullPath);
          const newRow = Array.from(treeRoot.querySelectorAll('.tree-row'))
            .find((r) => normalizePath(r.dataset.path) === normalizePath(fullPath));
          if (newRow) {
            newRow.scrollIntoView({ block: 'nearest' });
            newRow.classList.add('flash');
            setTimeout(() => newRow.classList.remove('flash'), 800);
          }
        } catch (err) {
          await notifyAlert(friendlyFsError(err, t('fserr.folder')));
        }
      });
      return;
    }

    if (action === 'add-project') {
      if (/^[a-z]+:\/\//i.test(folderPath)) {
        await addRemoteFolderAsProject(folderPath);
        return;
      }
      const defaultName = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
      const name = await promptFileName(t('prompt.saveProject'), defaultName, t('prompt.saveLabel'), t('prompt.projectName'), '', folderPath);
      if (!name) return;
      const settings = await window.oyen.appConfig.getSettings();
      const projects = Array.isArray(settings.projects) ? settings.projects : [];
      /* Assign an id — the root key is project:${id}, so local projects also need a stable id. */
      const project = { id: window.crypto?.randomUUID?.() ?? `r${Date.now()}`, name, path: folderPath };
      projects.push(project);
      settings.projects = projects;
      await window.oyen.appConfig.saveSettings(settings);
      if (typeof onProjectAdd === 'function') onProjectAdd(project);
      return;
    }

    if (action === 'rename-folder') {
      const currentName = folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
      const nextName = await promptFileName(t('ctx.renameFolder'), currentName, t('dlg.rename'), '', dirname(folderPath));
      if (!nextName || nextName === currentName) return;
      await runBusy(async () => {
        try {
          const result = await window.oyen.localFs.renameFile(folderPath, nextName);
          if (!result?.ok) {
            await notifyAlert(friendlyFsError(result?.message, t('fserr.folder')));
            return;
          }
          const newPath = result.path || joinPath(dirname(folderPath), nextName);
          if (typeof onFolderRename === 'function') onFolderRename(folderPath, newPath);
          const oldNorm = normalizePath(folderPath);
          const activePath = getActivePath();
          const activeNorm = normalizePath(activePath);
          const isAncestorOrSelf = activeNorm === oldNorm || activeNorm.startsWith(`${oldNorm}\\`);

          if (isAncestorOrSelf) {
            const newActivePath = newPath + activePath.slice(folderPath.length);
            await activateDirectory(newActivePath);
          } else {
            await refreshTree(rootPath, 'preserve');
          }

          const newRow = Array.from(treeRoot.querySelectorAll('.tree-row'))
            .find((r) => normalizePath(r.dataset.path) === normalizePath(newPath));
          if (newRow) {
            newRow.scrollIntoView({ block: 'nearest' });
            newRow.classList.add('flash');
            setTimeout(() => newRow.classList.remove('flash'), 800);
          }
        } catch (err) {
          await notifyAlert(friendlyFsError(err, t('fserr.folder')));
        }
      });
      return;
    }

    if (action === 'delete-folder') {
      const entries = await runBusy(() => window.oyen.localFs.list(folderPath));
      if (Array.isArray(entries) && entries.length > 0) {
        await notifyAlert(t('alert.folderNotEmpty'));
        return;
      }
      if (!(await confirmTrashFolder(/^[a-z]+:\/\//i.test(folderPath), folderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop()))) return;
      await runBusy(async () => {
        try {
          const result = await window.oyen.localFs.trashFile(folderPath);
          if (!result?.ok) {
            await notifyAlert(friendlyFsError(result?.message, t('fserr.folder')));
            return;
          }
          /* If the deleted folder was the current active location (or a descendant of it), move to the parent path; otherwise refresh in place. */
          const an = normalizePath(getActivePath() || '');
          const dn = normalizePath(folderPath);
          if (an === dn || an.startsWith(`${dn}\\`)) {
            await activateDirectory(dirname(folderPath));
          } else {
            /* Deleting an inactive folder — only remove the tree row from the DOM (no flicker, no refreshTree). It's empty, so there's no impact on children or git. */
            const row = Array.from(treeRoot.querySelectorAll('.tree-row')).find((r) => normalizePath(r.dataset.path) === dn);
            if (row) row.remove();
          }
        } catch (err) {
          await notifyAlert(friendlyFsError(err, t('fserr.folder')));
        }
      });
    }
  }

  return {
    showFileContextMenu,
    showTreeContextMenu,
    closeContextMenu
  };
}
