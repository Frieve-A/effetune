import assert from 'node:assert/strict';
import test from 'node:test';
import { createSf2RuntimeFixture } from '../helpers/sf2-runtime-fixture.mjs';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';

test('streamed SoundFont supply follows render progress when renderer timers are delayed', async t => {
  for (const variant of ['baseline', 'simd']) await t.test(variant, async t => {
    const fixture = await createSf2RuntimeFixture();
    const h = await createNativeSamplerWorklet({ variant, sampleRate: 96000, channels: 4 });
    const timer = globalThis.setTimeout;
    try {
      fixture.descriptor.operationRevision = 1;
      await h.initialize('SoundFontPlayerPlugin', fixture.descriptor);
      await h.send({ type: 'midiTransport', timeline: { duration: 2, events: [
        { seconds: 0, status: 0x90, data1: 60, data2: 127 }
      ] }, position: 0, speed: 1, gain: 1, generation: 1, preparing: true, mode: 'reset' });
      await h.waitFor(() => h.messages.some(message => message.type === 'midiPrepared'));
      await h.waitForJoinReady();
      // Emulate a background timer clamp without delaying MessagePort delivery,
      // source reads or audio rendering. This is independent of file contents.
      t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) =>
        timer(callback, delay === 10 ? 1000 : delay, ...args));
      await h.send({ type: 'midiStart', generation: 1, anchorFrame: h.frame + 128 });
      const end = h.frame + 96000;
      let energy = 0;
      while (h.frame < end) {
        const output = h.render()[0];
        if (h.frame > end - 9600) energy += output.reduce((sum, value) => sum + value * value, 0);
        const id = h.processor.wasmInstances.get(7).id;
        assert.equal(h.binding.instanceAssetState(id, 0) & 255, 3,
          'Delayed UI timers must not starve an otherwise responsive sample provider');
        assert.equal(h.manager._wasmAssetStatesByNode.get(h.node).get('7:0') & 255, 3);
        await new Promise(resolve => timer(resolve, 1));
      }
      assert.ok(energy > .01, 'The streamed loop remains audible after the initial source window');
      assert.deepEqual(h.errors, []);
    } finally { t.mock.restoreAll(); await h.close(); await fixture.close(); }
  });
});

test('a prepared same-font song change warms cold high-note samples before its new generation starts', async t => {
  for (const variant of ['baseline', 'simd']) await t.test(variant, async () => {
    const fixture = await createSf2RuntimeFixture();
    const h = await createNativeSamplerWorklet({ variant, sampleRate: 96000, channels: 4 });
    const factory = fixture.descriptor.sampleProviderFactory;
    fixture.descriptor.sampleProviderFactory = async options => {
      const provider = await factory(options);
      for (const name of ['readPage', 'readPages']) {
        const read = provider.worker[name].bind(provider.worker);
        provider.worker[name] = async (...args) => {
          await new Promise(resolve => setTimeout(resolve, 60));
          return read(...args);
        };
      }
      return provider;
    };
    try {
      fixture.descriptor.operationRevision = 1;
      await h.initialize('SoundFontPlayerPlugin', fixture.descriptor);
      const transport = { type: 'midiTransport', timeline: { duration: 2, events: [] },
        position: 0, speed: 1, gain: 1, generation: 1, playing: true, mode: 'reset' };
      await h.send(transport);
      h.render();
      await h.send({ ...transport, timeline: { duration: 2, events: [
        { seconds: 0, status: 0x90, data1: 96, data2: 127 }
      ] }, generation: 2, playing: false, preparing: true });
      await h.waitFor(() => h.messages.some(message => message.type === 'midiPrepared' && message.generation === 2));
      await h.waitForJoinReady();
      await h.send({ type: 'midiStart', generation: 2, anchorFrame: h.frame + 1920 });
      const end = h.frame + 96000;
      let energy = 0;
      while (h.frame < end) {
        const output = h.render()[0];
        energy += output.reduce((sum, value) => sum + value * value, 0);
        const id = h.processor.wasmInstances.get(7).id;
        assert.equal(h.binding.instanceAssetState(id, 0) & 255, 3);
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      assert.ok(energy > .01);
      assert.deepEqual(h.errors, []);
    } finally { await h.close(); await fixture.close(); }
  });
});
