import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { parseTelemetryPacket, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';

const CHANNELS = 2;
const BLOCK_SIZE = 128;
const TELEMETRY_BYTES = 256 * 1024;
const TAP_ID = 213;
const PAYLOAD_BYTES = 1344;
const BEAT_SECONDS = 0.5;
const DURATION_SECONDS = 10;
const READ_EVERY_BLOCKS = 32;

// A steady 120 BPM groove: kick on every beat, snare on beats 2 and 4, hats on eighths.
function renderGroove(sampleRate) {
  const length = Math.round(DURATION_SECONDS * sampleRate);
  const signal = new Float32Array(length);
  let seed = 0x1234567;
  const noise = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
  const add = (start, seconds, voice) => {
    const first = Math.round(start * sampleRate);
    const count = Math.round(seconds * sampleRate);
    for (let i = 0; i < count && first + i < length; i++) signal[first + i] += voice(i / sampleRate);
  };
  for (let eighth = 0; eighth * BEAT_SECONDS / 2 < DURATION_SECONDS; eighth++) {
    const start = eighth * BEAT_SECONDS / 2;
    add(start, 0.04, t => 0.12 * noise() * Math.exp(-t / 0.012));
    if (eighth % 2 !== 0) continue;
    const beat = eighth / 2;
    add(start, 0.3, t => 0.7 * Math.sin(2 * Math.PI * (50 * t + 60 * 0.03 * (1 - Math.exp(-t / 0.03)))) *
      Math.exp(-t / 0.12));
    if (beat % 2 === 1) add(start, 0.2, t => 0.35 * noise() * Math.exp(-t / 0.05));
  }
  return signal;
}

function readFrames(binding, packet) {
  const frames = [];
  const bytes = binding.telemetryRead(packet);
  assert.equal(binding.lastTelemetryDroppedFrames, 0);
  assert.equal(parseTelemetryPacket(packet, bytes, frame => frames.push(frame)).ok, true);
  return frames.map(frame => {
    assert.equal(frame.frameType, TelemetryFrameType.TAP_RHYTHM_ANALYZER);
    assert.equal(frame.formatVersion, 1);
    assert.equal(frame.tapId, TAP_ID);
    assert.equal(frame.payloadBytes, PAYLOAD_BYTES);
    checkFrame(frame.payload);
    return frame.payload;
  });
}

// Frame contract at every rate: finite values, confidence in [0, 1], no beat while unlocked, and
// event strengths in (0, 1].
function checkFrame(payload) {
  for (const offset of [0, 16, 20, 40, 44, 52, 60]) assert.ok(Number.isFinite(payload.getFloat32(offset, true)));
  for (let offset = 64; offset < 832; offset += 4) {
    const value = payload.getFloat32(offset, true);
    assert.ok(value >= 0 && value <= 1, `tempogram value ${value}`);
  }
  const confidence = payload.getFloat32(40, true);
  assert.ok(confidence >= 0 && confidence <= 1, `confidence was ${confidence}`);
  if ((payload.getUint32(32, true) & 1) === 0) {
    assert.equal(payload.getFloat32(44, true), 0);
    assert.equal(payload.getUint32(48, true), 0);
    assert.equal(payload.getFloat32(52, true), 0);
    assert.equal(payload.getUint32(56, true), 0);
  }
  for (let k = 0; k < payload.getUint32(28, true); k++) {
    const slot = 832 + 32 * k;
    for (const offset of [4, 16, 20]) assert.ok(Number.isFinite(payload.getFloat32(slot + offset, true)));
    const strength = payload.getFloat32(slot + 24, true);
    assert.ok(strength > 0 && strength <= 1, `event strength was ${strength}`);
  }
}

function decode(payload) {
  const step = payload.getUint32(8, true) / payload.getFloat32(0, true);
  const events = [];
  for (let k = 0; k < payload.getUint32(28, true); k++) {
    const slot = 832 + 32 * k;
    events.push({
      time: (payload.getUint32(slot, true) + payload.getFloat32(slot + 4, true)) * step,
      epoch: payload.getUint32(slot + 8, true),
      beatFraction: payload.getFloat32(slot + 16, true),
      period: payload.getFloat32(slot + 20, true),
      strength: payload.getFloat32(slot + 24, true),
      band: payload.getUint8(slot + 28),
      unlocked: (payload.getUint8(slot + 29) & 1) !== 0
    });
  }
  return {
    sampleRate: payload.getFloat32(0, true),
    generation: payload.getUint32(4, true),
    time: payload.getUint32(12, true) * step,
    dropped: payload.getUint32(24, true),
    locked: (payload.getUint32(32, true) & 1) !== 0,
    epoch: payload.getUint32(36, true),
    period: payload.getFloat32(44, true),
    next: (payload.getUint32(48, true) + payload.getFloat32(52, true)) * step,
    events
  };
}

const beatError = time => {
  const offset = time % BEAT_SECONDS;
  return offset > BEAT_SECONDS / 2 ? offset - BEAT_SECONDS : offset;
};

// Runs the groove through one instance and returns the decoded states, the click onsets found in
// the output (output minus the pass-through contract), and the binding for follow-up checks.
async function runGroove(artifact, params, body, sampleRate = 48000) {
  const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
  const binding = await instantiateDsp(bytes);
  try {
    assert.notEqual(binding.createEngine(), 0);
    assert.equal(binding.prepare(sampleRate, CHANNELS, BLOCK_SIZE, TELEMETRY_BYTES), 0);
    assert.equal(binding.setTelemetryRate(60), 0);
    const instanceId = binding.createInstance('RhythmAnalyzerPlugin');
    assert.notEqual(instanceId, 0);
    assert.equal(binding.instanceSetTap(instanceId, TAP_ID), 0);
    const packer = DSP_PARAM_PACKERS.get('RhythmAnalyzerPlugin');
    assert.ok(packer);
    assert.equal(binding.instanceSetParams(instanceId, packer.pack(params), packer.hash), 0);

    const signal = renderGroove(sampleRate);
    const arena = binding.getArenaViews();
    const packet = new ArrayBuffer(TELEMETRY_BYTES);
    const states = [];
    const clicks = [];
    let lastClickFrame = -Infinity;
    for (let block = 0; block * BLOCK_SIZE < signal.length; block++) {
      const processedFrames = block * BLOCK_SIZE;
      for (let frame = 0; frame < BLOCK_SIZE; frame++) {
        const sample = signal[processedFrames + frame] ?? 0;
        arena.combined[frame] = sample;
        arena.combined[BLOCK_SIZE + frame] = sample;
      }
      const input = new Float32Array(arena.combined.subarray(0, BLOCK_SIZE * CHANNELS));
      assert.equal(binding.instanceProcess(
        instanceId, arena.offsets.combined, CHANNELS, BLOCK_SIZE, processedFrames / sampleRate
      ), 0);
      const expected = input.map((value, index) => Math.fround(
        value + (((processedFrames + index % BLOCK_SIZE) & 1) === 0 ? 1e-19 : -1e-19)));
      const output = new Float32Array(arena.combined.subarray(0, BLOCK_SIZE * CHANNELS));
      if (!params.ck) {
        assert.deepEqual(output, expected, 'analysis preserves the engine pass-through contract');
      }
      for (let frame = 0; frame < BLOCK_SIZE; frame++) {
        const added = output[frame] - expected[frame];
        assert.equal(output[BLOCK_SIZE + frame] - expected[BLOCK_SIZE + frame], added);
        if (Math.abs(added) < 1e-6) continue;
        const at = processedFrames + frame;
        if (at - lastClickFrame > 0.07 * sampleRate) clicks.push(at / sampleRate);
        lastClickFrame = at;
      }
      if (block % READ_EVERY_BLOCKS === READ_EVERY_BLOCKS - 1) {
        states.push(...readFrames(binding, packet).map(decode));
      }
    }
    await body({ binding, instanceId, arena, packet, states, clicks });
  } finally {
    binding.close();
  }
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Rhythm Analyzer in ${artifact} locks to a 120 BPM groove through v1 telemetry`, async () => {
    await runGroove(artifact, { mn: 40, mx: 240, ck: false }, ({ binding, instanceId, arena, packet, states, clicks }) => {
      assert.equal(clicks.length, 0);
      assert.ok(states.length > 100);
      const generation = states[0].generation;
      assert.notEqual(generation, 0);
      for (const state of states) {
        assert.equal(state.sampleRate, 48000);
        assert.equal(state.generation, generation);
        assert.equal(state.dropped, 0);
      }
      const final = states.at(-1);
      assert.equal(final.locked, true, 'a steady groove locks within ten seconds');
      assert.ok(Math.abs(final.period - BEAT_SECONDS) < 0.005, `period was ${final.period} s`);
      assert.ok(final.next > final.time && final.next <= final.time + final.period + 1e-6);
      assert.ok(Math.abs(beatError(final.next)) < 0.02, `next beat was ${final.next} s`);

      const events = states.flatMap(state => state.events);
      assert.ok(events.length > 40, 'hits are reported as onset events');
      for (const event of events) {
        assert.ok(event.band <= 2 && event.strength > 0);
        assert.ok(event.beatFraction >= 0 && event.beatFraction < 1);
      }
      const kicks = events.filter(event => !event.unlocked && event.band === 0 && event.time > 5);
      assert.ok(kicks.length >= 6, 'locked kicks are reported after the tracker settles');
      for (const kick of kicks) {
        assert.equal(kick.epoch, final.epoch);
        assert.ok(Math.abs(kick.period - BEAT_SECONDS) < 0.005);
        assert.ok(Math.abs(beatError(kick.time)) < 0.01, `kick at ${kick.time} s is off the beat`);
      }

      assert.equal(binding.resetInstance(instanceId), 0);
      binding.telemetryRead(packet);
      for (let block = 0; block < READ_EVERY_BLOCKS; block++) {
        arena.combined.fill(0, 0, BLOCK_SIZE * CHANNELS);
        assert.equal(binding.instanceProcess(
          instanceId, arena.offsets.combined, CHANNELS, BLOCK_SIZE, block * BLOCK_SIZE / 48000
        ), 0);
      }
      const afterReset = readFrames(binding, packet).map(decode);
      assert.ok(afterReset.length > 0);
      for (const state of afterReset) {
        assert.notEqual(state.generation, generation, 'reset starts a new analysis generation');
        assert.equal(state.locked, false);
      }
    });
  });

  test(`Rhythm Analyzer in ${artifact} clicks on the beat once locked when the metronome is on`, async () => {
    await runGroove(artifact, { mn: 40, mx: 240, ck: true }, ({ states, clicks }) => {
      const lastUnlocked = states.filter(state => !state.locked).at(-1);
      assert.ok(states.at(-1).locked && lastUnlocked);
      assert.ok(clicks.length >= 8, `only ${clicks.length} clicks`);
      assert.ok(clicks[0] > lastUnlocked.time, 'no click before the lock');
      for (let i = 0; i < clicks.length; i++) {
        assert.ok(Math.abs(beatError(clicks[i])) < 0.01, `click at ${clicks[i]} s is off the beat`);
        if (i > 0) assert.ok(Math.abs(clicks[i] - clicks[i - 1] - BEAT_SECONDS) < 0.02);
      }
    });
  });
}

// 44.1 kHz is resampled to a 48 kHz analysis stream, which the frame's rate and hop describe; 64 kHz has no
// rate rule and keeps its own rate on the simpler tracker. Both frames follow the same contract.
for (const [sampleRate, frameRate] of [[44100, 48000], [64000, 64000]]) {
  test(`Rhythm Analyzer frames at ${sampleRate} Hz lock to a 120 BPM groove`, async () => {
    await runGroove('effetune-dsp.simd.wasm', { mn: 40, mx: 240, ck: false }, ({ states }) => {
      for (const state of states) assert.equal(state.sampleRate, frameRate);
      const final = states.at(-1);
      assert.equal(final.locked, true, 'a steady groove locks within ten seconds');
      assert.ok(final.epoch >= 1);
      assert.ok(Math.abs(final.period - BEAT_SECONDS) < 0.005, `period was ${final.period} s`);
      assert.ok(Math.abs(beatError(final.next)) < 0.02, `next beat was ${final.next} s`);
      assert.ok(states.flatMap(state => state.events).length > 40, 'hits are reported as onset events');
    }, sampleRate);
  });
}
