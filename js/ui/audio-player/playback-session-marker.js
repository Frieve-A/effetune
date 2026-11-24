import { getSettingsStorage } from '../../settings-storage.js';

const KEY = 'effetune_playback_session_present';

async function markerPath(api) {
    return api.joinPaths(await api.getPath('settings'), 'player-session-marker.json');
}

export async function readPlaybackSessionMarker(windowRef = globalThis.window) {
    const api = windowRef?.electronAPI;
    if (!api) return getSettingsStorage(windowRef)?.getItem(KEY) === 'true';
    const path = await markerPath(api);
    if (!await api.fileExists(path)) return false;
    const result = await api.readFile(path);
    if (!result.success) throw new Error('Could not read playback session marker');
    return JSON.parse(result.content).present === true;
}

export async function writePlaybackSessionMarker(present, windowRef = globalThis.window) {
    const api = windowRef?.electronAPI;
    if (!api) {
        const storage = getSettingsStorage(windowRef);
        if (present) storage.setItem(KEY, 'true');
        else storage.removeItem(KEY);
        return;
    }
    const result = await api.saveFile(await markerPath(api), JSON.stringify({ present }));
    if (!result.success) throw new Error('Could not write playback session marker');
}
