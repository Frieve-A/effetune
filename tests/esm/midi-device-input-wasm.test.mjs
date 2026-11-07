import assert from 'node:assert/strict';
import test from 'node:test';
import { AudioManager } from '../../js/audio-manager.js';
import { EventManager } from '../../js/audio/event-manager.js';
import { audioManagerLiveMidiMethods } from '../../js/audio/audio-manager-live-midi.js';
import { MidiLiveInput } from '../../js/midi/live-input.js';
import { MidiInputState, createMidiChannels, applyMidiEvent } from '../../js/midi/smf-timeline.js';
import { MIDI_EVENT_CAPACITY } from '../../js/midi/smf-scheduler.js';
import { MidiVisualizerAdapter } from '../../js/visualizer/visualizer-midi.js';
import { compileSfzScript } from '../../js/sfz/script-compiler.js';
import { compileAcceptanceInstrument } from '../helpers/sfz-native-acceptance.mjs';
import { createNativeSamplerWorklet } from '../helpers/native-sampler-worklet.mjs';
import { createNativeMidiPlaybackOwner } from '../helpers/midi-native-playback.mjs';
import { withGlobals } from '../helpers/global-test-utils.mjs';

test('bounded input hydration preserves sixteen-channel bank latch, RPN, pressure and current controllers without notes', () => {
    const state = new MidiInputState();
    const event = (status, data1, data2 = 0) => state.apply({ status, data1, data2, seconds: 0 });
    for (let channel = 0; channel < 16; channel++) {
        const cc = (key, value) => event(0xb0 | channel, key, value);
        cc(0, channel); event(0xc0 | channel, channel + 1); cc(0, channel + 16);
        cc(101, 0); cc(100, 0); cc(6, 12); cc(38, 25);
        cc(99, 1); cc(98, 2); cc(6, 99); cc(38, 7);
        event(0xe0 | channel, 1, 80); event(0xd0 | channel, 45); event(0xa0 | channel, 60, 70);
        event(0x90 | channel, 60, 100);
    }
    const restored = createMidiChannels(), bankAtProgram = [];
    for (const event of state.hydration()) {
        assert.ok(![0x80, 0x90].includes(event.status & 0xf0));
        if ((event.status & 0xf0) === 0xc0) bankAtProgram[event.status & 15] = restored[event.status & 15].cc[0];
        applyMidiEvent(restored, event);
    }
    for (let channel = 0; channel < 16; channel++) {
        assert.equal(bankAtProgram[channel], channel);
        assert.equal(restored[channel].cc[0], channel + 16);
        assert.equal(restored[channel].bendRange, 12);
        assert.equal(restored[channel].bendCents, 25);
        assert.equal(restored[channel].cc[99], 1);
        assert.equal(restored[channel].cc[98], 2);
        assert.equal(restored[channel].cc[6], 99);
        assert.equal(restored[channel].polyPressure[60], 70);
        assert.equal(restored[channel].notes.length, 0);
    }
});

async function setup(variant, source = '<region> sample=tone.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.001', options) {
    const h = await createNativeSamplerWorklet({ variant });
    const asset = await compileAcceptanceInstrument(source, options);
    asset.operationRevision = 1;
    try { await h.initialize('SoundFontPlayerPlugin', asset); }
    catch (error) { await h.close(); throw error; }
    const playback = createNativeMidiPlaybackOwner(h);
    const manager = Object.assign(h.manager, audioManagerLiveMidiMethods);
    let receive, leases = 0, powerChange, wake = null;
    const port = { state: 'connected' };
    const power = { started: true, player: null,
        subscribe(callback) { powerChange = callback; callback(); return () => {}; },
        acquireLease() { leases++; return () => { leases--; }; },
        async requestReconcile() { if (wake) await wake.promise; } };
    manager.powerPolicyController = power;
    h.context.state = 'running';
    manager.contextManager = { async resumeAudioContext() { h.context.state = 'running'; } };
    h.node.port.addEventListener('message', ({ data }) => manager._handleLiveMidiInputMessage(h.node, data));
    const input = new MidiLiveInput({ audioManager: manager, powerController: power, manager: {
        onChange() { return () => {}; }, findInput() { return port; },
        async setPerformanceInput(_key, callback) { receive = callback; }
    } });
    await input.select('test-port');
    const send = (data, timeStamp = 0, sourceKey = 'test-port') => receive({ data: new Uint8Array(data), timeStamp, sourceKey, port });
    const pump = async (count, output = []) => {
        for (let i = 0; i < count; i++) {
            output.push(...h.render()[0]);
            await new Promise(resolve => setTimeout(resolve, 1));
        }
        return output;
    };
    return { h, manager, input, power, asset, playback, send, pump, leases: () => leases,
        // A Music Player shown to the user owns MIDI; the tests attach shown players.
        setPlayer(player) { power.player = player && { ui: { container: {} }, ...player }; powerChange(); },
        suspend() {
            h.context.state = 'suspended';
            let resolve; const promise = new Promise(done => { resolve = done; });
            wake = { promise };
            return () => { wake = null; resolve(); };
        },
        async close() { input.dispose(); manager._cancelLiveMidiInput(); await pump(2); await h.close(); }
    };
}

