import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import * as contract from '../../js/ir-library/ir-plugin-contract.js';
import * as pairing from '../../js/ir-library/ir-true-stereo-pair.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginSource = await fs.readFile(path.join(repoRoot, 'plugins', 'reverb', 'ir_reverb.js'), 'utf8');
const pluginCss = await fs.readFile(path.join(repoRoot, 'plugins', 'reverb', 'ir_reverb.css'), 'utf8');

async function withTimeout(promise, message, timeoutMs = 2000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class PluginBase {
  constructor(name, description) {
    this.name = name;
    this.description = description;
    this.enabled = true;
    this.id = 7;
    this.inputBus = null;
    this.outputBus = null;
    this.channel = null;
    this._lastUpdatedChannel = this.channel;
    this.assets = [];
    this.retainedAssets = new Map();
    this._wasmAssetOperationRevisions = new Map();
    this._wasmAssetStates = new Map();
    this._wasmAssetStateRevisions = new Map();
    this._wasmAssetSnapshotChangeListeners = new Set();
  }

  registerProcessor(source) {
    this.processorSource = source;
  }

  parseFiniteNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  updateParameters() {
    const previousChannel = this._lastUpdatedChannel;
    this._lastUpdatedChannel = this.channel;
    if (previousChannel !== this.channel && typeof this.onChannelSelectionChanged === 'function') {
      this.onChannelSelectionChanged(previousChannel, this.channel);
    }
    this.updateCount = (this.updateCount || 0) + 1;
  }

  getParameters() {
    return {
      type: this.constructor.name,
      id: this.id,
      enabled: this.enabled,
      ...(this.inputBus !== null && { inputBus: this.inputBus }),
      ...(this.outputBus !== null && { outputBus: this.outputBus }),
      ...(this.channel !== null && { channel: this.channel })
    };
  }

  getSerializableParameters() {
    const serialized = JSON.parse(JSON.stringify(this.getParameters()));
    const { type, id, inputBus, outputBus, channel, ...parameters } = serialized;
    if (inputBus !== undefined) parameters.ib = inputBus;
    if (outputBus !== undefined) parameters.ob = outputBus;
    if (channel !== null && channel !== undefined) parameters.ch = channel;
    return parameters;
  }

  _setValidatedParameters(params) {
    if (params.enabled !== undefined) this.enabled = Boolean(params.enabled);
    if (params.inputBus !== undefined) this.inputBus = params.inputBus;
    if (params.outputBus !== undefined) this.outputBus = params.outputBus;
    if (params.channel !== undefined) this.channel = params.channel;
  }

  _nextWasmAssetOperationRevision(slot) {
    const current = this._wasmAssetOperationRevisions.get(slot) || 0;
    const next = current >= Number.MAX_SAFE_INTEGER ? 1 : current + 1;
    this._wasmAssetOperationRevisions.set(slot, next);
    return next;
  }

  _isCurrentWasmAssetOperation(slot, operationRevision) {
    return Number.isSafeInteger(operationRevision) && operationRevision > 0 &&
      this._wasmAssetOperationRevisions.get(slot) === operationRevision;
  }

  getWasmAssetOperationRevision(slot) {
    return this._wasmAssetOperationRevisions.get(slot) ?? null;
  }

  setWasmAsset(slot, descriptor) {
    const retained = {
      ...descriptor,
      operationRevision: this._nextWasmAssetOperationRevision(slot)
    };
    this.assets.push({ slot, descriptor: retained });
    this.retainedAssets.set(slot, retained);
    return retained.operationRevision;
  }

  clearWasmAsset(slot) {
    this._nextWasmAssetOperationRevision(slot);
    this.clearedAssets = [...(this.clearedAssets || []), slot];
    this.retainedAssets.delete(slot);
    this._wasmAssetStates.delete(slot);
    this._wasmAssetStateRevisions.delete(slot);
    return 1;
  }

  addWasmAssetSnapshotChangeListener(listener) {
    this._wasmAssetSnapshotChangeListeners.add(listener);
    return () => this._wasmAssetSnapshotChangeListeners.delete(listener);
  }

  _notifyWasmAssetSnapshotChange() {
    for (const listener of [...this._wasmAssetSnapshotChangeListeners]) listener();
  }

  setSerializedParameters(params) {
    const { nm, en, id, ib, ob, ch, ...pluginParams } = params;
    this.setParameters({
      enabled: en,
      ...(id !== undefined && { id }),
      ...(ib !== undefined && { inputBus: ib }),
      ...(ob !== undefined && { outputBus: ob }),
      ...(ch !== undefined && { channel: ch }),
      ...pluginParams
    });
  }

  cleanup() {}
}

test('tracked asset resolution publishes pending settlement only for the exact current request', async () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  const snapshots = [];
  plugin.addWasmAssetSnapshotChangeListener(() => {
    snapshots.push(plugin.externalAssetInfo?.pending === true);
  });

  const success = deferred();
  const successfulResolution = plugin._trackAssetResolution(success.promise);
  plugin._notifyWasmAssetSnapshotChange();
  success.resolve(true);
  assert.equal(await successfulResolution, true);
  await Promise.resolve();
  assert.deepEqual(snapshots, [true, false]);

  const failure = deferred();
  const failedResolution = plugin._trackAssetResolution(failure.promise);
  plugin._notifyWasmAssetSnapshotChange();
  failure.reject(new Error('resolution failed'));
  await assert.rejects(failedResolution, /resolution failed/);
  await Promise.resolve();
  assert.deepEqual(snapshots, [true, false, true, false]);

  const stale = deferred();
  const staleResolution = plugin._trackAssetResolution(stale.promise);
  plugin._notifyWasmAssetSnapshotChange();
  const current = deferred();
  const currentResolution = plugin._trackAssetResolution(current.promise, ++plugin._generation);
  plugin._notifyWasmAssetSnapshotChange();
  const snapshotCountBeforeStaleSettlement = snapshots.length;
  stale.resolve(false);
  assert.equal(await staleResolution, false);
  await Promise.resolve();
  assert.equal(snapshots.length, snapshotCountBeforeStaleSettlement);
  assert.equal(plugin.externalAssetInfo.pending, true);

  current.resolve(true);
  assert.equal(await currentResolution, true);
  await Promise.resolve();
  assert.equal(snapshots.at(-1), false);
  assert.equal(plugin.externalAssetInfo, null);
  plugin.cleanup();
});

function preparedResult({ frames = 4, channels = 1, sampleRate = 48000,
  topology = channels === 1 ? 1 : 2, paths = [] } = {}) {
  const sampleFrames = new Uint32Array([0, frames - 1]);
  const edcDb = new Float32Array([0, -60]);
  const envelope = new Float32Array([1, 0]);
  return {
    channels: Array.from({ length: channels }, () => new Float32Array(frames)),
    sampleRate,
    frames,
    topology,
    payload: new ArrayBuffer(32 + paths.length * 12 + channels * frames * 4),
    asset: {
      formatTag: 1,
      channels,
      frames,
      sampleRate,
      topology,
      pathCount: paths.length,
      inputCount: new Set(paths.map(path => path.inputSlot)).size
    },
    analysis: {
      frames,
      sampleFrames,
      envelope,
      edcDb,
      rt60Seconds: 0.5,
      peakDb: 0,
      l1GainUpperBound: 2,
      l1GainUpperBoundDb: 20 * Math.log10(2),
      original: { frames, sampleFrames, envelope, edcDb, rt60Seconds: 0.5, peakDb: 0 },
      onsetFrame: 5,
      leadingSilenceFrames: 0,
      cutFrame: 7,
      sourceStartFrame: 3,
      truncated: false,
      initialNormalizationGains: new Float32Array([1]),
      finalNormalizationGains: new Float32Array([1])
    }
  };
}

function loadPlugin({ prepare = async request => preparedResult({
  frames: request.channels[0].length,
  channels: request.channels.length,
  sampleRate: request.sampleRate
}), emit = async request => preparedResult({
  frames: Math.min(request.channels[0].length, request.options.maxFrames),
  channels: request.options.topology === 1 ? 1 :
    (request.options.topology === 2 ? request.options.assetChannels : request.channels.length),
  sampleRate: request.sampleRate,
  topology: request.options.topology,
  paths: request.options.paths
}), libraryService = null, includeWindowLibraryService = true,
  irLibraryModuleLoader = null, documentRef = null } = {}) {
  const workerClient = { prepare, emit, close() {} };
  let importedFiles = [];
  const entries = new Map();
  const decodedCache = new Map();
  const defaultLibraryService = {
    store: { async updateAnalysis() {} },
    async importFiles(files) {
      importedFiles = [...files];
      const pair = importedFiles.length === 2 && pairing.parseTrueStereoSide(importedFiles[0].name) &&
        pairing.parseTrueStereoSide(importedFiles[1].name);
      const entry = {
        irId: pair ? 'aaaaaaaaaaaaaaaaaaaaaaaa' : 'bbbbbbbbbbbbbbbbbbbbbbbb',
        fileLabel: importedFiles.map(file => file.name).join(' + '),
        composition: pair ? 'pair' : 'single',
        channels: pair ? 4 : 1
      };
      entries.set(entry.irId, entry);
      return { imported: [entry], failedCount: 0, unsupportedCount: 0 };
    },
    get(id) { return entries.get(id) || null; },
    async resolveDecodedPcm(id, targetRate, adapters) {
      const entry = entries.get(id);
      if (!entry) return null;
      const cacheKey = `${id}:${targetRate}`;
      if (decodedCache.has(cacheKey)) return decodedCache.get(cacheKey);
      const decoded = [];
      for (const file of importedFiles) {
        decoded.push({ name: file.name, pcm: await adapters.decode(await file.arrayBuffer()) });
      }
      const pcm = entry.composition === 'pair' ? pairing.mergeTrueStereoPair(decoded) : decoded[0].pcm;
      const result = await adapters.resample(pcm, targetRate);
      decodedCache.set(cacheKey, result);
      return result;
    }
  };
  const window = {
    workletNode: { port: {}, channelCount: 2, context: { sampleRate: 48000 } },
    irReverbRuntime: {
      ...contract,
      ...pairing,
      createIrPreparationWorkerClient: () => workerClient
    }
  };
  if (includeWindowLibraryService) window.irLibraryService = libraryService || defaultLibraryService;
  const context = {
    PluginBase,
    window,
    ...(documentRef && { document: documentRef }),
    console,
    Promise,
    Float32Array,
    ArrayBuffer,
    Math,
    Object,
    Number,
    setTimeout,
    clearTimeout
  };
  let source = pluginSource;
  if (irLibraryModuleLoader) {
    const dynamicImport = "import('../../js/ir-library/service.js')";
    source = source.replace(dynamicImport, '__loadIrLibraryServiceModule()');
    assert.notEqual(source, pluginSource, 'IR library dynamic import fixture was not injected');
    context.__loadIrLibraryServiceModule = irLibraryModuleLoader;
  }
  vm.runInNewContext(`${source}\nthis.LoadedPlugin = IRReverbPlugin;`, context, {
    filename: 'ir_reverb.js'
  });
  return { Plugin: context.LoadedPlugin, window, workerClient };
}

function attachAssetControlRows(plugin, displayed) {
  const fields = {};
  for (const name of ['cm', 'lt', 'cr', 'dc', 'co', 'dt', 'tr']) {
    const values = name === 'dc'
      ? [{ type: 'checkbox', checked: displayed[name] }]
      : name === 'co' || name === 'dt' || name === 'tr'
        ? [{ type: 'range', value: String(displayed[name]) },
          { type: 'number', value: String(displayed[name]) }]
        : [{ type: 'select-one', value: String(displayed[name]) }];
    fields[name] = values;
    plugin._assetControlRows.set(name, {
      querySelectorAll() { return values; }
    });
  }
  return fields;
}

test('IR Reverb serializes defaults and applies Dry in the JavaScript fallback', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  assert.deepEqual({ ...plugin.getParameters() }, {
    type: 'IRReverbPlugin', id: 7, enabled: true, ir: '', cm: 'auto', lt: '128', cr: 'auto',
    dw: -15, dl: 0, pd: 0, dc: true, co: 0, dt: 100, tr: 100
  });
  const data = new Float32Array([0.25, -0.5]);
  assert.equal(plugin.process({}, data, {}, 0), data);
  const attenuated = new Float32Array([1, -0.5]);
  plugin.process({}, attenuated, { dl: -6 }, 0);
  const dryGain = Math.pow(10, -6 / 20);
  assert.ok(Math.abs(attenuated[0] - dryGain) < 1e-6);
  assert.ok(Math.abs(attenuated[1] + 0.5 * dryGain) < 1e-6);
  const muted = new Float32Array([1, -1]);
  assert.equal(plugin.process({}, muted, { dl: -96 }, 0), muted);
  assert.deepEqual([...muted], [0, 0]);
  assert.match(plugin.processorSource, /dryLevel <= -96/);
  assert.equal(plugin.temporalCapability, 'reset-on-resume');
});

test('IR Reverb requires an offline DSP asset only when an IR is selected', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  try {
    assert.equal(plugin.offlineDspAssetRequired, false);
    plugin.ir = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    assert.equal(plugin.offlineDspAssetRequired, true);
  } finally {
    plugin.cleanup();
  }
});

test('IR Reverb tracks only the current unsettled asset resolution', async () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  try {
    const first = deferred();
    const second = deferred();
    const firstTracked = plugin._trackAssetResolution(first.promise);
    const secondTracked = plugin._trackAssetResolution(second.promise);
    assert.equal(plugin.offlineDspAssetRequired, true);
    assert.equal(plugin._assetResolutionPromise, secondTracked);

    first.resolve(false);
    assert.equal(await firstTracked, false);
    assert.equal(plugin._assetResolutionPromise, secondTracked);
    assert.equal(plugin.offlineDspAssetRequired, true);

    second.resolve(false);
    assert.equal(await secondTracked, false);
    assert.equal(plugin._assetResolutionPromise, null);
    assert.equal(plugin._assetResolutionGeneration, null);
    assert.equal(plugin.offlineDspAssetRequired, false);

    const superseded = deferred();
    const supersededTracked = plugin._trackAssetResolution(superseded.promise);
    assert.equal(plugin.externalAssetInfo.pending, true);
    ++plugin._generation;
    assert.equal(plugin.externalAssetInfo, null);
    assert.equal(plugin.offlineDspAssetRequired, false);
    superseded.resolve(false);
    assert.equal(await supersededTracked, false);

    const rejected = deferred();
    const rejectedTracked = plugin._trackAssetResolution(rejected.promise);
    assert.equal(plugin.offlineDspAssetRequired, true);
    rejected.reject(new Error('resolution failed'));
    await assert.rejects(rejectedTracked, /resolution failed/);
    assert.equal(plugin._assetResolutionPromise, null);
    assert.equal(plugin._assetResolutionGeneration, null);
    assert.equal(plugin.offlineDspAssetRequired, false);
  } finally {
    plugin.cleanup();
  }
});

