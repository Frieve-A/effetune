'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');
const { Worker, threadId } = require('node:worker_threads');

const {
  LibraryCatalogHost,
  MAX_LIBRARY_CATALOG_OUTSTANDING_REQUESTS,
  MAX_LIBRARY_CATALOG_REQUEST_BYTES,
  MAX_LIBRARY_CATALOG_RESPONSE_BYTES
} = require('../../electron/library-catalog-host.cjs');

function createTempCatalog(t, { registerCleanup = true } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-catalog-'));
  if (registerCleanup) {
    t.after(() => fs.promises.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    }));
  }
  return {
    directory,
    dbPath: path.join(directory, 'catalog.sqlite')
  };
}

async function openCatalog(t, options = {}) {
  const fixture = createTempCatalog(t, { registerCleanup: false });
  const host = await LibraryCatalogHost.open({ dbPath: fixture.dbPath, ...options });
  t.after(async () => {
    await host.close();
    await fs.promises.rm(fixture.directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100
    });
  });
  return { ...fixture, host };
}

function createTrack(index, overrides = {}) {
  const id = String(index).padStart(6, '0');
  return {
    trackUid: `track_${id}`,
    folderId: 'folder_music',
    relativePath: `Album/Track-${id}.flac`,
    fileName: `Track-${id}.flac`,
    title: `Track ${id}`,
    artist: 'Artist',
    albumArtist: 'Album Artist',
    album: 'Album',
    genre: 'Genre',
    trackNo: index,
    durationSec: 120 + index,
    addedAt: index,
    updatedAt: index,
    ...overrides
  };
}

async function seedFolder(host, directory) {
  return host.upsertFolders([{
    id: 'folder_music',
    kind: 'electron',
    displayName: 'Music',
    path: directory,
    status: 'ok',
    lifecycleVersion: 3
  }]);
}

async function publishTrackArtwork(host, trackUid, utilitySessionId, bytes = new Uint8Array([1, 2, 3, 4])) {
  const source = await host.getArtworkSource({ trackUid });
  let claimed = await host.claimArtworkSource({
    claim: { ...source, utilitySessionId }
  });
  claimed = await host.bindArtworkSourceDetails({
    claim: claimed.claim,
    fileStat: { size: source.size, mtimeMs: source.mtimeMs },
    embeddedOffset: null,
    embeddedLength: bytes.byteLength,
    mimeType: 'image/jpeg'
  });
  const cachePolicy = { mode: 'persistent', maxBytes: 1024 * 1024 };
  const admission = await host.preflightArtworkBatch({
    claim: claimed.claim,
    estimatedRawBytes: bytes.byteLength,
    estimatedThumbnailBytes: bytes.byteLength,
    cachePolicy
  });
  assert.equal(admission.ok, true, JSON.stringify(admission));
  const published = await host.publishArtwork({
    claim: claimed.claim,
    expectedSourceClaim: claimed.claim,
    cachePolicy,
    thumbnail: { bytes, width: 1, height: 1, mimeType: 'image/jpeg' }
  });
  assert.equal(published.committed, true);
  return published.artwork.artworkId;
}

function assertTrackArtworkRemoved(dbPath, trackUid, artworkId) {
  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual({ ...database.prepare(`
      SELECT
        (SELECT count(*) FROM tracks WHERE track_uid = ?) AS trackCount,
        (SELECT count(*) FROM track_artwork_sources WHERE track_uid = ?) AS sourceCount,
        (SELECT count(*) FROM artwork_claims WHERE track_uid = ?) AS claimCount,
        (SELECT ref_count FROM artwork_assets WHERE id = ?) AS refCount
    `).get(trackUid, trackUid, trackUid, artworkId) }, {
      trackCount: 0,
      sourceCount: 0,
      claimCount: 0,
      refCount: 0
    });
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database.close();
  }
}

async function collectForward(host, firstPage, limit) {
  const rows = [...firstPage.rows];
  let cursor = firstPage.nextCursor;
  while (cursor) {
    const page = await host.readContextPage({
      contextToken: firstPage.contextToken,
      cursor,
      limit
    });
    rows.push(...page.rows);
    cursor = page.nextCursor;
  }
  return rows;
}

function assertCode(code) {
  return error => {
    assert.equal(error && error.code, code);
    return true;
  };
}

test('catalog host requires a caller-supplied canonical absolute database path', async () => {
  assert.throws(() => new LibraryCatalogHost(), assertCode('invalidDatabasePath'));
  assert.throws(
    () => new LibraryCatalogHost({ dbPath: path.join('.', 'relative.sqlite') }),
    assertCode('invalidDatabasePath')
  );
  assert.throws(
    () => new LibraryCatalogHost({ dbPath: `${path.resolve('catalog.sqlite')}${path.sep}.` }),
    assertCode('invalidDatabasePath')
  );
});

test('DatabaseSync is isolated in a worker with shared schema, FTS5, WAL, and bounded capabilities', async t => {
  const { host, dbPath } = await openCatalog(t);
  const capabilities = await host.getCapabilities();
  assert.equal(threadId, 0);
  assert.notEqual(capabilities.databaseSyncThreadId, threadId);
  assert.equal(capabilities.databaseSyncInWorker, true);
  assert.equal(capabilities.schemaVersion, 3);
  assert.equal(capabilities.fts5, true);
  assert.equal(capabilities.trigram, true);
  assert.equal(capabilities.shortSearchMode, 'word-prefix');
  assert.equal(capabilities.maxQueryLimit, 500);
  assert.equal(capabilities.maxWriteBatchRows, 1000);
  assert.equal(capabilities.maxRequestBytes, MAX_LIBRARY_CATALOG_REQUEST_BYTES);
  assert.equal(capabilities.maxResponseBytes, MAX_LIBRARY_CATALOG_RESPONSE_BYTES);
  assert.equal(fs.existsSync(dbPath), true);

  const workerSource = fs.readFileSync(path.join(__dirname, '../../electron/library-catalog-worker.cjs'), 'utf8');
  const hostSource = fs.readFileSync(path.join(__dirname, '../../electron/library-catalog-host.cjs'), 'utf8');
  assert.match(workerSource, /DatabaseSync/);
  assert.doesNotMatch(hostSource, /DatabaseSync|node:sqlite/);
});

test('binary-identical artwork thumbnails share one persisted blob across tracks', async t => {
  const directory = fs.mkdtempSync(path.join(process.cwd(), '.effetune-artwork-test-'));
  const dbPath = path.join(directory, 'catalog.sqlite');
  const host = await LibraryCatalogHost.open({ dbPath });
  t.after(async () => {
    await host.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  await seedFolder(host, directory);
  await host.upsertTracks([1, 2].map(index => createTrack(index, {
    fileIdentity: `artwork-file-${index}`,
    size: 100 + index,
    mtimeMs: 200 + index
  })));
  await host.beginArtworkUtilitySession({ utilitySessionId: 'artwork-deduplication-test' });

  const artworkIds = [];
  for (const index of [1, 2]) {
    const trackUid = `track_${String(index).padStart(6, '0')}`;
    artworkIds.push(await publishTrackArtwork(host, trackUid, 'artwork-deduplication-test'));
  }

  assert.equal(artworkIds[0], artworkIds[1]);
  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const assets = database.prepare(`
      SELECT count(*) AS assetCount, COALESCE(sum(ref_count), 0) AS refCount
      FROM artwork_assets
    `).get();
    const variants = database.prepare(`
      SELECT count(*) AS variantCount, COALESCE(sum(byte_length), 0) AS storedBytes
      FROM artwork_variants WHERE variant = 'thumbnail'
    `).get();
    assert.deepEqual(
      { assetCount: Number(assets.assetCount), refCount: Number(assets.refCount) },
      { assetCount: 1, refCount: 2 }
    );
    assert.deepEqual(
      { variantCount: Number(variants.variantCount), storedBytes: Number(variants.storedBytes) },
      { variantCount: 1, storedBytes: 4 }
    );
  } finally {
    database.close();
  }

  const eviction = await host.evictArtworkCache({
    mode: 'persistent',
    maxBytes: 0,
    requiredBytes: 1,
    policy: 'lru-access-time-byte-length'
  });
  assert.deepEqual(eviction, { evictedBytes: 4, cacheBytes: 0 });
  assert.equal(await host.getCachedArtwork('track_000001'), null);
  const evictedDatabase = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual({ ...evictedDatabase.prepare(`
      SELECT
        (SELECT count(*) FROM artwork_assets) AS assetCount,
        (SELECT count(*) FROM artwork_variants) AS variantCount,
        (SELECT count(*) FROM track_artwork_sources) AS sourceCount
    `).get() }, { assetCount: 1, variantCount: 0, sourceCount: 2 });
  } finally {
    evictedDatabase.close();
  }
});

