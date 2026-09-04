import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioManager } from '../../js/audio-manager.js';
import { AudioPlayer } from '../../js/ui/audio-player.js';
import { AudioContextManager } from '../../js/ui/audio-player/audio-context-manager.js';
import { isGaplessPlaybackOnlyChange } from '../../js/electron/audioIntegration.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('gapless-only comparison ignores only the normalized playback preference', () => {
  const previous = { sampleRate: 48000, gaplessPlayback: true };
  assert.equal(isGaplessPlaybackOnlyChange(previous, {
    sampleRate: 48000, gaplessPlayback: false
  }), true);
  assert.equal(isGaplessPlaybackOnlyChange(previous, {
    sampleRate: 96000, gaplessPlayback: false
  }), false);
  assert.equal(isGaplessPlaybackOnlyChange({}, { gaplessPlayback: false }), true);
  assert.equal(isGaplessPlaybackOnlyChange(null, { gaplessPlayback: false }), true);
  assert.equal(isGaplessPlaybackOnlyChange(undefined, { gaplessPlayback: false }), true);
  assert.equal(isGaplessPlaybackOnlyChange({ sampleRate: 96000 }, {
    gaplessPlayback: false
  }), true);
  assert.equal(isGaplessPlaybackOnlyChange({}, {
    sampleRate: 48000,
    gaplessPlayback: false
  }), false);
});

test('gapless-only comparison ignores device labels while the device IDs are unchanged', () => {
  const previous = {
    inputDeviceId: 'mic1',
    outputDeviceId: 'out1',
    inputDeviceLabel: 'Microphone (no permission)',
    outputDeviceLabel: 'Out One',
    gaplessPlayback: true
  };
  assert.equal(isGaplessPlaybackOnlyChange(previous, {
    ...previous,
    inputDeviceLabel: 'Mic One',
    outputDeviceLabel: 'Out One (renamed)',
    gaplessPlayback: false
  }), true);
  assert.equal(isGaplessPlaybackOnlyChange(previous, {
    ...previous,
    inputDeviceLabel: 'Mic One',
    outputDeviceLabel: 'Out One (renamed)'
  }), false);
  assert.equal(isGaplessPlaybackOnlyChange(previous, {
    ...previous,
    inputDeviceId: 'mic2',
    inputDeviceLabel: 'Mic Two',
    gaplessPlayback: false
  }), false);
  assert.equal(isGaplessPlaybackOnlyChange(previous, {
    ...previous,
    outputDeviceId: 'out2',
    gaplessPlayback: false
  }), false);
});

test('AudioPlayer publishes one normalized preference operation', async () => {
  const calls = [];
  const player = {
    gaplessPlayback: true,
    stateManager: { updateState: (...args) => calls.push(['state', ...args]) },
    playbackManager: { seamlessMode: true },
    contextManager: {
      async applyGaplessPlaybackPreference(enabled) {
        calls.push(['context', enabled]);
        return true;
      }
    }
  };
  assert.equal(await AudioPlayer.prototype.applyGaplessPlaybackPreference.call(player, false), true);
  assert.equal(player.gaplessPlayback, false);
  assert.equal(player.playbackManager.seamlessMode, false);
  assert.deepEqual(calls.map(call => call[0]), ['context', 'state']);
});

test('turning gapless playback off invalidates prepared next before cleanup', async () => {
  const calls = [];
  const transport = {
    async dispose() { calls.push('dispose'); }
  };
  const manager = {
    audioPlayer: { gaplessPlayback: true },
    nextRollingTransport: { transport },
    clearNextTrackBuffer() {
      calls.push('invalidate');
      this.nextRollingTransport = null;
      return transport.dispose();
    },
    getCurrentState() {
      return { isPlaying: true, isTransitioning: false };
    },
    hasPendingRollingCleanup: AudioContextManager.prototype.hasPendingRollingCleanup,
    isGaplessPlaybackEnabled: AudioContextManager.prototype.isGaplessPlaybackEnabled,
    prepareNextTrackBufferWithRepeatMode() {
      calls.push('prepare');
    }
  };
  await AudioContextManager.prototype.applyGaplessPlaybackPreference.call(manager, false);
  assert.deepEqual(calls, ['invalidate', 'dispose']);
  assert.equal(manager.audioPlayer.gaplessPlayback, false);
});

