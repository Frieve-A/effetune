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
import { runParityCli } from '../../tools/dsp-parity/run.mjs';
import { generateStimulus } from '../../tools/dsp-parity/stimuli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginsRoot = path.join(repoRoot, 'dsp', 'plugins');

const ports = [
  {
    directory: 'spatial/ms_matrix',
    type: 'MSMatrixPlugin',
    hash: 0x243848fc,
    floatCount: 4,
    caseCount: 10,
    jsEngineHash: 'ea13e207837045ba6ec2944e0f8436084a8c6629351def3bdbabb5d72f048e26'
  },
  {
    directory: 'spatial/stereo_blend',
    type: 'StereoBlendPlugin',
    hash: 0x26a82e4d,
    floatCount: 1,
    caseCount: 10,
    jsEngineHash: 'e46aa5dc32dd3605bf560c5296e7d35001a71df1b648a7ba0eaaf19870d00007'
  },
  {
    directory: 'saturation/hard_clipping',
    type: 'HardClippingPlugin',
    hash: 0x31e6082d,
    floatCount: 2,
    caseCount: 11,
    jsEngineHash: 'aaec46b70a3abefd1621bddba57d4e5af910b4cc7934bb186784247844e7752a'
  },
  {
    directory: 'saturation/saturation',
    type: 'SaturationPlugin',
    hash: 0x42759ad3,
    floatCount: 4,
    caseCount: 12,
    jsEngineHash: 'a9127eabc85de27bb7f876e66ef33c7ccc5614d3de0588f546d84a94cfb0c966'
  }
];

async function goldenBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) {
      bytes += (await fs.stat(path.join(directory, entry.name))).size;
    }
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

function namedCase(goldens, id) {
  const golden = goldens.find(item => item.metadata.id === id);
  assert.ok(golden, `missing golden case ${id}`);
  return golden;
}

test('Phase 3a Tier-1 spatial and saturation schemas freeze legacy layouts', async () => {
  for (const port of ports) {
    const schemaPath = path.join(pluginsRoot, port.directory, 'params.json');
    const raw = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
    const schema = validateParamSpec(raw, schemaPath);
    assert.equal(schema.type, port.type);
    assert.equal(schema.hash, port.hash);
    assert.equal(schema.floatCount, port.floatCount);
  }

  const ms = JSON.parse(await fs.readFile(
    path.join(pluginsRoot, 'spatial/ms_matrix/params.json'),
    'utf8'
  ));
  assert.deepEqual(
    ms.fields.map(({ name, key, kind }) => ({ name, key, kind })),
    [
      { name: 'mode', key: 'md', kind: 'int' },
      { name: 'midGain', key: 'mg', kind: 'float' },
      { name: 'sideGain', key: 'sg', kind: 'float' },
      { name: 'swap', key: 'sw', kind: 'int' }
    ]
  );

  const hardClipping = JSON.parse(await fs.readFile(
    path.join(pluginsRoot, 'saturation/hard_clipping/params.json'),
    'utf8'
  ));
  assert.deepEqual(hardClipping.fields[1].values, ['both', 'positive', 'negative']);
});

