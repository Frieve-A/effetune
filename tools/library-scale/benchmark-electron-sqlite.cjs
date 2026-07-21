'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');

const FOLDER_TREE_ID = 'folder-tree-scale';
const DEFAULT_FOLDER_TREE_SCAN_CLAIM_SAMPLE = 100_000;
const DEFAULT_FOLDER_TREE_SAMPLES = 20;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) throw new TypeError(`Unexpected argument: ${token}`);
    const name = token.slice(2);
    if (name === 'help' || name === 'json' || name === 'folder-tree-v3') {
      args[name] = true;
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new TypeError(`Missing value for --${name}`);
    }
    args[name] = value;
    index += 1;
  }
  return args;
}

function usage() {
  return [
    'Usage: node tools/library-scale/benchmark-electron-sqlite.cjs [options]',
    '  --size <rows>          row count (safe default: 10000)',
    '  --preset <name>        million or boundary',
    '  --batch-size <rows>    transaction batch size (default: 1000)',
    '  --seed <uint32>        deterministic fixture seed',
    '  --database <path>      new database path (default: in-memory)',
    '  --folder-tree-v3       measure folder browsing through the production v3 catalog host',
    '  --scan-claim-sample <rows>  active-scan claim sample (default: 100000)',
    '  --samples <count>      browse/context samples for p95 (default: 20)',
    '  --output <path>        write the folder-tree JSON measurement',
    '  --json                 print JSON',
    '',
    'Run this entry point with the Electron-bundled Node runtime for local development diagnostics.'
  ].join('\n');
}

