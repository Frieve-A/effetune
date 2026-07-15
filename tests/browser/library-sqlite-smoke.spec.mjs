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
    equal(capabilities.shortSearchMode, 'word-prefix', 'short search mode');
    equal(capabilities.maxRequestBytes, MAX_MESSAGE_BYTES, 'request limit');
    equal(capabilities.maxResponseBytes, MAX_MESSAGE_BYTES, 'response limit');
    equal((await client.request('getCounts')).tracks, 0, 'fresh catalog track count');

    await client.request('upsertFolders', [{
      id: 'folder-web', kind: 'web-fsa', displayName: 'Web Music', status: 'active',
      lifecycleVersion: 1, scanGeneration: 0, addedAt: 1, lastScanAt: null
    }, {
      id: 'folder-offline', kind: 'web-fsa', displayName: 'Offline Music', status: 'offline',
      lifecycleVersion: 2, scanGeneration: 0, addedAt: 2, lastScanAt: null
    }]);
    deepEqual(
      (await client.request('listFolderRecords', { limit: 1000 })).map(folder => folder.id),
      ['folder-offline', 'folder-web'],
      'folder records accept the unfiltered Web catalog request'
    );
    const folderEntities = await client.request('queryEntities', {
      type: 'folder', query: '', sort: 'name', direction: 'asc', limit: 1
    });
    deepEqual(folderEntities.rows[0], {
      id: 'folder-offline', kind: 'web-fsa', path: null, displayName: 'Offline Music',
      status: 'needs-permission', scanGeneration: 0, lifecycleVersion: 2,
      addedAt: 2, lastScanAt: null, trackCount: 0
    }, 'folder entities map internal offline state and hide synthetic paths');
    const folderCursorPage = await client.request('readContextPage', {
      contextToken: folderEntities.contextToken, cursor: folderEntities.nextCursor, limit: 1
    });
    equal(folderCursorPage.rows[0].path, null, 'folder cursor page hides synthetic paths');
    const folderOrdinalPage = await client.request('readContextPageAtOrdinal', {
      contextToken: folderEntities.contextToken, ordinal: 1, limit: 1
    });
    equal(folderOrdinalPage.rows[0].path, null, 'folder ordinal page hides synthetic paths');
    await client.request('releaseContext', folderEntities.contextToken);
    await client.request('upsertTracks', [
      createTrack(1, { trackUid: 'track-alpha', title: 'Alpha Signal', artist: 'Crimson Voyager' }),
      createTrack(2, {
        trackUid: 'track-ab', title: 'AB Intro', artist: 'Quartz',
        relativePath: 'Artist/Zulu/AB Intro.flac'
      }),
      createTrack(3, {
        trackUid: 'track-gamma', title: 'Gamma', genre: 'ロック',
        relativePath: 'Zulu/Alpha/Gamma.flac'
      })
    ]);
    equal((await client.request('getCounts')).tracks, 3, 'track write count');
    deepEqual(await client.request('getScanFolderTrackCount', { folderId: 'folder-web' }), {
      folderId: 'folder-web',
      trackCount: 3
    }, 'scan folder track count');

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
    const stable = (await client.request('readContextPage', {
      contextToken: all.contextToken, cursor: null, limit: 20
    })).rows.find(row => row.trackUid === 'track-alpha');
    equal(stable.title, 'Alpha Signal', 'leased context before-image');
    await client.request('releaseContext', all.contextToken);

    const albums = await client.request('queryEntities', {
      type: 'album', query: 'album', sort: 'name', direction: 'asc', limit: 20
    });
    equal(albums.rows[0].name, 'Album', 'track-derived entity query');
    await client.request('releaseContext', albums.contextToken);

    const subfolders = await client.request('queryEntities', {
      type: 'subfolder', query: '', direction: 'asc', limit: 20
    });
    deepEqual(subfolders.rows.map(row => row.name), ['Album', 'Zulu', 'Alpha'], 'subfolder titles');
    deepEqual(
      subfolders.rows.map(row => row.caption),
      ['Web Music / Album', 'Web Music / Artist/Zulu', 'Web Music / Zulu/Alpha'],
      'subfolder default path order'
    );
    await client.request('releaseContext', subfolders.contextToken);

    const recentTracks = Array.from({ length: 501 }, (_, offset) => {
      const index = offset + 1;
      return createTrack(1000 + index, {
        trackUid: `recent-web-${String(index).padStart(4, '0')}`,
        relativePath: `Recent/Track-${index}.flac`,
        fileIdentity: `recent-file-${index}`,
        fileName: `Recent-${index}.flac`,
        title: `Recent Track ${index}`,
        addedAt: 1000 + index,
        updatedAt: 1000 + index
      });
    });
    await client.request('upsertTracks', recentTracks.slice(0, 500));
    await client.request('upsertTracks', recentTracks.slice(500));
    const recent = await client.request('queryTracks', {
      query: '', sort: 'added', direction: 'desc', scope: { recent: true }, limit: 173
    });
    equal((await client.request('getContextCount', {
      contextToken: recent.contextToken
    })).totalCount, 500, 'recent count is capped at 500');
    const recentRows = [...recent.rows];
    let recentCursor = recent.nextCursor;
    while (recentCursor) {
      const page = await client.request('readContextPage', {
        contextToken: recent.contextToken, cursor: recentCursor, limit: 173
      });
      recentRows.push(...page.rows);
      recentCursor = page.nextCursor;
    }
    equal(recentRows.length, 500, 'recent cursors stay inside the newest-500 set');
    equal(recentRows[0].trackUid, 'recent-web-0501', 'recent newest boundary');
    equal(recentRows.at(-1).trackUid, 'recent-web-0002', 'recent oldest included boundary');
    deepEqual((await client.request('readContextPageAtOrdinal', {
      contextToken: recent.contextToken, ordinal: 499, limit: 1
    })).rows.map(row => row.trackUid), ['recent-web-0002'], 'recent last ordinal');
    equal((await client.request('resolveEntityAnchor', {
      contextToken: recent.contextToken,
      entityId: 'recent-web-0002',
      mode: 'exact',
      limit: 1
    })).ordinal, 499, 'recent anchor ordinal');
    await client.request('releaseContext', recent.contextToken);

    await client.request('createPlaylistWithItems', {
      playlistId: 'playlist-web', name: 'Web Favorites', createdAt: 20,
      items: [{ trackUid: 'track-alpha' }, { trackUid: 'track-ab' }]
    });
    const playlist = await client.request('queryPlaylistItems', { playlistId: 'playlist-web', limit: 20 });
    deepEqual(playlist.items.map(item => item.trackUid), ['track-alpha', 'track-ab'], 'playlist items');

    await client.request('createPlaybackSequence', {
      sequenceId: 'sequence-web', sourceContext: 'contract', catalogVersion: 0,
      seed: 7, createdAt: 30
    });
    await client.request('appendPlaybackSequenceItems', {
      sequenceId: 'sequence-web',
      items: [
        { ordinal: 0, trackUid: 'track-alpha', entryInstanceId: 'entry-1' },
        { ordinal: 1, trackUid: 'track-alpha', entryInstanceId: 'entry-2' }
      ]
    });
    await client.request('sealPlaybackSequence', {
      sequenceId: 'sequence-web', itemCount: 2, currentOrdinal: 0, sealedAt: 31
    });
    const sequence = await client.request('queryPlaybackSequence', {
      sequenceId: 'sequence-web', ordinal: 0, limit: 20
    });
    deepEqual(sequence.items.map(item => item.entryInstanceId), ['entry-1', 'entry-2'], 'playback duplicates');
    deepEqual(sequence.items.map(item => [item.artist, item.title]), [
      ['Crimson Voyager', 'Updated Signal'],
      ['Crimson Voyager', 'Updated Signal']
    ], 'playback display metadata');

    const operationContext = await client.request('createContext', {
      query: '', sort: 'title', direction: 'asc', scope: null
    });
    const operation = await client.request('receiveOperation', {
      clientRequestId: 'contract-operation', requestDigest: 'sha256:contract',
      canonicalRequestVersion: 1, operationKind: 'addToPlaylist', target: { playlistId: 'playlist-web' },
      expectedTargetVersion: 0, sourceContextToken: operationContext.contextToken,
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
    equal((await client.request('getOperationStatus', operation.operationId)).result.state, 'cancelled', 'operation terminal result');

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
      cursor: { lastRelativePath: 'Scan/New.flac', visitedFiles: 1, committedBatches: 1 }
    });
    const candidates = await client.request('listMetadataCandidates', {
      scanId: 'scan-web', folderId: 'folder-web', generation: scan.generation,
      expectedLifecycleVersion: 1, cursor: null, limit: 20, parserVersion: scan.parserVersion
    });
    equal(candidates.items.length, 1, 'scan metadata candidate');
    await client.request('createPlaylistWithItems', {
      playlistId: 'playlist-late-web', name: 'Late Web', createdAt: 21,
      items: [{ unresolved: {
        sourceLine: 'Scan/New.flac', relativePathHint: 'Scan/New.flac',
        basename: 'New.flac', title: 'New', artist: 'Scan Artist', durationSec: 120
      } }]
    });
    const metadataClaim = await client.request('claimMetadataParse', {
      folderId: 'folder-web',
      trackUid: 'track-late-web',
      lifecycleVersion: scan.lifecycleVersion,
      generation: scan.generation,
      relativePath: candidates.items[0].relativePath,
      parserVersion: scan.parserVersion,
      signature: candidates.items[0].observedSignature,
      explicitRescan: false
    });
    await client.request('completeMetadataParseSuccess', {
      claim: metadataClaim.claim,
      metadata: {
        title: 'New', artist: 'Scan Artist', albumArtist: 'Scan Artist',
        album: 'Scan Album', genre: 'Genre', durationSec: 120
      },
      metadataStatus: 'ok',
      clearErrorAndRetryState: true,
      updateLastKnownGood: true,
      updateDerivedData: true
    });
    await client.request('completeScanFolderNoSweep', {
      scanId: 'scan-web', folderId: 'folder-web', generation: scan.generation,
      expectedLifecycleVersion: 1, status: 'completed-no-sweep',
      sweepBlockReason: 'contract-no-sweep'
    });
    let latePlaylist;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      latePlaylist = await client.request('queryPlaylistItems', {
        playlistId: 'playlist-late-web', limit: 20
      });
      if (latePlaylist.items[0].trackUid === 'track-late-web') break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    equal(latePlaylist.items[0].trackUid, 'track-late-web', 'late Web playlist resolution');
    equal(latePlaylist.playlist.version, 1, 'late resolution advances the playlist version');

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
    deepEqual(published.changedScopes, ['artwork'], 'artwork invalidation scope');
    deepEqual(Array.from((await client.request('getCachedArtwork', { trackUid: 'track-alpha' })).bytes), [1, 2, 3, 4], 'artwork cache');

    const duplicateSource = await client.request('getArtworkSource', { trackUid: 'track-ab' });
    const duplicateClaimed = await client.request('claimArtworkSource', { claim: duplicateSource });
    equal((await client.request('preflightArtworkBatch', {
      claim: duplicateClaimed.claim, estimatedRawBytes: 4, estimatedThumbnailBytes: 4,
      cachePolicy: artworkPolicy
    })).ok, true, 'duplicate artwork storage admission');
    const duplicatePublished = await client.request('publishArtwork', {
      claim: duplicateClaimed.claim, expectedSourceClaim: duplicateClaimed.claim, cachePolicy: artworkPolicy,
      thumbnail: { bytes: new Uint8Array([1, 2, 3, 4]), width: 1, height: 1, mimeType: 'image/png' }
    });
    equal(duplicatePublished.committed, true, 'duplicate artwork publish');
    equal(duplicatePublished.artwork.artworkId, published.artwork.artworkId, 'binary-identical artwork shares storage');
    deepEqual(Array.from((await client.request('getCachedArtwork', { trackUid: 'track-ab' })).bytes), [1, 2, 3, 4], 'shared artwork cache');

    const countBeforeFolderDeletion = (await client.request('getCounts')).tracks;
    await client.request('upsertFolders', [{
      id: 'folder-delete-web', kind: 'web-fsa', displayName: 'Delete Test', status: 'active',
      lifecycleVersion: 1, scanGeneration: 0, addedAt: 3, lastScanAt: null
    }]);
    await client.request('upsertTracks', [createTrack(9000, {
      trackUid: 'track-delete-web', folderId: 'folder-delete-web',
      relativePath: 'Delete/Test.flac', fileIdentity: 'delete-web-file',
      fileName: 'Test.flac', size: 128, mtimeMs: 200, title: 'Delete Test'
    })]);
    const deletionSource = await client.request('getArtworkSource', { trackUid: 'track-delete-web' });
    const deletionClaimed = await client.request('claimArtworkSource', { claim: deletionSource });
    equal((await client.request('preflightArtworkBatch', {
      claim: deletionClaimed.claim, estimatedRawBytes: 4, estimatedThumbnailBytes: 4,
      cachePolicy: artworkPolicy
    })).ok, true, 'folder deletion artwork storage admission');
    equal((await client.request('publishArtwork', {
      claim: deletionClaimed.claim, expectedSourceClaim: deletionClaimed.claim, cachePolicy: artworkPolicy,
      thumbnail: { bytes: new Uint8Array([9, 8, 7, 6]), width: 1, height: 1, mimeType: 'image/png' }
    })).committed, true, 'folder deletion artwork publish');
    let deletion = await client.request('removeScanFolder', {
      folderId: 'folder-delete-web', expectedLifecycleVersion: 1
    });
    for (let chunk = 0; deletion.hasMore && chunk < 10; chunk += 1) {
      deletion = await client.request('removeScanFolder', {
        folderId: 'folder-delete-web', expectedLifecycleVersion: 1
      });
    }
    equal(deletion.hasMore, false, 'folder deletion completion');
    equal(await client.request('getTrack', 'track-delete-web'), null, 'folder deletion removes artwork-backed track');
    equal((await client.request('getCounts')).tracks, countBeforeFolderDeletion, 'folder deletion restores track count');
    equal((await client.request('checkIntegrity')).ok, true, 'folder deletion SQLite integrity');

    const integrity = await client.request('checkIntegrity');
    equal(integrity.ok, true, 'SQLite integrity');
    messageEvidence.push(readMessageEvidence(client));

    await client.close();
    client = new CatalogClient();
    await openWithRetry(client);
    equal((await client.request('getCounts')).tracks, 505, 'graceful reopen persistence');
    let sessionSequenceMissing = false;
    try {
      await client.request('queryPlaybackSequence', {
        sequenceId: 'sequence-web', ordinal: 0, limit: 1
      });
    } catch (error) {
      sessionSequenceMissing = error?.code === 'sequenceNotFound';
    }
    truthy(sessionSequenceMissing, 'playback sequence is scoped to one SQLite session');
    messageEvidence.push(readMessageEvidence(client));

    client.terminate();
    client = new CatalogClient();
    await openWithRetry(client);
    equal((await client.request('getCounts')).tracks, 505, 'Worker restart persistence');
    equal((await client.request('checkIntegrity')).ok, true, 'integrity after Worker restart');
    messageEvidence.push(readMessageEvidence(client));

    const maximumRequestBytes = Math.max(...messageEvidence.map(item => item.maximumRequestBytes));
    const maximumResponseBytes = Math.max(...messageEvidence.map(item => item.maximumResponseBytes));
    truthy(maximumRequestBytes <= MAX_MESSAGE_BYTES, 'request envelope stayed within 1 MiB');
    truthy(maximumResponseBytes <= MAX_MESSAGE_BYTES, 'response envelope stayed within 1 MiB');
    return { backend: opened.backend, trackCount: 505, maximumRequestBytes, maximumResponseBytes };
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
