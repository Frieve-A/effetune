import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { audioManagerSfzRuntimeMethods } from '../../js/audio/audio-manager-sfz-runtime.js';
import { MidiFrameScheduler } from '../../js/midi/smf-scheduler.js';
import { MidiInputState } from '../../js/midi/smf-timeline.js';
import { DspEngineBinding, ET_ERR_STATE } from '../../js/audio/dsp-engine-binding.js';

function worklet() {
  let Processor;
  const globals = {
    currentFrame: 128,
    console: { warn() {} }, AudioWorkletProcessor: class {},
    registerProcessor(name, Type) { if (name === 'plugin-processor') Processor = Type; }
  };
  vm.runInNewContext(fs.readFileSync(new URL('../../plugins/audio-processor.js', import.meta.url), 'utf8'), globals);
  const calls = [], replies = [];
  const plugin = { id: 7, type: 'SoundFontPlayerPlugin', parameters: { sf: 'bank' } };
  const state = { enabled: true, paused: true, cursor: 17 };
  const processor = Object.assign(Object.create(Processor.prototype), {
    currentFrame: 128, telemetryContextFrameOffset: 128,
    plugins: [plugin], wasmInstances: new Map([[7, { id: 11 }]]),
    soundFontMidiMeteringEntries: new Set(),
    dspAssetCache: new Map([[7, new Map([[0, { operationRevision: 3, replayEpoch: 9 }]])]]),
    midiScheduler: { instances: new Map([[7, state]]) },
    dspBinding: { instanceAssetState: () => 3, instanceMidiClock: () => ({ frame: 123, generation: 5 }),
      instanceSetMidiEvents(...args) { calls.push(['events', ...args]); return 0; },
      instanceSetMidiChannelMix(...args) { calls.push(['mix', ...args]); return 0; } },
    captureSfzRuntimeCheckpoint: () => ({ bytes: Uint8Array.of(42), clockFrame: 123, generation: 5 }),
    _invalidatePowerSkipForMutation() {}, port: { postMessage(data) { replies.push(data); } }
  });
  return { processor, calls, replies, globals, send(action, extra = {}) {
    processor.handlePortMessage({ type: 'soundFontMixerAction', pluginId: 7, token: 3, replayEpoch: 9,
      requestId: 1, action, ...extra });
    return replies.at(-1);
  } };
}

test('paused mixer edits use the CONTROL-only native ingress, preserve pending musical events and refresh the existing checkpoint', () => {
  const h = worklet();
  const result = h.send({ type: 'program', channel: 2, bank: 42, program: 19 });
  assert.equal(result.ok, true);
  assert.equal(result.appliedFrame, 256, 'The completed context frame is authoritative even before currentFrame advances');
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['events', 11, [
    { offsetFrames: 0, status: 178, data1: 0, data2: 42 },
    { offsetFrames: 0, status: 178, data1: 32, data2: 0 },
    { offsetFrames: 0, status: 194, data1: 19, data2: 0 }], 5, 4096]]);
  assert.equal(result.checkpoints[0].cursor, 17);
  assert.equal(result.checkpoints[0].clockFrame, 123);
  assert.equal(h.send({ type: 'program', channel: 2, bank: 128, program: 0 }).ok, false);
  assert.equal(h.calls.length, 1, 'Drum bank must not be silently encoded as a melodic bank');
  assert.equal(h.send({ type: 'program', channel: 9, bank: 128, program: 0 }).ok, true);
  assert.equal(h.calls.at(-1)[2][0].data2, 0);
});

