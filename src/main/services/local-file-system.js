const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { app, dialog, shell, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const jschardet = require('jschardet');
const iconv = require('iconv-lite');

const MAX_TEXT_BYTES = 1024 * 1024 * 2;

function getWindowsDriveRoots() {
  const roots = [];
  for (let code = 65; code <= 90; code += 1) {
    const letter = String.fromCharCode(code);
    const drivePath = `${letter}:\\`;
    if (fs.existsSync(drivePath)) {
      roots.push(drivePath);
    }
  }
  return roots;
}

function getDefaultRoot() {
  if (process.platform !== 'win32') return '/';

  const systemDrive = `${process.env.SystemDrive || 'C:'}\\`;
  if (fs.existsSync(systemDrive)) return systemDrive;

  return getWindowsDriveRoots()[0] || 'C:\\';
}

function getRootForPath(filePath, fallbackRoot) {
  return path.parse(filePath || '').root || fallbackRoot;
}

function compareEntryNames(a, b) {
  return a.localeCompare(b, ['en', 'ko'], {
    numeric: true,
    sensitivity: 'base'
  });
}

/* A listing that throws — so the caller can distinguish cases like permission denied. */
async function listEntries(dirPath) {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => !isHiddenSystemLink(entry))
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      type: entry.isDirectory() ? 'directory' : 'file'
    }))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return compareEntryNames(a.name, b.name);
    });
}

async function safeList(dirPath) {
  try { return await listEntries(dirPath); }
  catch { return []; }
}

function isHiddenSystemLink(entry) {
  return entry.isDirectory() && entry.isSymbolicLink();
}

function sniffBinary(buffer) {
  if (!buffer || !buffer.length) return false;
  let suspicious = 0;
  const limit = Math.min(buffer.length, 4096);
  for (let i = 0; i < limit; i += 1) {
    const c = buffer[i];
    if (c === 0) return true;
    if ((c < 7 || (c > 14 && c < 32)) && c !== 9 && c !== 10 && c !== 13) suspicious += 1;
  }
  return suspicious / limit > 0.12;
}

function hasUtf16Pattern(buffer, offset) {
  if (!buffer || buffer.length < 8) return false;
  const limit = Math.min(buffer.length, 4096);
  let nulls = 0;
  let samples = 0;
  for (let i = offset; i < limit; i += 2) {
    samples += 1;
    if (buffer[i] === 0) nulls += 1;
  }
  return samples > 0 && nulls / samples > 0.6;
}

function decodeUtf16Be(buffer) {
  const swapped = Buffer.allocUnsafe(buffer.length);
  for (let i = 0; i < buffer.length; i += 2) {
    swapped[i] = buffer[i + 1] ?? 0;
    swapped[i + 1] = buffer[i];
  }
  return swapped.toString('utf16le');
}

const UTF8_DECODER_STRICT = new TextDecoder('utf-8', { fatal: true });

function isValidUtf8(buffer) {
  try {
    UTF8_DECODER_STRICT.decode(buffer);
    return true;
  } catch {
    return false;
  }
}

function normalizeEncodingLabel(name) {
  if (!name) return 'Unknown';
  const upper = String(name).toUpperCase();
  if (upper === 'UTF-8' || upper === 'ASCII') return 'UTF-8';
  if (upper === 'WINDOWS-949' || upper === 'CP949') return 'EUC-KR';
  return upper;
}

function detectAndDecode(buffer) {
  let result;
  try {
    result = jschardet.detect(buffer);
  } catch {
    return null;
  }
  if (!result || !result.encoding) return null;
  if ((result.confidence ?? 0) < 0.7) return null;
  const enc = result.encoding;
  if (!iconv.encodingExists(enc)) return null;
  try {
    const content = iconv.decode(buffer, enc);
    return { content, encoding: normalizeEncodingLabel(enc) };
  } catch {
    return null;
  }
}

function decodeTextBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { content: buffer.subarray(2).toString('utf16le'), encoding: 'UTF-16 LE' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return { content: decodeUtf16Be(buffer.subarray(2)), encoding: 'UTF-16 BE' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { content: buffer.subarray(3).toString('utf8'), encoding: 'UTF-8 BOM' };
  }
  if (hasUtf16Pattern(buffer, 1)) return { content: buffer.toString('utf16le'), encoding: 'UTF-16 LE' };
  if (hasUtf16Pattern(buffer, 0)) return { content: decodeUtf16Be(buffer), encoding: 'UTF-16 BE' };
  if (sniffBinary(buffer)) return null;
  if (isValidUtf8(buffer)) return { content: buffer.toString('utf8'), encoding: 'UTF-8' };
  const detected = detectAndDecode(buffer);
  if (detected) return detected;
  return { content: buffer.toString('utf8'), encoding: 'UTF-8' };
}

