import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createQuantumTimingAccumulator,
  evaluateG726RealtimeGate,
  preflightArtifactDirectory,
  runBenchCli,
  runBenchmarks
} from '../../tools/dsp-parity/bench.mjs';
import { sourceDigest } from '../../scripts/build-dsp-wasm.mjs';
import { discoverCasePlan } from '../../tools/dsp-parity/cases.mjs';
import {
  analyzeG726QuantumWork,
  evaluateG726AggregateCpuGate
} from '../../tools/dsp-parity/g726-cpu-gate.mjs';
import {
  activePipelinePlugins,
  paramsLayoutHash,
  runWasmCase,
  runWasmPipelineCase,
  WASM_PIPELINE_TELEMETRY_BYTES
} from '../../tools/dsp-parity/runners.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('scratch artifact preflight binds metadata to both artifact registries', async t => {
  const artifactRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-artifacts-'));
  t.after(() => fs.rm(artifactRoot, { recursive: true, force: true }));
  const committedRoot = path.join(repoRoot, 'plugins', 'dsp');
  const metadata = JSON.parse(await fs.readFile(
    path.join(committedRoot, 'effetune-dsp.meta.json'),
    'utf8'
  ));
  metadata.sourceDigest = sourceDigest();
  await Promise.all([
    fs.copyFile(
      path.join(committedRoot, 'effetune-dsp.wasm'),
      path.join(artifactRoot, 'effetune-dsp.wasm')
    ),
    fs.copyFile(
      path.join(committedRoot, 'effetune-dsp.simd.wasm'),
      path.join(artifactRoot, 'effetune-dsp.simd.wasm')
    ),
    fs.writeFile(path.join(artifactRoot, 'effetune-dsp.meta.json'), JSON.stringify(metadata))
  ]);

  const result = await preflightArtifactDirectory(artifactRoot, repoRoot);
  assert.equal(result.kernels.size, metadata.kernels.length);

  const invented = structuredClone(metadata);
  invented.kernels[0] = { ...invented.kernels[0], name: 'FixturePlugin' };
  await fs.writeFile(
    path.join(artifactRoot, 'effetune-dsp.meta.json'),
    JSON.stringify(invented)
  );
  await assert.rejects(
    () => preflightArtifactDirectory(artifactRoot, repoRoot),
    /does not match the artifact kernel registry/
  );

  metadata.sourceDigest = `sha256:${'0'.repeat(64)}`;
  await fs.writeFile(
    path.join(artifactRoot, 'effetune-dsp.meta.json'),
    JSON.stringify(metadata)
  );
  await assert.rejects(
    () => preflightArtifactDirectory(artifactRoot, repoRoot),
    /source digest mismatch/
  );
});

test('quantum timing uses a bounded histogram and conservative p99', () => {
  const timing = createQuantumTimingAccumulator();
  for (let index = 0; index < 99; index++) {
    timing.observe({ elapsedMilliseconds: 0.099, blockFrames: 128, sampleRate: 48000 });
  }
  timing.observe({ elapsedMilliseconds: 3, blockFrames: 128, sampleRate: 48000 });
  const result = timing.result();
  assert.equal(result.buildType, 'Release');
  assert.equal(result.quantumCount, 100);
  assert.equal(result.p99Percent, 3.75);
  assert.equal(result.deadlineMisses, 1);
  assert.ok(result.maxPercent > 112 && result.maxPercent < 113);
  assert.ok(result.histogram.bins.length <= 401);
  assert.equal(result.histogram.bins.at(-1).upperBoundPercent, null);
});

