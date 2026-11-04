import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { packSfzAsset, packStreamedSfzAsset, sfzSampleCacheFootprint, SFZ_REGION_FIELDS, SFZ_TABLE_VERSION } from '../../js/sfz/asset.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { OfflineProcessor } from '../../js/audio/offline-processor.js';

const MiB = 1024 * 1024;

test('SFZ streamed assets carry immutable raw sample identities and bounded cache reservations without PCM', async () => {
  const parsed = await parseSfz({ selectedPath: 'a.sfz',
    readText: async () => '<region> sample=a.wav key=60 offset=16777217 end=16777219 loop_start=16777217 loop_end=16777219 <region> sample=b.wav key=61',
    hasSample: () => true, onDiagnostic: null });
  const samples = new Map([['a.wav', { frames: 2 ** 24 + 7, channels: 2, sampleRate: 44100, revision: 'ff'.repeat(32) }],
    ['b.wav', { frames: 80000, channels: 1, sampleRate: 48000, revision: 'ab'.repeat(32) }]]);
  const descriptor = packStreamedSfzAsset(parsed.regions, samples, { cacheSlots: 8, modulation: parsed.modulation });
  const ints = new Uint32Array(descriptor.payload, 32), table = ints[12];
  assert.equal(ints[1], 8); assert.deepEqual([...ints.slice(13, 16)], [2, 8, 1]);
  assert.equal(ints[4], ints[5]); assert.equal(descriptor.payload.byteLength, 32 + ints[5] * 4);
  assert.deepEqual([...ints.slice(table, table + 4)], [2 ** 24 + 7, 0, 2, 44100]);
  assert.deepEqual([...ints.slice(table + 4, table + 12)], new Array(8).fill(0xffffffff));
  assert.deepEqual([...ints.slice(table + 12, table + 16)], [80000, 0, 1, 48000]);
  assert.equal(ints[16 + SFZ_REGION_FIELDS.indexOf('sampleOffset')], 0);
  assert.equal(ints[16 + SFZ_REGION_FIELDS.length + SFZ_REGION_FIELDS.indexOf('sampleOffset')], 1);
  assert.equal(ints[16 + SFZ_REGION_FIELDS.indexOf('sampleFrames')], 2 ** 24 + 7);
  for (const [key, value] of Object.entries({ offset: 16777217, end: 16777219, loop_start: 16777217, loop_end: 16777219 })) {
    assert.equal(ints[16 + SFZ_REGION_FIELDS.indexOf(key)], value);
  }
  assert.equal(ints[10] + ints[11], table);
  assert.equal(descriptor.footprintBytes, descriptor.payload.byteLength);
  assert.equal(descriptor.sampleCacheBytes, sfzSampleCacheFootprint(2, 8));
  assert.throws(() => packStreamedSfzAsset(parsed.regions, samples,
    { cacheSlots: 8, maxBytes: descriptor.footprintBytes - 1, modulation: parsed.modulation }), { code: 'too-large' });
});

test('SFZ packs integer metadata separately from unchanged floating-point PCM', async () => {
  const { regions } = await parseSfz({ selectedPath: 'a.sfz',
    readText: async () => '<region> sample=a.wav key=60 offset=1 end=2 loop_start=1 loop_end=2',
    hasSample: () => true, onDiagnostic: null });
  const samples = new Map([['a.wav', { sampleRate: 48000,
    channels: [new Float32Array([0.125, -0.25, 0.5])] }]]);
  const descriptor = packSfzAsset(regions, samples);
  const ints = new Uint32Array(descriptor.payload, 32);
  const floats = new Float32Array(descriptor.payload, 32);
  assert.equal(ints[1], SFZ_TABLE_VERSION);
  assert.equal(ints[5], descriptor.samples);
  assert.equal(descriptor.warmupSamples, Math.ceil((2 + 2 + Math.ceil(3 / 32)) / 8));
  for (const [key, value] of Object.entries({ sampleOffset: 0, sampleFrames: 3,
    offset: 1, end: 2, loop_start: 1, loop_end: 2 })) {
    assert.equal(ints[12 + SFZ_REGION_FIELDS.indexOf(key)], value);
  }
  assert.equal(floats[12 + SFZ_REGION_FIELDS.indexOf('sampleRate')], 48000);
  assert.deepEqual([...floats.slice(ints[4])], [0.125, -0.25, 0.5]);
  assert.throws(() => packSfzAsset(regions, samples, { maxBytes: descriptor.footprintBytes - 1 }),
    error => error.code === 'too-large');
  assert.equal(packSfzAsset(regions, samples, { maxBytes: descriptor.footprintBytes }).footprintBytes,
    descriptor.footprintBytes);
  assert.throws(() => packSfzAsset([{ ...regions[0], offset: 0.5 }], samples), /integers/);
});

