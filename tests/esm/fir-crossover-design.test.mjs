import assert from 'node:assert/strict';
import test from 'node:test';

import FFT from '../../js/utils/measurement-dsp/fft.js';
import {
  crossoverBandMagnitudes,
  crossoverLowWeight,
  designFIRCrossover
} from '../../js/fir-crossover/design-core.js';

const baseConfig = {
  sampleRate: 48000,
  taps: 8192,
  frequencies: [200, 2000, 8000],
  slopes: [384, 192, 96]
};

test('FIR Crossover target bands remain complementary at the steepest slopes', () => {
  const config = { ...baseConfig, bandCount: 4 };
  for (const frequency of [0, 20, 200, 1000, 2000, 8000, 20000, 24000]) {
    const bands = crossoverBandMagnitudes(config, frequency);
    assert.ok(Array.from(bands).every(Number.isFinite));
    assert.ok(Array.from(bands).every(value => value >= 0 && value <= 1));
    assert.ok(Math.abs(Array.from(bands).reduce((sum, value) => sum + value, 0) - 1) <
      1e-12);
  }
  const oneOctaveAbove = crossoverLowWeight(400, 200, 384);
  assert.ok(20 * Math.log10(oneOctaveAbove) < -380);
});

test('FIR Crossover orders only active frequencies when another band is enabled', () => {
  const twoBand = designFIRCrossover({
    ...baseConfig,
    phase: 'min',
    bandCount: 2,
    frequencies: [20000, 1000, 500]
  });
  assert.deepEqual(twoBand.config.frequencies, [20000, 1000, 500]);

  const threeBand = designFIRCrossover({
    ...twoBand.config,
    bandCount: 3
  });
  assert.deepEqual(threeBand.config.frequencies, [20000, 20001, 500]);
});

function magnitudeAt(channel, frequency) {
  const fftSize = baseConfig.taps * 2;
  const padded = new Float64Array(fftSize);
  padded.set(channel);
  const spectrum = new FFT(fftSize).realTransform(padded);
  const bin = Math.round(frequency * fftSize / baseConfig.sampleRate);
  return {
    frequency: bin * baseConfig.sampleRate / fftSize,
    magnitude: Math.hypot(spectrum.real[bin], spectrum.imag[bin])
  };
}

for (const bandCount of [2, 3, 4]) {
  test(`FIR Crossover minimum-phase ${bandCount}-band taps follow each target magnitude`, () => {
    const result = designFIRCrossover({ ...baseConfig, phase: 'min', bandCount });
    const frequencies = [];
    for (let crossover = 0; crossover < bandCount - 1; crossover += 1) {
      const cutoff = baseConfig.frequencies[crossover];
      const offset = 12 / baseConfig.slopes[crossover];
      frequencies.push(cutoff / 2 ** offset, cutoff, cutoff * 2 ** offset);
    }
    for (const frequency of frequencies) {
      for (let band = 0; band < bandCount; band += 1) {
        const analyzed = magnitudeAt(result.channels[band], frequency);
        const target = crossoverBandMagnitudes(result.config, analyzed.frequency)[band];
        assert.ok(Number.isFinite(analyzed.magnitude));
        const tolerance = Math.max(0.015, target * 0.15);
        assert.ok(
          Math.abs(analyzed.magnitude - target) <= tolerance,
          `${bandCount} bands, band ${band}, ${frequency.toFixed(2)} Hz: ` +
          `actual ${analyzed.magnitude}, target ${target}`
        );
      }
    }
    assert.equal(result.latencyInfo.filterDelaySamples, 0);
    assert.equal(result.latencyInfo.resolutionHz, 48000 / baseConfig.taps);
  });
}

for (const bandCount of [2, 3, 4]) {
  test(`FIR Crossover linear-phase ${bandCount}-band taps reconstruct one delayed impulse`, () => {
    const result = designFIRCrossover({ ...baseConfig, phase: 'lin', bandCount });
    const delay = baseConfig.taps / 2;
    let maximumError = 0;
    for (let index = 0; index < baseConfig.taps; index += 1) {
      let sum = 0;
      for (const channel of result.channels) {
        assert.equal(channel.length, baseConfig.taps);
        assert.ok(Number.isFinite(channel[index]));
        sum += channel[index];
      }
      const expected = index === delay ? 1 : 0;
      maximumError = Math.max(maximumError, Math.abs(sum - expected));
    }
    assert.ok(maximumError < 2e-7, `maximum reconstruction error was ${maximumError}`);
    assert.equal(result.latencyInfo.filterDelaySamples, delay);
    assert.equal(result.latencyInfo.resolutionHz, 48000 / baseConfig.taps);
  });
}
