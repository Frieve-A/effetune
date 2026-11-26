import { bytesToBase64, getAndroidBridge } from './bridge.js';
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
    const listeners = new Set();
    const inputs = new Map();
    const access = {
        inputs, outputs: new Map(),
        addEventListener: (type, listener) => { if (type === 'statechange') listeners.add(listener); },
        removeEventListener: (type, listener) => { if (type === 'statechange') listeners.delete(listener); }
    };
    const addPort = async record => {
        if (!record || typeof record.id !== 'string') return;
        if (record.type === 'output') {
            if (access.outputs.get(record.id)?.state === 'connected') return;
            const port = { ...record, state: 'connected', connection: 'closed',
                send(data, timestamp = 0) {
                    if (port.state !== 'connected') return;
                    port.connection = 'open';
                    void bridge.request('midi.send', { id: port.id, data: bytesToBase64(Uint8Array.from(data)),
                        delayMs: Math.max(0, timestamp - performance.now()) }).catch(error => console.warn('MIDI output failed:', error));
                },
                close() { port.connection = 'closed'; return bridge.request('midi.close', { id: port.id }); }
            };
            access.outputs.set(port.id, port);
            for (const listener of listeners) listener({ port });
            return;
        }
        if (inputs.get(record.id)?.state === 'connected') return;
        const port = { ...record, type: 'input', state: 'connected', connection: 'open', onmidimessage: null,
            close: () => bridge.request('midi.close', { id: record.id }) };
        inputs.set(record.id, port);
        try { await bridge.request('midi.open', { id: record.id }); }
        catch (error) {
            if (inputs.get(record.id) === port) inputs.delete(record.id);
            console.error('Android MIDI input could not be opened:', error); return;
        }
        if (port.state !== 'connected') return;
        for (const listener of listeners) listener({ port });
    };
    const offConnect = bridge.on('midi-connected', record => { void addPort(record); });
    const offMessage = bridge.on('midi', message => {
        const port = inputs.get(message.id);
        if (!port || !Array.isArray(message.data) || message.data.length > 65536) return;
        const age = Number.isFinite(message.receivedAt) && Number.isFinite(message.timestamp) && message.timestamp > 0
            ? Math.max(0, message.receivedAt - message.timestamp) : 0;
        const timeStamp = performance.now() - age;
        port.onmidimessage?.({ data: Uint8Array.from(message.data), receivedTime: timeStamp, timeStamp,
            nativeConsumed: message.consumed === true });
    });
    const offDisconnect = bridge.on('midi-disconnected', message => {
        const port = inputs.get(message.id) || access.outputs.get(message.id);
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
        for (const port of access.outputs.values()) if (port.connection === 'open') void port.close().catch(console.warn);
        listeners.clear();
    };
    try {
        const listing = await bridge.request('midi.list');
        for (const record of [...listing.inputs, ...(listing.outputs ?? [])]) await addPort(record);
        return access;
    } catch (error) { access.close(); throw error; }
}
