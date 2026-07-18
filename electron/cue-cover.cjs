'use strict';

const path = require('node:path');

const CUE_COVER_MIME_TYPES = Object.freeze({
  '.jpg': 'image/jpeg',
  '.png': 'image/png'
});

function cueCoverCandidateFileNames(audioRelativePath) {
  const audioFileName = path.posix.basename(String(audioRelativePath ?? '').replaceAll('\\', '/'));
  const extension = path.posix.extname(audioFileName);
  const stem = extension ? audioFileName.slice(0, -extension.length) : audioFileName;
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

function selectCueCoverFileName(entries, audioRelativePath) {
  const fileNames = [...entries].flatMap(entry => {
    if (typeof entry === 'string') return [entry];
    if (!entry?.name || (!entry.isFile?.() && !entry.isSymbolicLink?.())) return [];
    return [entry.name];
  });
  for (const candidate of cueCoverCandidateFileNames(audioRelativePath)) {
    const exact = fileNames.find(fileName => fileName === candidate);
    if (exact) return exact;
    const folded = fileNames.filter(fileName => foldFileName(fileName) === foldFileName(candidate));
    if (folded.length === 1) return folded[0];
  }
  return null;
}

function isCueCoverRelativePath(cueRelativePath, audioRelativePath, coverRelativePath) {
  const cuePath = normalizeRelativePath(cueRelativePath);
  const audioPath = normalizeRelativePath(audioRelativePath);
  const coverPath = normalizeRelativePath(coverRelativePath);
  if (!cuePath || !audioPath || !coverPath) return false;
  if (path.posix.dirname(cuePath) !== path.posix.dirname(coverPath)) return false;
  const coverName = path.posix.basename(coverPath);
  return cueCoverCandidateFileNames(audioPath)
    .some(candidate => foldFileName(candidate) === foldFileName(coverName));
}

function cueCoverMimeType(fileName) {
  return CUE_COVER_MIME_TYPES[path.posix.extname(String(fileName ?? '')).toLowerCase()] ?? null;
}

function normalizeRelativePath(value) {
  const normalized = String(value ?? '').replaceAll('\\', '/').normalize('NFC');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) return '';
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return '';
  return parts.join('/');
}

function foldFileName(value) {
  return String(value ?? '').normalize('NFC').toLowerCase();
}

module.exports = {
  cueCoverCandidateFileNames,
  cueCoverMimeType,
  isCueCoverRelativePath,
  selectCueCoverFileName
};
