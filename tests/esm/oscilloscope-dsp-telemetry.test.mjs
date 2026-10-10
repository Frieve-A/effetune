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
    get subscribeCalls() {
      return subscribeCalls;
    },
    get unsubscribeCalls() {
      return unsubscribeCalls;
    },
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

function createCanvasContext() {
  const calls = [];
  return {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }; },
    setTransform() {},
    resetTransform() {},
    clearRect(...args) { calls.push(['clearRect', ...args]); },
    drawImage(...args) { calls.push(['drawImage', ...args]); },
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(...args) { calls.push(['moveTo', ...args]); },
    lineTo(...args) { calls.push(['lineTo', ...args]); },
    closePath() { calls.push(['closePath']); },
    fill() { calls.push(['fill']); },
    stroke() { calls.push(['stroke']); },
    fillText(...args) { calls.push(['fillText', ...args]); },
    save() { calls.push(['save']); },
    translate(...args) { calls.push(['translate', ...args]); },
    rotate(...args) { calls.push(['rotate', ...args]); },
    restore() { calls.push(['restore']); }
  };
}

function createElement(tagName) {
  const context = tagName === 'canvas' ? createCanvasContext() : null;
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    style: {},
    className: '',
    textContent: '',
    width: tagName === 'canvas' ? 1024 : 0,
    height: tagName === 'canvas' ? 480 : 0,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
    removeEventListener() {},
    getContext() {
      return context;
    }
  };
}

function loadOscilloscope({ hub = null, now = () => 0 } = {}) {
  const source = fs.readFileSync(
    new URL('../../plugins/analyzer/oscilloscope.js', import.meta.url),
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
      // UI-follow seam: hooks are kept so a test can run them on demand.
      this.uiRefreshHooks = [];
    }

    registerProcessor(processor) {
      this.processorString = processor;
    }

    registerUIRefresh(fn) {
      this.uiRefreshHooks.push(fn);
    }

    isGraphPointerActive() {
      return false;
    }

    _setupMessageHandler() {
      calls.push(['baseSetupMessageHandler']);
    }

    updateParameters() {
      calls.push(['updateParameters']);
    }

    cleanup() {
      calls.push(['baseCleanup']);
    }

    createParameterControl(...args) {
      calls.push(['parameterControl', ...args]);
      return createElement('div');
    }

    createResponsiveGraph(options) {
      const canvas = createElement('canvas');
      const container = createElement('div');
      return {
        canvas,
        container,
        dispose() {
          calls.push(['graphDispose']);
        },
        resize() {
          options.onResize({ canvas, cssWidth: 1024, dpr: 1 });
        }
      };
    }
  }

  class IntersectionObserver {
    observe() {
      calls.push(['observerObserve']);
    }

    unobserve() {
      calls.push(['observerUnobserve']);
    }

    disconnect() {
      calls.push(['observerDisconnect']);
    }
  }

  const context = {
    window: windowRef,
    document: {
      createElement,
      createTextNode(textContent) {
        return { textContent };
      }
    },
    PluginBase,
    IntersectionObserver,
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
    console,
    performance: { now },
    Float32Array,
    DataView,
    ArrayBuffer
  };
  vm.runInNewContext(source, context, { filename: 'oscilloscope.js' });
  return { OscilloscopePlugin: windowRef.OscilloscopePlugin, calls, windowRef };
}

function makeM4Buckets() {
  return Array.from({ length: 512 }, () => ({
    first: 0,
    minimum: 0,
    maximum: 0,
    last: 0,
    minimumOffset: 0,
    maximumOffset: 0
  }));
}

