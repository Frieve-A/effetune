import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  defaultParamsFromSchema
} from '../../tools/dsp-parity/cases.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const dynamicsRoot = path.join(repoRoot, 'dsp', 'plugins', 'dynamics');
const ports = [
  {
    type: 'MultibandCompressorPlugin',
    folder: 'multiband_compressor',
    hash: 0xe52acce2,
    floatCount: 34,
    bandCount: 5,
    telemetryKind: 0,
    measurement: 'gainReductions',
    memberKeys: ['t', 'r', 'a', 'rl', 'k', 'g'],
    jsEngineHash: 'a7d70df6a67d13b3f1631f65286cce814aaa220c71b3405e8e01a7a910ee412e'
  },
  {
    type: 'MultibandExpanderPlugin',
    folder: 'multiband_expander',
    hash: 0xe52acce2,
    floatCount: 34,
    bandCount: 5,
    telemetryKind: 1,
    measurement: 'gainBoosts',
    memberKeys: ['t', 'r', 'a', 'rl', 'k', 'g'],
    jsEngineHash: 'cd166ecc72bd69d594350405c0d039b14a46d0bd3777992f349f2bd41a33f891'
  },
  {
    type: 'MultibandTransientPlugin',
    folder: 'multiband_transient',
    hash: 0x5521411c,
    floatCount: 23,
    bandCount: 3,
    telemetryKind: 2,
    measurement: 'gains',
    memberKeys: ['fa', 'fr', 'sa', 'sr', 'gt', 'gs', 'sm'],
    jsEngineHash: '09f027cf207cd94386ea0ab1879a3243a919b3f033490eb817f231fd93015e1a'
  }
];

async function directoryBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

