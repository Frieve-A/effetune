import assert from 'node:assert/strict';
import test from 'node:test';
import { IntegratedRemoteEffects } from '../../js/remote/integrated-remote-effects.js';

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
    return { promise, resolve, reject };
}

function fixture(api) {
    const window = {
        audioManager: { pipeline: [{ name: 'Local effect' }] },
        uiManager: {},
        location: { origin: 'https://effetune.test' },
        addEventListener() {}, removeEventListener() {},
        MessageChannel: class {
            constructor() {
                this.port1 = { messages: [], postMessage(data) { this.messages.push(data); }, close() {} };
                this.port2 = {};
            }
        }
    };
    const document = {
        defaultView: window,
        createElement(tagName) {
            const listeners = new Map();
            return {
                ownerDocument: document, tagName, children: [], hidden: false, attributes: {},
                append(...children) { this.children.push(...children); },
                replaceChildren(...children) { this.children = children; },
                setAttribute(name, value) { this.attributes[name] = value; },
                getAttribute(name) { return this.attributes[name]; },
                addEventListener(type, listener) { listeners.set(type, listener); },
                dispatch(type) { return listeners.get(type)?.({ preventDefault() {} }); },
                remove() {},
                ...(tagName === 'iframe' ? { contentWindow: { postMessage() {} } } : {})
            };
        }
    };
    const container = document.createElement('div');
    const errors = [];
    const controller = new IntegratedRemoteEffects({ container, api, reportError: message => errors.push(message) });
    return { controller, container, window, errors };
}

function descendants(element) {
    return [element, ...element.children.flatMap(descendants)];
}

test('first connection requests approval without accepting a pairing link and mounts only after approval', async () => {
    const approval = deferred();
    const requests = [];
    const { controller, container } = fixture({
        getConnection: async () => ({ registered: false, requestAvailable: true }),
        requestConnection: (playerId, requestId) => { requests.push({ playerId, requestId }); return approval.promise; },
        cancelConnectionRequest: async () => true
    });
    try {
        await controller.selectPlayer({ id: 'A', name: 'Living room' });
        assert.equal(descendants(container).some(element => element.tagName === 'input'), false);
        assert.equal(requests.length, 0, 'selection must wait for the explicit Connect effects action');
        const pending = descendants(container).find(element => element.tagName === 'form').dispatch('submit');
        assert.equal(requests[0].playerId, 'A');
        assert.match(requests[0].requestId, /^[0-9a-f-]{36}$/);
        assert.equal(controller.frame, null);
        assert.ok(descendants(container).some(element => element.textContent === 'Waiting for approval'));
        await controller.requestConnection();
        assert.equal(requests.length, 1, 'duplicate requests are ignored while approval is pending');
        approval.resolve({ ok: true });
        await pending;
        assert.equal(controller.frame.src, 'remote.html?integrated=1');
        assert.equal(controller.requestId, null);
    } finally { controller.dispose(); }
});

test('Change connection requests replacement approval on every retry without affecting normal selection', async () => {
    const requests = [];
    let result = { ok: false, status: 'denied' };
    const { controller, container } = fixture({
        getConnection: async () => ({ registered: true, requestAvailable: true }),
        requestConnection: async (playerId, requestId, replace) => { requests.push({ playerId, requestId, replace }); return result; },
        disconnect: async () => {}
    });
    try {
        await controller.selectPlayer({ id: 'A', name: 'Living room' });
        assert.ok(controller.frame, 'saved registration mounts automatically');
        assert.equal(requests.length, 0);
        controller.changeConnection();
        assert.equal(controller.frame, null);
        assert.equal(requests.length, 0, 'Change connection waits for the explicit Connect effects action');
        await descendants(container).find(element => element.tagName === 'form').dispatch('submit');
        assert.equal(requests[0].playerId, 'A');
        assert.equal(requests[0].replace, true);
        assert.equal(controller.frame, null);
        result = { ok: true };
        await controller.requestConnection();
        assert.equal(requests[1].replace, true, 'a denied replacement must not fall back to saved credentials');
        assert.ok(controller.frame);
        await controller.selectPlayer({ id: 'B', name: 'Bedroom' });
        await controller.requestConnection();
        assert.equal(requests[2].playerId, 'B');
        assert.equal(requests[2].replace, false);
    } finally { controller.dispose(); }
});

