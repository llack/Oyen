const posixPath = require('path').posix;
const { Readable } = require('stream');
const settingsStore = require('../settings-store');
const secretStore = require('../remote-secret-store');
const { connectClient, openJump, makeProxySock } = require('../remote-connection');
const { decodeTextBuffer } = require('../local-file-system');

const MAX_TEXT_BYTES = 1024 * 1024 * 2;
/* SFTP cold connections are expensive, so keep the idle cache long (30 min) — no reconnect after stepping away briefly.
   keepalive (30s) keeps it alive, and dead connections are detected and cleaned within ~90s, so it stays light with no stale entries. */
const POOL_IDLE_MS = 30 * 60_000;
const pool = new Map();
const inflight = new Map();
let sweepInterval = null;

/* One-line wrapper over ssh2 sftp's callback API. Variadic arity. */
function callSftp(sftp, method, ...args) {
  return new Promise((resolve, reject) => {
    sftp[method](...args, (err, value) => err ? reject(err) : resolve(value));
  });
}

/* Collect an SFTP read stream into a single Buffer. Reads the whole file when opts is omitted. */
function readSftpStream(sftp, path, opts) {
  return new Promise((resolve, reject) => {
    const stream = opts ? sftp.createReadStream(path, opts) : sftp.createReadStream(path);
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/* Push one Buffer to an SFTP write stream and wait for close. */
function writeSftpStream(sftp, path, buffer, opts) {
  return new Promise((resolve, reject) => {
    const stream = opts ? sftp.createWriteStream(path, opts) : sftp.createWriteStream(path);
    stream.once('error', reject);
    stream.once('close', resolve);
    stream.end(buffer);
  });
}

function startSweeper() {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of pool.entries()) {
      if (entry.refCount > 0) continue;
      if (now - entry.lastUsed > POOL_IDLE_MS) {
        try { entry.client.end(); } catch {}
        pool.delete(key);
      }
    }
    if (!pool.size) {
      clearInterval(sweepInterval);
      sweepInterval = null;
    }
  }, 15_000).unref?.();
}

function parseUri(uri) {
  if (typeof uri !== 'string' || !/^sftp:\/\//i.test(uri)) {
    throw new Error(`Not an sftp URI: ${uri}`);
  }
  const u = new URL(uri);
  const port = u.port ? Number(u.port) : 22;
  const username = u.username ? decodeURIComponent(u.username) : '';
  const path = u.pathname ? decodeURIComponent(u.pathname) : '/';
  return {
    username,
    host: u.hostname,
    port,
    path: path || '/',
    authority: `sftp://${u.username || ''}@${u.hostname}:${port}`
  };
}

function makeUri(authority, path) {
  const safe = path.startsWith('/') ? path : `/${path}`;
  return `${authority}${safe}`;
}

function findProfile(authority) {
  const settings = settingsStore.loadSettings();
  return (settings.projects || []).find((p) => {
    if (p.type !== 'sftp') return false;
    const userPart = p.username ? encodeURIComponent(p.username) : '';
    const expected = `sftp://${userPart}@${p.host}:${p.port || 22}`;
    return expected === authority;
  });
}

async function ensureConnection(authority) {
  const existing = pool.get(authority);
  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }
  if (inflight.has(authority)) return inflight.get(authority);

  const promise = (async () => {
    try {
      const profile = findProfile(authority);
      if (!profile) throw new Error(`No SFTP profile for ${authority}`);
      const secret = secretStore.getSecret(profile.id);
      let jump = null;
      let client;
      try {
        jump = await openJump(profile, secret);
        /* jump and proxy are mutually exclusive — fall back to the HTTP proxy sock when there's no jump. */
        const makeSock = jump?.makeSock || (profile.proxy?.host ? makeProxySock(profile, secret) : null);
        client = await connectClient(profile, secret, makeSock);
      } catch (err) {
        if (jump) jump.cleanup();
        throw err;
      }
      const sftp = await new Promise((resolve, reject) => {
        client.sftp((err, s) => err ? reject(err) : resolve(s));
      });
      const closeHop = () => { pool.delete(authority); if (jump) jump.cleanup(); };
      client.on('end', closeHop);
      client.on('close', closeHop);
      /* remoteVer: the server's SSH version string (e.g. "OpenSSH_for_Windows_9.5") — used to determine chmod support. */
      const entry = { client, sftp, lastUsed: Date.now(), refCount: 0, remoteVer: client._remoteVer || '' };
      pool.set(authority, entry);
      startSweeper();
      return entry;
    } finally {
      inflight.delete(authority);
    }
  })();
  inflight.set(authority, promise);
  return promise;
}

