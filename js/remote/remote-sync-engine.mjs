// Client side of the "sync1" extension of remote-v1 (see docs/remote-v1.md).
//
// The host broadcasts full states and applies edits in one total order. This
// engine keeps `confirmed` (the last state it adopted) and `pending` (batches it
// sent that the host has not yet folded into a state); the editor always shows
// apply(confirmed, pending). Everything outside this file (WebSocket, DOM, the
// plugin model) is reached through injected functions, so it runs in node tests.
//
//   adapter.snapshot()            -> { masterBypass, slot, pipeline: [short item], ids: [id] }
//                                    of the live editor; gives new plugins an id
//   adapter.apply(ops, {recycle}) -> applies ops to the live editor (no echo)
//   adapter.setSlot?(slot)        -> shows the host's active pipeline
//   send(message)                 -> Promise of the ack (rejects when the socket is gone)

import { applyOps, deepEqual, diff } from './sync-ops.mjs';

export const FLUSH_INTERVAL_MS = 33;
export const GESTURE_WINDOW_MS = 2000;
export const ACK_TIMEOUT_MS = 10000;
const MAX_BATCH_OPS = 500;

export class SyncEngine {
    constructor({
        adapter,
        send,
        now = () => Date.now(),
        setTimer = (fn, ms) => setTimeout(fn, ms),
        clearTimer = handle => clearTimeout(handle),
        onError = () => {}
    }) {
        this.adapter = adapter;
        this.sendMessage = send;
        this.now = now;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.onError = onError;
        this.confirmed = null;   // { epoch, rev, snapshot }
        this.pending = [];       // { ops, ackRev, timer }
        this.connected = false;
        this.dirtyAll = false;
        this.dirtyIds = new Set();
        this.flushTimer = null;
        this.divergences = 0;    // reconcile passes that needed a second apply
        // A change is only sent while the user is acting on this page.
        this.lastGestureAt = Number.NEGATIVE_INFINITY;
    }

    // ---- inputs ------------------------------------------------------------

    noteGesture() {
        this.lastGestureAt = this.now();
    }

    onConnected() {
        this.connected = true;
    }

    // Pending edits are dropped, never resent: a resent `set` whose ack was lost
    // could bring back a value somebody else has overwritten since.
    onDisconnected() {
        this.connected = false;
        this.confirmed = null;
        this.clearPending();
        this.clearDirty();
    }

    onState(message) {
        if (!this.connected) return;
        if (this.confirmed) this.flushNow();
        const snapshot = {
            masterBypass: !!message.masterBypass,
            slot: message.slot === 'B' ? 'B' : 'A',
            pipeline: Array.isArray(message.pipeline) ? message.pipeline : [],
            ids: Array.isArray(message.ids) ? message.ids : []
        };
        const next = { epoch: message.epoch, rev: message.rev, snapshot };
        if (!this.confirmed || message.epoch !== this.confirmed.epoch) {
            this.clearPending();
            this.confirmed = next;
        } else if (message.rev < this.confirmed.rev) {
            return;
        } else {
            this.confirmed = next;
        }
        this.dropContained();
        this.reconcile();
    }

    // The editor changed. `id` names the stage when only its parameters did;
    // without it (or on a structural change) the whole pipeline is compared.
    markDirty(id) {
        if (!this.connected || !this.confirmed) return;
        if (id === undefined || id === null) this.dirtyAll = true;
        else this.dirtyIds.add(id);
        if (this.flushTimer === null) {
            this.flushTimer = this.setTimer(() => {
                this.flushTimer = null;
                this.flushNow();
            }, FLUSH_INTERVAL_MS);
        }
    }

    // ---- model -------------------------------------------------------------

    expected() {
        if (!this.confirmed) return null;
        const ops = this.pending.flatMap(entry => entry.ops);
        return ops.length ? applyOps(this.confirmed.snapshot, ops).snapshot : this.confirmed.snapshot;
    }

    isIdle() {
        return this.pending.length === 0 && !this.dirtyAll && this.dirtyIds.size === 0;
    }

