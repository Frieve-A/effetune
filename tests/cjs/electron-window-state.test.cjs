const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createTempDir,
  loadFreshModule,
  withModuleLoadStub,
  withMutedConsole,
  withPatchedProperty
} = require('../helpers/cjs-module-utils.cjs');

function createHarness(options = {}) {
  const userDataPath = options.userDataPath || createTempDir('effetune-window-state');
  const constantsCalls = [];
  let windowState = options.windowState || {
    bounds: { width: 1440, height: 900 },
    isMaximized: false
  };
  let mainWindow = options.mainWindow || null;
  const primaryWorkArea = options.primaryWorkArea || { x: 0, y: 0, width: 1920, height: 1080 };
  const matchingWorkArea = options.matchingWorkArea || primaryWorkArea;
  const screenCalls = [];
  const constants = {
    getWindowState: () => windowState,
    setWindowState: state => {
      constantsCalls.push(['setWindowState', state]);
      windowState = state;
    },
    getMainWindow: () => mainWindow,
    setMainWindow: value => {
      mainWindow = value;
    }
  };
  const screen = {
    getPrimaryDisplay: () => ({ workArea: primaryWorkArea }),
    getDisplayMatching: bounds => {
      screenCalls.push(bounds);
      return {
        workArea: typeof matchingWorkArea === 'function' ? matchingWorkArea(bounds) : matchingWorkArea
      };
    }
  };

  const module = withModuleLoadStub({
    electron: { screen },
    './constants': constants,
    './file-handlers': { getUserDataPath: () => userDataPath }
  }, () => loadFreshModule('../../electron/window-state.js'));

  return {
    constants,
    constantsCalls,
    get windowState() {
      return windowState;
    },
    module,
    screenCalls,
    setMainWindow: value => {
      mainWindow = value;
    },
    userDataPath
  };
}

function readSavedWindowState(userDataPath) {
  return JSON.parse(fs.readFileSync(path.join(userDataPath, 'window-state.json'), 'utf8'));
}

test('resolveWindowBoundsForRestore centers default size when no saved position exists', () => {
  const { module } = createHarness({
    windowState: { bounds: {}, isMaximized: false },
    primaryWorkArea: { x: 0, y: 0, width: 1920, height: 1080 }
  });

  assert.deepEqual(module.resolveWindowBoundsForRestore(), {
    width: 1440,
    height: 900,
    x: 240,
    y: 90
  });
});

test('resolveWindowBoundsForRestore tolerates missing bounds state', () => {
  const { module } = createHarness({
    windowState: { isMaximized: false },
    primaryWorkArea: { x: 0, y: 0, width: 1920, height: 1080 }
  });

  assert.deepEqual(module.resolveWindowBoundsForRestore(), {
    width: 1440,
    height: 900,
    x: 240,
    y: 90
  });
});

test('resolveWindowBoundsForRestore recenters saved off-screen windows on the matched display', () => {
  const { module, screenCalls } = createHarness({
    windowState: { bounds: { x: 5000.1, y: 5000.8, width: 1280.4, height: 720.4 }, isMaximized: false },
    matchingWorkArea: { x: 100, y: 50, width: 1600, height: 900 }
  });

  assert.deepEqual(module.resolveWindowBoundsForRestore(), {
    width: 1280,
    height: 768,
    x: 260,
    y: 116
  });
  assert.deepEqual(screenCalls, [{ width: 1280, height: 768, x: 5000, y: 5001 }]);
});

test('resolveWindowBoundsForRestore clamps overlapping windows fully into work area and enforces minimum size', () => {
  const { module } = createHarness({
    windowState: { bounds: { x: 900.2, y: -50.8, width: 700.4, height: 600.2 }, isMaximized: false },
    matchingWorkArea: { x: 0, y: 0, width: 1000, height: 800 }
  });

  assert.deepEqual(module.resolveWindowBoundsForRestore(), {
    width: 1024,
    height: 768,
    x: 0,
    y: 0
  });
});

test('getSplashTargetBounds uses current window bounds unless restoring maximized', () => {
  const mainWindow = { getBounds: () => ({ x: 10, y: 20, width: 300, height: 200 }) };
  const normal = createHarness({
    mainWindow,
    windowState: { bounds: { x: 10, y: 20, width: 300, height: 200 }, isMaximized: false }
  });
  assert.deepEqual(normal.module.getSplashTargetBounds(), { x: 10, y: 20, width: 300, height: 200 });

  const maximized = createHarness({
    mainWindow,
    windowState: { bounds: { x: 10, y: 20, width: 300, height: 200 }, isMaximized: true },
    matchingWorkArea: { x: 0, y: 0, width: 1920, height: 1040 }
  });
  assert.deepEqual(maximized.module.getSplashTargetBounds(), { x: 0, y: 0, width: 1920, height: 1040 });
});

test('getSplashTargetBounds resolves restore bounds when no main window exists', () => {
  const { module } = createHarness({
    mainWindow: null,
    windowState: { bounds: {}, isMaximized: false },
    primaryWorkArea: { x: 0, y: 0, width: 1920, height: 1080 }
  });

  assert.deepEqual(module.getSplashTargetBounds(), {
    width: 1440,
    height: 900,
    x: 240,
    y: 90
  });
});

