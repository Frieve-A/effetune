import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildPhaseBDesign,
  canonicalText as phaseBCanonicalText,
  phaseBCalibrationArtifact
} from './phase-b-design.mjs';
import {
  PHASE_B_BLOCK_SIZE,
  PHASE_B_TRANSITION_CONTRACT,
  buildPhaseBTransitionSchedule
} from './phase-b-transition-contract.mjs';

export const CONTRACT_ID = 'tube-stability-v3';
export const SEED = '0x54554245';
export const CANONICAL_FIELD_ORDER = Object.freeze([
  'dr', 'tp', 'bi', 'pv', 'sz', 'su', 'og', 'mx', 'iv', 'nf',
  'os', 'pt', 'pb', 'kr', 'st', 'zp', 'sl'
]);

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..', '..', '..');
const defaultOutputDirectory = path.join(
  repoRoot, 'tests', 'fixtures', 'tube-simulator', 'lineamp-v1', 'manifests'
);

export const SUPPORTED_SAMPLE_RATES = Object.freeze([
  44100, 48000, 88200, 96000, 176400, 192000
]);

export const SIX_RATE_CORE = Object.freeze({
  contract: 'tube-six-rate-core-v1',
  p3Baseline: Object.freeze({
    hostRate: 96000,
    factor: 4,
    firLength: 257,
    internalRate: 384000,
    slowWindow: 24,
    latencySamples: 64
  }),
  configs: Object.freeze([
    Object.freeze({
      sampleRate: 44100, factor: 8, firLength: 513, internalRate: 352800,
      slowWindow: 22, firCutoffHz: 22050, latencySamples: 64
    }),
    Object.freeze({
      sampleRate: 48000, factor: 8, firLength: 513, internalRate: 384000,
      slowWindow: 24, firCutoffHz: 24000, latencySamples: 64
    }),
    Object.freeze({
      sampleRate: 88200, factor: 4, firLength: 257, internalRate: 352800,
      slowWindow: 22, firCutoffHz: 34000, latencySamples: 64
    }),
    Object.freeze({
      sampleRate: 96000, factor: 4, firLength: 257, internalRate: 384000,
      slowWindow: 24, firCutoffHz: 34000, latencySamples: 64
    }),
    Object.freeze({
      sampleRate: 176400, factor: 2, firLength: 129, internalRate: 352800,
      slowWindow: 22, firCutoffHz: 34000, latencySamples: 64
    }),
    Object.freeze({
      sampleRate: 192000, factor: 2, firLength: 129, internalRate: 384000,
      slowWindow: 24, firCutoffHz: 34000, latencySamples: 64
    })
  ])
});

const phaseFields = Object.freeze({
  A: CANONICAL_FIELD_ORDER.slice(0, 10),
  B: CANONICAL_FIELD_ORDER.slice(0, 10),
  C: [...CANONICAL_FIELD_ORDER]
});

const defaults = Object.freeze({
  A: Object.freeze({
    dr: -30, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 39, mx: 100,
    iv: 2.828, nf: 0
  }),
  B: Object.freeze({
    dr: 0, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 9, mx: 100,
    iv: 2.828, nf: 30
  }),
  C: Object.freeze({
    dr: 0, tp: '12AU7', bi: 0, pv: 250, sz: 10, su: 10, og: 9, mx: 100,
    iv: 2.828, nf: 30, os: 'Line Output', pt: 'EL84', pb: 320, kr: 270,
    st: 0, zp: 8, sl: 8
  })
});

const thresholds = Object.freeze({
  A: Object.freeze({
    maximumKclResidualA: 1e-9,
    maximumFastKclResidualA: null,
    maximumDcResidualA: 1e-12,
    maximumEnergyResidualW: null
  }),
  B: Object.freeze({
    maximumKclResidualA: 1e-9,
    maximumFastKclResidualA: 1e-9,
    maximumDcResidualA: 1e-12,
    maximumEnergyResidualW: null
  }),
  C: Object.freeze({
    maximumKclResidualA: 1e-9,
    maximumFastKclResidualA: 1e-9,
    maximumDcResidualA: 1e-10,
    maximumEnergyResidualW: 1e-6
  })
});