    reconcile() {
        const expected = this.expected();
        if (!expected) return;
        const local = this.adapter.snapshot();
        const ops = diff(local, expected);
        if (ops.length > 0) {
            this.adapter.apply(ops, { recycle: true });
            // Safety net: the editor must now equal the model. A residue means an op
            // left state behind (a recycled instance keeping an old bus, say); one
            // more pass puts it right instead of leaving it to be sent to the host
            // later as if the user had done it.
            const rest = diff(this.adapter.snapshot(), expected);
            if (rest.length > 0) {
                this.divergences += 1;
                this.adapter.apply(rest, { recycle: false });
            }
        }
        this.adapter.setSlot?.(expected.slot);
    }

    dropContained() {
        this.pending = this.pending.filter(entry => {
            const done = entry.ackRev !== null && entry.ackRev <= this.confirmed.rev;
            if (done) this.clearTimer(entry.timer);
            return !done;
        });
    }

    clearPending() {
        for (const entry of this.pending) this.clearTimer(entry.timer);
        this.pending = [];
    }

    clearDirty() {
        this.dirtyAll = false;
        this.dirtyIds.clear();
        if (this.flushTimer !== null) this.clearTimer(this.flushTimer);
        this.flushTimer = null;
    }

    // ---- sending -----------------------------------------------------------

    flushNow() {
        const dirtyAll = this.dirtyAll;
        const dirtyIds = new Set(this.dirtyIds);
        this.clearDirty();
        if (!this.connected || !this.confirmed) return;
        if (!dirtyAll && dirtyIds.size === 0) return;
        // Not a user's doing (a plugin rewriting its own parameters, say): the
        // host's value is put back instead of being sent.
        if (this.now() - this.lastGestureAt > GESTURE_WINDOW_MS) {
            this.reconcile();
            return;
        }

        const expected = this.expected();
        const local = this.adapter.snapshot();
        let ops = diff(expected, local);
        if (!dirtyAll && sameIds(expected.ids, local.ids)) {
            ops = ops.filter(op => op.t === 'set' ? dirtyIds.has(op.id) : op.t !== 'bypass');
        }
        for (let i = 0; i < ops.length; i += MAX_BATCH_OPS) {
            this.sendBatch(ops.slice(i, i + MAX_BATCH_OPS));
        }
    }

    sendBatch(ops) {
        const entry = { ops, ackRev: null, timer: null };
        this.pending.push(entry);
        entry.timer = this.setTimer(() => {
            if (!this.pending.includes(entry)) return;
            this.settle(entry);
            this.requestState();
        }, ACK_TIMEOUT_MS);
        const epoch = this.confirmed.epoch;
        const base = this.confirmed.rev;
        // The pipeline the batch was made against; the host refuses it when another one is active.
        const slot = this.confirmed.snapshot.slot;
        let reply;
        try {
            reply = this.sendMessage({ op: 'edit', epoch, base, slot, ops });
        } catch (error) {
            this.settle(entry);
            this.onError(error);
            return;
        }
        Promise.resolve(reply).then(ack => this.onAck(entry, ack), () => {
            // The socket went away; onDisconnected() already cleared the batch.
            if (this.pending.includes(entry)) this.settle(entry);
        });
    }

    onAck(entry, ack) {
        if (!this.pending.includes(entry)) return;
        if (!ack || ack.ok !== true) {
            this.settle(entry);
            if (ack?.error === 'stale-epoch' || ack?.error === 'slot-mismatch') this.requestState();
            this.onError(new Error(ack?.error || 'edit failed'));
            return;
        }
        entry.ackRev = Number.isFinite(ack.rev) ? ack.rev : (this.confirmed ? this.confirmed.rev : 0);
        if (this.confirmed && entry.ackRev <= this.confirmed.rev) this.settle(entry);
    }

    // Removes a batch and shows the editor without it.
    settle(entry) {
        this.clearTimer(entry.timer);
        this.pending = this.pending.filter(candidate => candidate !== entry);
        this.reconcile();
    }

    requestState() {
        try {
            Promise.resolve(this.sendMessage({ op: 'get' })).catch(() => {});
        } catch (_) { /* socket gone; reconnect adopts a fresh state */ }
    }
}

function sameIds(a, b) {
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

export { deepEqual };
