import { getSettingsStorage } from '../../settings-storage.js';
/**
 * PlaybackManager - Handles playlist management and playback control
 * Includes functionality for playback modes, state management, and keyboard shortcuts
 */
import {
  CatalogSequence,
  CompositeCatalogSequence,
  createPlaybackSourceResolutionScope,
  MaterializedSequence,
  MAX_MATERIALIZED_SEQUENCE_ITEMS,
  PendingTransportSlot,
  SequenceQueueProvider
} from './playback-sequence.js';
import { isValidPlaybackSpeed } from './playback-speed.js';
import { snapshotPlaybackSessionQueue } from './playback-session.js';

export class PlaybackManager {
  constructor(audioPlayer) {
    this.audioPlayer = audioPlayer;
    this.playlist = [];
    this.originalPlaylist = []; // For shuffle mode
    
    // Additional properties for seamless playback
    this.transitionInProgress = false;
    this.seamlessMode = audioPlayer?.gaplessPlayback !== false;
    this.keydownHandler = null;
    this.failedTrackSkipState = null;
    this.playRequestToken = 0;
    this.activePlayRequest = null;
    this.playbackEntryIds = new WeakMap();
    this.nextPlaybackEntryId = 0;
    this.nextEntryInstanceId = 0;
    this.sequence = new MaterializedSequence();
    this.catalogSequence = null;
    this.queueProvider = new SequenceQueueProvider(this.sequence);
    this.resolvedCatalogEntries = new Map();
    this.playbackGeneration = 0;
    this.trackCommandGeneration = 0;
    this.queueWindowRequestGeneration = 0;
    this.pendingTransport = new PendingTransportSlot();
    this.transportMediaChain = Promise.resolve();
    this.committedAutomaticMovePlans = new WeakSet();
    this.committedRegionTransportPlans = this.committedAutomaticMovePlans;
    this.activeBulkPlay = null;
    this.sessionTransportUndo = null;
    this.repeatModeNormalizer = null;
    this.queueChangeListener = null;
    this.sessionWriteBlocks = 0;
    this.sessionSaveSuppressions = 0;
    this.sessionMediaTrack = null;
    this.unloadedSessionTrack = null;
    this.activatingSessionTrack = false;
    this.explicitPlayerSettings = new Set();
    this.playerStateWrites = Promise.resolve();
    if (audioPlayer.playbackSession) {
      this.sessionPositionTimer = setInterval(() => {
        if (this.audioPlayer.stateManager.getStateSnapshot().isPlaying) this.savePlaybackSession();
      }, 10_000);
      this.sessionPositionTimer.unref?.();
    }
    
    // Initialize keyboard shortcuts
    this.initKeyboardShortcuts();
  }

  async runWithPlaybackPending(operation, priority = 2) {
    if (typeof operation !== 'function') throw new TypeError('Playback pending operation is required');
    const finishPending = this.audioPlayer.stateManager?.beginPlaybackPending?.(priority) ?? null;
    try {
      return await operation();
    } finally {
      finishPending?.();
    }
  }

  isPlaybackSessionWriteBlocked() {
    return this.sessionWriteBlocks > 0 || this.activatingSessionTrack ||
      ['building', 'cancel-requested'].includes(this.activeBulkPlay?.phase);
  }

  blockPlaybackSessionWrites({ suppress = false } = {}) {
    this.sessionWriteBlocks += 1;
    if (suppress) this.sessionSaveSuppressions += 1;
    return () => {
      this.sessionWriteBlocks -= 1;
      if (suppress) this.sessionSaveSuppressions -= 1;
      this.audioPlayer.playbackSession?.resume();
    };
  }

  savePlaybackSession(full = false, { committed = false } = {}) {
    if (!this.audioPlayer.playbackSession || (this.sessionSaveSuppressions && !committed) ||
        !this.sequence.itemCount) return;
    this.audioPlayer.playbackSession.request(this.audioPlayer, { full });
  }

  saveLocalTransportDuringMutation(committed, previousSequence = this.sequence) {
    if (committed && this.sessionSaveSuppressions) {
      this.savePlaybackSession(previousSequence !== this.sequence, { committed: true });
    }
  }

  removePlaybackSession() {
    globalThis.window?.uiManager?.invalidatePlaybackSessionRestore?.();
    return this.audioPlayer?.playbackSession?.remove();
  }

  observePlaybackSessionState(updates) {
    if (!this.audioPlayer.playbackSession || this.isPlaybackSessionWriteBlocked()) return;
    if ('currentTrack' in updates || 'isPlaying' in updates || 'isPaused' in updates || 'isStopped' in updates) {
      const active = this.audioPlayer.stateManager.getStateSnapshot();
      if (!active.liveInputActive) this.savePlaybackSession();
    }
  }

  notePlaybackSessionMediaTrack(track) {
    if (!this.audioPlayer.playbackSession) return;
    this.sessionMediaTrack = track;
    if (!this.activatingSessionTrack && !samePlaybackEntry(this.unloadedSessionTrack, track)) {
      this.unloadedSessionTrack = null;
    }
  }

  isUnloadedPlaybackSession(state) {
    return Boolean(!this.activatingSessionTrack && samePlaybackEntry(this.unloadedSessionTrack, state?.currentTrack));
  }

  capturePlaybackSession(full) {
    const active = this.audioPlayer.stateManager.getStateSnapshot();
    const ordinal = active.currentTrackIndex;
    if (active.liveInputActive || ordinal < 0 || ordinal >= this.sequence.itemCount) return null;
    const catalog = Boolean(this.catalogSequence);
    const selected = this.sequence.peekEntry?.(ordinal);
    const positionKnown = samePlaybackEntry(this.sessionMediaTrack, active.currentTrack) &&
      (samePlaybackEntry(selected, active.currentTrack) ||
        (catalog && samePlaybackEntry(this.resolvedCatalogEntries.get(ordinal), active.currentTrack)));
    const unloaded = this.isUnloadedPlaybackSession(active);
    const state = {
      kind: catalog ? 'catalog' : 'materialized',
      itemCount: this.sequence.itemCount,
      currentOrdinal: catalog ? this.sequence.toCanonicalOrdinal(ordinal) : ordinal,
      position: unloaded || positionKnown ? Math.max(0, active.currentTrackPosition || 0) : 0,
      duration: (unloaded || positionKnown) && Number.isFinite(active.currentTrackDuration) &&
        active.currentTrackDuration > 0 ? active.currentTrackDuration : null,
      repeatMode: active.repeatMode,
      shuffleMode: active.shuffleMode === true,
      shuffleState: catalog ? captureShuffleState(this.sequence) : null
    };
    return {
      state,
      ...(full ? { queue: snapshotPlaybackSessionQueue(this.sequence, this.playlist, this.originalPlaylist) } : {})
    };
  }

  installPlaybackSession(prepared) {
    const release = this.blockPlaybackSessionWrites();
    try {
      let { currentTrack } = prepared;
      if (prepared.sequence) {
        currentTrack = createResolvedSequenceTrack(currentTrack, null);
        this.installCatalogSequence(prepared.sequence, {
          currentOrdinal: prepared.currentOrdinal,
          currentTrack,
          resolvedEntries: new Map([[prepared.currentOrdinal, currentTrack]]),
          saveSession: false
        });
      } else {
        this.playlist = prepared.playlist.map(track => this.createTrackEntry(track));
        const tracks = new Map(prepared.playlist.map((track, index) => [track, this.playlist[index]]));
        this.originalPlaylist = prepared.originalPlaylist.map(track => this.createOriginalTrackEntry(tracks.get(track)));
        this.syncPlaylistState(prepared.currentOrdinal);
        currentTrack = this.playlist[prepared.currentOrdinal];
      }
      this.unloadedSessionTrack = currentTrack;
      this.audioPlayer.stateManager.updateState({
        currentTrack,
        currentTrackName: this.audioPlayer.contextManager.getDisplayTrackName?.(currentTrack) || currentTrack.name || '',
        currentTrackPosition: prepared.position ?? 0,
        currentTrackDuration: prepared.duration ?? 0,
        repeatMode: prepared.repeatMode,
        shuffleMode: prepared.shuffleMode,
        isPlaying: false,
        isPaused: true,
        isStopped: false,
        artworkUrl: ''
      }, 'Playback session restored');
    } finally {
      release();
    }
    this.savePlaybackSession(true, { committed: true });
  }

  cancelPlaybackPending() {
    this.audioPlayer?.stateManager?.cancelPlaybackPending?.();
  }
  
  /**
   * Load files into the playlist
   */
  loadFiles(files, append = false, insertAt = null, {
    deferInitialLoad = false,
    preserveSessionTransportUndo = false,
    saveSession = true
  } = {}) {
    if (!files || files.length === 0) {
      return;
    }
    if (append && this.audioPlayer.contextManager?.nativeQueueOwned) {
      return this.audioPlayer.contextManager.insertNativeQueue({ tracks: files,
        ...(Number.isInteger(insertAt) ? { index: insertAt } : {}) });
    }
    if (append) this.pendingTransport.invalidate();
    this.audioPlayer.contextManager?.clearNextTrackBuffer?.();
    
    if (!append) {
      if (!preserveSessionTransportUndo) this.sessionTransportUndo = null;
      this.deactivateCatalogSequence();
      this.playlist = [];
      this.originalPlaylist = [];
    } else if (this.catalogSequence) {
      throw new RangeError('Explicit entries cannot be appended to a query-backed sequence');
    }

    const newEntries = files
      .map(file => this.createTrackEntry(file))
      .filter(Boolean);

    if (newEntries.length === 0) {
      return;
    }
    if (this.playlist.length + newEntries.length > MAX_MATERIALIZED_SEQUENCE_ITEMS) {
      throw new RangeError(`Explicit queues are limited to ${MAX_MATERIALIZED_SEQUENCE_ITEMS} entries`);
    }

    this.clearFailedTrackSkipState();

    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const shuffleMode = state?.shuffleMode || false;
    const shouldInsert = append && Number.isInteger(insertAt);
    const currentIndex = Number.isInteger(state?.currentTrackIndex)
      ? state.currentTrackIndex
      : (this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0);
    let nextIndex = append ? currentIndex : 0;
    const originalEntries = newEntries.map(track => this.createOriginalTrackEntry(track));

    if (shouldInsert) {
      const playlistIndex = Math.max(0, Math.min(insertAt, this.playlist.length));
      this.playlist.splice(playlistIndex, 0, ...newEntries);
      const originalIndex = Math.max(0, Math.min(insertAt, this.originalPlaylist.length));
      this.originalPlaylist.splice(originalIndex, 0, ...originalEntries);
      if (playlistIndex <= currentIndex) {
        nextIndex = currentIndex + newEntries.length;
      }
    } else {
      this.playlist.push(...newEntries);
      this.originalPlaylist.push(...originalEntries);
    }
    
    if (shuffleMode && !append && !deferInitialLoad) {
      const isCurrentlyPlaying = state?.isPlaying || false;
      this.shufflePlaylistFromBeginning(isCurrentlyPlaying);
    }
    
    this.syncMaterializedSequence();
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updatePlaylist(this.playlist, nextIndex);
    }

