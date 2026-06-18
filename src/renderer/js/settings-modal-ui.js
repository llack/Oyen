import { ACTION_CATALOG, ACTION_GROUPS, DEFAULT_SHORTCUTS, READONLY_ACTIONS, eventToShortcutString } from './shortcuts.js';
import { t } from './i18n.js';
import { mountColorsTab } from './settings-colors-ui.js';
import { monoFontStack } from './fonts.js';

/* A single binding accepts both Ctrl/Cmd (eventToShortcutString normalizes Cmd→Ctrl) → show both chips regardless of OS.
   The Apple chip uses mac notation symbols (⌘ Cmd / ⇧ Shift / ⌥ Alt). Apple notation has no +, so use spaces (e.g. ⌘ ⇧ S). Only the original (Ctrl) has a remove button; the Apple chip is an alias, display-only. */
function toMacLabel(k) {
  return k.replace(/Ctrl/g, '⌘').replace(/Shift/g, '⇧').replace(/Alt/g, '⌥').replace(/\+/g, ' ');
}
function keyDisplayLabels(k) {
  const win = k.replace(/\+/g, ' + ');   // readability — Ctrl+A → Ctrl + A (mac already spaced by toMacLabel)
  if (/\bCtrl\b/.test(k)) return [win, toMacLabel(k)];
  return [win];
}


