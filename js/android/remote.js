import { getAndroidBridge } from './bridge.js';
import { createAndroidMusicService } from './remote-music-service.js';

export function createAndroidRemoteApi(bridge = getAndroidBridge()) {
    return {
        onRequest: listener => bridge.on('remote-request', async request => {
            const { MUSIC_OPS, dispatchMusic } = await import('./remote-music-protocol.js');
            let current = true;
            const cancel = bridge.on('remote-cancelled', event => { if (event.requestId === request.requestId) current = false; });
            const bound = { request: (command, payload = {}) => bridge.request(command, { ...payload, _remoteRequestId: request.requestId }) };
            const authorize = async () => {
                await bound.request('remote.authorize', { requestId: request.requestId });
                if (!current) throw Object.assign(new Error('Remote request ended'), { code: 'unauthorized' });
                return true;
            };
            try {
                await authorize();
                if (!MUSIC_OPS.has(request.message?.op)) {
                    return await listener({ ...request, mutationOptions: { beforeCommit: authorize,
                        remoteRequestId: request.requestId, isCurrent: () => current } });
                }
                const result = await dispatchMusic(createAndroidMusicService(bound, globalThis.window, authorize),
                    { controlId: 'local', name: 'EffeTune', available: true }, request.message, () => current);
                if (result.ok && (!request.message.playerId || request.message.playerId === 'local') && ['playMusic', 'queueMusic'].includes(request.message.op)) result.result = await bound.request('playback.getPublic');
                await bound.request('remote.respond', { requestId: request.requestId,
                    ok: result.ok, ...(result.ok ? { data: result.result } : { error: result.error.code }) });
            } catch (error) {
                if (error?.code !== 'unauthorized') console.debug('Android remote request ended:', error);
            } finally { current = false; cancel(); }
        }),
        onStatus: listener => bridge.on('remote-status', status => listener({ ...status, clients: status.clientCount })),
        rendererReady: () => bridge.request('remote.rendererReady'),
        rendererUnavailable: () => bridge.request('remote.rendererUnavailable'),
        publishState: snapshot => bridge.request('remote.publishState', snapshot),
        respond: response => bridge.request('remote.respond', response),
        getStatus: () => bridge.request('remote.getStatus'),
        openPanel: () => bridge.request('remote.openPanel')
    };
}
