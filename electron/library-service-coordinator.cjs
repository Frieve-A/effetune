'use strict';

const { createHash, randomUUID, webcrypto } = require('node:crypto');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const LIBRARY_SERVICE_API_VERSION = 1;
const LIBRARY_SERVICE_EVENT_CHANNEL = 'library-service-v1:event';
const LIBRARY_SERVICE_CHANNELS = Object.freeze({
  start: 'library-service-v1:start',
  lookupResult: 'library-service-v1:lookup-result',
  status: 'library-service-v1:status',
  cancel: 'library-service-v1:cancel'
});
const LIBRARY_PLAYBACK_CHANNELS = Object.freeze({
  commitTransportCommand: 'library-playback-v1:commit-transport-command',
  getTransportState: 'library-playback-v1:get-transport-state',
  applyTransportUndo: 'library-playback-v1:apply-transport-undo',
  getProvisionalEntry: 'library-playback-v1:get-provisional-entry',
  readSequencePage: 'library-playback-v1:read-sequence-page',
  resolveSequenceEntrySource: 'library-playback-v1:resolve-sequence-entry-source'
});
const PLAYBACK_DESTINATIONS = Object.freeze({
  play: 'replace',
  playNext: 'after-current',
  queue: 'append'
});
const PLAYBACK_OPERATION_KINDS = new Set(['play', 'playNext', 'queue']);
const SUPPORTED_OPERATION_KINDS = new Set([...PLAYBACK_OPERATION_KINDS, 'addToPlaylist', 'importPlaylist']);
const MATERIALIZE_PAGE_ROWS = 500;
const MAX_IPC_REQUEST_BYTES = 512 * 1024;
const MAX_PROVISIONAL_ENTRIES = 128;
const PROGRESS_RELAY_INTERVAL_MS = 250;

class LibraryServiceCoordinator extends EventEmitter {
  constructor({
    repository,
    DurableLibraryService,
    parsePlaylistStream = null,
    importSourceProvider = null,
    cryptoApi = webcrypto,
    now = () => Date.now()
  }) {
    super();
    if (!repository || typeof repository.readContextPage !== 'function') {
      throw createServiceError('invalidRepository', 'Library service repository is invalid');
    }
    this.repository = repository;
    this.parsePlaylistStream = parsePlaylistStream;
    this.importSourceProvider = importSourceProvider;
    this.now = now;
    this.provisionals = new Map();
    this.progressRelays = new Map();
    this.disposed = false;
    const observableRepository = createObservableRepository(repository, {
      onProgress: progress => this.relayProgress(progress),
      onTerminal: (operationId, result) => this.relayTerminal(operationId, result)
    });
    this.service = new DurableLibraryService({
      repository: observableRepository,
      cryptoApi,
      now,
      handlers: {
        play: context => this.handlePlaybackOperation(context),
        playNext: context => this.handlePlaybackOperation(context),
        queue: context => this.handlePlaybackOperation(context),
        addToPlaylist: context => this.handleAddToPlaylist(context),
        importPlaylist: context => this.handlePlaylistImport(context)
      }
    });
  }

  static async open(options = {}) {
    const servicePath = path.join(
      __dirname,
      '..',
      'js',
      'library',
      'operations',
      'durable-library-service.js'
    );
    const playlistStreamPath = path.join(
      __dirname,
      '..',
      'js',
      'library',
      'playlists',
      'playlist-stream.js'
    );
    const [{ DurableLibraryService }, { parsePlaylistStream }] = await Promise.all([
      import(pathToFileURL(servicePath).href),
      import(pathToFileURL(playlistStreamPath).href)
    ]);
    return new LibraryServiceCoordinator({ ...options, DurableLibraryService, parsePlaylistStream });
  }

  async start(request) {
    this.assertOpen();
    assertBoundedMessage(request);
    if (!request || !SUPPORTED_OPERATION_KINDS.has(request.operationKind)) {
      throw createServiceError('invalidOperationKind', 'Operation kind is not supported by the desktop service');
    }
    return this.service.start(request);
  }

  lookupResult(clientRequestId) {
    this.assertOpen();
    return this.service.lookupResult(requireBoundedString(clientRequestId, 'clientRequestId'));
  }

  async status(operationId) {
    this.assertOpen();
    const status = await this.service.status(requireBoundedString(operationId, 'operationId'));
    if (!status) return null;
    return {
      operationId: status.operationId,
      operationKind: status.operationKind,
      phase: status.phase,
      committed: Boolean(status.committed),
      processed: status.processed,
      total: status.total,
      createdAt: status.createdAt,
      updatedAt: status.updatedAt,
      finishedAt: status.finishedAt,
      terminalKind: status.terminalKind,
      terminalCode: status.terminalCode,
      progress: status.progress,
      result: status.result
    };
  }

