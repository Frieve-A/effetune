import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { audioManagerSfzRuntimeMethods } from '../../js/audio/audio-manager-sfz-runtime.js';
import { AudioManager } from '../../js/audio-manager.js';

function worklet(types = ['SoundFontPlayerPlugin']) {
  let Processor;
  vm.runInNewContext(fs.readFileSync(new URL('../../plugins/audio-processor.js', import.meta.url), 'utf8'), {
    ArrayBuffer, DataView, Uint8Array, Float32Array, Map, Set, TextEncoder, TextDecoder,
    sampleRate: 1000, currentFrame: 0, AudioWorkletProcessor: class { port = {}; }, console,
    registerProcessor(name, type) { if (name === 'plugin-processor') Processor = type; }
  });
  const messages = [], calls = [], native = new Map();
  const plugins = types.map((type, index) => ({ id: index + 1, type, enabled: true, parameters: { mc: 0 } }));
  const processor = Object.assign(new Processor({ processorOptions: {} }), {
    plugins, dspLive: true,
    port: { postMessage(message) { messages.push(message); } },
    dspBinding: {
      instanceAssetState: id => native.get(id).phase, instanceMidiState: id => native.get(id).flags,
      instanceSetMidiEvents(id, _events, generation, flags) { calls.push({ id, generation, flags }); return 0; },
      instanceSetMidiClock: () => 0, instanceSetMidiGain: () => 0, telemetryRead: () => 0,
      takeSfzSampleRequests() { assert.fail('A terminal script cannot request source pages'); }
    }
  });
  const scheduler = processor.midiScheduler;
  scheduler.configure({ timeline: { duration: 10, events: [] }, playing: true, generation: 1 });
  for (const plugin of plugins) {
    native.set(plugin.id, { phase: 3, flags: 0 });
    processor.wasmInstances.set(plugin.id, { id: plugin.id });
    processor.dspAssetCache.set(plugin.id, new Map([[0, { operationRevision: 3, replayEpoch: 5 }]]));
    processor.postAssetState(plugin.id, 0, 3, 3, false, 5);
  }
  const output = [[new Float32Array(16), new Float32Array(16)]];
  const render = () => processor.process([[]], output, {});
  render();
  messages.length = 0; calls.length = 0;
  return { processor, scheduler, native, messages, calls, render };
}

test('a running failed main sampler retires alone while the other main sampler keeps its clock and generation', () => {
  const h = worklet(['SoundFontPlayerPlugin', 'SoundFontPlayerPlugin']);
  const healthy = h.scheduler.instances.get(2), before = healthy.clockFrame;
  h.native.set(1, { phase: 4, flags: 8 });
  h.render();
  h.render();
  assert.equal(h.scheduler.instances.get(1).failed, true);
  assert.equal(h.scheduler.generation, 1);
  assert.equal(h.scheduler.playing, true);
  assert.ok(healthy.clockFrame > before);
  assert.equal(h.calls.some(call => call.id === 1), false, 'No delivery, reset or history replay goes to the failed native instance');
  assert.equal(h.calls.some(call => call.id === 2 && call.flags === 1), false, 'The healthy instrument is not reset');
  assert.equal(h.messages.filter(message => message.type === 'midiTransportError').length, 1,
    'The aggregate owner decides whether the remaining current targets are healthy');
  assert.equal(h.messages.some(message => message.type === 'midiConfigurationChanged'), false);
  assert.equal(h.messages.filter(message => message.type === 'assetState' && message.pluginId === 1 && message.state === 4).length, 1);
});

test('a failed sampler reports current asset identity once without freezing the owner song clock, while replacement can recover', () => {
  const h = worklet();
  h.native.set(1, { phase: 4, flags: 8 });
  h.render();
  h.render();
  assert.equal(h.scheduler.playing, true);
  assert.equal(h.scheduler.preparing, false);
  assert.equal(h.scheduler.currentPosition(h.processor.currentFrame), .048);
  assert.equal(h.calls.length, 0);
  const errors = h.messages.filter(message => message.type === 'midiTransportError');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].pluginId, 1);
  assert.equal(errors[0].operationRevision, 3);
  assert.equal(errors[0].replayEpoch, 5);
  assert.ok(h.messages.findIndex(message => message.type === 'assetState') < h.messages.indexOf(errors[0]));
  h.scheduler.requestPause(2, 64);
  h.render();
  assert.equal(h.messages.filter(message => message.type === 'midiTransportError').length, 1,
    'The active pause handshake must not feed back into another failure');
  assert.ok(h.messages.some(message => message.type === 'midiPauseReady' && message.generation === 2));
  assert.equal(h.scheduler.playing, false);
  // A new transport generation cannot replay or re-report the same failed bank.
  h.scheduler.configure({ generation: 3, playing: true });
  h.render();
  assert.equal(h.messages.filter(message => message.type === 'midiTransportError').length, 1);
  h.processor.dspAssetCache.get(1).get(0).operationRevision = 4;
  h.native.set(1, { phase: 3, flags: 0 });
  h.render();
  assert.equal(h.scheduler.instances.get(1).failed, false);
  assert.equal(h.scheduler.instances.get(1).token, 4);
});