function budgetHarness() {
  let Processor;
  vm.runInNewContext(fs.readFileSync(new URL('../../plugins/audio-processor.js', import.meta.url), 'utf8'), {
    ArrayBuffer, DataView, Uint8Array, Float32Array, Map, Set,
    AudioWorkletProcessor: class {}, console: { warn() {}, error() {} },
    registerProcessor(name, type) { if (name === 'plugin-processor') Processor = type; }
  });
  const processor = Object.create(Processor.prototype);
  processor.plugins = [
    { id: 1, type: 'SFZNotePlayerPlugin' }, { id: 2, type: 'SFZNotePlayerPlugin' },
    { id: 3, type: 'ConvolverPlugin' }, { id: 4, type: 'ConvolverPlugin' }
  ];
  processor.dspAssetCache = new Map();
  processor.dspDeferredAssetStages = new Map();
  processor.rejections = [];
  processor.rejectDspAssetCandidate = (_id, _slot, reason) => processor.rejections.push(reason);
  processor.shouldDeferDspAssetStage = () => false;
  processor.commitDspAssetCandidate = (id, slot, candidate) => {
    const slots = processor.dspAssetCache.get(id) || new Map();
    slots.set(slot, candidate);
    processor.dspAssetCache.set(id, slots);
  };
  return processor;
}

function submit(processor, pluginId, footprintBytes) {
  const payload = new ArrayBuffer(36);
  const header = new DataView(payload);
  header.setUint32(0, 0x31415445, true);
  header.setUint32(4, 1, true);
  header.setUint32(8, 1, true);
  processor.setPluginAsset({ pluginId, slot: 0, payload, processingChannels: 1, footprintBytes });
}

for (const [version, byteOffset] of [[8, 0], [8, 3], [9, 0], [9, 3]]) test(`worklet v${version} stream control reads a byte payload at offset ${byteOffset} and rejects stale pages`, () => {
  const processor = budgetHarness(), messages = [], calls = [];
  const memory = { buffer: new ArrayBuffer(128) }, entry = { id: 11 };
  processor.port = { postMessage: message => messages.push(message) };
  processor.dspLive = true;
  processor.wasmInstances = new Map([[1, entry]]);
  processor.bufferPool = { combined: { buffer: memory.buffer } };
  processor.dspBinding = { memory,
    instanceSetAsset() { calls.push('commit'); return 0; },
    configureSfzSampleStream(_id, generation) { calls.push(['configure', generation]); return 0; },
    instanceAssetState() { return 2; },
    publishSfzSamplePage(_id, page) { calls.push(['publish', page.generation]); return 0; },
    takeSfzSampleRequests() { return [{ generation: 1, sample: 0, pageIndex: 4 }]; },
    instanceAssetAbort() { calls.push('abort'); }
  };
  processor.postAssetState = () => {};
  processor.refreshDspPipelineForLatencyChange = () => {};
  processor.releaseAssetHold = () => {};
  const payload = new Uint8Array(new ArrayBuffer(96 + byteOffset), byteOffset, 96);
  payload.set([0x45, 0x54]);
  const header = new DataView(payload.buffer, payload.byteOffset + 32, 64);
  header.setUint32(0, 0x53465a, true); header.setUint32(4, version, true);
  header.setUint32(60, version === 9 ? 0x10001 : 1, true);
  const candidate = { payload, operationRevision: 3, replayEpoch: null };
  processor.dspAssetCache.set(1, new Map([[0, candidate]]));
  assert.equal(processor.stageDspAsset(1, 0, candidate), true);
  assert.deepEqual(calls, ['commit', ['configure', 1]]);
  assert.equal(messages[0].type, 'sfzStreamReady');
  processor.handleSfzSampleStreamControl({ type: 'sfzPublishPage', requestId: 1, pluginId: 1,
    generation: 1, operationRevision: 2, replayEpoch: null, page: { generation: 1 } });
  assert.equal(messages.at(-1).ok, false); assert.equal(calls.length, 2);
  processor.handleSfzSampleStreamControl({ type: 'sfzPublishPage', requestId: 2, pluginId: 1,
    generation: 1, operationRevision: 3, replayEpoch: null, page: { generation: 1 } });
  assert.equal(messages.at(-1).ok, true); assert.deepEqual(calls.at(-1), ['publish', 1]);
  processor.handleSfzSampleStreamControl({ type: 'sfzPollPages', requestId: 3, pluginId: 1, generation: 1 });
  assert.equal(messages.at(-1).requests[0].pageIndex, 4);
  processor.handleSfzSampleStreamControl({ type: 'sfzStreamFailed', pluginId: 1, generation: 1 });
  assert.equal(calls.at(-1), 'abort'); assert.equal(entry.sfzSampleStream, null);
  assert.equal(processor.dspAssetCache.has(1), false);
  assert.ok(messages.some(message => message.type === 'sfzStreamStop' && message.generation === 1));
});

