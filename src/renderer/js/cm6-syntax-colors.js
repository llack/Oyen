/**
 * The global base is `oyenHighlight` from `cm6-extensions.js`.
 * Per-language settings.syntaxColors override + per-language special group (e.g. PHP `$` prefix).
 */

import { HighlightStyle, syntaxHighlighting, syntaxTree, language } from '@codemirror/language';
import { EditorView, ViewPlugin, Decoration } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { tags as tg } from '@lezer/highlight';
import { phpLanguage } from '@codemirror/lang-php';
import { pythonLanguage } from '@codemirror/lang-python';
import { BASE_COLORS } from './cm6-extensions.js';

/* Global preview — HTML base. Shows tag/attribute/string/comment/text colors at a glance. */
export const GLOBAL_PREVIEW = {
  fileName: 'preview.html',
  code: `<!DOCTYPE html>
<!-- page comment -->
<html lang="en">
  <head>
    <title>Preview</title>
    <style>
      /* style comment */
      :root { --brand: #333; }
      .container {
        color: var(--brand);
        margin: 0 auto;
        background: url("bg.png") no-repeat;
        -webkit-transition: all 0.3s !important;
      }
      #main:hover { display: none; opacity: 0.5; }
    </style>
  </head>
  <body>
    <div class="container" id="main" data-count="3">
      <h1>Heading</h1>
      <a href="https://oyen.dev">link</a>
    </div>
    <script>
      /* block comment */
      import { Util } from "./util.js";

      class User extends Base {
        constructor(name) {
          this.name = name;        // line comment
          this.active = true;
          this.parent = null;
        }
        greet(count) {
          const re = /^[a-z]+$/i;
          const msg = "hi\\n" + this.name;
          return count > 0 ? Util.format(msg) : null;
        }
      }

      const user = new User("guest");
      console.log(user.greet(42), 3.14, [1, 2, 3]);
    </script>
  </body>
</html>
`
};

/* ───────── Supported languages ─────────
   Adding here automatically surfaces the language in the settings left-side list.
   `sample` is used by the live preview in the colors tab.
   `specialGroups` are token groups specific to that language (e.g. PHP `$` prefix). */
export const SUPPORTED_COLOR_LANGS = [
  {
    id: 'php',
    label: 'PHP',
    language: phpLanguage,
    sampleFileName: 'sample.php',
    sample: `<?php
// single-line comment
/* block comment */
namespace App\\Service;

class Greeter {
  private $prefix = 'Hello';
  public function greet($name = 'world') {
    $count = strlen($name);
    $msg = "{$this->prefix}, $name! ({$count})";
    echo $msg;
    return $count > 0;
  }
}

$g = new Greeter();
$g->greet('OYEN');
?>
<div class="card" id="root">
  <h1>Hi <?= htmlspecialchars($name) ?></h1>
</div>
`,
    specialGroups: [
      { id: 'phpDollar', labelKey: 'syntax.special.phpDollar', sample: '$name  $count', baseColor: '#0000FF', parent: 'variable', kind: 'php-dollar' }
    ]
  },
  {
    id: 'python',
    label: 'Python',
    language: pythonLanguage,
    sampleFileName: 'sample.py',
    sample: `# single-line comment
"""docstring"""
from typing import List

class Greeter:
    def __init__(self, prefix: str = "Hello"):
        self.prefix = prefix

    def greet(self, name: str = "world") -> bool:
        count = len(name)
        msg = f"{self.prefix}, {name}! ({count})"
        print(msg)
        return count > 0


g = Greeter()
g.greet("OYEN")
items: List[int] = [1, 2, 3]
ok = True
nope = None
pi = 3.14
`,
    specialGroups: []
  }
];

/* ───────── Group definitions ─────────
   sample is a short code snippet that only that group's color applies to. baseColor is the oyenHighlight default color. */
