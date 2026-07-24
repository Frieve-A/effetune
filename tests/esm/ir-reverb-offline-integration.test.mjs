import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { OfflineProcessor } from '../../js/audio/offline-processor.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import {
  IR_ASSET_FORMAT_TAG,
  IR_ASSET_TOPOLOGY,
  buildIrAssetPayload
} from '../../js/ir-library/ir-asset-payload.js';
import { estimateIrKernelCommitFootprint } from '../../js/ir-library/ir-plugin-contract.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

const SAMPLE_RATE = 96000;
const IR_SAMPLE_RATE = 48000;
const CHANNEL_COUNT = 2;
const BLOCK_SIZE = 128;
const TOTAL_FRAMES = 4096;
const DECLARED_TOLERANCE = 0.0002;
const META = JSON.parse(fs.readFileSync(
  new URL('../../plugins/dsp/effetune-dsp.meta.json', import.meta.url),
  'utf8'
));
const PACKER = DSP_PARAM_PACKERS.get('IRReverbPlugin');
const PARAMETERS = Object.freeze({
  enabled: true,
  cm: 'mono',
  lt: '128',
  cr: 'auto',
  dw: 0,
  dl: -96,
  pd: 0,
  inputBus: 0,
  outputBus: 0,
  channel: 'A'
});

function createIrAsset(topologyCase = 'mono', frameCount = 2048) {
  const samples = new Float32Array(frameCount);
  const taps = [0, 3, 31, 127, 128, 257, 599, 1201, 1801];
  taps.forEach((frame, index) => {
    if (frame < samples.length) samples[frame] = (index & 1 ? -1 : 1) * 0.7 / (index + 1);
  });
  let topology = IR_ASSET_TOPOLOGY.mono;
  let channels = [samples];
  let paths = [];
  let inputCount = 0;
  if (topologyCase === 'true') {
    topology = IR_ASSET_TOPOLOGY.trueStereo;
    channels = [1, 2, 3, 4].map(gain => Float32Array.from(samples, sample => sample * gain));
  } else if (topologyCase === 'independent') {
    topology = IR_ASSET_TOPOLOGY.independent;
    channels = [samples, Float32Array.from(samples, sample => sample * 0.5)];
  } else if (topologyCase === 'matrix') {
    topology = IR_ASSET_TOPOLOGY.matrix;
    channels = [samples, Float32Array.from(samples, sample => sample * 0.5)];
    paths = [
      { inputSlot: 0, outputSlot: 0, irChannel: 0 },
      { inputSlot: 0, outputSlot: 1, irChannel: 1 }
    ];
    inputCount = 1;
  }
  const payload = buildIrAssetPayload({
    channels,
    sampleRate: IR_SAMPLE_RATE,
    topology,
    paths
  });
  return {
    payload,
    formatTag: IR_ASSET_FORMAT_TAG,
    channels: channels.length,
    frames: samples.length,
    topology,
    headBlock: BLOCK_SIZE,
    rateDivider: 2,
    pathCount: paths.length,
    inputCount,
    processingChannels: CHANNEL_COUNT,
    footprintBytes: estimateIrKernelCommitFootprint({
      frames: samples.length,
      assetChannels: channels.length,
      topology,
      processingChannels: CHANNEL_COUNT,
      headBlock: BLOCK_SIZE,
      pathCount: paths.length,
      inputCount
    })
  };
}

function createInput({ leftOnly = false } = {}) {
  const input = new Float32Array(CHANNEL_COUNT * TOTAL_FRAMES);
  input[0] = 0.8;
  input[TOTAL_FRAMES] = leftOnly ? 0 : -0.6;
  input[701] = 0.35;
  input[TOTAL_FRAMES + 701] = leftOnly ? 0 : 0.35;
  return input;
}

function createStreamingInput(totalFrames = 8192) {
  const input = new Float32Array(CHANNEL_COUNT * totalFrames);
  let state = 0x12345678;
  for (let frame = 0; frame < totalFrames; frame++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const sample = ((state >>> 8) / 0x1000000 - 0.5) * 0.16;
    input[frame] = sample;
    input[totalFrames + frame] = sample;
  }
  return input;
}

class IRReverbPlugin {
  constructor(asset, parameters = PARAMETERS) {
    this.id = 7401;
    this.enabled = true;
    this.inputBus = 0;
    this.outputBus = 0;
    this.channel = 'A';
    this.asset = asset;
    this.parameters = parameters;
    this.jsProcessCalls = 0;
  }

