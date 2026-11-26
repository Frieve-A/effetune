import { getAndroidBridge, isAndroidHost } from './bridge.js';
import { AndroidLivePcm } from './live-pcm.js';

export function createAndroidOpenHome(bridge, windowRef = globalThis.window) {
    const request = async (command, payload = {}) => {
        const result = await bridge.request('openhome.' + command, payload);
        return result && Object.hasOwn(result, 'value') ? result.value : result;
    };
    const setEnabled = async (command, enabled) => {
        if (enabled) await bridge.request('network.ensurePermission', { request: true });
        return request(command, { enabled });
    };
    const on = (event, callback) => {
        if (typeof callback !== 'function') throw new TypeError('IPC listener callback must be a function');
        return bridge.on(event, data => { callback(data); });
    };

    const api = Object.freeze({
        apiVersion: 1,
        createLivePcm: player => new AndroidLivePcm(player, bridge, api),
        getStatus: () => request('getStatus'),
        setEnabled: enabled => {
            if (typeof enabled !== 'boolean') throw new TypeError('OpenHome enabled state must be boolean');
            return setEnabled('setEnabled', enabled);
        },
        setUpnpAvEnabled: enabled => {
            if (typeof enabled !== 'boolean') throw new TypeError('UPnP AV enabled state must be boolean');
            return setEnabled('setUpnpAvEnabled', enabled);
        },
        setFriendlyName: friendlyName => {
            if (typeof friendlyName !== 'string') throw new TypeError('Network device name must be a string');
            return request('setFriendlyName', { friendlyName });
        },
        rendererReady: () => request('rendererReady'),
        rendererUnavailable: () => request('rendererUnavailable'),
        respond: response => request('respond', response),
        resetComplete: ack => request('resetAck', ack),
        publishState: snapshot => request('publishState', snapshot),
        probeLivePlayback: ({ sessionId, connectionId }) => request('liveFeedback', { sessionId, connectionId }),
        reportLivePlayback: report => request('liveFeedback', report).then(result => result === true),
        onAction: callback => on('openhome-action', callback),
        onCancel: callback => on('openhome-cancel', callback),
        onReset: callback => on('openhome-reset', callback),
        onStatus: callback => on('openhome-status', callback)
    });

    windowRef.addEventListener('pagehide', () => {
        void api.rendererUnavailable().catch(error => console.warn('Android network playback controls could not close:', error));
    }, { once: true });
    return api;
}

if (isAndroidHost()) window.effetuneAndroidOpenHome = createAndroidOpenHome(getAndroidBridge());
