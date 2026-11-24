import { SCORE_EXTENSIONS } from '../../midi/score-file.js';
import { cueCoverCandidateFileNames, selectCueCoverFileName } from '../metadata/cue-cover.js';
import { TEXT_FILE_MAX_BYTES } from '../metadata/text-encoding.js';

const SCORE_COVER_MAX_BYTES = 20 * 1024 * 1024;
const archiveCompanionIndexes = new WeakMap();

export function getArchiveScoreEntries(archive) {
  const seen = new Set();
  return archive.entries.filter(entry => {
    const parts = entry.path.split('/');
    const name = parts.at(-1);
    const extensionOffset = name.lastIndexOf('.');
    if (parts.slice(0, -1).includes('__MACOSX') || name.startsWith('._') ||
        extensionOffset <= 0 || !SCORE_EXTENSIONS.includes(name.slice(extensionOffset + 1).toLowerCase())) return false;
    if (seen.has(entry.path)) {
      console.warn('Duplicate score path in archive; skipping the duplicate.');
      return false;
    }
    seen.add(entry.path);
    return entry.supported;
  });
}

export function getArchiveEntryPath(relativePath, entryKey) {
  const prefix = `archive:${relativePath}#`;
  return typeof entryKey === 'string' && entryKey.startsWith(prefix)
    ? entryKey.slice(prefix.length) || null
    : null;
}

export function findArchiveWrdEntry(archive, entryPath) {
  if (!/\.(mid|midi|kar)$/i.test(entryPath)) return null;
  const directory = entryDirectory(entryPath);
  const wrdName = entryPath.slice(directory.length).replace(/\.(mid|midi|kar)$/i, '.wrd').normalize('NFC').toLowerCase();
  return archiveCompanions(archive).get(directory)?.wrd.get(wrdName) ?? null;
}

export function findArchiveCoverEntry(archive, entryPath) {
  const directory = entryDirectory(entryPath);
  const siblings = archiveCompanions(archive).get(directory);
  if (!siblings) return null;
  const rule = cueCoverCandidateFileNames(entryPath).join('\0');
  if (!siblings.coverByRule.has(rule)) {
    const name = selectCueCoverFileName(siblings.coverNames, entryPath);
    siblings.coverByRule.set(rule, siblings.coverByName.get(name) ?? null);
  }
  return siblings.coverByRule.get(rule);
}

function entryDirectory(entryPath) {
  return entryPath.slice(0, entryPath.lastIndexOf('/') + 1);
}

function archiveCompanions(archive) {
  const cached = archiveCompanionIndexes.get(archive);
  if (cached) return cached;
  const directories = new Map();
  for (const entry of archive.entries) {
    if (!entry.supported) continue;
    const directory = entryDirectory(entry.path);
    if (!directories.has(directory)) {
      directories.set(directory, { wrd: new Map(), coverNames: [], coverByName: new Map(), coverByRule: new Map() });
    }
    const siblings = directories.get(directory);
    const name = entry.path.slice(directory.length);
    if (entry.size <= TEXT_FILE_MAX_BYTES && /\.wrd$/i.test(name)) {
      const key = name.normalize('NFC').toLowerCase();
      siblings.wrd.set(key, siblings.wrd.has(key) ? null : entry);
    }
    if (entry.size > 0 && entry.size <= SCORE_COVER_MAX_BYTES) {
      siblings.coverNames.push(name);
      if (!siblings.coverByName.has(name)) siblings.coverByName.set(name, entry);
    }
  }
  archiveCompanionIndexes.set(archive, directories);
  return directories;
}
