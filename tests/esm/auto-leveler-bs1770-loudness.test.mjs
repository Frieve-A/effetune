import assert from 'node:assert/strict';
import test from 'node:test';

import { loadReferencePlugin } from '../../tools/dsp-parity/node-host.mjs';

// Independent oracle. These are the ITU-R BS.1770-4 table 1 and table 2 coefficients as
// published for 48 kHz; the plugin derives its own biquads from the sample rate, so the
// tables are never read by the code under test. The K-weighted mean square of a steady
// sine of amplitude A is |H(e^jw)|^2 * A^2 / 2, and BS.1770-4 eq. (2) turns the weighted
// channel-power sum into LUFS.
const TABLE_SHELF = {
  b0: 1.53512485958697,
  b1: -2.69169618940638,
  b2: 1.19839281085285,
  a1: -1.69065929318241,
  a2: 0.73248077421585
};
const TABLE_HIGHPASS = { b0: 1, b1: -2, b2: 1, a1: -1.99004745483398, a2: 0.99007225036621 };
const LUFS_OFFSET = 0.691;
const TABLE_RATE = 48000;

function biquadPowerGain(coefficients, frequency, sampleRate) {
  const w = 2 * Math.PI * frequency / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);
  const numeratorReal = coefficients.b0 + coefficients.b1 * cos1 + coefficients.b2 * cos2;
  const numeratorImag = -(coefficients.b1 * sin1 + coefficients.b2 * sin2);
  const denominatorReal = 1 + coefficients.a1 * cos1 + coefficients.a2 * cos2;
  const denominatorImag = -(coefficients.a1 * sin1 + coefficients.a2 * sin2);
  return (numeratorReal * numeratorReal + numeratorImag * numeratorImag) /
    (denominatorReal * denominatorReal + denominatorImag * denominatorImag);
}

function kWeightedPowerGain(frequency) {
  return biquadPowerGain(TABLE_SHELF, frequency, TABLE_RATE) *
    biquadPowerGain(TABLE_HIGHPASS, frequency, TABLE_RATE);
}

// tones: [{ frequency, amplitude, weight }], one entry per contributing channel.
function referenceLufs(tones) {
  let power = 0;
  for (const { frequency, amplitude, weight = 1 } of tones) {
    power += weight * kWeightedPowerGain(frequency) * amplitude * amplitude / 2;
  }
  return power > 0 ? 10 * Math.log10(power) - LUFS_OFFSET : -144;
}

// Amplitude of a single-channel sine whose BS.1770-4 loudness is exactly `lufs`.
function amplitudeForLufs(frequency, lufs) {
  return Math.sqrt(2 * Math.pow(10, (lufs + LUFS_OFFSET) / 10) / kWeightedPowerGain(frequency));
}

function tone(frequency, amplitude, seconds, sampleRate, phase = 0) {
  const samples = new Float32Array(Math.round(seconds * sampleRate));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate + phase);
  }
  return samples;
}

function silence(seconds, sampleRate) {
  return new Float32Array(Math.round(seconds * sampleRate));
}

const DEFAULT_PARAMS = { tg: -18, tw: 3000, mg: 12, ng: -36, at: 1, rt: 1, gt: -96 };
const reference = await loadReferencePlugin('AutoLevelerPlugin');

// Runs the real plugin processor over interleaved-by-channel blocks and returns both the
// telemetry it reports and the audio it produced.
function runProcessor(channels, { sampleRate = 48000, blockSize = 128, params = {} } = {}) {
  const plugin = new reference.PluginClass();
  plugin.id = 'auto-leveler-bs1770-test';
  plugin.setParameters({ ...DEFAULT_PARAMS, ...params });
  const channelCount = channels.length;
  const frames = channels[0].length;
  const outputs = channels.map(() => new Float32Array(frames));
  const state = {};
  let measurements = null;
  for (let start = 0; start + blockSize <= frames; start += blockSize) {
    const block = new Float32Array(channelCount * blockSize);
    for (let channel = 0; channel < channelCount; channel++) {
      block.set(channels[channel].subarray(start, start + blockSize), channel * blockSize);
    }
    const processed = plugin.executeProcessor(state, block, {
      ...plugin.getParameters(),
      enabled: true,
      channel: null,
      channelCount,
      blockSize,
      sampleRate
    }, start / sampleRate);
    if (processed.measurements) measurements = processed.measurements;
    for (let channel = 0; channel < channelCount; channel++) {
      outputs[channel].set(
        processed.subarray(channel * blockSize, (channel + 1) * blockSize),
        start
      );
    }
  }
  assert.ok(measurements, 'the processor never reported a measurement');
  return { measurements, outputs };
}

