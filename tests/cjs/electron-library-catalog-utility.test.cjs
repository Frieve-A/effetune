'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
  LibraryCatalogUtilityHost
} = require('../../electron/library-catalog-utility-host.cjs');
const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');
const { MetadataWorkerPool } = require('../../electron/library-metadata-worker-pool.cjs');
const { ArtworkWorkerPool } = require('../../electron/library-artwork-worker-pool.cjs');

class FakeUtilityProcess extends EventEmitter {
  constructor({ autoRespond = true } = {}) {
    super();
    this.sent = [];
    this.killed = false;
    this.autoRespond = autoRespond;
  }

  postMessage(message) {
    this.sent.push(message);
    if (message.type === 'initialize') {
      queueMicrotask(() => this.emit('message', {
        protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
        type: 'ready', ok: true, payload: { processId: 42 }
      }));
    } else if (message.type === 'request' && this.autoRespond) {
      queueMicrotask(() => this.emit('message', {
        protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
        type: 'response', requestId: message.requestId, ok: true,
        payload: message.target === 'system' ? { closed: true } : { target: message.target, method: message.method }
      }));
    }
  }

  kill() { this.killed = true; }
}

test('utility host restarts once and enters read-only diagnostic after a repeated crash', async () => {
  const children = [];
  const host = await LibraryCatalogUtilityHost.open({
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    processFactory: () => {
      const child = new FakeUtilityProcess({ autoRespond: children.length > 0 });
      children.push(child);
      return child;
    },
    dbPath: 'C:\\catalog.sqlite'
  });

  const interrupted = host.runtime.scanFolders({ folderIds: ['folder'] });
  await new Promise(resolve => setImmediate(resolve));
  children[0].emit('exit', 1);
  await assert.rejects(interrupted, error => error?.code === 'utilityRestarted');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 2);
  assert.deepEqual(await host.runtime.scanFolders({ folderIds: ['folder'] }), {
    target: 'runtime', method: 'scanFolders'
  });

  children[1].emit('exit', 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 3);
  assert.deepEqual(children[2].sent[0].readOnlyDiagnostic, {
    code: 'utility-process-failure',
    safeDetails: { errorCode: 'utilityRepeatedFailure' }
  });
  assert.equal(host.diagnosticMode, true);
  assert.deepEqual(await host.repository.getCounts(), {
    target: 'repository', method: 'getCounts'
  });
  await host.close();
});

test('main-process utility host exposes one repository facade and relays invalidations', async () => {
  const child = new FakeUtilityProcess();
  const host = await LibraryCatalogUtilityHost.open({
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    processFactory: () => child,
    dbPath: 'C:\\catalog.sqlite'
  });

  assert.deepEqual(await host.runtime.scanFolders({ folderIds: ['folder'] }), {
    target: 'runtime', method: 'scanFolders'
  });
  assert.deepEqual(await host.coordinator.start({ operationKind: 'play' }), {
    target: 'coordinator', method: 'start'
  });
  assert.deepEqual(await host.repository.getCounts({ scope: 'tracks' }), {
    target: 'repository', method: 'getCounts'
  });

  const invalidations = [];
  host.repository.on('invalidation', event => invalidations.push(event));
  child.emit('message', {
    protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
    type: 'event', target: 'repository', eventName: 'invalidation',
    payload: { catalogVersion: 7, changedScopes: ['tracks'], scopeVersions: {}, counts: {} }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(invalidations[0].catalogVersion, 7);

  await host.close();
  assert.equal(child.killed, true);
});

test('folder dialog results are canonicalized in main before reaching the utility grant lifecycle', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-utility-folder-'));
  const folder = path.join(temporary, 'Music');
  await fs.mkdir(folder);
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const child = new FakeUtilityProcess();
  const host = await LibraryCatalogUtilityHost.open({
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: [folder] }; } },
    processFactory: () => child,
    dbPath: path.join(temporary, 'catalog.sqlite')
  });
  t.after(() => host.close());

  const response = await host.performDialog('folder');
  assert.equal(response.canceled, false);
  assert.equal(response.filePaths[0], path.resolve(await fs.realpath(folder)));
});

class FakeWorker extends EventEmitter {
  constructor(onPost) {
    super();
    this.onPost = onPost;
    this.terminated = 0;
  }
  postMessage(message) { this.onPost?.(this, message); }
  async terminate() { this.terminated += 1; }
}

test('metadata pool uses four-worker production default and terminates a hung per-file parser', async () => {
  const workers = [];
  const pool = new MetadataWorkerPool({
    timeoutMs: 100,
    workerFactory: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    }
  });
  await assert.rejects(
    pool.parse({ path: 'hung.flac', relativePath: 'hung.flac', skipCovers: true }),
    error => error?.code === 'parse-timeout'
  );
  assert.equal(pool.workerCount, 4);
  assert.equal(workers[0].terminated, 1);
  await pool.close();
});

test('artwork pool isolates worker crashes and replaces the failed slot', async () => {
  const workers = [];
  const pool = new ArtworkWorkerPool({
    workerCount: 1,
    timeoutMs: 1000,
    workerFactory: () => {
      const worker = new FakeWorker(instance => queueMicrotask(() => instance.emit('error', new Error('crash'))));
      workers.push(worker);
      return worker;
    }
  });
  await assert.rejects(pool.extract({ filePath: 'cover.flac' }), error => error?.code === 'artwork-worker-crash');
  assert.equal(workers[0].terminated, 1);
  await pool.close();
});

test('desktop bootstrap starts the scan, artwork, and operation runtime in utilityProcess', async () => {
  const mainSource = await fs.readFile(path.join(__dirname, '../../electron/main.js'), 'utf8');
  const utilitySource = await fs.readFile(path.join(__dirname, '../../electron/library-catalog-utility.cjs'), 'utf8');
  assert.match(mainSource, /utilityProcess\.fork\(modulePath/);
  assert.match(mainSource, /LibraryCatalogUtilityHost\.open/);
  assert.doesNotMatch(mainSource, /LibraryCatalogLifecycle/);
  assert.doesNotMatch(mainSource, /LibraryCatalogScanRuntime\.open/);
  assert.doesNotMatch(mainSource, /LibraryServiceCoordinator\.open/);
  assert.match(utilitySource, /LibraryCatalogHost\.open\(\{ dbPath: message\.dbPath \}\)/);
  assert.doesNotMatch(utilitySource, /createRepositoryProxy/);
});

test('utility close terminates an unresponsive child at its deadline', async () => {
  const child = new FakeUtilityProcess({ autoRespond: false });
  const host = await LibraryCatalogUtilityHost.open({
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    processFactory: () => child,
    dbPath: 'C:\\catalog.sqlite',
    closeTimeoutMs: 20
  });

  await host.close();
  assert.equal(child.killed, true);
});

test('catalog host diagnostic latch preserves reads and rejects later writes', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-utility-diagnostic-'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  t.after(async () => {
    await host.close();
    await fs.rm(temporary, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  });

  await host.enterReadOnlyDiagnostic({ code: 'test-diagnostic', safeDetails: {} });
  assert.equal((await host.getCounts()).tracks, 0);
  await assert.rejects(
    host.upsertFolders([{ folderId: 'folder', kind: 'electron', path: 'C:\\Music' }]),
    error => error?.code === 'readOnlyDiagnostic'
  );
});
