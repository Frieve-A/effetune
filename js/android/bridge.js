export const ANDROID_ORIGIN = 'https://appassets.androidplatform.net';
export const ANDROID_PROTOCOL_VERSION = 1;
export const ANDROID_MESSAGE_LIMIT = 1024 * 1024;

export function isAndroidHost(windowRef = globalThis.window) {
    return windowRef?.location?.origin === ANDROID_ORIGIN &&
        typeof windowRef.effetuneAndroid?.postMessage === 'function';
}

export function bytesToBase64(bytes) {
    let text = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
        text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(text);
}

export function base64ToBytes(text) {
    return Uint8Array.from(atob(text), character => character.charCodeAt(0));
}

export class AndroidBridge {
    constructor(windowRef = globalThis.window, { timeoutMs = 30000 } = {}) {
        if (!isAndroidHost(windowRef)) throw new Error('Android host is unavailable');
        this.transport = windowRef.effetuneAndroid;
        this.timeoutMs = timeoutMs;
        this.pending = new Map();
        this.listeners = new Map();
        this.closed = false;
        this.transport.onmessage = event => this.receive(event.data);
    }

    request(command, payload = {}, expectedRevision) {
        if (this.closed) return Promise.reject(new Error('Android connection is closed'));
        const id = crypto.randomUUID();
        const message = JSON.stringify({ version: ANDROID_PROTOCOL_VERSION, id, command, payload,
            ...(expectedRevision === undefined ? {} : { expectedRevision }) });
        if (new TextEncoder().encode(message).byteLength > ANDROID_MESSAGE_LIMIT) {
            return Promise.reject(new RangeError('Android request exceeds the transfer limit'));
        }
        return new Promise((resolve, reject) => {
            const timer = command === 'documents.pick' ? null : setTimeout(() => {
                this.pending.delete(id);
                reject(new Error('Android request timed out'));
            }, this.timeoutMs);
            this.pending.set(id, { resolve, reject, timer });
            try {
                this.transport.postMessage(message);
            } catch (error) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(error);
            }
        });
    }

    receive(text) {
        if (this.closed || typeof text !== 'string' ||
            new TextEncoder().encode(text).byteLength > ANDROID_MESSAGE_LIMIT) return;
        let message;
        try { message = JSON.parse(text); } catch { return; }
        if (message?.version !== ANDROID_PROTOCOL_VERSION) return;
        if (typeof message.event === 'string') {
            for (const listener of this.listeners.get(message.event) || []) listener(message.data);
            return;
        }
        const pending = this.pending.get(message.id);
        if (!pending || typeof message.ok !== 'boolean') return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.ok) pending.resolve(message.result);
        else {
            const error = new Error('The Android operation could not be completed');
            error.code = message.error?.code;
            if (error.code === 'cancelled') error.name = 'AbortError';
            pending.reject(error);
        }
    }

    on(event, listener) {
        if (!this.listeners.has(event)) this.listeners.set(event, new Set());
        this.listeners.get(event).add(listener);
        return () => this.listeners.get(event)?.delete(listener);
    }

    close() {
        this.closed = true;
        this.transport.onmessage = null;
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(new Error('Android connection is closed'));
        }
        this.pending.clear();
        this.listeners.clear();
    }
}

let bridge;
export function getAndroidBridge() {
    return bridge ||= new AndroidBridge();
}
