import { ANDROID_MESSAGE_LIMIT } from './bridge.js';
import { scoreName } from './score.js';
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
    const visible = ({ libraries = [], players = [], gatewayPermissions } = {}) => ({
        libraries: gatewayPermissions?.libraries === true ? libraries : [],
        players: gatewayPermissions?.players === true ? players : []
    });
    const state = async () => visible(await network()?.networkMusicGetState?.());
    async function requireGateway(kind, ids) {
        if (!ids.length) return;
        const available = new Set((await state())[kind].filter(device => device.available === true).map(device => device.id));
        if (ids.some(id => !available.has(id))) throw unavailable();
    }
    const publicPlayback = () => bridge.request('playback.getPublic');
    async function resolve(item) {
        const local = item.serverId === 'local';
        let source, track;
        if (local) {
            const catalog = await library();
            track = await catalog.getTrack(item.trackId);
            source = await catalog.client.resolveSequenceEntrySource({ trackUid: item.trackId });
        } else {
            if (!network()) throw unavailable();
            track = await network().networkMusicResolveTrack({ ...item, localPlayback: true });
            source = track;
        }
        const metadata = { title: track?.title || '', artist: track?.artist || '', album: track?.album || '',
            duration: track?.durationSec || track?.duration || 0 };
        if (local) {
            const playable = { ...track, ...source, name: source.file?.name || track?.fileName, meta: track, libraryTrackId: item.trackId };
            if (source.file || scoreName(playable)) {
                const player = ui.audioPlayer ?? await ui.createAudioPlayer([], false);
                const entry = await player.contextManager.resolveQueueItem([playable], null, 0);
                return { ...entry, ...metadata, title: metadata.title || entry.title };
            }
        }
        const uri = source.uri || source.mediaSource;
        if (!uri || !['content:', 'https:', 'http:'].includes(new URL(uri).protocol)) throw unavailable();
        const region = getPlaybackRegion({ ...track, ...source });
        const entry = { uri, ...metadata,
            ...(local ? { libraryTrackId: item.trackId } : {}),
            ...(source.headers ? { headers: source.headers } : {}),
            ...(!region ? {} : { region: { start: getRegionStartTime(region), end: getRegionEndTime(region), durationSec: region.durationSec } }) };
        entry.replayGainFactor = await ui.audioPlayer?.contextManager?.nativeReplayGain?.(track, entry) ?? 1;
        return entry;
    }
    return {
        resolveEntry: resolve,
        getState: state,
        discover: async () => visible(await network()?.networkMusicDiscover()),
        localLibraryAvailable: async () => { try { await library(); return true; } catch { return false; } },
        async browse(request) {
            if (request.serverId !== 'local') {
                await requireGateway('libraries', [request.serverId]);
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
                const total = await catalog.getContextCount({ contextToken }) ?? 0;
                const items = [];
                let ordinal = request.start;
                while (ordinal < total && items.length < request.count) {
                    const page = await catalog.readContextPageAtOrdinal({ contextToken, ordinal, limit: request.count });
                    const offset = ordinal - page.pageStartOrdinal;
                    const rows = page.rows.slice(offset, offset + request.count - items.length);
                    for (const row of rows) items.push({ ...row, id: row.trackUid, trackId: row.trackUid,
                        serverId: 'local', parentId: '0', playable: true, isContainer: false, duration: row.durationSec || 0 });
                    ordinal += rows.length;
                    if (!rows.length) break;
                }
                return { serverId: 'local', items, start: request.start, total };
            } finally { await catalog.releaseContext(contextToken); }
        },
        async getPlayerState(request) {
            if (request.playerId !== 'local') {
                await requireGateway('players', [request.playerId]);
                return network().networkMusicGetPlayerState(request);
            }
            // Native local control is dispatched before reaching this renderer adapter.
            return publicPlayback();
        },
        async playerCommand(request) {
            if (!request.isCurrent() || !await authorize()) throw Object.assign(unavailable(), { code: 'unauthorized' });
            await requireGateway('libraries', (request.items ?? []).map(item => item.serverId).filter(id => id !== 'local'));
            if (request.playerId !== 'local') {
                await requireGateway('players', [request.playerId]);
                return network().networkMusicPlayerCommand(request);
            }
            if (!['replace', 'insert'].includes(request.action)) throw Object.assign(unavailable(), { code: 'unsupported' });
            await applyAndroidQueue(bridge, request, request.items, resolve, authorize);
            return publicPlayback();
        },
        onDiagnostic: error => console.debug('Android remote music request failed:', error)
    };
}

export async function applyAndroidQueue(bridge, request, entries, resolve, authorize) {
    const check = async () => {
        if (!request.isCurrent() || !await authorize()) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
    };
    const transactionId = crypto.randomUUID();
    const replace = request.action === 'replace';
    let insertion = request.insertionOrdinal;
    if (replace) await bridge.request('playback.queue.begin', { transactionId,
        index: request.startIndex || 0, repeat: 'off', shuffle: false });
    else if (insertion === undefined) {
        const snapshot = await bridge.request('snapshot.get');
        const { index, ordinal = index, queueLength } = snapshot.playback;
        insertion = request.position === 'afterCurrent' ? ordinal + 1 : queueLength;
    }
    try {
        const encoder = new TextEncoder();
        const sendItems = async items => {
            await check();
            if (replace) await bridge.request('playback.queue.append', { transactionId, items });
            else {
                request.mutationStarted = true;
                await bridge.request('playback.insert', { index: insertion, transportOrder: true, items });
                insertion += items.length;
            }
        };
        let items = [], bytes = 0;
        for (const entry of entries) {
            if (!request.isCurrent()) throw Object.assign(new Error('unauthorized'), { code: 'unauthorized' });
            const item = await resolve(entry);
            const size = encoder.encode(JSON.stringify(item)).length + 1;
            // Reserve half of the bridge limit for the command envelope and request identifiers.
            if (items.length && (items.length === 64 || bytes + size > ANDROID_MESSAGE_LIMIT / 2)) {
                await sendItems(items);
                items = [];
                bytes = 0;
            }
            items.push(item);
            bytes += size;
        }
        if (items.length) await sendItems(items);
        await check();
        if (replace) {
            request.mutationStarted = true;
            await bridge.request('playback.queue.commit', { transactionId });
        }
        if (request.play) {
            if (!replace && request.insertionOrdinal !== undefined) {
                await bridge.request('playback.select', { index: request.insertionOrdinal + (request.startIndex || 0), transportOrder: true });
            }
            await bridge.request('playback.play');
        }
    } catch (error) {
        if (replace && request.isCurrent()) await bridge.request('playback.queue.abort', { transactionId }).catch(() => {});
        throw error;
    }
}
