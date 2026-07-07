import { normalizePlaylistPath } from './playlist-formats.js';

const DEFAULT_PLATFORM = detectRuntimePlatform();

function detectRuntimePlatform() {
  const electronPlatform = globalThis.window?.electronAPI?.platform;
  if (electronPlatform) return electronPlatform;
  if (typeof process !== 'undefined' && process.platform) return process.platform;
  const platform = globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '';
  if (/win/i.test(platform)) return 'win32';
  if (/mac/i.test(platform)) return 'darwin';
  return platform ? 'linux' : '';
}

function isWindowsPlatform(platform) {
  return platform === 'win32' || platform === 'windows';
}

function comparisonOptions(options = {}) {
  const platform = options.platform ?? DEFAULT_PLATFORM;
  return {
    platform,
    caseInsensitive: options.caseInsensitive ?? isWindowsPlatform(platform)
  };
}

function normalizeForComparison(value, options = {}) {
  const { caseInsensitive } = comparisonOptions(options);
  const normalized = normalizePathSyntax(value).normalize('NFC');
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function normalizePathSyntax(value) {
  let text = normalizePlaylistPath(value).replace(/\\/g, '/').trim();
  if (!text) return '';

  let prefix = '';
  if (/^[A-Za-z]:($|\/)/.test(text)) {
    prefix = text.slice(0, 2);
    text = text.slice(2);
  } else if (text.startsWith('//')) {
    prefix = '//';
    text = text.slice(2);
  } else if (text.startsWith('/')) {
    prefix = '/';
    text = text.slice(1);
  }

  const segments = [];
  for (const segment of text.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop();
      } else if (!prefix) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }

  if (prefix === '/') return `/${segments.join('/')}`;
  if (prefix === '//') return `//${segments.join('/')}`;
  if (prefix) return segments.length > 0 ? `${prefix}/${segments.join('/')}` : prefix;
  return segments.join('/');
}

function isAbsolutePath(value) {
  const text = normalizePlaylistPath(value).replace(/\\/g, '/').trim();
  return /^[A-Za-z]:($|\/)/.test(text) || text.startsWith('/') || text.startsWith('//');
}

function dirname(value) {
  const normalized = normalizePathSyntax(value);
  const slashIndex = normalized.lastIndexOf('/');
  if (slashIndex < 0) return '';
  if (slashIndex === 0) return '/';
  if (/^[A-Za-z]:$/.test(normalized.slice(0, slashIndex))) return normalized.slice(0, slashIndex + 1);
  return normalized.slice(0, slashIndex);
}

function resolveAgainstPlaylist(entryPath, playlistPath) {
  if (!entryPath || !playlistPath || isAbsolutePath(entryPath)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(entryPath)) return null;

  const basePath = dirname(playlistPath);
  if (!basePath) return null;
  return normalizePathSyntax(`${basePath}/${entryPath}`);
}

function getTrackId(track) {
  return track?.id ?? track?.trackId ?? null;
}

function getTrackRelativePath(track) {
  return track?.relativePath ?? track?.pathRelative ?? track?.relativePathHint ?? '';
}

function getFolderId(folder) {
  return folder?.id ?? folder?.folderId ?? null;
}

function buildFolderMap(folders) {
  const folderMap = new Map();
  for (const folder of folders ?? []) {
    const folderId = getFolderId(folder);
    if (folderId) folderMap.set(folderId, folder);
  }
  return folderMap;
}

function joinPath(root, relativePath) {
  if (!root || !relativePath) return '';
  return normalizePathSyntax(`${root.replace(/[\\/]+$/, '')}/${relativePath}`);
}

function getTrackAbsolutePaths(track, folderMap) {
  const paths = [];
  if (track?.absolutePath) paths.push(track.absolutePath);
  if (track?.path && isAbsolutePath(track.path)) paths.push(track.path);

  const folder = folderMap.get(track?.folderId);
  const folderPath = folder?.path ?? track?.folderPath ?? '';
  const relativePath = getTrackRelativePath(track);
  if (folderPath && relativePath) paths.push(joinPath(folderPath, relativePath));

  return [...new Set(paths.filter(Boolean))];
}

