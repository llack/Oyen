import { EditorView, ViewPlugin } from '@codemirror/view';
import { HighlightStyle, StreamLanguage } from '@codemirror/language';
import { tags as tg } from '@lezer/highlight';

import { javascript } from '@codemirror/lang-javascript';
import { php } from '@codemirror/lang-php';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';

import { shell } from '@codemirror/legacy-modes/mode/shell';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { perl } from '@codemirror/legacy-modes/mode/perl';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { go } from '@codemirror/legacy-modes/mode/go';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { diff } from '@codemirror/legacy-modes/mode/diff';
import { rust } from '@codemirror/legacy-modes/mode/rust';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { groovy } from '@codemirror/legacy-modes/mode/groovy';
import { powerShell } from '@codemirror/legacy-modes/mode/powershell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { clojure } from '@codemirror/legacy-modes/mode/clojure';
import { haskell } from '@codemirror/legacy-modes/mode/haskell';
import { scheme } from '@codemirror/legacy-modes/mode/scheme';
import { cmake } from '@codemirror/legacy-modes/mode/cmake';
import { erlang } from '@codemirror/legacy-modes/mode/erlang';
import { tcl } from '@codemirror/legacy-modes/mode/tcl';
import { vb } from '@codemirror/legacy-modes/mode/vb';
import { vbScript } from '@codemirror/legacy-modes/mode/vbscript';
import { fSharp } from '@codemirror/legacy-modes/mode/mllike';
import { c, cpp, csharp, java, objectiveC, objectiveCpp, kotlin, scala, dart } from '@codemirror/legacy-modes/mode/clike';

import { languageFromFileName } from './language-map.js';

/* ───────── HighlightStyle (OYEN base, dark tone) ─────────
   A user-managed area. It has an entry for every lezer/highlight tag,
   so you can pick just the ones you want and adjust their colors. For now, new entries default to the base fg color (#d4d4d4). */
export const BASE_COLORS = {
  FG:       '#2c3a37',
  ACCENT:   '#c2780a',
  STRING:   '#b3261e',
  COMMENT:  '#146c2e',
  NUMBER:   '#3538cd',
  FUNCTION: '#dcdcaa',
  TYPE:     '#198639',
  TAG:      '#569cd6',
  PROPERTY: '#6b7d77'
};
const FG       = BASE_COLORS.FG;
const ACCENT   = BASE_COLORS.ACCENT;
const STRING   = BASE_COLORS.STRING;
const COMMENT  = BASE_COLORS.COMMENT;
const NUMBER   = BASE_COLORS.NUMBER;
const FUNCTION = BASE_COLORS.FUNCTION;
const TYPE     = BASE_COLORS.TYPE;
const TAG      = BASE_COLORS.TAG;
const PROPERTY = BASE_COLORS.PROPERTY;

