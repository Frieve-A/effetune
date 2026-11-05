import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createSf2RuntimeFixture } from '../helpers/sf2-runtime-fixture.mjs';

for (const variant of ['baseline', 'simd']) test(`${variant} delayed valid sample pages commit MIDI once, report a gap and recover without replacing the font`, async () => {
  const fixture = await createSf2RuntimeFixture({ sampleFrames: 131072, loopStart: 98304,
    loopEnd: 122880, latePage: 20 }), h = await createNativeSamplerWorklet({ variant });
  try {
    await h.initialize('SoundFontPlayerPlugin', fixture.descriptor);
    const timeline = { duration: 3.2, events: [
      { seconds: 0, status: 144, data1: 60, data2: 127 },
      { seconds: 2.2, status: 128, data1: 60, data2: 0 },
      { seconds: 2.6, status: 144, data1: 64, data2: 127 },
      { seconds: 3, status: 128, data1: 64, data2: 0 }
    ] };
    await h.send({ type: 'midiTransport', timeline, generation: 1, position: 0, anchorFrame: h.processor.currentFrame,
      speed: 1, gain: 1, playing: false, preparing: true });
    await h.waitFor(() => h.messages.some(message => message.type === 'midiPrepared'));
    const id = h.processor.wasmInstances.get(7).id, delivered = [];
    const send = h.binding.instanceSetMidiEvents.bind(h.binding);
    h.binding.instanceSetMidiEvents = (instance, events, generation, flags = 0, count = events.length) => {
      if (flags === 0) delivered.push(...events.slice(0, count).map(event => ({ ...event })));
      return send(instance, events, generation, flags, count);
    };
    await h.waitFor(() => {
      const readiness = h.binding.instanceStreamReadiness(id);
      return readiness?.scope === 1 && readiness.pendingPages === 0 && readiness.readyAheadFrames > 0;
    });
    fixture.blockLateReads();
    await h.send({ type: 'midiStart', generation: 1, anchorFrame: h.processor.currentFrame });
    // Advance virtual audio to page demand before timing the real worker read.
    const demandQuanta = Math.ceil(timeline.events[1].seconds * h.context.sampleRate / 128);
    for (let block = 0; h.binding.instanceStreamReadiness(id).pendingPages === 0; block++) {
      assert.ok(block < demandQuanta, 'The active first note must demand its next sample window');
      h.render();
      await Promise.resolve();
    }
    await h.waitFor(() => fixture.lateReadWaiting, { timeout: 5000, renderQuanta: false });
    const before = h.processor.currentFrame;
    for (let block = 0; block < 600; block++) { h.render(); await Promise.resolve(); }
    assert.equal(h.processor.currentFrame, before + 600 * 128, 'A pending page does not stall or catch up source samples');
    assert.equal(h.binding.instanceAssetState(id, 0) & 255, 3);
    assert.equal(h.messages.some(message => message.type === 'midiTransportError'), false);
    assert.ok(h.messages.some(message => message.type === 'sfzSampleAvailability' && message.cause === 'sampleUnavailable'));
    assert.equal(h.processor.midiScheduler.instances.get(7).clockFrame, h.binding.instanceMidiClock(id).frame);
    fixture.releaseLateReads();
    let audible = false;
    for (let block = 0; h.processor.midiScheduler.currentPosition(h.processor.currentFrame) < 2.85; block++) {
      assert.ok(block < 1500, 'Publication must recover without a new transport');
      const output = h.render()[0];
      if (h.processor.midiScheduler.currentPosition(h.processor.currentFrame) > 2.75)
        audible ||= output.some(value => Math.abs(value) > .001);
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    const musical = delivered.filter(event => [128, 144].includes(event.status & 240));
    assert.deepEqual(musical.map(event => [event.status, event.data1]), [[144, 60], [128, 60], [144, 64]]);
    assert.ok(audible, 'The future note after publication must really sound');
    const availability = h.messages.filter(message => message.type === 'sfzSampleAvailability');
    assert.ok(availability.some((message, index) => message.cause === 'available' &&
      availability.slice(0, index).some(previous => previous.cause === 'sampleUnavailable')));
    assert.ok(availability.every(message => message.latched === false));
    assert.equal(h.binding.instanceAssetState(id, 0) & 255, 3);
    assert.equal(h.messages.some(message => message.type === 'midiTransportError'), false);
  } finally { fixture.releaseLateReads(); await h.close(); await fixture.close(); }
});
