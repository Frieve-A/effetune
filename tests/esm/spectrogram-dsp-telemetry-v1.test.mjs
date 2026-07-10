import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';

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

function loadSpectrogram({ hub = null } = {}) {
  const source = fs.readFileSync(
    new URL('../../plugins/analyzer/spectrogram.js', import.meta.url),
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
    performance,
    console,
    Float32Array,
    Uint8Array,
    Uint8ClampedArray,
    DataView,
    ArrayBuffer
  }, { filename: 'spectrogram.js' });
  return { SpectrogramPlugin: windowRef.SpectrogramPlugin, calls, windowRef };
}

function makeSpectrogramFrame({
  frameType = 5,
  version = 1,
  sampleRate = 48000,
  timeSeconds = 0,
  cellCount = 256,
  points = 8,
  trailingBytes = 0,
  intensity = row => row
} = {}) {
  const buffer = new ArrayBuffer(268 + trailingBytes);
  const payload = new DataView(buffer);
  payload.setFloat32(0, sampleRate, true);
  payload.setFloat32(4, timeSeconds, true);
  payload.setUint16(8, cellCount, true);
  payload.setUint16(10, points, true);
  for (let row = 0; row < 256; row++) {
    payload.setUint8(12 + row, intensity(row));
  }
  return { frame: { frameType, formatVersion: version, payload }, payload };
}

function subscribedPlugin(runtime, id = 37) {
  const plugin = new runtime.SpectrogramPlugin();
  plugin.id = id;
  plugin.getParameters();
  return plugin;
}

function installCanvasStubs(plugin) {
  const drawCalls = [];
  const putCalls = [];
  plugin.imageDataCache = { data: new Uint8ClampedArray(256 * 1024 * 4) };
  plugin.tempCtx = {
    putImageData(...args) { putCalls.push(args); }
  };
  plugin.tempCanvas = { width: 1024, height: 256 };
  plugin.canvas = { width: 1024, height: 256 };
  plugin.canvasCtx = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: '',
    lineWidth: 1,
    fillRect() {},
    drawImage(...args) { drawCalls.push(args); },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
    save() {},
    translate() {},
    rotate() {},
    restore() {}
  };
  return { drawCalls, putCalls };
}

test('Spectrogram synchronously copies v1 columns without running a main-thread FFT', () => {
  const hub = createHub();
  const runtime = loadSpectrogram({ hub });
  const plugin = subscribedPlugin(runtime, 42);
  const { putCalls } = installCanvasStubs(plugin);
  let fftCalls = 0;
  plugin.fft = () => { fftCalls++; };
  const { frame, payload } = makeSpectrogramFrame({
    sampleRate: 96000,
    timeSeconds: 1.25,
    intensity: row => row === 123 ? 254 : row
  });

  hub.emit(frame);
  payload.setUint8(12 + 123, 0);

  assert.equal(hub.subscribeCalls, 1);
  assert.equal(hub.subscriptions[0].tapId, 42);
  assert.equal(hub.subscriptions[0].frameType, 5);
  assert.equal(fftCalls, 0);
  assert.equal(plugin.sampleRate, 96000);
  assert.equal(plugin.dspSpectrogramActive, true);
  assert.equal(plugin.spectrogramWriteColumn, 1);
  assert.equal(plugin.spectrogramColumnCount, 1);
  assert.equal(plugin.spectrogramIntensityBuffer[123 * 1024], 254);
  assert.equal(putCalls.length, 2);
  assert.deepEqual(putCalls[1].slice(1), [0, 0, 0, 0, 1, 256]);
});

test('Spectrogram ring paints one physical column and draws it in chronological order', () => {
  const hub = createHub();
  const runtime = loadSpectrogram({ hub });
  const plugin = subscribedPlugin(runtime);
  const { drawCalls, putCalls } = installCanvasStubs(plugin);

  hub.emit(makeSpectrogramFrame({ intensity: () => 64 }).frame);
  hub.emit(makeSpectrogramFrame({ timeSeconds: 0.01, intensity: () => 192 }).frame);
  assert.equal(plugin.spectrogramIntensityBuffer[100 * 1024], 64);
  assert.equal(plugin.spectrogramIntensityBuffer[100 * 1024 + 1], 192);
  assert.equal(plugin.spectrogramWriteColumn, 2);
  assert.equal(putCalls.length, 3);

  putCalls.length = 0;
  plugin.drawGraph();
  assert.equal(putCalls.length, 0);
  assert.equal(drawCalls.length, 2);
  assert.deepEqual(drawCalls[0].slice(1, 5), [2, 0, 1022, 256]);
  assert.deepEqual(drawCalls[1].slice(1, 5), [0, 0, 2, 256]);
  assert.equal(drawCalls[0][5], 0);
  assert.equal(drawCalls[1][5], 1022);

  plugin.setPoints(10);
  assert.equal(plugin.spectrogramWriteColumn, 0);
  assert.equal(plugin.spectrogramColumnCount, 0);
  assert.equal(plugin.spectrogramIntensityBuffer[100 * 1024], 0);
  assert.equal(putCalls.length, 1);
  assert.deepEqual(putCalls[0].slice(1), [0, 0]);
});