export const oyenHighlight = HighlightStyle.define([
  /* keywords / modifiers */
  { tag: tg.keyword,                       color: ACCENT },
  { tag: tg.controlKeyword,                color: ACCENT },
  { tag: tg.operatorKeyword,               color: ACCENT },
  { tag: tg.definitionKeyword,             color: ACCENT },
  { tag: tg.moduleKeyword,                 color: ACCENT },
  { tag: tg.modifier,                      color: ACCENT },
  { tag: tg.self,                          color: ACCENT },

  /* strings / escapes */
  { tag: tg.string,                        color: STRING },
  { tag: tg.docString,                     color: STRING },
  { tag: tg.character,                     color: STRING },
  { tag: tg.special(tg.string),            color: STRING },
  { tag: tg.regexp,                        color: '#d19a66' },
  { tag: tg.escape,                        color: '#d19a66' },
  { tag: tg.color,                         color: FG },
  { tag: tg.url,                           color: TAG, textDecoration: 'underline' },

  /* comments */
  { tag: tg.comment,                       color: COMMENT },
  { tag: tg.lineComment,                   color: COMMENT },
  { tag: tg.blockComment,                  color: COMMENT },
  { tag: tg.docComment,                    color: '#7d9c7d' },

  /* literals / numbers */
  { tag: tg.literal,                       color: FG },
  { tag: tg.number,                        color: NUMBER },
  { tag: tg.integer,                       color: NUMBER },
  { tag: tg.float,                         color: NUMBER },
  { tag: tg.bool,                          color: NUMBER },
  { tag: tg.null,                          color: NUMBER },
  { tag: tg.atom,                          color: NUMBER },
  { tag: tg.unit,                          color: NUMBER },

  /* names / variables */
  { tag: tg.name,                          color: FG },
  { tag: tg.variableName,                  color: FG },
  { tag: tg.labelName,                     color: FG },
  { tag: tg.macroName,                     color: FG },
  { tag: tg.propertyName,                  color: PROPERTY },
  { tag: tg.attributeName,                 color: PROPERTY },
  { tag: tg.attributeValue,                color: STRING },
  { tag: tg.function(tg.variableName),     color: FUNCTION },
  { tag: tg.function(tg.propertyName),     color: FUNCTION },
  { tag: tg.definition(tg.variableName),   color: FUNCTION },
  { tag: tg.definition(tg.propertyName),   color: FUNCTION },
  { tag: tg.constant(tg.variableName),     color: NUMBER },
  { tag: tg.standard(tg.variableName),     color: FG },
  { tag: tg.local(tg.variableName),        color: FG },
  { tag: tg.special(tg.variableName),      color: ACCENT },

  /* types / classes */
  { tag: tg.typeName,                      color: TYPE },
  { tag: tg.className,                     color: TYPE },
  { tag: tg.namespace,                     color: TYPE },

  /* tags (HTML/XML) */
  { tag: tg.tagName,                       color: TAG },
  { tag: tg.angleBracket,                  color: '#aaa' },

  /* operators */
  { tag: tg.operator,                      color: FG },
  { tag: tg.derefOperator,                 color: FG },
  { tag: tg.arithmeticOperator,            color: FG },
  { tag: tg.logicOperator,                 color: FG },
  { tag: tg.bitwiseOperator,               color: FG },
  { tag: tg.compareOperator,               color: FG },
  { tag: tg.updateOperator,                color: FG },
  { tag: tg.definitionOperator,            color: FG },
  { tag: tg.typeOperator,                  color: FG },
  { tag: tg.controlOperator,               color: ACCENT },

  /* punctuation / brackets */
  { tag: tg.punctuation,                   color: '#aaa' },
  { tag: tg.separator,                     color: '#aaa' },
  { tag: tg.bracket,                       color: '#aaa' },
  { tag: tg.squareBracket,                 color: '#aaa' },
  { tag: tg.paren,                         color: '#aaa' },
  { tag: tg.brace,                         color: '#aaa' },

  /* markdown / content */
  /* tg.content (text between HTML tags, etc.) has no color specified → inherits the default text color (.cm-content / foreground). */
  { tag: tg.heading,                       color: ACCENT, fontWeight: '700' },
  { tag: tg.heading1,                      color: ACCENT, fontWeight: '700' },
  { tag: tg.heading2,                      color: ACCENT, fontWeight: '700' },
  { tag: tg.heading3,                      color: ACCENT, fontWeight: '700' },
  { tag: tg.heading4,                      color: ACCENT, fontWeight: '700' },
  { tag: tg.heading5,                      color: ACCENT, fontWeight: '700' },
  { tag: tg.heading6,                      color: ACCENT, fontWeight: '700' },
  { tag: tg.contentSeparator,              color: '#aaa' },
  { tag: tg.list,                          color: FG },
  { tag: tg.quote,                         color: COMMENT, fontStyle: 'italic' },
  { tag: tg.emphasis,                      fontStyle: 'italic' },
  { tag: tg.strong,                        fontWeight: '700' },
  { tag: tg.link,                          color: TAG, textDecoration: 'underline' },
  { tag: tg.monospace,                     color: STRING },
  { tag: tg.strikethrough,                 textDecoration: 'line-through' },

  /* diff */
  { tag: tg.inserted,                      color: '#a3c585' },
  { tag: tg.deleted,                       color: '#d16969' },
  { tag: tg.changed,                       color: '#dcdcaa' },

  /* meta / misc */
  { tag: tg.meta,                          color: '#888' },
  { tag: tg.documentMeta,                  color: '#888' },
  { tag: tg.annotation,                    color: '#888' },
  { tag: tg.processingInstruction,         color: '#888' },
  { tag: tg.invalid,                       color: '#d16969', textDecoration: 'underline wavy' }
]);

