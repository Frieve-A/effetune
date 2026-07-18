'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { cueCoverMimeType, selectCueCoverFileName } = require('./cue-cover.cjs');
const { MetadataWorkerPool } = require('./library-metadata-worker-pool.cjs');

const CUE_MAX_BYTES = 1024 * 1024;
const CUE_COVER_MAX_BYTES = 20 * 1024 * 1024;
const CUE_EXTENSION = '.cue';
const CUE_AUDIO_EXTENSIONS = new Set(['.flac', '.wav']);
const PLAYBACK_AUDIO_EXTENSIONS = new Set([
  '.aac', '.flac', '.m4a', '.mp3', '.mp4', '.ogg', '.opus', '.wav', '.webm'
]);

class LocalPlaybackIngress {
  constructor({
    filesystem = fs,
    cueModuleLoader = loadCueModule,
    metadataParserFactory = () => new MetadataWorkerPool({ workerCount: 2 })
  } = {}) {
    this.filesystem = filesystem;
    this.cueModuleLoader = cueModuleLoader;
    this.metadataParserFactory = metadataParserFactory;
    this.requestGeneration = 0;
    this.activeController = null;
    this.disposed = false;
  }

  beginRequest() {
    if (this.disposed) throw createIngressError('selection-stale');
    this.activeController?.abort(createIngressError('selection-stale'));
    const controller = new AbortController();
    const request = { generation: ++this.requestGeneration, controller };
    this.activeController = controller;
    return request;
  }

  isCurrent(request) {
    return request?.generation === this.requestGeneration &&
      request.controller === this.activeController &&
      request.controller.signal.aborted !== true;
  }

  async resolveSelection(filePaths, request = this.beginRequest()) {
    const paths = requirePathArray(filePaths);
    const cuePaths = paths.filter(filePath => path.extname(filePath).toLowerCase() === CUE_EXTENSION);
    if (cuePaths.length === 0) {
      const descriptors = await admitLocalPlaybackPaths(paths, {
        filesystem: this.filesystem,
        signal: request.controller.signal
      });
      this.assertCurrent(request);
      return { kind: 'normal', descriptors };
    }
    if (cuePaths.length !== 1 || paths.length !== 1) {
      throw createIngressError('cue-selection-mixed');
    }
    const tracks = await resolveElectronCueSelection(cuePaths[0], {
      filesystem: this.filesystem,
      cueModuleLoader: this.cueModuleLoader,
      metadataParserFactory: this.metadataParserFactory,
      signal: request.controller.signal
    });
    this.assertCurrent(request);
    return { kind: 'cue', tracks };
  }

  assertCurrent(request) {
    if (!this.isCurrent(request)) throw createIngressError('selection-stale');
  }

