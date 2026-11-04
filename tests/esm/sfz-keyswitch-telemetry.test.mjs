import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { TelemetryHub, TelemetryFrameType } from '../../js/audio/telemetry-hub.js';
import { decodeTelemetryPacket } from '../../dsp/bindings/js/src/telemetry.js';
import { generateSfzKeyswitchFixture } from '../../tools/generate-sfz-keyswitch-fixture.mjs';

test('native keyswitch fixture uses the current production compiler and budget', async () => {
  await generateSfzKeyswitchFixture({ check: true });
});

function packet(key = 24, version = 1) {
  const bytes = new Uint8Array(48), view = new DataView(bytes.buffer);
  view.setUint16(0, 34, true); view.setUint16(2, version, true);
  view.setUint32(4, 7, true); view.setUint16(12, 32, true);
  for (let channel = 0; channel < 16; channel++) view.setInt16(16 + channel * 2, channel === 0 ? key : -1, true);
  return bytes;
}

test('public keyswitch telemetry preserves all channels and rejects malformed keys and versions', () => {
  assert.equal(TelemetryFrameType.TAP_SFZ_KEYSWITCHES, 34);
  for (const effectType of ['SoundFontPlayer', 'SFZNotePlayer']) {
    const nodes = new Map([[7, { effectType, effectId: 'player', effectIndex: 0 }]]);
    const bytes = packet(), decoded = decodeTelemetryPacket(bytes, bytes.length, nodes, 0);
    assert.equal(decoded.frames[0].kind, 'sfz-keyswitches');
    assert.deepEqual(decoded.frames[0].keys, [24, ...new Array(15).fill(-1)]);
    assert.equal(decodeTelemetryPacket(packet(128), 48, nodes, 0).frames.length, 0);
    assert.equal(decodeTelemetryPacket(packet(-2), 48, nodes, 0).frames.length, 0);
    assert.equal(decodeTelemetryPacket(packet(24, 2), 48, nodes, 0).frames.length, 0);
  }
});

test('shared player consumes only active accepted-switch observations for its current asset and pipeline', () => {
  const port = {}, hub = new TelemetryHub({ port, now: () => 0, schedule: () => 1, cancel: () => {} });
  const window = { dspTelemetryHub: hub };
  class PluginBase { constructor() { this.enabled = true; } onMessage() {} }
  vm.runInNewContext(fs.readFileSync(new URL('../../plugins/sfz-instrument.js', import.meta.url), 'utf8'), { window, PluginBase });
  const plugin = new window.SFZInstrumentPlugin();
  plugin.id = 7;
  let revision = 1;
  plugin.getWasmAssetOperationRevision = () => revision;
  plugin._wasmAssetStates = new Map([[0, 3]]);
  plugin._wasmAssetLogicalReplayEpochs = new Map([[0, 1]]);
  plugin._instrumentPresentation = { switches: [{ first: 24, last: 24, label: 'Legato' }] };
  const receive = (key, sourcePort = port) => {
    const bytes = packet(key);
    hub.handleMessage({ type: 'dspTelemetry', packet: bytes.buffer, bytes: bytes.length, recycle: false }, sourcePort);
  };
  plugin._ensureSwitchTelemetrySubscription();
  receive(24);
  assert.equal(plugin._activeSwitches[0], 24);
  receive(128); assert.equal(plugin._activeSwitches[0], 24);
  receive(26, {}); assert.equal(plugin._activeSwitches[0], 24, 'Old worklet ports cannot update labels');
  hub.setVisualSyncResolver(() => 100);
  plugin._ensureSwitchTelemetrySubscription();
  receive(26);
  revision = 2;
  plugin._ensureSwitchTelemetrySubscription();
  hub._dispatchDueVisualSync(100);
  assert.equal(plugin._activeSwitches, null, 'Queued observations cannot cross asset subscriptions');
  receive(27); hub._dispatchDueVisualSync(100);
  assert.equal(plugin._activeSwitches[0], 27);
  plugin._wasmAssetLogicalReplayEpochs.set(0, 2);
  receive(28); hub._dispatchDueVisualSync(100);
  assert.equal(plugin._activeSwitches[0], 27, 'Unacknowledged replay changes cannot reuse the old subscription');
  plugin._ensureSwitchTelemetrySubscription();
  assert.equal(plugin._activeSwitches, null);
  plugin._wasmAssetStates.set(0, 1);
  plugin._ensureSwitchTelemetrySubscription();
  receive(29); hub._dispatchDueVisualSync(100);
  assert.equal(plugin._activeSwitches, null);
  assert.equal(hub.subscribers.size, 0);
  hub.clearVisualSyncQueue();
});
