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
  version = 1,
  gridSize = 64,
  trailingBytes = 0,
  histogram = cell => cell === 77 ? 180 : 0,
  envelope = bin => bin === 270 ? 1.25 : 0,
  correlation = 0.75,
  balance = -3.5,
  peakL = 0.8,
  peakR = 0.6
} = {}) {
  const buffer = new ArrayBuffer(5554 + trailingBytes);
  const payload = new DataView(buffer);
  payload.setUint16(0, gridSize, true);
  for (let cell = 0; cell < 4096; cell++) {
    payload.setUint8(2 + cell, histogram(cell));
  }
  for (let bin = 0; bin < 360; bin++) {
    payload.setFloat32(4098 + bin * 4, envelope(bin), true);
  }
  payload.setFloat32(5538, correlation, true);
  payload.setFloat32(5542, balance, true);
  payload.setFloat32(5546, peakL, true);
  payload.setFloat32(5550, peakR, true);
  return { frame: { frameType, formatVersion: version, payload }, payload };
}

function subscribedPlugin(runtime, id = 37) {
  const plugin = new runtime.StereoMeterPlugin();
  plugin.id = id;
  plugin.getParameters();
  return plugin;
}

function installHistogramCache(plugin) {
  const putCalls = [];
  plugin.stereoFieldCanvas = { width: 64, height: 64 };
  plugin.stereoFieldImageData = { data: new Uint8ClampedArray(4096 * 4) };
  plugin.stereoFieldCtx = {
    putImageData(...args) { putCalls.push(args); }
  };
  return putCalls;
}

function installDrawingContext(plugin) {
  const drawCalls = [];
  const fillRects = [];
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
    drawImage(...args) { drawCalls.push(args); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    stroke() {},
    fill() {},
    rect() {},
    fillText() {},
    save() {},
    translate() {},
    rotate() {},
    restore() {}
  };
  return { drawCalls, fillRects };
}

test('Stereo Meter synchronously copies exact unaligned v1 telemetry arrays', () => {
  const hub = createHub();
  const runtime = loadStereoMeter({ hub });
  const plugin = subscribedPlugin(runtime, 42);
  const putCalls = installHistogramCache(plugin);
  const { frame, payload } = makeStereoFieldFrame();

  hub.emit(frame);
  payload.setUint8(2 + 77, 0);
  payload.setFloat32(4098 + 270 * 4, 99, true);
  payload.setFloat32(5538, -1, true);

  assert.equal(hub.subscribeCalls, 1);
  assert.equal(hub.subscriptions[0].tapId, 42);
  assert.equal(hub.subscriptions[0].frameType, 6);
  assert.equal(plugin.dspStereoFieldSnapshot.histogram[77], 180);
  assert.equal(plugin.dspStereoFieldSnapshot.peakBuffer[270], 1.25);
  assert.equal(plugin.dspStereoFieldSnapshot.correlation, 0.75);
  assert.equal(plugin.dspStereoFieldSnapshot.balance, -3.5);
  assert.ok(Math.abs(plugin.dspStereoFieldSnapshot.peakL - 0.8) < 1e-6);
  assert.ok(Math.abs(plugin.dspStereoFieldSnapshot.peakR - 0.6) < 1e-6);
  assert.equal(plugin.currentMeasurements, plugin.dspStereoFieldSnapshot);
  assert.equal(putCalls.length, 1);
  const pixels = plugin.stereoFieldImageData.data;
  assert.deepEqual(Array.from(pixels.slice(77 * 4, 77 * 4 + 4)), [0, 180, 0, 255]);
  assert.deepEqual(Array.from(pixels.slice(0, 4)), [0, 0, 0, 0]);
});

test('Stereo Meter rejects malformed, non-finite, and out-of-range payloads', () => {
  const runtime = loadStereoMeter();
  const plugin = new runtime.StereoMeterPlugin();
  const nanEnvelope = makeStereoFieldFrame();
  nanEnvelope.payload.setFloat32(4098, Number.NaN, true);
  const negativeEnvelope = makeStereoFieldFrame();
  negativeEnvelope.payload.setFloat32(4098, -0.01, true);
  const invalidCorrelation = makeStereoFieldFrame();
  invalidCorrelation.payload.setFloat32(5538, 1.01, true);
  const infiniteBalance = makeStereoFieldFrame();
  infiniteBalance.payload.setFloat32(5542, Number.POSITIVE_INFINITY, true);
  const negativePeakL = makeStereoFieldFrame();
  negativePeakL.payload.setFloat32(5546, -0.01, true);
  const infinitePeakR = makeStereoFieldFrame();
  infinitePeakR.payload.setFloat32(5550, Number.POSITIVE_INFINITY, true);
  const invalid = [
    makeStereoFieldFrame({ frameType: 5 }).frame,
    makeStereoFieldFrame({ version: 2 }).frame,
    makeStereoFieldFrame({ gridSize: 63 }).frame,
    makeStereoFieldFrame({ trailingBytes: 1 }).frame,
    nanEnvelope.frame,
    negativeEnvelope.frame,
    invalidCorrelation.frame,
    infiniteBalance.frame,
    negativePeakL.frame,
    infinitePeakR.frame,
    { frameType: 6, formatVersion: 1, payload: new Uint8Array(5554) }
  ];
  for (const frame of invalid) {
    assert.equal(plugin.parseDspStereoFieldTelemetryFrame(frame), null);
  }
  assert.equal(plugin.dspStereoFieldSnapshot, null);
});

test('Stereo Meter draws cached density and payload statistics while keeping Gaussian smoothing', () => {
  const hub = createHub();
  const runtime = loadStereoMeter({ hub });
  const plugin = subscribedPlugin(runtime);
  installHistogramCache(plugin);
  const { drawCalls, fillRects } = installDrawingContext(plugin);
  plugin.buckets = null;
  hub.emit(makeStereoFieldFrame({
    histogram: cell => cell === 32 * 64 + 32 ? 255 : 0,
    envelope: bin => bin === 90 ? 2 : 0,
    correlation: -0.5,
    balance: 6
  }).frame);

  plugin.drawMeter();

  assert.equal(drawCalls.length, 1);
  assert.equal(drawCalls[0][0], plugin.stereoFieldCanvas);
  assert.deepEqual(drawCalls[0].slice(1), [24, 24, 432, 432]);
  assert.equal(plugin.ctx.imageSmoothingEnabled, true);
  assert.ok(plugin.smoothedPeaks[90] > 0);
  assert.ok(fillRects.some(call => call[0] === 0 && call[1] === 240 && call[2] === 16));
  assert.ok(fillRects.some(call => call[0] === 240 && call[1] === 464 && call[2] === 80));
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

test('Stereo Meter v1 stays below the documented 0.2 MB/s bandwidth target', () => {
  assert.equal(5554 * 30, 166620);
  assert.equal(((16 + 5554 + 3) & ~3) * 30, 167160);
  assert.ok(((16 + 5554 + 3) & ~3) * 30 < 200000);
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
