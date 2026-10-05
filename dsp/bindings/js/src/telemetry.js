const HEADER_BYTES = 16;
const LEVEL_FRAME = 1;
const SCOPE_FRAME = 3;
const SPECTRUM_FRAME = 4;
const SPECTROGRAM_FRAME = 5;
const STEREO_FRAME = 6;
const NOTE_SPECTROGRAM_FRAME = 24;
const PITCH_METER_FRAME = 26;
const ANALOG_METER_FRAME = 27;
const RHYTHM_ANALYZER_FRAME = 28;
const RHYTHM_ANALYZER_PAYLOAD_BYTES = 1344;
const RHYTHM_ANALYZER_TEMPOGRAM_BINS = 192;
const RHYTHM_ANALYZER_MAX_EVENTS = 16;
const TONAL_BALANCE_FRAME = 29;
const TONAL_BALANCE_PAYLOAD_BYTES = 1564;
const TONAL_BALANCE_BANDS = 41;
const TONAL_BALANCE_GRID_POINTS = 128;
const ANALOG_METER_LOUDNESS_MODE = 5;
const ANALOG_METER_MIN_DB = -240;
const PITCH_METER_MIN_DETECTED_MIDI = 20.5;
const PITCH_METER_MAX_DETECTED_MIDI = 108.5;
const MULTIRES_HQ_HEADER_BYTES = 48;
const MULTIRES_HQ_MIN_FREQUENCY = 20;
const MULTIRES_HQ_MAX_FREQUENCY = 40000;
const MULTIRES_HQ_SPECTRUM_CELLS = 2048;
const MULTIRES_HQ_SPECTROGRAM_CELLS = 256;