  getParameters() {
    return this.parameters;
  }

  getWasmAssets() {
    return new Map([[0, this.asset]]);
  }

  executeProcessor(context, audio) {
    this.jsProcessCalls++;
    return audio;
  }
}

function blockFromPlanar(input, offset) {
  const block = new Float32Array(CHANNEL_COUNT * BLOCK_SIZE);
  for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
    block.set(
      input.subarray(channel * TOTAL_FRAMES + offset, channel * TOTAL_FRAMES + offset + BLOCK_SIZE),
      channel * BLOCK_SIZE
    );
  }
  return block;
}

function storePlanarBlock(output, block, offset) {
  for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
    output.set(
      block.subarray(channel * BLOCK_SIZE, (channel + 1) * BLOCK_SIZE),
      channel * TOTAL_FRAMES + offset
    );
  }
}

async function renderDirect(bytes, asset, input, { warmup, parameters = PARAMETERS }) {
  const binding = await instantiateDsp(bytes);
  try {
    assert.notEqual(binding.createEngine(), 0);
    assert.equal(binding.prepare(SAMPLE_RATE, CHANNEL_COUNT, BLOCK_SIZE, 0), 0);
    const instanceId = binding.createInstance('IRReverbPlugin');
    assert.notEqual(instanceId, 0);
    assert.equal(binding.instanceSetParams(instanceId, PACKER.pack(parameters), PACKER.hash), 0);
    assert.equal(binding.instanceSetAsset(
      instanceId,
      0,
      asset.payload,
      asset,
      asset.formatTag
    ), 0);

    let warmupBlocks = 0;
    if (warmup) {
      const silence = binding.getArenaViews().scratch.allChannels.subarray(
        0,
        CHANNEL_COUNT * BLOCK_SIZE
      );
      const pointer = binding.pointerForArenaView(silence);
      while ((binding.instanceAssetState(instanceId, 0) & 0xff) === 2 && warmupBlocks < 2000) {
        silence.fill(0);
        assert.equal(binding.instanceProcess(
          instanceId,
          pointer,
          CHANNEL_COUNT,
          BLOCK_SIZE,
          warmupBlocks * BLOCK_SIZE / SAMPLE_RATE
        ), 0);
        assert.ok(silence.every(sample => sample === 0), 'asset warm-up must stay silent');
        warmupBlocks++;
      }
      assert.equal(binding.instanceAssetState(instanceId, 0) & 0xff, 3);
      assert.ok(warmupBlocks > 0, 'synthetic IR must exercise asynchronous preparation');
      assert.equal(binding.resetInstance(instanceId), 0);
    }

    const output = new Float32Array(input.length);
    const scratch = binding.getArenaViews().scratch.allChannels.subarray(
      0,
      CHANNEL_COUNT * BLOCK_SIZE
    );
    const pointer = binding.pointerForArenaView(scratch);
    for (let offset = 0; offset < TOTAL_FRAMES; offset += BLOCK_SIZE) {
      scratch.set(blockFromPlanar(input, offset));
      assert.equal(binding.instanceProcess(
        instanceId,
        pointer,
        CHANNEL_COUNT,
        BLOCK_SIZE,
        offset / SAMPLE_RATE
      ), 0);
      storePlanarBlock(output, scratch, offset);
    }
    return { output, warmupBlocks };
  } finally {
    binding.close();
  }
}