test('channel mix actions are atomic per-channel operations and stale or rejected targets fail visibly', () => {
  const h = worklet();
  for (const [type, value, code] of [['mute', true, 1], ['solo', true, 3], ['mute', false, 0], ['solo', false, 2]]) {
    const answer = h.send({ type, value, channel: 15 });
    assert.equal(answer.ok, true); assert.equal(answer.checkpoints, undefined);
    assert.deepEqual(h.calls.at(-1), ['mix', 11, 15, code]);
  }
  const count = h.calls.length;
  assert.equal(h.send({ type: 'mute', value: true, channel: 0 }, { replayEpoch: 8 }).ok, false);
  assert.equal(h.send({ type: 'control', controller: 64, value: 127, channel: 0 }).ok, false);
  assert.equal(h.calls.length, count);
  h.processor.dspBinding.instanceSetMidiEvents = () => -2;
  assert.equal(h.send({ type: 'control', controller: 7, value: 100, channel: 0 }).ok, false);
});

test('manager rejects superseded replies and stores refreshed paused checkpoints without a controller shadow', async () => {
  class SoundFontPlayerPlugin {}
  const plugin = Object.assign(new SoundFontPlayerPlugin(), { id: 7 });
  const node = {}, checkpoints = [{ bytes: Uint8Array.of(3) }];
  let identity = { token: 3, replayEpoch: 9 }, stored;
  const manager = Object.assign({}, audioManagerSfzRuntimeMethods, {
    _audioGraphGeneration: 1, _getActiveDspWorklets: () => [node],
    _getSfzRuntimePlugin: () => plugin, _getSfzRuntimeAssetIdentity: () => identity,
    getSfzSamplePreparation: () => null, getEffectiveActiveWasmAssetSnapshot: () => ({ ready: true }),
    _requestDspControl: async () => ({ ok: true, checkpoints, appliedFrame: 256 }),
    storeSfzRuntimeCheckpoints(_node, records) { stored = records; return true; }
  });
  assert.equal(await manager.sendSoundFontMixerAction(plugin, { type: 'control', channel: 0, controller: 11, value: 80 }), true);
  assert.equal(await manager.sendSoundFontMixerAction(plugin, { type: 'control', channel: 0, controller: 7, value: 80 }, true), 256);
  assert.equal(stored, checkpoints);
  manager._requestDspControl = async () => { identity = { ...identity, replayEpoch: 10 }; return { ok: true }; };
  await assert.rejects(manager.sendSoundFontMixerAction(plugin, { type: 'mute', channel: 0, value: true }), /could not be updated/);
  manager.getSfzSamplePreparation = () => Promise.resolve();
  await assert.rejects(manager.sendSoundFontMixerAction(plugin, {}), /Wait until/);
});

test('a packet containing deferred native snapshots carries a conservative mixer frame', () => {
  const { processor, replies, globals } = worklet();
  Object.assign(processor, { dspLive: true, dspPacketPool: [], powerPolicy: { enabled: false } });
  processor.dspBinding.telemetryRead = () => 600;
  processor.pumpDspTelemetry(128);
  assert.equal(replies.length, 0);
  globals.currentFrame += 128;
  processor.dspPacketPool.push(new Uint8Array(600));
  processor.pumpDspTelemetry(128);
  assert.deepEqual([replies.at(-1).endFrame, replies.at(-1).mixerEndFrame], [384, 256]);
  globals.currentFrame += 128;
  processor.dspPacketPool.push(new Uint8Array(600));
  processor.pumpDspTelemetry(128);
  assert.deepEqual([replies.at(-1).endFrame, replies.at(-1).mixerEndFrame], [512, 512]);
});

