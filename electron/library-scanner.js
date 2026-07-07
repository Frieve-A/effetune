const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 16;
const DEFAULT_BATCH_SIZE = 200;
const MAX_BATCH_SIZE = 1000;
const DEFAULT_SEEN_FILES_BATCH_SIZE = 500;
const MAX_SEEN_FILES_BATCH_SIZE = 2000;
const DEFAULT_BATCH_INTERVAL_MS = 500;
const MAX_ARTWORK_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_BATCH_ARTWORK_BYTES = 64 * 1024 * 1024;
const MAX_BATCH_ARTWORK_BYTES = DEFAULT_MAX_BATCH_ARTWORK_BYTES;
const DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_FOLDER_ARTWORK_CACHE_BYTES = DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES;
const MAX_READ_FILE_BYTES = 256 * 1024 * 1024;
const MAX_PARSE_QUEUE_SIZE = 1000;
const DEFAULT_PARSE_FILE_TIMEOUT_MS = 30000;
const MAX_PARSE_FILE_TIMEOUT_MS = 5 * 60 * 1000;

const SUPPORTED_AUDIO_EXTENSIONS = Object.freeze(['mp3', 'wav', 'ogg', 'flac', 'opus', 'm4a', 'aac', 'webm']);
const SUPPORTED_AUDIO_EXTENSION_SET = new Set(SUPPORTED_AUDIO_EXTENSIONS);
const SKIPPED_DIRECTORY_NAMES = new Set(['$recycle.bin', 'system volume information', 'node_modules']);
const ARTWORK_BASENAMES = Object.freeze(['cover', 'folder', 'front', 'album']);
const ARTWORK_EXTENSIONS = Object.freeze(['.jpg', '.jpeg', '.png', '.webp']);
const ARTWORK_EXTENSION_SET = new Set(ARTWORK_EXTENSIONS);

let metadataModulePromise;
let metadataParserMode = 'direct';
const folderArtworkByteCacheStates = new WeakMap();

const metadataWorkerThreads = (() => {
  try {
    return require('worker_threads');
  } catch {
    return null;
  }
})();

let musicMetadataWorkerPath;

function getMusicMetadataWorkerPath() {
  if (musicMetadataWorkerPath !== undefined) return musicMetadataWorkerPath;
  try {
    musicMetadataWorkerPath = require.resolve('music-metadata');
  } catch {
    musicMetadataWorkerPath = null;
  }
  return musicMetadataWorkerPath;
}

const MUSIC_METADATA_PARSE_WORKER_SOURCE = `
const { parentPort, workerData } = require('worker_threads');
const { pathToFileURL } = require('url');

const DEFAULT_MAX_ARTWORK_BYTES = ${MAX_ARTWORK_BYTES};
let parseFilePromise = null;

async function loadParseFile() {
  if (!parseFilePromise) {
    parseFilePromise = (async () => {
      if (workerData && workerData.musicMetadataPath) {
        const metadataModule = await import(pathToFileURL(workerData.musicMetadataPath).href);
        if (metadataModule && typeof metadataModule.parseFile === 'function') {
          return metadataModule.parseFile.bind(metadataModule);
        }
        if (metadataModule && metadataModule.default && typeof metadataModule.default.parseFile === 'function') {
          return metadataModule.default.parseFile.bind(metadataModule.default);
        }
      }

      try {
        const metadataModule = require('music-metadata');
        if (metadataModule && typeof metadataModule.parseFile === 'function') {
          return metadataModule.parseFile.bind(metadataModule);
        }
        if (metadataModule && metadataModule.default && typeof metadataModule.default.parseFile === 'function') {
          return metadataModule.default.parseFile.bind(metadataModule.default);
        }
      } catch (requireError) {
        if (requireError && requireError.code !== 'ERR_REQUIRE_ESM' && requireError.code !== 'MODULE_NOT_FOUND') {
          throw requireError;
        }
      }

      const metadataModule = await import('music-metadata');
      if (metadataModule && typeof metadataModule.parseFile === 'function') {
        return metadataModule.parseFile.bind(metadataModule);
      }
      if (metadataModule && metadataModule.default && typeof metadataModule.default.parseFile === 'function') {
        return metadataModule.default.parseFile.bind(metadataModule.default);
      }
      throw new Error('music-metadata parseFile is unavailable');
    })();
  }
  return await parseFilePromise;
}

function serializeError(error) {
  return {
    name: error && error.name ? error.name : 'Error',
    code: error && error.code ? error.code : undefined,
    message: error && error.message ? error.message : String(error || 'Unknown metadata parse error'),
    stack: error && error.stack ? error.stack : undefined
  };
}

function normalizeMaxArtworkBytes(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_ARTWORK_BYTES;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return DEFAULT_MAX_ARTWORK_BYTES;
  if (number > DEFAULT_MAX_ARTWORK_BYTES) return DEFAULT_MAX_ARTWORK_BYTES;
  return number;
}

function getBinaryByteLength(data) {
  if (!data) return 0;
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'string') return Buffer.byteLength(data);
  return 0;
}

function selectPicture(pictures) {
  if (!Array.isArray(pictures) || pictures.length === 0) return null;

  for (const picture of pictures) {
    const descriptor = \`\${picture.type || ''} \${picture.description || ''}\`.toLowerCase();
    if (descriptor.includes('front')) return picture;
  }

  return pictures[0];
}

function sanitizePictureForPostMessage(picture, maxArtworkBytes) {
  if (!picture || typeof picture !== 'object') return null;
  const byteLength = getBinaryByteLength(picture.data);
  if (byteLength <= 0 || byteLength > maxArtworkBytes) return null;
  return {
    type: picture.type,
    description: picture.description,
    format: picture.format,
    data: picture.data
  };
}

function sanitizeMetadataForPostMessage(metadata, message) {
  if (!metadata || typeof metadata !== 'object') return metadata;
  const sanitized = { ...metadata };
  const common = metadata.common && typeof metadata.common === 'object'
    ? { ...metadata.common }
    : {};
  const includeArtwork = message && message.options && message.options.skipCovers === false;
  if (includeArtwork) {
    const maxArtworkBytes = normalizeMaxArtworkBytes(message.maxArtworkBytes);
    const picture = sanitizePictureForPostMessage(selectPicture(common.picture), maxArtworkBytes);
    common.picture = picture ? [picture] : [];
  } else {
    common.picture = [];
  }
  sanitized.common = common;
  if (metadata.format && typeof metadata.format === 'object') {
    sanitized.format = { ...metadata.format };
  }
  return sanitized;
}

parentPort.on('message', async message => {
  if (!message || message.type !== 'parse') return;
  try {
    const parseFile = await loadParseFile();
    const metadata = await parseFile(message.path, message.options || {});
    parentPort.postMessage({ id: message.id, metadata: sanitizeMetadataForPostMessage(metadata, message) });
  } catch (error) {
    parentPort.postMessage({ id: message.id, error: serializeError(error) });
  }
});
`;

