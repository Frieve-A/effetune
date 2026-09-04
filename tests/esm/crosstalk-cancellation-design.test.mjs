import assert from 'node:assert/strict';
import test from 'node:test';

import FFT from '../../js/utils/measurement-dsp/fft.js';
import {
  CROSSTALK_FIR_CHANNEL_ORDER,
  CrosstalkCancellationDesignError,
  designCrosstalkCancellation,
  prepareCrosstalkPlant,
  smoothDelayCompensatedSpectrum,
  solveRegularizedCrosstalkBin,
  validateCrosstalkSources
} from '../../js/crosstalk-cancellation/design-core.js';

function makeSource({
  id,
  sampleRate,
  delaySeconds,
  gain,
  trimStartSamples = 0,
  outputTimeReference = 'audio-context',
  pointCount = 1,
  tail = []
}) {
  const absoluteOnset = Math.round(delaySeconds * sampleRate);
  const onsetIndex = absoluteOnset - trimStartSamples;
  assert.ok(onsetIndex >= 0);
  const data = new Float32Array(onsetIndex + Math.round(sampleRate * 0.02));
  data[onsetIndex] = gain;
  for (const [offset, value] of tail) data[onsetIndex + offset] += value;
  return {
    id,
    pointCount,
    measurement: { points: Array.from({ length: pointCount }, () => ({})) },
    impulses: [{
      data,
      sampleRate,
      onsetIndex,
      trimStartSamples,
      outputTimeReference
    }]
  };
}

function makePlantSources(sampleRate = 48000, options = {}) {
  const crossGain = options.crossGain ?? 0.5;
  const crossDelaySeconds = options.crossDelaySeconds ?? 0.0003;
  const leftDelay = options.leftDelay ?? 0.003;
  const rightDelay = options.rightDelay ?? 0.00355;
  const timeReference = options.outputTimeReference ?? 'audio-context';
  return {
    ll: makeSource({
      id: 'left-ear::ch=left',
      sampleRate,
      delaySeconds: leftDelay,
      gain: options.llGain ?? 1,
      trimStartSamples: options.trimStarts?.ll ?? 17,
      outputTimeReference: timeReference
    }),
    rl: makeSource({
      id: 'left-ear::ch=right',
      sampleRate,
      delaySeconds: leftDelay + crossDelaySeconds,
      gain: options.rlGain ?? crossGain,
      trimStartSamples: options.trimStarts?.rl ?? 43,
      outputTimeReference: timeReference
    }),
    lr: makeSource({
      id: 'right-ear::ch=left',
      sampleRate,
      delaySeconds: rightDelay + crossDelaySeconds * 1.18,
      gain: options.lrGain ?? crossGain * 0.78,
      trimStartSamples: options.trimStarts?.lr ?? 29,
      outputTimeReference: timeReference
    }),
    rr: makeSource({
      id: 'right-ear::ch=right',
      sampleRate,
      delaySeconds: rightDelay,
      gain: options.rrGain ?? 0.84,
      trimStartSamples: options.trimStarts?.rr ?? 61,
      outputTimeReference: timeReference
    })
  };
}

function scaleEarSession(sources, slots, refScale) {
  for (const slot of slots) {
    const record = sources[slot].impulses[0];
    const data = Float32Array.from(record.data, sample => sample * refScale);
    sources[slot] = { ...sources[slot], impulses: [{ ...record, data, refScale }] };
  }
  return sources;
}

function config(overrides = {}) {
  return {
    sampleRate: 48000,
    taps: 1024,
    regularization: 0,
    maxGainDb: 24,
    lowFrequency: 300,
    highFrequency: 6000,
    directWindowMs: 8,
    ...overrides
  };
}

function spectrumForChannel(channel, fftSize) {
  const input = new Float64Array(fftSize);
  input.set(channel);
  return new FFT(fftSize).realTransform(input);
}

function value(spectrum, bin) {
  return { re: spectrum.real[bin], im: spectrum.imag[bin] };
}

function add(left, right) {
  return { re: left.re + right.re, im: left.im + right.im };
}

function subtract(left, right) {
  return { re: left.re - right.re, im: left.im - right.im };
}

