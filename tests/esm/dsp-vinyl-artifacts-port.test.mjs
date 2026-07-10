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
const pluginDirectory = path.join(repoRoot, 'dsp', 'plugins', 'lofi', 'vinyl_artifacts');

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

test('Vinyl Artifacts schema and host packer freeze parameter order', async () => {
  const schemaPath = path.join(pluginDirectory, 'params.json');
  const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const schema = validateParamSpec(raw, schemaPath);
  assert.equal(schema.type, 'VinylArtifactsPlugin');
  assert.equal(schema.hash, 0x44439ea9);
  assert.equal(schema.floatCount, 12);
  assert.deepEqual(
    raw.fields.map(({ name, key, kind }) => [name, key, kind]),
    [
      ['popsPerMinute', 'pp', 'int'],
      ['popLevel', 'pl', 'float'],
      ['cracklesPerMinute', 'cm', 'int'],
      ['crackleLevel', 'cl', 'float'],
      ['hissLevel', 'hs', 'float'],
      ['rumbleLevel', 'rb', 'float'],
      ['crosstalk', 'xt', 'int'],
      ['noiseProfile', 'tn', 'float'],
      ['wear', 'wr', 'int'],
      ['react', 'rt', 'int'],
      ['reactMode', 'rm', 'enum'],
      ['mix', 'mx', 'int']
    ]
  );
  assert.deepEqual(raw.fields[10].values, ['Velocity', 'Amplitude']);

  const descriptor = DSP_PARAM_PACKERS.get('VinylArtifactsPlugin');
  assert.ok(descriptor);
  assert.equal(descriptor.hash, schema.hash);
  assert.equal(descriptor.floatCount, 12);
  assert.deepEqual(
    [...descriptor.pack({})],
    [20, -24, 500, -33, -42, -50, 60, 0, 100, 25, 0, 100]
  );
  assert.deepEqual(
    [...descriptor.pack({
      pp: 120, pl: 0, cm: 2000, cl: 0, hs: 0, rb: 0,
      xt: 100, tn: 10, wr: 200, rt: 100, rm: 'Amplitude', mx: 0
    })],
    [120, 0, 2000, 0, 0, 0, 100, 10, 200, 100, 1, 0]
  );
});

test('Vinyl Artifacts goldens preserve seeded noise across parameter transitions', async () => {
  const goldenDirectory = path.join(pluginDirectory, 'golden');
  assert.ok(await directoryBytes(goldenDirectory) <= DEFAULT_GOLDEN_BUDGET_BYTES);
  const goldens = await readGoldenSet(goldenDirectory);
  assert.equal(goldens.length, 9);
  assert.deepEqual(
    new Set(goldens.map(item => item.metadata.id)),
    new Set([
      'default-seeded-noise',
      'maximum-artifacts-mono',
      'all4-state-but-stereo-output',
      'rng-branch-transitions',
      'shelf-bypass-transitions',
      'velocity-react-one-frame-blocks',
      'amplitude-react-96k',
      'all4-192k-coefficients',
      'mix-zero-freezes-state'
    ])
  );
  for (const golden of goldens) {
    assert.equal(golden.metadata.type, 'VinylArtifactsPlugin');
    assert.equal(
      golden.metadata.jsEngineHash,
      'eab9d086b22155e71cbfa50044eab3794689d202244558388eb7cafd99c61478'
    );
    assert.ok(golden.expected.every(Number.isFinite));
  }
  assert.ok(goldens.some(item => item.metadata.sampleRate === 44100));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 96000));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 192000));
  assert.ok(goldens.some(item => item.metadata.channels === 1));
  assert.ok(goldens.some(item => item.metadata.channels === 4));
  assert.ok(goldens.some(item => item.metadata.blockSize === 1));
  assert.ok(goldens.some(item => item.metadata.events.length >= 4));
});

