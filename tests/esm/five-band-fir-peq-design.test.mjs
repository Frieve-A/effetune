import assert from 'node:assert/strict';
import test from 'node:test';

import FFT from '../../js/utils/measurement-dsp/fft.js';
import {
  designFiveBandFirPeq,
  fiveBandFirPeqMagnitude
} from '../../js/five-band-fir-peq/design-core.js';

const sampleRate = 48000;
const taps = 8192;

function designedResponse(type, gain = 0, slope = 12) {
  const result = designFiveBandFirPeq({
    sampleRate,
    taps,
    phase: 'lin',
    eqBands: [{
      enabled: true,
      type,
      frequency: 1000,
      gain,
      q: 1,
      slope
    }]
  });
  assert.equal(result.channels.length, 1);
  assert.ok(result.channels[0].every(Number.isFinite));
  const padded = new Float64Array(taps * 2);
  padded.set(result.channels[0]);
  const spectrum = new FFT(padded.length).realTransform(padded);
  const at = frequency => {
    const bin = Math.round(frequency * padded.length / sampleRate);
    return 20 * Math.log10(Math.max(
      1e-8,
      Math.hypot(spectrum.real[bin], spectrum.imag[bin])
    ));
  };
  return { low: at(100), center: at(1000), high: at(10000) };
}

test('5Band FIR PEQ designer realizes all seven magnitude filter types', () => {
  const peak = designedResponse('pk', 6);
  const lowShelf = designedResponse('ls', 6);
  const highShelf = designedResponse('hs', 6);
  const lowPass = designedResponse('lp');
  const highPass = designedResponse('hp');
  const bandPass = designedResponse('bp');
  const notch = designedResponse('no');

  assert.ok(peak.center > peak.low + 4);
  assert.ok(lowShelf.low > lowShelf.high + 4);
  assert.ok(highShelf.high > highShelf.low + 4);
  assert.ok(lowPass.low > lowPass.high + 20);
  assert.ok(highPass.high > highPass.low + 20);
  assert.ok(bandPass.center > bandPass.low + 10);
  assert.ok(notch.center < notch.low - 10);
});

test('5Band FIR PEQ reports target and realized magnitude responses', () => {
  const result = designFiveBandFirPeq({
    sampleRate,
    taps,
    phase: 'lin',
    eqBands: [{
      enabled: true,
      type: 'lp',
      frequency: 1000,
      gain: 0,
      q: 0.7,
      slope: 384
    }]
  });

  assert.equal(result.response.frequencies.length, 512);
  assert.equal(result.response.targetDb.length, 512);
  assert.equal(result.response.realizedDb.length, 512);
  assert.equal(result.response.frequencies[0], 10);
  assert.ok(Math.abs(result.response.frequencies.at(-1) - sampleRate / 2) < 1e-6);
  assert.ok(result.response.targetDb.every(Number.isFinite));
  assert.ok(result.response.realizedDb.every(Number.isFinite));
  assert.ok(result.response.realizedDb.some((value, index) =>
    Math.abs(value - result.response.targetDb[index]) > 1e-6
  ));
});

test('5Band FIR PEQ gain-independent types remain active at zero gain', () => {
  for (const type of ['lp', 'hp', 'bp', 'no']) {
    const center = fiveBandFirPeqMagnitude(type, 1000, {
      sampleRate,
      center: 1000,
      gain: 0,
      q: 1
    });
    const edge = fiveBandFirPeqMagnitude(type, type === 'hp' ? 100 : 10000, {
      sampleRate,
      center: 1000,
      gain: 0,
      q: 1
    });
    assert.ok(Number.isFinite(center));
    assert.ok(Number.isFinite(edge));
    assert.notEqual(center, edge);
  }
});

test('5Band FIR PEQ applies selectable slopes to LowPass and HighPass only', () => {
  for (const type of ['lp', 'hp']) {
    const stopFrequency = type === 'lp' ? 10000 : 100;
    const gentle = fiveBandFirPeqMagnitude(type, stopFrequency, {
      sampleRate,
      center: 1000,
      q: 1,
      slope: 12
    });
    const steep = fiveBandFirPeqMagnitude(type, stopFrequency, {
      sampleRate,
      center: 1000,
      q: 1,
      slope: 48
    });
    assert.ok(steep < gentle / 100);
  }

  const peaking = slope => fiveBandFirPeqMagnitude('pk', 1000, {
    sampleRate,
    center: 1000,
    gain: 6,
    q: 1,
    slope
  });
  assert.equal(peaking(12), peaking(96));

  const gentleLowPass = designedResponse('lp', 0, 12);
  const steepLowPass = designedResponse('lp', 0, 48);
  assert.ok(steepLowPass.high < gentleLowPass.high - 40);
});

test('5Band FIR PEQ keeps the 384 dB/oct maximum finite at high Q', () => {
  const result = designFiveBandFirPeq({
    sampleRate,
    taps,
    phase: 'lin',
    eqBands: [{
      enabled: true,
      type: 'lp',
      frequency: 1000,
      gain: 0,
      q: 100,
      slope: 384
    }]
  });

  assert.equal(result.config.eqBands[0].slope, 384);
  assert.ok(result.channels[0].every(Number.isFinite));
});

test('5Band FIR PEQ accepts slopes down to 0.1 dB/oct', () => {
  const result = designFiveBandFirPeq({
    sampleRate,
    taps,
    phase: 'lin',
    eqBands: [{
      enabled: true,
      type: 'hp',
      frequency: 1000,
      gain: 0,
      q: 0.7,
      slope: 0
    }]
  });

  assert.equal(result.config.eqBands[0].slope, 0.1);
  assert.ok(result.channels[0].every(Number.isFinite));
});

test('5Band FIR PEQ preserves phase latency and finite high-Q synthesis', () => {
  for (const phase of ['min', 'lin']) {
    const result = designFiveBandFirPeq({
      sampleRate,
      taps,
      phase,
      eqBands: [{
        enabled: true,
        type: 'no',
        frequency: 1000,
        gain: 0,
        q: 100
      }]
    });
    assert.ok(result.channels[0].every(Number.isFinite));
    assert.equal(result.latencyInfo.filterDelaySamples, phase === 'min' ? 0 : taps / 2);
    assert.equal(result.latencyInfo.resolutionHz, sampleRate / taps);
  }
});