test('loadWindowState accepts current, normalBounds, and flat legacy shapes', () => {
  const current = createHarness();
  fs.writeFileSync(path.join(current.userDataPath, 'window-state.json'), JSON.stringify({
    bounds: { x: 1, y: 2, width: 1200, height: 800 },
    isMaximized: true,
    miniPlayer: {
      bounds: { x: 1500, y: 50, width: 200, height: 50 },
      alwaysOnTop: true
    }
  }));
  current.module.loadWindowState();
  assert.deepEqual(current.windowState, {
    bounds: { x: 1, y: 2, width: 1200, height: 800 },
    isMaximized: true,
    miniPlayer: {
      bounds: { x: 1500, y: 50, width: 320, height: 96 },
      alwaysOnTop: true
    }
  });

  const normalBounds = createHarness();
  fs.writeFileSync(path.join(normalBounds.userDataPath, 'window-state.json'), JSON.stringify({
    normalBounds: { x: 3, y: 4, width: 1300, height: 850 },
    isMaximized: 0
  }));
  normalBounds.module.loadWindowState();
  assert.deepEqual(normalBounds.windowState, {
    bounds: { x: 3, y: 4, width: 1300, height: 850 },
    isMaximized: false
  });

  const flat = createHarness();
  fs.writeFileSync(path.join(flat.userDataPath, 'window-state.json'), JSON.stringify({
    x: 5,
    y: 6,
    width: 1400,
    height: 900,
    isMaximized: 1
  }));
  flat.module.loadWindowState();
  assert.deepEqual(flat.windowState, {
    bounds: { x: 5, y: 6, width: 1400, height: 900 },
    isMaximized: true
  });
});

test('loadWindowState ignores missing, invalid, and incomplete state files', () => {
  const missing = createHarness();
  missing.module.loadWindowState();
  assert.deepEqual(missing.constantsCalls, []);

  const incomplete = createHarness();
  fs.writeFileSync(path.join(incomplete.userDataPath, 'window-state.json'), JSON.stringify({ width: 1000 }));
  incomplete.module.loadWindowState();
  assert.deepEqual(incomplete.constantsCalls, []);

  const invalid = createHarness();
  fs.writeFileSync(path.join(invalid.userDataPath, 'window-state.json'), '{bad json');
  withMutedConsole('error', () => invalid.module.loadWindowState());
  assert.deepEqual(invalid.constantsCalls, []);
});

test('saveWindowState is suppressed until restore is complete and a live window exists', () => {
  const beforeRestore = createHarness({
    mainWindow: { isDestroyed: () => false }
  });
  beforeRestore.module.saveWindowState();
  assert.equal(fs.existsSync(path.join(beforeRestore.userDataPath, 'window-state.json')), false);

  const noWindow = createHarness();
  noWindow.module.markRestoreComplete();
  noWindow.module.saveWindowState();
  assert.equal(fs.existsSync(path.join(noWindow.userDataPath, 'window-state.json')), false);

  const destroyed = createHarness({
    mainWindow: { isDestroyed: () => true }
  });
  destroyed.module.markRestoreComplete();
  destroyed.module.saveWindowState();
  assert.equal(fs.existsSync(path.join(destroyed.userDataPath, 'window-state.json')), false);
});

test('saveWindowState writes rounded bounds and current maximized state', () => {
  const harness = createHarness({
    mainWindow: {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => true,
      getNormalBounds: () => ({ x: 10.2, y: 20.7, width: 1111.2, height: 777.8 })
    }
  });

  harness.module.markRestoreComplete();
  harness.module.saveWindowState();

  assert.deepEqual(harness.windowState, {
    bounds: { x: 10, y: 21, width: 1111, height: 778 },
    isMaximized: true
  });
  assert.deepEqual(readSavedWindowState(harness.userDataPath), harness.windowState);
});

test('saveWindowState creates the user data directory before writing', () => {
  const userDataPath = path.join(createTempDir('effetune-window-state'), 'missing-user-data');
  const harness = createHarness({
    userDataPath,
    mainWindow: {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
      getNormalBounds: () => ({ x: 2, y: 3, width: 1300, height: 850 })
    }
  });

  harness.module.markRestoreComplete();
  harness.module.saveWindowState();

  assert.deepEqual(readSavedWindowState(userDataPath), {
    bounds: { x: 2, y: 3, width: 1300, height: 850 },
    isMaximized: false
  });
});

test('saveWindowState keeps prior maximized state while minimized and writes into existing directories', () => {
  const userDataPath = createTempDir('effetune-window-state');
  const harness = createHarness({
    userDataPath,
    windowState: { bounds: { width: 1440, height: 900 }, isMaximized: true },
    mainWindow: {
      isDestroyed: () => false,
      isMinimized: () => true,
      isMaximized: () => false,
      getNormalBounds: () => ({ x: 1, y: 2, width: 1200, height: 800 })
    }
  });

  harness.module.markRestoreComplete();
  harness.module.saveWindowState();

  assert.deepEqual(readSavedWindowState(userDataPath), {
    bounds: { x: 1, y: 2, width: 1200, height: 800 },
    isMaximized: true
  });
});

