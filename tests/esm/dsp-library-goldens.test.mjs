import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  chooseWorkletPlans,
  discoverFrozenGoldenCases,
  expectedValidationRejection,
  isAcceptanceComplete,
  runPythonAcceptanceBackend,
  summarizeInventory
} from '../../tools/verify-dsp-library-goldens.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GOLDEN_CASE_COUNT = 775;
const EFFECT_COUNT = 83;
const WORKLET_GOLDEN_CASE_COUNT = 84;
const NON_IDENTITY_EFFECT_COUNT = 78;

function successfulPythonBackend(total = GOLDEN_CASE_COUNT) {
  return {
    backend: 'python-native',
    counts: {
      total,
      passed: total,
      failed: 0,
      unexecuted: 0,
      expectedValidationRejections: 1
    },
    stateContracts: {
      sameSeed: true,
      differentSeed: true,
      reset: true,
      closeIdempotent: true,
      closedRejects: true
    },
    expectedValidationRejections: [{
      case: 'Matrix/malformed-routes-are-dropped',
      parameter: 'matrixRoutes',
      reason: 'pattern-mismatch'
    }],
    failures: [],
    unexecuted: []
  };
}

function completionFixture(pythonBackend) {
  const javascriptBackend = variant => ({
    backend: `javascript-${variant}`,
    counts: {
      total: GOLDEN_CASE_COUNT,
      passed: GOLDEN_CASE_COUNT,
      failed: 0,
      unexecuted: 0,
      expectedValidationRejections: 1
    },
    stateContracts: {
      sameSeed: true,
      differentSeed: true,
      closeIdempotent: true,
      closedRejects: true,
      statefulStream: true
    }
  });
  const worklet = prefix => ({
    status: 'completed',
    variants: ['baseline', 'simd'].map(variant => ({
      backend: `chromium-audioworklet-${prefix}${variant}`,
      counts: {
        total: prefix ? NON_IDENTITY_EFFECT_COUNT : WORKLET_GOLDEN_CASE_COUNT,
        passed: prefix ? NON_IDENTITY_EFFECT_COUNT : WORKLET_GOLDEN_CASE_COUNT,
        failed: 0,
        unexecuted: 0,
        expectedValidationRejections: prefix ? 0 : 1
      }
    }))
  });
  return {
    backends: [
      pythonBackend,
      javascriptBackend('baseline'),
      javascriptBackend('simd')
    ],
    workletGolden: worklet(''),
    workletNonIdentity: worklet('nonidentity-')
  };
}

async function temporarySummaryDirectory(t) {
  const temporary = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'effetune-python-acceptance-')
  ));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const summaryDirectory = path.join(temporary, 'summaries');
  await fs.mkdir(summaryDirectory);
  return { temporary, summaryDirectory };
}

test('python acceptance ignores a stale success when the current child fails', async t => {
  const { temporary, summaryDirectory } = await temporarySummaryDirectory(t);
  const staleSummaryPath = path.join(
    summaryDirectory,
    'dsp-library-goldens-python.json'
  );
  await fs.writeFile(staleSummaryPath, JSON.stringify(successfulPythonBackend()));
  let currentSummaryPath;
  const backend = await runPythonAcceptanceBackend({
    repoRoot: temporary,
    summaryDirectory,
    python: 'python',
    total: GOLDEN_CASE_COUNT,
    expectedValidationRejections: 1,
    spawnRunner: async (_python, arguments_) => {
      currentSummaryPath = arguments_[arguments_.indexOf('--summary') + 1];
      assert.notEqual(currentSummaryPath, staleSummaryPath);
      await assert.rejects(fs.access(currentSummaryPath), { code: 'ENOENT' });
      await fs.writeFile(
        currentSummaryPath,
        JSON.stringify(successfulPythonBackend())
      );
      return { code: 1, stdout: '', stderr: 'current child failed' };
    }
  });

  assert.equal(backend.backend, 'python-native');
  assert.deepEqual(backend.counts, {
    total: GOLDEN_CASE_COUNT,
    passed: 0,
    failed: GOLDEN_CASE_COUNT,
    unexecuted: 0,
    expectedValidationRejections: 0
  });
  assert.equal(backend.process.exitCode, 1);
  assert.equal(backend.process.stderr, 'current child failed');
  assert.equal(isAcceptanceComplete(completionFixture(backend)), false);
  await fs.access(staleSummaryPath);
  await assert.rejects(fs.access(path.dirname(currentSummaryPath)), { code: 'ENOENT' });
});