function createAbortError() {
  const error = new Error('Library scan canceled');
  error.name = 'AbortError';
  error.code = 'ABORT_ERR';
  return error;
}

function isAbortError(error) {
  return Boolean(error && (error.name === 'AbortError' || error.code === 'ABORT_ERR'));
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw createAbortError();
  }
}

function deserializeWorkerError(payload) {
  const error = new Error(payload && payload.message ? payload.message : 'Metadata parsing failed');
  if (payload && payload.name) error.name = payload.name;
  if (payload && payload.code) error.code = payload.code;
  if (payload && payload.stack) error.stack = payload.stack;
  return error;
}

function addAbortSignalOption(options, abortSignal) {
  const parseOptions = { ...options };
  if (abortSignal) {
    Object.defineProperty(parseOptions, 'abortSignal', {
      value: abortSignal,
      enumerable: false,
      configurable: true
    });
  }
  return parseOptions;
}

class MetadataParseWorkerPool {
  constructor({ maxWorkers = MAX_CONCURRENCY } = {}) {
    this.maxWorkers = maxWorkers;
    this.workers = new Set();
    this.idleWorkers = [];
    this.queue = [];
    this.nextJobId = 1;
  }

  run(candidate, options, signal, timeoutMs, maxArtworkBytes) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(createAbortError());
        return;
      }

      const job = {
        id: this.nextJobId,
        candidate,
        options,
        signal,
        timeoutMs,
        maxArtworkBytes,
        resolve,
        reject,
        worker: null,
        timeout: null,
        abort: null,
        settled: false
      };
      this.nextJobId += 1;

      if (signal && typeof signal.addEventListener === 'function') {
        job.abort = () => {
          const error = createAbortError();
          if (job.worker) {
            this.completeWorkerJob(job.worker, job, { error, terminate: true });
          } else {
            this.rejectQueuedJob(job, error);
          }
        };
        signal.addEventListener('abort', job.abort, { once: true });
      }

      this.queue.push(job);
      this.pump();
    });
  }

  pump() {
    while (this.queue.length > 0) {
      const worker = this.acquireWorker();
      if (!worker) return;
      const job = this.queue.shift();
      this.startWorkerJob(worker, job);
    }
  }

  acquireWorker() {
    while (this.idleWorkers.length > 0) {
      const worker = this.idleWorkers.pop();
      if (this.workers.has(worker) && !worker.currentJob) return worker;
    }

    if (this.workers.size >= this.maxWorkers) return null;
    return this.createWorker();
  }

  createWorker() {
    if (!metadataWorkerThreads || typeof metadataWorkerThreads.Worker !== 'function') {
      throw new Error('Metadata parse workers are unavailable');
    }

    const worker = new metadataWorkerThreads.Worker(MUSIC_METADATA_PARSE_WORKER_SOURCE, {
      eval: true,
      workerData: {
        musicMetadataPath: getMusicMetadataWorkerPath()
      }
    });
    worker.currentJob = null;
    worker.on('message', message => this.handleWorkerMessage(worker, message));
    worker.on('error', error => this.handleWorkerFailure(worker, error));
    worker.on('exit', code => this.handleWorkerExit(worker, code));
    if (typeof worker.unref === 'function') {
      worker.unref();
    }
    this.workers.add(worker);
    return worker;
  }

  startWorkerJob(worker, job) {
    job.worker = worker;
    worker.currentJob = job;
    job.timeout = setTimeout(() => {
      this.completeWorkerJob(worker, job, {
        error: createParseTimeoutError(job.candidate, job.timeoutMs),
        terminate: true
      });
    }, job.timeoutMs);

    try {
      worker.postMessage({
        type: 'parse',
        id: job.id,
        path: job.candidate.path,
        options: job.options,
        maxArtworkBytes: job.maxArtworkBytes
      });
    } catch (error) {
      this.completeWorkerJob(worker, job, { error, terminate: true });
    }
  }

  handleWorkerMessage(worker, message) {
    const job = worker.currentJob;
    if (!job || job.id !== message?.id) return;
    if (message.error) {
      this.completeWorkerJob(worker, job, { error: deserializeWorkerError(message.error), terminate: false });
      return;
    }
    this.completeWorkerJob(worker, job, { metadata: message.metadata, terminate: false });
  }

  handleWorkerFailure(worker, error) {
    const job = worker.currentJob;
    this.discardWorker(worker);
    if (job && !job.settled) {
      this.rejectJob(job, error);
    }
    this.pump();
  }

  handleWorkerExit(worker, code) {
    const job = worker.currentJob;
    this.discardWorker(worker);
    if (job && !job.settled) {
      const error = new Error(`Metadata parse worker exited with code ${code}`);
      error.code = 'ERR_LIBRARY_PARSE_WORKER_EXIT';
      this.rejectJob(job, error);
    }
    this.pump();
  }

  completeWorkerJob(worker, job, { metadata = null, error = null, terminate = false } = {}) {
    if (!job || job.settled) return;
    job.settled = true;
    this.cleanupJob(job);
    if (worker.currentJob === job) {
      worker.currentJob = null;
    }

    if (terminate) {
      this.discardWorker(worker);
      this.terminateWorker(worker);
    } else if (this.workers.has(worker)) {
      this.idleWorkers.push(worker);
    }

    if (error) {
      job.reject(error);
    } else {
      job.resolve(metadata);
    }
    this.pump();
  }

  rejectQueuedJob(job, error) {
    if (!job || job.settled) return;
    const index = this.queue.indexOf(job);
    if (index !== -1) this.queue.splice(index, 1);
    this.rejectJob(job, error);
  }

  rejectJob(job, error) {
    if (!job || job.settled) return;
    job.settled = true;
    this.cleanupJob(job);
    job.reject(error);
  }

  cleanupJob(job) {
    if (job.timeout) {
      clearTimeout(job.timeout);
      job.timeout = null;
    }
    if (job.abort && job.signal && typeof job.signal.removeEventListener === 'function') {
      job.signal.removeEventListener('abort', job.abort);
    }
    job.abort = null;
    job.worker = null;
  }

  discardWorker(worker) {
    this.workers.delete(worker);
    this.idleWorkers = this.idleWorkers.filter(idleWorker => idleWorker !== worker);
  }

  terminateWorker(worker) {
    try {
      const result = worker.terminate();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch {
      // Worker termination is best effort once a parse has already timed out.
    }
  }
}

let metadataParseWorkerPool = null;

function getMetadataParseWorkerPool() {
  if (!metadataWorkerThreads || typeof metadataWorkerThreads.Worker !== 'function') return null;
  if (!metadataParseWorkerPool) {
    metadataParseWorkerPool = new MetadataParseWorkerPool({ maxWorkers: MAX_CONCURRENCY });
  }
  return metadataParseWorkerPool;
}

