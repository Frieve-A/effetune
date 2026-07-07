import { createFallbackDisplayName, getFileExtension, isSupportedAudioPath, normalizeRelativePath, stripExtension } from '../constants.js';
import { createFallbackTrack } from '../metadata/metadata-mapper.js';

export class FsaLibrarySource {
  constructor(windowRef = globalThis.window) {
    this.windowRef = windowRef;
    this.kind = 'fsa';
    this.capabilities = {
      persistentFolders: true,
      absolutePaths: false,
      showInFolder: false
    };
  }

  async pickFolder() {
    let handle;
    try {
      handle = await this.windowRef.showDirectoryPicker({ mode: 'read', startIn: 'music', id: 'effetune-library' });
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      throw error;
    }
    await this.persistStorage();
    return {
      kind: 'fsa',
      handle,
      path: null,
      displayName: handle.name || 'Music'
    };
  }

  async checkFolder(folder) {
    if (!folder.handle) return 'needs-permission';
    try {
      const permission = await folder.handle.queryPermission?.({ mode: 'read' });
      if (permission !== 'granted') return 'needs-permission';
      if (typeof folder.handle.values === 'function') {
        const iterator = folder.handle.values()[Symbol.asyncIterator]?.();
        await iterator?.next?.();
      }
      return 'ok';
    } catch (_) {
      return 'missing';
    }
  }

  async requestAccess(folder) {
    if (folder.handle?.requestPermission) {
      const granted = await folder.handle.requestPermission({ mode: 'read' });
      if (granted === 'granted') return true;
    }
    try {
      const picked = await this.pickFolder();
      if (!picked?.handle) return false;
      if (!await this.isReconnectHandleCompatible(folder.handle, picked.handle)) return false;
      folder.handle = picked.handle;
      folder.displayName = picked.displayName;
      return true;
    } catch (_) {
      return false;
    }
  }

  async isReconnectHandleCompatible(existingHandle, pickedHandle) {
    if (!existingHandle || !pickedHandle) return true;
    const comparisons = [
      [existingHandle, pickedHandle],
      [pickedHandle, existingHandle]
    ].filter(([left]) => typeof left?.isSameEntry === 'function');
    if (!comparisons.length) return true;
    for (const [left, right] of comparisons) {
      try {
        if (await left.isSameEntry(right)) return true;
      } catch (_) {
        // Try the opposite direction before failing.
      }
    }
    return false;
  }

  async persistStorage() {
    try {
      await this.windowRef?.navigator?.storage?.persist?.();
    } catch (_) {
      // Storage persistence is a best-effort browser hint.
    }
  }

  async compareFolder(candidate, existing) {
    const candidateHandle = candidate?.handle;
    const existingHandle = existing?.handle;
    if (!candidateHandle || !existingHandle) return 'unknown';
    try {
      if (await candidateHandle.isSameEntry?.(existingHandle)) return 'same';
    } catch (_) {
      return 'unknown';
    }
    try {
      const path = await candidateHandle.resolve?.(existingHandle);
      if (Array.isArray(path)) return 'ancestor';
    } catch (_) {
      return 'unknown';
    }
    try {
      const path = await existingHandle.resolve?.(candidateHandle);
      if (Array.isArray(path)) return 'descendant';
    } catch (_) {
      return 'unknown';
    }
    return 'separate';
  }

