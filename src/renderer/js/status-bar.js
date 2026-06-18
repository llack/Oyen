/* Bottom status bar: connection badge on the left (SFTP/FTP/FTPS host, or local) + meta on the right (cursor, encoding, etc.).
   Path and symbols are handled by the top breadcrumb — the status bar only highlights "where am I connected right now".
   createStatusBar(el) → { setStatus({ meta }), setCursor(text), setConnection({ kind, host }) }. */

import { t } from './i18n.js';

export function createStatusBar(statusBarEl) {
  const esc = (value) => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  let cursorText = '';
  let lastMeta = [];
  let lastConn = { kind: 'local' };

  function connHtml() {
    const c = lastConn || { kind: 'local' };
    if (c.kind === 'local') return `<span class="status-conn local">${esc(t('status.local'))}</span>`;
    return `<span class="status-conn remote">${esc(c.host || '')}</span>`;
  }

  function render() {
    if (!statusBarEl) return;
    const cursorHtml = cursorText ? `<span class="status-cursor">${esc(cursorText)}</span>` : '';
    const metaHtml = lastMeta.map((item) => `<span>${esc(item)}</span>`).join('');
    statusBarEl.innerHTML = `${connHtml()}<span class="status-meta">${cursorHtml}${metaHtml}</span>`;
  }

  return {
    /* Ignores path (shown by the top breadcrumb) — only takes the right-side meta. */
    setStatus({ meta = '' } = {}) {
      lastMeta = Array.isArray(meta) ? meta.filter(Boolean) : [meta].filter(Boolean);
      cursorText = '';  // Reset cursor on tab/path switch — stays empty for non-text tabs.
      render();
    },
    setCursor(text) {
      const next = text || '';
      const el = statusBarEl?.querySelector('.status-cursor');
      /* If the cursor span already exists and there is a new value, update textContent only — re-render for empty transitions or newly created spans. */
      if (el && next) { cursorText = next; el.textContent = next; return; }
      cursorText = next;
      render();
    },
    /* Tree root connection info {kind:'local'|'sftp'|'ftp'|'ftps', host}. */
    setConnection(info) {
      lastConn = info || { kind: 'local' };
      render();
    }
  };
}