test('IR Reverb gives live and offline descriptors the requested deterministic asset signature', async () => {
  const irId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const entry = { irId, fileLabel: 'private.wav', composition: 'single', channels: 1 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irId ? entry : null; },
    async resolveDecodedPcm(_id, targetRate) {
      return { channels: [new Float32Array([1, 0])], sampleRate: targetRate };
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    plugin.setParameters({
      cm: 'mono',
      lt: '256',
      cr: 'full',
      channel: 'L',
      dc: true,
      co: 7,
      dt: 85,
      tr: 92
    });
    assert.equal(await plugin.loadLibraryEntry(entry), true);

    const live = plugin.retainedAssets.get(0);
    const info = plugin.externalAssetInfo;
    assert.equal(live.externalAssetSignature, info.assetSignature);
    assert.equal(info.assetSignature.includes(entry.fileLabel), false);
    assert.deepEqual(JSON.parse(info.assetSignature), [
      1, irId, 'mono', '256', 'full', 'L', true, 7, 85, 92, 48000, 2
    ]);
    assert.equal(Object.hasOwn(plugin.getParameters(), 'assetSignature'), false);

    const offline = await plugin.createOfflineDspState({
      sampleRate: 48000,
      outputChannelCount: 2
    });
    assert.equal(offline.assets.get(0).externalAssetSignature, info.assetSignature);
  } finally {
    plugin.cleanup();
  }
});

test('IR library service creation retries after rejection without stale promise clobbering', async () => {
  let attempts = 0;
  const { Plugin } = loadPlugin({
    includeWindowLibraryService: false,
    irLibraryModuleLoader() {
      attempts += 1;
      if (attempts === 1) return Promise.reject(new Error('factory unavailable'));
      return Promise.resolve({
        getDefaultIrLibraryService() { return { marker: 'retried' }; }
      });
    }
  });
  const plugin = new Plugin();
  try {
    const first = plugin._getLibraryService();
    const concurrent = plugin._getLibraryService();
    const firstRejected = assert.rejects(first, /factory unavailable/);
    const concurrentRejected = assert.rejects(concurrent, /factory unavailable/);
    await Promise.all([firstRejected, concurrentRejected]);
    assert.equal(attempts, 1);
    assert.equal(plugin._libraryServicePromise, null);

    const retried = await plugin._getLibraryService();
    assert.equal(attempts, 2);
    assert.equal(retried.marker, 'retried');
  } finally {
    plugin.cleanup();
  }

  const importGate = deferred();
  const staleHarness = loadPlugin({
    includeWindowLibraryService: false,
    irLibraryModuleLoader() { return importGate.promise; }
  });
  const stalePlugin = new staleHarness.Plugin();
  try {
    const stale = stalePlugin._getLibraryService();
    const staleRejected = assert.rejects(stale, /stale factory failed/);
    const replacement = Promise.resolve({ marker: 'replacement' });
    stalePlugin._libraryServicePromise = replacement;
    importGate.reject(new Error('stale factory failed'));
    await staleRejected;
    assert.equal(stalePlugin._libraryServicePromise, replacement);
    assert.equal((await stalePlugin._getLibraryService()).marker, 'replacement');
  } finally {
    stalePlugin.cleanup();
  }
});

test('IR Reverb builds non-destructive offline assets for 48↔96 kHz and 2↔8 channels', async () => {
  for (const scenario of [
    { liveRate: 48000, targetRate: 96000, outputChannels: 8 },
    { liveRate: 96000, targetRate: 48000, outputChannels: 2 }
  ]) {
    const resolvedRates = [];
    const libraryService = {
      store: { async updateAnalysis() {} },
      async resolveDecodedPcm(id, targetRate) {
        resolvedRates.push([id, targetRate]);
        return {
          channels: [new Float32Array([1, 0.5, 0.25, 0])],
          sampleRate: targetRate
        };
      }
    };
    const { Plugin, workerClient } = loadPlugin({ libraryService });
    let closeCount = 0;
    workerClient.close = () => { closeCount += 1; };
    const plugin = new Plugin();
    const livePcm = {
      channels: [new Float32Array([1, 0.5, 0.25, 0])],
      sampleRate: scenario.liveRate
    };
    const livePrepared = { marker: `live-${scenario.liveRate}` };
    plugin.ir = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    plugin._irFileLabel = 'Offline Hall.wav';
    plugin.cr = 'full';
    plugin.channel = 'A';
    plugin._sampleRate = scenario.liveRate;
    plugin._pcm = livePcm;
    plugin._prepared = livePrepared;

    const state = await plugin.createOfflineDspState({
      sampleRate: scenario.targetRate,
      outputChannelCount: scenario.outputChannels
    });
    const asset = state.assets.get(contract.IR_ASSET_SLOT);
    assert.deepEqual(resolvedRates, [[plugin.ir, scenario.targetRate]]);
    assert.equal(asset.rateDivider, 1);
    assert.equal(asset.processingChannels, scenario.outputChannels);
    assert.equal(asset.headBlock, 128);
    assert.equal(plugin._pcm, livePcm);
    assert.equal(plugin._prepared, livePrepared);
    assert.equal(plugin._sampleRate, scenario.liveRate);
    assert.equal(plugin.assets.length, 0);
    assert.equal(closeCount, 1);
  }
});

test('IR Reverb offline snapshots await the captured serialized IR resolution and reject superseded assets', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const entries = new Map([
    [irA, { irId: irA, fileLabel: 'Deferred Hall.wav', composition: 'single', channels: 1 }],
    [irB, { irId: irB, fileLabel: 'Current Hall.wav', composition: 'single', channels: 1 }]
  ]);
  const firstResolutionStarted = deferred();
  const firstResolutionGate = deferred();
  let activeResolutionStarted = firstResolutionStarted;
  let activeResolutionGate = firstResolutionGate;
  let firstResolutionPending = true;
  const resolvedIds = [];
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return entries.get(id) || null; },
    async resolveDecodedPcm(id, targetRate, adapters) {
      resolvedIds.push(id);
      if (id === irA && firstResolutionPending) {
        firstResolutionPending = false;
        activeResolutionStarted.resolve();
        await activeResolutionGate.promise;
      }
      if (adapters.isCurrent?.() === false) return null;
      return {
        channels: [new Float32Array(id === irA ? [1, 0] : [0.25, 0])],
        sampleRate: targetRate
      };
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    plugin.setSerializedParameters({ ir: irA, cr: 'full' });
    await withTimeout(firstResolutionStarted.promise, 'serialized IR resolution did not start');
    const offlineStatePromise = plugin.createOfflineDspState({
      sampleRate: 48000,
      outputChannelCount: 2
    });
    await Promise.resolve();
    assert.deepEqual(resolvedIds, [irA]);
    firstResolutionGate.resolve();
    const offlineState = await withTimeout(offlineStatePromise, 'offline snapshot did not settle');
    assert.equal(offlineState.assets.has(contract.IR_ASSET_SLOT), true);
    assert.deepEqual(resolvedIds, [irA, irA, irA]);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));
    const residentPcm = plugin._pcm;
    const residentPrepared = plugin._prepared;
    const residentDescriptor = plugin.retainedAssets.get(contract.IR_ASSET_SLOT);
    const clearCountBeforeSupersede = plugin.clearedAssets.length;
    assert.deepEqual(Array.from(residentPcm.channels[0]), [1, 0]);

    firstResolutionPending = true;
    const supersededStarted = deferred();
    const supersededGate = deferred();
    let graphClearCount = 0;
    const graphContext = {
      clearRect() { graphClearCount += 1; },
      fillRect() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      fillText() {},
      closePath() {},
      fill() {},
      setLineDash() {}
    };
    plugin._graphCanvas = {
      width: 1,
      height: 1,
      getContext: () => graphContext
    };
    activeResolutionStarted = supersededStarted;
    activeResolutionGate = supersededGate;
    plugin.setSerializedParameters({ ir: irA, cr: 'full' });
    assert.equal(plugin.ir, irA);
    assert.equal(plugin._irFileLabel, 'Deferred Hall.wav');
    assert.equal(plugin._pcm, residentPcm);
    assert.deepEqual(Array.from(plugin._pcm.channels[0]), [1, 0]);
    assert.equal(plugin._prepared, residentPrepared);
    assert.equal(plugin.retainedAssets.get(contract.IR_ASSET_SLOT), residentDescriptor);
    assert.equal(plugin.clearedAssets.length, clearCountBeforeSupersede);
    assert.equal(graphClearCount, 0);
    await withTimeout(supersededStarted.promise, 'superseded IR resolution did not start');
    const supersededSnapshot = plugin.createOfflineDspState({
      sampleRate: 48000,
      outputChannelCount: 2
    });
    plugin.setSerializedParameters({ ir: irB, cr: 'full', dl: -96 });
    assert.equal(plugin.ir, irB);
    assert.equal(plugin._irFileLabel, '');
    assert.equal(plugin.dl, -96);
    assert.equal(plugin._pcm, residentPcm);
    assert.deepEqual(Array.from(plugin._pcm.channels[0]), [1, 0]);
    assert.equal(plugin._prepared, residentPrepared);
    assert.equal(plugin.retainedAssets.get(contract.IR_ASSET_SLOT), residentDescriptor);
    assert.equal(plugin.clearedAssets.length, clearCountBeforeSupersede);
    assert.equal(graphClearCount, 0);
    const fallback = new Float32Array([1, -1]);
    assert.deepEqual(plugin.process({}, fallback, plugin.getParameters()), new Float32Array([0, 0]));
    assert.equal(await withTimeout(plugin._assetResolutionPromise, 'current IR resolution did not settle'), true);
    const currentPcm = plugin._pcm;
    const currentDescriptor = plugin.retainedAssets.get(contract.IR_ASSET_SLOT);
    assert.notEqual(currentPcm, residentPcm);
    assert.deepEqual(Array.from(currentPcm.channels[0]), [0.25, 0]);
    assert.notEqual(currentDescriptor, residentDescriptor);
    const stagedAssetCount = plugin.assets.length;
    supersededGate.resolve();
    const staleState = await withTimeout(supersededSnapshot, 'superseded offline snapshot did not settle');
    assert.equal(staleState.assets.size, 0);
    assert.equal(plugin.assets.length, stagedAssetCount);
    assert.equal(plugin.ir, irB);
    assert.equal(plugin._pcm, currentPcm);
    assert.deepEqual(Array.from(plugin._pcm.channels[0]), [0.25, 0]);
    assert.equal(plugin.retainedAssets.get(contract.IR_ASSET_SLOT), currentDescriptor);
  } finally {
    activeResolutionGate.resolve();
    plugin.cleanup();
  }
});

test('initial library and direct requests block offline DSP snapshots until their assets are ready', async () => {
  const irId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const entry = { irId, fileLabel: 'Deferred Hall.wav', composition: 'single', channels: 1 };
  const firstDecodeStarted = deferred();
  const firstDecodeGate = deferred();
  let decodeCalls = 0;
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irId ? entry : null; },
    async importFiles() {
      return { imported: [entry], failedCount: 0, unsupportedCount: 0 };
    },
    async resolveDecodedPcm(_id, targetRate, adapters) {
      if (++decodeCalls === 1) {
        firstDecodeStarted.resolve();
        await firstDecodeGate.promise;
      }
      if (adapters?.isCurrent?.() === false) return null;
      return { channels: [new Float32Array([1, 0])], sampleRate: targetRate };
    }
  };

  {
    const { Plugin } = loadPlugin({ libraryService });
    const plugin = new Plugin();
    try {
      const liveLoad = plugin.loadLibraryEntry(entry);
      await withTimeout(firstDecodeStarted.promise, 'initial library decode did not start');
      assert.equal(plugin.offlineDspAssetRequired, true);
      assert.equal(plugin.externalAssetInfo.pending, true);
      assert.equal(plugin.getSerializableParameters().ir, '');
      assert.deepEqual([...plugin.externalAssetInfo.ids], []);
      assert.deepEqual([...plugin.externalAssetInfo.names], []);
      assert.deepEqual([...plugin.externalAssetInfo.protectedIds], [irId]);
      const offlineState = plugin.createOfflineDspState({
        sampleRate: 48000,
        outputChannelCount: 2
      });
      let offlineSettled = false;
      offlineState.finally(() => { offlineSettled = true; });
      await Promise.resolve();
      assert.equal(offlineSettled, false);

      firstDecodeGate.resolve();
      assert.equal(await withTimeout(liveLoad, 'initial library load did not settle'), true);
      assert.equal((await withTimeout(offlineState, 'library offline snapshot did not settle'))
        .assets.has(contract.IR_ASSET_SLOT), true);
      assert.equal(plugin.getSerializableParameters().ir, irId);
      assert.deepEqual([...plugin.externalAssetInfo.ids], [irId]);
      assert.deepEqual([...plugin.externalAssetInfo.names], ['Deferred Hall.wav']);
      assert.equal(plugin.externalAssetInfo.pending, false);
    } finally {
      firstDecodeGate.resolve();
      plugin.cleanup();
    }
  }

  {
    const directImportGate = deferred();
    const directImportStarted = deferred();
    libraryService.importFiles = async () => {
      directImportStarted.resolve();
      await directImportGate.promise;
      return { imported: [entry], failedCount: 0, unsupportedCount: 0 };
    };
    const { Plugin } = loadPlugin({ libraryService });
    const plugin = new Plugin();
    const file = { name: 'Deferred.wav', async arrayBuffer() { return new ArrayBuffer(1); } };
    try {
      const directLoad = plugin.importFile(file);
      await withTimeout(directImportStarted.promise, 'direct import did not start');
      assert.equal(plugin.offlineDspAssetRequired, true);
      assert.equal(plugin.externalAssetInfo.pending, true);
      assert.deepEqual([...plugin.externalAssetInfo.ids], []);
      assert.deepEqual([...plugin.externalAssetInfo.protectedIds], []);
      const offlineState = plugin.createOfflineDspState({
        sampleRate: 48000,
        outputChannelCount: 2
      });
      let offlineSettled = false;
      offlineState.finally(() => { offlineSettled = true; });
      await Promise.resolve();
      assert.equal(offlineSettled, false);

      directImportGate.resolve();
      assert.equal(await withTimeout(directLoad, 'direct IR load did not settle'), true);
      assert.equal((await withTimeout(offlineState, 'direct offline snapshot did not settle'))
        .assets.has(contract.IR_ASSET_SLOT), true);
      assert.equal(plugin.externalAssetInfo.pending, false);
    } finally {
      directImportGate.resolve();
      plugin.cleanup();
    }
  }
});

