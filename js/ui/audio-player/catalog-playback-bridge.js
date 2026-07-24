import {
  CatalogSequence,
  claimFolderPermissionAttempt,
  createPlaybackSourceResolutionScope,
  isPlaybackSourceResolutionScope
} from './playback-sequence.js';

const PLAYBACK_DESTINATIONS = Object.freeze({
  play: 'replace',
  playNext: 'after-current',
  queue: 'append'
});
const MAX_TRACKED_OPERATIONS = 64;
const MAX_SAVE_QUEUE_SEGMENTS = 256;

export class CatalogPlaybackBridge {
  constructor({ uiManager, service, sequenceClient = service, runtime = 'web', requestFolderAccess = null } = {}) {
    if (!uiManager || typeof service?.start !== 'function') {
      throw new TypeError('Catalog playback bridge dependencies are invalid');
    }
    if (
      typeof sequenceClient?.readSequencePage !== 'function' ||
      typeof sequenceClient?.resolveSequenceEntrySource !== 'function'
    ) {
      throw playbackBridgeError(
        'playbackSequenceBridgeUnavailable',
        'Playback sequence read and source resolution are unavailable'
      );
    }
    this.uiManager = uiManager;
    this.service = service;
    this.sequenceClient = sequenceClient;
    this.runtime = runtime;
    this.requestFolderAccess = requestFolderAccess;
    this.operations = new Map();
    this.closed = false;
  }

