import { createProductionCatalogClient } from './repository/catalog-client-factory.js';
import { createRepositoryError } from './repository/contract-errors.js';
import { coalesceInvalidations } from './repository/invalidation.js';
import { createWebLibraryServices } from './scan/web-library-services.js';
import { createPagedPlaylistService } from './playlists/paged-playlist-service.js';

const MAX_LISTENERS_PER_EVENT = 32;
const MAX_ARTWORK_URL_CACHE_ENTRIES = 32;
const MAX_ARTWORK_THUMBNAIL_BYTES = 512 * 1024;
const PLAYLIST_METHODS = Object.freeze([
  'list',
  'get',
  'listPage',
  'openListContext',
  'readListContext',
  'releaseListContext',
  'queryItems',
  'create',
  'rename',
  'duplicate',
  'delete',
  'reorderItem',
  'removeItem',
  'replaceItems',
  'addTracks',
  'importFile',
  'exportToSink'
]);

function defaultWindowRef() {
  return typeof window === 'undefined' ? globalThis : window;
}

function createClientRequestId(cryptoRef = globalThis.crypto) {
  if (typeof cryptoRef?.randomUUID !== 'function') {
    throw createRepositoryError('cryptoUnavailable', 'Secure operation request IDs are unavailable');
  }
  return cryptoRef.randomUUID();
}

function unavailable(operation, serviceName) {
  return createRepositoryError(
    'operationUnavailable',
    `${operation} is unavailable because ${serviceName} is not configured`,
    { operation, service: serviceName }
  );
}

function assertClientMethod(client, method) {
  if (typeof client?.[method] !== 'function') {
    throw createRepositoryError('catalogContractMismatch', `Catalog client is missing ${method}`, { method });
  }
}

function normalizeContextRequest(request = {}) {
  if (request.endpoint === 'tracks') {
    return {
      publicRequest: {
        endpoint: 'tracks',
        query: String(request.query ?? ''),
        sort: request.sort ?? 'title',
        direction: request.direction === 'desc' ? 'desc' : 'asc',
        scope: request.scope ?? null
      },
      clientRequest: {
        endpoint: 'tracks',
        query: String(request.query ?? ''),
        sort: request.sort ?? 'title',
        direction: request.direction === 'desc' ? 'desc' : 'asc',
        scope: request.scope ?? null
      }
    };
  }
  if (request.endpoint === 'entities' && typeof request.entityType === 'string') {
    const publicRequest = {
      endpoint: 'entities',
      entityType: request.entityType,
      query: String(request.query ?? ''),
      sort: request.sort ?? 'name',
      direction: request.direction === 'desc' ? 'desc' : 'asc',
      scope: null
    };
    return {
      publicRequest,
      clientRequest: {
        endpoint: `entities:${request.entityType}`,
        query: publicRequest.query,
        sort: publicRequest.sort,
        direction: publicRequest.direction,
        scope: null
      }
    };
  }
  throw createRepositoryError('invalidQuery', 'Catalog context endpoint is invalid');
}

export class LibraryManagerV2 {
  constructor({
    uiManager = null,
    windowRef = defaultWindowRef(),
    catalogClientFactory = createProductionCatalogClient,
    folderService = null,
    scanService = null,
    playlistService = null,
    bulkOperationService = null,
    rowActionService = null,
    clientRequestIdFactory = createClientRequestId,
    queueMicrotaskFn = (...args) => globalThis.queueMicrotask(...args),
    logger = console
  } = {}) {
    this.uiManager = uiManager;
    this.windowRef = windowRef;
    this.catalogClientFactory = catalogClientFactory;
    this.folderService = folderService;
    this.scanService = scanService;
    this.playlistService = playlistService;
    this.bulkOperationService = bulkOperationService;
    this.rowActionService = rowActionService;
    this.clientRequestIdFactory = clientRequestIdFactory;
    this.queueMicrotaskFn = typeof queueMicrotaskFn === 'function'
      ? (...args) => queueMicrotaskFn(...args)
      : callback => Promise.resolve().then(callback);
    this.logger = logger;
    this.client = null;
    this.runtime = null;
    this.capabilities = null;
    this.productionQualified = false;
    this.contexts = new Map();
    this.listeners = new Map();
    this.initPromise = null;
    this.closePromise = null;
    this.unsubscribeInvalidations = null;
    this.unsubscribeScanEvents = null;
    this.pendingInvalidation = null;
    this.invalidationFlushQueued = false;
    this.artworkUrlCache = new Map();
    this.ready = false;
    this.closed = false;
    this.playlists = Object.freeze(Object.fromEntries(PLAYLIST_METHODS.map(method => [
      method,
      (...args) => this.#invokeService(this.playlistService, method, 'playlistService', args)
    ])));
  }

