import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { EffeTuneClient } from '../src/client.mjs';

test('failed hellos release every socket and delayed events cannot damage a later connection', async t => {
    const sockets = [];
    class HelloSocket extends EventEmitter {
        static OPEN = 1;
        static CLOSING = 2;
        constructor() {
            super();
            this.readyState = 0;
            this.refuse = sockets.length < 3;
            sockets.push(this);
            queueMicrotask(() => { this.readyState = 1; this.emit('open'); });
        }
        send(text) {
            const { seq } = JSON.parse(text);
            queueMicrotask(() => {
                this.emit('message', JSON.stringify({ op: 'ack', seq, ok: !this.refuse, error: 'renderer-unavailable' }));
                if (!this.refuse) this.emit('message', JSON.stringify({ op: 'state', seq, epoch: 'current', rev: 1, features: ['sync1'] }));
            });
        }
        terminate() {
            this.readyState = 3;
            // The close event may arrive after the next connection opens.
        }
        close() { this.terminate(); this.emit('close', 1000); }
    }
    const client = new EffeTuneClient({ url: 'http://localhost/?t=test', WebSocketImpl: HelloSocket });
    t.after(() => client.close());
    for (let attempt = 0; attempt < 3; attempt++) {
        await assert.rejects(client.connect(), /renderer-unavailable/);
        assert.equal(sockets.filter(socket => socket.readyState === HelloSocket.OPEN).length, 0);
        assert.equal(client.pending.size, 0);
    }
    await client.connect();
    const connected = client.ws;
    for (const stale of sockets.slice(0, -1)) {
        stale.emit('message', JSON.stringify({ op: 'state', epoch: 'stale', rev: 100 }));
        stale.emit('error', new Error('late socket error'));
        stale.emit('close', 1006);
    }
    assert.equal(client.ws, connected);
    assert.equal(client.state.epoch, 'current');
    assert.equal(client.lastSocketError, null);
    assert.equal(client.lastCloseCode, null);
    assert.deepEqual(client.features, ['sync1']);
    assert.equal((await client.request({ op: 'get' })).data.epoch, 'current');
    assert.equal(sockets.length, 4);
});
