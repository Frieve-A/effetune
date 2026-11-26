import { AudioContextManager } from '../ui/audio-player/audio-context-manager.js';
import { scoreName, readAndroidScore, packAndroidScore } from './score.js';
import { AndroidDocuments } from './documents.js';
import { ANDROID_ORIGIN } from './bridge.js';
import { isVideoPlaybackSource } from '../ui/audio-player/playback-source-policy.js';
import { AndroidDocumentFile } from './library-io.js';
import { computeReplayGainFactor } from '../ui/audio-player/replay-gain.js';
import { createTrackFromMetadata, getReplayGain } from '../library/metadata/metadata-mapper.js';
import { readRiffInfoTagsFromBlob } from '../library/metadata/riff-info.js';
import { AndroidPlaybackQueue, nativeQueueTrack } from './playback-queue.js';
import { ensureAndroidNetworkAccess } from './network.js';
import { getPlaybackRegion, getRegionStartTime, getRegionEndTime } from '../ui/audio-player/playback-region.js';
import { getLyricsFiles, attachLyricsFiles } from '../ui/audio-player/lyrics-file-links.js';
import { lyricsCandidateNames, findLyricsFileName } from '../library/metadata/lyrics.js';

// Snapshots answering earlier writes still carry older values, so the user's value
// stays until the last write of its kind settles; other changes apply as they arrive.
const LOCAL_WRITE_FIELDS = {
    volume: ['playerVolume', 'playerMute', 'volume'],
    speed: ['playbackSpeed', 'preservePitch'],
    position: ['currentTrackPosition']
};

export class AndroidPlayerContext extends AudioContextManager {
    constructor(player, manager) {
        super(player, manager);
        this.pendingWrites = { volume: 0, speed: 0, position: 0 };
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
        if (this.nativeQueue.itemCount) {
            const initialTarget = player.replayGainReady;
            Promise.resolve(initialTarget).then(() => {
                if (initialTarget === player.replayGainReady && !this.gainRefresh) return this.applyReplayGainPreference();
            }).catch(error => console.debug('Android queue gain refresh failed:', error));
        }
    }

    get liveTrackSelected() {
        return !!this.audioPlayer.stateManager?.getCurrentTrack?.()?.meta?.openHomeQueueEntry?.liveSessionId;
    }

