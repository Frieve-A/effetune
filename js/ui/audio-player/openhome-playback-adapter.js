export const MAX_QUEUE_LENGTH = 4096;
const MAX_METADATA_LENGTH = 64 * 1024;
const MAX_URI_LENGTH = 8192;
const MAX_RESPONSE_FRAME_BYTES = 128 * 1024;
const UTF8_ENCODER = new TextEncoder();
const RELEVANT_STATE_KEYS = new Set([
  'currentTrack',
  'currentTrackDuration',
  'isPaused',
  'isPlaying',
  'isPlaybackPending',
  'isStopped',
  'isTransitioning',
  'repeatMode',
  'shuffleMode', 'playerVolume', 'playerMute', 'liveInputActive', 'playbackSpeed', 'playbackErrorTrack',
  'seekBarEnabled', 'playbackMode', 'transportCapabilities'
]);

function getDefaultBridge() {
  return typeof window !== 'undefined' ? window.electronAPI?.openHomeV1 : null;
}

function getDefaultDomParser() {
  return typeof DOMParser !== 'undefined' ? DOMParser : null;
}

export class OpenHomePlaybackAdapter {
  constructor(audioPlayer, {
    bridge = getDefaultBridge(),
    domParserCtor = getDefaultDomParser(),
    getLibraryManager = () => globalThis.window?.uiManager?.ensureLibraryManager?.(),
    resolveNetworkTrack = request => globalThis.window?.electronAPI?.networkMusicResolveTrack?.(request),
    schedule = queueMicrotask,
    now = Date.now
  } = {}) {
    this.audioPlayer = audioPlayer;
    this.bridge = bridge;
    this.DomParserCtor = domParserCtor;
    this.getLibraryManager = getLibraryManager;
    this.resolveNetworkTrack = resolveNetworkTrack;
    this.schedule = callback => schedule(callback);
    this.now = now;
    this.queue = [];
    this.nextTrackId = 1;
    this.idArrayToken = 0;
    this.transportToken = 0;
    this.trackToken = 0;
    this.detailsToken = 0;
    this.commandChain = Promise.resolve();
    this.ready = Promise.resolve();
    this.followsPlayerQueue = false;
    this.queueSequence = null;
    this.queueEntryIds = new Map();
    this.ownedQueueIds = new Set();
    this.queueSyncScheduled = false;
    this.queueSyncInProgress = false;
    this.queueProjectionError = null;
    this.suppressState = 0;
    this.suppressedStateKeys = new Set();
    this.publishScheduled = false;
    this.disposed = false;
    this.actionContexts = new Map();
    this.stateListener = (_value, key) => this.handleStateChange(key);
    this.removeActionListener = null;
    this.removeCancelListener = null;
    this.removeResetListener = null;
    this.removeRepeatModeNormalizer = null;
    this.removeQueueChangeListener = this.audioPlayer?.playbackManager
      ?.setQueueChangeListener?.(() => this.handleQueueChange()) ?? null;

    if (!bridge?.onAction || !bridge?.onCancel || !bridge?.rendererReady ||
        !bridge?.respond || !bridge?.publishState || !bridge?.onReset || !bridge?.resetComplete) {
      return;
    }
    this.removeActionListener = bridge.onAction(action => this.enqueueAction(action));
    this.removeCancelListener = bridge.onCancel(cancel => this.cancelAction(cancel));
    this.removeResetListener = bridge.onReset(reset => this.enqueueReset(reset));
    this.audioPlayer?.stateManager?.addListener?.('*', this.stateListener);
    this.removeRepeatModeNormalizer = this.audioPlayer?.playbackManager
      ?.setRepeatModeNormalizer?.(repeatMode => (
        repeatMode === 'ONE' && this.ownsPlayerQueue() ? 'OFF' : repeatMode
      )) ?? null;
    this.ready = Promise.resolve(bridge.rendererReady())
      .then(() => this.publishState())
      .catch(() => {});
  }

  enqueueAction(action) {
    const requestId = typeof action?.requestId === 'string' ? action.requestId : '';
    const context = {
      requestId,
      deadlineEpochMs: action?.deadlineEpochMs,
      active: true,
      abortController: new AbortController(),
      playRequest: null,
      queueTransaction: null
    };
    if (requestId) this.actionContexts.set(requestId, context);
    this.commandChain = this.commandChain.then(async () => {
      let suppressingState = false;
      try {
        this.assertActionActive(context);
        this.suppressState += 1;
        suppressingState = true;
        const result = await this.executeAction(action, context);
        this.assertActionActive(context);
        const accepted = await this.bridge.respond({
          requestId: action.requestId,
          ok: true,
          result
        });
        if (accepted === true && context.active) {
          this.finalizeQueueMutation(context);
        } else {
          this.rollbackQueueMutation(context);
        }
      } catch (error) {
        const mutationStarted = Boolean(context.queueTransaction);
        this.rollbackQueueMutation(context);
        if (!context.active || this.disposed) return;
        const code = normalizeActionError(error?.code);
        if (action?.service === 'Playlist' && action?.action === 'Play') {
          console.warn(`[OpenHomePlaybackAdapter] Remote playback failed (${code}).`);
        }
        await this.bridge.respond({
          requestId,
          ok: false,
          error: { code, ...(action?.service === 'Catalog' ? { phase: mutationStarted ? 'mutation' : 'preflight' } : {}) }
        });
      } finally {
        if (!context.active) this.rollbackQueueMutation(context);
        if (suppressingState) {
          this.suppressState -= 1;
          if (this.suppressState === 0) this.flushSuppressedStateChanges();
          this.publishState();
        }
        if (requestId && this.actionContexts.get(requestId) === context) {
          this.actionContexts.delete(requestId);
        }
      }
    }).catch(() => {});
  }

  cancelAction(cancel) {
    const requestId = typeof cancel?.requestId === 'string' ? cancel.requestId : '';
    const context = this.actionContexts.get(requestId);
    if (!context) return false;
    context.active = false;
    context.abortController?.abort();
    const manager = this.audioPlayer.contextManager;
    if (context.loadRequest && manager?.activeLoadRequest === context.loadRequest) {
      manager.invalidatePendingPlaybackOperations();
    }
    if (context.queueTransaction?.rollbackReady) this.rollbackQueueMutation(context);

    const playbackManager = this.audioPlayer?.playbackManager;
    if (context.playRequest && playbackManager?.activePlayRequest === context.playRequest) {
      context.playRequest = null;
      void Promise.resolve(this.audioPlayer.stop()).catch(() => {});
    }
    return true;
  }

  enqueueReset(reset) {
    const resetId = typeof reset?.resetId === 'string' && reset.resetId.length <= 64
      ? reset.resetId
      : '';
    if (!resetId) return;
    for (const requestId of this.actionContexts.keys()) this.cancelAction({ requestId });
    this.commandChain = this.commandChain.then(async () => {
      let succeeded = false;
      try {
        await this.resetRemoteQueue();
        await this.bridge.publishState(this.getSnapshot());
        succeeded = true;
      } catch (_) {
        succeeded = false;
      }
      await this.bridge.resetComplete({ resetId, ok: succeeded });
    }).catch(() => {});
  }

  async resetRemoteQueue() {
    if (this.ownsPlayerQueue()) {
      await this.audioPlayer.stop();
      if (this.ownsPlayerQueue()) {
        this.audioPlayer.playbackManager.replaceMaterializedPlaylist([], 0);
      }
    }
    this.queue = [];
    this.followsPlayerQueue = false;
    this.queueSequence = null;
    this.queueEntryIds.clear();
    this.ownedQueueIds.clear();
    this.nextTrackId = 1;
    this.idArrayToken = 0;
    this.transportToken = 0;
    this.trackToken = 0;
    this.detailsToken = 0;
    this.suppressedStateKeys.clear();
  }