async function withSftp(uri, fn) {
  const parsed = parseUri(uri);
  const entry = await ensureConnection(parsed.authority);
  entry.lastUsed = Date.now();
  try {
    return await fn(entry.sftp, parsed);
  } finally {
    entry.lastUsed = Date.now();
  }
}

/* Run one remote shell command over a warm pooled connection. Collects stdout/stderr/exit code.
   When stdinData is given, it's piped to stdin then EOF (for git commit -F -). Used by git-remote-service. */
async function execCommand(authority, command, stdinData) {
  const entry = await ensureConnection(authority);
  entry.lastUsed = Date.now();
  return new Promise((resolve, reject) => {
    entry.client.exec(command, (err, stream) => {
      if (err) { reject(err); return; }
      let stdout = '';
      let stderr = '';
      stream.on('close', (code) => {
        entry.lastUsed = Date.now();
        resolve({ code: typeof code === 'number' ? code : 0, stdout, stderr });
      });
      stream.on('data', (d) => { stdout += d.toString('utf8'); });
      stream.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
      stream.on('error', reject);
      if (stdinData != null) stream.end(String(stdinData));
      else stream.end();
    });
  });
}

function compareEntryNames(a, b) {
  return a.localeCompare(b, ['en', 'ko'], { numeric: true, sensitivity: 'base' });
}

/* Listing that throws on error — so callers can distinguish permission denied, etc. */
async function listEntries(uri) {
  return await withSftp(uri, async (sftp, parsed) => {
    const entries = await callSftp(sftp, 'readdir', parsed.path);
    return entries
      .map((e) => {
        const isDir = (e.attrs?.mode & 0o040000) === 0o040000;
        const isLink = (e.attrs?.mode & 0o120000) === 0o120000;
        return {
          name: e.filename,
          path: makeUri(parsed.authority, posixPath.join(parsed.path, e.filename)),
          type: isDir ? 'directory' : 'file',
          isLink,
          size: e.attrs?.size || 0
        };
      })
      .filter((e) => !(e.type === 'directory' && e.isLink))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return compareEntryNames(a.name, b.name);
      });
  });
}

async function safeList(uri) {
  try { return await listEntries(uri); }
  catch { return []; }
}

/* Current permission bits (lower 3 octal digits, e.g. 0o755) + whether it's a Windows server.
   chmod is meaningless on Windows SFTP (OpenSSH for Windows, etc.) → for the caller to warn/block. */
async function statMode(uri) {
  const parsed = parseUri(uri);
  const entry = await ensureConnection(parsed.authority);
  entry.lastUsed = Date.now();
  const attrs = await callSftp(entry.sftp, 'stat', parsed.path);
  /* Windows is determined from the os the user set in the profile rather than guessed (from the banner) — deterministic. */
  const profile = findProfile(parsed.authority);
  return {
    mode: (attrs.mode || 0) & 0o777,
    windows: profile?.os === 'windows'
  };
}

/* Existence check (for file links, etc.) — a successful stat means it exists. */
async function exists(uri) {
  try {
    const parsed = parseUri(uri);
    const entry = await ensureConnection(parsed.authority);
    entry.lastUsed = Date.now();
    await callSftp(entry.sftp, 'stat', parsed.path);
    return true;
  } catch { return false; }
}

/* Change permissions (mode = number, e.g. parseInt('755', 8)). */
async function chmod(uri, mode) {
  return await withSftp(uri, async (sftp, parsed) => {
    await callSftp(sftp, 'chmod', parsed.path, mode);
    return true;
  });
}

/* Recurse a remote folder → flat file list + empty folders + total bytes. Empty folders can't become items, so they're collected separately in emptyDirs.
   opts: { ctl?: {cancelled}, onProgress?: ({files, bytes, dir}) } — reports progress / checks cancellation on each directory read (scan popup). */
async function scanDirectory(uri, opts) {
  const items = [];
  const emptyDirs = [];
  let totalBytes = 0;
  async function walk(currentUri, relPrefix) {
    if (opts?.ctl?.cancelled) return;
    const entries = await safeList(currentUri);
    try { opts?.onProgress?.({ files: items.length, bytes: totalBytes, dir: relPrefix || '/' }); } catch {}
    if (entries.length === 0 && relPrefix) {
      emptyDirs.push(relPrefix);
      return;
    }
    for (const entry of entries) {
      if (opts?.ctl?.cancelled) return;
      const rel = relPrefix ? posixPath.join(relPrefix, entry.name) : entry.name;
      if (entry.type === 'directory') {
        await walk(entry.path, rel);
      } else if (entry.type === 'file') {
        items.push({ source: entry.path, relativePath: rel, size: entry.size || 0, name: entry.name });
        totalBytes += entry.size || 0;
      }
    }
  }
  await walk(uri, '');
  return { items, emptyDirs, totalBytes, cancelled: !!opts?.ctl?.cancelled };
}