function multiply(left, right) {
  return {
    re: left.re * right.re - left.im * right.im,
    im: left.re * right.im + left.im * right.re
  };
}

function scale(value, factor) {
  return { re: value.re * factor, im: value.im * factor };
}

function divide(left, right) {
  const denominator = right.re * right.re + right.im * right.im;
  return {
    re: (left.re * right.re + left.im * right.im) / denominator,
    im: (left.im * right.re - left.re * right.im) / denominator
  };
}

function magnitude(value) {
  return Math.hypot(value.re, value.im);
}

function crosstalkMetrics(plant, channels, frequency) {
  const bin = Math.round(frequency * plant.fftSize / plant.config.sampleRate);
  const hLL = value(plant.spectra.ll, bin);
  const hLR = value(plant.spectra.lr, bin);
  const hRL = value(plant.spectra.rl, bin);
  const hRR = value(plant.spectra.rr, bin);
  const spectra = channels.map(channel => spectrumForChannel(channel, plant.fftSize));
  const [c11, c21, c12, c22] = spectra.map(spectrum => value(spectrum, bin));
  const y11 = add(multiply(hLL, c11), multiply(hRL, c21));
  const y21 = add(multiply(hLR, c11), multiply(hRR, c21));
  const y12 = add(multiply(hLL, c12), multiply(hRL, c22));
  const y22 = add(multiply(hLR, c12), multiply(hRR, c22));
  return {
    improvementDb: 10 * Math.log10(
      (magnitude(hRL) / magnitude(hLL)) * (magnitude(hLR) / magnitude(hRR)) /
      ((magnitude(y12) / magnitude(y11)) * (magnitude(y21) / magnitude(y22)))
    ),
    diagonal: [y11, y22],
    untreatedDiagonal: [hLL, hRR],
    c: [c11, c21, c12, c22]
  };
}

function maximumMatrixGain(channels, fftSize) {
  const spectra = channels.map(channel => spectrumForChannel(channel, fftSize));
  let maximum = 0;
  for (let bin = 0; bin <= fftSize / 2; bin += 1) {
    const [c11, c21, c12, c22] = spectra.map(spectrum => value(spectrum, bin));
    const trace = magnitude(c11) ** 2 + magnitude(c21) ** 2 +
      magnitude(c12) ** 2 + magnitude(c22) ** 2;
    const determinant = subtract(multiply(c11, c22), multiply(c12, c21));
    const discriminant = Math.max(0, trace * trace - 4 * magnitude(determinant) ** 2);
    maximum = Math.max(maximum, Math.sqrt((trace + Math.sqrt(discriminant)) / 2));
  }
  return 20 * Math.log10(maximum);
}

test('XTC source validation fixes the paired single-point and time-reference contract', () => {
  const sources = makePlantSources();
  sources.lr.impulses[0].outputTimeReference = 'file';
  sources.rr.impulses[0].outputTimeReference = 'file';
  assert.equal(validateCrosstalkSources(sources).sampleRate, 48000);

  const expectCode = (mutate, code) => {
    const candidate = makePlantSources();
    mutate(candidate);
    assert.throws(
      () => validateCrosstalkSources(candidate),
      error => error instanceof CrosstalkCancellationDesignError && error.code === code
    );
  };
  expectCode(s => { s.ll.impulses[0].outputTimeReference = 'media-element'; },
    'media-element-time-reference');
  expectCode(s => { delete s.ll.impulses[0].outputTimeReference; },
    'unknown-output-time-reference');
  expectCode(s => { delete s.ll.impulses[0].trimStartSamples; }, 'old-measurement-format');
  expectCode(s => {
    s.ll.pointCount = 2;
    s.ll.measurement.points.push({});
  }, 'multiple-measurement-points');
  expectCode(s => { s.rl.id = 'another-session::ch=right'; }, 'left-ear-session-mismatch');
  expectCode(s => { s.rl.id = s.ll.id; }, 'duplicate-measurement-assignment');
  expectCode(s => { s.rr.impulses[0].sampleRate = 44100; }, 'sample-rate-mismatch');
});

