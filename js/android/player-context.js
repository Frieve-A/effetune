import { AudioContextManager } from '../ui/audio-player/audio-context-manager.js';
import { AndroidDocuments } from './documents.js';
import { ANDROID_ORIGIN } from './bridge.js';
import { isVideoPlaybackSource } from '../ui/audio-player/playback-source-policy.js';
import { AndroidDocumentFile } from './library-io.js';
import { AndroidPlaybackQueue, nativeQueueTrack } from './playback-queue.js';
import { ensureAndroidNetworkAccess } from './network.js';
import { getPlaybackRegion, getRegionStartTime, getRegionEndTime } from '../ui/audio-player/playback-region.js';
import { getLyricsFiles, attachLyricsFiles } from '../ui/audio-player/lyrics-file-links.js';
import { lyricsCandidateNames, findLyricsFileName } from '../library/metadata/lyrics.js';

export class AndroidPlayerContext extends AudioContextManager {
    constructor(player, manager) {
        super(player, manager);
        this.bridge = manager.bridge;
        this.documents = new AndroidDocuments(this.bridge);
        this.nativeQueueOwned = true;
        this.sourceCache = new WeakMap();
        this.nativeQueue = new AndroidPlaybackQueue(this.bridge);
        this.detachSnapshot = this.bridge.on('snapshot', snapshot => this.acceptPlayback(snapshot));
        this.detachEnded = this.bridge.on('playback-ended', snapshot => {
            this.acceptPlayback(snapshot);
        });
        this.acceptPlayback(manager.snapshot);
    }

    acceptPlayback(snapshot) {
        if (snapshot?.revision < this.audioManager.snapshot?.revision) return;
        const playback = snapshot?.playback;
        if (!playback) return;
        const localTrack = this.nativeTracks?.[playback.index];
        const sourceKey = JSON.stringify([playback.source?.uri, playback.source?.region, playback.source?.title, playback.index]);
        const cachedSource = localTrack && this.sourceCache.get(localTrack);
        const track = playback.source && ((this.presentedSourceKey === sourceKey ? this.presentedTrack : null)
            || (cachedSource?.uri === playback.source?.uri && cachedSource?.title === playback.source?.title ? localTrack : null)
            || nativeQueueTrack(playback.source, playback.index));
        this.nativeQueue.accept(playback);
        if (!this.queueWriting && this.nativeQueue.itemCount && this.audioPlayer.playbackManager.catalogSequence !== this.nativeQueue) {
            this.audioPlayer.playbackManager.installCatalogSequence(this.nativeQueue, {
                currentOrdinal: playback.index, currentTrack: track, preservePlaybackGeneration: true
            });
        }
        this.playerVolume = Math.round((playback.volume ?? 1) * 100);
        this.playerMute = playback.muted === true;
        this.updateState({
            isPlaying: playback.playing === true,
            isPaused: playback.playing !== true && !!playback.source,
            isStopped: playback.playing !== true && !playback.source,
            currentTrackPosition: playback.position || 0,
            currentTrackDuration: playback.duration || 0,
            playbackMode: 'native',
            playlistLength: playback.queueLength || 0,
            queueWindow: this.nativeQueue.window,
            playbackSpeed: playback.speed || 1,
            preservePitch: playback.preservePitch !== false,
            playerVolume: this.playerVolume, playerMute: this.playerMute,
            volume: this.playerVolume, volumeMax: 100,
            repeatMode: (playback.repeat || 'off').toUpperCase(),
            shuffleMode: playback.shuffle === true,
            ...(track ? { currentTrack: track, currentTrackIndex: playback.index,
                currentTrackName: track.name || '' } : { currentTrack: null, currentTrackIndex: 0, currentTrackName: '' })
        }, 'Android playback snapshot');
        if (track && playback.source?.uri && sourceKey !== this.presentedSourceKey) {
            this.presentedSourceUri = playback.source.uri;
            this.presentedSourceKey = sourceKey;
            this.presentedTrack = track;
            void this.presentNativeTrack(track, playback.source.uri, playback.index, sourceKey).catch(error => console.debug('Android track presentation unavailable:', error));
        }
    }

