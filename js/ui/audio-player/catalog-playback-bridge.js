import { CatalogSequence, CompositeCatalogSequence } from './playback-sequence.js';

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
    const expectedTransportVersion = Number.isSafeInteger(request.expectedTargetVersion)
      ? request.expectedTargetVersion
      : player.playbackManager.transportVersion;
    const operationRequest = {
      ...request,
      expectedTargetVersion: expectedTransportVersion,
      options: { ...(request.options ?? {}), playbackDestination: destination }
    };
    const receipt = await this.service.start(operationRequest);
    if (receipt?.kind === 'terminal') {
      const recoveredOperationId = receipt.operationId ?? `recovered:${request.clientRequestId}`;
      if (request.operationKind === 'play' && receipt.result?.state === 'succeeded') {
        const restored = await this.restoreTransport();
        if (!restored.restored) {
          throw playbackBridgeError('invalidOperationResult', 'Recovered Play transport is unavailable');
        }
        return receipt;
      }
      await this.#applyTerminal({
        operationId: recoveredOperationId,
        operationKind: request.operationKind,
        expectedTransportVersion,
        terminal: receipt.result
      });
      return receipt;
    }
    if (!receipt?.operationId || !['started', 'active'].includes(receipt.kind)) return receipt;

    const operation = {
      operationId: receipt.operationId,
      operationKind: request.operationKind,
      expectedTransportVersion,
      provisionalPromise: Promise.resolve({ accepted: true }),
      unsubscribe: null
    };
    if (request.operationKind === 'play') {
      operation.provisionalPromise = this.#installPlayProvisional({
        player,
        receipt,
        expectedTransportVersion
      });
    }
    this.#trackOperation(operation);
    this.#subscribe(operation);
    void this.#recoverTerminal(operation);
    return receipt;
  }

  async #installPlayProvisional({ player, receipt, expectedTransportVersion }) {
    try {
      const provisionalEntry = receipt.provisionalEntry ??
        await this.service.getProvisionalEntry?.(receipt.operationId);
      if (!provisionalEntry) {
        throw playbackBridgeError('invalidOperationResult', 'Play operation did not resolve a provisional entry');
      }
      const provisionalResult = await player.playbackManager.installBulkPlayProvisional({
        receipt: { ...receipt, provisionalEntry },
        service: this.service,
        expectedTransportVersion,
        resolveSource: entry => this.#resolveSequenceEntrySource({
          entryInstanceId: entry.entryInstanceId,
          trackUid: entry.trackUid
        })
      });
      if (!provisionalResult.accepted) {
        throw playbackBridgeError(
          provisionalResult.reason ?? 'sourceUnavailable',
          'Play provisional could not be installed'
        );
      }
      if (!player.ui?.container) player.ui?.createPlayerUI?.();
      return provisionalResult;
    } catch (error) {
      await Promise.resolve(this.service.cancel?.(receipt.operationId)).catch(() => {});
      this.#reportError(error);
      return { accepted: false, reason: error?.code ?? 'sourceUnavailable' };
    }
  }

  lookupResult(clientRequestId) {
    return this.service.lookupResult(clientRequestId);
  }

  status(operationId) {
    return this.service.status(operationId);
  }

  cancel(operationId) {
    return this.service.cancel(operationId);
  }

  commitTransportCommand(request) {
    if (typeof this.service.commitTransportCommand !== 'function') {
      throw playbackBridgeError('transportAuthorityUnavailable', 'Durable playback transport is unavailable');
    }
    return this.service.commitTransportCommand(request);
  }

  applyTransportUndo(request) {
    if (typeof this.service.applyTransportUndo !== 'function') {
      throw playbackBridgeError('transportUndoUnavailable', 'Playback queue Undo is unavailable');
    }
    return this.service.applyTransportUndo(request);
  }

  async undoCancelledPlay({ undoId, expectedTransportVersion } = {}) {
    this.#assertOpen();
    const player = this.#getPlayer();
    const expected = Number.isSafeInteger(expectedTransportVersion)
      ? expectedTransportVersion
      : player.playbackManager.transportVersion;
    const result = await this.applyTransportUndo({ undoId, expectedTransportVersion: expected });
    if (result?.kind !== 'published') return result;
    const sequence = await createSequenceFromTransportDescriptor(
      result.descriptor,
      result.transportVersion,
      this.sequenceClient,
      request => this.#resolveSequenceEntrySource(request)
    );
    player.playbackManager.transportVersion = result.transportVersion;
    player.playbackManager.durableTransportDescriptor = result.descriptor;
    player.playbackManager.activeBulkPlay = null;
    await player.playbackManager.loadCatalogSequence(sequence, {
      currentOrdinal: result.descriptor.currentOrdinal ?? 0,
      autoPlay: true,
      userInitiated: true
    });
    return result;
  }

  async restoreTransport() {
    if (typeof this.service.getTransportState !== 'function') return { restored: false, reason: 'unavailable' };
    const state = await this.service.getTransportState();
    if (!Number.isSafeInteger(state?.transportVersion) || state.transportVersion < 0 ||
        !Array.isArray(state?.descriptor?.segments) || state.descriptor.segments.length === 0) {
      return { restored: false, reason: 'empty' };
    }
    const sequence = await createSequenceFromTransportDescriptor(
      state.descriptor,
      state.transportVersion,
      this.sequenceClient,
      request => this.#resolveSequenceEntrySource(request)
    );
    const player = this.#getPlayer();
    player.playbackManager.transportVersion = state.transportVersion;
    player.playbackManager.durableTransportDescriptor = state.descriptor;
    await player.playbackManager.loadCatalogSequence(sequence, {
      currentOrdinal: state.descriptor.currentOrdinal ?? 0,
      preservePlayback: true
    });
    return { restored: true, transportVersion: state.transportVersion };
  }

  subscribeOperation(operationId, listener) {
    if (typeof this.service.subscribeOperation === 'function') {
      return this.service.subscribeOperation(operationId, listener);
    }
    if (typeof this.service.subscribeOperations === 'function') {
      return this.service.subscribeOperations(event => {
        if (event?.operationId === operationId || event?.progress?.operationId === operationId) listener(event);
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
        await this.#finishOperation(operation, status.result);
      }
    } catch (error) {
      this.#reportError(error);
    }
  }

  async #finishOperation(operation, terminal) {
    if (this.operations.get(operation.operationId) !== operation) return;
    operation.unsubscribe?.();
    operation.unsubscribe = null;
    try {
      const provisional = await operation.provisionalPromise;
      if (provisional?.accepted === false) return;
      await this.#applyTerminal({ ...operation, terminal });
    } catch (error) {
      this.#reportError(error);
    } finally {
      if (this.operations.get(operation.operationId) === operation) {
        this.operations.delete(operation.operationId);
      }
    }
  }

  async #applyTerminal({ operationId, operationKind, expectedTransportVersion, terminal }) {
    if (terminal?.state !== 'succeeded') return { accepted: false, reason: terminal?.state ?? 'invalid-terminal' };
    const result = terminal.result;
    if (
      !result || result.operationKind !== operationKind ||
      result.destination !== PLAYBACK_DESTINATIONS[operationKind] ||
      !Number.isSafeInteger(result.itemCount) || result.itemCount < 1
    ) {
      throw playbackBridgeError('invalidOperationResult', 'Playback terminal result is invalid');
    }
    if (result.expectedTransportVersion !== expectedTransportVersion) {
      throw playbackBridgeError('staleTransportVersion', 'Playback terminal CAS token does not match the request');
    }
    if (result.transportVersion !== expectedTransportVersion + 1 ||
        !result.transportDescriptor || !Array.isArray(result.transportDescriptor.segments)) {
      throw playbackBridgeError('invalidOperationResult', 'Playback terminal omitted authoritative transport state');
    }
    const sequence = new CatalogSequence({
      sequenceId: result.sequenceId,
      itemCount: result.itemCount,
      shuffleSeed: result.shuffleSeed ?? 0,
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
    return this.#getPlayer().playbackManager.commitCatalogDestination({
      operationId,
      operationKind,
      sequence,
      expectedTransportVersion,
      transportVersion: result.transportVersion,
      transportDescriptor: result.transportDescriptor
    });
  }

  async #resolveSequenceEntrySource(request) {
    try {
      return await this.sequenceClient.resolveSequenceEntrySource(request);
    } catch (error) {
      const folderId = error?.details?.folderId;
      if (
        this.runtime !== 'web' ||
        error?.code !== 'folderPermissionRequired' ||
        typeof folderId !== 'string' ||
        typeof this.requestFolderAccess !== 'function'
      ) {
        throw error;
      }
      let restored;
      try {
        restored = await this.requestFolderAccess(folderId);
      } catch (reconnectError) {
        console.warn('Unable to reconnect the library folder for playback.', reconnectError);
        throw error;
      }
      if (!restored) throw error;
      return this.sequenceClient.resolveSequenceEntrySource(request);
    }
  }

  #reportError(error) {
    if (error?.code === 'folderPermissionRequired') {
      console.warn('Library playback skipped a track because folder access was not restored.', error);
      this.uiManager.setError?.('status.libraryTracksSkippedOffline', false, { count: 1 });
      return;
    }
    console.error('Music Library playback failed:', error);
    this.uiManager.setError?.('library.error.actionFailed', true);
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

