export function comparePathRoots(candidatePath, existingPath) {
  const candidate = normalizeRootPath(candidatePath);
  const existing = normalizeRootPath(existingPath);
  if (!candidate || !existing) return 'unknown';
  if (candidate === existing) return 'same';
  if (isPathAncestor(candidate, existing)) return 'ancestor';
  if (isPathAncestor(existing, candidate)) return 'descendant';
  return 'separate';
}

export function normalizeRootPath(pathValue = '') {
  let text = String(pathValue || '').trim();
  if (!text) return '';
  text = text.replace(/\\/g, '/');
  if (text.startsWith('//')) {
    text = `//${text.slice(2).replace(/^\/+/, '').replace(/\/+/g, '/')}`;
  } else {
    text = text.replace(/\/+/g, '/');
  }
  const isWindowsLike = /^[a-z]:/i.test(text) || text.startsWith('//');
  if (/^[a-z]:/i.test(text)) {
    text = `${text[0].toUpperCase()}${text.slice(1)}`;
  }
  text = text.replace(/\/+$/, '');
  if (/^[a-z]:$/i.test(text)) {
    text += '/';
  }
  return isWindowsLike ? text.toLowerCase() : text;
}

function isPathAncestor(parent, child) {
  if (!parent || !child || parent === child) return false;
  const prefix = parent.endsWith('/') ? parent : `${parent}/`;
  return child.startsWith(prefix);
}
