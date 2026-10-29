import { base64ToBytes, bytesToBase64, getAndroidBridge } from './bridge.js';

export const ANDROID_FILE_CHUNK_BYTES = 256 * 1024;

export class AndroidDocuments {
    constructor(bridge = getAndroidBridge()) { this.bridge = bridge; }

    pick(options) { return this.bridge.request('documents.pick', options); }
    list(uri, offset = 0) { return this.bridge.request('documents.list', { uri, offset, limit: 256 }); }

    async read(uri, { maximumBytes, signal } = {}) {
        if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
            throw new RangeError('A document read requires a size limit');
        }
        const chunks = [];
        let offset = 0;
        for (;;) {
            signal?.throwIfAborted();
            const result = await this.bridge.request('documents.read', {
                uri, offset, length: Math.min(ANDROID_FILE_CHUNK_BYTES, maximumBytes - offset + 1)
            });
            signal?.throwIfAborted();
            const bytes = base64ToBytes(result.data);
            if (bytes.byteLength > maximumBytes - offset) throw new RangeError('Document exceeds the size limit');
            chunks.push(bytes);
            offset += bytes.byteLength;
            if (result.eof) break;
            if (!bytes.byteLength) throw new Error('Document provider returned no data');
        }
        const bytes = new Uint8Array(offset);
        let position = 0;
        for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
        return bytes;
    }

    async write(uri, blob, { signal } = {}) {
        const source = blob instanceof Blob ? blob : new Blob([blob]);
        for (let offset = 0; offset < source.size || offset === 0; offset += ANDROID_FILE_CHUNK_BYTES) {
            signal?.throwIfAborted();
            const bytes = new Uint8Array(await source.slice(offset, offset + ANDROID_FILE_CHUNK_BYTES).arrayBuffer());
            await this.bridge.request('documents.write', { uri, data: bytesToBase64(bytes), append: offset !== 0 });
        }
    }
}
