import { DurableLibraryService } from './durable-library-service.js';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';
import { WebFileSystemScanAdapter, queryFolderPermission } from '../scan/web-file-system-adapter.js';
import { parsePlaylistStream } from '../playlists/playlist-stream.js';

const SUPPORTED_OPERATION_KINDS = new Set(['play', 'playNext', 'queue', 'addToPlaylist', 'importPlaylist']);
const PAGE_ROWS = 500;
const PROGRESS_INTERVAL_MS = 250;
const PLAYBACK_DESTINATIONS = Object.freeze({
  play: 'replace',
  playNext: 'after-current',
  queue: 'append'
});

export class WebLibraryServiceCoordinator {
  constructor({ repository, handleStore = null, cryptoApi = globalThis.crypto, now = () => Date.now(), idFactory = defaultId, onEvent = () => {} } = {}) {
    assertRepositoryContract(repository && typeof repository.queryTracks === 'function', 'invalidRepository', 'Web LibraryService repository is invalid');
    this.repository = repository;
    this.handleStore = handleStore;
    this.now = now;
    this.idFactory = idFactory;
    this.onEvent = onEvent;
    this.provisionals = new Map();
    this.progressRelays = new Map();
    this.service = new DurableLibraryService({
      repository: createObservableRepository(repository, {
        onProgress: progress => this.#relayProgress(progress),
        onTerminal: (operationId, result) => this.#relayTerminal(operationId, result)
      }),
      cryptoApi,
      now,
      handlers: {
        play: context => this.#handlePlayback(context),
        playNext: context => this.#handlePlayback(context),
        queue: context => this.#handlePlayback(context),
        addToPlaylist: context => this.#handleAddToPlaylist(context),
        importPlaylist: context => this.#handlePlaylistImport(context)
      }
    });
  }

  async start(request) {
    assertRepositoryContract(SUPPORTED_OPERATION_KINDS.has(request?.operationKind), 'invalidOperationKind', 'Operation kind is not supported by the Web service');
    return this.service.start(request);
  }

