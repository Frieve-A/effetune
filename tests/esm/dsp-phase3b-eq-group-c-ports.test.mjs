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
import { runParityCli } from '../../tools/dsp-parity/run.mjs';
import { generateStimulus } from '../../tools/dsp-parity/stimuli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins', 'eq');

const ports = [
  {
    directory: 'narrow_range',
    type: 'NarrowRangePlugin',
    hash: 0x3726bda7,
    fields: [
      ['highPassFrequency', 'hf', 'float'],
      ['highPassSlope', 'hs', 'int'],
      ['lowPassFrequency', 'lf', 'float'],
      ['lowPassSlope', 'ls', 'int']
    ],
    caseCount: 13,
    identityCase: 'slopes-off-identity',
    jsEngineHash: 'e523682522343e17ac48c76df33b816d238ebaef418bbb890d473ab5cab2f607',
    activeParams: { hf: 180, hs: -42, lf: 12000, ls: -30 }
  },
  {
    directory: 'loudness_equalizer',
    type: 'LoudnessEqualizerPlugin',
    hash: 0x88692f5f,
    fields: [
      ['averageSpl', 'sp', 'float'],
      ['lowGain', 'lg', 'float'],
      ['lowFrequency', 'lf', 'int'],
      ['lowQ', 'lq', 'float'],
      ['highQ', 'hq', 'float'],
      ['highGain', 'hg', 'float'],
      ['highFrequency', 'hf', 'int']
    ],
    caseCount: 8,
    identityCase: 'reference-level-identity',
    jsEngineHash: '0dbeab6da3dab6769e86bdfd61cdff403972a6f2924a3956b24b5993711e73a6',
    activeParams: { sp: 60, lg: 12, lf: 220, lq: 0.7, hq: 0.8, hg: 9, hf: 5000 }
  },
  {
    directory: 'comb_filter',
    type: 'CombFilterPlugin',
    hash: 0xa04d8883,
    fields: [
      ['fundamentalFrequency', 'ff', 'float'],
      ['feedbackGain', 'fg', 'float'],
      ['dryWetMix', 'dw', 'float'],
      ['combType', 'ct', 'enum']
    ],
    caseCount: 8,
    identityCase: 'dry-output-warms-state',
    jsEngineHash: 'f19a06b9c3ead14c1d4ba43dc83d3e1af2942f1dab551bae0ef38962a21934bb',
    activeParams: { ff: 4000, fg: 0.8, dw: 100, ct: 'fb' }
  }
];

async function goldenBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

