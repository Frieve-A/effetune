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
const PAYLOAD_BYTES = 1496;
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
    assert.equal(frame.formatVersion, 4);
    assert.equal(frame.tapId, TAP_ID);
    assert.equal(frame.payloadBytes, PAYLOAD_BYTES);
    checkFrame(frame.payload);
    return frame.payload;
  });
}

// Gate state and committed analysis are independent. Shown-beat confidence may be zero.
function checkFrame(payload) {
  const previewCount = payload.getUint32(1344, true);
  assert.ok(previewCount <= 12);
  const previewPeriod = payload.getFloat32(1348, true);
  assert.ok(Number.isFinite(previewPeriod) && previewPeriod >= 0);
  let previous;
  for (let i = 0; i < previewCount; i++) {
    const base = 1352 + 12 * i;
    const fraction = payload.getFloat32(base + 4, true);
    assert.ok(fraction >= 0 && fraction < 1);
    const beat = { time: payload.getInt32(base, true) + fraction, index: payload.getInt32(base + 8, true) };
    if (previous) assert.ok(beat.time > previous.time && beat.index === previous.index + 1);
    previous = beat;
  }
  for (const offset of [0, 16, 20, 40, 44, 52, 60]) assert.ok(Number.isFinite(payload.getFloat32(offset, true)));
  for (let offset = 64; offset < 832; offset += 4) {
    const value = payload.getFloat32(offset, true);
    assert.ok(value >= 0 && value <= 1, `tempogram value ${value}`);
  }
  const confidence = payload.getFloat32(40, true);
  assert.ok(confidence >= 0 && confidence <= 1, `confidence was ${confidence}`);
  if (payload.getFloat32(44, true) === 0) {
    assert.equal(payload.getUint32(48, true), 0);
    assert.equal(payload.getFloat32(52, true), 0);
    assert.equal(payload.getUint32(56, true), 0);
  }
  for (let k = 0; k < payload.getUint32(28, true); k++) {
    const slot = 832 + 32 * k;
    for (const offset of [4, 16, 20]) assert.ok(Number.isFinite(payload.getFloat32(slot + offset, true)));
    const strength = payload.getFloat32(slot + 24, true);
    const flags = payload.getUint8(slot + 29);
    assert.ok(flags <= 5);
    assert.equal(payload.getUint16(slot + 30, true), 0);
    const beat = flags === 2 || flags === 4 || flags === 5;
    assert.ok((beat ? strength >= 0 : strength > 0) && strength <= 1, `event strength was ${strength}`);
    if (beat) {
      assert.equal(payload.getFloat32(slot + 16, true), 0);
      assert.equal(payload.getUint8(slot + 28), 0);
    }
  }
}

function decode(payload) {
  const step = payload.getUint32(8, true) / payload.getFloat32(0, true);
  const events = [];
  const shownBeats = [];
  const forwardBeats = [];
  const analysisBeats = [];
  for (let k = 0; k < payload.getUint32(28, true); k++) {
    const slot = 832 + 32 * k;
    const flags = payload.getUint8(slot + 29);
    const event = {
      time: ((flags === 5 ? payload.getInt32(slot, true) : payload.getUint32(slot, true)) + payload.getFloat32(slot + 4, true)) * step,
      identity: `${payload.getUint32(slot, true)}:${payload.getUint32(slot + 4, true)}:${payload.getUint8(slot + 28)}`,
      epoch: payload.getUint32(slot + 8, true),
      index: payload.getInt32(slot + 12, true),
      beatFraction: payload.getFloat32(slot + 16, true),
      period: payload.getFloat32(slot + 20, true),
      strength: payload.getFloat32(slot + 24, true),
      band: payload.getUint8(slot + 28),
      annotated: flags === 0,
      provisional: flags === 3
    };
    if (flags === 5) analysisBeats.push(event);
    else if (flags === 2 || flags === 4) {
      forwardBeats.push(event);
      if (flags === 2) shownBeats.push(event);
    } else events.push(event);
  }
  return {
    sampleRate: payload.getFloat32(0, true),
    generation: payload.getUint32(4, true),
    time: payload.getUint32(12, true) * step,
    dropped: payload.getUint32(24, true),
    gateOpen: (payload.getUint32(32, true) & 1) !== 0,
    confidence: payload.getFloat32(40, true),
    strongestBpm: payload.getFloat32(60, true),
    epoch: payload.getUint32(36, true),
    period: payload.getFloat32(44, true),
    anchor: (payload.getUint32(48, true) + payload.getFloat32(52, true)) * step,
    anchorIndex: payload.getInt32(56, true),
    events,
    shownBeats,
    forwardBeats,
    analysisBeats,
    previewCount: payload.getUint32(1344, true),
    previewPeriod: payload.getFloat32(1348, true)
  };
}

