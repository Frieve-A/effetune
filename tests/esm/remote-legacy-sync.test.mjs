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