    if (append && this.audioPlayer.contextManager) {
      // The pre-decoded next-track buffer may no longer match the track that
      // follows the current one (e.g. library 'Play Next' insert, or append
      // after the last track with repeat ALL). Drop it and re-prepare.
      this.audioPlayer.contextManager.prepareNextTrackBufferWithRepeatMode?.();
    }
    if (saveSession) this.savePlaybackSession(true, { committed: true });
  }

  replaceMaterializedPlaylist(files, currentIndex = 0, {
    applyShuffleMode = false,
    saveSession = true
  } = {}) {
    if (!Array.isArray(files)) throw new TypeError('Playlist entries must be an array');
    if (files.length > MAX_MATERIALIZED_SEQUENCE_ITEMS) {
      throw new RangeError(`Explicit queues are limited to ${MAX_MATERIALIZED_SEQUENCE_ITEMS} entries`);
    }

    this.invalidateActivePlayRequest();
    this.pendingTransport.invalidate();
    this.cancelPlaybackPending();
    this.trackCommandGeneration += 1;
    this.audioPlayer.contextManager?.invalidatePendingPlaybackOperations?.();

    if (files.length > 0) {
      this.loadFiles(files, false, null, { deferInitialLoad: true, saveSession: false });
      const nextIndex = Math.max(0, Math.min(currentIndex, this.playlist.length - 1));
      this.audioPlayer.stateManager?.updatePlaylist?.(this.playlist, nextIndex);
      if (applyShuffleMode) {
        this.enableShuffleModePreservingCurrentTrack(
          this.audioPlayer.stateManager?.getStateSnapshot?.()
        );
      }
      if (saveSession) this.savePlaybackSession(true, { committed: true });
      return;
    }

    this.sessionTransportUndo = null;
    this.clearFailedTrackSkipState();
    this.deactivateCatalogSequence();
    this.playlist = [];
    this.originalPlaylist = [];
    this.syncMaterializedSequence();
    this.audioPlayer.contextManager?.clearNextTrackBuffer?.();
    this.audioPlayer.stateManager?.updatePlaylist?.([], 0);
    if (saveSession) this.removePlaybackSession();
  }

  createTrackEntry(input) {
    if (typeof input === 'string') {
      const fileName = input.split(/[\\/]/).pop();
      return this.withImmutableEntryInstanceId({
        path: input,
        name: fileName,
        file: null
      });
    }

    if ((typeof File !== 'undefined' && input instanceof File) ||
        (typeof input?.androidUri === 'string' && typeof input.slice === 'function')) {
      return this.withImmutableEntryInstanceId({
        path: null,
        name: input.name,
        file: input,
        ...this.captureDroppedFilePath(input)
      });
    }

    if (input && typeof input === 'object') {
      const libraryTrackId = input.libraryTrackId ?? input.trackUid;
      const hasLibraryFields = input.provider || input.meta || libraryTrackId || input.path ||
        input.file || input.name || input.mediaSource || input.readBytes || input.bytes || input.data;
      if (!hasLibraryFields) return null;
      const metaTitle = input.meta?.title;
      const metaArtist = input.meta?.artist;
      const fallbackName = input.path ? input.path.split(/[\\/]/).pop() : 'Track';
      const track = {
        path: input.path || null,
        name: input.name || (metaArtist && metaTitle ? `${metaArtist} - ${metaTitle}` : (metaTitle || fallbackName)),
        file: input.file || null,
        ...(input.meta && { meta: input.meta }),
        ...(libraryTrackId && { libraryTrackId }),
        ...(input.provider && { provider: input.provider }),
        ...(input.sourceKind && { sourceKind: input.sourceKind }),
        ...(input.physicalSourceKey && { physicalSourceKey: input.physicalSourceKey }),
        ...(input.canonicalSourceKey && { canonicalSourceKey: input.canonicalSourceKey }),
        ...(input.sourceKey && { sourceKey: input.sourceKey })
      };
      for (const key of [
        'fileName',
        'uri',
        'headers',
        'byteLength',
        'fileSize',
        'mediaSource',
        'readBytes',
        'bytes',
        'data',
        'startFrame',
        'endFrame',
        'durationSec',
        'droppedFilePath'
      ]) {
        if (Object.prototype.hasOwnProperty.call(input, key)) track[key] = input[key];
      }
      if (!track.path && !libraryTrackId && track.file && !Object.hasOwn(track, 'droppedFilePath')) {
        Object.assign(track, this.captureDroppedFilePath(track.file));
      }
      return this.withImmutableEntryInstanceId(track, input.entryInstanceId);
    }

    return null;
  }

  captureDroppedFilePath(file) {
    if (!this.audioPlayer.playbackSession) return {};
    const api = globalThis.window?.electronAPI;
    if (!api?.getPathForFile) return {};
    try {
      return { droppedFilePath: api.getPathForFile(file) || null };
    } catch (error) {
      console.debug('The dropped file path could not be retained:', error);
      return { droppedFilePath: null };
    }
  }

  createOriginalTrackEntry(track) {
    const originalTrack = this.withImmutableEntryInstanceId({ ...track }, track.entryInstanceId);
    const entryId = this.getOrCreatePlaybackEntryId(track);
    this.playbackEntryIds.set(originalTrack, entryId);
    return originalTrack;
  }

  getOrCreatePlaybackEntryId(track) {
    const existingId = this.playbackEntryIds.get(track);
    if (Number.isSafeInteger(existingId) && existingId > 0) return existingId;
    const entryId = ++this.nextPlaybackEntryId;
    this.playbackEntryIds.set(track, entryId);
    return entryId;
  }

  withImmutableEntryInstanceId(track, requestedId = null) {
    const entryInstanceId = requestedId || `playback-entry-${(++this.nextEntryInstanceId).toString(36)}`;
    Object.defineProperty(track, 'entryInstanceId', {
      value: String(entryInstanceId),
      enumerable: true,
      configurable: false,
      writable: false
    });
    return track;
  }

  syncMaterializedSequence() {
    if (this.catalogSequence) return;
    this.sequence = new MaterializedSequence(this.playlist);
    this.queueProvider = new SequenceQueueProvider(this.sequence);
    this.queueChangeListener?.();
  }

  setQueueChangeListener(listener) {
    this.queueChangeListener = listener;
    return () => {
      if (this.queueChangeListener === listener) this.queueChangeListener = null;
    };
  }

  capturePlaybackQueueSnapshot() {
    if (this.catalogSequence) {
      const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
      const currentOrdinal = state?.currentTrackIndex ?? 0;
      return {
        kind: 'catalog',
        sequence: this.catalogSequence,
        shuffleState: captureShuffleState(this.catalogSequence),
        resolvedEntries: new Map(this.resolvedCatalogEntries),
        currentCanonicalOrdinal: this.catalogSequence.toCanonicalOrdinal(currentOrdinal),
        currentOrdinal,
        currentTrack: state?.currentTrack ?? null
      };
    }
    const captureEntries = entries => ({
      entries: entries.map(track => ({ ...track })),
      entryIds: entries.map(track => this.getOrCreatePlaybackEntryId(track))
    });
    const playlist = captureEntries(this.playlist);
    const originalPlaylist = captureEntries(this.originalPlaylist);
    return {
      playlist: playlist.entries,
      originalPlaylist: originalPlaylist.entries,
      playlistEntryIds: playlist.entryIds,
      originalPlaylistEntryIds: originalPlaylist.entryIds
    };
  }

  restorePlaybackQueueSnapshot(snapshot) {
    if (snapshot?.kind === 'catalog' &&
        (snapshot.sequence instanceof CatalogSequence ||
          snapshot.sequence instanceof CompositeCatalogSequence)) {
      snapshot.sequence.restoreShuffleState(snapshot.shuffleState);
      const currentOrdinal = snapshot.sequence.toTransportOrdinal(snapshot.currentCanonicalOrdinal);
      this.installCatalogSequence(snapshot.sequence, {
        currentOrdinal,
        currentTrack: snapshot.currentTrack,
        resolvedEntries: snapshot.resolvedEntries,
        preservePlaybackGeneration: true,
        saveSession: false
      });
      this.audioPlayer.stateManager?.updateState?.({
        currentTrackIndex: currentOrdinal,
        currentTrack: snapshot.currentTrack,
        shuffleMode: snapshot.shuffleState.enabled
      }, 'PlaybackManager catalog queue rollback');
      return true;
    }
    if (!Array.isArray(snapshot?.playlist) ||
        !Array.isArray(snapshot?.originalPlaylist)) {
      return false;
    }
    const restoreEntries = (entries, entryIds) => entries.map((track, index) => {
      const restoredTrack = this.withImmutableEntryInstanceId(
        { ...track },
        track.entryInstanceId || `playback-entry-${(++this.nextEntryInstanceId).toString(36)}`
      );
      const snapshotId = entryIds?.[index];
      const entryId = Number.isSafeInteger(snapshotId) && snapshotId > 0
        ? snapshotId
        : ++this.nextPlaybackEntryId;
      this.nextPlaybackEntryId = Math.max(this.nextPlaybackEntryId, entryId);
      this.playbackEntryIds.set(restoredTrack, entryId);
      return restoredTrack;
    });
    this.playlist = restoreEntries(snapshot.playlist, snapshot.playlistEntryIds);
    this.originalPlaylist = restoreEntries(
      snapshot.originalPlaylist,
      snapshot.originalPlaylistEntryIds
    );
    this.catalogSequence = null;
    this.syncMaterializedSequence();
    return true;
  }

  syncPlaylistState(currentIndex = 0) {
    this.syncMaterializedSequence();
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updatePlaylist(this.playlist, currentIndex);
    }
  }
  
  /**
   * Get track at specified index
   */
  getTrack(index) {
    if (this.catalogSequence) return this.resolvedCatalogEntries.get(index) ?? null;
    if (index >= 0 && index < this.playlist.length) {
      return this.playlist[index];
    }
    return null;
  }

  getTrackIndex(track, identityOnly = false) {
    const matches = candidate => candidate === track ||
      (!identityOnly && samePlaybackEntry(candidate, track));
    if (this.catalogSequence) {
      for (const [index, candidate] of this.resolvedCatalogEntries) {
        if (matches(candidate)) return index;
      }
      return -1;
    }
    return this.playlist.findIndex(matches);
  }

  getQueueProvider() {
    return this.queueProvider;
  }

  async preparePlannedAutomaticMove(currentTrack = null) {
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const context = this.captureAutomaticMoveContext(state);
    const { sequence, currentOrdinal, repeatMode } = context ?? {};
    if (!context || state.isStopped === true || !context.currentTrack ||
        !Number.isSafeInteger(currentOrdinal) || currentOrdinal < 0 ||
        currentOrdinal >= sequence.itemCount ||
        (currentTrack && !samePlaybackEntry(context.currentTrack, currentTrack))) {
      return null;
    }

    let nextOrdinal = repeatMode === 'ONE' ? currentOrdinal : currentOrdinal + 1;
    if (nextOrdinal >= sequence.itemCount) {
      if (repeatMode !== 'ALL') return null;
      if (context.shuffleMode) return null;
      nextOrdinal = 0;
    }

    let nextTrack;
    let rawNextTrack = null;
    if (this.catalogSequence) {
      const nextEntry = await sequence.getEntry(nextOrdinal);
      const source = await sequence.resolveEntrySource(
        nextEntry,
        createPlaybackSourceResolutionScope()
      );
      nextTrack = createResolvedSequenceTrack(nextEntry, source);
    } else {
      rawNextTrack = this.getTrack(nextOrdinal);
      if (!rawNextTrack) return null;
      nextTrack = rawNextTrack;
    }
    const plan = {
      ...context,
      nextOrdinal,
      rawNextTrack,
      nextTrack,
      preparedRequest: null
    };
    if (!this.isPlannedAutomaticMoveCurrent(plan)) return null;
    const contextManager = this.audioPlayer.contextManager;
    try {
      let playableTrack = contextManager?.resolveTrackProvider?.(nextTrack) ?? nextTrack;
      if (playableTrack instanceof Promise) playableTrack = await playableTrack;
      if (!this.isPlannedAutomaticMoveCurrent(plan)) return null;
      plan.nextTrack = playableTrack.presentationTrack ?? playableTrack;
      plan.preparedRequest = contextManager?.createPlaybackRequestSnapshot?.(playableTrack, nextOrdinal) ?? null;
      return Object.freeze(plan);
    } catch (error) {
      if (!this.isPlannedAutomaticMoveCurrent(plan)) return null;
      if (error?.code === 'alacRequiresMacDesktop') {
        contextManager?.reportPlaybackSourceFailure?.(error);
        return null;
      }
      throw error;
    }
  }

  isPlannedAutomaticMoveCurrent(plan) {
    return this.getAutomaticMoveStaleReason(plan) === null;
  }

  // The transport facts an automatic move depends on. A plan carries the
  // capture taken when it was prepared and stays valid while a fresh capture
  // still matches it.
  captureAutomaticMoveContext(state = this.audioPlayer.stateManager?.getStateSnapshot?.()) {
    if (!state || !this.sequence) return null;
    return {
      sequence: this.sequence,
      playbackGeneration: this.playbackGeneration,
      transportCommandGeneration: state.transportCommandGeneration ?? 0,
      currentOrdinal: state.currentTrackIndex,
      currentTrack: state.currentTrack ?? null,
      repeatMode: state.repeatMode ?? 'OFF',
      shuffleMode: state.shuffleMode === true || this.catalogSequence?.shuffleEnabled === true,
      shuffleState: captureShuffleState(this.sequence)
    };
  }

  // Returns null while the plan still describes the current transport,
  // otherwise the first check it fails (for developer diagnostics).
  getAutomaticMoveStaleReason(plan) {
    if (!plan) return 'no-plan';
    if (this.committedAutomaticMovePlans.has(plan)) return 'committed';
    const context = this.captureAutomaticMoveContext();
    if (!context) return 'no-state';
    if (plan.sequence !== context.sequence) return 'sequence';
    if (plan.playbackGeneration !== context.playbackGeneration) return 'playback-generation';
    if (plan.currentOrdinal !== context.currentOrdinal) return 'current-ordinal';
    if (plan.transportCommandGeneration !== context.transportCommandGeneration) return 'transport-command';
    if (plan.repeatMode !== context.repeatMode) return 'repeat-mode';
    if (plan.shuffleMode !== context.shuffleMode ||
        !sameShuffleState(plan.shuffleState, context.shuffleState)) return 'shuffle';
    if (!samePlaybackEntry(context.currentTrack, plan.currentTrack)) return 'current-track';
    // A catalog sequence is an immutable snapshot: with the same sequence and
    // shuffle state, nextOrdinal still names the planned entry, whether or not
    // its page is still cached. A materialized playlist can be edited in place,
    // so its entry is compared directly.
    if (!this.catalogSequence && this.getTrack(plan.nextOrdinal) !== plan.rawNextTrack) return 'next-track';
    return null;
  }

  commitPlannedAutomaticMove(plan, backendStatePatch = {}) {
    if (!this.isPlannedAutomaticMoveCurrent(plan)) return false;
    this.committedAutomaticMovePlans.add(plan);
    this.pendingTransport.invalidate();
    this.trackCommandGeneration += 1;

    const track = plan.nextTrack;
    if (this.catalogSequence) {
      this.resolvedCatalogEntries.clear();
      this.resolvedCatalogEntries.set(plan.nextOrdinal, track);
    }
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.() ?? {};
    const commandGeneration = (state.transportCommandGeneration ?? 0) + 1;
    const currentTrackName = this.audioPlayer.contextManager?.getDisplayTrackName?.(track) || track?.name || '';
    this.notePlaybackSessionMediaTrack(track);
    this.audioPlayer.stateManager?.updateState?.({
      currentTrackIndex: plan.nextOrdinal,
      currentTrack: track,
      currentTrackName,
      currentTrackDuration: backendStatePatch.currentTrackDuration ?? 0,
      currentTrackPosition: backendStatePatch.currentTrackPosition ?? 0,
      playbackMode: backendStatePatch.playbackMode ?? state.playbackMode ?? 'audioElement',
      isPlaying: true,
      isPaused: false,
      isStopped: false,
      isTransitioning: false,
      transitionType: null,
      transportCommandGeneration: commandGeneration,
      lastTransportCommand: { type: 'transportNext' },
      ...backendStatePatch,
      ...(this.catalogSequence ? {
        playlistLength: this.catalogSequence.itemCount,
        sequenceKind: 'catalog',
        sequenceId: this.catalogSequence.sequenceId,
        playbackGeneration: this.playbackGeneration
      } : {})
    }, 'PlaybackManager planned automatic move');
    if (this.catalogSequence) void this.refreshCatalogQueueWindow(plan.nextOrdinal);
    return true;
  }

  preparePlannedRegionMove(currentTrack = null) {
    return this.preparePlannedAutomaticMove(currentTrack);
  }

  isPlannedRegionMoveCurrent(plan) {
    return this.isPlannedAutomaticMoveCurrent(plan);
  }

  commitPlannedRegionMove(plan, { position = 0, duration = 0 } = {}) {
    return this.commitPlannedAutomaticMove(plan, {
      currentTrackPosition: position,
      currentTrackDuration: duration,
      playbackMode: 'audioElement'
    });
  }

  async loadCatalogSequence(descriptor, {
    currentOrdinal = 0,
    autoPlay = false,
    userInitiated = true,
    preservePlayback = false,
    preservePlaybackGeneration = false,
    resolutionScope = null,
    resolvedEntries = null,
    saveSession = true
  } = {}) {
    this.pendingTransport.invalidate();
    this.trackCommandGeneration += 1;
    this.catalogSequence?.clear();
    const sequence = descriptor instanceof CatalogSequence || descriptor instanceof CompositeCatalogSequence
      ? descriptor
      : new CatalogSequence(descriptor);
    if (preservePlayback && this.audioPlayer.contextManager?.nativeQueueOwned) {
      return this.audioPlayer.contextManager.replaceNativeQueue({ sequence, index: currentOrdinal, preservePlayback: true });
    }
    const currentTrack = preservePlayback
      ? this.audioPlayer.stateManager?.getStateSnapshot?.().currentTrack ?? null
      : null;
    this.installCatalogSequence(sequence, {
      currentOrdinal,
      currentTrack,
      resolvedEntries,
      preservePlaybackGeneration,
      saveSession
    });
    if (preservePlayback) {
      this.audioPlayer.contextManager?.refreshActiveRegionTransportPlan?.();
      return { accepted: true, preserved: true };
    }
    return this.selectSequenceOrdinal(currentOrdinal, {
      play: autoPlay,
      userInitiated,
      resolutionScope,
      skipUnavailable: true
    });
  }

  installCatalogSequence(sequence, {
    currentOrdinal = 0,
    currentTrack = null,
    resolvedEntries = null,
    preservePlaybackGeneration = false,
    saveSession = true
  } = {}) {
    this.catalogSequence = sequence;
    this.sequence = sequence;
    this.queueProvider = new SequenceQueueProvider(sequence);
    this.resolvedCatalogEntries = resolvedEntries instanceof Map
      ? new Map(resolvedEntries)
      : new Map();
    this.playlist = createCatalogPlaylistFacade(sequence, this.resolvedCatalogEntries);
    this.originalPlaylist = [];
    if (!preservePlaybackGeneration) this.playbackGeneration += 1;
    this.audioPlayer.stateManager?.updateCatalogSequence?.({
      sequenceId: sequence.sequenceId,
      itemCount: sequence.itemCount,
      currentOrdinal,
      currentTrack,
      playbackGeneration: this.playbackGeneration
    });
    void this.refreshCatalogQueueWindow(currentOrdinal);
    this.queueChangeListener?.();
    if (saveSession) this.savePlaybackSession(true, { committed: true });
  }

  async refreshCatalogQueueWindow(centerOrdinal = this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0) {
    if (!this.catalogSequence) return null;
    const sequence = this.catalogSequence;
    const requestGeneration = ++this.queueWindowRequestGeneration;
    const window = await this.queueProvider.getWindow(centerOrdinal);
    const currentOrdinal = this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0;
    if (sequence !== this.catalogSequence ||
        requestGeneration !== this.queueWindowRequestGeneration ||
        currentOrdinal !== centerOrdinal) return null;
    this.audioPlayer.stateManager?.updateQueueWindow?.(window);
    return window;
  }

  async refreshCatalogQueuePage(startOrdinal) {
    if (!this.catalogSequence) return null;
    const sequence = this.catalogSequence;
    const requestGeneration = ++this.queueWindowRequestGeneration;
    const window = await this.queueProvider.getPage(startOrdinal);
    if (sequence !== this.catalogSequence || requestGeneration !== this.queueWindowRequestGeneration) return null;
    this.audioPlayer.stateManager?.updateQueueWindow?.(window);
    return window;
  }

  getActiveSequenceDescriptor() {
    const descriptor = this.queueProvider.getActiveSequenceDescriptor();
    return Object.freeze({
      ...descriptor,
      currentOrdinal: this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0,
      playbackGeneration: this.playbackGeneration
    });
  }

  async selectQueueOrdinal(ordinal, {
    play = true,
    userInitiated = true,
    preserveQueueWindow = false,
    skipUnavailable = false,
    playbackReady = null,
    isCurrent = () => true
  } = {}) {
    if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= this.sequence.itemCount) {
      return { accepted: false, reason: 'invalid-ordinal' };
    }

    const result = await this.selectSequenceOrdinal(ordinal, {
      play,
      userInitiated,
      preserveQueueWindow,
      skipUnavailable,
      playbackReady,
      isCurrent
    });
    this.saveLocalTransportDuringMutation(userInitiated && result?.accepted === true);
    return result;
  }

  async #activateQueueTrack(track, ordinal, {
    play,
    userInitiated,
    reason,
    resumePaused,
    isCurrent = () => true,
    state = this.audioPlayer.stateManager?.getStateSnapshot?.()
  }) {
    const contextManager = this.audioPlayer.contextManager;
    if (play && state?.isPlaying && contextManager?.transitionToNextTrack) {
      return contextManager.transitionToNextTrack(track, ordinal, userInitiated);
    }
    if (!contextManager?.loadTrack) return false;

    const resumePosition = resumePaused && this.#isCurrentTrackPaused(state, ordinal) &&
      samePlaybackEntry(track, state.currentTrack) ? state.currentTrackPosition : 0;
    const unloaded = this.isUnloadedPlaybackSession(state) && samePlaybackEntry(track, state.currentTrack);
    if (unloaded) this.activatingSessionTrack = true;
    let activated = false;
    try {
      const loaded = await contextManager.loadTrack(track, ordinal, null, { preserveVideoTail: reason === 'ended' });
      if (!isCurrent()) return false;
      if (play && loaded !== false && contextManager.play) {
        if (Number.isFinite(resumePosition) && resumePosition > 0) {
          await contextManager.seek(resumePosition, { saveSession: false });
          if (!isCurrent()) return false;
        }
        activated = await contextManager.play(false, userInitiated, isCurrent);
        return activated;
      }
      activated = loaded;
      return loaded;
    } finally {
      if (unloaded) {
        if (activated !== false && isCurrent()) {
          this.unloadedSessionTrack = null;
        } else if (isCurrent()) {
          this.audioPlayer.stateManager?.updateState?.({
            currentTrack: state.currentTrack,
            currentTrackPosition: state.currentTrackPosition,
            currentTrackDuration: state.currentTrackDuration,
            isPlaying: false,
            isPaused: state.isPaused,
            isStopped: state.isStopped,
            playbackMode: state.playbackMode
          }, 'Restored track still awaiting playback');
        }
        this.activatingSessionTrack = false;
        this.audioPlayer.playbackSession?.resume();
        if (activated !== false && isCurrent()) this.savePlaybackSession(false, { committed: userInitiated });
      }
    }
  }

  async selectSequenceOrdinal(ordinal, options = {}) {
    const priority = options.reason === 'ended' ? 1 : 2;
    return this.runWithPlaybackPending(
      () => this.#selectSequenceOrdinal(ordinal, options),
      priority
    );
  }

  async #selectSequenceOrdinal(ordinal, {
    play = true,
    userInitiated = true,
    commandKind = 'select',
    reason = userInitiated ? 'explicit' : 'ended',
    transportRollback = null,
    preserveQueueWindow = false,
    resolutionScope = createPlaybackSourceResolutionScope(),
    skipUnavailable = false,
    playbackReady = null,
    resumePaused = false,
    isCurrent = () => true
  } = {}) {
    const sequence = this.sequence;
    if (!sequence) return { accepted: false, reason: 'no-sequence' };
    const activeResolutionScope = resolutionScope ?? createPlaybackSourceResolutionScope();
    const readiness = playbackReady ?? (play && userInitiated
      ? this.audioPlayer.resumeAudioContextInGesture?.() ?? true
      : true);
    this.trackCommandGeneration += 1;
    if (reason === 'explicit') {
      this.audioPlayer.contextManager?.cancelVideoNaturalEnd?.();
      this.audioPlayer.contextManager?.invalidateAutomaticMoveForManualCommand?.();
    }
    const transportCommandType = commandKind === 'next'
      ? 'transportNext'
      : (commandKind === 'previous' ? 'transportPrevious' : 'transportSelect');
    this.audioPlayer.stateManager?.applyTransportCommand?.({
      type: transportCommandType,
      ...(transportCommandType === 'transportSelect' ? { ordinal } : {})
    });
    const repeatMode = this.audioPlayer.stateManager?.getStateSnapshot?.().repeatMode ?? 'OFF';
    const direction = commandKind === 'previous' ? -1 : 1;
    const attemptedOrdinals = new Set();
    const failures = [];
    let candidateOrdinal = ordinal;

    while (
      Number.isSafeInteger(candidateOrdinal) &&
      candidateOrdinal >= 0 &&
      candidateOrdinal < sequence.itemCount &&
      attemptedOrdinals.size < sequence.itemCount &&
      !attemptedOrdinals.has(candidateOrdinal)
    ) {
      attemptedOrdinals.add(candidateOrdinal);
      const result = await this.#selectSequenceOrdinalOnce(candidateOrdinal, {
        play,
        userInitiated,
        commandKind,
        reason,
        resumePaused,
        transportRollback,
        preserveQueueWindow,
        resolutionScope: activeResolutionScope,
        playbackReady: readiness,
        isRequestCurrent: isCurrent
      });
      if (result.accepted) {
        if (failures.length > 0) this.#reportSkippedTracks(failures, sequence);
        return failures.length > 0 ? { ...result, skippedCount: failures.length } : result;
      }
      if (!['source-unavailable', 'media-load-failed'].includes(result.reason)) return result;
      if (result.error?.code === 'alacRequiresMacDesktop') return result;
      if (!skipUnavailable) {
        if (userInitiated) {
          globalThis.window?.uiManager?.setError?.('error.playbackCommandFailed', true);
        }
        return result;
      }
      failures.push({ ordinal: candidateOrdinal, reason: result.reason, error: result.error });
      candidateOrdinal = nextSequenceCandidateOrdinal({
        currentOrdinal: candidateOrdinal,
        direction,
        itemCount: sequence.itemCount,
        wrap: repeatMode === 'ALL'
      });
    }

    if (failures.length > 0) this.#reportSkippedTracks(failures, sequence);
    await this.stopAfterFailedTrackSkipExhausted();
    return { accepted: false, reason: 'no-playable-track', skippedCount: failures.length };
  }

  async #selectSequenceOrdinalOnce(ordinal, {
    play,
    userInitiated,
    commandKind,
    reason,
    resumePaused,
    transportRollback,
    preserveQueueWindow,
    resolutionScope,
    playbackReady,
    isRequestCurrent
  }) {
    const sequence = this.sequence;
    if (!sequence) return { accepted: false, reason: 'no-sequence' };
    const stateBeforeResolution = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const sourceEntryInstanceId = stateBeforeResolution?.currentTrack?.entryInstanceId ?? null;
    const result = await this.pendingTransport.run({
      kind: commandKind,
      playbackGeneration: this.playbackGeneration,
      sourceEntryInstanceId,
      reason
    }, async ({ isCurrent, signal }) => {
      let ready = true;
      try {
        ready = await playbackReady;
      } catch (_) {
        ready = false;
      }
      if (!isCurrent() || !isRequestCurrent() || sequence !== this.sequence) return { committed: false };
      if (play && ready === false) return { committed: false, resumeFailed: true };
      const entry = await sequence.getEntry(ordinal);
      if (!isCurrent() || !isRequestCurrent() || sequence !== this.sequence) return { committed: false };
      try {
        const source = await sequence.resolveEntrySource(entry, resolutionScope, signal);
        if (!isCurrent() || !isRequestCurrent() || sequence !== this.sequence) return { committed: false };
        return { committed: true, entry, source, play };
      } catch (error) {
        if (!isCurrent() || !isRequestCurrent() || sequence !== this.sequence) return { committed: false };
        return { committed: false, unavailable: true, error };
      }
    });
    if (!result.accepted) {
      this.audioPlayer.contextManager?.invalidatePendingTransitionRequests?.();
      return result;
    }
    const resolution = result.value;
    if (resolution?.unavailable) {
      return { accepted: false, reason: 'source-unavailable', error: resolution.error };
    }
    if (resolution?.resumeFailed) return { accepted: false, reason: 'audio-resume-failed' };
    if (!resolution?.committed) return { accepted: false, reason: 'stale' };
    const isCurrent = () => this.pendingTransport.isGenerationCurrent(result.generation) &&
      sequence === this.sequence && isRequestCurrent();
    const mediaOperation = async () => {
      if (!isCurrent()) {
        return { accepted: false, reason: 'stale' };
      }
      const track = createResolvedSequenceTrack(resolution.entry, resolution.source);
      const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
      const previousOrdinal = state?.currentTrackIndex ?? 0;
      const previousTrack = state?.currentTrack ?? this.resolvedCatalogEntries.get(previousOrdinal) ?? null;
      const changedTransport = previousOrdinal !== ordinal || Boolean(transportRollback?.shuffleChanged);
      let played = true;
      try {
        played = await this.#activateQueueTrack(track, ordinal, {
          play: resolution.play,
          userInitiated,
          reason,
          resumePaused,
          isCurrent,
          state
        });
      } catch (error) {
        if (changedTransport && sequence === this.catalogSequence) {
          await this.#compensateCatalogTransport({
            sequence,
            ordinal: previousOrdinal,
            track: previousTrack,
            state,
            transportRollback,
            restoreShuffleState: false
          });
        } else if (sequence === this.catalogSequence) {
          this.#restoreCatalogTrackState(previousOrdinal, previousTrack, state);
        }
        return { accepted: false, reason: 'media-load-failed', error };
      }
      if (
        played === false ||
        !this.pendingTransport.isGenerationCurrent(result.generation) ||
        sequence !== this.sequence
      ) {
        const commandIsCurrent = this.pendingTransport.isGenerationCurrent(result.generation) &&
          sequence === this.sequence;
        if (changedTransport && sequence === this.catalogSequence) {
          await this.#compensateCatalogTransport({
            sequence,
            ordinal: previousOrdinal,
            track: previousTrack,
            state,
            transportRollback,
            restoreShuffleState: false
          });
        } else if (played === false && sequence === this.catalogSequence) {
          this.#restoreCatalogTrackState(previousOrdinal, previousTrack, state);
        }
        return { accepted: false, reason: commandIsCurrent ? 'media-load-failed' : 'stale' };
      }
      if (sequence === this.catalogSequence) {
        await this.#commitCatalogTrack(ordinal, track);
        if (!preserveQueueWindow) void this.refreshCatalogQueueWindow(ordinal);
      }
      return { accepted: true, value: { committed: true, entry: track } };
    };
    const committed = this.transportMediaChain.then(mediaOperation, mediaOperation);
    this.transportMediaChain = committed.catch(() => {});
    return committed;
  }

  async transportNext(userInitiated = true, options = {}) {
    if (!this.catalogSequence) {
      return this.playNext(userInitiated, { ...options, materializedOnly: true });
    }
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const currentOrdinal = state?.currentTrackIndex ?? 0;
    const repeatMode = options.ignoreRepeatOne === true
      ? 'OFF'
      : manualRepeatMode(state?.repeatMode, userInitiated);
    const sequence = this.catalogSequence;
    const previousShuffleState = captureShuffleState(sequence);
    const nextOrdinal = sequence.moveTransportOrdinal(currentOrdinal, 1, repeatMode);
    const transportRollback = createTransportRollback(sequence, previousShuffleState);
    if (nextOrdinal === null) {
      if (options.reason !== 'ended') return { accepted: false, reason: 'end' };
      try {
        const result = await this.selectSequenceOrdinal(0, {
          play: false,
          userInitiated: false,
          commandKind: 'ended-reset',
          reason: 'ended',
          transportRollback,
          skipUnavailable: true
        });
        if (!result.accepted) {
          restorePlannedShuffle(sequence, transportRollback);
          return result;
        }
        await this.audioPlayer.contextManager?.stop?.({ preserveVideoTail: true,
        ...(state?.playbackMode === 'midi' ? { preserveMidiTail: true } : {}) });
        return { ...result, stoppedAtEnd: true };
      } catch (error) {
        restorePlannedShuffle(sequence, transportRollback);
        throw error;
      }
    }
    try {
      const result = await this.selectSequenceOrdinal(nextOrdinal, {
        play: true,
        userInitiated,
        commandKind: 'next',
        reason: options.reason ?? (userInitiated ? 'explicit' : 'ended'),
        transportRollback,
        skipUnavailable: true
      });
      if (!result.accepted) restorePlannedShuffle(sequence, transportRollback);
      return result;
    } catch (error) {
      restorePlannedShuffle(sequence, transportRollback);
      throw error;
    }
  }

  async transportPrevious(userInitiated = true) {
    if (!this.catalogSequence) {
      return this.playPrevious(userInitiated, { materializedOnly: true });
    }
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const currentOrdinal = state?.currentTrackIndex ?? 0;
    const sequence = this.catalogSequence;
    const previousShuffleState = captureShuffleState(sequence);
    const previousOrdinal = sequence.moveTransportOrdinal(
      currentOrdinal,
      -1,
      manualRepeatMode(state?.repeatMode, true)
    );
    const transportRollback = createTransportRollback(sequence, previousShuffleState);
    if (previousOrdinal === null) {
      return this.selectSequenceOrdinal(currentOrdinal, {
        play: true,
        userInitiated,
        commandKind: 'previous',
        reason: 'explicit',
        transportRollback,
        skipUnavailable: true
      });
    }
    try {
      const result = await this.selectSequenceOrdinal(previousOrdinal, {
        play: true,
        userInitiated,
        commandKind: 'previous',
        reason: 'explicit',
        transportRollback,
        skipUnavailable: true
      });
      if (!result.accepted) restorePlannedShuffle(sequence, transportRollback);
      return result;
    } catch (error) {
      restorePlannedShuffle(sequence, transportRollback);
      throw error;
    }
  }

  async recoverCatalogTrackLoadFailure(error, failedOrdinal) {
    if (!this.catalogSequence) return { accepted: false, reason: 'not-catalog' };
    const currentOrdinal = this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0;
    const ordinal = Number.isSafeInteger(failedOrdinal) ? failedOrdinal : currentOrdinal;
    // A prepared next that failed before it committed leaves the ended track
    // current. Moving next loads it again through the normal path, which
    // reports and skips it only if that load fails too.
    if (ordinal === currentOrdinal) {
      this.#reportSkippedTracks([{
        ordinal,
        reason: 'media-load-failed',
        error
      }], this.catalogSequence);
    }
    try {
      return await this.transportNext(false, {
        reason: 'ended',
        ignoreRepeatOne: true
      });
    } catch (recoveryError) {
      console.error('[PlaybackManager] Catalog load failure recovery failed:', recoveryError);
      await this.stopAfterFailedTrackSkipExhausted();
      globalThis.window?.uiManager?.setError?.('error.playbackCommandFailed', true);
      return { accepted: false, reason: 'recovery-failed' };
    }
  }

  contextPlayNext(selectionDescriptor, {
    service = this.audioPlayer.libraryOperationService,
    target = null,
    options = {}
  } = {}) {
    this.audioPlayer.stateManager?.applyContextCommand?.({
      type: 'contextPlayNext',
      selectionDescriptor
    });
    if (typeof service?.start !== 'function') {
      return Promise.reject(operationError('operationUnavailable', 'Library Play Next service is unavailable'));
    }
    return service.start({
      operationKind: 'playNext',
      selectionDescriptor,
      target,
      options
    });
  }

  async startBulkPlay(options = {}) {
    return this.runWithPlaybackPending(() => this.#startBulkPlay(options), 3);
  }

  async #startBulkPlay({
    selectionDescriptor,
    provisionalEntry,
    service = this.audioPlayer.libraryOperationService,
    options = {}
  } = {}) {
    if (this.activeBulkPlay && this.activeBulkPlay.phase !== 'terminal') {
      throw operationError('busy', 'A bulk Play operation is already active');
    }
    if (typeof service?.start !== 'function') {
      throw operationError('operationUnavailable', 'Bulk Play service is unavailable');
    }
    const receipt = await service.start({
      operationKind: 'play',
      selectionDescriptor,
      target: null,
      options
    });
    const entry = receipt?.provisionalEntry ?? provisionalEntry;
    if (!entry) throw operationError('invalidOperationResult', 'Bulk Play did not provide a provisional entry');
    return this.installBulkPlayProvisional({
      receipt: { ...receipt, provisionalEntry: entry },
      service,
      resolveSource: async provisional => ({
        path: provisional.path,
        file: provisional.file,
        provider: provisional.provider
      })
    });
  }

  async installBulkPlayProvisional(options = {}) {
    return this.runWithPlaybackPending(() => {
      const pending = this.#installBulkPlayProvisional(options);
      if (!options.signal) return pending;
      return new Promise((resolve, reject) => {
        const onAbort = () => {
          void this.cancelBulkPlay(options.receipt?.operationId)
            .catch(error => console.warn('Unable to restore cancelled playback.', error));
          reject(options.signal.reason);
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
        if (options.signal.aborted) onAbort();
        pending.then(resolve, reject).finally(() => options.signal.removeEventListener('abort', onAbort));
      });
    }, 3);
  }

  async #installBulkPlayProvisional({
    receipt,
    service,
    resolveSource,
    signal,
    onStage,
    resolutionScope = createPlaybackSourceResolutionScope()
  } = {}) {
    if (signal?.aborted) throw signal.reason;
    const entry = receipt?.provisionalEntry;
    const trackUid = entry?.trackUid ?? entry?.libraryTrackId;
    if (!entry?.entryInstanceId || !trackUid) {
      throw operationError('invalidOperationResult', 'Bulk Play provisional entry is invalid');
    }
    if (typeof resolveSource !== 'function') {
      throw operationError('sourceUnavailable', 'Bulk Play source resolver is unavailable');
    }
    const previousSessionState = this.#captureSessionPlaybackState();
    const playbackGeneration = ++this.playbackGeneration;
    const operation = {
      operationId: receipt.operationId,
      phase: 'building',
      service,
      playbackGeneration,
      provisionalEntryInstanceId: entry.entryInstanceId,
      provisionalInstalled: false,
      provisionalLoaded: false,
      resolutionScope,
      previousSessionState
    };
    this.activeBulkPlay = operation;
    let resolution;
    try {
      onStage?.('sourceResolve');
      resolution = await this.pendingTransport.run({
        kind: 'play-replace',
        playbackGeneration,
        sourceEntryInstanceId: entry.entryInstanceId,
        reason: 'explicit',
        priority: 3
      }, async ({ isCurrent, signal }) => {
        const source = await resolveSource(entry, resolutionScope, signal);
        return isCurrent() ? source : null;
      });
    } catch (error) {
      if (operation !== this.activeBulkPlay || playbackGeneration !== this.playbackGeneration) {
        return { accepted: false, reason: 'stale' };
      }
      throw error;
    }
    if (!resolution.accepted || !resolution.value || playbackGeneration !== this.playbackGeneration) {
      return { accepted: false, reason: resolution.reason ?? 'stale' };
    }
    const provisionalEntry = {
      ...entry,
      trackUid,
      sequenceId: `provisional:${receipt.operationId}`,
      canonicalOrdinal: 0,
      transportOrdinal: 0
    };
    const provisionalTrack = createResolvedSequenceTrack(provisionalEntry, resolution.value);
    this.loadFiles([provisionalTrack], false, null, {
      deferInitialLoad: true,
      preserveSessionTransportUndo: true,
      saveSession: false
    });
    operation.provisionalInstalled = true;
    const loadedTrack = this.playlist[0];
    const mediaOperation = async () => {
      if (
        playbackGeneration !== this.playbackGeneration
      ) {
        return false;
      }
      return this.audioPlayer.contextManager?.seamlessTransition?.(loadedTrack, 0, true, {
        signal,
        onStage,
        throwOnError: true
      });
    };
    const mediaPromise = this.transportMediaChain.then(mediaOperation, mediaOperation);
    this.transportMediaChain = mediaPromise.catch(() => {});
    const played = await mediaPromise;
    if (played === false || playbackGeneration !== this.playbackGeneration) {
      return { accepted: false, reason: 'stale' };
    }
    this.audioPlayer.stateManager?.updateState?.({
      playbackGeneration
    }, 'PlaybackManager bulk Play provisional');
    operation.provisionalLoaded = true;
    operation.provisionalEntryInstanceId = loadedTrack.entryInstanceId;
    return {
      accepted: true,
      operationId: receipt.operationId,
      playbackGeneration
    };
  }

  async publishBulkPlaySequence({
    operationId,
    sequence,
    currentOrdinal = 0,
    firstEntry = null
  } = {}) {
    const operation = this.activeBulkPlay;
    if (!operation || operation.operationId !== operationId ||
        !['building', 'cancel-requested'].includes(operation.phase)) {
      return { accepted: false, reason: 'stale' };
    }
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const position = state?.currentTrackPosition ?? 0;
    const currentTrack = state?.currentTrack ?? this.playlist[0] ?? null;
    const publishedSequence = sequence instanceof CatalogSequence || sequence instanceof CompositeCatalogSequence
      ? sequence
      : new CatalogSequence(sequence);
    const publishedCurrentEntry = firstEntry ?? await publishedSequence.getEntry(currentOrdinal);
    if (publishedCurrentEntry.entryInstanceId !== operation.provisionalEntryInstanceId) {
      throw operationError('stalePlaybackEntry', 'Published sequence no longer matches the provisional track');
    }
    if (!operation.provisionalLoaded) return { accepted: false, reason: 'playbackStartFailed' };
    await this.loadCatalogSequence(publishedSequence, {
      currentOrdinal,
      preservePlayback: true,
      preservePlaybackGeneration: true,
      saveSession: false
    });
    if (operation !== this.activeBulkPlay || operation.playbackGeneration !== this.playbackGeneration) {
      return { accepted: false, reason: 'stale' };
    }
    this.audioPlayer.stateManager?.updateState?.({
      currentTrack,
      currentTrackPosition: position,
      playbackGeneration: this.playbackGeneration
    }, 'PlaybackManager bulk Play publish');
    operation.phase = 'published';
    this.sessionTransportUndo = operation.previousSessionState;
    operation.previousSessionState = null;
    this.savePlaybackSession(true, { committed: true });
    return { accepted: true, phase: 'published' };
  }

  async commitCatalogDestination({
    operationId,
    operationKind,
    sequence,
    currentOrdinal: requestedOrdinal = 0,
    firstEntry = null
  } = {}) {
    if (!(sequence instanceof CatalogSequence) && !(sequence instanceof CompositeCatalogSequence)) {
      throw operationError('invalidOperationResult', 'Catalog operation sequence is invalid');
    }
    if (operationKind === 'play') {
      return this.publishBulkPlaySequence({
        operationId,
        sequence,
        currentOrdinal: requestedOrdinal,
        firstEntry
      });
    }
    if (operationKind !== 'playNext' && operationKind !== 'queue') {
      throw operationError('invalidOperationResult', 'Playback destination is invalid');
    }
    if (this.audioPlayer.contextManager?.nativeQueueOwned && this.audioPlayer.stateManager.getStateSnapshot().playlistLength) {
      const state = this.audioPlayer.stateManager.getStateSnapshot();
      return this.audioPlayer.contextManager.insertNativeQueue({ sequence,
        index: operationKind === 'playNext' ? state.currentTrackIndex + 1 : state.playlistLength });
    }
    const currentSequence = this.catalogSequence ?? this.sequence;
    if (!currentSequence?.itemCount) {
      await this.loadCatalogSequence(sequence, { currentOrdinal: 0, autoPlay: false });
      return { accepted: true };
    }
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const currentOrdinal = Math.max(0, Math.min(
      state?.currentTrackIndex ?? 0,
      currentSequence.itemCount - 1
    ));
    const segments = [];
    if (operationKind === 'playNext') {
      segments.push({ sequence: currentSequence, startOrdinal: 0, itemCount: currentOrdinal + 1 });
      segments.push({ sequence, startOrdinal: 0, itemCount: sequence.itemCount });
      const tailCount = currentSequence.itemCount - currentOrdinal - 1;
      if (tailCount > 0) {
        segments.push({ sequence: currentSequence, startOrdinal: currentOrdinal + 1, itemCount: tailCount });
      }
    } else {
      segments.push({ sequence: currentSequence, startOrdinal: 0, itemCount: currentSequence.itemCount });
      segments.push({ sequence, startOrdinal: 0, itemCount: sequence.itemCount });
    }
    const composite = new CompositeCatalogSequence({
      sequenceId: createCompositeSequenceId(operationId),
      segments
    });
    const currentTrack = state?.currentTrack ?? null;
    await this.loadCatalogSequence(composite, {
      currentOrdinal,
      preservePlayback: true,
      preservePlaybackGeneration: true,
      saveSession: false
    });
    if (currentTrack?.entryInstanceId) this.resolvedCatalogEntries.set(currentOrdinal, currentTrack);
    this.audioPlayer.stateManager?.updateState?.({
      currentTrack
    }, `PlaybackManager ${operationKind} destination commit`);
    this.savePlaybackSession(true, { committed: true });
    return { accepted: true };
  }

  async prepareCatalogTrackForGraphRebuild(track) {
    const sequence = this.catalogSequence;
    if (!sequence || track?.sourceKind !== 'electron-file') {
      return { handled: false, track };
    }

    const findCurrentTarget = async () => {
      const currentState = this.audioPlayer.stateManager?.getStateSnapshot?.();
      if (sequence !== this.catalogSequence ||
          !Number.isSafeInteger(currentState?.currentTrackIndex) ||
          !samePlaybackEntry(currentState?.currentTrack, track)) {
        return null;
      }
      const ordinal = currentState.currentTrackIndex;
      const generation = this.trackCommandGeneration;
      const entry = await sequence.getEntry(ordinal);
      const latestState = this.audioPlayer.stateManager?.getStateSnapshot?.();
      if (sequence !== this.catalogSequence ||
          generation !== this.trackCommandGeneration ||
          latestState?.currentTrackIndex !== ordinal ||
          !samePlaybackEntry(latestState?.currentTrack, track)) {
        return findCurrentTarget();
      }
      if (track.entryInstanceId && entry?.entryInstanceId &&
          track.entryInstanceId !== entry.entryInstanceId) {
        return null;
      }
      return { ordinal, generation, entry };
    };

    const resolutionScope = createPlaybackSourceResolutionScope();
    while (true) {
      const target = await findCurrentTarget();
      if (!target) return { handled: true, reason: 'stale' };
      const isCurrent = () => {
        const currentState = this.audioPlayer.stateManager?.getStateSnapshot?.();
        return target.generation === this.trackCommandGeneration &&
          sequence === this.catalogSequence &&
          currentState?.currentTrackIndex === target.ordinal &&
          samePlaybackEntry(currentState?.currentTrack, track);
      };
      try {
        const source = await sequence.resolveEntrySource(target.entry, resolutionScope);
        if (!isCurrent()) continue;
        const resolvedTrack = createResolvedSequenceTrack(target.entry, source);
        this.resolvedCatalogEntries.set(target.ordinal, resolvedTrack);
        return { handled: false, track: resolvedTrack, ordinal: target.ordinal, isCurrent };
      } catch (error) {
        if (!isCurrent()) continue;
        return {
          handled: true,
          committed: false,
          ordinal: target.ordinal,
          track: null,
          reason: 'source-unavailable',
          error
        };
      }
    }
  }

  async cancelBulkPlay(operationId) {
    const operation = this.activeBulkPlay;
    if (!operation || operation.operationId !== operationId) {
      return { accepted: false, reason: 'stale' };
    }
    if (operation.phase === 'published' || operation.phase === 'terminal') {
      return { accepted: false, reason: 'tooLate' };
    }
    operation.phase = 'terminal';
    if (operation.playbackGeneration !== this.playbackGeneration) {
      return { accepted: false, reason: 'stale' };
    }
    this.pendingTransport.invalidate();
    this.audioPlayer.contextManager?.invalidatePendingTransitionRequests?.();
    this.audioPlayer.contextManager?.cancelPendingMediaCandidateReadiness?.();
    this.transportMediaChain = Promise.resolve();
    this.playbackGeneration += 1;
    this.audioPlayer.stateManager?.updateState?.({
      isTransitioning: false,
      transitionType: null,
      playbackGeneration: this.playbackGeneration
    }, 'PlaybackManager bulk Play cancelled');
    await this.#restoreBulkPlaySession(operation, this.playbackGeneration);
    this.audioPlayer.playbackSession?.resume();
    return { accepted: true, phase: 'cancelled' };
  }

  async finishBulkPlayTerminal(operationId, { succeeded = false } = {}) {
    const operation = this.activeBulkPlay;
    if (!operation || operation.operationId !== operationId || operation.phase === 'terminal') {
      return false;
    }
    if (!succeeded && operation.phase !== 'published') {
      await this.#restoreBulkPlaySession(operation);
    }
    operation.phase = 'terminal';
    this.audioPlayer.playbackSession?.resume();
    return true;
  }

  canUndoSessionTransport() {
    return this.sessionTransportUndo !== null;
  }

  async undoSessionTransport() {
    const snapshot = this.sessionTransportUndo;
    this.sessionTransportUndo = null;
    if (!snapshot) return { kind: 'notAvailable' };
    const release = this.blockPlaybackSessionWrites();
    try {
      if (!await this.#restoreSessionPlaybackState(snapshot)) return { kind: 'notAvailable' };
    } finally {
      release();
    }
    this.activeBulkPlay = null;
    if (this.sequence.itemCount) this.savePlaybackSession(true, { committed: true });
    else this.removePlaybackSession();
    return { kind: 'published' };
  }

  #captureSessionPlaybackState() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.() ?? {};
    const common = {
      currentOrdinal: state.currentTrackIndex ?? 0,
      currentTrack: state.currentTrack ?? null,
      currentTrackPosition: state.currentTrackPosition ?? 0,
      unloaded: this.isUnloadedPlaybackSession(state),
      currentTrackDuration: state.currentTrackDuration ?? 0,
      currentTrackName: state.currentTrackName ?? '',
      playbackMode: state.playbackMode,
      repeatMode: state.repeatMode,
      shuffleMode: state.shuffleMode,
      wasPlaying: state.isPlaying === true,
      wasPaused: state.isPaused === true,
      wasStopped: state.isStopped === true
    };
    if (this.catalogSequence) {
      return { ...common, kind: 'catalog', sequence: this.catalogSequence };
    }
    return { ...common, kind: 'materialized', snapshot: this.capturePlaybackQueueSnapshot() };
  }

  async #restoreBulkPlaySession(operation, expectedGeneration = operation.playbackGeneration) {
    const snapshot = operation?.previousSessionState;
    operation.previousSessionState = null;
    if (!snapshot || !operation.provisionalInstalled ||
        expectedGeneration !== this.playbackGeneration) {
      return false;
    }
    const release = this.blockPlaybackSessionWrites({ suppress: true });
    try {
      return await this.#restoreSessionPlaybackState(snapshot, {
        restoreMedia: operation.provisionalLoaded
      });
    } finally {
      release();
    }
  }

  async #restoreSessionPlaybackState(snapshot, { restoreMedia = true } = {}) {
    const contextManager = this.audioPlayer.contextManager;
    if (snapshot.unloaded && restoreMedia) {
      const transportGeneration = this.trackCommandGeneration;
      await contextManager?.stop?.();
      if (transportGeneration !== this.trackCommandGeneration) return false;
    }
    let { currentTrack } = snapshot;
    if (snapshot.kind === 'catalog' && snapshot.sequence) {
      this.pendingTransport.invalidate();
      this.trackCommandGeneration += 1;
      this.catalogSequence?.clear();
      this.installCatalogSequence(snapshot.sequence, {
        currentOrdinal: snapshot.currentOrdinal,
        currentTrack: snapshot.currentTrack,
        resolvedEntries: snapshot.currentTrack
          ? new Map([[snapshot.currentOrdinal, snapshot.currentTrack]])
          : null,
        saveSession: false
      });
      if (!snapshot.unloaded) contextManager?.refreshActiveRegionTransportPlan?.();
    } else if (snapshot.kind === 'materialized' && this.restorePlaybackQueueSnapshot(snapshot.snapshot)) {
      this.playbackGeneration += 1;
      this.syncPlaylistState(snapshot.currentOrdinal);
      if (snapshot.unloaded) currentTrack = this.playlist[snapshot.currentOrdinal];
    } else {
      return false;
    }
    this.unloadedSessionTrack = snapshot.unloaded ? currentTrack : null;
    if (snapshot.unloaded) this.sessionMediaTrack = null;
    this.audioPlayer.stateManager?.updateState?.({
      currentTrackIndex: snapshot.currentOrdinal,
      currentTrack,
      currentTrackPosition: snapshot.currentTrackPosition,
      playbackGeneration: this.playbackGeneration,
      ...(snapshot.unloaded ? {
        currentTrackName: snapshot.currentTrackName,
        currentTrackDuration: snapshot.currentTrackDuration,
        playbackMode: snapshot.playbackMode,
        repeatMode: snapshot.repeatMode,
        shuffleMode: snapshot.shuffleMode,
        isPlaying: false,
        isPaused: snapshot.wasPaused,
        isStopped: snapshot.wasStopped,
        artworkUrl: '',
        isTrackPresentationPending: false
      } : {})
    }, 'PlaybackManager bulk Play rollback');
    if (snapshot.unloaded || !restoreMedia) return true;
    if (!snapshot.currentTrack) {
      await contextManager?.stop?.();
      return true;
    }
    await contextManager?.rebindCurrentPlayback?.({
      stopCurrentFirst: false,
      restoreState: {
        currentTrackPosition: snapshot.currentTrackPosition,
        isPlaying: snapshot.wasPlaying,
        isPaused: snapshot.wasPaused,
        isStopped: snapshot.wasStopped
      }
    });
    return true;
  }

  deactivateCatalogSequence() {
    this.pendingTransport.invalidate();
    this.trackCommandGeneration += 1;
    this.catalogSequence?.clear();
    this.catalogSequence = null;
    this.resolvedCatalogEntries.clear();
  }

  async setCatalogShuffleMode(enabled, state = this.audioPlayer.stateManager?.getStateSnapshot?.()) {
    if (!this.catalogSequence) return null;
    this.trackCommandGeneration += 1;
    const oldOrdinal = state?.currentTrackIndex ?? 0;
    const canonicalOrdinal = this.catalogSequence.toCanonicalOrdinal(oldOrdinal);
    const currentTrack = state?.currentTrack ?? this.resolvedCatalogEntries.get(oldOrdinal) ?? null;
    this.catalogSequence.setShuffle(enabled);
    const newOrdinal = this.catalogSequence.toTransportOrdinal(canonicalOrdinal);
    this.resolvedCatalogEntries.clear();
    if (currentTrack?.path || currentTrack?.file || currentTrack?.provider) {
      this.resolvedCatalogEntries.set(newOrdinal, currentTrack);
    }
    this.audioPlayer.stateManager?.updateState?.({
      shuffleMode: Boolean(enabled),
      currentTrackIndex: newOrdinal,
      currentTrack
    }, 'PlaybackManager catalog shuffle');
    void this.refreshCatalogQueueWindow(newOrdinal);
    return newOrdinal;
  }

  async #commitCatalogTrack(ordinal, track) {
    this.resolvedCatalogEntries.clear();
    if (track?.path || track?.file || track?.provider) this.resolvedCatalogEntries.set(ordinal, track);
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    if (state?.currentTrackIndex !== ordinal || state?.currentTrack !== track) {
      this.audioPlayer.stateManager?.updateState?.({
        currentTrackIndex: ordinal,
        currentTrack: track,
        playlistLength: this.catalogSequence.itemCount,
        sequenceKind: 'catalog',
        sequenceId: this.catalogSequence.sequenceId,
        playbackGeneration: this.playbackGeneration
      }, 'PlaybackManager catalog track committed');
    }
  }

  async #compensateCatalogTransport({
    sequence,
    ordinal,
    track,
    state,
    transportRollback,
    restoreShuffleState = true
  }) {
    if (sequence !== this.catalogSequence) return false;
    if (restoreShuffleState) {
      restorePlannedShuffle(sequence, transportRollback, { requirePlannedState: false });
    }
    this.resolvedCatalogEntries.clear();
    if (track?.path || track?.file || track?.provider) this.resolvedCatalogEntries.set(ordinal, track);
    this.audioPlayer.stateManager?.updateState?.({
      currentTrackIndex: ordinal,
      currentTrack: track,
      currentTrackPosition: state?.currentTrackPosition ?? 0,
      playbackGeneration: this.playbackGeneration
    }, 'PlaybackManager catalog transport compensation');
    return true;
  }

  #restoreCatalogTrackState(ordinal, track, state) {
    this.resolvedCatalogEntries.clear();
    if (track?.path || track?.file || track?.provider) this.resolvedCatalogEntries.set(ordinal, track);
    this.audioPlayer.stateManager?.updateState?.({
      currentTrackIndex: ordinal,
      currentTrack: track,
      currentTrackPosition: state?.currentTrackPosition ?? 0,
      playbackGeneration: this.playbackGeneration
    }, 'PlaybackManager catalog media rollback');
  }

  #reportSkippedTracks(failures, sequence = this.sequence) {
    for (const failure of failures) {
      console.warn(
        `[PlaybackManager] Skipping unavailable sequence occurrence at ordinal ${failure.ordinal}.`,
        failure.error
      );
    }
    if (sequence !== this.catalogSequence) return;
    globalThis.window?.uiManager?.showTransientMessage?.(
      'status.libraryTracksSkippedOffline',
      false,
      { count: failures.length }
    );
  }

  /**
   * Play the current track
   */
  async play(userInitiated = true, options = {}) {
    const started = await this.runWithPlaybackPending(
      () => this.#play(userInitiated, options),
      userInitiated ? 2 : 1
    );
    this.saveLocalTransportDuringMutation(userInitiated && started === true);
    return started;
  }

  async #play(userInitiated = true, { isCurrent = () => true } = {}) {
    if (this.activePlayRequest?.promise) {
      return this.activePlayRequest.promise;
    }

    const request = {
      token: ++this.playRequestToken,
      isCurrent,
      promise: null
    };
    this.activePlayRequest = request;
    const operation = this.performPlay(request, userInitiated);
    request.promise = operation.finally(() => {
      if (this.isActivePlayRequest(request)) {
        this.activePlayRequest = null;
      }
    });
    return request.promise;
  }

  isActivePlayRequest(request) {
    return this.activePlayRequest === request && request?.token === this.playRequestToken;
  }

  invalidateActivePlayRequest() {
    this.playRequestToken++;
    this.activePlayRequest = null;
  }

  #isCurrentTrackPaused(state, currentOrdinal) {
    const sequence = this.sequence;
    const currentTrack = state?.currentTrack;
    if (!sequence ||
        state?.isPaused !== true || state.isStopped === true ||
        !Number.isSafeInteger(currentOrdinal) ||
        currentOrdinal !== state.currentTrackIndex ||
        currentOrdinal < 0 || currentOrdinal >= sequence.itemCount ||
        !currentTrack) {
      return false;
    }

    if (sequence === this.catalogSequence) {
      if (state?.sequenceKind !== 'catalog' ||
          state.sequenceId !== sequence.sequenceId ||
          state.playbackGeneration !== this.playbackGeneration) {
        return false;
      }
      const resolvedTrack = this.resolvedCatalogEntries.get(currentOrdinal);
      if (resolvedTrack && !samePlaybackEntry(resolvedTrack, currentTrack)) return false;
    } else {
      const entry = sequence.peekEntry?.(currentOrdinal);
      if (entry && !samePlaybackEntry(entry, currentTrack)) return false;
    }
    return true;
  }

  canResumeCurrentTrack(state, currentOrdinal) {
    const contextManager = this.audioPlayer.contextManager;
    if (this.isUnloadedPlaybackSession(state)) return false;
    if (!contextManager || !this.#isCurrentTrackPaused(state, currentOrdinal)) return false;
    const currentTrack = state.currentTrack;
    if (state.playbackMode === 'midi') return !!contextManager.getMidiPresentation?.().hasMidi;
    if (state.playbackMode === 'bufferSource') {
      return contextManager.hasCurrentBuffer?.() === true;
    }
    if (state.playbackMode === 'rollingPcm') {
      return contextManager.hasCurrentRollingPlayback?.() === true;
    }
    if (state.playbackMode === 'native') return !!this.audioPlayer.audioManager?.snapshot?.playback?.source?.uri;
    if (state.playbackMode !== 'audioElement') return false;

    const audioElement = this.audioPlayer.audioElement;
    if (!audioElement || audioElement.error || audioElement.ended === true) return false;
    const mediaUrl = audioElement.currentSrc || audioElement.src;
    if (typeof mediaUrl !== 'string' || mediaUrl.length === 0) return false;
    if (currentTrack.sourceKind !== 'electron-file') return true;
    const expectedSource = contextManager.getDirectElectronMediaSource?.(currentTrack);
    return typeof expectedSource === 'string' && mediaUrl === expectedSource;
  }

  async performPlay(request, userInitiated = true) {
    const isCurrent = () => this.isActivePlayRequest(request) && request.isCurrent();
    if (this.audioPlayer.contextManager?.hasActiveGraphRebuildRequest?.()) {
      const started = await this.audioPlayer.contextManager.play(false, userInitiated, isCurrent);
      return this.isActivePlayRequest(request) ? started : false;
    }

    const contextManager = this.audioPlayer.contextManager;
    if (!contextManager) {
      console.warn('[PlaybackManager] ContextManager not available for play');
      return false;
    }
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    if (state?.currentTrack?.meta?.openHomeQueueEntry?.liveSessionId) {
      const started = await this.audioPlayer.openHomePlaybackAdapter?.playClassifiedLive?.(isCurrent);
      return this.isActivePlayRequest(request) && started === true;
    }
    const currentOrdinal = state?.currentTrackIndex ??
      this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0;
    if (this.canResumeCurrentTrack(state, currentOrdinal)) {
      const started = await contextManager.play(false, userInitiated, isCurrent);
      return this.isActivePlayRequest(request) ? started : false;
    }
    const result = await this.selectSequenceOrdinal(currentOrdinal, {
      play: true,
      userInitiated,
      skipUnavailable: false,
      resumePaused: true,
      isCurrent
    });
    return this.isActivePlayRequest(request) && result?.accepted !== false;
  }
  
  /**
   * Pause the current track
   */
  async pause({ saveSession = true } = {}) {
    this.invalidateActivePlayRequest();
    this.audioPlayer.openHomePlaybackAdapter?.networkLive?.stop();
    this.pendingTransport.invalidate();
    this.cancelPlaybackPending();
    if (this.audioPlayer.contextManager?.hasActiveGraphRebuildRequest?.() !== true) {
      this.trackCommandGeneration += 1;
    }
    if (this.audioPlayer.contextManager) {
      const wasTransitioning = this.transitionInProgress;
      await this.audioPlayer.contextManager.pause();
      this.saveLocalTransportDuringMutation(saveSession);
      if (wasTransitioning) {
        this.transitionInProgress = false;
      }
    } else {
      console.warn('[PlaybackManager] ContextManager not available for pause');
    }
  }
  
  /**
   * Toggle between play and pause
   */
  async togglePlayPause() {
    if (!this.audioPlayer.stateManager) {
      console.warn('[PlaybackManager] StateManager not available for togglePlayPause');
      return;
    }
    
    const state = this.audioPlayer.stateManager.getStateSnapshot();
    
    if (this.activePlayRequest || this.transitionInProgress || state.isPlaying) {
      await this.pause();
    } else {
      await this.play();
    }
  }
  
  /**
   * Stop playback and reset position
   */
  async stop({ saveSession = true } = {}) {
    this.invalidateActivePlayRequest();
    this.audioPlayer.openHomePlaybackAdapter?.networkLive?.stop();
    this.pendingTransport.invalidate();
    this.cancelPlaybackPending();
    const graphRebuildActive = this.audioPlayer.contextManager?.hasActiveGraphRebuildRequest?.() === true;
    if (!graphRebuildActive) {
      this.trackCommandGeneration += 1;
    }
    this.transitionInProgress = false;
    this.clearFailedTrackSkipState();
    if (this.audioPlayer.contextManager) {
      await this.audioPlayer.contextManager.stop();
      this.saveLocalTransportDuringMutation(saveSession);
    } else {
      console.warn('[PlaybackManager] ContextManager not available for stop');
    }
  }

  async restartAudioElement(userInitiated) {
    const contextManager = this.audioPlayer.contextManager;
    contextManager?.invalidateAutomaticMoveForManualCommand?.();
    if (typeof contextManager?.restartAudioElementPlayback === 'function') {
      const restarted = await contextManager.restartAudioElementPlayback(userInitiated);
      if (restarted === false) return false;
    } else if (typeof contextManager?.getCurrentPlaybackTime === 'function' &&
        typeof contextManager.seek === 'function') {
      await contextManager.seek(0, { saveSession: userInitiated });
    } else if (this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement.currentTime = 0;
    }
    return this.play(userInitiated);
  }
  
  /**
   * Enhanced playPrevious with seamless transition
   */
  async playPrevious(userInitiated = true, options = {}) {
    if (this.audioPlayer.contextManager?.nativeQueueOwned) return this.audioPlayer.contextManager.command('previous');
    const sequence = this.sequence;
    const result = await this.runWithPlaybackPending(
      () => this.#playPrevious(userInitiated, options),
      userInitiated ? 2 : 1
    );
    this.saveLocalTransportDuringMutation(userInitiated && (result === true || result?.accepted === true), sequence);
    return result;
  }

  async #playPrevious(userInitiated = true, options = {}) {
    if (this.catalogSequence && options.materializedOnly !== true) {
      return this.transportPrevious(userInitiated);
    }
    if (userInitiated) this.audioPlayer.resumeAudioContextInGesture?.();
    if (this.playlist.length === 0 || this.transitionInProgress) return false;
    if (userInitiated) {
      this.audioPlayer.contextManager?.cancelVideoNaturalEnd?.();
      this.audioPlayer.contextManager?.invalidateAutomaticMoveForManualCommand?.();
    }
    this.clearFailedTrackSkipState();
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const shuffleMode = state?.shuffleMode || false;
    const repeatMode = state?.repeatMode || 'OFF';
    const isTimelinePlayback = ['rollingPcm', 'midi'].includes(state?.playbackMode);
    const unloaded = this.isUnloadedPlaybackSession(state);
    if (!options.forceQueueMove && unloaded &&
        (state.currentTrackPosition > 3 || (currentIndex === 0 && repeatMode !== 'ALL'))) {
      const result = await this.selectSequenceOrdinal(currentIndex, {
        play: true,
        userInitiated,
        commandKind: 'previous'
      });
      return result.accepted;
    }
    
    if (!options.forceQueueMove && !unloaded && this.audioPlayer.contextManager &&
        (this.audioPlayer.contextManager.isUsingBufferPlayback() || isTimelinePlayback)) {
      const currentTime = isTimelinePlayback
        ? (this.audioPlayer.contextManager.getCurrentPlaybackTime?.() ?? 0)
        : this.audioPlayer.contextManager.getCurrentBufferTime();
      if (currentTime > 3) {
        const currentTrack = this.getTrack(currentIndex);
        if (currentTrack) {
          await this.audioPlayer.contextManager.seamlessTransition(
            currentTrack,
            currentIndex,
            userInitiated
          );
        }
        return true;
      }
    } else if (!options.forceQueueMove && !unloaded && this.audioPlayer.audioElement &&
        (this.audioPlayer.contextManager?.getCurrentPlaybackTime?.() ??
          this.audioPlayer.audioElement.currentTime) > 3) {
      await this.restartAudioElement(userInitiated);
      return true;
    }
    
    let newIndex;
    
    if (shuffleMode) {
      newIndex = currentIndex - 1;
      
      if (newIndex < 0) {
        if (repeatMode === 'ALL') {
          this.reshuffleForBoundarySelection(this.playlist.length - 1);
          newIndex = this.playlist.length - 1;
        } else {
          if (options.forceQueueMove) return false;
          if (this.audioPlayer.contextManager &&
              (this.audioPlayer.contextManager.isUsingBufferPlayback() || isTimelinePlayback)) {
            const currentTrack = this.getTrack(currentIndex);
            if (currentTrack) {
              await this.audioPlayer.contextManager.seamlessTransition(
                currentTrack,
                currentIndex,
                userInitiated
              );
            }
          } else {
            await this.restartAudioElement(userInitiated);
          }
          return true;
        }
      }
    } else {
      newIndex = currentIndex - 1;
      
      if (newIndex < 0) {
        if (repeatMode === 'ALL') {
          newIndex = this.playlist.length - 1;
        } else {
          if (options.forceQueueMove) return false;
          if (this.audioPlayer.contextManager &&
              (this.audioPlayer.contextManager.isUsingBufferPlayback() || isTimelinePlayback)) {
            const currentTrack = this.getTrack(currentIndex);
            if (currentTrack) {
              await this.audioPlayer.contextManager.seamlessTransition(
                currentTrack,
                currentIndex,
                userInitiated
              );
            }
          } else {
            await this.restartAudioElement(userInitiated);
          }
          return true;
        }
      }
    }
    
    const prevTrack = this.getTrack(newIndex);
    if (!prevTrack || !this.audioPlayer.contextManager?.transitionToNextTrack) return false;
    
    this.transitionInProgress = true;
    let transitionResult;
    try {
      transitionResult = await this.audioPlayer.contextManager.transitionToNextTrack(
        prevTrack,
        newIndex,
        userInitiated
      );
    } finally {
      this.transitionInProgress = false;
    }
    
    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayPauseButton();
    }
    return transitionResult !== false;
  }
  
  /**
   * Enhanced playNext with seamless transition and proper error handling
   */
  async playNext(userInitiated = true, options = {}) {
    if (this.audioPlayer.contextManager?.nativeQueueOwned) return this.audioPlayer.contextManager.command('next');
    const sequence = this.sequence;
    const result = await this.runWithPlaybackPending(
      () => this.#playNext(userInitiated, options),
      userInitiated ? 2 : 1
    );
    this.saveLocalTransportDuringMutation(userInitiated && (result === true || result?.accepted === true), sequence);
    return result;
  }

  async #playNext(userInitiated = true, options = {}) {
    if (this.catalogSequence && options.materializedOnly !== true) {
      return this.transportNext(userInitiated, options);
    }
    if (userInitiated) this.audioPlayer.resumeAudioContextInGesture?.();
    if (userInitiated) {
      this.audioPlayer.contextManager?.cancelVideoNaturalEnd?.();
      this.audioPlayer.contextManager?.invalidateAutomaticMoveForManualCommand?.();
    }
    if (this.playlist.length === 0) {
      return false;
    }

    const ignoreRepeatOne = options?.ignoreRepeatOne === true;
    const failedIndex = Number.isInteger(options?.failedIndex) ? options.failedIndex : null;
    const failedTrackSkipState = failedIndex !== null
      ? this.recordFailedTrackSkip(failedIndex)
      : null;
    const isInternalFailureSkip = options?.allowDuringTransition === true ||
      (!userInitiated && ignoreRepeatOne && failedIndex !== null);
    const ownsTransitionGuard = !this.transitionInProgress;

    if (this.transitionInProgress && !isInternalFailureSkip) {
      return false;
    }

    if (!failedTrackSkipState) {
      this.clearFailedTrackSkipState();
    } else if (this.hasFailedEveryPlaylistEntry(failedTrackSkipState)) {
      await this.stopAfterFailedTrackSkipExhausted();
      return false;
    }
    
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const repeatMode = state?.repeatMode || 'OFF';
    const shuffleMode = state?.shuffleMode || false;
    
    if (repeatMode === 'ONE' && !userInitiated && !ignoreRepeatOne) {
      if (this.audioPlayer.contextManager &&
          (this.audioPlayer.contextManager.isUsingBufferPlayback() ||
            ['rollingPcm', 'midi'].includes(state?.playbackMode))) {
        const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
        const currentTrack = this.getTrack(currentIndex);
        if (currentTrack) {
          await this.audioPlayer.contextManager.seamlessTransition(
            currentTrack,
            currentIndex,
            userInitiated
          );
        }
      } else {
        await this.restartAudioElement(userInitiated);
      }
      return true;
    }
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const newIndex = this.getNextTrackIndex(currentIndex, repeatMode, shuffleMode, failedTrackSkipState);
    if (newIndex === null) {
      if (failedTrackSkipState && repeatMode === 'ALL') {
        await this.stopAfterFailedTrackSkipExhausted();
      }
      return false;
    }
    
    const nextTrack = this.getTrack(newIndex);
    if (!nextTrack) {
      console.warn('[PlaybackManager] No next track available');
      return false;
    }
    
    this.transitionInProgress = true;
    
    try {
      let transitionResult = false;
      if (this.audioPlayer.contextManager?.transitionToNextTrack) {
        transitionResult = await this.audioPlayer.contextManager.transitionToNextTrack(
          nextTrack,
          newIndex,
          userInitiated
        );
      } else {
        console.warn('[PlaybackManager] ContextManager not available for transition');
      }

      if (transitionResult !== false) {
        this.clearFailedTrackSkipState();
      }
      
      if (this.audioPlayer.ui) {
        this.audioPlayer.ui.updatePlayPauseButton();
      }
      return transitionResult !== false;
    } catch (error) {
      console.error('[PlaybackManager] Transition failed:', error);
      
      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          isTransitioning: false,
          transitionType: null
        }, 'PlaybackManager playNext error');
      }
      return false;
    } finally {
      if (ownsTransitionGuard) {
        this.transitionInProgress = false;
      }
    }
  }

  getNextTrackIndex(currentIndex, repeatMode, shuffleMode, failedTrackSkipState = null) {
    let nextIndex = currentIndex;
    let reshuffled = false;

    for (let attempts = 0; attempts < this.playlist.length; attempts++) {
      nextIndex += 1;

      if (nextIndex >= this.playlist.length) {
        if (repeatMode !== 'ALL') {
          return null;
        }

        if (shuffleMode && !reshuffled) {
          this.reshuffleForBoundarySelection(0);
          this.reindexFailedTrackSkipState(failedTrackSkipState);
          reshuffled = true;
        }
        nextIndex = 0;
      }

      if (!this.isFailedTrackSkipCandidate(nextIndex, failedTrackSkipState)) {
        return nextIndex;
      }
    }

    return null;
  }

  recordFailedTrackSkip(failedIndex) {
    if (!this.failedTrackSkipState ||
      this.failedTrackSkipState.playlistLength !== this.playlist.length) {
      this.failedTrackSkipState = {
        playlistLength: this.playlist.length,
        failedIndices: new Set(),
        failedTracks: []
      };
    }

    if (failedIndex >= 0 && failedIndex < this.playlist.length) {
      this.failedTrackSkipState.failedIndices.add(failedIndex);
      const failedTrack = this.getTrack(failedIndex);
      if (failedTrack && !this.failedTrackSkipState.failedTracks.includes(failedTrack)) {
        this.failedTrackSkipState.failedTracks.push(failedTrack);
      }
    }

    return this.failedTrackSkipState;
  }

  reindexFailedTrackSkipState(failedTrackSkipState) {
    if (!failedTrackSkipState) return;

    failedTrackSkipState.failedIndices = new Set();
    for (const failedTrack of failedTrackSkipState.failedTracks) {
      const index = this.playlist.findIndex(track => track === failedTrack);
      if (index >= 0) {
        failedTrackSkipState.failedIndices.add(index);
      }
    }
  }

  isFailedTrackSkipCandidate(index, failedTrackSkipState) {
    if (!failedTrackSkipState) return false;
    if (failedTrackSkipState.failedIndices.has(index)) return true;

    const track = this.getTrack(index);
    return !!track && failedTrackSkipState.failedTracks.includes(track);
  }

  hasFailedEveryPlaylistEntry(failedTrackSkipState) {
    return !!failedTrackSkipState &&
      this.playlist.length > 0 &&
      failedTrackSkipState.failedIndices.size >= this.playlist.length;
  }

  clearFailedTrackSkipState() {
    this.failedTrackSkipState = null;
  }

  async stopAfterFailedTrackSkipExhausted() {
    console.warn('[PlaybackManager] All playlist tracks failed to load; stopping playback');
    this.clearFailedTrackSkipState();
    this.transitionInProgress = false;

    if (this.audioPlayer.contextManager) {
      await this.audioPlayer.contextManager.stop();
    } else {
      console.warn('[PlaybackManager] ContextManager not available for stop');
    }

    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        isPlaying: false,
        isPaused: false,
        isStopped: true,
        isTransitioning: false,
        transitionType: null
      }, 'PlaybackManager failed track skip exhausted');
    }

    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayPauseButton();
    }
  }
  
  /**
   * Handle track ended event
   */
  onTrackEnded() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    if (state?.isStopped) {
      return;
    }
    
    if (this.transitionInProgress) {
      return;
    }
    if (this.catalogSequence) {
      void this.transportNext(false, { reason: 'ended' }).catch(error => {
        console.error('[PlaybackManager] Catalog transport Next failed:', error);
      });
      return;
    }
    
    const repeatMode = state?.repeatMode || 'OFF';
    const shuffleMode = state?.shuffleMode || false;
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const isLastTrack = currentIndex >= this.playlist.length - 1;
    
    if (repeatMode === 'ONE') {
      void this.playNext(false).catch(error => {
        console.error('[PlaybackManager] Failed to restart track in repeat ONE mode:', error);
      });
      return;
    }
    
    if (isLastTrack && repeatMode === 'ALL') {
      if (shuffleMode) {
        this.reshuffleForBoundarySelection(0);
        const firstTrack = this.getTrack(0);
        if (firstTrack && this.audioPlayer.contextManager) {
          this.audioPlayer.contextManager.transitionToNextTrack(firstTrack, 0, false).catch(error => {
            console.error('[PlaybackManager] Failed to transition to first track after reshuffle:', error);
          });
        }
      } else {
        if (this.audioPlayer.stateManager) {
          this.audioPlayer.stateManager.updateState({
            currentTrackIndex: 0
          }, 'PlaybackManager onTrackEnded repeat ALL');
        }
        
        const firstTrack = this.getTrack(0);
        if (firstTrack && this.audioPlayer.contextManager) {
          this.audioPlayer.contextManager.transitionToNextTrack(firstTrack, 0, false).catch(error => {
            console.error('[PlaybackManager] Failed to transition to first track:', error);
          });
        }
      }
      return;
    }
    
    if (isLastTrack && repeatMode === 'OFF') {
      this.audioPlayer.contextManager?.stop?.({ preserveVideoTail: true });
      this.resetToFirstTrack(false, false);
      return;
    }
    
    this.playNext(false);
  }
  
  /**
   * Reset to first track and prepare buffer
   */
  resetToFirstTrack(autoPlay = true, userInitiated = true) {
    if (this.playlist.length === 0) {
      console.warn('[PlaybackManager] No playlist to reset');
      return;
    }
    
    const finalIndex = 0;
    this.syncPlaylistState(finalIndex);
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        currentTrackIndex: finalIndex,
        currentTrackPosition: 0,
        isPlaying: false,
        isPaused: false,
        isStopped: true
      }, 'PlaybackManager resetToFirstTrack');
    }
    
    if (this.audioPlayer.contextManager) {
      const track = this.getTrack(finalIndex);
      if (track) {
        const loadOperation = autoPlay
          ? this.audioPlayer.contextManager.seamlessTransition(track, finalIndex, userInitiated)
          : this.audioPlayer.contextManager.loadTrack(track, finalIndex, null, { preserveVideoTail: !userInitiated,
              ...(this.audioPlayer.stateManager?.getStateSnapshot()?.playbackMode === 'midi'
                ? { preserveMidiTail: !userInitiated } : {}) });
        loadOperation.catch(error => {
          console.error('[PlaybackManager] Failed to load first track:', error);
        });
      }
    }
  }
  
  /**
   * Shuffle the playlist from the beginning
   */
  shufflePlaylistFromBeginning(autoPlay = true, userInitiated = true) {
    if (this.originalPlaylist.length === 0) {
      console.warn('[PlaybackManager] No original playlist to shuffle');
      return;
    }
    
    const playlistCopy = [...this.originalPlaylist];
    
    for (let i = playlistCopy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playlistCopy[i], playlistCopy[j]] = [playlistCopy[j], playlistCopy[i]];
    }
    
    this.playlist = playlistCopy;
    this.resetToFirstTrack(autoPlay, userInitiated);
  }
  
  /**
   * Reshuffle the playlist while maintaining the current track position
   */
  reshufflePlaylist() {
    if (this.originalPlaylist.length === 0) {
      console.warn('[PlaybackManager] No original playlist to reshuffle');
      return;
    }
    
    const currentTrack = this.playlist[this.audioPlayer.stateManager.getCurrentTrackIndex()];
    
    const playlistCopy = [...this.originalPlaylist];
    
    for (let i = playlistCopy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playlistCopy[i], playlistCopy[j]] = [playlistCopy[j], playlistCopy[i]];
    }
    
    this.playlist = playlistCopy;
    
    const newIndex = this.playlist.findIndex(track => samePlaybackEntry(track, currentTrack));
    
    const finalIndex = newIndex === -1 ? 0 : newIndex;
    this.syncPlaylistState(finalIndex);
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        currentTrackIndex: finalIndex,
        currentTrackPosition: 0
      }, 'PlaybackManager reshufflePlaylist');
    }
    this.savePlaybackSession(true);
  }

  reshuffleForBoundarySelection(boundaryIndex) {
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const currentTrack = this.playlist[currentIndex];
    this.reshufflePlaylist();
    if (this.playlist.length <= 1 ||
        !samePlaybackEntry(this.playlist[boundaryIndex], currentTrack)) {
      return boundaryIndex;
    }

    const swapIndex = boundaryIndex === 0 ? 1 : boundaryIndex - 1;
    [this.playlist[boundaryIndex], this.playlist[swapIndex]] = [
      this.playlist[swapIndex],
      this.playlist[boundaryIndex]
    ];
    this.syncPlaylistState(swapIndex);
    this.audioPlayer.stateManager.updateState({
      currentTrackIndex: swapIndex,
      currentTrackPosition: 0
    }, 'PlaybackManager reshuffleForBoundarySelection');
    return boundaryIndex;
  }

  disableShuffleModePreservingCurrentTrack(state) {
    if (this.originalPlaylist.length === 0) {
      return null;
    }

    const currentIndex = Number.isInteger(state?.currentTrackIndex)
      ? state.currentTrackIndex
      : (this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0);
    const currentTrack = this.playlist[currentIndex];

    this.playlist = [...this.originalPlaylist];

    const currentEntryId = this.playbackEntryIds.get(currentTrack);
    const restoredIndex = currentEntryId === undefined
      ? this.playlist.findIndex(track => samePlaybackEntry(track, currentTrack))
      : this.playlist.findIndex(track => this.playbackEntryIds.get(track) === currentEntryId);
    let finalIndex = restoredIndex === -1 ? currentIndex : restoredIndex;
    if (!Number.isInteger(finalIndex) || finalIndex < 0 || finalIndex >= this.playlist.length) {
      finalIndex = 0;
    }

    this.syncPlaylistState(finalIndex);

    if (this.audioPlayer.contextManager?.nextBuffer) {
      this.audioPlayer.contextManager.clearNextTrackBuffer();
    }

    return finalIndex;
  }

  enableShuffleModePreservingCurrentTrack(state) {
    if (this.originalPlaylist.length === 0) {
      return null;
    }

    const currentIndex = Number.isInteger(state?.currentTrackIndex)
      ? state.currentTrackIndex
      : (this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0);
    const currentTrack = this.playlist[currentIndex];
    const playlistCopy = [...this.originalPlaylist];

    for (let i = playlistCopy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playlistCopy[i], playlistCopy[j]] = [playlistCopy[j], playlistCopy[i]];
    }

    this.playlist = playlistCopy;
    const currentEntryId = this.playbackEntryIds.get(currentTrack);
    const shuffledIndex = currentEntryId === undefined
      ? this.playlist.findIndex(track => samePlaybackEntry(track, currentTrack))
      : this.playlist.findIndex(track => this.playbackEntryIds.get(track) === currentEntryId);
    let finalIndex = shuffledIndex === -1 ? currentIndex : shuffledIndex;
    if (!Number.isInteger(finalIndex) || finalIndex < 0 || finalIndex >= this.playlist.length) {
      finalIndex = 0;
    }

    this.syncPlaylistState(finalIndex);
    if (this.audioPlayer.contextManager?.nextBuffer) {
      this.audioPlayer.contextManager.clearNextTrackBuffer();
    }
    return finalIndex;
  }
  
  /**
   * Toggle shuffle mode
   */
  async toggleShuffleMode(userInitiated = true) {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    return this.setShuffleMode(!(state?.shuffleMode || false), { userInitiated });
  }

  async setShuffleMode(enabled, options = {}) {
    const release = this.blockPlaybackSessionWrites();
    try {
      return await this.#setShuffleMode(enabled, options);
    } finally {
      release();
    }
  }

  async #setShuffleMode(enabled, {
    userInitiated = true,
    preserveTransport = false,
    saveSession = true
  } = {}) {
    if (typeof enabled !== 'boolean') {
      throw new TypeError('Shuffle mode must be a boolean');
    }
    if (this.audioPlayer.contextManager?.nativeQueueOwned) return this.audioPlayer.contextManager.queueMode({ shuffle: enabled });

    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    if (state?.repeatMode === 'ONE' || state?.shuffleMode === enabled) return false;
    if (this.isUnloadedPlaybackSession(state)) preserveTransport = true;
    const isCurrentlyPlaying = state?.isPlaying === true;
    if (this.catalogSequence) {
      await this.setCatalogShuffleMode(enabled, state);
    } else {
      if (userInitiated && isCurrentlyPlaying && enabled && !preserveTransport) {
        this.audioPlayer.resumeAudioContextInGesture?.();
      }

      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          shuffleMode: enabled
        }, 'PlaybackManager setShuffleMode');
      }

      if (enabled) {
        if (preserveTransport) {
          this.enableShuffleModePreservingCurrentTrack(state);
        } else {
          if (this.audioPlayer.contextManager) {
            await this.audioPlayer.contextManager.stop();
          }
          this.shufflePlaylistFromBeginning(isCurrentlyPlaying, userInitiated);
        }
      } else {
        this.disableShuffleModePreservingCurrentTrack(state);
      }
    }

    this.audioPlayer.contextManager?.refreshActiveRegionTransportPlan?.();

    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayerUIState();
    }
    
    this.savePlayerState();
    if (saveSession) this.savePlaybackSession(!this.catalogSequence, { committed: true });
    return true;
  }
  
  setPlaybackSpeed(speed) {
    if (!isValidPlaybackSpeed(speed)) {
      throw new RangeError('Unsupported playback speed');
    }
    if (this.audioPlayer.stateManager?.getStateSnapshot()?.playbackSpeed === speed) return false;
    this.audioPlayer.applyPlaybackSpeed(speed);
    this.audioPlayer.ui?.updatePlayerUIState();
    return true;
  }

  togglePreservePitch() {
    const current = this.audioPlayer.stateManager?.getStateSnapshot()?.preservePitch ?? true;
    this.audioPlayer.applyPreservePitch(!current);
    this.audioPlayer.ui?.updatePlayerUIState();
  }

  /**
   * Toggle repeat mode (OFF -> ALL -> ONE -> OFF)
   */
  async toggleRepeatMode() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const currentRepeatMode = state?.repeatMode || 'OFF';
    let newRepeatMode;

    switch (currentRepeatMode) {
      case 'OFF':
        newRepeatMode = 'ALL';
        break;
      case 'ALL':
        newRepeatMode = 'ONE';
        break;
      case 'ONE':
        newRepeatMode = 'OFF';
        break;
      default:
        newRepeatMode = 'OFF';
    }

    return this.setRepeatMode(newRepeatMode);
  }

  setRepeatModeNormalizer(normalizer) {
    if (normalizer !== null && typeof normalizer !== 'function') {
      throw new TypeError('Repeat mode normalizer must be a function or null');
    }
    this.repeatModeNormalizer = normalizer;
    return () => {
      if (this.repeatModeNormalizer === normalizer) this.repeatModeNormalizer = null;
    };
  }

  async setRepeatMode(repeatMode, { saveSession = true } = {}) {
    const release = this.blockPlaybackSessionWrites();
    try {
      return await this.#setRepeatMode(repeatMode, saveSession);
    } finally {
      release();
    }
  }

  async #setRepeatMode(repeatMode, saveSession) {
    if (repeatMode !== 'OFF' && repeatMode !== 'ALL' && repeatMode !== 'ONE') {
      throw new RangeError('Repeat mode must be OFF, ALL, or ONE');
    }
    if (this.audioPlayer.contextManager?.nativeQueueOwned) return this.audioPlayer.contextManager.queueMode({
      repeat: repeatMode.toLowerCase(), ...(repeatMode === 'ONE' ? { shuffle: false } : {})
    });

    repeatMode = this.repeatModeNormalizer?.(repeatMode) ?? repeatMode;
    if (repeatMode !== 'OFF' && repeatMode !== 'ALL' && repeatMode !== 'ONE') {
      throw new RangeError('Normalized repeat mode must be OFF, ALL, or ONE');
    }

    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    let restoredCurrentTrackIndex = null;
    if (state?.shuffleMode && repeatMode === 'ONE') {
      restoredCurrentTrackIndex = this.catalogSequence
        ? await this.setCatalogShuffleMode(false, state)
        : this.disableShuffleModePreservingCurrentTrack(state);
    }

    if (this.audioPlayer.stateManager) {
      const updates = {
        repeatMode
      };
      if (state?.shuffleMode && repeatMode === 'ONE') {
        updates.shuffleMode = false;
        if (restoredCurrentTrackIndex !== null) {
          updates.currentTrackIndex = restoredCurrentTrackIndex;
        }
      }
      this.audioPlayer.stateManager.updateState(updates, 'PlaybackManager setRepeatMode');
    }

    this.audioPlayer.contextManager?.refreshActiveRegionTransportPlan?.();
    
    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayerUIState();
    }
    
    this.savePlayerState();
    if (saveSession) this.savePlaybackSession(restoredCurrentTrackIndex !== null && !this.catalogSequence, {
      committed: true
    });
  }
  
  /**
   * Initialize keyboard shortcuts
   */
  runPlaybackCommand(command) {
    try {
      return Promise.resolve(command()).catch(error => {
        console.error('[PlaybackManager] Playback command failed:', error);
        globalThis.window?.uiManager?.setError?.(error?.code === 'alacRequiresMacDesktop'
          ? 'error.alacRequiresMacDesktop' : 'error.playbackCommandFailed', true);
        return false;
      });
    } catch (error) {
      console.error('[PlaybackManager] Playback command failed:', error);
      globalThis.window?.uiManager?.setError?.(error?.code === 'alacRequiresMacDesktop'
        ? 'error.alacRequiresMacDesktop' : 'error.playbackCommandFailed', true);
      return Promise.resolve(false);
    }
  }

  initKeyboardShortcuts() {
    if (this.keydownHandler) return;

    this.keydownHandler = (e) => {
      // The Space key guard cancels scrolling; shortcut consumers stop propagation.
      // Check if audio player is initialized
      if (!this.audioPlayer) return;
      const network = globalThis.window?.uiManager?.networkMusic;
      if (network && network.selectedPlayerId !== 'local') return;
      
      if (e.target.matches('input:not([type="range"]), textarea, select')) {
        return;
      }
      
      switch (e.key) {
        case ' ':
          if (!e.target.matches('button, [role="button"], a, .interactive')) {
            e.preventDefault();
            void this.runPlaybackCommand(
              () => this.togglePlayPause()
            );
          }
          break;
          
        case 'n':
        case 'N':
          if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              void this.runPlaybackCommand(() => this.playNext());
            }
          }
          break;
          
        case 'p':
        case 'P':
          if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              void this.runPlaybackCommand(() => this.playPrevious());
            }
          }
          break;
          
        case 'ArrowRight':
          if (e.ctrlKey) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              void this.runPlaybackCommand(() => this.playNext());
            }
          } else if (e.shiftKey) {
            e.preventDefault();
            void this.runPlaybackCommand(() => this.fastForward());
          }
          break;
          
        case 'ArrowLeft':
          if (e.ctrlKey) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              void this.runPlaybackCommand(() => this.playPrevious());
            }
          } else if (e.shiftKey) {
            e.preventDefault();
            void this.runPlaybackCommand(() => this.rewind());
          }
          break;
          
        case 'f':
        case 'F':
        case '.':
          if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            void this.runPlaybackCommand(() => this.fastForward());
          }
          break;
          
        case 'r':
        case 'R':
          if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            void this.runPlaybackCommand(() => this.rewind());
          }
          break;
          
        case ',':
          if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            void this.runPlaybackCommand(() => this.rewind());
          }
          break;
          

          
        case 'h':
        case 'H':
          if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            void this.runPlaybackCommand(() => this.toggleShuffleMode());
          }
          break;
          
        case 'm':
        case 'M':
          if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            void this.runPlaybackCommand(() => this.toggleRepeatMode());
          }
          break;
          

          

          

          
        default:
          break;
      }
    };

    document.addEventListener('keydown', this.keydownHandler);
  }
  
  /**
   * Fast forward the current track by 10 seconds
   */
  fastForward(userInitiated = true) {
    if (userInitiated) this.audioPlayer.resumeAudioContextInGesture?.();
    if (this.audioPlayer.contextManager) {
      const state = this.audioPlayer.contextManager.getCurrentState();
      const currentTime = state?.currentTrackPosition || 0;
      const duration = state?.currentTrackDuration || 0;
      const newTime = Math.min(currentTime + 10, duration);
      this.audioPlayer.contextManager.seek(newTime);
    } else {
      console.warn('[PlaybackManager] ContextManager not available for fastForward');
    }
  }
  
  /**
   * Rewind the current track by 10 seconds
   */
  rewind(userInitiated = true) {
    if (userInitiated) this.audioPlayer.resumeAudioContextInGesture?.();
    if (this.audioPlayer.contextManager) {
      const state = this.audioPlayer.contextManager.getCurrentState();
      const currentTime = state?.currentTrackPosition || 0;
      const newTime = Math.max(currentTime - 10, 0);
      this.audioPlayer.contextManager.seek(newTime);
    } else {
      console.warn('[PlaybackManager] ContextManager not available for rewind');
    }
  }
  
  /**
   * Load player state from storage
   */
  async loadPlayerState() {
    if (this.audioPlayer.contextManager?.nativeQueueOwned) return;
    const windowRef = typeof window !== 'undefined' ? window : {};
    if (!windowRef.electronAPI || !windowRef.electronIntegration) {
      this.loadPlayerStateFromLocalStorage(windowRef);
      return Promise.resolve();
    }
    
    try {
      const userDataPath = await windowRef.electronAPI.getPath('settings');
      const stateFilePath = await windowRef.electronAPI.joinPaths(userDataPath, 'player-state.json');
      const fileExists = await windowRef.electronAPI.fileExists(stateFilePath);
      
      if (fileExists) {
        const result = await windowRef.electronAPI.readFile(stateFilePath);
        
        if (result.success) {
          const playerState = JSON.parse(result.content);
          this.applyPlayerState(playerState, 'PlaybackManager loadPlayerState');
        }
      }
      return Promise.resolve();
    } catch (error) {
      console.error('Failed to load player state:', error);
      return Promise.resolve();
    }
  }

  loadPlayerStateFromLocalStorage(windowRef = typeof window !== 'undefined' ? window : {}) {
    try {
      const rawState = getSettingsStorage(windowRef)?.getItem('effetune_player_state');
      if (!rawState) return;
      this.applyPlayerState(JSON.parse(rawState), 'PlaybackManager loadPlayerState localStorage');
    } catch (error) {
      console.warn('Failed to load web player state:', error);
    }
  }

  applyPlayerState(playerState, source) {
    if (!this.audioPlayer.stateManager || !playerState || typeof playerState !== 'object') return;

    const updates = {};
    const currentRepeatMode = this.audioPlayer.stateManager.getStateSnapshot?.()?.repeatMode || 'OFF';
    const repeatMode = playerState.repeatMode || currentRepeatMode;
    if (playerState.repeatMode) {
      updates.repeatMode = playerState.repeatMode;
    }
    if (playerState.repeatMode === 'ONE' || playerState.shuffleMode !== undefined) {
      updates.shuffleMode = normalizeShuffleModeForRepeat(repeatMode, playerState.shuffleMode);
    }
    if (Object.keys(updates).length > 0) {
      this.audioPlayer.stateManager.updateState(updates, source);
    }
    const manager = this.audioPlayer.contextManager;
    if (!this.explicitPlayerSettings.has('playerVolume') && Number.isInteger(playerState.playerVolume) &&
        playerState.playerVolume >= 0 && playerState.playerVolume <= 100) {
      manager?.setPlayerVolume?.(playerState.playerVolume);
    }
    if (!this.explicitPlayerSettings.has('playerMute') && typeof playerState.playerMute === 'boolean') {
      manager?.setPlayerMute?.(playerState.playerMute);
    }
  }

  getPersistentPlayerState() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const repeatMode = state?.repeatMode || 'OFF';
    return {
      repeatMode,
      shuffleMode: normalizeShuffleModeForRepeat(repeatMode, state?.shuffleMode),
      playerVolume: state?.playerVolume ?? 100,
      playerMute: state?.playerMute === true
    };
  }

  saveExplicitPlayerSetting(setting) {
    if (this.audioPlayer.contextManager?.nativeQueueOwned) return;
    this.explicitPlayerSettings.add(setting);
    void this.savePlayerState();
  }
  
  /**
   * Save player state to storage
   */
  savePlayerState() {
    if (this.audioPlayer.contextManager?.nativeQueueOwned) return Promise.resolve();
    this.playerStateWrites = this.playerStateWrites.then(async () => {
      await this.audioPlayer.stateRestored;
      await this.#writePlayerState();
    });
    return this.playerStateWrites;
  }

  async #writePlayerState() {
    const windowRef = typeof window !== 'undefined' ? window : {};
    const playerState = this.getPersistentPlayerState();
    if (!windowRef.electronAPI || !windowRef.electronIntegration) {
      try {
        getSettingsStorage(windowRef)?.setItem('effetune_player_state', JSON.stringify(playerState));
      } catch (error) {
        console.warn('Failed to save web player state:', error);
      }
      return;
    }
    
    try {
      const userDataPath = await windowRef.electronAPI.getPath('settings');
      const stateFilePath = await windowRef.electronAPI.joinPaths(userDataPath, 'player-state.json');
      
      await windowRef.electronAPI.saveFile(stateFilePath, JSON.stringify(playerState, null, 2));
    } catch (error) {
      console.error('Failed to save player state:', error);
    }
  }
  
  /**
   * Enhanced clear method with proper cleanup
   */
  clear({ saveSession = true } = {}) {
    if (saveSession) this.removePlaybackSession();
    this.unloadedSessionTrack = null;
    this.sessionMediaTrack = null;
    this.invalidateActivePlayRequest();
    this.cancelPlaybackPending();
    this.sessionTransportUndo = null;
    this.deactivateCatalogSequence();
    this.playlist = [];
    this.originalPlaylist = [];
    this.syncMaterializedSequence();
    this.transitionInProgress = false;
    this.clearFailedTrackSkipState();

    if (!this.audioPlayer) return;
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        playlist: [],
        playlistLength: 0,
        currentTrack: null,
        currentTrackIndex: 0,
        currentTrackName: '',
        artworkUrl: '',
        isTrackPresentationPending: false,
        isPlaying: false,
        isPaused: false,
        isStopped: true,
        currentTrackDuration: 0,
        currentTrackPosition: 0
      }, 'PlaybackManager clear');
    }
    
    this.audioPlayer.contextManager.clearNextTrackBuffer();
    
    if (this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement.pause();
      this.audioPlayer.audioElement.currentTime = 0;
    }
  }

  /**
   * Dispose resources owned by this playback manager
   */
  dispose() {
    clearInterval(this.sessionPositionTimer);
    this.audioPlayer?.playbackSession?.cancelPending(this.audioPlayer);
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    this.repeatModeNormalizer = null;
    this.clear({ saveSession: false });
  }
}