const beatError = time => {
  const offset = time % BEAT_SECONDS;
  return offset > BEAT_SECONDS / 2 ? offset - BEAT_SECONDS : offset;
};

function checkCommittedHistory(states) {
  let previous = null;
  let anchors = 0;
  for (const state of states) {
    if (state.period <= 0) continue;
    assert.ok(state.anchor <= state.time, 'the analysis anchor is committed history');
    if (previous && state.epoch === previous.epoch && state.anchorIndex === previous.anchorIndex) {
      assert.equal(state.anchor, previous.anchor, 'committed anchor timestamps never move');
      assert.equal(state.period, previous.period, 'a committed period never changes');
    } else if (previous && state.epoch === previous.epoch && state.anchorIndex === previous.anchorIndex + 1) {
      assert.ok(Math.abs(state.period - (state.anchor - previous.anchor)) < 1e-5,
        'the period comes from consecutive committed beats');
    }
    if (!previous || state.epoch !== previous.epoch || state.anchorIndex !== previous.anchorIndex) {
      if (previous && state.epoch === previous.epoch) {
        assert.ok(state.anchorIndex > previous.anchorIndex && state.anchor > previous.anchor,
          'new committed anchors advance both index and audio time');
        const beats = state.anchorIndex - previous.anchorIndex;
        assert.ok(Math.abs((state.anchor - previous.anchor) / beats - BEAT_SECONDS) < 0.02,
          'skipped anchor summaries retain the fixture tempo and beat count');
      }
      anchors++;
    }
    previous = state;
  }
  assert.ok(anchors > 1, 'the fixture exercises multiple committed anchor summaries');
}

// Runs the groove through one instance and returns the decoded states, the click onsets found in
// the output (output minus the pass-through contract), and the binding for follow-up checks.
async function runGroove(artifact, params, body, sampleRate = 48000) {
  const bytes = fs.readFileSync(new URL(`../../plugins/dsp/${artifact}`, import.meta.url));
  const binding = await instantiateDsp(bytes);
  try {
    assert.equal(binding.exports.et_rhythm_analyzer_warm_up(sampleRate), 0,
      'the production module completes the cold-load warm-up');
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
      if (!params.ck || sampleRate === 64000) {
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
    states.push(...readFrames(binding, packet).map(decode));
    if (sampleRate === 48000) assert.ok(states.some(state => state.previewCount > 0 && state.period === 0),
      'the current path reaches the UI before the first committed period');
    await body({ binding, instanceId, arena, packet, states, clicks });
  } finally {
    binding.close();
  }
}

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
  test(`Rhythm Analyzer in ${artifact} publishes immediate and committed positions through v4 telemetry`, async () => {
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
      const final = states.filter(state => state.period > 0).at(-1);
      const tail = states.at(-1);
      assert.ok(states.some(state => state.gateOpen), 'the groove produces shown beat ticks');
      assert.equal(tail.gateOpen, false, 'the exact-zero tail hides new ticks');
      assert.equal(tail.period, 0, 'digital silence hides current tempo without discarding history');
      assert.equal(tail.confidence, 0);
      assert.equal(tail.strongestBpm, 0);
      assert.ok(final, 'the fixture produces valid committed beat history');
      assert.ok(Math.abs(final.period - BEAT_SECONDS) < 0.005, `period was ${final.period} s`);
      assert.ok(Math.abs(beatError(final.anchor)) < 0.02, `committed beat was ${final.anchor} s`);
      checkCommittedHistory(states);

      const events = states.flatMap(state => state.events);
      assert.ok(events.length > 40, 'hits are reported as onset events');
      for (const event of events) {
        assert.ok(event.band <= 2 && event.strength > 0);
        assert.ok(event.beatFraction >= 0 && event.beatFraction < 1);
      }
      const kicks = events.filter(event => event.annotated && event.band === 0 && event.time > 5);
      assert.ok(kicks.length > 0, 'the fixture exercises annotated low-band hits');
      for (const kick of kicks) {
        assert.ok(kick.epoch > 0 && kick.period > 0);
        assert.ok(kick.time <= final.anchor, 'annotated lanes stay in committed history');
      }
      const firstOnsets = new Map();
      let corrections = 0;
      for (const state of states) for (const event of state.events) {
        if (!event.annotated && !firstOnsets.has(event.identity)) firstOnsets.set(event.identity, { event, state });
        if (event.annotated && firstOnsets.has(event.identity)) {
          const first = firstOnsets.get(event.identity);
          assert.equal(event.time, first.event.time, 'committed resend preserves exact onset time');
          assert.equal(event.band, first.event.band);
          assert.equal(event.strength, first.event.strength);
          assert.ok(first.state.time < state.time, 'the onset is transported before its committed correction');
          corrections++;
        }
      }
      assert.ok(events.some(event => event.provisional), 'the fixture exercises immediate provisional annotations');
      assert.ok(corrections > 0, 'the fixture exercises committed replacements of already displayed onsets');
      const forwards = states.flatMap(state => state.forwardBeats);
      const shown = states.flatMap(state => state.shownBeats);
      const analyses = states.flatMap(state => state.analysisBeats);
      assert.ok(forwards.length > shown.length && shown.length > 0, 'hidden forward events are transported too');
      assert.equal(new Set(forwards.map(event => `${event.epoch}:${event.index}`)).size, forwards.length);
      assert.ok(analyses.length > 1, 'all committed beat callbacks are transported');
      for (let i = 1; i < analyses.length; i++) if (analyses[i].epoch === analyses[i - 1].epoch) {
        assert.equal(analyses[i].index, analyses[i - 1].index + 1, 'committed beat slots have no missing indices');
        assert.ok(analyses[i].time > analyses[i - 1].time);
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
        assert.equal(state.gateOpen, false);
        assert.equal(state.period, 0);
        assert.equal(state.confidence, 0);
        assert.equal(state.strongestBpm, 0);
      }
    });
  });

  test(`Rhythm Analyzer in ${artifact} clicks once for each shown beat event`, async () => {
    await runGroove(artifact, { mn: 40, mx: 240, ck: true }, ({ states, clicks }) => {
      const shown = states.flatMap(state => state.shownBeats.map(event => ({ ...event, decision: state.time })));
      assert.ok(shown.length > 0, 'the fixture exercises shown beats');
      assert.equal(clicks.length, shown.length, 'every shown event produces one click');
      const identities = new Set();
      for (let i = 0; i < shown.length; i++) {
        const event = shown[i];
        assert.ok(Math.abs(event.period - BEAT_SECONDS) < 0.005, `shown period was ${event.period} s`);
        const identity = `${event.epoch}:${event.index}`;
        assert.ok(!identities.has(identity), 'shown events have immutable unique identities');
        identities.add(identity);
        assert.ok(clicks[i] >= event.time - 1 / 48000, 'a click never precedes its estimated beat time');
        assert.ok(clicks[i] <= Math.max(event.time, event.decision) + 2 * BLOCK_SIZE / 48000,
          `click ${clicks[i]} must occur at the beat or the next available output sample`);
      }
    });
  });
}