// Independent BS.1770-4 loudness of a settled output, measured from the audio itself.
function measuredLufs(outputs, frequency, skipSeconds, sampleRate) {
  const skip = Math.round(skipSeconds * sampleRate);
  let power = 0;
  for (const samples of outputs) {
    let sum = 0;
    for (let i = skip; i < samples.length; i++) sum += samples[i] * samples[i];
    power += (sum / (samples.length - skip)) * kWeightedPowerGain(frequency);
  }
  return 10 * Math.log10(power) - LUFS_OFFSET;
}

test('the meter reports the BS.1770-4 channel-power sum, not a mono downmix', () => {
  const sampleRate = 48000;
  const amplitude = amplitudeForLufs(997, -20);
  const left = tone(997, amplitude, 20, sampleRate);

  const mono = runProcessor([left], { sampleRate });
  assert.equal(referenceLufs([{ frequency: 997, amplitude }]).toFixed(3), '-20.000');
  assert.ok(Math.abs(mono.measurements.inputLufs + 20) < 0.02, `mono read ${mono.measurements.inputLufs}`);

  // Two coherent channels carry twice the power, so they are 3.01 LU louder than one.
  const coherent = runProcessor([left, tone(997, amplitude, 20, sampleRate)], { sampleRate });
  const twoChannels = referenceLufs([
    { frequency: 997, amplitude },
    { frequency: 997, amplitude }
  ]);
  assert.ok(Math.abs(twoChannels - (-20 + 10 * Math.log10(2))) < 1e-9);
  assert.ok(
    Math.abs(coherent.measurements.inputLufs - twoChannels) < 0.02,
    `stereo read ${coherent.measurements.inputLufs}, expected ${twoChannels}`
  );

  // A mono downmix cancels anti-correlated content; the channel-power sum does not.
  const antiPhase = runProcessor(
    [left, tone(997, amplitude, 20, sampleRate, Math.PI)],
    { sampleRate }
  );
  assert.ok(
    Math.abs(antiPhase.measurements.inputLufs - twoChannels) < 0.02,
    `anti-phase read ${antiPhase.measurements.inputLufs}, expected ${twoChannels}`
  );

  // Different tones per channel: still the power sum.
  const split = runProcessor(
    [left, tone(3000, amplitudeForLufs(3000, -26), 20, sampleRate)],
    { sampleRate }
  );
  const splitReference = referenceLufs([
    { frequency: 997, amplitude },
    { frequency: 3000, amplitude: amplitudeForLufs(3000, -26) }
  ]);
  assert.ok(
    Math.abs(split.measurements.inputLufs - splitReference) < 0.05,
    `split read ${split.measurements.inputLufs}, expected ${splitReference}`
  );
});

test('the 997 Hz 0 dBFS anchor of BS.1770-4 reads -3.01 LUFS', () => {
  const sampleRate = 48000;
  const { measurements } = runProcessor([tone(997, 1, 20, sampleRate)], { sampleRate });
  assert.ok(
    Math.abs(measurements.inputLufs + 3.01) < 0.02,
    `anchor read ${measurements.inputLufs}, BS.1770-4 states -3.01 LKFS`
  );
});

test('the derived 48 kHz K-weighting reproduces BS.1770-4 tables 1 and 2', () => {
  const sampleRate = 48000;
  for (const frequency of [40, 60, 200, 997, 2000, 3000, 8000, 16000]) {
    const amplitude = amplitudeForLufs(frequency, -23);
    const { measurements } = runProcessor([tone(frequency, amplitude, 8, sampleRate)], {
      sampleRate,
      params: { tw: 2000 }
    });
    assert.ok(
      Math.abs(measurements.inputLufs + 23) < 1e-5,
      `${frequency} Hz read ${measurements.inputLufs}, expected -23`
    );
  }
});

