import { installAndroidFileDownloads } from './file-downloads.js';

const PART_LENGTH = 65536;
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
// Covers the Service's 65-second deadline if a result event is lost.
const PAIR_RESULT_TIMEOUT_MS = 70000;

export function createAndroidRemoteClient({ bridge, getOrigin = () => undefined }) {
    const requests = new Map();
    const listeners = new Set();
    const incoming = new Map();
    const outgoing = new Map();

    function finishRequest(requestId, result) {
        const request = requests.get(requestId);
        if (!request) return;
        requests.delete(requestId);
        clearTimeout(request.timer);
        request.resolve(result);
    }

    function clearConnection(connectionId) {
        incoming.delete(connectionId);
        outgoing.delete(connectionId);
    }

    function emit(event) {
        for (const listener of listeners) listener(event);
    }

    function receivePart({ connectionId, messageId, total, offset, data, done }) {
        if (offset === 0 && !incoming.has(connectionId) &&
            Number.isInteger(total) && total > 0 && total <= MAX_MESSAGE_BYTES) {
            incoming.set(connectionId, { messageId, total, offset: 0, parts: [] });
        }
        const message = incoming.get(connectionId);
        const received = offset + data?.length;
        if (!message || message.messageId !== messageId || message.total !== total || message.offset !== offset ||
            typeof data !== 'string' || !data.length || data.length > PART_LENGTH || received > total || done !== (received === total)) {
            incoming.delete(connectionId);
            return;
        }
        message.parts.push(data);
        message.offset = received;
        void bridge.request('remoteClient.send', { connectionId, messageId, received }).catch(error => {
            console.warn('[remote-client] could not acknowledge message part:', error);
        });
        if (!done) return;
        incoming.delete(connectionId);
        emit({ connectionId, type: 'message', data: message.parts.join('') });
    }

    const unsubscribe = bridge.on('remote-client-event', event => {
        if (event.type === 'pairResult') {
            finishRequest(event.requestId, { ok: event.ok, status: event.status });
        } else if (event.type === 'message' && event.messageId !== undefined) {
            receivePart(event);
        } else {
            if (event.type === 'close') clearConnection(event.connectionId);
            emit(event);
        }
    });

    async function cancelConnectionRequest(requestId) {
        finishRequest(requestId, { ok: false, status: 'cancelled' });
        return (await bridge.request('remoteClient.cancel', { requestId })).cancelled === true;
    }

    function requestConnection(playerId, requestId, replace = false) {
        const origin = getOrigin(playerId);
        return new Promise((resolve, reject) => {
            const request = { resolve, timer: null };
            requests.set(requestId, request);
            void bridge.request('remoteClient.requestConnection', { playerId, origin, requestId, replace }).then(result => {
                if (requests.get(requestId) !== request) return;
                if (!result.started) finishRequest(requestId, { ok: false, status: result.status || 'unavailable' });
                else request.timer = setTimeout(() => {
                    finishRequest(requestId, { ok: false, status: 'expired' });
                    void cancelConnectionRequest(requestId).catch(error => console.warn('[remote-client] cancellation failed:', error));
                }, PAIR_RESULT_TIMEOUT_MS);
            }).catch(error => {
                if (requests.get(requestId) !== request) return;
                requests.delete(requestId);
                clearTimeout(request.timer);
                reject(error);
            });
        });
    }

    async function sendMessage(connectionId, data, isCurrent) {
        const sendPart = async payload => isCurrent() &&
            (await bridge.request('remoteClient.send', { connectionId, ...payload })).sent === true;
        if (data.length <= PART_LENGTH) return sendPart({ data });
        if (data.length > MAX_MESSAGE_BYTES || new TextEncoder().encode(data).byteLength > MAX_MESSAGE_BYTES) return false;
        const messageId = crypto.randomUUID();
        for (let offset = 0; offset < data.length;) {
            let end = Math.min(offset + PART_LENGTH, data.length);
            // Keep surrogate pairs together when the Service joins the fragments.
            const last = data.charCodeAt(end - 1);
            if (end < data.length && last >= 0xD800 && last <= 0xDBFF) end--;
            const sent = await sendPart({ messageId, total: data.length, offset, data: data.slice(offset, end), done: end === data.length });
            if (!sent) return false;
            offset = end;
        }
        return true;
    }

    async function send(connectionId, data) {
        if (typeof data !== 'string') return false;
        let queue = outgoing.get(connectionId);
        if (!queue) {
            queue = { tail: Promise.resolve() };
            outgoing.set(connectionId, queue);
        }
        const task = queue.tail.catch(() => {}).then(() => sendMessage(connectionId, data, () => outgoing.get(connectionId) === queue));
        queue.tail = task;
        try {
            return await task;
        } finally {
            if (queue.tail === task && outgoing.get(connectionId) === queue) outgoing.delete(connectionId);
        }
    }

    return {
        reauthorizeOnClose: true,
        prepareEditorFrame(frame) {
            if (!frame.contentDocument) return;
            const parent = frame.ownerDocument.defaultView;
            // Clicks in the bundled editor do not reach the parent document.
            installAndroidFileDownloads({
                document: frame.contentDocument, location: parent.location,
                effetuneAndroid: parent.effetuneAndroid, uiManager: parent.uiManager
            });
        },
        getConnection: playerId => bridge.request('remoteClient.getConnection', { playerId, origin: getOrigin(playerId) }),
        requestConnection,
        cancelConnectionRequest,
        connect: playerId => bridge.request('remoteClient.connect', { playerId }),
        send,
        disconnect: async connectionId => {
            clearConnection(connectionId);
            return (await bridge.request('remoteClient.disconnect', { connectionId })).ok === true;
        },
        onEvent: listener => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        dispose: () => {
            unsubscribe();
            for (const requestId of requests.keys()) {
                void cancelConnectionRequest(requestId).catch(error => console.warn('[remote-client] cancellation failed:', error));
            }
            listeners.clear();
            incoming.clear();
            outgoing.clear();
        }
    };
}