function makeScopeFrame({
  version = 2,
  frameType = 3,
  sampleRate = 48000,
  triggerOffset = 0,
  encoding = 0,
  triggered = 1,
  flags = triggered,
  values = [0.25, -0.5, 0.75],
  captureSampleCount = encoding === 0 ? values.length : 4096,
  bucketCount = encoding === 1 ? 512 : 0,
  buckets = null,
  trailingBytes = 0
} = {}) {
  const payloadBytes = encoding === 0
    ? 16 + captureSampleCount * 4
    : 16 + bucketCount * 18;
  const buffer = new ArrayBuffer(payloadBytes + trailingBytes);
  const payload = new DataView(buffer);
  payload.setFloat32(0, sampleRate, true);
  payload.setUint32(4, captureSampleCount, true);
  payload.setUint32(8, triggerOffset, true);
  payload.setUint16(12, bucketCount, true);
  payload.setUint8(14, encoding);
  payload.setUint8(15, flags);
  if (encoding === 0) {
    for (let index = 0; index < captureSampleCount; index++) {
      payload.setFloat32(16 + index * 4, values[index] ?? 0, true);
    }
  } else {
    const records = buckets || makeM4Buckets();
    for (let bucket = 0; bucket < bucketCount; bucket++) {
      const record = records[bucket] || {};
      const offset = 16 + bucket * 18;
      payload.setFloat32(offset, record.first ?? 0, true);
      payload.setFloat32(offset + 4, record.minimum ?? 0, true);
      payload.setFloat32(offset + 8, record.maximum ?? 0, true);
      payload.setFloat32(offset + 12, record.last ?? 0, true);
      payload.setUint8(offset + 16, record.minimumOffset ?? 0);
      payload.setUint8(offset + 17, record.maximumOffset ?? 0);
    }
  }
  return { frame: { frameType, formatVersion: version, payload }, payload };
}

function createSubscribedPlugin(runtime, id = 23) {
  const plugin = new runtime.OscilloscopePlugin();
  plugin.id = id;
  plugin.getParameters();
  return plugin;
}

function makeEnvelopeFrame({ sampleRate = 48000, captureSampleCount = sampleRate * 10,
  endSample = captureSampleCount, bucketSamples = Math.ceil(captureSampleCount / 4096),
  bucketCount = Math.ceil(endSample / bucketSamples), flags = 2, extrema = null } = {}) {
  const payload = new DataView(new ArrayBuffer(28 + bucketCount * 8));
  payload.setFloat32(0, sampleRate, true);
  payload.setUint32(4, captureSampleCount, true);
  payload.setUint16(12, bucketCount, true);
  payload.setUint8(14, 2);
  payload.setUint8(15, flags);
  payload.setUint32(16, bucketSamples, true);
  payload.setUint32(20, endSample % 0x100000000, true);
  payload.setUint32(24, Math.floor(endSample / 0x100000000), true);
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    payload.setFloat32(28 + bucket * 8, extrema?.[bucket * 2] ?? -0.25, true);
    payload.setFloat32(32 + bucket * 8, extrema?.[bucket * 2 + 1] ?? 0.5, true);
  }
  return { frame: { frameType: 3, formatVersion: 3, payload }, payload };
}

function executeFallback(plugin, state, values, time, sampleRate = 48000) {
  const processor = new Function('context', 'data', 'parameters', 'time', plugin.processorString);
  const data = Float32Array.from(values);
  assert.equal(processor(state, data, { ...plugin.getParameters(), sampleRate,
    channelCount: 1, blockSize: data.length }, time), data);
  if (data.measurements) plugin.onMessage({ type: 'processBuffer', measurements: data.measurements });
  return data.measurements;
}

test('Oscilloscope copies exact raw v2 snapshots during hub dispatch', () => {
  const hub = createHub();
  const runtime = loadOscilloscope({ hub });
  const plugin = createSubscribedPlugin(runtime, 42);
  const { frame, payload } = makeScopeFrame({
    sampleRate: 96000,
    triggerOffset: 1,
    triggered: 1,
    values: [-0.25, 0.5, 1.25]
  });

  hub.emit(frame);
  payload.setFloat32(16, 99, true);

  assert.equal(hub.subscribeCalls, 1);
  assert.equal(hub.subscriptions[0].tapId, 42);
  assert.equal(hub.subscriptions[0].frameType, 3);
  assert.equal(plugin.sampleRate, 96000);
  assert.equal(plugin.scopeSnapshot.triggerOffsetInSnapshot, 1);
  assert.equal(plugin.scopeSnapshot.triggered, true);
  assert.deepEqual(Array.from(plugin.scopeSnapshot.values), [-0.25, 0.5, 1.25]);
  assert.deepEqual(Array.from(plugin.frozenDisplayBuffer), [-0.25, 0.5, 1.25]);
});

