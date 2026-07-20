import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function createHub() {
  const subscriptions = [];
  let subscribeCalls = 0;
  let unsubscribeCalls = 0;
  return {
    subscriptions,
    get subscribeCalls() { return subscribeCalls; },
    get unsubscribeCalls() { return unsubscribeCalls; },
    subscribe(tapId, frameType, callback) {
      subscribeCalls++;
      const subscription = { tapId, frameType, callback, active: true };
      subscriptions.push(subscription);
      return () => {
        if (!subscription.active) return;
        subscription.active = false;
        unsubscribeCalls++;
      };
    },
    emit(frame) {
      for (const subscription of subscriptions) {
        if (subscription.active) subscription.callback(frame);
      }
    }
  };
}

function loadStereoMeter({ hub = null } = {}) {
  const source = fs.readFileSync(
    new URL('../../plugins/analyzer/stereo_meter.js', import.meta.url),
    'utf8'
  );
  const calls = [];
  const windowRef = { dspTelemetryHub: hub };
  class PluginBase {
    constructor(name, description) {
      this.name = name;
      this.description = description;
      this.enabled = true;
      this.id = null;
      this._sectionEnabled = true;
    }
    registerProcessor(processor) { this.processorString = processor; }
    updateParameters() { calls.push(['updateParameters']); }
    _setupMessageHandler() { calls.push(['baseSetupMessageHandler']); }
    cleanup() { calls.push(['baseCleanup']); }
  }
  vm.runInNewContext(source, {
    window: windowRef,
    PluginBase,
    console,
    Float32Array,
    Uint8Array,
    Uint8ClampedArray,
    DataView,
    ArrayBuffer
  }, { filename: 'stereo_meter.js' });
  return { StereoMeterPlugin: windowRef.StereoMeterPlugin, calls, windowRef };
}

function makeStereoFieldFrame({
  frameType = 6,
  version = 2,
  sequence = 0,
  frameFlags = 0,
  sampleRate = 1000,
  sampleFlags = 0,
  coordinates = [[0, 1], [-2, 0]],
  trailingBytes = 0,
  envelope = bin => bin === 270 ? 1.25 : 0,
  correlation = 0.75,
  balance = -3.5,
  peakL = 0.8,
  peakR = 0.6
} = {}) {
  const envelopeOffset = 8 + coordinates.length * 8;
  const statisticsOffset = envelopeOffset + 360 * 4;
  const buffer = new ArrayBuffer(statisticsOffset + 16 + trailingBytes);
  const payload = new DataView(buffer);
  payload.setFloat32(0, sampleRate, true);
  payload.setUint16(4, coordinates.length, true);
  payload.setUint16(6, sampleFlags, true);
  for (let sample = 0; sample < coordinates.length; sample++) {
    const [x, y] = coordinates[sample];
    payload.setFloat32(8 + sample * 8, x, true);
    payload.setFloat32(12 + sample * 8, y, true);
  }
  for (let bin = 0; bin < 360; bin++) {
    payload.setFloat32(envelopeOffset + bin * 4, envelope(bin), true);
  }
  payload.setFloat32(statisticsOffset, correlation, true);
  payload.setFloat32(statisticsOffset + 4, balance, true);
  payload.setFloat32(statisticsOffset + 8, peakL, true);
  payload.setFloat32(statisticsOffset + 12, peakR, true);
  return {
    frame: { frameType, formatVersion: version, sequence, flags: frameFlags, payload },
    payload,
    envelopeOffset,
    statisticsOffset
  };
}

function subscribedPlugin(runtime, id = 37) {
  const plugin = new runtime.StereoMeterPlugin();
  plugin.id = id;
  plugin.getParameters();
  return plugin;
}

function installDrawingContext(plugin) {
  const fillRects = [];
  const pointRects = [];
  plugin.canvas = { width: 480, height: 480 };
  plugin.graphCssWidth = 480;
  plugin.graphDpr = 1;
  plugin.ctx = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    lineWidth: 1,
    imageSmoothingEnabled: true,
    fillRect(...args) { fillRects.push(args); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    fill() {},
    rect(...args) { pointRects.push(args); },
    fillText() {},
    save() {},
    translate() {},
    rotate() {},
    restore() {}
  };
  return { fillRects, pointRects };
}

