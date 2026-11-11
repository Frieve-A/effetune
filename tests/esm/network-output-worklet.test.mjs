import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const processorPath = path.join(repoRoot, 'plugins', 'audio-processor.js');
const PACKET_FRAMES = 2048;

async function flushAsyncWork() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

// Mirrors the dsp-worklet-glue harness: the processor runs in a sandbox with a
// fake AudioWorkletProcessor, the output gate held open and no DSP module.
async function createWorkletHarness(options = {}) {
  const source = await fs.readFile(processorPath, 'utf8');
  const injected = source.replace(
    /\/\/ __ETDSP_BINDING_INJECT_START__[\s\S]*?\/\/ __ETDSP_BINDING_INJECT_END__/,
    `// __ETDSP_BINDING_INJECT_START__
async function instantiateDspBinding() { throw new Error('unused'); }
// __ETDSP_BINDING_INJECT_END__`
  );
  const posts = [];
  let ProcessorClass = null;
  class FakePort {
    constructor() { this.onmessage = null; }
    postMessage(message, transfer = []) { posts.push({ message, transfer }); }
  }
  class FakeAudioWorkletProcessor {
    constructor() { this.port = new FakePort(); }
  }
  const sandbox = {
    ArrayBuffer,
    Math,
    DataView,
    Float32Array,
    Int16Array,
    Map,
    Set,
    Uint8Array,
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    console: { log() {}, error() {}, warn() {} },
    performance: { now: () => 0 },
    currentTime: 0,
    currentFrame: 0,
    sampleRate: options.sampleRate ?? 48000,
    registerProcessor(name, constructor) {
      if (name === 'plugin-processor') ProcessorClass = constructor;
    }
  };
  vm.runInNewContext(injected, sandbox, { filename: processorPath });
  assert.ok(ProcessorClass);
  const processor = new ProcessorClass({
    processorOptions: { initialOutputChannelCount: options.outputChannels ?? 2, lowLatencyMode: false }
  });
  processor.transition.phase = 'open';
  processor.transition.gain = 1;
  processor.mutationDiscontinuity = () => false;
  processor.latencyPlansDiffer = () => false;
  const send = async data => {
    processor.port.onmessage({ data });
    await flushAsyncWork();
  };
  return {
    posts,
    processor,
    send,
    setContextFrame(frame) { sandbox.currentFrame = frame; }
  };
}

function createSendPort() {
  return {
    posts: [],
    closed: 0,
    postMessage(message, transfer = []) { this.posts.push({ message, transfer }); },
    close() { this.closed++; }
  };
}

function processBlock(processor, value = 1, channelCount = 2, frameCount = 128) {
  const input = Array.from(
    { length: channelCount },
    () => Float32Array.from({ length: frameCount }, () => value)
  );
  const output = Array.from({ length: channelCount }, () => new Float32Array(frameCount));
  assert.equal(processor.process([input], [output], {}), true);
  return output;
}

function settleDelay(h, value = 0.5, channels = 2) {
  for (let count = 0; h.processor.networkOutput.delayTransition && count < 3100; count++) {
    processBlock(h.processor, value, channels);
  }
  assert.equal(h.processor.networkOutput.delayTransition, null);
}

function quantize(raw) {
  const sample = raw < -1 ? -1 : raw > 1 ? 1 : raw;
  return Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
}

async function activatePort(harness) {
  const port = createSendPort();
  await harness.send({ type: 'setNetworkOutputPort', port });
  return port;
}

test('muting this computer silences the local channels and keeps the network PCM feed', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const port = await activatePort(h);
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 5, localEnabled: false });
  for (let block = 0; block < PACKET_FRAMES / 128; block++) {
    const output = processBlock(h.processor, 0.5);
    if (block >= 2) assert.ok(output.every(channel => channel.every(sample => sample === 0)));
  }
  assert.equal(port.posts.length, 1);
  assert.ok(new Int16Array(port.posts[0].message.data).every(sample => sample === quantize(0.5)));

  await h.send({ type: 'setNetworkOutputLocalDelay', active: false, delayMs: 0, localEnabled: false });
  assert.ok(processBlock(h.processor, 0.5)[0].every(sample => sample === 0));
  await h.send({ type: 'setNetworkOutputLocalDelay', active: false, delayMs: 0, localEnabled: true });
  processBlock(h.processor, 0.5);
  assert.equal(processBlock(h.processor, 0.5)[0].at(-1), 0.5);
});

