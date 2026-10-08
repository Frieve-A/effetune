import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeTelemetryPacket, TELEMETRY_RING_BYTES } from '../dist/telemetry.js';

const PAYLOAD_BYTES = 8840;
const FRAME_BYTES = 16 + PAYLOAD_BYTES;
const nodes = new Map([[2, {
  effectType: 'NoteSpectrogram', effectId: 'notes', effectIndex: 0
}]]);

function notePacket(revisionAge = 8) {
  const packet = new Uint8Array(FRAME_BYTES);
  const view = new DataView(packet.buffer);
  view.setUint16(0, 24, true);
  view.setUint16(2, 5, true);
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

test('Note Spectrogram v5 decodes all three revisions as owned values', () => {
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
  assert.deepEqual([frame.revisedLevels.length, frame.revisedLevels[0], frame.revisedLevels[439]], [440, 0.5, 1]);
  assert.deepEqual(frame.revisions.map(revision => [revision.age, revision.levels[0]]), [[2, 0.25], [4, 0.75], [8, 0.5]]);
  packet.fill(0);
  assert.equal(frame.levels[0], 0.75);
  assert.equal(frame.volumeDb[0], -12);
  assert.equal(frame.revisedLevels[0], 0.5);
  assert.equal(frame.revisions[0].levels[0], 0.25);
  assert.equal(frame.revisions[1].levels[0], 0.75);
});

test('Note Spectrogram v5 exposes no revision during warm-up', () => {
  const packet = notePacket(0);
  const { frames } = decodeTelemetryPacket(packet, packet.byteLength, nodes);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].revisionAge, 0);
  assert.equal(frames[0].revisedLevels, null);
  assert.deepEqual(frames[0].revisions, []);
});

test('Note Spectrogram rejects invalid v5 revisions and obsolete frames', () => {
  const mutations = [
    view => view.setUint32(44, 7, true),
    view => view.setFloat32(3568, Number.NaN, true),
    view => view.setFloat32(3568, -0.1, true),
    view => view.setFloat32(5324, 1.1, true),
    view => view.setUint32(5328, 4, true),
    view => view.setFloat32(5332, Number.NaN, true),
    view => view.setUint32(7092, 2, true),
    view => view.setFloat32(7096, 1.1, true),
    view => view.setUint16(2, 3, true),
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

test('the library telemetry ring holds all 32 pending Note Spectrogram v5 frames', () => {
  assert.ok(TELEMETRY_RING_BYTES >= 32 * FRAME_BYTES);
  const packet = new Uint8Array(32 * FRAME_BYTES);
  for (let index = 0; index < 32; index++) packet.set(notePacket(), index * FRAME_BYTES);
  const { frames } = decodeTelemetryPacket(packet, packet.byteLength, nodes);
  assert.equal(frames.length, 32);
});
