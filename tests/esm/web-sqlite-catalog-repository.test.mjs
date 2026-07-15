import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import vm from 'node:vm';

import { WebSqliteCatalogRepository } from '../../js/library/repository/web-catalog-repository.js';
import { MUSIC_LIBRARY_V2_WEB_OPFS_DIRECTORY } from '../../js/library/repository/schema-v2.js';
import {
  dispatchWebSqliteCommand,
  initializeWebSqliteRuntime
} from '../../js/library/repository/web-sqlite-runtime.js';
import { createConsoleHarness, withGlobals } from '../helpers/global-test-utils.mjs';

test('Web SQLite repository maps OPFS, full, busy, and corruption failures to stable codes', async () => {
  for (const [failure, expectedCode] of [
    [Object.assign(new Error('Missing required OPFS APIs'), { resultCode: 14 }), 'opfsUnavailable'],
    [Object.assign(new Error('database or disk is full'), { resultCode: 13 }), 'insufficientStorage'],
    [Object.assign(new Error('database is locked'), { resultCode: 5 }), 'concurrentUseUnsupported'],
    [Object.assign(new Error('database disk image is malformed'), { resultCode: 11 }), 'catalogCorrupt']
  ]) {
    const repository = new WebSqliteCatalogRepository({
      authority: 'test',
      sqliteFactory: async () => { throw failure; }
    });
    await assert.rejects(
      repository.open(),
      error => error?.code === expectedCode && !error.message.includes(failure.message)
    );
  }
});

test('Web SQLite repository treats context expiry as an expected refresh signal', async () => {
  const failure = Object.assign(new Error('Catalog context snapshot has expired'), {
    code: 'STALE_CURSOR'
  });
  const repository = new WebSqliteCatalogRepository({
    authority: 'test',
    sqliteFactory: async () => { throw failure; }
  });
  const loggedErrors = [];
  await withGlobals({
    console: createConsoleHarness({ error: (...args) => loggedErrors.push(args) })
  }, async () => {
    await assert.rejects(
      repository.open(),
      error => error?.code === 'STALE_CURSOR' && !error.message.includes(failure.message)
    );
  });
  assert.deepEqual(loggedErrors, []);
});

test('Web catalog reset clears only the fixed Music Library OPFS pool', async () => {
  const installs = [];
  const repository = new WebSqliteCatalogRepository({
    authority: 'test',
    sqliteFactory: async () => ({
      async installOpfsSAHPoolVfs(options) {
        installs.push(options);
        throw new Error('stop after observing the fixed pool');
      }
    })
  });

  await assert.rejects(repository.resetCatalog());
  await assert.rejects(repository.open());
  assert.deepEqual(installs, [
    {
      directory: `/${MUSIC_LIBRARY_V2_WEB_OPFS_DIRECTORY}`,
      initialCapacity: 4,
      clearOnInit: true
    },
    {
      directory: `/${MUSIC_LIBRARY_V2_WEB_OPFS_DIRECTORY}`,
      initialCapacity: 4,
      clearOnInit: false
    }
  ]);
});

test('shared schema-v2 is the only catalog DDL source for Electron and Web runtimes', () => {
  for (const url of [
    new URL('../../electron/library-catalog-worker.cjs', import.meta.url),
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url)
  ]) {
    const source = fs.readFileSync(url, 'utf8');
    assert.doesNotMatch(source, /\b(?:CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE)\b/i);
  }
});

test('Web catalog implementation does not open an IndexedDB catalog', () => {
  const source = fs.readFileSync(
    new URL('../../js/library/repository/web-catalog-repository.js', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /indexedDB|IDBDatabase|openDatabase/i);
  assert.match(source, /installOpfsSAHPoolVfs/);
});

test('Electron and Web catalogs expose the scan-folder track-count command', () => {
  for (const url of [
    new URL('../../electron/library-catalog-worker.cjs', import.meta.url),
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url)
  ]) {
    const source = fs.readFileSync(url, 'utf8');
    assert.match(source, /case 'getScanFolderTrackCount': return getScanFolderTrackCount\(payload\)/);
    assert.match(source, /function getScanFolderTrackCount\(payload\)/);
  }
});

