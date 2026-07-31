const HEADER_BYTES = 16;
const LEVEL_FRAME = 1;
const SCOPE_FRAME = 3;
const SPECTRUM_FRAME = 4;
const SPECTROGRAM_FRAME = 5;
const STEREO_FRAME = 6;

const ANALYZER_FRAMES = Object.freeze({
  LevelMeter: [LEVEL_FRAME, 1],
  Oscilloscope: [SCOPE_FRAME, 2],
  SpectrumAnalyzer: [SPECTRUM_FRAME, 1],
  Spectrogram: [SPECTROGRAM_FRAME, 1],
  StereoMeter: [STEREO_FRAME, 2]
});

export const TELEMETRY_RING_BYTES = 256 * 1024;
export const TELEMETRY_RATE_HZ = 60;

export function supportsTelemetry(effectType) {
  return Object.hasOwn(ANALYZER_FRAMES, effectType);
}

function common(node, kind, sequence, dropped) {
  return {
    kind,
    effectType: node.effectType,
    effectId: node.effectId,
    effectIndex: node.effectIndex,
    sequence,
    dropped
  };
}

function decodeLevel(payload, node, sequence, dropped) {
  if (payload.byteLength < 16) return null;
  const channelCount = payload.getUint32(0, true);
  if (channelCount < 1 || channelCount > 8 || payload.byteLength !== 8 + channelCount * 8) {
    return null;
  }
  const clipFlags = payload.getUint32(4 + channelCount * 8, true);
  if ((clipFlags & ~((1 << channelCount) - 1)) !== 0) return null;
  const channels = new Array(channelCount);
  for (let channel = 0; channel < channelCount; channel++) {
    const offset = 4 + channel * 8;
    const peak = payload.getFloat32(offset, true);
    const rms = payload.getFloat32(offset + 4, true);
    if (!Number.isFinite(peak) || peak < 0 || !Number.isFinite(rms) || rms < 0) {
      return null;
    }
    channels[channel] = { peak, rms, clipped: (clipFlags & (1 << channel)) !== 0 };
  }
  return { ...common(node, 'level', sequence, dropped), channels };
}

function decodeOscilloscope(payload, node, sequence, dropped) {
  if (payload.byteLength < 20) return null;
  const sampleRate = payload.getFloat32(0, true);
  const captureSampleCount = payload.getUint32(4, true);
  const triggerOffset = payload.getUint32(8, true);
  const bucketCount = payload.getUint16(12, true);
  const encoding = payload.getUint8(14);
  const flags = payload.getUint8(15);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
      captureSampleCount < 1 || captureSampleCount > 65536 ||
      triggerOffset >= captureSampleCount || (flags & ~1) !== 0) {
    return null;
  }
  if (encoding === 0) {
    if (bucketCount !== 0 || captureSampleCount > 2048 ||
        payload.byteLength !== 16 + captureSampleCount * 4) {
      return null;
    }
    const sampleIndices = new Uint32Array(captureSampleCount);
    const values = new Float32Array(captureSampleCount);
    for (let index = 0; index < captureSampleCount; index++) {
      const value = payload.getFloat32(16 + index * 4, true);
      if (!Number.isFinite(value)) return null;
      sampleIndices[index] = index;
      values[index] = value;
    }
    return {
      ...common(node, 'oscilloscope', sequence, dropped),
      sampleRate,
      captureSampleCount,
      triggerOffset,
      triggered: (flags & 1) !== 0,
      encoding: 'samples',
      sampleIndices,
      values
    };
  }
  if (encoding !== 1 || captureSampleCount <= 2048 || bucketCount !== 512 ||
      payload.byteLength !== 16 + bucketCount * 18) {
    return null;
  }
  const sampleIndices = new Uint32Array(bucketCount * 4);
  const values = new Float32Array(bucketCount * 4);
  let pointCount = 0;
  const append = (sampleIndex, value) => {
    if (pointCount > 0 && sampleIndices[pointCount - 1] === sampleIndex) {
      return values[pointCount - 1] === value;
    }
    sampleIndices[pointCount] = sampleIndex;
    values[pointCount] = value;
    pointCount += 1;
    return true;
  };
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const begin = Math.floor(bucket * captureSampleCount / bucketCount);
    const end = Math.floor((bucket + 1) * captureSampleCount / bucketCount);
    const bucketLength = end - begin;
    const offset = 16 + bucket * 18;
    const first = payload.getFloat32(offset, true);
    const minimum = payload.getFloat32(offset + 4, true);
    const maximum = payload.getFloat32(offset + 8, true);
    const last = payload.getFloat32(offset + 12, true);
    const minimumOffset = payload.getUint8(offset + 16);
    const maximumOffset = payload.getUint8(offset + 17);
    if (!Number.isFinite(first) || !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) || !Number.isFinite(last) || minimum > maximum ||
        first < minimum || first > maximum || last < minimum || last > maximum ||
        minimumOffset >= bucketLength || maximumOffset >= bucketLength) {
      return null;
    }
    const minimumIndex = begin + minimumOffset;
    const maximumIndex = begin + maximumOffset;
    if (!append(begin, first)) return null;
    if (minimumIndex <= maximumIndex) {
      if (!append(minimumIndex, minimum) || !append(maximumIndex, maximum)) return null;
    } else if (!append(maximumIndex, maximum) || !append(minimumIndex, minimum)) {
      return null;
    }
    if (!append(end - 1, last)) return null;
  }
  return {
    ...common(node, 'oscilloscope', sequence, dropped),
    sampleRate,
    captureSampleCount,
    triggerOffset,
    triggered: (flags & 1) !== 0,
    encoding: 'minMax',
    sampleIndices: sampleIndices.slice(0, pointCount),
    values: values.slice(0, pointCount)
  };
}

