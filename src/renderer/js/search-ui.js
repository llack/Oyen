import { setSearchQuery, SearchQuery, findNext, findPrevious, replaceNext, replaceAll, getSearchQuery } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { t } from './i18n.js';

/* Custom find/replace strip (EditPlus/macOS tone, inline overlay). Calls setSearchQuery +
   findNext/replaceNext etc. directly on top of CM6's search() state. Doesn't use the default panel.
   host: container to attach the strip to (#rightTop). getView(): returns the currently active EditorView. */
export function mountSearchUI({ host, getView }) {
  let isOpen = false;
  const opts = { caseSensitive: false, wholeWord: false, regexp: false };

  const root = document.createElement('div');
  root.className = 'search-strip';
  root.hidden = true;
  root.innerHTML = `
    <div class="search-line">
      <div class="search-field">
        <input class="search-input" data-find type="text" spellcheck="false" autocomplete="off" placeholder="${t('search.find')}" />
        <span class="search-count" data-count></span>
        <button type="button" class="search-opt" data-opt="caseSensitive" title="${t('search.caseSensitive')}">Aa</button>
        <button type="button" class="search-opt" data-opt="wholeWord" title="${t('search.wholeWord')}">ab</button>
        <button type="button" class="search-opt" data-opt="regexp" title="${t('search.regexp')}">.*</button>
      </div>
      <button type="button" class="search-btn" data-act="prev" title="${t('search.prev')}">‹</button>
      <button type="button" class="search-btn" data-act="next" title="${t('search.next')}">›</button>
      <button type="button" class="search-btn search-toggle" data-act="toggleReplace" title="${t('search.toggleReplace')}">⇅</button>
      <button type="button" class="search-btn" data-act="close" title="${t('search.close')}">✕</button>
    </div>
    <div class="search-line search-replace-line" hidden>
      <div class="search-field">
        <input class="search-input" data-replace type="text" spellcheck="false" autocomplete="off" placeholder="${t('search.replace')}" />
      </div>
      <button type="button" class="search-btn search-text" data-act="replaceOne" title="${t('search.replaceOne')}">${t('search.replaceOne')}</button>
      <button type="button" class="search-btn search-text" data-act="replaceAll" title="${t('search.replaceAll')}">${t('search.replaceAll')}</button>
    </div>
  `;
  host.appendChild(root);

  const findInput = root.querySelector('[data-find]');
  const replaceInput = root.querySelector('[data-replace]');
  const replaceLine = root.querySelector('.search-replace-line');
  const toggleBtn = root.querySelector('[data-act="toggleReplace"]');
  const countEl = root.querySelector('[data-count]');

  function buildQuery() {
    return new SearchQuery({
      search: findInput.value,
      replace: replaceInput.value,
      caseSensitive: opts.caseSensitive,
      regexp: opts.regexp,
      wholeWord: opts.wholeWord
    });
  }

  /* After moving to a match, center that line vertically in the viewport. For matches near the end of the document, CM6 scrolls only as far as it can. */
  function centerMatch(view) {
    view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });
  }

  /* Apply the query + refresh the match count. If moveToFirst, jump to the first match. */
  function applyQuery(moveToFirst) {
    const view = getView();
    if (!view) return;
    const q = buildQuery();
    view.dispatch({ effects: setSearchQuery.of(q) });
    updateCount(view, q);
    if (moveToFirst && q.search && findNext(view)) centerMatch(view);
  }

  function updateCount(view, query) {
    const q = query || getSearchQuery(view.state);
    if (!findInput.value) { countEl.textContent = ''; root.classList.remove('search-invalid'); return; }
    if (!q.valid) { countEl.textContent = ''; root.classList.add('search-invalid'); return; }  // invalid regex, etc.
    root.classList.remove('search-invalid');
    const head = view.state.selection.main.from;
    let total = 0, idx = 0;
    try {
      for (const m of q.getCursor(view.state)) {
        total++;
        if (m.from <= head) idx = total;
        if (total >= 5000) break;  // huge-file guard
      }
    } catch (_) {}
    const totalLabel = total >= 5000 ? '5000+' : String(total);
    countEl.textContent = total ? `${idx || 1}/${totalLabel}` : t('search.noResults');
  }

  /* Called after a tab switch — if the strip is open, reapply the current query to the newly active view (sync highlights + count).
     No-op if closed (search state is independent per tab). */
  function refresh() {
    if (isOpen) applyQuery(false);
  }

  function nav(dir) {
    const view = getView();
    if (!view || !findInput.value) return;
    /* Ensure the query — reapply every time so it works even with the strip closed / after a tab switch (idempotent). */
    view.dispatch({ effects: setSearchQuery.of(buildQuery()) });
    if ((dir === 'prev' ? findPrevious : findNext)(view)) centerMatch(view);
    updateCount(view);
  }

  function doReplaceOne() {
    const view = getView();
    if (!view || !findInput.value) return;
    if (replaceNext(view)) centerMatch(view);
    updateCount(view);
  }
  function doReplaceAll() {
    const view = getView();
    if (!view || !findInput.value) return;
    replaceAll(view);
    updateCount(view);
  }

  /* Use the selected text (word) as the query and move to the next/previous (dir) match — open the find strip prefilled with the word (with the N/M count),
     and since the current selection is a match, move to the next one in that direction; repeated calls cycle through (wrapping at the ends).
     ⚠️ Keep focus in the editor — if focus goes to the search input, the shortcut system passes input targets through and Ctrl+K repeat stops working.
     Literal search (ignores regex/word boundaries) — feels natural for both double-click and drag selection. Only caseSensitive follows the strip toggle.
     With no selection, move in that direction only if there's an existing query (no-op if empty). */
  function findSelection(dir) {
    const view = getView();
    if (!view) return;
    const sel = view.state.selection.main;
    if (sel.empty) { if (findInput.value) nav(dir); return; }
    const text = view.state.sliceDoc(sel.from, sel.to);
    if (!text || text.includes('\n')) return;  // ignore multi-line selections
    findInput.value = text;
    if (!isOpen) { showReplace(false); root.hidden = false; isOpen = true; }  // open the strip (keep focus in the editor)
    const q = new SearchQuery({ search: text, caseSensitive: opts.caseSensitive });
    view.dispatch({ effects: setSearchQuery.of(q) });
    if ((dir === 'prev' ? findPrevious : findNext)(view)) centerMatch(view);
    updateCount(view, q);
    view.focus();
  }

  function setOpt(name, on) {
    opts[name] = on;
    const btn = root.querySelector(`[data-opt="${name}"]`);
    if (btn) btn.classList.toggle('is-active', on);
    applyQuery(false);
  }

  function showReplace(show) {
    replaceLine.hidden = !show;
    toggleBtn.classList.toggle('is-active', show);
  }

  function open(mode) {
    const view = getView();
    showReplace(mode === 'replace');
    if (!isOpen) {
      root.hidden = false;
      isOpen = true;
    }
    /* If there's a selection (single line), prefill it as the query. */
    if (view) {
      const sel = view.state.selection.main;
      if (!sel.empty) {
        const text = view.state.sliceDoc(sel.from, sel.to);
        if (text && !text.includes('\n')) findInput.value = text;
      }
    }
    applyQuery(false);
    findInput.focus();
    findInput.select();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    const view = getView();
    if (view) {
      view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) });  // clear highlights
      view.focus();
    }
  }

  /* ── Events ── */
  let debounce = 0;
  findInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => applyQuery(false), 120);
  });
  replaceInput.addEventListener('input', () => applyQuery(false));

  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); nav(e.shiftKey ? 'prev' : 'next'); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    /* In replace mode, Tab moves to the replace input (default Tab would land on an option button). */
    else if (e.key === 'Tab' && !replaceLine.hidden) { e.preventDefault(); replaceInput.focus(); replaceInput.select(); }
  });
  replaceInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); doReplaceOne(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    /* Tab returns to the find input. */
    else if (e.key === 'Tab') { e.preventDefault(); findInput.focus(); findInput.select(); }
  });

  /* The strip lives inside #rightTop (host), so both the editor and the strip inputs are caught on capture = "editor-area only" keys
     (terminal, tree, etc. are outside host and don't trigger). All only while the strip is open.
     - Esc: close. From editor focus, intercept before CM6's Esc (deselect) and stopPropagation.
       Esc inside an input is handled by each input's own handler, so exclude it via !root.contains → let it pass through.
     - Alt+R = replace, Alt+A = replace all: only in replace mode (works from both editor and input). */
  host.addEventListener('keydown', (e) => {
    if (!isOpen) return;
    if (e.key === 'Escape' && !root.contains(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && !replaceLine.hidden) {
      const k = e.key.toLowerCase();
      if (k === 'r') { e.preventDefault(); e.stopPropagation(); doReplaceOne(); }
      else if (k === 'a') { e.preventDefault(); e.stopPropagation(); doReplaceAll(); }
    }
  }, true);

  root.addEventListener('click', (e) => {
    const optBtn = e.target.closest('[data-opt]');
    if (optBtn) { const n = optBtn.dataset.opt; setOpt(n, !opts[n]); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'prev' || act === 'next') nav(act);
    else if (act === 'close') close();
    else if (act === 'toggleReplace') { showReplace(replaceLine.hidden); if (!replaceLine.hidden) replaceInput.focus(); }
    else if (act === 'replaceOne') doReplaceOne();
    else if (act === 'replaceAll') doReplaceAll();
  });

  return {
    openFind: () => open('find'),
    openReplace: () => open('replace'),
    close,
    isOpen: () => isOpen,
    findSelection: () => findSelection('next'),      // next match for the selected word (Ctrl+K)
    findSelectionPrev: () => findSelection('prev'),  // previous match for the selected word (Ctrl+Shift+K)
    refresh   // sync search highlights/count after a tab switch
  };
}