test('Oscilloscope orders M4 extrema by sample position and draws one continuous path', () => {
  const hub = createHub();
  const runtime = loadOscilloscope({ hub });
  const plugin = createSubscribedPlugin(runtime);
  const buckets = makeM4Buckets();
  buckets[0] = {
    first: 0,
    minimum: -1,
    maximum: 1,
    last: 0.5,
    minimumOffset: 5,
    maximumOffset: 2
  };

  hub.emit(makeScopeFrame({ encoding: 1, triggered: 0, buckets }).frame);
  const canvas = createElement('canvas');
  plugin.canvas = canvas;
  plugin.ctx = canvas.getContext('2d');
  plugin.drawWaveform();

  assert.equal(plugin.scopeSnapshot.encoding, 1);
  assert.equal(plugin.scopeSnapshot.captureSampleCount, 4096);
  assert.equal(plugin.scopeSnapshot.bucketCount, 512);
  assert.equal(plugin.scopeSnapshot.triggered, false);
  assert.equal(plugin.frozenDisplayBuffer, null);
  assert.deepEqual(
    Array.from(plugin.scopeSnapshot.sampleIndices.slice(0, 6)),
    [0, 2, 5, 7, 8, 15]
  );
  assert.deepEqual(
    Array.from(plugin.scopeSnapshot.values.slice(0, 6)),
    [0, 1, -1, 0.5, 0, 0]
  );
  const gridCalls = plugin.scopeGrid.canvas.getContext('2d').calls;
  assert.ok(gridCalls.some(call => call[0] === 'fillText' && call[1] === 'Time (ms)'));
  assert.ok(gridCalls.some(call => call[0] === 'fillText' && call[1] === 'Amplitude'));
  const waveformCalls = plugin.scopeRaster.canvas.getContext('2d').calls;
  assert.equal(waveformCalls.filter(call => call[0] === 'moveTo').length, 1);
  assert.equal(
    waveformCalls.filter(call => call[0] === 'lineTo').length,
    plugin.scopeSnapshot.values.length - 1
  );
});

test('Oscilloscope rejects malformed, non-finite, and version-mismatched frames', () => {
  const runtime = loadOscilloscope();
  const plugin = new runtime.OscilloscopePlugin();
  const reversedExtrema = makeM4Buckets();
  reversedExtrema[0] = { minimum: 1, maximum: -1 };
  const invalidOffset = makeM4Buckets();
  invalidOffset[0] = { maximumOffset: 8 };
  const invalid = [
    makeScopeFrame({ version: 1 }).frame,
    makeScopeFrame({ frameType: 4 }).frame,
    makeScopeFrame({ sampleRate: Number.NaN }).frame,
    makeScopeFrame({ triggerOffset: 3 }).frame,
    makeScopeFrame({ flags: 2 }).frame,
    makeScopeFrame({ encoding: 2 }).frame,
    makeScopeFrame({ captureSampleCount: 2049, values: [] }).frame,
    makeScopeFrame({ trailingBytes: 4 }).frame,
    makeScopeFrame({ encoding: 1, bucketCount: 511 }).frame,
    makeScopeFrame({ values: [Number.NaN] }).frame,
    makeScopeFrame({ encoding: 1, buckets: reversedExtrema }).frame,
    makeScopeFrame({ encoding: 1, buckets: invalidOffset }).frame,
    { frameType: 3, formatVersion: 2, payload: new Uint8Array(20) }
  ];

  for (const frame of invalid) {
    assert.equal(plugin.parseDspScopeTelemetryFrame(frame), null);
  }
  assert.equal(plugin.scopeSnapshot, null);
});