  scan(options, sink) {
    let canceled = false;
    let metadataWorker = null;
    const done = (async () => {
      metadataWorker = this.createMetadataWorker();
      try {
        let found = 0;
        for (const folder of options.folders) {
          if (canceled || !folder.handle) continue;
          const known = new Map((options.knownFiles || [])
            .filter(item => item.folderId === folder.id)
            .map(item => [item.relativePath, item]));
          const batch = [];
          const seenPaths = [];
          for await (const fileRef of walkDirectoryHandle(folder.handle)) {
            if (canceled) break;
            if (fileRef.type !== 'file') {
              await sink({
                type: 'error',
                fatal: false,
                folderId: folder.id,
                relativePath: normalizeRelativePath(fileRef.relativePath),
                reason: fileRef.error?.message || String(fileRef.error)
              });
              continue;
            }
            const relativePath = normalizeRelativePath(fileRef.relativePath);
            if (!isSupportedAudioPath(relativePath)) continue;
            found++;
            seenPaths.push(relativePath);
            await sink({ type: 'enumerate-progress', folderId: folder.id, found, currentPath: relativePath });
            const knownFile = known.get(relativePath);
            if (knownFile && sameMtime(knownFile.mtimeMs, fileRef.file.lastModified) && knownFile.size === fileRef.file.size) {
              await sink({ type: 'skipped', folderId: folder.id, relativePath, count: 1 });
              continue;
            }
            const parsed = await createTrackFromFile(this.windowRef, folder, fileRef.file, relativePath, metadataWorker, () => canceled);
            if (canceled || parsed.canceled) break;
            if (parsed.error) {
              await sink({
                type: 'parse-error',
                folderId: folder.id,
                relativePath,
                reason: parsed.error.message || String(parsed.error)
              });
            }
            batch.push(parsed.track);
            if (batch.length >= (options.batchSize || 200)) {
              await sink({ type: 'batch', tracks: batch.splice(0), currentPath: relativePath });
            }
          }
          if (batch.length) {
            await sink({ type: 'batch', tracks: batch.splice(0) });
          }
          await sink({ type: 'done', folderId: folder.id, seenPaths });
        }
      } finally {
        metadataWorker?.terminate();
      }
    })();
    return {
      done,
      cancel: () => {
        canceled = true;
        metadataWorker?.terminate();
      }
    };
  }

  createMetadataWorker() {
    const WorkerCtor = this.windowRef?.Worker;
    if (typeof WorkerCtor !== 'function') return null;
    try {
      return new MetadataWorkerClient(new WorkerCtor(new URL('../metadata/metadata-worker.js', import.meta.url), { type: 'module' }));
    } catch (_) {
      return null;
    }
  }

  async resolveForPlayback(track) {
    if (track.file) return { file: track.file };
    if (track.folder?.handle) {
      const file = await getFileFromHandlePath(track.folder.handle, track.relativePath);
      return { file };
    }
    throw new Error('File access is not available. Reconnect the folder.');
  }

  async readArtwork() {
    return null;
  }
}

async function* walkDirectoryHandle(handle, prefix = '') {
  let iterator;
  try {
    iterator = handle.values()[Symbol.asyncIterator]();
  } catch (error) {
    yield { type: 'directory-error', relativePath: prefix, error };
    return;
  }
  while (true) {
    let result;
    try {
      result = await iterator.next();
    } catch (error) {
      yield { type: 'directory-error', relativePath: prefix, error };
      return;
    }
    if (result.done) return;
    const entry = result.value;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      yield* walkDirectoryHandle(entry, relativePath);
    } else if (entry.kind === 'file') {
      let file;
      try {
        file = await entry.getFile();
      } catch (error) {
        yield { type: 'file-error', relativePath, error };
        continue;
      }
      yield { type: 'file', relativePath, file };
    }
  }
}

async function getFileFromHandlePath(handle, relativePath) {
  const parts = normalizeRelativePath(relativePath).split('/').filter(Boolean);
  let current = handle;
  for (let i = 0; i < parts.length - 1; i++) {
    current = await current.getDirectoryHandle(parts[i]);
  }
  const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
  return fileHandle.getFile();
}

async function createTrackFromFile(windowRef, folder, file, relativePath, metadataWorker = null, isCanceled = () => false) {
  const fileName = relativePath.split('/').pop() || file.name;
  const candidate = {
    folderId: folder.id,
    relativePath,
    fileName,
    ext: getFileExtension(fileName),
    size: file.size,
    mtimeMs: file.lastModified,
    file
  };
  if (metadataWorker) {
    try {
      const track = await metadataWorker.parse(file, withoutRuntimeFile(candidate));
      if (isCanceled()) return { canceled: true };
      return { track: { ...track, file }, error: null };
    } catch (error) {
      if (isCanceled()) return { canceled: true };
      const fallbackTrack = await createTrackFromBrowserTags(windowRef, candidate);
      if (isCanceled()) return { canceled: true };
      return { track: fallbackTrack, error };
    }
  }
  const fallbackTrack = await createTrackFromBrowserTags(windowRef, candidate);
  if (isCanceled()) return { canceled: true };
  return { track: fallbackTrack, error: null };
}

