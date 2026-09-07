export const CHANNEL_NAME = 'effetune-extension';
export const CONTROL_COMMANDS = new Set(['getState', 'start', 'stop', 'setBypass', 'applyPreset', 'openEditor']);
export const MODEL_COMMANDS = new Set(['getState', 'setPipeline', 'savePreset', 'importPreset', 'deletePreset', 'workletMessage', 'setTelemetry', 'irLibrary']);

export function isInternalSender(sender, paths, runtime = chrome.runtime) {
    return sender?.id === runtime.id && paths.some(path => sender.url === runtime.getURL(path));
}

export async function runtimeRequest(command, args = {}) {
    const response = await chrome.runtime.sendMessage({ destination: 'worker', command, args });
    if (!response?.ok) throw new Error(response?.error || 'EffeTune could not complete this action. Try again.');
    return response.result;
}

export class ExtensionClient extends EventTarget {
    constructor() {
        super();
        this.id = crypto.randomUUID();
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.pending = new Map();
        this.sequence = 0;
        this.snapshot = null;
        this.channel.onmessage = ({ data }) => {
            if (data?.kind === 'state') this.acceptState(data.state);
            if (data?.kind === 'workletMessage') {
                this.dispatchEvent(new CustomEvent('workletMessage', { detail: data.message }));
            }
            if (data?.kind === 'irLibraryProgress' && data.clientId === this.id) {
                this.dispatchEvent(new CustomEvent('irLibraryProgress', { detail: data }));
            }
            if (data?.kind !== 'response' || data.clientId !== this.id) return;
            const pending = this.pending.get(data.requestId);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(data.requestId);
            if (data.ok) pending.resolve(data.result);
            else pending.reject(new Error(data.error));
        };
    }

    acceptState(state) {
        if (!state || (this.snapshot && state.revision < this.snapshot.revision)) return;
        this.snapshot = state;
        this.dispatchEvent(new CustomEvent('state', { detail: state }));
    }

    async connect() {
        const state = await runtimeRequest('getState');
        this.acceptState(state);
        return state;
    }

    async request(command, args = {}) {
        if (CONTROL_COMMANDS.has(command)) {
            const result = await runtimeRequest(command, args);
            if (result?.status) this.acceptState(result);
            return result;
        }
        if (!MODEL_COMMANDS.has(command)) throw new Error('This action is unavailable.');
        if (command === 'setTelemetry') {
            clearInterval(this.heartbeat);
            if (args.enabled) this.heartbeat = setInterval(() => {
                this.channel.postMessage({ kind: 'heartbeat', clientId: this.id });
            }, 5000);
        }
        const requestId = ++this.sequence;
        const result = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error('This action took too long. Reopen EffeTune and try again.'));
            }, command === 'irLibrary' ? 300000 : 30000);
            this.pending.set(requestId, { resolve, reject, timer });
            this.channel.postMessage({ kind: 'request', clientId: this.id, requestId, command, args });
        });
        if (result?.status) this.acceptState(result);
        return result;
    }

    close() {
        clearInterval(this.heartbeat);
        this.channel.postMessage({ kind: 'leave', clientId: this.id });
        this.channel.close();
        for (const request of this.pending.values()) {
            clearTimeout(request.timer);
            request.reject(new Error('The editor was closed.'));
        }
        this.pending.clear();
    }
}
