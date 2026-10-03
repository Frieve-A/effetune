import assert from 'node:assert/strict';
import test from 'node:test';
import { SyncEngine, ACK_TIMEOUT_MS, GESTURE_WINDOW_MS } from '../../js/remote/remote-sync-engine.mjs';
import { applyOps, deepEqual, validateOps } from '../../js/remote/sync-ops.mjs';

function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6D2B79F5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const clone = value => JSON.parse(JSON.stringify(value));

// Virtual time: timers and network deliveries run in (time, creation) order.
class Clock {
    constructor() { this.t = 0; this.order = 0; this.queue = []; }
    at(ms, fn) {
        const item = { time: this.t + ms, order: this.order += 1, fn, cancelled: false };
        this.queue.push(item);
        return item;
    }

    cancel(item) { if (item) item.cancelled = true; }
    async run(until) {
        for (;;) {
            let best = -1;
            for (let i = 0; i < this.queue.length; i += 1) {
                const item = this.queue[i];
                if (item.time > until) continue;
                if (best < 0 || item.time < this.queue[best].time ||
                    (item.time === this.queue[best].time && item.order < this.queue[best].order)) best = i;
            }
            if (best < 0) break;
            const [item] = this.queue.splice(best, 1);
            if (item.cancelled) continue;
            this.t = item.time;
            item.fn();
            // promise callbacks (acks) run between timers, as they would in a browser
            for (let i = 0; i < 4; i += 1) await Promise.resolve();
        }
        this.t = until;
    }
}

class FakeAdapter {
    constructor() { this.model = { masterBypass: false, slot: 'A', pipeline: [], ids: [] }; }
    snapshot() { return clone(this.model); }
    apply(ops) { this.model = applyOps(this.model, ops).snapshot; }
    setSlot(slot) { this.model.slot = slot; }
}

// One sequencer: applies edits in arrival order, broadcasts full states.
class SimHost {
    constructor(clock, rand, { backpressure = true } = {}) {
        this.clock = clock;
        this.rand = rand;
        this.backpressure = backpressure;
        this.epoch = 'e0000000';
        this.rev = 0;
        this.model = { masterBypass: false, slot: 'A', pipeline: [], ids: [] };
        this.clients = [];
        this.broadcastTimer = null;
        this.log = [];
        this.idCounter = 0;
        this.received = [];
    }

    snapshotMessage() {
        return { op: 'state', rev: this.rev, epoch: this.epoch, ...clone(this.model) };
    }

    changed() {
        this.rev += 1;
        if (this.broadcastTimer) return;
        this.broadcastTimer = this.clock.at(100, () => {
            this.broadcastTimer = null;
            for (const client of this.clients) this.push(client);
        });
    }

    push(client) {
        if (!client.up) return;
        if (this.backpressure && this.rand() < 0.25) {
            if (!client.dirtyTimer) {
                client.dirtyTimer = this.clock.at(250, () => {
                    client.dirtyTimer = null;
                    this.deliver(client, this.snapshotMessage());
                });
            }
            return;
        }
        this.deliver(client, this.snapshotMessage());
    }

    deliver(client, message) {
        if (!client.up) return;
        const generation = client.gen;
        const delay = this.rand() * 150;
        const time = Math.max(client.lastDown, this.clock.t + delay);
        client.lastDown = time;
        this.clock.at(time - this.clock.t, () => {
            if (client.up && client.gen === generation) client.receive(message);
        });
    }

    handle(client, message) {
        if (message.op === 'hello' || message.op === 'get') {
            if (message.seq !== undefined) this.deliver(client, { op: 'ack', seq: message.seq, ok: true });
            this.deliver(client, this.snapshotMessage());
            return;
        }
        if (message.op !== 'edit') return;
        this.received.push({ client: client.id, message });
        if (message.epoch !== this.epoch) {
            this.deliver(client, { op: 'ack', seq: message.seq, ok: false, error: 'stale-epoch' });
            return;
        }
        const checked = validateOps(message.ops, { currentLength: this.model.ids.length });
        if (!checked.ok) {
            this.deliver(client, { op: 'ack', seq: message.seq, ok: false, error: checked.error });
            return;
        }
        const before = clone(this.model);
        const result = applyOps(this.model, message.ops);
        this.model = result.snapshot;
        this.log.push(message.ops);
        if (!deepEqual(before, this.model)) this.changed();
        this.deliver(client, { op: 'ack', seq: message.seq, ok: true, rev: this.rev, skipped: result.skipped });
    }

