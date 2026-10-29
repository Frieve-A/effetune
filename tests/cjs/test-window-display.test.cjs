const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');
const { selectTestDisplay, fitTestWindow, installTestWindowPolicy } = require('../helpers/electron-test-display.cjs');

const primary = { id: 7, scaleFactor: 1.5, workArea: { x: 0, y: 30, width: 1600, height: 870 } };
const secondary = { id: 2, scaleFactor: 2, workArea: { x: -1920, y: -1080, width: 1920, height: 1040 } };
const screen = {
  getPrimaryDisplay: () => primary,
  getAllDisplays: () => [secondary, primary]
};

test('test windows select a non-primary monitor by identity and retain logical coordinates', () => {
  assert.equal(selectTestDisplay(screen), secondary);
  assert.equal(selectTestDisplay({ ...screen, getAllDisplays: () => [primary] }), primary);
  assert.deepEqual(fitTestWindow({ x: 80, y: 80, width: 800, height: 600 }, secondary.workArea), {
    x: -800, y: -640, width: 800, height: 600
  });
  assert.deepEqual(fitTestWindow({ width: 3000, height: 2000 }, secondary.workArea), secondary.workArea);
});

function install(visible, focusable = visible) {
  const app = new EventEmitter();
  app.whenReady = () => Promise.resolve();
  withModuleLoadStub({ electron: { app, screen } }, () => installTestWindowPolicy({ visible, focusable }));
  return app;
}

function createWindow() {
  let bounds = { x: 80, y: 80, width: 800, height: 600 };
  const presentations = [];
  const window = {
    opacity: 1, focusable: true, skipTaskbar: false,
    isMaximized: () => false, isFullScreen: () => false,
    getBounds: () => ({ ...bounds }),
    setBounds: value => { bounds = { ...value }; },
    setOpacity: value => { window.opacity = value; },
    setFocusable: value => { window.focusable = value; },
    setSkipTaskbar: value => { window.skipTaskbar = value; },
    presentations
  };
  for (const method of ['show', 'showInactive', 'maximize', 'restore']) {
    window[method] = value => { presentations.push({ method, value, bounds: { ...bounds } }); return value; };
  }
  return window;
}

test('native presentation moves to the test display before each show, maximize and restore', () => {
  const app = install(true);
  const window = createWindow();
  app.emit('browser-window-created', {}, window);
  for (const method of ['show', 'showInactive', 'maximize', 'restore']) {
    // Production can restore saved primary-monitor bounds after construction.
    window.setBounds({ x: 80, y: 80, width: 800, height: 600 });
    assert.equal(withModuleLoadStub({ electron: { screen } }, () => window[method]('native-result')), 'native-result');
    assert.deepEqual(window.presentations.at(-1), {
      method, value: 'native-result', bounds: { x: -800, y: -640, width: 800, height: 600 }
    });
  }
  assert.equal(window.opacity, 1);
  assert.equal(window.focusable, true);
});

test('background native presentation cannot take focus on Windows and macOS', () => {
  for (const visible of [false, true]) {
    const app = install(visible, false);
    const window = createWindow();
    app.emit('browser-window-created', {}, window);
    withModuleLoadStub({ electron: { screen } }, () => window.show());
    assert.equal(window.presentations.length, 1);
    if (process.platform === 'win32' || process.platform === 'darwin') {
      assert.equal(window.opacity, visible ? 1 : 0);
      assert.equal(window.focusable, false);
      assert.equal(window.skipTaskbar, !visible);
    }
  }
});

test('allowed popups receive secondary-monitor bounds before native construction', () => {
  const app = install(true);
  let open;
  const contents = { setWindowOpenHandler: handler => { open = handler; } };
  app.emit('web-contents-created', {}, contents);
  const denied = { action: 'deny' };
  contents.setWindowOpenHandler(() => denied);
  assert.equal(open({}), denied);
  const preferences = { sandbox: true };
  contents.setWindowOpenHandler(() => ({ action: 'allow', overrideBrowserWindowOptions: {
    width: 700, height: 760, webPreferences: preferences
  } }));
  assert.deepEqual(open({}), { action: 'allow', overrideBrowserWindowOptions: {
    x: -1920, y: -1080, width: 700, height: 760, webPreferences: preferences
  } });
});
