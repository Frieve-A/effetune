import { getArtworkFiles } from './lyrics-file-links.js';
import { selectCueCoverFileName } from '../../library/metadata/cue-cover.js';

const MAX_COVER_BYTES = 20 * 1024 * 1024;
const directory = file => String(file?.webkitRelativePath || '').replaceAll('\\', '/').split('/').slice(0, -1).join('/');

export async function readScoreArtwork(track) {
    if (track.meta?.picture || track.meta?.artworkUrl || track.libraryTrackId || track.presentationTrack?.libraryTrackId) return null;
    const files = getArtworkFiles(track.file).filter(file => directory(file) === directory(track.file));
    const name = selectCueCoverFileName(files.map(file => file.name), track.file?.name || track.name || track.path);
    const file = files.find(file => file.name === name);
    if (file) {
        if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_COVER_BYTES) return null;
        const bytes = await file.arrayBuffer();
        if (bytes.byteLength !== file.size) return null;
        return { data: new Uint8Array(bytes), format: 'image/jpeg' };
    }
    const api = globalThis.window?.electronAPI;
    const path = track.path || (track.file && api?.getPathForFile?.(track.file));
    return path && api?.readTrackTags ? (await api.readTrackTags(path))?.picture ?? null : null;
}