    async presentNativeTrack(track, uri, index, sourceKey) {
        track = { ...track };
        this.setVideoPresentationSource(isVideoPlaybackSource(track)
            ? uri.startsWith('content:') ? `${ANDROID_ORIGIN}/media?uri=${encodeURIComponent(uri)}` : uri : null);
        try {
        if (track.libraryTrackId) await window.uiManager?.ensureLibraryManager?.();
        if (uri.startsWith('content:') && !track.file) {
            const metadata = await this.bridge.request('documents.stat', { uri });
            track.file = new AndroidDocumentFile({ ...metadata, uri });
        }
        if (track.file && track.lyricsFile) attachLyricsFiles([track.file], [new AndroidDocumentFile(track.lyricsFile)]);
        if (!track.meta?.title && track.file) {
            const { parseBlob } = await import('../vendor/music-metadata-browser.mjs');
            const metadata = await parseBlob(track.file, { duration: false, skipCovers: false });
            track.meta = { ...track.meta, title: metadata.common?.title || track.name,
                artist: metadata.common?.artist, album: metadata.common?.album,
                picture: metadata.common?.picture?.[0] };
        }
        } catch (error) { console.debug('Android track metadata unavailable:', error); }
        if (this.presentedSourceKey !== sourceKey) return;
        this.presentedTrack = track;
        this.updateState({ currentTrack: track }, 'Android track presentation ready');
        this.loadMetadata(track, null, index);
    }

    async command(name, payload = {}) {
        const result = await this.bridge.request(`playback.${name}`, payload);
        this.audioManager.acceptSnapshot(result);
        this.acceptPlayback(result);
        return true;
    }

    queueMode(mode) {
        const state = this.getCurrentState();
        return this.command('queueMode', { repeat: state.repeatMode.toLowerCase(), shuffle: state.shuffleMode, ...mode });
    }

    async resolveNativeSource(track) {
        if (this.sourceCache.has(track)) return this.sourceCache.get(track);
        const playable = await this.resolveTrackProvider(track);
        let uri = playable.uri || playable.path || playable.url || playable.mediaSource || playable.file?.androidUri;
        if (!uri && playable.file) {
            const temporary = await this.bridge.request('documents.createTemporary', {
                name: playable.file.name, mimeType: playable.file.type
            });
            await this.documents.write(temporary.uri, playable.file);
            uri = temporary.uri;
        }
        const parsed = new URL(uri);
        if (!['content:', 'http:', 'https:'].includes(parsed.protocol)) throw new Error('Unsupported Android music source');
        if (parsed.protocol !== 'content:') await ensureAndroidNetworkAccess({ request: true });
        const region = getPlaybackRegion(playable);
        const source = { uri, title: playable.name || playable.file?.name || '',
            ...(!region ? {} : { region: {
                start: getRegionStartTime(region), end: getRegionEndTime(region), durationSec: region.durationSec
            } }), ...(playable.headers ? { headers: playable.headers } : {}) };
        const libraryTrackId = playable.libraryTrackId || track.libraryTrackId || playable.trackUid || track.trackUid;
        if (typeof libraryTrackId === 'string') source.libraryTrackId = libraryTrackId;
        if (playable.meta) {
            const metadata = {};
            for (const key of ['title', 'artist', 'album']) {
                if (typeof playable.meta[key] === 'string') metadata[key] = playable.meta[key].slice(0, 4096);
            }
            if (typeof playable.meta.artworkUrl === 'string' && /^https?:\/\//.test(playable.meta.artworkUrl)) {
                metadata.artworkUrl = playable.meta.artworkUrl.slice(0, 8192);
            }
            if (Number.isFinite(playable.meta.duration)) metadata.duration = playable.meta.duration;
            source.metadata = metadata;
        }
        if (typeof playable.type === 'string') source.type = playable.type;
        if (typeof playable.sourceKind === 'string') source.sourceKind = playable.sourceKind;
        if (playable.file) {
            const files = getLyricsFiles(playable.file);
            const names = lyricsCandidateNames({ fileName: playable.file.name,
                cue: region ? { title: playable.meta?.title, performer: playable.meta?.artist } : null });
            const match = findLyricsFileName(files.map(file => file.name), names);
            const lyrics = match && files.find(file => file.name === match.fileName);
            if (lyrics?.androidUri) source.lyricsFile = { uri: lyrics.androidUri, name: lyrics.name,
                size: lyrics.size, mimeType: lyrics.type };
        }
        if (uri.startsWith('content:')) this.sourceCache.set(track, source);
        return source;
    }

