import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';
import { midiPlaybackMethods } from '../../js/ui/audio-player/midi-playback.js';
import { MidiFrameScheduler } from '../../js/midi/smf-scheduler.js';
import { audioManagerSfzRuntimeMethods } from '../../js/audio/audio-manager-sfz-runtime.js';
import { audioManagerWasmAssetMethods } from '../../js/audio/audio-manager-wasm-assets.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { AudioContextManager } from '../../js/ui/audio-player/audio-context-manager.js';

function harness({ readiness = async () => ({ ready: true }) } = {}) {
  let Processor;
  const sandbox = { ArrayBuffer, DataView, Uint8Array, Float32Array, Map, Set, TextEncoder, TextDecoder,
    sampleRate: 1000, currentFrame: 0, AudioWorkletProcessor: class {}, console,
    registerProcessor(name, type) { if (name === 'plugin-processor') Processor = type; } };
  let source = fs.readFileSync(new URL('../../plugins/audio-processor.js', import.meta.url), 'utf8');
  const scheduler = fs.readFileSync(new URL('../../js/midi/smf-scheduler.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  source = source.replace(/\/\/ __ETMIDI_SCHEDULER_INJECT_START__[\s\S]*?\/\/ __ETMIDI_SCHEDULER_INJECT_END__/,
    () => scheduler);
  vm.runInNewContext(source, sandbox);
  const replies = [];
  const listeners = new Set();
  const native = { paused: false, running: false, frame: 0, generation: 0, events: [], delivered: [] };
  const processor = Object.assign(Object.create(Processor.prototype), {
    currentFrame: 0, bufferPool: {}, plugins: [{ id: 1, type: 'SoundFontPlayerPlugin', enabled: true, parameters: { sf: 'bank', mc: 0 } }],
    wasmInstances: new Map([[1, { id: 7 }]]), dspAssetCache: new Map([[1, new Map([[0, { operationRevision: 3 }]])]]),
    dspLatencyPlan: null, dspLive: true, masterBypass: false,
    powerPolicy: { workletGraphGeneration: 2 }, midiScheduler: new MidiFrameScheduler(1000),
    streamBoundaries: [], transition: { phase: 'open' }, outputReadyRequests: [], visualizerTapNeedsPump: false,
    audioProcessingClockNow: () => 0, finishPipelineCpuMeasurement() {}, hasExecutionLatencyDrift: () => false,
    _invalidatePowerSkipForMutation() {},
    port: { postMessage(message) { replies.push(message); } },
    processPipeline(_inputs, outputs) {
      const frames = outputs[0][0].length;
      for (let frame = 0; frame < frames; frame++) {
        for (const event of native.events) if (event.offsetFrames === frame) {
          if (event.flags === 4 || event.flags === 32 || event.flags === 128) {
            native.frame = event.renderFrame;
            native.running = true;
            native.paused = false;
          }
          if (event.flags === 16) {
            native.frame = event.renderFrame;
            native.paused = true;
          }
        }
        if (native.running && !native.paused) native.frame++;
      }
      native.events.length = 0;
      return true;
    },
    dspBinding: {
      instanceAssetState: () => 3, instanceSetMidiGain: () => 0, instanceMidiState: () => 0,
      instanceSetMidiClock(_id, frame, generation, flags) {
        native.frame = frame;
        native.generation = generation;
        native.running = flags === 1;
        return 0;
      },
      instanceMidiClock: () => ({ frame: native.frame, generation: native.generation }),
      instanceSetMidiEvents(_id, events, _gen, _flags, count = events.length) {
        native.generation = _gen;
        const copied = events.slice(0, count).map(event => ({ ...event }));
        native.events.push(...copied); native.delivered.push(...copied); return 0;
      },
      instanceWriteMidiCheckpoint() {
        assert.equal(native.paused, true);
        const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, native.frame, true); return bytes;
      },
      instanceReadMidiCheckpoint(_id, bytes) {
        native.frame = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
        native.paused = true;
        return 0;
      }
    }
  });
  const sent = [];
  const node = { port: { addEventListener(_type, listener) { listeners.add(listener); }, removeEventListener() {}, start() {},
    postMessage(data) { sent.push(data); processor.handlePortMessage(data); } } };
  const context = { currentTime: 0, sampleRate: 1000 };
  node.context = context;
  const state = { isPlaying: true, playbackMode: 'midi', playbackSpeed: 1 };
  class SoundFontPlayerPlugin {}
  const plugin = Object.assign(new SoundFontPlayerPlugin(), { id: 1, sf: 'bank', enabled: true,
    getParameters: () => ({ sf: 'bank', mc: 0 }), getWasmAssetRevisionDescriptor: () => ({ payload: new ArrayBuffer(4) }) });
  const pipeline = [plugin];
  const timeline = { duration: 1, events: [0, .01, .066, .1].map((seconds, index) => ({ seconds,
    status: index % 2 ? 0x80 : 0x90, data1: 60, data2: index % 2 ? 0 : 100 })) };
  const owner = Object.assign({}, midiPlaybackMethods, { audioPlayer: { audioContext: context },
    audioManager: Object.assign({}, audioManagerSfzRuntimeMethods, {
      workletNode: node, audioContext: context, _getActiveDspWorklets: () => [node],
      _isActiveDspWorklet: target => target === node, getCurrentPipeline: () => pipeline,
      _getPrimaryWorkletNode: () => node,
      _wasmAssetKey: audioManagerWasmAssetMethods._wasmAssetKey,
      getEffectiveActiveWasmAssetSnapshot: audioManagerWasmAssetMethods.getEffectiveActiveWasmAssetSnapshot,
      _wasmAssetMembershipByNode: new Map([[node, new Map([[plugin.id, plugin]])]]),
      _wasmAssetExpectedRevisionsByNode: new Map([[node, new Map([['1:0', 3]])]]),
      _wasmAssetExpectedReplayEpochsByNode: new Map([[node, new Map([['1:0', null]])]]),
      _wasmAssetStatesByNode: new Map([[node, new Map([['1:0', 3]])]]),
      waitForEffectiveActiveWasmAssets: readiness }),
    midiTimeline: timeline,
    playerVolume: 100, playerMute: false,
    getCurrentState: () => state, updateState(patch) { Object.assign(state, patch); }, clearBufferMonitoring() {},
    maintainSilentSource() {} });
  processor.midiScheduler.register(1, 7, 3, 0);
  owner.postMidiTransport(true, 0);
  const render = (frame, frames = 16) => {
    sandbox.currentFrame = frame; processor.currentFrame = frame;
    processor.process([], [[new Float32Array(frames), new Float32Array(frames)]], {});
  };
  const deliver = type => {
    const index = replies.findIndex(message => message.type === type);
    assert.notEqual(index, -1, type);
    const [data] = replies.splice(index, 1);
    for (const listener of listeners) listener({ data });
    return data;
  };
  render(20); context.currentTime = .036;
  return { owner, processor, context, render, deliver, state, replies, native, sent, node, plugin, pipeline };
}

