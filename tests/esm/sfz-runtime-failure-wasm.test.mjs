import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset, packStreamedSfzAsset } from '../../js/sfz/asset.js';
import { compileSfzScript } from '../../js/sfz/script-compiler.js';
import { AudioEncoder } from '../../js/audio/audio-encoder.js';
import { createSfzSampleProviderFactory } from '../../js/sfz/sample-page-provider.js';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createNativeMidiPlaybackOwner } from '../helpers/midi-native-playback.mjs';
import { createSampleWorkerPool } from '../helpers/sf2-runtime-fixture.mjs';

// Requires the coherent C1 native candidate and generated worklet. No fallback
// disguises old artifacts which retain ACTIVE or audible voices after a fault.
const script = compileSfzScript('on init declare %values[1] declare $index := 2 end on\n' +
  'on note wait(20000) message(%values[$index]) end on');
for (const [variant, failedBranch] of [['baseline', 'A'], ['simd', 'B']]) test(`two real ${variant} worklets resume with selected ${failedBranch} retired and the other actual worklet healthy`, async t => {
  const healthyBank = await fixture(false, false), failedBank = await fixture(false);
  const a = await createNativeSamplerWorklet({ variant }), b = await createNativeSamplerWorklet({ variant });
  const healthy = failedBranch === 'A' ? b : a, failed = failedBranch === 'A' ? a : b;
  let owner;
  try {
    healthyBank.asset.operationRevision = failedBank.asset.operationRevision = 1;
    await healthy.initialize('SoundFontPlayerPlugin', healthyBank.asset);
    await failed.initialize('SoundFontPlayerPlugin', failedBank.asset);
    while (a.frame < b.frame) a.render();
    while (b.frame < a.frame) b.render();
    const playback = createNativeMidiPlaybackOwner(a, [b], t);
    owner = playback.owner;
    a.manager.currentPipeline = failedBranch;
    const pump = async predicate => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, 'Both production worklets must finish the owner transaction');
        a.render(); b.render();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    };
    const playing = owner.playMidi();
    await pump(() => playback.state.isPlaying);
    assert.equal(await playing, true);
    await pump(() => (failed.binding.instanceMidiState(failed.processor.wasmInstances.get(7).id) & 8) !== 0);
    for (let block = 0; block < 50; block++) { a.render(); b.render(); await new Promise(resolve => setTimeout(resolve, 0)); }
    assert.equal(playback.reported, 0, 'The real owner keeps the healthy current target playing');
    assert.equal(a.manager.getCurrentPipeline().length, 1, 'The real selected-pipeline getter must not flatten active memberships');
    assert.equal(a.manager.getCurrentPipeline()[0], a.manager._wasmAssetMembershipByNode.get(failed.node).get(7));
    assert.equal(a.manager._wasmAssetMembershipByNode.get(failed.node).get(7)._runtimeAssetErrorRevision, 1,
      'The production epoch-filtered plugin callback records the terminal source revision');
    assert.equal(playback.state.isPlaying, true);
    assert.equal(a.processor.midiScheduler.playing, true);
    assert.equal(b.processor.midiScheduler.playing, true, 'An instrument fault cannot freeze the shared song clock');
    assert.equal(a.processor.midiScheduler.currentPosition(a.frame), b.processor.midiScheduler.currentPosition(b.frame));
    const pause = owner.pauseMidi();
    await pump(() => !playback.state.isPlaying);
    await pause;
    assert.equal(playback.state.isPaused, true);
    assert.equal(playback.state.isStopped, false);
    assert.equal(owner.midiGeneration, 2);
    const position = a.messages.findLast(message => message.type === 'midiPauseReady').position;
    assert.ok(position > .1);
    assert.equal(b.messages.findLast(message => message.type === 'midiPauseReady').position, position);
    assert.equal(owner.midiPosition, position);
    assert.equal(owner.getMidiCheckpointForNode(healthy.node).length, 1);
    assert.equal(owner.getMidiCheckpointForNode(failed.node).length, 0);
    const resumed = owner.playMidi();
    await pump(() => playback.state.isPlaying);
    assert.equal(await resumed, true);
    for (let block = 0; block < 32; block++) { a.render(); b.render(); await new Promise(resolve => setTimeout(resolve, 0)); }
    assert.equal(healthy.binding.instanceMidiState(healthy.processor.wasmInstances.get(7).id) & 1, 1,
      'The healthy captured voice is reattacked by the real checkpoint resume');
    assert.equal(a.processor.midiScheduler.mode, 'resume');
    assert.equal(b.processor.midiScheduler.mode, 'resume');
    assert.equal(a.processor.midiScheduler.currentPosition(a.frame), b.processor.midiScheduler.currentPosition(b.frame));
    assert.equal(failed.binding.instanceMidiState(failed.processor.wasmInstances.get(7).id) & 15, 8);
    assert.equal(failed.messages.filter(message => message.type === 'midiTransportError').length, 1);
    assert.equal(playback.reported, 0);
  } finally {
    owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
    if (owner) { owner.midiNaturalTail = false; await owner.stopMidi(); }
    await a.close(); await b.close(); await healthyBank.close(); await failedBank.close();
  }
});