test('Web SQLite tombstones hide removed-folder tracks and related entities before deletion completes', () => {
  const source = fs.readFileSync(
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /const ACTIVE_TRACK_FOLDER_CLAUSE = `EXISTS\([\s\S]*active_folder\.status <> 'removed'/);
  assert.match(source, /function createContextFilter\([\s\S]*const clauses = \[context\.scope\?\.playlistId[\s\S]*ACTIVE_TRACK_FOLDER_CLAUSE/);
  for (const [membershipTable, keyColumn] of [
    ['track_albums', 'album_key'],
    ['track_artists', 'artist_key'],
    ['track_genres', 'genre_key'],
    ['track_subfolders', 'subfolder_key']
  ]) {
    assert.match(source, new RegExp(`createActiveEntityMembershipClause\\('${membershipTable}', '${keyColumn}'\\)`));
  }
});

test('Web contexts stale atomically on folder tombstone, overflow, and retained scope changes', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-context-stale-'));
  const database = new DatabaseSync(path.join(directory, 'catalog.sqlite'));
  let runtimeOpen = false;
  t.after(() => {
    if (runtimeOpen) dispatchWebSqliteCommand('close', {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await initializeWebSqliteRuntime(database, {
    storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
  });
  runtimeOpen = true;

  dispatchWebSqliteCommand('upsertFolders', {
    folders: [1, 2].map(index => ({
      id: `folder-${index}`,
      kind: 'web-fsa',
      displayName: `Folder ${index}`,
      path: `/fsa/folder-${index}`,
      status: 'ok',
      scanGeneration: 0,
      lifecycleVersion: 0,
      addedAt: index,
      lastScanAt: null
    }))
  });
  dispatchWebSqliteCommand('upsertTracks', {
    tracks: [1, 2].map(index => ({
      trackUid: `track-${index}`,
      folderId: `folder-${index}`,
      relativePath: `Track-${index}.flac`,
      title: `Track ${index}`,
      artist: 'Artist',
      addedAt: index,
      updatedAt: index
    }))
  });

  const oldContext = dispatchWebSqliteCommand('createContext', {
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc', scope: null
  });
  assert.equal(dispatchWebSqliteCommand('getContextCount', {
    contextToken: oldContext.contextToken
  }).totalCount, 2);
  dispatchWebSqliteCommand('removeScanFolder', {
    folderId: 'folder-1', expectedLifecycleVersion: 0
  });
  assert.throws(
    () => dispatchWebSqliteCommand('getContextCount', { contextToken: oldContext.contextToken }),
    error => error?.code === 'STALE_CURSOR'
  );
  const currentContext = dispatchWebSqliteCommand('createContext', {
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc', scope: null
  });
  assert.equal(dispatchWebSqliteCommand('getContextCount', {
    contextToken: currentContext.contextToken
  }).totalCount, 1);

  const overflowContext = dispatchWebSqliteCommand('createContext', {
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc', scope: null
  });
  dispatchWebSqliteCommand('retainContext', { contextToken: overflowContext.contextToken });
  database.prepare(`
    UPDATE query_contexts SET snapshot_overflow = 1 WHERE context_token = ?
  `).run(overflowContext.contextToken);
  assert.throws(
    () => dispatchWebSqliteCommand('getContextCount', { contextToken: overflowContext.contextToken }),
    error => error?.code === 'STALE_CURSOR'
  );
  assert.deepEqual(
    dispatchWebSqliteCommand('releaseRetainedContext', { contextToken: overflowContext.contextToken }),
    { released: true }
  );
  assert.deepEqual({ ...database.prepare(`
    SELECT owner_count AS ownerCount, expires_at AS expiresAt
    FROM query_contexts WHERE context_token = ?
  `).get(overflowContext.contextToken) }, { ownerCount: 0, expiresAt: 0 });

  dispatchWebSqliteCommand('createPlaylist', {
    playlistId: 'playlist-1', name: 'Playlist', createdAt: 10
  });
  const scopedContext = dispatchWebSqliteCommand('createContext', {
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc',
    scope: { playlistId: 'playlist-1' }
  });
  dispatchWebSqliteCommand('retainContext', { contextToken: scopedContext.contextToken });
  dispatchWebSqliteCommand('renamePlaylist', {
    playlistId: 'playlist-1', name: 'Renamed', expectedVersion: 0, updatedAt: 11
  });
  assert.throws(
    () => dispatchWebSqliteCommand('getContextCount', { contextToken: scopedContext.contextToken }),
    error => error?.code === 'STALE_CURSOR'
  );
  dispatchWebSqliteCommand('releaseRetainedContext', { contextToken: scopedContext.contextToken });
  assert.equal(database.prepare(`
    SELECT owner_count AS ownerCount FROM query_contexts WHERE context_token = ?
  `).get(scopedContext.contextToken).ownerCount, 0);

  const releasedContext = dispatchWebSqliteCommand('createContext', {
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc', scope: null
  });
  dispatchWebSqliteCommand('retainContext', { contextToken: releasedContext.contextToken });
  assert.deepEqual(
    dispatchWebSqliteCommand('releaseContext', { contextToken: releasedContext.contextToken }),
    { released: true, retained: true }
  );
  assert.equal(dispatchWebSqliteCommand('getContextCount', {
    contextToken: releasedContext.contextToken
  }).totalCount, 1);
  dispatchWebSqliteCommand('releaseRetainedContext', { contextToken: releasedContext.contextToken });
  assert.deepEqual({ ...database.prepare(`
    SELECT owner_count AS ownerCount, expires_at AS expiresAt
    FROM query_contexts WHERE context_token = ?
  `).get(releasedContext.contextToken) }, { ownerCount: 0, expiresAt: 0 });
});

test('Web SQLite deletion tombstones an offline folder', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-offline-folder-removal-'));
  const database = new DatabaseSync(path.join(directory, 'catalog.sqlite'));
  let runtimeOpen = false;
  t.after(() => {
    if (runtimeOpen) dispatchWebSqliteCommand('close', {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await initializeWebSqliteRuntime(database, {
    storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
  });
  runtimeOpen = true;

  const folder = {
    id: 'folder-offline',
    kind: 'web-fsa',
    displayName: 'Offline',
    path: '/fsa/folder-offline',
    status: 'ok',
    scanGeneration: 0,
    lifecycleVersion: 0,
    addedAt: 1,
    lastScanAt: null
  };
  dispatchWebSqliteCommand('upsertFolders', { folders: [folder] });
  dispatchWebSqliteCommand('upsertTracks', {
    tracks: [{
      trackUid: 'track-offline',
      folderId: folder.id,
      relativePath: 'Track.flac',
      title: 'Track',
      artist: 'Artist',
      addedAt: 1,
      updatedAt: 1
    }]
  });
  dispatchWebSqliteCommand('upsertFolders', {
    folders: [{ ...folder, status: 'offline' }]
  });

  assert.deepEqual(dispatchWebSqliteCommand('removeScanFolder', {
    folderId: folder.id,
    expectedLifecycleVersion: 0
  }), {
    folderId: folder.id,
    lifecycleVersion: 1,
    deleted: 1,
    hasMore: false
  });
  assert.deepEqual({ ...database.prepare(`
    SELECT status, lifecycle_version AS lifecycleVersion, path FROM folders WHERE id = ?
  `).get(folder.id) }, {
    status: 'removed',
    lifecycleVersion: 1,
    path: null
  });
  assert.deepEqual(dispatchWebSqliteCommand('removeScanFolder', {
    folderId: folder.id,
    expectedLifecycleVersion: 0
  }), {
    folderId: folder.id,
    lifecycleVersion: 1,
    deleted: 0,
    hasMore: false
  });
  assert.throws(
    () => dispatchWebSqliteCommand('removeScanFolder', {
      folderId: folder.id,
      expectedLifecycleVersion: 1
    }),
    error => error?.code === 'staleFolderLifecycle'
  );
});

test('Web context snapshot size is not rescanned while its shadow row count is unchanged', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-context-wal-cache-'));
  const database = new DatabaseSync(path.join(directory, 'catalog.sqlite'));
  let snapshotAggregateReads = 0;
  let runtimeOpen = false;
  const instrumentedDatabase = {
    exec(sql) {
      return database.exec(sql);
    },
    prepare(sql) {
      if (/SELECT COALESCE\(sum\([\s\S]*FROM query_context_track_before_images/.test(sql)) {
        snapshotAggregateReads += 1;
      }
      return database.prepare(sql);
    },
    close() {
      return database.close();
    }
  };
  t.after(() => {
    if (runtimeOpen) dispatchWebSqliteCommand('close', {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await initializeWebSqliteRuntime(instrumentedDatabase, {
    storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
  });
  runtimeOpen = true;

  dispatchWebSqliteCommand('upsertFolders', {
    folders: [{
      id: 'folder-1',
      kind: 'web-fsa',
      displayName: 'Folder',
      path: '/fsa/folder-1',
      status: 'ok',
      scanGeneration: 0,
      lifecycleVersion: 0,
      addedAt: 1,
      lastScanAt: null
    }]
  });
  const tracks = Array.from({ length: 6 }, (_, index) => ({
    trackUid: `track-${index}`,
    folderId: 'folder-1',
    relativePath: `Track-${index}.flac`,
    title: `Track ${String(index).padStart(2, '0')}`,
    artist: 'Artist',
    addedAt: index,
    updatedAt: index
  }));
  dispatchWebSqliteCommand('upsertTracks', { tracks });
  const context = dispatchWebSqliteCommand('createContext', {
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc', scope: null
  });
  dispatchWebSqliteCommand('upsertTracks', {
    tracks: [{ ...tracks[0], title: 'Changed after snapshot', updatedAt: 100 }]
  });

  const lastPage = dispatchWebSqliteCommand('readContextPageAtOrdinal', {
    contextToken: context.contextToken,
    ordinal: 5,
    limit: 2
  });
  assert.deepEqual(lastPage.rows.map(row => row.title), ['Track 04', 'Track 05']);
  assert.equal(snapshotAggregateReads, 1);

  const firstPage = dispatchWebSqliteCommand('readContextPage', {
    contextToken: context.contextToken,
    cursor: null,
    limit: 2
  });
  assert.deepEqual(firstPage.rows.map(row => row.title), ['Track 00', 'Track 01']);
  assert.equal(snapshotAggregateReads, 1);
});

test('Web SQLite statfs shim exposes total capacity for proportional artwork admission', () => {
  const source = fs.readFileSync(
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url),
    'utf8'
  );
  assert.match(source, /statfsSync\(\)[\s\S]*return \{ bsize: 1, blocks, bavail:/);
});

test('Electron and Web playlist context pages expose resolved and unresolved aggregates', () => {
  for (const url of [
    new URL('../../electron/library-catalog-worker.cjs', import.meta.url),
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url)
  ]) {
    const source = fs.readFileSync(url, 'utf8');
    assert.match(source, /AS resolvedCount/);
    assert.match(source, /resolvedCount: counts\.resolvedCount/);
    assert.match(source, /unresolvedCount: counts\.unresolvedCount/);
  }
});

test('Electron and Web playlist pages keep tombstoned sources visible as unresolved and version actual repairs', () => {
  for (const url of [
    new URL('../../electron/library-catalog-worker.cjs', import.meta.url),
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url)
  ]) {
    const source = fs.readFileSync(url, 'utf8');
    assert.match(source, /const ACTIVE_PLAYLIST_TRACK_CLAUSE = `\(i\.track_uid IS NOT NULL AND/);
    assert.match(source, /CASE WHEN \$\{ACTIVE_PLAYLIST_TRACK_CLAUSE\} THEN i\.track_uid ELSE NULL END AS trackUid/);
    assert.match(source, /COALESCE\(sum\(CASE WHEN \$\{ACTIVE_PLAYLIST_TRACK_CLAUSE\} THEN 1 ELSE 0 END\), 0\) AS resolvedCount/);
    assert.match(source, /const changed = repair\.run\([\s\S]*Number\(changed\.changes\) !== 1[\s\S]*affectedPlaylists\.add\(item\.playlistId\)/);
    assert.match(source, /function bumpActivePlaylistVersions\([\s\S]*WHERE id = \? AND state = 'active'/);
  }
});

test('Web scan sweep uses bounded pages and yields to the Worker task queue between pages', async () => {
  const runtime = fs.readFileSync(
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url),
    'utf8'
  );
  const sweepStart = runtime.indexOf('function runScanSweep');
  const sweepEnd = runtime.indexOf('\n}\n\nfunction repairPlaylistItemsForTrack', sweepStart);
  const sweep = runtime.slice(sweepStart, sweepEnd);
  assert.match(sweep, /ORDER BY t\.track_key LIMIT \?/);
  assert.match(sweep, /FOLDER_DELETION_TRACKS_PER_CHUNK/);
  assert.doesNotMatch(sweep, /LIMIT 1\b/);

  const repository = fs.readFileSync(
    new URL('../../js/library/repository/web-catalog-repository.js', import.meta.url),
    'utf8'
  );
  assert.match(repository, /async runScanSweep\([\s\S]*const result = await this\.#call\('runScanSweep'[\s\S]*result\?\.hasMore === true[\s\S]*setTimeout\(resolve, 0\)/);

  const methodStart = repository.indexOf('  async runScanSweep');
  const methodEnd = repository.indexOf('\n  completeScanFolder', methodStart);
  assert.notEqual(methodStart, -1);
  assert.notEqual(methodEnd, -1);
  const method = repository.slice(methodStart, methodEnd);
  let yieldCount = 0;
  const SweepHarness = vm.runInNewContext(`
    class SweepHarness {
      #call() { return Promise.resolve({ deleted: 100, hasMore: true }); }
      ${method}
    }
    SweepHarness;
  `, {
    Promise,
    setTimeout(callback, delay) {
      assert.equal(delay, 0);
      yieldCount += 1;
      callback();
    }
  });
  const result = await new SweepHarness().runScanSweep({});
  assert.equal(result.deleted, 100);
  assert.equal(result.hasMore, true);
  assert.equal(yieldCount, 1);
});

test('Web automatic playlist import resolves its trusted same-folder path before portable fallback', () => {
  const coordinator = fs.readFileSync(
    new URL('../../js/library/operations/web-library-service-coordinator.js', import.meta.url),
    'utf8'
  );
  assert.match(coordinator, /origin: automaticSource \? \{[\s\S]*folderId: automaticSource\.folderId,[\s\S]*playlistRelativePath: automaticSource\.relativePath/);
  assert.match(coordinator, /appendPlaylistImportRecords\(\{[\s\S]*playlistId, operationId, records: batch, origin/);

  const runtime = fs.readFileSync(
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url),
    'utf8'
  );
  assert.match(runtime, /const trustedOriginMatch = resolveImportedTrackFromOrigin\(unresolved\);[\s\S]*if \(trustedOriginMatch\) return trustedOriginMatch/);
  assert.match(runtime, /WHERE t\.folder_id = \? AND t\.relative_path = \? COLLATE NOCASE[\s\S]*LIMIT 2/);
  assert.match(runtime, /path\.posix\.dirname\(playlistRelativePath\)/);
});

test('Web playlist import resolves an absolute root path beyond the ambiguous candidate limit', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-playlist-resolve-'));
  const database = new DatabaseSync(path.join(directory, 'catalog.sqlite'));
  let runtimeOpen = false;
  t.after(() => {
    if (runtimeOpen) dispatchWebSqliteCommand('close', {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await initializeWebSqliteRuntime(database, {
    storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
  });
  runtimeOpen = true;

  dispatchWebSqliteCommand('upsertFolders', {
    folders: [
      ['folder-playlist', 'Decoys'],
      ['folder-exact', 'RootName'],
      ['folder-other', 'OtherRoot']
    ].map(([id, displayName], index) => ({
      id, kind: 'web-fsa', displayName,
      path: `/fsa/${id}`, status: 'ok', scanGeneration: 0, lifecycleVersion: 0,
      addedAt: index + 1, lastScanAt: null
    }))
  });
  const decoys = Array.from({ length: 257 }, (_, index) => ({
    trackUid: `track-${String(index).padStart(3, '0')}`,
    folderId: 'folder-playlist',
    relativePath: `Decoy-${index}/Shared.flac`,
    title: `Decoy ${index}`,
    artist: 'Artist',
    addedAt: index + 1,
    updatedAt: index + 1
  }));
  dispatchWebSqliteCommand('upsertTracks', {
    tracks: [
      ...decoys,
      {
        trackUid: 'zz-track-exact',
        folderId: 'folder-exact',
        relativePath: 'Exact/Shared.flac',
        title: 'Exact',
        artist: 'Artist',
        addedAt: 1000,
        updatedAt: 1000
      },
      {
        trackUid: 'zy-track-other-root',
        folderId: 'folder-other',
        relativePath: 'Exact/Shared.flac',
        title: 'Other root',
        artist: 'Artist',
        addedAt: 1001,
        updatedAt: 1001
      }
    ]
  });

  const playlistId = 'playlist-exact-path';
  const received = dispatchWebSqliteCommand('receiveOperation', {
    clientRequestId: 'request-exact-path',
    requestDigest: 'digest-exact-path',
    canonicalRequestVersion: 1,
    operationKind: 'previewPlaylistImport',
    target: { playlistId },
    expectedTargetVersion: 0,
    sourceContextToken: null,
    sourceSequenceIds: [],
    sourceSequenceItemCount: 0,
    buildDeadlineAt: 2000,
    receivedAt: 1000
  });
  assert.equal(received.kind, 'created');
  dispatchWebSqliteCommand('createPlaylist', {
    playlistId, name: 'Exact path', operationId: received.operationId, createdAt: 1000
  });
  dispatchWebSqliteCommand('appendPlaylistImportRecords', {
    origin: null,
    playlistId,
    operationId: received.operationId,
    records: [{ type: 'entry', entry: { path: 'C:/Archive/RootName/Exact/Shared.flac' } }]
  });

  const finalized = dispatchWebSqliteCommand('finalizePlaylistImportPage', {
    playlistId, operationId: received.operationId, afterPosition: 0, limit: 10
  });
  assert.equal(finalized.resolvedCount, 1);
  assert.equal(database.prepare(`
    SELECT track_uid AS trackUid FROM playlist_items WHERE playlist_id = ?
  `).get(playlistId).trackUid, 'zz-track-exact');
});

test('folder deletion batches tracks while foreground and maintenance work yield between chunks', () => {
  for (const url of [
    new URL('../../electron/library-catalog-worker.cjs', import.meta.url),
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url)
  ]) {
    const source = fs.readFileSync(url, 'utf8');
    assert.match(source, /const FOLDER_DELETION_TRACKS_PER_CHUNK = 100/);
    const chunkStart = source.indexOf('function runFolderDeletionChunkInTransaction');
    const chunkEnd = source.indexOf('\n}\n\nfunction ensureFolderDeletionJob', chunkStart);
    assert.notEqual(chunkStart, -1);
    assert.notEqual(chunkEnd, -1);
    const chunk = source.slice(chunkStart, chunkEnd);
    assert.match(chunk, /while \(deleted < FOLDER_DELETION_TRACKS_PER_CHUNK\)/);
    assert.match(chunk, /return \{ folderId, lifecycleVersion, deleted, hasMore: true \}/);

    const start = source.indexOf('function scheduleDeletionMaintenance()');
    const end = source.indexOf('\n}\n\nfunction runDeletionMaintenanceTurn', start);
    assert.notEqual(start, -1);
    assert.notEqual(end, -1);
    const scheduler = source.slice(start, end);
    assert.match(scheduler, /setTimeout\(/);
    assert.match(scheduler, /DELETION_MAINTENANCE_DELAY_MS/);
    assert.doesNotMatch(scheduler, /setImmediate|}, 0\)/);
  }

  const workerSource = fs.readFileSync(
    new URL('../../js/library/repository/web-catalog-worker.js', import.meta.url),
    'utf8'
  );
  assert.match(
    workerSource,
    /result\?\.hasMore === true \? BUSY_MAINTENANCE_DELAY_MS : 30_000/
  );

  const scanSource = fs.readFileSync(
    new URL('../../js/library/scan/web-scan-runtime.js', import.meta.url),
    'utf8'
  );
  const removalStart = scanSource.indexOf('async removeFolder');
  const removalEnd = scanSource.indexOf('\n  }\n\n  async requestArtwork', removalStart);
  const removal = scanSource.slice(removalStart, removalEnd);
  assert.match(removal, /setTimeout\(resolve, 0\)/);
  assert.doesNotMatch(removal, /FOLDER_REMOVAL_CHUNK_DELAY_MS|setTimeout\(resolve, 50\)/);
});

test('playlist re-resolution is queued once per completed folder scan outside the metadata hot path', () => {
  for (const url of [
    new URL('../../electron/library-catalog-worker.cjs', import.meta.url),
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url)
  ]) {
    const source = fs.readFileSync(url, 'utf8');
    const metadataStart = source.indexOf('function completeMetadataParseSuccess');
    const metadataEnd = source.indexOf('\n}\n\nfunction completeMetadataParseFailure', metadataStart);
    const terminalStart = source.indexOf('function setScanTerminal');
    const terminalEnd = source.indexOf('\n}\n\nfunction claimMetadataParse', terminalStart);
    assert.notEqual(metadataStart, -1);
    assert.notEqual(metadataEnd, -1);
    assert.notEqual(terminalStart, -1);
    assert.notEqual(terminalEnd, -1);
    assert.doesNotMatch(
      source.slice(metadataStart, metadataEnd),
      /ensurePlaylistResolutionJob|scheduleDeletionMaintenance/
    );
    assert.match(
      source.slice(terminalStart, terminalEnd),
      /ensurePlaylistResolutionJob\(identity\)/
    );
    assert.match(
      source,
      /listPlaylistResolutionCandidates\(identity\.folderId, identity\.lifecycleVersion, 0, 1\)/
    );
    assert.match(
      source,
      /function playlistResolutionJobId\(folderId, lifecycleVersion\)[\s\S]*`playlist-resolve:\$\{lifecycleVersion\}:\$\{folderId\}`/
    );
  }
});

test('scan entity aggregates are deferred to one durable phased post-scan job', () => {
  for (const url of [
    new URL('../../electron/library-catalog-worker.cjs', import.meta.url),
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url)
  ]) {
    const source = fs.readFileSync(url, 'utf8');
    const metadataStart = source.indexOf('function completeMetadataParseSuccess');
    const metadataEnd = source.indexOf('\n}\n\nfunction completeMetadataParseFailure', metadataStart);
    const terminalStart = source.indexOf('function setScanTerminal');
    const terminalEnd = source.indexOf('\n}\n\nfunction claimMetadataParse', terminalStart);
    assert.match(
      source.slice(metadataStart, metadataEnd),
      /recomputeAggregates: payload\.deferAggregateRecompute !== true/
    );
    assert.match(source.slice(terminalStart, terminalEnd), /activateEntityAggregationJob\(identity\)/);
    assert.match(source, /kind IN \('folder-delete', 'playlist-resolve', 'entity-aggregate'\)/);
    assert.match(source, /function runEntityAggregationPhase\(jobId, cursorKey\)/);
    assert.match(
      source,
      /SET \(track_count, total_duration_sec, representative_artwork_id\) = \(/
    );
  }
  const metadataService = fs.readFileSync(
    new URL('../../js/library/scan/metadata-parse-service.js', import.meta.url),
    'utf8'
  );
  assert.match(metadataService, /deferAggregateRecompute: true/);
});
