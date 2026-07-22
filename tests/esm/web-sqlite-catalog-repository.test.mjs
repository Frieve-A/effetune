import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import vm from 'node:vm';

import { WebSqliteCatalogRepository } from '../../js/library/repository/web-catalog-repository.js';
import { MUSIC_LIBRARY_V3_WEB_OPFS_DIRECTORY } from '../../js/library/repository/schema-v3.js';
import {
  dispatchWebSqliteCommand,
  initializeWebSqliteRuntime
} from '../../js/library/repository/web-sqlite-runtime.js';
import { metadataParseEligibility } from '../../js/library/scan/metadata-parse-service.js';
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
      directory: `/${MUSIC_LIBRARY_V3_WEB_OPFS_DIRECTORY}`,
      initialCapacity: 4,
      clearOnInit: true
    },
    {
      directory: `/${MUSIC_LIBRARY_V3_WEB_OPFS_DIRECTORY}`,
      initialCapacity: 4,
      clearOnInit: false
    }
  ]);
});

test('shared schema-v3 is the only active catalog DDL source for Electron and Web runtimes', () => {
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

test('Web folder directory browsing keeps physical hierarchy counts and direct-track scopes exact', async t => {
  const { database, close } = await openWebTestCatalog(t, 'effetune-web-directory-tree-');
  seedWebTestFolder();
  dispatchWebSqliteCommand('upsertTracks', { tracks: [
    createWebTestTrack('root', 'Root.flac', { metadataStatus: 'parsing' }),
    createWebTestTrack('a-direct', 'A/Direct.flac', { metadataStatus: 'terminal-error' }),
    createWebTestTrack('a-deep-1', 'A/B/One.flac'),
    createWebTestTrack('a-deep-2', 'A/B/Two.flac'),
    createWebTestTrack('a2-direct', 'A2/Other.flac'),
    createWebTestTrack('percent', '%_/Track.flac'),
    createWebTestTrack('cafe', 'Cafe/Track.flac'),
    createWebTestTrack('accent', 'Café/Track.flac'),
    createWebTestTrack('fullwidth', 'A／B/Track.flac'),
    createWebTestTrack('unicode', '音楽😀/子/Track.flac')
  ] });

  assertDirectoriesMatchTracks(database);
  assert.deepEqual(dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: '', limit: 20
  }), {
    children: [
      { name: '%_', segments: ['%_'], directTrackCount: 1, recursiveTrackCount: 1 },
      { name: 'A', segments: ['A'], directTrackCount: 1, recursiveTrackCount: 3 },
      { name: 'A2', segments: ['A2'], directTrackCount: 1, recursiveTrackCount: 1 },
      { name: 'A／B', segments: ['A／B'], directTrackCount: 1, recursiveTrackCount: 1 },
      { name: 'Cafe', segments: ['Cafe'], directTrackCount: 1, recursiveTrackCount: 1 },
      { name: 'Café', segments: ['Café'], directTrackCount: 1, recursiveTrackCount: 1 },
      {
        name: '音楽😀', segments: ['音楽😀', '子'],
        directTrackCount: 1, recursiveTrackCount: 1
      }
    ],
    hasMore: false,
    cursor: null,
    nodeExists: true
  });
  assert.deepEqual(dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: 'A', limit: 20
  }), {
    children: [{ name: 'B', segments: ['B'], directTrackCount: 2, recursiveTrackCount: 2 }],
    hasMore: false,
    cursor: null,
    nodeExists: true
  });
  assert.deepEqual(dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: '音楽😀', limit: 20
  }).children, [{ name: '子', segments: ['子'], directTrackCount: 1, recursiveTrackCount: 1 }]);
  assert.equal(dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: 'Missing/Node', limit: 20
  }).nodeExists, false);

  const rootScope = createFolderDirScope('web-folder', '');
  const nestedScope = createFolderDirScope('web-folder', 'A');
  const rootPage = dispatchWebSqliteCommand('queryTracks', {
    query: '', sort: 'title', direction: 'asc', scope: rootScope, limit: 20
  });
  assert.deepEqual(rootPage.rows.map(row => row.trackUid), ['root']);
  const nestedPage = dispatchWebSqliteCommand('queryTracks', {
    query: '', sort: 'title', direction: 'asc', scope: nestedScope, limit: 20
  });
  assert.deepEqual(nestedPage.rows.map(row => row.trackUid), ['a-direct']);
  const context = dispatchWebSqliteCommand('createContext', {
    query: '', sort: 'title', direction: 'asc', scope: nestedScope
  });
  assert.equal(dispatchWebSqliteCommand('getContextCount', {
    contextToken: context.contextToken
  }).totalCount, 1);
  const boundaryFolderId = '音'.repeat(512);
  const boundaryPath = 'a'.repeat(32768);
  const boundaryContext = dispatchWebSqliteCommand('createContext', {
    query: '', sort: 'title', direction: 'asc',
    scope: createFolderDirScope(boundaryFolderId, boundaryPath)
  });
  assert.equal(dispatchWebSqliteCommand('getContextCount', {
    contextToken: boundaryContext.contextToken
  }).totalCount, 0);
  dispatchWebSqliteCommand('releaseContext', { contextToken: boundaryContext.contextToken });
  assert.throws(() => dispatchWebSqliteCommand('createContext', {
    query: '', sort: 'title', direction: 'asc',
    scope: createFolderDirScope(boundaryFolderId, `${boundaryPath}a`)
  }));

  dispatchWebSqliteCommand('upsertTracks', {
    tracks: [createWebTestTrack('a-deep-1', 'Moved/One.flac')]
  });
  dispatchWebSqliteCommand('deleteTracks', { trackUids: ['a-deep-2'] });
  assertDirectoriesMatchTracks(database);
  assert.equal(dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: 'A', limit: 20
  }).children.length, 0);

  const continuationPlan = database.prepare(`
    EXPLAIN QUERY PLAN
    SELECT name FROM directories
    WHERE folder_id = ? AND parent_path = ? AND name > ?
    ORDER BY name LIMIT ?
  `).all('web-folder', '', 'A', 10);
  assert.ok(continuationPlan.some(row => (
    String(row.detail).includes('directories_by_parent') &&
    String(row.detail).includes('name>?')
  )), JSON.stringify(continuationPlan));
  const directTrackPlan = database.prepare(`
    EXPLAIN QUERY PLAN
    SELECT track_uid FROM tracks
    WHERE folder_id = ? AND relative_path >= ? || '/' AND relative_path < ? || '0'
      AND instr(substr(relative_path, length(?) + 2), '/') = 0
  `).all('web-folder', 'A', 'A', 'A');
  assert.ok(directTrackPlan.some(row => (
    String(row.detail).includes('tracks_by_folder_relative_path') &&
    String(row.detail).includes('relative_path>?')
  )), JSON.stringify(directTrackPlan));
  const rootDirectTrackPlan = database.prepare(`
    EXPLAIN QUERY PLAN
    SELECT count(*) FROM tracks INDEXED BY tracks_root_direct_by_folder
    WHERE folder_id = ? AND instr(relative_path, '/') = 0
  `).all('web-folder');
  assert.ok(rootDirectTrackPlan.some(row => (
    String(row.detail).includes('tracks_root_direct_by_folder') &&
    String(row.detail).includes('folder_id=?')
  )), JSON.stringify(rootDirectTrackPlan));
  const directoryCleanupPlan = database.prepare(`
    EXPLAIN QUERY PLAN
    DELETE FROM directories
    WHERE folder_id = ? AND relative_path = ? AND recursive_track_count = 0
  `).all('web-folder', 'A');
  assert.ok(directoryCleanupPlan.some(row => (
    String(row.detail).includes('sqlite_autoindex_directories_1') &&
    String(row.detail).includes('folder_id=? AND relative_path=?')
  )), JSON.stringify(directoryCleanupPlan));
  const runtimeSource = fs.readFileSync(
    new URL('../../js/library/repository/web-sqlite-runtime.js', import.meta.url),
    'utf8'
  );
  assert.match(runtimeSource, /DELETE FROM directories\s+WHERE folder_id = \? AND relative_path = \? AND recursive_track_count = 0/);
  assert.doesNotMatch(runtimeSource, /DELETE FROM directories WHERE folder_id = \? AND recursive_track_count = 0/);
  assert.match(runtimeSource, /folder_id = \?[\s\S]*instr\(t\.relative_path, '\/'\) = 0/);

  for (const request of [
    { folderId: 'web-folder', path: '', limit: 20, extra: true },
    { folderId: '', path: '', limit: 20 },
    { folderId: 'web-folder', path: '..', limit: 20 },
    { folderId: 'web-folder', path: '/A', limit: 20 },
    { folderId: 'web-folder', path: 'A/', limit: 20 },
    { folderId: 'web-folder', path: 'A\\B', limit: 20 },
    { folderId: 'web-folder', path: './A', limit: 20 },
    { folderId: 'web-folder', path: '', cursor: 'A/B', limit: 20 },
    { folderId: 'web-folder', path: '', cursor: '', limit: 20 },
    { folderId: 'web-folder', path: '', limit: 501 }
  ]) {
    assert.throws(() => dispatchWebSqliteCommand('browseFolderChildren', request));
  }
  for (const scope of [
    { folderDirKey: '' },
    { folderDirKey: '01:x' },
    { folderDirKey: '3:ab' },
    { folderDirKey: '1:xA/' },
    { folderDirKey: '1:x', folderKey: 'x' }
  ]) {
    assert.throws(() => dispatchWebSqliteCommand('createContext', {
      query: '', sort: 'title', direction: 'asc', scope
    }));
  }
  close();
});

