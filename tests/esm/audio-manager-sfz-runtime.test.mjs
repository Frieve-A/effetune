import assert from 'node:assert/strict';
import test from 'node:test';
import { audioManagerSfzRuntimeMethods } from '../../js/audio/audio-manager-sfz-runtime.js';
import { audioManagerWasmAssetMethods } from '../../js/audio/audio-manager-wasm-assets.js';
import { AudioManager } from '../../js/audio-manager.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

class SoundFontPlayerPlugin {
  constructor(sf) { this.id = 7; this.sf = sf; this.mc = 1; }
  getParameters() { return { mc: this.mc }; }
}
class SFZNotePlayerPlugin {
  constructor() { this.id = 8; this.sf = 'note-bank'; }
  getParameters() { return {}; }
}

function harness() {
  let primary = { context: { sampleRate: 48000 }, port: { postMessage() {} } };
  let secondary = { context: primary.context, port: { postMessage() {} } };
  const roles = new Map([[primary, 'A'], [secondary, 'B']]);
  const active = new Set([primary, secondary]);
  const plugins = [new SoundFontPlayerPlugin('a-bank'), new SoundFontPlayerPlugin('b-bank')];
  const manager = Object.assign({}, audioManagerSfzRuntimeMethods, {
    _requestDspControl: AudioManager.prototype._requestDspControl,
    _settleDspControlResponse: AudioManager.prototype._settleDspControlResponse,
    _cancelPendingDspControlRequests: AudioManager.prototype._cancelPendingDspControlRequests,
    _audioGraphGeneration: 1, audioContext: primary.context, _parallelBranchSnapshot: {},
    _getPrimaryWorkletNode: () => primary,
    _getActiveDspWorklets: () => active,
    _isActiveDspWorklet: node => active.has(node),
    _parallelBranchForWorklet: node => roles.get(node),
    _wasmAssetMembershipByNode: new Map([[primary, new Map([[7, plugins[0]]])], [secondary, new Map([[7, plugins[1]]])]]),
    _wasmAssetExpectedRevisionsByNode: new Map([[primary, new Map([['7:0', 3]])],
      [secondary, new Map([['7:0', 3]])]])
  });
  const record = (branch, type = 'SoundFontPlayerPlugin') => ({ pluginId: 7, type,
    instanceId: branch === 'A' ? 101 : 202, sf: branch === 'A' ? 'a-bank' : 'b-bank',
    channel: 1, token: 3, graph: 1, sampleRate: 48000, generation: 5,
    clockFrame: 12345, captureFrame: 54321, bytes: Uint8Array.of(branch === 'A' ? 1 : 2) });
  return { manager, active, plugins, record, get primary() { return primary; }, get secondary() { return secondary; },
    replaceGraph() {
      const oldA = primary, oldB = secondary;
      primary = { context: { sampleRate: 96000 }, port: { postMessage() {} } };
      secondary = { context: primary.context, port: { postMessage() {} } };
      active.clear(); active.add(primary); active.add(secondary);
      roles.set(primary, 'A'); roles.set(secondary, 'B');
      manager._wasmAssetMembershipByNode.set(primary, manager._wasmAssetMembershipByNode.get(oldA));
      manager._wasmAssetMembershipByNode.set(secondary, manager._wasmAssetMembershipByNode.get(oldB));
      manager._audioGraphGeneration++;
      manager.audioContext = primary.context;
    } };
}

test('current readiness notifies real limitation changes after initial readiness without refreshing unchanged polls', () => {
  for (const initialCacheReady of [false, true]) {
    const h = harness(), phases = [];
    h.plugins[0].onSfzPreparationProgress = progress => phases.push(progress.phase);
    h.manager._sfzSampleStreams = new Map([[h.primary, new Map([[7,
      { generation: 1, operationRevision: 3, replayEpoch: null, initialCacheReady, limited: false }]])]]);
    const message = { type: 'sfzStreamReadiness', pluginId: 7, generation: 1, operationRevision: 3, replayEpoch: null,
      readiness: { generation: 1, scope: 2, admittedFrames: 0, readyAheadFrames: 0, plannedPages: 4, pendingPages: 0 }, limited: true };
    h.manager._handleSfzRuntimeMessage(h.primary, message);
    h.manager._handleSfzRuntimeMessage(h.primary, { ...message });
    assert.deepEqual(phases, ['limited']);
    message.limited = false;
    h.manager._handleSfzRuntimeMessage(h.primary, message);
    h.manager._handleSfzRuntimeMessage(h.primary, { ...message });
    assert.deepEqual(phases, ['limited', 'ready']);
    h.manager._handleSfzRuntimeMessage(h.secondary, { ...message, limited: true });
    assert.deepEqual(phases, ['limited', 'ready'], 'Another target cannot change this instrument status');
  }
});

