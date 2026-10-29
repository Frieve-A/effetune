import { getPlaybackRegion, getRegionStartTime, getRegionEndTime } from '../ui/audio-player/playback-region.js';

// The remote protocol uses the same catalog and PWA gateway/Subsonic providers as the UI.
export function createAndroidMusicService(bridge, windowRef = globalThis.window, authorize = async () => true) {
    const ui = windowRef.uiManager;
    const network = () => ui.networkMusic?.api;
    const library = async () => {
        const manager = windowRef.libraryManager || await ui.ensureLibraryManager();
        await manager.init();
        return manager;
    };
    const unavailable = () => Object.assign(new Error('The music source is unavailable.'), { code: 'unavailable' });
    const state = async () => network()?.networkMusicGetState() || { libraries: [], players: [] };
    const publicPlayback = () => bridge.request('playback.getPublic');
    async function resolve(item) {
        let source, track;
        if (item.serverId === 'local') {
            const catalog = await library();
            track = await catalog.getTrack(item.trackId);
            source = await catalog.client.resolveSequenceEntrySource({ trackUid: item.trackId });
        } else {
            if (!network()) throw unavailable();
            track = await network().networkMusicResolveTrack({ ...item, localPlayback: true });
            source = track;
        }
        const uri = source.uri || source.mediaSource;
        if (!uri || !['content:', 'https:', 'http:'].includes(new URL(uri).protocol)) throw unavailable();
        const region = getPlaybackRegion({ ...track, ...source });
        return { uri, title: track?.title || '', artist: track?.artist || '', album: track?.album || '',
            duration: track?.durationSec || track?.duration || 0,
            ...(item.serverId === 'local' ? { libraryTrackId: item.trackId } : {}),
            ...(source.headers ? { headers: source.headers } : {}),
            ...(!region ? {} : { region: { start: getRegionStartTime(region), end: getRegionEndTime(region), durationSec: region.durationSec } }) };
    }
    return {
        getState: state,
        discover: async () => network()?.networkMusicDiscover() || state(),
        localLibraryAvailable: async () => { try { await library(); return true; } catch { return false; } },
        async browse(request) {
            if (request.serverId !== 'local') {
                if (!network()) throw unavailable();
                return network().networkMusicBrowse(request);
            }
            if (request.objectId !== '0') throw Object.assign(unavailable(), { code: 'invalidRequest' });
            if (request.sortCriteria && !['+dc:title', '-dc:title', 'dc:title'].includes(request.sortCriteria)) {
                throw Object.assign(unavailable(), { code: 'unsupported' });
            }
            const catalog = await library();
            const contextToken = await catalog.createContext({ endpoint: 'tracks', query: request.query,
                sort: 'title', direction: request.sortCriteria.startsWith('-') ? 'desc' : 'asc' });
            try {
                const items = [];
                let total = 0, ordinal = request.start;
                while (items.length < request.count) {
                    const page = await catalog.readContextPageAtOrdinal({ contextToken, ordinal, limit: request.count });
                    total = page.totalCount;
                    const offset = ordinal - page.pageStartOrdinal;
                    const rows = page.rows.slice(offset, offset + request.count - items.length);
                    for (const row of rows) items.push({ ...row, id: row.trackUid, trackId: row.trackUid,
                        serverId: 'local', parentId: '0', playable: true, isContainer: false, duration: row.durationSec || 0 });
                    ordinal += rows.length;
                    if (!rows.length || ordinal >= total) break;
                }
                return { serverId: 'local', items, start: request.start, total };
            } finally { await catalog.releaseContext(contextToken); }
        },
        async getPlayerState(request) {
            if (request.playerId !== 'local') {
                if (!network()) throw unavailable();
                return network().networkMusicGetPlayerState(request);
            }
            // Native local control is dispatched before reaching this renderer adapter.
            return publicPlayback();
        },
        async playerCommand(request) {
            if (!request.isCurrent() || !await authorize()) throw Object.assign(unavailable(), { code: 'unauthorized' });
            if (request.playerId !== 'local') {
                if (!network()) throw unavailable();
                return network().networkMusicPlayerCommand(request);
            }
            if (!['replace', 'insert'].includes(request.action)) throw Object.assign(unavailable(), { code: 'unsupported' });
            const transactionId = crypto.randomUUID();
            let insertion;
            if (request.action === 'replace') await bridge.request('playback.queue.begin', { transactionId,
                index: request.startIndex || 0, repeat: 'off', shuffle: false });
            else {
                const snapshot = await bridge.request('snapshot.get');
                insertion = request.position === 'afterCurrent' ? snapshot.playback.index + 1 : snapshot.playback.queueLength;
            }
            for (let offset = 0; offset < request.items.length; offset += 64) {
                const items = [];
                for (const item of request.items.slice(offset, offset + 64)) items.push(await resolve(item));
                if (!request.isCurrent() || !await authorize()) throw Object.assign(unavailable(), { code: 'unauthorized' });
                if (request.action === 'replace') await bridge.request('playback.queue.append', { transactionId, items });
                else { await bridge.request('playback.insert', { index: insertion, items }); insertion += items.length; }
            }
            if (!request.isCurrent() || !await authorize()) throw Object.assign(unavailable(), { code: 'unauthorized' });
            if (request.action === 'replace') await bridge.request('playback.queue.commit', { transactionId });
            if (request.play) await bridge.request('playback.play');
            return publicPlayback();
        },
        onDiagnostic: error => console.debug('Android remote music request failed:', error)
    };
}
