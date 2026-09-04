import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePcmWaveFormatFromBytes } from '../../js/library/metadata/riff-info.js';
import { PCM16_STEREO_44100_TO_96000_PROFILE } from '../../js/ui/audio-player/rolling-pcm-core.js';
import {
  chooseResourceSafeFallback,
  cloneRollingCandidateSource,
  createRollingPcmLiveMemoryEvidence,
  createRollingPcmCapabilityReport,
  createCanonicalPlaybackSourceSnapshot,
  DEFAULT_ROLLING_PCM_PROFILE_ID,
  estimateDecodedPcmBytes,
  deriveRollingProductionSelection,
  evaluateRollingEligibility,
  hasRollingMatrixCandidate,
  getRollingPcmEvidencePolicy,
  getRollingPcmProfile,
  hasResidentCanonicalSource,
  normalizeGaplessPlayback,
  PRODUCTION_ROLLING_ENABLED_MATRIX,
  PRODUCTION_ROLLING_POLICY_MODE,
  PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD,
  ROLLING_PCM_CLEANUP_OBSERVATION_TIMES_MS,
  RollingPcmAdmissionLedger,
  ROLLING_PCM_LIVE_MEMORY_CATEGORIES,
  RollingPolicyMode,
  SELECTED_ROLLING_PCM_PROFILE_ID,
  selectMemoryProfile,
  selectPlaybackBackend
} from '../../js/ui/audio-player/rolling-pcm-policy.js';

const NATIVE_FRAGMENT_CANDIDATE_MATRIX = Object.freeze([
  PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.cell
]);

function createPcmWave({
  riffId = 'RIFF',
  formatTag = 1,
  channelCount = 2,
  sampleRate = 48000,
  bitsPerSample = 16,
  blockAlign = channelCount * (bitsPerSample / 8),
  byteRate = sampleRate * blockAlign,
  dataByteLength = blockAlign * 4
} = {}) {
  const paddedDataLength = dataByteLength + (dataByteLength & 1);
  const bytes = new Uint8Array(44 + paddedDataLength);
  const view = new DataView(bytes.buffer);
  const writeAscii = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  writeAscii(0, riffId);
  view.setUint32(4, bytes.length - 8, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, formatTag, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataByteLength, true);
  return bytes;
}

function snapshot({ mediaSource = null, format = 'wav', byteLength = 1024 } = {}) {
  return Object.freeze({
    sourceKind: 'bytes',
    bytes: new Uint8Array([1, 2, 3]),
    mediaSource,
    format,
    byteLength,
    legacyDecision: Object.freeze({ mode: 'buffer', allowMediaFallback: true, reason: 'legacy' })
  });
}

function blobSnapshot({ format = 'wav', byteLength = 1024 } = {}) {
  const blob = new Blob([new Uint8Array(byteLength)], { type: 'audio/wav' });
  return Object.freeze({
    sourceKind: 'blob',
    blob,
    mediaSource: blob,
    format,
    byteLength,
    legacyDecision: Object.freeze({ mode: 'buffer', allowMediaFallback: true, reason: 'legacy' })
  });
}

function pathSnapshot({
  path = 'C:\\SyntheticCatalog\\track.wav',
  name = 'Extensionless display',
  fileName = 'track.wav',
  sourceFileName = fileName,
  byteLength = 1024
} = {}) {
  const track = { name, fileName, sourceFileName, path };
  return createCanonicalPlaybackSourceSnapshot(
    track,
    { mediaSource: path, byteLength, readBytes: () => {} },
    { mode: 'media', allowMediaFallback: false, reason: 'legacy-media' }
  );
}

const MEMORY_CELL = Object.freeze({
  host: 'chromium',
  format: 'wav',
  sampleRate: 48000,
  channelCount: 2,
  lifecycle: 'foreground'
});

test('strict PCM WAVE parsing returns verified frame and format bounds', () => {
  const bytes = createPcmWave({ dataByteLength: 24 });

  assert.deepEqual(parsePcmWaveFormatFromBytes(bytes), {
    channelCount: 2,
    sampleRate: 48000,
    bitsPerSample: 16,
    blockAlign: 4,
    byteRate: 192000,
    sourceByteLength: bytes.length,
    dataOffset: 44,
    dataByteLength: 24,
    sourceFrames: 6
  });
});

test('strict PCM WAVE parsing rejects malformed and truncated RIFF extents', () => {
  const staleSize = createPcmWave();
  new DataView(staleSize.buffer).setUint32(4, staleSize.length - 10, true);
  const truncated = createPcmWave().slice(0, -1);

  assert.equal(parsePcmWaveFormatFromBytes(staleSize), null);
  assert.equal(parsePcmWaveFormatFromBytes(truncated), null);
  assert.equal(parsePcmWaveFormatFromBytes(createPcmWave({ riffId: 'RF64' })), null);
});

