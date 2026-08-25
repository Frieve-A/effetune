import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..', '..', '..');
const responsePath = path.join(
  repoRoot,
  'tmp',
  'dev',
  'tube-simulator-lineamp',
  'lineamp-v1',
  'phase-b-break-loop-v2.json'
);
const Q30 = 10 ** (30 / 20) - 1;
const DERIVATION_FEEDBACK_DB = Object.freeze([
  0, 5, 10, 15, 20, 25, 30
]);
const CANDIDATE_FREQUENCIES = Object.freeze([
  200, 500, 1000, 2000, 4000, 8000, 12000, 16000,
  24000, 32000, 48000, 64000, 96000, 128000
]);

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

export function responseFromCoefficients(
  coefficients,
  frequencyHz,
  sampleRate
) {
  const angle = -2 * Math.PI * frequencyHz / sampleRate;
  const z1 = complex(Math.cos(angle), Math.sin(angle));
  const z2 = multiply(z1, z1);
  const numerator = add(
    complex(coefficients.b0),
    scale(z1, coefficients.b1)
  );
  const denominator = add(
    add(complex(1), scale(z1, coefficients.a1)),
    scale(z2, coefficients.a2)
  );
  const denominatorSquared =
    denominator.real * denominator.real +
    denominator.imaginary * denominator.imaginary;
  return complex(
    (numerator.real * denominator.real +
      numerator.imaginary * denominator.imaginary) /
        denominatorSquared,
    (numerator.imaginary * denominator.real -
      numerator.real * denominator.imaginary) /
        denominatorSquared
  );
}

export function deriveAnchor(
  internalRate,
  zeroHz,
  pole1Hz,
  pole2Hz
) {
  const zero = Math.exp(-2 * Math.PI * zeroHz / internalRate);
  const pole1 = Math.exp(-2 * Math.PI * pole1Hz / internalRate);
  const pole2 = Math.exp(-2 * Math.PI * pole2Hz / internalRate);
  const normalization = (1 - pole1) * (1 - pole2) / (1 - zero);
  return {
    zeroHz,
    pole1Hz,
    pole2Hz,
    b0: normalization,
    b1: -normalization * zero,
    a1: -(pole1 + pole2),
    a2: pole1 * pole2
  };
}

function interpolateComplexResponse(response, frequencyHz) {
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
  const fraction = right.frequencyHz === left.frequencyHz
    ? 0
    : (frequencyHz - left.frequencyHz) /
      (right.frequencyHz - left.frequencyHz);
  return complex(
    left.real + fraction * (right.real - left.real),
    left.imaginary + fraction * (right.imaginary - left.imaginary)
  );
}

function unwrapPhase(phase, previous) {
  let value = phase;
  while (value - previous > 180) value -= 360;
  while (value - previous < -180) value += 360;
  return value;
}

export function interpolateCoefficients(anchor, feedbackDb) {
  const q = 10 ** (feedbackDb / 20) - 1;
  const v = Math.log1p(q) / Math.log1p(Q30);
  return {
    b0: 1 + v * (anchor.b0 - 1),
    b1: v * anchor.b1,
    a1: v * anchor.a1,
    a2: v * anchor.a2
  };
}