test('Phase 3a Tier-1 spatial and saturation goldens are fresh and bounded', async () => {
  for (const port of ports) {
    const goldenDir = path.join(pluginsRoot, port.directory, 'golden');
    assert.ok(
      await goldenBytes(goldenDir) <= DEFAULT_GOLDEN_BUDGET_BYTES,
      `${port.type} exceeds the 2 MiB golden budget`
    );

    const goldens = await readGoldenSet(goldenDir);
    assert.equal(goldens.length, port.caseCount);
    for (const golden of goldens) {
      const { metadata, expected } = golden;
      assert.equal(metadata.type, port.type);
      assert.equal(metadata.jsEngineHash, port.jsEngineHash);
      assert.equal(expected.length, metadata.frameCount * metadata.channels);
      assert.ok(metadata.frameCount <= 259);
    }

    assert.ok(goldens.some(item => item.metadata.channels === 1));
    assert.ok(goldens.some(item => item.metadata.frameCount < item.metadata.blockSize));
    assert.ok(goldens.some(item => item.metadata.stimulus === 'fs'));
    assert.ok(goldens.some(item => item.metadata.events.length > 0));

    const result = await runParityCli([
      '--root', repoRoot,
      '--type', port.type,
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, port.caseCount);
    assert.equal(result.results.every(item => item.comparison.pass), true);
  }
});

test('MS Matrix and Stereo Blend goldens preserve their channel contracts', async () => {
  const msGoldens = await readGoldenSet(
    path.join(pluginsRoot, 'spatial/ms_matrix/golden')
  );
  for (const id of ['mono-bypass', 'all-channels-bypass']) {
    const bypass = namedCase(msGoldens, id);
    assert.deepEqual(bypass.expected, stimulusFor(bypass.metadata));
  }

  const encode = namedCase(msGoldens, 'default-encode-noise');
  const encodeInput = stimulusFor(encode.metadata);
  const frames = encode.metadata.frameCount;
  for (let frame = 0; frame < frames; ++frame) {
    const left = encodeInput[frame];
    const right = encodeInput[frames + frame];
    assert.equal(encode.expected[frame], Math.fround((left + right) * 0.5));
    assert.equal(encode.expected[frames + frame], Math.fround((left - right) * 0.5));
  }

  const blendGoldens = await readGoldenSet(
    path.join(pluginsRoot, 'spatial/stereo_blend/golden')
  );
  const mono = namedCase(blendGoldens, 'mono-bypass');
  assert.deepEqual(mono.expected, stimulusFor(mono.metadata));

  const allChannels = namedCase(blendGoldens, 'all-channels-first-pair-only');
  const allChannelsInput = stimulusFor(allChannels.metadata);
  const channelFrames = allChannels.metadata.frameCount;
  for (let index = 2 * channelFrames; index < allChannels.expected.length; ++index) {
    assert.equal(allChannels.expected[index], allChannelsInput[index]);
  }
});

test('Hard Clipping goldens preserve enum polarity and binary64 filter state', async () => {
  const goldens = await readGoldenSet(
    path.join(pluginsRoot, 'saturation/hard_clipping/golden')
  );
  const positive = namedCase(goldens, 'positive-only');
  const negative = namedCase(goldens, 'negative-only');
  const frames = positive.metadata.frameCount;
  for (let frame = 0; frame < frames; ++frame) {
    assert.equal(negative.expected[frames + frame], -positive.expected[frame]);
  }

  const oneFrameBlocks = namedCase(goldens, 'one-frame-blocks');
  const input = stimulusFor(oneFrameBlocks.metadata);
  const threshold = 10 ** (-18 / 20);
  for (let channel = 0; channel < oneFrameBlocks.metadata.channels; ++channel) {
    let previous = 0;
    const offset = channel * oneFrameBlocks.metadata.frameCount;
    for (let frame = 0; frame < oneFrameBlocks.metadata.frameCount; ++frame) {
      let sample = input[offset + frame];
      if (sample < -threshold) sample = Math.fround(-threshold);
      const fir = sample * 0.125 + sample * 0.375 +
        sample * 0.375 + sample * 0.125;
      const filtered = 0.3 * fir + 0.7 * previous;
      previous = filtered;
      assert.equal(oneFrameBlocks.expected[offset + frame], Math.fround(filtered));
    }
  }
});

test('Saturation goldens preserve dry gain, bias cancellation, and unclipped output', async () => {
  const goldens = await readGoldenSet(
    path.join(pluginsRoot, 'saturation/saturation/golden')
  );
  for (const id of ['zero-drive-wet', 'bias-cancelled-silence']) {
    const silent = namedCase(goldens, id);
    assert.equal(silent.expected.every(value => value === 0), true);
  }

  const dry = namedCase(goldens, 'dry-with-gain');
  const dryInput = stimulusFor(dry.metadata);
  const gain = 10 ** (6 / 20);
  for (let index = 0; index < dry.expected.length; ++index) {
    assert.equal(dry.expected[index], Math.fround(dryInput[index] * gain));
  }

  const boosted = namedCase(goldens, 'maximum-drive-negative-bias');
  assert.equal(boosted.expected.some(value => value > 1), true);
});