test('XTC design cancels asymmetric crosstalk and locks trueStereo FIR channel order', () => {
  const request = { config: config(), sources: makePlantSources() };
  const plant = prepareCrosstalkPlant(request);
  const result = designCrosstalkCancellation(request);
  assert.deepEqual(CROSSTALK_FIR_CHANNEL_ORDER, ['C11', 'C21', 'C12', 'C22']);
  const frequencies = [700, 1200, 2400, 4200];
  const improvements = frequencies.map(frequency =>
    crosstalkMetrics(plant, result.channels, frequency).improvementDb);
  assert.ok(Math.min(...improvements) > 18, `improvements ${improvements.join(', ')}`);

  const swapped = [
    result.channels[0],
    result.channels[2],
    result.channels[1],
    result.channels[3]
  ];
  const swappedImprovements = frequencies.map(frequency =>
    crosstalkMetrics(plant, swapped, frequency).improvementDb);
  assert.ok(
    Math.max(...swappedImprovements) < Math.min(...improvements) - 8,
    `ordered ${improvements.join(', ')}, swapped ${swappedImprovements.join(', ')}`
  );
});

test('XTC accepts trim anchors that precede the scheduled playback frame', () => {
  // A loopback-short path latency anchors the trimmed data before the playback
  // frame, so the anchor is negative while the absolute onset stays the latency.
  const sources = makePlantSources(48000, {
    trimStarts: { ll: -320, rl: -288, lr: -304, rr: -256 }
  });
  assert.equal(validateCrosstalkSources(sources).sampleRate, 48000);
  const request = { config: config(), sources };
  const plant = prepareCrosstalkPlant(request);
  const result = designCrosstalkCancellation(request);
  const improvements = [700, 1200, 2400, 4200].map(frequency =>
    crosstalkMetrics(plant, result.channels, frequency).improvementDb);
  assert.ok(Math.min(...improvements) > 18, `improvements ${improvements.join(', ')}`);
});

test('XTC uses same-delay out-of-band passthrough and derives fd from normalized taps', () => {
  const request = {
    config: config({
      lowFrequency: 400,
      highFrequency: 4000,
      filterDelaySamples: 7
    }),
    sources: makePlantSources()
  };
  const plant = prepareCrosstalkPlant(request);
  const result = designCrosstalkCancellation(request);
  assert.equal(result.config.filterDelaySamples, 512);
  for (const frequency of [80, 12000]) {
    const bin = Math.round(frequency * plant.fftSize / plant.config.sampleRate);
    const metrics = crosstalkMetrics(plant, result.channels, frequency);
    const expected = {
      re: Math.cos(-2 * Math.PI * bin * 512 / plant.fftSize),
      im: Math.sin(-2 * Math.PI * bin * 512 / plant.fftSize)
    };
    assert.ok(magnitude(subtract(metrics.c[0], expected)) < 0.002, `${frequency} Hz C11`);
    assert.ok(magnitude(subtract(metrics.c[3], expected)) < 0.002, `${frequency} Hz C22`);
    assert.ok(magnitude(metrics.c[1]) < 0.002, `${frequency} Hz C21`);
    assert.ok(magnitude(metrics.c[2]) < 0.002, `${frequency} Hz C12`);
  }

  const normalized = designCrosstalkCancellation({
    config: config({ taps: 1234, filterDelaySamples: 11 }),
    sources: makePlantSources()
  });
  assert.equal(normalized.config.taps, 4096);
  assert.equal(normalized.config.filterDelaySamples, 2048);
});

test('XTC max-gain regularization is active and bounds both designed and realized filters', () => {
  const sources = makePlantSources(48000, {
    crossGain: 0.93,
    crossDelaySeconds: 16 / 48000,
    rrGain: 0.91,
    lrGain: 0.9
  });
  const result = designCrosstalkCancellation({
    config: config({ lowFrequency: 20, highFrequency: 20000, maxGainDb: 3 }),
    sources
  });
  assert.equal(result.diagnostics.gainLimitActive, true);
  assert.ok(result.diagnostics.gainLimitedBins > 100);
  assert.ok(result.diagnostics.maxGainDb <= 3 + 1e-9, `${result.diagnostics.maxGainDb} dB`);
  const realizedDb = maximumMatrixGain(
    result.channels,
    result.diagnostics.fftSize
  );
  assert.ok(realizedDb <= 4, `realized ${realizedDb} dB`);
});