    // Host-local actions (the app's own UI).
    local(fn) {
        const before = clone(this.model);
        fn(this.model);
        if (!deepEqual(before, this.model)) this.changed();
    }

    newId() { return `h.${this.idCounter += 1}`; }
}

class SimClient {
    constructor(sim, clock, host, rand, id) {
        this.id = id;
        this.clock = clock;
        this.host = host;
        this.rand = rand;
        this.adapter = new FakeAdapter();
        this.up = false;
        this.gen = 0;
        this.lastDown = 0;
        this.lastUp = 0;
        this.dirtyTimer = null;
        this.seq = 0;
        this.waiters = new Map();
        this.counter = 0;
        this.prefix = `c${id}`;
        this.engine = new SyncEngine({
            adapter: this.adapter,
            send: message => this.send(message),
            now: () => clock.t,
            setTimer: (fn, ms) => clock.at(ms, fn),
            clearTimer: handle => clock.cancel(handle),
            onError: () => {}
        });
        host.clients.push(this);
    }

    connect() {
        this.gen += 1;
        this.up = true;
        this.lastUp = this.clock.t;
        this.lastDown = this.clock.t;
        this.engine.onConnected();
        this.send({ op: 'hello' }).catch(() => {});
    }

    disconnect() {
        if (!this.up) return;
        this.up = false;
        for (const waiter of this.waiters.values()) waiter.reject(new Error('closed'));
        this.waiters.clear();
        this.engine.onDisconnected();
    }

    send(message) {
        if (!this.up) return Promise.reject(new Error('closed'));
        const seq = this.seq += 1;
        const generation = this.gen;
        const payload = { ...message, seq };
        const delay = this.rand() * 80;
        const time = Math.max(this.lastUp, this.clock.t + delay);
        this.lastUp = time;
        this.clock.at(time - this.clock.t, () => {
            if (this.up && this.gen === generation) this.host.handle(this, payload);
        });
        return new Promise((resolve, reject) => this.waiters.set(seq, { resolve, reject }));
    }

    receive(message) {
        if (message.op === 'ack') {
            const waiter = this.waiters.get(message.seq);
            this.waiters.delete(message.seq);
            waiter?.resolve(message);
        } else if (message.op === 'state') {
            this.engine.onState(message);
        }
    }

    // ---- local user actions (always with a gesture unless told otherwise) ----

    gesture() { this.engine.noteGesture(); }
    get model() { return this.adapter.model; }

    setKey(index, key, value, { gesture = true } = {}) {
        if (!this.up || !this.model.ids[index]) return;
        if (gesture) this.gesture();
        this.model.pipeline[index][key] = value;
        this.engine.markDirty(this.model.ids[index]);
    }

    remove(index) {
        if (!this.up || !this.model.ids[index]) return;
        this.gesture();
        this.model.ids.splice(index, 1);
        this.model.pipeline.splice(index, 1);
        this.engine.markDirty(null);
    }

    insert(index, nm = 'Volume') {
        if (!this.up) return;
        this.gesture();
        const at = Math.min(index, this.model.ids.length);
        this.model.ids.splice(at, 0, `${this.prefix}.${this.counter += 1}`);
        this.model.pipeline.splice(at, 0, { nm, en: true, vl: 0, f0: 0, q: 0 });
        this.engine.markDirty(null);
    }

    move(from, to) {
        if (!this.up || !this.model.ids[from]) return;
        this.gesture();
        const [id] = this.model.ids.splice(from, 1);
        const [item] = this.model.pipeline.splice(from, 1);
        const at = Math.min(to, this.model.ids.length);
        this.model.ids.splice(at, 0, id);
        this.model.pipeline.splice(at, 0, item);
        this.engine.markDirty(null);
    }

    toggleBypass() {
        if (!this.up) return;
        this.gesture();
        this.model.masterBypass = !this.model.masterBypass;
        this.engine.markDirty(null);
    }
}