// Power-saving transport that zeroes the output while the worklet keeps running.
async function enterZeroOutputTransport(harness) {
  await harness.send({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 1,
    uiTelemetryEnabled: true,
    silenceThresholdDb: -80,
    enabledPluginCount: 0,
    monitoringPreparationCapabilities: [],
    temporalSkipEligible: true,
    monitoringFastWakeEligible: true
  });
  await harness.send({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'zero-output-transport',
    workletGraphGeneration: 3,
    topologyRevision: 7,
    commandId: 2,
    skipEpoch: 1
  });
}

test('the final stage sends the gated output as 44.1 kHz 16-bit stereo packets and duplicates mono', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const port = await activatePort(h);
  assert.equal(h.processor.networkOutput.resampler, null, '44.1 kHz passes through without a resampler');
  // The gate opens over 10 ms: the first packet must carry the ramp, not the raw pipeline output.
  h.processor.transition.phase = 'opening';
  h.processor.transition.gain = 0;
  const rendered = [];
  for (let block = 0; block < PACKET_FRAMES / 128; block++) {
    const output = processBlock(h.processor, 0.5);
    rendered.push(...output[0]);
    assert.equal(port.posts.length, block === PACKET_FRAMES / 128 - 1 ? 1 : 0);
  }
  assert.equal(h.processor.transition.phase, 'open');
  const { message, transfer } = port.posts[0];
  assert.equal(message.type, 'pcm');
  assert.equal(message.sampleRate, 44100);
  assert.equal(message.channelCount, 2);
  assert.equal(message.frames, PACKET_FRAMES);
  assert.ok(message.data instanceof ArrayBuffer);
  // Nothing is transferred (a transferred buffer arrives empty at Electron's MessagePortMain): the real port
  // copies the data by structured clone and the worklet reuses the same packet buffer for the next packet.
  assert.equal(transfer.length, 0);
  assert.equal(message.data, h.processor.networkOutput.packet.buffer, 'the packet buffer is reused');
  const data = new Int16Array(message.data);
  assert.equal(data.length, PACKET_FRAMES * 2);
  assert.ok(rendered[0] < 0.01 && rendered[PACKET_FRAMES - 1] === 0.5, 'the ramp is part of the rendered output');
  for (let frame = 0; frame < PACKET_FRAMES; frame++) {
    assert.equal(data[frame * 2], quantize(rendered[frame]));
    assert.equal(data[frame * 2 + 1], quantize(rendered[frame]));
  }
  assert.ok(h.processor.posts === undefined);
  assert.equal(h.posts.filter(entry => entry.message.type === 'pcm').length, 0, 'PCM never goes to the main port');

  // Clipping rounds after the clamp, without dither.
  const clipped = processBlock(h.processor, 1.5)[0];
  assert.equal(clipped[0], 1.5);
  const partial = h.processor.networkOutput.packet;
  assert.equal(partial[0], 0x7fff);
  processBlock(h.processor, -1.5);
  assert.equal(partial[128 * 2], -0x8000);

  const mono = await createWorkletHarness({ sampleRate: 44100, outputChannels: 1 });
  const monoPort = await activatePort(mono);
  for (let block = 0; block < PACKET_FRAMES / 128; block++) processBlock(mono.processor, 0.25, 1);
  assert.equal(monoPort.posts.length, 1);
  const monoData = new Int16Array(monoPort.posts[0].message.data);
  assert.equal(monoData[0], quantize(0.25));
  assert.equal(monoData[1], quantize(0.25));
  assert.equal(monoPort.posts[0].message.channelCount, 2);
});

test('network PCM positions are contiguous within an epoch and restart after suppression or port replacement', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const port = await activatePort(h);
  const packet = () => { for (let i = 0; i < PACKET_FRAMES / 128; i++) processBlock(h.processor); };
  packet();
  packet();
  assert.deepEqual(port.posts.map(({ message }) => [message.sourceEpoch, message.sourceFrame]), [[1, 0], [1, 2048]]);
  await h.send({ type: 'setNetworkOutputSendPaused', paused: true });
  await h.send({ type: 'setNetworkOutputSendPaused', paused: false });
  packet();
  assert.deepEqual([port.posts[2].message.sourceEpoch, port.posts[2].message.sourceFrame], [2, 0]);
  const replacement = await activatePort(h);
  packet();
  assert.deepEqual([replacement.posts[0].message.sourceEpoch, replacement.posts[0].message.sourceFrame], [3, 0]);
});

