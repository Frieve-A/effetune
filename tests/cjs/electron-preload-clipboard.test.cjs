const assert = require('node:assert/strict');
const test = require('node:test');

const {
  loadFreshModule,
  withModuleLoadStub,
  withMutedConsoleAsync,
  withPatchedProperty
} = require('../helpers/cjs-module-utils.cjs');

function createPreloadHarness() {
  const exposed = {};
  const invocations = [];
  const sends = [];
  const listeners = new Map();
  const throwInvokeChannels = new Set();
  const rejectInvokeChannels = new Set();
  const electron = {
    webUtils: {
      getPathForFile(file) {
        return file?.trustedPath || '';
      }
    },
    contextBridge: {
      exposeInMainWorld(name, api) {
        exposed[name] = api;
      }
    },
    ipcRenderer: {
      invoke(channel, ...args) {
        invocations.push([channel, ...args]);
        if (throwInvokeChannels.has(channel)) {
          throw new Error(`invoke failed: ${channel}`);
        }
        if (rejectInvokeChannels.has(channel)) {
          return Promise.reject(new Error(`invoke rejected: ${channel}`));
        }
        return Promise.resolve({ channel, args });
      },
      on(channel, callback) {
        listeners.set(channel, callback);
      },
      removeListener(channel, callback) {
        if (listeners.get(channel) === callback) {
          listeners.delete(channel);
        }
      },
      send(channel, ...args) {
        sends.push([channel, ...args]);
      }
    }
  };
  const documentListeners = new Map();
  const document = {
    addEventListener(type, callback) {
      if (!documentListeners.has(type)) {
        documentListeners.set(type, []);
      }
      documentListeners.get(type).push(callback);
    },
    dispatchEvent(type, event = {}) {
      for (const callback of documentListeners.get(type) || []) {
        callback(event);
      }
    }
  };

  return {
    document,
    documentListeners,
    electron,
    exposed,
    invocations,
    listeners,
    rejectInvokeChannels,
    sends,
    throwInvokeChannels
  };
}

function loadPreload(harness) {
  const originalDocument = global.document;
  const originalWindow = global.window;
  global.document = harness.document;
  global.window = {};

  try {
    withModuleLoadStub({ electron: harness.electron }, () => {
      loadFreshModule('../../electron/preload.js');
    });
  } finally {
    if (originalDocument === undefined) {
      delete global.document;
    } else {
      global.document = originalDocument;
    }
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
  }
}

