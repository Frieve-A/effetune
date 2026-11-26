import { base64ToBytes, bytesToBase64, getAndroidBridge } from './bridge.js';
import { createAndroidMusicService } from './remote-music-service.js';
import { RemoteControlDialog } from '../remote/remote-control-dialog.js';

// IR files cross the 1 MiB bridge in the desktop's 512 KiB irChunk parts.
const IR_CHUNK_BYTES = 512 * 1024;

// A putIR upload that the Service assembled into a cache file.
async function readUpload(bound, requestId, size) {
    const data = new Uint8Array(size);
    for (let offset = 0; offset < size;) {
        const part = base64ToBytes((await bound.request('remote.irRead', { requestId, offset })).data);
        data.set(part, offset);
        offset += part.byteLength;
    }
    return data;
}

// A getIR result leaves as irChunk messages; the Service replies to each once the client can take more.
async function respond(bridge, response) {
    const { data, ...rest } = response;
    if (!(data instanceof Uint8Array)) return bridge.request('remote.respond', response);
    const total = Math.max(1, Math.ceil(data.byteLength / IR_CHUNK_BYTES));
    for (let index = 0; index < total; index++) {
        await bridge.request('remote.irChunk', { requestId: rest.requestId, name: rest.name, ext: rest.ext, index, total,
            bytes: data.byteLength, data: bytesToBase64(data.subarray(index * IR_CHUNK_BYTES, (index + 1) * IR_CHUNK_BYTES)) });
    }
    return bridge.request('remote.respond', rest);
}

const settingsByBridge = new WeakMap();
const pairingBridges = new WeakSet();

export function getAndroidRemoteSettings(bridge = getAndroidBridge()) {
    if (!settingsByBridge.has(bridge)) settingsByBridge.set(bridge, {
        getStatus: () => bridge.request('remote.getStatus'),
        onStatus: listener => bridge.on('remote-status', listener),
        setEnabled: enabled => bridge.request('remote.configure', { enabled }),
        regenerateToken: () => bridge.request('remote.rotateToken'),
        copyLink: async index => (await bridge.request('remote.copyLink', { index })).copied === true,
        join: link => bridge.request('remote.join', { link }),
        async selectConnectionFile(kind) {
            try {
                return await bridge.request('remote.selectConnectionFile', { kind });
            } catch (error) {
                if (error.name === 'AbortError') return null;
                throw error;
            }
        },
        setConnection: request => bridge.request('remote.setConnection', request),
        testConnection: () => bridge.request('remote.testConnection'),
        async createLinkQr(link) {
            // The Android asset build supplies the existing QR encoder.
            const { default: createQr } = await import('./qrcode.mjs');
            const qr = createQr(0, 'M');
            qr.addData(link);
            qr.make();
            return `data:image/svg+xml;base64,${btoa(qr.createSvgTag({ cellSize: 6, margin: 3, scalable: true }))}`;
        },
        requiresUnprivilegedPort: true
    });
    return settingsByBridge.get(bridge);
}

function registerPairingDialogs(bridge, win) {
    const doc = win.document;
    let current;
    const t = key => win.uiManager.t(`dialog.remoteControl.${key}`);
    const handleKey = event => {
        if (event.key === 'Escape' || event.key === 'Tab') event.stopPropagation();
    };
    function close(requestId) {
        if (current?.requestId !== requestId) return;
        const { dialog } = current;
        current = null;
        win.removeEventListener('keydown', handleKey, true);
        dialog.close();
        dialog.remove();
    }

    bridge.on('pairing-request', ({ requestId, clientName, address }) => {
        if (current) close(current.requestId);
        const dialog = doc.createElement('dialog');
        dialog.className = 'pwa-device-dialog';
        const append = (parent, tag, text) => {
            const element = doc.createElement(tag);
            element.textContent = text;
            parent.append(element);
            return element;
        };
        const title = append(dialog, 'h2', t('pairingRequestTitle'));
        title.id = 'remote-pairing-title';
        dialog.setAttribute('aria-labelledby', title.id);
        const message = append(dialog, 'p', t('pairingRequestMessage'));
        message.id = 'remote-pairing-message';
        if (clientName) append(dialog, 'div', clientName);
        append(dialog, 'div', address);
        const detail = append(dialog, 'p', t('pairingRequestDetail'));
        detail.id = 'remote-pairing-detail';
        dialog.setAttribute('aria-describedby', `${message.id} ${detail.id}`);
        const error = append(dialog, 'p', '');
        error.className = 'remote-control-error';
        error.setAttribute('role', 'alert');
        const actions = append(dialog, 'div', '');
        actions.className = 'dialog-buttons';
        const deny = append(actions, 'button', t('pairingRequestDeny'));
        const allow = append(actions, 'button', t('pairingRequestAllow'));
        deny.autofocus = true;
        const decide = async allowed => {
            if (current?.requestId !== requestId || deny.disabled) return;
            deny.disabled = allow.disabled = true;
            error.textContent = '';
            try {
                const result = await bridge.request('remote.pairDecision', { requestId, allow: allowed });
                if (!result.accepted) close(requestId);
            } catch (failure) {
                console.warn('[remote] could not answer effects connection request:', failure);
                if (!allowed) {
                    close(requestId);
                    return;
                }
                if (current?.requestId === requestId) {
                    deny.disabled = allow.disabled = false;
                    error.textContent = t('updateFailed');
                    deny.focus();
                }
            }
        };
        deny.addEventListener('click', () => decide(false));
        allow.addEventListener('click', () => decide(true));
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            void decide(false);
        });
        current = { requestId, dialog };
        doc.body.append(dialog);
        dialog.showModal();
        deny.focus();
        win.addEventListener('keydown', handleKey, true);
    });
    bridge.on('pairing-ended', ({ requestId }) => close(requestId));
}

