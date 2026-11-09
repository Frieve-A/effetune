'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  canPersistAudioPreferencesWithoutReload,
  isPlayerPreferenceOnlyChange
} = require('../../electron/audio-preferences-policy.cjs');
const {
  loadFreshModule,
  withModuleLoadStub,
  withPatchedPropertyAsync
} = require('../helpers/cjs-module-utils.cjs');

const noInput = '__effetune_no_audio_input__';

test('MIDI-device-only IPC preserves audio preferences and never reloads, including rejected mixed changes', async () => {
  const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-midi-preferences-')));
  const preferencesPath = path.join(tempRoot, 'audio-preferences.json');
  const messages = [], timers = [];
  const mainWindow = { webContents: { send: (...args) => messages.push(args) }, reload() { assert.fail('reload'); } };
  try {
    await fs.writeFile(preferencesPath, JSON.stringify({ inputDeviceId: 'mic', sampleRate: 48000 }));
    const handlers = registerAudioPreferencesHandlers(tempRoot, mainWindow);
    const save = handlers.get('save-audio-preferences');
    await withPatchedPropertyAsync(global, 'setTimeout', (...args) => timers.push(args), async () => {
      assert.deepEqual(await save(null, { midiInputDeviceKey: 'Virtual\0' + '2' }, { applyInPlace: 'midi-devices' }), { success: true });
      assert.deepEqual(await save(null, { midiOutputDeviceKey: 'Synth' }, { applyInPlace: 'midi-devices' }), { success: true });
      const stored = JSON.parse(await fs.readFile(preferencesPath, 'utf8'));
      assert.equal(stored.midiInputDeviceKey, 'Virtual\0' + '2');
      assert.equal(stored.midiOutputDeviceKey, 'Synth');
      assert.equal(stored.inputDeviceId, 'mic');
      assert.equal(stored.sampleRate, 48000);
      assert.equal((await save(null, { midiInputDeviceKey: '', sampleRate: 96000 }, { applyInPlace: 'midi-devices' })).success, false);
      assert.deepEqual(JSON.parse(await fs.readFile(preferencesPath, 'utf8')), stored);
      assert.deepEqual(await save(null, { midiInputDeviceKey: '', midiOutputDeviceKey: '' }, { applyInPlace: 'midi-devices' }), { success: true });
      const cleared = (await handlers.get('load-audio-preferences')()).preferences;
      assert.equal(cleared.midiInputDeviceKey, '');
      assert.equal(cleared.midiOutputDeviceKey, '');
      assert.deepEqual(messages, []);
      assert.deepEqual(timers, []);
    });
  } finally { await fs.rm(tempRoot, { recursive: true, force: true }); }
});

test('Electron accepts reload suppression only for a player-only change', () => {
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
    { applyInPlace: 'player-preferences' },
    noInput
  ), true);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, replayGainMode: 'track', replayGainPreampDb: 1.5, replayGainPreventClipping: false },
    { applyInPlace: 'player-preferences' },
    noInput
  ), true);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, sampleRate: 96000, gaplessPlayback: false },
    { applyInPlace: 'player-preferences' },
    noInput
  ), false);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, gaplessPlayback: false },
    { applyInPlace: 'unrecognized' },
    noInput
  ), false);
});

test('Electron applies MIDI device changes in place only when nothing else changes', () => {
  const previous = { inputDeviceId: 'mic-1', sampleRate: 48000, midiInputDeviceKey: 'In', midiOutputDeviceKey: '' };
  const canPersist = next => canPersistAudioPreferencesWithoutReload(
    previous, { ...previous, ...next }, { applyInPlace: 'midi-devices' }, noInput);
  assert.equal(canPersist({ midiOutputDeviceKey: 'Synth' }), true);
  assert.equal(canPersist({ midiInputDeviceKey: '', midiOutputDeviceKey: 'Synth' }), true);
  assert.equal(canPersist({}), false);
  assert.equal(canPersist({ midiOutputDeviceKey: 'Synth', sampleRate: 96000 }), false);
});

