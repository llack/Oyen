const { ipcMain } = require('electron');
const localGit = require('../services/git-service');
const remoteGit = require('../services/git-remote-service');

/* Route to local/remote git by the rootPath URI prefix. sftp:// uses the ssh-exec-based remote, otherwise local. */
function svc(rootPath) {
  return /^sftp:\/\//i.test(String(rootPath || '')) ? remoteGit : localGit;
}

function wrap(fn) {
  return async (...args) => {
    try {
      const result = await fn(...args);
      return { ok: true, data: result };
    } catch (err) {
      return { ok: false, message: err?.message || String(err), code: err?.code };
    }
  };
}

function registerGitIpc() {
  ipcMain.handle('git:isRepo', (_e, rootPath) => wrap(svc(rootPath).isRepo)(rootPath));
  ipcMain.handle('git:status', (_e, rootPath) => wrap(svc(rootPath).getStatus)(rootPath));
  ipcMain.handle('git:stage', (_e, rootPath, files) => wrap(svc(rootPath).stage)(rootPath, files));
  ipcMain.handle('git:unstage', (_e, rootPath, files) => wrap(svc(rootPath).unstage)(rootPath, files));
  ipcMain.handle('git:discard', (_e, rootPath, files, untracked) => wrap(svc(rootPath).discard)(rootPath, files, untracked));
  ipcMain.handle('git:commit', (_e, rootPath, message, options) => wrap(svc(rootPath).commit)(rootPath, message, options));
  ipcMain.handle('git:push', (_e, rootPath) => wrap(svc(rootPath).push)(rootPath));
  ipcMain.handle('git:pull', (_e, rootPath) => wrap(svc(rootPath).pull)(rootPath));
  ipcMain.handle('git:sync', (_e, rootPath) => wrap(svc(rootPath).sync)(rootPath));
  ipcMain.handle('git:diff', (_e, rootPath, file) => wrap(svc(rootPath).getDiff)(rootPath, file));
  ipcMain.handle('git:undoLastCommit', (_e, rootPath) => wrap(svc(rootPath).undoLastCommit)(rootPath));
  ipcMain.handle('git:fetch', (_e, rootPath) => wrap(svc(rootPath).fetch)(rootPath));
  ipcMain.handle('git:log', (_e, rootPath, limit) => wrap(svc(rootPath).log)(rootPath, limit));
}

module.exports = { registerGitIpc };