function stimulusFor(metadata) {
  return generateStimulus({
    id: metadata.stimulus,
    sampleRate: metadata.sampleRate,
    frames: metadata.frameCount,
    channels: metadata.channels,
    caseIndex: metadata.caseIndex,
    seed: BigInt(metadata.seed)
  });
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

test('Phase 3b EQ group C schemas freeze source parameter order and hashes', async () => {
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

  const comb = JSON.parse(await fs.readFile(
    path.join(pluginsRoot, 'comb_filter', 'params.json'),
    'utf8'
  ));
  assert.deepEqual(comb.fields[3].values, ['fb', 'ff']);
  assert.equal(comb.fields[3].default, 'ff');
});

test('Phase 3b EQ group C goldens are source-frozen, bounded, and representative', async () => {
  for (const port of ports) {
    const goldenDir = path.join(pluginsRoot, port.directory, 'golden');
    assert.ok(await goldenBytes(goldenDir) <= DEFAULT_GOLDEN_BUDGET_BYTES);
    const goldens = await readGoldenSet(goldenDir);
    assert.equal(goldens.length, port.caseCount);
    assert.deepEqual(
      new Set(goldens.map(item => item.metadata.sampleRate)),
      new Set([44100, 48000, 96000, 192000])
    );
    assert.ok(goldens.some(item => item.metadata.channels === 1));
    assert.ok(goldens.some(item => item.metadata.channels === 4));
    assert.ok(goldens.some(item => item.metadata.blockSize % 2 === 1));
    assert.ok(goldens.some(item => item.metadata.blockSize === 1));
    assert.ok(goldens.some(item => item.metadata.events.length > 0));

    for (const golden of goldens) {
      assert.equal(golden.metadata.type, port.type);
      assert.equal(golden.metadata.jsEngineHash, port.jsEngineHash);
      assert.equal(golden.expected.length,
        golden.metadata.frameCount * golden.metadata.channels);
      assert.ok(golden.expected.every(Number.isFinite));
    }

    const identity = goldens.find(item => item.metadata.id === port.identityCase);
    assert.ok(identity, `missing ${port.identityCase}`);
    assert.deepEqual(identity.expected, stimulusFor(identity.metadata));

    const result = await runParityCli([
      '--root', repoRoot,
      '--type', port.type,
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, port.caseCount);
    assert.equal(result.results.every(item => item.comparison.pass), true);
  }
});

test('Narrow Range initializes Float32 state for each configured slope', async () => {
  const goldens = await readGoldenSet(
    path.join(pluginsRoot, 'narrow_range', 'golden')
  );
  const expectedSlopes = new Set([0, -6, -12, -18, -24, -30, -36, -42, -48]);
  assert.deepEqual(new Set(goldens.map(item => item.metadata.params.hs)), expectedSlopes);
  assert.deepEqual(new Set(goldens.map(item => item.metadata.params.ls)), expectedSlopes);
  const startup = goldens.find(item => item.metadata.id === 'startup-seeds-silence');
  assert.ok(startup.expected.some(sample => sample !== 0));
});

test('Comb Filter mode selection preserves the rounded maximum delay', async () => {
  const goldens = await readGoldenSet(
    path.join(pluginsRoot, 'comb_filter', 'golden')
  );
  assert.deepEqual(
    new Set(goldens.map(item => item.metadata.params.ct)),
    new Set(['fb', 'ff'])
  );
  const longest = goldens.find(item => item.metadata.id === 'feedback-longest-delay');
  assert.equal(longest.metadata.sampleRate, 192000);
  assert.equal(longest.metadata.params.ff, 20);
  assert.equal(longest.expected[0], 1);
  assert.equal(longest.expected[9600], 1);
});

test('authoritative EQ group C references freeze state while disabled', async () => {
  const sampleRate = 96000;
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
    await uninterrupted.process(prefix,
      { sampleRate, frames: 47, channels, blockSize: 47 });

    resumed.plugin.enabled = false;
    const bypassOutput = await resumed.process(bypass,
      { sampleRate, frames: 31, channels, blockSize: 31 });
    assert.deepEqual(bypassOutput, bypass);
    resumed.plugin.enabled = true;

    const resumedOutput = await resumed.process(suffix,
      { sampleRate, frames: 43, channels, blockSize: 43 });
    const uninterruptedOutput = await uninterrupted.process(suffix,
      { sampleRate, frames: 43, channels, blockSize: 43 });
    assert.deepEqual(resumedOutput, uninterruptedOutput, port.type);
  }
});

test('Phase 3b EQ group C kernels preserve topology and realtime constraints', async () => {
  for (const port of ports) {
    const source = await fs.readFile(
      path.join(pluginsRoot, port.directory, 'kernel.cpp'),
      'utf8'
    );
    assert.doesNotMatch(source, /std::(?:fabs|max|min)\s*\(/);
    const processStart = source.indexOf('  void process(');
    const processEnd = source.indexOf('\nprivate:', processStart);
    assert.ok(processStart >= 0 && processEnd > processStart);
    const processBody = source.slice(processStart, processEnd);
    assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
  }

  const narrow = await fs.readFile(
    path.join(pluginsRoot, 'narrow_range', 'kernel.cpp'),
    'utf8'
  );
  assert.match(narrow, /#include "effetune\/dsp\/biquad\.h"/);
  assert.match(narrow, /quantizeBiquadStateToFloat/);

  const loudness = await fs.readFile(
    path.join(pluginsRoot, 'loudness_equalizer', 'kernel.cpp'),
    'utf8'
  );
  assert.match(loudness, /#include "effetune\/dsp\/biquad\.h"/);
  assert.doesNotMatch(loudness, /quantizeBiquadStateToFloat/);

  const comb = await fs.readFile(
    path.join(pluginsRoot, 'comb_filter', 'kernel.cpp'),
    'utf8'
  );
  assert.match(comb, /std::vector<float> delay_buffer_/);
  assert.match(comb, /static_cast<float>\(wet\)/);
});
