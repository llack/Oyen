import { createFileTreeContextMenu } from './file-tree-context.js';
import { confirmTrashFile, notifyAlert, promptFileName, confirmOverwrite } from './dialogs.js';
import { openTransferDialog, runRemoteScanDialog } from './transfer-progress-dialog.js';
import { runBusy } from './busy-lock.js';
import { friendlyFsError } from './friendly-error.js';
import { t } from './i18n.js';
import {
  normalizePath, joinPath, dirname,
  expandTo, activeChainPaths, getNextPathOnActiveChain
} from './file-tree-paths.js';

/* Folder icon: solid folder SVG (closed/open variants). Color from tokens.css --folder-icon. */
export const FOLDER_ICON_CLOSED = `<svg class="tree-folder-icon" viewBox="0 0 256 256" aria-hidden="true"><path d="M231.99512,87.99805V200.88867a15.13062,15.13062,0,0,1-15.10938,15.10938H39.99512a16.01582,16.01582,0,0,1-16-16v-136a16.01581,16.01581,0,0,1,16-16H93.33887a16.07363,16.07363,0,0,1,9.57812,3.19531l27.75,20.80469h85.32813A16.01582,16.01582,0,0,1,231.99512,87.99805Z"/></svg>`;
const FOLDER_ICON_OPEN = `<svg class="tree-folder-icon" viewBox="0 0 256 256" aria-hidden="true"><path d="M241.88037,110.64453A16.03934,16.03934,0,0,0,228.90039,104H216V88a16.01833,16.01833,0,0,0-16-16H130.667l-27.7334-20.7998A16.10323,16.10323,0,0,0,93.333,48H40A16.01833,16.01833,0,0,0,24,64V208c0,.05127.00684.10059.00781.15137.002.1123.00977.22412.0166.33642.01172.19043.02832.37891.05274.56592q.02051.15234.04639.30371c.03515.20459.07861.40576.1289.605.021.08252.04.16553.064.24756.06836.23877.14843.47217.23779.70117.0166.042.02978.08545.04687.12793a7.867,7.867,0,0,0,.39014.81592c.01563.02881.03467.05566.05078.084q.1919.33912.41553.65625c.019.02686.0332.05567.05225.08252.03564.04883.07763.09082.11377.13916.12255.16163.24951.31885.38378.47022.06836.07764.13672.1543.20752.22851.14161.14844.29.29.44287.42725.064.05713.125.11768.19043.17285a7.94692,7.94692,0,0,0,.69581.52832l.01953.01172a7.96822,7.96822,0,0,0,.73632.43311c.064.0332.12989.0625.19483.09375.19971.09765.40332.18847.61182.26953.0791.03027.1582.05859.23828.08691q.30176.1062.61377.188c.08447.02246.168.04541.25293.06494.21386.04883.43164.08643.65185.11817.0791.01123.15674.02685.23633.03613A8.06189,8.06189,0,0,0,32,216H208a8.00117,8.00117,0,0,0,7.58984-5.47021l28.48926-85.47022A16.039,16.039,0,0,0,241.88037,110.64453ZM93.333,64l27.7334,20.7998A16.10323,16.10323,0,0,0,130.667,88H200v16H69.76611a15.98037,15.98037,0,0,0-15.1792,10.94043L40,158.70166V64Z"/></svg>`;

