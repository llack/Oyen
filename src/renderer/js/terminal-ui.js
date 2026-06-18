import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { monoFontStack } from './fonts.js';
import { t } from './i18n.js';

export function mountTerminal({ host, getCwd, onSpawnStart, onSpawnEnd, onSpawnError, onExit, onToggleKey }) {
  let term = null;
  let fit = null;
  let sessionId = null;
  let unsubData = null;
  let unsubExit = null;
  let disposed = false;
  let resizeObserver = null;
  let resizeRaf = 0;
  let exited = false;
  let pendingRestartListener = null;
  let contextMenuListener = null;
  const isMac = window.oyen?.platform === 'darwin';

  function copySelection() {
    if (!term || !term.hasSelection()) return false;
    window.oyen.clipboard.writeText(term.getSelection());
    term.clearSelection();
    return true;
  }

  async function pasteClipboard() {
    if (!term || !sessionId) return;
    const text = await window.oyen.clipboard.readText();
    if (text) term.paste(text);
  }

  function ensureXterm() {
    if (term) return;
    term = new Terminal({
      fontFamily: monoFontStack(),
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 5000,
      allowProposedApi: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78aa'
      }
    });
    fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      // The underline + pointer is itself the click signal — just click to open in the default browser
      window.oyen.shell.openExternal(uri);
    }));
    term.open(host);
    fit.fit();
    // Ctrl/Cmd+C copies only when there's a selection (otherwise passes SIGINT through), Ctrl/Cmd+V pastes,
    // Ctrl/Cmd+` toggles (closes) the terminal — handled here because window shortcuts don't work while focus is in the xterm textarea.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod || e.altKey || e.shiftKey) return true;
      const key = e.key.toLowerCase();
      if (key === '`') { if (typeof onToggleKey === 'function') onToggleKey(); return false; }
      if (key === 'c' && term.hasSelection()) { copySelection(); return false; }
      if (key === 'v') { pasteClipboard(); return false; }
      return true;
    });
    // Right-click: copy if there's a selection, otherwise paste
    contextMenuListener = (e) => {
      e.preventDefault();
      if (!copySelection()) pasteClipboard();
    };
    host.addEventListener('contextmenu', contextMenuListener);
    term.onData((data) => {
      if (sessionId) window.oyen.terminal.write(sessionId, data);
      else if (exited) restart();
    });
    term.onResize(({ cols, rows }) => {
      if (sessionId) window.oyen.terminal.resize(sessionId, cols, rows);
    });
  }

  function parseRemoteAuthority(uri) {
    try {
      const u = new URL(uri);
      if (!/^sftp:$/i.test(u.protocol)) return null;
      const port = u.port || '22';
      const userPart = u.username || '';
      return `sftp://${userPart}@${u.hostname}:${port}`;
    } catch {
      return null;
    }
  }

  async function attach(cwdOverride) {
    ensureXterm();
    if (sessionId) return;
    exited = false;
    detachPendingRestartListener();
    const cwd = cwdOverride || (typeof getCwd === 'function' ? getCwd() : undefined);
    const { cols, rows } = term;
    const remoteAuthority = cwd ? parseRemoteAuthority(cwd) : null;
    if (typeof onSpawnStart === 'function') onSpawnStart(!!remoteAuthority);
    let id;
    try {
      if (remoteAuthority) {
        const result = await window.oyen.terminal.spawnRemote({
          authority: remoteAuthority,
          cwd,
          cols,
          rows
        });
        if (!result?.ok) throw new Error(result?.message || t('terminal.error.shellStart'));
        id = result.id;
      } else {
        const result = await window.oyen.terminal.spawn({ cwd, cols, rows });
        id = result?.id;
      }
    } catch (err) {
      if (typeof onSpawnError === 'function') onSpawnError(err);
      if (typeof onSpawnEnd === 'function') onSpawnEnd();
      throw err;
    }
    if (typeof onSpawnEnd === 'function') onSpawnEnd();
    sessionId = id;
    unsubData = window.oyen.terminal.onData(id, (data) => {
      if (term) term.write(data);
    });
    unsubExit = window.oyen.terminal.onExit(id, (exit) => {
      handleExit(exit);
    });
  }

  async function resetTo(cwd) {
    cleanupSession();
    detachPendingRestartListener();
    exited = false;
    if (term) term.clear();
    await attach(cwd);
  }

  async function restart() {
    if (!exited) return;
    if (term) term.clear();
    await attach();
    if (term) term.focus();
  }

  function detachPendingRestartListener() {
    if (pendingRestartListener) {
      host.removeEventListener('click', pendingRestartListener);
      pendingRestartListener = null;
    }
  }

  function handleExit(exit) {
    if (term) {
      const code = exit?.exitCode ?? 0;
      term.write(`\r\n\x1b[90m${t('terminal.exitNotice', { code })}\x1b[0m\r\n`);
    }
    cleanupSession();
    exited = true;
    detachPendingRestartListener();
    pendingRestartListener = () => {
      detachPendingRestartListener();
      restart();
    };
    host.addEventListener('click', pendingRestartListener);
    if (typeof onExit === 'function') onExit(exit);
  }

  function cleanupSession() {
    if (unsubData) { try { unsubData(); } catch (_) {} unsubData = null; }
    if (unsubExit) { try { unsubExit(); } catch (_) {} unsubExit = null; }
    if (sessionId) {
      const id = sessionId;
      sessionId = null;
      window.oyen.terminal.dispose(id).catch(() => {});
    }
  }

  function fitNow() {
    if (!fit || !term) return;
    try { fit.fit(); } catch (_) {}
  }

  function scheduleFit() {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      fitNow();
    });
  }

  resizeObserver = new ResizeObserver(() => scheduleFit());
  resizeObserver.observe(host);

  function focus() {
    if (term) term.focus();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    detachPendingRestartListener();
    if (contextMenuListener) { host.removeEventListener('contextmenu', contextMenuListener); contextMenuListener = null; }
    cleanupSession();
    if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
    if (term) { try { term.dispose(); } catch (_) {} term = null; }
    fit = null;
  }

  return {
    attach,
    resetTo,
    focus,
    fit: fitNow,
    dispose
  };
}
