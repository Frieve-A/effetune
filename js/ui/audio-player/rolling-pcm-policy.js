import {
  PCM16_STEREO_44100_TO_96000_PROFILE,
  sourceToOutputFrames
} from './rolling-pcm-core.js';
import { hasPlaybackRegionDescriptor } from './playback-region.js';
import { ROLLING_PCM_PROTOCOL_VERSION } from './rolling-pcm-protocol.js';

export { ROLLING_PCM_PROTOCOL_VERSION } from './rolling-pcm-protocol.js';

export const ROLLING_PCM_POLICY_VERSION = 6;

export const RollingPolicyMode = Object.freeze({
  LEGACY_BASELINE: 'legacyBaseline',
  RESOURCE_SAFE_LEGACY: 'resourceSafeLegacy',
  LIMITED_ROLLING: 'limitedRolling'
});

export const ROLLING_PCM_CANDIDATE_PROFILES = Object.freeze([
  Object.freeze({
    id: 'memory-first',
    slabSeconds: 2,
    currentHighWaterSeconds: 10,
    currentLowWaterSeconds: 4,
    nextMinimumHeadSeconds: 2,
    freePoolPerSizeClass: 0,
    sourceNodeCap: 8
  }),
  Object.freeze({
    id: 'balanced',
    slabSeconds: 5,
    currentHighWaterSeconds: 20,
    currentLowWaterSeconds: 10,
    nextMinimumHeadSeconds: 5,
    freePoolPerSizeClass: 1,
    sourceNodeCap: 8
  }),
  Object.freeze({
    id: 'resilience',
    slabSeconds: 5,
    currentHighWaterSeconds: 30,
    currentLowWaterSeconds: 15,
    nextMinimumHeadSeconds: 10,
    freePoolPerSizeClass: 2,
    sourceNodeCap: 10
  })
]);

export const DEFAULT_ROLLING_PCM_PROFILE_ID = 'memory-first';
export const FULL_BUFFER_PCM_BYTE_CAP = 128 * 1024 * 1024;
export const ROLLING_PCM_SELECTION_THRESHOLD_BYTES = 64 * 1024 * 1024;
export const ROLLING_COMPRESSED_SOURCE_BYTE_CAP = 256 * 1024 * 1024;
export const ROLLING_CANDIDATE_TRANSIENT_BYTE_CAP = 320 * 1024 * 1024;

export const ROLLING_PCM_REPORT_SCHEMA_VERSION = 1;
export const ROLLING_PCM_LIVE_MEMORY_EVIDENCE_SCHEMA_VERSION = 2;
export const ROLLING_PCM_CLEANUP_OBSERVATION_TIMES_MS = Object.freeze([
  1000,
  5000,
  10000,
  15000,
  20000
]);
export const ROLLING_PCM_LIVE_MEMORY_CATEGORIES = Object.freeze([
  'canonicalCompressedBytes',
  'workerCompressedBytes',
  'workerInputSampleBytes',
  'workerPartialSlabBytes',
  'transferredSlabBytes',
  'mainStagingSlabBytes',
  'pooledAudioBufferBytes',
  'queuedAudioBufferBytes',
  'scheduledAudioBufferBytes',
  'preparedNextAudioBufferBytes',
  'retiredCleanupPendingBytes'
]);

const ROLLING_PCM_MANDATORY_COUNTER_KEYS = Object.freeze([
  'livePcmBytes',
  'liveAudioBuffers',
  'liveSourceNodes',
  'liveWorkers',
  'liveHandlers',
  'liveTimers',
  'inFlightBytes'
]);

const canonicalBlobIdentities = new WeakMap();
const canonicalByteRegionIdentities = new WeakMap();
const canonicalOtherIdentities = new WeakMap();
const ROLLING_PCM_EVIDENCE_HOSTS = Object.freeze(['chromium', 'webkit', 'electron']);
const ROLLING_PCM_EVIDENCE_FORMATS = Object.freeze(['wav', 'flac']);
const ROLLING_PCM_EVIDENCE_SAMPLE_RATES = Object.freeze([44100, 48000, 96000, 192000]);
const ROLLING_PCM_EVIDENCE_LIFECYCLES = Object.freeze([
  'foreground',
  'background',
  'pagehide-pageshow',
  'context-suspend-resume',
  'producer-only-freeze',
  'output-graph-rebuild',
  'mobile-viewport'
]);

const productionRollingCell = Object.freeze({
  host: 'electron',
  electronMajorVersion: 44,
  chromiumMajorVersion: 152,
  sourceKind: 'path',
  format: 'wav',
  sourceSampleRate: PCM16_STEREO_44100_TO_96000_PROFILE.sourceSampleRate,
  outputSampleRate: PCM16_STEREO_44100_TO_96000_PROFILE.outputSampleRate,
  sampleRate: PCM16_STEREO_44100_TO_96000_PROFILE.outputSampleRate,
  channelCount: PCM16_STEREO_44100_TO_96000_PROFILE.channelCount,
  lifecycle: 'foreground',
  containerMimeType: 'audio/wav',
  codec: 'pcm-s16',
  decoderConfigCodec: 'pcm-s16',
  decoderProfile: PCM16_STEREO_44100_TO_96000_PROFILE.codec,
  resamplerProfile: PCM16_STEREO_44100_TO_96000_PROFILE.id,
  profileId: DEFAULT_ROLLING_PCM_PROFILE_ID,
  protocolVersion: ROLLING_PCM_PROTOCOL_VERSION,
  enabled: true
});

const productionRollingSelectionEvidence = Object.freeze({
  schemaVersion: 1,
  policyVersion: ROLLING_PCM_POLICY_VERSION,
  protocolVersion: ROLLING_PCM_PROTOCOL_VERSION,
  profileId: DEFAULT_ROLLING_PCM_PROFILE_ID,
  cell: productionRollingCell,
  continuityPassed: true,
  fullDecodeBaselineImprovementPassed: true,
  warmupPlateauPassed: true,
  cleanupReleased: true,
  mandatoryCounters: Object.freeze({
    livePcmBytes: 384000,
    liveAudioBuffers: 1,
    liveSourceNodes: 0,
    liveWorkers: 1,
    liveHandlers: 2,
    liveTimers: 0,
    inFlightBytes: 0
  }),
  liveMemoryCategories: Object.freeze({
    canonicalCompressedBytes: 0,
    workerCompressedBytes: 3528044,
    workerInputSampleBytes: 0,
    workerPartialSlabBytes: 0,
    transferredSlabBytes: 0,
    mainStagingSlabBytes: 0,
    pooledAudioBufferBytes: 0,
    queuedAudioBufferBytes: 384000,
    scheduledAudioBufferBytes: 0,
    preparedNextAudioBufferBytes: 0,
    retiredCleanupPendingBytes: 0
  }),
  processMemory: Object.freeze({
    available: true,
    metric: 'electron-app-get-app-metrics-working-set-bytes',
    mainAndRendererSampled: true,
    allGatesPassed: true,
    observedPeakIncreaseBytes: 186286080,
    observedPlateauSpreadBytes: 0,
    observedCleanupOverageBytes: 0,
    peakIncreaseByteCap: ROLLING_CANDIDATE_TRANSIENT_BYTE_CAP,
    plateauSpreadByteCap: 9216000,
    cleanupReturnByteCap: 9216000,
    cleanupGraceMaximumMs: 20000,
    cleanupObservationTimesMs: ROLLING_PCM_CLEANUP_OBSERVATION_TIMES_MS,
    cleanupObservationOveragesBytes: Object.freeze([91045888, 91123712, 0, 0, 0])
  })
});

export const PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD =
  productionRollingSelectionEvidence;
const productionRollingSelection = deriveRollingProductionSelection(
  PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD
);
export const PRODUCTION_ROLLING_POLICY_MODE = productionRollingSelection.policyMode;
export const SELECTED_ROLLING_PCM_PROFILE_ID = productionRollingSelection.profileId;
export const PRODUCTION_ROLLING_ENABLED_MATRIX = productionRollingSelection.enabledMatrix;

