import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exportPreset,
  getAudioMimeType,
  importPreset,
  openMusicFile,
  openPresetFile,
  processAudioFiles
} from '../../js/electron/presetIntegration.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const NativePromise = Promise;

async function flushPromises(times = 6) {
  for (let i = 0; i < times; i++) {
    await NativePromise.resolve();
  }
}

class FakeBlob {
  constructor(parts, options = {}) {
    this.parts = parts;
    this.type = options.type || '';
  }
}

class FakeFile {
  constructor(parts, name, options = {}) {
    this.parts = parts;
    this.name = name;
    this.type = options.type || '';
  }
}

function createUiManager(calls, options = {}) {
  const uiManager = {
    audioPlayer: options.audioPlayer,
    pipelineManager: options.pipelineManager,
    getCurrentPresetData() {
      calls.push(['getCurrentPresetData']);
      if (options.getCurrentPresetDataError) throw options.getCurrentPresetDataError;
      return options.currentPresetData;
    },
    loadPreset(preset) {
      calls.push(['loadPreset', { ...preset }]);
    },
    setError(...args) {
      calls.push(['setError', ...args]);
    },
    clearError() {
      calls.push(['clearError']);
    },
    createAudioPlayer(paths, replaceExisting) {
      calls.push(['createAudioPlayer', paths, replaceExisting]);
    }
  };
  return uiManager;
}

function createElectronApi(calls, options = {}) {
  const readQueue = [...(options.readResults ?? [])];
  return {
    async readFile(filePath, binary = false) {
      calls.push(['readFile', filePath, binary]);
      if (options.readFileError) throw options.readFileError;
      if (options.readFileImpl) return options.readFileImpl(filePath, binary);
      return readQueue.length > 0
        ? readQueue.shift()
        : { success: true, content: options.readContent ?? JSON.stringify({ pipeline: [] }) };
    },
    async showSaveDialog(optionsArg) {
      calls.push(['showSaveDialog', optionsArg]);
      if (options.showSaveDialogError) throw options.showSaveDialogError;
      return options.saveDialogResult ?? { canceled: false, filePath: 'preset.effetune_preset' };
    },
    async saveFile(filePath, content) {
      calls.push(['saveFile', filePath, content]);
      if (options.saveFileError) throw options.saveFileError;
      return options.saveResult ?? { success: true };
    },
    showOpenDialog(optionsArg) {
      calls.push(['showOpenDialog', optionsArg]);
      if (options.showOpenDialogThrows) throw options.showOpenDialogThrows;
      return options.showOpenDialogPromise ?? Promise.resolve(
        options.openDialogResult ?? { canceled: false, filePaths: ['import.effetune_preset'] }
      );
    }
  };
}

function createAudioManager(calls, options = {}) {
  return {
    workletNode: options.workletNode ?? {
      disconnect() {
        calls.push(['disconnectWorklet']);
        if (options.disconnectError) throw options.disconnectError;
      }
    },
    async rebuildPipeline(force) {
      calls.push(['rebuildPipeline', force]);
      if (options.rebuildError) throw options.rebuildError;
    }
  };
}

async function withPresetGlobals(options, callback) {
  const calls = [];
  const timeouts = [];
  const uiManager = options.uiManager === false
    ? undefined
    : createUiManager(calls, options.uiOptions);
  const windowRef = {
    uiManager,
    electronAPI: createElectronApi(calls, options.electronOptions),
    isFirstLaunch: options.isFirstLaunch,
    app: options.app,
    innerHeight: options.innerHeight ?? 1000,
    scrollY: options.scrollY ?? 20,
    scrollTo(position) {
      calls.push(['scrollTo', position]);
    },
    ...options.window
  };
  const nativeConsole = globalThis.console;

  const globals = {
    window: windowRef,
    setTimeout(fn, delay) {
      calls.push(['setTimeout', delay]);
      timeouts.push(fn);
      return timeouts.length;
    },
    console: {
      ...nativeConsole,
      error(...args) {
        calls.push(['consoleError', ...args]);
      },
      log(...args) {
        calls.push(['consoleLog', ...args]);
      }
    },
    atob(value) {
      return Buffer.from(value, 'base64').toString('binary');
    },
    Blob: FakeBlob,
    File: FakeFile
  };
  if (options.promiseGlobal) {
    globals.Promise = options.promiseGlobal;
  }

  await withGlobals(globals, async () => callback({ calls, timeouts, windowRef }));
}