  cancel() {
    const controller = this.activeController;
    this.activeController = null;
    if (controller && !controller.signal.aborted) {
      controller.abort(createIngressError('selection-stale'));
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
  }

  isDisposed() {
    return this.disposed;
  }
}

async function admitLocalPlaybackPaths(filePaths, { filesystem = fs, signal } = {}) {
  const paths = requirePathArray(filePaths);
  const descriptors = [];
  for (const filePath of paths) {
    throwIfAborted(signal);
    if (!PLAYBACK_AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
      throw createIngressError('unsupported-playback-file');
    }
    const canonicalPath = path.resolve(await filesystem.realpath(path.resolve(filePath)));
    const stats = await filesystem.stat(canonicalPath);
    if (!stats.isFile()) throw createIngressError('playback-file-unavailable');
    const byteLength = requireSafeFileSize(stats.size);
    descriptors.push(Object.freeze({
      path: canonicalPath,
      byteLength,
      name: path.basename(canonicalPath)
    }));
  }
  return Object.freeze(descriptors);
}

async function resolveElectronCueSelection(cuePath, {
  filesystem = fs,
  cueModuleLoader = loadCueModule,
  metadataParserFactory = () => new MetadataWorkerPool({ workerCount: 2 }),
  signal
} = {}) {
  throwIfAborted(signal);
  const cueSource = await readBoundedCueFile(cuePath, { filesystem, signal });
  const cueModule = await cueModuleLoader();
  throwIfAborted(signal);

  let parsed;
  try {
    const decoded = cueModule.decodeCueBytes(cueSource.bytes);
    if (!decoded?.ok) throw createIngressError('cue-invalid');
    parsed = cueModule.parseCueSheet(decoded.text, {
      cueRelativePath: path.basename(cueSource.canonicalPath)
    });
  } catch (error) {
    throw createIngressError('cue-invalid', error);
  }
  if (!parsed?.ok) throw createIngressError('cue-invalid');

  const directoryEntries = await filesystem.readdir(cueSource.canonicalParent, { withFileTypes: true });
  throwIfAborted(signal);
  const availablePaths = directoryEntries
    .filter(entry => entry?.isFile?.() || entry?.isSymbolicLink?.())
    .map(entry => entry.name);
  const resolved = cueModule.resolveCueSheet(parsed, availablePaths);
  if (!resolved?.ok) throw createIngressError(classifyCueResolutionError(resolved?.code));

  const admittedByRelativePath = new Map();
  for (const relativePath of resolved.resolvedFiles) {
    admittedByRelativePath.set(relativePath, await admitCueAudioSource(
      cueSource.canonicalParent,
      relativePath,
      { filesystem, signal }
    ));
  }
  const coverByRelativePath = await readCueCovers(
    cueSource.canonicalParent,
    resolved.resolvedFiles,
    directoryEntries,
    { filesystem, signal }
  );

  const parser = metadataParserFactory();
  const metadataByCanonicalPath = new Map();
  const physicalMetadataByPath = new Map();
  try {
    for (const relativePath of resolved.resolvedFiles) {
      throwIfAborted(signal);
      const admitted = admittedByRelativePath.get(relativePath);
      let metadataPromise = metadataByCanonicalPath.get(filesystemPathKey(admitted.canonicalPath));
      if (!metadataPromise) {
        metadataPromise = Promise.resolve(parser.parse({
          path: admitted.canonicalPath,
          relativePath,
          skipCovers: true,
          signal
        }));
        metadataByCanonicalPath.set(filesystemPathKey(admitted.canonicalPath), metadataPromise);
      }
      physicalMetadataByPath.set(relativePath, await metadataPromise);
    }

    for (const admitted of admittedByRelativePath.values()) {
      await assertFileIdentityCurrent(admitted, { filesystem, signal });
    }
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'selection-stale') throw error;
    throw createIngressError('cue-source-unavailable', error);
  } finally {
    if (typeof parser.close === 'function') await parser.close().catch(() => {});
  }

  throwIfAborted(signal);
  const validated = cueModule.validateCueDurations(resolved, physicalMetadataByPath);
  if (!validated?.ok) throw createIngressError('cue-invalid');

  return Object.freeze(validated.tracks.map(track => {
    const admitted = admittedByRelativePath.get(track.relativePath);
    const physicalMetadata = physicalMetadataByPath.get(track.relativePath);
    const cueMetadata = cueModule.createCueTrackMetadata(validated, track, physicalMetadata);
    const picture = coverByRelativePath.get(track.relativePath) ?? null;
    const meta = picture ? Object.freeze({ ...cueMetadata, picture }) : cueMetadata;
    const displayName = meta.artist && meta.title ? `${meta.artist} - ${meta.title}` : meta.title;
    return Object.freeze({
      path: admitted.canonicalPath,
      byteLength: admitted.identity.size,
      name: displayName || path.basename(admitted.canonicalPath),
      meta,
      startFrame: track.startFrame,
      endFrame: track.endFrame,
      durationSec: track.durationSec,
      physicalSourceKey: admitted.canonicalPath
    });
  }));
}

