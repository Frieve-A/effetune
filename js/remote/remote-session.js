// WebSocket session of the browser client: connects to the remote-v1 server of
// the same origin, keeps the seq/ack bookkeeping and reconnects by itself.
//
// Events (CustomEvent, detail in brackets):
//   state [message]    every "state" message (hello and get replies, pushes)
//   presetsChanged     the host's stored presets changed
//   status [{ status, code?, attempt? }]
//     status: 'connecting' | 'open' | 'reconnecting' | 'unauthorized'
//   'unauthorized' (close code 4401, the pairing code changed) is final.

export const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
export const LIVENESS_TIMEOUT_MS = 4000;
export const CLOSE_UNAUTHORIZED = 4401;
export const TOKEN_STORAGE_KEY = 'effetune.remote.token';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{4,64}$/;

// Where this page connects. The QR code opens http://<host>:<port>/?t=<token>;
// the token is kept in localStorage and removed from the address bar, so a
// reload, a bookmark or a screenshot of the URL does not carry it.
// Returns { ok: true, token, url } or { ok: false, reason: 'protocol' | 'token' }.
export function resolveRemoteTarget({ location, storage, history }) {
    // ws:// from an https page is blocked by the browser, so only plain http works.
    if (location.protocol !== 'http:') return { ok: false, reason: 'protocol' };
    const params = new URLSearchParams(location.search);
    const supplied = params.get('t');
    let token = supplied !== null && TOKEN_PATTERN.test(supplied) ? supplied : null;
    if (token) {
        try { storage?.setItem(TOKEN_STORAGE_KEY, token); } catch (_) { /* kept in memory only */ }
    }
    if (supplied !== null) {
        params.delete('t');
        const rest = params.toString();
        try {
            history?.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash || ''}`);
        } catch (_) { /* ignore */ }
    }
    if (!token) {
        try { token = storage?.getItem(TOKEN_STORAGE_KEY) || null; } catch (_) { token = null; }
        if (token && !TOKEN_PATTERN.test(token)) token = null;
    }
    if (!token) return { ok: false, reason: 'token' };
    return { ok: true, token, url: `ws://${location.host}/?t=${encodeURIComponent(token)}` };
}

export class RemoteSession extends EventTarget {
    constructor({
        url,
        hello,
        WebSocketImpl = globalThis.WebSocket,
        setTimer = (fn, ms) => setTimeout(fn, ms),
        clearTimer = handle => clearTimeout(handle),
        documentRef = globalThis.document,
        windowRef = globalThis.window
    }) {
        super();
        this.url = url;
        this.hello = hello;
        this.WebSocketImpl = WebSocketImpl;
        this.setTimer = setTimer;
        this.clearTimer = clearTimer;
        this.documentRef = documentRef;
        this.windowRef = windowRef;
        this.ws = null;
        this.seq = 0;
        this.waiters = new Map();      // seq -> { resolve, reject, data }
        this.attempt = 0;
        this.retryTimer = null;
        this.livenessTimer = null;
        this.stopped = true;
        this.terminal = false;
        this.status = 'connecting';
        this.onVisibility = () => {
            if (this.documentRef?.visibilityState !== 'visible') return;
            this.retryNow();
            this.checkLiveness();
        };
        this.onOnline = () => this.retryNow();
    }

    start() {
        if (!this.stopped) return;
        this.stopped = false;
        this.documentRef?.addEventListener?.('visibilitychange', this.onVisibility);
        this.windowRef?.addEventListener?.('online', this.onOnline);
        this.connect();
    }

    stop() {
        this.stopped = true;
        this.documentRef?.removeEventListener?.('visibilitychange', this.onVisibility);
        this.windowRef?.removeEventListener?.('online', this.onOnline);
        this.clearTimer(this.retryTimer);
        this.clearTimer(this.livenessTimer);
        this.retryTimer = null;
        this.livenessTimer = null;
        const ws = this.ws;
        this.ws = null;
        try { ws?.close(); } catch (_) { /* ignore */ }
        this.rejectWaiters(new Error('stopped'));
    }

    setStatus(status, extra = {}) {
        this.status = status;
        this.dispatchEvent(new CustomEvent('status', { detail: { status, ...extra } }));
    }

    connect() {
        if (this.stopped || this.terminal) return;
        this.clearTimer(this.retryTimer);
        this.retryTimer = null;
        this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting', { attempt: this.attempt });
        let ws;
        try {
            ws = new this.WebSocketImpl(this.url);
        } catch (error) {
            this.scheduleRetry();
            return;
        }
        this.ws = ws;
        ws.onopen = () => {
            if (this.ws !== ws) return;
            this.attempt = 0;
            // The state reply to hello is delivered like any push.
            this.send({ op: 'hello', v: 1, ...this.hello }).then(() => {
                if (this.ws === ws) this.setStatus('open');
            }, () => {});
        };
        ws.onmessage = event => {
            if (this.ws !== ws) return;
            this.onMessage(event.data);
        };
        ws.onclose = event => {
            if (this.ws !== ws) return;
            this.ws = null;
            this.clearTimer(this.livenessTimer);
            this.livenessTimer = null;
            this.rejectWaiters(new Error('closed'));
            if (event?.code === CLOSE_UNAUTHORIZED) {
                this.terminal = true;
                this.setStatus('unauthorized', { code: event.code });
                return;
            }
            this.scheduleRetry();
        };
        ws.onerror = () => { /* followed by close */ };
    }

    scheduleRetry() {
        if (this.stopped || this.terminal) return;
        const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)];
        this.attempt += 1;
        this.setStatus('reconnecting', { attempt: this.attempt, delay });
        this.clearTimer(this.retryTimer);
        this.retryTimer = this.setTimer(() => {
            this.retryTimer = null;
            this.connect();
        }, delay);
    }

    // The tab came back or the network did: do not wait for the backoff.
    retryNow() {
        if (this.stopped || this.terminal) return;
        const ws = this.ws;
        if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
        this.connect();
    }

    // A phone that slept may hold a socket that is dead but not yet closed.
    checkLiveness() {
        const ws = this.ws;
        if (!ws || ws.readyState !== 1 || this.livenessTimer !== null) return;
        this.livenessTimer = this.setTimer(() => {
            this.livenessTimer = null;
            if (this.ws !== ws) return;
            try { ws.close(); } catch (_) { /* ignore */ }
            // Some browsers fire close late for a dead socket: do not wait for it.
            this.ws = null;
            this.rejectWaiters(new Error('closed'));
            this.attempt = 0;
            this.connect();
        }, LIVENESS_TIMEOUT_MS);
        this.send({ op: 'get' }).catch(() => {});
    }

    onMessage(raw) {
        let message;
        try { message = JSON.parse(raw); } catch (_) { return; }
        if (!message || typeof message !== 'object') return;
        if (this.livenessTimer !== null) {
            this.clearTimer(this.livenessTimer);
            this.livenessTimer = null;
        }
        if (message.op === 'ack') {
            const waiter = this.waiters.get(message.seq);
            if (waiter && !waiter.data) {
                this.waiters.delete(message.seq);
                waiter.resolve(message);
            } else if (waiter) {
                waiter.ack = message;
                if (message.ok !== true) {
                    this.waiters.delete(message.seq);
                    waiter.reject(new Error(message.error || 'request failed'));
                }
            }
            return;
        }
        if (message.seq !== undefined) {
            const waiter = this.waiters.get(message.seq);
            if (waiter?.data && message.op === waiter.data) {
                this.waiters.delete(message.seq);
                waiter.resolve(message);
            }
        }
        if (message.op === 'state') {
            this.dispatchEvent(new CustomEvent('state', { detail: message }));
        } else if (message.op === 'presetsChanged') {
            this.dispatchEvent(new CustomEvent('presetsChanged'));
        }
    }

    // Sends a request and resolves with its ack (rejects when the socket closes).
    send(message) {
        return this.sendInternal(message, null);
    }

    // Sends a request that answers with a data message of op `dataOp` (after the ack).
    request(message, dataOp) {
        return this.sendInternal(message, dataOp);
    }

    sendInternal(message, dataOp) {
        const ws = this.ws;
        if (!ws || ws.readyState !== 1) return Promise.reject(new Error('not connected'));
        const seq = this.seq += 1;
        return new Promise((resolve, reject) => {
            this.waiters.set(seq, { resolve, reject, data: dataOp });
            try {
                ws.send(JSON.stringify({ ...message, seq }));
            } catch (error) {
                this.waiters.delete(seq);
                reject(error);
            }
        });
    }

    rejectWaiters(error) {
        const waiters = [...this.waiters.values()];
        this.waiters.clear();
        for (const waiter of waiters) waiter.reject(error);
    }
}