export function normalizeGaplessPlayback(preferences) {
  return preferences?.gaplessPlayback !== false;
}

export function normalizeRollingPolicyMode(value) {
  return Object.values(RollingPolicyMode).includes(value)
    ? value
    : PRODUCTION_ROLLING_POLICY_MODE;
}

export function getRollingPcmProfile(
  sampleRate,
  channelCount,
  profileId = DEFAULT_ROLLING_PCM_PROFILE_ID
) {
  if (!Number.isSafeInteger(sampleRate) || sampleRate <= 0 ||
      !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 2) {
    return null;
  }
  const candidate = ROLLING_PCM_CANDIDATE_PROFILES.find(profile => profile.id === profileId);
  if (!candidate) return null;
  const slabFrames = checkedFrames(candidate.slabSeconds, sampleRate);
  const currentHighWaterFrames = checkedFrames(candidate.currentHighWaterSeconds, sampleRate);
  const currentLowWaterFrames = checkedFrames(candidate.currentLowWaterSeconds, sampleRate);
  const nextMinimumHeadFrames = checkedFrames(candidate.nextMinimumHeadSeconds, sampleRate);
  if ([slabFrames, currentHighWaterFrames, currentLowWaterFrames, nextMinimumHeadFrames]
    .some(value => value === null)) return null;
  const bytesPerFrame = channelCount * Float32Array.BYTES_PER_ELEMENT;
  const currentPcmByteCap = checkedProduct(currentHighWaterFrames + slabFrames, bytesPerFrame);
  const nextPcmByteCap = checkedProduct(nextMinimumHeadFrames + slabFrames, bytesPerFrame);
  if (currentPcmByteCap === null || nextPcmByteCap === null) return null;
  return Object.freeze({
    ...candidate,
    policyVersion: ROLLING_PCM_POLICY_VERSION,
    sampleRate,
    channelCount,
    slabFrames,
    currentHighWaterFrames,
    currentLowWaterFrames,
    nextMinimumHeadFrames,
    currentPcmByteCap,
    nextPcmByteCap,
    totalPcmByteCap: currentPcmByteCap + nextPcmByteCap,
    compressedSourceByteCap: ROLLING_COMPRESSED_SOURCE_BYTE_CAP,
    candidateTransientByteCap: ROLLING_CANDIDATE_TRANSIENT_BYTE_CAP,
    fullBufferPcmByteCap: FULL_BUFFER_PCM_BYTE_CAP
  });
}

export function estimateDecodedPcmBytes(metadata) {
  const sampleRate = metadata?.sampleRate;
  const channelCount = metadata?.channelCount ?? metadata?.numberOfChannels;
  const duration = metadata?.durationSec ?? metadata?.duration;
  if (!Number.isFinite(duration) || duration < 0 ||
      !Number.isSafeInteger(sampleRate) || sampleRate <= 0 ||
      !Number.isSafeInteger(channelCount) || channelCount <= 0) {
    return null;
  }
  const frames = Math.ceil(duration * sampleRate);
  if (!Number.isSafeInteger(frames) || frames < 0) return null;
  return checkedProduct(frames, channelCount * Float32Array.BYTES_PER_ELEMENT);
}

export function evaluatePcmWaveFullBufferAdmission({
  snapshot,
  waveInfo,
  outputSampleRate,
  localSource = false,
  hasPlaybackRegion = false
}) {
  if (!snapshot || snapshot.format !== 'wav') return rejection('pcm-wave-format-unverified');
  if (!snapshot.canonicalIdentity) return rejection('pcm-wave-source-identity-unavailable');
  if (snapshot.mediaSource === null || snapshot.mediaSource === undefined) {
    return rejection('pcm-wave-media-unavailable');
  }
  if (!localSource || snapshot.sourceKind === 'bytes') {
    return rejection('pcm-wave-source-ineligible');
  }
  if (hasPlaybackRegion) return rejection('pcm-wave-region-ineligible');
  if (snapshot.legacyDecision?.mode !== 'buffer') {
    return rejection('pcm-wave-legacy-buffer-ineligible');
  }
  if (!Number.isSafeInteger(snapshot.byteLength) || snapshot.byteLength <= 0 ||
      snapshot.byteLength > ROLLING_COMPRESSED_SOURCE_BYTE_CAP) {
    return rejection('pcm-wave-source-budget');
  }
  if (!waveInfo ||
      waveInfo.sourceByteLength !== snapshot.byteLength ||
      !Number.isSafeInteger(waveInfo.sourceFrames) || waveInfo.sourceFrames <= 0 ||
      !Number.isSafeInteger(waveInfo.sampleRate) || waveInfo.sampleRate <= 0 ||
      !Number.isSafeInteger(waveInfo.channelCount) ||
      waveInfo.channelCount < 1 || waveInfo.channelCount > 2 ||
      !Number.isSafeInteger(outputSampleRate) || outputSampleRate <= 0) {
    return rejection('pcm-wave-header-invalid');
  }

  const decodedBytes = checkedProduct(
    waveInfo.sourceFrames,
    waveInfo.channelCount * Float32Array.BYTES_PER_ELEMENT
  );
  if (decodedBytes === null || decodedBytes > FULL_BUFFER_PCM_BYTE_CAP) {
    return rejection('pcm-wave-output-budget');
  }

  return Object.freeze({
    eligible: true,
    reason: 'ordinary-pcm-wave-admitted',
    canonicalIdentity: snapshot.canonicalIdentity,
    sourceByteLength: snapshot.byteLength,
    sourceFrames: waveInfo.sourceFrames,
    sourceSampleRate: waveInfo.sampleRate,
    bufferSampleRate: waveInfo.sampleRate,
    outputSampleRate,
    outputFrames: waveInfo.sourceFrames,
    channelCount: waveInfo.channelCount,
    decodedBytes
  });
}

export function isDecodedPcmWaveWithinAdmission(admission, audioBuffer) {
  if (!admission?.eligible || !audioBuffer ||
      audioBuffer.sampleRate !== admission.bufferSampleRate ||
      audioBuffer.numberOfChannels !== admission.channelCount ||
      !Number.isSafeInteger(audioBuffer.length) || audioBuffer.length <= 0) {
    return false;
  }
  if (audioBuffer.length !== admission.sourceFrames) return false;
  const decodedBytes = checkedProduct(
    audioBuffer.length,
    audioBuffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT
  );
  return decodedBytes !== null &&
    decodedBytes === admission.decodedBytes &&
    decodedBytes <= FULL_BUFFER_PCM_BYTE_CAP;
}

export function getCanonicalPlaybackSourceIdentity(track) {
  const blob = getCanonicalBlob(track);
  if (blob) return getOrCreateObjectIdentity(canonicalBlobIdentities, blob, 'blob');
  const bytes = getMaterializedBytes(track);
  if (bytes) {
    const buffer = bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
    const byteOffset = bytes instanceof ArrayBuffer ? 0 : bytes.byteOffset;
    const byteLength = bytes instanceof ArrayBuffer ? bytes.byteLength : bytes.byteLength;
    let regions = canonicalByteRegionIdentities.get(buffer);
    if (!regions) {
      regions = new Map();
      canonicalByteRegionIdentities.set(buffer, regions);
    }
    const regionKey = `${byteOffset}:${byteLength}`;
    let identity = regions.get(regionKey);
    if (!identity) {
      identity = Object.freeze({ kind: 'bytes' });
      regions.set(regionKey, identity);
    }
    return identity;
  }
  if (track && typeof track === 'object') {
    return getOrCreateObjectIdentity(canonicalOtherIdentities, track, 'other');
  }
  return null;
}

