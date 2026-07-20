import { IR_ASSET_HEADER_BYTES, IR_ASSET_TOPOLOGY } from './ir-asset-payload.js';

export const IR_ASSET_SLOT = 0;
export const IR_KERNEL_ASSET_CAPACITY_BYTES = 32 * 1024 * 1024;

const KERNEL_FIXED_FOOTPRINT_BYTES = 2 * 1024 * 1024;
const KERNEL_PATH_FRAME_BYTES = 16;
const CONVOLVER_IMPL_BYTES_UPPER_BOUND = 512;
const CONVOLVER_STAGE_BYTES_UPPER_BOUND = 512;
const PFFFT_SETUP_FIXED_BYTES_UPPER_BOUND = 136;
const MATRIX_PATH_BYTES = 12;

function topologyPathCount(topology, assetChannels, processingChannels, pathCount = 0) {
  if (topology === IR_ASSET_TOPOLOGY.mono) return processingChannels;
  if (topology === IR_ASSET_TOPOLOGY.trueStereo) return 4;
  if (topology === IR_ASSET_TOPOLOGY.matrix) return pathCount;
  return assetChannels;
}

function topologyInputCount(topology, processingChannels, inputCount = 0) {
  if (topology === IR_ASSET_TOPOLOGY.trueStereo) return 2;
  if (topology === IR_ASSET_TOPOLOGY.matrix) return inputCount;
  return processingChannels;
}

export function selectedIrChannelCount(channel, engineChannels) {
  if (!Number.isInteger(engineChannels) || engineChannels < 1 || engineChannels > 8) return 0;
  if (channel === 'A') return engineChannels;
  if (channel === null || channel === undefined) return engineChannels >= 2 ? 2 : 1;
  if (channel === 'L' || channel === 'R' || /^[1-8]$/.test(String(channel))) return 1;
  if (channel === '34') return engineChannels >= 4 ? 2 : 0;
  if (channel === '56') return engineChannels >= 6 ? 2 : 0;
  if (channel === '78') return engineChannels >= 8 ? 2 : 0;
  return 0;
}

function diagonalPaths(channelCount, selectedChannels) {
  const count = Math.min(channelCount, selectedChannels, 8);
  return Array.from({ length: count }, (_, index) => ({
    inputSlot: index,
    outputSlot: index,
    irChannel: index
  }));
}

function nextPowerOfTwo(value) {
  let result = 1;
  while (result < value) result *= 2;
  return result;
}

function convolutionStages(frames, headBlock) {
  const latency = headBlock ?? 128;
  if (![0, 128, 256, 512, 1024].includes(latency)) {
    throw new TypeError('IR head block must be a supported latency value');
  }
  const head = latency === 0 ? 128 : latency;
  const stages = [];
  const add = (block, offset, end) => {
    if (offset >= frames || end <= offset) return;
    stages.push({ block, offset, segmentFrames: Math.min(end, frames) - offset });
  };
  add(head, latency === 0 ? 128 : 0, 4 * head);
  for (let block = 2 * head; block < 4096; block *= 2) {
    add(block, 2 * block, 4 * block);
  }
  add(4096, 8192, frames);
  return { latency, stages };
}

export function estimateIrConvolverMemoryUpperBound({
  frames,
  assetChannels,
  topology,
  processingChannels,
  headBlock = 128,
  pathCount = 0,
  inputCount = 0
}) {
  const paths = topologyPathCount(topology, assetChannels, processingChannels, pathCount);
  const inputs = topologyInputCount(topology, processingChannels, inputCount);
  if (paths < 1 || inputs < 1) throw new TypeError('IR topology requires at least one path and input');
  const { latency, stages } = convolutionStages(frames, headBlock);
  let requiredRing = latency + 4096;
  let bytes = CONVOLVER_IMPL_BYTES_UPPER_BOUND;
  for (const stage of stages) {
    const required = latency + stage.offset + stage.block + 4096;
    if (required > requiredRing) requiredRing = required;
    const fft = 2 * stage.block;
    const partitions = Math.ceil(stage.segmentFrames / stage.block);
    const floatCount = 3 * inputs * stage.block + 2 * fft +
      (inputs + assetChannels) * partitions * fft + 2 * processingChannels * fft;
    bytes += CONVOLVER_STAGE_BYTES_UPPER_BOUND + floatCount * 4 +
      nextPowerOfTwo(paths) * 12 + PFFFT_SETUP_FIXED_BYTES_UPPER_BOUND + fft * 4;
  }
  bytes += processingChannels * nextPowerOfTwo(requiredRing) * 4;
  if (latency === 0) bytes += (assetChannels + inputs) * 128 * 4;
  bytes += inputs * 4;
  return bytes;
}

