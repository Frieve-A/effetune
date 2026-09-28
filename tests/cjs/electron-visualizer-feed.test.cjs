const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { loadFreshModule, withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');

const PRIMARY = { id: 1, label: 'Built-in', scaleFactor: 1.5, bounds: { x: 0, y: 0, width: 1280, height: 800 } };
const SECONDARY = { id: 2, label: '', scaleFactor: 1, bounds: { x: 1280, y: 0, width: 1920, height: 1080 } };

function createFakeWindow(bounds) {
  const window = new EventEmitter();
  Object.assign(window, {
    bounds: { ...bounds },
    visible: false,
    focused: true,
    minimized: false,
    destroyed: false,
    sent: [],
    isDestroyed: () => window.destroyed,
    isVisible: () => window.visible,
    isFocused: () => window.focused,
    isMinimized: () => window.minimized,
    getBounds: () => window.bounds,
    getContentBounds: () => window.bounds,
    setBounds: value => { window.bounds = { ...value }; },
    showInactive: () => { window.visible = true; },
    hide: () => { window.visible = false; },
    destroy: () => { window.destroyed = true; window.emit('closed'); },
    setAlwaysOnTop: (...args) => { window.alwaysOnTop = args; }
  });
  window.webContents = new EventEmitter();
  window.webContents.send = (channel, state) => window.sent.push([channel, state]);
  window.webContents.setWindowOpenHandler = handler => { window.webContents.openHandler = handler; };
  return window;
}

function createHarness() {
  let displays = [PRIMARY, SECONDARY];
  let settings = { displayId: null, showWhileInactive: false };
  const screen = new EventEmitter();
  screen.getAllDisplays = () => displays;
  const mainWindow = createFakeWindow(PRIMARY.bounds);
  mainWindow.visible = true;
  const feed = withModuleLoadStub({
    electron: { screen },
    './constants': { getMainWindow: () => mainWindow },
    './window-state': {
      getVisualizerFeedSettings: () => settings,
      setVisualizerFeedSettings: changes => { settings = { ...settings, ...changes }; }
    }
  }, () => loadFreshModule('../../electron/visualizer-feed.js'));
  let menuRefreshes = 0;
  feed.attachMainWindow(mainWindow, { onMenuChanged: () => { menuRefreshes++; } });
  const menu = () => feed.createMenuItem((id, template) => ({ id, ...template }));
  return {
    feed,
    mainWindow,
    menu,
    screen,
    get menuRefreshes() { return menuRefreshes; },
    get settings() { return settings; },
    setDisplays: value => { displays = value; },
    lastState: () => mainWindow.sent.at(-1)?.[1]
  };
}

function openFeedWindow(harness) {
  const open = harness.mainWindow.webContents.openHandler;
  const result = open({ url: 'about:blank', frameName: 'effetune-visualizer-feed' });
  assert.equal(result.action, 'allow');
  const feedWindow = createFakeWindow(PRIMARY.bounds);
  feedWindow.focused = false;
  harness.mainWindow.webContents.emit('did-create-window', feedWindow, { frameName: 'effetune-visualizer-feed' });
  return feedWindow;
}

test('menu lists displays and is disabled with a single display', () => {
  const harness = createHarness();
  const item = harness.menu();
  assert.equal(item.id, 'view.visualizerFeed');
  assert.equal(item.enabled, true);
  assert.deepEqual(item.submenu.map(entry => [entry.label, entry.checked]), [
    ['Off', true],
    ['1: Built-in (1920×1200)', false],
    ['2 (1920×1080)', false],
    [undefined, undefined],
    ['Show While Inactive', false]
  ]);
  item.submenu[2].click();
  assert.equal(harness.settings.displayId, 2);
  assert.equal(harness.menu().submenu[2].checked, true);

  harness.setDisplays([PRIMARY]);
  harness.screen.emit('display-removed');
  assert.equal(harness.menuRefreshes, 1);
  assert.equal(harness.menu().enabled, false);
  assert.equal(harness.menu().submenu[0].checked, true);
});

test('feed window opens only when a display is selected and follows the visibility rules', () => {
  const harness = createHarness();
  const open = harness.mainWindow.webContents.openHandler;
  assert.equal(open({ url: 'about:blank', frameName: 'effetune-visualizer-feed' }).action, 'deny');
  assert.deepEqual(harness.feed.setRendererAllowed(true), { open: false, visible: false });

  harness.menu().submenu[2].click();
  assert.deepEqual(harness.lastState(), { open: true, visible: true });
  assert.equal(open({ url: 'https://example.com/', frameName: 'effetune-visualizer-feed' }).action, 'deny');
  assert.equal(open({ url: 'about:blank', frameName: 'other' }).action, 'deny');

  const feedWindow = openFeedWindow(harness);
  assert.deepEqual(feedWindow.bounds, SECONDARY.bounds);
  assert.equal(feedWindow.visible, true);
  assert.deepEqual(feedWindow.alwaysOnTop, [true, 'screen-saver']);
  assert.equal(open({ url: 'about:blank', frameName: 'effetune-visualizer-feed' }).action, 'deny');

  const sentBefore = harness.mainWindow.sent.length;
  harness.mainWindow.emit('resize');
  assert.equal(harness.mainWindow.sent.length, sentBefore, 'unchanged state is not resent');

  harness.mainWindow.focused = false;
  harness.mainWindow.emit('blur');
  assert.equal(feedWindow.visible, false);
  harness.mainWindow.focused = true;
  harness.mainWindow.emit('focus');
  assert.equal(feedWindow.visible, true);

  // Clicking the feed moves the focus into it without leaving the app.
  harness.mainWindow.focused = false;
  feedWindow.focused = true;
  harness.mainWindow.emit('blur');
  assert.equal(feedWindow.visible, true);
  feedWindow.focused = false;
  feedWindow.emit('blur');
  assert.equal(feedWindow.visible, false);

  harness.menu().submenu[4].click({ checked: true });
  assert.equal(harness.settings.showWhileInactive, true);
  assert.equal(feedWindow.visible, true);
  harness.menu().submenu[4].click({ checked: false });
  assert.equal(feedWindow.visible, false);
  harness.mainWindow.focused = true;
  harness.mainWindow.emit('focus');

  harness.mainWindow.bounds = { x: 1200, y: 0, width: 400, height: 300 };
  harness.mainWindow.emit('move');
  assert.equal(feedWindow.visible, false);
  harness.mainWindow.bounds = { ...PRIMARY.bounds };
  harness.mainWindow.emit('move');

  assert.deepEqual(harness.feed.setRendererAllowed(false), { open: true, visible: false });
  assert.equal(feedWindow.visible, false);
  harness.feed.setRendererAllowed(true);

  harness.menu().submenu[0].click();
  assert.equal(feedWindow.destroyed, true);
  assert.deepEqual(harness.lastState(), { open: false, visible: false });
});

test('a main-frame navigation closes the feed until the new page allows it', () => {
  const harness = createHarness();
  harness.menu().submenu[2].click();
  harness.feed.setRendererAllowed(true);
  const feedWindow = openFeedWindow(harness);
  harness.mainWindow.webContents.emit('did-start-navigation', {}, 'file:///app', true, true);
  assert.equal(feedWindow.destroyed, false, 'in-place navigation keeps the feed');
  harness.mainWindow.webContents.emit('did-start-navigation', {}, 'file:///app', false, true);
  assert.equal(feedWindow.destroyed, true);
  assert.equal(harness.settings.displayId, SECONDARY.id, 'renderer replacement preserves the selected display');
  assert.deepEqual(harness.feed.setRendererAllowed(false), { open: true, visible: false });
  assert.deepEqual(harness.lastState(), { open: true, visible: false });
});

test('closing the feed outside the app turns it off and permits reopening on the same display', () => {
  const harness = createHarness();
  harness.menu().submenu[2].click();
  harness.feed.setRendererAllowed(true);
  const feedWindow = openFeedWindow(harness);
  const refreshesBefore = harness.menuRefreshes;
  feedWindow.destroy();
  assert.equal(harness.settings.displayId, null);
  assert.equal(harness.menu().submenu[0].checked, true);
  assert.equal(harness.menuRefreshes, refreshesBefore + 1);
  assert.deepEqual(harness.lastState(), { open: false, visible: false });
  harness.menu().submenu[2].click();
  assert.deepEqual(harness.lastState(), { open: true, visible: true });
  assert.equal(openFeedWindow(harness).visible, true);
});

test('display removal closes the feed but preserves the selected display for reconnection', () => {
  const harness = createHarness();
  harness.menu().submenu[2].click();
  harness.feed.setRendererAllowed(true);
  const feedWindow = openFeedWindow(harness);
  harness.setDisplays([PRIMARY]);
  harness.screen.emit('display-removed');
  assert.equal(feedWindow.destroyed, true);
  assert.equal(harness.settings.displayId, SECONDARY.id);
  assert.deepEqual(harness.lastState(), { open: false, visible: false });
  harness.setDisplays([PRIMARY, SECONDARY]);
  harness.screen.emit('display-added');
  assert.deepEqual(harness.lastState(), { open: true, visible: true });
  assert.equal(openFeedWindow(harness).visible, true);
});

test('Escape released on the feed turns it off', () => {
  const harness = createHarness();
  harness.menu().submenu[2].click();
  harness.feed.setRendererAllowed(true);
  const feedWindow = openFeedWindow(harness);
  const refreshesBefore = harness.menuRefreshes;
  feedWindow.webContents.emit('before-input-event', {}, { type: 'keyDown', key: 'Escape' });
  feedWindow.webContents.emit('before-input-event', {}, { type: 'keyUp', key: 'a' });
  assert.equal(feedWindow.destroyed, false);
  feedWindow.webContents.emit('before-input-event', {}, { type: 'keyUp', key: 'Escape' });
  assert.equal(feedWindow.destroyed, true);
  assert.equal(harness.settings.displayId, null);
  assert.equal(harness.menuRefreshes, refreshesBefore + 1);
  assert.deepEqual(harness.lastState(), { open: false, visible: false });
});