test('openPresetFile rejects unavailable integration and reports validation failures', async () => {
  await withPresetGlobals({}, async () => {
    await assert.rejects(() => openPresetFile(false, 'x.effetune_preset'), /not available/);
  });

  await withPresetGlobals({ uiManager: false }, async () => {
    await assert.rejects(() => openPresetFile(true, 'x.effetune_preset'), /not available/);
  });

  await withPresetGlobals({
    window: { ORIGINAL_PIPELINE_STATE_LOADED: true }
  }, async ({ calls, timeouts, windowRef }) => {
    Object.defineProperty(windowRef, 'pipelineStateLoaded', {
      configurable: true,
      set(value) {
        throw `cannot set ${value}`;
      }
    });
    await openPresetFile(true, 'not-a-preset.txt');
    assert.equal(windowRef.ORIGINAL_PIPELINE_STATE_LOADED, false);
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error setting pipeline')));
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'Not a valid preset file'));
    timeouts[0]();
    assert.ok(calls.some(call => call[0] === 'clearError'));
  });

  await withPresetGlobals({
    electronOptions: { readResults: [{ success: false, error: 'denied' }] }
  }, async ({ calls, timeouts }) => {
    await openPresetFile(true, 'bad.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'Failed to read preset file: denied'));
    timeouts.forEach(fn => fn());
  });

  await withPresetGlobals({
    electronOptions: { readContent: '{bad json' }
  }, async ({ calls, timeouts }) => {
    await openPresetFile(true, 'bad.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'Invalid preset file format'));
    timeouts.forEach(fn => fn());
  });

  await withPresetGlobals({
    electronOptions: { readContent: JSON.stringify({ nope: true }) }
  }, async ({ calls, timeouts }) => {
    await openPresetFile(true, 'bad.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'Unknown preset format'));
    timeouts.forEach(fn => fn());
  });
});

test('openPresetFile loads old and pending preset formats with filename normalization', async () => {
  await withPresetGlobals({
    isFirstLaunch: true,
    app: { audioManager: createAudioManager([], {}) },
    electronOptions: { readContent: JSON.stringify([{ name: 'Gain' }]) }
  }, async ({ calls, timeouts, windowRef }) => {
    windowRef.app.audioManager = createAudioManager(calls, {});
    await openPresetFile(true, 'C:\\Music\\First.effetune_preset');
    assert.deepEqual(calls.find(call => call[0] === 'loadPreset')?.[1].pipeline, [{ name: 'Gain' }]);
    assert.equal(calls.find(call => call[0] === 'loadPreset')?.[1].name, 'First');
    assert.ok(calls.some(call => call[0] === 'rebuildPipeline' && call[1] === true));
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'success.presetLoaded'));
    timeouts.forEach(fn => fn());
  });

  await withPresetGlobals({
    isFirstLaunch: true,
    app: { audioManager: null },
    electronOptions: { readContent: JSON.stringify({ pipeline: [], name: 'Saved Name' }) }
  }, async ({ calls }) => {
    await openPresetFile(true, '/tmp/Named.effetune_preset');
    assert.equal(calls.find(call => call[0] === 'loadPreset')?.[1].name, 'Named');
  });

  await withPresetGlobals({
    electronOptions: { readContent: JSON.stringify({ pipeline: [] }) }
  }, async ({ windowRef }) => {
    await openPresetFile(true, '/tmp/Pending.effetune_preset');
    assert.equal(windowRef.pendingPresetFilePath, '/tmp/Pending.effetune_preset');
  });

  await withPresetGlobals({
    isFirstLaunch: true,
    app: { audioManager: null },
    electronOptions: { readContent: JSON.stringify({ pipeline: [] }) }
  }, async ({ calls, windowRef }) => {
    windowRef.app.audioManager = createAudioManager(calls, { rebuildError: new Error('rebuild failed') });
    await openPresetFile(true, '/tmp/Rebuild.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error rebuilding audio pipeline')));
  });
});