export const TOKEN_GROUPS = [
  /* Keyword — unified (general/control/definition/modifier all one color). */
  { id: 'keyword',         labelKey: 'syntax.token.keyword',     sample: 'if  function  class  return',  baseColor: '#0000FF',            tags: [tg.keyword, tg.controlKeyword, tg.definitionKeyword, tg.modifier, tg.self, tg.moduleKeyword, tg.operatorKeyword] },

  /* String / regexp / escape */
  { id: 'string',          labelKey: 'syntax.token.string',      sample: '"hello"  \\\'world\\\'', baseColor: '#ed6a43',            tags: [tg.string, tg.docString, tg.character, tg.special(tg.string)] },
  { id: 'regexp',          labelKey: 'syntax.token.regexp',      sample: '/[a-z]+/i',              baseColor: '#000000',            tags: [tg.regexp] },
  { id: 'escape',          labelKey: 'syntax.token.escape',      sample: '\\\\n  \\\\t  \\\\\\\\',  baseColor: '#000000',            tags: [tg.escape] },

  /* Comment */
  { id: 'comment',         labelKey: 'syntax.token.comment',     sample: '// note  /* block */',   baseColor: '#969896',            tags: [tg.comment, tg.lineComment, tg.blockComment, tg.docComment] },

  /* Number / boolean / null */
  { id: 'number',          labelKey: 'syntax.token.number',      sample: '42  3.14  0xff',         baseColor: '#0b57d0',            tags: [tg.number, tg.integer, tg.float] },
  { id: 'boolean',         labelKey: 'syntax.token.boolean',     sample: 'true  false',            baseColor: '#b90063',            tags: [tg.bool, tg.atom] },
  { id: 'null',            labelKey: 'syntax.token.null',        sample: 'null  None  nil',        baseColor: '#b90063',            tags: [tg.null] },

  /* Function — call / definition */
  { id: 'functionCall',    labelKey: 'syntax.token.functionCall', sample: 'doSomething()',         baseColor: '#800000',            tags: [tg.function(tg.variableName), tg.function(tg.propertyName)] },
  { id: 'functionDef',     labelKey: 'syntax.token.functionDef', sample: 'function greet() {}',    baseColor: '#800000',            tags: [tg.definition(tg.variableName), tg.definition(tg.propertyName)] },

  /* Variable / property */
  { id: 'variable',        labelKey: 'syntax.token.variable',    sample: 'name  count',            baseColor: '#008080',            tags: [tg.variableName, tg.name] },
  { id: 'property',        labelKey: 'syntax.token.property',    sample: 'obj.prop',               baseColor: '#008080',            tags: [tg.propertyName] },

  /* Class / type */
  { id: 'class',           labelKey: 'syntax.token.class',       sample: 'String  List  User',     baseColor: '#000000',            tags: [tg.typeName, tg.className, tg.namespace] },

  /* HTML */
  { id: 'tag',             labelKey: 'syntax.token.tag',         sample: '<div>  </span>',         baseColor: '#8e004b',            tags: [tg.tagName, tg.angleBracket] },
  { id: 'attribute',       labelKey: 'syntax.token.attribute',      sample: 'class  id  href',        baseColor: '#9f4312',            tags: [tg.attributeName] },
  { id: 'attributeValue',  labelKey: 'syntax.token.attributeValue', sample: '"container"  "main"',    baseColor: '#0842a0',            tags: [tg.attributeValue] },
  { id: 'color',           labelKey: 'syntax.token.color',          sample: '#333  #ffffff',         baseColor: '#b3261e',            tags: [tg.color] },

  /* Operator — unified (arithmetic/comparison/logic/assignment/bitwise all one color) */
  { id: 'operator',        labelKey: 'syntax.token.operator',    sample: '+  -  *  /  %  ->',      baseColor: '#800000',            tags: [tg.operator, tg.arithmeticOperator, tg.compareOperator, tg.logicOperator, tg.bitwiseOperator, tg.updateOperator, tg.definitionOperator, tg.derefOperator] },

  /* Brackets / punctuation */
  { id: 'punctuation',     labelKey: 'syntax.token.punctuation', sample: '( )  [ ]  { }  ,  ;',    baseColor: '#800000',            tags: [tg.punctuation, tg.bracket, tg.paren, tg.brace, tg.squareBracket, tg.separator, tg.processingInstruction] }
];