async function waitForPreparationTransport(h) {
  const generation = h.owner.midiGeneration;
  for (let count = 0; count < 32 && !h.sent.some(message =>
    message.type === 'midiTransport' && message.preparing && message.generation === generation); count++) await Promise.resolve();
  assert.ok(h.sent.some(message => message.type === 'midiTransport' && message.preparing &&
    message.generation === generation), 'The asynchronous context phase must finish before native forecast');
}

test('normal telemetry and asset messages do not enter an absent MIDI checkpoint transaction', () => {
  const h = harness();
  for (const type of ['powerObservation', 'assetState', 'wasmTelemetry', 'midiPrepared']) {
    h.replies.push({ type });
    assert.doesNotThrow(() => h.deliver(type));
  }
  assert.equal(h.owner.midiCheckpointRequest, undefined);
  assert.equal(h.owner.midiPlaying, true);
});

test('candidate history preparation retains the committed song presentation until synchronous publication', async t => {
  const h = harness();
  t.after(() => h.owner.stopMidi());
  const oldTimeline = h.owner.midiTimeline;
  const oldPosition = h.owner.getCurrentMidiTime();
  const candidate = { duration: 2, events: [{ seconds: 0, status: 0x90, data1: 96, data2: 100 }] };
  const ready = h.owner.prepareMidiTransport(0, null, candidate, { preservePresentation: true });
  assert.equal(h.owner.midiTimeline, oldTimeline);
  assert.equal(h.owner.getCurrentMidiTime(), oldPosition);
  assert.equal(h.owner.midiPlaying, true);
  await waitForPreparationTransport(h);
  h.render(40);
  h.deliver('midiPrepared');
  assert.equal(await ready, true);
  const preparedGeneration = h.owner.midiGeneration;
  h.owner.midiSource = { old: true };
  let released = 0;
  h.owner.releasePipelineSource = () => { released++; };
  h.owner.releaseMidiPlayback({ preserveTransport: true });
  assert.equal(h.owner.midiGeneration, preparedGeneration);
  assert.equal(released, 1);
  h.owner.midiTimeline = candidate;
  h.owner.startPreparedMidiTransport(0);
  assert.equal(h.sent.at(-1).type, 'midiStart');
  assert.equal(h.sent.at(-1).generation, preparedGeneration);
  assert.equal(h.owner.midiPosition, 0);
  assert.equal(h.processor.midiScheduler.timeline, candidate);
});

test('a timed-out candidate retains generation ownership for rollback without publishing candidate position', async t => {
  const h = harness();
  t.after(() => h.owner.stopMidi());
  let timeout;
  const timer = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 15000) { timeout = callback; return timer(() => {}, 60000); }
    return timer(callback, delay, ...args);
  });
  const position = h.owner.getCurrentMidiTime();
  const ready = h.owner.prepareMidiTransport(0, null, { duration: 2, events: [] }, { preservePresentation: true });
  const generation = h.owner.midiGeneration;
  timeout();
  assert.equal(await ready, false);
  assert.equal(h.owner.midiGeneration, generation);
  assert.equal(h.owner.getCurrentMidiTime(), position);
  assert.equal(h.owner.midiPreparation, null);
});

