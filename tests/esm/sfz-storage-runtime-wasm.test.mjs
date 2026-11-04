import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createSampleWorkerPool } from '../helpers/sf2-runtime-fixture.mjs';
import { parseSfz } from '../../js/sfz/parser.js';
import { prepareStreamedSfzBank } from '../../js/sfz/streamed-bank.js';
import { createSfzFileSampleReader } from '../../js/sfz/sample-reader.js';
import { samplePlayerPreparationData } from '../../js/sfz/effect-cost.js';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';

function sampleFile() {
  const frames = 16384, bytes = new Uint8Array(44 + frames * 2), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('RIFF'), 0); view.setUint32(4, bytes.length - 8, true);
  bytes.set(new TextEncoder().encode('WAVEfmt '), 8); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 48000, true);
  view.setUint32(28, 96000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  bytes.set(new TextEncoder().encode('data'), 36); view.setUint32(40, frames * 2, true);
  for (let frame = 0; frame < frames; frame++) view.setInt16(44 + frame * 2, Math.round(14000 * Math.sin(frame * Math.PI / 32)), true);
  return new File([bytes], 'shared.wav', { lastModified: 0 });
}

for (const variant of ['baseline', 'simd']) test(`${variant} mixed sample storage configures real native streaming and plays both shared-source variants`,
  { timeout: 15000 }, async () => {
    const h = await createNativeSamplerWorklet({ variant }), workers = createSampleWorkerPool();
    const suffix = variant === 'simd' ? '.simd' : '';
    const control = await instantiateDspBinding(await fs.readFile(new URL(`../../plugins/dsp/effetune-dsp${suffix}.wasm`, import.meta.url)));
    try {
      const reader = await createSfzFileSampleReader(sampleFile());
      const parsed = await parseSfz({ selectedPath: 'mixed.sfz', hasSample: () => true, onDiagnostic: null,
        readText: async () => '<group> sample=shared.wav amp_veltrack=0 loop_mode=loop_continuous loop_start=0 loop_end=16383 ' +
          '<region> key=60 load_mode=1 load_start=4095 load_end=4096 ' +
          '<region> key=61 load_mode=0 load_start=8191 load_end=8192' });
      const context = { sampleRate: 48000, processingChannels: 2, maxFrames: 128, minimumPhysicalBpm: 0 };
      let captures = 0, queries = 0;
      const prepared = await prepareStreamedSfzBank({ id: 'b'.repeat(24), parsed, maxBytes: 16 * 1024 * 1024,
        createSampleReader: () => { captures++; return reader; }, preparationContext: context,
        estimateEffectBytes(payload, target, format) {
          queries++;
          const { control: prefix, payloadBytes } = samplePlayerPreparationData(payload);
          return control.estimateSfzEffectPreparation(prefix, target, format, payloadBytes);
        }
      }, { workerFactory: workers.workerFactory, persistentCache: null });
      assert.equal(queries, 1); assert.equal(captures, 2); // Loop metadata, then one reader shared by both variants.
      assert.equal(prepared.sampleCount, 2);
      const asset = prepared.descriptor;
      assert.equal(new Uint32Array(asset.payload, 32)[1], 10);
      assert.equal(asset.footprintBytes, asset.payload.byteLength +
        control.estimateSfzEffectPreparation(asset.payload, context, 1, asset.payload.byteLength));
      await h.initialize('SoundFontPlayerPlugin', asset);
      const entry = h.processor.wasmInstances.get(7), provider = h.manager._sfzSampleStreams.get(h.node).get(7).provider;
      assert.ok(entry.sfzSampleStream.supplyPort);
      assert.deepEqual(provider.samples.map(sample => sample.storageMode).sort(), [0, 1]);
      assert.notEqual(provider.samples[0].sample, provider.samples[1].sample);
      assert.equal(provider.samples[0].frames, 16384); assert.equal(provider.samples[1].frames, 16384);
      await h.send({ type: 'midiTransport', generation: 1, position: 0, speed: 2, gain: 1, playing: false, preparing: true,
        timeline: { duration: 1, events: [
          { seconds: .05, status: 144, data1: 60, data2: 127 }, { seconds: .15, status: 128, data1: 60, data2: 0 },
          { seconds: .3, status: 144, data1: 61, data2: 127 }, { seconds: .6, status: 128, data1: 61, data2: 0 }
        ] } });
      await h.waitFor(() => {
        const snapshot = h.binding.instanceStreamReadiness(entry.id);
        return snapshot.generation === 1 && h.binding.instanceMidiClock(entry.id).generation === 1 &&
          snapshot.scope === 3 && snapshot.pendingPages === 0;
      });
      const snapshot = h.binding.instanceStreamReadiness(entry.id);
      assert.ok(snapshot.plannedPages > 0); assert.equal(snapshot.readyAheadFrames, 0);
      await h.send({ type: 'midiStart', generation: 1, delayFrames: 0 });
      const energy = [0, 0];
      for (let block = 0; block < 160; block++) {
        const position = h.processor.midiScheduler.currentPosition(h.processor.currentFrame);
        for (const value of h.render()[0]) {
          assert.ok(Number.isFinite(value));
          if (position > .07 && position < .13) energy[0] += value * value;
          if (position > .36 && position < .5) energy[1] += value * value;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      assert.ok(energy[0] > .01, 'Packed sample storage must really sound');
      assert.ok(energy[1] > .01, 'Float sample storage must really sound');
      assert.equal(h.binding.instanceAssetState(entry.id, 0) & 255, 3);
      assert.deepEqual(h.errors, []);
    } finally { control.destroyEngine(); await h.close(); await workers.close(); }
  });
