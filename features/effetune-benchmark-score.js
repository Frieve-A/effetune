export const BENCHMARK_SCORE_VERSION = 'v1';

export const BENCHMARK_SCORE_PROTOCOL = Object.freeze({
  sampleRate: 96000,
  blockSize: 128,
  channelCount: 2,
  inputSeconds: 0.5,
  warmupSeconds: 0.2,
  repetitionSeconds: 0.3,
  repetitions: 3
});

export const BENCHMARK_SCORE_EFFECTS = Object.freeze([
  Object.freeze({
    name: '5Band PEQ',
    className: 'FiveBandPEQPlugin',
    parameters: Object.freeze({ g0: 1, g1: -1, g2: 1, g3: -1, g4: 1 })
  }),
  Object.freeze({ name: 'Hard Clipping', className: 'HardClippingPlugin', parameters: null }),
  Object.freeze({ name: 'Delay', className: 'DelayPlugin', parameters: null }),
  Object.freeze({ name: 'Compressor', className: 'CompressorPlugin', parameters: null }),
  Object.freeze({ name: 'Bit Crusher', className: 'BitCrusherPlugin', parameters: null }),
  Object.freeze({
    name: 'Pitch Shifter HQ',
    className: 'PitchShifterHQPlugin',
    parameters: Object.freeze({ ps: 1 })
  })
]);

export function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('median requires a non-empty array');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
}

function validRtf(value) {
  return Number.isFinite(value) && value > 0;
}

export function computeBenchmarkScore(measuredRtfByName, reference) {
  const referenceRtfByName = reference?.effects ?? reference;
  const ratios = {};
  const missing = [];
  let logarithmSum = 0;

  for (const effect of BENCHMARK_SCORE_EFFECTS) {
    const measured = measuredRtfByName?.[effect.name];
    const expected = referenceRtfByName?.[effect.name];
    if (!validRtf(measured) || !validRtf(expected)) {
      missing.push(effect.name);
      continue;
    }
    const ratio = measured / expected;
    ratios[effect.name] = ratio;
    logarithmSum += Math.log(ratio);
  }

  if (missing.length > 0) {
    return { score: null, ratios, complete: false, missing };
  }
  return {
    score: 100 * Math.exp(logarithmSum / BENCHMARK_SCORE_EFFECTS.length),
    ratios,
    complete: true,
    missing
  };
}

export function formatScore(score) {
  if (!Number.isFinite(score)) return 'N/A';
  return score < 100 ? score.toFixed(1) : String(Math.round(score));
}
