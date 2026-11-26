import assert from 'node:assert/strict';
import test from 'node:test';
import { createAndroidRemoteClient } from '../../js/android/remote-effects-client.js';

function harness(t, respond) {
    const calls = [];
    let listener;
    const bridge = {
        on(name, callback) {
            assert.equal(name, 'remote-client-event');
            listener = callback;
            return () => { listener = null; };
        },
        async request(command, payload) {
            calls.push([command, payload]);
            return respond(command, payload);
        }
    };
    const api = createAndroidRemoteClient({ bridge, getOrigin: () => 'http://192.168.1.2:47300' });
    t.after(() => api.dispose());
    return { api, calls, emit: event => listener(event) };
}

test('Android remote client maps connection, socket events, send and disconnect', async t => {
    const lookup = { registered: true, requestAvailable: true };
    const connection = { ok: true, connectionId: 'socket' };
    const { api, calls, emit } = harness(t, command => ({
        'remoteClient.getConnection': lookup,
        'remoteClient.connect': connection,
        'remoteClient.send': { sent: true },
        'remoteClient.disconnect': { ok: true }
    })[command]);
    const events = [];
    const unsubscribe = api.onEvent(event => events.push(event));
    assert.deepEqual(await api.getConnection('player'), lookup);
    assert.deepEqual(await api.connect('player'), connection);
    const opened = { connectionId: 'socket', type: 'open' };
    const state = { connectionId: 'socket', type: 'message', data: '{"op":"state"}' };
    emit(opened);
    emit(state);
    assert.equal(await api.send('socket', '{"op":"get"}'), true);
    assert.equal(await api.disconnect('socket'), true);
    unsubscribe();
    emit({ connectionId: 'socket', type: 'close', code: 1000 });
    assert.deepEqual(events, [opened, state]);
    assert.deepEqual(calls, [
        ['remoteClient.getConnection', { playerId: 'player', origin: 'http://192.168.1.2:47300' }],
        ['remoteClient.connect', { playerId: 'player' }],
        ['remoteClient.send', { connectionId: 'socket', data: '{"op":"get"}' }],
        ['remoteClient.disconnect', { connectionId: 'socket' }]
    ]);
});

test('Android pairing waits for the matching event after acknowledging the start and supports cancellation', async t => {
    const { api, calls, emit } = harness(t, command => command === 'remoteClient.cancel'
        ? { cancelled: true } : { started: true });
    let finished = false;
    const pending = api.requestConnection('player', 'request').then(result => { finished = true; return result; });
    emit({ type: 'pairResult', requestId: 'other', ok: true, status: 'approved' });
    await Promise.resolve();
    assert.equal(finished, false);
    assert.deepEqual(calls[0], ['remoteClient.requestConnection', {
        playerId: 'player', origin: 'http://192.168.1.2:47300', requestId: 'request', replace: false
    }]);
    emit({ type: 'pairResult', requestId: 'request', ok: true, status: 'approved' });
    assert.deepEqual(await pending, { ok: true, status: 'approved' });
    const cancelled = api.requestConnection('player', 'cancelled');
    assert.equal(await api.cancelConnectionRequest('cancelled'), true);
    emit({ type: 'pairResult', requestId: 'cancelled', ok: true, status: 'approved' });
    assert.deepEqual(await cancelled, { ok: false, status: 'cancelled' });
});

test('Android remote client sends long messages in order and acknowledges and rejoins every received part', async t => {
    const { api, calls, emit } = harness(t, () => ({ sent: true }));
    const message = 'a'.repeat(65535) + '🎵' + 'b'.repeat(65536);
    const sent = api.send('socket', message);
    const next = api.send('socket', 'next');
    assert.equal(await sent, true);
    assert.equal(await next, true);
    const parts = calls.slice(0, -1).map(([, payload]) => payload);
    assert.equal(parts[0].data.length, 65535);
    assert.equal(parts[1].data.startsWith('🎵'), true);
    assert.equal(parts.at(-1).done, true);
    assert.equal(parts.map(part => part.data).join(''), message);
    assert.deepEqual(calls.at(-1), ['remoteClient.send', { connectionId: 'socket', data: 'next' }]);
    const events = [];
    api.onEvent(event => events.push(event));
    for (const part of parts) emit({ type: 'message', ...part });
    assert.deepEqual(calls.slice(parts.length + 1), parts.map(part => ['remoteClient.send', {
        connectionId: 'socket', messageId: part.messageId, received: part.offset + part.data.length
    }]));
    assert.deepEqual(events, [{ connectionId: 'socket', type: 'message', data: message }]);
});

test('Android remote client discards unfinished data on 4401 and permits a fresh approval', async t => {
    const { api, calls, emit } = harness(t, command => command === 'remoteClient.requestConnection'
        ? { started: true } : { sent: true });
    const events = [];
    api.onEvent(event => events.push(event));
    const part = { connectionId: 'old', type: 'message', messageId: 'm1', total: 2 };
    emit({ ...part, offset: 0, data: 'a', done: false });
    const closed = { connectionId: 'old', type: 'close', code: 4401 };
    emit(closed);
    emit({ ...part, offset: 1, data: 'b', done: true });
    assert.deepEqual(events, [closed]);
    assert.equal(calls.length, 1, 'an abandoned message stops receiving acknowledgements');
    const retried = api.requestConnection('player', 'retry', true);
    assert.equal(calls.at(-1)[1].replace, true);
    emit({ type: 'pairResult', requestId: 'retry', ok: true, status: 'approved' });
    assert.deepEqual(await retried, { ok: true, status: 'approved' });
});
