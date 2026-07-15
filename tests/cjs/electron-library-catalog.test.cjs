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
    t.after(() => fs.rmSync(directory, {
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
    fs.rmSync(fixture.directory, {
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
  assert.equal(capabilities.schemaVersion, 2);
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
  assert.equal(Object.hasOwn(page.rows[0], 'path'), false);
  assert.equal(Object.hasOwn(page.rows[0], 'relativePath'), false);
  assert.equal(Object.hasOwn(page.rows[0], 'rootPath'), false);
  const contextTrack = await host.lookupContextTrack({
    contextToken: page.contextToken,
    trackUid: 'track_source'
  });
  assert.equal(contextTrack.title, 'Source Track');
  assert.equal(contextTrack.catalogVersion, page.catalogVersion);
  assert.equal(await host.lookupContextTrack({
    contextToken: page.contextToken,
    trackUid: 'missing'
  }), null);
  await host.upsertTracks([createTrack(1, {
    trackUid: 'track_source',
    relativePath: 'Album/Track.flac',
    fileName: 'Track.flac',
    title: 'Updated Track'
  })]);
  assert.equal((await host.lookupContextTrack({
    contextToken: page.contextToken,
    trackUid: 'track_source'
  })).title, 'Source Track');

  const track = await host.getTrack('track_source');
  assert.equal(track.fileName, 'Track.flac');
  assert.equal(Object.hasOwn(track, 'relativePath'), false);
  const source = await host.resolvePlaybackSource('track_source');
  assert.deepEqual(source, {
    kind: 'electron-file',
    trackUid: 'track_source',
    folderId: 'folder_music',
    lifecycleVersion: 3,
    path: fs.realpathSync.native(sourcePath)
  });
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
  assert.equal(state.sequenceOwnerCount, 0);
  assert.deepEqual(state.playlist, { state: 'deleted', building_operation_id: null });
  assert.equal(state.foreignKeys, 1);
  assert.equal(state.journalMode, 'wal');
  assert.equal(fs.existsSync(directory), true);
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
  const deadline = Date.now() + 5_000;
  while ((await host.getCounts()).tracks !== 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await host.getCounts()).tracks, 0);
  const page = await host.queryPlaylistItems({ playlistId: 'delete-playlist', limit: 200 });
  assert.equal(page.items.length, 101);
  assert.ok(page.items.every(item => item.trackUid === null && item.unresolved?.reason === 'source-removed'));
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
        INSERT INTO playback_sequences(id, source_context, catalog_version, state, created_at)
        VALUES ('sequence', 'context', 0, 'active', 1)
      \`).run();
      database.prepare(\`
        INSERT INTO playback_sequence_operation_owners(sequence_id, operation_id)
        VALUES ('sequence', 'op')
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
        sequenceOwnerCount: Number(database.prepare(\`
          SELECT count(*) AS count FROM playback_sequence_operation_owners WHERE operation_id = 'op'
        \`).get().count),
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
