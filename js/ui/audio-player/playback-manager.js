/**
 * PlaybackManager - Handles playlist management and playback control
 * Includes functionality for playback modes, state management, and keyboard shortcuts
 */
import {
  CatalogSequence,
  CompositeCatalogSequence,
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
    this.transportVersion = 0;
    this.durableTransportDescriptor = null;
    this.playbackGeneration = 0;
    this.pendingTransport = new PendingTransportSlot({
      runtime: globalThis.window?.electronAPI?.libraryCatalogV1 ? 'electron' : 'web'
    });
    this.transportMediaChain = Promise.resolve();
    this.activeBulkPlay = null;
    
    // Initialize keyboard shortcuts
    this.initKeyboardShortcuts();
  }
  
  /**
   * Load files into the playlist
   */
  loadFiles(files, append = false, insertAt = null) {
    if (!files || files.length === 0) {
      return;
    }
    
    if (!append) {
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
    
    if (shuffleMode && !append) {
      const isCurrentlyPlaying = state?.isPlaying || false;
      this.shufflePlaylistFromBeginning(isCurrentlyPlaying);
    }
    
    this.syncMaterializedSequence();
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updatePlaylist(this.playlist, nextIndex);
    }

    if (append && this.audioPlayer.contextManager?.nextBuffer) {
      // The pre-decoded next-track buffer may no longer match the track that
      // follows the current one (e.g. library 'Play Next' insert, or append
      // after the last track with repeat ALL). Drop it and re-prepare.
      this.audioPlayer.contextManager.clearNextTrackBuffer();
      this.audioPlayer.contextManager.prepareNextTrackBufferWithRepeatMode();
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
      const hasLibraryFields = input.provider || input.meta || input.libraryTrackId || input.path || input.file || input.name;
      if (!hasLibraryFields) return null;
      const metaTitle = input.meta?.title;
      const metaArtist = input.meta?.artist;
      const fallbackName = input.path ? input.path.split(/[\\/]/).pop() : 'Track';
      return this.withImmutableEntryInstanceId({
        path: input.path || null,
        name: input.name || (metaArtist && metaTitle ? `${metaArtist} - ${metaTitle}` : (metaTitle || fallbackName)),
        file: input.file || null,
        ...(input.meta && { meta: input.meta }),
        ...(input.libraryTrackId && { libraryTrackId: input.libraryTrackId }),
        ...(input.provider && { provider: input.provider })
      }, input.entryInstanceId);
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
        currentOrdinal: state?.currentTrackIndex ?? 0,
        transportVersion: this.transportVersion
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

  getQueueProvider() {
    return this.queueProvider;
  }

  async loadCatalogSequence(descriptor, {
    currentOrdinal = 0,
    autoPlay = false,
    userInitiated = true,
    preservePlayback = false,
    preservePlaybackGeneration = false
  } = {}) {
    this.pendingTransport.invalidate();
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
    if (Number.isSafeInteger(descriptor?.transportVersion)) {
      this.transportVersion = descriptor.transportVersion;
    }
    if (descriptor?.transportDescriptor?.segments) {
      this.durableTransportDescriptor = descriptor.transportDescriptor;
    }
    const currentTrack = preservePlayback
      ? this.audioPlayer.stateManager?.getStateSnapshot?.().currentTrack ?? null
      : null;
    this.audioPlayer.stateManager?.updateCatalogSequence?.({
      sequenceId: sequence.sequenceId,
      itemCount: sequence.itemCount,
      currentOrdinal,
      currentTrack,
      transportVersion: this.transportVersion,
      playbackGeneration: this.playbackGeneration
    });
    void this.refreshCatalogQueueWindow(currentOrdinal);
    if (preservePlayback) return { accepted: true, preserved: true };
    return this.selectCatalogOrdinal(currentOrdinal, { play: autoPlay, userInitiated });
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
      transportVersion: this.transportVersion,
      playbackGeneration: this.playbackGeneration
    });
  }

  async selectCatalogOrdinal(ordinal, {
    play = true,
    userInitiated = true,
    commandKind = 'select',
    reason = userInitiated ? 'explicit' : 'ended',
    transportRollback = null
  } = {}) {
    if (!this.catalogSequence) return { accepted: false, reason: 'not-catalog' };
    const sequence = this.catalogSequence;
    if (reason === 'explicit') {
      this.audioPlayer.contextManager?.invalidatePendingTransitionRequests?.();
    }
    this.audioPlayer.stateManager?.applyTransportCommand?.({ type: 'transportSelect', ordinal });
    const stateBeforeResolution = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const sourceEntryInstanceId = stateBeforeResolution?.currentTrack?.entryInstanceId ?? null;
    const result = await this.pendingTransport.run({
      kind: commandKind,
      playbackGeneration: this.playbackGeneration,
      sourceEntryInstanceId,
      reason
    }, async ({ isCurrent }) => {
      const entry = await sequence.getEntry(ordinal);
      if (!isCurrent() || sequence !== this.catalogSequence) return { committed: false };
      if (!play) {
        return { committed: true, entry, source: null, play: false };
      }
      const source = await sequence.resolveEntrySource(entry);
      if (!isCurrent() || sequence !== this.catalogSequence) return { committed: false };
      return { committed: true, entry, source, play: true };
    });
    if (!result.accepted) {
      this.audioPlayer.contextManager?.invalidatePendingTransitionRequests?.();
      return result;
    }
    const resolution = result.value;
    if (!resolution?.committed) return { accepted: false, reason: 'stale' };
    const mediaOperation = async () => {
      if (
        !this.pendingTransport.isGenerationCurrent(result.generation) ||
        sequence !== this.catalogSequence
      ) {
        return { accepted: false, reason: 'stale' };
      }
      if (!resolution.play) {
        try {
          await this.#commitCatalogTrack(ordinal, resolution.entry);
        } catch (error) {
          restorePlannedShuffle(sequence, transportRollback);
          throw error;
        }
        void this.refreshCatalogQueueWindow(ordinal);
        return { accepted: true, value: { committed: true, entry: resolution.entry } };
      }
      const track = createResolvedCatalogTrack(resolution.entry, resolution.source);
      const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
      const previousOrdinal = state?.currentTrackIndex ?? 0;
      const previousTrack = state?.currentTrack ?? this.resolvedCatalogEntries.get(previousOrdinal) ?? null;
      const previousDescriptor = transportRollback?.previousDescriptor ??
        createDurableTransportDescriptor(sequence, this.durableTransportDescriptor, previousOrdinal);
      const changedTransport = previousOrdinal !== ordinal || Boolean(transportRollback?.shuffleChanged);
      try {
        await this.#commitCatalogTrack(ordinal, track);
      } catch (error) {
        restorePlannedShuffle(sequence, transportRollback);
        throw error;
      }
      if (
        !this.pendingTransport.isGenerationCurrent(result.generation) ||
        sequence !== this.catalogSequence
      ) {
        if (changedTransport) {
          await this.#compensateCatalogTransport({
            sequence,
            descriptor: previousDescriptor,
            ordinal: previousOrdinal,
            track: previousTrack,
            state,
            transportRollback
          });
        }
        return { accepted: false, reason: 'stale' };
      }
      let played = true;
      try {
        if (state?.isPlaying && this.audioPlayer.contextManager?.transitionToNextTrack) {
          played = await this.audioPlayer.contextManager.transitionToNextTrack(track, ordinal, userInitiated);
        } else if (this.audioPlayer.contextManager?.loadTrack) {
          const loaded = await this.audioPlayer.contextManager.loadTrack(track, ordinal);
          if (loaded !== false && this.audioPlayer.contextManager?.play) {
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
            descriptor: previousDescriptor,
            ordinal: previousOrdinal,
            track: previousTrack,
            state,
            transportRollback
          });
        }
        throw error;
      }
      if (
        played === false ||
        !this.pendingTransport.isGenerationCurrent(result.generation) ||
        sequence !== this.catalogSequence
      ) {
        if (changedTransport) {
          await this.#compensateCatalogTransport({
            sequence,
            descriptor: previousDescriptor,
            ordinal: previousOrdinal,
            track: previousTrack,
            state,
            transportRollback
          });
        }
        return { accepted: false, reason: played === false ? 'media-load-failed' : 'stale' };
      }
      void this.refreshCatalogQueueWindow(ordinal);
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
    const previousDescriptor = createDurableTransportDescriptor(
      sequence,
      this.durableTransportDescriptor,
      currentOrdinal
    );
    const nextOrdinal = sequence.moveTransportOrdinal(currentOrdinal, 1, repeatMode);
    if (nextOrdinal === null) return { accepted: false, reason: 'end' };
    const transportRollback = createTransportRollback(sequence, previousShuffleState, previousDescriptor);
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
    const previousDescriptor = createDurableTransportDescriptor(
      sequence,
      this.durableTransportDescriptor,
      currentOrdinal
    );
    const previousOrdinal = sequence.moveTransportOrdinal(
      currentOrdinal,
      -1,
      state?.repeatMode ?? 'OFF'
    );
    const transportRollback = createTransportRollback(sequence, previousShuffleState, previousDescriptor);
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

  contextPlayNext(selectionDescriptor, {
    service = this.audioPlayer.libraryOperationService,
    clientRequestId,
    expectedTransportVersion = this.transportVersion,
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
    const requestId = clientRequestId ?? globalThis.crypto?.randomUUID?.();
    if (!requestId) {
      return Promise.reject(operationError('cryptoUnavailable', 'Secure operation request IDs are unavailable'));
    }
    return service.start({
      clientRequestId: requestId,
      operationKind: 'playNext',
      selectionDescriptor,
      target,
      expectedTargetVersion: expectedTransportVersion,
      options
    });
  }

  async startBulkPlay({
    selectionDescriptor,
    provisionalEntry,
    service = this.audioPlayer.libraryOperationService,
    clientRequestId,
    expectedTransportVersion = this.transportVersion,
    options = {}
  } = {}) {
    if (this.activeBulkPlay && this.activeBulkPlay.phase !== 'terminal') {
      throw operationError('busy', 'A bulk Play operation is already active');
    }
    if (typeof service?.start !== 'function') {
      throw operationError('operationUnavailable', 'Bulk Play service is unavailable');
    }
    const requestId = clientRequestId ?? globalThis.crypto?.randomUUID?.();
    if (!requestId) throw operationError('cryptoUnavailable', 'Secure operation request IDs are unavailable');
    const receipt = await service.start({
      clientRequestId: requestId,
      operationKind: 'play',
      selectionDescriptor,
      target: null,
      expectedTargetVersion: expectedTransportVersion,
      options
    });
    const entry = receipt?.provisionalEntry ?? provisionalEntry;
    if (!entry) throw operationError('invalidOperationResult', 'Bulk Play did not provide a provisional entry');
    return this.installBulkPlayProvisional({
      receipt: { ...receipt, provisionalEntry: entry },
      service,
      expectedTransportVersion,
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
    expectedTransportVersion = this.transportVersion,
    resolveSource
  } = {}) {
    const entry = receipt?.provisionalEntry;
    const trackUid = entry?.trackUid ?? entry?.libraryTrackId;
    if (!entry?.entryInstanceId || !trackUid) {
      throw operationError('invalidOperationResult', 'Bulk Play provisional entry is invalid');
    }
    if (this.transportVersion !== expectedTransportVersion) {
      throw operationError('staleTransportVersion', 'Playback transport changed before provisional install');
    }
    if (typeof resolveSource !== 'function') {
      throw operationError('sourceUnavailable', 'Bulk Play source resolver is unavailable');
    }
    const provisionalTransportVersion = entry.transportVersion ?? receipt.transportVersion;
    const provisionalTransportDescriptor = entry.transportDescriptor ?? receipt.transportDescriptor;
    if (provisionalTransportVersion !== expectedTransportVersion + 1 ||
        !isProvisionalTransportDescriptor(provisionalTransportDescriptor)) {
      throw operationError(
        'invalidOperationResult',
        'Bulk Play provisional entry omitted its durable transport authority'
      );
    }
    this.transportVersion = provisionalTransportVersion;
    this.durableTransportDescriptor = provisionalTransportDescriptor;
    const playbackGeneration = ++this.playbackGeneration;
    const resolution = await this.pendingTransport.run({
      kind: 'play-replace',
      playbackGeneration,
      sourceEntryInstanceId: entry.entryInstanceId,
      reason: 'explicit',
      priority: 3
    }, async ({ isCurrent }) => {
      const source = await resolveSource(entry);
      return isCurrent() ? source : null;
    });
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
    this.loadFiles([provisionalTrack], false);
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
      playbackGeneration,
      transportVersion: this.transportVersion
    }, 'PlaybackManager bulk Play provisional');
    this.activeBulkPlay = {
      operationId: receipt.operationId,
      phase: 'building',
      service,
      playbackGeneration,
      expectedTransportVersion,
      provisionalTransportVersion: this.transportVersion,
      provisionalEntryInstanceId: loadedTrack.entryInstanceId,
      undoId: entry.undoId ?? receipt.undoId ?? null,
      undoExpiresAt: entry.undoExpiresAt ?? receipt.undoExpiresAt ?? null
    };
    return {
      accepted: true,
      operationId: receipt.operationId,
      playbackGeneration,
      transportVersion: this.transportVersion,
      undoId: this.activeBulkPlay.undoId,
      undoExpiresAt: this.activeBulkPlay.undoExpiresAt
    };
  }

  async publishBulkPlaySequence({ operationId, transportVersion, transportDescriptor, ...descriptor } = {}) {
    const operation = this.activeBulkPlay;
    if (!operation || operation.operationId !== operationId || operation.phase !== 'building') {
      return { accepted: false, reason: 'stale' };
    }
    if (descriptor.expectedTransportVersion !== undefined &&
        descriptor.expectedTransportVersion !== operation.expectedTransportVersion) {
      throw operationError('staleTransportVersion', 'Bulk Play transport version changed');
    }
    if (this.transportVersion !== operation.provisionalTransportVersion) {
      throw operationError('staleTransportVersion', 'Bulk Play transport changed after provisional install');
    }
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const position = state?.currentTrackPosition ?? 0;
    const currentTrack = state?.currentTrack ?? this.playlist[0] ?? null;
    if (transportVersion !== operation.provisionalTransportVersion) {
      throw operationError('staleTransportVersion', 'Bulk Play durable transport version is invalid');
    }
    const publishedSequence = descriptor instanceof CatalogSequence || descriptor instanceof CompositeCatalogSequence
      ? descriptor
      : new CatalogSequence(descriptor);
    const publishedCurrentOrdinal = descriptor.currentOrdinal ?? 0;
    const publishedCurrentEntry = await publishedSequence.getEntry(publishedCurrentOrdinal);
    if (publishedCurrentEntry.entryInstanceId !== operation.provisionalEntryInstanceId) {
      throw operationError('stalePlaybackEntry', 'Published sequence no longer matches the provisional track');
    }
    await this.loadCatalogSequence(publishedSequence, {
      currentOrdinal: publishedCurrentOrdinal,
      preservePlayback: true,
      preservePlaybackGeneration: true
    });
    this.transportVersion = transportVersion;
    this.durableTransportDescriptor = transportDescriptor;
    if (operation !== this.activeBulkPlay || operation.playbackGeneration !== this.playbackGeneration) {
      return { accepted: false, reason: 'stale' };
    }
    this.audioPlayer.stateManager?.updateState?.({
      currentTrack,
      currentTrackPosition: position,
      transportVersion: this.transportVersion,
      playbackGeneration: this.playbackGeneration
    }, 'PlaybackManager bulk Play publish');
    operation.phase = 'published';
    return { accepted: true, phase: 'published', transportVersion: this.transportVersion };
  }

  async commitCatalogDestination({
    operationId,
    operationKind,
    sequence,
    expectedTransportVersion,
    transportVersion,
    transportDescriptor
  } = {}) {
    if (!(sequence instanceof CatalogSequence) && !(sequence instanceof CompositeCatalogSequence)) {
      throw operationError('invalidOperationResult', 'Catalog operation sequence is invalid');
    }
    if (operationKind === 'play') {
      return this.publishBulkPlaySequence({
        operationId,
        ...sequenceToRuntimeDescriptor(sequence),
        expectedTransportVersion,
        transportVersion,
        transportDescriptor,
        currentOrdinal: 0
      });
    }
    if (operationKind !== 'playNext' && operationKind !== 'queue') {
      throw operationError('invalidOperationResult', 'Playback destination is invalid');
    }
    if (this.transportVersion !== expectedTransportVersion) {
      throw operationError('staleTransportVersion', 'Playback transport changed before destination commit');
    }
    if (transportVersion !== expectedTransportVersion + 1 ||
        !transportDescriptor || !Array.isArray(transportDescriptor.segments)) {
      throw operationError('invalidOperationResult', 'Playback destination omitted authoritative transport state');
    }
    const currentSequence = this.catalogSequence ?? this.sequence;
    if (!currentSequence?.itemCount) {
      await this.loadCatalogSequence(sequence, { currentOrdinal: 0, autoPlay: false });
      this.transportVersion = transportVersion;
      this.durableTransportDescriptor = transportDescriptor;
      return { accepted: true, transportVersion: this.transportVersion };
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
      sequenceId: createCompositeSequenceId(operationId, this.transportVersion + 1),
      segments
    });
    const currentTrack = state?.currentTrack ?? null;
    this.transportVersion = transportVersion;
    this.durableTransportDescriptor = transportDescriptor;
    await this.loadCatalogSequence(composite, {
      currentOrdinal,
      preservePlayback: true,
      preservePlaybackGeneration: true
    });
    if (currentTrack?.entryInstanceId) this.resolvedCatalogEntries.set(currentOrdinal, currentTrack);
    this.audioPlayer.stateManager?.updateState?.({
      currentTrack,
      transportVersion: this.transportVersion
    }, `PlaybackManager ${operationKind} destination commit`);
    return { accepted: true, transportVersion: this.transportVersion };
  }

  async cancelBulkPlay(operationId) {
    const operation = this.activeBulkPlay;
    if (!operation || operation.operationId !== operationId) {
      return { accepted: false, reason: 'stale' };
    }
    if (operation.phase === 'published') {
      return { accepted: false, reason: 'tooLate' };
    }
    const result = typeof operation.service?.cancel === 'function'
      ? await operation.service.cancel(operationId)
      : { accepted: true };
    if (result?.reason === 'tooLate') {
      operation.phase = 'published';
      return { accepted: false, reason: 'tooLate' };
    }
    operation.phase = 'terminal';
    return {
      accepted: true,
      phase: 'cancelled',
      undoId: operation.undoId,
      undoExpiresAt: operation.undoExpiresAt
    };
  }

  deactivateCatalogSequence() {
    this.pendingTransport.invalidate();
    this.catalogSequence?.clear();
    this.catalogSequence = null;
    this.resolvedCatalogEntries.clear();
  }

  async setCatalogShuffleMode(enabled, state = this.audioPlayer.stateManager?.getStateSnapshot?.()) {
    if (!this.catalogSequence) return null;
    const previousShuffle = this.catalogSequence.getDescriptor();
    const oldOrdinal = state?.currentTrackIndex ?? 0;
    const canonicalOrdinal = this.catalogSequence.toCanonicalOrdinal(oldOrdinal);
    const currentTrack = state?.currentTrack ?? this.resolvedCatalogEntries.get(oldOrdinal) ?? null;
    this.catalogSequence.setShuffle(enabled);
    const newOrdinal = this.catalogSequence.toTransportOrdinal(canonicalOrdinal);
    try {
      await this.#commitDurableTransport(createDurableTransportDescriptor(
        this.catalogSequence,
        this.durableTransportDescriptor,
        newOrdinal
      ));
    } catch (error) {
      this.catalogSequence.restoreShuffleState({
        enabled: previousShuffle.shuffleEnabled,
        seed: previousShuffle.shuffleSeed,
        epoch: previousShuffle.shuffleEpoch,
        transportOffset: previousShuffle.shuffleTransportOffset
      });
      throw error;
    }
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
    const previousOrdinal = this.audioPlayer.stateManager?.getCurrentTrackIndex?.();
    if (previousOrdinal !== ordinal) {
      await this.#commitDurableTransport(createDurableTransportDescriptor(
        this.catalogSequence,
        this.durableTransportDescriptor,
        ordinal
      ));
    }
    this.resolvedCatalogEntries.clear();
    if (track?.path || track?.file || track?.provider) this.resolvedCatalogEntries.set(ordinal, track);
    this.audioPlayer.stateManager?.updateState?.({
      currentTrackIndex: ordinal,
      currentTrack: track,
      playlistLength: this.catalogSequence.itemCount,
      sequenceKind: 'catalog',
      sequenceId: this.catalogSequence.sequenceId,
      transportVersion: this.transportVersion,
      playbackGeneration: this.playbackGeneration
    }, 'PlaybackManager catalog track');
  }

  async #compensateCatalogTransport({
    sequence,
    descriptor,
    ordinal,
    track,
    state,
    transportRollback
  }) {
    if (sequence !== this.catalogSequence) return false;
    await this.#commitDurableTransport(descriptor);
    restorePlannedShuffle(sequence, transportRollback, { requirePlannedState: false });
    this.resolvedCatalogEntries.clear();
    if (track?.path || track?.file || track?.provider) this.resolvedCatalogEntries.set(ordinal, track);
    this.audioPlayer.stateManager?.updateState?.({
      currentTrackIndex: ordinal,
      currentTrack: track,
      currentTrackPosition: state?.currentTrackPosition ?? 0,
      transportVersion: this.transportVersion,
      playbackGeneration: this.playbackGeneration
    }, 'PlaybackManager catalog transport compensation');
    return true;
  }

  async #commitDurableTransport(descriptor) {
    const expectedTransportVersion = this.transportVersion;
    const service = this.audioPlayer.libraryOperationService;
    if (typeof service?.commitTransportCommand !== 'function') {
      this.transportVersion = expectedTransportVersion + 1;
      this.durableTransportDescriptor = descriptor;
      return;
    }
    const result = await service.commitTransportCommand({ expectedTransportVersion, descriptor });
    if (result?.kind === 'conflict') {
      throw operationError('staleTransportVersion', 'Playback transport changed before command commit');
    }
    if (result?.kind !== 'published' || result.transportVersion !== expectedTransportVersion + 1) {
      throw operationError('invalidOperationResult', 'Playback transport authority returned an invalid commit');
    }
    this.transportVersion = result.transportVersion;
    this.durableTransportDescriptor = result.descriptor;
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

  async performPlay(request, userInitiated = true) {
    if (this.catalogSequence) {
      const currentOrdinal = this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0;
      const result = await this.selectCatalogOrdinal(currentOrdinal, { play: true, userInitiated });
      return this.isActivePlayRequest(request) && result?.accepted !== false;
    }
    if (this.audioPlayer.contextManager) {
      const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
      const currentTrack = this.getTrack(currentIndex);
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
    this.transitionInProgress = false;
    this.clearFailedTrackSkipState();
    if (this.audioPlayer.contextManager) {
      await this.audioPlayer.contextManager.stop();
    } else {
      console.warn('[PlaybackManager] ContextManager not available for stop');
    }
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
    } else if (this.audioPlayer.audioElement && this.audioPlayer.audioElement.currentTime > 3) {
      this.audioPlayer.audioElement.currentTime = 0;
      await this.play(userInitiated);
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
            this.audioPlayer.audioElement.currentTime = 0;
            await this.play(userInitiated);
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
            this.audioPlayer.audioElement.currentTime = 0;
            await this.play(userInitiated);
          }
          return;
        }
      }
    }
    
    const prevTrack = this.getTrack(newIndex);
    if (!prevTrack) return;
    
    if (this.seamlessMode && state?.isPlaying && !state?.isPaused) {
      this.transitionInProgress = true;
      
      try {
        await this.audioPlayer.contextManager.loadTrack(prevTrack, newIndex);
        await this.audioPlayer.contextManager.play(false, userInitiated);
        
        if (this.audioPlayer.stateManager) {
          this.audioPlayer.stateManager.updateState({
            currentTrackIndex: newIndex
          }, 'PlaybackManager playPrevious seamless');
        }
        
      } catch (error) {
        console.warn('Seamless transition failed, using fallback:', error);
        if (this.audioPlayer.stateManager) {
          this.audioPlayer.stateManager.updateState({
            currentTrackIndex: newIndex
          }, 'PlaybackManager playPrevious fallback');
        }
        const loaded = await this.audioPlayer.loadTrack?.(newIndex);
        if (loaded !== false) {
          await this.play(userInitiated);
        }
      } finally {
        this.transitionInProgress = false;
      }
    } else {
      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          currentTrackIndex: newIndex
        }, 'PlaybackManager playPrevious');
      }
      const loaded = await this.audioPlayer.loadTrack?.(newIndex);
      if (loaded !== false) {
        await this.play(userInitiated);
      }
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
        this.audioPlayer.audioElement.currentTime = 0;
        this.play(userInitiated);
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
      void this.transportNext(false).catch(error => {
        console.error('[PlaybackManager] Catalog transport Next failed:', error);
      });
      return;
    }
    
    const repeatMode = state?.repeatMode || 'OFF';
    const shuffleMode = state?.shuffleMode || false;
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const isLastTrack = currentIndex >= this.playlist.length - 1;
    
    if (repeatMode === 'ONE') {
      const currentTrack = this.getTrack(currentIndex);
      if (currentTrack && this.audioPlayer.contextManager) {
        this.audioPlayer.contextManager.seamlessTransition(currentTrack, currentIndex, false).catch(error => {
          console.error('[PlaybackManager] Failed to restart track in repeat ONE mode:', error);
        });
      }
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
      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          currentTrackIndex: 0
        }, 'PlaybackManager onTrackEnded repeat OFF');
      }
      
      if (this.audioPlayer.contextManager) {
        this.audioPlayer.contextManager.stop();
      }
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
      this.audioPlayer.ui?.updatePlayerUIState?.();
      this.savePlayerState();
      return;
    }
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
    
    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayerUIState();
    }
    
    this.savePlayerState();
  }
  
  /**
   * Initialize keyboard shortcuts
   */
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
            this.togglePlayPause(() => this.audioPlayer.resumeAudioContextInGesture?.());
          }
          break;
          
        case 'n':
        case 'N':
          if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              this.playNext();
            }
          }
          break;
          
        case 'p':
        case 'P':
          if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              this.playPrevious();
            }
          }
          break;
          
        case 'ArrowRight':
          if (e.ctrlKey) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              this.playNext();
            }
          } else if (e.shiftKey) {
            e.preventDefault();
            this.fastForward();
          }
          break;
          
        case 'ArrowLeft':
          if (e.ctrlKey) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              this.playPrevious();
            }
          } else if (e.shiftKey) {
            e.preventDefault();
            this.rewind();
          }
          break;
          
        case 'f':
        case 'F':
        case '.':
          if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.fastForward();
          }
          break;
          
        case 'r':
        case 'R':
          if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.rewind();
          }
          break;
          
        case ',':
          if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.rewind();
          }
          break;
          

          
        case 'h':
        case 'H':
          if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.toggleShuffleMode();
          }
          break;
          
        case 'm':
        case 'M':
          if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.toggleRepeatMode();
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
      artist: entry.artist || '',
      album: entry.album || ''
    },
    sequenceId: entry.sequenceId,
    canonicalOrdinal: entry.canonicalOrdinal,
    transportOrdinal: entry.transportOrdinal
  };
  if (typeof source === 'function') track.provider = source;
  if (source?.provider) track.provider = source.provider;
  if (source?.path) track.path = source.path;
  if (source?.file) track.file = source.file;
  Object.defineProperty(track, 'entryInstanceId', {
    value: entry.entryInstanceId,
    enumerable: true,
    configurable: false,
    writable: false
  });
  return track;
}

