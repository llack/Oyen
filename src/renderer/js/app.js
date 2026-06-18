import { createIcons, icons } from 'lucide';
import '@vscode/codicons/dist/codicon.css';
import iconUndo from '@tabler/icons/outline/arrow-back-up.svg?raw';
import iconRedo from '@tabler/icons/outline/arrow-forward-up.svg?raw';
import iconSave from '@tabler/icons/outline/device-floppy.svg?raw';
import iconNewFile from '@tabler/icons/outline/file-plus.svg?raw';
import iconSaveAll from '@tabler/icons/outline/file-stack.svg?raw';
import iconOpenFolder from '@tabler/icons/outline/folder-open.svg?raw';
import iconProjectRemote from '@tabler/icons/outline/world.svg?raw';
import iconSyncDirectory from '@tabler/icons/outline/link.svg?raw';
import tablerRefreshIcon from '@tabler/icons/outline/refresh.svg?raw';
import iconSplitEditor from '@tabler/icons/outline/layout-rows.svg?raw';
import iconTerminal from '@tabler/icons/outline/terminal-2.svg?raw';
import iconWordWrap from '@tabler/icons/outline/text-wrap.svg?raw';
import iconMinimap from '@tabler/icons/outline/layout-sidebar-right.svg?raw';
import iconDeleteSel from '@tabler/icons/outline/x.svg?raw';
import iconCut from '@tabler/icons/outline/scissors.svg?raw';
import iconCopy from '@tabler/icons/outline/copy.svg?raw';
import iconPaste from '@tabler/icons/outline/clipboard.svg?raw';
import iconReload from '@tabler/icons/outline/refresh-dot.svg?raw';
import iconRevealFile from '@tabler/icons/outline/crosshair.svg?raw';
import { getTopMenus } from './menus.js';
import { mountMenus } from './menu-ui.js';
import { mountSplitters } from './splitter-ui.js';
import { mountEditor } from './editor-ui.js';
import { mountSearchUI } from './search-ui.js';
import { mountEditorSettingsModal } from './settings-modal-ui.js';
import { exportSettingsFlow, importSettingsFlow } from './settings-io.js';
import { mountFileTree, FOLDER_ICON_CLOSED } from './file-tree-ui.js';
import { dirname, normalizePath } from './file-tree-paths.js';
import { createGitStatusStore } from './git-status-store.js';
import { mountGitPanel } from './git-panel-ui.js';
import { mountRootSelect } from './root-select-ui.js';
import { openSiteManager } from './site-manager-ui.js';
import { openFolderSourceChooser, openRemoteFolderPicker } from './remote-folder-picker.js';
import { notifyAlert, friendlyConnectError, confirmHostKey, confirmDirtyClose, confirmReload, promptGoToLine } from './dialogs.js';
import { initI18n, t, getLanguage, SUPPORTED_LANGUAGES } from './i18n.js';
import { createProjectPanel, isLocalProject, isRemoteProject } from './project-panel-ui.js';
import { mountShortcuts, DEFAULT_SHORTCUTS } from './shortcuts.js';
import { isBusy, runBusy } from './busy-lock.js';
import { createRecentFolders } from './recent-folders.js';
import { createRecentFiles } from './recent-files.js';
import { folderBasename, remoteAuthority, remoteUri, getRemoteTreeRoot, getRemoteExpandPath, uriPathBasename } from './remote-uri.js';
import { setFileLinkHandler } from './cm6-url-link.js';
import { createStatusBar } from './status-bar.js';
import { createBreadcrumb } from './breadcrumb-ui.js';
import { mountTerminalPanel } from './terminal-panel.js';

window.lucide = { createIcons, icons };

const toolbarIcons = {
  newFile: iconNewFile,
  openFolder: iconOpenFolder,
  save: iconSave,
  saveAll: iconSaveAll,
  undo: iconUndo,
  redo: iconRedo,
  syncDirectory: iconSyncDirectory,
  splitEditor: iconSplitEditor,
  terminal: iconTerminal,
  wordWrap: iconWordWrap,
  minimap: iconMinimap,
  deleteSel: iconDeleteSel,
  cut: iconCut,
  copy: iconCopy,
  paste: iconPaste,
  reload: iconReload,
  revealFile: iconRevealFile
};