test('a fresh worklet keeps a replayed runtime-retired source out of native MIDI delivery until a new user revision', () => {
  const h = worklet();
  h.scheduler.instances.clear();
  h.processor.plugins[0].runtimeAssetErrorRevision = 3;
  const clock = h.processor.dspBinding.instanceSetMidiClock;
  h.processor.dspBinding.instanceSetMidiClock = () => assert.fail('A replayed retired source cannot advance its native clock');
  h.render();
  assert.equal(h.scheduler.instances.get(1).failed, true);
  assert.equal(h.scheduler.playing, true);
  assert.equal(h.scheduler.currentPosition(h.processor.currentFrame), .032);
  assert.equal(h.calls.length, 0, 'READY replay cannot admit a reset, initialization, clock or source event');
  h.processor.dspBinding.instanceSetMidiClock = clock;
  h.processor.dspAssetCache.get(1).get(0).operationRevision = 4;
  h.render();
  assert.equal(h.scheduler.instances.get(1).failed, false);
  assert.equal(h.scheduler.instances.get(1).token, 4);
  assert.ok(h.calls.some(call => call.id === 1), 'A real replacement returns to ordinary native delivery');
});

test('fresh MIDI DSP demand follows actual ready source delivery, clears at EOF, and retains real native tails', () => {
  const h = worklet();
  h.processor.updateMidiPendingDemand();
  assert.equal(h.processor.midiPendingDemand, true, 'A real ready sampler must process its running source');
  h.scheduler.endNotified = true;
  h.processor.updateMidiPendingDemand();
  assert.equal(h.processor.midiPendingDemand, false);
  h.native.set(1, { phase: 3, flags: 1 });
  h.scheduler.playing = false; h.scheduler.instances.get(1).draining = true;
  h.processor.updateMidiPendingDemand();
  assert.equal(h.processor.midiPendingDemand, true, 'An actual native voice tail remains source demand after EOT');
  h.native.set(1, { phase: 0, flags: 0 });
  h.scheduler.endNotified = false; h.scheduler.playing = true;
  h.processor.updateMidiPendingDemand();
  assert.equal(h.processor.midiPendingDemand, false, 'A missing font cannot pin DSP just because the song clock is running');
  h.native.set(1, { phase: 2, flags: 0 });
  h.processor.updateMidiPendingDemand();
  assert.equal(h.processor.midiPendingDemand, false);
  assert.equal(h.processor.sfzPendingDemand, true, 'Only real native bank preparation retains its common preparation demand');
  h.native.set(1, { phase: 3, flags: 0 });
  h.scheduler.retireFailedInstance(1);
  h.processor.updateMidiPendingDemand();
  assert.equal(h.processor.midiPendingDemand, false);
});

for (const type of ['SoundFontPlayerPlugin', 'SFZNotePlayerPlugin']) {
  test(`${type} forwards resident ERROR once even without ordinary UI telemetry`, () => {
    const h = worklet([type]);
    let reads = 0;
    h.processor.dspBinding.telemetryRead = packet => {
      reads++;
      packet[0] = 33;
      return 16;
    };
    h.native.set(1, { phase: 4, flags: 8 });
    h.processor.pollDspAssetStates();
    h.processor.pollDspAssetStates();
    assert.equal(h.messages.filter(message => message.type === 'assetState' && message.state === 4).length, 1);
    assert.equal(h.messages.filter(message => message.type === 'dspTelemetry').length, 1);
    assert.equal(reads, 1);
  });

  test(`${type} stops a failed paged script without a sample-read rejection and retires its pending RPC`, async t => {
    const h = worklet([type]);
    const entry = h.processor.wasmInstances.get(1);
    entry.sfzSampleStream = { generation: 8, operationRevision: 3, replayEpoch: 5 };
    let closed = 0, rejected = 0;
    const plugin = { id: 1, sf: 'bank', constructor: { name: type },
      onWasmAssetRejected() { rejected++; },
      getWasmAssetRevisionDescriptor: () => ({ sampleProviderFactory: async ({ onProvider }) => {
        const provider = { close() { closed++; }, requestPages() { assert.fail('Failed script cannot read samples'); } };
        onProvider(provider);
        h.native.set(1, { phase: 4, flags: 8 });
        return provider;
      } }) };
    const node = { port: { postMessage: message => h.processor.handleSfzSampleStreamControl(message) } };
    const manager = Object.assign({}, audioManagerSfzRuntimeMethods, {
      _requestDspControl: AudioManager.prototype._requestDspControl,
      _settleDspControlResponse: AudioManager.prototype._settleDspControlResponse,
      _cancelPendingDspControlRequests: AudioManager.prototype._cancelPendingDspControlRequests,
      _getActiveDspWorklets: () => [node], _isActiveDspWorklet: target => target === node,
      _wasmAssetMembershipByNode: new Map([[node, new Map([[1, plugin]])]])
    });
    t.after(() => { manager._stopSfzSampleStream(node, 1); manager._cancelPendingDspControlRequests(); });
    h.processor.port.postMessage = message => {
      h.messages.push(message);
      manager._handleSfzRuntimeMessage(node, message);
    };
    await manager._startSfzSampleStream(node, { pluginId: 1, generation: 8, operationRevision: 3, replayEpoch: 5 });
    await Promise.resolve();
    assert.equal(closed, 1);
    assert.equal(rejected, 0);
    assert.equal(manager._pendingDspControlRequests.size, 0);
    assert.equal(manager._sfzSampleStreams.has(node), false);
    assert.equal(h.messages.some(message => message.type === 'assetState' && message.state === 4), true);
    assert.equal(h.messages.some(message => message.type === 'sfzStreamStop' && message.generation === 8), true);
    const count = h.messages.length;
    h.processor.handleSfzSampleStreamControl({ type: 'sfzPollPages', pluginId: 1, generation: 7, requestId: 99 });
    assert.equal(h.messages.length, count + 1, 'Stale stream control only receives a failed ACK');
    assert.equal(h.messages.at(-1).ok, false);
  });
}