// 44.1 kHz is resampled to a 48 kHz analysis stream, which the frame's rate and hop describe; 64 kHz has no
// rate rule and preserves playback with analysis unavailable. Both frames follow the same contract.
for (const [sampleRate, frameRate] of [[44100, 48000], [64000, 64000]]) {
  test(`Rhythm Analyzer frames at ${sampleRate} Hz preserve the supported-rate contract`, async () => {
    await runGroove('effetune-dsp.simd.wasm', { mn: 40, mx: 240, ck: sampleRate === 64000 }, ({ states, clicks }) => {
      for (const state of states) assert.equal(state.sampleRate, frameRate);
      const final = states.at(-1);
      if (sampleRate === 64000) {
        assert.equal(final.gateOpen, false);
        assert.equal(final.period, 0);
        assert.equal(clicks.length, 0);
        assert.equal(states.flatMap(state => state.shownBeats).length, 0);
        return;
      }
      assert.ok(states.some(state => state.gateOpen), 'the groove produces shown beat ticks');
      const latestAnalysis = states.filter(state => state.period > 0).at(-1);
      assert.ok(latestAnalysis, 'the fixture produces valid committed beat history');
      assert.equal(final.gateOpen, false, 'the exact-zero tail hides new ticks');
      assert.equal(final.period, 0);
      assert.equal(final.confidence, 0);
      assert.equal(final.strongestBpm, 0);
      assert.ok(latestAnalysis.epoch >= 1);
      assert.ok(Math.abs(latestAnalysis.period - BEAT_SECONDS) < 0.005, `period was ${latestAnalysis.period} s`);
      assert.ok(Math.abs(beatError(latestAnalysis.anchor)) < 0.02, `committed beat was ${latestAnalysis.anchor} s`);
      checkCommittedHistory(states);
      assert.ok(states.flatMap(state => state.events).length > 40, 'hits are reported as onset events');
    }, sampleRate);
  });
}