  lookupResult(clientRequestId) { return this.service.lookupResult(clientRequestId); }
  status(operationId) { return this.service.status(operationId); }
  cancel(operationId) { return this.service.cancel(operationId); }
  getProvisionalEntry(operationId) { return this.#waitForProvisional(operationId); }
  commitTransportCommand(request = {}) {
    return this.repository.commitTransportState({
      expectedTransportVersion: request.expectedTransportVersion,
      descriptor: request.descriptor,
      updatedAt: this.now()
    });
  }
  getTransportState() { return this.repository.getTransportState(); }
  applyTransportUndo(request = {}) {
    return this.repository.applyTransportUndo({
      undoId: request.undoId,
      expectedTransportVersion: request.expectedTransportVersion,
      appliedAt: this.now()
    });
  }

  readSequencePage(request) {
    return this.repository.queryPlaybackSequence(request);
  }

  async resolveSequenceEntrySource({ sequenceId = null, ordinal = null, entryInstanceId = null, trackUid = null } = {}) {
    assertRepositoryContract(this.handleStore, 'sourceUnavailable', 'Web folder handle store is unavailable');
    let entry = null;
    if (sequenceId != null) {
      const page = await this.repository.queryPlaybackSequence({ sequenceId, ordinal, limit: 1 });
      entry = page.items[0];
      assertRepositoryContract(entry?.ordinal === ordinal, 'sequenceEntryNotFound', 'Playback sequence entry does not exist');
      if (entryInstanceId != null) {
        assertRepositoryContract(entry.entryInstanceId === entryInstanceId, 'staleSequenceEntry', 'Playback sequence entry changed');
      }
      trackUid = entry.trackUid;
    }
    assertRepositoryContract(typeof trackUid === 'string' && trackUid.length > 0, 'trackNotFound', 'Playback track does not exist');
    const track = await this.repository.getTrackStorageIdentity(trackUid);
    assertRepositoryContract(track, 'trackNotFound', 'Playback track does not exist');
    const handle = await this.handleStore.get(track.folderId);
    if (!handle || await queryFolderPermission(handle) !== 'granted') {
      await this.repository.setFolderAvailability({ folderId: track.folderId, status: 'needs-permission' });
      throw createRepositoryError(
        'folderPermissionRequired',
        'Playback folder access must be restored',
        { folderId: track.folderId }
      );
    }
    let file;
    try {
      file = await new WebFileSystemScanAdapter({ rootHandle: handle }).getFile(track.relativePath);
    } catch (error) {
      if (error?.code !== 'temporary-permission') throw error;
      await this.repository.setFolderAvailability({ folderId: track.folderId, status: 'needs-permission' });
      throw createRepositoryError(
        'folderPermissionRequired',
        'Playback folder access must be restored',
        { folderId: track.folderId }
      );
    }
    return {
      kind: 'file',
      sequenceId,
      ordinal,
      entryInstanceId: entry?.entryInstanceId ?? entryInstanceId,
      trackUid,
      file
    };
  }

  close() {
    for (const relay of this.progressRelays.values()) if (relay.timer) clearTimeout(relay.timer);
    this.progressRelays.clear();
    this.provisionals.clear();
  }

  async #handlePlayback({ operationId, request, reportProgress, checkCancelled }) {
    let firstEntry = null;
    const snapshot = await this.#materializeSelection({
      operationId,
      descriptor: request.selectionDescriptor,
      reportProgress,
      checkCancelled,
      onFirstTrack: async (trackUid, catalogVersion) => {
        const entry = { ordinal: 0, entryInstanceId: this.idFactory(), trackUid };
        if (request.operationKind === 'play') {
          assertRepositoryContract(
            typeof this.repository.publishProvisionalTransport === 'function',
            'transportAuthorityUnavailable',
            'Durable provisional playback transport is unavailable'
          );
          const published = await this.repository.publishProvisionalTransport({
            operationId,
            sourceContext: request.selectionDescriptor.contextToken,
            catalogVersion,
            expectedTransportVersion: request.expectedTargetVersion,
            firstEntry: entry,
            publishedAt: this.now()
          });
          if (published.kind === 'conflict') {
            throw createRepositoryError(
              'transportVersionConflict',
              'Transport version changed before provisional Play',
              published
            );
          }
          Object.assign(entry, {
            transportVersion: published.transportVersion,
            transportDescriptor: published.descriptor,
            undoId: published.undoId,
            undoExpiresAt: published.undoExpiresAt
          });
        }
        firstEntry = Object.freeze(entry);
        if (request.operationKind === 'play') this.#resolveProvisional(operationId, firstEntry);
      }
    });
    if (!firstEntry) {
      this.#resolveProvisional(operationId, null);
      throw createRepositoryError('emptySelection', 'The selected operation contains no tracks');
    }
    const sequenceId = this.idFactory();
    await this.repository.createPlaybackSequence({
      sequenceId,
      operationId,
      sourceContext: request.selectionDescriptor.contextToken,
      catalogVersion: snapshot.catalogVersion,
      seed: request.options.seed ?? null,
      snapshotId: null,
      createdAt: this.now()
    });
    let ordinal = 0;
    while (ordinal < snapshot.itemCount) {
      checkCancelled();
      const page = await this.repository.queryOperationSnapshot({ snapshotId: snapshot.snapshotId, ordinal, limit: PAGE_ROWS });
      const items = page.items.map(item => ({
        trackUid: item.trackUid,
        entryInstanceId: request.operationKind !== 'play' && item.ordinal === 0
          ? firstEntry.entryInstanceId
          : this.idFactory()
      }));
      await this.repository.appendPlaybackSequenceItems({ sequenceId, items });
      ordinal += items.length;
      await reportProgress({ phase: 'materializing', processed: snapshot.itemCount + ordinal, total: snapshot.itemCount * 2, state: 'running' });
    }
    await this.repository.sealPlaybackSequence({ sequenceId, itemCount: snapshot.itemCount, currentOrdinal: 0, sealedAt: this.now() });
    await this.repository.transitionOperation(operationId, 'READY', { updatedAt: this.now() });
    checkCancelled();
    await this.repository.transitionOperation(operationId, 'COMMITTING', { updatedAt: this.now() });
    const destination = PLAYBACK_DESTINATIONS[request.operationKind];
    const requestedDestination = request.options?.playbackDestination;
    assertRepositoryContract(
      requestedDestination == null || requestedDestination === destination,
      'invalidPlaybackDestination',
      'Playback destination does not match the operation kind'
    );
    const published = await this.repository.publishTransportSequence({
      sequenceId,
      operationId,
      operationKind: request.operationKind,
      expectedTransportVersion: request.expectedTargetVersion,
      currentOrdinal: request.options.currentOrdinal ?? 0,
      finishedAt: this.now(),
      result: {
        operationKind: request.operationKind,
        destination,
        sequenceId,
        itemCount: snapshot.itemCount,
        firstOrdinal: 0,
        firstEntry,
        shuffleSeed: request.options.seed ?? 0,
        expectedTransportVersion: request.expectedTargetVersion,
        publishToken: { operationId, expectedTransportVersion: request.expectedTargetVersion }
      }
    });
    if (published.kind === 'conflict') throw createRepositoryError('transportVersionConflict', 'Transport version changed before publish', published);
    return published.result ?? published;
  }

  async #handleAddToPlaylist({ operationId, request, reportProgress, checkCancelled }) {
    if (request.options?.sourceSequenceDescriptor) {
      return this.#handleSequencePlaylistSave({ operationId, request, reportProgress, checkCancelled });
    }
    const playlistId = request.target?.playlistId;
    assertRepositoryContract(typeof playlistId === 'string' && playlistId.length > 0, 'invalidTarget', 'Playlist target is invalid');
    assertRepositoryContract(request.expectedTargetVersion != null, 'invalidTargetVersion', 'Playlist operation requires an expected version');
    const snapshot = await this.#materializeSelection({
      operationId,
      descriptor: request.selectionDescriptor,
      reportProgress,
      checkCancelled
    });
    let ordinal = 0;
    while (ordinal < snapshot.itemCount) {
      checkCancelled();
      const page = await this.repository.queryOperationSnapshot({ snapshotId: snapshot.snapshotId, ordinal, limit: PAGE_ROWS });
      const appended = await this.repository.appendPlaylistItems({
        playlistId,
        operationId,
        items: page.items.map(item => ({ trackUid: item.trackUid }))
      });
      if (appended.kind === 'busy') throw createRepositoryError('busy', 'Playlist is busy');
      ordinal += page.items.length;
      await reportProgress({ phase: 'materializing', processed: snapshot.itemCount + ordinal, total: snapshot.itemCount * 2, state: 'running' });
    }
    await this.repository.transitionOperation(operationId, 'READY', { updatedAt: this.now() });
    checkCancelled();
    await this.repository.transitionOperation(operationId, 'COMMITTING', { updatedAt: this.now() });
    const published = await this.repository.publishPlaylist({
      playlistId,
      operationId,
      expectedVersion: request.expectedTargetVersion,
      finishedAt: this.now(),
      result: { itemCount: snapshot.itemCount }
    });
    if (published.kind === 'conflict') throw createRepositoryError('playlistVersionConflict', 'Playlist version changed before publish', published);
    return { playlistId, version: published.version, itemCount: snapshot.itemCount };
  }

  async #handleSequencePlaylistSave({ operationId, request, reportProgress, checkCancelled }) {
    const playlistId = request.target?.playlistId;
    assertRepositoryContract(typeof playlistId === 'string' && playlistId.length > 0, 'invalidTarget', 'Playlist target is invalid');
    assertRepositoryContract(request.expectedTargetVersion != null, 'invalidTargetVersion', 'Playlist operation requires an expected version');
    boundedSaveString(request.options.saveId, 'saveId');
    const name = boundedSaveString(request.options.name, 'name', 4096);
    const descriptor = normalizeSequenceSaveDescriptor(request.options.sourceSequenceDescriptor);
    const itemCount = descriptor.segments.reduce((count, segment) => count + segment.endOrdinal - segment.startOrdinal, 0);
    assertRepositoryContract(Number.isSafeInteger(itemCount), 'invalidRequest', 'Sequence item count is invalid');
    const prepared = await this.repository.prepareSequencePlaylistSave({
      playlistId,
      operationId,
      name,
      expectedVersion: request.expectedTargetVersion,
      itemCount,
      createdAt: this.now()
    });
    if (prepared.kind === 'conflict') throw createRepositoryError('playlistVersionConflict', 'Playlist version changed before staging', prepared);
    if (prepared.kind === 'busy') throw createRepositoryError('busy', 'Playlist is busy');
    if (prepared.kind === 'insufficientStorage') throw createRepositoryError('insufficientStorage', 'Playlist staging requires more storage', prepared);
    assertRepositoryContract(prepared.kind === 'prepared', 'invalidRepositoryResult', 'Playlist staging admission failed');
    let processed = 0;
    while (processed < itemCount) {
      checkCancelled();
      const page = await this.repository.queryTransportDescriptorPage({
        descriptor, operationId, transportOrdinal: processed, limit: 500
      });
      assertRepositoryContract(Array.isArray(page.items) && page.items.length > 0, 'sequenceEntryNotFound', 'Playback sequence ended before its descriptor');
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
      finishedAt: this.now(),
      result: { itemCount }
    });
    if (published.kind === 'conflict') throw createRepositoryError('playlistVersionConflict', 'Playlist version changed before publish', published);
    return { playlistId, version: published.version, itemCount };
  }

  async #handlePlaylistImport({ operationId, request, runtime, reportProgress, checkCancelled }) {
    const playlistId = request.target?.playlistId;
    assertRepositoryContract(typeof playlistId === 'string' && playlistId.length > 0, 'invalidTarget', 'Playlist target is invalid');
    assertRepositoryContract(request.expectedTargetVersion === 0, 'invalidTargetVersion', 'Playlist import requires a new playlist target');
    const source = runtime?.source;
    assertRepositoryContract(source && typeof source.stream === 'function', 'playlistSourceUnavailable', 'Playlist import source is unavailable');
    const name = boundedSaveString(request.options.name, 'name', 4096);
    await this.repository.createPlaylist({
      playlistId,
      name,
      operationId,
      createdAt: this.now()
    });
    const sourceFactory = () => readableStreamChunks(source.stream());
    let batch = [];
    let processed = 0;
    for await (const record of parsePlaylistStream(sourceFactory, {
      fileName: request.options.source.name,
      encoding: request.options.encoding ?? undefined,
      limits: request.options.limits ?? undefined
    })) {
      checkCancelled();
      batch.push(record);
      if (batch.length < PAGE_ROWS) continue;
      const staged = await this.repository.appendPlaylistImportRecords({ playlistId, operationId, records: batch });
      if (staged.kind === 'insufficientStorage') throw createRepositoryError('insufficientStorage', 'Playlist import requires more storage', staged);
      processed += batch.length;
      batch = [];
      await reportProgress({ phase: 'materializing', processed, total: null, state: 'running' });
    }
    if (batch.length) {
      const staged = await this.repository.appendPlaylistImportRecords({ playlistId, operationId, records: batch });
      if (staged.kind === 'insufficientStorage') throw createRepositoryError('insufficientStorage', 'Playlist import requires more storage', staged);
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
        limit: PAGE_ROWS
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
    if (published.kind === 'conflict') throw createRepositoryError('playlistVersionConflict', 'Playlist version changed before import publish', published);
    return { playlistId, version: published.version, itemCount };
  }

  async #materializeSelection({ operationId, descriptor, reportProgress, checkCancelled, onFirstTrack = () => {} }) {
    const snapshotId = this.idFactory();
    await this.repository.createOperationSnapshot({
      snapshotId,
      operationId,
      snapshotKind: 'operation-selection',
      createdAt: this.now(),
      expiresAt: this.now() + 24 * 60 * 60 * 1000
    });
    const matcher = createSelectionMatcher(descriptor);
    const explicitTrackUids = descriptor.mode === 'explicit' ? descriptor.trackUids : null;
    const orderDigest = new IncrementalDigest('order');
    const membershipDigest = new IncrementalDigest('membership');
    let cursor = null;
    let itemCount = 0;
    let catalogVersion = null;
    let buffer = [];
    let first = true;
    if (explicitTrackUids?.length > 0 && typeof this.repository.lookupContextTrack === 'function') {
      const firstTrack = await this.repository.lookupContextTrack({
        contextToken: descriptor.contextToken,
        trackUid: explicitTrackUids[0]
      });
      if (firstTrack) {
        first = false;
        await onFirstTrack(firstTrack.trackUid, firstTrack.catalogVersion);
      }
    }
    do {
      checkCancelled();
      const page = await this.repository.queryTracks({ contextToken: descriptor.contextToken, cursor, limit: PAGE_ROWS });
      catalogVersion ??= page.catalogVersion;
      for (const row of page.rows) {
        const decision = matcher.accept(row.trackUid);
        if (decision.selected && explicitTrackUids === null) {
          if (first) {
            first = false;
            await onFirstTrack(row.trackUid, page.catalogVersion);
          }
          orderDigest.add(row.trackUid);
          membershipDigest.add(row.trackUid);
          buffer.push(row.trackUid);
          itemCount += 1;
          if (buffer.length === PAGE_ROWS) {
            await this.repository.appendOperationSnapshotItems({ snapshotId, trackUids: buffer });
            buffer = [];
          }
        }
        if (decision.done) break;
      }
      await reportProgress({ phase: 'snapshotting', processed: itemCount, total: null, state: 'running' });
      if (matcher.done) break;
      cursor = page.nextCursor;
    } while (cursor);
    checkCancelled();
    matcher.assertComplete();
    if (explicitTrackUids !== null) {
      for (let offset = 0; offset < explicitTrackUids.length; offset += PAGE_ROWS) {
        checkCancelled();
        const chunk = explicitTrackUids.slice(offset, offset + PAGE_ROWS);
        for (const trackUid of chunk) {
          orderDigest.add(trackUid);
          membershipDigest.add(trackUid);
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
    if (buffer.length) await this.repository.appendOperationSnapshotItems({ snapshotId, trackUids: buffer });
    await this.repository.sealOperationSnapshot({
      snapshotId,
      itemCount,
      membershipDigest: membershipDigest.value(),
      orderDigest: orderDigest.value(),
      ownerKind: 'operation',
      ownerId: operationId
    });
    return { snapshotId, itemCount, catalogVersion: catalogVersion ?? 0 };
  }

  #waitForProvisional(operationId) {
    let signal = this.provisionals.get(operationId);
    if (!signal) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      signal = { promise, resolve, settled: false, value: null };
      this.provisionals.set(operationId, signal);
    }
    return signal.settled ? Promise.resolve(signal.value) : signal.promise;
  }

  #resolveProvisional(operationId, value) {
    const signal = this.provisionals.get(operationId);
    if (!signal) {
      this.provisionals.set(operationId, { promise: Promise.resolve(value), resolve: null, settled: true, value });
      return;
    }
    if (signal.settled) return;
    signal.settled = true;
    signal.value = value;
    signal.resolve(value);
  }

  #relayProgress(progress) {
    const now = this.now();
    let relay = this.progressRelays.get(progress.operationId);
    if (!relay) {
      relay = { lastSentAt: Number.NEGATIVE_INFINITY, pending: null, timer: null };
      this.progressRelays.set(progress.operationId, relay);
    }
    if (now - relay.lastSentAt >= PROGRESS_INTERVAL_MS) {
      relay.lastSentAt = now;
      this.onEvent({ kind: 'progress', progress });
      return;
    }
    relay.pending = progress;
    if (relay.timer) return;
    relay.timer = setTimeout(() => {
      relay.timer = null;
      if (!relay.pending) return;
      const pending = relay.pending;
      relay.pending = null;
      relay.lastSentAt = this.now();
      this.onEvent({ kind: 'progress', progress: pending });
    }, Math.max(0, PROGRESS_INTERVAL_MS - (now - relay.lastSentAt)));
  }

  #relayTerminal(operationId, result) {
    this.#resolveProvisional(operationId, null);
    const relay = this.progressRelays.get(operationId);
    if (relay?.timer) clearTimeout(relay.timer);
    this.progressRelays.delete(operationId);
    this.onEvent({ kind: 'terminal', operationId, result });
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
      if (receipt.kind === 'terminal') onTerminal(operationId, receipt.result);
      return receipt;
    }
  };
}

