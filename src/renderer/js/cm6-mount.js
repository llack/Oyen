import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { EditorState, EditorSelection, Annotation, Compartment } from '@codemirror/state';
import { syntaxHighlighting, indentUnit, foldGutter, foldCode, unfoldCode, foldAll, unfoldAll, indentOnInput, defaultHighlightStyle, bracketMatching } from '@codemirror/language';
import { indentMore, indentLess, undo, redo, selectAll, deleteLine, moveLineUp, moveLineDown, copyLineUp, copyLineDown, cursorMatchingBracket, toggleComment, simplifySelection, history, standardKeymap } from '@codemirror/commands';
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, selectSelectionMatches, search } from '@codemirror/search';
import { showMinimap } from '@replit/codemirror-minimap';
import { oyenTheme, oyenHighlight, extensionForFileName, hideActiveLineOnSelection } from './cm6-extensions.js';
import { buildSyntaxColorExtensions } from './cm6-syntax-colors.js';
import { monoFontStack } from './fonts.js';
import { gitDiffExtension, diffMarkersField } from './git-diff-gutter.js';
import { urlLinkExtension } from './cm6-url-link.js';

/* Compartment: when settings.syntaxColors changes, reconfigure applies it immediately. */
export const syntaxColorsCompartment = new Compartment();
/* Compartment: applies editor options (font/wordWrap/lineNumbers) immediately. */
export const editorOptionsCompartment = new Compartment();
/* The indent unit varies per tab (tab/space, content detection), so keep it separate from the options compartment. Live reconfigure on settings change. */
const indentCompartment = new Compartment();

function tabSizeOf(opts) {
  const n = Number(opts?.tabSize);
  return Number.isFinite(n) && n > 0 ? n : 4;
}

/** Auto-detect the indent unit from file content (VSCode-style, statistics based).
   Replaces the old approach that was swayed by a single first line (false positives on
   3-space alignment or blank lines in tab-indented files):
   - If more lines are tab-indented than space-indented, use tab.
   - For spaces, collect the indent increase (step) relative to the previous line and use the mode (e.g. 2/4) as the unit. */
function detectIndent(content) {
  const lines = String(content || '').split('\n');
  const limit = Math.min(lines.length, 10000);
  let tabLines = 0;
  let spaceLines = 0;
  const stepVotes = new Map();   // indent increase (1~8) → votes
  let prevSpaces = 0;
  for (let i = 0; i < limit; i += 1) {
    const line = lines[i];
    if (!line || !/\S/.test(line)) continue;        // skip empty / whitespace-only lines
    if (line[0] === '\t') { tabLines += 1; prevSpaces = 0; continue; }
    const m = /^( +)\S/.exec(line);
    if (!m) { prevSpaces = 0; continue; }            // line with no indent
    const indent = m[1].length;
    spaceLines += 1;
    const step = indent - prevSpaces;
    if (step >= 1 && step <= 8) stepVotes.set(step, (stepVotes.get(step) || 0) + 1);
    prevSpaces = indent;
  }
  if (tabLines > spaceLines) return '\t';
  if (spaceLines === 0) return null;
  let best = 4, bestVotes = 0;
  for (const [step, votes] of stepVotes) {
    if (votes > bestVotes) { best = step; bestVotes = votes; }
  }
  return ' '.repeat(best);                            // no step votes (monotonic indent) → default to 4 spaces
}

function buildOptionsTheme(opts) {
  const fontSize = `${Number(opts?.fontSize) || 14}px`;
  const fontFamily = monoFontStack();   // font-change feature removed — always --font-mono
  return EditorView.theme({ '.cm-scroller': { fontSize, fontFamily } });
}

/* Read the --git-* variables from tokens.css once at mount time. A reload is needed on theme change. */
function readGitColors() {
  const cs = getComputedStyle(document.documentElement);
  return {
    add: cs.getPropertyValue('--git-untracked').trim() || '#73c991',
    mod: cs.getPropertyValue('--git-gutter-modified').trim() || '#2280f0',
    del: cs.getPropertyValue('--git-deleted').trim() || '#f48771'
  };
}