test('XTC common alignment and delay-compensated smoothing preserve physical ITD across rates', () => {
  for (const [measurementRate, engineRate] of [[48000, 96000], [96000, 48000]]) {
    const deltaSeconds = 0.00025;
    const request = {
      config: config({ sampleRate: engineRate }),
      sources: makePlantSources(measurementRate, {
        crossDelaySeconds: deltaSeconds,
        trimStarts: { ll: 11, rl: 73, lr: 37, rr: 101 }
      })
    };
    const plant = prepareCrosstalkPlant(request);
    const frequency = 2000;
    const bin = Math.round(frequency * plant.fftSize / engineRate);
    const actualRatio = divide(
      value(plant.spectra.rl, bin),
      value(plant.spectra.ll, bin)
    );
    const expectedPhase = -2 * Math.PI * bin * engineRate / plant.fftSize * deltaSeconds;
    const expectedUnit = { re: Math.cos(expectedPhase), im: Math.sin(expectedPhase) };
    const actualUnit = scale(actualRatio, 1 / magnitude(actualRatio));
    assert.ok(
      magnitude(subtract(actualUnit, expectedUnit)) < 0.025,
      `${measurementRate}->${engineRate} ITD`
    );
    const result = designCrosstalkCancellation(request);
    const improvement = crosstalkMetrics(plant, result.channels, 2000).improvementDb;
    assert.ok(improvement > 18, `${measurementRate}->${engineRate}: ${improvement} dB`);
    assert.equal(result.diagnostics.measurementSampleRate, measurementRate);
  }
});

test('XTC cross-rate imported onset-zero responses preserve phase and physical cancellation', () => {
  const measurementSampleRate = 48000;
  const engineSampleRate = 96000;
  const paths = {
    ll: { gain: 1, onset: 0 },
    rl: { gain: 0.38, onset: 13 },
    lr: { gain: 0.23, onset: 9 },
    rr: { gain: 0.82, onset: 2 }
  };
  const source = (id, path) => makeSource({
    id,
    sampleRate: measurementSampleRate,
    delaySeconds: path.onset / measurementSampleRate,
    gain: path.gain,
    trimStartSamples: 0,
    outputTimeReference: 'file'
  });
  const request = {
    config: config({ sampleRate: engineSampleRate, lowFrequency: 200 }),
    sources: {
      ll: source('left-ear::ch=left', paths.ll),
      rl: source('left-ear::ch=right', paths.rl),
      lr: source('right-ear::ch=left', paths.lr),
      rr: source('right-ear::ch=right', paths.rr)
    }
  };
  const plant = prepareCrosstalkPlant(request);
  const result = designCrosstalkCancellation(request);
  assert.ok(Math.abs((plant.delays.rl - plant.delays.ll) - 13 / measurementSampleRate) < 1e-12);
  assert.ok(Math.abs((plant.delays.lr - plant.delays.rr) - 7 / measurementSampleRate) < 1e-12);

  const relativePhase = (first, second, bin) => Math.atan2(
    first.imag[bin] * second.real[bin] - first.real[bin] * second.imag[bin],
    first.real[bin] * second.real[bin] + first.imag[bin] * second.imag[bin]
  );
  const wrapPhase = phase => Math.atan2(Math.sin(phase), Math.cos(phase));
  const phaseError = (first, second, delaySamples) => {
    const firstBin = 40;
    const lastBin = 80;
    const actual = wrapPhase(
      relativePhase(first, second, lastBin) - relativePhase(first, second, firstBin)
    );
    const expected = -2 * Math.PI * (lastBin - firstBin) * engineSampleRate /
      plant.fftSize * delaySamples / measurementSampleRate;
    return wrapPhase(actual - expected);
  };
  assert.ok(Math.abs(phaseError(plant.spectra.rl, plant.spectra.ll, 13)) < 1e-5);
  assert.ok(Math.abs(phaseError(plant.spectra.lr, plant.spectra.rr, 7)) < 1e-5);

  const filterSpectra = result.channels.map(channel =>
    spectrumForChannel(channel, plant.fftSize));
  const physicalPath = (path, frequency) => {
    const phase = -2 * Math.PI * frequency * path.onset / measurementSampleRate;
    return { re: path.gain * Math.cos(phase), im: path.gain * Math.sin(phase) };
  };
  for (const bin of [40, 80, 120, 200]) {
    const frequency = bin * engineSampleRate / plant.fftSize;
    const [c11, c21, c12, c22] = filterSpectra.map(spectrum => value(spectrum, bin));
    const hLL = physicalPath(paths.ll, frequency);
    const hRL = physicalPath(paths.rl, frequency);
    const hLR = physicalPath(paths.lr, frequency);
    const hRR = physicalPath(paths.rr, frequency);
    const leftDirect = add(multiply(hLL, c11), multiply(hRL, c21));
    const leftCrosstalk = add(multiply(hLL, c12), multiply(hRL, c22));
    const rightDirect = add(multiply(hLR, c12), multiply(hRR, c22));
    const rightCrosstalk = add(multiply(hLR, c11), multiply(hRR, c21));
    const leftImprovementDb = 20 * Math.log10(
      (magnitude(hRL) / magnitude(hLL)) /
      (magnitude(leftCrosstalk) / magnitude(leftDirect))
    );
    const rightImprovementDb = 20 * Math.log10(
      (magnitude(hLR) / magnitude(hRR)) /
      (magnitude(rightCrosstalk) / magnitude(rightDirect))
    );
    assert.ok(leftImprovementDb > 20, `left cancellation was ${leftImprovementDb} dB`);
    assert.ok(rightImprovementDb > 20, `right cancellation was ${rightImprovementDb} dB`);
  }
});

