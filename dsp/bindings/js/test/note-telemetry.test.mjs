import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeTelemetryPacket, TELEMETRY_RING_BYTES } from '../dist/telemetry.js';

const PAYLOAD_BYTES = 9192;
const FRAME_BYTES = 16 + PAYLOAD_BYTES;
const nodes = new Map([[2, {
  effectType: 'NoteSpectrogram', effectId: 'notes', effectIndex: 0
}]]);

function chordPacket() {
  const packet = new Uint8Array(48);
  const view = new DataView(packet.buffer);
  view.setUint16(0, 32, true);
  view.setUint16(2, 1, true);
  view.setUint32(4, 2, true);
  view.setUint16(12, 32, true);
  view.setFloat32(16, 48000, true);
  view.setFloat32(20, 1, true);
  view.setFloat32(24, .02, true);
  view.setUint32(28, 7, true);
  view.setUint32(32, 54, true);
  packet.set([0, 4, 4, 255, 255, 255, 21, 255], 36);
  view.setFloat32(44, .75, true);
  return packet;
}

test('Note Chord Key decodes chord triples, absent chords and both key states', () => {
  const packet = chordPacket();
  const { frames } = decodeTelemetryPacket(packet, packet.length, nodes);
  const frame = frames[0];
  assert.equal(frame.kind, 'noteChordKey');
  assert.equal(frame.confirmedProbability, .75);
  assert.deepEqual([frame.generation, frame.frameIndex], [7, 54]);
  assert.deepEqual([frame.immediateRoot, frame.immediateQuality, frame.immediateBass], [0, 4, 4]);
  assert.deepEqual([frame.confirmedRoot, frame.confirmedQuality, frame.confirmedBass], [null, null, null]);
  assert.deepEqual([frame.localKey, frame.overallKey], [21, null]);
  packet.set([24, 3], 42);
  packet.set([0, 4, 4], 39);
  new DataView(packet.buffer).setFloat32(44, 1, true);
  const next = decodeTelemetryPacket(packet, packet.length, nodes).frames[0];
  assert.deepEqual([next.localKey, next.overallKey], [24, 3]);
  assert.equal(next.confirmedProbability, 1);
  assert.equal(frame.confirmedProbability, .75);
  assert.equal(frame.overallKey, null, 'decoded values are independent of packet reuse');
  packet.set([255, 255], 42);
  const unavailable = decodeTelemetryPacket(packet, packet.length, nodes).frames[0];
  assert.deepEqual([unavailable.localKey, unavailable.overallKey], [null, null]);
  assert.equal(unavailable.confirmedRoot, 0, 'unavailable keys preserve the chord result');
});

test('Note Chord Key rejects malformed triples, key values and versions', () => {
  for (const [offset, value] of [[36, 12], [37, 11], [38, 255], [40, 0], [42, 25], [43, 24], [2, 2]]) {
    const packet = chordPacket();
    packet[offset] = value;
    const decoded = decodeTelemetryPacket(packet, packet.length, nodes, 3);
    assert.equal(decoded.frames.length, 0, `invalid byte ${offset}`);
    assert.equal(decoded.pendingDropped, 3);
  }
});

test('Note Chord Key validates probability range and exact payload size', () => {
  for (const value of [0, 1, -.01, 1.01, NaN, Infinity]) {
    const packet = chordPacket();
    new DataView(packet.buffer).setFloat32(44, value, true);
    assert.equal(decodeTelemetryPacket(packet, packet.length, nodes).frames.length,
      Number(value === 0 || value === 1));
  }
  const packet = chordPacket().slice(0, 44);
  new DataView(packet.buffer).setUint16(12, 28, true);
  assert.equal(decodeTelemetryPacket(packet, packet.length, nodes).frames.length, 0);
});

