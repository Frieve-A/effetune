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

export class PagedPlaylistService {
  constructor({ client, operationService = client, requestIdFactory, now = Date.now } = {}) {
    if (!client) throw new TypeError('client is required');
    if (typeof requestIdFactory !== 'function') throw new TypeError('requestIdFactory is required');
    this.client = client;
    this.operationService = operationService;
    this.requestIdFactory = requestIdFactory;
    this.now = now;
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

  previewImport(file, options = {}) {
    const electronGrant = file?.kind === 'electron-import-grant' &&
      typeof file.token === 'string' && typeof file.name === 'string' && Number.isSafeInteger(file.size);
    if (!file || typeof file.stream !== 'function' && !electronGrant) {
      throw new TypeError('Playlist import requires a streaming File');
    }
    return requireMethod(this.operationService, 'previewPlaylistImport')({
      clientRequestId: options.clientRequestId ?? this.requestIdFactory(),
      playlistId: options.playlistId ?? this.requestIdFactory(),
      name: options.name ?? playlistNameFromFile(file.name),
      source: file,
      encoding: options.encoding ?? null,
      limits: options.limits ?? null
    });
  }

  commitImport(preview) {
    const request = playlistImportPreviewIdentity(preview);
    return requireMethod(this.operationService, 'commitPlaylistImportPreview')(request);
  }

  cancelImportPreview(preview) {
    const request = playlistImportPreviewIdentity(preview);
    return requireMethod(this.operationService, 'cancelPlaylistImportPreview')(request);
  }

  async exportToSink(playlistId, { format = 'm3u8', sink, relative = true, destinationPath = sink?.destinationPath, limits } = {}) {
    if (!sink || typeof sink.write !== 'function' || typeof sink.commit !== 'function' ||
        typeof sink.abort !== 'function') {
      throw new TypeError('Atomic playlist export sink is required');
    }
    const summary = { exportedCount: 0, skippedCueCount: 0 };
    const entries = this.#exportEntries(playlistId, { relative, destinationPath }, summary);
    const chunks = format === 'xspf'
      ? serializeXSPFStream(entries, { fileUris: !relative, limits })
      : serializeM3U8Stream(entries, { limits });
    try {
      for await (const chunk of chunks) await sink.write(chunk);
      await sink.commit();
      return summary;
    } catch (error) {
      await Promise.resolve(sink.abort(error)).catch(() => {});
      throw error;
    }
  }

  async *#exportEntries(playlistId, { relative, destinationPath }, summary) {
    let afterPosition = 0;
    for (;;) {
      const page = await this.queryItems(playlistId, {
        afterPosition,
        limit: PLAYLIST_APPLICATION_PAGE_SIZE
      });
      for (const item of page.items ?? []) {
        if (item.trackUid) {
          const track = await this.client.getTrack(item.trackUid);
          if (!track) continue;
          if (hasCueTrackProvenance(track)) {
            summary.skippedCueCount += 1;
            continue;
          }
          const source = await requireMethod(this.client, 'resolvePlaylistExportSource')(item.trackUid);
          if (!source) continue;
          if (hasCueTrackProvenance(source)) {
            summary.skippedCueCount += 1;
            continue;
          }
          const sourcePath = playlistExportSourcePath(source);
          const path = source.kind === 'absolute-path' && relative
            ? relativePlaylistPath(sourcePath, destinationPath)
            : sourcePath;
          yield {
            ...track,
            path,
            relative: source.kind === 'portable-relative' || relative && !isAbsolutePlaylistPath(path)
          };
          summary.exportedCount += 1;
        } else if (item.unresolved) {
          if (hasCueTrackProvenance(item.unresolved)) {
            summary.skippedCueCount += 1;
            continue;
          }
          const sourcePath = item.unresolved.sourceLine ?? item.unresolved.relativePathHint ?? '';
          if (!sourcePath) continue;
          const path = relative ? relativePlaylistPath(sourcePath, destinationPath) : sourcePath;
          yield {
            unresolved: { ...item.unresolved, sourceLine: path },
            relative: relative && !isAbsolutePlaylistPath(path)
          };
          summary.exportedCount += 1;
        }
      }
      if (!Number.isSafeInteger(page.nextPosition)) break;
      afterPosition = page.nextPosition;
    }
  }
}

export function hasCueTrackProvenance(value) {
  return [value, value?.cueProvenance, value?.cue_provenance].filter(Boolean).some(provenance => {
    const sourceKind = provenance.sourceKind ?? provenance.source_kind;
    const entryKey = provenance.entryKey ?? provenance.entry_key;
    const startFrame = provenance.startFrame ?? provenance.start_frame;
    return sourceKind === 'cue-track' ||
      typeof entryKey === 'string' && entryKey.startsWith('cue:') ||
      Number.isSafeInteger(startFrame) && startFrame >= 0;
  });
}

function playlistImportPreviewIdentity(preview) {
  if (!preview || typeof preview.previewToken !== 'string' || !preview.previewToken ||
      typeof preview.playlistId !== 'string' || !preview.playlistId) {
    throw new TypeError('Playlist import preview is invalid');
  }
  return { previewToken: preview.previewToken, playlistId: preview.playlistId };
}

function playlistExportSourcePath(source) {
  if (source?.kind === 'absolute-path' && isAbsolutePlaylistPath(source.path)) return source.path;
  if (source?.kind === 'portable-relative' && !isAbsolutePlaylistPath(source.path)) {
    const rootName = portableRootName(source.rootName);
    const relativePath = String(source.path || '').replaceAll('\\', '/').replace(/^\/+/, '');
    if (relativePath && !relativePath.split('/').some(segment => !segment || segment === '.' || segment === '..')) {
      return rootName ? `${rootName}/${relativePath}` : relativePath;
    }
  }
  throw createRepositoryError('sourceUnavailable', 'Playlist track source is unavailable');
}

function portableRootName(value) {
  const name = String(value || '').trim().replace(/[\\/]+/g, '_');
  return name === '.' || name === '..' ? '' : name;
}

export function createPagedPlaylistService(options) {
  return new PagedPlaylistService(options);
}
