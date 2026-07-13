import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { createReferenceSession } from '../../tools/dsp-parity/node-host.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginDirectory = path.join(
  repoRoot, 'dsp', 'plugins', 'lofi', 'digital_error_emulator'
);
const modeOrder = [
  '1', '2A', '2B', '3A', '3B', '4', '5A', '5B', '5C', '6A', '6B', '8', '9', '10', '10A'
];

function testSignal(frames, channels, phase) {
  const signal = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; ++channel) {
    const offset = channel * frames;
    for (let frame = 0; frame < frames; ++frame) {
      signal[offset + frame] = Math.fround(
        0.61 * Math.sin((frame + phase + channel * 11) * 0.137) +
        0.23 * Math.cos((frame + phase * 3 + channel) * 0.053)
      );
    }
  }
  return signal;
}

async function directoryBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

test('Digital Error Emulator schema and host packer freeze mode order', async () => {
  const schemaPath = path.join(pluginDirectory, 'params.json');
  const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const schema = validateParamSpec(raw, schemaPath);
  assert.equal(schema.type, 'DigitalErrorEmulatorPlugin');
  assert.equal(schema.hash, 0x3761d1a4);
  assert.equal(schema.floatCount, 4);
  assert.deepEqual(
    raw.fields.map(({ name, key, kind }) => [name, key, kind]),
    [
      ['bitErrorRateExponent', 'be', 'float'],
      ['mode', 'md', 'enum'],
      ['referenceFs', 'rf', 'float'],
      ['wetMix', 'wt', 'float']
    ]
  );
  assert.deepEqual(raw.fields[1].values, modeOrder);

  const descriptor = DSP_PARAM_PACKERS.get('DigitalErrorEmulatorPlugin');
  assert.ok(descriptor);
  assert.equal(descriptor.hash, schema.hash);
  assert.equal(descriptor.floatCount, 4);
  for (let index = 0; index < modeOrder.length; ++index) {
    assert.deepEqual(
      [...descriptor.pack({ be: -2, md: modeOrder[index], rf: 192, wt: 25 })],
      [-2, index, 192, 25]
    );
  }
  assert.deepEqual([...descriptor.pack({})], [-6, 14, 48, 100]);
});

test('Digital Error Emulator goldens load every mode within the storage budget', async () => {
  const goldenDirectory = path.join(pluginDirectory, 'golden');
  assert.ok(await directoryBytes(goldenDirectory) <= DEFAULT_GOLDEN_BUDGET_BYTES);
  const goldens = await readGoldenSet(goldenDirectory);
  assert.equal(goldens.length, 9);

  const coveredModes = new Set();
  for (const golden of goldens) {
    coveredModes.add(golden.metadata.params.md);
    for (const event of golden.metadata.events) {
      if (event.params.md !== undefined) coveredModes.add(event.params.md);
    }
    assert.equal(golden.metadata.type, 'DigitalErrorEmulatorPlugin');
    assert.equal(
      golden.metadata.jsEngineHash,
      '84152fab2bf583d274eb4d138ab3ee2ae96c8eb5284498bb3983b57608cc2e28'
    );
    assert.ok(golden.expected.every(Number.isFinite));
  }
  assert.deepEqual(coveredModes, new Set(modeOrder));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 44100));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 96000));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 192000));
  assert.ok(goldens.some(item => item.metadata.channels === 1));
  assert.ok(goldens.some(item => item.metadata.channels === 4));
  assert.ok(goldens.some(item => item.metadata.blockSize === 1));
  assert.ok(goldens.some(item => item.metadata.events.length > 0));
});

test('Digital Error Emulator reference freezes history and RNG while bypassed', async () => {
  const params = { be: -2, md: '6B', rf: 48, wt: 100 };
  const resumed = await createReferenceSession('DigitalErrorEmulatorPlugin', {
    repoRoot,
    params,
    seed: 0x123456789abcdef0n
  });
  const uninterrupted = await createReferenceSession('DigitalErrorEmulatorPlugin', {
    repoRoot,
    params,
    seed: 0x123456789abcdef0n
  });
  const prefix = testSignal(127, 2, 3);
  const bypass = testSignal(61, 2, 137);
  const suffix = testSignal(113, 2, 257);
  await resumed.process(prefix, { sampleRate: 48000, frames: 127, channels: 2, blockSize: 127 });
  await uninterrupted.process(prefix, { sampleRate: 48000, frames: 127, channels: 2, blockSize: 127 });
  resumed.plugin.enabled = false;
  assert.deepEqual(
    await resumed.process(bypass, { sampleRate: 48000, frames: 61, channels: 2, blockSize: 61 }),
    bypass
  );
  resumed.plugin.enabled = true;
  assert.deepEqual(
    await resumed.process(suffix, { sampleRate: 48000, frames: 113, channels: 2, blockSize: 113 }),
    await uninterrupted.process(suffix, { sampleRate: 48000, frames: 113, channels: 2, blockSize: 113 })
  );
});

test('Digital Error Emulator kernel keeps history allocation out of process', async () => {
  const source = await fs.readFile(path.join(pluginDirectory, 'kernel.cpp'), 'utf8');
  const processStart = source.indexOf('  void process(');
  const processEnd = source.indexOf('\nprivate:', processStart);
  assert.ok(processStart >= 0 && processEnd > processStart);
  const processBody = source.slice(processStart, processEnd);
  assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
  assert.doesNotMatch(processBody, /std::(?:fabs|abs|max|min)\s*\(/);
  assert.match(source, /kMaximumPlcSamples = 8192u/);
  assert.match(source, /plc_buffer_\.resize/);
  assert.match(source, /#include "effetune\/dsp\/xorshift_rng\.h"/);
  assert.match(source, /setRandomSeed\(/);
  assert.match(source, /random_\.seed\(selected_seed_low_, selected_seed_high_\)/);

  const registry = await fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8');
  assert.match(
    registry,
    /EFFETUNE_PLUGIN\(DigitalErrorEmulatorPlugin, lofi\/digital_error_emulator\)/
  );
});
