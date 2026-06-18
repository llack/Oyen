const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadSettings, saveSettings } = require('./settings-store');
const secretStore = require('./remote-secret-store');

const FORMAT = 'oyen-settings';
const VERSION = 1;

/* Portable encryption of server passwords — safeStorage (machine-local) can't be decrypted on another PC, so the export file uses AES-256-GCM with an app key.
   The app-embedded key means weak security (obfuscation-level) — beware leaking the file. On import, re-encrypt with that PC's safeStorage. */
const SECRET_KEY = crypto.createHash('sha256').update('oyen-settings-export/v1').digest();

function encryptSecrets(obj) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SECRET_KEY, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  };
}

function decryptSecrets(blob) {
  if (!blob || typeof blob !== 'object') return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', SECRET_KEY, Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(blob.data, 'base64')), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(out);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/* ── Extensibility model ────────────────────────────────────────────────────
   Sections aren't hardcoded by key; they are built dynamically from the "current settings keys".
   - EXCLUDED_KEYS: machine/session-local state that's meaningless to move to another PC → excluded from export.
   - KEY_SECTION: the section for known keys. Top-level keys not listed here (newly added) automatically go to the 'other' section →
     so new settings export/import as-is without touching the export code.
   - Sub-keys (editor.newOption, etc.) are handled at the whole top-level object level, so they're included automatically.
   ──────────────────────────────────────────────────────────────────────── */
const EXCLUDED_KEYS = new Set([
  'layout', 'ui', 'recentFolders', 'recentFiles', // machine/session-local state
  'theme', 'keymap',                               // getDefaultSettings legacy dead keys (never read anywhere)
  'terminal',                                      // shell override not yet wired to the UI (renderer doesn't send it) — when actually wired, drop the exclusion and map a section
  'projects'                                       // handled separately (servers/projects sections) — excluded from the generic flow
]);

/* Generic key → section. New top-level keys other than these / projects automatically go to 'other'. */
const KEY_SECTION = {
  editor: 'general',
  appearance: 'general',
  syntaxColors: 'colors',
  shortcuts: 'shortcuts',
  shortcutsSwapCtrlCmd: 'shortcuts'
};

/* projects classification — per renderer convention. Local ({name,path}) has a path that differs per PC, so it goes into neither (excluded from export). */
function isRemoteProfile(p) {
  return !!p && (p.type === 'sftp' || p.type === 'ftp') && !!p.host;
}
function isConnectionProfile(p) {   // registered server list (sites) = isRemoteProject && !derivedRemote
  return isRemoteProfile(p) && !p.derivedRemote;
}
function isRemoteFolderProject(p) { // remote folder projects in the project panel
  return isRemoteProfile(p) && !!p.derivedRemote;
}

/* Sections that split the projects array in two — the same array partitioned by filter (servers=connection profiles / projects=remote folders). */
const PROJECT_SECTIONS = {
  servers: isConnectionProfile,
  projects: isRemoteFolderProject
};

/* Display/sort order. 'other' is always last. (renderer label key: settings.io.section.<id>) */
const SECTION_ORDER = ['general', 'colors', 'shortcuts', 'servers', 'projects', 'other'];

function sectionOf(key) {
  return KEY_SECTION[key] || 'other';
}

/* Known keys are strictly type-checked (import safety net). Unknown keys pass if they're a JSON value (the app's own future settings). */
function isKnownTypeValid(key, value) {
  switch (key) {
    case 'editor':
    case 'appearance':
    case 'syntaxColors':
    case 'shortcuts':
      return !!value && typeof value === 'object' && !Array.isArray(value);
    case 'shortcutsSwapCtrlCmd':
      return typeof value === 'boolean';
    default:
      return value !== undefined;
  }
}

/* Has actual content — empty object/empty array/absent are excluded (prevents overwriting existing settings with an empty import value). */
function hasContent(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true; // boolean/number/string (false/0/'' are treated as actual values too)
}

function acceptKey(key, value) {
  return !EXCLUDED_KEYS.has(key) && isKnownTypeValid(key, value) && hasContent(value);
}

/* Acceptable keys for a generic (non-projects) section. */
function genericKeysForSection(settings, section) {
  return Object.keys(settings || {}).filter((k) => sectionOf(k) === section && acceptKey(k, settings[k]));
}

/* Array of items belonging to a projects section (servers/projects). */
function projectsForSection(settings, section) {
  const filter = PROJECT_SECTIONS[section];
  if (!filter || !Array.isArray(settings && settings.projects)) return [];
  return settings.projects.filter(filter);
}

function sectionHasContent(settings, section) {
  if (PROJECT_SECTIONS[section]) return projectsForSection(settings, section).length > 0;
  return genericKeysForSection(settings, section).length > 0;
}

/* List of sections that have content (in sort order). For the export/import dialog checkboxes. */
function availableSections(settings) {
  return SECTION_ORDER.filter((sec) => sectionHasContent(settings, sec));
}

/* Merge by id — preserve existing entries (including local), update entries with the same id. */
function mergeProjectsById(base, incoming) {
  const out = Array.isArray(base) ? base.slice() : [];
  for (const p of incoming) {
    if (!p || !p.id) { out.push(p); continue; }
    const idx = out.findIndex((x) => x && x.id === p.id);
    if (idx >= 0) out[idx] = p;
    else out.push(p);
  }
  return out;
}

/* Normalize the sections argument — if absent or empty, use all; keep only valid sections, in sort order. */
function sanitizeSections(sections) {
  if (!Array.isArray(sections) || !sections.length) return [...SECTION_ORDER];
  const set = new Set(sections);
  return SECTION_ORDER.filter((s) => set.has(s));
}

/* File read + JSON parse + OYEN format validation. Returns an error code on failure. */
function parseFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { ok: false, error: 'read', message: e.message };
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'parse' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, error: 'format' };
  }
  if (payload.format !== FORMAT || !payload.settings || typeof payload.settings !== 'object') {
    return { ok: false, error: 'format' };
  }
  if (typeof payload.version !== 'number' || payload.version > VERSION) {
    return { ok: false, error: 'version' };
  }
  return { ok: true, payload };
}