test('Stereo Meter synchronously copies v2 sample deltas into its one-second ring', () => {
  const hub = createHub();
  const runtime = loadStereoMeter({ hub });
  const plugin = subscribedPlugin(runtime, 42);
  const { frame, payload, envelopeOffset, statisticsOffset } = makeStereoFieldFrame({
    sequence: 12,
    coordinates: [[0, 1], [-2, 0], [4, -8]]
  });

  hub.emit(frame);
  payload.setFloat32(8, 123, true);
  payload.setFloat32(envelopeOffset + 270 * 4, 99, true);
  payload.setFloat32(statisticsOffset, -1, true);

  assert.equal(hub.subscribeCalls, 1);
  assert.equal(hub.subscriptions[0].tapId, 42);
  assert.equal(hub.subscriptions[0].frameType, 6);
  assert.deepEqual(Array.from(plugin.dspStereoFieldSnapshot.samples), [0, 1, -2, 0, 4, -8]);
  assert.equal(plugin.dspStereoFieldSnapshot.peakBuffer[270], 1.25);
  assert.equal(plugin.dspStereoFieldSnapshot.correlation, 0.75);
  assert.equal(plugin.dspStereoFieldSnapshot.balance, -3.5);
  assert.ok(Math.abs(plugin.dspStereoFieldSnapshot.peakL - 0.8) < 1e-6);
  assert.ok(Math.abs(plugin.dspStereoFieldSnapshot.peakR - 0.6) < 1e-6);
  assert.equal(plugin.currentMeasurements, plugin.dspStereoFieldSnapshot);
  assert.equal(plugin.dspXBuffer.length, 1000);
  assert.equal(plugin.dspBufferPosition, 3);
  assert.equal(plugin.dspXBuffer[0], 0);
  assert.ok(Math.abs(plugin.dspYBuffer[0] - 1) < 1e-4);
  assert.equal(plugin.dspXBuffer[1], -2);
  assert.equal(plugin.dspYBuffer[1], 0);
  assert.equal(plugin.dspXBuffer[2], 4);
  assert.equal(plugin.dspYBuffer[2], -8);
  assert.equal(plugin.dspLastTelemetrySequence, 12);
});

test('Stereo Meter rejects malformed, non-finite, and out-of-range payloads', () => {
  const runtime = loadStereoMeter();
  const plugin = new runtime.StereoMeterPlugin();
  const nanSample = makeStereoFieldFrame();
  nanSample.payload.setFloat32(8, Number.NaN, true);
  const nanEnvelope = makeStereoFieldFrame();
  nanEnvelope.payload.setFloat32(nanEnvelope.envelopeOffset, Number.NaN, true);
  const negativeEnvelope = makeStereoFieldFrame();
  negativeEnvelope.payload.setFloat32(negativeEnvelope.envelopeOffset, -0.01, true);
  const invalidCorrelation = makeStereoFieldFrame();
  invalidCorrelation.payload.setFloat32(invalidCorrelation.statisticsOffset, 1.01, true);
  const infiniteBalance = makeStereoFieldFrame();
  infiniteBalance.payload.setFloat32(infiniteBalance.statisticsOffset + 4, Number.POSITIVE_INFINITY, true);
  const negativePeakL = makeStereoFieldFrame();
  negativePeakL.payload.setFloat32(negativePeakL.statisticsOffset + 8, -0.01, true);
  const infinitePeakR = makeStereoFieldFrame();
  infinitePeakR.payload.setFloat32(infinitePeakR.statisticsOffset + 12, Number.POSITIVE_INFINITY, true);
  const invalid = [
    makeStereoFieldFrame({ frameType: 5 }).frame,
    makeStereoFieldFrame({ version: 1 }).frame,
    makeStereoFieldFrame({ sampleRate: 0 }).frame,
    makeStereoFieldFrame({ sampleRate: 800001 }).frame,
    makeStereoFieldFrame({ sampleFlags: 2 }).frame,
    makeStereoFieldFrame({ trailingBytes: 1 }).frame,
    nanSample.frame,
    nanEnvelope.frame,
    negativeEnvelope.frame,
    invalidCorrelation.frame,
    infiniteBalance.frame,
    negativePeakL.frame,
    infinitePeakR.frame,
    { frameType: 6, formatVersion: 2, payload: new Uint8Array(1464) }
  ];
  for (const frame of invalid) {
    assert.equal(plugin.parseDspStereoFieldTelemetryFrame(frame), null);
  }
  assert.equal(plugin.dspStereoFieldSnapshot, null);
});