/* ───────── Editor UI color groups ─────────
   Editor canvas background, line numbers, current line, cursor, selection, etc.
   rules map to EditorView.theme spec selector + property. */
export const UI_GROUPS = [
  /* Default text color — plain text not covered by any token. */
  { id: 'foreground',     labelKey: 'syntax.ui.foreground',     baseColor: '#2c3a37', rules: [{ selector: '.cm-content', prop: 'color' }] },
  /* Unified editor + gutter background (same tone). */
  { id: 'background',     labelKey: 'syntax.ui.background',     baseColor: '#ffffff', rules: [
      { selector: '&', prop: 'backgroundColor' },
      { selector: '.cm-gutters', prop: 'backgroundColor' }
  ] },
  { id: 'lineNumber',     labelKey: 'syntax.ui.lineNumber',     baseColor: '#888888', rules: [{ selector: '.cm-gutters', prop: 'color' }] },
  /* Top/bottom line of the current line (not a background). Same color on both inset boxShadow lines.
     The line is hidden during selection — since the custom color is !important, the has-selection rule (none) must also be emitted to keep it hidden. */
  { id: 'activeLineBorder', labelKey: 'syntax.ui.activeLineBorder', baseColor: '#d7d7d7', rules: [
      { selector: '.cm-activeLine', prop: 'boxShadow', template: 'inset 0 1px 0 {c}, inset 0 -1px 0 {c}' },
      { selector: '&.cm-has-selection .cm-activeLine', prop: 'boxShadow', template: 'none' }
  ] },
  { id: 'activeLineNum',  labelKey: 'syntax.ui.activeLineNum',  baseColor: '#c2780a', rules: [{ selector: '.cm-activeLineGutter', prop: 'color' }] },
  { id: 'cursor',         labelKey: 'syntax.ui.cursor',         baseColor: '#000000', rules: [
      { selector: '.cm-content', prop: 'caretColor' },
      { selector: '&.cm-focused .cm-cursor', prop: 'borderLeftColor' }
  ] },
  { id: 'selection',      labelKey: 'syntax.ui.selection',      baseColor: '#cfe6f9', alpha: 'aa', rules: [
      { selector: '.cm-selectionBackground, &.cm-focused .cm-selectionBackground', prop: 'background' }
  ] },
  /* Unified orange highlight family — same word / search match / bracket match. One color, with fixed alpha/outline per use. */
  { id: 'highlight',      labelKey: 'syntax.ui.highlight',      baseColor: '#c2780a', rules: [
      { selector: '.cm-selectionMatch', prop: 'backgroundColor', alpha: '2e' },
      { selector: '.cm-searchMatch', prop: 'backgroundColor', alpha: '40' },
      { selector: '.cm-matchingBracket, &.cm-focused .cm-matchingBracket', prop: 'backgroundColor', alpha: '33' },
      { selector: '.cm-matchingBracket, &.cm-focused .cm-matchingBracket', prop: 'outline', template: '1px solid {c}' }
  ] }
];

/** Builds the UI color EditorView.theme spec. Pulls colors from settings.syntaxColors.ui.groups[id]. */
export function buildUiTheme(uiSettings) {
  const spec = {};
  let hasAny = false;
  for (const g of UI_GROUPS) {
    const entry = uiSettings?.groups?.[g.id];
    if (!entry?.color) continue;
    const base = String(entry.color).trim();
    for (const r of g.rules) {
      /* Per-rule alpha/template takes priority, falling back to group-level alpha. template substitutes the color into {c} (e.g. outline). */
      const alpha = r.alpha ?? g.alpha;
      const c = alpha ? `${base}${alpha}` : base;
      const value = r.template ? r.template.replace(/\{c\}/g, c) : c;
      spec[r.selector] = spec[r.selector] || {};
      /* User-defined UI colors must always beat the default oyenTheme (same selector), hence !important. */
      spec[r.selector][r.prop] = `${value} !important`;
    }
    hasAny = true;
  }
  return hasAny ? EditorView.theme(spec, { dark: false }) : null;
}

