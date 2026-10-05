import assert from 'node:assert/strict';
import test from 'node:test';
import {
    BACKOFF_MS, CLOSE_UNAUTHORIZED, LIVENESS_TIMEOUT_MS, RemoteSession, TOKEN_STORAGE_KEY, resolveRemoteTarget
} from '../../js/remote/remote-session.js';
import { RemoteAudioManager } from '../../js/remote/remote-audio-manager.js';
import { createRemotePresetHost } from '../../js/remote/remote-client.js';
import { PresetManager } from '../../js/ui/pipeline/preset-manager.js';

class FakeSocket {
    static instances = [];
    constructor(url) {
        this.url = url;
        this.readyState = 0;
        this.sent = [];
        FakeSocket.instances.push(this);
    }

    open() { this.readyState = 1; this.onopen?.(); }
    send(text) { this.sent.push(JSON.parse(text)); }
    close(code = 1000) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
    receive(message) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

function makeEnv() {
    FakeSocket.instances = [];
    const timers = [];
    const listeners = { document: new Map(), window: new Map() };
    const target = bucket => ({
        addEventListener: (type, fn) => bucket.set(type, fn),
        removeEventListener: type => bucket.delete(type)
    });
    const env = {
        timers,
        documentRef: { visibilityState: 'visible', ...target(listeners.document) },
        windowRef: target(listeners.window),
        listeners,
        setTimer: (fn, ms) => { const timer = { fn, ms, live: true }; timers.push(timer); return timer; },
        clearTimer: timer => { if (timer) timer.live = false; },
        fire(ms) {
            const timer = timers.find(candidate => candidate.live && candidate.ms === ms);
            assert.ok(timer, `no timer of ${ms} ms`);
            timer.live = false;
            timer.fn();
        }
    };
    return env;
}

function makeSession(env, extra = {}) {
    const session = new RemoteSession({
        url: 'ws://127.0.0.1:1/?t=abcd',
        hello: { app: 'EffeTune', sync: 1 },
        WebSocketImpl: FakeSocket,
        setTimer: env.setTimer,
        clearTimer: env.clearTimer,
        documentRef: env.documentRef,
        windowRef: env.windowRef,
        ...extra
    });
    const statuses = [];
    session.addEventListener('status', event => statuses.push(event.detail.status));
    return { session, statuses };
}

const tick = () => new Promise(resolve => setImmediate(resolve));

test('hello is sent on open and the session is open once it is acknowledged', async () => {
    const env = makeEnv();
    const { session, statuses } = makeSession(env);
    session.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    assert.deepEqual(socket.sent[0], { op: 'hello', v: 1, app: 'EffeTune', sync: 1, seq: 1 });
    socket.receive({ op: 'ack', seq: 1, ok: true });
    await tick();
    assert.deepEqual(statuses, ['connecting', 'open']);
    const states = [];
    session.addEventListener('state', event => states.push(event.detail.rev));
    socket.receive({ op: 'state', rev: 3, seq: 1 });
    socket.receive({ op: 'state', rev: 4 });
    assert.deepEqual(states, [3, 4]);
    session.stop();
});

test('requests resolve with their ack, or with the data message that follows it', async () => {
    const env = makeEnv();
    const { session } = makeSession(env);
    session.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive({ op: 'ack', seq: 1, ok: true });
    await tick();
    const plain = session.send({ op: 'slot', slot: 'B' });
    socket.receive({ op: 'ack', seq: 2, ok: true, rev: 9 });
    assert.equal((await plain).rev, 9);
    const data = session.request({ op: 'presets' }, 'presets');
    socket.receive({ op: 'ack', seq: 3, ok: true });
    socket.receive({ op: 'presets', seq: 3, presets: { A: {} } });
    assert.deepEqual((await data).presets, { A: {} });
    const failing = session.request({ op: 'presets' }, 'presets');
    socket.receive({ op: 'ack', seq: 4, ok: false, error: 'busy' });
    await assert.rejects(failing, /busy/);
    const refused = session.send({ op: 'x' });
    socket.receive({ op: 'ack', seq: 5, ok: false, error: 'invalid-op' });
    assert.equal((await refused).ok, false);
    session.stop();
});

test('UI commands reject failed acks and resolve only accepted commands', async () => {
    const { session } = makeSession(makeEnv());
    session.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive({ op: 'ack', seq: 1, ok: true });
    try {
        for (const message of [
            { op: 'history', dir: 'undo' }, { op: 'history', dir: 'redo' },
            { op: 'slot', slot: 'B' }, { op: 'copySlot', from: 'A', to: 'B' }
        ]) {
            const result = session.sendCommand(message);
            socket.receive({ op: 'ack', seq: socket.sent.at(-1).seq, ok: false, error: 'app-not-ready' });
            await assert.rejects(result, /app-not-ready/);
        }
        const accepted = session.sendCommand({ op: 'slot', slot: 'B' });
        socket.receive({ op: 'ack', seq: socket.sent.at(-1).seq, ok: true, rev: 9 });
        assert.equal((await accepted).rev, 9);
        const disconnected = session.sendCommand({ op: 'history', dir: 'undo' });
        socket.close(1006);
        await assert.rejects(disconnected, /closed/);
    } finally {
        session.stop();
    }
});

test('failed preset commands preserve the active preset and report failure to the shared UI', async t => {
    const { session } = makeSession(makeEnv());
    session.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive({ op: 'ack', seq: 1, ok: true });
    const previousWindow = globalThis.window;
    const messages = [];
    globalThis.window = {
        uiManager: {
            showTransientMessage: key => messages.push(key),
            setError: key => messages.push(key)
        }
    };
    t.mock.method(console, 'error', () => {});
    const pipeline = [{ nm: 'Volume', en: true, vl: -3 }];
    const externalHost = createRemotePresetHost(session, () => pipeline);
    const manager = { externalHost, currentPresetName: 'Existing' };
    const stored = { Existing: { plugins: pipeline } };
    try {
        const listing = externalHost.getPresets();
        socket.receive({ op: 'presets', seq: socket.sent.at(-1).seq, presets: stored });
        assert.deepEqual(await listing, stored);

        for (const [method, argument, op, errorKey] of [
            ['savePreset', 'New preset', 'savePreset', 'error.failedToSavePreset'],
            ['loadPreset', 'New preset', 'loadPreset', 'error.failedToLoadPreset'],
            ['deletePresets', ['Existing'], 'deletePreset', 'error.failedToDeletePreset']
        ]) {
            const result = PresetManager.prototype[method].call(manager, argument);
            const request = socket.sent.at(-1);
            assert.equal(request.op, op);
            socket.receive({ op: 'ack', seq: request.seq, ok: false, error: 'request-failed' });
            assert.equal(await result, false);
            assert.equal(manager.currentPresetName, 'Existing');
            assert.equal(messages.at(-1), errorKey);
            const requestCount = socket.sent.length;
            assert.deepEqual(await externalHost.getPresets(), stored);
            assert.equal(socket.sent.length, requestCount, 'failed commands keep the cached presets');
        }

        const saved = PresetManager.prototype.savePreset.call(manager, 'New preset');
        const request = socket.sent.at(-1);
        assert.deepEqual(request.pipeline, pipeline);
        socket.receive({ op: 'ack', seq: request.seq, ok: true });
        assert.equal(await saved, true);
        assert.equal(manager.currentPresetName, 'New preset');
        const refreshed = externalHost.getPresets();
        assert.equal(socket.sent.at(-1).op, 'presets');
        socket.receive({ op: 'presets', seq: socket.sent.at(-1).seq, presets: stored });
        await refreshed;
    } finally {
        session.stop();
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
    }
});

test('a closed socket rejects waiting requests and reconnects with growing delays', async () => {
    const env = makeEnv();
    const { session, statuses } = makeSession(env);
    session.start();
    const first = FakeSocket.instances[0];
    first.open();
    first.receive({ op: 'ack', seq: 1, ok: true });
    await tick();
    const waiting = session.send({ op: 'get' });
    first.close(1006);
    await assert.rejects(waiting, /closed/);
    assert.equal(statuses.at(-1), 'reconnecting');
    for (let attempt = 0; attempt < BACKOFF_MS.length + 2; attempt += 1) {
        const expected = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
        env.fire(expected);
        const socket = FakeSocket.instances.at(-1);
        assert.equal(socket.readyState, 0);
        socket.close(1006);
    }
    assert.deepEqual(BACKOFF_MS, [1000, 2000, 4000, 8000, 15000]);
    await assert.rejects(session.send({ op: 'get' }), /not connected/);
    session.stop();
});

test('a successful connection resets the backoff', async () => {
    const env = makeEnv();
    const { session } = makeSession(env);
    session.start();
    FakeSocket.instances[0].close(1006);
    env.fire(1000);
    FakeSocket.instances[1].close(1006);
    env.fire(2000);
    FakeSocket.instances[2].open();
    FakeSocket.instances[2].receive({ op: 'ack', seq: 1, ok: true });
    await tick();
    FakeSocket.instances[2].close(1006);
    env.fire(1000);
    session.stop();
});

test('close code 4401 is final and never retried', async () => {
    const env = makeEnv();
    const { session, statuses } = makeSession(env);
    session.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.close(CLOSE_UNAUTHORIZED);
    assert.equal(statuses.at(-1), 'unauthorized');
    assert.equal(env.timers.filter(timer => timer.live).length, 0);
    assert.equal(FakeSocket.instances.length, 1);
    session.retryNow();
    assert.equal(FakeSocket.instances.length, 1);
    session.stop();
});

test('coming back to the tab or the network retries at once instead of waiting', () => {
    const env = makeEnv();
    const { session } = makeSession(env);
    session.start();
    FakeSocket.instances[0].close(1006);
    assert.equal(FakeSocket.instances.length, 1);
    env.listeners.document.get('visibilitychange')();
    assert.equal(FakeSocket.instances.length, 2);
    FakeSocket.instances[1].close(1006);
    env.listeners.window.get('online')();
    assert.equal(FakeSocket.instances.length, 3);
    env.listeners.window.get('online')();
    assert.equal(FakeSocket.instances.length, 3, 'a connecting socket is left alone');
    env.documentRef.visibilityState = 'hidden';
    FakeSocket.instances[2].close(1006);
    env.listeners.document.get('visibilitychange')();
    assert.equal(FakeSocket.instances.length, 3);
    session.stop();
});

test('a socket that stays silent after the tab returns is dropped and replaced', async () => {
    const env = makeEnv();
    const { session } = makeSession(env);
    session.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive({ op: 'ack', seq: 1, ok: true });
    await tick();
    env.listeners.document.get('visibilitychange')();
    assert.deepEqual(socket.sent.at(-1).op, 'get');
    env.fire(LIVENESS_TIMEOUT_MS);
    assert.equal(socket.readyState, 3);
    assert.equal(FakeSocket.instances.length, 2);
    session.stop();
});

test('a reply within the liveness window keeps the socket', async () => {
    const env = makeEnv();
    const { session } = makeSession(env);
    session.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive({ op: 'ack', seq: 1, ok: true });
    await tick();
    env.listeners.document.get('visibilitychange')();
    socket.receive({ op: 'state', rev: 1, seq: 2 });
    assert.equal(env.timers.find(timer => timer.ms === LIVENESS_TIMEOUT_MS).live, false);
    assert.equal(FakeSocket.instances.length, 1);
    session.stop();
});

test('stopping closes the socket and clears the listeners', () => {
    const env = makeEnv();
    const { session } = makeSession(env);
    session.start();
    session.stop();
    assert.equal(FakeSocket.instances[0].readyState, 3);
    assert.equal(env.listeners.document.size, 0);
    assert.equal(env.listeners.window.size, 0);
});

function target(search, { protocol = 'http:', stored = null, throwing = false } = {}) {
    const store = new Map(stored ? [[TOKEN_STORAGE_KEY, stored]] : []);
    const calls = [];
    return {
        calls,
        store,
        result: resolveRemoteTarget({
            location: { protocol, host: '192.168.1.5:47300', pathname: '/', search, hash: '' },
            storage: throwing ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
                : { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) },
            history: { replaceState: (...args) => calls.push(args) }
        })
    };
}