    acceptPlayback(snapshot, restoreQueue = false) {
        if (this.disconnected || snapshot?.revision < this.audioManager.snapshot?.revision) return;
        const playback = snapshot?.playback;
        if (!playback) return;
        const sourceKey = JSON.stringify([playback.source?.uri, playback.source?.region, playback.source?.title,
            playback.source?.libraryTrackId, playback.source?.scoreUri, playback.index]);
        // OpenHome owns its ephemeral playlist, including the interval between URI selection and Play.
        if (this.liveTrackSelected && (playback.liveId || (!playback.playing &&
            (this.nativeSelectionKey == null || sourceKey === this.nativeSelectionKey)))) {
            this.presentedSourceKey = null;
            this.trackPresentationRequest = null;
            this.activeMetadataRequest = null;
            if (!this.pendingWrites.volume) {
                this.playerVolume = Math.round((playback.volume ?? 1) * 100);
                this.playerMute = playback.muted === true;
                this.updateState({ playerVolume: this.playerVolume, volume: this.playerVolume, playerMute: this.playerMute },
                    'Android player volume');
            }
            return;
        }
        this.nativeSelectionKey = sourceKey;
        const queueChanged = this.nativeQueue.accept(playback);
        const ordinal = playback.ordinal ?? this.nativeQueue.toTransportOrdinal(playback.index);
        const manager = this.audioPlayer.playbackManager;
        const localTrack = this.nativeTracks?.[playback.index];
        const cachedSource = localTrack && this.sourceCache.get(localTrack);
        const selectionChanged = (playback.source ? sourceKey : null) !== (this.presentedSourceKey ?? null);
        const track = playback.source && ((!selectionChanged && this.presentedTrack)
            || (cachedSource?.uri === playback.source?.uri && cachedSource?.title === playback.source?.title ? localTrack : null)
            || nativeQueueTrack(playback.source, playback.index, ordinal));
        manager.unloadedSessionTrack = playback.restoredUnloaded ? track : null;
        if (!this.queueWriting && (this.nativeQueue.itemCount || restoreQueue) && manager.catalogSequence !== this.nativeQueue) {
            manager.installCatalogSequence(this.nativeQueue, {
                currentOrdinal: ordinal, currentTrack: track, preservePlaybackGeneration: true
            });
        } else if (manager.catalogSequence === this.nativeQueue) {
            if (queueChanged) manager.resolvedCatalogEntries?.clear();
            const pendingCenterMoved = track && !this.nativeQueue.window.rows.length && ordinal !== this.getCurrentState().currentTrackIndex;
            if (this.queueFocus !== playback.queueFocus || pendingCenterMoved) {
                void manager.refreshCatalogQueueWindow(ordinal);
            } else if (queueChanged) {
                void manager.refreshCatalogQueuePage(this.nativeQueue.window.startOrdinal);
            }
        }
        this.queueFocus = playback.queueFocus;
        const volume = Math.round((playback.volume ?? 1) * 100);
        const stopped = playback.stopped || !playback.source;
        const state = {
            isPlaying: playback.playing === true,
            isPaused: playback.playing !== true && !stopped,
            isStopped: playback.playing !== true && stopped,
            currentTrackPosition: playback.position || 0,
            currentTrackDuration: playback.duration || 0,
            playbackMode: playback.source?.scoreUri ? 'midi' : 'native',
            playlistLength: playback.queueLength || 0,
            playbackSpeed: playback.speed || 1,
            preservePitch: playback.preservePitch !== false,
            playerVolume: volume, playerMute: playback.muted === true,
            volume, volumeMax: 100,
            repeatMode: (playback.repeat || 'off').toUpperCase(),
            shuffleMode: playback.shuffle === true,
            currentTrack: track || null, currentTrackIndex: track ? ordinal : 0,
            ...(selectionChanged && { currentTrackName: this.getDisplayTrackName(track) })
        };
        if (selectionChanged) {
            this.activeMetadataRequest = null;
            if (!track) {
                this.clearArtworkURL();
                state.artworkUrl = '';
                state.isTrackPresentationPending = false;
            }
        }
        for (const [write, fields] of Object.entries(LOCAL_WRITE_FIELDS)) {
            if (this.pendingWrites[write]) for (const field of fields) delete state[field];
        }
        if (!this.pendingWrites.volume) {
            this.playerVolume = state.playerVolume;
            this.playerMute = state.playerMute;
        }
        this.updateState(state, 'Android playback snapshot');
        this.midiPlaying = !!playback.source?.scoreUri && playback.playing;
        this.midiPosition = playback.position || 0;
        this.midiGeneration = playback.scoreRevision || 0;
        if (!track) {
            this.presentedSourceKey = null;
            this.presentedTrack = null;
            this.trackPresentationRequest = null;
            this.midiTimeline = null;
        }
        if (track && playback.source?.uri && selectionChanged) {
            this.presentedSourceUri = playback.source.uri;
            this.presentedSourceKey = sourceKey;
            this.presentedTrack = track;
            this.midiTimeline = null;
            const request = this.trackPresentationRequest = Symbol();
            void this.presentNativeTrack(track, playback.source.uri, request).catch(error => console.debug('Android track presentation unavailable:', error));
        }
    }

