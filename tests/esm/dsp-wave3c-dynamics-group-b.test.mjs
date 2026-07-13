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
    jsEngineHash: 'edb476f179312c23993dee782b0620b03abebcde81e5727591b123ef47a8020f'
  },
  {
    type: 'BrickwallLimiterPlugin',
    folder: 'brickwall_limiter',
    hash: 0xb531a24a,
    floatCount: 6,
    jsEngineHash: 'e4f6586e5e32f1f7c94bbc8e615b53212cd047e1dda7073434b1cca80845cf9f'
  },
  {
    type: 'TransientShaperPlugin',
    folder: 'transient_shaper',
    hash: 0xe2344ceb,
    floatCount: 7,
    jsEngineHash: 'd0a7ae2f7b836df4cc42b6b2c27b5376830e6759691629f0e944c816821d652f'
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
    assert.equal(loaded.cases.cases.length, 8);
    assert.ok(loaded.cases.cases.every(item => Number.isInteger(item.frames) && item.frames > 0));
    assert.ok(loaded.cases.cases.some(item => item.sampleRate === 44100));
    assert.ok(loaded.cases.cases.some(item => item.sampleRate === 96000));
    assert.ok(loaded.cases.cases.some(item => item.sampleRate === 192000));
    assert.ok(loaded.cases.cases.some(item => item.channels === 1));
    assert.ok(loaded.cases.cases.some(item => item.channels === 4));
    assert.ok(loaded.cases.cases.some(item => item.events?.length === 4));

    const goldenRoot = path.join(loaded.root, 'golden');
    assert.ok(await directoryBytes(goldenRoot) <= DEFAULT_GOLDEN_BUDGET_BYTES);
    const goldens = await readGoldenSet(goldenRoot);
    assert.equal(goldens.length, 8);
    assert.ok(goldens.every(item => item.metadata.jsEngineHash === port.jsEngineHash));
    const result = await runParityCli([
      '--root', repoRoot,
      '--type', port.type,
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, 8);
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