test('the last working main failure pauses the real owner despite a retired same-revision READY replay', async t => {
  const delayedFailure = compileSfzScript('on init declare %values[1] declare $index := 2 end on\n' +
    'on note wait(500000) message(%values[$index]) end on');
  const bankA = await fixture(false, true, delayedFailure), bankB = await fixture(false);
  const a = await createNativeSamplerWorklet(), b = await createNativeSamplerWorklet();
  let owner;
  try {
    bankA.asset.operationRevision = bankB.asset.operationRevision = 1;
    await a.initialize('SoundFontPlayerPlugin', bankA.asset);
    await b.initialize('SoundFontPlayerPlugin', bankB.asset);
    while (a.frame < b.frame) a.render();
    while (b.frame < a.frame) b.render();
    const playback = createNativeMidiPlaybackOwner(a, [b], t);
    owner = playback.owner;
    const pump = async predicate => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        assert.ok(Date.now() < deadline, 'The real aggregate failure pause must complete');
        a.render(); b.render();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    };
    const playing = owner.playMidi();
    await pump(() => playback.state.isPlaying);
    assert.equal(await playing, true);
    const pluginB = a.manager._wasmAssetMembershipByNode.get(b.node).get(7);
    await pump(() => pluginB._runtimeAssetErrorRevision === 1);
    assert.equal(playback.reported, 0);
    // Replay the authored immutable bank under the SAME user operation, as an
    // internal graph/kernel rebind can do. This must not revive its source fact.
    await b.send({ type: 'setPluginAsset', pluginId: 7, slot: 0, ...bankB.asset, formatTag: 1 });
    await pump(() => a.manager.getEffectiveActiveWasmAssetSnapshot(pluginB, [0], { primaryWorklet: b.node }).ready);
    assert.equal(b.binding.instanceAssetState(b.processor.wasmInstances.get(7).id, 0) & 255, 3);
    assert.equal(pluginB._runtimeAssetErrorRevision, 1);
    assert.equal(owner.hasHealthyMidiInstruments(), true, 'A remains the genuinely working survivor');
    const pluginA = a.manager._wasmAssetMembershipByNode.get(a.node).get(7);
    await pump(() => pluginA._runtimeAssetErrorRevision === 1);
    assert.equal(owner.hasHealthyMidiInstruments(), false, 'Replayed READY B cannot hide the last working target failure');
    await pump(() => playback.state.isPaused);
    assert.equal(playback.state.isPlaying, false);
    assert.equal(playback.state.isStopped, false);
    assert.equal(playback.reported, 1);
    assert.equal(owner.midiGeneration, 2);
    assert.equal(owner.midiCheckpointRequest, null);
    assert.equal(a.messages.filter(message => message.type === 'midiTransportError').length, 1);
    assert.equal(b.messages.filter(message => message.type === 'midiTransportError').length, 1);
    assert.equal(a.messages.findLast(message => message.type === 'midiPauseReady').position,
      b.messages.findLast(message => message.type === 'midiPauseReady').position);
    assert.equal(b.binding.instanceMidiState(b.processor.wasmInstances.get(7).id) & 7, 0);
    assert.equal(a.binding.instanceMidiState(a.processor.wasmInstances.get(7).id) & 15, 8);
    await assert.rejects(owner.prepareMidiInstruments(), /instrument stopped playing/);
  } finally {
    owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
    if (owner) { owner.midiNaturalTail = false; await owner.stopMidi(); }
    await a.close(); await b.close(); await bankA.close(); await bankB.close();
  }
});

async function fixture(paged, scripted = true, program = scripted ? script : null) {
  const { regions } = await parseSfz({ selectedPath: 'test.sfz',
    readText: async () => '<region> sample=tone.wav key=60 loop_mode=loop_continuous', onDiagnostic: null });
  const pcm = new Float32Array(4096).fill(.25), sampleRate = 48000;
  if (!paged) return { asset: packSfzAsset(regions, new Map([['tone.wav', { channels: [pcm], sampleRate }]]), { script: program }),
    async close() {} };
  const workers = createSampleWorkerPool();
  try {
    const blob = new AudioEncoder().encodeWav({ numberOfChannels: 1, length: pcm.length, sampleRate,
      getChannelData: () => pcm }, 'float32');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const factory = await createSfzSampleProviderFactory({ assetId: 'a'.repeat(24), paths: ['tone.wav'],
      workerFactory: workers.workerFactory, createReader: async () => ({ size: bytes.length, revision: 'authored-script-fault',
        readRange: async (start, length) => bytes.slice(start, start + length) }) });
    const asset = packStreamedSfzAsset(regions, new Map([['tone.wav', factory.samples[0]]]), { script: program, cacheSlots: 4 });
    asset.sampleProviderFactory = async context => {
      const provider = await factory(context);
      await provider.preload([{ sample: 0, pageIndex: 0 }]);
      return provider;
    };
    return { asset, close: () => workers.close() };
  } catch (error) { await workers.close(); throw error; }
}

