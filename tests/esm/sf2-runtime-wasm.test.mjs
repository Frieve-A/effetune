import { createAcceptanceCostWorkerPool } from '../helpers/sfz-native-acceptance.mjs';
import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs/promises';
import { OfflineProcessor } from '../../js/audio/offline-processor.js';
import { AudioEncoder } from '../../js/audio/audio-encoder.js';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createNativeMidiPlaybackOwner } from '../helpers/midi-native-playback.mjs';
import { createSf2RuntimeFixture, createSampleWorkerPool } from '../helpers/sf2-runtime-fixture.mjs';
import { parseSfz } from '../../js/sfz/parser.js';
import { packStreamedSfzAsset } from '../../js/sfz/asset.js';
import { createSfzSampleProviderFactory } from '../../js/sfz/sample-page-provider.js';

const costWorkers = createAcceptanceCostWorkerPool();
let previousWorker;
before(() => {
  previousWorker = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  Object.defineProperty(globalThis, 'Worker', { configurable: true, writable: true, value: costWorkers.Worker });
});
after(async () => {
  try { await costWorkers.close(); } finally {
    if (previousWorker) Object.defineProperty(globalThis, 'Worker', previousWorker);
    else delete globalThis.Worker;
  }
});

const MAIN = 'SoundFontPlayerPlugin';
const RATE = 48000;
const event = (seconds, status, data1, data2 = 0) => ({ seconds, status, data1, data2 });
const cc = (seconds, channel, number, value) => event(seconds, 0xb0 | channel, number, value);
const rms = values => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0) / values.length);
function frequency(values) {
  let crossings = 0;
  for (let index = 1; index < values.length; index++) if (values[index - 1] <= 0 && values[index] > 0) crossings++;
  return crossings * RATE / values.length;
}

async function start(h, timeline, generation) {
  await h.send({ type: 'midiTransport', timeline, generation, position: 0, playing: false,
    preparing: true, anchorFrame: h.frame, speed: 1, gain: 1 });
  await h.waitFor(() => h.messages.some(message => message.type === 'midiPrepared' && message.generation === generation));
  await h.waitForJoinReady();
  const origin = h.frame + 128;
  await h.send({ type: 'midiStart', generation, anchorFrame: origin });
  return origin;
}