test('SFZ stream pump acknowledges onset pages and retires failed source generations', async t => {
  const h = harness(), { manager } = h, messages = [];
  let closed = 0, rejected = 0, polls = 0;
  const guard = setTimeout(() => assert.fail('Sample stream failure did not settle'), 2000);
  t.after(() => { clearTimeout(guard); manager._stopSfzSampleStream(h.primary, 7); manager._cancelPendingDspControlRequests(); });
  let finish;
  const failed = new Promise(resolve => { finish = resolve; });
  h.plugins[0].onWasmAssetRejected = () => { rejected++; finish(); };
  h.plugins[0].getWasmAssetRevisionDescriptor = () => ({ sampleProviderFactory: async ({ generation, publish, onProvider }) => {
    const provider = { close() { closed++; }, async requestPages(requests) {
      assert.deepEqual(requests, [{ generation: 8, sample: 0, pageIndex: 2 }]);
      throw Object.assign(new Error('Source revision changed'), { code: 'source-changed' });
    } };
    onProvider(provider);
    assert.equal(await publish({ generation, sample: 0, pageIndex: 0, frames: 1, channels: 1,
      pcm: new Float32Array([.5]), resident: true }), true);
    return provider;
  } });
  h.primary.port.postMessage = data => {
    messages.push(data);
    if (data.type === 'sfzPublishPage') manager._handleSfzRuntimeMessage(h.primary,
      { type: 'sfzStreamPagesPublished', requestId: data.requestId, ok: true });
    if (data.type === 'sfzPollPages') {
      polls++;
      manager._handleSfzRuntimeMessage(h.primary, { type: 'sfzStreamRequests', requestId: data.requestId,
        ok: true, requests: [{ generation: 8, sample: 0, pageIndex: 2 }] });
    }
  };
  await manager._startSfzSampleStream(h.primary, { pluginId: 7, operationRevision: 3, replayEpoch: null, generation: 8 });
  await failed;
  assert.equal(closed, 1); assert.equal(rejected, 1); assert.equal(polls, 1);
  assert.ok(messages.some(data => data.type === 'sfzStreamFailed' && data.generation === 8));
  assert.equal(manager._sfzSampleStreams.has(h.primary), false);
  assert.equal(manager._pendingDspControlRequests.size, 0);
});

test('SFZ stream cancellation closes a preparing worker and ignores its delayed publication acknowledgment', async t => {
  const h = harness(), { manager } = h;
  let publication, closed = 0, failed = 0;
  t.after(() => { manager._stopSfzSampleStream(h.primary, 7); manager._cancelPendingDspControlRequests(); });
  h.primary.port.postMessage = data => { if (data.type === 'sfzPublishPage') publication = data; };
  h.plugins[0].onWasmAssetRejected = () => { failed++; };
  h.plugins[0].getWasmAssetRevisionDescriptor = () => ({ sampleProviderFactory: async ({ generation, publish, onProvider }) => {
    const provider = { close() { closed++; } }; onProvider(provider);
    assert.equal(await publish({ generation, pcm: new Float32Array(1) }), false);
    return provider;
  } });
  const pending = manager._startSfzSampleStream(h.primary, { pluginId: 7, operationRevision: 3, generation: 10 });
  manager._stopSfzSampleStream(h.primary, 7, 9);
  assert.equal(closed, 0);
  manager._stopSfzSampleStream(h.primary, 7, 10);
  assert.equal(closed, 1);
  manager._handleSfzRuntimeMessage(h.primary, { type: 'sfzStreamPagesPublished', requestId: publication.requestId, ok: true });
  await pending;
  assert.equal(failed, 0); assert.equal(manager._pendingDspControlRequests.size, 0);
});

