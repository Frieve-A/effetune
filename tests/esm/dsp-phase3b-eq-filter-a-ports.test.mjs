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
    directory: 'band_pass_filter',
    type: 'BandPassFilterPlugin',
    hash: 0x8cb24a49,
    fields: [
      ['highPassFrequency', 'hf', 'float'],
      ['lowPassFrequency', 'lf', 'float'],
      ['highPassSlope', 'hs', 'int'],
      ['lowPassSlope', 'ls', 'int']
    ],
    caseCount: 9,
    identityCase: 'both-off-identity',
    jsEngineHash: '285ad3d162ea5f56636051d7cfa541756afe5ccb162f1e9551b2d8185cc40030',
    activeParams: { hf: 180, lf: 12000, hs: -36, ls: -24 }
  },
  {
    directory: 'hi_pass_filter',
    type: 'HiPassFilterPlugin',
    hash: 0x11d28ef7,
    fields: [['frequency', 'fr', 'float'], ['slope', 'sl', 'int']],
    caseCount: 9,
    identityCase: 'off-identity',
    jsEngineHash: '3791bc033d29b93e1d5143cdce4ddfc0d195cc17e6e17091e1811802b8cf47c0',
    activeParams: { fr: 180, sl: -36 }
  },
  {
    directory: 'lo_pass_filter',
    type: 'LoPassFilterPlugin',
    hash: 0x11d28ef7,
    fields: [['frequency', 'fr', 'float'], ['slope', 'sl', 'int']],
    caseCount: 9,
    identityCase: 'off-identity',
    jsEngineHash: '3a75eb5ef72497dd61a7a11f15e96c9c820c08acc02cd66a8439d44494610ea4',
    activeParams: { fr: 12000, sl: -36 }
  },
  {
    directory: 'tilt_eq',
    type: 'TiltEQPlugin',
    hash: 0xb960dcbd,
    fields: [['pivotExponent', 'f0', 'float'], ['slope', 'sl', 'float']],
    caseCount: 8,
    identityCase: 'zero-slope-identity',
    jsEngineHash: '724d9b516ac2e3a882f3e16b7c94dd438eb1acf2dc50017254646beacddc2790',
    activeParams: { f0: 6.5, sl: 8 }
  },
  {
    directory: 'tone_control',
    type: 'ToneControlPlugin',
    hash: 0xf3823430,
    fields: [
      ['bass', 'bs', 'float'],
      ['mid', 'md', 'float'],
      ['treble', 'tr', 'float']
    ],
    caseCount: 10,
    identityCase: 'flat-identity',
    jsEngineHash: '594cab40e39d1332770bdf04b8898ad6f0f0bdb28fb9feab8e915038504ceaad',
    activeParams: { bs: 9, md: -6, tr: 12 }
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

test('Phase 3b EQ group A schemas freeze source parameter order and hashes', async () => {
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

test('Phase 3b EQ group A goldens are source-frozen, bounded, and representative', async () => {
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
    assert.ok(goldens.some(item => item.metadata.events.length > 0));

    for (const golden of goldens) {
      assert.equal(golden.metadata.type, port.type);
      assert.equal(golden.metadata.jsEngineHash, port.jsEngineHash);
      assert.equal(golden.expected.length,
        golden.metadata.frameCount * golden.metadata.channels);
      assert.ok(golden.metadata.frameCount <= 259);
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

test('Linkwitz-Riley goldens retain Float32 startup seeds', async () => {
  for (const port of ports.slice(0, 3)) {
    const goldens = await readGoldenSet(
      path.join(pluginsRoot, port.directory, 'golden')
    );
    const startup = goldens.find(item => item.metadata.id === 'startup-seeds-silence');
    assert.ok(startup);
    assert.ok(startup.expected.some(sample => sample !== 0));
  }
});

test('authoritative EQ references freeze state while disabled', async () => {
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

    resumed.plugin.setParameters({ enabled: false });
    const bypassOutput = await resumed.process(bypass,
      { sampleRate, frames: 31, channels, blockSize: 31 });
    assert.deepEqual(bypassOutput, bypass);
    resumed.plugin.setParameters({ enabled: true });

    const resumedOutput = await resumed.process(suffix,
      { sampleRate, frames: 43, channels, blockSize: 43 });
    const uninterruptedOutput = await uninterrupted.process(suffix,
      { sampleRate, frames: 43, channels, blockSize: 43 });
    assert.deepEqual(resumedOutput, uninterruptedOutput, port.type);
  }
});

test('Phase 3b EQ group A kernels preserve topology and realtime constraints', async () => {
  for (const port of ports) {
    const source = await fs.readFile(
      path.join(pluginsRoot, port.directory, 'kernel.cpp'),
      'utf8'
    );
    assert.match(source, /#include "effetune\/dsp\/biquad\.h"/);
    assert.match(source, /processBiquadDf1Sample/);
    assert.doesNotMatch(source, /std::(?:fabs|max|min)\s*\(/);

    const processStart = source.indexOf('  void process(');
    const processEnd = source.indexOf('\nprivate:', processStart);
    assert.ok(processStart >= 0 && processEnd > processStart);
    const processBody = source.slice(processStart, processEnd);
    assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
  }

  for (const directory of ['band_pass_filter', 'hi_pass_filter', 'lo_pass_filter', 'tilt_eq']) {
    const source = await fs.readFile(path.join(pluginsRoot, directory, 'kernel.cpp'), 'utf8');
    assert.match(source, /quantizeBiquadStateToFloat/);
  }
  const toneSource = await fs.readFile(
    path.join(pluginsRoot, 'tone_control', 'kernel.cpp'),
    'utf8'
  );
  assert.doesNotMatch(toneSource, /quantizeBiquadStateToFloat/);
});
