import assert from 'node:assert/strict';
import test from 'node:test';

const TWO_PI = Math.PI * 2;
const SAMPLE_RATE = 44100;
const REFERENCE_FACTOR = 16;
const SAMPLE_COUNT = SAMPLE_RATE;
const SKIP = SAMPLE_COUNT / 2;
const BUTTERWORTH_4_Q = [0.541196100146197, 1.306562964876377];
const BUTTERWORTH_6_Q = [0.517638090205042, 0.707106781186548, 1.931851652578137];
const BUTTERWORTH_8_Q = [
  0.509795579104159, 0.601344886935045, 0.899976223136416, 2.562915447741506
];

function makeBiquad() {
  return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0, z1: 0, z2: 0 };
}

function configureLowPass(filter, frequency, q, sampleRate) {
  const omega = TWO_PI * frequency / sampleRate;
  const cosine = Math.cos(omega);
  const sine = Math.sin(omega);
  const alpha = sine / (2 * q);
  const inverseA0 = 1 / (1 + alpha);
  const half = (1 - cosine) * 0.5;
  filter.b0 = half * inverseA0;
  filter.b1 = (1 - cosine) * inverseA0;
  filter.b2 = filter.b0;
  filter.a1 = -2 * cosine * inverseA0;
  filter.a2 = (1 - alpha) * inverseA0;
}

function makeLowPassBank(frequency, qValues, sampleRate) {
  return qValues.map(q => {
    const filter = makeBiquad();
    configureLowPass(filter, frequency, q, sampleRate);
    return filter;
  });
}

function processBank(bank, input) {
  let output = input;
  for (const filter of bank) {
    output = filter.b0 * output + filter.z1;
    filter.z1 = filter.b1 * input - filter.a1 * output + filter.z2;
    filter.z2 = filter.b2 * input - filter.a2 * output;
    input = output;
  }
  return output;
}

function fastTanh(value) {
  if (value >= 3) return 1;
  if (value <= -3) return -1;
  const squared = value * value;
  return value * (27 + squared) / (27 + 9 * squared);
}

function asymmetricLimit(value) {
  if (value > 0.95) return 0.95 + 0.30 * fastTanh((value - 0.95) / 0.30);
  if (value < -0.75) return -0.75 - 0.25 * fastTanh((-value - 0.75) / 0.25);
  return value;
}

function sineAt(index, sampleRate, frequency, gain, phase) {
  return gain * Math.sin(TWO_PI * frequency * index / sampleRate + phase);
}

function processTxSignal(sampleAt, factor, interpolationQ) {
  const rate = SAMPLE_RATE * factor;
  const interpolation = makeLowPassBank(14000, interpolationQ, rate);
  const bandwidth = makeLowPassBank(10000, BUTTERWORTH_8_Q, rate);
  const output = new Float64Array(SAMPLE_COUNT);
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const input = sampleAt(index, SAMPLE_RATE);
    let value = 0;
    for (let oversample = 0; oversample < factor; oversample++) {
      const interpolated = processBank(interpolation, oversample === 0 ? input * factor : 0);
      value = processBank(bandwidth, asymmetricLimit(interpolated));
    }
    output[index] = value;
  }
  return output;
}

function processTx(frequency, gain, phase, factor, interpolationQ) {
  return processTxSignal(
    (index, rate) => sineAt(index, rate, frequency, gain, phase),
    factor,
    interpolationQ
  );
}

function processTxReferenceSignal(sampleAt) {
  const rate = SAMPLE_RATE * REFERENCE_FACTOR;
  const bandwidth = makeLowPassBank(10000, BUTTERWORTH_8_Q, rate);
  const output = new Float64Array(SAMPLE_COUNT);
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    let value = 0;
    for (let oversample = 0; oversample < REFERENCE_FACTOR; oversample++) {
      const highRateIndex = index * REFERENCE_FACTOR + oversample;
      const input = sampleAt(highRateIndex, rate);
      value = processBank(bandwidth, asymmetricLimit(input));
    }
    output[index] = value;
  }
  return output;
}

function processTxReference(frequency, gain, phase) {
  return processTxReferenceSignal(
    (index, rate) => sineAt(index, rate, frequency, gain, phase)
  );
}

