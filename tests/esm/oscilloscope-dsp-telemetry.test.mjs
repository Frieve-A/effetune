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
    fillRect(...args) { calls.push(['fillRect', ...args]); },
    beginPath() { calls.push(['beginPath']); },
    moveTo(...args) { calls.push(['moveTo', ...args]); },
    lineTo(...args) { calls.push(['lineTo', ...args]); },
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

function loadOscilloscope({ hub = null } = {}) {
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
    }

    registerProcessor(processor) {
      this.processorString = processor;
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

    createParameterControl() {
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
  assert.ok(plugin.ctx.calls.some(call => call[0] === 'fillText' && call[1] === 'Time (ms)'));
  assert.ok(plugin.ctx.calls.some(call => call[0] === 'fillText' && call[1] === 'Amplitude'));
  const waveformStart = plugin.ctx.calls.map(call => call[0]).lastIndexOf('beginPath');
  const waveformCalls = plugin.ctx.calls.slice(waveformStart);
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

test('Oscilloscope retains legacy processBuffer accumulation as fallback', () => {
  const hub = createHub();
  const runtime = loadOscilloscope({ hub });
  const plugin = createSubscribedPlugin(runtime);
  hub.emit(makeScopeFrame({ values: [0.75, 0.5] }).frame);
  assert.notEqual(plugin.scopeSnapshot, null);

  plugin.displayTime = 0.001;
  const buffer = new Float32Array(65536);
  buffer[0] = -0.625;
  plugin.onMessage({
    type: 'processBuffer',
    measurements: {
      buffer,
      triggerIndex: 0,
      currentPosition: 128,
      sampleRate: 1000
    }
  });

  assert.equal(plugin.scopeSnapshot, null);
  assert.deepEqual(Array.from(plugin.frozenDisplayBuffer), [-0.625]);
  assert.match(plugin.processorString, /context\.buffer = \[new Float32Array\(65536\)\]/);
  assert.match(plugin.processorString, /lastAutoSweepTime/);
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

test('Oscilloscope remains legacy-only when the telemetry hub is unavailable', () => {
  const runtime = loadOscilloscope();
  const plugin = createSubscribedPlugin(runtime);
  const buffer = new Float32Array(65536);
  buffer[0] = 0.375;
  plugin.displayTime = 0.001;
  plugin.onMessage({
    type: 'processBuffer',
    measurements: {
      buffer,
      triggerIndex: 0,
      currentPosition: 64,
      sampleRate: 1000
    }
  });

  assert.deepEqual(Array.from(plugin.frozenDisplayBuffer), [0.375]);
  assert.equal(plugin.scopeSnapshot, null);
});