  async start(request) {
    this.#assertOpen();
    const destination = PLAYBACK_DESTINATIONS[request?.operationKind];
    if (!destination) return this.service.start(request);
    const player = this.#getPlayer();
    if (request.operationKind === 'play') player.resumeAudioContextInGesture?.();
    const finishPlaybackPending = request.operationKind === 'play'
      ? player.stateManager?.beginPlaybackPending?.(3) ?? null
      : null;
    let pendingHandedOff = false;
    try {
      if (request.operationKind === 'play' && player.stateRestored) {
        await player.stateRestored;
      }
      const options = { ...(request.options ?? {}), playbackDestination: destination };
      const requestedShuffleSeed = Number.isSafeInteger(options.seed) ? options.seed : null;
      const shuffleEnabled = request.operationKind === 'play' && (
        requestedShuffleSeed !== null ||
        player.stateManager?.getStateSnapshot?.().shuffleMode === true
      );
      if (shuffleEnabled && options.seed == null) options.seed = createPlaybackShuffleSeed();
      const operationRequest = {
        operationKind: request.operationKind,
        selectionDescriptor: request.selectionDescriptor,
        target: request.target ?? {},
        options
      };
      const receipt = await this.service.start(operationRequest);
      if (!receipt?.operationId || receipt.kind !== 'started') return receipt;

      const operation = {
        operationId: receipt.operationId,
        operationKind: request.operationKind,
        shuffleEnabled,
        provisionalPromise: Promise.resolve({ accepted: true }),
        unsubscribe: null
      };
      if (request.operationKind === 'play') {
        operation.provisionalPromise = this.#installPlayProvisional({
          player,
          receipt
        }).finally(() => finishPlaybackPending?.());
        pendingHandedOff = true;
      }
      this.#trackOperation(operation);
      this.#subscribe(operation);
      void this.#recoverTerminal(operation);
      return receipt;
    } finally {
      if (!pendingHandedOff) finishPlaybackPending?.();
    }
  }

  async #installPlayProvisional({ player, receipt }) {
    try {
      const provisionalEntry = receipt.provisionalEntry ??
        await this.service.getProvisionalEntry?.(receipt.operationId);
      if (!provisionalEntry) {
        const status = await this.service.status?.(receipt.operationId);
        if (isTerminalOperationStatus(status)) {
          return {
            accepted: false,
            reason: status.result?.code ?? status.terminalKind ?? 'operationCompleted'
          };
        }
        throw playbackBridgeError('invalidOperationResult', 'Play operation did not resolve a provisional entry');
      }
      if (!player.ui?.container) player.ui?.createPlayerUI?.();
      const resolutionScope = createPlaybackSourceResolutionScope();
      const provisionalResult = await player.playbackManager.installBulkPlayProvisional({
        receipt: { ...receipt, provisionalEntry },
        service: this.service,
        resolutionScope,
        resolveSource: (entry, activeResolutionScope, signal) => this.#resolveSequenceEntrySource({
          entryInstanceId: entry.entryInstanceId,
          trackUid: entry.trackUid,
          resolutionScope: activeResolutionScope,
          signal
        })
      });
      if (!provisionalResult.accepted) {
        throw playbackBridgeError(
          provisionalResult.reason ?? 'sourceUnavailable',
          'Play provisional could not be installed'
        );
      }
      return provisionalResult;
    } catch (error) {
      let cancelResult = null;
      let cancelError = null;
      try {
        cancelResult = await this.service.cancel?.(receipt.operationId) ?? null;
      } catch (caughtCancelError) {
        cancelError = caughtCancelError;
        console.warn('[CatalogPlaybackBridge] Failed to cancel Play after provisional activation failed:', caughtCancelError);
      }
      this.#reportError(error);
      return {
        accepted: false,
        reason: error?.code ?? 'sourceUnavailable',
        cancelResult,
        cancelError
      };
    }
  }

  async status(operationId) {
    const status = await this.service.status(operationId);
    const operation = this.operations.get(operationId);
    if (operation && isTerminalOperationStatus(status)) {
      await this.#finishOperation(operation, {
        state: status.terminalKind,
        result: status.result
      });
    }
    return status;
  }

  cancel(operationId) {
    return this.service.cancel(operationId);
  }

  canUndoPlaybackSession() {
    return this.#getPlayer().playbackManager.canUndoSessionTransport?.() === true;
  }

  undoPlaybackSession() {
    return this.#getPlayer().playbackManager.undoSessionTransport?.() ??
      Promise.resolve({ kind: 'notAvailable' });
  }

  subscribeOperation(operationId, listener) {
    const forward = event => {
      const operation = this.operations.get(operationId);
      if (operation && event?.kind === 'terminal' && event.operationId === operationId) {
        void this.#finishOperation(operation, event.result)
          .then(() => listener(event))
          .catch(error => this.#reportError(error));
        return;
      }
      listener(event);
    };
    if (typeof this.service.subscribeOperation === 'function') {
      return this.service.subscribeOperation(operationId, forward);
    }
    if (typeof this.service.subscribeOperations === 'function') {
      return this.service.subscribeOperations(event => {
        if (event?.operationId === operationId || event?.progress?.operationId === operationId) forward(event);
      });
    }
    throw playbackBridgeError('operationEventsUnavailable', 'Library operation events are unavailable');
  }

  async saveActiveSequenceAsPlaylist({
    name,
    sequenceDescriptor,
    playlistId = globalThis.crypto?.randomUUID?.(),
    expectedVersion = 0,
    clientRequestId = globalThis.crypto?.randomUUID?.(),
    saveId = clientRequestId
  } = {}) {
    this.#assertOpen();
    if (!sequenceDescriptor || !Number.isSafeInteger(sequenceDescriptor.itemCount)) {
      throw playbackBridgeError('invalidSequenceDescriptor', 'Active playback sequence descriptor is invalid');
    }
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw playbackBridgeError('invalidPlaylistName', 'Playlist name is required');
    }
    if (typeof playlistId !== 'string' || playlistId.length === 0 || playlistId.length > 512) {
      throw playbackBridgeError('playlistIdUnavailable', 'A secure playlist ID is unavailable');
    }
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0) {
      throw playbackBridgeError('invalidPlaylistVersion', 'Playlist version must be a non-negative integer');
    }
    if (typeof clientRequestId !== 'string' || clientRequestId.length === 0 || clientRequestId.length > 128 ||
        typeof saveId !== 'string' || saveId.length === 0 || saveId.length > 512) {
      throw playbackBridgeError('operationIdUnavailable', 'Secure Save Queue request IDs are unavailable');
    }
    if (typeof this.service?.start !== 'function') {
      throw playbackBridgeError('libraryServiceUnavailable', 'Library service start is unavailable');
    }
    const request = Object.freeze({
      clientRequestId,
      operationKind: 'addToPlaylist',
      selectionDescriptor: null,
      target: Object.freeze({ playlistId }),
      expectedTargetVersion: expectedVersion,
      options: Object.freeze({
        saveId,
        name: name.trim(),
        sourceSequenceDescriptor: playbackSequenceSaveSource(sequenceDescriptor)
      })
    });
    return this.service.start(request);
  }

  saveQueueAsPlaylist(options) {
    return this.saveActiveSequenceAsPlaylist(options);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const operation of this.operations.values()) operation.unsubscribe?.();
    this.operations.clear();
  }

  #getPlayer() {
    const player = this.uiManager.audioPlayer ?? this.uiManager.createAudioPlayer?.([], false);
    if (!player?.playbackManager) {
      throw playbackBridgeError('audioPlayerUnavailable', 'Audio Player is unavailable');
    }
    player.libraryOperationService = this;
    return player;
  }

  #trackOperation(operation) {
    const previous = this.operations.get(operation.operationId);
    previous?.unsubscribe?.();
    this.operations.set(operation.operationId, operation);
    while (this.operations.size > MAX_TRACKED_OPERATIONS) {
      const [oldestId, oldest] = this.operations.entries().next().value;
      oldest.unsubscribe?.();
      this.operations.delete(oldestId);
    }
  }

  #subscribe(operation) {
    try {
      operation.unsubscribe = this.subscribeOperation(operation.operationId, event => {
        if (event?.kind !== 'terminal' || event.operationId !== operation.operationId) return;
        void this.#finishOperation(operation, event.result);
      });
    } catch (error) {
      if (error?.code !== 'operationEventsUnavailable') throw error;
    }
  }

  async #recoverTerminal(operation) {
    try {
      const status = await this.service.status?.(operation.operationId);
      if (!status) return;
      if (status.result && (status.finishedAt != null || status.terminalKind)) {
        await this.#finishOperation(operation, {
          state: status.terminalKind,
          result: status.result
        });
      }
    } catch (error) {
      this.#reportError(error);
    }
  }

  async #finishOperation(operation, terminal) {
    if (this.operations.get(operation.operationId) !== operation) return;
    if (operation.finishPromise) return operation.finishPromise;
    operation.finishPromise = this.#finishOperationOnce(operation, terminal);
    return operation.finishPromise;
  }

  async #finishOperationOnce(operation, terminal) {
    operation.unsubscribe?.();
    operation.unsubscribe = null;
    let succeeded = false;
    try {
      const provisional = await operation.provisionalPromise;
      if (provisional?.accepted === false) return;
      if (!isSuccessfulTerminal(terminal)) return;
      const applied = await this.#applyTerminal({ ...operation, terminal });
      succeeded = applied?.accepted !== false;
    } catch (error) {
      this.#reportError(error);
    } finally {
      await this.#getPlayer().playbackManager.finishBulkPlayTerminal?.(
        operation.operationId,
        { succeeded }
      );
      if (this.operations.get(operation.operationId) === operation) {
        this.operations.delete(operation.operationId);
      }
    }
  }

  async #applyTerminal({ operationId, operationKind, shuffleEnabled = false, terminal }) {
    const result = terminalResult(terminal);
    if (
      !result || result.operationKind !== operationKind ||
      result.destination !== PLAYBACK_DESTINATIONS[operationKind] ||
      typeof result.sequenceId !== 'string' || result.sequenceId.length === 0 ||
      !Number.isSafeInteger(result.itemCount) || result.itemCount < 1 ||
      !Number.isSafeInteger(result.firstOrdinal) || result.firstOrdinal < 0 ||
      result.firstOrdinal >= result.itemCount ||
      !result.firstEntry?.entryInstanceId || !result.firstEntry?.trackUid
    ) {
      throw playbackBridgeError('invalidOperationResult', 'Playback terminal result is invalid');
    }
    const sequence = new CatalogSequence({
      sequenceId: result.sequenceId,
      itemCount: result.itemCount,
      shuffleSeed: result.shuffleSeed ?? 0,
      shuffleEnabled,
      readPage: async request => {
        const page = await this.sequenceClient.readSequencePage({
          sequenceId: request.sequenceId,
          ordinal: request.startOrdinal,
          limit: request.limit
        });
        return { rows: page?.items ?? page?.rows ?? [] };
      },
      resolveSource: request => this.#resolveSequenceEntrySource(request)
    });
    const currentOrdinal = sequence.toTransportOrdinal(result.firstOrdinal);
    return this.#getPlayer().playbackManager.commitCatalogDestination({
      operationId,
      operationKind,
      sequence,
      currentOrdinal,
      firstEntry: result.firstEntry
    });
  }

  async #resolveSequenceEntrySource(request) {
    const resolutionScope = isPlaybackSourceResolutionScope(request?.resolutionScope)
      ? request.resolutionScope
      : createPlaybackSourceResolutionScope();
    const {
      resolutionScope: _resolutionScope,
      signal,
      ...sourceRequest
    } = request ?? {};
    throwIfPlaybackSourceResolutionAborted(signal);
    try {
      const source = await this.sequenceClient.resolveSequenceEntrySource(sourceRequest);
      throwIfPlaybackSourceResolutionAborted(signal);
      return source;
    } catch (error) {
      throwIfPlaybackSourceResolutionAborted(signal);
      const folderId = error?.details?.folderId;
      const lifecycleVersion = error?.details?.lifecycleVersion;
      if (
        error?.code !== 'folderPermissionRequired' ||
        typeof folderId !== 'string' ||
        !Number.isSafeInteger(lifecycleVersion) ||
        lifecycleVersion < 0 ||
        typeof this.requestFolderAccess !== 'function'
      ) {
        throw error;
      }
      if (!claimFolderPermissionAttempt(resolutionScope, folderId, lifecycleVersion)) throw error;
      let restored;
      try {
        restored = await this.requestFolderAccess(folderId);
      } catch (reconnectError) {
        throwIfPlaybackSourceResolutionAborted(signal);
        console.warn('Unable to reconnect the library folder for playback.', reconnectError);
        throw error;
      }
      throwIfPlaybackSourceResolutionAborted(signal);
      if (!folderAccessWasRestored(restored, folderId, lifecycleVersion)) throw error;
      const source = await this.sequenceClient.resolveSequenceEntrySource(sourceRequest);
      throwIfPlaybackSourceResolutionAborted(signal);
      return source;
    }
  }

  #reportError(error) {
    if (error?.code === 'folderPermissionRequired') {
      console.warn('Library playback skipped a track because folder access was not restored.', error);
      this.uiManager.showTransientMessage?.('status.libraryTracksSkippedOffline', false, { count: 1 });
      return;
    }
    console.error('Music Library playback failed:', error);
    if (typeof this.uiManager.showTransientMessage === 'function') {
      this.uiManager.showTransientMessage('library.error.actionFailed', true);
    } else {
      this.uiManager.setError?.('library.error.actionFailed', true);
    }
  }

  #assertOpen() {
    if (this.closed) throw playbackBridgeError('playbackBridgeClosed', 'Catalog playback bridge is closed');
  }
}