export function createCanonicalPlaybackSourceSnapshot(
  track,
  descriptor,
  legacyDecision,
  reusableSnapshot = null
) {
  const blob = getCanonicalBlob(track);
  const bytes = getMaterializedBytes(track);
  const sourceKind = blob ? 'blob' : (bytes ? 'bytes' : 'other');
  const materializedByteLength = blob?.size ?? bytes?.byteLength ?? null;
  const canonicalIdentity = getCanonicalPlaybackSourceIdentity(track);
  const byteLength = Number.isSafeInteger(descriptor?.byteLength)
    ? descriptor.byteLength
    : materializedByteLength;
  const mediaSource = descriptor?.mediaSource ?? null;
  const format = inferRollingFormat(track, blob);
  const hasPlaybackRegion = hasPlaybackRegionDescriptor(descriptor);
  if (reusableSnapshot?.canonicalIdentity === canonicalIdentity &&
      reusableSnapshot.sourceKind === sourceKind &&
      reusableSnapshot.byteLength === byteLength &&
      reusableSnapshot.mediaSource === mediaSource &&
      reusableSnapshot.format === format &&
      reusableSnapshot.hasPlaybackRegion === hasPlaybackRegion) {
    return reusableSnapshot;
  }
  return Object.freeze({
    track,
    descriptor,
    legacyDecision,
    canonicalIdentity,
    sourceKind,
    blob,
    bytes,
    byteLength,
    mediaSource,
    format,
    hasPlaybackRegion
  });
}

// Resident means the canonical snapshot itself keeps the compressed bytes alive, so a
// candidate copy transiently doubles them. A path-backed snapshot keeps nothing resident:
// its bytes are re-read on demand and handed straight to the worker, so charging a
// canonical copy for it would be a phantom reservation.
export function hasResidentCanonicalSource(snapshot) {
  if (!Number.isSafeInteger(snapshot?.byteLength) || snapshot.byteLength < 0 ||
      snapshot.byteLength > ROLLING_COMPRESSED_SOURCE_BYTE_CAP) {
    return false;
  }
  if (snapshot.sourceKind === 'blob' && snapshot.blob) {
    return snapshot.blob.size === snapshot.byteLength;
  }
  if (snapshot.sourceKind === 'bytes' && snapshot.bytes) {
    return snapshot.bytes.byteLength === snapshot.byteLength;
  }
  return false;
}

export function cloneRollingCandidateSource(snapshot) {
  if (!hasResidentCanonicalSource(snapshot)) return null;
  if (snapshot?.sourceKind === 'blob' && snapshot.blob) {
    if (snapshot.blob.size !== snapshot.byteLength) return null;
    return Object.freeze({ kind: 'blob', blob: snapshot.blob });
  }
  if (snapshot?.sourceKind === 'bytes' && snapshot.bytes) {
    const source = snapshot.bytes;
    const view = source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
    if (view.byteLength !== snapshot.byteLength) return null;
    const copy = view.slice().buffer;
    return Object.freeze({ kind: 'bytes', bytes: copy });
  }
  return null;
}

export function chooseResourceSafeFallback(snapshot, metadata, { preferMedia = false } = {}) {
  const hasMedia = snapshot?.mediaSource !== null && snapshot?.mediaSource !== undefined;
  if (preferMedia && hasMedia) {
    return playbackDecision('media', false, 'gapless-disabled-media');
  }
  if (hasMedia) {
    return playbackDecision('media', false, 'resource-safe-media');
  }
  return playbackDecision('unavailable', false, 'resource-safe-media-unavailable');
}

export function evaluateRollingEligibility({
  snapshot,
  metadata,
  audioContext,
  gaplessPlayback = true,
  policyMode = PRODUCTION_ROLLING_POLICY_MODE,
  enabledMatrix = PRODUCTION_ROLLING_ENABLED_MATRIX,
  runtime = detectRollingRuntime(),
  host = runtime.host,
  electronMajorVersion = runtime.electronMajorVersion,
  chromiumMajorVersion = runtime.chromiumMajorVersion,
  lifecycle = detectRollingLifecycle(audioContext),
  workerAvailable = typeof Worker === 'function',
  audioDecoderAvailable = typeof AudioDecoder === 'function'
}) {
  if (!gaplessPlayback) return rejection('gapless-disabled');
  if (normalizeRollingPolicyMode(policyMode) !== RollingPolicyMode.LIMITED_ROLLING) {
    return rejection('rollout-disabled');
  }
  if (snapshot?.mediaSource === null || snapshot?.mediaSource === undefined) {
    return rejection('media-fallback-unavailable');
  }
  if (snapshot.hasPlaybackRegion === true) return rejection('playback-region-ineligible');
  const sourceKind = getRollingMatrixSourceKind(snapshot);
  if (!sourceKind) {
    return rejection('canonical-source-ineligible');
  }
  if (!workerAvailable) return rejection('worker-unavailable');
  if (!(Array.isArray(enabledMatrix) && enabledMatrix.some(cell => cell?.enabled === true))) {
    return rejection('matrix-disabled');
  }
  const selectedProfileId = getEnabledMatrixProfileId(enabledMatrix);
  if (selectedProfileId === null) {
    return rejection('memory-profile-unselected');
  }
  if (!['wav', 'flac'].includes(snapshot.format)) return rejection('format-unsupported');
  if (snapshot.format !== 'wav' && !audioDecoderAvailable) return rejection('audio-decoder-unavailable');
  const verifiedFormat = getVerifiedRollingFormat(metadata);
  if (!verifiedFormat) return rejection('verified-codec-unsupported');
  if (verifiedFormat !== snapshot.format) return rejection('verified-format-mismatch');
  const sourceSampleRate = metadata?.sourceSampleRate ?? metadata?.sampleRate;
  const outputSampleRate = metadata?.outputSampleRate ?? metadata?.sampleRate;
  const channelCount = metadata?.channelCount ?? metadata?.numberOfChannels;
  if (!Number.isSafeInteger(sourceSampleRate) ||
      !Number.isSafeInteger(outputSampleRate) ||
      !Number.isSafeInteger(channelCount)) {
    return rejection('metadata-incomplete');
  }
  if (channelCount < 1 || channelCount > 2) return rejection('channel-count-unsupported');
  if (!audioContext || audioContext.sampleRate !== outputSampleRate) {
    return rejection('sample-rate-mismatch');
  }
  const decodedBytes = estimateDecodedPcmBytes(metadata);
  if (decodedBytes === null) return rejection('decoded-size-unknown');
  if (!Number.isSafeInteger(snapshot.byteLength) || snapshot.byteLength < 0 ||
      snapshot.byteLength > ROLLING_COMPRESSED_SOURCE_BYTE_CAP) {
    return rejection('compressed-source-budget');
  }
  const matchedCell = findMatrixCell(enabledMatrix, {
    host,
    electronMajorVersion,
    chromiumMajorVersion,
    sourceKind,
    format: verifiedFormat,
    sourceSampleRate,
    outputSampleRate,
    channelCount,
    lifecycle,
    containerMimeType: metadata.containerMimeType,
    codec: metadata.codec,
    decoderConfigCodec: metadata.decoderConfigCodec,
    decoderProfile: metadata.decoderProfile,
    resamplerProfile: metadata.resamplerProfile,
    profileId: selectedProfileId,
    protocolVersion: ROLLING_PCM_PROTOCOL_VERSION
  });
  if (!matchedCell) {
    return rejection('matrix-disabled');
  }
  if (isExactNativeFragmentCell(matchedCell) &&
      !isExactNativeFragmentMetadata(snapshot, metadata, audioContext)) {
    return rejection('native-fragment-metadata-invalid');
  }
  if (decodedBytes <= ROLLING_PCM_SELECTION_THRESHOLD_BYTES &&
      !isExactNativeFragmentCell(matchedCell)) {
    return rejection('below-rolling-threshold');
  }
  const profile = getRollingPcmProfile(
    outputSampleRate,
    channelCount,
    selectedProfileId
  );
  if (!profile) return rejection('memory-profile-unavailable');
  const overlappingCompressedBytes = checkedProduct(snapshot.byteLength, 2);
  const transientBytes = checkedSum(overlappingCompressedBytes, profile.totalPcmByteCap);
  if (transientBytes === null || transientBytes > profile.candidateTransientByteCap) {
    return rejection('candidate-transient-budget');
  }
  return Object.freeze({ eligible: true, reason: 'eligible', decodedBytes, profile });
}