test('Web folder child cursors preserve binary order without duplicates or omissions', async t => {
  const { close } = await openWebTestCatalog(t, 'effetune-web-directory-cursor-');
  seedWebTestFolder();
  const names = Array.from({ length: 505 }, (_, index) => `Child-${String(index).padStart(4, '0')}`);
  dispatchWebSqliteCommand('upsertTracks', {
    tracks: names.map((name, index) => createWebTestTrack(`fanout-${index}`, `${name}/Track.flac`))
  });
  const seen = [];
  let cursor = null;
  do {
    const page = dispatchWebSqliteCommand('browseFolderChildren', {
      folderId: 'web-folder', path: '', cursor, limit: 137
    });
    seen.push(...page.children.map(child => child.name));
    cursor = page.cursor;
    if (!page.hasMore) break;
  } while (cursor !== null);
  assert.deepEqual(seen, names);
  assert.equal(new Set(seen).size, names.length);
  close();
});

test('Web folder browsing compresses single-child chains without changing cursors', async t => {
  const { database, close } = await openWebTestCatalog(t, 'effetune-web-directory-compression-');
  seedWebTestFolder();
  dispatchWebSqliteCommand('upsertTracks', { tracks: [
    createWebTestTrack('chain-one', 'A/B/C/One.flac'),
    createWebTestTrack('chain-two', 'A/B/C/Two.flac'),
    createWebTestTrack('direct-own', 'Direct/Stop/Own.flac'),
    createWebTestTrack('direct-deep', 'Direct/Stop/Next/Deep.flac'),
    createWebTestTrack('branch-left', 'Branch/Left/Track.flac'),
    createWebTestTrack('branch-right', 'Branch/Right/Track.flac'),
    createWebTestTrack('unicode-chain', '日本語/フォルダ/🎵/Track.flac'),
    createWebTestTrack('page-a', 'Paging/A/One/Track.flac'),
    createWebTestTrack('page-b', 'Paging/B/Two/Track.flac')
  ] });
  database.prepare(`
    INSERT INTO directories(
      folder_id, relative_path, parent_path, name, direct_track_count, recursive_track_count
    ) VALUES ('web-folder', 'Leaf', '', 'Leaf', 0, 0)
  `).run();

  const children = dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: '', limit: 20
  }).children;
  const childByName = new Map(children.map(child => [child.name, child]));
  assert.deepEqual(childByName.get('A'), {
    name: 'A', segments: ['A', 'B', 'C'], directTrackCount: 2, recursiveTrackCount: 2
  });
  assert.deepEqual(childByName.get('Direct'), {
    name: 'Direct', segments: ['Direct', 'Stop'], directTrackCount: 1, recursiveTrackCount: 2
  });
  assert.deepEqual(childByName.get('Branch'), {
    name: 'Branch', segments: ['Branch'], directTrackCount: 0, recursiveTrackCount: 2
  });
  assert.deepEqual(childByName.get('Leaf'), {
    name: 'Leaf', segments: ['Leaf'], directTrackCount: 0, recursiveTrackCount: 0
  });
  assert.deepEqual(childByName.get('日本語'), {
    name: '日本語', segments: ['日本語', 'フォルダ', '🎵'],
    directTrackCount: 1, recursiveTrackCount: 1
  });

  const firstPage = dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: 'Paging', limit: 1
  });
  assert.deepEqual(firstPage, {
    children: [{
      name: 'A', segments: ['A', 'One'], directTrackCount: 1, recursiveTrackCount: 1
    }],
    hasMore: true,
    cursor: 'A',
    nodeExists: true
  });
  assert.equal(firstPage.cursor, firstPage.children[0].segments[0]);
  const secondPage = dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: 'Paging', cursor: firstPage.cursor, limit: 1
  });
  assert.deepEqual(secondPage, {
    children: [{
      name: 'B', segments: ['B', 'Two'], directTrackCount: 1, recursiveTrackCount: 1
    }],
    hasMore: false,
    cursor: null,
    nodeExists: true
  });
  assert.deepEqual([...firstPage.children, ...secondPage.children].map(child => child.name), ['A', 'B']);
  close();
});

