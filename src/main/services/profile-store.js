const path = require('path');
const { getStorageRoot, readJson, writeJson } = require('../storage/file-storage');

const PROFILES_FILE = 'connection-profiles.json';

function getProfilesPath() {
  return path.join(getStorageRoot(), PROFILES_FILE);
}

function loadProfiles() {
  return readJson(getProfilesPath(), []);
}

function saveProfiles(profiles) {
  writeJson(getProfilesPath(), profiles);
  return profiles;
}

module.exports = {
  loadProfiles,
  saveProfiles
};
