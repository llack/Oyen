const { ipcMain } = require('electron');
const { getDefaultRootInfo, pickDirectory, pickFile, pickSaveFile, copyFile } = require('../services/local-file-system');
const { dispatch } = require('../services/providers/registry');

function registerFileSystemIpc() {
  ipcMain.handle('fs:getDefaultRoot', () => getDefaultRootInfo());
  ipcMain.handle('fs:list', (_e, dirPath) => dispatch(dirPath).safeList(dirPath));
  /* For callers that need to distinguish errors (the folder picker) — reports permission denials, etc. as {ok:false}. */
  ipcMain.handle('fs:list-checked', async (_e, dirPath) => {
    try { return { ok: true, entries: await dispatch(dirPath).listEntries(dirPath) }; }
    catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });
  /* Remote (SFTP) permissions — read / change the current permission bits. Local and FTP are unsupported (provider lacks the function → catch). */
  ipcMain.handle('fs:statMode', async (_e, p) => {
    try { return { ok: true, ...(await dispatch(p).statMode(p)) }; }
    catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });
  /* Check whether a path exists (e.g. before opening a file link) — common to all providers. */
  ipcMain.handle('fs:exists', async (_e, p) => {
    try { return { ok: true, exists: !!(await dispatch(p).exists(p)) }; }
    catch (err) { return { ok: false, exists: false, error: err?.message || String(err) }; }
  });
  ipcMain.handle('fs:chmod', async (_e, p, mode) => {
    try { await dispatch(p).chmod(p, mode); return { ok: true }; }
    catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });
  ipcMain.handle('fs:readTextDescriptor', (_e, filePath) => dispatch(filePath).readTextDescriptor(filePath));
  ipcMain.handle('fs:readDataUrl', (_e, filePath) => dispatch(filePath).readDataUrl(filePath));
  ipcMain.handle('fs:getMediaUrl', (_e, filePath) => dispatch(filePath).getMediaUrl(filePath));
  ipcMain.handle('fs:createFile', (_e, filePath) => dispatch(filePath).createFile(filePath));
  ipcMain.handle('fs:createDirectory', (_e, dirPath) => dispatch(dirPath).createDirectory(dirPath));
  ipcMain.handle('fs:writeText', (_e, filePath, content, encoding) => dispatch(filePath).writeText(filePath, content, encoding));
  ipcMain.handle('fs:renameFile', (_e, filePath, nextName) => dispatch(filePath).renameFile(filePath, nextName));
  ipcMain.handle('fs:trashFile', (_e, filePath) => dispatch(filePath).trashFile(filePath));
  ipcMain.handle('fs:openFileInDefaultApp', (_e, filePath) => dispatch(filePath).openFileInDefaultApp(filePath));
  ipcMain.handle('fs:revealFile', (_e, filePath) => dispatch(filePath).revealFile(filePath));
  ipcMain.handle('fs:showFileProperties', (_e, filePath) => dispatch(filePath).showFileProperties(filePath));
  ipcMain.handle('fs:pickDirectory', (_e, defaultPath) => pickDirectory(defaultPath));
  ipcMain.handle('fs:pickFile', (_e, options) => pickFile(options));
  ipcMain.handle('fs:pickSaveFile', (_e, options) => pickSaveFile(options));
  /* Save As (non-text) — local binary copy. */
  ipcMain.handle('fs:copyFile', async (_e, src, dest) => {
    try { return await copyFile(src, dest); }
    catch (err) { return { ok: false, error: err?.message || String(err) }; }
  });
}

module.exports = { registerFileSystemIpc };
