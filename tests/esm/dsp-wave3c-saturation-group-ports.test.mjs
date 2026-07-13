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
    directory: 'saturation/harmonic_distortion',
    type: 'HarmonicDistortionPlugin',
    hash: 0x04f4b5e0,
    fields: [
      ['secondHarmonic', 'h2', 'float'],
      ['thirdHarmonic', 'h3', 'float'],
      ['fourthHarmonic', 'h4', 'float'],
      ['fifthHarmonic', 'h5', 'float'],
      ['sensitivity', 'sn', 'float']
    ],
    caseCount: 8,
    goldenBytes: 399872,
    jsEngineHash: '3b99892c179667a51493ed55aeeb0a79ffe700a661ad33406d17d420abfacce9',
    activeParams: { h2: 20, h3: -15, h4: 10, h5: -5, sn: 1.5 }
  },
  {
    directory: 'saturation/dynamic_saturation',
    type: 'DynamicSaturationPlugin',
    hash: 0xc8929bf3,
    fields: [
      ['speakerDrive', 'sd', 'float'],
      ['speakerStiffness', 'ss', 'float'],
      ['speakerDamping', 'sp', 'float'],
      ['speakerMass', 'sm', 'float'],
      ['distortionDrive', 'dd', 'float'],
      ['distortionBias', 'db', 'float'],
      ['distortionMix', 'dm', 'float'],
      ['coneMotionMix', 'cm', 'float'],
      ['outputGain', 'og', 'float']
    ],
    caseCount: 9,
    goldenBytes: 161408,
    jsEngineHash: 'ec6b2dedb39cd0ddd15e5c976d24a52ec2ad78a111e94d6992d5c50d52a35a39',
    activeParams: { sd: 7, ss: 4, sp: 3, sm: 0.7, dd: 6, db: -0.2, dm: 73, cm: 81, og: -3 }
  },
  {
    directory: 'saturation/exciter',
    type: 'ExciterPlugin',
    hash: 0xfc6e6a7a,
    fields: [
      ['highPassFrequency', 'hf', 'float'],
      ['highPassSlope', 'hs', 'int'],
      ['drive', 'dr', 'float'],
      ['bias', 'bs', 'float'],
      ['mix', 'mx', 'float']
    ],
    caseCount: 9,
    goldenBytes: 146054,
    jsEngineHash: '88ad7576e26eb616e08b1009fa34814e1e5e2decaea3765706a0e7d122f12038',
    activeParams: { hf: 3500, hs: 2, dr: 7, bs: -0.2, mx: 73 }
  },
  {
    directory: 'saturation/sub_synth',
    type: 'SubSynthPlugin',
    hash: 0x06f29552,
    fields: [
      ['subLevel', 'sl', 'float'],
      ['dryLevel', 'dl', 'float'],
      ['subLowPassFrequency', 'slf', 'float'],
      ['subLowPassSlope', 'sls', 'int'],
      ['subHighPassFrequency', 'shf', 'float'],
      ['subHighPassSlope', 'shs', 'int'],
      ['dryHighPassFrequency', 'dhf', 'float'],
      ['dryHighPassSlope', 'dhs', 'int']
    ],
    caseCount: 11,
    goldenBytes: 169159,
    jsEngineHash: '5b3bdbb8fb5a927df7aa35af5474be48f5d121cd1dda6cd2a17359830b6fa542',
    activeParams: { sl: 137, dl: 83, slf: 173, sls: -18, shf: 17, shs: -12, dhf: 43, dhs: -6 }
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

function channelSamples(signal, frames, channel) {
  return signal.slice(channel * frames, (channel + 1) * frames);
}

test('Saturation schemas freeze source parameter order, layouts, and hashes', async () => {
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

test('Saturation goldens are source-frozen, bounded, finite, and representative', async () => {
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

test('Harmonic Distortion isolates every polynomial order and normalization extreme', async () => {
  const goldens = await readGoldenSet(
    path.join(pluginsRoot, 'saturation/harmonic_distortion/golden')
  );
  const isolated = [
    ['second-harmonic-only', 'h2'],
    ['third-harmonic-only', 'h3'],
    ['fourth-harmonic-only', 'h4'],
    ['fifth-harmonic-only', 'h5']
  ];
  for (const [id, activeKey] of isolated) {
    const golden = goldens.find(item => item.metadata.id === id);
    for (const key of ['h2', 'h3', 'h4', 'h5']) {
      assert.equal(golden.metadata.params[key] === 0, key !== activeKey);
    }
  }
  assert.ok(goldens.some(item => item.metadata.params.sn === 0.1));
  assert.ok(goldens.some(item => item.metadata.params.sn === 2));
});

test('Dynamic Saturation freezes Float32 state commits and extrema', async () => {
  const goldens = await readGoldenSet(
    path.join(pluginsRoot, 'saturation/dynamic_saturation/golden')
  );
  const identity = goldens.find(item => item.metadata.id === 'zero-drive-identity');
  assert.deepEqual(identity.expected, stimulusFor(identity.metadata));
  const maximum = goldens.find(item => item.metadata.id === 'maximum-force-minimum-mass');
  assert.equal(maximum.metadata.params.sd, 10);
  assert.equal(maximum.metadata.params.sm, 0.1);
  assert.equal(maximum.metadata.params.dd, 10);
  assert.equal(maximum.metadata.params.cm, 100);
  assert.equal(maximum.metadata.params.og, 18);
  assert.notDeepEqual(
    goldens.find(item => item.metadata.id === 'float32-state-odd-blocks').expected,
    goldens.find(item => item.metadata.id === 'float32-state-one-frame').expected
  );
});

test('Exciter freezes every HPF mode and double-precision state continuity', async () => {
  const goldens = await readGoldenSet(path.join(pluginsRoot, 'saturation/exciter/golden'));
  assert.deepEqual(new Set(goldens.map(item => item.metadata.params.hs)), new Set([0, 1, 2]));
  assert.ok(goldens.some(item => item.metadata.params.hf === 500));
  assert.ok(goldens.some(item => item.metadata.params.hf === 10000));
  assert.ok(goldens.some(item => item.metadata.params.dr === 0));
  assert.ok(goldens.some(item => item.metadata.params.dr === 10));
  const dry = goldens.find(item => item.metadata.id === 'filter-off-dry');
  assert.deepEqual(dry.expected, stimulusFor(dry.metadata));
  assert.deepEqual(
    goldens.find(item => item.metadata.id === 'double-state-odd-blocks').expected,
    goldens.find(item => item.metadata.id === 'double-state-one-frame').expected
  );
});

test('Sub Synth freezes full-wave rectification, every slope, and double state', async () => {
  const goldens = await readGoldenSet(path.join(pluginsRoot, 'saturation/sub_synth/golden'));
  const dry = goldens.find(item => item.metadata.id === 'dry-only-identity');
  assert.deepEqual(dry.expected, stimulusFor(dry.metadata));
  const rectified = goldens.find(item => item.metadata.id === 'rectifier-only-maximum');
  assert.ok(rectified.expected.every(sample => sample >= 0));
  const slopes = goldens.find(item => item.metadata.id === 'every-slope-with-state-rebuilds');
  const covered = new Set([
    slopes.metadata.params.sls,
    ...slopes.metadata.events.map(event => event.params.sls)
  ]);
  assert.deepEqual(covered, new Set([0, -6, -12, -18, -24]));
  assert.deepEqual(
    goldens.find(item => item.metadata.id === 'double-state-odd-blocks').expected,
    goldens.find(item => item.metadata.id === 'double-state-one-frame').expected
  );
});

test('Saturation references freeze state while bypassed', async () => {
  const sampleRate = 44100;
  const channels = 2;
  const prefix = testSignal(47, channels, 3);
  const bypass = testSignal(31, channels, 53);
  const suffix = testSignal(43, channels, 97);
  for (const port of ports) {
    const resumed = await createReferenceSession(port.type, { repoRoot, params: port.activeParams });
    const uninterrupted = await createReferenceSession(port.type, { repoRoot, params: port.activeParams });
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

test('Saturation references freeze channel reset and retention rules', async () => {
  const sampleRate = 48000;
  const prefix = testSignal(47, 2, 11);
  const suffix = testSignal(43, 1, 101);
  for (const port of ports.slice(0, 3)) {
    const changed = await createReferenceSession(port.type, { repoRoot, params: port.activeParams });
    const fresh = await createReferenceSession(port.type, { repoRoot, params: port.activeParams });
    await changed.process(prefix, { sampleRate, frames: 47, channels: 2, blockSize: 47 });
    assert.deepEqual(
      await changed.process(suffix, { sampleRate, frames: 43, channels: 1, blockSize: 43 }),
      await fresh.process(suffix, { sampleRate, frames: 43, channels: 1, blockSize: 43 }),
      port.type
    );
  }

  const sub = ports.at(-1);
  const retained = await createReferenceSession(sub.type, { repoRoot, params: sub.activeParams });
  const fresh = await createReferenceSession(sub.type, { repoRoot, params: sub.activeParams });
  await retained.process(prefix, { sampleRate, frames: 47, channels: 2, blockSize: 47 });
  assert.notDeepEqual(
    await retained.process(suffix, { sampleRate, frames: 43, channels: 1, blockSize: 43 }),
    await fresh.process(suffix, { sampleRate, frames: 43, channels: 1, blockSize: 43 })
  );
});

test('Sub Synth safely preserves and grows channel state capacity', async () => {
  const port = ports.at(-1);
  const sampleRate = 48000;

  const oneChannelPrefix = testSignal(47, 1, 13);
  const twoChannelSuffix = testSignal(43, 2, 101);
  const grown = await createReferenceSession(port.type, { repoRoot, params: port.activeParams });
  await grown.process(oneChannelPrefix, {
    sampleRate, frames: 47, channels: 1, blockSize: 47
  });
  const grownOutput = await grown.process(twoChannelSuffix, {
    sampleRate, frames: 43, channels: 2, blockSize: 43
  });

  const grownChannelZero = await createReferenceSession(
    port.type, { repoRoot, params: port.activeParams }
  );
  await grownChannelZero.process(oneChannelPrefix, {
    sampleRate, frames: 47, channels: 1, blockSize: 47
  });
  const expectedGrownChannelZero = await grownChannelZero.process(
    channelSamples(twoChannelSuffix, 43, 0),
    { sampleRate, frames: 43, channels: 1, blockSize: 43 }
  );
  const grownChannelOne = await createReferenceSession(
    port.type, { repoRoot, params: port.activeParams }
  );
  const expectedGrownChannelOne = await grownChannelOne.process(
    channelSamples(twoChannelSuffix, 43, 1),
    { sampleRate, frames: 43, channels: 1, blockSize: 43 }
  );
  assert.deepEqual(channelSamples(grownOutput, 43, 0), expectedGrownChannelZero);
  assert.deepEqual(channelSamples(grownOutput, 43, 1), expectedGrownChannelOne);
  assert.ok(grownOutput.every(Number.isFinite));

  const twoChannelPrefix = testSignal(47, 2, 29);
  const oneChannelMiddle = testSignal(31, 1, 79);
  const regrown = await createReferenceSession(port.type, { repoRoot, params: port.activeParams });
  await regrown.process(twoChannelPrefix, {
    sampleRate, frames: 47, channels: 2, blockSize: 47
  });
  await regrown.process(oneChannelMiddle, {
    sampleRate, frames: 31, channels: 1, blockSize: 31
  });
  const regrownOutput = await regrown.process(twoChannelSuffix, {
    sampleRate, frames: 43, channels: 2, blockSize: 43
  });

  const expectedChannelZero = await createReferenceSession(
    port.type, { repoRoot, params: port.activeParams }
  );
  await expectedChannelZero.process(channelSamples(twoChannelPrefix, 47, 0), {
    sampleRate, frames: 47, channels: 1, blockSize: 47
  });
  await expectedChannelZero.process(oneChannelMiddle, {
    sampleRate, frames: 31, channels: 1, blockSize: 31
  });
  const expectedRegrownChannelZero = await expectedChannelZero.process(
    channelSamples(twoChannelSuffix, 43, 0),
    { sampleRate, frames: 43, channels: 1, blockSize: 43 }
  );
  const expectedChannelOne = await createReferenceSession(
    port.type, { repoRoot, params: port.activeParams }
  );
  await expectedChannelOne.process(channelSamples(twoChannelPrefix, 47, 1), {
    sampleRate, frames: 47, channels: 1, blockSize: 47
  });
  const expectedRegrownChannelOne = await expectedChannelOne.process(
    channelSamples(twoChannelSuffix, 43, 1),
    { sampleRate, frames: 43, channels: 1, blockSize: 43 }
  );
  assert.deepEqual(channelSamples(regrownOutput, 43, 0), expectedRegrownChannelZero);
  assert.deepEqual(channelSamples(regrownOutput, 43, 1), expectedRegrownChannelOne);
  assert.ok(regrownOutput.every(Number.isFinite));
});

test('Sub Synth resets state on same-count topology changes', async () => {
  const port = ports.at(-1);
  const sampleRate = 96000;
  const params = {
    ...port.activeParams,
    dl: 0,
    sls: -6,
    shs: 0,
    dhs: 0
  };
  const prefix = testSignal(47, 1, 17);
  const suffix = testSignal(43, 1, 113);
  const changed = await createReferenceSession(port.type, { repoRoot, params });
  await changed.process(prefix, {
    sampleRate, frames: 47, channels: 1, blockSize: 47
  });
  changed.plugin.setParameters({ sls: -12 });
  const changedOutput = await changed.process(suffix, {
    sampleRate, frames: 43, channels: 1, blockSize: 43
  });
  const fresh = await createReferenceSession(
    port.type, { repoRoot, params: { ...params, sls: -12 } }
  );
  const freshOutput = await fresh.process(suffix, {
    sampleRate, frames: 43, channels: 1, blockSize: 43
  });
  assert.deepEqual(changedOutput, freshOutput);
  assert.ok(changedOutput.every(Number.isFinite));
});

test('Saturation kernels preserve realtime and state-precision constraints', async () => {
  for (const port of ports) {
    const source = await fs.readFile(path.join(pluginsRoot, port.directory, 'kernel.cpp'), 'utf8');
    const processStart = source.indexOf('  void process(');
    const processEnd = source.indexOf('\nprivate:', processStart);
    assert.ok(processStart >= 0 && processEnd > processStart);
    const processBody = source.slice(processStart, processEnd);
    assert.doesNotMatch(processBody, /std::(?:fabs|abs|max|min)\s*\(/);
    assert.doesNotMatch(processBody, /\.resize\s*\(|\bnew\b|\bmalloc\s*\(/);
  }
  const dynamic = await fs.readFile(
    path.join(pluginsRoot, 'saturation/dynamic_saturation/kernel.cpp'), 'utf8'
  );
  assert.match(dynamic, /std::vector<float> positions_/);
  assert.match(dynamic, /std::vector<float> velocities_/);
  const exciter = await fs.readFile(
    path.join(pluginsRoot, 'saturation/exciter/kernel.cpp'), 'utf8'
  );
  const subSynth = await fs.readFile(
    path.join(pluginsRoot, 'saturation/sub_synth/kernel.cpp'), 'utf8'
  );
  assert.match(exciter, /double x1/);
  assert.match(subSynth, /double x1/);
  assert.match(subSynth, /sameShape/);
});
