const posixPath = require('path').posix;
const { Readable, Writable, PassThrough } = require('stream');
const settingsStore = require('../settings-store');
const secretStore = require('../remote-secret-store');
const { connectFtpClient } = require('../remote-connection');
const { decodeTextBuffer } = require('../local-file-system');

const MAX_TEXT_BYTES = 1024 * 1024 * 2;
const POOL_IDLE_MS = 10 * 60_000;
const pool = new Map();      /* authority → {client, busyPromise, lastUsed} */
const inflight = new Map();
let sweepInterval = null;

function isUri(p) {
  return typeof p === 'string' && /^ftps?:\/\//i.test(p);
}

function parseUri(uri) {
  if (!isUri(uri)) throw new Error(`Not an ftp URI: ${uri}`);
  const u = new URL(uri);
  const secure = u.protocol === 'ftps:';
  const port = u.port ? Number(u.port) : 21;
  const username = u.username ? decodeURIComponent(u.username) : '';
  const path = u.pathname ? decodeURIComponent(u.pathname) : '/';
  return {
    secure,
    username,
    host: u.hostname,
    port,
    path: path || '/',
    authority: `${u.protocol}//${u.username || ''}@${u.hostname}:${port}`
  };
}

function makeUri(authority, p) {
  const safe = p.startsWith('/') ? p : `/${p}`;
  return `${authority}${safe}`;
}

function findProfile(authority) {
  const settings = settingsStore.loadSettings();
  return (settings.projects || []).find((p) => {
    if (p.type !== 'ftp') return false;
    const proto = p.secure ? 'ftps' : 'ftp';
    const userPart = p.username ? encodeURIComponent(p.username) : '';
    const expected = `${proto}://${userPart}@${p.host}:${p.port || 21}`;
    return expected === authority;
  });
}

function startSweeper() {
  if (sweepInterval) return;
  sweepInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of pool.entries()) {
      if (now - entry.lastUsed > POOL_IDLE_MS) {
        try { entry.client.close(); } catch {}
        pool.delete(key);
      }
    }
    if (!pool.size) {
      clearInterval(sweepInterval);
      sweepInterval = null;
    }
  }, 15_000).unref?.();
}