function playbackBridgeError(code, message) {
  const error = new Error(message);
  error.name = 'CatalogPlaybackBridgeError';
  error.code = code;
  return error;
}

function createPlaybackShuffleSeed() {
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const values = new Uint32Array(1);
    globalThis.crypto.getRandomValues(values);
    return values[0];
  }
  return Math.floor(Math.random() * 0x100000000);
}

function throwIfPlaybackSourceResolutionAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason ?? playbackBridgeError(
    'playbackResolutionAborted',
    'Playback source resolution was canceled'
  );
}

function isTerminalOperationStatus(status) {
  return status?.result && (status.finishedAt != null || status.terminalKind != null);
}

function terminalResult(terminal) {
  return terminal?.result && typeof terminal.result === 'object'
    ? terminal.result
    : terminal;
}

function isSuccessfulTerminal(terminal) {
  const state = terminal?.state ?? terminal?.terminalKind;
  return state === 'succeeded' || (state == null && terminalResult(terminal)?.operationKind);
}

function folderAccessWasRestored(result, folderId, lifecycleVersion) {
  if (!result || typeof result !== 'object' || result.canceled === true) return false;
  const folder = result.folder;
  return folder?.id === folderId &&
    Number.isSafeInteger(folder.lifecycleVersion) &&
    folder.lifecycleVersion >= lifecycleVersion &&
    ['active', 'ok'].includes(folder.status);
}