test('quantum timing excludes warmup runs and is exposed by WASM benchmarks', async t => {
  const fixtureRoot = await createFixture(t);
  let calls = 0;
  const result = await runBenchmarks(benchmarkOptions(fixtureRoot, {
    type: 'PortedFirstPlugin',
    modes: ['wasm'],
    warmup: 1,
    repetitions: 2,
    quantumStats: true,
    implementations: {
      async runWasmCase({ input, onProcess }) {
        calls++;
        onProcess?.({ elapsedMilliseconds: 0.01, blockFrames: 4, sampleRate: 8000 });
        onProcess?.({ elapsedMilliseconds: 0.02, blockFrames: 4, sampleRate: 8000 });
        return input;
      }
    }
  }));

  assert.equal(calls, 3);
  assert.equal(result.quantumStats, true);
  assert.equal(result.results[0].quantumStats.quantumCount, 4);
  assert.equal(result.results[0].quantumStats.deadlineMisses, 0);
});

test('per-instance WASM deadline timing uses a high-resolution wall clock', async () => {
  const schema = (await discoverCasePlan({ type: 'VolumePlugin', repoRoot })).schema;
  const observations = [];
  await runWasmCase({
    type: 'VolumePlugin',
    testCase: {
      sampleRate: 48000,
      channels: 2,
      frames: 8,
      blockSize: 4,
      seed: 0xeffe7a5en,
      params: { vl: -6 },
      events: []
    },
    input: new Float32Array(16),
    schema,
    repoRoot,
    onProcess(observation) { observations.push(observation); }
  });

  assert.equal(observations.length, 2);
  assert.ok(observations.every(observation =>
    observation.clock === 'high-resolution-wall' && observation.elapsedMilliseconds >= 0
  ));
});

test('per-instance WASM timing warmup is excluded and reset before measured audio', async () => {
  const schema = (await discoverCasePlan({ type: 'VolumePlugin', repoRoot })).schema;
  const observations = [];
  const batchBoundaries = [];
  const input = Float32Array.from({ length: 16 }, (_, index) => (index + 1) * 0.01);
  const output = await runWasmCase({
    type: 'VolumePlugin',
    testCase: {
      sampleRate: 48000,
      channels: 2,
      frames: 8,
      blockSize: 4,
      seed: 0xeffe7a5en,
      params: { vl: 0 },
      events: []
    },
    input,
    schema,
    repoRoot,
    processWarmupCalls: 3,
    onProcess(observation) { observations.push(observation); },
    onProcessBatchBoundary({ phase }) { batchBoundaries.push(phase); }
  });

  assert.equal(observations.length, 2);
  assert.deepEqual(batchBoundaries, ['start', 'end']);
  assert.deepEqual(output, input);
});

function parameterSchema(type) {
  return {
    type,
    fields: [{ name: 'amount', key: 'amount', kind: 'float', min: 0, max: 2, default: 1 }]
  };
}