/* ───────── UI theme (dark, OYEN orange accent) ───────── */
export const oyenTheme = EditorView.theme({
  '&':                        { color: '#2c3a37', backgroundColor: '#ffffff', height: '100%', outline: 'none' },
  '&.cm-focused':             { outline: 'none' },
  '.cm-scroller':             { lineHeight: '1.5' },
  '.cm-content':              { caretColor: '#000000' },
  '&.cm-focused .cm-cursor':  { borderLeftColor: '#000000', borderLeftWidth: '2px' },
  '.cm-gutters':              { backgroundColor: '#ffffff', color: '#888888', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 4px', minWidth: '32px', textAlign: 'right' },
  '.cm-activeLine':           { backgroundColor: 'transparent', boxShadow: 'inset 0 1px 0 #d7d7d7, inset 0 -1px 0 #d7d7d7' },
  '&.cm-has-selection .cm-activeLine': { boxShadow: 'none' },
  '.cm-activeLineGutter':     { color: 'var(--accent)', backgroundColor: 'transparent' },
  /* On focus, the CM6 base pins the selection color with a high-specificity selector (&dark/light.cm-focused > .cm-scroller > .cm-selectionLayer ...)
     → oyen's default selection color must be raised to the same depth selector to win in the focused state. */
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { background: '#cfe6f9aa' },
  '.cm-selectionMatch':       { backgroundColor: 'rgba(194, 120, 10, 0.18)', outline: '1px solid rgba(194, 120, 10, 0.55)' },
  '.cm-searchMatch':          { backgroundColor: 'rgba(194, 120, 10, 0.25)', outline: '1px solid #c2780a' },
  '.cm-searchMatch-selected': { backgroundColor: 'rgba(194, 120, 10, 0.5)' },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'rgba(194, 120, 10, 0.2)', outline: '1px solid #c2780a' },
  /* PHP $ prefix: force the inner syntax-highlight class spans to inherit color/font,
     so `cm-php-dollar`'s inline style actually applies to the text (a plain inline color wouldn't win because child classes carry their own color). */
  '.cm-php-dollar *': {
    color: 'inherit !important',
    fontWeight: 'inherit !important',
    fontStyle: 'inherit !important'
  },
  /* Absorb PHP islands inside HTML comments (<!-- -->) into the comment color. The mark lays the color over the whole thing
     and forces the inner syntax/$ spans to inherit that color (cm6-syntax-colors buildHtmlCommentPlugin). */
  '.cm-html-comment *': {
    color: 'inherit !important',
    fontWeight: 'inherit !important',
    fontStyle: 'inherit !important'
  },
  /* Flatten nested CSS inside a style attribute value into a single attributeValue color (buildFlatAttrPlugin). */
  '.cm-flat-attr *': {
    color: 'inherit !important',
    fontWeight: 'inherit !important',
    fontStyle: 'inherit !important'
  },
  /* Unify the color of the # and the name in a CSS ID selector (#top) (buildCssIdSelectorPlugin). */
  '.cm-css-id *': {
    color: 'inherit !important',
    fontWeight: 'inherit !important',
    fontStyle: 'inherit !important'
  }
}, { dark: false });

/* Toggle the .cm-has-selection class on a selection or multi-cursor to hide the active line highlight (VS Code pattern).
   Multi-cursor (multiple empty cursors, Alt+drag column selection, etc.) is also hidden because the per-line highlights overlap like a staircase. */