const tubeIndex = Object.freeze({ '12AX7': 0, '12AT7': 1, '12AU7': 2 });
const powerTubeIndex = Object.freeze({ EL84: 0, EL34: 1 });
const screenTapIndex = Object.freeze({ 0: 0, 20: 1, 43: 2 });
const primaryIndex = Object.freeze({ 6: 0, 6.6: 1, 8: 2 });

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function canonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export const SIX_RATE_CORE_SHA256 = sha256(canonicalJson(SIX_RATE_CORE));

function fail(message) {
  throw new Error(message);
}

function orderedParams(phase, patch = {}) {
  const source = { ...defaults[phase], ...patch };
  const ordered = {};
  for (const key of phaseFields[phase]) {
    const value = source[key];
    if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) {
      fail(`phase ${phase} parameter ${key} must be present and finite`);
    }
    ordered[key] = value;
  }
  return ordered;
}

function lineProfileId(params) {
  const profile = tubeIndex[params.tp];
  if (profile === undefined) {
    fail(`unknown line tube ${params.tp}`);
  }
  return profile;
}

function powerProfileId(params) {
  const pt = powerTubeIndex[params.pt];
  const st = screenTapIndex[params.st];
  const zp = primaryIndex[params.zp];
  if (pt === undefined || st === undefined || zp === undefined) {
    fail(`unsupported power profile ${params.pt}/${params.st}/${params.zp}`);
  }
  return 0x100 + pt * 9 + st * 3 + zp;
}

function topologyExpectation(params) {
  const power = params.os === 'Push-Pull Power Output';
  return {
    topologyId: power ? 1 : 0,
    circuitProfileId: power ? powerProfileId(params) : lineProfileId(params)
  };
}

const stimulusLevels = Object.freeze([
  Object.freeze({
    label: 'silence',
    value: Object.freeze({ kind: 'silence', amplitude: 0, frequencyHz: 0, noiseSeed: 0 })
  }),
  Object.freeze({
    label: 'impulse',
    value: Object.freeze({
      kind: 'impulse', amplitude: 0.5, frequencyHz: 0, noiseSeed: 0, impulseFrame: 0
    })
  }),
  Object.freeze({
    label: 'sine-1k',
    value: Object.freeze({ kind: 'sine', amplitude: 0.1, frequencyHz: 1000, noiseSeed: 0 })
  }),
  Object.freeze({
    label: 'square-20',
    value: Object.freeze({ kind: 'square', amplitude: 0.25, frequencyHz: 20, noiseSeed: 0 })
  }),
  Object.freeze({
    label: 'noise',
    value: Object.freeze({
      kind: 'noise', amplitude: 0.2, frequencyHz: 0, noiseSeed: 1414873669
    })
  }),
  Object.freeze({
    label: 'low-burst',
    value: Object.freeze({
      kind: 'low-frequency-burst', amplitude: 0.35, frequencyHz: 40,
      noiseSeed: 0, burstFrames: 1536
    })
  })
]);

function level(label, patch) {
  return Object.freeze({ label, patch: Object.freeze(patch) });
}

function cartesian(axes) {
  const output = [];
  const visit = (axisIndex, values) => {
    if (axisIndex === axes.length) {
      const patch = {};
      const labels = {};
      let stimulus = null;
      for (let index = 0; index < axes.length; ++index) {
        const axis = axes[index];
        const selected = values[index];
        labels[axis.name] = selected.label;
        if (axis.name === 'stimulus') {
          stimulus = selected.value;
        } else {
          Object.assign(patch, selected.patch);
        }
      }
      const canonical = axes.map((axis, index) =>
        `${axis.name}=${values[index].label}`).join(',');
      output.push({ patch, labels, stimulus, canonical });
      return;
    }
    for (const value of axes[axisIndex].values) {
      visit(axisIndex + 1, [...values, value]);
    }
  };
  visit(0, []);
  return output;
}

function pairKeys(candidate, axes) {
  const keys = [];
  for (let left = 0; left < axes.length; ++left) {
    for (let right = left + 1; right < axes.length; ++right) {
      const leftName = axes[left].name;
      const rightName = axes[right].name;
      keys.push(`${leftName}=${candidate.labels[leftName]}|${rightName}=${candidate.labels[rightName]}`);
    }
  }
  return keys;
}

