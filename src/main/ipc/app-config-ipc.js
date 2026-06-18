const { ipcMain } = require('electron');
const { loadSettings, saveSettings, getDefaultSettings } = require('../services/settings-store');
const { loadProfiles, saveProfiles } = require('../services/profile-store');
const { exportSections, exportConfig, importConfig, inspectImport } = require('../services/export-import-service');

function registerAppConfigIpc() {
  ipcMain.handle('appConfig:getSettings', () => loadSettings());
  ipcMain.handle('appConfig:saveSettings', (_event, payload) => saveSettings(payload));
  ipcMain.handle('appConfig:getDefaultSettings', () => getDefaultSettings());

  ipcMain.handle('appConfig:getProfiles', () => loadProfiles());
  ipcMain.handle('appConfig:saveProfiles', (_event, payload) => saveProfiles(payload));

  ipcMain.handle('appConfig:exportSections', () => exportSections());
  ipcMain.handle('appConfig:export', (_event, filePath, sections) => exportConfig(filePath, sections));
  ipcMain.handle('appConfig:import', (_event, filePath, sections) => importConfig(filePath, sections));
  ipcMain.handle('appConfig:inspectImport', (_event, filePath) => inspectImport(filePath));
}

module.exports = {
  registerAppConfigIpc
};
