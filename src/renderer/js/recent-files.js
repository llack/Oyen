const MAX_ENTRIES = 10;

function entryKey(entry) {
  return String(entry.path || '').toLowerCase();
}

/**
 * Recently opened files LRU.
 * `settings.recentFiles = [{ path, name, lastOpenedAt }]`
 * The same path updates lastOpenedAt + moves to the top.
 */
export function createRecentFiles({ getSettings, saveSettings }) {
  function read() {
    const list = getSettings()?.recentFiles;
    return Array.isArray(list) ? list.slice() : [];
  }

  async function write(next) {
    const settings = getSettings() || {};
    settings.recentFiles = next.slice(0, MAX_ENTRIES);
    if (typeof saveSettings === 'function') {
      try { await saveSettings(settings); } catch (_) {}
    }
  }

  function record({ path, name }) {
    if (!path) return;
    const next = {
      path,
      name: name || path.split(/[\\/]/).pop() || path,
      lastOpenedAt: Date.now()
    };
    const key = entryKey(next);
    const existing = read().filter((e) => entryKey(e) !== key);
    existing.unshift(next);
    return write(existing);
  }

  function list() {
    return read().sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0));
  }

  async function remove({ path }) {
    const key = entryKey({ path });
    const filtered = read().filter((e) => entryKey(e) !== key);
    await write(filtered);
  }

  async function clear() {
    await write([]);
  }

  return { record, list, remove, clear };
}