export function selectPlaybackBackend({
  snapshot,
  metadata,
  audioContext,
  gaplessPlayback = true,
  policyMode = PRODUCTION_ROLLING_POLICY_MODE,
  enabledMatrix = PRODUCTION_ROLLING_ENABLED_MATRIX,
  capability = {}
}) {
  const normalizedMode = normalizeRollingPolicyMode(policyMode);
  if (!gaplessPlayback) {
    return chooseResourceSafeFallback(snapshot, metadata, { preferMedia: true });
  }
  if (normalizedMode === RollingPolicyMode.LEGACY_BASELINE) return snapshot.legacyDecision;
  const fallback = chooseResourceSafeFallback(snapshot, metadata);
  if (normalizedMode === RollingPolicyMode.RESOURCE_SAFE_LEGACY) return fallback;
  const eligibility = evaluateRollingEligibility({
    snapshot,
    metadata,
    audioContext,
    gaplessPlayback,
    policyMode: normalizedMode,
    enabledMatrix,
    ...capability
  });
  if (eligibility.eligible) {
    return playbackDecision('rolling', false, eligibility.reason, { eligibility, fallback });
  }
  const rollingCandidate = eligibility.reason === 'verified-codec-unsupported' &&
    isUnverifiedPreflight(metadata) &&
    (capability.workerAvailable ?? (typeof Worker === 'function')) &&
    hasRollingMatrixCandidate(snapshot, enabledMatrix, capability);
  return Object.freeze({
    ...fallback,
    rollingRejection: eligibility.reason,
    ...(rollingCandidate ? { rollingCandidate: true } : {})
  });
}

export function selectMemoryProfile(results) {
  const eligible = (Array.isArray(results) ? results : [])
    .map(normalizeMemoryProfileResult)
    .filter(result => result !== null)
    .sort((left, right) =>
      left.residentPeakBytes - right.residentPeakBytes ||
      left.liveNodePeak - right.liveNodePeak ||
      profileOrder(left.profileId) - profileOrder(right.profileId));
  return eligible[0] ?? null;
}

export function createRollingPcmLiveMemoryEvidence({
  categories,
  cell,
  profileId = DEFAULT_ROLLING_PCM_PROFILE_ID,
  policyVersion = ROLLING_PCM_POLICY_VERSION,
  policyDigest = null,
  categoryCaps = null,
  aggregateByteCap = null
} = {}) {
  const policy = getRollingPcmEvidencePolicy(cell, profileId);
  if (!policy || policyVersion !== policy.policyVersion ||
      (policyDigest !== null && policyDigest !== policy.policyDigest) ||
      (categoryCaps !== null && !sameCounterRecord(categoryCaps, policy.categoryCaps)) ||
      (aggregateByteCap !== null && aggregateByteCap !== policy.aggregateByteCap)) return null;
  return normalizeLiveMemoryEvidence({
    schemaVersion: ROLLING_PCM_LIVE_MEMORY_EVIDENCE_SCHEMA_VERSION,
    policyVersion: policy.policyVersion,
    policyDigest: policy.policyDigest,
    profileId: policy.profileId,
    cell: policy.cell,
    categories,
    categoryCaps: policy.categoryCaps,
    aggregateByteCap: policy.aggregateByteCap
  });
}

export function getRollingPcmEvidencePolicy(cell, profileId = DEFAULT_ROLLING_PCM_PROFILE_ID) {
  const normalizedCell = normalizeEvidenceCell(cell);
  if (!normalizedCell) return null;
  const profile = getRollingPcmProfile(
    normalizedCell.sampleRate,
    normalizedCell.channelCount,
    profileId
  );
  if (!profile) return null;
  const slabBytes = checkedProduct(
    profile.slabFrames,
    normalizedCell.channelCount * Float32Array.BYTES_PER_ELEMENT
  );
  if (slabBytes === null) return null;
  const pooledBytes = checkedProduct(
    slabBytes,
    profile.freePoolPerSizeClass * 2
  );
  if (pooledBytes === null) return null;
  const categoryCaps = Object.freeze({
    canonicalCompressedBytes: profile.compressedSourceByteCap,
    workerCompressedBytes: profile.compressedSourceByteCap,
    workerInputSampleBytes: slabBytes,
    workerPartialSlabBytes: slabBytes,
    transferredSlabBytes: slabBytes,
    mainStagingSlabBytes: slabBytes,
    pooledAudioBufferBytes: pooledBytes,
    queuedAudioBufferBytes: profile.currentPcmByteCap,
    scheduledAudioBufferBytes: profile.currentPcmByteCap,
    preparedNextAudioBufferBytes: profile.nextPcmByteCap,
    retiredCleanupPendingBytes: profile.currentPcmByteCap
  });
  const liveAudioBufferCap = Math.ceil(profile.currentPcmByteCap / slabBytes);
  if (!Number.isSafeInteger(liveAudioBufferCap) || liveAudioBufferCap < 1) return null;
  const mandatoryCounterCaps = Object.freeze({
    livePcmBytes: profile.currentPcmByteCap,
    liveAudioBuffers: liveAudioBufferCap,
    liveSourceNodes: profile.sourceNodeCap,
    liveWorkers: 2,
    liveHandlers: 4,
    liveTimers: 2,
    inFlightBytes: slabBytes
  });
  const policyDigest = createEvidencePolicyDigest(
    profile.id,
    normalizedCell,
    mandatoryCounterCaps
  );
  return Object.freeze({
    policyVersion: ROLLING_PCM_POLICY_VERSION,
    policyDigest,
    profileId: profile.id,
    cell: normalizedCell,
    categoryCaps,
    mandatoryCounterCaps,
    aggregateByteCap: profile.candidateTransientByteCap
  });
}