  cancel(operationId) {
    this.assertOpen();
    return this.service.cancel(requireBoundedString(operationId, 'operationId'));
  }

  getProvisionalEntry(operationId) {
    this.assertOpen();
    return this.waitForProvisional(requireBoundedString(operationId, 'operationId'));
  }

  commitTransportCommand(request = {}) {
    this.assertOpen();
    assertBoundedMessage(request);
    return this.repository.commitTransportState({
      expectedTransportVersion: requireBoundedOrdinal(
        request.expectedTransportVersion,
        'expectedTransportVersion'
      ),
      descriptor: request.descriptor,
      updatedAt: this.now()
    });
  }

  getTransportState() {
    this.assertOpen();
    return this.repository.getTransportState();
  }

  applyTransportUndo(request = {}) {
    this.assertOpen();
    assertBoundedMessage(request);
    return this.repository.applyTransportUndo({
      undoId: requireBoundedString(request.undoId, 'undoId'),
      expectedTransportVersion: requireBoundedOrdinal(
        request.expectedTransportVersion,
        'expectedTransportVersion'
      ),
      appliedAt: this.now()
    });
  }

  readSequencePage(request) {
    this.assertOpen();
    return this.repository.queryPlaybackSequence({
      sequenceId: requireBoundedString(request?.sequenceId, 'sequenceId'),
      ordinal: requireBoundedOrdinal(request?.ordinal, 'ordinal'),
      limit: requirePlaybackPageLimit(request?.limit)
    });
  }

  async resolveSequenceEntrySource(request = {}) {
    this.assertOpen();
    let entry = null;
    let trackUid = request.trackUid ?? null;
    if (request.sequenceId != null) {
      const sequenceId = requireBoundedString(request.sequenceId, 'sequenceId');
      const ordinal = requireBoundedOrdinal(request.ordinal, 'ordinal');
      const page = await this.repository.queryPlaybackSequence({ sequenceId, ordinal, limit: 1 });
      entry = page.items?.[0] ?? null;
      if (!entry || entry.ordinal !== ordinal) {
        throw createServiceError('sequenceEntryNotFound', 'Playback sequence entry does not exist');
      }
      if (request.entryInstanceId != null && entry.entryInstanceId !== request.entryInstanceId) {
        throw createServiceError('staleSequenceEntry', 'Playback sequence entry changed');
      }
      trackUid = entry.trackUid;
    }
    trackUid = requireBoundedString(trackUid, 'trackUid');
    const source = await this.repository.resolvePlaybackSource(trackUid);
    return {
      ...source,
      sequenceId: request.sequenceId ?? null,
      ordinal: request.ordinal ?? null,
      entryInstanceId: entry?.entryInstanceId ?? request.entryInstanceId ?? null,
      trackUid
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const relay of this.progressRelays.values()) {
      if (relay.timer) clearTimeout(relay.timer);
    }
    this.progressRelays.clear();
    this.provisionals.clear();
    this.removeAllListeners();
  }