async function loadMusicMetadata() {
  if (!metadataModulePromise) {
    metadataModulePromise = (async () => {
      try {
        const metadataModule = require('music-metadata');
        metadataParserMode = 'direct';
        return metadataModule;
      } catch (requireError) {
        if (requireError && requireError.code !== 'ERR_REQUIRE_ESM' && requireError.code !== 'MODULE_NOT_FOUND') {
          return null;
        }

        try {
          const metadataModule = await import('music-metadata');
          metadataParserMode = 'worker';
          return metadataModule;
        } catch {
          metadataParserMode = 'direct';
          return null;
        }
      }
    })();
  }

  return await metadataModulePromise;
}

function getParseFile(metadataModule) {
  if (!metadataModule) return null;
  if (typeof metadataModule.parseFile === 'function') return metadataModule.parseFile.bind(metadataModule);
  if (metadataModule.default && typeof metadataModule.default.parseFile === 'function') {
    return metadataModule.default.parseFile.bind(metadataModule.default);
  }
  return null;
}

function normalizeConcurrency(value) {
  if (!Number.isInteger(value)) return DEFAULT_CONCURRENCY;
  if (value < 1) return 1;
  if (value > MAX_CONCURRENCY) return MAX_CONCURRENCY;
  return value;
}

function normalizeBatchSize(value) {
  if (!Number.isInteger(value) || value < 1) return DEFAULT_BATCH_SIZE;
  if (value > MAX_BATCH_SIZE) return MAX_BATCH_SIZE;
  return value;
}

function normalizeSeenFilesBatchSize(value) {
  if (!Number.isInteger(value) || value < 1) return DEFAULT_SEEN_FILES_BATCH_SIZE;
  if (value > MAX_SEEN_FILES_BATCH_SIZE) return MAX_SEEN_FILES_BATCH_SIZE;
  return value;
}

function normalizeBatchIntervalMs(value) {
  if (!Number.isFinite(value) || value < 1) return DEFAULT_BATCH_INTERVAL_MS;
  return value;
}

function normalizeMaxBatchArtworkBytes(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_BATCH_ARTWORK_BYTES;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return DEFAULT_MAX_BATCH_ARTWORK_BYTES;
  if (number > MAX_BATCH_ARTWORK_BYTES) return MAX_BATCH_ARTWORK_BYTES;
  return number;
}

function normalizeMaxFolderArtworkCacheBytes(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) return DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES;
  if (number > MAX_FOLDER_ARTWORK_CACHE_BYTES) return MAX_FOLDER_ARTWORK_CACHE_BYTES;
  return number;
}

function normalizeMaxArtworkBytes(value) {
  if (value === undefined || value === null) return MAX_ARTWORK_BYTES;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return MAX_ARTWORK_BYTES;
  if (number > MAX_ARTWORK_BYTES) return MAX_ARTWORK_BYTES;
  return number;
}

function normalizeParseFileTimeoutMs(value) {
  if (value === undefined || value === null) return DEFAULT_PARSE_FILE_TIMEOUT_MS;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return DEFAULT_PARSE_FILE_TIMEOUT_MS;
  if (number > MAX_PARSE_FILE_TIMEOUT_MS) return MAX_PARSE_FILE_TIMEOUT_MS;
  return Math.floor(number);
}

function normalizeRoot(root) {
  if (!root || typeof root.path !== 'string' || root.path.trim() === '') {
    throw new Error('Library scan root requires a path');
  }

  const rootPath = path.resolve(root.path);
  return {
    folderId: String(root.folderId || root.id || rootPath),
    path: rootPath
  };
}

function normalizeRoots(roots) {
  if (!Array.isArray(roots) || roots.length === 0) {
    throw new Error('Library scan requires at least one root');
  }

  return roots.map(normalizeRoot);
}

function normalizeRelativePath(relativePath) {
  return String(relativePath || '').replace(/[\\/]+/g, '/');
}

function getKnownFileKey(folderId, relativePath) {
  return `${folderId}\0${normalizeRelativePath(relativePath)}`;
}

function createKnownFileMap(knownFiles) {
  const knownFileMap = new Map();
  if (!Array.isArray(knownFiles)) return knownFileMap;

  for (const file of knownFiles) {
    if (!file || typeof file.relativePath !== 'string') continue;
    const folderId = String(file.folderId || '');
    if (!folderId) continue;
    knownFileMap.set(getKnownFileKey(folderId, file.relativePath), {
      size: Number(file.size),
      mtimeMs: Number(file.mtimeMs),
      trackId: typeof file.trackId === 'string' ? file.trackId : null,
      artworkId: typeof file.artworkId === 'string' ? file.artworkId : null
    });
  }

  return knownFileMap;
}

function hasSameFileStat(knownFile, candidate) {
  if (!knownFile) return false;
  return Number.isFinite(knownFile.size) &&
    Number.isFinite(knownFile.mtimeMs) &&
    knownFile.size === candidate.size &&
    knownFile.mtimeMs === candidate.mtimeMs;
}

function getAudioExtension(filePath) {
  return path.extname(filePath).slice(1).toLowerCase();
}

function isSupportedAudioFile(filePath) {
  return SUPPORTED_AUDIO_EXTENSION_SET.has(getAudioExtension(filePath));
}

function shouldSkipDirectory(name) {
  if (!name) return true;
  if (name.startsWith('.')) return true;
  return SKIPPED_DIRECTORY_NAMES.has(name.toLowerCase());
}

function classifyFsError(error) {
  const code = error && error.code ? error.code : 'UNKNOWN';
  if (code === 'ENOENT') return 'missing';
  if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
  if (code === 'ENOTDIR') return 'not-directory';
  return 'filesystem-error';
}

function toErrorPayload(error) {
  return {
    code: error && error.code ? error.code : 'UNKNOWN',
    reason: error && error.message ? error.message : String(error || 'Unknown error'),
    category: classifyFsError(error)
  };
}

async function assertReadableDirectory(root, signal) {
  throwIfAborted(signal);
  const stat = await fs.promises.stat(root.path);
  throwIfAborted(signal);
  if (!stat.isDirectory()) {
    const error = new Error(`${root.path} is not a directory`);
    error.code = 'ENOTDIR';
    throw error;
  }
  await fs.promises.access(root.path, fs.constants.R_OK);
}

async function emitToSink(sink, event) {
  if (!sink) return;
  if (typeof sink === 'function') {
    await sink(event);
  } else if (typeof sink.emit === 'function') {
    await sink.emit(event);
  }
}