test('context capacity becomes ready before a candidate map is installed and the old driver stays stopped meanwhile', async t => {
  for (const stopped of [false, true]) await t.test(stopped ? 'Stop wins during context preparation' : 'new capacity precedes its map', async () => {
    const h = harness(), owner = h.owner, previous = owner.midiTimeline;
    const candidate = { duration: 2, events: [] };
    let release, entered = false;
    const ready = new Promise(resolve => { release = resolve; });
    owner.audioManager.getSfzPreparationContext = async () => ({ sampleRate: 1000,
      processingChannels: 2, maxFrames: 16, minimumPhysicalBpm: 15 });
    h.plugin.prepareSfzForContext = async (_context, _node, current, beforeReplay) => {
      assert.equal(h.processor.midiScheduler.timeline, previous);
      assert.equal(beforeReplay(), true);
      assert.equal(h.processor.midiScheduler.playing, false);
      assert.equal(h.processor.midiScheduler.preparing, false);
      assert.equal(h.processor.midiScheduler.timeline, previous);
      entered = true;
      await ready;
      return current();
    };
    const preparation = owner.prepareMidiTransport(0, null, candidate, { preservePresentation: true });
    for (let count = 0; count < 16; count++) {
      if (entered) break;
      await Promise.resolve();
    }
    assert.equal(entered, true);
    const generation = owner.midiGeneration;
    assert.equal(h.sent.some(message => message.timeline === candidate), false);
    assert.equal(owner.midiTimeline, previous);
    if (stopped) await owner.stopMidi();
    release();
    if (stopped) {
      assert.equal(await preparation, false);
      for (let count = 0; count < 8; count++) await Promise.resolve();
      assert.equal(h.sent.some(message => message.timeline === candidate), false);
      assert.ok(owner.midiGeneration > generation);
    } else {
      await waitForPreparationTransport(h);
      assert.equal(h.processor.midiScheduler.timeline, candidate);
      assert.equal(h.sent.at(-1).generation, generation);
      h.render(40); h.deliver('midiPrepared');
      assert.equal(await preparation, true);
      await owner.stopMidi();
    }
  });
});

test('failed MIDI handoff restores only its own native generation through the preparation barrier', async t => {
  for (const superseded of [false, true]) await t.test(superseded ? 'newer stop wins' : 'old song resumes', async () => {
    const h = harness(), owner = h.owner;
    owner.midiSource = { old: true };
    const previous = owner.midiTimeline;
    const next = { duration: 2, events: [] };
    const candidate = { mode: 'midi', backend: 'midi', timeline: next, source: {}, sourceGeneration: 2 };
    let cleaned = 0, released = 0;
    Object.assign(owner, {
      activatePreparedTrackTransition: AudioContextManager.prototype.activatePreparedTrackTransition,
      isActiveTransitionRequest: () => true, resumePlaybackAudioContext: async () => true,
      prepareTransitionCandidate: () => candidate, prepareMidiInstruments: async () => true,
      stagePlaybackActivation: async () => ({}), isPipelineSourceConnected: () => true,
      cleanupPreparedTransitionCandidate: value => { value.cleaned = true; cleaned++; },
      releasePlaybackActivationStage: () => { released++; }
    });
    owner.audioManager.activateStagedAudioCandidate = async (_stage, callbacks) => {
      const preparing = callbacks.prepare();
      assert.equal(owner.midiTimeline, previous);
      await waitForPreparationTransport(h);
      h.render(40); h.deliver('midiPrepared');
      await preparing;
      if (superseded) owner.postMidiTransport(false, 0);
      return { activated: false };
    };
    const result = owner.activatePreparedTrackTransition({}, { sourceGeneration: 2 }, true, null);
    for (let count = 0; count < 12; count++) await Promise.resolve();
    if (!superseded) {
      await waitForPreparationTransport(h);
      assert.equal(h.sent.at(-1).type, 'midiTransport');
      assert.equal(h.sent.at(-1).timeline, previous);
      assert.equal(h.sent.at(-1).preparing, true);
      h.render(60); h.deliver('midiPrepared');
    }
    assert.equal(await result, false);
    assert.equal(owner.midiTimeline, previous);
    assert.equal(owner.midiPlaying, !superseded);
    assert.equal(cleaned, 1); assert.equal(released, 1);
    assert.equal(h.sent.at(-1).type, superseded ? 'midiTransport' : 'midiStart');
    await owner.stopMidi();
  });
});

test('a failed destructive context handoff reprepares the saved descriptor before restoring the old timeline', async () => {
  const h = harness(), owner = h.owner, previous = owner.midiTimeline, oldSource = {};
  owner.midiSource = oldSource;
  const oldDescriptor = { operationRevision: 3, payload: new ArrayBuffer(16), footprintBytes: 64 };
  h.plugin.getWasmAssets = () => new Map([[0, oldDescriptor]]);
  h.plugin.getWasmAssetOperationRevision = () => 3;
  let releaseOld, enteredRestore = false;
  const oldReady = new Promise(resolve => { releaseOld = resolve; });
  owner.audioManager.getSfzPreparationContext = async () => ({ sampleRate: 1000,
    processingChannels: 2, maxFrames: 16, minimumPhysicalBpm: 15 });
  h.plugin.prepareSfzForContext = async (_context, _node, current, beforeReplay) => beforeReplay() && current();
  h.plugin.reprepareWasmAssetContext = (_slot, descriptor) => {
    assert.equal(descriptor, oldDescriptor);
    assert.equal(h.processor.midiScheduler.timeline, previous);
    assert.equal(h.processor.midiScheduler.playing, false);
    assert.equal(h.processor.midiScheduler.preparing, false);
    enteredRestore = true; return 17;
  };
  owner.audioManager.waitForEffectiveActiveWasmAssets = async () => { await oldReady; return { ready: true, stale: false }; };
  owner.audioManager._getSfzRuntimeAssetIdentity = () => ({ token: 3, replayEpoch: 17 });
  const next = { duration: 2, events: [] }, candidate = { mode: 'midi', backend: 'midi', timeline: next, source: {} };
  Object.assign(owner, {
    activatePreparedTrackTransition: AudioContextManager.prototype.activatePreparedTrackTransition,
    isActiveTransitionRequest: () => true, resumePlaybackAudioContext: async () => true,
    prepareTransitionCandidate: () => candidate, prepareMidiInstruments: async () => true,
    stagePlaybackActivation: async () => ({}), isPipelineSourceConnected: () => true,
    cleanupPreparedTransitionCandidate: value => { value.cleaned = true; }, releasePlaybackActivationStage() {}
  });
  owner.audioManager.activateStagedAudioCandidate = async (_stage, callbacks) => {
    const preparation = callbacks.prepare();
    await waitForPreparationTransport(h);
    h.render(40); h.deliver('midiPrepared'); await preparation;
    return { activated: false };
  };
  const result = owner.activatePreparedTrackTransition({}, { sourceGeneration: 2 }, true, null);
  for (let count = 0; count < 48; count++) {
    if (enteredRestore) break;
    await Promise.resolve();
  }
  assert.equal(enteredRestore, true);
  assert.equal(h.sent.at(-1).mode, 'pause');
  assert.equal(h.sent.at(-1).timeline, previous);
  assert.equal(h.sent.at(-1).preparing, false);
  releaseOld();
  for (let count = 0; count < 12; count++) await Promise.resolve();
  await waitForPreparationTransport(h);
  h.render(60); h.deliver('midiPrepared');
  assert.equal(await result, false);
  assert.equal(owner.midiTimeline, previous); assert.equal(owner.midiSource, oldSource);
  assert.equal(owner.midiPlaying, true); assert.equal(h.sent.at(-1).type, 'midiStart');
  await owner.stopMidi();
});

