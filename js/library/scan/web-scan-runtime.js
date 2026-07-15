import { BoundedScanService } from './bounded-scan-service.js';
import { LazyArtworkService } from '../artwork/lazy-artwork-service.js';
import { WebArtworkExtractor } from '../artwork/web-artwork-extractor.js';
import {
  compareFolderRoots,
  isSameFolderRoot,
  queryFolderPermission,
  WebFileSystemScanAdapter
} from './web-file-system-adapter.js';
import { assertDirectoryHandle, WebFolderHandleStore } from './web-folder-handle-store.js';
import { WebMetadataParser } from './web-metadata-parser.js';
import { WebSessionFileSource } from './web-session-file-source.js';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';
import {
  AutomaticPlaylistCollector,
  importAutomaticPlaylists
} from '../playlists/automatic-playlist-import.js';

const MAX_WEB_FOLDERS = 1_000;
const FOLDER_REMOVAL_POLL_INTERVAL_MS = 250;

export class WebCatalogScanRuntime {
  constructor({
    repository,
    handleStore = new WebFolderHandleStore(),
    filesystemFactory = (handle, options) => new WebFileSystemScanAdapter({ rootHandle: handle, ...options }),
    metadataParserFactory = (filesystem, options) => new WebMetadataParser({ filesystem, ...options }),
    scanServiceFactory = options => new BoundedScanService(options),
    playlistImportService = null,
    idFactory = defaultId,
    onProgress = () => {},
    onFolderRemoval = () => {}
  } = {}) {
    assertMethods(repository, [
      'upsertFolders', 'listFolderRecords', 'setFolderAvailability',
      'tombstoneFolder', 'runFolderDeletion', 'getScanFolderTrackCount'
    ]);
    this.repository = repository;
    this.handleStore = handleStore;
    this.filesystemFactory = filesystemFactory;
    this.metadataParserFactory = metadataParserFactory;
    this.scanServiceFactory = scanServiceFactory;
    this.playlistImportService = playlistImportService;
    this.idFactory = idFactory;
    this.onProgress = onProgress;
    this.onFolderRemoval = onFolderRemoval;
    this.activeScans = new Map();
    this.folderScanTails = new Map();
    this.artworkFilesystems = new Map();
    this.sessionSources = new Map();
    this.pendingSessionSources = new Map();
    this.folderRemovalMonitors = new Map();
    this.artworkService = null;
  }

  setPlaylistImportService(service) {
    this.playlistImportService = service;
  }

  async initializePermissions() {
    const folders = await this.repository.listFolderRecords({ includeRemoved: true, limit: MAX_WEB_FOLDERS });
    for (const folder of folders) {
      if (folder.status !== 'removed') continue;
      const total = normalizeFolderTrackCount(await this.repository.getScanFolderTrackCount({ folderId: folder.id }));
      if (total > 0) this.#startFolderRemovalMonitor(folder.id, total);
    }
    const activeFolderIds = new Set(folders.filter(folder => folder.status !== 'removed').map(folder => folder.id));
    const storedHandles = await this.handleStore.list({ limit: MAX_WEB_FOLDERS });
    let cleaned = 0;
    for (const stored of storedHandles) {
      if (activeFolderIds.has(stored.folderId)) continue;
      await this.handleStore.delete(stored.folderId);
      cleaned += 1;
    }
    for (const folder of folders) {
      if (folder.status === 'removed') continue;
      if (folder.kind === 'web-session') {
        if (folder.status !== 'needs-permission') {
          await this.repository.setFolderAvailability({ folderId: folder.id, status: 'needs-permission' });
        }
        continue;
      }
      const handle = await this.handleStore.get(folder.id);
      const status = handle && await queryFolderPermission(handle) === 'granted'
        ? 'active'
        : 'needs-permission';
      if (folder.status !== status) await this.repository.setFolderAvailability({ folderId: folder.id, status });
    }
    return { checked: activeFolderIds.size, cleaned };
  }