  playerOwnsRemoteQueue() {
    if (this.queue.length === 0) return false;
    if (this.queueProjectionError) return false;
    if (this.followsPlayerQueue && this.queueSequence === this.audioPlayer?.playbackManager?.sequence) return true;
    const playlist = this.audioPlayer?.playbackManager?.playlist;
    if (!Array.isArray(playlist) || playlist.length !== this.queue.length) return false;
    const queueIds = new Set(this.queue.map(entry => entry.id));
    const ownsPlaylist = playlist.every(track => {
      const id = trackIdFromPlayerTrack(track);
      return id !== 0 && queueIds.has(id);
    });
    if (!ownsPlaylist) return false;
    const state = this.getPlayerState();
    if (state.isPlaying === true || state.isPaused === true) {
      return queueIds.has(trackIdFromPlayerTrack(state.currentTrack));
    }
    return true;
  }

  ownsPlayerQueue() {
    // Observing a Player queue never grants ownership of its lifetime or repeat policy.
    return this.queue.some(entry => this.ownedQueueIds.has(entry.id)) && this.playerOwnsRemoteQueue();
  }

  handleQueueChange() {
    if (!this.followsPlayerQueue || this.disposed || this.queueSyncScheduled ||
        this.queueSequence === this.audioPlayer.playbackManager.sequence) return;
    this.queueSyncScheduled = true;
    this.commandChain = this.commandChain.then(async () => {
      this.queueSyncScheduled = false;
      this.queueSyncInProgress = true;
      try {
        await this.synchronizePlayerQueue();
      } catch (error) {
        if (error.code === 'action-cancelled' && !this.disposed) {
          this.handleQueueChange();
        } else if (!this.disposed) {
          this.queue = [];
          this.queueEntryIds.clear();
          this.queueProjectionError = error;
          this.bumpIdArrayToken();
          console.warn('[OpenHomePlaybackAdapter] Player queue could not be exported.', error);
          if (error.code === 'queue-full') globalThis.window?.uiManager?.setError?.('networkMusic.queueFull', true);
        }
      } finally {
        this.queueSyncInProgress = false;
        this.publishState();
      }
    }).catch(() => {});
  }

  async synchronizePlayerQueue() {
    const manager = this.audioPlayer.playbackManager;
    if (this.queueSequence === manager.sequence) return;
    const context = { active: true, deadlineEpochMs: Number.MAX_SAFE_INTEGER };
    const imported = await this.captureLocalQueue(0, context, true);
    const entries = imported.entries.map(entry => {
      const id = entry.id ?? this.allocateTrackId();
      return Object.freeze({ ...entry, id, metadata: entry.metadata ?? localTrackMetadata(entry.meta.title, id) });
    });
    if (entries.length !== this.queue.length || entries.some((entry, index) => entry.id !== this.queue[index].id)) {
      this.bumpIdArrayToken();
    }
    this.queue = entries;
    this.ownedQueueIds = new Set(entries.filter(entry => this.ownedQueueIds.has(entry.id)).map(entry => entry.id));
    this.queueSequence = manager.sequence;
    this.queueEntryIds = new Map(entries.filter(entry => entry.entryInstanceId).map(entry => [entry.entryInstanceId, entry.id]));
    this.queueProjectionError = null;
  }

  assertActionActive(context) {
    if (this.disposed || context?.active !== true || context.isCurrent?.() === false) {
      throw createActionError('action-cancelled');
    }
    if (!Number.isSafeInteger(context.deadlineEpochMs)) {
      throw createActionError('invalid-action');
    }
    if (this.now() >= context.deadlineEpochMs) {
      throw createActionError('action-timeout');
    }
  }

  beginQueueMutation(context) {
    const playbackManager = this.audioPlayer.playbackManager;
    const state = this.getPlayerState();
    const playerSnapshot = playbackManager.capturePlaybackQueueSnapshot?.();
    if (!playerSnapshot) throw createActionError('action-failed');
    context.queueTransaction = {
      queue: [...this.queue],
      queueEntryIds: new Map(this.queueEntryIds),
      ownedQueueIds: new Set(this.ownedQueueIds),
      nextTrackId: this.nextTrackId,
      idArrayToken: this.idArrayToken,
      transportToken: this.transportToken,
      trackToken: this.trackToken,
      detailsToken: this.detailsToken,
      suppressedStateKeys: new Set(this.suppressedStateKeys),
      playbackManager,
      stateManager: this.audioPlayer.stateManager,
      playerSnapshot,
      playerState: {
        currentTrackIndex: state.currentTrackIndex || 0,
        currentTrackPosition: state.currentTrackPosition || 0,
        isPlaying: state.isPlaying === true,
        isPaused: state.isPaused === true,
        isStopped: state.isStopped === true,
        shuffleMode: state.shuffleMode === true
      },
      owner: null,
      rollbackReady: false,
      rolledBack: false
    };
    this.markQueueMutationOwner(context);
  }

  markQueueMutationOwner(context, preserveActiveRequest = false) {
    const transaction = context.queueTransaction;
    if (!transaction) return;
    const playbackManager = transaction.playbackManager;
    transaction.owner = {
      playlist: playbackManager.playlist,
      originalPlaylist: playbackManager.originalPlaylist,
      trackCommandGeneration: playbackManager.trackCommandGeneration,
      activePlayRequest: preserveActiveRequest
        ? transaction.owner?.activePlayRequest
        : playbackManager.activePlayRequest
    };
  }

  ownsQueueMutation(transaction) {
    const playbackManager = transaction.playbackManager;
    const owner = transaction.owner;
    return !!owner && playbackManager.playlist === owner.playlist &&
      playbackManager.originalPlaylist === owner.originalPlaylist &&
      playbackManager.trackCommandGeneration === owner.trackCommandGeneration &&
      playbackManager.activePlayRequest === owner.activePlayRequest;
  }

  rollbackQueueMutation(context) {
    const transaction = context.queueTransaction;
    if (!transaction || transaction.rolledBack) return false;
    transaction.rolledBack = true;
    this.queue = [...transaction.queue];
    this.queueEntryIds = new Map(transaction.queueEntryIds);
    this.ownedQueueIds = new Set(transaction.ownedQueueIds);
    this.nextTrackId = transaction.nextTrackId;
    this.idArrayToken = transaction.idArrayToken;
    this.transportToken = transaction.transportToken;
    this.trackToken = transaction.trackToken;
    this.detailsToken = transaction.detailsToken;

    if (this.ownsQueueMutation(transaction) &&
        transaction.playbackManager.restorePlaybackQueueSnapshot(transaction.playerSnapshot)) {
      const restoredCatalog = transaction.playerSnapshot.kind === 'catalog';
      if (!restoredCatalog) {
        transaction.playbackManager.syncPlaylistState(transaction.playerState.currentTrackIndex);
      }
      transaction.stateManager.updateState({
        currentTrackPosition: transaction.playerState.currentTrackPosition,
        isPlaying: transaction.playerState.isPlaying,
        isPaused: transaction.playerState.isPaused,
        isStopped: transaction.playerState.isStopped,
        ...(!restoredCatalog ? { shuffleMode: transaction.playerState.shuffleMode } : {})
      }, 'OpenHome queue mutation rollback');
      this.suppressedStateKeys = new Set(transaction.suppressedStateKeys);
    }
    context.queueTransaction = null;
    return true;
  }

  finalizeQueueMutation(context) {
    if (!context.queueTransaction) return;
    context.queueTransaction = null;
  }

