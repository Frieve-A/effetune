// Shared browser harness for the compressed-codec suspend/resume WASM smokes.
//
// It mirrors tests/browser/g726-resume-wasm-smoke.fixture.html so every codec simulator is verified
// the same way: three worklet instances are primed with the production WASM artifact while a source
// is actively feeding them, two of them enter zero-output transport while holding partial codec
// input, queued codec output and predictor/overlap reservoir state, the AudioContext is suspended,
// and both are resumed through the prepareTemporalStateAndResume protocol.
//
// The instance that kept processing must diverge from a freshly built instance (state was really
// held), while the reset-on-resume instance must match the fresh instance sample for sample, which
// is what proves that no stale audio survives the resume.
//
// Assertions are deliberately behavioural: nothing here depends on the wet audio content of a
// codec, only on routing, reset semantics, finiteness and state divergence.

import { createDspParamPackers } from '/js/audio/dsp-wasm-loader.js';

const SAMPLE_RATE = 48000;
const CHANNELS = 2;
const PLUGIN_ID = 1;
const GRAPH_GENERATION = 17;
const TOPOLOGY_REVISION = 23;
const SKIP_COMMAND_ID = 31;
const SKIP_EPOCH = 7;
const RESUME_COMMAND_ID = 32;
const ARTIFACT_URL = '/plugins/dsp/effetune-dsp.wasm';
const SUPPORTED_SAMPLE_RATES = Object.freeze([
  44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
]);

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function createMessageObserver(port) {
  const messages = [];
  const waiters = new Set();
  port.onmessage = event => {
    const message = event.data;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (!waiter.predicate(message)) continue;
      waiters.delete(waiter);
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
    }
  };
  return {
    waitFor(predicate, timeoutMs = 15000) {
      const existing = messages.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject, timeout: null };
        waiter.timeout = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error('Timed out waiting for an AudioWorklet message.'));
        }, timeoutMs);
        waiters.add(waiter);
      });
    },
    dispose() {
      for (const waiter of waiters) {
        clearTimeout(waiter.timeout);
        waiter.reject(new Error('AudioWorklet message observer disposed.'));
      }
      waiters.clear();
      port.onmessage = null;
    }
  };
}

function createInputBuffer(context, frames, frameOffset = 0) {
  const buffer = context.createBuffer(CHANNELS, frames, SAMPLE_RATE);
  for (let channel = 0; channel < CHANNELS; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let frame = 0; frame < frames; frame++) {
      const absolute = frameOffset + frame;
      const carrier = channel === 0
        ? Math.sin(absolute * 0.071) + 0.31 * Math.sin(absolute * 0.019)
        : Math.cos(absolute * 0.053) - 0.27 * Math.sin(absolute * 0.029);
      samples[frame] = 0.48 * carrier;
    }
  }
  return buffer;
}

function createPlugin(codec, packer) {
  return {
    id: PLUGIN_ID,
    type: codec.pluginType,
    enabled: true,
    inputBus: 0,
    outputBus: 0,
    channel: null,
    parameters: { ...codec.parameters, enabled: true },
    wasmParams: packer.pack(codec.parameters),
    wasmParamsHash: packer.hash,
    executionCapabilities: {
      requiresWasm: true,
      supportedSampleRates: [...SUPPORTED_SAMPLE_RATES],
      supportedChannelModes: ['mono', 'stereo-pair']
    }
  };
}

function createWorklet(context) {
  const node = new AudioWorkletNode(context, 'plugin-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [CHANNELS],
    channelCount: CHANNELS,
    channelCountMode: 'explicit',
    processorOptions: {
      initialOutputChannelCount: CHANNELS,
      lowLatencyMode: true
    }
  });
  return { node, observer: createMessageObserver(node.port) };
}