test('Web folder browsing enforces chain depth, path length, and response byte limits', async t => {
  const { database, close } = await openWebTestCatalog(t, 'effetune-web-directory-limits-');
  seedWebTestFolder();
  const depthSegments = Array.from(
    { length: 65 },
    (_, index) => `Depth-${String(index + 1).padStart(2, '0')}`
  );
  dispatchWebSqliteCommand('upsertTracks', { tracks: [
    createWebTestTrack('depth-limit', `${depthSegments.join('/')}/Track.flac`)
  ] });

  const longName = 'x'.repeat(32768 - 'Length/'.length);
  const maximumPath = `Length/${longName}`;
  const insertDirectory = database.prepare(`
    INSERT INTO directories(
      folder_id, relative_path, parent_path, name, direct_track_count, recursive_track_count
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertDirectory.run('web-folder', 'Length', '', 'Length', 0, 1);
  insertDirectory.run('web-folder', maximumPath, 'Length', longName, 0, 1);
  insertDirectory.run('web-folder', `${maximumPath}/Tail`, maximumPath, 'Tail', 1, 1);

  const rootChildren = dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: '', limit: 20
  }).children;
  const depthChild = rootChildren.find(child => child.name === depthSegments[0]);
  assert.equal(depthChild.segments.length, 64);
  assert.deepEqual(depthChild.segments, depthSegments.slice(0, 64));
  assert.equal(depthChild.directTrackCount, 0);
  const finalDepthPage = dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: depthSegments.slice(0, 64).join('/'), limit: 20
  });
  assert.deepEqual(finalDepthPage.children, [{
    name: depthSegments[64], segments: [depthSegments[64]],
    directTrackCount: 1, recursiveTrackCount: 1
  }]);

  const lengthChild = rootChildren.find(child => child.name === 'Length');
  assert.deepEqual(lengthChild.segments, ['Length', longName]);
  assert.equal(lengthChild.segments.join('/').length, 32768);
  assert.equal(lengthChild.directTrackCount, 0);
  assert.deepEqual(dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: maximumPath, limit: 20
  }).children, [{
    name: 'Tail', segments: ['Tail'], directTrackCount: 1, recursiveTrackCount: 1
  }]);

  const budgetRootCount = 160;
  const longSegments = Array.from({ length: 7 }, () => 'y'.repeat(500));
  dispatchWebSqliteCommand('upsertTracks', {
    tracks: Array.from({ length: budgetRootCount }, (_, index) => {
      const root = `Budget-${String(index).padStart(3, '0')}`;
      return createWebTestTrack(`budget-${index}`, `${[root, ...longSegments].join('/')}/Track.flac`);
    })
  });
  const budgetPage = dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: '', limit: 500
  });
  assert.ok(budgetPage.children.length > 0);
  assert.ok(budgetPage.children.length < budgetRootCount);
  assert.ok(budgetPage.children.every(child => child.segments.length === 8));
  assert.equal(budgetPage.hasMore, true);
  assert.equal(budgetPage.cursor, budgetPage.children.at(-1).segments[0]);
  close();
});

test('Web startup rebuilds directory rows when generation and watermark diverge', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-directory-rebuild-'));
  const dbPath = path.join(directory, 'catalog.sqlite');
  let database = new DatabaseSync(dbPath);
  let open = true;
  t.after(() => {
    if (open) dispatchWebSqliteCommand('close', {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const options = {
    storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
  };
  await initializeWebSqliteRuntime(database, options);
  seedWebTestFolder();
  dispatchWebSqliteCommand('upsertTracks', {
    tracks: [createWebTestTrack('legacy-move', 'Before/Track.flac')]
  });
  const synchronized = database.prepare(`
    SELECT
      (SELECT generation FROM directories_sync WHERE id = 1) AS generation,
      (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'directories_watermark') AS watermark
  `).get();
  assert.equal(synchronized.generation, synchronized.watermark);

  database.prepare(`
    UPDATE tracks SET relative_path = 'After/Track.flac' WHERE track_uid = 'legacy-move'
  `).run();
  const divergent = database.prepare(`
    SELECT
      (SELECT generation FROM directories_sync WHERE id = 1) AS generation,
      (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'directories_watermark') AS watermark
  `).get();
  assert.ok(divergent.generation > divergent.watermark);
  dispatchWebSqliteCommand('close', {});
  open = false;

  database = new DatabaseSync(dbPath);
  await initializeWebSqliteRuntime(database, options);
  open = true;
  assertDirectoriesMatchTracks(database);
  assert.deepEqual(dispatchWebSqliteCommand('browseFolderChildren', {
    folderId: 'web-folder', path: '', limit: 20
  }).children, [{
    name: 'After', segments: ['After'], directTrackCount: 1, recursiveTrackCount: 1
  }]);
  const rebuilt = database.prepare(`
    SELECT
      (SELECT generation FROM directories_sync WHERE id = 1) AS generation,
      (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'directories_watermark') AS watermark
  `).get();
  assert.equal(rebuilt.generation, rebuilt.watermark);
});

test('Web scans reparse unchanged tracks from the previous parser and preserve a resumed parser version', async t => {
  const { database, close } = await openWebTestCatalog(t, 'effetune-web-parser-version-');
  seedWebTestFolder();
  const signature = { fileIdentity: 'unchanged-file', size: 100, mtimeMs: 200 };
  dispatchWebSqliteCommand('upsertTracks', { tracks: [{
    trackUid: 'unchanged-track', folderId: 'web-folder', relativePath: 'Album/Track.flac',
    title: 'Track', artist: 'Artist', albumArtist: 'Artist', album: 'Album', genre: 'Genre',
    ...signature, metadataStatus: 'ok', metadataParserVersion: 'catalog-metadata-v4',
    addedAt: 1, updatedAt: 1
  }] });
  const scan = beginWebTestScan('scan-parser-version-v5');
  const observation = {
    relativePath: 'Album/Track.flac', path: '/fsa/music/Album/Track.flac', ...signature
  };
  dispatchWebSqliteCommand('commitScanSeenBatch', {
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion,
    observations: [observation], maxTracks: 500, maxBytes: 4 * 1024 * 1024,
    lastCommittedBatch: 1,
    cursor: { lastRelativePath: observation.relativePath, visitedFiles: 1, committedBatches: 1 }
  });
  const candidate = dispatchWebSqliteCommand('listMetadataCandidates', {
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion, cursor: null, limit: 10,
    parserVersion: scan.parserVersion
  }).items[0];

  assert.equal(scan.parserVersion, 'catalog-metadata-v5');
  assert.equal(candidate.storedParserVersion, 'catalog-metadata-v4');
  assert.deepEqual(candidate.storedSignature, candidate.observedSignature);
  assert.equal(metadataParseEligibility(candidate), true);

  database.prepare(`
    UPDATE scan_run_folders SET parser_version = 'catalog-metadata-v4'
    WHERE scan_id = ? AND folder_id = ?
  `).run(scan.scanId, scan.folderId);
  dispatchWebSqliteCommand('pauseScanFolder', {
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion, status: 'paused', stopReason: 'test',
    continuityBroken: true, sweepEligibility: 'INELIGIBLE'
  });
  const resumed = dispatchWebSqliteCommand('beginScanFolder', {
    scanId: scan.scanId, folderId: scan.folderId, normalizedRoot: '/fsa/music',
    expectedLifecycleVersion: scan.lifecycleVersion, resume: true,
    rootEnumerationRequired: true, continuityBroken: true, sweepEligibility: 'INELIGIBLE'
  });
  assert.equal(resumed.parserVersion, 'catalog-metadata-v4');
  close();
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
  assertDirectoriesMatchTracks(database);
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
  assert.equal(lastPage.pageStartOrdinal, 4);
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
  assert.match(runtime, /WHERE t\.folder_id = \? AND t\.source_kind = 'file' AND t\.relative_path = \? COLLATE NOCASE[\s\S]*LIMIT 2/);
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

test('Web playlist duplication reads and copies each visible source page', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-playlist-copy-'));
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

  dispatchWebSqliteCommand('upsertFolders', { folders: [{
    id: 'copy-folder', kind: 'web-fsa', displayName: 'Copy', path: '/fsa/copy',
    status: 'ok', scanGeneration: 0, lifecycleVersion: 0, addedAt: 1, lastScanAt: null
  }] });
  dispatchWebSqliteCommand('upsertTracks', { tracks: [{
    trackUid: 'copy-track', folderId: 'copy-folder', relativePath: 'Track.flac',
    title: 'Track', artist: 'Artist', addedAt: 1, updatedAt: 1
  }] });
  dispatchWebSqliteCommand('createPlaylistWithItems', {
    playlistId: 'copy-source', name: 'Source', createdAt: 10,
    items: [
      { trackUid: 'copy-track' },
      { unresolved: { basename: 'Missing.flac', title: 'Missing', artist: 'Artist' } }
    ]
  });

  const duplicated = dispatchWebSqliteCommand('duplicatePlaylist', {
    playlistId: 'copy-source', targetPlaylistId: 'copy-target', name: 'Target',
    expectedVersion: 0, createdAt: 11
  });
  assert.deepEqual({
    kind: duplicated.kind,
    playlistId: duplicated.playlistId,
    id: duplicated.id,
    version: duplicated.version
  }, {
    kind: 'duplicated', playlistId: 'copy-target', id: 'copy-target', version: 0
  });
  const copied = dispatchWebSqliteCommand('queryPlaylistItems', {
    playlistId: 'copy-target', afterPosition: null, limit: 10
  });
  assert.equal(copied.items.length, 2);
  assert.equal(copied.items[0].trackUid, 'copy-track');
  assert.equal(copied.items[1].unresolved.title, 'Missing');
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

test('Web catalog indexes semicolon-delimited album artists separately', async t => {
  const { close } = await openWebTestCatalog(t, 'effetune-web-album-artists-');
  seedWebTestFolder();
  const scan = beginWebTestScan('scan-multiple-album-artists');
  const claimed = claimWebCueTrack(scan, {
    trackUid: 'web-collaboration',
    entryKey: 'cue:Album/disc.cue#1',
    relativePath: 'Album/disc.flac',
    signature: { fileIdentity: 'collaboration', size: 100, mtimeMs: 1 },
    cueSignature: 'cue-collaboration'
  });
  dispatchWebSqliteCommand('completeMetadataParseSuccess', {
    claim: claimed.claim,
    metadata: {
      title: 'Collaboration', artist: 'Track Performer',
      albumArtist: 'Artist A; Artist B', album: 'Album', genre: 'Genre', durationSec: 10
    },
    metadataStatus: 'ok', clearErrorAndRetryState: true,
    updateLastKnownGood: true, updateDerivedData: true
  });

  const artistContext = dispatchWebSqliteCommand('createContext', {
    endpoint: 'entities:artist', query: '', sort: 'name', direction: 'asc', scope: null
  });
  const artistPage = dispatchWebSqliteCommand('readContextPage', {
    contextToken: artistContext.contextToken, cursor: null, limit: 20
  });
  assert.deepEqual(artistPage.rows.map(row => ({ name: row.name, trackCount: row.trackCount })), [
    { name: 'Artist A', trackCount: 1 },
    { name: 'Artist B', trackCount: 1 }
  ]);
  for (const artist of artistPage.rows) {
    const trackContext = dispatchWebSqliteCommand('createContext', {
      endpoint: 'tracks', query: '', sort: 'title', direction: 'asc',
      scope: { artistKey: artist.artistKey }
    });
    const trackPage = dispatchWebSqliteCommand('readContextPage', {
      contextToken: trackContext.contextToken, cursor: null, limit: 20
    });
    assert.deepEqual(trackPage.rows.map(row => row.trackUid), ['web-collaboration']);
    assert.equal(trackPage.rows[0].albumArtist, 'Artist A; Artist B');
    dispatchWebSqliteCommand('releaseContext', { contextToken: trackContext.contextToken });
  }
  dispatchWebSqliteCommand('releaseContext', { contextToken: artistContext.contextToken });
  close();
});

test('Web catalog title sort uses natural numeric order', async t => {
  const { close } = await openWebTestCatalog(t, 'effetune-web-natural-name-order-');
  seedWebTestFolder();
  dispatchWebSqliteCommand('upsertTracks', {
    tracks: [10, 2, 1].map(number => ({
      trackUid: `web-track-${number}`,
      folderId: 'web-folder',
      relativePath: `Track ${number}.flac`,
      title: `Track ${number}`,
      artist: 'Artist',
      albumArtist: 'Artist',
      album: 'Album',
      genre: 'Genre',
      fileIdentity: `web-file-${number}`,
      size: 100 + number,
      mtimeMs: 200 + number,
      metadataStatus: 'ok',
      metadataParserVersion: 'catalog-metadata-v5',
      addedAt: number,
      updatedAt: number
    }))
  });
  const context = dispatchWebSqliteCommand('createContext', {
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc', scope: null
  });
  const page = dispatchWebSqliteCommand('readContextPage', {
    contextToken: context.contextToken, cursor: null, limit: 20
  });
  assert.deepEqual(page.rows.map(row => row.title), ['Track 1', 'Track 2', 'Track 10']);
  dispatchWebSqliteCommand('releaseContext', { contextToken: context.contextToken });
  close();
});

test('Web album year sort uses the earliest known track year and keeps unknown years last', async t => {
  const { close } = await openWebTestCatalog(t, 'effetune-web-album-year-order-');
  seedWebTestFolder();
  const scan = beginWebTestScan('scan-album-year-order');
  for (const [trackUid, album, year, number] of [
    ['web-old-late', 'Old Album', 2001, 1],
    ['web-old-early', 'Old Album', 1998, 2],
    ['web-new', 'New Album', 2020, 3],
    ['web-unknown', 'Unknown Album', undefined, 4]
  ]) {
    const relativePath = `${album}/disc.flac`;
    const claimed = claimWebCueTrack(scan, {
      trackUid,
      entryKey: `cue:${album}/disc.cue#${number}`,
      relativePath,
      signature: { fileIdentity: `file-${number}`, size: 100 + number, mtimeMs: number },
      cueSignature: `cue-${number}`,
      cueRelativePath: `${album}/disc.cue`
    });
    dispatchWebSqliteCommand('completeMetadataParseSuccess', {
      claim: claimed.claim,
      metadata: {
        title: trackUid,
        artist: 'Artist',
        albumArtist: 'Artist',
        album,
        genre: 'Genre',
        durationSec: 10,
        ...(year === undefined ? {} : { year })
      },
      metadataStatus: 'ok',
      clearErrorAndRetryState: true,
      updateLastKnownGood: true,
      updateDerivedData: true
    });
  }

  const readAlbums = direction => {
    const context = dispatchWebSqliteCommand('createContext', {
      endpoint: 'entities:album', query: '', sort: 'year', direction, scope: null
    });
    const page = dispatchWebSqliteCommand('readContextPage', {
      contextToken: context.contextToken, cursor: null, limit: 20
    });
    dispatchWebSqliteCommand('releaseContext', { contextToken: context.contextToken });
    return page.rows;
  };

  assert.deepEqual(readAlbums('asc').map(row => [row.name, row.year]), [
    ['Old Album', 1998],
    ['New Album', 2020],
    ['Unknown Album', null]
  ]);
  assert.deepEqual(readAlbums('desc').map(row => row.name), [
    'New Album', 'Old Album', 'Unknown Album'
  ]);
  close();
});