export function resolveIrProcessingConfig({
  sampleRate,
  channelCount,
  engineChannels = 8,
  selectedChannels,
  channel,
  topologyHint = '',
  channelMode = 'auto',
  latency = '128',
  convolutionRate = 'auto'
}) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { valid: false, message: 'The current audio sample rate is unavailable.' };
  }
  if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 8) {
    return { valid: false, message: 'This impulse response has an unsupported channel count.' };
  }
  const routedChannels = selectedChannels ?? selectedIrChannelCount(channel, engineChannels);
  if (!Number.isInteger(routedChannels) || routedChannels < 1 || routedChannels > engineChannels) {
    return { valid: false, message: 'The selected audio channels are not available.' };
  }
  if (!['auto', 'mono', 'indep', 'true', 'multi'].includes(channelMode)) {
    return { valid: false, message: 'Choose a supported channel mode.' };
  }

  const headBlock = Number(latency);
  if (![0, 128, 256, 512, 1024].includes(headBlock)) {
    return { valid: false, message: 'Choose a supported latency setting.' };
  }

  let rateMode = convolutionRate;
  if (headBlock === 0) rateMode = 'full';
  if (rateMode === 'auto') rateMode = sampleRate >= 88200 ? 'half' : 'full';
  if (!['full', 'half', 'quarter'].includes(rateMode)) {
    return { valid: false, message: 'Choose a supported convolution rate.' };
  }
  if (rateMode === 'quarter' && sampleRate < 176400) {
    return {
      valid: false,
      message: 'Quarter rate is available at sample rates of 176.4 kHz or higher.'
    };
  }

  const rateDivider = rateMode === 'quarter' ? 4 : rateMode === 'half' ? 2 : 1;
  let resolvedMode = channelMode;
  if (resolvedMode === 'auto') {
    if (channelCount === 1) resolvedMode = 'mono';
    else if (topologyHint === 'true-stereo' && channelCount === 4 && routedChannels === 2) {
      resolvedMode = 'true';
    } else if (channelCount === routedChannels) {
      resolvedMode = 'indep';
    } else {
      resolvedMode = 'multi';
    }
  }

  let topology;
  let assetChannels;
  let paths = [];
  if (resolvedMode === 'mono') {
    topology = IR_ASSET_TOPOLOGY.mono;
    assetChannels = 1;
  } else if (resolvedMode === 'true') {
    if (channelCount !== 4 || routedChannels !== 2) {
      return { valid: false, message: 'True Stereo requires a four-channel IR and a stereo channel selection.' };
    }
    topology = IR_ASSET_TOPOLOGY.trueStereo;
    assetChannels = 4;
  } else if (resolvedMode === 'indep') {
    if (channelCount < routedChannels) {
      return { valid: false, message: 'Independent mode requires one IR channel for each selected audio channel.' };
    }
    topology = IR_ASSET_TOPOLOGY.independent;
    assetChannels = routedChannels;
  } else {
    paths = diagonalPaths(channelCount, routedChannels);
    if (paths.length === 0) {
      return { valid: false, message: 'Matrix mode could not create a valid channel route.' };
    }
    topology = IR_ASSET_TOPOLOGY.matrix;
    assetChannels = channelCount;
  }
  const pathCount = topology === IR_ASSET_TOPOLOGY.matrix ? paths.length : 0;
  const inputCount = topology === IR_ASSET_TOPOLOGY.matrix
    ? new Set(paths.map(path => path.inputSlot)).size
    : 0;

  return {
    valid: true,
    channelMode: resolvedMode,
    topology,
    assetChannels,
    selectedChannels: routedChannels,
    processingChannels: routedChannels,
    paths,
    pathCount,
    inputCount,
    headBlock,
    rateMode,
    rateDivider,
    sampleRate: Math.round(sampleRate / rateDivider)
  };
}

export function estimateIrKernelCommitFootprint({
  frames,
  assetChannels,
  topology,
  processingChannels,
  headBlock,
  pathCount = 0,
  inputCount = 0
}) {
  if (!Number.isInteger(frames) || frames < 1 ||
      !Number.isInteger(assetChannels) || assetChannels < 1 ||
      !Number.isInteger(processingChannels) || processingChannels < 1) {
    throw new TypeError('IR footprint inputs must be positive integers');
  }
  const paths = topologyPathCount(topology, assetChannels, processingChannels, pathCount);
  const payloadBytes = IR_ASSET_HEADER_BYTES +
    (topology === IR_ASSET_TOPOLOGY.matrix ? paths * MATRIX_PATH_BYTES : 0) +
    frames * assetChannels * Float32Array.BYTES_PER_ELEMENT;
  const kernelBeginBound = payloadBytes + frames * assetChannels * KERNEL_PATH_FRAME_BYTES +
    KERNEL_FIXED_FOOTPRINT_BYTES;
  const convolverBound = payloadBytes + estimateIrConvolverMemoryUpperBound({
    frames,
    assetChannels,
    topology,
    processingChannels,
    headBlock,
    pathCount,
    inputCount
  });
  return Math.max(kernelBeginBound, convolverBound);
}

export function maximumIrFramesForKernel({
  sourceFrames,
  assetChannels,
  topology,
  processingChannels,
  headBlock,
  pathCount = 0,
  inputCount = 0,
  capacityBytes = IR_KERNEL_ASSET_CAPACITY_BYTES
}) {
  if (!Number.isInteger(sourceFrames) || sourceFrames < 1) return 1;
  let low = 1;
  let high = sourceFrames;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const footprint = estimateIrKernelCommitFootprint({
      frames: middle,
      assetChannels,
      topology,
      processingChannels,
      headBlock,
      pathCount,
      inputCount
    });
    if (footprint <= capacityBytes) low = middle;
    else high = middle - 1;
  }
  return low;
}