async function readCueCovers(canonicalParent, relativePaths, directoryEntries, {
  filesystem = fs,
  signal
} = {}) {
  const coverPromises = new Map();
  const covers = new Map();
  for (const relativePath of relativePaths) {
    const fileName = selectCueCoverFileName(directoryEntries, relativePath);
    if (!fileName) continue;
    const key = filesystemPathKey(fileName);
    let coverPromise = coverPromises.get(key);
    if (!coverPromise) {
      coverPromise = tryReadCueCover(canonicalParent, fileName, { filesystem, signal });
      coverPromises.set(key, coverPromise);
    }
    const picture = await coverPromise;
    if (picture) covers.set(relativePath, picture);
  }
  return covers;
}

async function tryReadCueCover(canonicalParent, fileName, { filesystem = fs, signal } = {}) {
  try {
    throwIfAborted(signal);
    const lexicalPath = path.join(canonicalParent, fileName);
    const canonicalPath = path.resolve(await filesystem.realpath(lexicalPath));
    if (!sameFilesystemPath(path.dirname(canonicalPath), canonicalParent)) return null;
    const handle = await filesystem.open(canonicalPath, 'r');
    try {
      const before = await handle.stat();
      if (!before.isFile()) return null;
      const identity = captureFileIdentity(before);
      if (identity.size === 0 || identity.size > CUE_COVER_MAX_BYTES) return null;
      const bytes = await readExactFileBytes(handle, identity.size, signal);
      const after = await handle.stat();
      if (bytes.byteLength !== identity.size ||
          !sameFileIdentity(identity, captureFileIdentity(after))) return null;
      return Object.freeze({
        data: bytes,
        format: cueCoverMimeType(fileName)
      });
    } finally {
      await handle.close().catch(() => {});
    }
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'selection-stale') throw error;
    return null;
  }
}

async function readBoundedCueFile(filePath, { filesystem = fs, signal } = {}) {
  throwIfAborted(signal);
  const lexicalPath = path.resolve(filePath);
  const lexicalStats = await filesystem.lstat(lexicalPath);
  if (!lexicalStats.isFile() && !lexicalStats.isSymbolicLink()) {
    throw createIngressError('cue-file-unavailable');
  }
  const canonicalParent = path.resolve(await filesystem.realpath(path.dirname(lexicalPath)));
  const canonicalPath = path.resolve(await filesystem.realpath(lexicalPath));
  if (!sameFilesystemPath(path.dirname(canonicalPath), canonicalParent)) {
    throw createIngressError('cue-file-unavailable');
  }

  const handle = await filesystem.open(canonicalPath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) throw createIngressError('cue-file-unavailable');
    const size = requireSafeFileSize(before.size);
    if (size > CUE_MAX_BYTES) throw createIngressError('cue-too-large');
    throwIfAborted(signal);
    const bytes = await readExactFileBytes(handle, size, signal);
    const after = await handle.stat();
    const identity = captureFileIdentity(before);
    if (bytes.byteLength !== size || !sameFileIdentity(identity, captureFileIdentity(after))) {
      throw createIngressError('cue-file-changed');
    }
    await assertCuePathIdentityCurrent({
      lexicalPath,
      canonicalParent,
      canonicalPath,
      identity
    }, { filesystem, signal });
    return { canonicalParent, canonicalPath, bytes };
  } finally {
    await handle.close().catch(() => {});
  }
}

async function assertCuePathIdentityCurrent(admitted, { filesystem = fs, signal } = {}) {
  throwIfAborted(signal);
  try {
    const canonicalParent = path.resolve(await filesystem.realpath(path.dirname(admitted.lexicalPath)));
    const canonicalPath = path.resolve(await filesystem.realpath(admitted.lexicalPath));
    if (!sameFilesystemPath(canonicalParent, admitted.canonicalParent) ||
        !sameFilesystemPath(canonicalPath, admitted.canonicalPath) ||
        !sameFilesystemPath(path.dirname(canonicalPath), canonicalParent)) {
      throw createIngressError('cue-file-changed');
    }
    const stats = await filesystem.stat(canonicalPath);
    if (!stats.isFile() || !sameFileIdentity(admitted.identity, captureFileIdentity(stats))) {
      throw createIngressError('cue-file-changed');
    }
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'selection-stale' ||
        error?.code === 'cue-file-changed') throw error;
    throw createIngressError('cue-file-changed', error);
  }
}