/* Example settings.syntaxColors[lang] shape:
   {
     groups: {
       keyword: { color: '#c2780a', bold: false, italic: false },
       string:  { color: '#a3c585' },
       ...
     },
     customWords: [
       { word: 'mysqli_query', color: '#ff6b9d', bold: true, italic: false }
     ]
   }
*/

function styleSpecOf(entry) {
  const spec = {};
  if (entry?.color) spec.color = entry.color;
  if (entry?.bold) spec.fontWeight = '700';
  if (entry?.italic) spec.fontStyle = 'italic';
  return spec;
}

/** Global HighlightStyle.
 *  Important: **always** emit a rule with an effective color for every TOKEN_GROUP.
 *  Why: when lezer/highlight can't match a modifier tag (`tg.function(tg.variableName)`) directly,
 *       it falls back to the base tag (`tg.variableName`). If the user only customizes `variable`,
 *       the `functionCall` rule is missing → it falls back to the variable rule, leaking the variable color onto function calls.
 *       Always laying down a base-color rule per group prevents that fallback. */
export function buildGlobalHighlightStyle(globalSettings) {
  const userGroups = globalSettings?.groups || {};
  const rules = [];
  for (const group of TOKEN_GROUPS) {
    const entry = userGroups[group.id];
    const color = (entry && entry.color) || group.baseColor;
    if (!color) continue;
    const bold = entry?.bold !== undefined ? entry.bold : !!group.baseBold;
    const italic = entry?.italic !== undefined ? entry.italic : !!group.baseItalic;
    /* The base oyenHighlight applies fontWeight:700 to keyword/type/functionDef,
       so when bold is turned off we must explicitly emit 'normal' to override the base (color already wins, but unspecified properties retain the base). */
    const spec = {
      color,
      fontWeight: bold ? '700' : 'normal',
      fontStyle: italic ? 'italic' : 'normal'
    };
    for (const tag of group.tags) {
      rules.push({ tag, ...spec });
    }
  }
  if (!rules.length) return null;
  return HighlightStyle.define(rules);
}

/* The custom decorations (php $ / html comment / flat-attr / css-id) toString the whole doc + regex-scan on every edit →
   keystroke lag on large files. Past this size (char count) the decorations are skipped (CM6's built-in syntax colors are incremental, so they stay). Single tuning point. */
const DECO_DOC_LIMIT = 1024 * 1024;   // 1MB

/** List of HTML comment (`<!-- -->`) ranges [from, to] in the document. Excludes `<!--` inside PHP strings/comments.
 *  Shared by buildHtmlCommentPlugin (comment-color mark) + buildPhpDollarPlugin ($ skip). */
function findHtmlCommentRanges(state) {
  const text = state.doc.toString();
  const tree = syntaxTree(state);
  const ranges = [];
  let i = 0;
  for (;;) {
    const open = text.indexOf('<!--', i);
    if (open < 0) break;
    const close = text.indexOf('-->', open + 4);
    const end = close < 0 ? text.length : close + 3;
    i = end;
    let skip = false;
    for (let n = tree.resolveInner(open + 1, 1); n; n = n.parent) {
      if (n.name === 'String' || n.name === 'LineComment' || n.name === 'BlockComment') { skip = true; break; }
    }
    if (!skip) ranges.push([open, end]);
  }
  return ranges;
}

/* ⚙️ Toggle: whether to also flatten event attributes (onclick, etc.) besides style. When false, events keep JS highlighting. */
const FLATTEN_EVENT_ATTRS = false;

/** List of quoted value ranges [from, to] of style (+ optionally event) attribute values.
 *  Shared by buildFlatAttrPlugin (single-color mark) + buildPhpDollarPlugin ($ skip).
 *  Since HTML is mounted as a PHP overlay, tree.iterate doesn't descend into Attribute, so we search directly with a regex,
 *  and exclude false matches inside PHP/JS strings/comments ($style="x", // style="x", etc.) via resolveInner. */