test('Oscilloscope fallback transfers compact snapshots and preserves short raw windows', () => {
  const runtime = loadOscilloscope();
  const plugin = new runtime.OscilloscopePlugin();
  plugin.setTriggerMode('Off');
  plugin.setDisplayTime(0.004);
  const state = {};
  const measurements = executeFallback(plugin, state, [0.1, 0.2, 0.3, 0.4], 0, 1000);
  assert.equal(measurements.buffer, undefined);
  assert.deepEqual(Array.from(plugin.frozenDisplayBuffer), [0.1, 0.2, 0.3, 0.4].map(Math.fround));
  assert.equal(executeFallback(plugin, state, [0.5], 0.01, 1000), undefined);
  executeFallback(plugin, state, [0.6], 0.04, 1000);
  assert.deepEqual(Array.from(plugin.frozenDisplayBuffer), [0.3, 0.4, 0.5, 0.6].map(Math.fround));
});

test('Oscilloscope fallback invalidates completed captures when capture settings change', () => {
  for (const change of [{ dt: 0.008 }, { tm: 'Auto' }, { te: 'Falling' }, { sampleRate: 2000 }]) {
    const plugin = new (loadOscilloscope().OscilloscopePlugin)();
    plugin.setParameters({ dt: 0.004, tm: 'Normal', tl: 1 });
    const state = {};
    assert.ok(executeFallback(plugin, state, [0.1, 0.2, 0.3, 0.4], 0, 1000));
    plugin.setParameters({ ...change, tl: 0 });
    const rate = change.sampleRate || 1000;
    const falling = change.te === 'Falling';
    assert.equal(executeFallback(plugin, state,
      falling ? [1, 0.5, 0.25, -0.5] : [-1, -0.5, -0.25, 0.5], 0.04, rate), undefined);
    const values = [0.6, 0.7, 0.8, 0.9].map(value => falling ? -value : value);
    let measurements = executeFallback(plugin, state, values, 0.08, rate);
    if (change.dt || change.sampleRate) {
      assert.equal(measurements, undefined);
      measurements = executeFallback(plugin, state, values, 0.12, rate);
    }
    assert.equal(measurements.scopeSnapshot.captureSampleCount, change.dt || change.sampleRate ? 8 : 4);
    assert.equal(measurements.scopeSnapshot.triggered, true);
  }
});

test('Oscilloscope fallback retains the completed capture during a new capture with the same settings', () => {
  const plugin = new (loadOscilloscope().OscilloscopePlugin)();
  plugin.setParameters({ dt: 0.004, tm: 'Normal', tl: 1 });
  const state = {};
  const previous = executeFallback(plugin, state, [0.1, 0.2, 0.3, 0.4], 0, 1000).scopeSnapshot;
  plugin.setTriggerLevel(0);
  const retained = executeFallback(plugin, state, [-1, -0.5, -0.25, 0.5], 0.04, 1000).scopeSnapshot;
  assert.equal(retained, previous);
  const completed = executeFallback(plugin, state, [0.6, 0.7, 0.8, 0.9], 0.08, 1000).scopeSnapshot;
  assert.notEqual(completed, previous);
  assert.deepEqual(Array.from(completed.values), [0.5, 0.6, 0.7, 0.8].map(Math.fround));
});

test('Oscilloscope fallback aggregates ten seconds across the display ring wrap', () => {
  const runtime = loadOscilloscope();
  const plugin = new runtime.OscilloscopePlugin();
  plugin.setTriggerMode('Off');
  plugin.setDisplayTime(10);
  const state = {};
  const rate = 48000;
  const end = 1200037;
  let updates = 0;
  for (let start = 0; start < end; start += 127) {
    const count = Math.min(127, end - start);
    const values = Array.from({ length: count }, (_, index) => {
      const sample = start + index;
      return sample % 997 === 0 ? 1 : sample % 991 === 0 ? -1 : 0.125;
    });
    if (executeFallback(plugin, state, values, start / rate)) updates++;
  }
  const snapshot = state.scope.snapshot;
  assert.equal(snapshot.encoding, 2);
  assert.ok(snapshot.extrema.byteLength <= 4226 * 8);
  assert.ok(updates > end / rate * 50 && updates <= end / rate * 60 + 1);
  const first = Math.floor((snapshot.endSample - 1) / snapshot.bucketSamples) - snapshot.bucketCount + 1;
  for (let bucket = 0; bucket < snapshot.bucketCount; bucket++) {
    const begin = (first + bucket) * snapshot.bucketSamples;
    const finish = Math.min(begin + snapshot.bucketSamples, snapshot.endSample);
    let minimum = Infinity;
    let maximum = -Infinity;
    for (let sample = begin; sample < finish; sample++) {
      const value = sample % 997 === 0 ? 1 : sample % 991 === 0 ? -1 : 0.125;
      minimum = Math.min(minimum, value);
      maximum = Math.max(maximum, value);
    }
    assert.equal(snapshot.extrema[bucket * 2], minimum);
    assert.equal(snapshot.extrema[bucket * 2 + 1], maximum);
  }
});