test('python acceptance fails closed on missing and malformed current summaries', async t => {
  const { temporary, summaryDirectory } = await temporarySummaryDirectory(t);
  const runners = [
    async () => ({ code: 0, stdout: '', stderr: '' }),
    async (_python, arguments_) => {
      const summaryPath = arguments_[arguments_.indexOf('--summary') + 1];
      await fs.writeFile(summaryPath, '{ malformed');
      return { code: 0, stdout: '', stderr: '' };
    },
    async (_python, arguments_) => {
      const summaryPath = arguments_[arguments_.indexOf('--summary') + 1];
      await fs.writeFile(summaryPath, '{}');
      return { code: 0, stdout: '', stderr: '' };
    }
  ];
  for (const spawnRunner of runners) {
    const backend = await runPythonAcceptanceBackend({
      repoRoot: temporary,
      summaryDirectory,
      python: 'python',
      total: GOLDEN_CASE_COUNT,
      expectedValidationRejections: 1,
      spawnRunner
    });
    assert.equal(backend.backend, 'python-native');
    assert.equal(backend.counts.failed, GOLDEN_CASE_COUNT);
    assert.equal(backend.failures.length, 1);
    assert.equal(backend.process.exitCode, 0);
    assert.equal(isAcceptanceComplete(completionFixture(backend)), false);
  }
});

test('python acceptance fails closed on internally inconsistent summaries', async t => {
  const { temporary, summaryDirectory } = await temporarySummaryDirectory(t);
  const missingState = successfulPythonBackend();
  delete missingState.stateContracts.reset;
  const extraState = successfulPythonBackend();
  extraState.stateContracts.extra = true;
  const nonBooleanState = successfulPythonBackend();
  nonBooleanState.stateContracts.reset = 1;
  const missingExpectedRejection = successfulPythonBackend();
  missingExpectedRejection.counts.expectedValidationRejections = 0;
  missingExpectedRejection.expectedValidationRejections = [];
  const unexecutedMismatch = successfulPythonBackend();
  unexecutedMismatch.counts = {
    total: GOLDEN_CASE_COUNT,
    passed: GOLDEN_CASE_COUNT - 1,
    failed: 0,
    unexecuted: 1,
    expectedValidationRejections: 1
  };
  const summaries = [
    ['success counts with a nonempty failures array', {
      ...successfulPythonBackend(),
      failures: [{ reason: 'stale-failure' }]
    }],
    ['unexecuted count mismatch', unexecutedMismatch],
    ['missing state contract', missingState],
    ['extra state contract', extraState],
    ['non-boolean state contract', nonBooleanState],
    ['missing expected validation rejection', missingExpectedRejection]
  ];

  for (const [name, summary] of summaries) {
    await t.test(name, async () => {
      const backend = await runPythonAcceptanceBackend({
        repoRoot: temporary,
        summaryDirectory,
        python: 'python',
        total: GOLDEN_CASE_COUNT,
        expectedValidationRejections: 1,
        spawnRunner: async (_python, arguments_) => {
          const summaryPath = arguments_[arguments_.indexOf('--summary') + 1];
          await fs.writeFile(summaryPath, JSON.stringify(summary));
          return { code: 0, stdout: '', stderr: '' };
        }
      });
      assert.deepEqual(backend.counts, {
        total: GOLDEN_CASE_COUNT,
        passed: 0,
        failed: GOLDEN_CASE_COUNT,
        unexecuted: 0,
        expectedValidationRejections: 0
      });
      assert.equal(backend.failures.length, 1);
      assert.match(backend.failures[0].detail, /expected backend contract/);
      assert.equal(isAcceptanceComplete(completionFixture(backend)), false);
    });
  }
});