test('Web CUE metadata claims keep the track UID while replacing the physical source path', async t => {
  const { database, close } = await openWebTestCatalog(t, 'effetune-web-cue-path-');
  seedWebTestFolder();
  const scan = beginWebTestScan('scan-cue-path');
  const entryKey = 'cue:Album/disc.cue#1';
  const first = claimWebCueTrack(scan, {
    trackUid: 'cue-stable-track', entryKey, relativePath: 'Album/Old.flac',
    signature: { fileIdentity: 'old', size: 100, mtimeMs: 1 }, cueSignature: 'cue-old'
  });
  completeWebMetadata(first.claim, 'First title');

  const observation = {
    relativePath: 'Album/New.flac', path: '/fsa/music/Album/New.flac',
    fileIdentity: 'old', size: 100, mtimeMs: 1,
    logicalCandidates: [{
      logicalStorageId: entryKey, relativePath: 'Album/New.flac',
      path: '/fsa/music/Album/New.flac', sourceKind: 'cue-track', entryKey,
      cueRelativePath: 'Album/disc.cue', startFrame: 0, endFrame: 750,
      cueSignature: 'cue-old',
      metadata: {
        title: 'Moved title', artist: 'Artist', albumArtist: 'Artist', album: 'Album',
        genre: 'Genre', durationSec: 10
      }
    }]
  };
  dispatchWebSqliteCommand('commitScanSeenBatch', {
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion,
    observations: [observation], maxTracks: 500, maxBytes: 4 * 1024 * 1024,
    lastCommittedBatch: 1,
    cursor: { lastRelativePath: observation.relativePath, visitedFiles: 1, committedBatches: 1 }
  });
  const candidate = dispatchWebSqliteCommand('listMetadataCandidates', {
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion, cursor: null, limit: 10,
    parserVersion: scan.parserVersion
  }).items[0];
  assert.equal(candidate.relativePath, 'Album/New.flac');
  assert.equal(candidate.storedSignature, null);

  const moved = claimWebCueTrack(scan, {
    trackUid: 'should-not-replace-stable-uid', entryKey, relativePath: 'Album/New.flac',
    signature: { fileIdentity: 'old', size: 100, mtimeMs: 1 }, cueSignature: 'cue-old'
  });
  assert.equal(moved.claim.trackUid, 'cue-stable-track');
  assert.deepEqual({ ...database.prepare(`
    SELECT relative_path AS relativePath, file_name AS fileName, entry_key AS entryKey,
      cue_relative_path AS cueRelativePath, start_frame AS startFrame, end_frame AS endFrame
    FROM tracks WHERE track_uid = 'cue-stable-track'
  `).get() }, {
    relativePath: 'Album/New.flac', fileName: 'New.flac', entryKey,
    cueRelativePath: 'Album/disc.cue', startFrame: 0, endFrame: 750
  });

  completeWebMetadata(moved.claim, 'Moved title');
  const completed = database.prepare(`
    SELECT relative_path AS relativePath, file_name AS fileName,
      normalized_basename AS normalizedBasename, search_text AS searchText
    FROM tracks WHERE track_uid = 'cue-stable-track'
  `).get();
  assert.equal(completed.relativePath, 'Album/New.flac');
  assert.equal(completed.fileName, 'New.flac');
  assert.equal(completed.normalizedBasename, 'new.flac');
  assert.match(completed.searchText, /new\.flac/);
  assert.doesNotMatch(completed.searchText, /old\.flac/);
  assertDirectoriesMatchTracks(database);
  close();
});