    async loadTrack(track, targetIndex = null) {
        if (Number.isInteger(track.nativeQueueIndex)) return this.command('select', { index: track.nativeQueueIndex });
        const playable = await this.resolveTrackProvider(track);
        const { uri } = await this.resolveNativeSource(playable);
        const playlist = this.audioPlayer.playbackManager.playlist;
        const sequence = this.audioPlayer.playbackManager.sequence;
        const tracks = Array.isArray(playlist) && playlist.length ? playlist : null;
        const index = targetIndex ?? (tracks ? Math.max(0, tracks.indexOf(track)) : this.getCurrentState().currentTrackIndex);
        this.nativeTracks = tracks;
        await this.replaceNativeQueue({ tracks: tracks || (!sequence?.itemCount ? [track] : null), sequence, index });
        this.setVideoPresentationSource(isVideoPlaybackSource(playable)
            ? uri.startsWith('content:') ? `${ANDROID_ORIGIN}/media?uri=${encodeURIComponent(uri)}` : uri
            : null);
        this.updateState({ currentTrack: track, currentTrackIndex: index,
            currentTrackName: playable.name || playable.file?.name || '',
            isTransitioning: false, transitionType: null, playbackMode: 'native' }, 'Android track selected');
        return true;
    }

    async resolveQueueItem(tracks, sequence, ordinal, signal) {
        if (tracks) return this.resolveNativeSource(tracks[ordinal]);
        const entry = await sequence.getEntry(ordinal);
        const source = await sequence.resolveEntrySource(entry, null, signal);
        return this.resolveNativeSource({ ...entry, ...source, name: entry.name || entry.title || entry.fileName });
    }

    async replaceNativeQueue({ tracks = null, sequence = null, index = 0, preservePlayback = false }) {
        this.nativeLoadAbort?.abort();
        const abort = new AbortController();
        this.nativeLoadAbort = abort;
        const transactionId = crypto.randomUUID();
        const count = tracks?.length || sequence?.itemCount || 0;
        const state = this.getCurrentState();
        this.queueWriting = true;
        try {
        await this.command('queue.begin', { transactionId, index: Math.max(0, index),
            repeat: state.repeatMode.toLowerCase(), shuffle: state.shuffleMode });
        for (let offset = 0; offset < count; offset += 64) {
            const items = [];
            for (let ordinal = offset; ordinal < Math.min(count, offset + 64); ordinal++) {
                abort.signal.throwIfAborted();
                items.push(await this.resolveQueueItem(tracks, sequence, ordinal, abort.signal));
            }
            abort.signal.throwIfAborted();
            await this.command('queue.append', { transactionId, items });
        }
        abort.signal.throwIfAborted();
        await this.command('queue.commit', { transactionId, preservePlayback });
        } catch (error) {
            await this.bridge.request('playback.queue.abort', { transactionId }).catch(() => {});
            throw error;
        } finally {
            if (this.nativeLoadAbort === abort) {
                this.queueWriting = false;
                this.acceptPlayback(this.audioManager.snapshot);
            }
        }
        return { accepted: true, preserved: preservePlayback };
    }

    async insertNativeQueue({ tracks = null, sequence = null, index = this.audioManager.snapshot.playback.queueLength }) {
        const count = tracks?.length || sequence?.itemCount || 0;
        for (let offset = 0; offset < count; offset += 64) {
            const items = [];
            for (let ordinal = offset; ordinal < Math.min(count, offset + 64); ordinal++) {
                items.push(await this.resolveQueueItem(tracks, sequence, ordinal));
            }
            await this.command('insert', { index: index + offset, items });
        }
        return { accepted: true, preserved: true };
    }

    play() { return this.command('play'); }
    pause() { return this.command('pause'); }
    stop() { this.nativeLoadAbort?.abort(); this.stopRequestToken++; return this.command('stop'); }
    seek(position) { return this.command('seek', { position }); }
    getCurrentPlaybackTime() { return this.audioManager.snapshot?.playback?.position || 0; }
    getVideoPresentation() { return { ...this.videoPresentation, contextTime: performance.now() / 1000 }; }
    resumePlaybackAudioContext() { return Promise.resolve(true); }
    async prepareTrackSelection(track, isCurrent) { await this.resolveNativeSource(track); return isCurrent(); }
    async transitionToNextTrack(track, index) { await this.loadTrack(track, index); return this.play(); }
    seamlessTransition(track, index) { return this.transitionToNextTrack(track, index); }
    prepareNextTrackBufferWithRepeatMode() { return Promise.resolve(); }
    applyPlaybackSpeed() {
        const state = this.getCurrentState();
        return this.command('speed', { speed: state.playbackSpeed, preservePitch: state.preservePitch });
    }
    applyPlaybackSpeedToElement() { return this.applyPlaybackSpeed(); }
    applyPlayerVolume() {
        return this.command('volume', { volume: this.playerVolume / 100, muted: this.playerMute }).catch(error => {
            console.error('Android player volume failed:', error);
        });
    }
    disconnect() { this.detachSnapshot?.(); this.detachEnded?.(); }
}
