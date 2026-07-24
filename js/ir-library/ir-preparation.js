import {
  buildIrAssetPayload,
  IR_ASSET_FORMAT_TAG,
  IR_ASSET_TOPOLOGY
} from './ir-asset-payload.js';
import { detectOnsetFromEnergies } from '../utils/measurement-dsp/onset.js';

const MAX_ANALYSIS_POINTS = 2000;
const DIRECT_CUT_FADE_FRAMES = 64;
const TRIM_FADE_FRAMES = 2048;

function validateRequest(request) {
  const channels = request?.channels;
  const sampleRate = request?.sampleRate;
  if (!Array.isArray(channels) || channels.length < 1 || channels.length > 8 ||
      !(channels[0] instanceof Float32Array) || channels[0].length === 0) {
    throw new TypeError('IR preparation requires 1 to 8 non-empty Float32Array channels');
  }
  const frames = channels[0].length;
  for (const channel of channels) {
    if (!(channel instanceof Float32Array) || channel.length !== frames) {
      throw new TypeError('IR preparation channels must have equal lengths');
    }
    for (const sample of channel) {
      if (!Number.isFinite(sample)) throw new TypeError('IR samples must be finite');
    }
  }
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 || sampleRate > 0xffffffff) {
    throw new TypeError('IR sample rate must be a positive 32-bit integer');
  }
  return { channels, frames, sampleRate };
}

function finiteNumber(value, fallback, name) {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) throw new TypeError(`${name} must be finite`);
  return resolved;
}

function resolveOptions(request, frames, channelCount) {
  const options = request.options || {};
  const directCut = options.directCut ?? false;
  const cutOffsetMs = finiteNumber(options.cutOffsetMs, 0, 'Cut offset');
  const decayPercent = finiteNumber(options.decayPercent, 100, 'Decay percent');
  const trimPercent = finiteNumber(options.trimPercent, 100, 'Trim percent');
  const analysisPoints = options.analysisPoints ?? MAX_ANALYSIS_POINTS;
  const maxFrames = options.maxFrames ?? frames;
  const topology = options.topology ??
    (channelCount === 1 ? IR_ASSET_TOPOLOGY.mono : IR_ASSET_TOPOLOGY.independent);
  const paths = options.paths;
  const onsetFrame = options.onsetFrame;

  if (typeof directCut !== 'boolean' || cutOffsetMs < -20 || cutOffsetMs > 50 ||
      decayPercent < 10 || decayPercent > 400 || trimPercent < 1 || trimPercent > 100 ||
      !Number.isSafeInteger(analysisPoints) || analysisPoints < 1 ||
      analysisPoints > MAX_ANALYSIS_POINTS || !Number.isSafeInteger(maxFrames) || maxFrames < 1 ||
      (onsetFrame !== undefined &&
        (!Number.isSafeInteger(onsetFrame) || onsetFrame < 0 || onsetFrame >= frames)) ||
      !Object.values(IR_ASSET_TOPOLOGY).includes(topology) ||
      topology === IR_ASSET_TOPOLOGY.unspecified) {
    throw new TypeError('IR preparation options are outside their supported ranges');
  }
  if (topology === IR_ASSET_TOPOLOGY.trueStereo && channelCount !== 4) {
    throw new TypeError('True-stereo preparation requires four IR channels');
  }

  return {
    directCut,
    cutOffsetMs,
    decayPercent,
    trimPercent,
    analysisPoints,
    maxFrames,
    onsetFrame,
    topology,
    paths
  };
}

function frameEnergies(channels, channelGains = null) {
  const energies = new Float64Array(channels[0].length);
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const channel = channels[channelIndex];
    const gain = channelGains?.[channelIndex] ?? 1;
    for (let frame = 0; frame < channel.length; frame += 1) {
      const sample = channel[frame] * gain;
      energies[frame] += sample * sample;
    }
  }
  return energies;
}

function channelEnergies(channels) {
  const energies = new Float64Array(channels.length);
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    let energy = 0;
    for (const sample of channels[channelIndex]) energy += sample * sample;
    energies[channelIndex] = energy;
  }
  return energies;
}

