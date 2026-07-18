// electron/window-state.js
//
// Persists the main window's position / size / maximized state and restores it
// on the next launch.  All BrowserWindow and screen coordinates here are in
// Electron's logical (DIP) space, which is consistent across monitors, so no
// scale-factor conversion is ever needed.
const fs = require('fs');
const path = require('path');
const { screen } = require('electron');
const constants = require('./constants');
const fileHandlers = require('./file-handlers');

const DEFAULT_SIZE = Object.freeze({ width: 1440, height: 900 });
const MIN_SIZE = Object.freeze({ width: 1024, height: 768 });
const MINI_DEFAULT_SIZE = Object.freeze({ width: 420, height: 120 });
const MINI_MIN_SIZE = Object.freeze({ width: 320, height: 96 });

// Saving is suppressed until the window has reached its final restored state.
// Otherwise the move/resize events fired while the (still un-maximized) window
// is being positioned behind the splash would overwrite isMaximized with false.
let restoreComplete = false;
let windowMode = 'normal';
let saveSuspended = false;

function finite(value) {
  return Number.isFinite(value);
}

function stateFilePath() {
  return path.join(fileHandlers.getUserDataPath(), 'window-state.json');
}

// Area (DIP²) where two rectangles overlap; 0 when they do not intersect.
function overlapArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, width) * Math.max(0, height);
}

function clampSize(size, defaultSize = DEFAULT_SIZE, minSize = MIN_SIZE) {
  return {
    width: Math.max(Math.round(size.width) || defaultSize.width, minSize.width),
    height: Math.max(Math.round(size.height) || defaultSize.height, minSize.height)
  };
}

function centerIn(size, workArea) {
  return {
    ...size,
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + (workArea.height - size.height) / 2)
  };
}

// Slide bounds so they sit fully inside workArea (without resizing them).
function clampInto(bounds, workArea) {
  const maxX = workArea.x + Math.max(0, workArea.width - bounds.width);
  const maxY = workArea.y + Math.max(0, workArea.height - bounds.height);
  return {
    ...bounds,
    x: Math.min(Math.max(bounds.x, workArea.x), maxX),
    y: Math.min(Math.max(bounds.y, workArea.y), maxY)
  };
}

// The normal (un-maximized) bounds the main window should be created with.
// Always returns an on-screen rectangle, falling back to a centered default
// when no usable position was saved or the saved monitor is gone.
function resolveBounds(saved, defaultSize, minSize) {
  const size = clampSize(saved, defaultSize, minSize);

  // No saved position → center on the primary display.
  if (!finite(saved.x) || !finite(saved.y)) {
    return centerIn(size, screen.getPrimaryDisplay().workArea);
  }

  const bounds = { ...size, x: Math.round(saved.x), y: Math.round(saved.y) };
  const display = screen.getDisplayMatching(bounds);

  // Saved window no longer overlaps any monitor's work area (display removed or
  // rearranged) → recenter on the nearest current display.
  if (overlapArea(bounds, display.workArea) <= 0) {
    return centerIn(size, display.workArea);
  }
  // Otherwise keep the saved spot, nudged fully on-screen.
  return clampInto(bounds, display.workArea);
}

function resolveWindowBoundsForRestore() {
  return resolveBounds(constants.getWindowState().bounds || {}, DEFAULT_SIZE, MIN_SIZE);
}

function resolveMiniPlayerBounds(bounds) {
  return resolveBounds(bounds || {}, MINI_DEFAULT_SIZE, MINI_MIN_SIZE);
}

// The rectangle the main window will finally occupy, used to center the splash.
// When restoring maximized, the window is still un-maximized behind the splash,
// so derive the maximize target (its display's work area) explicitly.
function getSplashTargetBounds() {
  const mainWindow = constants.getMainWindow();
  const normalBounds = mainWindow ? mainWindow.getBounds() : resolveWindowBoundsForRestore();
  if (constants.getWindowState().isMaximized) {
    return screen.getDisplayMatching(normalBounds).workArea;
  }
  return normalBounds;
}

