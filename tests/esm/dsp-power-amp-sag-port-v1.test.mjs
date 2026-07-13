import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import { readGoldenSet } from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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

function makeFrame(inputEnvelope, gainReduction, {
  frameType = 12,
  formatVersion = 1,
  byteLength = 8
} = {}) {
  const payload = new DataView(new ArrayBuffer(byteLength));
  if (byteLength >= 4) payload.setFloat32(0, inputEnvelope, true);
  if (byteLength >= 8) payload.setFloat32(4, gainReduction, true);
  return { frameType, formatVersion, payload };
}

async function loadPlugin() {
  let nextId = 1200;
  const context = {
    Array,
    ArrayBuffer,
    DataView,
    Float32Array,
    Math,
    Number,
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
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'dynamics', 'power_amp_sag.js'),
    'utf8'
  );
  vm.runInContext(source, context, { filename: 'power_amp_sag.js' });
  return context;
}

test('Power Amp Sag descriptor, cases, and kernel freeze the v1 port contract', async () => {
  const root = path.join(repoRoot, 'dsp', 'plugins', 'dynamics', 'power_amp_sag');
  const schemaPath = path.join(root, 'params.json');
  const [schemaText, casesText, kernel] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(root, 'cases.json'), 'utf8'),
    fs.readFile(path.join(root, 'kernel.cpp'), 'utf8')
  ]);
  const schema = validateParamSpec(JSON.parse(schemaText), schemaPath);
  const cases = JSON.parse(casesText).cases;
  assert.equal(schema.type, 'PowerAmpSagPlugin');
  assert.equal(schema.hash, 0x2c736e53);
  assert.equal(schema.floatCount, 4);
  assert.equal(cases.length, 9);
  assert.ok(cases.some(item => item.blockSize === 1));
  assert.ok(cases.some(item => item.params?.mb === true));
  assert.ok(cases.some(item => item.events?.some(event => event.params?.mb !== undefined)));
  assert.match(kernel, /kTapPowerAmpSag = 12u/);
  assert.match(kernel, /std::vector<double> psu_voltage_/);
  assert.match(kernel, /void reset\(\) noexcept override/);
  assert.match(kernel, /writeTelemetry\(TelemetryWriter &writer\)/);
  assert.doesNotMatch(kernel, /\b(?:malloc|calloc|realloc|free)\s*\(/);
  assert.equal(TelemetryFrameType.TAP_POWER_AMP_SAG, 12);

  const goldens = await readGoldenSet(path.join(root, 'golden'));
  assert.equal(goldens.length, 9);
  assert.ok(goldens.every(item =>
    item.metadata.jsEngineHash === '440672761da989cb2b96d4bd3f37c70fd14cb187b8985567e2ce1a555b751ef7'
  ));
  const result = await runParityCli([
    '--root', repoRoot,
    '--type', 'PowerAmpSagPlugin',
    '--self-check'
  ], { log() {} });
  assert.equal(result.results.length, 9);
  assert.ok(result.results.every(item => item.comparison.pass));
});

test('Power Amp Sag strict telemetry parser reuses the legacy graph update path', async () => {
  const context = await loadPlugin();
  const firstHub = new FakeTelemetryHub();
  context.window.dspTelemetryHub = firstHub;
  const plugin = new context.window.PowerAmpSagPlugin();
  assert.equal(plugin.baseMessageHandlerSetups, 1);
  assert.equal(firstHub.active().length, 1);
  assert.equal(firstHub.active()[0].frameType, 12);

  const valid = makeFrame(37.5, -2.25);
  firstHub.emit(valid);
  valid.payload.setFloat32(0, 99, true);
  valid.payload.setFloat32(4, -9, true);
  assert.equal(plugin.inputEnvelopeBuffer.at(-1), 37.5);
  assert.equal(plugin.gainReductionBuffer.at(-1), -2.25);

  for (const invalid of [
    makeFrame(1, -1, { frameType: 11 }),
    makeFrame(1, -1, { formatVersion: 2 }),
    makeFrame(1, -1, { byteLength: 4 }),
    makeFrame(1, -1, { byteLength: 12 }),
    makeFrame(Number.NaN, -1),
    makeFrame(-0.01, -1),
    makeFrame(1, Number.NEGATIVE_INFINITY),
    makeFrame(1, 0.01),
    { frameType: 12, formatVersion: 1, payload: { byteLength: 8 } }
  ]) {
    assert.equal(plugin.parseDspPowerAmpSagTelemetryFrame(invalid), null);
  }

  plugin.onMessage({
    type: 'processBuffer',
    measurements: { inputEnvelope: 12.5, gainReduction: -0.5, time: 2 }
  });
  assert.equal(plugin.inputEnvelopeBuffer.at(-1), 12.5);
  assert.equal(plugin.gainReductionBuffer.at(-1), -0.5);

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
