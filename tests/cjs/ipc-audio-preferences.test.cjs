'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  canPersistAudioPreferencesWithoutReload,
  isGaplessPlaybackOnlyChange
} = require('../../electron/audio-preferences-policy.cjs');
const {
  loadFreshModule,
  withModuleLoadStub,
  withPatchedPropertyAsync
} = require('../helpers/cjs-module-utils.cjs');

const noInput = '__effetune_no_audio_input__';

test('Electron accepts reload suppression only for a gapless-only change', () => {
  const previous = {
    inputDeviceId: 'default',
    outputDeviceId: 'default',
    sampleRate: 48000,
    outputChannels: 2,
    gaplessPlayback: true
  };
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, gaplessPlayback: false },
    { applyInPlace: 'gapless-playback' },
    noInput
  ), true);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, sampleRate: 96000, gaplessPlayback: false },
    { applyInPlace: 'gapless-playback' },
    noInput
  ), false);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, gaplessPlayback: false },
    { applyInPlace: 'unrecognized' },
    noInput
  ), false);
});

test('Electron ignores device label differences while the device IDs are unchanged', () => {
  const previous = {
    inputDeviceId: 'mic-1',
    outputDeviceId: 'speaker-1',
    inputDeviceLabel: 'Microphone (no permission)',
    outputDeviceLabel: 'Desk speakers',
    gaplessPlayback: true
  };
  assert.equal(isGaplessPlaybackOnlyChange(previous, {
    ...previous,
    inputDeviceLabel: 'Mic One',
    outputDeviceLabel: 'Desk speakers (2)',
    gaplessPlayback: false
  }), true);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, inputDeviceLabel: 'Mic One', gaplessPlayback: false },
    { applyInPlace: 'gapless-playback' },
    noInput
  ), true);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, inputDeviceLabel: 'Mic One' },
    { applyInPlace: 'gapless-playback' },
    noInput
  ), false);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, outputDeviceId: 'speaker-2', gaplessPlayback: false },
    { applyInPlace: 'gapless-playback' },
    noInput
  ), false);
});

test('Electron keeps the existing silent-input in-place policy', () => {
  const previous = { inputDeviceId: 'default', sampleRate: 96000 };
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, inputDeviceId: noInput },
    { applyInPlace: 'silent-input' },
    noInput
  ), true);
});

function registerAudioPreferencesHandlers(userDataPath, mainWindow) {
  const handlers = new Map();
  const electron = {
    app: {},
    ipcMain: {
      handle(name, handler) {
        handlers.set(name, handler);
      },
      on() {
        // The registration test exercises only ipcMain.handle handlers.
      }
    },
    shell: {},
    systemPreferences: {},
    Menu: {},
    clipboard: {}
  };
  withModuleLoadStub({
    electron,
    './constants': { getMainWindow: () => mainWindow },
    './config': {},
    './window-state': {},
    './clipboard-ipc': { registerClipboardIpcHandlers() {} },
    './ir-library-ipc': { registerIrLibraryIpc() {} },
    './bounded-file-reader': { readFileBytes() {} },
    './file-handlers': { getUserDataPath: () => userDataPath }
  }, () => {
    const ipcHandlers = loadFreshModule('../../electron/ipc-handlers.js');
    ipcHandlers.registerIpcHandlers();
  });
  return handlers;
}