function normalizationGainsFromEnergies(energies, topology) {
  if (topology === IR_ASSET_TOPOLOGY.trueStereo) {
    let energy = 0;
    for (const channelEnergy of energies) energy += channelEnergy;
    const gain = energy > 0 ? Math.sqrt(energies.length / energy) : 1;
    return new Float32Array(energies.length).fill(gain);
  }
  const gains = new Float32Array(energies.length);
  for (let channelIndex = 0; channelIndex < energies.length; channelIndex += 1) {
    const energy = energies[channelIndex];
    gains[channelIndex] = energy > 0 ? 1 / Math.sqrt(energy) : 1;
  }
  return gains;
}

function normalizationGainsForTopology(channels, topology) {
  return normalizationGainsFromEnergies(channelEnergies(channels), topology);
}

function applyNormalizationGains(channels, gains) {
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const gain = gains[channelIndex];
    if (gain === 1) continue;
    const channel = channels[channelIndex];
    for (let frame = 0; frame < channel.length; frame += 1) channel[frame] *= gain;
  }
}

function applyFadeIn(channels) {
  const available = channels[0].length;
  const fadeFrames = available < DIRECT_CUT_FADE_FRAMES ? available : DIRECT_CUT_FADE_FRAMES;
  for (let frame = 0; frame < fadeFrames; frame += 1) {
    const phase = fadeFrames === 1 ? 1 : frame / (fadeFrames - 1);
    const gain = 0.5 - 0.5 * Math.cos(Math.PI * phase);
    for (const channel of channels) channel[frame] *= gain;
  }
}

function applyFadeOut(channels) {
  const available = channels[0].length;
  const fadeFrames = available < TRIM_FADE_FRAMES ? available : TRIM_FADE_FRAMES;
  const start = available - fadeFrames;
  for (let index = 0; index < fadeFrames; index += 1) {
    const gain = fadeOutGain(index, fadeFrames);
    for (const channel of channels) channel[start + index] *= gain;
  }
}

function fadeOutGain(index, fadeFrames) {
  const phase = fadeFrames === 1 ? 1 : index / (fadeFrames - 1);
  return 0.5 + 0.5 * Math.cos(Math.PI * phase);
}

function computeEdc(channels, channelGains = null) {
  const energies = frameEnergies(channels, channelGains);
  const accumulated = new Float64Array(energies.length);
  let total = 0;
  for (let frame = energies.length - 1; frame >= 0; frame -= 1) {
    total += energies[frame];
    accumulated[frame] = total;
  }
  return { accumulated, total };
}

function estimateRt60(channels, sampleRate, channelGains = null) {
  const { accumulated, total } = computeEdc(channels, channelGains);
  if (!(total > 0)) return null;
  let count = 0;
  let sumTime = 0;
  let sumDb = 0;
  let sumTimeDb = 0;
  let sumTimeSquared = 0;
  for (let frame = 0; frame < accumulated.length; frame += 1) {
    const db = 10 * Math.log10(accumulated[frame] / total);
    if (db > -5 || db < -35) continue;
    const time = frame / sampleRate;
    count += 1;
    sumTime += time;
    sumDb += db;
    sumTimeDb += time * db;
    sumTimeSquared += time * time;
  }
  const denominator = count * sumTimeSquared - sumTime * sumTime;
  if (count < 8 || denominator === 0) return null;
  const slope = (count * sumTimeDb - sumTime * sumDb) / denominator;
  return slope < 0 ? -60 / slope : null;
}

function decayShape(frames, sampleRate, decayPercent, rt60Seconds) {
  if (decayPercent === 100 || !(rt60Seconds > 0)) return null;
  const originalSlopeDbPerSecond = -60 / rt60Seconds;
  const extraSlope = originalSlopeDbPerSecond * (100 / decayPercent - 1);
  const endDb = extraSlope * (frames - 1) / sampleRate;
  const offsetDb = endDb > 0 ? endDb : 0;
  return { extraSlope, offsetDb };
}

function decayGain(shape, frame, sampleRate) {
  return shape ? 10 ** ((shape.extraSlope * frame / sampleRate - shape.offsetDb) / 20) : 1;
}