async function createFixture(t) {
  const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-dsp-hybrid-bench-'));
  t.after(() => fs.rm(repoRoot, { recursive: true, force: true }));

  const schemas = {
    PortedFirstPlugin: parameterSchema('PortedFirstPlugin'),
    PortedLastPlugin: parameterSchema('PortedLastPlugin'),
    LegacyWithSchemaPlugin: parameterSchema('LegacyWithSchemaPlugin'),
    BrokenHashPlugin: parameterSchema('BrokenHashPlugin')
  };
  const pluginEntries = [
    ['control/section', 'Section', 'SectionPlugin'],
    ['fixture/broken_hash', 'Broken Hash', 'BrokenHashPlugin'],
    ['fixture/legacy_no_schema', 'Legacy No Schema', 'LegacyNoSchemaPlugin'],
    ['fixture/legacy_with_schema', 'Legacy With Schema', 'LegacyWithSchemaPlugin'],
    ['fixture/ported_first', 'Ported First', 'PortedFirstPlugin'],
    ['fixture/ported_last', 'Ported Last', 'PortedLastPlugin'],
    ['fixture/ported_missing_schema', 'Ported Missing Schema', 'PortedMissingSchemaPlugin']
  ];

  await Promise.all([
    fs.mkdir(path.join(repoRoot, 'plugins', 'dsp'), { recursive: true }),
    fs.mkdir(path.join(repoRoot, 'dsp'), { recursive: true }),
    ...Object.keys(schemas).map(type => {
      const entry = pluginEntries.find(([, , entryType]) => entryType === type);
      return fs.mkdir(path.join(repoRoot, 'dsp', 'plugins', entry[0]), { recursive: true });
    })
  ]);

  await Promise.all([
    fs.writeFile(path.join(repoRoot, 'plugins', 'plugins.txt'), pluginEntries
      .map(([pluginPath, name, type]) => `${pluginPath}: ${name} | Fixture | ${type}`)
      .join('\n')),
    fs.writeFile(path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.meta.json'), JSON.stringify({
      abiVersion: 1,
      kernels: [
        { name: 'PortedFirstPlugin', hash: paramsLayoutHash(schemas.PortedFirstPlugin) },
        { name: 'PortedLastPlugin', hash: paramsLayoutHash(schemas.PortedLastPlugin) },
        { name: 'PortedMissingSchemaPlugin', hash: 123 },
        { name: 'BrokenHashPlugin', hash: (paramsLayoutHash(schemas.BrokenHashPlugin) + 1) >>> 0 }
      ]
    })),
    fs.writeFile(path.join(repoRoot, 'dsp', 'registry.inc'), [
      'EFFETUNE_PLUGIN(BrokenHashPlugin, fixture/broken_hash)',
      'EFFETUNE_PLUGIN(PortedFirstPlugin, fixture/ported_first)',
      'EFFETUNE_PLUGIN(PortedLastPlugin, fixture/ported_last)',
      'EFFETUNE_PLUGIN(PortedMissingSchemaPlugin, fixture/ported_missing_schema)'
    ].join('\n')),
    fs.writeFile(path.join(repoRoot, 'mixed.json'), JSON.stringify({
      pipeline: [
        { type: 'PortedFirstPlugin', parameters: { amount: 1.1 } },
        { type: 'LegacyNoSchemaPlugin', parameters: { amount: 1.2 } },
        { type: 'LegacyWithSchemaPlugin', parameters: { amount: 1.3 } },
        { type: 'PortedLastPlugin', parameters: { amount: 1.4 } }
      ]
    })),
    fs.writeFile(path.join(repoRoot, 'ported-only.json'), JSON.stringify({
      pipeline: [{ type: 'PortedFirstPlugin', parameters: { amount: 1.5 } }]
    })),
    fs.writeFile(path.join(repoRoot, 'pipeline-single-call.json'), JSON.stringify({
      pipeline: [
        {
          type: 'PortedFirstPlugin',
          enabled: true,
          inputBus: 1,
          outputBus: 2,
          channel: 'L',
          parameters: { amount: 1.1 }
        },
        { type: 'LegacyNoSchemaPlugin', enabled: false },
        { type: 'SectionPlugin', enabled: false },
        { type: 'LegacyWithSchemaPlugin', enabled: true },
        { type: 'SectionPlugin', enabled: true },
        {
          type: 'PortedLastPlugin',
          enabled: true,
          inputBus: 3,
          outputBus: 4,
          channel: 'A',
          parameters: { amount: 1.4 }
        }
      ]
    })),
    fs.writeFile(path.join(repoRoot, 'broken-hash.json'), JSON.stringify({
      pipeline: [{ type: 'BrokenHashPlugin' }]
    })),
    ...Object.entries(schemas).map(([type, schema]) => {
      const entry = pluginEntries.find(([, , entryType]) => entryType === type);
      return fs.writeFile(path.join(repoRoot, 'dsp', 'plugins', entry[0], 'params.json'), JSON.stringify(schema));
    })
  ]);

  return repoRoot;
}

