import { isMidiFile } from '../../midi/smf-parser.js';
import { findLyricsFileName } from '../../library/metadata/lyrics.js';
import { TEXT_FILE_MAX_BYTES } from '../../library/metadata/text-encoding.js';
import { getLyricsFiles } from './lyrics-file-links.js';

export async function readMidiWrdBytes(track, player) {
    const fileName = track.file?.name ?? track.fileName ?? track.path?.split(/[\\/]/).at(-1) ?? track.name ?? '';
    if (!isMidiFile(fileName)) return null;
    const names = [fileName.replace(/\.(mid|midi|kar)$/i, '')];
    const files = getLyricsFiles(track.file);
    const match = findLyricsFileName(files.map(file => file.name), names, 'wrd');
    let file = match ? files.find(file => file.name === match.fileName) : null;
    if (!file) {
        const electronAPI = globalThis.window?.electronAPI;
        const path = track.path || (track.file && electronAPI?.getPathForFile?.(track.file));
        if (path && electronAPI?.readMidiWrd) return electronAPI.readMidiWrd(path);
        const trackUid = track.libraryTrackId ?? track.presentationTrack?.libraryTrackId;
        if (trackUid) {
            file = (await player.libraryOperationService?.resolveTrackSiblingFile?.({
                trackUid, names, extension: 'wrd'
            }))?.file;
        }
    }
    if (!file) return null;
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > TEXT_FILE_MAX_BYTES) {
        throw new Error('MIDI lyrics sidecar exceeds the supported text file size');
    }
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > TEXT_FILE_MAX_BYTES) throw new Error('MIDI lyrics sidecar changed while reading');
    return bytes;
}
