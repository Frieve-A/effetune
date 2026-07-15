import { createRepositoryError } from '../repository/contract-errors.js';
import {
  serializeM3U8Stream,
  serializeXSPFStream
} from './playlist-stream.js';

export const PLAYLIST_APPLICATION_BATCH_SIZE = 500;
export const PLAYLIST_APPLICATION_PAGE_SIZE = 500;

function requireMethod(target, method) {
  if (typeof target?.[method] !== 'function') {
    throw createRepositoryError('operationUnavailable', `Playlist operation ${method} is unavailable`, {
      operation: method
    });
  }
  return target[method].bind(target);
}

function playlistNameFromFile(fileName) {
  return String(fileName || 'Playlist').replace(/\.(m3u8?|pls|xspf)$/i, '').trim() || 'Playlist';
}

function isAbsolutePlaylistPath(value) {
  const path = String(value || '').replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(path) || path.startsWith('/') || path.startsWith('//');
}

function relativePlaylistPath(sourcePath, destinationPath) {
  const source = String(sourcePath || '').replace(/\\/g, '/');
  const destination = String(destinationPath || '').replace(/\\/g, '/');
  if (!source || !destination || !isAbsolutePlaylistPath(source)) return source;
  const sourceRoot = source.match(/^(?:[A-Za-z]:|\/\/[^/]+\/[^/]+)/)?.[0] ?? '/';
  const destinationRoot = destination.match(/^(?:[A-Za-z]:|\/\/[^/]+\/[^/]+)/)?.[0] ?? '/';
  const caseInsensitive = sourceRoot !== '/';
  const comparable = value => caseInsensitive ? value.toLocaleLowerCase('en-US') : value;
  if (comparable(sourceRoot) !== comparable(destinationRoot)) return source;
  const sourceParts = source.slice(sourceRoot.length).split('/').filter(Boolean);
  const destinationParts = destination.slice(destinationRoot.length).split('/').filter(Boolean);
  destinationParts.pop();
  let shared = 0;
  while (shared < sourceParts.length && shared < destinationParts.length &&
      comparable(sourceParts[shared]) === comparable(destinationParts[shared])) {
    shared += 1;
  }
  const relative = [
    ...Array.from({ length: destinationParts.length - shared }, () => '..'),
    ...sourceParts.slice(shared)
  ].join('/');
  return relative || sourceParts.at(-1) || source;
}

function terminalOperationResult(terminal, operationId) {
  if (terminal?.state === 'succeeded') return terminal.result;
  const state = terminal?.state ?? 'failed';
  const code = terminal?.code ?? (state === 'cancelled' ? 'cancelled' : 'operationFailed');
  throw createRepositoryError(code, `Playlist import ${state}`, { operationId, state });
}

function waitForOperationTerminal(service, operationId, { onProgress } = {}) {
  const status = requireMethod(service, 'status');
  const subscribe = typeof service?.subscribeOperation === 'function'
    ? listener => service.subscribeOperation(operationId, listener)
    : typeof service?.subscribeOperations === 'function'
      ? listener => service.subscribeOperations(listener)
      : null;
  if (!subscribe) {
    throw createRepositoryError('operationUnavailable', 'Playlist import operation events are unavailable');
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const finish = callback => {
      if (settled) return;
      settled = true;
      unsubscribe();
      try {
        resolve(callback());
      } catch (error) {
        reject(error);
      }
    };
    const fail = error => {
      if (settled) return;
      settled = true;
      unsubscribe();
      reject(error);
    };
    const listener = event => {
      if (!event) return;
      if (event.kind === 'progress' && event.progress?.operationId === operationId) {
        onProgress?.(event.progress);
      } else if (event.kind === 'terminal' && event.operationId === operationId) {
        finish(() => terminalOperationResult(event.result, operationId));
      }
    };
    try {
      const removeListener = subscribe(listener);
      if (typeof removeListener !== 'function') {
        throw createRepositoryError('operationUnavailable', 'Playlist import event subscription is invalid');
      }
      unsubscribe = removeListener;
      if (settled) unsubscribe();
    } catch (error) {
      fail(error);
      return;
    }
    Promise.resolve(status(operationId)).then(current => {
      if (settled) return;
      if (!current) {
        fail(createRepositoryError('operationNotFound', 'Playlist import operation was not found', { operationId }));
        return;
      }
      if (current.progress) onProgress?.(current.progress);
      if (current.terminalKind || current.result?.state) {
        finish(() => terminalOperationResult(current.result, operationId));
      }
    }, fail);
  });
}