async function readTextDescriptor(uri) {
  try {
    return await withSftp(uri, async (sftp, parsed) => {
      const stat = await callSftp(sftp, 'stat', parsed.path);
      if (stat.size === 0) return { status: 'ok', content: '', encoding: 'UTF-8', size: 0 };
      const toRead = Math.min(stat.size, MAX_TEXT_BYTES);
      const buffer = await readSftpStream(sftp, parsed.path, { start: 0, end: toRead - 1 });
      const decoded = decodeTextBuffer(buffer);
      if (!decoded) return { status: 'unsupported-encoding', content: '' };
      return { status: 'ok', content: decoded.content, encoding: decoded.encoding, size: stat.size };
    });
  } catch {
    return { status: 'error', content: '' };
  }
}

function detectMime(filePath) {
  const ext = posixPath.extname(filePath || '').toLowerCase();
  const map = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.bmp': 'image/bmp', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.pdf': 'application/pdf'
  };
  return map[ext] || 'application/octet-stream';
}

async function readDataUrl(uri) {
  try {
    return await withSftp(uri, async (sftp, parsed) => {
      const buffer = await readSftpStream(sftp, parsed.path);
      const mime = detectMime(parsed.path);
      return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, size: buffer.length };
    });
  } catch {
    return { ok: false, dataUrl: '' };
  }
}

async function getMediaUrl(uri) {
  try {
    if (!isUri(uri)) return { ok: false, url: '' };
    return await withSftp(uri, async (sftp, parsed) => {
      const stat = await callSftp(sftp, 'stat', parsed.path);
      const encodedUri = Buffer.from(uri, 'utf8').toString('base64url');
      const safeName = encodeURIComponent(posixPath.basename(parsed.path));
      return { ok: true, url: `oyen-media://sftp/${encodedUri}/${safeName}`, size: stat.size };
    });
  } catch {
    return { ok: false, url: '' };
  }
}

/* Parse the HTTP Range header. Returns null if malformed or out of size bounds. */
function parseRange(range, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return null;
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  }
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) return null;
  return { start, end: Math.min(end, size - 1) };
}

async function serveMedia(request, uri, mimeFn) {
  return await withSftp(uri, async (sftp, parsed) => {
    const stat = await callSftp(sftp, 'stat', parsed.path);
    const isFile = (stat.mode & 0o170000) === 0o100000;
    if (!isFile) return new Response(null, { status: 404 });

    const size = stat.size;
    const range = request.headers.get('range');
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeFn(parsed.path),
      'Access-Control-Allow-Origin': '*'
    };

    if (!range) {
      headers['Content-Length'] = String(size);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
      return new Response(Readable.toWeb(sftp.createReadStream(parsed.path)), { status: 200, headers });
    }

    const span = parseRange(range, size);
    if (!span) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    headers['Content-Length'] = String(span.end - span.start + 1);
    headers['Content-Range'] = `bytes ${span.start}-${span.end}/${size}`;
    if (request.method === 'HEAD') return new Response(null, { status: 206, headers });
    return new Response(Readable.toWeb(sftp.createReadStream(parsed.path, span)), { status: 206, headers });
  });
}