async function renderDirectWithPattern(bytes, asset, input, blockPattern) {
  const totalFrames = input.length / CHANNEL_COUNT;
  const maxFrames = Math.max(...blockPattern);
  const binding = await instantiateDsp(bytes);
  try {
    assert.notEqual(binding.createEngine(), 0);
    assert.equal(binding.prepare(SAMPLE_RATE, CHANNEL_COUNT, maxFrames, 0), 0);
    const instanceId = binding.createInstance('IRReverbPlugin');
    assert.notEqual(instanceId, 0);
    assert.equal(binding.instanceSetParams(instanceId, PACKER.pack(PARAMETERS), PACKER.hash), 0);
    assert.equal(binding.instanceSetAsset(
      instanceId,
      0,
      asset.payload,
      asset,
      asset.formatTag
    ), 0);

    const output = new Float32Array(input.length);
    const scratch = binding.getArenaViews().scratch.allChannels.subarray(
      0,
      CHANNEL_COUNT * maxFrames
    );
    const pointer = binding.pointerForArenaView(scratch);
    let patternIndex = 0;
    for (let offset = 0; offset < totalFrames; patternIndex++) {
      const frames = Math.min(blockPattern[patternIndex % blockPattern.length], totalFrames - offset);
      for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
        scratch.set(
          input.subarray(
            channel * totalFrames + offset,
            channel * totalFrames + offset + frames
          ),
          channel * frames
        );
      }
      assert.equal(binding.instanceProcess(
        instanceId,
        pointer,
        CHANNEL_COUNT,
        frames,
        offset / SAMPLE_RATE
      ), 0);
      for (let channel = 0; channel < CHANNEL_COUNT; channel++) {
        output.set(
          scratch.subarray(channel * frames, (channel + 1) * frames),
          channel * totalFrames + offset
        );
      }
      offset += frames;
    }
    return {
      output,
      assetState: binding.instanceAssetState(instanceId, 0) & 0xff
    };
  } finally {
    binding.close();
  }
}

async function renderOfflineSession(bytes, asset, input, parameters = PARAMETERS) {
  const tracking = { warmupBlocks: 0, resetStates: [], assetMemoryGrowth: [] };
  const warnings = [];
  const plugin = new IRReverbPlugin(asset, parameters);
  const processor = new OfflineProcessor({}, {}, {
    async getModuleInfo() {
      return { bytes, meta: META, paramPackers: DSP_PARAM_PACKERS };
    },
    getDspRolloutConfig() {
      return { forceOff: false, enabledTypes: ['IRReverbPlugin'] };
    },
    async instantiateDsp(moduleOrBytes) {
      const binding = await instantiateDsp(moduleOrBytes);
      const setAsset = binding.instanceSetAsset.bind(binding);
      binding.instanceSetAsset = (...args) => {
        const previousMemory = binding.memory.buffer;
        const status = setAsset(...args);
        tracking.assetMemoryGrowth.push(binding.memory.buffer !== previousMemory);
        return status;
      };
      const processInstance = binding.instanceProcess.bind(binding);
      binding.instanceProcess = (...args) => {
        if ((binding.instanceAssetState(args[0], 0) & 0xff) === 2) tracking.warmupBlocks++;
        return processInstance(...args);
      };
      const resetInstance = binding.resetInstance.bind(binding);
      binding.resetInstance = instanceId => {
        tracking.resetStates.push(binding.instanceAssetState(instanceId, 0) & 0xff);
        return resetInstance(instanceId);
      };
      return binding;
    },
    warning(message) {
      warnings.push(message);
    }
  });

  return withGlobals({
    window: {
      audioPreferences: { useWasmDsp: true, outputChannels: CHANNEL_COUNT },
      location: { pathname: '/effetune.html', search: '' }
    }
  }, async () => {
    const session = await processor.createOfflineDspSession(
      [plugin],
      SAMPLE_RATE,
      CHANNEL_COUNT
    );
    assert.ok(session, 'offline IR session must be created');
    try {
      const entry = session.entries.get(plugin);
      assert.ok(entry && !entry.disabled, 'offline IR instance must remain native and enabled');
      assert.equal(session.binding.instanceAssetState(entry.instanceId, 0) & 0xff, 3);
      const output = new Float32Array(input.length);
      for (let offset = 0; offset < TOTAL_FRAMES; offset += BLOCK_SIZE) {
        const result = processor.tryProcessOfflineDspPipeline({
          session,
          pipeline: [plugin],
          inputBlock: blockFromPlanar(input, offset),
          sampleRate: SAMPLE_RATE,
          outputChannelCount: CHANNEL_COUNT,
          blockSize: BLOCK_SIZE,
          offset
        });
        assert.ok(result, 'offline IR block must use the native descriptor pipeline');
        storePlanarBlock(output, result, offset);
      }
      return { output, tracking, warnings, jsProcessCalls: plugin.jsProcessCalls };
    } finally {
      processor.destroyOfflineDspSession(session);
    }
  });
}

function maximumDifference(left, right) {
  let maximum = 0;
  for (let index = 0; index < left.length; index++) {
    const difference = Math.abs(left[index] - right[index]);
    if (difference > maximum) maximum = difference;
  }
  return maximum;
}

