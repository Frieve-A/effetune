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
const { createLibraryDialogTranslator } = require('../../electron/library-dialog-localization.cjs');
const { MetadataWorkerPool } = require('../../electron/library-metadata-worker-pool.cjs');
const { ArtworkWorkerPool } = require('../../electron/library-artwork-worker-pool.cjs');

const TEST_DB_PATH = path.resolve(os.tmpdir(), 'effetune-catalog-utility-test.sqlite');

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

test('utility host becomes unavailable after its child exits', async () => {
  const children = [];
  const host = await LibraryCatalogUtilityHost.open({
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    processFactory: () => {
      const child = new FakeUtilityProcess({ autoRespond: false });
      children.push(child);
      return child;
    },
    dbPath: TEST_DB_PATH
  });

  const interrupted = host.runtime.scanFolders({ folderIds: ['folder'] });
  await new Promise(resolve => setImmediate(resolve));
  children[0].emit('exit', 1);
  await assert.rejects(interrupted, error => error?.code === 'utilityUnavailable');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 1);
  assert.equal(children[0].killed, true);
  await assert.rejects(host.repository.getCounts(), error => error?.code === 'utilityUnavailable');
  await host.close();
});

test('main-process utility host exposes one repository facade and relays invalidations', async () => {
  const child = new FakeUtilityProcess();
  const host = await LibraryCatalogUtilityHost.open({
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    processFactory: () => child,
    dbPath: TEST_DB_PATH
  });

  assert.deepEqual(await host.runtime.scanFolders({ folderIds: ['folder'] }), {
    target: 'runtime', method: 'scanFolders'
  });
  assert.deepEqual(await host.runtime.resolvePlaybackSource('track-1'), {
    target: 'runtime', method: 'resolvePlaybackSource'
  });
  assert.equal(host.repository.resolvePlaybackSource, undefined);
  assert.deepEqual(await host.coordinator.start({ operationKind: 'play' }), {
    target: 'coordinator', method: 'start'
  });
  assert.deepEqual(await host.coordinator.previewPlaylistImport({ source: 'grant' }), {
    target: 'coordinator', method: 'previewPlaylistImport'
  });
  assert.deepEqual(await host.coordinator.commitPlaylistImportPreview({ previewToken: 'preview' }), {
    target: 'coordinator', method: 'commitPlaylistImportPreview'
  });
  assert.deepEqual(await host.coordinator.cancelPlaylistImportPreview({ previewToken: 'preview' }), {
    target: 'coordinator', method: 'cancelPlaylistImportPreview'
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

test('main-process utility host renders artwork thumbnails requested by the utility process', async t => {
  const child = new FakeUtilityProcess();
  const decoded = [];
  const host = await LibraryCatalogUtilityHost.open({
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    imageAdapter: {
      createFromBuffer(bytes) {
        decoded.push([...bytes]);
        return {
          isEmpty: () => false,
          getSize: () => ({ width: 32, height: 16 }),
          toJPEG: () => Buffer.from([9, 8, 7])
        };
      }
    },
    processFactory: () => child,
    dbPath: TEST_DB_PATH
  });
  t.after(() => host.close());

  child.emit('message', {
    protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
    type: 'artwork-thumbnail-request',
    requestId: 73,
    bytes: new Uint8Array([1, 2, 3])
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(decoded, [[1, 2, 3]]);
  const response = child.sent.find(message =>
    message.type === 'artwork-thumbnail-response' && message.requestId === 73
  );
  assert.equal(response.ok, true);
  assert.deepEqual([...response.payload.bytes], [9, 8, 7]);
  assert.deepEqual(
    { width: response.payload.width, height: response.payload.height, mimeType: response.payload.mimeType },
    { width: 32, height: 16, mimeType: 'image/jpeg' }
  );
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

test('parent-folder consolidation uses the localized native confirmation dialog', async t => {
  const child = new FakeUtilityProcess();
  const calls = [];
  const host = await LibraryCatalogUtilityHost.open({
    dialog: {
      async showOpenDialog() { return { canceled: true, filePaths: [] }; },
      async showMessageBox(window, options) {
        calls.push([window, options]);
        return { response: 0 };
      }
    },
    getMainWindow: () => 'main-window',
    translate: createLibraryDialogTranslator({
      getLanguagePreference: () => 'ja',
      getSystemLocale: () => 'en-US'
    }),
    processFactory: () => child,
    dbPath: TEST_DB_PATH
  });
  t.after(() => host.close());

  assert.deepEqual(await host.performDialog('folder-consolidation'), { response: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'main-window');
  assert.equal(calls[0][1].message, '選択したフォルダには、既にライブラリに登録されているフォルダが含まれています。それらを選択した親フォルダに置き換えますか？');
  assert.deepEqual(calls[0][1].buttons, ['フォルダを置き換える', 'キャンセル']);
  assert.equal(calls[0][1].cancelId, 1);
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
    pool.parse({ path: path.resolve('hung.flac'), relativePath: 'hung.flac', skipCovers: true }),
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
  assert.match(mainSource, /imageAdapter: nativeImage/);
  assert.match(mainSource, /new LibraryCatalogRecovery/);
  assert.match(mainSource, /void libraryCatalogRecovery\.initialize\(\)\.catch/);
  assert.doesNotMatch(mainSource, /await libraryCatalogRecovery\.initialize\(\)/);
  assert.ok(
    mainSource.indexOf('ipcHandlers.registerIpcHandlers()') <
      mainSource.indexOf('void libraryCatalogRecovery.initialize().catch'),
    'core IPC must be ready before optional catalog initialization starts'
  );
  assert.match(mainSource, /registerLibraryCatalogRecoveryIpc/);
  assert.doesNotMatch(mainSource, /The music library catalog could not be opened/);
  assert.doesNotMatch(mainSource, /LibraryCatalogLifecycle/);
  assert.doesNotMatch(mainSource, /LibraryCatalogScanRuntime\.open/);
  assert.doesNotMatch(mainSource, /LibraryServiceCoordinator\.open/);
  assert.match(utilitySource, /LibraryCatalogHost\.open\(\{ dbPath: message\.dbPath \}\)/);
  assert.match(utilitySource, /artworkThumbnailer: source => bridgeRequest\('artwork-thumbnail-request'/);
  assert.doesNotMatch(utilitySource, /createRepositoryProxy/);
});

test('utility close terminates an unresponsive child at its deadline', async () => {
  const child = new FakeUtilityProcess({ autoRespond: false });
  const host = await LibraryCatalogUtilityHost.open({
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    processFactory: () => child,
    dbPath: TEST_DB_PATH,
    closeTimeoutMs: 20
  });

  await host.close();
  assert.equal(child.killed, true);
});

test('utility open times out and terminates a child that never becomes ready', async () => {
  const child = new EventEmitter();
  child.sent = [];
  child.killed = false;
  child.postMessage = message => child.sent.push(message);
  child.kill = () => { child.killed = true; };

  await assert.rejects(
    LibraryCatalogUtilityHost.open({
      dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
      processFactory: () => child,
      dbPath: TEST_DB_PATH,
      openTimeoutMs: 20,
      closeTimeoutMs: 20
    }),
    error => error?.code === 'utilityOpenTimeout'
  );
  assert.equal(child.killed, true);
});