function createSelectionMatcher(descriptor) {
  if (descriptor.mode === 'explicit') {
    const remaining = new Set(descriptor.trackUids);
    return {
      get done() { return remaining.size === 0; },
      accept(trackUid) { const selected = remaining.delete(trackUid); return { selected, done: remaining.size === 0 }; },
      assertComplete() { assertRepositoryContract(remaining.size === 0, 'selectionChanged', 'Explicit selection changed'); }
    };
  }
  const exclusions = new Set(descriptor.exclusions);
  if (descriptor.mode === 'all') {
    return { done: false, accept: trackUid => ({ selected: !exclusions.has(trackUid), done: false }), assertComplete() {} };
  }
  let started = false;
  let completed = false;
  const same = descriptor.startUid === descriptor.endUid;
  return {
    get done() { return completed; },
    accept(trackUid) {
      const endpoint = trackUid === descriptor.startUid || trackUid === descriptor.endUid;
      if (!started) {
        if (!endpoint) return { selected: false, done: false };
        started = true;
        completed = same;
        return { selected: !exclusions.has(trackUid), done: completed };
      }
      if (endpoint) completed = true;
      return { selected: !exclusions.has(trackUid), done: completed };
    },
    assertComplete() { assertRepositoryContract(started && completed, 'selectionChanged', 'Range selection changed'); }
  };
}