function shapeDecay(channels, sampleRate, shape, frameOffset = 0) {
  if (!shape) return;
  for (let frame = 0; frame < channels[0].length; frame += 1) {
    const gain = decayGain(shape, frame + frameOffset, sampleRate);
    for (const channel of channels) channel[frame] *= gain;
  }
}

function outputFrameCount(frames, trimPercent, maxFrames) {
  const requestedFrames = Math.round(frames * trimPercent / 100);
  let outputFrames = requestedFrames < 1 ? 1 : requestedFrames;
  if (outputFrames > maxFrames) outputFrames = maxFrames;
  return outputFrames;
}

function normalizationReference(channels, sampleRate, options) {
  const initialGains = normalizationGainsForTopology(channels, options.topology);
  const rt60Seconds = estimateRt60(channels, sampleRate, initialGains);
  const outputFrames = outputFrameCount(
    channels[0].length,
    options.trimPercent,
    options.maxFrames
  );
  const truncated = outputFrames < channels[0].length;
  const shape = decayShape(
    channels[0].length,
    sampleRate,
    options.decayPercent,
    rt60Seconds
  );

  const energies = new Float64Array(channels.length);
  const fadeFrames = truncated
    ? (outputFrames < TRIM_FADE_FRAMES ? outputFrames : TRIM_FADE_FRAMES)
    : 0;
  const fadeStart = outputFrames - fadeFrames;
  for (let frame = 0; frame < outputFrames; frame += 1) {
    const frameDecayGain = decayGain(shape, frame, sampleRate);
    let fadeGain = 1;
    if (truncated && frame >= fadeStart) {
      const index = frame - fadeStart;
      fadeGain = fadeOutGain(index, fadeFrames);
    }
    for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
      const sample = channels[channelIndex][frame] * initialGains[channelIndex] *
        frameDecayGain * fadeGain;
      energies[channelIndex] += sample * sample;
    }
  }

  return {
    initialGains,
    finalGains: normalizationGainsFromEnergies(energies, options.topology),
    shape
  };
}

function routedL1GainUpperBound(channelBounds, topology, paths) {
  if (topology === IR_ASSET_TOPOLOGY.mono) return channelBounds[0] || 0;
  if (topology === IR_ASSET_TOPOLOGY.trueStereo) {
    const left = (channelBounds[0] || 0) + (channelBounds[2] || 0);
    const right = (channelBounds[1] || 0) + (channelBounds[3] || 0);
    return left > right ? left : right;
  }
  if (topology === IR_ASSET_TOPOLOGY.matrix) {
    const outputBounds = new Float64Array(8);
    for (const path of paths || []) {
      outputBounds[path.outputSlot] += channelBounds[path.irChannel] || 0;
    }
    let maximum = 0;
    for (const bound of outputBounds) {
      if (bound > maximum) maximum = bound;
    }
    return maximum;
  }

  let maximum = 0;
  for (const bound of channelBounds) {
    if (bound > maximum) maximum = bound;
  }
  return maximum;
}

function analyze(channels, sampleRate, pointLimit, topology, paths) {
  const frames = channels[0].length;
  const pointCount = frames < pointLimit ? frames : pointLimit;
  const sampleFrames = new Uint32Array(pointCount);
  const envelope = new Float32Array(pointCount);
  const edcDb = new Float32Array(pointCount);
  const { accumulated, total } = computeEdc(channels);
  let peak = 0;
  const channelL1GainUpperBounds = new Float64Array(channels.length);

  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const channel = channels[channelIndex];
    let channelL1 = 0;
    for (const sample of channel) channelL1 += Math.abs(sample);
    channelL1GainUpperBounds[channelIndex] = channelL1;
  }
  const l1GainUpperBound = routedL1GainUpperBound(
    channelL1GainUpperBounds,
    topology,
    paths
  );

  for (let point = 0; point < pointCount; point += 1) {
    const start = Math.floor(point * frames / pointCount);
    let end = Math.floor((point + 1) * frames / pointCount);
    if (end <= start) end = start + 1;
    let binPeak = 0;
    for (let frame = start; frame < end; frame += 1) {
      for (const channel of channels) {
        const magnitude = Math.abs(channel[frame]);
        if (magnitude > binPeak) binPeak = magnitude;
        if (magnitude > peak) peak = magnitude;
      }
    }
    sampleFrames[point] = start;
    envelope[point] = binPeak;
    const ratio = total > 0 ? accumulated[start] / total : 0;
    const decayDb = ratio > 0 ? 10 * Math.log10(ratio) : -120;
    edcDb[point] = decayDb < -120 ? -120 : decayDb;
  }

  return {
    frames,
    sampleFrames,
    envelope,
    edcDb,
    rt60Seconds: estimateRt60(channels, sampleRate),
    peakDb: peak > 0 ? 20 * Math.log10(peak) : -120,
    l1GainUpperBound,
    l1GainUpperBoundDb: l1GainUpperBound > 0 ? 20 * Math.log10(l1GainUpperBound) : -120
  };
}