const ANALYZER_FRAMES = Object.freeze({
  AnalogMeter: [ANALOG_METER_FRAME, [1]],
  ChromaSpiral: [SPECTRUM_FRAME, [2]],
  LevelMeter: [LEVEL_FRAME, [1]],
  NoteSpectrogram: [NOTE_SPECTROGRAM_FRAME, [4]],
  Oscilloscope: [SCOPE_FRAME, [2]],
  PitchMeter: [PITCH_METER_FRAME, [1]],
  RhythmAnalyzer: [RHYTHM_ANALYZER_FRAME, [1]],
  SpectrumAnalyzer: [SPECTRUM_FRAME, [1, 2]],
  Spectrogram: [SPECTROGRAM_FRAME, [1, 2]],
  StereoMeter: [STEREO_FRAME, [2]],
  TonalBalanceEQ: [TONAL_BALANCE_FRAME, [1]]
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
  if (channelCount < 1 || channelCount > 16 || payload.byteLength !== 8 + channelCount * 8) {
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

function decodeMultiresHq(payload, node, sequence, dropped, frameType) {
  if (payload.byteLength < MULTIRES_HQ_HEADER_BYTES) return null;
  const sampleRate = payload.getFloat32(0, true);
  const points = payload.getUint16(4, true);
  const flags = payload.getUint16(6, true);
  const hop = payload.getUint32(8, true);
  const generation = payload.getUint32(12, true);
  const captureEnd = payload.getBigUint64(16, true);
  const frameIndex = payload.getUint32(24, true);
  const cellCount = payload.getUint32(28, true);
  const minFrequency = payload.getFloat32(32, true);
  const maxFrequency = payload.getFloat32(36, true);
  const firstValidIndex = payload.getUint32(40, true);
  const validCellCount = payload.getUint32(44, true);
  const isSpectrum = frameType === SPECTRUM_FRAME;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || points < 8 || points > 14 ||
      flags !== 0 || generation === 0) {
    return null;
  }
  const expectedCellCount = isSpectrum
    ? MULTIRES_HQ_SPECTRUM_CELLS
    : MULTIRES_HQ_SPECTROGRAM_CELLS;
  const size = 1 << points;
  const expectedHop = isSpectrum
    ? Math.max(size / 2, Math.ceil(sampleRate / 30))
    : size / 2;
  if (cellCount !== expectedCellCount || hop !== expectedHop ||
      minFrequency !== MULTIRES_HQ_MIN_FREQUENCY ||
      maxFrequency !== MULTIRES_HQ_MAX_FREQUENCY) {
    return null;
  }
  let expectedFirstValidIndex = cellCount;
  let expectedValidCellCount = 0;
  const logStep = Math.log(
    MULTIRES_HQ_MAX_FREQUENCY / MULTIRES_HQ_MIN_FREQUENCY
  ) / (cellCount - 1);
  for (let index = 0; index < cellCount; index++) {
    const ascending = isSpectrum ? index : cellCount - 1 - index;
    const frequency = ascending === cellCount - 1
      ? MULTIRES_HQ_MAX_FREQUENCY
      : MULTIRES_HQ_MIN_FREQUENCY * Math.exp(ascending * logStep);
    if (frequency <= sampleRate * 0.5) {
      if (expectedFirstValidIndex === cellCount) expectedFirstValidIndex = index;
      expectedValidCellCount += 1;
    }
  }
  if (expectedValidCellCount === 0) expectedFirstValidIndex = 0;
  const valueBytes = isSpectrum ? cellCount * 8 : cellCount;
  if (firstValidIndex !== expectedFirstValidIndex ||
      validCellCount !== expectedValidCellCount ||
      payload.byteLength !== MULTIRES_HQ_HEADER_BYTES + valueBytes) {
    return null;
  }
  const metadata = {
    sampleRate,
    points,
    hop,
    generation,
    captureEnd,
    frameIndex,
    cellCount,
    minFrequency,
    maxFrequency,
    firstValidIndex,
    validCellCount
  };
  if (isSpectrum) {
    const currentDb = new Float32Array(cellCount);
    const peakDb = new Float32Array(cellCount);
    const peakOffset = MULTIRES_HQ_HEADER_BYTES + cellCount * 4;
    for (let cell = 0; cell < cellCount; cell++) {
      const current = payload.getFloat32(MULTIRES_HQ_HEADER_BYTES + cell * 4, true);
      const peak = payload.getFloat32(peakOffset + cell * 4, true);
      if (!Number.isFinite(current) || !Number.isFinite(peak)) return null;
      currentDb[cell] = current;
      peakDb[cell] = peak;
    }
    return {
      ...common(node, 'spectrumHq', sequence, dropped),
      ...metadata,
      currentDb,
      peakDb
    };
  }
  const intensities = new Uint8Array(cellCount);
  for (let cell = 0; cell < cellCount; cell++) {
    intensities[cell] = payload.getUint8(MULTIRES_HQ_HEADER_BYTES + cell);
  }
  return {
    ...common(node, 'spectrogramHq', sequence, dropped),
    ...metadata,
    intensities
  };
}

function decodeNoteSpectrogram(payload, node, sequence, dropped) {
  if (payload.byteLength !== 5312) return null;
  const sampleRate = payload.getFloat32(0, true);
  const timeSeconds = payload.getFloat32(4, true);
  const pitchCount = payload.getUint16(8, true);
  const firstMidi = payload.getUint16(10, true);
  const hopSeconds = payload.getFloat32(12, true);
  const frameIndex = payload.getUint32(16, true);
  const divisionsPerSemitone = payload.getUint32(20, true);
  const generation = payload.getUint32(24, true);
  const revisionAge = payload.getUint32(28, true);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isFinite(timeSeconds) || timeSeconds < 0 ||
      pitchCount !== 440 || firstMidi !== 21 ||
      !Number.isFinite(hopSeconds) || hopSeconds <= 0 ||
      divisionsPerSemitone !== 5 || generation === 0 ||
      (revisionAge !== 0 && revisionAge !== 8)) {
    return null;
  }
  const levels = new Float32Array(pitchCount);
  const volumeDb = new Float32Array(pitchCount);
  for (let pitch = 0; pitch < pitchCount; pitch++) {
    const level = payload.getFloat32(32 + pitch * 4, true);
    if (!Number.isFinite(level) || level < 0 || level > 1) return null;
    levels[pitch] = level;
    const volume = payload.getFloat32(32 + (pitchCount + pitch) * 4, true);
    if (!Number.isFinite(volume)) return null;
    volumeDb[pitch] = volume;
  }
  let revisedLevels = null;
  if (revisionAge !== 0) {
    revisedLevels = new Float32Array(pitchCount);
    for (let pitch = 0; pitch < pitchCount; pitch++) {
      const level = payload.getFloat32(32 + (2 * pitchCount + pitch) * 4, true);
      if (!Number.isFinite(level) || level < 0 || level > 1) return null;
      revisedLevels[pitch] = level;
    }
  }
  return {
    ...common(node, 'noteSpectrogram', sequence, dropped),
    sampleRate,
    timeSeconds,
    firstMidi,
    hopSeconds,
    frameIndex,
    divisionsPerSemitone,
    generation,
    revisionAge,
    levels,
    volumeDb,
    revisedLevels
  };
}

function decodePitchMeter(payload, node, sequence, dropped) {
  if (payload.byteLength !== 44) return null;
  const sampleRate = payload.getFloat32(0, true);
  const timeSeconds = payload.getFloat32(4, true);
  const hopSeconds = payload.getFloat32(8, true);
  const frameIndex = payload.getUint32(12, true);
  const generation = payload.getUint32(16, true);
  const f0Hz = payload.getFloat32(20, true);
  const midi = payload.getFloat32(24, true);
  const cents = payload.getFloat32(28, true);
  const confidence = payload.getFloat32(32, true);
  const levelDb = payload.getFloat32(36, true);
  const flags = payload.getUint16(40, true);
  const reserved = payload.getUint16(42, true);
  const voiced = (flags & 1) !== 0;
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
      !Number.isFinite(timeSeconds) || timeSeconds < 0 ||
      !Number.isFinite(hopSeconds) || hopSeconds <= 0 || generation === 0 ||
      !Number.isFinite(f0Hz) || !Number.isFinite(midi) ||
      !Number.isFinite(cents) || !Number.isFinite(confidence) ||
      confidence < 0 || confidence > 1 || !Number.isFinite(levelDb) ||
      (flags & ~1) !== 0 || reserved !== 0 ||
      (voiced
        ? f0Hz <= 0 || midi < PITCH_METER_MIN_DETECTED_MIDI ||
          midi > PITCH_METER_MAX_DETECTED_MIDI || cents < -50 || cents > 50
        : f0Hz !== 0 || midi !== 0 || cents !== 0 || confidence !== 0)) {
    return null;
  }
  return {
    ...common(node, 'pitch', sequence, dropped),
    sampleRate,
    timeSeconds,
    hopSeconds,
    frameIndex,
    generation,
    f0Hz,
    midi,
    cents,
    confidence,
    levelDb,
    voiced
  };
}

