import { ANDROID_ORIGIN, getAndroidBridge, isAndroidHost, base64ToBytes } from './bridge.js';

const COMMANDS = new Set(['documents.read', 'documents.list', 'documents.stat',
    'documents.resolve', 'documents.permission', 'documents.compareRoots']);
const pending = new Map();

export function isAndroidDirectory(value) {
    return value?.kind === 'directory' && typeof value.androidUri === 'string' &&
        value.androidUri.startsWith('content://');
}

export function requestAndroidDocument(command, payload) {
    if (!COMMANDS.has(command)) return Promise.reject(new Error('Unsupported document operation'));
    if (isAndroidHost()) return getAndroidBridge().request(command, payload);
    if (globalThis.location?.origin !== ANDROID_ORIGIN || typeof globalThis.postMessage !== 'function') {
        return Promise.reject(new Error('Android document access is unavailable'));
    }
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Document request timed out')); }, 30000);
        pending.set(id, { resolve, reject, timer });
        globalThis.postMessage({ protocolVersion: 1, type: 'android-document-request', id, command, payload });
    });
}

export function receiveAndroidDocumentReply(message) {
    if (message?.type !== 'android-document-reply') return false;
    const operation = pending.get(message.id);
    if (!operation) return true;
    pending.delete(message.id);
    clearTimeout(operation.timer);
    if (message.ok) operation.resolve(message.result);
    else operation.reject(new Error('Android document access failed'));
    return true;
}

export function forwardAndroidDocumentRequest(worker, message) {
    if (message?.type !== 'android-document-request') return false;
    if (!isAndroidHost() || !COMMANDS.has(message.command)) return true;
    void getAndroidBridge().request(message.command, message.payload).then(
        result => worker.postMessage({ protocolVersion: 1, type: 'android-document-reply', id: message.id, ok: true, result }),
        () => worker.postMessage({ protocolVersion: 1, type: 'android-document-reply', id: message.id, ok: false })
    );
    return true;
}

// Blob-compatible range reads let the existing metadata parser stream from SAF.
export class AndroidDocumentFile {
    constructor(record, offset = 0, size = record.size) {
        this.androidUri = record.uri;
        this.name = record.name;
        this.type = record.mimeType || '';
        this.lastModified = record.lastModified || 0;
        this.size = size;
        this.offset = offset;
    }

    slice(start = 0, end = this.size) {
        const first = Math.min(this.size, Math.max(0, start < 0 ? this.size + start : start));
        const last = Math.min(this.size, Math.max(first, end < 0 ? this.size + end : end));
        return new AndroidDocumentFile({ uri: this.androidUri, name: this.name,
            mimeType: this.type, lastModified: this.lastModified }, this.offset + first, last - first);
    }

    stream() {
        let position = 0;
        return new ReadableStream({ pull: async controller => {
            if (position >= this.size) { controller.close(); return; }
            const result = await requestAndroidDocument('documents.read', {
                uri: this.androidUri, offset: this.offset + position,
                length: Math.min(256 * 1024, this.size - position)
            });
            const bytes = base64ToBytes(result.data);
            if (!bytes.length || bytes.length > this.size - position) throw new Error('Document changed while reading');
            position += bytes.length;
            controller.enqueue(bytes);
        } });
    }

    async arrayBuffer() {
        if (this.size > 1024 * 1024 * 1024) throw new RangeError('Document exceeds the in-memory import limit');
        return new Response(this.stream()).arrayBuffer();
    }
    async text() { return new TextDecoder().decode(await this.arrayBuffer()); }
}