  async handlePlaybackOperation({ operationId, request, reportProgress, checkCancelled }) {
    let firstEntry = null;
    let snapshot;
    try {
      snapshot = await this.materializeSelection({
        operationId,
        descriptor: request.selectionDescriptor,
        reportProgress,
        checkCancelled,
        onFirstTrack: async (trackUid, catalogVersion) => {
          const entry = {
            ordinal: 0,
            entryInstanceId: randomUUID(),
            trackUid
          };
          if (request.operationKind === 'play') {
            if (typeof this.repository.publishProvisionalTransport !== 'function') {
              throw createServiceError(
                'transportAuthorityUnavailable',
                'Durable provisional playback transport is unavailable'
              );
            }
            const published = await this.repository.publishProvisionalTransport({
              operationId,
              sourceContext: request.selectionDescriptor.contextToken,
              catalogVersion,
              expectedTransportVersion: request.expectedTargetVersion,
              firstEntry: entry,
              publishedAt: this.now()
            });
            if (published.kind === 'conflict') {
              throw createServiceError('transportVersionConflict', 'Transport version changed before provisional Play', {
                currentTransportVersion: published.currentTransportVersion
              });
            }
            Object.assign(entry, {
              transportVersion: published.transportVersion,
              transportDescriptor: published.descriptor,
              undoId: published.undoId,
              undoExpiresAt: published.undoExpiresAt
            });
          }
          firstEntry = Object.freeze(entry);
          if (request.operationKind === 'play') this.resolveProvisional(operationId, firstEntry);
        }
      });
    } catch (error) {
      if (request.operationKind === 'play') this.resolveProvisional(operationId, null);
      throw error;
    }
    if (!firstEntry) {
      this.resolveProvisional(operationId, null);
      throw createServiceError('emptySelection', 'The selected operation contains no tracks');
    }

    const sequenceId = randomUUID();
    await this.repository.createPlaybackSequence({
      sequenceId,
      operationId,
      sourceContext: request.selectionDescriptor.contextToken,
      catalogVersion: snapshot.catalogVersion,
      seed: normalizeOptionalSeed(request.options.seed),
      snapshotId: null,
      createdAt: this.now()
    });
    let ordinal = 0;
    while (ordinal < snapshot.itemCount) {
      checkCancelled();
      const page = await this.repository.queryOperationSnapshot({
        snapshotId: snapshot.snapshotId,
        ordinal,
        limit: MATERIALIZE_PAGE_ROWS
      });
      const items = page.items.map(item => ({
        trackUid: item.trackUid,
        entryInstanceId: request.operationKind !== 'play' && item.ordinal === 0
          ? firstEntry.entryInstanceId
          : randomUUID()
      }));
      await this.repository.appendPlaybackSequenceItems({ sequenceId, items });
      ordinal += items.length;
      await reportProgress({
        phase: 'materializing',
        processed: snapshot.itemCount + ordinal,
        total: snapshot.itemCount * 2,
        state: 'running'
      });
    }
    await this.repository.sealPlaybackSequence({
      sequenceId,
      itemCount: snapshot.itemCount,
      currentOrdinal: 0,
      sealedAt: this.now()
    });
    await this.repository.transitionOperation(operationId, 'READY', { updatedAt: this.now() });
    checkCancelled();
    await this.repository.transitionOperation(operationId, 'COMMITTING', { updatedAt: this.now() });

    const destination = PLAYBACK_DESTINATIONS[request.operationKind];
    const requestedDestination = request.options?.playbackDestination;
    if (requestedDestination != null && requestedDestination !== destination) {
      throw createServiceError('invalidPlaybackDestination', 'Playback destination does not match the operation kind');
    }
    const published = await this.repository.publishTransportSequence({
      sequenceId,
      operationId,
      operationKind: request.operationKind,
      expectedTransportVersion: request.expectedTargetVersion,
      currentOrdinal: normalizeOptionalSeed(request.options.currentOrdinal) ?? 0,
      finishedAt: this.now(),
      result: {
        operationKind: request.operationKind,
        destination,
        sequenceId,
        itemCount: snapshot.itemCount,
        firstOrdinal: 0,
        firstEntry,
        shuffleSeed: normalizeOptionalSeed(request.options.seed) ?? 0,
        expectedTransportVersion: request.expectedTargetVersion,
        publishToken: { operationId, expectedTransportVersion: request.expectedTargetVersion }
      }
    });
    if (published.kind === 'conflict') {
      throw createServiceError('transportVersionConflict', 'Transport version changed before publish', {
        currentTransportVersion: published.currentTransportVersion
      });
    }
    return published.result ?? published;
  }

  async handleAddToPlaylist({ operationId, request, reportProgress, checkCancelled }) {
    if (request.options?.sourceSequenceDescriptor) {
      return this.handleSequencePlaylistSave({ operationId, request, reportProgress, checkCancelled });
    }
    const playlistId = requirePlaylistTarget(request.target);
    if (request.expectedTargetVersion === null) {
      throw createServiceError('invalidTargetVersion', 'Playlist operations require an expected version');
    }
    const snapshot = await this.materializeSelection({
      operationId,
      descriptor: request.selectionDescriptor,
      reportProgress,
      checkCancelled
    });
    let ordinal = 0;
    while (ordinal < snapshot.itemCount) {
      checkCancelled();
      const page = await this.repository.queryOperationSnapshot({
        snapshotId: snapshot.snapshotId,
        ordinal,
        limit: MATERIALIZE_PAGE_ROWS
      });
      const appended = await this.repository.appendPlaylistItems({
        playlistId,
        operationId,
        items: page.items.map(item => ({ trackUid: item.trackUid }))
      });
      if (appended.kind === 'busy') throw createServiceError('busy', 'Playlist is busy');
      ordinal += page.items.length;
      await reportProgress({
        phase: 'materializing',
        processed: snapshot.itemCount + ordinal,
        total: snapshot.itemCount * 2,
        state: 'running'
      });
    }
    await this.repository.transitionOperation(operationId, 'READY', { updatedAt: this.now() });
    checkCancelled();
    await this.repository.transitionOperation(operationId, 'COMMITTING', { updatedAt: this.now() });
    const published = await this.repository.publishPlaylist({
      playlistId,
      operationId,
      expectedVersion: request.expectedTargetVersion,
      finishedAt: this.now()
    });
    if (published.kind === 'conflict') {
      throw createServiceError('playlistVersionConflict', 'Playlist version changed before publish', {
        currentVersion: published.currentVersion
      });
    }
    return { playlistId, version: published.version, itemCount: snapshot.itemCount };
  }

