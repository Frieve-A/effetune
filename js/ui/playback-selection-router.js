import {
  CUE_MAX_BYTES,
  createCueTrackMetadata,
  decodeCueBytes,
  parseCueSheet,
  resolveCueSheet,
  validateCueDurations
} from '../library/metadata/cue-sheet.js';
import { cueCoverMimeType, selectCueCoverFileName } from '../library/metadata/cue-cover.js';
import { WebMetadataParser } from '../library/scan/web-metadata-parser.js';

const CUE_AUDIO_EXTENSIONS = new Set(['flac', 'wav']);
const CUE_COVER_EXTENSIONS = new Set(['jpg', 'png']);
const CUE_COVER_MAX_BYTES = 20 * 1024 * 1024;
let requestSequence = 0;

export async function resolveWebPlaybackSelection(files, {
  metadataParserFactory = filesystem => new WebMetadataParser({ filesystem }),
  signal,
  requestKey = `direct-web:${++requestSequence}`
} = {}) {
  const selectedFiles = requireFiles(files);
  const cueFiles = selectedFiles.filter(file => extensionOf(file.name) === 'cue');
  if (cueFiles.length === 0) return Object.freeze({ kind: 'normal', tracks: selectedFiles });
  if (cueFiles.length !== 1) throw selectionError('cueSelectionMixed');

  const remainingFiles = selectedFiles.filter(file => file !== cueFiles[0]);
  const sourceFiles = remainingFiles.filter(file => CUE_AUDIO_EXTENSIONS.has(extensionOf(file.name)));
  const coverFiles = remainingFiles.filter(file => CUE_COVER_EXTENSIONS.has(extensionOf(file.name)));
  if (sourceFiles.length === 0) throw selectionError('cueSelectionInvalid');
  if (sourceFiles.length + coverFiles.length !== remainingFiles.length) {
    throw selectionError('cueSelectionMixed');
  }
  const cueFile = cueFiles[0];
  if (!Number.isSafeInteger(cueFile.size) || cueFile.size < 0 || cueFile.size > CUE_MAX_BYTES) {
    throw selectionError(cueFile.size > CUE_MAX_BYTES ? 'cueSelectionTooLarge' : 'cueSelectionInvalid');
  }

  throwIfAborted(signal);
  let parsed;
  try {
    const decoded = decodeCueBytes(await cueFile.arrayBuffer());
    if (!decoded?.ok) throw selectionError('cueSelectionInvalid');
    parsed = parseCueSheet(decoded.text, {
      cueRelativePath: cueFile.name
    });
  } catch (error) {
    throw selectionError('cueSelectionInvalid', error);
  }
  throwIfAborted(signal);
  if (!parsed?.ok) throw selectionError('cueSelectionInvalid');

  const fileByName = createSelectedFileMap(sourceFiles);
  const resolved = resolveCueSheet(parsed, sourceFiles.map(file => file.name));
  if (!resolved?.ok) throw selectionError('cueSelectionInvalid');
  const referencedNames = new Set(resolved.resolvedFiles);
  if (referencedNames.size !== sourceFiles.length ||
      sourceFiles.some(file => !referencedNames.has(file.name))) {
    throw selectionError('cueSelectionMixed');
  }
  const coverByName = createSelectedFileMap(coverFiles);
  const allowedCoverNames = new Set(resolved.resolvedFiles.flatMap(relativePath =>
    coverFiles.flatMap(file => selectCueCoverFileName([file.name], relativePath) ? [file.name] : [])
  ));
  if (coverFiles.some(file => !allowedCoverNames.has(file.name))) {
    throw selectionError('cueSelectionMixed');
  }
  const coverByRelativePath = new Map();
  const coverPromises = new Map();
  for (const relativePath of resolved.resolvedFiles) {
    const coverName = selectCueCoverFileName(coverByName.keys(), relativePath);
    if (!coverName) continue;
    let coverPromise = coverPromises.get(coverName);
    if (!coverPromise) {
      coverPromise = readSelectedCueCover(coverByName.get(coverName), signal);
      coverPromises.set(coverName, coverPromise);
    }
    const picture = await coverPromise;
    if (picture) coverByRelativePath.set(relativePath, picture);
  }

  const filesystem = {
    async getFile(relativePath, requestSignal) {
      throwIfAborted(requestSignal ?? signal);
      const file = fileByName.get(relativePath);
      if (!file) throw selectionError('cueSelectionInvalid');
      return file;
    }
  };
  const metadataParser = metadataParserFactory(filesystem);
  const metadataByPath = new Map();
  for (const relativePath of resolved.resolvedFiles) {
    throwIfAborted(signal);
    metadataByPath.set(relativePath, await metadataParser.parse({
      relativePath,
      skipCovers: true,
      signal
    }));
  }
  const validated = validateCueDurations(resolved, metadataByPath);
  if (!validated?.ok) throw selectionError('cueSelectionInvalid');

  const physicalKeyByFile = new Map();
  return Object.freeze({
    kind: 'cue',
    tracks: Object.freeze(validated.tracks.map(track => {
      const file = fileByName.get(track.relativePath);
      let physicalSourceKey = physicalKeyByFile.get(file);
      if (!physicalSourceKey) {
        physicalSourceKey = `${requestKey}:${physicalKeyByFile.size}`;
        physicalKeyByFile.set(file, physicalSourceKey);
      }
      const cueMetadata = createCueTrackMetadata(validated, track, metadataByPath.get(track.relativePath));
      const picture = coverByRelativePath.get(track.relativePath) ?? null;
      const meta = picture ? Object.freeze({ ...cueMetadata, picture }) : cueMetadata;
      return Object.freeze({
        file,
        byteLength: file.size,
        name: meta.artist && meta.title ? `${meta.artist} - ${meta.title}` : meta.title,
        meta,
        startFrame: track.startFrame,
        endFrame: track.endFrame,
        durationSec: track.durationSec,
        physicalSourceKey
      });
    }))
  });
}

async function readSelectedCueCover(file, signal) {
  if (!Number.isSafeInteger(file?.size) || file.size <= 0 || file.size > CUE_COVER_MAX_BYTES) return null;
  try {
    throwIfAborted(signal);
    const bytes = new Uint8Array(await file.arrayBuffer());
    throwIfAborted(signal);
    if (bytes.byteLength !== file.size) return null;
    return Object.freeze({ data: bytes, format: cueCoverMimeType(file.name) });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.code === 'selectionStale') throw error;
    return null;
  }
}

function createSelectedFileMap(files) {
  const map = new Map();
  for (const file of files) {
    if (map.has(file.name)) throw selectionError('cueSelectionInvalid');
    map.set(file.name, file);
  }
  return map;
}

function requireFiles(value) {
  const files = Array.from(value ?? []);
  if (files.length === 0 || files.length > 10_000 ||
      files.some(file => !file || typeof file.name !== 'string' || typeof file.arrayBuffer !== 'function')) {
    throw selectionError('musicSelectionUnavailable');
  }
  return files;
}

function extensionOf(name) {
  const index = String(name).lastIndexOf('.');
  return index < 0 ? '' : String(name).slice(index + 1).toLowerCase();
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  const error = selectionError('selectionStale');
  error.name = 'AbortError';
  throw error;
}

function selectionError(code, cause = null) {
  const error = new Error('The selected music could not be opened');
  error.name = 'PlaybackSelectionError';
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}