function markersToMinimapGutter(state, colors) {
  const markers = state.field(diffMarkersField, false);
  if (!markers || markers.size === 0) return undefined;
  const gutter = {};
  for (const [line, type] of markers) {
    gutter[line] = colors[type] || colors.mod;
  }
  return [gutter];
}

function buildMinimapExtension(opts) {
  // Active unless settings.editor.minimap is explicitly false. On by default.
  if (opts?.minimap === false) return null;
  const colors = readGitColors();
  /* Keeping diffMarkersField as a dependency makes the minimap gutters recompute automatically when markers change. */
  return showMinimap.compute([diffMarkersField], (state) => ({
    create: () => ({ dom: document.createElement('div') }),
    displayText: 'blocks',
    showOverlay: 'always',
    gutters: markersToMinimapGutter(state, colors)
  }));
}

function buildOptionsExtensions(opts) {
  const exts = [];
  exts.push(buildOptionsTheme(opts));
  if (opts?.wordWrap === 'on') exts.push(EditorView.lineWrapping);
  exts.push(EditorState.tabSize.of(tabSizeOf(opts)));
  const mini = buildMinimapExtension(opts);
  if (mini) exts.push(mini);
  return exts;
}

/* Marker so mirrored doc-change transactions don't get re-mirrored. */
const Mirrored = Annotation.define();

/* Inline clone of basicSetup (codemirror package) — to keep only "what the user defined" as default keys.
   Key point: replace the default keymap, defaultKeymap → standardKeymap.
   - standardKeymap = essential editing only: cursor movement/selection (Shift)/word deletion/Enter/select-all, etc.
   - Everything defaultKeymap layered on — comment toggle (Ctrl+/), line delete (Shift+Ctrl+K), line duplicate
     (Shift+Alt+↑↓), multi-cursor (Ctrl+Shift+L, etc.), syntactic selection (Alt+L/Ctrl+I), dedent (Ctrl+[),
     TabFocus (Ctrl+M), etc. — is dropped. These actions run only via keys the user defined in shortcuts.js
     (capture phase; the app handler calls editor methods directly).
   search/fold/completion/lint keymaps are excluded — search keys (Ctrl+F/H, Ctrl+K/Ctrl+Shift+K) are handled by
   shortcuts.js app shortcuts that open our own search-ui.js (the search() extension only holds state/highlights,
   it never shows the default panel). Autocomplete/lint unused.
   historyKeymap is not used wholesale either — only undo/redo are explicitly bound, undoSelection (Ctrl+U)/redoSelection (Alt+U) removed.
   Folding is registered via shortcuts.js fold/unfold/foldAll/unfoldAll actions instead of the library foldKeymap —
   so it shows up in the shortcut list and is rebindable (the app handler calls editor.fold(), etc.). foldGutter mouse folding is kept.
   Non-keymap extensions (gutter/draw-selection/bracket-matching, etc.) are kept as in basicSetup.
   autocompletion is unified into createTabState's single override:[] instance, so it's excluded here.
   ⚠️ On package updates, compare against the original basicSetup (node_modules/codemirror/dist) to check for non-keymap extension changes. */
const oyenBasicSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...standardKeymap,
    /* Esc = clear selection (multi-selection → main range, selection → cursor). Returns false when there's no selection → falls through to other Esc handling. */
    { key: 'Escape', run: simplifySelection },
    /* Only undo/redo instead of the whole historyKeymap — undoSelection (Ctrl+U)/redoSelection (Alt+U) unused. */
    { key: 'Mod-z', run: undo, preventDefault: true },
    { key: 'Mod-y', mac: 'Mod-Shift-z', run: redo, preventDefault: true }
  ])
];

