import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createNativeMidiPlaybackOwner } from '../helpers/midi-native-playback.mjs';
import { compileAcceptanceInstrument } from '../helpers/sfz-native-acceptance.mjs';
import { EventManager } from '../../js/audio/event-manager.js';

for (const variant of ['baseline', 'simd']) test(`${variant} a font loaded while paused without a native checkpoint resumes future notes only`, async () => {
  const previousWindow = globalThis.window;
  globalThis.window = { uiManager: { showTransientMessage() {}, setError() {} } };
  let h, owner;
  try {
    const asset = await compileAcceptanceInstrument('<region> sample=past.wav key=60 amp_veltrack=0 loop_mode=one_shot ampeg_release=.001\n' +
      '<region> sample=future.wav key=67 amp_veltrack=0 loop_mode=one_shot ampeg_release=.001', { samples: new Map([
      ['past.wav', { sampleRate: 48000, channels: [new Float32Array(4800).fill(.25)] }],
      ['future.wav', { sampleRate: 48000, channels: [new Float32Array(4800).fill(.125)] }]
    ]) });
    asset.operationRevision = 1;
    h = await createNativeSamplerWorklet({ variant });
    await h.initialize('SoundFontPlayerPlugin', asset);
    h.manager.runtimeOptions = { externalInput: true };
    h.manager.eventManager = new EventManager(h.manager);
    const plugin = h.manager._wasmAssetMembershipByNode.get(h.node).get(7), font = plugin.sf;
    await h.send({ type: 'clearPluginAsset', pluginId: 7, slot: 0, operationRevision: 1 }); plugin.sf = '';
    const playback = createNativeMidiPlaybackOwner(h); owner = playback.owner;
    owner.midiTimeline = { duration: 1.2, events: [
      { seconds: .01, status: 0xb0, data1: 0, data2: 1 }, { seconds: .01, status: 0xc0, data1: 2, data2: 0 },
      { seconds: .01, status: 0xb0, data1: 101, data2: 0 }, { seconds: .01, status: 0xb0, data1: 100, data2: 0 },
      { seconds: .01, status: 0xb0, data1: 6, data2: 12 }, { seconds: .01, status: 0xb0, data1: 38, data2: 0 },
      { seconds: .02, status: 0x90, data1: 60, data2: 127 }, { seconds: .08, status: 0x80, data1: 60, data2: 0 },
      { seconds: .8, status: 0x90, data1: 67, data2: 127 }, { seconds: .9, status: 0x80, data1: 67, data2: 0 }
    ] };
    const pumpTo = async position => {
      let peak = 0;
      for (let blocks = 0; owner.getCurrentMidiTime() < position; blocks++) {
        assert.ok(blocks < 1000, 'Source clock must keep advancing');
        assert.equal(playback.reported, 0, 'Resume must not fail its transport');
        for (const value of h.render()[0]) peak = Math.max(peak, Math.abs(value));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return peak;
    };
    const play = owner.playMidi(); await h.waitFor(() => playback.state.isPlaying); await play;
    assert.ok(await pumpTo(.35) < 1e-7, 'No-font playback stays silent while its clock advances');
    const pause = owner.pauseMidi(); await h.waitFor(() => playback.state.isPaused); await pause;
    assert.equal(owner.midiCheckpointAvailable, true);
    assert.equal(h.manager.getSfzRuntimeCheckpoints(h.node).length, 0);
    const delivery = [], nativeSend = h.binding.instanceSetMidiEvents.bind(h.binding);
    h.binding.instanceSetMidiEvents = (instance, events, generation, flags = 0, count = events.length) => {
      const result = nativeSend(instance, events, generation, flags, count);
      delivery.push({ flags, result, events: events.slice(0, count).map(event => ({ ...event })) }); return result;
    };
    plugin.sf = font; asset.operationRevision = 2;
    plugin.getWasmAssetRevisionDescriptor = () => asset;
    h.manager._wasmAssetExpectedRevisionsByNode.get(h.node).set('7:0', 2);
    await h.send({ type: 'setPluginAsset', pluginId: 7, slot: 0, ...asset, formatTag: 1 });
    const id = h.processor.wasmInstances.get(7).id;
    await h.waitFor(() => (h.binding.instanceAssetState(id, 0) & 255) === 3);
    for (let count = 0; count < 3; count++) { h.render(); await new Promise(resolve => setTimeout(resolve, 0)); }
    const resume = owner.playMidi(); await h.waitFor(() => playback.state.isPlaying); await resume;
    assert.ok(await pumpTo(.65) < 1e-7, 'Past notes must stay silent');
    assert.ok(await pumpTo(.95) > .01, 'The next future note must actually sound');
    assert.equal(playback.reported, 0); assert.deepEqual(h.errors, []);
    assert.ok(delivery.every(batch => batch.result === 0), 'Every native batch must be accepted');
    assert.ok(!delivery.some(batch => batch.events.some(event => [0x80, 0x90].includes(event.status & 0xf0) && event.data1 === 60)),
      'Do not replay historical musical events, even silently');
    const hydration = delivery.filter(batch => batch.flags === 512).flatMap(batch => batch.events);
    assert.deepEqual(hydration.map(event => [event.status, event.data1, event.data2]),
      owner.midiTimeline.events.slice(0, 6).map(event => [event.status, event.data1, event.data2]));
  } finally {
    owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
    if (owner) { owner.midiNaturalTail = false; await owner.stopMidi(); }
    await h?.close(); globalThis.window = previousWindow;
  }
});
