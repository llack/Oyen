const { app, BrowserWindow, Menu, ipcMain, protocol, shell, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { registerAppConfigIpc } = require('./ipc/app-config-ipc');
const { registerFileSystemIpc } = require('./ipc/file-system-ipc');
const { registerTerminalIpc } = require('./ipc/terminal-ipc');
const { registerRemoteIpc } = require('./ipc/remote-ipc');
const { registerTransferIpc } = require('./ipc/transfer-ipc');
const { registerHostVerifyIpc } = require('./ipc/host-verify-ipc');
const { registerGitIpc } = require('./ipc/git-ipc');
const { disposeAll: disposeAllTerminals } = require('./services/terminal-service');
const { disposeAll: disposeAllProviders } = require('./services/providers/registry');
const deeplink = require('./deeplink');

// oyen-quick:// deep link + single-instance lock. If not primary (a duplicate launch), exit without creating a window.
// createWindow is a function declaration, so it's hoisted — used by the deep link to open a new window when none exist.
const isPrimary = deeplink.setup({ createWindow });

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'oyen-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true
    }
  }
]);

function registerMediaProtocol() {
  protocol.handle('oyen-media', async (request) => {
    try {
      const url = new URL(request.url);
      const encoded = url.pathname.replace(/^\/+/, '').split('/')[0];
      const target = Buffer.from(encoded, 'base64url').toString('utf8');
      if (url.host === 'sftp') {
        const { sftp } = require('./services/providers/registry');
        return await sftp.serveMedia(request, target, detectMediaMime);
      }
      if (url.host === 'ftp') {
        const { ftp } = require('./services/providers/registry');
        return await ftp.serveMedia(request, target, detectMediaMime);
      }
      return createMediaResponse(request, target);
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

function detectMediaMime(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  const map = {
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
    '.ogg': 'video/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.opus': 'audio/ogg',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf'
  };
  return map[ext] || 'application/octet-stream';
}

function createMediaResponse(request, filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return new Response(null, { status: 404 });

    const size = stat.size;
    const range = request.headers.get('range');
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': detectMediaMime(filePath),
      'Access-Control-Allow-Origin': '*'
    };

    if (!range) {
      headers['Content-Length'] = String(size);
      const body = request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(filePath));
      return new Response(body, { status: 200, headers });
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }

    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : size - 1;
    if (!match[1] && match[2]) {
      const suffixLength = Number(match[2]);
      start = Math.max(size - suffixLength, 0);
      end = size - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }

    end = Math.min(end, size - 1);
    headers['Content-Length'] = String(end - start + 1);
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;

    const body = request.method === 'HEAD' ? null : Readable.toWeb(fs.createReadStream(filePath, { start, end }));
    return new Response(body, { status: 206, headers });
  } catch {
    return new Response(null, { status: 404 });
  }
}

ipcMain.handle('app:quit', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  win.confirmedQuit = true;
  win.close();
});

ipcMain.handle('app:openNewWindow', () => {
  createWindow();
});

ipcMain.handle('shell:openExternal', (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
  shell.openExternal(url);
  return true;
});

ipcMain.handle('clipboard:readText', () => clipboard.readText());
ipcMain.handle('clipboard:writeText', (_event, text) => {
  clipboard.writeText(typeof text === 'string' ? text : '');
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#1b1b1b',
    icon: path.join(__dirname, '../../build/icon.png'),
    titleBarStyle: 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.on('close', (e) => {
    if (win.confirmedQuit) return;
    e.preventDefault();
    win.webContents.send('app:requestQuit');
  });

  const devUrl = process.env.OYEN_DEV_SERVER_URL;
  if (devUrl) {
    win.webContents.on('console-message', (event) => {
      const { level, message, lineNumber, sourceId } = event;
      const where = sourceId ? ` (${sourceId}:${lineNumber})` : '';
      const fn = level === 'warning' || level === 'error' ? (level === 'warning' ? 'warn' : 'error') : 'log';
      console[fn](`[renderer:${level}] ${message}${where}`);
    });
    // dev mode: F12/Ctrl+Shift+I toggle shortcut (the application menu is null, so the default shortcut doesn't work)
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const toggle = input.key === 'F12'
        || (input.key.toLowerCase() === 'i' && input.control && input.shift);
      if (toggle) {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
    win.loadURL(devUrl);
    return;
  }

  win.loadFile(path.join(__dirname, '../renderer/dist/index.html'));
}

if (isPrimary) app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerMediaProtocol();
  registerAppConfigIpc();
  registerFileSystemIpc();
  registerTerminalIpc();
  registerRemoteIpc();
  registerTransferIpc();
  registerHostVerifyIpc();
  registerGitIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  disposeAllTerminals();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  disposeAllTerminals();
  disposeAllProviders();
});