test('network PCM bounds in-flight packets and resumes a fresh epoch after a valid credit', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const port = await activatePort(h);
  const packet = () => { for (let i = 0; i < PACKET_FRAMES / 128; i++) processBlock(h.processor); };
  for (let i = 0; i < 10; i++) packet();
  assert.equal(port.posts.length, 8);
  port.onmessage({ data: { type: 'pcm-ack', sourceEpoch: 99, sourceFrame: 0 } });
  packet();
  assert.equal(port.posts.length, 8);
  port.onmessage({ data: { type: 'pcm-ack', sourceEpoch: 1, sourceFrame: 0 } });
  packet();
  assert.equal(port.posts.length, 9);
  assert.deepEqual([port.posts[8].message.sourceEpoch, port.posts[8].message.sourceFrame], [2, 0]);
  const replacement = await activatePort(h);
  port.onmessage({ data: { type: 'pcm-ack', sourceEpoch: 2, sourceFrame: 0 } });
  packet();
  assert.equal(replacement.posts.length, 1);
});

test('a 48 kHz context is resampled to 44.1 kHz with the fixed ratio and unity gain', async () => {
  const h = await createWorkletHarness({ sampleRate: 48000 });
  const port = await activatePort(h);
  const resampler = h.processor.networkOutput.resampler;
  assert.ok(resampler);
  assert.equal(resampler.step, 48000 / 44100);
  const blocks = 40;
  for (let block = 0; block < blocks; block++) processBlock(h.processor, 0.5);
  const inputFrames = blocks * 128;
  const renderedFrames = port.posts.length * PACKET_FRAMES + h.processor.networkOutput.packetFill / 2;
  const expected = inputFrames * 44100 / 48000;
  assert.equal(port.posts.length, 2);
  assert.ok(Math.abs(renderedFrames - expected) <= 40, `rendered ${renderedFrames} for ${expected}`);
  const steady = new Int16Array(port.posts[1].message.data);
  for (let index = 0; index < steady.length; index++) {
    assert.ok(Math.abs(steady[index] - quantize(0.5)) <= 1, `sample ${index} = ${steady[index]}`);
  }
  // A 96 kHz context renders about half as many frames as it consumes.
  const high = await createWorkletHarness({ sampleRate: 96000 });
  const highPort = await activatePort(high);
  for (let block = 0; block < 40; block++) processBlock(high.processor, 0.5);
  const highRendered = highPort.posts.length * PACKET_FRAMES + high.processor.networkOutput.packetFill / 2;
  assert.ok(Math.abs(highRendered - 5120 * 44100 / 96000) <= 40);
});

test('the L0 stage allocates on activation, writes at delay 0, keeps content across trim changes and releases', async () => {
  const h = await createWorkletHarness({ sampleRate: 48000 });
  const feed = h.processor.networkOutput;
  assert.equal(feed.delayBuffer, null);
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 10 });
  assert.equal(feed.delayCapacity, 8 * 48000);
  assert.equal(feed.delayBuffer.length, (8 * 48000 + 1) * 2);
  assert.equal(feed.delaySamples, 0);
  const activation = processBlock(h.processor, 1)[0];
  assert.ok(activation[0] > activation.at(-1));
  settleDelay(h, 1);
  assert.equal(feed.delaySamples, 480);

  // Trim changes reuse the retained history: the delay is clamped to the capacity.
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 9000 });
  assert.equal(feed.delaySamples, 480, 'reported delay remains applied until the transition ends');
  assert.equal(feed.delayTransition.samples, 8 * 48000);
  settleDelay(h, 1);
  assert.equal(feed.delaySamples, 8 * 48000);
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: -5 });
  settleDelay(h, 0.25);
  assert.equal(feed.delaySamples, 0);
  const buffer = feed.delayBuffer;

  // Delay 0 still writes every block, so a later trim replays what was written.
  assert.ok(processBlock(h.processor, 0.25)[0].every(value => value === 0.25));
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 128000 / 48000 });
  assert.equal(feed.delayBuffer, buffer, 'a trim change keeps the buffer');
  const transitioning = processBlock(h.processor, 0.75);
  assert.ok(transitioning[0][0] > 0.25 && transitioning[0][127] < 0.75);
  processBlock(h.processor, 0.75);
  assert.equal(feed.delaySamples, 128);
  assert.ok(processBlock(h.processor, 0.5)[0].every(value => value === 0.75));

  // A channel-count change reallocates the stage for the new layout.
  await h.send({ type: 'updateAudioConfig', outputChannels: 4 });
  assert.equal(feed.delayChannelCount, 4);
  assert.equal(feed.delayBuffer.length, (8 * 48000 + 1) * 4);
  settleDelay(h, 0.5, 4);
  assert.ok(processBlock(h.processor, 0.5, 4)[3].every(value => value === 0.5));

  await h.send({ type: 'setNetworkOutputLocalDelay', active: false, delayMs: 10 });
  processBlock(h.processor, 0.5, 4);
  processBlock(h.processor, 0.5, 4);
  assert.equal(feed.delayBuffer, null);
  assert.equal(feed.delaySamples, 0);
  assert.ok(processBlock(h.processor, 0.5, 4)[0].every(value => value === 0.5));
});