function forecastHarness(note = false) {
  const processor = budgetHarness(), messages = [], calls = [], outstanding = new Set();
  const plugin = processor.plugins[0]; plugin.type = note ? 'SFZNotePlayerPlugin' : 'SoundFontPlayerPlugin'; plugin.parameters = {};
  const entry = { id: 11, type: plugin.type, sfzSampleStream: { generation: 7, operationRevision: 3, replayEpoch: null } };
  processor.wasmInstances = new Map([[1, entry]]); processor.dspLive = true; processor.dspSampleRate = 48000;
  processor.currentFrame = 0; processor.sfzNoEvents = []; processor.port = { postMessage: value => messages.push(value) };
  let queue = [], clock = { generation: 0, frame: 0 }, page = 0;
  let readiness = { generation: 0, scope: 0, admittedFrames: 0, readyAheadFrames: 0, plannedPages: 0, pendingPages: 0 };
  processor.dspBinding = {
    instanceAssetState() { return 3; }, instanceMidiState() { return 0; }, instanceMidiClock() { return clock; },
    instanceStreamReadiness() { return readiness; },
    instanceSetMidiEvents(_id, _events, generation, flags) { calls.push(['events', generation, flags]); clock = { ...clock, generation }; return 0; },
    instanceSetMidiClock(_id, frame, generation, flags) { calls.push(['clock', generation, flags]); clock = { generation, frame }; return 0; },
    takeSfzSampleRequests() { const result = queue; queue = []; return result; },
    prefetchSfzSampleStream(_id, events, generation, window, flags, count) {
      calls.push(['forecast', generation, window, flags, count, ...events.slice(0, count).map(event => event.data1)]);
      if (flags === 6) {
        if (outstanding.size) return 1;
        readiness = { generation, scope: plugin.type === 'SFZNotePlayerPlugin' ? 2 : 1,
          admittedFrames: window, readyAheadFrames: window, plannedPages: page, pendingPages: 0 };
        return 0;
      }
      queue.push({ generation: 7, sample: 0, pageIndex: ++page }); outstanding.add(page); return 0;
    },
    publishSfzSamplePage(_id, value) { outstanding.delete(value.pageIndex); return 0; }
  };
  const poll = () => {
    processor.handleSfzSampleStreamControl({ type: 'sfzPollPages', pluginId: 1, generation: 7, requestId: 1 });
    const answer = messages.at(-1); assert.equal(answer.ok, true); return answer.requests;
  };
  const publish = requests => { for (const request of requests) processor.handleSfzSampleStreamControl({ type: 'sfzPublishPage',
    pluginId: 1, generation: 7, operationRevision: 3, replayEpoch: null, requestId: 2, page: request }); };
  return { processor, plugin, entry, messages, calls, poll, publish };
}

test('MIDI sample readiness consumes bounded future chunks once and commits only after page publication', () => {
  const { processor, plugin, entry, calls, poll, publish } = forecastHarness();
  // The scheduler may retain historyAwait after native restoration finishes.
  const state = { generation: 3, cursor: 0, enabled: true, restoring: false, historyAwait: true };
  processor.midiScheduler = { generation: 3, speed: 1, preparing: true, playing: false, instances: new Map([[1, state]]),
    currentPosition() { return .5; }, timeline: { events: Array.from({ length: 300 }, (_, index) => ({
      seconds: index / 200, status: 0x90 | index % 16, data1: index % 128, data2: 100 })) } };
  let requests = poll(); assert.equal(processor.isSfzInstrumentJoinReady(plugin, entry), false);
  assert.deepEqual(calls[0].slice(0, 5), ['forecast', 0, 72000, 5, 156]);
  publish(requests); requests = poll();
  assert.deepEqual(calls[1].slice(0, 5), ['forecast', 0, 72000, 4, 44]);
  assert.deepEqual(calls[2].slice(0, 5), ['forecast', 0, 72000, 6, 0]);
  assert.equal(processor.isSfzInstrumentJoinReady(plugin, entry), false);
  publish(requests); poll();
  assert.deepEqual(calls[3].slice(0, 5), ['forecast', 0, 72000, 6, 0]);
  assert.equal(processor.isSfzInstrumentJoinReady(plugin, entry), true);
  poll(); assert.equal(calls.length, 4);
  processor.midiScheduler.playing = true; processor.midiScheduler.preparing = false;
  processor.currentFrame = 48000; processor.midiScheduler.position = .5;
  processor.midiScheduler.anchorFrame = 48000; state.cursor = 100;
  processor.dspBinding.instanceStreamReadiness(entry.id).readyAheadFrames = 24000;
  requests = poll(); assert.deepEqual(calls[4].slice(0, 5), ['forecast', 0, 72000, 5, 200]);
  publish(requests); poll();
  processor.midiScheduler.generation = state.generation = 4; state.cursor = 0;
  assert.equal(processor.isSfzInstrumentJoinReady(plugin, entry), false);
  requests = poll(); assert.deepEqual(calls.at(-1).slice(0, 5), ['forecast', 0, 72000, 5, 156]);
  publish(requests);
});

