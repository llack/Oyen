/* VS Code-style top breadcrumb bar: folder > file > symbol.
   path updates on tab switch (setPath), symbols update on cursor move (setSymbols).
   Image viewer/markdown tabs aren't shown — editor-ui setStatus sends an empty path (empty path = hidden). */

export function createBreadcrumb(el) {
  const esc = (v) => String(v || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  /* Convert path separators (\ /) to ' > '. For remote URIs, preserve the authority part. (Same rule as status-bar.) */
  const formatPath = (value) => {
    const s = String(value || '');
    const m = s.match(/^([a-z]+:\/\/[^/]*)(\/.*)?$/);
    if (m) return m[1] + (m[2] || '').replace(/[\\/]+/g, ' > ').replace(/\s>\s$/, ' >');
    return s.replace(/[\\/]+/g, ' > ').replace(/\s>\s$/, ' >');
  };

  /* Path from the tree root folder name (excluding remote authority and parent path — authority is already in the status bar badge). If outside the root, show the full path. */
  const rootRelative = (full, root) => {
    if (!full) return '';
    const r = String(root || '').replace(/[\\/]+$/, '');
    if (!r) return full;
    const rootName = r.split(/[\\/]/).pop() || r;
    if (full === r) return rootName;
    if (full.startsWith(r + '/') || full.startsWith(r + '\\')) return rootName + full.slice(r.length);
    return full;
  };

  let lastPath = '';
  let lastSymbols = [];

  /* A leading space gets clipped at the flex item boundary and sticks to the path, so preserve it with NBSP. Later separators are mid-span, so a regular space is fine. */
  const symbolsHtml = () => (lastSymbols.length ? `&nbsp;> ${lastSymbols.map(esc).join(' > ')}` : '');

  function render() {
    if (!el) return;
    if (!lastPath) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = `<span class="bc-path">${esc(formatPath(lastPath))}</span><span class="bc-symbols">${symbolsHtml()}</span>`;
  }

  return {
    setPath(path, root) { lastPath = rootRelative(path || '', root || ''); lastSymbols = []; render(); },
    /* Partial update of symbols only (avoids re-rendering the path). */
    setSymbols(symbols) {
      lastSymbols = Array.isArray(symbols) ? symbols.filter(Boolean) : [];
      const s = el?.querySelector('.bc-symbols');
      if (s && lastPath) { s.innerHTML = symbolsHtml(); return; }
      render();
    }
  };
}
