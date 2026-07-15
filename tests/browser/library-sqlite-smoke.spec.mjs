const WORKER_URL = new URL('./library-sqlite-worker.mjs', import.meta.url);
const MAX_MESSAGE_BYTES = 1024 * 1024;
const SCALE_BATCH_ROWS = 1000;
const PAGE_ROWS = 500;
const GIBIBYTE = 1024 ** 3;

class CatalogClient {
  constructor() {
    this.worker = new Worker(WORKER_URL, { type: 'module' });
    this.nextId = 1;
    this.pending = new Map();
    this.maximumRequestBytes = 0;
    this.maximumResponseBytes = 0;
    this.worker.addEventListener('message', event => this.#receive(event.data));
    this.worker.addEventListener('error', event => this.#failAll(event.error ?? new Error(event.message)));
  }

  request(method, ...args) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, args });
    });
  }

  async close() {
    if (!this.worker) return;
    try {
      await this.request('close');
    } finally {
      this.terminate();
    }
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.#failAll(new Error('Catalog test Worker terminated'));
  }

  #receive(response) {
    this.maximumRequestBytes = Math.max(this.maximumRequestBytes, Number(response.requestBytes ?? 0));
    this.maximumResponseBytes = Math.max(this.maximumResponseBytes, Number(response.responseBytes ?? 0));
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok) pending.resolve(response.result);
    else pending.reject(Object.assign(new Error(response.error?.message), response.error));
  }

  #failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

