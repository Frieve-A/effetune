import assert from 'node:assert/strict';
import test from 'node:test';

import { updateApplicationMenu, updateTrayMenu } from '../../js/electron/menuIntegration.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

async function withMutedConsole(method, callback) {
  const original = console[method];
  console[method] = () => {};
  try {
    return await callback();
  } finally {
    console[method] = original;
  }
}

function createWindowHarness(options = {}) {
  const calls = [];
  const uiManager = options.uiManager === null ? null : {
    t: key => `label:${key}`,
    ...options.uiManager
  };
  const electronAPI = {
    async getUserPresetsForTray() {
      calls.push(['getUserPresetsForTray']);
      if (options.getUserPresetsForTrayError) {
        throw options.getUserPresetsForTrayError;
      }
      return options.presetsResult ?? { success: true, presets: ['Preset A', 'Preset B'] };
    },
    updateTrayMenu(template) {
      calls.push(['updateTrayMenu', template]);
      if (options.updateTrayMenuThrows) {
        throw options.updateTrayMenuThrows;
      }
      if (options.updateTrayMenuRejects) {
        return Promise.reject(options.updateTrayMenuRejects);
      }
      return Promise.resolve(options.updateTrayMenuResult ?? { success: true });
    },
    updateApplicationMenu(template) {
      calls.push(['updateApplicationMenu', template]);
      if (options.updateApplicationMenuThrows) {
        throw options.updateApplicationMenuThrows;
      }
      if (options.updateApplicationMenuRejects) {
        return Promise.reject(options.updateApplicationMenuRejects);
      }
      return Promise.resolve(options.updateApplicationMenuResult ?? { success: true });
    }
  };

  return {
    calls,
    window: { uiManager, electronAPI }
  };
}

test('menu integration exits early outside Electron or without a UI manager', async () => {
  const harness = createWindowHarness({ uiManager: null });
  await withGlobals({ window: harness.window }, async () => {
    await updateTrayMenu(false);
    await updateApplicationMenu(false);
    await updateTrayMenu(true);
    await updateApplicationMenu(true);
  });

  assert.deepEqual(harness.calls, []);
});

test('updateTrayMenu sends translated tray labels and user presets', async () => {
  const harness = createWindowHarness();

  await withGlobals({ window: harness.window }, async () => {
    await updateTrayMenu(true);
    await flushMicrotasks();
  });

  assert.deepEqual(harness.calls[0], ['getUserPresetsForTray']);
  assert.deepEqual(harness.calls[1], ['updateTrayMenu', {
    presets: { label: 'label:trayMenuPresets', items: ['Preset A', 'Preset B'] },
    open: { label: 'label:trayMenuOpen' },
    quit: { label: 'label:trayMenuQuit' }
  }]);
});

test('updateTrayMenu handles preset query and update failures', async () => {
  const noPresets = createWindowHarness({
    presetsResult: { success: false, presets: ['Ignored'] },
    updateTrayMenuResult: { success: false, error: 'update failed' }
  });
  await withGlobals({ window: noPresets.window }, async () => {
    await withMutedConsole('error', async () => {
      await updateTrayMenu(true);
      await flushMicrotasks();
    });
  });
  assert.deepEqual(noPresets.calls[1][1].presets.items, []);

  const presetError = createWindowHarness({
    getUserPresetsForTrayError: new Error('preset read failed')
  });
  await withGlobals({ window: presetError.window }, async () => {
    await withMutedConsole('error', async () => {
      await updateTrayMenu(true);
      await flushMicrotasks();
    });
  });
  assert.deepEqual(presetError.calls[1][1].presets.items, []);

  const updateError = createWindowHarness({
    updateTrayMenuRejects: new Error('tray update failed')
  });
  await withGlobals({ window: updateError.window }, async () => {
    await withMutedConsole('error', async () => {
      await updateTrayMenu(true);
      await flushMicrotasks();
    });
  });
  assert.equal(updateError.calls[1][0], 'updateTrayMenu');
});

test('updateTrayMenu catches template creation failures', async () => {
  const harness = createWindowHarness({
    uiManager: {
      t() {
        throw new Error('translation failed');
      }
    }
  });

  await withGlobals({ window: harness.window }, async () => {
    await withMutedConsole('error', async () => {
      await updateTrayMenu(true);
    });
  });

  assert.deepEqual(harness.calls, [['getUserPresetsForTray']]);
});