async function run(argv = process.argv.slice(2), io = console) {
  const args = parseArgs(argv);
  if (args.help) {
    io.log(usage());
    return { help: true };
  }
  const sqlite = require('node:sqlite');
  const fixtureUrl = pathToFileURL(path.join(__dirname, 'catalog-fixture.mjs')).href;
  const fixture = await import(fixtureUrl);
  const count = fixture.resolveScaleSize({ size: args.size, preset: args.preset });
  const batchSize = args['batch-size'] === undefined
    ? fixture.DEFAULT_BATCH_SIZE
    : Number(args['batch-size']);
  const seed = args.seed === undefined ? fixture.DEFAULT_FIXTURE_SEED : Number(args.seed);
  if (args['folder-tree-v3']) {
    return runFolderTreeV3({ args, fixture, count, batchSize, seed, io });
  }
  const databasePath = args.database ? path.resolve(args.database) : ':memory:';
  if (databasePath !== ':memory:' && fs.existsSync(databasePath)) {
    throw new Error(`Refusing to overwrite existing database: ${databasePath}`);
  }

  const database = new sqlite.DatabaseSync(databasePath);
  const startedAt = process.hrtime.bigint();
  try {
    database.exec('PRAGMA foreign_keys=ON');
    if (databasePath !== ':memory:') database.exec('PRAGMA journal_mode=WAL');
    database.exec(`
      CREATE TABLE tracks(
        track_uid TEXT PRIMARY KEY,
        folder_id TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        album_artist TEXT NOT NULL,
        album TEXT NOT NULL,
        genre TEXT NOT NULL,
        duration_sec REAL NOT NULL,
        UNIQUE(folder_id, relative_path)
      );
      CREATE INDEX tracks_by_title ON tracks(title, track_uid);
      CREATE INDEX tracks_by_artist_album ON tracks(album_artist, album, track_uid);
    `);
    const insert = database.prepare(`
      INSERT INTO tracks(
        track_uid, folder_id, relative_path, file_name, title,
        artist, album_artist, album, genre, duration_sec
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const batch of fixture.catalogBatches({ count, seed, batchSize })) {
      database.exec('BEGIN IMMEDIATE');
      try {
        for (const track of batch) {
          insert.run(
            track.trackUid,
            track.folderId,
            track.relativePath,
            track.fileName,
            track.title,
            track.artist,
            track.albumArtist,
            track.album,
            track.genre,
            track.durationSec
          );
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
    const total = database.prepare('SELECT COUNT(*) AS count FROM tracks').get().count;
    const first = database.prepare(
      'SELECT track_uid FROM tracks ORDER BY title, track_uid LIMIT 1'
    ).get();
    const middle = database.prepare(
      'SELECT track_uid FROM tracks ORDER BY title, track_uid LIMIT 1 OFFSET ?'
    ).get(Math.floor(count / 2));
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const result = {
      runtime: process.versions.electron ? 'electron-node' : 'node',
      nodeVersion: process.versions.node,
      sqliteVersion: database.prepare('SELECT sqlite_version() AS version').get().version,
      databasePath,
      count: Number(total),
      batchSize,
      firstTrackUid: first.track_uid,
      middleTrackUid: middle.track_uid,
      elapsedMs
    };
    io.log(args.json ? JSON.stringify(result, null, 2) : Object.entries(result)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'));
    return result;
  } finally {
    database.close();
  }
}

async function runFolderTreeV3({ args, fixture, count, batchSize, seed, io }) {
  const scanClaimSample = args['scan-claim-sample'] === undefined
    ? Math.min(DEFAULT_FOLDER_TREE_SCAN_CLAIM_SAMPLE, count)
    : Number(args['scan-claim-sample']);
  const samples = args.samples === undefined ? DEFAULT_FOLDER_TREE_SAMPLES : Number(args.samples);
  if (!Number.isSafeInteger(scanClaimSample) || scanClaimSample <= 0 || scanClaimSample > count ||
      !Number.isSafeInteger(samples) || samples <= 0) {
    throw new TypeError('folder-tree scan-claim-sample and samples must be positive integers within the fixture');
  }
  const requestedDatabasePath = args.database ? path.resolve(args.database) : null;
  if (requestedDatabasePath && fs.existsSync(requestedDatabasePath)) {
    throw new Error(`Refusing to overwrite existing database: ${requestedDatabasePath}`);
  }
  const temporaryRoot = requestedDatabasePath
    ? null
    : fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-folder-tree-scale-'));
  const databasePath = requestedDatabasePath || path.join(temporaryRoot, 'catalog.sqlite');
  const audioRoot = path.join(path.dirname(databasePath), 'audio');
  fs.mkdirSync(audioRoot, { recursive: true });
  let host = null;
  try {
    host = await LibraryCatalogHost.open({ dbPath: databasePath });
    await host.upsertFolders([{
      id: FOLDER_TREE_ID,
      kind: 'electron',
      displayName: 'Folder Tree Scale',
      path: audioRoot,
      status: 'ok',
      lifecycleVersion: 1,
      scanGeneration: 0,
      addedAt: 1
    }]);
    await host.close();
    host = null;

    const rawCount = count - scanClaimSample;
    const rawSeedStarted = performance.now();
    seedRawTracks(databasePath, fixture, { count: rawCount, seed, batchSize });
    const rawSeedMs = performance.now() - rawSeedStarted;

    let started = performance.now();
    host = await LibraryCatalogHost.open({ dbPath: databasePath });
    const initialDirectoryRebuildMs = performance.now() - started;

    const scan = await host.beginScanFolder({
      scanId: 'folder-tree-scale-active-scan',
      folderId: FOLDER_TREE_ID,
      normalizedRoot: audioRoot,
      expectedLifecycleVersion: 1,
      resume: false,
      rootEnumerationRequired: true,
      continuityBroken: false,
      sweepEligibility: 'INELIGIBLE'
    });
    started = performance.now();
    for (let offset = rawCount; offset < count; offset += 500) {
      const length = Math.min(500, count - offset);
      const requests = Array.from({ length }, (_unused, index) => {
        const track = fixture.createFolderTreeScaleTrack(offset + index, seed);
        return {
          folderId: FOLDER_TREE_ID,
          trackUid: track.trackUid,
          lifecycleVersion: scan.lifecycleVersion,
          generation: scan.generation,
          relativePath: track.relativePath,
          parserVersion: scan.parserVersion,
          signature: {
            fileIdentity: `scale:${track.trackUid}`,
            size: track.size,
            mtimeMs: track.mtimeMs
          },
          explicitRescan: false
        };
      });
      const claimed = await host.claimMetadataParseBatch({ requests });
      if (claimed.results.length !== requests.length) {
        throw new Error('Active-scan metadata claim returned an incomplete batch');
      }
    }
    const productionScanClaimMs = performance.now() - started;
    await host.completeScanFolderNoSweep({
      scanId: scan.scanId,
      folderId: FOLDER_TREE_ID,
      generation: scan.generation,
      expectedLifecycleVersion: scan.lifecycleVersion,
      status: 'completed-no-sweep',
      sweepBlockReason: 'scale-measurement-no-sweep'
    });

    const expectedFirstLevelCount = Math.min(count, fixture.FOLDER_TREE_FIRST_LEVEL_COUNT);
    const browse = await measureFolderBrowse(host, {
      samples,
      firstLevelDirectoryCount: expectedFirstLevelCount
    });
    const contexts = await measureFolderContexts(host, { samples });
    const counts = await host.getCounts();
    await host.close();
    host = null;

    const beforeRebuild = inspectFolderTreeDatabase(databasePath);
    forceFullDirectoryRebuild(databasePath);
    started = performance.now();
    host = await LibraryCatalogHost.open({ dbPath: databasePath });
    const fullDirectoryRebuildMs = performance.now() - started;
    await host.close();
    host = null;
    const afterRebuild = inspectFolderTreeDatabase(databasePath);
    if (Number(counts.tracks) !== count || beforeRebuild.directoryCount !== afterRebuild.directoryCount ||
        afterRebuild.firstLevelDirectoryCount !== expectedFirstLevelCount ||
        count >= fixture.SCALE_PRESETS.million && afterRebuild.firstLevelDirectoryCount <= 100_000 ||
        afterRebuild.generation !== afterRebuild.watermark) {
      throw new Error('Folder-tree scale fixture failed its production v3 integrity checks');
    }

    const electronQueryBudgetMs = args.preset === 'million' ? 100 : null;
    const queryMetrics = [
      browse.firstP95Ms,
      browse.middleP95Ms,
      browse.lastP95Ms,
      contexts.rootFirstPageP95Ms,
      contexts.rootCountP95Ms
    ];
    const result = {
      schemaVersion: 2,
      kind: 'effetune-library-folder-tree-v3-scale',
      measuredAt: new Date().toISOString(),
      source: sourceIdentity(),
      machine: machineIdentity(),
      runtime: {
        adapter: 'electron-library-catalog-worker-v3',
        node: process.versions.node,
        sqlite: afterRebuild.sqliteVersion
      },
      fixture: {
        preset: args.preset || null,
        count,
        seed,
        batchSize,
        productionScanClaimSample: scanClaimSample,
        firstLevelDirectoryCount: afterRebuild.firstLevelDirectoryCount
      },
      metrics: {
        rawSeedMs,
        rawSeedTracksPerSecond: rawCount > 0 ? rawCount * 1000 / rawSeedMs : null,
        initialDirectoryRebuildMs,
        productionScanClaimMs,
        productionScanClaimTracksPerSecond: scanClaimSample * 1000 / productionScanClaimMs,
        fullDirectoryRebuildMs,
        databaseBytes: afterRebuild.databaseBytes,
        directoryCount: afterRebuild.directoryCount,
        browse,
        contexts
      },
      queryPlans: afterRebuild.queryPlans,
      budgets: {
        electronMillionCommonQueryP95Ms: electronQueryBudgetMs,
        queryDecision: electronQueryBudgetMs === null
          ? 'boundary-diagnostic-no-ux-budget'
          : queryMetrics.every(value => value < electronQueryBudgetMs) ? 'pass' : 'fail',
        rootFolderDirCountDecision: contexts.rootCountP95Ms <= contexts.folderCountP95Ms
          ? 'pass-root-no-slower-than-folder'
          : 'fail-root-slower-than-folder',
        rebuildDecision: 'unqualified-no-phase0-ceiling',
        productionScanClaimDecision: 'unqualified-no-comparable-phase0-baseline-or-ceiling',
        architectureSwitch: 'pending-without-a-qualified-phase0-comparator'
      }
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (args.output) {
      const outputPath = path.resolve(args.output);
      if (fs.existsSync(outputPath)) throw new Error(`Refusing to overwrite existing output: ${outputPath}`);
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, serialized, 'utf8');
    }
    io.log(args.json || args.output ? serialized.trimEnd() : formatResult(result));
    if (result.budgets.queryDecision === 'fail' ||
        result.budgets.rootFolderDirCountDecision.startsWith('fail')) {
      throw new Error('Folder-tree query measurements exceed the applicable plan criteria');
    }
    return result;
  } finally {
    await host?.close().catch(() => {});
    if (temporaryRoot) {
      await fs.promises.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }
}

function seedRawTracks(databasePath, fixture, { count, seed, batchSize }) {
  if (count === 0) return;
  const { DatabaseSync } = require('node:sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('PRAGMA journal_mode=WAL');
    const insert = database.prepare(`
      INSERT INTO tracks(
        track_uid, folder_id, relative_path, file_name, title, artist, album_artist, album, genre,
        duration_sec, metadata_parser_version, added_at, updated_at, search_text,
        normalized_basename, normalized_title, normalized_artist
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'catalog-metadata-v5', ?, ?, ?, ?, ?, ?)
    `);
    for (let offset = 0; offset < count; offset += batchSize) {
      const length = Math.min(batchSize, count - offset);
      database.exec('BEGIN IMMEDIATE');
      try {
        for (let index = 0; index < length; index += 1) {
          const track = fixture.createFolderTreeScaleTrack(offset + index, seed);
          insert.run(
            track.trackUid, track.folderId, track.relativePath, track.fileName, track.title,
            track.artist, track.albumArtist, track.album, track.genre, track.durationSec,
            track.addedAt, track.addedAt, `${track.title} ${track.artist} ${track.album}`,
            track.fileName.toLowerCase(), track.title.toLowerCase(), track.artist.toLowerCase()
          );
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    }
  } finally {
    database.close();
  }
}

async function measureFolderBrowse(host, { samples, firstLevelDirectoryCount }) {
  if (firstLevelDirectoryCount < 5_000) {
    throw new Error('Folder-tree browse measurement requires at least 5000 first-level directories');
  }
  const middleCursor = `Directory-${String(Math.floor(firstLevelDirectoryCount / 2) - 1).padStart(6, '0')}`;
  const lastCursor = `Directory-${String(firstLevelDirectoryCount - 501).padStart(6, '0')}`;
  const probes = {
    first: { folderId: FOLDER_TREE_ID, path: '', limit: 500 },
    middle: { folderId: FOLDER_TREE_ID, path: '', cursor: middleCursor, limit: 500 },
    last: { folderId: FOLDER_TREE_ID, path: '', cursor: lastCursor, limit: 500 }
  };
  const timings = { first: [], middle: [], last: [], tenPages: [] };
  for (let sample = 0; sample < samples; sample += 1) {
    for (const [name, request] of Object.entries(probes)) {
      const started = performance.now();
      const result = await host.browseFolderChildren(request);
      timings[name].push(performance.now() - started);
      if (result.children.length !== 500 || result.nodeExists !== true ||
          name === 'last' && result.hasMore !== false) {
        throw new Error(`Folder-tree ${name} browse probe returned an unexpected page`);
      }
    }
    let cursor = null;
    const started = performance.now();
    for (let pageIndex = 0; pageIndex < 10; pageIndex += 1) {
      const result = await host.browseFolderChildren({
        folderId: FOLDER_TREE_ID,
        path: '',
        ...(cursor ? { cursor } : {}),
        limit: 500
      });
      if (result.children.length !== 500 || !result.hasMore || !result.cursor) {
        throw new Error('Folder-tree consecutive browse probe ended before ten pages');
      }
      cursor = result.cursor;
    }
    timings.tenPages.push(performance.now() - started);
  }
  return {
    samples,
    pageSize: 500,
    firstP95Ms: p95(timings.first),
    middleP95Ms: p95(timings.middle),
    lastP95Ms: p95(timings.last),
    tenPagesP95Ms: p95(timings.tenPages)
  };
}

async function measureFolderContexts(host, { samples }) {
  const rootScope = { folderDirKey: `${FOLDER_TREE_ID.length}:${FOLDER_TREE_ID}` };
  const leafPath = 'Directory-000000/Album-000';
  const leafScope = { folderDirKey: `${FOLDER_TREE_ID.length}:${FOLDER_TREE_ID}${leafPath}` };
  const timings = {
    rootFirstPage: [], rootCount: [], folderCreate: [], folderCount: [], leafCreate: [], leafCount: []
  };
  let rootCount = null;
  let rootPageRows = null;
  let folderCount = null;
  let leafCount = null;
  for (let sample = 0; sample < samples; sample += 1) {
    for (const [name, scope] of [
      ['root', rootScope],
      ['folder', { folderKey: FOLDER_TREE_ID }],
      ['leaf', leafScope]
    ]) {
      if (name === 'root') {
        let started = performance.now();
        const page = await host.queryTracks({
          query: '', sort: 'title', direction: 'asc', scope, limit: 500
        });
        timings.rootFirstPage.push(performance.now() - started);
        started = performance.now();
        rootCount = Number((await host.getContextCount({ contextToken: page.contextToken })).totalCount);
        timings.rootCount.push(performance.now() - started);
        rootPageRows = page.rows.length;
        await host.releaseContext(page.contextToken);
        continue;
      }
      let started = performance.now();
      const context = await host.createContext({ query: '', sort: 'title', direction: 'asc', scope });
      timings[`${name}Create`].push(performance.now() - started);
      started = performance.now();
      const count = Number((await host.getContextCount({ contextToken: context.contextToken })).totalCount);
      timings[`${name}Count`].push(performance.now() - started);
      await host.releaseContext(context.contextToken);
      if (name === 'folder') folderCount = count;
      else leafCount = count;
    }
  }
  if (rootCount !== 0 || rootPageRows !== 0 || folderCount === 0 || leafCount === 0) {
    throw new Error('Folder-tree context probes returned unexpected counts');
  }
  return {
    samples,
    rootTrackCount: rootCount,
    rootFirstPageRows: rootPageRows,
    folderTrackCount: folderCount,
    leafTrackCount: leafCount,
    rootFirstPageP95Ms: p95(timings.rootFirstPage),
    rootCountP95Ms: p95(timings.rootCount),
    folderCreateP95Ms: p95(timings.folderCreate),
    folderCountP95Ms: p95(timings.folderCount),
    leafCreateP95Ms: p95(timings.leafCreate),
    leafCountP95Ms: p95(timings.leafCount)
  };
}

function forceFullDirectoryRebuild(databasePath) {
  const { DatabaseSync } = require('node:sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec('BEGIN IMMEDIATE');
    database.prepare('DELETE FROM directories').run();
    database.prepare("DELETE FROM meta WHERE key = 'directories_watermark'").run();
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.close();
  }
}

function inspectFolderTreeDatabase(databasePath) {
  const { DatabaseSync } = require('node:sqlite');
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const state = database.prepare(`
      SELECT
        (SELECT COUNT(*) FROM directories WHERE folder_id = ?) AS directoryCount,
        (SELECT COUNT(*) FROM directories WHERE folder_id = ? AND parent_path = '') AS firstLevelDirectoryCount,
        (SELECT generation FROM directories_sync WHERE id = 1) AS generation,
        (SELECT CAST(value AS INTEGER) FROM meta WHERE key = 'directories_watermark') AS watermark
    `).get(FOLDER_TREE_ID, FOLDER_TREE_ID);
    const queryPlans = {
      browseContinuation: database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT name FROM directories
        WHERE folder_id = ? AND parent_path = ? AND name > ?
        ORDER BY name LIMIT ?
      `).all(FOLDER_TREE_ID, '', 'Directory-049999', 500).map(row => String(row.detail)),
      rootDirectTracks: database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT count(*) FROM tracks INDEXED BY tracks_root_direct_by_folder
        WHERE folder_id = ? AND instr(relative_path, '/') = 0
      `).all(FOLDER_TREE_ID).map(row => String(row.detail)),
      nestedDirectTracks: database.prepare(`
        EXPLAIN QUERY PLAN
        SELECT track_uid FROM tracks
        WHERE folder_id = ? AND relative_path >= ? || '/' AND relative_path < ? || '0'
          AND instr(substr(relative_path, length(?) + 2), '/') = 0
      `).all(FOLDER_TREE_ID, 'Directory-000000/Album-000',
        'Directory-000000/Album-000', 'Directory-000000/Album-000').map(row => String(row.detail))
    };
    if (!queryPlans.browseContinuation.some(detail => detail.includes('directories_by_parent') && detail.includes('name>?')) ||
        !queryPlans.rootDirectTracks.some(detail => detail.includes('tracks_root_direct_by_folder')) ||
        !queryPlans.nestedDirectTracks.some(detail => detail.includes('tracks_by_folder_relative_path') && detail.includes('relative_path>?'))) {
      throw new Error('Folder-tree scale query plans do not use the required production indexes');
    }
    return {
      directoryCount: Number(state.directoryCount),
      firstLevelDirectoryCount: Number(state.firstLevelDirectoryCount),
      generation: Number(state.generation),
      watermark: state.watermark == null ? null : Number(state.watermark),
      sqliteVersion: database.prepare('SELECT sqlite_version() AS version').get().version,
      databaseBytes: fs.statSync(databasePath).size,
      queryPlans
    };
  } finally {
    database.close();
  }
}

function p95(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function sourceIdentity() {
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  return {
    commitSha: commit.status === 0 ? commit.stdout.trim() : null,
    dirty: status.status === 0 ? Boolean(status.stdout.trim()) : null
  };
}

function machineIdentity() {
  return {
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model || 'unknown',
    logicalCores: os.cpus().length,
    totalMemoryBytes: os.totalmem()
  };
}

function formatResult(result) {
  return [
    `fixture: ${result.fixture.preset || result.fixture.count}`,
    `tracks: ${result.fixture.count}`,
    `directories: ${result.metrics.directoryCount}`,
    `productionScanClaimTracksPerSecond: ${result.metrics.productionScanClaimTracksPerSecond}`,
    `fullDirectoryRebuildMs: ${result.metrics.fullDirectoryRebuildMs}`,
    `browseFirstP95Ms: ${result.metrics.browse.firstP95Ms}`,
    `browseMiddleP95Ms: ${result.metrics.browse.middleP95Ms}`,
    `browseLastP95Ms: ${result.metrics.browse.lastP95Ms}`,
    `browseTenPagesP95Ms: ${result.metrics.browse.tenPagesP95Ms}`,
    `rootFirstPageP95Ms: ${result.metrics.contexts.rootFirstPageP95Ms}`,
    `rootCountP95Ms: ${result.metrics.contexts.rootCountP95Ms}`,
    `queryDecision: ${result.budgets.queryDecision}`
  ].join('\n');
}

if (require.main === module) {
  run().catch(error => {
    console.error(`SQLite benchmark failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { run };
