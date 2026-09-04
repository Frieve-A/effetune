import { parsePcmWaveFormatFromBytes } from '../../library/metadata/riff-info.js';

export const PCM16_STEREO_44100_TO_96000_PROFILE = Object.freeze({
  id: 'pcm16le-stereo-native-fragment-electron44-chromium152-v1',
  codec: 'native-decode-audio-data-pcm16le-stereo-v1',
  sourceSampleRate: 44100,
  outputSampleRate: 96000,
  channelCount: 2,
  sourceStepNumerator: 147,
  sourceStepDenominator: 320,
  logicalSourceFrames: 22050,
  logicalOutputFrames: 48000,
  guardSourceFrames: 22050,
  maxFragmentSourceFrames: 66150,
  maxFragmentByteLength: 264644,
  maxDecodedOutputFrames: 144000,
  maxDecodedPcmBytes: 1152000,
  boundary: 'bounded-native-fragment-with-available-guard',
  runtime: Object.freeze({ electron: '44', chromium: '152' })
});

export function createPcm16WaveFragmentSource(sourceBytes, {
  outputSampleRate = PCM16_STEREO_44100_TO_96000_PROFILE.outputSampleRate
} = {}) {
  const bytes = normalizeBytes(sourceBytes);
  const format = parsePcmWaveFormatFromBytes(bytes);
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  if (!bytes || !format || format.bitsPerSample !== 16 ||
      format.channelCount !== profile.channelCount ||
      format.sampleRate !== profile.sourceSampleRate ||
      outputSampleRate !== profile.outputSampleRate) {
    return null;
  }
  const totalFrames = sourceToOutputFrames(format.sourceFrames, profile, 'floor');
  if (totalFrames === null || totalFrames <= 0) return null;

  return Object.freeze({
    profile,
    sourceSampleRate: format.sampleRate,
    outputSampleRate,
    channelCount: format.channelCount,
    sourceTotalFrames: format.sourceFrames,
    totalFrames,
    sourceByteLength: bytes.byteLength,
    dataOffset: format.dataOffset,
    dataByteLength: format.dataByteLength,
    bitsPerSample: format.bitsPerSample,
    blockAlign: format.blockAlign,
    createFragment(outputStartFrame, outputFrameCount) {
      const plan = planPcm16WaveFragment({
        sourceTotalFrames: format.sourceFrames,
        outputStartFrame,
        outputFrameCount,
        profile
      });
      if (!plan) throw new RangeError('PCM fragment range is outside the output lattice');
      const fragmentBytes = createPcm16WaveBytes(bytes, format, plan);
      if (fragmentBytes.byteLength !== plan.fragmentByteLength ||
          fragmentBytes.byteLength > profile.maxFragmentByteLength) {
        throw new RangeError('PCM fragment exceeds its bounded byte contract');
      }
      return Object.freeze({ ...plan, fragmentBytes });
    }
  });
}

export function planPcm16WaveFragment({
  sourceTotalFrames,
  outputStartFrame,
  outputFrameCount,
  profile = PCM16_STEREO_44100_TO_96000_PROFILE
}) {
  if (!Number.isSafeInteger(sourceTotalFrames) || sourceTotalFrames <= 0 ||
      !Number.isSafeInteger(outputStartFrame) || outputStartFrame < 0 ||
      !Number.isSafeInteger(outputFrameCount) || outputFrameCount <= 0 ||
      outputFrameCount > profile.logicalOutputFrames) {
    return null;
  }
  const totalFrames = sourceToOutputFrames(sourceTotalFrames, profile, 'floor');
  if (totalFrames === null || outputStartFrame > totalFrames - outputFrameCount) return null;
  const logicalSourceStartFrame = outputToSourceFrames(outputStartFrame, profile, 'ceil');
  const logicalSourceEndFrame = outputToSourceFrames(
    outputStartFrame + outputFrameCount,
    profile,
    'ceil'
  );
  if (logicalSourceStartFrame === null || logicalSourceEndFrame === null ||
      sourceToOutputFrames(logicalSourceStartFrame, profile, 'floor') !== outputStartFrame ||
      sourceToOutputFrames(logicalSourceEndFrame, profile, 'floor') !==
        outputStartFrame + outputFrameCount ||
      logicalSourceEndFrame <= logicalSourceStartFrame ||
      logicalSourceEndFrame > sourceTotalFrames) return null;
  const logicalSourceFrameCount = logicalSourceEndFrame - logicalSourceStartFrame;
  if (logicalSourceFrameCount > profile.logicalSourceFrames) return null;
  const fragmentSourceStartFrame = logicalSourceStartFrame > profile.guardSourceFrames
    ? logicalSourceStartFrame - profile.guardSourceFrames
    : 0;
  const guardedEnd = logicalSourceEndFrame + profile.guardSourceFrames;
  const fragmentSourceEndFrame = guardedEnd < sourceTotalFrames
    ? guardedEnd
    : sourceTotalFrames;
  const fragmentSourceFrameCount = fragmentSourceEndFrame - fragmentSourceStartFrame;
  const cropStartFrame = sourceToOutputFrames(
    logicalSourceStartFrame - fragmentSourceStartFrame,
    profile,
    'floor'
  );
  const decodedOutputFrameCount = sourceToOutputFrames(
    fragmentSourceFrameCount,
    profile,
    'floor'
  );
  const fragmentDataByteLength = fragmentSourceFrameCount * profile.channelCount *
    Int16Array.BYTES_PER_ELEMENT;
  const fragmentByteLength = 44 + fragmentDataByteLength;
  if (![cropStartFrame, decodedOutputFrameCount, fragmentDataByteLength, fragmentByteLength]
    .every(Number.isSafeInteger) ||
      fragmentSourceFrameCount > profile.maxFragmentSourceFrames ||
      decodedOutputFrameCount > profile.maxDecodedOutputFrames ||
      cropStartFrame + outputFrameCount > decodedOutputFrameCount ||
      fragmentByteLength > profile.maxFragmentByteLength) {
    return null;
  }
  return Object.freeze({
    outputStartFrame,
    outputFrameCount,
    logicalSourceStartFrame,
    logicalSourceFrameCount,
    fragmentSourceStartFrame,
    fragmentSourceFrameCount,
    cropStartFrame,
    decodedOutputFrameCount,
    fragmentByteLength
  });
}