async function capture(h, origin, seconds) {
  const result = [[], []], end = origin + Math.ceil(seconds * RATE);
  while (h.frame < end) {
    const at = h.frame, output = h.render();
    for (let index = Math.max(0, origin - at); index < 128 && at + index < end; index++) {
      result[0].push(output[0][index]); result[1].push(output[1][index]);
    }
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  return result.map(values => Float32Array.from(values));
}
const span = (audio, channel, from, to) => audio[channel].subarray(Math.ceil(from * RATE), Math.floor(to * RATE));

async function createOffsetFixture() {
  const parsed = await parseSfz({ selectedPath: 'offset.sfz', onDiagnostic: null, readText: async () =>
    '<region> sample=tone.wav key=60 offset=10000 end=19999 loop_mode=loop_continuous loop_start=10000 loop_end=19999 amp_veltrack=0\n' +
    '<region> sample=tone.wav key=61 direction=reverse offset=10000 end=19999 loop_mode=loop_continuous loop_start=10000 loop_end=19999 amp_veltrack=0' });
  const pcm = Float32Array.from({ length: 20000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * frame / 64));
  const bytes = new Uint8Array(await new AudioEncoder().encodeWav({ numberOfChannels: 1,
    length: pcm.length, sampleRate: RATE, getChannelData: () => pcm }, 'float32').arrayBuffer());
  const workers = createSampleWorkerPool();
  try {
    const factory = await createSfzSampleProviderFactory({ assetId: 'a'.repeat(24), paths: ['tone.wav'],
      createReader: () => ({ size: bytes.length, revision: 'authored-offset-fixture',
        readRange: async (offset, length) => bytes.slice(offset, offset + length) }), workerFactory: workers.workerFactory });
    const descriptor = packStreamedSfzAsset(parsed.regions, new Map([['tone.wav', factory.samples[0]]]),
      { cacheSlots: 4, maxBytes: 1024 * 1024 });
    descriptor.sampleProviderFactory = async options => {
      const provider = await factory(options);
      try { await provider.preload([{ sample: 0, pageIndex: 2 }, { sample: 0, pageIndex: 4 }]); return provider; }
      catch (error) { provider.close(); throw error; }
    };
    return { descriptor, close: () => workers.close() };
  } catch (error) { await workers.close(); throw error; }
}

class SoundFontPlayerPlugin {
  static executionCapabilities = { requiresWasm: true };
  constructor(asset) { this.id = 7; this.enabled = true; this.channel = 'A'; this.asset = asset; this.sf = 'a'.repeat(24); }
  getParameters() { return { enabled: true, sf: this.sf, mc: 0, pl: 64, og: 0, inputBus: 0, outputBus: 0, channel: 'A',
    ...Object.fromEntries(Array.from({ length: 16 }, (_, channel) => [`sp${channel}`, -1])) }; }
  getWasmAssets() { return new Map([[0, this.asset]]); }
  async createOfflineDspState() { return { parameters: this.getParameters(), assets: this.getWasmAssets(), offlineDspAssetRequired: true }; }
}
function midiFile() {
  const track = [0, 0x90, 60, 127, 0x8f, 0x50, 0x80, 60, 0, 0, 255, 47, 0];
  const bytes = Uint8Array.from([77, 84, 104, 100, 0, 0, 0, 6, 0, 0, 0, 1, 3, 232,
    77, 84, 114, 107, 0, 0, 0, track.length, ...track]);
  return { name: 'authored.mid', size: bytes.length, arrayBuffer: async () => bytes.slice().buffer };
}

test('authored SF2 acceptance source preserves all presets and pressure modulators without an audio runtime', async () => {
  const fixture = await createSf2RuntimeFixture();
  try {
    assert.deepEqual(fixture.source.compiled.presets.map(preset => [preset.bank, preset.program]), [[0, 0], [1, 1], [128, 0], [128, 1]]);
    assert.equal(fixture.source.samples.length, 1);
    assert.equal(new Uint32Array(fixture.descriptor.payload, 32)[1], 9);
    for (const region of fixture.source.compiled.regions) {
      assert.ok(region.modulators.some(modulator => modulator.source === 13 && modulator.destination === 48));
      assert.ok(region.modulators.some(modulator => modulator.source === 10 && modulator.destination === 48));
    }
  } finally { await fixture.close(); }
});

for (const variant of ['baseline', 'simd']) {
  test(`SF2 ${variant} one collection keeps16 channel programs, volume and born presets independent`, async () => {
    const fixture = await createSf2RuntimeFixture(), h = await createNativeSamplerWorklet({ variant });
    try {
      await h.initialize(MAIN, fixture.descriptor);
      const events = [];
      for (let channel = 0; channel < 16; channel++) events.push(cc(0, channel, 0, channel % 2),
        cc(0, channel, 32, 0), event(0, 0xc0 | channel, channel % 2),
        cc(0, channel, 10, channel % 2 ? 127 : 0), cc(0, channel, 7, 127), event(0, 0x90 | channel, 60, 127));
      events.push(cc(.2, 0, 7, 0), cc(.3, 1, 0, 0), event(.3, 0xc1, 0),
        cc(.4, 0, 7, 127), event(.45, 0x81, 60), event(.5, 0x91, 60, 127));
      events.sort((a, b) => a.seconds - b.seconds);
      const origin = await start(h, { duration: 1, events }, 1), audio = await capture(h, origin, .7);
      const left = rms(span(audio, 0, .1, .18)), right = rms(span(audio, 1, .1, .18));
      assert.ok(left > 1e-4 && right > 1e-4);
      assert.ok(left / right > 3.8 && left / right < 4.2, 'all8 even and8 odd channels use their own bank/program');
      assert.ok(rms(span(audio, 0, .23, .28)) / left > .84 && rms(span(audio, 0, .23, .28)) / left < .91,
        'CC7 on channel1 removes exactly one of its8 left voices');
      assert.ok(Math.abs(rms(span(audio, 1, .23, .28)) / right - 1) < .03, 'the other15 channel states remain intact');
      assert.ok(Math.abs(rms(span(audio, 1, .33, .38)) / right - 1) < .03, 'a held voice keeps its born preset after bank/PC changes');
      assert.ok(rms(span(audio, 1, .56, .64)) / right > 1.3, 'the next onset uses the newly selected preset');
      const afterProgram = rms(span(audio, 1, .56, .64));
      const plugin = h.manager._getSfzRuntimePlugin(h.node, 7);
      assert.equal(await h.manager.sendSoundFontMixerAction(plugin,
        { type: 'program', channel: 1, bank: 1, program: 1 }), true);
      const held = [];
      for (let block = 0; block < 20; block++) { held.push(...h.render()[1]); await new Promise(resolve => setTimeout(resolve, 1)); }
      assert.equal(h.processor.midiScheduler.generation, 1);
      assert.equal(h.processor.midiScheduler.playing, true);
      assert.ok(Math.abs(rms(held) / afterProgram - 1) < .05, 'a mixer patch change also preserves already sounding voices');
      const overrideOrigin = await start(h, { duration: .3, events: [cc(0, 1, 0, 0), event(0, 0xc1, 0),
        cc(0, 1, 10, 127), cc(0, 1, 7, 127), event(0, 0x91, 60, 127)] }, 2);
      const overrideAudio = await capture(h, overrideOrigin, .2);
      const overrideRatio = rms(span(overrideAudio, 1, .08, .16)) / right;
      assert.ok(overrideRatio > .48 && overrideRatio < .52,
        `the next song clears the transient mixer patch and follows bank0/program0 (ratio=${overrideRatio})`);
      assert.equal(h.processor.wasmInstances.size, 1);
      assert.equal(h.binding.memoryGrowthViolation, false);
    } finally { await h.close(); await fixture.close(); }
  });

  test(`SF2 ${variant} every MIDI channel owns sustain, RPN bend and both pressure sources`, async () => {
    const fixture = await createSf2RuntimeFixture(), h = await createNativeSamplerWorklet({ variant });
    try {
      await h.initialize(MAIN, fixture.descriptor);
      const events = [];
      for (let channel = 0; channel < 16; channel++) {
        const at = channel * .5;
        events.push(cc(at, channel, 0, 0), event(at, 0xc0 | channel, 0), cc(at, channel, 10, 64),
          event(at, 0x90 | channel, 60, 127), cc(at + .06, channel, 64, 127), event(at + .07, 0x80 | channel, 60),
          cc(at + .11, channel, 64, 0), event(at + .17, 0x90 | channel, 60, 127),
          cc(at + .21, channel, 101, 0), cc(at + .21, channel, 100, 0), cc(at + .21, channel, 6, 12),
          cc(at + .21, channel, 38, 0), event(at + .21, 0xe0 | channel, 127, 127),
          event(at + .28, 0xd0 | channel, 127), event(at + .34, 0xa0 | channel, 60, 127), event(at + .4, 0x80 | channel, 60));
      }
      const origin = await start(h, { duration: 8, events }, 1), audio = await capture(h, origin, 8);
      for (let channel = 0; channel < 16; channel++) {
        const at = channel * .5, level = rms(span(audio, 0, at + .02, at + .05));
        assert.ok(level > 1e-4, `channel${channel + 1} sounds`);
        assert.ok(rms(span(audio, 0, at + .08, at + .1)) > level * .8, 'sustain retains the released key');
        assert.ok(rms(span(audio, 0, at + .14, at + .16)) < level * .01, 'pedal up ends only that channel ownership');
        const before = frequency(span(audio, 0, at + .18, at + .205));
        const bent = frequency(span(audio, 0, at + .24, at + .27));
        assert.ok(bent / before > 1.8 && bent / before < 2.2, 'RPN12 semitones controls its own pitch bend range');
        const normal = rms(span(audio, 0, at + .24, at + .27));
        const pressure = rms(span(audio, 0, at + .30, at + .33));
        assert.ok(pressure < normal * .4 && pressure > normal * .1, 'channel pressure evaluates the authored SF2 route');
        assert.ok(rms(span(audio, 0, at + .36, at + .39)) < pressure * .4, 'poly pressure evaluates independently');
      }
    } finally { await h.close(); await fixture.close(); }
  });

  test(`SF2 ${variant} streamed loop output equals the same whole collection with every sample page resident`, async () => {
    const outputs = [];
    for (const resident of [false, true]) {
      const fixture = await createSf2RuntimeFixture({ resident }), h = await createNativeSamplerWorklet({ variant });
      try {
        await h.initialize(MAIN, fixture.descriptor);
        const origin = await start(h, { duration: 1.1, events: [event(0, 0x90, 60, 127), event(1, 0x80, 60)] }, 1);
        outputs.push(await capture(h, origin, 1.2));
      } finally { await h.close(); await fixture.close(); }
    }
    assert.deepEqual(outputs[0], outputs[1], 'paging may not change source positions, sample loops or complete rendered quanta');
    assert.ok(rms(span(outputs[0], 0, .7, .9)) > 1e-4, 'audio remains continuous far beyond the resident onset');
  });

  test(`SF2 ${variant} a first wrap inside one page is independent of MIDI span boundaries`, async () => {
    const outputs = [];
    for (const subdivide of [false, true]) {
      const fixture = await createSf2RuntimeFixture({ resident: true, loopStart: 257, loopEnd: 1786 });
      const h = await createNativeSamplerWorklet({ variant, sampleRate: 96000 });
      try {
        await h.initialize(MAIN, fixture.descriptor);
        const binding = h.binding, instance = h.processor.wasmInstances.get(7).id;
        assert.equal(binding.instanceSetMidiEvents(instance, [], 1, 1), 0);
        assert.equal(binding.instanceSetMidiClock(instance, 0, 1, 1), 0);
        const output = new Float32Array(40 * 128 * 2);
        for (let block = 0; block < 40; block++) {
          const events = block ? [] : [
            { offsetFrames: 0, status: 0xb0, data1: 91, data2: 0 },
            { offsetFrames: 0, status: 0xb0, data1: 93, data2: 0 },
            { offsetFrames: 0, status: 0x90, data1: 60, data2: 127, noteId: 1 }
          ];
          // This controller is absent from the authored fixture's routes. It
          // subdivides rendering without changing the voice's sound.
          if (subdivide) for (let frame = 0; frame < 128; frame++)
            events.push({ offsetFrames: frame, status: 0xb0, data1: 119, data2: 0 });
          assert.equal(binding.instanceSetMidiEvents(instance, events, 1, 0), 0);
          const arena = binding.getArenaViews();
          arena.combined.fill(0);
          assert.equal(binding.instanceProcess(instance, arena.offsets.combined, 2, 128, block * 128 / 96000), 0);
          output.set(arena.combined.subarray(0, 256), block * 256);
        }
        assert.equal(binding.instanceMidiClock(instance).frame, 40 * 128);
        assert.equal(binding.instanceAssetState(instance, 0) & 255, 3);
        outputs.push(output);
      } finally { await h.close(); await fixture.close(); }
    }
    assert.deepEqual(outputs[0], outputs[1]);
  });

  test(`SF2 ${variant} the production owner preserves a paged held voice across pause, resume and a running seek`, async () => {
    const fixture = await createSf2RuntimeFixture(), h = await createNativeSamplerWorklet({ variant });
    let owner;
    try {
      fixture.descriptor.operationRevision = 1;
      await h.initialize(MAIN, fixture.descriptor);
      const playback = createNativeMidiPlaybackOwner(h);
      owner = playback.owner;
      const state = playback.state;
      owner.midiTimeline = { duration: 2, events: [event(0, 0x90, 60, 127), event(1.5, 0x80, 60)] };
      const preparation = owner.prepareMidiTransport(0);
      await h.waitFor(() => !owner.midiPreparation); assert.equal(await preparation, true);
      await h.waitForJoinReady();
      let playing = owner.playMidi();
      await h.waitFor(() => state.isPlaying); assert.equal(await playing, true);
      for (let block = 0; block < 64; block++) { h.render(); await new Promise(resolve => setTimeout(resolve, 1)); }
      const pause = owner.pauseMidi();
      await h.waitFor(() => !owner.midiCheckpointRequest); await pause;
      assert.equal(state.isPaused, true); assert.equal(owner.midiCheckpointAvailable, true);
      const id = h.processor.wasmInstances.get(7).id, frozen = h.binding.instanceMidiClock(id).frame;
      for (let block = 0; block < 40; block++) { h.render(); await new Promise(resolve => setTimeout(resolve, 1)); }
      assert.equal(h.binding.instanceMidiClock(id).frame, frozen);
      playing = owner.playMidi();
      await h.waitFor(() => state.isPlaying); assert.equal(await playing, true);
      const resumed = [];
      for (let block = 0; block < 40; block++) { resumed.push(...h.render()[0]); await new Promise(resolve => setTimeout(resolve, 1)); }
      assert.ok(rms(resumed) > 1e-4); assert.ok(h.binding.instanceMidiClock(id).frame > frozen);
      let complete = false;
      const seek = owner.seekMidi(.7).then(() => { complete = true; });
      await h.waitFor(() => complete); await seek;
      assert.equal(h.processor.midiScheduler.position, .7, 'history readiness retains its authoritative seek target');
      const sought = [];
      for (let block = 0; block < 40; block++) { sought.push(...h.render()[0]); await new Promise(resolve => setTimeout(resolve, 1)); }
      assert.ok(rms(sought) > 1e-4, 'the paged sample still sounds after its loop and running seek');
      assert.equal(h.binding.memoryGrowthViolation, false);
    } finally {
      owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
      if (owner) { owner.midiNaturalTail = false; await owner.stopMidi(); }
      await h.close(); await fixture.close();
    }
  });

  test(`streamed ${variant} CP3 new-graph resume forecasts the real nonzero sample offset in a tight cache`, async () => {
    const fixture = await createOffsetFixture(), first = await createNativeSamplerWorklet({ variant });
    let second, owner;
    try {
      fixture.descriptor.operationRevision = 1;
      await first.initialize(MAIN, fixture.descriptor);
      const playback = createNativeMidiPlaybackOwner(first);
      owner = playback.owner;
      let playing = owner.playMidi();
      await first.waitFor(() => playback.state.isPlaying); assert.equal(await playing, true);
      for (let block = 0; block < 20; block++) { first.render(); await new Promise(resolve => setTimeout(resolve, 1)); }
      const pause = owner.pauseMidi();
      await first.waitFor(() => !owner.midiCheckpointRequest); await pause;
      assert.equal(owner.midiCheckpointAvailable, true);
      const manager = first.manager, plugin = manager._getSfzRuntimePlugin(first.node, 7);
      manager.beginSfzRuntimeGraphMigration();
      await first.close();
      second = await createNativeSamplerWorklet({ variant });
      second.adoptPlannedManager(manager, plugin);
      owner.audioPlayer.audioContext = second.context;
      manager._expectWasmAssetOperation(second.node, plugin.id, 0, fixture.descriptor.operationRevision);
      second.node.port.addEventListener('message', ({ data }) => {
        if (data.type === 'assetState') manager._updateWasmAssetState(second.node, data.pluginId, data.slot,
          data.state, data.operationRevision, data.replayEpoch);
      });
      await second.initialize(MAIN, fixture.descriptor);
      await second.waitFor(() => manager._sfzRuntimeStartedByNode?.get(second.node)?.has(plugin.id));
      assert.equal(await manager.waitForSfzRuntimeStarts(), true);
      manager.finishSfzRuntimeGraphMigration();
      playing = owner.playMidi();
      await second.waitFor(() => playback.state.isPlaying, { timeout: 5000 });
      assert.equal(await playing, true);
      const audio = [];
      for (let block = 0; block < 64; block++) { audio.push(...second.render()[0]); await new Promise(resolve => setTimeout(resolve, 1)); }
      const requested = second.messages.filter(message => message.type === 'sfzStreamRequests').flatMap(message => message.requests);
      assert.ok(requested.some(request => request.pageIndex === 3), 'restored playback needs the actual middle source page');
      assert.equal(requested.some(request => request.pageIndex < 2), false, 'default0/1 forecast pages would starve a4-slot cache');
      assert.ok(rms(audio.slice(2048)) > 1e-4, 'resumed audio remains continuous beyond resident onset page2');
      assert.equal(second.errors.some(message => message.includes('Asset rejected')), false);
    } finally {
      owner?.midiCheckpointRequest?.finish(false); owner?.midiPreparation?.finish(false);
      await second?.close(); await first.close(); await fixture.close();
    }
  });

  test(`SF2 ${variant} the actual Note detector plays the selected whole-collection preset`, async () => {
    const fixture = await createSf2RuntimeFixture(), h = await createNativeSamplerWorklet({ variant });
    try {
      await h.initialize('SFZNotePlayerPlugin', fixture.descriptor, { th: .5, vf: -30, vc: 3, mn: 28, mx: 91,
        pl: 32, dm: 0, wm: 100, dt: 'Classic', nh: 0, sp0: 129 });
      const audio = [];
      for (let block = 0; block < 375; block++) {
        const signal = Float32Array.from({ length: 128 }, (_, frame) =>
          .25 * Math.sin(2 * Math.PI * 440 * (h.frame + frame) / RATE));
        const output = h.render(signal);
        if (block > 180) audio.push(...output[0]);
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      assert.ok(rms(audio) > 1e-4, 'a real detected A4 must produce SF2 sample audio');
      assert.ok(frequency(audio) > 1100 && frequency(audio) < 1400,
        'the authored sample transposes from root60 to detected69 rather than passing the440Hz input through');
      assert.equal(h.binding.memoryGrowthViolation, false);
    } finally { await h.close(); await fixture.close(); }
  });

  test(`SF2 ${variant} a current late read failure retires its provider and acknowledgements even after MIDI Stop`, async () => {
    const fixture = await createSf2RuntimeFixture({ sampleFrames: 262144, loopStart: 196608,
      loopEnd: 245760, latePage: 32 }), h = await createNativeSamplerWorklet({ variant });
    try {
      await h.initialize(MAIN, fixture.descriptor);
      fixture.blockLateReads();
      const timeline = { duration: 5, events: [event(0, 0x90, 60, 127)] };
      await start(h, timeline, 1);
      const id = h.processor.wasmInstances.get(7).id;
      const demandQuanta = Math.ceil(timeline.duration * RATE / 128);
      for (let block = 0; !fixture.lateReadWaiting; block++) {
        assert.ok(block < demandQuanta, 'The active note must demand the authored late sample page');
        h.render();
        await Promise.resolve();
        if (h.binding.instanceStreamReadiness(id).pendingPages)
          await h.waitFor(() => fixture.lateReadWaiting || h.binding.instanceStreamReadiness(id).pendingPages === 0,
            { timeout: 5000, renderQuanta: false });
      }
      await h.send({ type: 'midiTransport', generation: 2, position: 0, playing: false });
      fixture.failLateRead();
      await h.waitFor(() => !h.manager._sfzSampleStreams?.get(h.node)?.has(7), { timeout: 5000 });
      assert.equal(h.manager._pendingDspControlRequests?.size ?? 0, 0);
      assert.ok(h.errors.includes('Asset rejected: sample-read'));
      assert.equal(h.errors.some(message => message.includes('unsupported')), false,
        'a source I/O failure cannot be reported as an unsupported instrument');
      for (let block = 0; block < 8; block++) h.render();
      assert.ok(h.render()[0].every(value => Math.abs(value) < 1e-7), 'terminal failure cannot leave a partially advanced sample voice');
    } finally { fixture.failLateRead(); await h.close(); await fixture.close(); }
  });

  test(`SF2 ${variant} offline paged rendering exactly matches the same collection with all pages resident`, async () => {
    const filename = `effetune-dsp${variant === 'simd' ? '.simd' : ''}.wasm`;
    const bytes = await fs.readFile(new URL(`../../plugins/dsp/${filename}`, import.meta.url));
    const meta = JSON.parse(await fs.readFile(new URL('../../plugins/dsp/effetune-dsp.meta.json', import.meta.url)));
    const outputs = [];
    for (const resident of [false, true]) {
      const fixture = await createSf2RuntimeFixture({ resident });
      try {
        const processor = new OfflineProcessor({ audioContext: { sampleRate: RATE,
          decodeAudioData() { assert.fail('MIDI cannot enter audio decoding'); } },
        createOfflineContext() { return { createBuffer(channels, length, sampleRate) {
          const data = Array.from({ length: channels }, () => new Float32Array(length));
          return { numberOfChannels: channels, length, sampleRate, duration: length / sampleRate,
            getChannelData: channel => data[channel] };
        } }; } }, new AudioEncoder(), { getModuleInfo: async () => ({ bytes, meta, paramPackers: DSP_PARAM_PACKERS }),
          instantiateDsp, warning: message => assert.fail(message) });
        await withGlobals({ window: { audioPreferences: { useWasmDsp: true, outputChannels: 2 } } }, async () => {
          const result = await processor.processAudioFile(midiFile(), [new SoundFontPlayerPlugin(fixture.descriptor)], null,
            { format: 'wav', sampleRate: RATE, wavSampleFormat: 'float32' });
          outputs.push(new Uint8Array(await result.blob.arrayBuffer()));
        });
      } finally { await fixture.close(); }
    }
    assert.deepEqual(outputs[0], outputs[1], 'NEED_SAMPLE must not duplicate or advance any part of an offline quantum');
    const wav = new DataView(outputs[0].buffer);
    assert.ok(wav.getUint32(40, true) >= RATE * 8);
    assert.ok(Array.from({ length: 128 }, (_, frame) =>
      Math.abs(wav.getFloat32(44 + (Math.floor(.9 * RATE) + frame) * 8, true))).some(value => value > 1e-5),
      'the encoded output remains audible beyond the onset and through sample loops');
  });

  test(`SF2 ${variant} bounded16 channel64 voice native worklet cost is reported against48k/128frame budget`, async t => {
    const fixture = await createSf2RuntimeFixture({ resident: true }), h = await createNativeSamplerWorklet({ variant });
    try {
      await h.initialize(MAIN, fixture.descriptor);
      const events = Array.from({ length: 64 }, (_, index) => event(0, 0x90 | index % 16, 60 + Math.floor(index / 16), 100));
      await start(h, { duration: 10, events }, 1);
      assert.equal(h.binding.instanceSetTap(h.processor.wasmInstances.get(7).id, 7), 0);
      assert.equal(h.binding.setTelemetryRate(60), 0);
      for (let block = 0; block < 32; block++) { h.render(); await Promise.resolve(); }
      assert.equal(h.voicesSeen, 64, 'performance must measure64 actual voices, not only64 requested onsets');
      assert.equal(h.binding.setTelemetryRate(0), 0);
      const times = [];
      for (let block = 0; block < 256; block++) { const began = performance.now(); h.render(); times.push(performance.now() - began); }
      times.sort((a, b) => a - b);
      const averageMs = times.reduce((a, b) => a + b, 0) / times.length;
      t.diagnostic(JSON.stringify({ sampleRate: RATE, blockFrames: 128, midiChannels: 16, audioChannels: 2, voices: 64,
        actualVoices: h.voicesSeen, telemetryDuringMeasurement: false,
        quanta: times.length, averageMs, p95Ms: times[Math.floor(times.length * .95)],
        realtimeFactor: averageMs / (128 / RATE * 1000), environment: 'Node native-WASM production worklet', hardPerformanceGate: false }));
      assert.equal(h.binding.memoryGrowthViolation, false);
      assert.ok(h.render()[0].every(Number.isFinite));
    } finally { await h.close(); await fixture.close(); }
  });
}