test('Web CUE artwork claims accept supported sibling image files', async t => {
  const { close } = await openWebTestCatalog(t, 'effetune-web-cue-cover-');
  seedWebTestFolder();
  const scan = beginWebTestScan('scan-cue-cover');
  const entryKey = 'cue:Album/disc.cue#1';
  const claimedTrack = claimWebCueTrack(scan, {
    trackUid: 'web-cue-cover-track', entryKey, relativePath: 'Album/disc.flac',
    signature: { fileIdentity: 'cue-audio', size: 100, mtimeMs: 1 },
    cueSignature: 'cue-cover-signature'
  });
  completeWebMetadata(claimedTrack.claim, 'CUE cover track');
  dispatchWebSqliteCommand('beginArtworkUtilitySession', { utilitySessionId: 'web-cue-cover-session' });
  const source = dispatchWebSqliteCommand('getArtworkSource', { trackUid: 'web-cue-cover-track' });
  assert.equal(source.trackSourceKind, 'cue-track');
  assert.equal(source.cueRelativePath, 'Album/disc.cue');
  const claimSource = { ...source };
  delete claimSource.trackSourceKind;
  delete claimSource.cueRelativePath;
  const externalArtworkStat = { fileIdentity: 'fsa:Album/cover.jpg', size: 50, mtimeMs: 2 };
  const claimed = dispatchWebSqliteCommand('claimArtworkSource', {
    claim: {
      ...claimSource,
      sourceKind: 'external-file',
      canonicalSourceIdentity: 'Album/cover.jpg',
      externalArtworkStat
    }
  });
  assert.equal(claimed.claim.sourceKind, 'external-file');
  assert.equal(claimed.claim.canonicalSourceIdentity, 'Album/cover.jpg');
  close();
});