async function* enumerateAudioFiles(root, signal) {
  const stack = [''];

  while (stack.length > 0) {
    throwIfAborted(signal);
    const relativeDir = stack.pop();
    const absoluteDir = relativeDir ? path.join(root.path, relativeDir) : root.path;
    let directory;

    try {
      directory = await fs.promises.opendir(absoluteDir);
    } catch (error) {
      yield {
        type: 'directory-error',
        folderId: root.folderId,
        path: absoluteDir,
        relativePath: normalizeRelativePath(relativeDir),
        error
      };
      continue;
    }

    try {
      for await (const dirent of directory) {
        throwIfAborted(signal);
        if (!dirent || dirent.isSymbolicLink()) continue;

        const childRelativePath = relativeDir ? path.join(relativeDir, dirent.name) : dirent.name;
        const childAbsolutePath = path.join(root.path, childRelativePath);

        if (dirent.isDirectory()) {
          if (!shouldSkipDirectory(dirent.name)) {
            stack.push(childRelativePath);
          }
          continue;
        }

        if (!dirent.isFile() || !isSupportedAudioFile(dirent.name)) continue;

        try {
          const stat = await fs.promises.stat(childAbsolutePath);
          throwIfAborted(signal);
          if (!stat.isFile()) continue;
          const relativePath = normalizeRelativePath(childRelativePath);
          yield {
            type: 'file',
            folderId: root.folderId,
            rootPath: root.path,
            path: childAbsolutePath,
            relativePath,
            fileName: path.basename(childAbsolutePath),
            ext: getAudioExtension(childAbsolutePath),
            size: stat.size,
            mtimeMs: stat.mtimeMs
          };
        } catch (error) {
          yield {
            type: 'file-error',
            folderId: root.folderId,
            path: childAbsolutePath,
            relativePath: normalizeRelativePath(childRelativePath),
            error
          };
        }
      }
    } catch (error) {
      if (isAbortError(error)) throw error;
      yield {
        type: 'directory-error',
        folderId: root.folderId,
        path: absoluteDir,
        relativePath: normalizeRelativePath(relativeDir),
        error
      };
    }
  }
}

function createTrackId(folderId, relativePath) {
  return `t_${crypto
    .createHash('sha1')
    .update(String(folderId))
    .update('\0')
    .update(normalizeRelativePath(relativePath))
    .digest('hex')
    .slice(0, 20)}`;
}

function toArrayBuffer(buffer) {
  if (!buffer) return null;
  if (buffer instanceof ArrayBuffer) return buffer.slice(0);
  if (ArrayBuffer.isView(buffer)) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  const copiedBuffer = Buffer.from(buffer);
  return copiedBuffer.buffer.slice(copiedBuffer.byteOffset, copiedBuffer.byteOffset + copiedBuffer.byteLength);
}

function toBuffer(data) {
  if (!data) return null;
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data);
}

function getBinaryByteLength(data) {
  if (!data) return 0;
  if (Buffer.isBuffer(data)) return data.byteLength;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  if (Array.isArray(data)) return data.length;
  if (typeof data === 'string') return Buffer.byteLength(data);
  return 0;
}

function createArtworkIdFromBytes(bytes) {
  return `art_${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 24)}`;
}

function createFolderArtworkCache(maxBytes) {
  const cache = new Map();
  configureFolderArtworkCache(cache, maxBytes);
  return cache;
}

function configureFolderArtworkCache(cache, maxBytes) {
  const byteBudget = normalizeMaxFolderArtworkCacheBytes(maxBytes);
  let state = folderArtworkByteCacheStates.get(cache);
  if (!state) {
    state = {
      maxBytes: byteBudget,
      bytes: 0,
      entries: new Map()
    };
    folderArtworkByteCacheStates.set(cache, state);
    return cache;
  }

  state.maxBytes = byteBudget;
  evictFolderArtworkByteCache(state);
  return cache;
}

function prepareFolderArtworkCache(cache, maxBytes) {
  const artworkCache = cache || new Map();
  if (maxBytes === undefined || maxBytes === null) {
    if (!folderArtworkByteCacheStates.has(artworkCache)) {
      configureFolderArtworkCache(artworkCache, DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES);
    }
  } else {
    configureFolderArtworkCache(artworkCache, maxBytes);
  }
  return artworkCache;
}

function getFolderArtworkByteCacheState(cache) {
  if (!folderArtworkByteCacheStates.has(cache)) {
    configureFolderArtworkCache(cache, DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES);
  }
  return folderArtworkByteCacheStates.get(cache);
}

function removeFolderArtworkByteEntry(state, key, expectedEntry = null) {
  const entry = state.entries.get(key);
  if (!entry || (expectedEntry && entry !== expectedEntry)) return;
  state.entries.delete(key);
  if (entry.byteLength > 0) {
    state.bytes -= entry.byteLength;
    if (state.bytes < 0) state.bytes = 0;
  }
}

function evictFolderArtworkByteCache(state) {
  while (state.bytes > state.maxBytes && state.entries.size > 0) {
    const oldestKey = state.entries.keys().next().value;
    if (oldestKey === undefined) break;
    removeFolderArtworkByteEntry(state, oldestKey);
  }
}

function getCachedFolderArtworkPromise(cache, key) {
  const state = getFolderArtworkByteCacheState(cache);
  const entry = state.entries.get(key);
  if (!entry) return null;
  state.entries.delete(key);
  state.entries.set(key, entry);
  return entry.promise;
}

function cacheFolderArtworkPromise(cache, key, promise) {
  const state = getFolderArtworkByteCacheState(cache);
  removeFolderArtworkByteEntry(state, key);
  const entry = {
    promise,
    byteLength: 0
  };
  state.entries.set(key, entry);

  promise.then(
    artwork => {
      const buffer = artwork ? normalizeArtworkBuffer(artwork.buffer) : null;
      const byteLength = buffer ? buffer.byteLength : 0;
      if (byteLength <= 0 || byteLength > state.maxBytes) {
        removeFolderArtworkByteEntry(state, key, entry);
        return;
      }
      if (state.entries.get(key) !== entry) return;
      entry.byteLength = byteLength;
      state.bytes += byteLength;
      state.entries.delete(key);
      state.entries.set(key, entry);
      evictFolderArtworkByteCache(state);
    },
    () => {
      removeFolderArtworkByteEntry(state, key, entry);
    }
  );
}

function normalizeArtworkBuffer(data, maxBytes = MAX_ARTWORK_BYTES) {
  const artworkByteLimit = normalizeMaxArtworkBytes(maxBytes);
  const byteLength = getBinaryByteLength(data);
  if (byteLength <= 0 || byteLength > artworkByteLimit) return null;
  const buffer = toBuffer(data);
  if (!buffer || buffer.byteLength === 0 || buffer.byteLength > artworkByteLimit) return null;
  return buffer;
}