async function readPort(port) {
  const root = path.join(dynamicsRoot, port.folder);
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

async function loadPluginClasses() {
  let nextId = 700;
  let now = 1000;
  const context = {
    Array,
    ArrayBuffer,
    DataView,
    Float32Array,
    Map,
    Math,
    Number,
    cancelAnimationFrame() {},
    console,
    performance: { now: () => now },
    requestAnimationFrame: () => 1,
    window: { dspTelemetryHub: null },
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
  for (const port of ports) {
    const source = await fs.readFile(
      path.join(repoRoot, 'plugins', 'dynamics', `${port.folder}.js`),
      'utf8'
    );
    vm.runInContext(source, context, { filename: `${port.folder}.js` });
  }
  return {
    context,
    classes: new Map(ports.map(port => [port.type, context.window[port.type]])),
    advance(milliseconds = 1000) {
      now += milliseconds;
    }
  };
}

function makeTelemetryFrame(port, values, {
  frameType = 13,
  formatVersion = 1,
  bandCount = port.bandCount,
  kind = port.telemetryKind,
  reserved = 0,
  byteLength = 4 + port.bandCount * 4
} = {}) {
  const buffer = new ArrayBuffer(byteLength);
  const payload = new DataView(buffer);
  if (byteLength >= 1) payload.setUint8(0, bandCount);
  if (byteLength >= 2) payload.setUint8(1, kind);
  if (byteLength >= 4) payload.setUint16(2, reserved, true);
  for (let band = 0; band < values.length && 4 + band * 4 + 4 <= byteLength; band++) {
    payload.setFloat32(4 + band * 4, values[band], true);
  }
  return { frameType, formatVersion, payload };
}

test('multiband schemas pack object-array bands into the frozen field-major ABI', async () => {
  for (const port of ports) {
    const { schema } = await readPort(port);
    assert.equal(schema.type, port.type);
    assert.equal(schema.hash, port.hash);
    assert.equal(schema.floatCount, port.floatCount);

    const objectFields = schema.fields.filter(field => field.objectArrayKey === 'bands');
    assert.deepEqual(objectFields.map(field => field.memberKey), port.memberKeys);
    assert.ok(objectFields.every(field => field.count === port.bandCount));

    const defaults = defaultParamsFromSchema(schema);
    assert.equal(defaults.bands.length, port.bandCount);
    assert.deepEqual(Object.keys(defaults.bands[0]), port.memberKeys);
    const packer = DSP_PARAM_PACKERS.get(port.type);
    assert.equal(packer.hash, port.hash);
    assert.equal(packer.floatCount, port.floatCount);
    const packed = packer.pack(defaults);
    assert.equal(packed.length, port.floatCount);
    assert.ok([...packed].every(Number.isFinite));

    const changed = structuredClone(defaults);
    const changedValue = objectFields[0].min;
    changed.bands[0][port.memberKeys[0]] = changedValue;
    const changedPacked = packer.pack(changed);
    const fieldOffset = schema.fields
      .slice(0, schema.fields.findIndex(field => field.memberKey === port.memberKeys[0]))
      .reduce((total, field) => total + field.count, 0);
    assert.equal(changedPacked[fieldOffset], Math.fround(changedValue));
    assert.deepEqual(
      [...changedPacked.slice(fieldOffset + 1, fieldOffset + port.bandCount)],
      [...packed.slice(fieldOffset + 1, fieldOffset + port.bandCount)]
    );
  }
});

test('multiband reviewed cases and JS goldens remain deterministic', async () => {
  for (const port of ports) {
    const loaded = await readPort(port);
    assert.equal(loaded.cases.cases.length, 9);
    assert.ok(loaded.cases.cases.some(item => item.sampleRate === 192000));
    assert.ok(loaded.cases.cases.some(item => item.channels === 1));
    assert.ok(loaded.cases.cases.some(item => item.channels === 4));
    assert.ok(loaded.cases.cases.some(item => item.blockSize === 1));
    assert.ok(loaded.cases.cases.some(item => item.events?.length > 0));
    assert.ok(loaded.cases.cases.some(item =>
      item.events?.some(event => Array.isArray(event.params?.bands))));

    const goldenRoot = path.join(loaded.root, 'golden');
    assert.ok(await directoryBytes(goldenRoot) <= DEFAULT_GOLDEN_BUDGET_BYTES);
    const goldens = await readGoldenSet(goldenRoot);
    assert.equal(goldens.length, 9);
    assert.ok(goldens.every(item => item.metadata.type === port.type));
    assert.ok(goldens.every(item => item.metadata.jsEngineHash === port.jsEngineHash));
    assert.ok(goldens.every(item => item.expected.every(Number.isFinite)));

    const result = await runParityCli([
      '--root', repoRoot,
      '--type', port.type,
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, 9);
    assert.ok(result.results.every(item => item.comparison.pass));
  }
});

test('multiband kernels share LR24 math without process-time allocation', async () => {
  const [linkwitzRiley, common, registry, nativeTest] = await Promise.all([
    fs.readFile(path.join(repoRoot, 'dsp', 'include', 'effetune', 'dsp',
      'linkwitz_riley.h'), 'utf8'),
    fs.readFile(path.join(dynamicsRoot, 'multiband_common.h'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8'),
    fs.readFile(path.join(dynamicsRoot, 'multiband_native_test.cpp'), 'utf8')
  ]);
  assert.match(linkwitzRiley, /designLinkwitzRiley24/);
  assert.match(linkwitzRiley, /LinkwitzRileyStateStorage::Float32/);
  assert.match(linkwitzRiley, /quantizeLinkwitzRiley24StateToFloat/);
  assert.match(common, /LinkwitzRileyStateStorage::Float32/);
  assert.match(common, /quantizeLinkwitzRiley24StateToFloat/);
  assert.match(nativeTest, /LinkwitzRileyStateStorage::Float64/);
  assert.match(nativeTest, /testCrossoverTransitionStateContracts/);

  const registryNames = ports.map(port => `EFFETUNE_PLUGIN(${port.type}`);
  let priorIndex = registry.indexOf('EFFETUNE_PLUGIN(GatePlugin');
  for (const name of registryNames) {
    const index = registry.indexOf(name);
    assert.ok(index > priorIndex, `${name} must stay alphabetically registered`);
    priorIndex = index;
  }
  assert.ok(priorIndex < registry.indexOf('EFFETUNE_PLUGIN(TransientShaperPlugin'));

  for (const port of ports) {
    const { kernel } = await readPort(port);
    assert.match(kernel, /static_assert\(sizeof\(.+Kernel\) <= 8192u\)/);
    assert.doesNotMatch(kernel, /\b(?:malloc|calloc|realloc|free)\s*\(/);
    const processStart = kernel.indexOf('  void process(');
    const processEnd = kernel.indexOf('\nprivate:', processStart);
    assert.ok(processStart >= 0 && processEnd > processStart);
    const processBody = kernel.slice(processStart, processEnd);
    assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
    assert.doesNotMatch(processBody, /std::(?:fabs|max|min)\s*\(/);
  }
});

test('multiband telemetry parsers are strict and retain processBuffer graph paths', async () => {
  assert.equal(TelemetryFrameType.TAP_MULTIBAND_DYNAMICS, 13);
  const loaded = await loadPluginClasses();

  for (const port of ports) {
    const firstHub = new FakeTelemetryHub();
    loaded.context.window.dspTelemetryHub = firstHub;
    const PluginClass = loaded.classes.get(port.type);
    const plugin = new PluginClass();
    assert.equal(plugin.baseMessageHandlerSetups, 1);
    assert.equal(firstHub.active().length, 1);
    assert.equal(firstHub.active()[0].tapId, plugin.id);
    assert.equal(firstHub.active()[0].frameType, 13);

    const values = port.telemetryKind === 2
      ? [-3.5, 0.25, 2.75]
      : Array.from({ length: port.bandCount }, (_, index) => index + 0.5);
    loaded.advance();
    firstHub.emit(makeTelemetryFrame(port, values));
    if (port.measurement === 'gainReductions') {
      assert.deepEqual(Array.from(plugin.bands, band => band.gr), values);
    } else if (port.measurement === 'gainBoosts') {
      assert.deepEqual(Array.from(plugin.bands, band => band.gb), values);
    } else {
      assert.deepEqual(
        Array.from(plugin.gainBuffers, buffer => buffer[buffer.length - 1]),
        values
      );
    }

    const invalid = [
      makeTelemetryFrame(port, values, { frameType: 12 }),
      makeTelemetryFrame(port, values, { formatVersion: 2 }),
      makeTelemetryFrame(port, values, { bandCount: port.bandCount + 1 }),
      makeTelemetryFrame(port, values, { kind: (port.telemetryKind + 1) % 3 }),
      makeTelemetryFrame(port, values, { reserved: 1 }),
      makeTelemetryFrame(port, values, { byteLength: 4 + port.bandCount * 4 - 1 }),
      makeTelemetryFrame(port, values, { byteLength: 4 + port.bandCount * 4 + 4 }),
      makeTelemetryFrame(port, [Number.NaN, ...values.slice(1)])
    ];
    if (port.telemetryKind !== 2) {
      invalid.push(makeTelemetryFrame(port, [-0.25, ...values.slice(1)]));
    }
    for (const frame of invalid) {
      assert.equal(plugin.parseDspMultibandTelemetryFrame(frame), null);
    }

    const fallback = port.telemetryKind === 2
      ? [-1, 1, 3]
      : Array.from({ length: port.bandCount }, (_, index) => index + 2);
    loaded.advance();
    plugin.onMessage({
      type: 'processBuffer',
      measurements: {
        [port.measurement]: fallback,
        ...(port.telemetryKind === 2 ? { time: 10 } : {})
      }
    });
    if (port.measurement === 'gainReductions') {
      assert.deepEqual(Array.from(plugin.bands, band => band.gr), fallback);
    } else if (port.measurement === 'gainBoosts') {
      assert.deepEqual(Array.from(plugin.bands, band => band.gb), fallback);
    } else {
      assert.deepEqual(
        Array.from(plugin.gainBuffers, buffer => buffer[buffer.length - 1]),
        fallback
      );
    }

    const originalTapId = plugin.id;
    plugin.id = originalTapId + 1000;
    plugin.getParameters();
    assert.equal(firstHub.active().length, 1);
    assert.equal(firstHub.active()[0].tapId, plugin.id);

    const secondHub = new FakeTelemetryHub();
    loaded.context.window.dspTelemetryHub = secondHub;
    plugin.getParameters();
    assert.equal(firstHub.active().length, 0);
    assert.equal(secondHub.active().length, 1);
    assert.equal(secondHub.active()[0].tapId, plugin.id);

    plugin.cleanup();
    assert.equal(secondHub.active().length, 0);
    assert.equal(plugin.baseCleanupCalled, true);
  }
});