test('preload exposes electronAPI invoke and send wrappers', async () => {
  const harness = createPreloadHarness();
  loadPreload(harness);
  const api = harness.exposed.electronAPI;

  assert.equal(api.platform, process.platform);
  assert.equal(Object.hasOwn(api, 'ipcRenderer'), false);

  const invokeCases = [
    ['showSaveDialog', ['save-options'], ['show-save-dialog', 'save-options']],
    ['showOpenDialog', ['open-options'], ['show-open-dialog', 'open-options']],
    ['saveFile', ['a.txt', 'content'], ['save-file', 'a.txt', 'content']],
    ['readFile', ['a.txt'], ['read-file', 'a.txt', false]],
    ['readFile', ['a.txt', true], ['read-file', 'a.txt', true]],
    ['beginAtomicFileWrite', ['a.txt'], ['begin-atomic-file-write', 'a.txt']],
    ['writeAtomicFileChunk', ['token', 'part'], ['write-atomic-file-chunk', 'token', 'part']],
    ['commitAtomicFileWrite', ['token'], ['commit-atomic-file-write', 'token']],
    ['abortAtomicFileWrite', ['token'], ['abort-atomic-file-write', 'token']],
    ['readClipboardText', [], ['read-clipboard-text']],
    ['writeClipboardText', ['pipeline'], ['write-clipboard-text', 'pipeline']],
    ['readFileAsBuffer', ['a.wav'], ['read-file-as-buffer', 'a.wav']],
    ['openDocumentation', ['/docs'], ['open-documentation', '/docs']],
    ['openExternalUrl', ['https://example.test'], ['open-external-url', 'https://example.test']],
    ['openExternal', ['https://example.test'], ['open-external-url', 'https://example.test']],
    ['getAudioDevices', [], ['get-audio-devices']],
    ['saveAudioPreferences', [{ sampleRate: 48000 }], ['save-audio-preferences', { sampleRate: 48000 }]],
    ['loadAudioPreferences', [], ['load-audio-preferences']],
    ['getAppVersion', [], ['get-app-version']],
    ['getCommandLinePresetFile', [], ['get-command-line-preset-file']],
    ['reloadWindow', [], ['reload-window']],
    ['relaunchApp', [], ['relaunch-app']],
    ['armRendererWatchdog', ['reset'], ['renderer-watchdog-arm', 'reset']],
    ['disarmRendererWatchdog', ['done'], ['renderer-watchdog-disarm', 'done']],
    ['requestMicrophoneAccess', [], ['request-microphone-access']],
    ['clearMicrophonePermission', [], ['clear-microphone-permission']],
    ['updateApplicationMenu', [{ file: {} }], ['update-application-menu', { file: {} }]],
    ['updateTrayMenu', [{ open: {} }], ['update-tray-menu', { open: {} }]],
    ['loadPresetFromTray', ['Preset'], ['load-preset-from-tray', 'Preset']],
    ['getUserPresetsForTray', [], ['get-user-presets-for-tray']],
    ['hideApplicationMenu', [], ['hide-application-menu']],
    ['restoreDefaultMenu', [], ['restore-default-menu']],
    ['navigateToMain', [], ['navigate-to-main']],
    ['getApplicationMenu', [], ['get-application-menu']],
    ['getPath', ['userData'], ['getPath', 'userData']],
    ['joinPaths', ['base', 'child', 'leaf'], ['joinPaths', 'base', 'child', 'leaf']],
    ['fileExists', ['file'], ['fileExists', 'file']],
    ['savePipelineStateToFile', [[{ name: 'Volume' }]], ['save-pipeline-state-to-file', [{ name: 'Volume' }]]],
    ['signalReadyForUpdates', [], ['renderer-ready-for-updates']],
    ['getUpdateInfo', [], ['get-update-info']],
    ['forceCheckForUpdates', [], ['force-check-for-updates']],
    ['loadConfig', [], ['load-config']],
    ['saveConfig', [{ language: 'ja' }], ['save-config', { language: 'ja' }]]
  ];

  for (const [method, args, expectedInvocation] of invokeCases) {
    const result = await api[method](...args);
    assert.deepEqual(result, {
      channel: expectedInvocation[0],
      args: expectedInvocation.slice(1)
    });
  }

  api.rendererPing();
  api.sendPipelineStateForClose({ plugins: [] });
  api.signalReadyForMusicFiles();

  assert.deepEqual(harness.sends.slice(0, 3), [
    ['renderer-ping'],
    ['pipeline-state-for-close', { plugins: [] }],
    ['renderer-ready-for-music-files']
  ]);
});

test('preload derives dropped playlist paths in the isolated world before requesting a grant', async () => {
  const harness = createPreloadHarness();
  loadPreload(harness);

  const result = await harness.exposed.electronAPI.libraryCatalogV1.grantDroppedPlaylistImport({
    name: 'Daily.m3u8',
    trustedPath: 'D:\\Playlists\\Daily.m3u8'
  });

  assert.deepEqual(result, {
    channel: 'library-catalog-v1:grant-dropped-playlist-import',
    args: [{ path: 'D:\\Playlists\\Daily.m3u8' }]
  });
});