export class PagedPlaylistService {
  constructor({ client, operationService = client, requestIdFactory, now = Date.now } = {}) {
    if (!client) throw new TypeError('client is required');
    if (typeof requestIdFactory !== 'function') throw new TypeError('requestIdFactory is required');
    this.client = client;
    this.operationService = operationService;
    this.requestIdFactory = requestIdFactory;
    this.now = now;
  }

  async listPage({ cursor = null, limit = 200 } = {}) {
    const context = await this.openListContext();
    try {
      return await this.readListContext(context.contextToken, { cursor, limit });
    } finally {
      await this.releaseListContext(context.contextToken);
    }
  }

  async openListContext({ query = '' } = {}) {
    const contextResult = await this.client.createContext({
      endpoint: 'entities:playlist',
      query: String(query || '').trim(),
      sort: 'name',
      direction: 'asc',
      scope: null
    });
    const contextToken = typeof contextResult === 'string' ? contextResult : contextResult?.contextToken;
    if (typeof contextToken !== 'string' || !contextToken) {
      throw createRepositoryError('invalidContext', 'Playlist picker context could not be created');
    }
    return { contextToken };
  }

  readListContext(contextToken, { cursor = null, limit = 200 } = {}) {
    return this.client.queryEntities({
      type: 'playlist',
      contextToken,
      cursor,
      limit: Math.max(1, Math.min(500, limit))
    });
  }

  releaseListContext(contextToken) {
    return this.client.releaseContext(contextToken);
  }

  async list(options = {}) {
    const page = await this.listPage(options);
    return page.rows;
  }

  queryItems(playlistId, { afterPosition = 0, limit = PLAYLIST_APPLICATION_PAGE_SIZE } = {}) {
    return requireMethod(this.client, 'queryPlaylistItems')({
      playlistId,
      afterPosition,
      limit: Math.max(1, Math.min(500, limit))
    });
  }

  async get(playlistId) {
    const page = await this.queryItems(playlistId, { limit: 1 });
    return page.playlist;
  }

  async create(name, items = []) {
    const playlistId = this.requestIdFactory();
    const normalizedItems = items.map(item => {
      if (typeof item === 'string') return { trackUid: item };
      if (item?.trackUid != null) return { trackUid: item.trackUid };
      if (item?.trackId != null) return { trackUid: item.trackId };
      return item;
    });
    const method = normalizedItems.length ? 'createPlaylistWithItems' : 'createPlaylist';
    const result = await requireMethod(this.client, method)({
      playlistId,
      name,
      operationId: null,
      ...(normalizedItems.length ? { items: normalizedItems } : {}),
      createdAt: this.now()
    });
    return { ...result, playlistId };
  }

  async rename(playlistId, name, options = {}) {
    const playlist = options.playlist ?? await this.get(playlistId);
    return requireMethod(this.client, 'renamePlaylist')({
      playlistId,
      name,
      expectedVersion: options.expectedVersion ?? playlist.version,
      updatedAt: this.now()
    });
  }

  async duplicate(playlistId, name, options = {}) {
    const playlist = options.playlist ?? await this.get(playlistId);
    const targetPlaylistId = options.targetPlaylistId ?? this.requestIdFactory();
    const result = await requireMethod(this.client, 'duplicatePlaylist')({
      playlistId,
      targetPlaylistId,
      name,
      expectedVersion: options.expectedVersion ?? playlist.version,
      createdAt: this.now()
    });
    return { ...result, playlistId: targetPlaylistId, id: targetPlaylistId };
  }

  async reorderItem(playlistId, itemKey, target, options = {}) {
    const playlist = options.playlist ?? await this.get(playlistId);
    return requireMethod(this.client, 'reorderPlaylistItem')({
      playlistId,
      itemKey,
      target,
      expectedVersion: options.expectedVersion ?? playlist.version,
      updatedAt: this.now()
    });
  }

  async removeItem(playlistId, itemKey, options = {}) {
    const playlist = options.playlist ?? await this.get(playlistId);
    return requireMethod(this.client, 'removePlaylistItem')({
      playlistId,
      itemKey,
      expectedVersion: options.expectedVersion ?? playlist.version,
      updatedAt: this.now()
    });
  }

  replaceItems() {
    return Promise.reject(createRepositoryError(
      'operationUnavailable',
      'Full-array playlist replacement is disabled in the paged Library'
    ));
  }