test('MIDI metering desire survives missing worklets and replays only for the current plugin instance', () => {
  class SoundFontPlayerPlugin {}
  const first = Object.assign(new SoundFontPlayerPlugin(), { id: 7 });
  const next = Object.assign(new SoundFontPlayerPlugin(), { id: 7 });
  const messages = [], node = { port: { postMessage(message) { messages.push(message); } } };
  let current = null;
  const manager = Object.assign({}, audioManagerSfzRuntimeMethods, {
    _getActiveDspWorklets: () => [node], _getSfzRuntimePlugin: () => current
  });
  manager.setSoundFontMidiMetering(first, true);
  assert.deepEqual(messages, [], 'setting desire does not start a missing worklet');
  current = first;
  manager._handleSfzRuntimeMessage(node, { type: 'sfzRuntimeIdentity', pluginId: 7,
    instanceId: 11, instanceEpoch: 4, token: 1 });
  assert.deepEqual(messages.pop(), { type: 'soundFontMidiMetering', pluginId: 7,
    instanceEpoch: 4, enabled: true });
  manager.setSoundFontMidiMetering(first, false);
  assert.deepEqual(messages.pop(), { type: 'soundFontMidiMetering', pluginId: 7,
    instanceEpoch: 4, enabled: false });
  current = next;
  manager.setSoundFontMidiMetering(first, false);
  manager.setSoundFontMidiMetering(next, true);
  assert.deepEqual(messages, [], 'old UI and stale identity cannot target the replacement');
  manager._handleSfzRuntimeMessage(node, { type: 'sfzRuntimeIdentity', pluginId: 7,
    instanceId: 12, instanceEpoch: 5, token: 1 });
  assert.deepEqual(messages.pop(), { type: 'soundFontMidiMetering', pluginId: 7,
    instanceEpoch: 5, enabled: true });
});

test('worklet metering command accepts only the matching SoundFont instance epoch', () => {
  const h = worklet();
  h.processor.wasmInstances.set(7, { id: 11, type: 'SoundFontPlayerPlugin', instanceEpoch: 4 });
  h.processor.dspBinding.instanceSetMidiMetering = (...args) => { h.calls.push(['meter', ...args]); return 0; };
  h.processor.handlePortMessage({ type: 'soundFontMidiMetering', pluginId: 7, instanceEpoch: 4, enabled: true });
  h.processor.handlePortMessage({ type: 'soundFontMidiMetering', pluginId: 7, instanceEpoch: 3, enabled: false });
  h.processor.handlePortMessage({ type: 'soundFontMidiMetering', pluginId: 7, instanceEpoch: 4, enabled: 1 });
  assert.deepEqual(h.calls, [['meter', 11, true]]);
  h.processor.wasmInstances.set(7, { id: 12, type: 'SoundFontPlayerPlugin', instanceEpoch: 5 });
  h.processor.handlePortMessage({ type: 'soundFontMidiMetering', pluginId: 7, instanceEpoch: 4, enabled: false });
  assert.deepEqual(h.calls, [['meter', 11, true]], 'old disable cannot turn off a new same-ID instance');
});

test('binding MIDI metering setter is optional for old WASM and passes only boolean values', () => {
  const binding = Object.assign(Object.create(DspEngineBinding.prototype), { engine: 7, exports: {} });
  assert.equal(binding.instanceSetMidiMetering(11, true), ET_ERR_STATE);
  const calls = [];
  binding.exports.et_instance_set_midi_metering = (...args) => { calls.push(args); return 0; };
  assert.equal(binding.instanceSetMidiMetering(11, true), 0);
  assert.equal(binding.instanceSetMidiMetering(11, false), 0);
  assert.deepEqual(calls, [[7, 11, 1], [7, 11, 0]]);
  assert.throws(() => binding.instanceSetMidiMetering(11, 1), /Invalid MIDI metering/);
});

test('binding passes single-channel actions and serializes reset kind and exact sample offset', () => {
  const memory = new WebAssembly.Memory({ initial: 1 }), calls = [];
  const binding = Object.assign(Object.create(DspEngineBinding.prototype), { engine: 7, memory,
    _midiEventsPtr: 64, _maxFrames: 128, _memoryBuffer: null, exports: {
      et_instance_set_midi_channel_mix(...args) { calls.push(args); return 0; }
    } });
  assert.equal(binding.instanceSetMidiChannelMix(11, 15, 3), 0);
  assert.deepEqual(calls, [[7, 11, 15, 3]]);
  assert.throws(() => binding.instanceSetMidiChannelMix(11, 16, 1), /Invalid MIDI/);
  binding._writeMidiEvents([{ status: 0, data1: 0, data2: 0, noteId: 2, flags: 8192, offsetFrames: 127 }], 1);
  const view = new DataView(memory.buffer);
  assert.equal(view.getUint32(64, true), 127);
  assert.equal(view.getUint32(72, true), 2); assert.equal(view.getUint32(76, true), 8192);
  assert.equal(view.getUint32(80, true), 0);
});


