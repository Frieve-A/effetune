import crypto from 'node:crypto';

import {
  derivePhaseBAnchors,
  evaluateEndpoint,
  interpolateCoefficients,
  loadBreakLoopArtifact,
  responseFromCoefficients
} from './derive-phase-b-anchors.mjs';

export const PHASE_B_DESIGN_CONTRACT = 'tube-line-nfb-design-v2';
export const PHASE_B_COEFFICIENT_FAMILY_ID =
  'line-2p1z-continuous-v2';
export const PHASE_B_PLATE_REFERENCE_ID =
  'line-plate-reference-dc-v1';
export const PHASE_B_DEFAULTS = Object.freeze({
  dr: 0,
  tp: '12AU7',
  bi: 0,
  pv: 250,
  sz: 10,
  su: 10,
  og: 9,
  mx: 100,
  iv: 2.828,
  nf: 30
});
export const PHASE_B_FIELD_ORDER = Object.freeze([
  'dr', 'tp', 'bi', 'pv', 'sz', 'su', 'og', 'mx', 'iv', 'nf'
]);
export const PHASE_B_TUBES = Object.freeze([
  '12AX7',
  '12AT7',
  '12AU7'
]);
export const PHASE_B_INTERNAL_FAMILIES = Object.freeze([
  352800,
  384000
]);
export const PHASE_B_ENDPOINTS_DB = Object.freeze(
  Array.from({ length: 61 }, (_, index) => index * 0.5)
);

const Q30 = 10 ** (30 / 20) - 1;
const OUTPUT_NORMALIZATION = 0.001;

const canonicalJson = value => `${JSON.stringify(value, null, 2)}\n`;
export const sha256 = value => crypto
  .createHash('sha256')
  .update(typeof value === 'string' ? value : canonicalJson(value), 'utf8')
  .digest('hex');

const complex = (real, imaginary = 0) => ({ real, imaginary });
const add = (left, right) =>
  complex(left.real + right.real, left.imaginary + right.imaginary);
const multiply = (left, right) => complex(
  left.real * right.real - left.imaginary * right.imaginary,
  left.real * right.imaginary + left.imaginary * right.real
);
const scale = (value, factor) =>
  complex(value.real * factor, value.imaginary * factor);
const divide = (left, right) => {
  const denominator =
    right.real * right.real + right.imaginary * right.imaginary;
  return complex(
    (left.real * right.real + left.imaginary * right.imaginary) /
      denominator,
    (left.imaginary * right.real - left.real * right.imaginary) /
      denominator
  );
};
const magnitude = value => Math.hypot(value.real, value.imaginary);
const phaseDegrees = value =>
  Math.atan2(value.imaginary, value.real) * 180 / Math.PI;
const serializeComplex = value => ({
  real: value.real,
  imaginary: value.imaginary,
  magnitude: magnitude(value),
  phaseDegrees: phaseDegrees(value)
});

function responseAt(response, frequencyHz) {
  const exact = response.find(sample =>
    sample.frequencyHz === frequencyHz);
  if (exact) return complex(exact.real, exact.imaginary);
  let low = 0;
  let high = response.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (response[middle].frequencyHz <= frequencyHz) {
      low = middle;
    } else {
      high = middle;
    }
  }
  const left = response[low];
  const right = response[high];
  const fraction = (frequencyHz - left.frequencyHz) /
    (right.frequencyHz - left.frequencyHz);
  return complex(
    left.real + fraction * (right.real - left.real),
    left.imaginary + fraction * (right.imaginary - left.imaginary)
  );
}

function maximumPoleMagnitude(coefficients) {
  const discriminant =
    coefficients.a1 * coefficients.a1 - 4 * coefficients.a2;
  if (discriminant >= 0) {
    const root = Math.sqrt(discriminant);
    return Math.max(
      Math.abs((-coefficients.a1 + root) / 2),
      Math.abs((-coefficients.a1 - root) / 2)
    );
  }
  return Math.sqrt(Math.abs(coefficients.a2));
}

