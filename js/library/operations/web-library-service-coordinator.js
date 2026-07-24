import { DurableLibraryService } from './durable-library-service.js';
import { validateBulkOperationStart } from './bulk-operation-protocol.js';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';
import { WebFileSystemScanAdapter, queryFolderPermission } from '../scan/web-file-system-adapter.js';
import { parsePlaylistStream } from '../playlists/playlist-stream.js';

const SUPPORTED_OPERATION_KINDS = new Set(['play', 'playNext', 'queue', 'addToPlaylist', 'importPlaylist']);
const PLAYBACK_OPERATION_KINDS = new Set(['play', 'playNext', 'queue']);
const PAGE_ROWS = 500;
const PROGRESS_INTERVAL_MS = 250;
const PLAYLIST_IMPORT_PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PLAYLIST_IMPORT_PREVIEWS = 4;
const MAX_PROVISIONAL_ENTRIES = 128;
const PLAYBACK_DESTINATIONS = Object.freeze({
  play: 'replace',
  playNext: 'after-current',
  queue: 'append'
});

export class WebLibraryServiceCoordinator {
  constructor({
    repository,
    handleStore = null,
    sourceProvider = null,
    cryptoApi = globalThis.crypto,
    now = () => Date.now(),
    idFactory = defaultId,
    onEvent = () => {}
  } = {}) {
    assertRepositoryContract(repository && typeof repository.queryTracks === 'function', 'invalidRepository', 'Web LibraryService repository is invalid');
    this.repository = repository;
    this.handleStore = handleStore;
    this.sourceProvider = sourceProvider;
    this.now = now;
    this.idFactory = idFactory;
    this.onEvent = onEvent;
    this.provisionals = new Map();
    this.playbackOperations = new Map();
    this.progressRelays = new Map();
    this.playlistImportPreviews = new Map();
    this.automaticImportAuthorizations = new Map();
    this.closed = false;
    this.service = new DurableLibraryService({
      repository: createObservableRepository(repository, {
        onProgress: progress => this.#relayProgress(progress),
        onTerminal: (operationId, result) => this.#relayTerminal(operationId, result)
      }),
      cryptoApi,
      now,
      handlers: {
        addToPlaylist: context => this.#handleAddToPlaylist(context),
        importPlaylist: context => this.#handlePlaylistImport(context)
      }
    });
  }

  async start(request) {
    assertRepositoryContract(SUPPORTED_OPERATION_KINDS.has(request?.operationKind), 'invalidOperationKind', 'Operation kind is not supported by the Web service');
    if (PLAYBACK_OPERATION_KINDS.has(request.operationKind)) {
      return this.#startPlaybackOperation(validateBulkOperationStart(request));
    }
    return this.service.start(request);
  }