async function createFile(uri) {
  try {
    return await withSftp(uri, async (sftp, parsed) => {
      /* SFTP only returns a generic 'Failure' even when the target exists → check first and return a clear EEXIST. */
      let exists = false;
      try { await callSftp(sftp, 'stat', parsed.path); exists = true; } catch {}
      if (exists) return { ok: false, message: 'EEXIST' };
      await writeSftpStream(sftp, parsed.path, Buffer.alloc(0), { flags: 'wx' });
      return { ok: true };
    });
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function createDirectory(uri) {
  try {
    return await withSftp(uri, async (sftp, parsed) => {
      let exists = false;
      try { await callSftp(sftp, 'stat', parsed.path); exists = true; } catch {}
      if (exists) return { ok: false, message: 'EEXIST' };
      await callSftp(sftp, 'mkdir', parsed.path);
      return { ok: true };
    });
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function writeText(uri, content) {
  try {
    return await withSftp(uri, async (sftp, parsed) => {
      const buffer = Buffer.from(String(content || ''), 'utf8');
      await writeSftpStream(sftp, parsed.path, buffer);
      return { ok: true, size: buffer.length };
    });
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function renameFile(uri, nextName) {
  try {
    return await withSftp(uri, async (sftp, parsed) => {
      const dirPath = posixPath.dirname(parsed.path);
      const nextPath = posixPath.join(dirPath, nextName);
      /* SFTP rename only returns a generic 'Failure' even when the target already exists → check first and return a clear code (EEXIST).
         (the renderer's friendlyFsError maps EEXIST to an "already exists" message) */
      if (nextPath !== parsed.path) {
        let exists = false;
        try { await callSftp(sftp, 'stat', nextPath); exists = true; } catch {}
        if (exists) return { ok: false, message: 'EEXIST' };
      }
      await callSftp(sftp, 'rename', parsed.path, nextPath);
      return { ok: true, path: makeUri(parsed.authority, nextPath), name: nextName };
    });
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function trashFile(uri) {
  try {
    return await withSftp(uri, async (sftp, parsed) => {
      const stat = await callSftp(sftp, 'stat', parsed.path);
      const isDir = (stat.mode & 0o040000) === 0o040000;
      await callSftp(sftp, isDir ? 'rmdir' : 'unlink', parsed.path);
      return { ok: true };
    });
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function openFileInDefaultApp() {
  return { ok: false, message: 'Remote files cannot be opened with the OS default app.' };
}

function revealFile() {
  return { ok: false, message: 'Remote files cannot be opened on this PC.' };
}

function showFileProperties() {
  return { ok: false, message: 'Remote file properties are not supported.' };
}

function isUri(p) {
  return typeof p === 'string' && /^sftp:\/\//i.test(p);
}

async function statFile(uri) {
  try {
    return await withSftp(uri, async (sftp, parsed) => {
      const s = await callSftp(sftp, 'stat', parsed.path);
      const isFile = (s.mode & 0o170000) === 0o100000;
      return { ok: true, size: s.size, isFile };
    });
  } catch {
    return { ok: false, size: 0, isFile: false };
  }
}

async function uploadFile(localPath, dstUri) {
  return withSftp(dstUri, (sftp, parsed) => callSftp(sftp, 'fastPut', localPath, parsed.path, {}));
}

async function downloadFile(srcUri, localPath) {
  return withSftp(srcUri, (sftp, parsed) => callSftp(sftp, 'fastGet', parsed.path, localPath, {}));
}

/* Report cumulative bytes via fastPut/fastGet's step callback. ssh2 calls it on each chunk. */
async function uploadFileWithProgress(localPath, dstUri, onBytes) {
  return withSftp(dstUri, async (sftp, parsed) => {
    await new Promise((resolve, reject) => {
      sftp.fastPut(localPath, parsed.path, {
        step: (transferred) => { try { onBytes(transferred); } catch {} }
      }, (err) => err ? reject(err) : resolve());
    });
  });
}

async function downloadFileWithProgress(srcUri, localPath, onBytes) {
  return withSftp(srcUri, async (sftp, parsed) => {
    await new Promise((resolve, reject) => {
      sftp.fastGet(parsed.path, localPath, {
        step: (transferred) => { try { onBytes(transferred); } catch {} }
      }, (err) => err ? reject(err) : resolve());
    });
  });
}

async function copyBetweenSftp(srcUri, dstUri) {
  const buffer = await withSftp(srcUri, (sftp, parsed) => readSftpStream(sftp, parsed.path));
  await withSftp(dstUri, (sftp, parsed) => writeSftpStream(sftp, parsed.path, buffer));
}

async function acquireClient(authority) {
  const entry = await ensureConnection(authority);
  entry.refCount = (entry.refCount || 0) + 1;
  entry.lastUsed = Date.now();
  return entry;
}

function releaseClient(authority) {
  const entry = pool.get(authority);
  if (!entry) return;
  entry.refCount = Math.max(0, (entry.refCount || 0) - 1);
  entry.lastUsed = Date.now();
}

async function resolveHome(authority) {
  const fakeUri = `${authority}/`;
  return withSftp(fakeUri, (sftp) => callSftp(sftp, 'realpath', '.').then((p) => p || '/'));
}

function disconnectAll() {
  for (const [key, entry] of pool.entries()) {
    try { entry.client.end(); } catch {}
    pool.delete(key);
  }
  if (sweepInterval) {
    clearInterval(sweepInterval);
    sweepInterval = null;
  }
}

module.exports = {
  isUri,
  parseUri,
  makeUri,
  execCommand,
  acquireClient,
  releaseClient,
  resolveHome,
  safeList,
  listEntries,
  statMode,
  chmod,
  exists,
  readTextDescriptor,
  readDataUrl,
  getMediaUrl,
  createFile,
  createDirectory,
  writeText,
  renameFile,
  trashFile,
  openFileInDefaultApp,
  revealFile,
  showFileProperties,
  statFile,
  uploadFile,
  downloadFile,
  uploadFileWithProgress,
  downloadFileWithProgress,
  copyBetweenSftp,
  scanDirectory,
  serveMedia,
  disconnectAll
};
