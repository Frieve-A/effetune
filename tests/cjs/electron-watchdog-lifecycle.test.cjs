'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { CHANNELS, PANEL_CHANNELS, registerRemoteControlIpc } = require('../../electron/remote-control-host.cjs');

const mainPath = path.resolve(__dirname, '../../electron/main.js');
const mainSource = fs.readFileSync(mainPath, 'utf8');

function sourceBetween(start, end) {
  const startIndex = mainSource.indexOf(start);
  const endIndex = mainSource.indexOf(end, startIndex);
  assert.ok(startIndex >= 0 && endIndex > startIndex);
  return mainSource.slice(startIndex, endIndex);
}

function createMainHarness() {
  let now = 1_000;
  let nextTimer = 0;
  const timers = new Map();
  const handlers = new Map();
  const ipcMain = new EventEmitter();
  ipcMain.handle = (channel, handler) => handlers.set(channel, handler);
  ipcMain.removeHandler = channel => handlers.delete(channel);
  const lifecycle = [];
  const logs = [];
  const app = new EventEmitter();
  app.quit = () => lifecycle.push('quit');
  app.relaunch = () => lifecycle.push('relaunch');
  app.exit = () => lifecycle.push('exit');
  const window = { isDestroyed: () => false, webContents: { send() {} } };
  const context = vm.createContext({
    app,
    process: { platform: 'win32', exit: () => lifecycle.push('process.exit') },
    queueAutoRestart: () => lifecycle.push('relaunch'),
    armQuitProtection: () => lifecycle.push('quit-deadline'),
    isAppQuitting: false,
    appServicesShutdownReady: false,
    appServicesClosePromise: null,
    libraryCatalogRecovery: {},
    closeLibraryCatalogRecovery: async () => {},
    openHomeControlHost: null,
    airPlayReceiverHost: null,
    disposeAirPlayIpc: null,
    disposeOpenHomeIpc: null,
    networkMusicHost: null,
    disposeNetworkMusicIpc: null,
    disposeIntegratedRemoteClientIpc: null,
    remoteControlHost: null,
    disposeRemoteControlIpc: null,
    alacPlaybackSource: null,
    disposePowerMonitorEvents: null,
    powerMonitor: new EventEmitter(),
    constants: { getMainWindow: () => window },
    ipcMain,
    Date: { now: () => now },
    setInterval(callback) {
      const id = ++nextTimer;
      timers.set(id, callback);
      return id;
    },
    clearInterval: id => timers.delete(id),
    console: Object.fromEntries(['log', 'warn', 'error'].map(level =>
      [level, (...args) => logs.push([level, ...args])]))
  });
  vm.runInContext([
    sourceBetween('async function closeApplicationServices()', '// Keep the main window hidden'),
    sourceBetween('// Renderer watchdog state', '// macOS only:'),
    sourceBetween("app.on('before-quit'", '// Export functions')
  ].join('\n'), context, { filename: mainPath });
  return {
    context, app, ipcMain, handlers, lifecycle, logs, timers, window,
    advance(milliseconds) {
      now += milliseconds;
      for (const callback of [...timers.values()]) callback();
    },
    invoke(channel, ...args) {
      const handler = handlers.get(channel);
      assert.equal(typeof handler, 'function', `No handler registered for '${channel}'`);
      return handler({ sender: window.webContents }, ...args);
    }
  };
}

test('renderer and main-process scheduling delays never terminate or relaunch the application', () => {
  const harness = createMainHarness();
  const { context, ipcMain, lifecycle, logs, timers } = harness;
  context.startWatchdog();
  ipcMain.emit('renderer-ping');

  // A delayed main-process tick must be as harmless as a delayed renderer ping.
  for (const delay of [16_000, 60_000, 3_600_000, 86_400_000]) {
    harness.advance(delay);
    assert.deepEqual(lifecycle, []);
    assert.equal(timers.size, 1);
  }
  assert.equal(logs.filter(([level]) => level === 'warn').length, 1);

  ipcMain.emit('renderer-ping');
  harness.advance(2_000);
  assert.deepEqual(lifecycle, []);
  assert.equal(logs.filter(([, message]) => message.includes('responsive again')).length, 1);
  harness.advance(16_000);
  assert.equal(logs.filter(([level]) => level === 'warn').length, 2);
  assert.deepEqual(lifecycle, []);
});

test('navigation and system sleep pause diagnostics until the next renderer heartbeat or resume', () => {
  const harness = createMainHarness();
  const { context, ipcMain, lifecycle, logs } = harness;
  context.startWatchdog();
  context.registerWatchdogPowerEvents();
  ipcMain.emit('renderer-ping');
  harness.invoke('renderer-watchdog-disarm', 'navigation');
  harness.advance(60_000);
  assert.equal(logs.filter(([level]) => level === 'warn').length, 0);

  ipcMain.emit('renderer-ping');
  context.powerMonitor.emit('suspend');
  ipcMain.emit('renderer-ping');
  harness.advance(86_400_000);
  context.powerMonitor.emit('resume');
  harness.advance(2_000);
  assert.equal(logs.filter(([level]) => level === 'warn').length, 0);
  harness.advance(16_000);
  assert.equal(logs.filter(([level]) => level === 'warn').length, 1);
  assert.deepEqual(lifecycle, []);
});

test('late renderer pings and arm requests cannot restart monitoring during explicit shutdown', async () => {
  const harness = createMainHarness();
  const { context, app, ipcMain, logs, lifecycle, timers } = harness;
  context.startWatchdog();
  ipcMain.emit('renderer-ping');
  app.emit('before-quit', { preventDefault() {} });
  const logCount = logs.length;
  ipcMain.emit('renderer-ping');
  harness.invoke('renderer-watchdog-arm', 'late-renderer');
  assert.equal(logs.length, logCount);
  assert.equal(timers.size, 0);
  assert.deepEqual(lifecycle, ['quit-deadline']);
  await context.closeApplicationServices();
});

test('remote IPC remains registered through service shutdown and is released only at will-quit', async () => {
  const harness = createMainHarness();
  const { context, app, ipcMain, handlers, window } = harness;
  let finishDispose;
  const disposed = new Promise(resolve => { finishDispose = resolve; });
  context.remoteControlHost = { dispose: () => disposed };
  context.disposeRemoteControlIpc = registerRemoteControlIpc({
    ipcMain,
    getHost: () => context.remoteControlHost,
    getMainWindow: () => window
  });
  app.emit('before-quit', { preventDefault() {} });
  try {
    assert.equal(harness.invoke(CHANNELS.state, { pipeline: [] }), false);
    assert.equal(harness.invoke(CHANNELS.rendererUnavailable), false);
    assert.equal(harness.invoke(CHANNELS.rendererReady).enabled, false);
    assert.equal(harness.invoke(PANEL_CHANNELS.getStatus).enabled, false);
    assert.equal(await harness.invoke(PANEL_CHANNELS.setEnabled, true), false);
    assert.throws(() => handlers.get(CHANNELS.state)({ sender: {} }), /invalid-sender/);
  } finally {
    finishDispose();
    await context.closeApplicationServices();
  }
  assert.equal(harness.invoke(CHANNELS.rendererUnavailable), false);
  app.emit('will-quit');
  assert.equal(handlers.has(CHANNELS.state), false);
  assert.equal(handlers.has(CHANNELS.rendererUnavailable), false);
  assert.equal(context.disposeRemoteControlIpc, null);
});