  #startPlaybackOperation(request) {
    const operationId = this.idFactory();
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
    operation.task = this.#runPlaybackOperation(operation, request);
    return { kind: 'started', operationId };
  }

  async #runPlaybackOperation(operation, request) {
    const checkCancelled = () => {
      if (operation.controller.signal.aborted) {
        throw createRepositoryError('cancelled', 'Operation cancelled');
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
      this.#relayProgress(operation.progress);
    };
    let terminal;
    try {
      operation.phase = 'SNAPSHOTTING';
      operation.updatedAt = this.now();
      const outcome = await this.#handlePlayback({
        operationId: operation.operationId,
        request,
        reportProgress,
        checkCancelled
      });
      checkCancelled();
      terminal = { state: 'succeeded', result: outcome, finishedAt: this.now() };
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
    if (!this.closed) {
      this.#resolveProvisional(operation.operationId, null);
      this.#relayTerminal(operation.operationId, terminal);
      this.#prunePlaybackOperations();
    }
  }

  getAutomaticPlaylistImportState(request) {
    return this.repository.getAutomaticPlaylistImportState(request);
  }

  async startAutomaticPlaylistImport(request) {
    const source = request?.options?.automaticSource;
    assertRepositoryContract(
      source && request.operationKind === 'importPlaylist',
      'invalidOperationRequest',
      'Automatic playlist import request is invalid'
    );
    const state = await this.repository.getAutomaticPlaylistImportState({
      folderId: source.folderId,
      relativePath: source.relativePath,
      playlistId: request.target?.playlistId
    });
    if (state.state === 'active' && state.contentDigest === source.contentDigest) {
      return { kind: 'automaticUnchanged' };
    }
    const expectedVersion = state.state === 'active' ? state.version : 0;
    assertRepositoryContract(
      ['active', 'missing', 'deleted'].includes(state.state) &&
        request.expectedTargetVersion === expectedVersion,
      'playlistVersionConflict',
      'Automatic playlist changed before import'
    );
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

  status(operationId) {
    const playbackOperation = this.playbackOperations.get(operationId);
    return playbackOperation
      ? publicPlaybackOperationStatus(playbackOperation)
      : this.service.status(operationId);
  }
  waitForTerminal(operationId) {
    const playbackOperation = this.playbackOperations.get(operationId);
    return playbackOperation
      ? playbackOperation.task.then(() => publicPlaybackOperationStatus(playbackOperation))
      : this.service.waitForTerminal(operationId);
  }
  cancel(operationId) {
    const playbackOperation = this.playbackOperations.get(operationId);
    if (!playbackOperation) return this.service.cancel(operationId);
    if (playbackOperation.finishedAt !== null) return Promise.resolve({ kind: 'tooLate' });
    playbackOperation.phase = 'CANCEL_REQUESTED';
    playbackOperation.updatedAt = this.now();
    playbackOperation.controller.abort(createRepositoryError('cancelled', 'Operation cancelled'));
    return Promise.resolve({ kind: 'cancelRequested', operationId });
  }
  async previewPlaylistImport(request = {}) {
    assertExactServiceRequest(request, [
      'clientRequestId', 'playlistId', 'name', 'source', 'encoding', 'limits'
    ]);
    await this.#prunePlaylistImportPreviews();
    const activeCount = [...this.playlistImportPreviews.values()]
      .filter(entry => entry.state === 'ready' || entry.state === 'committing').length;
    assertRepositoryContract(
      activeCount < MAX_PLAYLIST_IMPORT_PREVIEWS,
      'busy',
      'Too many playlist import previews are open'
    );
    const source = request.source;
    assertRepositoryContract(
      source && typeof source.stream === 'function' && typeof source.name === 'string',
      'playlistSourceUnavailable',
      'Playlist import source is unavailable'
    );
    const clientRequestId = boundedSaveString(request.clientRequestId, 'clientRequestId');
    const playlistId = boundedSaveString(request.playlistId, 'playlistId');
    const name = boundedSaveString(request.name, 'name', 4096);
    const receivedAt = this.now();
    let operationId = null;
    try {
      const receipt = await this.repository.receiveOperation({
        clientRequestId,
        requestDigest: `preview:${this.idFactory()}`,
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
        throw createRepositoryError(code, 'Playlist import preview could not start', receipt);
      }
      operationId = receipt.operationId;
      await this.repository.transitionOperation(operationId, 'SNAPSHOTTING', { updatedAt: this.now() });
      await this.repository.createPlaylist({ playlistId, name, operationId, createdAt: this.now() });
      const summary = await this.#stagePlaylistImport({
        playlistId,
        operationId,
        source,
        origin: null,
        fileName: source.name,
        encoding: request.encoding,
        limits: request.limits,
        reportProgress: async () => {},
        checkCancelled: () => {}
      });
      await this.repository.transitionOperation(operationId, 'READY', { updatedAt: this.now() });
      const previewToken = `playlist_preview_${this.idFactory()}`;
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
      this.#schedulePlaylistImportPreviewExpiry(entry);
      return publicPlaylistImportPreview(entry);
    } catch (error) {
      if (operationId) {
        await this.repository.completeOperation(operationId, {
          state: 'failed', code: error?.code || 'operationFailed', finishedAt: this.now()
        }).catch(() => {});
      }
      throw error;
    }
  }
  async commitPlaylistImportPreview(request = {}) {
    assertExactServiceRequest(request, ['previewToken', 'playlistId']);
    await this.#prunePlaylistImportPreviews();
    const previewToken = boundedSaveString(request.previewToken, 'previewToken');
    const playlistId = boundedSaveString(request.playlistId, 'playlistId');
    const entry = this.playlistImportPreviews.get(previewToken);
    assertRepositoryContract(
      entry?.playlistId === playlistId,
      'playlistImportPreviewExpired',
      'Playlist import preview is no longer available'
    );
    if (entry.state === 'committed') return entry.result;
    assertRepositoryContract(
      entry.state !== 'cancelled',
      'playlistImportPreviewCancelled',
      'Playlist import preview was cancelled'
    );
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
          throw createRepositoryError('playlistVersionConflict', 'Playlist changed before import publish', published);
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
          state: 'failed', code: error?.code || 'operationFailed', finishedAt: this.now()
        }).catch(() => {});
        throw error;
      }
    })();
    return entry.commitPromise;
  }
  async cancelPlaylistImportPreview(request = {}) {
    assertExactServiceRequest(request, ['previewToken', 'playlistId']);
    const previewToken = boundedSaveString(request.previewToken, 'previewToken');
    const playlistId = boundedSaveString(request.playlistId, 'playlistId');
    const entry = this.playlistImportPreviews.get(previewToken);
    if (!entry || entry.playlistId !== playlistId) return { kind: 'cancelled' };
    if (entry.state === 'committed') return { kind: 'alreadyCommitted', result: entry.result };
    if (entry.state === 'cancelled') return { kind: 'cancelled' };
    if (entry.commitPromise) return { kind: 'tooLate' };
    entry.state = 'cancelled';
    await this.repository.completeOperation(entry.operationId, {
      state: 'cancelled', code: 'cancelled', finishedAt: this.now()
    });
    return { kind: 'cancelled' };
  }
  getProvisionalEntry(operationId) { return this.#waitForProvisional(operationId); }

  readSequencePage(request) {
    return this.repository.queryPlaybackSequence(request);
  }

  async resolveSequenceEntrySource({ sequenceId = null, ordinal = null, entryInstanceId = null, trackUid = null } = {}) {
    assertRepositoryContract(
      this.sourceProvider || this.handleStore,
      'sourceUnavailable',
      'Web folder source provider is unavailable'
    );
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
    let file;
    if (typeof this.sourceProvider?.resolveTrackFile === 'function') {
      file = await this.sourceProvider.resolveTrackFile(track);
    } else {
      const handle = await this.handleStore.get(track.folderId);
      if (!handle || await queryFolderPermission(handle) !== 'granted') {
        await this.repository.setFolderAvailability({ folderId: track.folderId, status: 'needs-permission' });
        throw createRepositoryError(
          'folderPermissionRequired',
          'Playback folder access must be restored',
          { folderId: track.folderId, lifecycleVersion: track.lifecycleVersion }
        );
      }
      try {
        file = await new WebFileSystemScanAdapter({ rootHandle: handle }).getFile(track.relativePath);
      } catch (error) {
        if (error?.code !== 'temporary-permission') throw error;
        await this.repository.setFolderAvailability({ folderId: track.folderId, status: 'needs-permission' });
        throw createRepositoryError(
          'folderPermissionRequired',
          'Playback folder access must be restored',
          { folderId: track.folderId, lifecycleVersion: track.lifecycleVersion }
        );
      }
    }
    return {
      kind: 'file',
      sequenceId,
      ordinal,
      entryInstanceId: entry?.entryInstanceId ?? entryInstanceId,
      trackUid,
      sourceKind: track.sourceKind,
      entryKey: track.entryKey,
      cueRelativePath: track.cueRelativePath,
      startFrame: track.startFrame,
      endFrame: track.endFrame,
      durationSec: track.durationSec,
      physicalSourceKey: track.physicalSourceKey,
      file
    };
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    for (const operation of this.playbackOperations.values()) {
      operation.controller.abort(createRepositoryError('cancelled', 'Operation cancelled'));
      this.#resolveProvisional(operation.operationId, null);
    }
    this.playbackOperations.clear();
    for (const relay of this.progressRelays.values()) if (relay.timer) clearTimeout(relay.timer);
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
  }

  async #handlePlayback({ operationId, request, reportProgress, checkCancelled }) {
    const contextToken = request.selectionDescriptor.contextToken;
    const retained = await this.repository.retainContext(contextToken);
    try {
      const destination = PLAYBACK_DESTINATIONS[request.operationKind];
      const requestedDestination = request.options.playbackDestination;
      assertRepositoryContract(
        requestedDestination == null || requestedDestination === destination,
        'invalidPlaybackDestination',
        'Playback destination does not match the operation kind'
      );
      const currentOrdinal = request.operationKind === 'play'
        ? normalizePlaybackOrdinal(request.options.currentOrdinal)
        : 0;
      const seed = normalizeOptionalSeed(request.options.seed);
      const sequenceId = this.idFactory();
      const selection = createSelectionMatcher(request.selectionDescriptor);
      const explicitSelectionIds = request.selectionDescriptor.mode === 'explicit'
        ? request.selectionDescriptor.trackUids
        : null;
      const explicitRows = explicitSelectionIds ? new Map() : null;
      const readContextPage = typeof this.repository.readContextPage === 'function'
        ? request => this.repository.readContextPage(request)
        : request => this.repository.queryTracks(request);
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
          this.#resolveProvisional(operationId, firstEntry);
        }
      };
      const appendTrack = track => {
        const entry = createPlaybackEntry(track, this.idFactory(), itemCount);
        if (itemCount === currentOrdinal) firstEntry = createPlaybackHandoffEntry(entry, track);
        entries.push(entry);
        itemCount += 1;
      };

      do {
        checkCancelled();
        const page = await readContextPage({
          contextToken: request.selectionDescriptor.contextToken,
          cursor,
          limit: PAGE_ROWS
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
        await reportProgress({ phase: 'materializing', processed: itemCount, total: null, state: 'running' });
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
          if (entries.length === PAGE_ROWS) await flushEntries();
        }
        await flushEntries();
      }
      if (!firstEntry) {
        this.#resolveProvisional(operationId, null);
        throw createRepositoryError('emptySelection', 'The selected operation contains no playable track at its requested position');
      }
      checkCancelled();
      await this.repository.sealPlaybackSequence({
        sequenceId,
        itemCount,
        currentOrdinal,
        sealedAt: this.now()
      });
      await reportProgress({ phase: 'ready', processed: itemCount, total: itemCount, state: 'running' });
      return {
        operationKind: request.operationKind,
        destination,
        sequenceId,
        itemCount,
        firstOrdinal: currentOrdinal,
        firstEntry,
        shuffleSeed: seed ?? 0
      };
    } finally {
      if (retained?.retained === true) {
        await this.repository.releaseRetainedContext(contextToken);
      }
    }
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
        descriptor, transportOrdinal: processed, limit: 500
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
    const automaticSource = request.options.automaticSource;
    assertRepositoryContract(
      automaticSource || request.expectedTargetVersion === 0,
      'invalidTargetVersion',
      'Playlist import requires a new playlist target'
    );
    if (automaticSource) {
      const expected = automaticImportSignature(
        playlistId, request.expectedTargetVersion, automaticSource
      );
      const authorized = this.automaticImportAuthorizations.get(request.clientRequestId);
      this.automaticImportAuthorizations.delete(request.clientRequestId);
      assertRepositoryContract(
        authorized === expected,
        'invalidOperationRequest',
        'Automatic playlist import is not authorized'
      );
    }
    const source = runtime?.source;
    assertRepositoryContract(source && typeof source.stream === 'function', 'playlistSourceUnavailable', 'Playlist import source is unavailable');
    const name = boundedSaveString(request.options.name, 'name', 4096);
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
      await this.repository.createPlaylist({
        playlistId,
        name,
        operationId,
        createdAt: this.now()
      });
    }
    const summary = await this.#stagePlaylistImport({
      playlistId,
      operationId,
      source,
      origin: automaticSource ? {
        folderId: automaticSource.folderId,
        playlistRelativePath: automaticSource.relativePath
      } : null,
      fileName: request.options.source.name,
      encoding: request.options.encoding,
      limits: request.options.limits,
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
    if (published.kind === 'conflict') throw createRepositoryError('playlistVersionConflict', 'Playlist version changed before import publish', published);
    return { playlistId, version: published.version, itemCount: summary.totalCount };
  }

  async #stagePlaylistImport({
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
    const sourceFactory = () => readableStreamChunks(source.stream());
    let batch = [];
    let processed = 0;
    for await (const record of parsePlaylistStream(sourceFactory, {
      fileName,
      encoding: encoding ?? undefined,
      limits: limits ?? undefined
    })) {
      checkCancelled();
      batch.push(record);
      if (batch.length < PAGE_ROWS) continue;
      const staged = await this.repository.appendPlaylistImportRecords({
        playlistId, operationId, records: batch, origin
      });
      if (staged.kind === 'insufficientStorage') throw createRepositoryError('insufficientStorage', 'Playlist import requires more storage', staged);
      processed += batch.length;
      batch = [];
      await reportProgress({ phase: 'materializing', processed, total: null, state: 'running' });
    }
    if (batch.length) {
      const staged = await this.repository.appendPlaylistImportRecords({
        playlistId, operationId, records: batch, origin
      });
      if (staged.kind === 'insufficientStorage') throw createRepositoryError('insufficientStorage', 'Playlist import requires more storage', staged);
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
        limit: PAGE_ROWS
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

  async #prunePlaylistImportPreviews() {
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

  #schedulePlaylistImportPreviewExpiry(entry, delay = Math.max(0, entry.expiresAt - this.now())) {
    if (entry.expiryTimer) clearTimeout(entry.expiryTimer);
    entry.expiryTimer = setTimeout(() => {
      void this.#expirePlaylistImportPreview(entry.previewToken);
    }, delay);
  }

  async #expirePlaylistImportPreview(previewToken) {
    const entry = this.playlistImportPreviews.get(previewToken);
    if (!entry) return;
    const remaining = entry.expiresAt - this.now();
    if (remaining > 0) {
      this.#schedulePlaylistImportPreviewExpiry(entry, remaining);
      return;
    }
    if (entry.state === 'committing') {
      this.#schedulePlaylistImportPreviewExpiry(entry, 1_000);
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

  async #materializeSelection({
    operationId,
    descriptor,
    reportProgress,
    checkCancelled,
    provisionalOrdinal = 0,
    onFirstTrack = () => {}
  }) {
    const snapshotId = this.idFactory();
    await this.repository.createOperationSnapshot({
      snapshotId,
      operationId,
      snapshotKind: 'operation-selection',
      createdAt: this.now(),
      expiresAt: this.now() + 24 * 60 * 60 * 1000
    });
    const matcher = createSelectionMatcher(descriptor);
    const explicitSelectionIds = descriptor.mode === 'explicit' ? descriptor.trackUids : null;
    const explicitRows = explicitSelectionIds ? new Map() : null;
    const orderDigest = new IncrementalDigest('order');
    const membershipDigest = new IncrementalDigest('membership');
    let cursor = null;
    let itemCount = 0;
    let catalogVersion = null;
    let buffer = [];
    let first = true;
    do {
      checkCancelled();
      const page = await this.repository.queryTracks({ contextToken: descriptor.contextToken, cursor, limit: PAGE_ROWS });
      catalogVersion ??= page.catalogVersion;
      for (const row of page.rows) {
        const decision = matcher.accept(selectionIdentity(row));
        if (decision.selected && explicitRows) {
          explicitRows.set(selectionIdentity(row), row.trackUid ? row : null);
        } else if (decision.selected && row.trackUid) {
          if (first && itemCount === provisionalOrdinal) {
            first = false;
            await onFirstTrack(row, page.catalogVersion);
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
    if (explicitSelectionIds) {
      for (const selectionId of explicitSelectionIds) {
        checkCancelled();
        const row = explicitRows.get(selectionId);
        if (!row?.trackUid) continue;
        if (first && itemCount === provisionalOrdinal) {
          first = false;
          await onFirstTrack(row, catalogVersion ?? 0);
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
      this.#pruneProvisionals();
    }
    return signal.settled ? Promise.resolve(signal.value) : signal.promise;
  }

  #resolveProvisional(operationId, value) {
    const signal = this.provisionals.get(operationId);
    if (!signal) {
      this.provisionals.set(operationId, { promise: Promise.resolve(value), resolve: null, settled: true, value });
      this.#pruneProvisionals();
      return;
    }
    if (signal.settled) return;
    signal.settled = true;
    signal.value = value;
    signal.resolve(value);
    signal.resolve = null;
    this.#pruneProvisionals();
  }

  #pruneProvisionals() {
    if (this.provisionals.size <= MAX_PROVISIONAL_ENTRIES) return;
    for (const [operationId, signal] of this.provisionals) {
      if (!signal.settled) continue;
      this.provisionals.delete(operationId);
      if (this.provisionals.size <= MAX_PROVISIONAL_ENTRIES) return;
    }
  }

  #prunePlaybackOperations() {
    if (this.playbackOperations.size <= MAX_PROVISIONAL_ENTRIES) return;
    for (const [operationId, operation] of this.playbackOperations) {
      if (operation.finishedAt === null) continue;
      this.playbackOperations.delete(operationId);
      if (this.playbackOperations.size <= MAX_PROVISIONAL_ENTRIES) return;
    }
  }

  #relayProgress(progress) {
    if (this.closed) return;
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
      if (this.closed || !relay.pending) return;
      const pending = relay.pending;
      relay.pending = null;
      relay.lastSentAt = this.now();
      this.onEvent({ kind: 'progress', progress: pending });
    }, Math.max(0, PROGRESS_INTERVAL_MS - (now - relay.lastSentAt)));
  }

  #relayTerminal(operationId, result) {
    if (this.closed) return;
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

