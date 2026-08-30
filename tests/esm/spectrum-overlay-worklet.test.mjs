import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { PipelineProcessor } from '../../js/audio/pipeline-processor.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { createOverlayHarness } from '../helpers/spectrum-overlay-harness.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const processorPath = path.join(repoRoot, 'plugins', 'audio-processor.js');
const overlayPath = path.join(repoRoot, 'plugins', 'spectrum-overlay.js');
const BLOCK_SIZE = 128;
const FFT_SIZE = 4096;

function createArena() {
  const buffer = new ArrayBuffer(256 * 1024);
  let offset = 0;
  const allocate = length => {
    const view = new Float32Array(buffer, offset, length);
    offset += view.byteLength;
    return view;
  };
  const combined = allocate(16 * BLOCK_SIZE);
  const buses = new Map([[0, combined]]);
  for (let bus = 1; bus <= 4; bus++) buses.set(bus, allocate(16 * BLOCK_SIZE));
  return {
    buffer,
    combined,
    buses,
    scratch: {
      allChannels: allocate(16 * BLOCK_SIZE),
      mixing: allocate(16 * BLOCK_SIZE),
      stereo: allocate(2 * BLOCK_SIZE),
      mono: allocate(BLOCK_SIZE)
    }
  };
}

function createBinding() {
  const calls = [];
  const arena = createArena();
  const pointers = new Map();
  let nextPointer = 1024;
  for (const view of [
    arena.combined,
    ...arena.buses.values(),
    arena.scratch.allChannels,
    arena.scratch.mixing,
    arena.scratch.stereo,
    arena.scratch.mono
  ]) {
    if (!pointers.has(view)) {
      pointers.set(view, nextPointer);
      nextPointer += view.byteLength;
    }
  }
  const views = new Map([...pointers].map(([view, pointer]) => [pointer, view]));
  let nextInstance = 1;
  return {
    calls,
    arena,
    memory: { buffer: arena.buffer },
    createEngine() { calls.push('createEngine'); return 1; },
    prepare() { calls.push('prepare'); return 0; },
    getCapabilities() {
      return {
        abiVersion: 1,
        simd: false,
        kernels: [{ name: 'VolumePlugin', hash: 0x1234, byteCapacity: 0, kernelIndex: 0 }]
      };
    },
    getArenaViews() { return arena; },
    createInstance() { calls.push('createInstance'); return nextInstance++; },
    destroyInstance() { calls.push('destroyInstance'); },
    instanceSetTap() { return 0; },
    instanceLatency() { return 0; },
    instanceSetParams() { return 0; },
    pointerForArenaView(view) { return pointers.get(view) ?? null; },
    instanceProcess(_id, pointer, channels, frames) {
      calls.push('instanceProcess');
      const view = views.get(pointer);
      for (let index = 0; index < channels * frames; index++) view[index] *= 0.5;
      return 0;
    },
    pipelineConfigure() { calls.push('pipelineConfigure'); return 0; },
    pipelineLatency() { return 0; },
    pipelineProcess() { calls.push('pipelineProcess'); return 0; },
    telemetryRead() { return 0; },
    lastTelemetryDroppedFrames: 0,
    checkMemoryBuffer() { return false; },
    close() { calls.push('close'); },
    reset() { return 0; }
  };
}

async function flushAsyncWork() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

async function createHarness() {
  const source = await fs.readFile(processorPath, 'utf8');
  const injected = source.replace(
    /\/\/ __ETDSP_BINDING_INJECT_START__[\s\S]*?\/\/ __ETDSP_BINDING_INJECT_END__/,
    `// __ETDSP_BINDING_INJECT_START__
async function instantiateDspBinding() { return globalThis.__binding; }
// __ETDSP_BINDING_INJECT_END__`
  );
  const posts = [];
  const binding = createBinding();
  let ProcessorClass = null;
  class FakePort {
    postMessage(message, transfer = []) { posts.push({ message, transfer }); }
  }
  class FakeAudioWorkletProcessor {
    constructor() { this.port = new FakePort(); }
  }
  const sandbox = {
    ArrayBuffer,
    DataView,
    Float32Array,
    Map,
    Set,
    Uint8Array,
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    __binding: binding,
    console: { error() {}, log() {}, warn() {} },
    currentTime: 0,
    performance: { now: () => 0 },
    sampleRate: 48000,
    registerProcessor(name, constructor) {
      if (name === 'plugin-processor') ProcessorClass = constructor;
    }
  };
  vm.runInNewContext(injected, sandbox, { filename: processorPath });
  const processor = new ProcessorClass({
    processorOptions: { initialOutputChannelCount: 2, lowLatencyMode: false }
  });
  return {
    binding,
    posts,
    processor,
    send: async data => {
      processor.port.onmessage({ data });
      await flushAsyncWork();
    },
    process(input, time = 1) {
      sandbox.currentTime = time;
      const output = [new Float32Array(BLOCK_SIZE), new Float32Array(BLOCK_SIZE)];
      assert.equal(processor.process([input], [output], {}), true);
      return output;
    }
  };
}