test('IR Reverb stages a resolved WASM descriptor with kernel commit footprint', async () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._irFileLabel = 'room.wav';
  plugin._pcm = { channels: [new Float32Array([1, 0.5, 0.25, 0])], sampleRate: 48000 };
  const generation = ++plugin._generation;
  assert.equal(await plugin._prepareAndStage(generation), true);
  assert.equal(plugin.assets.length, 1);
  const { slot, descriptor } = plugin.assets[0];
  assert.equal(slot, 0);
  assert.equal(descriptor.headBlock, 128);
  assert.equal(descriptor.rateDivider, 1);
  assert.equal(descriptor.pathCount, 0);
  assert.equal(descriptor.inputCount, 0);
  assert.equal(descriptor.processingChannels, 2);
  assert.equal(descriptor.footprintBytes, contract.estimateIrKernelCommitFootprint({
    frames: 4,
    assetChannels: 1,
    topology: 1,
    processingChannels: 2,
    headBlock: 128
  }));
  assert.equal(Object.hasOwn(plugin._prepared, 'channels'), false);
  assert.equal(Object.hasOwn(plugin._prepared, 'payload'), false);
  assert.equal(Object.hasOwn(plugin._prepared, 'asset'), false);
  assert.equal(plugin._statusMessage, 'Loading room.wav…');
  const wetGain = 10 ** (plugin.dw / 20);
  assert.ok(Math.abs(plugin.powerGainUpperBoundDb - 20 * Math.log10(1 + 2 * wetGain)) < 1e-10);
  assert.match(plugin._metadataText, /room\.wav/);
  assert.match(plugin._metadataText, /Mono/);
  assert.match(plugin._metadataText, /48 → 48 kHz/);
  assert.match(plugin._metadataText, /128 samples/);
  assert.match(plugin._metadataText, /MiB/);
});

test('IR Reverb clears an incompatible live asset before preparing the new output format', async () => {
  const irId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const pcm = { channels: [new Float32Array([1, 0.5, 0.25, 0])], sampleRate: 48000 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    async resolveDecodedPcm() { return pcm; }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  plugin.ir = irId;
  plugin._irFileLabel = 'format-room.wav';
  plugin.channel = 'A';
  plugin._pcm = pcm;
  assert.equal(await plugin._prepareAndStage(++plugin._generation), true);
  assert.equal(plugin.retainedAssets.get(0).rateDivider, 1);
  assert.equal(plugin.retainedAssets.get(0).processingChannels, 2);
  const previousGeneration = plugin._generation;

  plugin.getParameters({
    sampleRate: 96000,
    outputChannelCount: 4,
    commitSampleRate: true
  });

  assert.equal(plugin.retainedAssets.size, 0);
  assert.equal(plugin.clearedAssets.at(-1), 0);
  assert.ok(plugin._generation > previousGeneration);
  while (plugin.assets.length < 2) await Promise.resolve();
  assert.equal(plugin.retainedAssets.get(0).rateDivider, 2);
  assert.equal(plugin.retainedAssets.get(0).processingChannels, 4);
  assert.equal(plugin._sampleRate, 96000);
  assert.equal(plugin._outputChannelCount, 4);
});

test('IR Reverb debounces host preparation controls for 150 ms', async () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._pcm = { channels: [new Float32Array([1])], sampleRate: 48000 };
  const calls = [];
  plugin._prepareAndStage = generation => calls.push(generation);
  plugin.setParameters({ dc: true });
  plugin.setParameters({ dt: 120 });
  plugin.setParameters({ tr: 80 });
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal(calls.length, 0);
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal(calls.length, 1);
});

test('IR Reverb discards stale preparation generations and stages only the latest', async () => {
  const pending = [];
  const { Plugin } = loadPlugin({
    prepare(request) {
      return new Promise(resolve => pending.push({ request, resolve }));
    }
  });
  const plugin = new Plugin();
  plugin._pcm = { channels: [new Float32Array([1, 0, 0, 0])], sampleRate: 48000 };
  const firstGeneration = ++plugin._generation;
  const first = plugin._prepareAndStage(firstGeneration);
  while (pending.length < 1) await Promise.resolve();
  plugin.setParameters({ lt: '256' });
  while (pending.length < 2) await Promise.resolve();
  pending[0].resolve(preparedResult());
  pending[1].resolve(preparedResult());
  await first;
  while (plugin.assets.length < 1) await Promise.resolve();
  assert.equal(plugin.assets.length, 1);
  assert.equal(plugin.assets[0].descriptor.headBlock, 256);
});

test('IR Reverb uses payload-only worker emission for latency and channel-mode re-staging', async () => {
  let prepareCalls = 0;
  let emitCalls = 0;
  const { Plugin } = loadPlugin({
    async prepare(request) {
      prepareCalls += 1;
      return preparedResult({
        frames: request.channels[0].length,
        channels: request.channels.length,
        sampleRate: request.sampleRate
      });
    },
    async emit(request) {
      emitCalls += 1;
      return preparedResult({
        frames: request.channels[0].length,
        channels: request.options.topology === 1 ? 1 : request.channels.length,
        sampleRate: request.sampleRate,
        topology: request.options.topology,
        paths: request.options.paths
      });
    }
  });
  const plugin = new Plugin();
  plugin._pcm = {
    channels: [new Float32Array([1, 0, 0, 0]), new Float32Array([0.5, 0, 0, 0])],
    sampleRate: 48000
  };
  await plugin._prepareAndStage(++plugin._generation);
  assert.deepEqual([prepareCalls, emitCalls], [1, 1]);

  plugin.setParameters({ lt: '256' });
  while (plugin.assets.length < 2) await Promise.resolve();
  assert.deepEqual([prepareCalls, emitCalls], [1, 2]);

  plugin.setParameters({ cm: 'mono' });
  while (plugin.assets.length < 3) await Promise.resolve();
  assert.deepEqual([prepareCalls, emitCalls], [1, 3]);
  assert.equal(plugin.assets.at(-1).descriptor.headBlock, 256);
  assert.equal(Object.hasOwn(plugin._prepared, 'channels'), false);
  assert.equal(Object.hasOwn(plugin._prepared, 'payload'), false);
});

test('invalid live routing clears only the prepared asset and returns to wet processing when valid again', async () => {
  const irId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const entry = { irId, fileLabel: 'Routing Hall.wav', composition: 'single', channels: 1 };
  const pcm = { channels: [new Float32Array([1, 0, 0, 0])], sampleRate: 48000 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irId ? entry : null; },
    async resolveDecodedPcm() { return pcm; }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    plugin.dl = -96;
    assert.equal(await plugin.loadLibraryEntry(entry), true);
    assert.ok(Number.isFinite(plugin.powerGainUpperBoundDb));

    plugin.setParameters({ cm: 'true' });
    await withTimeout((async () => {
      while (plugin._prepared !== null) await Promise.resolve();
    })(), 'invalid live routing did not clear the prepared asset');
    assert.equal(plugin.ir, irId);
    assert.equal(plugin._pcm, pcm);
    assert.equal(plugin._prepared, null);
    assert.equal(plugin._assetResident, false);
    assert.equal(plugin.clearedAssets.at(-1), contract.IR_ASSET_SLOT);
    assert.equal(plugin.powerGainUpperBoundDb, null);
    const liveFallback = new Float32Array([1, -1]);
    plugin.process({}, liveFallback, plugin.getParameters());
    assert.deepEqual([...liveFallback], [0, 0]);
    await assert.rejects(
      plugin.createOfflineDspState({ sampleRate: 48000, outputChannelCount: 2 }),
      /True Stereo/
    );

    const assetsBeforeRecovery = plugin.assets.length;
    plugin.setParameters({ cm: 'mono' });
    await withTimeout((async () => {
      while (plugin.assets.length === assetsBeforeRecovery) await Promise.resolve();
    })(), 'valid live routing did not restore the prepared asset');
    assert.equal(plugin.ir, irId);
    assert.equal(plugin._pcm, pcm);
    assert.equal(plugin._prepared.config.topology, 1);
    assert.equal(plugin._assetResident, true);
    assert.ok(Number.isFinite(plugin.powerGainUpperBoundDb));
  } finally {
    plugin.cleanup();
  }
});

test('current preparation failures clear old wet state while stale failures preserve the latest asset', async () => {
  const { Plugin, workerClient } = loadPlugin();
  const plugin = new Plugin();
  plugin._pcm = { channels: [new Float32Array([1, 0, 0, 0])], sampleRate: 48000 };
  try {
    assert.equal(await plugin._prepareAndStage(++plugin._generation), true);
    const originalEmit = workerClient.emit;
    const staleStarted = deferred();
    const staleEmit = deferred();
    workerClient.emit = request => {
      staleStarted.resolve(request);
      return staleEmit.promise;
    };
    plugin.setParameters({ lt: '256' });
    await withTimeout(staleStarted.promise, 'stale preparation did not start');

    workerClient.emit = originalEmit;
    const assetsBeforeLatest = plugin.assets.length;
    plugin.setParameters({ lt: '512' });
    await withTimeout((async () => {
      while (plugin.assets.length === assetsBeforeLatest) await Promise.resolve();
    })(), 'latest preparation did not stage');
    const latestPrepared = plugin._prepared;
    const clearsBeforeStaleFailure = plugin.clearedAssets?.length || 0;
    staleEmit.reject(new Error('stale emit failed'));
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(plugin._prepared, latestPrepared);
    assert.equal(plugin._prepared.config.headBlock, 512);
    assert.equal(plugin._assetResident, true);
    assert.equal(plugin.clearedAssets?.length || 0, clearsBeforeStaleFailure);

    workerClient.emit = async () => { throw new Error('current emit failed'); };
    plugin.setParameters({ lt: '1024' });
    await withTimeout((async () => {
      while (plugin._prepared !== null) await Promise.resolve();
    })(), 'current preparation failure did not clear the prepared asset');
    assert.equal(plugin._pcm.channels.length, 1);
    assert.equal(plugin._assetResident, false);
    assert.equal(plugin.powerGainUpperBoundDb, null);
    assert.ok((plugin.clearedAssets?.length || 0) > clearsBeforeStaleFailure);
  } finally {
    plugin.cleanup();
  }
});

test('reduced convolution rates keep the IR power gain bound conservative', async () => {
  for (const scenario of [
    { engineRate: 48000, convolutionRate: 'full', expectedFinite: true },
    { engineRate: 96000, convolutionRate: 'half', expectedFinite: false },
    { engineRate: 192000, convolutionRate: 'quarter', expectedFinite: false }
  ]) {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    try {
      plugin._sampleRate = scenario.engineRate;
      plugin.cr = scenario.convolutionRate;
      plugin._pcm = { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
      assert.equal(await plugin._prepareAndStage(++plugin._generation), true);
      assert.equal(Number.isFinite(plugin.powerGainUpperBoundDb), scenario.expectedFinite);
    } finally {
      plugin.cleanup();
    }
  }
});

test('IR Reverb propagates the routed wet L1 bound into its power gain bound', async () => {
  const { Plugin } = loadPlugin({
    async emit(request) {
      const result = preparedResult({
        frames: request.channels[0].length,
        channels: 4,
        sampleRate: request.sampleRate,
        topology: 3
      });
      result.analysis.l1GainUpperBound = 2;
      result.analysis.l1GainUpperBoundDb = 20 * Math.log10(2);
      return result;
    }
  });
  const plugin = new Plugin();
  plugin.dl = -96;
  plugin.cm = 'true';
  plugin._pcm = {
    channels: Array.from({ length: 4 }, () => new Float32Array([1, 0])),
    sampleRate: 48000,
    topologyHint: 'true-stereo'
  };
  assert.equal(await plugin._prepareAndStage(++plugin._generation), true);
  assert.ok(Math.abs(plugin.powerGainUpperBoundDb - (plugin.dw + 20 * Math.log10(2))) < 1e-12);
});

test('IR Reverb preserves common routing properties and re-stages once after channel selection changes', async () => {
  const { Plugin, window } = loadPlugin();
  window.workletNode.channelCount = 4;
  const plugin = new Plugin();
  plugin._pcm = {
    channels: Array.from({ length: 6 }, () => new Float32Array([1, 0, 0, 0])),
    sampleRate: 48000
  };
  await plugin._prepareAndStage(++plugin._generation);
  const initialAssets = plugin.assets.length;
  plugin.setParameters({ inputBus: 2, outputBus: 3, channel: 'A' });
  while (plugin.assets.length < initialAssets + 1) await Promise.resolve();
  const params = plugin.getParameters();
  assert.equal(params.inputBus, 2);
  assert.equal(params.outputBus, 3);
  assert.equal(params.channel, 'A');
  assert.equal(plugin.assets.length, initialAssets + 1);
  assert.equal(plugin.assets.at(-1).descriptor.pathCount, 4);
  assert.equal(plugin.assets.at(-1).descriptor.inputCount, 4);
  assert.equal(plugin.assets.at(-1).descriptor.processingChannels, 4);
});

test('IR Reverb imports a recognized L/R stereo pair and stages true-stereo metadata', async () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  try {
    const decoded = [
      { channels: [new Float32Array([1]), new Float32Array([2])], sampleRate: 48000 },
      { channels: [new Float32Array([3]), new Float32Array([4])], sampleRate: 48000 }
    ];
    plugin._decodeAudioData = async () => decoded.shift();
    const files = ['Room_L.wav', 'Room_R.wav'].map(name => ({
      name,
      async arrayBuffer() { return new ArrayBuffer(1); }
    }));
    assert.equal(await withTimeout(plugin.importFiles(files), 'pair import did not settle'), true);
    assert.equal(plugin._pcm.topologyHint, 'true-stereo');
    assert.equal(plugin._prepared.config.topology, 3);
    assert.equal(plugin._prepared.config.assetChannels, 4);
    assert.equal(plugin.assets.at(-1).descriptor.pathCount, 0);
    assert.equal(plugin._irFileLabel, 'Room_L.wav + Room_R.wav');
  } finally {
    plugin.cleanup();
  }
});