function samePlaybackEntry(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.entryInstanceId && right.entryInstanceId) {
    return left.entryInstanceId === right.entryInstanceId;
  }
  if (left.libraryTrackId && right.libraryTrackId) {
    return left.libraryTrackId === right.libraryTrackId;
  }
  if (left.path && right.path) {
    return left.path === right.path;
  }
  if (left.file && right.file) {
    if (left.file === right.file) return true;
    return left.file.name === right.file.name &&
      left.file.size === right.file.size &&
      left.file.lastModified === right.file.lastModified;
  }
  return false;
}

// Repeat One only replays the track at its natural end; manual Next/Previous
// still moves through the queue (without wrapping, as with Repeat Off).
function manualRepeatMode(repeatMode, manual) {
  const mode = repeatMode ?? 'OFF';
  return manual && mode === 'ONE' ? 'OFF' : mode;
}

function normalizeShuffleModeForRepeat(repeatMode, shuffleMode) {
  return repeatMode === 'ONE' ? false : !!shuffleMode;
}

function nextSequenceCandidateOrdinal({ currentOrdinal, direction, itemCount, wrap }) {
  const nextOrdinal = currentOrdinal + direction;
  if (nextOrdinal >= 0 && nextOrdinal < itemCount) return nextOrdinal;
  if (!wrap) return null;
  return direction < 0 ? itemCount - 1 : 0;
}

