import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PARAMS_HASH = 0x2d876fa2;
const ports = [
  {
    type: 'CompressorPlugin',
    folder: 'compressor',
    measurement: 'gainReduction',
    jsEngineHash: 'c2bd4699d6cff64f1f0d63dacb5ee273a06022ad5d1940f68a6f0681dac3956b'
  },
  {
    type: 'GatePlugin',
    folder: 'gate',
    measurement: 'gainReduction',
    jsEngineHash: 'a40d47f78909234b3dcaee924b6f7e99b7101c5b5609605c0a7284466f7e646d'
  },
  {
    type: 'ExpanderPlugin',
    folder: 'expander',
    measurement: 'gainBoost',
    jsEngineHash: 'f1bb266f9f26237b5e424bb9f7f2c582d3bf6913d7a2211a0cacb0d88d3a0871'
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
  const [schemaText, casesText, kernel, common] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(root, 'cases.json'), 'utf8'),
    fs.readFile(path.join(root, 'kernel.cpp'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'plugins', 'dynamics', 'compressor',
      'dynamics_common.h'), 'utf8')
  ]);
  return {
    root,
    schema: validateParamSpec(JSON.parse(schemaText), schemaPath),
    cases: JSON.parse(casesText),
    kernel,
    common
  };
}

async function loadPluginClasses() {
  let nextId = 100;
  const context = {
    Array,
    ArrayBuffer,
    DataView,
    Float32Array,
    Math,
    Number,
    Uint8Array,
    cancelAnimationFrame() {},
    console,
    performance: { now: () => 1000 },
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
  return { context, classes: new Map(ports.map(port => [port.type, context.window[port.type]])) };
}

function makeFrame(amountDb, { frameType = 2, formatVersion = 1, byteLength = 4 } = {}) {
  const buffer = new ArrayBuffer(byteLength);
  const payload = new DataView(buffer);
  if (byteLength >= 4) payload.setFloat32(0, amountDb, true);
  return { frameType, formatVersion, payload };
}

test('Wave 3c dynamics group A schemas, cases, and reviewed JS goldens stay frozen', async () => {
  for (const port of ports) {
    const loaded = await readPort(port);
    assert.equal(loaded.schema.type, port.type);
    assert.equal(loaded.schema.hash, PARAMS_HASH);
    assert.equal(loaded.schema.floatCount, 6);

    const rawCases = loaded.cases.cases;
    assert.equal(rawCases.length, 8);
    assert.ok(rawCases.every(item => Number.isInteger(item.frames) && item.frames > 0));
    assert.ok(rawCases.some(item => item.sampleRate === 44100));
    assert.ok(rawCases.some(item => item.sampleRate === 96000));
    assert.ok(rawCases.some(item => item.sampleRate === 192000));
    assert.ok(rawCases.some(item => item.channels === 1 && item.channelMode === 'mono'));
    assert.ok(rawCases.some(item => item.channels === 4 && item.channelMode === 'all4'));
    assert.ok(rawCases.some(item => item.blockSize === 83));
    assert.ok(rawCases.some(item => item.blockSize === 127));
    assert.ok(rawCases.some(item => item.events?.length === 4));

    const goldenRoot = path.join(loaded.root, 'golden');
    assert.ok(await directoryBytes(goldenRoot) <= DEFAULT_GOLDEN_BUDGET_BYTES);
    const goldens = await readGoldenSet(goldenRoot);
    assert.equal(goldens.length, 8);
    assert.ok(goldens.every(item => item.metadata.type === port.type));
    assert.ok(goldens.every(item => item.metadata.jsEngineHash === port.jsEngineHash));

    const result = await runParityCli([
      '--root', repoRoot,
      '--type', port.type,
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, 8);
    assert.ok(result.results.every(item => item.comparison.pass));
  }
});

test('Wave 3c dynamics kernels lock allocation, state, and telemetry contracts', async () => {
  for (const port of ports) {
    const { kernel, common } = await readPort(port);
    assert.doesNotMatch(kernel, /\b(?:malloc|calloc|realloc|free)\s*\(/);
    assert.match(kernel, /\.resize\(info\.maxChannels\)/);
    if (port.type !== 'GatePlugin') assert.match(kernel, /work_buffer_\.resize\(info\.maxFrames\)/);
    if (port.type === 'ExpanderPlugin') {
      assert.doesNotMatch(kernel, /persistEnvelopeAsFloat/);
    } else {
      assert.match(kernel, /persistEnvelopeAsFloat/);
    }
    assert.match(kernel, /writeGainReductionTelemetry/);
    assert.match(kernel, /static_assert\(sizeof\(.+Kernel\) <= 8192u\)/);
    assert.match(common, /kTapGainReduction = 2u/);
    assert.match(common, /kTelemetryVersion = 1u/);
    assert.match(common, /std::array<std::uint8_t, 4u> payload/);
  }
});

test('Wave 3c dynamics telemetry parsing is strict and processBuffer remains a fallback', async () => {
  const { context, classes } = await loadPluginClasses();

  for (const port of ports) {
    const firstHub = new FakeTelemetryHub();
    context.window.dspTelemetryHub = firstHub;
    const PluginClass = classes.get(port.type);
    const plugin = new PluginClass();
    assert.equal(plugin.baseMessageHandlerSetups, 1);
    assert.equal(firstHub.active().length, 1);
    assert.equal(firstHub.active()[0].tapId, plugin.id);
    assert.equal(firstHub.active()[0].frameType, 2);

    const processed = [];
    plugin.process = message => {
      processed.push(message.measurements[port.measurement]);
      return 'fallback-result';
    };

    const validFrame = makeFrame(7.25);
    firstHub.emit(validFrame);
    validFrame.payload.setFloat32(0, 99, true);
    assert.deepEqual(processed, [7.25]);

    for (const invalid of [
      makeFrame(1, { frameType: 1 }),
      makeFrame(1, { formatVersion: 2 }),
      makeFrame(1, { byteLength: 3 }),
      makeFrame(1, { byteLength: 8 }),
      makeFrame(Number.NaN),
      makeFrame(Number.POSITIVE_INFINITY),
      makeFrame(-0.25),
      { frameType: 2, formatVersion: 1, payload: { byteLength: 4 } }
    ]) {
      assert.equal(plugin.parseDspGainReductionTelemetryFrame(invalid), null);
    }

    const fallbackMessage = {
      type: 'processBuffer',
      measurements: { [port.measurement]: 3.5 }
    };
    assert.equal(plugin.onMessage(fallbackMessage), 'fallback-result');
    assert.deepEqual(processed, [7.25, 3.5]);

    const originalTapId = plugin.id;
    plugin.id = originalTapId + 1000;
    plugin.getParameters();
    assert.equal(firstHub.active().length, 1);
    assert.equal(firstHub.active()[0].tapId, plugin.id);

    const secondHub = new FakeTelemetryHub();
    context.window.dspTelemetryHub = secondHub;
    plugin.getParameters();
    assert.equal(firstHub.active().length, 0);
    assert.equal(secondHub.active().length, 1);
    assert.equal(secondHub.active()[0].tapId, plugin.id);
    assert.equal(secondHub.active()[0].frameType, 2);

    plugin.cleanup();
    assert.equal(secondHub.active().length, 0);
    assert.equal(plugin.baseCleanupCalled, true);
  }
});