test('L0 queues changing targets until the current delay transition completes', async () => {
  const h = await createWorkletHarness({ sampleRate: 48000 });
  const feed = h.processor.networkOutput;
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 0 });
  processBlock(h.processor, 0.5);
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 10 });
  processBlock(h.processor, 0.5);
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 5 });
  while (feed.delaySamples !== 480) processBlock(h.processor, 0.5);
  assert.equal(feed.delaySamples, 480);
  settleDelay(h);
  assert.equal(feed.delaySamples, 240);
  assert.equal(feed.delayTransition, null);
});

test('L0 activation, history refill and local mute ramp without changing sent PCM', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const port = await activatePort(h);
  processBlock(h.processor, 1);
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 20, requestId: 1 });
  const local = [1];
  for (let i = 0; i < 12; i++) local.push(...processBlock(h.processor, 1)[0]);
  assert.ok(local.some(value => value < 0.01));
  assert.equal(local.at(-1), 1);
  assert.ok(local.every((value, index) => index === 0 || Math.abs(value - local[index - 1]) <= 0.008));
  assert.ok(h.posts.some(({ message }) => message.type === 'networkDelayApplied' && message.requestId === 1));
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 20, localEnabled: false, requestId: 2 });
  const muted = [local.at(-1)];
  for (let i = 0; i < 5; i++) muted.push(...processBlock(h.processor, 1)[0]);
  assert.equal(muted.at(-1), 0);
  assert.ok(muted.every((value, index) => index === 0 || Math.abs(value - muted[index - 1]) <= 0.004));
  assert.ok(port.posts.length > 0);
  assert.ok(new Int16Array(port.posts[0].message.data).every(value => value === 32767));
});

function installVisualizerTap(processor, captured, tapId = 0xf0000000, type = 'SpectrumAnalyzerPlugin') {
  const scratch = processor.bufferPool.stereo;
  const spans = [];
  processor.dspLive = true;
  processor.visualizerInstances = new Map([[tapId, { id: 9, type, channels: [0, 1], gain: 1 }]]);
  processor.dspBinding = {
    pointerForArenaView: () => 4096,
    telemetryRead: () => 0,
    checkMemoryBuffer: () => false,
    reset() {},
    instanceProcess(_id, _ptr, channels, frames, time) {
      captured.push([scratch[0], scratch[frames], channels, time]);
      return 0;
    },
    instanceProcessSpan(_id, _ptr, _channels, _frames, first, count) {
      spans.push([first, count]);
      return 0;
    },
    streamBoundaryInstance() { return 0; },
    destroyInstance() {}
  };
  processor.pumpDspTelemetry = () => {};
  return spans;
}

test('while L0 is active the visualizers tap its output once per block and the other tap sites stay silent', async () => {
  const h = await createWorkletHarness({ sampleRate: 48000 });
  const captured = [];
  installVisualizerTap(h.processor, captured);
  h.processor.masterBypass = true;
  processBlock(h.processor, 0.5);
  assert.deepEqual(captured, [[0.5, 0.5, 2, 0]], 'without L0 the existing tap site runs');

  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 128000 / 48000 });
  captured.length = 0;
  const first = processBlock(h.processor, 1);
  assert.ok(first[0][0] > first[0].at(-1));
  assert.equal(captured.length, 1, 'the final stage taps the delayed output exactly once');
  processBlock(h.processor, 0.75);
  assert.equal(captured.length, 2);
  assert.equal(h.processor.visualizerTapNeedsPump, true);

  await h.send({ type: 'setNetworkOutputLocalDelay', active: false, delayMs: 0 });
  processBlock(h.processor, 0.25);
  assert.equal(captured.length, 3);
});