async function readTextDescriptor(filePath) {
  let fh;
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size === 0) {
      return { status: 'ok', content: '', encoding: 'UTF-8', size: 0 };
    }
    fh = await fs.promises.open(filePath, 'r');
    const toRead = Math.min(stat.size, MAX_TEXT_BYTES);
    const buf = Buffer.allocUnsafe(toRead);
    await fh.read(buf, 0, toRead, 0);
    const decoded = decodeTextBuffer(buf);
    if (decoded === null) return { status: 'unsupported-encoding', content: '' };
    return { status: 'ok', content: decoded.content, encoding: decoded.encoding, size: stat.size };
  } catch {
    return { status: 'error', content: '' };
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

function detectMime(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  const map = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
    '.ogg': 'video/ogg',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.opus': 'audio/ogg'
  };
  return map[ext] || 'application/octet-stream';
}

function readDataUrl(filePath) {
  try {
    const mime = detectMime(filePath);
    const buffer = fs.readFileSync(filePath);
    return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, size: buffer.length };
  } catch {
    return { ok: false, dataUrl: '' };
  }
}

function getMediaUrl(filePath) {
  try {
    const encodedPath = Buffer.from(filePath, 'utf8').toString('base64url');
    const safeName = encodeURIComponent(path.basename(filePath));
    const stat = fs.statSync(filePath);
    return { ok: true, url: `oyen-media://local/${encodedPath}/${safeName}`, size: stat.isFile() ? stat.size : undefined };
  } catch {
    return { ok: false, url: '' };
  }
}