export async function runLibrarySqliteContract() {
  let client = new CatalogClient();
  const messageEvidence = [];
  try {
    const opened = await client.request('open', { clearOnInit: true });
    equal(opened.backend, 'sqlite-wasm-opfs-sahpool', 'Web catalog backend');
    const capabilities = await client.request('getCapabilities');
    equal(capabilities.productionQualified, true, 'production-qualified capability');
    equal(capabilities.shortSearchMode, 'word-prefix', 'short search mode');
    equal(capabilities.maxRequestBytes, MAX_MESSAGE_BYTES, 'request limit');
    equal(capabilities.maxResponseBytes, MAX_MESSAGE_BYTES, 'response limit');
    equal((await client.request('getCounts')).tracks, 0, 'fresh catalog track count');

    await client.request('upsertFolders', [{
      id: 'folder-web', kind: 'web-fsa', displayName: 'Web Music', status: 'active',
      lifecycleVersion: 1, scanGeneration: 0, addedAt: 1, lastScanAt: null
    }]);
    await client.request('upsertTracks', [
      createTrack(1, { trackUid: 'track-alpha', title: 'Alpha Signal', artist: 'Crimson Voyager' }),
      createTrack(2, { trackUid: 'track-ab', title: 'AB Intro', artist: 'Quartz' }),
      createTrack(3, { trackUid: 'track-gamma', title: 'Gamma', genre: 'ロック' })
    ]);
    equal((await client.request('getCounts')).tracks, 3, 'track write count');

    const all = await client.request('queryTracks', { query: '', sort: 'title', direction: 'asc', limit: 2 });
    deepEqual(all.rows.map(row => row.trackUid), ['track-ab', 'track-alpha'], 'canonical first page');
    const allCount = await client.request('getContextCount', { contextToken: all.contextToken });
    equal(allCount.totalCount, 3, 'context count');
    const end = await client.request('readContextPageAtOrdinal', {
      contextToken: all.contextToken, ordinal: 2, limit: 2
    });
    deepEqual(end.rows.map(row => row.trackUid), ['track-alpha', 'track-gamma'], 'ordinal page');

    for (const [query, expected] of [
      ['a', ['track-ab', 'track-alpha', 'track-gamma']],
      ['ab', ['track-ab']],
      ['mm', []],
      ['mma', ['track-gamma']],
      ['pha', ['track-alpha']],
      ['imson yage', ['track-alpha']],
      ['ﾛｯ', ['track-gamma']]
    ]) {
      const page = await client.request('queryTracks', { query, sort: 'title', direction: 'asc', limit: 20 });
      deepEqual(page.rows.map(row => row.trackUid), expected, `search query ${query}`);
      await client.request('releaseContext', page.contextToken);
    }

    await client.request('upsertTracks', [createTrack(1, {
      trackUid: 'track-alpha', title: 'Updated Signal', artist: 'Crimson Voyager'
    })]);
    const stable = await client.request('lookupContextTrack', {
      contextToken: all.contextToken, trackUid: 'track-alpha'
    });
    equal(stable.title, 'Alpha Signal', 'leased context before-image');
    await client.request('releaseContext', all.contextToken);

    await client.request('upsertEntities', 'album', [{
      albumKey: 'album:test', identityVersion: 1, name: 'Test Album', artist: 'Test Artist',
      trackCount: 3, totalDurationSec: 363, representativeArtworkId: null
    }]);
    const albums = await client.request('queryEntities', {
      type: 'album', query: 'test', sort: 'name', direction: 'asc', limit: 20
    });
    equal(albums.rows[0].albumKey, 'album:test', 'entity query');
    await client.request('releaseContext', albums.contextToken);

    await client.request('createPlaylistWithItems', {
      playlistId: 'playlist-web', name: 'Web Favorites', createdAt: 20,
      items: [{ trackUid: 'track-alpha' }, { trackUid: 'track-ab' }]
    });
    const playlist = await client.request('queryPlaylistItems', { playlistId: 'playlist-web', limit: 20 });
    deepEqual(playlist.items.map(item => item.trackUid), ['track-alpha', 'track-ab'], 'playlist items');

    await client.request('createPlaybackSequence', {
      sequenceId: 'sequence-web', sourceContext: 'contract', catalogVersion: 0,
      seed: 7, snapshotId: null, createdAt: 30
    });
    await client.request('appendPlaybackSequenceItems', {
      sequenceId: 'sequence-web',
      items: [
        { trackUid: 'track-alpha', entryInstanceId: 'entry-1' },
        { trackUid: 'track-alpha', entryInstanceId: 'entry-2' }
      ]
    });
    await client.request('sealPlaybackSequence', {
      sequenceId: 'sequence-web', itemCount: 2, currentOrdinal: 0, sealedAt: 31
    });
    await client.request('publishPlaybackSequence', { sequenceId: 'sequence-web', finishedAt: 32 });
    const sequence = await client.request('queryPlaybackSequence', {
      sequenceId: 'sequence-web', ordinal: 0, limit: 20
    });
    deepEqual(sequence.items.map(item => item.entryInstanceId), ['entry-1', 'entry-2'], 'playback duplicates');

    const operationContext = await client.request('createContext', {
      query: '', sort: 'title', direction: 'asc', scope: null
    });
    const operation = await client.request('receiveOperation', {
      clientRequestId: 'contract-operation', requestDigest: 'sha256:contract',
      canonicalRequestVersion: 1, operationKind: 'queue', target: { transport: 'main' },
      expectedTargetVersion: null, sourceContextToken: operationContext.contextToken,
      sourceSequenceIds: [], sourceSequenceItemCount: 0,
      buildDeadlineAt: Date.now() + 60_000, receivedAt: Date.now()
    });
    equal(operation.kind, 'created', 'operation receive');
    deepEqual(await client.request('releaseContext', operationContext.contextToken), {
      released: true, retained: true
    }, 'operation retains context');
    await client.request('transitionOperation', operation.operationId, 'SNAPSHOTTING', { updatedAt: Date.now() });
    await client.request('recordOperationProgress', operation.operationId, {
      operationId: operation.operationId, sequence: 1, phase: 'snapshot',
      processed: 1, total: 3, state: 'running', updatedAt: Date.now()
    });
    await client.request('completeOperation', operation.operationId, {
      state: 'cancelled', code: 'contract-complete', finishedAt: Date.now()
    });
    equal((await client.request('lookupOperationResult', 'contract-operation')).kind, 'terminal', 'operation terminal result');

    const scan = await client.request('beginScanFolder', {
      scanId: 'scan-web', folderId: 'folder-web', normalizedRoot: 'fsa:folder-web',
      expectedLifecycleVersion: 1, resume: false, rootEnumerationRequired: true,
      continuityBroken: false, sweepEligibility: 'INELIGIBLE'
    });
    const admission = await client.request('preflightScanBatch', {
      scanId: 'scan-web', folderId: 'folder-web', generation: scan.generation,
      expectedLifecycleVersion: 1, estimatedTrackCount: 1, estimatedBatchBytes: 1024,
      initial: true
    });
    equal(admission.ok, true, 'scan storage admission');
    await client.request('commitScanSeenBatch', {
      scanId: 'scan-web', folderId: 'folder-web', generation: scan.generation,
      expectedLifecycleVersion: 1,
      observations: [{ relativePath: 'Scan/New.flac', path: null, fileIdentity: 'scan-file', size: 99, mtimeMs: 42 }],
      maxTracks: 500, maxBytes: 512 * 1024, lastCommittedBatch: 1,
      cursor: { visitedFiles: 1 }
    });
    const candidates = await client.request('listMetadataCandidates', {
      scanId: 'scan-web', folderId: 'folder-web', generation: scan.generation,
      expectedLifecycleVersion: 1, cursor: null, limit: 20, parserVersion: scan.parserVersion
    });
    equal(candidates.items.length, 1, 'scan metadata candidate');
    await client.request('pauseScanFolder', {
      scanId: 'scan-web', folderId: 'folder-web', generation: scan.generation,
      expectedLifecycleVersion: 1, stopReason: 'contract', sweepBlockReason: 'contract'
    });

    const source = await client.request('getArtworkSource', { trackUid: 'track-alpha' });
    const claimed = await client.request('claimArtworkSource', { claim: source });
    truthy(claimed.claim?.claimId, 'artwork claim');
    const artworkPolicy = { mode: 'persistent', maxBytes: 1024 * 1024 };
    equal((await client.request('preflightArtworkBatch', {
      claim: claimed.claim, estimatedRawBytes: 4, estimatedThumbnailBytes: 4,
      cachePolicy: artworkPolicy
    })).ok, true, 'artwork storage admission');
    const published = await client.request('publishArtwork', {
      claim: claimed.claim, expectedSourceClaim: claimed.claim, cachePolicy: artworkPolicy,
      thumbnail: { bytes: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1, mimeType: 'image/png' }
    });
    equal(published.committed, true, 'artwork publish');
    deepEqual(Array.from((await client.request('getCachedArtwork', { trackUid: 'track-alpha' })).bytes), [1, 2, 3, 4], 'artwork cache');

    const integrity = await client.request('checkIntegrity');
    equal(integrity.ok, true, 'SQLite integrity');
    messageEvidence.push(readMessageEvidence(client));

    await client.close();
    client = new CatalogClient();
    await openWithRetry(client);
    equal((await client.request('getCounts')).tracks, 3, 'graceful reopen persistence');
    messageEvidence.push(readMessageEvidence(client));

    client.terminate();
    client = new CatalogClient();
    await openWithRetry(client);
    equal((await client.request('getCounts')).tracks, 3, 'Worker restart persistence');
    equal((await client.request('checkIntegrity')).ok, true, 'integrity after Worker restart');
    messageEvidence.push(readMessageEvidence(client));

    const maximumRequestBytes = Math.max(...messageEvidence.map(item => item.maximumRequestBytes));
    const maximumResponseBytes = Math.max(...messageEvidence.map(item => item.maximumResponseBytes));
    truthy(maximumRequestBytes <= MAX_MESSAGE_BYTES, 'request envelope stayed within 1 MiB');
    truthy(maximumResponseBytes <= MAX_MESSAGE_BYTES, 'response envelope stayed within 1 MiB');
    return { backend: opened.backend, trackCount: 3, maximumRequestBytes, maximumResponseBytes };
  } finally {
    await client?.close().catch(() => client?.terminate());
  }
}

