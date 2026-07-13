import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import { readGoldenSet } from '../../tools/dsp-parity/golden-io.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'lofi', 'dsd64_imd_simulator');

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

async function loadPlugin() {
  const context = {
    Array,
    ArrayBuffer,
    DataView,
    Float32Array,
    Int16Array,
    Math,
    Number,
    Uint32Array,
    cancelAnimationFrame() {},
    console,
    requestAnimationFrame: () => 1,
    window: { dspTelemetryHub: null, workletNode: null },
    PluginBase: class {
      constructor(name, description) {
        this.name = name;
        this.description = description;
        this.id = 111;
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
  const source = await fs.readFile(
    path.join(repoRoot, 'plugins', 'lofi', 'dsd64_imd_simulator.js'),
    'utf8'
  );
  vm.runInContext(source, context, { filename: 'dsd64_imd_simulator.js' });
  return context;
}

function makeFrame({
  channels = 2,
  sampleRate = 96000,
  flags = 1,
  meters = [-31.5, -42.25, -53.75, -29.125, -12.5],
  frameType = 11,
  formatVersion = 1,
  byteLength = 32
} = {}) {
  const payload = new DataView(new ArrayBuffer(byteLength));
  if (byteLength >= 4) payload.setUint32(0, channels, true);
  if (byteLength >= 8) payload.setFloat32(4, sampleRate, true);
  if (byteLength >= 12) payload.setUint32(8, flags, true);
  for (let index = 0; index < meters.length && 12 + index * 4 + 4 <= byteLength; index++) {
    payload.setFloat32(12 + index * 4, meters[index], true);
  }
  return { frameType, formatVersion, payload };
}

test('DSD64 schema, parity cases, registry, and allocation contract stay frozen', async () => {
  const schemaPath = path.join(pluginRoot, 'params.json');
  const [schemaText, casesText, kernel, nativeTest, registry, cmake] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(pluginRoot, 'cases.json'), 'utf8'),
    fs.readFile(path.join(pluginRoot, 'kernel.cpp'), 'utf8'),
    fs.readFile(path.join(pluginRoot, 'native_test.cpp'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'CMakeLists.txt'), 'utf8')
  ]);
  const schema = validateParamSpec(JSON.parse(schemaText), schemaPath);
  const cases = JSON.parse(casesText).cases;
  assert.equal(schema.type, 'DSD64IMDSimulatorPlugin');
  assert.equal(schema.hash, 0x48f2aa5e);
  assert.equal(schema.floatCount, 12);
  assert.equal(cases.length, 8);
  assert.ok(cases.some(item => item.sampleRate === 48000));
  assert.ok(cases.some(item => item.sampleRate === 88200));
  assert.ok(cases.some(item => item.sampleRate === 192000));
  assert.ok(cases.some(item => item.channels === 1));
  assert.ok(cases.some(item => item.channels === 4));
  assert.ok(cases.some(item => item.blockSize === 1));
  assert.ok(cases.some(item => item.events?.length === 6));

  const goldens = await readGoldenSet(path.join(pluginRoot, 'golden'));
  assert.equal(goldens.length, 8);
  assert.ok(goldens.every(item =>
    item.metadata.jsEngineHash ===
      '88bb4f57169a38461e7a80cdb0b15a4ee93aa5dfc71353332d3d8dee841eda0c'
  ));
  assert.match(registry, /EFFETUNE_PLUGIN\(DSD64IMDSimulatorPlugin, lofi\/dsd64_imd_simulator\)/);
  assert.match(cmake, /effetune_dsp_dsd64_imd_simulator_tests/);
  assert.match(kernel, /kPrewarmSamples = 8192u/);
  assert.match(kernel, /random \^= random << 13u;[\s\S]*random \^= random >> 17u;[\s\S]*random \^= random << 5u;/);
  assert.match(nativeTest, /allocation_guard::Scope allocation_scope/);
  const processBody = /void process\([\s\S]*?\n  }\n\n  void writeTelemetry/.exec(kernel)?.[0];
  assert.ok(processBody);
  assert.doesNotMatch(processBody, /\.resize\(|\.reserve\(|push_back|new\s/);
});

test('DSD64 telemetry uses reserved frame 11 and strictly parses the 32-byte payload', async () => {
  assert.equal(TelemetryFrameType.TAP_DSD64_IMD, 11);
  const context = await loadPlugin();
  const Plugin = context.window.DSD64IMDSimulatorPlugin;
  const plugin = new Plugin();
  const hub = new FakeTelemetryHub();
  context.window.dspTelemetryHub = hub;
  plugin.getParameters();
  assert.deepEqual(
    hub.active().map(subscription => [subscription.tapId, subscription.frameType]),
    [[111, 11]]
  );

  const valid = plugin.parseDspImdTelemetryFrame(makeFrame());
  assert.deepEqual(JSON.parse(JSON.stringify(valid)), {
    channels: 2,
    sampleRate: 96000,
    meters: { add: -31.5, att: -42.25, cross: -53.75, tot: -29.125, out: -12.5 }
  });
  const invalidRate = plugin.parseDspImdTelemetryFrame(
    makeFrame({ sampleRate: 48000, flags: 0 })
  );
  assert.deepEqual(JSON.parse(JSON.stringify(invalidRate)), {
    channels: 2,
    sampleRate: 48000
  });

  const malformed = [
    makeFrame({ frameType: 12 }),
    makeFrame({ formatVersion: 2 }),
    makeFrame({ byteLength: 31 }),
    makeFrame({ channels: 0 }),
    makeFrame({ channels: 9 }),
    makeFrame({ sampleRate: Number.NaN }),
    makeFrame({ flags: 2 }),
    makeFrame({ sampleRate: 48000, flags: 1 }),
    { frameType: 11, formatVersion: 1, payload: { byteLength: 32 } }
  ];
  for (const frame of malformed) {
    assert.equal(plugin.parseDspImdTelemetryFrame(frame), null);
  }
});

test('DSD64 telemetry updates warning/meters and retains the legacy message fallback', async () => {
  const context = await loadPlugin();
  const Plugin = context.window.DSD64IMDSimulatorPlugin;
  const plugin = new Plugin();
  const hub = new FakeTelemetryHub();
  context.window.dspTelemetryHub = hub;
  plugin.getParameters();

  hub.emit(makeFrame({ meters: [-20, -21, -22, -23, -24] }));
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.meterLevels)), {
    add: -20,
    att: -21,
    cross: -22,
    tot: -23,
    out: -24
  });
  assert.equal(plugin.errorState, null);

  hub.emit(makeFrame({ sampleRate: 48000, flags: 0 }));
  assert.match(plugin.errorState, /requires an 88\.2 kHz sample rate or higher/);
  assert.equal(plugin.meterLevels.out, -24);

  plugin.onMessage({
    type: 'processBuffer',
    pluginId: 111,
    measurements: {
      channels: 1,
      sampleRate: 96000,
      meters: { add: -10, att: -11, cross: -12, tot: -13, out: -14 }
    }
  });
  assert.equal(plugin.errorState, null);
  assert.equal(plugin.meterLevels.out, -14);

  plugin.cleanup();
  assert.equal(hub.active().length, 0);
  assert.equal(plugin.baseCleanupCalled, true);
});