class IncrementalDigest {
  constructor(kind) {
    this.kind = kind;
    this.hash = 0x811c9dc5;
    this.count = 0;
  }

  add(value) {
    for (const byte of new TextEncoder().encode(String(value))) {
      this.hash = Math.imul(this.hash ^ byte, 0x01000193) >>> 0;
    }
    this.hash = Math.imul(this.hash ^ 0, 0x01000193) >>> 0;
    this.count += 1;
  }

  value() { return `web-${this.kind}-v1:${this.count}:${this.hash.toString(16).padStart(8, '0')}`; }
}

function defaultId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw createRepositoryError('cryptoUnavailable', 'Secure operation IDs are unavailable');
  return globalThis.crypto.randomUUID();
}

async function* readableStreamChunks(stream) {
  if (stream?.[Symbol.asyncIterator]) {
    yield* stream;
    return;
  }
  const reader = stream?.getReader?.();
  assertRepositoryContract(reader, 'playlistSourceUnavailable', 'Playlist source does not provide a readable stream');
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      yield next.value;
    }
  } finally {
    reader.releaseLock?.();
  }
}

function boundedSaveString(value, field, maximum = 512) {
  assertRepositoryContract(typeof value === 'string' && value.length > 0 && value.length <= maximum, 'invalidRequest', `${field} must be a bounded string`);
  return value;
}