test('render-clock sample notifications coalesce during publication and cannot wake a retired generation', async t => {
  const h = harness(), { manager } = h;
  let polls = 0, release;
  const decoding = new Promise(resolve => { release = resolve; });
  t.after(() => { release(); manager._stopSfzSampleStream(h.primary, 7); manager._cancelPendingDspControlRequests(); });
  h.plugins[0].getWasmAssetRevisionDescriptor = () => ({ sampleProviderFactory: async ({ onProvider }) => {
    const provider = { close() {}, async requestPages(requests) { if (requests.length) await decoding; } };
    onProvider(provider); return provider;
  } });
  h.primary.port.postMessage = data => {
    if (data.type === 'sfzPollPages') manager._handleSfzRuntimeMessage(h.primary, {
      type: 'sfzStreamRequests', requestId: data.requestId, ok: true,
      requests: ++polls === 1 ? [{ generation: 8, sample: 0, pageIndex: 1 }] : []
    });
  };
  await manager._startSfzSampleStream(h.primary, { pluginId: 7, operationRevision: 3, generation: 8 });
  const notify = generation => manager._handleSfzRuntimeMessage(h.primary,
    { type: 'sfzStreamPollNeeded', pluginId: 7, generation });
  notify(7); notify(8); notify(8);
  assert.equal(polls, 1, 'No concurrent request batch while decoding the previous one');
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(polls, 2, 'Multiple notifications retain exactly one follow-up');
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(polls, 2, 'No timer-driven empty polling when render progress stops');
  manager._stopSfzSampleStream(h.primary, 7, 8);
  notify(8);
  assert.equal(polls, 2);
});