test('openPresetFile handles initialized apps with and without audio-player preservation', async () => {
  await withPresetGlobals({
    app: { audioManager: null },
    uiOptions: {
      audioPlayer: {
        contextManager: {
          connectToAudioContext() {}
        }
      }
    },
    electronOptions: { readContent: JSON.stringify({ pipeline: [] }) }
  }, async ({ calls, windowRef }) => {
    windowRef.uiManager.audioPlayer.contextManager.connectToAudioContext = () => calls.push(['connectToAudioContext']);
    windowRef.app.audioManager = createAudioManager(calls, {});
    await openPresetFile(true, '/tmp/Active.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'disconnectWorklet'));
    assert.ok(calls.some(call => call[0] === 'connectToAudioContext'));
  });

  await withPresetGlobals({
    app: { audioManager: null },
    uiOptions: { audioPlayer: { contextManager: null } },
    electronOptions: { readContent: JSON.stringify({ pipeline: [] }) }
  }, async ({ calls, windowRef }) => {
    windowRef.app.audioManager = createAudioManager(calls, {
      disconnectError: new Error('disconnect failed')
    });
    await openPresetFile(true, '/tmp/NoReconnect.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'rebuildPipeline'));
  });

  await withPresetGlobals({
    app: { audioManager: null },
    uiOptions: {
      audioPlayer: {
        contextManager: {
          connectToAudioContext() {
            throw new Error('reconnect failed');
          }
        }
      }
    },
    electronOptions: { readContent: JSON.stringify({ pipeline: [] }) }
  }, async ({ calls, windowRef }) => {
    windowRef.app.audioManager = createAudioManager(calls, {});
    await openPresetFile(true, '/tmp/ReconnectError.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error reconnecting')));
  });

  await withPresetGlobals({
    app: { audioManager: null },
    electronOptions: { readContent: JSON.stringify({ pipeline: [] }) }
  }, async ({ calls, windowRef }) => {
    windowRef.app.audioManager = createAudioManager(calls, {});
    await openPresetFile(true, '/tmp/NoPlayer.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'rebuildPipeline'));
  });

  await withPresetGlobals({
    app: { audioManager: null },
    electronOptions: { readContent: JSON.stringify({ pipeline: [] }) }
  }, async ({ calls, windowRef }) => {
    windowRef.app.audioManager = createAudioManager(calls, { rebuildError: new Error('boom') });
    await openPresetFile(true, '/tmp/RebuildError.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error rebuilding audio pipeline')));
  });

  await withPresetGlobals({
    app: { audioManager: null },
    uiOptions: { audioPlayer: { contextManager: null } },
    electronOptions: { readContent: JSON.stringify({ pipeline: [] }) }
  }, async ({ calls, windowRef }) => {
    windowRef.app.audioManager = createAudioManager(calls, { rebuildError: new Error('audio player rebuild failed') });
    await openPresetFile(true, '/tmp/AudioPlayerRebuildError.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('with audio player')));
  });

  await withPresetGlobals({
    app: { audioManager: null },
    electronOptions: { readContent: JSON.stringify({ pipeline: [] }) }
  }, async ({ calls, windowRef }) => {
    windowRef.app.audioManager = createAudioManager(calls, { disconnectError: new Error('no-player disconnect failed') });
    await openPresetFile(true, '/tmp/NoPlayerDisconnectError.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'rebuildPipeline'));
  });
});

test('openPresetFile reports read exceptions through the outer catch', async () => {
  await withPresetGlobals({
    electronOptions: { readFileError: new Error('read exploded') }
  }, async ({ calls, timeouts }) => {
    await assert.rejects(() => openPresetFile(true, '/tmp/Error.effetune_preset'), /read exploded/);
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('read exploded')));
    timeouts.forEach(fn => fn());
  });
});

