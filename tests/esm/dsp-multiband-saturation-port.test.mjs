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
  repoRoot, 'dsp', 'plugins', 'saturation', 'multiband_saturation'
);
const defaultBands = [
  { dr: 1.5, bs: 0.1, mx: 100, gn: 0 },
  { dr: 1.5, bs: 0.1, mx: 100, gn: 0 },
  { dr: 1.5, bs: 0.1, mx: 100, gn: 0 }
];

function testSignal(frames, channels, phase) {
  const signal = new Float32Array(frames * channels);
  for (let channel = 0; channel < channels; ++channel) {
    const offset = channel * frames;
    for (let frame = 0; frame < frames; ++frame) {
      signal[offset + frame] = Math.fround(
        0.57 * Math.sin((frame + phase + channel * 7) * 0.173) +
        0.21 * Math.cos((frame + phase * 3 + channel) * 0.071)
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

test('Multiband Saturation schema and packer freeze structured band order', async () => {
  const schemaPath = path.join(pluginDirectory, 'params.json');
  const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const schema = validateParamSpec(raw, schemaPath);
  assert.equal(schema.type, 'MultibandSaturationPlugin');
  assert.equal(schema.hash, 0x29a70026);
  assert.equal(schema.floatCount, 14);
  assert.deepEqual(
    raw.fields.map(({ name, key, kind, objectArrayKey, memberKey, count }) =>
      [name, key, kind, objectArrayKey ?? null, memberKey ?? null, count ?? 1]),
    [
      ['frequency1', 'f1', 'float', null, null, 1],
      ['frequency2', 'f2', 'float', null, null, 1],
      ['drive', 'dr', 'float', 'bands', 'dr', 3],
      ['bias', 'bs', 'float', 'bands', 'bs', 3],
      ['mix', 'mx', 'float', 'bands', 'mx', 3],
      ['gain', 'gn', 'float', 'bands', 'gn', 3]
    ]
  );

  const descriptor = DSP_PARAM_PACKERS.get('MultibandSaturationPlugin');
  assert.ok(descriptor);
  assert.equal(descriptor.hash, schema.hash);
  assert.equal(descriptor.floatCount, 14);
  assert.deepEqual(
    [...descriptor.pack({})],
    [
      200, 4000,
      1.5, 1.5, 1.5,
      Math.fround(0.1), Math.fround(0.1), Math.fround(0.1),
      100, 100, 100,
      0, 0, 0
    ]
  );
  assert.deepEqual(
    [...descriptor.pack({
      f1: 20,
      f2: 20000,
      bands: [
        { dr: 10, bs: -0.3, mx: 0, gn: -18 },
        { dr: 0, bs: 0, mx: 50, gn: 0 },
        { dr: 5, bs: 0.3, mx: 100, gn: 18 }
      ]
    })],
    [
      20, 20000,
      10, 0, 5,
      Math.fround(-0.3), 0, Math.fround(0.3),
      0, 50, 100,
      -18, 0, 18
    ]
  );
});

test('Multiband Saturation goldens preserve crossover fades and band transitions', async () => {
  const goldenDirectory = path.join(pluginDirectory, 'golden');
  assert.ok(await directoryBytes(goldenDirectory) <= DEFAULT_GOLDEN_BUDGET_BYTES);
  const goldens = await readGoldenSet(goldenDirectory);
  assert.equal(goldens.length, 11);
  assert.deepEqual(
    new Set(goldens.map(item => item.metadata.id)),
    new Set([
      'default-impulse-fade',
      'linear-dry-bands',
      'maximum-asymmetric-saturation',
      'fractional-band-controls',
      'mono-zero-drive-wet',
      'all4-192k-crossover-extremes',
      '32k-nyquist-minus-one-clamp',
      'crossover-events-reset-and-fade',
      'band-events-preserve-filter-state',
      'one-frame-blocks-96k',
      'fade-longer-than-5ms'
    ])
  );
  for (const golden of goldens) {
    assert.equal(golden.metadata.type, 'MultibandSaturationPlugin');
    assert.equal(
      golden.metadata.jsEngineHash,
      'aff52f56e47b4e6567c03c268276b970ca9b506718ae3d936815341f41788bec'
    );
    assert.ok(golden.expected.every(Number.isFinite));
  }
  assert.ok(goldens.some(item => item.metadata.sampleRate === 44100));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 32000));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 96000));
  assert.ok(goldens.some(item => item.metadata.sampleRate === 192000));
  assert.ok(goldens.some(item => item.metadata.channels === 1));
  assert.ok(goldens.some(item => item.metadata.channels === 4));
  assert.ok(goldens.some(item => item.metadata.blockSize === 1));
  assert.ok(goldens.some(item => item.metadata.blockSize > 220));
  assert.ok(goldens.some(item => item.metadata.events.length > 0));
});