test('IR Reverb suppresses stale direct imports and exposes only safe pair and decoder errors', async () => {
  const importStarted = deferred();
  const firstImport = deferred();
  const entry = {
    irId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    fileLabel: 'Old_L.wav + Old_R.wav',
    composition: 'pair',
    channels: 4
  };
  const libraryService = {
    store: { async updateAnalysis() {} },
    async importFiles() {
      importStarted.resolve();
      return firstImport.promise;
    },
    get() { return entry; },
    async resolveDecodedPcm() {
      throw new TypeError('internal decoder id 73');
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  const file = name => ({ name, async arrayBuffer() { return new ArrayBuffer(1); } });
  try {
    const first = plugin.importFiles([file('Old_L.wav'), file('Old_R.wav')]);
    await withTimeout(importStarted.promise, 'first library import did not start');
    assert.equal(await withTimeout(
      plugin.importFiles([file('New_L.wav'), file('Wrong_R.wav')]),
      'mismatched direct pair did not settle'
    ), false);
    assert.equal(plugin._statusMessage,
      'The two files must have matching names ending in L/R or Left/Right.');

    firstImport.resolve({ imported: [entry], failedCount: 0, unsupportedCount: 0 });
    assert.equal(await withTimeout(first, 'stale import did not settle'), false);
    assert.equal(plugin.assets.length, 0);

    libraryService.importFiles = async () => ({
      imported: [{ ...entry, irId: 'bbbbbbbbbbbbbbbbbbbbbbbb', fileLabel: 'broken.wav', composition: 'single' }],
      failedCount: 0,
      unsupportedCount: 0
    });
    assert.equal(await withTimeout(plugin.importFile(file('broken.wav')), 'decoder failure did not settle'), false);
    assert.equal(plugin._statusMessage,
      'This audio file could not be imported. Try another WAV, FLAC, or AIFF file.');
    assert.doesNotMatch(plugin._statusMessage, /internal|73/);

    libraryService.importFiles = async () => ({
      imported: [],
      failedCount: 1,
      unsupportedCount: 0,
      failureCodes: ['file-too-large']
    });
    assert.equal(await withTimeout(plugin.importFile(file('huge.wav')), 'oversized import did not settle'), false);
    assert.equal(plugin._statusMessage,
      'The selected impulse response is too large. Choose a shorter impulse response and try again.');
    assert.doesNotMatch(plugin._statusMessage, /RangeError|268435456/);
  } finally {
    firstImport.resolve({ imported: [], failedCount: 0, unsupportedCount: 0 });
    plugin.cleanup();
  }
});

test('serialized missing IR clears the asset without changing dry controls and supports exact relink', async () => {
  const missingId = 'cccccccccccccccccccccccc';
  const entries = new Map();
  let queueCount = 0;
  const pcm = { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return entries.get(id) || null; },
    async importFiles() {
      const entry = {
        irId: missingId,
        fileLabel: 'Relinked.wav',
        composition: 'single',
        channels: 1
      };
      entries.set(entry.irId, entry);
      return { imported: [entry], failedCount: 0, unsupportedCount: 0 };
    },
    async resolveDecodedPcm(id) { return entries.has(id) ? pcm : null; }
  };
  const { Plugin, window } = loadPlugin({ libraryService });
  window.uiManager = { queueMissingExternalAssetSummary() { queueCount += 1; } };
  const plugin = new Plugin();
  try {
    plugin.setSerializedParameters({ ir: missingId, dl: -18 });
    assert.equal(await withTimeout(plugin._assetResolutionPromise, 'serialized IR resolution did not settle'), false);
    assert.equal(plugin.ir, missingId);
    assert.equal(plugin._irFileLabel, '');
    assert.equal(plugin.dl, -18);
    assert.deepEqual(plugin.clearedAssets, [0, 0]);
    assert.equal(plugin.externalAssetInfo.missing, true);
    assert.equal(queueCount, 1);
    assert.equal(plugin._statusMessage, 'IR not found: IR cccccccc');

    const file = { name: 'Relinked.wav', async arrayBuffer() { return new ArrayBuffer(1); } };
    assert.equal(await withTimeout(plugin.importFile(file), 'exact IR relink did not settle'), true);
    assert.equal(plugin.ir, missingId);
    assert.equal(plugin._irFileLabel, 'Relinked.wav');
    assert.equal(plugin.externalAssetInfo.missing, false);
    assert.equal(plugin.assets.length, 1);
    assert.equal(plugin.dl, -18);

    const serialized = plugin.getParameters();
    assert.equal(serialized.ir, missingId);
    assert.equal(Object.hasOwn(serialized, 'irn'), false);
    for (const forbidden of ['bytes', 'analysis', 'originals', 'name', 'source', 'sourceUrl', 'tags', 'fileLabel', 'pathSummary']) {
      assert.equal(Object.hasOwn(serialized, forbidden), false);
    }
  } finally {
    plugin.cleanup();
  }
});

test('persistent decoded cache data is shaped by the worker for each plugin instance', async () => {
  const entry = {
    irId: 'dddddddddddddddddddddddd',
    fileLabel: 'Cached Hall.wav',
    composition: 'single',
    channels: 1
  };
  const cachedPcm = { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === entry.irId ? entry : null; },
    async resolveDecodedPcm() { return cachedPcm; }
  };
  let prepareCalls = 0;
  const { Plugin } = loadPlugin({
    libraryService,
    async prepare(request) {
      prepareCalls += 1;
      return preparedResult({
        frames: request.channels[0].length,
        channels: request.channels.length,
        sampleRate: request.sampleRate
      });
    }
  });
  const plugins = [new Plugin(), new Plugin()];
  try {
    for (const plugin of plugins) {
      assert.equal(await withTimeout(plugin.loadLibraryEntry(entry), 'cached IR shaping did not settle'), true);
    }
    assert.equal(prepareCalls, 2);
    assert.equal(plugins.every(plugin => plugin.assets.length === 1), true);
  } finally {
    for (const plugin of plugins) plugin.cleanup();
  }
});

test('IR replacements retain the resident asset until admission while explicit clear remains destructive', async () => {
  const ids = {
    a: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    b: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    c: 'cccccccccccccccccccccccc',
    d: 'dddddddddddddddddddddddd',
    rejected: 'eeeeeeeeeeeeeeeeeeeeeeee'
  };
  const entries = new Map(Object.entries(ids).map(([name, irId]) => [irId, {
    irId,
    fileLabel: `${name.toUpperCase()} Hall.wav`,
    composition: 'single',
    channels: 1
  }]));
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return entries.get(id) || null; },
    async importFiles() {
      return { imported: [entries.get(ids.b)], failedCount: 0, unsupportedCount: 0 };
    },
    async resolveDecodedPcm() {
      return { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  const clearedIdentities = [];
  const originalClear = plugin.clearWasmAsset.bind(plugin);
  plugin.clearWasmAsset = slot => {
    clearedIdentities.push(plugin.ir);
    originalClear(slot);
  };
  try {
    assert.equal(await plugin.loadLibraryEntry(entries.get(ids.a)), true);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));
    const initialClearCount = clearedIdentities.length;

    assert.equal(await plugin.importFile({ name: 'B.wav' }), true);
    assert.equal(clearedIdentities.length, initialClearCount);
    assert.equal(plugin.ir, ids.b);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));

    assert.equal(await plugin.loadLibraryEntry(entries.get(ids.c)), true);
    assert.equal(clearedIdentities.length, initialClearCount);
    assert.equal(plugin.ir, ids.c);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));

    plugin.setSerializedParameters({ ir: ids.d, cr: 'full' });
    assert.equal(plugin.ir, ids.d);
    assert.equal(await plugin._assetResolutionPromise, true);
    assert.equal(clearedIdentities.length, initialClearCount);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));

    const clearCountBeforeRejectedReplacement = clearedIdentities.length;
    plugin.cm = 'true';
    assert.equal(await plugin.loadLibraryEntry(entries.get(ids.rejected)), false);
    assert.equal(clearedIdentities.length, clearCountBeforeRejectedReplacement);
    assert.equal(plugin.ir, ids.d);

    plugin._clearIrAsset(false);
    assert.equal(clearedIdentities.length, clearCountBeforeRejectedReplacement + 1);
    assert.equal(clearedIdentities.at(-1), ids.d);
    assert.equal(plugin.retainedAssets.size, 0);
  } finally {
    plugin.cleanup();
  }
});

test('retained replacement rejection restores old IR metadata without clear and allows later success', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const entries = new Map([
    [irA, { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 }],
    [irB, { irId: irB, fileLabel: 'B Hall.wav', composition: 'single', channels: 1 }]
  ]);
  const pcmById = new Map([
    [irA, { channels: [new Float32Array([1, 0])], sampleRate: 48000 }],
    [irB, { channels: [new Float32Array([0.5, 0])], sampleRate: 48000 }]
  ]);
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return entries.get(id) || null; },
    async resolveDecodedPcm(id) { return pcmById.get(id) || null; }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  const publishedParameters = [];
  const publishParameters = plugin.updateParameters.bind(plugin);
  plugin.updateParameters = () => {
    publishedParameters.push({ ...plugin.getParameters() });
    return publishParameters();
  };
  const originalClear = plugin.clearWasmAsset.bind(plugin);
  let clearCount = 0;
  plugin.clearWasmAsset = slot => {
    clearCount++;
    return originalClear(slot);
  };
  try {
    assert.equal(await plugin.loadLibraryEntry(entries.get(irA)), true);
    const oldRevision = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, oldRevision);
    const oldDescriptor = plugin.retainedAssets.get(0);
    const oldPrepared = plugin._prepared;
    const oldPcm = plugin._pcm;

    assert.equal(await plugin.loadLibraryEntry(entries.get(irB)), true);
    const rejectedRevision = plugin.getWasmAssetOperationRevision(0);
    const rejectedSignature = plugin.retainedAssets.get(0).externalAssetSignature;
    assert.deepEqual([...plugin.externalAssetInfo.ids], [irB]);
    assert.deepEqual([...plugin.externalAssetInfo.names], ['B Hall.wav']);
    assert.equal(plugin.externalAssetInfo.assetSignature, rejectedSignature);
    assert.deepEqual([...plugin.externalAssetInfo.protectedIds].sort(), [irA, irB]);
    plugin.retainedAssets.set(0, oldDescriptor);
    plugin.onWasmAssetRejected(0, 'capacity', rejectedRevision, {
      residentRetained: true,
      retainedOperationRevision: oldRevision,
      retainedAssetState: 3
    });

    assert.equal(plugin.ir, irA);
    assert.equal(plugin._irFileLabel, 'A Hall.wav');
    assert.equal(plugin._pcm, oldPcm);
    assert.equal(plugin._prepared, oldPrepared);
    assert.equal(plugin._assetResident, true);
    assert.equal(plugin._assetRejected, false);
    assert.equal(plugin.retainedAssets.get(0), oldDescriptor);
    assert.equal(clearCount, 0);
    assert.equal(publishedParameters.at(-1).ir, irA);
    assert.equal(Object.hasOwn(publishedParameters.at(-1), 'irn'), false);
    assert.equal(plugin._statusMessage,
      'There is not enough audio-processing memory for this impulse response.');
    assert.deepEqual([...plugin.externalAssetInfo.ids], [irA]);
    assert.deepEqual([...plugin.externalAssetInfo.names], ['A Hall.wav']);
    assert.equal(plugin.externalAssetInfo.assetSignature, oldDescriptor.externalAssetSignature);

    assert.equal(await plugin.loadLibraryEntry(entries.get(irB)), true);
    const successfulRevision = plugin.getWasmAssetOperationRevision(0);
    const successfulSignature = plugin.retainedAssets.get(0).externalAssetSignature;
    assert.deepEqual([...plugin.externalAssetInfo.protectedIds].sort(), [irA, irB]);
    assert.deepEqual([...plugin.externalAssetInfo.ids], [irB]);
    assert.deepEqual([...plugin.externalAssetInfo.names], ['B Hall.wav']);
    assert.equal(plugin.externalAssetInfo.assetSignature, successfulSignature);
    plugin.onWasmAssetState(0, 3, successfulRevision);
    assert.equal(plugin.ir, irB);
    assert.equal(plugin._irFileLabel, 'B Hall.wav');
    assert.deepEqual([...plugin.externalAssetInfo.ids], [irB]);
    assert.deepEqual([...plugin.externalAssetInfo.names], ['B Hall.wav']);
    assert.notEqual(plugin._prepared, oldPrepared);
    assert.equal(plugin._pendingAssetCandidate, null);
    assert.equal(plugin._residentAssetRevisionCandidate.baseline, null);
    assert.equal(plugin._assetRevisionSnapshots.get(successfulRevision).baseline, null);
    assert.deepEqual([...plugin.externalAssetInfo.protectedIds], [irB]);
    assert.equal(clearCount, 0);
  } finally {
    plugin.cleanup();
  }
});

test('rapid A to B to C rejection restores the exact B snapshot through PREPARING and ACTIVE', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const irC = 'cccccccccccccccccccccccc';
  const entries = new Map([
    [irA, { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 }],
    [irB, { irId: irB, fileLabel: 'B Hall.wav', composition: 'single', channels: 1 }],
    [irC, { irId: irC, fileLabel: 'C Hall.wav', composition: 'single', channels: 1 }]
  ]);
  const pcmById = new Map([
    [irA, { channels: [new Float32Array([1, 0])], sampleRate: 48000 }],
    [irB, { channels: [new Float32Array([0.5, 0])], sampleRate: 48000 }],
    [irC, { channels: [new Float32Array([0.25, 0])], sampleRate: 48000 }]
  ]);
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return entries.get(id) || null; },
    async resolveDecodedPcm(id) { return pcmById.get(id) || null; }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  const originalClear = plugin.clearWasmAsset.bind(plugin);
  let clearCount = 0;
  plugin.clearWasmAsset = slot => {
    clearCount++;
    return originalClear(slot);
  };
  try {
    assert.equal(await plugin.loadLibraryEntry(entries.get(irA)), true);
    const revisionA = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, revisionA);

    assert.equal(await plugin.loadLibraryEntry(entries.get(irB)), true);
    const revisionB = plugin.getWasmAssetOperationRevision(0);
    const descriptorB = plugin.retainedAssets.get(0);
    const preparedB = plugin._prepared;
    const pcmB = plugin._pcm;

    assert.equal(await plugin.loadLibraryEntry(entries.get(irC)), true);
    const revisionC = plugin.getWasmAssetOperationRevision(0);
    plugin.retainedAssets.set(0, descriptorB);
    plugin.onWasmAssetRejected(0, 'capacity', revisionC, {
      residentRetained: true,
      retainedOperationRevision: revisionB,
      retainedAssetState: 2
    });

    assert.equal(plugin.ir, irB);
    assert.equal(plugin._irFileLabel, 'B Hall.wav');
    assert.equal(plugin._pcm, pcmB);
    assert.equal(plugin._prepared, preparedB);
    assert.equal(plugin._pendingAssetCandidate.operationRevision, revisionB);
    assert.equal(plugin._pendingAssetCandidate.generation, plugin._generation);
    assert.equal(plugin._committedAssetSnapshot, null);
    assert.equal(plugin._assetRevisionSnapshots.size, 2);
    assert.equal(plugin._assetRevisionSnapshots.has(revisionA), true);
    assert.equal(plugin._assetRevisionSnapshots.has(revisionB), true);
    assert.equal(clearCount, 0);

    plugin._wasmAssetOperationRevisions.set(0, revisionB);
    plugin.onWasmAssetState(0, 3, revisionB);
    assert.equal(plugin._pendingAssetCandidate, null);
    assert.equal(plugin._committedAssetSnapshot.prepared, preparedB);
    assert.equal(plugin._assetRevisionSnapshots.size, 1);
    assert.equal(plugin._statusMessage, 'B Hall.wav is ready.');

    assert.equal(await plugin.loadLibraryEntry(entries.get(irC)), true);
    const secondRevisionC = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, revisionB);
    plugin.retainedAssets.set(0, descriptorB);
    plugin.onWasmAssetRejected(0, 'capacity', secondRevisionC, {
      residentRetained: true,
      retainedOperationRevision: revisionB,
      retainedAssetState: 3
    });
    assert.equal(plugin.ir, irB);
    assert.equal(plugin._prepared, preparedB);
    assert.equal(plugin._pendingAssetCandidate, null);
    assert.equal(plugin._committedAssetSnapshot.prepared, preparedB);
    assert.equal(plugin._assetRevisionSnapshots.size, 1);
    assert.equal(clearCount, 0);

    plugin._wasmAssetOperationRevisions.set(0, revisionB);
    plugin.onWasmAssetState(0, 1, revisionB);
    assert.notEqual(plugin._statusState, 'error');
    plugin.onWasmAssetState(0, 3, revisionB);
    assert.equal(plugin._statusMessage, 'B Hall.wav is ready.');
  } finally {
    plugin.cleanup();
  }
});