function selectPairwise({
  phase,
  section,
  axes,
  count,
  quotaPerStimulus,
  requiredCandidates = [],
  requireCompleteCoverage = true
}) {
  const candidates = cartesian(axes);
  const requiredPairs = new Set();
  for (const candidate of candidates) {
    candidate.pairs = pairKeys(candidate, axes);
    candidate.tieHash = sha256(`${CONTRACT_ID}/${SEED}/${phase}/${candidate.canonical}`);
    for (const pair of candidate.pairs) {
      requiredPairs.add(pair);
    }
  }

  const uncovered = new Set(requiredPairs);
  const selected = [];
  const selectedCanonical = new Set();
  const stimulusCounts = new Map(stimulusLevels.map(entry => [entry.label, 0]));
  const select = candidate => {
    selected.push(candidate);
    selectedCanonical.add(candidate.canonical);
    stimulusCounts.set(
      candidate.labels.stimulus,
      stimulusCounts.get(candidate.labels.stimulus) + 1
    );
    for (const pair of candidate.pairs) {
      uncovered.delete(pair);
    }
  };
  for (const requirement of requiredCandidates) {
    const candidate = candidates.find(requirement);
    if (!candidate) {
      fail(`phase ${phase} ${section} is missing a required candidate`);
    }
    if (!selectedCanonical.has(candidate.canonical)) {
      select(candidate);
    }
  }
  while (selected.length < count) {
    let best = null;
    let bestScore = -1;
    for (const candidate of candidates) {
      if (selectedCanonical.has(candidate.canonical)) {
        continue;
      }
      const stimulusLabel = candidate.labels.stimulus;
      if (quotaPerStimulus !== null &&
          (stimulusCounts.get(stimulusLabel) ?? 0) >= quotaPerStimulus) {
        continue;
      }
      let score = 0;
      for (const pair of candidate.pairs) {
        if (uncovered.has(pair)) {
          ++score;
        }
      }
      if (best === null || score > bestScore ||
          score === bestScore && (candidate.tieHash < best.tieHash ||
            candidate.tieHash === best.tieHash && candidate.canonical < best.canonical)) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best === null) {
      fail(`phase ${phase} ${section} could not select ${count} candidates`);
    }
    select(best);
  }

  if (requireCompleteCoverage && uncovered.size !== 0) {
    fail(`phase ${phase} ${section} leaves ${uncovered.size} required pairs uncovered`);
  }
  if (quotaPerStimulus !== null) {
    for (const [stimulus, observed] of stimulusCounts) {
      if (observed !== quotaPerStimulus) {
        fail(`phase ${phase} ${section} stimulus ${stimulus} has ${observed} cases`);
      }
    }
  }
  return selected;
}

function eventFor(phase, index, params) {
  if (phase === 'A' && index % 6 === 5) {
    return {
      frame: 1536,
      params: orderedParams('A', {
        ...params,
        dr: params.dr === 0 ? -48 : 0,
        iv: params.iv === 20 ? 0.1 : 20
      })
    };
  }
  if (phase === 'B' && index % 6 === 4) {
    return {
      frame: 1536,
      params: orderedParams('B', { ...params, nf: params.nf === 30 ? 0 : 30 })
    };
  }
  if (phase === 'C' && index % 6 === 5) {
    const nextPowerTube = params.pt === 'EL34' ? 'EL84' : 'EL34';
    const nextScreenTap = nextPowerTube === 'EL34' ? 43 : 20;
    return {
      frame: 1536,
      params: orderedParams('C', {
        ...params,
        pt: nextPowerTube,
        st: nextScreenTap
      })
    };
  }
  return null;
}

function resetFor(phase, index) {
  return (phase === 'A' && index % 6 === 4) ||
      (phase === 'B' && index % 6 === 5)
    ? { frame: 2304 }
    : null;
}

function makeCase(phase, ordinal, section, candidate, patch = {}) {
  const params = orderedParams(phase, { ...candidate.patch, ...patch });
  const id = `${phase.toLowerCase()}-${String(ordinal).padStart(3, '0')}-${section}`;
  const parameterEvent = eventFor(phase, ordinal - 1, params);
  if (parameterEvent) {
    parameterEvent.expectedTopology = topologyExpectation(parameterEvent.params);
  }
  return {
    id,
    section,
    sampleRate: SUPPORTED_SAMPLE_RATES[(ordinal - 1) % SUPPORTED_SAMPLE_RATES.length],
    params,
    stimulus: candidate.stimulus,
    events: parameterEvent ? [parameterEvent] : [],
    reset: resetFor(phase, ordinal - 1),
    expectedFault: 'none',
    oscillationStartFrame: null,
    expectedTopology: topologyExpectation(params)
  };
}