test('XTC 1/6-octave complex smoothing removes and restores the full bulk delay', () => {
  const sampleRate = 48000;
  const fftSize = 8192;
  const delaySamples = 240;
  const impulse = new Float64Array(fftSize);
  impulse[delaySamples] = 1;
  const original = new FFT(fftSize).realTransform(impulse);
  const smoothed = smoothDelayCompensatedSpectrum(
    original,
    sampleRate,
    fftSize,
    delaySamples / sampleRate
  );
  const uncompensated = smoothDelayCompensatedSpectrum(original, sampleRate, fftSize, 0);
  for (const frequency of [1000, 3000, 6000, 10000]) {
    const bin = Math.round(frequency * fftSize / sampleRate);
    assert.ok(Math.abs(magnitude(value(smoothed, bin)) - 1) < 2e-6, `${frequency} Hz`);
  }
  const highBin = Math.round(6000 * fftSize / sampleRate);
  assert.ok(magnitude(value(uncompensated, highBin)) < 0.2);
});

test('XTC remains finite for a singular plant and Strength blending stays tonally transparent', () => {
  const singular = makePlantSources(48000, {
    crossGain: 1,
    crossDelaySeconds: 0,
    llGain: 1,
    rlGain: 1,
    lrGain: 1,
    rrGain: 1,
    leftDelay: 0.003,
    rightDelay: 0.003
  });
  const singularResult = designCrosstalkCancellation({ config: config(), sources: singular });
  for (const channel of singularResult.channels) {
    assert.ok(Array.from(channel).every(Number.isFinite));
  }
  assert.ok(singularResult.diagnostics.maxGainDb <= 24 + 1e-9);

  const request = { config: config({ lowFrequency: 400, highFrequency: 4000 }), sources: makePlantSources() };
  const plant = prepareCrosstalkPlant(request);
  const result = designCrosstalkCancellation(request);
  for (const strength of [0.3, 0.5, 0.7]) {
    for (const frequency of [250, 700, 2500, 6000]) {
      const metrics = crosstalkMetrics(plant, result.channels, frequency);
      const bin = Math.round(frequency * plant.fftSize / plant.config.sampleRate);
      const delayedUnit = {
        re: Math.cos(-2 * Math.PI * bin * result.config.filterDelaySamples / plant.fftSize),
        im: Math.sin(-2 * Math.PI * bin * result.config.filterDelaySamples / plant.fftSize)
      };
      const blendedDiagonal = metrics.diagonal.map((wet, index) => add(
        scale(multiply(metrics.untreatedDiagonal[index], delayedUnit), 1 - strength),
        scale(wet, strength)
      ));
      for (let index = 0; index < 2; index += 1) {
        const deviationDb = 20 * Math.log10(
          magnitude(blendedDiagonal[index]) / magnitude(metrics.untreatedDiagonal[index])
        );
        assert.ok(
          Math.abs(deviationDb) < 0.5,
          `${strength}, ${frequency} Hz, channel ${index}: ${deviationDb} dB`
        );
      }
    }
  }
});

