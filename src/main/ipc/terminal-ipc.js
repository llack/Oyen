const { ipcMain, BrowserWindow } = require('electron');
const {
  spawnSession,
  spawnRemoteSession,
  writeSession,
  resizeSession,
  disposeSession,
  attachSession
} = require('../services/terminal-service');

const attached = new Map();

function broadcastChannel(webContents, channel, payload) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.send(channel, payload);
}

function registerTerminalIpc() {
  ipcMain.handle('terminal:spawn', (event, options) => {
    const { id, shell } = spawnSession(options || {});
    const webContents = event.sender;
    const handle = attachSession(
      id,
      (data) => broadcastChannel(webContents, `terminal:data:${id}`, data),
      (exit) => broadcastChannel(webContents, `terminal:exit:${id}`, exit)
    );
    attached.set(id, handle);
    return { id, shell };
  });

  ipcMain.handle('terminal:spawnRemote', async (event, options) => {
    try {
      const { id } = await spawnRemoteSession(options || {});
      const webContents = event.sender;
      const handle = attachSession(
        id,
        (data) => broadcastChannel(webContents, `terminal:data:${id}`, data),
        (exit) => broadcastChannel(webContents, `terminal:exit:${id}`, exit)
      );
      attached.set(id, handle);
      return { ok: true, id };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });

  ipcMain.handle('terminal:write', (_event, id, data) => writeSession(id, data));

  ipcMain.handle('terminal:resize', (_event, id, cols, rows) => resizeSession(id, cols, rows));

  ipcMain.handle('terminal:dispose', (_event, id) => {
    const handle = attached.get(id);
    if (handle) {
      try { handle.dispose(); } catch (_) {}
      attached.delete(id);
    }
    return disposeSession(id);
  });
}

module.exports = { registerTerminalIpc };