test('scoped title pages use the global title order without a temporary sort', async t => {
  const { dbPath } = await openCatalog(t);
  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    for (const scope of ['album_key', 'artist_key', 'genre_key', 'subfolder_key']) {
      const plan = database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT track_uid FROM tracks
        WHERE ${scope} = ?
        ORDER BY sort_title, track_uid
        LIMIT 10
      `).all('scope-key');
      assert.ok(plan.some(row => String(row.detail).includes('tracks_by_title')), JSON.stringify(plan));
      assert.ok(plan.every(row => !String(row.detail).includes('USE TEMP B-TREE')), JSON.stringify(plan));
    }
  } finally {
    database.close();
  }
});

test('recent scope is a stable newest-500 set across count, cursors, ordinals, and lookup', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const tracks = Array.from({ length: 501 }, (_, index) => createTrack(index + 1));
  await host.upsertTracks(tracks.slice(0, 500));
  await host.upsertTracks(tracks.slice(500));

  const first = await host.queryTracks({
    query: '', sort: 'added', direction: 'desc', scope: { recent: true }, limit: 137
  });
  assert.equal((await host.getContextCount({ contextToken: first.contextToken })).totalCount, 500);
  const rows = await collectForward(host, first, 137);
  assert.equal(rows.length, 500);
  assert.equal(rows[0].trackUid, 'track_000501');
  assert.equal(rows.at(-1).trackUid, 'track_000002');
  assert.equal(new Set(rows.map(row => row.trackUid)).size, 500);

  const last = await host.readContextPageAtOrdinal({
    contextToken: first.contextToken, ordinal: 499, limit: 1
  });
  assert.deepEqual(last.rows.map(row => row.trackUid), ['track_000002']);
  const excluded = await host.resolveEntityAnchor({
    contextToken: first.contextToken,
    entityId: 'track_000001',
    mode: 'exact',
    limit: 1
  });
  assert.equal(excluded.accepted, false);
  const included = await host.resolveEntityAnchor({
    contextToken: first.contextToken,
    entityId: 'track_000002',
    mode: 'exact',
    limit: 1
  });
  assert.equal(included.ordinal, 499);

  await host.upsertTracks([createTrack(502)]);
  const retained = await host.readContextPage({
    contextToken: first.contextToken, cursor: null, limit: 1
  });
  assert.equal(retained.rows[0].trackUid, 'track_000501');
  await host.releaseContext(first.contextToken);

  const refreshed = await host.queryTracks({
    query: '', sort: 'added', direction: 'desc', scope: { recent: true }, limit: 500
  });
  assert.equal(refreshed.rows.length, 500);
  assert.equal(refreshed.rows[0].trackUid, 'track_000502');
  assert.equal(refreshed.rows.at(-1).trackUid, 'track_000003');
  await host.releaseContext(refreshed.contextToken);
});

test('bounded writes advance catalog/scope versions and page rows never expose filesystem paths', async t => {
  const { host, directory } = await openCatalog(t);
  const sourcePath = path.join(directory, 'Album', 'Track.flac');
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, 'audio');

  const invalidations = [];
  host.on('invalidation', event => invalidations.push(event));
  const folderWrite = await seedFolder(host, directory);
  assert.equal(folderWrite.catalogVersion, 1);
  assert.deepEqual(folderWrite.changedScopes, ['folders']);
  const trackWrite = await host.upsertTracks([createTrack(1, {
    trackUid: 'track_source',
    relativePath: 'Album/Track.flac',
    fileName: 'Track.flac',
    title: 'Source Track'
  })]);
  assert.equal(trackWrite.catalogVersion, 2);
  assert.deepEqual(trackWrite.changedScopes, ['tracks']);
  assert.equal(trackWrite.scopeVersions.tracks, 1);
  assert.equal(invalidations.length, 2);

  const counts = await host.getCounts();
  assert.equal(counts.tracks, 1);
  assert.equal(counts.folders, 1);
  const page = await host.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 1 });
  assert.equal(page.rows.length, 1);
  assert.equal(page.rows[0].trackUid, 'track_source');
  assert.equal(page.rows[0].durationSec, 121);
  assert.equal(page.rows[0].trackNo, 1);
  for (const field of ['folderId', 'albumKey', 'artistKey', 'genreKey', 'subfolderKey']) {
    assert.equal(Object.hasOwn(page.rows[0], field), true);
  }
  assert.equal(Object.hasOwn(page.rows[0], 'path'), false);
  assert.equal(Object.hasOwn(page.rows[0], 'relativePath'), false);
  assert.equal(Object.hasOwn(page.rows[0], 'rootPath'), false);
  await host.upsertTracks([createTrack(1, {
    trackUid: 'track_source',
    relativePath: 'Album/Track.flac',
    fileName: 'Track.flac',
    title: 'Updated Track'
  })]);
  const retainedPage = await host.readContextPage({
    contextToken: page.contextToken,
    cursor: null,
    limit: 1
  });
  assert.equal(retainedPage.rows[0].title, 'Source Track');
  assert.equal(retainedPage.catalogVersion, page.catalogVersion);

  const track = await host.getTrack('track_source');
  assert.equal(track.fileName, 'Track.flac');
  assert.equal(track.relativePath, 'Album/Track.flac');
  for (const field of ['folderId', 'albumKey', 'artistKey', 'genreKey', 'subfolderKey']) {
    assert.equal(Object.hasOwn(track, field), true);
  }
  assert.equal(Object.hasOwn(track, 'path'), false);
  assert.equal(Object.hasOwn(track, 'rootPath'), false);
  const expectedExportSource = {
    kind: 'absolute-path',
    trackUid: 'track_source',
    folderId: 'folder_music',
    lifecycleVersion: 3,
    path: sourcePath,
    physicalSourceKey: 'folder_music\0Album/Track.flac',
    sourceKind: 'file',
    entryKey: null,
    cueRelativePath: null,
    startFrame: null,
    endFrame: null
  };
  assert.deepEqual(await host.resolvePlaylistExportSource('track_source'), expectedExportSource);

  fs.unlinkSync(sourcePath);
  await host.upsertFolders([{
    id: 'folder_music',
    kind: 'electron',
    displayName: 'Music',
    path: directory,
    status: 'needs-permission',
    lifecycleVersion: 3
  }]);
  assert.deepEqual(await host.resolvePlaylistExportSource('track_source'), expectedExportSource);
});

test('canonical keyset cursors traverse duplicate sort keys forward and backward without duplicates or omissions', async t => {
  const { host, directory } = await openCatalog(t);
  await seedFolder(host, directory);
  const expected = [];
  const tracks = [];
  for (let index = 0; index < 137; index += 1) {
    const track = createTrack(index, { title: 'Same title' });
    tracks.push(track);
    expected.push(track.trackUid);
  }
  await host.upsertTracks(tracks);
  expected.sort();

  const first = await host.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 11 });
  const forward = await collectForward(host, first, 11);
  assert.deepEqual(forward.map(row => row.trackUid), expected);
  assert.equal(new Set(forward.map(row => row.trackUid)).size, expected.length);

  let page = first;
  while (page.nextCursor) {
    page = await host.readContextPage({ contextToken: first.contextToken, cursor: page.nextCursor, limit: 11 });
  }
  const backwardPages = [page.rows.map(row => row.trackUid)];
  while (page.previousCursor) {
    page = await host.readContextPage({ contextToken: first.contextToken, cursor: page.previousCursor, limit: 11 });
    backwardPages.push(page.rows.map(row => row.trackUid));
  }
  const backward = backwardPages.reverse().flat();
  assert.deepEqual(backward, expected);

  const cursorPayload = JSON.parse(Buffer.from(first.nextCursor.split('.')[1], 'base64url').toString('utf8'));
  const malformed = `c1.${Buffer.from(JSON.stringify({ ...cursorPayload, extra: true })).toString('base64url')}`;
  await assert.rejects(
    host.readContextPage({ contextToken: first.contextToken, cursor: malformed, limit: 11 }),
    assertCode('malformedCursor')
  );
});

test('trigram substring and short word-prefix searches return matches from every search field', async t => {
  const { host, directory } = await openCatalog(t);
  await seedFolder(host, directory);
  const fixtures = [
    createTrack(1, { trackUid: 'by_title', title: 'NeedleTitle' }),
    createTrack(2, { trackUid: 'by_artist', artist: 'NeedleArtist' }),
    createTrack(3, { trackUid: 'by_album_artist', albumArtist: 'QuartzCredit' }),
    createTrack(4, { trackUid: 'by_album', album: 'CobaltRecord' }),
    createTrack(5, { trackUid: 'by_genre', genre: 'NeedleGenre' }),
    createTrack(6, { trackUid: 'by_file', fileName: 'NeedleFile.flac' }),
    createTrack(7, { trackUid: 'by_path', relativePath: 'NeedlePath/Track.flac' }),
    createTrack(8, {
      trackUid: 'cross_fields',
      title: 'Crimson',
      artist: 'Voyager',
      genre: 'ロック'
    })
  ];
  await host.upsertTracks(fixtures);

  for (const [query, trackUid] of [
    ['needletitle', 'by_title'],
    ['needleartist', 'by_artist'],
    ['quartzcredit', 'by_album_artist'],
    ['cobaltrecord', 'by_album'],
    ['needlegenre', 'by_genre'],
    ['needlefile', 'by_file'],
    ['needlepath', 'by_path']
  ]) {
    const page = await host.queryTracks({ query, limit: 20 });
    assert.deepEqual(page.rows.map(row => row.trackUid), [trackUid]);
    await host.releaseContext(page.contextToken);
  }
  const cross = await host.queryTracks({ query: 'imson yage', limit: 20 });
  assert.deepEqual(cross.rows.map(row => row.trackUid), ['cross_fields']);
  await host.releaseContext(cross.contextToken);
  const shortPrefix = await host.queryTracks({ query: 'ne', limit: 20 });
  assert.deepEqual(shortPrefix.rows.map(row => row.trackUid).sort(), [
    'by_artist', 'by_file', 'by_genre', 'by_path', 'by_title'
  ]);
  await host.releaseContext(shortPrefix.contextToken);
  const shortInterior = await host.queryTracks({ query: 'dl', limit: 20 });
  assert.deepEqual(shortInterior.rows, []);
  await host.releaseContext(shortInterior.contextToken);
  const shortCjk = await host.queryTracks({ query: 'ﾛｯ', limit: 20 });
  assert.deepEqual(shortCjk.rows.map(row => row.trackUid), ['cross_fields']);
});

test('query, response, batch, context, and outstanding request boundaries fail closed', async t => {
  const { host, directory } = await openCatalog(t, { maxContexts: 2, contextTtlMs: 1000 });
  await seedFolder(host, directory);
  await assert.rejects(
    host.upsertTracks(Array.from({ length: 1001 }, (_, index) => createTrack(index))),
    assertCode('batchTooLarge')
  );
  await assert.rejects(host.queryTracks({ limit: 501 }), assertCode('invalidLimit'));
  await assert.rejects(
    host.request('getCounts', { padding: 'x'.repeat(MAX_LIBRARY_CATALOG_REQUEST_BYTES) }),
    assertCode('requestTooLarge')
  );

  const first = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  const second = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  await assert.rejects(
    host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null }),
    assertCode('tooManyContexts')
  );
  assert.deepEqual(await host.releaseContext(first.contextToken), { released: true });
  await host.createContext({ query: '', sort: 'title', direction: 'asc', scope: null });
  assert.deepEqual(await host.releaseContext('unknown'), { released: false });
  assert.deepEqual(second.totalCount, { pending: true });
  assert.equal((await host.getContextCount({ contextToken: second.contextToken })).totalCount, 0);
});

test('durable scan writes prune an idle context after its WAL budget is exceeded', async t => {
  const contextWalCapBytes = 1024 * 1024;
  const { host, directory, dbPath } = await openCatalog(t, { contextWalCapBytes });
  await seedFolder(host, directory);
  const context = await host.createContext({
    query: '', sort: 'title', direction: 'asc', scope: null
  });
  const walPath = `${dbPath}-wal`;
  const initialWalBytes = fs.statSync(walPath).size;
  const scan = await host.beginScanFolder({
    scanId: 'scan-context-wal-budget',
    folderId: 'folder_music',
    normalizedRoot: directory,
    expectedLifecycleVersion: 3,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });

  let written = 0;
  for (let batchNumber = 1; batchNumber <= 6; batchNumber += 1) {
    const observations = Array.from({ length: 500 }, (_, index) => {
      const id = `${batchNumber}-${String(index).padStart(3, '0')}`;
      return {
        relativePath: `Scan/${id}-${'x'.repeat(1536)}.flac`,
        path: null,
        fileIdentity: `identity-${id}-${'y'.repeat(512)}`,
        size: 1024,
        mtimeMs: batchNumber * 1000 + index
      };
    });
    written += observations.length;
    await host.commitScanSeenBatch({
      scanId: scan.scanId,
      folderId: scan.folderId,
      generation: scan.generation,
      expectedLifecycleVersion: scan.lifecycleVersion,
      observations,
      maxTracks: 10_000,
      maxBytes: 64 * 1024 * 1024,
      lastCommittedBatch: batchNumber,
      cursor: {
        lastRelativePath: observations.at(-1).relativePath,
        visitedFiles: written,
        committedBatches: batchNumber
      }
    });
    if (fs.statSync(walPath).size - initialWalBytes > contextWalCapBytes) break;
  }

  assert.ok(fs.statSync(walPath).size - initialWalBytes > contextWalCapBytes);
  assert.deepEqual(await host.releaseContext(context.contextToken), { released: false });
});

test('CUE directory staging is paged, resolves claims, and is removed at scan terminal state', async t => {
  const { host, directory } = await openCatalog(t);
  await seedFolder(host, directory);
  const scan = await host.beginScanFolder({
    scanId: 'scan-cue-stage',
    folderId: 'folder_music',
    normalizedRoot: directory,
    expectedLifecycleVersion: 3,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  const base = {
    scanId: scan.scanId,
    folderId: scan.folderId,
    generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion,
    directoryPath: 'Album'
  };

  await host.cueDirectoryStage({ ...base, action: 'reset' });
  await host.cueDirectoryStage({
    ...base,
    action: 'append-entries',
    entries: [
      { relativePath: 'Album/disc.cue', path: null, kind: 'cue', sequence: 0 },
      { relativePath: 'Album/audio.wav', path: null, kind: 'audio', sequence: 1 }
    ]
  });
  await host.cueDirectoryStage({
    ...base,
    action: 'update-observations',
    observations: [
      { relativePath: 'Album/disc.cue', path: null, fileIdentity: 'cue-id', size: 100, mtimeMs: 1 },
      { relativePath: 'Album/audio.wav', path: null, fileIdentity: 'audio-id', size: 200, mtimeMs: 2 }
    ]
  });
  assert.deepEqual(await host.cueDirectoryStage({
    ...base,
    action: 'resolve-references',
    references: ['AUDIO.WAV']
  }), { availableRelativePaths: ['Album/audio.wav'] });

  const track = {
    trackNo: 1,
    title: 'One',
    performer: 'Artist',
    fileReference: 'audio.wav',
    index00: null,
    startFrame: 0,
    endFrame: null,
    relativePath: 'Album/audio.wav',
    entryKey: 'cue:Album/disc.cue#1',
    logicalStorageId: 'cue:Album/disc.cue#1'
  };
  const cue = {
    ok: true,
    cueRelativePath: 'Album/disc.cue',
    title: 'Disc',
    performer: 'Artist',
    date: '',
    genre: '',
    files: [],
    resolvedFiles: ['Album/audio.wav'],
    tracks: [track]
  };
  await host.cueDirectoryStage({
    ...base,
    action: 'stage-sheet',
    cue,
    cueOrderKey: '0041',
    cueSignature: 'signature'
  });
  const sources = await host.cueDirectoryStage({
    ...base, action: 'list-sources', cursor: null, limit: 8
  });
  assert.deepEqual(sources.items.map(item => item.relativePath), ['Album/audio.wav']);
  await host.cueDirectoryStage({
    ...base,
    action: 'update-source',
    relativePath: 'Album/audio.wav',
    metadataStatus: 'ok',
    metadata: { durationSec: 20, sampleRate: 48000 }
  });
  await host.cueDirectoryStage({
    ...base,
    action: 'validate-sheet',
    cueRelativePath: cue.cueRelativePath,
    valid: true,
    durations: [{ trackNo: 1, durationSec: 20 }]
  });
  assert.deepEqual(await host.cueDirectoryStage({
    ...base,
    action: 'accept-sheet',
    cueRelativePath: cue.cueRelativePath
  }), { accepted: true });
  const logical = await host.cueDirectoryStage({
    ...base,
    action: 'list-logical',
    relativePath: 'Album/audio.wav',
    cursor: null,
    limit: 8
  });
  assert.equal(logical.sheet.cueSignature, 'signature');
  assert.equal(logical.sheet.metadata.durationSec, 20);
  assert.deepEqual(logical.items.map(item => item.trackNo), [1]);
  assert.equal(logical.items[0].durationSec, 20);

  await host.completeScanFolderNoSweep({
    scanId: scan.scanId,
    folderId: scan.folderId,
    generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion,
    status: 'completed-no-sweep',
    sweepBlockReason: 'test'
  });
  const afterTerminal = await host.cueDirectoryStage({
    ...base, action: 'list-files', cursor: null, limit: 8
  });
  assert.deepEqual(afterTerminal.items, []);

  await host.cueDirectoryStage({ ...base, action: 'reset' });
  await host.cueDirectoryStage({
    ...base,
    action: 'append-entries',
    entries: [{ relativePath: 'Album/stale.cue', path: null, kind: 'cue', sequence: 0 }]
  });
  const resumed = await host.beginScanFolder({
    scanId: scan.scanId,
    folderId: scan.folderId,
    normalizedRoot: directory,
    expectedLifecycleVersion: scan.lifecycleVersion,
    resume: true,
    rootEnumerationRequired: true,
    continuityBroken: true,
    sweepEligibility: 'INELIGIBLE'
  });
  const resumedBase = {
    ...base,
    generation: resumed.generation,
    expectedLifecycleVersion: resumed.lifecycleVersion
  };
  assert.deepEqual((await host.cueDirectoryStage({
    ...resumedBase, action: 'list-files', cursor: null, limit: 8
  })).items, []);
  await host.cueDirectoryStage({ ...resumedBase, action: 'reset' });
  await host.cueDirectoryStage({
    ...resumedBase,
    action: 'append-entries',
    entries: [{ relativePath: 'Album/cancel.cue', path: null, kind: 'cue', sequence: 0 }]
  });
  await host.pauseScanFolder({
    scanId: resumed.scanId,
    folderId: resumed.folderId,
    generation: resumed.generation,
    expectedLifecycleVersion: resumed.lifecycleVersion,
    status: 'paused',
    stopReason: 'user',
    continuityBroken: true,
    sweepEligibility: 'INELIGIBLE'
  });
  assert.deepEqual((await host.cueDirectoryStage({
    ...resumedBase, action: 'list-files', cursor: null, limit: 8
  })).items, []);
});

test('startup scan recovery removes unfinished CUE directory staging', async t => {
  const fixture = createTempCatalog(t);
  let host = await LibraryCatalogHost.open({ dbPath: fixture.dbPath });
  try {
    await seedFolder(host, fixture.directory);
    const scan = await host.beginScanFolder({
      scanId: 'scan-cue-recovery',
      folderId: 'folder_music',
      normalizedRoot: fixture.directory,
      expectedLifecycleVersion: 3,
      resume: false,
      rootEnumerationRequired: true,
      continuityBroken: false,
      sweepEligibility: 'INELIGIBLE'
    });
    const base = {
      scanId: scan.scanId,
      folderId: scan.folderId,
      generation: scan.generation,
      expectedLifecycleVersion: scan.lifecycleVersion,
      directoryPath: 'Album'
    };
    await host.cueDirectoryStage({ ...base, action: 'reset' });
    await host.cueDirectoryStage({
      ...base,
      action: 'append-entries',
      entries: [{ relativePath: 'Album/interrupted.cue', path: null, kind: 'cue', sequence: 0 }]
    });
    await host.close();
    host = await LibraryCatalogHost.open({ dbPath: fixture.dbPath });

    const recovered = await host.cueDirectoryStage({
      ...base, action: 'list-files', cursor: null, limit: 8
    });
    assert.deepEqual(recovered.items, []);
  } finally {
    await host.close();
  }
});

test('Electron CUE metadata claims keep the track UID while replacing the physical source path', async t => {
  const { host, directory, dbPath } = await openCatalog(t);
  await seedFolder(host, directory);
  const scan = await host.beginScanFolder({
    scanId: 'scan-cue-path-update', folderId: 'folder_music', normalizedRoot: directory,
    expectedLifecycleVersion: 3, resume: false, rootEnumerationRequired: true,
    continuityBroken: false, sweepEligibility: 'PENDING'
  });
  const entryKey = 'cue:Album/disc.cue#1';
  const claim = relativePath => host.claimMetadataParse({
    folderId: scan.folderId, trackUid: 'cue-stable-track', logicalStorageId: entryKey,
    lifecycleVersion: scan.lifecycleVersion, generation: scan.generation,
    relativePath, parserVersion: scan.parserVersion,
    signature: { fileIdentity: 'source', size: 100, mtimeMs: 1 },
    cueSignature: 'cue-signature',
    sourceKind: 'cue-track', entryKey, cueRelativePath: 'Album/disc.cue',
    startFrame: 0, endFrame: 750, explicitRescan: false
  });
  const complete = request => host.completeMetadataParseSuccess({
    claim: request.claim,
    metadata: {
      title: 'Title', artist: 'Artist', albumArtist: 'Artist', album: 'Album',
      genre: 'Genre', durationSec: 10
    },
    metadataStatus: 'ok', clearErrorAndRetryState: true,
    updateLastKnownGood: true, updateDerivedData: true
  });

  const first = await claim('Album/Old.flac');
  await complete(first);
  const observation = {
    relativePath: 'Album/New.flac', path: path.join(directory, 'Album', 'New.flac'),
    fileIdentity: 'source', size: 100, mtimeMs: 1,
    logicalCandidates: [{
      logicalStorageId: entryKey, relativePath: 'Album/New.flac',
      path: path.join(directory, 'Album', 'New.flac'), sourceKind: 'cue-track', entryKey,
      cueRelativePath: 'Album/disc.cue', startFrame: 0, endFrame: 750,
      cueSignature: 'cue-signature',
      metadata: {
        title: 'Title', artist: 'Artist', albumArtist: 'Artist', album: 'Album',
        genre: 'Genre', durationSec: 10
      }
    }]
  };
  await host.commitScanSeenBatch({
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion,
    observations: [observation], maxTracks: 500, maxBytes: 4 * 1024 * 1024,
    lastCommittedBatch: 1,
    cursor: { lastRelativePath: observation.relativePath, visitedFiles: 1, committedBatches: 1 }
  });
  const candidate = (await host.listMetadataCandidates({
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion, cursor: null, limit: 10,
    parserVersion: scan.parserVersion
  })).items[0];
  assert.equal(candidate.relativePath, 'Album/New.flac');
  assert.equal(candidate.storedSignature, null);
  const moved = await claim('Album/New.flac');
  assert.equal(moved.claim.trackUid, 'cue-stable-track');
  await complete(moved);

  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const track = database.prepare(`
      SELECT relative_path AS relativePath, file_name AS fileName,
        normalized_basename AS normalizedBasename, search_text AS searchText,
        entry_key AS entryKey, cue_relative_path AS cueRelativePath
      FROM tracks WHERE track_uid = 'cue-stable-track'
    `).get();
    assert.deepEqual({
      relativePath: track.relativePath,
      fileName: track.fileName,
      normalizedBasename: track.normalizedBasename,
      entryKey: track.entryKey,
      cueRelativePath: track.cueRelativePath
    }, {
      relativePath: 'Album/New.flac', fileName: 'New.flac', normalizedBasename: 'new.flac',
      entryKey, cueRelativePath: 'Album/disc.cue'
    });
    assert.match(track.searchText, /new\.flac/);
    assert.doesNotMatch(track.searchText, /old\.flac/);
  } finally {
    database.close();
  }
});

test('Electron retains CUE rows and playlists after pause, then cleans them in an eligible final sweep', async t => {
  const { host, directory } = await openCatalog(t);
  await seedFolder(host, directory);
  const begin = scanId => host.beginScanFolder({
    scanId, folderId: 'folder_music', normalizedRoot: directory,
    expectedLifecycleVersion: 3, resume: false, rootEnumerationRequired: true,
    continuityBroken: false, sweepEligibility: 'PENDING'
  });
  const complete = request => host.completeMetadataParseSuccess({
    claim: request.claim,
    metadata: {
      title: request.claim.sourceKind === 'cue-track' ? 'CUE title' : 'Plain title',
      artist: 'Artist', albumArtist: 'Artist', album: 'Album', genre: 'Genre', durationSec: 10
    },
    metadataStatus: 'ok', clearErrorAndRetryState: true,
    updateLastKnownGood: true, updateDerivedData: true
  });

  const oldScan = await begin('scan-cue-reconcile-old');
  const entryKey = 'cue:Album/disc.cue#1';
  const cue = await host.claimMetadataParse({
    folderId: oldScan.folderId, trackUid: 'old-cue-track', logicalStorageId: entryKey,
    lifecycleVersion: oldScan.lifecycleVersion, generation: oldScan.generation,
    relativePath: 'Album/Image.flac', parserVersion: oldScan.parserVersion,
    signature: { fileIdentity: 'cue-source', size: 100, mtimeMs: 1 },
    cueSignature: 'cue-old', sourceKind: 'cue-track', entryKey,
    cueRelativePath: 'Album/disc.cue', startFrame: 0, endFrame: 750,
    explicitRescan: false
  });
  await complete(cue);
  await host.completeScanFolderNoSweep({
    scanId: oldScan.scanId, folderId: oldScan.folderId, generation: oldScan.generation,
    expectedLifecycleVersion: oldScan.lifecycleVersion, status: 'completed-no-sweep',
    sweepBlockReason: 'test'
  });
  await host.createPlaylistWithItems({
    playlistId: 'cue-reconcile-playlist', name: 'CUE reconcile', createdAt: 1,
    items: [{ trackUid: 'old-cue-track' }]
  });

  const scan = await begin('scan-cue-reconcile-plain');
  const observation = {
    relativePath: 'Album/Image.flac', path: path.join(directory, 'Album', 'Image.flac'),
    fileIdentity: 'plain-source', size: 120, mtimeMs: 2,
    logicalCandidates: [{
      logicalStorageId: 'file:Album/Image.flac', relativePath: 'Album/Image.flac',
      path: path.join(directory, 'Album', 'Image.flac'), sourceKind: 'file'
    }]
  };
  await host.commitScanSeenBatch({
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion,
    observations: [observation], maxTracks: 500, maxBytes: 4 * 1024 * 1024,
    lastCommittedBatch: 1,
    cursor: { lastRelativePath: observation.relativePath, visitedFiles: 1, committedBatches: 1 }
  });
  const plain = await host.claimMetadataParse({
    folderId: scan.folderId, trackUid: 'plain-track', logicalStorageId: 'file:Album/Image.flac',
    lifecycleVersion: scan.lifecycleVersion, generation: scan.generation,
    relativePath: observation.relativePath, parserVersion: scan.parserVersion,
    signature: { fileIdentity: 'plain-source', size: 120, mtimeMs: 2 },
    sourceKind: 'file', explicitRescan: false
  });
  await complete(plain);

  await host.pauseScanFolder({
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion, status: 'paused', stopReason: 'user',
    continuityBroken: true, sweepEligibility: 'INELIGIBLE'
  });

  assert.equal((await host.getCounts()).tracks, 2);
  const retainedTracks = await host.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 10 });
  assert.deepEqual(retainedTracks.rows.map(row => ({ trackUid: row.trackUid, sourceKind: row.sourceKind })), [
    { trackUid: 'old-cue-track', sourceKind: 'cue-track' },
    { trackUid: 'plain-track', sourceKind: 'file' }
  ]);
  await host.releaseContext(retainedTracks.contextToken);
  const retainedPlaylistItem = (await host.queryPlaylistItems({
    playlistId: 'cue-reconcile-playlist', limit: 10
  })).items[0];
  assert.equal(retainedPlaylistItem.trackUid, 'old-cue-track');

  const eligible = await begin('scan-cue-reconcile-eligible');
  await host.commitScanSeenBatch({
    scanId: eligible.scanId, folderId: eligible.folderId, generation: eligible.generation,
    expectedLifecycleVersion: eligible.lifecycleVersion,
    observations: [observation], maxTracks: 500, maxBytes: 4 * 1024 * 1024,
    lastCommittedBatch: 1,
    cursor: { lastRelativePath: observation.relativePath, visitedFiles: 1, committedBatches: 1 }
  });
  const finalized = await host.finalizeScanEnumeration({
    scanId: eligible.scanId, folderId: eligible.folderId, generation: eligible.generation,
    expectedLifecycleVersion: eligible.lifecycleVersion, rootToEnd: true,
    enumerationErrorCount: 0, continuityBroken: false, requestedSweepEligibility: 'ELIGIBLE'
  });
  assert.equal(finalized.sweepEligibility, 'ELIGIBLE');
  const sweepRequest = {
    scanId: eligible.scanId, folderId: eligible.folderId, generation: eligible.generation,
    expectedLifecycleVersion: eligible.lifecycleVersion,
    expectedSweepEligibility: 'ELIGIBLE', expectedContinuityBroken: false
  };
  await host.enqueueScanSweep(sweepRequest);
  let sweep;
  do {
    sweep = await host.runScanSweep(sweepRequest);
  } while (sweep.hasMore);
  await host.completeScanFolder({
    scanId: eligible.scanId, folderId: eligible.folderId, generation: eligible.generation,
    expectedLifecycleVersion: eligible.lifecycleVersion, status: 'completed'
  });

  assert.equal((await host.getCounts()).tracks, 1);
  const tracks = await host.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 10 });
  assert.deepEqual(tracks.rows.map(row => ({ trackUid: row.trackUid, sourceKind: row.sourceKind })), [
    { trackUid: 'plain-track', sourceKind: 'file' }
  ]);
  await host.releaseContext(tracks.contextToken);
  const repaired = (await host.queryPlaylistItems({
    playlistId: 'cue-reconcile-playlist', limit: 10
  })).items[0];
  assert.equal(repaired.trackUid, null);
  assert.deepEqual(repaired.unresolved.cueProvenance, {
    folderId: 'folder_music', entryKey, cueRelativePath: 'Album/disc.cue',
    relativePath: 'Album/Image.flac', startFrame: 0, endFrame: 750
  });
});

test('responses over 1 MiB are rejected at the host boundary', async () => {
  class OversizedResponseWorker extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => this.emit('message', {
        protocolVersion: 1,
        type: 'ready',
        ok: true,
        payload: {}
      }));
    }

    postMessage(request) {
      queueMicrotask(() => this.emit('message', {
        protocolVersion: 1,
        type: 'response',
        requestId: request.requestId,
        ok: true,
        payload: { text: 'x'.repeat(MAX_LIBRARY_CATALOG_RESPONSE_BYTES) }
      }));
    }

    async terminate() {
      return 0;
    }
  }

  const host = await LibraryCatalogHost.open({
    dbPath: path.resolve('oversized-response.sqlite'),
    workerFactory: () => new OversizedResponseWorker()
  });
  await assert.rejects(host.getCounts(), assertCode('responseTooLarge'));
});

test('worker failure rejects all outstanding calls and close rejects later calls', async t => {
  class FakeWorker extends EventEmitter {
    constructor() {
      super();
      queueMicrotask(() => this.emit('message', {
        protocolVersion: 1,
        type: 'ready',
        ok: true,
        payload: {}
      }));
    }

    postMessage() {}

    async terminate() {
      return 0;
    }
  }

  const worker = new FakeWorker();
  const host = await LibraryCatalogHost.open({
    dbPath: path.resolve('fake-catalog.sqlite'),
    workerFactory: () => worker
  });
  const pending = Array.from({ length: MAX_LIBRARY_CATALOG_OUTSTANDING_REQUESTS }, () => host.getCounts());
  await assert.rejects(host.getCounts(), assertCode('tooManyRequests'));
  const failure = Object.assign(new Error('worker crashed'), { code: 'workerCrashed' });
  worker.emit('error', failure);
  const results = await Promise.allSettled(pending);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason === failure));

  const { host: realHost } = await openCatalog(t);
  await realHost.close();
  await assert.rejects(realHost.getCounts(), assertCode('catalogClosed'));
});

test('startup recovery marks nonterminal operations interrupted without deleting staging objects', async t => {
  const { directory, dbPath } = createTempCatalog(t);
  const first = await LibraryCatalogHost.open({ dbPath });
  await first.close();
  await runSqliteWorker(dbPath, 'seed');
  const reopened = await LibraryCatalogHost.open({ dbPath });
  await reopened.close();
  const state = await runSqliteWorker(dbPath, 'inspect');
  assert.deepEqual(state.operation, {
    phase: 'INTERRUPTED',
    terminal_kind: 'interrupted',
    terminal_code: 'service-interrupted',
    committed: 0,
    context_released: 1
  });
  assert.equal(state.snapshotCount, 1);
  assert.deepEqual(state.snapshot, { state: 'gc-pending', staging_operation_id: null });
  assert.deepEqual(state.playlist, { state: 'deleted', building_operation_id: null });
  assert.equal(state.foreignKeys, 1);
  assert.equal(state.journalMode, 'wal');
  assert.equal(fs.existsSync(directory), true);
});

test('metadata page batches use two catalog commits and one exact terminal invalidation', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const invalidations = [];
  host.on('invalidation', invalidation => invalidations.push(invalidation));
  const scan = await host.beginScanFolder({
    scanId: 'scan-metadata-batch',
    folderId: 'folder_music',
    normalizedRoot: directory,
    expectedLifecycleVersion: 3,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  const requests = Array.from({ length: 3 }, (_, index) => ({
    folderId: 'folder_music',
    trackUid: `batch-track-${index}`,
    lifecycleVersion: scan.lifecycleVersion,
    generation: scan.generation,
    relativePath: `Batch/Track-${index}.flac`,
    parserVersion: scan.parserVersion,
    signature: { fileIdentity: `batch-file-${index}`, size: 100 + index, mtimeMs: 200 + index },
    explicitRescan: false
  }));

  const claimed = await host.claimMetadataParseBatch({ requests });
  const completed = await host.completeMetadataParseBatch({
    completions: claimed.results.map((result, index) => ({
      outcome: 'success',
      request: {
        claim: result.claim,
        metadata: {
          title: `Track ${index}`, artist: 'Batch Artist', albumArtist: 'Batch Artist',
          album: 'Batch Album', genre: 'Batch Genre', durationSec: 120
        },
        metadataStatus: 'ok',
        clearErrorAndRetryState: true,
        updateLastKnownGood: true,
        updateDerivedData: true,
        deferAggregateRecompute: false
      }
    }))
  });

  assert.equal(completed.catalogVersion, claimed.catalogVersion + 1);
  assert.deepEqual(completed.results.map(result => result.committed), [true, true, true]);
  assert.deepEqual(invalidations, []);
  await host.completeScanFolderNoSweep({
    scanId: 'scan-metadata-batch',
    folderId: 'folder_music',
    generation: scan.generation,
    expectedLifecycleVersion: 3,
    status: 'completed-no-sweep',
    sweepBlockReason: 'test-no-sweep'
  });

  assert.equal(invalidations.length, 1);
  assert.deepEqual(new Set(invalidations[0].changedScopes), new Set([
    'tracks', 'albums', 'artists', 'genres', 'subfolders'
  ]));
  assert.deepEqual(invalidations[0].counts, {
    tracks: 3, albums: 1, artists: 1, genres: 1, subfolders: 1
  });
});

test('completed folder scans durably re-resolve unique unresolved playlist items with one job', async t => {
  const { directory, dbPath, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const otherRoot = path.join(directory, 'other-root');
  await host.upsertFolders([{
    id: 'folder_other',
    kind: 'electron',
    displayName: 'Other',
    path: otherRoot,
    status: 'ok',
    lifecycleVersion: 1
  }]);
  await host.upsertTracks([
    createTrack(8000, {
      trackUid: 'ambiguous-existing',
      relativePath: 'Existing/Same.flac',
      fileName: 'Same.flac',
      title: 'Ambiguous',
      artist: 'Artist',
      albumArtist: 'Artist',
      durationSec: 120
    }),
    createTrack(8001, {
      trackUid: 'same-relative-path-other-root',
      folderId: 'folder_other',
      relativePath: 'Late/Same.flac',
      fileName: 'Same.flac',
      title: 'Ambiguous',
      artist: 'Artist',
      albumArtist: 'Artist',
      durationSec: 120
    })
  ]);
  await host.createPlaylistWithItems({
    playlistId: 'late-resolution',
    name: 'Late Resolution',
    createdAt: 1,
    items: [
      { unresolved: {
        sourceLine: 'Late/Unique.flac', relativePathHint: 'Late/Unique.flac',
        basename: 'Unique.flac', title: 'Unique', artist: 'Artist', durationSec: 120
      } },
      { unresolved: {
        sourceLine: 'Same.flac', relativePathHint: 'Same.flac',
        basename: 'Same.flac', title: 'Ambiguous', artist: 'Artist', durationSec: 120
      } },
      { unresolved: {
        sourceLine: path.join(directory, 'Late', 'Same.flac'),
        relativePathHint: path.join(directory, 'Late', 'Same.flac'),
        basename: 'Same.flac', title: 'Ambiguous', artist: 'Artist', durationSec: 120
      } }
    ]
  });
  const scan = await host.beginScanFolder({
    scanId: 'scan-late-resolution',
    folderId: 'folder_music',
    normalizedRoot: directory,
    expectedLifecycleVersion: 3,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  for (const [index, entry] of [
    ['unique-late', 'Late/Unique.flac', 'Unique'],
    ['ambiguous-late', 'Late/Same.flac', 'Ambiguous']
  ].entries()) {
    const [trackUid, relativePath, title] = entry;
    const claim = await host.claimMetadataParse({
      folderId: 'folder_music',
      trackUid,
      lifecycleVersion: scan.lifecycleVersion,
      generation: scan.generation,
      relativePath,
      parserVersion: scan.parserVersion,
      signature: { fileIdentity: `late-file-${index}`, size: 100, mtimeMs: 200 + index },
      explicitRescan: false
    });
    await host.completeMetadataParseSuccess({
      claim: claim.claim,
      metadata: {
        title, artist: 'Artist', albumArtist: 'Artist', album: 'Album', genre: 'Genre',
        durationSec: 120
      },
      metadataStatus: 'ok',
      clearErrorAndRetryState: true,
      updateLastKnownGood: true,
      updateDerivedData: true
    });
  }
  await host.completeScanFolderNoSweep({
    scanId: 'scan-late-resolution',
    folderId: 'folder_music',
    generation: scan.generation,
    expectedLifecycleVersion: 3,
    status: 'completed-no-sweep',
    sweepBlockReason: 'test-no-sweep'
  });

  let playlist;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    playlist = await host.queryPlaylistItems({ playlistId: 'late-resolution', limit: 20 });
    if (playlist.items[0].trackUid === 'unique-late' && playlist.items[2].trackUid === 'ambiguous-late') break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(playlist.items[0].trackUid, 'unique-late');
  assert.equal(playlist.items[0].unresolved, null);
  assert.equal(playlist.items[1].trackUid, null);
  assert.equal(playlist.items[1].unresolved.basename, 'Same.flac');
  assert.equal(playlist.items[2].trackUid, 'ambiguous-late');
  assert.equal(playlist.items[2].unresolved, null);
  assert.equal(playlist.playlist.version, 1);
  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual({ ...database.prepare(`
      SELECT job_id AS jobId, state, folder_id AS folderId,
        lifecycle_version AS lifecycleVersion, track_uid AS trackUid
      FROM deletion_jobs WHERE kind = 'playlist-resolve'
    `).get() }, {
      jobId: 'playlist-resolve:3:folder_music',
      state: 'completed',
      folderId: 'folder_music',
      lifecycleVersion: 3,
      trackUid: null
    });
  } finally {
    database.close();
  }
});

test('Electron playlist resolution keeps plain imports separate and restores CUE items by provenance', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);
  await host.upsertFolders([{
    id: 'folder_other', kind: 'electron', displayName: 'Other', path: path.join(directory, 'other'),
    status: 'ok', lifecycleVersion: 1
  }]);
  const scan = await host.beginScanFolder({
    scanId: 'scan-cue-playlist-resolution', folderId: 'folder_music', normalizedRoot: directory,
    expectedLifecycleVersion: 3, resume: false, rootEnumerationRequired: true,
    continuityBroken: false, sweepEligibility: 'INELIGIBLE'
  });
  const otherScan = await host.beginScanFolder({
    scanId: 'scan-cue-playlist-resolution-other', folderId: 'folder_other',
    normalizedRoot: path.join(directory, 'other'), expectedLifecycleVersion: 1,
    resume: false, rootEnumerationRequired: true,
    continuityBroken: false, sweepEligibility: 'INELIGIBLE'
  });

  const cueTracks = [];
  for (const [trackUid, trackNo, title, startFrame] of [
    ['cue-first', 1, 'First Cue', 0],
    ['cue-second', 2, 'Second Cue', 750]
  ]) {
    const entryKey = `cue:Album/disc.cue#${trackNo}`;
    const claimed = await host.claimMetadataParse({
      folderId: 'folder_music', trackUid, logicalStorageId: entryKey,
      lifecycleVersion: scan.lifecycleVersion, generation: scan.generation,
      relativePath: 'Album/Image.flac', parserVersion: scan.parserVersion,
      signature: { fileIdentity: 'cue-image', size: 1000, mtimeMs: 2000 },
      cueSignature: 'cue-signature', sourceKind: 'cue-track', entryKey,
      cueRelativePath: 'Album/disc.cue', startFrame, endFrame: startFrame + 750,
      explicitRescan: false
    });
    assert.ok(claimed.claim);
    await host.completeMetadataParseSuccess({
      claim: claimed.claim,
      metadata: {
        title, artist: 'Cue Artist', albumArtist: 'Cue Artist', album: 'Cue Album',
        genre: 'Genre', durationSec: 10
      },
      metadataStatus: 'ok', clearErrorAndRetryState: true, updateLastKnownGood: true,
      updateDerivedData: true
    });
    cueTracks.push({ trackUid, entryKey, title });
  }

  const otherClaimed = await host.claimMetadataParse({
    folderId: 'folder_other', trackUid: 'cue-second-other',
    logicalStorageId: cueTracks[1].entryKey,
    lifecycleVersion: otherScan.lifecycleVersion, generation: otherScan.generation,
    relativePath: 'Album/Image.flac', parserVersion: otherScan.parserVersion,
    signature: { fileIdentity: 'cue-image-other', size: 1000, mtimeMs: 2000 },
    cueSignature: 'cue-signature', sourceKind: 'cue-track', entryKey: cueTracks[1].entryKey,
    cueRelativePath: 'Album/disc.cue', startFrame: 750, endFrame: 1500,
    explicitRescan: false
  });
  assert.ok(otherClaimed.claim);
  await host.completeMetadataParseSuccess({
    claim: otherClaimed.claim,
    metadata: {
      title: 'Second Cue', artist: 'Cue Artist', albumArtist: 'Cue Artist', album: 'Cue Album',
      genre: 'Genre', durationSec: 10
    },
    metadataStatus: 'ok', clearErrorAndRetryState: true, updateLastKnownGood: true,
    updateDerivedData: true
  });
  await host.completeScanFolderNoSweep({
    scanId: otherScan.scanId, folderId: otherScan.folderId, generation: otherScan.generation,
    expectedLifecycleVersion: otherScan.lifecycleVersion,
    status: 'completed-no-sweep', sweepBlockReason: 'test-no-sweep'
  });
  await host.createPlaylistWithItems({
    playlistId: 'cue-source-removal', name: 'CUE source removal', createdAt: Date.now(),
    items: [{ trackUid: 'cue-second-other' }]
  });

  const directPlaylistId = 'direct-plain-cue-separation';
  const received = await host.receiveOperation({
    clientRequestId: 'direct-plain-cue-separation', requestDigest: 'direct-plain-cue-separation',
    canonicalRequestVersion: 1, operationKind: 'previewPlaylistImport',
    target: { playlistId: directPlaylistId }, expectedTargetVersion: 0,
    sourceContextToken: null, sourceSequenceIds: [], sourceSequenceItemCount: 0,
    buildDeadlineAt: Date.now() + 60_000, receivedAt: Date.now()
  });
  await host.createPlaylist({
    playlistId: directPlaylistId, name: 'Direct plain', operationId: received.operationId,
    createdAt: Date.now()
  });
  await host.appendPlaylistImportRecords({
    origin: null, playlistId: directPlaylistId, operationId: received.operationId,
    records: [{ type: 'entry', entry: { path: 'Album/Image.flac' } }]
  });
  const direct = await host.finalizePlaylistImportPage({
    playlistId: directPlaylistId, operationId: received.operationId, afterPosition: 0, limit: 10
  });
  assert.equal(direct.resolvedCount, 0);
  assert.equal(direct.keptCount, 1);

  await host.createPlaylistWithItems({
    playlistId: 'cue-provenance-resolution', name: 'CUE provenance', createdAt: Date.now(),
    items: [
      { unresolved: {
        sourceKind: 'cue-track', entryKey: cueTracks[1].entryKey,
        cueProvenance: { folderId: 'folder_music', entryKey: cueTracks[1].entryKey },
        basename: 'Image.flac', title: cueTracks[1].title, artist: 'Cue Artist', durationSec: 10
      } },
      { unresolved: {
        sourceKind: 'cue-track', entryKey: 'cue:Old/disc.cue#9',
        cueProvenance: { entryKey: 'cue:Old/disc.cue#9' },
        basename: 'Image.flac', title: cueTracks[0].title, artist: 'Cue Artist', durationSec: 10
      } },
      { unresolved: {
        sourceKind: 'cue-track', entryKey: cueTracks[0].entryKey,
        cueProvenance: {
          folderId: 'folder_before_reregistration', entryKey: cueTracks[0].entryKey
        },
        basename: 'Image.flac', title: cueTracks[0].title, artist: 'Cue Artist', durationSec: 10
      } },
      { unresolved: {
        sourceLine: 'Album/Image.flac', relativePathHint: 'Album/Image.flac',
        basename: 'Image.flac', title: cueTracks[0].title, artist: 'Cue Artist', durationSec: 10
      } }
    ]
  });
  await host.completeScanFolderNoSweep({
    scanId: 'scan-cue-playlist-resolution', folderId: 'folder_music', generation: scan.generation,
    expectedLifecycleVersion: 3, status: 'completed-no-sweep', sweepBlockReason: 'test-no-sweep'
  });

  let playlist;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    playlist = await host.queryPlaylistItems({ playlistId: 'cue-provenance-resolution', limit: 10 });
    if (playlist.items[0].trackUid && playlist.items[1].trackUid && playlist.items[2].trackUid) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(playlist.items[0].trackUid, 'cue-second');
  assert.equal(playlist.items[1].trackUid, 'cue-first');
  assert.equal(playlist.items[2].trackUid, 'cue-first');
  assert.equal(playlist.items[3].trackUid, null);
  assert.equal(playlist.items[3].unresolved.basename, 'Image.flac');

  assert.deepEqual(await host.removeScanFolder({
    folderId: 'folder_other', expectedLifecycleVersion: 1
  }), {
    folderId: 'folder_other', lifecycleVersion: 2, deleted: 1, hasMore: false
  });
  const removed = await host.queryPlaylistItems({ playlistId: 'cue-source-removal', limit: 10 });
  assert.equal(removed.items[0].trackUid, null);
  assert.equal(removed.items[0].unresolved.reason, 'source-removed');
  assert.deepEqual(removed.items[0].unresolved.cueProvenance, {
    folderId: 'folder_other',
    entryKey: cueTracks[1].entryKey,
    cueRelativePath: 'Album/disc.cue',
    relativePath: 'Album/Image.flac',
    startFrame: 750,
    endFrame: 1500
  });
});