test('rollback during a newer preparation restores the resident asset without losing the request', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const irC = 'cccccccccccccccccccccccc';
  const entries = new Map([
    [irA, { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 }],
    [irB, { irId: irB, fileLabel: 'B Hall.wav', composition: 'single', channels: 1 }],
    [irC, { irId: irC, fileLabel: 'C Hall.wav', composition: 'single', channels: 1 }]
  ]);
  const pcmById = new Map([
    [irA, { channels: [new Float32Array([1, 0])], sampleRate: 48000 }],
    [irB, { channels: [new Float32Array([0.5, 0])], sampleRate: 48000 }],
    [irC, { channels: [new Float32Array([0.25, 0])], sampleRate: 48000 }]
  ]);
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return entries.get(id) || null; },
    async resolveDecodedPcm(id) { return pcmById.get(id) || null; }
  };
  const newerEmitStarted = deferred();
  const releaseNewerEmit = deferred();
  const channelControl = { value: '' };
  let emitCount = 0;
  const { Plugin } = loadPlugin({
    libraryService,
    documentRef: {
      getElementById() { return channelControl; }
    },
    emit: async request => {
      const call = ++emitCount;
      if (call === 3) {
        newerEmitStarted.resolve();
        await releaseNewerEmit.promise;
      }
      const result = preparedResult({
        frames: Math.min(request.channels[0].length, request.options.maxFrames),
        channels: request.options.topology === 1 ? 1 :
          (request.options.topology === 2 ? request.options.assetChannels : request.channels.length),
        sampleRate: request.sampleRate,
        topology: request.options.topology,
        paths: request.options.paths
      });
      result.analysis.l1GainUpperBound = call + 1;
      result.analysis.l1GainUpperBoundDb = 20 * Math.log10(call + 1);
      return result;
    }
  });
  const plugin = new Plugin();
  try {
    assert.equal(await plugin.loadLibraryEntry(entries.get(irA)), true);
    const revisionA = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, revisionA);
    const descriptorA = plugin.retainedAssets.get(0);
    const preparedA = plugin._prepared;
    const powerA = plugin._powerGainUpperBound;

    assert.equal(await plugin.loadLibraryEntry(entries.get(irB)), true);
    const revisionB = plugin.getWasmAssetOperationRevision(0);
    const displayedRequest = {
      cm: 'mono', lt: '512', cr: 'full', channel: 'R',
      dc: true, co: 9, dt: 70, tr: 80
    };
    Object.assign(plugin, displayedRequest);
    plugin._lastUpdatedChannel = displayedRequest.channel;
    const controlFields = attachAssetControlRows(plugin, displayedRequest);
    channelControl.value = displayedRequest.channel;
    const loadC = plugin.loadLibraryEntry(entries.get(irC));
    await withTimeout(newerEmitStarted.promise, 'newer preparation did not reach emit');
    const requestedC = plugin._currentRequestedAssetDefinition();
    assert.equal(requestedC.ir, irC);

    plugin.retainedAssets.set(0, descriptorA);
    plugin.onWasmAssetRejected(0, 'capacity', revisionB, {
      residentRetained: true,
      retainedOperationRevision: revisionA,
      retainedAssetState: 3
    });

    assert.equal(plugin.ir, irA);
    assert.equal(plugin._prepared, preparedA);
    assert.equal(plugin._powerGainUpperBound, powerA);
    assert.equal(plugin.externalAssetInfo.ids[0], irA);
    assert.equal(plugin.externalAssetInfo.names[0], 'A Hall.wav');
    assert.equal(plugin.externalAssetInfo.assetSignature, requestedC.externalAssetSignature);
    assert.equal(plugin.retainedAssets.get(0), descriptorA);
    assert.equal(plugin.cm, 'auto');
    assert.equal(plugin.lt, '128');
    assert.equal(controlFields.cm[0].value, displayedRequest.cm);
    assert.equal(controlFields.lt[0].value, displayedRequest.lt);
    assert.equal(controlFields.dc[0].checked, displayedRequest.dc);
    assert.equal(channelControl.value, displayedRequest.channel);

    releaseNewerEmit.resolve();
    assert.equal(await loadC, true);
    const descriptorC = plugin.retainedAssets.get(0);
    assert.equal(plugin.ir, irC);
    assert.equal(descriptorC.externalAssetSignature, requestedC.externalAssetSignature);
    assert.equal(plugin.externalAssetInfo.assetSignature, requestedC.externalAssetSignature);
    assert.equal(plugin.externalAssetInfo.ids[0], irC);
    assert.notEqual(plugin._prepared, preparedA);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));
    assert.equal(plugin.externalAssetInfo.ids[0], irC);
  } finally {
    releaseNewerEmit.resolve();
    plugin.cleanup();
  }
});

test('new identity is requested before decode and survives predecessor rollback without aliasing', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const irC = 'cccccccccccccccccccccccc';
  const entries = new Map([
    [irA, { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 }],
    [irB, { irId: irB, fileLabel: 'B Hall.wav', composition: 'single', channels: 1 }],
    [irC, { irId: irC, fileLabel: 'C Hall.wav', composition: 'single', channels: 1 }]
  ]);
  const pcmById = new Map([
    [irA, { channels: [new Float32Array([1, 0])], sampleRate: 48000 }],
    [irB, { channels: [new Float32Array([0.5, 0])], sampleRate: 48000 }],
    [irC, { channels: [new Float32Array([0.25, 0])], sampleRate: 48000 }]
  ]);
  const decodeCStarted = deferred();
  const releaseDecodeC = deferred();
  let cResolutions = 0;
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return entries.get(id) || null; },
    async resolveDecodedPcm(id) {
      if (id === irC && ++cResolutions === 1) {
        decodeCStarted.resolve();
        await releaseDecodeC.promise;
      }
      return pcmById.get(id) || null;
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    assert.equal(await plugin.loadLibraryEntry(entries.get(irA)), true);
    const revisionA = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, revisionA);
    const descriptorA = plugin.retainedAssets.get(0);

    assert.equal(await plugin.loadLibraryEntry(entries.get(irB)), true);
    const revisionB = plugin.getWasmAssetOperationRevision(0);
    const loadC = plugin.loadLibraryEntry(entries.get(irC));
    await withTimeout(decodeCStarted.promise, 'C decode did not start');
    assert.equal(plugin._currentRequestedAssetDefinition().ir, irC);
    assert.deepEqual([...plugin.externalAssetInfo.protectedIds].sort(), [irA, irB, irC]);

    plugin.retainedAssets.set(0, descriptorA);
    plugin.onWasmAssetRejected(0, 'capacity', revisionB, {
      residentRetained: true,
      retainedOperationRevision: revisionA,
      retainedAssetState: 3
    });
    assert.equal(plugin.ir, irA);
    assert.equal(plugin._currentRequestedAssetDefinition().ir, irC);
    assert.equal(plugin._currentRequestedAssetDefinition().pcm, null);

    releaseDecodeC.resolve();
    assert.equal(await loadC, true);
    assert.equal(plugin.ir, irC);
    assert.equal(plugin.retainedAssets.get(0).externalAssetSignature,
      plugin.externalAssetInfo.assetSignature);
    assert.equal(plugin.externalAssetInfo.ids[0], irC);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));
    assert.equal(plugin.externalAssetInfo.ids[0], irC);
  } finally {
    releaseDecodeC.resolve();
    plugin.cleanup();
  }
});

test('pre-stage missing replacement clears the resident while invalid config restores it and its UI', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const entryA = { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 };
  const entryB = { irId: irB, fileLabel: 'B Hall.wav', composition: 'single', channels: 1 };
  const pcmA = { channels: [new Float32Array([1, 0])], sampleRate: 48000 };

  {
    const libraryService = {
      store: { async updateAnalysis() {} },
      get(id) { return id === irA ? entryA : entryB; },
      async resolveDecodedPcm(id) { return id === irA ? pcmA : null; }
    };
    const { Plugin } = loadPlugin({ libraryService });
    const plugin = new Plugin();
    try {
      assert.equal(await plugin.loadLibraryEntry(entryA), true);
      plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));
      assert.equal(await plugin.loadLibraryEntry(entryB), false);
      assert.equal(plugin.ir, irB);
      assert.equal(plugin._irFileLabel, 'B Hall.wav');
      assert.equal(plugin._missingIr, true);
      assert.equal(plugin._prepared, null);
      assert.equal(plugin.retainedAssets.size, 0);
      assert.equal(plugin._currentRequestedAssetDefinition(), null);
      assert.deepEqual([...plugin.externalAssetInfo.protectedIds], [irB]);
      assert.match(plugin._statusMessage, /IR not found/);
    } finally {
      plugin.cleanup();
    }
  }

  {
    const libraryService = {
      store: { async updateAnalysis() {} },
      get(id) { return id === irA ? entryA : entryB; },
      async resolveDecodedPcm(id) {
        if (id === irA) return pcmA;
        throw new Error('corrupt test data');
      }
    };
    const { Plugin } = loadPlugin({ libraryService });
    const plugin = new Plugin();
    try {
      assert.equal(await plugin.loadLibraryEntry(entryA), true);
      plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));
      const descriptorA = plugin.retainedAssets.get(0);
      assert.equal(await plugin.loadLibraryEntry(entryB), false);
      assert.equal(plugin.ir, irA);
      assert.equal(plugin._missingIr, false);
      assert.notEqual(plugin._prepared, null);
      assert.equal(plugin.retainedAssets.get(0), descriptorA);
      assert.equal(plugin._currentRequestedAssetDefinition(), null);
      assert.equal(plugin._statusState, 'error');
    } finally {
      plugin.cleanup();
    }
  }

  {
    const libraryService = {
      store: { async updateAnalysis() {} },
      get(id) { return id === irA ? entryA : entryB; },
      async resolveDecodedPcm() { return pcmA; }
    };
    const channelControl = { value: '' };
    const { Plugin } = loadPlugin({
      libraryService,
      documentRef: { getElementById() { return channelControl; } }
    });
    const plugin = new Plugin();
    try {
      assert.equal(await plugin.loadLibraryEntry(entryA), true);
      const revisionA = plugin.getWasmAssetOperationRevision(0);
      plugin.onWasmAssetState(0, 3, revisionA);
      const descriptorA = plugin.retainedAssets.get(0);
      const invalidControls = {
        cm: 'true', lt: '512', cr: 'full', channel: 'R',
        dc: true, co: 9, dt: 70, tr: 80
      };
      plugin.setParameters(invalidControls);
      const fields = attachAssetControlRows(plugin, invalidControls);
      channelControl.value = invalidControls.channel;

      assert.equal(await plugin.loadLibraryEntry(entryB), false);
      assert.equal(plugin.ir, irA);
      assert.equal(plugin._prepared !== null, true);
      assert.equal(plugin.retainedAssets.get(0), descriptorA);
      assert.equal(plugin._currentRequestedAssetDefinition(), null);
      assert.equal(plugin.cm, 'auto');
      assert.equal(plugin.lt, '128');
      assert.equal(fields.cm[0].value, 'auto');
      assert.equal(fields.lt[0].value, '128');
      assert.equal(fields.dc[0].checked, true);
      assert.equal(channelControl.value, '');
      assert.equal(plugin._statusState, 'error');
    } finally {
      plugin.cleanup();
    }
  }
});

test('a newer asset operation supersedes a pending clear before ACTIVE or rejection', async () => {
  const entries = new Map(['a', 'b', 'c'].map((name, index) => {
    const irId = String.fromCharCode(97 + index).repeat(24);
    return [irId, { irId, fileLabel: `${name.toUpperCase()} Hall.wav`, composition: 'single', channels: 1 }];
  }));
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return entries.get(id) || null; },
    async resolveDecodedPcm() {
      return { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    const [entryA, entryB, entryC] = [...entries.values()];
    assert.equal(await plugin.loadLibraryEntry(entryA), true);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));

    plugin._clearIrAsset(false);
    const clearRevision = plugin.getWasmAssetOperationRevision(0);
    assert.equal(plugin._assetClearPending, true);
    assert.equal(await plugin.loadLibraryEntry(entryB), true);
    const revisionB = plugin.getWasmAssetOperationRevision(0);
    assert.equal(plugin._assetClearPending, false);
    plugin.onWasmAssetState(0, 0, clearRevision);
    plugin.onWasmAssetState(0, 3, revisionB);
    assert.equal(plugin._statusMessage, 'B Hall.wav is ready.');
    assert.equal(plugin._pendingAssetCandidate, null);

    plugin._clearIrAsset(false);
    assert.equal(plugin._assetClearPending, true);
    assert.equal(await plugin.loadLibraryEntry(entryC), true);
    const revisionC = plugin.getWasmAssetOperationRevision(0);
    assert.equal(plugin._assetClearPending, false);
    plugin.onWasmAssetRejected(0, 'capacity', revisionC, { residentRetained: false });
    assert.equal(plugin._assetResident, false);
    assert.equal(plugin._statusState, 'error');
  } finally {
    plugin.cleanup();
  }
});

test('an unacknowledged predecessor keeps its confirmed rollback snapshot after a later config failure', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const irC = 'cccccccccccccccccccccccc';
  const entries = new Map([
    [irA, { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 }],
    [irB, { irId: irB, fileLabel: 'B Hall.wav', composition: 'single', channels: 1 }],
    [irC, { irId: irC, fileLabel: 'C Hall.wav', composition: 'single', channels: 1 }]
  ]);
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return entries.get(id) || null; },
    async resolveDecodedPcm() {
      return { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    assert.equal(await plugin.loadLibraryEntry(entries.get(irA)), true);
    const revisionA = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, revisionA);
    plugin._wasmAssetStates.set(0, 3);
    plugin._wasmAssetStateRevisions.set(0, revisionA);
    const descriptorA = plugin.retainedAssets.get(0);

    assert.equal(await plugin.loadLibraryEntry(entries.get(irB)), true);
    const revisionB = plugin.getWasmAssetOperationRevision(0);
    plugin.cm = 'true';
    assert.equal(await plugin.loadLibraryEntry(entries.get(irC)), false);

    assert.equal(plugin.ir, irB);
    assert.equal(plugin._pendingAssetCandidate.operationRevision, revisionB);
    assert.equal(plugin._pendingAssetCandidate.baseline.ir, irA);
    assert.equal(plugin._residentAssetRevisionCandidate.operationRevision, revisionA);
    assert.equal(plugin._committedAssetSnapshot.ir, irA);
    assert.deepEqual([...plugin.externalAssetInfo.protectedIds].sort(), [irA, irB]);

    plugin.retainedAssets.set(0, descriptorA);
    plugin.onWasmAssetRejected(0, 'capacity', revisionB, {
      residentRetained: true,
      retainedOperationRevision: revisionA,
      retainedAssetState: 3
    });
    assert.equal(plugin.ir, irA);
    assert.equal(plugin._prepared !== null, true);
    assert.equal(plugin.retainedAssets.get(0), descriptorA);
  } finally {
    plugin.cleanup();
  }
});