function processDetectorSignal(sampleAt, factor, interpolationQ, decimationQ) {
  const rate = SAMPLE_RATE * factor;
  const interpolation = makeLowPassBank(14000, interpolationQ, rate);
  const decimation = makeLowPassBank(10000, decimationQ, rate);
  const charge = Math.exp(-1 / (rate * 20e-6 * 0.5));
  const release = Math.exp(-1 / (rate * 20e-6));
  const output = new Float64Array(SAMPLE_COUNT);
  let capacitor = 0;
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    const input = 1 + 1.25 * sampleAt(index, SAMPLE_RATE) * 0.5;
    let value = 0;
    for (let oversample = 0; oversample < factor; oversample++) {
      const interpolated = processBank(interpolation, oversample === 0 ? input * factor : 0);
      const magnitude = interpolated < 0 ? -interpolated : interpolated;
      const coefficient = magnitude > capacitor ? charge : release;
      capacitor = magnitude + coefficient * (capacitor - magnitude);
      value = processBank(decimation, capacitor);
    }
    output[index] = value;
  }
  return output;
}

function processDetector(frequency, gain, phase, factor, interpolationQ, decimationQ) {
  return processDetectorSignal(
    (index, rate) => sineAt(index, rate, frequency, gain, phase),
    factor,
    interpolationQ,
    decimationQ
  );
}

function processDetectorReferenceSignal(sampleAt) {
  const rate = SAMPLE_RATE * REFERENCE_FACTOR;
  const decimation = makeLowPassBank(10000, BUTTERWORTH_8_Q, rate);
  const charge = Math.exp(-1 / (rate * 20e-6 * 0.5));
  const release = Math.exp(-1 / (rate * 20e-6));
  const output = new Float64Array(SAMPLE_COUNT);
  let capacitor = 0;
  for (let index = 0; index < SAMPLE_COUNT; index++) {
    let value = 0;
    for (let oversample = 0; oversample < REFERENCE_FACTOR; oversample++) {
      const highRateIndex = index * REFERENCE_FACTOR + oversample;
      const magnitude = 1 + 1.25 * sampleAt(highRateIndex, rate) * 0.5;
      const coefficient = magnitude > capacitor ? charge : release;
      capacitor = magnitude + coefficient * (capacitor - magnitude);
      value = processBank(decimation, capacitor);
    }
    output[index] = value;
  }
  return output;
}

function processDetectorReference(frequency, gain, phase) {
  return processDetectorReferenceSignal(
    (index, rate) => sineAt(index, rate, frequency, gain, phase)
  );
}

function tonePower(signal, frequency) {
  let real = 0;
  let imaginary = 0;
  for (let index = SKIP; index < signal.length; index++) {
    const angle = TWO_PI * frequency * index / SAMPLE_RATE;
    real += signal[index] * Math.cos(angle);
    imaginary -= signal[index] * Math.sin(angle);
  }
  const count = signal.length - SKIP;
  return (real * real + imaginary * imaginary) / (count * count);
}

function foldedFrequency(frequency) {
  let folded = frequency % SAMPLE_RATE;
  if (folded > SAMPLE_RATE * 0.5) folded = SAMPLE_RATE - folded;
  return folded < 0 ? -folded : folded;
}

function strongestAliasDifference(actual, reference, fundamental) {
  const fundamentalAmplitude = Math.sqrt(tonePower(actual, fundamental));
  const legalHarmonics = new Set();
  for (let harmonic = 1; harmonic * fundamental <= 10000; harmonic++) {
    legalHarmonics.add(Math.round(harmonic * fundamental));
  }
  const frequencies = new Set();
  for (let harmonic = 2; harmonic <= 96; harmonic++) {
    const frequency = Math.round(foldedFrequency(harmonic * fundamental));
    if (frequency >= 20 && frequency <= 10000 && !legalHarmonics.has(frequency)) {
      frequencies.add(frequency);
    }
  }
  let strongest = { frequency: 0, db: -300 };
  for (const frequency of frequencies) {
    const actualAmplitude = Math.sqrt(tonePower(actual, frequency));
    const referenceAmplitude = Math.sqrt(tonePower(reference, frequency));
    const difference = Math.abs(actualAmplitude - referenceAmplitude);
    const db = 20 * Math.log10((difference + 1e-30) / (fundamentalAmplitude + 1e-30));
    if (db > strongest.db) strongest = { frequency, db };
  }
  return strongest;
}

