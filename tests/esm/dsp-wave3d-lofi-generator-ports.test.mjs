import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { createReferenceSession } from '../../tools/dsp-parity/node-host.mjs';
import { generateStimulus } from '../../tools/dsp-parity/stimuli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins');

const ports = [
  {
    directory: 'lofi/bit_crusher',
    type: 'BitCrusherPlugin',
    hash: 0xcb875f0e,
    fields: [
      ['bitDepth', 'bd', 'int'],
      ['tpdfDither', 'td', 'bool'],
      ['zohFrequency', 'zf', 'float'],
      ['bitError', 'be', 'float'],
      ['seed', 'sd', 'int']
    ],
    caseCount: 7,
    goldenBytes: 121804,
    jsEngineHash: 'a0787611d2d9457b8172d3d71e7a4a67d6a18efe93329c9314a420ede1cb53a0',
    activeParams: { bd: 8, td: true, zf: 44100, be: 10, sd: 11 }
  },
  {
    directory: 'lofi/noise_blender',
    type: 'NoiseBlenderPlugin',
    hash: 0x177efcad,
    fields: [
      ['noiseType', 'nt', 'enum'],
      ['level', 'lv', 'float'],
      ['perChannel', 'pc', 'bool']
    ],
    caseCount: 8,
    goldenBytes: 137472,
    jsEngineHash: '6c12ea735e06a43d58ceef780cd5c55dc499a69820c07bd2b06549cad7736a96',
    activeParams: { nt: 'pink', lv: -6, pc: true }
  },
  {
    directory: 'lofi/simple_jitter',
    type: 'SimpleJitterPlugin',
    hash: 0xbe8a582f,
    fields: [['rmsJitter', 'rj', 'float']],
    caseCount: 5,
    goldenBytes: 183531,
    jsEngineHash: 'c26463e3c5aabaacb65354944ca5c5752731d032a3e397a93bdbbc9c42dd0a30',
    activeParams: { rj: 200 }
  },
  {
    directory: 'lofi/hum_generator',
    type: 'HumGeneratorPlugin',
    hash: 0x95359630,
    fields: [
      ['frequency', 'fr', 'float'],
      ['humType', 'tp', 'enum'],
      ['harmonics', 'hm', 'int'],
      ['tone', 'tn', 'float'],
      ['instability', 'in', 'float'],
      ['level', 'lv', 'float']
    ],
    caseCount: 8,
    goldenBytes: 232331,
    jsEngineHash: 'f9de1f3159103739fdc2f77302b463cbb4f85fa3c06869d1b680ff676103114d',
    activeParams: { fr: 50, tp: 'Dirty', hm: 100, tn: 20, in: 10, lv: -12 }
  },
  {
    directory: 'others/oscillator',
    type: 'OscillatorPlugin',
    hash: 0xc3977673,
    fields: [
      ['frequency', 'fr', 'float'],
      ['volume', 'vl', 'float'],
      ['panning', 'pn', 'float'],
      ['waveform', 'wf', 'enum'],
      ['mode', 'md', 'enum'],
      ['interval', 'it', 'float'],
      ['width', 'wd', 'float']
    ],
    caseCount: 13,
    goldenBytes: 232893,
    jsEngineHash: '3a1f4dc7da1d024ce3e0846ff3724f3ae9ff4729746b4d7d01d81d525992094c',
    activeParams: { fr: 880, vl: -6, pn: 0, wf: 'pink', md: 'pulsed', it: 100, wd: 50 }
  }
];

async function fileBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

function testSignal(frames, channels, phase) {
  const signal = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; ++channel) {
    const offset = channel * frames;
    for (let frame = 0; frame < frames; ++frame) {
      signal[offset + frame] = Math.fround(
        0.55 * Math.sin((frame + phase + channel * 7) * 0.173) +
        0.2 * Math.cos((frame + phase * 3 + channel) * 0.071)
      );
    }
  }
  return signal;
}

function maxGeneratorResidual(silent, withInput) {
  const metadata = withInput.metadata;
  const input = generateStimulus({
    id: metadata.stimulus,
    sampleRate: metadata.sampleRate,
    frames: metadata.frameCount,
    channels: metadata.channels,
    caseIndex: metadata.caseIndex,
    seed: BigInt(metadata.seed)
  });
  let maximum = 0;
  for (let index = 0; index < input.length; ++index) {
    const residual = Math.abs((withInput.expected[index] - input[index]) - silent.expected[index]);
    if (residual > maximum) maximum = residual;
  }
  return maximum;
}

test('Wave 3d schemas freeze source parameter order, layouts, and source hashes', async () => {
  for (const port of ports) {
    const schemaPath = path.join(pluginsRoot, port.directory, 'params.json');
    const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
    const schema = validateParamSpec(raw, schemaPath);
    assert.equal(schema.type, port.type);
    assert.equal(schema.hash, port.hash);
    assert.equal(schema.floatCount, port.fields.length);
    assert.deepEqual(
      raw.fields.map(({ name, key, kind }) => [name, key, kind]),
      port.fields
    );
  }
});

