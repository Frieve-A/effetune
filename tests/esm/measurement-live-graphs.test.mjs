import assert from 'node:assert/strict';
import test from 'node:test';
import GraphUtils from '../../features/measurement/measurement-controller/graph-utils.js';
import '../../features/measurement/ui/ui-manager.js';
import AudioProcessing, { SweepCancelledError } from '../../features/measurement/measurement-controller/audio-processing.js';
import audioUtils from '../../features/measurement/audio-utils/index.js';
import { generateESS } from '../../features/measurement/audio-utils/signal-generation.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const { default: SweepMeasurement } = await import('../../features/measurement/measurement-controller/sweep-measurement.js');

function canvasRecorder() {
  const strokes = [], labels = [];
  let points = [];
  const canvas = { width: 400, height: 240, getContext: () => ctx };
  const ctx = {
    canvas, fillRect() {}, save() {}, restore() {}, translate() {}, rotate() {},
    beginPath() { points = []; },
    moveTo(x, y) { points.push(['move', x, y]); },
    lineTo(x, y) { points.push(['line', x, y]); },
    stroke() { strokes.push({ color: this.strokeStyle, width: this.lineWidth, points }); },
    fillText(text, x, y) { labels.push({ text, x, y }); }
  };
  return { canvas, ctx, strokes, labels };
}

function graphController(options = {}) {
  return Object.assign(Object.create(GraphUtils), {
    currentMeasurement: { sweepMinFreq: 100, sweepMaxFreq: 10000 },
    measurementConfig: { sweepLength: '48000', averaging: '2' },
    levelGraphDurationSeconds: 4,
    levelGraphData: [], ...options
  });
}

function setAudioContext(t) {
  const original = audioUtils.audioContext;
  audioUtils.audioContext = { sampleRate: 48000 };
  t.after(() => { audioUtils.audioContext = original; });
}

test('live level curves clamp silence and overload and include the capture endpoint', async t => {
  setAudioContext(t);
  const { ctx, strokes } = canvasRecorder();
  const controller = graphController({ levelGraphData: [
    { time: 0, level: -Infinity }, { time: 2, level: -30 },
    { time: 4, level: 3 }, { time: 5, level: -10 }
  ] });
  controller.drawLevelGraphData(ctx, 400, 240);
  assert.deepEqual(strokes[0].points, [['move', 60, 210], ['line', 225, 110], ['line', 390, 10]]);
  controller.levelGraphData = [{ time: 0, level: -30 }];
  controller.drawLevelGraphData(ctx, 400, 240);
  assert.equal(strokes.length, 1);
});

test('live level graph includes every actual ESS repetition and tail from capture start', async t => {
  const originals = Object.fromEntries(['audioContext', 'microphone', 'channelGain',
    'audioWorkletSupported', 'createRecorderWorkletNode', 'getInputLevel'].map(key => [key, audioUtils[key]]));
  t.after(() => Object.assign(audioUtils, originals));
  for (const [averaging, requestedLength, sampleRate] of [[4, 131072, 48000], [3, 16384, 96000]]) {
    const { canvas, ctx, strokes, labels } = canvasRecorder();
    const timers = new Map();
    let timerId = 0, now = 0, source;
    const node = () => ({ connect() {}, disconnect() {} });
    audioUtils.audioContext = {
      state: 'running', sampleRate, currentTime: 0,
      destination: { maxChannelCount: 2 },
      createBuffer(count, length) {
        const channels = Array.from({ length: count }, () => new Float32Array(length));
        return { length, getChannelData: index => channels[index] };
      },
      createAnalyser: () => ({ ...node(), frequencyBinCount: 8 }),
      createGain: () => ({ ...node(), gain: { value: 1 } }),
      createBufferSource: () => (source = { ...node(), stop() {}, start(time) { this.startTime = time; } })
    };
    Object.assign(audioUtils, {
      microphone: {}, channelGain: node(), audioWorkletSupported: true,
      getInputLevel: () => -60,
      createRecorderWorkletNode: async () => {
        // Device/worklet setup time must not consume the capture's graph span.
        now = 10000;
        return { ...node(), port: { postMessage() {} } };
      }
    });
    const sweep = generateESS.call({ initialized: true }, requestedLength, sampleRate, 'left');
    if (requestedLength === 16384) assert.ok(sweep.length > requestedLength);
    await withGlobals({
      window: {}, document: { getElementById: id => id === 'noiseLevel' ? { value: '-12' } : canvas },
      setTimeout: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
      clearTimeout: id => timers.delete(id),
      setInterval: (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; },
      clearInterval: id => timers.delete(id)
    }, async () => {
      const nowMock = t.mock.method(Date, 'now', () => now);
      const controller = Object.assign(graphController(), SweepMeasurement, AudioProcessing, {
        measurementConfig: { sweepLength: String(requestedLength), averaging: String(averaging), outputChannel: 'left' },
        levelGraphData: [{ time: 99, level: 0 }], levelGraphDurationSeconds: 100
      });
      const operation = controller.playAndRecordSweep(sweep);
      const cancelled = assert.rejects(operation, SweepCancelledError);
      try {
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(controller.startTime, 10000);
        assert.deepEqual(controller.levelGraphData, [{ time: 0, level: -60 }]);
        const graphTimer = timers.get(controller.levelGraphInterval);
        assert.equal(graphTimer.delay, 50);
        now += 500;
        audioUtils.audioContext.currentTime = 0.5;
        timers.get(controller.activeSweepElements.preRollTimer).callback();
        assert.equal(source.startTime, 0.55);
        const playback = source.buffer.getChannelData(0);
        const intervalSamples = playback.length / averaging;
        assert.equal(intervalSamples, sweep.length + sweep.tailSamples);
        const duration = controller.levelGraphDurationSeconds;
        assert.equal(duration, Math.ceil(sampleRate + playback.length) / sampleRate);
        const oldDuration = 2 + requestedLength * averaging / sampleRate;
        let oldCompleteCycles = 0;
        controller.levelGraphData = [{ time: 0, level: -60 }];
        for (let repeat = 0; repeat < averaging; repeat++) {
          const start = repeat * intervalSamples;
          assert.equal(playback[start + Math.floor(sweep.length / 2)], sweep.signal[Math.floor(sweep.length / 2)]);
          assert.equal(playback[start + intervalSamples - 1], 0);
          const lastSweepSample = source.startTime + (start + sweep.length - 1) / sampleRate;
          const lastTailSample = source.startTime + (start + intervalSamples - 1) / sampleRate;
          if (lastSweepSample <= oldDuration) oldCompleteCycles++;
          assert.ok(lastTailSample < duration);
          controller.levelGraphData.push({ time: lastSweepSample, level: -12 }, { time: lastTailSample, level: -60 });
        }
        if (averaging === 4) assert.equal(oldCompleteCycles, 2);
        controller.levelGraphData.push({ time: duration, level: -60 }, { time: duration + 1 / sampleRate, level: 0 });
        controller.drawLevelGraphData(ctx, canvas.width, canvas.height);
        const points = strokes.at(-1).points;
        assert.equal(points.length, 2 * averaging + 2);
        assert.deepEqual(points.at(-1), ['line', 390, 210]);
        for (let index = 1; index < points.length; index++) {
          assert.ok(points[index][1] > points[index - 1][1]);
          assert.ok(points[index][1] <= 390);
        }
        const fiveSecondLabel = labels.find(label => label.text === '5s');
        assert.equal(fiveSecondLabel.x, 60 + 5 / duration * 330);
        now = controller.startTime + 1000;
        graphTimer.callback();
        assert.deepEqual(controller.levelGraphData.at(-1), { time: 1, level: -60 });
        const oldGraphTimer = controller.levelGraphInterval;
        controller.startChannelLevelGraph(duration / 2);
        assert.ok(!timers.has(oldGraphTimer));
        assert.equal(controller.levelGraphDurationSeconds, duration / 2);
        assert.deepEqual(controller.levelGraphData, [{ time: 0, level: -60 }]);
      } finally {
        controller.cancelActiveSweep();
        clearInterval(controller.levelGraphInterval);
        await cancelled;
        nowMock.mock.restore();
      }
    });
  }
});

