import { installThemePaletteStub } from '../helpers/theme-palette-stub.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ports = [
  {
    type: 'AutoLevelerPlugin',
    folder: 'auto_leveler',
    hash: 0xe0b1f34d,
    floatCount: 7,
    caseCount: 9,
    jsEngineHash: 'ccd42454a572b00fa42cbae6f795fb2d9645679cfe534be39ee305a0838cf209'
  },
  {
    type: 'BrickwallLimiterPlugin',
    folder: 'brickwall_limiter',
    hash: 0xb531a24a,
    floatCount: 6,
    caseCount: 8,
    jsEngineHash: 'fc57c3d00b5bc048d7a7589e032e0682e5a4ea74f21ad68b9b9c40bfd06bf2d5'
  },
  {
    type: 'TransientShaperPlugin',
    folder: 'transient_shaper',
    hash: 0xe2344ceb,
    floatCount: 7,
    caseCount: 8,
    jsEngineHash: '066494041d5c65a2c1a913e0ad3eec0c919b15863946db46d5d513b7c8a5b4fe'
  }
];

class FakeTelemetryHub {
  constructor() {
    this.subscriptions = [];
  }

  subscribe(tapId, frameType, callback) {
    const subscription = { tapId, frameType, callback, active: true };
    this.subscriptions.push(subscription);
    return () => {
      subscription.active = false;
    };
  }

  unsubscribe(tapId, frameType, callback) {
    for (const subscription of this.subscriptions) {
      if (subscription.tapId === tapId && subscription.frameType === frameType &&
          subscription.callback === callback) {
        subscription.active = false;
      }
    }
  }

  active() {
    return this.subscriptions.filter(subscription => subscription.active);
  }

  emit(frame) {
    for (const subscription of this.active()) {
      if (subscription.frameType === frame.frameType) subscription.callback(frame);
    }
  }
}

async function directoryBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

async function readPort(port) {
  const root = path.join(repoRoot, 'dsp', 'plugins', 'dynamics', port.folder);
  const schemaPath = path.join(root, 'params.json');
  const [schemaText, casesText, kernel] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(root, 'cases.json'), 'utf8'),
    fs.readFile(path.join(root, 'kernel.cpp'), 'utf8')
  ]);
  return {
    root,
    schema: validateParamSpec(JSON.parse(schemaText), schemaPath),
    cases: JSON.parse(casesText),
    kernel
  };
}

async function loadGraphPlugins() {
  let nextId = 500;
  const context = {
    Array,
    ArrayBuffer,
    DataView,
    Float32Array,
    Map,
    Math,
    Number,
    Uint8Array,
    cancelAnimationFrame() {},
    console,
    performance: { now: () => 1000 },
    requestAnimationFrame: () => 1,
    window: { dspTelemetryHub: null, workletNode: null },
    PluginBase: class {
      constructor(name, description) {
        this.name = name;
        this.description = description;
        this.id = nextId++;
        this.enabled = true;
        this._sectionEnabled = true;
      }

      _setupMessageHandler() {
        this.baseMessageHandlerSetups = (this.baseMessageHandlerSetups ?? 0) + 1;
      }

      registerProcessor(code) {
        this.processorCode = code;
      }

      updateParameters() {}

      cleanup() {
        this.baseCleanupCalled = true;
      }
    }
  };
  vm.createContext(context);
  for (const folder of ['auto_leveler', 'transient_shaper']) {
    const source = await fs.readFile(
      path.join(repoRoot, 'plugins', 'dynamics', `${folder}.js`),
      'utf8'
    );
    installThemePaletteStub(context.window);
    vm.runInContext(source, context, { filename: `${folder}.js` });
  }
  return context;
}

function makeScalarFrame(value, { frameType = 8, formatVersion = 1, byteLength = 4 } = {}) {
  const payload = new DataView(new ArrayBuffer(byteLength));
  if (byteLength >= 4) payload.setFloat32(0, value, true);
  return { frameType, formatVersion, payload };
}

function makeLoudnessFrame(inputLufs, outputLufs, {
  frameType = 7,
  formatVersion = 1,
  byteLength = 8
} = {}) {
  const payload = new DataView(new ArrayBuffer(byteLength));
  if (byteLength >= 4) payload.setFloat32(0, inputLufs, true);
  if (byteLength >= 8) payload.setFloat32(4, outputLufs, true);
  return { frameType, formatVersion, payload };
}