/* Tab key:
   - Selection spanning multiple lines → block indent (indentMore).
   - Selection within a single line (whitespace, etc.) → overwrite the selection with indentUnit (replaceSelection) — type-over like normal text input.
   - Empty cursor → insert the indent unit (indentUnit = auto-detected tab/space) at the cursor.
   The default indentWithTab indented the whole line even with an empty cursor, and a single-line selection only pushed the line start, which felt awkward → replaced.
   Shift+Tab stays as dedent (indentLess). */
const indentTabBinding = {
  key: 'Tab',
  run: (view) => {
    const { state } = view;
    const spansMultipleLines = state.selection.ranges.some((r) =>
      !r.empty && state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number);
    if (spansMultipleLines) return indentMore(view);
    view.dispatch(state.update(state.replaceSelection(state.facet(indentUnit)), {
      scrollIntoView: true,
      userEvent: 'input'
    }));
    return true;
  },
  shift: indentLess
};

/**
 * Persistent primary EditorView. State swapped per tab via setActiveState().
 * In split mode, doc changes mirror to a secondary view while selection/scroll stay independent.
 */
/* Ctrl+wheel = fast vertical scroll (not font zoom — zoom is the toolbar ± buttons). Jumps a multiple of the default scroll amount. */
const FAST_WHEEL_FACTOR = 10;
function attachFastWheelScroll(view) {
  view.scrollDOM.addEventListener('wheel', (event) => {
    if (!event.ctrlKey || event.metaKey || !event.deltaY) return;
    event.preventDefault();   // block Chromium's default Ctrl+wheel zoom
    let delta = event.deltaY;
    if (event.deltaMode === 1) delta *= 16;                               // line → px approximation
    else if (event.deltaMode === 2) delta *= view.scrollDOM.clientHeight;  // page → px
    view.scrollDOM.scrollTop += delta * FAST_WHEEL_FACTOR;
  }, { passive: false });
}

