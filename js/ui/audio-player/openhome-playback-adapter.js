const MAX_QUEUE_LENGTH = 4096;
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
  'shuffleMode'
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
    schedule = queueMicrotask,
    now = Date.now
  } = {}) {
    this.audioPlayer = audioPlayer;
    this.bridge = bridge;
    this.DomParserCtor = domParserCtor;
    this.schedule = callback => schedule(callback);
    this.now = now;
    this.queue = [];
    this.nextTrackId = 1;
    this.idArrayToken = 0;
    this.transportToken = 0;
    this.trackToken = 0;
    this.detailsToken = 0;
    this.commandChain = Promise.resolve();
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
        repeatMode === 'ONE' && this.playerOwnsRemoteQueue() ? 'ALL' : repeatMode
      )) ?? null;
    void Promise.resolve(bridge.rendererReady())
      .then(() => this.publishState())
      .catch(() => {});
  }

  enqueueAction(action) {
    const requestId = typeof action?.requestId === 'string' ? action.requestId : '';
    const context = {
      requestId,
      deadlineEpochMs: action?.deadlineEpochMs,
      active: true,
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
        this.rollbackQueueMutation(context);
        if (!context.active || this.disposed) return;
        const code = normalizeActionError(error?.code);
        if (action?.service === 'Playlist' && action?.action === 'Play') {
          console.warn(`[OpenHomePlaybackAdapter] Remote playback failed (${code}).`);
        }
        await this.bridge.respond({
          requestId,
          ok: false,
          error: { code }
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
    if (this.playerOwnsRemoteQueue()) {
      await this.audioPlayer.stop();
      if (this.playerOwnsRemoteQueue()) {
        this.audioPlayer.playbackManager.replaceMaterializedPlaylist([], 0);
      }
    }
    this.queue = [];
    this.nextTrackId = 1;
    this.idArrayToken = 0;
    this.transportToken = 0;
    this.trackToken = 0;
    this.detailsToken = 0;
    this.suppressedStateKeys.clear();
  }

  playerOwnsRemoteQueue() {
    if (this.queue.length === 0) return false;
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

  assertActionActive(context) {
    if (this.disposed || context?.active !== true) {
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
    if (request.service === 'Product' || request.service === 'Info' || request.service === 'Time') {
      if (request.action !== 'Snapshot') throw createActionError('unsupported-action');
      return this.getSnapshot();
    }
    if (request.service !== 'Playlist') throw createActionError('unsupported-service');

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
        const playPromise = this.audioPlayer.play(false);
        const playRequest = playbackManager?.activePlayRequest || null;
        if (playRequest && playRequest !== previousPlayRequest) context.playRequest = playRequest;
        const started = await playPromise;
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
    if (this.queue.length >= MAX_QUEUE_LENGTH) throw createActionError('queue-full');
    const uri = normalizeRemoteUri(args.uri);
    const playbackUrl = normalizePlaybackUrl(args.playbackUrl);
    const metadata = normalizeMetadata(args.metadata);
    const afterId = requireUint32(args.afterId ?? 0, true);
    let insertIndex = 0;
    if (afterId !== 0) insertIndex = this.findQueueIndex(afterId) + 1;
    const meta = parseDidlLite(metadata, uri, this.DomParserCtor);
    const currentId = this.getCurrentOpenHomeId();
    const hadRemoteOwnership = this.playerOwnsRemoteQueue();
    const wasPlaying = this.getPlayerState().isPlaying === true;
    this.beginQueueMutation(context);
    const wasShuffle = await this.disableShuffleForMutation(context);
    this.assertActionActive(context);
    const id = this.allocateTrackId();
    const entry = Object.freeze({ id, uri, playbackUrl, metadata, meta });
    this.queue.splice(insertIndex, 0, entry);
    await this.transitionToRemoteQueueOwnership(context, {
      preferredId: currentId,
      queueChanged: true,
      hadRemoteOwnership
    });
    if (wasShuffle) await this.restoreShuffleAfterMutation(wasPlaying, context);
    this.assertActionActive(context);
    this.bumpIdArrayToken();
    context.queueTransaction.rollbackReady = true;
    return { newId: id };
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
  }

  async seekQueueIndex(queueIndex, context) {
    await this.ensureQueueActive(context);
    this.assertActionActive(context);
    const id = this.queue[queueIndex].id;
    const playlistIndex = this.audioPlayer.playbackManager.playlist
      .findIndex(track => trackIdFromPlayerTrack(track) === id);
    if (playlistIndex < 0) throw createActionError('track-not-found');
    const resumed = await (this.audioPlayer.resumeAudioContextForRemotePlayback?.() ?? true);
    this.assertActionActive(context);
    if (resumed !== true) throw createActionError('seek-failed');
    const result = await this.audioPlayer.playbackManager.selectQueueOrdinal(playlistIndex, {
      play: true,
      userInitiated: false,
      playbackReady: resumed
    });
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
    if (moved !== true) throw createActionError(`${direction}-failed`);
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
    const tracks = this.queue.map(entry => ({
      path: entry.playbackUrl,
      name: entry.meta.title,
      meta: entry.meta,
      sourceKind: 'openhome',
      sourceKey: `openhome:${entry.id}`
    }));
    const currentIndex = preferredId
      ? Math.max(0, this.queue.findIndex(entry => entry.id === preferredId))
      : 0;
    this.assertActionActive(context);
    this.audioPlayer.playbackManager.replaceMaterializedPlaylist(tracks, currentIndex, {
      applyShuffleMode
    });
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
    return trackIdFromPlayerTrack(this.getPlayerState().currentTrack);
  }

  getPlayerState() {
    return this.audioPlayer?.stateManager?.getStateSnapshot?.() || {};
  }

  getSnapshot() {
    const state = this.getPlayerState();
    const currentId = trackIdFromPlayerTrack(state.currentTrack);
    const currentEntry = this.queue.find(entry => entry.id === currentId) || null;
    return Object.freeze({
      protocolVersion: 1,
      source: 'Playlist',
      transportState: getTransportState(state),
      repeat: state.repeatMode === 'ALL' || state.repeatMode === 'ONE',
      shuffle: state.shuffleMode === true,
      currentId,
      currentIndex: currentEntry ? this.queue.indexOf(currentEntry) : 0,
      uri: currentEntry?.uri || '',
      metadata: currentEntry?.metadata || '',
      duration: toOpenHomeSeconds(state.currentTrackDuration),
      seconds: toOpenHomeSeconds(state.currentTrackPosition),
      bitrate: 0,
      bitDepth: 0,
      sampleRate: 0,
      lossless: false,
      codecName: '',
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
    if (key === 'repeatMode' && this.getPlayerState().repeatMode === 'ONE' &&
        this.playerOwnsRemoteQueue()) {
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
    if (this.disposed || !this.bridge?.publishState) return;
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
    for (const context of this.actionContexts.values()) context.active = false;
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

function parseDidlLite(metadata, uri, DomParserCtor) {
  const fallbackTitle = titleFromUri(uri);
  if (!metadata || !DomParserCtor) return Object.freeze({ title: fallbackTitle, artist: '', album: '' });
  try {
    const document = new DomParserCtor().parseFromString(metadata, 'application/xml');
    if (document.querySelector?.('parsererror')) throw new Error('Invalid XML');
    const textByLocalName = localName => {
      const elements = document.getElementsByTagName?.('*') || [];
      for (const element of elements) {
        if (element.localName === localName) return String(element.textContent || '').trim().slice(0, 1024);
      }
      return '';
    };
    return Object.freeze({
      title: textByLocalName('title') || fallbackTitle,
      artist: textByLocalName('artist'),
      album: textByLocalName('album')
    });
  } catch (_) {
    return Object.freeze({ title: fallbackTitle, artist: '', album: '' });
  }
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