function phaseAAxes() {
  return [
    { name: 'inputVolume', values: [
      level('-48', { dr: -48 }), level('-24', { dr: -24 }), level('0', { dr: 0 })
    ] },
    { name: 'tube', values: [
      level('12AX7', { tp: '12AX7' }), level('12AT7', { tp: '12AT7' }),
      level('12AU7', { tp: '12AU7' })
    ] },
    { name: 'bias', values: [level('-50', { bi: -50 }), level('50', { bi: 50 })] },
    { name: 'plate', values: [level('150', { pv: 150 }), level('300', { pv: 300 })] },
    { name: 'sourceZ', values: [level('0.6', { sz: 0.6 }), level('100', { sz: 100 })] },
    { name: 'supply', values: [level('0.1', { su: 0.1 }), level('47', { su: 47 })] },
    { name: 'inputReference', values: [
      level('0.1', { iv: 0.1 }), level('2.828', { iv: 2.828 }), level('20', { iv: 20 })
    ] },
    { name: 'stimulus', values: stimulusLevels }
  ];
}

function phaseBFeedbackAxes() {
  return [
    { name: 'inputVolume', values: [
      level('-48', { dr: -48 }), level('-24', { dr: -24 }), level('0', { dr: 0 })
    ] },
    { name: 'tube', values: [
      level('12AX7', { tp: '12AX7' }), level('12AT7', { tp: '12AT7' }),
      level('12AU7', { tp: '12AU7' })
    ] },
    { name: 'operatingCorner', values: [
      level('default', { bi: 0, pv: 250, sz: 10, su: 10 }),
      level('high', { bi: 50, pv: 300, sz: 100, su: 47 })
    ] },
    { name: 'feedback', values: [
      level('0', { nf: 0 }), level('20', { nf: 20 }),
      level('26', { nf: 26 }), level('30', { nf: 30 })
    ] },
    { name: 'stimulus', values: stimulusLevels }
  ];
}

function phaseCPowerAxes() {
  return [
    { name: 'powerProfile', values: [
      level('el84-pentode', { pt: 'EL84', st: 0 }),
      level('el84-distributed', { pt: 'EL84', st: 20 }),
      level('el34-distributed', { pt: 'EL34', st: 43 })
    ] },
    { name: 'powerBPlus', values: [
      level('300', { pb: 300 }), level('320', { pb: 320 }),
      level('461.725', { pb: 461.725 }), level('470', { pb: 470 })
    ] },
    { name: 'cathodeResistor', values: [
      level('270', { kr: 270 }), level('470', { kr: 470 }), level('500', { kr: 500 })
    ] },
    { name: 'primary', values: [
      level('6', { zp: 6 }), level('6.6', { zp: 6.6 }), level('8', { zp: 8 })
    ] },
    { name: 'speakerLoad', values: [
      level('4', { sl: 4 }), level('8', { sl: 8 }),
      level('15', { sl: 15 }), level('16', { sl: 16 })
    ] },
    { name: 'feedback', values: [
      level('0', { nf: 0 }), level('20', { nf: 20 }), level('26', { nf: 26 })
    ] },
    { name: 'stimulus', values: stimulusLevels }
  ];
}

function riskScore(candidate) {
  const params = candidate.patch;
  return (params.iv === 20 ? 16 : 0) + (params.dr === 0 ? 8 : 0) +
    (params.bi === 50 ? 4 : 0) + (params.pv === 300 ? 2 : 0) +
    (params.su === 47 ? 1 : 0);
}

function selectHighRiskA(aCandidates) {
  return [...aCandidates]
    .sort((left, right) => riskScore(right) - riskScore(left) ||
      sha256(`${CONTRACT_ID}/${SEED}/B/${left.canonical}`)
        .localeCompare(sha256(`${CONTRACT_ID}/${SEED}/B/${right.canonical}`)))
    .slice(0, 12);
}

