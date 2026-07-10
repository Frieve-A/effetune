import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBenchCli, runBenchmarks } from '../../tools/dsp-parity/bench.mjs';
import { discoverCasePlan } from '../../tools/dsp-parity/cases.mjs';
import {
  activePipelinePlugins,
  paramsLayoutHash,
  runWasmPipelineCase,
  WASM_PIPELINE_TELEMETRY_BYTES
} from '../../tools/dsp-parity/runners.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

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