    async presentNativeTrack(track, uri, request) {
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
        const preparedScore = this.audioManager.snapshot?.playback?.source;
        if (preparedScore?.scoreUri || scoreName(track)) {
            const timeline = await readAndroidScore({ ...track, fileName: preparedScore?.scoreName || track.fileName }, uri, this);
            if (this.trackPresentationRequest !== request) return;
            this.midiTimeline = timeline;
            track.meta = { ...track.meta, title: timeline.title || track.meta?.title || track.name,
                picture: track.meta?.picture || timeline.picture };
        } else if (!track.meta?.title && track.file) {
            const { parseBlob } = await import('../vendor/music-metadata-browser.mjs');
            const [metadata, riffInfoTags] = await Promise.all([
                parseBlob(track.file, { duration: false, skipCovers: false }),
                readRiffInfoTagsFromBlob(track.file).catch(() => [])
            ]);
            // Map tags as the library scan does so legacy-encoded text is repaired the same way.
            const { title, artist, album } = createTrackFromMetadata({ fileName: track.file.name, size: track.file.size },
                metadata, Date.now(), { languageHints: this.getMetadataRepairHints(), riffInfoTags });
            track.meta = { ...track.meta, title, artist, album, picture: metadata.common?.picture?.[0] };
        }
        } catch (error) { console.debug('Android track metadata unavailable:', error); }
        if (this.trackPresentationRequest !== request || this.liveTrackSelected) return;
        this.presentedTrack = track;
        this.updateState({ currentTrack: track, currentTrackName: this.getDisplayTrackName(track) }, 'Android track presentation ready');
        this.loadMetadata(track, null, this.getCurrentState().currentTrackIndex);
    }

    // `write` names the LOCAL_WRITE_FIELDS group this command sets; `localState` shows it at once.
    async command(name, payload = {}, write = null, localState = null) {
        if (write) this.pendingWrites[write]++;
        if (localState) this.updateState(localState, `Android ${name} requested`);
        let result;
        try {
            result = await this.bridge.request(`playback.${name}`, payload);
        } catch (error) {
            // A rejected write leaves the native value in force, so show it again.
            if (write && !--this.pendingWrites[write]) this.acceptPlayback(this.audioManager.snapshot);
            if (error?.code === 'audio-focus-denied') {
                this.audioManager.reportHostError(error);
                // Tell the caller the user has already been informed.
                error.reported = true;
            }
            throw error;
        }
        if (write) this.pendingWrites[write]--;
        this.audioManager.acceptSnapshot(result);
        this.acceptPlayback(result);
        return true;
    }

    queueMode(mode) {
        const state = this.getCurrentState();
        return this.command('queueMode', { repeat: state.repeatMode.toLowerCase(), shuffle: state.shuffleMode, ...mode });
    }

    async nativeReplayGain(track, source) {
        const settings = this.audioPlayer?.replayGain;
        if (!settings || settings.mode === 'off') return 1;
        const input = source.libraryTrackId && source.libraryTrackId !== track.libraryTrackId
            ? { ...track, libraryTrackId: source.libraryTrackId } : track;
        const reading = this.readPlaybackReplayGain(input);
        if (!reading) return 1;
        let values = await reading;
        if (!values && source.uri.startsWith('content:')) {
            try {
                const file = track.file?.androidUri ? track.file : new AndroidDocumentFile({
                    ...await this.bridge.request('documents.stat', { uri: source.uri }), uri: source.uri
                });
                const { parseBlob } = await import('../vendor/music-metadata-browser.mjs');
                values = getReplayGain(await parseBlob(file, { duration: false, skipCovers: true }));
            } catch (error) { console.debug('Android ReplayGain tags unavailable:', error); }
        }
        return computeReplayGainFactor(values, settings);
    }

    async applyReplayGainPreference(queueChanged = false) {
        const off = this.audioPlayer?.replayGain?.mode === 'off';
        if (off && this.queueGainsOff && !queueChanged) return;
        this.queueGainsOff = false;
        const refresh = this.gainRefresh = Symbol();
        const isCurrent = () => this.gainRefresh === refresh;
        await this.nativeQueue.updateReplayGainFactors(source => this.nativeReplayGain({
            ...source, name: source.title, fileName: source.scoreName || source.title
        }, source), isCurrent);
        if (isCurrent()) this.queueGainsOff = off;
    }

    async reconcileGainsAfterQueueWrite(previousRefresh) {
        if (previousRefresh !== this.gainRefresh) {
            try { await this.applyReplayGainPreference(true); }
            catch (error) { console.warn('Android queue gain refresh failed after a queue change:', error); }
        }
    }

    async resolveNativeSource(track) {
        if (this.sourceCache.has(track)) return this.sourceCache.get(track);
        const playable = await this.resolveTrackProvider(track);
        const name = scoreName(playable);
        let uri = playable.uri || playable.path || playable.url || playable.mediaSource || playable.file?.androidUri;
        const materializedScore = name && (playable.bytes ?? playable.data ?? (playable.readBytes && !playable.file
            ? await playable.readBytes() : null));
        if (materializedScore || (playable.file && (!uri || (name && !/^(?:https?:|content:)/i.test(uri))))) {
            const temporary = await this.bridge.request('documents.createTemporary', {
                name: playable.file?.name || name.split(/[\\/]/).at(-1).split(/[?#]/)[0], mimeType: playable.file?.type
            });
            await this.documents.write(temporary.uri, materializedScore || playable.file);
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
        if (name) {
            source.scoreName = name;
            if (playable.scoreUri) source.scoreUri = playable.scoreUri;
            else {
                const timeline = await readAndroidScore(playable, uri, this);
                const file = await this.bridge.request('documents.createTemporary', { name: 'score.bin' });
                await this.documents.write(file.uri, packAndroidScore(timeline));
                source.scoreUri = file.uri;
                source.metadata = { ...source.metadata, title: timeline.title || source.metadata?.title || source.title,
                    duration: timeline.duration };
            }
        }
        if (uri.startsWith('content:') || source.scoreUri) this.sourceCache.set(track, source);
        return source;
    }

    async loadTrack(track, targetIndex = null, _preparedRequest = null, options = null) {
        const { signal, bulkPlayId } = options ?? {};
        signal?.throwIfAborted();
        this.audioPlayer.openHomePlaybackAdapter?.networkLive?.stop();
        if (Number.isInteger(track.nativeQueueIndex)) return this.command('select', { index: track.nativeQueueIndex });
        const playable = await this.resolveTrackProvider(track);
        const { uri } = await this.resolveNativeSource(track);
        const playlist = this.audioPlayer.playbackManager.playlist;
        const sequence = this.audioPlayer.playbackManager.sequence;
        const tracks = Array.isArray(playlist) && playlist.length ? playlist : null;
        const index = targetIndex ?? (tracks ? Math.max(0, tracks.indexOf(track)) : this.getCurrentState().currentTrackIndex);
        signal?.throwIfAborted();
        await this.replaceNativeQueue({ tracks: tracks || (!sequence?.itemCount ? [track] : null), sequence, index, signal, bulkPlayId });
        this.setVideoPresentationSource(isVideoPlaybackSource(playable)
            ? uri.startsWith('content:') ? `${ANDROID_ORIGIN}/media?uri=${encodeURIComponent(uri)}` : uri
            : null);
        this.updateState({ currentTrack: this.presentedTrack ?? track, isTransitioning: false, transitionType: null }, 'Android track selected');
        return true;
    }

    async resolveQueueItem(tracks, sequence, ordinal, signal) {
        try {
            let track = tracks?.[ordinal];
            if (!tracks) {
                const entry = await sequence.getEntry(ordinal);
                const source = await sequence.resolveEntrySource(entry, null, signal);
                track = { ...entry, ...source, name: entry.name || entry.title || entry.fileName,
                    meta: { ...entry.meta, title: entry.meta?.title || entry.title,
                        artist: entry.meta?.artist || entry.artist || entry.albumArtist,
                        album: entry.meta?.album || entry.album, duration: entry.meta?.duration ?? entry.durationSec } };
            }
            const source = await this.resolveNativeSource(track);
            return { ...source, replayGainFactor: await this.nativeReplayGain(track, source) };
        } catch (error) {
            if (tracks || sequence?.kind !== 'catalog' || error?.code !== 'document-not-found') throw error;
            console.warn('Skipping an unavailable library track:', error);
            return null;
        }
    }

    reportSkippedQueueItems(count, written) {
        if (written === count) return;
        window.uiManager?.showTransientMessage?.('status.libraryTracksSkippedMissing', false, { count: count - written });
        if (!written) {
            throw Object.assign(new Error('No library files remain in the selection'), { code: 'library-files-missing' });
        }
    }

    async replaceNativeQueue({ tracks = null, sequence = null, index = 0, preservePlayback = false, play = false, signal, bulkPlayId }) {
        this.nativeLoadAbort?.abort();
        const abort = new AbortController();
        this.nativeLoadAbort = abort;
        signal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
        const transactionId = crypto.randomUUID();
        const count = tracks?.length || sequence?.itemCount || 0;
        const state = this.getCurrentState();
        const startOrdinal = index;
        const catalogQueue = !tracks && sequence?.kind === 'catalog';
        const shuffledCatalog = !tracks && sequence?.shuffleEnabled;
        if (shuffledCatalog) index = sequence.toCanonicalOrdinal(index);
        if (tracks && state.shuffleMode && tracks[index]?.entryInstanceId) {
            const original = this.audioPlayer.playbackManager.originalPlaylist;
            const canonical = original?.findIndex(entry => entry.entryInstanceId === tracks[index].entryInstanceId);
            if (canonical >= 0) { tracks = original; index = canonical; }
        }
        this.nativeTracks = tracks;
        const gainRefresh = this.gainRefresh;
        this.queueWriting = true;
        try {
            signal.throwIfAborted();
            await this.command('queue.begin', { transactionId, index: Math.max(0, index), startOrdinal,
                ...(bulkPlayId && { bulkPlayId }),
                ...(shuffledCatalog && { shuffleSeed: sequence.permutation.seed | 0 }),
                catalogQueue, repeat: shuffledCatalog && state.repeatMode === 'ONE' ? 'off' : state.repeatMode.toLowerCase(),
                shuffle: tracks ? state.shuffleMode : Boolean(shuffledCatalog) });
            let written = 0;
            let selected = index;
            let nearest = count;
            for (let offset = 0; offset < count; offset += 64) {
                const items = [];
                for (let ordinal = offset; ordinal < Math.min(count, offset + 64); ordinal++) {
                    signal.throwIfAborted();
                    const sourceOrdinal = shuffledCatalog ? sequence.toTransportOrdinal(ordinal) : ordinal;
                    const item = await this.resolveQueueItem(tracks, sequence, sourceOrdinal, signal);
                    if (!item) continue;
                    items.push(item);
                    // Keep the closest surviving track in transport order.
                    const distance = (sourceOrdinal - startOrdinal + count) % count;
                    if (distance < nearest) {
                        selected = written;
                        nearest = distance;
                    }
                    written++;
                }
                signal.throwIfAborted();
                if (items.length) await this.command('queue.append', { transactionId, items });
            }
            signal.throwIfAborted();
            this.reportSkippedQueueItems(count, written);
            const resume = preservePlayback && written < count && nearest !== 0;
            if (resume) preservePlayback = false;
            await this.command('queue.commit', { transactionId, preservePlayback, ...(written < count && {
                index: selected, startOrdinal: Math.min(startOrdinal, written - 1)
            }) });
            signal.throwIfAborted();
            if (play || (resume && state.isPlaying)) await this.play();
        } catch (error) {
            await this.bridge.request('playback.queue.abort', { transactionId }).catch(() => {});
            throw error;
        } finally {
            if (this.nativeLoadAbort === abort) {
                this.queueWriting = false;
                this.acceptPlayback(this.audioManager.snapshot);
            }
        }
        await this.reconcileGainsAfterQueueWrite(gainRefresh);
        return { accepted: true, preserved: preservePlayback };
    }

    async restoreNativeQueue(operationId) {
        this.nativeLoadAbort?.abort();
        this.nativeTracks = null;
        this.queueWriting = false;
        await this.command('queue.restore', { operationId });
        this.acceptPlayback(this.audioManager.snapshot, true);
        return true;
    }

    async insertNativeQueue({ tracks = null, sequence = null, index = this.audioManager.snapshot.playback.queueLength }) {
        const count = tracks?.length || sequence?.itemCount || 0;
        const gainRefresh = this.gainRefresh;
        let written = 0;
        for (let offset = 0; offset < count; offset += 64) {
            const items = [];
            for (let ordinal = offset; ordinal < Math.min(count, offset + 64); ordinal++) {
                const item = await this.resolveQueueItem(tracks, sequence, ordinal);
                if (item) items.push(item);
            }
            if (!items.length) continue;
            await this.command('insert', { index: index + written, transportOrder: true, items });
            written += items.length;
        }
        this.reportSkippedQueueItems(count, written);
        await this.reconcileGainsAfterQueueWrite(gainRefresh);
        return { accepted: true, preserved: true };
    }

    play() { return this.command('play'); }
    pause() {
        return this.liveTrackSelected ? this.pauseNetworkLive() : this.command('pause');
    }
    stop() {
        this.nativeLoadAbort?.abort();
        this.stopRequestToken++;
        return this.liveTrackSelected ? this.stopNetworkLive() : this.command('stop');
    }
    seek(position) {
        return this.liveTrackSelected ? this.stopNetworkLive()
            : this.command('seek', { position }, 'position', { currentTrackPosition: position });
    }
    getCurrentPlaybackTime() {
        if (this.liveTrackSelected) return 0;
        if (this.pendingWrites.position) return this.getCurrentState().currentTrackPosition;
        const playback = this.audioManager.snapshot?.playback;
        if (!playback) return 0;
        const position = playback.position || 0;
        if (!playback.playing || playback.pcmStalled || playback.scorePreparing || this.getCurrentState().isTransitioning) return position;
        const current = position + (performance.now() - this.audioManager.snapshotTime) / 1000 * (playback.speed || 1);
        return playback.duration > 0 ? Math.min(current, playback.duration) : current;
    }
    getMidiPresentation() {
        const snapshot = this.audioManager.snapshot?.playback;
        const timeline = snapshot?.source?.scoreUri ? this.midiTimeline : null;
        return { hasMidi: !!timeline, timeline, position: this.audioManager.getAudiblePlaybackPosition(this.midiPosition || 0),
            generation: this.midiGeneration, presentationEpoch: this.midiGeneration, sourceGeneration: this.presentedSourceKey,
            speed: snapshot?.speed || 1, playing: !!timeline && !!snapshot?.playing && !snapshot.scorePreparing,
            paused: !!timeline && !snapshot.playing, preparing: !!snapshot?.scorePreparing };
    }
    getVideoPresentation() { return { ...this.videoPresentation, contextTime: performance.now() / 1000 }; }
    resumePlaybackAudioContext() { return Promise.resolve(true); }
    async rebindCurrentPlayback() {
        // Android playback stays in the service when the Web audio graph changes.
        if (this.disconnected || this.liveTrackSelected) return;
        this.acceptPlayback(this.audioManager.snapshot);
        this.updateState({ currentTrackName: this.getDisplayTrackName(this.presentedTrack) }, 'Android playback presentation');
    }
    async prepareTrackSelection(track, isCurrent) { await this.resolveNativeSource(track); return isCurrent(); }
    async transitionToNextTrack(track, index, _userInitiated, preparedRequest, _automaticMovePlan, options) {
        await this.loadTrack(track, index, preparedRequest, options);
        options?.signal?.throwIfAborted();
        return this.play();
    }
    prepareNextTrackBufferWithRepeatMode() { return Promise.resolve(); }
    // The Service prepares the next track and keeps this setting across restarts.
    async applyGaplessPlaybackPreference(enabled) {
        const acceptGapless = snapshot => {
            this.audioManager.acceptSnapshot(snapshot);
            this.audioPlayer.gaplessPlayback = snapshot.gaplessPlayback;
        };
        try {
            acceptGapless(await this.bridge.request('audio.configure', { gaplessPlayback: enabled !== false }));
        } catch (error) {
            acceptGapless(await this.bridge.request('snapshot.get'));
            throw error;
        }
        return true;
    }
    applyPlaybackSpeed() {
        const state = this.getCurrentState();
        return this.command('speed', { speed: state.playbackSpeed, preservePitch: state.preservePitch }, 'speed');
    }
    applyPlaybackSpeedToElement() { return this.applyPlaybackSpeed(); }
    applyPlayerVolume() {
        return this.command('volume', { volume: this.playerVolume / 100, muted: this.playerMute }, 'volume', {
            playerVolume: this.playerVolume, playerMute: this.playerMute, volume: this.playerVolume, volumeMax: 100
        }).catch(error => {
            console.error('Android player volume failed:', error);
        });
    }
    disconnect() {
        this.disconnected = true;
        this.gainRefresh = Symbol(); this.detachSnapshot?.(); this.detachEnded?.();
        this.nativeLoadAbort?.abort();
        this.trackPresentationRequest = null;
        this.activeMetadataRequest = null;
        this.clearArtworkURL();
        void this.bridge.request('playback.close', {}).catch(error => console.error('Android player close failed:', error));
    }
}
