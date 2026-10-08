import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { packSfzAsset, SFZ_REGION_FIELDS, SFZ_TABLE_VERSION } from '../../js/sfz/asset.js';
import { parseSfz } from '../../js/sfz/parser.js';
import { OfflineProcessor } from '../../js/audio/offline-processor.js';

const MiB = 1024 * 1024;

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
    assert.equal(ints[8 + SFZ_REGION_FIELDS.indexOf(key)], value);
  }
  assert.equal(floats[8 + SFZ_REGION_FIELDS.indexOf('sampleRate')], 48000);
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
    AudioWorkletProcessor: class {}, console: { warn() {} },
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
  const session = { residentAssetBytes: 0, residentSfzAssetBytes: 0, sampleRate: 48000,
    arena, entries: new Map(), binding: {
      instanceSetAsset() { processedBlocks = 0; return 0; },
      getArenaViews() { return arena; }, pointerForArenaView() { return 0; },
      instanceAssetState() { return processedBlocks < requiredPreparationBlocks ? 2 : 3; },
      instanceProcess() { processedBlocks++; return 0; }, resetInstance() { return 0; },
      destroyInstance() {}
    } };
  const stage = (typeName, footprintBytes, warmupSamples = 0, normalize = false) => {
    // The native runtime is mocked: only the real table header and host accounting are needed.
    const payload = new ArrayBuffer(64);
    new Uint32Array(payload, 32).set([0x53465a, 2, 1, 30, 38, 38 + 39460680, 1, 0]);
    const asset = { payload, footprintBytes, warmupSamples };
    const plugin = normalize ? normalizedAssetPlugin(asset) :
      { id: session.entries.size + 1, getWasmAssets: () => new Map([[0, asset]]) };
    const entry = { plugin,
      typeName, instanceId: session.entries.size + 1, residentAssetBytes: 0, disabled: false };
    session.entries.set(entry.plugin, entry);
    return { entry, ready: processor.stageOfflineDspAssets(session, entry) };
  };
  return { processor, session, stage, processedBlocks: () => processedBlocks };
}

test('offline SFZ admission preserves the separate IR budget and releases each allocation once', () => {
  const { processor, session, stage } = offlineHarness();
  const sfz = stage('SFZNotePlayerPlugin', 1024 * MiB);
  const ir = stage('ConvolverPlugin', 128 * MiB);
  assert.equal(sfz.ready, true);
  assert.equal(ir.ready, true);
  assert.equal(session.residentAssetBytes, 1152 * MiB);
  assert.equal(stage('SFZNotePlayerPlugin', 36).ready, false);
  assert.equal(stage('ConvolverPlugin', 36).ready, false);
  processor.disableOfflineDspEntry(session, sfz.entry);
  processor.disableOfflineDspEntry(session, sfz.entry);
  assert.equal(session.residentSfzAssetBytes, 0);
  assert.equal(session.residentAssetBytes, 128 * MiB);
  assert.equal(stage('SFZNotePlayerPlugin', 157843432).ready, true);
  assert.equal(stage('ConvolverPlugin', 36).ready, false);
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

test('offline SFZ preparation recovers its hint after real PluginBase normalization', () => {
  const neededBlocks = 1205;
  const withoutHint = offlineHarness(neededBlocks);
  assert.equal(withoutHint.stage('ConvolverPlugin', MiB).ready, false);
  assert.equal(withoutHint.processedBlocks(), 750);
  assert.equal(withoutHint.session.residentAssetBytes, 0);
  assert.equal(withoutHint.session.residentSfzAssetBytes, 0);
  const withHint = offlineHarness(neededBlocks);
  const preparationOperations = 2 + 2 + Math.ceil(39460680 / 32);
  const { entry, ready } = withHint.stage('SFZNotePlayerPlugin', 157843432,
    Math.ceil(preparationOperations / 8), true);
  assert.equal(ready, true);
  assert.equal(entry.offlineAssetsReady, true);
  assert.equal(withHint.processedBlocks(), neededBlocks);
  const irWithHint = offlineHarness(neededBlocks);
  assert.equal(irWithHint.stage('ConvolverPlugin', MiB, Math.ceil(preparationOperations / 8)).ready, true);
});
