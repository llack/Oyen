/**
 * CM6 git diff gutter — per-line colored strip on the left.
 * - markers: Map<lineNumber, 'add' | 'mod' | 'del'>
 * - Updated externally via setDiffMarkers(view, map) (after open / save / git action).
 * - Stale is allowed while editing — git diff results are disk-based, so in-memory edits aren't reflected.
 */
import { gutter, GutterMarker } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { t } from './i18n.js';

const TYPE_LABEL_KEY = {
  add: 'git.diff.added',
  mod: 'git.diff.modified',
  del: 'git.diff.deleted'
};

const setDiffEffect = StateEffect.define();

/* state field — markers Map<lineNum, 'add'|'mod'|'del'>. Used as a dependency by the external minimap extension. */
export const diffMarkersField = StateField.define({
  create() { return new Map(); },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setDiffEffect)) return e.value;
    }
    return value;
  }
});

class StripMarker extends GutterMarker {
  constructor(type) { super(); this.type = type; }
  toDOM() {
    const el = document.createElement('div');
    el.className = `cm-git-diff-strip cm-git-diff-${this.type}`;
    const key = TYPE_LABEL_KEY[this.type];
    if (key) el.title = t(key);
    return el;
  }
}

const diffGutter = gutter({
  class: 'cm-git-diff-gutter',
  lineMarker(view, line) {
    const markers = view.state.field(diffMarkersField, false);
    if (!markers || markers.size === 0) return null;
    const lineNum = view.state.doc.lineAt(line.from).number;
    const type = markers.get(lineNum);
    if (!type) return null;
    return new StripMarker(type);
  }
});

export const gitDiffExtension = [diffMarkersField, diffGutter];

export function setDiffMarkers(view, markers) {
  if (!view) return;
  view.dispatch({ effects: setDiffEffect.of(markers || new Map()) });
}

/**
 * git diff hunks → per-line marker Map.
 * Rules (simplified):
 * - hunk has both add+del → add lines become 'mod' (modified)
 * - hunk has add only → 'add' (newly added)
 * - hunk has del only → 'del' marker on the newStart line
 */
export function hunksToMarkers(hunks) {
  const markers = new Map();
  if (!Array.isArray(hunks)) return markers;
  for (const h of hunks) {
    const hasAdd = h.lines.some((l) => l.type === 'add');
    const hasDel = h.lines.some((l) => l.type === 'del');
    if (hasAdd && hasDel) {
      let line = h.newStart;
      for (const l of h.lines) {
        if (l.type === 'add') { markers.set(line, 'mod'); line++; }
        else if (l.type === 'context') { line++; }
        /* del lines don't advance newStart */
      }
    } else if (hasAdd) {
      let line = h.newStart;
      for (const l of h.lines) {
        if (l.type === 'add') { markers.set(line, 'add'); line++; }
        else if (l.type === 'context') { line++; }
      }
    } else if (hasDel) {
      /* Deletion-only hunk — marker at newStart (the deletion occurred just above that line). */
      const target = Math.max(1, h.newStart);
      markers.set(target, 'del');
    }
  }
  return markers;
}