export function evaluateEndpoint(
  record,
  coefficients,
  feedbackDb = 30
) {
  const q = 10 ** (feedbackDb / 20) - 1;
  const plant1k = interpolateComplexResponse(
    record.detectorResponse,
    1000
  );
  const output1k = interpolateComplexResponse(
    record.outputResponse,
    1000
  );
  const h1k = responseFromCoefficients(
    coefficients,
    1000,
    record.internalRate
  );
  const a0 = magnitude(multiply(plant1k, h1k));
  const beta = q === 0 ? 0 : q / a0;
  const plant20k = interpolateComplexResponse(
    record.detectorResponse,
    20000
  );
  const output20k = interpolateComplexResponse(
    record.outputResponse,
    20000
  );
  const h20k = responseFromCoefficients(
    coefficients,
    20000,
    record.internalRate
  );
  const closed1k = divide(
    multiply(output1k, h1k),
    add(complex(1), scale(multiply(plant1k, h1k), beta))
  );
  const closed20k = divide(
    multiply(output20k, h20k),
    add(complex(1), scale(multiply(plant20k, h20k), beta))
  );
  const relative20kTo1kDb =
    20 * Math.log10(magnitude(closed20k) / magnitude(closed1k));
  let previousMagnitude = null;
  let previousFrequency = null;
  let previousPhase = null;
  let minimumDistanceToMinusOne = 1;
  const crossings = [];
  const phaseCrossings = [];
  let nextNegativeRealAxisPhase = -180;
  for (const sample of record.detectorResponse) {
    const compensation = responseFromCoefficients(
      coefficients,
      sample.frequencyHz,
      record.internalRate
    );
    const loop = scale(
      multiply(
        complex(sample.real, sample.imaginary),
        compensation
      ),
      beta
    );
    const loopMagnitude = magnitude(loop);
    const distance = magnitude(add(loop, complex(1)));
    if (distance < minimumDistanceToMinusOne) {
      minimumDistanceToMinusOne = distance;
    }
    let phase = phaseDegrees(loop);
    if (previousPhase !== null) {
      phase = unwrapPhase(phase, previousPhase);
      while (phase <= nextNegativeRealAxisPhase &&
          previousPhase > nextNegativeRealAxisPhase) {
        const fraction = (nextNegativeRealAxisPhase - previousPhase) /
          (phase - previousPhase);
        const crossingMagnitude = previousMagnitude +
          fraction * (loopMagnitude - previousMagnitude);
        phaseCrossings.push({
          phaseDegrees: nextNegativeRealAxisPhase,
          frequencyHz: previousFrequency +
            fraction * (sample.frequencyHz - previousFrequency),
          loopMagnitude: crossingMagnitude,
          gainMarginDb: -20 * Math.log10(crossingMagnitude)
        });
        nextNegativeRealAxisPhase -= 360;
      }
    }
    if (previousMagnitude !== null &&
        (previousMagnitude - 1) * (loopMagnitude - 1) <= 0 &&
        previousMagnitude !== loopMagnitude) {
      const fraction = (1 - previousMagnitude) /
        (loopMagnitude - previousMagnitude);
      crossings.push({
        frequencyHz: previousFrequency +
          fraction * (sample.frequencyHz - previousFrequency),
        phaseDegrees: previousPhase +
          fraction * (phase - previousPhase)
      });
    }
    previousMagnitude = loopMagnitude;
    previousFrequency = sample.frequencyHz;
    previousPhase = phase;
  }
  const minimumPhaseMarginDegrees = crossings.length === 0
    ? 180
    : Math.min(...crossings.map(crossing =>
      180 + crossing.phaseDegrees));
  const gainMargins = phaseCrossings
    .map(crossing => crossing.gainMarginDb);
  const minimumGainMarginDb = gainMargins.length === 0
    ? null
    : Math.min(...gainMargins);
  const acceptable =
    minimumDistanceToMinusOne > 0.35 &&
    minimumPhaseMarginDegrees >= 45 &&
    (minimumGainMarginDb === null || minimumGainMarginDb > 0) &&
    Math.abs(relative20kTo1kDb) <= 12;
  return {
    a0,
    beta,
    relative20kTo1kDb,
    minimumDistanceToMinusOne,
    minimumPhaseMarginDegrees,
    minimumGainMarginDb,
    unityGainCrossings: crossings,
    phaseCrossings,
    acceptable
  };
}

function score(result) {
  const responsePenalty =
    Math.max(0, Math.abs(result.relative20kTo1kDb) - 12);
  const distancePenalty =
    Math.max(0, 0.35 - result.minimumDistanceToMinusOne);
  const phasePenalty =
    Math.max(0, 45 - result.minimumPhaseMarginDegrees);
  const gainPenalty =
    result.minimumGainMarginDb === null
      ? 0
      : Math.max(0, -result.minimumGainMarginDb);
  return (result.acceptable ? 1e9 : 0) +
    10000 * result.minimumDistanceToMinusOne +
    10 * result.minimumPhaseMarginDegrees -
    1e6 * responsePenalty -
    1e6 * distancePenalty -
    1e5 * phasePenalty -
    1e6 * gainPenalty;
}