async function initializeWorklet(resource, codec, wasmBytes, packer) {
  const { node, observer } = resource;
  const plugin = createPlugin(codec, packer);
  node.port.postMessage({
    type: 'registerProcessor',
    pluginType: plugin.type,
    processor: 'return data;'
  });
  node.port.postMessage({
    type: 'updateAudioConfig',
    outputChannels: CHANNELS,
    lowLatencyMode: true,
    sampleRate: SAMPLE_RATE
  });
  node.port.postMessage({ type: 'updatePlugins', plugins: [plugin], masterBypass: false });
  node.port.postMessage({ type: 'dspEnableTypes', types: [plugin.type] });
  const bytes = wasmBytes.slice(0);
  node.port.postMessage({ type: 'dspModule', bytes, simd: false }, [bytes]);

  const ready = await observer.waitFor(message =>
    message?.type === 'dspReady' || message?.type === 'dspFailed'
  );
  if (ready.type === 'dspFailed') {
    throw new Error(`DSP initialization failed at ${ready.stage}: ${ready.error}`);
  }
  if (!ready.kernels.some(kernel => kernel.name === plugin.type)) {
    throw new Error(`Production DSP artifact does not contain the ${codec.label} kernel.`);
  }
  await observer.waitFor(message =>
    message?.type === 'dspExecutionState' &&
    message.pluginId === PLUGIN_ID && message.state === 'active'
  );
  return ready;
}

async function configurePowerPolicy(resource, codec) {
  resource.node.port.postMessage({
    type: 'configurePowerPolicy',
    enabled: true,
    workletGraphGeneration: GRAPH_GENERATION,
    topologyRevision: TOPOLOGY_REVISION,
    silenceThresholdDb: -80,
    silenceDurationSeconds: 60,
    monitoringFastWakeEligible: true,
    temporalSkipEligible: true,
    enabledPluginCount: 1,
    monitoringPreparationCapabilities: [{
      pluginId: PLUGIN_ID,
      capability: 'reset-on-resume',
      descriptor: { primitive: 'canonical-reset', fixedOperations: 1 }
    }]
  });
  const configured = await resource.observer.waitFor(message =>
    message?.type === 'powerStateAck' && message.configured === true &&
    message.workletGraphGeneration === GRAPH_GENERATION &&
    message.topologyRevision === TOPOLOGY_REVISION
  );
  if (configured.monitoringFastWakeEligible !== true) {
    throw new Error(`${codec.label} temporal reset policy was not accepted.`);
  }
}

async function enterSkippedTransport(resource, codec) {
  resource.node.port.postMessage({
    type: 'setPowerProcessingState',
    state: 'active',
    processingDirective: 'zero-output-transport',
    commandId: SKIP_COMMAND_ID,
    skipEpoch: SKIP_EPOCH,
    workletGraphGeneration: GRAPH_GENERATION,
    topologyRevision: TOPOLOGY_REVISION
  });
  const ack = await resource.observer.waitFor(message =>
    message?.type === 'powerStateAck' && message.commandId === SKIP_COMMAND_ID
  );
  if (ack.commandAccepted !== true || ack.processingDirective !== 'zero-output-transport') {
    throw new Error(`${codec.label} skipped-transport command was not accepted.`);
  }
}

function requestProtocolResume(resource, ownerOperationId) {
  resource.node.port.postMessage({
    type: 'prepareTemporalStateAndResume',
    origin: 'deliberate',
    ownerOperationId,
    commandId: SKIP_COMMAND_ID,
    skipEpoch: SKIP_EPOCH,
    resumeCommandId: RESUME_COMMAND_ID,
    ackCommandId: `ack-${ownerOperationId}`,
    elapsedContinuity: 'unknown',
    suspendedElapsedMs: 0,
    resumeSampleRate: SAMPLE_RATE,
    workletGraphGeneration: GRAPH_GENERATION,
    topologyRevision: TOPOLOGY_REVISION
  });
  return resource.observer.waitFor(message =>
    message?.type === 'temporalStateResumed' &&
    message.ownerOperationId === ownerOperationId &&
    message.resumeCommandId === RESUME_COMMAND_ID
  );
}