test('strict PCM WAVE parsing rejects compressed formats and inconsistent alignment', () => {
  assert.equal(parsePcmWaveFormatFromBytes(createPcmWave({ formatTag: 3 })), null);
  assert.equal(parsePcmWaveFormatFromBytes(createPcmWave({ blockAlign: 2 })), null);
  assert.equal(parsePcmWaveFormatFromBytes(createPcmWave({ dataByteLength: 3 })), null);
});

test('strict PCM WAVE parsing rejects data before format metadata', () => {
  const ordinary = createPcmWave({ dataByteLength: 16 });
  const reordered = ordinary.slice();
  reordered.set(ordinary.subarray(36), 12);
  reordered.set(ordinary.subarray(12, 36), 36);

  assert.equal(parsePcmWaveFormatFromBytes(reordered), null);
});

function liveMemoryEvidence(totalBytes, profileId = 'memory-first', overrides = {}) {
  const categories = Object.fromEntries(
    ROLLING_PCM_LIVE_MEMORY_CATEGORIES.map(key => [key, 0])
  );
  categories.queuedAudioBufferBytes = totalBytes;
  return createRollingPcmLiveMemoryEvidence({
    categories,
    cell: MEMORY_CELL,
    profileId,
    ...overrides
  });
}

function profileMeasurement(profileId, totalBytes, baselineBytes, overrides = {}) {
  const liveMemory = liveMemoryEvidence(totalBytes, profileId);
  return {
    profileId,
    policyVersion: liveMemory.policyVersion,
    policyDigest: liveMemory.policyDigest,
    cell: liveMemory.cell,
    continuityPassed: true,
    plateauPassed: true,
    liveMemoryEvidence: liveMemory,
    baselineLiveMemoryEvidence: liveMemoryEvidence(baselineBytes, profileId),
    ...overrides
  };
}

function mandatoryCounters(liveSourceNodes) {
  return {
    livePcmBytes: 1,
    liveAudioBuffers: 1,
    liveSourceNodes,
    liveWorkers: 1,
    liveHandlers: 2,
    liveTimers: 0,
    inFlightBytes: 0
  };
}

function authoritativeCounterCaps(profileId) {
  return getRollingPcmEvidencePolicy(MEMORY_CELL, profileId).mandatoryCounterCaps;
}

test('production evidence enables the single Electron native-fragment cell', () => {
  assert.equal(PRODUCTION_ROLLING_POLICY_MODE, RollingPolicyMode.LIMITED_ROLLING);
  assert.equal(SELECTED_ROLLING_PCM_PROFILE_ID, DEFAULT_ROLLING_PCM_PROFILE_ID);
  assert.equal(PRODUCTION_ROLLING_ENABLED_MATRIX.length, 1);
  assert.deepEqual(PRODUCTION_ROLLING_ENABLED_MATRIX[0],
    { ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.cell });
  assert.equal(PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.processMemory.allGatesPassed, true);
  assert.equal(PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.processMemory.observedCleanupOverageBytes,
    Math.min(...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.processMemory.cleanupObservationOveragesBytes));
});

test('missing Gapless Playback preferences remain enabled', () => {
  assert.equal(normalizeGaplessPlayback(null), true);
  assert.equal(normalizeGaplessPlayback({}), true);
  assert.equal(normalizeGaplessPlayback({ gaplessPlayback: true }), true);
  assert.equal(normalizeGaplessPlayback({ gaplessPlayback: false }), false);
});

test('decoded PCM estimates reject invalid and overflowing metadata', () => {
  assert.equal(estimateDecodedPcmBytes({ durationSec: 10, sampleRate: 48000, channelCount: 2 }), 3840000);
  assert.equal(estimateDecodedPcmBytes({ durationSec: NaN, sampleRate: 48000, channelCount: 2 }), null);
  assert.equal(estimateDecodedPcmBytes({ durationSec: Number.MAX_SAFE_INTEGER, sampleRate: 384000, channelCount: 2 }), null);
});

test('resource-safe policy selects audio element playback when media is usable', () => {
  const source = snapshot({ mediaSource: 'track.wav' });
  assert.deepEqual(chooseResourceSafeFallback(source, null, { preferMedia: true }), {
    mode: 'media', allowMediaFallback: false, reason: 'gapless-disabled-media'
  });
  assert.equal(selectPlaybackBackend({
    snapshot: source,
    metadata: { durationSec: 1, sampleRate: 48000, channelCount: 2 },
    audioContext: { sampleRate: 48000 },
    policyMode: RollingPolicyMode.RESOURCE_SAFE_LEGACY
  }).mode, 'media');
});

test('resource-safe policy rejects bytes-only playback without decoding metadata', () => {
  assert.deepEqual(chooseResourceSafeFallback(snapshot(), {
    durationSec: 1, sampleRate: 48000, channelCount: 2
  }), {
    mode: 'unavailable',
    allowMediaFallback: false,
    reason: 'resource-safe-media-unavailable'
  });
});