test('updateApplicationMenu sends enabled menu labels and updates the tray', async () => {
  const harness = createWindowHarness({
    uiManager: {
      isDoubleBlindActive: () => false
    }
  });

  await withGlobals({ window: harness.window }, async () => {
    await updateApplicationMenu(true);
    await flushMicrotasks();
  });

  const appMenu = harness.calls[0][1];
  assert.equal(harness.calls[0][0], 'updateApplicationMenu');
  assert.equal(appMenu.file.label, 'label:menu.file');
  assert.equal(appMenu.file.submenu[0].enabled, true);
  assert.equal(appMenu.file.submenu[3].enabled, true);
  assert.equal(appMenu.file.submenu[4].label, 'label:menu.file.addMusicFolder');
  assert.equal(appMenu.file.submenu[4].enabled, true);
  assert.equal(appMenu.file.submenu[5].label, 'label:menu.file.rescanLibrary');
  assert.equal(appMenu.file.submenu[5].enabled, true);
  assert.equal(appMenu.file.submenu[9].enabled, true);
  assert.equal(appMenu.edit.submenu[0].enabled, true);
  assert.equal(appMenu.view.submenu[6].label, 'label:menu.view.effectPipeline');
  assert.equal(appMenu.view.submenu[7].label, 'label:menu.view.musicLibrary');
  assert.equal(appMenu.view.submenu[9].label, 'label:menu.view.toggleFullscreen');
  assert.equal(appMenu.view.submenu[10].label, 'label:menu.view.miniPlayer');
  assert.equal(appMenu.help.submenu[1].label, 'Discord');
  assert.equal(harness.calls[2][0], 'updateTrayMenu');
});

test('updateApplicationMenu disables gated items while double blind test is active', async () => {
  const harness = createWindowHarness({
    uiManager: {
      isDoubleBlindActive: () => true
    }
  });

  await withGlobals({ window: harness.window }, async () => {
    await updateApplicationMenu(true);
    await flushMicrotasks();
  });

  const appMenu = harness.calls[0][1];
  assert.equal(appMenu.file.submenu[0].enabled, false);
  assert.equal(appMenu.file.submenu[3].enabled, true);
  assert.equal(appMenu.file.submenu[4].enabled, true);
  assert.equal(appMenu.file.submenu[5].enabled, true);
  assert.equal(appMenu.file.submenu[6].enabled, false);
  assert.equal(appMenu.file.submenu[9].enabled, false);
  assert.equal(appMenu.file.submenu[11].enabled, false);
  assert.equal(appMenu.edit.submenu[0].enabled, false);
  assert.equal(appMenu.edit.submenu[8].enabled, false);
});

test('updateApplicationMenu treats missing double blind state as inactive', async () => {
  const harness = createWindowHarness();

  await withGlobals({ window: harness.window }, async () => {
    await updateApplicationMenu(true);
    await flushMicrotasks();
  });

  assert.equal(harness.calls[0][1].file.submenu[0].enabled, true);
});

test('updateApplicationMenu logs failed and rejected menu updates', async () => {
  const failed = createWindowHarness({
    updateApplicationMenuResult: { success: false, error: 'menu failed' }
  });
  await withGlobals({ window: failed.window }, async () => {
    await withMutedConsole('error', async () => {
      await updateApplicationMenu(true);
      await flushMicrotasks();
    });
  });
  assert.equal(failed.calls[0][0], 'updateApplicationMenu');

  const rejected = createWindowHarness({
    updateApplicationMenuRejects: new Error('menu rejected')
  });
  await withGlobals({ window: rejected.window }, async () => {
    await withMutedConsole('error', async () => {
      await updateApplicationMenu(true);
      await flushMicrotasks();
    });
  });
  assert.equal(rejected.calls[0][0], 'updateApplicationMenu');
});

test('updateApplicationMenu catches synchronous template failures', async () => {
  const translationFailure = createWindowHarness({
    uiManager: {
      t() {
        throw new Error('translation failed');
      }
    }
  });
  await withGlobals({ window: translationFailure.window }, async () => {
    await withMutedConsole('error', async () => {
      await updateApplicationMenu(true);
    });
  });
  assert.deepEqual(translationFailure.calls, []);

  const apiFailure = createWindowHarness({
    updateApplicationMenuThrows: new Error('sync menu failure')
  });
  await withGlobals({ window: apiFailure.window }, async () => {
    await withMutedConsole('error', async () => {
      await updateApplicationMenu(true);
    });
  });
  assert.equal(apiFailure.calls[0][0], 'updateApplicationMenu');
});
