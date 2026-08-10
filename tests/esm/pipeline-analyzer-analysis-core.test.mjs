import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANALYSIS_QUANTUM_SIZE,
  alignToQuantum,
  areRouteTailsSettled,
  buildAnalysisResult,
  captureSchedule,
  convolveImpulseResponses,
  deriveFrequencyResponse,
  isRouteTailSettled,
  placeSpeakerResponses,
  recoverMlsImpulseResponse,
  sumAlignedImpulseResponses
} from '../../js/pipeline-analyzer/analysis-core.js';
import {
  generateMlsSequence,
  PIPELINE_ANALYZER_MLS_LENGTHS
} from '../../js/pipeline-analyzer/mls.js';
import { adaptPipelineAnalysisResult } from '../../js/pipeline-analyzer/result-adapter.js';

function nearestIndex(values, target) {
  let best = 0;
  for (let index = 1; index < values.length; index += 1) {
    if (Math.abs(values[index] - target) < Math.abs(values[best] - target)) best = index;
  }
  return best;
}

function degreeForLength(length) {
  return Math.log2(length + 1);
}

function circularCorrelation(sequence, lag) {
  let sum = 0;
  for (let index = 0; index < sequence.length; index += 1) {
    sum += sequence[index] * sequence[(index + lag) % sequence.length];
  }
  return sum;
}

function assertCompletePeriod(sequence, degree) {
  const mask = (1 << degree) - 1;
  let window = 0;
  for (let bit = 0; bit < degree; bit += 1) {
    if (sequence[bit] > 0) window |= 1 << bit;
  }
  const states = new Set();
  for (let index = 0; index < sequence.length; index += 1) {
    assert.notEqual(window, 0);
    assert.equal(states.has(window), false, `state repeated at sample ${index}`);
    states.add(window);
    const nextBit = sequence[(index + degree) % sequence.length] > 0 ? 1 : 0;
    window = ((window >>> 1) | (nextBit << (degree - 1))) & mask;
  }
  assert.equal(states.size, sequence.length);
}

function synthesizePeriodicOutput(excitation, taps, pedestal = 0) {
  const output = new Float32Array(excitation.length);
  for (let index = 0; index < output.length; index += 1) {
    let sample = pedestal;
    for (const tap of taps) {
      const source = (index - tap.delay + excitation.length) % excitation.length;
      sample += tap.gain * excitation[source];
    }
    output[index] = sample;
  }
  return output;
}

test('capture scheduling uses exact worklet quanta and the bounded two/four/eight second tail', () => {
  assert.equal(alignToQuantum(0), 0);
  assert.equal(alignToQuantum(1), ANALYSIS_QUANTUM_SIZE);
  assert.equal(alignToQuantum(128), 128);
  assert.deepEqual(captureSchedule(48000, 64), [96128, 192128, 384128]);
  assert.throws(() => alignToQuantum(-1), /non-negative/);
});

test('route tail settlement is independent for quiet and loud outputs', () => {
  const settled = new Float32Array(20000);
  settled[0] = 1;
  const quietUnsettled = new Float32Array(20000);
  quietUnsettled[0] = 1e-6;
  quietUnsettled[quietUnsettled.length - 1] = 1e-7;
  assert.equal(isRouteTailSettled(new Float32Array(20000)), true);
  assert.equal(isRouteTailSettled(settled), true);
  assert.equal(isRouteTailSettled(quietUnsettled), false);
  assert.equal(areRouteTailsSettled([settled, quietUnsettled]), false);
  quietUnsettled[quietUnsettled.length - 1] = 0;
  assert.equal(areRouteTailsSettled([settled, quietUnsettled]), true);
});

test('speaker responses align full buffers at O=max(onsets, identity zero) without circular shifts', () => {
  const sourceA = new Float32Array([0.25, 1, -0.5]);
  const sourceB = new Float32Array([2, 0.5]);
  const placed = placeSpeakerResponses([
    { samples: sourceA, sampleRate: 48000, onsetIndex: 1, refScale: 0.5 },
    { samples: sourceB, sampleRate: 48000, onsetIndex: -1, refScale: 2 },
    null
  ], 48000);

  assert.equal(placed.timeOriginSamples, -1);
  assert.deepEqual([...placed.responses[0]], [0.5, 2, -1]);
  assert.deepEqual([...placed.responses[1]], [0, 0, 1, 0.25]);
  assert.deepEqual([...placed.responses[2]], [0, 1]);
  assert.deepEqual([...sourceA], [0.25, 1, -0.5], 'owned source must not be detached or changed');

  const permuted = placeSpeakerResponses([null,
    { samples: sourceB, sampleRate: 48000, onsetIndex: -1, refScale: 2 },
    { samples: sourceA, sampleRate: 48000, onsetIndex: 1, refScale: 0.5 }
  ], 48000);
  assert.equal(permuted.timeOriginSamples, placed.timeOriginSamples);
  assert.deepEqual([...permuted.responses[0]], [...placed.responses[2]]);
  assert.deepEqual([...permuted.responses[1]], [...placed.responses[1]]);
  assert.deepEqual([...permuted.responses[2]], [...placed.responses[0]]);
});