async function readExactFileBytes(handle, size, signal) {
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    throwIfAborted(signal);
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  return offset === size ? bytes : bytes.subarray(0, offset);
}

async function admitCueAudioSource(canonicalParent, relativePath, { filesystem = fs, signal } = {}) {
  throwIfAborted(signal);
  if (typeof relativePath !== 'string' || path.basename(relativePath) !== relativePath ||
      !CUE_AUDIO_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
    throw createIngressError('cue-invalid');
  }
  const lexicalPath = path.join(canonicalParent, relativePath);
  const canonicalPath = path.resolve(await filesystem.realpath(lexicalPath));
  if (!sameFilesystemPath(path.dirname(canonicalPath), canonicalParent)) {
    throw createIngressError('cue-source-outside-folder');
  }
  const stats = await filesystem.stat(canonicalPath);
  if (!stats.isFile()) throw createIngressError('cue-source-unavailable');
  return Object.freeze({
    lexicalPath,
    canonicalPath,
    identity: captureFileIdentity(stats)
  });
}

async function assertFileIdentityCurrent(admitted, { filesystem = fs, signal } = {}) {
  throwIfAborted(signal);
  const canonicalPath = path.resolve(await filesystem.realpath(admitted.lexicalPath));
  if (!sameFilesystemPath(canonicalPath, admitted.canonicalPath)) {
    throw createIngressError('cue-source-changed');
  }
  const stats = await filesystem.stat(canonicalPath);
  if (!stats.isFile() || !sameFileIdentity(admitted.identity, captureFileIdentity(stats))) {
    throw createIngressError('cue-source-changed');
  }
}

async function loadCueModule() {
  const modulePath = path.join(__dirname, '../js/library/metadata/cue-sheet.js');
  return import(pathToFileURL(modulePath).href);
}

function captureFileIdentity(stats) {
  return Object.freeze({
    size: requireSafeFileSize(stats.size),
    mtimeMs: Math.round(Number(stats.mtimeMs)),
    dev: String(stats.dev ?? ''),
    ino: String(stats.ino ?? '')
  });
}

function sameFileIdentity(left, right) {
  return left.size === right.size && left.mtimeMs === right.mtimeMs &&
    left.dev === right.dev && left.ino === right.ino;
}

function requireSafeFileSize(value) {
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size < 0) throw createIngressError('playback-file-unavailable');
  return size;
}

function requirePathArray(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000 ||
      value.some(item => typeof item !== 'string' || !item || item.length > 32_768)) {
    throw createIngressError('invalid-playback-selection');
  }
  return value;
}

function sameFilesystemPath(left, right) {
  const normalize = value => process.platform === 'win32'
    ? path.resolve(value).toLowerCase()
    : path.resolve(value);
  return normalize(left) === normalize(right);
}

function filesystemPathKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function classifyCueResolutionError(code) {
  return code === 'cue-missing-reference' || code === 'cue-ambiguous-reference'
    ? 'cue-source-unavailable'
    : 'cue-invalid';
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = createIngressError('selection-stale');
  error.name = 'AbortError';
  throw error;
}

function createIngressError(code, cause = null) {
  const error = new Error('Playback selection could not be opened');
  error.name = 'LocalPlaybackIngressError';
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

module.exports = {
  CUE_COVER_MAX_BYTES,
  CUE_MAX_BYTES,
  LocalPlaybackIngress,
  admitLocalPlaybackPaths,
  captureFileIdentity,
  resolveElectronCueSelection,
  sameFileIdentity
};
