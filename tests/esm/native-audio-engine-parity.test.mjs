import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  builtExecutableDirectory, executableNames, requireExecutableEnv,
} from '../../tools/audio-engine-session.mjs';
import { findParamsSchema, readParamsSchema, readPluginManifest } from '../../tools/dsp-parity/cases.mjs';
import { compareAudio, formatComparison } from '../../tools/dsp-parity/tolerance.mjs';
import { withNativeWorkletParity } from '../helpers/native-audio-engine-parity.mjs';

const frames = 1024;
let catalog;

function catalogSchemas() {
  catalog ??= readPluginManifest().then(plugins => Promise.all(plugins
    .filter(plugin => plugin.type !== 'SectionPlugin')
    .map(async plugin => {
      const schema = await readParamsSchema(new URL(`../../dsp/plugins/${plugin.path}/params.json`, import.meta.url));
      return { type: plugin.type, tolerance: schema.tolerance };
    })));
  return catalog;
}

function inputFor(channels, origin = 0) {
  return Float32Array.from({ length: frames * channels }, (_, index) => {
    const channel = Math.floor(index / frames);
    const frame = index % frames + origin;
    return Math.sin(frame * (0.11 + channel * 0.027)) * (0.18 + channel * 0.05);
  });
}

async function pipelineTolerance(plugins) {
  const types = new Set(plugins.filter(plugin => plugin.type !== 'SectionPlugin').map(plugin => plugin.type));
  const tolerances = await Promise.all([...types].map(async type => {
    const path = await findParamsSchema(type);
    return path ? (await readParamsSchema(path)).tolerance : undefined;
  }));
  const declared = tolerances.filter(Boolean);
  const policy = declared.some(tolerance => tolerance.policy === 'spectral') ? 'spectral' : 'per-sample';
  const comparable = declared.filter(tolerance => (tolerance.policy ?? 'per-sample') === policy);
  assert.ok(comparable.length, 'the DSP parameters must declare a parity tolerance');
  const fields = policy === 'spectral' ? ['db', 'floorDb', 'fftSize'] : ['abs', 'rel'];
  const aggregate = { policy };
  for (const field of fields) {
    const values = comparable.map(tolerance => tolerance[field]).filter(value => value !== undefined);
    if (values.length) aggregate[field] = Math.max(...values);
  }
  return aggregate;
}

function assertParity({ expected, actual }, tolerance, channels) {
  assert.ok(expected.every(Number.isFinite), 'the reference worklet must emit finite samples');
  assert.ok(actual.every(Number.isFinite), 'the native engine must emit finite samples');
  const comparison = compareAudio(expected, actual, tolerance, { channels, frames });
  assert.ok(comparison.pass, formatComparison(comparison));
}

for (const name of Object.values(executableNames(process.platform, process.arch)).filter(Boolean)) {
  test(`${name} matches the SIMD worklet on representative pipeline routes`, async context => {
    const executable = join(builtExecutableDirectory(), name);
    if (!existsSync(executable)) {
      const message = `Native audio engine executable is missing: ${executable}. Run npm run build:audio-engine.`;
      if (process.env[requireExecutableEnv] === '1') assert.fail(message);
      context.skip(message);
      return;
    }

    await context.test('volume and parameter update', async () => {
      const channels = 2;
      const volume = { id: 1, type: 'VolumePlugin', parameters: { vl: -7.25 } };
      const plugins = [volume];
      const tolerance = await pipelineTolerance(plugins);
      await withNativeWorkletParity(executable, { plugins, channels }, async harness => {
        const input = inputFor(channels);
        const result = await harness.render(input);
        assert.notEqual(result.expected[1], input[1]);
        assertParity(result, tolerance, channels);
        await harness.update({ ...volume, parameters: { vl: -15.5 } });
        assertParity(await harness.render(inputFor(channels, frames)), tolerance, channels);
      });
    });

    await context.test('buses, multichannel selection, disabled stages and section gates', async () => {
      const channels = 4;
      const plugins = [
        { id: 1, type: 'PolarityInversionPlugin', outputBus: 1 },
        { id: 2, type: 'PolarityInversionPlugin', inputBus: 1, channel: '34' },
        { id: 3, type: 'MutePlugin', channel: 'R', enabled: false },
        { id: 4, type: 'SectionPlugin', enabled: false },
        { id: 5, type: 'MutePlugin', channel: 'L' },
        { id: 6, type: 'SectionPlugin', enabled: true },
        { id: 7, type: 'VolumePlugin', channel: '3', parameters: { vl: -4 } },
      ];
      const tolerance = await pipelineTolerance(plugins);
      await withNativeWorkletParity(executable, { plugins, channels }, async harness => {
        assertParity(await harness.render(inputFor(channels)), tolerance, channels);
      });
    });

    await context.test('master bypass', async () => {
      const channels = 2;
      const plugins = [{ id: 1, type: 'MutePlugin' }];
      const tolerance = await pipelineTolerance(plugins);
      await withNativeWorkletParity(executable, { plugins, channels, masterBypass: true }, async harness => {
        assertParity(await harness.render(inputFor(channels)), tolerance, channels);
      });
    });

    await context.test('lookahead compensation at a bus merge and final output delay', async () => {
      const channels = 2;
      const plugins = [
        { id: 1, type: 'VolumePlugin', outputBus: 1, parameters: { vl: -4 } },
        { id: 2, type: 'BrickwallLimiterPlugin', inputBus: 1, parameters: { la: 3 } },
      ];
      const tolerance = await pipelineTolerance(plugins);
      await withNativeWorkletParity(executable, { plugins, channels, outputDelay: 64 }, async harness => {
        assertParity(await harness.render(inputFor(channels)), tolerance, channels);
      });
    });

    await context.test('default parameters for the registered plugin catalog', async group => {
      const channels = 2;
      const input = inputFor(channels);
      for (const { type, tolerance } of await catalogSchemas()) {
        await group.test(type, async () => {
          await withNativeWorkletParity(executable, { plugins: [{ id: 1, type }], channels }, async harness => {
            assertParity(await harness.render(input), tolerance, channels);
          });
        });
      }
    });
  });
}