test('saveWindowState logs and recovers from filesystem failures', () => {
  const harness = createHarness({
    mainWindow: {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
      getNormalBounds: () => ({ x: 1, y: 2, width: 1200, height: 800 })
    }
  });

  harness.module.markRestoreComplete();
  withMutedConsole('error', () => {
    withPatchedProperty(fs, 'writeFileSync', () => {
      throw new Error('write failed');
    }, () => {
      assert.doesNotThrow(() => harness.module.saveWindowState());
    });
  });
});

test('mini mode saves mini bounds without changing normal window state', () => {
  let currentBounds = { x: 10, y: 20, width: 1400, height: 850 };
  const harness = createHarness({
    windowState: {
      bounds: { x: 10, y: 20, width: 1400, height: 850 },
      isMaximized: false
    },
    mainWindow: {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
      getNormalBounds: () => currentBounds,
      getBounds: () => currentBounds
    }
  });

  harness.module.markRestoreComplete();
  harness.module.enterMiniMode();
  currentBounds = { x: 1499.6, y: 49.5, width: 419.7, height: 120.4 };
  harness.module.saveWindowState();

  assert.deepEqual(harness.windowState, {
    bounds: { x: 10, y: 20, width: 1400, height: 850 },
    isMaximized: false,
    miniPlayer: {
      bounds: { x: 1500, y: 50, width: 420, height: 120 },
      alwaysOnTop: false
    }
  });
  assert.deepEqual(harness.module.getMiniPlayerState(), {
    bounds: { x: 1500, y: 50, width: 420, height: 120 },
    alwaysOnTop: false
  });
});

test('suspendSave suppresses transition event writes until resumed', () => {
  const harness = createHarness({
    mainWindow: {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
      getNormalBounds: () => ({ x: 1, y: 2, width: 1200, height: 800 })
    }
  });
  const statePath = path.join(harness.userDataPath, 'window-state.json');

  harness.module.markRestoreComplete();
  harness.module.suspendSave();
  harness.module.saveWindowState();
  assert.equal(fs.existsSync(statePath), false);

  harness.module.resumeSave();
  harness.module.saveWindowState();
  assert.equal(fs.existsSync(statePath), true);
});

test('resolveMiniPlayerBounds enforces mini minimum size and keeps bounds on screen', () => {
  const { module } = createHarness({
    matchingWorkArea: { x: 100, y: 50, width: 800, height: 600 }
  });

  assert.deepEqual(module.resolveMiniPlayerBounds({
    x: 850,
    y: 620,
    width: 200,
    height: 50
  }), {
    x: 580,
    y: 554,
    width: 320,
    height: 96
  });
});

test('setMiniPlayerAlwaysOnTop preserves bounds and persists the preference', () => {
  const harness = createHarness({
    windowState: {
      bounds: { x: 1, y: 2, width: 1200, height: 800 },
      isMaximized: false,
      miniPlayer: {
        bounds: { x: 700, y: 40, width: 420, height: 120 },
        alwaysOnTop: false
      }
    }
  });

  harness.module.setMiniPlayerAlwaysOnTop(true);

  assert.deepEqual(readSavedWindowState(harness.userDataPath).miniPlayer, {
    bounds: { x: 700, y: 40, width: 420, height: 120 },
    alwaysOnTop: true
  });
});

test('prepareForNewWindow clears in-memory mini mode and restore readiness', () => {
  let currentBounds = { x: 20, y: 30, width: 1300, height: 820 };
  const harness = createHarness({
    windowState: {
      bounds: { x: 20, y: 30, width: 1300, height: 820 },
      isMaximized: false
    },
    mainWindow: {
      isDestroyed: () => false,
      isMinimized: () => false,
      isMaximized: () => false,
      getNormalBounds: () => currentBounds,
      getBounds: () => currentBounds
    }
  });

  harness.module.markRestoreComplete();
  harness.module.enterMiniMode();
  currentBounds = { x: 800, y: 40, width: 420, height: 120 };
  harness.module.saveWindowState();
  assert.equal(harness.module.isMiniMode(), true);

  harness.module.suspendSave();
  harness.module.prepareForNewWindow();
  assert.equal(harness.module.isMiniMode(), false);

  currentBounds = { x: 100, y: 110, width: 1400, height: 880 };
  harness.module.saveWindowState();
  assert.deepEqual(harness.windowState.bounds, { x: 20, y: 30, width: 1300, height: 820 });

  harness.module.markRestoreComplete();
  harness.module.saveWindowState();
  assert.deepEqual(harness.windowState, {
    bounds: { x: 100, y: 110, width: 1400, height: 880 },
    isMaximized: false,
    miniPlayer: {
      bounds: { x: 800, y: 40, width: 420, height: 120 },
      alwaysOnTop: false
    }
  });
});