test('system reset keeps its exact block offset and reset kind, while late live hydration contains only current controllers', () => {
  const scheduler = new MidiFrameScheduler(1000), calls = [];
  scheduler.configure({ timeline: { duration: 1, events: [
    { seconds: 0, status: 144, data1: 60, data2: 100 },
    { seconds: .064, status: 0, data1: 0, data2: 0, systemReset: 3 },
    { seconds: .064, status: 192, data1: 8, data2: 0 } ] }, playing: true, generation: 5 });
  scheduler.register(7, 11, 3);
  const binding = { instanceSetMidiEvents(_id, events, _gen, flags, count) {
    calls.push({ flags, events: events.slice(0, count).map(event => ({ ...event })) }); return 0;
  }, instanceSetMidiClock: () => 0, instanceSetMidiGain: () => 0 };
  scheduler.processInstance(binding, 7, 0, 128);
  const events = calls.filter(call => call.flags === 0).flatMap(call => call.events);
  const reset = events.find(event => event.flags === 8192);
  assert.equal(reset.offsetFrames, 64); assert.equal(reset.noteId, 3); assert.equal(reset.renderFrame, 0);
  assert.equal(events[events.indexOf(reset) + 1].status, 192, 'Later same-offset program remains authoritative');
  const state = new MidiInputState();
  state.apply({ status: 144, data1: 60, data2: 100, seconds: 0 });
  state.apply({ status: 176, data1: 7, data2: 9, seconds: 0 });
  state.apply({ status: 0, data1: 0, data2: 0, systemReset: 3, seconds: .064 });
  state.apply({ status: 192, data1: 8, data2: 0, seconds: .064 });
  const hydration = state.hydration();
  assert.deepEqual(hydration[0], { status: 0, data1: 0, data2: 0, flags: 8192, noteId: 3 });
  assert.equal(hydration.some(event => (event.status & 0xf0) === 144), false);
  assert.equal(state.channels[0].cc[7], 100); assert.equal(state.channels[0].program, 8);
});


test('metadata separates selected information, native readiness and actual sample availability without inventing headroom', () => {
  const node = {}, plugin = { id: 7, _soundFontMetadata: { sampleCount: 9323, presetCount: 1318, sourceBytes: 4235218112 } };
  const identity = { instanceEpoch: 2 };
  const manager = Object.assign({}, audioManagerSfzRuntimeMethods, {
    _getActiveDspWorklets: () => [node], _getSfzRuntimePlugin: () => plugin,
    getSfzSamplePreparation: () => null,
    getEffectiveActiveWasmAssetSnapshot: () => ({ ready: true, assets: new Map([[0, { footprintBytes: 268000000,
      sampleCacheBytes: 250000000, sampleCacheSlots: 15235 }]]) }),
    _sfzRuntimeIdentities: new Map([[node, new Map([[7, identity]])]]),
    _dspRuntimeEventsByNode: new WeakMap([[node, new Map([[7, { instanceEpoch: 2, cause: 'sampleUnavailable' }]])]])
  });
  let result = manager.getNativeMixerMetadata(plugin);
  assert.equal(result.sampleCount, 9323); assert.equal(result.presetCount, 1318);
  assert.equal(result.metadataReady, true); assert.equal(result.nativeReady, true);
  assert.equal(result.sampleAvailable, false); assert.equal(result.headroomFrames, 0);
  assert.equal(result.sampleCacheSlots, 15235);
  plugin._pending = Promise.resolve(); result = manager.getNativeMixerMetadata(plugin);
  assert.equal(result.ready, false); assert.equal(result.preparing, true);
  identity.instanceEpoch = 3; result = manager.getNativeMixerMetadata(plugin);
  assert.equal(result.sampleAvailable, null); assert.equal(result.headroomFrames, null, 'A retired cache observation is not a new-bank guarantee');
});