export function deriveRollingProductionSelection(record) {
  const disabled = () => Object.freeze({
    policyMode: RollingPolicyMode.RESOURCE_SAFE_LEGACY,
    profileId: null,
    enabledMatrix: Object.freeze([]),
    evidenceRecord: null
  });
  if (!record || record.schemaVersion !== 1 ||
      record.policyVersion !== ROLLING_PCM_POLICY_VERSION ||
      record.protocolVersion !== ROLLING_PCM_PROTOCOL_VERSION ||
      record.profileId !== DEFAULT_ROLLING_PCM_PROFILE_ID ||
      record.continuityPassed !== true ||
      record.fullDecodeBaselineImprovementPassed !== true ||
      record.cleanupReleased !== true) {
    return disabled();
  }
  const cell = record.cell;
  const nativeProfile = PCM16_STEREO_44100_TO_96000_PROFILE;
  if (cell?.enabled !== true || cell.host !== 'electron' ||
      cell.electronMajorVersion !== 44 || cell.chromiumMajorVersion !== 152 ||
      cell.sourceKind !== 'path' || cell.format !== 'wav' ||
      cell.sourceSampleRate !== nativeProfile.sourceSampleRate ||
      cell.outputSampleRate !== nativeProfile.outputSampleRate ||
      cell.sampleRate !== nativeProfile.outputSampleRate ||
      cell.channelCount !== nativeProfile.channelCount || cell.lifecycle !== 'foreground' ||
      cell.containerMimeType !== 'audio/wav' || cell.codec !== 'pcm-s16' ||
      cell.decoderConfigCodec !== 'pcm-s16' || cell.decoderProfile !== nativeProfile.codec ||
      cell.resamplerProfile !== nativeProfile.id || cell.profileId !== record.profileId ||
      cell.protocolVersion !== record.protocolVersion) return disabled();
  const evidencePolicy = getRollingPcmEvidencePolicy(cell, record.profileId);
  if (!evidencePolicy || !counterRecordWithinCaps(
    record.mandatoryCounters,
    evidencePolicy.mandatoryCounterCaps,
    ROLLING_PCM_MANDATORY_COUNTER_KEYS
  ) || !counterRecordWithinCaps(
    record.liveMemoryCategories,
    evidencePolicy.categoryCaps,
    ROLLING_PCM_LIVE_MEMORY_CATEGORIES
  )) return disabled();
  const categoryTotal = ROLLING_PCM_LIVE_MEMORY_CATEGORIES.reduce(
    (total, key) => total === null
      ? null
      : checkedSum(total, record.liveMemoryCategories[key]),
    0
  );
  const processMemory = record.processMemory;
  const cleanupObservationTimesMs = processMemory?.cleanupObservationTimesMs;
  const cleanupObservationOveragesBytes = processMemory?.cleanupObservationOveragesBytes;
  const cleanupObservationsValid = Array.isArray(cleanupObservationTimesMs) &&
    Array.isArray(cleanupObservationOveragesBytes) &&
    cleanupObservationTimesMs.length === ROLLING_PCM_CLEANUP_OBSERVATION_TIMES_MS.length &&
    cleanupObservationOveragesBytes.length === cleanupObservationTimesMs.length &&
    cleanupObservationTimesMs.every((value, index) =>
      value === ROLLING_PCM_CLEANUP_OBSERVATION_TIMES_MS[index]) &&
    cleanupObservationOveragesBytes.every(value =>
      Number.isSafeInteger(value) && value >= 0) &&
    Number.isSafeInteger(processMemory?.observedCleanupOverageBytes) &&
    processMemory.observedCleanupOverageBytes === Math.min(...cleanupObservationOveragesBytes);
  const observedProcessMemoryPassed = Number.isSafeInteger(
    processMemory?.observedPeakIncreaseBytes
  ) && processMemory.observedPeakIncreaseBytes >= 0 &&
    Number.isSafeInteger(processMemory.observedPlateauSpreadBytes) &&
    processMemory.observedPlateauSpreadBytes >= 0 &&
    cleanupObservationsValid &&
    processMemory.observedPeakIncreaseBytes <= processMemory.peakIncreaseByteCap &&
    processMemory.observedPlateauSpreadBytes <= processMemory.plateauSpreadByteCap &&
    processMemory.observedCleanupOverageBytes <= processMemory.cleanupReturnByteCap;
  if (categoryTotal === null || categoryTotal > evidencePolicy.aggregateByteCap ||
      processMemory?.available !== true || processMemory.mainAndRendererSampled !== true ||
      processMemory.metric !== 'electron-app-get-app-metrics-working-set-bytes' ||
      processMemory.peakIncreaseByteCap !== evidencePolicy.aggregateByteCap ||
      processMemory.plateauSpreadByteCap !== evidencePolicy.categoryCaps.queuedAudioBufferBytes ||
      processMemory.cleanupReturnByteCap !== evidencePolicy.categoryCaps.queuedAudioBufferBytes ||
      processMemory.cleanupGraceMaximumMs !== 20000 ||
      processMemory.allGatesPassed !== observedProcessMemoryPassed ||
      record.warmupPlateauPassed !==
        (processMemory.observedPlateauSpreadBytes <= processMemory.plateauSpreadByteCap) ||
      processMemory.allGatesPassed !== true || record.warmupPlateauPassed !== true) {
    return disabled();
  }
  return Object.freeze({
    policyMode: RollingPolicyMode.LIMITED_ROLLING,
    profileId: record.profileId,
    enabledMatrix: Object.freeze([Object.freeze({ ...cell })]),
    evidenceRecord: record
  });
}

export function createRollingPcmCapabilityReport({
  cells = [],
  productionEvidenceRecord = null,
  processMemory = { available: false, metric: null, reason: 'not-sampled' },
  mobileResidualRisks = [
    'Screen-off suspension, operating-system page discard, and device-specific decoders are not represented by browser automation.'
  ]
} = {}) {
  const productionSelection = deriveRollingProductionSelection(productionEvidenceRecord);
  const normalizedCells = (Array.isArray(cells) ? cells : []).map(cell => Object.freeze({
    host: String(cell?.host ?? 'unknown'),
    format: String(cell?.format ?? 'unknown'),
    sampleRate: Number.isSafeInteger(cell?.sampleRate) ? cell.sampleRate : null,
    channelCount: Number.isSafeInteger(cell?.channelCount) ? cell.channelCount : null,
    lifecycle: String(cell?.lifecycle ?? 'unknown'),
    selectedProfileId: typeof cell?.selectedProfileId === 'string'
      ? cell.selectedProfileId
      : null,
    enabled: cell?.enabled === true,
    reason: String(cell?.reason ?? 'not-measured'),
    liveResources: cell?.liveResources && typeof cell.liveResources === 'object'
      ? Object.freeze({ ...cell.liveResources })
      : null
  }));
  return Object.freeze({
    schemaVersion: ROLLING_PCM_REPORT_SCHEMA_VERSION,
    policyVersion: ROLLING_PCM_POLICY_VERSION,
    protocolVersion: ROLLING_PCM_PROTOCOL_VERSION,
    policyDigest: `rolling-pcm-v${ROLLING_PCM_POLICY_VERSION}:${productionSelection.policyMode}:${PCM16_STEREO_44100_TO_96000_PROFILE.id}`,
    productionMode: productionSelection.policyMode,
    candidateDefaultProfileId: DEFAULT_ROLLING_PCM_PROFILE_ID,
    selectedProfileId: productionSelection.profileId,
    enabledMatrix: productionSelection.enabledMatrix.map(cell => ({ ...cell })),
    cells: normalizedCells,
    processMemory: Object.freeze({
      available: processMemory?.available === true,
      metric: typeof processMemory?.metric === 'string' ? processMemory.metric : null,
      reason: typeof processMemory?.reason === 'string' ? processMemory.reason : null
    }),
    mobileResidualRisks: Object.freeze((Array.isArray(mobileResidualRisks)
      ? mobileResidualRisks
      : []).map(String)),
    generatedAt: null
  });
}

export function detectRollingHost(userAgent = globalThis.navigator?.userAgent ?? '') {
  return detectRollingRuntime(userAgent).host;
}

export function detectRollingRuntime(userAgent = globalThis.navigator?.userAgent ?? '') {
  const electronMajorVersion = getUserAgentMajorVersion(userAgent, 'Electron');
  const chromiumMajorVersion = getChromiumMajorVersion(userAgent);
  if (/Electron\//i.test(userAgent)) {
    return Object.freeze({ host: 'electron', electronMajorVersion, chromiumMajorVersion });
  }
  if (/AppleWebKit/i.test(userAgent) && !/(?:Chrome|Chromium|Edg)\//i.test(userAgent)) {
    return Object.freeze({ host: 'webkit', electronMajorVersion: null, chromiumMajorVersion: null });
  }
  if (/(?:Chrome|Chromium|Edg)\//i.test(userAgent)) {
    return Object.freeze({ host: 'chromium', electronMajorVersion: null, chromiumMajorVersion });
  }
  return Object.freeze({ host: 'unknown', electronMajorVersion: null, chromiumMajorVersion: null });
}

export function detectRollingLifecycle(
  audioContext,
  documentObject = globalThis.document
) {
  if (typeof audioContext?.state !== 'string') return 'unknown';
  if (audioContext.state !== 'running') {
    return 'context-suspend-resume';
  }
  if (typeof documentObject?.visibilityState !== 'string') return 'unknown';
  if (documentObject.visibilityState !== 'visible') {
    return 'background';
  }
  return 'foreground';
}

export function hasRollingMatrixCandidate(
  snapshot,
  enabledMatrix = PRODUCTION_ROLLING_ENABLED_MATRIX,
  {
    runtime = detectRollingRuntime(),
    host = runtime.host,
    electronMajorVersion = runtime.electronMajorVersion,
    chromiumMajorVersion = runtime.chromiumMajorVersion,
    lifecycle = 'unknown'
  } = {}
) {
  const selectedProfileId = getEnabledMatrixProfileId(enabledMatrix);
  if (selectedProfileId === null) return false;
  if (snapshot?.mediaSource === null || snapshot?.mediaSource === undefined) return false;
  if (snapshot.hasPlaybackRegion === true || lifecycle === 'unknown') return false;
  if (!Number.isSafeInteger(snapshot.byteLength) || snapshot.byteLength <= 0 ||
      snapshot.byteLength > ROLLING_COMPRESSED_SOURCE_BYTE_CAP) return false;
  const sourceKind = getRollingMatrixSourceKind(snapshot);
  if (!sourceKind) return false;
  return (Array.isArray(enabledMatrix) ? enabledMatrix : []).some(cell =>
    cell?.enabled === true && cell.host === host && cell.format === snapshot?.format &&
    cell.profileId === selectedProfileId &&
    cell.lifecycle === lifecycle &&
    (cell.sourceKind === undefined || cell.sourceKind === sourceKind) &&
    (cell.electronMajorVersion === undefined ||
      cell.electronMajorVersion === electronMajorVersion) &&
    (cell.chromiumMajorVersion === undefined ||
      cell.chromiumMajorVersion === chromiumMajorVersion));
}