test('streamed Note Player initializes its normal control state before prefetch and starts its clock only after commit', () => {
  const { processor, plugin, entry, calls, poll, publish } = forecastHarness(true);
  processor.dspAssetCache.set(1, new Map([[0, { operationRevision: 3 }]]));
  processor._invalidatePowerSkipForMutation = () => {};
  processor.startSfzRuntime({ pluginId: 1, token: 3 });
  assert.deepEqual(calls, [['events', 1, 64], ['clock', 1, 0]]);
  processor.resumeSfzRuntimesForRender(128);
  assert.equal(calls.length, 2);
  const requests = poll(); assert.deepEqual(calls.at(-1).slice(0, 5), ['forecast', 1, 72000, 6, 0]);
  processor.resumeSfzRuntimesForRender(256); assert.equal(calls.at(-1)[0], 'forecast');
  publish(requests); poll();
  assert.equal(processor.isSfzInstrumentJoinReady(plugin, entry), true);
  processor.resumeSfzRuntimesForRender(384);
  assert.deepEqual(calls.at(-1), ['clock', 1, 1]);
  assert.equal(entry.sfzRuntimeFrozen, null);
  entry.sfzRuntimeFrozen = { generation: 1, clockFrame: 384, captureFrame: 384, nativeState: 2 };
  entry.sfzRuntimeResumeRequested = true;
  assert.equal(processor.isSfzInstrumentJoinReady(plugin, entry), false);
  processor.resumeSfzRuntimesForRender(512); assert.deepEqual(calls.at(-1), ['clock', 1, 1]);
});

test('worklet keeps the SFZ allowance separate from the unchanged other-asset budget', () => {
  const processor = budgetHarness();
  submit(processor, 1, 1024 * MiB);
  submit(processor, 3, 128 * MiB);
  assert.equal(processor.dspAssetCache.size, 2);
  assert.equal(processor.dspAssetFootprintBytes(), 1152 * MiB);
  submit(processor, 2, 36);
  submit(processor, 4, 36);
  assert.deepEqual(processor.rejections, ['module-budget', 'module-budget']);
  submit(processor, 1, 256 * MiB);
  submit(processor, 2, 768 * MiB);
  assert.equal(processor.dspAssetFootprintBytes(null, null, true), 1024 * MiB);
  assert.equal(processor.dspAssetFootprintBytes(null, null, false), 128 * MiB);
});

test('worklet counts deferred replacements in their own budget and excludes the replaced slot', () => {
  const processor = budgetHarness();
  submit(processor, 1, 256 * MiB);
  submit(processor, 3, 64 * MiB);
  processor.dspDeferredAssetStages.set('3:0', {
    pluginId: 3, slot: 0, candidate: { footprintBytes: 100 * MiB }
  });
  assert.equal(processor.dspAssetFootprintBytes(null, null, false), 100 * MiB);
  assert.equal(processor.dspAssetFootprintBytes(3, 0, false), 0);
  submit(processor, 4, 29 * MiB);
  assert.deepEqual(processor.rejections, ['module-budget']);
  submit(processor, 2, 768 * MiB);
  assert.equal(processor.dspAssetFootprintBytes(null, null, true), 1024 * MiB);
});