test('the K-weighting curve holds at every supported sample rate', () => {
  const frequencies = [60, 200, 997, 3000, 8000];
  for (const sampleRate of [32000, 44100, 48000, 88200, 96000, 192000]) {
    for (const frequency of frequencies) {
      const amplitude = amplitudeForLufs(frequency, -23);
      const { measurements } = runProcessor([tone(frequency, amplitude, 6, sampleRate)], {
        sampleRate,
        params: { tw: 1500 }
      });
      assert.ok(
        Math.abs(measurements.inputLufs + 23) < 0.05,
        `${sampleRate} Hz / ${frequency} Hz read ${measurements.inputLufs}, expected -23`
      );
    }
  }
});

test('six-channel input uses the BS.1770-4 table 3 weights', () => {
  const sampleRate = 48000;
  const amplitude = amplitudeForLufs(997, -25);
  const readings = [];
  for (let active = 0; active < 6; active++) {
    const channels = [];
    for (let channel = 0; channel < 6; channel++) {
      channels.push(channel === active ? tone(997, amplitude, 15, sampleRate) : silence(15, sampleRate));
    }
    readings.push(runProcessor(channels, { sampleRate }).measurements.inputLufs);
  }
  const surroundGain = 10 * Math.log10(1.41);
  // L, R and C are unweighted and must agree exactly with each other.
  for (const index of [1, 2]) {
    assert.ok(Math.abs(readings[index] - readings[0]) < 1e-6, `channel ${index} read ${readings[index]}`);
  }
  assert.ok(Math.abs(readings[0] + 25) < 0.02, `L read ${readings[0]}`);
  // The LFE channel is excluded from the loudness sum entirely.
  assert.equal(readings[3], -144);
  for (const index of [4, 5]) {
    assert.ok(
      Math.abs(readings[index] - (readings[0] + surroundGain)) < 0.02,
      `surround channel ${index} read ${readings[index]}, expected ${readings[0] + surroundGain}`
    );
  }
});

test('the leveler settles on the requested LUFS target', () => {
  const sampleRate = 48000;
  for (const target of [-12, -18, -23, -30]) {
    const amplitude = amplitudeForLufs(997, -8);
    const channels = [tone(997, amplitude, 20, sampleRate), tone(997, amplitude, 20, sampleRate)];
    const { measurements, outputs } = runProcessor(channels, {
      sampleRate,
      params: { tg: target, mg: 12, ng: -36 }
    });
    // What the plugin draws on its own graph.
    assert.ok(
      Math.abs(measurements.outputLufs - target) < 0.02,
      `reported ${measurements.outputLufs} for target ${target}`
    );
    // What the audio it produced actually measures.
    const produced = measuredLufs(outputs, 997, 15, sampleRate);
    assert.ok(
      Math.abs(produced - target) < 0.05,
      `produced ${produced} LUFS for target ${target}`
    );
  }
});

test('the noise gate threshold is on the LUFS scale', () => {
  const sampleRate = 48000;
  const channels = [tone(997, amplitudeForLufs(997, -60.3), 20, sampleRate)];
  // -60.3 LUFS sits below a -60 LUFS gate, so the leveler must leave the signal alone.
  const gated = runProcessor(channels, { sampleRate, params: { gt: -60, tg: -18 } });
  assert.ok(
    Math.abs(gated.measurements.inputLufs - gated.measurements.outputLufs) < 1e-6,
    `gated run applied ${gated.measurements.outputLufs - gated.measurements.inputLufs} dB of gain`
  );
  // The same signal above a -61 LUFS gate is leveled up to the maximum gain.
  const open = runProcessor(channels, { sampleRate, params: { gt: -61, tg: -18, mg: 12 } });
  assert.ok(
    open.measurements.outputLufs - open.measurements.inputLufs > 11.9,
    `ungated run applied ${open.measurements.outputLufs - open.measurements.inputLufs} dB of gain`
  );
});
