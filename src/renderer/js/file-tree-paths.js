export function normalizePath(value) {
  return value.replace(/\//g, '\\').toLowerCase();
}

export function joinPath(basePath, nextName) {
  if (basePath.endsWith('\\') || basePath.endsWith('/')) {
    return `${basePath}${nextName}`;
  }
  const separator = basePath.includes('/') && !basePath.includes('\\') ? '/' : '\\';
  return `${basePath}${separator}${nextName}`;
}

export function dirname(filePath) {
  const value = String(filePath || '');
  const uriMatch = /^([a-z][a-z0-9+\-.]*:\/\/[^/]*)(\/.*)?$/i.exec(value);
  if (uriMatch) {
    const authority = uriMatch[1];
    const pathPart = uriMatch[2] || '/';
    const idx = pathPart.lastIndexOf('/');
    const parent = idx <= 0 ? '/' : pathPart.slice(0, idx);
    return `${authority}${parent}`;
  }
  const separator = value.includes('/') && !value.includes('\\') ? '/' : '\\';
  const parts = value.split(/[\\/]+/);
  parts.pop();
  if (parts.length === 1 && /^[a-z]:$/i.test(parts[0])) return `${parts[0]}\\`;
  if (value.startsWith('/') && parts[0] !== '') return `/${parts.join('/')}`;
  return parts.join(separator);
}

export function expandTo(rootPath, targetPath, expanded) {
  if (!targetPath) return;

  const rootNormalized = normalizePath(rootPath);
  const targetNormalized = normalizePath(targetPath);
  if (!targetNormalized.startsWith(rootNormalized)) return;

  const relative = targetPath.slice(rootPath.length).replace(/^[\\/]+/, '');
  if (!relative) return;

  const parts = relative.split(/[\\/]+/).filter(Boolean);
  let cursor = rootPath;
  for (const part of parts) {
    cursor = joinPath(cursor, part);
    expanded.add(normalizePath(cursor));
  }
}

export function activeChainPaths(rootPath, target) {
  const list = [rootPath];
  if (!target) return list;
  const rN = normalizePath(rootPath);
  const tN = normalizePath(target);
  if (tN === rN || !tN.startsWith(rN)) return list;
  const relative = target.slice(rootPath.length).replace(/^[\\/]+/, '');
  const parts = relative.split(/[\\/]+/).filter(Boolean);
  let cursor = rootPath;
  for (const part of parts) {
    cursor = joinPath(cursor, part);
    list.push(cursor);
  }
  return list;
}

export function getNextPathOnActiveChain(parentPath, targetPath) {
  if (!targetPath) return null;
  const parentNormalized = normalizePath(parentPath);
  const targetNormalized = normalizePath(targetPath);
  if (!targetNormalized.startsWith(parentNormalized)) return null;
  if (parentNormalized === targetNormalized) return null;

  const parentParts = parentPath.split(/[\\/]+/).filter(Boolean);
  const targetParts = targetPath.split(/[\\/]+/).filter(Boolean);
  if (targetParts.length <= parentParts.length) return null;

  const nextName = targetParts[parentParts.length];
  return joinPath(parentPath, nextName);
}