test('convolution and signed summation retain polarity and cancel in the complex/time domain', () => {
  const left = new Float32Array([1, 2, 3]);
  const right = new Float32Array([0.5, -1]);
  assert.deepEqual([...convolveImpulseResponses(left, right)], [0.5, 0, -0.5, -3]);
  assert.deepEqual(
    [...sumAlignedImpulseResponses([new Float32Array([1, -0.5]), new Float32Array([-1, 0.5])])],
    [0, 0]
  );
});

test('FFT convolution preserves sparse long-filter timing and gain', () => {
  const left = new Float32Array(600);
  const right = new Float32Array(600);
  left[0] = 1;
  left[599] = 0.5;
  right[0] = 2;
  right[599] = -1;
  const result = convolveImpulseResponses(left, right);
  assert.equal(result.length, 1199);
  assert.ok(Math.abs(result[0] - 2) < 1e-5);
  assert.ok(Math.abs(result[599]) < 1e-5);
  assert.ok(Math.abs(result[1198] + 0.5) < 1e-5);
  assert.ok(result.every((value, index) => [0, 599, 1198].includes(index) || Math.abs(value) < 1e-5));
});

test('frequency response preserves gain, polarity, integer delay, phase, and group delay', () => {
  const sampleRate = 48000;
  const delaySamples = 24;
  const impulse = new Float32Array(256);
  impulse[delaySamples] = -2;
  const response = deriveFrequencyResponse(impulse, sampleRate, { maximumPoints: 512 });
  const index = nearestIndex(response.frequencies, 1000);
  assert.ok(Math.abs(response.magnitudeDb[index] - 20 * Math.log10(2)) < 1e-4);
  assert.equal(response.valid[index], 1);
  assert.ok(Math.abs(response.groupDelayMs[index] - delaySamples / sampleRate * 1000) < 1e-4);
  const expectedPhase = 180 - 360 * response.frequencies[index] * delaySamples / sampleRate;
  const wrappedExpected = ((expectedPhase + 180) % 360 + 360) % 360 - 180;
  assert.ok(Math.abs(response.phaseDegrees[index] - wrappedExpected) < 1e-3);
});

test('analysis result derives common-grid Before and After responses', () => {
  const result = buildAnalysisResult({
    pipelineResponses: [new Float32Array([1, 0.5]), new Float32Array([-1, -0.5])],
    speakerResponses: [null, null],
    outputChannels: [0, 3],
    sampleRate: 48000,
    reportedLatency: 64,
    truncated: true
  });
  assert.equal(result.reportedLatency, 64);
  assert.equal(result.captureLength, 2);
  assert.equal(result.truncated, true);
  assert.equal('routes' in result, false);
  assert.equal('total' in result, false);
  assert.equal('timeOriginSamples' in result, false);
  assert.deepEqual([...result.before.impulse], [1, 0]);
  assert.equal(result.before.timeOriginSamples, 0);
  const adapted = adaptPipelineAnalysisResult(result);
  assert.deepEqual(
    adapted.views.impulse.curves[0].points.map(point => point.yValue),
    [1, 0]
  );
  assert.deepEqual([...result.after.impulse], [0, 0]);
  assert.equal(result.after.spectrum.valid.every(value => value === 0), true);
  assert.deepEqual(
    [...result.before.spectrum.frequencies],
    [...result.after.spectrum.frequencies],
    'Before and After must share one complex-frequency grid'
  );
});

test('display timing removes the reported pipeline delay after preserving speaker alignment', () => {
  const pipeline = new Float32Array(8);
  pipeline[3] = 1;
  const result = buildAnalysisResult({
    pipelineResponses: [pipeline],
    speakerResponses: [{
      samples: new Float32Array([0, 0, 1]),
      sampleRate: 48000,
      onsetIndex: 2,
      refScale: 1
    }],
    outputChannels: [0],
    sampleRate: 48000,
    reportedLatency: 2
  });
  assert.equal(result.before.timeOriginSamples, -2);
  assert.equal(result.after.timeOriginSamples, -4);
  assert.equal(result.reportedLatency, 2);
  const spectrum = result.after.spectrum;
  const index = nearestIndex(spectrum.frequencies, 1000);
  assert.ok(Math.abs(spectrum.magnitudeDb[index]) < 1e-4);
  assert.ok(Math.abs(spectrum.groupDelayMs[index] - 1 / 48000 * 1000) < 1e-4);
  assert.ok(Math.abs(result.before.spectrum.groupDelayMs[index]) < 1e-6);
  const adapted = adaptPipelineAnalysisResult(result);
  const impulsePeak = adapted.views.impulse.curves[1].points.find(point => point.yLabel === '1.00');
  assert.match(impulsePeak.xLabel, /0\.02 ms/);
});