test('legacy baseline preserves bounded bytes-only buffer playback', () => {
  const decision = selectPlaybackBackend({
    snapshot: snapshot(),
    metadata: null,
    audioContext: { sampleRate: 48000 },
    policyMode: RollingPolicyMode.LEGACY_BASELINE
  });

  assert.equal(decision.mode, 'buffer');
  assert.equal(decision.reason, 'legacy');
});

test('candidate bytes are copied without detaching the canonical source', () => {
  const canonical = new Uint8Array([4, 5, 6]);
  const source = createCanonicalPlaybackSourceSnapshot(
    { name: 'track.wav', bytes: canonical },
    { byteLength: canonical.byteLength, mediaSource: null },
    { mode: 'buffer', allowMediaFallback: false, reason: 'legacy' }
  );
  const candidate = cloneRollingCandidateSource(source);
  new Uint8Array(candidate.bytes)[0] = 9;
  assert.deepEqual([...canonical], [4, 5, 6]);
  assert.equal(source.format, 'wav');
});

test('canonical identity is stable only for the same physical byte region and reuses its snapshot', () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const descriptor = { byteLength: bytes.byteLength, mediaSource: null };
  const legacy = { mode: 'buffer', allowMediaFallback: false, reason: 'legacy' };
  const first = createCanonicalPlaybackSourceSnapshot(
    { name: 'same.wav', bytes }, descriptor, legacy
  );
  const sameRegion = createCanonicalPlaybackSourceSnapshot(
    { name: 'same.wav', bytes: new Uint8Array(bytes.buffer) },
    descriptor,
    legacy,
    first
  );
  const distinct = createCanonicalPlaybackSourceSnapshot(
    { name: 'same.wav', bytes: new Uint8Array([1, 2, 3]) }, descriptor, legacy, first
  );
  assert.equal(sameRegion, first);
  assert.equal(sameRegion.canonicalIdentity, first.canonicalIdentity);
  assert.notEqual(distinct.canonicalIdentity, first.canonicalIdentity);
  assert.notEqual(distinct, first);
});

test('physical source identity recognizes catalog WAV names without trusting the display title', () => {
  assert.equal(pathSnapshot({
    name: 'Extensionless catalog title',
    fileName: 'catalog-source.wav'
  }).format, 'wav');
  assert.equal(pathSnapshot({
    name: 'Misleading display.wav',
    fileName: 'physical-source.mp3',
    sourceFileName: 'physical-source.mp3',
    path: 'C:\\SyntheticCatalog\\physical-source.mp3'
  }).format, null);
});

test('exact native candidate preflight waits for READY on the enabled production cell', () => {
  const source = pathSnapshot();
  const capability = {
    host: 'electron',
    electronMajorVersion: 44,
    chromiumMajorVersion: 152,
    lifecycle: 'foreground',
    workerAvailable: true,
    audioDecoderAvailable: false
  };
  const pending = selectPlaybackBackend({
    snapshot: source,
    metadata: { durationSec: null, sampleRate: null, channelCount: null },
    audioContext: { sampleRate: 96000 },
    policyMode: RollingPolicyMode.LIMITED_ROLLING,
    enabledMatrix: NATIVE_FRAGMENT_CANDIDATE_MATRIX,
    capability
  });

  assert.equal(pending.mode, 'media');
  assert.equal(pending.rollingCandidate, true);
  assert.equal(hasRollingMatrixCandidate(source, PRODUCTION_ROLLING_ENABLED_MATRIX, capability), true);
  assert.equal(hasRollingMatrixCandidate(source, PRODUCTION_ROLLING_ENABLED_MATRIX, {
    ...capability,
    host: 'chromium',
    electronMajorVersion: null
  }), false);
  assert.equal(hasRollingMatrixCandidate(source, NATIVE_FRAGMENT_CANDIDATE_MATRIX, capability), true);
  assert.equal(hasRollingMatrixCandidate(snapshot({ mediaSource: 'track.wav' }),
    NATIVE_FRAGMENT_CANDIDATE_MATRIX, capability), false);
  assert.equal(hasRollingMatrixCandidate(source, NATIVE_FRAGMENT_CANDIDATE_MATRIX, {
    ...capability,
    chromiumMajorVersion: 151
  }), false);
  assert.equal(hasRollingMatrixCandidate(source, NATIVE_FRAGMENT_CANDIDATE_MATRIX, {
    ...capability,
    lifecycle: undefined
  }), false);
  const regionTrack = {
    name: 'Catalog CUE display',
    fileName: 'catalog-cue.wav',
    sourceFileName: 'catalog-cue.wav',
    path: 'C:\\SyntheticCatalog\\catalog-cue.wav',
    startFrame: 100,
    endFrame: 200
  };
  const regionSource = createCanonicalPlaybackSourceSnapshot(
    regionTrack,
    {
      mediaSource: regionTrack.path,
      byteLength: 1024,
      startFrame: regionTrack.startFrame,
      endFrame: regionTrack.endFrame,
      readBytes: () => {}
    },
    { mode: 'media', allowMediaFallback: false, reason: 'legacy-media' }
  );
  assert.equal(regionSource.hasPlaybackRegion, true);
  assert.equal(hasRollingMatrixCandidate(
    regionSource,
    NATIVE_FRAGMENT_CANDIDATE_MATRIX,
    capability
  ), false);
});