  async addFolder({ handle, displayName, scan = true, scanReason = 'automatic', languageHints = null } = {}) {
    assertDirectoryHandle(handle);
    const folders = await this.repository.listFolderRecords({ includeRemoved: true, limit: MAX_WEB_FOLDERS });
    const activeFolders = new Map(
      folders.filter(folder => folder.status !== 'removed').map(folder => [folder.id, folder])
    );
    const storedHandles = await this.handleStore.list({ limit: MAX_WEB_FOLDERS });
    const existingHandles = [];
    for (const existing of storedHandles) {
      const folder = activeFolders.get(existing.folderId);
      if (!folder) {
        await this.handleStore.delete(existing.folderId);
        continue;
      }
      existingHandles.push({ ...existing, folder });
    }
    const contained = [];
    for (const existing of existingHandles) {
      const relation = await compareFolderRoots(handle, existing.handle);
      if (relation === 'same' || relation === 'descendant') {
        return {
          canceled: false,
          rejected: true,
          reason: relation === 'same' ? 'same-root' : 'descendant-root',
          candidate: { displayName: String(displayName ?? handle.name ?? 'Music') },
          existing: { id: existing.folder.id, displayName: existing.folder.displayName }
        };
      }
      if (relation === 'ancestor') {
        contained.push({ id: existing.folder.id, displayName: existing.folder.displayName });
      }
    }
    if (contained.length > 0) {
      return {
        canceled: false,
        confirmationRequired: true,
        candidate: { displayName: String(displayName ?? handle.name ?? 'Music') },
        contained
      };
    }
    const folderId = `web-folder-${this.idFactory()}`;
    const permission = await queryFolderPermission(handle);
    const folder = {
      id: folderId,
      kind: 'web-fsa',
      displayName: String(displayName ?? handle.name ?? 'Music'),
      normalizedRoot: `fsa:${folderId}`,
      status: permission === 'granted' ? 'active' : 'needs-permission',
      lifecycleVersion: 0
    };
    await this.handleStore.put({ folderId, handle });
    try {
      await this.repository.upsertFolders([folder]);
    } catch (error) {
      await this.handleStore.delete(folderId).catch(() => {});
      throw error;
    }
    if (!scan || permission !== 'granted') {
      return { folder, scan: null };
    }
    const scanId = `web-scan-${this.idFactory()}`;
    const result = await this.#runFolder({ scanId, folder, source: handle, scanReason, resume: false, languageHints });
    return { folder, scan: result };
  }

  async beginSessionFolder({ folderId = null, displayName = 'Imported Folder' } = {}) {
    const token = `web-session-${this.idFactory()}`;
    let folder = null;
    if (folderId !== null) {
      folder = (await this.repository.listFolderRecords({ includeRemoved: false, limit: MAX_WEB_FOLDERS }))
        .find(row => row.id === folderId) ?? null;
      assertRepositoryContract(folder, 'unknownFolder', 'Folder does not exist');
      assertRepositoryContract(folder.kind === 'web-session', 'folderRebindMismatch', 'Selected files do not match this folder type');
    }
    this.pendingSessionSources.set(token, {
      folder,
      displayName: String(displayName || folder?.displayName || 'Imported Folder'),
      source: new WebSessionFileSource()
    });
    return { token, folderId: folder?.id ?? null };
  }

  appendSessionFolderFiles({ token, entries } = {}) {
    return this.#requirePendingSessionSource(token).source.add(entries);
  }