function stringOrEmpty(value) {
  if (typeof value === 'string') return value.trim();
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function numberOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function firstArrayString(value) {
  if (!Array.isArray(value)) return '';
  for (const item of value) {
    const text = stringOrEmpty(item);
    if (text) return text;
  }
  return '';
}

function joinedArtists(common) {
  if (Array.isArray(common.artists)) {
    const artists = common.artists.map(stringOrEmpty).filter(Boolean);
    if (artists.length > 0) return artists.join('; ');
  }
  return stringOrEmpty(common.artist);
}

function normalizeCommonObject(metadata) {
  return metadata && metadata.common ? metadata.common : {};
}

function normalizeFormatObject(metadata) {
  return metadata && metadata.format ? metadata.format : {};
}

function getSortText(common, names) {
  for (const name of names) {
    const value = stringOrEmpty(common[name]);
    if (value) return value;
  }
  return '';
}

function selectPicture(pictures) {
  if (!Array.isArray(pictures) || pictures.length === 0) return null;

  for (const picture of pictures) {
    const descriptor = `${picture.type || ''} ${picture.description || ''}`.toLowerCase();
    if (descriptor.includes('front')) return picture;
  }

  return pictures[0];
}

function mimeFromArtworkExtension(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function formatByteLimit(byteLength) {
  const mebibyte = 1024 * 1024;
  if (byteLength >= mebibyte && byteLength % mebibyte === 0) {
    return `${byteLength / mebibyte} MiB`;
  }
  return `${byteLength} bytes`;
}

function getLibraryPlaybackUnsupportedReason(candidate) {
  const size = Number(candidate && candidate.size);
  if (!Number.isFinite(size) || size <= MAX_READ_FILE_BYTES) return null;
  return `Library playback reads are limited to ${formatByteLimit(MAX_READ_FILE_BYTES)} per file; this file is ${size} bytes.`;
}

function createFallbackTrack(candidate, now = Date.now()) {
  const title = path.basename(candidate.fileName, path.extname(candidate.fileName));
  const libraryPlaybackUnsupportedReason = getLibraryPlaybackUnsupportedReason(candidate);
  return {
    id: createTrackId(candidate.folderId, candidate.relativePath),
    folderId: candidate.folderId,
    relativePath: candidate.relativePath,
    fileName: candidate.fileName,
    ext: candidate.ext,
    size: candidate.size,
    mtimeMs: candidate.mtimeMs,
    title,
    artist: '',
    albumArtist: '',
    album: '',
    genre: '',
    year: null,
    trackNo: null,
    trackOf: null,
    discNo: null,
    discOf: null,
    compilation: false,
    sortTitle: '',
    sortAlbum: '',
    sortAlbumArtist: '',
    durationSec: null,
    sampleRate: null,
    bitrate: null,
    bitsPerSample: null,
    channels: null,
    codec: candidate.ext ? candidate.ext.toUpperCase() : '',
    artworkId: null,
    artworkBytes: null,
    artworkMime: null,
    artworkSourceKind: null,
    libraryPlaybackUnsupportedReason,
    addedAt: now,
    updatedAt: now
  };
}

function createTrackFromMetadata(candidate, metadata, now = Date.now(), { includeArtwork = true, maxArtworkBytes = MAX_ARTWORK_BYTES } = {}) {
  const common = normalizeCommonObject(metadata);
  const format = normalizeFormatObject(metadata);
  const fallback = createFallbackTrack(candidate, now);
  const artist = joinedArtists(common);
  const albumArtist = stringOrEmpty(common.albumartist) || artist || '';
  const genre = firstArrayString(common.genre) || stringOrEmpty(common.genre);
  const title = stringOrEmpty(common.title) || fallback.title;
  const lowerAlbumArtist = albumArtist.toLowerCase();
  const picture = includeArtwork ? selectPicture(common.picture) : null;
  const pictureBuffer = picture ? normalizeArtworkBuffer(picture.data, maxArtworkBytes) : null;

  return {
    ...fallback,
    title,
    artist,
    albumArtist,
    album: stringOrEmpty(common.album),
    genre,
    year: integerOrNull(common.year),
    trackNo: common.track ? integerOrNull(common.track.no) : null,
    trackOf: common.track ? integerOrNull(common.track.of) : null,
    discNo: common.disk ? integerOrNull(common.disk.no) : null,
    discOf: common.disk ? integerOrNull(common.disk.of) : null,
    compilation: common.compilation === true || lowerAlbumArtist === 'various artists',
    sortTitle: getSortText(common, ['titlesort', 'titleSort', 'sorttitle']),
    sortAlbum: getSortText(common, ['albumsort', 'albumSort', 'sortalbum']),
    sortAlbumArtist: getSortText(common, ['albumartistsort', 'albumArtistSort', 'sortalbumartist']),
    durationSec: numberOrNull(format.duration),
    sampleRate: numberOrNull(format.sampleRate),
    bitrate: numberOrNull(format.bitrate),
    bitsPerSample: numberOrNull(format.bitsPerSample),
    channels: numberOrNull(format.numberOfChannels),
    codec: stringOrEmpty(format.codec) || stringOrEmpty(format.dataformat).toUpperCase() || fallback.codec,
    artworkBytes: pictureBuffer ? toArrayBuffer(pictureBuffer) : null,
    artworkMime: pictureBuffer ? stringOrEmpty(picture.format) || 'application/octet-stream' : null,
    artworkSourceKind: pictureBuffer ? 'embedded' : null
  };
}

function shouldRetryDuration(candidate, metadata) {
  const format = normalizeFormatObject(metadata);
  if (Number.isFinite(format.duration)) return false;
  return candidate.ext === 'aac' || candidate.ext === 'mp3';
}

function createParseTimeoutError(candidate, timeoutMs) {
  const error = new Error(`Metadata parsing timed out after ${timeoutMs} ms for ${candidate.relativePath || candidate.path}`);
  error.code = 'ERR_LIBRARY_PARSE_TIMEOUT';
  return error;
}

function parseFileWithWorkerGuards(candidate, options, signal, timeoutMs, maxArtworkBytes) {
  const pool = getMetadataParseWorkerPool();
  if (!pool) return null;
  return pool.run(candidate, options, signal, timeoutMs, maxArtworkBytes);
}

function parseFileDirectWithGuards(candidate, parseFile, options, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(createAbortError());
      return;
    }

    let settled = false;
    let timeout = null;
    const parseAbortController = new AbortController();
    const canListenForAbort = signal && typeof signal.addEventListener === 'function';
    const parseOptions = addAbortSignalOption(options, parseAbortController.signal);

    function cleanup() {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      if (canListenForAbort) {
        signal.removeEventListener('abort', abort);
      }
    }

    function settle(callback, value) {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    }

    function abort() {
      parseAbortController.abort();
      settle(reject, createAbortError());
    }

    if (canListenForAbort) {
      signal.addEventListener('abort', abort, { once: true });
    }

    timeout = setTimeout(() => {
      parseAbortController.abort();
      settle(reject, createParseTimeoutError(candidate, timeoutMs));
    }, timeoutMs);

    Promise.resolve()
      .then(() => parseFile(candidate.path, parseOptions))
      .then(
        metadata => settle(resolve, metadata),
        error => settle(reject, error)
      );
  });
}