  get isReady() {
    return this.ready && !this.closed;
  }

  init() {
    if (this.closed) {
      return Promise.reject(createRepositoryError('managerClosed', 'Library manager is closed'));
    }
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.#initialize().catch(error => {
      this.initPromise = null;
      throw error;
    });
    return this.initPromise;
  }

  async #initialize() {
    const descriptor = await this.catalogClientFactory({ windowRef: this.windowRef });
    const client = descriptor?.client;
    let unsubscribeInvalidations = null;
    let unsubscribeScanEvents = null;
    try {
      assertClientMethod(client, 'getCounts');
      assertClientMethod(client, 'createContext');
      assertClientMethod(client, 'queryTracks');
      assertClientMethod(client, 'releaseContext');
      assertClientMethod(client, 'getTrack');
      if (typeof client.queryEntities !== 'function' && typeof client.readContextPage !== 'function') {
        throw createRepositoryError(
          'catalogContractMismatch',
          'Catalog client must support queryEntities or readContextPage'
        );
      }
      if (this.closed) {
        throw createRepositoryError('managerClosed', 'Library manager closed during initialization');
      }
      if (typeof client.subscribeInvalidations === 'function') {
        unsubscribeInvalidations = client.subscribeInvalidations(event => this.#queueInvalidation(event));
      }
      this.client = client;
      this.runtime = descriptor.runtime ?? 'unknown';
      this.capabilities = descriptor.capabilities ?? null;
      this.productionQualified = descriptor.productionQualified === true;
      this.bulkOperationService ??= descriptor.bulkOperationService ?? null;
      this.playlistService ??= createPagedPlaylistService({
        client,
        operationService: this.bulkOperationService,
        requestIdFactory: this.clientRequestIdFactory
      });
      if (this.runtime === 'web' && supportsWebFolderControls(client) && (!this.folderService || !this.scanService)) {
        const services = createWebLibraryServices({ client, windowRef: this.windowRef });
        this.folderService ??= services.folderService;
        this.scanService ??= services.scanService;
      }
      if (this.runtime === 'electron' && supportsElectronFolderControls(client)) {
        this.folderService ??= client;
        this.scanService ??= client;
      }
      if (this.runtime === 'web' && supportsWebDurableOperations(client)) {
        this.bulkOperationService ??= client;
      }
      if (this.runtime === 'electron' && typeof client.subscribeScanEvents === 'function') {
        unsubscribeScanEvents = client.subscribeScanEvents(event => this.#publishScanState(event));
      } else if (this.runtime === 'web' && typeof client.subscribeScanProgress === 'function') {
        unsubscribeScanEvents = client.subscribeScanProgress(event => this.#publishScanState(event));
      }
      this.unsubscribeInvalidations = unsubscribeInvalidations;
      this.unsubscribeScanEvents = unsubscribeScanEvents;
      this.ready = true;
      this.#emit('ready', this.getRuntimeStatus());
      return this;
    } catch (error) {
      unsubscribeInvalidations?.();
      unsubscribeScanEvents?.();
      await Promise.resolve(client?.close?.()).catch(() => {});
      throw error;
    }
  }

  getRuntimeStatus() {
    return Object.freeze({
      ready: this.isReady,
      runtime: this.runtime,
      capabilities: this.capabilities,
      productionQualified: this.productionQualified
    });
  }

  addListener(eventName, listener) {
    if (typeof eventName !== 'string' || eventName.length === 0 || typeof listener !== 'function') {
      throw new TypeError('Library event name and listener are required');
    }
    let listeners = this.listeners.get(eventName);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(eventName, listeners);
    }
    if (listeners.size >= MAX_LISTENERS_PER_EVENT) {
      throw createRepositoryError('tooManyListeners', 'Library event listener limit reached', {
        eventName,
        maximum: MAX_LISTENERS_PER_EVENT
      });
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(eventName);
    };
  }

  subscribeInvalidations(listener) {
    return this.addListener('invalidation', listener);
  }

  async getCounts(request = {}) {
    await this.#ensureReady();
    return this.client.getCounts(request);
  }

  async createContext(request) {
    await this.#ensureReady();
    const normalized = normalizeContextRequest(request);
    const result = await this.client.createContext(normalized.clientRequest);
    const contextToken = typeof result === 'string' ? result : result?.contextToken;
    if (typeof contextToken !== 'string' || contextToken.length === 0) {
      throw createRepositoryError('invalidContext', 'Catalog client returned an invalid context token');
    }
    this.contexts.set(contextToken, {
      query: normalized.publicRequest,
      totalCount: Number.isSafeInteger(result?.totalCount) ? result.totalCount : null,
      cursorOrdinals: new Map([[null, 0]])
    });
    return contextToken;
  }

  async queryTracks(request = {}) {
    await this.#ensureReady();
    return this.#normalizePageResponse(
      request,
      await this.client.queryTracks(request)
    );
  }

  async queryEntities(request = {}) {
    await this.#ensureReady();
    if (typeof this.client.queryEntities === 'function') {
      return this.#normalizePageResponse(
        request,
        await this.client.queryEntities(request)
      );
    }
    const pageRequest = {
      contextToken: request.contextToken,
      cursor: request.cursor ?? null,
      limit: request.limit
    };
    return this.#normalizePageResponse(
      pageRequest,
      await this.client.readContextPage(pageRequest)
    );
  }

  async readContextPage(request = {}) {
    await this.#ensureReady();
    if (typeof this.client.readContextPage === 'function') {
      return this.#normalizePageResponse(
        request,
        await this.client.readContextPage(request)
      );
    }
    const context = this.#getContext(request.contextToken).query;
    const options = {
      ...context,
      contextToken: request.contextToken,
      cursor: request.cursor ?? null,
      limit: request.limit
    };
    if (context.endpoint === 'tracks') {
      return this.#normalizePageResponse(request, await this.client.queryTracks(options));
    }
    return this.#normalizePageResponse(request, await this.client.queryEntities({
      type: context.entityType,
      direction: context.direction,
      contextToken: request.contextToken,
      cursor: request.cursor ?? null,
      limit: request.limit
    }));
  }

  async readContextPageAtOrdinal(request = {}) {
    await this.#ensureReady();
    if (typeof this.client.readContextPageAtOrdinal !== 'function') {
      throw unavailable('readContextPageAtOrdinal', `${this.runtime} catalog client`);
    }
    const page = await this.client.readContextPageAtOrdinal(request);
    const totalCount = Number.isSafeInteger(page?.totalCount) ? page.totalCount : null;
    const limit = Number.isSafeInteger(request.limit) && request.limit > 0 ? request.limit : 200;
    const pageStartOrdinal = totalCount === null
      ? request.ordinal
      : Math.max(0, Math.min(request.ordinal, Math.max(0, totalCount - limit)));
    return this.#normalizePageResponse(request, page, pageStartOrdinal);
  }

  async getContextCount(request = {}) {
    await this.#ensureReady();
    if (typeof this.client.getContextCount !== 'function') return null;
    const result = await this.client.getContextCount(request);
    return Number.isSafeInteger(result) ? result : result?.totalCount;
  }

  async lookupContextTrack(request = {}) {
    await this.#ensureReady();
    if (typeof this.client.lookupContextTrack !== 'function') {
      throw unavailable('lookupContextTrack', `${this.runtime} catalog client`);
    }
    return this.client.lookupContextTrack(request);
  }

  async resolveEntityAnchor(request = {}) {
    await this.#ensureReady();
    if (typeof this.client.resolveEntityAnchor === 'function') {
      const result = await this.client.resolveEntityAnchor(request);
      if (!result) return null;
      if (!result.page && Number.isSafeInteger(result.ordinal) &&
          typeof this.client.readContextPageAtOrdinal === 'function') {
        const page = await this.readContextPageAtOrdinal({
          contextToken: request.contextToken,
          ordinal: result.ordinal,
          limit: request.limit ?? 200
        });
        return {
          ...result,
          accepted: true,
          found: true,
          pageStartOrdinal: page.pageStartOrdinal,
          page
        };
      }
      if (!result?.page) return result;
      const pageStartOrdinal = Number.isSafeInteger(result.pageStartOrdinal)
        ? result.pageStartOrdinal
        : Number.isSafeInteger(result.ordinal) ? result.ordinal : 0;
      return {
        ...result,
        pageStartOrdinal,
        page: this.#normalizePageResponse(request, result.page, pageStartOrdinal)
      };
    }
    const ordinal = request.anchor?.ordinal;
    if (request.fallback !== 'exact' || !Number.isSafeInteger(ordinal) || ordinal < 0 ||
        typeof this.client.readContextPageAtOrdinal !== 'function') {
      return { accepted: false, reason: 'seek-unavailable' };
    }
    const page = await this.readContextPageAtOrdinal({
      contextToken: request.contextToken,
      ordinal,
      limit: request.limit ?? 200
    });
    let resolvedOrdinal = ordinal;
    if (page.catalogVersion !== request.anchor?.snapshotVersion) {
      const entityId = request.anchor?.entityId;
      const rowIndex = page.rows.findIndex(row => getPageEntityId(row) === entityId);
      if (rowIndex < 0) return { accepted: false, reason: 'missing' };
      resolvedOrdinal = page.pageStartOrdinal + rowIndex;
    }
    return {
      accepted: true,
      found: true,
      ordinal: resolvedOrdinal,
      pageStartOrdinal: page.pageStartOrdinal,
      page
    };
  }

  async releaseContext(contextToken) {
    await this.#ensureReady();
    try {
      return await this.client.releaseContext(contextToken);
    } finally {
      this.contexts.delete(contextToken);
    }
  }

  async getTrack(trackUid) {
    await this.#ensureReady();
    return this.client.getTrack(trackUid);
  }

  async getArtworkThumbBlob(trackUid, { reason = 'viewport' } = {}) {
    await this.#ensureReady();
    if (typeof this.client.requestArtwork !== 'function') {
      throw unavailable('requestArtwork', `${this.runtime} catalog client`);
    }
    const result = await this.client.requestArtwork({ trackUid, reason });
    if (result?.kind !== 'thumbnail') return null;
    const bytes = result.bytes instanceof Uint8Array
      ? result.bytes
      : new Uint8Array(result.bytes ?? 0);
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_ARTWORK_THUMBNAIL_BYTES ||
        !['image/jpeg', 'image/webp'].includes(result.mimeType)) {
      throw createRepositoryError('invalidArtworkThumbnail', 'Library artwork thumbnail is invalid');
    }
    const BlobClass = this.windowRef?.Blob ?? globalThis.Blob;
    if (typeof BlobClass !== 'function') {
      throw createRepositoryError('artworkUnavailable', 'Blob artwork is unavailable in this runtime');
    }
    return new BlobClass([bytes], { type: result.mimeType });
  }

  async getArtworkThumbURL(trackUid, options = {}) {
    const key = String(trackUid || '');
    const cached = this.artworkUrlCache.get(key);
    if (cached) {
      this.artworkUrlCache.delete(key);
      this.artworkUrlCache.set(key, cached);
      return cached;
    }
    const blob = await this.getArtworkThumbBlob(trackUid, options);
    if (!blob) return '';
    const urlApi = this.windowRef?.URL ?? globalThis.URL;
    if (typeof urlApi?.createObjectURL !== 'function') {
      throw createRepositoryError('artworkUnavailable', 'Artwork object URLs are unavailable in this runtime');
    }
    const url = urlApi.createObjectURL(blob);
    this.artworkUrlCache.set(key, url);
    while (this.artworkUrlCache.size > MAX_ARTWORK_URL_CACHE_ENTRIES) {
      const [oldestKey, oldestUrl] = this.artworkUrlCache.entries().next().value;
      this.artworkUrlCache.delete(oldestKey);
      urlApi.revokeObjectURL?.(oldestUrl);
    }
    return url;
  }

  async resolvePlaybackSource(trackUid) {
    await this.#ensureReady();
    if (typeof this.client.resolvePlaybackSource !== 'function') {
      throw unavailable('resolvePlaybackSource', `${this.runtime} catalog client`);
    }
    return this.client.resolvePlaybackSource(trackUid);
  }

  addFolder(...args) {
    return this.#invokeService(this.folderService, 'addFolder', 'folderService', args);
  }

  removeFolder(...args) {
    return this.#invokeService(this.folderService, 'removeFolder', 'folderService', args);
  }

  requestFolderAccess(...args) {
    return this.#invokeService(this.folderService, 'requestFolderAccess', 'folderService', args);
  }

  scanFolders(...args) {
    return this.#invokeService(this.scanService, 'scanFolders', 'scanService', args);
  }

  cancelScan(...args) {
    return this.#invokeService(this.scanService, 'cancelScan', 'scanService', args);
  }

  getScanStatus(...args) {
    return this.#invokeService(this.scanService, 'getScanStatus', 'scanService', args);
  }

  performSelectionAction(operationKind, selectionDescriptor, request = {}) {
    if (typeof this.bulkOperationService?.start !== 'function') {
      return Promise.reject(unavailable(operationKind, 'bulkOperationService'));
    }
    return this.bulkOperationService.start({
      clientRequestId: request.clientRequestId ?? this.clientRequestIdFactory(),
      operationKind,
      selectionDescriptor,
      target: request.target ?? null,
      expectedTargetVersion: request.expectedTargetVersion ?? null,
      options: request.options ?? {}
    });
  }

  createOperationRequestId() {
    return this.clientRequestIdFactory();
  }

  lookupLibraryOperation(clientRequestId) {
    return this.#invokeService(this.bulkOperationService, 'lookupResult', 'bulkOperationService', [clientRequestId]);
  }

  getLibraryOperationStatus(operationId) {
    return this.#invokeService(this.bulkOperationService, 'status', 'bulkOperationService', [operationId]);
  }

  cancelLibraryOperation(operationId) {
    return this.#invokeService(this.bulkOperationService, 'cancel', 'bulkOperationService', [operationId]);
  }

  undoCancelledPlay(request) {
    return this.#invokeService(this.bulkOperationService, 'undoCancelledPlay', 'bulkOperationService', [request]);
  }

  subscribeLibraryOperation(operationId, listener) {
    if (typeof listener !== 'function') throw new TypeError('Operation listener is required');
    if (typeof this.bulkOperationService?.subscribeOperation === 'function') {
      return this.bulkOperationService.subscribeOperation(operationId, listener);
    }
    if (typeof this.bulkOperationService?.subscribeOperations === 'function') {
      return this.bulkOperationService.subscribeOperations(event => {
        if (event?.operationId === operationId || event?.progress?.operationId === operationId) listener(event);
      });
    }
    throw unavailable('subscribeOperation', 'bulkOperationService');
  }

  performRowAction(operationKind, payload) {
    return this.#invokeService(this.rowActionService, 'performRowAction', 'rowActionService', [
      operationKind,
      payload
    ]);
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.closePromise = this.#close();
    return this.closePromise;
  }

  async #close() {
    await Promise.resolve(this.initPromise).catch(() => {});
    this.unsubscribeInvalidations?.();
    this.unsubscribeInvalidations = null;
    this.unsubscribeScanEvents?.();
    this.unsubscribeScanEvents = null;
    const client = this.client;
    const contextTokens = [...this.contexts.keys()];
    this.contexts.clear();
    if (client) {
      await Promise.allSettled(contextTokens.map(contextToken => client.releaseContext(contextToken)));
      await Promise.resolve(client.close?.()).catch(error => {
        this.logger?.warn?.('Failed to close the v2 Library catalog client:', error);
      });
    }
    this.pendingInvalidation = null;
    this.#clearArtworkUrlCache();
    this.listeners.clear();
    this.ready = false;
    this.client = null;
  }

  destroy() {
    return this.close();
  }

  async #ensureReady() {
    if (!this.initPromise) await this.init();
    else await this.initPromise;
    if (!this.isReady || !this.client) {
      throw createRepositoryError('managerClosed', 'Library manager is unavailable');
    }
  }

  #getContext(contextToken) {
    const context = this.contexts.get(contextToken);
    if (!context) {
      throw createRepositoryError('invalidContext', 'Library context is not owned by this manager');
    }
    return context;
  }

  #normalizePageResponse(request, page, explicitStartOrdinal = null) {
    if (!page || !Array.isArray(page.rows)) return page;
    const context = this.contexts.get(request.contextToken);
    if (!context) {
      return Number.isSafeInteger(explicitStartOrdinal)
        ? { ...page, pageStartOrdinal: explicitStartOrdinal }
        : page;
    }
    const cursor = request.cursor ?? null;
    const knownStart = context.cursorOrdinals.get(cursor);
    const pageStartOrdinal = Number.isSafeInteger(page.pageStartOrdinal)
      ? page.pageStartOrdinal
      : Number.isSafeInteger(explicitStartOrdinal)
        ? explicitStartOrdinal
        : Number.isSafeInteger(knownStart) ? knownStart : 0;
    if (Number.isSafeInteger(page.totalCount)) context.totalCount = page.totalCount;
    if (page.nextCursor) {
      context.cursorOrdinals.set(page.nextCursor, pageStartOrdinal + page.rows.length);
    }
    if (page.previousCursor) {
      context.cursorOrdinals.set(
        page.previousCursor,
        Math.max(0, pageStartOrdinal - (request.limit ?? page.rows.length))
      );
    }
    return { ...page, pageStartOrdinal };
  }

  #invokeService(service, method, serviceName, args) {
    if (typeof service?.[method] !== 'function') {
      return Promise.reject(unavailable(method, serviceName));
    }
    return Promise.resolve(service[method](...args));
  }

  #queueInvalidation(event) {
    try {
      this.#clearArtworkUrlCache();
      this.pendingInvalidation = this.pendingInvalidation
        ? coalesceInvalidations(this.pendingInvalidation, event)
        : coalesceInvalidations(event);
    } catch (error) {
      this.logger?.warn?.('Ignored invalid Library catalog event:', error);
      return;
    }
    if (this.invalidationFlushQueued) return;
    this.invalidationFlushQueued = true;
    this.queueMicrotaskFn(() => this.#flushInvalidation());
  }

  #publishScanState(event) {
    try {
      const state = normalizeScanState(event);
      if (state.phase === 'error') {
        this.logger?.error?.('Music Library scan failed:', event?.error ?? state.error);
      }
      this.#emit('scan-state', state);
    } catch (error) {
      this.logger?.warn?.('Ignored invalid Library scan event:', error);
    }
  }

  #clearArtworkUrlCache() {
    const urlApi = this.windowRef?.URL ?? globalThis.URL;
    for (const url of this.artworkUrlCache.values()) urlApi?.revokeObjectURL?.(url);
    this.artworkUrlCache.clear();
  }

  #flushInvalidation() {
    this.invalidationFlushQueued = false;
    const event = this.pendingInvalidation;
    this.pendingInvalidation = null;
    if (!event || this.closed) return;
    this.#emit('invalidation', event);
    this.#emit('catalog-changed', event);
    if (event.changedScopes.some(scope => scope === 'folders' || scope.startsWith('folder:'))) {
      this.#emit('folders-changed', event);
    }
    if (event.changedScopes.some(scope => scope === 'playlists' || scope.startsWith('playlist:'))) {
      this.#emit('playlists-changed', event);
    }
  }

  #emit(eventName, payload) {
    const listeners = this.listeners.get(eventName);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(payload);
      } catch (error) {
        this.logger?.error?.(`Library ${eventName} listener failed:`, error);
      }
    }
  }
}