  async executeAction(request, context) {
    this.assertActionActive(context);
    validateActionRequest(request);
    if (request.service === 'AVTransport') return this.executeAvTransport(request, context);
    if (request.service === 'RenderingControl') return this.executeRenderingControl(request);
    if (request.service === 'Catalog') {
      if (request.action !== 'PlayItems') throw createActionError('unsupported-action');
      return this.playCatalogItems(request.args, context);
    }
    // Local controls can adopt the Player's first queue without replacing a staged OpenHome queue.
    if (this.followsPlayerQueue || (request.localControl === true && this.queue.length === 0)) {
      await this.synchronizePlayerQueue();
      this.assertActionActive(context);
      this.followsPlayerQueue = true;
    }
    if (request.service === 'Product' || request.service === 'Info' || request.service === 'Time') {
      if (request.action !== 'Snapshot') throw createActionError('unsupported-action');
      return this.getSnapshot();
    }
    if (request.service !== 'Playlist') throw createActionError('unsupported-service');
    if (this.followsPlayerQueue && this.queueProjectionError && request.action !== 'Snapshot') {
      throw this.queueProjectionError;
    }

    const args = request.args || {};
    if (!['Read', 'ReadList', 'IdArray', 'Snapshot'].includes(request.action)) {
      await this.normalizeRepeatForRemoteControl(context);
    }
    switch (request.action) {
      case 'Play': {
        await this.ensureQueueActive(context);
        this.assertActionActive(context);
        const resumed = await (this.audioPlayer.resumeAudioContextForRemotePlayback?.() ?? true);
        this.assertActionActive(context);
        if (resumed !== true) throw createActionError('play-failed');
        const playbackManager = this.audioPlayer.playbackManager;
        const previousPlayRequest = playbackManager?.activePlayRequest || null;
        const playPromise = this.audioPlayer.play(false, { isCurrent: context.isCurrent });
        const playRequest = playbackManager?.activePlayRequest || null;
        if (playRequest && playRequest !== previousPlayRequest) context.playRequest = playRequest;
        this.markQueueMutationOwner(context, true);
        const started = await playPromise;
        // Target selection only owns the pending initial activation. Once audio
        // starts, this queue and its providers belong to the local player.
        if (started === true && context.queueTransaction) context.isCurrent = undefined;
        this.assertActionActive(context);
        context.playRequest = null;
        if (started !== true) throw createActionError('play-failed');
        return {};
      }
      case 'Pause':
        this.assertActionActive(context);
        await this.audioPlayer.pause();
        this.assertActionActive(context);
        return {};
      case 'Stop':
        this.assertActionActive(context);
        await this.audioPlayer.stop();
        this.assertActionActive(context);
        return {};
      case 'Next':
        await this.moveQueue('next', context);
        return {};
      case 'Previous':
        await this.moveQueue('previous', context);
        return {};
      case 'SeekSecondAbsolute':
        await this.seekSecond(Number(args.seconds), context);
        return {};
      case 'SeekSecondRelative': {
        const position = Number(this.getPlayerState().currentTrackPosition) || 0;
        await this.seekSecond(position + Number(args.seconds), context);
        return {};
      }
      case 'SeekId':
        await this.seekQueueIndex(this.findQueueIndex(args.id), context);
        return {};
      case 'SeekIndex':
        await this.seekQueueIndex(requireQueueIndex(args.index, this.queue.length), context);
        return {};
      case 'SetRepeat':
        await this.setRepeat(args.repeat === true, context);
        return {};
      case 'SetShuffle':
        await this.setShuffle(args.shuffle === true, context);
        return {};
      case 'Insert':
        return this.insert(args, context);
      case 'DeleteId':
        await this.deleteId(args.id, context);
        return {};
      case 'DeleteAll':
        await this.deleteAll(context);
        return {};
      case 'Read':
        return this.read(args.id);
      case 'ReadList':
        return this.readList(args.idList, request.requestId);
      case 'IdArray':
        return { token: this.idArrayToken, array: encodeIdArray(this.queue.map(track => track.id)) };
      case 'Snapshot':
        return this.getSnapshot();
      default:
        throw createActionError('unsupported-action');
    }
  }

  async insert(args, context) {
    this.assertActionActive(context);
    const entry = this.createNetworkEntry(args);
    return this.insertEntries([entry], requireUint32(args.afterId ?? 0, true), context);
  }

  async executeAvTransport(request, context) {
    const args = request.args || {};
    if (request.action === 'Snapshot') return this.getSnapshot().avTransport;
    if (request.action === 'SetAVTransportURI') {
      if (args.uri === '') {
        await this.deleteAll(context);
        return {};
      }
      const entry = this.createNetworkEntry(args);
      const wasLive = this.getPlayerState().liveInputActive === true;
      const wasPlaying = !wasLive && this.getPlayerState().isPlaying === true;
      this.beginQueueMutation(context);
      const id = this.allocateTrackId();
      this.queue = [Object.freeze({ ...entry, id })];
      this.syncQueueToPlayer(id, context);
      const track = this.audioPlayer.playbackManager.playlist[0];
      // The existing candidate loader keeps the current backend until preparation succeeds.
      // Selecting a URI is one queue transaction, never DeleteAll followed by Insert.
      const manager = this.audioPlayer.contextManager;
      const resumed = !wasPlaying || await (this.audioPlayer.resumeAudioContextForRemotePlayback?.() ?? true);
      this.assertActionActive(context);
      const preparation = resumed && (wasLive
        ? manager.prepareTrackSelection(track, () => context.active && !this.disposed)
        : wasPlaying
        ? manager.transitionToNextTrack(track, 0, false, null, null, { signal: context.abortController?.signal })
        : manager.loadTrack(track, 0));
      if (!wasPlaying && !wasLive) context.loadRequest = manager.activeLoadRequest;
      const prepared = await preparation;
      context.loadRequest = null;
      this.markQueueMutationOwner(context);
      this.assertActionActive(context);
      if (prepared !== true) throw createActionError('play-failed');
      this.audioPlayer.stateManager.updateState({ playbackErrorTrack: null }, 'UPnP URI selected');
      this.bumpIdArrayToken();
      context.queueTransaction.rollbackReady = true;
      this.followsPlayerQueue = true;
      return { newId: id };
    }
    if (!['Play', 'Pause', 'Stop', 'Next', 'Previous', 'Seek'].includes(request.action)) {
      throw createActionError('unsupported-action');
    }
    if (!this.queue.length || (this.getPlayerState().liveInputActive && request.action !== 'Play')) throw createActionError('no-media');
    if (request.action === 'Play' && this.getPlayerState().liveInputActive) {
      await this.audioPlayer.airPlayPlayback.stopSession();
      this.assertActionActive(context);
    }
    if (request.action === 'Play') this.audioPlayer.playbackManager.setPlaybackSpeed?.(1);
    if (request.action === 'Seek' && !this.getSnapshot().avTransport.seekable) throw createActionError('seek-not-supported');
    if (request.action === 'Seek' && (!Number.isFinite(args.seconds) || args.seconds < 0 ||
        args.seconds > this.getSnapshot().avTransport.duration)) throw createActionError('invalid-seek');
    if (request.action === 'Next' || request.action === 'Previous') {
      const state = this.getPlayerState();
      const ordinal = this.getPlaybackOrdinal(this.queue.findIndex(entry => entry.id === this.getCurrentOpenHomeId()));
      const index = ordinal + (request.action === 'Next' ? 1 : -1);
      const manager = this.audioPlayer.playbackManager;
      if (ordinal < 0 || index < 0 || index >= (manager.sequence?.itemCount ?? manager.playlist.length)) throw createActionError('invalid-seek');
      const selected = await this.audioPlayer.playbackManager.selectQueueOrdinal(index, {
        play: state.isPlaying === true, userInitiated: false, isCurrent: () => context.active && !this.disposed
      });
      this.assertActionActive(context);
      if (selected === false || selected?.accepted === false) throw createActionError('no-media');
      if (state.isPaused) await this.audioPlayer.pause();
      this.assertActionActive(context);
      return {};
    }
    return this.executeAction({ ...request, service: 'Playlist',
      action: request.action === 'Seek' ? 'SeekSecondAbsolute' : request.action }, context);
  }

