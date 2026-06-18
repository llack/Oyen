import { EditorView } from '@codemirror/view';
import { undoDepth, redoDepth } from '@codemirror/commands';
import { createCm6Editor, createTabState, reconfigureSyntaxColors, reconfigureEditorOptions, indentDescriptor } from './cm6-mount.js';
import { symbolPath } from './cm6-breadcrumb.js';
import { createEditorSplit } from './editor-split.js';
import { createEditorPreview } from './editor-preview.js';
import { confirmDirtyClose, confirmReload, notifyAlert } from './dialogs.js';
import { t } from './i18n.js';
import { runBusy } from './busy-lock.js';
import { friendlyFsError } from './friendly-error.js';
import {
  isImage, isPdf, isVideo, isAudio, isMd,
  isOfficeDocument, isWindowsShortcut, isPrivateKey, isInstaller,
  typeLabelFromFile, formatFileSize, eolFromContent
} from './editor-file-types.js';
import { setDiffMarkers, hunksToMarkers } from './git-diff-gutter.js';

export function mountEditor(targetId, userOptions = {}, callbacks = {}, syntaxColorsRef = { current: {} }) {
  const target = document.getElementById(targetId);
  const tabsRoot = document.getElementById('editorTabs');
  const previewRoot = document.getElementById('imagePreviewRoot');
  const mdToolbar = document.getElementById('markdownToolbar');
  if (!target) return null;

  const primaryPane = document.createElement('div');
  primaryPane.className = 'editor-pane';
  target.appendChild(primaryPane);

  function createEditorInstance(host) {
    return createCm6Editor(host);
  }

  const editor = createEditorInstance(primaryPane);
  target.hidden = true;
  const editorSplit = createEditorSplit({
    host: target,
    primaryPane,
    primaryEditor: editor
  });

  const openTabs = [];
  let activeId = '';

  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  /* path is for the top breadcrumb only (the status bar shows meta only) — cleared for image viewer/markdown tabs, which are decided not to show the path. */
  const setStatus = (path, meta = []) => {
    const tab = openTabs.find((v) => v.id === activeId);
    const hidePath = tab && (tab.type === 'image' || tab.type === 'markdown');
    callbacks.onStatusChange?.({ path: hidePath ? '' : path, meta: Array.isArray(meta) ? meta.filter(Boolean) : [meta].filter(Boolean) });
  };
  /* Status bar indentation indicator (to the right of line/col). Tabs → "Tab size: {tabSize}", spaces → "Spaces: {count}". */
  const indentMeta = (content) => {
    const d = indentDescriptor(content || '', userOptions);
    return d.tab
      ? `${t('status.indentTab')}: ${Number(userOptions.tabSize) || 4}`
      : `${t('status.indentSpaces')}: ${d.size}`;
  };
  const cursorLabel = (state) => {
    const head = state.selection.main.head;
    const line = state.doc.lineAt(head);
    return t('status.cursor', { line: line.number, col: head - line.from + 1 });
  };

  /* Notify undo/redo availability for the active tab. Called on every transaction + every tab switch. */
  /* Refresh the git diff gutter — only for the active tab + text/markdown + when a git root exists.
     Call sites: first opening a file / after save / after reload. Stale is tolerated while editing. */
  async function refreshGitDiff(tab) {
    if (!tab || (tab.type !== 'text' && tab.type !== 'markdown')) return;
    if (tab.id !== activeId) return;
    const view = editor?.view;
    if (!view) return;
    /* Apply markers to the view + cache them on the tab — since mode/tab switches (setActiveState) reset the gutter,
       showEditor restores this cache immediately to prevent flicker before the async re-fetch. */
    const apply = (markers) => { tab.diffMarkers = markers; setDiffMarkers(view, markers); };
    const root = typeof callbacks.getGitRoot === 'function' ? callbacks.getGitRoot() : '';
    if (!root) { apply(new Map()); return; }
    if (!tab.path.toLowerCase().startsWith(String(root).toLowerCase())) {
      apply(new Map());
      return;
    }
    const rel = tab.path.slice(root.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
    try {
      const r = await window.oyen?.git?.diff?.(root, rel);
      if (!r || !r.ok) { apply(new Map()); return; }
      apply(hunksToMarkers(r.data?.hunks || []));
    } catch {
      apply(new Map());
    }
  }

  function notifyHistoryChange() {
    if (typeof callbacks.onHistoryChange !== 'function') return;
    const state = editor?.view?.state;
    if (!state) { callbacks.onHistoryChange({ canUndo: false, canRedo: false }); return; }
    callbacks.onHistoryChange({ canUndo: undoDepth(state) > 0, canRedo: redoDepth(state) > 0 });
  }

  function tabId(filePath) {
    return String(filePath || '').replace(/\//g, '\\').toLowerCase();
  }

  function renderTabs() {
    if (!tabsRoot) return;
    tabsRoot.innerHTML = openTabs.map((t) => `
      <button class="tab ${t.id === activeId ? 'active' : ''} ${t.dirty ? 'dirty' : ''} ${t.loading ? 'loading' : ''}" data-tab-id="${esc(t.id)}" title="${esc(t.path)}">
        <span class="tab-title">${t.type === 'diff' ? '<span class="tab-diff-badge">diff</span>' : ''}${esc(t.name)}</span>
        <span class="tab-close" data-close="${esc(t.id)}"></span>
      </button>
    `).join('');
    scrollActiveTabIntoView();
    /* Window title (titlebar/taskbar) = active file name - Oyen. Just Oyen when there are no tabs. */
    const active = openTabs.find((v) => v.id === activeId);
    document.title = active ? `${active.name} - Oyen` : 'Oyen';
  }


  function scrollActiveTabIntoView() {
    const activeTab = tabsRoot?.querySelector('.tab.active');
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  const preview = createEditorPreview({ previewRoot, hostTarget: target, setStatus });
  const { showPreview, showLoadingView } = preview;

  function renderMarkdownToolbar(mode) {
    if (!mdToolbar) return;
    mdToolbar.innerHTML = `
      <button type="button" class="ipv-btn ipv-text md-tab-btn ${mode === 'edit' ? 'active' : ''}" data-md-mode="edit">${esc(t('markdown.toggle.edit'))}</button>
      <button type="button" class="ipv-btn ipv-text md-tab-btn ${mode === 'preview' ? 'active' : ''}" data-md-mode="preview">${esc(t('markdown.toggle.preview'))}</button>
    `;
  }

  function showMarkdownToolbar(mode) {
    if (!mdToolbar) return;
    mdToolbar.hidden = false;
    renderMarkdownToolbar(mode);
  }

  function hideMarkdownToolbar() {
    if (!mdToolbar) return;
    mdToolbar.hidden = true;
    mdToolbar.innerHTML = '';
  }

  mdToolbar?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-md-mode]');
    if (!btn) return;
    const tab = openTabs.find((v) => v.id === activeId);
    if (!tab || tab.type !== 'markdown' || tab.loading) return;
    const next = btn.dataset.mdMode;
    if (tab.markdownMode === next) return;
    /* On edit -> preview switch, record the scroll line (restored when coming back from preview). */
    if (tab.markdownMode === 'edit') savePrevTabState();
    tab.markdownMode = next;
    renderMarkdownToolbar(next);
    if (next === 'edit') showEditor(tab);
    else await showPreview(tab);
    refreshGitDiff(tab);
  });

  function showEditor(tab) {
    previewRoot.hidden = true;
    previewRoot.innerHTML = '';
    target.hidden = false;
    if (!tab.state) {
      tab.state = createTabState(tab.content, tab.name, userOptions, (update) => {
        if (update.docChanged) tab.state = update.state;
        const nextDirty = !tab.savedDoc.eq(tab.state.doc);
        if (nextDirty !== tab.dirty) {
          tab.dirty = nextDirty;
          renderTabs();
        }
        notifyHistoryChange();
        if ((update.selectionSet || update.docChanged) && tab.id === activeId) {
          callbacks.onCursorChange?.(cursorLabel(update.state));
          callbacks.onSymbolChange?.(symbolPath(update.state));
        }
      }, syntaxColorsRef.current);
      tab.savedDoc = tab.state.doc;
      tab.dirty = false;
    }
    editor.setActiveState(tab.state);
    /* setActiveState resets the gutter, so restore the cached diff markers immediately — prevents flicker before the async refreshGitDiff. */
    if (tab.diffMarkers && editor.view) setDiffMarkers(editor.view, tab.diffMarkers);
    notifyHistoryChange();
    if (tab.splitActive) {
      editorSplit.enable();
    }
    /* The CM6 EditorView.scrollIntoView effect guarantees up through the measure phase,
       so the old RAF + setTimeout double-call race workaround is unnecessary. */
    const view = editor.view;
    if (view) {
      if (typeof tab.scrollLine === 'number') {
        try {
          const totalLines = view.state.doc.lines;
          const lineNum = Math.min(Math.max(1, tab.scrollLine), totalLines);
          const pos = view.state.doc.line(lineNum).from;
          view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: 'start' }) });
        } catch (_) {
          view.scrollDOM.scrollTop = 0;
        }
      } else {
        view.scrollDOM.scrollTop = 0;
      }
      editor.focus();
    }
    setStatus(tab.path, [indentMeta(tab.content), tab.encoding || 'UTF-8', eolFromContent(tab.content), typeLabelFromFile(tab.name), formatFileSize(tab.size)]);
    callbacks.onCursorChange?.(cursorLabel(editor.view.state));
  }

  /* ── Static git diff view (click a changed file → read-only, not CM6) ──
     Render hunks with two columns of old/new line numbers + +/− signs. Meta lines are already stripped by the parser. */
  function diffRow(cls, oldN, newN, sign, content) {
    return `<div class="d-line${cls ? ' ' + cls : ''}">`
      + `<span class="d-num">${oldN === '' ? '' : oldN}</span>`
      + `<span class="d-num">${newN === '' ? '' : newN}</span>`
      + `<span class="d-sign">${sign}</span>`
      + `<span class="d-text">${content}</span></div>`;
  }
  function buildDiffHtml(hunks) {
    if (!hunks || !hunks.length) return `<div class="diff-empty">${esc(t('git.diff.empty'))}</div>`;
    let html = '';
    hunks.forEach((hunk, hi) => {
      if (hi > 0) html += '<div class="d-sep"></div>';
      let o = hunk.oldStart;
      let n = hunk.newStart;
      for (const ln of hunk.lines) {
        const text = esc(ln.text) || '&nbsp;';
        if (ln.type === 'add') html += diffRow('d-add', '', n++, '+', text);
        else if (ln.type === 'del') html += diffRow('d-del', o++, '', '−', text);
        else html += diffRow('', o++, n++, '', text);
      }
    });
    return `<div class="diff-view">${html}</div>`;
  }
  function showDiff(tab) {
    editorSplit.disable();
    target.hidden = true;
    previewRoot.hidden = false;
    previewRoot.innerHTML = buildDiffHtml(tab.hunks);
    setStatus(tab.path, ['diff']);
  }
  /* git panel click → diff tab (separate id from a normal tab). If it already exists, update hunks then activate. */
  async function openDiff(filePath, fileName, hunks) {
    const id = `diff:${tabId(filePath)}`;
    const existing = openTabs.find((v) => v.id === id);
    if (existing) {
      existing.hunks = hunks;
      if (activeId === id) showDiff(existing);
      else await activateTab(id);
      return;
    }
    openTabs.push({ id, path: filePath, name: fileName, type: 'diff', content: '', hunks });
    await activateTab(id);
  }


  async function saveTab(tab) {
    if (!tab || (tab.type !== 'text' && tab.type !== 'markdown')) return true;
    if (!tab.state) return true;
    return runBusy(async () => {
      const content = tab.state.doc.toString();
      try {
        const result = await window.oyen.localFs.writeText(tab.path, content, tab.encoding || 'UTF-8');
        if (!result?.ok) {
          await notifyAlert(friendlyFsError(result?.message || t('editor.error.saveFailed'), t('fserr.file')));
          return false;
        }
        tab.content = content;
        tab.size = result.size;
        tab.savedDoc = tab.state.doc;
        if (tab.dirty) {
          tab.dirty = false;
          renderTabs();
        }
        if (tab.id === activeId) {
          setStatus(tab.path, [indentMeta(content), tab.encoding || 'UTF-8', eolFromContent(content), typeLabelFromFile(tab.name), formatFileSize(tab.size)]);
        }
        callbacks.onFileSaved?.(tab.path);
        refreshGitDiff(tab);
        return true;
      } catch (err) {
        await notifyAlert(friendlyFsError(err, t('fserr.file')));
        return false;
      }
    });
  }

  async function saveActiveTab() {
    const tab = openTabs.find((v) => v.id === activeId);
    if (tab) await saveTab(tab);
  }

  function savePrevTabState() {
    const prev = openTabs.find((v) => v.id === activeId);
    if (!prev || (prev.type !== 'text' && prev.type !== 'markdown')) return;
    const view = editor.view;
    if (prev.state && view?.scrollDOM) {
      const top = view.scrollDOM.scrollTop;
      try {
        const block = view.lineBlockAtHeight(top);
        prev.scrollLine = view.state.doc.lineAt(block.from).number;
      } catch (_) {
        prev.scrollLine = 1;
      }
    }
    prev.splitActive = editorSplit.isActive();
  }

  async function activateTab(id) {
    if (id === activeId) return;
    const tab = openTabs.find((v) => v.id === id);
    if (!tab) return;
    savePrevTabState();
    editorSplit.disable();
    activeId = id;
    renderTabs();
    if (tab.type === 'markdown') {
      if (!tab.markdownMode) tab.markdownMode = 'preview';
      showMarkdownToolbar(tab.markdownMode);
    } else {
      hideMarkdownToolbar();
    }
    if (tab.loading) showLoadingView(tab);
    else if (tab.type === 'text') showEditor(tab);
    else if (tab.type === 'markdown' && tab.markdownMode === 'edit') showEditor(tab);
    else if (tab.type === 'diff') showDiff(tab);
    else await showPreview(tab);
    renderTabs();
    if (!isTextActive()) callbacks.onHistoryChange?.({ canUndo: false, canRedo: false });
    if (typeof callbacks.onTabActivate === 'function') callbacks.onTabActivate(tab.path);
    refreshGitDiff(tab);
  }

  async function closeTab(id, options = {}) {
    const i = openTabs.findIndex((v) => v.id === id);
    if (i < 0) return;
    const tab = openTabs[i];

    if (tab.dirty && !options.skipDirtyCheck) {
      const choice = await confirmDirtyClose();
      if (choice === 'cancel') return;
      if (choice === 'save') {
        const ok = await saveTab(tab);
        if (!ok) return;
      }
    }

    const wasActive = tab.id === activeId;
    tab.state = null;
    openTabs.splice(i, 1);
    if (!openTabs.length) {
      activeId = '';
      previewRoot.hidden = true;
      previewRoot.innerHTML = '';
      target.hidden = true;
      editorSplit.disable();
      hideMarkdownToolbar();
      setStatus('', '');
      renderTabs();
      callbacks.onHistoryChange?.({ canUndo: false, canRedo: false });
      return;
    }
    if (wasActive) {
      activeId = '';
      activateTab(openTabs[Math.max(0, i - 1)].id);
    } else {
      renderTabs();
    }
  }

  async function openFile(filePath, fileName) {
    console.log('[oyen] openFile:', filePath, fileName);
    /* Record in recent files on every call — same whether it's a new tab or activating an existing one. */
    if (typeof callbacks.onFileOpened === 'function') callbacks.onFileOpened(filePath, fileName);
    const id = tabId(filePath);
    const exists = openTabs.find((v) => v.id === id);
    if (exists) return activateTab(id);

    await runBusy(async () => {
      if (isImage(fileName)) {
        openTabs.push({ id, path: filePath, name: fileName, type: 'image', content: '' });
        await activateTab(id);
        return;
      }
      if (isPdf(fileName)) {
        openTabs.push({ id, path: filePath, name: fileName, type: 'pdf', content: '' });
        await activateTab(id);
        return;
      }
      if (isVideo(fileName)) {
        openTabs.push({ id, path: filePath, name: fileName, type: 'video', content: '' });
        await activateTab(id);
        return;
      }
      if (isAudio(fileName)) {
        openTabs.push({ id, path: filePath, name: fileName, type: 'audio', content: '' });
        await activateTab(id);
        return;
      }
      if (isWindowsShortcut(fileName) || isOfficeDocument(fileName) || isPrivateKey(fileName) || isInstaller(fileName)) {
        openTabs.push({ id, path: filePath, name: fileName, type: 'unsupported', content: '', encoding: '' });
        await activateTab(id);
        return;
      }

      const tentativeType = isMd(fileName) ? 'markdown' : 'text';
      const placeholder = { id, path: filePath, name: fileName, type: tentativeType, content: '', loading: true };
      if (tentativeType === 'markdown') placeholder.markdownMode = 'preview';
      openTabs.push(placeholder);
      await activateTab(id);

      try {
        const desc = await window.oyen.localFs.readTextDescriptor(filePath);
        const current = openTabs.find((v) => v.id === id);
        if (!current) return;
        current.loading = false;
        if (desc?.status !== 'ok') {
          current.type = 'unsupported';
          current.content = '';
          current.encoding = '';
        } else {
          current.content = desc.content || '';
          current.encoding = desc.encoding || 'UTF-8';
          current.size = desc.size;
        }
        if (activeId === id) {
          if (current.type === 'text') showEditor(current);
          else if (current.type === 'markdown' && current.markdownMode === 'edit') showEditor(current);
          else await showPreview(current);
        }
        renderTabs();
        refreshGitDiff(current);
      } catch (err) {
        const idx = openTabs.findIndex((v) => v.id === id);
        if (idx >= 0) openTabs.splice(idx, 1);
        if (activeId === id) {
          activeId = '';
          previewRoot.hidden = true;
          previewRoot.innerHTML = '';
          target.hidden = true;
          setStatus('', '');
        }
        renderTabs();
        await notifyAlert(friendlyFsError(err, t('fserr.file')));
      }
    });
  }

  tabsRoot?.addEventListener('click', (e) => {
    const close = e.target.closest('[data-close]');
    if (close) return closeTab(close.dataset.close);
    const tab = e.target.closest('.tab[data-tab-id]');
    if (tab) activateTab(tab.dataset.tabId);
  });

  /* Tab right-click context menu — save/save-as/save-all · copy path·name/reveal · close/close-other tabs. Based on the right-clicked tab (styling shared via .context-menu). */
  let tabContextMenu = null;
  function closeTabContextMenu() {
    if (!tabContextMenu) return;
    tabContextMenu.remove();
    tabContextMenu = null;
    document.removeEventListener('mousedown', onTabMenuOutside, true);
  }
  function onTabMenuOutside(e) {
    if (tabContextMenu && !tabContextMenu.contains(e.target)) closeTabContextMenu();
  }
  function showTabContextMenu(event, tab) {
    closeTabContextMenu();
    tabContextMenu = document.createElement('div');
    tabContextMenu.className = 'context-menu';
    tabContextMenu.innerHTML = `
      <button class="context-menu-item" data-act="save">${t('ctx.save')}</button>
      <button class="context-menu-item" data-act="save-as">${t('ctx.saveAs')}</button>
      <button class="context-menu-item" data-act="save-all">${t('ctx.saveAll')}</button>
      <div class="context-menu-separator"></div>
      <button class="context-menu-item" data-act="copy-path">${t('ctx.copyPath')}</button>
      <button class="context-menu-item" data-act="copy-name">${t('ctx.copyName')}</button>
      <button class="context-menu-item" data-act="reveal">${t('ctx.reveal')}</button>
      <div class="context-menu-separator"></div>
      <button class="context-menu-item" data-act="close">${t('ctx.close')}</button>
      <button class="context-menu-item" data-act="close-others">${t('ctx.closeOthers')}</button>
      <button class="context-menu-item" data-act="close-right">${t('ctx.closeToRight')}</button>
    `;
    tabContextMenu.addEventListener('click', async (ev) => {
      const item = ev.target.closest('.context-menu-item');
      if (!item) return;
      const act = item.dataset.act;
      closeTabContextMenu();
      if (act === 'save') { await activateTab(tab.id); await saveActive(); }
      else if (act === 'save-as') { await activateTab(tab.id); await saveAsActive(); }
      else if (act === 'save-all') await saveAll();
      else if (act === 'copy-path') await window.oyen.clipboard?.writeText(tab.path);
      else if (act === 'copy-name') await window.oyen.clipboard?.writeText(tab.name);
      else if (act === 'reveal') { await activateTab(tab.id); callbacks.onRevealInTree?.(tab.path); }
      else if (act === 'close') closeTab(tab.id);
      else if (act === 'close-others') { await activateTab(tab.id); await closeOthers(); }
      else if (act === 'close-right') await closeToRight(tab.id);
    });
    document.body.appendChild(tabContextMenu);
    tabContextMenu.style.left = `${event.clientX}px`;
    tabContextMenu.style.top = `${event.clientY}px`;
    const rect = tabContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) tabContextMenu.style.left = `${window.innerWidth - rect.width - 4}px`;
    if (rect.bottom > window.innerHeight) tabContextMenu.style.top = `${window.innerHeight - rect.height - 4}px`;
    document.addEventListener('mousedown', onTabMenuOutside, true);
  }
  tabsRoot?.addEventListener('contextmenu', (event) => {
    const tabEl = event.target.closest('.tab[data-tab-id]');
    if (!tabEl) return;
    event.preventDefault();
    const tab = openTabs.find((v) => v.id === tabEl.dataset.tabId);
    if (tab) showTabContextMenu(event, tab);
  });

  /* Editor body right-click context menu — cut/copy/paste/delete (styling shared via .context-menu).
     Cut/copy/delete enabled only when there's a selection. If the click point is outside the selection, move the cursor there (keep it if inside) = standard behavior. */
  let editorContextMenu = null;
  function closeEditorContextMenu() {
    if (!editorContextMenu) return;
    editorContextMenu.remove();
    editorContextMenu = null;
    document.removeEventListener('mousedown', onEditorMenuOutside, true);
  }
  function onEditorMenuOutside(e) {
    if (editorContextMenu && !editorContextMenu.contains(e.target)) closeEditorContextMenu();
  }
  function showEditorContextMenu(event, view) {
    closeEditorContextMenu();
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos != null) {
      const sel = view.state.selection.main;
      const inside = !sel.empty && pos >= sel.from && pos <= sel.to;
      if (!inside) view.dispatch({ selection: { anchor: pos } });
    }
    view.focus();
    const dis = view.state.selection.main.empty ? 'disabled' : '';
    editorContextMenu = document.createElement('div');
    editorContextMenu.className = 'context-menu';
    editorContextMenu.innerHTML = `
      <button class="context-menu-item" data-act="cut" ${dis}>${t('shortcut.cut')}</button>
      <button class="context-menu-item" data-act="copy" ${dis}>${t('shortcut.copy')}</button>
      <button class="context-menu-item" data-act="paste">${t('shortcut.paste')}</button>
      <button class="context-menu-item" data-act="delete" ${dis}>${t('ctx.deleteSelection')}</button>
      <div class="context-menu-separator"></div>
      <button class="context-menu-item" data-act="upper" ${dis}>${t('shortcut.upperCase')}</button>
      <button class="context-menu-item" data-act="lower" ${dis}>${t('shortcut.lowerCase')}</button>
      <div class="context-menu-separator"></div>
      <button class="context-menu-item" data-act="find">${t('shortcut.find')}</button>
      <button class="context-menu-item" data-act="replace">${t('shortcut.replace')}</button>
    `;
    /* mousedown + preventDefault keeps editor focus → applies to exactly the clicked view even when split (the clipboard API uses focus to determine the view). */
    editorContextMenu.addEventListener('mousedown', (ev) => {
      const item = ev.target.closest('.context-menu-item');
      if (!item || item.disabled) return;
      ev.preventDefault();
      const act = item.dataset.act;
      closeEditorContextMenu();
      if (act === 'cut') editor.cutSelection();
      else if (act === 'copy') editor.copySelection();
      else if (act === 'paste') editor.pasteAtSelection();
      else if (act === 'delete') editor.deleteSelection();
      else if (act === 'upper') editor.upperCase();
      else if (act === 'lower') editor.lowerCase();
      else if (act === 'find') callbacks.onFind?.();
      else if (act === 'replace') callbacks.onReplace?.();
    });
    document.body.appendChild(editorContextMenu);
    editorContextMenu.style.left = `${event.clientX}px`;
    editorContextMenu.style.top = `${event.clientY}px`;
    const rect = editorContextMenu.getBoundingClientRect();
    if (rect.right > window.innerWidth) editorContextMenu.style.left = `${window.innerWidth - rect.width - 4}px`;
    if (rect.bottom > window.innerHeight) editorContextMenu.style.top = `${window.innerHeight - rect.height - 4}px`;
    document.addEventListener('mousedown', onEditorMenuOutside, true);
  }
  target.addEventListener('contextmenu', (event) => {
    const secondaryView = editor.getSecondary?.();
    const view = (secondaryView && secondaryView.contentDOM.contains(event.target)) ? secondaryView
               : (editor.view.contentDOM.contains(event.target)) ? editor.view
               : null;
    if (!view) return;   // keep default behavior for gutter/scrollbar etc.
    event.preventDefault();
    showEditorContextMenu(event, view);
  });

  tabsRoot?.addEventListener('wheel', (event) => {
    if (!tabsRoot.scrollWidth || tabsRoot.scrollWidth <= tabsRoot.clientWidth) return;
    event.preventDefault();
    tabsRoot.scrollLeft += event.deltaY || event.deltaX;
  }, { passive: false });

  async function saveActive() {
    const tab = openTabs.find((v) => v.id === activeId);
    if (!tab) return;
    if (tab.type !== 'text' && tab.type !== 'markdown') return;
    if (!tab.dirty) return;
    await saveTab(tab);
  }

  /* Reload taking a tab object directly. With options.force=true, force without a prompt even if dirty (e.g. right after a git discard). */
  async function reloadTab(tab, options = {}) {
    if (!tab) return;
    if (tab.type !== 'text' && tab.type !== 'markdown') return;
    if (tab.dirty && !options.force) {
      const ok = await confirmReload(
        t('dlg.reload.title'),
        t('dlg.reload.message'),
        t('dlg.reload.confirm'),
        t('dlg.cancel')
      );
      if (!ok) return;
    }
    await runBusy(async () => {
      try {
        const desc = await window.oyen.localFs.readTextDescriptor(tab.path);
        if (desc?.status !== 'ok') {
          await notifyAlert(friendlyFsError(desc?.message || t('editor.error.reloadFailed'), t('fserr.file')));
          return;
        }
        tab.content = desc.content || '';
        tab.encoding = desc.encoding || 'UTF-8';
        tab.size = desc.size;
        tab.state = createTabState(tab.content, tab.name, userOptions, (update) => {
          if (update.docChanged) tab.state = update.state;
          const nextDirty = !tab.savedDoc.eq(tab.state.doc);
          if (nextDirty !== tab.dirty) {
            tab.dirty = nextDirty;
            renderTabs();
          }
          notifyHistoryChange();
          if ((update.selectionSet || update.docChanged) && tab.id === activeId) {
          callbacks.onCursorChange?.(cursorLabel(update.state));
          callbacks.onSymbolChange?.(symbolPath(update.state));
        }
        }, syntaxColorsRef.current);
        tab.savedDoc = tab.state.doc;
        tab.dirty = false;
        tab.scrollLine = 1;
        if (activeId === tab.id) {
          if (tab.type === 'text') showEditor(tab);
          else if (tab.type === 'markdown' && tab.markdownMode === 'edit') showEditor(tab);
          else await showPreview(tab);
        }
        renderTabs();
        refreshGitDiff(tab);
      } catch (err) {
        await notifyAlert(friendlyFsError(err, t('fserr.file')));
      }
    });
  }

  async function reloadActive() {
    const tab = openTabs.find((v) => v.id === activeId);
    await reloadTab(tab);
  }

  async function reloadByPath(filePath, options = {}) {
    const id = tabId(filePath);
    const tab = openTabs.find((v) => v.id === id);
    await reloadTab(tab, options);
  }

  async function saveAll() {
    const dirtyTextTabs = openTabs.filter((t) => (t.type === 'text' || t.type === 'markdown') && t.dirty);
    if (!dirtyTextTabs.length) return;
    await Promise.all(dirtyTextTabs.map((t) => saveTab(t)));
  }

  async function saveAsActive() {
    const tab = openTabs.find((v) => v.id === activeId);
    if (!tab) return;
    const isText = tab.type === 'text' || tab.type === 'markdown';
    if (isText && !tab.state) return;
    /* Non-text (pdf/image/media) copies the original binary — local only. For remote, use download from the tree. */
    if (!isText && /^[a-z]+:\/\//i.test(tab.path || '')) { await notifyAlert(t('editor.saveAs.remote')); return; }
    const dotIdx = tab.name.lastIndexOf('.');
    const ext = dotIdx > 0 ? tab.name.slice(dotIdx + 1).toLowerCase() : '';
    const filters = ext
      ? [
          { name: t('saveDialog.filter.ext', { ext: ext.toUpperCase() }), extensions: [ext] },
          { name: t('saveDialog.filter.all'), extensions: ['*'] }
        ]
      : [{ name: t('saveDialog.filter.all'), extensions: ['*'] }];
    const picked = await window.oyen.localFs.pickSaveFile({ defaultPath: tab.path, filters });
    if (!picked?.ok || !picked.path) return;
    await runBusy(async () => {
      if (isText) {
        const content = tab.state.doc.toString();
        const result = await window.oyen.localFs.writeText(picked.path, content, tab.encoding || 'UTF-8');
        if (!result?.ok) await notifyAlert(friendlyFsError(result?.message || t('editor.error.saveFailed'), t('fserr.file')));
      } else {
        const result = await window.oyen.localFs.copyFile(tab.path, picked.path);
        if (!result?.ok) await notifyAlert(friendlyFsError(result?.error || t('editor.error.saveFailed'), t('fserr.file')));
      }
      // The current tab stays on the original (saveAs is a simple export).
    });
  }

  function undo() {
    if (!isTextActive()) return;
    editor.undo();
  }

  function redo() {
    if (!isTextActive()) return;
    editor.redo();
  }

  function isTextActive() {
    const tab = openTabs.find((v) => v.id === activeId);
    if (tab?.type === 'text') return true;
    if (tab?.type === 'markdown') return tab.markdownMode === 'edit';
    return false;
  }

  function closeActive() {
    if (!activeId) return;
    closeTab(activeId);
  }

  async function closeAll() {
    const dirtyTabs = openTabs.filter((tab) => (tab.type === 'text' || tab.type === 'markdown') && tab.dirty);
    if (dirtyTabs.length) {
      const choice = await confirmDirtyClose();
      if (choice === 'cancel') return;
      if (choice === 'save') await saveAll();
    }
    while (openTabs.length) {
      await closeTab(openTabs[0].id, { skipDirtyCheck: true });
    }
  }

  async function closeOthers() {
    const others = openTabs.filter((tab) => tab.id !== activeId);
    if (!others.length) return;
    const dirtyOthers = others.filter((tab) => (tab.type === 'text' || tab.type === 'markdown') && tab.dirty);
    if (dirtyOthers.length) {
      const choice = await confirmDirtyClose();
      if (choice === 'cancel') return;
      if (choice === 'save') {
        await Promise.all(dirtyOthers.map((tab) => saveTab(tab)));
      }
    }
    for (const tab of others) {
      await closeTab(tab.id, { skipDirtyCheck: true });
    }
  }

  async function closeToRight(id) {
    const idx = openTabs.findIndex((tab) => tab.id === id);
    if (idx < 0) return;
    const rightTabs = openTabs.slice(idx + 1);
    if (!rightTabs.length) return;
    const dirtyRight = rightTabs.filter((tab) => (tab.type === 'text' || tab.type === 'markdown') && tab.dirty);
    if (dirtyRight.length) {
      const choice = await confirmDirtyClose();
      if (choice === 'cancel') return;
      if (choice === 'save') {
        await Promise.all(dirtyRight.map((tab) => saveTab(tab)));
      }
    }
    for (const tab of rightTabs) {
      await closeTab(tab.id, { skipDirtyCheck: true });
    }
  }

  function updateActiveStatus() {
    const t = openTabs.find((v) => v.id === activeId);
    if (!t) return;
    if (t.type === 'text' || t.type === 'markdown') {
      const content = t.state ? t.state.doc.toString() : (t.content || '');
      setStatus(t.path, [indentMeta(content), t.encoding || 'UTF-8', eolFromContent(content), typeLabelFromFile(t.name), formatFileSize(t.size)]);
    } else {
      setStatus(t.path, []);
    }
  }

  function renameTab(oldPath, newPath, newName) {
    const oldId = tabId(oldPath);
    const tab = openTabs.find((v) => v.id === oldId);
    if (!tab) return;
    const newId = tabId(newPath);
    const wasActive = activeId === oldId;
    tab.path = newPath;
    tab.name = newName;
    tab.id = newId;
    if (wasActive) activeId = newId;
    renderTabs();
    if (wasActive) updateActiveStatus();
  }

  function renamePathPrefix(oldPrefix, newPrefix) {
    if (!oldPrefix || !newPrefix) return;
    const normOld = String(oldPrefix).toLowerCase().replace(/\//g, '\\');
    let nextActiveId = null;
    let touched = false;
    for (const tab of openTabs) {
      const pathNorm = String(tab.path || '').toLowerCase().replace(/\//g, '\\');
      const isMatch = pathNorm === normOld || pathNorm.startsWith(`${normOld}\\`);
      if (!isMatch) continue;
      const suffix = tab.path.slice(oldPrefix.length);
      const newPath = newPrefix + suffix;
      const newId = tabId(newPath);
      if (activeId === tab.id) nextActiveId = newId;
      tab.path = newPath;
      tab.id = newId;
      touched = true;
    }
    if (!touched) return;
    if (nextActiveId) activeId = nextActiveId;
    renderTabs();
    updateActiveStatus();
  }

  function editorSelectAll() {
    if (!isTextActive()) return false;
    editor.selectAll();
    return true;
  }

  function deleteCurrentLine() {
    if (!isTextActive()) return false;
    editor.deleteLine();
    return true;
  }

  async function cut() {
    if (!isTextActive()) return false;
    return await editor.cutSelection();
  }

  async function copy() {
    if (!isTextActive()) return false;
    return await editor.copySelection();
  }

  async function paste() {
    if (!isTextActive()) return false;
    return await editor.pasteAtSelection();
  }

  function deleteSelection() {
    if (!isTextActive()) return false;
    return editor.deleteSelection();
  }

  /* Delegate editor-only commands (move/copy line · bracket jump · comment) to the cm6 wrapper, only on text tabs. */
  function editorCommand(method) {
    if (!isTextActive()) return false;
    return editor[method]();
  }

  /* Open a file and jump to a specific line (1-based). */
  async function openFileAt(filePath, fileName, line) {
    await openFile(filePath, fileName);
    if (typeof line === 'number') editor.gotoLine(line);
  }

  function applySyntaxColors(nextSyntaxColors) {
    syntaxColorsRef.current = nextSyntaxColors || {};
    const views = [editor.view, editor.getSecondary?.()].filter(Boolean);
    reconfigureSyntaxColors(views, openTabs, syntaxColorsRef.current);
  }

  function applyEditorOptions(nextOptions) {
    userOptions = nextOptions || {};
    const views = [editor.view, editor.getSecondary?.()].filter(Boolean);
    reconfigureEditorOptions(views, openTabs, userOptions);
    updateActiveStatus();  // reflect indentation/tabSize changes in the status bar immediately (don't wait for the next tab switch)
  }

  return {
    instance: editor,
    openFile,
    openDiff,
    openFileAt,
    saveActive,
    saveAll,
    saveAsActive,
    reloadActive,
    reloadByPath,
    hasDirty: () => openTabs.some((tab) => (tab.type === 'text' || tab.type === 'markdown') && tab.dirty),
    undo,
    redo,
    closeActive,
    closeAll,
    closeOthers,
    selectAllText: editorSelectAll,
    deleteLine: deleteCurrentLine,
    moveLineUp: () => editorCommand('moveLineUp'),
    moveLineDown: () => editorCommand('moveLineDown'),
    copyLineUp: () => editorCommand('copyLineUp'),
    copyLineDown: () => editorCommand('copyLineDown'),
    gotoBracket: () => editorCommand('gotoBracket'),
    toggleComment: () => editorCommand('toggleComment'),
    fold: () => editorCommand('fold'),
    unfold: () => editorCommand('unfold'),
    foldAll: () => editorCommand('foldAll'),
    unfoldAll: () => editorCommand('unfoldAll'),
    selectAllMatches: () => editorCommand('selectAllMatches'),
    upperCase: () => editorCommand('upperCase'),
    lowerCase: () => editorCommand('lowerCase'),
    gotoLine: (line) => { if (isTextActive()) editor.gotoLine(line); },
    getLineInfo: () => (isTextActive() ? editor.getLineInfo() : null),
    cut,
    copy,
    paste,
    deleteSelection,
    applySyntaxColors,
    applyEditorOptions,
    renameTab,
    renamePathPrefix,
    getActiveFilePath: () => openTabs.find((tab) => tab.id === activeId)?.path || '',
    closeByPath: (filePath) => closeTab(tabId(filePath), { skipDirtyCheck: true }),
    toggleSplit: () => {
      const t = openTabs.find((v) => v.id === activeId);
      if (!t) return;
      if (editorSplit.isActive()) {
        t.splitViewState = editorSplit.saveViewState();
        editorSplit.disable();
        t.splitActive = false;
      } else {
        editorSplit.enable();
        if (t.splitViewState) editorSplit.restoreViewState(t.splitViewState);
        t.splitActive = true;
      }
      editor.focus();
    },
    isTextActive
  };
}
