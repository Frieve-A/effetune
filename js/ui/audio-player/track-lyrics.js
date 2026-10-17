import {
    findLyricsFileName,
    lyricsCandidateNames,
    lyricsFromLrcBytes,
    lyricsFromMetadata,
    selectLyrics
} from '../../library/metadata/lyrics.js';
import { TEXT_FILE_MAX_BYTES } from '../../library/metadata/text-encoding.js';
import { getLyricsFiles } from './lyrics-file-links.js';
import { getPlaybackRegion, getRegionEndTime, getRegionStartTime } from './playback-region.js';

export class TrackLyrics {
    constructor(player) {
        this.player = player;
        this.track = null;
        this.data = null;
    }

    get(track) {
        if (track !== this.track) {
            this.track = track;
            this.data = null;
            if (track) {
                void this.load(track).then(data => {
                    if (this.track === track) this.data = data;
                }).catch(error => console.debug('Track lyrics could not be loaded:', error));
            }
        }
        return this.data;
    }

    async load(track) {
        track = track.presentationTrack ?? track;
        const playbackRegion = getPlaybackRegion(track);
        const region = playbackRegion
            ? { start: getRegionStartTime(playbackRegion), end: getRegionEndTime(playbackRegion) }
            : null;
        const fileName = track.path?.split(/[\\/]/).at(-1) || track.file?.name || '';
        const names = lyricsCandidateNames({
            fileName,
            cue: playbackRegion ? { title: track.meta?.title, performer: track.meta?.artist } : null
        });
        const electronAPI = typeof window !== 'undefined' ? window.electronAPI : null;
        let path = track.path;
        if (!path && track.file && electronAPI?.getPathForFile) {
            try { path = electronAPI.getPathForFile(track.file); }
            catch (error) { console.debug('Track lyrics path could not be resolved:', error); }
        }
        if (path) return electronAPI?.readTrackLyrics?.({ path, names, region }) ?? null;
        if (!track.file) return null;

        const [embedded, sidecar] = await Promise.all([
            this.embedded(track.file).catch(error => {
                console.debug('Embedded track lyrics could not be read:', error);
                return null;
            }),
            this.sidecar(track, names).catch(error => {
                console.debug('Track lyrics sidecar could not be read:', error);
                return null;
            })
        ]);
        return selectLyrics({
            embedded,
            sidecar: sidecar?.data ?? null,
            perTrack: sidecar ? sidecar.index < names.length - 1 : false,
            region
        });
    }

    async embedded(file) {
        const { parseBlob } = await import('../../vendor/music-metadata-browser.mjs');
        return lyricsFromMetadata(await parseBlob(file, { duration: false, skipCovers: true }));
    }

    async sidecar(track, names) {
        let match;
        if (track.libraryTrackId) {
            match = await this.player.libraryOperationService?.resolveTrackSiblingFile?.({
                trackUid: track.libraryTrackId, names
            });
        } else {
            const files = getLyricsFiles(track.file);
            const listed = findLyricsFileName(files.map(file => file.name), names);
            if (listed) match = { file: files.find(file => file.name === listed.fileName), index: listed.index };
        }
        if (!match?.file || match.file.size > TEXT_FILE_MAX_BYTES) return null;
        return { data: lyricsFromLrcBytes(await match.file.arrayBuffer()), index: match.index };
    }
}