function offlineHarness(requiredPreparationBlocks = 0) {
  let processedBlocks = 0;
  const processor = new OfflineProcessor({}, {}, { warning() {} });
  processor.warnOfflineDspOnce = () => {};
  const arena = { scratch: { allChannels: new Float32Array(256) } };
  const session = { residentAssetBytes: 0, residentSfzAssetBytes: 0, sampleRate: 48000, outputChannelCount: 2,
    arena, entries: new Map(), binding: {
      instanceSetAsset() { processedBlocks = 0; return 0; },
      getArenaViews() { return arena; }, pointerForArenaView() { return 0; },
      instanceAssetState() { return processedBlocks < requiredPreparationBlocks ? 2 : 3; },
      instanceProcess() { processedBlocks++; return 0; }, resetInstance() { return 0; },
      destroyInstance() {}
    } };
  const stage = async (typeName, footprintBytes, warmupSamples = 0, normalize = false) => {
    // The native runtime is mocked: only the real table header and host accounting are needed.
    const payload = new ArrayBuffer(64);
    new Uint32Array(payload, 32).set([0x53465a, 2, 1, 30, 38, 38 + 39460680, 1, 0]);
    const asset = { payload, footprintBytes, warmupSamples };
    session.effectCost = { estimate: () => footprintBytes - payload.byteLength };
    const plugin = normalize ? normalizedAssetPlugin(asset) :
      { id: session.entries.size + 1, getWasmAssets: () => new Map([[0, asset]]) };
    const entry = { plugin,
      typeName, instanceId: session.entries.size + 1, residentAssetBytes: 0, disabled: false };
    session.entries.set(entry.plugin, entry);
    return { entry, ready: await processor.stageOfflineDspAssets(session, entry) };
  };
  return { processor, session, stage, processedBlocks: () => processedBlocks };
}

test('offline SFZ admission preserves the separate IR budget and releases each allocation once', async () => {
  const { processor, session, stage } = offlineHarness();
  const sfz = await stage('SFZNotePlayerPlugin', 1024 * MiB);
  const ir = await stage('ConvolverPlugin', 128 * MiB);
  assert.equal(sfz.ready, true);
  assert.equal(ir.ready, true);
  assert.equal(session.residentAssetBytes, 1152 * MiB);
  assert.equal((await stage('SFZNotePlayerPlugin', 64)).ready, false);
  assert.equal((await stage('ConvolverPlugin', 64)).ready, false);
  processor.disableOfflineDspEntry(session, sfz.entry);
  processor.disableOfflineDspEntry(session, sfz.entry);
  assert.equal(session.residentSfzAssetBytes, 0);
  assert.equal(session.residentAssetBytes, 128 * MiB);
  assert.equal((await stage('SFZNotePlayerPlugin', 157843432)).ready, true);
  assert.equal((await stage('ConvolverPlugin', 64)).ready, false);
  processor.disableOfflineDspEntry(session, ir.entry);
  assert.equal(session.residentAssetBytes, 157843432);
});

function normalizedAssetPlugin(asset) {
  const context = { window: {}, document: {}, ArrayBuffer, Map, Set,
    MutationObserver: class { observe() {} disconnect() {} } };
  vm.runInNewContext(fs.readFileSync(new URL('../../plugins/plugin-base.js', import.meta.url), 'utf8') +
    '\nglobalThis.TestPluginBase = PluginBase;', context);
  const plugin = new context.TestPluginBase('SFZ', 'Test');
  plugin.setWasmAsset(0, asset);
  assert.equal(plugin.getWasmAssets().get(0).warmupSamples, undefined);
  return plugin;
}

test('offline SFZ preparation recovers its hint after real PluginBase normalization', async () => {
  const neededBlocks = 1205;
  const withoutHint = offlineHarness(neededBlocks);
  assert.equal((await withoutHint.stage('ConvolverPlugin', MiB)).ready, false);
  assert.equal(withoutHint.processedBlocks(), 750);
  assert.equal(withoutHint.session.residentAssetBytes, 0);
  assert.equal(withoutHint.session.residentSfzAssetBytes, 0);
  const withHint = offlineHarness(neededBlocks);
  const preparationOperations = 2 + 2 + Math.ceil(39460680 / 32);
  const { entry, ready } = await withHint.stage('SFZNotePlayerPlugin', 157843432,
    Math.ceil(preparationOperations / 8), true);
  assert.equal(ready, true);
  assert.equal(entry.offlineAssetsReady, true);
  assert.equal(withHint.processedBlocks(), neededBlocks);
  const irWithHint = offlineHarness(neededBlocks);
  assert.equal((await irWithHint.stage('ConvolverPlugin', MiB, Math.ceil(preparationOperations / 8))).ready, true);
});
