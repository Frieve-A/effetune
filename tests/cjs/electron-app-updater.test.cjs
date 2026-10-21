const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const { createAppUpdater } = require('../../electron/app-updater.cjs');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createHarness(options = {}) {
  const app = new EventEmitter();
  app.isPackaged = options.isPackaged ?? true;
  const calls = [];
  const feeds = [];
  const updater = {
    setFeedURL(feed) { feeds.push(feed); },
    async checkForUpdates() {
      calls.push('check');
      if (options.checkError) throw options.checkError;
      return Object.hasOwn(options, 'checkResult') ? options.checkResult : { isUpdateAvailable: true };
    },
    async downloadUpdate() {
      calls.push('download');
      if (options.downloadError) throw options.downloadError;
      return options.downloadPromise;
    },
    install(...args) { calls.push(['install', ...args]); }
  };
  const appUpdater = createAppUpdater({
    app,
    platform: options.platform ?? 'win32',
    isMsix: options.isMsix ?? false,
    env: options.env ?? {},
    releaseDownloadBaseUrl: 'https://releases.example/download',
    loadUpdater() { calls.push('load'); return updater; }
  });
  if (options.targetTag !== null) appUpdater.setTargetRelease(options.targetTag ?? 'v3.0.0');
  return { app, appUpdater, calls, feeds, updater };
}

test('only packaged Windows installer installations support in-app updates', async () => {
  assert.equal(createHarness().appUpdater.isSupported(), true);
  for (const options of [
    { platform: 'darwin' },
    { platform: 'linux' },
    { isPackaged: false },
    { isMsix: true },
    { env: { PORTABLE_EXECUTABLE_DIR: 'C:\\portable' } }
  ]) {
    const { appUpdater, calls } = createHarness(options);
    assert.equal(appUpdater.isSupported(), false);
    await assert.rejects(appUpdater.downloadUpdate(), /unavailable/);
    assert.deepEqual(calls, []);
  }
});

test('installation is refused until a desktop release is pinned', async () => {
  const { app, appUpdater, calls, feeds } = createHarness({ targetTag: null });
  await assert.rejects(appUpdater.downloadUpdate(), /pinned/);
  assert.deepEqual(calls, []);
  assert.deepEqual(feeds, []);
  assert.equal(app.listenerCount('quit'), 0);

  // A later check that finds an update pins the release and enables the install.
  appUpdater.setTargetRelease('v3.1.0');
  await appUpdater.downloadUpdate();
  assert.deepEqual(calls, ['load', 'check', 'download']);
  assert.deepEqual(feeds, [{
    provider: 'generic',
    url: 'https://releases.example/download/v3.1.0/',
    useMultipleRangeRequest: false
  }]);
});

test('download is lazy and single-flight, and installation runs once only after quit', async () => {
  const download = deferred();
  const { app, appUpdater, calls, updater, feeds } = createHarness({ downloadPromise: download.promise });
  assert.deepEqual(calls, []);
  const first = appUpdater.downloadUpdate();
  assert.equal(appUpdater.downloadUpdate(), first);
  await Promise.resolve();
  assert.deepEqual(calls, ['load', 'check', 'download']);
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.logger, console);
  assert.deepEqual(feeds, [{
    provider: 'generic',
    url: 'https://releases.example/download/v3.0.0/',
    useMultipleRangeRequest: false
  }]);
  assert.equal(app.listenerCount('quit'), 0);
  download.resolve();
  await first;
  assert.equal(appUpdater.downloadUpdate(), first);
  assert.equal(app.listenerCount('quit'), 1);
  assert.deepEqual(calls, ['load', 'check', 'download']);
  app.emit('quit');
  app.emit('quit');
  assert.deepEqual(calls, ['load', 'check', 'download', ['install', true, true]]);
});

test('failed checks and downloads never arm installation and can be retried', async () => {
  for (const options of [
    { checkResult: null },
    { checkResult: { isUpdateAvailable: false, updateInfo: { version: '2.10.0' } } },
    { checkError: new Error('network failure') },
    { downloadError: new Error('checksum failure') }
  ]) {
    const { app, appUpdater, calls, updater } = createHarness(options);
    await assert.rejects(appUpdater.downloadUpdate());
    assert.equal(app.listenerCount('quit'), 0);
    app.emit('quit');
    assert.equal(calls.some(call => Array.isArray(call)), false);
    updater.checkForUpdates = async () => ({ isUpdateAvailable: true });
    updater.downloadUpdate = async () => {};
    await appUpdater.downloadUpdate();
    assert.equal(app.listenerCount('quit'), 1);
    assert.equal(calls.filter(call => call === 'load').length, 1);
  }
});

function loadMainUpdateIntegration({ downloadUpdate, mainWindow, app }) {
  const source = fs.readFileSync(path.join(__dirname, '../../electron/main.js'), 'utf8');
  const start = source.indexOf('const appUpdater = createAppUpdater({ app });');
  const end = source.indexOf('// Function to get pending update info', start);
  assert.ok(start >= 0 && end > start);
  const context = {
    app,
    constants: { getMainWindow: () => mainWindow },
    createAppUpdater: () => ({ downloadUpdate })
  };
  vm.runInNewContext(source.slice(start, end), context);
  return context.downloadAndInstallUpdate;
}

test('main waits for download and registers the unload override before one normal quit', async () => {
  const pending = deferred();
  const calls = [];
  const webContents = new EventEmitter();
  const mainWindow = { isDestroyed: () => false, webContents };
  let downloadCalls = 0;
  const downloadAndInstallUpdate = loadMainUpdateIntegration({
    downloadUpdate() { downloadCalls++; return pending.promise; },
    mainWindow,
    app: { quit() {
      assert.equal(webContents.listenerCount('will-prevent-unload'), 1);
      calls.push('quit');
    } }
  });
  const first = downloadAndInstallUpdate();
  assert.equal(downloadAndInstallUpdate(), first);
  assert.equal(downloadCalls, 1);
  assert.deepEqual(calls, []);
  assert.equal(webContents.listenerCount('will-prevent-unload'), 0);
  pending.resolve();
  await first;
  await downloadAndInstallUpdate();
  assert.deepEqual(calls, ['quit']);
  webContents.emit('will-prevent-unload', { preventDefault() { calls.push('allow-unload'); } });
  assert.equal(webContents.listenerCount('will-prevent-unload'), 0);
  assert.deepEqual(calls, ['quit', 'allow-unload']);
});

test('main never quits after a failed download and allows a later retry', async () => {
  let attempts = 0;
  let quits = 0;
  const webContents = new EventEmitter();
  const downloadAndInstallUpdate = loadMainUpdateIntegration({
    async downloadUpdate() {
      if (++attempts === 1) throw new Error('download failure');
    },
    mainWindow: { isDestroyed: () => false, webContents },
    app: { quit() { quits++; } }
  });
  await assert.rejects(downloadAndInstallUpdate(), /download failure/);
  assert.equal(quits, 0);
  assert.equal(webContents.listenerCount('will-prevent-unload'), 0);
  await downloadAndInstallUpdate();
  assert.equal(quits, 1);
});
