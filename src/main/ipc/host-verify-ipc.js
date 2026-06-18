const { ipcMain, BrowserWindow } = require('electron');

let nextId = 1;
const pending = new Map();

function registerHostVerifyIpc() {
  ipcMain.on('host-verify:response', (_event, payload) => {
    const resolver = pending.get(payload?.reqId);
    if (!resolver) return;
    pending.delete(payload.reqId);
    resolver({
      decision: payload.decision === 'trust' ? 'trust' : 'reject',
      remember: !!payload.remember
    });
  });
}

/** Show the host key verification dialog in the renderer and receive the result. */
function requestHostVerify(payload) {
  return new Promise((resolve) => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!win) {
      resolve({ decision: 'reject', remember: false });
      return;
    }
    const reqId = String(nextId++);
    pending.set(reqId, resolve);
    win.webContents.send('host-verify:request', { reqId, ...payload });
  });
}

module.exports = { registerHostVerifyIpc, requestHostVerify };