  async commitSessionFolder({
    token,
    scan = true,
    scanReason = 'automatic',
    languageHints = null
  } = {}) {
    const pending = this.#requirePendingSessionSource(token);
    assertRepositoryContract(pending.source.size > 0, 'invalidSessionFiles', 'At least one folder file is required');
    let folder = pending.folder;
    if (!folder) {
      const folderId = `web-folder-${this.idFactory()}`;
      folder = {
        id: folderId,
        kind: 'web-session',
        displayName: pending.displayName,
        normalizedRoot: `session:${folderId}`,
        status: 'active',
        lifecycleVersion: 0
      };
      await this.repository.upsertFolders([folder]);
    } else if (folder.status !== 'active') {
      folder = await this.repository.setFolderAvailability({ folderId: folder.id, status: 'active' });
    }
    this.sessionSources.set(folder.id, pending.source);
    this.artworkFilesystems.delete(folder.id);
    this.pendingSessionSources.delete(token);
    const result = scan
      ? await this.#runFolder({
          scanId: `web-scan-${this.idFactory()}`,
          folder,
          source: pending.source,
          scanReason,
          resume: false,
          languageHints
        })
      : null;
    return { folder, existing: Boolean(pending.folder), scan: result };
  }

  abortSessionFolder({ token } = {}) {
    return { aborted: this.pendingSessionSources.delete(String(token || '')) };
  }

  async scanFolders({
    folderIds = null,
    scanId = null,
    scanReason = 'automatic',
    resume = false,
    languageHints = null
  } = {}) {
    const folders = await this.repository.listFolderRecords({ limit: MAX_WEB_FOLDERS });
    const selected = folderIds == null
      ? folders
      : folders.filter(folder => folderIds.includes(folder.id));
    assertRepositoryContract(selected.length > 0, 'unknownFolder', 'No matching Web folder is available to scan');
    assertRepositoryContract(!scanId || selected.length === 1, 'invalidScanRequest', 'An explicit scanId can target only one folder');
    const results = [];
    for (const folder of selected) {
      if (folder.kind === 'web-session') {
        const source = this.sessionSources.get(folder.id);
        if (!source) {
          if (folder.status !== 'needs-permission') {
            await this.repository.setFolderAvailability({ folderId: folder.id, status: 'needs-permission' });
          }
          results.push({ folderId: folder.id, status: 'needs-permission' });
          continue;
        }
        if (folder.status !== 'active') {
          await this.repository.setFolderAvailability({ folderId: folder.id, status: 'active' });
        }
        results.push(await this.#runFolder({
          scanId: scanId ?? `web-scan-${this.idFactory()}`,
          folder: { ...folder, status: 'active' },
          source,
          scanReason,
          resume,
          languageHints
        }));
        continue;
      }
      const handle = await this.handleStore.get(folder.id);
      const permission = handle ? await queryFolderPermission(handle) : 'needs-permission';
      if (permission !== 'granted') {
        if (folder.status !== 'needs-permission') {
          await this.repository.setFolderAvailability({ folderId: folder.id, status: 'needs-permission' });
        }
        results.push({ folderId: folder.id, status: 'needs-permission' });
        continue;
      }
      if (folder.status !== 'active') await this.repository.setFolderAvailability({ folderId: folder.id, status: 'active' });
      results.push(await this.#runFolder({
        scanId: scanId ?? `web-scan-${this.idFactory()}`,
        folder: { ...folder, status: 'active' },
        source: handle,
        scanReason,
        resume,
        languageHints
      }));
    }
    return { results };
  }

  cancelScan({ scanId } = {}) {
    const active = this.activeScans.get(scanId);
    if (!active) return { accepted: false };
    active.controller.abort(new DOMException('Scan canceled', 'AbortError'));
    return { accepted: true };
  }

  async requestFolderAccess({ folderId, handle } = {}) {
    assertDirectoryHandle(handle);
    const folder = (await this.repository.listFolderRecords({ limit: MAX_WEB_FOLDERS }))
      .find(row => row.id === folderId);
    assertRepositoryContract(folder, 'unknownFolder', 'Folder does not exist');
    const previous = await this.handleStore.get(folderId);
    if (previous) {
      assertRepositoryContract(
        await isSameFolderRoot(handle, previous),
        'folderRebindMismatch',
        'Selected folder is not the original Library root'
      );
    }
    assertRepositoryContract(await queryFolderPermission(handle) === 'granted', 'folderPermissionRequired', 'Folder read permission was not granted');
    await this.handleStore.put({ folderId, handle });
    const updated = await this.repository.setFolderAvailability({ folderId, status: 'active' });
    return { folder: updated };
  }

  async removeFolder({ folderId } = {}) {
    for (const active of this.activeScans.values()) {
      if (active.folderId === folderId) active.controller.abort(new DOMException('Folder removed', 'AbortError'));
    }
    const folder = (await this.repository.listFolderRecords({ limit: MAX_WEB_FOLDERS }))
      .find(row => row.id === folderId);
    assertRepositoryContract(folder, 'unknownFolder', 'Folder does not exist');
    const total = normalizeFolderTrackCount(await this.repository.getScanFolderTrackCount({ folderId }));
    this.#startFolderRemovalMonitor(folderId, total);
    try {
      const tombstoned = await this.repository.tombstoneFolder({
        folderId,
        expectedLifecycleVersion: folder.lifecycleVersion
      });
      await this.handleStore.delete(folderId).catch(() => {});
      this.sessionSources.delete(folderId);
      this.artworkFilesystems.delete(folderId);
      let deletion = tombstoned.deletion ?? { deleted: 0, hasMore: true };
      let deleted = deletion.deleted ?? 0;
      while (deletion.hasMore === true) {
        await new Promise(resolve => setTimeout(resolve, 0));
        deletion = await this.repository.runFolderDeletion({
          folderId,
          lifecycleVersion: tombstoned.folder.lifecycleVersion
        });
        deleted += deletion.deleted ?? 0;
      }
      deletion = { ...deletion, deleted };
      this.#finishFolderRemovalMonitor(folderId, total);
      return { folder: tombstoned.folder, deletion };
    } catch (error) {
      this.#failFolderRemovalMonitor(folderId, total);
      throw error;
    }
  }

  async requestArtwork({ trackUid, reason = 'viewport' } = {}) {
    const track = await this.repository.getTrackStorageIdentity(trackUid);
    if (!track) return { kind: 'placeholder' };
    let filesystem = this.artworkFilesystems.get(track.folderId);
    if (!filesystem) {
      const sessionSource = this.sessionSources.get(track.folderId);
      if (sessionSource) filesystem = sessionSource.createAdapter();
      else {
        const handle = await this.handleStore.get(track.folderId);
        if (!handle || await queryFolderPermission(handle) !== 'granted') return { kind: 'placeholder' };
        filesystem = this.filesystemFactory(handle);
      }
      this.artworkFilesystems.set(track.folderId, filesystem);
    }
    if (!this.artworkService) {
      const quotaBytes = Math.max(0, Math.floor((await globalThis.navigator?.storage?.estimate?.())?.quota ?? 0));
      this.artworkService = new LazyArtworkService({
        repository: this.repository,
        extractor: new WebArtworkExtractor({
          filesystemForFolder: folderId => this.artworkFilesystems.get(folderId)
        }),
        runtime: 'web',
        quotaBytes
      });
    }
    return this.artworkService.request({ trackUid, reason });
  }

  close() {
    for (const active of this.activeScans.values()) {
      active.controller.abort(new DOMException('Catalog Worker closed', 'AbortError'));
    }
    this.activeScans.clear();
    this.folderScanTails.clear();
    this.artworkFilesystems.clear();
    this.sessionSources.clear();
    this.pendingSessionSources.clear();
    for (const monitor of this.folderRemovalMonitors.values()) clearTimeout(monitor.timer);
    this.folderRemovalMonitors.clear();
    this.artworkService = null;
    this.handleStore.close?.();
  }

  #startFolderRemovalMonitor(folderId, total) {
    if (total <= 0 || this.folderRemovalMonitors.has(folderId)) return;
    const monitor = { total, timer: null };
    this.folderRemovalMonitors.set(folderId, monitor);
    this.onFolderRemoval({ folderId, phase: 'removing', deleted: 0, total });
    const poll = async () => {
      if (this.folderRemovalMonitors.get(folderId) !== monitor) return;
      try {
        const remaining = normalizeFolderTrackCount(
          await this.repository.getScanFolderTrackCount({ folderId })
        );
        if (remaining === 0) {
          this.#finishFolderRemovalMonitor(folderId, total);
          return;
        }
        this.onFolderRemoval({
          folderId,
          phase: 'removing',
          deleted: Math.max(0, total - remaining),
          total
        });
        monitor.timer = setTimeout(poll, FOLDER_REMOVAL_POLL_INTERVAL_MS);
      } catch {
        this.#failFolderRemovalMonitor(folderId, total);
      }
    };
    monitor.timer = setTimeout(poll, FOLDER_REMOVAL_POLL_INTERVAL_MS);
  }

  #finishFolderRemovalMonitor(folderId, total) {
    const monitor = this.folderRemovalMonitors.get(folderId);
    if (monitor) clearTimeout(monitor.timer);
    this.folderRemovalMonitors.delete(folderId);
    if (total > 0) this.onFolderRemoval({ folderId, phase: 'done', deleted: total, total });
  }

  #failFolderRemovalMonitor(folderId, total) {
    const monitor = this.folderRemovalMonitors.get(folderId);
    if (monitor) clearTimeout(monitor.timer);
    this.folderRemovalMonitors.delete(folderId);
    if (total > 0) this.onFolderRemoval({ folderId, phase: 'error', deleted: 0, total });
  }

  async resolveTrackFile(track) {
    assertRepositoryContract(track && typeof track === 'object', 'trackNotFound', 'Playback track does not exist');
    const sessionSource = this.sessionSources.get(track.folderId);
    if (sessionSource) return sessionSource.getFile(track.relativePath);
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
      return await this.filesystemFactory(handle).getFile(track.relativePath);
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

  async #runFolder({ scanId, folder, source, scanReason, resume, languageHints }) {
    assertRepositoryContract(!this.activeScans.has(scanId), 'scanAlreadyRunning', 'Scan is already running');
    const controller = new AbortController();
    this.activeScans.set(scanId, { controller, folderId: folder.id });
    const previous = this.folderScanTails.get(folder.id) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return this.#executeFolder({
        scanId, folder, source, scanReason, resume, languageHints, controller
      });
    });
    this.folderScanTails.set(folder.id, current);
    try {
      return await current;
    } finally {
      this.activeScans.delete(scanId);
      if (this.folderScanTails.get(folder.id) === current) this.folderScanTails.delete(folder.id);
    }
  }

  async #executeFolder({ scanId, folder, source, scanReason, resume, languageHints, controller }) {
    const playlistCollector = new AutomaticPlaylistCollector();
    const filesystem = source instanceof WebSessionFileSource
      ? source.createAdapter({ onPlaylistFile: candidate => playlistCollector.add(candidate) })
      : this.filesystemFactory(source, { onPlaylistFile: candidate => playlistCollector.add(candidate) });
    let terminalProgress = null;
    const service = this.scanServiceFactory({
      repository: this.repository,
      filesystem,
      metadataParser: this.metadataParserFactory(filesystem, { languageHints }),
      onProgress: progress => {
        if (isTerminalScanStatus(progress?.status)) terminalProgress = progress;
        else this.onProgress(progress);
      }
    });
    const result = await service.runFolder({
        scanId,
        folder: {
          id: folder.id,
          path: folder.normalizedRoot,
          normalizedRoot: folder.normalizedRoot,
          lifecycleVersion: folder.lifecycleVersion
        },
        scanReason,
        resume,
        signal: controller.signal
      });
    const playlistImports = await importAutomaticPlaylists({
        service: this.playlistImportService,
        folderId: folder.id,
        collector: playlistCollector,
        attemptId: scanId,
        signal: controller.signal,
        openSource: async candidate => ({ source: await filesystem.getFile(candidate.relativePath, controller.signal) })
      });
    if (!(source instanceof WebSessionFileSource) && await queryFolderPermission(source) !== 'granted') {
      await this.repository.setFolderAvailability({ folderId: folder.id, status: 'needs-permission' });
    }
    const completed = withPlaylistImportSummary(result, playlistImports);
    if (terminalProgress) this.onProgress(withPlaylistImportSummary(terminalProgress, playlistImports));
    return completed;
  }

  #requirePendingSessionSource(token) {
    const normalized = String(token || '');
    const pending = this.pendingSessionSources.get(normalized);
    assertRepositoryContract(pending, 'invalidSessionToken', 'Session folder selection has expired');
    return pending;
  }
}