  executeRenderingControl(request) {
    const manager = this.audioPlayer.contextManager;
    if (request.action === 'Snapshot') return this.getSnapshot().renderingControl;
    if (request.action === 'SetVolume') {
      const volume = request.args.volume;
      if (!Number.isInteger(volume) || volume < 0 || volume > 100) throw createActionError('invalid-action');
      manager.setPlayerVolume(volume);
    } else if (request.action === 'SetMute') {
      if (typeof request.args.mute !== 'boolean') throw createActionError('invalid-action');
      manager.setPlayerMute(request.args.mute);
    } else if (request.action === 'SelectPreset') {
      if (request.args.preset !== 'FactoryDefaults') throw createActionError('invalid-preset');
      manager.setPlayerVolume(100);
      manager.setPlayerMute(false);
    } else throw createActionError('unsupported-action');
    return {};
  }

  async clearForLiveInput(isCurrent = () => true) {
    if (this.disposed || !isCurrent()) return false;
    for (const requestId of this.actionContexts.keys()) this.cancelAction({ requestId });
    const pending = this.commandChain.then(async () => {
      if (this.disposed || !isCurrent()) return false;
      await this.audioPlayer.stop();
      if (this.disposed || !isCurrent()) return false;
      this.queue = [];
      this.queueEntryIds.clear();
      this.ownedQueueIds.clear();
      this.audioPlayer.playbackManager.replaceMaterializedPlaylist([], 0);
      this.queueSequence = this.audioPlayer.playbackManager.sequence;
      this.followsPlayerQueue = true;
      this.bumpIdArrayToken();
      this.publishState();
      return true;
    });
    this.commandChain = pending.catch(() => {});
    return pending;
  }

  createNetworkEntry(args, summary = {}) {
    const uri = normalizeRemoteUri(args.uri);
    const playbackUrl = normalizePlaybackUrl(args.playbackUrl);
    const artworkUrl = args.artworkUrl === undefined
      ? ''
      : normalizePlaybackUrl(args.artworkUrl);
    const metadata = normalizeMetadata(args.metadata);
    const meta = { ...parseDidlLite(metadata, uri, this.DomParserCtor, artworkUrl) };
    for (const key of ['title', 'artist', 'album']) {
      if (typeof summary[key] === 'string' && summary[key].trim()) meta[key] = summary[key].trim().slice(0, 4096);
    }
    if (typeof summary.duration === 'number' && Number.isFinite(summary.duration) && summary.duration > 0) meta.duration = summary.duration;
    return { uri, playbackUrl, metadata, meta: Object.freeze(meta) };
  }

  async playNetworkTracks(tracks, operationKind = 'play', isCurrent = () => true, startIndex = 0) {
    const entries = tracks.map(track => this.createNetworkEntry({
      uri: track.resources?.[0]?.uri, playbackUrl: track.uri, metadata: track.metadata
    }, track));
    return this.playPreparedEntries(entries, operationKind, isCurrent, startIndex);
  }

  async playProviderTracks(tracks, operationKind = 'play', isCurrent = () => true, startIndex = 0) {
    const entries = tracks.map(track => {
      if (typeof track?.provider !== 'function') throw createActionError('invalid-action');
      return { uri: '', playerTrack: track, meta: track.meta, metadata: '' };
    });
    return this.playPreparedEntries(entries, operationKind, isCurrent, startIndex);
  }

  async playPreparedEntries(entries, operationKind = 'play', isCurrent = () => true, startIndex = 0) {
    await this.ready;
    const pending = this.commandChain.then(async () => {
      const context = { active: true, deadlineEpochMs: Number.MAX_SAFE_INTEGER, isCurrent };
      this.suppressState += 1;
      try {
        const result = await this.applyPreparedEntries(entries, operationKind, startIndex, context);
        this.finalizeQueueMutation(context);
        return result;
      } catch (error) {
        this.rollbackQueueMutation(context);
        throw error;
      } finally {
        this.suppressState -= 1;
        if (this.suppressState === 0) this.flushSuppressedStateChanges();
        this.publishState();
      }
    });
    this.commandChain = pending.catch(() => {});
    return pending;
  }

  async applyPreparedEntries(entries, operationKind, startIndex, context) {
    this.assertActionActive(context);
    if (!['play', 'playNext', 'queue'].includes(operationKind)) throw createActionError('invalid-action');
    if (operationKind === 'play') requireQueueIndex(startIndex, entries.length);
    if (!entries.length) throw createActionError('empty-queue');
    const replace = operationKind === 'play';
    const imported = !replace && !this.playerOwnsRemoteQueue()
      ? await this.captureLocalQueue(entries.length, context) : null;
    this.assertActionActive(context);
    const afterId = replace || imported ? 0 : operationKind === 'playNext'
      ? this.getCurrentOpenHomeId() : this.queue.at(-1)?.id || 0;
    await this.insertEntries(entries, afterId, context, { replace, imported, operationKind });
    this.assertActionActive(context);
    this.followsPlayerQueue = true;
    if (replace) {
      await this.executeAction({ requestId: 'network-local-play', service: 'Playlist',
        action: startIndex === 0 ? 'Play' : 'SeekIndex', args: startIndex === 0 ? {} : { index: startIndex },
        deadlineEpochMs: context.deadlineEpochMs }, context);
    }
    return { accepted: true };
  }

  async playCatalogItems(args, context) {
    const { items, operationKind, startIndex = 0 } = args;
    if (!Array.isArray(items) || items.length < 1 || items.length > MAX_QUEUE_LENGTH) throw createActionError('invalid-action');
    const entries = [];
    let manager = null;
    for (const item of items) {
      if (item.serverId === 'local') {
        manager ??= await this.getLibraryManager();
        this.assertActionActive(context);
        if (!manager || typeof item.trackId !== 'string' || !item.trackId || item.trackId.length > 1024) throw createActionError('invalid-action');
        const row = await manager.getTrack(item.trackId);
        if (!row) throw createActionError('trackUnavailable');
        try { await manager.resolvePlaybackSource(item.trackId); }
        catch (_) { throw createActionError('trackUnavailable'); }
        this.assertActionActive(context);
        const meta = { title: row.title || 'Track', artist: row.artist || '', album: row.album || '', duration: row.durationSec || 0 };
        const sourceKey = `catalog:${item.trackId}`;
        entries.push({ uri: '', meta, playerTrack: {
          name: meta.title, meta, sourceKind: 'catalog', sourceKey, libraryTrackId: item.trackId,
          provider: () => manager.resolvePlaybackSource(item.trackId)
        } });
      } else {
        if (typeof item.serverId !== 'string' || !item.serverId || typeof item.trackId !== 'string' || !item.trackId) throw createActionError('invalid-action');
        const track = await this.resolveNetworkTrack({ serverId: item.serverId, trackId: item.trackId, localPlayback: true });
        this.assertActionActive(context);
        if (track?.playable === false) throw createActionError('unsupportedFormat');
        entries.push(this.createNetworkEntry({ uri: track.resources?.[0]?.uri, playbackUrl: track.uri, metadata: track.metadata }, track));
      }
    }
    return this.applyPreparedEntries(entries, operationKind, startIndex, context);
  }