test('exportPreset handles guards, dialogs, saves, and errors', async () => {
  await withPresetGlobals({}, async () => {
    assert.equal(await exportPreset(false), undefined);
  });
  await withPresetGlobals({ uiManager: false }, async () => {
    assert.equal(await exportPreset(true), undefined);
  });

  await withPresetGlobals({
    uiOptions: { currentPresetData: null }
  }, async ({ calls }) => {
    await exportPreset(true);
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('No preset data')));
  });

  await withPresetGlobals({
    uiOptions: { currentPresetData: { name: 'Current', pipeline: [{ name: 'A' }] } },
    electronOptions: { saveDialogResult: { canceled: true } }
  }, async ({ calls }) => {
    await exportPreset(true);
    assert.equal(calls.some(call => call[0] === 'saveFile'), false);
  });

  await withPresetGlobals({
    uiOptions: { currentPresetData: { pipeline: [] } },
    electronOptions: {
      saveDialogResult: { canceled: false, filePath: 'out.effetune_preset' },
      saveResult: { success: false, error: 'disk full' }
    }
  }, async ({ calls }) => {
    await exportPreset(true);
    const saveCall = calls.find(call => call[0] === 'saveFile');
    assert.equal(JSON.parse(saveCall[2]).name, undefined);
    assert.equal(calls.find(call => call[0] === 'showSaveDialog')[1].defaultPath, 'preset.effetune_preset');
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Failed to save preset')));
  });

  await withPresetGlobals({
    uiOptions: { currentPresetData: { name: 'Explode', pipeline: [] } },
    electronOptions: { showSaveDialogError: new Error('dialog failed') }
  }, async ({ calls }) => {
    await exportPreset(true);
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error exporting preset')));
  });
});

test('importPreset handles dialogs, reads, formats, and parse errors', async () => {
  await withPresetGlobals({}, async () => {
    assert.equal(await importPreset(false), undefined);
  });
  await withPresetGlobals({ uiManager: false }, async () => {
    assert.equal(await importPreset(true), undefined);
  });

  await withPresetGlobals({
    electronOptions: { openDialogResult: { canceled: true, filePaths: ['x'] } }
  }, async ({ calls }) => {
    await importPreset(true);
    assert.equal(calls.some(call => call[0] === 'readFile'), false);
  });

  await withPresetGlobals({
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: [] }
    }
  }, async ({ calls }) => {
    await importPreset(true);
    assert.equal(calls.some(call => call[0] === 'readFile'), false);
  });

  await withPresetGlobals({
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: ['bad.effetune_preset'] },
      readResults: [{ success: false, error: 'missing' }]
    }
  }, async ({ calls }) => {
    await importPreset(true);
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Failed to read preset')));
  });

  await withPresetGlobals({
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: ['C:\\Presets\\Imported.effetune_preset'] },
      readContent: JSON.stringify([{ name: 'Plugin' }])
    }
  }, async ({ calls, timeouts }) => {
    await importPreset(true);
    assert.equal(calls.find(call => call[0] === 'loadPreset')?.[1].name, 'Imported');
    timeouts[0]();
    assert.ok(calls.some(call => call[0] === 'clearError'));
  });

  await withPresetGlobals({
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: ['/tmp/New.effetune_preset'] },
      readContent: JSON.stringify({ pipeline: [], name: 'Object Name' })
    }
  }, async ({ calls }) => {
    await importPreset(true);
    assert.equal(calls.find(call => call[0] === 'loadPreset')?.[1].name, 'New');
  });

  await withPresetGlobals({
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: ['/tmp/DefaultName.effetune_preset'] },
      readContent: JSON.stringify({ pipeline: [] })
    }
  }, async ({ calls }) => {
    await importPreset(true);
    assert.equal(calls.find(call => call[0] === 'loadPreset')?.[1].name, 'DefaultName');
  });

  await withPresetGlobals({
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: ['/tmp/Unknown.effetune_preset'] },
      readContent: JSON.stringify({ nope: true })
    }
  }, async ({ calls }) => {
    await importPreset(true);
    assert.ok(calls.some(call => call[0] === 'consoleError' && call[1] === 'Unknown preset format'));
  });

  await withPresetGlobals({
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: ['/tmp/Broken.effetune_preset'] },
      readContent: '{bad'
    }
  }, async ({ calls }) => {
    await importPreset(true);
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Error importing preset')));
  });

  await withPresetGlobals({
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: ['plain'] },
      readContent: JSON.stringify({ pipeline: [] })
    }
  }, async ({ calls }) => {
    await importPreset(true);
    assert.equal(calls.find(call => call[0] === 'loadPreset')?.[1].name, 'plain');
  });

  await withPresetGlobals({
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: [''] },
      readContent: JSON.stringify({ pipeline: [] })
    }
  }, async ({ calls }) => {
    await importPreset(true);
    assert.equal(calls.find(call => call[0] === 'loadPreset')?.[1].name, '');
  });
});