test('MP3 remains resource-safe while its native decoder and trim gates are unavailable', () => {
  const source = pathSnapshot({
    name: 'Catalog MP3',
    fileName: 'catalog.mp3',
    sourceFileName: 'catalog.mp3',
    path: 'C:\\SyntheticCatalog\\catalog.mp3'
  });
  const decision = selectPlaybackBackend({
    snapshot: source,
    metadata: null,
    audioContext: { sampleRate: 96000 },
    policyMode: RollingPolicyMode.LIMITED_ROLLING,
    enabledMatrix: PRODUCTION_ROLLING_ENABLED_MATRIX,
    capability: {
      host: 'electron',
      electronMajorVersion: 44,
      chromiumMajorVersion: 152,
      lifecycle: 'foreground',
      workerAvailable: true,
      audioDecoderAvailable: true
    }
  });

  assert.equal(source.format, null);
  assert.equal(decision.mode, 'media');
  assert.equal(decision.rollingCandidate, undefined);
});

test('rolling eligibility requires both an enabled cell and a usable media fallback', () => {
  const source = blobSnapshot();
  const metadata = {
    durationSec: 600,
    sampleRate: 48000,
    channelCount: 2,
    containerMimeType: 'audio/wav',
    codec: 'pcm-s16',
    decoderConfigCodec: 'pcm-s16',
    decoderConfigVerified: true
  };
  const common = {
    snapshot: source,
    metadata,
    audioContext: { sampleRate: 48000 },
    policyMode: RollingPolicyMode.LIMITED_ROLLING,
    host: 'chromium',
    lifecycle: 'foreground',
    workerAvailable: true,
    audioDecoderAvailable: true
  };
  assert.equal(evaluateRollingEligibility({ ...common, enabledMatrix: [] }).reason, 'matrix-disabled');
  const enabledMatrix = [{
    host: 'chromium', format: 'wav', sampleRate: 48000,
    channelCount: 2, lifecycle: 'foreground', enabled: true,
    profileId: DEFAULT_ROLLING_PCM_PROFILE_ID,
    containerMimeType: 'audio/wav', codec: 'pcm-s16', decoderConfigCodec: 'pcm-s16'
  }];
  assert.equal(evaluateRollingEligibility({ ...common, enabledMatrix }).eligible, true);
  assert.equal(evaluateRollingEligibility({
    ...common,
    snapshot: snapshot(),
    enabledMatrix
  }).reason, 'media-fallback-unavailable');
  assert.equal(hasRollingMatrixCandidate(snapshot(), enabledMatrix, {
    host: 'chromium', lifecycle: 'foreground'
  }), false);
  assert.equal(evaluateRollingEligibility({
    ...common,
    enabledMatrix,
    audioContext: { sampleRate: 44100 }
  }).reason, 'sample-rate-mismatch');
  assert.equal(evaluateRollingEligibility({
    ...common,
    snapshot: blobSnapshot({ byteLength: 160 * 1024 * 1024 }),
    enabledMatrix
  }).reason, 'candidate-transient-budget');
});

test('exact candidate WAV cell rolls below the old threshold and matches both sample rates', () => {
  const source = pathSnapshot({ byteLength: 88244 });
  const profile = PCM16_STEREO_44100_TO_96000_PROFILE;
  const metadata = {
    durationSec: 0.5,
    sourceSampleRate: 44100,
    outputSampleRate: 96000,
    sampleRate: 96000,
    channelCount: 2,
    sourceTotalFrames: 22050,
    sourceByteLength: 88244,
    dataOffset: 44,
    dataByteLength: 88200,
    bitsPerSample: 16,
    blockAlign: 4,
    totalFrames: 48000,
    containerMimeType: 'audio/wav',
    codec: 'pcm-s16',
    decoderConfigCodec: 'pcm-s16',
    decoderConfigVerified: true,
    decoderProfile: profile.codec,
    resamplerProfile: profile.id
  };
  const common = {
    snapshot: source,
    metadata,
    audioContext: { sampleRate: 96000 },
    policyMode: RollingPolicyMode.LIMITED_ROLLING,
    capability: {
      host: 'electron',
      electronMajorVersion: 44,
      chromiumMajorVersion: 152,
      lifecycle: 'foreground',
      workerAvailable: true,
      audioDecoderAvailable: true
    }
  };

  assert.equal(selectPlaybackBackend({
    ...common,
    enabledMatrix: NATIVE_FRAGMENT_CANDIDATE_MATRIX
  }).mode, 'rolling');
  assert.equal(selectPlaybackBackend({
    ...common,
    enabledMatrix: [{ ...NATIVE_FRAGMENT_CANDIDATE_MATRIX[0], sourceSampleRate: 48000 }]
  }).mode, 'media');
  assert.equal(selectPlaybackBackend({
    ...common,
    enabledMatrix: [{ ...NATIVE_FRAGMENT_CANDIDATE_MATRIX[0], outputSampleRate: 48000 }]
  }).mode, 'media');
  assert.equal(selectPlaybackBackend({
    ...common,
    enabledMatrix: [{ ...NATIVE_FRAGMENT_CANDIDATE_MATRIX[0], resamplerProfile: 'wrong' }]
  }).mode, 'media');
  assert.equal(selectPlaybackBackend({
    ...common,
    metadata: { ...metadata, dataOffset: undefined },
    enabledMatrix: NATIVE_FRAGMENT_CANDIDATE_MATRIX
  }).rollingRejection, 'native-fragment-metadata-invalid');
  assert.equal(selectPlaybackBackend({
    ...common,
    metadata: { ...metadata, sourceByteLength: metadata.sourceByteLength + 4 },
    enabledMatrix: NATIVE_FRAGMENT_CANDIDATE_MATRIX
  }).rollingRejection, 'native-fragment-metadata-invalid');
  assert.equal(selectPlaybackBackend({
    ...common,
    capability: { ...common.capability, lifecycle: 'background' },
    enabledMatrix: NATIVE_FRAGMENT_CANDIDATE_MATRIX
  }).mode, 'media');
});

