import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MeasurementOutputError,
  getMeasurementOutputChannelCount,
  getRequiredOutputChannelCount,
  prepareMeasurementOutputRoute,
  releaseMeasurementOutputRoute
} from '../../features/measurement/audio-utils/output-routing.js';
import {
  startWhiteNoise,
  stopWhiteNoise,
  setNoiseLevel,
  generateESS
} from '../../features/measurement/audio-utils/signal-generation.js';
import {
  createPipelineSweepAudioBuffer,
  createRepeatedSweepAudioBuffer
} from '../../features/measurement/measurement-controller/audio-processing.js';
import { MeasurementController } from '../../features/measurement/measurement-controller/index.js';
import audioUtils from '../../features/measurement/audio-utils/index.js';

function createDestination(maxChannelCount = 8) {
  return {
    maxChannelCount,
    channelCount: 2,
    channelCountMode: 'max',
    channelInterpretation: 'speakers'
  };
}

test('measurement output channel counts use only supported complete layouts', () => {
  assert.equal(getRequiredOutputChannelCount('left'), 2);
  assert.equal(getRequiredOutputChannelCount('right'), 2);
  assert.equal(getRequiredOutputChannelCount('2'), 4);
  assert.equal(getRequiredOutputChannelCount('4'), 6);
  assert.equal(getRequiredOutputChannelCount('6'), 8);
  assert.equal(getRequiredOutputChannelCount('8'), 10);
  assert.equal(getRequiredOutputChannelCount('10'), 12);
  assert.equal(getRequiredOutputChannelCount('12'), 14);
  assert.equal(getRequiredOutputChannelCount('15'), 16);
  assert.equal(getRequiredOutputChannelCount('all'), 2);
  assert.equal(getMeasurementOutputChannelCount('left', 8), 2);
  assert.equal(getMeasurementOutputChannelCount('2', 8), 4);
  assert.equal(getMeasurementOutputChannelCount('4', 8), 6);
  assert.equal(getMeasurementOutputChannelCount('6', 8), 8);
  assert.equal(getMeasurementOutputChannelCount('15', 16), 16);
  assert.equal(getMeasurementOutputChannelCount('all', 2), 2);
  assert.equal(getMeasurementOutputChannelCount('all', 4), 4);
  assert.equal(getMeasurementOutputChannelCount('all', 6), 6);
  assert.equal(getMeasurementOutputChannelCount('all', 8), 8);
  assert.equal(getMeasurementOutputChannelCount('all', 10), 10);
  assert.equal(getMeasurementOutputChannelCount('all', 12), 12);
  assert.equal(getMeasurementOutputChannelCount('all', 14), 14);
  assert.equal(getMeasurementOutputChannelCount('all', 16), 16);
});

test('measurement routing rejects unknown channel tokens instead of silently routing them', async () => {
  for (const token of ['multi', 'unknown', '-1']) {
    assert.throws(() => getRequiredOutputChannelCount(token), MeasurementOutputError);
    assert.throws(() => getMeasurementOutputChannelCount(token, 8), MeasurementOutputError);
  }
  const harness = { initialized: true };
  assert.throws(() => generateESS.call(harness, 8, 48000, 'multi'), MeasurementOutputError);
  await assert.rejects(startWhiteNoise.call({}, -12, null, 'multi'), MeasurementOutputError);
});

test('an explicit multichannel width rejects an incompatible element route before playback', async () => {
  let mediaDestinationCreated = false;
  const audioContext = {
    destination: createDestination(8),
    createMediaStreamDestination() {
      mediaDestinationCreated = true;
    }
  };
  await assert.rejects(
    prepareMeasurementOutputRoute(audioContext, 'speaker', 'left', {}, 6),
    MeasurementOutputError
  );
  assert.equal(mediaDestinationCreated, false);
});

test('explicit width cannot bypass output channel validation', async () => {
  const audioContext = { destination: createDestination(8) };
  await assert.rejects(
    prepareMeasurementOutputRoute(audioContext, null, 'multi', {}, 4),
    /Unsupported measurement output channel/
  );
  await assert.rejects(
    prepareMeasurementOutputRoute(audioContext, null, '4', {}, 4),
    /Invalid explicit measurement output width/
  );
  await assert.rejects(
    prepareMeasurementOutputRoute(audioContext, null, 'left', {}, 3),
    /Invalid explicit measurement output width/
  );
});