function buildAbsolutePathIndex(tracks, folderMap, options) {
  const index = new Map();
  for (const track of tracks) {
    for (const absolutePath of getTrackAbsolutePaths(track, folderMap)) {
      const key = normalizeForComparison(absolutePath, options);
      const matches = index.get(key) ?? [];
      matches.push(track);
      index.set(key, matches);
    }
  }
  return index;
}

function buildSuffixContext(tracks, options) {
  let maxSuffixLength = 0;
  const suffixIndex = new Map();
  const suffixSegments = tracks.map(track => {
    const segments = pathSegmentsForSuffix(getTrackRelativePath(track), options);
    if (segments.length > maxSuffixLength) maxSuffixLength = segments.length;
    for (let length = 1; length <= segments.length; length += 1) {
      const key = suffixKey(segments, length);
      const matches = suffixIndex.get(key) ?? [];
      matches.push(track);
      suffixIndex.set(key, matches);
    }
    return { track, segments };
  });
  return {
    suffixSegments,
    suffixIndex,
    maxSuffixLength
  };
}

function buildNormalizedMetadataCache(tracks) {
  return tracks.map(track => ({
    track,
    title: normalizeMetadataText(track?.title),
    artist: normalizeMetadataText(track?.artist),
    durationSec: parseDuration(track?.durationSec)
  }));
}

function createResolutionContext(options = {}) {
  const tracks = Array.isArray(options.tracks) ? options.tracks : [];
  const folders = Array.isArray(options.folders) ? options.folders : [];
  const compareOptions = comparisonOptions(options);
  const folderMap = buildFolderMap(folders);

  return {
    tracks,
    folders,
    compareOptions,
    folderMap,
    absolutePathIndex: buildAbsolutePathIndex(tracks, folderMap, compareOptions),
    normalizedMetadataCache: buildNormalizedMetadataCache(tracks),
    ...buildSuffixContext(tracks, compareOptions)
  };
}

function uniqueTrackMatch(matches) {
  const byId = new Map();
  for (const track of matches) {
    byId.set(getTrackId(track) ?? byId.size, track);
  }
  return byId.size === 1 ? [...byId.values()][0] : null;
}

function findAbsoluteMatch(entryPath, context) {
  const target = normalizeForComparison(entryPath, context.compareOptions);
  const matches = context.absolutePathIndex.get(target) ?? [];
  return uniqueTrackMatch(matches);
}

function pathSegmentsForSuffix(value, options = {}) {
  const { caseInsensitive } = comparisonOptions(options);
  const normalized = normalizePathSyntax(value).normalize('NFC');
  return normalized
    .split('/')
    .filter(segment => segment && segment !== '..' && !/^[A-Za-z]:$/.test(segment))
    .map(segment => (caseInsensitive ? segment.toLowerCase() : segment));
}

function suffixKey(segments, length) {
  return segments.slice(segments.length - length).join('\0');
}

function findSuffixMatch(entryPath, context) {
  const entrySegments = pathSegmentsForSuffix(entryPath, context.compareOptions);
  if (entrySegments.length === 0) return null;

  for (let length = Math.min(entrySegments.length, context.maxSuffixLength); length >= 1; length -= 1) {
    const target = suffixKey(entrySegments, length);
    const matches = context.suffixIndex.get(target) ?? [];
    const uniqueMatch = uniqueTrackMatch(matches);
    if (uniqueMatch) return uniqueMatch;
  }

  return null;
}

function normalizeMetadataText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .normalize('NFKC')
    .toLowerCase();
}

function parseDuration(value) {
  const duration = Number.parseFloat(value);
  return Number.isFinite(duration) ? duration : null;
}

function parsedDurationsMatch(leftDuration, rightDuration) {
  return leftDuration !== null && rightDuration !== null && Math.abs(leftDuration - rightDuration) <= 3;
}

function splitArtistTitle(value) {
  const text = String(value ?? '').trim();
  const separatorIndex = text.indexOf(' - ');
  if (separatorIndex <= 0 || separatorIndex >= text.length - 3) return { title: text };
  return {
    artist: text.slice(0, separatorIndex).trim(),
    title: text.slice(separatorIndex + 3).trim()
  };
}