  async handlePlaylistImport({ operationId, request, runtime, reportProgress, checkCancelled }) {
    const playlistId = requirePlaylistTarget(request.target);
    if (request.expectedTargetVersion !== 0) {
      throw createServiceError('invalidTargetVersion', 'Playlist import requires a new playlist target');
    }
    if (typeof this.parsePlaylistStream !== 'function' ||
        typeof this.importSourceProvider?.consumePlaylistImportGrant !== 'function') {
      throw createServiceError('playlistSourceUnavailable', 'Desktop playlist import is unavailable');
    }
    const source = await this.importSourceProvider.consumePlaylistImportGrant(runtime?.source);
    const name = requirePlaylistName(request.options.name);
    await this.repository.createPlaylist({ playlistId, name, operationId, createdAt: this.now() });
    let batch = [];
    let processed = 0;
    for await (const record of this.parsePlaylistStream(() => source.stream(), {
      fileName: source.name,
      encoding: request.options.encoding ?? undefined,
      limits: request.options.limits ?? undefined
    })) {
      checkCancelled();
      batch.push(record);
      if (batch.length < MATERIALIZE_PAGE_ROWS) continue;
      const staged = await this.repository.appendPlaylistImportRecords({ playlistId, operationId, records: batch });
      if (staged.kind === 'insufficientStorage') {
        throw createServiceError('insufficientStorage', 'Playlist import requires more storage', staged);
      }
      processed += batch.length;
      batch = [];
      await reportProgress({ phase: 'materializing', processed, total: null, state: 'running' });
    }
    if (batch.length) {
      const staged = await this.repository.appendPlaylistImportRecords({ playlistId, operationId, records: batch });
      if (staged.kind === 'insufficientStorage') {
        throw createServiceError('insufficientStorage', 'Playlist import requires more storage', staged);
      }
      processed += batch.length;
      await reportProgress({ phase: 'materializing', processed, total: null, state: 'running' });
    }
    let afterPosition = 0;
    let itemCount = 0;
    for (;;) {
      checkCancelled();
      const finalized = await this.repository.finalizePlaylistImportPage({
        playlistId,
        operationId,
        afterPosition,
        limit: MATERIALIZE_PAGE_ROWS
      });
      itemCount += finalized.keptCount;
      if (finalized.nextPosition === null) break;
      afterPosition = finalized.nextPosition;
    }
    await this.repository.transitionOperation(operationId, 'READY', { updatedAt: this.now() });
    checkCancelled();
    await this.repository.transitionOperation(operationId, 'COMMITTING', { updatedAt: this.now() });
    const published = await this.repository.publishPlaylist({
      playlistId,
      operationId,
      expectedVersion: 0,
      finishedAt: this.now(),
      result: { itemCount }
    });
    if (published.kind === 'conflict') {
      throw createServiceError('playlistVersionConflict', 'Playlist version changed before import publish', published);
    }
    return { playlistId, version: published.version, itemCount };
  }