test('rolling pause registers seek cleanup without waiting for candidate disposal', async () => {
  const events = [];
  let finishCandidateDisposal;
  const candidateDisposal = new Promise(resolve => {
    finishCandidateDisposal = resolve;
  });
  const transport = {
    pendingSeek: { candidate: {} },
    currentTime: 12,
    supersedePendingSeek() {
      events.push('supersede');
      this.pendingSeek = null;
      return candidateDisposal.then(() => events.push('disposed'));
    },
    async pause() {
      events.push('pause');
    }
  };
  const manager = {
    rollingTransport: transport,
    rollingSeekRequestToken: 0,
    rollingCleanupPendingCount: 0,
    rollingCleanupBarrier: Promise.resolve(),
    supersedeRollingSeekCandidate:
      AudioContextManager.prototype.supersedeRollingSeekCandidate,
    trackRollingCleanup(cleanup) {
      events.push('register');
      return AudioContextManager.prototype.trackRollingCleanup.call(this, cleanup);
    },
    hasPendingRollingCleanup: AudioContextManager.prototype.hasPendingRollingCleanup,
    waitForRollingCleanupBarrier: AudioContextManager.prototype.waitForRollingCleanupBarrier,
    clearBufferMonitoring() {
      events.push('monitor');
    },
    maintainSilentSource() {
      events.push('silent');
    },
    updateState() {
      events.push('state');
    }
  };

  const pausing = AudioContextManager.prototype.pauseRollingPcm.call(manager);
  const pauseOutcome = await Promise.race([
    pausing.then(() => 'paused'),
    new Promise(resolve => setImmediate(() => resolve('blocked')))
  ]);
  assert.equal(pauseOutcome, 'paused');
  assert.deepEqual(events.slice(0, 3), ['supersede', 'register', 'pause']);
  assert.equal(manager.hasPendingRollingCleanup(), true);

  let admitted = false;
  const admission = manager.waitForRollingCleanupBarrier().then(() => {
    admitted = true;
    events.push('admit');
  });
  await Promise.resolve();
  assert.equal(admitted, false);

  finishCandidateDisposal();
  await admission;
  assert.equal(manager.hasPendingRollingCleanup(), false);
  assert.equal(admitted, true);
  assert.ok(events.indexOf('disposed') < events.indexOf('admit'));
});

test('Electron preference mirrors publish only after persistence succeeds', async () => {
  let ElectronIntegration;
  await withGlobals({ window: {}, navigator: { userAgent: '' } }, async () => {
    ({ ElectronIntegration } = await import('../../js/electron-integration.js'));
  });
  const events = [];
  const window = {
    electronAPI: {
      async saveAudioPreferences(preferences, options) {
        events.push(['persist', preferences, options]);
        return { success: true };
      }
    },
    audioPreferences: { gaplessPlayback: true }
  };
  await withGlobals({ window }, async () => {
    const integration = { isElectron: true, audioPreferences: window.audioPreferences };
    const preferences = { gaplessPlayback: false };
    assert.equal(await ElectronIntegration.prototype.saveAudioPreferences.call(
      integration,
      preferences,
      { applyInPlace: 'gapless-playback' }
    ), true);
    events.push(['published', integration.audioPreferences, window.audioPreferences]);
  });
  assert.deepEqual(events.map(event => event[0]), ['persist', 'published']);
  assert.deepEqual(events[0][1], { gaplessPlayback: false });
  assert.equal(events[1][1].gaplessPlayback, false);

  const driftedWindow = {
    electronAPI: {
      async saveAudioPreferences(preferences, options) {
        events.push(['persist', preferences, options]);
        return { success: true };
      }
    },
    audioPreferences: { useInputWithPlayer: false, gaplessPlayback: true }
  };
  events.length = 0;
  await withGlobals({ window: driftedWindow }, async () => {
    const integration = { isElectron: true, audioPreferences: driftedWindow.audioPreferences };
    assert.equal(await ElectronIntegration.prototype.saveAudioPreferences.call(
      integration,
      { gaplessPlayback: false },
      { applyInPlace: 'gapless-playback' }
    ), true);
    assert.equal(integration.audioPreferences.useInputWithPlayer, false);
    assert.equal(integration.audioPreferences.gaplessPlayback, false);
  });
  assert.deepEqual(events, [['persist', { gaplessPlayback: false }, {
    applyInPlace: 'gapless-playback'
  }]]);

  const failedWindow = {
    electronAPI: { async saveAudioPreferences() { return { success: false }; } },
    audioPreferences: { gaplessPlayback: true }
  };
  await withGlobals({ window: failedWindow }, async () => {
    const integration = { isElectron: true, audioPreferences: failedWindow.audioPreferences };
    assert.equal(await ElectronIntegration.prototype.saveAudioPreferences.call(
      integration,
      { gaplessPlayback: false },
      { applyInPlace: 'gapless-playback' }
    ), false);
    assert.equal(integration.audioPreferences.gaplessPlayback, true);
    assert.equal(failedWindow.audioPreferences.gaplessPlayback, true);
  });
});