test('Wave 3c dynamics group B schemas, cases, and final JS goldens stay frozen', async () => {
  for (const port of ports) {
    const loaded = await readPort(port);
    assert.equal(loaded.schema.type, port.type);
    assert.equal(loaded.schema.hash, port.hash);
    assert.equal(loaded.schema.floatCount, port.floatCount);
    assert.equal(loaded.cases.cases.length, port.caseCount);
    assert.ok(loaded.cases.cases.every(item => Number.isInteger(item.frames) && item.frames > 0));
    assert.ok(loaded.cases.cases.some(item => item.sampleRate === 44100));
    assert.ok(loaded.cases.cases.some(item => item.sampleRate === 96000));
    assert.ok(loaded.cases.cases.some(item => item.sampleRate === 192000));
    assert.ok(loaded.cases.cases.some(item => item.channels === 1));
    assert.ok(loaded.cases.cases.some(item => item.channels === 4));
    if (port.type === 'AutoLevelerPlugin') {
      assert.ok(loaded.cases.cases.some(item => item.channels === 6));
    }
    assert.ok(loaded.cases.cases.some(item => item.events?.length === 4));

    const goldenRoot = path.join(loaded.root, 'golden');
    assert.ok(await directoryBytes(goldenRoot) <= DEFAULT_GOLDEN_BUDGET_BYTES);
    const goldens = await readGoldenSet(goldenRoot);
    assert.equal(goldens.length, port.caseCount);
    assert.ok(goldens.every(item => item.metadata.jsEngineHash === port.jsEngineHash));
    const result = await runParityCli([
      '--root', repoRoot,
      '--type', port.type,
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, port.caseCount);
    assert.ok(result.results.every(item => item.comparison.pass));
  }

  const brickwall = (await readPort(ports[1])).cases.cases;
  assert.deepEqual(
    [...new Set(brickwall.map(item => item.params?.os).filter(Boolean))].sort((a, b) => a - b),
    [1, 2, 4, 8]
  );
});

test('Wave 3c dynamics group B kernels freeze realtime, telemetry, and latency contracts', async () => {
  const loaded = new Map();
  for (const port of ports) loaded.set(port.type, await readPort(port));
  for (const [type, { kernel }] of loaded) {
    assert.doesNotMatch(kernel, /\b(?:malloc|calloc|realloc|free)\s*\(/, type);
    assert.match(kernel, /void reset\(\) noexcept override/, type);
    assert.match(kernel, /writeTelemetry\(TelemetryWriter &writer\)/, type);
    assert.match(kernel, /static_assert\(sizeof\(.+Kernel\) <= 8192u\)/, type);
  }
  assert.match(loaded.get('AutoLevelerPlugin').kernel, /writeLoudnessLevels/);
  assert.match(loaded.get('TransientShaperPlugin').kernel, /writeTransientGain/);
  const limiter = loaded.get('BrickwallLimiterPlugin').kernel;
  assert.match(limiter, /writeGainReduction/);
  assert.match(limiter, /reported_latency_samples_ = latencyFor\(staged_params_\)/);
  assert.match(limiter, /lookahead \+ \(62u \+ factor - 1u\) \/ factor/);
  assert.equal(TelemetryFrameType.TAP_LOUDNESS_LEVELS, 7);
  assert.equal(TelemetryFrameType.TAP_TRANSIENT_GAIN, 8);
});

test('Auto Leveler strict telemetry parser feeds the legacy processBuffer graph path', async () => {
  const context = await loadGraphPlugins();
  const firstHub = new FakeTelemetryHub();
  context.window.dspTelemetryHub = firstHub;
  const plugin = new context.window.AutoLevelerPlugin();
  assert.equal(plugin.baseMessageHandlerSetups, 1);
  assert.equal(firstHub.active().length, 1);
  assert.equal(firstHub.active()[0].frameType, 7);

  const valid = makeLoudnessFrame(-23.5, -18.25);
  firstHub.emit(valid);
  valid.payload.setFloat32(0, -1, true);
  assert.equal(plugin.inputLufsBuffer.at(-1), -23.5);
  assert.equal(plugin.outputLufsBuffer.at(-1), -18.25);

  for (const invalid of [
    makeLoudnessFrame(-20, -18, { frameType: 6 }),
    makeLoudnessFrame(-20, -18, { formatVersion: 2 }),
    makeLoudnessFrame(-20, -18, { byteLength: 4 }),
    makeLoudnessFrame(-20, -18, { byteLength: 12 }),
    makeLoudnessFrame(Number.NaN, -18),
    makeLoudnessFrame(-20, Number.POSITIVE_INFINITY),
    makeLoudnessFrame(-144.01, -18),
    makeLoudnessFrame(-20, -144.01),
    { frameType: 7, formatVersion: 1, payload: { byteLength: 8 } }
  ]) {
    assert.equal(plugin.parseDspLoudnessTelemetryFrame(invalid), null);
  }

  plugin.onMessage({
    type: 'processBuffer',
    measurements: { inputLufs: -30, outputLufs: -24, time: 2 }
  });
  assert.equal(plugin.inputLufsBuffer.at(-1), -30);
  assert.equal(plugin.outputLufsBuffer.at(-1), -24);

  const secondHub = new FakeTelemetryHub();
  context.window.dspTelemetryHub = secondHub;
  plugin.id += 100;
  plugin.getParameters();
  assert.equal(firstHub.active().length, 0);
  assert.equal(secondHub.active().length, 1);
  assert.equal(secondHub.active()[0].tapId, plugin.id);
  plugin.cleanup();
  assert.equal(secondHub.active().length, 0);
  assert.equal(plugin.baseCleanupCalled, true);
});

function captureAutoLevelerGraph(plugin, now) {
  const strokes = [];
  let points;
  plugin.canvas ??= { width: 1024, height: 240, clientWidth: 1024 };
  plugin.canvasCtx = {
    fillRect() {}, fillText() {}, save() {}, restore() {}, translate() {}, rotate() {},
    beginPath() { points = []; },
    moveTo(x, y) { points.push([x, y]); },
    lineTo(x, y) { points.push([x, y]); },
    stroke() { strokes.push({ color: this.strokeStyle, points }); }
  };
  plugin.drawGraph(now);
  return {
    input: strokes.find(stroke => stroke.color === 'stub:graph-trace')?.points,
    output: strokes.find(stroke => stroke.color === 'stub:text-primary')?.points,
    ticks: strokes.filter(stroke => stroke.color === 'stub:graph-grid-strong').map(stroke => stroke.points[0][0])
  };
}

test('Auto Leveler scrolls curves and second ticks by render time between deliveries', async () => {
  const context = await loadGraphPlugins();
  let now = 20000;
  context.performance.now = () => now;
  const plugin = new context.window.AutoLevelerPlugin();
  plugin.handleDspLoudnessTelemetry(makeLoudnessFrame(-30, -24));
  now = 20100;
  plugin.handleDspLoudnessTelemetry(makeLoudnessFrame(-20, -18));

  const times = [20102, 20107, 20115];
  const frames = times.map(time => captureAutoLevelerGraph(plugin, time));
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    assert.equal(frame.input.at(-1)[0], 1024);
    assert.ok(Math.abs(frame.input.at(-1)[1] - 100) < 1e-9);
    assert.deepEqual(frame.output.at(-1), [1024, 90]);
    if (i === 0) continue;
    const distance = (times[i] - times[i - 1]) * 0.06;
    assert.ok(Math.abs(frames[i - 1].input[0][0] - frame.input[0][0] - distance) < 1e-9);
    assert.ok(Math.abs(frames[i - 1].output[0][0] - frame.output[0][0] - distance) < 1e-9);
    assert.ok(Math.abs(frames[i - 1].ticks.at(-1) - frame.ticks.at(-1) - distance) < 1e-9);
  }
  // A stalled stream cannot leave an ever-growing empty strip on the right.
  const stalled = captureAutoLevelerGraph(plugin, 90000);
  assert.ok(Math.abs(stalled.input.at(-2)[0] - 1023) < 1e-9);
  assert.equal(stalled.input.at(-1)[0], 1024);
  assert.ok(Math.abs(stalled.input.at(-1)[1] - 100) < 1e-9);
  plugin.canvas.width = 2048;
  assert.ok(Math.abs(captureAutoLevelerGraph(plugin, 90000).input.at(-2)[0] - 2046) < 1e-9);

  let callback;
  plugin.isVisible = true;
  plugin.requestPowerAnimationFrame = next => { callback = next; return 1; };
  const renderTimes = [];
  plugin.drawGraph = time => renderTimes.push(time);
  plugin.startAnimation();
  callback(20115);
  assert.deepEqual(renderTimes, [20100, 20115]);
  plugin.cleanup();
});

test('Auto Leveler keeps the newest values at the right edge across repeated pauses', async () => {
  const context = await loadGraphPlugins();
  let now = 1000;
  context.performance.now = () => now;
  const plugin = new context.window.AutoLevelerPlugin();
  plugin.isVisible = true;
  plugin.requestPowerAnimationFrame = () => 1;
  plugin.handleDspLoudnessTelemetry(makeLoudnessFrame(-30, -24));
  for (let cycle = 0; cycle < 8; cycle++) {
    now += 5;
    plugin.stopAnimation();
    const frozen = captureAutoLevelerGraph(plugin, now);
    const previousTime = plugin.historyTimes.at(-1);
    const gate = cycle % 2 === 0 ? 'enabled' : '_sectionEnabled';
    plugin[gate] = false;
    now += 20000;
    plugin.handleDspLoudnessTelemetry(makeLoudnessFrame(-1, -1));
    assert.equal(plugin.historyTimes.at(-1), previousTime);
    assert.deepEqual(captureAutoLevelerGraph(plugin, now), frozen);
    plugin[gate] = true;
    plugin.startAnimation();
    // Audio time can reset independently of the monotonic display clock.
    plugin.onMessage({ type: 'processBuffer', measurements: { inputLufs: -20, outputLufs: -18, time: cycle % 2 } });
    const resumed = captureAutoLevelerGraph(plugin, now + 8);
    assert.ok(Math.abs(resumed.input.at(-2)[0] - 1023.52) < 1e-9);
    assert.equal(resumed.input.at(-1)[0], 1024);
    assert.ok(Math.abs(resumed.input.at(-1)[1] - 100) < 1e-9);
    assert.deepEqual(resumed.output.at(-1), [1024, 90]);
  }
  plugin.cleanup();
  assert.ok(plugin.historyTimes.every(Number.isNaN));
});

test('Transient Shaper strict signed telemetry feeds the legacy processBuffer graph path', async () => {
  const context = await loadGraphPlugins();
  const hub = new FakeTelemetryHub();
  context.window.dspTelemetryHub = hub;
  const plugin = new context.window.TransientShaperPlugin();
  assert.equal(plugin.baseMessageHandlerSetups, 1);
  assert.equal(hub.active().length, 1);
  assert.equal(hub.active()[0].frameType, 8);

  const valid = makeScalarFrame(-6.25);
  hub.emit(valid);
  valid.payload.setFloat32(0, 12, true);
  assert.equal(plugin.gainBuffer.at(-1), -6.25);
  assert.equal(plugin.parseDspTransientGainTelemetryFrame(makeScalarFrame(9.5)), 9.5);

  for (const invalid of [
    makeScalarFrame(1, { frameType: 7 }),
    makeScalarFrame(1, { formatVersion: 2 }),
    makeScalarFrame(1, { byteLength: 3 }),
    makeScalarFrame(1, { byteLength: 8 }),
    makeScalarFrame(Number.NaN),
    makeScalarFrame(Number.NEGATIVE_INFINITY),
    { frameType: 8, formatVersion: 1, payload: { byteLength: 4 } }
  ]) {
    assert.equal(plugin.parseDspTransientGainTelemetryFrame(invalid), null);
  }

  plugin.onMessage({ type: 'processBuffer', measurements: { gain: 3.75, time: 2 } });
  assert.equal(plugin.gainBuffer.at(-1), 3.75);
  plugin.cleanup();
  assert.equal(hub.active().length, 0);
  assert.equal(plugin.baseCleanupCalled, true);
});
