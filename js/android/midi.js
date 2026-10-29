import { getAndroidBridge } from './bridge.js';
import { PLAYBACK_SPEED_STEPS } from '../ui/audio-player/playback-speed.js';
import { APP_TARGETS } from '../midi/app-targets.js';

export function subscribeAndroidMidiActions(windowRef, bridge = getAndroidBridge()) {
    return bridge.on('midi-action', event => {
        if (event?.key === 'preset') APP_TARGETS.preset.run(windowRef, event.direction < 0 ? -1 : 1);
    });
}

export function prepareAndroidMidiConfiguration(store, adapter, learning = false) {
    const config = store.snapshot();
    return { ...config, learning, mappings: config.mappings.map(mapping => {
        const descriptor = adapter.resolve(mapping.target.type, mapping.target.param, mapping.target.element)?.descriptor;
        return { ...mapping, ...(descriptor ? { descriptor: { ...descriptor,
            ...(mapping.target.type === '_global' && mapping.target.param === 'playbackSpeed' ? { valuesForButtons: PLAYBACK_SPEED_STEPS } : {})
        } } : {}) };
    }) };
}

export async function requestAndroidMidiAccess(bridge = getAndroidBridge()) {
    const listing = await bridge.request('midi.list');
    const listeners = new Set();
    const inputs = new Map();
    const access = {
        inputs, outputs: new Map(),
        addEventListener: (type, listener) => { if (type === 'statechange') listeners.add(listener); },
        removeEventListener: (type, listener) => { if (type === 'statechange') listeners.delete(listener); }
    };
    const addInput = async record => {
        if (!record || typeof record.id !== 'string') return;
        const port = { ...record, type: 'input', state: 'connected', connection: 'open', onmidimessage: null,
            close: () => bridge.request('midi.close', { id: record.id }) };
        await bridge.request('midi.open', { id: record.id });
        inputs.set(record.id, port);
        for (const listener of listeners) listener({ port });
    };
    for (const record of listing.inputs) await addInput(record);
    const offConnect = bridge.on('midi-connected', record => {
        void addInput(record).catch(error => console.error('Android MIDI connection failed:', error));
    });
    const offMessage = bridge.on('midi', message => {
        const port = inputs.get(message.id);
        if (!port || !Array.isArray(message.data) || message.data.length > 4096) return;
        const age = Number.isFinite(message.receivedAt) && Number.isFinite(message.timestamp) && message.timestamp > 0
            ? Math.max(0, message.receivedAt - message.timestamp) : 0;
        port.onmidimessage?.({ data: Uint8Array.from(message.data), receivedTime: performance.now() - age,
            nativeConsumed: message.consumed === true });
    });
    const offDisconnect = bridge.on('midi-disconnected', message => {
        const port = inputs.get(message.id);
        if (!port) return;
        port.state = 'disconnected';
        port.connection = 'closed';
        port.onmidimessage = null;
        for (const listener of listeners) listener({ port });
    });
    access.close = () => {
        offMessage(); offDisconnect(); offConnect();
        // Configured ports belong to the Service and continue while the renderer is absent.
        for (const port of inputs.values()) port.onmidimessage = null;
        listeners.clear();
    };
    return access;
}
