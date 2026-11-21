import assert from 'node:assert/strict';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { withNativeWorkletParity } from '../tests/helpers/native-audio-engine-parity.mjs';
import { builtExecutableDirectory, executableNames, protocolVersion, withAudioEngine } from './audio-engine-session.mjs';

assert.equal(process.platform, 'win32', 'Measure on the Windows development machine.');
assert.equal(process.arch, 'x64');

const { baseline, v3 } = executableNames(process.platform, process.arch);
const baselinePath = join(builtExecutableDirectory(), baseline);
const v3Path = join(builtExecutableDirectory(), v3);
const nativePeriod = await withAudioEngine(baselinePath, ['--backend', 'wasapi', '--mute-device-output'], async session => {
  await session.receive('hello');
  await session.send({ type: 'hello', version: protocolVersion });
  await session.send({ type: 'openSession', sampleRate: 48000, outputChannels: 2,
    outputDeviceId: 'default', latency: 'interactive' });
  const { message } = await session.receive('sessionState');
  assert.equal(message.state, 'open', JSON.stringify(message));
  assert.ok(Number.isSafeInteger(message.periodFrames) && message.periodFrames > 0);
  await session.send({ type: 'closeSession' });
  await session.receive('sessionState', state => state.state === 'closed');
  assert.equal((await session.finish()).code, 0);
  return message.periodFrames;
});

const frames = 128 * 1024;
const runs = 4;
const input = Float32Array.from({ length: frames * 2 }, (_, index) =>
  .17 * Math.sin(index * .019) + .11 * Math.sin(index * .067));
const pipelines = [
  { name: 'Volume', plugins: [{ id: 1, type: 'VolumePlugin', parameters: { vl: -5 } }] },
  { name: 'Compressor', plugins: [{ id: 1, type: 'CompressorPlugin' }] },
  { name: 'Spectrum Analyzer', plugins: [{ id: 1, type: 'SpectrumAnalyzerPlugin' }] },
];

async function measure(executable, period, plugins) {
  return withNativeWorkletParity(executable, { plugins, nativePeriod: period }, async harness => {
    await harness.render(input);
    const totals = { native: 0, worklet: 0 };
    for (let run = 0; run < runs; run += 1) {
      const result = await harness.render(input);
      assert.ok(result.nativeProcessingNanoseconds > 0, 'Build a sidecar that reports native processing time.');
      assert.ok(result.workletProcessingNanoseconds > 0);
      totals.native += result.nativeProcessingNanoseconds;
      totals.worklet += result.workletProcessingNanoseconds;
    }
    return totals;
  });
}

const results = [];
for (const { name, plugins } of pipelines) {
  results.push({
    name,
    baseline128: await measure(baselinePath, 128, plugins),
    v3_128: await measure(v3Path, 128, plugins),
    baselineDevicePeriod: await measure(baselinePath, nativePeriod, plugins),
    v3DevicePeriod: await measure(v3Path, nativePeriod, plugins),
  });
}
const totals = results.reduce((sum, row) => ({
  baseline128: sum.baseline128 + row.baseline128.native,
  v3_128: sum.v3_128 + row.v3_128.native,
  worklet128: sum.worklet128 + row.v3_128.worklet,
}), { baseline128: 0, v3_128: 0, worklet128: 0 });
const pass = totals.v3_128 < totals.worklet128;
console.log(JSON.stringify({ cpu: cpus()[0]?.model, frames, runs, nativePeriod, results, totals, pass }, null, 2));
assert.ok(pass, 'The v3 total must be lower than the SIMD worklet total.');