  async handleSequencePlaylistSave({ operationId, request, reportProgress, checkCancelled }) {
    const playlistId = requirePlaylistTarget(request.target);
    if (request.expectedTargetVersion === null) {
      throw createServiceError('invalidTargetVersion', 'Playlist operations require an expected version');
    }
    requireBoundedString(request.options.saveId, 'saveId');
    const name = requirePlaylistName(request.options.name);
    const descriptor = normalizeSequenceSaveDescriptor(request.options.sourceSequenceDescriptor);
    const itemCount = descriptor.segments.reduce((count, segment) => count + segment.endOrdinal - segment.startOrdinal, 0);
    if (!Number.isSafeInteger(itemCount)) throw createServiceError('invalidRequest', 'Sequence item count is invalid');
    const prepared = await this.repository.prepareSequencePlaylistSave({
      playlistId,
      operationId,
      name,
      expectedVersion: request.expectedTargetVersion,
      itemCount,
      createdAt: this.now()
    });
    if (prepared.kind === 'conflict') {
      throw createServiceError('playlistVersionConflict', 'Playlist version changed before staging', prepared);
    }
    if (prepared.kind === 'busy') throw createServiceError('busy', 'Playlist is busy');
    if (prepared.kind === 'insufficientStorage') throw createServiceError('insufficientStorage', 'Playlist staging requires more storage', prepared);
    if (prepared.kind !== 'prepared') throw createServiceError('invalidRepositoryResult', 'Playlist staging admission failed');
    let processed = 0;
    while (processed < itemCount) {
      checkCancelled();
      const page = await this.repository.queryTransportDescriptorPage({
        descriptor, operationId, transportOrdinal: processed, limit: 500
      });
      if (!Array.isArray(page.items) || page.items.length === 0) {
        throw createServiceError('sequenceEntryNotFound', 'Playback sequence ended before its descriptor');
      }
      await this.repository.appendSequencePlaylistPage({
        playlistId,
        operationId,
        segmentIndex: 0,
        transportOrdinal: processed,
        items: page.items.map(item => ({ trackUid: item.trackUid }))
      });
      processed += page.items.length;
      await reportProgress({ phase: 'materializing', processed, total: itemCount, state: 'running' });
    }
    await this.repository.transitionOperation(operationId, 'READY', { updatedAt: this.now() });
    checkCancelled();
    await this.repository.transitionOperation(operationId, 'COMMITTING', { updatedAt: this.now() });
    const published = await this.repository.publishPlaylist({
      playlistId,
      operationId,
      expectedVersion: request.expectedTargetVersion,
      finishedAt: this.now()
    });
    if (published.kind === 'conflict') {
      throw createServiceError('playlistVersionConflict', 'Playlist version changed before publish', published);
    }
    return { playlistId, version: published.version, itemCount };
  }

  async materializeSelection({
    operationId,
    descriptor,
    reportProgress,
    checkCancelled,
    onFirstTrack = () => {}
  }) {
    const snapshotId = randomUUID();
    await this.repository.createOperationSnapshot({
      snapshotId,
      operationId,
      snapshotKind: 'operation-selection',
      createdAt: this.now(),
      expiresAt: this.now() + 24 * 60 * 60 * 1000
    });
    const orderDigest = createHash('sha256').update('operation-selection-order-v1\0');
    const membershipDigest = createHash('sha256').update('operation-selection-membership-v1\0');
    const selection = createSelectionMatcher(descriptor);
    const explicitTrackUids = descriptor.mode === 'explicit' ? descriptor.trackUids : null;
    let cursor = null;
    let itemCount = 0;
    let catalogVersion = null;
    let buffer = [];
    let firstTrackSeen = false;

    if (explicitTrackUids?.length > 0 && typeof this.repository.lookupContextTrack === 'function') {
      const firstTrack = await this.repository.lookupContextTrack({
        contextToken: descriptor.contextToken,
        trackUid: explicitTrackUids[0]
      });
      if (firstTrack) {
        firstTrackSeen = true;
        await onFirstTrack(firstTrack.trackUid, firstTrack.catalogVersion);
      }
    }

    do {
      checkCancelled();
      const page = await this.repository.readContextPage({
        contextToken: descriptor.contextToken,
        cursor,
        limit: MATERIALIZE_PAGE_ROWS
      });
      if (catalogVersion === null) catalogVersion = page.catalogVersion;
      for (const row of page.rows) {
        const decision = selection.accept(row.trackUid);
        if (decision.selected && explicitTrackUids === null) {
          if (!firstTrackSeen) {
            firstTrackSeen = true;
            await onFirstTrack(row.trackUid, page.catalogVersion);
          }
          appendUidDigest(orderDigest, row.trackUid);
          appendUidDigest(membershipDigest, row.trackUid);
          buffer.push(row.trackUid);
          itemCount += 1;
          if (buffer.length === MATERIALIZE_PAGE_ROWS) {
            await this.repository.appendOperationSnapshotItems({ snapshotId, trackUids: buffer });
            buffer = [];
          }
        }
        if (decision.done) break;
      }
      await reportProgress({
        phase: 'snapshotting',
        processed: itemCount,
        total: null,
        state: 'running'
      });
      if (selection.done) break;
      cursor = page.nextCursor;
    } while (cursor);

    checkCancelled();
    selection.assertComplete();
    if (explicitTrackUids !== null) {
      for (let offset = 0; offset < explicitTrackUids.length; offset += MATERIALIZE_PAGE_ROWS) {
        checkCancelled();
        const chunk = explicitTrackUids.slice(offset, offset + MATERIALIZE_PAGE_ROWS);
        for (const trackUid of chunk) {
          appendUidDigest(orderDigest, trackUid);
          appendUidDigest(membershipDigest, trackUid);
        }
        await this.repository.appendOperationSnapshotItems({ snapshotId, trackUids: chunk });
        itemCount += chunk.length;
        await reportProgress({
          phase: 'snapshotting',
          processed: itemCount,
          total: explicitTrackUids.length,
          state: 'running'
        });
      }
    }
    if (buffer.length > 0) {
      await this.repository.appendOperationSnapshotItems({ snapshotId, trackUids: buffer });
    }
    await this.repository.sealOperationSnapshot({
      snapshotId,
      itemCount,
      membershipDigest: `sha256:${membershipDigest.digest('hex')}`,
      orderDigest: `sha256:${orderDigest.digest('hex')}`,
      ownerKind: 'operation',
      ownerId: operationId
    });
    return { snapshotId, itemCount, catalogVersion: catalogVersion ?? 0 };
  }