export function prepareIr(request) {
  const validated = validateRequest(request);
  const options = resolveOptions(request, validated.frames, validated.channels.length);
  const detected = detectOnsetFromEnergies(frameEnergies(validated.channels), validated.sampleRate);
  const onsetFrame = options.onsetFrame ?? detected.onsetFrame;
  const cutOffsetFrames = Math.round(options.cutOffsetMs * validated.sampleRate / 1000);
  let startFrame = detected.leadingSilenceFrames;
  let cutFrame = null;
  if (options.directCut) {
    cutFrame = onsetFrame + cutOffsetFrames;
    const afterCut = cutFrame + 1;
    if (afterCut > startFrame) startFrame = afterCut;
  }
  if (startFrame >= validated.frames) startFrame = validated.frames - 1;

  const reference = options.directCut
    ? normalizationReference(
      validated.channels.map(channel => channel.subarray(detected.leadingSilenceFrames)),
      validated.sampleRate,
      options
    )
    : null;
  let channels = validated.channels.map(channel => channel.slice(startFrame));
  if (options.directCut) applyFadeIn(channels);
  const initialNormalizationGains = reference?.initialGains ||
    normalizationGainsForTopology(channels, options.topology);
  applyNormalizationGains(channels, initialNormalizationGains);
  const originalAnalysis = analyze(
    channels,
    validated.sampleRate,
    options.analysisPoints,
    options.topology,
    options.paths
  );
  const shape = reference
    ? reference.shape
    : decayShape(
      channels[0].length,
      validated.sampleRate,
      options.decayPercent,
      originalAnalysis.rt60Seconds
    );
  const decayFrameOffset = reference ? startFrame - detected.leadingSilenceFrames : 0;
  shapeDecay(channels, validated.sampleRate, shape, decayFrameOffset);

  const outputFrames = outputFrameCount(
    channels[0].length,
    options.trimPercent,
    options.maxFrames
  );
  const truncated = outputFrames < channels[0].length;
  if (truncated) {
    channels = channels.map(channel => channel.slice(0, outputFrames));
    applyFadeOut(channels);
  }
  const finalNormalizationGains = reference?.finalGains ||
    normalizationGainsForTopology(channels, options.topology);
  applyNormalizationGains(channels, finalNormalizationGains);
  const analysis = analyze(
    channels,
    validated.sampleRate,
    options.analysisPoints,
    options.topology,
    options.paths
  );
  const payload = buildIrAssetPayload({
    channels,
    sampleRate: validated.sampleRate,
    topology: options.topology,
    paths: options.paths
  });

  return {
    channels,
    sampleRate: validated.sampleRate,
    frames: channels[0].length,
    topology: options.topology,
    payload,
    asset: {
      formatTag: IR_ASSET_FORMAT_TAG,
      channels: channels.length,
      frames: channels[0].length,
      sampleRate: validated.sampleRate,
      topology: options.topology,
      byteLength: payload.byteLength,
      pathCount: options.paths?.length || 0,
      inputCount: options.paths
        ? new Set(options.paths.map(path => path.inputSlot)).size
        : 0
    },
    analysis: {
      ...analysis,
      original: originalAnalysis,
      onsetFrame,
      leadingSilenceFrames: detected.leadingSilenceFrames,
      cutFrame,
      sourceStartFrame: startFrame,
      truncated,
      initialNormalizationGains,
      finalNormalizationGains
    }
  };
}

