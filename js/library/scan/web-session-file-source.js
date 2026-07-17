import {
  isSupportedAudioPath,
  isSupportedCuePath,
  isSupportedPlaylistPath,
  normalizeRelativePath,
  normalizeRelativePathForMatching
} from '../constants.js';
import { assertRepositoryContract } from '../repository/contract-errors.js';

const MAX_SESSION_FILES = 1_000_000;

export class WebSessionFileSource {
  constructor({ entries = [] } = {}) {
    this.files = new Map();
    this.compatibleKeys = new Map();
    this.directories = new Map([['', createDirectoryNode()]]);
    this.add(entries);
  }

  get size() {
    return this.files.size;
  }

  add(entries = []) {
    assertRepositoryContract(Array.isArray(entries), 'invalidSessionFiles', 'Session files must be an array');
    assertRepositoryContract(
      this.files.size + entries.length <= MAX_SESSION_FILES,
      'tooManySessionFiles',
      'The selected folder contains too many files'
    );
    for (const entry of entries) this.#addEntry(entry);
    return { fileCount: this.files.size };
  }

  createAdapter({ onPlaylistFile = () => {} } = {}) {
    if (typeof onPlaylistFile !== 'function') throw new TypeError('onPlaylistFile must be a function');
    const source = this;
    return Object.freeze({
      async *enumerateDirectory({ relativeDirectory = '', signal } = {}) {
        throwIfAborted(signal);
        const directory = normalizeDirectory(relativeDirectory);
        const node = source.directories.get(directory);
        if (!node) return;
        for (const name of [...node.directories].sort(compareNames)) {
          throwIfAborted(signal);
          const relativePath = joinRelative(directory, name);
          yield { kind: 'directory', name, relativePath, path: relativePath };
        }
        for (const name of [...node.files].sort(compareNames)) {
          throwIfAborted(signal);
          const relativePath = joinRelative(directory, name);
          if (isSupportedAudioPath(relativePath)) {
            yield { kind: 'file', name, relativePath, path: relativePath };
          } else if (isSupportedCuePath(relativePath)) {
            yield { kind: 'cue', name, relativePath, path: relativePath };
          } else if (isSupportedPlaylistPath(relativePath)) {
            onPlaylistFile({ name, relativePath, path: relativePath });
          }
        }
      },
      async statFile({ entry, signal } = {}) {
        const relativePath = normalizeSafePath(entry?.relativePath);
        const file = await source.getFile(relativePath, signal);
        return {
          fileIdentity: `session:${relativePath}`,
          size: file.size,
          mtimeMs: file.lastModified
        };
      },
      getFile(relativePath, signal) {
        return source.getFile(relativePath, signal);
      },
      async readSmallFile({ relativePath, maximumBytes, signal } = {}) {
        const file = await source.getFile(relativePath, signal);
        if (file.size > maximumBytes) return { tooLarge: true, size: file.size, bytes: null };
        const bytes = new Uint8Array(await file.arrayBuffer());
        throwIfAborted(signal);
        return { tooLarge: false, size: file.size, bytes };
      }
    });
  }

  async getFile(relativePath, signal) {
    throwIfAborted(signal);
    const exactPath = normalizeSafePath(relativePath);
    let file = this.files.get(exactPath);
    if (!file) {
      const compatiblePath = this.compatibleKeys.get(normalizeRelativePathForMatching(exactPath));
      if (compatiblePath) file = this.files.get(compatiblePath);
    }
    assertRepositoryContract(file, 'sourceUnavailable', 'The selected file is not available in this session');
    validateFile(file);
    return file;
  }

  #addEntry(entry) {
    assertRepositoryContract(entry && typeof entry === 'object', 'invalidSessionFiles', 'Session file entry is invalid');
    const relativePath = normalizeSafePath(entry.relativePath);
    const file = entry.file;
    validateFile(file);
    this.files.set(relativePath, file);
    const matchingKey = normalizeRelativePathForMatching(relativePath);
    const existing = this.compatibleKeys.get(matchingKey);
    if (existing === undefined || existing === relativePath) this.compatibleKeys.set(matchingKey, relativePath);
    else this.compatibleKeys.set(matchingKey, null);

    const parts = relativePath.split('/');
    let parent = '';
    for (const part of parts.slice(0, -1)) {
      const node = this.directories.get(parent) ?? createDirectoryNode();
      this.directories.set(parent, node);
      node.directories.add(part);
      parent = joinRelative(parent, part);
      if (!this.directories.has(parent)) this.directories.set(parent, createDirectoryNode());
    }
    const node = this.directories.get(parent) ?? createDirectoryNode();
    this.directories.set(parent, node);
    node.files.add(parts.at(-1));
  }
}

function createDirectoryNode() {
  return { directories: new Set(), files: new Set() };
}

function validateFile(file) {
  assertRepositoryContract(file && typeof file === 'object', 'invalidSessionFiles', 'Session file is invalid');
  assertRepositoryContract(Number.isSafeInteger(file.size) && file.size >= 0, 'invalidSessionFiles', 'Session file size is invalid');
  assertRepositoryContract(
    Number.isSafeInteger(file.lastModified) && file.lastModified >= 0,
    'invalidSessionFiles',
    'Session file timestamp is invalid'
  );
}

function normalizeDirectory(value) {
  if (value == null || value === '') return '';
  return normalizeSafePath(value);
}

function normalizeSafePath(value) {
  const path = normalizeRelativePath(String(value ?? ''));
  assertRepositoryContract(path && !path.split('/').includes('..'), 'invalidSessionFiles', 'Session file path is invalid');
  return path;
}

function joinRelative(directory, name) {
  return normalizeSafePath(directory ? `${directory}/${name ?? ''}` : String(name ?? ''));
}

function compareNames(left, right) {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true });
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Scan aborted', 'AbortError');
}
