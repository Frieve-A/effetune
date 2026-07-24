import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MeasurementOutputError,
  getRequiredOutputChannelCount,
  loadConfiguredOutputChannels,
  normalizeOutputChannelCount,
  prepareMeasurementOutputRoute,
  releaseMeasurementOutputRoute
} from '../../features/measurement/audio-utils/output-routing.js';
import {
  startWhiteNoise,
  stopWhiteNoise
} from '../../features/measurement/audio-utils/signal-generation.js';
import {
  createRepeatedSweepAudioBuffer
} from '../../features/measurement/measurement-controller/audio-processing.js';

function createDestination(maxChannelCount = 8) {
  return {
    maxChannelCount,
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'speakers'
  };
}

test('measurement output channel counts use only supported complete layouts', () => {
  assert.equal(normalizeOutputChannelCount(2), 2);
  assert.equal(normalizeOutputChannelCount('4'), 4);
  assert.equal(normalizeOutputChannelCount(6), 6);
  assert.equal(normalizeOutputChannelCount(8), 8);
  assert.equal(normalizeOutputChannelCount(3), 2);
  assert.equal(normalizeOutputChannelCount(undefined), 2);

  assert.equal(getRequiredOutputChannelCount('left'), 2);
  assert.equal(getRequiredOutputChannelCount('right'), 2);
  assert.equal(getRequiredOutputChannelCount('2'), 4);
  assert.equal(getRequiredOutputChannelCount('4'), 6);
  assert.equal(getRequiredOutputChannelCount('6'), 8);
  assert.equal(getRequiredOutputChannelCount('all'), 2);
});

test('measurement output loads the normal Electron output channel setting', async () => {
  const calls = [];
  const windowRef = {
    electronAPI: {
      async loadAudioPreferences() {
        calls.push('load');
        return { success: true, preferences: { outputChannels: 6 } };
      }
    }
  };

  assert.equal(await loadConfiguredOutputChannels(windowRef), 6);
  assert.deepEqual(calls, ['load']);
});

test('measurement output loads the normal web output channel setting', async () => {
  const windowRef = {
    localStorage: {
      getItem(key) {
        assert.equal(key, 'effetune_audio_preferences');
        return JSON.stringify({ outputChannels: 8 });
      }
    }
  };

  assert.equal(await loadConfiguredOutputChannels(windowRef), 8);
});

test('direct measurement output selects the requested device before configuring its layout', async () => {
  const destination = createDestination(8);
  const calls = [];
  const audioContext = {
    destination,
    sinkId: '',
    async setSinkId(sinkId) {
      calls.push(['setSinkId', sinkId]);
      this.sinkId = sinkId;
    }
  };

  const route = await prepareMeasurementOutputRoute(
    audioContext,
    'speaker-4ch',
    '2',
    4
  );

  assert.equal(route.mode, 'direct');
  assert.equal(route.destination, destination);
  assert.equal(route.outputChannels, 4);
  assert.deepEqual(calls, [['setSinkId', 'speaker-4ch']]);
  assert.equal(destination.channelCount, 4);
  assert.equal(destination.channelCountMode, 'explicit');
  assert.equal(destination.channelInterpretation, 'discrete');
});

test('direct measurement output returns an existing context to the default device', async () => {
  const destination = createDestination(2);
  const calls = [];
  const audioContext = {
    destination,
    sinkId: 'speaker-old',
    async setSinkId(sinkId) {
      calls.push(sinkId);
      this.sinkId = sinkId;
    }
  };

  await prepareMeasurementOutputRoute(audioContext, 'default', 'left', 2);

  assert.deepEqual(calls, ['']);
  assert.equal(audioContext.sinkId, '');
});

test('direct measurement output does not reopen an already selected device', async () => {
  const destination = createDestination(4);
  const audioContext = {
    destination,
    sinkId: 'speaker-4ch',
    async setSinkId() {
      assert.fail('setSinkId should not be called for the active device');
    }
  };

  const route = await prepareMeasurementOutputRoute(
    audioContext,
    'speaker-4ch',
    '2',
    4
  );

  assert.equal(route.mode, 'direct');
  assert.equal(destination.channelCount, 4);
});

test('measurement output rejects a selected channel outside the configured layout', async () => {
  const calls = [];
  const audioContext = {
    destination: createDestination(8),
    async setSinkId(sinkId) {
      calls.push(sinkId);
    }
  };

  await assert.rejects(
    prepareMeasurementOutputRoute(audioContext, 'speaker', '2', 2),
    error => error instanceof MeasurementOutputError &&
      /Ch 3 requires at least 4 output channels/.test(error.message)
  );
  assert.deepEqual(calls, []);
});