async function loadAnalyzer() {
  const source = await fs.readFile(overlayPath, 'utf8');
  const sandbox = { Float32Array, Map, Math, window: {} };
  vm.runInNewContext(source, sandbox, { filename: overlayPath });
  return sandbox.window.SpectrumOverlay.analyze;
}

function pluginConfig(overrides = {}) {
  return {
    id: 7,
    type: 'VolumePlugin',
    enabled: true,
    parameters: { enabled: true },
    inputBus: 0,
    outputBus: 0,
    channel: 'A',
    wasmParams: Float32Array.of(1),
    wasmParamsHash: 0x1234,
    ...overrides
  };
}

function sineBlock(frameOffset = 0, gain = 1) {
  return Array.from({ length: 2 }, () => Float32Array.from(
    { length: BLOCK_SIZE },
    (_, frame) => gain * Math.sin(2 * Math.PI * 1000 * (frameOffset + frame) / 48000)
  ));
}

function spectrumMessages(harness) {
  return harness.posts.filter(({ message }) => message.type === 'spectrumOverlay');
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function setupFallback(harness, processor = 'return data;') {
  await harness.send({ type: 'registerProcessor', pluginType: 'VolumePlugin', processor });
  await harness.send({ type: 'updatePlugins', plugins: [pluginConfig()], masterBypass: false });
}

async function setupDspPerInstanceHarness(tapEnabled) {
  const harness = await createHarness();
  await setupFallback(harness);
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });
  // Keep the same per-instance path in both benchmark arms without enabling a tap.
  await harness.send({ type: 'setSpectrumTapRoute', pluginId: 99, enabled: true });
  if (tapEnabled) {
    await harness.send({ type: 'setSpectrumTap', pluginId: 7, enabled: true, mode: 'after' });
  }
  assert.equal(harness.processor.dspPipelineReady, false);
  return harness;
}

function processBlocks(harness, count) {
  const input = [
    new Float32Array(BLOCK_SIZE).fill(0.25),
    new Float32Array(BLOCK_SIZE).fill(0.25)
  ];
  const startedAt = performance.now();
  for (let block = 0; block < count; block++) harness.process(input);
  return performance.now() - startedAt;
}

test('comparison spectrum tap captures input/output PCM and bypasses measurement throttling', async () => {
  const harness = await createHarness();
  await setupFallback(harness, `
    for (let index = 0; index < data.length; index++) data[index] *= 0.5;
    data.measurements = { retained: true };
    return data;
  `);

  const input = sineBlock();
  for (let block = 0; block < 1000; block++) harness.process(input, 1);
  assert.equal(spectrumMessages(harness).length, 0);
  assert.equal(harness.processor.spectrumTapState.size, 0);

  await harness.send({ type: 'setSpectrumTap', pluginId: 7, enabled: true, mode: 'compare' });
  harness.processor.lastMessageTime = Number.MAX_SAFE_INTEGER;
  harness.processor.messageQueue.clear();
  for (let block = 0; block < 32; block++) harness.process(sineBlock(block * BLOCK_SIZE), 1);

  const messages = spectrumMessages(harness);
  assert.deepEqual(messages.map(({ message }) => message.bufferPosition), [2048, 0]);
  assert.equal(messages.every(({ message }) =>
    message.spectrumPluginId === 7 && !('pluginId' in message) &&
    message.mode === 'compare' &&
    message.inputBuffer instanceof Float32Array &&
    message.outputBuffer instanceof Float32Array), true);
  assert.equal(messages.every(({ message, transfer }) =>
    transfer.length === 2 &&
    transfer[0] === message.inputBuffer.buffer &&
    transfer[1] === message.outputBuffer.buffer), true);
  assert.ok(harness.posts.some(({ message }) => message.type === 'processBuffer'));
  assert.equal(harness.processor.lastMessageTime, Number.MAX_SAFE_INTEGER);
  assert.equal(harness.processor.messageQueue.size, 1);
  assert.ok(Math.abs(messages.at(-1).message.inputBuffer[25] -
    Math.sin(2 * Math.PI * 1000 * 25 / 48000)) < 1e-6);
  assert.ok(Math.abs(messages.at(-1).message.outputBuffer[25] -
    0.5 * Math.sin(2 * Math.PI * 1000 * 25 / 48000)) < 1e-6);

  const analyze = await loadAnalyzer();
  const levels = analyze(messages.at(-1).message.outputBuffer, messages.at(-1).message.bufferPosition, 48000);
  let peak = 1;
  for (let index = 2; index < levels.length; index++) if (levels[index] > levels[peak]) peak = index;
  assert.ok(Math.abs(peak - Math.round(1000 * FFT_SIZE / 48000)) <= 1);
});