export function sourceToOutputFrames(
  sourceFrames,
  profile = PCM16_STEREO_44100_TO_96000_PROFILE,
  rounding = 'floor'
) {
  return scaleFrames(
    sourceFrames,
    profile.sourceStepDenominator,
    profile.sourceStepNumerator,
    rounding
  );
}

export function outputToSourceFrames(
  outputFrames,
  profile = PCM16_STEREO_44100_TO_96000_PROFILE,
  rounding = 'floor'
) {
  return scaleFrames(
    outputFrames,
    profile.sourceStepNumerator,
    profile.sourceStepDenominator,
    rounding
  );
}

export function normalizePcm16WaveSeekFrame(
  requestedOutputFrame,
  sourceTotalFrames,
  profile = PCM16_STEREO_44100_TO_96000_PROFILE
) {
  const totalFrames = sourceToOutputFrames(sourceTotalFrames, profile, 'floor');
  if (!Number.isSafeInteger(requestedOutputFrame) || requestedOutputFrame < 0 ||
      totalFrames === null || requestedOutputFrame > totalFrames) return null;
  const sourceFrame = requestedOutputFrame === totalFrames
    ? sourceTotalFrames
    : alignSourceFrameToLattice(
      outputToSourceFrames(requestedOutputFrame, profile, 'floor'),
      profile
    );
  const adoptedOutputFrame = sourceToOutputFrames(sourceFrame, profile, 'floor');
  return sourceFrame === null || adoptedOutputFrame === null
    ? null
    : Object.freeze({ requestedOutputFrame, sourceFrame, adoptedOutputFrame });
}

export function normalizePcm16WaveFillTarget(
  outputStartFrame,
  requestedOutputFrame,
  sourceTotalFrames,
  profile = PCM16_STEREO_44100_TO_96000_PROFILE
) {
  const startSourceFrame = outputToSourceFrames(outputStartFrame, profile, 'ceil');
  const totalFrames = sourceToOutputFrames(sourceTotalFrames, profile, 'floor');
  if (startSourceFrame === null ||
      sourceToOutputFrames(startSourceFrame, profile, 'floor') !== outputStartFrame ||
      totalFrames === null ||
      !Number.isSafeInteger(requestedOutputFrame) ||
      requestedOutputFrame < outputStartFrame || requestedOutputFrame > totalFrames) return null;
  if (requestedOutputFrame === outputStartFrame) return outputStartFrame;
  const requestedSourceEnd = outputToSourceFrames(requestedOutputFrame, profile, 'ceil');
  if (requestedSourceEnd === null) return null;
  const sourceFramesNeeded = requestedSourceEnd - startSourceFrame;
  const fragmentCount = Math.ceil(sourceFramesNeeded / profile.logicalSourceFrames);
  const candidateSourceEnd = Math.min(
    sourceTotalFrames,
    startSourceFrame + fragmentCount * profile.logicalSourceFrames
  );
  let target = sourceToOutputFrames(candidateSourceEnd, profile, 'floor');
  if (target !== null && target < requestedOutputFrame && candidateSourceEnd < sourceTotalFrames) {
    target = sourceToOutputFrames(Math.min(
      sourceTotalFrames,
      candidateSourceEnd + profile.logicalSourceFrames
    ), profile, 'floor');
  }
  return target !== null && target >= requestedOutputFrame ? target : null;
}

// Every fragment is decoded on its own resampled grid, so the crop offset is
// only exact when the fragment's source origin sits on the lattice. An
// off-lattice origin loses the track's last output frame to floor(), which
// leaves the final fragment unplannable, so a seek adopts the nearest earlier
// lattice frame - at most sourceStepNumerator - 1 source frames (~3.3 ms) back.
function alignSourceFrameToLattice(sourceFrame, profile) {
  if (sourceFrame === null) return null;
  return sourceFrame - (sourceFrame % profile.sourceStepNumerator);
}

function createPcm16WaveBytes(sourceBytes, format, plan) {
  const dataByteLength = plan.fragmentSourceFrameCount * format.blockAlign;
  const fragment = new Uint8Array(44 + dataByteLength);
  const view = new DataView(fragment.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, format.channelCount, true);
  view.setUint32(24, format.sampleRate, true);
  view.setUint32(28, format.byteRate, true);
  view.setUint16(32, format.blockAlign, true);
  view.setUint16(34, format.bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);
  const sourceStart = format.dataOffset + plan.fragmentSourceStartFrame * format.blockAlign;
  fragment.set(sourceBytes.subarray(sourceStart, sourceStart + dataByteLength), 44);
  return fragment.buffer;
}

function scaleFrames(value, numerator, denominator, rounding) {
  if (!Number.isSafeInteger(value) || value < 0 ||
      !Number.isSafeInteger(numerator) || numerator <= 0 ||
      !Number.isSafeInteger(denominator) || denominator <= 0 ||
      !['floor', 'ceil'].includes(rounding)) return null;
  const product = BigInt(value) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const scaled = rounding === 'ceil'
    ? (product + divisor - 1n) / divisor
    : product / divisor;
  const result = Number(scaled);
  return Number.isSafeInteger(result) ? result : null;
}

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

function normalizeBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}
