import { isMidiFile } from '../../midi/smf-parser.js';
import { findLyricsFileName } from '../../library/metadata/lyrics.js';
import { TEXT_FILE_MAX_BYTES } from '../../library/metadata/text-encoding.js';
import { getLyricsFiles } from './lyrics-file-links.js';
import { getPlaybackFilePath } from './playback-source-policy.js';

export async function readMidiWrdBytes(track, player) {
    if (track.sourceKind === 'openhome') return null;
    const fileName = track.file?.name ?? track.fileName ?? track.path?.split(/[\\/]/).at(-1) ?? track.name ?? '';
    if (!isMidiFile(fileName)) return null;
    const names = [fileName.replace(/\.(mid|midi|kar)$/i, '')];
    const files = getLyricsFiles(track.file);
    const wrdName = (names[0] + '.wrd').normalize('NFC').toLowerCase();
    let file = files.find(candidate => candidate.name?.normalize('NFC').toLowerCase() === wrdName);
    if (!file && files.length) {
        const match = findLyricsFileName(files.map(candidate => candidate.name), names, 'wrd');
        if (match) file = files.find(candidate => candidate.name === match.fileName);
    }
    if (!file) {
        const electronAPI = globalThis.window?.electronAPI;
        const path = getPlaybackFilePath(track, electronAPI);
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
