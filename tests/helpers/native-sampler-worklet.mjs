import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { AudioManager } from '../../js/audio-manager.js';
import { audioManagerSfzRuntimeMethods } from '../../js/audio/audio-manager-sfz-runtime.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { instantiateDspBinding } from '../../js/audio/dsp-engine-binding.js';
import { samplePlayerPreparationData } from '../../js/sfz/effect-cost.js';
import { materializeAcceptanceAsset } from './sfz-native-acceptance.mjs';

let artifacts;
function captureArtifacts() {
  artifacts ??= Promise.all([
    fs.readFile(new URL('../../plugins/audio-processor.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../../plugins/dsp/effetune-dsp.wasm', import.meta.url)).then(bytes => WebAssembly.compile(bytes)),
    fs.readFile(new URL('../../plugins/dsp/effetune-dsp.simd.wasm', import.meta.url)).then(bytes => WebAssembly.compile(bytes))
  ]).then(([source, baseline, simd]) => ({ source, baseline, simd }));
  return artifacts;
}

// Native-only harness: the shipped standalone worklet and main-side stream
// lifecycle run unchanged. File readers/providers remain owned by the caller.
export async function createNativeSamplerWorklet({ variant = 'baseline', sampleRate = 48000, channels = 2 } = {}) {
  const captured = await captureArtifacts(), source = captured.source, module = captured[variant];
  const messages = [], errors = [], listeners = new Set();
  let Processor, manager, frame = 0, voicesSeen = 0, closed = false;
  const context = { sampleRate, currentTime: 0 };
  const node = { context, port: {
    addEventListener(_type, listener) { listeners.add(listener); },
    removeEventListener(_type, listener) { listeners.delete(listener); }, start() {},
    postMessage(data) { processor.port.onmessage({ data }); }
  } };
  const sandbox = { WebAssembly, ArrayBuffer, Uint8Array, Uint32Array, Float32Array, Float64Array, DataView,
    TextDecoder, TextEncoder, Map, Set, performance, Date, sampleRate, currentFrame: 0, currentTime: 0,
    console: { log() {}, warn: (...args) => errors.push(args.join(' ')), error: (...args) => errors.push(args.join(' ')) },
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage(data) {
      messages.push(data);
      queueMicrotask(() => {
        if (data.type?.startsWith('sfz') || data.type === 'assetState' || data.type === 'soundFontMixerActionApplied') {
          manager?.handleWorkletMessage({ data }, node);
        }
        for (const listener of listeners) listener({ data });
        if (data.type === 'dspTelemetry') {
          const view = new DataView(data.packet);
          for (let at = 0; at + 16 <= data.bytes;) {
            const length = view.getUint16(at + 12, true);
            if (at + 16 + length > data.bytes) break;
            if (view.getUint16(at, true) === 30 && length >= 2) voicesSeen = Math.max(voicesSeen, view.getUint16(at + 16, true));
            at += (16 + length + 3) & ~3;
          }
          processor.handlePortMessage({ type: 'dspTelemetryReturn', packet: data.packet });
        }
      });
    } }; } },
    registerProcessor(name, Type) { if (name === 'plugin-processor') Processor = Type; }
  };
  vm.runInNewContext(source, sandbox, { filename: 'plugins/audio-processor.js' });
  assert.ok(Processor);
  const processor = new Processor({ processorOptions: { initialOutputChannelCount: channels, lowLatencyMode: false } });
  processor.transition.phase = 'open';
  processor.transition.gain = 1;
  const membership = new Map();
  manager = Object.assign(Object.create(AudioManager.prototype), audioManagerSfzRuntimeMethods, {
    _requestDspControl: AudioManager.prototype._requestDspControl,
    _settleDspControlResponse: AudioManager.prototype._settleDspControlResponse,
    _cancelPendingDspControlRequests: AudioManager.prototype._cancelPendingDspControlRequests,
    workletNode: node, audioContext: context, _audioGraphGeneration: 0,
    _getActiveDspWorklets: () => [node], _isActiveDspWorklet: target => target === node,
    _wasmAssetMembershipByNode: new Map([[node, membership]]),
    _wasmAssetStatesByNode: new Map([[node, new Map()]]),
    _wasmAssetExpectedRevisionsByNode: new Map([[node, new Map()]]),
    _wasmAssetExpectedReplayEpochsByNode: new Map([[node, new Map()]]),
    async estimateSfzEffectPreparation(payload, preparation, formatTag = 1) {
      const control = await instantiateDspBinding(module);
      try {
        const { control: prefix, payloadBytes } = samplePlayerPreparationData(payload);
        return control.estimateSfzEffectPreparation(prefix, preparation, formatTag, payloadBytes);
      } finally { control.destroyEngine(); }
    }
  });
  const input = Array.from({ length: channels }, () => new Float32Array(128));
  const output = Array.from({ length: channels }, () => new Float32Array(128));
  const send = async data => { processor.port.onmessage({ data }); for (let i = 0; i < 6; i++) await Promise.resolve(); };
  const render = (signal = null) => {
    if (signal) { input[0].set(signal); input[1].set(signal); }
    else { input[0].fill(0); input[1].fill(0); }
    sandbox.currentFrame = frame; sandbox.currentTime = frame / sampleRate;
    context.currentTime = frame / sampleRate;
    processor.process([input], [output], {});
    frame += 128; context.currentTime = frame / sampleRate;
    return output;
  };
  const waitFor = async (predicate, { timeout = 15000, renderQuanta = true } = {}) => {
    const deadline = performance.now() + timeout;
    while (!predicate()) {
      if (closed) throw new Error('Native sampler fixture closed');
      if (performance.now() >= deadline) throw new Error(`Native sampler readiness timed out: ${errors.join('\n')}`);
      if (renderQuanta && processor.dspLive) render();
      await new Promise(resolve => setTimeout(resolve, 1));
    }
  };
  const materializeAsset = async (type, asset) => {
    const control = await instantiateDspBinding(module);
    try {
      return await materializeAcceptanceAsset(control, asset, { sampleRate, channels, playerKind: type });
    } finally { control.destroyEngine(); }
  };
  return { processor, get manager() { return manager; }, node, context, messages, errors, send, render, waitFor,
    materializeAsset,
    async waitForJoinReady() {
      await waitFor(() => processor.isSfzInstrumentJoinReady(
        processor.plugins.find(plugin => plugin.id === 7), processor.wasmInstances.get(7)));
    },
    advanceContextWithoutProcessing(frames) {
      assert.ok(Number.isSafeInteger(frames) && frames >= 0 && Number.isSafeInteger(frame + frames));
      frame += frames;
      sandbox.currentFrame = frame; sandbox.currentTime = context.currentTime = frame / sampleRate;
    },
    get frame() { return frame; }, get binding() { return processor.dspBinding; }, get voicesSeen() { return voicesSeen; },
    async initialize(type, asset, parameters = {}) {
      asset.operationRevision ??= 1;
      Object.assign(asset, await materializeAsset(type, asset));
      const packer = DSP_PARAM_PACKERS.get(type);
      assert.ok(packer, `Current generated contract must contain ${type}`);
      const defaults = { enabled: true, sf: 'a'.repeat(24), mc: 0, pl: 64, og: 0,
        ...Object.fromEntries(Array.from({ length: 16 }, (_, channel) => [`sp${channel}`, -1])), ...parameters };
      const plugin = membership.get(7) ?? { id: 7, constructor: { name: type }, sf: defaults.sf, enabled: true,
        getParameters: () => defaults, getWasmAssets: () => new Map([[0, asset]]),
        getWasmAssetOperationRevision: () => asset.operationRevision,
        getWasmAssetRevisionDescriptor: () => asset,
        onWasmAssetRejected(_slot, reason) { errors.push(`Asset rejected: ${reason}`); } };
      membership.set(7, plugin);
      manager._wasmAssetStatesByNode.get(node).set('7:0', 0);
      manager._wasmAssetExpectedRevisionsByNode.get(node).set('7:0', asset.operationRevision ?? null);
      manager._wasmAssetExpectedReplayEpochsByNode.get(node).set('7:0', asset.replayEpoch ?? null);
      await send({ type: 'updatePlugins', plugins: [{ id: 7, type, enabled: true, parameters: defaults,
        inputBus: 0, outputBus: 0, channel: 'A', wasmParams: packer.pack(defaults), wasmParamsHash: packer.hash }], masterBypass: false });
      await send({ type: 'dspEnableTypes', types: [type] });
      await send({ type: 'dspModule', module });
      await waitFor(() => processor.dspLive, { renderQuanta: false });
      assert.equal(processor.dspBinding.hasSfzSampleStreaming(), true, 'Old or gated artifacts cannot supply current runtime evidence');
      const wire = { ...asset }; delete wire.sampleProviderFactory;
      await send({ type: 'setPluginAsset', pluginId: 7, slot: 0, ...wire, formatTag: 1 });
      await waitFor(() => {
        const entry = processor.wasmInstances.get(7);
        const state = entry && (processor.dspBinding.instanceAssetState(entry.id, 0) & 255);
        assert.notEqual(state, 4, `Native instrument preparation failed: ${errors.join('; ')}`);
        assert.ok(!errors.some(error => error.startsWith('Asset rejected:')), errors.join('; '));
        return state === 3;
      }, { timeout: 90000 });
      await waitFor(() => {
        assert.ok(!errors.some(error => error.startsWith('Asset rejected:')), errors.join('; '));
        return !manager.getSfzSamplePreparation(plugin, node);
      });
      assert.equal(await manager.waitForSfzRuntimeStarts(), true);
      return defaults;
    },
    adoptPlannedManager(previous, plugin) {
      manager = previous;
      membership.set(7, plugin);
      manager.workletNode = node; manager.audioContext = context;
      manager._getActiveDspWorklets = () => [node]; manager._isActiveDspWorklet = target => target === node;
      manager._wasmAssetMembershipByNode.set(node, membership);
      manager._audioGraphGeneration++;
    },
    async close() {
      closed = true;
      manager._stopSfzSampleStream(node, 7);
      manager._cancelPendingDspControlRequests();
      processor.disableDspEngine();
      membership.clear(); listeners.clear();
    }
  };
}
