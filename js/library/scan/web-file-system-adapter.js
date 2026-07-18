import {
  isSupportedAudioPath,
  isSupportedCuePath,
  isSupportedPlaylistPath,
  normalizeRelativePath
} from '../constants.js';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';
import { assertDirectoryHandle } from './web-folder-handle-store.js';

export class WebFileSystemScanAdapter {
  constructor({ rootHandle, onPlaylistFile = () => {} }) {
    this.rootHandle = assertDirectoryHandle(rootHandle);
    if (typeof onPlaylistFile !== 'function') throw new TypeError('onPlaylistFile must be a function');
    this.onPlaylistFile = onPlaylistFile;
  }

  async *enumerateDirectory({ relativeDirectory = '', signal } = {}) {
    throwIfAborted(signal);
    const directory = await getDirectoryAtPath(this.rootHandle, relativeDirectory);
    let iterator;
    try {
      iterator = directory.values()[Symbol.asyncIterator]();
    } catch (error) {
      throw fileSystemError(error, 'handle-expired');
    }
    for (;;) {
      throwIfAborted(signal);
      let result;
      try {
        result = await iterator.next();
      } catch (error) {
        throw fileSystemError(error, 'transient-io');
      }
      if (result.done) return;
      const handle = result.value;
      const relativePath = joinRelative(relativeDirectory, handle?.name);
      if (handle?.kind === 'directory') {
        yield { kind: 'directory', name: handle.name, relativePath, path: relativePath };
      } else if (handle?.kind === 'file' && isSupportedAudioPath(relativePath)) {
        yield { kind: 'file', name: handle.name, relativePath, path: relativePath };
      } else if (handle?.kind === 'file' && isSupportedCuePath(relativePath)) {
        yield { kind: 'cue', name: handle.name, relativePath, path: relativePath };
      } else if (handle?.kind === 'file' && isSupportedPlaylistPath(relativePath)) {
        this.onPlaylistFile({ name: handle.name, relativePath, path: relativePath });
      }
    }
  }

  async statFile({ entry, signal } = {}) {
    throwIfAborted(signal);
    const relativePath = normalizeSafePath(entry?.relativePath);
    const file = await this.getFile(relativePath, signal);
    return {
      fileIdentity: `fsa:${relativePath}`,
      size: file.size,
      mtimeMs: file.lastModified
    };
  }

  async getFile(relativePath, signal) {
    throwIfAborted(signal);
    try {
      const parts = normalizeSafePath(relativePath).split('/');
      let directory = this.rootHandle;
      for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
      const handle = await directory.getFileHandle(parts.at(-1));
      const file = await handle.getFile();
      throwIfAborted(signal);
      assertRepositoryContract(Number.isSafeInteger(file.size) && file.size >= 0, 'metadata-too-large', 'File size is outside the supported range');
      assertRepositoryContract(Number.isSafeInteger(file.lastModified) && file.lastModified >= 0, 'transient-io', 'File timestamp is invalid');
      return file;
    } catch (error) {
      if (error?.code) throw error;
      throw fileSystemError(error, 'transient-io');
    }
  }

  async listFileNames(relativeDirectory = '', signal) {
    throwIfAborted(signal);
    const directory = await getDirectoryAtPath(this.rootHandle, relativeDirectory);
    const names = [];
    try {
      for await (const handle of directory.values()) {
        throwIfAborted(signal);
        if (handle?.kind === 'file' && typeof handle.name === 'string') names.push(handle.name);
      }
      return names;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw fileSystemError(error, 'transient-io');
    }
  }

  async readSmallFile({ relativePath, maximumBytes, signal } = {}) {
    const file = await this.getFile(relativePath, signal);
    if (file.size > maximumBytes) return { tooLarge: true, size: file.size, bytes: null };
    const bytes = new Uint8Array(await file.arrayBuffer());
    throwIfAborted(signal);
    return { tooLarge: false, size: file.size, bytes };
  }
}

export async function queryFolderPermission(handle) {
  assertDirectoryHandle(handle);
  try {
    if (typeof handle.queryPermission !== 'function') return 'granted';
    const permission = await handle.queryPermission({ mode: 'read' });
    return permission === 'granted' ? 'granted' : 'needs-permission';
  } catch {
    return 'needs-permission';
  }
}

export async function isSameFolderRoot(candidateHandle, existingHandle) {
  try {
    return await compareFolderRoots(candidateHandle, existingHandle) === 'same';
  } catch {
    return false;
  }
}

export async function compareFolderRoots(candidateHandle, existingHandle) {
  assertDirectoryHandle(candidateHandle);
  assertDirectoryHandle(existingHandle);
  if (candidateHandle === existingHandle) return 'same';
  try {
    if (typeof candidateHandle.isSameEntry === 'function' &&
        await candidateHandle.isSameEntry(existingHandle) === true) {
      return 'same';
    }
    assertRepositoryContract(
      typeof candidateHandle.resolve === 'function' && typeof existingHandle.resolve === 'function',
      'folderContainmentUnavailable',
      'Folder containment could not be checked'
    );
    const candidateToExisting = await candidateHandle.resolve(existingHandle);
    const existingToCandidate = await existingHandle.resolve(candidateHandle);
    if (Array.isArray(candidateToExisting)) {
      return candidateToExisting.length === 0 ? 'same' : 'ancestor';
    }
    if (Array.isArray(existingToCandidate)) {
      return existingToCandidate.length === 0 ? 'same' : 'descendant';
    }
    return 'unrelated';
  } catch (error) {
    if (error?.code === 'folderContainmentUnavailable') throw error;
    throw createRepositoryError(
      'folderContainmentUnavailable',
      'Folder containment could not be checked'
    );
  }
}

async function getDirectoryAtPath(root, relativeDirectory) {
  const path = String(relativeDirectory ?? '');
  if (!path) return root;
  let directory = root;
  for (const part of normalizeSafePath(path).split('/')) {
    try {
      directory = await directory.getDirectoryHandle(part);
    } catch (error) {
      throw fileSystemError(error, 'handle-expired');
    }
  }
  return directory;
}

function normalizeSafePath(value) {
  const path = normalizeRelativePath(String(value ?? ''));
  assertRepositoryContract(path && !path.split('/').includes('..'), 'invalidScanPath', 'File System Access returned an unsafe path');
  return path;
}

function joinRelative(directory, name) {
  return normalizeSafePath(directory ? `${directory}/${name ?? ''}` : String(name ?? ''));
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Scan aborted', 'AbortError');
}

function fileSystemError(error, fallbackCode) {
  const code = error?.name === 'NotAllowedError'
    ? 'temporary-permission'
    : error?.name === 'NotFoundError'
      ? 'handle-expired'
      : fallbackCode;
  return createRepositoryError(code, 'File System Access operation failed', { errorName: String(error?.name ?? 'Error') });
}
