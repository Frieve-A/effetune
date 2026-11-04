import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareOfflineMidiSession, prepareOfflineMidiPlayback, processOfflineMidiBlock } from '../../js/audio/midi-offline.js';

function fixture(slices = [1, 3]) {
    class SoundFontPlayerPlugin {}
    const plugins = slices.map((_, index) => Object.assign(new SoundFontPlayerPlugin(), {
        id: index + 1, enabled: true, getParameters: () => ({})
    }));
    const pending = new Map(), calls = [], processed = new Map();
    const binding = {
        instanceLatency: () => 0, instanceSetSeed: () => 0, hasOfflineGraph: () => true,
        getArenaViews: () => ({ combined: new Float32Array(256) }),
        instanceSetMidiGain: () => 0,
        instanceMidiState: id => pending.get(id) > 0 ? 16 : 0,
        instanceSetMidiClock(id, frame, generation, flags) {
            calls.push({ id, frame, flags, clock: true });
            if (flags === 2) pending.set(id, slices[id - 1]);
            return 0;
        },
        instanceSetMidiEvents(id, events, generation, flags, count = events.length) {
            calls.push({ id, flags, events: events.slice(0, count).map(event => ({ ...event })) });
            return 0;
        },
        instanceWriteMidiCheckpoint(id) {
            assert.equal(pending.get(id), 0);
            return Uint8Array.of(id);
        },
        instanceReadMidiCheckpoint(id, bytes) {
            assert.equal(bytes[0], id);
            pending.set(id, 0);
            return 0;
        }
    };
    const session = { binding, descriptorEligible: true, entries: new Map(plugins.map(plugin => [plugin, {
        plugin, instanceId: plugin.id, typeName: 'SoundFontPlayerPlugin', offlineAssetsReady: true,
        offlineState: { assets: new Map([[0, { tailSeconds: 0 }]]) }
    }])) };
    const midi = prepareOfflineMidiSession(session, { duration: .1, events: [
        { seconds: 0, status: 0xb0, data1: 1, data2: 127 },
        { seconds: 0, status: 0x90, data1: 69, data2: 127 }
    ] }, plugins, 48000);
    const processPending = entry => {
        pending.set(entry.instanceId, pending.get(entry.instanceId) - 1);
        processed.set(entry.instanceId, (processed.get(entry.instanceId) ?? 0) + 1);
    };
    return { midi, session, binding, pending, calls, processed, processPending };
}

test('offline preparation waits for every instrument at source zero and starts live events once', async () => {
    const state = fixture();
    let configured = 0;
    assert.equal(await prepareOfflineMidiPlayback(state.midi, state.session, {
        processPending: state.processPending, isCancelled: () => false,
        configureGraph() {
            configured++;
            assert.deepEqual([...state.processed.values()], [1, 3]);
            assert.equal(state.calls.some(call => call.events?.length), false);
            assert.equal(state.midi.scheduler.currentPosition(100000), 0);
            for (const id of state.pending.keys()) state.pending.set(id, 100);
        }
    }), true);
    assert.equal(configured, 1);
    assert.equal(state.midi.scheduler.currentPosition(0), 0);
    processOfflineMidiBlock(state.midi, state.session, 0, 128);
    for (const id of [1, 2]) {
        const events = state.calls.filter(call => call.id === id && call.events?.length).flatMap(call => call.events);
        assert.deepEqual(events.map(event => [event.status, event.offsetFrames, event.flags]),
            [[0, 0, 32], [0xb0, 0, 0], [0x90, 0, 0]]);
    }
    assert.ok(state.calls.filter(call => call.clock).every(call => call.frame === 0));
});

test('offline preparation cancellation and checkpoint failure cannot start output', async () => {
    const state = fixture([100]);
    let canceled = false;
    assert.equal(await prepareOfflineMidiPlayback(state.midi, state.session, {
        processPending(entry) { state.processPending(entry); canceled = true; },
        isCancelled: () => canceled, configureGraph() { assert.fail('cancelled preparation configured graph'); }
    }), false);
    assert.equal(state.midi.scheduler.playing, false);
    const failed = fixture([1]);
    failed.binding.instanceWriteMidiCheckpoint = () => { throw new Error('capture failed'); };
    await assert.rejects(prepareOfflineMidiPlayback(failed.midi, failed.session, {
        processPending: failed.processPending, isCancelled: () => false,
        configureGraph() { assert.fail('failed checkpoint configured graph'); }
    }), /capture failed/);
    assert.equal(failed.midi.scheduler.playing, false);
});

test('an unprepared offline block cannot silently advance the output cursor', () => {
    const state = fixture();
    assert.throws(() => processOfflineMidiBlock(state.midi, state.session, 0, 128), /not ready/);
    assert.equal(state.calls.some(call => call.events?.length), false);
});