function findFlatAttrRanges(state) {
  const text = state.doc.toString();
  const tree = syntaxTree(state);
  const out = [];
  const re = FLATTEN_EVENT_ATTRS
    ? /\b(?:style|on[a-z-]+)\s*=\s*("[^"]*"|'[^']*')/gi
    : /\bstyle\s*=\s*("[^"]*"|'[^']*')/gi;
  let m;
  while ((m = re.exec(text))) {
    const valStart = m.index + m[0].length - m[1].length;
    const valEnd = m.index + m[0].length;
    let skip = false;
    for (let n = tree.resolveInner(valStart + 1, 1); n; n = n.parent) {
      const nm = n.name;
      if (nm === 'String' || nm === 'LineComment' || nm === 'BlockComment' || nm === 'Comment') { skip = true; break; }
    }
    if (!skip) out.push([valStart, valEnd]);
  }
  return out;
}

/** PHP `$` prefix decoration. Only active when the file's top language is 'php'.
 *  CSS specificity: child syntax-highlight class spans carry their own `color`, so the parent inline color can't win.
 *  → Add a `cm-php-dollar` class + the `.cm-php-dollar * { color: inherit !important }` rule in `oyenTheme`. */
function buildPhpDollarPlugin(entry) {
  /* font-weight/style are always specified — without them they'd inherit the parent (variable token) bold/italic and the toggle wouldn't work. */
  const style = [
    entry?.color ? `color:${entry.color}` : '',
    `font-weight:${entry?.bold ? '700' : 'normal'}`,
    `font-style:${entry?.italic ? 'italic' : 'normal'}`
  ].filter(Boolean).join(';');
  if (!style) return null;
  const mark = Decoration.mark({
    attributes: { class: 'cm-php-dollar', style }
  });

  return ViewPlugin.fromClass(class {
    decorations = Decoration.none;
    constructor(view) { this.decorations = this.build(view); }
    update(u) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = this.build(u.view);
      }
    }
    build(view) {
      const state = view.state;
      if (state.doc.length > DECO_DOC_LIMIT) return Decoration.none;   // large-file guard
      if (state.facet(language)?.name !== 'php') return Decoration.none;
      /* A $ inside an HTML comment or a flattened attribute (style/event) must follow that region's color, so don't decorate it
         (phpDollar is an inline color, so the CSS inheritance override doesn't apply). */
      const skipRanges = [...findHtmlCommentRanges(state), ...findFlatAttrRanges(state)];
      const inSkip = (pos) => skipRanges.some(([a, b]) => pos >= a && pos < b);
      const builder = new RangeSetBuilder();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
          from, to,
          enter(node) {
            if (node.name !== 'VariableName') return;
            const ch = state.doc.sliceString(node.from, node.from + 1);
            if (ch === '$' && !inSkip(node.from)) builder.add(node.from, node.from + 1, mark);
          }
        });
      }
      return builder.finish();
    }
  }, { decorations: (v) => v.decorations });
}

/** Forces PHP inside an HTML comment (`<!-- -->`) to the comment color.
 *  Since PHP is the top parser, the `<?php` island in `<!-- <?php ... ?> -->` ignores the comment and gets highlighted as code.
 *  → Cover the entire `<!-- -->` range with a mark and absorb the inner color via oyenTheme's `.cm-html-comment *` inherit rule.
 *  Only active on php files (facet language). Excludes `<!--` inside PHP strings. */