test('selected channels retain the configured device layout, including all channels', async () => {
  for (const count of [6, 8]) {
    const destination = createDestination(16);
    const audioContext = { destination };
    for (const channel of ['left', '2', '3', 'all']) {
      const route = await prepareMeasurementOutputRoute(audioContext, null, channel, {}, count);
      assert.equal(route.outputChannels, count);
      assert.equal(destination.channelCount, count);
    }
  }
  await assert.rejects(
    prepareMeasurementOutputRoute({ destination: createDestination(2) }, null, 'left', {}, 6),
    MeasurementOutputError
  );
});

test('center and subwoofer test signals use six output channels', async () => {
  const destination = createDestination(8);
  const connections = [];
  const mergers = [];
  const node = () => ({ connect() {}, disconnect() {} });
  const audioContext = {
    sampleRate: 8,
    destination,
    createBuffer(_count, length) {
      const data = new Float32Array(length);
      return { getChannelData: () => data };
    },
    createBufferSource: () => ({ ...node(), start() {}, stop() {} }),
    createGain: () => ({ ...node(), gain: {}, connect: (...args) => connections.push(args) }),
    createChannelMerger(count) {
      mergers.push(count);
      return node();
    }
  };
  const harness = { audioContext, ensureAudioContextRunning: async () => true };
  for (const channel of ['2', '3']) {
    try {
      assert.equal(await startWhiteNoise.call(harness, -12, null, channel, 1, null, null, 6), true);
      assert.equal(destination.channelCount, 6);
      assert.equal(connections.at(-1)[2], Number(channel));
    } finally {
      stopWhiteNoise.call(harness);
    }
  }
  assert.deepEqual(mergers, [6, 6]);
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
    '2'
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

  await prepareMeasurementOutputRoute(audioContext, 'default', 'left');

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
    '2'
  );

  assert.equal(route.mode, 'direct');
  assert.equal(destination.channelCount, 4);
});

test('measurement output rejects a selected channel unsupported by the selected device', async () => {
  const destination = createDestination(2);
  const calls = [];
  const audioContext = {
    destination,
    async setSinkId(sinkId) {
      calls.push(sinkId);
    }
  };

  await assert.rejects(
    prepareMeasurementOutputRoute(audioContext, 'stereo-device', '2'),
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
    prepareMeasurementOutputRoute(audioContext, 'speaker', '2'),
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
    prepareMeasurementOutputRoute(audioContext, 'missing-device', 'left'),
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
      { setSinkIdTimeoutMs: 1 }
    ),
    error => error instanceof MeasurementOutputError &&
      /could not be opened/.test(error.message)
  );
  assert.equal(mediaDestinationCreated, false);
  assert.equal(destination.channelCount, 2);
});