test('preload exposes listener registration wrappers', () => {
  const harness = createPreloadHarness();
  loadPreload(harness);
  const api = harness.exposed.electronAPI;
  const calls = [];

  const noArgListeners = [
    ['onExportPreset', 'export-preset'],
    ['onImportPreset', 'import-preset'],
    ['onOpenMusicFile', 'open-music-file'],
    ['onProcessAudioFiles', 'process-audio-files'],
    ['onSavePreset', 'save-preset'],
    ['onSavePresetAs', 'save-preset-as'],
    ['onConfigAudio', 'config-audio'],
    ['onConfigApp', 'config-app'],
    ['onRequestPipelineStateForClose', 'request-pipeline-state-for-close']
  ];
  for (const [method, channel] of noArgListeners) {
    const unsubscribe = api[method](() => calls.push([method]));
    assert.equal(typeof unsubscribe, 'function');
    harness.listeners.get(channel)({});
  }

  const unsubscribeOpenPreset = api.onOpenPresetFile(filePath => calls.push(['onOpenPresetFile', filePath]));
  assert.equal(typeof unsubscribeOpenPreset, 'function');
  harness.listeners.get('open-preset-file')({}, 'preset.effetune_preset');
  api.onOpenMusicFiles(filePaths => calls.push(['onOpenMusicFiles', filePaths]));
  harness.listeners.get('open-music-files')({}, ['song.wav']);
  api.onLoadUserPreset(name => calls.push(['onLoadUserPreset', name]));
  harness.listeners.get('load-user-preset')({}, 'Preset');
  api.onShowAboutDialog(data => calls.push(['onShowAboutDialog', data]));
  harness.listeners.get('show-about-dialog')({}, { version: '1.0.0' });
  api.onAudioFilesDropped(filePaths => calls.push(['onAudioFilesDropped', filePaths]));
  harness.listeners.get('audio-files-dropped')({}, ['drop.wav']);
  api.onRequestTrayMenuUpdate(() => calls.push(['onRequestTrayMenuUpdate']));
  harness.listeners.get('request-tray-menu-update')({});
  api.onStartDoubleBlindTest(() => calls.push(['onStartDoubleBlindTest']));
  harness.listeners.get('start-double-blind-test')({});
  api.onOpenEffectPipelineView(() => calls.push(['onOpenEffectPipelineView']));
  harness.listeners.get('open-effect-pipeline-view')({});
  api.onOpenLibraryView(() => calls.push(['onOpenLibraryView']));
  harness.listeners.get('open-library-view')({});
  api.onAddMusicFolder(() => calls.push(['onAddMusicFolder']));
  harness.listeners.get('add-music-folder')({});
  api.onRescanLibrary(() => calls.push(['onRescanLibrary']));
  harness.listeners.get('rescan-library')({});
  api.onUpdateAvailable(updateInfo => calls.push(['onUpdateAvailable', updateInfo]));
  harness.listeners.get('update-available')({}, { version: '2.0.0' });
  api.onLoadPresetFromTray(presetName => calls.push(['onLoadPresetFromTray', presetName]));
  harness.listeners.get('load-preset-from-tray')({}, 'Tray Preset');
  api.onIPC('request-tray-menu-update', (...args) => calls.push(['onIPC', args]));
  harness.listeners.get('request-tray-menu-update')({}, 'a', 'b');
  assert.throws(
    () => api.onIPC('custom-channel', () => {}),
    /not allowed/
  );
  unsubscribeOpenPreset();
  assert.equal(harness.listeners.has('open-preset-file'), false);

  assert.deepEqual(calls, [
    ['onExportPreset'],
    ['onImportPreset'],
    ['onOpenMusicFile'],
    ['onProcessAudioFiles'],
    ['onSavePreset'],
    ['onSavePresetAs'],
    ['onConfigAudio'],
    ['onConfigApp'],
    ['onRequestPipelineStateForClose'],
    ['onOpenPresetFile', 'preset.effetune_preset'],
    ['onOpenMusicFiles', ['song.wav']],
    ['onLoadUserPreset', 'Preset'],
    ['onShowAboutDialog', { version: '1.0.0' }],
    ['onAudioFilesDropped', ['drop.wav']],
    ['onRequestTrayMenuUpdate'],
    ['onStartDoubleBlindTest'],
    ['onOpenEffectPipelineView'],
    ['onOpenLibraryView'],
    ['onAddMusicFolder'],
    ['onRescanLibrary'],
    ['onUpdateAvailable', { version: '2.0.0' }],
    ['onLoadPresetFromTray', 'Tray Preset'],
    ['onIPC', ['a', 'b']]
  ]);
});

test('preload isFirstLaunch normalizes fulfilled and rejected IPC results', async () => {
  const harness = createPreloadHarness();
  loadPreload(harness);

  assert.equal(await harness.exposed.electronAPI.isFirstLaunch(), true);
  harness.rejectInvokeChannels.add('get-first-launch-flag');
  assert.equal(await harness.exposed.electronAPI.isFirstLaunch(), false);
});