test('library and direct import failures restore confirmed assets and leave initial plugins fail-closed', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const entryA = { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 };
  const entryB = { irId: irB, fileLabel: 'Broken Hall.wav', composition: 'single', channels: 1 };
  const pcmA = { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    async importFiles() {
      return { imported: [entryB], failedCount: 0, unsupportedCount: 0 };
    },
    get(id) { return id === irA ? entryA : entryB; },
    async resolveDecodedPcm(id) {
      if (id === irA) return pcmA;
      throw new Error('internal decoder failure');
    }
  };
  const file = { name: 'broken.wav', async arrayBuffer() { return new ArrayBuffer(1); } };

  {
    const { Plugin } = loadPlugin({ libraryService });
    const plugin = new Plugin();
    try {
      assert.equal(await plugin.loadLibraryEntry(entryA), true);
      plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));
      const descriptorA = plugin.retainedAssets.get(0);
      assert.equal(await plugin.importFile(file), false);
      assert.equal(plugin.ir, irA);
      assert.equal(plugin.retainedAssets.get(0), descriptorA);
      assert.equal(plugin._currentRequestedAssetDefinition(), null);
      assert.equal(plugin._statusMessage,
        'This audio file could not be imported. Try another WAV, FLAC, or AIFF file.');
    } finally {
      plugin.cleanup();
    }
  }

  {
    const { Plugin } = loadPlugin({ libraryService });
    const plugin = new Plugin();
    try {
      const failedImport = plugin.importFile(file);
      assert.equal(plugin.externalAssetInfo.pending, true);
      assert.deepEqual([...plugin.externalAssetInfo.ids], []);
      assert.deepEqual([...plugin.externalAssetInfo.protectedIds], []);
      assert.equal(await failedImport, false);
      assert.equal(plugin.ir, '');
      assert.equal(plugin._prepared, null);
      assert.equal(plugin.retainedAssets.size, 0);
      assert.equal(plugin._currentRequestedAssetDefinition(), null);
      assert.equal(plugin.externalAssetInfo, null);
      assert.equal(plugin._statusMessage,
        'This audio file could not be imported. Try another WAV, FLAC, or AIFF file.');
    } finally {
      plugin.cleanup();
    }
  }

  {
    const { Plugin } = loadPlugin({ libraryService });
    const plugin = new Plugin();
    try {
      const failedLoad = plugin.loadLibraryEntry(entryB);
      assert.equal(plugin.externalAssetInfo.pending, true);
      assert.deepEqual([...plugin.externalAssetInfo.ids], []);
      assert.deepEqual([...plugin.externalAssetInfo.protectedIds], [irB]);
      assert.equal(await failedLoad, false);
      assert.equal(plugin.ir, '');
      assert.equal(plugin._currentRequestedAssetDefinition(), null);
      assert.equal(plugin.externalAssetInfo, null);
    } finally {
      plugin.cleanup();
    }
  }
});

test('asset controls changed during decode stay attached to the requested identity', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const entryA = { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 };
  const entryB = { irId: irB, fileLabel: 'B Hall.wav', composition: 'single', channels: 1 };
  const decodeBStarted = deferred();
  const releaseDecodeB = deferred();
  let bResolutions = 0;
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irA ? entryA : entryB; },
    async resolveDecodedPcm(id) {
      if (id === irB && ++bResolutions === 1) {
        decodeBStarted.resolve();
        await releaseDecodeB.promise;
      }
      return { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
    }
  };
  const channelControl = { value: '' };
  const { Plugin } = loadPlugin({
    libraryService,
    documentRef: { getElementById() { return channelControl; } }
  });
  const plugin = new Plugin();
  try {
    assert.equal(await plugin.loadLibraryEntry(entryA), true);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));
    const assetsBeforeB = plugin.assets.length;
    const generationBeforeB = plugin._generation + 1;
    const loadB = plugin.loadLibraryEntry(entryB);
    await withTimeout(decodeBStarted.promise, 'B decode did not start');
    assert.equal(plugin._generation, generationBeforeB);

    const requestedControls = {
      cm: 'mono', lt: '512', cr: 'full', channel: 'R',
      dc: true, co: 8, dt: 75, tr: 85
    };
    plugin.setParameters(requestedControls);
    const controlFields = attachAssetControlRows(plugin, requestedControls);
    channelControl.value = requestedControls.channel;
    assert.equal(plugin._generation, generationBeforeB);
    assert.equal(plugin.assets.length, assetsBeforeB);
    assert.equal(plugin._currentRequestedAssetDefinition().ir, irB);
    assert.equal(plugin._currentRequestedAssetDefinition().controls.lt, '512');
    assert.equal(plugin.ir, irA);
    assert.equal(plugin.getSerializableParameters().ir, irA);
    assert.deepEqual([...plugin.externalAssetInfo.ids], [irA]);
    assert.deepEqual([...plugin.externalAssetInfo.names], ['A Hall.wav']);
    assert.deepEqual([...plugin.externalAssetInfo.protectedIds].sort(), [irA, irB]);
    assert.equal(plugin.externalAssetInfo.assetSignature,
      plugin._currentRequestedAssetDefinition().externalAssetSignature);

    releaseDecodeB.resolve();
    assert.equal(await loadB, true);
    assert.equal(plugin.assets.length, assetsBeforeB + 1);
    assert.equal(plugin.ir, irB);
    assert.equal(plugin.getSerializableParameters().ir, irB);
    assert.deepEqual([...plugin.externalAssetInfo.ids], [irB]);
    assert.deepEqual([...plugin.externalAssetInfo.names], ['B Hall.wav']);
    assert.deepEqual([...plugin.externalAssetInfo.protectedIds].sort(), [irA, irB]);
    assert.equal(plugin.cm, 'mono');
    assert.equal(plugin.lt, '512');
    assert.equal(plugin.cr, 'full');
    assert.equal(plugin.channel, 'R');
    assert.equal(plugin.dc, true);
    assert.equal(plugin.co, 8);
    assert.equal(plugin.dt, 75);
    assert.equal(plugin.tr, 85);
    assert.equal(controlFields.cm[0].value, 'mono');
    assert.equal(controlFields.lt[0].value, '512');
    assert.equal(controlFields.cr[0].value, 'full');
    assert.equal(controlFields.dc[0].checked, true);
    assert.equal(controlFields.co[1].value, '8');
    assert.equal(controlFields.dt[0].value, '75');
    assert.equal(controlFields.tr[1].value, '85');
    assert.equal(channelControl.value, 'R');
    assert.equal(plugin.retainedAssets.get(0).headBlock, 512);
    assert.equal(plugin.retainedAssets.get(0).externalAssetSignature,
      plugin.externalAssetInfo.assetSignature);
  } finally {
    releaseDecodeB.resolve();
    plugin.cleanup();
  }
});

test('initial decode failure restores every requested asset control in state and DOM', async () => {
  const entry = {
    irId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    fileLabel: 'Broken Hall.wav',
    composition: 'single',
    channels: 1
  };
  const decodeStarted = deferred();
  const releaseDecode = deferred();
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === entry.irId ? entry : null; },
    async resolveDecodedPcm() {
      decodeStarted.resolve();
      await releaseDecode.promise;
      throw new Error('internal decode failure');
    }
  };
  const channelControl = { value: '' };
  const { Plugin } = loadPlugin({
    libraryService,
    documentRef: { getElementById() { return channelControl; } }
  });
  const plugin = new Plugin();
  try {
    const load = plugin.loadLibraryEntry(entry);
    await withTimeout(decodeStarted.promise, 'initial decode did not start');
    const displayed = {
      cm: 'mono', lt: '512', cr: 'full', channel: 'R',
      dc: true, co: 8, dt: 75, tr: 85
    };
    plugin.setParameters(displayed);
    const controlFields = attachAssetControlRows(plugin, displayed);
    channelControl.value = displayed.channel;
    releaseDecode.resolve();

    assert.equal(await load, false);
    assert.deepEqual({
      cm: plugin.cm,
      lt: plugin.lt,
      cr: plugin.cr,
      channel: plugin.channel,
      dc: plugin.dc,
      co: plugin.co,
      dt: plugin.dt,
      tr: plugin.tr
    }, {
      cm: 'auto', lt: '128', cr: 'auto', channel: null,
      dc: true, co: 0, dt: 100, tr: 100
    });
    const serialized = plugin.getParameters();
    assert.equal(serialized.cm, 'auto');
    assert.equal(serialized.lt, '128');
    assert.equal(serialized.cr, 'auto');
    assert.equal(Object.hasOwn(serialized, 'channel'), false);
    assert.equal(controlFields.cm[0].value, 'auto');
    assert.equal(controlFields.lt[0].value, '128');
    assert.equal(controlFields.cr[0].value, 'auto');
    assert.equal(controlFields.dc[0].checked, true);
    assert.equal(controlFields.co[0].value, '0');
    assert.equal(controlFields.co[1].value, '0');
    assert.equal(controlFields.dt[0].value, '100');
    assert.equal(controlFields.tr[1].value, '100');
    assert.equal(channelControl.value, '');
  } finally {
    releaseDecode.resolve();
    plugin.cleanup();
  }
});

test('partial import notices wait for ACTIVE and never replace the no-worklet warning', async () => {
  const irId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const entry = { irId, fileLabel: 'Partial Hall.wav', composition: 'single', channels: 1 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    async importFiles() {
      return { imported: [entry], failedCount: 1, unsupportedCount: 0 };
    },
    get(id) { return id === irId ? entry : null; },
    async resolveDecodedPcm() {
      return { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
    }
  };
  const file = { name: 'partial.wav', async arrayBuffer() { return new ArrayBuffer(1); } };

  {
    const { Plugin } = loadPlugin({ libraryService });
    const plugin = new Plugin();
    try {
      assert.equal(await plugin.importFile(file), true);
      assert.match(plugin._statusMessage, /Loading Partial Hall/);
      assert.match(plugin._pendingReadyNotice, /some files were skipped/);
      plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));
      assert.match(plugin._statusMessage, /some files were skipped/);
      assert.equal(plugin._pendingReadyNotice, null);
    } finally {
      plugin.cleanup();
    }
  }

  {
    const { Plugin, window } = loadPlugin({ libraryService });
    const plugin = new Plugin();
    window.workletNode = null;
    try {
      assert.equal(await plugin.importFile(file), true);
      assert.equal(plugin._statusMessage,
        'IR Reverb requires WASM audio processing and will pass dry signal through.');
      assert.match(plugin._pendingReadyNotice, /some files were skipped/);
    } finally {
      plugin.cleanup();
    }
  }
});

test('rapid latency restaging restores the exact retained descriptor configuration', async () => {
  const irId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const entry = { irId, fileLabel: 'Config Hall.wav', composition: 'single', channels: 1 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irId ? entry : null; },
    async resolveDecodedPcm() {
      return { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    assert.equal(await plugin.loadLibraryEntry(entry), true);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));

    plugin.setParameters({ lt: '256' });
    await withTimeout((async () => {
      while (plugin.assets.length < 2) await Promise.resolve();
    })(), '256-sample restage did not finish');
    const revisionB = plugin.getWasmAssetOperationRevision(0);
    const descriptorB = plugin.retainedAssets.get(0);
    const preparedB = plugin._prepared;
    assert.equal(descriptorB.headBlock, 256);
    assert.equal(preparedB.config.headBlock, 256);

    plugin.setParameters({ lt: '512' });
    await withTimeout((async () => {
      while (plugin.assets.length < 3) await Promise.resolve();
    })(), '512-sample restage did not finish');
    const revisionC = plugin.getWasmAssetOperationRevision(0);
    assert.equal(plugin.retainedAssets.get(0).headBlock, 512);
    plugin.retainedAssets.set(0, descriptorB);
    plugin.onWasmAssetRejected(0, 'capacity', revisionC, {
      residentRetained: true,
      retainedOperationRevision: revisionB,
      retainedAssetState: 2
    });

    assert.equal(plugin.lt, '256');
    assert.equal(plugin._prepared, preparedB);
    assert.equal(plugin._prepared.config.headBlock, 256);
    assert.equal(plugin.externalAssetInfo.assetSignature, descriptorB.externalAssetSignature);
    assert.equal(plugin._pendingAssetCandidate.operationRevision, revisionB);
    plugin._wasmAssetOperationRevisions.set(0, revisionB);
    plugin.onWasmAssetState(0, 3, revisionB);
    assert.equal(plugin._committedAssetSnapshot.prepared, preparedB);
  } finally {
    plugin.cleanup();
  }
});

test('retained restage rollback restores every asset-defining control and power bound', async () => {
  const irId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const entry = { irId, fileLabel: 'Control Hall.wav', composition: 'single', channels: 1 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irId ? entry : null; },
    async resolveDecodedPcm(_id, targetRate) {
      return { channels: [new Float32Array([1, 0])], sampleRate: targetRate };
    }
  };
  const channelControl = { value: '' };
  const { Plugin } = loadPlugin({
    libraryService,
    documentRef: { getElementById() { return channelControl; } }
  });
  const plugin = new Plugin();
  try {
    plugin._sampleRate = 96000;
    plugin.setParameters({
      cm: 'mono',
      lt: '256',
      cr: 'full',
      channel: 'L',
      dc: false,
      co: 1,
      dt: 90,
      tr: 95
    });
    assert.equal(await plugin.loadLibraryEntry(entry), true);
    const residentRevision = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, residentRevision);
    const residentDescriptor = plugin.retainedAssets.get(0);
    const residentPrepared = plugin._prepared;
    const residentPowerBound = plugin.powerGainUpperBoundDb;
    assert.equal(Number.isFinite(residentPowerBound), true);

    plugin.setParameters({
      cm: 'auto',
      lt: '512',
      cr: 'half',
      channel: null,
      dc: true,
      co: 9,
      dt: 70,
      tr: 80
    });
    plugin._cancelPreparationTimer();
    assert.equal(await plugin._prepareAndStage(plugin._generation), true);
    const rejectedRevision = plugin.getWasmAssetOperationRevision(0);
    assert.equal(plugin.powerGainUpperBoundDb, null);
    const displayedCandidate = {
      cm: 'auto', lt: '512', cr: 'half', channel: null,
      dc: true, co: 9, dt: 70, tr: 80
    };
    const controlFields = attachAssetControlRows(plugin, displayedCandidate);
    channelControl.value = '';

    plugin.retainedAssets.set(0, residentDescriptor);
    plugin.onWasmAssetRejected(0, 'capacity', rejectedRevision, {
      residentRetained: true,
      retainedOperationRevision: residentRevision,
      retainedAssetState: 3
    });

    assert.equal(plugin._prepared, residentPrepared);
    assert.equal(plugin.powerGainUpperBoundDb, residentPowerBound);
    assert.deepEqual({
      cm: plugin.cm,
      lt: plugin.lt,
      cr: plugin.cr,
      channel: plugin.channel,
      dc: plugin.dc,
      co: plugin.co,
      dt: plugin.dt,
      tr: plugin.tr
    }, {
      cm: 'mono', lt: '256', cr: 'full', channel: 'L',
      dc: false, co: 1, dt: 90, tr: 95
    });
    assert.equal(plugin.externalAssetInfo.assetSignature, residentDescriptor.externalAssetSignature);
    const serialized = plugin.getParameters();
    assert.equal(serialized.cm, 'mono');
    assert.equal(serialized.lt, '256');
    assert.equal(serialized.cr, 'full');
    assert.equal(serialized.channel, 'L');
    assert.equal(controlFields.cm[0].value, 'mono');
    assert.equal(controlFields.lt[0].value, '256');
    assert.equal(controlFields.cr[0].value, 'full');
    assert.equal(controlFields.dc[0].checked, false);
    assert.equal(controlFields.co[0].value, '1');
    assert.equal(controlFields.co[1].value, '1');
    assert.equal(controlFields.dt[0].value, '90');
    assert.equal(controlFields.tr[1].value, '95');
    assert.equal(channelControl.value, 'L');
    const offline = await plugin.createOfflineDspState({
      sampleRate: 96000,
      outputChannelCount: 2
    });
    assert.equal(
      offline.assets.get(0).externalAssetSignature,
      residentDescriptor.externalAssetSignature
    );
  } finally {
    plugin.cleanup();
  }
});