function buildHtmlCommentPlugin(entry) {
  const style = [
    entry?.color ? `color:${entry.color}` : '',
    entry?.bold ? 'font-weight:700' : '',
    entry?.italic ? 'font-style:italic' : ''
  ].filter(Boolean).join(';');
  if (!style) return null;
  const mark = Decoration.mark({ attributes: { class: 'cm-html-comment', style } });

  return ViewPlugin.fromClass(class {
    decorations = Decoration.none;
    constructor(view) { this.decorations = this.build(view); }
    update(u) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view) {
      const state = view.state;
      if (state.doc.length > DECO_DOC_LIMIT) return Decoration.none;   // large-file guard
      if (state.facet(language)?.name !== 'php') return Decoration.none;
      const ranges = findHtmlCommentRanges(state);
      if (!ranges.length) return Decoration.none;
      // Clip to the visible range (OK even if the comment starts outside the viewport).
      const out = [];
      for (const [cf, ct] of ranges) {
        for (const { from, to } of view.visibleRanges) {
          const a = Math.max(cf, from);
          const b = Math.min(ct, to);
          if (a < b) out.push([a, b]);
        }
      }
      if (!out.length) return Decoration.none;
      out.sort((x, y) => x[0] - y[0]);
      const builder = new RangeSetBuilder();
      for (const [a, b] of out) builder.add(a, b, mark);
      return builder.finish();
    }
  }, { decorations: (v) => v.decorations });
}

/** Flattens nested CSS/JS highlighting inside style (+ optionally event) attribute values to a single attributeValue color.
 *  Target ranges come from findFlatAttrRanges (toggled by FLATTEN_EVENT_ATTRS); the inner color is absorbed by oyenTheme's `.cm-flat-attr *`.
 *  Ordinary attribute values are always left as-is. */
function buildFlatAttrPlugin(entry) {
  const style = [
    entry?.color ? `color:${entry.color}` : '',
    entry?.bold ? 'font-weight:700' : '',
    entry?.italic ? 'font-style:italic' : ''
  ].filter(Boolean).join(';');
  if (!style) return null;
  const mark = Decoration.mark({ attributes: { class: 'cm-flat-attr', style } });

  return ViewPlugin.fromClass(class {
    decorations = Decoration.none;
    constructor(view) { this.decorations = this.build(view); }
    update(u) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view) {
      const state = view.state;
      if (state.doc.length > DECO_DOC_LIMIT) return Decoration.none;   // large-file guard
      const langName = state.facet(language)?.name;
      if (langName !== 'php' && langName !== 'html') return Decoration.none;
      const ranges = findFlatAttrRanges(state);
      if (!ranges.length) return Decoration.none;
      const builder = new RangeSetBuilder();
      for (const [a, b] of ranges) builder.add(a, b, mark);
      return builder.finish();
    }
  }, { decorations: (v) => v.decorations });
}

/** Colors a CSS ID selector (`#top`) as a single color throughout. lezer-css tags `#` as derefOperator and the name as IdName,
 *  so the `#` and the name get different colors, but derefOperator is shared with PHP `->`, so the token color can't fix CSS alone.
 *  → Find `#name` via regex + resolveInner (excluding ColorLiteral/strings, descending into overlay CSS too), mark the whole IdSelector range,
 *    and absorb the inner color via the oyenTheme `.cm-css-id *` inherit rule. Only active on css/php/html. */