test('legacy baseline preserves its bytes-only decision and OFF still overrides rollout', () => {
  const source = snapshot();
  const metadata = { durationSec: 600, sampleRate: 48000, channelCount: 2 };
  assert.equal(selectPlaybackBackend({
    snapshot: source,
    metadata,
    audioContext: { sampleRate: 48000 },
    policyMode: RollingPolicyMode.LEGACY_BASELINE
  }), source.legacyDecision);
  assert.equal(selectPlaybackBackend({
    snapshot: snapshot({ mediaSource: 'track.wav' }),
    metadata,
    audioContext: { sampleRate: 48000 },
    gaplessPlayback: false,
    policyMode: RollingPolicyMode.LIMITED_ROLLING
  }).mode, 'media');
});

test('memory profile selection uses resident peak then node count then declaration order', () => {
  const selected = selectMemoryProfile([
    profileMeasurement('balanced', 10, 20, {
      mandatoryCounters: mandatoryCounters(6),
      mandatoryCounterCaps: authoritativeCounterCaps('balanced')
    }),
    profileMeasurement('memory-first', 10, 20, {
      mandatoryCounters: mandatoryCounters(5),
      mandatoryCounterCaps: authoritativeCounterCaps('memory-first')
    }),
    profileMeasurement('resilience', 1, 20, {
      continuityPassed: false,
      mandatoryCounters: mandatoryCounters(1),
      mandatoryCounterCaps: authoritativeCounterCaps('resilience')
    })
  ]);
  assert.equal(selected.profileId, 'memory-first');
  const profile = getRollingPcmProfile(48000, 2);
  assert.equal(profile.slabFrames, 96000);
  assert.equal(profile.freePoolPerSizeClass, 0);
  assert.equal(profile.compressedSourceByteCap > 0, true);
  assert.equal(profile.candidateTransientByteCap > profile.totalPcmByteCap, true);
  assert.equal(selectMemoryProfile([{ ...profileMeasurement('memory-first', 1, 2, {
    mandatoryCounters: mandatoryCounters(1),
    mandatoryCounterCaps: authoritativeCounterCaps('memory-first')
  }), profileId: 'unknown' }]), null);
  assert.equal(selectMemoryProfile([{
    ...profileMeasurement('memory-first', 1, 2),
    mandatoryCounters: mandatoryCounters(1),
    mandatoryCounterCaps: authoritativeCounterCaps('memory-first'),
    resourceCapsPassed: true,
    liveResourceEvidenceAvailable: true,
    residentPeakBytes: 1, baselineResidentPeakBytes: 2,
    liveMemoryEvidence: null,
  }]), null);
  const inconsistent = {
    ...liveMemoryEvidence(1),
    totalBytes: 2
  };
  assert.equal(selectMemoryProfile([{
    ...profileMeasurement('memory-first', 1, 2),
    mandatoryCounters: mandatoryCounters(1),
    mandatoryCounterCaps: authoritativeCounterCaps('memory-first'),
    liveMemoryEvidence: inconsistent
  }]), null);
});

test('memory profile selection authenticates mandatory live-counter caps', () => {
  const policy = getRollingPcmEvidencePolicy(MEMORY_CELL, 'memory-first');
  assert.deepEqual(policy.mandatoryCounterCaps, {
    livePcmBytes: 4608000,
    liveAudioBuffers: 6,
    liveSourceNodes: 8,
    liveWorkers: 2,
    liveHandlers: 4,
    liveTimers: 2,
    inFlightBytes: 768000
  });
  assert.match(policy.policyDigest,
    /:livePcmBytes=4608000,liveAudioBuffers=6,liveSourceNodes=8,liveWorkers=2,liveHandlers=4,liveTimers=2,inFlightBytes=768000$/);
  const authentic = profileMeasurement('memory-first', 1, 2, {
    mandatoryCounters: mandatoryCounters(8),
    mandatoryCounterCaps: policy.mandatoryCounterCaps
  });
  assert.equal(selectMemoryProfile([authentic])?.profileId, 'memory-first');
  assert.equal(selectMemoryProfile([{
    ...authentic,
    mandatoryCounters: mandatoryCounters(9),
    mandatoryCounterCaps: { ...policy.mandatoryCounterCaps, liveSourceNodes: 9 }
  }]), null);
  assert.equal(selectMemoryProfile([{
    ...authentic,
    mandatoryCounterCaps: { ...policy.mandatoryCounterCaps, liveWorkers: 3 }
  }]), null);
});