function seedHost(host) {
    host.local(model => {
        for (const nm of ['Volume', '5Band PEQ', 'Volume', 'Mute']) {
            model.ids.push(host.newId());
            model.pipeline.push({ nm, en: true, vl: 0, f0: 0, q: 0 });
        }
    });
}

function assertConverged(host, clients, label) {
    for (const client of clients) {
        assert.deepEqual(client.engine.pending, [], `${label}: client ${client.id} has pending batches`);
        const model = client.model;
        assert.equal(new Set(model.ids).size, model.ids.length, `${label}: duplicate ids on client ${client.id}`);
        assert.ok(deepEqual(model, host.model),
            `${label}: client ${client.id} differs\nclient ${JSON.stringify(model)}\nhost   ${JSON.stringify(host.model)}`);
    }
    assert.equal(new Set(host.model.ids).size, host.model.ids.length, `${label}: duplicate ids on host`);
}

function randomAction(rand, host, clients, clock, state) {
    const roll = rand();
    const client = clients[Math.floor(rand() * clients.length)];
    const n = client.model.ids.length;
    const index = n ? Math.floor(rand() * n) : 0;
    if (roll < 0.3) {
        client.setKey(index, ['vl', 'f0', 'q'][Math.floor(rand() * 3)], Math.round(rand() * 100) - 50);
    } else if (roll < 0.4) {
        client.remove(index);
    } else if (roll < 0.5) {
        client.insert(index);
    } else if (roll < 0.58) {
        client.move(index, Math.floor(rand() * (n + 1)));
    } else if (roll < 0.62) {
        client.toggleBypass();
    } else if (roll < 0.74) {
        // the app's own UI: a parameter, a structural edit or a destructive replace
        host.local(model => {
            const hostIndex = Math.floor(rand() * model.ids.length);
            const kind = rand();
            if (kind < 0.5 && model.ids.length) {
                model.pipeline[hostIndex] = { ...model.pipeline[hostIndex], [['vl', 'f0', 'q'][Math.floor(rand() * 3)]]: Math.round(rand() * 100) - 50 };
            } else if (kind < 0.65 && model.ids.length) {
                model.ids.splice(hostIndex, 1);
                model.pipeline.splice(hostIndex, 1);
            } else if (kind < 0.8) {
                const at = Math.floor(rand() * (model.ids.length + 1));
                model.ids.splice(at, 0, host.newId());
                model.pipeline.splice(at, 0, { nm: 'Mute', en: true, vl: 0, f0: 0, q: 0 });
            } else if (kind < 0.9 && model.ids.length > 1) {
                const [id] = model.ids.splice(hostIndex, 1);
                const [item] = model.pipeline.splice(hostIndex, 1);
                const at = Math.floor(rand() * (model.ids.length + 1));
                model.ids.splice(at, 0, id);
                model.pipeline.splice(at, 0, item);
            } else {
                // preset load / undo / chain: same content, every id new
                model.ids = model.ids.map(() => host.newId());
            }
        });
    } else if (roll < 0.8) {
        // a held drag: many quick sets on one control while everything else goes on
        const start = clock.t;
        for (let k = 0; k < 20; k += 1) {
            clock.at(k * 30, () => client.setKey(Math.min(index, Math.max(0, client.model.ids.length - 1)), 'vl', start % 97 + k));
        }
    } else if (roll < 0.86) {
        client.disconnect();
        clock.at(rand() * 1500, () => client.connect());
    } else if (roll < 0.89 && state.epochChanges < 2) {
        // the host window reloads: new epoch, every id new
        state.epochChanges += 1;
        host.epoch = `e${state.epochChanges}000000`;
        host.local(model => { model.ids = model.ids.map(() => host.newId()); });
        host.rev += 1;
    } else if (roll < 0.95) {
        // a plugin rewrites its own parameter without a user gesture
        clock.at(GESTURE_WINDOW_MS + 100, () => {
            // only when this client has been left alone for the whole window
            if (client.model.ids.length && clock.t - client.engine.lastGestureAt > GESTURE_WINDOW_MS) {
                client.setKey(0, 'vl', 777, { gesture: false });
            }
        });
    } else {
        client.setKey(index, 'en', rand() < 0.5);
    }
}