export function createCm6Editor(host) {
  let secondary = null;

  const view = new EditorView({
    parent: host,
    state: EditorState.create({ doc: '' }),
    dispatch: (tr) => {
      view.update([tr]);
      if (secondary && tr.docChanged && !tr.annotation(Mirrored)) {
        secondary.dispatch({
          changes: tr.changes,
          annotations: [Mirrored.of(true)]
        });
      }
    }
  });
  attachFastWheelScroll(view);

  /* Run editor-only commands on the active view (the focused side when split). A CM6 command takes an EditorView —
     some, like deleteLine, use view methods (moveVertically, etc.), so {state,dispatch} alone isn't enough.
     EditorView.dispatch is bound in the constructor, so passing the whole view to a StateCommand is safe. */
  const runCmd = (cmd) => cmd((secondary && secondary.hasFocus) ? secondary : view);

  /* Transform selected text (case, etc.). Applied to each of multiple selections; no-op (false) when there's no selection.
     If the replacement length is the same, CM6 keeps the selection → it stays selected after the transform. */
  const transformSelection = (fn) => {
    const v = (secondary && secondary.hasFocus) ? secondary : view;
    const ranges = v.state.selection.ranges.filter((r) => !r.empty);
    if (!ranges.length) return false;
    v.dispatch(v.state.update({
      changes: ranges.map((r) => ({ from: r.from, to: r.to, insert: fn(v.state.sliceDoc(r.from, r.to)) })),
      userEvent: 'input'
    }));
    v.focus();
    return true;
  };

  return {
    view,
    dispose() { try { view.destroy(); } catch (_) {} },
    focus() { view.focus(); },
    setActiveState(state) {
      view.setState(state);
      if (secondary) secondary.setState(state);
    },
    getDoc() { return view.state.doc.toString(); },
    getSecondary: () => secondary,
    /**
     * Create a secondary EditorView sharing the primary's current doc.
     * Doc changes mirror both ways; selection/scroll independent.
     */
    createSecondary(parent) {
      const sec = new EditorView({
        parent,
        state: view.state,
        dispatch: (tr) => {
          sec.update([tr]);
          if (tr.docChanged && !tr.annotation(Mirrored)) {
            view.dispatch({
              changes: tr.changes,
              annotations: [Mirrored.of(true)]
            });
          }
        }
      });
      attachFastWheelScroll(sec);
      secondary = sec;
      return sec;
    },
    clearSecondary() {
      if (secondary) {
        try { secondary.destroy(); } catch (_) {}
        secondary = null;
      }
    },
    undo:    () => undo({ state: view.state, dispatch: view.dispatch.bind(view) }),
    redo:    () => redo({ state: view.state, dispatch: view.dispatch.bind(view) }),
    selectAll: () => selectAll({ state: view.state, dispatch: view.dispatch.bind(view) }),
    deleteLine: () => runCmd(deleteLine),
    moveLineUp: () => runCmd(moveLineUp),
    moveLineDown: () => runCmd(moveLineDown),
    copyLineUp: () => runCmd(copyLineUp),
    copyLineDown: () => runCmd(copyLineDown),
    gotoBracket: () => runCmd(cursorMatchingBracket),
    toggleComment: () => runCmd(toggleComment),
    fold: () => runCmd(foldCode),
    unfold: () => runCmd(unfoldCode),
    foldAll: () => runCmd(foldAll),
    unfoldAll: () => runCmd(unfoldAll),
    /* Select all text matching the selection as multi-cursors. Returns false when there's no selection (does nothing). */
    selectAllMatches: () => runCmd(selectSelectionMatches),
    /* Clipboard/delete operate on secondary only when focus is on secondary, otherwise primary. */
    activeView: () => (secondary && secondary.hasFocus ? secondary : view),
    cutSelection: async () => {
      const v = (secondary && secondary.hasFocus) ? secondary : view;
      const sel = v.state.selection.main;
      if (sel.empty) return false;
      const text = v.state.sliceDoc(sel.from, sel.to);
      try { await navigator.clipboard.writeText(text); } catch (_) { return false; }
      /* State may change across the await, so dispatch based on the current selection. */
      v.dispatch(v.state.replaceSelection(''));
      v.focus();
      return true;
    },
    copySelection: async () => {
      const v = (secondary && secondary.hasFocus) ? secondary : view;
      const sel = v.state.selection.main;
      if (sel.empty) return false;
      const text = v.state.sliceDoc(sel.from, sel.to);
      try { await navigator.clipboard.writeText(text); } catch (_) { return false; }
      v.focus();
      return true;
    },
    pasteAtSelection: async () => {
      const v = (secondary && secondary.hasFocus) ? secondary : view;
      let text = '';
      try { text = await navigator.clipboard.readText(); } catch (_) { return false; }
      if (!text) return false;
      /* replaceSelection builds the transaction based on the current selection, so it's race safe. */
      v.dispatch(v.state.replaceSelection(text));
      v.focus();
      return true;
    },
    deleteSelection: () => {
      const v = (secondary && secondary.hasFocus) ? secondary : view;
      if (v.state.selection.main.empty) return false;
      v.dispatch(v.state.replaceSelection(''));
      v.focus();
      return true;
    },
    upperCase: () => transformSelection((s) => s.toUpperCase()),
    lowerCase: () => transformSelection((s) => s.toLowerCase()),
    /* Current line number (1-based) and total line count — for the go-to-line dialog prefill/range (primary view). */
    getLineInfo: () => {
      const doc = view.state.doc;
      return { current: doc.lineAt(view.state.selection.main.head).number, total: doc.lines };
    },
    /* Move the cursor to a specific line (1-based) + scroll — for jumping right after opening a file (primary view). */
    gotoLine: (line) => {
      const total = view.state.doc.lines;
      const l = view.state.doc.line(Math.max(1, Math.min(line, total)));
      /* scrollIntoView:true scrolls minimally, so a definition near the end gets stuck at the bottom of the screen → center it. */
      view.dispatch({
        selection: EditorSelection.cursor(l.from),
        effects: EditorView.scrollIntoView(l.from, { y: 'center' })
      });
      view.focus();
    },
    updateOptions() {}
  };
}

