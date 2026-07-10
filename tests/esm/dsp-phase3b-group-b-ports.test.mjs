import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ports = [
  {
    type: 'FiveBandPEQPlugin',
    folder: ['eq', 'five_band_peq'],
    hash: 0x8835f2b9,
    floatCount: 25,
    goldenCount: 8,
    fields: [
      ['frequency', 'f', 'float', 5],
      ['gain', 'g', 'float', 5],
      ['q', 'q', 'float', 5],
      ['filterType', 't', 'enum', 5],
      ['bandEnabled', 'e', 'bool', 5]
    ]
  },
  {
    type: 'FifteenBandPEQPlugin',
    folder: ['eq', 'fifteen_band_peq'],
    hash: 0x6197cd46,
    floatCount: 75,
    goldenCount: 8,
    fields: [
      ['frequency', 'f', 'float', 15],
      ['gain', 'g', 'float', 15],
      ['q', 'q', 'float', 15],
      ['filterType', 't', 'enum', 15],
      ['bandEnabled', 'e', 'bool', 15]
    ]
  },
  {
    type: 'FifteenBandGEQPlugin',
    folder: ['eq', 'fifteen_band_geq'],
    hash: 0x6c4f898c,
    floatCount: 15,
    goldenCount: 6,
    fields: [['bandGain', 'b', 'float', 15]]
  },
  {
    type: 'EarphoneCableSimPlugin',
    folder: ['eq', 'earphone_cable_sim'],
    hash: 0x41eff423,
    floatCount: 25,
    goldenCount: 8,
    fields: [
      ['outputImpedance', 'zo', 'float', 1],
      ['cableResistance', 'rc', 'float', 1],
      ['cableInductance', 'lc', 'float', 1],
      ['voiceCoilInductance', 'lv', 'float', 1],
      ['baseImpedance', 'zb', 'float', 1],
      ['resonanceFrequency', 'rf', 'float', 5],
      ['resonanceQ', 'rq', 'float', 5],
      ['resonanceImpedance', 'rz', 'float', 5],
      ['resonanceEnabled', 're', 'bool', 5]
    ]
  },
  {
    type: 'CrossfeedFilterPlugin',
    folder: ['spatial', 'crossfeed_filter'],
    hash: 0x2a9ec781,
    floatCount: 3,
    goldenCount: 8,
    fields: [
      ['level', 'lv', 'float', 1],
      ['delay', 'dl', 'float', 1],
      ['lowPassFrequency', 'lf', 'float', 1]
    ]
  }
];

async function directoryBytes(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    if (entry.isFile()) bytes += (await fs.stat(path.join(directory, entry.name))).size;
  }
  return bytes;
}

async function readPort(port) {
  const root = path.join(repoRoot, 'dsp', 'plugins', ...port.folder);
  const schemaPath = path.join(root, 'params.json');
  const casesPath = path.join(root, 'cases.json');
  const kernelPath = path.join(root, 'kernel.cpp');
  const [schemaText, casesText, kernel] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(casesPath, 'utf8'),
    fs.readFile(kernelPath, 'utf8')
  ]);
  return {
    root,
    schema: validateParamSpec(JSON.parse(schemaText), schemaPath),
    cases: JSON.parse(casesText),
    kernel
  };
}