function createCatalogPlaylistFacade(sequence, resolvedEntries) {
  return new Proxy(Object.create(null), {
    get(_target, property) {
      if (property === 'length') return sequence.itemCount;
      if (property === 'sequenceId') return sequence.sequenceId;
      if (typeof property === 'string' && /^(0|[1-9]\d*)$/.test(property)) {
        return resolvedEntries.get(Number(property)) ?? null;
      }
      return undefined;
    },
    set() {
      return false;
    }
  });
}

function createResolvedSequenceTrack(entry, source) {
  const track = {
    ...entry,
    name: entry.name || entry.title || entry.fileName || `Track ${entry.transportOrdinal + 1}`,
    libraryTrackId: entry.trackUid ?? entry.libraryTrackId ?? null,
    meta: {
      ...(entry.meta ?? {}),
      title: entry.meta?.title || entry.title || '',
      artist: entry.meta?.artist || entry.artist || entry.albumArtist || '',
      album: entry.meta?.album || entry.album || ''
    },
    sequenceId: entry.sequenceId,
    canonicalOrdinal: entry.canonicalOrdinal,
    transportOrdinal: entry.transportOrdinal,
    ...(Number.isFinite(entry.durationSec) ? { durationSec: entry.durationSec } : {})
  };
  if (Object.prototype.hasOwnProperty.call(source ?? {}, 'path')) track.path = source.path;
  if (Number.isSafeInteger(entry?.size) && entry.size >= 0) track.byteLength = entry.size;
  if (source?.mediaSource !== undefined) track.mediaSource = source.mediaSource;
  if (typeof source?.readBytes === 'function') track.readBytes = source.readBytes;
  if (source?.bytes instanceof ArrayBuffer || ArrayBuffer.isView(source?.bytes)) {
    track.bytes = source.bytes;
  }
  if (source?.kind === 'electron-file') {
    track.sourceKind = source.kind;
    track.folderId = source.folderId ?? null;
    track.sourceLifecycleVersion = source.lifecycleVersion ?? null;
    track.sourceFileName = source.fileName ?? null;
  } else {
    if (typeof source === 'function') track.provider = source;
    if (source?.provider) track.provider = source.provider;
    if (Object.prototype.hasOwnProperty.call(source ?? {}, 'file')) track.file = source.file;
    if (typeof source?.uri === 'string') track.uri = source.uri;
  }
  for (const key of [
    'startFrame',
    'endFrame',
    'durationSec',
    'byteLength',
    'fileSize',
    'physicalSourceKey',
    'canonicalSourceKey',
    'sourceKey'
  ]) {
    if (Object.prototype.hasOwnProperty.call(source ?? {}, key)) track[key] = source[key];
  }
  Object.defineProperty(track, 'entryInstanceId', {
    value: entry.entryInstanceId,
    enumerable: true,
    configurable: false,
    writable: false
  });
  return track;
}