test('openMusicFile opens selected files and reports cancellation or errors', async () => {
  await withPresetGlobals({}, async () => {
    assert.equal(await openMusicFile(false), undefined);
  });

  await withPresetGlobals({
    electronOptions: { openDialogResult: { canceled: true, filePaths: ['x.mp3'] } }
  }, async ({ calls }) => {
    await openMusicFile(true);
    assert.ok(calls.some(call => call[0] === 'consoleLog'));
  });

  await withPresetGlobals({
    electronOptions: { openDialogResult: { canceled: false, filePaths: ['a.mp3', 'b.wav'] } }
  }, async ({ calls }) => {
    await openMusicFile(true);
    assert.deepEqual(calls.find(call => call[0] === 'createAudioPlayer'), ['createAudioPlayer', ['a.mp3', 'b.wav'], false]);
    assert.equal(calls.find(call => call[0] === 'showOpenDialog')[1].filters[0].extensions.includes('mp4'), true);
  });

  await withPresetGlobals({
    uiManager: false,
    electronOptions: { openDialogResult: { canceled: false, filePaths: ['a.mp3'] } }
  }, async ({ calls }) => {
    await openMusicFile(true);
    assert.equal(calls.some(call => call[0] === 'createAudioPlayer'), false);
  });

  await withPresetGlobals({
    electronOptions: { showOpenDialogThrows: new Error('dialog exploded') }
  }, async ({ calls }) => {
    await openMusicFile(true);
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('dialog exploded')));
  });
});

test('processAudioFiles validates dialog and pipeline prerequisites', async () => {
  await withPresetGlobals({}, async () => {
    assert.equal(processAudioFiles(false), undefined);
  });

  await withPresetGlobals({
    electronOptions: { openDialogResult: { canceled: true, filePaths: ['a.wav'] } }
  }, async ({ calls }) => {
    processAudioFiles(true);
    await flushPromises();
    assert.ok(calls.some(call => call[0] === 'consoleLog'));
  });

  await withPresetGlobals({
    uiManager: false,
    electronOptions: { openDialogResult: { canceled: false, filePaths: ['a.wav'] } }
  }, async ({ calls }) => {
    processAudioFiles(true);
    await flushPromises();
    assert.ok(calls.some(call => call[0] === 'consoleError' && String(call[1]).includes('Could not find pipeline manager')));
  });

  await withPresetGlobals({
    uiOptions: {},
    electronOptions: { openDialogResult: { canceled: false, filePaths: ['a.wav'] } }
  }, async ({ calls }) => {
    processAudioFiles(true);
    await flushPromises();
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('Pipeline manager not found')));
  });

  await withPresetGlobals({
    uiOptions: { pipelineManager: { fileProcessor: null } },
    electronOptions: { openDialogResult: { canceled: false, filePaths: ['a.wav'] } }
  }, async ({ calls }) => {
    processAudioFiles(true);
    await flushPromises();
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('Drop area not found')));
  });
});

