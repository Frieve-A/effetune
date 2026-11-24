import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { AudioEngineHost } from '../../electron/audio-engine-host.cjs';
import { requireExecutableEnv } from '../../tools/audio-engine-session.mjs';
import {
  BENCHMARK_DSP_MODES,
  createDspBenchmarkRuntime,
  DspBenchmarkUnavailableError,
  createIrReverbBenchmarkAssets,
  createRoomEqBenchmarkAssets
} from '../../features/effetune-benchmark.js';

const sampleRate = 48000;
const blockSize = 128;
const channelCount = 2;
const warmupFrames = blockSize;

class BenchmarkPlugin {
  id = 1;
  name = 'Benchmark effect';
  setEnabled(enabled) { this.enabled = enabled; }
  getParameters() { return { enabled: this.enabled }; }
}
class VolumePlugin extends BenchmarkPlugin {}
class IRReverbPlugin extends BenchmarkPlugin {
  getParameters() { return { ...super.getParameters(), cm: 'true', dw: 0, dl: -96, lt: '128' }; }
}
class RoomEqPlugin extends BenchmarkPlugin {
  getParameters() { return { ...super.getParameters(), fd: 16384, gn: 0, lt: '128' }; }
}

function nativeRuntime(dependencies) {
  return createDspBenchmarkRuntime({ mode: BENCHMARK_DSP_MODES.NATIVE, sampleRate, blockSize, dependencies });
}

test('native batches preserve block order, omit warmup and turn asset rejection into a skipped result', async () => {
  const { port1: control, port2: sidecar } = new MessageChannel();
  const renders = [];
  let stopped = false;
  sidecar.on('message', message => {
    switch (message.type) {
      case 'openSession':
        assert.equal(message.periodFrames, blockSize);
        sidecar.postMessage({ type: 'sessionState', state: 'open' });
        break;
      case 'configurePipeline':
        assert.equal(message.plugins[0].type, 'VolumePlugin');
        sidecar.postMessage({ type: 'pipelineApplied', revision: message.revision });
        break;
      case 'renderNull': {
        const { frames, attachment } = message;
        const input = new Float32Array(attachment);
        renders.push({ frames, first: input[0], right: input[frames], second: input[blockSize],
          wrapped: input[3 * blockSize] });
        sidecar.postMessage({ type: 'nullOutput', frames, processingNanoseconds: renders.length === 1 ? 1e9 : 6e8 });
        break;
      }
      case 'setPluginAsset':
        sidecar.postMessage({ type: 'assetLoadRejected', pluginId: message.pluginId, slot: message.slot, reason: 'capacity' });
        break;
      case 'closeSession':
        sidecar.postMessage({ type: 'sessionState', state: 'closed' });
        break;
      default:
        assert.fail(`Unexpected command ${message.type}`);
    }
  });
  const runtime = await nativeRuntime({
    audioEngine: { stop: async () => { stopped = true; } },
    connectAudioEngine: async driver => {
      assert.equal(driver, 'null');
      return { ports: [control], variant: 'v3' };
    },
    warning() {}
  });
  try {
    assert.equal(runtime.label, 'Native (AVX2)');
    assert.match(runtime.getPluginUnsupportedReason(new BenchmarkPlugin()), /Native DSP is not available/);
    const input = Float32Array.from({ length: 6 * blockSize }, (_, index) => index);
    const result = await runtime.benchmarkPlugin(new VolumePlugin(), input,
      { channelCount, warmupFrames, assets: new Map() });
    assert.equal(renders.length, 3);
    const frames = renders[0].frames;
    assert.ok(frames > blockSize);
    assert.deepEqual(renders[0], { frames, first: 0, right: blockSize, second: 2 * blockSize, wrapped: 0 });
    assert.equal(renders[1].first, 2 * (frames / blockSize % 3) * blockSize);
    assert.equal(result.elapsedTime, '1.200');
    assert.equal(result.samplesPerSecond, Math.round(2 * frames / 1.2));
    const skipped = await runtime.benchmarkPlugin(new VolumePlugin(), input,
      { channelCount, warmupFrames, assets: new Map([[0, { payload: new ArrayBuffer(4) }]]) });
    assert.equal(skipped.skipped, true);
    assert.match(skipped.note, /could not load/);
  } finally {
    await runtime.close();
    sidecar.close();
  }
  assert.equal(stopped, true);
});

