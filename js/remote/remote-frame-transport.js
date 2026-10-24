// A MessagePort carries the native WebSocket connection into the bundled editor.
// The frame never receives a token or access to the desktop preload API.
export async function createFrameWebSocket(win) {
    const origin = win.location.protocol === 'file:' ? 'null' : win.location.origin;
    const initial = await new Promise(resolve => {
        const receive = event => {
            if (event.source !== win.parent || event.origin !== origin ||
                event.data?.type !== 'effetune-remote-port' || !event.ports[0]) return;
            win.removeEventListener('message', receive);
            resolve({ port: event.ports[0], metadata: event.data });
        };
        win.addEventListener('message', receive);
        win.parent.postMessage({ type: 'effetune-remote-ready' }, origin === 'null' ? '*' : origin);
    });
    const { port } = initial;
    let metadata = initial.metadata;
    let active = null;
    port.onmessage = ({ data }) => {
        if (data.type === 'metadata') {
            metadata = data;
            FrameWebSocket.onMetadata?.(metadata);
            return;
        }
        if (!active) return;
        if (data.type === 'open') {
            active.readyState = 1;
            active.onopen?.();
        } else if (data.type === 'message') active.onmessage?.({ data: data.data });
        else if (data.type === 'close') {
            const previous = active;
            active = null;
            previous.readyState = 3;
            previous.onclose?.({ code: data.code });
        }
    };
    class FrameWebSocket {
        static get metadata() { return metadata; }
        static changeConnection() { port.postMessage({ type: 'change-connection' }); }
        constructor() {
            active = this;
            this.readyState = 0;
            port.postMessage({ type: 'connect' });
        }
        send(data) {
            if (active !== this || this.readyState !== 1) throw new Error('not connected');
            port.postMessage({ type: 'send', data });
        }
        close() {
            if (active !== this) return;
            active = null;
            this.readyState = 3;
            port.postMessage({ type: 'close' });
        }
    }
    return FrameWebSocket;
}
