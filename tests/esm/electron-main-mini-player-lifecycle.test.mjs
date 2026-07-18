import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../../electron/main.js', import.meta.url), 'utf8');

test('each recreated main window starts with fresh normal-mode state', () => {
  const createStart = mainSource.indexOf('function createWindow()');
  const prepare = mainSource.indexOf('windowState.prepareForNewWindow();', createStart);
  const load = mainSource.indexOf('windowState.loadWindowState();', createStart);
  const construct = mainSource.indexOf('new BrowserWindow({', createStart);

  assert.ok(createStart >= 0);
  assert.ok(prepare > createStart);
  assert.ok(load > prepare);
  assert.ok(construct > load);
});

test('full-page navigation restores normal window shape before replacing the renderer', () => {
  const navigationStart = mainSource.indexOf("mainWindow.webContents.on('did-start-navigation'");
  const navigationEnd = mainSource.indexOf("mainWindow.webContents.session.on('will-download'", navigationStart);
  const navigationSource = mainSource.slice(navigationStart, navigationEnd);

  assert.ok(navigationStart >= 0);
  assert.match(navigationSource, /if \(isMainFrame && !isInPlace\)/);
  assert.ok(
    navigationSource.indexOf('ipcHandlers.restoreNormalWindowShape?.();') <
      navigationSource.indexOf('disarmRendererWatchdog(')
  );
});

test('maximizing the mini player waits for restored bounds before maximizing the normal layout', () => {
  const maximizeStart = mainSource.indexOf("mainWindow.on('maximize'");
  const maximizeEnd = mainSource.indexOf("mainWindow.on('unmaximize'", maximizeStart);
  const maximizeSource = mainSource.slice(maximizeStart, maximizeEnd);

  assert.ok(maximizeStart >= 0);
  assert.match(maximizeSource, /if \(!windowState\.isMiniMode\(\)\)/);
  assert.match(maximizeSource, /mainWindow\.once\('unmaximize'/);
  assert.match(maximizeSource, /mainWindow\.unmaximize\(\)/);
  assert.match(maximizeSource, /ipcHandlers\.restoreNormalWindowShape\(\)/);
  assert.match(maximizeSource, /mainWindow\.webContents\.send\('exit-mini-player'\)/);
  assert.match(maximizeSource, /mainWindow\.maximize\(\)/);
  assert.match(
    maximizeSource,
    /mainWindow\.once\('unmaximize',[\s\S]*ipcHandlers\.restoreNormalWindowShape\(\)[\s\S]*exit-mini-player[\s\S]*mainWindow\.maximize\(\)[\s\S]*\}\);\s*mainWindow\.unmaximize\(\);/
  );
});

test('mini-player resize events cannot overwrite the persisted fixed size', () => {
  const resizeStart = mainSource.indexOf("mainWindow.on('resize'");
  const resizeEnd = mainSource.indexOf("mainWindow.on('move'", resizeStart);
  const resizeSource = mainSource.slice(resizeStart, resizeEnd);

  assert.ok(resizeStart >= 0);
  assert.match(resizeSource, /if \(!windowState\.isMiniMode\(\)\) windowState\.saveWindowState\(\)/);
});