function measureCase({ frequency, gain = 1, phase = 0 }) {
  return {
    tx: strongestAliasDifference(
      processTx(frequency, gain, phase, 3, BUTTERWORTH_4_Q),
      processTxReference(frequency, gain, phase),
      frequency
    ),
    detector: strongestAliasDifference(
      processDetector(frequency, gain, phase, 5, BUTTERWORTH_6_Q, BUTTERWORTH_4_Q),
      processDetectorReference(frequency, gain, phase),
      frequency
    )
  };
}

function assertBelowAliasGate(label, cases) {
  let worst = { stage: '', frequency: 0, aliasFrequency: 0, db: -300 };
  for (const entry of cases) {
    const result = measureCase(entry);
    for (const stage of ['tx', 'detector']) {
      if (result[stage].db > worst.db) {
        worst = {
          stage,
          frequency: entry.frequency,
          aliasFrequency: result[stage].frequency,
          db: result[stage].db
        };
      }
    }
  }
  assert.ok(worst.db < -60,
    `${label}: ${worst.stage} ${worst.frequency} Hz -> ${worst.aliasFrequency} Hz was ${worst.db.toFixed(2)} dBc`);
}

const SHAPED_COMPONENTS = [
  { frequency: 3000, gain: 0.65, phase: 0.37 },
  { frequency: 5000, gain: 0.75, phase: 1.13 },
  { frequency: 7000, gain: 0.85, phase: 2.41 },
  { frequency: 9000, gain: 0.95, phase: 4.07 }
];
const SHAPED_NORMALIZER = 1 / Math.sqrt(
  SHAPED_COMPONENTS.reduce((sum, component) => sum + component.gain * component.gain, 0)
);

function shapedProgramAt(index, rate) {
  let value = 0;
  for (const component of SHAPED_COMPONENTS) {
    value += sineAt(index, rate, component.frequency, component.gain, component.phase);
  }
  return value * SHAPED_NORMALIZER;
}

function strongestCompositeAliasDifference(actual, reference) {
  let programPower = 0;
  for (const component of SHAPED_COMPONENTS) {
    programPower += tonePower(actual, component.frequency);
  }
  const legalFrequencies = new Set();
  for (let frequency = 1000; frequency <= 10000; frequency += 1000) {
    legalFrequencies.add(frequency);
  }
  const frequencies = new Set();
  for (let product = 11; product <= 96; product++) {
    const frequency = Math.round(foldedFrequency(product * 1000));
    if (frequency >= 20 && frequency <= 10000 && !legalFrequencies.has(frequency)) {
      frequencies.add(frequency);
    }
  }
  let strongest = { frequency: 0, db: -300 };
  for (const frequency of frequencies) {
    const actualAmplitude = Math.sqrt(tonePower(actual, frequency));
    const referenceAmplitude = Math.sqrt(tonePower(reference, frequency));
    const difference = Math.abs(actualAmplitude - referenceAmplitude);
    const db = 20 * Math.log10((difference + 1e-30) / (Math.sqrt(programPower) + 1e-30));
    if (db > strongest.db) strongest = { frequency, db };
  }
  return strongest;
}

test('AM Radio Simulator nonlinear stages keep tone-sweep aliases below -60 dBc', () => {
  assertBelowAliasGate('tone sweep', [2000, 4000, 6000, 8000, 10000].map(frequency => ({ frequency })));
});

test('AM Radio Simulator nonlinear stages keep composite shaped-program aliases below -60 dBc', () => {
  const tx = strongestCompositeAliasDifference(
    processTxSignal(shapedProgramAt, 3, BUTTERWORTH_4_Q),
    processTxReferenceSignal(shapedProgramAt)
  );
  const detector = strongestCompositeAliasDifference(
    processDetectorSignal(shapedProgramAt, 5, BUTTERWORTH_6_Q, BUTTERWORTH_4_Q),
    processDetectorReferenceSignal(shapedProgramAt)
  );
  assert.ok(tx.db < -60, `shaped program: tx ${tx.frequency} Hz was ${tx.db.toFixed(6)} dBc`);
  assert.ok(detector.db < -60,
    `shaped program: detector ${detector.frequency} Hz was ${detector.db.toFixed(2)} dBc`);
});