function buildCssIdSelectorPlugin(entry) {
  const style = [
    entry?.color ? `color:${entry.color}` : '',
    entry?.bold ? 'font-weight:700' : '',
    entry?.italic ? 'font-style:italic' : ''
  ].filter(Boolean).join(';');
  if (!style) return null;
  const mark = Decoration.mark({ attributes: { class: 'cm-css-id', style } });
  const CSS_LANGS = new Set(['css', 'php', 'html']);

  return ViewPlugin.fromClass(class {
    decorations = Decoration.none;
    constructor(view) { this.decorations = this.build(view); }
    update(u) {
      if (u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view) {
      const state = view.state;
      if (state.doc.length > DECO_DOC_LIMIT) return Decoration.none;   // large-file guard
      if (!CSS_LANGS.has(state.facet(language)?.name)) return Decoration.none;
      const text = state.doc.toString();
      const tree = syntaxTree(state);
      const out = [];
      const re = /#[A-Za-z_-][\w-]*/g;
      let m;
      while ((m = re.exec(text))) {
        const node = tree.resolveInner(m.index + 1, 1);
        if (node.name !== 'IdName') continue; // color values (#fff), strings, and comments aren't IdName, so they're excluded
        const sel = node.parent;
        if (sel && sel.name === 'IdSelector') out.push([sel.from, sel.to]);
        else out.push([m.index, m.index + m[0].length]);
      }
      if (!out.length) return Decoration.none;
      out.sort((a, b) => a[0] - b[0]);
      const builder = new RangeSetBuilder();
      for (const [a, b] of out) builder.add(a, b, mark);
      return builder.finish();
    }
  }, { decorations: (v) => v.decorations });
}

/**
 * Combines global colors (shared by all languages) + per-language special groups / customWords into an extension array.
 * settings shape:
 *   { global: { groups }, php: { groups, customWords }, python: { groups, customWords } }
 */
export function buildSyntaxColorExtensions(syntaxColorsSettings) {
  const exts = [];

  // 1. Global highlight (no scope, all languages)
  const globalStyle = buildGlobalHighlightStyle(syntaxColorsSettings?.global);
  if (globalStyle) exts.push(syntaxHighlighting(globalStyle));

  // 1.5. Editor UI (background/gutter/current line, etc.)
  const uiTheme = buildUiTheme(syntaxColorsSettings?.ui);
  if (uiTheme) exts.push(uiTheme);

  // 1.6. Absorb the PHP island inside an HTML comment into the comment color (only active on php files).
  const commentGroup = TOKEN_GROUPS.find((g) => g.id === 'comment');
  const cEntry = syntaxColorsSettings?.global?.groups?.comment;
  const htmlCommentPlug = buildHtmlCommentPlugin({
    color: cEntry?.color || commentGroup?.baseColor,
    bold: cEntry?.bold !== undefined ? cEntry.bold : !!commentGroup?.baseBold,
    italic: cEntry?.italic !== undefined ? cEntry.italic : !!commentGroup?.baseItalic
  });
  if (htmlCommentPlug) exts.push(htmlCommentPlug);

  // 1.7. Flatten nested CSS inside style attribute values to a single attributeValue color.
  const avGroup = TOKEN_GROUPS.find((g) => g.id === 'attributeValue');
  const avEntry = syntaxColorsSettings?.global?.groups?.attributeValue;
  const flatAttrPlug = buildFlatAttrPlugin({
    color: avEntry?.color || avGroup?.baseColor,
    bold: avEntry?.bold !== undefined ? avEntry.bold : !!avGroup?.baseBold,
    italic: avEntry?.italic !== undefined ? avEntry.italic : !!avGroup?.baseItalic
  });
  if (flatAttrPlug) exts.push(flatAttrPlug);

  // 1.8. Color a CSS ID selector (#top) as a single color — use the class group color to match the class selector (.foo).
  const classGroup = TOKEN_GROUPS.find((g) => g.id === 'class');
  const classEntry = syntaxColorsSettings?.global?.groups?.class;
  const cssIdPlug = buildCssIdSelectorPlugin({
    color: classEntry?.color || classGroup?.baseColor,
    bold: classEntry?.bold !== undefined ? classEntry.bold : !!classGroup?.baseBold,
    italic: classEntry?.italic !== undefined ? classEntry.italic : !!classGroup?.baseItalic
  });
  if (cssIdPlug) exts.push(cssIdPlug);

  // 2. Per-language special groups — always emitted, falling back to baseColor when there's no entry.
  for (const langDef of SUPPORTED_COLOR_LANGS) {
    const langSettings = syntaxColorsSettings?.[langDef.id];

    if (langDef.id === 'php') {
      const groupDef = langDef.specialGroups.find((g) => g.id === 'phpDollar');
      const entry = langSettings?.groups?.phpDollar;
      if (groupDef) {
        const effective = {
          color: entry?.color || groupDef.baseColor,
          bold: entry?.bold !== undefined ? entry.bold : !!groupDef.baseBold,
          italic: entry?.italic !== undefined ? entry.italic : !!groupDef.baseItalic
        };
        const dollarPlug = buildPhpDollarPlugin(effective);
        if (dollarPlug) exts.push(dollarPlug);
      }
    }
  }
  return exts;
}