function findMatrixCell(matrix, target) {
  return (Array.isArray(matrix) ? matrix : []).find(cell =>
    cell?.host === target.host && cell?.format === target.format &&
    (cell?.sourceKind === undefined || cell.sourceKind === target.sourceKind) &&
    (cell?.electronMajorVersion === undefined ||
      cell.electronMajorVersion === target.electronMajorVersion) &&
    (cell?.chromiumMajorVersion === undefined ||
      cell.chromiumMajorVersion === target.chromiumMajorVersion) &&
    (cell?.sourceSampleRate ?? cell?.sampleRate) === target.sourceSampleRate &&
    (cell?.outputSampleRate ?? cell?.sampleRate) === target.outputSampleRate &&
    cell?.channelCount === target.channelCount &&
    cell?.lifecycle === target.lifecycle && cell?.enabled === true &&
    cell?.containerMimeType === target.containerMimeType && cell?.codec === target.codec &&
    (cell?.decoderConfigCodec ?? null) === (target.decoderConfigCodec ?? null) &&
    (cell?.decoderProfile === undefined || cell.decoderProfile === target.decoderProfile) &&
    (cell?.resamplerProfile === undefined || cell.resamplerProfile === target.resamplerProfile) &&
    cell?.profileId === target.profileId &&
    (cell?.protocolVersion === undefined || cell.protocolVersion === target.protocolVersion)) ?? null;
}

function getEnabledMatrixProfileId(matrix) {
  const profileIds = new Set((Array.isArray(matrix) ? matrix : [])
    .filter(cell => cell?.enabled === true && typeof cell.profileId === 'string')
    .map(cell => cell.profileId));
  return profileIds.size === 1 ? [...profileIds][0] : null;
}

export class RollingPcmAdmissionLedger {
  constructor({ aggregateByteCap = ROLLING_CANDIDATE_TRANSIENT_BYTE_CAP } = {}) {
    if (!Number.isSafeInteger(aggregateByteCap) || aggregateByteCap <= 0) {
      throw new RangeError('Rolling PCM aggregate byte cap must be a positive integer');
    }
    this.aggregateByteCap = aggregateByteCap;
    this.entries = new Map();
  }

  reserve(owner, role, reservation, profile) {
    if (!owner || this.entries.has(owner) || !isReservationRole(role) || !profile) return false;
    const entry = normalizeReservation(role, reservation, profile);
    if (!entry || !this.roleFits(entry, profile)) {
      return false;
    }
    const candidateEntries = new Map(this.entries);
    candidateEntries.set(owner, entry);
    const aggregateBytes = totalReservationBytes(candidateEntries);
    if (aggregateBytes === null || aggregateBytes > this.aggregateByteCap) return false;
    this.entries = candidateEntries;
    return true;
  }

  promote(owner, previousOwner, profile) {
    const next = this.entries.get(owner);
    const previous = previousOwner ? this.entries.get(previousOwner) : null;
    if (!this.canPromote(owner, previousOwner, profile)) return false;
    const promotedPcmBytes = next.promotionPcmBytes;
    const promoted = Object.freeze({
      ...next,
      role: 'current',
      pcmBytes: promotedPcmBytes,
      promotionPcmBytes: promotedPcmBytes
    });
    if (!this.roleFits(promoted, profile)) return false;
    if ([...this.entries.entries()].some(([key, entry]) =>
      key !== owner && key !== previousOwner && entry.role === 'current')) return false;
    const promotedEntries = new Map(this.entries);
    if (previous) {
      promotedEntries.set(previousOwner, Object.freeze({ ...previous, role: 'retired' }));
    }
    promotedEntries.set(owner, promoted);
    const promotedAggregate = totalReservationBytes(promotedEntries);
    if (promotedAggregate === null || promotedAggregate > this.aggregateByteCap) return false;
    this.entries = promotedEntries;
    return true;
  }

  canPromote(owner, previousOwner, profile) {
    const next = this.entries.get(owner);
    if (!next || !profile || (next.role !== 'candidate' && next.role !== 'next')) return false;
    const previous = previousOwner ? this.entries.get(previousOwner) : null;
    if ((previousOwner && !previous) || (previous && previous.role !== 'current')) return false;
    if ([...this.entries.entries()].some(([key, entry]) =>
      key !== owner && key !== previousOwner && entry.role === 'current')) return false;
    const promoted = Object.freeze({
      ...next,
      role: 'current',
      pcmBytes: next.promotionPcmBytes
    });
    if (!this.roleFits(promoted, profile)) return false;
    const projected = new Map(this.entries);
    if (previous) projected.set(previousOwner, Object.freeze({ ...previous, role: 'retired' }));
    projected.set(owner, promoted);
    const aggregateBytes = totalReservationBytes(projected);
    return aggregateBytes !== null && aggregateBytes <= this.aggregateByteCap;
  }

  release(owner) {
    return this.entries.delete(owner);
  }

  transferSourceOwnership(owner, profile) {
    const entry = this.entries.get(owner);
    if (!entry || !profile) return false;
    if (entry.canonicalCompressedBytes === 0) return true;
    const transferred = Object.freeze({
      ...entry,
      canonicalCompressedBytes: 0,
      totalBytes: entry.ownerBytes
    });
    if (!this.roleFits(transferred, profile)) return false;
    const transferredEntries = new Map(this.entries);
    transferredEntries.set(owner, transferred);
    const aggregateBytes = totalReservationBytes(transferredEntries);
    if (aggregateBytes === null || aggregateBytes > this.aggregateByteCap) return false;
    this.entries = transferredEntries;
    return true;
  }

  getRole(owner) {
    return this.entries.get(owner)?.role ?? null;
  }

  totalReservedBytes() {
    return totalReservationBytes(this.entries) ?? Number.MAX_SAFE_INTEGER;
  }

  roleFits(entry, profile) {
    if (entry.canonicalCompressedBytes > profile.compressedSourceByteCap ||
        entry.workerCompressedBytes > profile.compressedSourceByteCap) return false;
    if (entry.role === 'current' || entry.role === 'candidate') {
      return entry.pcmBytes <= profile.currentPcmByteCap;
    }
    if (entry.role === 'next') return entry.pcmBytes <= profile.nextPcmByteCap;
    return entry.role === 'retired';
  }
}

function rejection(reason) {
  return Object.freeze({ eligible: false, reason });
}

function playbackDecision(mode, allowMediaFallback, reason, extra = {}) {
  return Object.freeze({ mode, allowMediaFallback, reason, ...extra });
}

function getOrCreateObjectIdentity(store, source, kind) {
  let identity = store.get(source);
  if (!identity) {
    identity = Object.freeze({ kind });
    store.set(source, identity);
  }
  return identity;
}

function normalizeEvidenceCell(cell) {
  if (!cell || typeof cell !== 'object' ||
      !ROLLING_PCM_EVIDENCE_HOSTS.includes(cell.host) ||
      !ROLLING_PCM_EVIDENCE_FORMATS.includes(cell.format) ||
      !Number.isSafeInteger(cell.sampleRate) || cell.sampleRate <= 0 ||
      !ROLLING_PCM_EVIDENCE_SAMPLE_RATES.includes(cell.sampleRate) ||
      !Number.isSafeInteger(cell.channelCount) || cell.channelCount < 1 ||
      cell.channelCount > 2 ||
      !ROLLING_PCM_EVIDENCE_LIFECYCLES.includes(cell.lifecycle)) return null;
  return Object.freeze({
    host: cell.host,
    format: cell.format,
    sampleRate: cell.sampleRate,
    channelCount: cell.channelCount,
    lifecycle: cell.lifecycle
  });
}

