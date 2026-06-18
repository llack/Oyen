import { EditorView, Decoration, MatchDecorator, ViewPlugin } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';

/* URL/path links (VSCode tone):
   - URL (http/https): always underlined (clickable signal) + accent on Ctrl/Cmd+hover + Ctrl/Cmd+click → default browser.
   - Path (./ ../ , slash+extension): no decoration normally, only on Ctrl/Cmd+hover does it get underline+accent+pointer + click → open file.
     The actual resolve/open is handled by the app.js handler injected via setFileLinkHandler (provider and existence check live there).
   Multi-cursor is Alt+click. */

let fileLinkHandler = null;
export function setFileLinkHandler(fn) { fileLinkHandler = fn; }

const URL_RE  = /https?:\/\/[^\s<>"'`)\]}]+/;
const REL_RE  = /\.\.?\/[^\s'"`<>()[\]{}|]+\.[\w]{1,12}/;   // ./ ../ relative path (extension required — extensionless ./foo is not a link)
const PATH_RE = new RegExp(`${REL_RE.source}|[\\w.\\-]+(?:\\/[\\w\\-]+)*\\/[\\w\\-]+\\.\\w{1,8}`);   // relative path | loose slash path (folder/name.ext)
const LINK_RE = new RegExp(`${URL_RE.source}|${PATH_RE.source}`, 'g');
const BASE_RE = new RegExp(`${URL_RE.source}|${REL_RE.source}`, 'g');   // always-underlined targets: URL + relative path
const TRAIL = /[.,;:!?)\]}>'"]+$/;   // strip trailing punctuation from URL

function isUrl(s) { return /^https?:\/\//.test(s); }
function clean(s) { return isUrl(s) ? s.replace(TRAIL, '') : s; }

/* ── Always underlined (viewport only): URL + explicit relative paths (./ ../). Loose slash paths are excluded due to false positives (Ctrl+hover only). ── */
const baseMark = Decoration.mark({ class: 'cm-url-link' });
const baseMatcher = new MatchDecorator({
  regexp: BASE_RE,
  decorate(add, from, _to, match) {
    const val = clean(match[0]);   // strip trailing punctuation for URLs, leave paths as-is
    add(from, from + val.length, baseMark);
  }
});
const linkBasePlugin = ViewPlugin.fromClass(class {
  constructor(view) { this.decorations = baseMatcher.createDeco(view); }
  update(u) { this.decorations = baseMatcher.updateDeco(u, this.decorations); }
}, { decorations: (v) => v.decorations });

/* ── Ctrl+hover active layer (shared by URL and path: underline+accent+pointer) ── */
const setActive = StateEffect.define();   // {from,to} or null
const activeMark = Decoration.mark({ class: 'cm-url-link-active' });
const activeField = StateField.define({
  create() { return Decoration.none; },
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setActive)) deco = e.value ? Decoration.set([activeMark.range(e.value.from, e.value.to)]) : Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f)
});

/* The link (url/path) range + kind containing pos. null if none. A fresh regex is built per call for scanning (avoids shared lastIndex). */
function linkAtPos(view, pos) {
  const line = view.state.doc.lineAt(pos);
  const re = new RegExp(LINK_RE.source, 'g');
  let m;
  while ((m = re.exec(line.text))) {
    const value = clean(m[0]);
    const from = line.from + m.index;
    const to = from + value.length;
    if (pos >= from && pos <= to) return { from, to, value, kind: isUrl(value) ? 'url' : 'path' };
  }
  return null;
}
function linkRangeAtCoords(view, x, y) {
  const pos = view.posAtCoords({ x, y });
  if (pos == null) return null;
  return linkAtPos(view, pos);
}
function currentActive(view) {
  const set = view.state.field(activeField, false);
  if (!set) return null;
  const it = set.iter();
  return it.value ? { from: it.from, to: it.to } : null;
}
function clearActive(view) {
  if (currentActive(view)) view.dispatch({ effects: setActive.of(null) });
}

/* Last mouse position (per view) — used to instantly activate the link at that spot on Ctrl/Cmd keydown.
   Relying on mousemove alone means the underline doesn't appear when Ctrl is held while staying still, which feels "laggy" (VSCode reflects keydown too). */
const lastMouse = new WeakMap();

/* Make the link at (x,y) active — skip dispatch if unchanged. */
function activateAt(view, x, y) {
  const l = (x == null) ? null : linkRangeAtCoords(view, x, y);
  const next = l ? { from: l.from, to: l.to } : null;
  const cur = currentActive(view);
  if ((cur && next && cur.from === next.from && cur.to === next.to) || (!cur && !next)) return;
  view.dispatch({ effects: setActive.of(next) });
}

const linkHandlers = EditorView.domEventHandlers({
  mousemove(e, view) {
    lastMouse.set(view, { x: e.clientX, y: e.clientY });
    if (!(e.ctrlKey || e.metaKey)) { clearActive(view); return false; }
    activateAt(view, e.clientX, e.clientY);
    return false;
  },
  mousedown(e, view) {
    if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
    e.preventDefault();   // Ctrl/Cmd+click is reserved for opening links (blocks multi-cursor)
    const l = linkRangeAtCoords(view, e.clientX, e.clientY);
    view.dispatch({ effects: setActive.of(null) });
    if (l) {
      if (l.kind === 'url') { try { window.oyen.shell.openExternal(l.value); } catch (_) {} }
      else if (fileLinkHandler) { try { fileLinkHandler(l.value); } catch (_) {} }
    }
    return true;
  },
  /* Underline the link at the cursor the moment Ctrl/Cmd is pressed (no mouse move) — removes response lag. */
  keydown(e, view) {
    if (e.key !== 'Control' && e.key !== 'Meta') return false;
    const p = lastMouse.get(view);
    if (p) activateAt(view, p.x, p.y);
    return false;
  },
  mouseleave(e, view) { lastMouse.delete(view); clearActive(view); return false; },
  keyup(e, view) { if (e.key === 'Control' || e.key === 'Meta') clearActive(view); return false; }
});

const linkTheme = EditorView.theme({
  /* Render the always-on URL underline in the "token color": the underline uses the span's currentColor, so it must go on the inner syntax span to take the token color.
     For plain URLs with no syntax span, it goes on the wrapper itself (text = default color). */
  '.cm-url-link *': { textDecoration: 'underline' },
  '.cm-url-link:not(:has(*))': { textDecoration: 'underline' },
  '.cm-url-link-active': { cursor: 'pointer' },
  /* Ctrl+hover: accent color + underline (paths get their first underline here). Forced down to inner spans. */
  '.cm-url-link-active, .cm-url-link-active *': { color: 'var(--accent) !important', textDecoration: 'underline' }
});

export const urlLinkExtension = [linkBasePlugin, activeField, linkHandlers, linkTheme];