function playbackSequenceSaveSource(descriptor) {
  if (descriptor.kind === 'catalog') {
    const segment = {
      sequenceId: boundedSequenceId(descriptor.sequenceId),
      startOrdinal: 0,
      endOrdinal: descriptor.itemCount
    };
    appendShuffleState(segment, descriptor);
    return Object.freeze({ segments: Object.freeze([Object.freeze(segment)]) });
  }
  if (descriptor.kind !== 'composite' || !Array.isArray(descriptor.segments)) {
    throw playbackBridgeError('invalidSequenceDescriptor', 'Active playback sequence cannot be saved');
  }
  const segments = [];
  appendSaveSegments(segments, descriptor, 0, descriptor.itemCount);
  if (segments.length === 0 || segments.length > MAX_SAVE_QUEUE_SEGMENTS) {
    throw playbackBridgeError('sequenceSegmentLimitExceeded', 'Active playback sequence has too many segments to save');
  }
  const source = { segments: Object.freeze(segments.map(segment => Object.freeze(segment))) };
  appendDescriptorShuffleState(source, descriptor);
  return Object.freeze(source);
}

function appendSaveSegments(output, descriptor, startOrdinal, itemCount) {
  if (!Number.isSafeInteger(startOrdinal) || startOrdinal < 0 ||
      !Number.isSafeInteger(itemCount) || itemCount < 1 ||
      startOrdinal + itemCount > descriptor.itemCount) {
    throw playbackBridgeError('invalidSequenceDescriptor', 'Playback sequence segment bounds are invalid');
  }
  if (descriptor.kind === 'catalog') {
    const segment = {
      sequenceId: boundedSequenceId(descriptor.sequenceId),
      startOrdinal,
      endOrdinal: startOrdinal + itemCount
    };
    appendShuffleState(segment, descriptor);
    appendMergedSaveSegment(output, segment);
    return;
  }
  if (descriptor.kind !== 'composite' || !Array.isArray(descriptor.segments)) {
    throw playbackBridgeError('invalidSequenceDescriptor', 'Composite playback source is invalid');
  }
  let compositeOffset = 0;
  let remainingStart = startOrdinal;
  let remainingCount = itemCount;
  for (const segment of descriptor.segments) {
    const segmentCount = segment?.itemCount;
    if (!Number.isSafeInteger(segmentCount) || segmentCount < 1 || !segment?.source) {
      throw playbackBridgeError('invalidSequenceDescriptor', 'Composite playback segment is invalid');
    }
    if (remainingStart >= compositeOffset + segmentCount) {
      compositeOffset += segmentCount;
      continue;
    }
    const localStart = Math.max(0, remainingStart - compositeOffset);
    const takeCount = Math.min(segmentCount - localStart, remainingCount);
    appendSaveSegments(
      output,
      segment.source,
      (segment.startOrdinal ?? 0) + localStart,
      takeCount
    );
    if (output.length > MAX_SAVE_QUEUE_SEGMENTS) return;
    remainingStart += takeCount;
    remainingCount -= takeCount;
    if (remainingCount === 0) return;
    compositeOffset += segmentCount;
  }
  throw playbackBridgeError('invalidSequenceDescriptor', 'Composite playback segments do not cover the active queue');
}