test('memory evidence rejects stale policy identity, invented caps, and inconsistent cells', () => {
  const policy = getRollingPcmEvidencePolicy(MEMORY_CELL, 'memory-first');
  const categories = Object.fromEntries(
    ROLLING_PCM_LIVE_MEMORY_CATEGORIES.map(key => [key, 0])
  );
  assert.equal(createRollingPcmLiveMemoryEvidence({
    categories,
    cell: MEMORY_CELL,
    profileId: 'memory-first',
    policyVersion: policy.policyVersion + 1
  }), null);
  assert.equal(createRollingPcmLiveMemoryEvidence({
    categories,
    cell: MEMORY_CELL,
    profileId: 'memory-first',
    categoryCaps: { ...policy.categoryCaps, queuedAudioBufferBytes: 1 }
  }), null);
  assert.equal(createRollingPcmLiveMemoryEvidence({
    categories,
    cell: { ...MEMORY_CELL, host: 'invented-host' },
    profileId: 'memory-first'
  }), null);
  const authentic = profileMeasurement('memory-first', 1, 2, {
    mandatoryCounters: mandatoryCounters(1),
    mandatoryCounterCaps: policy.mandatoryCounterCaps
  });
  assert.equal(selectMemoryProfile([{
    ...authentic,
    policyDigest: `${authentic.policyDigest}:stale`
  }]), null);
  assert.equal(selectMemoryProfile([{
    ...authentic,
    cell: { ...authentic.cell, lifecycle: 'background' }
  }]), null);
});

test('codec names are only prefilters and verified metadata must match the enabled cell', () => {
  const source = blobSnapshot({ format: 'wav' });
  const enabledMatrix = [{
    host: 'chromium', format: 'wav', sampleRate: 48000, channelCount: 2,
    lifecycle: 'foreground', enabled: true, containerMimeType: 'audio/wav',
    codec: 'pcm-s16', decoderConfigCodec: 'pcm-s16',
    profileId: DEFAULT_ROLLING_PCM_PROFILE_ID
  }];
  const common = {
    snapshot: source,
    audioContext: { sampleRate: 48000 },
    policyMode: RollingPolicyMode.LIMITED_ROLLING,
    enabledMatrix,
    host: 'chromium',
    workerAvailable: true,
    audioDecoderAvailable: true
  };
  assert.equal(evaluateRollingEligibility({
    ...common,
    metadata: { durationSec: 600, sampleRate: 48000, channelCount: 2 }
  }).reason, 'verified-codec-unsupported');
  assert.equal(evaluateRollingEligibility({
    ...common,
    metadata: {
      durationSec: 600, sampleRate: 48000, channelCount: 2,
      containerMimeType: 'audio/flac', codec: 'flac', decoderConfigCodec: 'flac',
      decoderConfigVerified: true
    }
  }).reason, 'verified-format-mismatch');
});

test('admission ledger keeps next quota distinct and retains retired ownership until cleanup', () => {
  const profile = getRollingPcmProfile(48000, 2);
  const ledger = new RollingPcmAdmissionLedger();
  const current = {};
  const next = {};
  const canonicalIdentity = {};
  assert.equal(ledger.reserve(current, 'current', {
    canonicalIdentity,
    canonicalCompressedBytes: 1024,
    workerCompressedBytes: 1024,
    pcmBytes: profile.currentPcmByteCap,
    inFlightBytes: 0
  }, profile), true);
  assert.equal(ledger.reserve(next, 'next', {
    canonicalIdentity,
    canonicalCompressedBytes: 1024,
    workerCompressedBytes: 1024,
    pcmBytes: profile.nextPcmByteCap,
    inFlightBytes: 0
  }, profile), true);
  assert.equal(ledger.totalReservedBytes(),
    1024 + 2048 + (2 * profile.currentPcmByteCap));
  assert.equal(ledger.getRole(next), 'next');
  assert.equal(ledger.canPromote(next, current, profile), true);
  assert.equal(ledger.promote(next, current, profile), true);
  assert.equal(ledger.getRole(next), 'current');
  assert.equal(ledger.getRole(current), 'retired');
  assert.equal(ledger.release(current), true);
  assert.equal(ledger.getRole(current), null);

  const aggregateCap = 1024 + 2048 + profile.currentPcmByteCap + profile.nextPcmByteCap;
  const cappedLedger = new RollingPcmAdmissionLedger({ aggregateByteCap: aggregateCap });
  const cappedCurrent = {};
  assert.equal(cappedLedger.reserve(cappedCurrent, 'current', {
    canonicalIdentity,
    canonicalCompressedBytes: 1024,
    workerCompressedBytes: 1024,
    pcmBytes: profile.currentPcmByteCap,
    inFlightBytes: 0
  }, profile), true);
  assert.equal(cappedLedger.reserve({}, 'next', {
    canonicalIdentity,
    canonicalCompressedBytes: 1024,
    workerCompressedBytes: 1024,
    pcmBytes: profile.nextPcmByteCap,
    inFlightBytes: 0
  }, profile), false);
  assert.equal(cappedLedger.reserve({}, 'candidate', {
    canonicalIdentity,
    canonicalCompressedBytes: 1024,
    workerCompressedBytes: 1024,
    pcmBytes: profile.currentPcmByteCap,
    inFlightBytes: 0
  }, profile), false);
});