test('three clients and the host converge under random concurrent edits', async () => {
    let edits = 0;
    let epochChanges = 0;
    for (let seed = 1; seed <= 200; seed += 1) {
        const rand = rng(seed * 101);
        const clock = new Clock();
        const host = new SimHost(clock, rand);
        seedHost(host);
        const clients = [1, 2, 3].map(id => new SimClient(null, clock, host, rand, id));
        for (const client of clients) client.connect();
        await clock.run(500);
        const state = { epochChanges: 0 };
        const steps = 25 + Math.floor(rand() * 35);
        for (let step = 0; step < steps; step += 1) {
            randomAction(rand, host, clients, clock, state);
            await clock.run(clock.t + rand() * 220);
        }
        for (const client of clients) if (!client.up) client.connect();
        // let every timer, ack timeout and backpressure flush run out
        await clock.run(clock.t + ACK_TIMEOUT_MS * 2 + GESTURE_WINDOW_MS + 5000);
        assertConverged(host, clients, `seed ${seed}`);
        edits += host.received.length;
        epochChanges += state.epochChanges;
        for (const { message } of host.received) {
            assert.ok(!message.ops.some(op => op.t === 'set' && op.p.vl === 777), `seed ${seed}: an ungestured rewrite was sent`);
        }
    }
    // the scripts really exercised the protocol
    assert.ok(edits > 2000, `only ${edits} edits reached the host`);
    assert.ok(epochChanges > 50, `only ${epochChanges} epoch changes`);
});

test('the app arrival order decides concurrent edits of the same key', async () => {
    const clock = new Clock();
    const rand = rng(7);
    const host = new SimHost(clock, rand, { backpressure: false });
    seedHost(host);
    const [a, b] = [1, 2].map(id => new SimClient(null, clock, host, rand, id));
    a.connect();
    b.connect();
    await clock.run(1000);
    a.setKey(0, 'vl', -1);
    b.setKey(0, 'vl', -2);
    await clock.run(clock.t + 5000);
    const winner = host.model.pipeline[0].vl;
    assert.ok(winner === -1 || winner === -2);
    const lastSet = host.log.flat().filter(op => op.t === 'set').at(-1);
    assert.equal(lastSet.p.vl, winner);
    assertConverged(host, [a, b], 'same key');
});

test('different keys of one stage edited at once are both kept', async () => {
    const clock = new Clock();
    const rand = rng(11);
    const host = new SimHost(clock, rand, { backpressure: false });
    seedHost(host);
    const [a, b] = [1, 2].map(id => new SimClient(null, clock, host, rand, id));
    a.connect();
    b.connect();
    await clock.run(1000);
    a.setKey(0, 'vl', -5);
    b.setKey(0, 'f0', 440);
    host.local(model => { model.pipeline[0] = { ...model.pipeline[0], q: 2 }; });
    await clock.run(clock.t + 5000);
    assert.deepEqual([host.model.pipeline[0].vl, host.model.pipeline[0].f0, host.model.pipeline[0].q], [-5, 440, 2]);
    assertConverged(host, [a, b], 'different keys');
});

test('an edit of a stage another participant deleted is skipped and everyone converges', async () => {
    const clock = new Clock();
    const rand = rng(13);
    const host = new SimHost(clock, rand, { backpressure: false });
    seedHost(host);
    const [a, b] = [1, 2].map(id => new SimClient(null, clock, host, rand, id));
    a.connect();
    b.connect();
    await clock.run(1000);
    const target = host.model.ids[1];
    b.remove(1);
    await clock.run(clock.t + 400);
    // a has not heard yet in some interleavings; either way the stage ends up gone
    a.setKey(a.model.ids.indexOf(target) >= 0 ? a.model.ids.indexOf(target) : 0, 'vl', -9);
    await clock.run(clock.t + 5000);
    assert.ok(!host.model.ids.includes(target));
    assertConverged(host, [a, b], 'set vs delete');
});

test('a change nobody made with a gesture is replaced by the host value', async () => {
    const clock = new Clock();
    const rand = rng(17);
    const host = new SimHost(clock, rand, { backpressure: false });
    seedHost(host);
    const [a] = [new SimClient(null, clock, host, rand, 1)];
    a.connect();
    await clock.run(GESTURE_WINDOW_MS + 3000);
    a.setKey(0, 'vl', 5, { gesture: false });
    await clock.run(clock.t + 1000);
    assert.equal(host.received.length, 0);
    host.local(model => { model.pipeline[1] = { ...model.pipeline[1], vl: 3 }; });
    await clock.run(clock.t + 1000);
    assert.equal(a.model.pipeline[0].vl, 0, 'host truth restored');
    assertConverged(host, [a], 'ungestured');
});