export function mountEditorSettingsModal({ getEditor, getSettings, saveSettings, getSyntaxColors, onSyntaxColorsChange, onEditorOptionsChange }) {
  const modal = document.getElementById('editorSettingsModal');
  const openBtn = document.getElementById('openEditorSettings');
  const closeBtn = document.getElementById('closeEditorSettings');
  const cancelBtn = document.getElementById('cancelEditorSettings');
  const saveBtn = document.getElementById('saveEditorSettings');
  const indentTypeSel = document.getElementById('indentTypeSelect');
  const tabSizeSel = document.getElementById('tabSizeSelect');

  const tabButtons = document.querySelectorAll('[data-settings-tab]');
  const panes = document.querySelectorAll('[data-pane]');

  let pendingSyntaxColors = {};
  const colorsTab = mountColorsTab({
    getSyntaxColors: () => pendingSyntaxColors,
    resetSyntaxColors: () => { pendingSyntaxColors = {}; },
    getEditorFont: () => ({
      fontFamily: monoFontStack(),
      fontSize: Number(getSettings().editor?.fontSize) || 14
    })
  });

  const shortcutListEl = document.getElementById('shortcutList');
  const shortcutResetBtn = document.getElementById('shortcutsResetBtn');
  let pendingShortcuts = {};       // key -> actionName
  let captureDialogEl = null;
  let captureForAction = null;
  let captureKeyStr = '';

  function activateTab(tab) {
    tabButtons.forEach((button) => {
      button.classList.toggle('active', button.dataset.settingsTab === tab);
    });
    panes.forEach((pane) => {
      pane.hidden = pane.dataset.pane !== tab;
    });
    if (tab === 'shortcuts') {
      renderShortcutList();
    }
    if (tab === 'editor') {
      colorsTab.activate();
    }
  }

  function actionToKeys(action) {
    return Object.keys(pendingShortcuts).filter((k) => pendingShortcuts[k] === action);
  }

  function actionLabel(name) {
    const entry = ACTION_CATALOG.find((a) => a.name === name);
    return entry ? t(entry.labelKey) : name;
  }

  function renderShortcutRow(entry) {
    const label = t(entry.labelKey);
    if (entry.readonly) {
      return `
        <div class="shortcut-row readonly" data-action="${entry.name}">
          <span class="shortcut-row-label">${label}</span>
          <div class="shortcut-row-keys">
            ${keyDisplayLabels(entry.defaultKey || '').map((lbl) => `<span class="shortcut-chip readonly">${escapeHtml(lbl)}</span>`).join('')}
          </div>
        </div>
      `;
    }
    const keys = actionToKeys(entry.name);
    const chips = keys.flatMap((k) => keyDisplayLabels(k).map((lbl, i) => `
      <span class="shortcut-chip${i ? ' alt' : ''}" data-key="${escapeHtml(k)}">
        <span class="shortcut-chip-label">${escapeHtml(lbl)}</span>
        ${i ? '' : `<button type="button" class="shortcut-chip-remove" data-remove-key aria-label="${t('settings.shortcuts.removeKey')}">×</button>`}
      </span>
    `)).join('');
    return `
      <div class="shortcut-row" data-action="${entry.name}">
        <span class="shortcut-row-label">${label}</span>
        <div class="shortcut-row-keys">
          ${chips}
          <button type="button" class="shortcut-add-key" data-add-key aria-label="${t('settings.shortcuts.addKey')}">+</button>
        </div>
      </div>
    `;
  }

  function renderShortcutList() {
    if (!shortcutListEl) return;
    /* Section header + its rows in the order groups are defined. Ungrouped entries go last, without a header. */
    const seen = new Set();
    let html = ACTION_GROUPS.map((g) => {
      const entries = ACTION_CATALOG.filter((e) => e.group === g.id);
      entries.forEach((e) => seen.add(e.name));
      if (!entries.length) return '';
      return `<div class="shortcut-group-title">${t(g.labelKey)}</div>${entries.map(renderShortcutRow).join('')}`;
    }).join('');
    const ungrouped = ACTION_CATALOG.filter((e) => !seen.has(e.name));
    html += ungrouped.map(renderShortcutRow).join('');
    shortcutListEl.innerHTML = html;
  }

  function escapeHtml(v) {
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function assignShortcut(action, keyStr) {
    if (!keyStr) return;
    // Remove the same key if it was on a different action (conflict resolution)
    if (pendingShortcuts[keyStr] && pendingShortcuts[keyStr] !== action) {
      delete pendingShortcuts[keyStr];
    }
    pendingShortcuts[keyStr] = action;
  }

  function removeShortcutKey(key) {
    delete pendingShortcuts[key];
  }

  function ensureCaptureDialog() {
    if (captureDialogEl) return captureDialogEl;
    captureDialogEl = document.createElement('div');
    captureDialogEl.className = 'shortcut-capture-overlay';
    captureDialogEl.hidden = true;
    captureDialogEl.innerHTML = `
      <div class="shortcut-capture-dialog">
        <div class="shortcut-capture-title" data-title></div>
        <div class="shortcut-capture-keybox empty" data-keybox>${t('settings.capture.prompt')}</div>
        <div class="shortcut-capture-conflict" data-conflict hidden></div>
        <div class="shortcut-capture-buttons">
          <button type="button" class="settings-btn" data-capture-cancel>${t('dlg.cancel')}</button>
          <button type="button" class="settings-btn primary" data-capture-apply disabled>${t('settings.capture.apply')}</button>
        </div>
      </div>
    `;
    modal.appendChild(captureDialogEl);
    captureDialogEl.querySelector('[data-capture-cancel]').addEventListener('click', closeCaptureDialog);
    captureDialogEl.querySelector('[data-capture-apply]').addEventListener('click', applyCapture);
    captureDialogEl.addEventListener('click', (e) => {
      if (e.target === captureDialogEl) closeCaptureDialog();
    });
    return captureDialogEl;
  }

  function openCaptureDialog(action) {
    ensureCaptureDialog();
    captureForAction = action;
    captureKeyStr = '';
    captureDialogEl.querySelector('[data-title]').textContent = t('settings.capture.title', { action: actionLabel(action) });
    const keybox = captureDialogEl.querySelector('[data-keybox]');
    keybox.textContent = t('settings.capture.prompt');
    keybox.className = 'shortcut-capture-keybox empty';
    captureDialogEl.querySelector('[data-conflict]').hidden = true;
    captureDialogEl.querySelector('[data-capture-apply]').disabled = true;
    captureDialogEl.hidden = false;
    window.__oyenShortcutRecorder?.start?.();
  }

  function closeCaptureDialog() {
    if (!captureDialogEl || captureDialogEl.hidden) return;
    captureDialogEl.hidden = true;
    captureForAction = null;
    captureKeyStr = '';
    window.__oyenShortcutRecorder?.stop?.();
  }

  function applyCapture() {
    if (!captureForAction || !captureKeyStr) return;
    assignShortcut(captureForAction, captureKeyStr);
    closeCaptureDialog();
    renderShortcutList();
  }

  function updateCaptureFromEvent(event) {
    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) return;
    if (event.key === 'Escape') { closeCaptureDialog(); return; }
    if (event.key === 'Enter' && captureKeyStr) { applyCapture(); return; }
    const keyStr = eventToShortcutString(event);
    if (!keyStr) return;
    captureKeyStr = keyStr;
    const keybox = captureDialogEl.querySelector('[data-keybox]');
    keybox.textContent = keyStr;
    keybox.className = 'shortcut-capture-keybox';
    const conflict = captureDialogEl.querySelector('[data-conflict]');
    const existingAction = pendingShortcuts[keyStr];
    const applyBtn = captureDialogEl.querySelector('[data-capture-apply]');
    if (existingAction === captureForAction) {
      conflict.textContent = t('settings.capture.dupSelf');
      conflict.hidden = false;
      applyBtn.disabled = true;
    } else if (existingAction) {
      conflict.textContent = t('settings.capture.dupOther', { action: actionLabel(existingAction) });
      conflict.hidden = false;
      applyBtn.disabled = false;
    } else {
      conflict.hidden = true;
      applyBtn.disabled = false;
    }
  }

  shortcutListEl?.addEventListener('click', (event) => {
    const row = event.target.closest('.shortcut-row');
    if (!row || row.classList.contains('readonly')) return;
    const action = row.dataset.action;
    if (event.target.closest('[data-remove-key]')) {
      const chip = event.target.closest('.shortcut-chip');
      const key = chip?.dataset.key;
      if (key) {
        removeShortcutKey(key);
        renderShortcutList();
      }
      return;
    }
    if (event.target.closest('[data-add-key]')) {
      openCaptureDialog(action);
    }
  });

  window.addEventListener('keydown', (event) => {
    if (!captureForAction) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    updateCaptureFromEvent(event);
  }, true);

  shortcutResetBtn?.addEventListener('click', () => {
    pendingShortcuts = { ...DEFAULT_SHORTCUTS };
    renderShortcutList();
  });

  /* Reset the editor tab — both the editor option inputs and colors to defaults. Applied on Save. */
  const editorResetBtn = document.getElementById('editorResetBtn');
  editorResetBtn?.addEventListener('click', () => {
    colorsTab.resetAll();
  });

  function open() {
    const settings = getSettings();

    pendingSyntaxColors = JSON.parse(JSON.stringify(
      (typeof getSyntaxColors === 'function' ? getSyntaxColors() : null) || {}
    ));

    const rawShortcuts = { ...DEFAULT_SHORTCUTS, ...(settings.shortcuts || {}) };
    pendingShortcuts = Object.fromEntries(
      Object.entries(rawShortcuts).filter(([, action]) => !READONLY_ACTIONS.has(action))
    );
    closeCaptureDialog();

    if (indentTypeSel) indentTypeSel.value = settings.editor?.indentType || 'auto';
    if (tabSizeSel) tabSizeSel.value = String(settings.editor?.tabSize || 4);

    activateTab('editor');
    resetShellPosition();
    modal.removeAttribute('hidden');
  }

  const shell = modal.querySelector('.settings-shell');
  const header = modal.querySelector('.settings-header');
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragStartX = 0;
  let dragStartY = 0;
  let baseX = 0;
  let baseY = 0;
  let dragging = false;

  function resetShellPosition() {
    dragOffsetX = 0;
    dragOffsetY = 0;
    shell.style.transform = '';
  }

  header?.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('.settings-close')) return;
    dragging = true;
    dragStartX = event.clientX;
    dragStartY = event.clientY;
    baseX = dragOffsetX;
    baseY = dragOffsetY;
    header.classList.add('dragging');
    event.preventDefault();
  });

  document.addEventListener('mousemove', (event) => {
    if (!dragging) return;
    dragOffsetX = baseX + (event.clientX - dragStartX);
    dragOffsetY = baseY + (event.clientY - dragStartY);
    shell.style.transform = `translate(${dragOffsetX}px, ${dragOffsetY}px)`;
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    header?.classList.remove('dragging');
  });

  function close() {
    modal.setAttribute('hidden', '');
  }

  function cancel() {
    closeCaptureDialog();
    close();
  }

  async function save() {
    const editor = getEditor();
    if (!editor) return;

    /* wordWrap/lineNumbers/minimap are managed by the edit menu/toolbar — here we only preserve them via ...getSettings().editor.
       Indentation (indentType/tabSize) is managed by this tab's selects. */
    const nextEditorSettings = {
      ...(getSettings().editor || {}),
      indentType: indentTypeSel?.value || 'auto',
      tabSize: Number(tabSizeSel?.value) || 4
    };

    if (typeof onEditorOptionsChange === 'function') onEditorOptionsChange(nextEditorSettings);

    /* Language is managed separately from the menu bar (Settings > Language) — here we only preserve appearance via ...getSettings(). */
    const nextSettings = {
      ...getSettings(),
      editor: nextEditorSettings,
      shortcuts: { ...pendingShortcuts },
      syntaxColors: pendingSyntaxColors
    };

    await saveSettings(nextSettings);
    if (typeof onSyntaxColorsChange === 'function') onSyntaxColorsChange(pendingSyntaxColors);
    close();
  }

  if (openBtn) openBtn.addEventListener('click', open);
  closeBtn.addEventListener('click', cancel);
  cancelBtn.addEventListener('click', cancel);
  saveBtn.addEventListener('click', save);

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.settingsTab));
  });

  modal.addEventListener('click', (event) => {
    if (event.target === modal) cancel();
  });

  return {
    open,
    close
  };
}
