import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const DEFAULT_FIXTURE_SEED = 0x5eed2026;
export const DEFAULT_SCALE_SIZE = 10_000;
export const DEFAULT_BATCH_SIZE = 1_000;
export const FOLDER_TREE_FIRST_LEVEL_COUNT = 100_003;
export const SCALE_PRESETS = Object.freeze({
  million: 1_000_000,
  boundary: 5_000_000
});

const GENRES = Object.freeze([
  'Ambient',
  'Classical',
  'Electronic',
  'Jazz',
  'Rock',
  'ポップ',
  '古典'
]);

function requirePositiveInteger(value, name) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
  return number;
}

export function normalizeSeed(value = DEFAULT_FIXTURE_SEED) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 0xffffffff) {
    throw new TypeError('seed must be an unsigned 32-bit integer');
  }
  return number >>> 0;
}

export function resolveScaleSize({
  size,
  preset,
  defaultSize = DEFAULT_SCALE_SIZE
} = {}) {
  if (size !== undefined && preset !== undefined) {
    throw new TypeError('Use either size or preset, not both');
  }
  if (preset !== undefined) {
    if (!Object.hasOwn(SCALE_PRESETS, preset)) {
      throw new TypeError(`Unknown scale preset: ${preset}`);
    }
    return SCALE_PRESETS[preset];
  }
  return requirePositiveInteger(size ?? defaultSize, 'size');
}

function mix32(value) {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

function paddedBase36(value, width) {
  return value.toString(36).padStart(width, '0');
}

export function createCatalogTrack(index, seed = DEFAULT_FIXTURE_SEED) {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new TypeError('index must be a non-negative safe integer');
  }
  const normalizedSeed = normalizeSeed(seed);
  const serial = index + 1;
  const mixed = mix32((index ^ normalizedSeed) >>> 0);
  const artistNumber = mixed % 100_003;
  const albumNumber = Math.floor(index / 12);
  const folderNumber = index % 16;
  const trackNumber = (index % 12) + 1;
  const serialKey = paddedBase36(serial, 8);
  const seedKey = normalizedSeed.toString(16).padStart(8, '0');
  const fileName = `track-${serialKey}.flac`;
  const relativePath = [
    `artist-${paddedBase36(artistNumber, 4)}`,
    `album-${paddedBase36(albumNumber, 6)}`,
    fileName
  ].join('/');

  return {
    trackUid: `track-${seedKey}-${serialKey}`,
    folderId: `folder-${folderNumber.toString().padStart(2, '0')}`,
    relativePath,
    fileName,
    size: 2_000_000 + (mixed % 30_000_000),
    mtimeMs: 1_700_000_000_000 + (index * 1_000),
    title: `Track ${serial} 音楽 ${mixed.toString(16).padStart(8, '0')}`,
    artist: `Artist ${artistNumber}`,
    albumArtist: index % 17 === 0 ? '' : `Artist ${artistNumber}`,
    album: `Album ${albumNumber}`,
    genre: GENRES[mixed % GENRES.length],
    discNumber: 1 + (Math.floor(index / 120) % 2),
    trackNumber,
    durationSec: 60 + (mixed % 600) + ((mixed >>> 20) / 1_000),
    sampleRate: index % 5 === 0 ? 96_000 : 48_000,
    codec: 'FLAC',
    addedAt: 1_700_000_000_000 + index
  };
}

export function createFolderTreeScaleTrack(index, seed = DEFAULT_FIXTURE_SEED) {
  const {
    discNumber,
    trackNumber,
    ...track
  } = createCatalogTrack(index, seed);
  const firstLevel = index % FOLDER_TREE_FIRST_LEVEL_COUNT;
  const cycle = Math.floor(index / FOLDER_TREE_FIRST_LEVEL_COUNT);
  const secondLevel = Math.floor(cycle / 12);
  return {
    ...track,
    discNo: discNumber,
    trackNo: trackNumber,
    folderId: 'folder-tree-scale',
    relativePath: [
      `Directory-${String(firstLevel).padStart(6, '0')}`,
      `Album-${String(secondLevel).padStart(3, '0')}`,
      track.fileName
    ].join('/')
  };
}

export function* catalogBatches({
  count,
  seed = DEFAULT_FIXTURE_SEED,
  batchSize = DEFAULT_BATCH_SIZE,
  startIndex = 0
}) {
  const rowCount = requirePositiveInteger(count, 'count');
  const rowsPerBatch = requirePositiveInteger(batchSize, 'batchSize');
  const normalizedSeed = normalizeSeed(seed);
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    throw new TypeError('startIndex must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(startIndex + rowCount)) {
    throw new TypeError('startIndex + count must be a safe integer');
  }

  for (let offset = 0; offset < rowCount; offset += rowsPerBatch) {
    const currentSize = Math.min(rowsPerBatch, rowCount - offset);
    const batch = new Array(currentSize);
    for (let batchIndex = 0; batchIndex < currentSize; batchIndex += 1) {
      batch[batchIndex] = createCatalogTrack(startIndex + offset + batchIndex, normalizedSeed);
    }
    yield batch;
  }
}

function writeWithBackpressure(stream, chunk) {
  if (stream.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      stream.off('drain', onDrain);
      stream.off('error', onError);
    };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}

export async function writeCatalogNdjson({
  output,
  count,
  seed = DEFAULT_FIXTURE_SEED,
  batchSize = DEFAULT_BATCH_SIZE
}) {
  if (!output || typeof output.write !== 'function') {
    throw new TypeError('output must be a writable stream');
  }
  let written = 0;
  for (const batch of catalogBatches({ count, seed, batchSize })) {
    const payload = `${batch.map(track => JSON.stringify(track)).join('\n')}\n`;
    await writeWithBackpressure(output, payload);
    written += batch.length;
  }
  return written;
}

export async function writeCatalogFile(filePath, options) {
  const output = fs.createWriteStream(filePath, { encoding: 'utf8' });
  try {
    const written = await writeCatalogNdjson({ ...options, output });
    await new Promise((resolve, reject) => {
      output.once('finish', resolve);
      output.once('error', reject);
      output.end();
    });
    return written;
  } catch (error) {
    output.destroy();
    throw error;
  }
}

export function summarizeCatalog({
  count,
  seed = DEFAULT_FIXTURE_SEED,
  batchSize = DEFAULT_BATCH_SIZE
}) {
  const hash = createHash('sha256');
  let processed = 0;
  let maxBatchRows = 0;
  let firstTrackUid = null;
  let lastTrackUid = null;
  for (const batch of catalogBatches({ count, seed, batchSize })) {
    maxBatchRows = Math.max(maxBatchRows, batch.length);
    for (const track of batch) {
      firstTrackUid ??= track.trackUid;
      lastTrackUid = track.trackUid;
      hash.update(JSON.stringify(track));
      hash.update('\n');
      processed += 1;
    }
  }
  return {
    format: 'effetune-library-scale-ndjson-v1',
    seed: normalizeSeed(seed),
    count: processed,
    batchSize: requirePositiveInteger(batchSize, 'batchSize'),
    maxBatchRows,
    firstTrackUid,
    lastTrackUid,
    sha256: hash.digest('hex')
  };
}
