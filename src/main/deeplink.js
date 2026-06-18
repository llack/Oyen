// oyen-quick:// deeplink handler.
// Three behaviors: ① single-instance lock ② register as the OS default protocol client ③ parse the URL → forward to the renderer.
//  - Cold start (Win/Linux): the URL arrives in process.argv → store as pending, the renderer pulls it on boot.
//  - Running (Win/Linux): a second launch forwards argv via second-instance.
//  - macOS: the open-url event (mac has a single process — it always comes to the running instance).
// The target always reuses the single "last (most recent) window". If there are no windows (mac idle, etc.), create one and deliver there.
// Link format: oyen-quick://open?key=<key>&path=</folder/path>  (host is arbitrary, key is required)
const { app, ipcMain, BrowserWindow } = require('electron');
const path = require('path');

const PROTOCOL = 'oyen-quick';
let pending = null;
let lastFocused = null;       // the most recently focused window — the delivery target
let createWin = null;         // callback to create a new window when there are none

function targetWindow() {
  const alive = (w) => w && !w.isDestroyed() ? w : null;
  return alive(BrowserWindow.getFocusedWindow())
    || alive(lastFocused)
    || BrowserWindow.getAllWindows().at(-1)   // last (most recent) window
    || null;
}

function parse(url) {
  if (typeof url !== 'string' || !url.toLowerCase().startsWith(`${PROTOCOL}://`)) return null;
  try {
    const u = new URL(url);
    const key = (u.searchParams.get('key') || '').trim();
    if (!key) return null;
    return { key, path: u.searchParams.get('path') || '' };
  } catch {
    return null;
  }
}

function fromArgv(argv) {
  for (const arg of argv || []) {
    const link = parse(arg);
    if (link) return link;
  }
  return null;
}

function focus(win) {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

function deliver(link) {
  if (!link) return;
  const win = targetWindow();
  if (win && !win.webContents.isLoading()) {
    focus(win);
    win.webContents.send('deeplink:open', link);
    return;
  }
  pending = link; // window is loading or absent → picked up via getPending on boot
  if (!win && app.isReady() && typeof createWin === 'function') createWin(); // the new window pulls pending
}

// Single-instance lock + event/protocol setup. Returns true if this process is primary, false otherwise (duplicate launch).
function setup(opts = {}) {
  if (typeof opts.createWindow === 'function') createWin = opts.createWindow;

  if (!app.requestSingleInstanceLock()) {
    app.quit(); // duplicate launch — argv is forwarded to the primary's second-instance
    return false;
  }

  app.on('browser-window-focus', (_event, win) => { lastFocused = win; });

  app.on('second-instance', (_event, argv) => {
    focus(targetWindow());
    deliver(fromArgv(argv));
  });
  app.on('open-url', (event, url) => { // macOS
    event.preventDefault();
    deliver(parse(url));
  });

  // Register as the OS default handler (in dev, routing requires specifying the electron binary + script path)
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL);
  }

  pending = fromArgv(process.argv); // cold-start link
  ipcMain.handle('deeplink:getPending', () => {
    const p = pending;
    pending = null;
    return p;
  });

  return true;
}

module.exports = { setup, PROTOCOL };