test('parallel python acceptance children use unique fresh summary paths', async t => {
  const { temporary, summaryDirectory } = await temporarySummaryDirectory(t);
  const summaryPaths = [];
  const spawnRunner = async (_python, arguments_) => {
    const summaryPath = arguments_[arguments_.indexOf('--summary') + 1];
    summaryPaths.push(summaryPath);
    await assert.rejects(fs.access(summaryPath), { code: 'ENOENT' });
    await fs.writeFile(summaryPath, JSON.stringify(successfulPythonBackend()));
    return { code: 0, stdout: '', stderr: '' };
  };
  const backends = await Promise.all([
    runPythonAcceptanceBackend({
      repoRoot: temporary,
      summaryDirectory,
      python: 'python',
      total: GOLDEN_CASE_COUNT,
      expectedValidationRejections: 1,
      spawnRunner
    }),
    runPythonAcceptanceBackend({
      repoRoot: temporary,
      summaryDirectory,
      python: 'python',
      total: GOLDEN_CASE_COUNT,
      expectedValidationRejections: 1,
      spawnRunner
    })
  ]);

  assert.equal(new Set(summaryPaths).size, 2);
  assert.equal(
    backends.every(backend => backend.counts.passed === GOLDEN_CASE_COUNT),
    true
  );
  assert.equal(
    backends.every(backend => backend.process.exitCode === 0),
    true
  );
  for (const summaryPath of summaryPaths) {
    await assert.rejects(fs.access(path.dirname(summaryPath)), { code: 'ENOENT' });
  }
});

test('wheel acceptance omits per-wheel summaries while candidate acceptance retains one', async () => {
  const runner = await fs.readFile(
    path.join(repoRoot, 'dsp', 'bindings', 'acceptance', 'python_golden_runner.py'),
    'utf8'
  );
  assert.match(runner, /parser\.add_argument\("--summary", type=Path\)/);
  assert.doesNotMatch(runner, /"--summary", type=Path, required=True/);
  for (const workflow of ['dsp-library-ci.yml', 'dsp-library-release.yml']) {
    const text = await fs.readFile(path.join(repoRoot, '.github', 'workflows', workflow), 'utf8');
    const wheelCommand = text.match(/CIBW_TEST_COMMAND:[\s\S]*?\n\s+with:/)?.[0] ?? '';
    assert.notEqual(wheelCommand, '');
    assert.doesNotMatch(wheelCommand, /--summary/);
    assert.match(text, /--summary \.tmp\/dsp-library-goldens-/);
  }
});

test('golden discovery reads only the generated frozen index paths', async t => {
  const temporary = await fs.realpath(await fs.mkdtemp(
    path.join(os.tmpdir(), 'effetune-frozen-goldens-')
  ));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const generated = path.join(temporary, 'dsp', 'bindings', 'generated');
  const included = path.join(
    temporary, 'dsp', 'plugins', 'included', 'golden'
  );
  const excluded = path.join(
    temporary, 'dsp', 'plugins', 'excluded', 'golden'
  );
  await Promise.all([
    fs.mkdir(generated, { recursive: true }),
    fs.mkdir(included, { recursive: true }),
    fs.mkdir(excluded, { recursive: true })
  ]);
  await Promise.all([
    fs.writeFile(
      path.join(generated, 'effects-v1.private.json'),
      JSON.stringify({
        effects: { Volume: { internalType: 'VolumePlugin' } },
        frozenGoldenIndexes: {
          'dsp/plugins/included/params.json':
            'dsp/plugins/included/golden/index.json'
        }
      })
    ),
    fs.writeFile(
      path.join(generated, 'effects-v1.json'),
      JSON.stringify({ effects: [{ type: 'Volume' }] })
    ),
    fs.writeFile(
      path.join(included, 'index.json'),
      JSON.stringify({ type: 'VolumePlugin', cases: ['case.json'] })
    ),
    fs.writeFile(
      path.join(included, 'case.json'),
      JSON.stringify({ binary: 'case.f32' })
    ),
    fs.writeFile(path.join(included, 'case.f32'), Uint8Array.of(0, 0, 0, 0)),
    fs.writeFile(path.join(excluded, 'index.json'), '{ malformed duplicate')
  ]);

  const { cases } = await discoverFrozenGoldenCases(temporary);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].publicType, 'Volume');
  assert.equal(cases[0].metadataPath, path.join(included, 'case.json'));

  for (const invalid of [
    ['../case.json'],
    ['/case.json'],
    ['C:\\case.json'],
    ['nested/case.json'],
    ['nested\\case.json'],
    ['case.json', 'case.json']
  ]) {
    await fs.writeFile(
      path.join(included, 'index.json'),
      JSON.stringify({ type: 'VolumePlugin', cases: invalid })
    );
    await assert.rejects(discoverFrozenGoldenCases(temporary), /Invalid|direct child/i);
  }

  await fs.writeFile(
    path.join(included, 'index.json'),
    JSON.stringify({ type: 'VolumePlugin', cases: ['case.json'] })
  );
  for (const invalid of [
    '../case.f32',
    '/case.f32',
    'C:\\case.f32',
    'nested/case.f32',
    'nested\\case.f32'
  ]) {
    await fs.writeFile(path.join(included, 'case.json'), JSON.stringify({ binary: invalid }));
    await assert.rejects(discoverFrozenGoldenCases(temporary), /Invalid|direct child/i);
  }

  await Promise.all([
    fs.writeFile(path.join(included, 'case.json'), JSON.stringify({ binary: 'case.f32' })),
    fs.writeFile(path.join(included, 'case-2.json'), JSON.stringify({ binary: 'case.f32' })),
    fs.writeFile(
      path.join(included, 'index.json'),
      JSON.stringify({ type: 'VolumePlugin', cases: ['case.json', 'case-2.json'] })
    )
  ]);
  await assert.rejects(discoverFrozenGoldenCases(temporary), /duplicate frozen golden binary/i);
});