function createEvidencePolicyDigest(profileId, cell, mandatoryCounterCaps) {
  return [
    `rolling-pcm-v${ROLLING_PCM_POLICY_VERSION}`,
    profileId,
    cell.host,
    cell.format,
    cell.sampleRate,
    cell.channelCount,
    cell.lifecycle,
    ROLLING_PCM_MANDATORY_COUNTER_KEYS
      .map(key => `${key}=${mandatoryCounterCaps[key]}`)
      .join(',')
  ].join(':');
}

function sameCounterRecord(actual, expected) {
  if (!actual || typeof actual !== 'object' || !expected || typeof expected !== 'object') {
    return false;
  }
  const expectedKeys = Object.keys(expected);
  if (Object.keys(actual).length !== expectedKeys.length) return false;
  return expectedKeys.every(key => Object.prototype.hasOwnProperty.call(actual, key) &&
    actual[key] === expected[key]);
}

function counterRecordWithinCaps(actual, caps, keys) {
  if (!actual || typeof actual !== 'object' || !caps || typeof caps !== 'object' ||
      Object.keys(actual).length !== keys.length) return false;
  return keys.every(key => Object.prototype.hasOwnProperty.call(actual, key) &&
    Object.prototype.hasOwnProperty.call(caps, key) &&
    Number.isSafeInteger(actual[key]) && actual[key] >= 0 && actual[key] <= caps[key]);
}

function sameEvidenceCell(left, right) {
  return left?.host === right?.host && left?.format === right?.format &&
    left?.sampleRate === right?.sampleRate && left?.channelCount === right?.channelCount &&
    left?.lifecycle === right?.lifecycle;
}

function inferRollingFormat(track, blob) {
  const pathBaseName = typeof track?.path === 'string'
    ? track.path.split(/[\\/]/).pop() ?? ''
    : '';
  for (const value of [track?.file?.name, track?.sourceFileName, track?.fileName, pathBaseName]) {
    const extension = getPhysicalExtension(value);
    if (!extension) continue;
    if (extension === 'wav' || extension === 'wave') return 'wav';
    if (extension === 'flac') return 'flac';
    return null;
  }
  const mime = String(track?.type ?? blob?.type ?? '').toLowerCase().split(';', 1)[0].trim();
  if (mime === 'audio/wav' || mime === 'audio/wave' || mime === 'audio/x-wav') return 'wav';
  if (mime === 'audio/flac' || mime === 'audio/x-flac') return 'flac';
  const displayName = String(track?.name ?? track?.title ?? '').toLowerCase();
  if (/\.wav$/.test(displayName)) return 'wav';
  if (/\.flac$/.test(displayName)) return 'flac';
  return null;
}

function getPhysicalExtension(value) {
  if (typeof value !== 'string') return null;
  const match = /\.([a-z\d]+)$/i.exec(value.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

function getRollingMatrixSourceKind(snapshot) {
  if (snapshot?.sourceKind === 'blob' && snapshot.blob) return 'blob';
  return isCanonicalLocalPathSnapshot(snapshot) ? 'path' : null;
}

function isCanonicalLocalPathSnapshot(snapshot) {
  const track = snapshot?.track;
  const descriptor = snapshot?.descriptor;
  const path = track?.path;
  if (snapshot?.sourceKind !== 'other' || typeof path !== 'string' ||
      snapshot.mediaSource !== path || descriptor?.mediaSource !== path ||
      track?.file || typeof track?.provider === 'function' ||
      typeof track?.readBytes === 'function' ||
      Object.prototype.hasOwnProperty.call(track ?? {}, 'mediaSource') ||
      getMaterializedBytes(track) || getMaterializedBytes(descriptor)) {
    return false;
  }
  if (/^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.startsWith('/')) {
    return true;
  }
  return path.includes('\\') && !/^[A-Za-z][A-Za-z\d+\-.]*:/.test(path);
}

function isUnverifiedPreflight(metadata) {
  return !metadata || metadata.decoderConfigVerified !== true;
}

function isExactNativeFragmentCell(cell) {
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  return cell?.host === 'electron' && cell?.electronMajorVersion === 44 &&
    cell?.chromiumMajorVersion === 152 && cell?.sourceKind === 'path' &&
    cell?.format === 'wav' && cell?.sourceSampleRate === profile.sourceSampleRate &&
    cell?.outputSampleRate === profile.outputSampleRate &&
    cell?.channelCount === profile.channelCount && cell?.lifecycle === 'foreground' &&
    cell?.containerMimeType === 'audio/wav' && cell?.codec === 'pcm-s16' &&
    cell?.decoderConfigCodec === 'pcm-s16' && cell?.decoderProfile === profile.codec &&
    cell?.resamplerProfile === profile.id &&
    cell?.profileId === DEFAULT_ROLLING_PCM_PROFILE_ID &&
    cell?.protocolVersion === ROLLING_PCM_PROTOCOL_VERSION;
}

function isExactNativeFragmentMetadata(snapshot, metadata, audioContext) {
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  const sourceDataByteLength = Number.isSafeInteger(metadata?.sourceTotalFrames)
    ? checkedProduct(metadata.sourceTotalFrames, profile.channelCount * Int16Array.BYTES_PER_ELEMENT)
    : null;
  const totalFrames = sourceToOutputFrames(metadata?.sourceTotalFrames, profile, 'floor');
  return Number.isSafeInteger(snapshot?.byteLength) && snapshot.byteLength > 0 &&
    metadata?.sourceByteLength === snapshot.byteLength &&
    Number.isSafeInteger(metadata?.dataOffset) && metadata.dataOffset >= 44 &&
    metadata?.dataByteLength === sourceDataByteLength &&
    metadata?.bitsPerSample === 16 && metadata?.blockAlign === 4 &&
    metadata.dataOffset + metadata.dataByteLength <= metadata.sourceByteLength &&
    metadata.totalFrames === totalFrames &&
    metadata.durationSec === totalFrames / profile.outputSampleRate &&
    audioContext?.sampleRate === profile.outputSampleRate;
}

function getUserAgentMajorVersion(userAgent, product) {
  const match = new RegExp(`${product}/(\\d+)`, 'i').exec(userAgent);
  return match ? Number(match[1]) : null;
}

function getChromiumMajorVersion(userAgent) {
  for (const product of ['Chrome', 'Chromium']) {
    const version = getUserAgentMajorVersion(userAgent, product);
    if (version !== null) return version;
  }
  return null;
}

function getVerifiedRollingFormat(metadata) {
  if (metadata?.decoderConfigVerified !== true) return null;
  const mime = String(metadata.containerMimeType ?? '').toLowerCase().split(';', 1)[0].trim();
  const codec = String(metadata.codec ?? '').toLowerCase();
  const configCodec = metadata.decoderConfigCodec == null
    ? null
    : String(metadata.decoderConfigCodec).toLowerCase();
  if ((mime === 'audio/wav' || mime === 'audio/wave' || mime === 'audio/x-wav') &&
      /^pcm(?:-|$)/.test(codec) && configCodec === codec) return 'wav';
  if ((mime === 'audio/flac' || mime === 'audio/x-flac') && codec === 'flac' &&
      configCodec === 'flac') return 'flac';
  return null;
}

function getCanonicalBlob(track) {
  const value = track?.file;
  if (!value || typeof value !== 'object') return null;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
  if (typeof File !== 'undefined' && value instanceof File) return value;
  return Number.isFinite(value.size) && typeof value.arrayBuffer === 'function' ? value : null;
}

function getMaterializedBytes(track) {
  const value = track?.bytes ?? track?.data;
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? value : null;
}

function checkedFrames(seconds, sampleRate) {
  const frames = seconds * sampleRate;
  return Number.isSafeInteger(frames) && frames > 0 ? frames : null;
}

function checkedProduct(left, right) {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0) return null;
  if (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left)) return null;
  const result = left * right;
  return Number.isSafeInteger(result) ? result : null;
}

