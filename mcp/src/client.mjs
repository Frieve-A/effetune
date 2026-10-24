// A small remote-v1 client (docs/remote-v1.md): one WebSocket to a running EffeTune,
// request/ack matching by `seq`, and the latest `state` push kept for the tools.

import WebSocket from 'ws';

const REQUEST_TIMEOUT_MS = 30000;
// After the ack, how long a request whose reply op is unknown (raw requests) waits
// for a data message carrying its seq.
const RAW_REPLY_GRACE_MS = 1000;
// Frames above this are refused; the app itself never sends more than 4 MB.
const MAX_FRAME_BYTES = 4 * 1024 * 1024;

// The op of the data message that follows the ack, for requests that return data.
const REPLY_OPS = {
    hello: 'state',
    get: 'state',
    listPresets: 'presets',
    getPreset: 'preset',
    presets: 'presets',
    listIRs: 'irs',
    describeEffects: 'effects',
    listMusicDevices: 'musicResult',
    browseMusic: 'musicResult',
    getPlayback: 'musicResult',
    playMusic: 'musicResult',
    queueMusic: 'musicResult',
    controlPlayback: 'musicResult',
    editPlaybackQueue: 'musicResult'
};
const MUSIC_MUTATIONS = new Set(['playMusic', 'queueMusic', 'controlPlayback', 'editPlaybackQueue']);

// Accepts the pairing link (http://host:port/?t=token) or a ws:// URL.
export function toWebSocketUrl(link) {
    let url;
    try {
        url = new URL(String(link || '').trim());
    } catch (_) {
        throw new Error('EFFETUNE_URL is not a URL; use the pairing link from Settings > Remote Control');
    }
    if (url.protocol === 'http:') url.protocol = 'ws:';
    else if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error(`unsupported scheme: ${url.protocol}`);
    if (!url.searchParams.get('t')) throw new Error('the link carries no token (t=...)');
    url.hash = '';
    return url.toString();
}