function parseFileWithGuards(candidate, parseFile, options, signal, timeoutMs, maxArtworkBytes = MAX_ARTWORK_BYTES) {
  if (metadataParserMode === 'worker') {
    const workerPromise = parseFileWithWorkerGuards(candidate, options, signal, timeoutMs, normalizeMaxArtworkBytes(maxArtworkBytes));
    if (workerPromise) return workerPromise;
  }
  return parseFileDirectWithGuards(candidate, parseFile, options, signal, timeoutMs);
}

async function parseMetadataFile(candidate, parseFile, signal, parseFileTimeoutMs, { skipCovers = true, maxArtworkBytes = MAX_ARTWORK_BYTES } = {}) {
  if (!parseFile) return { metadata: null, error: null };

  try {
    throwIfAborted(signal);
    let metadata = await parseFileWithGuards(candidate, parseFile, {
      duration: false,
      skipCovers
    }, signal, parseFileTimeoutMs, maxArtworkBytes);
    throwIfAborted(signal);
    if (shouldRetryDuration(candidate, metadata)) {
      metadata = await parseFileWithGuards(candidate, parseFile, {
        duration: true,
        skipCovers
      }, signal, parseFileTimeoutMs, maxArtworkBytes);
      throwIfAborted(signal);
    }
    return { metadata, error: null };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { metadata: null, error };
  }
}

async function resolveFolderArtworkDescriptor(directoryPath, cache, signal) {
  const directory = path.resolve(directoryPath);
  const key = `descriptor\0${directory}`;
  if (cache.has(key)) {
    return await cache.get(key);
  }

  const promise = (async () => {
    try {
      throwIfAborted(signal);
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      throwIfAborted(signal);
      const candidates = [];

      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const parsed = path.parse(entry.name);
        const baseName = parsed.name.toLowerCase();
        const extension = parsed.ext.toLowerCase();
        const baseIndex = ARTWORK_BASENAMES.indexOf(baseName);
        const extensionIndex = ARTWORK_EXTENSIONS.indexOf(extension);
        if (baseIndex === -1 || extensionIndex === -1 || !ARTWORK_EXTENSION_SET.has(extension)) continue;
        candidates.push({
          path: path.join(directory, entry.name),
          baseIndex,
          extensionIndex,
          name: entry.name
        });
      }

      candidates.sort((a, b) => {
        if (a.baseIndex !== b.baseIndex) return a.baseIndex - b.baseIndex;
        if (a.extensionIndex !== b.extensionIndex) return a.extensionIndex - b.extensionIndex;
        return a.name.localeCompare(b.name);
      });

      if (candidates.length === 0) return null;

      for (const candidate of candidates) {
        throwIfAborted(signal);
        const stat = await fs.promises.stat(candidate.path);
        if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_ARTWORK_BYTES) continue;
        return {
          path: candidate.path,
          mime: mimeFromArtworkExtension(candidate.path),
          sourceKind: 'folder-image'
        };
      }

      return null;
    } catch (error) {
      if (isAbortError(error)) throw error;
      return null;
    }
  })();

  cache.set(key, promise);
  return await promise;
}

async function findFolderArtwork(directoryPath, cache, signal) {
  const descriptor = await resolveFolderArtworkDescriptor(directoryPath, cache, signal);
  if (!descriptor) return null;

  const key = `bytes\0${path.resolve(descriptor.path)}`;
  const cachedPromise = getCachedFolderArtworkPromise(cache, key);
  if (cachedPromise) {
    return await cachedPromise;
  }

  const promise = (async () => {
    try {
      throwIfAborted(signal);
      const buffer = await readFileBufferWithinLimit(descriptor.path, MAX_ARTWORK_BYTES, signal);
      throwIfAborted(signal);
      if (!buffer || buffer.length <= 0 || buffer.length > MAX_ARTWORK_BYTES) return null;
      return {
        ...descriptor,
        id: createArtworkIdFromBytes(buffer),
        buffer
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      return null;
    }
  })();

  cacheFolderArtworkPromise(cache, key, promise);
  return await promise;
}

async function readFileBufferWithinLimit(filePath, maxBytes, signal) {
  const fileHandle = await fs.promises.open(filePath, 'r');
  try {
    throwIfAborted(signal);
    const stat = await fileHandle.stat();
    throwIfAborted(signal);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return null;

    const buffer = Buffer.allocUnsafe(stat.size);
    let bytesRead = 0;
    while (bytesRead < stat.size) {
      const result = await fileHandle.read(buffer, bytesRead, stat.size - bytesRead, bytesRead);
      if (result.bytesRead === 0) break;
      bytesRead += result.bytesRead;
      throwIfAborted(signal);
    }

    const finalStat = await fileHandle.stat();
    throwIfAborted(signal);
    if (!finalStat.isFile() || finalStat.size <= 0 || finalStat.size > maxBytes) return null;
    return buffer.subarray(0, bytesRead);
  } finally {
    await fileHandle.close();
  }
}

async function attachFolderArtwork(track, candidate, artworkCache, signal) {
  if (track.artworkBytes) return track;
  const artwork = await findFolderArtwork(path.dirname(candidate.path), artworkCache, signal);
  if (!artwork) return track;

  return {
    ...track,
    artworkId: artwork.id,
    artworkBytes: artwork.buffer,
    artworkMime: artwork.mime,
    artworkSourceKind: artwork.sourceKind
  };
}

async function parseLibraryFile(candidate, parseFile, artworkCache, signal, parseFileTimeoutMs, now = Date.now(), { skipCovers = true, maxArtworkBytes = MAX_ARTWORK_BYTES } = {}) {
  const parsed = await parseMetadataFile(candidate, parseFile, signal, parseFileTimeoutMs, { skipCovers, maxArtworkBytes });
  const track = parsed.metadata
    ? createTrackFromMetadata(candidate, parsed.metadata, now, { includeArtwork: !skipCovers, maxArtworkBytes })
    : createFallbackTrack(candidate, now);

  return {
    track: await attachFolderArtwork(track, candidate, artworkCache, signal),
    error: parsed.error
  };
}

function createEmptyBatchPayloadState() {
  return {
    tracks: [],
    artworkById: new Map(),
    artworkBytes: 0
  };
}

function finalizeBatchPayloadState(state) {
  return {
    tracks: state.tracks,
    artworks: [...state.artworkById.values()]
  };
}

function normalizeByteOption(value, fallback) {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error('Byte offset, length, and maxBytes must be non-negative safe integers');
  }
  return number;
}

function normalizeMaxBytesOption(value) {
  const maxBytes = normalizeByteOption(value, MAX_READ_FILE_BYTES);
  return maxBytes > MAX_READ_FILE_BYTES ? MAX_READ_FILE_BYTES : maxBytes;
}