  async delete(playlistId, options = {}) {
    const playlist = options.playlist ?? await this.get(playlistId);
    return requireMethod(this.client, 'tombstonePlaylist')({
      playlistId,
      expectedVersion: options.expectedVersion ?? playlist.version,
      updatedAt: this.now()
    });
  }

  addTracks(playlistId, selectionDescriptor, options = {}) {
    return requireMethod(this.operationService, 'start')({
      clientRequestId: options.clientRequestId ?? this.requestIdFactory(),
      operationKind: 'addToPlaylist',
      selectionDescriptor,
      target: { playlistId },
      expectedTargetVersion: options.expectedTargetVersion ?? null,
      options: options.options ?? {}
    });
  }

  async importFile(file, options = {}) {
    const electronGrant = file?.kind === 'electron-import-grant' &&
      typeof file.token === 'string' && typeof file.name === 'string' && Number.isSafeInteger(file.size);
    if (!file || typeof file.stream !== 'function' && !electronGrant) {
      throw new TypeError('Playlist import requires a streaming File');
    }
    const playlistId = options.playlistId ?? this.requestIdFactory();
    const receipt = await requireMethod(this.operationService, 'start')({
      clientRequestId: options.clientRequestId ?? this.requestIdFactory(),
      operationKind: 'importPlaylist',
      selectionDescriptor: null,
      target: { playlistId },
      expectedTargetVersion: 0,
      options: {
        name: options.name ?? playlistNameFromFile(file.name),
        source: file,
        encoding: options.encoding ?? null,
        limits: options.limits ?? null
      }
    });
    if (receipt?.kind === 'terminal') {
      return terminalOperationResult(receipt.result, receipt.operationId ?? null);
    }
    if (!['started', 'active'].includes(receipt?.kind) || typeof receipt.operationId !== 'string') {
      const code = receipt?.kind === 'requestIdReuse' ? 'requestIdReuse' :
        receipt?.kind === 'insufficientStorage' ? 'insufficientStorage' :
          receipt?.kind === 'busy' ? 'busy' : 'invalidOperationReceipt';
      throw createRepositoryError(code, 'Playlist import could not start', { receipt });
    }
    const result = await waitForOperationTerminal(this.operationService, receipt.operationId, options);
    return { ...result, playlistId: result?.playlistId ?? playlistId };
  }

  async exportToSink(playlistId, { format = 'm3u8', sink, relative = true, destinationPath = sink?.destinationPath, limits } = {}) {
    if (!sink || typeof sink.write !== 'function' || typeof sink.commit !== 'function' ||
        typeof sink.abort !== 'function') {
      throw new TypeError('Atomic playlist export sink is required');
    }
    const entries = this.#exportEntries(playlistId, { relative, destinationPath });
    const chunks = format === 'xspf'
      ? serializeXSPFStream(entries, { fileUris: !relative, limits })
      : serializeM3U8Stream(entries, { limits });
    try {
      for await (const chunk of chunks) await sink.write(chunk);
      await sink.commit();
    } catch (error) {
      await Promise.resolve(sink.abort(error)).catch(() => {});
      throw error;
    }
  }

  async *#exportEntries(playlistId, { relative, destinationPath }) {
    let afterPosition = 0;
    for (;;) {
      const page = await this.queryItems(playlistId, {
        afterPosition,
        limit: PLAYLIST_APPLICATION_PAGE_SIZE
      });
      for (const item of page.items ?? []) {
        if (item.trackUid) {
          const track = await this.client.getTrack(item.trackUid);
          if (track) {
            const sourcePath = track.path ?? track.filePath ?? track.relativePath;
            const path = relative ? relativePlaylistPath(sourcePath, destinationPath) : sourcePath;
            yield { ...track, path, relative: relative && !isAbsolutePlaylistPath(path) };
          }
        } else if (item.unresolved) {
          const sourcePath = item.unresolved.sourceLine ?? item.unresolved.relativePathHint ?? '';
          const path = relative ? relativePlaylistPath(sourcePath, destinationPath) : sourcePath;
          yield {
            unresolved: { ...item.unresolved, sourceLine: path },
            relative: relative && !isAbsolutePlaylistPath(path)
          };
        }
      }
      if (!Number.isSafeInteger(page.nextPosition)) break;
      afterPosition = page.nextPosition;
    }
  }
}

export function createPagedPlaylistService(options) {
  return new PagedPlaylistService(options);
}