export class EffeTuneClient {
    constructor({ url, clientName = 'effetune-mcp', clientVersion = '0.0.0', WebSocketImpl = WebSocket, requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
        this.url = url;
        this.clientName = clientName;
        this.clientVersion = clientVersion;
        this.WebSocketImpl = WebSocketImpl;
        this.requestTimeoutMs = requestTimeoutMs;
        this.ws = null;
        this.connecting = null;
        this.seq = 0;
        this.pending = new Map();
        this.state = null;
        this.hello = null;
        this.lastCloseCode = null;
        this.lastSocketError = null;
    }

    get features() { return this.hello?.features || []; }

    hasFeature(name) { return this.features.includes(name); }

    isOpen() { return this.ws?.readyState === this.WebSocketImpl.OPEN && this.hello !== null; }

    // Connects (once) and says hello. Later calls reuse the open socket.
    async connect() {
        if (this.ws && this.ws.readyState === this.WebSocketImpl.OPEN && this.hello) return this.hello;
        if (this.connecting) return this.connecting;
        if (!this.url) throw new Error('EFFETUNE_URL is not set; use the pairing link from Settings > Remote Control');
        this.connecting = this.open().finally(() => { this.connecting = null; });
        return this.connecting;
    }

    async open() {
        const ws = new this.WebSocketImpl(toWebSocketUrl(this.url), { maxPayload: MAX_FRAME_BYTES });
        try {
            await new Promise((resolve, reject) => {
                ws.once('open', resolve);
                ws.once('error', reject);
                ws.once('close', code => reject(new Error(closeReason(code))));
            });
            this.ws = ws;
            this.lastCloseCode = null;
            this.lastSocketError = null;
            ws.on('message', data => { if (this.ws === ws) this.onMessage(data); });
            ws.on('close', code => { if (this.ws === ws) this.onClose(code); });
            // The close that follows carries 1006; keep the cause for the message.
            ws.on('error', error => { if (this.ws === ws) this.lastSocketError = error; });
            const { data } = await this.send({ op: 'hello', v: 1, app: this.clientName, version: this.clientVersion });
            this.hello = data;
            return data;
        } catch (error) {
            if (this.ws === ws) {
                this.ws = null;
                this.hello = null;
            }
            // A failed hello must release its slot before the next connection.
            // Its delayed events must not affect a replacement socket.
            ws.terminate();
            throw error;
        }
    }

    onMessage(data) {
        let msg;
        try { msg = JSON.parse(data.toString()); } catch (_) { return; }
        if (msg.op === 'state') this.adoptState(msg);
        const pending = msg.seq === undefined ? null : this.pending.get(msg.seq);
        if (!pending) return;
        if (msg.op === 'ack') {
            if (!msg.ok) return this.settle(msg.seq, new Error(msg.error || 'request failed'));
            pending.ack = msg;
            if (pending.replyOp === null) return this.settle(msg.seq);
            if (pending.replyOp === undefined) {
                pending.graceTimer = setTimeout(() => this.settle(msg.seq), RAW_REPLY_GRACE_MS);
            }
            return;
        }
        // A data message: only the expected reply (or, for raw requests, any) settles.
        if (pending.ack && (pending.replyOp === undefined || pending.replyOp === msg.op)) {
            pending.data = msg;
            this.settle(msg.seq);
        }
    }

    adoptState(msg) {
        // A state from another epoch replaces everything; within one, rev never goes back.
        if (this.state && msg.epoch === this.state.epoch && msg.rev < this.state.rev) return;
        this.state = msg;
    }

    onClose(code) {
        if (this.lastSocketError?.code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') code = 1009;
        this.lastSocketError = null;
        this.lastCloseCode = code;
        this.ws = null;
        this.hello = null;
        for (const seq of [...this.pending.keys()]) this.settle(seq, this.transportError(seq, new Error(closeReason(code))));
    }

    transportError(seq, error) {
        const pending = this.pending.get(seq);
        if (!pending?.possiblySent || !MUSIC_MUTATIONS.has(pending.op)) return error;
        return Object.assign(new Error(error.message, { cause: error }), { outcome: 'unknown' });
    }

    settle(seq, error) {
        const pending = this.pending.get(seq);
        if (!pending) return;
        this.pending.delete(seq);
        clearTimeout(pending.timer);
        clearTimeout(pending.graceTimer);
        if (error) pending.reject(error);
        else pending.resolve({ ack: pending.ack, data: pending.data });
    }

    // Sends one request and resolves with { ack, data } once it is answered.
    send(message, { timeoutMs = this.requestTimeoutMs } = {}) {
        const ws = this.ws;
        // The app may close right after the upgrade (4401 for a wrong token): report why.
        if (ws && ws.readyState === this.WebSocketImpl.CLOSING) {
            return new Promise((_, reject) => {
                const onClose = code => { clearTimeout(timer); reject(new Error(closeReason(code))); };
                const timer = setTimeout(() => { ws.removeListener('close', onClose); reject(new Error(`timeout waiting for ${message.op}`)); }, timeoutMs);
                ws.once('close', onClose);
            });
        }
        if (!ws || ws.readyState !== this.WebSocketImpl.OPEN) {
            return Promise.reject(new Error(this.lastCloseCode === null ? 'not connected' : closeReason(this.lastCloseCode)));
        }
        const seq = ++this.seq;
        const replyOp = Object.hasOwn(REPLY_OPS, message.op) ? REPLY_OPS[message.op] : (KNOWN_ACK_ONLY.has(message.op) ? null : undefined);
        const payload = JSON.stringify({ ...message, seq });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.settle(seq, this.transportError(seq, new Error(`timeout waiting for ${message.op}`))), timeoutMs);
            this.pending.set(seq, { resolve, reject, timer, op: message.op, possiblySent: true, replyOp, ack: null, data: null });
            try {
                ws.send(payload, error => {
                    if (error) this.settle(seq, this.transportError(seq, error));
                });
            } catch (error) {
                this.settle(seq, this.transportError(seq, error));
            }
        });
    }

    // connect() + send(), for the tools.
    async request(message, options) {
        await this.connect();
        return this.send(message, options);
    }

    close() {
        this.ws?.close();
    }
}

const KNOWN_ACK_ONLY = new Set([
    'chain', 'params', 'bypass', 'savePreset', 'putIR',
    'edit', 'history', 'slot', 'copySlot', 'loadPreset', 'deletePreset'
]);

function closeReason(code) {
    if (code === 4401) return 'EffeTune refused the token (4401); pair again with a fresh link';
    if (code === 1013) return 'EffeTune has too many remote clients (1013)';
    if (code === 1001) return 'EffeTune turned Remote Control off (1001)';
    if (code === 1009) return 'the endpoint sent a frame larger than 4 MB (1009); is EFFETUNE_URL an EffeTune link?';
    return `connection closed${code ? ` (${code})` : ''}; is EffeTune running with Remote Control on?`;
}
