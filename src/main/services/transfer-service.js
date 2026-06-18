const fs = require('fs');
const path = require('path');
const { posix: posixPath } = require('path');
const registry = require('./providers/registry');

const CONCURRENCY = 4;
const jobs = new Map(); /* jobId → { cancelled: boolean } */

function isUri(p) {
  return typeof p === 'string' && /^[a-z]+:\/\//i.test(p);
}

/* URI scheme (sftp/ftp/...) → matching provider. */
function remoteProvider(uri) {
  if (registry.sftp.isUri(uri)) return registry.sftp;
  if (registry.ftp.isUri(uri)) return registry.ftp;
  return null;
}

function basenameOf(uri) {
  const prov = remoteProvider(uri);
  if (prov) {
    const parsed = prov.parseUri(uri);
    return posixPath.basename(parsed.path) || parsed.path;
  }
  return path.basename(uri);
}

function joinDir(dirUri, name) {
  const prov = remoteProvider(dirUri);
  if (prov) {
    const parsed = prov.parseUri(dirUri);
    const next = posixPath.join(parsed.path, name);
    return prov.makeUri(parsed.authority, next);
  }
  return path.join(dirUri, name);
}

async function listNames(dirUri) {
  try {
    const entries = await registry.dispatch(dirUri).safeList(dirUri);
    return new Set((entries || []).map((e) => e?.name).filter(Boolean));
  } catch {
    return new Set();
  }
}

function addSuffix(name, i) {
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, name.length - ext.length) : name;
  return `${stem} (${i})${ext}`;
}

function pickUniqueName(taken, baseName) {
  let candidate = baseName;
  let i = 1;
  while (taken.has(candidate)) candidate = addSuffix(baseName, i++);
  taken.add(candidate);
  return candidate;
}

/* Transfer one file + progress callback. local↔local, local↔remote, remote↔local, remote↔remote (same provider). */
async function transferFileWithProgress(srcUri, dstUri, totalBytes, onBytes) {
  const srcProvider = remoteProvider(srcUri);
  const dstProvider = remoteProvider(dstUri);

  if (!srcProvider && !dstProvider) {
    return await new Promise((resolve, reject) => {
      let copied = 0;
      const rs = fs.createReadStream(srcUri);
      const ws = fs.createWriteStream(dstUri);
      rs.on('data', (chunk) => { copied += chunk.length; try { onBytes(copied); } catch {} });
      rs.on('error', reject);
      ws.on('error', reject);
      ws.on('close', resolve);
      rs.pipe(ws);
    });
  }
  if (!srcProvider && dstProvider) {
    await dstProvider.uploadFileWithProgress(srcUri, dstUri, onBytes);
    return;
  }
  if (srcProvider && !dstProvider) {
    await srcProvider.downloadFileWithProgress(srcUri, dstUri, onBytes);
    return;
  }
  /* Copy between the same provider. sftp uses copyBetweenSftp, ftp uses copyBetweenFtp. Cross-provider is unsupported. */
  if (srcProvider === dstProvider && srcProvider === registry.sftp) {
    await registry.sftp.copyBetweenSftp(srcUri, dstUri);
  } else if (srcProvider === dstProvider && srcProvider === registry.ftp) {
    await registry.ftp.copyBetweenFtp(srcUri, dstUri);
  } else {
    throw new Error('cross-provider remote-to-remote is not supported');
  }
  try { onBytes(totalBytes); } catch {}
}

/* Run in parallel with a concurrency limit. Calls worker(item, index) in items order. */
function runWithConcurrency(items, limit, worker) {
  return new Promise((resolve) => {
    let idx = 0;
    let active = 0;
    let done = 0;
    const total = items.length;
    if (total === 0) return resolve();
    const launch = () => {
      while (active < limit && idx < total) {
        const myIdx = idx++;
        active++;
        Promise.resolve(worker(items[myIdx], myIdx)).finally(() => {
          active--;
          done++;
          if (done === total) resolve();
          else launch();
        });
      }
    };
    launch();
  });
}

/* Create the intermediate directories in relativePath, shortest first. Skips any that already exist. */
async function ensureSubdirs(items, baseDir) {
  const dirs = new Set();
  for (const it of items) {
    if (!it.relativePath) continue;
    let d = posixPath.dirname(it.relativePath);
    while (d && d !== '.' && d !== '/') {
      dirs.add(d);
      d = posixPath.dirname(d);
    }
  }
  const sorted = Array.from(dirs).sort((a, b) => a.split('/').length - b.split('/').length);
  for (const rel of sorted) {
    const dirPath = joinDir(baseDir, rel);
    try { await registry.dispatch(dirPath).createDirectory(dirPath); } catch {}
  }
}