function benchmarkOptions(repoRoot, overrides = {}) {
  return {
    repoRoot,
    sampleRates: [8000],
    channelCounts: [1],
    durationSeconds: 0.001,
    blockSize: 4,
    warmup: 0,
    repetitions: 1,
    log() {},
    ...overrides
  };
}

test('hybrid preset modes preserve mixed order and keep adjacent unsupported plugins in JS', async t => {
  const repoRoot = await createFixture(t);

  for (const mode of ['wasm', 'simd', 'native']) {
    await t.test(mode, async () => {
      const calls = [];
      const createdSessions = [];
      const result = await runBenchmarks(benchmarkOptions(repoRoot, {
        preset: 'mixed.json',
        modes: [mode],
        implementations: {
          async createReferenceSession(type) {
            createdSessions.push(type);
            return {
              async process(audio) {
                calls.push(`js:${type}`);
                return audio;
              }
            };
          },
          async runWasmCase({ type, input, variant }) {
            calls.push(`${variant}:${type}`);
            return input;
          },
          async runNativeCase({ type, input }) {
            calls.push(`native:${type}`);
            return input;
          }
        }
      }));

      const external = mode === 'native' ? 'native' : (mode === 'simd' ? 'simd' : 'baseline');
      assert.deepEqual(createdSessions, ['LegacyNoSchemaPlugin', 'LegacyWithSchemaPlugin']);
      assert.deepEqual(calls, [
        `${external}:PortedFirstPlugin`,
        'js:LegacyNoSchemaPlugin',
        'js:LegacyWithSchemaPlugin',
        `${external}:PortedLastPlugin`
      ]);
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].mode, mode);
    });
  }
});

test('normal preset modes omit enabled plugins gated by disabled sections', async t => {
  const repoRoot = await createFixture(t);

  for (const mode of ['js', 'native', 'wasm', 'simd']) {
    await t.test(mode, async () => {
      const calls = [];
      const createdSessions = [];
      await runBenchmarks(benchmarkOptions(repoRoot, {
        preset: 'pipeline-single-call.json',
        modes: [mode],
        implementations: {
          async createReferenceSession(type) {
            createdSessions.push(type);
            return {
              async process(audio) {
                calls.push(`js:${type}`);
                return audio;
              }
            };
          },
          async runWasmCase({ type, input, variant }) {
            calls.push(`${variant}:${type}`);
            return input;
          },
          async runNativeCase({ type, input }) {
            calls.push(`native:${type}`);
            return input;
          }
        }
      }));

      if (mode === 'js') {
        assert.deepEqual(createdSessions, ['PortedFirstPlugin', 'PortedLastPlugin']);
        assert.deepEqual(calls, ['js:PortedFirstPlugin', 'js:PortedLastPlugin']);
      } else {
        const external = mode === 'native' ? 'native' : (mode === 'simd' ? 'simd' : 'baseline');
        assert.deepEqual(createdSessions, []);
        assert.deepEqual(calls, [
          `${external}:PortedFirstPlugin`,
          `${external}:PortedLastPlugin`
        ]);
      }
    });
  }
});

test('a metadata-listed kernel with a broken schema hash cannot silently use JS', async t => {
  const repoRoot = await createFixture(t);
  let referenceSessions = 0;
  let wasmCalls = 0;

  await assert.rejects(
    () => runBenchmarks(benchmarkOptions(repoRoot, {
      preset: 'broken-hash.json',
      modes: ['wasm'],
      implementations: {
        async createReferenceSession() {
          referenceSessions++;
          return { async process(audio) { return audio; } };
        },
        async runWasmCase({ input }) {
          wasmCalls++;
          return input;
        }
      }
    })),
    /DSP parameter hash mismatch for benchmark plugin BrokenHashPlugin/
  );
  assert.equal(referenceSessions, 0);
  assert.equal(wasmCalls, 0);
});