test('path-backed canonical sources are not charged a phantom compressed copy', () => {
  const bytes = new Uint8Array(1024);
  assert.equal(hasResidentCanonicalSource({
    sourceKind: 'other', byteLength: 1024, mediaSource: 'C:\Catalog\rolling.wav'
  }), false);
  assert.equal(hasResidentCanonicalSource({
    sourceKind: 'bytes', byteLength: 1024, bytes
  }), true);
  assert.equal(hasResidentCanonicalSource({
    sourceKind: 'blob', byteLength: 1024, blob: { size: 1024 }
  }), true);
  assert.equal(hasResidentCanonicalSource({
    sourceKind: 'bytes', byteLength: 1024, bytes: new Uint8Array(512)
  }), false);
  assert.equal(cloneRollingCandidateSource({
    sourceKind: 'other', byteLength: 1024, mediaSource: 'C:\Catalog\rolling.wav'
  }), null);

  // A manual track switch overlaps the outgoing current with the incoming candidate. Charging a
  // canonical copy for path sources doubled every file size and rejected admissible switches.
  const profile = getRollingPcmProfile(96000, 2);
  const fileBytes = 100 * 1024 * 1024;
  const inFlightBytes = profile.slabFrames * 2 * Float32Array.BYTES_PER_ELEMENT;
  const reserveSwitch = charged => {
    const ledger = new RollingPcmAdmissionLedger();
    const reserve = (owner, role, pcmBytes) => ledger.reserve(owner, role, {
      canonicalIdentity: Object.freeze({ owner }),
      canonicalCompressedBytes: charged ? fileBytes : 0,
      workerCompressedBytes: fileBytes,
      pcmBytes,
      inFlightBytes
    }, profile);
    assert.equal(reserve('current', 'current', profile.currentPcmByteCap), true);
    return reserve('candidate', 'candidate', profile.currentPcmByteCap);
  };
  assert.equal(reserveSwitch(true), false);
  assert.equal(reserveSwitch(false), true);
});

