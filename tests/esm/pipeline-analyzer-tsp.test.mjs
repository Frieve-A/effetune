import assert from 'node:assert/strict';
import test from 'node:test';

import { recoverTspImpulseResponse } from '../../js/pipeline-analyzer/analysis-core.js';
import {
  generateTspSequence,
  PIPELINE_ANALYZER_TSP_LENGTHS
} from '../../js/pipeline-analyzer/tsp.js';

function periodicOutput(sequence, taps, pedestal = 0) {
  const output = new Float64Array(sequence.length);
  for (let index = 0; index < output.length; index += 1) {
    let sample = pedestal;
    for (const tap of taps) {
      sample += tap.gain * sequence[(index - tap.delay + sequence.length) % sequence.length];
    }
    output[index] = sample;
  }
  return output;
}

function peakMagnitude(values) {
  let peak = 0;
  for (const value of values) {
    const magnitude = value < 0 ? -value : value;
    if (magnitude > peak) peak = magnitude;
  }
  return peak;
}

function hashFloatArray(values) {
  const view = new DataView(values.buffer, values.byteOffset, values.byteLength);
  let hash = 2166136261;
  for (let offset = 0; offset < values.byteLength; offset += 4) {
    hash ^= view.getUint32(offset, true);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

test('all supported TSP lengths are deterministic, finite, and peak-scaled', () => {
  for (const length of PIPELINE_ANALYZER_TSP_LENGTHS) {
    const first = generateTspSequence(length, 0.25);
    const second = generateTspSequence(length, 0.25);
    assert.equal(first.sequence.length, length);
    assert.equal(first.inverse.length, length);
    assert.equal(first.sequence.every(Number.isFinite), true);
    assert.equal(first.inverse.every(Number.isFinite), true);
    assert.ok(Math.abs(peakMagnitude(first.sequence) - 0.25) < 2e-6);
    assert.equal(hashFloatArray(first.sequence), hashFloatArray(second.sequence));
    assert.equal(hashFloatArray(first.inverse), hashFloatArray(second.inverse));
    assert.equal(first.signalGain, second.signalGain);
  }
});

test('TSP recovery preserves identity, gain, polarity, delay, and rejects DC pedestal', () => {
  const generated = generateTspSequence(32768, 0.25);
  const output = periodicOutput(generated.sequence, [
    { delay: 0, gain: 1 },
    { delay: 37, gain: -0.5 },
    { delay: 511, gain: 0.25 }
  ], 0.125);
  const recovered = recoverTspImpulseResponse(output, generated.inverse, {
    signalGain: generated.signalGain,
    knownSpanSamples: 512
  });
  assert.ok(Math.abs(recovered.impulse[0] - 1) < 2e-4);
  assert.ok(Math.abs(recovered.impulse[37] + 0.5) < 2e-4);
  assert.ok(Math.abs(recovered.impulse[511] - 0.25) < 2e-4);
  assert.ok(Math.abs(recovered.impulse[1024]) < 2e-4);
  assert.equal(recovered.diagnostics.baselineTrusted, true);
});

test('TSP recovery reports known-support and measured boundary overlap', () => {
  const generated = generateTspSequence(32768, 0.5);
  const supportOverlap = recoverTspImpulseResponse(generated.sequence, generated.inverse, {
    signalGain: generated.signalGain,
    knownSpanSamples: 16385
  });
  assert.equal(supportOverlap.diagnostics.supportOverlapsWindow, true);
  const lateOutput = periodicOutput(generated.sequence, [{ delay: 32760, gain: 1 }]);
  const late = recoverTspImpulseResponse(lateOutput, generated.inverse, {
    signalGain: generated.signalGain,
    knownSpanSamples: 1
  });
  assert.equal(late.diagnostics.boundarySettled, false);
});