/**
 * Build a fresh EditorState for an opened tab. `onUpdate(update)` fires on every transaction.
 * `syntaxColorsSettings` is `settings.syntaxColors` (per-language token color overrides + user word highlights).
 */
function resolveIndent(content, opts) {
  /* User setting (indentType) takes precedence over auto-detection.
     - 'tab'   → tab
     - 'space' → tabSize spaces
     - 'auto' (default) → detect from the file, falling back to tabSize spaces */
  const size = tabSizeOf(opts);
  const type = opts?.indentType;
  if (type === 'tab') return '\t';
  if (type === 'space') return ' '.repeat(size);
  return detectIndent(content) || ' '.repeat(size);
}

/** For the status bar — describes the currently applied indent unit (reflecting the user setting first). */
export function indentDescriptor(content, opts) {
  const unit = resolveIndent(content, opts);
  return unit === '\t' ? { tab: true } : { tab: false, size: unit.length };
}

export function createTabState(content, fileName, userOptions, onUpdate, syntaxColorsSettings) {
  const indent = resolveIndent(content, userOptions);
  return EditorState.create({
    doc: content,
    extensions: [
      oyenBasicSetup,
      oyenTheme,
      hideActiveLineOnSelection,
      extensionForFileName(fileName, content),
      syntaxColorsCompartment.of(buildSyntaxColorExtensions(syntaxColorsSettings || {})),
      syntaxHighlighting(oyenHighlight),
      /* Search state + match highlights only — never shows the default panel (no openSearchPanel call). Driven by our own search-ui.js. */
      search(),
      urlLinkExtension,
      /* Autocomplete off — override:[] removes the source (no auto popup, no Ctrl+Space). Lightweight editor tone (not an IDE). */
      autocompletion({ override: [] }),
      /* scrollPastEnd unused: the trailing document margin only inflated scrollHeight, which misaligned the minimap overlay at the bottom. */
      editorOptionsCompartment.of(buildOptionsExtensions(userOptions)),
      indentCompartment.of(indentUnit.of(indent)),
      keymap.of([indentTabBinding]),
      gitDiffExtension,
      EditorView.updateListener.of((update) => {
        if (typeof onUpdate === 'function') onUpdate(update);
      })
    ]
  });
}

/** Apply the new syntaxColors settings to all views + cached states. */
export function reconfigureSyntaxColors(views, tabs, syntaxColorsSettings) {
  const newExt = buildSyntaxColorExtensions(syntaxColorsSettings || {});
  const effects = syntaxColorsCompartment.reconfigure(newExt);
  for (const view of views) {
    if (view) view.dispatch({ effects });
  }
  for (const tab of tabs) {
    if (tab?.state) tab.state = tab.state.update({ effects }).state;
  }
}

/** Apply the new editor options (font/wordWrap/lineNumbers) to all views + cached states. */
export function reconfigureEditorOptions(views, tabs, opts) {
  const optEffect = editorOptionsCompartment.reconfigure(buildOptionsExtensions(opts));
  /* Indent is based on each tab's content (auto-detect preserves tab/space) + setting first. Reconfigure per tab. */
  const indentEffectFor = (doc) =>
    indentCompartment.reconfigure(indentUnit.of(resolveIndent(doc, opts)));
  for (const view of views) {
    if (view) view.dispatch({ effects: [optEffect, indentEffectFor(view.state.doc.toString())] });
  }
  for (const tab of tabs) {
    if (tab?.state) tab.state = tab.state.update({ effects: [optEffect, indentEffectFor(tab.state.doc.toString())] }).state;
  }
  /* The minimap (ViewPlugin) lagged its render right after reconfigure when unfocused — focus the active view. */
  if (views[0]) views[0].focus();
}