test('metadata commits without unresolved playlists create no playlist resolution jobs', async t => {
  const { directory, dbPath, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const scan = await host.beginScanFolder({
    scanId: 'scan-without-playlists',
    folderId: 'folder_music',
    normalizedRoot: directory,
    expectedLifecycleVersion: 3,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  for (let index = 0; index < 4; index += 1) {
    const relativePath = `No Playlist/Track-${index}.flac`;
    const claim = await host.claimMetadataParse({
      folderId: 'folder_music',
      trackUid: `no-playlist-${index}`,
      lifecycleVersion: scan.lifecycleVersion,
      generation: scan.generation,
      relativePath,
      parserVersion: scan.parserVersion,
      signature: { fileIdentity: `no-playlist-file-${index}`, size: 100, mtimeMs: 200 + index },
      explicitRescan: false
    });
    await host.completeMetadataParseSuccess({
      claim: claim.claim,
      metadata: {
        title: `Track ${index}`, artist: 'Artist', albumArtist: 'Artist',
        album: 'Album', genre: 'Genre', durationSec: 120
      },
      metadataStatus: 'ok',
      clearErrorAndRetryState: true,
      updateLastKnownGood: true,
      updateDerivedData: true
    });
  }
  await host.completeScanFolderNoSweep({
    scanId: 'scan-without-playlists',
    folderId: 'folder_music',
    generation: scan.generation,
    expectedLifecycleVersion: 3,
    status: 'completed-no-sweep',
    sweepBlockReason: 'test-no-sweep'
  });

  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(database.prepare(`
      SELECT COUNT(*) AS count FROM deletion_jobs WHERE kind = 'playlist-resolve'
    `).get().count, 0);
  } finally {
    database.close();
  }
});

test('scan metadata defers entity aggregates until one durable post-scan job', async t => {
  const { directory, dbPath, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const scan = await host.beginScanFolder({
    scanId: 'scan-deferred-aggregates',
    folderId: 'folder_music',
    normalizedRoot: directory,
    expectedLifecycleVersion: 3,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  for (let index = 0; index < 2; index += 1) {
    const relativePath = `Shared/Track-${index}.flac`;
    const claim = await host.claimMetadataParse({
      folderId: 'folder_music',
      trackUid: `deferred-${index}`,
      lifecycleVersion: scan.lifecycleVersion,
      generation: scan.generation,
      relativePath,
      parserVersion: scan.parserVersion,
      signature: { fileIdentity: `deferred-file-${index}`, size: 100, mtimeMs: 200 + index },
      explicitRescan: false
    });
    await host.completeMetadataParseSuccess({
      claim: claim.claim,
      metadata: {
        title: `Track ${index}`, artist: 'Shared Artist', albumArtist: 'Shared Artist',
        album: 'Shared Album', genre: 'Shared Genre', durationSec: 90
      },
      metadataStatus: 'ok',
      clearErrorAndRetryState: true,
      updateLastKnownGood: true,
      updateDerivedData: true,
      deferAggregateRecompute: true
    });
  }

  const pendingDatabase = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(pendingDatabase.prepare(`
      SELECT track_count AS trackCount FROM albums WHERE name = 'Shared Album'
    `).get().trackCount, 0);
    assert.equal(pendingDatabase.prepare(`
      SELECT state FROM deletion_jobs
      WHERE job_id = 'entity-aggregate:scan-deferred-aggregates:folder_music'
    `).get().state, 'pending-scan');
  } finally {
    pendingDatabase.close();
  }

  await host.completeScanFolderNoSweep({
    scanId: 'scan-deferred-aggregates',
    folderId: 'folder_music',
    generation: scan.generation,
    expectedLifecycleVersion: 3,
    status: 'completed-no-sweep',
    sweepBlockReason: 'test-no-sweep'
  });

  const database = new DatabaseSync(dbPath, { readOnly: true });
  let job;
  const deadline = Date.now() + 5000;
  try {
    do {
      job = database.prepare(`
        SELECT state, cursor_key AS cursorKey FROM deletion_jobs
        WHERE job_id = 'entity-aggregate:scan-deferred-aggregates:folder_music'
      `).get();
      if (job?.state !== 'completed') await new Promise(resolve => setTimeout(resolve, 10));
    } while (job?.state !== 'completed' && Date.now() < deadline);
    assert.equal(job.state, 'completed');
    assert.equal(job.cursorKey, 4);
  } finally {
    database.close();
  }
  const page = await host.queryEntities({
    type: 'album', query: '', sort: 'name', direction: 'asc', limit: 10
  });
  assert.equal(page.rows[0].trackCount, 2);
  assert.equal(page.rows[0].totalDurationSec, 180);
  await host.releaseContext(page.contextToken);
});

test('folder deletion tombstones unavailable Electron folders', async t => {
  const { directory, host } = await openCatalog(t);
  const folders = ['missing', 'needs-permission'].map((status, index) => ({
    id: `folder_${status}`,
    kind: 'electron',
    displayName: status,
    path: path.join(directory, status),
    status: 'ok',
    lifecycleVersion: 3,
    addedAt: index + 1
  }));
  await host.upsertFolders(folders);
  await host.upsertTracks(folders.map((folder, index) => createTrack(index + 1, {
    trackUid: `track_${folder.id}`,
    folderId: folder.id,
    relativePath: `Track-${index + 1}.flac`,
    fileName: `Track-${index + 1}.flac`
  })));
  await host.upsertFolders(folders.map(folder => ({
    ...folder,
    status: folder.id.slice('folder_'.length)
  })));

  for (const folder of folders) {
    const deleted = await host.removeScanFolder({
      folderId: folder.id,
      expectedLifecycleVersion: 3
    });
    assert.equal(deleted.deleted, 1);
    assert.equal(deleted.hasMore, false);
  }
  const removed = await host.listScanFolders({
    folderIds: folders.map(folder => folder.id),
    includeRemoved: true
  });
  assert.deepEqual(removed.folders.map(folder => ({
    id: folder.id,
    status: folder.status,
    lifecycleVersion: folder.lifecycleVersion,
    path: folder.path
  })), folders.map(folder => ({
    id: folder.id,
    status: 'removed',
    lifecycleVersion: 4,
    path: null
  })));

  assert.deepEqual(await host.removeScanFolder({
    folderId: folders[0].id,
    expectedLifecycleVersion: 3
  }), {
    folderId: folders[0].id,
    lifecycleVersion: 4,
    deleted: 0,
    hasMore: false
  });
  await assert.rejects(
    host.removeScanFolder({
      folderId: folders[0].id,
      expectedLifecycleVersion: 4
    }),
    error => error?.code === 'staleFolderLifecycle'
  );
});

test('folder deletion removes published artwork references before deleting the track', async t => {
  const { directory, dbPath, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const trackUid = 'track_000001';
  await host.upsertTracks([createTrack(1, {
    fileIdentity: 'folder-delete-artwork-file',
    size: 128,
    mtimeMs: 200
  })]);
  await host.beginArtworkUtilitySession({ utilitySessionId: 'folder-delete-artwork-publish' });
  const artworkId = await publishTrackArtwork(host, trackUid, 'folder-delete-artwork-publish');
  await host.beginArtworkUtilitySession({ utilitySessionId: 'folder-delete-artwork-pending' });
  const source = await host.getArtworkSource({ trackUid });
  const pending = await host.claimArtworkSource({
    claim: { ...source, utilitySessionId: 'folder-delete-artwork-pending' }
  });
  assert.ok(pending.claim);

  const deleted = await host.removeScanFolder({
    folderId: 'folder_music',
    expectedLifecycleVersion: 3
  });
  assert.equal(deleted.deleted, 1);
  assert.equal(deleted.hasMore, false);
  assert.equal((await host.getCounts()).tracks, 0);
  assertTrackArtworkRemoved(dbPath, trackUid, artworkId);
});

test('scan sweep removes published artwork references for a missing track', async t => {
  const { directory, dbPath, host } = await openCatalog(t);
  await seedFolder(host, directory);
  const trackUid = 'track_000001';
  await host.upsertTracks([createTrack(1, {
    fileIdentity: 'scan-sweep-artwork-file',
    size: 128,
    mtimeMs: 200
  })]);
  await host.beginArtworkUtilitySession({ utilitySessionId: 'scan-sweep-artwork-publish' });
  const artworkId = await publishTrackArtwork(host, trackUid, 'scan-sweep-artwork-publish');
  await host.beginArtworkUtilitySession({ utilitySessionId: 'scan-sweep-artwork-pending' });
  const source = await host.getArtworkSource({ trackUid });
  const pending = await host.claimArtworkSource({
    claim: { ...source, utilitySessionId: 'scan-sweep-artwork-pending' }
  });
  assert.ok(pending.claim);

  const scan = await host.beginScanFolder({
    scanId: 'scan-sweep-artwork',
    folderId: 'folder_music',
    normalizedRoot: directory,
    expectedLifecycleVersion: 3,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  const identity = {
    scanId: 'scan-sweep-artwork',
    folderId: 'folder_music',
    generation: scan.generation,
    expectedLifecycleVersion: 3
  };
  await host.finalizeScanEnumeration({
    ...identity,
    rootToEnd: true,
    continuityBroken: false,
    enumerationErrorCount: 0
  });
  assert.deepEqual(await host.enqueueScanSweep(identity), { enqueued: 1 });
  const swept = await host.runScanSweep(identity);
  assert.equal(swept.deleted, 1);
  assert.equal((await host.getCounts()).tracks, 0);
  assertTrackArtworkRemoved(dbPath, trackUid, artworkId);
});

test('scan sweep deletes one bounded track page per catalog transaction', async t => {
  const { directory, host } = await openCatalog(t);
  await seedFolder(host, directory);
  await host.upsertTracks(Array.from({ length: 205 }, (_, index) => createTrack(index + 1)));
  const scan = await host.beginScanFolder({
    scanId: 'scan-sweep-batch',
    folderId: 'folder_music',
    normalizedRoot: directory,
    expectedLifecycleVersion: 3,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'INELIGIBLE'
  });
  const identity = {
    scanId: 'scan-sweep-batch',
    folderId: 'folder_music',
    generation: scan.generation,
    expectedLifecycleVersion: 3
  };
  await host.finalizeScanEnumeration({
    ...identity,
    rootToEnd: true,
    continuityBroken: false,
    enumerationErrorCount: 0
  });
  assert.deepEqual(await host.enqueueScanSweep(identity), { enqueued: 205 });

  assert.equal((await host.runScanSweep(identity)).deleted, 100);
  assert.equal((await host.runScanSweep(identity)).deleted, 100);
  assert.equal((await host.runScanSweep(identity)).deleted, 5);
  assert.deepEqual(await host.runScanSweep(identity), { deleted: 0, hasMore: false });
  await host.completeScanFolder({ ...identity, status: 'completed' });
  assert.equal((await host.getCounts()).tracks, 0);
});

test('startup recovery finishes an eligible sweep before an immediate newer generation', async t => {
  const { directory, dbPath } = createTempCatalog(t);
  let host = await LibraryCatalogHost.open({ dbPath });
  t.after(() => host?.close());
  await seedFolder(host, directory);
  const tracks = Array.from({ length: 206 }, (_, index) => createTrack(index + 1));
  await host.upsertTracks(tracks);
  await host.createPlaylistWithItems({
    playlistId: 'scan-sweep-recovery-playlist',
    name: 'Scan sweep recovery',
    items: [{ trackUid: tracks[0].trackUid }],
    createdAt: 1
  });

  const scan = await host.beginScanFolder({
    scanId: 'scan-sweep-recovery',
    folderId: 'folder_music',
    normalizedRoot: directory,
    expectedLifecycleVersion: 3,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'PENDING'
  });
  const identity = {
    scanId: scan.scanId,
    folderId: scan.folderId,
    generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion
  };
  const keep = tracks.at(-1);
  const observation = {
    relativePath: keep.relativePath,
    path: path.join(directory, keep.relativePath),
    fileIdentity: 'keep-file',
    size: 123,
    mtimeMs: 456,
    logicalCandidates: [{
      logicalStorageId: `file:${keep.relativePath}`,
      relativePath: keep.relativePath,
      path: path.join(directory, keep.relativePath),
      sourceKind: 'file'
    }]
  };
  await host.commitScanSeenBatch({
    ...identity,
    observations: [observation],
    maxTracks: 500,
    maxBytes: 4 * 1024 * 1024,
    lastCommittedBatch: 1,
    cursor: { lastRelativePath: keep.relativePath, visitedFiles: 1, committedBatches: 1 }
  });
  await host.finalizeScanEnumeration({
    ...identity,
    rootToEnd: true,
    continuityBroken: false,
    enumerationErrorCount: 0,
    requestedSweepEligibility: 'ELIGIBLE'
  });
  assert.deepEqual(await host.enqueueScanSweep(identity), { enqueued: 205 });
  const firstChunk = await host.runScanSweep(identity);
  assert.equal(firstChunk.deleted, 100);
  assert.equal(firstChunk.hasMore, true);
  assert.deepEqual(await host.pauseScanFolder({
    ...identity,
    status: 'paused',
    stopReason: 'user',
    continuityBroken: true,
    sweepEligibility: 'INELIGIBLE'
  }), { status: 'sweeping', destructiveCommitRetained: true });
  assert.equal((await host.getCounts()).tracks, 106);
  await host.close();

  host = await LibraryCatalogHost.open({ dbPath });
  const nextScan = await host.beginScanFolder({
    scanId: 'scan-after-sweep-recovery',
    folderId: 'folder_music',
    normalizedRoot: directory,
    expectedLifecycleVersion: 3,
    resume: false,
    rootEnumerationRequired: true,
    continuityBroken: false,
    sweepEligibility: 'PENDING'
  });

  assert.equal(nextScan.generation, scan.generation + 1);
  assert.equal((await host.getCounts()).tracks, 1);
  assert.ok(await host.getTrack(keep.trackUid));
  const playlist = await host.queryPlaylistItems({
    playlistId: 'scan-sweep-recovery-playlist',
    limit: 10
  });
  assert.equal(playlist.items[0].trackUid, null);
  assert.equal(playlist.items[0].unresolved.reason, 'source-removed');
  assert.equal(playlist.playlist.version, 1);

  const database = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual({ ...database.prepare(`
      SELECT status, sweep_eligibility AS sweepEligibility,
        continuity_broken AS continuityBroken
      FROM scan_run_folders WHERE scan_id = ? AND folder_id = ?
    `).get(identity.scanId, identity.folderId) }, {
      status: 'completed',
      sweepEligibility: 'ELIGIBLE',
      continuityBroken: 0
    });
    assert.deepEqual({ ...database.prepare(`
      SELECT status, generation FROM scan_run_folders
      WHERE scan_id = ? AND folder_id = ?
    `).get(nextScan.scanId, nextScan.folderId) }, {
      status: 'enumerating',
      generation: nextScan.generation
    });
    assert.equal(database.prepare(`
      SELECT count(*) AS count FROM deletion_jobs
      WHERE kind = 'scan-sweep' AND state <> 'completed'
    `).get().count, 0);
    assert.equal(database.prepare('SELECT count(*) AS count FROM deletion_repair_items').get().count, 0);
  } finally {
    database.close();
  }
  await host.close();
});

test('folder deletion receipt resumes bounded playlist repair after worker restart', async t => {
  const { directory, dbPath } = createTempCatalog(t);
  let host = await LibraryCatalogHost.open({ dbPath });
  t.after(() => host?.close());
  await seedFolder(host, directory);
  await host.upsertTracks([createTrack(1)]);
  await host.createPlaylistWithItems({
    playlistId: 'delete-playlist',
    name: 'Delete playlist',
    operationId: null,
    items: Array.from({ length: 101 }, () => ({ trackUid: 'track_000001' })),
    createdAt: 1
  });
  const firstChunk = await host.removeScanFolder({
    folderId: 'folder_music',
    expectedLifecycleVersion: 3
  });
  assert.equal(firstChunk.folderId, 'folder_music');
  assert.equal(firstChunk.lifecycleVersion, 4);
  assert.equal(firstChunk.deleted, 0);
  assert.equal(firstChunk.hasMore, true);
  await host.close();

  host = await LibraryCatalogHost.open({ dbPath });
  const page = await host.queryPlaylistItems({ playlistId: 'delete-playlist', limit: 200 });
  assert.equal((await host.getCounts()).tracks, 0);
  assert.equal(page.items.length, 101);
  assert.ok(page.items.every(item => item.trackUid === null && item.unresolved?.reason === 'source-removed'));
  await host.close();
});

test('startup deletion maintenance leaves normal catalog reads responsive', async t => {
  const { directory, dbPath } = createTempCatalog(t);
  let host = await LibraryCatalogHost.open({ dbPath });
  t.after(() => host?.close());
  await host.upsertFolders([{
    id: 'folder_music', kind: 'electron', displayName: 'Removed', path: directory,
    status: 'ok', lifecycleVersion: 3
  }, {
    id: 'folder_keep', kind: 'electron', displayName: 'Kept', path: path.join(directory, 'kept'),
    status: 'ok', lifecycleVersion: 1
  }]);
  await host.upsertTracks(Array.from({ length: 1000 }, (_, index) => createTrack(index + 1)));
  await host.upsertTracks([createTrack(1001, {
    trackUid: 'track_keep', folderId: 'folder_keep', relativePath: 'Keep.flac',
    fileName: 'Keep.flac', title: 'Keep'
  })]);
  const firstChunk = await host.removeScanFolder({
    folderId: 'folder_music', expectedLifecycleVersion: 3
  });
  assert.equal(firstChunk.deleted, 100);
  assert.equal(firstChunk.hasMore, true);
  await host.close();

  host = await LibraryCatalogHost.open({ dbPath });
  const invalidations = [];
  host.on('invalidation', event => invalidations.push(event));
  const counts = await host.getCounts();
  const page = await host.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 10 });
  const remaining = await host.getScanFolderTrackCount({ folderId: 'folder_music' });
  assert.equal(counts.tracks, 1);
  assert.deepEqual(page.rows.map(row => row.trackUid), ['track_keep']);
  assert.ok(remaining.trackCount > 0, 'catalog reads must complete before background deletion finishes');
  const deadline = Date.now() + 5_000;
  let cleanup = remaining;
  do {
    await new Promise(resolve => setTimeout(resolve, 10));
    cleanup = await host.getScanFolderTrackCount({ folderId: 'folder_music' });
  } while (cleanup.trackCount > 0 && Date.now() < deadline);
  assert.equal(cleanup.trackCount, 0);
  assert.deepEqual(invalidations, [], 'logically invisible cleanup must not refresh Library pages');
  await host.close();
});

test('startup maintenance rebinds playlist survivors from interrupted scan deletion repair items', async t => {
  const { directory, dbPath } = createTempCatalog(t);
  let host = await LibraryCatalogHost.open({ dbPath });
  t.after(() => host?.close());
  await seedFolder(host, directory);
  await host.upsertTracks([createTrack(1)]);
  await host.createPlaylistWithItems({
    playlistId: 'repair-playlist',
    name: 'Repair playlist',
    operationId: null,
    items: Array.from({ length: 101 }, () => ({ trackUid: 'track_000001' })),
    createdAt: 1
  });
  await host.close();
  await runSqliteWorker(dbPath, 'seed-deletion-repair');

  host = await LibraryCatalogHost.open({ dbPath });
  const deadline = Date.now() + 5_000;
  let page;
  do {
    page = await host.queryPlaylistItems({ playlistId: 'repair-playlist', limit: 200 });
    if (page.items.every(item => item.trackUid === 'track_000001')) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assert.equal(page.items.length, 101);
  assert.ok(page.items.every(item => item.trackUid === 'track_000001' && item.unresolved == null));
  assert.ok(await host.getTrack('track_000001'));
  await host.close();
});

function runSqliteWorker(dbPath, mode) {
  const source = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(workerData.dbPath);
    database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    if (workerData.mode === 'seed') {
      database.prepare(\`
        INSERT INTO operation_jobs(
          operation_id, client_request_id, request_digest, canonical_request_version,
          operation_kind, phase, heavy, committed, source_context_token, created_at, updated_at
        ) VALUES ('op', 'request', 'digest', 1, 'bulk', 'READY', 1, 0, 'context', 1, 1)
      \`).run();
      database.prepare(\`
        INSERT INTO snapshot_objects(
          snapshot_id, snapshot_kind, state, staging_operation_id, owner_ref_count, created_at
        ) VALUES ('snapshot', 'selection', 'staging', 'op', 0, 1)
      \`).run();
      database.prepare(\`
        INSERT INTO playlists(id, name, sort_name, state, building_operation_id, version, created_at, updated_at)
        VALUES ('playlist', 'Playlist', 'playlist', 'building', 'op', 0, 1, 1)
      \`).run();
      parentPort.postMessage({ ok: true });
    } else if (workerData.mode === 'seed-deletion-repair') {
      database.prepare(\`
        INSERT INTO deletion_jobs(
          job_id, kind, state, cursor_key, folder_id, lifecycle_version, track_uid, scan_id,
          created_at, updated_at
        ) VALUES ('scan-sweep:interrupted', 'scan-sweep', 'blocked-interrupted', NULL,
          'folder_music', 3, 'track_000001', 'interrupted-scan', 1, 1)
      \`).run();
      database.prepare(\`
        INSERT INTO deletion_repair_items(job_id, item_key, original_track_uid, state)
        SELECT 'scan-sweep:interrupted', item_key, 'track_000001', 'downgraded'
        FROM playlist_items WHERE playlist_id = 'repair-playlist'
        ORDER BY item_key LIMIT 100
      \`).run();
      database.prepare(\`
        UPDATE playlist_items SET track_uid = NULL,
          unresolved_json = '{"version":1,"reason":"source-removed"}'
        WHERE item_key IN (
          SELECT item_key FROM deletion_repair_items WHERE job_id = 'scan-sweep:interrupted'
        )
      \`).run();
      parentPort.postMessage({ ok: true });
    } else {
      parentPort.postMessage({
        operation: database.prepare(\`
          SELECT phase, terminal_kind, terminal_code, committed, context_released
          FROM operation_jobs WHERE operation_id = 'op'
        \`).get(),
        snapshotCount: Number(database.prepare(\`
          SELECT count(*) AS count FROM snapshot_objects
        \`).get().count),
        snapshot: database.prepare(\`
          SELECT state, staging_operation_id FROM snapshot_objects WHERE snapshot_id = 'snapshot'
        \`).get(),
        playlist: database.prepare(\`
          SELECT state, building_operation_id FROM playlists WHERE id = 'playlist'
        \`).get(),
        foreignKeys: Number(database.prepare('PRAGMA foreign_keys').get().foreign_keys),
        journalMode: database.prepare('PRAGMA journal_mode').get().journal_mode
      });
    }
    database.close();
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(source, { eval: true, workerData: { dbPath, mode } });
    let payload;
    worker.once('message', value => { payload = value; });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) {
        reject(new Error(`SQLite fixture worker exited with code ${code}`));
      } else if (payload === undefined) {
        reject(new Error('SQLite fixture worker exited without a result'));
      } else {
        resolve(payload);
      }
    });
  });
}