export const hideActiveLineOnSelection = ViewPlugin.fromClass(class {
  constructor(view) { this.apply(view); }
  update(update) { if (update.selectionSet) this.apply(update.view); }
  apply(view) {
    const ranges = view.state.selection.ranges;
    const has = ranges.length > 1 || ranges.some((r) => !r.empty);
    view.dom.classList.toggle('cm-has-selection', has);
  }
});

/* ───────── Language dispatcher ─────────
   internal language id (language-map.js) → CM6 extension.
   Language-special tokens like PHP `$` are handled in cm6-syntax-colors.js based on settings. */
function clikeMode(name) {
  switch (name) {
    case 'c': return c;
    case 'cpp': return cpp;
    case 'csharp': return csharp;
    case 'java': return java;
    case 'objective-c': return objectiveC;
    case 'objective-cpp': return objectiveCpp;
    case 'kotlin': return kotlin;
    case 'scala': return scala;
    default: return null;
  }
}

export function extensionForLanguage(id) {
  switch (id) {
    case 'javascript':       return javascript({ jsx: false });
    case 'javascriptreact':  return javascript({ jsx: true });
    case 'typescript':       return javascript({ typescript: true });
    case 'typescriptreact':  return javascript({ jsx: true, typescript: true });
    case 'php':              return php({ plain: false });
    case 'css':              return css();
    case 'scss':             return css();
    case 'less':             return css();
    case 'html':             return html({ matchClosingTags: false });
    case 'json':             return json();
    case 'jsonc':            return json();
    case 'jsonl':            return json();
    case 'markdown':         return markdown();
    case 'python':           return python();
    case 'sql':              return sql();
    case 'xml':              return xml();
    case 'yaml':             return yaml();
    case 'shell':            return StreamLanguage.define(shell);
    case 'ruby':             return StreamLanguage.define(ruby);
    case 'perl':             return StreamLanguage.define(perl);
    case 'lua':              return StreamLanguage.define(lua);
    case 'dockerfile':       return StreamLanguage.define(dockerFile);
    case 'go':               return StreamLanguage.define(go);
    case 'properties':
    case 'ini':              return StreamLanguage.define(properties);
    case 'dotenv':           return StreamLanguage.define(properties);
    case 'diff':             return StreamLanguage.define(diff);
    case 'rust':             return StreamLanguage.define(rust);
    case 'swift':            return StreamLanguage.define(swift);
    case 'dart':             return StreamLanguage.define(dart);
    case 'groovy':           return StreamLanguage.define(groovy);
    case 'powershell':       return StreamLanguage.define(powerShell);
    case 'toml':             return StreamLanguage.define(toml);
    case 'clojure':          return StreamLanguage.define(clojure);
    case 'haskell':          return StreamLanguage.define(haskell);
    case 'scheme':           return StreamLanguage.define(scheme);
    case 'cmake':            return StreamLanguage.define(cmake);
    case 'erlang':           return StreamLanguage.define(erlang);
    case 'tcl':              return StreamLanguage.define(tcl);
    case 'vb':               return StreamLanguage.define(vb);
    case 'vbscript':         return StreamLanguage.define(vbScript);
    case 'fsharp':           return StreamLanguage.define(fSharp);
    default: {
      const cm = clikeMode(id);
      if (cm) return StreamLanguage.define(cm);
      return [];
    }
  }
}

export function extensionForFileName(name, content) {
  const id = languageFromFileName(name);
  // `.inc` files are often pure PHP without a `<?php` wrapper → decide plain/mixed by inspecting the content.
  // If the content starts with `<?`, it's mixed (HTML+PHP); otherwise plain (treat the whole file as PHP).
  if (id === 'php' && /\.inc$/i.test(String(name || ''))) {
    const trimmed = String(content || '').trimStart();
    return php({ plain: !trimmed.startsWith('<?') });
  }
  return extensionForLanguage(id);
}
