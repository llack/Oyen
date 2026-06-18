import { mountTerminal } from './terminal-ui.js';
import { notifyAlert, friendlyConnectError } from './dialogs.js';
import { t } from './i18n.js';

/* Bottom terminal panel: open/close/resize + per-root availability. Extracted from app.js.
   Injects tree (getActivePath/getRootPath), persistLayout, and the initial height. FTP roots have the terminal disabled. */
export function mountTerminalPanel({ tree, persistLayout, initialHeight }) {
  const terminalToggleBtn = document.getElementById('terminalToggleBtn');
  const terminalHost = document.getElementById('terminalHost');
  const terminalResizer = document.getElementById('terminalResizer');
  const terminalXtermHost = document.getElementById('terminalXtermHost');
  const terminalCloseBtn = document.getElementById('terminalCloseBtn');
  const terminalProgressEl = document.getElementById('terminalProgress');
  let terminal = null;

  function showTerminalProgress() {
    if (terminalProgressEl) terminalProgressEl.hidden = false;
  }
  function hideTerminalProgress() {
    if (terminalProgressEl) terminalProgressEl.hidden = true;
  }

  function ensureTerminalInstance() {
    if (terminal) return;
    terminal = mountTerminal({
      host: terminalXtermHost,
      getCwd: () => tree?.getActivePath?.() || tree?.getRootPath?.() || '',
      onSpawnStart: () => showTerminalProgress(),
      onSpawnEnd: () => hideTerminalProgress(),
      onSpawnError: async (err) => {
        closeTerminal();
        await notifyAlert(friendlyConnectError(err?.message || String(err)), t('alert.terminalConnectFailed'));
      },
      onExit: () => {},
      /* When xterm has focus, window shortcuts don't reach it, so Ctrl+` can't close it → the xterm key handler toggles directly. */
      onToggleKey: () => toggleTerminal()
    });
  }

  function isFtpRoot() {
    const root = tree?.getRootPath?.() || '';
    return /^ftp(s)?:\/\//i.test(root);
  }

  let terminalLastRoot = null;
  function refreshTerminalAvailability() {
    if (!terminalToggleBtn) return;
    terminalToggleBtn.hidden = isFtpRoot();
    const root = tree?.getRootPath?.() || '';
    if (terminalLastRoot !== null && terminalLastRoot !== root) {
      if (isTerminalOpen()) closeTerminal();
      if (terminal) { try { terminal.dispose(); } catch (_) {} terminal = null; }
    }
    terminalLastRoot = root;
  }

  async function openTerminal() {
    if (isFtpRoot()) return;
    if (!terminalHost.style.height) {
      const rightHeight = terminalHost.parentElement?.clientHeight || 600;
      terminalHost.style.height = `${Math.max(160, Math.round(rightHeight * 0.20))}px`;
    }
    terminalHost.hidden = false;
    terminalResizer.hidden = false;
    terminalToggleBtn?.classList.add('active');
    ensureTerminalInstance();
    try { await terminal.attach(); }
    catch (_) { return; }
    requestAnimationFrame(() => {
      terminal.fit();
      terminal.focus();
    });
  }

  function closeTerminal() {
    terminalHost.hidden = true;
    terminalResizer.hidden = true;
    terminalToggleBtn?.classList.remove('active');
    hideTerminalProgress();
  }

  function isTerminalOpen() {
    return !terminalHost.hidden;
  }

  async function openTerminalAt(path) {
    if (isFtpRoot()) return;
    if (!terminalHost.style.height) {
      const rightHeight = terminalHost.parentElement?.clientHeight || 600;
      terminalHost.style.height = `${Math.max(160, Math.round(rightHeight * 0.20))}px`;
    }
    terminalHost.hidden = false;
    terminalResizer.hidden = false;
    terminalToggleBtn?.classList.add('active');
    ensureTerminalInstance();
    try { await terminal.resetTo(path || ''); }
    catch (_) { return; }
    requestAnimationFrame(() => {
      terminal.fit();
      terminal.focus();
    });
  }

  terminalToggleBtn?.addEventListener('click', () => {
    if (isTerminalOpen()) closeTerminal(); else openTerminal();
  });
  terminalCloseBtn?.addEventListener('click', closeTerminal);

  /* If a saved terminal height exists, apply it up front — on open, use the user's value instead of the default ratio. */
  if (initialHeight && terminalHost) {
    terminalHost.style.height = `${Number(initialHeight)}px`;
  }

  let terminalResizing = false;
  let terminalResizeStartY = 0;
  let terminalResizeStartHeight = 0;
  terminalResizer?.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    terminalResizing = true;
    terminalResizeStartY = event.clientY;
    terminalResizeStartHeight = terminalHost.offsetHeight;
    document.body.style.cursor = 'row-resize';
    event.preventDefault();
  });
  document.addEventListener('mousemove', (event) => {
    if (!terminalResizing) return;
    const dy = terminalResizeStartY - event.clientY;
    const rightHeight = terminalHost.parentElement?.clientHeight || 600;
    const next = Math.max(80, Math.min(rightHeight - 100, terminalResizeStartHeight + dy));
    terminalHost.style.height = `${next}px`;
    terminal?.fit();
  });
  document.addEventListener('mouseup', () => {
    if (!terminalResizing) return;
    terminalResizing = false;
    document.body.style.cursor = '';
    terminal?.fit();
    persistLayout({ terminalHeight: terminalHost.offsetHeight });
  });

  function toggleTerminal() {
    if (isTerminalOpen()) closeTerminal(); else openTerminal();
  }

  return {
    openTerminalAt,
    toggle: toggleTerminal,
    refreshAvailability: refreshTerminalAvailability
  };
}