function isTerminalScanStatus(status) {
  return status === 'completed' || status === 'completed-no-sweep';
}

function withPlaylistImportSummary(result, playlistImports) {
  return Object.freeze({
    ...result,
    playlistImportState: playlistImports.state ??
      (playlistImports.canceled > 0 ? 'playlist-import-canceled' : 'completed'),
    counts: Object.freeze({
      ...(result?.counts ?? {}),
      playlistsFound: playlistImports.found,
      playlistsImported: playlistImports.imported,
      playlistsAlreadyImported: playlistImports.alreadyImported,
      playlistImportFailures: playlistImports.failed,
      playlistImportsCanceled: playlistImports.canceled ?? 0
    }),
    playlistImports
  });
}

function defaultId() {
  assertRepositoryContract(typeof globalThis.crypto?.randomUUID === 'function', 'cryptoUnavailable', 'Secure Web folder IDs are unavailable');
  return globalThis.crypto.randomUUID();
}

function normalizeFolderTrackCount(result) {
  const count = Number(result?.trackCount);
  assertRepositoryContract(
    Number.isSafeInteger(count) && count >= 0,
    'invalidFolderTrackCount',
    'Library folder track count is invalid'
  );
  return count;
}

function assertMethods(repository, methods) {
  assertRepositoryContract(repository && typeof repository === 'object', 'invalidScanAdapter', 'Web catalog repository is required');
  for (const method of methods) {
    if (typeof repository[method] !== 'function') {
      throw createRepositoryError('invalidScanAdapter', `Web catalog repository must provide ${method}()`);
    }
  }
}