test('Electron ignores device label differences while the device IDs are unchanged', () => {
  const previous = {
    inputDeviceId: 'mic-1',
    outputDeviceId: 'speaker-1',
    inputDeviceLabel: 'Microphone (no permission)',
    outputDeviceLabel: 'Desk speakers',
    gaplessPlayback: true
  };
  assert.equal(isPlayerPreferenceOnlyChange(previous, {
    ...previous,
    inputDeviceLabel: 'Mic One',
    outputDeviceLabel: 'Desk speakers (2)',
    gaplessPlayback: false
  }), true);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, inputDeviceLabel: 'Mic One', gaplessPlayback: false },
    { applyInPlace: 'player-preferences' },
    noInput
  ), true);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, inputDeviceLabel: 'Mic One' },
    { applyInPlace: 'player-preferences' },
    noInput
  ), false);
  assert.equal(canPersistAudioPreferencesWithoutReload(
    previous,
    { ...previous, outputDeviceId: 'speaker-2', gaplessPlayback: false },
    { applyInPlace: 'player-preferences' },
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

test('registered Electron IPC defaults missing input selections to None and preserves saved choices', async () => {
  const tempRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-ipc-audio-preferences-')));
  const preferencesPath = path.join(tempRoot, 'audio-preferences.json');

  try {
    const load = registerAudioPreferencesHandlers(tempRoot, null).get('load-audio-preferences');
    for (const inputDeviceId of [undefined, 'default', 'mic-1', noInput]) {
      const stored = { inputDeviceId, sampleRate: 48000 };
      await fs.writeFile(preferencesPath, JSON.stringify(stored));
      const result = await load();
      assert.equal(result.success, true);
      assert.equal(result.preferences.inputDeviceId, inputDeviceId ?? noInput);
      assert.equal(result.preferences.sampleRate, 48000);
    }
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test('registered Electron IPC persists canonical player changes without reload', async () => {
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
        applyInPlace: 'player-preferences'
      }), { success: true });
      assert.deepEqual(messages, []);
      assert.deepEqual(timers, []);

      const savedGaplessPreferences = JSON.parse(await fs.readFile(preferencesPath, 'utf8'));
      assert.equal(savedGaplessPreferences.sampleRate, 96000);
      assert.equal(savedGaplessPreferences.useWasmDsp, false);
      assert.equal(savedGaplessPreferences.customPreference, 'preserved');
      assert.equal(savedGaplessPreferences.gaplessPlayback, false);
      assert.equal((await load()).preferences.gaplessPlayback, false);
      assert.equal(savedGaplessPreferences.replayGainMode, 'off');

      assert.deepEqual(await save(null, { replayGainMode: 'album', replayGainPreampDb: 3 }, {
        applyInPlace: 'player-preferences'
      }), { success: true });
      const savedReplayGain = (await load()).preferences;
      assert.equal(savedReplayGain.replayGainMode, 'album');
      assert.equal(savedReplayGain.replayGainPreampDb, 3);
      assert.equal(savedReplayGain.sampleRate, 96000);
      assert.deepEqual(await save(null, { replayGainMode: 'off', replayGainPreampDb: 0 }, {
        applyInPlace: 'player-preferences'
      }), { success: true });

      const rejected = await save(null, { sampleRate: 48000 }, {
        applyInPlace: 'player-preferences'
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

test('registered Electron IPC keeps a drifted renderer mirror out of the stored player change', async () => {
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
    midiInputDeviceKey: '',
    midiOutputDeviceKey: '',
    inputDeviceId: 'mic-1',
    outputDeviceId: 'speaker-1',
    inputDeviceLabel: 'Microphone (no permission)',
    outputDeviceLabel: 'Desk speakers',
    sampleRate: 96000,
    useInputWithPlayer: true,
    useWasmDsp: true,
    gaplessPlayback: true,
    replayGainMode: 'off',
    replayGainPreampDb: 0,
    replayGainPreventClipping: true,
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
      // The player-only apply path sends the player fields alone.
      assert.deepEqual(await save(null, { gaplessPlayback: false }, {
        applyInPlace: 'player-preferences'
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
      }, { applyInPlace: 'player-preferences' });
      assert.equal(drifted.success, false);
      assert.deepEqual(messages, []);
      assert.deepEqual(timers, []);
      assert.equal(mainWindow.reloadCalls, 0);
      assert.deepEqual(
        JSON.parse(await fs.readFile(preferencesPath, 'utf8')),
        { ...storedPreferences, gaplessPlayback: false }
      );

      // Refreshed device labels alone do not block the in-place save, and only
      // the player fields are stored.
      assert.deepEqual(await save(null, {
        ...storedPreferences,
        inputDeviceLabel: 'Mic One',
        gaplessPlayback: true
      }, { applyInPlace: 'player-preferences' }), { success: true });
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