test('After mode omits Before capture and live mode changes reset only the required buffers', async () => {
  const harness = await createHarness();
  await setupFallback(harness);

  await harness.send({ type: 'setSpectrumTap', pluginId: 7, enabled: true, mode: 'after' });
  let state = harness.processor.spectrumTapState.get(7);
  assert.equal(state.mode, 'after');
  assert.equal(state.inputBuffer, null);
  for (let block = 0; block < 16; block++) harness.process(sineBlock(block * BLOCK_SIZE));
  let message = spectrumMessages(harness).at(-1);
  assert.equal(message.message.mode, 'after');
  assert.equal('inputBuffer' in message.message, false);
  assert.equal(message.transfer.length, 1);
  assert.equal(message.transfer[0], message.message.outputBuffer.buffer);

  await harness.send({ type: 'setSpectrumTap', pluginId: 7, enabled: true, mode: 'compare' });
  state = harness.processor.spectrumTapState.get(7);
  assert.equal(state.mode, 'compare');
  assert.ok(state.inputBuffer instanceof Float32Array);
  assert.equal(state.position, 0);
  for (let block = 0; block < 16; block++) harness.process(sineBlock(block * BLOCK_SIZE));
  message = spectrumMessages(harness).at(-1);
  assert.equal(message.message.mode, 'compare');
  assert.ok(message.message.inputBuffer instanceof Float32Array);
  assert.equal(message.transfer.length, 2);

  await harness.send({ type: 'setSpectrumTap', pluginId: 7, enabled: true, mode: 'after' });
  state = harness.processor.spectrumTapState.get(7);
  assert.equal(state.mode, 'after');
  assert.equal(state.inputBuffer, null);
  assert.equal(state.position, 0);
});

test('route disables only the full DSP pipeline and visibility tap changes do not refresh it', async () => {
  const harness = await createHarness();
  await setupFallback(harness);
  await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await harness.send({ type: 'dspModule', module: { compiled: true } });

  assert.equal(harness.processor.dspPipelineReady, true);
  harness.process(sineBlock());
  assert.equal(harness.binding.calls.filter(call => call === 'pipelineProcess').length, 1);

  const configuredBeforeRoute = harness.binding.calls.filter(call => call === 'pipelineConfigure').length;
  await harness.send({ type: 'setSpectrumTapRoute', pluginId: 7, enabled: true });
  assert.equal(harness.processor.dspPipelineReady, false);
  assert.equal(harness.binding.calls.filter(call => call === 'pipelineConfigure').length, configuredBeforeRoute + 1);
  await harness.send({ type: 'setSpectrumTap', pluginId: 7, enabled: true });
  for (let block = 0; block < 16; block++) harness.process(sineBlock(block * BLOCK_SIZE));
  assert.equal(harness.binding.calls.filter(call => call === 'pipelineProcess').length, 1);
  assert.ok(harness.binding.calls.includes('instanceProcess'));
  assert.equal(spectrumMessages(harness).length, 1);

  const configuredBeforeVisibility = harness.binding.calls.filter(call => call === 'pipelineConfigure').length;
  for (let cycle = 0; cycle < 100; cycle++) {
    await harness.send({ type: 'setSpectrumTap', pluginId: 7, enabled: false });
    await harness.send({ type: 'setSpectrumTap', pluginId: 7, enabled: true });
    assert.equal(harness.processor.dspPipelineReady, false);
  }
  await harness.send({ type: 'setSpectrumTapRoute', pluginId: 7, enabled: true });
  assert.equal(harness.binding.calls.filter(call => call === 'pipelineConfigure').length, configuredBeforeVisibility);

  await harness.send({ type: 'setSpectrumTapRoute', pluginId: 7, enabled: false });
  assert.equal(harness.processor.dspPipelineReady, true);
});

