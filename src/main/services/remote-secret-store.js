const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { getStorageRoot } = require('../storage/file-storage');

const FILE = 'remote-secrets.json';

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

function isAvailable() {
  try { return safeStorage.isEncryptionAvailable(); } catch { return false; }
}

function setSecret(profileId, fields) {
  const all = loadAll();
  const enc = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if (v == null || v === '') continue;
    enc[k] = safeStorage.encryptString(String(v)).toString('base64');
  }
  if (!Object.keys(enc).length) {
    delete all[profileId];
  } else {
    all[profileId] = enc;
  }
  saveAll(all);
}

function getSecret(profileId) {
  const all = loadAll();
  const enc = all[profileId];
  if (!enc) return {};
  const out = {};
  for (const [k, v] of Object.entries(enc)) {
    try {
      out[k] = safeStorage.decryptString(Buffer.from(v, 'base64'));
    } catch {}
  }
  return out;
}

function removeSecret(profileId) {
  const all = loadAll();
  if (!all[profileId]) return;
  delete all[profileId];
  saveAll(all);
}

module.exports = { isAvailable, setSecret, getSecret, removeSecret };