function getPageEntityId(row) {
  return row?.trackUid ?? row?.albumKey ?? row?.artistKey ?? row?.genreKey ??
    row?.folderId ?? row?.subfolderKey ?? row?.playlistId ?? row?.id ?? null;
}

function normalizeScanState(event = {}) {
  const source = event?.progress && typeof event.progress === 'object' ? event.progress : event;
  const counts = source.counts ?? aggregateScanResultCounts(event.results);
  const status = String(source.status ?? event.status ?? 'running');
  const error = event.error ?? source.error ?? null;
  const terminal = event.terminal === true || event.active === false || [
    'completed', 'completed-no-sweep', 'cancelled', 'paused', 'interrupted', 'failed'
  ].includes(status);
  const phase = error || status === 'failed'
    ? 'error'
    : terminal ? 'done' : 'scanning';
  return Object.freeze({
    ...event,
    ...source,
    phase,
    status,
    counts,
    found: Number(counts?.found ?? 0),
    parsed: Number(counts?.parsed ?? 0),
    error: error?.message ?? error ?? null
  });
}

function aggregateScanResultCounts(results) {
  const totals = {};
  for (const result of Array.isArray(results) ? results : []) {
    for (const [key, value] of Object.entries(result?.counts ?? {})) {
      if (Number.isFinite(value)) totals[key] = (totals[key] ?? 0) + value;
    }
  }
  return totals;
}

export function createLibraryManagerV2(options) {
  return new LibraryManagerV2(options);
}

function supportsWebFolderControls(client) {
  return ['addFolder', 'requestFolderAccess', 'removeFolder', 'scanFolders', 'cancelScan']
    .every(method => typeof client?.[method] === 'function');
}

function supportsElectronFolderControls(client) {
  return [
    'addFolder', 'requestFolderAccess', 'removeFolder', 'scanFolders',
    'cancelScan', 'getScanStatus'
  ].every(method => typeof client?.[method] === 'function');
}

function supportsWebDurableOperations(client) {
  return ['start', 'lookupResult', 'status', 'cancel']
    .every(method => typeof client?.[method] === 'function');
}