function endpointDesignCheck(record, anchor, feedbackDb) {
  const q = 10 ** (feedbackDb / 20) - 1;
  const v = Math.log1p(q) / Math.log1p(Q30);
  const coefficients = interpolateCoefficients(anchor, feedbackDb);
  const analysis = evaluateEndpoint(
    record,
    coefficients,
    feedbackDb
  );
  const poleMagnitude = maximumPoleMagnitude(coefficients);
  const finite = [
    q,
    v,
    coefficients.b0,
    coefficients.b1,
    coefficients.a1,
    coefficients.a2,
    poleMagnitude,
    analysis.a0,
    analysis.beta,
    analysis.relative20kTo1kDb,
    analysis.minimumDistanceToMinusOne,
    analysis.minimumPhaseMarginDegrees
  ].every(Number.isFinite);
  const acceptable = finite &&
    poleMagnitude < 1 &&
    analysis.acceptable;
  return {
    tube: record.tube,
    internalRate: record.internalRate,
    feedbackDb,
    q,
    v,
    coefficients,
    maximumPoleMagnitude: poleMagnitude,
    a0: analysis.a0,
    beta: analysis.beta,
    unityGainCrossings: analysis.unityGainCrossings,
    phaseCrossings: analysis.phaseCrossings,
    minimumPhaseMarginDegrees:
      analysis.minimumPhaseMarginDegrees,
    minimumGainMarginDb: analysis.minimumGainMarginDb,
    minimumDistanceToMinusOne:
      analysis.minimumDistanceToMinusOne,
    closedLoopRelative20kTo1kDb:
      analysis.relative20kTo1kDb,
    finite,
    verdict: acceptable ? 'acceptable' : 'rederive'
  };
}

function calibrationRecord(record, anchor, endpointChecks) {
  const gdet0 = responseAt(record.detectorResponse, 1000);
  const gout0 = scale(
    responseAt(record.outputResponse, 1000),
    1 / OUTPUT_NORMALIZATION
  );
  const endpoints = endpointChecks.map(check => {
    const hu = responseFromCoefficients(
      check.coefficients,
      1000,
      record.internalRate
    );
    const compensatedDetector = multiply(gdet0, hu);
    const closedGain = divide(
      multiply(gout0, hu),
      add(
        complex(1),
        scale(compensatedDetector, check.beta)
      )
    );
    return {
      feedbackDb: check.feedbackDb,
      q: check.q,
      v: check.v,
      a0: magnitude(compensatedDetector),
      beta: check.beta,
      closedGainAt1k: serializeComplex(closedGain),
      makeup: check.feedbackDb === 0
        ? 1
        : magnitude(gout0) / magnitude(closedGain)
    };
  });
  return {
    a0Key: ['line-v2', record.tube, record.internalRate],
    internalRateFamily: record.internalRate,
    representativeHostRate: record.hostRate,
    params: record.params,
    circuitProfileId: PHASE_B_TUBES.indexOf(record.tube),
    coefficientFamilyId: PHASE_B_COEFFICIENT_FAMILY_ID,
    coefficientAnchor: anchor,
    feedbackNode: record.feedbackNode,
    feedbackDetect: record.feedbackDetect,
    plateReferenceFunctionId: PHASE_B_PLATE_REFERENCE_ID,
    feedbackPolarity: 'negative',
    referenceLoadOhm: 100000,
    stimulus:
      'central-difference-complete-error-impulse',
    feedbackTransportInternalSamples:
      record.feedbackTransportInternalSamples,
    maximumRelativeComplexGainDelta: 0.001,
    gdet0: serializeComplex(gdet0),
    gout0: serializeComplex(gout0),
    endpoints
  };
}

let cachedDesign = null;

