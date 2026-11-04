import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSfz } from '../../js/sfz/parser.js';
import { packSfzAsset } from '../../js/sfz/asset.js';
import { compileSfzScript } from '../../js/sfz/script-compiler.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createNativeMidiPlaybackOwner } from '../helpers/midi-native-playback.mjs';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { createSf2RuntimeFixture } from '../helpers/sf2-runtime-fixture.mjs';

async function instrument(frames = 4096, scripted = true) {
  const { regions } = await parseSfz({ selectedPath: 'authored.sfz',
    readText: async () => '<region> sample=tone.wav key=60 loop_mode=loop_continuous', onDiagnostic: null });
  const script = compileSfzScript('on init declare %bad[1] if (%CC[7] # 23) message(%bad[2]) end if end on\n' +
    'on controller play_note(60,127,-1,1000000) end on');
  return packSfzAsset(regions, new Map([['tone.wav', { channels: [new Float32Array(frames).fill(.25)], sampleRate: 48000 }]]),
    { script: scripted ? script : null });
}

async function advanceTo(h, owner, seconds, onBlock = null) {
  for (let blocks = 0; blocks < 1000 && owner.getCurrentMidiTime() < seconds; blocks++) {
    const output = h.render()[0];
    onBlock?.(output);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.ok(owner.getCurrentMidiTime() >= seconds, 'Instrument availability must not freeze the real song clock');
}

test('clearing a live font reports current ungenerated asset status once, ignoring stale source and node identities', async () => {
  const notices = [];
  await withGlobals({ window: { uiManager: { showTransientMessage: (...args) => notices.push(args) } } }, async () => {
    const h = await createNativeSamplerWorklet(), asset = await instrument(4096, false);
    let owner;
    try {
      asset.operationRevision = 1;
      await h.initialize('SoundFontPlayerPlugin', asset);
      const playback = createNativeMidiPlaybackOwner(h);
      owner = playback.owner;
      const playing = owner.playMidi();
      await h.waitFor(() => playback.state.isPlaying);
      assert.equal(await playing, true);
      await advanceTo(h, owner, .1);
      assert.equal(notices.length, 0);
      const active = new Set([h.node]);
      h.manager._getActiveDspWorklets = () => active;
      h.manager._isActiveDspWorklet = node => active.has(node);
      const stale = { type: 'assetState', pluginId: 7, slot: 0, state: 0, operationRevision: 1, replayEpoch: null };
      h.processor.port.postMessage({ ...stale, operationRevision: 2 });
      h.processor.port.postMessage({ ...stale, replayEpoch: 1 });
      await Promise.resolve();
      assert.equal(notices.length, 0);
      active.delete(h.node);
      h.processor.port.postMessage(stale);
      await Promise.resolve();
      assert.equal(notices.length, 0, 'A retired worklet cannot report the current instrument unavailable');
      active.add(h.node);
      const before = owner.getCurrentMidiTime(), generation = owner.midiGeneration, anchor = owner.midiAnchorTime;
      h.manager._wasmAssetMembershipByNode.get(h.node).get(7).sf = '';
      await h.send({ type: 'clearPluginAsset', pluginId: 7, slot: 0, operationRevision: 1 });
      assert.equal(h.messages.findLast(message => message.type === 'assetState').generation, undefined);
      assert.equal(notices.length, 1, 'The genuine asset-status packet must be handled before the MIDI generation guard');
      for (let block = 0; block < 20; block++) { h.render(); await new Promise(resolve => setTimeout(resolve, 0)); }
      assert.ok(owner.getCurrentMidiTime() > before);
      assert.equal(playback.state.isPlaying, true);
      assert.equal(playback.reported, 0);
      assert.equal(owner.midiGeneration, generation);
      assert.equal(owner.midiAnchorTime, anchor);
      assert.equal(notices.length, 1);
      assert.equal(h.messages.some(message => message.type === 'midiTransportError'), false);
    } finally {
      owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
      if (owner) { owner.midiNaturalTail = false; await owner.stopMidi(); }
      await h.close();
    }
  });
});

test('a late SF2 join inherits sixteen-channel Bank Select, Program Change, CC and RPN0 state exactly like normal playback', async () => {
  const render = async late => {
    const bank = await createSf2RuntimeFixture({ resident: true }), h = await createNativeSamplerWorklet();
    let owner;
    try {
      bank.descriptor.operationRevision = 1;
      await h.initialize('SoundFontPlayerPlugin', bank.descriptor);
      const plugin = h.manager._wasmAssetMembershipByNode.get(h.node).get(7);
      if (late) {
        await h.send({ type: 'clearPluginAsset', pluginId: 7, slot: 0, operationRevision: 1 });
        plugin._pending = new Promise(() => {});
      }
      const playback = createNativeMidiPlaybackOwner(h);
      owner = playback.owner;
      if (!late) await h.waitFor(() => !h.manager.getSfzSamplePreparation(plugin, h.node));
      const messages = [];
      const message = (status, data1, data2 = 0) => messages.push({ seconds: 0, status, data1, data2 });
      for (let channel = 0; channel < 16; channel++) {
        for (const [cc, value] of [[0, 1], [32, 0], [7, 90 + channel], [11, 100], [101, 0], [100, 0], [6, 12]]) {
          message(0xb0 | channel, cc, value);
        }
        message(0xc0 | channel, 1); message(0xe0 | channel, 0, 72);
      }
      const past = late ? [{ seconds: .01, status: 0x90, data1: 60, data2: 127 }] : [];
      owner.midiTimeline = { duration: 1.5, events: [...messages, ...past,
        ...Array.from({ length: 16 }, (_, channel) => ({ seconds: .7, status: 0x90 | channel, data1: 60, data2: 100 }))] };
      const playing = owner.playMidi();
      await h.waitFor(() => playback.state.isPlaying);
      assert.equal(await playing, true);
      const generation = owner.midiGeneration, anchor = owner.midiAnchorTime;
      if (late) {
        await advanceTo(h, owner, .25);
        plugin._pending = null;
        bank.descriptor.operationRevision = 2;
        h.manager._wasmAssetExpectedRevisionsByNode.get(h.node).set('7:0', 2);
        h.manager._wasmAssetStatesByNode.get(h.node).set('7:0', 1);
        const wire = { ...bank.descriptor }; delete wire.sampleProviderFactory;
        await h.send({ type: 'setPluginAsset', pluginId: 7, slot: 0, ...wire, formatTag: 1 });
      }
      const first = Math.round(anchor * 48000) + Math.round(.7 * 48000), pcm = new Float32Array(2048);
      for (let blocks = 0; h.frame < first + pcm.length && blocks < 1000; blocks++) {
        const blockFrame = h.frame, output = h.render()[0];
        for (let frame = 0; frame < output.length; frame++) {
          const index = blockFrame + frame - first;
          if (index >= 0 && index < pcm.length) pcm[index] = output[frame];
          else if (late && blockFrame + frame < first) assert.ok(Math.abs(output[frame]) < 1e-7, 'No old held note is reattacked');
        }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      assert.ok(h.frame >= first + pcm.length);
      assert.ok(pcm.some(value => Math.abs(value) > .001));
      assert.equal(owner.midiGeneration, generation);
      assert.equal(owner.midiAnchorTime, anchor);
      assert.equal(playback.reported, 0);
      return pcm;
    } finally {
      owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
      if (owner) { owner.midiNaturalTail = false; await owner.stopMidi(); }
      await h.close(); await bank.close();
    }
  };
  const expected = await render(false), actual = await render(true);
  for (let frame = 0; frame < expected.length; frame++) {
    assert.ok(Math.abs(actual[frame] - expected[frame]) < 1e-6,
      `Sixteen-channel future PCM differs from normal channel-state playback at frame ${frame}`);
  }
});

for (const [variant, availability] of [['baseline', 'no-player'], ['simd', 'unloaded'], ['baseline', 'loading']]) {
  test(`live ${availability} MIDI keeps its clock and joins only future notes (${variant})`, async () => {
    const notices = [];
    await withGlobals({ window: { uiManager: { showTransientMessage: (...args) => notices.push(args) } } }, async () => {
      const h = await createNativeSamplerWorklet({ variant }), asset = await instrument();
      let owner;
      try {
        asset.operationRevision = 1;
        const defaults = await h.initialize('SoundFontPlayerPlugin', asset);
        const membership = h.manager._wasmAssetMembershipByNode.get(h.node), plugin = membership.get(7);
        const packer = DSP_PARAM_PACKERS.get('SoundFontPlayerPlugin');
        const wirePlugin = { id: 7, type: 'SoundFontPlayerPlugin', enabled: true, parameters: defaults,
          inputBus: 0, outputBus: 0, channel: 'A', wasmParams: packer.pack(defaults), wasmParamsHash: packer.hash };
        await h.send({ type: 'clearPluginAsset', pluginId: 7, slot: 0, operationRevision: 1 });
        if (availability === 'no-player') {
          await h.send({ type: 'updatePlugins', plugins: [], masterBypass: false });
          membership.clear();
        } else if (availability === 'unloaded') plugin.sf = '';
        else plugin._pending = new Promise(() => {});
        const playback = createNativeMidiPlaybackOwner(h);
        owner = playback.owner;
        let ended = 0;
        owner.handleTrackEnded = () => { ended++; owner.midiNaturalTail = false; void owner.stopMidi(); };
        owner.midiTimeline = { duration: 1, events: [
          { seconds: 0, status: 0xb0, data1: 7, data2: 23 },
          { seconds: .01, status: 0x90, data1: 60, data2: 127 },
          { seconds: .7, status: 0x90, data1: 60, data2: 127 },
          { seconds: .9, status: 0x80, data1: 60, data2: 0 }
        ] };
        assert.equal(await owner.playMidi(), true);
        assert.equal(playback.state.isPlaying, true);
        assert.equal(notices.length, 1);
        await owner.prepareMidiInstruments();
        assert.equal(notices.length, 1, 'Preparation/status refresh cannot spam the same song');
        await advanceTo(h, owner, .25, output => assert.ok(output.every(value => Math.abs(value) < 1e-7)));
        assert.equal(ended, 0, 'An unavailable instrument is not a queue skip or a track end');
        assert.equal(playback.reported, 0);
        const pause = owner.pauseMidi();
        await h.waitFor(() => playback.state.isPaused);
        await pause;
        assert.equal(playback.state.isStopped, false);
        assert.equal(owner.midiCheckpointAvailable, true, 'An empty unavailable-source capture still preserves continuity');
        const pausedPosition = owner.getCurrentMidiTime();
        const resume = owner.playMidi();
        await h.waitFor(() => playback.state.isPlaying);
        assert.equal(await resume, true);
        assert.equal(owner.midiPosition, pausedPosition);
        await advanceTo(h, owner, .35, output => assert.ok(output.every(value => Math.abs(value) < 1e-7)));
        const generation = owner.midiGeneration, anchor = owner.midiAnchorTime;
        plugin.sf = defaults.sf; plugin._pending = null;
        membership.set(7, plugin);
        h.manager.pipelineA = [plugin];
        asset.operationRevision = 2;
        plugin.getWasmAssetRevisionDescriptor = () => asset;
        h.manager._wasmAssetExpectedRevisionsByNode.get(h.node).set('7:0', 2);
        h.manager._wasmAssetStatesByNode.get(h.node).set('7:0', 1);
        await h.send({ type: 'updatePlugins', plugins: [wirePlugin], masterBypass: false });
        await h.send({ type: 'setPluginAsset', pluginId: 7, slot: 0, ...asset, formatTag: 1 });
        assert.equal(h.binding.instanceAssetState(h.processor.wasmInstances.get(7).id, 0) & 255, 2,
          'The real staged bank is PREPARING while the existing song continues');
        const preparingPosition = owner.getCurrentMidiTime();
        const preparingFrame = h.processor.currentFrame;
        await h.waitFor(() => (h.binding.instanceAssetState(h.processor.wasmInstances.get(7).id, 0) & 255) === 3);
        assert.ok(h.processor.currentFrame > preparingFrame);
        assert.ok(h.processor.midiScheduler.currentPosition(h.processor.currentFrame) > preparingPosition);
        assert.ok(owner.getCurrentMidiTime() >= preparingPosition, 'Coalesced UI receipts never extrapolate between completed blocks');
        await advanceTo(h, owner, .65, output => assert.ok(output.every(value => Math.abs(value) < 1e-7),
          'Past held note and controller callbacks cannot sound'));
        const id = h.processor.wasmInstances.get(7).id;
        assert.equal(h.binding.instanceMidiState(id) & 15, 0, 'Init sees hydrated CC without a historical generated note');
        const future = [];
        await advanceTo(h, owner, .8, output => future.push(...output));
        assert.ok(future.some(value => Math.abs(value) > .001), 'The subsequent real MIDI Note On must sound');
        assert.equal(owner.midiGeneration, generation);
        assert.equal(owner.midiAnchorTime, anchor);
        assert.equal(h.messages.some(message => message.type === 'midiConfigurationChanged' || message.type === 'midiTransportError'), false);
        assert.equal(playback.reported, 0);
        for (let block = 0; block < 1000; block++) {
          if (ended) break;
          h.render(); await new Promise(resolve => setTimeout(resolve, 0));
        }
        assert.equal(ended, 1, 'The actual song end still runs the normal queue-end callback once');
        assert.equal(playback.state.isStopped, true);
      } finally {
        owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
        if (owner) { owner.midiNaturalTail = false; await owner.stopMidi(); }
        await h.close();
      }
    });
  });
}