test('a batch without an ack is dropped after the timeout and the state is requested again', async () => {
    const clock = new Clock();
    const requests = [];
    const adapter = new FakeAdapter();
    const engine = new SyncEngine({
        adapter,
        send: message => { requests.push(message); return new Promise(() => {}); },
        now: () => clock.t,
        setTimer: (fn, ms) => clock.at(ms, fn),
        clearTimer: handle => clock.cancel(handle)
    });
    engine.onConnected();
    engine.onState({ op: 'state', rev: 1, epoch: 'e1', masterBypass: false, slot: 'A', ids: ['h.1'], pipeline: [{ nm: 'Volume', en: true, vl: 0 }] });
    engine.noteGesture();
    adapter.model.pipeline[0].vl = -3;
    engine.markDirty('h.1');
    await clock.run(100);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].op, 'edit');
    assert.equal(requests[0].epoch, 'e1');
    assert.equal(requests[0].base, 1);
    assert.equal(engine.pending.length, 1);
    await clock.run(ACK_TIMEOUT_MS + 200);
    assert.equal(engine.pending.length, 0);
    assert.equal(requests.at(-1).op, 'get');
    assert.equal(adapter.model.pipeline[0].vl, 0, 'editor shows the host again');
});

test('a failed ack removes the batch, restores the host value and reports the error', async () => {
    const clock = new Clock();
    const errors = [];
    const sent = [];
    const adapter = new FakeAdapter();
    let reply;
    const engine = new SyncEngine({
        adapter,
        send: message => { sent.push(message); return new Promise(resolve => { reply = resolve; }); },
        now: () => clock.t,
        setTimer: (fn, ms) => clock.at(ms, fn),
        clearTimer: handle => clock.cancel(handle),
        onError: error => errors.push(error.message)
    });
    engine.onConnected();
    engine.onState({ op: 'state', rev: 1, epoch: 'e1', masterBypass: false, slot: 'A', ids: ['h.1'], pipeline: [{ nm: 'Volume', en: true, vl: 0 }] });
    engine.noteGesture();
    adapter.model.pipeline[0].vl = -3;
    engine.markDirty('h.1');
    await clock.run(100);
    reply({ op: 'ack', ok: false, error: 'stale-epoch' });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(errors, ['stale-epoch']);
    assert.equal(engine.pending.length, 0);
    assert.equal(adapter.model.pipeline[0].vl, 0);
    assert.equal(sent.at(-1).op, 'get');
});

test('an edit carries the slot it was made against and a slot-mismatch ack re-fetches the state', async () => {
    const clock = new Clock();
    const sent = [];
    const errors = [];
    const adapter = new FakeAdapter();
    let reply;
    const engine = new SyncEngine({
        adapter,
        send: message => { sent.push(message); return new Promise(resolve => { reply = resolve; }); },
        now: () => clock.t,
        setTimer: (fn, ms) => clock.at(ms, fn),
        clearTimer: handle => clock.cancel(handle),
        onError: error => errors.push(error.message)
    });
    engine.onConnected();
    engine.onState({ op: 'state', rev: 1, epoch: 'e1', masterBypass: false, slot: 'B', ids: ['h.1'], pipeline: [{ nm: 'Volume', en: true, vl: 0 }] });
    engine.noteGesture();
    adapter.model.pipeline[0].vl = -3;
    engine.markDirty('h.1');
    await clock.run(100);
    assert.equal(sent[0].op, 'edit');
    assert.equal(sent[0].slot, 'B');
    reply({ op: 'ack', ok: false, error: 'slot-mismatch' });
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(errors, ['slot-mismatch']);
    assert.equal(sent.at(-1).op, 'get');
});