function appendMergedSaveSegment(output, segment) {
  const previous = output.at(-1);
  if (previous?.sequenceId === segment.sequenceId &&
      previous.endOrdinal === segment.startOrdinal &&
      sameShuffleState(previous, segment)) {
    previous.endOrdinal = segment.endOrdinal;
    return;
  }
  output.push(segment);
}

function appendShuffleState(segment, descriptor) {
  if (!descriptor.shuffleEnabled) return;
  for (const field of ['shuffleSeed', 'shuffleEpoch', 'shuffleTransportOffset']) {
    const value = descriptor[field];
    if (!Number.isSafeInteger(value) || (field === 'shuffleTransportOffset' && value < 0)) {
      throw playbackBridgeError('invalidSequenceDescriptor', 'Playback shuffle state is invalid');
    }
    segment[field] = value;
  }
}

function appendDescriptorShuffleState(target, descriptor) {
  if (!descriptor.shuffleEnabled) return;
  appendShuffleState(target, descriptor);
}

function sameShuffleState(left, right) {
  return ['shuffleSeed', 'shuffleEpoch', 'shuffleTransportOffset']
    .every(field => left[field] === right[field]);
}

function boundedSequenceId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw playbackBridgeError('invalidSequenceDescriptor', 'Playback sequence ID is invalid');
  }
  return value;
}