test('Wave 3d goldens are deterministic, bounded, finite, and representative', async () => {
  for (const port of ports) {
    const goldenDir = path.join(pluginsRoot, port.directory, 'golden');
    assert.equal(await fileBytes(goldenDir), port.goldenBytes);
    assert.ok(port.goldenBytes <= DEFAULT_GOLDEN_BUDGET_BYTES);
    const goldens = await readGoldenSet(goldenDir);
    assert.equal(goldens.length, port.caseCount);
    assert.ok(goldens.some(item => item.metadata.sampleRate === 44100));
    assert.ok(goldens.some(item => item.metadata.sampleRate === 96000));
    assert.ok(goldens.some(item => item.metadata.sampleRate === 192000));
    assert.ok(goldens.some(item => item.metadata.channels === 1));
    assert.ok(goldens.some(item => item.metadata.channels === 4));
    assert.ok(goldens.some(item => (item.metadata.blockSize & 1) === 1));
    assert.ok(goldens.some(item => item.metadata.blockSize === 1));
    assert.ok(goldens.some(item => item.metadata.events.length > 0));
    for (const golden of goldens) {
      assert.equal(golden.metadata.type, port.type);
      assert.equal(golden.metadata.jsEngineHash, port.jsEngineHash);
      assert.equal(golden.expected.length,
        golden.metadata.frameCount * golden.metadata.channels);
      assert.ok(golden.expected.every(Number.isFinite));
    }
  }
});

test('Bit Crusher applies configured depth and random-system behavior', async () => {
  const goldens = await readGoldenSet(path.join(pluginsRoot, 'lofi/bit_crusher/golden'));
  const depthCase = goldens.find(item => item.metadata.id === 'every-bit-depth');
  const depths = [depthCase.metadata.params.bd,
    ...depthCase.metadata.events.map(event => event.params.bd)];
  assert.deepEqual(depths, Array.from({ length: 21 }, (_, index) => index + 4));
  assert.ok(goldens.some(item => item.metadata.params.td === false));
  assert.ok(goldens.some(item => item.metadata.params.td === true));
  assert.ok(goldens.some(item => item.metadata.params.zf === 4000));
  assert.ok(goldens.some(item => item.metadata.params.zf === 96000));
  assert.ok(goldens.some(item => item.metadata.params.be === 0));
  assert.ok(goldens.some(item => item.metadata.params.be === 10));
  assert.ok(goldens.some(item => item.metadata.params.sd === 0));
  assert.ok(goldens.some(item => item.metadata.params.sd === 1000));
});

test('Noise and generator modes honor their parameter extrema', async () => {
  const noise = await readGoldenSet(path.join(pluginsRoot, 'lofi/noise_blender/golden'));
  assert.deepEqual(new Set(noise.map(item => item.metadata.params.nt)),
    new Set(['white', 'pink', 'brown']));
  assert.ok(noise.some(item => item.metadata.params.pc === false));
  assert.ok(noise.some(item => item.metadata.params.pc === true));
  assert.ok(noise.some(item => item.metadata.params.lv === -96));
  assert.ok(noise.some(item => item.metadata.params.lv === 0));

  const jitter = await readGoldenSet(path.join(pluginsRoot, 'lofi/simple_jitter/golden'));
  assert.ok(jitter.some(item => item.metadata.params.rj === 0));
  assert.ok(jitter.some(item => item.metadata.params.rj === 200));
  assert.ok(jitter.some(item => item.metadata.frameCount > item.metadata.sampleRate * 0.02));

  const hum = await readGoldenSet(path.join(pluginsRoot, 'lofi/hum_generator/golden'));
  assert.deepEqual(new Set(hum.map(item => item.metadata.params.tp)),
    new Set(['Standard', 'Rich', 'Dirty']));
  assert.ok(hum.some(item => item.metadata.params.fr === 10));
  assert.ok(hum.some(item => item.metadata.params.fr === 120));

  const oscillator = await readGoldenSet(path.join(pluginsRoot, 'others/oscillator/golden'));
  assert.deepEqual(new Set(oscillator.map(item => item.metadata.params.wf)),
    new Set(['sine', 'square', 'triangle', 'sawtooth', 'white', 'pink']));
  assert.ok(oscillator.some(item => item.metadata.params.md === 'continuous'));
  assert.ok(oscillator.some(item => item.metadata.params.md === 'pulsed'));
  assert.ok(oscillator.some(item => item.metadata.params.fr === 20));
  assert.ok(oscillator.some(item => item.metadata.params.fr === 96000));
  assert.ok(oscillator.some(item => item.metadata.params.vl === -96));
  assert.ok(oscillator.some(item => item.metadata.params.vl === 0));
});