export function deriveForRecord(record) {
  let best = null;
  let bestGainWithinAudioConstraint = null;
  const searchRecord = {
    ...record,
    detectorResponse: record.detectorResponse.filter(
      (_, index) =>
        index % 4 === 0 ||
        index === record.detectorResponse.length - 1
    )
  };
  const consider = coefficients => {
    const screen = DERIVATION_FEEDBACK_DB.map(feedbackDb =>
      evaluateEndpoint(
        searchRecord,
        interpolateCoefficients(coefficients, feedbackDb),
        feedbackDb
      ));
    const worst = {
      acceptable: screen.every(result => result.acceptable),
      relative20kTo1kDb: screen.reduce(
        (value, result) =>
          Math.abs(result.relative20kTo1kDb) > Math.abs(value)
            ? result.relative20kTo1kDb
            : value,
        0
      ),
      minimumDistanceToMinusOne: Math.min(
        ...screen.map(result => result.minimumDistanceToMinusOne)
      ),
      minimumPhaseMarginDegrees: Math.min(
        ...screen.map(result => result.minimumPhaseMarginDegrees)
      ),
      minimumGainMarginDb: Math.min(
        ...screen
          .map(result => result.minimumGainMarginDb)
          .filter(value => value !== null)
      )
    };
    const candidate = {
      coefficients,
      result: worst,
      screen,
      score: score(worst)
    };
    if (!best || candidate.score > best.score) {
      best = candidate;
    }
    if (Math.abs(worst.relative20kTo1kDb) <= 12 &&
        worst.minimumGainMarginDb !== null &&
        (!bestGainWithinAudioConstraint ||
          worst.minimumGainMarginDb >
            bestGainWithinAudioConstraint.result.minimumGainMarginDb)) {
      bestGainWithinAudioConstraint = candidate;
    }
  };
  for (const zeroHz of CANDIDATE_FREQUENCIES) {
    if (zeroHz >= record.internalRate / 2) continue;
    for (const pole1Hz of CANDIDATE_FREQUENCIES) {
      if (pole1Hz >= record.internalRate / 2) continue;
      for (const pole2Hz of CANDIDATE_FREQUENCIES) {
        if (pole2Hz < pole1Hz || pole2Hz >= record.internalRate / 2) {
          continue;
        }
        consider(deriveAnchor(
          record.internalRate,
          zeroHz,
          pole1Hz,
          pole2Hz
        ));
      }
    }
  }
  let randomState = [...record.key].reduce(
    (value, character) =>
      Math.imul(value ^ character.charCodeAt(0), 16777619) >>> 0,
    2166136261
  );
  const random = () => {
    randomState ^= randomState << 13;
    randomState ^= randomState >>> 17;
    randomState ^= randomState << 5;
    return (randomState >>> 0) / 0x100000000;
  };
  const minimumFrequency = 50;
  const maximumFrequency = record.internalRate * 0.45;
  const logarithmicFrequency = () =>
    minimumFrequency *
    ((maximumFrequency / minimumFrequency) ** random());
  for (let index = 0; index < 2048; ++index) {
    const zeroHz = logarithmicFrequency();
    const first = logarithmicFrequency();
    const second = logarithmicFrequency();
    consider(deriveAnchor(
      record.internalRate,
      zeroHz,
      first < second ? first : second,
      first < second ? second : first
    ));
  }
  best.result = evaluateEndpoint(record, best.coefficients);
  best.result.endpointScreen = DERIVATION_FEEDBACK_DB.map(
    feedbackDb => ({
      feedbackDb,
      ...evaluateEndpoint(
        record,
        interpolateCoefficients(best.coefficients, feedbackDb),
        feedbackDb
      )
    })
  );
  best.result.acceptable = best.result.endpointScreen.every(
    result => result.acceptable
  );
  return {
    key: record.key,
    ...best,
    bestGainWithinAudioConstraint
  };
}

export function loadBreakLoopArtifact() {
  return JSON.parse(fs.readFileSync(responsePath, 'utf8'));
}

export function derivePhaseBAnchors(
  artifact = loadBreakLoopArtifact(),
  progress = null
) {
  return artifact.records.map(record => {
    progress?.(record);
    return deriveForRecord(record);
  });
}

function main() {
  const results = derivePhaseBAnchors(undefined, record => {
    process.stderr.write(`Deriving ${record.key}...\n`);
  });
  process.stdout.write(`${JSON.stringify(results.map(result => ({
    key: result.key,
    selected: {
      coefficients: result.coefficients,
      result: result.result
    },
    bestGainWithinAudioConstraint: result.bestGainWithinAudioConstraint && {
      coefficients: result.bestGainWithinAudioConstraint.coefficients,
      result: result.bestGainWithinAudioConstraint.result
    }
  })), null, 2)}\n`);
}

if (process.argv[1] &&
    import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