test('stereo measurement ignores EffeTune main app four-channel output setting', async () => {
  const previousWindow = globalThis.window;
  const destination = createDestination(2);
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
    assert.equal(await startWhiteNoise.call(harness, -12, 'stereo-device', 'all'), true);
    assert.deepEqual(sinkIds, ['stereo-device']);
    assert.equal(destination.channelCount, 2);
    assert.equal(createdBuffers.length, 1);
    assert.equal(createdBuffers[0].channelCount, 1);
    assert.equal(createdMergers.length, 1);
    assert.equal(createdMergers[0].channelCount, 2);
    assert.deepEqual(gain.connections, [
      [createdMergers[0], 0, 0],
      [createdMergers[0], 0, 1]
    ]);
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

test('the latest white-noise start remains published when starts complete in reverse order', async t => {
  const previousWindow = globalThis.window;
  t.after(() => { globalThis.window = previousWindow; });

  const readyResolvers = [];
  const sources = [];
  function createNode() {
    return {
      connect() {},
      disconnect() { this.disconnected = true; }
    };
  }
  const audioContext = {
    sampleRate: 8,
    state: 'running',
    destination: createDestination(2),
    createBuffer(channelCount, length) {
      const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
      return { getChannelData: channel => channels[channel] };
    },
    createBufferSource() {
      const source = {
        ...createNode(),
        start() { this.started = true; },
        stop() { this.stopped = true; }
      };
      sources.push(source);
      return source;
    },
    createGain() {
      return { ...createNode(), gain: { value: 0 } };
    },
    createChannelMerger() {
      return createNode();
    }
  };
  const harness = {
    audioContext,
    isWhiteNoiseActive: false,
    ensureAudioContextRunning() {
      return new Promise(resolve => readyResolvers.push(resolve));
    }
  };
  globalThis.window = { audioPreferences: { outputChannels: 2 } };

  const firstStart = startWhiteNoise.call(harness, -12, null, 'left');
  const secondStart = startWhiteNoise.call(harness, -12, null, 'right');
  assert.equal(readyResolvers.length, 2);

  readyResolvers[1](true);
  assert.equal(await secondStart, true);
  const publishedSource = harness.whiteNoiseNode;
  assert.equal(harness.whiteNoiseChannel, 'right');
  assert.equal(harness.isWhiteNoiseActive, true);

  readyResolvers[0](true);
  assert.equal(await firstStart, false);
  assert.equal(harness.whiteNoiseNode, publishedSource);
  assert.equal(harness.whiteNoiseChannel, 'right');
  assert.equal(harness.isWhiteNoiseActive, true);
  assert.equal(sources.length, 1);

  stopWhiteNoise.call(harness);
  assert.equal(publishedSource.stopped, true);

  const stoppedWhilePending = startWhiteNoise.call(harness, -12, null, 'left');
  stopWhiteNoise.call(harness);
  readyResolvers[2](true);
  assert.equal(await stoppedWhilePending, false);
  assert.equal(harness.isWhiteNoiseActive, false);
  assert.equal(harness.whiteNoiseNode, null);
  assert.equal(sources.length, 1);
});

test('white-noise route ownership serializes device and layout publication', async t => {
  const previousWindow = globalThis.window;
  t.after(() => { globalThis.window = previousWindow; });
  const destination = createDestination(8);
  const sinkCalls = [];
  const sinkResolvers = [];
  const sources = [];
  function createNode() {
    return {
      connect() {},
      disconnect() { this.disconnected = true; }
    };
  }
  const audioContext = {
    sampleRate: 8,
    state: 'running',
    destination,
    sinkId: '',
    setSinkId(sinkId) {
      sinkCalls.push(sinkId);
      return new Promise(resolve => {
        sinkResolvers.push(() => {
          this.sinkId = sinkId;
          resolve();
        });
      });
    },
    createBuffer(channelCount, length) {
      const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
      return { getChannelData: channel => channels[channel] };
    },
    createBufferSource() {
      const source = {
        ...createNode(),
        start() { this.started = true; },
        stop() { this.stopped = true; }
      };
      sources.push(source);
      return source;
    },
    createGain() {
      return { ...createNode(), gain: { value: 0 } };
    },
    createChannelMerger(channelCount) {
      return { ...createNode(), channelCount };
    }
  };
  const harness = {
    audioContext,
    isWhiteNoiseActive: false,
    ensureAudioContextRunning: async () => true
  };
  globalThis.window = { audioPreferences: { outputChannels: 8 } };

  const earlier = startWhiteNoise.call(harness, -12, 'earlier-device', 'left');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sinkCalls, ['earlier-device']);

  const latest = startWhiteNoise.call(harness, -12, 'latest-device', '2');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sinkCalls, ['earlier-device']);

  sinkResolvers[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sinkCalls, ['earlier-device', 'latest-device']);
  sinkResolvers[1]();

  assert.equal(await earlier, false);
  assert.equal(await latest, true);
  assert.equal(audioContext.sinkId, 'latest-device');
  assert.equal(destination.channelCount, 4);
  assert.equal(harness.channelMerger.channelCount, 4);
  assert.equal(harness.whiteNoiseChannel, '2');
  assert.equal(sources.length, 1);
  stopWhiteNoise.call(harness);

  const cancelled = startWhiteNoise.call(harness, -12, 'cancelled-device', 'left');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sinkCalls, [
    'earlier-device',
    'latest-device',
    'cancelled-device'
  ]);
  stopWhiteNoise.call(harness);
  sinkResolvers[2]();
  assert.equal(await cancelled, false);
  assert.equal(harness.isWhiteNoiseActive, false);
  assert.equal(harness.isWhiteNoisePending, false);
  assert.equal(harness.whiteNoiseDesiredActive, false);
  assert.equal(harness.whiteNoiseNode, null);
  assert.equal(sources.length, 1);
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

test('a Ch 16 sweep uses a complete 16-channel buffer with silence elsewhere', () => {
  const created = [];
  const audioContext = {
    createBuffer(channelCount, length, sampleRate) {
      const channelData = Array.from({ length: channelCount }, () => new Float32Array(length));
      const buffer = { channelCount, length, sampleRate, channelData,
        getChannelData(channel) { return channelData[channel]; } };
      created.push(buffer);
      return buffer;
    }
  };
  const sweepChannels = Array.from({ length: 16 }, () => new Float32Array(2));
  sweepChannels[15].set([0.25, -0.5]);

  const buffer = createRepeatedSweepAudioBuffer(
    audioContext, { length: 2, channels: sweepChannels }, 15, 16, 48000
  );

  assert.equal(created.length, 1);
  assert.equal(buffer.channelCount, 16);
  assert.ok(buffer.channelData[14].every(value => value === 0));
  assert.ok(buffer.channelData[15].every((value, index) => value === [0.25, -0.5][index % 2]));
});

function createPipelineNoiseContext(destination) {
  const buffers = [];
  const node = () => ({
    connections: [],
    connect(...args) { this.connections.push(args); },
    disconnect() { this.disconnected = true; }
  });
  const audioContext = {
    sampleRate: 8,
    state: 'running',
    destination,
    createBuffer(numberOfChannels, length, sampleRate) {
      const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
      const buffer = { numberOfChannels, length, sampleRate, channels, getChannelData: index => channels[index] };
      buffers.push(buffer);
      return buffer;
    },
    createBufferSource: () => ({ ...node(), start() {}, stop() {} }),
    createGain: () => ({ ...node(), gain: { value: 0 } }),
    createChannelMerger() {
      throw new Error('Pipeline noise plays every rendered output on its matching channel');
    }
  };
  return { audioContext, buffers };
}

test('pipeline level-adjustment noise loops the middle 0 dB render under the level GainNode', async t => {
  const previousWindow = globalThis.window;
  t.after(() => { globalThis.window = previousWindow; });
  globalThis.window = { audioPreferences: { outputChannels: 2 } };
  const destination = createDestination(4);
  const { audioContext, buffers } = createPipelineNoiseContext(destination);
  const harness = { audioContext, isWhiteNoiseActive: false, ensureAudioContextRunning: async () => true };
  const renders = [];
  const pipeline = {
    channelCount: 4,
    cache: new Map(),
    async render(input) {
      renders.push(input.map(data => Float32Array.from(data)));
      // Offset each rendered period so the kept one is identifiable.
      return input.map((data, channel) => data.map((sample, index) =>
        sample + (channel + 1) * 10 * Math.floor(index * 3 / data.length)));
    }
  };

  try {
    assert.equal(await startWhiteNoise.call(harness, -12, null, 'left', 1, null, null, 4, pipeline), true);
    assert.equal(renders.length, 1);
    const [input] = renders;
    const period = input[0].length / 3;
    assert.equal(input.length, 4);
    assert.deepEqual(input[0].subarray(0, period), input[0].subarray(period, 2 * period));
    assert.ok(input[0].some(sample => sample !== 0));
    assert.ok(input.slice(1).every(data => data.every(sample => sample === 0)));

    const buffer = buffers.at(-1);
    assert.equal(harness.whiteNoiseNode.buffer, buffer);
    assert.equal(harness.whiteNoiseNode.loop, true);
    assert.equal(buffer.numberOfChannels, 4);
    assert.equal(buffer.length, period);
    buffer.channels.forEach((data, channel) => data.forEach((sample, index) =>
      assert.equal(sample, Math.fround(input[channel][period + index] + (channel + 1) * 10))));

    const gain = harness.whiteNoiseGain;
    assert.ok(Math.abs(gain.gain.value - 10 ** (-12 / 20)) < 1e-12);
    assert.equal(gain.channelCount, 4);
    assert.equal(gain.channelCountMode, 'explicit');
    assert.equal(gain.channelInterpretation, 'discrete');
    assert.deepEqual(gain.connections, [[destination]]);
    assert.equal(setNoiseLevel.call(harness, -6), true);
    assert.ok(Math.abs(gain.gain.value - 10 ** (-6 / 20)) < 1e-12);

    // A restart for the same channel reuses the cached render.
    assert.equal(await startWhiteNoise.call(harness, -6, null, 'left', 1, null, null, 4, pipeline), true);
    assert.equal(renders.length, 1);

    // The common all-channel noise feeds pipeline inputs Ch 1-2.
    assert.equal(await startWhiteNoise.call(harness, -6, null, 'all', 1, null, null, 4, pipeline), true);
    assert.equal(renders.length, 2);
    assert.deepEqual(renders[1][0], renders[1][1]);
    assert.ok(renders[1][0].some(sample => sample !== 0));
    assert.ok(renders[1].slice(2).every(data => data.every(sample => sample === 0)));
  } finally {
    stopWhiteNoise.call(harness);
  }
});

test('a pipeline sweep bakes the signal level into the rendered buffer and maps outputs 1:1', async () => {
  const created = [];
  const audioContext = {
    sampleRate: 48000,
    createBuffer(channelCount, length, sampleRate) {
      const channelData = Array.from({ length: channelCount }, () => new Float32Array(length));
      const buffer = { channelCount, length, sampleRate, channelData,
        getChannelData(channel) { return channelData[channel]; } };
      created.push(buffer);
      return buffer;
    }
  };
  const renders = [];
  const controller = {
    measurementConfig: { effectPipeline: true },
    pipelineHandoff: { snapshot: { channelCount: 3 } },
    async renderPipelineSignal(input, signal) {
      renders.push({ input: input.map(data => Float32Array.from(data)), signal });
      return input.map((data, channel) => data.map(sample =>
        channel === 0 ? sample * 2 : channel === 2 ? 0.125 : sample));
    }
  };
  const sweep = { length: 2, tailSamples: 1, channels: [Float32Array.from([0.5, -1]), new Float32Array(2)] };
  const { signal } = new AbortController();
  const gain = 10 ** (-12 / 20);

  const buffer = await createPipelineSweepAudioBuffer(controller, audioContext, sweep, 2, 4, -12, signal);
  assert.equal(renders.length, 1);
  assert.equal(renders[0].signal, signal);
  assert.equal(renders[0].input.length, 3);
  const expectedInput = [0.5 * gain, -gain, 0, 0.5 * gain, -gain, 0];
  renders[0].input[0].forEach((sample, index) => assert.ok(Math.abs(sample - expectedInput[index]) < 1e-6));
  assert.ok(renders[0].input.slice(1).every(data => data.every(sample => sample === 0)));
  assert.equal(buffer.channelCount, 4);
  assert.equal(buffer.length, 6);
  assert.equal(buffer.sampleRate, 48000);
  buffer.channelData[0].forEach((sample, index) => assert.ok(Math.abs(sample - 2 * expectedInput[index]) < 1e-6));
  assert.ok(buffer.channelData[1].every(sample => sample === 0));
  assert.ok(buffer.channelData[2].every(sample => sample === 0.125));
  assert.ok(buffer.channelData[3].every(sample => sample === 0));

  // A render that exceeds full scale is refused before any playback buffer is created.
  controller.renderPipelineSignal = async input => input.map(data => data.map(sample => sample * 8));
  assert.equal(await createPipelineSweepAudioBuffer(controller, audioContext, sweep, 2, 4, -12, signal), null);
  assert.equal(created.length, 1);
});

test('pipeline measurements stop during setup when the pipeline cannot be reproduced', async t => {
  const originals = { audioContext: audioUtils.audioContext, document: globalThis.document };
  t.after(() => {
    audioUtils.audioContext = originals.audioContext;
    globalThis.document = originals.document;
  });
  const context = { sampleRate: 48000, state: 'running', destination: createDestination(2), sinkId: 'output-id' };
  context.setSinkId = async id => { context.sinkId = id; };
  audioUtils.audioContext = context;
  globalThis.document = { getElementById: () => null };
  const config = (overrides = {}) => ({
    name: 'Pipeline measurement',
    audioInput: 'Input',
    audioInputId: 'input-id',
    inputChannel: 'left',
    audioOutput: 'Output',
    audioOutputId: 'output-id',
    outputChannel: 'left',
    sampleRate: 48000,
    sweepLength: '65536',
    sweepMinFreq: 20,
    sweepMaxFreq: 20000,
    averaging: 4,
    effectPipeline: true,
    ...overrides
  });
  const controller = new MeasurementController();
  controller.prepareForLevelAdjustment = async () => {};
  const handoff = snapshot => ({
    snapshot: { sampleRate: 48000, channelCount: 2, ...snapshot },
    pluginNames: ['Volume']
  });
  const rejectsWith = (code, measurementConfig = config()) =>
    assert.rejects(controller.startNewMeasurement(measurementConfig), error => error.code === code);

  controller.pipelineHandoff = null;
  await rejectsWith('pipelineUnavailable');
  controller.pipelineHandoff = handoff({ sampleRate: 44100 });
  await rejectsWith('pipelineSampleRateMismatch');
  controller.pipelineHandoff = handoff();
  await rejectsWith('pipelineInputChannelUnavailable', config({ outputChannel: '2' }));
  controller.pipelineHandoff = handoff({ channelCount: 4 });
  await rejectsWith('pipelineOutputChannelsUnavailable');

  context.destination = createDestination(8);
  controller.pipelineHandoff = handoff({ channelCount: 3 });
  const measurement = await controller.startNewMeasurement(config());
  assert.deepEqual(measurement.effectPipeline, { pluginNames: ['Volume'] });
  assert.equal(measurement.outputChannelCount, 4);
  assert.equal(context.destination.channelCount, 4);

  const direct = await controller.startNewMeasurement(config({ effectPipeline: false }));
  assert.equal(direct.effectPipeline, undefined);
});