async function createTrackFromBrowserTags(windowRef, candidate) {
  const track = {
    ...createFallbackTrack(candidate),
    file: candidate.file,
    title: stripExtension(candidate.fileName) || createFallbackDisplayName(candidate.fileName),
    ext: candidate.ext || getFileExtension(candidate.fileName),
    size: candidate.size,
    mtimeMs: candidate.mtimeMs,
    codec: ''
  };
  const tags = await readBrowserTags(windowRef, candidate.file);
  return tags ? applyBrowserTags(track, tags) : track;
}

function withoutRuntimeFile(candidate) {
  const { file: _file, ...serializable } = candidate;
  return serializable;
}

class MetadataWorkerClient {
  constructor(worker) {
    this.worker = worker;
    this.nextId = 1;
    this.pending = new Map();
    this.failed = false;
    this.terminated = false;
    const onMessage = event => this.handleMessage(event.data);
    const onError = event => this.rejectAll(new Error(event?.message || 'Metadata worker failed'));
    if (typeof worker.addEventListener === 'function') {
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onError);
    } else {
      worker.onmessage = onMessage;
      worker.onerror = onError;
    }
  }

  parse(file, candidate) {
    if (this.failed || this.terminated) return Promise.reject(new Error('Metadata worker is unavailable'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ type: 'parse', id, file, candidate });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  handleMessage(message = {}) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.ok) {
      pending.resolve(message.track);
    } else {
      pending.reject(new Error(message.error || 'Metadata parsing failed'));
    }
  }

  rejectAll(error) {
    this.failed = true;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  terminate() {
    if (this.terminated) return;
    this.terminated = true;
    this.rejectAll(new Error('Metadata worker terminated'));
    this.worker.terminate?.();
  }
}

function readBrowserTags(windowRef, file) {
  const jsmediatags = windowRef?.jsmediatags;
  if (!jsmediatags?.read) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      jsmediatags.read(file, {
        onSuccess(result) {
          resolve(result?.tags || null);
        },
        onError() {
          resolve(null);
        }
      });
    } catch (_) {
      resolve(null);
    }
  });
}

function applyBrowserTags(track, tags) {
  const picture = tags.picture && Array.isArray(tags.picture.data) ? tags.picture : null;
  return {
    ...track,
    title: stringTag(tags.title) || track.title,
    artist: stringTag(tags.artist),
    albumArtist: stringTag(tags.albumartist) || stringTag(tags.albumArtist) || stringTag(tags.artist),
    album: stringTag(tags.album),
    genre: Array.isArray(tags.genre) ? stringTag(tags.genre[0]) : stringTag(tags.genre),
    year: parseInteger(tags.year),
    trackNo: parseFractionNumber(tags.track).value,
    trackOf: parseFractionNumber(tags.track).total,
    discNo: parseFractionNumber(tags.disk || tags.disc).value,
    discOf: parseFractionNumber(tags.disk || tags.disc).total,
    artworkBytes: picture ? Uint8Array.from(picture.data).buffer : null,
    artworkMime: picture ? (stringTag(picture.format) || 'application/octet-stream') : null,
    artworkSourceKind: picture ? 'embedded' : null
  };
}

function stringTag(value) {
  if (value == null) return '';
  return String(value).trim();
}

function parseInteger(value) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : null;
}

function parseFractionNumber(value) {
  const text = stringTag(value);
  if (!text) return { value: null, total: null };
  const [valueText, totalText] = text.split('/');
  return {
    value: parseInteger(valueText),
    total: parseInteger(totalText)
  };
}

function sameMtime(a, b) {
  return Math.floor((Number(a) || 0) / 1000) === Math.floor((Number(b) || 0) / 1000);
}