test('MIDI asset readiness waits for the current source preparation and settles on native readiness or cancellation', async t => {
  for (const cancel of [false, true]) {
    const h = harness(), { manager } = h, plugin = h.plugins[0];
    let release, notify = () => {}, ready = false, settled = false;
    const preparing = new Promise(resolve => { release = resolve; });
    const events = new EventTarget();
    Object.assign(manager, {
      waitForEffectiveActiveWasmAssets: audioManagerWasmAssetMethods.waitForEffectiveActiveWasmAssets,
      getEffectiveActiveWasmAssetSnapshot: () => ({ ready }),
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events)
    });
    plugin.addWasmAssetSnapshotChangeListener = listener => {
      notify = listener; return () => { notify = () => {}; };
    };
    plugin.getWasmAssetRevisionDescriptor = () => ({ sampleProviderFactory: async ({ onProvider }) => {
      const provider = { close: release, requestPages: async () => {} }; onProvider(provider);
      await preparing; return provider;
    } });
    const starting = manager._startSfzSampleStream(h.primary,
      { pluginId: 7, operationRevision: 3, replayEpoch: null, generation: 12 });
    const guard = setTimeout(() => assert.fail('Preparation barrier did not settle'), 2000);
    t.after(() => { clearTimeout(guard); manager._stopSfzSampleStream(h.primary, 7); manager._cancelPendingDspControlRequests(); });
    const waiting = manager.waitForEffectiveActiveWasmAssets(plugin, [0], {
      primaryWorklet: h.primary, timeoutMs: 5,
      getPreparation: () => manager.getSfzSamplePreparation(plugin, h.primary)
    }).then(result => { settled = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(settled, false, 'The normal native notification timeout must not cut off source decoding');
    assert.ok(manager.getSfzSamplePreparation(plugin, h.primary));
    if (cancel) manager._stopSfzSampleStream(h.primary, 7, 12);
    else {
      release(); await starting;
      assert.equal(manager.getSfzSamplePreparation(plugin, h.primary), null);
      ready = true; notify();
    }
    const result = await waiting;
    assert.equal(result.ready, !cancel);
    assert.notEqual(result.timedOut, true);
    await starting;
    manager._stopSfzSampleStream(h.primary, 7, 12);
    clearTimeout(guard);
  }
});

test('SFZ checkpoint storage keeps actual A/B instances separate and retains paused records until explicitly cleared', () => {
  const h = harness(), { manager } = h;
  const a = h.record('A'), b = h.record('B');
  assert.equal(manager.storeSfzRuntimeCheckpoints(h.secondary, [b], { generation: 5, position: 2 }), true);
  assert.deepEqual(manager.getSfzRuntimeCheckpoints(h.primary), []);
  assert.equal(manager.storeSfzRuntimeCheckpoints(h.primary, [a]), true);
  assert.equal(manager.getSfzRuntimeCheckpoints(h.primary)[0], a);
  assert.equal(manager.getSfzRuntimeCheckpoints(h.secondary)[0], b);
  assert.equal(manager.getSfzRuntimeCheckpoints(h.secondary)[0], b, 'reading a paused checkpoint does not consume it');
  manager._audioGraphGeneration++;
  assert.equal(manager.getSfzRuntimeCheckpoints(h.primary)[0], a,
    'an unrelated B topology transaction cannot invalidate an unchanged actual A instance');
  assert.equal(manager.storeSfzRuntimeCheckpoints(h.secondary, [{ ...a, sf: 'wrong-bank' }]), false);
  assert.equal(manager.getSfzRuntimeCheckpoints(h.secondary)[0], b);
  manager._wasmAssetExpectedRevisionsByNode.get(h.primary).set('7:0', 4);
  assert.deepEqual(manager.getSfzRuntimeCheckpoints(h.primary), []);
  h.active.delete(h.secondary);
  assert.deepEqual(manager.getSfzRuntimeCheckpoints(h.secondary), []);
});

test('only an explicit planned graph migration authorizes role-preserving checkpoint rate adaptation', () => {
  const h = harness(), { manager } = h;
  manager.storeSfzRuntimeCheckpoints(h.primary, [h.record('A')]);
  manager.storeSfzRuntimeCheckpoints(h.secondary, [h.record('B')]);
  manager.beginSfzRuntimeGraphMigration();
  h.replaceGraph();
  const migratedA = manager.getSfzRuntimeCheckpoints(h.primary)[0];
  assert.equal(migratedA.sf, 'a-bank');
  assert.equal(migratedA.sampleRate, 48000, 'native restore owns rate adaptation, not JS byte editing');
  assert.equal(migratedA.plannedMigration, true);
  assert.equal(migratedA.sameContext, false, 'a new AudioContext cannot infer an elapsed engine-clock gap');
  assert.equal(manager.getSfzRuntimeCheckpoints(h.secondary)[0].sf, 'b-bank');
  manager._parallelBranchSnapshot = {};
  assert.deepEqual(manager.getSfzRuntimeCheckpoints(h.secondary), [], 'a different B session cannot adopt old bytes');
  manager.finishSfzRuntimeGraphMigration();
  assert.deepEqual(manager.getSfzRuntimeCheckpoints(h.primary), [], 'new worklets cannot implicitly search old nodes');
});

test('stale graph checkpoint requests settle and release their bounded guard', async () => {
  const h = harness(), { manager } = h;
  const pending = manager.captureSfzRuntimeCheckpoints({ nodes: [h.primary] });
  assert.equal(manager._pendingDspControlRequests.size, 1);
  manager._audioGraphGeneration++;
  manager._cancelPendingDspControlRequests();
  assert.equal(await pending, false);
  assert.equal(manager._pendingDspControlRequests.size, 0);
});

test('restoring a Note Player on the new node does not hide the paused Player migration record', () => {
  const h = harness(), { manager } = h;
  const note = new SFZNotePlayerPlugin();
  manager._wasmAssetMembershipByNode.get(h.primary).set(8, note);
  manager.storeSfzRuntimeCheckpoints(h.primary, [h.record('A')]);
  manager.beginSfzRuntimeGraphMigration();
  h.replaceGraph();
  const current = { ...h.record('A'), type: 'SFZNotePlayerPlugin', pluginId: 8, instanceId: 303,
    sf: note.sf, channel: 0, sampleRate: 96000 };
  assert.equal(manager.storeSfzRuntimeCheckpoints(h.primary, [current]), true);
  const records = manager.getSfzRuntimeCheckpoints(h.primary);
  assert.equal(records.length, 2);
  assert.equal(records.find(record => record.pluginId === 7).plannedMigration, true);
  assert.equal(records.find(record => record.pluginId === 8), current);
});

test('SFZ runtime activation waits for the actual B target and rejects a cross-target acknowledgement', async () => {
  const h = harness(), { manager } = h;
  const note = new SFZNotePlayerPlugin();
  manager._wasmAssetMembershipByNode.get(h.secondary).set(8, note);
  const sent = [];
  h.secondary.port.postMessage = message => sent.push(message);
  const starting = manager.startSfzRuntimeForAsset(h.secondary, { pluginId: 8, state: 3, operationRevision: 0 });
  assert.equal(sent[0].type, 'sfzStartRuntime');
  const reply = { type: 'sfzRuntimeStarted', requestId: sent[0].requestId, ok: true, checkpoints: [] };
  manager._handleSfzRuntimeMessage(h.primary, reply);
  assert.equal(manager._pendingDspControlRequests.size, 1);
  manager._handleSfzRuntimeMessage(h.secondary, reply);
  assert.equal(await starting, true);
  assert.equal(manager._pendingDspControlRequests.size, 0);
  assert.equal(await manager.startSfzRuntimeForAsset(h.secondary, { pluginId: 8, state: 3, operationRevision: 0 }), true);
  assert.equal(sent.length, 1, 'a repeated ACTIVE asset report cannot redispatch script init or restore old globals');
});

test('a completed failed SFZ restoration still blocks output until a current retry succeeds', async () => {
  const h = harness(), { manager } = h;
  manager._wasmAssetMembershipByNode.get(h.primary).set(8, new SFZNotePlayerPlugin());
  const messages = [];
  h.primary.port.postMessage = message => messages.push(message);
  const first = manager.startSfzRuntimeForAsset(h.primary, { pluginId: 8, state: 3, operationRevision: 0 });
  manager._handleSfzRuntimeMessage(h.primary, { type: 'sfzRuntimeStarted', requestId: messages.at(-1).requestId, ok: false });
  assert.equal(await first, false);
  assert.equal(await manager.waitForSfzRuntimeStarts(), false);
  const retry = manager.startSfzRuntimeForAsset(h.primary, { pluginId: 8, state: 3, operationRevision: 0 });
  manager._handleSfzRuntimeMessage(h.primary, { type: 'sfzRuntimeStarted', requestId: messages.at(-1).requestId, ok: true, checkpoints: [] });
  assert.equal(await retry, true);
  assert.equal(await manager.waitForSfzRuntimeStarts(), true);
});

test('superseded asset readiness and acknowledgements cannot activate or block the replacement Note bank', async () => {
  const h = harness(), { manager } = h;
  manager._wasmAssetMembershipByNode.get(h.primary).set(8, new SFZNotePlayerPlugin());
  const revisions = manager._wasmAssetExpectedRevisionsByNode.get(h.primary);
  revisions.set('8:0', 4);
  const messages = [];
  h.primary.port.postMessage = message => messages.push(message);
  assert.equal(await manager.startSfzRuntimeForAsset(h.primary, { pluginId: 8, state: 3, operationRevision: 3 }), true);
  assert.equal(messages.length, 0);
  const old = manager.startSfzRuntimeForAsset(h.primary, { pluginId: 8, state: 3, operationRevision: 4 });
  revisions.set('8:0', 5);
  manager._handleSfzRuntimeMessage(h.primary, { type: 'sfzRuntimeStarted', requestId: messages.at(-1).requestId, ok: false });
  assert.equal(await old, null);
  assert.equal(await manager.waitForSfzRuntimeStarts(), true, 'a superseded failure cannot pin the new graph');
  const current = manager.startSfzRuntimeForAsset(h.primary, { pluginId: 8, state: 3, operationRevision: 5 });
  manager._handleSfzRuntimeMessage(h.primary, { type: 'sfzRuntimeStarted', requestId: messages.at(-1).requestId, ok: true, checkpoints: [] });
  assert.equal(await current, true);
});

test('planned reset resumes an untouched old graph on abort and retains saved bytes after a failed replacement graph', async () => {
  const oldContext = {};
  let resumed = 0, finished = 0, prepared = 0;
  const manager = Object.assign(Object.create(AudioManager.prototype), {
    audioContext: oldContext, hasSfzRuntimeToPreserve: () => true,
    async prepareSfzRuntimeGraphReset() { prepared++; this._sfzRuntimeMigration = { saved: true }; },
    resumeSfzRuntimes() { resumed++; },
    finishSfzRuntimeGraphMigration() { finished++; this._sfzRuntimeMigration = null; },
    async _rebuildAudioGraph() { return 'Input handoff failed'; }
  });
  assert.equal(await manager._doReset(), 'Input handoff failed');
  assert.equal(prepared, 1); assert.equal(resumed, 1); assert.equal(finished, 1);
  manager._rebuildAudioGraph = async function () { this.audioContext = {}; return 'New graph restore failed'; };
  assert.equal(await manager._doReset(), 'New graph restore failed');
  assert.equal(resumed, 1); assert.equal(finished, 1);
  assert.deepEqual(manager._sfzRuntimeMigration, { saved: true }, 'retry must retain original VM bytes rather than capture the blank replacement');
});


test('failed graph preservation cannot resume MIDI after a newer Stop or Pause command', async t => {
  for (const command of ['unchanged', 'stop', 'pause']) await t.test(command, async () => {
    let rejectPreparation, resumed = 0;
    const pending = new Promise((_, reject) => { rejectPreparation = reject; });
    const player = { midiTimeline: {}, midiPlaying: true, stopRequestToken: 4,
      async playMidi() { resumed++; } };
    const manager = Object.assign(Object.create(AudioManager.prototype), {
      audioContext: {}, prepareSfzRuntimeGraphReset: () => pending,
      resumeSfzRuntimes() {}, finishSfzRuntimeGraphMigration() {}
    });
    await withGlobals({ window: { uiManager: { audioPlayer: { contextManager: player } } } }, async () => {
      const reset = manager._doReset();
      if (command !== 'unchanged') {
        player.stopRequestToken++;
        player.midiPlaying = false;
      }
      rejectPreparation(new Error('Checkpoint request was interrupted'));
      assert.match(await reset, /Instrument playback could not be paused safely/);
      assert.equal(resumed, command === 'unchanged' ? 1 : 0);
    });
  });
});

test('preparation progress counts belong to the current revision and replay epoch, not a retired provider', async () => {
  const h = harness(), progress = [];
  let publishProgress;
  h.plugins[0].onSfzPreparationProgress = event => progress.push(event);
  h.plugins[0].getWasmAssetOperationRevision = () => 3;
  h.plugins[0].getWasmAssetRevisionDescriptor = () => ({ sampleProviderFactory: async ({ onProvider, onProgress }) => {
    publishProgress = onProgress; onProgress({ phase: 'prebuffer', completedCount: 1, totalCount: 2 });
    onProvider({ close() {}, async requestPages() {} });
  } });
  h.manager.getEffectiveActiveWasmAssetSnapshot = () => ({ ready: true });
  h.primary.port.postMessage = data => {
    if (data.type === 'sfzPollPages') h.manager._handleSfzRuntimeMessage(h.primary,
      { type: 'sfzStreamRequests', requestId: data.requestId, ok: true, requests: [] });
  };
  await h.manager._startSfzSampleStream(h.primary, { pluginId: 7, operationRevision: 3, replayEpoch: null, generation: 8 });
  assert.deepEqual(progress[0], { phase: 'prebuffer', completedCount: 1, totalCount: 2, operationRevision: 3, replayEpoch: null });
  assert.equal(progress.at(-1).phase, 'native', 'Starting the provider does not prove that native sample preparation is ready');
  h.manager._handleSfzRuntimeMessage(h.primary, { type: 'sfzStreamReadiness', pluginId: 7,
    generation: 8, operationRevision: 3, replayEpoch: null, limited: false,
    readiness: { generation: 0, scope: 2, admittedFrames: 0, readyAheadFrames: 0, plannedPages: 2, pendingPages: 0 } });
  assert.equal(progress.at(-1).phase, 'ready');
  h.plugins[0].getWasmAssetOperationRevision = () => 4;
  const count = progress.length;
  publishProgress({ phase: 'prebuffer', completedCount: 2, totalCount: 2 });
  assert.equal(progress.length, count);
  h.manager._stopSfzSampleStream(h.primary, 7);
  h.manager._cancelPendingDspControlRequests();
});