async function ensureConnection(authority) {
  const existing = pool.get(authority);
  /* FTP has no keepalive, so the server may drop idle connections → discard a closed connection and reconnect. */
  if (existing && !existing.client.closed) {
    existing.lastUsed = Date.now();
    return existing;
  }
  if (existing) {
    pool.delete(authority);
    try { existing.client.close(); } catch {}
  }
  if (inflight.has(authority)) return inflight.get(authority);

  const promise = (async () => {
    try {
      const profile = findProfile(authority);
      if (!profile) throw new Error(`No FTP profile for ${authority}`);
      const secret = secretStore.getSecret(profile.id);
      /* Connection, FTPS certificate TOFU, and login are handled by the shared helper (same path as testFtp). */
      const client = await connectFtpClient(profile, secret, { timeout: 15000 });
      const entry = { client, busyPromise: Promise.resolve(), lastUsed: Date.now() };
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

/* Unlike SFTP, FTP has no channel multiplexing — one connection does one transfer at a time.
   Serialized via the busyPromise chain. */
async function withFtp(uri, fn) {
  const parsed = parseUri(uri);
  let lastErr;
  /* If the connection was already dead or dropped mid-operation, reconnect once and retry (handles stale connections from a server idle FIN). */
  for (let attempt = 0; attempt < 2; attempt++) {
    const entry = await ensureConnection(parsed.authority);
    const run = entry.busyPromise.then(async () => {
      entry.lastUsed = Date.now();
      try {
        return await fn(entry.client, parsed);
      } finally {
        entry.lastUsed = Date.now();
      }
    });
    entry.busyPromise = run.catch(() => {});
    try {
      return await run;
    } catch (err) {
      lastErr = err;
      const dead = (entry.client && entry.client.closed)
        || /sent FIN|Client is closed|ECONNRESET|EPIPE|not connected|socket.*clos/i.test(err?.message || '');
      if (dead && attempt === 0) {
        pool.delete(parsed.authority);
        try { entry.client.close(); } catch {}
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function compareEntryNames(a, b) {
  return a.localeCompare(b, ['en', 'ko'], { numeric: true, sensitivity: 'base' });
}

/* basic-ftp FileInfo.type: 1=File, 2=Directory, 0=Unknown */
function entryType(e) {
  if (e.type === 2) return 'directory';
  if (e.type === 1) return 'file';
  return 'file';
}

/* Listing that throws on error — so callers can distinguish permission denied, etc. */
async function listEntries(uri) {
  return await withFtp(uri, async (client, parsed) => {
    const entries = await client.list(parsed.path);
    return entries
      .map((e) => ({
        name: e.name,
        path: makeUri(parsed.authority, posixPath.join(parsed.path, e.name)),
        type: entryType(e),
        isLink: !!e.isSymbolicLink,
        size: e.size || 0
      }))
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

function downloadToBuffer(client, remotePath, startAt) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({
      write(chunk, _enc, cb) { chunks.push(chunk); cb(); }
    });
    client.downloadTo(sink, remotePath, startAt || 0)
      .then(() => resolve(Buffer.concat(chunks)))
      .catch(reject);
  });
}

async function readTextDescriptor(uri) {
  try {
    return await withFtp(uri, async (client, parsed) => {
      const size = await client.size(parsed.path).catch(() => -1);
      if (size === 0) return { status: 'ok', content: '', encoding: 'UTF-8', size: 0 };
      if (size > MAX_TEXT_BYTES) return { status: 'error', content: '' };
      const buffer = await downloadToBuffer(client, parsed.path);
      const decoded = decodeTextBuffer(buffer);
      if (!decoded) return { status: 'unsupported-encoding', content: '' };
      return { status: 'ok', content: decoded.content, encoding: decoded.encoding, size: size >= 0 ? size : buffer.length };
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
    return await withFtp(uri, async (client, parsed) => {
      const buffer = await downloadToBuffer(client, parsed.path);
      const mime = detectMime(parsed.path);
      return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, size: buffer.length };
    });
  } catch {
    return { ok: false, dataUrl: '' };
  }
}

async function statFile(uri) {
  try {
    return await withFtp(uri, async (client, parsed) => {
      const size = await client.size(parsed.path);
      return { ok: true, size, isFile: true };
    });
  } catch {
    return { ok: false, size: 0, isFile: false };
  }
}

/* Existence check (for file links, etc.) — a successful size query means the file exists. */
async function exists(uri) {
  const r = await statFile(uri);
  return !!r?.ok;
}

async function getMediaUrl(uri) {
  try {
    if (!isUri(uri)) return { ok: false, url: '' };
    return await withFtp(uri, async (client, parsed) => {
      const size = await client.size(parsed.path);
      const encodedUri = Buffer.from(uri, 'utf8').toString('base64url');
      const safeName = encodeURIComponent(posixPath.basename(parsed.path));
      return { ok: true, url: `oyen-media://ftp/${encodedUri}/${safeName}`, size };
    });
  } catch {
    return { ok: false, url: '' };
  }
}

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

/* FTP only supports startAt; the end is cut off on the client side. Received via PassThrough and the stream is closed once the byte count is reached. */
async function serveMedia(request, uri, mimeFn) {
  return await withFtp(uri, async (client, parsed) => {
    const size = await client.size(parsed.path);
    const range = request.headers.get('range');
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': mimeFn(parsed.path),
      'Access-Control-Allow-Origin': '*'
    };

    if (!range) {
      headers['Content-Length'] = String(size);
      if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
      const pass = new PassThrough();
      client.downloadTo(pass, parsed.path).catch(() => pass.destroy());
      return new Response(Readable.toWeb(pass), { status: 200, headers });
    }

    const span = parseRange(range, size);
    if (!span) {
      return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
    }
    headers['Content-Length'] = String(span.end - span.start + 1);
    headers['Content-Range'] = `bytes ${span.start}-${span.end}/${size}`;
    if (request.method === 'HEAD') return new Response(null, { status: 206, headers });
    const pass = new PassThrough();
    const wanted = span.end - span.start + 1;
    let received = 0;
    pass.on('data', (chunk) => {
      received += chunk.length;
      if (received >= wanted) pass.end();
    });
    client.downloadTo(pass, parsed.path, span.start).catch(() => pass.destroy());
    return new Response(Readable.toWeb(pass), { status: 206, headers });
  });
}

async function createFile(uri) {
  try {
    return await withFtp(uri, async (client, parsed) => {
      /* Detect both same-named files and folders (same as SFTP) → EEXIST. */
      const base = posixPath.basename(parsed.path);
      const parent = posixPath.dirname(parsed.path);
      const entries = await client.list(parent).catch(() => []);
      if (entries.some((e) => e.name === base)) return { ok: false, message: 'EEXIST' };
      await client.uploadFrom(Readable.from(''), parsed.path);
      return { ok: true };
    });
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function createDirectory(uri) {
  try {
    return await withFtp(uri, async (client, parsed) => {
      /* ensureDir silently passes even when it exists → to match SFTP, check first and return EEXIST. */
      const base = posixPath.basename(parsed.path);
      const parent = posixPath.dirname(parsed.path);
      const entries = await client.list(parent).catch(() => []);
      if (entries.some((e) => e.name === base)) return { ok: false, message: 'EEXIST' };
      await client.ensureDir(parsed.path);
      return { ok: true };
    });
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function writeText(uri, content) {
  try {
    return await withFtp(uri, async (client, parsed) => {
      const buffer = Buffer.from(String(content || ''), 'utf8');
      await client.uploadFrom(Readable.from(buffer), parsed.path);
      return { ok: true, size: buffer.length };
    });
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function renameFile(uri, nextName) {
  try {
    return await withFtp(uri, async (client, parsed) => {
      const dirPath = posixPath.dirname(parsed.path);
      const nextPath = posixPath.join(dirPath, nextName);
      /* Block if the target already exists (overwrite risk depending on the server) — EEXIST, same as SFTP. */
      if (nextPath !== parsed.path) {
        const entries = await client.list(dirPath).catch(() => []);
        if (entries.some((e) => e.name === nextName)) return { ok: false, message: 'EEXIST' };
      }
      await client.rename(parsed.path, nextPath);
      return { ok: true, path: makeUri(parsed.authority, nextPath), name: nextName };
    });
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

async function trashFile(uri) {
  try {
    return await withFtp(uri, async (client, parsed) => {
      /* remove for a file, removeEmptyDir for a dir. The type is hard to determine — try file first. */
      try { await client.remove(parsed.path); return { ok: true }; }
      catch { /* maybe dir */ }
      await client.removeEmptyDir(parsed.path);
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

async function uploadFile(localPath, dstUri) {
  return withFtp(dstUri, (client, parsed) => client.uploadFrom(localPath, parsed.path));
}

async function downloadFile(srcUri, localPath) {
  return withFtp(srcUri, (client, parsed) => client.downloadTo(localPath, parsed.path));
}

async function uploadFileWithProgress(localPath, dstUri, onBytes) {
  return withFtp(dstUri, async (client, parsed) => {
    client.trackProgress((info) => { try { onBytes(info.bytesOverall); } catch {} });
    try { await client.uploadFrom(localPath, parsed.path); }
    finally { client.trackProgress(); }
  });
}

async function downloadFileWithProgress(srcUri, localPath, onBytes) {
  return withFtp(srcUri, async (client, parsed) => {
    client.trackProgress((info) => { try { onBytes(info.bytesOverall); } catch {} });
    try { await client.downloadTo(localPath, parsed.path); }
    finally { client.trackProgress(); }
  });
}

async function copyBetweenFtp(srcUri, dstUri) {
  const buffer = await withFtp(srcUri, (client, parsed) => downloadToBuffer(client, parsed.path));
  await withFtp(dstUri, (client, parsed) => client.uploadFrom(Readable.from(buffer), parsed.path));
}

/* opts: { ctl?: {cancelled}, onProgress? } — same contract as sftp-provider scanDirectory (scan popup). */
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

async function resolveHome(authority) {
  /* Query the home path (pwd) — '/' if it fails or is non-standard. The picker opens at '/' first and then navigates here,
     so a slow or failing pwd doesn't block "open" (it's not a connection gate). */
  return withFtp(`${authority}/`, async (client) => {
    try { return (await client.pwd()) || '/'; }
    catch { return '/'; }
  });
}

function disconnectAll() {
  for (const [key, entry] of pool.entries()) {
    try { entry.client.close(); } catch {}
    pool.delete(key);
  }
  if (sweepInterval) { clearInterval(sweepInterval); sweepInterval = null; }
}

module.exports = {
  isUri,
  parseUri,
  makeUri,
  resolveHome,
  safeList,
  listEntries,
  readTextDescriptor,
  readDataUrl,
  getMediaUrl,
  statFile,
  exists,
  createFile,
  createDirectory,
  writeText,
  renameFile,
  trashFile,
  openFileInDefaultApp,
  revealFile,
  showFileProperties,
  uploadFile,
  downloadFile,
  uploadFileWithProgress,
  downloadFileWithProgress,
  copyBetweenFtp,
  scanDirectory,
  serveMedia,
  disconnectAll
};