export function buildPhaseBDesign() {
  if (cachedDesign) return cachedDesign;
  const breakLoop = loadBreakLoopArtifact();
  const derived = derivePhaseBAnchors(breakLoop);
  const anchors = [];
  const endpointChecks = [];
  const calibration = [];
  for (const result of derived) {
    const record = breakLoop.records.find(candidate =>
      candidate.key === result.key);
    const anchor = {
      key: record.key,
      tube: record.tube,
      internalRate: record.internalRate,
      ...result.coefficients,
      derivationVerdict: result.result.acceptable
        ? 'acceptable'
        : 'rederive'
    };
    anchors.push(anchor);
    const checks = PHASE_B_ENDPOINTS_DB.map(feedbackDb =>
      endpointDesignCheck(record, anchor, feedbackDb));
    endpointChecks.push(...checks);
    calibration.push(calibrationRecord(record, anchor, checks));
  }
  const acceptableCount = endpointChecks.filter(
    check => check.verdict === 'acceptable'
  ).length;
  const defaultCalibration = calibration.find(record =>
    record.a0Key[1] === '12AU7' &&
    record.internalRateFamily === 384000);
  const defaultEndpoint = defaultCalibration.endpoints.find(
    endpoint => endpoint.feedbackDb === 30);
  const defaultClosedLoopRawGainDbAt1k =
    20 * Math.log10(defaultEndpoint.closedGainAt1k.magnitude);
  const anchorAcceptable = anchors.every(anchor =>
    anchor.derivationVerdict === 'acceptable');
  const lineGainAcceptable =
    defaultClosedLoopRawGainDbAt1k >= 10 &&
    defaultClosedLoopRawGainDbAt1k <= 13;
  cachedDesign = {
    contract: PHASE_B_DESIGN_CONTRACT,
    sixRateCoreContract: 'tube-six-rate-core-v1',
    breakLoopContract: breakLoop.contract,
    breakLoopSha256: sha256(canonicalJson(breakLoop)),
    referenceProcessor: breakLoop.referenceProcessor,
    referenceProcessorSourceSha256:
      breakLoop.pluginSourceSha256,
    coefficientFamilyId: PHASE_B_COEFFICIENT_FAMILY_ID,
    plateReferenceFunctionId: PHASE_B_PLATE_REFERENCE_ID,
    feedbackTransportInternalSamples: 2,
    exactBypass: {
      feedbackDb: 0,
      beta: 0,
      coefficients: { b0: 1, b1: 0, a1: 0, a2: 0 },
      stateRead: false,
      stateWrite: false
    },
    transition: {
      quantity: 'q=10^(nf/20)-1',
      interpolation: 'v=log1p(q)/log1p(q30)=nf/30',
      durationMilliseconds: 5,
      updateCadence: 'once-per-host-sample',
      stateTransfer:
        'transposed-direct-form-II-output-and-next-s1',
      identityDrainHostSamples: 1
    },
    derivation: {
      plant: 'measured-reference-processor-break-loop',
      insertionPoint: 'complete-error-before-2p1z',
      compensationOrder: '2p1z',
      candidateFrequencyGridHz:
        'tests/tools/tube-simulator-lineamp/derive-phase-b-anchors.mjs',
      closedLoopAudioBand:
        '20Hz-to-20kHz-relative-to-1kHz',
      crossingSearch:
        '20Hz-to-internal-Nyquist-on-measured-complex-response'
    },
    anchors,
    endpointCount: endpointChecks.length,
    acceptableCount,
    endpointVerdict:
      anchorAcceptable &&
      acceptableCount === endpointChecks.length
        ? 'acceptable'
        : 'rederive',
    endpointChecks,
    calibration,
    lineSanity: {
      defaultClosedLoopRawGainDbAt1k,
      defaultMakeup: defaultEndpoint.makeup,
      outputTrimDb: 9,
      terminalTheveninAt1kOhm: null,
      terminalTheveninMeasurement:
        'pending-production-equivalent-load-difference-diagnostic',
      verdict:
        lineGainAcceptable &&
        anchorAcceptable &&
        acceptableCount === endpointChecks.length
          ? 'acceptable'
          : 'revise'
    }
  };
  return cachedDesign;
}

export function phaseBCalibrationArtifact(
  design = buildPhaseBDesign()
) {
  return {
    contract: 'tube-line-nfb-calibration-v2',
    coefficientFamilyId: design.coefficientFamilyId,
    plateReferenceFunctionId:
      design.plateReferenceFunctionId,
    sixRateCoreContract: design.sixRateCoreContract,
    breakLoopContract: design.breakLoopContract,
    breakLoopSha256: design.breakLoopSha256,
    endpointCount: design.endpointCount,
    endpointVerdict: design.endpointVerdict,
    records: design.calibration,
    lineSanity: design.lineSanity
  };
}

export function canonicalText(value) {
  return canonicalJson(value);
}