test('manual next and natural repeat commit prepared MIDI without resetting its warmed generation', async t => {
  for (const repeat of [false, true]) await t.test(repeat ? 'natural repeat' : 'manual next', async () => {
    const h = harness(), owner = h.owner, previous = owner.midiTimeline;
    const next = repeat ? previous : { duration: 2, title: 'Next', events: [] };
    const oldSource = {}, source = {}, track = { name: 'MIDI' };
    owner.midiSource = oldSource;
    owner.midiNaturalTail = repeat;
    const prepared = { playableTrack: track, targetIndex: repeat ? 0 : 1, decisionRecord: {} };
    const candidate = { mode: 'midi', backend: 'midi', timeline: next, source, sourceGeneration: 2 };
    const plan = repeat ? {} : null;
    const released = [], noop = () => {};
    Object.assign(owner, {
      activatePreparedTrackTransition: AudioContextManager.prototype.activatePreparedTrackTransition,
      commitPreparedTrackCandidate: AudioContextManager.prototype.commitPreparedTrackCandidate,
      teardownCommittedBackendForTransition: AudioContextManager.prototype.teardownCommittedBackendForTransition,
      isActiveTransitionRequest: () => true, resumePlaybackAudioContext: async () => true,
      prepareTransitionCandidate: () => candidate, prepareMidiInstruments: async () => true,
      stagePlaybackActivation: async () => null,
      prepareMutedCandidateCommit: () => ({ ownership: {}, managedSource: source }),
      setPrivatePipelineSourceMuted: () => true, commitPlayerSourceOwnership: noop,
      releasePipelineSource: value => released.push(value),
      cancelFiniteStreamEnd: noop, cancelScheduledBufferTransition: noop,
      clearRegionBoundaryTimer: noop, releasePartialDecodeBufferReservation: noop,
      revokeCurrentObjectURL: noop, clearActiveRegion: noop, setVideoPresentationSource: noop,
      getDisplayTrackName: () => 'MIDI', loadMetadata: noop, setupBufferMonitoring: noop,
      prepareNextTrackBufferWithRepeatMode: noop, notifyStreamBoundary: noop,
      cleanupPreparedTransitionCandidate: () => assert.fail('A committed source cannot be cleaned'),
      releasePlaybackActivationStage: noop
    });
    owner.audioPlayer.playbackManager = { isPlannedAutomaticMoveCurrent: () => true,
      commitPlannedAutomaticMove(_plan, patch) { Object.assign(h.state, patch); return true; } };
    const result = owner.activatePreparedTrackTransition(prepared, { sourceGeneration: 2 }, true, plan);
    for (let count = 0; count < 8; count++) await Promise.resolve();
    const transport = h.sent.at(-1);
    assert.equal(transport.type, 'midiTransport');
    assert.equal(transport.preparing, true);
    assert.equal(transport.timeline, next);
    assert.equal(transport.preserveRelease, repeat);
    assert.equal(owner.midiTimeline, previous);
    await waitForPreparationTransport(h);
    h.render(40); h.deliver('midiPrepared');
    assert.equal(await result, true);
    assert.equal(candidate.committed, true);
    assert.equal(owner.midiTimeline, next);
    assert.equal(owner.midiSource, source);
    assert.deepEqual(released, [oldSource]);
    assert.equal(h.sent.at(-1).type, 'midiStart');
    assert.equal(h.sent.at(-1).generation, transport.generation);
    assert.equal(h.state.currentTrackPosition, 0);
    assert.equal(h.state.isPlaying, true);
    await owner.stopMidi();
  });
});

test('live preflight never waits for graph or bank preparation and gives one informative notice per song', async t => {
  const notices = [];
  await withGlobals({ window: { uiManager: { showTransientMessage: (...args) => notices.push(args) } } }, async () => {
    const h = harness({ readiness: () => assert.fail('Live preflight cannot wait for an instrument') });
    t.after(() => h.owner.stopMidi());
    const manager = h.owner.audioManager, membership = manager._wasmAssetMembershipByNode.get(h.node);
    manager._wasmAssetMembershipByNode.delete(h.node);
    manager.waitForDspActivationBeforeOutput = () => assert.fail('Live MIDI must not wait for DSP activation');
    assert.equal(await h.owner.prepareMidiInstruments(), true);
    assert.equal(h.owner.midiHasInstruments, false);
    assert.equal(notices.length, 1);
    assert.equal(await h.owner.prepareMidiInstruments(), true);
    assert.equal(notices.length, 1);
    manager._wasmAssetMembershipByNode.set(h.node, membership);
    h.plugin._pending = new Promise(() => {});
    assert.equal(await h.owner.prepareMidiInstruments(), true);
    assert.equal(h.owner.midiHasInstruments, false);
    h.plugin._pending = null;
    assert.equal(await h.owner.prepareMidiInstruments(), true);
    assert.equal(h.owner.midiHasInstruments, true);
    manager._wasmAssetMembershipByNode.delete(h.node);
    manager.waitForDspActivationBeforeOutput = async () => false;
    assert.equal(await h.owner.prepareMidiInstruments(), true);
    assert.equal(notices.length, 1);
  });
});