test('the token from the link is stored, removed from the address bar and used for the socket', () => {
    const { result, store, calls } = target('?t=abcd1234&x=1');
    assert.deepEqual(result, { ok: true, token: 'abcd1234', url: 'ws://192.168.1.5:47300/?t=abcd1234' });
    assert.equal(store.get(TOKEN_STORAGE_KEY), 'abcd1234');
    assert.deepEqual(calls[0], [null, '', '/?x=1']);
});

test('a stored token is used when the link has none', () => {
    const { result, calls } = target('', { stored: 'stored-1' });
    assert.equal(result.token, 'stored-1');
    assert.equal(calls.length, 0);
});

test('a new token in the link replaces the stored one', () => {
    const { result, store } = target('?t=newtoken', { stored: 'oldtoken' });
    assert.equal(result.token, 'newtoken');
    assert.equal(store.get(TOKEN_STORAGE_KEY), 'newtoken');
});

test('blocked storage still lets the page connect with the token from the link', () => {
    const { result } = target('?t=abcd1234', { throwing: true });
    assert.equal(result.ok, true);
    assert.equal(target('', { throwing: true }).result.reason, 'token');
});

test('no token, a malformed token or a secure page give a notice instead of a connection', () => {
    assert.deepEqual(target('').result, { ok: false, reason: 'token' });
    assert.deepEqual(target('?t=a b').result, { ok: false, reason: 'token' });
    assert.deepEqual(target('?t=abcd1234', { protocol: 'https:' }).result, { ok: false, reason: 'protocol' });
    assert.deepEqual(target('', { stored: 'no good' }).result, { ok: false, reason: 'token' });
});

