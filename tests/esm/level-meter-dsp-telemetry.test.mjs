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
  return {
    clearRect() {},
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText() {},
    createLinearGradient() {
      return { addColorStop() {} };
    }
  };
}

function createElement(tagName) {
  return {
    tagName: tagName.toUpperCase(),
    children: [],
    style: {},
    className: '',
    textContent: '',
    width: tagName === 'canvas' ? 1024 : 0,
    height: tagName === 'canvas' ? 64 : 0,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    getContext() {
      return createCanvasContext();
    }
  };
}

function loadLevelMeter({ hub = null } = {}) {
  const source = fs.readFileSync(
    new URL('../../plugins/analyzer/level_meter.js', import.meta.url),
    'utf8'
  );
  const calls = [];
  let now = 0;
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
    document: { createElement },
    PluginBase,
    IntersectionObserver,
    performance: { now: () => now },
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
    console,
    Float32Array,
    DataView,
    ArrayBuffer
  };
  vm.runInNewContext(source, context, { filename: 'level_meter.js' });
  return {
    LevelMeterPlugin: windowRef.LevelMeterPlugin,
    calls,
    setNow(value) {
      now = value;
    },
    windowRef
  };
}

function makeLevelFrame({
  version = 1,
  peaks = [0.5],
  rms = peaks,
  clipFlags = 0,
  channelCount = peaks.length,
  trailingBytes = 0
} = {}) {
  const buffer = new ArrayBuffer(8 + channelCount * 8 + trailingBytes);
  const payload = new DataView(buffer);
  payload.setUint32(0, channelCount, true);
  for (let channel = 0; channel < channelCount; channel++) {
    const offset = 4 + channel * 8;
    payload.setFloat32(offset, peaks[channel] ?? 0, true);
    payload.setFloat32(offset + 4, rms[channel] ?? 0, true);
  }
  payload.setUint32(4 + channelCount * 8, clipFlags, true);
  return { frame: { frameType: 1, formatVersion: version, payload }, payload };
}

function createSubscribedPlugin(runtime, id = 17) {
  const plugin = new runtime.LevelMeterPlugin();
  plugin.id = id;
  plugin.getParameters();
  return plugin;
}

test('LevelMeter copies exact v1 peak, RMS, and clip payload values during dispatch', () => {
  const hub = createHub();
  const runtime = loadLevelMeter({ hub });
  const plugin = createSubscribedPlugin(runtime, 42);
  const received = [];
  plugin.process = message => received.push(message.measurements);

  const { frame, payload } = makeLevelFrame({
    peaks: [0.25, 1.125],
    rms: [0.125, 0.75],
    clipFlags: 2
  });
  hub.emit(frame);
  payload.setFloat32(4, 99, true);
  payload.setFloat32(16, 99, true);

  assert.equal(hub.subscribeCalls, 1);
  assert.equal(hub.subscriptions[0].tapId, 42);
  assert.equal(hub.subscriptions[0].frameType, 1);
  assert.equal(received.length, 1);
  assert.equal(received[0].channels[0].peak, 0.25);
  assert.equal(received[0].channels[0].rms, 0.125);
  assert.equal(received[0].channels[0].clipped, false);
  assert.equal(received[0].channels[1].peak, 1.125);
  assert.equal(received[0].channels[1].rms, 0.75);
  assert.equal(received[0].channels[1].clipped, true);
  assert.equal(received[0].clipFlags, 2);
});

test('LevelMeter ignores malformed and version-mismatched telemetry frames', () => {
  const hub = createHub();
  const runtime = loadLevelMeter({ hub });
  const plugin = createSubscribedPlugin(runtime);
  let processCalls = 0;
  plugin.process = () => {
    processCalls++;
  };

  hub.emit(makeLevelFrame({ version: 2 }).frame);
  hub.emit({ ...makeLevelFrame().frame, frameType: 2 });
  hub.emit(makeLevelFrame({ trailingBytes: 4 }).frame);
  hub.emit(makeLevelFrame({ channelCount: 0, peaks: [], rms: [] }).frame);
  hub.emit(makeLevelFrame({ channelCount: 9, peaks: new Array(9).fill(0) }).frame);
  hub.emit(makeLevelFrame({ peaks: [Number.NaN] }).frame);
  hub.emit(makeLevelFrame({ clipFlags: 2 }).frame);
  hub.emit({ formatVersion: 1, payload: new Uint8Array(16) });

  assert.equal(processCalls, 0);
});

test('LevelMeter clip flags feed existing overload hold and release ballistics', () => {
  const hub = createHub();
  const runtime = loadLevelMeter({ hub });
  const plugin = createSubscribedPlugin(runtime);

  runtime.setNow(100);
  hub.emit(makeLevelFrame({
    peaks: [0.5, 0.25],
    rms: [0.3, 0.2],
    clipFlags: 2
  }).frame);

  assert.equal(plugin.ol, true);
  assert.ok(Math.abs(plugin.lv[0] - (-6.020599913279624)) < 1e-9);
  assert.ok(Math.abs(plugin.lv[1] - (-12.041199826559248)) < 1e-9);
  assert.equal(runtime.calls.filter(call => call[0] === 'updateParameters').length, 1);

  runtime.setNow(6200);
  hub.emit(makeLevelFrame({
    peaks: [0.1, 0.1],
    rms: [0.05, 0.05],
    clipFlags: 0
  }).frame);

  assert.equal(plugin.ol, false);
  assert.equal(runtime.calls.filter(call => call[0] === 'updateParameters').length, 2);
});

test('LevelMeter keeps legacy processBuffer measurements active alongside telemetry', () => {
  const hub = createHub();
  const runtime = loadLevelMeter({ hub });
  const plugin = createSubscribedPlugin(runtime);

  runtime.setNow(100);
  hub.emit(makeLevelFrame({ peaks: [0.1], rms: [0.05] }).frame);
  const telemetryLevel = plugin.lv[0];

  runtime.setNow(200);
  plugin.onMessage({
    type: 'processBuffer',
    measurements: { channels: [{ peak: 1 }] }
  });

  assert.ok(telemetryLevel < 0);
  assert.equal(plugin.lv[0], 0);
  assert.match(plugin.processorString, /data\.measurements/);
});

test('LevelMeter prevents duplicate subscriptions across message and UI rebuilds', () => {
  const firstHub = createHub();
  const runtime = loadLevelMeter({ hub: firstHub });
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

test('LevelMeter remains legacy-only when the telemetry hub is unavailable', () => {
  const runtime = loadLevelMeter();
  const plugin = createSubscribedPlugin(runtime);

  runtime.setNow(100);
  plugin.onMessage({
    type: 'processBuffer',
    measurements: { channels: [{ peak: 0.5 }] }
  });

  assert.ok(Math.abs(plugin.lv[0] - (-6.020599913279624)) < 1e-9);
  assert.equal(plugin.ol, false);
});
