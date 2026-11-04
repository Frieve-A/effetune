// Independently authored from the algorithm in RFC 1321, sections 3.1–3.5.
// This format fingerprint identifies original sample bytes, not authentication.
const rotations = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
const constants = Uint32Array.from({ length: 64 }, (_, index) =>
    Math.floor(4294967296 * Math.abs(Math.sin(index + 1))));

export class SfzMd5 {
    constructor() {
        this.state = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
        this.pending = new Uint8Array(64);
        this.pendingView = new DataView(this.pending.buffer);
        this.used = 0;
        this.bytes = 0;
        this.result = null;
    }

    update(bytes) {
        if (this.result !== null || !(bytes instanceof Uint8Array) ||
            !Number.isSafeInteger(this.bytes + bytes.length)) throw new Error('Invalid sample fingerprint input.');
        this.bytes += bytes.length;
        let offset = 0;
        if (this.used) {
            const count = Math.min(64 - this.used, bytes.length);
            this.pending.set(bytes.subarray(0, count), this.used);
            this.used += count;
            offset += count;
            if (this.used === 64) { this.block(this.pendingView, 0); this.used = 0; }
        }
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        while (offset + 64 <= bytes.length) { this.block(view, offset); offset += 64; }
        if (offset < bytes.length) {
            this.pending.set(bytes.subarray(offset));
            this.used = bytes.length - offset;
        }
        return this;
    }

    block(words, offset) {
        let [a, b, c, d] = this.state;
        for (let index = 0; index < 64; index++) {
            const round = index >>> 4;
            const mix = round === 0 ? (b & c) | (~b & d) : round === 1 ?
                (b & d) | (c & ~d) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
            const word = round === 0 ? index : round === 1 ? (5 * index + 1) & 15 :
                round === 2 ? (3 * index + 5) & 15 : (7 * index) & 15;
            const sum = (a + mix + constants[index] + words.getUint32(offset + word * 4, true)) | 0;
            const shift = rotations[round][index & 3];
            const next = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
            a = d; d = c; c = b; b = next;
        }
        this.state[0] += a; this.state[1] += b;
        this.state[2] += c; this.state[3] += d;
    }

    digest() {
        if (this.result !== null) return this.result;
        const length = this.bytes;
        const padding = new Uint8Array(this.used < 56 ? 64 - this.used : 128 - this.used);
        padding[0] = 128;
        const view = new DataView(padding.buffer);
        view.setUint32(padding.length - 8, (length % 536870912) * 8, true);
        view.setUint32(padding.length - 4, Math.floor(length / 536870912), true);
        this.update(padding);
        this.result = Array.from(this.state, word => Array.from({ length: 4 }, (_, byte) =>
            ((word >>> (8 * byte)) & 255).toString(16).padStart(2, '0')).join('')).join('');
        return this.result;
    }
}