test('with visual sync on and this computer off, the visualizer taps the network signal exactly once', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const port = await activatePort(h);
  const captured = [];
  const pumpTelemetry = h.processor.pumpDspTelemetry;
  installVisualizerTap(h.processor, captured);
  h.processor.pumpDspTelemetry = pumpTelemetry;
  h.processor.dspBinding.telemetryRead = () => 16;
  h.processor.dspPacketPool.push(new Uint8Array(16));
  h.processor.masterBypass = true;
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 2300, localEnabled: false });
  await h.send({ type: 'setVisualSync', enabled: true });
  for (let block = 0; block < PACKET_FRAMES / 128; block++) {
    const output = processBlock(h.processor, 0.5);
    if (block >= 2) assert.ok(output.every(channel => channel.every(sample => sample === 0)));
  }
  assert.equal(captured.length, PACKET_FRAMES / 128);
  assert.ok(captured.every(([left, right]) => left === 0.5 && right === 0.5));
  assert.equal(h.posts.find(({ message }) => message.type === 'dspTelemetry').message.visualizerTapStage, 'network');
  assert.equal(port.posts.length, 1);
  assert.ok(new Int16Array(port.posts[0].message.data).every(sample => sample === quantize(0.5)));

  await h.send({ type: 'setVisualSync', enabled: false });
  processBlock(h.processor, 0.25);
  assert.deepEqual(captured.at(-1).slice(0, 2), [0, 0], 'with sync off, capture follows the local delay again');
});

test('with Live Audio Send, synced Visualizer PCM matches the transmitted stereo before local effects', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const port = await activatePort(h);
  h.processor.pluginProcessors.set('NetworkSendPlugin', (_context, data) => data);
  h.processor.pluginProcessors.set('LocalEffect', (_context, data) => {
    for (let index = 0; index < data.length; index++) data[index] *= 2;
    return data;
  });
  await h.send({ type: 'updatePlugins', plugins: [
    { id: 1, type: 'NetworkSendPlugin', enabled: true, parameters: {} },
    { id: 2, type: 'LocalEffect', enabled: true, parameters: {} }
  ] });
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 0 });
  await h.send({ type: 'setVisualSync', enabled: true });
  const captured = [];
  installVisualizerTap(h.processor, captured);
  for (let block = 0; block < PACKET_FRAMES / 128; block++) {
    assert.equal(processBlock(h.processor, 0.25)[0][0], 0.5);
  }
  assert.equal(port.posts.length, 1);
  assert.ok(new Int16Array(port.posts[0].message.data).every(sample => sample === quantize(0.25)));
  assert.equal(captured.length, PACKET_FRAMES / 128);
  assert.ok(captured.every(([left, right]) => left === 0.25 && right === 0.25));
  assert.equal(h.processor.visualizerTapStage(), 'send');

  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 0, localEnabled: false });
  processBlock(h.processor, 0.25);
  processBlock(h.processor, 0.25);
  assert.ok(processBlock(h.processor, 0.25)[0].every(sample => sample === 0));
  assert.deepEqual(captured.at(-1).slice(0, 2), [0.25, 0.25]);

  await h.send({ type: 'setVisualSync', enabled: false });
  processBlock(h.processor, 0.25);
  assert.deepEqual(captured.at(-1).slice(0, 2), [0.5, 0.5]);
  assert.equal(h.processor.visualizerTapStage(), 'local');
});