test('frozen DSP library acceptance inventory stays complete', async () => {
  const { cases } = await discoverFrozenGoldenCases();
  const inventory = summarizeInventory(cases);
  assert.equal(inventory.effects, EFFECT_COUNT);
  assert.equal(inventory.total, GOLDEN_CASE_COUNT);
  assert.equal(inventory.assetCases, 20);
  assert.equal(inventory.eventCases, 127);
  assert.equal(inventory.eventCount, 442);
  assert.deepEqual(inventory.sampleRates, [
    32000,
    44100,
    48000,
    88200,
    96000,
    176400,
    192000,
    352800,
    384000
  ]);
  assert.deepEqual(inventory.channels, [1, 2, 4, 6, 8]);
  assert.deepEqual(inventory.blockSizes, [
    1,
    17,
    31,
    32,
    33,
    63,
    64,
    65,
    73,
    83,
    89,
    91,
    95,
    96,
    97,
    101,
    113,
    127,
    128,
    129,
    255,
    257,
    511,
    512,
    575
  ]);
});

test('public pattern metadata identifies only the binding-invalid frozen case', async () => {
  const { cases } = await discoverFrozenGoldenCases();
  const invalid = cases
    .map(testCase => ({
      case: `${testCase.publicType}/${testCase.metadata.id}`,
      expectation: expectedValidationRejection(testCase)
    }))
    .filter(item => item.expectation);
  assert.deepEqual(invalid, [{
    case: 'Matrix/malformed-routes-are-dropped',
    expectation: {
      parameter: 'matrixRoutes',
      reason: 'pattern-mismatch'
    }
  }]);
});

test('AudioWorklet plans retain compatible frozen golden contracts', async () => {
  const { cases } = await discoverFrozenGoldenCases();
  const plans = await chooseWorkletPlans(cases);
  assert.equal(plans.length, WORKLET_GOLDEN_CASE_COUNT);
  const validationPlans = plans.filter(plan => plan.expectedValidationRejection);
  assert.deepEqual(
    validationPlans.map(plan => ({
      case: `${plan.publicType}/${plan.caseId}`,
      expectation: plan.expectedValidationRejection
    })),
    [{
      case: 'Matrix/malformed-routes-are-dropped',
      expectation: {
        parameter: 'matrixRoutes',
        reason: 'pattern-mismatch'
      }
    }]
  );
  for (const plan of plans.filter(plan => !plan.expectedValidationRejection)) {
    assert.equal(Number.isInteger(plan.blockSize), true);
    assert.equal(Number.isInteger(plan.seed), true);
    assert.equal(plan.reference.length, plan.channels.length * plan.frames);
    assert.equal(typeof plan.tolerance, 'object');
  }
  const nonIdentityPlans = await chooseWorkletPlans(cases, {
    preferNonIdentity: true
  });
  assert.equal(nonIdentityPlans.length, NON_IDENTITY_EFFECT_COUNT);
  assert.equal(
    nonIdentityPlans.every(plan => plan.goldenDifference > 1e-7),
    true
  );
});