function decodeAnalogMeter(payload, node, sequence, dropped) {
  if (payload.byteLength < 12) return null;
  const mode = payload.getUint8(0);
  const channelCount = payload.getUint8(1);
  const flags = payload.getUint16(2, true);
  const loudness = mode === ANALOG_METER_LOUDNESS_MODE;
  const programOffset = 4 + channelCount * 8;
  if (mode > ANALOG_METER_LOUDNESS_MODE || channelCount < 1 || channelCount > 16 ||
      (flags & ~(loudness ? 3 : 0)) !== 0 ||
      payload.byteLength !== programOffset + (loudness ? 24 : 0)) {
    return null;
  }
  const level = offset => {
    const value = payload.getFloat32(offset, true);
    return Number.isFinite(value) && value >= ANALOG_METER_MIN_DB ? value : null;
  };
  const channels = new Array(channelCount);
  for (let channel = 0; channel < channelCount; channel++) {
    const needleDb = level(4 + channel * 8);
    const maxDb = level(8 + channel * 8);
    if (needleDb === null || maxDb === null) return null;
    channels[channel] = { needleDb, maxDb };
  }
  const integratedValid = (flags & 1) !== 0;
  const lraValid = (flags & 2) !== 0;
  let program = null;
  if (loudness) {
    const momentary = level(programOffset);
    const shortTerm = level(programOffset + 4);
    const integrated = payload.getFloat32(programOffset + 8, true);
    const lra = payload.getFloat32(programOffset + 12, true);
    const maxTruePeak = level(programOffset + 16);
    const integratedSeconds = payload.getFloat32(programOffset + 20, true);
    if (momentary === null || shortTerm === null || maxTruePeak === null ||
        !Number.isFinite(integratedSeconds) || integratedSeconds < 0 ||
        (integratedValid
          ? !Number.isFinite(integrated) || integrated < ANALOG_METER_MIN_DB
          : integrated !== 0) ||
        (lraValid ? !Number.isFinite(lra) || lra < 0 : lra !== 0)) {
      return null;
    }
    program = { momentary, shortTerm, integrated, lra, maxTruePeak, integratedSeconds };
  }
  return {
    ...common(node, 'analogMeter', sequence, dropped),
    mode,
    channelCount,
    integratedValid,
    lraValid,
    channels,
    program
  };
}