test('measurement output rejects a configured layout unsupported by the selected device', async () => {
  const destination = createDestination(2);
  const calls = [];
  const audioContext = {
    destination,
    async setSinkId(sinkId) {
      calls.push(sinkId);
    }
  };

  await assert.rejects(
    prepareMeasurementOutputRoute(audioContext, 'stereo-device', 'left', 4),
    error => error instanceof MeasurementOutputError &&
      /supports 2 channels/.test(error.message)
  );
  assert.deepEqual(calls, ['stereo-device']);
  assert.equal(destination.channelCount, 2);
});

test('multichannel measurement output never falls back to an audio element', async () => {
  let mediaDestinationCreated = false;
  const audioContext = {
    destination: createDestination(8),
    createMediaStreamDestination() {
      mediaDestinationCreated = true;
    }
  };

  await assert.rejects(
    prepareMeasurementOutputRoute(audioContext, 'speaker', 'left', 4),
    error => error instanceof MeasurementOutputError &&
      /cannot send multichannel measurement audio directly/.test(error.message)
  );
  assert.equal(mediaDestinationCreated, false);
});

test('stereo measurement output retains the exact-device compatibility fallback', async () => {
  const calls = [];
  const mediaStreamDestination = {
    stream: { id: 'measurement-stream' },
    channelCount: 1,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
    disconnect() {
      calls.push('disconnect');
    }
  };
  const audioContext = {
    destination: createDestination(2),
    createMediaStreamDestination() {
      calls.push('createMediaStreamDestination');
      return mediaStreamDestination;
    }
  };

  class FakeAudio {
    async setSinkId(sinkId) {
      calls.push(['setSinkId', sinkId]);
    }

    async play() {
      calls.push('play');
    }

    pause() {
      calls.push('pause');
    }
  }

  const route = await prepareMeasurementOutputRoute(
    audioContext,
    'stereo-device',
    'right',
    2,
    { AudioConstructor: FakeAudio }
  );

  assert.equal(route.mode, 'media-element');
  assert.equal(route.destination, mediaStreamDestination);
  assert.equal(mediaStreamDestination.channelCount, 2);
  assert.equal(mediaStreamDestination.channelCountMode, 'explicit');
  assert.equal(mediaStreamDestination.channelInterpretation, 'discrete');
  assert.equal(route.audioElement.srcObject, mediaStreamDestination.stream);
  assert.deepEqual(calls, [
    'createMediaStreamDestination',
    ['setSinkId', 'stereo-device'],
    'play'
  ]);

  releaseMeasurementOutputRoute(route);
  assert.equal(route.audioElement.srcObject, null);
  assert.deepEqual(calls.slice(-2), ['pause', 'disconnect']);
});

test('a stalled stereo element device selection times out and cleans up', async () => {
  const calls = [];
  let audioElement;
  const directDestination = createDestination(2);
  const mediaStreamDestination = {
    stream: { id: 'stalled-measurement-stream' },
    channelCount: 1,
    channelCountMode: 'max',
    channelInterpretation: 'speakers',
    disconnect() {
      calls.push('disconnect');
    }
  };
  const audioContext = {
    destination: directDestination,
    createMediaStreamDestination() {
      calls.push('createMediaStreamDestination');
      return mediaStreamDestination;
    }
  };

  class StalledAudio {
    constructor() {
      audioElement = this;
    }

    setSinkId(sinkId) {
      calls.push(['setSinkId', sinkId]);
      return new Promise(() => {});
    }

    async play() {
      calls.push('play');
    }

    pause() {
      calls.push('pause');
    }
  }

  await assert.rejects(
    prepareMeasurementOutputRoute(
      audioContext,
      'stalled-stereo-device',
      'left',
      2,
      { AudioConstructor: StalledAudio, setSinkIdTimeoutMs: 1 }
    ),
    error => error instanceof MeasurementOutputError &&
      /could not be opened/.test(error.message)
  );
  assert.equal(audioElement.srcObject, null);
  assert.equal(mediaStreamDestination.channelCount, 2);
  assert.equal(directDestination.channelCountMode, 'max');
  assert.deepEqual(calls, [
    'createMediaStreamDestination',
    ['setSinkId', 'stalled-stereo-device'],
    'pause',
    'disconnect'
  ]);
});

test('a failed direct device selection is reported without changing devices', async () => {
  const destination = createDestination(8);
  const audioContext = {
    destination,
    async setSinkId() {
      throw new Error('raw device failure');
    }
  };

  await assert.rejects(
    prepareMeasurementOutputRoute(audioContext, 'missing-device', 'left', 2),
    error => error instanceof MeasurementOutputError &&
      !error.message.includes('raw device failure') &&
      /could not be opened/.test(error.message)
  );
  assert.equal(destination.channelCount, 2);
});