async function createFile(filePath) {
  try {
    await fs.promises.writeFile(filePath, '', { flag: 'wx' });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function createDirectory(dirPath) {
  try {
    await fs.promises.mkdir(dirPath);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function encodeTextBuffer(content, encoding) {
  if (encoding === 'UTF-16 LE') {
    const bom = Buffer.from([0xff, 0xfe]);
    return Buffer.concat([bom, Buffer.from(content, 'utf16le')]);
  }
  if (encoding === 'UTF-16 BE') {
    const bom = Buffer.from([0xfe, 0xff]);
    const utf16le = Buffer.from(content, 'utf16le');
    const swapped = Buffer.allocUnsafe(utf16le.length);
    for (let i = 0; i < utf16le.length; i += 2) {
      swapped[i] = utf16le[i + 1] ?? 0;
      swapped[i + 1] = utf16le[i];
    }
    return Buffer.concat([bom, swapped]);
  }
  if (encoding === 'UTF-8 BOM') {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, 'utf8')]);
  }
  return Buffer.from(content, 'utf8');
}

async function writeText(filePath, content, encoding) {
  try {
    const buffer = encodeTextBuffer(String(content || ''), encoding || 'UTF-8');
    await fs.promises.writeFile(filePath, buffer);
    return { ok: true, size: buffer.length };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function renameFile(filePath, nextName) {
  try {
    const dirPath = path.dirname(filePath);
    const nextPath = path.join(dirPath, nextName);
    /* fs.rename overwrites the target if it exists → block it upfront (EEXIST) to prevent data loss.
       But allow renaming that only changes the case of the same file (Windows is case-insensitive). */
    const samePath = process.platform === 'win32'
      ? nextPath.toLowerCase() === filePath.toLowerCase()
      : nextPath === filePath;
    if (!samePath && fs.existsSync(nextPath)) {
      return { ok: false, message: 'EEXIST' };
    }
    await fs.promises.rename(filePath, nextPath);
    return { ok: true, path: nextPath, name: nextName };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function trashFile(filePath) {
  try {
    await shell.trashItem(filePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function openFileInDefaultApp(filePath) {
  try {
    const message = await shell.openPath(filePath);
    return { ok: !message, message };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function revealFile(filePath) {
  try {
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function pickDirectory(defaultPath) {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const options = {
      properties: ['openDirectory'],
      title: 'Open Folder'
    };
    if (defaultPath && typeof defaultPath === 'string') {
      options.defaultPath = defaultPath;
    }
    const result = await dialog.showOpenDialog(win, options);
    if (result.canceled || !result.filePaths?.length) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function pickFile({ defaultPath, title, filters } = {}) {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const options = {
      properties: ['openFile'],
      title: title || 'Select File'
    };
    if (defaultPath && typeof defaultPath === 'string') options.defaultPath = defaultPath;
    if (Array.isArray(filters)) options.filters = filters;
    const result = await dialog.showOpenDialog(win, options);
    if (result.canceled || !result.filePaths?.length) return { ok: false };
    return { ok: true, path: result.filePaths[0] };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

async function pickSaveFile({ defaultPath, title, filters } = {}) {
  try {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    const options = {
      title: title || 'Save As'
    };
    if (defaultPath && typeof defaultPath === 'string') options.defaultPath = defaultPath;
    if (Array.isArray(filters)) options.filters = filters;
    const result = await dialog.showSaveDialog(win, options);
    if (result.canceled || !result.filePath) return { ok: false };
    return { ok: true, path: result.filePath };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function showFileProperties(filePath) {
  try {
    if (process.platform === 'win32') {
      const dirEscaped = path.dirname(filePath).replace(/'/g, "''");
      const baseEscaped = path.basename(filePath).replace(/'/g, "''");
      const fullEscaped = (filePath || '').replace(/'/g, "''");
      // InvokeVerb('Properties') uses a canonical name, so it's recognized regardless of locale. Avoids Verbs() enumerate (which wakes every shell extension and is slow).
      // On the rare failure, fall back to the SHObjectProperties Win32 API. fire-and-forget via detached + unref + stdio:ignore.
      const script = `
        try {
          $shell = New-Object -ComObject Shell.Application
          $shell.Namespace('${dirEscaped}').ParseName('${baseEscaped}').InvokeVerb('Properties')
        } catch {
          Add-Type -Namespace W -Name S -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll", CharSet=System.Runtime.InteropServices.CharSet.Auto)] public static extern bool SHObjectProperties(System.IntPtr hwnd, uint type, [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPWStr)] string path, [System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.LPWStr)] string verb);'
          [W.S]::SHObjectProperties([System.IntPtr]::Zero, 2, '${fullEscaped}', $null) | Out-Null
        }
        Start-Sleep -Seconds 1800
      `;
      const encoded = Buffer.from(script, 'utf-16le').toString('base64');
      // detached:false + unref is required — detached:true breaks PowerShell's COM dialog hosting on Windows (the dialog never appears).
      // unref lets the Electron main process not wait. If Electron exits, PowerShell dies with it, but by then the task is done, so it's fine.
      spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        detached: false,
        stdio: 'ignore'
      }).unref();
      return { ok: true };
    }

    if (process.platform === 'darwin') {
      const escaped = filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const script = `tell application "Finder"
        activate
        open information window of (POSIX file "${escaped}" as alias)
      end tell`;
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref();
      return { ok: true };
    }

    // Linux: no standard unified properties dialog — fall back to revealing in the folder
    shell.showItemInFolder(filePath);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

function getDefaultRootInfo() {
  const root = getDefaultRoot();
  const platform = process.platform;

  if (platform === 'win32') {
    const desktopPath = app.getPath('desktop') || root;
    const documentsPath = app.getPath('documents') || root;
    const driveRoots = getWindowsDriveRoots();
    const driveOptions = driveRoots.map((driveRoot) => {
      const letter = driveRoot.slice(0, 1).toLowerCase();
      return { key: `drive:${letter}`, label: `[${driveRoot.slice(0, 2)}]`, path: driveRoot };
    });

    return {
      root,
      platform,
      roots: [
        ...driveOptions,
        { key: 'documents', label: 'Documents', path: documentsPath, treeRootPath: getRootForPath(documentsPath, root) },
        { key: 'desktop', label: 'Desktop', path: desktopPath, treeRootPath: getRootForPath(desktopPath, root) }
      ],
      expandPath: root
    };
  }

  const homePath = process.env.HOME || '/';
  return {
    root,
    platform,
    roots: [
      { key: 'root', label: '/', path: '/' },
      { key: 'home', label: 'Home', path: homePath },
      { key: 'documents', label: 'Documents', path: path.join(homePath, 'Documents'), treeRootPath: '/' },
      { key: 'desktop', label: 'Desktop', path: path.join(homePath, 'Desktop'), treeRootPath: '/' }
    ],
    expandPath: homePath
  };
}

/* Check whether a path exists (shared by file links, etc.). statMode is remote-permissions-only, so it can't be used for existence checks. */
async function exists(filePath) {
  return fs.existsSync(filePath);
}

/* Save As (non-text) — copy the original as a raw binary. Local only. */
async function copyFile(src, dest) {
  await fs.promises.copyFile(src, dest);
  const st = await fs.promises.stat(dest);
  return { ok: true, size: st.size };
}

module.exports = {
  copyFile,
  exists,
  getDefaultRootInfo,
  getMediaUrl,
  createDirectory,
  createFile,
  openFileInDefaultApp,
  pickDirectory,
  pickSaveFile,
  pickFile,
  readDataUrl,
  readTextDescriptor,
  renameFile,
  revealFile,
  safeList,
  listEntries,
  writeText,
  showFileProperties,
  trashFile,
  decodeTextBuffer,
  sniffBinary
};
