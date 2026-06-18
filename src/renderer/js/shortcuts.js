// OYEN shortcut system - only user-defined keys act. Some CM6/app built-ins are blocked.

/* Shortcut tab sections. Matched against ACTION_CATALOG's group; group headers render in this order. */
export const ACTION_GROUPS = [
  { id: 'file', labelKey: 'shortcut.group.file' },
  { id: 'edit', labelKey: 'shortcut.group.edit' },
  { id: 'search', labelKey: 'shortcut.group.search' },
  { id: 'view', labelKey: 'shortcut.group.view' }
];

export const ACTION_CATALOG = [
  { name: 'newFile', labelKey: 'shortcut.newFile', group: 'file' },
  { name: 'openFolder', labelKey: 'shortcut.openFolder', group: 'file' },
  { name: 'save', labelKey: 'shortcut.save', group: 'file' },
  { name: 'saveAs', labelKey: 'shortcut.saveAs', group: 'file' },
  { name: 'closeTab', labelKey: 'shortcut.closeTab', group: 'file' },
  { name: 'reloadFile', labelKey: 'toolbar.reload', group: 'file' },
  { name: 'rename', labelKey: 'shortcut.rename', group: 'file' },
  { name: 'undo', labelKey: 'shortcut.undo', readonly: true, defaultKey: 'Ctrl+Z', group: 'edit' },
  { name: 'redo', labelKey: 'shortcut.redo', readonly: true, defaultKey: 'Ctrl+Y', group: 'edit' },
  { name: 'cut', labelKey: 'shortcut.cut', readonly: true, defaultKey: 'Ctrl+X', group: 'edit' },
  { name: 'copy', labelKey: 'shortcut.copy', readonly: true, defaultKey: 'Ctrl+C', group: 'edit' },
  { name: 'paste', labelKey: 'shortcut.paste', readonly: true, defaultKey: 'Ctrl+V', group: 'edit' },
  { name: 'selectAll', labelKey: 'shortcut.selectAll', group: 'edit' },
  { name: 'deleteLine', labelKey: 'shortcut.deleteLine', group: 'edit' },
  { name: 'moveLineUp', labelKey: 'shortcut.moveLineUp', group: 'edit' },
  { name: 'moveLineDown', labelKey: 'shortcut.moveLineDown', group: 'edit' },
  { name: 'copyLineUp', labelKey: 'shortcut.copyLineUp', group: 'edit' },
  { name: 'copyLineDown', labelKey: 'shortcut.copyLineDown', group: 'edit' },
  { name: 'gotoLine', labelKey: 'shortcut.gotoLine', group: 'edit' },
  { name: 'gotoBracket', labelKey: 'shortcut.gotoBracket', group: 'edit' },
  { name: 'toggleComment', labelKey: 'shortcut.toggleComment', group: 'edit' },
  { name: 'selectAllMatches', labelKey: 'shortcut.selectAllMatches', group: 'edit' },
  { name: 'upperCase', labelKey: 'shortcut.upperCase', group: 'edit' },
  { name: 'lowerCase', labelKey: 'shortcut.lowerCase', group: 'edit' },
  { name: 'find', labelKey: 'shortcut.find', group: 'search' },
  { name: 'replace', labelKey: 'shortcut.replace', group: 'search' },
  { name: 'findSelection', labelKey: 'shortcut.findSelection', group: 'search' },
  { name: 'findSelectionPrev', labelKey: 'shortcut.findSelectionPrev', group: 'search' },
  { name: 'toggleTerminal', labelKey: 'shortcut.toggleTerminal', group: 'view' },
  { name: 'fold', labelKey: 'shortcut.fold', group: 'view' },
  { name: 'unfold', labelKey: 'shortcut.unfold', group: 'view' },
  { name: 'foldAll', labelKey: 'shortcut.foldAll', group: 'view' },
  { name: 'unfoldAll', labelKey: 'shortcut.unfoldAll', group: 'view' }
];

export const READONLY_ACTIONS = new Set(
  ACTION_CATALOG.filter((a) => a.readonly).map((a) => a.name)
);

const READONLY_PASSTHROUGH_KEYS = new Set(
  ACTION_CATALOG.filter((a) => a.readonly && a.defaultKey).map((a) => a.defaultKey)
);