export function mountFileTree({ treeRoot, fileListRoot, onFileOpen, onFileClose, onFileRename, onFolderRename, onPathChange, onProjectAdd, openTerminalAt, onSaveAs, onTreeRefresh, onRevealActiveFile, getActiveEditorPath }) {
  const expanded = new Set();
  let currentRootPath = '';
  let currentRootLabel = '';
  let activePath = '';
  let rangeAnchor = ''; /* Anchor for Shift+click range selection (last single/Ctrl click path) */
  let entriesCache = new Map();
  /* git status cache — latest snapshot from store.subscribe. Used to reapply markers after a tree/file rerender. */
  let lastGitSnapshot = null;

  async function fetchEntriesRaw(dirPath) {
    if (!window.oyen?.localFs?.list) return [];
    return window.oyen.localFs.list(dirPath);
  }

  async function fetchEntries(dirPath) {
    const key = normalizePath(dirPath);
    if (entriesCache.has(key)) return entriesCache.get(key);
    const promise = fetchEntriesRaw(dirPath);
    entriesCache.set(key, promise);
    return promise;
  }

  function esc(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function rowTemplate(item, depth, isOpen) {
    const indent = depth * 12;

    return `
      <div class="tree-row" data-path="${item.path}" data-type="${item.type}" role="treeitem" tabindex="-1" style="padding-left:${indent + 2}px">
        ${isOpen ? FOLDER_ICON_OPEN : FOLDER_ICON_CLOSED}
        <span class="tree-name">${item.name}</span>
      </div>
    `;
  }

  async function renderDir(dirPath, depth = 0) {
    const entries = await fetchEntries(dirPath);
    const directories = entries.filter((entry) => entry.type === 'directory');
    const nextPath = getNextPathOnActiveChain(dirPath, activePath);
    const visibleDirectories = nextPath
      ? directories.filter((entry) => normalizePath(entry.path) === normalizePath(nextPath))
      : directories;
    let html = '';

    for (const item of visibleDirectories) {
      const isOpen = expanded.has(normalizePath(item.path));
      html += rowTemplate(item, depth, isOpen);
      if (item.type === 'directory' && isOpen) {
        html += await renderDir(item.path, depth + 1);
      }
    }

    return html;
  }

  function relPathOf(rootPath, absPath) {
    if (!rootPath || !absPath) return '';
    const normRoot = String(rootPath).replace(/[\\/]+$/, '');
    if (!absPath.startsWith(normRoot)) return '';
    return absPath.slice(normRoot.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
  }

  function ensureMarker(row, marker) {
    let span = row.querySelector(':scope > .git-marker');
    if (!marker) {
      if (span) span.remove();
      row.removeAttribute('data-git-marker');
      return;
    }
    if (!span) {
      span = document.createElement('span');
      row.appendChild(span);
    }
    span.className = `git-marker git-marker-${marker}`;
    span.textContent = marker;
    row.dataset.gitMarker = marker;
  }

  /* Folder tree rows show no badge, only a name color — folders containing changes (M/U/D) all use the M color.
     Child status priority is not considered (by request: a single color signalling "has changes"). */
  function markTreeFolder(row, on) {
    if (on) row.dataset.gitMarker = 'M';
    else row.removeAttribute('data-git-marker');
  }

  function applyGitStatus(snapshot) {
    lastGitSnapshot = snapshot || null;
    /* Badges (M/U/D) only on the file list. The folder tree (treeRoot) just colors the names of folders with changes M (no badge). */
    const fileRows = [...fileListRoot.querySelectorAll('.file-row')];
    const treeRows = [...treeRoot.querySelectorAll('.tree-row')];
    if (!snapshot || !snapshot.isRepo) {
      fileRows.forEach((row) => ensureMarker(row, null));
      treeRows.forEach((row) => markTreeFolder(row, false));
      return;
    }
    const root = currentRootPath;
    if (!root) return;
    const fileMarkers = new Map();
    /* Collect the relative paths of all ancestor folders of changed files — used to decide folder coloring. */
    const changedDirs = new Set();
    for (const f of (snapshot.files || [])) {
      fileMarkers.set(f.path, f.marker);
      const parts = f.path.split('/');
      parts.pop();
      let acc = '';
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        changedDirs.add(acc);
      }
    }
    fileRows.forEach((row) => {
      const rel = relPathOf(root, row.dataset.path || '');
      ensureMarker(row, fileMarkers.get(rel) || null);
    });
    treeRows.forEach((row) => {
      const rel = relPathOf(root, row.dataset.path || '');
      /* Exclude the root row (rel='') — it would always light up when there are changes, which is noise. */
      markTreeFolder(row, rel !== '' && changedDirs.has(rel));
    });
  }

  async function refreshTree(rootPath, scrollMode = 'preserve') {
    currentRootPath = rootPath;
    if (!activePath) activePath = rootPath;
    if (scrollMode === 'top') resetScrollTop(treeRoot);

    entriesCache = new Map();
    const chain = activeChainPaths(rootPath, activePath);
    await Promise.all(chain.map((p) => fetchEntries(p)));

    const rootItem = {
      name: currentRootLabel || rootPath,
      path: rootPath,
      type: 'directory'
    };
    const [treeHtml] = await Promise.all([
      renderDir(rootPath, 1),
      showFiles(activePath)
    ]);
    treeRoot.innerHTML = rowTemplate(rootItem, 0, true) + treeHtml;
    notifyPathChange();

    if (window.lucide?.createIcons) {
      window.lucide.createIcons({ icons: window.lucide.icons });
    }

    if (scrollMode === 'top') {
      resetScrollTop(treeRoot);
    } else if (scrollMode === 'active') {
      scrollActiveDirectoryIntoView();
    } else if (!isActiveDirectoryAtTop()) {
      scrollActiveDirectoryIntoView();
    }

    if (lastGitSnapshot) applyGitStatus(lastGitSnapshot);
    /* The tree refresh is called right after entering a folder or an fs operation (create/delete/rename/upload),
       so refresh git status here too — apply markers immediately instead of waiting for the 5s poll. */
    if (typeof onTreeRefresh === 'function') onTreeRefresh();
  }

  async function showFiles(dirPath, { fresh = false } = {}) {
    if (fresh) entriesCache.delete(normalizePath(dirPath));
    const entries = await fetchEntries(dirPath);
    const files = entries.filter((entry) => entry.type === 'file');
    fileListRoot.innerHTML = files.map((file) => `
      <div class="file-row" data-path="${file.path}" data-name="${file.name}" tabindex="-1">
        <span class="file-name">${file.name}</span>
      </div>
    `).join('');

    if (window.lucide?.createIcons) {
      window.lucide.createIcons({ icons: window.lucide.icons });
    }

    resetScrollTop(fileListRoot);

    if (lastGitSnapshot) applyGitStatus(lastGitSnapshot);
    /* fresh = right after an fs operation (create/delete/rename) → re-query git status immediately (don't wait for the poll). */
    if (fresh && typeof onTreeRefresh === 'function') onTreeRefresh();
  }

  async function activateDirectory(nodePath) {
    activePath = nodePath;
    expanded.clear();
    expandTo(currentRootPath, nodePath, expanded);
    await refreshTree(currentRootPath, 'active');
    await showFiles(nodePath);
    notifyPathChange();
  }

  function scrollActiveDirectoryIntoView() {
    const activeRow = Array.from(treeRoot.querySelectorAll('.tree-row'))
      .find((r) => normalizePath(r.dataset.path) === normalizePath(activePath));
    if (!activeRow) return;
    activeRow.scrollIntoView({ block: 'nearest' });
  }

  function resetScrollTop(element) {
    element.scrollTop = 0;
    element.scrollLeft = 0;
  }

  function isActiveDirectoryAtTop() {
    return normalizePath(activePath) === normalizePath(currentRootPath);
  }

  function showLoading(target) {
    target.innerHTML = `
      <div class="panel-loading" aria-label="${t('aria.loading')}">
        <div class="panel-loading-bar"></div>
      </div>
    `;
  }

  function selectFileRow(row, { focus = true } = {}) {
    fileListRoot.querySelectorAll('.file-row.active').forEach((node) => node.classList.remove('active'));
    row.classList.add('active');
    rangeAnchor = row.dataset.path || '';
    if (focus) row.focus({ preventScroll: true });
  }

  /* Shift+click — select the entire contiguous range from rangeAnchor to the clicked row. If no anchor, just the clicked item. */
  function selectRangeTo(row) {
    const rows = Array.from(fileListRoot.querySelectorAll('.file-row'));
    const toIdx = rows.indexOf(row);
    if (toIdx < 0) return;
    let fromIdx = rangeAnchor ? rows.findIndex((r) => r.dataset.path === rangeAnchor) : -1;
    if (fromIdx < 0) fromIdx = toIdx;
    const lo = Math.min(fromIdx, toIdx);
    const hi = Math.max(fromIdx, toIdx);
    rows.forEach((r, i) => r.classList.toggle('active', i >= lo && i <= hi));
    row.focus({ preventScroll: true });
  }

  function focusFilePath(filePath, { select = true, focus = true, flash = false } = {}) {
    const row = Array.from(fileListRoot.querySelectorAll('.file-row'))
      .find((node) => normalizePath(node.dataset.path || '') === normalizePath(filePath));
    if (!row) return;
    if (select) selectFileRow(row, { focus });
    if (flash) {
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 800);
    }
    row.scrollIntoView({ block: 'nearest' });
  }

  const ctxMenu = createFileTreeContextMenu({
    treeRoot,
    getCurrentRootPath: () => currentRootPath,
    getActivePath: () => activePath,
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
    onMultiDelete: () => deleteSelectedFiles(),
    onDownload: (path) => downloadToLocal([path]),
    onMultiDownload: () => downloadToLocal(getSelectedFilePaths()),
    onDownloadFolder: (folderUri) => downloadRemoteFolder(folderUri),
    createFile: createFileAt,
    saveAs: (filePath, fileName) => saveAsFile(filePath, fileName),
    onRevealActiveFile,
    getActiveEditorPath
  });

  function getSelectedFilePaths() {
    return Array.from(fileListRoot.querySelectorAll('.file-row.active'))
      .map((r) => r.dataset.path)
      .filter(Boolean);
  }

  function activeDirBasename() {
    const dir = (activePath || currentRootPath || '').replace(/[\\/]+$/, '');
    const base = dir.split(/[\\/]/).pop() || '';
    if (!base || /^[a-z]+:$/i.test(base)) return '';
    return base;
  }

  async function downloadRemoteFolder(folderUri) {
    if (!folderUri) return;
    const picked = await window.oyen.localFs.pickDirectory();
    if (!picked?.ok || !picked.path) return;
    try {
      /* Scan dialog — progress display + cancel. On cancel returns null → abort the download entirely. */
      const scan = await runRemoteScanDialog(folderUri);
      if (!scan) return;
      const { items, emptyDirs, totalBytes } = scan;
      if (!items.length && !(emptyDirs?.length)) {
        await notifyAlert(t('alert.noFilesToDownload'));
        return;
      }
      const folderName = folderUri.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'download';
      await openTransferDialog({
        kind: 'download',
        targetDir: picked.path,
        items,
        emptyDirs,
        totalBytes,
        wrapName: folderName,
        conflictPolicy: 'merge'
      });
    } catch (err) {
      await notifyAlert(friendlyFsError(err, t('fserr.folder')));
    }
  }

  async function downloadToLocal(sources) {
    if (!Array.isArray(sources) || sources.length === 0) return;
    const picked = await window.oyen.localFs.pickDirectory();
    if (!picked?.ok || !picked.path) return;
    /* Both single and multi downloads go into a wrap folder named after the active directory. Keeps things tidy. */
    const wrapName = activeDirBasename() || 'download';
    try {
      const { items, totalBytes } = await window.oyen.transfer.statRemoteFiles(sources);
      await openTransferDialog({
        kind: 'download',
        targetDir: picked.path,
        items,
        totalBytes,
        wrapName,
        conflictPolicy: 'merge'
      });
    } catch (err) {
      await notifyAlert(friendlyFsError(err, t('fserr.file')));
    }
  }

  /* Single click = mark selected (.active) + focus. Doesn't change the open folder (activePath) — entering/expanding is double-click. */
  treeRoot.addEventListener('click', (event) => {
    const row = event.target.closest('.tree-row');
    if (!row) return;
    treeRoot.querySelectorAll('.tree-row.active').forEach((r) => r.classList.remove('active'));
    row.classList.add('active');
    row.focus();
  });

  treeRoot.addEventListener('dblclick', async (event) => {
    event.preventDefault();
    const row = event.target.closest('.tree-row');
    if (!row) return;
    if (row.dataset.type !== 'directory') return;
    const targetPath = row.dataset.path;
    const prevActive = activePath;
    const prevExpanded = new Set(expanded);
    await runBusy(async () => {
      try {
        if (normalizePath(targetPath) === normalizePath(currentRootPath)) {
          activePath = currentRootPath;
          expanded.clear();
          await refreshTree(currentRootPath, 'top');
          await showFiles(currentRootPath);
          notifyPathChange();
          return;
        }
        await activateDirectory(targetPath);
      } catch (err) {
        activePath = prevActive;
        expanded.clear();
        prevExpanded.forEach((p) => expanded.add(p));
        try { await refreshTree(currentRootPath, 'preserve'); } catch {}
        await notifyAlert(friendlyFsError(err, t('fserr.folder')));
      }
    });
  });

  fileListRoot.addEventListener('click', (event) => {
    const row = event.target.closest('.file-row');
    if (!row) return;
    if (event.shiftKey) {
      selectRangeTo(row);
      return;
    }
    if (event.ctrlKey || event.metaKey) {
      row.classList.toggle('active');
      rangeAnchor = row.dataset.path || '';
      row.focus({ preventScroll: true });
      return;
    }
    selectFileRow(row);
  });

  fileListRoot.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('.file-row')) return;
    /* Empty-space click: the marquee's preventDefault blocks the default focus, so focus explicitly.
       → Ctrl+A (select all) works even when there are few files and you click empty space. */
    fileListRoot.focus({ preventScroll: true });
    startMarqueeSelect(event);
  });

  function startMarqueeSelect(downEvent) {
    const additive = downEvent.shiftKey || downEvent.ctrlKey || downEvent.metaKey;
    if (!additive) {
      fileListRoot.querySelectorAll('.file-row.active').forEach((r) => r.classList.remove('active'));
    }
    const initialActive = new Set(
      Array.from(fileListRoot.querySelectorAll('.file-row.active'))
        .map((r) => r.dataset.path)
        .filter(Boolean)
    );
    const startRect = fileListRoot.getBoundingClientRect();
    const startX = downEvent.clientX - startRect.left + fileListRoot.scrollLeft;
    const startY = downEvent.clientY - startRect.top + fileListRoot.scrollTop;
    let lastClientX = downEvent.clientX;
    let lastClientY = downEvent.clientY;

    const box = document.createElement('div');
    box.className = 'file-list-marquee';
    fileListRoot.appendChild(box);

    const update = () => {
      const r = fileListRoot.getBoundingClientRect();
      const curX = lastClientX - r.left + fileListRoot.scrollLeft;
      const curY = lastClientY - r.top + fileListRoot.scrollTop;
      const x1 = Math.max(0, Math.min(startX, curX));
      const y1 = Math.max(0, Math.min(startY, curY));
      const x2 = Math.min(fileListRoot.scrollWidth, Math.max(startX, curX));
      const y2 = Math.min(fileListRoot.scrollHeight, Math.max(startY, curY));
      box.style.left = `${x1}px`;
      box.style.top = `${y1}px`;
      box.style.width = `${x2 - x1}px`;
      box.style.height = `${y2 - y1}px`;
      const boxClient = {
        left: r.left + x1 - fileListRoot.scrollLeft,
        top: r.top + y1 - fileListRoot.scrollTop,
        right: r.left + x2 - fileListRoot.scrollLeft,
        bottom: r.top + y2 - fileListRoot.scrollTop
      };
      fileListRoot.querySelectorAll('.file-row').forEach((row) => {
        const rr = row.getBoundingClientRect();
        const hit = rr.right > boxClient.left && rr.left < boxClient.right
                 && rr.bottom > boxClient.top && rr.top < boxClient.bottom;
        if (hit || (additive && initialActive.has(row.dataset.path))) {
          row.classList.add('active');
        } else {
          row.classList.remove('active');
        }
      });
    };

    let scrollRaf = 0;
    const autoScrollTick = () => {
      const r = fileListRoot.getBoundingClientRect();
      const margin = 24;
      let dy = 0;
      if (lastClientY < r.top + margin) dy = lastClientY - (r.top + margin);
      else if (lastClientY > r.bottom - margin) dy = lastClientY - (r.bottom - margin);
      if (dy !== 0) {
        fileListRoot.scrollTop += dy * 0.3;
        update();
      }
      scrollRaf = requestAnimationFrame(autoScrollTick);
    };
    scrollRaf = requestAnimationFrame(autoScrollTick);

    const onMove = (e) => {
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      update();
    };
    const onUp = () => {
      cancelAnimationFrame(scrollRaf);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      box.remove();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    update();
    downEvent.preventDefault();
  }

  function selectAllFileRows() {
    fileListRoot.querySelectorAll('.file-row').forEach((r) => r.classList.add('active'));
  }

  async function deleteSelectedFiles() {
    const selected = Array.from(fileListRoot.querySelectorAll('.file-row.active'));
    if (selected.length === 0) return false;
    await batchTrashSelected(selected);
    return true;
  }

  function isFileListFocused() {
    return fileListRoot.contains(document.activeElement) || fileListRoot === document.activeElement;
  }

  function isTreeFocused() {
    return treeRoot.contains(document.activeElement);
  }

  /* F2 rename — rename the focused item (tree folder or file-list file). Root is excluded. */
  async function renameActive() {
    let path = '', fromTree = false;
    if (isFileListFocused()) {
      path = fileListRoot.querySelector('.file-row.active')?.dataset.path || '';
    } else if (isTreeFocused()) {
      path = document.activeElement?.closest?.('.tree-row')?.dataset.path || activePath;
      fromTree = true;
    }
    if (!path || normalizePath(path) === normalizePath(currentRootPath)) return;
    const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
    const nextName = await promptFileName(t('ctx.rename'), name, t('dlg.rename'), '', dirname(path));
    if (!nextName || nextName === name) return;
    await runBusy(async () => {
      try {
        const result = await window.oyen.localFs.renameFile(path, nextName);
        if (!result?.ok) { await notifyAlert(friendlyFsError(result?.message, t('fserr.file'))); return; }
        const newPath = result.path || joinPath(dirname(path), nextName);
        const newName = result.name || nextName;
        if (typeof onFileRename === 'function') onFileRename(path, newPath, newName);
        if (fromTree) {
          /* Folder rename — all descendant paths change, so the tree needs refreshing. If it's the folder being viewed, update activePath too. */
          if (normalizePath(path) === normalizePath(activePath)) activePath = newPath;
          await refreshTree(currentRootPath, 'preserve');
          await showFiles(activePath, { fresh: true });
        } else {
          /* File rename — update only the file-list row's DOM (no flicker at all). The refresh partially updates the git marker via ensureMarker. */
          const row = Array.from(fileListRoot.querySelectorAll('.file-row'))
            .find((r) => normalizePath(r.dataset.path) === normalizePath(path));
          if (row) {
            row.dataset.path = newPath;
            row.dataset.name = newName;
            const nameEl = row.querySelector('.file-name');
            if (nameEl) nameEl.textContent = newName;
          }
          if (typeof onTreeRefresh === 'function') onTreeRefresh();
        }
      } catch (err) {
        await notifyAlert(friendlyFsError(err, t('fserr.file')));
      }
    });
  }

  async function batchTrashSelected(rows) {
    const isRemote = /^[a-z]+:\/\//i.test(rows[0]?.dataset.path || '');
    const name = rows.length === 1 ? (rows[0]?.dataset.name || '') : '';
    if (!(await confirmTrashFile(rows.length, isRemote, name))) return;
    await runBusy(async () => {
      try {
        const paths = rows.map((r) => r.dataset.path).filter(Boolean);
        const results = await Promise.all(paths.map((p) => window.oyen.localFs.trashFile(p)));
        const failed = results
          .map((r, i) => (r?.ok ? null : { path: paths[i], message: r?.message }))
          .filter(Boolean);
        paths.forEach((p, i) => {
          if (results[i]?.ok && typeof onFileClose === 'function') onFileClose(p);
        });
        await showFiles(activePath, { fresh: true });
        if (failed.length) {
          await notifyAlert(t('alert.deleteSomeFailed', { n: failed.length }));
        }
      } catch (err) {
        await notifyAlert(friendlyFsError(err, t('fserr.file')));
      }
    });
  }

  fileListRoot.addEventListener('dblclick', (event) => {
    const row = event.target.closest('.file-row');
    if (!row) return;

    const fileName = row.dataset.name || '';
    const filePath = row.dataset.path || '';
    if (filePath && typeof onFileOpen === 'function') onFileOpen(filePath, fileName);
  });

  fileListRoot.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.file-row');
    event.preventDefault();
    /* If the right-clicked row isn't selected, select only that row → context target matches the visible selection.
       If it's already part of a (multi) selection, keep that selection (multiple targets). */
    if (row && !row.classList.contains('active')) {
      fileListRoot.querySelectorAll('.file-row.active').forEach((r) => r.classList.remove('active'));
      row.classList.add('active');
      row.focus();
    }
    const selectedPaths = Array.from(fileListRoot.querySelectorAll('.file-row.active'))
      .map((r) => r.dataset.path)
      .filter(Boolean);
    ctxMenu.showFileContextMenu(event, row, selectedPaths);
  });

  treeRoot.addEventListener('contextmenu', (event) => {
    const row = event.target.closest('.tree-row');
    event.preventDefault();
    if (row) row.focus();  /* Move focus to the right-clicked folder — makes the target clear */
    ctxMenu.showTreeContextMenu(event, row);
  });

  /* Only handle files/folders dragged from the OS. Internal HTML5 drags (project reorder, etc.) have no 'Files' in types. */
  function hasOsFiles(dataTransfer) {
    return Array.from(dataTransfer?.types || []).includes('Files');
  }

  /* Classify dataTransfer.items into file paths / folder paths. webkitGetAsEntry distinguishes folders. */
  function classifyDroppedItems(dataTransfer) {
    const files = [];
    const folders = [];
    const items = Array.from(dataTransfer.items || []);
    for (const it of items) {
      if (it.kind !== 'file') continue;
      const entry = it.webkitGetAsEntry?.();
      const file = it.getAsFile?.();
      if (!file) continue;
      let p = '';
      try { p = window.oyen?.getPathForFile?.(file) || ''; } catch (_) {}
      if (!p) continue;
      if (entry?.isDirectory) folders.push(p);
      else files.push(p);
    }
    return { files, folders };
  }

  async function refreshAfterUpload(targetDir) {
    /* Surface upload results: new folders appear in the tree (directories), new files in the active folder's file list.
       showFiles only refreshes files, so new 'folders' wouldn't show — use refreshTree to refresh the tree (+ active file list + git).
       Expand the dropped folder so the upload results are immediately visible. */
    if (targetDir) expanded.add(normalizePath(targetDir));
    await refreshTree(currentRootPath, 'preserve');
  }

  async function uploadFilesToDir(localPaths, targetDir) {
    if (!localPaths.length || !targetDir) return;
    try {
      const { items, totalBytes } = await window.oyen.transfer.statLocalFiles(localPaths);
      /* Conflict check — if a same-named file exists, confirm overwrite. If OK, conflictPolicy='overwrite'. */
      const existing = await window.oyen.localFs.list(targetDir).catch(() => []);
      const existingNames = new Set((existing || []).map((e) => e?.name).filter(Boolean));
      const conflicts = items.map((it) => it.name).filter((n) => existingNames.has(n));
      let conflictPolicy;
      let autoStart = false;
      if (conflicts.length > 0) {
        const ok = await confirmOverwrite(conflicts);
        if (!ok) return;
        conflictPolicy = 'overwrite';
        autoStart = true; /* Overwrite already confirmed, so skip the send-confirm step and proceed directly. */
      }
      await openTransferDialog({
        kind: 'upload',
        targetDir,
        items,
        totalBytes,
        conflictPolicy,
        autoStart,
        onFinished: () => { refreshAfterUpload(targetDir).catch(() => {}); }
      });
    } catch (err) {
      await notifyAlert(friendlyFsError(err, t('fserr.file')));
    }
  }

  async function uploadFolderToDir(localFolderPath, targetDir) {
    if (!localFolderPath || !targetDir) return;
    try {
      const folderName = localFolderPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || localFolderPath;
      /* Folder upload: if a same-named folder exists, just alert and cancel (no rename / merge). */
      const existing = await window.oyen.localFs.list(targetDir).catch(() => []);
      if ((existing || []).some((e) => e?.name === folderName)) {
        await notifyAlert(t('alert.folderExists', { name: folderName }));
        return;
      }
      const { items, emptyDirs, totalBytes } = await window.oyen.transfer.scanLocalDirectory(localFolderPath);
      if (!items.length && !(emptyDirs?.length)) {
        await notifyAlert(t('alert.noFilesToUpload'));
        return;
      }
      await openTransferDialog({
        kind: 'upload',
        targetDir,
        items,
        emptyDirs,
        totalBytes,
        wrapName: folderName,
        onFinished: () => { refreshAfterUpload(targetDir).catch(() => {}); }
      });
    } catch (err) {
      await notifyAlert(friendlyFsError(err, t('fserr.folder')));
    }
  }

  /* File area: accepts files only. Folders are rejected after a notice. Target = current activePath. */
  fileListRoot.addEventListener('dragover', (event) => {
    if (!hasOsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    fileListRoot.classList.add('drop-target');
  });
  fileListRoot.addEventListener('dragleave', (event) => {
    /* Ignore dragleave fired while moving over a child (file row) — only clear the dashed outline when leaving the container (to the tree, outside the window, etc.).
       The old `target === fileListRoot` check failed when leaving from a child, since target was the child, so the outline never cleared. */
    if (!event.relatedTarget || !fileListRoot.contains(event.relatedTarget)) {
      fileListRoot.classList.remove('drop-target');
    }
  });
  fileListRoot.addEventListener('drop', async (event) => {
    if (!hasOsFiles(event.dataTransfer)) return;
    event.preventDefault();
    fileListRoot.classList.remove('drop-target');
    const { files, folders } = classifyDroppedItems(event.dataTransfer);
    const target = activePath || currentRootPath;
    if (folders.length > 0) {
      await notifyAlert(t('alert.uploadFilesOnly'));
      return;
    }
    if (files.length === 0) return;
    await uploadFilesToDir(files, target);
  });

  /* Tree area: drop only onto folder rows. Files upload immediately; folders go through the preview dialog. */
  treeRoot.addEventListener('dragover', (event) => {
    if (!hasOsFiles(event.dataTransfer)) return;
    const row = event.target.closest('.tree-row[data-type="directory"]');
    if (!row) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    treeRoot.querySelectorAll('.tree-row.drop-target').forEach((r) => r.classList.remove('drop-target'));
    row.classList.add('drop-target');
  });
  treeRoot.addEventListener('dragleave', (event) => {
    const row = event.target.closest('.tree-row.drop-target');
    if (row && !row.contains(event.relatedTarget)) row.classList.remove('drop-target');
  });
  treeRoot.addEventListener('drop', async (event) => {
    if (!hasOsFiles(event.dataTransfer)) return;
    const row = event.target.closest('.tree-row[data-type="directory"]');
    treeRoot.querySelectorAll('.tree-row.drop-target').forEach((r) => r.classList.remove('drop-target'));
    if (!row) return;
    event.preventDefault();
    const targetDir = row.dataset.path;
    if (!targetDir) return;
    const { files, folders } = classifyDroppedItems(event.dataTransfer);
    if (files.length) await uploadFilesToDir(files, targetDir);
    for (const folder of folders) {
      await uploadFolderToDir(folder, targetDir);
    }
  });

  document.addEventListener('click', ctxMenu.closeContextMenu);
  /* Close on right-click outside the menu — fixes the tree menu lingering and double-opening when right-clicking a tab/editor/toolbar. Handled in capture phase before the new menu opens. */
  document.addEventListener('contextmenu', (event) => {
    if (!event.target?.closest?.('.context-menu')) ctxMenu.closeContextMenu();
  }, true);
  window.addEventListener('blur', ctxMenu.closeContextMenu);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') ctxMenu.closeContextMenu();
  });

  return {
    refreshTree: async (rootPath, expandPath, rootLabel = '', scrollMode = 'active') => {
      expanded.clear();
      currentRootLabel = rootLabel;
      activePath = expandPath || rootPath;
      expandTo(rootPath, expandPath, expanded);
      await refreshTree(rootPath, scrollMode);
    },
    refreshCurrent: async () => {
      await refreshTree(currentRootPath, 'preserve');
    },
    showLoading: () => {
      showLoading(treeRoot);
      showLoading(fileListRoot);
    },
    getRootPath: () => currentRootPath,
    getActivePath: () => activePath || currentRootPath,
    applyGitStatus,
    createFileInActiveDir,
    selectAllFileRows,
    deleteSelectedFiles,
    isFileListFocused,
    renameActive,
    revealPath: async (filePath) => {
      if (!filePath) return;
      const dir = dirname(filePath);
      if (!dir) return;
      if (normalizePath(dir) !== normalizePath(activePath)) {
        await runBusy(() => activateDirectory(dir));
      }
      focusFilePath(filePath);
    }
  };

  async function createFileAt(targetDir) {
    if (!targetDir) return;
    const nextName = await promptFileName(t('ctx.newFile'), '', t('dlg.create'), '', targetDir);
    if (!nextName) return;
    await runBusy(async () => {
      try {
        const fullPath = joinPath(targetDir, nextName);
        const result = await window.oyen.localFs.createFile(fullPath);
        if (!result?.ok) {
          const exists = /EEXIST|exists/i.test(result?.message || '');
          await notifyAlert(exists ? t('alert.sameNameFile') : friendlyFsError(result?.message, t('fserr.file')));
          return;
        }
        await showFiles(targetDir, { fresh: true });
        focusFilePath(fullPath, { focus: false, flash: true });
        if (typeof onFileOpen === 'function') onFileOpen(fullPath, nextName);
      } catch (err) {
        await notifyAlert(friendlyFsError(err, t('fserr.file')));
      }
    });
  }

  /* Read the right-clicked file and save it under a different name (export). Independent of the active editor tab — based on that file. */
  async function saveAsFile(filePath, fileName) {
    const desc = await window.oyen.localFs.readTextDescriptor(filePath);
    /* status==='ok' means text; otherwise (binary like pdf/image/media) copy the original as-is. */
    const isText = desc?.status === 'ok';
    const dotIdx = fileName.lastIndexOf('.');
    const ext = dotIdx > 0 ? fileName.slice(dotIdx + 1).toLowerCase() : '';
    const filters = ext
      ? [{ name: t('saveDialog.filter.ext', { ext: ext.toUpperCase() }), extensions: [ext] }, { name: t('saveDialog.filter.all'), extensions: ['*'] }]
      : [{ name: t('saveDialog.filter.all'), extensions: ['*'] }];
    const picked = await window.oyen.localFs.pickSaveFile({ defaultPath: filePath, filters });
    if (!picked?.ok || !picked.path) return;
    await runBusy(async () => {
      if (isText) {
        const result = await window.oyen.localFs.writeText(picked.path, desc.content, desc.encoding || 'UTF-8');
        if (!result?.ok) await notifyAlert(friendlyFsError(result?.message, t('fserr.file')));
      } else {
        const result = await window.oyen.localFs.copyFile(filePath, picked.path);
        if (!result?.ok) await notifyAlert(friendlyFsError(result?.error, t('fserr.file')));
      }
    });
  }

  function createFileInActiveDir() {
    return createFileAt(activePath || currentRootPath);
  }

  function notifyPathChange() {
    if (typeof onPathChange === 'function') onPathChange(activePath);
  }
}