function decodeSpectrum(payload, node, sequence, dropped) {
  if (payload.byteLength < 28) return null;
  const sampleRate = payload.getFloat32(0, true);
  const binCount = payload.getUint32(4, true);
  const points = payload.getUint16(8, true);
  const flags = payload.getUint16(10, true);
  const binsTruncated = (flags & 1) !== 0;
  const fullBinCount = points >= 8 && points <= 14 ? (1 << (points - 1)) + 1 : 0;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || fullBinCount === 0 ||
      (flags & ~1) !== 0 || payload.byteLength !== 12 + binCount * 8 ||
      (points === 14
        ? !binsTruncated || binCount !== 8190 || fullBinCount - binCount !== 3
        : binsTruncated || binCount !== fullBinCount)) {
    return null;
  }
  const currentDb = new Float32Array(binCount);
  const peakDb = new Float32Array(binCount);
  const peakOffset = 12 + binCount * 4;
  for (let bin = 0; bin < binCount; bin++) {
    const current = payload.getFloat32(12 + bin * 4, true);
    const peak = payload.getFloat32(peakOffset + bin * 4, true);
    if (!Number.isFinite(current) || !Number.isFinite(peak)) return null;
    currentDb[bin] = current;
    peakDb[bin] = peak;
  }
  return {
    ...common(node, 'spectrum', sequence, dropped),
    sampleRate,
    points,
    binsTruncated,
    currentDb,
    peakDb
  };
}

function decodeSpectrogram(payload, node, sequence, dropped) {
  if (payload.byteLength !== 268) return null;
  const sampleRate = payload.getFloat32(0, true);
  const timeSeconds = payload.getFloat32(4, true);
  const cellCount = payload.getUint16(8, true);
  const points = payload.getUint16(10, true);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || !Number.isFinite(timeSeconds) ||
      cellCount !== 256 || points < 8 || points > 14) {
    return null;
  }
  const intensities = new Uint8Array(256);
  for (let cell = 0; cell < 256; cell++) intensities[cell] = payload.getUint8(12 + cell);
  return {
    ...common(node, 'spectrogram', sequence, dropped),
    sampleRate,
    timeSeconds,
    points,
    intensities
  };
}

