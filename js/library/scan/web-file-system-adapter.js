import { isSupportedAudioPath, normalizeRelativePath } from '../constants.js';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';
import { assertDirectoryHandle } from './web-folder-handle-store.js';

export class WebFileSystemScanAdapter {
  constructor({ rootHandle }) {
    this.rootHandle = assertDirectoryHandle(rootHandle);
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

export async function compareFolderRoots(candidateHandle, existingHandle) {
  assertDirectoryHandle(candidateHandle);
  assertDirectoryHandle(existingHandle);
  try {
    if (await candidateHandle.isSameEntry?.(existingHandle)) return 'same';
  } catch {
    // Resolve checks below still provide a bounded containment comparison.
  }
  try {
    if (Array.isArray(await candidateHandle.resolve?.(existingHandle))) return 'ancestor';
  } catch {
    // Try the opposite containment direction.
  }
  try {
    if (Array.isArray(await existingHandle.resolve?.(candidateHandle))) return 'descendant';
  } catch {
    // Unresolvable roots are separate for this profile.
  }
  return 'separate';
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