test('Oscilloscope rolling envelopes scroll continuously between telemetry frames and stop without new audio', () => {
  let time = 0;
  const hub = createHub();
  const runtime = loadOscilloscope({ hub, now: () => time });
  const plugin = createSubscribedPlugin(runtime);
  plugin.setDisplayTime(10);
  plugin.setTriggerMode('Off');
  const first = makeEnvelopeFrame();
  hub.emit(first.frame);
  first.payload.setFloat32(28, 99, true);
  assert.equal(plugin.scopeSnapshot.extrema[0], -0.25);
  time = 16;
  const next = makeEnvelopeFrame({ endSample: 480768 });
  next.payload.setFloat32(32 + 500 * 8, 0.75, true);
  hub.emit(next.frame);
  plugin.canvas = createElement('canvas');
  plugin.ctx = plugin.canvas.getContext('2d');
  const positions = [];
  for (const drawTime of [16, 20, 24, 28, 32]) {
    plugin.ctx.calls.length = 0;
    plugin.drawWaveform(drawTime);
    assert.ok(plugin.scopeGrid.canvas.getContext('2d').calls.some(call => call[0] === 'fillText' && call[1] === 'Time (s)'));
    assert.equal(plugin.ctx.calls.filter(call => call[0] === 'drawImage').length, 2);
    assert.equal(plugin.ctx.calls.filter(call => call[0] === 'lineTo').length, 0);
    positions.push(plugin.scopePaint.getContext('2d').calls.findLast(call => call[0] === 'drawImage')[2]);
    assert.equal(plugin._readoutFrame.displayEnd, plugin.scopeDisplayEnd(drawTime));
  }
  for (let index = 1; index < positions.length; index++) {
    assert.ok(positions[index] < positions[index - 1]);
    assert.ok(Math.abs(positions[index] - positions[index - 1] + 0.3776) < 1e-6);
  }
  assert.equal(plugin.scopeDisplayEnd(1000), 480768);
  runtime.windowRef.GraphReadout = { format: { number: String, time: String } };
  const readout = plugin._readWaveform(plugin.canvas.width);
  assert.deepEqual(Array.from(readout.rows, row => row.value), ['-0.25', '0.5']);
  time = 1000;
  hub.emit(makeEnvelopeFrame({ endSample: 480768 }).frame);
  assert.equal(plugin.scopeDisplayEnd(2000), 480768);
});