test('stream boundaries and Rhythm add the output delay and the L0 delay to the visualizer input delay', async () => {
  const h = await createWorkletHarness({ sampleRate: 48000 });
  const processor = h.processor;
  processor.dspLatencyPlan = { tapPositions: {}, totalSamples: 500 };
  processor.outputDelaySamples = 100;
  assert.equal(processor.visualizerTapInputDelay(), 500);
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 10 });
  settleDelay(h);
  assert.equal(processor.visualizerTapInputDelay(), 1080);

  const resets = [];
  processor.dspBinding = {
    streamBoundaryInstance: id => { resets.push(id); return 0; },
    instanceProcessSpan: () => 0,
    instanceProcess: () => 0
  };
  processor.visualizerInstances = new Map([[0xf0000002, { id: 10, type: 'NoteSpectrogramPlugin' }]]);
  await h.send({ type: 'streamBoundary', frame: 1000 });
  const at = frame => {
    h.setContextFrame(frame);
    processor.applyStreamBoundaries(128);
  };
  at(1536);
  assert.deepEqual(resets, [], 'the pipeline latency alone no longer reaches the tap');
  at(1920);
  assert.deepEqual(resets, []);
  at(2048);
  assert.deepEqual(resets, [10], 'the boundary fires once output delay and L0 are added');

  // The Rhythm visualizer splits the block at the same delayed sample through the final stage.
  const captured = [];
  const spans = installVisualizerTap(processor, captured, 0xf0000001, 'RhythmAnalyzerPlugin');
  processor.masterBypass = true;
  await h.send({ type: 'streamBoundary', frame: 3000 });
  h.setContextFrame(4000);
  processBlock(processor, 0.5);
  assert.deepEqual(spans, [[0, 80], [80, 48]], 'EOF lands at sample 3000 + 1080');
  assert.equal(processor.streamBoundaries.length, 0);

  await h.send({ type: 'setVisualSync', enabled: true });
  assert.equal(processor.visualizerTapInputDelay(), 600);
  processor.visualizerInstances.set(0xf0000002, { id: 10, type: 'NoteSpectrogramPlugin', channels: [0, 1], gain: 1 });
  const syncResets = [];
  processor.dspBinding.streamBoundaryInstance = id => { syncResets.push(id); return 0; };
  await h.send({ type: 'streamBoundary', frame: 5000 });
  at(5504);
  assert.deepEqual(syncResets, []);
  h.setContextFrame(5568);
  processBlock(processor, 0.25);
  assert.deepEqual(syncResets, [10, 9]);
  assert.deepEqual(spans.slice(-2), [[0, 32], [32, 96]], 'the new track starts at sample 5000 + 600');
  assert.equal(processor.streamBoundaries.length, 0);
});

test('zero-output-transport and the Double-Blind Test pause only the send while L0 and the tap continue', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const port = await activatePort(h);
  const captured = [];
  installVisualizerTap(h.processor, captured);
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 0 });
  await enterZeroOutputTransport(h);
  const blocks = PACKET_FRAMES / 128;
  for (let block = 0; block < blocks; block++) {
    assert.ok(processBlock(h.processor, 0.5)[0].every(value => value === 0));
  }
  assert.equal(port.posts.length, 0, 'no PCM leaves during zero-output-transport');
  assert.equal(h.processor.networkOutput.packetFill, 0);
  assert.equal(h.processor.networkOutput.delayWriteIndex, blocks * 128, 'L0 keeps writing');
  assert.equal(captured.length, blocks, 'the tap keeps running');

  const dbt = await createWorkletHarness({ sampleRate: 44100 });
  const dbtPort = await activatePort(dbt);
  await dbt.send({ type: 'setNetworkOutputSendPaused', paused: true });
  for (let block = 0; block < blocks; block++) processBlock(dbt.processor, 0.5);
  assert.equal(dbtPort.posts.length, 0);
  assert.equal(dbt.processor.networkOutput.packetFill, 0);
  await dbt.send({ type: 'setNetworkOutputSendPaused', paused: false });
  for (let block = 0; block < blocks; block++) processBlock(dbt.processor, 0.5);
  assert.equal(dbtPort.posts.length, 1);
});

test('replacing or clearing the send port closes the previous port and restarts the packet', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const first = await activatePort(h);
  for (let block = 0; block < 8; block++) processBlock(h.processor, 0.5);
  assert.equal(h.processor.networkOutput.packetFill, 8 * 128 * 2);
  const second = await activatePort(h);
  assert.equal(first.closed, 1);
  assert.equal(second.closed, 0);
  assert.equal(h.processor.networkOutput.packetFill, 0);
  for (let block = 0; block < 8; block++) processBlock(h.processor, 0.5);
  assert.equal(second.posts.length, 0);
  for (let block = 0; block < 8; block++) processBlock(h.processor, 0.5);
  assert.equal(second.posts.length, 1);
  assert.equal(first.posts.length, 0);

  await h.send({ type: 'setNetworkOutputPort', port: null });
  assert.equal(second.closed, 1);
  assert.equal(h.processor.networkOutput.port, null);
  assert.equal(h.processor.networkOutput.packet, null);
  for (let block = 0; block < 16; block++) processBlock(h.processor, 0.5);
  assert.equal(second.posts.length, 1);
  assert.equal(h.posts.filter(entry => entry.message.type === 'pcm').length, 0);
});