test('Multiband Saturation reference freezes disabled state and resets only LR shape', async () => {
  const defaults = { f1: 200, f2: 4000, bands: defaultBands };
  const paused = await createReferenceSession('MultibandSaturationPlugin', {
    repoRoot,
    params: defaults
  });
  const uninterrupted = await createReferenceSession('MultibandSaturationPlugin', {
    repoRoot,
    params: defaults
  });
  const prefix = testSignal(257, 2, 3);
  await paused.process(prefix, {
    sampleRate: 48000, frames: 257, channels: 2, blockSize: 127
  });
  await uninterrupted.process(prefix, {
    sampleRate: 48000, frames: 257, channels: 2, blockSize: 127
  });
  paused.plugin.enabled = false;
  const bypass = testSignal(193, 4, 307);
  assert.deepEqual(
    await paused.process(bypass, {
      sampleRate: 48000, frames: 193, channels: 4, blockSize: 61
    }),
    bypass
  );
  paused.plugin.enabled = true;
  const suffix = testSignal(211, 2, 509);
  assert.deepEqual(
    await paused.process(suffix, {
      sampleRate: 48000, frames: 211, channels: 2, blockSize: 113
    }),
    await uninterrupted.process(suffix, {
      sampleRate: 48000, frames: 211, channels: 2, blockSize: 113
    })
  );

  const bandChanged = await createReferenceSession('MultibandSaturationPlugin', {
    repoRoot,
    params: defaults
  });
  const bandControl = await createReferenceSession('MultibandSaturationPlugin', {
    repoRoot,
    params: defaults
  });
  await bandChanged.process(prefix, {
    sampleRate: 48000, frames: 257, channels: 2, blockSize: 127
  });
  await bandControl.process(prefix, {
    sampleRate: 48000, frames: 257, channels: 2, blockSize: 127
  });
  bandChanged.plugin.setParameters({ bands: [
    { dr: 10, bs: -0.3, mx: 100, gn: 18 },
    { dr: 0, bs: 0, mx: 0, gn: 0 },
    { dr: 6.5, bs: 0.25, mx: 37.5, gn: 6 }
  ] });
  const transition = testSignal(127, 2, 809);
  assert.notDeepEqual(
    await bandChanged.process(transition, {
      sampleRate: 48000, frames: 127, channels: 2, blockSize: 127
    }),
    await bandControl.process(transition, {
      sampleRate: 48000, frames: 127, channels: 2, blockSize: 127
    })
  );
  bandChanged.plugin.setParameters({ bands: defaultBands });
  const bandSuffix = testSignal(173, 2, 1009);
  assert.deepEqual(
    await bandChanged.process(bandSuffix, {
      sampleRate: 48000, frames: 173, channels: 2, blockSize: 97
    }),
    await bandControl.process(bandSuffix, {
      sampleRate: 48000, frames: 173, channels: 2, blockSize: 97
    })
  );

  const evolved = await createReferenceSession('MultibandSaturationPlugin', {
    repoRoot,
    params: defaults
  });
  await evolved.process(prefix, {
    sampleRate: 48000, frames: 257, channels: 2, blockSize: 127
  });
  evolved.plugin.setParameters({ f1: 1600, f2: 18000 });
  const fresh = await createReferenceSession('MultibandSaturationPlugin', {
    repoRoot,
    params: { f1: 1600, f2: 18000, bands: defaultBands }
  });
  const shapeInput = testSignal(257, 4, 1301);
  assert.deepEqual(
    await evolved.process(shapeInput, {
      sampleRate: 48000, frames: 257, channels: 4, blockSize: 127
    }),
    await fresh.process(shapeInput, {
      sampleRate: 48000, frames: 257, channels: 4, blockSize: 127
    })
  );
});

test('Multiband Saturation kernel preserves LR state precision without allocation', async () => {
  const source = await fs.readFile(path.join(pluginDirectory, 'kernel.cpp'), 'utf8');
  const processStart = source.indexOf('  void process(');
  const processEnd = source.indexOf('\nprivate:', processStart);
  assert.ok(processStart >= 0 && processEnd > processStart);
  const processBody = source.slice(processStart, processEnd);
  assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
  assert.doesNotMatch(processBody, /std::(?:fabs|abs|max|min)\s*\(/);
  assert.match(source, /#include "effetune\/dsp\/linkwitz_riley\.h"/);
  assert.match(source, /LinkwitzRileyStateStorage::Float64/);
  assert.match(source, /sample_rate \* 0\.5 - 1\.0/);
  assert.match(source, /designLegacyCrossover/);
  assert.doesNotMatch(source, /quantizeLinkwitzRiley24StateToFloat/);
  assert.match(source, /std::vector<float> band_signals_/);
  assert.match(source, /std::vector<float> temporary_/);
  assert.match(source, /static_cast<std::uint32_t>\(sample_rate_ \* 0\.005\)/);

  const registry = await fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8');
  assert.match(
    registry,
    /EFFETUNE_PLUGIN\(MultibandSaturationPlugin, saturation\/multiband_saturation\)/
  );
});