test('invalid reported latency is treated as zero', () => {
  const result = buildAnalysisResult({
    pipelineResponses: [new Float32Array([1])],
    outputChannels: [0],
    sampleRate: 48000,
    reportedLatency: -1
  });
  assert.equal(result.reportedLatency, 0);
  assert.equal(result.before.timeOriginSamples, 0);
  assert.equal(result.after.timeOriginSamples, 0);
});

test('orders 15 through 19 generate complete balanced MLS periods with periodic autocorrelation', () => {
  for (const length of PIPELINE_ANALYZER_MLS_LENGTHS) {
    const degree = degreeForLength(length);
    assert.equal(Number.isInteger(degree), true);
    const sequence = generateMlsSequence(length);
    let positive = 0;
    for (const sample of sequence) {
      assert.ok(sample === 1 || sample === -1);
      if (sample > 0) positive += 1;
    }
    assert.equal(positive, (length + 1) / 2);
    assertCompletePeriod(sequence, degree);
    assert.equal(circularCorrelation(sequence, 0), length);
    for (const lag of [1, degree, Math.floor(length / 3), length - 1]) {
      assert.equal(circularCorrelation(sequence, lag), -1, `order ${degree}, lag ${lag}`);
    }
  }
});

test('MLS recovery preserves gain, polarity, delays, and non-DC response under an output pedestal', () => {
  const amplitude = 0.25;
  const excitation = generateMlsSequence(32767, amplitude);
  const taps = [
    { delay: 0, gain: 1.5 },
    { delay: 19, gain: -0.75 },
    { delay: 257, gain: 0.125 }
  ];
  const output = synthesizePeriodicOutput(excitation, taps, 0.375);
  const recovered = recoverMlsImpulseResponse(output, excitation, {
    amplitude,
    knownSpanSamples: 258
  });

  for (const tap of taps) {
    assert.ok(Math.abs(recovered.impulse[tap.delay] - tap.gain) < 2e-6);
  }
  const expected = new Map(taps.map(tap => [tap.delay, tap.gain]));
  let recoveredSum = 0;
  let maximumOther = 0;
  for (let index = 0; index < recovered.impulse.length; index += 1) {
    recoveredSum += recovered.impulse[index];
    if (!expected.has(index)) maximumOther = Math.max(maximumOther, Math.abs(recovered.impulse[index]));
  }
  assert.ok(maximumOther < 2e-6);
  assert.ok(Math.abs(recoveredSum - taps.reduce((sum, tap) => sum + tap.gain, 0)) < 2e-5);
  assert.equal(recovered.diagnostics.baselineTrusted, true);
});

test('MLS recovery exposes untrusted baseline diagnostics when declared support overlaps its window', () => {
  const excitation = generateMlsSequence(32767);
  const recovered = recoverMlsImpulseResponse(excitation, excitation, {
    amplitude: 1,
    knownSpanSamples: 20000
  });
  assert.equal(recovered.diagnostics.baselineWindowStart, 16383);
  assert.equal(recovered.diagnostics.supportOverlapsWindow, true);
  assert.equal(recovered.diagnostics.boundarySettled, true);
  assert.equal(recovered.diagnostics.baselineTrusted, false);
});

test('speaker IR convolution retains signed Before and After data across all four graph views', () => {
  const analysis = buildAnalysisResult({
    pipelineResponses: [
      new Float32Array([1, -0.5]),
      new Float32Array([-1, 0.5])
    ],
    speakerResponses: [{
      samples: new Float32Array([0, 1, 0.5]),
      sampleRate: 48000,
      onsetIndex: 1,
      refScale: 1
    }, {
      samples: new Float32Array([1, -1]),
      sampleRate: 48000,
      onsetIndex: 0,
      refScale: 1
    }],
    outputChannels: [0, 3],
    sampleRate: 48000
  });
  assert.deepEqual([...analysis.before.impulse], [0, 2, -0.5]);
  assert.deepEqual([...analysis.after.impulse], [0, 0, 1.5, -0.75]);

  const adapted = adaptPipelineAnalysisResult(analysis);
  assert.deepEqual(Object.keys(adapted.views), ['frequency', 'phase', 'groupDelay', 'impulse']);
  for (const view of Object.values(adapted.views)) {
    assert.deepEqual(view.curves.map(curve => curve.id), ['before', 'after']);
  }
  assert.equal(adapted.views.impulse.curves.at(-1).points.some(point => point.yLabel === '-0.50'), true);
});