test('effective send taps the main signal once and receive excludes the prefix', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const port = await activatePort(h);
  let before = 0, after = 0;
  h.processor.pluginProcessors.set('Before', (_context, data) => { before++; for (let i = 0; i < data.length; i++) data[i] *= 2; return data; });
  h.processor.pluginProcessors.set('After', (_context, data) => { after++; for (let i = 0; i < data.length; i++) data[i] += 0.1; return data; });
  for (const type of ['NetworkSendPlugin', 'NetworkReceivePlugin']) {
    h.processor.pluginProcessors.set(type, (_context, data) => data);
  }
  const plugin = (id, type, enabled = true) => ({ id, type, enabled, parameters: {} });
  await h.send({ type: 'updatePlugins', plugins: [plugin(1, 'Before'), plugin(2, 'NetworkSendPlugin'), plugin(3, 'NetworkReceivePlugin'), plugin(4, 'After')] });
  for (let i = 0; i < 16; i++) {
    const output = processBlock(h.processor, 0.2);
    assert.ok(Math.abs(output[0][0] - 0.5) < 1e-5);
  }
  assert.equal(port.posts.length, 1);
  assert.equal(new Int16Array(port.posts[0].message.data)[0], quantize(0.4));
  assert.equal(before, 16);
  assert.equal(after, 16);
  await h.send({ type: 'setNetworkReceiveSession', active: true, generation: 1 });
  const output = processBlock(h.processor, 0.2);
  assert.ok(Math.abs(output[0][0] - 0.3) < 1e-5);
  assert.equal(before, 16);
  assert.equal(after, 17);
  for (let i = 0; i < 16; i++) processBlock(h.processor, 0.2);
  assert.equal(port.posts.length, 1);
  assert.equal(h.processor.networkReceiveId, 3);
  await h.send({ type: 'setNetworkReceiveSession', active: false, generation: 2 });
  processBlock(h.processor, 0.2);
  assert.equal(before, 17);
});

test('network paths follow compensated side-bus rejoining after the send', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const plugin = (id, type, inputBus = 0, outputBus = 0) => ({ id, type, enabled: true, inputBus, outputBus, parameters: {} });
  await h.send({ type: 'updatePlugins', plugins: [
    plugin(1, 'Prefix'), plugin(2, 'Branch', 0, 1), plugin(3, 'NetworkSendPlugin'), plugin(4, 'Merge', 1, 0)
  ] });
  const latency = new Map([[1, 5], [2, 10]]);
  h.processor.executionLatencySnapshot = latency;
  h.processor.dspLatencyPlan = h.processor.computeDspLatencyPlan(h.processor.executionPlugins, latency,
    h.processor.jsFallbackAdmissions, null);
  h.processor.publishNetworkPaths();
  const paths = h.posts.map(post => post.message).filter(message => message.type === 'networkPaths').at(-1);
  assert.equal(paths.send.localSamples, 10);
  assert.equal(paths.send.networkSamples, 0);
  assert.equal(paths.taps[4].input.networkSamples, null);
  assert.equal(paths.taps[4].input.localSamples, 0);
});

test('send tap follows transition gain and local delay has independent timing revision', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const plugin = (id, type) => ({ id, type, enabled: true, parameters: {} });
  await h.send({ type: 'updatePlugins', plugins: [plugin(1, 'NetworkSendPlugin')] });
  const tapRevision = h.processor.networkTapRevision;
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 20, localEnabled: true });
  settleDelay(h);
  assert.equal(h.processor.networkTapRevision, tapRevision);
  assert.equal(h.processor.networkLocalDelayRevision, 1);
  h.processor.networkTapCaptured = true;
  h.processor.networkTap[0].fill(1);
  h.processor.networkTap[1].fill(1);
  h.processor.transition.phase = 'closing';
  h.processor.transition.gain = 1;
  const output = [new Float32Array(128).fill(1), new Float32Array(128).fill(1)];
  h.processor.applyTransitionGain(output, 0, 128);
  assert.deepEqual(Array.from(h.processor.networkTap[0].slice(0, 128)), Array.from(output[0]));
});