test('live preflight distinguishes a runtime-retired source from an unavailable instrument', async () => {
  class SoundFontPlayerPlugin {}
  const failed = Object.assign(new SoundFontPlayerPlugin(), { id: 1, sf: 'failed', enabled: true,
    _runtimeAssetErrorRevision: 3, _error: 'playback' });
  const healthy = Object.assign(new SoundFontPlayerPlugin(), { id: 2, sf: 'healthy', enabled: true });
  const nodes = [{}, {}];
  const membership = new Map([[nodes[0], new Map([[1, failed]])], [nodes[1], new Map([[2, healthy]])]]);
  const revisions = new Map([[failed, 3], [healthy, 4]]);
  const owner = Object.assign({}, midiPlaybackMethods, { audioManager: {
    getCurrentPipeline: () => [failed], _wasmAssetMembershipByNode: membership,
    _getActiveDspWorklets: () => nodes,
    _isActiveDspWorklet: node => nodes.includes(node),
    _getSfzRuntimeAssetIdentity: (node, id) => ({ token: revisions.get(membership.get(node).get(id)) }),
    getEffectiveActiveWasmAssetSnapshot: plugin => ({ ready: plugin === healthy }),
    waitForEffectiveActiveWasmAssets: () => assert.fail('Unavailable live targets cannot block playback')
  } });
  assert.equal(await owner.prepareMidiInstruments(), true);
  assert.equal(owner.midiHasInstruments, true);
  // The source fact survives an internal ready replay; it is not keyed to a
  // permanent ERROR phase or an old native instance. Only a new revision clears it.
  healthy.enabled = false;
  await assert.rejects(owner.prepareMidiInstruments(), /instrument stopped playing/);
  assert.equal(owner.midiHasInstruments, true, 'All-failed is not visualizer-only playback');
  healthy.enabled = true;
  revisions.set(failed, 5);
  assert.equal(await owner.prepareMidiInstruments(), true);
  failed._runtimeAssetErrorRevision = null;
  revisions.set(failed, 3);
  failed._error = 'prepare';
  assert.equal(await owner.prepareMidiInstruments(), true, 'Initial load errors remain nonfatal for valid MIDI playback');
});

test('production pause/checkpoint messages retain the worklet-frozen cursor and clock after delayed delivery', async t => {
  const h = harness();
  t.after(() => h.owner.stopMidi());
  const pause = h.owner.pauseMidi();
  for (const frame of [36, 52, 68, 84]) h.render(frame);
  h.context.currentTime = .4;
  const ready = h.deliver('midiPauseReady');
  assert.equal(ready.position, .066);
  h.context.currentTime = .8;
  const packet = h.deliver('midiCheckpoints');
  await pause;
  assert.equal(h.owner.midiPosition, .066);
  assert.equal(h.state.isPaused, true);
  assert.equal(packet.checkpoints[0].cursor, 2, 'Event exactly at the pause boundary remains unprocessed');
  assert.equal(packet.checkpoints[0].clockFrame, 66);
  assert.equal(new DataView(packet.checkpoints[0].bytes.buffer).getFloat64(0, true), 66);
});

test('a graph reset cannot publish a captured MIDI checkpoint after Stop takes ownership', async () => {
  const h = harness();
  const capture = h.owner.prepareMidiGraphReset();
  for (const frame of [36, 52, 68, 84]) h.render(frame);
  h.deliver('midiPauseReady');
  h.deliver('midiCheckpoints');
  assert.equal(h.owner.midiCheckpointAvailable, true);
  await h.owner.stopMidi();
  await capture;
  assert.equal(h.owner.midiRebindCheckpoint, null);
  assert.equal(h.owner.midiCheckpointAvailable, false);
  assert.equal(h.owner.getCurrentMidiTime(), 0);
});