test('Stereo Meter draws full-resolution age-graded samples and keeps payload statistics', () => {
  const hub = createHub();
  const runtime = loadStereoMeter({ hub });
  const plugin = subscribedPlugin(runtime);
  const { fillRects, pointRects } = installDrawingContext(plugin);
  plugin.windowTime = 0.01;
  hub.emit(makeStereoFieldFrame({
    sequence: 1,
    coordinates: [[0.25, -0.5], [-1.5, 1.25]],
    envelope: bin => bin === 90 ? 2 : 0,
    correlation: -0.5,
    balance: 6
  }).frame);

  plugin.drawMeter();

  assert.equal(pointRects.length, 10);
  assert.ok(plugin.smoothedPeaks[90] > 0);
  assert.ok(fillRects.some(call => call[0] === 0 && call[1] === 240 && call[2] === 16));
  assert.ok(fillRects.some(call => call[0] === 240 && call[1] === 464 && call[2] === 80));
});

test('Stereo Meter resets its sample ring after sequence or payload discontinuities', () => {
  const hub = createHub();
  const runtime = loadStereoMeter({ hub });
  const plugin = subscribedPlugin(runtime);
  hub.emit(makeStereoFieldFrame({ sequence: 20, coordinates: [[0.5, 0.25]] }).frame);
  hub.emit(makeStereoFieldFrame({ sequence: 21, coordinates: [[1, 0.5]] }).frame);
  assert.equal(plugin.dspBufferPosition, 2);

  hub.emit(makeStereoFieldFrame({ sequence: 23, coordinates: [[-1, -0.5]] }).frame);
  assert.equal(plugin.dspBufferPosition, 1);
  assert.ok(Math.abs(plugin.dspXBuffer[0] + 1) < 1e-4);
  assert.equal(plugin.dspXBuffer[1], 0);

  hub.emit(makeStereoFieldFrame({
    sequence: 24,
    sampleFlags: 1,
    coordinates: [[0.75, 1.5]]
  }).frame);
  assert.equal(plugin.dspBufferPosition, 1);
  assert.ok(Math.abs(plugin.dspXBuffer[0] - 0.75) < 1e-4);
});

test('Stereo Meter retains raw-buffer bucketing and statistics as processBuffer fallback', () => {
  const hub = createHub();
  const runtime = loadStereoMeter({ hub });
  const plugin = subscribedPlugin(runtime);
  hub.emit(makeStereoFieldFrame().frame);
  assert.notEqual(plugin.dspStereoFieldSnapshot, null);

  const xBuffer = new Float32Array(16);
  const yBuffer = new Float32Array(16);
  const peakBuffer = new Float32Array(360);
  plugin.onMessage({
    type: 'processBuffer',
    measurements: {
      xBuffer,
      yBuffer,
      peakBuffer,
      currentPosition: 0,
      time: 1,
      sampleRate: 100
    }
  });

  assert.equal(plugin.dspStereoFieldSnapshot, null);
  assert.equal(plugin.currentMeasurements.xBuffer, xBuffer);
  assert.match(plugin.processorString, /right = data\[i \+ blockSize\]/);
  assert.match(plugin.processorString, /Math\.exp\(-timeDelta \* LOG10\)/);
  assert.match(plugin.processorString, /measurementInterval = 1 \/ 60/);
  assert.match(plugin.drawMeter.toString(), /buckets\[green\]\.push/);
});

test('Stereo Meter v2 keeps full-precision 96 kHz deltas below 0.9 MB/s', () => {
  const coordinateBytesPerSecond = 96000 * 8;
  const fixedFrameBytes = (16 + 1464 + 3) & ~3;
  assert.equal(coordinateBytesPerSecond, 768000);
  assert.equal(fixedFrameBytes, 1480);
  assert.ok(coordinateBytesPerSecond + fixedFrameBytes * 60 < 900000);
});

test('Stereo Meter deduplicates, rebinds, and cleans up telemetry subscriptions', () => {
  const firstHub = createHub();
  const runtime = loadStereoMeter({ hub: firstHub });
  const plugin = subscribedPlugin(runtime, 7);
  plugin.getParameters();
  plugin._setupMessageHandler();
  assert.equal(firstHub.subscribeCalls, 1);

  const secondHub = createHub();
  runtime.windowRef.dspTelemetryHub = secondHub;
  plugin._setupMessageHandler();
  assert.equal(firstHub.unsubscribeCalls, 1);
  assert.equal(secondHub.subscribeCalls, 1);

  plugin.cleanup();
  plugin.cleanup();
  assert.equal(secondHub.unsubscribeCalls, 1);
  assert.ok(runtime.calls.some(call => call[0] === 'baseCleanup'));
});