function normalizeOptionalSeed(seed) {
  if (seed === undefined || seed === null) return null;
  assertRepositoryContract(Number.isSafeInteger(seed), 'invalidOption', 'Playback seed must be an integer');
  return seed;
}

function normalizePlaybackOrdinal(value) {
  if (value === undefined || value === null) return 0;
  assertRepositoryContract(
    Number.isSafeInteger(value) && value >= 0,
    'invalidOption',
    'Playback position must be a non-negative integer'
  );
  return value;
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
  const inclusions = new Set(descriptor.inclusions ?? []);
  let started = false;
  let completed = false;
  const same = descriptor.startUid === descriptor.endUid;
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
          completed = same;
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
      assertRepositoryContract(
        started && completed && inclusions.size === 0,
        'selectionChanged',
        'Range selection changed'
      );
    }
  };
}

function selectionIdentity(row) {
  const identity = row?.playlistItemKey ?? row?.trackUid;
  assertRepositoryContract(
    typeof identity === 'string' && identity.length > 0,
    'selectionChanged',
    'Catalog row has no stable selection identity'
  );
  return identity;
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

function assertExactServiceRequest(request, fields) {
  assertRepositoryContract(
    request && typeof request === 'object' && !Array.isArray(request),
    'invalidRequest',
    'Library service request must be an object'
  );
  const actual = Object.keys(request).sort();
  const expected = [...fields].sort();
  assertRepositoryContract(
    actual.length === expected.length && actual.every((field, index) => field === expected[index]),
    'invalidRequest',
    'Library service request fields are invalid'
  );
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

function automaticImportSignature(playlistId, expectedVersion, source) {
  return JSON.stringify([
    playlistId,
    expectedVersion,
    source.folderId,
    source.relativePath,
    source.contentDigest
  ]);
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
