import strings from '../i18n/strings.json';

export const SUPPORTED_LANGUAGES = ['ko', 'en'];
const FALLBACK_LANG = 'en';
let currentLang = FALLBACK_LANG;

export function initI18n(lang) {
  currentLang = SUPPORTED_LANGUAGES.includes(lang) ? lang : FALLBACK_LANG;
  applyI18nAttributes(document);
}

export function getLanguage() {
  return currentLang;
}

export function t(key, params) {
  if (!key) return '';
  const entry = strings[key];
  let val = entry?.[currentLang];
  if (typeof val !== 'string') val = entry?.[FALLBACK_LANG];
  if (typeof val !== 'string') return key;
  if (params) {
    return val.replace(/\{(\w+)\}/g, (_, name) => (params[name] != null ? String(params[name]) : `{${name}}`));
  }
  return val;
}

export function applyI18nAttributes(root) {
  const r = root || document;
  r.querySelectorAll('[data-i18n]').forEach((el) => {
    const k = el.getAttribute('data-i18n');
    if (k) el.textContent = t(k);
  });
  r.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const k = el.getAttribute('data-i18n-title');
    if (k) el.title = t(k);
  });
  r.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    const k = el.getAttribute('data-i18n-aria');
    if (k) el.setAttribute('aria-label', t(k));
  });
}