function decodeRhythmAnalyzer(payload, node, sequence, dropped) {
  if (payload.byteLength !== RHYTHM_ANALYZER_PAYLOAD_BYTES) return null;
  const f32 = offset => payload.getFloat32(offset, true);
  const u32 = offset => payload.getUint32(offset, true);
  const sampleRate = f32(0);
  const generation = u32(4);
  const envelopeHopSamples = u32(8);
  const envelopeFrameCount = u32(12);
  const timeSeconds = f32(16);
  const latencySeconds = f32(20);
  const droppedEvents = u32(24);
  const eventCount = u32(28);
  const trackerFlags = u32(32);
  const locked = (trackerFlags & 1) !== 0;
  const lockEpoch = u32(36);
  const confidence = f32(40);
  const periodSeconds = f32(44);
  const nextBeatFrame = u32(48);
  const nextBeatFraction = f32(52);
  const nextBeatIndex = u32(56);
  const combBestBpm = f32(60);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 || generation === 0 ||
      envelopeHopSamples === 0 || !Number.isFinite(timeSeconds) ||
      !Number.isFinite(latencySeconds) || latencySeconds < 0 ||
      eventCount > RHYTHM_ANALYZER_MAX_EVENTS || (trackerFlags & ~1) !== 0 ||
      !Number.isFinite(confidence) || confidence < 0 ||
      !Number.isFinite(combBestBpm) || combBestBpm < 0 ||
      (locked
        ? !Number.isFinite(periodSeconds) || periodSeconds <= 0 ||
          !(nextBeatFraction >= 0 && nextBeatFraction < 1)
        : periodSeconds !== 0 || nextBeatFrame !== 0 || nextBeatFraction !== 0 ||
          nextBeatIndex !== 0)) {
    return null;
  }
  const tempogram = new Float32Array(RHYTHM_ANALYZER_TEMPOGRAM_BINS);
  for (let bin = 0; bin < RHYTHM_ANALYZER_TEMPOGRAM_BINS; bin++) {
    const value = f32(64 + bin * 4);
    if (!(value >= 0 && value <= 1)) return null;
    tempogram[bin] = value;
  }
  const events = new Array(eventCount);
  for (let index = 0; index < eventCount; index++) {
    const offset = 832 + index * 32;
    const fraction = f32(offset + 4);
    const beatFraction = f32(offset + 16);
    const eventPeriod = f32(offset + 20);
    const strength = f32(offset + 24);
    const band = payload.getUint8(offset + 28);
    const flags = payload.getUint8(offset + 29);
    if (!(fraction >= 0 && fraction < 1) || !(beatFraction >= 0 && beatFraction < 1) ||
        !Number.isFinite(eventPeriod) || eventPeriod < 0 ||
        !Number.isFinite(strength) || strength <= 0 || band > 2 ||
        (flags & ~1) !== 0 || payload.getUint16(offset + 30, true) !== 0) {
      return null;
    }
    events[index] = {
      frame: u32(offset),
      fraction,
      lockEpoch: u32(offset + 8),
      beatIndex: payload.getInt32(offset + 12, true),
      beatFraction,
      periodSeconds: eventPeriod,
      strength,
      band,
      unlocked: (flags & 1) !== 0
    };
  }
  return {
    ...common(node, 'rhythmAnalyzer', sequence, dropped),
    sampleRate,
    generation,
    envelopeHopSamples,
    envelopeFrameCount,
    timeSeconds,
    latencySeconds,
    droppedEvents,
    locked,
    lockEpoch,
    confidence,
    periodSeconds,
    nextBeatFrame,
    nextBeatFraction,
    nextBeatIndex,
    combBestBpm,
    tempogram,
    events
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

function decodeTonalBalance(payload, node, sequence, dropped) {
  if (payload.byteLength !== TONAL_BALANCE_PAYLOAD_BYTES) return null;
  const sampleRate = payload.getFloat32(0, true);
  const stateFlags = payload.getUint8(8);
  const loudnessValid = (stateFlags & 4) !== 0;
  const loudnessLkfs = payload.getFloat32(12, true);
  const makeupDb = payload.getFloat32(16, true);
  if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
      payload.getUint16(4, true) !== TONAL_BALANCE_BANDS ||
      payload.getUint16(6, true) !== TONAL_BALANCE_GRID_POINTS ||
      (stateFlags & ~15) !== 0 || payload.getUint16(10, true) !== 0 ||
      (loudnessValid ? !Number.isFinite(loudnessLkfs) : loudnessLkfs !== 0) ||
      !Number.isFinite(makeupDb) ||
      payload.getUint8(1049) !== 0 || payload.getUint16(1050, true) !== 0) {
    return null;
  }
  const floats = (offset, count, min = -Infinity, max = Infinity) => {
    const values = new Float32Array(count);
    for (let index = 0; index < count; index++) {
      const value = payload.getFloat32(offset + index * 4, true);
      if (!Number.isFinite(value) || value < min || value > max) return null;
      values[index] = value;
    }
    return values;
  };
  const levelDb = floats(24, TONAL_BALANCE_BANDS);
  const persistence = floats(188, TONAL_BALANCE_BANDS, 0, 1);
  const presence = floats(352, TONAL_BALANCE_BANDS, 0, 1);
  const commandDb = floats(516, TONAL_BALANCE_BANDS);
  const targetMuDb = floats(680, TONAL_BALANCE_BANDS);
  const targetSigmaDb = floats(844, TONAL_BALANCE_BANDS, 0);
  const responseDb = floats(1052, TONAL_BALANCE_GRID_POINTS);
  const bandFlags = new Uint8Array(payload.buffer, payload.byteOffset + 1008, TONAL_BALANCE_BANDS)
    .slice();
  if (!levelDb || !persistence || !presence || !commandDb || !targetMuDb ||
      !targetSigmaDb || !responseDb || bandFlags.some(flags => (flags & ~31) !== 0)) {
    return null;
  }
  return {
    ...common(node, 'tonalBalance', sequence, dropped),
    sampleRate,
    targetIndex: payload.getUint8(9),
    absoluteGate: (stateFlags & 1) !== 0,
    relativeGate: (stateFlags & 2) !== 0,
    loudnessValid,
    targetValid: (stateFlags & 8) !== 0,
    loudnessLkfs,
    makeupDb,
    gatedHopCount: payload.getUint32(20, true),
    levelDb,
    persistence,
    presence,
    commandDb,
    targetMuDb,
    targetSigmaDb,
    bandFlags,
    responseDb
  };
}

function decodePayload(frameType, formatVersion, payload, node, sequence, dropped) {
  if (formatVersion === 2 &&
      (frameType === SPECTRUM_FRAME || frameType === SPECTROGRAM_FRAME)) {
    return decodeMultiresHq(payload, node, sequence, dropped, frameType);
  }
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
    case NOTE_SPECTROGRAM_FRAME:
      return decodeNoteSpectrogram(payload, node, sequence, dropped);
    case PITCH_METER_FRAME:
      return decodePitchMeter(payload, node, sequence, dropped);
    case ANALOG_METER_FRAME:
      return decodeAnalogMeter(payload, node, sequence, dropped);
    case RHYTHM_ANALYZER_FRAME:
      return decodeRhythmAnalyzer(payload, node, sequence, dropped);
    case TONAL_BALANCE_FRAME:
      return decodeTonalBalance(payload, node, sequence, dropped);
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
    if (expected?.[0] === frameType && expected[1].includes(formatVersion)) {
      const payload = new DataView(
        packet.buffer,
        packet.byteOffset + offset + HEADER_BYTES,
        payloadBytes
      );
      const decoded = decodePayload(
        frameType, formatVersion, payload, node, sequence, pendingDropped
      );
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