test('an eligible ported kernel runner failure propagates without a JS retry', async t => {
  const repoRoot = await createFixture(t);
  const referenceTypes = [];
  let wasmCalls = 0;

  await assert.rejects(
    () => runBenchmarks(benchmarkOptions(repoRoot, {
      preset: 'ported-only.json',
      modes: ['wasm'],
      implementations: {
        async createReferenceSession(type) {
          referenceTypes.push(type);
          return { async process(audio) { return audio; } };
        },
        async runWasmCase() {
          wasmCalls++;
          throw new Error('broken ported kernel');
        }
      }
    })),
    /broken ported kernel/
  );
  assert.deepEqual(referenceTypes, []);
  assert.equal(wasmCalls, 1);
});

test('single-type external benchmarks remain strict about kernels and schemas', async t => {
  const repoRoot = await createFixture(t);
  let referenceSessions = 0;
  const implementations = {
    async createReferenceSession() {
      referenceSessions++;
      return { async process(audio) { return audio; } };
    }
  };

  for (const mode of ['wasm', 'native']) {
    await assert.rejects(
      () => runBenchmarks(benchmarkOptions(repoRoot, {
        type: 'LegacyWithSchemaPlugin', modes: [mode], implementations
      })),
      mode === 'native' ? /No native DSP registry kernel/ : /No committed DSP metadata kernel/
    );
    await assert.rejects(
      () => runBenchmarks(benchmarkOptions(repoRoot, {
        type: 'PortedMissingSchemaPlugin', modes: [mode], implementations
      })),
      /No params\.json was found for benchmark plugin PortedMissingSchemaPlugin/
    );
  }
  assert.equal(referenceSessions, 0);
});

test('single-call presets preserve descriptor semantics and use one strict pipeline runner', async t => {
  const fixtureRoot = await createFixture(t);
  const calls = [];
  let perInstanceCalls = 0;
  const result = await runBenchmarks(benchmarkOptions(fixtureRoot, {
    preset: 'pipeline-single-call.json',
    modes: ['wasm'],
    singleCall: true,
    implementations: {
      async runWasmPipelineCase({ pipeline, schemas, variant, input }) {
        const active = activePipelinePlugins(pipeline);
        calls.push({ pipeline, active, schemas, variant });
        return input;
      },
      async runWasmCase() {
        perInstanceCalls++;
        throw new Error('per-instance runner must not be used');
      }
    }
  }));

  assert.equal(calls.length, 1);
  assert.equal(perInstanceCalls, 0);
  assert.equal(calls[0].variant, 'baseline');
  assert.deepEqual(calls[0].active.map(plugin => plugin.definition.type), [
    'PortedFirstPlugin',
    'PortedLastPlugin'
  ]);
  assert.deepEqual(
    calls[0].active.map(plugin => ({
      inputBus: plugin.inputBus,
      outputBus: plugin.outputBus,
      channel: plugin.channel
    })),
    [
      { inputBus: 1, outputBus: 2, channel: 'L' },
      { inputBus: 3, outputBus: 4, channel: 'A' }
    ]
  );
  assert.deepEqual([...calls[0].schemas.keys()], ['PortedFirstPlugin', 'PortedLastPlugin']);
  assert.equal(result.singleCall, true);
  assert.equal(result.results[0].singleCall, true);
});

test('single-call presets reject active hybrid fallbacks and unsupported modes', async t => {
  const fixtureRoot = await createFixture(t);
  await assert.rejects(
    () => runBenchmarks(benchmarkOptions(fixtureRoot, {
      preset: 'mixed.json', modes: ['wasm'], singleCall: true
    })),
    /requires every active preset plugin.*LegacyNoSchemaPlugin/
  );
  await assert.rejects(
    () => runBenchmarks(benchmarkOptions(fixtureRoot, {
      preset: 'ported-only.json', modes: ['native'], singleCall: true
    })),
    /supports only --modes wasm,simd/
  );
  await assert.rejects(
    () => runBenchmarks(benchmarkOptions(fixtureRoot, {
      type: 'PortedFirstPlugin', modes: ['wasm'], singleCall: true
    })),
    /requires --preset/
  );
});

