import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  TUBE_STANDARD_PRODUCTION_CASE_IDS,
  selectTubeStandardProductionCases,
  verifyTubeStandardGoldens,
  verifyTubeTortureOracleFixture,
  verifyTubeTwoRateGoldens
} from '../../tools/dsp-parity/tube-simulator-oracle.mjs';
import { readParamsSchema } from '../../tools/dsp-parity/cases.mjs';
import { readFloat32File } from '../../tools/dsp-parity/golden-io.mjs';
import { executeReferenceCase } from '../../tools/dsp-parity/node-host.mjs';
import {
  runNativeCase,
  runWasmCase
} from '../../tools/dsp-parity/runners.mjs';
import { generateStimulus } from '../../tools/dsp-parity/stimuli.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixtureRelativeRoot = path.join(
  'tests',
  'fixtures',
  'tube-simulator',
  'p3-baseline-v1'
);
const fixtureRoot = path.join(repoRoot, fixtureRelativeRoot);
const goldenRoot = path.join(fixtureRoot, 'golden');
const EXPECTED_FIXTURE_TREE_SHA256 =
  'DCAE9B192E86F7F98E1781BAA34EB98B4D3DA307A2DCEECD850A06106B0E1D16';
const PRODUCTION_PROJECTION_DIFFERENCES = Object.freeze([
  Object.freeze({
    channel: 0,
    frame: 212,
    expectedBits: 0x3c90e4ea,
    actualBits: 0x3c90e4eb
  }),
  Object.freeze({
    channel: 0,
    frame: 227,
    expectedBits: 0x3dd1acd9,
    actualBits: 0x3dd1acda
  }),
  Object.freeze({
    channel: 0,
    frame: 372,
    expectedBits: 0xbd6f4b28,
    actualBits: 0xbd6f4b29
  }),
  Object.freeze({
    channel: 1,
    frame: 200,
    expectedBits: 0xbbb36a40,
    actualBits: 0xbbb36a3f
  }),
  Object.freeze({
    channel: 1,
    frame: 278,
    expectedBits: 0x3a08ea1b,
    actualBits: 0x3a08ea1c
  }),
  Object.freeze({
    channel: 1,
    frame: 405,
    expectedBits: 0xba1e0993,
    actualBits: 0xba1e0994
  }),
  Object.freeze({
    channel: 1,
    frame: 594,
    expectedBits: 0xb75319dd,
    actualBits: 0xb75319e2
  })
]);

