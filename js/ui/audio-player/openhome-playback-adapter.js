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

  createNetworkEntry(args) {
    const uri = normalizeRemoteUri(args.uri);
    const playbackUrl = normalizePlaybackUrl(args.playbackUrl);
    const artworkUrl = args.artworkUrl === undefined
      ? ''
      : normalizePlaybackUrl(args.artworkUrl);
    const metadata = normalizeMetadata(args.metadata);
    const meta = parseDidlLite(metadata, uri, this.DomParserCtor, artworkUrl);
    return { uri, playbackUrl, metadata, meta };
  }

  async playNetworkTracks(tracks, operationKind = 'play', isCurrent = () => true, startIndex = 0) {
    const entries = tracks.map(track => ({
      ...this.createNetworkEntry({ uri: track.resources?.[0]?.uri, playbackUrl: track.uri, metadata: track.metadata }),
      meta: Object.freeze({ title: track.title, artist: track.artist || '', album: track.album || '', duration: track.duration })
    }));
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
        entries.push({ ...this.createNetworkEntry({ uri: track.resources?.[0]?.uri, playbackUrl: track.uri, metadata: track.metadata }),
          meta: { title: track.title || 'Track', artist: track.artist || '', album: track.album || '', duration: track.duration || 0 } });
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
    const id = this.queue[queueIndex].id;
    const manager = this.audioPlayer.playbackManager;
    const playlistIndex = manager.catalogSequence
      ? manager.catalogSequence.toTransportOrdinal(queueIndex)
      : manager.playlist.findIndex(track => this.getTrackId(track) === id);
    if (playlistIndex < 0) throw createActionError('track-not-found');
    const resumed = await (this.audioPlayer.resumeAudioContextForRemotePlayback?.() ?? true);
    this.assertActionActive(context);
    if (resumed !== true) throw createActionError('seek-failed');
    const pending = this.audioPlayer.playbackManager.selectQueueOrdinal(playlistIndex, {
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

  getSnapshot() {
    const state = this.getPlayerState();
    const currentEntry = this.queue.find(entry => entry.id === this.getTrackId(state.currentTrack)) || null;
    const currentId = currentEntry?.id || 0;
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

function parseDidlLite(metadata, uri, DomParserCtor, artworkUrl = '') {
  const fallbackTitle = titleFromUri(uri);
  const fallback = { title: fallbackTitle, artist: '', album: '', artworkUrl };
  if (!metadata || !DomParserCtor) return Object.freeze(fallback);
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
      album: textByLocalName('album'),
      artworkUrl
    });
  } catch (_) {
    return Object.freeze(fallback);
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