test('WASM single-call runner configures once and processes once per quantum', async () => {
  const schema = (await discoverCasePlan({ type: 'VolumePlugin', repoRoot })).schema;
  const plugin = {
    definition: { type: 'VolumePlugin' },
    enabled: true,
    inputBus: 0,
    outputBus: 0,
    channel: null,
    params: { vl: -6 }
  };
  const input = Float32Array.from({ length: 10 }, (_, index) => (index + 1) * 0.05);
  const calls = [];
  const output = await runWasmPipelineCase({
    pipeline: [plugin],
    schemas: new Map([['VolumePlugin', schema]]),
    testCase: {
      sampleRate: 48000,
      channels: 2,
      frames: 5,
      blockSize: 2,
      seed: 0xeffe7a5en
    },
    input,
    repoRoot,
    onCall(name, details) { calls.push([name, details]); }
  });

  assert.deepEqual(calls.map(([name]) => name), [
    'et_engine_prepare',
    'et_pipeline_configure',
    'et_pipeline_process',
    'et_pipeline_process',
    'et_pipeline_process'
  ]);
  assert.deepEqual(calls[0][1], {
    preparedFrames: 32,
    telemetryBytes: 256 * 1024
  });
  assert.equal(calls[0][1].telemetryBytes, WASM_PIPELINE_TELEMETRY_BYTES);
  assert.deepEqual(calls.slice(2).map(([, details]) => details.blockFrames), [2, 2, 1]);
  assert.equal(output.length, input.length);
  assert.ok(output.every(Number.isFinite));
  assert.notDeepEqual(output, input);
});

test('benchmark help describes preset hybrid and single-type strict behavior', async () => {
  const messages = [];
  const result = await runBenchCli(['--help'], { log(message) { messages.push(message); } });
  assert.equal(result.help, true);
  assert.match(messages.join('\n'), /Preset external modes keep pipeline order/);
  assert.match(messages.join('\n'), /--single-call/);
  assert.match(messages.join('\n'), /Single-call presets require every active plugin/);
  assert.match(messages.join('\n'), /Single --type external modes require a matching schema and kernel/);
});