test('IR Reverb pins the resident snapshot across a long bounded rejection history', async () => {
  const irId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const entry = { irId, fileLabel: 'Pinned Hall.wav', composition: 'single', channels: 1 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irId ? entry : null; },
    async resolveDecodedPcm() {
      return { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    assert.equal(await plugin.loadLibraryEntry(entry), true);
    const residentRevision = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, residentRevision);
    const residentDescriptor = plugin.retainedAssets.get(0);
    const residentSnapshot = plugin._committedAssetSnapshot;
    assert.equal(plugin._residentAssetRevisionCandidate.operationRevision, residentRevision);

    let latestRevision = residentRevision;
    for (let index = 0; index < 11; index++) {
      latestRevision = plugin.setWasmAsset(0, {
        payload: Uint8Array.of(index + 2).buffer,
        footprintBytes: 1,
        externalAssetSignature: `candidate-${index}`
      });
      const snapshot = {
        ...residentSnapshot,
        controls: { ...residentSnapshot.controls, lt: index % 2 ? '512' : '256' },
        prepared: { ...residentSnapshot.prepared }
      };
      const candidate = {
        operationRevision: latestRevision,
        generation: plugin._generation,
        kind: 'restage',
        baseline: residentSnapshot,
        snapshot
      };
      plugin._pendingAssetCandidate = candidate;
      plugin._rememberAssetRevisionSnapshot(candidate);
    }
    assert.equal(plugin._assetRevisionSnapshots.size, 2);
    assert.equal(plugin._assetRevisionSnapshots.has(residentRevision), false);
    assert.equal(plugin._findAssetRevisionCandidate(residentRevision).snapshot, residentSnapshot);

    plugin.retainedAssets.set(0, residentDescriptor);
    plugin.onWasmAssetRejected(0, 'module-budget', latestRevision, {
      residentRetained: true,
      retainedOperationRevision: residentRevision,
      retainedAssetState: 3
    });
    assert.equal(plugin._prepared, residentSnapshot.prepared);
    assert.equal(plugin._residentAssetRevisionCandidate.operationRevision, residentRevision);
    assert.equal(plugin._assetRevisionSnapshots.size, 1);
  } finally {
    plugin.cleanup();
  }
});

test('identity replacement preparation failures restore the confirmed asset while initial failures stay clear', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const entries = new Map([
    [irA, { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 }],
    [irB, { irId: irB, fileLabel: 'B Hall.wav', composition: 'single', channels: 1 }]
  ]);
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return entries.get(id) || null; },
    async resolveDecodedPcm(id) {
      return entries.has(id)
        ? { channels: [new Float32Array([id === irA ? 1 : 0.5, 0])], sampleRate: 48000 }
        : null;
    }
  };
  const { Plugin, workerClient } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  const originalEmit = workerClient.emit;
  const publishedParameters = [];
  const publishParameters = plugin.updateParameters.bind(plugin);
  plugin.updateParameters = () => {
    publishedParameters.push({ ...plugin.getParameters() });
    return publishParameters();
  };
  try {
    workerClient.emit = async () => { throw new Error('internal initial emit failure'); };
    assert.equal(await plugin.loadLibraryEntry(entries.get(irA)), false);
    assert.equal(plugin._assetResident, false);
    assert.equal(plugin._prepared, null);

    workerClient.emit = originalEmit;
    assert.equal(await plugin.loadLibraryEntry(entries.get(irA)), true);
    const oldRevision = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, oldRevision);
    const oldDescriptor = plugin.retainedAssets.get(0);
    const oldPrepared = plugin._prepared;
    const oldPcm = plugin._pcm;
    const clearCount = plugin.clearedAssets?.length || 0;

    workerClient.emit = async () => { throw new Error('internal replacement emit failure'); };
    assert.equal(await plugin.loadLibraryEntry(entries.get(irB)), false);
    assert.equal(plugin.ir, irA);
    assert.equal(plugin._irFileLabel, 'A Hall.wav');
    assert.equal(plugin._pcm, oldPcm);
    assert.equal(plugin._prepared, oldPrepared);
    assert.equal(plugin._assetResident, true);
    assert.equal(plugin.retainedAssets.get(0), oldDescriptor);
    assert.equal(plugin.clearedAssets?.length || 0, clearCount);
    assert.equal(publishedParameters.at(-1).ir, irA);
    assert.equal(Object.hasOwn(publishedParameters.at(-1), 'irn'), false);
    assert.equal(plugin._statusMessage,
      'The impulse response could not be prepared. Try a shorter audio file.');
    assert.doesNotMatch(plugin._statusMessage, /internal replacement emit failure/);

    workerClient.emit = originalEmit;
    assert.equal(await plugin.loadLibraryEntry(entries.get(irB)), true);
    plugin.onWasmAssetState(0, 3, plugin.getWasmAssetOperationRevision(0));
    assert.equal(plugin.ir, irB);
    assert.equal(plugin._irFileLabel, 'B Hall.wav');
    assert.notEqual(plugin._prepared, oldPrepared);
  } finally {
    plugin.cleanup();
  }
});

test('cleared and missing IR states ignore delayed notifications from the previous asset', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const entryA = { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 };
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irA ? entryA : null; },
    async resolveDecodedPcm() {
      return { channels: [new Float32Array([1, 0])], sampleRate: 48000 };
    }
  };
  const { Plugin, window } = loadPlugin({ libraryService });
  window.workletNode.port.postMessage = () => {};
  const plugin = new Plugin();
  try {
    assert.equal(await plugin.loadLibraryEntry(entryA), true);
    const firstAssetRevision = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, firstAssetRevision);
    assert.equal(plugin._statusMessage, 'A Hall.wav is ready.');

    plugin._clearIrAsset(false);
    const firstClearRevision = plugin.getWasmAssetOperationRevision(0);
    assert.equal(plugin._statusMessage, 'Import an impulse response to use IR Reverb.');
    plugin.onWasmAssetState(0, 2, firstAssetRevision);
    plugin.onWasmAssetState(0, 4, firstAssetRevision);
    plugin.onWasmAssetRejected(0, 'stale-a', firstAssetRevision);
    assert.equal(plugin._statusMessage, 'Import an impulse response to use IR Reverb.');
    plugin.onWasmAssetState(0, 0, firstClearRevision);
    assert.equal(plugin._statusMessage, 'Import an impulse response to use IR Reverb.');

    assert.equal(await plugin.loadLibraryEntry(entryA), true);
    const secondAssetRevision = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, secondAssetRevision);
    plugin.onWasmAssetRejected(0, 'delayed-a', firstAssetRevision);
    assert.equal(plugin._assetResident, true);
    assert.notEqual(plugin._prepared, null);
    plugin.setSerializedParameters({ ir: irB });
    const secondClearRevision = plugin.getWasmAssetOperationRevision(0);
    assert.equal(await plugin._assetResolutionPromise, false);
    assert.equal(plugin._statusMessage, 'IR not found: IR bbbbbbbb');
    plugin.onWasmAssetState(0, 3, secondAssetRevision);
    plugin.onWasmAssetRejected(0, 'delayed-a', secondAssetRevision);
    assert.equal(plugin._statusMessage, 'IR not found: IR bbbbbbbb');
    plugin.onWasmAssetState(0, 0, secondClearRevision);
    assert.equal(plugin._statusMessage, 'IR not found: IR bbbbbbbb');
  } finally {
    plugin.cleanup();
  }
});

test('serialized lookup restarts under a committed output format before an entry is available', async () => {
  const irId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const entry = { irId, fileLabel: 'Deferred B Hall.wav', composition: 'single', channels: 1 };
  const moduleLoadStarted = deferred();
  const moduleLoadGate = deferred();
  const decodedFormats = [];
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irId ? entry : null; },
    async resolveDecodedPcm(id, targetRate, adapters) {
      assert.equal(id, irId);
      if (adapters.isCurrent?.() === false) return null;
      decodedFormats.push(targetRate);
      return { channels: [new Float32Array([1, 0])], sampleRate: targetRate };
    }
  };
  const { Plugin } = loadPlugin({
    includeWindowLibraryService: false,
    irLibraryModuleLoader() {
      moduleLoadStarted.resolve();
      return moduleLoadGate.promise;
    }
  });
  const plugin = new Plugin();
  try {
    plugin.setSerializedParameters({ ir: irId, cr: 'full', ch: 'A' });
    await withTimeout(moduleLoadStarted.promise, 'serialized library lookup did not start');
    const staleResolution = plugin._assetResolutionPromise;
    const staleGeneration = plugin._generation;

    plugin.getParameters({
      sampleRate: 96000,
      outputChannelCount: 4,
      commitSampleRate: true
    });
    const migratedResolution = plugin._assetResolutionPromise;
    assert.equal(plugin._generation > staleGeneration, true);
    assert.notEqual(migratedResolution, staleResolution);
    assert.equal(plugin._currentRequestedAssetDefinition().ir, irId);
    assert.equal(plugin._currentRequestedAssetDefinition().sampleRate, 96000);
    assert.equal(plugin._currentRequestedAssetDefinition().outputChannelCount, 4);

    moduleLoadGate.resolve({
      getDefaultIrLibraryService() { return libraryService; }
    });
    assert.equal(await withTimeout(staleResolution, 'stale serialized lookup did not settle'), false);
    assert.equal(await withTimeout(migratedResolution, 'migrated serialized lookup did not settle'), true);
    assert.deepEqual(decodedFormats, [96000, 96000]);
    assert.equal(plugin._prepared.sampleRate, 96000);
    assert.equal(plugin._prepared.config.processingChannels, 4);
    assert.equal(plugin._statusMessage.includes('Preparing'), false);
  } finally {
    moduleLoadGate.resolve({ getDefaultIrLibraryService() { return libraryService; } });
    plugin.cleanup();
  }
});

test('output format changes restart an in-flight replacement without staging stale work', async () => {
  const irA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const entryA = { irId: irA, fileLabel: 'A Hall.wav', composition: 'single', channels: 1 };
  const entryB = { irId: irB, fileLabel: 'B Hall.wav', composition: 'single', channels: 1 };
  const firstBStarted = deferred();
  const secondBStarted = deferred();
  const releaseFirstB = deferred();
  const releaseSecondB = deferred();
  const bRates = [];
  const pcmCache = new Map();
  let bCalls = 0;
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irA ? entryA : (id === irB ? entryB : null); },
    async resolveDecodedPcm(id, targetRate, adapters) {
      const cacheKey = `${id}:${targetRate}`;
      if (pcmCache.has(cacheKey)) return pcmCache.get(cacheKey);
      if (id === irA) {
        const pcm = { channels: [new Float32Array([1, 0])], sampleRate: targetRate };
        pcmCache.set(cacheKey, pcm);
        return pcm;
      }
      assert.equal(id, irB);
      bRates.push(targetRate);
      const call = ++bCalls;
      if (call === 1) {
        firstBStarted.resolve();
        await releaseFirstB.promise;
      } else {
        secondBStarted.resolve();
        await releaseSecondB.promise;
      }
      if (adapters.isCurrent?.() === false) return null;
      const pcm = { channels: [new Float32Array([0.5, 0])], sampleRate: targetRate };
      pcmCache.set(cacheKey, pcm);
      return pcm;
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    plugin.setParameters({ cr: 'full' });
    assert.equal(await plugin.loadLibraryEntry(entryA), true);
    const revisionA = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, revisionA);

    const staleLoad = plugin.loadLibraryEntry(entryB);
    await withTimeout(firstBStarted.promise, 'first B decode did not start');
    const staleGeneration = plugin._generation;
    plugin.getParameters({
      sampleRate: 96000,
      outputChannelCount: 4,
      commitSampleRate: true
    });
    await withTimeout(secondBStarted.promise, 'replacement was not restarted for the new format');

    const migrated = plugin._currentRequestedAssetDefinition();
    assert.equal(plugin._generation > staleGeneration, true);
    assert.equal(migrated.ir, irB);
    assert.equal(migrated.sampleRate, 96000);
    assert.equal(migrated.outputChannelCount, 4);
    assert.deepEqual([...plugin.externalAssetInfo.ids], [irA]);
    assert.deepEqual([...plugin.externalAssetInfo.names], ['A Hall.wav']);
    assert.equal(plugin.externalAssetInfo.assetSignature, migrated.externalAssetSignature);
    assert.deepEqual([...plugin.externalAssetInfo.protectedIds].sort(), [irA, irB]);
    assert.deepEqual(JSON.parse(migrated.externalAssetSignature).slice(-2), [96000, 4]);
    assert.equal(plugin.retainedAssets.size, 0);

    releaseFirstB.resolve();
    assert.equal(await withTimeout(staleLoad, 'stale B load did not settle'), false);
    assert.equal(plugin.assets.length, 1);
    releaseSecondB.resolve();
    assert.equal(await withTimeout(plugin._assetResolutionPromise,
      'migrated B load did not settle'), true);
    assert.deepEqual(bRates, [48000, 96000]);
    assert.equal(plugin.assets.length, 2);
    assert.equal(plugin._prepared.sampleRate, 96000);
    assert.deepEqual(JSON.parse(plugin.retainedAssets.get(0).externalAssetSignature).slice(-2),
      [96000, 4]);
    const revisionB = plugin.getWasmAssetOperationRevision(0);
    plugin.onWasmAssetState(0, 3, revisionB);
    assert.deepEqual([...plugin.externalAssetInfo.ids], [irB]);
    assert.deepEqual([...plugin.externalAssetInfo.names], ['B Hall.wav']);
  } finally {
    releaseFirstB.resolve();
    releaseSecondB.resolve();
    plugin.cleanup();
  }
});

test('output-channel changes migrate an initial in-flight IR request', async () => {
  const irB = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const entryB = { irId: irB, fileLabel: 'B Hall.wav', composition: 'single', channels: 1 };
  const starts = [deferred(), deferred()];
  const releases = [deferred(), deferred()];
  const pcmCache = new Map();
  let calls = 0;
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === irB ? entryB : null; },
    async resolveDecodedPcm(id, targetRate, adapters) {
      assert.equal(id, irB);
      if (pcmCache.has(targetRate)) return pcmCache.get(targetRate);
      const call = calls++;
      starts[call].resolve();
      await releases[call].promise;
      if (adapters.isCurrent?.() === false) return null;
      const pcm = { channels: [new Float32Array([1, 0])], sampleRate: targetRate };
      pcmCache.set(targetRate, pcm);
      return pcm;
    }
  };
  const { Plugin } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    plugin.setParameters({ channel: 'A' });
    const staleLoad = plugin.loadLibraryEntry(entryB);
    await withTimeout(starts[0].promise, 'initial B decode did not start');
    plugin.getParameters({ outputChannelCount: 4, commitSampleRate: true });
    await withTimeout(starts[1].promise, 'initial B request was not migrated');
    const migrated = plugin._currentRequestedAssetDefinition();
    assert.equal(migrated.ir, irB);
    assert.equal(migrated.sampleRate, 48000);
    assert.equal(migrated.outputChannelCount, 4);
    assert.equal(plugin.getSerializableParameters().ir, '');
    assert.deepEqual([...plugin.externalAssetInfo.ids], []);
    assert.deepEqual([...plugin.externalAssetInfo.names], []);
    assert.deepEqual([...plugin.externalAssetInfo.protectedIds], [irB]);

    releases[0].resolve();
    assert.equal(await withTimeout(staleLoad, 'stale initial load did not settle'), false);
    releases[1].resolve();
    assert.equal(await withTimeout(plugin._assetResolutionPromise,
      'migrated initial load did not settle'), true);
    assert.equal(plugin.assets.length, 1);
    assert.equal(plugin._prepared.config.processingChannels, 4);
  } finally {
    for (const release of releases) release.resolve();
    plugin.cleanup();
  }
});

