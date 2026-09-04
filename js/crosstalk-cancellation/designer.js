function designerError(message, code) {
    const error = new Error(message);
    if (code) error.code = code;
    return error;
}

export class CrosstalkCancellationDesigner {
    constructor({ workerFactory } = {}) {
        this.worker = workerFactory
            ? workerFactory()
            : new Worker(new URL('./design-worker.js', import.meta.url), { type: 'module' });
        this.sequence = 0;
        this.pending = new Map();
        this.closed = false;
        this.worker.onmessage = event => this.handleMessage(event.data);
        this.worker.onerror = event => this.handleWorkerError(
            event.error || designerError('Crosstalk Cancellation design worker failed.', 'worker-failed')
        );
    }

    design(config, sources) {
        if (this.closed) {
            return Promise.reject(designerError(
                'Crosstalk Cancellation designer is closed.',
                'designer-closed'
            ));
        }
        const requestId = ++this.sequence;
        this.rejectAll(designerError(
            'Crosstalk Cancellation design was superseded.',
            'design-superseded'
        ));
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            this.worker.postMessage({ type: 'design', requestId, config, sources });
        });
    }

    handleMessage(message) {
        if (message?.requestId !== this.sequence) return;
        const pending = this.pending.get(message.requestId);
        if (!pending) return;
        this.pending.delete(message.requestId);
        if (message.type === 'result') pending.resolve(message);
        else pending.reject(designerError(
            message.message || 'Crosstalk Cancellation filter design failed.',
            message.code || 'design-failed'
        ));
    }

    handleWorkerError(error) {
        if (this.closed) return;
        this.closed = true;
        this.rejectAll(error);
        this.worker.terminate();
    }

    rejectAll(error) {
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
    }

    close() {
        if (this.closed) return;
        this.closed = true;
        this.rejectAll(designerError(
            'Crosstalk Cancellation designer is closed.',
            'designer-closed'
        ));
        this.worker.terminate();
    }
}

export function createCrosstalkCancellationDesigner(options) {
    return new CrosstalkCancellationDesigner(options);
}