test('preload electronFileSystem wrappers map files and recover from failures', async () => {
  const harness = createPreloadHarness();
  loadPreload(harness);
  const fileSystem = harness.exposed.electronFileSystem;
  const files = [
    { name: 'a.wav', size: 1, type: 'audio/wav', lastModified: 2, path: 'C:\\a.wav' },
    { name: 'b.wav', size: 3, type: 'audio/wav', lastModified: 4, path: '' }
  ];

  assert.deepEqual(await fileSystem.getRealPath(files[0]), {
    channel: 'get-file-path',
    args: [{ name: 'a.wav', size: 1, type: 'audio/wav', lastModified: 2 }]
  });
  assert.deepEqual(await fileSystem.getRealPaths(files), {
    channel: 'get-file-paths',
    args: [[
      { name: 'a.wav', size: 1, type: 'audio/wav', lastModified: 2 },
      { name: 'b.wav', size: 3, type: 'audio/wav', lastModified: 4 }
    ]]
  });
  assert.deepEqual(await fileSystem.handleDroppedFiles(files), {
    channel: 'handle-dropped-files-with-paths',
    args: [['C:\\a.wav']]
  });
  assert.deepEqual(await fileSystem.handleDroppedFiles([files[1]]), {
    channel: 'handle-dropped-files',
    args: [[{ name: 'b.wav', size: 3, type: 'audio/wav', lastModified: 4 }]]
  });
  assert.deepEqual(await fileSystem.handleDroppedPresetFile(files[0]), {
    channel: 'handle-dropped-preset-file',
    args: [{ name: 'a.wav', size: 1, type: 'audio/wav', lastModified: 2 }]
  });

  await withMutedConsoleAsync('error', async () => {
    harness.throwInvokeChannels.add('get-file-path');
    assert.equal(await fileSystem.getRealPath(files[0]), null);
    harness.throwInvokeChannels.add('get-file-paths');
    assert.deepEqual(await fileSystem.getRealPaths(files), []);
    harness.throwInvokeChannels.add('handle-dropped-files-with-paths');
    assert.deepEqual(await fileSystem.handleDroppedFiles(files), []);
    harness.throwInvokeChannels.add('handle-dropped-preset-file');
    assert.equal(await fileSystem.handleDroppedPresetFile(files[0]), null);
  });
});

test('preload drag and drop diagnostics forward dropped file paths', () => {
  const harness = createPreloadHarness();
  loadPreload(harness);

  const domLoaded = harness.documentListeners.get('DOMContentLoaded')[0];
  const originalWindow = global.window;
  const originalDocument = global.document;
  global.window = {};
  global.document = harness.document;
  try {
    domLoaded();
    withPatchedProperty(Date, 'now', () => 1000, () => {
      harness.document.dispatchEvent('dragover', {});
      assert.equal(global.window._lastDragOverLog, 1000);
    });
    withPatchedProperty(Date, 'now', () => 1500, () => {
      harness.document.dispatchEvent('dragover', {});
      assert.equal(global.window._lastDragOverLog, 1000);
    });
    withPatchedProperty(Date, 'now', () => 2501, () => {
      harness.document.dispatchEvent('dragover', {});
      assert.equal(global.window._lastDragOverLog, 2501);
    });
  } finally {
    if (originalWindow === undefined) {
      delete global.window;
    } else {
      global.window = originalWindow;
    }
    if (originalDocument === undefined) {
      delete global.document;
    } else {
      global.document = originalDocument;
    }
  }

  harness.document.dispatchEvent('drop', {});
  harness.document.dispatchEvent('drop', { dataTransfer: {} });
  harness.document.dispatchEvent('drop', { dataTransfer: { files: [] } });
  harness.document.dispatchEvent('drop', { dataTransfer: { files: [{ path: '' }] } });
  harness.document.dispatchEvent('drop', { dataTransfer: { files: [{ path: 'C:\\song.wav' }] } });

  assert.deepEqual(harness.sends.at(-1), ['files-dropped', ['C:\\song.wav']]);
});
