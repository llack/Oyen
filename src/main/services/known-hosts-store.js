const fs = require('fs');
const path = require('path');
const { getStorageRoot } = require('../storage/file-storage');

const FILE = 'known-hosts.json';

function getPath() {
  return path.join(getStorageRoot(), FILE);
}

function loadAll() {
  if (!fs.existsSync(getPath())) return {};
  try {
    return JSON.parse(fs.readFileSync(getPath(), 'utf8'));
  } catch {
    return {};
  }
}

function saveAll(map) {
  fs.writeFileSync(getPath(), JSON.stringify(map, null, 2), 'utf8');
}

/* authority (e.g. "sftp://user@host:22") → { algorithm, sha256, addedAt } */
function getHostKey(authority) {
  return loadAll()[authority] || null;
}

function setHostKey(authority, entry) {
  const all = loadAll();
  all[authority] = { ...entry, addedAt: Date.now() };
  saveAll(all);
}

function removeHostKey(authority) {
  const all = loadAll();
  if (!all[authority]) return;
  delete all[authority];
  saveAll(all);
}

module.exports = { getHostKey, setHostKey, removeHostKey };
