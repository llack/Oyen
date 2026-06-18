import { t } from './i18n.js';

const RULES = [
  { match: /ENOENT|no such file|not found/i, key: 'fserr.notFound' },
  { match: /EACCES|permission denied|access denied/i, key: 'fserr.permission' },
  { match: /ENOTDIR/i, key: 'fserr.notDir' },
  { match: /EISDIR/i, key: 'fserr.notFile' },
  { match: /EEXIST/i, key: 'fserr.exists' },
  { match: /Connection (lost|reset|closed)|ECONNRESET|ECONNREFUSED/i, key: 'fserr.disconnected' },
  { match: /ETIMEDOUT|timed? ?out/i, key: 'fserr.timeout' },
  { match: /ENETUNREACH|EHOSTUNREACH/i, key: 'fserr.unreachable' },
  { match: /authentication|auth.*fail/i, key: 'fserr.authFailed' }
];

export function friendlyFsError(err, subject) {
  const raw = typeof err === 'string' ? err : (err?.message || String(err || ''));
  const kind = subject || t('fserr.item');
  for (const rule of RULES) {
    if (rule.match.test(raw)) return t(rule.key, { kind });
  }
  return t('fserr.generic', { kind, raw });
}
