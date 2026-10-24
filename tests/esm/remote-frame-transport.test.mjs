import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { createFrameWebSocket } from '../../js/remote/remote-frame-transport.js';
import { RemoteSession } from '../../js/remote/remote-session.js';

async function nextEvent(target, type) {
    const controller = new AbortController();
    const guard = setTimeout(() => controller.abort(), 1000);
    try { return await once(target, type, { signal: controller.signal }); }
    finally { clearTimeout(guard); }
}

function fixture(t, protocol = 'https:') {
    const channel = new MessageChannel();
    const listeners = new Set();
    const requests = [];
    const messages = [];
    const parent = { postMessage: (...args) => requests.push(args), electronAPI: { privatePreload: true },
        pairingUrl: 'wss://native.invalid/?t=parent-token' };
    const win = {
        parent,
        location: { protocol, origin: protocol === 'file:' ? 'null' : 'https://effetune.test' },
        addEventListener(type, listener) { assert.equal(type, 'message'); listeners.add(listener); },
        removeEventListener(type, listener) { assert.equal(type, 'message'); listeners.delete(listener); }
    };
    const setup = { win, requests, messages, listeners, port: channel.port2, framePort: channel.port1, session: null,
        deliver(event) { for (const listener of [...listeners]) listener(event); },
        handshake() {
            this.deliver({ source: parent, origin: win.location.origin, ports: [channel.port1],
                data: { type: 'effetune-remote-port', playerName: 'Living room', layoutMode: 'desktop' } });
        }
    };
    channel.port2.on('message', message => messages.push(message));
    t.after(() => { setup.session?.stop(); channel.port1.close(); channel.port2.close(); });
    return setup;
}

for (const protocol of ['https:', 'file:']) {
    test(`the ${protocol} editor accepts a port only from its parent and expected origin`, { timeout: 5000 }, async t => {
        const setup = fixture(t, protocol);
        const pending = createFrameWebSocket(setup.win);
        const valid = { source: setup.win.parent, origin: setup.win.location.origin,
            data: { type: 'effetune-remote-port' }, ports: [setup.port] };
        for (const change of [{ source: {} }, { origin: 'https://other.test' },
            { data: { type: 'unrelated' } }, { ports: [] }]) {
            setup.deliver({ ...valid, ...change });
            assert.equal(setup.listeners.size, 1, 'a rejected message leaves the trusted handshake pending');
        }
        setup.handshake();
        const FrameWebSocket = await pending;
        assert.equal(setup.listeners.size, 0);
        assert.deepEqual(setup.requests, [[{ type: 'effetune-remote-ready' }, protocol === 'file:' ? '*' : setup.win.location.origin]]);
        assert.equal(FrameWebSocket.metadata.playerName, 'Living room');
        assert.equal(setup.win.electronAPI, undefined);
    });
}

test('an embedded session exchanges hello and edits through its parent, reconnects and rejects retired sockets', { timeout: 5000 }, async t => {
    const setup = fixture(t);
    const pending = createFrameWebSocket(setup.win);
    setup.handshake();
    const FrameWebSocket = await pending;
    const session = setup.session = new RemoteSession({
        url: 'integrated', hello: { app: 'EffeTune', sync: 1 },
        WebSocketImpl: FrameWebSocket, documentRef: null, windowRef: null
    });
    const states = [];
    session.addEventListener('state', event => states.push(event.detail));
    let message = nextEvent(setup.port, 'message');
    session.start();
    assert.deepEqual((await message)[0], { type: 'connect' });
    const first = session.ws;
    assert.throws(() => first.send('before open'), /not connected/);
    message = nextEvent(setup.port, 'message');
    setup.port.postMessage({ type: 'open' });
    const hello = (await message)[0];
    assert.equal(hello.type, 'send');
    assert.deepEqual(JSON.parse(hello.data), { op: 'hello', v: 1, app: 'EffeTune', sync: 1, seq: 1 });
    let status = nextEvent(session, 'status');
    setup.port.postMessage({ type: 'message', data: JSON.stringify({ op: 'ack', seq: 1, ok: true }) });
    assert.equal((await status)[0].detail.status, 'open');
    const state = { op: 'state', rev: 4, pipeline: [{ nm: 'Volume', vl: -6 }] };
    const received = nextEvent(session, 'state');
    setup.port.postMessage({ type: 'message', data: JSON.stringify(state) });
    await received;
    assert.deepEqual(states, [state]);
    message = nextEvent(setup.port, 'message');
    const edit = session.sendCommand({ op: 'bypass', on: true });
    assert.deepEqual(JSON.parse((await message)[0].data), { op: 'bypass', on: true, seq: 2 });
    setup.port.postMessage({ type: 'message', data: JSON.stringify({ op: 'ack', seq: 2, ok: true }) });
    await edit;
    const metadata = { type: 'metadata', playerName: 'Bedroom', layoutMode: 'mobile' };
    const updates = [];
    FrameWebSocket.onMetadata = value => updates.push(value);
    const updated = nextEvent(setup.framePort, 'message');
    setup.port.postMessage(metadata);
    await updated;
    assert.deepEqual(updates, [metadata]);
    assert.deepEqual(FrameWebSocket.metadata, metadata);
    status = nextEvent(session, 'status');
    setup.port.postMessage({ type: 'close', code: 1006 });
    assert.equal((await status)[0].detail.status, 'reconnecting');
    assert.throws(() => first.send('after close'), /not connected/);
    await assert.rejects(session.sendCommand({ op: 'bypass', on: false }), /not connected/);
    message = nextEvent(setup.port, 'message');
    session.retryNow();
    assert.deepEqual((await message)[0], { type: 'connect' });
    const second = session.ws;
    message = nextEvent(setup.port, 'message');
    first.close();
    setup.port.postMessage({ type: 'open' });
    const retryHello = JSON.parse((await message)[0].data);
    assert.equal(retryHello.op, 'hello');
    status = nextEvent(session, 'status');
    setup.port.postMessage({ type: 'message', data: JSON.stringify({ op: 'ack', seq: retryHello.seq, ok: true }) });
    assert.equal((await status)[0].detail.status, 'open');
    assert.equal(session.ws, second);
    message = nextEvent(setup.port, 'message');
    FrameWebSocket.changeConnection();
    assert.deepEqual((await message)[0], { type: 'change-connection' });
    message = nextEvent(setup.port, 'message');
    session.stop();
    assert.deepEqual((await message)[0], { type: 'close' });
    assert.equal(second.readyState, 3);
    assert.throws(() => second.send('after stop'), /not connected/);
    // The native URL and its credentials are never serialized across the frame boundary.
    assert.doesNotMatch(JSON.stringify([...setup.requests, ...setup.messages]), /native\.invalid|parent-token|privatePreload|electronAPI/);
});