function createLiveInputManager({ rejectNoteOff = false, holdAcks = false } = {}) {
    let held = false;
    const pendingAcks = [];
    const plugin = { id: 7 };
    const frames = [];
    let manager;
    const node = { port: { postMessage(message) {
        if (message.type === 'midiInputConfigure' && !message.enabled) held = false;
        if (message.type !== 'midiInputEvents') return;
        frames.push(...message.events.map(event => event.frame));
        const accepted = !rejectNoteOff || !message.events.some(event => (event.status & 0xf0) === 0x80);
        if (accepted) for (const event of message.events)
            if ((event.status & 0xf0) === 0x90) held = true;
            else if ((event.status & 0xf0) === 0x80) held = false;
        const acknowledge = () => manager._handleLiveMidiInputMessage(node, {
            type: 'midiInputAccepted', requestId: message.requestId, generation: message.generation, accepted
        });
        if (holdAcks) pendingAcks.push(acknowledge);
        else queueMicrotask(acknowledge);
    } } };
    manager = Object.assign({}, audioManagerLiveMidiMethods, {
        audioContext: { currentTime: 0, sampleRate: 48000, state: 'running' },
        powerPolicyController: { started: false, player: null },
        _wasmAssetMembershipByNode: new Map([[node, new Map([[7, plugin]])]]),
        _getActiveDspWorklets: () => [node], _isActiveDspWorklet: target => target === node,
        _liveMidiTargets: () => [{ node, plugin, id: 7, token: 1, ready: true }],
        async waitForEffectiveActiveWasmAssets() { return { ready: true }; }
    });
    manager.setLiveMidiInputSource('test-port');
    const send = (status, data1, data2 = 0, timeStamp = 0) => manager.enqueueLiveMidiInput({
        data: [status, data1, data2], timeStamp, sourceKey: 'test-port'
    });
    const settle = async () => {
        const busy = () => manager._liveMidi.flushing || manager._liveMidi.inflight > 0;
        for (let attempt = 0; attempt < 50 && busy(); attempt++)
            await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(busy(), false);
    };
    return { manager, send, settle, pendingAcks, frames, held: () => held };
}

test('live input manager resets a rejected Note Off without dropping the selected source', async t => {
    t.mock.method(console, 'error', () => {});
    const f = createLiveInputManager({ rejectNoteOff: true });
    f.send(0x90, 60, 127);
    await f.settle();
    assert.equal(f.held(), true);
    const generation = f.manager._liveMidi.generation;
    f.send(0x80, 60);
    await f.settle();
    assert.equal(f.manager.getLiveMidiPresentation().live.channels[0].notes.length, 0);
    assert.equal(f.held(), false, 'lost Note Off must release a voice admitted in the same generation');
    assert.ok(f.manager._liveMidi.generation > generation);
    assert.equal(f.manager._liveMidi.sourceKey, 'test-port');
});

test('live input manager keeps arrival spacing while an earlier batch awaits its render acknowledgement', async () => {
    const f = createLiveInputManager({ holdAcks: true });
    // The render head runs 10 ms ahead of the audible clock.
    f.manager.audioContext = { sampleRate: 48000, state: 'running', get currentTime() { return performance.now() / 1000; },
        getOutputTimestamp() { const now = performance.now(); return { contextTime: now / 1000 - .01, performanceTime: now }; } };
    const first = performance.now();
    f.send(0x90, 60, 100, first);
    await new Promise(resolve => setTimeout(resolve, 4));
    const second = performance.now();
    f.send(0x90, 64, 100, second);
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.pendingAcks.length, 2, 'a later chord note must not wait for the earlier batch to render');
    const error = f.frames[1] - f.frames[0] - (second - first) * 48;
    assert.ok(error > -48 && error < 48, `spacing error ${error} frames`);
    for (const acknowledge of f.pendingAcks) acknowledge();
    await f.settle();
});

