import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TELEMETRY_HEADER_BYTES,
  TelemetryFrameType,
  TelemetryHub,
  parseTelemetryPacket
} from '../../js/audio/telemetry-hub.js';

function createPacket(frames) {
  const lengths = frames.map(frame => (TELEMETRY_HEADER_BYTES + frame.payload.length + 3) & ~3);
  const buffer = new ArrayBuffer(lengths.reduce((sum, length) => sum + length, 0));
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    view.setUint16(offset, frame.frameType, true);
    view.setUint16(offset + 2, frame.formatVersion ?? 1, true);
    view.setUint32(offset + 4, frame.tapId, true);
    view.setUint32(offset + 8, frame.sequence ?? i, true);
    view.setUint16(offset + 12, frame.payload.length, true);
    view.setUint16(offset + 14, frame.flags ?? 0, true);
    bytes.set(frame.payload, offset + TELEMETRY_HEADER_BYTES);
    offset += lengths[i];
  }
  return buffer;
}

test('packet parser exposes complete aligned frames with scoped payload views', () => {
  const packet = createPacket([
    {
      frameType: TelemetryFrameType.TAP_LEVEL,
      tapId: 10,
      sequence: 4,
      flags: 1,
      payload: Uint8Array.of(2, 0, 0, 0, 7)
    },
    {
      frameType: 999,
      formatVersion: 3,
      tapId: 11,
      sequence: 5,
      payload: Uint8Array.of(9, 8, 7, 6)
    }
  ]);
  const frames = [];
  const result = parseTelemetryPacket(packet, packet.byteLength, frame => frames.push(frame));
  assert.deepEqual(result, { ok: true, frames: 2, bytesRead: packet.byteLength });
  assert.equal(frames[0].frameType, TelemetryFrameType.TAP_LEVEL);
  assert.equal(frames[0].tapId, 10);
  assert.equal(frames[0].sequence, 4);
  assert.equal(frames[0].payloadBytes, 5);
  assert.equal(frames[0].flags, 1);
  assert.equal(frames[0].payload.getUint8(4), 7);
  assert.equal(Object.isFrozen(frames[0]), true);
  assert.equal(frames[1].frameType, 999);
  assert.equal(frames[1].formatVersion, 3);

  const typed = new Uint8Array(packet);
  assert.equal(parseTelemetryPacket(typed, typed.byteLength).ok, true);
  assert.deepEqual(parseTelemetryPacket(packet, 0), { ok: true, frames: 0, bytesRead: 0 });
});

test('packet parser rejects invalid bounds and dispatches nothing from malformed packets', () => {
  assert.equal(parseTelemetryPacket({}, 0).ok, false);
  assert.equal(parseTelemetryPacket(new ArrayBuffer(4), -1).ok, false);
  assert.equal(parseTelemetryPacket(new ArrayBuffer(4), 5).ok, false);
  assert.equal(parseTelemetryPacket(new ArrayBuffer(4), 4).error, 'truncated telemetry frame header');

  const claimedPayload = new ArrayBuffer(TELEMETRY_HEADER_BYTES);
  new DataView(claimedPayload).setUint16(12, 100, true);
  let calls = 0;
  const result = parseTelemetryPacket(claimedPayload, claimedPayload.byteLength, () => calls++);
  assert.equal(result.error, 'truncated telemetry frame payload');
  assert.equal(calls, 0);
});

test('packet parser remains deterministic for every truncation point', () => {
  const packet = createPacket([
    { frameType: 1, tapId: 1, payload: Uint8Array.of(1, 2, 3, 4, 5) },
    { frameType: 2, tapId: 2, payload: Uint8Array.of(6, 7, 8) }
  ]);
  for (let bytes = 0; bytes <= packet.byteLength; bytes++) {
    const frames = [];
    const result = parseTelemetryPacket(packet, bytes, frame => frames.push(frame));
    if (result.ok) {
      assert.equal(frames.length, result.frames);
      assert.equal(result.bytesRead, bytes);
    } else {
      assert.equal(frames.length, 0);
    }
  }
});

test('hub dispatches by tap and frame type and returns the transferred packet', () => {
  const posts = [];
  const warnings = [];
  const hub = new TelemetryHub({
    port: { postMessage: (...args) => posts.push(args) },
    warning: message => warnings.push(message)
  });
  const received = [];
  const unsubscribe = hub.subscribe(42, TelemetryFrameType.TAP_LEVEL, frame => received.push(frame.sequence));
  hub.subscribe(42, TelemetryFrameType.TAP_LEVEL, () => { throw new Error('draw failed'); });
  hub.subscribe(42, TelemetryFrameType.TAP_GAIN_REDUCTION, () => received.push('wrong type'));
  const packet = createPacket([
    { frameType: TelemetryFrameType.TAP_LEVEL, tapId: 42, sequence: 8, flags: 1, payload: new Uint8Array(0) },
    { frameType: TelemetryFrameType.TAP_LEVEL, tapId: 7, sequence: 9, payload: new Uint8Array(0) }
  ]);

  assert.equal(hub.handleMessage({
    type: 'dspTelemetry', packet, bytes: packet.byteLength, droppedFrames: 3
  }), true);
  assert.deepEqual(received, [8]);
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0][0], { type: 'dspTelemetryReturn', packet });
  assert.deepEqual(posts[0][1], [packet]);
  assert.deepEqual(hub.getStats(), {
    packets: 1,
    frames: 2,
    malformedPackets: 0,
    framesWithDropFlag: 1,
    coreDroppedFrames: 3,
    subscriberErrors: 1,
    returnErrors: 0
  });
  assert.ok(warnings.some(message => message.includes('draw failed')));
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);
  assert.equal(hub.handleMessage({ type: 'other' }), false);
});

test('hub returns malformed packets and isolates packet-pool failures', () => {
  const posts = [];
  const warnings = [];
  const hub = new TelemetryHub({
    port: { postMessage: (...args) => posts.push(args) },
    warning: message => warnings.push(message)
  });
  const packet = new ArrayBuffer(8);
  assert.equal(hub.handleMessage({ type: 'dspTelemetry', packet, bytes: 8 }), true);
  assert.equal(posts.length, 1);
  assert.equal(hub.getStats().malformedPackets, 1);
  assert.ok(warnings[0].includes('malformed telemetry packet'));

  hub.setPort({ postMessage() { throw new Error('port closed'); } });
  assert.equal(hub.handleMessage({ type: 'dspTelemetry', packet, bytes: 0 }), true);
  assert.equal(hub.getStats().returnErrors, 1);
  assert.ok(warnings.some(message => message.includes('port closed')));

  hub.setPort(null);
  assert.equal(hub.handleMessage({ type: 'dspTelemetry', packet: {}, bytes: 0 }), true);
  assert.equal(hub.getStats().malformedPackets, 2);
  hub.resetStats();
  assert.deepEqual(hub.getStats(), {
    packets: 0,
    frames: 0,
    malformedPackets: 0,
    framesWithDropFlag: 0,
    coreDroppedFrames: 0,
    subscriberErrors: 0,
    returnErrors: 0
  });
});

test('hub validates subscriptions and supports explicit cleanup', () => {
  const hub = new TelemetryHub();
  const callback = () => {};
  assert.throws(() => hub.subscribe(-1, 1, callback), /tapId/);
  assert.throws(() => hub.subscribe(1, 0x10000, callback), /frameType/);
  assert.throws(() => hub.subscribe(1, 1, null), /callback/);
  hub.subscribe(1, 1, callback);
  hub.clearSubscriptions();
  assert.equal(hub.unsubscribe(1, 1, callback), false);
});
