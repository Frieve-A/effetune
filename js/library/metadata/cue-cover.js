const CUE_COVER_MIME_TYPES = Object.freeze({
  jpg: 'image/jpeg',
  png: 'image/png'
});

export function cueCoverCandidateFileNames(audioRelativePath) {
  const audioFileName = baseName(audioRelativePath);
  const extensionIndex = audioFileName.lastIndexOf('.');
  const stem = extensionIndex > 0 ? audioFileName.slice(0, extensionIndex) : audioFileName;
  const candidates = [
    'cover.jpg', 'cover.png', 'front.jpg', 'front.png',
    `${stem}.jpg`, `${stem}.png`,
    `${audioFileName}.jpg`, `${audioFileName}.png`
  ];
  const seen = new Set();
  return candidates.filter(candidate => {
    const key = foldFileName(candidate);
    if (!candidate || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function selectCueCoverFileName(fileNames, audioRelativePath) {
  const names = [...fileNames].filter(name => typeof name === 'string' && name && !name.includes('/'));
  for (const candidate of cueCoverCandidateFileNames(audioRelativePath)) {
    const exact = names.find(name => name === candidate);
    if (exact) return exact;
    const folded = names.filter(name => foldFileName(name) === foldFileName(candidate));
    if (folded.length === 1) return folded[0];
  }
  return null;
}

export function cueCoverMimeType(fileName) {
  const extension = String(fileName ?? '').split('.').at(-1)?.toLowerCase() ?? '';
  return CUE_COVER_MIME_TYPES[extension] ?? null;
}

export function isCueCoverRelativePath(cueRelativePath, audioRelativePath, coverRelativePath) {
  const cuePath = normalizeRelativePath(cueRelativePath);
  const audioPath = normalizeRelativePath(audioRelativePath);
  const coverPath = normalizeRelativePath(coverRelativePath);
  if (!cuePath || !audioPath || !coverPath) return false;
  if (directoryName(cuePath) !== directoryName(coverPath)) return false;
  const coverName = baseName(coverPath);
  return cueCoverCandidateFileNames(audioPath)
    .some(candidate => foldFileName(candidate) === foldFileName(coverName));
}

function baseName(value) {
  return String(value ?? '').replaceAll('\\', '/').split('/').at(-1) ?? '';
}

function directoryName(value) {
  const path = String(value ?? '').replaceAll('\\', '/');
  const index = path.lastIndexOf('/');
  return index < 0 ? '' : path.slice(0, index);
}

function normalizeRelativePath(value) {
  const normalized = String(value ?? '').replaceAll('\\', '/').normalize('NFC');
  const parts = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0') ||
      parts.some(part => !part || part === '.' || part === '..')) return '';
  return parts.join('/');
}

function foldFileName(value) {
  return String(value ?? '').normalize('NFC').toLowerCase();
}