test('Phase 3b group B schemas and goldens stay frozen, current, and within budget', async () => {
  for (const port of ports) {
    const { root, schema } = await readPort(port);
    assert.equal(schema.type, port.type);
    assert.equal(schema.hash, port.hash);
    assert.equal(schema.floatCount, port.floatCount);
    assert.deepEqual(
      schema.fields.map(field => [
        field.name, field.key, field.kind, field.count, field.keys
      ]),
      port.fields.map(([name, key, kind, count]) => [
        name,
        key,
        kind,
        count,
        count === 1
          ? [key]
          : Array.from({ length: count }, (_, index) => `${key}${index}`)
      ]),
      `${port.type} packed source key contract changed`
    );

    const goldenRoot = path.join(root, 'golden');
    assert.ok(await directoryBytes(goldenRoot) <= DEFAULT_GOLDEN_BUDGET_BYTES);
    const goldens = await readGoldenSet(goldenRoot);
    assert.equal(goldens.length, port.goldenCount);
    assert.ok(goldens.every(item => item.metadata.type === port.type));

    const result = await runParityCli([
      '--root', repoRoot,
      '--type', port.type,
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, port.goldenCount);
    assert.equal(result.results.every(item => item.comparison.pass), true);
  }
});

test('Phase 3b group B cases exercise rates, routing, modes, and transitions', async () => {
  const loaded = new Map();
  for (const port of ports) loaded.set(port.type, await readPort(port));

  for (const port of ports) {
    const cases = loaded.get(port.type).cases.cases;
    assert.ok(cases.some(item => item.events?.length > 0));
    assert.ok(cases.some(item => item.channels === 1 || item.channelMode === 'mono'));
    assert.ok(cases.some(item => item.channels === 4 || item.channelMode === 'all4'));
    assert.ok(cases.some(item => item.blockSize && item.blockSize !== 64));
  }

  for (const type of ['FiveBandPEQPlugin', 'FifteenBandPEQPlugin']) {
    const serialized = JSON.stringify(loaded.get(type).cases);
    for (const mode of ['pk', 'lp', 'hp', 'ls', 'hs', 'bp', 'no', 'ap']) {
      assert.match(serialized, new RegExp(`"${mode}"`));
    }
    assert.ok(loaded.get(type).cases.cases.some(item => item.sampleRate === 192000));
  }
  assert.ok(loaded.get('FifteenBandGEQPlugin').cases.cases.some(item => item.sampleRate === 192000));
  assert.ok(loaded.get('CrossfeedFilterPlugin').cases.cases.some(item => item.sampleRate === 192000));

  const earphoneFields = loaded.get('EarphoneCableSimPlugin').schema.fields;
  assert.equal(earphoneFields.some(field => field.name === 'sos'), false);
  assert.deepEqual(
    earphoneFields.map(field => field.name),
    [
      'outputImpedance',
      'cableResistance',
      'cableInductance',
      'voiceCoilInductance',
      'baseImpedance',
      'resonanceFrequency',
      'resonanceQ',
      'resonanceImpedance',
      'resonanceEnabled'
    ]
  );
});

test('Phase 3b group B kernels keep allocation and topology contracts explicit', async () => {
  const loaded = new Map();
  for (const port of ports) loaded.set(port.type, await readPort(port));

  for (const [type, { kernel }] of loaded) {
    assert.doesNotMatch(kernel, /\b(?:malloc|calloc|realloc|free)\s*\(/, type);
    assert.match(kernel, /EFFETUNE_REGISTER_KERNEL\(/, type);
    assert.match(kernel, /void reset\(\) noexcept override/, type);
  }

  for (const type of ['FiveBandPEQPlugin', 'FifteenBandPEQPlugin', 'FifteenBandGEQPlugin']) {
    const kernel = loaded.get(type).kernel;
    assert.match(kernel, /BiquadDf1State/);
    assert.match(kernel, /processBiquadDf1Sample/);
  }

  const earphone = loaded.get('EarphoneCableSimPlugin').kernel;
  assert.match(earphone, /findRoots/);
  assert.match(earphone, /mapRootsToZPlane/);
  assert.match(earphone, /old_states_/);
  assert.match(earphone, /std::round\(static_cast<double>\(sample_rate_\) \* 0\.02\)/);
  assert.match(earphone, /static_assert\(sizeof\(EarphoneCableSimKernel\) <= 8192u\)/);

  const crossfeed = loaded.get('CrossfeedFilterPlugin').kernel;
  assert.match(crossfeed, /channel_count != 2u/);
  assert.match(crossfeed, /std::vector<float> delay_left_/);
  assert.match(crossfeed, /delay_left_\.resize\(delay_size\)/);
});