function timingContract(phase) {
  const timing = {
    blockSize: 128,
    channels: 2,
    channelMode: 'stereo',
    maximumTimeConstantSeconds: 0.22,
    preRollTimeConstants: 20,
    recoveryTimeConstants: 40,
    finalWindowSeconds: 0.25,
    maximumRecoveryMeanAbsolute: 1e-5,
    maximumRecoveryRms: 1e-4
  };
  if (phase !== 'B') {
    return { ...timing, activeFrames: 3072 };
  }
  const schedules = SUPPORTED_SAMPLE_RATES.map(sampleRate =>
    buildPhaseBTransitionSchedule(
      sampleRate,
      timing.blockSize
    ));
  return {
    ...timing,
    activeFrames: schedules[schedules.length - 1].activeFrames,
    activeFramesBySampleRate: Object.fromEntries(
      schedules.map(schedule => [
        String(schedule.sampleRate),
        schedule.activeFrames
      ])
    ),
    physicalTimeContract: PHASE_B_TRANSITION_CONTRACT
  };
}

function manifestHeader(phase, expectedCases) {
  const blocked = phase === 'C';
  const phaseBDesign = phase === 'B' ? buildPhaseBDesign() : null;
  const phaseBCalibration = phaseBDesign
    ? phaseBCalibrationArtifact(phaseBDesign)
    : null;
  return {
    contract: CONTRACT_ID,
    phase,
    seed: SEED,
    sixRateCoreSha256: SIX_RATE_CORE_SHA256,
    supportedSampleRates: [...SUPPORTED_SAMPLE_RATES],
    readiness: blocked ? 'BLOCKED' : 'READY',
    blockedReason: phase === 'C'
        ? 'Phase C is gated by incomplete Phase B and an incomplete C1 circuit-profile freeze.'
        : null,
    expectedCases,
    requiredCoverage: {
      regions: ['preRoll', 'active', 'recovery'],
      parameterEvents: phase === 'A' ? 4 : phase === 'B' ? 24 : null,
      minimumResets: phase === 'A' ? 1 : phase === 'B' ? 2 : null
    },
    canonicalFieldOrder: [...CANONICAL_FIELD_ORDER],
    fieldOrder: [...phaseFields[phase]],
    thresholds: { ...thresholds[phase] },
    ...(phase === 'B' ? {
      phaseBDesignSha256: sha256(phaseBCanonicalText(phaseBDesign)),
      phaseBCalibrationSha256: sha256(
        phaseBCanonicalText(phaseBCalibration)
      ),
      nfbResetTransition: {
        contract: PHASE_B_TRANSITION_CONTRACT,
        fadeOutMilliseconds: 5,
        warmupMilliseconds: 50,
        fadeInMilliseconds: 5,
        curve: 'cubic-smoothstep',
        alignedDryLatencyFrames: 64,
        maximumResetsPerEvent: 1,
        maximumOldStateNewNfProcessCount: 0,
        maximumFaultEvents: 0,
        transitionOwnedAllocationAllowed: false,
        allocationScope:
          'no reset-transition-owned allocation beyond the existing ' +
          'JavaScript reference decode/process baseline',
        baselineJavascriptProcessAllocation:
          'out-of-scope for the JS reset gate; production native ' +
          'allocation-free processing remains required by B2/B3',
        activePendingGenerationRequired: true,
        beforeResetCoalescing:
          'latest-complete-snapshot-in-current-generation',
        afterResetCoalescing:
          'latest-complete-snapshot-in-next-generation',
        returnToActiveCancelsQueuedGeneration: true,
        atomicFullSnapshotRequired: true,
        warmupWetZeroRequired: true,
        warmupAlignedDryExactRequired: true,
        nfZeroIdentityRequired: true,
        postWarmupLineSanityRequired: true
      },
      referenceTransitionComparison: {
        bitExactFields: [
          'plateReferenceDc',
          'plateReferenceHost.current',
          'plateReferenceHost.target',
          'plateReferenceHost.progress'
        ],
        statePreservedAfterNonResetEvent: true,
        stateHashEqualityRequired: false,
        outputHashEqualityRequired: false,
        maximumOutputDifference: 1e-5,
        maximumCircuitStateDifference: 1e-5,
        maximumDcResidualA: 1e-12,
        transitionCompletionTolerance: 1e-7,
        expectedFaultEvents: 0
      },
      detector: {
        contract: 'tube-feedback-detector-v1',
        windowMilliseconds: 10,
        consecutiveGrowthWindows: 3,
        minimumGrowthRatio: 1.15,
        minimumOutputRms: 0.05,
        minimumFeedbackRms: 0.01,
        maximumDetectionMilliseconds: 100,
        wetMuteMilliseconds: 5,
        safeBypassDeadlineAfterDetectionMilliseconds: 5,
        processAllocationAllowed: false,
        fftAllowed: false
      }
    } : {}),
    timing: timingContract(phase),
    profileIdContract: {
      line: 'tube index: 12AX7=0, 12AT7=1, 12AU7=2',
      power: '0x100 + powerTubeIndex*9 + screenTapIndex*3 + primaryIndex',
      powerTubeOrder: ['EL84', 'EL34'],
      screenTapOrder: [0, 20, 43],
      primaryOrderKOhm: [6, 6.6, 8]
    }
  };
}

