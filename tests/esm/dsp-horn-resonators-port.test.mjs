import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { validateParamSpec } from '../../scripts/gen-dsp-params.mjs';
import {
  DEFAULT_GOLDEN_BUDGET_BYTES,
  readGoldenSet
} from '../../tools/dsp-parity/golden-io.mjs';
import { runParityCli } from '../../tools/dsp-parity/run.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const resonatorRoot = path.join(repoRoot, 'dsp', 'plugins', 'resonator');
const expectedCaseIds = [
  'default-impulse',
  'minimum-44100',
  'maximum-192000',
  'all4-96000',
  'one-frame-blocks',
  'same-n-shape-reset',
  'length-reset',
  'wg-state-preserving',
  'nonaligned-geometry-event'
];
const ports = [
  {
    type: 'HornResonatorPlugin',
    folder: 'horn_resonator',
    jsEngineHash: 'c8426fa0fab3cdd27c4d60b2ce826d12112cbbfd669ac3e573248b3fd89e738b'
  },
  {
    type: 'HornResonatorPlusPlugin',
    folder: 'horn_resonator_plus',
    jsEngineHash: 'cd8bcbb936ed7dd81479e215b693341df7ff05327c1e3bc0995746e0ea6b45c4'
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
  const root = path.join(resonatorRoot, port.folder);
  const schemaPath = path.join(root, 'params.json');
  const [schemaText, casesText, kernel] = await Promise.all([
    fs.readFile(schemaPath, 'utf8'),
    fs.readFile(path.join(root, 'cases.json'), 'utf8'),
    fs.readFile(path.join(root, 'kernel.cpp'), 'utf8')
  ]);
  return {
    root,
    schema: validateParamSpec(JSON.parse(schemaText), schemaPath),
    cases: JSON.parse(casesText),
    kernel
  };
}

test('horn schemas and generated packers share the frozen eight-float ABI', async () => {
  const expectedDefaults = Float32Array.from([600, 70, 3, 60, 40, 0.03, 0.99, 30]);
  for (const port of ports) {
    const { schema } = await readPort(port);
    assert.equal(schema.hash, 0xc0bf4f84);
    assert.equal(schema.floatCount, 8);
    assert.equal(schema.tolerance.abs, 0.0001);
    assert.deepEqual(schema.fields.map(field => field.keys[0]),
      ['co', 'ln', 'th', 'mo', 'cv', 'dp', 'tr', 'wg']);

    const packer = DSP_PARAM_PACKERS.get(port.type);
    assert.ok(packer);
    assert.equal(packer.hash, 0xc0bf4f84);
    assert.equal(packer.floatCount, 8);
    assert.deepEqual(packer.pack(), expectedDefaults);
    assert.deepEqual(
      packer.pack({ co: 20, ln: 120, th: 0.5, mo: 200, cv: -100, dp: 10, tr: 0, wg: -36 }),
      Float32Array.from([20, 120, 0.5, 200, -100, 10, 0, -36])
    );
  }
});

test('horn reviewed case matrices and JS goldens remain deterministic', async () => {
  for (const port of ports) {
    const loaded = await readPort(port);
    assert.deepEqual(loaded.cases.cases.map(item => item.id), expectedCaseIds);
    assert.equal(loaded.cases.cases.find(item => item.id === 'maximum-192000').sampleRate,
      192000);
    assert.equal(loaded.cases.cases.find(item => item.id === 'all4-96000').channels, 4);
    assert.equal(loaded.cases.cases.find(item => item.id === 'one-frame-blocks').blockSize, 1);
    assert.ok(loaded.cases.cases.find(item => item.id === 'wg-state-preserving')
      .events.every(event => Object.keys(event.params).every(key => key === 'wg')));

    const goldenRoot = path.join(loaded.root, 'golden');
    assert.ok(await directoryBytes(goldenRoot) <= DEFAULT_GOLDEN_BUDGET_BYTES);
    const goldens = await readGoldenSet(goldenRoot);
    assert.equal(goldens.length, 9);
    assert.ok(goldens.every(item => item.metadata.type === port.type));
    assert.ok(goldens.every(item => item.metadata.jsEngineHash === port.jsEngineHash));
    assert.ok(goldens.every(item => item.expected.every(Number.isFinite)));

    const result = await runParityCli([
      '--root', repoRoot,
      '--type', port.type,
      '--self-check'
    ], { log() {} });
    assert.equal(result.results.length, 9);
    assert.ok(result.results.every(item => item.comparison.pass));
  }
});

test('horn kernels share waveguide precision and reset contracts without process allocation', async () => {
  const [common, registry, nativeTest, cmake] = await Promise.all([
    fs.readFile(path.join(resonatorRoot, 'horn_waveguide_common.h'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'registry.inc'), 'utf8'),
    fs.readFile(path.join(resonatorRoot, 'horn_native_test.cpp'), 'utf8'),
    fs.readFile(path.join(repoRoot, 'dsp', 'CMakeLists.txt'), 'utf8')
  ]);

  assert.match(common, /segmentCount\(sample_rate_, kMaximumLengthMeters\)/);
  assert.match(common, /std::vector<float> impedance_/);
  assert.match(common, /std::vector<float> reflections_/);
  assert.match(common, /std::vector<float> forward_/);
  assert.match(common, /std::vector<float> reverse_/);
  assert.match(common, /std::vector<float> low_delay_/);
  assert.match(common, /std::vector<dsp::LinkwitzRiley24State> lowpass_states_/);
  assert.match(common, /LinkwitzRileyStateStorage::Float64/);
  assert.match(common, /mouth_x1_\[channel\] = static_cast<float>\(mouth_x1\)/);
  assert.match(common,
    /reflected_mouth = mouth_b0_ \* mouth_forward - mouth_a1_ \* mouth_y1;/);
  assert.doesNotMatch(common, /mouth_b0_ \* mouth_forward \+ .*mouth_x1/);
  assert.match(common, /if constexpr \(BoundaryVariant == Variant::Base\)/);
  assert.match(common, /mouth_a2_ \* mouth_y2/);
  assert.match(common, /throat_b0_ \* static_cast<double>\(reverse_temp_\[0u\]\)/);
  assert.doesNotMatch(common, /std::(?:fabs|max|min)\s*\(/);

  const processStart = common.search(/\bvoid\s+process\s*\(\s*float\s*\*\s*audio\b/);
  const processEnd = common.search(
    /\[\[nodiscard\]\]\s+std::uint32_t\s+maximumSegments\s*\(/);
  const processBody = common.slice(processStart, processEnd);
  assert.ok(processStart >= 0 && processEnd > processStart);
  assert.doesNotMatch(processBody, /\.resize\(|\bnew\b/);
  for (const key of [
    'crossover', 'length', 'throatDiameter', 'mouthDiameter', 'curve', 'damping',
    'throatReflection'
  ]) {
    assert.match(common, new RegExp(`configured_params_\\.${key} != params\\.${key}`));
  }
  assert.doesNotMatch(common,
    /configured_params_\.waveguideGain != params\.waveguideGain/);

  for (const port of ports) {
    const { kernel } = await readPort(port);
    assert.match(kernel, /horn_waveguide::Processor processor_/);
    assert.doesNotMatch(kernel, /writeTelemetry/);
    assert.match(registry, new RegExp(`EFFETUNE_PLUGIN\\(${port.type}, resonator/`));
  }
  assert.match(nativeTest, /segmentCount\(\s*192000\.0, 1\.2\) == 672u/);
  assert.match(nativeTest, /allocation_guard::Scope allocation_scope/);
  assert.match(nativeTest, /testChannelResetSequence\(base\)/);
  assert.match(nativeTest, /testChannelResetSequence\(plus\)/);
  assert.match(nativeTest, /testWaveguideGainPreservesState/);
  assert.match(cmake, /effetune_dsp_horn_resonator_tests/);
});
