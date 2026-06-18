const os = require('os');
const path = require('path');
const { ipcMain } = require('electron');
const secretStore = require('../services/remote-secret-store');
const remoteConn = require('../services/remote-connection');
const sftp = require('../services/providers/sftp-provider');
const ftp = require('../services/providers/ftp-provider');

function getDefaultKeyInfo() {
  return {
    dir: path.join(os.homedir(), '.ssh'),
    filenames: ['id_ed25519', 'id_rsa', 'id_ecdsa']
  };
}

function registerRemoteIpc() {
  ipcMain.handle('remote:getDefaultKeyInfo', () => getDefaultKeyInfo());
  ipcMain.handle('remote:isSecretAvailable', () => secretStore.isAvailable());
  ipcMain.handle('remote:setSecret', (_e, id, fields) => {
    secretStore.setSecret(id, fields);
    return { ok: true };
  });
  ipcMain.handle('remote:removeSecret', (_e, id) => {
    secretStore.removeSecret(id);
    return { ok: true };
  });
  ipcMain.handle('remote:hasSecret', (_e, id) => {
    const s = secretStore.getSecret(id);
    return { hasPassword: !!s.password, hasPassphrase: !!s.passphrase };
  });
  ipcMain.handle('remote:getSecret', (_e, id) => secretStore.getSecret(id));
  ipcMain.handle('remote:testConnection', async (event, profile, secret) => {
    /* Stream connection step logs to the renderer's test dialog. */
    const onLog = (line) => { try { event.sender.send('remote:testLog', { line }); } catch {} };
    try {
      return await remoteConn.testConnection(profile, secret, onLog);
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });
  ipcMain.handle('remote:resolveHome', async (_e, authority) => {
    try {
      const isFtp = /^ftps?:\/\//i.test(authority || '');
      const home = isFtp ? await ftp.resolveHome(authority) : await sftp.resolveHome(authority);
      return { ok: true, path: home };
    } catch (err) {
      return { ok: false, message: err?.message || String(err) };
    }
  });
}

module.exports = { registerRemoteIpc };