async function bootstrap() {
  let settings = {};
  if (window.oyen?.appConfig?.getSettings) {
    settings = await window.oyen.appConfig.getSettings();
  }

  /* Project/site root keys are id-based (project:${id}) — avoids collisions from duplicate names (e.g. a project sharing a site's name).
     Assign a stable id to existing/local projects that lack one, saving once if anything changed. */
  if (Array.isArray(settings.projects)) {
    let idChanged = false;
    settings.projects.forEach((p, i) => {
      if (p && !p.id) {
        p.id = window.crypto?.randomUUID?.() ?? `r${Date.now()}_${i}`;
        idChanged = true;
      }
    });
    if (idChanged) window.oyen?.appConfig?.saveSettings?.(settings)?.catch?.(() => {});
  }

  /* Persist the last splitter sizes to settings.layout. When a drag ends, update settings and save them permanently. */
  const layout = settings.layout || {};
  let layoutSaveTimer = null;
  function persistLayout(next) {
    settings.layout = { ...(settings.layout || {}), ...next };
    if (layoutSaveTimer) clearTimeout(layoutSaveTimer);
    /* Debounce to handle the rapid successive calls that follow a drag. */
    layoutSaveTimer = setTimeout(() => {
      window.oyen?.appConfig?.saveSettings?.(settings);
    }, 200);
  }
  mountSplitters({
    initial: { leftPaneWidth: layout.leftPaneWidth, treeHeight: layout.treeHeight },
    onChange: persistLayout
  });

  initI18n(settings.appearance?.language || 'en');

  /* When the main process requests SSH host key verification, show a dialog and respond. */
  window.oyen?.hostVerify?.onRequest(async (payload) => {
    const result = await confirmHostKey(payload);
    window.oyen.hostVerify.respond({ reqId: payload.reqId, decision: result.decision, remember: result.remember });
  });

  const statusBar = createStatusBar(document.getElementById('statusBar'));
  const breadcrumb = createBreadcrumb(document.getElementById('breadcrumbBar'));

  let syncDirEnabled = !!settings.ui?.syncDirectory;
  let syncSearchOnTabActivate = null;  // Filled in after searchUI is created (avoids const TDZ)

  /* Recent folders / files LRU — initialized first since mountEditor callbacks reference them. */
  const trackerCtx = {
    getSettings: () => settings,
    saveSettings: (s) => window.oyen?.appConfig?.saveSettings?.(s)
  };
  const recentFolders = createRecentFolders(trackerCtx);
  const recentFiles = createRecentFiles(trackerCtx);

  const syntaxColorsRef = { current: settings.syntaxColors || {} };
  const editor = mountEditor('editorRoot', settings.editor || {}, {
    onStatusChange: (s) => { statusBar.setStatus(s); breadcrumb.setPath(s?.path || '', tree.getRootPath?.() || ''); },
    onCursorChange: (text) => statusBar.setCursor(text),
    onSymbolChange: (arr) => breadcrumb.setSymbols(arr),
    onHistoryChange: ({ canUndo, canRedo }) => {
      document.getElementById('toolUndo')?.classList.toggle('can-act', canUndo);
      document.getElementById('toolRedo')?.classList.toggle('can-act', canRedo);
    },
    onTabActivate: (path) => {
      syncSearchOnTabActivate?.();  // If the strip is open, reapply search highlights/counts to the new tab
      if (!syncDirEnabled || !path) return;
      /* Directory sync — reveal within the same root, or switch roots when different (local <-> remote, etc.). Shared with reveal-in-tree. */
      revealInTreeRooted(path);
    },
    onFileOpened: (path, name) => {
      recentFiles?.record?.({ path, name });
    },
    onRevealInTree: (path) => revealInTreeRooted(path),
    onFileSaved: () => gitStore.refresh(),
    getGitRoot: () => gitStore.getRootPath(),
    /* Find/replace from the right-click context menu — searchUI is created below, but these fire on user click, so it's safe. */
    onFind: () => searchUI.openFind(),
    onReplace: () => searchUI.openReplace()
  }, syntaxColorsRef);

  const settingsModal = mountEditorSettingsModal({
    getEditor: () => editor?.instance || null,
    getSettings: () => settings,
    saveSettings: async (nextSettings) => {
      settings = nextSettings;
      if (window.oyen?.appConfig?.saveSettings) {
        await window.oyen.appConfig.saveSettings(nextSettings);
      }
    },
    getSyntaxColors: () => syntaxColorsRef.current,
    onSyntaxColorsChange: async (nextSyntaxColors) => {
      syntaxColorsRef.current = nextSyntaxColors;
      editor?.applySyntaxColors?.(nextSyntaxColors);
      settings = { ...settings, syntaxColors: nextSyntaxColors };
      if (window.oyen?.appConfig?.saveSettings) {
        await window.oyen.appConfig.saveSettings(settings);
      }
    },
    onEditorOptionsChange: (nextOptions) => {
      editor?.applyEditorOptions?.(nextOptions);
    }
  });

  async function openLocalFolder() {
    const result = await window.oyen.localFs.pickDirectory(tree.getRootPath?.());
    if (result?.ok && result.path) {
      const baseName = result.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || result.path;
      await runBusy(() => tree.refreshTree(result.path, result.path, baseName, 'top'));
      setGitRoot(result.path);
      recentFolders.record({ treeRootPath: result.path, expandPath: result.path, label: baseName });
    }
  }

  /* Open a remote folder as the tree root. The chosen folder = tree root = git root (same rule as opening a local folder). */
  async function openRemoteFolder(uri) {
    /* Subfolders use the folder name; the root uses '/'. (uriPathBasename returns '/' for the root.) */
    const label = uriPathBasename(uri);
    await runBusy(() => tree.refreshTree(uri, uri, label, 'top'));
    setGitRoot(uri);
    recentFolders.record({ treeRootPath: uri, expandPath: uri, label });
  }

  /* Store the last opened folder path per profile (keyed by profile id — won't get tangled with other profiles).
     profile is a live reference into settings.projects, so mutate it directly and then save. */
  function rememberProfilePath(profile, uri) {
    if (!profile) return;
    let path;
    try { path = decodeURIComponent(new URL(uri).pathname || '/') || '/'; } catch { return; }
    if (profile.lastPath === path) return;
    profile.lastPath = path;
    window.oyen?.appConfig?.saveSettings?.(settings).catch(() => {});
  }

  /* Browse a remote profile to pick a folder → open that folder and remember lastPath.
     fromHome=true (open folder): ignore the directory setting and browse from the user's home (for servers that block listing '/').
     Default: start from lastPath/defaultPath. */
  async function openRemoteFolderViaPicker(profile, { fromHome = false } = {}) {
    if (!profile || !isRemoteProject(profile)) return;
    try {
      const uri = await openRemoteFolderPicker({
        profile,
        authority: remoteAuthority(profile),
        startPath: fromHome ? '' : (profile.lastPath || profile.defaultPath || ''),
        preferHome: fromHome,
        listDir: (u) => window.oyen.localFs.listChecked(u),
        connect: (a) => window.oyen.remote.resolveHome(a)
      });
      if (uri) { await openRemoteFolder(uri); rememberProfilePath(profile, uri); }
    } catch (err) {
      await notifyAlert(friendlyConnectError(err?.message || String(err)));
    }
  }

  /* Clicking a site in the site list: always show the folder-open picker (browse from '/'). Does not auto-open lastPath
     (opening a saved folder directly is the project panel's responsibility). */
  async function openRemoteSite(profile) {
    if (!profile || !isRemoteProject(profile)) return;
    await openRemoteFolderViaPicker(profile, { fromHome: true });
  }

  /* Open folder (Ctrl+O): if any remote profiles are registered, show the "This Computer / Remote Profile" chooser; otherwise go straight to local. */
  async function openFolderPicker() {
    const remotes = (settings.projects || []).filter((p) => isRemoteProject(p) && !p.derivedRemote && (p.type === 'sftp' || p.type === 'ftp'));
    if (!remotes.length) { await openLocalFolder(); return; }
    const choice = await openFolderSourceChooser({ remoteProjects: remotes });
    if (!choice) return;
    if (choice.type === 'local') { await openLocalFolder(); return; }
    /* Open folder is the path for switching folders — ignore the directory setting and browse from the user's home. */
    await openRemoteFolderViaPicker(choice.profile, { fromHome: true });
  }

  async function openFilePicker() {
    const result = await window.oyen.localFs.pickFile({ defaultPath: tree.getRootPath?.() || '' });
    if (result?.ok && result.path) {
      const fileName = result.path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || result.path;
      await editor?.openFile?.(result.path, fileName);
    }
  }

  /* Drop external (OS) files onto the editor area → open them as local files (convenience). Folders are ignored (files only).
     Handle this in the capture phase so CM6 can't intercept the file drop and insert the path as text. Only intercept 'Files' drags, leaving internal text drags alone. */
  function wireEditorDrop() {
    const dropZone = document.getElementById('rightTop');
    if (!dropZone) return;
    const hasOsFiles = (dt) => Array.from(dt?.types || []).includes('Files');
    dropZone.addEventListener('dragover', (event) => {
      if (!hasOsFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'copy';
      dropZone.classList.add('editor-drop-over');
    }, true);
    dropZone.addEventListener('dragleave', (event) => {
      /* Ignore dragleave when moving onto a child — only clear when leaving the container entirely. */
      if (event.relatedTarget && dropZone.contains(event.relatedTarget)) return;
      dropZone.classList.remove('editor-drop-over');
    });
    dropZone.addEventListener('drop', async (event) => {
      if (!hasOsFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      dropZone.classList.remove('editor-drop-over');
      const paths = [];
      for (const it of Array.from(event.dataTransfer.items || [])) {
        if (it.kind !== 'file') continue;
        if (it.webkitGetAsEntry?.()?.isDirectory) continue; // Don't open folders in the editor
        const file = it.getAsFile?.();
        if (!file) continue;
        let p = '';
        try { p = window.oyen?.getPathForFile?.(file) || ''; } catch (_) {}
        if (p) paths.push(p);
      }
      for (const p of paths) {
        const name = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
        await editor?.openFile?.(p, name);
      }
    }, true);
  }
  wireEditorDrop();

  let quitting = false;
  async function quitFlow({ skipPrompt = false } = {}) {
    if (quitting) return;
    quitting = true;
    try {
      if (editor?.hasDirty?.()) {
        if (skipPrompt) {
          await editor.saveAll();
        } else {
          const choice = await confirmDirtyClose();
          if (choice === 'cancel') { quitting = false; return; }
          if (choice === 'save') await editor.saveAll();
        }
      }
      await window.oyen?.app?.quit?.();
    } catch (_) {
      quitting = false;
    }
  }
  window.oyen?.app?.onRequestQuit?.(() => quitFlow());

  /* oyen-quick:// deep link — find the remote server profile by apiKey and open path as the tree root (shared quick open). */
  async function handleQuickLink(link) {
    const key = (link?.key || '').trim();
    if (!key) return;
    /* Report quick-open failures with a single message regardless of the cause (missing key/path/folder/connection, etc.). */
    const fail = () => notifyAlert(t('quicklink.title'), t('quicklink.error.cantOpen'));
    const profile = (settings.projects || []).find((p) => isRemoteProject(p) && (p.apiKey || '').trim() === key);
    if (!profile) { fail(); return; }
    let rel = (link.path || '').trim();
    if (!rel) { fail(); return; }
    if (!rel.startsWith('/')) rel = `/${rel}`;
    const uri = `${remoteAuthority(profile)}${rel}`;  // Append the raw path, same as remoteUri
    const dirUri = dirname(uri);
    const name = folderBasename(uri);
    try {
      /* Only open when it's a file — list the parent folder and confirm the name is of type file (reject folders/missing). */
      const res = await runBusy(() => window.oyen.localFs.listChecked(dirUri));
      if (!res?.ok) { fail(); return; }
      const entry = (res.entries || []).find((e) => e.name === name);
      if (!entry || entry.type !== 'file') { fail(); return; }
      /* Quick open = open file — open the file in the editor and show its location in the tree (folder tree + file). */
      editor.openFile(uri, name);
      await revealInTreeRooted(uri);
    } catch (err) {
      fail();
    }
  }
  window.oyen?.deeplink?.onOpen?.(handleQuickLink);
  try { const pendingLink = await window.oyen?.deeplink?.getPending?.(); if (pendingLink) handleQuickLink(pendingLink); } catch (_) {}

  /* Simple helper that shortens a string with … in the middle — exposing only as much as fits a menu row's width. */
  function middleEllipsis(str, max = 48) {
    const s = String(str || '');
    if (s.length <= max) return s;
    const half = Math.floor((max - 1) / 2);
    return `${s.slice(0, half)}…${s.slice(s.length - (max - 1 - half))}`;
  }
  function parentPath(p) {
    return String(p || '').replace(/[\\/][^\\/]*$/, '') || p;
  }

  function buildRecentFolderItems() {
    return recentFolders.list().map((entry, idx) => ({
      text: entry.label || entry.treeRootPath,
      subtext: middleEllipsis(entry.treeRootPath, 48),
      fullPath: entry.treeRootPath,
      action: `__recentFolder__${idx}`
    }));
  }
  function buildRecentFileItems() {
    return recentFiles.list().map((entry, idx) => ({
      text: entry.name || entry.path,
      subtext: middleEllipsis(parentPath(entry.path), 48),
      fullPath: entry.path,
      action: `__recentFile__${idx}`
    }));
  }

  async function jumpRecentFolder(entry) {
    try {
      await runBusy(() => tree.refreshTree(entry.treeRootPath, entry.expandPath || entry.treeRootPath, entry.label || entry.treeRootPath, 'top'));
      setGitRoot(entry.treeRootPath);
      await recentFolders.record(entry);
    } catch (err) {
      await notifyAlert(friendlyConnectError(err?.message || String(err)));
    }
  }
  async function jumpRecentFile(entry) {
    try {
      await editor?.openFile?.(entry.path, entry.name);
    } catch (err) {
      await notifyAlert(friendlyConnectError(err?.message || String(err)));
    }
  }

  mountMenus(document.getElementById('menubar'), getTopMenus({
    getRecentFolderItems: buildRecentFolderItems,
    getRecentFileItems: buildRecentFileItems
  }), {
    onAction: async (action) => {
      if (typeof action === 'string' && action.startsWith('__recentFolder__')) {
        const idx = Number(action.slice('__recentFolder__'.length));
        const entry = recentFolders.list()[idx];
        if (entry) await jumpRecentFolder(entry);
        return;
      }
      if (typeof action === 'string' && action.startsWith('__recentFile__')) {
        const idx = Number(action.slice('__recentFile__'.length));
        const entry = recentFiles.list()[idx];
        if (entry) await jumpRecentFile(entry);
        return;
      }
      if (typeof action === 'string' && action.startsWith('setLanguage:')) {
        const lang = action.slice('setLanguage:'.length);
        if (SUPPORTED_LANGUAGES.includes(lang) && lang !== getLanguage()) {
          settings.appearance = { ...(settings.appearance || {}), language: lang };
          await window.oyen?.appConfig?.saveSettings?.(settings);
          const ok = await confirmReload(
            t('settings.language.reloadTitle'),
            t('settings.language.reloadMessage'),
            t('settings.language.reloadConfirm'),
            t('settings.language.reloadCancel')
          );
          if (ok) location.reload();
        }
        return;
      }
      if (action === 'openSettings') settingsModal.open();
      if (action === 'exportSettings') await exportSettingsFlow();
      if (action === 'importSettings') await importSettingsFlow();
      if (action === 'openFolder') await openFolderPicker();
      if (action === 'openFile') await openFilePicker();
      if (action === 'newFile') await tree?.createFileInActiveDir?.();
      if (action === 'newWindow') await window.oyen?.app?.openNewWindow?.();
      if (action === 'save') await editor?.saveActive?.();
      if (action === 'saveAs') await editor?.saveAsActive?.();
      if (action === 'saveAll') await editor?.saveAll?.();
      if (action === 'closeTab') editor?.closeActive?.();
      if (action === 'closeOthers') await editor?.closeOthers?.();
      if (action === 'closeAll') await editor?.closeAll?.();
      if (action === 'undo') editor?.undo?.();
      if (action === 'redo') editor?.redo?.();
      if (action === 'cut') await editor?.cut?.();
      if (action === 'copy') await editor?.copy?.();
      if (action === 'paste') await editor?.paste?.();
      if (action === 'deleteSelection') editor?.deleteSelection?.();
      if (action === 'find') searchUI.openFind();
      if (action === 'replace') searchUI.openReplace();
      if (action === 'findSelection') searchUI.findSelection();
      if (action === 'findSelectionPrev') searchUI.findSelectionPrev();
      if (action === 'gotoBracket') editor?.gotoBracket?.();
      if (action === 'quit') await quitFlow();
      if (action === 'saveAndQuit') await quitFlow({ skipPrompt: true });
      if (action === 'addRemoteProject') {
        /* Connection profiles don't appear in the project panel, only in the site list — don't switch to the panel. */
        await projectPanel?.addRemote();
      }
      if (action === 'manageRemoteProjects') {
        openSiteManager({
          getProjects: () => settings.projects || [],
          isRemote: isRemoteProject,
          onOpen: (idx) => openRemoteSite((settings.projects || [])[idx]),
          onEdit: (idx) => projectPanel?.editRemoteAt(idx),
          onRemove: (idx) => projectPanel?.removeAt(idx, { isSite: true }),
          onAdd: () => projectPanel?.addRemote()
        });
      }
    }
  });

  let rootSelectApi = null;
  let terminalPanel = null;
  const leftPane = document.getElementById('leftPane');
  const projectListEl = document.getElementById('projectListRoot');
  const gitPanelRoot = document.getElementById('gitPanelRoot');

  const gitStore = createGitStatusStore({ intervalMs: 5000 });
  /* Git is active for local + SFTP only. FTP (no shell exec) passes an empty string — the store treats it as status=null.
     SFTP dispatches to the ssh-exec-based remote git service (git-ipc routes by prefix). */
  /* Tree root URI → connection badge info. The sftp/ftps/ftp scheme means remote (extract host); otherwise local. */
  function parseConnection(rootPath) {
    const m = String(rootPath || '').match(/^(sftp|ftps|ftp):\/\/(?:[^@/]+@)?([^:/]+)/i);
    return m ? { kind: m[1].toLowerCase(), host: m[2] } : { kind: 'local' };
  }
  function setGitRoot(path) {
    const supported = !!path && !/^(ftp|ftps):\/\//i.test(path);
    gitStore.setRoot(supported ? path : '');
    statusBar.setConnection(parseConnection(path));
  }

  const tree = mountFileTree({
    treeRoot: document.getElementById('treeRoot'),
    fileListRoot: document.getElementById('fileListRoot'),
    onFileOpen: (filePath, fileName) => editor?.openFile(filePath, fileName),
    onFileClose: (filePath) => editor?.closeByPath?.(filePath),
    onFileRename: (oldPath, newPath, newName) => editor?.renameTab?.(oldPath, newPath, newName),
    onFolderRename: (oldPath, newPath) => editor?.renamePathPrefix?.(oldPath, newPath),
    onPathChange: (dirPath) => {
      statusBar.setStatus({ path: dirPath || '', meta: '' });
    },
    /* Local receives {name, path}; remote receives the full profile object ({id, type, host, ...defaultPath}) as-is. */
    onProjectAdd: (project) => {
      if (!project) return;
      settings.projects = Array.isArray(settings.projects) ? settings.projects.slice() : [];
      settings.projects.push(project);
      rebuildRootOptionsFromSettings();
      rootSelectApi?.setOptions(rootOptions, rootSelectApi.getKey());
      projectPanel?.renderList();
    },
    openTerminalAt: (path) => terminalPanel?.openTerminalAt(path),
    onSaveAs: () => editor?.saveAsActive?.(),
    onTreeRefresh: () => gitStore.refresh(),
    /* Reveal file (active file) — shares the same single entry point as the toolbar button. */
    onRevealActiveFile: () => revealActiveFile(),
    getActiveEditorPath: () => editor?.getActiveFilePath?.() || ''
  });

  if (gitPanelRoot) {
    mountGitPanel({
      root: gitPanelRoot,
      store: gitStore,
      onOpenFile: async (filePath, fileName, rel) => {
        /* A git-changed file = open in diff view. Query git.diff(hunks) → editor.openDiff. On empty diff (untracked, etc.)/failure, fall back to a normal open. */
        try {
          const root = gitStore.getRootPath?.();
          if (root && rel) {
            const r = await window.oyen.git.diff(root, rel);
            const hunks = r?.ok ? (r.data?.hunks || []) : [];
            if (hunks.length) { editor?.openDiff?.(filePath, fileName, hunks); return; }
          }
        } catch (_) {}
        editor?.openFile?.(filePath, fileName);
      },
      /* Right after discard the working tree is restored to its git state → force-reload the open tab (no prompt even if dirty — the user explicitly chose discard). */
      onFileChangedOnDisk: (filePath) => editor?.reloadByPath?.(filePath, { force: true })
    });
  }
  const gitTabEl = document.querySelector('.left-tab[data-left-tab="git"]');
  const gitTabBadge = gitTabEl?.querySelector('.left-tab-badge');
  gitStore.subscribe((snapshot) => {
    tree.applyGitStatus(snapshot);
    const isRepo = !!(snapshot && snapshot.isRepo);
    if (gitTabEl) gitTabEl.hidden = !isRepo;
    /* git tab badge = number of changed files (VSCode Source Control badge). Hidden when 0. */
    if (gitTabBadge) {
      const n = isRepo && Array.isArray(snapshot.files) ? snapshot.files.length : 0;
      gitTabBadge.textContent = n > 99 ? '99+' : String(n);
      gitTabBadge.hidden = n === 0;
    }
    /* If the user is viewing the git tab and the folder becomes a non-repo, fall back to the directory tab. */
    if (!isRepo && leftPane?.dataset.view === 'git') {
      setLeftView('directory');
    }
  });
  gitStore.start();
  /* Refresh git status immediately when the window regains focus (reflecting external/agent changes); pause polling on blur. */
  window.addEventListener('focus', () => gitStore.setActive(true));
  window.addEventListener('blur', () => gitStore.setActive(false));

  const refreshBtn = document.getElementById('refreshActiveView');
  document.querySelectorAll('[data-tabler-icon]').forEach((button) => {
    button.innerHTML = toolbarIcons[button.dataset.tablerIcon] || '';
  });
  if (refreshBtn) refreshBtn.innerHTML = tablerRefreshIcon;
  refreshBtn?.addEventListener('click', () => runBusy(() => tree.refreshCurrent()));

  document.getElementById('toolNewFile')?.addEventListener('click', () => tree.createFileInActiveDir());
  document.getElementById('toolOpenFolder')?.addEventListener('click', () => openFolderPicker());
  document.getElementById('toolSave')?.addEventListener('click', () => editor?.saveActive?.());
  document.getElementById('toolSaveAll')?.addEventListener('click', () => editor?.saveAll?.());
  document.getElementById('toolUndo')?.addEventListener('click', () => editor?.undo?.());
  document.getElementById('toolRedo')?.addEventListener('click', () => editor?.redo?.());
  document.getElementById('toolReload')?.addEventListener('click', () => editor?.reloadActive?.());
  document.getElementById('toolRevealFile')?.addEventListener('click', () => revealActiveFile());

  /* Clipboard/delete: preventDefault on mousedown to keep editor focus, then manipulate the selection. */
  const clipboardButtons = [
    { id: 'toolDelete', run: () => editor?.deleteSelection?.() },
    { id: 'toolCut', run: () => editor?.cut?.() },
    { id: 'toolCopy', run: () => editor?.copy?.() },
    { id: 'toolPaste', run: () => editor?.paste?.() }
  ];
  for (const { id, run } of clipboardButtons) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => { run(); });
  }

  const syncDirBtn = document.getElementById('toolSyncDirectory');
  function updateSyncDirButton() {
    if (!syncDirBtn) return;
    syncDirBtn.setAttribute('aria-pressed', syncDirEnabled ? 'true' : 'false');
  }
  updateSyncDirButton();
  syncDirBtn?.addEventListener('click', () => applyToggle('syncDir'));

  const splitBtn = document.getElementById('splitEditorBtn');
  splitBtn?.addEventListener('click', () => {
    if (!editor?.isTextActive?.()) return;
    editor.toggleSplit();
  });

  /* Font size ± buttons (toolbar) */
  const fontMinusBtn = document.getElementById('toolFontMinus');
  const fontPlusBtn = document.getElementById('toolFontPlus');
  const fontSizeLabel = document.getElementById('fontSizeLabel');
  const FONT_MIN = 10;
  const FONT_MAX = 40;
  function applyFontSize(next) {
    const clamped = Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(next)));
    settings.editor = { ...(settings.editor || {}), fontSize: clamped };
    if (fontSizeLabel) fontSizeLabel.textContent = String(clamped);
    editor?.applyEditorOptions?.(settings.editor);
    if (window.oyen?.appConfig?.saveSettings) {
      window.oyen.appConfig.saveSettings(settings).catch(() => {});
    }
  }
  if (fontSizeLabel) fontSizeLabel.textContent = String(settings.editor?.fontSize || 14);
  fontMinusBtn?.addEventListener('click', () => applyFontSize((settings.editor?.fontSize || 14) - 1));
  fontPlusBtn?.addEventListener('click', () => applyFontSize((settings.editor?.fontSize || 14) + 1));

  /* Word wrap toggle (toolbar) */
  const wordWrapBtn = document.getElementById('toolWordWrap');
  function refreshWordWrapBtn() {
    if (!wordWrapBtn) return;
    const on = settings.editor?.wordWrap === 'on';
    wordWrapBtn.setAttribute('aria-pressed', String(on));
  }
  refreshWordWrapBtn();
  wordWrapBtn?.addEventListener('click', () => applyToggle('wordWrap'));

  /* Minimap toggle */
  const minimapBtn = document.getElementById('toolMinimap');
  function refreshMinimapBtn() {
    if (!minimapBtn) return;
    const on = settings.editor?.minimap !== false;
    minimapBtn.setAttribute('aria-pressed', String(on));
  }
  refreshMinimapBtn();
  minimapBtn?.addEventListener('click', () => applyToggle('minimap'));

  /* Shared toggle — all toolbar buttons route through this one function. Single point for state/editor/button/save (no tangling). */
  function applyToggle(name) {
    if (name === 'syncDir') {
      syncDirEnabled = !syncDirEnabled;
      updateSyncDirButton();
      settings.ui = { ...(settings.ui || {}), syncDirectory: syncDirEnabled };
      if (syncDirEnabled) {
        const path = editor?.getActiveFilePath?.();
        if (path) tree?.revealPath?.(path);
      }
    } else if (name === 'wordWrap' || name === 'minimap') {
      if (name === 'wordWrap') {
        const on = settings.editor?.wordWrap === 'on';
        settings.editor = { ...(settings.editor || {}), wordWrap: on ? 'off' : 'on' };
      } else {
        const on = settings.editor?.minimap !== false;
        settings.editor = { ...(settings.editor || {}), minimap: !on };
      }
      editor?.applyEditorOptions?.(settings.editor);
      refreshWordWrapBtn();
      refreshMinimapBtn();
    } else {
      return;
    }
    if (window.oyen?.appConfig?.saveSettings) {
      window.oyen.appConfig.saveSettings(settings).catch(() => {});
    }
  }

  terminalPanel = mountTerminalPanel({ tree, persistLayout, initialHeight: layout.terminalHeight });

  /* Editor Ctrl+click file path link: resolve the relative/path against the active file → open if it exists, otherwise notify. */
  function normPath(p) {
    const drive = (p.match(/^([a-zA-Z]:)/) || [])[1] || '';
    const body = drive ? p.slice(drive.length) : p;
    const abs = body.startsWith('/');
    const out = [];
    for (const s of body.split('/')) {
      if (!s || s === '.') continue;
      if (s === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs && !drive) out.push('..'); }
      else out.push(s);
    }
    return drive + (abs || drive ? '/' : '') + out.join('/');
  }
  function resolveSiblingPath(baseFile, rel) {
    rel = String(rel || '').replace(/^['"`]+|['"`]+$/g, '').trim();
    if (!rel || !baseFile) return '';
    const remote = baseFile.match(/^([a-z][a-z0-9+.-]*:\/\/[^/]*)(\/.*)?$/i);
    if (remote) {
      const dir = (remote[2] || '/').replace(/\/[^/]*$/, '') || '';
      return remote[1] + normPath(rel.startsWith('/') ? rel : `${dir}/${rel}`);
    }
    const win = /^[a-zA-Z]:/.test(baseFile) || baseFile.includes('\\');
    const baseN = baseFile.replace(/\\/g, '/');
    const relN = rel.replace(/\\/g, '/');
    const isAbs = /^([a-zA-Z]:)?\//.test(relN);
    const dir = baseN.replace(/\/[^/]*$/, '');
    let res = normPath(isAbs ? relN : `${dir}/${relN}`);
    if (win) res = res.replace(/\//g, '\\');
    return res;
  }
  setFileLinkHandler(async (rawPath) => {
    const target = resolveSiblingPath(editor?.getActiveFilePath?.() || '', rawPath);
    if (!target) return;
    let found = false;
    try { found = !!(await window.oyen.localFs.exists(target))?.exists; } catch (_) {}
    if (!found) { notifyAlert(t('link.fileNotFound'), t('dlg.notice'), rawPath); return; }
    editor.openFile(target, folderBasename(target));
  });

  /* Search/replace strip — operates over the active EditorView (the focused pane when split). */
  const searchUI = mountSearchUI({
    host: document.getElementById('rightTop'),
    getView: () => editor.instance?.activeView?.() || editor.instance?.view || null
  });
  syncSearchOnTabActivate = () => searchUI.refresh();  // Sync search highlights on tab switch

  const shortcutHandlers = {
    save: () => editor?.saveActive?.(),
    closeTab: () => editor?.closeActive?.(),
    reloadFile: () => editor?.reloadActive?.(),
    selectAll: () => {
      if (tree?.isFileListFocused?.()) {
        tree.selectAllFileRows();
        return;
      }
      editor?.selectAllText?.();
    },
    deleteLine: () => editor?.deleteLine?.(),
    newFile: () => tree?.createFileInActiveDir?.(),
    openFolder: () => openFolderPicker(),
    saveAs: () => editor?.saveAsActive?.(),
    toggleTerminal: () => terminalPanel?.toggle(),
    moveLineUp: () => editor?.moveLineUp?.(),
    moveLineDown: () => editor?.moveLineDown?.(),
    copyLineUp: () => editor?.copyLineUp?.(),
    copyLineDown: () => editor?.copyLineDown?.(),
    gotoBracket: () => editor?.gotoBracket?.(),
    toggleComment: () => editor?.toggleComment?.(),
    fold: () => editor?.fold?.(),
    unfold: () => editor?.unfold?.(),
    foldAll: () => editor?.foldAll?.(),
    unfoldAll: () => editor?.unfoldAll?.(),
    selectAllMatches: () => editor?.selectAllMatches?.(),
    upperCase: () => editor?.upperCase?.(),
    lowerCase: () => editor?.lowerCase?.(),
    gotoLine: async () => {
      const info = editor?.getLineInfo?.();
      if (!info) return; // Ignore if not a text tab
      const line = await promptGoToLine(info.total, info.current);
      if (line) editor.gotoLine(line);
    },
    find: () => searchUI.openFind(),
    replace: () => searchUI.openReplace(),
    findSelection: () => searchUI.findSelection(),
    findSelectionPrev: () => searchUI.findSelectionPrev(),
    rename: () => tree?.renameActive?.()
  };
  let shortcutsRecording = false;
  mountShortcuts({
    getConfig: () => ({ ...DEFAULT_SHORTCUTS, ...(settings.shortcuts || {}) }),
    getHandlers: () => shortcutHandlers,
    isActive: () => !shortcutsRecording && !isBusy()
  });
  window.__oyenShortcutRecorder = {
    start: () => { shortcutsRecording = true; },
    stop: () => { shortcutsRecording = false; }
  };


  const rootInfo = await window.oyen.localFs.getDefaultRoot();
  const rootSelectEl = document.getElementById('pathRootSelect');
  var rootOptions = (Array.isArray(rootInfo.roots) && rootInfo.roots.length
    ? rootInfo.roots
    : [{ key: 'default', label: rootInfo.root, path: rootInfo.root }])
    /* Give non-project local roots (drives/Desktop/Documents) a folder icon too. */
    .map((r) => ({ ...r, icon: r.icon || FOLDER_ICON_CLOSED }));

  rebuildRootOptionsFromSettings();

  const initialRootOption = rootOptions.find((item) => item.key === 'desktop')
    || rootOptions.find((item) => item.path === rootInfo.root)
    || rootOptions[0];
  const initialTreeRootPath = initialRootOption.treeRootPath || initialRootOption.path;
  const initialTreeRootOption = rootOptions.find((item) => item.path === initialTreeRootPath);
  /* Don't record the initial boot root in recents — only count it when the user explicitly opens a folder or changes the root. */
  await tree.refreshTree(
    initialTreeRootPath,
    initialRootOption.path,
    initialTreeRootOption?.treeLabel || initialTreeRootOption?.label || initialRootOption.treeLabel || initialRootOption.label || initialTreeRootPath,
    'top'
  );

  /* Reveal the active editor file in the tree — a single entry point shared by the toolbar button and file-list context menu.
     No-op when no file is open (same behavior as the tab right-click 'Reveal File'). */
  function revealActiveFile() {
    const path = editor?.getActiveFilePath?.();
    if (path) revealInTreeRooted(path);
  }

  /* Reveal a file location in the tree — expand in place within the same root, or switch roots when different (local <-> remote, etc.).
     Shared by directory sync (onTabActivate) and reveal file (onRevealInTree). */
  async function revealInTreeRooted(path) {
    if (!path) return;
    /* The tree isn't visible in the project/git views, so switch to the directory view. */
    setLeftView('directory');
    const dir = dirname(path);
    if (!dir) return;
    const root = tree.getRootPath?.() || '';
    const underRoot = root && normalizePath(dir).startsWith(normalizePath(root));
    /* Root option to use: a registered project (longest match) first, otherwise the filesystem root (C:\ · /). */
    const key = rootKeyForPath(path);
    const opt = key ? rootOptions.find((o) => o.key === key) : null;
    const targetRoot = opt ? (opt.treeRootPath || opt.path) : '';
    const alreadyThere = targetRoot && normalizePath(targetRoot) === normalizePath(root);
    if (key && !alreadyThere) {
      /* Switch to the project/drive root (also sync the dropdown). */
      rootSelectApi?.setActive(key);
      await applyRoot(key, 'active');
    } else if (!key && !underRoot) {
      /* No matching option and outside the current root (e.g. a non-project remote) → use the file's folder directly as the root. */
      await runBusy(() => tree.refreshTree(dir, dir, folderBasename(dir), 'active'));
      setGitRoot(dir);
    }
    await tree.revealPath(path);
  }

  async function applyRoot(key, scrollMode = 'active') {
    const selectedRoot = rootOptions.find((item) => item.key === key);
    if (!selectedRoot) return;
    await runBusy(async () => {
      let treeRootPath = selectedRoot.treeRootPath || selectedRoot.path;
      let expandPath = selectedRoot.path;
      let remoteLabel = '';
      if (key.startsWith('project:')) {
        /* Match by id — selects exactly that project regardless of duplicate names (e.g. sharing a site's name).
           Connection profiles never create a project: option to begin with, so their id will never arrive as a key. */
        const profile = (settings.projects || []).find((p) => `project:${p.id}` === key);
        if (profile && isRemoteProject(profile)) {
          /* If defaultPath is set, use that folder as the tree root → git root can be determined (.git check).
             Otherwise, browse from the server root ('/') (git disabled). */
          const dp = (profile.defaultPath || '').trim();
          if (dp) {
            treeRootPath = remoteUri(profile);
            expandPath = treeRootPath;
          } else {
            treeRootPath = getRemoteTreeRoot(profile);
            expandPath = await getRemoteExpandPath(profile);
            remoteLabel = '/';
          }
        }
      }
      const treeRootOption = rootOptions.find((item) => item.path === treeRootPath);
      const label = remoteLabel
        || treeRootOption?.treeLabel
        || treeRootOption?.label
        || selectedRoot?.treeLabel
        || selectedRoot?.label
        || treeRootPath;
      await tree.refreshTree(treeRootPath, expandPath, label, scrollMode);
      setGitRoot(treeRootPath);
      /* For the recents menu label, prefer the more intuitive selectedRoot.label (e.g. "Desktop", project name). */
      recentFolders.record({
        treeRootPath,
        expandPath,
        label: selectedRoot.label || label
      });
    });
    terminalPanel?.refreshAvailability();
  }

  /* Root option key to hold a file: a registered project (longest path match) first, otherwise the filesystem root (C:\ · /) option. null if none. */
  function rootKeyForPath(filePath) {
    const np = normalizePath(filePath);
    const projectMatch = rootOptions
      .filter((o) => String(o.key).startsWith('project:') && o.path)
      .filter((o) => np.startsWith(normalizePath(o.path)))
      .sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)[0];
    if (projectMatch) return projectMatch.key;
    const fsRoot = filesystemRootOf(filePath);
    if (!fsRoot) return null;
    return rootOptions.find((o) => o.path && normalizePath(o.path) === normalizePath(fsRoot))?.key || null;
  }

  /* Filesystem root of a local path: Windows 'C:\', POSIX '/'. null for remote URIs or when undeterminable. */
  function filesystemRootOf(p) {
    const s = String(p || '');
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(s)) return null;
    const win = /^([a-zA-Z]:)[\\/]/.exec(s);
    if (win) return `${win[1]}\\`;
    if (s.startsWith('/')) return '/';
    return null;
  }

  function rebuildRootOptionsFromSettings() {
    const nonProject = rootOptions.filter((o) => !String(o.key).startsWith('project:'));
    const projects = settings.projects || [];
    /* Use settings.projects order as-is — so a panel reorder is reflected in the root selector too. */
    const projectOpts = projects.map((p) => {
      if (isLocalProject(p)) {
        return {
          key: `project:${p.id}`,
          label: p.name,
          treeLabel: folderBasename(p.path),
          path: p.path,
          icon: FOLDER_ICON_CLOSED
        };
      }
      /* Only folder projects (derivedRemote) become root options. Pure connection profiles are excluded from the dropdown too
         (reachable only by opening a folder from the site list). */
      if (isRemoteProject(p) && p.derivedRemote && (p.type === 'sftp' || p.type === 'ftp')) {
        const uri = remoteUri(p);
        return {
          key: `project:${p.id}`,
          label: p.name,
          /* The tree root label is the actual folder name (same as local/picker opens). Not the project name (p.name). */
          treeLabel: uriPathBasename(uri),
          path: uri,
          treeRootPath: uri,
          icon: iconProjectRemote
        };
      }
      return null;
    }).filter(Boolean);
    rootOptions.length = 0;
    rootOptions.push(...nonProject, ...projectOpts);
  }

  async function persistProjects(activeKeyOverride) {
    await window.oyen.appConfig.saveSettings(settings);
    rebuildRootOptionsFromSettings();
    rootSelectApi?.setOptions(rootOptions, activeKeyOverride ?? rootSelectApi.getKey());
    projectPanel?.renderList();
  }

  const projectPanel = createProjectPanel({
    el: projectListEl,
    getSettings: () => settings,
    saveAndRefresh: (activeKeyOverride) => persistProjects(activeKeyOverride),
    remoteApi: window.oyen?.remote,
    isRootActiveKey: (key) => rootSelectApi?.getKey() === key,
    pickFallbackRootKey: () => rootOptions.find((o) => !String(o.key).startsWith('project:'))?.key,
    applyRoot: (key, mode) => applyRoot(key, mode)
  });

  function setLeftView(view) {
    if (!leftPane) return;
    leftPane.dataset.view = view;
    document.querySelectorAll('.left-tab').forEach((t) => t.classList.toggle('active', t.dataset.leftTab === view));
    if (view === 'project') projectPanel.renderList();
  }

  document.querySelectorAll('.left-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const target = tab.dataset.leftTab;
      if (!target) return;
      setLeftView(target);
    });
  });

  rootSelectApi = mountRootSelect(rootSelectEl, {
    options: rootOptions,
    initialKey: initialRootOption.key,
    onChange: (key) => applyRoot(key, 'active')
  });

  terminalPanel?.refreshAvailability();
  createIcons({ icons });
}

bootstrap();