export function validateStabilityManifest(manifest, expectedPhase = 'A') {
  const expectedCases = expectedPhase === 'A' ? 24 :
    expectedPhase === 'B' ? 36 : 48;
  if (!manifest || manifest.contract !== CONTRACT_ID ||
      manifest.phase !== expectedPhase ||
      manifest.expectedCases !== expectedCases ||
      !Array.isArray(manifest.cases) ||
      manifest.cases.length !== manifest.expectedCases) {
    fail(`phase ${expectedPhase} stability manifest shape is invalid`);
  }
  if (JSON.stringify(manifest.supportedSampleRates) !==
      JSON.stringify(SUPPORTED_SAMPLE_RATES) ||
      JSON.stringify(manifest.requiredCoverage?.regions) !==
      JSON.stringify(['preRoll', 'active', 'recovery'])) {
    fail(`phase ${expectedPhase} stability manifest region/rate coverage is invalid`);
  }
  const sampleRateCounts = new Map(SUPPORTED_SAMPLE_RATES.map(rate => [rate, 0]));
  let eventCount = 0;
  let resetCount = 0;
  const ids = new Set();
  for (const record of manifest.cases) {
    if (!record?.id || ids.has(record.id)) {
      fail(`phase ${expectedPhase} stability manifest case IDs are invalid`);
    }
    ids.add(record.id);
    if (!sampleRateCounts.has(record.sampleRate)) {
      fail(`${record.id} uses an unsupported sample rate`);
    }
    sampleRateCounts.set(
      record.sampleRate, sampleRateCounts.get(record.sampleRate) + 1);
    if (expectedPhase === 'B') {
      const expectedSchedule = buildPhaseBTransitionSchedule(
        record.sampleRate,
        manifest.timing.blockSize
      );
      if (JSON.stringify(record.transitionSchedule) !==
          JSON.stringify(expectedSchedule)) {
        fail(`${record.id} does not use the frozen physical-time schedule`);
      }
    }
    if (JSON.stringify(Object.keys(record.params ?? {})) !==
        JSON.stringify(manifest.fieldOrder)) {
      fail(`${record.id} parameters do not use the canonical field order`);
    }
    if (!Array.isArray(record.events)) {
      fail(`${record.id} events must be an array`);
    }
    for (const event of record.events) {
      const recordActiveFrames =
        record.transitionSchedule?.activeFrames ??
        manifest.timing.activeFrames;
      if (!Number.isInteger(event.frame) || event.frame < 0 ||
          event.frame >= recordActiveFrames ||
          (expectedPhase !== 'B' &&
            event.frame % manifest.timing.blockSize !== 0) ||
          JSON.stringify(Object.keys(event.params ?? {})) !==
            JSON.stringify(manifest.fieldOrder)) {
        fail(`${record.id} has an invalid parameter event`);
      }
      ++eventCount;
    }
    if (record.reset !== null) {
      const recordActiveFrames =
        record.transitionSchedule?.activeFrames ??
        manifest.timing.activeFrames;
      if (!Number.isInteger(record.reset?.frame) ||
          record.reset.frame < 0 ||
          record.reset.frame >= recordActiveFrames ||
          (expectedPhase !== 'B' &&
            record.reset.frame % manifest.timing.blockSize !== 0)) {
        fail(`${record.id} has an invalid reset event`);
      }
      ++resetCount;
    }
    const sentinel = expectedPhase === 'B' &&
      record.section === 'sentinel';
    if (record.expectedFault !==
          (sentinel ? 'feedbackOscillation' : 'none') ||
        sentinel === (record.oscillationStartFrame === null)) {
      fail(`${record.id} fault and oscillation expectations are not frozen`);
    }
  }
  for (const [rate, count] of sampleRateCounts) {
    if (count !== expectedCases / SUPPORTED_SAMPLE_RATES.length) {
      fail(`phase ${expectedPhase} sample rate ${rate} has ${count} cases`);
    }
  }
  if (eventCount !== manifest.requiredCoverage.parameterEvents ||
      resetCount < manifest.requiredCoverage.minimumResets ||
      manifest.timing.preRollTimeConstants <= 0 ||
      manifest.timing.activeFrames <= 0 ||
      manifest.timing.recoveryTimeConstants <= 0 ||
      manifest.timing.finalWindowSeconds !== 0.25 ||
      Object.hasOwn(manifest.timing, 'finalWindowFrames')) {
    fail(`phase ${expectedPhase} event/reset/region coverage is incomplete`);
  }
  return manifest;
}