/* Sections with content from the current settings — for the export dialog. */
function exportSections() {
  return availableSections(loadSettings());
}

/* Sections actually present in the file — for the import dialog. */
function inspectImport(filePath) {
  const r = parseFile(filePath);
  if (!r.ok) return r;
  return {
    ok: true,
    version: r.payload.version,
    exportedAt: r.payload.exportedAt,
    available: availableSections(r.payload.settings)
  };
}

/* Pick the selected sections from the current settings and save to a file. The projects sections (servers/projects) split the same array by filter. */
function exportConfig(filePath, sections) {
  const current = loadSettings();
  const sel = sanitizeSections(sections);
  const out = {};
  const written = [];
  const exportedProjects = [];
  for (const sec of sel) {
    if (PROJECT_SECTIONS[sec]) {
      const subset = projectsForSection(current, sec);
      if (!subset.length) continue;
      exportedProjects.push(...subset);
      written.push(sec);
    } else {
      const keys = genericKeysForSection(current, sec);
      if (!keys.length) continue;
      for (const k of keys) out[k] = current[k];
      written.push(sec);
    }
  }
  if (exportedProjects.length) out.projects = exportedProjects;
  const payload = {
    format: FORMAT,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    sections: written,
    settings: out
  };
  /* Gather the passwords of the exported items (both servers and remote projects), encrypt with the app key, and attach. */
  if (exportedProjects.length) {
    const secrets = {};
    for (const p of exportedProjects) {
      if (!p || !p.id) continue;
      const fields = secretStore.getSecret(p.id);
      if (fields && Object.keys(fields).length) secrets[p.id] = fields;
    }
    if (Object.keys(secrets).length) payload.secrets = encryptSecrets(secrets);
  }
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { ok: true, filePath: path.resolve(filePath) };
}

/* Merge the selected sections into the current settings and save. The projects sections merge by id (preserving existing local/items). Returns the list of applied sections. */
function importConfig(filePath, sections) {
  const r = parseFile(filePath);
  if (!r.ok) return r;
  const incoming = r.payload.settings;
  const sel = sanitizeSections(sections);
  const current = loadSettings();
  const next = { ...current };
  const applied = [];
  let projects = Array.isArray(current.projects) ? current.projects.slice() : [];
  let projectsTouched = false;
  const importedIds = new Set();
  for (const sec of sel) {
    if (PROJECT_SECTIONS[sec]) {
      const subset = projectsForSection(incoming, sec);
      if (!subset.length) continue;
      projects = mergeProjectsById(projects, subset);
      subset.forEach((p) => p && p.id && importedIds.add(p.id));
      projectsTouched = true;
      applied.push(sec);
    } else {
      const keys = genericKeysForSection(incoming, sec);
      if (!keys.length) continue;
      for (const k of keys) next[k] = incoming[k];
      applied.push(sec);
    }
  }
  if (projectsTouched) next.projects = projects;
  saveSettings(next);
  /* Decrypt only the passwords of the imported item ids → re-encrypt with this PC's safeStorage. */
  if (importedIds.size && r.payload.secrets && secretStore.isAvailable()) {
    const secrets = decryptSecrets(r.payload.secrets);
    if (secrets) {
      for (const [pid, fields] of Object.entries(secrets)) {
        if (importedIds.has(pid) && fields && typeof fields === 'object') secretStore.setSecret(pid, fields);
      }
    }
  }
  return { ok: true, applied };
}

module.exports = {
  exportSections,
  exportConfig,
  importConfig,
  inspectImport
};
