const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createTempDir,
  loadFreshModule,
  withModuleLoadStub,
  withMutedConsole,
  withMutedConsoleAsync,
  withPatchedProperty
} = require('../helpers/cjs-module-utils.cjs');

function createHarness(options = {}) {
  const calls = [];
  let mainWindow = options.mainWindow || { id: 'main-window' };
  let isFirstLaunch = Boolean(options.isFirstLaunch);
  const commandLineMusicFiles = [];
  const savedCommandLineMusicFiles = [];
  const constants = {
    setMainWindow: win => {
      calls.push(['setMainWindow', win]);
      mainWindow = win;
    },
    getMainWindow: () => mainWindow,
    getIsFirstLaunch: () => isFirstLaunch,
    setIsFirstLaunch: value => {
      isFirstLaunch = value;
    },
    clearCommandLineMusicFiles: () => {
      calls.push(['clearCommandLineMusicFiles']);
      commandLineMusicFiles.length = 0;
    },
    setCommandLinePresetFile: file => calls.push(['setCommandLinePresetFile', file]),
    setSavedCommandLinePresetFile: file => calls.push(['setSavedCommandLinePresetFile', file]),
    setShouldLoadPipelineState: flag => calls.push(['setShouldLoadPipelineState', flag]),
    addCommandLineMusicFile: file => {
      calls.push(['addCommandLineMusicFile', file]);
      commandLineMusicFiles.push(file);
    },
    addSavedCommandLineMusicFile: file => {
      calls.push(['addSavedCommandLineMusicFile', file]);
      savedCommandLineMusicFiles.push(file);
    }
  };
  const dialog = {
    async showSaveDialog(win, dialogOptions) {
      calls.push(['showSaveDialog', win, dialogOptions]);
      return options.saveDialogResult || { canceled: false, filePath: 'saved.effetune_preset' };
    },
    async showOpenDialog(win, dialogOptions) {
      calls.push(['showOpenDialog', win, dialogOptions]);
      if (typeof options.openDialogResult === 'function') {
        return options.openDialogResult(win, dialogOptions);
      }
      return options.openDialogResult || { canceled: false, filePaths: ['selected.wav'] };
    }
  };
  const app = {
    getPath(name) {
      calls.push(['app.getPath', name]);
      if (name === 'music') return options.musicPath || 'C:\\Music';
      return options.userDataPath || 'C:\\UserData';
    }
  };
  const fileUtils = {
    saveFile: async (...args) => {
      calls.push(['fileUtils.saveFile', ...args]);
      return { success: true, op: 'saveFile', args };
    },
    readFile: async (...args) => {
      calls.push(['fileUtils.readFile', ...args]);
      return { success: true, op: 'readFile', args };
    },
    joinPaths: (...args) => {
      calls.push(['fileUtils.joinPaths', ...args]);
      return path.join(...args);
    },
    fileExists: filePath => {
      calls.push(['fileUtils.fileExists', filePath]);
      return filePath.endsWith('exists');
    },
    savePipelineStateToFile: async (...args) => {
      calls.push(['fileUtils.savePipelineStateToFile', ...args]);
      return { success: true, op: 'savePipelineStateToFile', args };
    }
  };

  const module = withModuleLoadStub({
    electron: { app, dialog },
    './constants': constants,
    './file-utils': fileUtils
  }, () => loadFreshModule('../../electron/file-handlers.js'));

  return {
    calls,
    commandLineMusicFiles,
    constants,
    fileUtils,
    module,
    savedCommandLineMusicFiles,
    setMainWindow: win => {
      mainWindow = win;
    },
    withElectronStub: callback => withModuleLoadStub({ electron: { app, dialog } }, callback)
  };
}

test('setMainWindow and showSaveDialog use the shared main window reference', async () => {
  const harness = createHarness();
  const newWindow = { id: 'new-window' };
  harness.module.setMainWindow(newWindow);

  const result = await harness.module.showSaveDialog({ title: 'Save Preset' });

  assert.deepEqual(result, { canceled: false, filePath: 'saved.effetune_preset' });
  assert.deepEqual(harness.calls, [
    ['setMainWindow', newWindow],
    ['showSaveDialog', newWindow, { title: 'Save Preset' }]
  ]);
});