function createCaptureGraph(context, resources) {
  const merger = new ChannelMergerNode(context, {
    numberOfInputs: resources.length * CHANNELS
  });
  const splitters = resources.map((resource, resourceIndex) => {
    const splitter = new ChannelSplitterNode(context, { numberOfOutputs: CHANNELS });
    resource.node.connect(splitter);
    for (let channel = 0; channel < CHANNELS; channel++) {
      splitter.connect(merger, channel, resourceIndex * CHANNELS + channel);
    }
    return splitter;
  });
  const capture = context.createScriptProcessor(1024, resources.length * CHANNELS, 1);
  const sink = new GainNode(context, { gain: 0 });
  merger.connect(capture).connect(sink).connect(context.destination);

  const samples = Array.from({ length: resources.length * CHANNELS }, () => []);
  let enabled = false;
  let resolveCapture = null;
  let captureTarget = 0;
  capture.onaudioprocess = event => {
    if (!enabled) return;
    for (let channel = 0; channel < samples.length; channel++) {
      samples[channel].push(...event.inputBuffer.getChannelData(channel));
    }
    if (resolveCapture && samples[0].length >= captureTarget) {
      const resolve = resolveCapture;
      resolveCapture = null;
      resolve();
    }
  };
  return {
    samples,
    captureFrames(frameCount) {
      captureTarget = frameCount;
      enabled = true;
      return new Promise((resolve, reject) => {
        resolveCapture = resolve;
        setTimeout(() => {
          if (resolveCapture !== resolve) return;
          resolveCapture = null;
          reject(new Error('Timed out while capturing AudioWorklet output.'));
        }, 10000);
      });
    },
    dispose() {
      enabled = false;
      capture.onaudioprocess = null;
      for (const splitter of splitters) splitter.disconnect();
      merger.disconnect();
      capture.disconnect();
      sink.disconnect();
    }
  };
}

/**
 * Runs the shared suspend/resume smoke for one compressed-codec simulator.
 *
 * @param {object} codec
 * @param {string} codec.pluginType registered plugin type, e.g. 'BluetoothSBCSimulatorPlugin'
 * @param {string} codec.label human readable name used in failure messages
 * @param {object} codec.parameters production parameter set passed to the generated packer
 * @param {Function} codec.pack generated parameter packer for this plugin type
 * @param {number} codec.paramsHash generated parameter layout hash for this plugin type
 * @param {number} codec.floatCount expected packed parameter float count
 */
