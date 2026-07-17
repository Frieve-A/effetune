export const MUSIC_LIBRARY_UI_STORAGE_KEY = 'effetune_library_ui';
export const MUSIC_LIBRARY_STARTUP_VIEWS = Object.freeze([
  'tracks',
  'albums',
  'artists',
  'genres',
  'subfolders'
]);

export const SUPPORTED_AUDIO_EXTENSIONS = Object.freeze([
  'mp3',
  'wav',
  'ogg',
  'flac',
  'opus',
  'm4a',
  'aac',
  'webm',
  'mp4'
]);

export const SUPPORTED_PLAYLIST_EXTENSIONS = Object.freeze([
  'm3u',
  'm3u8',
  'pls',
  'xspf'
]);
export const SUPPORTED_CUE_EXTENSIONS = Object.freeze(['cue']);

export const SUPPORTED_AUDIO_EXTENSION_SET = new Set(SUPPORTED_AUDIO_EXTENSIONS);
export const SUPPORTED_PLAYLIST_EXTENSION_SET = new Set(SUPPORTED_PLAYLIST_EXTENSIONS);
export const SUPPORTED_CUE_EXTENSION_SET = new Set(SUPPORTED_CUE_EXTENSIONS);
export const DEFAULT_SCAN_BATCH_SIZE = 200;
export const UNKNOWN_ALBUM = 'Unknown Album';
export const UNKNOWN_ARTIST = 'Unknown Artist';
export const VARIOUS_ARTISTS = 'Various Artists';

export function normalizeMusicLibraryStartupView(value) {
  return MUSIC_LIBRARY_STARTUP_VIEWS.includes(value) ? value : 'tracks';
}

export function getFileExtension(pathOrName = '') {
  const clean = String(pathOrName).split(/[?#]/)[0];
  const slash = clean.split(/[\\/]/).pop() || clean;
  const dot = slash.lastIndexOf('.');
  return dot >= 0 ? slash.slice(dot + 1).toLowerCase() : '';
}

export function getFileName(pathOrName = '') {
  const value = String(pathOrName || '');
  return value.split(/[\\/]/).pop() || value;
}

export function stripExtension(fileName = '') {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export function isSupportedAudioPath(pathOrName = '') {
  return SUPPORTED_AUDIO_EXTENSION_SET.has(getFileExtension(pathOrName));
}

export function isSupportedPlaylistPath(pathOrName = '') {
  return SUPPORTED_PLAYLIST_EXTENSION_SET.has(getFileExtension(pathOrName));
}

export function isSupportedCuePath(pathOrName = '') {
  return SUPPORTED_CUE_EXTENSION_SET.has(getFileExtension(pathOrName));
}

export function normalizeRelativePath(relativePath = '') {
  return String(relativePath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .join('/');
}

export function normalizeRelativePathForMatching(relativePath = '') {
  return normalizeRelativePath(relativePath).normalize('NFC');
}

export function joinRelativePath(...parts) {
  return normalizeRelativePath(parts.filter(Boolean).join('/'));
}

export function createFallbackDisplayName(pathOrName = '') {
  return stripExtension(getFileName(pathOrName)) || 'Untitled';
}