test('processAudioFiles converts valid files, handles invalid files, and reports async errors', async () => {
  const dropArea = {
    getBoundingClientRect() {
      return { top: 500 };
    }
  };
  const pipelineManager = {
    fileProcessor: { dropArea },
    processDroppedAudioFiles(files) {
      files.forEach(file => assert.ok(file instanceof FakeFile));
    }
  };

  await withPresetGlobals({
    uiOptions: { pipelineManager },
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: ['C:\\Audio\\a.wav', 'bad.mp3'] },
      readFileImpl(filePath) {
        if (filePath === 'bad.mp3') return { success: false, error: 'bad file' };
        return { success: true, content: Buffer.from('abc').toString('base64') };
      }
    }
  }, async ({ calls, timeouts, windowRef }) => {
    windowRef.uiManager.pipelineManager.processDroppedAudioFiles = files => {
      calls.push(['processDroppedAudioFiles', files.map(file => [file.name, file.type])]);
    };
    processAudioFiles(true);
    await flushPromises();
    assert.deepEqual(calls.find(call => call[0] === 'scrollTo'), ['scrollTo', { top: 220, behavior: 'smooth' }]);
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('bad file')));
    timeouts[0]();
    assert.deepEqual(calls.find(call => call[0] === 'processDroppedAudioFiles'), [
      'processDroppedAudioFiles',
      [['a.wav', 'audio/wav']]
    ]);
  });

  await withPresetGlobals({
    uiOptions: { pipelineManager },
    electronOptions: {
      openDialogResult: { canceled: false, filePaths: ['bad.flac'] },
      readResults: [{ success: false, error: 'unreadable' }]
    }
  }, async ({ calls }) => {
    processAudioFiles(true);
    await flushPromises();
    assert.ok(calls.some(call => call[0] === 'setError' && call[1] === 'No valid audio files selected'));
  });

  await withPresetGlobals({
    uiOptions: { pipelineManager },
    electronOptions: { showOpenDialogPromise: Promise.reject(new Error('dialog rejected')) }
  }, async ({ calls }) => {
    processAudioFiles(true);
    await flushPromises();
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('dialog rejected')));
  });

  await withPresetGlobals({
    electronOptions: { showOpenDialogThrows: new Error('sync dialog failure') }
  }, async ({ calls }) => {
    processAudioFiles(true);
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('sync dialog failure')));
  });

  await withPresetGlobals({
    uiOptions: { pipelineManager },
    electronOptions: {
      showOpenDialogPromise: NativePromise.resolve({ canceled: false, filePaths: ['a.wav'] })
    },
    promiseGlobal: {
      all() {
        return NativePromise.reject(new Error('prepare failed'));
      }
    }
  }, async ({ calls }) => {
    processAudioFiles(true);
    await flushPromises();
    assert.ok(calls.some(call => call[0] === 'setError' && String(call[1]).includes('prepare failed')));
  });
});

test('getAudioMimeType maps supported extensions and defaults safely', () => {
  assert.equal(getAudioMimeType('track.mp3'), 'audio/mpeg');
  assert.equal(getAudioMimeType('track.wav'), 'audio/wav');
  assert.equal(getAudioMimeType('track.ogg'), 'audio/ogg');
  assert.equal(getAudioMimeType('track.flac'), 'audio/flac');
  assert.equal(getAudioMimeType('track.opus'), 'audio/opus');
  assert.equal(getAudioMimeType('track.m4a'), 'audio/mp4');
  assert.equal(getAudioMimeType('track.aac'), 'audio/aac');
  assert.equal(getAudioMimeType('track.webm'), 'audio/webm');
  assert.equal(getAudioMimeType('track.unknown'), 'audio/mpeg');
});