function sequenceToRuntimeDescriptor(sequence) {
  return {
    sequenceId: sequence.sequenceId,
    itemCount: sequence.itemCount,
    readPage: request => sequence.getWindow({
      startOrdinal: request.startOrdinal,
      limit: request.limit
    }),
    resolveSource: request => sequence.resolveEntrySource({
      ...request,
      sequenceId: request.sequenceId,
      canonicalOrdinal: request.ordinal,
      transportOrdinal: request.ordinal
    })
  };
}

function createDurableTransportDescriptor(sequence, currentDescriptor, currentOrdinal) {
  const runtime = sequence.getDescriptor?.();
  const segments = Array.isArray(currentDescriptor?.segments) && currentDescriptor.segments.length > 0
    ? currentDescriptor.segments.map(segment => ({ ...segment }))
    : flattenRuntimeDescriptor(runtime, 0, runtime?.itemCount ?? sequence.itemCount);
  const descriptor = { segments, currentOrdinal };
  if (runtime?.shuffleEnabled) {
    descriptor.shuffleSeed = runtime.shuffleSeed;
    descriptor.shuffleEpoch = runtime.shuffleEpoch;
    descriptor.shuffleTransportOffset = runtime.shuffleTransportOffset;
  }
  return descriptor;
}

function isProvisionalTransportDescriptor(descriptor) {
  if (!descriptor || descriptor.currentOrdinal !== 0 || !Array.isArray(descriptor.segments) ||
      descriptor.segments.length !== 1) {
    return false;
  }
  const [segment] = descriptor.segments;
  return typeof segment?.sequenceId === 'string' && segment.sequenceId.length > 0 &&
    segment.startOrdinal === 0 && segment.endOrdinal === 1;
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

function createTransportRollback(sequence, previousShuffleState, previousDescriptor) {
  const plannedShuffleState = captureShuffleState(sequence);
  return Object.freeze({
    previousShuffleState,
    plannedShuffleState,
    previousDescriptor,
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

function flattenRuntimeDescriptor(descriptor, startOrdinal, itemCount) {
  if (descriptor?.kind === 'catalog') {
    const segment = {
      sequenceId: descriptor.sequenceId,
      startOrdinal,
      endOrdinal: startOrdinal + itemCount
    };
    if (descriptor.shuffleEnabled) {
      segment.shuffleSeed = descriptor.shuffleSeed;
      segment.shuffleEpoch = descriptor.shuffleEpoch;
      segment.shuffleTransportOffset = descriptor.shuffleTransportOffset;
    }
    return [segment];
  }
  if (descriptor?.kind !== 'composite' || !Array.isArray(descriptor.segments)) {
    throw operationError('invalidTransportDescriptor', 'Playback sequence cannot be persisted');
  }
  const output = [];
  let compositeOffset = 0;
  let remainingStart = startOrdinal;
  let remainingCount = itemCount;
  for (const segment of descriptor.segments) {
    if (remainingStart >= compositeOffset + segment.itemCount) {
      compositeOffset += segment.itemCount;
      continue;
    }
    const localStart = Math.max(0, remainingStart - compositeOffset);
    const takeCount = Math.min(segment.itemCount - localStart, remainingCount);
    output.push(...flattenRuntimeDescriptor(
      segment.source,
      (segment.startOrdinal ?? 0) + localStart,
      takeCount
    ));
    remainingStart += takeCount;
    remainingCount -= takeCount;
    if (remainingCount === 0) break;
    compositeOffset += segment.itemCount;
  }
  if (remainingCount !== 0 || output.length > 256) {
    throw operationError('transportDescriptorLimit', 'Playback transport has too many persisted segments');
  }
  return output;
}

function createCompositeSequenceId(operationId, transportVersion) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${transportVersion}`;
  return `composite:${operationId ?? 'queue'}:${suffix}`;
}

function operationError(code, message) {
  const error = new Error(message);
  error.name = 'LibraryPlaybackOperationError';
  error.code = code;
  return error;
}
