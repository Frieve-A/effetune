import assert from 'node:assert/strict';
import test from 'node:test';
import { LegacySyncEngine } from '../../js/remote/legacy-sync-engine.js';
import { applyOps } from '../../js/remote/sync-ops.mjs';
import { createRemotePresetHost } from '../../js/remote/remote-client.js';

test('original v1 peers receive only original operations and reconnect adopts the host state', () => {
    let state = { pipeline: [], ids: [], masterBypass: false, slot: 'A' };
    const sent = [];
    const engine = new LegacySyncEngine({
        adapter: { snapshot: () => structuredClone(state), apply: ops => { state = applyOps(state, ops).snapshot; } },
        send: message => { sent.push(message); return Promise.resolve({ ok: true }); }
    });
    engine.onConnected();
    engine.onState({ pipeline: [{ nm: 'Volume', en: true, vl: -3 }], masterBypass: true });
    assert.equal(sent.length, 0, 'initial host state does not upload a local pipeline');
    engine.noteGesture();
    state.pipeline[0].vl = -6;
    engine.markDirty();
    engine.flushNow();
    assert.deepEqual(sent.map(message => message.op), ['chain']);
    engine.markDirty();
    engine.onDisconnected();
    engine.onConnected();
    engine.onState({ pipeline: [{ nm: 'Volume', en: true, vl: -9 }], masterBypass: false });
    assert.equal(state.pipeline[0].vl, -9);
    assert.equal(sent.length, 1, 'unconfirmed edits are never resent');
    engine.onDisconnected();
});

test('legacy state adopts the host-reported slot and keeps A for peers that report none', () => {
    let state = { pipeline: [], ids: [], masterBypass: false, slot: 'A' };
    const slots = [];
    const engine = new LegacySyncEngine({
        adapter: { snapshot: () => structuredClone(state), apply: ops => { state = applyOps(state, ops).snapshot; }, setSlot: slot => slots.push(slot) },
        send: () => Promise.resolve({ ok: true })
    });
    engine.onConnected();
    engine.onState({ pipeline: [{ nm: 'Volume', en: true, vl: -3, ch: 'L', ib: 1, ob: 2 }], slot: 'B' });
    assert.equal(engine.confirmed.snapshot.slot, 'B');
    assert.deepEqual(state.pipeline, [{ nm: 'Volume', en: true, vl: -3, ch: 'L', ib: 1, ob: 2 }]);
    engine.onState({ pipeline: [] });
    assert.deepEqual(slots, ['B', 'A']);
    engine.onDisconnected();
});

test('a pending legacy edit reaches its own slot and never overwrites the other slot', () => {
    let state = { pipeline: [], ids: [], masterBypass: false, slot: 'A' };
    const sent = [];
    const engine = new LegacySyncEngine({
        adapter: { snapshot: () => structuredClone(state), apply: ops => { state = applyOps(state, ops).snapshot; }, setSlot() {} },
        send: message => { sent.push(message); return Promise.resolve({ ok: true }); }
    });
    const slotA = { pipeline: [{ nm: 'Volume', en: true, vl: -3 }], slot: 'A' };
    const slotB = { pipeline: [{ nm: 'Mute', en: true }], slot: 'B' };
    engine.onConnected();
    engine.onState(slotA);
    // The client commits the pending edit before it asks the host to switch.
    engine.noteGesture();
    state.pipeline[0].vl = -6;
    engine.markDirty();
    engine.flushNow();
    engine.onState(slotB);
    assert.deepEqual(sent, [{ op: 'chain', pipeline: [{ nm: 'Volume', en: true, vl: -6 }] }]);
    assert.deepEqual(state.pipeline, slotB.pipeline);
    // A host-side switch arrives while an edit of B is still pending.
    engine.noteGesture();
    state.pipeline[0].en = false;
    engine.markDirty();
    engine.onState(slotA);
    assert.equal(engine.timer, null);
    assert.equal(sent.length, 1, 'the edit made for B is not written to A');
    assert.deepEqual(state.pipeline, slotA.pipeline);
    engine.onDisconnected();
});

test('a rejected legacy edit is reported and reconnect adopts the host without resending it', async t => {
    let state = { pipeline: [], ids: [], masterBypass: false, slot: 'A' };
    const sent = [], errors = [];
    const engine = new LegacySyncEngine({
        adapter: { snapshot: () => structuredClone(state), apply: ops => { state = applyOps(state, ops).snapshot; } },
        send: async message => { sent.push(message); return { ok: false, error: 'edit denied' }; },
        onError: error => errors.push(error.message)
    });
    t.after(() => engine.onDisconnected());
    engine.onConnected();
    engine.onState({ pipeline: [{ nm: 'Volume', en: true, vl: -3 }] });
    engine.noteGesture();
    state.pipeline[0].vl = -6;
    engine.markDirty();
    engine.flushNow();
    await Promise.resolve();
    assert.deepEqual(errors, ['edit denied']);
    assert.deepEqual(sent, [{ op: 'chain', pipeline: [{ nm: 'Volume', en: true, vl: -6 }] }]);
    engine.onDisconnected();
    engine.onConnected();
    engine.onState({ pipeline: [{ nm: 'Volume', en: true, vl: -12 }], masterBypass: true });
    assert.equal(state.pipeline[0].vl, -12);
    assert.equal(state.masterBypass, true);
    assert.equal(sent.length, 1);
});

test('legacy preset browsing/loading uses original operations and gates unsupported mutations', async () => {
    const calls = [];
    const session = {
        features: new Set(), addEventListener() {},
        async request(message) {
            calls.push(message);
            return message.op === 'listPresets' ? { names: ['Quiet'] } : { pipeline: [{ nm: 'Volume', vl: -8 }] };
        },
        async sendCommand(message) { calls.push(message); }
    };
    const host = createRemotePresetHost(session, () => []);
    assert.equal(host.canSave, false);
    assert.equal(host.canDelete, false);
    assert.deepEqual((await host.getPresets()).Quiet.plugins, [{ nm: 'Volume', vl: -8 }]);
    await host.loadPreset('Quiet');
    assert.deepEqual(calls.map(message => message.op), ['listPresets', 'getPreset', 'getPreset', 'chain']);
    await assert.rejects(host.savePreset('Quiet'), /unavailable/);
    await assert.rejects(host.deletePreset('Quiet'), /unavailable/);
});