test('health, readiness and checkpoint consumption share actual enabled sections and exclude retired nodes and Note players', async t => {
  const notices = [];
  await withGlobals({ window: { uiManager: { showTransientMessage: (...args) => notices.push(args) } } }, async () => {
    let waits = 0;
    const h = harness({ readiness: async () => { waits++; return { ready: true }; } });
    t.after(() => h.owner.stopMidi());
    await h.owner.prepareMidiInstruments();
    const pause = h.owner.pauseMidi();
    for (const frame of [36, 52, 68, 84]) h.render(frame);
    h.deliver('midiPauseReady'); h.deliver('midiCheckpoints');
    await pause;
    const captured = h.owner.getMidiCheckpointForNode(h.node);
    assert.equal(captured.length, 1);
    const manager = h.owner.audioManager, stale = {};
    const section = { id: 9, constructor: { name: 'SectionPlugin' }, enabled: false };
    const note = { id: 10, constructor: { name: 'SFZNotePlayerPlugin' }, enabled: true, sf: 'note' };
    h.plugin.getWasmAssetRevisionDescriptor = () => ({ payload: new ArrayBuffer(4) });
    Object.assign(manager, {
      _getPrimaryWorkletNode: () => h.node, _getActiveDspWorklets: () => [h.node],
      _wasmAssetKey: audioManagerWasmAssetMethods._wasmAssetKey,
      getEffectiveActiveWasmAssetSnapshot: audioManagerWasmAssetMethods.getEffectiveActiveWasmAssetSnapshot,
      _wasmAssetExpectedRevisionsByNode: new Map([[h.node, new Map([['1:0', 3]])]]),
      _wasmAssetExpectedReplayEpochsByNode: new Map([[h.node, new Map([['1:0', null]])]]),
      _wasmAssetStatesByNode: new Map([[h.node, new Map([['1:0', 3]])]]),
      _wasmAssetMembershipByNode: new Map([[h.node, new Map([[9, section], [1, h.plugin], [10, note]])],
        [stale, new Map([[1, h.plugin]])]])
    });
    assert.equal(manager.getEffectiveActiveWasmAssetSnapshot(h.plugin, [0]).ready, true);
    assert.equal(h.owner.hasHealthyMidiInstruments(), false, 'Native READY behind a disabled section is not an eligible target');
    assert.deepEqual(h.owner.getMidiCheckpointForNode(h.node), []);
    await h.owner.prepareMidiInstruments();
    assert.equal(waits, 0, 'Disabled sections and stale nodes cannot enter readiness');
    assert.equal(h.owner.midiHasInstruments, false);
    assert.equal(notices.length, 1, 'The genuine no-instrument behavior is unchanged');
    section.enabled = true;
    assert.deepEqual([...h.owner.getMidiInstrumentTargets()].map(target => target.plugin), [h.plugin]);
    assert.equal(h.owner.hasHealthyMidiInstruments(), true);
    await h.owner.prepareMidiInstruments();
    assert.equal(waits, 0, 'Live readiness is observed, never awaited');
    assert.deepEqual(h.owner.getMidiCheckpointForNode(h.node), captured);
    h.plugin.enabled = false;
    assert.equal(h.owner.hasHealthyMidiInstruments(), false);
    assert.deepEqual(h.owner.getMidiCheckpointForNode(h.node), []);
  });
});

test('a Stop invalidates an in-flight pause capture without a delayed message changing transport state', async t => {
  const h = harness();
  t.after(() => h.owner.stopMidi());
  const pause = h.owner.pauseMidi();
  for (const frame of [36, 52, 68, 84]) h.render(frame);
  await h.owner.stopMidi();
  const generation = h.owner.midiGeneration;
  h.deliver('midiPauseReady');
  assert.equal(await pause, false);
  assert.equal(h.owner.midiGeneration, generation);
  assert.equal(h.state.isStopped, true);
  assert.equal(h.owner.midiPosition, 0);
});

test('prepared resume restores the captured cursor and activates once at the new block offset', async t => {
  const h = harness();
  t.after(() => h.owner.stopMidi());
  const presentation = h.owner.getMidiPresentation();
  await h.owner.prepareMidiInstruments();
  const pause = h.owner.pauseMidi();
  for (const frame of [36, 52, 68, 84]) h.render(frame);
  h.deliver('midiPauseReady'); h.deliver('midiCheckpoints');
  await pause;
  assert.notEqual(h.owner.getMidiPresentation().generation, presentation.generation);
  assert.equal(h.owner.getMidiPresentation().presentationEpoch, presentation.presentationEpoch);
  const prepared = h.owner.prepareMidiTransport(h.owner.midiPosition);
  await waitForPreparationTransport(h);
  h.render(100);
  h.deliver('midiPrepared');
  assert.equal(await prepared, true);
  assert.equal(h.processor.midiScheduler.instances.get(1).cursor, 2);
  h.context.currentTime = .2;
  h.owner.startPreparedMidiTransport();
  assert.equal(h.owner.getMidiPresentation().presentationEpoch, presentation.presentationEpoch);
  h.native.delivered.length = 0;
  // Consume part of the sample-based start delay without skipping callbacks.
  const frame = h.processor.currentFrame;
  h.render(frame, 12);
  h.render(frame + 12);
  assert.deepEqual(h.native.delivered.map(event => [event.flags, event.offsetFrames, event.renderFrame]),
    [[32, 8, 66], [0, 8, 66]]);
  assert.equal(h.native.delivered[1].status, 0x90);
  h.owner.postMidiTransport(false, h.owner.midiPosition, { mode: 'pause' });
  h.state.isPlaying = false;
  await h.owner.seekMidi(.5);
  const seekEpoch = h.owner.getMidiPresentation().presentationEpoch;
  assert.notEqual(seekEpoch, presentation.presentationEpoch);
  await h.owner.stopMidi();
  assert.notEqual(h.owner.getMidiPresentation().presentationEpoch, seekEpoch);
});