function maximumStereoGainError(output, rightGain) {
  const frames = output.length / CHANNEL_COUNT;
  let maximum = 0;
  for (let frame = 0; frame < frames; frame++) {
    const error = Math.abs(output[frames + frame] - output[frame] * rightGain);
    if (error > maximum) maximum = error;
  }
  return maximum;
}

function channelPeak(output, channel) {
  let peak = 0;
  const offset = channel * TOTAL_FRAMES;
  for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
    const magnitude = Math.abs(output[offset + frame]);
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`IR Reverb ${artifact} keeps preparation and activation independent of block size`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const asset = createIrAsset('independent');
    const input = createStreamingInput();
    const quantum = await renderDirectWithPattern(bytes, asset, input, [128]);
    const block512 = await renderDirectWithPattern(bytes, asset, input, [512]);
    const irregular = await renderDirectWithPattern(bytes, asset, input, [1, 63, 512, 17, 255, 127]);

    assert.equal(quantum.assetState, 3);
    assert.equal(block512.assetState, 3);
    assert.equal(irregular.assetState, 3);
    assert.ok(quantum.output.some(sample => Math.abs(sample) > 1e-5));
    assert.ok(maximumDifference(block512.output, quantum.output) <= 1e-7);
    assert.ok(maximumDifference(irregular.output, quantum.output) <= 1e-7);
    assert.ok(maximumStereoGainError(block512.output, 0.5) <= 1e-7);
    assert.ok(maximumStereoGainError(irregular.output, 0.5) <= 1e-7);
  });

  test(`IR Reverb offline ${artifact} refreshes arena views after asset memory growth`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const offline = await renderOfflineSession(
      bytes,
      createIrAsset('mono', 600_000),
      createInput()
    );
    assert.deepEqual(offline.tracking.assetMemoryGrowth, [true]);
    assert.ok(offline.tracking.warmupBlocks > 0);
    assert.deepEqual(offline.tracking.resetStates, [3]);
    assert.equal(offline.jsProcessCalls, 0);
    assert.deepEqual(offline.warnings, []);
  });

  test(`IR Reverb offline ${artifact} warms to ACTIVE, resets, and matches native direct`, async () => {
    const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
    const asset = createIrAsset();
    const input = createInput();
    const golden = await renderDirect(bytes, asset, input, { warmup: true });
    const withoutWarmup = await renderDirect(bytes, asset, input, { warmup: false });
    const offline = await renderOfflineSession(bytes, asset, input);

    assert.ok(offline.tracking.warmupBlocks > 0, 'offline session must process silent warm-up blocks');
    assert.deepEqual(offline.tracking.resetStates, [3], 'offline reset must follow ACTIVE commit');
    assert.equal(offline.jsProcessCalls, 0, 'offline render must not use the JavaScript fallback');
    assert.deepEqual(offline.warnings, []);
    assert.ok(
      maximumDifference(offline.output, golden.output) <= DECLARED_TOLERANCE,
      `offline output must match direct native within ${DECLARED_TOLERANCE}`
    );
    assert.ok(
      maximumDifference(withoutWarmup.output, golden.output) > DECLARED_TOLERANCE,
      'omitting asset warm-up must be observably different from the committed golden'
    );
  });

  for (const topologyCase of ['true', 'matrix']) {
    test(`IR Reverb offline ${artifact} preserves analytical ${topologyCase} routing`, async () => {
      const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
      const asset = createIrAsset(topologyCase);
      const parameters = {
        ...PARAMETERS,
        cm: topologyCase === 'true' ? 'true' : 'multi'
      };
      const input = createInput({ leftOnly: true });
      const direct = await renderDirect(bytes, asset, input, { warmup: true, parameters });
      const offline = await renderOfflineSession(bytes, asset, input, parameters);
      const leftPeak = channelPeak(offline.output, 0);
      const rightPeak = channelPeak(offline.output, 1);
      const expectedRatio = topologyCase === 'true' ? 2 : 0.5;

      assert.ok(offline.tracking.warmupBlocks > 0);
      assert.deepEqual(offline.tracking.resetStates, [3]);
      assert.equal(offline.jsProcessCalls, 0);
      assert.deepEqual(offline.warnings, []);
      assert.ok(offline.output.every(Number.isFinite));
      assert.ok(leftPeak > 1e-5 && rightPeak > 1e-5);
      assert.ok(Math.abs(rightPeak / leftPeak - expectedRatio) < 0.002);
      assert.ok(maximumDifference(offline.output, direct.output) <= DECLARED_TOLERANCE);
    });
  }
}