test('capability reports reflect the versioned production evidence and stay fail-closed on regressions', () => {
  const report = createRollingPcmCapabilityReport({
    cells: [{
      host: 'chromium',
      format: 'wav',
      sampleRate: 48000,
      channelCount: 2,
      lifecycle: 'foreground',
      enabled: false,
      reason: 'baseline-improvement-failed',
      liveResources: { underruns: 0, liveWorkers: 0 }
    }]
  });
  assert.equal(report.productionMode, RollingPolicyMode.RESOURCE_SAFE_LEGACY);
  assert.equal(report.selectedProfileId, null);
  assert.deepEqual(report.enabledMatrix, []);
  assert.equal(report.cells[0].enabled, false);
  assert.equal(report.processMemory.available, false);
  assert.equal(report.generatedAt, null);

  const productionReport = createRollingPcmCapabilityReport({
    productionEvidenceRecord: PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD,
    processMemory: {
      available: true,
      metric: 'electron-app-get-app-metrics-working-set-bytes',
      reason: null
    }
  });
  assert.equal(productionReport.productionMode, RollingPolicyMode.LIMITED_ROLLING);
  assert.equal(productionReport.selectedProfileId, DEFAULT_ROLLING_PCM_PROFILE_ID);
  assert.deepEqual(productionReport.enabledMatrix,
    [{ ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.cell }]);
  assert.equal(productionReport.processMemory.available, true);
  assert.equal(createRollingPcmCapabilityReport().productionMode,
    RollingPolicyMode.RESOURCE_SAFE_LEGACY);

  const failedCounters = deriveRollingProductionSelection({
    ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD,
    mandatoryCounters: {
      ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.mandatoryCounters,
      liveWorkers: 3
    }
  });
  assert.equal(failedCounters.policyMode, RollingPolicyMode.RESOURCE_SAFE_LEGACY);
  assert.equal(failedCounters.profileId, null);
  assert.deepEqual(failedCounters.enabledMatrix, []);

  const cleanupEvidence = deriveRollingProductionSelection({
    ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD,
    warmupPlateauPassed: true,
    processMemory: {
      ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.processMemory,
      allGatesPassed: true,
      observedCleanupOverageBytes: 0,
      cleanupGraceMaximumMs: 20000,
      cleanupObservationTimesMs: ROLLING_PCM_CLEANUP_OBSERVATION_TIMES_MS,
      cleanupObservationOveragesBytes: [12000000, 10000000, 9500000, 0, 0]
    }
  });
  assert.equal(cleanupEvidence.policyMode, RollingPolicyMode.LIMITED_ROLLING);
  assert.equal(cleanupEvidence.profileId, DEFAULT_ROLLING_PCM_PROFILE_ID);

  const unreturnedCleanupEvidence = deriveRollingProductionSelection({
    ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD,
    processMemory: {
      ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.processMemory,
      allGatesPassed: false,
      observedCleanupOverageBytes: 81170432,
      cleanupObservationOveragesBytes: [126570496, 110000000, 95000000, 81170432, 81170432]
    }
  });
  assert.equal(unreturnedCleanupEvidence.policyMode, RollingPolicyMode.RESOURCE_SAFE_LEGACY);
  assert.equal(unreturnedCleanupEvidence.profileId, null);
  assert.deepEqual(unreturnedCleanupEvidence.enabledMatrix, []);

  const overstatedCleanupEvidence = deriveRollingProductionSelection({
    ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD,
    processMemory: {
      ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.processMemory,
      allGatesPassed: true,
      observedCleanupOverageBytes: 0,
      cleanupObservationOveragesBytes: [126570496, 110000000, 95000000, 81170432, 81170432]
    }
  });
  assert.equal(overstatedCleanupEvidence.policyMode, RollingPolicyMode.RESOURCE_SAFE_LEGACY);

  const mismatchedMinimumEvidence = deriveRollingProductionSelection({
    ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD,
    processMemory: {
      ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.processMemory,
      observedCleanupOverageBytes: 91045888
    }
  });
  assert.equal(mismatchedMinimumEvidence.policyMode, RollingPolicyMode.RESOURCE_SAFE_LEGACY);

  const staleProtocolEvidence = deriveRollingProductionSelection({
    ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD,
    protocolVersion: PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.protocolVersion + 1
  });
  assert.equal(staleProtocolEvidence.policyMode, RollingPolicyMode.RESOURCE_SAFE_LEGACY);

  const incompleteCleanupEvidence = deriveRollingProductionSelection({
    ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD,
    processMemory: {
      ...PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD.processMemory,
      allGatesPassed: true,
      observedCleanupOverageBytes: 0,
      cleanupGraceMaximumMs: 20000,
      cleanupObservationTimesMs: [1000, 5000, 10000, 15000],
      cleanupObservationOveragesBytes: [0, 0, 0, 0]
    }
  });
  assert.equal(incompleteCleanupEvidence.policyMode, RollingPolicyMode.RESOURCE_SAFE_LEGACY);
});

test('production selection fails closed when any single evidence field is falsified', () => {
  const record = PRODUCTION_ROLLING_SELECTION_EVIDENCE_RECORD;
  assert.equal(deriveRollingProductionSelection(record).policyMode,
    RollingPolicyMode.LIMITED_ROLLING);
  const withProcessMemory = patch => ({
    ...record,
    processMemory: { ...record.processMemory, ...patch }
  });
  const falsifiedRecords = {
    peakAboveCap: withProcessMemory({
      observedPeakIncreaseBytes: record.processMemory.peakIncreaseByteCap + 1
    }),
    inventedPeakCap: withProcessMemory({
      peakIncreaseByteCap: record.processMemory.peakIncreaseByteCap + 1
    }),
    extendedCleanupGrace: withProcessMemory({ cleanupGraceMaximumMs: 25000 }),
    shiftedObservationTimes: withProcessMemory({
      cleanupObservationTimesMs: [1000, 5000, 10000, 15000, 25000]
    }),
    processMemoryUnavailable: withProcessMemory({ available: false }),
    foreignMetric: withProcessMemory({ metric: 'electron-process-memory-info-private-bytes' }),
    plateauAboveCap: withProcessMemory({
      observedPlateauSpreadBytes: record.processMemory.plateauSpreadByteCap + 1
    }),
    continuityFailed: { ...record, continuityPassed: false },
    foreignHost: { ...record, cell: { ...record.cell, host: 'chromium' } },
    foreignChromium: { ...record, cell: { ...record.cell, chromiumMajorVersion: 151 } }
  };
  for (const [name, falsified] of Object.entries(falsifiedRecords)) {
    const selection = deriveRollingProductionSelection(falsified);
    assert.equal(selection.policyMode, RollingPolicyMode.RESOURCE_SAFE_LEGACY, name);
    assert.equal(selection.profileId, null, name);
    assert.deepEqual(selection.enabledMatrix, [], name);
    assert.equal(selection.evidenceRecord, null, name);
  }
});