test('live input manager retains the selected source after queue overflow', async t => {
    t.mock.method(console, 'error', () => {});
    const f = createLiveInputManager();
    f.send(0x90, 60, 127);
    await f.settle();
    assert.equal(f.held(), true);
    let resume;
    const wake = new Promise(resolve => { resume = resolve; });
    f.manager.audioContext.state = 'suspended';
    f.manager.contextManager = { async resumeAudioContext() {
        await wake;
        f.manager.audioContext.state = 'running';
    } };
    const generation = f.manager._liveMidi.generation;
    for (let index = 0; index <= MIDI_EVENT_CAPACITY; index++) f.send(0xb0, 1, index & 127);
    assert.equal(f.held(), false);
    assert.ok(f.manager._liveMidi.generation > generation);
    assert.equal(f.manager._liveMidi.sourceKey, 'test-port');
    resume();
    await new Promise(resolve => setTimeout(resolve, 0));
    f.send(0x90, 60, 127);
    await f.settle();
    assert.equal(f.held(), true, 'later input from the same selected device must be delivered');
});

test('live input manager accepts normal batches without restarting and ignores a stale failed batch', async t => {
    t.mock.method(console, 'error', () => {});
    const normal = createLiveInputManager();
    const generation = normal.manager._liveMidi.generation;
    normal.send(0x90, 60, 127);
    await normal.settle();
    assert.equal(normal.held(), true);
    assert.equal(normal.manager._liveMidi.generation, generation);

    const stale = createLiveInputManager({ holdAcks: true });
    stale.send(0x90, 60, 127);
    for (let attempt = 0; attempt < 50 && !stale.pendingAcks.length; attempt++)
        await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(stale.pendingAcks.length, 1);
    const old = stale.manager._liveMidi;
    stale.manager.setLiveMidiInputSource('different-port');
    const replacementGeneration = stale.manager._liveMidi.generation;
    stale.pendingAcks[0]();
    await new Promise(resolve => setTimeout(resolve, 0));
    stale.manager._restartLiveMidiInput(old);
    assert.equal(stale.manager._liveMidi.sourceKey, 'different-port');
    assert.equal(stale.manager._liveMidi.generation, replacementGeneration);
});