test('Vinyl Artifacts reference freezes state at zero mix and writes only stereo', async () => {
  const params = {
    pp: 120, pl: 0, cm: 2000, cl: 0, hs: 0, rb: 0,
    xt: 100, tn: 3.5, wr: 200, rt: 100, rm: 'Velocity', mx: 100
  };
  const paused = await createReferenceSession('VinylArtifactsPlugin', {
    repoRoot,
    params,
    seed: 0x123456789abcdef0n
  });
  const uninterrupted = await createReferenceSession('VinylArtifactsPlugin', {
    repoRoot,
    params,
    seed: 0x123456789abcdef0n
  });
  const prefix = testSignal(127, 2, 3);
  await paused.process(prefix, { sampleRate: 48000, frames: 127, channels: 2, blockSize: 127 });
  await uninterrupted.process(prefix, {
    sampleRate: 48000,
    frames: 127,
    channels: 2,
    blockSize: 127
  });

  const bypass = testSignal(61, 4, 137);
  paused.plugin.mx = 0;
  assert.deepEqual(
    await paused.process(bypass, { sampleRate: 48000, frames: 61, channels: 4, blockSize: 61 }),
    bypass
  );
  paused.plugin.mx = 100;

  const suffix = testSignal(113, 2, 257);
  assert.deepEqual(
    await paused.process(suffix, { sampleRate: 48000, frames: 113, channels: 2, blockSize: 113 }),
    await uninterrupted.process(suffix, {
      sampleRate: 48000,
      frames: 113,
      channels: 2,
      blockSize: 113
    })
  );

  const allChannels = await createReferenceSession('VinylArtifactsPlugin', {
    repoRoot,
    params,
    seed: 0x0fedcba987654321n
  });
  const allInput = testSignal(97, 4, 11);
  const allOutput = await allChannels.process(allInput, {
    sampleRate: 48000,
    frames: 97,
    channels: 4,
    blockSize: 97
  });
  assert.notDeepEqual(allOutput.subarray(0, 97 * 2), allInput.subarray(0, 97 * 2));
  assert.deepEqual(allOutput.subarray(97 * 2), allInput.subarray(97 * 2));
});

test('Vinyl Artifacts kernel keeps random state allocation out of process', async () => {
  const source = await fs.readFile(path.join(pluginDirectory, 'kernel.cpp'), 'utf8');
  const processBody = /\bvoid\s+process\s*\([\s\S]*?\)\s*noexcept\s+override\s*\{[\s\S]*?\n\s*}\s*\n\s*private\s*:/.exec(source)?.[0];
  assert.ok(processBody);
  assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
  assert.doesNotMatch(processBody, /std::(?:fabs|abs|max|min)\s*\(/);
  assert.match(source, /pink_states_\.resize\(max_channels_\)/);
  assert.match(source, /std::vector<float> wet_samples_/);
  assert.match(source, /#include "effetune\/dsp\/xorshift_rng\.h"/);
  assert.match(source, /setRandomSeed\(/);
  assert.match(source, /random_\.seed\(selected_seed_low_, selected_seed_high_\)/);
  assert.match(
    processBody,
    /const\s+bool\s+pop_trigger\s*=\s*random_\.nextFloat01\(\)\s*<\s*reactive_pop_probability\s*;\s*const\s+bool\s+crackle_trigger\s*=\s*random_\.nextFloat01\(\)\s*<\s*reactive_crackle_probability\s*;\s*for\s*\(\s*std::uint32_t\s+channel\s*=\s*0u\s*;\s*channel\s*<\s*channel_count\s*;\s*\+\+channel\s*\)/
  );
  assert.match(
    processBody,
    /PopState\s*&\s*pop\s*=\s*pop_states_\s*\[\s*channel\s*\]\s*;\s*double\s+pop_input\s*=\s*0\.0\s*;\s*if\s*\(\s*pop_trigger\s*\)\s*\{/
  );
  assert.match(
    processBody,
    /CrackleState\s*&\s*crackle\s*=\s*crackle_states_\s*\[\s*channel\s*\]\s*;\s*crackle\.level\s*\*=\s*0\.992\s*;\s*if\s*\(\s*crackle_trigger\s*\)\s*\{/
  );
  assert.equal((processBody.match(
    /random_\.nextFloat01\(\)\s*<\s*reactive_pop_probability/g
  ) ?? []).length, 1);
  assert.equal((processBody.match(
    /random_\.nextFloat01\(\)\s*<\s*reactive_crackle_probability/g
  ) ?? []).length, 1);

  const registry = await fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8');
  assert.match(registry, /EFFETUNE_PLUGIN\(VinylArtifactsPlugin, lofi\/vinyl_artifacts\)/);
});