test('Spectrogram color LUT freezes the legacy seven-stop gradient', () => {
  const runtime = loadSpectrogram();
  const plugin = new runtime.SpectrogramPlugin();
  for (const intensity of [0, 42, 85, 128, 170, 212, 255]) {
    const db = plugin.dr + intensity / 255 * -plugin.dr;
    assert.deepEqual(
      Array.from(plugin.spectrogramColorLut.slice(intensity * 3, intensity * 3 + 3)),
      Array.from(plugin.dbToColor(db))
    );
  }
  assert.deepEqual(Array.from(plugin.spectrogramColorLut.slice(0, 3)), [0, 0, 0]);
  assert.deepEqual(Array.from(plugin.spectrogramColorLut.slice(255 * 3)), [191, 191, 191]);
});

test('Spectrogram markers tolerate equal f32 timestamps and reset on regression', () => {
  const hub = createHub();
  const runtime = loadSpectrogram({ hub });
  const plugin = subscribedPlugin(runtime);

  hub.emit(makeSpectrogramFrame({ timeSeconds: 16777216 }).frame);
  hub.emit(makeSpectrogramFrame({ timeSeconds: 16777216 }).frame);
  assert.deepEqual(Array.from(plugin.secondMarkers), []);
  hub.emit(makeSpectrogramFrame({ timeSeconds: 16777218 }).frame);
  assert.deepEqual(Array.from(plugin.secondMarkers), [1023]);
  hub.emit(makeSpectrogramFrame({ timeSeconds: 16777218 }).frame);
  assert.deepEqual(Array.from(plugin.secondMarkers), [1022]);
  hub.emit(makeSpectrogramFrame({ timeSeconds: 10 }).frame);
  assert.deepEqual(Array.from(plugin.secondMarkers), []);
  assert.equal(plugin.prevTime, 10);
  hub.emit(makeSpectrogramFrame({ timeSeconds: 11 }).frame);
  assert.deepEqual(Array.from(plugin.secondMarkers), [1023]);
});

test('Spectrogram rejects malformed and incompatible v1 payloads', () => {
  const runtime = loadSpectrogram();
  const plugin = new runtime.SpectrogramPlugin();
  const invalid = [
    makeSpectrogramFrame({ frameType: 4 }).frame,
    makeSpectrogramFrame({ version: 2 }).frame,
    makeSpectrogramFrame({ sampleRate: Number.NaN }).frame,
    makeSpectrogramFrame({ sampleRate: 0 }).frame,
    makeSpectrogramFrame({ timeSeconds: Number.POSITIVE_INFINITY }).frame,
    makeSpectrogramFrame({ cellCount: 255 }).frame,
    makeSpectrogramFrame({ points: 7 }).frame,
    makeSpectrogramFrame({ points: 15 }).frame,
    makeSpectrogramFrame({ trailingBytes: 1 }).frame,
    { frameType: 5, formatVersion: 1, payload: new Uint8Array(268) }
  ];
  for (const frame of invalid) {
    assert.equal(plugin.parseDspSpectrogramTelemetryFrame(frame), null);
  }
  const parsed = plugin.parseDspSpectrogramTelemetryFrame(makeSpectrogramFrame().frame);
  assert.equal(parsed.cellCount, 256);
  assert.equal(parsed.points, 8);
  assert.equal(parsed.intensities.length, 256);
});

test('Spectrogram retains processBuffer FFT and scroll behavior as fallback', () => {
  const hub = createHub();
  const runtime = loadSpectrogram({ hub });
  const plugin = subscribedPlugin(runtime);
  hub.emit(makeSpectrogramFrame().frame);
  assert.equal(plugin.dspSpectrogramActive, true);

  plugin.setPoints(8);
  const originalFft = plugin.fft;
  let fftCalls = 0;
  plugin.fft = function(real, imag) {
    fftCalls++;
    return originalFft.call(this, real, imag);
  };
  const average = new Float32Array(256);
  average[0] = 1;
  plugin.onMessage({
    type: 'processBuffer',
    measurements: {
      buffer: [average],
      bufferPosition: 0,
      time: 1,
      sampleRate: 32000
    }
  });

  assert.equal(fftCalls, 1);
  assert.equal(plugin.dspSpectrogramActive, false);
  assert.equal(plugin.spectrum.length, 128);
  assert.match(plugin.processorString, /Float32Array\.from\(context\.buffer\[0\]\)/);
  assert.match(plugin.processorString, /bufferPosition % \(fftSize \/ 2\) === 0/);
  assert.match(plugin.process.toString(), /copyWithin/);
});

test('Spectrogram deduplicates, rebinds, and cleans up telemetry subscriptions', () => {
  const firstHub = createHub();
  const runtime = loadSpectrogram({ hub: firstHub });
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