test('plugin removal and replacement prune spectrum state before refreshing the DSP route', async () => {
  for (const operation of ['removePlugin', 'updatePlugins']) {
    const harness = await createHarness();
    await setupFallback(harness);
    await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
    await harness.send({ type: 'dspModule', module: { compiled: true } });
    await harness.send({ type: 'setSpectrumTapRoute', pluginId: 7, enabled: true });
    await harness.send({ type: 'setSpectrumTap', pluginId: 7, enabled: true });
    for (let block = 0; block < 16; block++) harness.process(sineBlock(block * BLOCK_SIZE));
    assert.equal(spectrumMessages(harness).length, 1);

    if (operation === 'removePlugin') await harness.send({ type: operation, pluginId: 7 });
    else await harness.send({ type: operation, plugins: [], masterBypass: false });

    assert.equal(harness.processor.spectrumTapRoute.size, 0);
    assert.equal(harness.processor.spectrumTaps.size, 0);
    assert.equal(harness.processor.spectrumTapState.size, 0);
    assert.equal(harness.processor.dspPipelineReady, true);
    for (let block = 0; block < 16; block++) harness.process(sineBlock(block * BLOCK_SIZE));
    assert.equal(spectrumMessages(harness).length, 1);
  }
});

test('same-node rebuild during master bypass preserves spectrum intent until actual plugin removal', async () => {
  for (const suspended of [false, true]) {
    const harness = await createHarness();
    await setupFallback(harness);
    await harness.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
    await harness.send({ type: 'dspModule', module: { compiled: true } });
    const ui = createOverlayHarness();
    const node = ui.window.workletNode;
    node.disconnect = () => {};
    node.port.postMessage = data => {
      ui.posts.push(data);
      harness.processor.port.onmessage({ data });
    };
    const postMessage = harness.processor.port.postMessage.bind(harness.processor.port);
    harness.processor.port.postMessage = (data, transfer) => {
      postMessage(data, transfer);
      for (const listener of node.listeners) listener({ data });
    };
    ui.plugin.getParameters = () => ({ enabled: true });
    ui.plugin.getWorkletPluginData = () => pluginConfig();
    ui.window.pipeline = [ui.plugin];
    const pipeline = new PipelineProcessor({
      audioContext: { sampleRate: 48000, destination: { channelCount: 2 } },
      workletNode: node
    }, {
      sourceNode: { disconnect() {} },
      async connectAudioNodes() { return ''; }
    });

    await withGlobals({ window: ui.window }, async () => {
      const { instance } = ui.attach();
      try {
        instance.enable();
        for (let block = 0; block < 32; block++) harness.process(sineBlock(block * BLOCK_SIZE));
        assert.equal(spectrumMessages(harness).length, 2);
        if (suspended) ui.intersect(false);

        pipeline.setMasterBypass(true);
        assert.equal(await pipeline.rebuildPipeline(), '');
        await flushAsyncWork();
        assert.equal(harness.processor.plugins.length, 1);
        assert.equal(harness.processor.spectrumTapRoute.has(7), true);
        const input = sineBlock();
        assert.deepEqual(harness.process(input), input);
        assert.equal(spectrumMessages(harness).length, 2);

        pipeline.setMasterBypass(false);
        assert.equal(await pipeline.rebuildPipeline(), '');
        await flushAsyncWork();
        const configurations = harness.binding.calls.filter(call => call === 'pipelineConfigure').length;
        if (suspended) ui.intersect(true);
        assert.equal(instance.enabled, true);
        assert.equal(instance.active, true);
        assert.equal(harness.processor.dspPipelineReady, false);
        assert.equal(harness.binding.calls.filter(call => call === 'pipelineConfigure').length, configurations);
        assert.equal(ui.posts.filter(message => message.type === 'setSpectrumTapRoute').length, 1);
        for (let block = 0; block < 32; block++) harness.process(sineBlock(block * BLOCK_SIZE));
        assert.equal(spectrumMessages(harness).length, 4);
        assert.equal(instance.pending?.type, 'spectrumOverlay');

        instance.dispose();
        ui.window.pipeline = [];
        assert.equal(await pipeline.rebuildPipeline(), '');
        await flushAsyncWork();
        assert.equal(harness.processor.spectrumTapRoute.size, 0);
        assert.equal(harness.processor.spectrumTaps.size, 0);
        assert.equal(harness.processor.spectrumTapState.size, 0);
      } finally {
        instance.dispose();
      }
    });
  }
});