test('Web initialization recovers an interrupted CUE metadata claim for the next scan', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-cue-recovery-'));
  const databasePath = path.join(directory, 'catalog.sqlite');
  let database = new DatabaseSync(databasePath);
  let runtimeOpen = false;
  const initialize = async () => {
    await initializeWebSqliteRuntime(database, {
      storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
    });
    runtimeOpen = true;
  };
  const close = () => {
    if (!runtimeOpen) return;
    dispatchWebSqliteCommand('close', {});
    runtimeOpen = false;
  };
  t.after(() => {
    close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await initialize();
  seedWebTestFolder();
  const interruptedScan = beginWebTestScan('scan-cue-interrupted');
  const entryKey = 'cue:Album/disc.cue#1';
  const relativePath = 'Album/Image.flac';
  const signature = { fileIdentity: 'cue-image', size: 100, mtimeMs: 1 };
  const interrupted = claimWebCueTrack(interruptedScan, {
    trackUid: 'cue-recovered-track', entryKey, relativePath,
    signature, cueSignature: 'cue-signature'
  });
  assert.equal(interrupted.claim.trackUid, 'cue-recovered-track');
  assert.equal(database.prepare('SELECT count(*) AS count FROM metadata_claims').get().count, 1);

  close();
  database = new DatabaseSync(databasePath);
  await initialize();

  assert.deepEqual({ ...database.prepare(`
    SELECT metadata_status AS metadataStatus, metadata_error_code AS metadataErrorCode
    FROM tracks WHERE track_uid = 'cue-recovered-track'
  `).get() }, {
    metadataStatus: 'retryable-error',
    metadataErrorCode: 'service-interrupted'
  });
  assert.equal(database.prepare('SELECT count(*) AS count FROM metadata_claims').get().count, 0);

  const retryScan = beginWebTestScan('scan-cue-retry');
  const observation = {
    relativePath,
    path: `/fsa/music/${relativePath}`,
    ...signature,
    logicalCandidates: [{
      logicalStorageId: entryKey,
      relativePath,
      path: `/fsa/music/${relativePath}`,
      sourceKind: 'cue-track',
      entryKey,
      cueRelativePath: 'Album/disc.cue',
      startFrame: 0,
      endFrame: 750,
      cueSignature: 'cue-signature',
      metadata: {
        title: 'Recovered title', artist: 'Artist', albumArtist: 'Artist', album: 'Album',
        genre: 'Genre', durationSec: 10
      }
    }]
  };
  dispatchWebSqliteCommand('commitScanSeenBatch', {
    scanId: retryScan.scanId, folderId: retryScan.folderId, generation: retryScan.generation,
    expectedLifecycleVersion: retryScan.lifecycleVersion,
    observations: [observation], maxTracks: 500, maxBytes: 4 * 1024 * 1024,
    lastCommittedBatch: 1,
    cursor: { lastRelativePath: relativePath, visitedFiles: 1, committedBatches: 1 }
  });
  const candidate = dispatchWebSqliteCommand('listMetadataCandidates', {
    scanId: retryScan.scanId, folderId: retryScan.folderId, generation: retryScan.generation,
    expectedLifecycleVersion: retryScan.lifecycleVersion, cursor: null, limit: 10,
    parserVersion: retryScan.parserVersion
  }).items[0];
  assert.equal(candidate.metadataStatus, 'retryable-error');
  assert.equal(candidate.trackUid, 'cue-recovered-track');

  const retry = claimWebCueTrack(retryScan, {
    trackUid: candidate.trackUid,
    entryKey,
    relativePath,
    signature: candidate.observedSignature,
    cueSignature: candidate.cueSignature
  });
  assert.equal(retry.claim.trackUid, 'cue-recovered-track');
  assert.deepEqual(completeWebMetadata(retry.claim, 'Recovered title').committed, true);
  assert.deepEqual({ ...database.prepare(`
    SELECT metadata_status AS metadataStatus, metadata_error_code AS metadataErrorCode
    FROM tracks WHERE track_uid = 'cue-recovered-track'
  `).get() }, {
    metadataStatus: 'ok',
    metadataErrorCode: null
  });
  assert.equal(database.prepare('SELECT count(*) AS count FROM metadata_claims').get().count, 0);
  close();
});

test('Web retains CUE rows and playlists after pause, then cleans them in an eligible final sweep', async t => {
  const { database, close } = await openWebTestCatalog(t, 'effetune-web-cue-reconcile-');
  seedWebTestFolder();
  const firstScan = beginWebTestScan('scan-cue-old');
  const directoryPath = '📀 Album';
  const cueRelativePath = `${directoryPath}/disc.cue`;
  const relativePath = `${directoryPath}/Image.flac`;
  const entryKey = `cue:${cueRelativePath}#1`;
  const cue = claimWebCueTrack(firstScan, {
    trackUid: 'old-cue-track', entryKey, relativePath,
    signature: { fileIdentity: 'cue-source', size: 100, mtimeMs: 1 },
    cueSignature: 'cue-old', cueRelativePath
  });
  completeWebMetadata(cue.claim, 'CUE title');
  dispatchWebSqliteCommand('completeScanFolderNoSweep', {
    scanId: firstScan.scanId, folderId: firstScan.folderId, generation: firstScan.generation,
    expectedLifecycleVersion: firstScan.lifecycleVersion, status: 'completed-no-sweep',
    sweepBlockReason: 'test'
  });
  dispatchWebSqliteCommand('createPlaylistWithItems', {
    playlistId: 'cue-reconcile-playlist', name: 'CUE reconcile', createdAt: 1,
    items: [{ trackUid: 'old-cue-track' }]
  });

  const scan = beginWebTestScan('scan-cue-plain');
  const observation = {
    relativePath, path: `/fsa/music/${relativePath}`,
    fileIdentity: 'plain-source', size: 120, mtimeMs: 2,
    logicalCandidates: [{
      logicalStorageId: `file:${relativePath}`, relativePath,
      path: `/fsa/music/${relativePath}`, sourceKind: 'file'
    }]
  };
  dispatchWebSqliteCommand('commitScanSeenBatch', {
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion,
    observations: [observation], maxTracks: 500, maxBytes: 4 * 1024 * 1024,
    lastCommittedBatch: 1,
    cursor: { lastRelativePath: observation.relativePath, visitedFiles: 1, committedBatches: 1 }
  });
  const plain = dispatchWebSqliteCommand('claimMetadataParse', {
    folderId: scan.folderId, trackUid: 'plain-track', logicalStorageId: `file:${relativePath}`,
    lifecycleVersion: scan.lifecycleVersion, generation: scan.generation,
    relativePath: observation.relativePath, parserVersion: scan.parserVersion,
    signature: { fileIdentity: 'plain-source', size: 120, mtimeMs: 2 },
    sourceKind: 'file', explicitRescan: false
  });
  completeWebMetadata(plain.claim, 'Plain title');

  dispatchWebSqliteCommand('pauseScanFolder', {
    scanId: scan.scanId, folderId: scan.folderId, generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion, status: 'paused', stopReason: 'user',
    continuityBroken: true, sweepEligibility: 'INELIGIBLE'
  });

  assert.deepEqual(database.prepare(`
    SELECT track_uid AS trackUid, source_kind AS sourceKind FROM tracks ORDER BY track_uid
  `).all().map(row => ({ ...row })), [
    { trackUid: 'old-cue-track', sourceKind: 'cue-track' },
    { trackUid: 'plain-track', sourceKind: 'file' }
  ]);
  const retainedPlaylistItem = dispatchWebSqliteCommand('queryPlaylistItems', {
    playlistId: 'cue-reconcile-playlist', afterPosition: null, limit: 10
  }).items[0];
  assert.equal(retainedPlaylistItem.trackUid, 'old-cue-track');

  const eligible = beginWebTestScan('scan-cue-eligible');
  dispatchWebSqliteCommand('commitScanSeenBatch', {
    scanId: eligible.scanId, folderId: eligible.folderId, generation: eligible.generation,
    expectedLifecycleVersion: eligible.lifecycleVersion,
    observations: [observation], maxTracks: 500, maxBytes: 4 * 1024 * 1024,
    lastCommittedBatch: 1,
    cursor: { lastRelativePath: observation.relativePath, visitedFiles: 1, committedBatches: 1 }
  });
  const finalized = dispatchWebSqliteCommand('finalizeScanEnumeration', {
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
  dispatchWebSqliteCommand('enqueueScanSweep', sweepRequest);
  let sweep;
  do {
    sweep = dispatchWebSqliteCommand('runScanSweep', sweepRequest);
  } while (sweep.hasMore);
  dispatchWebSqliteCommand('completeScanFolder', {
    scanId: eligible.scanId, folderId: eligible.folderId, generation: eligible.generation,
    expectedLifecycleVersion: eligible.lifecycleVersion, status: 'completed'
  });

  assert.deepEqual(database.prepare(`
    SELECT track_uid AS trackUid, source_kind AS sourceKind FROM tracks ORDER BY track_uid
  `).all().map(row => ({ ...row })), [{ trackUid: 'plain-track', sourceKind: 'file' }]);
  const repaired = dispatchWebSqliteCommand('queryPlaylistItems', {
    playlistId: 'cue-reconcile-playlist', afterPosition: null, limit: 10
  }).items[0];
  assert.equal(repaired.trackUid, null);
  assert.equal(repaired.unresolved.reason, 'source-removed');
  assert.deepEqual(repaired.unresolved.cueProvenance, {
    folderId: 'web-folder', entryKey, cueRelativePath,
    relativePath, startFrame: 0, endFrame: 750
  });
  assertDirectoriesMatchTracks(database);
  close();
});

test('Web startup recovery finishes an eligible sweep before an immediate newer generation', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-sweep-recovery-'));
  const dbPath = path.join(directory, 'catalog.sqlite');
  let database = null;
  let runtimeOpen = false;
  const open = async () => {
    database = new DatabaseSync(dbPath);
    await initializeWebSqliteRuntime(database, {
      storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
    });
    runtimeOpen = true;
  };
  const close = () => {
    if (!runtimeOpen) return;
    dispatchWebSqliteCommand('close', {});
    runtimeOpen = false;
  };
  t.after(() => {
    close();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  await open();
  seedWebTestFolder();
  const tracks = Array.from({ length: 206 }, (_, index) => {
    const ordinal = index + 1;
    const id = String(ordinal).padStart(6, '0');
    return {
      trackUid: `web-sweep-${id}`,
      folderId: 'web-folder',
      relativePath: `Album/Track-${id}.flac`,
      fileName: `Track-${id}.flac`,
      title: `Track ${id}`,
      artist: 'Artist',
      albumArtist: 'Album Artist',
      album: 'Album',
      genre: 'Genre',
      trackNo: ordinal,
      durationSec: 120 + ordinal,
      addedAt: ordinal,
      updatedAt: ordinal
    };
  });
  dispatchWebSqliteCommand('upsertTracks', { tracks });
  dispatchWebSqliteCommand('createPlaylistWithItems', {
    playlistId: 'web-sweep-recovery-playlist',
    name: 'Web sweep recovery',
    items: [{ trackUid: tracks[0].trackUid }],
    createdAt: 1
  });

  const scan = beginWebTestScan('web-sweep-recovery');
  const identity = {
    scanId: scan.scanId,
    folderId: scan.folderId,
    generation: scan.generation,
    expectedLifecycleVersion: scan.lifecycleVersion
  };
  const keep = tracks.at(-1);
  const observation = {
    relativePath: keep.relativePath,
    path: `/fsa/music/${keep.relativePath}`,
    fileIdentity: 'web-keep-file',
    size: 123,
    mtimeMs: 456,
    logicalCandidates: [{
      logicalStorageId: `file:${keep.relativePath}`,
      relativePath: keep.relativePath,
      path: `/fsa/music/${keep.relativePath}`,
      sourceKind: 'file'
    }]
  };
  dispatchWebSqliteCommand('commitScanSeenBatch', {
    ...identity,
    observations: [observation],
    maxTracks: 500,
    maxBytes: 4 * 1024 * 1024,
    lastCommittedBatch: 1,
    cursor: { lastRelativePath: keep.relativePath, visitedFiles: 1, committedBatches: 1 }
  });
  dispatchWebSqliteCommand('finalizeScanEnumeration', {
    ...identity,
    rootToEnd: true,
    continuityBroken: false,
    enumerationErrorCount: 0,
    requestedSweepEligibility: 'ELIGIBLE'
  });
  assert.deepEqual(dispatchWebSqliteCommand('enqueueScanSweep', identity), { enqueued: 205 });
  const firstChunk = dispatchWebSqliteCommand('runScanSweep', identity);
  assert.equal(firstChunk.deleted, 100);
  assert.equal(firstChunk.hasMore, true);
  assert.deepEqual(dispatchWebSqliteCommand('pauseScanFolder', {
    ...identity,
    status: 'paused',
    stopReason: 'user',
    continuityBroken: true,
    sweepEligibility: 'INELIGIBLE'
  }), { status: 'sweeping', destructiveCommitRetained: true });
  assert.equal(dispatchWebSqliteCommand('getCounts', {}).tracks, 106);
  close();

  await open();
  const nextScan = beginWebTestScan('web-scan-after-sweep-recovery');
  assert.equal(nextScan.generation, scan.generation + 1);

  assert.equal(dispatchWebSqliteCommand('getCounts', {}).tracks, 1);
  assert.equal(dispatchWebSqliteCommand('getTrack', { trackUid: keep.trackUid }).trackUid, keep.trackUid);
  const playlist = dispatchWebSqliteCommand('queryPlaylistItems', {
    playlistId: 'web-sweep-recovery-playlist',
    afterPosition: null,
    limit: 10
  });
  assert.equal(playlist.items[0].trackUid, null);
  assert.equal(playlist.items[0].unresolved.reason, 'source-removed');
  assert.equal(playlist.playlist.version, 1);
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
  close();
});

async function openWebTestCatalog(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const database = new DatabaseSync(path.join(directory, 'catalog.sqlite'));
  let open = false;
  const close = () => {
    if (!open) return;
    dispatchWebSqliteCommand('close', {});
    open = false;
  };
  t.after(() => {
    close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await initializeWebSqliteRuntime(database, {
    storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
  });
  open = true;
  return { database, close };
}

function createWebTestTrack(trackUid, relativePath, overrides = {}) {
  return {
    trackUid,
    folderId: 'web-folder',
    relativePath,
    fileName: path.posix.basename(relativePath),
    title: trackUid,
    artist: 'Artist',
    albumArtist: 'Artist',
    album: 'Album',
    genre: 'Genre',
    durationSec: 10,
    ...overrides
  };
}

function createFolderDirScope(folderId, directoryPath) {
  return { folderDirKey: `${folderId.length}:${folderId}${directoryPath}` };
}

function assertDirectoriesMatchTracks(database) {
  const expected = new Map();
  for (const track of database.prepare(`
    SELECT folder_id AS folderId, relative_path AS relativePath FROM tracks
  `).all()) {
    const segments = track.relativePath.split('/');
    segments.pop();
    let parentPath = '';
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index];
      const relativePath = parentPath === '' ? name : `${parentPath}/${name}`;
      const key = `${track.folderId}\0${relativePath}`;
      const row = expected.get(key) ?? {
        folderId: track.folderId,
        relativePath,
        parentPath,
        name,
        directTrackCount: 0,
        recursiveTrackCount: 0
      };
      row.recursiveTrackCount += 1;
      if (index === segments.length - 1) row.directTrackCount += 1;
      expected.set(key, row);
      parentPath = relativePath;
    }
  }
  const actual = database.prepare(`
    SELECT folder_id AS folderId, relative_path AS relativePath, parent_path AS parentPath,
      name, direct_track_count AS directTrackCount,
      recursive_track_count AS recursiveTrackCount
    FROM directories ORDER BY folder_id, relative_path
  `).all().map(row => ({
    ...row,
    directTrackCount: Number(row.directTrackCount),
    recursiveTrackCount: Number(row.recursiveTrackCount)
  }));
  assert.deepEqual(actual, [...expected.values()].sort((left, right) => {
    if (left.folderId !== right.folderId) return left.folderId < right.folderId ? -1 : 1;
    if (left.relativePath === right.relativePath) return 0;
    return left.relativePath < right.relativePath ? -1 : 1;
  }));
}

function seedWebTestFolder() {
  dispatchWebSqliteCommand('upsertFolders', { folders: [{
    id: 'web-folder', kind: 'web-fsa', displayName: 'Music', path: '/fsa/music',
    status: 'ok', scanGeneration: 0, lifecycleVersion: 0, addedAt: 1, lastScanAt: null
  }] });
}

function beginWebTestScan(scanId) {
  return dispatchWebSqliteCommand('beginScanFolder', {
    scanId, folderId: 'web-folder', normalizedRoot: '/fsa/music', expectedLifecycleVersion: 0,
    resume: false, rootEnumerationRequired: true, continuityBroken: false,
    sweepEligibility: 'PENDING'
  });
}

function claimWebCueTrack(scan, {
  trackUid, entryKey, relativePath, signature, cueSignature, cueRelativePath = 'Album/disc.cue'
}) {
  return dispatchWebSqliteCommand('claimMetadataParse', {
    folderId: scan.folderId, trackUid, logicalStorageId: entryKey,
    lifecycleVersion: scan.lifecycleVersion, generation: scan.generation,
    relativePath, parserVersion: scan.parserVersion, signature,
    cueSignature, sourceKind: 'cue-track', entryKey,
    cueRelativePath, startFrame: 0, endFrame: 750,
    explicitRescan: false
  });
}

function completeWebMetadata(claim, title) {
  return dispatchWebSqliteCommand('completeMetadataParseSuccess', {
    claim,
    metadata: {
      title, artist: 'Artist', albumArtist: 'Artist', album: 'Album',
      genre: 'Genre', durationSec: 10
    },
    metadataStatus: 'ok', clearErrorAndRetryState: true,
    updateLastKnownGood: true, updateDerivedData: true
  });
}