test('live level updates append the current worklet level with elapsed measurement time', async t => {
  setAudioContext(t);
  t.mock.method(audioUtils, 'getInputLevel', () => -12);
  t.mock.method(Date, 'now', () => 123000);
  const { canvas, labels } = canvasRecorder();
  await withGlobals({ window: {}, document: { getElementById: () => canvas } }, () => {
    const controller = graphController({ startTime: 120000 });
    controller.updateLevelGraph();
    assert.deepEqual(controller.levelGraphData, [{ time: 3, level: -12 }]);
    assert.ok(labels.some(label => label.text === '0 dB'));
    assert.ok(labels.some(label => label.text === '-60 dB'));
    assert.ok(labels.some(label => label.text === 'Time (s)'));
  });
});

test('multichannel response graphs retain channel level differences using one shared reference', async () => {
  const { canvas, strokes } = canvasRecorder();
  const curves = [
    { channel: 'left', frequencyResponse: [[100, 12], [1000, 12], [10000, 12]], maxSignalLevel: -12 },
    { channel: 'right', frequencyResponse: [[100, 18], [1000, 18], [10000, 18]], maxSignalLevel: -6 }
  ];
  const original = structuredClone(curves);
  await withGlobals({ window: {}, document: { getElementById: () => canvas } }, () => {
    graphController().updateFrequencyResponseGraph(curves);
    const data = strokes.filter(stroke => stroke.width === 2);
    assert.equal(data.length, 2);
    assert.notEqual(data[0].color, data[1].color);
    for (let index = 0; index < 3; index++) {
      assert.equal(data[0].points[index][1], data[1].points[index][1]);
      assert.equal(data[0].points[index][2] - data[1].points[index][2], 23.75);
    }
    assert.deepEqual(curves, original);
  });
});

test('live response warnings identify quiet and overloaded channels independently', async () => {
  const { canvas, labels } = canvasRecorder();
  await withGlobals({ window: {}, document: { getElementById: () => canvas } }, () => {
    graphController().updateFrequencyResponseGraph([
      { channel: 'left', frequencyResponse: [[100, 0], [1000, 0]], maxSignalLevel: -40 },
      { channel: 'right', frequencyResponse: [[100, 0], [1000, 0]], maxSignalLevel: 0 }
    ]);
    const warnings = labels.filter(label => /measurement signal/.test(label.text));
    assert.equal(warnings.length, 2);
    assert.match(warnings[0].text, /too low.*Ch 1/);
    assert.match(warnings[1].text, /too high.*Ch 2/);
    assert.notEqual(warnings[0].y, warnings[1].y);
  });
});

test('single-channel response warnings respect the measurement level boundaries', async () => {
  for (const [level, expected] of [[-36, 'low'], [-1, null], [0, 'high'], [undefined, null]]) {
    const { canvas, labels } = canvasRecorder();
    await withGlobals({ window: {}, document: { getElementById: () => canvas } }, () => {
      graphController().updateFrequencyResponseGraph([[100, 0], [1000, 0]], level);
      const warnings = labels.filter(label => /measurement signal/.test(label.text));
      assert.equal(warnings.length, expected ? 1 : 0);
      if (expected) assert.ok(warnings[0].text.includes(`too ${expected}`));
    });
  }
});
