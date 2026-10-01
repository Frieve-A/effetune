// electron/visualizer-feed.js
//
// Visualizer clean feed: a borderless window that fills a chosen display with the
// Visualizer. The renderer opens it with window.open() so it can draw into the
// same-origin child document directly; this module owns its placement and when it
// may be seen. The feed shows only while EffeTune is the active app (unless Show
// While Inactive is on), the main window does not overlap the feed display, and the
// renderer allows it (no Double Blind Test is running). Escape on the feed turns
// it off.
const { screen } = require('electron');
const constants = require('./constants');
const windowState = require('./window-state');

const FEED_FRAME_NAME = 'effetune-visualizer-feed';
const MAIN_WINDOW_EVENTS = [
  'focus', 'blur', 'show', 'hide', 'minimize', 'restore', 'move', 'resize',
  'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen'
];

let feedWindow = null;
let rendererAllowed = false;
let sentState = '';
let displayListenersInstalled = false;
let menuChanged = () => {};

function getMainWindow() {
  const mainWindow = constants.getMainWindow();
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function feedDisplay(displays = screen.getAllDisplays()) {
  if (displays.length < 2) return null;
  const { displayId } = windowState.getVisualizerFeedSettings();
  return displays.find(display => display.id === displayId) || null;
}

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
}

function sameBounds(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function getState() {
  const mainWindow = getMainWindow();
  const display = mainWindow ? feedDisplay() : null;
  // Clicking the feed focuses it, which must not count as leaving the app.
  const active = windowState.getVisualizerFeedSettings().showWhileInactive ||
    mainWindow?.isFocused() || feedWindow?.isFocused();
  // Content bounds exclude the invisible resize borders of a native frame.
  const visible = Boolean(display && rendererAllowed && active &&
    mainWindow.isVisible() && !mainWindow.isMinimized() &&
    !intersects(mainWindow.getContentBounds(), display.bounds));
  return { open: Boolean(display), visible, display };
}

function closeFeedWindow() {
  const window = feedWindow;
  feedWindow = null;
  if (window && !window.isDestroyed()) window.destroy();
}

function update() {
  const { open, visible, display } = getState();
  if (!open) closeFeedWindow();
  if (feedWindow) {
    // A window moved onto a display with a different scale factor can be
    // resized on arrival; the second pass pins the final bounds.
    for (let pass = 0; pass < 2 && !sameBounds(feedWindow.getBounds(), display.bounds); pass++) {
      feedWindow.setBounds(display.bounds);
    }
    if (visible && !feedWindow.isVisible()) feedWindow.showInactive();
    if (!visible && feedWindow.isVisible()) feedWindow.hide();
  }
  const mainWindow = getMainWindow();
  const state = JSON.stringify({ open, visible });
  if (!mainWindow || state === sentState) return;
  sentState = state;
  mainWindow.webContents.send('visualizer-feed-state', { open, visible });
}

function handleWindowOpen({ url, frameName }) {
  if (frameName !== FEED_FRAME_NAME || url !== 'about:blank' || feedWindow || !getState().open) {
    return { action: 'deny' };
  }
  return {
    action: 'allow',
    overrideBrowserWindowOptions: {
      show: false,
      frame: false,
      thickFrame: false,
      hasShadow: false,
      roundedCorners: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      enableLargerThanScreen: true,
      backgroundColor: '#000000' // theme-allow: Letterbox black of a video feed.
    }
  };
}

function adoptWindow(window, { frameName }) {
  if (frameName !== FEED_FRAME_NAME) return;
  feedWindow = window;
  // Stay above the taskbar and menu bar of the feed display.
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Key-down of Escape does not always reach a window that was shown inactive.
  window.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyUp' && input.key === 'Escape') {
      selectDisplay(null);
      menuChanged();
    }
  });
  window.on('focus', update);
  window.on('blur', update);
  window.on('closed', () => {
    if (feedWindow !== window) return;
    feedWindow = null;
    selectDisplay(null);
    menuChanged();
  });
  update();
}

// A new page load replaces the renderer that drew the feed; it reopens the
// window after it reports its state again.
function resetRenderer() {
  rendererAllowed = false;
  sentState = '';
  closeFeedWindow();
}

function setRendererAllowed(allowed) {
  rendererAllowed = allowed === true;
  update();
  const { open, visible } = getState();
  return { open, visible };
}

function changeSettings(changes) {
  windowState.setVisualizerFeedSettings(changes);
  update();
}

function selectDisplay(displayId) {
  changeSettings({ displayId });
}

function attachMainWindow(mainWindow, { onMenuChanged }) {
  menuChanged = onMenuChanged;
  resetRenderer();
  for (const event of MAIN_WINDOW_EVENTS) mainWindow.on(event, update);
  mainWindow.on('closed', closeFeedWindow);
  mainWindow.webContents.setWindowOpenHandler(handleWindowOpen);
  mainWindow.webContents.on('did-create-window', adoptWindow);
  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) resetRenderer();
  });
  if (displayListenersInstalled) return;
  displayListenersInstalled = true;
  const displaysChanged = () => {
    menuChanged();
    update();
  };
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, displaysChanged);
  }
}

// View menu entry. `item` applies the renderer's localized labels by ID.
function createMenuItem(item) {
  const displays = screen.getAllDisplays();
  const selectedId = feedDisplay(displays)?.id ?? null;
  return item('view.visualizerFeed', {
    label: 'Visualizer Clean Feed',
    enabled: displays.length > 1,
    submenu: [
      item('view.visualizerFeedOff', {
        label: 'Off',
        type: 'radio',
        checked: selectedId === null,
        click: () => selectDisplay(null)
      }),
      ...displays.map((display, index) => {
        const width = Math.round(display.bounds.width * display.scaleFactor);
        const height = Math.round(display.bounds.height * display.scaleFactor);
        const name = display.label ? `${index + 1}: ${display.label}` : String(index + 1);
        return {
          label: `${name} (${width}×${height})`,
          type: 'radio',
          checked: display.id === selectedId,
          click: () => selectDisplay(display.id)
        };
      }),
      { type: 'separator' },
      item('view.visualizerFeedShowWhileInactive', {
        label: 'Show While Inactive',
        type: 'checkbox',
        checked: windowState.getVisualizerFeedSettings().showWhileInactive,
        click: menuItem => changeSettings({ showWhileInactive: menuItem.checked })
      })
    ]
  });
}

module.exports = {
  attachMainWindow,
  createMenuItem,
  setRendererAllowed
};