test('showOpenDialog normalizes playback audio filters and leaves unrelated filters untouched', async () => {
  const playback = createHarness();
  await playback.module.showOpenDialog({
    title: 'Select Music Files',
    filters: [{ name: 'Audio Files', extensions: ['mp3'] }]
  });
  assert.deepEqual(playback.calls[0][2].filters, [{
    name: 'Audio Files (MP3, WAV, OGG, FLAC, OPUS, M4A, AAC, WEBM, MP4)',
    extensions: ['mp3', 'wav', 'ogg', 'flac', 'opus', 'm4a', 'aac', 'webm', 'mp4']
  }]);

  const offline = createHarness();
  await offline.module.showOpenDialog({
    title: 'Select Audio Files to Process',
    filters: [{ name: 'Audio Files', extensions: ['mp3'] }]
  });
  assert.deepEqual(offline.calls[0][2].filters, [{
    name: 'Audio Files for Processing (MP3, WAV, OGG, FLAC, M4A, AAC)',
    extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac']
  }]);

  const unchangedOptions = { filters: [null, { name: 'Other', extensions: ['*'] }] };
  const unchanged = createHarness();
  await unchanged.module.showOpenDialog(unchangedOptions);
  assert.equal(unchanged.calls[0][2], unchangedOptions);

  const noFilters = createHarness();
  await noFilters.module.showOpenDialog(null);
  assert.equal(noFilters.calls[0][2], null);
});

test('openPlaybackSelection owns its CUE-aware dialog without changing generic dialog normalization', async () => {
  const harness = createHarness({ openDialogResult: { canceled: true, filePaths: [] } });

  assert.deepEqual(await harness.module.openPlaybackSelection(), { canceled: true });
  const dialogOptions = harness.calls[0][2];
  assert.equal(dialogOptions.title, 'Open Music');
  assert.deepEqual(dialogOptions.properties, ['openFile', 'multiSelections']);
  assert.deepEqual(dialogOptions.filters[0], {
    name: 'Music and CUE Files',
    extensions: ['mp3', 'wav', 'ogg', 'flac', 'opus', 'm4a', 'aac', 'webm', 'mp4', 'cue']
  });
});

test('all local playback admissions share one latest-request coordinator without extending CUE handling', async t => {
  const root = createTempDir('effetune-local-admission');
  t.after(() => fs.rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  }));
  const firstPath = path.join(root, 'first.wav');
  const latestPath = path.join(root, 'latest.wav');
  const cuePath = path.join(root, 'album.cue');
  fs.writeFileSync(firstPath, 'first');
  fs.writeFileSync(latestPath, 'latest');
  fs.writeFileSync(cuePath, 'FILE "first.wav" WAVE');
  const harness = createHarness({ openDialogResult: { canceled: true, filePaths: [] } });

  const staleAdmission = assert.rejects(
    harness.module.admitLocalPlaybackPaths([firstPath]),
    error => error?.code === 'selection-stale'
  );
  const latestDescriptors = await harness.module.admitLocalPlaybackPaths([latestPath]);
  await staleAdmission;
  assert.equal(latestDescriptors[0].path, fs.realpathSync.native(latestPath));

  const staleDialog = harness.module.openPlaybackSelection();
  await harness.module.admitLocalPlaybackPaths([latestPath]);
  assert.deepEqual(await staleDialog, { stale: true });
  await assert.rejects(
    harness.module.admitLocalPlaybackPaths([cuePath]),
    error => error?.code === 'unsupported-playback-file'
  );
});