/**
 * Run a single transfer job. Copies the items array in parallel into an (optional) wrap folder.
 * items: [{ source, size?, name?, relativePath? }]
 *   - with relativePath: preserves folder structure (folder upload)
 *   - without: flat copy + auto-rename on conflict
 * send: (payload) => void  — IPC progress emitter
 */
async function runTransferJob({ jobId, items, emptyDirs, targetDir, wrapName, conflictPolicy }, send) {
  if (!jobId || !Array.isArray(items) || !targetDir) {
    return { ok: false, message: 'Invalid argument', results: [] };
  }
  const hasItems = items.length > 0;
  const hasEmptyDirs = Array.isArray(emptyDirs) && emptyDirs.length > 0;
  if (!hasItems && !hasEmptyDirs) {
    return { ok: false, message: 'Nothing to copy', results: [] };
  }
  const job = { cancelled: false };
  jobs.set(jobId, job);

  const emit = (payload) => { try { send(payload); } catch {} };

  /* conflictPolicy: 'overwrite'=overwrite / 'merge'=merge folders and only number files with (N) (download) / otherwise=auto-rename both folders and files. */
  const overwrite = conflictPolicy === 'overwrite';
  const merge = conflictPolicy === 'merge';

  /* Wrap folder. For merge/overwrite, a same-named existing folder is merged into (no numbering); for rename, the folder also gets (N). */
  let finalTarget = targetDir;
  if (typeof wrapName === 'string' && wrapName) {
    try {
      const outerTaken = await listNames(targetDir);
      /* merge/overwrite: reuse the same-named existing folder (create if absent). rename: always a new unique name → always created.
         needCreate must be decided before pickUniqueName mutates outerTaken (it adds the chosen name). */
      let dirName;
      let needCreate;
      if (merge || overwrite) {
        dirName = wrapName;
        needCreate = !outerTaken.has(dirName);
      } else {
        dirName = pickUniqueName(outerTaken, wrapName);
        needCreate = true;
      }
      finalTarget = joinDir(targetDir, dirName);
      if (needCreate) {
        const mk = await registry.dispatch(finalTarget).createDirectory(finalTarget);
        if (mk && mk.ok === false) throw new Error(mk.message || 'mkdir failed');
      }
    } catch (err) {
      jobs.delete(jobId);
      const final = { ok: false, message: String(err?.message || err), results: [] };
      emit({ type: 'done', ...final });
      return final;
    }
  }

  /* Pre-create sub-dirs for the folder structure + mkdir empty folders too + compute each file's target path */
  await ensureSubdirs(items, finalTarget);
  if (hasEmptyDirs) {
    const sorted = emptyDirs.slice().sort((a, b) => a.split('/').length - b.split('/').length);
    for (const rel of sorted) {
      const dirPath = joinDir(finalTarget, rel);
      try { await registry.dispatch(dirPath).createDirectory(dirPath); } catch {}
    }
  }
  /* Compute file targets.
     - overwrite: overwrite same-named files in place.
     - merge: merge the folder structure, but number files with (N) when a name collides within a folder — checked sequentially via a per-folder taken cache.
     - rename (default): number only flat files with (N); relativePath keeps its structure. */
  const flatTaken = overwrite ? null : await listNames(finalTarget);
  const dirTaken = new Map();
  const prepared = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let target;
    if (merge) {
      const rel = it.relativePath;
      const sub = rel ? posixPath.dirname(rel) : '.';
      const dirUri = (rel && sub && sub !== '.') ? joinDir(finalTarget, sub) : finalTarget;
      const base = rel ? posixPath.basename(rel) : (it.name || basenameOf(it.source));
      if (!dirTaken.has(dirUri)) dirTaken.set(dirUri, await listNames(dirUri));
      const taken = dirTaken.get(dirUri);
      const finalName = pickUniqueName(taken, base);
      taken.add(finalName);
      target = joinDir(dirUri, finalName);
    } else if (it.relativePath) {
      target = joinDir(finalTarget, it.relativePath);
    } else {
      const name = it.name || basenameOf(it.source);
      const finalName = overwrite ? name : pickUniqueName(flatTaken, name);
      target = joinDir(finalTarget, finalName);
    }
    prepared.push({ ...it, fileIndex: i, target });
  }

  /* Run in parallel */
  const results = [];
  await runWithConcurrency(prepared, CONCURRENCY, async (item) => {
    if (job.cancelled) {
      results.push({ source: item.source, target: item.target, status: 'cancelled' });
      emit({ type: 'file', fileIndex: item.fileIndex, status: 'cancelled', bytesDone: 0 });
      return;
    }
    emit({ type: 'file', fileIndex: item.fileIndex, status: 'progress', bytesDone: 0 });
    try {
      await transferFileWithProgress(item.source, item.target, item.size || 0, (bytes) => {
        emit({ type: 'file', fileIndex: item.fileIndex, status: 'progress', bytesDone: bytes });
      });
      results.push({ source: item.source, target: item.target, status: 'ok' });
      emit({ type: 'file', fileIndex: item.fileIndex, status: 'ok', bytesDone: item.size || 0 });
    } catch (err) {
      results.push({ source: item.source, target: item.target, status: 'error', message: String(err?.message || err) });
      emit({ type: 'file', fileIndex: item.fileIndex, status: 'error', message: String(err?.message || err) });
    }
  });

  jobs.delete(jobId);
  const final = {
    ok: results.every((r) => r.status === 'ok'),
    cancelled: job.cancelled,
    results
  };
  emit({ type: 'done', ...final });
  return final;
}