export async function runCodecResumeWasmSmoke(codec) {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
  const resources = [];
  const sources = [];
  let captureGraph;
  try {
    if (context.sampleRate !== SAMPLE_RATE) {
      throw new Error(`Requested ${SAMPLE_RATE} Hz, received ${context.sampleRate} Hz.`);
    }
    await context.audioWorklet.addModule('/plugins/audio-processor.js');
    for (let index = 0; index < 3; index++) resources.push(createWorklet(context));
    captureGraph = createCaptureGraph(context, resources);
    await context.resume();

    const [artifactResponse, metadataResponse] = await Promise.all([
      fetch(ARTIFACT_URL),
      fetch(ARTIFACT_URL.replace(/\.wasm$/, '.meta.json'))
    ]);
    if (!artifactResponse.ok || !metadataResponse.ok) {
      throw new Error(`Unable to load the production ${codec.label} DSP artifact.`);
    }
    const metadata = await metadataResponse.json();
    const kernelMetadata = metadata.kernels?.find(kernel => kernel.name === codec.pluginType);
    if (!kernelMetadata) {
      throw new Error(`Production metadata does not identify the ${codec.label} kernel.`);
    }
    const testParamPackers = createDspParamPackers({
      DSP_PARAM_PACKERS: new Map([[
        codec.pluginType,
        { pack: codec.pack, hash: codec.paramsHash }
      ]])
    }, metadata.kernels);
    const packer = testParamPackers.get(codec.pluginType);
    if (!packer || packer.pack({}).length !== codec.floatCount) {
      throw new Error(`Unable to resolve the production ${codec.label} parameter packer.`);
    }
    const wasmBytes = await artifactResponse.arrayBuffer();
    const readyMessages = await Promise.all(resources.map(resource =>
      initializeWorklet(resource, codec, wasmBytes, packer)
    ));
    await Promise.all(resources.map(resource => configurePowerPolicy(resource, codec)));

    const prefixFrames = 24000;
    const prefix = new AudioBufferSourceNode(context, {
      buffer: createInputBuffer(context, prefixFrames)
    });
    sources.push(prefix);
    prefix.connect(resources[0].node);
    prefix.connect(resources[1].node);
    prefix.start(context.currentTime + 0.03);
    await wait(260);

    await Promise.all([resources[0], resources[2]].map(
      resource => enterSkippedTransport(resource, codec)
    ));
    prefix.stop();
    prefix.disconnect();
    await wait(40);
    await context.suspend();
    const suspendedState = context.state;

    const resetResume = requestProtocolResume(resources[0], 'reset-path');
    const freshResume = requestProtocolResume(resources[2], 'fresh-path');
    await context.resume();
    const resumedState = context.state;
    const [resetAck, freshAck] = await Promise.all([resetResume, freshResume]);

    const suffixFrames = 36000;
    const suffix = new AudioBufferSourceNode(context, {
      buffer: createInputBuffer(context, suffixFrames, prefixFrames)
    });
    sources.push(suffix);
    for (const resource of resources) suffix.connect(resource.node);
    const capturePromise = captureGraph.captureFrames(48000);
    suffix.start(context.currentTime + 0.08);
    await capturePromise;

    const resetOutput = [captureGraph.samples[0], captureGraph.samples[1]];
    const continuedOutput = [captureGraph.samples[2], captureGraph.samples[3]];
    const freshOutput = [captureGraph.samples[4], captureGraph.samples[5]];
    let exactResetMatches = 0;
    let continuedDifferences = 0;
    let nonZeroSamples = 0;
    let finiteSamples = 0;
    let sampleCount = 0;
    for (let channel = 0; channel < CHANNELS; channel++) {
      const available = Math.min(
        resetOutput[channel].length,
        continuedOutput[channel].length,
        freshOutput[channel].length
      );
      sampleCount += available;
      for (let index = 0; index < available; index++) {
        if (resetOutput[channel][index] === freshOutput[channel][index]) exactResetMatches++;
        if (continuedOutput[channel][index] !== freshOutput[channel][index]) {
          continuedDifferences++;
        }
        if (Math.abs(resetOutput[channel][index]) > 1e-7) nonZeroSamples++;
        if (Number.isFinite(resetOutput[channel][index]) &&
            Number.isFinite(continuedOutput[channel][index]) &&
            Number.isFinite(freshOutput[channel][index])) {
          finiteSamples++;
        }
      }
    }

    return {
      pluginType: codec.pluginType,
      actualSampleRate: context.sampleRate,
      suspendedState,
      resumedState,
      protocol: 'prepareTemporalStateAndResume',
      continuedReference: 'full-process-preserved-state',
      resetAckState: resetAck.state,
      resetPolicyCount: resetAck.appliedPolicyCounts?.resetOnResume,
      resetCoveredPluginCount: resetAck.coveredPluginCount,
      freshAckState: freshAck.state,
      freshPolicyCount: freshAck.appliedPolicyCounts?.resetOnResume,
      paramPackerSource: 'production-generated',
      paramPackerFloatCount: packer.pack({}).length,
      paramHashMatchesArtifact: packer.hash === (kernelMetadata.hash >>> 0),
      productionKernelCount: readyMessages[0].kernels.length,
      sampleCount,
      exactResetMatches,
      continuedDifferences,
      nonZeroSamples,
      finiteSamples,
      primedWhileSourceActive: true
    };
  } finally {
    captureGraph?.dispose();
    for (const source of sources) {
      try { source.stop(); } catch {}
      source.disconnect();
    }
    for (const resource of resources) {
      resource.observer.dispose();
      resource.node.disconnect();
    }
    await context.close();
  }
}