  waitForProvisional(operationId) {
    let signal = this.provisionals.get(operationId);
    if (!signal) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      signal = { promise, resolve, settled: false, value: null };
      this.provisionals.set(operationId, signal);
      this.pruneProvisionals();
    }
    return signal.settled ? Promise.resolve(signal.value) : signal.promise;
  }

  resolveProvisional(operationId, value) {
    let signal = this.provisionals.get(operationId);
    if (!signal) {
      signal = { promise: Promise.resolve(value), resolve: null, settled: true, value };
      this.provisionals.set(operationId, signal);
      this.pruneProvisionals();
      return;
    }
    if (signal.settled) return;
    signal.settled = true;
    signal.value = value;
    signal.resolve(value);
    signal.resolve = null;
  }

  pruneProvisionals() {
    if (this.provisionals.size <= MAX_PROVISIONAL_ENTRIES) return;
    for (const [operationId, signal] of this.provisionals) {
      if (!signal.settled) continue;
      this.provisionals.delete(operationId);
      if (this.provisionals.size <= MAX_PROVISIONAL_ENTRIES) return;
    }
  }

  relayProgress(progress) {
    if (this.disposed) return;
    const now = this.now();
    let relay = this.progressRelays.get(progress.operationId);
    if (!relay) {
      relay = { lastSentAt: -Infinity, pending: null, timer: null };
      this.progressRelays.set(progress.operationId, relay);
    }
    if (now - relay.lastSentAt >= PROGRESS_RELAY_INTERVAL_MS) {
      relay.lastSentAt = now;
      this.emit('event', { kind: 'progress', progress });
      return;
    }
    relay.pending = progress;
    if (relay.timer) return;
    const delay = PROGRESS_RELAY_INTERVAL_MS - (now - relay.lastSentAt);
    relay.timer = setTimeout(() => {
      relay.timer = null;
      if (this.disposed || !relay.pending) return;
      const pending = relay.pending;
      relay.pending = null;
      relay.lastSentAt = this.now();
      this.emit('event', { kind: 'progress', progress: pending });
    }, delay);
  }

  relayTerminal(operationId, result) {
    if (this.disposed) return;
    const relay = this.progressRelays.get(operationId);
    if (relay?.timer) clearTimeout(relay.timer);
    this.progressRelays.delete(operationId);
    this.emit('event', { kind: 'terminal', operationId, result });
  }

  assertOpen() {
    if (this.disposed) throw createServiceError('serviceClosed', 'Library service is closed');
  }
}

function createObservableRepository(repository, { onProgress, onTerminal }) {
  return {
    receiveOperation: request => repository.receiveOperation(request),
    lookupOperationResult: clientRequestId => repository.lookupOperationResult(clientRequestId),
    getOperationStatus: operationId => repository.getOperationStatus(operationId),
    requestOperationCancel: (operationId, request) => repository.requestOperationCancel(operationId, request),
    transitionOperation: (operationId, phase, request) => repository.transitionOperation(operationId, phase, request),
    async recordOperationProgress(operationId, progress) {
      const receipt = await repository.recordOperationProgress(operationId, progress);
      if (receipt.kind === 'recorded') onProgress(progress);
      return receipt;
    },
    async completeOperation(operationId, result) {
      const receipt = await repository.completeOperation(operationId, result);
      if (receipt?.kind === 'terminal') onTerminal(operationId, receipt.result);
      return receipt;
    }
  };
}