function assertReadWithinLimit(byteLength, maxBytes) {
  if (byteLength > maxBytes) {
    const error = new Error(`Requested byte range (${byteLength} bytes) exceeds maximum read size of ${formatByteLimit(maxBytes)} (${maxBytes} bytes) for library playback`);
    error.code = 'ERR_LIBRARY_READ_LIMIT';
    error.requestedBytes = byteLength;
    error.maxBytes = maxBytes;
    throw error;
  }
}

function assertReadableFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    throw new Error('File path is required');
  }
  return path.resolve(filePath);
}

function createNotFileError(filePath) {
  const error = new Error(`${filePath} is not a file`);
  error.code = 'EISDIR';
  return error;
}

function isMissingOrNonFileError(error) {
  return Boolean(error && (
    error.code === 'ENOENT' ||
    error.code === 'ENOTDIR' ||
    error.code === 'EISDIR'
  ));
}

async function assertReadableFileTarget(filePath) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile()) {
    throw createNotFileError(filePath);
  }
}

async function readFileBytes(filePath, options = {}) {
  const resolvedPath = assertReadableFilePath(filePath);
  const offset = normalizeByteOption(options.offset, 0);
  const maxBytes = normalizeMaxBytesOption(options.maxBytes);

  const fileHandle = await fs.promises.open(resolvedPath, 'r');
  try {
    const stat = await fileHandle.stat();
    if (!stat.isFile()) {
      const error = new Error(`${resolvedPath} is not a file`);
      error.code = 'EISDIR';
      throw error;
    }
    if (offset >= stat.size) return new ArrayBuffer(0);

    const availableBytes = stat.size - offset;
    const requestedLength = options.length === undefined || options.length === null
      ? availableBytes
      : normalizeByteOption(options.length, 0);
    const length = requestedLength < availableBytes ? requestedLength : availableBytes;
    if (length === 0) return new ArrayBuffer(0);
    assertReadWithinLimit(length, maxBytes);

    const buffer = Buffer.allocUnsafe(length);
    const result = await fileHandle.read(buffer, 0, length, offset);
    return toArrayBuffer(buffer.subarray(0, result.bytesRead));
  } finally {
    await fileHandle.close();
  }
}

async function readArtworkBytes(filePath, options = {}) {
  const resolvedPath = assertReadableFilePath(filePath);
  if (!isSupportedAudioFile(resolvedPath)) {
    throw new Error('Library artwork reads require a supported audio file');
  }
  await assertReadableFileTarget(resolvedPath);
  const signal = options.signal;
  const parseFileTimeoutMs = normalizeParseFileTimeoutMs(options.parseFileTimeoutMs);
  const maxArtworkBytes = normalizeMaxArtworkBytes(options.maxArtworkBytes);
  const metadataModule = await loadMusicMetadata();
  const parseFile = getParseFile(metadataModule);

  if (parseFile) {
    try {
      throwIfAborted(signal);
      const metadata = await parseFileWithGuards({
        path: resolvedPath,
        relativePath: path.basename(resolvedPath)
      }, parseFile, {
        duration: false,
        skipCovers: false
      }, signal, parseFileTimeoutMs, maxArtworkBytes);
      throwIfAborted(signal);
      const picture = selectPicture(normalizeCommonObject(metadata).picture);
      const pictureBuffer = picture ? normalizeArtworkBuffer(picture.data, maxArtworkBytes) : null;
      if (pictureBuffer) return toArrayBuffer(pictureBuffer);
    } catch (error) {
      if (isAbortError(error) || isMissingOrNonFileError(error)) throw error;
    }
  }

  await assertReadableFileTarget(resolvedPath);
  const artworkCache = prepareFolderArtworkCache(options.artworkCache, options.maxFolderArtworkCacheBytes);
  const artwork = await findFolderArtwork(path.dirname(resolvedPath), artworkCache, signal);
  return artwork ? toArrayBuffer(artwork.buffer) : null;
}