export function emitPreparedIr(request) {
  const validated = validateRequest(request);
  const options = request.options || {};
  const topology = options.topology ??
    (validated.channels.length === 1 ? IR_ASSET_TOPOLOGY.mono : IR_ASSET_TOPOLOGY.independent);
  const maxFrames = options.maxFrames ?? validated.frames;
  const analysisPoints = options.analysisPoints ?? MAX_ANALYSIS_POINTS;
  if (!Object.values(IR_ASSET_TOPOLOGY).includes(topology) ||
      topology === IR_ASSET_TOPOLOGY.unspecified ||
      !Number.isSafeInteger(maxFrames) || maxFrames < 1 ||
      !Number.isSafeInteger(analysisPoints) || analysisPoints < 1 ||
      analysisPoints > MAX_ANALYSIS_POINTS) {
    throw new TypeError('IR payload emission options are outside their supported ranges');
  }
  if (topology === IR_ASSET_TOPOLOGY.trueStereo && validated.channels.length !== 4) {
    throw new TypeError('True-stereo emission requires four IR channels');
  }

  let channels;
  if (topology === IR_ASSET_TOPOLOGY.mono && validated.channels.length > 1) {
    channels = [validated.channels[0].slice()];
  } else if (topology === IR_ASSET_TOPOLOGY.independent) {
    const assetChannels = options.assetChannels ?? validated.channels.length;
    if (!Number.isSafeInteger(assetChannels) || assetChannels < 1 ||
        assetChannels > validated.channels.length) {
      throw new TypeError('Independent IR emission requires a valid asset channel count');
    }
    channels = validated.channels.slice(0, assetChannels).map(channel => channel.slice());
  } else {
    channels = validated.channels.map(channel => channel.slice());
  }

  const outputFrames = Math.min(maxFrames, validated.frames);
  const truncated = outputFrames < validated.frames;
  if (truncated) {
    channels = channels.map(channel => channel.slice(0, outputFrames));
    applyFadeOut(channels);
  }
  const analysis = analyze(channels, validated.sampleRate, analysisPoints, topology, options.paths);
  const sourceAnalysis = request.analysis;
  const payload = buildIrAssetPayload({
    channels,
    sampleRate: validated.sampleRate,
    topology,
    paths: options.paths
  });

  return {
    channels,
    sampleRate: validated.sampleRate,
    frames: channels[0].length,
    topology,
    payload,
    asset: {
      formatTag: IR_ASSET_FORMAT_TAG,
      channels: channels.length,
      frames: channels[0].length,
      sampleRate: validated.sampleRate,
      topology,
      byteLength: payload.byteLength,
      pathCount: options.paths?.length || 0,
      inputCount: options.paths
        ? new Set(options.paths.map(path => path.inputSlot)).size
        : 0
    },
    analysis: {
      ...analysis,
      original: sourceAnalysis?.original || sourceAnalysis || analysis,
      onsetFrame: sourceAnalysis?.onsetFrame ?? 0,
      leadingSilenceFrames: sourceAnalysis?.leadingSilenceFrames ?? 0,
      cutFrame: sourceAnalysis?.cutFrame ?? null,
      sourceStartFrame: sourceAnalysis?.sourceStartFrame ?? 0,
      truncated,
      initialNormalizationGains: sourceAnalysis?.initialNormalizationGains || new Float32Array(channels.length).fill(1),
      finalNormalizationGains: sourceAnalysis?.finalNormalizationGains || new Float32Array(channels.length).fill(1)
    }
  };
}

export function getIrPreparationTransferables(result) {
  const buffers = new Set([result.payload]);
  for (const channel of result.channels) buffers.add(channel.buffer);
  for (const analysis of [result.analysis, result.analysis.original]) {
    buffers.add(analysis.sampleFrames.buffer);
    buffers.add(analysis.envelope.buffer);
    buffers.add(analysis.edcDb.buffer);
  }
  buffers.add(result.analysis.initialNormalizationGains.buffer);
  buffers.add(result.analysis.finalNormalizationGains.buffer);
  return [...buffers];
}