function createSelectionMatcher(descriptor) {
  if (descriptor.mode === 'explicit') {
    const remaining = new Set(descriptor.trackUids);
    return {
      get done() { return remaining.size === 0; },
      accept(trackUid) {
        const selected = remaining.delete(trackUid);
        return { selected, done: remaining.size === 0 };
      },
      assertComplete() {
        if (remaining.size > 0) {
          throw createServiceError('selectionChanged', 'Explicit selection is not present in its catalog context');
        }
      }
    };
  }
  const exclusions = new Set(descriptor.exclusions);
  if (descriptor.mode === 'all') {
    return {
      done: false,
      accept(trackUid) { return { selected: !exclusions.has(trackUid), done: false }; },
      assertComplete() {}
    };
  }
  let started = false;
  let completed = false;
  const sameEndpoint = descriptor.startUid === descriptor.endUid;
  return {
    get done() { return completed; },
    accept(trackUid) {
      const endpoint = trackUid === descriptor.startUid || trackUid === descriptor.endUid;
      if (!started) {
        if (!endpoint) return { selected: false, done: false };
        started = true;
        if (sameEndpoint) completed = true;
        return { selected: !exclusions.has(trackUid), done: completed };
      }
      if (endpoint) completed = true;
      return { selected: !exclusions.has(trackUid), done: completed };
    },
    assertComplete() {
      if (!started || !completed) {
        throw createServiceError('selectionChanged', 'Range endpoints are not present in their catalog context');
      }
    }
  };
}

function appendUidDigest(hash, trackUid) {
  const bytes = Buffer.from(trackUid, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.length);
  hash.update(length);
  hash.update(bytes);
}

function normalizeOptionalSeed(seed) {
  if (seed === undefined || seed === null) return null;
  if (!Number.isSafeInteger(seed)) throw createServiceError('invalidOption', 'Playback seed must be an integer');
  return seed;
}

function requirePlaylistTarget(target) {
  if (!target || typeof target.playlistId !== 'string' || target.playlistId.length === 0 || target.playlistId.length > 512) {
    throw createServiceError('invalidTarget', 'Playlist target is invalid');
  }
  return target.playlistId;
}

function registerLibraryServiceIpc({ ipcMain, coordinator, getMainWindow }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw createServiceError('invalidIpcAdapter', 'Library service IPC adapter is invalid');
  }
  if (!coordinator || typeof coordinator.start !== 'function' || typeof getMainWindow !== 'function') {
    throw createServiceError('invalidIpcAdapter', 'Library service IPC dependencies are invalid');
  }
  const handlers = {
    start: (_event, request) => coordinator.start(request),
    lookupResult: (_event, request) => {
      assertExactRequest(request, ['clientRequestId']);
      return coordinator.lookupResult(request.clientRequestId);
    },
    status: (_event, request) => {
      assertExactRequest(request, ['operationId']);
      return coordinator.status(request.operationId);
    },
    cancel: (_event, request) => {
      assertExactRequest(request, ['operationId']);
      return coordinator.cancel(request.operationId);
    },
    getProvisionalEntry: (_event, request) => {
      assertExactRequest(request, ['operationId']);
      return coordinator.getProvisionalEntry(request.operationId);
    },
    commitTransportCommand: (_event, request) => coordinator.commitTransportCommand(request),
    getTransportState: (_event, request) => {
      assertExactRequest(request, []);
      return coordinator.getTransportState();
    },
    applyTransportUndo: (_event, request) => coordinator.applyTransportUndo(request),
    readSequencePage: (_event, request) => coordinator.readSequencePage(request),
    resolveSequenceEntrySource: (_event, request) => coordinator.resolveSequenceEntrySource(request)
  };
  const registered = [];
  try {
    for (const [method, channel] of Object.entries(LIBRARY_SERVICE_CHANNELS)) {
      ipcMain.handle(channel, (event, request) => {
        assertCurrentMainWindowSender(event, getMainWindow);
        assertBoundedMessage(request);
        return handlers[method](event, request);
      });
      registered.push(channel);
    }
    for (const [method, channel] of Object.entries(LIBRARY_PLAYBACK_CHANNELS)) {
      ipcMain.handle(channel, (event, request) => {
        assertCurrentMainWindowSender(event, getMainWindow);
        assertBoundedMessage(request);
        return handlers[method](event, request);
      });
      registered.push(channel);
    }
  } catch (error) {
    for (const channel of registered) ipcMain.removeHandler(channel);
    throw error;
  }

  const relay = event => {
    const mainWindow = getMainWindow();
    if (!isUsableMainWindow(mainWindow)) return;
    mainWindow.webContents.send(LIBRARY_SERVICE_EVENT_CHANNEL, event);
  };
  coordinator.on('event', relay);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    coordinator.removeListener('event', relay);
    for (const channel of registered) ipcMain.removeHandler(channel);
  };
}