async function listFiles(directory, relativeDirectory = '') {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(path.join(directory, entry.name), relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function fixtureTreeSha256(directory) {
  const hash = crypto.createHash('sha256');
  const files = await listFiles(directory);
  for (const relativePath of files) {
    hash.update(relativePath.split(path.sep).join('/'));
    hash.update('\0');
    hash.update(await fs.readFile(path.join(directory, relativePath)));
    hash.update('\0');
  }
  return { hash: hash.digest('hex').toUpperCase(), files };
}

function float32Bits(value) {
  const view = new DataView(new ArrayBuffer(4));
  view.setFloat32(0, value, true);
  return view.getUint32(0, true);
}

function assertPermittedProductionProjection(actual, expected, testCase, label) {
  const differences = [];
  for (let index = 0; index < actual.length; ++index) {
    const actualBits = float32Bits(actual[index]);
    const expectedBits = float32Bits(expected[index]);
    if (actualBits !== expectedBits) {
      differences.push({
        channel: Math.floor(index / testCase.frames),
        frame: index % testCase.frames,
        actualBits,
        expectedBits
      });
    }
  }

  if (testCase.id !== 'lower-range-corners') {
    assert.deepEqual(differences, [], `${testCase.id} (${label})`);
    return;
  }

  assert.deepEqual(
    differences,
    PRODUCTION_PROJECTION_DIFFERENCES,
    `${testCase.id} (${label})`
  );
}

// The WASM and native kernels reproduce the frozen projections bit for bit, but the
// JavaScript reference cannot: ECMAScript leaves `Math.exp`, `Math.log` and `Math.pow`
// implementation-defined, so the amplifier solver lands a few ULP apart between engines.
// Measured across the eight projections on Linux/Node 22 against goldens promoted on
// Windows/Node 24, the worst per-sample deviation is 3.6e-17 - in the silence case, whose
// own peak is 7.7e-15 - and 1.7e-18 in the loudest signal case. The fixture's declared
// per-sample tolerance is therefore what this comparison enforces; any real regression in
// the reference model moves the output by orders of magnitude more.
function assertReferenceProjection(actual, expected, tolerance, testCase) {
  assert.equal(actual.length, expected.length, `${testCase.id} sample count`);
  let worst = 0;
  let worstIndex = -1;
  for (let index = 0; index < actual.length; ++index) {
    const deviation = Math.abs(actual[index] - expected[index]);
    if (deviation > worst) {
      worst = deviation;
      worstIndex = index;
    }
  }
  assert.ok(
    worst <= tolerance,
    `${testCase.id}: the reference deviates from the frozen projection by ${worst} at ` +
    `channel ${Math.floor(worstIndex / testCase.frames)} frame ` +
    `${worstIndex % testCase.frames}, above the permitted ${tolerance}.`
  );
}

test('Tube Simulator p3-baseline-v1 fixture stays byte-frozen and self-contained', async () => {
  const tree = await fixtureTreeSha256(fixtureRoot);
  assert.equal(tree.hash, EXPECTED_FIXTURE_TREE_SHA256);
  assert.equal(tree.files.filter(file => /^golden[\\/]case-\d+\.json$/.test(file)).length, 13);
  assert.equal(tree.files.filter(file => /^golden[\\/]case-\d+\.f32$/.test(file)).length, 13);

  const manifestNames = [
    'standard-oracle-v1.json',
    'two-rate-contract-v1.json',
    'torture-oracle-v1.json'
  ];
  for (const manifestName of manifestNames) {
    const manifest = JSON.parse(
      await fs.readFile(path.join(goldenRoot, manifestName), 'utf8')
    );
    assert.equal(
      manifest.oracle.manifest,
      'tests/fixtures/tube-simulator/p3-baseline-v1/oracle/build-manifest.json'
    );
    assert.equal(
      manifest.oracle.source,
      'tests/fixtures/tube-simulator/p3-baseline-v1/oracle/path2-shape.cpp'
    );
    assert.equal(
      manifest.oracle.wasm,
      'tests/fixtures/tube-simulator/p3-baseline-v1/oracle/path2-shape.wasm'
    );
  }

  const standardManifest = JSON.parse(
    await fs.readFile(path.join(goldenRoot, 'standard-oracle-v1.json'), 'utf8')
  );
  assert.equal(
    standardManifest.caseMatrix.path,
    'tests/fixtures/tube-simulator/p3-baseline-v1/cases.json'
  );
  assert.equal(standardManifest.cases.length, 13);
});

test('Tube Simulator production projection contains only the eight permitted legacy cases', async () => {
  const standardManifest = JSON.parse(
    await fs.readFile(path.join(goldenRoot, 'standard-oracle-v1.json'), 'utf8')
  );
  const selected = selectTubeStandardProductionCases(standardManifest.cases);
  assert.deepEqual(
    selected.map(testCase => testCase.id),
    TUBE_STANDARD_PRODUCTION_CASE_IDS
  );
  assert.deepEqual(
    standardManifest.cases
      .map(testCase => testCase.id)
      .filter(id => !TUBE_STANDARD_PRODUCTION_CASE_IDS.includes(id)),
    [
      'maximum-drive-12ax7',
      'upper-range-corners',
      'tube-12au7-reset-event',
      'non-reset-parameter-event',
      'tube-reset-event'
    ]
  );
});

test('Tube Simulator Phase A reference preserves the eight permitted P3 projections',
  async () => {
    const standardManifest = JSON.parse(
      await fs.readFile(path.join(goldenRoot, 'standard-oracle-v1.json'), 'utf8')
    );
    const selected = selectTubeStandardProductionCases(standardManifest.cases);
    const { tolerance } = await readParamsSchema(
      path.join(fixtureRoot, 'params.json')
    );

    for (const testCase of selected) {
      // The P3 baseline is the legacy line amplifier, so the projection names the
      // output stage rather than inheriting the current product default.
      const adaptedCase = {
        ...testCase,
        params: { ...testCase.params, iv: 1, nf: 0, os: 'Line' }
      };
      const seed = BigInt(testCase.seed);
      const input = generateStimulus({
        id: testCase.stimulus,
        sampleRate: testCase.sampleRate,
        frames: testCase.frames,
        channels: testCase.channels,
        caseIndex: testCase.caseIndex,
        seed
      });
      const expected = await readFloat32File(
        path.join(goldenRoot, testCase.committedGolden.binary),
        testCase.committedGolden.floats
      );
      const actual = (await executeReferenceCase(
        'TubeSimulatorPlugin',
        { ...adaptedCase, seed },
        input,
        { repoRoot }
      )).output;

      assertReferenceProjection(actual, expected, tolerance.abs, testCase);
    }
  });

test('Tube Simulator production kernels preserve the eight P3 projections',
  async () => {
    const standardManifest = JSON.parse(
      await fs.readFile(path.join(goldenRoot, 'standard-oracle-v1.json'), 'utf8')
    );
    const selected = selectTubeStandardProductionCases(standardManifest.cases);
    const schema = await readParamsSchema(
      path.join(repoRoot, 'dsp/plugins/saturation/tube_simulator/params.json')
    );
    const executions = [
      ['WASM baseline', options => runWasmCase({ ...options, variant: 'baseline' })],
      ['WASM SIMD', options => runWasmCase({ ...options, variant: 'simd' })]
    ];
    const nativeRunner = process.env.ET_TUBE_NATIVE_RUNNER;
    if (nativeRunner) {
      executions.push([
        'native',
        options => runNativeCase({ ...options, runnerPath: nativeRunner })
      ]);
    }

    for (const testCase of selected) {
      // The P3 baseline is the legacy line amplifier, so the projection names the
      // output stage rather than inheriting the current product default.
      const adaptedCase = {
        ...testCase,
        params: { ...testCase.params, iv: 1, nf: 0, os: 'Line' }
      };
      const seed = BigInt(testCase.seed);
      const input = generateStimulus({
        id: testCase.stimulus,
        sampleRate: testCase.sampleRate,
        frames: testCase.frames,
        channels: testCase.channels,
        caseIndex: testCase.caseIndex,
        seed
      });
      const expected = await readFloat32File(
        path.join(goldenRoot, testCase.committedGolden.binary),
        testCase.committedGolden.floats
      );

      for (const [label, execute] of executions) {
        const actual = await execute({
          type: 'TubeSimulatorPlugin',
          testCase: { ...adaptedCase, seed },
          input,
          schema,
          repoRoot
        });
        assertPermittedProductionProjection(actual, expected, testCase, label);
      }
    }
  });

test('Tube Simulator frozen oracle verifies from a fixture-only checkout root', async () => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), 'effetune-tube-p3-baseline-v1-')
  );
  const canonicalRoot = await fs.realpath(temporaryRoot);
  const isolatedFixtureRoot = path.join(canonicalRoot, fixtureRelativeRoot);
  try {
    await fs.mkdir(path.dirname(isolatedFixtureRoot), { recursive: true });
    await fs.cp(fixtureRoot, isolatedFixtureRoot, { recursive: true });

    const standard = await verifyTubeStandardGoldens({ repoRoot: canonicalRoot });
    const twoRate = await verifyTubeTwoRateGoldens({ repoRoot: canonicalRoot });
    const torture = await verifyTubeTortureOracleFixture({ repoRoot: canonicalRoot });

    assert.equal(standard.caseCount, 13);
    assert.equal(twoRate.vectorCount, 11);
    assert.equal(torture.descriptor.floats, 6144);
  } finally {
    await fs.rm(canonicalRoot, { recursive: true, force: true });
  }
});
