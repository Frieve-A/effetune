import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import { createReferenceSession } from '../../tools/dsp-parity/node-host.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';
import { generateStimulus } from '../../tools/dsp-parity/stimuli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginRoot = path.join(repoRoot, 'dsp', 'plugins', 'analyzer', 'oscilloscope');
const schemaPath = path.join(pluginRoot, 'params.json');
const goldenDir = path.join(pluginRoot, 'golden');
const jsEngineHash = '55432bb5b50575388dcd8de76f056c5098755f136f01189c8d6e1602184ad009';

async function directoryBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

function inputFor(metadata) {
  return generateStimulus({
    id: metadata.stimulus,
    sampleRate: metadata.sampleRate,
    frames: metadata.frameCount,
    channels: metadata.channels,
    caseIndex: metadata.caseIndex,
    seed: BigInt(metadata.seed)
  });
}

function executeLegacyBlock(plugin, state, values, {
  time,
  sampleRate = 1000,
  channelCount = 1,
  params = {}
}) {
  const data = Float32Array.from(values);
  const blockSize = data.length / channelCount;
  assert.equal(Number.isInteger(blockSize), true);
  const parameters = {
    ...plugin.getParameters(),
    ...params,
    channelCount,
    blockSize,
    sampleRate
  };
  const output = plugin.executeProcessor(state, data, parameters, time);
  assert.equal(output, data);
  return output.measurements;
}

test('Oscilloscope schema freezes legacy parameter keys, enums, bounds, and defaults', async () => {
  const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const schema = validateParamSpec(raw, schemaPath);
  assert.equal(schema.type, 'OscilloscopePlugin');
  assert.equal(schema.hash, 0x84e21dd2);
  assert.equal(schema.floatCount, 7);
  assert.deepEqual(
    raw.fields.map(({ name, key, kind, default: defaultValue }) => ({
      name,
      key,
      kind,
      default: defaultValue
    })),
    [
      { name: 'displayTime', key: 'dt', kind: 'float', default: 0.01 },
      { name: 'triggerMode', key: 'tm', kind: 'enum', default: 'Auto' },
      { name: 'triggerLevel', key: 'tl', kind: 'float', default: 0 },
      { name: 'triggerEdge', key: 'te', kind: 'enum', default: 'Rising' },
      { name: 'holdoff', key: 'ho', kind: 'float', default: 0.0001 },
      { name: 'displayLevel', key: 'dl', kind: 'float', default: 0 },
      { name: 'verticalOffset', key: 'vo', kind: 'float', default: 0 }
    ]
  );
  assert.deepEqual(raw.fields[1].values, ['Auto', 'Normal']);
  assert.deepEqual(raw.fields[3].values, ['Rising', 'Falling']);
  assert.deepEqual([raw.fields[0].min, raw.fields[0].max], [0.001, 0.1]);
  assert.deepEqual([raw.fields[4].min, raw.fields[4].max], [0.0001, 0.01]);
});

test('Oscilloscope passthrough goldens are current, exact, and within budget', async () => {
  assert.ok(await directoryBytes(goldenDir) <= DEFAULT_GOLDEN_BUDGET_BYTES);
  const goldens = await readGoldenSet(goldenDir);
  assert.equal(goldens.length, 7);
  assert.ok(goldens.some(item => item.metadata.channels === 1));
  assert.ok(goldens.some(item => item.metadata.channels === 4));
  assert.ok(goldens.some(item => item.metadata.blockSize === 83));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 192000));
  assert.ok(goldens.some(item => item.metadata.events.length > 0));
  for (const golden of goldens) {
    assert.equal(golden.metadata.jsEngineHash, jsEngineHash);
    assert.deepEqual(golden.expected, inputFor(golden.metadata));
  }

  const result = await runParityCli([
    '--root', repoRoot,
    '--type', 'OscilloscopePlugin',
    '--self-check'
  ], { log() {} });
  assert.equal(result.results.length, 7);
  assert.equal(result.results.every(item => item.comparison.pass), true);
});

test('Oscilloscope legacy processor freezes average, trigger, holdoff, and auto-sweep behavior', async () => {
  const session = await createReferenceSession('OscilloscopePlugin', { repoRoot });
  const plugin = session.plugin;
  assert.deepEqual(
    JSON.parse(JSON.stringify(plugin.getParameters())),
    {
      type: 'OscilloscopePlugin',
      enabled: true,
      dt: 0.01,
      tm: 'Auto',
      tl: 0,
      te: 'Rising',
      ho: 0.0001,
      dl: 0,
      vo: 0
    }
  );

  const triggerState = {};
  let measurements = executeLegacyBlock(
    plugin,
    triggerState,
    [-1, 1, 1, 1],
    { time: 0, params: { tm: 'Normal', tl: 0, te: 'Rising', ho: 0.0001 } }
  );
  assert.equal(measurements.triggerIndex, 0);
  measurements = executeLegacyBlock(
    plugin,
    triggerState,
    [-1, 1, 1, 1],
    { time: 0.01, params: { tm: 'Normal', tl: 0, te: 'Rising', ho: 0.0001 } }
  );
  assert.equal(measurements.triggerIndex, 5);

  const averageState = {};
  measurements = executeLegacyBlock(
    plugin,
    averageState,
    [-1, -0.5, 0.5, 1, 1, 0.5, -0.5, -1],
    { time: 0, channelCount: 2, params: { tm: 'Normal' } }
  );
  assert.deepEqual(Array.from(measurements.buffer.subarray(0, 4)), [0, 0, 0, 0]);

  const autoState = {};
  executeLegacyBlock(plugin, autoState, [0, 0, 0, 0], {
    time: 0,
    params: { tm: 'Auto' }
  });
  executeLegacyBlock(plugin, autoState, [0, 0, 0, 0], {
    time: 0.05,
    params: { tm: 'Auto' }
  });
  measurements = executeLegacyBlock(plugin, autoState, [0, 0, 0, 0], {
    time: 0.16,
    params: { tm: 'Auto' }
  });
  assert.equal(measurements.currentPosition, 12);
  assert.equal(measurements.triggerIndex, 12);
});