test('G.726 realtime gate applies strict average, p99, max, and deadline thresholds', () => {
  const benchmark = {
    results: [
      {
        mode: 'wasm', sampleRate: 96000, channels: 2,
        quantumStats: {
          averagePercent: 14.99, p99Percent: 49.99, maxPercent: 79.99, deadlineMisses: 0
        }
      },
      {
        mode: 'simd', sampleRate: 384000, channels: 2,
        quantumStats: {
          averagePercent: 15, p99Percent: 20, maxPercent: 30, deadlineMisses: 0
        }
      }
    ]
  };
  const result = evaluateG726RealtimeGate(benchmark, {
    powerMode: 'test',
    artifactProvenance: { sourceDigest: 'test' }
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks[0].trials[0].failures, []);
  assert.deepEqual(result.checks[1].trials[0].failures, ['averagePercent']);
  assert.equal(result.configuration.blockSize, 128);
  assert.equal(result.configuration.repetitions, 3);
});

test('G.726 realtime gate rejects any deadline miss across the complete formal run', () => {
  const passingTiming = {
    averagePercent: 5, p99Percent: 7, maxPercent: 20, deadlineMisses: 0
  };
  const benchmark = {
    results: [{
      mode: 'wasm', sampleRate: 384000, channels: 2,
      quantumStats: {
        averagePercent: 5, p99Percent: 7, maxPercent: 120, deadlineMisses: 1
      },
      quantumTrials: [
        passingTiming,
        passingTiming,
        { averagePercent: 5, p99Percent: 7, maxPercent: 120, deadlineMisses: 1 }
      ]
    }]
  };
  const result = evaluateG726RealtimeGate(benchmark, {
    powerMode: 'test',
    artifactProvenance: { sourceDigest: 'test' }
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks[0].failures, ['maxPercent', 'deadlineMisses']);
});

const G726_CPU_WORK_EXPECTED = new Map([
  [96000, {
    ticks: [10, 11, 10.666666666666666],
    wet: [120, 132],
    ratio: 1.4359937480362266
  }],
  [352800, {
    ticks: [2, 3, 2.90250096749226],
    wet: [88, 136],
    ratio: 1.400603650655766
  }],
  [384000, {
    ticks: [2, 3, 2.6666666666666665],
    wet: [96, 144],
    ratio: 1.4603537567473572
  }]
]);

test('G.726 static work analysis fixes the formal quantum schedule and conservative ratios', () => {
  for (const [sampleRate, expected] of G726_CPU_WORK_EXPECTED) {
    const result = analyzeG726QuantumWork(sampleRate);
    assert.equal(result.codecTicks.minimum, expected.ticks[0]);
    assert.equal(result.codecTicks.maximum, expected.ticks[1]);
    assert.ok(Math.abs(result.codecTicks.average - expected.ticks[2]) < 1e-12);
    assert.equal(result.wetOutputs.minimum, expected.wet[0]);
    assert.equal(result.wetOutputs.maximum, expected.wet[1]);
    assert.ok(Math.abs(result.maxWorkToAverageWorkRatio - expected.ratio) < 1e-12);
    assert.ok(result.maxWorkToAverageWorkRatio < 1.5);
  }
});

function g726FormalCpuTrials(totalMicroseconds = 1000000) {
  const trials = [];
  for (const mode of ['wasm', 'simd']) {
    for (const sampleRate of G726_CPU_WORK_EXPECTED.keys()) {
      const work = analyzeG726QuantumWork(sampleRate);
      for (let repetition = 1; repetition <= 3; repetition++) {
        trials.push({
          mode,
          sampleRate,
          repetition,
          renderedDurationSeconds: work.renderedDurationSeconds,
          cpu: { totalMicroseconds }
        });
      }
    }
  }
  return trials;
}

test('G.726 aggregate CPU gate adds one clock quantum and models every trial tail', () => {
  const workAnalysis = [...G726_CPU_WORK_EXPECTED.keys()].map(
    sampleRate => analyzeG726QuantumWork(sampleRate)
  );
  const result = evaluateG726AggregateCpuGate({
    trials: g726FormalCpuTrials(),
    workAnalysis,
    clockQuantumMicroseconds: 15625
  });
  assert.equal(result.passed, true);
  assert.equal(result.quantizationAllowanceMicroseconds, 16000);
  assert.equal(result.checks.length, 18);
  const first = result.checks[0];
  const expectedWorst =
    (1000000 + 16000) / (first.renderedDurationSeconds * 1000000) * 100 *
    first.maxWorkToAverageWorkRatio;
  assert.ok(Math.abs(first.modeledWorstFramePercent - expectedWorst) < 1e-12);
  assert.ok(result.checks.every(check =>
    check.rawAveragePercent < check.quantizationAdjustedAveragePercent &&
    check.quantizationAdjustedAveragePercent < check.modeledWorstFramePercent &&
    check.modeledDeadlineMisses === 0
  ));
});

test('G.726 aggregate CPU gate rejects one trial at the strict average boundary', () => {
  const workAnalysis = [...G726_CPU_WORK_EXPECTED.keys()].map(
    sampleRate => analyzeG726QuantumWork(sampleRate)
  );
  const trials = g726FormalCpuTrials();
  trials[7].cpu.totalMicroseconds = 4500000;
  const result = evaluateG726AggregateCpuGate({
    trials,
    workAnalysis,
    clockQuantumMicroseconds: 16000
  });
  assert.equal(result.passed, false);
  assert.deepEqual(result.checks[7].failures, ['averagePercent']);
});
