const path = require('path');
const { getStorageRoot, readJson, writeJson } = require('../storage/file-storage');

const SETTINGS_FILE = 'settings.json';

function getSettingsPath() {
  return path.join(getStorageRoot(), SETTINGS_FILE);
}

function getDefaultSettings() {
  return {
    projects: [],
    appearance: {
      language: 'en'
    },
    ui: {
      leftPaneWidth: 275,
      leftTreeRatio: 0.5
    },
    editor: {
      fontSize: 14,
      tabSize: 4,
      indentType: 'auto',
      insertSpaces: true,
      wordWrap: 'on',
      minimap: { enabled: true },
      lineNumbers: 'on'
    }
  };
}

/* Remove legacy dead keys — read nowhere. Self-heals existing saved values on load so they disappear from export/settings. */
function sanitizeSettings(s) {
  if (!s || typeof s !== 'object') return false;
  let changed = false;
  for (const k of ['theme', 'keymap', 'shortcutsSwapCtrlCmd']) {
    if (k in s) { delete s[k]; changed = true; }
  }
  if (s.appearance && typeof s.appearance === 'object' && 'theme' in s.appearance) {
    delete s.appearance.theme;
    changed = true;
  }
  if (s.editor && typeof s.editor === 'object') {
    for (const k of ['lineHeight', 'popupDark']) {
      if (k in s.editor) { delete s.editor[k]; changed = true; }
    }
  }
  return changed;
}

function loadSettings() {
  const s = readJson(getSettingsPath(), getDefaultSettings());
  if (sanitizeSettings(s)) {
    try { writeJson(getSettingsPath(), s); } catch {}
  }
  return s;
}

function saveSettings(nextSettings) {
  writeJson(getSettingsPath(), nextSettings);
  return nextSettings;
}

module.exports = {
  loadSettings,
  saveSettings,
  getDefaultSettings
};