function assertCurrentMainWindowSender(event, getMainWindow) {
  const mainWindow = getMainWindow();
  if (!isUsableMainWindow(mainWindow) || !event || event.sender !== mainWindow.webContents) {
    throw createServiceError('unauthorizedLibraryServiceSender', 'Library service sender is not authorized');
  }
}

function isUsableMainWindow(mainWindow) {
  return Boolean(
    mainWindow &&
    typeof mainWindow.isDestroyed === 'function' &&
    !mainWindow.isDestroyed() &&
    mainWindow.webContents &&
    (typeof mainWindow.webContents.isDestroyed !== 'function' || !mainWindow.webContents.isDestroyed())
  );
}

function assertExactRequest(request, fields) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw createServiceError('invalidRequest', 'Library service request must be an object');
  }
  const actual = Object.keys(request).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw createServiceError('invalidRequest', 'Library service request fields are invalid');
  }
}

function assertBoundedMessage(value) {
  let json;
  try {
    json = JSON.stringify(value);
  } catch {
    throw createServiceError('invalidRequest', 'Library service request is not serializable');
  }
  if (json === undefined || Buffer.byteLength(json, 'utf8') > MAX_IPC_REQUEST_BYTES) {
    throw createServiceError('requestTooLarge', 'Library service request exceeds the byte limit');
  }
}

function requireBoundedString(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512) {
    throw createServiceError('invalidRequest', `${field} must be a bounded string`);
  }
  return value;
}

function requireBoundedOrdinal(value, field) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 1_000_000) {
    throw createServiceError('invalidRequest', `${field} must be a bounded non-negative integer`);
  }
  return value;
}

function requirePlaybackPageLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw createServiceError('invalidRequest', 'limit must be an integer from 1 to 500');
  }
  return value;
}

function requirePlaylistName(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) {
    throw createServiceError('invalidRequest', 'name must be a bounded string');
  }
  return value;
}

function requireNonNegativeSafeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createServiceError('invalidRequest', `${field} must be a non-negative safe integer`);
  }
  return value;
}

function normalizeSequenceSaveDescriptor(value) {
  if (!value || !Array.isArray(value.segments) || value.segments.length < 1 || value.segments.length > 256) {
    throw createServiceError('invalidRequest', 'Playback sequence descriptor is invalid');
  }
  const descriptor = {
    segments: value.segments.map(segment => {
      const normalized = {
        sequenceId: requireBoundedString(segment?.sequenceId, 'sequenceId'),
        startOrdinal: requireNonNegativeSafeInteger(segment?.startOrdinal, 'startOrdinal'),
        endOrdinal: requireNonNegativeSafeInteger(segment?.endOrdinal, 'endOrdinal')
      };
      if (normalized.endOrdinal <= normalized.startOrdinal) {
        throw createServiceError('invalidRequest', 'Playback sequence segment range is invalid');
      }
      if (segment.shuffleSeed != null || segment.shuffleEpoch != null || segment.shuffleTransportOffset != null) {
        normalized.shuffleSeed = requireSafeInteger(segment.shuffleSeed, 'shuffleSeed');
        normalized.shuffleEpoch = requireSafeInteger(segment.shuffleEpoch, 'shuffleEpoch');
        normalized.shuffleTransportOffset = requireNonNegativeSafeInteger(segment.shuffleTransportOffset, 'shuffleTransportOffset');
      }
      return normalized;
    })
  };
  if (value.shuffleSeed != null || value.shuffleEpoch != null || value.shuffleTransportOffset != null) {
    descriptor.shuffleSeed = requireSafeInteger(value.shuffleSeed, 'shuffleSeed');
    descriptor.shuffleEpoch = requireSafeInteger(value.shuffleEpoch, 'shuffleEpoch');
    descriptor.shuffleTransportOffset = requireNonNegativeSafeInteger(value.shuffleTransportOffset, 'shuffleTransportOffset');
  }
  return descriptor;
}

function requireSafeInteger(value, field) {
  if (!Number.isSafeInteger(value)) throw createServiceError('invalidRequest', `${field} must be a safe integer`);
  return value;
}

function createServiceError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'LibraryServiceError';
  error.code = code;
  error.details = details;
  return error;
}

module.exports = {
  LIBRARY_SERVICE_API_VERSION,
  LIBRARY_SERVICE_CHANNELS,
  LIBRARY_SERVICE_EVENT_CHANNEL,
  LIBRARY_PLAYBACK_CHANNELS,
  LibraryServiceCoordinator,
  registerLibraryServiceIpc
};