  async captureLocalQueue(addedCount, context, canonical = false) {
    const manager = this.audioPlayer.playbackManager;
    const sequence = manager.catalogSequence;
    const playlist = manager.playlist;
    const sourceTracks = canonical && !sequence ? manager.originalPlaylist : playlist;
    const generation = manager.trackCommandGeneration;
    const count = sequence?.itemCount ?? playlist.length;
    if (count + addedCount > MAX_QUEUE_LENGTH) throw createActionError('queue-full');
    const entries = [];
    const existing = new Map(this.queue.map(entry => [entry.id, entry]));
    for (let index = 0; index < count; index += 1) {
      const ordinal = canonical && sequence ? sequence.toTransportOrdinal(index) : index;
      const track = sequence ? await sequence.getEntry(ordinal) : sourceTracks[index];
      this.assertActionActive(context);
      const retained = existing.get(this.getTrackId(track)) ?? track.meta?.openHomeQueueEntry;
      if (retained) {
        entries.push({ ...retained, meta: retained.meta ?? track.meta, entryInstanceId: track.entryInstanceId,
          ...(!retained.playbackUrl && !retained.playerTrack ? { playerTrack: { ...track } } : {}) });
        continue;
      }
      const title = track.meta?.title || track.title || String(track.name || track.fileName || 'Local track').split(/[\\/]/).pop();
      const meta = { ...track.meta, title };
      entries.push({ uri: '', meta, entryInstanceId: track.entryInstanceId,
        playerTrack: { ...track, meta, ...(sequence ? { provider: () => sequence.resolveEntrySource(track) } : {}) }
      });
    }
    if (manager.playlist !== playlist || manager.trackCommandGeneration !== generation) throw createActionError('action-cancelled');
    const state = this.getPlayerState();
    const currentIndex = canonical
      ? entries.findIndex(entry => entry.entryInstanceId === state.currentTrack?.entryInstanceId)
      : state.currentTrackIndex || 0;
    if (entries[currentIndex]?.playerTrack && state.currentTrack) {
      entries[currentIndex].playerTrack = { ...entries[currentIndex].playerTrack, ...state.currentTrack };
    }
    return { entries, currentIndex };
  }

  async insertEntries(entries, afterId, context, { replace = false, imported = null, operationKind } = {}) {
    const baseCount = replace ? 0 : imported?.entries.length ?? this.queue.length;
    if (baseCount + entries.length > MAX_QUEUE_LENGTH) throw createActionError('queue-full');
    let insertIndex = afterId === 0 ? 0 : this.findQueueIndex(afterId) + 1;
    let currentId = this.getCurrentOpenHomeId();
    const hadRemoteOwnership = imported !== null || this.playerOwnsRemoteQueue();
    const wasPlaying = this.getPlayerState().isPlaying === true;
    this.beginQueueMutation(context);
    if (replace) {
      await this.audioPlayer.stop();
      this.captureQueueMutationTransport(context);
      this.markQueueMutationOwner(context);
      this.assertActionActive(context);
      currentId = 0;
    }
    const wasShuffle = await this.disableShuffleForMutation(context);
    this.assertActionActive(context);
    if (replace || imported) this.queue = [];
    if (imported) {
      for (const entry of imported.entries) {
        const id = entry.id ?? this.allocateTrackId();
        this.queue.push(Object.freeze({ ...entry, id, metadata: entry.metadata ?? localTrackMetadata(entry.meta.title, id) }));
      }
      currentId = this.queue[imported.currentIndex]?.id || 0;
      insertIndex = operationKind === 'playNext' && currentId ? imported.currentIndex + 1 : this.queue.length;
    }
    const added = entries.map(entry => {
      const id = this.allocateTrackId();
      return Object.freeze({ ...entry, id, metadata: entry.metadata ?? localTrackMetadata(entry.meta, id) });
    });
    this.queue.splice(insertIndex, 0, ...added);
    await this.transitionToRemoteQueueOwnership(context, {
      preferredId: currentId,
      queueChanged: true,
      hadRemoteOwnership
    });
    if (wasShuffle) await this.restoreShuffleAfterMutation(wasPlaying, context);
    this.assertActionActive(context);
    this.bumpIdArrayToken();
    context.queueTransaction.rollbackReady = true;
    return { newId: added[0]?.id };
  }

  async deleteId(idValue, context) {
    this.assertActionActive(context);
    const index = this.findQueueIndex(idValue);
    const id = this.queue[index].id;
    const currentId = this.getCurrentOpenHomeId();
    const hadRemoteOwnership = this.playerOwnsRemoteQueue();
    const deletingCurrent = id === currentId;
    this.beginQueueMutation(context);
    if (deletingCurrent) {
      this.assertActionActive(context);
      await this.audioPlayer.stop();
      this.captureQueueMutationTransport(context);
      this.markQueueMutationOwner(context);
      this.assertActionActive(context);
    }
    const wasPlaying = !deletingCurrent && this.getPlayerState().isPlaying === true;
    const wasShuffle = await this.disableShuffleForMutation(context);
    this.assertActionActive(context);
    this.queue.splice(index, 1);
    await this.transitionToRemoteQueueOwnership(context, {
      preferredId: deletingCurrent ? 0 : currentId,
      queueChanged: true,
      hadRemoteOwnership
    });
    if (wasShuffle && this.queue.length > 0) {
      await this.restoreShuffleAfterMutation(wasPlaying, context);
    } else if (wasShuffle) {
      this.assertActionActive(context);
      this.audioPlayer.stateManager.updateState({ shuffleMode: true }, 'OpenHome queue mutation');
    }
    this.assertActionActive(context);
    this.bumpIdArrayToken();
    context.queueTransaction.rollbackReady = true;
  }

  async deleteAll(context) {
    this.assertActionActive(context);
    this.beginQueueMutation(context);
    await this.audioPlayer.stop();
    this.captureQueueMutationTransport(context);
    this.markQueueMutationOwner(context);
    this.assertActionActive(context);
    this.queue = [];
    this.syncQueueToPlayer(0, context);
    this.assertActionActive(context);
    this.bumpIdArrayToken();
    context.queueTransaction.rollbackReady = true;
  }

  read(idValue) {
    const entry = this.queue[this.findQueueIndex(idValue)];
    return serializeTrack(entry);
  }

  readList(idList, requestId = '') {
    const ids = Array.isArray(idList)
      ? idList
      : String(idList || '').split(/[\s,]+/).filter(Boolean);
    if (ids.length > MAX_QUEUE_LENGTH) throw createActionError('invalid-id-list');
    const parsedIds = ids.map(id => requireUint32(id, false));
    const entries = new Map(this.queue.map(entry => [entry.id, entry]));
    const result = { tracks: [] };
    let frameBytes = utf8ByteLength(JSON.stringify({ requestId, ok: true, result }));
    for (const id of parsedIds) {
      const entry = entries.get(id);
      if (!entry) continue;
      const track = serializeTrack(entry);
      frameBytes += utf8ByteLength(JSON.stringify(track)) + (result.tracks.length > 0 ? 1 : 0);
      if (frameBytes > MAX_RESPONSE_FRAME_BYTES) {
        throw createActionError('response-too-large');
      }
      result.tracks.push(track);
    }
    return result;
  }

  captureQueueMutationTransport(context) {
    const transaction = context.queueTransaction;
    if (!transaction) return;
    const state = this.getPlayerState();
    transaction.playerState.currentTrackPosition = state.currentTrackPosition || 0;
    transaction.playerState.isPlaying = state.isPlaying === true;
    transaction.playerState.isPaused = state.isPaused === true;
    transaction.playerState.isStopped = state.isStopped === true;
  }