export async function runLibrarySqliteScale({ size = 1_000_000 } = {}) {
  assert(Number.isSafeInteger(size) && size > 0, 'Scale size must be a positive integer');
  let client = new CatalogClient();
  const messageEvidence = [];
  try {
    await client.request('open', { clearOnInit: true });
    await client.request('upsertFolders', [{
      id: 'scale-folder', kind: 'web-fsa', displayName: 'Scale Music', status: 'active',
      lifecycleVersion: 1, scanGeneration: 0, addedAt: 1, lastScanAt: null
    }]);
    const insertionStartedAt = performance.now();
    let previousProgressAt = insertionStartedAt;
    for (let offset = 0; offset < size; offset += SCALE_BATCH_ROWS) {
      const count = Math.min(SCALE_BATCH_ROWS, size - offset);
      const tracks = Array.from({ length: count }, (_unused, index) => createScaleTrack(offset + index));
      await client.request('upsertTracks', tracks);
      const inserted = Math.min(size, offset + count);
      if ((offset / SCALE_BATCH_ROWS) % 100 === 0 || inserted === size) {
        const now = performance.now();
        console.log(`Web SQLite scale inserted ${inserted.toLocaleString()} / ${size.toLocaleString()}` +
          ` in ${((now - insertionStartedAt) / 1000).toFixed(1)}s` +
          ` (+${((now - previousProgressAt) / 1000).toFixed(1)}s)`);
        previousProgressAt = now;
      }
    }
    const insertionMs = performance.now() - insertionStartedAt;
    equal((await client.request('getCounts')).tracks, size, 'million-row count');

    const firstRowSamples = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      const page = await client.request('queryTracks', { query: '', sort: 'title', direction: 'asc', limit: PAGE_ROWS });
      firstRowSamples.push(performance.now() - started);
      equal(page.rows[0].trackUid, 'scale-0000000', 'first ordered row');
      await client.request('releaseContext', page.contextToken);
    }

    const context = await client.request('createContext', { query: '', sort: 'title', direction: 'asc', scope: null });
    equal((await client.request('getContextCount', { contextToken: context.contextToken })).totalCount, size, 'scale context count');
    const normalPageSamples = [];
    for (let ordinal = 0; ordinal < Math.min(size, PAGE_ROWS * 20); ordinal += PAGE_ROWS) {
      const started = performance.now();
      await client.request('readContextPageAtOrdinal', { contextToken: context.contextToken, ordinal, limit: PAGE_ROWS });
      normalPageSamples.push(performance.now() - started);
    }
    const middleOrdinal = Math.floor(size / 2 / PAGE_ROWS) * PAGE_ROWS;
    const endOrdinal = Math.max(0, size - PAGE_ROWS);
    const [first, middle, end] = await Promise.all([
      client.request('readContextPageAtOrdinal', { contextToken: context.contextToken, ordinal: 0, limit: PAGE_ROWS }),
      client.request('readContextPageAtOrdinal', { contextToken: context.contextToken, ordinal: middleOrdinal, limit: PAGE_ROWS }),
      client.request('readContextPageAtOrdinal', { contextToken: context.contextToken, ordinal: endOrdinal, limit: PAGE_ROWS })
    ]);
    equal(first.rows[0].trackUid, scaleUid(0), 'scale first page');
    equal(middle.rows[0].trackUid, scaleUid(middleOrdinal), 'scale middle page');
    equal(end.rows.at(-1).trackUid, scaleUid(size - 1), 'scale end page');

    const searchSamples = [];
    for (let index = 0; index < 21; index += 1) {
      const query = ['needle', 'qx', 'q'][index % 3];
      const started = performance.now();
      const page = await client.request('queryTracks', { query, sort: 'title', direction: 'asc', limit: PAGE_ROWS });
      searchSamples.push(performance.now() - started);
      truthy(page.rows.length > 0, `scale search result for ${query}`);
      await client.request('releaseContext', page.contextToken);
    }

    const digestBefore = digestPages(first, middle, end);
    await client.request('releaseContext', context.contextToken);
    const runtimeBeforeReopen = await client.request('getRuntimeDiagnostics');
    const rendererMemoryBeforeReopen = readRendererMemory();
    messageEvidence.push(readMessageEvidence(client));
    await client.close();

    client = new CatalogClient();
    await openWithRetry(client);
    equal((await client.request('getCounts')).tracks, size, 'scale reopen count');
    const reopened = await client.request('createContext', { query: '', sort: 'title', direction: 'asc', scope: null });
    const [reopenedFirst, reopenedMiddle, reopenedEnd] = await Promise.all([
      client.request('readContextPageAtOrdinal', { contextToken: reopened.contextToken, ordinal: 0, limit: PAGE_ROWS }),
      client.request('readContextPageAtOrdinal', { contextToken: reopened.contextToken, ordinal: middleOrdinal, limit: PAGE_ROWS }),
      client.request('readContextPageAtOrdinal', { contextToken: reopened.contextToken, ordinal: endOrdinal, limit: PAGE_ROWS })
    ]);
    equal(reopenedFirst.rows[0].trackUid, scaleUid(0), 'reopened scale first page');
    equal(reopenedMiddle.rows[0].trackUid, scaleUid(middleOrdinal), 'reopened scale middle page');
    equal(reopenedEnd.rows.at(-1).trackUid, scaleUid(size - 1), 'reopened scale end page');
    const digestAfter = digestPages(reopenedFirst, reopenedMiddle, reopenedEnd);
    equal(digestAfter, digestBefore, 'scale order digest after reopen');
    await client.request('releaseContext', reopened.contextToken);
    const runtimeAfterReopen = await client.request('getRuntimeDiagnostics');
    const rendererMemoryAfterReopen = readRendererMemory();
    await globalThis.__librarySqliteFinishWorkloadMemory?.();
    const integrity = await client.request('checkIntegrity', { includeStorageBreakdown: true });
    equal(integrity.ok, true, 'scale SQLite integrity');
    messageEvidence.push(readMessageEvidence(client));
    const storage = await navigator.storage.estimate();
    const opfsUsageBytes = Number(storage.usageDetails?.fileSystem ?? storage.usage);

    const metrics = {
      insertionMs,
      firstRowP95Ms: percentile95(firstRowSamples),
      normalPageP95Ms: percentile95(normalPageSamples),
      searchP95Ms: percentile95(searchSamples),
      opfsUsageBytes,
      storageQuotaBytes: Number(storage.quota),
      storageBreakdown: integrity.storageBreakdown,
      wasmMemoryBytes: Math.max(runtimeBeforeReopen.wasmMemoryBytes, runtimeAfterReopen.wasmMemoryBytes),
      rendererJsHeapBytes: Math.max(rendererMemoryBeforeReopen, rendererMemoryAfterReopen)
    };
    console.log(`Web SQLite scale metrics ${JSON.stringify(metrics)}`);
    assert(metrics.insertionMs < 30 * 60 * 1000, `Insertion took ${(metrics.insertionMs / 60_000).toFixed(1)} minutes; limit is 30 minutes`);
    assert(metrics.opfsUsageBytes < 2 * GIBIBYTE, `OPFS usage ${(metrics.opfsUsageBytes / GIBIBYTE).toFixed(2)} GiB must be below 2 GiB`);
    assert(metrics.firstRowP95Ms < 500, `Initial-row p95 ${metrics.firstRowP95Ms.toFixed(1)} ms must be below 500 ms`);
    assert(metrics.normalPageP95Ms < 150, `Normal-page p95 ${metrics.normalPageP95Ms.toFixed(1)} ms must be below 150 ms`);
    assert(metrics.searchP95Ms < 350, `Search p95 ${metrics.searchP95Ms.toFixed(1)} ms must be below 350 ms`);
    const maximumRequestBytes = Math.max(...messageEvidence.map(item => item.maximumRequestBytes));
    const maximumResponseBytes = Math.max(...messageEvidence.map(item => item.maximumResponseBytes));
    assert(maximumRequestBytes <= MAX_MESSAGE_BYTES, 'Scale request envelope exceeded 1 MiB');
    assert(maximumResponseBytes <= MAX_MESSAGE_BYTES, 'Scale response envelope exceeded 1 MiB');
    return { size, digest: digestAfter, maximumRequestBytes, maximumResponseBytes, metrics };
  } finally {
    await client?.close().catch(() => client?.terminate());
  }
}