test('main window lifecycle cancels and disposes playback ingress without blocking a replacement window', async () => {
  let resolveFirstDialog;
  let dialogCount = 0;
  const harness = createHarness({
    openDialogResult() {
      dialogCount += 1;
      if (dialogCount === 1) {
        return new Promise(resolve => {
          resolveFirstDialog = resolve;
        });
      }
      return { canceled: true, filePaths: [] };
    }
  });
  const firstWindow = new EventEmitter();
  harness.module.setMainWindow(firstWindow);

  const pendingSelection = harness.module.openPlaybackSelection();
  firstWindow.emit('close');
  resolveFirstDialog({ canceled: true, filePaths: [] });
  assert.deepEqual(await pendingSelection, { stale: true });
  firstWindow.emit('closed');

  const replacementWindow = new EventEmitter();
  harness.module.setMainWindow(replacementWindow);
  assert.deepEqual(await harness.module.openPlaybackSelection(), { canceled: true });
});

test('getUserDataPath selects portable settings beside the executable or app userData', () => {
  const portableRoot = createTempDir('effetune-portable');
  const portableSettingsPath = path.join(portableRoot, 'effetune_settings');
  fs.mkdirSync(portableSettingsPath);
  const portable = createHarness();
  withPatchedProperty(process, 'execPath', path.join(portableRoot, 'EffeTune.exe'), () => {
    portable.withElectronStub(() => {
      assert.equal(portable.module.getUserDataPath(), portableSettingsPath);
    });
  });

  const standardRoot = createTempDir('effetune-standard');
  const standard = createHarness({ userDataPath: path.join(standardRoot, 'user-data') });
  withPatchedProperty(process, 'execPath', path.join(standardRoot, 'EffeTune.exe'), () => {
    standard.withElectronStub(() => {
      assert.equal(standard.module.getUserDataPath(), path.join(standardRoot, 'user-data'));
    });
  });
});

test('file operation helpers delegate to file-utils', async () => {
  const harness = createHarness({ userDataPath: 'C:\\UserData' });

  assert.deepEqual(await harness.module.saveFile('preset.effetune_preset', 'content'), {
    success: true,
    op: 'saveFile',
    args: ['preset.effetune_preset', 'content']
  });
  assert.deepEqual(await harness.module.readFile('preset.effetune_preset'), {
    success: true,
    op: 'readFile',
    args: ['preset.effetune_preset']
  });
  assert.equal(harness.module.joinPaths('a', 'b', 'c'), path.join('a', 'b', 'c'));
  assert.equal(harness.module.fileExists('something.exists'), true);
  assert.deepEqual(await harness.withElectronStub(() => harness.module.savePipelineStateToFile([{ name: 'Volume' }])), {
    success: true,
    op: 'savePipelineStateToFile',
    args: [[{ name: 'Volume' }], 'C:\\UserData']
  });
  const emptyState = { pipelineA: [], pipelineB: null, currentPipeline: 'A' };
  assert.deepEqual(await harness.withElectronStub(() => harness.module.savePipelineStateToFile(
    emptyState,
    { allowEmpty: true }
  )), {
    success: true,
    op: 'savePipelineStateToFile',
    args: [emptyState, 'C:\\UserData', { allowEmpty: true }]
  });
});

test('processCommandLineArgs skips first launch and empty arguments', () => {
  const firstLaunch = createHarness({ isFirstLaunch: true });
  firstLaunch.module.processCommandLineArgs(['electron', 'app', 'song.wav']);
  assert.deepEqual(firstLaunch.calls, []);

  const noArgs = createHarness({ isFirstLaunch: false });
  withPatchedProperty(process, 'defaultApp', false, () => {
    noArgs.module.processCommandLineArgs(['app.exe']);
  });
  assert.deepEqual(noArgs.calls, []);
});

