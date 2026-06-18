const { ipcMain } = require('electron');
const {
  runTransferJob, cancelJob,
  scanLocalDirectory, scanRemoteDirectory, cancelScan,
  statLocalFiles, statRemoteFiles
} = require('../services/transfer-service');

function registerTransferIpc() {
  ipcMain.handle('transfer:startJob', async (event, spec) => {
    const channel = `transfer:progress:${spec?.jobId}`;
    const send = (payload) => {
      try { event.sender.send(channel, payload); } catch {}
    };
    return await runTransferJob(spec, send);
  });
  ipcMain.handle('transfer:cancelJob', (_event, jobId) => cancelJob(jobId));
  ipcMain.handle('transfer:scanLocalDirectory', (_event, srcDir) => scanLocalDirectory(srcDir));
  ipcMain.handle('transfer:scanRemoteDirectory', (event, uri, scanId) => {
    const send = scanId
      ? (payload) => { try { event.sender.send(`transfer:scanProgress:${scanId}`, payload); } catch {} }
      : null;
    return scanRemoteDirectory(uri, scanId, send);
  });
  ipcMain.handle('transfer:cancelScan', (_event, scanId) => cancelScan(scanId));
  ipcMain.handle('transfer:statLocalFiles', (_event, paths) => statLocalFiles(paths));
  ipcMain.handle('transfer:statRemoteFiles', (_event, uris) => statRemoteFiles(uris));
}

module.exports = { registerTransferIpc };