function nonNegativeSaveInteger(value, field) {
  assertRepositoryContract(Number.isSafeInteger(value) && value >= 0, 'invalidRequest', `${field} must be a non-negative safe integer`);
  return value;
}

function normalizeSequenceSaveDescriptor(value) {
  assertRepositoryContract(value && Array.isArray(value.segments) && value.segments.length >= 1 && value.segments.length <= 256, 'invalidRequest', 'Playback sequence descriptor is invalid');
  const descriptor = {
    segments: value.segments.map(segment => {
      const normalized = {
        sequenceId: boundedSaveString(segment?.sequenceId, 'sequenceId'),
        startOrdinal: nonNegativeSaveInteger(segment?.startOrdinal, 'startOrdinal'),
        endOrdinal: nonNegativeSaveInteger(segment?.endOrdinal, 'endOrdinal')
      };
      assertRepositoryContract(normalized.endOrdinal > normalized.startOrdinal, 'invalidRequest', 'Playback sequence segment range is invalid');
      if (segment.shuffleSeed != null || segment.shuffleEpoch != null || segment.shuffleTransportOffset != null) {
        normalized.shuffleSeed = signedSaveInteger(segment.shuffleSeed, 'shuffleSeed');
        normalized.shuffleEpoch = signedSaveInteger(segment.shuffleEpoch, 'shuffleEpoch');
        normalized.shuffleTransportOffset = nonNegativeSaveInteger(segment.shuffleTransportOffset, 'shuffleTransportOffset');
      }
      return normalized;
    })
  };
  appendNormalizedDescriptorShuffle(descriptor, value);
  return descriptor;
}

function signedSaveInteger(value, field) {
  assertRepositoryContract(Number.isSafeInteger(value), 'invalidRequest', `${field} must be a safe integer`);
  return value;
}

function appendNormalizedDescriptorShuffle(target, value) {
  if (value.shuffleSeed == null && value.shuffleEpoch == null && value.shuffleTransportOffset == null) return;
  target.shuffleSeed = signedSaveInteger(value.shuffleSeed, 'shuffleSeed');
  target.shuffleEpoch = signedSaveInteger(value.shuffleEpoch, 'shuffleEpoch');
  target.shuffleTransportOffset = nonNegativeSaveInteger(value.shuffleTransportOffset, 'shuffleTransportOffset');
}