test('AudioManager persists then mirrors then enqueues one player operation', async () => {
  const events = [];
  const previous = { sampleRate: 48000, gaplessPlayback: true };
  const next = { sampleRate: 48000, gaplessPlayback: false };
  const player = {
    async applyGaplessPlaybackPreference(enabled) {
      events.push(['enqueue', enabled]);
    }
  };
  const window = {
    electronAPI: {},
    electronIntegration: { audioPreferences: previous },
    audioPreferences: previous,
    uiManager: { audioPlayer: player }
  };
  const manager = {
    async _persistInPlaceAudioPreferences(preferences, reason) {
      events.push(['persist', preferences, reason]);
      return true;
    },
    _setAudioPreferencesMirror(preferences) {
      events.push(['mirror', preferences]);
      window.audioPreferences = preferences;
      window.electronIntegration.audioPreferences = preferences;
    }
  };
  await withGlobals({ window }, async () => {
    assert.equal(await AudioManager.prototype.applyGaplessPlaybackPreference.call(
      manager,
      next
    ), '');
  });
  assert.deepEqual(events.map(event => event[0]), ['persist', 'mirror', 'enqueue']);
  assert.deepEqual(events[0].slice(1), [{ gaplessPlayback: false }, 'gapless-playback']);
  assert.equal(events[1][1].gaplessPlayback, false);
  assert.equal(events[1][1].sampleRate, 48000);
  assert.deepEqual(events[2][1], false);

  events.length = 0;
  window.audioPreferences = previous;
  window.electronIntegration.audioPreferences = previous;
  await withGlobals({ window }, async () => {
    const result = await AudioManager.prototype.applyGaplessPlaybackPreference.call(manager, {
      ...next,
      sampleRate: 96000
    });
    assert.match(result, /^Audio Error: /);
    assert.doesNotMatch(result, /in place/);
  });
  assert.deepEqual(events, []);
  assert.equal(window.audioPreferences, previous);

  events.length = 0;
  manager._persistInPlaceAudioPreferences = async () => {
    events.push(['persist']);
    return false;
  };
  window.audioPreferences = previous;
  window.electronIntegration.audioPreferences = previous;
  await withGlobals({ window }, async () => {
    assert.equal(
      await AudioManager.prototype.applyGaplessPlaybackPreference.call(manager, next),
      'Audio Error: Gapless Playback could not be changed. Please apply the audio settings again.'
    );
  });
  assert.deepEqual(events.map(event => event[0]), ['persist']);
  assert.equal(window.audioPreferences, previous);
});

test('Web AudioManager compares against the mirror and stores only the Gapless field', async () => {
  const stored = {
    inputDeviceId: 'mic1',
    outputDeviceId: 'out1',
    outputDeviceLabel: 'Out One',
    sampleRate: 48000,
    gaplessPlayback: true
  };
  // The runtime default-output fallback rewrites only the mirror, so the
  // mirror and localStorage disagree on the output device.
  const mirror = { ...stored, outputDeviceId: 'default', outputDeviceLabel: '' };
  const storage = new Map([['effetune_audio_preferences', JSON.stringify(stored)]]);
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value))
  };
  const events = [];
  const window = {
    localStorage,
    electronIntegration: { audioPreferences: mirror },
    audioPreferences: mirror,
    uiManager: {
      audioPlayer: {
        async applyGaplessPlaybackPreference(enabled) {
          events.push(['enqueue', enabled]);
        }
      }
    }
  };
  const manager = {
    _persistInPlaceAudioPreferences: AudioManager.prototype._persistInPlaceAudioPreferences,
    _setAudioPreferencesMirror(preferences) {
      events.push(['mirror', preferences]);
      window.audioPreferences = preferences;
      window.electronIntegration.audioPreferences = preferences;
    }
  };
  await withGlobals({ window }, async () => {
    assert.equal(await AudioManager.prototype.applyGaplessPlaybackPreference.call(manager, {
      ...mirror,
      gaplessPlayback: false
    }), '');
  });
  assert.deepEqual(events.map(event => event[0]), ['mirror', 'enqueue']);
  const persisted = JSON.parse(storage.get('effetune_audio_preferences'));
  assert.equal(persisted.gaplessPlayback, false);
  assert.equal(persisted.outputDeviceId, 'out1');
  assert.equal(persisted.outputDeviceLabel, 'Out One');
  assert.equal(window.audioPreferences.gaplessPlayback, false);
  assert.equal(window.audioPreferences.outputDeviceId, 'default');
  assert.deepEqual(events[1], ['enqueue', false]);

  // _executeReset routes the same drifted mirror to the in-place path.
  const resetManager = {
    applyGaplessPlaybackPreference: async preferences => {
      events.push(['gapless-route', preferences.gaplessPlayback]);
      return '';
    }
  };
  events.length = 0;
  await withGlobals({ window }, async () => {
    assert.equal(await AudioManager.prototype._executeReset.call(resetManager, {
      ...window.audioPreferences,
      gaplessPlayback: true
    }), '');
  });
  assert.deepEqual(events, [['gapless-route', true]]);
});