test('registered Electron IPC persists canonical gapless changes without reload', async () => {
  const rawTempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-ipc-audio-preferences-'));
  const tempRoot = await fs.realpath(rawTempRoot);
  const preferencesPath = path.join(tempRoot, 'audio-preferences.json');
  const messages = [];
  const mainWindow = {
    webContents: { send: (...args) => messages.push(args) },
    reloadCalls: 0,
    reload() {
      this.reloadCalls += 1;
    }
  };
  const timers = [];

  try {
    await fs.writeFile(preferencesPath, JSON.stringify({
      sampleRate: 96000,
      useWasmDsp: false,
      customPreference: 'preserved'
    }));
    const handlers = registerAudioPreferencesHandlers(tempRoot, mainWindow);
    const save = handlers.get('save-audio-preferences');
    const load = handlers.get('load-audio-preferences');
    assert.equal(typeof save, 'function');
    assert.equal(typeof load, 'function');
    const legacyPreferences = (await load()).preferences;
    assert.equal(legacyPreferences.sampleRate, 96000);
    assert.equal(legacyPreferences.useWasmDsp, false);
    assert.equal(legacyPreferences.gaplessPlayback, true);

    await withPatchedPropertyAsync(global, 'setTimeout', (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    }, async () => {
      assert.deepEqual(await save(null, { gaplessPlayback: false }, {
        applyInPlace: 'gapless-playback'
      }), { success: true });
      assert.deepEqual(messages, []);
      assert.deepEqual(timers, []);

      const savedGaplessPreferences = JSON.parse(await fs.readFile(preferencesPath, 'utf8'));
      assert.equal(savedGaplessPreferences.sampleRate, 96000);
      assert.equal(savedGaplessPreferences.useWasmDsp, false);
      assert.equal(savedGaplessPreferences.customPreference, 'preserved');
      assert.equal(savedGaplessPreferences.gaplessPlayback, false);
      assert.equal((await load()).preferences.gaplessPlayback, false);

      const rejected = await save(null, { sampleRate: 48000 }, {
        applyInPlace: 'gapless-playback'
      });
      assert.equal(rejected.success, false);
      assert.equal(typeof rejected.error, 'string');
      assert.deepEqual(messages, []);
      assert.deepEqual(timers, []);
      assert.equal(mainWindow.reloadCalls, 0);
      assert.deepEqual(
        JSON.parse(await fs.readFile(preferencesPath, 'utf8')),
        savedGaplessPreferences
      );
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('registered Electron IPC keeps a drifted renderer mirror out of the stored gapless change', async () => {
  const rawTempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-ipc-audio-preferences-'));
  const tempRoot = await fs.realpath(rawTempRoot);
  const preferencesPath = path.join(tempRoot, 'audio-preferences.json');
  const messages = [];
  const mainWindow = {
    webContents: { send: (...args) => messages.push(args) },
    reloadCalls: 0,
    reload() {
      this.reloadCalls += 1;
    }
  };
  const timers = [];
  // Stored preferences keep the live input enabled while the renderer mirror
  // was switched to player-only for this session (command-line music files).
  const storedPreferences = {
    inputDeviceId: 'mic-1',
    outputDeviceId: 'speaker-1',
    inputDeviceLabel: 'Microphone (no permission)',
    outputDeviceLabel: 'Desk speakers',
    sampleRate: 96000,
    useInputWithPlayer: true,
    lowLatencyOutput: false,
    useWasmDsp: true,
    gaplessPlayback: true,
    outputChannels: 2,
    latencyHint: 'interactive'
  };

  try {
    await fs.writeFile(preferencesPath, JSON.stringify(storedPreferences));
    const handlers = registerAudioPreferencesHandlers(tempRoot, mainWindow);
    const save = handlers.get('save-audio-preferences');

    await withPatchedPropertyAsync(global, 'setTimeout', (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    }, async () => {
      // The gapless-only apply path sends the playback field alone.
      assert.deepEqual(await save(null, { gaplessPlayback: false }, {
        applyInPlace: 'gapless-playback'
      }), { success: true });
      assert.deepEqual(messages, []);
      assert.deepEqual(timers, []);
      assert.equal(mainWindow.reloadCalls, 0);
      assert.deepEqual(
        JSON.parse(await fs.readFile(preferencesPath, 'utf8')),
        { ...storedPreferences, gaplessPlayback: false }
      );

      // A full mirror snapshot that drifted from the stored file is refused
      // without touching the file and without scheduling a reload.
      const drifted = await save(null, {
        ...storedPreferences,
        useInputWithPlayer: false,
        inputDeviceLabel: 'Mic One',
        gaplessPlayback: true
      }, { applyInPlace: 'gapless-playback' });
      assert.equal(drifted.success, false);
      assert.deepEqual(messages, []);
      assert.deepEqual(timers, []);
      assert.equal(mainWindow.reloadCalls, 0);
      assert.deepEqual(
        JSON.parse(await fs.readFile(preferencesPath, 'utf8')),
        { ...storedPreferences, gaplessPlayback: false }
      );

      // Refreshed device labels alone do not block the in-place save, and only
      // the playback field is stored.
      assert.deepEqual(await save(null, {
        ...storedPreferences,
        inputDeviceLabel: 'Mic One',
        gaplessPlayback: true
      }, { applyInPlace: 'gapless-playback' }), { success: true });
      assert.deepEqual(messages, []);
      assert.deepEqual(timers, []);
      assert.equal(mainWindow.reloadCalls, 0);
      assert.deepEqual(
        JSON.parse(await fs.readFile(preferencesPath, 'utf8')),
        storedPreferences
      );
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