export function createAndroidRemoteApi(bridge = getAndroidBridge()) {
    const win = globalThis.window;
    const settings = getAndroidRemoteSettings(bridge);
    let dialog;
    if (win?.document && !pairingBridges.has(bridge)) {
        registerPairingDialogs(bridge, win);
        pairingBridges.add(bridge);
    }
    return {
        onRequest: listener => bridge.on('remote-request', async request => {
            const { MUSIC_OPS, dispatchMusic } = await import('./remote-music-protocol.js');
            let current = true;
            const cancel = bridge.on('remote-cancelled', event => { if (event.requestId === request.requestId) current = false; });
            let publicPlayback;
            const bound = { async request(command, payload = {}) {
                const value = await bridge.request(command, { ...payload, _remoteRequestId: request.requestId });
                if (command === 'playback.getPublic') publicPlayback = value;
                return value;
            } };
            const authorize = async () => {
                await bound.request('remote.authorize', { requestId: request.requestId });
                if (!current) throw Object.assign(new Error('Remote request ended'), { code: 'unauthorized' });
                return true;
            };
            try {
                await authorize();
                if (!MUSIC_OPS.has(request.message?.op)) {
                    let message = request.message;
                    if (message?.op === 'putIR') {
                        try {
                            message = { ...message, data: await readUpload(bound, request.requestId, message.bytes) };
                        } catch (error) {
                            if (error?.code === 'unauthorized') throw error;
                            console.debug('Android remote upload could not be read:', error);
                            await bound.request('remote.respond', { requestId: request.requestId, ok: false, error: 'ir unreadable' });
                            return;
                        }
                    }
                    return await listener({ ...request, message, mutationOptions: { beforeCommit: authorize,
                        remoteRequestId: request.requestId, isCurrent: () => current } });
                }
                const result = await dispatchMusic(createAndroidMusicService(bound, globalThis.window, authorize),
                    { controlId: 'local', name: 'EffeTune', available: true }, request.message, () => current);
                // The native page includes the total and current track for the entire local queue.
                if ((!request.message.playerId || request.message.playerId === 'local') && ['playMusic', 'queueMusic'].includes(request.message.op)) {
                    if (result.ok) result.result = await bound.request('playback.getPublic');
                    else if (result.playback) result.playback = publicPlayback;
                }
                const { ok, result: data, ...failure } = result;
                await bound.request('remote.respond', { requestId: request.requestId, ok, ...(ok ? { data } : failure) });
            } catch (error) {
                if (error?.code !== 'unauthorized') console.debug('Android remote request ended:', error);
            } finally { current = false; cancel(); }
        }),
        onStatus: settings.onStatus,
        rendererReady: () => bridge.request('remote.rendererReady'),
        rendererUnavailable: () => bridge.request('remote.rendererUnavailable'),
        publishState: snapshot => bridge.request('remote.publishState', snapshot),
        respond: response => respond(bridge, response),
        notifyPresets: () => bridge.request('remote.presetsChanged'),
        notifyIrs: () => bridge.request('remote.irsChanged'),
        getStatus: settings.getStatus,
        settings,
        openPanel: async () => {
            dialog ??= new RemoteControlDialog(win, settings);
            dialog.show();
        }
    };
}