function timbrePacket(event = 2) {
  const packet = new Uint8Array(96);
  const view = new DataView(packet.buffer);
  view.setUint16(0, 31, true);
  view.setUint16(2, 1, true);
  view.setUint32(4, 2, true);
  view.setUint16(12, 80, true);
  view.setFloat32(16, 96000, true);
  view.setFloat32(20, 1.08, true);
  view.setFloat32(24, .02, true);
  for (const [offset, value] of [[28, 7], [32, 54], [36, 12], [40, 60], [44, event], [48, 50],
    [52, event === 3 ? 54 : 0xffffffff]]) view.setUint32(offset, value, true);
  if (event === 2) {
    view.setFloat32(56, .2, true);
    view.setFloat32(88, .8, true);
  }
  return packet;
}

test('Note Spectrogram timbre events preserve note identity, frame interval, and owned probabilities', () => {
  for (const [event, label] of [[1, 'start'], [2, 'result'], [3, 'end']]) {
    const packet = timbrePacket(event);
    const decoded = decodeTelemetryPacket(packet, packet.byteLength, nodes, 2);
    const frame = decoded.frames[0];
    assert.equal(frame.kind, 'noteTimbre');
    assert.equal(frame.event, label);
    assert.deepEqual([frame.generation, frame.noteId, frame.midi, frame.startFrameIndex], [7, 12, 60, 50]);
    assert.equal(frame.endFrameIndex, event === 3 ? 54 : null);
    assert.equal(decoded.pendingDropped, 0);
    if (event === 2) {
      assert.ok(Math.abs(frame.probabilities[8] - .8) < 1e-6);
      packet.fill(0);
      assert.ok(Math.abs(frame.probabilities[8] - .8) < 1e-6);
    } else assert.equal(frame.probabilities, null);
  }
});

test('invalid timbre probabilities and unknown note event contracts are rejected', () => {
  for (const mutate of [view => view.setFloat32(88, NaN, true), view => view.setFloat32(88, .3, true),
    view => view.setUint32(44, 4, true), view => view.setUint32(40, 109, true),
    view => view.setUint16(2, 2, true), view => view.setUint32(92, 1, true)]) {
    const packet = timbrePacket();
    mutate(new DataView(packet.buffer));
    const decoded = decodeTelemetryPacket(packet, packet.byteLength, nodes, 3);
    assert.equal(decoded.frames.length, 0);
    assert.equal(decoded.pendingDropped, 3);
  }
});

function notePacket(revisionAge = 8) {
  const packet = new Uint8Array(FRAME_BYTES);
  const view = new DataView(packet.buffer);
  view.setUint16(0, 24, true);
  view.setUint16(2, 6, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, 17, true);
  view.setUint16(12, PAYLOAD_BYTES, true);
  view.setFloat32(16, 48000, true);
  view.setFloat32(20, 1, true);
  view.setUint16(24, 440, true);
  view.setUint16(26, 21, true);
  view.setFloat32(28, 0.02, true);
  view.setUint32(32, 50, true);
  view.setUint32(36, 5, true);
  view.setUint32(40, 3, true);
  view.setUint32(44, revisionAge, true);
  view.setFloat32(48, 0.75, true);
  view.setFloat32(1804, 0.25, true);
  view.setFloat32(1808, -12, true);
  view.setFloat32(3564, -240, true);
  view.setFloat32(8856, -13.375, true);
  view.setFloat32(9204, 27.125, true);
  if (revisionAge !== 0) {
    view.setFloat32(3568, 0.5, true);
    view.setFloat32(5324, 1, true);
    view.setUint32(5328, 2, true);
    view.setFloat32(5332, 0.25, true);
    view.setUint32(7092, 4, true);
    view.setFloat32(7096, 0.75, true);
  }
  return packet;
}