  async transitionToRemoteQueueOwnership(context, {
    preferredId = 0,
    queueChanged = false,
    hadRemoteOwnership = this.playerOwnsRemoteQueue()
  } = {}) {
    this.assertActionActive(context);
    if (!queueChanged && hadRemoteOwnership) return false;
    const state = this.getPlayerState();
    const applyShuffleMode = state.shuffleMode === true;
    if (!hadRemoteOwnership && (state.isPlaying === true || state.isPaused === true)) {
      await this.audioPlayer.stop();
      this.captureQueueMutationTransport(context);
      this.markQueueMutationOwner(context);
      this.assertActionActive(context);
    }
    this.syncQueueToPlayer(preferredId, context, { applyShuffleMode });
    return true;
  }

  async ensureQueueActive(context) {
    this.assertActionActive(context);
    if (this.queue.length === 0) throw createActionError('empty-queue');
    await this.transitionToRemoteQueueOwnership(context, {
      preferredId: this.getCurrentOpenHomeId()
    });
    this.assertActionActive(context);
    this.followsPlayerQueue = true;
  }

  async seekQueueIndex(queueIndex, context) {
    await this.ensureQueueActive(context);
    this.assertActionActive(context);
    const manager = this.audioPlayer.playbackManager;
    const playlistIndex = this.getPlaybackOrdinal(queueIndex);
    if (playlistIndex < 0) throw createActionError('track-not-found');
    const resumed = await (this.audioPlayer.resumeAudioContextForRemotePlayback?.() ?? true);
    this.assertActionActive(context);
    if (resumed !== true) throw createActionError('seek-failed');
    const pending = manager.selectQueueOrdinal(playlistIndex, {
      play: true,
      userInitiated: false,
      playbackReady: resumed,
      ...(context.isCurrent ? { isCurrent: context.isCurrent } : {})
    });
    this.markQueueMutationOwner(context, true);
    const result = await pending;
    if (result?.accepted === true && context.queueTransaction) context.isCurrent = undefined;
    this.assertActionActive(context);
    if (result?.accepted === false) throw createActionError('seek-failed');
  }

  async moveQueue(direction, context) {
    await this.ensureQueueActive(context);
    this.assertActionActive(context);
    const resumed = await (this.audioPlayer.resumeAudioContextForRemotePlayback?.() ?? true);
    this.assertActionActive(context);
    if (resumed !== true) throw createActionError(`${direction}-failed`);
    const playbackManager = this.audioPlayer.playbackManager;
    let moved;
    try {
      moved = direction === 'next'
        ? await playbackManager.playNext(false, { forceQueueMove: true })
        : await playbackManager.playPrevious(false, { forceQueueMove: true });
    } catch (_) {
      throw createActionError(`${direction}-failed`);
    }
    this.assertActionActive(context);
    if (moved !== true && moved?.accepted !== true) throw createActionError(`${direction}-failed`);
  }

  async seekSecond(seconds, context) {
    if (!Number.isFinite(seconds)) throw createActionError('invalid-seek');
    await this.ensureQueueActive(context);
    this.assertActionActive(context);
    await this.audioPlayer.contextManager.seek(Math.max(0, seconds));
    this.assertActionActive(context);
  }

  async setRepeat(enabled, context) {
    this.assertActionActive(context);
    const state = this.getPlayerState();
    const repeatMode = enabled ? 'ALL' : 'OFF';
    if (state.repeatMode !== repeatMode) {
      this.assertActionActive(context);
      await this.audioPlayer.playbackManager.setRepeatMode(repeatMode);
      this.assertActionActive(context);
    }
  }

  async normalizeRepeatForRemoteControl(context) {
    this.assertActionActive(context);
    if (this.getPlayerState().repeatMode === 'ONE') await this.setRepeat(true, context);
    this.assertActionActive(context);
  }

  async setShuffle(enabled, context) {
    this.assertActionActive(context);
    if (this.queue.length > 0) {
      await this.transitionToRemoteQueueOwnership(context, {
        preferredId: this.getCurrentOpenHomeId()
      });
    }
    this.assertActionActive(context);
    if (this.getPlayerState().shuffleMode === enabled) return;
    await this.audioPlayer.playbackManager.setShuffleMode(enabled, {
      userInitiated: false,
      preserveTransport: true
    });
    this.assertActionActive(context);
  }

  async disableShuffleForMutation(context) {
    this.assertActionActive(context);
    if (this.getPlayerState().shuffleMode !== true) return false;
    await this.audioPlayer.playbackManager.setShuffleMode(false, {
      userInitiated: false,
      preserveTransport: true
    });
    this.markQueueMutationOwner(context, true);
    this.assertActionActive(context);
    return true;
  }

  async restoreShuffleAfterMutation(wasPlaying, context) {
    this.assertActionActive(context);
    const state = this.getPlayerState();
    if (state.shuffleMode !== true) {
      await this.audioPlayer.playbackManager.setShuffleMode(true, {
        userInitiated: false,
        preserveTransport: true
      });
      this.markQueueMutationOwner(context, true);
      this.assertActionActive(context);
    }
    if (!wasPlaying && this.getPlayerState().isPlaying) {
      this.assertActionActive(context);
      await this.audioPlayer.pause();
      this.markQueueMutationOwner(context);
      this.assertActionActive(context);
    }
  }

  syncQueueToPlayer(preferredId = 0, context, { applyShuffleMode = false } = {}) {
    this.assertActionActive(context);
    if (this.queue.length > 0 && !this.audioPlayer.ui?.container) {
      this.audioPlayer.ui?.createPlayerUI?.();
    }
    const tracks = this.queue.map(entry => {
      const sourceKey = `openhome:${entry.id}`;
      const track = entry.playerTrack ?? {
        path: entry.playbackUrl, name: entry.meta.title, meta: entry.meta, sourceKind: 'openhome'
      };
      return { ...track, sourceKey, meta: { ...track.meta, openHomeQueueEntry: {
        id: entry.id, uri: entry.uri, metadata: entry.metadata
      } }, ...(track.provider ? {
        provider: async () => ({ ...await track.provider(), sourceKey })
      } : {}) };
    });
    const currentIndex = preferredId
      ? Math.max(0, this.queue.findIndex(entry => entry.id === preferredId))
      : 0;
    this.assertActionActive(context);
    this.audioPlayer.playbackManager.replaceMaterializedPlaylist(tracks, currentIndex, {
      applyShuffleMode
    });
    this.ownedQueueIds = new Set(this.queue.map(entry => entry.id));
    this.queueSequence = this.audioPlayer.playbackManager.sequence;
    this.queueEntryIds = new Map(this.audioPlayer.playbackManager.playlist.filter(track => track.entryInstanceId)
      .map(track => [track.entryInstanceId, trackIdFromPlayerTrack(track)]));
    this.queueProjectionError = null;
    this.markQueueMutationOwner(context);
  }

  findQueueIndex(idValue) {
    const id = requireUint32(idValue, false);
    const index = this.queue.findIndex(entry => entry.id === id);
    if (index < 0) throw createActionError('track-not-found');
    return index;
  }

  allocateTrackId() {
    for (let attempts = 0; attempts <= MAX_QUEUE_LENGTH; attempts += 1) {
      const id = this.nextTrackId;
      this.nextTrackId = id === 0xffffffff ? 1 : id + 1;
      if (!this.queue.some(entry => entry.id === id)) return id;
    }
    throw createActionError('track-id-unavailable');
  }

  getCurrentOpenHomeId() {
    return this.getTrackId(this.getPlayerState().currentTrack);
  }

  getTrackId(track) {
    return trackIdFromPlayerTrack(track) || (track?.entryInstanceId ? this.queueEntryIds.get(track.entryInstanceId) : 0) || 0;
  }

  getPlayerState() {
    return this.audioPlayer?.stateManager?.getStateSnapshot?.() || {};
  }

  getPlaybackOrdinal(queueIndex) {
    if (queueIndex < 0 || queueIndex >= this.queue.length) return -1;
    const manager = this.audioPlayer.playbackManager;
    return manager.catalogSequence ? manager.catalogSequence.toTransportOrdinal(queueIndex)
      : manager.playlist.findIndex(track => this.getTrackId(track) === this.queue[queueIndex].id);
  }

