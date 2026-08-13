const assert = require('node:assert/strict');
const test = require('node:test');

const {
  loadFreshModule,
  withModuleLoadStub
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
  return {
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
  withModuleLoadStub({ electron: harness.electron }, () => {
    loadFreshModule('../../electron/preload.js');
  });
}

test('preload exposes electronAPI invoke and send wrappers', async () => {
  const harness = createPreloadHarness();
  loadPreload(harness);
  const api = harness.exposed.electronAPI;

  assert.deepEqual(Object.keys(harness.exposed), ['electronAPI']);
  assert.equal(api.platform, process.platform);
  assert.equal(Object.hasOwn(api, 'ipcRenderer'), false);
  assert.equal(Object.hasOwn(api, 'openDocumentation'), false);
  assert.equal(Object.hasOwn(api, 'getApplicationMenu'), false);
  assert.equal(Object.hasOwn(api, 'onAudioFilesDropped'), false);

  const invokeCases = [
    ['showSaveDialog', ['save-options'], ['show-save-dialog', 'save-options']],
    ['showOpenDialog', ['open-options'], ['show-open-dialog', 'open-options']],
    ['openPlaybackSelection', [], ['open-playback-selection']],
    ['saveFile', ['a.txt', 'content'], ['save-file', 'a.txt', 'content']],
    ['readFile', ['a.txt'], ['read-file', 'a.txt']],
    ['readFileBytes', ['a.wav'], ['read-file-bytes', 'a.wav']],
    ['beginAtomicFileWrite', ['a.txt'], ['begin-atomic-file-write', 'a.txt']],
    ['writeAtomicFileChunk', ['token', 'part'], ['write-atomic-file-chunk', 'token', 'part']],
    ['commitAtomicFileWrite', ['token'], ['commit-atomic-file-write', 'token']],
    ['abortAtomicFileWrite', ['token'], ['abort-atomic-file-write', 'token']],
    ['readClipboardText', [], ['read-clipboard-text']],
    ['writeClipboardText', ['pipeline'], ['write-clipboard-text', 'pipeline']],
    ['openExternalUrl', ['https://example.test'], ['open-external-url', 'https://example.test']],
    ['openExternal', ['https://example.test'], ['open-external-url', 'https://example.test']],
    ['getAudioDevices', [], ['get-audio-devices']],
    ['saveAudioPreferences', [{ sampleRate: 48000 }], ['save-audio-preferences', { sampleRate: 48000 }]],
    ['loadAudioPreferences', [], ['load-audio-preferences']],
    ['getWindowVisibility', [], ['get-window-visibility']],
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
    [
      'openFrequencyResponseMeasurement',
      [{ pipelineA: [{ name: 'Volume' }], pipelineB: null, currentPipeline: 'A' }],
      ['open-frequency-response-measurement', { pipelineA: [{ name: 'Volume' }], pipelineB: null, currentPipeline: 'A' }]
    ],
    ['getPath', ['userData'], ['getPath', 'userData']],
    ['joinPaths', ['base', 'child', 'leaf'], ['joinPaths', 'base', 'child', 'leaf']],
    ['fileExists', ['file'], ['fileExists', 'file']],
    ['savePipelineStateToFile', [[{ name: 'Volume' }]], ['save-pipeline-state-to-file', [{ name: 'Volume' }]]],
    ['signalReadyForUpdates', [], ['renderer-ready-for-updates']],
    ['getUpdateInfo', [], ['get-update-info']],
    ['forceCheckForUpdates', [], ['force-check-for-updates']],
    ['loadConfig', [], ['load-config']],
    ['saveConfig', [{ language: 'ja' }], ['save-config', { language: 'ja' }]],
    ['setMiniPlayerMode', [{ enabled: true }], ['set-mini-player-mode', { enabled: true }]],
    ['setAlwaysOnTop', [true], ['set-always-on-top', true]]
  ];

  for (const [method, args, expectedInvocation] of invokeCases) {
    const result = await api[method](...args);
    assert.deepEqual(result, {
      channel: expectedInvocation[0],
      args: expectedInvocation.slice(1)
    });
  }

  const reloadState = {
    pipelineA: [{ name: 'Volume' }],
    pipelineB: null,
    currentPipeline: 'A'
  };
  assert.deepEqual(await api.reloadWindow(reloadState), {
    channel: 'reload-window',
    args: [reloadState]
  });

  const favoriteRequest = { limit: 25, cursor: { position: 1024, itemKey: 7 } };
  assert.deepEqual(await api.libraryCatalogV1.getFavoriteTrackUids(favoriteRequest), {
    channel: 'library-catalog-v1:get-favorite-track-uids',
    args: [favoriteRequest]
  });

  assert.deepEqual(await api.readFileBytes('sized.wav', 123), {
    channel: 'read-file-bytes',
    args: ['sized.wav', 123]
  });
  for (const invalid of [null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(
      () => api.readFileBytes('invalid.wav', invalid),
      error => error?.code === 'ERR_INVALID_EXPECTED_BYTE_LENGTH'
    );
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

test('preload keeps OpenHome settings under the versioned host API', async () => {
  const harness = createPreloadHarness();
  loadPreload(harness);
  const config = {
    language: 'ja',
    openHomeRemoteControl: false,
    openHomeDeviceId: 'renderer-controlled-id',
    openHomeFriendlyName: 'renderer-controlled-name'
  };

  await harness.exposed.electronAPI.saveConfig(config);

  assert.deepEqual(harness.invocations.at(-1), ['save-config', { language: 'ja' }]);
  assert.deepEqual(config, {
    language: 'ja',
    openHomeRemoteControl: false,
    openHomeDeviceId: 'renderer-controlled-id',
    openHomeFriendlyName: 'renderer-controlled-name'
  });
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

test('preload rejects oversized IR library writes before invoking the main process', async () => {
  const harness = createPreloadHarness();
  loadPreload(harness);
  const library = harness.exposed.electronAPI.irLibraryV1;
  const analysisName = 'aaaaaaaaaaaaaaaaaaaaaaaa.analysis';

  await library.writeAtomic({ name: analysisName, bytes: new Uint8Array([1]) });
  const invocationsBeforeOversizedWrites = harness.invocations.length;
  assert.throws(
    () => library.writeAtomic({ name: analysisName, bytes: new Uint8Array(4 * 1024 * 1024 + 1) }),
    error => error?.code === 'ERR_IR_LIBRARY_DATA_TOO_LARGE'
  );
  assert.throws(
    () => library.writeCacheAtomic({ name: 'index.json', bytes: new Uint8Array(4 * 1024 * 1024 + 1) }),
    error => error?.code === 'ERR_IR_LIBRARY_DATA_TOO_LARGE'
  );
  assert.equal(harness.invocations.length, invocationsBeforeOversizedWrites);
});

test('preload exposes only the versioned OpenHome control bridge', async () => {
  const harness = createPreloadHarness();
  loadPreload(harness);
  const bridge = harness.exposed.electronAPI.openHomeV1;

  assert.equal(bridge.apiVersion, 1);
  await bridge.getStatus();
  await bridge.setEnabled(true);
  await bridge.setFriendlyName('EffeTune Living Room');
  await bridge.rendererReady();
  await bridge.rendererUnavailable();
  await bridge.respond({ requestId: 'a1', ok: true, result: {} });
  await bridge.resetComplete({ resetId: 'reset-1', ok: true });
  await bridge.publishState({ transportState: 'Stopped' });
  assert.deepEqual(harness.invocations.slice(-8), [
    ['openhome-v1:get-status', {}],
    ['openhome-v1:set-enabled', { enabled: true }],
    ['openhome-v1:set-friendly-name', { friendlyName: 'EffeTune Living Room' }],
    ['openhome-v1:renderer-ready', {}],
    ['openhome-v1:renderer-unavailable', {}],
    ['openhome-v1:response', { requestId: 'a1', ok: true, result: {} }],
    ['openhome-v1:reset-ack', { resetId: 'reset-1', ok: true }],
    ['openhome-v1:state', { transportState: 'Stopped' }]
  ]);
  assert.throws(() => bridge.setEnabled('yes'), TypeError);
  assert.throws(() => bridge.setFriendlyName(false), TypeError);

  const actions = [];
  const remove = bridge.onAction(action => actions.push(action));
  harness.listeners.get('openhome-v1:action')({}, { requestId: 'a2' });
  assert.deepEqual(actions, [{ requestId: 'a2' }]);
  remove();
  assert.equal(harness.listeners.has('openhome-v1:action'), false);

  const cancellations = [];
  const removeCancel = bridge.onCancel(cancel => cancellations.push(cancel));
  harness.listeners.get('openhome-v1:cancel')({}, { requestId: 'a2' });
  assert.deepEqual(cancellations, [{ requestId: 'a2' }]);
  removeCancel();
  assert.equal(harness.listeners.has('openhome-v1:cancel'), false);

  const resets = [];
  const removeReset = bridge.onReset(reset => resets.push(reset));
  harness.listeners.get('openhome-v1:reset')({}, { resetId: 'reset-2' });
  assert.deepEqual(resets, [{ resetId: 'reset-2' }]);
  removeReset();
  assert.equal(harness.listeners.has('openhome-v1:reset'), false);
  assert.equal(Object.hasOwn(bridge, 'invoke'), false);
  assert.equal(Object.hasOwn(bridge, 'send'), false);
});

test('preload forwards only the safe oversized-index read code', async () => {
  const harness = createPreloadHarness();
  const invoke = harness.electron.ipcRenderer.invoke.bind(harness.electron.ipcRenderer);
  let response = { ok: false, code: 'ir-library-index-too-large' };
  harness.electron.ipcRenderer.invoke = (channel, ...args) => invoke(channel, ...args).then(() => response);
  loadPreload(harness);
  const library = harness.exposed.electronAPI.irLibraryV1;

  assert.deepEqual(await library.read({ name: 'index.json' }), {
    ok: false,
    code: 'ir-library-index-too-large'
  });

  response = { ok: false, code: 'C:\\private\\raw-error' };
  assert.deepEqual(await library.read({ name: 'index.json' }), { ok: false, code: 'storage-failed' });
});

test('preload exposes catalog recovery independently from the catalog API', async () => {
  const harness = createPreloadHarness();
  loadPreload(harness);
  const recovery = harness.exposed.electronAPI.libraryRecoveryV1;
  const states = [];

  assert.equal(recovery.apiVersion, 1);
  assert.deepEqual(await recovery.getState(), {
    channel: 'library-recovery-v1:get-state',
    args: [{}]
  });
  assert.deepEqual(await recovery.resetCatalog({ confirmed: true }), {
    channel: 'library-recovery-v1:reset-catalog',
    args: [{ confirmed: true }]
  });
  const unsubscribe = recovery.onStateChange(state => states.push(state));
  harness.listeners.get('library-recovery-v1:state')({}, {
    apiVersion: 1,
    status: 'unavailable',
    available: false,
    canReset: true,
    message: 'Unavailable'
  });
  assert.equal(states[0].status, 'unavailable');
  unsubscribe();
  assert.equal(harness.listeners.has('library-recovery-v1:state'), false);
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
    ['onOpenFrequencyResponseMeasurement', 'open-frequency-response-measurement'],
    ['onReloadWithPipelineState', 'reload-with-pipeline-state'],
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
  api.onWindowVisibilityChanged(data => calls.push(['onWindowVisibilityChanged', data]));
  harness.listeners.get('window-visibility-changed')({}, { hidden: true });
  api.onRequestTrayMenuUpdate(() => calls.push(['onRequestTrayMenuUpdate']));
  harness.listeners.get('request-tray-menu-update')({});
  api.onStartDoubleBlindTest(() => calls.push(['onStartDoubleBlindTest']));
  harness.listeners.get('start-double-blind-test')({});
  api.onOpenEffectPipelineView(() => calls.push(['onOpenEffectPipelineView']));
  harness.listeners.get('open-effect-pipeline-view')({});
  api.onOpenLibraryView(() => calls.push(['onOpenLibraryView']));
  harness.listeners.get('open-library-view')({});
  const unsubscribePipelineAnalyzer = api.onSetPipelineAnalyzerOpen(open => {
    calls.push(['onSetPipelineAnalyzerOpen', open]);
  });
  harness.listeners.get('set-pipeline-analyzer-open')({}, true);
  harness.listeners.get('set-pipeline-analyzer-open')({}, 'not-a-boolean');
  api.onExitMiniPlayer(() => calls.push(['onExitMiniPlayer']));
  harness.listeners.get('exit-mini-player')({});
  api.onToggleMiniPlayer(() => calls.push(['onToggleMiniPlayer']));
  harness.listeners.get('toggle-mini-player')({});
  api.onAddMusicFolder(() => calls.push(['onAddMusicFolder']));
  harness.listeners.get('add-music-folder')({});
  api.onRescanLibrary(() => calls.push(['onRescanLibrary']));
  harness.listeners.get('rescan-library')({});
  api.onUpdateAvailable(updateInfo => calls.push(['onUpdateAvailable', updateInfo]));
  harness.listeners.get('update-available')({}, { version: '2.0.0' });
  api.onLoadPresetFromTray(presetName => calls.push(['onLoadPresetFromTray', presetName]));
  harness.listeners.get('load-preset-from-tray')({}, 'Tray Preset');
  api.libraryCatalogV1.onFolderRemovalEvent(event => calls.push(['onFolderRemovalEvent', event]));
  harness.listeners.get('library-catalog-v1:folder-removal-event')({}, {
    folderId: 'folder-one', phase: 'removing', deleted: 3, total: 10
  });
  api.onIPC('request-tray-menu-update', (...args) => calls.push(['onIPC', args]));
  harness.listeners.get('request-tray-menu-update')({}, 'a', 'b');
  assert.throws(
    () => api.onIPC('custom-channel', () => {}),
    /not allowed/
  );
  unsubscribeOpenPreset();
  assert.equal(harness.listeners.has('open-preset-file'), false);
  unsubscribePipelineAnalyzer();
  assert.equal(harness.listeners.has('set-pipeline-analyzer-open'), false);

  assert.deepEqual(calls, [
    ['onExportPreset'],
    ['onImportPreset'],
    ['onOpenMusicFile'],
    ['onProcessAudioFiles'],
    ['onSavePreset'],
    ['onSavePresetAs'],
    ['onConfigAudio'],
    ['onConfigApp'],
    ['onOpenFrequencyResponseMeasurement'],
    ['onReloadWithPipelineState'],
    ['onRequestPipelineStateForClose'],
    ['onOpenPresetFile', 'preset.effetune_preset'],
    ['onOpenMusicFiles', ['song.wav']],
    ['onLoadUserPreset', 'Preset'],
    ['onShowAboutDialog', { version: '1.0.0' }],
    ['onWindowVisibilityChanged', { hidden: true }],
    ['onRequestTrayMenuUpdate'],
    ['onStartDoubleBlindTest'],
    ['onOpenEffectPipelineView'],
    ['onOpenLibraryView'],
    ['onSetPipelineAnalyzerOpen', true],
    ['onSetPipelineAnalyzerOpen', false],
    ['onExitMiniPlayer'],
    ['onToggleMiniPlayer'],
    ['onAddMusicFolder'],
    ['onRescanLibrary'],
    ['onUpdateAvailable', { version: '2.0.0' }],
    ['onLoadPresetFromTray', 'Tray Preset'],
    ['onFolderRemovalEvent', {
      folderId: 'folder-one', phase: 'removing', deleted: 3, total: 10
    }],
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
