const MAX_ENTRIES = 10;

function isRemoteUri(path) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(path || ''));
}

function detectType(treeRootPath) {
  const m = String(treeRootPath || '').match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (!m) return 'local';
  const proto = m[1].toLowerCase();
  if (proto === 'sftp') return 'sftp';
  if (proto === 'ftp' || proto === 'ftps') return 'ftp';
  return proto;
}

function entryKey(entry) {
  return `${entry.treeRootPath || ''}${entry.expandPath || ''}`;
}

/**
 * Recent folders LRU.
 * `settings.recentFolders = [{ treeRootPath, expandPath, label, type, lastOpenedAt }]`
 * The same (treeRootPath, expandPath) updates only lastOpenedAt + moves to the top.
 */
export function createRecentFolders({ getSettings, saveSettings }) {
  function read() {
    const list = getSettings()?.recentFolders;
    return Array.isArray(list) ? list.slice() : [];
  }

  async function write(next) {
    const settings = getSettings() || {};
    settings.recentFolders = next.slice(0, MAX_ENTRIES);
    if (typeof saveSettings === 'function') {
      try { await saveSettings(settings); } catch (_) {}
    }
  }

  function record({ treeRootPath, expandPath, label }) {
    if (!treeRootPath) return;
    const now = Date.now();
    const next = {
      treeRootPath,
      expandPath: expandPath || treeRootPath,
      label: label || treeRootPath,
      type: isRemoteUri(treeRootPath) ? detectType(treeRootPath) : 'local',
      lastOpenedAt: now
    };
    const key = entryKey(next);
    const existing = read().filter((e) => entryKey(e) !== key);
    existing.unshift(next);
    return write(existing);
  }

  function list() {
    return read().sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
  }

  async function remove({ treeRootPath, expandPath }) {
    const key = entryKey({ treeRootPath, expandPath });
    const filtered = read().filter((e) => entryKey(e) !== key);
    await write(filtered);
  }

  async function clear() {
    await write([]);
  }

  return { record, list, remove, clear };
}