  getSnapshot() {
    const state = this.getPlayerState();
    const currentEntry = this.queue.find(entry => entry.id === this.getTrackId(state.currentTrack)) || null;
    const currentId = state.liveInputActive ? 0 : currentEntry?.id || 0;
    const uri = currentEntry?.uri || '';
    const duration = state.liveInputActive ? 0 : positiveNumber(state.currentTrackDuration) || positiveNumber(currentEntry?.meta.duration);
    const seekable = !state.liveInputActive && !!uri && duration > 0 && state.seekBarEnabled !== false &&
      !state.isTransitioning && !state.isPlaybackPending &&
      (this.audioPlayer.contextManager?.canSeekCurrentTrack?.() ?? true);
    const transportState = !uri ? 'NO_MEDIA_PRESENT' : state.liveInputActive ? 'STOPPED' : state.isPlaybackPending || state.isTransitioning
      ? 'TRANSITIONING' : state.isPlaying ? 'PLAYING' : state.isPaused ? 'PAUSED_PLAYBACK' : 'STOPPED';
    const index = currentEntry ? this.queue.indexOf(currentEntry) : 0;
    const playbackIndex = currentEntry ? this.getPlaybackOrdinal(index) : -1;
    const manager = this.audioPlayer.playbackManager;
    const playbackCount = manager.sequence?.itemCount ?? manager.playlist.length;
    const technical = { ...currentEntry?.meta, ...state.currentTrack?.meta };
    for (const field of ['sampleRate', 'bitsPerSample', 'bitrate']) {
      if (positiveNumber(state.currentTrack?.[field])) technical[field] = state.currentTrack[field];
    }
    if (state.currentTrack?.codec) technical.codec = state.currentTrack.codec;
    const playbackError = state.playbackErrorTrack && (state.playbackErrorTrack === state.currentTrack ||
      this.getTrackId(state.playbackErrorTrack) === currentEntry?.id);
    const playMode = state.shuffleMode ? 'SHUFFLE' : state.repeatMode === 'ONE' ? 'REPEAT_ONE'
      : state.repeatMode === 'ALL' ? 'REPEAT_ALL' : 'NORMAL';
    const canMove = !state.isTransitioning && !state.isPlaybackPending;
    return Object.freeze({
      protocolVersion: 1,
      avTransport: {
        state: transportState, uri, metadata: uri ? currentEntry?.metadata || '' : '',
        duration: uri ? duration : 0, position: uri && !state.liveInputActive ? positiveNumber(state.currentTrackPosition) : 0,
        status: playbackError && !state.liveInputActive ? 'ERROR_OCCURRED' : 'OK',
        speed: upnpSpeed(positiveNumber(state.playbackSpeed) || 1), playMode,
        protocolInfo: uri ? currentEntry?.meta.protocolInfo || '' : '',
        seekable, actions: !uri ? '' : state.liveInputActive ? 'Play' : `${state.isPlaying ? 'Pause,Stop' : 'Play,Stop'}${seekable ? ',Seek' : ''}${canMove && playbackIndex >= 0 && playbackIndex < playbackCount - 1 ? ',Next' : ''}${canMove && playbackIndex > 0 ? ',Previous' : ''}`
      },
      renderingControl: {
        volume: this.audioPlayer.contextManager?.getPlayerVolume?.() ?? 100,
        mute: this.audioPlayer.contextManager?.getPlayerMute?.() ?? false
      },
      source: 'Playlist',
      transportState: state.liveInputActive ? 'Stopped' : getTransportState(state),
      repeat: state.repeatMode === 'ALL' || state.repeatMode === 'ONE',
      shuffle: state.shuffleMode === true,
      currentId,
      currentIndex: currentEntry ? this.queue.indexOf(currentEntry) : 0,
      uri: state.liveInputActive ? '' : uri,
      metadata: uri && !state.liveInputActive ? currentEntry?.metadata || '' : '',
      duration: state.liveInputActive ? 0 : toOpenHomeSeconds(state.currentTrackDuration),
      seconds: state.liveInputActive ? 0 : toOpenHomeSeconds(state.currentTrackPosition),
      bitrate: state.liveInputActive ? 0 : positiveNumber(technical.bitrate),
      bitDepth: state.liveInputActive ? 0 : positiveNumber(technical.bitsPerSample),
      sampleRate: state.liveInputActive ? 0 : positiveNumber(technical.sampleRate),
      lossless: !state.liveInputActive && technical.codec === 'FLAC',
      codecName: state.liveInputActive ? '' : technical.codec || '',
      tracksMax: MAX_QUEUE_LENGTH,
      idArray: encodeIdArray(this.queue.map(track => track.id)),
      idArrayToken: this.idArrayToken,
      transportToken: this.transportToken,
      trackToken: this.trackToken,
      detailsToken: this.detailsToken
    });
  }

  handleStateChange(key) {
    if (!RELEVANT_STATE_KEYS.has(key) || this.disposed) return;
    const state = this.getPlayerState();
    // A staged incoming queue also becomes shared when playback starts locally.
    if (!this.followsPlayerQueue && state.isPlaying === true && this.playerOwnsRemoteQueue()) {
      this.followsPlayerQueue = true;
    }
    if (key === 'repeatMode' && state.repeatMode === 'ONE' &&
        this.ownsPlayerQueue()) {
      void Promise.resolve(this.audioPlayer.playbackManager.setRepeatMode('ALL')).catch(error => {
        console.error('[OpenHomePlaybackAdapter] Failed to normalize repeat mode.', error);
      });
      return;
    }
    if (this.suppressState > 0) {
      this.suppressedStateKeys.add(key);
      return;
    }
    this.bumpStateCounter(key);
    this.schedulePublish();
  }

  flushSuppressedStateChanges() {
    for (const key of this.suppressedStateKeys) this.bumpStateCounter(key);
    this.suppressedStateKeys.clear();
  }

  bumpStateCounter(key) {
    if (key === 'currentTrack') this.trackToken = nextCounter(this.trackToken);
    else if (key === 'currentTrackDuration') this.detailsToken = nextCounter(this.detailsToken);
    else this.transportToken = nextCounter(this.transportToken);
  }

  schedulePublish() {
    if (this.publishScheduled) return;
    this.publishScheduled = true;
    this.schedule(() => {
      this.publishScheduled = false;
      this.publishState();
    });
  }

  bumpIdArrayToken() {
    this.idArrayToken = nextCounter(this.idArrayToken);
    this.trackToken = nextCounter(this.trackToken);
  }

  publishState() {
    if (this.disposed || this.queueSyncScheduled || this.queueSyncInProgress || !this.bridge?.publishState) return;
    void Promise.resolve(this.bridge.publishState(this.getSnapshot())).catch(() => {});
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.removeActionListener?.();
    this.removeActionListener = null;
    this.removeCancelListener?.();
    this.removeCancelListener = null;
    this.removeResetListener?.();
    this.removeResetListener = null;
    this.removeRepeatModeNormalizer?.();
    this.removeRepeatModeNormalizer = null;
    this.removeQueueChangeListener?.();
    this.removeQueueChangeListener = null;
    for (const requestId of this.actionContexts.keys()) this.cancelAction({ requestId });
    this.actionContexts.clear();
    this.audioPlayer?.stateManager?.removeListener?.('*', this.stateListener);
    void Promise.resolve(this.bridge?.rendererUnavailable?.()).catch(() => {});
    this.audioPlayer = null;
  }
}

function validateActionRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      typeof request.requestId !== 'string' || request.requestId.length === 0 ||
      request.requestId.length > 64 || typeof request.service !== 'string' ||
      typeof request.action !== 'string' || !request.args || typeof request.args !== 'object' ||
      Array.isArray(request.args) || !Number.isSafeInteger(request.deadlineEpochMs)) {
    throw createActionError('invalid-action');
  }
}

function normalizeRemoteUri(uri) {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > MAX_URI_LENGTH) {
    throw createActionError('invalid-uri');
  }
  let parsed;
  try {
    parsed = new URL(uri);
  } catch (_) {
    throw createActionError('invalid-uri');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username || parsed.password || !parsed.hostname) {
    throw createActionError('invalid-uri');
  }
  return parsed.href;
}

function normalizePlaybackUrl(uri) {
  if (typeof uri !== 'string' || uri.length > MAX_URI_LENGTH) throw createActionError('invalid-playback-url');
  let parsed;
  try {
    parsed = new URL(uri);
  } catch (_) {
    throw createActionError('invalid-playback-url');
  }
  if (parsed.protocol !== 'http:' || parsed.hostname !== '127.0.0.1' ||
      !parsed.pathname.startsWith('/openhome-media/') || parsed.username || parsed.password) {
    throw createActionError('invalid-playback-url');
  }
  return parsed.href;
}

function normalizeMetadata(metadata) {
  if (metadata === undefined || metadata === null) return '';
  if (typeof metadata !== 'string' || metadata.length > MAX_METADATA_LENGTH) {
    throw createActionError('invalid-metadata');
  }
  return metadata;
}

function parseDidlLite(metadata, uri, DomParserCtor, artworkUrl = '') {
  const fallbackTitle = titleFromUri(uri);
  const fallback = { title: fallbackTitle, artist: '', album: '', artworkUrl };
  if (!metadata || !DomParserCtor) return Object.freeze(fallback);
  try {
    const document = new DomParserCtor().parseFromString(metadata, 'application/xml');
    if (document.querySelector?.('parsererror')) throw new Error('Invalid XML');
    const elements = Array.from(document.getElementsByTagName?.('*') || []);
    const items = elements.filter(element => element.localName === 'item');
    const matchesUri = element => {
      if (element.localName !== 'res') return false;
      try { return new URL(String(element.textContent).trim()).href === uri; } catch (_) { return false; }
    };
    const descendants = element => Array.from(element.getElementsByTagName?.('*') || []);
    const item = items.find(element => descendants(element).some(matchesUri)) ?? (items.length === 1 ? items[0] : null);
    if (items.length && !item) return Object.freeze(fallback);
    const fields = item ? descendants(item) : elements;
    const text = element => String(element?.textContent || '').trim().slice(0, 4096);
    const textByLocalName = localName => fields.filter(element => element.localName === localName).map(text).filter(Boolean).join('; ');
    const meta = { ...fallback, title: textByLocalName('title') || fallbackTitle };
    for (const key of ['album', 'genre', 'date', 'originalTrackNumber', 'description', 'publisher', 'language']) {
      const value = textByLocalName(key);
      if (value) meta[key] = value;
    }
    const contributors = fields.filter(element => ['artist', 'creator', 'contributor', 'composer'].includes(element.localName))
      .map(element => ({ name: text(element), role: element.getAttribute?.('role') ||
        (element.localName === 'composer' ? 'Composer' : element.localName === 'artist' || element.localName === 'creator' ? 'Artist' : '') }))
      .filter(value => value.name);
    if (contributors.length) meta.contributors = contributors;
    for (const [key, role] of [['artist', 'artist'], ['albumArtist', 'albumartist'], ['composer', 'composer']]) {
      const names = contributors.filter(value => value.role.toLowerCase().replace(/\s/g, '') === role).map(value => value.name);
      if (names.length) meta[key] = [...new Set(names)].join('; ');
    }
    const resource = fields.find(matchesUri);
    if (resource) {
      const duration = parseUpnpTime(resource.getAttribute('duration'));
      if (duration !== null) meta.duration = duration;
      for (const [attribute, key] of [['sampleFrequency', 'sampleRate'], ['bitsPerSample', 'bitsPerSample'],
        ['nrAudioChannels', 'channels'], ['bitrate', 'bitrate']]) {
        const number = positiveNumber(resource.getAttribute(attribute));
        if (number) meta[key] = attribute === 'bitrate' ? number * 8 : number;
      }
      const protocol = resource.getAttribute('protocolInfo') || '';
      if (protocol.length <= 2048 && protocol.split(':').length === 4) {
        meta.protocolInfo = protocol;
        const mime = protocol.split(':')[2].toLowerCase();
        if (mime === 'audio/mpeg') meta.codec = 'MP3';
        else if (mime === 'audio/flac' || mime === 'audio/x-flac') meta.codec = 'FLAC';
      }
    }
    return Object.freeze(meta);
  } catch (_) {
    return Object.freeze(fallback);
  }
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function upnpSpeed(speed) {
  let numerator = Math.round(speed * 1000), denominator = 1000;
  let a = numerator, b = denominator;
  while (b) [a, b] = [b, a % b];
  numerator /= a; denominator /= a;
  return denominator === 1 ? String(numerator) : `${numerator}/${denominator}`;
}

function parseUpnpTime(value) {
  const match = /^(\d+):([0-5]\d):([0-5]\d(?:\.\d+)?)$/.exec(value || '');
  if (!match) return null;
  const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number.isFinite(seconds) && seconds <= 0xffffffff ? seconds : null;
}

function titleFromUri(uri) {
  try {
    const path = new URL(uri).pathname;
    return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1)) || 'Remote track';
  } catch (_) {
    return 'Remote track';
  }
}

function serializeTrack(entry) {
  return Object.freeze({ id: entry.id, uri: entry.uri, metadata: entry.metadata });
}

function localTrackMetadata(meta, id) {
  const escape = value => String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
  const details = typeof meta === 'string' ? { title: meta } : meta || {};
  return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="${id}" parentID="0" restricted="1"><dc:title>${escape(details.title)}</dc:title><upnp:artist>${escape(details.artist)}</upnp:artist><upnp:album>${escape(details.album)}</upnp:album><upnp:class>object.item.audioItem.musicTrack</upnp:class></item></DIDL-Lite>`;
}

function trackIdFromPlayerTrack(track) {
  const match = /^openhome:(\d+)$/.exec(String(track?.sourceKey || ''));
  if (!match) return 0;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 && id <= 0xffffffff ? id : 0;
}

function requireUint32(value, allowZero) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < (allowZero ? 0 : 1) || number > 0xffffffff) {
    throw createActionError('invalid-id');
  }
  return number;
}

function requireQueueIndex(value, length) {
  const index = Number(value);
  if (!Number.isSafeInteger(index) || index < 0 || index >= length) {
    throw createActionError('invalid-index');
  }
  return index;
}

function encodeIdArray(ids) {
  const bytes = new Uint8Array(ids.length * 4);
  const view = new DataView(bytes.buffer);
  ids.forEach((id, index) => view.setUint32(index * 4, id, false));
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function getTransportState(state) {
  if (state.isTransitioning || state.isPlaybackPending) return 'Buffering';
  if (state.isPlaying) return 'Playing';
  if (state.isPaused) return 'Paused';
  return 'Stopped';
}

function toOpenHomeSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
}

function utf8ByteLength(value) {
  return UTF8_ENCODER.encode(value).byteLength;
}

function nextCounter(value) {
  return value >= 0xffffffff ? 1 : value + 1;
}

function normalizeActionError(code) {
  const normalized = String(code || '').trim();
  return /^[a-z][a-z0-9-]{0,63}$/i.test(normalized) ? normalized : 'action-failed';
}

function createActionError(code) {
  const error = new Error('OpenHome action failed');
  error.code = code;
  return error;
}

export { encodeIdArray, parseDidlLite };