async function createSequenceFromTransportDescriptor(descriptor, transportVersion, sequenceClient, resolveSource) {
  if (descriptor.segments.length > MAX_SAVE_QUEUE_SEGMENTS) {
    throw playbackBridgeError('transportDescriptorLimit', 'Persisted playback transport has too many segments');
  }
  const itemCounts = new Map();
  await Promise.all([...new Set(descriptor.segments.map(segment => boundedSequenceId(segment.sequenceId)))]
    .map(async sequenceId => {
      const page = await sequenceClient.readSequencePage({ sequenceId, ordinal: 0, limit: 1 });
      const itemCount = page?.sequence?.itemCount;
      if (!Number.isSafeInteger(itemCount) || itemCount < 1) {
        throw playbackBridgeError('invalidTransportDescriptor', 'Persisted playback sequence metadata is invalid');
      }
      itemCounts.set(sequenceId, itemCount);
    }));
  const segments = descriptor.segments.map(segment => {
    const sequenceId = boundedSequenceId(segment.sequenceId);
    const itemCount = itemCounts.get(sequenceId);
    const source = new CatalogSequence({
      sequenceId,
      itemCount,
      shuffleSeed: segment.shuffleSeed ?? 0,
      shuffleEpoch: segment.shuffleEpoch ?? 0,
      shuffleEnabled: segment.shuffleSeed != null,
      shuffleTransportOffset: segment.shuffleTransportOffset ?? 0,
      readPage: async request => {
        const page = await sequenceClient.readSequencePage({
          sequenceId: request.sequenceId,
          ordinal: request.startOrdinal,
          limit: request.limit
        });
        return { rows: page?.items ?? page?.rows ?? [] };
      },
      resolveSource
    });
    return {
      sequence: source,
      startOrdinal: segment.startOrdinal,
      itemCount: segment.endOrdinal - segment.startOrdinal
    };
  });
  return new CompositeCatalogSequence({
    sequenceId: `transport:${transportVersion}`,
    segments,
    shuffleSeed: descriptor.shuffleSeed ?? 0,
    shuffleEpoch: descriptor.shuffleEpoch ?? 0,
    shuffleEnabled: descriptor.shuffleSeed != null,
    shuffleTransportOffset: descriptor.shuffleTransportOffset ?? 0
  });
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