test('the audio stand-in reports plugin and topology changes unless they are applied from the host', () => {
    const manager = new RemoteAudioManager();
    const plugin = { id: 7 };
    manager.pipeline = [plugin];
    const reports = [];
    manager.onLocalChange = value => reports.push(value);
    manager.commitPowerTopologyMutation({ type: 'updatePlugin', plugin: { id: 7 } });
    manager.commitPowerTopologyMutation({ type: 'updatePlugins', plugins: [] });
    manager.setMasterBypass(true);
    assert.deepEqual(reports, [], 'applying the host state is not an edit');
    assert.equal(manager.masterBypass, true);
    manager.suppressMutations = false;
    manager.commitPowerTopologyMutation({ type: 'updatePlugin', plugin: { id: 7 } });
    manager.commitPowerTopologyMutation({ type: 'updatePlugin', plugin: { id: 99 } });
    manager.commitPowerTopologyMutation({ type: 'updatePlugins', plugins: [] });
    manager.setMasterBypass(false);
    assert.deepEqual(reports, [plugin, null, null]);
    assert.equal(manager.getCurrentPipeline(), manager.pipeline);
    assert.equal(manager.currentPipeline, 'A');
    assert.equal(manager.getActivePowerWorklets()[0], manager.workletNode);
});

test('presetsChanged and irsChanged pushes become events', async () => {
    const env = makeEnv();
    const { session } = makeSession(env);
    const events = [];
    session.addEventListener('presetsChanged', () => events.push('presets'));
    session.addEventListener('irsChanged', () => events.push('irs'));
    session.start();
    const socket = FakeSocket.instances[0];
    socket.open();
    socket.receive({ op: 'irsChanged' });
    socket.receive({ op: 'presetsChanged' });
    socket.receive({ op: 'irsChanged' });
    assert.deepEqual(events, ['irs', 'presets', 'irs']);
    session.stop();
});
