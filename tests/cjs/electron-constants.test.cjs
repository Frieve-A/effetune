const assert = require('node:assert/strict');
const test = require('node:test');

const { loadFreshModule } = require('../helpers/cjs-module-utils.cjs');

test('constants exposes the auto-restart flag', () => {
  const constants = loadFreshModule('../../electron/constants.js');
  assert.equal(constants.AUTO_RESTART_FLAG, '--from-auto-restart');
});

test('constants stores independent window and launch state', () => {
  const constants = loadFreshModule('../../electron/constants.js');
  const mainWindow = { id: 'main' };
  const windowState = { bounds: { width: 800, height: 600 }, isMaximized: true };

  constants.setMainWindow(mainWindow);
  constants.setWindowState(windowState);
  constants.setIsFirstLaunch(false);
  constants.setIsSplashReload(true);
  constants.setShouldLoadPipelineState(false);

  assert.equal(constants.getMainWindow(), mainWindow);
  assert.equal(constants.getWindowState(), windowState);
  assert.equal(constants.getIsFirstLaunch(), false);
  assert.equal(constants.getIsSplashReload(), true);
  assert.equal(constants.getShouldLoadPipelineState(), false);
});

test('constants stores command line preset paths', () => {
  const constants = loadFreshModule('../../electron/constants.js');

  constants.setCommandLinePresetFile('current.effetune_preset');
  constants.setSavedCommandLinePresetFile('saved.effetune_preset');

  assert.equal(constants.getCommandLinePresetFile(), 'current.effetune_preset');
  assert.equal(constants.getSavedCommandLinePresetFile(), 'saved.effetune_preset');
});

test('constants manages command line music queues', () => {
  const constants = loadFreshModule('../../electron/constants.js');

  constants.setCommandLineMusicFiles(['a.wav']);
  constants.addCommandLineMusicFile('b.flac');
  assert.deepEqual(constants.getCommandLineMusicFiles(), ['a.wav', 'b.flac']);
  constants.clearCommandLineMusicFiles();
  assert.deepEqual(constants.getCommandLineMusicFiles(), []);

  constants.setSavedCommandLineMusicFiles(['saved.wav']);
  constants.addSavedCommandLineMusicFile('saved.wav');
  constants.addSavedCommandLineMusicFile('saved.flac');
  assert.deepEqual(constants.getSavedCommandLineMusicFiles(), ['saved.wav', 'saved.flac']);
  constants.clearSavedCommandLineMusicFiles();
  assert.deepEqual(constants.getSavedCommandLineMusicFiles(), []);

  constants.setPendingCommandLineMusicFiles(['pending.ogg']);
  assert.deepEqual(constants.getPendingCommandLineMusicFiles(), ['pending.ogg']);
  constants.clearPendingCommandLineMusicFiles();
  assert.deepEqual(constants.getPendingCommandLineMusicFiles(), []);
});

test('constants stores app metadata and callbacks', () => {
  const constants = loadFreshModule('../../electron/constants.js');
  const config = { autoLaunch: true };
  const startupPreset = { name: 'Startup' };
  const updateTrayMenuTemplate = () => {};
  const triggerClose = () => {};

  constants.setAppVersion('1.2.3');
  constants.setAppConfig(config);
  constants.setStartupPreset(startupPreset);
  constants.setUpdateTrayMenuTemplate(updateTrayMenuTemplate);
  constants.setTriggerClose(triggerClose);

  assert.equal(constants.getAppVersion(), '1.2.3');
  assert.equal(constants.getAppConfig(), config);
  assert.equal(constants.getStartupPreset(), startupPreset);
  assert.equal(constants.getUpdateTrayMenuTemplate(), updateTrayMenuTemplate);
  assert.equal(constants.getTriggerClose(), triggerClose);
});

test('constants clears close timeout only when present', () => {
  const constants = loadFreshModule('../../electron/constants.js');
  const timeout = setTimeout(() => {}, 60_000);

  constants.clearCloseTimeout();
  assert.equal(constants.getCloseTimeout(), null);

  constants.setCloseTimeout(timeout);
  assert.equal(constants.getCloseTimeout(), timeout);
  constants.clearCloseTimeout();
  assert.equal(constants.getCloseTimeout(), null);
});