function createTrack(index, overrides = {}) {
  return {
    trackUid: `track-${index}`, folderId: 'folder-web', relativePath: `Album/Track-${index}.flac`,
    fileIdentity: `file-${index}`, fileName: `Track-${index}.flac`, size: 123 + index,
    mtimeMs: 1000 + index, title: `Track ${index}`, artist: 'Artist', albumArtist: 'Artist',
    album: 'Album', genre: 'Genre', trackNo: index, durationSec: 120 + index,
    addedAt: index, updatedAt: index, ...overrides
  };
}

function createScaleTrack(index) {
  const uid = scaleUid(index);
  const sortKey = String(index).padStart(7, '0');
  const artistKey = String(index % 25_000).padStart(5, '0');
  const albumKey = String(Math.floor(index / 12) % 100_000).padStart(6, '0');
  const artist = `Horizon Artist ${artistKey}`;
  const album = `Night Session ${albumKey}`;
  const marker = index % 10_000 === 0 ? ' Needle Qx' : '';
  const title = `${sortKey} Midnight Signal${marker}`;
  const fileName = `${title} - ${artist}.flac`;
  return {
    trackUid: uid, folderId: 'scale-folder',
    relativePath: `Music/${artist}/${album}/Disc ${(index % 3) + 1}/${fileName}`,
    fileIdentity: `volume-main:${uid}`, fileName, size: 8_000_000 + (index % 12_000_000), mtimeMs: index,
    title, artist, albumArtist: artist, album,
    genre: ['Ambient', 'Classical', 'Electronic', 'Jazz', 'Rock'][index % 5],
    year: 1980 + (index % 47), discNo: (index % 3) + 1, trackNo: (index % 12) + 1,
    durationSec: 150 + (index % 360), sampleRate: 44_100, bitrate: 900_000,
    bitsPerSample: 16, channels: 2, codec: 'FLAC',
    addedAt: index, updatedAt: index
  };
}

function scaleUid(index) {
  return `scale-${String(index).padStart(7, '0')}`;
}

function digestPages(...pages) {
  let hash = 0xcbf29ce484222325n;
  for (const page of pages) {
    for (const row of page.rows) {
      for (const character of row.trackUid) {
        hash ^= BigInt(character.codePointAt(0));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
      }
      hash ^= 10n;
      hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
  }
  return hash.toString(16).padStart(16, '0');
}

function readRendererMemory() {
  return Number(performance.memory?.usedJSHeapSize ?? 0);
}

async function openWithRetry(client) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await client.request('open', { clearOnInit: false });
    } catch (error) {
      lastError = error;
      if (error?.code !== 'concurrentUseUnsupported') throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  throw lastError;
}

function readMessageEvidence(client) {
  return {
    maximumRequestBytes: client.maximumRequestBytes,
    maximumResponseBytes: client.maximumResponseBytes
  };
}

function percentile95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function equal(actual, expected, label) {
  if (!Object.is(actual, expected)) throw new Error(`${label}: expected ${String(expected)}, got ${String(actual)}`);
}

function deepEqual(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function truthy(value, label) {
  if (!value) throw new Error(`${label}: expected a truthy value`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