test('AudioWorklet validation plans require the public same-realm error class', async () => {
  const runner = await fs.readFile(
    path.join(repoRoot, 'tools', 'verify-dsp-library-goldens.mjs'),
    'utf8'
  );
  assert.match(
    runner,
    /const \[\{ ValidationError \}, \{ EffeTuneNode \}\] = await Promise\.all/
  );
  assert.match(
    runner,
    /plan\.expectedValidationRejection &&\s+error instanceof ValidationError/
  );
  assert.doesNotMatch(
    runner,
    /plan\.expectedValidationRejection &&\s+error\?\.name === 'ValidationError'/
  );
});

test('acceptance completion fails closed on missing or shrunk backend results', () => {
  const backend = (name, total) => ({
    backend: name,
    counts: {
      total,
      passed: total,
      failed: 0,
      unexecuted: 0,
      expectedValidationRejections: 1
    },
    stateContracts: name === 'python-native'
      ? {
          sameSeed: true,
          differentSeed: true,
          reset: true,
          closeIdempotent: true,
          closedRejects: true
        }
      : {
          sameSeed: true,
          differentSeed: true,
          closeIdempotent: true,
          closedRejects: true,
          statefulStream: true
        }
  });
  const worklet = (prefix = '') => ({
    status: 'completed',
    variants: ['baseline', 'simd'].map(variant => ({
      backend: `chromium-audioworklet-${prefix}${variant}`,
      counts: {
        total: prefix ? NON_IDENTITY_EFFECT_COUNT : WORKLET_GOLDEN_CASE_COUNT,
        passed: prefix ? NON_IDENTITY_EFFECT_COUNT : WORKLET_GOLDEN_CASE_COUNT,
        failed: 0,
        unexecuted: 0,
        expectedValidationRejections: prefix ? 0 : 1
      }
    }))
  });
  const complete = {
    backends: [
      backend('python-native', GOLDEN_CASE_COUNT),
      backend('javascript-baseline', GOLDEN_CASE_COUNT),
      backend('javascript-simd', GOLDEN_CASE_COUNT)
    ],
    workletGolden: worklet(),
    workletNonIdentity: worklet('nonidentity-')
  };
  assert.equal(isAcceptanceComplete(complete), true);
  assert.equal(isAcceptanceComplete({}), false);
  assert.equal(isAcceptanceComplete({ ...complete, backends: [] }), false);
  assert.equal(
    isAcceptanceComplete({
      ...complete,
      backends: [
        backend('python-native', GOLDEN_CASE_COUNT - 1),
        backend('javascript-baseline', GOLDEN_CASE_COUNT),
        backend('javascript-simd', GOLDEN_CASE_COUNT)
      ]
    }),
    false
  );
  assert.equal(
    isAcceptanceComplete({
      ...complete,
      workletGolden: {
        ...complete.workletGolden,
        variants: [complete.workletGolden.variants[0]]
      }
    }),
    false
  );
  for (const contracts of [
    {
      sameSeed: true,
      differentSeed: true,
      reset: true,
      closeIdempotent: true
    },
    {
      sameSeed: true,
      differentSeed: true,
      renamedReset: true,
      closeIdempotent: true,
      closedRejects: true
    },
    {
      sameSeed: true,
      differentSeed: true,
      reset: true,
      closeIdempotent: true,
      closedRejects: true,
      extra: true
    }
  ]) {
    assert.equal(isAcceptanceComplete({
      ...complete,
      backends: [
        { ...backend('python-native', GOLDEN_CASE_COUNT), stateContracts: contracts },
        backend('javascript-baseline', GOLDEN_CASE_COUNT),
        backend('javascript-simd', GOLDEN_CASE_COUNT)
      ]
    }), false);
  }
});