test('Oscilloscope reuses history and axes, paints only new columns, and skips unchanged draws', () => {
  let time = 0;
  const runtime = loadOscilloscope({ now: () => time });
  const plugin = new runtime.OscilloscopePlugin();
  plugin.setDisplayTime(10);
  plugin.setTriggerMode('Off');
  plugin.canvas = createElement('canvas');
  plugin.ctx = plugin.canvas.getContext('2d');
  plugin.acceptScopeSnapshot(plugin.parseDspScopeTelemetryFrame(makeEnvelopeFrame({ endSample: 720000,
    bucketCount: 4110 }).frame));
  plugin.drawWaveform(0);
  const raster = plugin.scopeRaster, grid = plugin.scopeGrid;
  assert.ok(raster.ctx.calls.filter(call => call[0] === 'fillRect').length > 900);
  raster.ctx.calls.length = 0;
  time = 16;
  plugin.acceptScopeSnapshot(plugin.parseDspScopeTelemetryFrame(makeEnvelopeFrame({ endSample: 720768,
    bucketCount: 4110 }).frame));
  plugin.drawWaveform(16);
  assert.equal(plugin.scopeRaster, raster);
  assert.equal(plugin.scopeGrid, grid);
  assert.ok(raster.ctx.calls.filter(call => call[0] === 'fillRect').length < 20);
  assert.ok(raster.ctx.calls.some(call => call[0] === 'drawImage'));
  raster.ctx.calls.length = 0;
  plugin.drawWaveform(20);
  assert.equal(raster.ctx.calls.length, 0, 'Interpolation reuses the complete raster');
  plugin.drawWaveform(1000);
  plugin.ctx.calls.length = 0;
  assert.equal(plugin.drawWaveform(1001), false);
  assert.equal(plugin.ctx.calls.length, 0, 'No drawing commands after the audio clock stops');
  plugin.setDisplayLevel(-12);
  assert.equal(plugin.drawWaveform(1001), true);
  assert.notEqual(plugin.scopeGrid, grid);
  assert.notEqual(plugin.scopeRaster, raster);
});

test('Oscilloscope sample clock stays continuous through jittered deliveries', () => {
  let time = 0;
  const runtime = loadOscilloscope({ now: () => time });
  const plugin = new runtime.OscilloscopePlugin();
  const snapshot = endSample => plugin.parseDspScopeTelemetryFrame(makeEnvelopeFrame({ endSample }).frame);
  plugin.acceptScopeSnapshot(snapshot(480000));
  for (const [arrival, audioTime] of [[15, 16], [34, 32], [47, 48], [69, 64], [82, 80]]) {
    time = arrival;
    const before = plugin.scopeDisplayEnd(time);
    plugin.acceptScopeSnapshot(snapshot(480000 + audioTime * 48));
    assert.equal(plugin.scopeDisplayEnd(time), before);
    const step = plugin.scopeDisplayEnd(time + 4) - before;
    assert.ok(step >= 192 * 0.95 && step <= 192 * 1.05);
  }
  const frozen = plugin.scopeSnapshot.endSample;
  assert.equal(plugin.scopeDisplayEnd(1000), frozen);
  time = 1000;
  plugin.acceptScopeSnapshot(snapshot(600000));
  assert.equal(plugin.scopeDisplayEnd(time), 600000 - 1600);
});

test('Oscilloscope exposes a logarithmic 1 ms to 10 s display control', () => {
  const runtime = loadOscilloscope();
  const plugin = new runtime.OscilloscopePlugin();
  plugin.setDisplayTime(20);
  assert.equal(plugin.getParameters().dt, 10);
  plugin.createUI();
  const control = runtime.calls.find(call => call[0] === 'parameterControl' && call[1] === 'Display Time');
  assert.deepEqual(control.slice(2, 5), [1, 10000, 1]);
  assert.equal(control.at(-1), true);
  plugin.setDisplayTime(0);
  assert.equal(plugin.getParameters().dt, 0.001);
});

test('Oscilloscope rejects invalid envelope lengths, extrema, clocks, and strides', () => {
  const runtime = loadOscilloscope();
  const plugin = new runtime.OscilloscopePlugin();
  for (const fixture of [
    makeEnvelopeFrame({ captureSampleCount: 480001 }),
    makeEnvelopeFrame({ bucketSamples: 119 }),
    makeEnvelopeFrame({ flags: 3 }),
    makeEnvelopeFrame({ endSample: 0, bucketCount: 1 }),
    makeEnvelopeFrame({ extrema: [1, -1] }),
    makeEnvelopeFrame({ extrema: [NaN, 1] })
  ]) {
    assert.equal(plugin.parseDspScopeTelemetryFrame(fixture.frame), null);
  }
});

test('Oscilloscope deduplicates, rebinds, and cleans up hub subscriptions', () => {
  const firstHub = createHub();
  const runtime = loadOscilloscope({ hub: firstHub });
  const plugin = createSubscribedPlugin(runtime, 7);

  plugin.getParameters();
  plugin._setupMessageHandler();
  plugin._setupMessageHandler();
  plugin.createUI();
  plugin.createUI();
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
