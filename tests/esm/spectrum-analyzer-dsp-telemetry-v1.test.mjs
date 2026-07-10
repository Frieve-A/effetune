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

function loadSpectrumAnalyzer({ hub = null } = {}) {
  const source = fs.readFileSync(
    new URL('../../plugins/analyzer/spectrum_analyzer.js', import.meta.url),
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
    DataView,
    ArrayBuffer
  }, { filename: 'spectrum_analyzer.js' });
  return { SpectrumAnalyzerPlugin: windowRef.SpectrumAnalyzerPlugin, calls, windowRef };
}

function makeSpectrumFrame({
  frameType = 4,
  version = 1,
  sampleRate = 48000,
  points = 8,
  flags = points === 14 ? 1 : 0,
  binCount = points === 14 ? 8190 : (1 << (points - 1)) + 1,
  trailingBytes = 0,
  currentValue = bin => -120 + bin / 1000,
  peakValue = bin => bin === 8 ? -1 : -100
} = {}) {
  const buffer = new ArrayBuffer(12 + binCount * 8 + trailingBytes);
  const payload = new DataView(buffer);
  payload.setFloat32(0, sampleRate, true);
  payload.setUint32(4, binCount, true);
  payload.setUint16(8, points, true);
  payload.setUint16(10, flags, true);
  for (let bin = 0; bin < binCount; bin++) {
    payload.setFloat32(12 + bin * 4, currentValue(bin), true);
    payload.setFloat32(12 + binCount * 4 + bin * 4, peakValue(bin), true);
  }
  return { frame: { frameType, formatVersion: version, payload }, payload };
}

function subscribedPlugin(runtime, id = 37) {
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  plugin.id = id;
  plugin.getParameters();
  return plugin;
}

test('Spectrum Analyzer synchronously copies v1 telemetry without running a main-thread FFT', () => {
  const hub = createHub();
  const runtime = loadSpectrumAnalyzer({ hub });
  const plugin = subscribedPlugin(runtime, 42);
  let fftCalls = 0;
  plugin.fft = () => { fftCalls++; };
  const { frame, payload } = makeSpectrumFrame({
    sampleRate: 96000,
    currentValue: bin => bin === 8 ? -3.25 : -120,
    peakValue: bin => bin === 8 ? -1.5 : -100
  });

  hub.emit(frame);
  payload.setFloat32(12 + 8 * 4, 99, true);
  payload.setFloat32(12 + 129 * 4 + 8 * 4, 99, true);

  assert.equal(hub.subscribeCalls, 1);
  assert.equal(hub.subscriptions[0].tapId, 42);
  assert.equal(hub.subscriptions[0].frameType, 4);
  assert.equal(fftCalls, 0);
  assert.equal(plugin.sampleRate, 96000);
  assert.equal(plugin.spectrumPoints, 8);
  assert.equal(plugin.spectrum.length, 129);
  assert.equal(plugin.spectrum[8], -3.25);
  assert.equal(plugin.peaks[8], -1.5);
  assert.equal(plugin.dspSpectrumSnapshot.current[8], -3.25);
  assert.equal(plugin.dspSpectrumSnapshot.peaks[8], -1.5);
});

test('Spectrum Analyzer accepts only the exact pt=14 truncated maximum payload contract', () => {
  const runtime = loadSpectrumAnalyzer();
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  const { frame, payload } = makeSpectrumFrame({ points: 14 });
  const parsed = plugin.parseDspSpectrumTelemetryFrame(frame);

  assert.equal(payload.byteLength, 65532);
  assert.equal(parsed.binCount, 8190);
  assert.equal(parsed.points, 14);
  assert.equal(parsed.flags, 1);
  assert.equal(parsed.binsTruncated, true);
  assert.equal(parsed.current.length, 8190);
  assert.equal(parsed.peaks.length, 8190);
  assert.ok(Math.abs(parsed.current[8189] - (-120 + 8.189)) < 1e-5);

  assert.equal(plugin.parseDspSpectrumTelemetryFrame(
    makeSpectrumFrame({ points: 14, flags: 0, binCount: 8193 }).frame
  ), null);
  assert.equal(plugin.parseDspSpectrumTelemetryFrame(
    makeSpectrumFrame({ points: 14, flags: 1, binCount: 8189 }).frame
  ), null);
  assert.equal(plugin.parseDspSpectrumTelemetryFrame(
    makeSpectrumFrame({ points: 13, flags: 1, binCount: 4094 }).frame
  ), null);
});

test('Spectrum Analyzer rejects malformed, non-finite, and incompatible v1 payloads', () => {
  const runtime = loadSpectrumAnalyzer();
  const plugin = new runtime.SpectrumAnalyzerPlugin();
  const nonFiniteCurrent = makeSpectrumFrame();
  nonFiniteCurrent.payload.setFloat32(12, Number.NaN, true);
  const nonFinitePeak = makeSpectrumFrame();
  nonFinitePeak.payload.setFloat32(12 + 129 * 4, Number.POSITIVE_INFINITY, true);
  const highPeak = makeSpectrumFrame();
  highPeak.payload.setFloat32(12 + 129 * 4, 0.01, true);
  const lowPeak = makeSpectrumFrame();
  lowPeak.payload.setFloat32(12 + 129 * 4, -145.01, true);
  const invalid = [
    makeSpectrumFrame({ frameType: 5 }).frame,
    makeSpectrumFrame({ version: 2 }).frame,
    makeSpectrumFrame({ sampleRate: Number.NaN }).frame,
    makeSpectrumFrame({ sampleRate: 0 }).frame,
    makeSpectrumFrame({ points: 7, binCount: 65 }).frame,
    makeSpectrumFrame({ points: 15, binCount: 16385 }).frame,
    makeSpectrumFrame({ flags: 2 }).frame,
    makeSpectrumFrame({ binCount: 128 }).frame,
    makeSpectrumFrame({ trailingBytes: 4 }).frame,
    nonFiniteCurrent.frame,
    nonFinitePeak.frame,
    highPeak.frame,
    lowPeak.frame,
    { frameType: 4, formatVersion: 1, payload: new Uint8Array(64) }
  ];

  for (const frame of invalid) {
    assert.equal(plugin.parseDspSpectrumTelemetryFrame(frame), null);
  }
  assert.equal(plugin.dspSpectrumSnapshot, null);
});

test('Spectrum Analyzer retains its legacy processBuffer FFT as the fallback path', () => {
  const hub = createHub();
  const runtime = loadSpectrumAnalyzer({ hub });
  const plugin = subscribedPlugin(runtime);
  hub.emit(makeSpectrumFrame().frame);
  assert.notEqual(plugin.dspSpectrumSnapshot, null);

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
  assert.equal(plugin.dspSpectrumSnapshot, null);
  assert.equal(plugin.spectrumPoints, 8);
  assert.equal(plugin.spectrum.length, 128);
  assert.match(plugin.processorString, /Float32Array\.from\(context\.buffer\[0\]\)/);
  assert.match(plugin.processorString, /bufferPosition % \(fftSize \/ 2\) === 0/);
});

test('Spectrum Analyzer deduplicates, rebinds, and cleans up telemetry subscriptions', () => {
  const firstHub = createHub();
  const runtime = loadSpectrumAnalyzer({ hub: firstHub });
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