for (const variant of ['baseline', 'simd']) {
    test(`live ${variant} rejected Note Off releases an active voice and keeps input selected`, async t => {
        const f = await setup(variant);
        t.mock.method(console, 'error', () => {});
        try {
            await f.pump(12);
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).some(value => Math.abs(value) > .01));
            const generation = f.manager._liveMidi.generation;
            // Fill the worklet's bounded queue before the next delivery so it rejects the Note Off.
            f.h.processor.midiScheduler.input.events.length = MIDI_EVENT_CAPACITY;
            f.send([0x80, 60, 0]);
            await f.h.waitFor(() => f.h.messages.some(message => message.type === 'midiInputAccepted' &&
                message.accepted === false), { renderQuanta: false });
            f.h.processor.midiScheduler.input.events.length = 0;
            await new Promise(resolve => setTimeout(resolve, 0));
            assert.ok(f.manager._liveMidi.generation > generation, 'a rejected Note Off must reset the input generation');
            assert.equal(f.manager._liveMidi.sourceKey, 'test-port');
            assert.equal(f.input.activeSource, 'test-port');
            assert.equal(f.manager.getLiveMidiPresentation().live.channels[0].notes.length, 0);
            assert.ok((await f.pump(20)).slice(-512).every(value => Math.abs(value) < 1e-7),
                'the rejected Note Off must not leave the native loop sounding');
        } finally { await f.close(); }
    });

    test(`live ${variant} main queue overflow releases voices and retains the selected input`, async t => {
        const f = await setup(variant);
        t.mock.method(console, 'error', () => {});
        let resume;
        try {
            await f.pump(12);
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).some(value => Math.abs(value) > .01));
            const generation = f.manager._liveMidi.generation;
            resume = f.suspend();
            for (let index = 0; index <= MIDI_EVENT_CAPACITY; index++)
                f.send([0xb0, 1, index & 127], index);
            assert.ok(f.manager._liveMidi.generation > generation);
            assert.equal(f.manager._liveMidi.sourceKey, 'test-port');
            assert.equal(f.input.activeSource, 'test-port');
            resume(); resume = null;
            assert.ok((await f.pump(20)).slice(-512).every(value => Math.abs(value) < 1e-7));
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).some(value => Math.abs(value) > .01),
                'the same selected input must deliver later notes');
        } finally { resume?.(); await f.close(); }
    });

    test(`live ${variant} replacement worklet registration preserves a queued note across graph generations`, async t => {
        const f = await setup(variant);
        const diagnostic = t.mock.method(console, 'error');
        let next, resume;
        try {
            await f.pump(12);
            resume = f.suspend();
            f.send([0x90, 60, 127]);
            const plugin = f.manager._wasmAssetMembershipByNode.get(f.h.node).get(7);
            const snapshotListeners = new Set();
            plugin.addWasmAssetSnapshotChangeListener = listener => {
                snapshotListeners.add(listener);
                return () => snapshotListeners.delete(listener);
            };
            plugin.getWasmAssets = () => new Map([[0, f.asset]]);
            plugin.replayWasmAssetsTo = node => node.port.postMessage({ type: 'setPluginAsset', pluginId: 7,
                slot: 0, ...f.asset, formatTag: 1 });
            next = await createNativeSamplerWorklet({ variant });
            await next.initialize('SoundFontPlayerPlugin', f.asset);
            next.adoptPlannedManager(f.manager, plugin);
            next.context.state = 'running';
            next.node.port.addEventListener('message', ({ data }) => {
                f.manager._handleLiveMidiInputMessage(next.node, data);
                if (data.type === 'assetState') {
                    f.manager._updateWasmAssetState(next.node, data.pluginId,
                        data.slot, data.state, data.operationRevision, data.replayEpoch);
                    for (const listener of snapshotListeners) listener();
                }
            });
            f.manager._wasmAssetMembershipByNode.delete(next.node);
            f.manager.pipeline = [plugin];
            f.manager.pipelineProcessor = { prepareSectionAwarePluginData: () => next.processor.plugins.map(item => ({ ...item })) };
            Object.setPrototypeOf(f.manager, AudioManager.prototype);
            f.manager.runtimeOptions = { externalInput: true };
            f.manager.eventManager = new EventManager(f.manager);
            const generation = f.manager._audioGraphGeneration;
            f.manager._advanceAudioGraphGeneration();
            assert.equal(f.manager._audioGraphGeneration, generation + 1);
            f.manager._syncLiveMidiInputTargets();
            assert.deepEqual(f.manager._liveMidi.queue[0].targets.map(target => target.token), [1], 'graph invalidation is not a user asset removal');
            // Parallel graph preparation publishes membership before replaying
            // its frozen asset map, unlike the ordinary DSP-ready path.
            f.manager._syncWasmAssetMembership(next.node, [plugin], { replayNew: false });
            assert.deepEqual(f.manager._liveMidi.queue[0].targets.map(target => target.token), [1], 'staged membership without a revision is not a replacement');
            f.manager._wasmAssetMembershipByNode.delete(next.node);
            f.manager._applyDspReadyPipeline(next.node, ['SoundFontPlayerPlugin']);
            assert.deepEqual(f.manager._liveMidi.queue[0].targets.map(target => target.token), [1], 'membership registration retains the same operation');
            await next.waitFor(() => (next.binding.instanceAssetState(next.processor.wasmInstances.get(7).id, 0) & 255) === 3);
            resume(); resume = null;
            let peak = 0;
            for (let i = 0; i < 20; i++) {
                for (const value of next.render()[0]) peak = Math.max(peak, Math.abs(value));
                await new Promise(resolve => setTimeout(resolve, 1));
            }
            assert.ok(peak > .01, 'the first accepted note reaches the replacement native worklet');
            assert.deepEqual(next.errors, []);
            assert.equal(diagnostic.mock.callCount(), 0, 'delivery must not depend on retrying a failed readiness wait');
        } finally { resume?.(); await next?.close(); await f.close(); }
    });

    test(`live ${variant} internal replay of the same user asset preserves a pending first note`, async () => {
        const f = await setup(variant);
        try {
            await f.pump(12);
            const resume = f.suspend();
            f.send([0x90, 60, 127]);
            const plugin = f.manager._wasmAssetMembershipByNode.get(f.h.node).get(7);
            plugin.getWasmAssets = () => new Map([[0, f.asset]]);
            plugin.replayWasmAssetsTo = node => node.port.postMessage({ type: 'setPluginAsset', pluginId: 7,
                slot: 0, ...f.asset, formatTag: 1 });
            f.manager._replayPipelineWasmAssets(f.h.node, [plugin], { trackState: true });
            await f.h.waitFor(() => (f.h.binding.instanceAssetState(f.h.processor.wasmInstances.get(7).id, 0) & 255) === 3);
            await f.pump(8);
            resume();
            assert.ok((await f.pump(12)).some(value => Math.abs(value) > .01), 'a READY-at-arrival note survives same-operation internal replay');
            f.send([0x80, 60, 0]);
            assert.ok((await f.pump(20)).slice(-512).every(value => Math.abs(value) < 1e-7));
            f.send([0xb0, 7, 127], 0);
            f.send([0x90, 60, 127], 100);
            await f.pump(8);
            assert.ok(f.h.processor.midiScheduler.input.events.length > 0);
            f.manager._replayPipelineWasmAssets(f.h.node, [plugin], { trackState: true });
            assert.ok((await f.pump(50)).some(value => Math.abs(value) > .01), 'same-operation replay also retains an already scheduled future note');
        } finally { await f.close(); }
    });

    test(`live ${variant} bypass discards past one-shots and queued targets while preserving current controls`, async () => {
        const f = await setup(variant, '<region> sample=tone.wav key=60 loop_mode=one_shot amp_veltrack=0');
        try {
            await f.pump(12);
            const config = f.h.processor.plugins.map(plugin => ({ ...plugin }));
            f.manager.masterBypass = true;
            await f.h.send({ type: 'updatePlugins', plugins: config, masterBypass: true });
            await f.pump(5);
            f.send([0x90, 60, 127]);
            f.send([0x80, 60, 0]);
            assert.ok((await f.pump(12)).every(value => Math.abs(value) < 1e-7));
            assert.equal(f.manager.getLiveMidiPresentation().live.channels[0].notes.length, 0);
            f.manager.masterBypass = false;
            await f.h.send({ type: 'updatePlugins', plugins: config, masterBypass: false });
            assert.ok((await f.pump(12)).every(value => Math.abs(value) < 1e-7), 'bypass-time notes must not replay');

            // The second note is already in the worklet, scheduled in the future.
            f.send([0x90, 60, 127], 0);
            f.send([0x90, 60, 127], 1000);
            await f.pump(8);
            assert.ok(f.h.processor.midiScheduler.input.events.length > 0);
            f.manager.masterBypass = true;
            await f.h.send({ type: 'updatePlugins', plugins: config, masterBypass: true });
            f.send([0xb0, 7, 0]);
            f.send([0x80, 60, 0]);
            await f.pump(8);
            assert.equal(f.h.processor.midiScheduler.input.events.length, 0, 'disabled targets cannot retain scheduled actions');
            f.manager.masterBypass = false;
            await f.h.send({ type: 'updatePlugins', plugins: config, masterBypass: false });
            await f.pump(12);
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).every(value => Math.abs(value) < 1e-7), 'bypass-time CC7 remains current');
            f.send([0x80, 60, 0]);
            await f.pump(40);
            f.send([0xb0, 7, 127]);
            assert.ok((await f.pump(8)).every(value => Math.abs(value) < 1e-7));
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).some(value => Math.abs(value) > .01));
            await f.pump(40);
            const resume = f.suspend();
            f.send([0x90, 60, 127]);
            const plugin = f.manager._wasmAssetMembershipByNode.get(f.h.node).get(7);
            plugin.enabled = false;
            await f.h.send({ type: 'updatePlugins', plugins: config.map(item => ({ ...item, enabled: false })), masterBypass: false });
            f.manager._syncWasmAssetMembership(f.h.node, [plugin], { replayNew: false });
            await f.pump(5);
            plugin.enabled = true;
            await f.h.send({ type: 'updatePlugins', plugins: config, masterBypass: false });
            f.manager._syncWasmAssetMembership(f.h.node, [plugin], { replayNew: false });
            resume();
            assert.ok((await f.pump(12)).every(value => Math.abs(value) < 1e-7), 'disabling a target also retires actions still waiting in the renderer');
        } finally { await f.close(); }
    });

    test(`live ${variant} a muted Music Player does not leave its gain on a new input owner`, async () => {
        const f = await setup(variant);
        const { owner, state } = f.playback;
        owner.releasePipelineSource = () => {};
        try {
            await f.pump(12);
            f.setPlayer({ contextManager: owner });
            owner.playerVolume = 0;
            const playing = owner.playMidi();
            await f.h.waitFor(() => state.isPlaying);
            assert.equal(await playing, true);
            assert.ok((await f.pump(12)).every(value => Math.abs(value) < 1e-7));
            await owner.stopMidi();
            owner.releaseMidiPlayback();
            await f.pump(8);
            f.setPlayer(null);
            await f.pump(8);
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(12)).some(value => Math.abs(value) > .01), 'Live owns unity gain independently of Player volume');
        } finally { await owner.stopMidi(); await f.close(); }
    });

    test(`live ${variant} replacing a queued bank hydrates current controls instead of the old bank snapshot`, async () => {
        const f = await setup(variant);
        try {
            await f.pump(12);
            const resume = f.suspend();
            f.send([0xb0, 7, 0]);
            f.send([0x90, 60, 127]);
            f.asset.operationRevision = 2;
            f.manager._wasmAssetExpectedRevisionsByNode.get(f.h.node).set('7:0', 2);
            await f.h.initialize('SoundFontPlayerPlugin', f.asset);
            await f.pump(8);
            resume();
            assert.ok((await f.pump(8)).every(value => Math.abs(value) < 1e-7));
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).every(value => Math.abs(value) < 1e-7), 'new bank sees current CC7 zero');
            f.send([0xb0, 7, 127]);
            assert.ok((await f.pump(8)).some(value => Math.abs(value) > .01), 'future notes still reach the replacement bank');
        } finally { await f.close(); }
    });

    test(`live ${variant} frozen input can change source and yields to a paused Music Player`, async () => {
        const f = await setup(variant);
        const { owner, state } = f.playback;
        try {
            await f.pump(12);
            const generation = f.manager._liveMidi.generation;
            assert.equal(await f.manager.captureSfzRuntimeCheckpoints({ reason: 'power' }), true);
            await f.input.select('next-port');
            f.send([0x90, 60, 127], 0, 'next-port');
            assert.ok((await f.pump(10)).some(value => Math.abs(value) > .01), 'a new device must not inherit the old power freeze');
            assert.ok(f.manager._liveMidi.generation > generation);
            f.send([0x80, 60, 0], 0, 'next-port');
            await f.pump(20);
            assert.equal(await f.manager.captureSfzRuntimeCheckpoints({ reason: 'power' }), true);
            f.setPlayer({ contextManager: owner });
            const playing = owner.playMidi();
            await f.h.waitFor(() => state.isPlaying);
            assert.equal(await playing, true);
            assert.ok((await f.pump(12)).some(value => Math.abs(value) > .01));
            const pause = owner.pauseMidi();
            await f.h.waitFor(() => !owner.midiCheckpointRequest);
            await pause;
            assert.equal(state.isPaused, true);
            assert.equal(await f.manager.captureSfzRuntimeCheckpoints({ reason: 'power' }), true);
            const id = f.h.processor.wasmInstances.get(7).id;
            const frozen = f.h.binding.instanceMidiClock(id);
            f.manager.resumeSfzRuntimes();
            f.send([0x90, 60, 127], 0, 'next-port');
            assert.ok((await f.pump(12)).every(value => Math.abs(value) < 1e-7), 'power resume must not resume the paused Music Player');
            assert.deepEqual(f.h.binding.instanceMidiClock(id), frozen);
            assert.equal(f.manager.getLiveMidiPresentation(), null);
            const resumed = owner.playMidi();
            await f.h.waitFor(() => state.isPlaying);
            assert.equal(await resumed, true);
            assert.ok((await f.pump(12)).some(value => Math.abs(value) > .01), 'the Music Player still owns its explicit resume');
        } finally {
            owner.midiCheckpointRequest?.finish(false);
            owner.midiPreparation?.finish(false);
            owner.midiNaturalTail = false;
            await owner.stopMidi();
            await f.close();
        }
    });

    test(`live ${variant} production power checkpoint resumes the same native clock and controller state`, async () => {
        const f = await setup(variant);
        try {
            await f.pump(12);
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).some(value => Math.abs(value) > .01));
            f.send([0x80, 60, 0]);
            f.send([0xb0, 7, 0]);
            await f.pump(20);
            const instance = f.h.processor.wasmInstances.get(7).id;
            const before = f.h.binding.instanceMidiClock(instance);
            const generation = f.manager._liveMidi.generation;
            assert.equal(await f.manager.captureSfzRuntimeCheckpoints({ reason: 'power' }), true);
            await f.pump(3);
            assert.equal(f.h.binding.instanceMidiClock(instance).frame, before.frame);
            f.manager.resumeSfzRuntimes();
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).every(value => Math.abs(value) < 1e-7), 'checkpoint keeps current CC7 zero');
            f.send([0xb0, 7, 127]);
            assert.ok((await f.pump(8)).some(value => Math.abs(value) > .01), 'the resumed note reaches native audio');
            const after = f.h.binding.instanceMidiClock(instance);
            assert.equal(after.generation, before.generation);
            assert.ok(after.frame > before.frame);
            assert.equal(f.manager._liveMidi.generation, generation);
            f.send([0x80, 60, 0]);
            assert.ok((await f.pump(20)).slice(-512).every(value => Math.abs(value) < 1e-7));
        } finally { await f.close(); }
    });

    test(`live ${variant} same-asset reactivation hydrates current controls without replaying controller actions`, async () => {
        const script = compileSfzScript('on init declare $callbacks := 0 end on ' +
            'on controller if ($CC_NUM = 1) inc($callbacks) end if end on ' +
            'on note change_vol($EVENT_ID, -6000 * $callbacks) end on');
        const f = await setup(variant, '<control> set_cc7=0 <region> sample=tone.wav key=60 loop_mode=loop_continuous amp_veltrack=0 ampeg_release=.001 ' +
            '<region> sample=tone.wav key=0 on_locc1=1 on_hicc1=127 loop_mode=one_shot amp_veltrack=0', { script });
        try {
            await f.pump(12);
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).every(value => Math.abs(value) < 1e-7), 'unreceived controls retain font initialization');
            f.send([0xb0, 7, 127]);
            const initialPeak = Math.max(...(await f.pump(8)).map(Math.abs));
            assert.ok(initialPeak > .01);
            f.send([0x80, 60, 0]);
            f.send([0xb0, 1, 127]);
            assert.ok((await f.pump(8)).some(value => Math.abs(value) > .01));
            await f.pump(40);
            const plugin = f.manager._wasmAssetMembershipByNode.get(f.h.node).get(7);
            const config = f.h.processor.plugins.map(plugin => ({ ...plugin }));
            const generation = f.manager._liveMidi.generation;
            plugin.enabled = false;
            await f.h.send({ type: 'updatePlugins', plugins: config.map(plugin => ({ ...plugin, enabled: false })), masterBypass: false });
            await f.pump(5);
            plugin.enabled = true;
            await f.h.send({ type: 'updatePlugins', plugins: config, masterBypass: false });
            assert.ok((await f.pump(10)).every(value => Math.abs(value) < 1e-7), 'audible current CC1 must not replay its sample action');
            f.send([0x90, 60, 127]);
            const rejoinedPeak = Math.max(...(await f.pump(8)).map(Math.abs));
            assert.ok(Math.abs(rejoinedPeak - initialPeak) < 1e-7, 'state-only hydration must not repeat the script controller callback');
            f.send([0x80, 60, 0]);
            await f.pump(20);
            plugin.enabled = false;
            await f.h.send({ type: 'updatePlugins', plugins: config.map(plugin => ({ ...plugin, enabled: false })), masterBypass: false });
            await f.pump(5);
            f.send([0xb0, 7, 0]);
            await f.pump(3);
            plugin.enabled = true;
            await f.h.send({ type: 'updatePlugins', plugins: config, masterBypass: false });
            f.manager._syncLiveMidiInputTargets();
            assert.ok((await f.pump(10)).every(value => Math.abs(value) < 1e-7));
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).every(value => Math.abs(value) < 1e-7), 'disabled-time CC7 is the current hydration state');
            f.send([0x80, 60, 0]);
            await f.pump(12);
            f.send([0xb0, 7, 127]);
            assert.ok((await f.pump(8)).every(value => Math.abs(value) < 1e-7), 'hydrating CC1 did not create a hidden controller-triggered voice');
            f.send([0x90, 60, 127]);
            assert.ok((await f.pump(8)).some(value => Math.abs(value) > .01));
            assert.equal(f.manager._liveMidi.generation, generation);
        } finally { await f.close(); }
    });

    test(`live ${variant} absent Player instrument keeps visual MIDI and a later instrument receives future notes only`, async () => {
        const f = await setup(variant);
        try {
            const membership = f.manager._wasmAssetMembershipByNode.get(f.h.node);
            membership.clear();
            await f.h.send({ type: 'updatePlugins', plugins: [], masterBypass: false });
            f.send([0x90, 60, 127], 0);
            await f.pump(3);
            assert.equal(f.manager.getLiveMidiPresentation().live.channels[0].notes.length, 1);
            assert.equal(f.leases(), 0);
            await f.h.initialize('SoundFontPlayerPlugin', f.asset);
            await f.pump(20);
            assert.ok((await f.pump(3)).every(value => Math.abs(value) < 1e-7));
            f.send([0x90, 60, 127], 100);
            assert.ok((await f.pump(8)).some(value => Math.abs(value) > .01));
            f.manager.setLiveMidiInputSource('different-port');
            assert.ok((await f.pump(20)).slice(-512).every(value => Math.abs(value) < 1e-7));
            f.send([0x90, 60, 127], 200);
            assert.ok((await f.pump(3)).every(value => Math.abs(value) < 1e-7), 'the previous device cannot add events to the replacement source');
        } finally { await f.close(); }
    });

    test(`live ${variant} first notes survive context wake and selection alone has no ongoing DSP demand`, async () => {
        const f = await setup(variant);
        try {
            await f.pump(20);
            assert.equal(f.leases(), 0);
            f.h.processor.updateMidiPendingDemand();
            assert.equal(f.h.processor.midiPendingDemand, false);
            const resume = f.suspend();
            f.send([0x9f, 60, 127], 100);
            f.send([0x8f, 60, 0], 120);
            assert.equal(f.leases(), 1);
            assert.equal(f.manager._liveMidi.queue.length, 2);
            resume();
            const audio = await f.pump(50);
            assert.ok(audio.some(value => Math.abs(value) > .01), 'the queued first note must reach actual native audio');
            assert.ok(audio.slice(-512).every(value => Math.abs(value) < 1e-7), 'the queued note-off retains ownership');
            assert.equal(f.leases(), 0);
            f.h.processor.updateMidiPendingDemand();
            assert.equal(f.h.processor.midiPendingDemand, false);
            assert.ok(f.h.messages.some(message => message.type === 'midiInputAccepted' && message.accepted));
        } finally { await f.close(); }
    });

    test(`live ${variant} unloaded fonts hydrate only current state and a paused Music Player owns input`, async () => {
        const notices = [];
        await withGlobals({ window: { uiManager: { showTransientMessage: (...args) => notices.push(args) } } }, async () => {
            const f = await setup(variant);
            try {
                f.manager._wasmAssetExpectedRevisionsByNode.get(f.h.node).set('7:0', 2);
                await f.h.send({ type: 'clearPluginAsset', pluginId: 7, slot: 0, operationRevision: 2 });
                f.send([0xb0, 7, 0], 0); f.send([0x90, 60, 127], 1);
                assert.equal(notices.length, 1);
                await f.pump(2);
                assert.equal(f.leases(), 0);
                const visual = new MidiVisualizerAdapter().snapshot(f.manager.getLiveMidiPresentation());
                assert.equal(visual.notes[0].pitch, 60);
                assert.equal(visual.beat, null, 'a live port does not invent SMF tempo or meter');
                f.asset.operationRevision = 3;
                f.manager._wasmAssetExpectedRevisionsByNode.get(f.h.node).set('7:0', 3);
                await f.h.initialize('SoundFontPlayerPlugin', f.asset);
                await f.pump(20);
                assert.ok((await f.pump(4)).every(value => Math.abs(value) < 1e-7), 'the unavailable held note is not replayed');
                f.send([0x90, 60, 127], 100);
                assert.ok((await f.pump(10)).every(value => Math.abs(value) < 1e-7), 'hydrated CC7 zero remains effective');
                f.send([0xb0, 7, 127], 200);
                assert.ok((await f.pump(10)).some(value => Math.abs(value) > .01));
                f.setPlayer({ stateManager: { isPlaying: false } });
                assert.equal(f.manager.getLiveMidiPresentation(), null);
                assert.ok((await f.pump(20)).slice(-512).every(value => Math.abs(value) < 1e-7));
                f.send([0x90, 60, 127], 300);
                assert.ok((await f.pump(4)).every(value => Math.abs(value) < 1e-7));
            } finally { await f.close(); }
        });
    });
}