test('a mid-effect sidecar exit skips that effect and the next effect requires a working relaunch', async t => {
  for (const relaunch of [true, false]) {
    const ports = [];
    let starts = 0;
    const runtime = await nativeRuntime({
      audioEngine: { stop: async () => {} },
      connectAudioEngine: async () => {
        const attempt = ++starts;
        if (attempt > 1 && !relaunch) throw new Error('driver unavailable');
        const { port1, port2 } = new MessageChannel();
        ports.push(port2);
        port2.on('message', message => {
          if (message.type === 'openSession') port2.postMessage({ type: 'sessionState', state: 'open' });
          else if (message.type === 'configurePipeline') port2.postMessage({ type: 'pipelineApplied', revision: 1 });
          else if (message.type === 'renderNull') port2.postMessage(attempt === 1 ? { type: 'engineFailure' } :
            { type: 'nullOutput', frames: message.frames, processingNanoseconds: 1e9 });
          else if (message.type === 'closeSession') port2.postMessage({ type: 'sessionState', state: 'closed' });
        });
        return { ports: [port1], variant: 'baseline' };
      },
      warning() {}
    });
    t.after(async () => { await runtime.close(); for (const port of ports) port.close(); });
    const run = () => runtime.benchmarkPlugin(new VolumePlugin(), new Float32Array(blockSize * channelCount),
      { channelCount, warmupFrames, assets: new Map() });
    assert.equal((await run()).skipped, true);
    assert.equal(starts, 1);
    if (relaunch) assert.ok((await run()).samplesPerSecond > 0);
    else await assert.rejects(run(), DspBenchmarkUnavailableError);
    assert.equal(starts, 2);
  }
});

test('native null benchmark processes Volume, IR Reverb and Room EQ', { timeout: 45000 }, async t => {
  const host = new AudioEngineHost({ root: fileURLToPath(new URL('../../', import.meta.url)) });
  if (!host.available()) {
    assert.notEqual(process.env[requireExecutableEnv], '1', 'The native audio engine must be built');
    return t.skip('Native audio engine executable unavailable');
  }
  let interrupt = true;
  const runtime = await nativeRuntime({
    audioEngine: host,
    connectAudioEngine: async driver => {
      const channels = Array.from({ length: 3 }, () => new MessageChannel());
      const mainPorts = channels.map(({ port1 }) => ({
        on: (name, callback) => port1.on(name, data => {
          if (interrupt && data.type === 'renderNull') {
            interrupt = false;
            host.active.proc.child.kill();
          } else callback({ data });
        }),
        start: () => port1.start(),
        close: () => port1.close(),
        postMessage: message => port1.postMessage(message)
      }));
      return { variant: await host.start(driver, ...mainPorts), ports: channels.map(({ port2 }) => port2) };
    }
  });
  try {
    const input = Float32Array.from({ length: blockSize * channelCount * 4 }, (_, i) => Math.sin(i * .02) * .3);
    const stopped = await runtime.benchmarkPlugin(new VolumePlugin(), input, { channelCount, warmupFrames, assets: new Map() });
    assert.equal(stopped.skipped, true);
    for (const [plugin, assets] of [
      [new VolumePlugin(), new Map()],
      [new IRReverbPlugin(), createIrReverbBenchmarkAssets({ sampleRate })],
      [new RoomEqPlugin(), createRoomEqBenchmarkAssets({ sampleRate, channelCount, taps: 32768, latency: '128' })]
    ]) {
      const result = await runtime.benchmarkPlugin(plugin, input, { channelCount, assets, warmupFrames });
      assert.ok(result.samplesPerSecond > 0 && Number.isFinite(result.samplesPerSecond), JSON.stringify(result));
    }
  } finally {
    await runtime.close();
  }
});
