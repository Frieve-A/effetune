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
const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins');

const ports = [
  {
    directory: 'delay/delay',
    type: 'DelayPlugin',
    hash: 0x5fc91248,
    fields: [
      ['preDelay', 'pd', 'float'],
      ['delaySize', 'ds', 'float'],
      ['damping', 'dp', 'float'],
      ['highDamp', 'hd', 'float'],
      ['lowDamp', 'ld', 'float'],
      ['mix', 'mx', 'float'],
      ['feedback', 'fb', 'float'],
      ['pingPong', 'pp', 'float']
    ],
    caseCount: 10,
    identityCase: 'dry-only-warms-lines',
    jsEngineHash: '826b2372817ea49223d2af27b54ec6cfdec248c81b5d30d5923aa37bde4f2fa5',
    activeParams: { pd: 0, ds: 1, dp: 75, hd: 8000, ld: 120, mx: 65, fb: 80, pp: 100 }
  },
  {
    directory: 'delay/time_alignment',
    type: 'TimeAlignmentPlugin',
    hash: 0x27e3fb56,
    fields: [['delay', 'dl', 'float']],
    caseCount: 7,
    identityCase: 'zero-delay-identity',
    jsEngineHash: '6a03a46f3d7378bb3fa7964fe884151ee709f0cc27a5eed02ccd5e05385b1481',
    activeParams: { dl: 1 }
  },
  {
    directory: 'modulation/tremolo',
    type: 'TremoloPlugin',
    hash: 0x6d7713b8,
    fields: [
      ['rate', 'rt', 'float'],
      ['depth', 'dp', 'float'],
      ['randomness', 'rn', 'float'],
      ['randomnessCutoff', 'rc', 'float'],
      ['randomnessSlope', 'rs', 'float'],
      ['channelPhase', 'cp', 'float'],
      ['channelSync', 'cs', 'float']
    ],
    caseCount: 8,
    identityCase: 'zero-depth-random-state',
    jsEngineHash: '6d873adff940f4488d104dff7e63d2058aa35ec9fe55c28d98412e0b2381a9e5',
    activeParams: { rt: 13, dp: 8, rn: 24, rc: 300, rs: -4, cp: 90, cs: 40 }
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

test('Wave 3c schemas freeze source parameter order and hashes', async () => {
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
    assert.ok(raw.tolerance.abs > 0);
  }
});

test('Wave 3c goldens are source-frozen, bounded, and representative', async () => {
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

test('delay goldens preserve exact extrema and stereo feedback modes', async () => {
  const delayGoldens = await readGoldenSet(
    path.join(pluginsRoot, 'delay/delay/golden')
  );
  const maximum = delayGoldens.find(item => item.metadata.id === 'maximum-delay-config');
  assert.equal(maximum.metadata.params.pd, 100);
  assert.equal(maximum.metadata.params.ds, 5000);
  assert.equal(maximum.metadata.params.fb, 99);
  for (const id of ['stereo-independent', 'stereo-mono-feedback', 'stereo-cross-feedback']) {
    assert.ok(delayGoldens.some(item => item.metadata.id === id));
  }

  const alignmentGoldens = await readGoldenSet(
    path.join(pluginsRoot, 'delay/time_alignment/golden')
  );
  const longest = alignmentGoldens.find(item => item.metadata.id === 'maximum-delay');
  assert.equal(longest.expected[0], 0);
  assert.equal(longest.expected[19200], 1);
});

test('Tremolo distinguishes deterministic sine from stochastic stereo modulation', async () => {
  const goldens = await readGoldenSet(
    path.join(pluginsRoot, 'modulation/tremolo/golden')
  );
  assert.ok(goldens.some(item => item.metadata.params.rt === 0.1));
  assert.ok(goldens.some(item => item.metadata.params.rt === 50));
  assert.ok(goldens.some(item => item.metadata.params.dp === 12));
  assert.ok(goldens.some(item => item.metadata.params.rn === 0));
  assert.ok(goldens.some(item => item.metadata.params.rn === 96));
  assert.ok(goldens.some(item => item.metadata.params.cp === -180));
  assert.ok(goldens.some(item => item.metadata.params.cp === 180));
  assert.ok(goldens.some(item => item.metadata.params.cs === 0));
  assert.ok(goldens.some(item => item.metadata.params.cs === 100));

  const phased = goldens.find(item => item.metadata.id === 'pure-sine-maximum-rate');
  const frames = phased.metadata.frameCount;
  assert.notDeepEqual(
    phased.expected.slice(0, frames),
    phased.expected.slice(frames, 2 * frames)
  );
});

test('Wave 3c references freeze delay, phase, filters, and RNG while disabled', async () => {
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

test('Wave 3c kernels preserve shared primitives and realtime constraints', async () => {
  for (const port of ports) {
    const source = await fs.readFile(
      path.join(pluginsRoot, port.directory, 'kernel.cpp'),
      'utf8'
    );
    assert.doesNotMatch(source, /std::(?:fabs|abs|max|min)\s*\(/);
    const processStart = source.indexOf('  void process(');
    const processEnd = source.indexOf('\nprivate:', processStart);
    assert.ok(processStart >= 0 && processEnd > processStart);
    const processBody = source.slice(processStart, processEnd);
    assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
  }

  for (const directory of ['delay/delay', 'delay/time_alignment']) {
    const source = await fs.readFile(path.join(pluginsRoot, directory, 'kernel.cpp'), 'utf8');
    assert.match(source, /#include "effetune\/dsp\/delay_line\.h"/);
    assert.match(source, /delay_samples - 1u/);
  }

  const tremolo = await fs.readFile(
    path.join(pluginsRoot, 'modulation/tremolo/kernel.cpp'),
    'utf8'
  );
  assert.match(tremolo, /#include "effetune\/dsp\/xorshift_rng\.h"/);
  assert.match(tremolo, /setRandomSeed\(/);
  assert.match(tremolo, /random_\.seed\(selected_seed_low_, selected_seed_high_\)/);
  assert.match(tremolo, /processBiquadTdf2Sample/);
});
