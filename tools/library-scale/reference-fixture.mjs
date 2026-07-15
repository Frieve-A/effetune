export const REFERENCE_FIXTURE_COUNT = 1_000_000;
export const REFERENCE_FIXTURE_SEED = 0x5eed2026;
export const REFERENCE_FIXTURE_BATCH_SIZE = 500;
export const REFERENCE_FIXTURE_MAX_COUNT = 1_000_000;

function mix32(value) {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

export function createReferenceTrack(index, seed = REFERENCE_FIXTURE_SEED) {
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('index must be a non-negative integer');
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new TypeError('seed must be an unsigned 32-bit integer');
  }
  const serial = index + 1;
  const key = String(index).padStart(7, '0');
  const mixed = mix32((index ^ seed) >>> 0);
  const artist = mixed % 100_003;
  const album = Math.floor(index / 12);
  return {
    trackUid: `reference-${seed.toString(16).padStart(8, '0')}-${key}`,
    folderId: 'reference-folder',
    relativePath: `Artist-${artist}/Album-${album}/Track-${key}.flac`,
    fileName: `Track-${key}.flac`,
    title: index % 997 === 0 ? `Needle ${key}` : `Track ${key}`,
    artist: `Artist ${artist}`,
    albumArtist: `Artist ${artist}`,
    album: `Album ${album}`,
    genre: ['Ambient', 'Classical', 'Electronic', 'Jazz', 'Rock'][mixed % 5],
    trackNo: (index % 12) + 1,
    durationSec: 60 + (mixed % 600),
    size: 2_000_000 + (mixed % 30_000_000),
    mtimeMs: 1_700_000_000_000 + index * 1_000,
    sampleRate: index % 5 === 0 ? 96_000 : 48_000,
    codec: 'FLAC',
    addedAt: 1_700_000_000_000 + index,
    updatedAt: 1_700_000_000_000 + index
  };
}

export function* referenceTrackBatches({
  count = REFERENCE_FIXTURE_COUNT,
  seed = REFERENCE_FIXTURE_SEED,
  batchSize = REFERENCE_FIXTURE_BATCH_SIZE
} = {}) {
  if (!Number.isSafeInteger(count) || count <= 0) throw new TypeError('count must be a positive integer');
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0 || batchSize > 500) {
    throw new TypeError('batchSize must be between 1 and 500');
  }
  for (let offset = 0; offset < count; offset += batchSize) {
    const length = Math.min(batchSize, count - offset);
    yield Array.from({ length }, (_unused, index) => createReferenceTrack(offset + index, seed));
  }
}

export function createReferenceFixtureLoader(repository) {
  if (!repository || typeof repository.upsertFolders !== 'function' ||
      typeof repository.upsertTracks !== 'function') {
    throw new TypeError('A writable catalog repository is required');
  }
  return async function loadReferenceFixture(options = {}, ...extraArguments) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || extraArguments.length > 0) {
      throw new TypeError('Reference fixture options are invalid');
    }
    const keys = Object.keys(options);
    if (keys.some(key => !['count', 'seed'].includes(key))) {
      throw new TypeError('Reference fixture options are invalid');
    }
    const count = options.count;
    const seed = options.seed;
    if (!Number.isSafeInteger(count) || count <= 0 || count > REFERENCE_FIXTURE_MAX_COUNT) {
      throw new TypeError(`count must be between 1 and ${REFERENCE_FIXTURE_MAX_COUNT}`);
    }
    if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
      throw new TypeError('seed must be an unsigned 32-bit integer');
    }
    await repository.upsertFolders([{
      id: 'reference-folder',
      kind: 'web-fsa',
      displayName: 'Reference Music',
      status: 'active',
      lifecycleVersion: 1,
      scanGeneration: 0,
      addedAt: 1,
      lastScanAt: null
    }]);
    let inserted = 0;
    for (const batch of referenceTrackBatches({ count, seed })) {
      await repository.upsertTracks(batch);
      inserted += batch.length;
    }
    return Object.freeze({ folders: 1, tracks: inserted });
  };
}