test('a stalled direct device selection times out without falling back', async () => {
  const destination = createDestination(8);
  let mediaDestinationCreated = false;
  const audioContext = {
    destination,
    sinkId: '',
    setSinkId() {
      return new Promise(() => {});
    },
    createMediaStreamDestination() {
      mediaDestinationCreated = true;
    }
  };

  await assert.rejects(
    prepareMeasurementOutputRoute(
      audioContext,
      'stalled-device',
      'left',
      2,
      { setSinkIdTimeoutMs: 1 }
    ),
    error => error instanceof MeasurementOutputError &&
      /could not be opened/.test(error.message)
  );
  assert.equal(mediaDestinationCreated, false);
  assert.equal(destination.channelCount, 2);
});

test('white-noise level adjustment uses the direct full-layout route', async () => {
  const previousWindow = globalThis.window;
  const destination = createDestination(8);
  const createdBuffers = [];
  const createdMergers = [];
  const sinkIds = [];

  function createNode() {
    return {
      connections: [],
      connect(...args) {
        this.connections.push(args);
      },
      disconnect() {
        this.disconnected = true;
      }
    };
  }

  const source = {
    ...createNode(),
    start() {
      this.started = true;
    },
    stop() {
      this.stopped = true;
    }
  };
  const gain = {
    ...createNode(),
    gain: { value: 0 }
  };
  const audioContext = {
    sampleRate: 8,
    state: 'running',
    destination,
    sinkId: '',
    async setSinkId(sinkId) {
      sinkIds.push(sinkId);
      this.sinkId = sinkId;
    },
    createBuffer(channelCount, length, sampleRate) {
      const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
      const buffer = {
        channelCount,
        length,
        sampleRate,
        getChannelData(channel) {
          return channels[channel];
        }
      };
      createdBuffers.push(buffer);
      return buffer;
    },
    createBufferSource() {
      return source;
    },
    createGain() {
      return gain;
    },
    createChannelMerger(channelCount) {
      const merger = { ...createNode(), channelCount };
      createdMergers.push(merger);
      return merger;
    }
  };
  const harness = {
    audioContext,
    isWhiteNoiseActive: false,
    async ensureAudioContextRunning() {
      return true;
    },
    stopWhiteNoise() {
      return stopWhiteNoise.call(this);
    }
  };

  globalThis.window = { audioPreferences: { outputChannels: 4 } };
  try {
    assert.equal(await startWhiteNoise.call(harness, -12, 'speaker-4ch', '2'), true);
    assert.deepEqual(sinkIds, ['speaker-4ch']);
    assert.equal(destination.channelCount, 4);
    assert.equal(createdBuffers.length, 1);
    assert.equal(createdBuffers[0].channelCount, 1);
    assert.equal(createdMergers.length, 1);
    assert.equal(createdMergers[0].channelCount, 4);
    assert.deepEqual(gain.connections, [[createdMergers[0], 0, 2]]);
    assert.deepEqual(createdMergers[0].connections, [[destination]]);
    assert.equal(source.started, true);

    stopWhiteNoise.call(harness);
    assert.equal(source.stopped, true);
    assert.equal(source.disconnected, true);
    assert.equal(gain.disconnected, true);
    assert.equal(createdMergers[0].disconnected, true);
  } finally {
    globalThis.window = previousWindow;
  }
});

test('a Ch 3 sweep uses a complete 4-channel buffer with silence elsewhere', () => {
  const created = [];
  const audioContext = {
    createBuffer(channelCount, length, sampleRate) {
      const channelData = Array.from(
        { length: channelCount },
        () => new Float32Array(length)
      );
      const buffer = {
        channelCount,
        length,
        sampleRate,
        channelData,
        getChannelData(channel) {
          return channelData[channel];
        }
      };
      created.push(buffer);
      return buffer;
    }
  };
  const sweepChannels = Array.from({ length: 8 }, () => new Float32Array(3));
  sweepChannels[2].set([0.25, -0.5, 0.75]);

  const buffer = createRepeatedSweepAudioBuffer(
    audioContext,
    { length: 3, channels: sweepChannels },
    2,
    4,
    48000
  );

  assert.equal(created.length, 1);
  assert.equal(buffer.channelCount, 4);
  assert.equal(buffer.length, 6);
  assert.equal(buffer.sampleRate, 48000);
  assert.deepEqual([...buffer.channelData[0]], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...buffer.channelData[1]], [0, 0, 0, 0, 0, 0]);
  assert.deepEqual([...buffer.channelData[2]], [0.25, -0.5, 0.75, 0.25, -0.5, 0.75]);
  assert.deepEqual([...buffer.channelData[3]], [0, 0, 0, 0, 0, 0]);
});
