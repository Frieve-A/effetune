import { installThemePaletteStub } from '../helpers/theme-palette-stub.mjs';
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
  installThemePaletteStub(context.window);
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
  hub.emit(makeLevelFrame({ channelCount: 17, peaks: new Array(17).fill(0) }).frame);
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

test('LevelMeter accepts all 16 channels including the last clip bit', () => {
  const hub = createHub();
  const plugin = createSubscribedPlugin(loadLevelMeter({ hub }));
  let received;
  plugin.process = message => { received = message.measurements; };
  hub.emit(makeLevelFrame({ peaks: Array(16).fill(0.5), clipFlags: 1 << 15 }).frame);
  assert.equal(received.channels.length, 16);
  assert.equal(received.channels[15].clipped, true);
  assert.equal(received.channels[15].peak, 0.5);
});

function captureMeter(plugin) {
  const bars = [], markers = [], texts = [];
  const gradient = { addColorStop() {} };
  const ctx = {
    clearRect() { bars.length = 0; markers.length = 0; texts.length = 0; },
    fillRect(x, y, width) {
      if (this.fillStyle === gradient) bars.push(width);
      if (this.fillStyle === 'stub:text-primary') markers.push(x + 1);
    },
    fillText(text) { texts.push(text); },
    createLinearGradient() { return gradient; }
  };
  plugin.foregroundCanvas = { getContext: () => ctx };
  plugin.canvasWidth = 1440;
  plugin.canvasHeight = 64;
  plugin.dbStart = -144;
  plugin.dbRange = 144;
  plugin.overloadIndicator = { style: {} };
  return now => {
    plugin.updateMeter(now);
    return { levels: bars.map(width => width / 10 - 144), peaks: markers.map(x => x / 10 - 144), texts: [...texts] };
  };
}

function assertNear(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-8, 'expected ' + expected + ', got ' + actual);
}

test('LevelMeter renders elapsed decay and the exact one-second hold without changing measurements', () => {
  const runtime = loadLevelMeter();
  const plugin = new runtime.LevelMeterPlugin();
  const draw = captureMeter(plugin);
  runtime.setNow(1000);
  plugin.process({ measurements: { channels: [{ peak: 1 }] } });
  runtime.setNow(1990);
  plugin.process({ measurements: { channels: [{ peak: 0.1 }] } });
  const stored = JSON.stringify({ lv: plugin.lv, pl: plugin.pl, ph: plugin.ph });
  assertNear(draw(1995).levels[0], -19.9);
  assertNear(draw(1995).peaks[0], 0);
  assertNear(draw(2005).peaks[0], -0.1);
  assert.equal(draw(2005).texts[0], '-0.1 dB');
  assert.equal(JSON.stringify({ lv: plugin.lv, pl: plugin.pl, ph: plugin.ph }), stored);
  assertNear(draw(90000).peaks[0], -20 * (1 / 60 - 0.01));
  runtime.setNow(2010);
  plugin.process({ measurements: { channels: [{ peak: 0.1 }] } });
  assertNear(draw(2010).peaks[0], -0.2);

  runtime.setNow(2200);
  plugin.process({ measurements: { channels: [{ peak: 1 }] } });
  runtime.setNow(2300);
  plugin.process({ measurements: { channels: [{ peak: 0 }] } });
  assertNear(plugin.lv[0], -2);
  assertNear(draw(2304).levels[0], -2.08);
  runtime.setNow(50000);
  plugin.process({ measurements: { channels: [{ peak: 0 }] } });
  assertNear(draw(50010).levels[0], -144);
});

test('LevelMeter keeps steady levels stable and freezes across repeated effect and section pauses', () => {
  const runtime = loadLevelMeter();
  const plugin = new runtime.LevelMeterPlugin();
  const draw = captureMeter(plugin);
  let now = 1000;
  const emit = peak => plugin.process({ measurements: { channels: [{ peak }] } });
  runtime.setNow(now);
  emit(0.5);
  const steady = draw(now);
  assert.deepEqual(draw(now + 15), steady);
  let callback;
  plugin.isVisible = true;
  plugin.requestPowerAnimationFrame = next => { callback = next; return 1; };
  for (let cycle = 0; cycle < 8; cycle++) {
    now += 100;
    runtime.setNow(now);
    emit(1);
    now += 100;
    runtime.setNow(now);
    emit(0);
    now += 5;
    runtime.setNow(now);
    const frozen = draw(now);
    plugin.stopAnimation();
    const gate = cycle % 2 ? '_sectionEnabled' : 'enabled';
    plugin[gate] = false;
    now += 10000;
    runtime.setNow(now);
    emit(0.1);
    if (plugin.enabled) assert.deepEqual(draw(now), frozen);
    plugin[gate] = true;
    plugin.startAnimation();
    const resumed = draw(now);
    assertNear(resumed.levels[0], frozen.levels[0]);
    assertNear(resumed.peaks[0], frozen.peaks[0]);
    assert.deepEqual(resumed.texts, frozen.texts);
    emit(1);
    assertNear(draw(now).levels[0], 0);
    now += 100;
    runtime.setNow(now);
    emit(0);
    callback(now + 4);
    assertNear(draw(now + 4).levels[0], -2.08);
  }
  plugin.cleanup();
});