test('approval refusal, expiry and availability failures keep the editor closed and allow a retry', async () => {
    const labels = { denied: 'Permission denied', expired: 'Request expired', unavailable: 'Effect editing unavailable', busy: 'Player busy', error: 'Connection failed' };
    for (const [status, label] of Object.entries(labels)) {
        const { controller, container } = fixture({
            getConnection: async () => ({ registered: false, requestAvailable: status !== 'unavailable' }),
            requestConnection: async () => ({ ok: false, status }),
            cancelConnectionRequest: async () => true
        });
        try {
            await controller.selectPlayer({ id: 'A', name: 'Living room' });
            await controller.requestConnection();
            assert.equal(controller.frame, null);
            assert.equal(controller.requestId, null);
            assert.ok(descendants(container).some(element => element.textContent === label), status);
            assert.ok(descendants(container).some(element => element.tagName === 'button' && element.textContent === 'Connect effects'), status);
            assert.equal(descendants(container).some(element => element.tagName === 'input'), false);
        } finally { controller.dispose(); }
    }
});

test('changing player cancels the exact approval request and a late acceptance cannot open an editor', async () => {
    const approval = deferred();
    const cancelled = [];
    const { controller, container } = fixture({
        getConnection: async () => ({ registered: false, requestAvailable: true }),
        requestConnection: () => approval.promise,
        cancelConnectionRequest: async requestId => { cancelled.push(requestId); return true; }
    });
    try {
        await controller.selectPlayer({ id: 'A', name: 'Living room' });
        const pending = controller.requestConnection();
        const requestId = controller.requestId;
        await controller.selectPlayer({ id: 'B', name: 'Bedroom' });
        approval.resolve({ ok: true });
        await pending;
        assert.deepEqual(cancelled, [requestId]);
        assert.equal(controller.frame, null);
        assert.ok(descendants(container).some(element => element.textContent === 'Effect Pipeline · Bedroom'));
    } finally { controller.dispose(); }
});

test('Cancel and disposal invalidate pending requests, including a retry on the same player', async () => {
    const approvals = [deferred(), deferred()];
    const cancelled = [];
    let count = 0;
    const { controller, container } = fixture({
        getConnection: async () => ({ registered: false, requestAvailable: true }),
        requestConnection: () => approvals[count++].promise,
        cancelConnectionRequest: async requestId => { cancelled.push(requestId); return true; }
    });
    try {
        await controller.selectPlayer({ id: 'A', name: 'Living room' });
        const first = controller.requestConnection();
        const firstId = controller.requestId;
        descendants(container).find(element => element.tagName === 'button' && element.textContent === 'Cancel').dispatch('click');
        const second = controller.requestConnection();
        const secondId = controller.requestId;
        assert.notEqual(firstId, secondId);
        approvals[0].resolve({ ok: true });
        await first;
        assert.equal(controller.frame, null);
        assert.equal(controller.requestId, secondId);
        controller.dispose();
        approvals[1].resolve({ ok: true });
        await second;
        assert.equal(controller.frame, null);
        assert.deepEqual(cancelled, [firstId, secondId]);
    } finally { controller.dispose(); }
});

test('an unavailable reply from a previous player does not display an error for the current player', async () => {
    const response = deferred();
    const { controller, errors } = fixture({
        getConnection: async () => ({ registered: false, requestAvailable: true }),
        requestConnection: () => response.promise,
        cancelConnectionRequest: async () => true
    });
    try {
        await controller.selectPlayer({ id: 'A', name: 'Living room' });
        const pending = controller.requestConnection();
        await controller.selectPlayer({ id: 'B', name: 'Bedroom' });
        response.resolve({ ok: false, status: 'unavailable' });
        await pending;
        assert.deepEqual(errors, []);
        assert.equal(controller.player.id, 'B');
    } finally { controller.dispose(); }
});

test('the bundled editor can confirm preset deletion and IR import cancellation inside its sandbox', async () => {
    const { controller } = fixture({
        getConnection: async () => ({ registered: true }), disconnect: async () => {}
    });
    try {
        await controller.selectPlayer({ id: 'A', name: 'Living room' });
        assert.equal(controller.frame.src, 'remote.html?integrated=1');
        assert.deepEqual(new Set(controller.frame.getAttribute('sandbox').split(' ')),
            new Set(['allow-scripts', 'allow-same-origin', 'allow-downloads', 'allow-modals']));
    } finally { controller.dispose(); }
});

