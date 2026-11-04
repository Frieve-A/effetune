import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createNativeMidiPlaybackOwner } from '../helpers/midi-native-playback.mjs';
import { createSf2RuntimeFixture } from '../helpers/sf2-runtime-fixture.mjs';

for (const variant of ['baseline', 'simd']) test(`${variant} mixer edits reach native idle and paused state, survive checkpoint resume, and musical reset clears transient masks`, async () => {
  const fixture = await createSf2RuntimeFixture({ resident: true }), h = await createNativeSamplerWorklet({ variant });
  let owner;
  try {
    fixture.descriptor.operationRevision = 1;
    await h.initialize('SoundFontPlayerPlugin', fixture.descriptor);
    await h.waitForJoinReady();
    // This fixture models an already prepared font. Native ACTIVE alone precedes
    // the new bounded prefix ACK and cannot promise the first note yet.
    await h.waitFor(() => {
      const entry = h.processor.wasmInstances.get(7), snapshot = h.binding.instanceStreamReadiness(entry.id);
      const clock = h.binding.instanceMidiClock(entry.id);
      return snapshot && snapshot.generation === clock.generation && snapshot.scope !== 0 && snapshot.pendingPages === 0 &&
        h.manager.getNativeMixerMetadata(h.manager._wasmAssetMembershipByNode.get(h.node).get(7), h.node).cacheReady;
    });
    const plugin = h.manager._wasmAssetMembershipByNode.get(h.node).get(7);
    assert.equal(await h.manager.sendSoundFontMixerAction(plugin, { type: 'program', channel: 0, bank: 1, program: 1 }), true,
      'An idle ready instrument accepts edits before its first MIDI generation');
    const playback = createNativeMidiPlaybackOwner(h); owner = playback.owner;
    owner.midiTimeline = { duration: 1, events: [
      { seconds: 0, status: 176, data1: 0, data2: 0 },
      { seconds: 0, status: 192, data1: 0, data2: 0 },
      { seconds: 0, status: 144, data1: 60, data2: 127 },
      { seconds: .4, status: 0, data1: 0, data2: 0, systemReset: 1 },
      { seconds: .42, status: 144, data1: 67, data2: 127 }
    ] };
    const advance = async target => {
      let peak = 0;
      for (let blocks = 0; owner.getCurrentMidiTime() < target; blocks++) {
        assert.ok(blocks < 1000, 'Controller edits must not stall processed sample progress');
        for (const value of h.render()[0]) peak = Math.max(peak, Math.abs(value));
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return peak;
    };
    const start = owner.playMidi(); await h.waitFor(() => playback.state.isPlaying); assert.equal(await start, true);
    assert.ok(await advance(.1) > .001);
    const pause = owner.pauseMidi(); await h.waitFor(() => playback.state.isPaused); await pause;
    assert.equal(owner.midiCheckpointAvailable, true);
    const id = h.processor.wasmInstances.get(7).id, clock = h.binding.instanceMidiClock(id);
    const before = h.manager.getSfzRuntimeCheckpoints(h.node)[0];
    assert.ok(before?.bytes.byteLength);
    assert.equal(await h.manager.sendSoundFontMixerAction(plugin, { type: 'control', channel: 0, controller: 7, value: 0 }), true);
    const after = h.manager.getSfzRuntimeCheckpoints(h.node)[0];
    assert.notDeepEqual(after.bytes, before.bytes, 'Resume must use the edited channel checkpoint');
    assert.deepEqual(h.binding.instanceMidiClock(id), clock, 'CONTROL-only editor cannot advance native musical samples');
    // Compare the actual edited checkpoint with an ordinary MIDI CC from the
    // same held-voice checkpoint. SF2 CC7=0 is finite 960cB attenuation, not mute.
    const renderCheckpoint = (checkpoint, ordinaryControl) => {
      assert.equal(h.binding.instanceReadMidiCheckpoint(id, checkpoint.bytes), 0);
      const events = [{ offsetFrames: 0, status: 0, data1: 0, data2: 0, flags: 32, renderFrame: clock.frame }];
      if (ordinaryControl) events.push({ offsetFrames: 0, status: 176, data1: 7, data2: 0 });
      assert.equal(h.binding.instanceSetMidiEvents(id, events, clock.generation), 0);
      const { combined, offsets } = h.binding.getArenaViews(); combined.fill(0);
      assert.equal(h.binding.instanceProcess(id, offsets.combined, 2, 128, h.processor.currentFrame / 48000), 0);
      const pcm = combined.slice(0, 256);
      assert.equal(h.binding.instanceSetMidiEvents(id, [], clock.generation, 16), 0);
      return pcm;
    };
    const ordinaryZero = renderCheckpoint(before, true), editedZero = renderCheckpoint(after, false);
    assert.ok(ordinaryZero.some(value => Math.abs(value) > 1e-10), 'The finite SF2 gain floor is not a silent-success oracle');
    assert.deepEqual(editedZero, ordinaryZero, 'Paused editor plus CP resume must match ordinary CC7 from the same voice state');
    assert.equal(h.binding.instanceReadMidiCheckpoint(id, after.bytes), 0);
    const resume = owner.playMidi(); await h.waitFor(() => playback.state.isPlaying); assert.equal(await resume, true);
    const quietPeak = await advance(.2);
    await h.manager.sendSoundFontMixerAction(plugin, { type: 'control', channel: 0, controller: 7, value: 127 });
    const fullPeak = await advance(.25);
    assert.ok(fullPeak > .001, 'The retained held voice responds to the current controller revision');
    const expectedRatio = 10 ** (-960 / 200);
    assert.ok(Math.abs(quietPeak / fullPeak / expectedRatio - 1) < 1e-5, 'The authored standard CC7 modulator applies 96dB, independently of the measured floor');
    await h.manager.sendSoundFontMixerAction(plugin, { type: 'mute', channel: 0, value: true });
    assert.ok(await advance(.35) < 1e-7);
    assert.ok(await advance(.5) > .001, 'The typed GM reset clears the transient mute and the next note is audible');
    assert.equal(playback.reported, 0);
    assert.equal(h.messages.some(message => message.type === 'midiTransportError'), false, h.errors.join('; '));
  } finally {
    owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
    if (owner) { owner.midiNaturalTail = false; await owner.stopMidi(); }
    await h.close(); await fixture.close();
  }
});