test('spectrum tap honors the existing UI telemetry gate and leaves audio samples unchanged', async () => {
  const baseline = await createHarness();
  const tapped = await createHarness();
  await setupFallback(baseline);
  await setupFallback(tapped);
  await tapped.send({ type: 'setSpectrumTap', pluginId: 7, enabled: true });

  for (let block = 0; block < 16; block++) {
    const input = sineBlock(block * BLOCK_SIZE);
    const expected = baseline.process(input);
    const actual = tapped.process(input);
    assert.deepEqual(actual, expected);
  }
  assert.equal(spectrumMessages(tapped).length, 1);
  tapped.processor.powerPolicy.enabled = true;
  tapped.processor.powerPolicy.uiTelemetryEnabled = false;
  for (let block = 0; block < 16; block++) tapped.process(sineBlock(block * BLOCK_SIZE));
  assert.equal(spectrumMessages(tapped).length, 1);
  tapped.processor.powerPolicy.enabled = false;
  for (let block = 0; block < 16; block++) tapped.process(sineBlock(block * BLOCK_SIZE));
  assert.equal(spectrumMessages(tapped).length, 2);
});

test('After-only spectrum tap adds at most 25 percent per-instance work and copies one spectrum', async t => {
  const blockCount = 5000;
  const expectedSpectrumFrames = Math.floor(blockCount * BLOCK_SIZE / (FFT_SIZE / 2));
  const untappedSamples = [];
  const tappedSamples = [];
  let lastTappedHarness;

  for (let sample = 0; sample < 3; sample++) {
    const untapped = await setupDspPerInstanceHarness(false);
    processBlocks(untapped, 250);
    untapped.posts.length = 0;
    untappedSamples.push(processBlocks(untapped, blockCount));

    const tapped = await setupDspPerInstanceHarness(true);
    processBlocks(tapped, 250);
    tapped.processor.spectrumTapState.get(7).position = 0;
    tapped.posts.length = 0;
    tappedSamples.push(processBlocks(tapped, blockCount));
    lastTappedHarness = tapped;
  }

  const untappedMedian = median(untappedSamples);
  const tappedMedian = median(tappedSamples);
  t.diagnostic(
    `per-instance median: ${untappedMedian.toFixed(2)}ms without tap, ` +
    `${tappedMedian.toFixed(2)}ms with tap (${((tappedMedian / untappedMedian - 1) * 100).toFixed(1)}%)`
  );
  assert.ok(
    tappedMedian <= untappedMedian * 1.25,
    `tap median ${tappedMedian.toFixed(2)}ms exceeds 125% of ${untappedMedian.toFixed(2)}ms`
  );
  const messages = spectrumMessages(lastTappedHarness);
  const tapState = lastTappedHarness.processor.spectrumTapState.get(7);
  assert.equal(tapState.inputBuffer, null);
  assert.equal(tapState.outputBuffer.byteLength,
    FFT_SIZE * Float32Array.BYTES_PER_ELEMENT);
  assert.equal(messages.length, expectedSpectrumFrames);
  assert.equal(messages.every(({ message, transfer }) =>
    message.mode === 'after' && !('inputBuffer' in message) && transfer.length === 1), true);
  assert.equal(
    messages.reduce((bytes, { message }) => bytes + message.outputBuffer.byteLength, 0),
    expectedSpectrumFrames * FFT_SIZE * Float32Array.BYTES_PER_ELEMENT
  );

  const allOff = await createHarness();
  await setupFallback(allOff);
  await allOff.send({ type: 'dspEnableTypes', types: ['VolumePlugin'] });
  await allOff.send({ type: 'dspModule', module: { compiled: true } });
  assert.equal(allOff.processor.dspPipelineReady, true);
  assert.equal(allOff.processor.spectrumTapState.size, 0);
  allOff.posts.length = 0;
  const pipelineCallsBefore = allOff.binding.calls.filter(call => call === 'pipelineProcess').length;
  processBlocks(allOff, blockCount);
  assert.equal(spectrumMessages(allOff).length, 0);
  assert.equal(
    allOff.binding.calls.filter(call => call === 'pipelineProcess').length - pipelineCallsBefore,
    blockCount
  );
});