function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return { ok: false };
  job.cancelled = true;
  return { ok: true };
}

/* Recurse a local folder → flat file list + empty folders + total bytes. Empty folders don't become items, so they're collected separately in emptyDirs. */
async function scanLocalDirectory(srcDir) {
  const items = [];
  const emptyDirs = [];
  let totalBytes = 0;
  async function walk(dir, relPrefix) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    if (entries.length === 0 && relPrefix) {
      emptyDirs.push(relPrefix);
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = relPrefix ? posixPath.join(relPrefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.promises.stat(full);
          items.push({ source: full, relativePath: rel, size: stat.size, name: entry.name });
          totalBytes += stat.size;
        } catch {}
      }
    }
  }
  await walk(srcDir, '');
  return { items, emptyDirs, totalBytes };
}

/* Pre-stat local file sizes. For the multi-file upload dialog preview. */
async function statLocalFiles(paths) {
  const items = [];
  let totalBytes = 0;
  for (const p of paths || []) {
    try {
      const stat = await fs.promises.stat(p);
      if (stat.isFile()) {
        items.push({ source: p, size: stat.size, name: path.basename(p) });
        totalBytes += stat.size;
      }
    } catch {}
  }
  return { items, totalBytes };
}

/* Recursively walk a remote folder → flat items. For the folder-download scan popup.
   When scanId is set, reports progress via send ({files, bytes, dir}) + supports cancelScan (result cancelled:true). */
const scans = new Map(); /* scanId → { cancelled } */
async function scanRemoteDirectory(uri, scanId, send) {
  const prov = remoteProvider(uri);
  if (!prov) return { items: [], emptyDirs: [], totalBytes: 0 };
  const ctl = { cancelled: false };
  if (scanId) scans.set(scanId, ctl);
  try {
    const onProgress = typeof send === 'function' ? (p) => { try { send(p); } catch {} } : null;
    return await prov.scanDirectory(uri, { ctl, onProgress });
  } finally {
    if (scanId) scans.delete(scanId);
  }
}

function cancelScan(scanId) {
  const ctl = scans.get(scanId);
  if (!ctl) return { ok: false };
  ctl.cancelled = true;
  return { ok: true };
}

/* Pre-stat remote file sizes. For the download dialog preview. Runs in parallel. */
async function statRemoteFiles(uris) {
  const list = uris || [];
  const stats = await Promise.all(list.map((uri) => {
    const prov = remoteProvider(uri);
    if (!prov) return Promise.resolve({ ok: false, size: 0 });
    return prov.statFile(uri).catch(() => ({ ok: false, size: 0 }));
  }));
  let totalBytes = 0;
  const items = list.map((uri, i) => {
    const size = stats[i]?.size || 0;
    totalBytes += size;
    return { source: uri, size, name: basenameOf(uri) };
  });
  return { items, totalBytes };
}

module.exports = {
  runTransferJob,
  cancelJob,
  scanLocalDirectory,
  scanRemoteDirectory,
  cancelScan,
  statLocalFiles,
  statRemoteFiles
};