// Load saved window state from disk into the in-memory store.
function loadWindowState() {
  try {
    const file = stateFilePath();
    if (!fs.existsSync(file)) return;

    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Accept the current shape ({ bounds }) and legacy shapes
    // ({ normalBounds } or flat { x, y, width, height }).
    const bounds = saved.bounds || saved.normalBounds ||
      (saved.width && saved.height
        ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
        : null);

    if (bounds && bounds.width && bounds.height) {
      const state = { bounds, isMaximized: !!saved.isMaximized };
      const savedMiniPlayer = saved.miniPlayer;
      if (savedMiniPlayer && typeof savedMiniPlayer === 'object') {
        const miniBounds = savedMiniPlayer.bounds;
        state.miniPlayer = {
          bounds: miniBounds?.width && miniBounds?.height
            ? resolveMiniPlayerBounds(miniBounds)
            : null,
          alwaysOnTop: savedMiniPlayer.alwaysOnTop === true
        };
      }
      constants.setWindowState(state);
    }
  } catch (error) {
    console.error('Failed to load window state:', error);
  }
}

// Persist the current window state.  No-op until the restore sequence finished
// (see restoreComplete) so the startup positioning cannot clobber the state.
function writeWindowState(state) {
  constants.setWindowState(state);
  const userDataPath = fileHandlers.getUserDataPath();
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(stateFilePath(), JSON.stringify(state, null, 2));
}

function roundedBounds(raw) {
  return {
    x: Math.round(raw.x),
    y: Math.round(raw.y),
    width: Math.round(raw.width),
    height: Math.round(raw.height)
  };
}

function saveWindowState() {
  const mainWindow = constants.getMainWindow();
  if (saveSuspended || !restoreComplete || !mainWindow || mainWindow.isDestroyed()) return;

  try {
    const previous = constants.getWindowState();
    if (windowMode === 'mini') {
      if (mainWindow.isMaximized()) return;
      const raw = mainWindow.isMinimized()
        ? previous.miniPlayer?.bounds
        : mainWindow.getBounds();
      if (!raw) return;
      writeWindowState({
        ...previous,
        miniPlayer: {
          ...previous.miniPlayer,
          bounds: roundedBounds(raw),
          alwaysOnTop: previous.miniPlayer?.alwaysOnTop === true
        }
      });
      return;
    }

    // While minimized the maximized flag isn't observable, so keep the
    // previously persisted one. getNormalBounds() is the un-maximized restore
    // rectangle in every state, so the saved position is always the one the
    // window returns to.
    const maximized = mainWindow.isMinimized() ? !!previous.isMaximized : mainWindow.isMaximized();
    const raw = mainWindow.getNormalBounds();
    const state = {
      ...previous,
      bounds: roundedBounds(raw),
      isMaximized: maximized
    };
    writeWindowState(state);
  } catch (error) {
    console.error('Failed to save window state:', error);
  }
}

// Enable saving once the window has been shown in its final restored state.
function markRestoreComplete() {
  restoreComplete = true;
}

// A BrowserWindow can be recreated in the same process on macOS. Keep the
// persisted bounds, but restart its in-memory lifetime in normal mode so a
// window that was closed while mini does not inherit stale transition state.
function prepareForNewWindow() {
  restoreComplete = false;
  windowMode = 'normal';
  saveSuspended = false;
}

function enterMiniMode() {
  if (windowMode === 'mini') return;
  saveWindowState();
  windowMode = 'mini';
}

function exitMiniMode() {
  if (windowMode === 'normal') return;
  saveWindowState();
  windowMode = 'normal';
}

function suspendSave() {
  saveSuspended = true;
}

function resumeSave() {
  saveSuspended = false;
}

function getMiniPlayerState() {
  const miniPlayer = constants.getWindowState().miniPlayer;
  if (!miniPlayer?.bounds) return null;
  return {
    bounds: { ...miniPlayer.bounds },
    alwaysOnTop: miniPlayer.alwaysOnTop === true
  };
}

function setMiniPlayerAlwaysOnTop(alwaysOnTop) {
  const previous = constants.getWindowState();
  const state = {
    ...previous,
    miniPlayer: {
      ...previous.miniPlayer,
      bounds: previous.miniPlayer?.bounds || null,
      alwaysOnTop: alwaysOnTop === true
    }
  };
  try {
    writeWindowState(state);
  } catch (error) {
    console.error('Failed to save mini player state:', error);
  }
}

function isMiniMode() {
  return windowMode === 'mini';
}

module.exports = {
  DEFAULT_SIZE,
  MIN_SIZE,
  MINI_DEFAULT_SIZE,
  MINI_MIN_SIZE,
  loadWindowState,
  saveWindowState,
  resolveWindowBoundsForRestore,
  resolveMiniPlayerBounds,
  getSplashTargetBounds,
  markRestoreComplete,
  prepareForNewWindow,
  enterMiniMode,
  exitMiniMode,
  suspendSave,
  resumeSave,
  getMiniPlayerState,
  setMiniPlayerAlwaysOnTop,
  isMiniMode
};
