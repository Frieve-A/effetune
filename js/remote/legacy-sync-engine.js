import { diff } from './sync-ops.mjs';

// Original v1 peers provide complete state, chain and bypass operations but no
// stage identities or edit/history extension. Never send extension operations.
export class LegacySyncEngine {
    constructor({ adapter, send, onError = () => {} }) {
        this.adapter = adapter;
        this.send = send;
        this.onError = onError;
        this.connected = false;
        this.confirmed = null;
        this.timer = null;
        this.gestureAt = -Infinity;
    }
    noteGesture() { this.gestureAt = Date.now(); }
    beginOperation() { this.noteGesture(); }
    endOperation() { this.flushNow(); }
    onConnected() { this.connected = true; }
    onDisconnected() {
        this.connected = false;
        this.confirmed = null;
        clearTimeout(this.timer);
        this.timer = null;
    }
    onState(message) {
        if (!this.connected) return;
        this.flushNow();
        clearTimeout(this.timer);
        this.timer = null;
        const pipeline = message.pipeline || [];
        const snapshot = {
            pipeline, ids: pipeline.map((_, index) => `legacy.${index}`),
            masterBypass: !!message.masterBypass, slot: 'A'
        };
        this.confirmed = { snapshot };
        this.adapter.apply(diff(this.adapter.snapshot(), snapshot), { recycle: true });
        this.adapter.setSlot?.('A');
    }
    markDirty() {
        if (!this.connected || !this.confirmed || this.timer !== null) return;
        this.timer = setTimeout(() => this.flushNow(), 33);
    }
    flushNow() {
        if (this.timer === null) return;
        clearTimeout(this.timer);
        this.timer = null;
        if (!this.connected || !this.confirmed || Date.now() - this.gestureAt > 2000) return;
        const before = this.confirmed.snapshot;
        const current = this.adapter.snapshot();
        const requests = [];
        if (JSON.stringify(before.pipeline) !== JSON.stringify(current.pipeline)) requests.push({ op: 'chain', pipeline: current.pipeline });
        if (before.masterBypass !== current.masterBypass) requests.push({ op: 'bypass', on: current.masterBypass });
        for (const request of requests) {
            this.send(request).then(ack => {
                if (!ack.ok) this.onError(new Error(ack.error || 'edit failed'));
            }).catch(() => {});
        }
    }
}
