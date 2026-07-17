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

export class PlaybackManager {
  constructor(audioPlayer) {
    this.audioPlayer = audioPlayer;
    this.playlist = [];
    this.originalPlaylist = []; // For shuffle mode
    
    // Additional properties for seamless playback
    this.transitionInProgress = false;
    this.seamlessMode = true; // Enable seamless mode by default
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
    this.catalogTrackGeneration = 0;
    this.pendingTransport = new PendingTransportSlot();
    this.transportMediaChain = Promise.resolve();
    this.committedAutomaticMovePlans = new WeakSet();
    this.committedRegionTransportPlans = this.committedAutomaticMovePlans;
    this.activeBulkPlay = null;
    this.sessionTransportUndo = null;
    
    // Initialize keyboard shortcuts
    this.initKeyboardShortcuts();
  }
  
  /**
   * Load files into the playlist
   */
  loadFiles(files, append = false, insertAt = null, {
    deferInitialLoad = false,
    preserveSessionTransportUndo = false
  } = {}) {
    if (!files || files.length === 0) {
      return;
    }
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

    if (input instanceof File) {
      return this.withImmutableEntryInstanceId({
        path: null,
        name: input.name,
        file: input
      });
    }

    if (input && typeof input === 'object') {
      const hasLibraryFields = input.provider || input.meta || input.libraryTrackId || input.path ||
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
        ...(input.libraryTrackId && { libraryTrackId: input.libraryTrackId }),
        ...(input.provider && { provider: input.provider }),
        ...(input.sourceKind && { sourceKind: input.sourceKind }),
        ...(input.physicalSourceKey && { physicalSourceKey: input.physicalSourceKey }),
        ...(input.canonicalSourceKey && { canonicalSourceKey: input.canonicalSourceKey }),
        ...(input.sourceKey && { sourceKey: input.sourceKey })
      };
      for (const key of [
        'byteLength',
        'fileSize',
        'mediaSource',
        'readBytes',
        'bytes',
        'data',
        'startFrame',
        'endFrame',
        'durationSec'
      ]) {
        if (Object.prototype.hasOwnProperty.call(input, key)) track[key] = input[key];
      }
      return this.withImmutableEntryInstanceId(track, input.entryInstanceId);
    }