test('SoundFont Player live preflight stays nonblocking and resumes exact captured bytes while clearing only main-player checkpoints', async t => {
  const notices = [];
  await withGlobals({ window: { uiManager: { showTransientMessage: (...args) => notices.push(args) } } }, async () => {
    const h = harness({ readiness: () => assert.fail('Live preflight cannot await bank readiness') });
    t.after(() => h.owner.stopMidi());
    assert.equal(h.owner.midiHasInstruments, undefined, 'The fixture must not predeclare instrument eligibility');
    h.owner.audioManager._wasmAssetStatesByNode.get(h.node).set('1:0', 2);
    assert.equal(await h.owner.prepareMidiInstruments(), true);
    assert.equal(h.owner.midiHasInstruments, false);
    assert.equal(notices.length, 1);
    h.owner.audioManager._wasmAssetStatesByNode.get(h.node).set('1:0', 3);
    assert.equal(await h.owner.prepareMidiInstruments(), true);
    assert.equal(h.owner.midiHasInstruments, true);
    assert.equal(notices.length, 1);

    const pause = h.owner.pauseMidi();
    for (const frame of [36, 52, 68, 84]) h.render(frame);
    h.deliver('midiPauseReady');
    const captured = h.deliver('midiCheckpoints').checkpoints[0];
    await pause;
    assert.equal(captured.type, 'SoundFontPlayerPlugin');
    assert.ok(captured.bytes.byteLength > 0);

    class SFZNotePlayerPlugin {}
    const notePlayer = Object.assign(new SFZNotePlayerPlugin(), { id: 2, sf: 'other', getParameters: () => ({ mc: 0 }) });
    h.pipeline.push(notePlayer);
    h.owner.audioManager._wasmAssetMembershipByNode.get(h.node).set(notePlayer.id, notePlayer);
    const noteCheckpoint = { ...captured, type: 'SFZNotePlayerPlugin', pluginId: 2, sf: 'other',
      instanceId: 8, bytes: new Uint8Array([9]) };
    assert.equal(h.owner.audioManager.storeSfzRuntimeCheckpoints(h.node, [noteCheckpoint]), true);

    const prepared = h.owner.prepareMidiTransport(h.owner.midiPosition);
    await waitForPreparationTransport(h);
    const resume = h.sent.at(-1);
    assert.equal(resume.type, 'midiTransport');
    assert.equal(resume.mode, 'resume');
    assert.equal(resume.preparing, true);
    assert.deepEqual(resume.checkpoints, [captured]);
    assert.equal(resume.checkpoints[0].bytes, captured.bytes, 'Resume must send the exact captured packet, without replay substitution');
    h.render(100);
    h.deliver('midiPrepared');
    assert.equal(await prepared, true);
    h.owner.startPreparedMidiTransport();
    assert.deepEqual(h.owner.audioManager.getSfzRuntimeCheckpoints(h.node), [noteCheckpoint]);

    assert.equal(h.owner.audioManager.storeSfzRuntimeCheckpoints(h.node, [captured]), true);
    h.owner.postMidiTransport(false, 0);
    assert.deepEqual(h.owner.audioManager.getSfzRuntimeCheckpoints(h.node), [noteCheckpoint]);
  });
});

test('pause during uncommitted history preparation cancels its guard without capturing partial runtime state', async t => {
  const h = harness();
  t.after(() => h.owner.stopMidi());
  let canceled = false;
  h.owner.midiPreparation = { finish(value) { canceled = value === false; h.owner.midiPreparation = null; } };
  h.owner.midiPosition = .2;
  await h.owner.pauseMidi();
  assert.equal(canceled, true);
  assert.equal(h.owner.midiCheckpointRequest, undefined);
  assert.equal(h.owner.midiPosition, .2);
  assert.equal(h.state.isPaused, true);
});

test('a graph reset retains a seek target while instrument context preparation is pending', async t => {
  const h = harness();
  t.after(() => h.owner.stopMidi());
  h.owner.midiPosition = .1;
  let entered;
  const preparing = new Promise(resolve => { entered = resolve; });
  let release;
  const context = new Promise(resolve => { release = resolve; });
  h.owner.audioManager.getSfzPreparationContext = () => { entered(); return context; };
  h.plugin.prepareSfzForContext = async () => true;
  const seek = h.owner.seekMidi(.75);
  await preparing;
  await h.owner.prepareMidiGraphReset();
  assert.equal(h.owner.midiPosition, .75);
  assert.equal(h.owner.midiRebindCheckpoint.position, .75);
  assert.equal(h.sent.at(-1).position, .75);
  assert.equal(h.sent.at(-1).mode, 'reset');
  release({});
  await seek;
  assert.equal(h.owner.midiPlaying, false);
  assert.equal(h.owner.midiPosition, .75);
});

test('a failed pause message settles its RPC and removes the timeout guard', async t => {
  const h = harness();
  t.after(() => h.owner.stopMidi());
  const port = h.owner.audioManager.workletNode.port;
  const send = port.postMessage;
  port.postMessage = data => {
    if (data.type === 'midiPause') throw new Error('closed fixture port');
    send(data);
  };
  assert.equal(await h.owner.captureMidiCheckpoints(), false);
  assert.equal(h.owner.midiCheckpointRequest, null);
});

