export class RoomEqDesigner {
    constructor({ workerFactory } = {}) {
        this.worker = workerFactory
            ? workerFactory()
            : new Worker(new URL('./design-worker.js', import.meta.url), { type: 'module' });
        this.sequence = 0;
        this.pending = new Map();
        this.worker.onmessage = event => this.handleMessage(event.data);
        this.worker.onerror = event => this.rejectAll(event.error || new Error('Room EQ design worker failed'));
    }

    design(config, sources) {
        const requestId = ++this.sequence;
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            this.worker.postMessage({ type: 'design', requestId, config, sources });
        });
    }

    handleMessage(message) {
        const pending = this.pending.get(message?.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        if (message.type === 'result') pending.resolve(message);
        else pending.reject(new Error(message.message || 'Room EQ filter design failed'));
    }

    rejectAll(error) {
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
    }

    close() {
        this.rejectAll(new Error('Room EQ designer closed'));
        this.worker.terminate();
    }
}

export function createRoomEqDesigner(options) {
    return new RoomEqDesigner(options);
}