test('missing receive PCM remains silent and does not resume the prefix', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  let before = 0, after = 0;
  h.processor.pluginProcessors.set('Before', (_context, data) => { before++; return data; });
  h.processor.pluginProcessors.set('After', (_context, data) => { after++; return data; });
  h.processor.pluginProcessors.set('NetworkReceivePlugin', (_context, data) => data);
  const plugin = (id, type) => ({ id, type, enabled: true, parameters: {} });
  await h.send({ type: 'updatePlugins', plugins: [plugin(1, 'Before'), plugin(2, 'NetworkReceivePlugin'), plugin(3, 'After')] });
  await h.send({ type: 'setNetworkReceiveSession', active: true, generation: 1 });
  const output = [new Float32Array(128), new Float32Array(128)];
  assert.equal(h.processor.process([[]], [output], {}), true);
  assert.equal(before, 0);
  assert.equal(after, 1);
  assert.ok(output.every(channel => channel.every(sample => Math.abs(sample) < 1e-18)));
});

test('moving the same receive marker resets state across the execution boundary', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  const plugin = (id, type) => ({ id, type, enabled: true, parameters: {} });
  h.processor.pluginProcessors.set('Stateful', (context, data) => {
    context.count = (context.count || 0) + 1;
    data.fill(context.count);
    return data;
  });
  h.processor.pluginProcessors.set('NetworkReceivePlugin', (_context, data) => data);
  await h.send({ type: 'updatePlugins', plugins: [plugin(1, 'NetworkReceivePlugin'), plugin(2, 'Stateful')] });
  await h.send({ type: 'setNetworkReceiveSession', active: true, generation: 1 });
  processBlock(h.processor, 0);
  processBlock(h.processor, 0);
  assert.equal(h.processor.pluginContexts.get(2).count, 2);
  await h.send({ type: 'reorderPlugin', fromIndex: 0, toIndex: 1 });
  assert.equal(h.processor.pluginContexts.has(2), false);
  await h.send({ type: 'reorderPlugin', fromIndex: 1, toIndex: 0 });
  processBlock(h.processor, 0);
  assert.equal(h.processor.pluginContexts.get(2).count, 1);
});

test('reset removes the cleared plugins from the execution list', async () => {
  const h = await createWorkletHarness({ sampleRate: 44100 });
  let count = 0;
  h.processor.pluginProcessors.set('Counter', (_context, data) => { count++; return data; });
  await h.send({ type: 'updatePlugins', plugins: [{ id: 1, type: 'Counter', enabled: true, parameters: {} }] });
  processBlock(h.processor, 0);
  await h.send({ type: 'reset' });
  processBlock(h.processor, 0);
  assert.equal(count, 1);
});

test('route changes discard queued telemetry and acknowledge markerless receive timing', async () => {
  const h = await createWorkletHarness({ sampleRate: 48000 });
  const processor = h.processor;
  let backlog = 1;
  processor.dspLive = true;
  processor.dspBinding = { telemetryRead: () => backlog-- > 0 ? 16 : 0 };
  processor.dspTelemetryBacklogFrame = 20;
  processor.messageQueue.set(7, { measurements: {} });
  await h.send({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 10 });
  assert.equal(processor.messageQueue.size, 0);
  assert.equal(processor.dspTelemetryBacklogFrame, null);
  assert.ok(backlog < 0);
  assert.equal(processor.mutationDiscontinuity({ type: 'setNetworkOutputLocalDelay', active: true, delayMs: 10, localEnabled: true }), false);
  processor.dspLive = false;
  settleDelay(h);
  await h.send({ type: 'setNetworkReceiveSession', active: true, generation: 9 });
  const route = h.posts.map(post => post.message).filter(message => message.type === 'networkRoute').at(-1);
  assert.equal(route.generation, 9);
  assert.equal(route.receiveActive, true);
  assert.equal(route.receiveId, null);
  assert.equal(route.localDelaySamples, 480);
  assert.equal(route.visualizerTapStage, 'local');
  const paths = h.posts.map(post => post.message).filter(message => message.type === 'networkPaths').at(-1);
  assert.equal(paths.localDelaySamples, 480);
  assert.equal(paths.visualizerTapStage, 'local');
});

test('network markers always use the serial main route for persisted routing parameters', async () => {
  const h = await createWorkletHarness({ sampleRate: 48000 });
  const plugins = ['NetworkSendPlugin', 'NetworkReceivePlugin'].map((type, index) => ({
    id: index + 1, type, enabled: true, inputBus: 2, outputBus: 3, channel: 'R',
    parameters: { inputBus: 4, outputBus: 1, channel: 'L' }
  }));
  await h.send({ type: 'updatePlugins', plugins });
  for (const plugin of h.processor.plugins) {
    assert.equal(plugin.inputBus, 0);
    assert.equal(plugin.outputBus, 0);
    assert.equal(plugin.channel, null);
  }
});
