/* Parse a unified diff (raw text) into a list of hunks. Shared by local/remote git.
   Each hunk: newStart/newLines/oldStart/oldLines + per-line type ('add'|'del'|'context'). */
function parseUnifiedDiff(raw) {
  if (!raw) return { hunks: [] };
  const hunks = [];
  let cur = null;
  const headerRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
  for (const line of raw.split(/\r?\n/)) {
    const m = headerRe.exec(line);
    if (m) {
      cur = {
        oldStart: Number(m[1]),
        oldLines: m[2] ? Number(m[2]) : 1,
        newStart: Number(m[3]),
        newLines: m[4] ? Number(m[4]) : 1,
        lines: []
      };
      hunks.push(cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) cur.lines.push({ type: 'add', text: line.slice(1) });
    else if (line.startsWith('-')) cur.lines.push({ type: 'del', text: line.slice(1) });
    else if (line.startsWith(' ')) cur.lines.push({ type: 'context', text: line.slice(1) });
    /* Ignore lines like '\\ No newline at end of file' */
  }
  return { hunks };
}

module.exports = { parseUnifiedDiff };
