/* Helpers that convert a remote (SFTP/FTP) profile → URI/authority.
   Pure functions (only getRemoteExpandPath calls resolveHome). Extracted from app.js. */

export function folderBasename(p) {
  return String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;
}

export function remoteAuthority(p) {
  const userPart = p.username ? encodeURIComponent(p.username) : '';
  if (p.type === 'ftp') {
    const proto = p.secure ? 'ftps' : 'ftp';
    /* secure:true means explicit FTPS (port 21). 990 implicit is incompatible with secure:true, so default to 21 (matching testFtp). */
    const port = p.port || 21;
    return `${proto}://${userPart}@${p.host}:${port}`;
  }
  const port = p.port || 22;
  return `sftp://${userPart}@${p.host}:${port}`;
}

export function remoteUri(p) {
  if (p.type !== 'sftp' && p.type !== 'ftp') return '';
  const authority = remoteAuthority(p);
  const dp = (p.defaultPath || '').trim();
  if (!dp) return authority;
  const safe = dp.startsWith('/') ? dp : `/${dp}`;
  return `${authority}${safe}`;
}

export function getRemoteTreeRoot(p) {
  return `${remoteAuthority(p)}/`;
}

export async function getRemoteExpandPath(p) {
  const authority = remoteAuthority(p);
  const dp = (p.defaultPath || '').trim();
  if (dp) {
    const safe = dp.startsWith('/') ? dp : `/${dp}`;
    return `${authority}${safe}`;
  }
  try {
    const result = await window.oyen.remote.resolveHome(authority);
    if (result?.ok && result.path) {
      const home = result.path.startsWith('/') ? result.path : `/${result.path}`;
      return `${authority}${home}`;
    }
  } catch (_) {}
  return `${authority}/`;
}

export function uriPathBasename(uri) {
  try {
    const u = new URL(uri);
    const p = u.pathname || '/';
    if (p === '/' || p === '') return '/';
    const trimmed = p.replace(/\/+$/, '');
    const idx = trimmed.lastIndexOf('/');
    return idx >= 0 ? (trimmed.slice(idx + 1) || '/') : trimmed;
  } catch {
    return uri;
  }
}