test('processCommandLineArgs loads the first existing preset and notifies an active renderer', () => {
  const dir = createTempDir('effetune-cli');
  const presetPath = path.join(dir, 'preset.effetune_preset');
  const laterMusicPath = path.join(dir, 'later.wav');
  fs.writeFileSync(presetPath, '{}');
  fs.writeFileSync(laterMusicPath, 'audio');
  const rendererCalls = [];
  const harness = createHarness({
    isFirstLaunch: false,
    mainWindow: {
      webContents: {
        send: (...args) => rendererCalls.push(['send', ...args]),
        executeJavaScript: script => {
          rendererCalls.push(['executeJavaScript', script]);
          return Promise.resolve();
        }
      }
    }
  });

  withPatchedProperty(process, 'defaultApp', true, () => {
    harness.module.processCommandLineArgs(['electron', 'app', presetPath, laterMusicPath]);
  });

  assert.deepEqual(harness.calls.slice(0, 4), [
    ['clearCommandLineMusicFiles'],
    ['setCommandLinePresetFile', presetPath],
    ['setSavedCommandLinePresetFile', presetPath],
    ['setShouldLoadPipelineState', false]
  ]);
  assert.equal(rendererCalls[0][0], 'send');
  assert.deepEqual(rendererCalls[0].slice(1), ['open-preset-file', presetPath]);
  assert.equal(rendererCalls[1][0], 'executeJavaScript');
  assert.equal(harness.commandLineMusicFiles.length, 0);
});

test('processCommandLineArgs logs renderer flag update failures after loading a preset', async () => {
  const dir = createTempDir('effetune-cli');
  const errorPresetPath = path.join(dir, 'error.effetune_preset');
  const stringPresetPath = path.join(dir, 'string.effetune_preset');
  fs.writeFileSync(errorPresetPath, '{}');
  fs.writeFileSync(stringPresetPath, '{}');

  const runFailureCase = async rejection => {
    const rendererCalls = [];
    const harness = createHarness({
      isFirstLaunch: false,
      mainWindow: {
        webContents: {
          send: (...args) => rendererCalls.push(['send', ...args]),
          executeJavaScript: script => {
            rendererCalls.push(['executeJavaScript', script]);
            return Promise.reject(rejection);
          }
        }
      }
    });

    await withMutedConsoleAsync('error', async () => {
      withPatchedProperty(process, 'defaultApp', true, () => {
        harness.module.processCommandLineArgs(['electron', 'app', rejection instanceof Error ? errorPresetPath : stringPresetPath]);
      });
      await Promise.resolve();
    });

    assert.equal(rendererCalls[0][0], 'send');
    assert.equal(rendererCalls[1][0], 'executeJavaScript');
  };

  await runFailureCase(new Error('renderer unavailable'));
  await runFailureCase('renderer unavailable');
});

test('processCommandLineArgs stores existing music files in packaged mode', () => {
  const dir = createTempDir('effetune-cli');
  const musicPath = path.join(dir, 'song.OPUS');
  const mp4Path = path.join(dir, 'movie.MP4');
  fs.writeFileSync(musicPath, 'audio');
  fs.writeFileSync(mp4Path, 'media');
  const harness = createHarness({ isFirstLaunch: false, mainWindow: null });

  withPatchedProperty(process, 'defaultApp', false, () => {
    harness.module.processCommandLineArgs(['app.exe', musicPath, mp4Path, path.join(dir, 'missing.wav'), 'notes.txt']);
  });

  assert.deepEqual(harness.commandLineMusicFiles, [musicPath, mp4Path]);
  assert.deepEqual(harness.savedCommandLineMusicFiles, [path.resolve(musicPath), path.resolve(mp4Path)]);
});

test('processCommandLineArgs recovers from fs errors while checking preset and music files', () => {
  const harness = createHarness({ isFirstLaunch: false });
  let calls = 0;

  withMutedConsole('error', () => {
    withPatchedProperty(fs, 'existsSync', () => {
      calls += 1;
      throw new Error('stat failed');
    }, () => {
      withPatchedProperty(process, 'defaultApp', false, () => {
        harness.module.processCommandLineArgs(['app.exe', 'preset.effetune_preset', 'song.wav']);
      });
    });
  });

  assert.equal(calls, 2);
  assert.deepEqual(harness.commandLineMusicFiles, []);
});
