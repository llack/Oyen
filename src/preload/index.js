const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('oyen', {
  platform: process.platform,
  getPathForFile: (file) => webUtils.getPathForFile(file),
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard:readText'),
    writeText: (text) => ipcRenderer.invoke('clipboard:writeText', text)
  },
  app: {
    quit: () => ipcRenderer.invoke('app:quit'),
    openNewWindow: () => ipcRenderer.invoke('app:openNewWindow'),
    onRequestQuit: (handler) => {
      const listener = () => handler();
      ipcRenderer.on('app:requestQuit', listener);
      return () => ipcRenderer.removeListener('app:requestQuit', listener);
    }
  },
  appConfig: {
    getSettings: () => ipcRenderer.invoke('appConfig:getSettings'),
    saveSettings: (payload) => ipcRenderer.invoke('appConfig:saveSettings', payload),
    getDefaultSettings: () => ipcRenderer.invoke('appConfig:getDefaultSettings'),
    getProfiles: () => ipcRenderer.invoke('appConfig:getProfiles'),
    saveProfiles: (payload) => ipcRenderer.invoke('appConfig:saveProfiles', payload),
    exportSections: () => ipcRenderer.invoke('appConfig:exportSections'),
    exportConfig: (filePath, sections) => ipcRenderer.invoke('appConfig:export', filePath, sections),
    importConfig: (filePath, sections) => ipcRenderer.invoke('appConfig:import', filePath, sections),
    inspectImport: (filePath) => ipcRenderer.invoke('appConfig:inspectImport', filePath)
  },
  localFs: {
    getDefaultRoot: () => ipcRenderer.invoke('fs:getDefaultRoot'),
    list: (dirPath) => ipcRenderer.invoke('fs:list', dirPath),
    listChecked: (dirPath) => ipcRenderer.invoke('fs:list-checked', dirPath),
    statMode: (filePath) => ipcRenderer.invoke('fs:statMode', filePath),
    exists: (filePath) => ipcRenderer.invoke('fs:exists', filePath),
    chmod: (filePath, mode) => ipcRenderer.invoke('fs:chmod', filePath, mode),
    readTextDescriptor: (filePath) => ipcRenderer.invoke('fs:readTextDescriptor', filePath),
    readDataUrl: (filePath) => ipcRenderer.invoke('fs:readDataUrl', filePath),
    getMediaUrl: (filePath) => ipcRenderer.invoke('fs:getMediaUrl', filePath),
    createFile: (filePath) => ipcRenderer.invoke('fs:createFile', filePath),
    createDirectory: (dirPath) => ipcRenderer.invoke('fs:createDirectory', dirPath),
    writeText: (filePath, content, encoding) => ipcRenderer.invoke('fs:writeText', filePath, content, encoding),
    renameFile: (filePath, nextName) => ipcRenderer.invoke('fs:renameFile', filePath, nextName),
    trashFile: (filePath) => ipcRenderer.invoke('fs:trashFile', filePath),
    openFileInDefaultApp: (filePath) => ipcRenderer.invoke('fs:openFileInDefaultApp', filePath),
    revealFile: (filePath) => ipcRenderer.invoke('fs:revealFile', filePath),
    showFileProperties: (filePath) => ipcRenderer.invoke('fs:showFileProperties', filePath),
    pickDirectory: (defaultPath) => ipcRenderer.invoke('fs:pickDirectory', defaultPath),
    pickFile: (options) => ipcRenderer.invoke('fs:pickFile', options),
    pickSaveFile: (options) => ipcRenderer.invoke('fs:pickSaveFile', options),
    copyFile: (src, dest) => ipcRenderer.invoke('fs:copyFile', src, dest)
  },
  terminal: {
    spawn: (options) => ipcRenderer.invoke('terminal:spawn', options),
    spawnRemote: (options) => ipcRenderer.invoke('terminal:spawnRemote', options),
    write: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
    dispose: (id) => ipcRenderer.invoke('terminal:dispose', id),
    onData: (id, handler) => {
      const channel = `terminal:data:${id}`;
      const listener = (_event, data) => handler(data);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    onExit: (id, handler) => {
      const channel = `terminal:exit:${id}`;
      const listener = (_event, payload) => handler(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
  transfer: {
    startJob: (spec) => ipcRenderer.invoke('transfer:startJob', spec),
    cancelJob: (jobId) => ipcRenderer.invoke('transfer:cancelJob', jobId),
    scanLocalDirectory: (srcDir) => ipcRenderer.invoke('transfer:scanLocalDirectory', srcDir),
    scanRemoteDirectory: (uri, scanId) => ipcRenderer.invoke('transfer:scanRemoteDirectory', uri, scanId),
    cancelScan: (scanId) => ipcRenderer.invoke('transfer:cancelScan', scanId),
    onScanProgress: (scanId, handler) => {
      const channel = `transfer:scanProgress:${scanId}`;
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    statLocalFiles: (paths) => ipcRenderer.invoke('transfer:statLocalFiles', paths),
    statRemoteFiles: (uris) => ipcRenderer.invoke('transfer:statRemoteFiles', uris),
    onProgress: (jobId, handler) => {
      const channel = `transfer:progress:${jobId}`;
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    }
  },
  hostVerify: {
    onRequest: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('host-verify:request', listener);
      return () => ipcRenderer.removeListener('host-verify:request', listener);
    },
    respond: (payload) => ipcRenderer.send('host-verify:response', payload)
  },
  git: {
    isRepo: (rootPath) => ipcRenderer.invoke('git:isRepo', rootPath),
    status: (rootPath) => ipcRenderer.invoke('git:status', rootPath),
    stage: (rootPath, files) => ipcRenderer.invoke('git:stage', rootPath, files),
    unstage: (rootPath, files) => ipcRenderer.invoke('git:unstage', rootPath, files),
    discard: (rootPath, files, untracked) => ipcRenderer.invoke('git:discard', rootPath, files, untracked),
    commit: (rootPath, message, options) => ipcRenderer.invoke('git:commit', rootPath, message, options),
    push: (rootPath) => ipcRenderer.invoke('git:push', rootPath),
    pull: (rootPath) => ipcRenderer.invoke('git:pull', rootPath),
    sync: (rootPath) => ipcRenderer.invoke('git:sync', rootPath),
    diff: (rootPath, file) => ipcRenderer.invoke('git:diff', rootPath, file),
    undoLastCommit: (rootPath) => ipcRenderer.invoke('git:undoLastCommit', rootPath),
    fetch: (rootPath) => ipcRenderer.invoke('git:fetch', rootPath),
    log: (rootPath, limit) => ipcRenderer.invoke('git:log', rootPath, limit)
  },
  deeplink: {
    /* Get the oyen-quick:// link pending at boot (cold start). */
    getPending: () => ipcRenderer.invoke('deeplink:getPending'),
    /* Subscribe to links arriving while running — cb({key, path}), returns an unsubscribe function. */
    onOpen: (handler) => {
      const listener = (_e, link) => handler(link);
      ipcRenderer.on('deeplink:open', listener);
      return () => ipcRenderer.removeListener('deeplink:open', listener);
    }
  },
  remote: {
    getDefaultKeyInfo: () => ipcRenderer.invoke('remote:getDefaultKeyInfo'),
    isSecretAvailable: () => ipcRenderer.invoke('remote:isSecretAvailable'),
    setSecret: (id, fields) => ipcRenderer.invoke('remote:setSecret', id, fields),
    removeSecret: (id) => ipcRenderer.invoke('remote:removeSecret', id),
    hasSecret: (id) => ipcRenderer.invoke('remote:hasSecret', id),
    getSecret: (id) => ipcRenderer.invoke('remote:getSecret', id),
    testConnection: (profile, secret) => ipcRenderer.invoke('remote:testConnection', profile, secret),
    /* Subscribe to connection-test step logs — calls cb(payload), returns an unsubscribe function. */
    onTestLog: (cb) => {
      const handler = (_e, payload) => { try { cb(payload); } catch (_) {} };
      ipcRenderer.on('remote:testLog', handler);
      return () => ipcRenderer.removeListener('remote:testLog', handler);
    },
    resolveHome: (authority) => ipcRenderer.invoke('remote:resolveHome', authority)
  }
});