test('Hum and Oscillator freeze input independence and phase continuity', async () => {
  const hum = await readGoldenSet(path.join(pluginsRoot, 'lofi/hum_generator/golden'));
  const humSilent = hum.find(item => item.metadata.id === 'default-standard-silence');
  const humInput = hum.find(item => item.metadata.id === 'generator-input-independence');
  assert.ok(maxGeneratorResidual(humSilent, humInput) <= 6e-8);
  assert.deepEqual(
    hum.find(item => item.metadata.id === 'phase-continuity-odd-blocks').expected,
    hum.find(item => item.metadata.id === 'phase-continuity-one-frame').expected
  );

  const oscillator = await readGoldenSet(path.join(pluginsRoot, 'others/oscillator/golden'));
  const oscillatorSilent = oscillator.find(item => item.metadata.id === 'sine-generator-silence');
  const oscillatorInput = oscillator.find(item => item.metadata.id === 'sine-generator-input-independence');
  assert.ok(maxGeneratorResidual(oscillatorSilent, oscillatorInput) <= 6e-8);
  assert.deepEqual(
    oscillator.find(item => item.metadata.id === 'phase-continuity-odd-blocks').expected,
    oscillator.find(item => item.metadata.id === 'phase-continuity-one-frame').expected
  );
});

test('Wave 3d references freeze phase, delay, filters, and RNG while bypassed', async () => {
  const sampleRate = 44100;
  const channels = 2;
  const prefix = testSignal(47, channels, 3);
  const bypass = testSignal(31, channels, 53);
  const suffix = testSignal(43, channels, 97);

  for (const port of ports) {
    const resumed = await createReferenceSession(port.type, {
      repoRoot,
      params: port.activeParams
    });
    const uninterrupted = await createReferenceSession(port.type, {
      repoRoot,
      params: port.activeParams
    });
    await resumed.process(prefix, { sampleRate, frames: 47, channels, blockSize: 47 });
    await uninterrupted.process(prefix, { sampleRate, frames: 47, channels, blockSize: 47 });
    resumed.plugin.enabled = false;
    assert.deepEqual(
      await resumed.process(bypass, { sampleRate, frames: 31, channels, blockSize: 31 }),
      bypass
    );
    resumed.plugin.enabled = true;
    assert.deepEqual(
      await resumed.process(suffix, { sampleRate, frames: 43, channels, blockSize: 43 }),
      await uninterrupted.process(suffix, { sampleRate, frames: 43, channels, blockSize: 43 }),
      port.type
    );
  }
});

test('Wave 3d kernels preserve seeded and realtime constraints', async () => {
  for (const port of ports) {
    const source = await fs.readFile(path.join(pluginsRoot, port.directory, 'kernel.cpp'), 'utf8');
    const processBody = /\bvoid\s+process\s*\([\s\S]*?\)\s*noexcept\s+override\s*\{[\s\S]*?\n\s*}\s*\n\s*private\s*:/.exec(source)?.[0];
    assert.ok(processBody);
    assert.doesNotMatch(processBody, /std::(?:fabs|abs|max|min)\s*\(/);
    assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
  }

  for (const directory of [
    'lofi/bit_crusher',
    'lofi/noise_blender',
    'lofi/simple_jitter',
    'others/oscillator'
  ]) {
    const source = await fs.readFile(path.join(pluginsRoot, directory, 'kernel.cpp'), 'utf8');
    assert.match(source, /#include "effetune\/dsp\/xorshift_rng\.h"/);
    assert.match(source, /setRandomSeed\(/);
    assert.match(source, /random_\.seed\(selected_seed_low_, selected_seed_high_\)/);
  }

  const bitCrusher = await fs.readFile(
    path.join(pluginsRoot, 'lofi/bit_crusher/kernel.cpp'), 'utf8'
  );
  assert.match(bitCrusher,
    /double\s+mulberry32\s*\(\s*std::uint32_t\s*&\s*state\s*\)\s*noexcept\s*\{/);
  const bitCrusherProcess = /void\s+process\s*\([\s\S]*?\n\s*}\s*\n\s*private\s*:/.exec(bitCrusher)?.[0];
  assert.ok(bitCrusherProcess);
  assert.match(bitCrusherProcess,
    /rebuildAmplitudes\s*\(\s*channel_count\s*,\s*bit_depth\s*,\s*bit_error\s*,\s*seed\s*\)\s*;/);
  const rebuildBody = /\bvoid\s+rebuildAmplitudes\s*\([\s\S]*?\)\s*noexcept\s*\{[\s\S]*?\n\s*}\s*\n\s*double\s+sample_rate_/.exec(bitCrusher)?.[0];
  assert.ok(rebuildBody);
  const amplitudeWrites = rebuildBody.match(
    /bit_amplitudes_\s*\[\s*offset\s*\+\s*bit\s*\]\s*=/g
  ) ?? [];
  assert.equal(amplitudeWrites.length, 1);
  assert.match(
    rebuildBody,
    /const\s+double\s+error\s*=\s*\(\s*mulberry32\s*\(\s*state\s*\)\s*\*\s*2\.0\s*-\s*1\.0\s*\)\s*\*\s*error_scale\s*;\s*bit_amplitudes_\s*\[\s*offset\s*\+\s*bit\s*\]\s*=\s*ideal\s*\*\s*\(\s*1\.0\s*\+\s*error\s*\)\s*;/
  );
});