test('reconcile applies once more when the first apply left the editor different from the model', () => {
    const adapter = new FakeAdapter();
    let calls = 0;
    const realApply = adapter.apply.bind(adapter);
    // The first apply drops the bus key of the inserted stage, as a recycled instance keeping stale state would.
    adapter.apply = ops => {
        calls += 1;
        realApply(ops);
        if (calls === 1) adapter.model.pipeline[0] = { nm: 'Volume', en: true, vl: 0 };
    };
    const engine = new SyncEngine({ adapter, send: () => new Promise(() => {}) });
    engine.onConnected();
    engine.onState({ op: 'state', rev: 1, epoch: 'e1', masterBypass: false, slot: 'A', ids: ['h.1'], pipeline: [{ nm: 'Volume', en: true, vl: 0, ib: 2 }] });
    assert.equal(calls, 2);
    assert.equal(engine.divergences, 1);
    assert.equal(adapter.model.pipeline[0].ib, 2);
});

test('states older than the confirmed one are ignored and a new epoch drops pending edits', async () => {
    const clock = new Clock();
    const adapter = new FakeAdapter();
    const engine = new SyncEngine({
        adapter,
        send: () => new Promise(() => {}),
        now: () => clock.t,
        setTimer: (fn, ms) => clock.at(ms, fn),
        clearTimer: handle => clock.cancel(handle)
    });
    const state = (rev, epoch, vl, id = 'h.1') => ({ op: 'state', rev, epoch, masterBypass: false, slot: 'A', ids: [id], pipeline: [{ nm: 'Volume', en: true, vl }] });
    engine.onState(state(5, 'e1', 1));
    assert.equal(adapter.model.ids.length, 0, 'states are ignored while disconnected');
    engine.onConnected();
    engine.onState(state(5, 'e1', 1));
    engine.onState(state(4, 'e1', 99));
    assert.equal(adapter.model.pipeline[0].vl, 1);
    engine.noteGesture();
    adapter.model.pipeline[0].vl = 8;
    engine.markDirty('h.1');
    await clock.run(100);
    assert.equal(engine.pending.length, 1);
    engine.onState(state(1, 'e2', 3, 'h.9'));
    assert.equal(engine.pending.length, 0);
    assert.deepEqual(adapter.model.ids, ['h.9']);
    assert.equal(adapter.model.pipeline[0].vl, 3);
});

test('disconnecting clears pending edits and blocks new ones until a state is adopted', async () => {
    const clock = new Clock();
    const requests = [];
    const adapter = new FakeAdapter();
    const engine = new SyncEngine({
        adapter,
        send: message => { requests.push(message); return new Promise(() => {}); },
        now: () => clock.t,
        setTimer: (fn, ms) => clock.at(ms, fn),
        clearTimer: handle => clock.cancel(handle)
    });
    engine.onConnected();
    engine.onState({ op: 'state', rev: 1, epoch: 'e1', masterBypass: false, slot: 'A', ids: ['h.1'], pipeline: [{ nm: 'Volume', en: true, vl: 0 }] });
    engine.noteGesture();
    adapter.model.pipeline[0].vl = 4;
    engine.markDirty('h.1');
    await clock.run(100);
    engine.onDisconnected();
    assert.equal(engine.pending.length, 0);
    assert.equal(engine.expected(), null);
    engine.markDirty('h.1');
    await clock.run(200);
    assert.equal(requests.length, 1, 'nothing is sent while disconnected');
    assert.equal(engine.isIdle(), true);
});

test('a large local rewrite is split into batches the host accepts', async () => {
    const clock = new Clock();
    const requests = [];
    const adapter = new FakeAdapter();
    const engine = new SyncEngine({
        adapter,
        send: message => { requests.push(message); return new Promise(() => {}); },
        now: () => clock.t,
        setTimer: (fn, ms) => clock.at(ms, fn),
        clearTimer: handle => clock.cancel(handle)
    });
    engine.onConnected();
    engine.onState({ op: 'state', rev: 1, epoch: 'e1', masterBypass: false, slot: 'A', ids: [], pipeline: [] });
    engine.noteGesture();
    for (let i = 0; i < 1200; i += 1) {
        adapter.model.ids.push(`c.${i}`);
        adapter.model.pipeline.push({ nm: 'Volume', en: true, vl: 0 });
    }
    engine.markDirty(null);
    await clock.run(100);
    assert.ok(requests.length >= 3);
    assert.ok(requests.every(request => request.ops.length <= 500));
});