async function scanLibrary(options = {}, sink = () => {}) {
  const signal = options.signal;
  const requestedRoots = normalizeRoots(options.roots);
  const knownFileMap = createKnownFileMap(options.knownFiles);
  const concurrency = normalizeConcurrency(options.concurrency);
  const batchSize = normalizeBatchSize(options.batchSize);
  const seenFilesBatchSize = normalizeSeenFilesBatchSize(options.seenFilesBatchSize);
  const batchIntervalMs = normalizeBatchIntervalMs(options.batchIntervalMs);
  const maxBatchArtworkBytes = normalizeMaxBatchArtworkBytes(options.maxBatchArtworkBytes);
  const maxFolderArtworkCacheBytes = normalizeMaxFolderArtworkCacheBytes(options.maxFolderArtworkCacheBytes);
  const parseFileTimeoutMs = normalizeParseFileTimeoutMs(options.parseFileTimeoutMs);
  const maxArtworkBytes = normalizeMaxArtworkBytes(options.maxArtworkBytes);
  const skipCovers = options.skipCovers !== false;
  const metadataModule = await loadMusicMetadata();
  const parseFile = getParseFile(metadataModule);
  const artworkCache = createFolderArtworkCache(maxFolderArtworkCacheBytes);
  const roots = [];
  const rootErrors = [];
  let seenFilesBatch = [];
  const parseQueue = [];
  const stats = {
    found: 0,
    parsed: 0,
    parseErrors: 0,
    skipped: 0
  };
  let skippedSinceLastEmit = 0;
  let processed = 0;
  let lastBatchAt = Date.now();
  let batchState = createEmptyBatchPayloadState();

  async function flushBatch(force = false) {
    if (batchState.tracks.length === 0) return;
    const now = Date.now();
    if (!force && batchState.tracks.length < batchSize && now - lastBatchAt < batchIntervalMs) return;

    const payload = finalizeBatchPayloadState(batchState);
    batchState = createEmptyBatchPayloadState();
    lastBatchAt = now;
    await emitToSink(sink, { type: 'batch', ...payload });
  }

  async function appendTrackToBatch(track) {
    const artworkBuffer = normalizeArtworkBuffer(track.artworkBytes, maxArtworkBytes);
    if (!artworkBuffer) {
      batchState.tracks.push({
        ...track,
        artworkBytes: null,
        artworkMime: null,
        artworkSourceKind: null
      });
      return;
    }

    const artworkId = track.artworkId || createArtworkIdFromBytes(artworkBuffer);
    const hasArtworkInCurrentPayload = batchState.artworkById.has(artworkId);
    const artworkByteLength = artworkBuffer.byteLength;
    if (!hasArtworkInCurrentPayload &&
      batchState.tracks.length > 0 &&
      batchState.artworkBytes > 0 &&
      batchState.artworkBytes + artworkByteLength > maxBatchArtworkBytes) {
      await flushBatch(true);
    }

    let artwork = batchState.artworkById.get(artworkId);
    if (artwork) {
      artwork.refCount += 1;
    } else {
      artwork = {
        id: artworkId,
        bytes: toArrayBuffer(artworkBuffer),
        mime: track.artworkMime || 'application/octet-stream',
        sourceKind: track.artworkSourceKind || 'embedded',
        refCount: 1
      };
      batchState.artworkById.set(artworkId, artwork);
      batchState.artworkBytes += artworkByteLength;
    }

    batchState.tracks.push({
      ...track,
      artworkId,
      artworkBytes: null
    });
  }

  async function emitSeenFile(file) {
    seenFilesBatch.push(file);
    if (seenFilesBatch.length >= seenFilesBatchSize) {
      const files = seenFilesBatch;
      seenFilesBatch = [];
      await emitToSink(sink, { type: 'seen-files', files });
    }
  }

  async function flushSeenFiles() {
    if (seenFilesBatch.length === 0) return;
    const files = seenFilesBatch;
    seenFilesBatch = [];
    await emitToSink(sink, { type: 'seen-files', files });
  }

  async function drainParseQueue() {
    if (parseQueue.length === 0) return;
    const queue = parseQueue.splice(0, parseQueue.length);
    let nextIndex = 0;

    async function parseWorker() {
      while (true) {
        throwIfAborted(signal);
        const index = nextIndex;
        nextIndex += 1;
        if (index >= queue.length) return;

        const candidate = queue[index];
        let result;

        try {
          result = await parseLibraryFile(candidate, parseFile, artworkCache, signal, parseFileTimeoutMs, Date.now(), { skipCovers, maxArtworkBytes });
        } catch (error) {
          if (isAbortError(error)) throw error;
          result = { track: createFallbackTrack(candidate), error };
        }

        if (result.error) {
          stats.parseErrors += 1;
          await emitToSink(sink, {
            type: 'parse-error',
            folderId: candidate.folderId,
            relativePath: candidate.relativePath,
            reason: result.error.message || String(result.error)
          });
        }

        if (result.track) {
          stats.parsed += 1;
          await appendTrackToBatch(result.track);
          await flushBatch(false);
        }

        processed += 1;
        await emitToSink(sink, {
          type: 'progress',
          parsed: processed,
          total: stats.found - stats.skipped,
          currentPath: candidate.relativePath,
          folderId: candidate.folderId,
          found: stats.found,
          skipped: stats.skipped
        });
      }
    }

    const workerCount = queue.length < concurrency ? queue.length : concurrency;
    const workers = [];
    for (let i = 0; i < workerCount; i += 1) {
      workers.push(parseWorker());
    }
    await Promise.all(workers);
  }

  throwIfAborted(signal);

  for (const root of requestedRoots) {
    try {
      await assertReadableDirectory(root, signal);
      roots.push(root);
    } catch (error) {
      rootErrors.push({ root, error });
    }
  }

  if (roots.length === 0 && rootErrors.length > 0) {
    const { root, error } = rootErrors[0];
    const payload = toErrorPayload(error);
    await emitToSink(sink, {
      type: 'error',
      fatal: true,
      folderId: root.folderId,
      path: root.path,
      ...payload
    });
    throw error;
  }

  for (const { root, error } of rootErrors) {
    const payload = toErrorPayload(error);
    await emitToSink(sink, {
      type: 'error',
      fatal: false,
      folderId: root.folderId,
      path: root.path,
      ...payload
    });
  }

  for (const root of roots) {
    for await (const entry of enumerateAudioFiles(root, signal)) {
      throwIfAborted(signal);

      if (entry.type !== 'file') {
        const payload = toErrorPayload(entry.error);
        await emitToSink(sink, {
          type: 'error',
          fatal: false,
          folderId: entry.folderId,
          path: entry.path,
          relativePath: entry.relativePath,
          ...payload
        });
        continue;
      }

      stats.found += 1;
      await emitSeenFile({ folderId: entry.folderId, relativePath: entry.relativePath });
      await emitToSink(sink, {
        type: 'enumerate-progress',
        found: stats.found,
        folderId: entry.folderId,
        currentPath: entry.relativePath
      });
      throwIfAborted(signal);

      const knownFile = knownFileMap.get(getKnownFileKey(entry.folderId, entry.relativePath));
      if (hasSameFileStat(knownFile, entry)) {
        stats.skipped += 1;
        skippedSinceLastEmit += 1;
        if (skippedSinceLastEmit >= batchSize) {
          await emitToSink(sink, { type: 'skipped', count: skippedSinceLastEmit });
          skippedSinceLastEmit = 0;
        }
      } else {
        parseQueue.push(entry);
        if (parseQueue.length >= MAX_PARSE_QUEUE_SIZE) {
          await drainParseQueue();
        }
      }
    }
  }

  if (skippedSinceLastEmit > 0) {
    await emitToSink(sink, { type: 'skipped', count: skippedSinceLastEmit });
  }

  await drainParseQueue();
  throwIfAborted(signal);
  await flushSeenFiles();
  throwIfAborted(signal);
  await flushBatch(true);
  throwIfAborted(signal);

  const doneEvent = {
    type: 'done',
    found: stats.found,
    parsed: stats.parsed,
    parseErrors: stats.parseErrors,
    skipped: stats.skipped
  };
  await emitToSink(sink, doneEvent);
  return { ...stats };
}

function createLibraryScan(options = {}, sink = () => {}) {
  const controller = new AbortController();
  const scanId = options.scanId || `scan_${Date.now().toString(36)}`;
  const promise = scanLibrary({ ...options, scanId, signal: controller.signal }, sink);

  return {
    scanId,
    promise,
    cancel() {
      controller.abort();
    }
  };
}

module.exports = {
  ARTWORK_BASENAMES,
  DEFAULT_BATCH_INTERVAL_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_CONCURRENCY,
  DEFAULT_MAX_BATCH_ARTWORK_BYTES,
  DEFAULT_MAX_FOLDER_ARTWORK_CACHE_BYTES,
  DEFAULT_SEEN_FILES_BATCH_SIZE,
  DEFAULT_PARSE_FILE_TIMEOUT_MS,
  MAX_ARTWORK_BYTES,
  MAX_BATCH_ARTWORK_BYTES,
  MAX_BATCH_SIZE,
  MAX_FOLDER_ARTWORK_CACHE_BYTES,
  MAX_READ_FILE_BYTES,
  MAX_SEEN_FILES_BATCH_SIZE,
  SUPPORTED_AUDIO_EXTENSIONS,
  createAbortError,
  createLibraryScan,
  createTrackId,
  isAbortError,
  isSupportedAudioFile,
  normalizeRelativePath,
  readArtworkBytes,
  readFileBytes,
  scanLibrary
};
