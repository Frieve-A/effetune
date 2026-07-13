import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import { readGoldenSet } from '../../tools/dsp-parity/golden-io.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'eq', 'five_band_dynamic_eq');

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
    Math,
    Number,
    cancelAnimationFrame() {},
    console,
    requestAnimationFrame: () => 1,
    window: { dspTelemetryHub: null, workletNode: null },
    PluginBase: class {
      constructor(name, description) {
        this.name = name;
        this.description = description;
        this.id = 141;
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
    path.join(repoRoot, 'plugins', 'eq', 'five_band_dynamic_eq.js'),
    'utf8'
  );
  vm.runInContext(source, context, { filename: 'five_band_dynamic_eq.js' });
  return context;
}

function makeFrame({
  gains = [-1, 2, -3, 4, -5],
  bandCount = 5,
  reserved1 = 0,
  reserved2 = 0,
  frameType = 14,
  formatVersion = 1,
  byteLength = 24
} = {}) {
  const payload = new DataView(new ArrayBuffer(byteLength));
  if (byteLength >= 1) payload.setUint8(0, bandCount);
  if (byteLength >= 2) payload.setUint8(1, reserved1);
  if (byteLength >= 4) payload.setUint16(2, reserved2, true);
  for (let band = 0; band < gains.length && 8 + band * 4 <= byteLength; band++) {
    payload.setFloat32(4 + band * 4, gains[band], true);
  }
  return { frameType, formatVersion, payload };
}

test('FiveBandDynamicEQ object-array layout, cases, and goldens stay frozen', async () => {
  const schemaPath = path.join(pluginRoot, 'params.json');
  const [schemaText, casesText, kernel, nativeTest] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(pluginRoot, 'cases.json'), 'utf8'),
    fs.readFile(path.join(pluginRoot, 'kernel.cpp'), 'utf8'),
    fs.readFile(path.join(pluginRoot, 'native_test.cpp'), 'utf8')
  ]);
  const schema = validateParamSpec(JSON.parse(schemaText), schemaPath);
  const cases = JSON.parse(casesText).cases;
  assert.equal(schema.type, 'FiveBandDynamicEQ');
  assert.equal(schema.hash, 0xb02487c7);
  assert.equal(schema.floatCount, 60);
  assert.deepEqual(
    schema.fields.map(field => [field.objectArrayKey, field.memberKey, field.count]),
    Array.from({ length: 12 }, (_, index) => [
      'bs',
      ['en', 'ft', 'f', 'q', 'mg', 'th', 'r', 'kn', 'a', 'rl', 'scf', 'scq'][index],
      5
    ])
  );

  const packer = DSP_PARAM_PACKERS.get('FiveBandDynamicEQ');
  assert.equal(packer.hash, 0xb02487c7);
  assert.equal(packer.floatCount, 60);
  const packed = packer.pack({
    bs: Array.from({ length: 5 }, (_, band) => ({
      en: band % 2 === 0,
      ft: ['pk', 'ls', 'hs', 'pk', 'ls'][band],
      f: 100 + band,
      q: 1 + band,
      mg: 2 + band,
      th: -10 - band,
      r: 3 + band,
      kn: 4 + band,
      a: 5 + band,
      rl: 100 + band,
      scf: 1000 + band,
      scq: 6 + band
    }))
  });
  assert.equal(packed.length, 60);
  assert.deepEqual([...packed.slice(0, 5)], [1, 0, 1, 0, 1]);
  assert.deepEqual([...packed.slice(5, 10)], [0, 1, 2, 0, 1]);
  assert.deepEqual([...packed.slice(10, 15)], [100, 101, 102, 103, 104]);
  assert.deepEqual([...packed.slice(55, 60)], [6, 7, 8, 9, 10]);

  assert.equal(cases.length, 8);
  assert.ok(cases.some(item => item.sampleRate === 44100));
  assert.ok(cases.some(item => item.sampleRate === 192000));
  assert.ok(cases.some(item => item.channels === 1));
  assert.ok(cases.some(item => item.channels === 4));
  assert.ok(cases.some(item => item.blockSize === 1));
  assert.ok(cases.some(item => item.id.includes('coefficient-hold')));
  assert.ok(cases.some(item => item.id.includes('pointer-orientation')));

  const goldens = await readGoldenSet(path.join(pluginRoot, 'golden'));
  assert.equal(goldens.length, 8);
  assert.ok(goldens.every(item =>
    item.metadata.jsEngineHash ===
      '4ecd487bc26f926d55cb5067c7e97287df8810707edb2e61d41af0abab2ba19f'
  ));
  assert.match(kernel, /kGainThreshold = 1\.0e-4/);
  assert.match(kernel, /std::swap\(current, processed\)/);
  assert.match(nativeTest, /allocation_guard::Scope allocation_scope/);
  const processBody = /void process\([\s\S]*?\n  }\n\n  void writeTelemetry/.exec(kernel)?.[0];
  assert.ok(processBody);
  assert.doesNotMatch(processBody, /\.resize\(|\.reserve\(|push_back|new\s/);
});

test('FiveBandDynamicEQ strictly parses telemetry frame 14 and updates legacy graph state', async () => {
  assert.equal(TelemetryFrameType.TAP_FIVE_BAND_DYNAMIC_EQ, 14);
  const context = await loadPlugin();
  const Plugin = context.window.FiveBandDynamicEQ;
  const plugin = new Plugin();
  const hub = new FakeTelemetryHub();
  context.window.dspTelemetryHub = hub;
  plugin.getParameters();
  assert.deepEqual(
    hub.active().map(subscription => [subscription.tapId, subscription.frameType]),
    [[141, 14]]
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.parseDspDynamicEqTelemetryFrame(makeFrame()))),
    [-1, 2, -3, 4, -5]
  );
  const malformed = [
    makeFrame({ frameType: 13 }),
    makeFrame({ formatVersion: 2 }),
    makeFrame({ byteLength: 23 }),
    makeFrame({ bandCount: 4 }),
    makeFrame({ reserved1: 1 }),
    makeFrame({ reserved2: 1 }),
    makeFrame({ gains: [25, 0, 0, 0, 0] }),
    makeFrame({ gains: [Number.NaN, 0, 0, 0, 0] }),
    { frameType: 14, formatVersion: 1, payload: { byteLength: 24 } }
  ];
  for (const frame of malformed) {
    assert.equal(plugin.parseDspDynamicEqTelemetryFrame(frame), null);
  }

  hub.emit(makeFrame({ gains: [-0.5, 0, -3.25, 1.5, -12] }));
  assert.deepEqual(JSON.parse(JSON.stringify(plugin.latestSmoothedGains)),
    [-0.5, 0, -3.25, 1.5, -12]);
  plugin.onMessage({
    type: 'processBuffer',
    measurements: { gains: new Float32Array([1, 2, 3, 4, 5]) }
  });
  assert.deepEqual([...plugin.latestSmoothedGains], [1, 2, 3, 4, 5]);

  plugin.cleanup();
  assert.equal(hub.active().length, 0);
  assert.equal(plugin.baseCleanupCalled, true);
});
