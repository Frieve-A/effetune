import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { MessageChannel } from 'node:worker_threads';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { ANDROID_ORIGIN } from '../../js/android/bridge.js';
import { AudioEngineHost } from '../../electron/audio-engine-host.cjs';
import { requireExecutableEnv } from '../../tools/audio-engine-session.mjs';
import {
  BENCHMARK_DSP_MODES,
  createDspBenchmarkRuntime,
  DspBenchmarkUnavailableError,
  createIrReverbBenchmarkAssets,
  createRoomEqBenchmarkAssets,
  createSoundFontBenchmarkAssets
} from '../../features/effetune-benchmark.js';
import { instantiateDsp, loadDspModule } from '../../js/audio/dsp-wasm-loader.js';

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
class SoundFontPlayerPlugin extends BenchmarkPlugin {
  getParameters() {
    return { ...super.getParameters(), mco: 0, pl: 256, og: 0, sq: 1, sc: 0, af: true,
      rg: true, rs: true, rx: true, tr: 0, tu: 0, tk: 0 };
  }
}

async function soundFontAssets() {
  // Asset sizing reads the repository WebAssembly control build, as the benchmark page does.
  const { module, bytes } = await loadDspModule({ basePath: '', publishTarget: null, cache: false,
    fetchImpl: async url => {
      const data = fs.readFileSync(new URL(`../../${String(url).replace(/^\/+/, '')}`, import.meta.url));
      return { ok: true, json: async () => JSON.parse(data.toString('utf8')),
        arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
    } });
  const controlBinding = await instantiateDsp(module || bytes);
  try {
    return await createSoundFontBenchmarkAssets({ sampleRate, channelCount, blockSize, controlBinding });
  } finally {
    controlBinding.close();
  }
}

function nativeRuntime(dependencies) {
  return createDspBenchmarkRuntime({ mode: BENCHMARK_DSP_MODES.NATIVE, sampleRate, blockSize, dependencies });
}

test('native benchmark sends complete input blocks once and turns asset rejection into a skipped result', async () => {
  const { port1: control, port2: sidecar } = new MessageChannel();
  const benchmarks = [];
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
      case 'benchmarkNull': {
        const { blockSize: size, warmupBlocks, attachment } = message;
        benchmarks.push({ size, warmupBlocks, input: Array.from(new Float32Array(attachment)) });
        sidecar.postMessage({ type: 'benchmarkResult', elapsedNanoseconds: 1.2e9, blocks: 2048 });
        break;
      }
      case 'renderNull':
        sidecar.postMessage({ type: 'nullOutput', frames: message.frames, processingNanoseconds: 1 });
        break;
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
    // A trailing partial block is not sent.
    const input = Float32Array.from({ length: 6 * blockSize + 5 }, (_, index) => index);
    const result = await runtime.benchmarkPlugin(new VolumePlugin(), input,
      { channelCount, warmupFrames, assets: new Map() });
    assert.equal(benchmarks.length, 1);
    assert.equal(benchmarks[0].size, blockSize);
    assert.equal(benchmarks[0].warmupBlocks, 1024);
    assert.deepEqual(benchmarks[0].input, Array.from(input.subarray(0, 6 * blockSize)));
    assert.equal(result.elapsedTime, '1.200');
    assert.equal(result.samplesPerSecond, Math.round(2048 * blockSize / 1.2));
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

test('Android native benchmark chunks uploads, reuses the input, skips asset failures and releases on close', async () => {
  const listeners = new Map();
  const window = {
    location: { origin: ANDROID_ORIGIN },
    effetuneAndroid: { postMessage() {} },
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: name => listeners.delete(name)
  };
  const calls = [];
  let status = 'ok';
  const androidBridge = { async request(command, payload) {
    calls.push({ command, payload });
    return command === 'benchmark.run' ? { status, elapsedNs: 1e9, blocks: 100 } : {};
  } };
  await withGlobals({ window }, async () => {
    const runtime = await nativeRuntime({ androidBridge, warning() {} });
    const input = Float32Array.from({ length: 6 * blockSize * channelCount }, (_, index) => index);
    const options = { channelCount, warmupFrames, assets: new Map() };
    const result = await runtime.benchmarkPlugin(new VolumePlugin(), input, options);
    assert.equal(result.elapsedTime, '1.000');
    await runtime.benchmarkPlugin(new VolumePlugin(), input, options);
    assert.equal(calls.filter(call => call.payload?.kind === 'input').length, 1);
    assert.equal(calls.filter(call => call.command === 'benchmark.run').length, 2);

    calls.length = 0;
    status = 'asset';
    const asset = { payload: new ArrayBuffer(256 * 1024 + 4) };
    const skipped = await runtime.benchmarkPlugin(new VolumePlugin(), input,
      { ...options, assets: new Map([[0, asset]]) });
    assert.deepEqual(calls.filter(call => call.payload?.kind === 'asset').map(call => call.payload.offset),
      [0, 256 * 1024]);
    assert.equal(skipped.skipped, true);
    assert.match(skipped.note, /could not load/);

    // SoundFont voices are sounded from the uploaded bank, its resident pages and the note list.
    calls.length = 0;
    status = 'ok';
    const pcm = Float32Array.of(0.5, -0.25);
    assert.equal(runtime.getPluginUnsupportedReason(new SoundFontPlayerPlugin(), { channelCount }), null);
    await runtime.benchmarkPlugin(new SoundFontPlayerPlugin(), input, { ...options, assets: new Map([[0, {
      payload: new ArrayBuffer(8), formatTag: 1, preparationContext: { sampleRate },
      soundFont: { frames: [2], notes: [60, 61],
        pages: [{ sample: 0, pageIndex: 0, pcm, frames: 2, channels: 1 }] }
    }]]) });
    const { asset: sent } = calls.find(call => call.command === 'benchmark.run').payload;
    assert.equal('preparationContext' in sent, false);
    assert.deepEqual(sent.soundFont, { notes: [60, 61], pages: [{ sample: 0, pageIndex: 0, frames: 2, channels: 1,
      pcm: Buffer.from(pcm.buffer).toString('base64') }] });

    assert.equal(listeners.has('pagehide'), true);
    await runtime.close();
    await runtime.close();
    assert.equal(calls.filter(call => call.command === 'benchmark.release').length, 1);
    assert.equal(listeners.has('pagehide'), false);
  });
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
          else if (message.type === 'benchmarkNull') port2.postMessage(attempt === 1 ? { type: 'engineFailure' } :
            { type: 'benchmarkResult', elapsedNanoseconds: 1e9, blocks: 1024 });
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

test('native null benchmark processes Volume, IR Reverb, Room EQ and SoundFont Player', { timeout: 45000 }, async t => {
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
          if (interrupt && data.type === 'benchmarkNull') {
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
      [new RoomEqPlugin(), createRoomEqBenchmarkAssets({ sampleRate, channelCount, taps: 32768, latency: '128' })],
      [new SoundFontPlayerPlugin(), await soundFontAssets()]
    ]) {
      const result = await runtime.benchmarkPlugin(plugin, input, { channelCount, assets, warmupFrames });
      assert.ok(result.samplesPerSecond > 0 && Number.isFinite(result.samplesPerSecond), JSON.stringify(result));
    }
  } finally {
    await runtime.close();
  }
});