test('target changes discard delayed pairing lookup and never replace the local server model', async () => {
    const first = deferred();
    const api = {
        getConnection: id => id === 'A' ? first.promise : Promise.resolve({ registered: true }),
        disconnect: async () => {}, onEvent: () => () => {}
    };
    const { controller, container, window } = fixture(api);
    const original = window.audioManager;
    const pending = controller.selectPlayer({ id: 'A', name: 'Living room' });
    await controller.selectPlayer({ id: 'B', name: 'Living room' });
    const currentFrame = controller.frame;
    first.resolve({ registered: false });
    await pending;
    assert.equal(controller.player.id, 'B');
    assert.equal(controller.frame, currentFrame, 'same-name players remain distinct and a delayed lookup cannot replace the editor');
    assert.equal(window.audioManager, original);
    assert.deepEqual(original.pipeline, [{ name: 'Local effect' }]);
    await controller.selectPlayer(null);
    assert.equal(container.hidden, true);
    assert.equal(controller.frame, null);
    controller.dispose();
});

test('only the active frame receives a transport and a late connection is closed after switching away', async () => {
    const connecting = deferred();
    const disconnected = [];
    const api = {
        getConnection: async () => ({ registered: true }),
        connect: () => connecting.promise,
        disconnect: async id => { disconnected.push(id); },
        onEvent: () => () => {}
    };
    const { controller } = fixture(api);
    await controller.selectPlayer({ id: 'A', name: 'Living room' });
    controller.acceptFrame({ source: {}, origin: 'https://effetune.test', data: { type: 'effetune-remote-ready' } });
    assert.equal(controller.port, null);
    controller.acceptFrame({ source: controller.frame.contentWindow, origin: 'https://other.test', data: { type: 'effetune-remote-ready' } });
    assert.equal(controller.port, null, 'the selected frame must also have the expected origin');
    controller.acceptFrame({ source: controller.frame.contentWindow, origin: 'https://effetune.test', data: { type: 'effetune-remote-ready' } });
    assert.ok(controller.port);
    const pending = controller.port.onmessage({ data: { type: 'connect' } });
    await controller.selectPlayer(null);
    connecting.resolve({ ok: true, connectionId: 'old-A' });
    await pending;
    assert.deepEqual(disconnected, ['old-A']);
    assert.equal(controller.connectionId, null);
    controller.dispose();
});

for (const failureTiming of ['after reconnect', 'during reconnect']) {
    test(`an old connection failure ${failureTiming} cannot close the replacement or discard its early events`, async t => {
        const connections = [deferred(), deferred()];
        const sent = [], disconnected = [];
        let connectCount = 0, emit;
        const { controller } = fixture({
            getConnection: async () => ({ registered: true }),
            connect: () => connections[connectCount++].promise,
            disconnect: async id => { disconnected.push(id); },
            send: async (id, data) => { sent.push([id, data]); return true; },
            onEvent: listener => { emit = listener; return () => {}; }
        });
        t.after(() => controller.dispose());
        await controller.selectPlayer({ id: 'A', name: 'Living room' });
        controller.acceptFrame({ source: controller.frame.contentWindow, origin: 'https://effetune.test',
            data: { type: 'effetune-remote-ready' } });
        const port = controller.port;
        const first = port.onmessage({ data: { type: 'connect' } });
        await port.onmessage({ data: { type: 'close' } });
        const second = port.onmessage({ data: { type: 'connect' } });
        if (failureTiming === 'during reconnect') {
            connections[0].reject(new Error('first connection failed late'));
            await first;
        }
        const opened = { type: 'open', connectionId: 'replacement' };
        const state = { type: 'message', connectionId: 'replacement', data: '{"op":"state","rev":2}' };
        emit({ type: 'open', connectionId: 'obsolete' });
        emit(opened);
        emit({ type: 'message', connectionId: 'obsolete', data: '{"op":"state","rev":1}' });
        emit(state);
        assert.deepEqual(port.messages, [], 'events wait until the replacement connection ID is confirmed');
        connections[1].resolve({ ok: true, connectionId: 'replacement' });
        await second;
        if (failureTiming === 'after reconnect') {
            connections[0].reject(new Error('first connection failed late'));
            await first;
        }
        assert.equal(controller.connectionId, 'replacement');
        assert.deepEqual(port.messages, [opened, state], 'only the replacement events reach its editor');
        await port.onmessage({ data: { type: 'send', data: '{"op":"get"}' } });
        assert.deepEqual(sent, [['replacement', '{"op":"get"}']]);
        assert.deepEqual(disconnected, []);
    });
}