test('committed sample-rate changes reload library PCM once and stale reloads cannot stage', async () => {
  const entry = {
    irId: 'eeeeeeeeeeeeeeeeeeeeeeee',
    fileLabel: 'Rate Test Hall.wav',
    composition: 'single',
    channels: 1
  };
  const resolvedRates = [];
  const rateGates = new Map();
  const rateStarts = new Map();
  const libraryService = {
    store: { async updateAnalysis() {} },
    get(id) { return id === entry.irId ? entry : null; },
    async resolveDecodedPcm(id, targetRate, adapters) {
      assert.equal(id, entry.irId);
      resolvedRates.push(targetRate);
      rateStarts.get(targetRate)?.resolve();
      const gate = rateGates.get(targetRate);
      if (gate) await gate.promise;
      if (adapters.isCurrent?.() === false) return null;
      return { channels: [new Float32Array([1, 0])], sampleRate: targetRate };
    }
  };
  const { Plugin, window } = loadPlugin({ libraryService });
  const plugin = new Plugin();
  try {
    plugin.setParameters({ cr: 'full' });
    assert.equal(await withTimeout(plugin.loadLibraryEntry(entry), 'initial IR load did not settle'), true);
    assert.equal(plugin._sampleRate, 48000);
    resolvedRates.length = 0;

    const originalPrepareAndStage = plugin._prepareAndStage.bind(plugin);
    let scheduledRun = deferred();
    plugin._prepareAndStage = generation => {
      const run = originalPrepareAndStage(generation);
      scheduledRun.resolve({ run });
      return run;
    };
    const commitRate = async rate => {
      scheduledRun = deferred();
      window.workletNode.context.sampleRate = rate;
      plugin.getParameters({ sampleRate: rate, commitSampleRate: true });
      return withTimeout(scheduledRun.promise, `${rate} Hz preparation was not scheduled`);
    };

    const generationBeforeOfflineRead = plugin._generation;
    const assetsBeforeOfflineRead = plugin.assets.length;
    plugin.getParameters({ sampleRate: 96000 });
    await Promise.resolve();
    assert.equal(plugin._sampleRate, 48000);
    assert.equal(plugin._generation, generationBeforeOfflineRead);
    assert.equal(plugin.assets.length, assetsBeforeOfflineRead);
    assert.deepEqual(resolvedRates, []);

    const rate96Run = await commitRate(96000);
    assert.equal(await withTimeout(rate96Run.run, '96 kHz preparation did not settle'), true);
    assert.deepEqual(resolvedRates, [96000]);
    assert.equal(plugin._prepared.sampleRate, 96000);

    const generationAt96 = plugin._generation;
    const assetsAt96 = plugin.assets.length;
    plugin.getParameters({ sampleRate: 96000, commitSampleRate: true });
    await Promise.resolve();
    assert.equal(plugin._generation, generationAt96);
    assert.equal(plugin.assets.length, assetsAt96);
    assert.deepEqual(resolvedRates, [96000]);

    const staleRate = 88200;
    const currentRate = 192000;
    rateGates.set(staleRate, deferred());
    rateStarts.set(staleRate, deferred());
    const staleRun = await commitRate(staleRate);
    await withTimeout(rateStarts.get(staleRate).promise, 'stale-rate library reload did not start');
    const currentRun = await commitRate(currentRate);
    assert.equal(await withTimeout(currentRun.run, 'current-rate preparation did not settle'), true);
    rateGates.get(staleRate).resolve();
    assert.equal(await withTimeout(staleRun.run, 'stale-rate preparation did not settle'), false);
    assert.deepEqual(resolvedRates, [96000, staleRate, currentRate]);
    assert.equal(plugin._prepared.sampleRate, currentRate);
    assert.equal(plugin.assets.length, assetsAt96 + 1);
  } finally {
    for (const gate of rateGates.values()) gate.resolve();
    plugin.cleanup();
  }
});

test('IR Reverb exposes EDC series, markers, and revision-matched asset state messages', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._prepared = { ...preparedResult(), config: {} };
  plugin.pd = 25;
  plugin.dc = true;
  plugin._assetResident = true;
  plugin._assetGeneration = plugin._generation;
  const graph = plugin.getEdcGraphData();
  assert.equal(graph.original.edcDb[1], -60);
  assert.equal(graph.current.edcDb[1], -60);
  assert.equal(graph.current.envelope[0], 1);
  assert.equal(graph.markers.onset, 2 / 48000);
  assert.equal(graph.markers.cut, 4 / 48000);
  assert.equal(graph.markers.predelay, 0.025);
  assert.equal(graph.markers.trim, 4 / 48000);
  assert.equal(graph.markers.rt60, 0.5);
  assert.equal(graph.rt60Label, 'RT60 0.50 s');

  const stateRevision = plugin._nextWasmAssetOperationRevision(0);
  plugin.onWasmAssetState(0, 2, stateRevision);
  assert.equal(plugin._statusMessage, 'Preparing the impulse response…');
  plugin.onWasmAssetState(0, 4, stateRevision);
  assert.match(plugin._statusMessage, /Try a shorter file/);
  assert.equal(plugin._prepared, null);
  assert.equal(plugin._assetResident, false);
  plugin._prepared = { ...preparedResult(), config: {} };
  plugin._assetResident = true;
  plugin._assetGeneration = plugin._generation;
  const rejectionRevision = plugin._nextWasmAssetOperationRevision(0);
  plugin.onWasmAssetRejected(0, 'internal-budget-code', rejectionRevision);
  assert.equal(plugin._prepared, null);
  assert.equal(plugin._assetResident, false);
  assert.equal(plugin._statusMessage, 'There is not enough audio-processing memory for this impulse response.');
  assert.doesNotMatch(plugin._statusMessage, /internal-budget-code/);
});

test('IR Reverb clears the EDC canvas when graph data is unavailable', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  const calls = [];
  plugin._graphCanvas = {
    width: 320,
    height: 120,
    getContext() {
      return { clearRect: (...args) => calls.push(args) };
    }
  };
  plugin._drawEdcGraph();
  assert.deepEqual(calls, [[0, 0, 320, 120]]);
});

test('IR Reverb draws the impulse envelope on the graph dB scale', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  const prepared = preparedResult({ frames: 4 });
  prepared.analysis.sampleFrames = Uint32Array.of(0, 1, 2, 3);
  prepared.analysis.envelope = Float32Array.of(1, 0.1, 0.01, 0);
  plugin._prepared = { ...prepared, config: {} };
  const filledPaths = [];
  let currentPath = [];
  const context = {
    clearRect() {},
    setTransform() {},
    fillRect() {},
    beginPath() { currentPath = []; },
    moveTo(x, y) { currentPath.push({ x, y }); },
    lineTo(x, y) { currentPath.push({ x, y }); },
    closePath() {},
    fill() { filledPaths.push([...currentPath]); },
    setLineDash() {},
    stroke() {},
    measureText(text) { return { width: String(text).length * 8 }; },
    fillText() {}
  };
  plugin._graphCanvas = {
    width: 320,
    height: 200,
    getContext() { return context; }
  };

  plugin._drawEdcGraph();

  const envelopePath = filledPaths[0];
  const plotTop = 51;
  const plotBottom = 175;
  const plotHeight = plotBottom - plotTop;
  assert.equal(envelopePath[1].y, plotTop);
  assert.ok(Math.abs(envelopePath[2].y - (plotTop + 20 / 90 * plotHeight)) < 1e-6);
  assert.ok(Math.abs(envelopePath[3].y - (plotTop + 40 / 90 * plotHeight)) < 1e-6);
  assert.equal(envelopePath[4].y, plotBottom);
});

test('IR Reverb EDC graph keeps marker labels in bounds and adds unobstructed one-second ticks', () => {
  const { Plugin } = loadPlugin();
  const plugin = new Plugin();
  plugin._prepared = { ...preparedResult({ frames: 144000 }), config: {} };
  plugin.pd = 0;
  plugin.dc = true;
  const transforms = [];
  const strokes = [];
  const labels = [];
  const context = {
    clearRect() {},
    setTransform(...args) { transforms.push(args); },
    fillRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    fill() {},
    setLineDash() {},
    stroke() { strokes.push(this.strokeStyle); },
    measureText(text) { return { width: String(text).length * 8 }; },
    fillText(text, x, y, maxWidth) {
      labels.push({ text, x, y, maxWidth, color: this.fillStyle, align: this.textAlign });
    }
  };
  plugin._graphCanvas = {
    width: 640,
    height: 320,
    clientWidth: 320,
    clientHeight: 160,
    getContext() { return context; }
  };

  plugin._drawEdcGraph();

  assert.deepEqual(transforms, [[2, 0, 0, 2, 0, 0]]);
  assert.ok(strokes.includes('#444'));
  assert.ok(strokes.includes('#808080'));
  assert.ok(strokes.includes('#00ff00'));
  assert.ok(strokes.includes('#ff0000'));
  const trim = labels.find(label => label.text === 'trim');
  assert.ok(trim);
  assert.ok(trim.x >= 42);
  assert.ok(trim.x + 32 <= 320 - 12);
  const coLocatedLabels = ['onset', 'cut', 'pre-delay'].map(text =>
    labels.find(label => label.text === text));
  assert.ok(coLocatedLabels.every(Boolean));
  assert.equal(new Set(coLocatedLabels.map(label => label.y)).size, coLocatedLabels.length);
  const rt60Labels = labels.filter(label => String(label.text).includes('RT60'));
  assert.equal(rt60Labels.length, 1);
  assert.equal(rt60Labels[0].text, 'RT60 0.50 s');
  assert.equal(rt60Labels[0].color, '#fff');
  const expectedRt60X = 42 + 0.5 / 3 * (320 - 42 - 12) + 4;
  assert.ok(Math.abs(rt60Labels[0].x - expectedRt60X) < 1e-9);
  assert.ok(labels.some(label => label.text === '1 s'));
  assert.ok(labels.some(label => label.text === '2 s'));
  assert.equal(labels.some(label => label.text === '3 s'), false);
  assert.ok(labels.some(label => label.text === 'Time'));
});

test('IR Reverb EDC graph retains the RT60 readout when its marker is unavailable', () => {
  const drawGraph = ({ directCut, rt60Seconds }) => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const prepared = preparedResult({ frames: 48000 });
    prepared.analysis.onsetFrame = 12000;
    prepared.analysis.cutFrame = 24000;
    prepared.analysis.sourceStartFrame = 0;
    prepared.analysis.rt60Seconds = rt60Seconds;
    plugin._prepared = { ...prepared, config: {} };
    plugin.dc = directCut;
    const strokes = [];
    const labels = [];
    let path = [];
    const context = {
      clearRect() {},
      setTransform() {},
      fillRect() {},
      beginPath() { path = []; },
      moveTo(x, y) { path.push({ x, y }); },
      lineTo(x, y) { path.push({ x, y }); },
      closePath() {},
      fill() {},
      setLineDash() {},
      stroke() { strokes.push({ color: this.strokeStyle, path: [...path] }); },
      measureText(text) { return { width: String(text).length * 8 }; },
      fillText(text) { labels.push(String(text)); }
    };
    plugin._graphCanvas = {
      width: 640,
      height: 320,
      clientWidth: 320,
      clientHeight: 160,
      getContext() { return context; }
    };

    plugin._drawEdcGraph();
    return { strokes, labels };
  };
  const verticalMarkers = result => result.strokes.filter(({ path }) =>
    path.length === 2 && path[0].x === path[1].x && path[0].y !== path[1].y);

  const unavailable = drawGraph({ directCut: false, rt60Seconds: null });
  assert.equal(verticalMarkers(unavailable).some(({ color }) => color === '#ff0000'), false);
  assert.equal(verticalMarkers(unavailable).filter(({ color }) => color === '#fff').length, 1);
  assert.deepEqual(unavailable.labels.filter(label => label.includes('RT60')), ['RT60 unavailable']);

  const beyondDuration = drawGraph({ directCut: true, rt60Seconds: 2.5 });
  assert.equal(verticalMarkers(beyondDuration).filter(({ color }) => color === '#fff').length, 1);
  assert.deepEqual(beyondDuration.labels.filter(label => label.includes('RT60')), ['RT60 2.50 s']);
});

test('IR Reverb UI source exposes persistent library and multi-file import controls', () => {
  assert.match(pluginSource, /window\.IRReverbPlugin = IRReverbPlugin/);
  assert.match(pluginSource, /input\.type = 'file'/);
  assert.match(pluginSource, /input\.multiple = true/);
  assert.match(pluginSource, /input\.hidden = true/);
  assert.doesNotMatch(pluginSource, /addEventListener\('drop'/);
  assert.doesNotMatch(pluginSource, /ir-reverb-importer/);
  assert.match(pluginSource, /value: 'true', label: this\._t\('irReverb\.option\.trueStereo', 'True Stereo'\)/);
  assert.match(pluginSource, /value: 'multi', label: this\._t\('irReverb\.option\.diagonalMatrix', 'Diagonal Matrix'\)/);
  assert.match(pluginSource, /this\._t\('irReverb\.action\.chooseLibrary', 'Choose from library…'\)/);
  assert.match(pluginSource, /this\._t\('irReverb\.action\.importFile', 'Import file…'\)/);
  assert.match(pluginSource, /importActions\.className = 'ir-reverb-import-actions'/);
  assert.match(pluginSource, /importActions\.append\(importButton, libraryButton, status\)/);
  assert.match(pluginCss, /\.ir-reverb-status:not\(\[data-state="ready"\]\)\s*\{[^}]*flex-basis: 100%/s);
  assert.match(pluginCss, /body\.layout-desktop \.ir-reverb-status\[data-state="preparing"\],\s*\.ir-reverb-status\[data-state="ready"\]\s*\{[^}]*flex: 0 0 auto/s);
  assert.doesNotMatch(pluginSource, /irReverb\.import\.(?:namePlaceholder|tagsPlaceholder|sourcePlaceholder)/);
  assert.doesNotMatch(pluginSource, /irReverb\.aria\.import(?:Name|Tags|Source)/);
  assert.match(pluginSource, /-db \/ 90/);
  assert.match(pluginSource, /\[0, -30, -60, -90\]/);
});