function captureShuffleState(sequence) {
  const descriptor = sequence.getDescriptor?.() ?? {};
  return Object.freeze({
    enabled: Boolean(descriptor.shuffleEnabled),
    seed: descriptor.shuffleSeed ?? 0,
    epoch: descriptor.shuffleEpoch ?? 0,
    transportOffset: descriptor.shuffleTransportOffset ?? 0
  });
}

function createTransportRollback(sequence, previousShuffleState) {
  const plannedShuffleState = captureShuffleState(sequence);
  return Object.freeze({
    previousShuffleState,
    plannedShuffleState,
    shuffleChanged: !sameShuffleState(previousShuffleState, plannedShuffleState)
  });
}

function restorePlannedShuffle(sequence, rollback, { requirePlannedState = true } = {}) {
  if (!rollback?.shuffleChanged || !sequence?.restoreShuffleState) return false;
  if (requirePlannedState && !sameShuffleState(captureShuffleState(sequence), rollback.plannedShuffleState)) {
    return false;
  }
  sequence.restoreShuffleState(rollback.previousShuffleState);
  return true;
}

function sameShuffleState(left, right) {
  return Boolean(left) && Boolean(right) &&
    left.enabled === right.enabled &&
    left.seed === right.seed &&
    left.epoch === right.epoch &&
    left.transportOffset === right.transportOffset;
}

function createCompositeSequenceId(operationId) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36);
  return `composite:${operationId ?? 'queue'}:${suffix}`;
}

function operationError(code, message) {
  const error = new Error(message);
  error.name = 'LibraryPlaybackOperationError';
  error.code = code;
  return error;
}