    return null;
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
  }

  capturePlaybackQueueSnapshot() {
    if (this.catalogSequence) {
      const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
      return {
        kind: 'catalog',
        sequenceId: this.catalogSequence.sequenceId,
        itemCount: this.catalogSequence.itemCount,
        currentOrdinal: state?.currentTrackIndex ?? 0
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
    const currentOrdinal = state?.currentTrackIndex;
    const repeatMode = state?.repeatMode ?? 'OFF';
    const shuffleMode = state?.shuffleMode === true || this.catalogSequence?.shuffleEnabled === true;
    const sequence = this.sequence;
    if (!sequence || state?.isStopped === true ||
        !Number.isSafeInteger(currentOrdinal) || currentOrdinal < 0 ||
        currentOrdinal >= sequence.itemCount) {
      return null;
    }

    let nextOrdinal = repeatMode === 'ONE' ? currentOrdinal : currentOrdinal + 1;
    if (nextOrdinal >= sequence.itemCount) {
      if (repeatMode !== 'ALL') return null;
      if (shuffleMode) return null;
      nextOrdinal = 0;
    }

    const currentStateTrack = state?.currentTrack ?? currentTrack;
    if (currentTrack && currentStateTrack && !samePlaybackEntry(currentStateTrack, currentTrack)) return null;
    const transportCommandGeneration = state?.transportCommandGeneration ?? 0;
    let nextTrack;
    let nextEntry;
    let rawNextTrack = null;
    if (this.catalogSequence) {
      nextEntry = await sequence.getEntry(nextOrdinal);
      const source = await sequence.resolveEntrySource(
        nextEntry,
        createPlaybackSourceResolutionScope()
      );
      nextTrack = createResolvedCatalogTrack(nextEntry, source);
    } else {
      rawNextTrack = this.getTrack(nextOrdinal);
      if (!rawNextTrack) return null;
      nextTrack = typeof this.audioPlayer.contextManager?.resolveTrackProvider === 'function'
        ? await this.audioPlayer.contextManager.resolveTrackProvider(rawNextTrack)
        : rawNextTrack;
      nextEntry = sequence.peekEntry?.(nextOrdinal) ?? null;
    }
    const preparedRequest = typeof this.audioPlayer.contextManager?.createPlaybackRequestSnapshot === 'function'
      ? this.audioPlayer.contextManager.createPlaybackRequestSnapshot(nextTrack, nextOrdinal)
      : null;

    const plan = Object.freeze({
      sequence,
      playbackGeneration: this.playbackGeneration,
      transportCommandGeneration,
      currentOrdinal,
      currentTrack: currentStateTrack,
      currentEntryInstanceId: currentStateTrack?.entryInstanceId ?? null,
      repeatMode,
      shuffleMode,
      shuffleState: captureShuffleState(sequence),
      nextOrdinal,
      nextEntryInstanceId: nextEntry?.entryInstanceId ?? nextTrack?.entryInstanceId ?? null,
      rawNextTrack,
      nextTrack,
      preparedRequest
    });
    return this.isPlannedAutomaticMoveCurrent(plan) ? plan : null;
  }

  isPlannedAutomaticMoveCurrent(plan) {
    if (!plan || this.committedAutomaticMovePlans.has(plan) || plan.sequence !== this.sequence ||
        plan.playbackGeneration !== this.playbackGeneration) return false;
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const shuffleMode = state?.shuffleMode === true || this.catalogSequence?.shuffleEnabled === true;
    if (!state || state.currentTrackIndex !== plan.currentOrdinal ||
        (state.transportCommandGeneration ?? 0) !== plan.transportCommandGeneration ||
        (state.repeatMode ?? 'OFF') !== plan.repeatMode || shuffleMode !== plan.shuffleMode ||
        !sameShuffleState(captureShuffleState(this.sequence), plan.shuffleState) ||
        !samePlaybackEntry(state.currentTrack, plan.currentTrack)) {
      return false;
    }

    if (this.catalogSequence) {
      const entry = this.sequence.peekEntry?.(plan.nextOrdinal) ?? null;
      return !!entry && entry.entryInstanceId === plan.nextEntryInstanceId;
    }
    return this.getTrack(plan.nextOrdinal) === plan.rawNextTrack;
  }

  commitPlannedAutomaticMove(plan, backendStatePatch = {}) {
    if (!this.isPlannedAutomaticMoveCurrent(plan)) return false;
    this.committedAutomaticMovePlans.add(plan);
    this.pendingTransport.invalidate();
    this.catalogTrackGeneration += 1;

    const track = plan.nextTrack;
    if (this.catalogSequence) {
      this.resolvedCatalogEntries.clear();
      this.resolvedCatalogEntries.set(plan.nextOrdinal, track);
    }
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.() ?? {};
    const commandGeneration = (state.transportCommandGeneration ?? 0) + 1;
    const currentTrackName = this.audioPlayer.contextManager?.getDisplayTrackName?.(track) || track?.name || '';
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
    resolutionScope = null
  } = {}) {
    this.pendingTransport.invalidate();
    this.catalogTrackGeneration += 1;
    this.catalogSequence?.clear();
    const sequence = descriptor instanceof CatalogSequence || descriptor instanceof CompositeCatalogSequence
      ? descriptor
      : new CatalogSequence(descriptor);
    this.catalogSequence = sequence;
    this.sequence = sequence;
    this.queueProvider = new SequenceQueueProvider(sequence);
    this.resolvedCatalogEntries.clear();
    this.playlist = createCatalogPlaylistFacade(sequence, this.resolvedCatalogEntries);
    this.originalPlaylist = [];
    if (!preservePlaybackGeneration) this.playbackGeneration += 1;
    const currentTrack = preservePlayback
      ? this.audioPlayer.stateManager?.getStateSnapshot?.().currentTrack ?? null
      : null;
    this.audioPlayer.stateManager?.updateCatalogSequence?.({
      sequenceId: sequence.sequenceId,
      itemCount: sequence.itemCount,
      currentOrdinal,
      currentTrack,
      playbackGeneration: this.playbackGeneration
    });
    void this.refreshCatalogQueueWindow(currentOrdinal);
    if (preservePlayback) {
      this.audioPlayer.contextManager?.refreshActiveRegionTransportPlan?.();
      return { accepted: true, preserved: true };
    }
    return this.selectCatalogOrdinal(currentOrdinal, { play: autoPlay, userInitiated, resolutionScope });
  }

  async refreshCatalogQueueWindow(centerOrdinal = this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0) {
    if (!this.catalogSequence) return null;
    const sequence = this.catalogSequence;
    const window = await this.queueProvider.getWindow(centerOrdinal);
    if (sequence !== this.catalogSequence) return null;
    this.audioPlayer.stateManager?.updateQueueWindow?.(window);
    return window;
  }

  async refreshCatalogQueuePage(startOrdinal) {
    if (!this.catalogSequence) return null;
    const sequence = this.catalogSequence;
    const window = await this.queueProvider.getPage(startOrdinal);
    if (sequence !== this.catalogSequence) return null;
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

  async selectCatalogOrdinal(ordinal, {
    play = true,
    userInitiated = true,
    commandKind = 'select',
    reason = userInitiated ? 'explicit' : 'ended',
    transportRollback = null,
    preserveQueueWindow = false,
    resolutionScope = createPlaybackSourceResolutionScope()
  } = {}) {
    if (!this.catalogSequence) return { accepted: false, reason: 'not-catalog' };
    const activeResolutionScope = resolutionScope ?? createPlaybackSourceResolutionScope();
    this.catalogTrackGeneration += 1;
    const sequence = this.catalogSequence;
    if (reason === 'explicit') {
      this.audioPlayer.contextManager?.invalidateAutomaticMoveForManualCommand?.();
    }
    if (commandKind !== 'audio-reset') {
      this.audioPlayer.stateManager?.applyTransportCommand?.({ type: 'transportSelect', ordinal });
    }
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
      const result = await this.#selectCatalogOrdinalOnce(candidateOrdinal, {
        play,
        userInitiated,
        commandKind,
        reason,
        transportRollback,
        preserveQueueWindow,
        resolutionScope: activeResolutionScope
      });
      if (result.accepted) {
        if (failures.length > 0) this.#reportCatalogSkippedTracks(failures);
        return failures.length > 0 ? { ...result, skippedCount: failures.length } : result;
      }
      if (!['source-unavailable', 'media-load-failed'].includes(result.reason)) return result;
      failures.push({ ordinal: candidateOrdinal, reason: result.reason, error: result.error });
      candidateOrdinal = nextCatalogCandidateOrdinal({
        currentOrdinal: candidateOrdinal,
        direction,
        itemCount: sequence.itemCount,
        wrap: repeatMode === 'ALL'
      });
    }

    if (failures.length > 0) this.#reportCatalogSkippedTracks(failures);
    await this.stopAfterFailedTrackSkipExhausted();
    return { accepted: false, reason: 'no-playable-track', skippedCount: failures.length };
  }

  async #selectCatalogOrdinalOnce(ordinal, {
    play,
    userInitiated,
    commandKind,
    reason,
    transportRollback,
    preserveQueueWindow,
    resolutionScope
  }) {
    const sequence = this.catalogSequence;
    if (!sequence) return { accepted: false, reason: 'not-catalog' };
    const stateBeforeResolution = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const sourceEntryInstanceId = stateBeforeResolution?.currentTrack?.entryInstanceId ?? null;
    const result = await this.pendingTransport.run({
      kind: commandKind,
      playbackGeneration: this.playbackGeneration,
      sourceEntryInstanceId,
      reason
    }, async ({ isCurrent, signal }) => {
      const entry = await sequence.getEntry(ordinal);
      if (!isCurrent() || sequence !== this.catalogSequence) return { committed: false };
      try {
        const source = await sequence.resolveEntrySource(entry, resolutionScope, signal);
        if (!isCurrent() || sequence !== this.catalogSequence) return { committed: false };
        return { committed: true, entry, source, play };
      } catch (error) {
        if (!isCurrent() || sequence !== this.catalogSequence) return { committed: false };
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
    if (!resolution?.committed) return { accepted: false, reason: 'stale' };
    const mediaOperation = async () => {
      if (
        !this.pendingTransport.isGenerationCurrent(result.generation) ||
        sequence !== this.catalogSequence
      ) {
        return { accepted: false, reason: 'stale' };
      }
      const track = createResolvedCatalogTrack(resolution.entry, resolution.source);
      const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
      const previousOrdinal = state?.currentTrackIndex ?? 0;
      const previousTrack = state?.currentTrack ?? this.resolvedCatalogEntries.get(previousOrdinal) ?? null;
      const changedTransport = previousOrdinal !== ordinal || Boolean(transportRollback?.shuffleChanged);
      if (
        !this.pendingTransport.isGenerationCurrent(result.generation) ||
        sequence !== this.catalogSequence
      ) {
        return { accepted: false, reason: 'stale' };
      }
      let played = true;
      try {
        if (resolution.play && state?.isPlaying && this.audioPlayer.contextManager?.transitionToNextTrack) {
          played = await this.audioPlayer.contextManager.transitionToNextTrack(track, ordinal, userInitiated);
        } else if (this.audioPlayer.contextManager?.loadTrack) {
          const loaded = await this.audioPlayer.contextManager.loadTrack(track, ordinal);
          if (resolution.play && loaded !== false && this.audioPlayer.contextManager?.play) {
            played = await this.audioPlayer.contextManager.play(false, userInitiated);
          } else {
            played = loaded;
          }
        } else {
          played = false;
        }
      } catch (error) {
        if (changedTransport) {
          await this.#compensateCatalogTransport({
            sequence,
            ordinal: previousOrdinal,
            track: previousTrack,
            state,
            transportRollback,
            restoreShuffleState: false
          });
        } else {
          this.#restoreCatalogTrackState(previousOrdinal, previousTrack, state);
        }
        return { accepted: false, reason: 'media-load-failed', error };
      }
      if (
        played === false ||
        !this.pendingTransport.isGenerationCurrent(result.generation) ||
        sequence !== this.catalogSequence
      ) {
        if (changedTransport) {
          await this.#compensateCatalogTransport({
            sequence,
            ordinal: previousOrdinal,
            track: previousTrack,
            state,
            transportRollback,
            restoreShuffleState: false
          });
        } else if (played === false) {
          this.#restoreCatalogTrackState(previousOrdinal, previousTrack, state);
        }
        return { accepted: false, reason: played === false ? 'media-load-failed' : 'stale' };
      }
      await this.#commitCatalogTrack(ordinal, track);
      if (!preserveQueueWindow) void this.refreshCatalogQueueWindow(ordinal);
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
    if (userInitiated) this.audioPlayer.resumeAudioContextInGesture?.();
    this.audioPlayer.stateManager?.applyTransportCommand?.({ type: 'transportNext' });
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const currentOrdinal = state?.currentTrackIndex ?? 0;
    const repeatMode = options.ignoreRepeatOne ? 'OFF' : (state?.repeatMode ?? 'OFF');
    const sequence = this.catalogSequence;
    const previousShuffleState = captureShuffleState(sequence);
    const nextOrdinal = sequence.moveTransportOrdinal(currentOrdinal, 1, repeatMode);
    const transportRollback = createTransportRollback(sequence, previousShuffleState);
    if (nextOrdinal === null) {
      if (options.reason !== 'ended') return { accepted: false, reason: 'end' };
      try {
        const result = await this.selectCatalogOrdinal(0, {
          play: false,
          userInitiated: false,
          commandKind: 'ended-reset',
          reason: 'ended',
          transportRollback
        });
        if (!result.accepted) {
          restorePlannedShuffle(sequence, transportRollback);
          return result;
        }
        await this.audioPlayer.contextManager?.stop?.();
        return { ...result, stoppedAtEnd: true };
      } catch (error) {
        restorePlannedShuffle(sequence, transportRollback);
        throw error;
      }
    }
    try {
      const result = await this.selectCatalogOrdinal(nextOrdinal, {
        play: true,
        userInitiated,
        commandKind: 'next',
        reason: options.reason ?? (userInitiated ? 'explicit' : 'ended'),
        transportRollback
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
    if (userInitiated) this.audioPlayer.resumeAudioContextInGesture?.();
    this.audioPlayer.stateManager?.applyTransportCommand?.({ type: 'transportPrevious' });
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const currentOrdinal = state?.currentTrackIndex ?? 0;
    const sequence = this.catalogSequence;
    const previousShuffleState = captureShuffleState(sequence);
    const previousOrdinal = sequence.moveTransportOrdinal(
      currentOrdinal,
      -1,
      state?.repeatMode ?? 'OFF'
    );
    const transportRollback = createTransportRollback(sequence, previousShuffleState);
    if (previousOrdinal === null) {
      return this.selectCatalogOrdinal(currentOrdinal, {
        play: true,
        userInitiated,
        commandKind: 'previous',
        reason: 'explicit',
        transportRollback
      });
    }
    try {
      const result = await this.selectCatalogOrdinal(previousOrdinal, {
        play: true,
        userInitiated,
        commandKind: 'previous',
        reason: 'explicit',
        transportRollback
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
    const ordinal = Number.isSafeInteger(failedOrdinal)
      ? failedOrdinal
      : (this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0);
    this.#reportCatalogSkippedTracks([{
      ordinal,
      reason: 'media-load-failed',
      error
    }]);
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

  async startBulkPlay({
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

  async installBulkPlayProvisional({
    receipt,
    service,
    resolveSource,
    resolutionScope = createPlaybackSourceResolutionScope()
  } = {}) {
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
      operation.provisionalSourceError = error;
      return {
        accepted: true,
        deferred: true,
        operationId: receipt.operationId,
        playbackGeneration
      };
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
    const provisionalTrack = createResolvedCatalogTrack(provisionalEntry, resolution.value);
    this.loadFiles([provisionalTrack], false, null, {
      deferInitialLoad: true,
      preserveSessionTransportUndo: true
    });
    operation.provisionalInstalled = true;
    const loadedTrack = this.playlist[0];
    const mediaOperation = async () => {
      if (
        playbackGeneration !== this.playbackGeneration
      ) {
        return false;
      }
      return this.audioPlayer.contextManager?.seamlessTransition?.(loadedTrack, 0, true);
    };
    const played = await this.transportMediaChain.then(mediaOperation, mediaOperation);
    this.transportMediaChain = Promise.resolve(played).catch(() => {});
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
    if (!operation.provisionalLoaded) {
      const playbackResult = await this.loadCatalogSequence(publishedSequence, {
        currentOrdinal,
        autoPlay: true,
        userInitiated: true,
        preservePlaybackGeneration: true,
        resolutionScope: operation.resolutionScope
      });
      if (operation !== this.activeBulkPlay || operation.playbackGeneration !== this.playbackGeneration) {
        return { accepted: false, reason: 'stale' };
      }
      operation.phase = 'published';
      this.sessionTransportUndo = operation.previousSessionState;
      operation.previousSessionState = null;
      return {
        accepted: true,
        phase: 'published',
        playbackAccepted: playbackResult?.accepted !== false,
        skippedCount: playbackResult?.skippedCount ?? 0
      };
    }
    await this.loadCatalogSequence(publishedSequence, {
      currentOrdinal,
      preservePlayback: true,
      preservePlaybackGeneration: true
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
      preservePlaybackGeneration: true
    });
    if (currentTrack?.entryInstanceId) this.resolvedCatalogEntries.set(currentOrdinal, currentTrack);
    this.audioPlayer.stateManager?.updateState?.({
      currentTrack
    }, `PlaybackManager ${operationKind} destination commit`);
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
      const generation = this.catalogTrackGeneration;
      const entry = await sequence.getEntry(ordinal);
      const latestState = this.audioPlayer.stateManager?.getStateSnapshot?.();
      if (sequence !== this.catalogSequence ||
          generation !== this.catalogTrackGeneration ||
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
        return target.generation === this.catalogTrackGeneration &&
          sequence === this.catalogSequence &&
          currentState?.currentTrackIndex === target.ordinal &&
          samePlaybackEntry(currentState?.currentTrack, track);
      };
      try {
        const source = await sequence.resolveEntrySource(target.entry, resolutionScope);
        if (!isCurrent()) continue;
        const resolvedTrack = createResolvedCatalogTrack(target.entry, source);
        this.resolvedCatalogEntries.set(target.ordinal, resolvedTrack);
        return { handled: false, track: resolvedTrack, ordinal: target.ordinal, isCurrent };
      } catch (error) {
        if (!isCurrent()) continue;
        const result = await this.selectCatalogOrdinal(target.ordinal, {
          play: false,
          userInitiated: false,
          commandKind: 'audio-reset',
          reason: 'audio-reset',
          resolutionScope
        });
        const committed = result?.accepted === true && result.value?.committed === true;
        return {
          handled: true,
          committed,
          ordinal: target.ordinal,
          track: committed ? result.value.entry : null,
          result,
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
    const result = typeof operation.service?.cancel === 'function'
      ? await operation.service.cancel(operationId)
      : { accepted: true };
    if (result?.kind === 'tooLate' || result?.reason === 'tooLate') {
      return { accepted: false, reason: 'tooLate' };
    }
    if (result?.kind === 'cancelRequested') {
      operation.phase = 'cancel-requested';
      return { accepted: true, phase: 'cancel-requested' };
    }
    operation.phase = 'terminal';
    await this.#restoreBulkPlaySession(operation);
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
    return true;
  }

  canUndoSessionTransport() {
    return this.sessionTransportUndo !== null;
  }

  async undoSessionTransport() {
    const snapshot = this.sessionTransportUndo;
    this.sessionTransportUndo = null;
    if (!snapshot) return { kind: 'notAvailable' };
    const restored = await this.#restoreSessionPlaybackState(snapshot);
    if (!restored) return { kind: 'notAvailable' };
    this.activeBulkPlay = null;
    return { kind: 'published' };
  }

  #captureSessionPlaybackState() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.() ?? {};
    const common = {
      currentOrdinal: state.currentTrackIndex ?? 0,
      currentTrack: state.currentTrack ?? null,
      currentTrackPosition: state.currentTrackPosition ?? 0,
      wasPlaying: state.isPlaying === true
    };
    if (this.catalogSequence) {
      return { ...common, kind: 'catalog', sequence: this.catalogSequence };
    }
    return { ...common, kind: 'materialized', snapshot: this.capturePlaybackQueueSnapshot() };
  }

  async #restoreBulkPlaySession(operation) {
    const snapshot = operation?.previousSessionState;
    operation.previousSessionState = null;
    if (!snapshot || !operation.provisionalInstalled ||
        operation.playbackGeneration !== this.playbackGeneration) {
      return false;
    }
    return this.#restoreSessionPlaybackState(snapshot);
  }

  async #restoreSessionPlaybackState(snapshot) {
    if (snapshot.kind === 'catalog' && snapshot.sequence) {
      await this.loadCatalogSequence(snapshot.sequence, {
        currentOrdinal: snapshot.currentOrdinal,
        preservePlayback: true
      });
      this.resolvedCatalogEntries.clear();
      if (snapshot.currentTrack) {
        this.resolvedCatalogEntries.set(snapshot.currentOrdinal, snapshot.currentTrack);
      }
    } else if (snapshot.kind === 'materialized' && this.restorePlaybackQueueSnapshot(snapshot.snapshot)) {
      this.playbackGeneration += 1;
      this.syncPlaylistState(snapshot.currentOrdinal);
    } else {
      return false;
    }
    this.audioPlayer.stateManager?.updateState?.({
      currentTrackIndex: snapshot.currentOrdinal,
      currentTrack: snapshot.currentTrack,
      currentTrackPosition: snapshot.currentTrackPosition,
      playbackGeneration: this.playbackGeneration
    }, 'PlaybackManager bulk Play rollback');
    if (!snapshot.currentTrack) return true;
    if (snapshot.wasPlaying && this.audioPlayer.contextManager?.seamlessTransition) {
      await this.audioPlayer.contextManager.seamlessTransition(
        snapshot.currentTrack,
        snapshot.currentOrdinal,
        true
      );
    } else {
      await this.audioPlayer.contextManager?.loadTrack?.(snapshot.currentTrack, snapshot.currentOrdinal);
    }
    return true;
  }

  deactivateCatalogSequence() {
    this.pendingTransport.invalidate();
    this.catalogTrackGeneration += 1;
    this.catalogSequence?.clear();
    this.catalogSequence = null;
    this.resolvedCatalogEntries.clear();
  }

  async setCatalogShuffleMode(enabled, state = this.audioPlayer.stateManager?.getStateSnapshot?.()) {
    if (!this.catalogSequence) return null;
    this.catalogTrackGeneration += 1;
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

  #reportCatalogSkippedTracks(failures) {
    for (const failure of failures) {
      console.warn(
        `[PlaybackManager] Skipping unavailable catalog occurrence at ordinal ${failure.ordinal}.`,
        failure.error
      );
    }
    globalThis.window?.uiManager?.showTransientMessage?.(
      'status.libraryTracksSkippedOffline',
      false,
      { count: failures.length }
    );
  }

  /**
   * Play the current track
   */
  async play(userInitiated = true) {
    if (this.activePlayRequest?.promise) {
      return this.activePlayRequest.promise;
    }

    const request = {
      token: ++this.playRequestToken,
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

  canResumeCurrentCatalogTrack(state, currentOrdinal) {
    const sequence = this.catalogSequence;
    const contextManager = this.audioPlayer.contextManager;
    const currentTrack = state?.currentTrack;
    if (!sequence || !contextManager ||
        state?.sequenceKind !== 'catalog' ||
        state.sequenceId !== sequence.sequenceId ||
        state.playbackGeneration !== this.playbackGeneration ||
        state.isPaused !== true || state.isStopped === true ||
        !Number.isSafeInteger(currentOrdinal) ||
        currentOrdinal !== state.currentTrackIndex ||
        currentOrdinal < 0 || currentOrdinal >= sequence.itemCount ||
        !currentTrack) {
      return false;
    }

    const resolvedTrack = this.resolvedCatalogEntries.get(currentOrdinal);
    if (resolvedTrack && !samePlaybackEntry(resolvedTrack, currentTrack)) return false;

    if (state.playbackMode === 'bufferSource') {
      return contextManager.hasCurrentBuffer?.() === true;
    }
    if (state.playbackMode !== 'audioElement') return false;

    const audioElement = this.audioPlayer.audioElement;
    if (!audioElement || audioElement.error || audioElement.ended === true) return false;
    const mediaUrl = audioElement.currentSrc || audioElement.src;
    if (typeof mediaUrl !== 'string' || mediaUrl.length === 0) return false;
    if (currentTrack.sourceKind !== 'electron-file') return true;
    const expectedSource = contextManager.getDirectElectronMediaSource?.(currentTrack);
    return typeof expectedSource === 'string' && mediaUrl === expectedSource;
  }

  canResumeCurrentMaterializedTrack(state, currentIndex, currentTrack) {
    if (this.catalogSequence ||
        state?.isPaused !== true || state.isStopped === true ||
        state.playbackMode !== 'audioElement' ||
        state.currentTrackIndex !== currentIndex ||
        !samePlaybackEntry(state.currentTrack, currentTrack)) {
      return false;
    }
    const audioElement = this.audioPlayer.audioElement;
    if (!audioElement || audioElement.error || audioElement.ended === true) return false;
    const mediaUrl = audioElement.currentSrc || audioElement.src;
    return typeof mediaUrl === 'string' && mediaUrl.length > 0;
  }

  async performPlay(request, userInitiated = true) {
    if (this.audioPlayer.contextManager?.hasActiveGraphRebuildRequest?.()) {
      const started = await this.audioPlayer.contextManager.play(false, userInitiated);
      return this.isActivePlayRequest(request) ? started : false;
    }

    if (this.catalogSequence) {
      const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
      const currentOrdinal = state?.currentTrackIndex ??
        this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0;
      if (this.canResumeCurrentCatalogTrack(state, currentOrdinal)) {
        const started = await this.audioPlayer.contextManager.play(false, userInitiated);
        return this.isActivePlayRequest(request) ? started : false;
      }
      const result = await this.selectCatalogOrdinal(currentOrdinal, { play: true, userInitiated });
      return this.isActivePlayRequest(request) && result?.accepted !== false;
    }
    if (this.audioPlayer.contextManager) {
      const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
      const currentTrack = this.getTrack(currentIndex);
      const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
      if (this.canResumeCurrentMaterializedTrack(state, currentIndex, currentTrack)) {
        const started = await this.audioPlayer.contextManager.play(false, userInitiated);
        return this.isActivePlayRequest(request) ? started : false;
      }
      if (currentTrack && !this.audioPlayer.contextManager.hasCurrentBuffer()) {
        const transitioned = await this.audioPlayer.contextManager.seamlessTransition(
          currentTrack,
          currentIndex,
          userInitiated
        );
        return this.isActivePlayRequest(request) ? transitioned : false;
      }

      const started = await this.audioPlayer.contextManager.play(false, userInitiated);
      return this.isActivePlayRequest(request) ? started : false;
    } else {
      console.warn('[PlaybackManager] ContextManager not available for play');
      return false;
    }
  }
  
  /**
   * Pause the current track
   */
  async pause() {
    this.invalidateActivePlayRequest();
    if (this.audioPlayer.contextManager) {
      const wasTransitioning = this.transitionInProgress;
      await this.audioPlayer.contextManager.pause();
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
  async togglePlayPause(onPlayIntent = null) {
    if (!this.audioPlayer.stateManager) {
      console.warn('[PlaybackManager] StateManager not available for togglePlayPause');
      return;
    }
    
    const state = this.audioPlayer.stateManager.getStateSnapshot();
    
    if (this.activePlayRequest || this.transitionInProgress || state.isPlaying) {
      await this.pause();
    } else {
      if (typeof onPlayIntent === 'function') onPlayIntent();
      await this.play();
    }
  }
  
  /**
   * Stop playback and reset position
   */
  async stop() {
    this.invalidateActivePlayRequest();
    const graphRebuildActive = this.audioPlayer.contextManager?.hasActiveGraphRebuildRequest?.() === true;
    if (!graphRebuildActive) {
      this.pendingTransport.invalidate('stopped');
      this.catalogTrackGeneration += 1;
    }
    this.transitionInProgress = false;
    this.clearFailedTrackSkipState();
    if (this.audioPlayer.contextManager) {
      await this.audioPlayer.contextManager.stop();
    } else {
      console.warn('[PlaybackManager] ContextManager not available for stop');
    }
  }

  async restartAudioElement(userInitiated) {
    const contextManager = this.audioPlayer.contextManager;
    contextManager?.invalidateAutomaticMoveForManualCommand?.();
    if (typeof contextManager?.restartAudioElementPlayback === 'function') {
      const restarted = await contextManager.restartAudioElementPlayback();
      if (restarted === false) return false;
    } else if (typeof contextManager?.getCurrentPlaybackTime === 'function' &&
        typeof contextManager.seek === 'function') {
      await contextManager.seek(0);
    } else if (this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement.currentTime = 0;
    }
    return this.play(userInitiated);
  }
  
  /**
   * Enhanced playPrevious with seamless transition
   */
  async playPrevious(userInitiated = true, options = {}) {
    if (this.catalogSequence && options.materializedOnly !== true) {
      return this.transportPrevious(userInitiated);
    }
    if (userInitiated) this.audioPlayer.resumeAudioContextInGesture?.();
    if (this.playlist.length === 0 || this.transitionInProgress) return;
    if (userInitiated) {
      this.audioPlayer.contextManager?.invalidateAutomaticMoveForManualCommand?.();
    }
    this.clearFailedTrackSkipState();
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const shuffleMode = state?.shuffleMode || false;
    const repeatMode = state?.repeatMode || 'OFF';
    
    if (this.audioPlayer.contextManager && this.audioPlayer.contextManager.isUsingBufferPlayback()) {
      const currentTime = this.audioPlayer.contextManager.getCurrentBufferTime();
      if (currentTime > 3) {
        const currentTrack = this.getTrack(currentIndex);
        if (currentTrack) {
          await this.audioPlayer.contextManager.seamlessTransition(
            currentTrack,
            currentIndex,
            userInitiated
          );
        }
        return;
      }
    } else if (this.audioPlayer.audioElement &&
        (this.audioPlayer.contextManager?.getCurrentPlaybackTime?.() ??
          this.audioPlayer.audioElement.currentTime) > 3) {
      await this.restartAudioElement(userInitiated);
      return;
    }
    
    let newIndex;
    
    if (shuffleMode) {
      newIndex = currentIndex - 1;
      
      if (newIndex < 0) {
        if (repeatMode === 'ALL') {
          this.reshufflePlaylist();
          newIndex = this.playlist.length - 1;
        } else {
          if (this.audioPlayer.contextManager && this.audioPlayer.contextManager.isUsingBufferPlayback()) {
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
          return;
        }
      }
    } else {
      newIndex = currentIndex - 1;
      
      if (newIndex < 0) {
        if (repeatMode === 'ALL') {
          newIndex = this.playlist.length - 1;
        } else {
          if (this.audioPlayer.contextManager && this.audioPlayer.contextManager.isUsingBufferPlayback()) {
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
          return;
        }
      }
    }
    
    const prevTrack = this.getTrack(newIndex);
    if (!prevTrack) return;
    
    this.transitionInProgress = true;
    try {
      await this.audioPlayer.contextManager?.transitionToNextTrack?.(
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
  }
  
  /**
   * Enhanced playNext with seamless transition and proper error handling
   */
  async playNext(userInitiated = true, options = {}) {
    if (this.catalogSequence && options.materializedOnly !== true) {
      return this.transportNext(userInitiated, options);
    }
    if (userInitiated) this.audioPlayer.resumeAudioContextInGesture?.();
    if (userInitiated) {
      this.audioPlayer.contextManager?.invalidateAutomaticMoveForManualCommand?.();
    }
    if (this.playlist.length === 0) {
      return;
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
      return;
    }

    if (!failedTrackSkipState) {
      this.clearFailedTrackSkipState();
    } else if (this.hasFailedEveryPlaylistEntry(failedTrackSkipState)) {
      await this.stopAfterFailedTrackSkipExhausted();
      return;
    }
    
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const repeatMode = state?.repeatMode || 'OFF';
    const shuffleMode = state?.shuffleMode || false;
    
    if (repeatMode === 'ONE' && !userInitiated && !ignoreRepeatOne) {
      if (this.audioPlayer.contextManager && this.audioPlayer.contextManager.isUsingBufferPlayback()) {
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
      return;
    }
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const newIndex = this.getNextTrackIndex(currentIndex, repeatMode, shuffleMode, failedTrackSkipState);
    if (newIndex === null) {
      if (failedTrackSkipState && repeatMode === 'ALL') {
        await this.stopAfterFailedTrackSkipExhausted();
      }
      return;
    }
    
    const nextTrack = this.getTrack(newIndex);
    if (!nextTrack) {
      console.warn('[PlaybackManager] No next track available');
      return;
    }
    
    this.transitionInProgress = true;
    
    try {
      let transitionResult = true;
      if (this.audioPlayer.contextManager) {
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
      
    } catch (error) {
      console.error('[PlaybackManager] Transition failed:', error);
      
      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          isTransitioning: false,
          transitionType: null
        }, 'PlaybackManager playNext error');
      }
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
          this.reshufflePlaylist();
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
        this.reshufflePlaylist();
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
      this.audioPlayer.contextManager?.stop?.();
      this.resetToFirstTrack(false);
      return;
    }
    
    this.playNext(false);
  }
  
  /**
   * Reset to first track and prepare buffer
   */
  resetToFirstTrack(autoPlay = true) {
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
          ? this.audioPlayer.contextManager.seamlessTransition(track, finalIndex)
          : this.audioPlayer.contextManager.loadTrack(track, finalIndex);
        loadOperation.catch(error => {
          console.error('[PlaybackManager] Failed to load first track:', error);
        });
      }
    }
  }
  
  /**
   * Shuffle the playlist from the beginning
   */
  shufflePlaylistFromBeginning(autoPlay = true) {
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
    this.resetToFirstTrack(autoPlay);
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
  
  /**
   * Toggle shuffle mode
   */
  async toggleShuffleMode() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    if (state?.repeatMode === 'ONE') return;
    const isCurrentlyPlaying = state?.isPlaying === true;
    const newShuffleMode = !(state?.shuffleMode || false);
    if (this.catalogSequence) {
      await this.setCatalogShuffleMode(newShuffleMode, state);
    } else {
      if (isCurrentlyPlaying && newShuffleMode) {
        this.audioPlayer.resumeAudioContextInGesture?.();
      }

      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          shuffleMode: newShuffleMode
        }, 'PlaybackManager toggleShuffleMode');
      }

      if (newShuffleMode) {
        if (this.audioPlayer.contextManager) {
          this.audioPlayer.contextManager.stop();
        }

        this.shufflePlaylistFromBeginning(isCurrentlyPlaying);
      } else {
        this.disableShuffleModePreservingCurrentTrack(state);
      }
    }

    this.audioPlayer.contextManager?.refreshActiveRegionTransportPlan?.();

    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayerUIState();
    }
    
    this.savePlayerState();
  }
  
  /**
   * Toggle repeat mode (OFF -> ALL -> ONE -> OFF)
   */
  async toggleRepeatMode() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const currentRepeatMode = state?.repeatMode || 'OFF';
    let newRepeatMode;
    let restoredCurrentTrackIndex = null;
    
    switch (currentRepeatMode) {
      case 'OFF':
        newRepeatMode = 'ALL';
        break;
      case 'ALL':
        newRepeatMode = 'ONE';
        
        if (state?.shuffleMode) {
          restoredCurrentTrackIndex = this.catalogSequence
            ? await this.setCatalogShuffleMode(false, state)
            : this.disableShuffleModePreservingCurrentTrack(state);
        }
        break;
      case 'ONE':
        newRepeatMode = 'OFF';
        break;
      default:
        newRepeatMode = 'OFF';
    }
    
    if (this.audioPlayer.stateManager) {
      const updates = {
        repeatMode: newRepeatMode
      };
      if (state?.shuffleMode && newRepeatMode === 'ONE') {
        updates.shuffleMode = false;
        if (restoredCurrentTrackIndex !== null) {
          updates.currentTrackIndex = restoredCurrentTrackIndex;
        }
      }
      this.audioPlayer.stateManager.updateState(updates, 'PlaybackManager toggleRepeatMode');
    }

    this.audioPlayer.contextManager?.refreshActiveRegionTransportPlan?.();
    
    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayerUIState();
    }
    
    this.savePlayerState();
  }
  
  /**
   * Initialize keyboard shortcuts
   */
  runPlaybackCommand(command) {
    try {
      return Promise.resolve(command()).catch(error => {
        console.error('[PlaybackManager] Playback command failed:', error);
        globalThis.window?.uiManager?.setError?.('error.playbackCommandFailed', true);
        return false;
      });
    } catch (error) {
      console.error('[PlaybackManager] Playback command failed:', error);
      globalThis.window?.uiManager?.setError?.('error.playbackCommandFailed', true);
      return Promise.resolve(false);
    }
  }

  initKeyboardShortcuts() {
    if (this.keydownHandler) return;

    this.keydownHandler = (e) => {
      // Check if audio player is initialized
      if (!this.audioPlayer) return;
      
      if (e.target.matches('input:not([type="range"]), textarea, select')) {
        return;
      }
      
      switch (e.key) {
        case ' ':
          if (!e.target.matches('button, [role="button"], a, .interactive')) {
            e.preventDefault();
            void this.runPlaybackCommand(
              () => this.togglePlayPause(() => this.audioPlayer.resumeAudioContextInGesture?.())
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
    const windowRef = typeof window !== 'undefined' ? window : {};
    if (!windowRef.electronAPI || !windowRef.electronIntegration) {
      this.loadPlayerStateFromLocalStorage(windowRef);
      return Promise.resolve();
    }
    
    try {
      const userDataPath = await windowRef.electronAPI.getPath('userData');
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
      const rawState = windowRef.localStorage?.getItem('effetune_player_state');
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
  }

  getPersistentPlayerState() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const repeatMode = state?.repeatMode || 'OFF';
    return {
      repeatMode,
      shuffleMode: normalizeShuffleModeForRepeat(repeatMode, state?.shuffleMode)
    };
  }
  
  /**
   * Save player state to storage
   */
  async savePlayerState() {
    const windowRef = typeof window !== 'undefined' ? window : {};
    const playerState = this.getPersistentPlayerState();
    if (!windowRef.electronAPI || !windowRef.electronIntegration) {
      try {
        windowRef.localStorage?.setItem('effetune_player_state', JSON.stringify(playerState));
      } catch (error) {
        console.warn('Failed to save web player state:', error);
      }
      return;
    }
    
    try {
      const userDataPath = await windowRef.electronAPI.getPath('userData');
      const stateFilePath = await windowRef.electronAPI.joinPaths(userDataPath, 'player-state.json');
      
      await windowRef.electronAPI.saveFile(stateFilePath, JSON.stringify(playerState, null, 2));
    } catch (error) {
      console.error('Failed to save player state:', error);
    }
  }
  
  /**
   * Enhanced clear method with proper cleanup
   */
  clear() {
    this.invalidateActivePlayRequest();
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
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    this.clear();
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

function normalizeShuffleModeForRepeat(repeatMode, shuffleMode) {
  return repeatMode === 'ONE' ? false : !!shuffleMode;
}

function nextCatalogCandidateOrdinal({ currentOrdinal, direction, itemCount, wrap }) {
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

function createResolvedCatalogTrack(entry, source) {
  const track = {
    name: entry.name || entry.title || entry.fileName || `Track ${entry.transportOrdinal + 1}`,
    libraryTrackId: entry.trackUid ?? entry.libraryTrackId ?? null,
    meta: {
      title: entry.title || entry.name || '',
      artist: entry.artist || entry.albumArtist || '',
      album: entry.album || ''
    },
    sequenceId: entry.sequenceId,
    canonicalOrdinal: entry.canonicalOrdinal,
    transportOrdinal: entry.transportOrdinal,
    ...(Number.isFinite(entry.durationSec) ? { durationSec: entry.durationSec } : {})
  };
  if (source?.path) track.path = source.path;
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
    if (source?.file) track.file = source.file;
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