export function buildManifests(selectedPhase = 'A') {
  if (selectedPhase !== 'A' && selectedPhase !== 'B') {
    fail(`unsupported manifest phase ${selectedPhase}`);
  }
  const selectedA = selectPairwise({
    phase: 'A',
    section: 'coverage',
    axes: phaseAAxes(),
    count: 24,
    quotaPerStimulus: 4
  });
  const casesA = selectedA.map((candidate, index) =>
    makeCase('A', index + 1, 'coverage', candidate));
  const manifestA = { ...manifestHeader('A', 24), cases: casesA };
  validateStabilityManifest(manifestA, 'A');
  if (selectedPhase === 'A') {
    return { A: manifestA };
  }
  const defaultCandidatesB = SUPPORTED_SAMPLE_RATES.map((sampleRate, index) => ({
    patch: {},
    stimulus: stimulusLevels[index].value,
    sampleRate
  }));
  const casesBDefault = defaultCandidatesB.map((candidate, index) => {
    const record = makeCase('B', index + 1, 'line-default', candidate);
    record.sampleRate = candidate.sampleRate;
    const schedule = buildPhaseBTransitionSchedule(
      record.sampleRate,
      PHASE_B_BLOCK_SIZE
    );
    record.transitionSchedule = schedule;
    record.events = [
      {
        frame: schedule.event1Frame,
        params: orderedParams('B', { ...record.params, nf: 0 }),
        expectedTopology: topologyExpectation(record.params)
      },
      {
        frame: schedule.event2Frame,
        params: orderedParams('B', { ...record.params, nf: 30 }),
        expectedTopology: topologyExpectation(record.params)
      }
    ];
    record.resetTransitionCycles = schedule.cycles;
    return record;
  });
  const sentinelPatches = [
    { tp: '12AX7', bi: 50, pv: 150, sz: 100, su: 47, nf: 30 },
    { tp: '12AX7', bi: -50, pv: 300, sz: 0.6, su: 0.1, nf: 30 }
  ];
  const casesBSentinel = sentinelPatches.map((patch, index) => {
    const candidate = {
      patch,
      stimulus: stimulusLevels[index === 0 ? 4 : 5].value
    };
    const record = makeCase('B', index + 7, 'sentinel', candidate);
    record.sampleRate = index === 0 ? 44100 : 48000;
    record.expectedFault = 'feedbackOscillation';
    record.oscillationStartFrame = 512;
    record.events = [];
    record.reset = null;
    record.prototypeResiduals = {
      maximumFastKclResidualA: 6e-10,
      maximumSlowKclResidualA: 7e-10,
      maximumDcResidualA: 8e-13,
      finite: true,
      converged: true,
      stateBoundaryHit: false,
      protectionClampHit: false
    };
    return record;
  });
  const stableSelectedB = selectPairwise({
    phase: 'B',
    section: 'stable-control',
    axes: phaseBFeedbackAxes(),
    count: 16,
    quotaPerStimulus: null,
    requireCompleteCoverage: false
  });
  const casesBStable = stableSelectedB.map((candidate, index) =>
    makeCase('B', index + 9, 'stable-control', candidate));
  const riskSelectedB = selectHighRiskA(cartesian(phaseAAxes()));
  const casesBRisk = riskSelectedB.map((candidate, index) =>
    makeCase(
      'B',
      index + 25,
      'risk-pairwise',
      candidate,
      { nf: [0, 20, 26, 30][index % 4] }
    ));
  const casesB = [
    ...casesBDefault,
    ...casesBSentinel,
    ...casesBStable,
    ...casesBRisk
  ];
  for (let index = 8; index < casesB.length; ++index) {
    casesB[index].sampleRate = SUPPORTED_SAMPLE_RATES[
      index % SUPPORTED_SAMPLE_RATES.length
    ];
  }
  for (const record of casesB) {
    const schedule = record.transitionSchedule ??
      buildPhaseBTransitionSchedule(
        record.sampleRate,
        PHASE_B_BLOCK_SIZE
      );
    record.transitionSchedule = schedule;
    if (record.section !== 'line-default' &&
        record.events.length === 1) {
      record.events[0].frame = schedule.event1Frame;
    }
    if (record.reset !== null) {
      record.reset.frame = schedule.event2Frame;
    }
  }
  const eventCountB = casesB.reduce(
    (count, record) => count + record.events.length,
    0
  );
  const resetCountB = casesB.filter(record => record.reset !== null).length;
  const headerB = manifestHeader('B', 36);
  headerB.requiredCoverage.parameterEvents = eventCountB;
  headerB.requiredCoverage.minimumResets = resetCountB;

  const manifestB = { ...headerB, cases: casesB };
  validateStabilityManifest(manifestB, 'B');
  return { B: manifestB };
}

