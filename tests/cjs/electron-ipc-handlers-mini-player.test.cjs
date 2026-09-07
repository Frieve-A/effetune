const assert = require('node:assert/strict');
const test = require('node:test');

const { loadFreshModule, withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');

function createHarness({
  deferFullScreenExit = false,
  fullScreen = false,
  savedMiniBounds = null,
  contentSizeDeficit = [0, 0],
  deferContentLayout = false
} = {}) {
  const handlers = new Map();
  const calls = [];
  const fullscreenMenuItem = { enabled: true };
  let fullScreenState = fullScreen;
  let leaveFullScreenListener = null;
  let maximized = true;
  let outerBounds = { x: 100, y: 80, width: 1200, height: 800 };
  let contentSize = [1184, 730];
  const mainWindow = {
    isDestroyed: () => false,
    isFullScreen: () => fullScreenState,
    isMaximized: () => maximized,
    getBounds: () => ({ ...outerBounds }),
    getNormalBounds: () => ({ x: 100, y: 80, width: 1200, height: 800 }),
    unmaximize() {
      calls.push('unmaximize');
      maximized = false;
    },
    maximize() {
      calls.push('maximize');
      maximized = true;
    },
    setMinimumSize(width, height) {
      calls.push(['setMinimumSize', width, height]);
    },
    setBounds(bounds) {
      calls.push(['setBounds', bounds]);
      outerBounds = { ...bounds };
    },
    getContentSize: () => [...contentSize],
    setContentSize(width, height) {
      calls.push(['setContentSize', width, height]);
      const updateLayout = () => {
        const deficit = typeof contentSizeDeficit === 'function' ? contentSizeDeficit(width) : contentSizeDeficit;
        contentSize = [width - deficit[0], height - deficit[1]];
        outerBounds = { ...outerBounds, width: contentSize[0] + 16, height: contentSize[1] + 70 };
      };
      if (deferContentLayout) setImmediate(updateLayout);
      else updateLayout();
    },
    setPosition(x, y) {
      calls.push(['setPosition', x, y]);
      outerBounds = { ...outerBounds, x, y };
    },
    setAlwaysOnTop(enabled) {
      calls.push(['setAlwaysOnTop', enabled]);
    },
    setMenuBarVisibility(visible) {
      calls.push(['setMenuBarVisibility', visible]);
    },
    setResizable(enabled) {
      calls.push(['setResizable', enabled]);
    },
    setMaximizable(enabled) {
      calls.push(['setMaximizable', enabled]);
    },
    setFullScreenable(enabled) {
      calls.push(['setFullScreenable', enabled]);
    },
    setFullScreen(enabled) {
      calls.push(['setFullScreen', enabled]);
      fullScreenState = enabled;
      if (!enabled && !deferFullScreenExit) leaveFullScreenListener?.();
    },
    once(event, listener) {
      if (event === 'leave-full-screen') leaveFullScreenListener = listener;
    },
    removeListener(event, listener) {
      if (event === 'leave-full-screen' && leaveFullScreenListener === listener) {
        leaveFullScreenListener = null;
      }
    },
    webContents: { send() {} }
  };
  const electron = {
    app: { getPath: () => '', setLoginItemSettings() {} },
    clipboard: {},
    ipcMain: {
      handle(channel, handler) { handlers.set(channel, handler); },
      on() {}
    },
    Menu: {
      getApplicationMenu: () => ({
        getMenuItemById: id => id === 'toggle-fullscreen' ? fullscreenMenuItem : null
      })
    },
    shell: {},
    systemPreferences: {}
  };
  const windowState = {
    MIN_SIZE: { width: 1024, height: 768 },
    MINI_DEFAULT_SIZE: { width: 420, height: 120 },
    MINI_MIN_SIZE: { width: 320, height: 96 },
    getMiniPlayerState: () => savedMiniBounds ? {
      bounds: savedMiniBounds,
      alwaysOnTop: false
    } : null,
    resolveMiniPlayerBounds: bounds => bounds,
    resolveWindowBoundsForRestore: () => ({ x: 100, y: 80, width: 1200, height: 800 }),
    enterMiniMode: () => calls.push('enterMiniMode'),
    exitMiniMode: () => calls.push('exitMiniMode'),
    suspendSave: () => calls.push('suspendSave'),
    resumeSave: () => calls.push('resumeSave'),
    saveWindowState: () => calls.push('saveWindowState'),
    setMiniPlayerAlwaysOnTop: enabled => calls.push(['persistAlwaysOnTop', enabled]),
    isMiniMode: () => false
  };
  const constants = { getMainWindow: () => mainWindow, setMainWindow() {} };

  const ipcHandlers = withModuleLoadStub({
    electron,
    './constants': constants,
    './window-state': windowState,
    './clipboard-ipc': { registerClipboardIpcHandlers() {} },
    './bounded-file-reader': { readFileBytes() {} }
  }, () => {
    const loaded = loadFreshModule('../../electron/ipc-handlers.js');
    loaded.registerIpcHandlers();
    return loaded;
  });

  return {
    calls,
    completeFullScreenExit: () => leaveFullScreenListener?.(),
    fullscreenMenuItem,
    handlers,
    ipcHandlers,
    mainWindow
  };
}

test('mini player IPC locks its size and restores the normal window in transition order', async () => {
  const harness = createHarness();
  const setMode = harness.handlers.get('set-mini-player-mode');

  assert.deepEqual(await setMode({}, { enabled: true, alwaysOnTop: true }), {
    success: true,
    enabled: true
  });
  const expectedEntry = [
    'enterMiniMode',
    'suspendSave',
    'unmaximize',
    ...(process.platform === 'darwin' ? [] : [['setMenuBarVisibility', false]]),
    ['setMinimumSize', 320, 96],
    ['setResizable', false],
    ['setMaximizable', true],
    ['setFullScreenable', false],
    ['setContentSize', 420, 120],
    ['setPosition', 880, 80],
    ...(process.platform === 'win32' ? [['setContentSize', 420, 120]] : []),
    ['setAlwaysOnTop', true],
    ['persistAlwaysOnTop', true],
    'resumeSave',
    'saveWindowState'
  ];
  assert.deepEqual(harness.calls, expectedEntry);
  assert.equal(harness.fullscreenMenuItem.enabled, false);

  harness.calls.length = 0;
  assert.deepEqual(await setMode({}, { enabled: false }), { success: true, enabled: false });
  const expectedExit = [
    'exitMiniMode',
    'suspendSave',
    ['setAlwaysOnTop', false],
    ...(process.platform === 'darwin' ? [] : [['setMenuBarVisibility', true]]),
    ['setResizable', true],
    ['setMaximizable', true],
    ['setFullScreenable', true],
    ['setMinimumSize', 1024, 768],
    ['setBounds', { x: 100, y: 80, width: 1200, height: 800 }],
    'maximize',
    'resumeSave',
    'saveWindowState'
  ];
  if (process.platform === 'win32') {
    expectedExit.splice(9, 0, ['setBounds', { x: 100, y: 80, width: 1200, height: 800 }]);
  }
  assert.deepEqual(harness.calls, expectedExit);
  assert.equal(harness.fullscreenMenuItem.enabled, true);
});

test('mini player measures native content size after moving to the destination display', {
  skip: process.platform !== 'win32'
}, async () => {
  for (const contentSizeDeficit of [[0, 0], [2, 10], [3, 11], [4, 16]]) {
    const harness = createHarness({
      savedMiniBounds: { x: -400, y: -1400, width: 420, height: 120 },
      contentSizeDeficit,
      deferContentLayout: true
    });
    await harness.handlers.get('set-mini-player-mode')({}, { enabled: true });
    assert.deepEqual(harness.mainWindow.getContentSize(), [420, 120]);
    const positionIndex = harness.calls.findIndex(call => Array.isArray(call) && call[0] === 'setPosition');
    const sizeIndex = harness.calls.findLastIndex(call => Array.isArray(call) && call[0] === 'setContentSize');
    assert.ok(positionIndex < sizeIndex);
    const sizeCalls = harness.calls.filter(call => Array.isArray(call) && call[0] === 'setContentSize');
    assert.equal(sizeCalls.length, contentSizeDeficit.some(value => value !== 0) ? 3 : 2);
  }
});

test('mini player IPC leaves full screen before entering mini mode', async () => {
  const harness = createHarness({ deferFullScreenExit: true, fullScreen: true });
  const setMode = harness.handlers.get('set-mini-player-mode');

  const transition = setMode({}, { enabled: true });
  await Promise.resolve();
  assert.deepEqual(harness.calls[0], ['setFullScreen', false]);
  assert.equal(harness.calls.includes('enterMiniMode'), false);

  harness.completeFullScreenExit();
  assert.deepEqual(await transition, { success: true, enabled: true });
  assert.equal(harness.calls.includes('enterMiniMode'), true);
  assert.equal(harness.fullscreenMenuItem.enabled, false);
});

test('saved mini position is reused with the fixed default mini size', async () => {
  const harness = createHarness({
    savedMiniBounds: { x: 500, y: 60, width: 800, height: 400 }
  });

  await harness.handlers.get('set-mini-player-mode')({}, { enabled: true });

  assert.equal(harness.calls.some(call => Array.isArray(call) && call[0] === 'setContentSize' &&
    call[1] === 420 && call[2] === 120), true);
  assert.equal(harness.calls.some(call => Array.isArray(call) && call[0] === 'setPosition' &&
    call[1] === 500 && call[2] === 60), true);
});

test('assigning a replacement main window clears stale mini mode tracking', async () => {
  const harness = createHarness();
  const setMode = harness.handlers.get('set-mini-player-mode');
  const setAlwaysOnTop = harness.handlers.get('set-always-on-top');

  await setMode({}, { enabled: true });
  harness.ipcHandlers.setMainWindow({ ...harness.mainWindow });

  assert.equal(harness.fullscreenMenuItem.enabled, true);
  assert.throws(
    () => setAlwaysOnTop({}, true),
    /only available in mini player mode/
  );
  assert.deepEqual(await setMode({}, { enabled: false }), { success: true, enabled: false });
});

test('mini player remeasures corrected size when fractional DPI changes native rounding', {
  skip: process.platform !== 'win32'
}, async () => {
  const harness = createHarness({
    contentSizeDeficit: width => [width === 420 ? 2 : 1, 10],
    deferContentLayout: true
  });
  await harness.handlers.get('set-mini-player-mode')({}, { enabled: true });
  assert.deepEqual(harness.mainWindow.getContentSize(), [420, 120]);
});