function decodeStereo(payload, node, sequence, dropped) {
  if (payload.byteLength < 1464) return null;
  const sampleRate = payload.getFloat32(0, true);
  const sampleCount = payload.getUint16(4, true);
  const flags = payload.getUint16(6, true);
  const expectedBytes = 8 + sampleCount * 8 + 360 * 4 + 16;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || sampleCount > 8000 ||
      (flags & ~1) !== 0 || payload.byteLength !== expectedBytes) {
    return null;
  }
  const samples = new Float32Array(sampleCount * 2);
  for (let sample = 0; sample < sampleCount; sample++) {
    const offset = 8 + sample * 8;
    const side = payload.getFloat32(offset, true);
    const mid = payload.getFloat32(offset + 4, true);
    if (!Number.isFinite(side) || !Number.isFinite(mid)) return null;
    samples[sample * 2] = side;
    samples[sample * 2 + 1] = mid;
  }
  const envelopeOffset = 8 + sampleCount * 8;
  const envelope = new Float32Array(360);
  for (let bin = 0; bin < 360; bin++) {
    const peak = payload.getFloat32(envelopeOffset + bin * 4, true);
    if (!Number.isFinite(peak) || peak < 0) return null;
    envelope[bin] = peak;
  }
  const statisticsOffset = envelopeOffset + 360 * 4;
  const correlation = payload.getFloat32(statisticsOffset, true);
  const balance = payload.getFloat32(statisticsOffset + 4, true);
  const peakLeft = payload.getFloat32(statisticsOffset + 8, true);
  const peakRight = payload.getFloat32(statisticsOffset + 12, true);
  if (!Number.isFinite(correlation) || correlation < -1 || correlation > 1 ||
      !Number.isFinite(balance) || !Number.isFinite(peakLeft) || peakLeft < 0 ||
      !Number.isFinite(peakRight) || peakRight < 0) {
    return null;
  }
  return {
    ...common(node, 'stereo', sequence, dropped),
    sampleRate,
    discontinuity: (flags & 1) !== 0,
    samples,
    envelope,
    correlation,
    balance,
    peakLeft,
    peakRight
  };
}

function decodePayload(frameType, payload, node, sequence, dropped) {
  switch (frameType) {
    case LEVEL_FRAME:
      return decodeLevel(payload, node, sequence, dropped);
    case SCOPE_FRAME:
      return decodeOscilloscope(payload, node, sequence, dropped);
    case SPECTRUM_FRAME:
      return decodeSpectrum(payload, node, sequence, dropped);
    case SPECTROGRAM_FRAME:
      return decodeSpectrogram(payload, node, sequence, dropped);
    case STEREO_FRAME:
      return decodeStereo(payload, node, sequence, dropped);
    default:
      return null;
  }
}

export function decodeTelemetryPacket(packet, bytes, nodesByTap, initialDropped = 0) {
  if (!(packet instanceof Uint8Array) || !Number.isInteger(bytes) ||
      bytes < 0 || bytes > packet.byteLength) {
    return { frames: [], pendingDropped: initialDropped };
  }
  const view = new DataView(packet.buffer, packet.byteOffset, bytes);
  const frames = [];
  let offset = 0;
  let pendingDropped = initialDropped;
  while (offset < bytes) {
    if (bytes - offset < HEADER_BYTES) break;
    const frameType = view.getUint16(offset, true);
    const formatVersion = view.getUint16(offset + 2, true);
    const tapId = view.getUint32(offset + 4, true);
    const sequence = view.getUint32(offset + 8, true);
    const payloadBytes = view.getUint16(offset + 12, true);
    const frameBytes = (HEADER_BYTES + payloadBytes + 3) & ~3;
    if (frameBytes > bytes - offset) break;
    const node = nodesByTap.get(tapId);
    const expected = node ? ANALYZER_FRAMES[node.effectType] : null;
    if (expected?.[0] === frameType && expected[1] === formatVersion) {
      const payload = new DataView(
        packet.buffer,
        packet.byteOffset + offset + HEADER_BYTES,
        payloadBytes
      );
      const decoded = decodePayload(frameType, payload, node, sequence, pendingDropped);
      if (decoded) {
        frames.push(decoded);
        pendingDropped = 0;
      }
    }
    offset += frameBytes;
  }
  return { frames, pendingDropped };
}

export function countTelemetryFrames(packet, bytes) {
  if (!(packet instanceof Uint8Array) || !Number.isInteger(bytes) ||
      bytes < 0 || bytes > packet.byteLength) {
    return 0;
  }
  const view = new DataView(packet.buffer, packet.byteOffset, bytes);
  let count = 0;
  let offset = 0;
  while (bytes - offset >= HEADER_BYTES) {
    const payloadBytes = view.getUint16(offset + 12, true);
    const frameBytes = (HEADER_BYTES + payloadBytes + 3) & ~3;
    if (frameBytes > bytes - offset) break;
    count += 1;
    offset += frameBytes;
  }
  return count;
}