export const DEFAULT_SHORTCUTS = {
  'Ctrl+S': 'save',
  'Ctrl+W': 'closeTab',
  'Ctrl+R': 'reloadFile',
  'Ctrl+A': 'selectAll',
  'Ctrl+D': 'deleteLine',
  'Ctrl+N': 'newFile',
  'Ctrl+O': 'openFolder',
  'Ctrl+Shift+S': 'saveAs',
  'Ctrl+`': 'toggleTerminal',
  'Alt+Down': 'moveLineDown',
  'Alt+Up': 'moveLineUp',
  'Ctrl+Alt+Up': 'copyLineUp',
  'Ctrl+Alt+Down': 'copyLineDown',
  'Ctrl+]': 'gotoBracket',
  'Ctrl+\\': 'toggleComment',
  'Ctrl+Shift+\\': 'toggleComment',
  'F2': 'rename',
  'Ctrl+Shift+[': 'fold',
  'Ctrl+Shift+]': 'unfold',
  'Ctrl+Alt+[': 'foldAll',
  'Ctrl+Alt+]': 'unfoldAll',
  'Ctrl+Shift+L': 'selectAllMatches',
  'Ctrl+U': 'upperCase',
  'Ctrl+L': 'lowerCase',
  'Ctrl+G': 'gotoLine',
  'Ctrl+F': 'find',
  'Ctrl+H': 'replace',
  'Ctrl+K': 'findSelection',
  'Ctrl+Shift+K': 'findSelectionPrev'
};

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);

/* Reverse-map symbols typed with Shift back to their physical key. Shift+\ becomes '|', but to match
   the 'Ctrl+Shift+\' binding it must be restored to the physical key '\' (US/KR layout). Fixes the
   common pitfall shared by all Shift+symbol shortcuts. */
const SHIFT_SYMBOLS = {
  '~': '`', '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/'
};

function normalizeKeyName(name) {
  if (!name) return '';
  if (name === ' ') return 'Space';
  if (name === 'Escape') return 'Esc';
  if (name === 'ArrowUp') return 'Up';
  if (name === 'ArrowDown') return 'Down';
  if (name === 'ArrowLeft') return 'Left';
  if (name === 'ArrowRight') return 'Right';
  if (/^F\d+$/i.test(name)) return name.toUpperCase();
  if (name.length === 1) return name.toUpperCase();
  return name;
}

// Normalize Ctrl/Cmd(Meta) to a single 'Ctrl' — one binding matches both Windows Ctrl and mac Cmd/Ctrl (no swap toggle needed).
export function eventToShortcutString(event) {
  const parts = [];
  if (event.ctrlKey || event.metaKey) parts.push('Ctrl');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  let k = normalizeKeyName(event.key);
  if (event.shiftKey && SHIFT_SYMBOLS[event.key]) k = SHIFT_SYMBOLS[event.key];
  if (!k || MODIFIER_KEYS.has(event.key)) return '';
  parts.push(k);
  return parts.join('+');
}

export function mountShortcuts({ getConfig, getHandlers, isActive }) {
  window.addEventListener('keydown', (event) => {
    if (typeof isActive === 'function' && !isActive()) return;
    if (MODIFIER_KEYS.has(event.key)) return;

    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    const keyStr = eventToShortcutString(event);

    // Don't intercept the editor's built-in shortcuts (undo/redo/cut/copy/paste) — let them pass through to CM6/browser.
    if (keyStr && READONLY_PASSTHROUGH_KEYS.has(keyStr)) return;

    const config = (getConfig && getConfig()) || {};
    let action = keyStr ? config[keyStr] : null;
    // Even if a readonly action is mapped in the saved config, we don't handle it.
    if (action && READONLY_ACTIONS.has(action)) return;

    if (action) {
      const handlers = (getHandlers && getHandlers()) || {};
      const handler = handlers[action];
      // Only intercept when a handler exists. If a removed action lingers in the saved config (e.g. an old Delete binding), let the key pass through.
      if (typeof handler === 'function') {
        event.preventDefault();
        event.stopImmediatePropagation();
        // If an IME composition is in progress, commit it before running the shortcut (blur→focus to commit). Running
        // before committing re-commits the composing character after the DOM is rebuilt, causing duplicate input (e.g. Hangul input immediately followed by Alt+Down duplicates the character on cursor move).
        if (event.isComposing || event.keyCode === 229) {
          const el = document.activeElement;
          if (el) { el.blur(); el.focus?.(); }
        }
        try { handler(event); } catch (err) { console.error('[shortcut]', action, err); }
      }
    }
  }, true);
}