export function writeManifests(
  outputDirectory = defaultOutputDirectory,
  selectedPhase = 'A'
) {
  fs.mkdirSync(outputDirectory, { recursive: true });
  const manifests = buildManifests(selectedPhase);
  const written = [];
  for (const phase of Object.keys(manifests)) {
    const text = canonicalJson(manifests[phase]);
    const base = phase === 'B'
      ? 'phase-b-js-reset-gate-v5'
      : `phase-${phase.toLowerCase()}-stability-v3`;
    const manifestPath = path.join(outputDirectory, `${base}.json`);
    const hashPath = path.join(outputDirectory, `${base}.sha256`);
    fs.writeFileSync(manifestPath, text, 'utf8');
    fs.writeFileSync(hashPath, `${sha256(text)}  ${base}.json\n`, 'utf8');
    written.push({ phase, manifestPath, hashPath, sha256: sha256(text) });
  }
  return written;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(
      'Usage: node generate-stability-manifests.mjs ' +
      '[--phase <A|B>] ' +
      '[--output <directory>] [--check]\n'
    );
    return;
  }
  const outputIndex = args.indexOf('--output');
  const outputDirectory = outputIndex >= 0
    ? path.resolve(args[outputIndex + 1] ?? fail('--output requires a directory'))
    : defaultOutputDirectory;
  const phaseIndex = args.indexOf('--phase');
  const selectedPhase = phaseIndex >= 0
    ? String(args[phaseIndex + 1] ?? fail('--phase requires A or B')).toUpperCase()
    : 'A';
  const unknown = args.filter((argument, index) =>
    argument !== '--check' && argument !== '--output' &&
    argument !== '--phase' &&
    index !== outputIndex + 1 &&
    index !== phaseIndex + 1);
  if (unknown.length !== 0) {
    fail(`unknown argument(s): ${unknown.join(', ')}`);
  }

  if (args.includes('--check')) {
    const manifests = buildManifests(selectedPhase);
    for (const phase of Object.keys(manifests)) {
      const base = phase === 'B'
        ? 'phase-b-js-reset-gate-v5'
        : `phase-${phase.toLowerCase()}-stability-v3`;
      const manifestPath = path.join(outputDirectory, `${base}.json`);
      const hashPath = path.join(outputDirectory, `${base}.sha256`);
      const expectedText = canonicalJson(manifests[phase]);
      const expectedHashText = `${sha256(expectedText)}  ${base}.json\n`;
      if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== expectedText ||
          !fs.existsSync(hashPath) || fs.readFileSync(hashPath, 'utf8') !== expectedHashText) {
        fail(`stability manifest ${phase} is not current`);
      }
    }
    process.stdout.write('Tube Simulator stability manifests are current.\n');
    return;
  }

  for (const record of writeManifests(outputDirectory, selectedPhase)) {
    process.stdout.write(`${record.phase} ${record.sha256} ${record.manifestPath}\n`);
  }
}

const isMain = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