function checkedSum(left, right) {
  if (!Number.isSafeInteger(left) || left < 0 || !Number.isSafeInteger(right) || right < 0 ||
      right > Number.MAX_SAFE_INTEGER - left) return null;
  return left + right;
}

function isFiniteCounter(value) {
  return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function mandatoryCountersWithinCaps(counters, caps) {
  if (!counters || typeof counters !== 'object' || !caps || typeof caps !== 'object') return false;
  return ROLLING_PCM_MANDATORY_COUNTER_KEYS.every(key =>
    Object.prototype.hasOwnProperty.call(counters, key) &&
    Object.prototype.hasOwnProperty.call(caps, key) && isFiniteCounter(counters[key]) &&
    isFiniteCounter(caps[key]) && counters[key] <= caps[key]);
}

function normalizeMemoryProfileResult(result) {
  if (!ROLLING_PCM_CANDIDATE_PROFILES.some(profile => profile.id === result?.profileId) ||
      result?.continuityPassed !== true || result?.plateauPassed !== true) {
    return null;
  }
  const evidence = normalizeLiveMemoryEvidence(result.liveMemoryEvidence);
  const baselineEvidence = normalizeLiveMemoryEvidence(result.baselineLiveMemoryEvidence);
  const policy = evidence
    ? getRollingPcmEvidencePolicy(evidence.cell, evidence.profileId)
    : null;
  if (!evidence?.withinCaps || !baselineEvidence || !policy ||
      !sameCounterRecord(result.mandatoryCounterCaps, policy.mandatoryCounterCaps) ||
      !mandatoryCountersWithinCaps(result.mandatoryCounters, policy.mandatoryCounterCaps) ||
      result.policyVersion !== evidence.policyVersion ||
      result.policyDigest !== evidence.policyDigest ||
      result.profileId !== evidence.profileId ||
      !sameEvidenceCell(result.cell, evidence.cell) ||
      baselineEvidence.policyVersion !== evidence.policyVersion ||
      baselineEvidence.policyDigest !== evidence.policyDigest ||
      baselineEvidence.profileId !== evidence.profileId ||
      !sameEvidenceCell(baselineEvidence.cell, evidence.cell) ||
      evidence.totalBytes >= baselineEvidence.totalBytes) return null;
  return Object.freeze({
    ...result,
    liveMemoryEvidence: evidence,
    baselineLiveMemoryEvidence: baselineEvidence,
    residentPeakBytes: evidence.totalBytes,
    baselineResidentPeakBytes: baselineEvidence.totalBytes,
    liveNodePeak: result.mandatoryCounters.liveSourceNodes
  });
}

function normalizeLiveMemoryEvidence(evidence) {
  if (!evidence || evidence.schemaVersion !== ROLLING_PCM_LIVE_MEMORY_EVIDENCE_SCHEMA_VERSION ||
      evidence.policyVersion !== ROLLING_PCM_POLICY_VERSION ||
      !evidence.categories || typeof evidence.categories !== 'object' ||
      !evidence.categoryCaps || typeof evidence.categoryCaps !== 'object' ||
      !Number.isSafeInteger(evidence.aggregateByteCap) || evidence.aggregateByteCap < 0) {
    return null;
  }
  const policy = getRollingPcmEvidencePolicy(evidence.cell, evidence.profileId);
  if (!policy || evidence.policyDigest !== policy.policyDigest ||
      evidence.aggregateByteCap !== policy.aggregateByteCap ||
      !sameCounterRecord(evidence.categoryCaps, policy.categoryCaps)) return null;
  const categories = {};
  const categoryCaps = {};
  let totalBytes = 0;
  let withinCaps = true;
  for (const key of ROLLING_PCM_LIVE_MEMORY_CATEGORIES) {
    if (!Object.prototype.hasOwnProperty.call(evidence.categories, key) ||
        !Object.prototype.hasOwnProperty.call(evidence.categoryCaps, key)) return null;
    const value = evidence.categories[key];
    const cap = evidence.categoryCaps[key];
    if (!Number.isSafeInteger(value) || value < 0 ||
        !Number.isSafeInteger(cap) || cap < 0) return null;
    totalBytes = checkedSum(totalBytes, value);
    if (totalBytes === null) return null;
    categories[key] = value;
    categoryCaps[key] = cap;
    if (value > cap) withinCaps = false;
  }
  if (Object.keys(evidence.categories).length !== ROLLING_PCM_LIVE_MEMORY_CATEGORIES.length ||
      Object.keys(evidence.categoryCaps).length !== ROLLING_PCM_LIVE_MEMORY_CATEGORIES.length) {
    return null;
  }
  if (totalBytes > evidence.aggregateByteCap) withinCaps = false;
  if (Object.prototype.hasOwnProperty.call(evidence, 'totalBytes') &&
      evidence.totalBytes !== totalBytes) return null;
  if (Object.prototype.hasOwnProperty.call(evidence, 'withinCaps') &&
      evidence.withinCaps !== withinCaps) return null;
  return Object.freeze({
    schemaVersion: ROLLING_PCM_LIVE_MEMORY_EVIDENCE_SCHEMA_VERSION,
    policyVersion: policy.policyVersion,
    policyDigest: policy.policyDigest,
    profileId: policy.profileId,
    cell: policy.cell,
    categories: Object.freeze(categories),
    categoryCaps: Object.freeze(categoryCaps),
    aggregateByteCap: evidence.aggregateByteCap,
    totalBytes,
    withinCaps
  });
}

function isReservationRole(role) {
  return role === 'current' || role === 'next' || role === 'candidate';
}

function normalizeReservation(role, reservation, profile) {
  const canonicalIdentity = reservation?.canonicalIdentity;
  const canonicalCompressedBytes = reservation?.canonicalCompressedBytes;
  const workerCompressedBytes = reservation?.workerCompressedBytes;
  const pcmBytes = reservation?.pcmBytes;
  const inFlightBytes = reservation?.inFlightBytes ?? 0;
  if ((typeof canonicalIdentity !== 'object' || canonicalIdentity === null) &&
      (typeof canonicalIdentity !== 'string' || canonicalIdentity.length === 0)) return null;
  if (![canonicalCompressedBytes, workerCompressedBytes, pcmBytes, inFlightBytes]
    .every(value => Number.isSafeInteger(value) && value >= 0)) return null;
  const promotionPcmBytes = role === 'next' ? profile?.currentPcmByteCap : pcmBytes;
  if (!Number.isSafeInteger(promotionPcmBytes) || promotionPcmBytes < pcmBytes) return null;
  const withPcm = checkedSum(workerCompressedBytes, promotionPcmBytes);
  const ownerBytes = checkedSum(withPcm, inFlightBytes);
  const totalBytes = checkedSum(canonicalCompressedBytes, ownerBytes);
  return totalBytes === null ? null : Object.freeze({
    role,
    canonicalIdentity,
    canonicalCompressedBytes,
    workerCompressedBytes,
    pcmBytes,
    promotionPcmBytes,
    inFlightBytes,
    ownerBytes,
    totalBytes
  });
}

function totalReservationBytes(entries) {
  let total = 0;
  const canonicalOwners = new Map();
  for (const entry of entries.values()) {
    total = checkedSum(total, entry.ownerBytes);
    if (total === null) return null;
    const previousBytes = canonicalOwners.get(entry.canonicalIdentity);
    if (previousBytes !== undefined && previousBytes !== 0 &&
        entry.canonicalCompressedBytes !== 0 &&
        previousBytes !== entry.canonicalCompressedBytes) return null;
    canonicalOwners.set(
      entry.canonicalIdentity,
      Math.max(previousBytes ?? 0, entry.canonicalCompressedBytes)
    );
  }
  for (const bytes of canonicalOwners.values()) {
    total = checkedSum(total, bytes);
    if (total === null) return null;
  }
  return total;
}

function profileOrder(profileId) {
  const index = ROLLING_PCM_CANDIDATE_PROFILES.findIndex(profile => profile.id === profileId);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}
