import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createNativeMidiPlaybackOwner } from '../helpers/midi-native-playback.mjs';
import { createSf2RuntimeFixture } from '../helpers/sf2-runtime-fixture.mjs';

for (const variant of ['baseline', 'simd']) test(`${variant} replacing an already playing bank keeps song samples and joins only future notes with current controllers`, async () => {
  const fixture = await createSf2RuntimeFixture({ resident: true }), h = await createNativeSamplerWorklet({ variant });
  let owner;
  try {
    const asset = fixture.descriptor; asset.operationRevision = 1;
    await h.initialize('SoundFontPlayerPlugin', asset);
    // This fixture models an already prepared font. Native ACTIVE alone precedes
    // the new bounded prefix ACK and cannot promise the first note yet.
    await h.waitFor(() => {
      const entry = h.processor.wasmInstances.get(7), snapshot = h.binding.instanceStreamReadiness(entry.id);
      const clock = h.binding.instanceMidiClock(entry.id);
      return snapshot && snapshot.generation === clock.generation && snapshot.scope !== 0 && snapshot.pendingPages === 0 &&
        h.manager.getNativeMixerMetadata(h.manager._wasmAssetMembershipByNode.get(h.node).get(7), h.node).cacheReady;
    });
    const plugin = h.manager._wasmAssetMembershipByNode.get(h.node).get(7);
    const playback = createNativeMidiPlaybackOwner(h); owner = playback.owner;
    owner.midiTimeline = { duration: 1.2, events: [
      { seconds: 0, status: 176, data1: 0, data2: 1 },
      { seconds: 0, status: 192, data1: 1, data2: 0 },
      { seconds: 0, status: 176, data1: 7, data2: 110 },
      { seconds: .01, status: 144, data1: 60, data2: 127 },
      { seconds: .8, status: 128, data1: 60, data2: 0 },
      { seconds: .7, status: 144, data1: 67, data2: 127 }
    ].sort((a, b) => a.seconds - b.seconds) };
    const advance = async target => {
      let peak = 0;
      for (let blocks = 0; owner.getCurrentMidiTime() < target; blocks++) {
        assert.ok(blocks < 1000, 'Replacement must preserve processed source progress');
        for (const value of h.render()[0]) peak = Math.max(peak, Math.abs(value));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return peak;
    };
    // Establish this timeline's native prefix before replacing an audible bank.
    const preparation = owner.prepareMidiTransport(0);
    await h.waitFor(() => !owner.midiPreparation); assert.equal(await preparation, true);
    await h.waitForJoinReady();
    const start = owner.playMidi(); await h.waitFor(() => playback.state.isPlaying); assert.equal(await start, true);
    assert.ok(await advance(.2) > .001);
    const id = h.processor.wasmInstances.get(7).id, generation = owner.midiGeneration;
    assert.ok(h.binding.instanceMidiClock(id).frame > 0);
    const before = owner.getCurrentMidiTime(), delivered = [];
    const setEvents = h.binding.instanceSetMidiEvents.bind(h.binding);
    h.binding.instanceSetMidiEvents = (instance, events, generation, flags = 0, count = events.length) => {
      delivered.push({ flags, events: events.slice(0, count).map(event => ({ ...event })) });
      return setEvents(instance, events, generation, flags, count);
    };
    h.manager._wasmAssetExpectedRevisionsByNode.get(h.node).set('7:0', 2);
    await h.send({ type: 'clearPluginAsset', pluginId: 7, slot: 0, operationRevision: 2 });
    await advance(.25);
    asset.operationRevision = 3;
    h.manager._wasmAssetExpectedRevisionsByNode.get(h.node).set('7:0', 3);
    const wire = { ...asset }; delete wire.sampleProviderFactory; delete wire.materializeForContext;
    await h.send({ type: 'setPluginAsset', pluginId: 7, slot: 0, ...wire, formatTag: 1 });
    await h.waitFor(() => (h.binding.instanceAssetState(id, 0) & 255) === 3);
    assert.ok(await advance(.6) < 1e-7, 'A held old note must not be reattacked on the new bank');
    assert.ok(await advance(.78) > .001, 'A future note must play through the replacement bank');
    assert.ok(owner.getCurrentMidiTime() > before); assert.equal(owner.midiGeneration, generation);
    assert.equal(playback.reported, 0);
    assert.equal(h.messages.some(message => message.type === 'midiTransportError'), false, h.errors.join('; '));
    const ordinary = delivered.filter(batch => batch.flags === 0).flatMap(batch => batch.events);
    assert.deepEqual(ordinary.filter(event => (event.status & 240) === 144 && event.data2).map(event => event.data1), [67]);
    const hydrated = delivered.filter(batch => batch.flags === 512).flatMap(batch => batch.events);
    assert.ok(hydrated.some(event => event.status === 192 && event.data1 === 1));
    assert.ok(hydrated.some(event => event.status === 176 && event.data1 === 7 && event.data2 === 110));
  } finally {
    owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
    if (owner) { owner.midiNaturalTail = false; await owner.stopMidi(); }
    await h.close(); await fixture.close();
  }
});
