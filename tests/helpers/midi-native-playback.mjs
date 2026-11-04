import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { midiPlaybackMethods } from '../../js/ui/audio-player/midi-playback.js';
import { audioManagerWasmAssetMethods } from '../../js/audio/audio-manager-wasm-assets.js';
import { AudioManager } from '../../js/audio-manager.js';

const pluginSources = ['plugin-base.js', 'sfz-instrument.js', 'others/soundfont_player.js']
  .map(path => fs.readFileSync(new URL(`../../plugins/${path}`, import.meta.url), 'utf8')).join('\n');

export function createNativeMidiPlaybackOwner(h, others = [], t) {
  const manager = h.manager;
  for (const other of others) {
    const plugin = other.manager._wasmAssetMembershipByNode.get(other.node).get(7);
    other.adoptPlannedManager(manager, plugin);
  }
  const worklets = [h, ...others], nodes = worklets.map(item => item.node);
  for (const item of others.length ? worklets : []) {
    const membership = manager._wasmAssetMembershipByNode.get(item.node), previous = membership.get(7);
    const window = { workletNode: item.node };
    vm.runInNewContext(pluginSources, { window, document: {}, console: { error() {}, warn() {} },
      MutationObserver: class { observe() {} disconnect() {} }, performance: { now: () => 0 },
      setTimeout, clearTimeout, __EFFECTUNE_WASM_ONLY__: true });
    const plugin = new window.SoundFontPlayerPlugin();
    plugin.id = 7; plugin.sf = previous.sf;
    plugin.getWasmAssetRevisionDescriptor = previous.getWasmAssetRevisionDescriptor;
    plugin._wasmAssetOperationRevisions.set(0, 1);
    plugin._wasmAssetLogicalReplayEpochs.set(0, null);
    plugin._handleMessage({ currentTarget: item.node.port, data: { type: 'assetState', pluginId: 7,
      slot: 0, state: 3, operationRevision: 1, replayEpoch: null } });
    membership.set(7, plugin);
    t.after(() => plugin.cleanup());
  }
  Object.assign(manager, audioManagerWasmAssetMethods, {
    workletNode: h.node, audioContext: h.context,
    _getActiveDspWorklets: () => nodes, _isActiveDspWorklet: node => nodes.includes(node),
    _getPrimaryWorkletNode: () => h.node,
    currentPipeline: 'A',
    pipelineA: [...manager._wasmAssetMembershipByNode.get(h.node).values()],
    pipelineB: others.length ? [...manager._wasmAssetMembershipByNode.get(others[0].node).values()] : [],
    getCurrentPipeline: AudioManager.prototype.getCurrentPipeline,
    _wasmAssetStatesByNode: new Map(worklets.map(item => {
      const entry = item.processor.wasmInstances.get(7);
      return [item.node, new Map([['7:0', entry ? item.binding.instanceAssetState(entry.id, 0) : 0]])];
    })),
    _wasmAssetExpectedRevisionsByNode: new Map(nodes.map(node => [node, new Map([['7:0', 1]])])),
    _wasmAssetExpectedReplayEpochsByNode: new Map(nodes.map(node => [node, new Map([['7:0', null]])]))
  });
  for (const item of worklets) item.node.port.addEventListener('message', ({ data }) => {
    if (data.type === 'assetState') manager._updateWasmAssetState(item.node, data.pluginId, data.slot,
      data.state, data.operationRevision, data.replayEpoch);
  });
  const state = { isPlaying: false, isPaused: true, isStopped: false, playbackMode: 'midi', playbackSpeed: 1 };
  let reported = 0;
  const owner = Object.assign({}, midiPlaybackMethods, { audioManager: manager, audioPlayer: { audioContext: h.context },
    midiTimeline: { duration: 2, events: [{ seconds: 0, status: 0x90, data1: 60, data2: 127 }] },
    midiSource: {}, stopRequestToken: 1, activeSourceGeneration: 1, playerVolume: 100,
    getCurrentState: () => state, updateState: patch => Object.assign(state, patch),
    // Audio/GUI leaf seams; preparation, native readiness, start, error dispatch,
    // pause, checkpoint capture and source ownership all run production methods.
    stagePlaybackActivation: async () => null, releasePlaybackActivationStage() {},
    ensurePipelineSourceConnected: () => true, setPrivatePipelineSourceMuted: () => true,
    getUseInputWithPlayer: () => true, setupBufferMonitoring() {}, clearBufferMonitoring() {},
    maintainSilentSource() {}, rearmPreparedAutomaticMove() {},
    reportPlaybackSourceFailure() { reported++; }, handleTrackEnded() { assert.fail('Unexpected song end'); } });
  return { owner, state, get reported() { return reported; } };
}