test('a current failed A source cannot pause a healthy actual B member and stale source identities are ignored', () => {
  const h = harness(), manager = h.owner.audioManager;
  const secondary = { port: { postMessage() {}, addEventListener() {}, removeEventListener() {}, start() {} } };
  const active = new Set([h.node, secondary]);
  const other = Object.assign(new h.plugin.constructor(), { id: 2, sf: 'other', enabled: true });
  for (const plugin of [h.plugin, other]) plugin.getWasmAssetRevisionDescriptor = () => ({ payload: new ArrayBuffer(4) });
  Object.assign(manager, {
    _getActiveDspWorklets: () => active, _isActiveDspWorklet: node => active.has(node),
    _wasmAssetKey: audioManagerWasmAssetMethods._wasmAssetKey,
    getEffectiveActiveWasmAssetSnapshot: audioManagerWasmAssetMethods.getEffectiveActiveWasmAssetSnapshot,
    _wasmAssetMembershipByNode: new Map([[h.node, new Map([[1, h.plugin]])], [secondary, new Map([[2, other]])]]),
    _wasmAssetExpectedRevisionsByNode: new Map([[h.node, new Map([['1:0', 3]])], [secondary, new Map([['2:0', 3]])]]),
    _wasmAssetExpectedReplayEpochsByNode: new Map([[h.node, new Map([['1:0', 5]])], [secondary, new Map([['2:0', 5]])]]),
    _wasmAssetStatesByNode: new Map([[h.node, new Map([['1:0', 4]])], [secondary, new Map([['2:0', 3]])]])
  });
  h.owner.postMidiTransport(false, .25, { mode: 'pause' });
  let paused = 0, reported = 0;
  h.owner.pauseMidi = async () => { paused++; };
  h.owner.reportPlaybackSourceFailure = () => { reported++; };
  const error = { type: 'midiTransportError', generation: h.owner.midiGeneration,
    pluginId: 1, operationRevision: 3, replayEpoch: 5, detail: 'Instrument playback stopped' };
  const deliver = changes => { h.replies.push({ ...error, ...changes }); h.deliver('midiTransportError'); };
  deliver();
  assert.equal(paused, 0);
  assert.equal(reported, 0);
  manager._wasmAssetStatesByNode.get(secondary).set('2:0', 2);
  deliver({ operationRevision: 2 });
  deliver({ replayEpoch: 4 });
  active.delete(h.node);
  deliver();
  assert.equal(paused, 0, 'A stale operation, replay epoch or retired node cannot pause the owner');
  active.add(h.node);
  deliver();
  assert.equal(paused, 1, 'A preparing B member is not a healthy survivor');
  assert.equal(reported, 1);
});

test('aggregate survivor health excludes same-revision READY replay using the same retirement fact as preflight', async () => {
  const h = harness(), manager = h.owner.audioManager;
  h.plugin._runtimeAssetErrorRevision = 1;
  h.plugin.getWasmAssetRevisionDescriptor = () => ({ payload: new ArrayBuffer(4) });
  Object.assign(manager, {
    _getPrimaryWorkletNode: () => h.node,
    _wasmAssetKey: audioManagerWasmAssetMethods._wasmAssetKey,
    getEffectiveActiveWasmAssetSnapshot: audioManagerWasmAssetMethods.getEffectiveActiveWasmAssetSnapshot,
    _wasmAssetMembershipByNode: new Map([[h.node, new Map([[1, h.plugin]])]]),
    _wasmAssetExpectedRevisionsByNode: new Map([[h.node, new Map([['1:0', 1]])]]),
    _wasmAssetExpectedReplayEpochsByNode: new Map([[h.node, new Map([['1:0', 5]])]]),
    _wasmAssetStatesByNode: new Map([[h.node, new Map([['1:0', 3]])]])
  });
  assert.equal(manager.getEffectiveActiveWasmAssetSnapshot(h.plugin, [0]).ready, true);
  assert.equal(h.owner.hasHealthyMidiInstruments(), false, 'READY does not revive a retired user asset revision');
  await assert.rejects(h.owner.prepareMidiInstruments(), /instrument stopped playing/);
  manager._wasmAssetExpectedRevisionsByNode.get(h.node).set('1:0', 2);
  assert.equal(h.owner.hasHealthyMidiInstruments(), true, 'A new ready user asset revision is a survivor');
  assert.equal(await h.owner.prepareMidiInstruments(), true);
});



test('a pending bank changes preparation context before its map without waiting for IR or stopping the song clock', async t => {
  const h = harness();
  t.after(() => h.owner.stopMidi());
  h.owner.hasHealthyMidiInstruments = () => false;
  h.plugin.getWasmAssets = () => new Map([[0, {}]]);
  let release;
  const materialized = new Promise(resolve => { release = resolve; });
  const order = [];
  h.owner.audioManager.getSfzPreparationContext = async () => ({ minimumPhysicalBpm: 15 });
  h.plugin.prepareSfzForContext = async (_context, node, current, pause, options) => {
    assert.equal(node, h.node); assert.equal(pause, null); assert.equal(options.waitReady, false);
    await materialized;
    assert.equal(current(), true);
    order.push('abort-and-queue-new-context');
    return true;
  };
  const candidate = { duration: 2, events: [] };
  const before = h.sent.length;
  const ready = h.owner.prepareMidiTransport(0, null, candidate, { preservePresentation: true });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(h.sent.length, before);
  assert.equal(h.owner.midiPlaying, true);
  assert.equal(h.state.isPlaying, true);
  release();
  assert.equal(await ready, true);
  order.push(h.sent.at(-1).timeline === candidate ? 'new-map' : 'wrong-map');
  assert.deepEqual(order, ['abort-and-queue-new-context', 'new-map']);
  assert.equal(h.sent.at(-1).mode, 'live');
  assert.equal(h.sent.at(-1).preparing, false);
  assert.equal(h.owner.midiPlaying, true);
});

test('a bank still in library IO and an empty bank never wait for native geometry before MIDI can continue', async t => {
  const h = harness();
  t.after(() => h.owner.stopMidi());
  h.owner.hasHealthyMidiInstruments = () => false;
  h.plugin.getWasmAssets = () => new Map();
  h.plugin.prepareSfzForContext = () => { throw new Error('No asset exists to prepare'); };
  h.owner.audioManager.getSfzPreparationContext = () => { throw new Error('No-font playback must not wait for the DSP context'); };
  assert.equal(await h.owner.prepareMidiTransport(0, null, { duration: 2, events: [] }), true);
  assert.equal(h.sent.at(-1).mode, 'live');
  assert.equal(h.owner.midiPreparation, null);
});