for (const variant of ['baseline', 'simd']) for (const paged of [false, true]) {
  test(`SFZ ${variant} ${paged ? 'paged' : 'resident'} live script failure after wait cancels playback and reaches the current UI asset`, async t => {
    const bank = await fixture(paged), h = await createNativeSamplerWorklet({ variant });
    let owner;
    try {
      bank.asset.operationRevision = 1;
      await h.initialize('SoundFontPlayerPlugin', bank.asset);
      const playback = createNativeMidiPlaybackOwner(h, [], t);
      owner = playback.owner;
      let diagnostics = 0;
      h.node.port.addEventListener('message', ({ data }) => {
        if (data.type !== 'dspTelemetry') return;
        // Inspect before the real harness returns this packet to the worklet pool.
        const packet = new DataView(data.packet);
        for (let at = 0; at + 16 <= data.bytes;) {
          const length = packet.getUint16(at + 12, true);
          if (packet.getUint16(at, true) === 33) diagnostics++;
          at += (16 + length + 3) & ~3;
        }
      });
      const playing = owner.playMidi();
      await h.waitFor(() => playback.state.isPlaying);
      assert.equal(await playing, true);
      assert.equal(owner.midiHasInstruments, true, 'Real preflight must find the selected current main player');
      await h.waitFor(() => (h.binding.instanceMidiState(h.processor.wasmInstances.get(7).id) & 8) !== 0,
        { timeout: 5000 });
      for (let block = 0; block < 100; block++) {
        h.render();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const id = h.processor.wasmInstances.get(7).id;
      assert.equal(h.binding.instanceAssetState(id, 0) & 255, 4);
      assert.equal(h.binding.instanceMidiState(id) & 8, 8, 'The native failure stays sticky through pause/capture');
      assert.equal(h.binding.instanceMidiState(id) & 7, 0);
      assert.ok(h.render()[0].every(sample => Math.abs(sample) < 1e-7),
        'The established sampler silence bound includes the intentional 1e-19 denormal floor');
      assert.equal(playback.state.isPlaying, false, 'Real pause/capture must complete instead of feeding back into a new error');
      assert.equal(playback.state.isPaused, true);
      assert.equal(owner.midiCheckpointRequest, null);
      assert.equal(h.processor.midiCapturePending, false);
      assert.equal(h.processor.midiScheduler.pauseRequest, null);
      assert.equal(h.processor.midiScheduler.playing, false);
      assert.equal(h.messages.filter(message => message.type === 'midiPauseReady').length, 1);
      assert.equal(h.messages.filter(message => message.type === 'midiCheckpoints').length, 1);
      assert.equal(playback.reported, 1);
      assert.equal(owner.midiGeneration, 2, 'Only initial playback and one pause transaction advance the owner generation');
      assert.equal(h.messages.filter(message => message.type === 'assetState' && message.state === 4).length, 1);
      assert.equal(h.messages.filter(message => message.type === 'midiTransportError').length, 1);
      assert.equal(diagnostics, 1, 'The bounded terminal diagnostic reaches Console transport once');
      assert.equal(h.errors.some(message => message.includes('Asset rejected: sample-read')), false);
      assert.equal(h.manager._pendingDspControlRequests?.size ?? 0, 0);
      assert.equal(h.manager._sfzSampleStreams?.get(h.node)?.has(7) ?? false, false);

      // Recovery requires a real replacement asset, not a cleared JS error flag
      // or another command against the failed immutable bank.
      const replacement = await fixture(false, false);
      Object.assign(replacement.asset, await h.materializeAsset('SoundFontPlayerPlugin', replacement.asset));
      replacement.asset.operationRevision = 2;
      const plugin = h.manager._getSfzRuntimePlugin(h.node, 7);
      plugin.getWasmAssetRevisionDescriptor = () => replacement.asset;
      h.manager._wasmAssetExpectedRevisionsByNode.get(h.node).set('7:0', 2);
      h.manager._wasmAssetStatesByNode.get(h.node).set('7:0', 1);
      await h.send({ type: 'setPluginAsset', pluginId: 7, slot: 0, ...replacement.asset, formatTag: 1 });
      await h.waitFor(() => h.manager.getEffectiveActiveWasmAssetSnapshot(plugin, [0], { primaryWorklet: h.node }).ready);
      const retry = owner.playMidi();
      await h.waitFor(() => playback.state.isPlaying);
      assert.equal(await retry, true);
      const recovered = [];
      for (let block = 0; block < 32; block++) {
        recovered.push(...h.render()[0]);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const recoveredId = h.processor.wasmInstances.get(7).id;
      assert.equal(h.binding.instanceMidiState(recoveredId) & 8, 0);
      assert.equal(h.binding.instanceMidiState(recoveredId) & 1, 1);
      assert.ok(recovered.some(sample => Math.abs(sample) > 1e-4), 'A real new bank can sound after explicit playback');
      assert.equal(owner.midiGeneration, 3);
      assert.equal(h.messages.filter(message => message.type === 'midiTransportError').length, 1);
    } finally {
      owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
      if (owner) { owner.midiNaturalTail = false; await owner.stopMidi(); }
      await h.close(); await bank.close();
    }
  });
}