test('XTC out-of-window diagnostic warns for short taps and clears for sufficient taps', () => {
  const sources = makePlantSources(48000, {
    crossGain: 0.82,
    crossDelaySeconds: 32 / 48000,
    rrGain: 0.91,
    lrGain: 0.82 * 0.97
  });
  const short = designCrosstalkCancellation({
    config: config({ taps: 1024, lowFrequency: 20, highFrequency: 20000 }),
    sources
  });
  const long = designCrosstalkCancellation({
    config: config({ taps: 4096, lowFrequency: 20, highFrequency: 20000 }),
    sources
  });
  assert.equal(short.diagnostics.tapsWarning, true);
  assert.equal(long.diagnostics.tapsWarning, false);
  assert.ok(short.diagnostics.outOfWindowEnergyRatio >
    short.diagnostics.outOfWindowWarningThreshold);
  assert.ok(long.diagnostics.outOfWindowEnergyRatio <
    long.diagnostics.outOfWindowWarningThreshold);
});

test('XTC effective low-frequency clamp is explicit in design diagnostics', () => {
  const result = designCrosstalkCancellation({
    config: config({ lowFrequency: 20, directWindowMs: 2 }),
    sources: makePlantSources()
  });
  assert.equal(result.diagnostics.requestedLowFrequency, 20);
  assert.equal(result.diagnostics.effectiveLowFrequency, 500);
  assert.equal(result.diagnostics.lowFrequencyClamped, true);
});

test('XTC closed-form regularized inverse converges to the asymmetric analytic inverse', () => {
  const hLL = { re: 1.05, im: 0.12 };
  const hLR = { re: 0.31, im: -0.09 };
  const hRL = { re: 0.47, im: 0.18 };
  const hRR = { re: 0.76, im: -0.07 };
  const delay = { re: 0.83, im: -0.56 };
  const actual = solveRegularizedCrosstalkBin({
    hLL,
    hLR,
    hRL,
    hRR,
    targetLL: multiply(hLL, delay),
    targetRR: multiply(hRR, delay),
    beta: 1e-9
  });
  const loop = divide(multiply(hRL, hLR), multiply(hLL, hRR));
  const common = divide(delay, subtract({ re: 1, im: 0 }, loop));
  const expected = {
    c11: common,
    c21: multiply(common, scale(divide(hLR, hRR), -1)),
    c12: multiply(common, scale(divide(hRL, hLL), -1)),
    c22: common
  };
  for (const key of ['c11', 'c21', 'c12', 'c22']) {
    assert.ok(magnitude(subtract(actual[key], expected[key])) < 2e-8, key);
  }
});

test('the plant is invariant to the stored deconvolution reference scale', () => {
  // An uncalibrated measurement stores a reference scale of tens of thousands
  // while a calibrated one stores unit reference. Pairing the two must not turn
  // the plant matrix into a rank-one system that mutes one input.
  const cfg = config({ regularization: 50 });
  const plain = designCrosstalkCancellation({ sources: makePlantSources(), config: cfg });
  const scaled = designCrosstalkCancellation({
    sources: scaleEarSession(makePlantSources(), ['lr', 'rr'], 58572.765625),
    config: cfg
  });

  assert.equal(scaled.channels.length, plain.channels.length);
  for (let channel = 0; channel < plain.channels.length; channel += 1) {
    let peak = 0;
    for (const sample of plain.channels[channel]) peak = Math.max(peak, Math.abs(sample));
    for (let index = 0; index < plain.channels[channel].length; index += 1) {
      assert.ok(
        Math.abs(scaled.channels[channel][index] - plain.channels[channel][index]) <=
          Math.max(peak, 1e-6) * 1e-5,
        `channel ${channel} sample ${index} diverged with a scaled reference`
      );
    }
  }
});