test('Note Spectrogram v6 preserves estimated cents and all three revisions as owned values', () => {
  const packet = notePacket();
  const { frames, pendingDropped } = decodeTelemetryPacket(packet, packet.byteLength, nodes, 2);
  assert.equal(frames.length, 1);
  assert.equal(pendingDropped, 0);
  const frame = frames[0];
  assert.equal(frame.kind, 'noteSpectrogram');
  assert.equal(frame.sequence, 17);
  assert.equal(frame.dropped, 2);
  assert.equal(frame.sampleRate, 48000);
  assert.equal(frame.timeSeconds, 1);
  assert.equal(frame.firstMidi, 21);
  assert.equal(frame.frameIndex, 50);
  assert.equal(frame.divisionsPerSemitone, 5);
  assert.equal(frame.generation, 3);
  assert.equal(frame.revisionAge, 8);
  assert.deepEqual([frame.levels.length, frame.levels[0], frame.levels[439]], [440, 0.75, 0.25]);
  assert.deepEqual([frame.volumeDb.length, frame.volumeDb[0], frame.volumeDb[439]], [440, -12, -240]);
  assert.deepEqual([frame.pitchCents.length, frame.pitchCents[0], frame.pitchCents[87]], [88, -13.375, 27.125]);
  assert.deepEqual([frame.revisedLevels.length, frame.revisedLevels[0], frame.revisedLevels[439]], [440, 0.5, 1]);
  assert.deepEqual(frame.revisions.map(revision => [revision.age, revision.levels[0]]), [[2, 0.25], [4, 0.75], [8, 0.5]]);
  packet.fill(0);
  assert.equal(frame.levels[0], 0.75);
  assert.equal(frame.volumeDb[0], -12);
  assert.equal(frame.pitchCents[0], -13.375);
  assert.equal(frame.revisedLevels[0], 0.5);
  assert.equal(frame.revisions[0].levels[0], 0.25);
  assert.equal(frame.revisions[1].levels[0], 0.75);
});

test('Note Spectrogram v6 exposes current estimated cents before revisions are available', () => {
  const packet = notePacket(0);
  const { frames } = decodeTelemetryPacket(packet, packet.byteLength, nodes);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].revisionAge, 0);
  assert.equal(frames[0].revisedLevels, null);
  assert.deepEqual(frames[0].revisions, []);
  assert.equal(frames[0].pitchCents[87], 27.125);
});

test('Note Spectrogram rejects invalid v6 revisions, cents, and obsolete frames', () => {
  const mutations = [
    view => view.setUint32(44, 7, true),
    view => view.setFloat32(3568, Number.NaN, true),
    view => view.setFloat32(3568, -0.1, true),
    view => view.setFloat32(5324, 1.1, true),
    view => view.setUint32(5328, 4, true),
    view => view.setFloat32(5332, Number.NaN, true),
    view => view.setUint32(7092, 2, true),
    view => view.setFloat32(7096, 1.1, true),
    view => view.setFloat32(8856, Number.NaN, true),
    view => view.setFloat32(9204, Number.POSITIVE_INFINITY, true),
    view => view.setUint16(2, 3, true),
    view => view.setUint16(2, 5, true),
    view => view.setUint16(12, 8840, true),
    view => view.setUint16(12, 3548, true)
  ];
  for (const mutate of mutations) {
    const packet = notePacket();
    mutate(new DataView(packet.buffer));
    const decoded = decodeTelemetryPacket(packet, packet.byteLength, nodes, 2);
    assert.equal(decoded.frames.length, 0);
    assert.equal(decoded.pendingDropped, 2);
  }
});

test('the library telemetry ring holds all 32 pending Note Spectrogram v6 frames', () => {
  assert.ok(TELEMETRY_RING_BYTES >= 32 * FRAME_BYTES);
  const packet = new Uint8Array(32 * FRAME_BYTES);
  for (let index = 0; index < 32; index++) packet.set(notePacket(), index * FRAME_BYTES);
  const { frames } = decodeTelemetryPacket(packet, packet.byteLength, nodes);
  assert.equal(frames.length, 32);
});
