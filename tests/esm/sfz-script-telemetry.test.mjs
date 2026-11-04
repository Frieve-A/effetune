import assert from 'node:assert/strict';
import test from 'node:test';
import { TelemetryHub, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { decodeTelemetryPacket, supportsTelemetry } from '../../dsp/bindings/js/src/telemetry.js';

function packet(text, suppressed = 0) {
  const bytes = new TextEncoder().encode(text);
  const buffer = new Uint8Array((24 + bytes.length + 3) & ~3);
  const view = new DataView(buffer.buffer);
  view.setUint16(0, 33, true);
  view.setUint16(2, 1, true);
  view.setUint32(4, 7, true);
  view.setUint16(12, 8 + bytes.length, true);
  view.setUint32(16, suppressed, true);
  view.setUint16(20, bytes.length, true);
  buffer.set(bytes, 24);
  return buffer;
}

test('SFZ script messages use the next registry ID and route only to developer Console', () => {
  assert.equal(TelemetryFrameType.TAP_SFZ_SCRIPT_MESSAGE, 33);
  const messages = [];
  const previous = console.debug;
  console.debug = (...args) => messages.push(args);
  try {
    const hub = new TelemetryHub();
    let received = 0;
    hub.subscribe(7, 33, () => received++);
    const bytes = packet('ready 日本語 %c', 12);
    assert.equal(hub.handleMessage({ type: 'dspTelemetry', packet: bytes.buffer, bytes: bytes.length }), true);
    assert.deepEqual(messages, [['[SFZ instrument]', 'ready 日本語 %c', '(12 additional messages omitted)']]);
    assert.equal(received, 0, 'diagnostics cannot become plugin UI messages');
  } finally { console.debug = previous; }
});

test('public telemetry returns bounded typed SFZ diagnostics and rejects malformed payloads', () => {
  const nodes = new Map([[7, { effectType: 'SoundFontPlayer', effectId: 'player', effectIndex: 0 }]]);
  assert.equal(supportsTelemetry('SoundFontPlayer'), true);
  assert.equal(supportsTelemetry('SFZNotePlayer'), true);
  const bytes = packet('started', 3);
  const frame = decodeTelemetryPacket(bytes, bytes.length, nodes).frames[0];
  assert.equal(frame.kind, 'sfz-script-message');
  assert.equal(frame.text, 'started');
  assert.equal(frame.suppressed, 3);
  new DataView(bytes.buffer).setUint16(22, 1, true);
  assert.deepEqual(decodeTelemetryPacket(bytes, bytes.length, nodes).frames, []);
  const oversized = packet('x'.repeat(128));
  assert.deepEqual(decodeTelemetryPacket(oversized, oversized.length, nodes).frames, []);
});
