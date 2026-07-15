'use strict';

const { createHash, randomUUID, webcrypto } = require('node:crypto');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const LIBRARY_SERVICE_API_VERSION = 1;
const LIBRARY_SERVICE_EVENT_CHANNEL = 'library-service-v1:event';
const LIBRARY_SERVICE_CHANNELS = Object.freeze({
  start: 'library-service-v1:start',
  status: 'library-service-v1:status',
  cancel: 'library-service-v1:cancel',
  previewPlaylistImport: 'library-service-v1:preview-playlist-import',
  commitPlaylistImportPreview: 'library-service-v1:commit-playlist-import-preview',
  cancelPlaylistImportPreview: 'library-service-v1:cancel-playlist-import-preview'
});
const LIBRARY_PLAYBACK_CHANNELS = Object.freeze({
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
const PLAYLIST_IMPORT_PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PLAYLIST_IMPORT_PREVIEWS = 4;
const PLAYLIST_PARSER_LIMIT_MAXIMA = Object.freeze({
  maxInputChunkBytes: 256 * 1024,
  maxLineChars: 1024 * 1024,
  maxXmlTokenChars: 64 * 1024,
  maxXmlValueChars: 1024 * 1024,
  maxOutputChunkChars: 64 * 1024
});

class LibraryServiceCoordinator extends EventEmitter {
  constructor({
    repository,
    DurableLibraryService,
    validateBulkOperationStart,
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
    if (typeof validateBulkOperationStart !== 'function') {
      throw createServiceError('invalidRequestValidator', 'Library service request validator is unavailable');
    }
    this.validateBulkOperationStart = validateBulkOperationStart;
    this.parsePlaylistStream = parsePlaylistStream;
    this.importSourceProvider = importSourceProvider;
    this.now = now;
    this.provisionals = new Map();
    this.playbackOperations = new Map();
    this.progressRelays = new Map();
    this.playlistImportPreviews = new Map();
    this.automaticImportAuthorizations = new Map();
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
    const protocolPath = path.join(
      __dirname,
      '..',
      'js',
      'library',
      'operations',
      'bulk-operation-protocol.js'
    );
    const [
      { DurableLibraryService },
      { parsePlaylistStream },
      { validateBulkOperationStart }
    ] = await Promise.all([
      import(pathToFileURL(servicePath).href),
      import(pathToFileURL(playlistStreamPath).href),
      import(pathToFileURL(protocolPath).href)
    ]);
    return new LibraryServiceCoordinator({
      ...options,
      DurableLibraryService,
      parsePlaylistStream,
      validateBulkOperationStart
    });
  }

  async start(request) {
    this.assertOpen();
    assertBoundedMessage(request);
    if (!request || !SUPPORTED_OPERATION_KINDS.has(request.operationKind)) {
      throw createServiceError('invalidOperationKind', 'Operation kind is not supported by the desktop service');
    }
    if (PLAYBACK_OPERATION_KINDS.has(request.operationKind)) {
      return this.startPlaybackOperation(this.validateBulkOperationStart(request));
    }
    return this.service.start(request);
  }

  startPlaybackOperation(request) {
    const operationId = randomUUID();
    const createdAt = this.now();
    const operation = {
      operationId,
      operationKind: request.operationKind,
      phase: 'RECEIVED',
      committed: false,
      processed: 0,
      total: null,
      createdAt,
      updatedAt: createdAt,
      finishedAt: null,
      terminalKind: null,
      terminalCode: null,
      progress: null,
      result: null,
      sequence: 0,
      controller: new AbortController(),
      task: null
    };
    this.playbackOperations.set(operationId, operation);
    operation.task = this.runPlaybackOperation(operation, request);
    return { kind: 'started', operationId };
  }

  async runPlaybackOperation(operation, request) {
    const checkCancelled = () => {
      if (operation.controller.signal.aborted) {
        throw createServiceError('cancelled', 'Operation cancelled');
      }
    };
    const reportProgress = async progress => {
      operation.sequence += 1;
      operation.phase = String(progress.phase).toUpperCase();
      operation.processed = progress.processed;
      operation.total = progress.total ?? null;
      operation.updatedAt = this.now();
      operation.progress = {
        operationId: operation.operationId,
        sequence: operation.sequence,
        phase: progress.phase,
        processed: progress.processed,
        total: progress.total ?? null,
        state: progress.state ?? 'running',
        updatedAt: operation.updatedAt
      };
      this.relayProgress(operation.progress);
    };
    let terminal;
    try {
      const contextToken = request.selectionDescriptor.contextToken;
      await this.repository.retainContext(contextToken);
      operation.phase = 'SNAPSHOTTING';
      operation.updatedAt = this.now();
      try {
        const outcome = await this.handlePlaybackOperation({
          operationId: operation.operationId,
          request,
          reportProgress,
          checkCancelled
        });
        checkCancelled();
        terminal = { state: 'succeeded', result: outcome, finishedAt: this.now() };
      } finally {
        await this.repository.releaseRetainedContext(contextToken);
      }
    } catch (error) {
      const cancelled = operation.controller.signal.aborted || error?.code === 'cancelled';
      terminal = {
        state: cancelled ? 'cancelled' : 'failed',
        code: cancelled ? 'cancelled' : (error?.code || 'operationFailed'),
        finishedAt: this.now()
      };
    }
    operation.phase = terminal.state.toUpperCase();
    operation.updatedAt = terminal.finishedAt;
    operation.finishedAt = terminal.finishedAt;
    operation.terminalKind = terminal.state;
    operation.terminalCode = terminal.code ?? null;
    operation.result = terminal;
    if (!this.disposed) {
      this.resolveProvisional(operation.operationId, null);
      this.relayTerminal(operation.operationId, terminal);
      this.prunePlaybackOperations();
    }
  }

  getAutomaticPlaylistImportState(request) {
    this.assertOpen();
    return this.repository.getAutomaticPlaylistImportState(request);
  }

  async startAutomaticPlaylistImport(request) {
    this.assertOpen();
    const source = request?.options?.automaticSource;
    if (!source || request.operationKind !== 'importPlaylist') {
      throw createServiceError('invalidOperationRequest', 'Automatic playlist import request is invalid');
    }
    const state = await this.repository.getAutomaticPlaylistImportState({
      folderId: source.folderId,
      relativePath: source.relativePath,
      playlistId: request.target?.playlistId
    });
    if (state.state === 'active' && state.contentDigest === source.contentDigest) {
      return { kind: 'automaticUnchanged' };
    }
    const expectedVersion = state.state === 'active' ? state.version : 0;
    if (!['active', 'missing', 'deleted'].includes(state.state) ||
        request.expectedTargetVersion !== expectedVersion) {
      throw createServiceError('playlistVersionConflict', 'Automatic playlist changed before import');
    }
    const signature = automaticImportSignature(request.target.playlistId, expectedVersion, source);
    this.automaticImportAuthorizations.set(request.clientRequestId, signature);
    try {
      const receipt = await this.service.start(request);
      if (receipt?.kind !== 'started') this.automaticImportAuthorizations.delete(request.clientRequestId);
      return receipt;
    } catch (error) {
      this.automaticImportAuthorizations.delete(request.clientRequestId);
      throw error;
    }
  }

  async status(operationId) {
    this.assertOpen();
    const normalizedOperationId = requireBoundedString(operationId, 'operationId');
    const playbackOperation = this.playbackOperations.get(normalizedOperationId);
    if (playbackOperation) return publicPlaybackOperationStatus(playbackOperation);
    const status = await this.service.status(normalizedOperationId);
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

  waitForTerminal(operationId) {
    this.assertOpen();
    const normalizedOperationId = requireBoundedString(operationId, 'operationId');
    const playbackOperation = this.playbackOperations.get(normalizedOperationId);
    if (!playbackOperation) return this.service.waitForTerminal(normalizedOperationId);
    return playbackOperation.task.then(() => publicPlaybackOperationStatus(playbackOperation));
  }

  cancel(operationId) {
    this.assertOpen();
    const normalizedOperationId = requireBoundedString(operationId, 'operationId');
    const playbackOperation = this.playbackOperations.get(normalizedOperationId);
    if (!playbackOperation) return this.service.cancel(normalizedOperationId);
    if (playbackOperation.finishedAt !== null) return Promise.resolve({ kind: 'tooLate' });
    playbackOperation.phase = 'CANCEL_REQUESTED';
    playbackOperation.updatedAt = this.now();
    playbackOperation.controller.abort(createServiceError('cancelled', 'Operation cancelled'));
    return Promise.resolve({ kind: 'cancelRequested', operationId: normalizedOperationId });
  }

  async previewPlaylistImport(request = {}) {
    this.assertOpen();
    assertBoundedMessage(request);
    assertExactRequest(request, [
      'clientRequestId', 'playlistId', 'name', 'source', 'encoding', 'limits'
    ]);
    await this.prunePlaylistImportPreviews();
    const activeCount = [...this.playlistImportPreviews.values()]
      .filter(entry => entry.state === 'ready' || entry.state === 'committing').length;
    if (activeCount >= MAX_PLAYLIST_IMPORT_PREVIEWS) {
      throw createServiceError('busy', 'Too many playlist import previews are open');
    }
    if (typeof this.parsePlaylistStream !== 'function' ||
        typeof this.importSourceProvider?.consumePlaylistImportGrant !== 'function') {
      throw createServiceError('playlistSourceUnavailable', 'Desktop playlist import is unavailable');
    }
    const clientRequestId = requireBoundedString(request.clientRequestId, 'clientRequestId');
    const parserLimits = normalizePlaylistParserLimits(request.limits);
    const playlistId = requireBoundedString(request.playlistId, 'playlistId');
    const name = requirePlaylistName(request.name);
    const receivedAt = this.now();
    const requestDigest = `sha256:${createHash('sha256').update(JSON.stringify({
      clientRequestId,
      playlistId,
      name,
      source: request.source
    })).digest('hex')}`;
    let operationId = null;
    try {
      const receipt = await this.repository.receiveOperation({
        clientRequestId,
        requestDigest,
        canonicalRequestVersion: 1,
        operationKind: 'previewPlaylistImport',
        target: { playlistId },
        expectedTargetVersion: 0,
        sourceContextToken: null,
        sourceSequenceIds: [],
        sourceSequenceItemCount: 0,
        buildDeadlineAt: receivedAt + PLAYLIST_IMPORT_PREVIEW_TTL_MS,
        receivedAt
      });
      if (receipt?.kind !== 'created') {
        const code = ['busy', 'insufficientStorage', 'requestIdReuse'].includes(receipt?.kind)
          ? receipt.kind
          : 'invalidOperationReceipt';
        throw createServiceError(code, 'Playlist import preview could not start', receipt);
      }
      operationId = receipt.operationId;
      await this.repository.transitionOperation(operationId, 'SNAPSHOTTING', { updatedAt: this.now() });
      const source = await this.importSourceProvider.consumePlaylistImportGrant(request.source);
      await this.repository.createPlaylist({ playlistId, name, operationId, createdAt: this.now() });
      const summary = await this.stagePlaylistImport({
        playlistId,
        operationId,
        source,
        origin: source.origin ?? null,
        fileName: source.name,
        encoding: request.encoding,
        limits: parserLimits,
        reportProgress: async () => {},
        checkCancelled: () => {}
      });
      await this.repository.transitionOperation(operationId, 'READY', { updatedAt: this.now() });
      const previewToken = `playlist_preview_${randomUUID()}`;
      const entry = {
        previewToken,
        operationId,
        playlistId,
        playlistName: name,
        ...summary,
        expiresAt: receivedAt + PLAYLIST_IMPORT_PREVIEW_TTL_MS,
        state: 'ready',
        result: null,
        commitPromise: null,
        expiryTimer: null
      };
      this.playlistImportPreviews.set(previewToken, entry);
      this.schedulePlaylistImportPreviewExpiry(entry);
      return publicPlaylistImportPreview(entry);
    } catch (error) {
      if (operationId) {
        await this.repository.completeOperation(operationId, {
          state: 'failed',
          code: error?.code || 'operationFailed',
          finishedAt: this.now()
        }).catch(() => {});
      }
      throw error;
    }
  }

  async commitPlaylistImportPreview(request = {}) {
    this.assertOpen();
    assertBoundedMessage(request);
    assertExactRequest(request, ['previewToken', 'playlistId']);
    await this.prunePlaylistImportPreviews();
    const previewToken = requireBoundedString(request.previewToken, 'previewToken');
    const playlistId = requireBoundedString(request.playlistId, 'playlistId');
    const entry = this.playlistImportPreviews.get(previewToken);
    if (!entry || entry.playlistId !== playlistId) {
      throw createServiceError('playlistImportPreviewExpired', 'Playlist import preview is no longer available');
    }
    if (entry.state === 'committed') return entry.result;
    if (entry.state === 'cancelled') {
      throw createServiceError('playlistImportPreviewCancelled', 'Playlist import preview was cancelled');
    }
    if (entry.commitPromise) return entry.commitPromise;
    entry.state = 'committing';
    entry.commitPromise = (async () => {
      try {
        await this.repository.transitionOperation(entry.operationId, 'COMMITTING', { updatedAt: this.now() });
        const published = await this.repository.publishPlaylist({
          playlistId: entry.playlistId,
          operationId: entry.operationId,
          expectedVersion: 0,
          finishedAt: this.now(),
          result: { itemCount: entry.totalCount }
        });
        if (published.kind === 'conflict') {
          throw createServiceError('playlistVersionConflict', 'Playlist changed before import publish', published);
        }
        entry.result = {
          playlistId: entry.playlistId,
          version: published.version,
          itemCount: entry.totalCount,
          resolvedCount: entry.resolvedCount,
          unresolvedCount: entry.unresolvedCount
        };
        entry.state = 'committed';
        return entry.result;
      } catch (error) {
        entry.state = 'cancelled';
        await this.repository.completeOperation(entry.operationId, {
          state: 'failed',
          code: error?.code || 'operationFailed',
          finishedAt: this.now()
        }).catch(() => {});
        throw error;
      }
    })();
    return entry.commitPromise;
  }

  async cancelPlaylistImportPreview(request = {}) {
    this.assertOpen();
    assertBoundedMessage(request);
    assertExactRequest(request, ['previewToken', 'playlistId']);
    const previewToken = requireBoundedString(request.previewToken, 'previewToken');
    const playlistId = requireBoundedString(request.playlistId, 'playlistId');
    const entry = this.playlistImportPreviews.get(previewToken);
    if (!entry || entry.playlistId !== playlistId) return { kind: 'cancelled' };
    if (entry.state === 'committed') return { kind: 'alreadyCommitted', result: entry.result };
    if (entry.state === 'cancelled') return { kind: 'cancelled' };
    if (entry.commitPromise) return { kind: 'tooLate' };
    entry.state = 'cancelled';
    await this.repository.completeOperation(entry.operationId, {
      state: 'cancelled',
      code: 'cancelled',
      finishedAt: this.now()
    });
    return { kind: 'cancelled' };
  }

  async prunePlaylistImportPreviews() {
    const now = this.now();
    const expired = [...this.playlistImportPreviews.values()]
      .filter(entry => entry.expiresAt <= now && entry.state !== 'committing');
    for (const entry of expired) {
      if (entry.state === 'ready') {
        entry.state = 'cancelled';
        await this.repository.completeOperation(entry.operationId, {
          state: 'cancelled', code: 'expired', finishedAt: now
        }).catch(() => {});
      }
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
      this.playlistImportPreviews.delete(entry.previewToken);
    }
  }

  schedulePlaylistImportPreviewExpiry(entry, delay = Math.max(0, entry.expiresAt - this.now())) {
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.expiryTimer = setTimeout(() => {
      void this.expirePlaylistImportPreview(entry.previewToken);
    }, delay);
    entry.expiryTimer.unref?.();
  }

  async expirePlaylistImportPreview(previewToken) {
    const entry = this.playlistImportPreviews.get(previewToken);
    if (!entry) return;
    const remaining = entry.expiresAt - this.now();
    if (remaining > 0) {
      this.schedulePlaylistImportPreviewExpiry(entry, remaining);
      return;
    }
    if (entry.state === 'committing') {
      this.schedulePlaylistImportPreviewExpiry(entry, 1_000);
      return;
    }
    if (entry.state === 'ready') {
      entry.state = 'cancelled';
      await this.repository.completeOperation(entry.operationId, {
        state: 'cancelled', code: 'expired', finishedAt: this.now()
      }).catch(() => {});
    }
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    this.playlistImportPreviews.delete(previewToken);
  }

  getProvisionalEntry(operationId) {
    this.assertOpen();
    return this.waitForProvisional(requireBoundedString(operationId, 'operationId'));
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
    if (typeof this.importSourceProvider?.resolvePlaybackSource !== 'function') {
      throw createServiceError(
        'playbackSourceBoundaryUnavailable',
        'Grant-aware playback source resolution is unavailable'
      );
    }
    const source = await this.importSourceProvider.resolvePlaybackSource(trackUid);
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
    for (const operation of this.playbackOperations.values()) {
      operation.controller.abort(createServiceError('cancelled', 'Operation cancelled'));
      this.resolveProvisional(operation.operationId, null);
    }
    this.playbackOperations.clear();
    for (const relay of this.progressRelays.values()) {
      if (relay.timer) clearTimeout(relay.timer);
    }
    this.progressRelays.clear();
    this.provisionals.clear();
    for (const entry of this.playlistImportPreviews.values()) {
      if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
      if (entry.state !== 'ready') continue;
      void this.repository.completeOperation(entry.operationId, {
        state: 'cancelled', code: 'cancelled', finishedAt: this.now()
      }).catch(() => {});
    }
    this.playlistImportPreviews.clear();
    this.automaticImportAuthorizations.clear();
    this.removeAllListeners();
  }

  async handlePlaybackOperation({ operationId, request, reportProgress, checkCancelled }) {
    const destination = PLAYBACK_DESTINATIONS[request.operationKind];
    const requestedDestination = request.options.playbackDestination;
    if (requestedDestination != null && requestedDestination !== destination) {
      throw createServiceError('invalidPlaybackDestination', 'Playback destination does not match the operation kind');
    }
    const currentOrdinal = request.operationKind === 'play'
      ? normalizePlaybackOrdinal(request.options.currentOrdinal)
      : 0;
    const seed = normalizeOptionalSeed(request.options.seed);
    const sequenceId = randomUUID();
    const selection = createSelectionMatcher(request.selectionDescriptor);
    const explicitSelectionIds = request.selectionDescriptor.mode === 'explicit'
      ? request.selectionDescriptor.trackUids
      : null;
    const explicitRows = explicitSelectionIds ? new Map() : null;
    let cursor = null;
    let catalogVersion = null;
    let itemCount = 0;
    let entries = [];
    let firstEntry = null;

    const flushEntries = async () => {
      if (entries.length === 0) return;
      const batch = entries;
      entries = [];
      await this.repository.appendPlaybackSequenceItems({ sequenceId, items: batch });
      if (request.operationKind === 'play' && firstEntry &&
          batch.some(entry => entry.entryInstanceId === firstEntry.entryInstanceId)) {
        this.resolveProvisional(operationId, firstEntry);
      }
    };
    const appendTrack = track => {
      const entry = createPlaybackEntry(track, randomUUID(), itemCount);
      if (itemCount === currentOrdinal) firstEntry = createPlaybackHandoffEntry(entry, track);
      entries.push(entry);
      itemCount += 1;
    };

    do {
      checkCancelled();
      const page = await this.repository.readContextPage({
        contextToken: request.selectionDescriptor.contextToken,
        cursor,
        limit: MATERIALIZE_PAGE_ROWS
      });
      if (catalogVersion === null) {
        catalogVersion = page.catalogVersion;
        await this.repository.createPlaybackSequence({
          sequenceId,
          sourceContext: request.selectionDescriptor.contextToken,
          catalogVersion,
          seed,
          createdAt: this.now()
        });
      }
      for (const row of page.rows) {
        const identity = selectionIdentity(row);
        const decision = selection.accept(identity);
        if (decision.selected && explicitRows) {
          explicitRows.set(identity, row.trackUid ? row : null);
        } else if (decision.selected && row.trackUid) {
          appendTrack(row);
        }
        if (decision.done) break;
      }
      if (!explicitRows) await flushEntries();
      await reportProgress({
        phase: 'materializing',
        processed: itemCount,
        total: null,
        state: 'running'
      });
      if (selection.done) break;
      cursor = page.nextCursor;
    } while (cursor);

    checkCancelled();
    selection.assertComplete();
    if (explicitSelectionIds) {
      for (const selectionId of explicitSelectionIds) {
        checkCancelled();
        const row = explicitRows.get(selectionId);
        if (!row?.trackUid) continue;
        appendTrack(row);
        if (entries.length === MATERIALIZE_PAGE_ROWS) await flushEntries();
      }
      await flushEntries();
    }
    if (!firstEntry) {
      this.resolveProvisional(operationId, null);
      throw createServiceError('emptySelection', 'The selected operation contains no playable track at its requested position');
    }
    checkCancelled();
    await this.repository.sealPlaybackSequence({
      sequenceId,
      itemCount,
      currentOrdinal,
      sealedAt: this.now()
    });
    await reportProgress({
      phase: 'ready',
      processed: itemCount,
      total: itemCount,
      state: 'running'
    });
    return {
      operationKind: request.operationKind,
      destination,
      sequenceId,
      itemCount,
      firstOrdinal: currentOrdinal,
      firstEntry,
      shuffleSeed: seed ?? 0
    };
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
    const automaticSource = request.options.automaticSource;
    if (!automaticSource && request.expectedTargetVersion !== 0) {
      throw createServiceError('invalidTargetVersion', 'Playlist import requires a new playlist target');
    }
    if (automaticSource) {
      const expected = automaticImportSignature(
        playlistId, request.expectedTargetVersion, automaticSource
      );
      const authorized = this.automaticImportAuthorizations.get(request.clientRequestId);
      this.automaticImportAuthorizations.delete(request.clientRequestId);
      if (authorized !== expected) {
        throw createServiceError('invalidOperationRequest', 'Automatic playlist import is not authorized');
      }
    }
    if (typeof this.parsePlaylistStream !== 'function' ||
        typeof this.importSourceProvider?.consumePlaylistImportGrant !== 'function') {
      throw createServiceError('playlistSourceUnavailable', 'Desktop playlist import is unavailable');
    }
    const source = await this.importSourceProvider.consumePlaylistImportGrant(runtime?.source);
    const name = requirePlaylistName(request.options.name);
    const parserLimits = normalizePlaylistParserLimits(request.options.limits);
    if (automaticSource) {
      const prepared = await this.repository.prepareAutomaticPlaylistImport({
        operationId,
        playlistId,
        expectedVersion: request.expectedTargetVersion,
        name,
        createdAt: this.now(),
        ...automaticSource
      });
      if (prepared.kind === 'unchanged') {
        return {
          playlistId,
          version: request.expectedTargetVersion,
          itemCount: null,
          automaticUnchanged: true
        };
      }
    } else {
      await this.repository.createPlaylist({ playlistId, name, operationId, createdAt: this.now() });
    }
    const summary = await this.stagePlaylistImport({
      playlistId,
      operationId,
      source,
      origin: source.origin ?? null,
      fileName: source.name,
      encoding: request.options.encoding,
      limits: parserLimits,
      reportProgress,
      checkCancelled
    });
    await this.repository.transitionOperation(operationId, 'READY', { updatedAt: this.now() });
    checkCancelled();
    await this.repository.transitionOperation(operationId, 'COMMITTING', { updatedAt: this.now() });
    const published = await this.repository.publishPlaylist({
      playlistId,
      operationId,
      expectedVersion: request.expectedTargetVersion,
      finishedAt: this.now(),
      result: { itemCount: summary.totalCount }
    });
    if (published.kind === 'conflict') {
      throw createServiceError('playlistVersionConflict', 'Playlist version changed before import publish', published);
    }
    return { playlistId, version: published.version, itemCount: summary.totalCount };
  }

  async stagePlaylistImport({
    playlistId,
    operationId,
    source,
    origin,
    fileName,
    encoding,
    limits,
    reportProgress,
    checkCancelled
  }) {
    let batch = [];
    let processed = 0;
    for await (const record of this.parsePlaylistStream(() => source.stream(), {
      fileName,
      encoding: encoding ?? undefined,
      limits: limits ?? undefined
    })) {
      checkCancelled();
      batch.push(record);
      if (batch.length < MATERIALIZE_PAGE_ROWS) continue;
      const staged = await this.repository.appendPlaylistImportRecords({
        playlistId, operationId, records: batch, origin
      });
      if (staged.kind === 'insufficientStorage') {
        throw createServiceError('insufficientStorage', 'Playlist import requires more storage', staged);
      }
      processed += batch.length;
      batch = [];
      await reportProgress({ phase: 'materializing', processed, total: null, state: 'running' });
    }
    if (batch.length) {
      const staged = await this.repository.appendPlaylistImportRecords({
        playlistId, operationId, records: batch, origin
      });
      if (staged.kind === 'insufficientStorage') {
        throw createServiceError('insufficientStorage', 'Playlist import requires more storage', staged);
      }
      processed += batch.length;
      await reportProgress({ phase: 'materializing', processed, total: null, state: 'running' });
    }
    let afterPosition = 0;
    let itemCount = 0;
    let resolvedCount = 0;
    const unresolvedItems = [];
    for (;;) {
      checkCancelled();
      const finalized = await this.repository.finalizePlaylistImportPage({
        playlistId,
        operationId,
        afterPosition,
        limit: MATERIALIZE_PAGE_ROWS
      });
      itemCount += finalized.keptCount;
      resolvedCount += finalized.resolvedCount;
      for (const item of finalized.unresolvedItems ?? []) {
        if (unresolvedItems.length === 5) break;
        unresolvedItems.push(item);
      }
      if (finalized.nextPosition === null) break;
      afterPosition = finalized.nextPosition;
    }
    return {
      totalCount: itemCount,
      resolvedCount,
      unresolvedCount: itemCount - resolvedCount,
      unresolvedItems
    };
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
        descriptor, transportOrdinal: processed, limit: 500
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
    provisionalOrdinal = 0,
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
    const explicitSelectionIds = descriptor.mode === 'explicit' ? descriptor.trackUids : null;
    const explicitRows = explicitSelectionIds ? new Map() : null;
    let cursor = null;
    let itemCount = 0;
    let catalogVersion = null;
    let buffer = [];
    let firstTrackSeen = false;

    do {
      checkCancelled();
      const page = await this.repository.readContextPage({
        contextToken: descriptor.contextToken,
        cursor,
        limit: MATERIALIZE_PAGE_ROWS
      });
      if (catalogVersion === null) catalogVersion = page.catalogVersion;
      for (const row of page.rows) {
        const decision = selection.accept(selectionIdentity(row));
        if (decision.selected && explicitRows) {
          explicitRows.set(selectionIdentity(row), row.trackUid ? row : null);
        } else if (decision.selected && row.trackUid) {
          if (!firstTrackSeen && itemCount === provisionalOrdinal) {
            firstTrackSeen = true;
            await onFirstTrack(row, page.catalogVersion);
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
    if (explicitSelectionIds) {
      for (const selectionId of explicitSelectionIds) {
        checkCancelled();
        const row = explicitRows.get(selectionId);
        if (!row?.trackUid) continue;
        if (!firstTrackSeen && itemCount === provisionalOrdinal) {
          firstTrackSeen = true;
          await onFirstTrack(row, catalogVersion ?? 0);
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
    this.pruneProvisionals();
  }

  pruneProvisionals() {
    if (this.provisionals.size <= MAX_PROVISIONAL_ENTRIES) return;
    for (const [operationId, signal] of this.provisionals) {
      if (!signal.settled) continue;
      this.provisionals.delete(operationId);
      if (this.provisionals.size <= MAX_PROVISIONAL_ENTRIES) return;
    }
  }

  prunePlaybackOperations() {
    if (this.playbackOperations.size <= MAX_PROVISIONAL_ENTRIES) return;
    for (const [operationId, operation] of this.playbackOperations) {
      if (operation.finishedAt === null) continue;
      this.playbackOperations.delete(operationId);
      if (this.playbackOperations.size <= MAX_PROVISIONAL_ENTRIES) return;
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
  const inclusions = new Set(descriptor.inclusions ?? []);
  let started = false;
  let completed = false;
  const sameEndpoint = descriptor.startUid === descriptor.endUid;
  return {
    get done() { return completed && inclusions.size === 0; },
    accept(trackUid) {
      const explicitlyIncluded = inclusions.delete(trackUid);
      const endpoint = trackUid === descriptor.startUid || trackUid === descriptor.endUid;
      let inRange = started && !completed;
      if (!started) {
        if (endpoint) {
          started = true;
          inRange = true;
          if (sameEndpoint) completed = true;
        }
      } else if (!completed && endpoint) {
        inRange = true;
        completed = true;
      }
      return {
        selected: (inRange || explicitlyIncluded) && !exclusions.has(trackUid),
        done: completed && inclusions.size === 0
      };
    },
    assertComplete() {
      if (!started || !completed || inclusions.size > 0) {
        throw createServiceError('selectionChanged', 'Range selection is not present in its catalog context');
      }
    }
  };
}

function selectionIdentity(row) {
  const identity = row?.playlistItemKey ?? row?.trackUid;
  if (typeof identity !== 'string' || identity.length === 0) {
    throw createServiceError('selectionChanged', 'Catalog row has no stable selection identity');
  }
  return identity;
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

function normalizePlaybackOrdinal(value) {
  if (value === undefined || value === null) return 0;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw createServiceError('invalidOption', 'Playback position must be a non-negative integer');
  }
  return value;
}

function requirePlaylistTarget(target) {
  if (!target || typeof target.playlistId !== 'string' || target.playlistId.length === 0 || target.playlistId.length > 512) {
    throw createServiceError('invalidTarget', 'Playlist target is invalid');
  }
  return target.playlistId;
}

function registerLibraryServiceIpc({
  ipcMain,
  coordinator,
  getMainWindow
}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function') {
    throw createServiceError('invalidIpcAdapter', 'Library service IPC adapter is invalid');
  }
  if (!coordinator || typeof coordinator.start !== 'function' || typeof getMainWindow !== 'function') {
    throw createServiceError('invalidIpcAdapter', 'Library service IPC dependencies are invalid');
  }
  const handlers = {
    start: (_event, request) => coordinator.start(request),
    status: (_event, request) => {
      assertExactRequest(request, ['operationId']);
      return coordinator.status(request.operationId);
    },
    cancel: (_event, request) => {
      assertExactRequest(request, ['operationId']);
      return coordinator.cancel(request.operationId);
    },
    previewPlaylistImport: (_event, request) => coordinator.previewPlaylistImport(request),
    commitPlaylistImportPreview: (_event, request) => coordinator.commitPlaylistImportPreview(request),
    cancelPlaylistImportPreview: (_event, request) => coordinator.cancelPlaylistImportPreview(request),
    getProvisionalEntry: (_event, request) => {
      assertExactRequest(request, ['operationId']);
      return coordinator.getProvisionalEntry(request.operationId);
    },
    readSequencePage: (_event, request) => coordinator.readSequencePage(request),
    resolveSequenceEntrySource: async (_event, request) => {
      try {
        const source = await coordinator.resolveSequenceEntrySource(request);
        return publicPlaybackSource(source);
      } catch (error) {
        if (error?.code === 'folderPermissionRequired') return publicFolderPermissionError(error);
        throw error;
      }
    }
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

function publicPlaybackSource(source) {
  if (!source || source.kind !== 'electron-file') return source;
  const sourcePath = source.path;
  if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath)) {
    throw createServiceError('sourceUnavailable', 'Track source is unavailable');
  }
  const publicSource = { ...source };
  delete publicSource.mediaUrl;
  return {
    ...publicSource,
    path: sourcePath,
    fileName: path.basename(sourcePath)
  };
}

function publicFolderPermissionError(error) {
  const folderId = typeof error?.details?.folderId === 'string'
    ? error.details.folderId.slice(0, 512)
    : '';
  const lifecycleVersion = Number(error?.details?.lifecycleVersion);
  if (!folderId || !Number.isSafeInteger(lifecycleVersion) || lifecycleVersion < 0) {
    throw createServiceError('sourceUnavailable', 'Track source is unavailable');
  }
  return {
    code: 'folderPermissionRequired',
    details: { folderId, lifecycleVersion }
  };
}

function createPlaybackEntry(track, entryInstanceId, ordinal) {
  return {
    ordinal,
    entryInstanceId,
    trackUid: track.trackUid
  };
}

function createPlaybackHandoffEntry(entry, track) {
  return Object.freeze({
    ...entry,
    title: track.title ?? '',
    artist: track.artist ?? '',
    albumArtist: track.albumArtist ?? '',
    album: track.album ?? '',
    artworkId: track.artworkId ?? null
  });
}

function publicPlaybackOperationStatus(operation) {
  return {
    operationId: operation.operationId,
    operationKind: operation.operationKind,
    phase: operation.phase,
    committed: false,
    processed: operation.processed,
    total: operation.total,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    finishedAt: operation.finishedAt,
    terminalKind: operation.terminalKind,
    terminalCode: operation.terminalCode,
    progress: operation.progress,
    result: operation.result
  };
}

function publicPlaylistImportPreview(entry) {
  return {
    previewToken: entry.previewToken,
    playlistId: entry.playlistId,
    playlistName: entry.playlistName,
    totalCount: entry.totalCount,
    resolvedCount: entry.resolvedCount,
    unresolvedCount: entry.unresolvedCount,
    unresolvedItems: entry.unresolvedItems,
    expiresAt: entry.expiresAt
  };
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

function automaticImportSignature(playlistId, expectedVersion, source) {
  return JSON.stringify([
    playlistId,
    expectedVersion,
    source.folderId,
    source.relativePath,
    source.contentDigest
  ]);
}

function normalizePlaylistParserLimits(value) {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createServiceError('invalidRequest', 'Playlist parser limits must be an object');
  }
  const normalized = {};
  for (const [field, limit] of Object.entries(value)) {
    const maximum = PLAYLIST_PARSER_LIMIT_MAXIMA[field];
    if (
      maximum === undefined || !Number.isSafeInteger(limit) || limit <= 0 || limit > maximum
    ) {
      throw createServiceError(
        'invalidRequest',
        'Playlist parser limits may only tighten known positive limits'
      );
    }
    normalized[field] = limit;
  }
  return Object.freeze(normalized);
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