function collectEntryPaths(entry) {
  const unresolved = entry?.unresolved ?? {};
  const candidates = [
    entry?.path,
    entry?.location,
    entry?.sourceLine,
    entry?.relativePathHint,
    unresolved.sourceLine,
    unresolved.relativePathHint
  ];
  const paths = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const path = normalizePlaylistPath(candidate ?? '');
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }

  return paths;
}

function normalizeEntry(entry) {
  const unresolved = entry?.unresolved ?? {};
  const title = entry?.title ?? unresolved.title ?? '';
  const artist = entry?.artist ?? entry?.creator ?? unresolved.artist ?? '';
  const album = entry?.album ?? unresolved.album ?? '';
  const labelParts = !artist && title.includes(' - ') ? splitArtistTitle(title) : null;

  return {
    original: entry,
    paths: collectEntryPaths(entry),
    title: labelParts?.title ?? title,
    artist: labelParts?.artist ?? artist,
    album,
    durationSec: entry?.durationSec ?? unresolved.durationSec
  };
}

function findMetadataMatch(entry, context) {
  const title = normalizeMetadataText(entry.title);
  const artist = normalizeMetadataText(entry.artist);
  if (!title || !artist) return null;
  const durationSec = parseDuration(entry.durationSec);

  const matches = context.normalizedMetadataCache
    .filter(item => item.title === title
      && item.artist === artist
      && parsedDurationsMatch(durationSec, item.durationSec))
    .map(item => item.track);

  return uniqueTrackMatch(matches);
}

function resolvedResult(track, strategy, entry) {
  return {
    status: 'resolved',
    strategy,
    track,
    trackId: getTrackId(track),
    entry: entry.original
  };
}

function unresolvedResult(reason, entry) {
  return {
    status: 'unresolved',
    strategy: null,
    track: null,
    trackId: null,
    reason,
    entry: entry.original
  };
}

function resolvePlaylistEntryWithContext(entry, options, context) {
  const normalizedEntry = normalizeEntry(entry);

  for (const entryPath of normalizedEntry.paths) {
    if (!isAbsolutePath(entryPath)) continue;
    const match = findAbsoluteMatch(entryPath, context);
    if (match) return resolvedResult(match, 'absolute', normalizedEntry);
  }

  for (const entryPath of normalizedEntry.paths) {
    const playlistRelativePath = resolveAgainstPlaylist(entryPath, options.playlistPath);
    if (!playlistRelativePath) continue;
    const match = findAbsoluteMatch(playlistRelativePath, context);
    if (match) return resolvedResult(match, 'playlist-relative', normalizedEntry);
  }

  for (const entryPath of normalizedEntry.paths) {
    const match = findSuffixMatch(entryPath, context);
    if (match) return resolvedResult(match, 'relative-suffix', normalizedEntry);
  }

  const metadataMatch = findMetadataMatch(normalizedEntry, context);
  if (metadataMatch) return resolvedResult(metadataMatch, 'metadata', normalizedEntry);

  return unresolvedResult(normalizedEntry.paths.length > 0 ? 'no-match' : 'no-path-or-metadata-match', normalizedEntry);
}

export function resolvePlaylistEntry(entry, options = {}) {
  return resolvePlaylistEntryWithContext(entry, options, createResolutionContext(options));
}

export function resolvePlaylistEntries(entries, options = {}) {
  const context = createResolutionContext(options);
  const items = (entries ?? []).map(entry => resolvePlaylistEntryWithContext(entry, options, context));
  const resolvedCount = items.filter(item => item.status === 'resolved').length;

  return {
    items,
    resolvedCount,
    unresolvedCount: items.length - resolvedCount
  };
}

export function createUnresolvedPlaylistItem(entry) {
  const normalizedEntry = normalizeEntry(entry);
  const firstPath = normalizedEntry.paths[0] ?? '';

  const unresolved = {
    sourceLine: firstPath,
    title: normalizedEntry.title || undefined,
    artist: normalizedEntry.artist || undefined,
    durationSec: normalizedEntry.durationSec ?? undefined,
    relativePathHint: entry?.relativePathHint ?? entry?.unresolved?.relativePathHint
  };

  if (normalizedEntry.album) {
    unresolved.album = normalizedEntry.album;
  }

  return {
    trackId: null,
    unresolved
  };
}
