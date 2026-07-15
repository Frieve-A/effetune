import { BoundedScanService } from './bounded-scan-service.js';
import { LazyArtworkService } from '../artwork/lazy-artwork-service.js';
import { WebArtworkExtractor } from '../artwork/web-artwork-extractor.js';
import {
  compareFolderRoots,
  queryFolderPermission,
  WebFileSystemScanAdapter
} from './web-file-system-adapter.js';
import { assertDirectoryHandle, WebFolderHandleStore } from './web-folder-handle-store.js';
import { WebMetadataParser } from './web-metadata-parser.js';
import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';

const MAX_WEB_FOLDERS = 1_000;

export class WebCatalogScanRuntime {
  constructor({
    repository,
    handleStore = new WebFolderHandleStore(),
    filesystemFactory = handle => new WebFileSystemScanAdapter({ rootHandle: handle }),
    metadataParserFactory = filesystem => new WebMetadataParser({ filesystem }),
    scanServiceFactory = options => new BoundedScanService(options),
    idFactory = defaultId,
    onProgress = () => {}
  } = {}) {
    assertMethods(repository, [
      'upsertFolders', 'listFolderRecords', 'setFolderAvailability',
      'tombstoneFolder', 'runFolderDeletion'
    ]);
    this.repository = repository;
    this.handleStore = handleStore;
    this.filesystemFactory = filesystemFactory;
    this.metadataParserFactory = metadataParserFactory;
    this.scanServiceFactory = scanServiceFactory;
    this.idFactory = idFactory;
    this.onProgress = onProgress;
    this.activeScans = new Map();
    this.artworkFilesystems = new Map();
    this.artworkService = null;
  }

  async initializePermissions() {
    const folders = await this.repository.listFolderRecords({ limit: MAX_WEB_FOLDERS });
    for (const folder of folders) {
      const handle = await this.handleStore.get(folder.id);
      const status = handle && await queryFolderPermission(handle) === 'granted'
        ? 'active'
        : 'needs-permission';
      if (folder.status !== status) await this.repository.setFolderAvailability({ folderId: folder.id, status });
    }
    return { checked: folders.length };
  }

  async addFolder({ handle, displayName, scan = true, scanReason = 'automatic' } = {}) {
    assertDirectoryHandle(handle);
    const existingHandles = await this.handleStore.list({ limit: MAX_WEB_FOLDERS });
    for (const existing of existingHandles) {
      const relationship = await compareFolderRoots(handle, existing.handle);
      assertRepositoryContract(
        relationship === 'separate',
        'overlappingFolderRoot',
        'Selected folder overlaps an existing Library root',
        { existingFolderId: existing.folderId, relationship }
      );
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
    await this.repository.upsertFolders([folder]);
    if (!scan || permission !== 'granted') {
      return { folder, scan: null };
    }
    const scanId = `web-scan-${this.idFactory()}`;
    const result = await this.#runFolder({ scanId, folder, handle, scanReason, resume: false });
    return { folder, scan: result };
  }

  async scanFolders({ folderIds = null, scanId = null, scanReason = 'automatic', resume = false } = {}) {
    const folders = await this.repository.listFolderRecords({ limit: MAX_WEB_FOLDERS });
    const selected = folderIds == null
      ? folders
      : folders.filter(folder => folderIds.includes(folder.id));
    assertRepositoryContract(selected.length > 0, 'unknownFolder', 'No matching Web folder is available to scan');
    assertRepositoryContract(!scanId || selected.length === 1, 'invalidScanRequest', 'An explicit scanId can target only one folder');
    const results = [];
    for (const folder of selected) {
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
        handle,
        scanReason,
        resume
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
      const relationship = await compareFolderRoots(handle, previous);
      assertRepositoryContract(relationship === 'same', 'folderRebindMismatch', 'Selected folder is not the original Library root');
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
    const tombstoned = await this.repository.tombstoneFolder({
      folderId,
      expectedLifecycleVersion: folder.lifecycleVersion
    });
    await this.handleStore.delete(folderId);
    let deleted = 0;
    let deletion;
    do {
      deletion = await this.repository.runFolderDeletion({
        folderId,
        lifecycleVersion: tombstoned.folder.lifecycleVersion
      });
      deleted += deletion.deleted ?? 0;
    } while (deletion.hasMore === true);
    deletion = { ...deletion, deleted };
    return { folder: tombstoned.folder, deletion };
  }

  async requestArtwork({ trackUid, reason = 'viewport' } = {}) {
    const track = await this.repository.getTrackStorageIdentity(trackUid);
    if (!track) return { kind: 'placeholder' };
    let filesystem = this.artworkFilesystems.get(track.folderId);
    if (!filesystem) {
      const handle = await this.handleStore.get(track.folderId);
      if (!handle || await queryFolderPermission(handle) !== 'granted') return { kind: 'placeholder' };
      filesystem = this.filesystemFactory(handle);
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
    this.artworkFilesystems.clear();
    this.artworkService = null;
    this.handleStore.close?.();
  }

  async #runFolder({ scanId, folder, handle, scanReason, resume }) {
    assertRepositoryContract(!this.activeScans.has(scanId), 'scanAlreadyRunning', 'Scan is already running');
    const controller = new AbortController();
    this.activeScans.set(scanId, { controller, folderId: folder.id });
    const filesystem = this.filesystemFactory(handle);
    const service = this.scanServiceFactory({
      repository: this.repository,
      filesystem,
      metadataParser: this.metadataParserFactory(filesystem),
      onProgress: progress => this.onProgress(progress)
    });
    try {
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
      if (await queryFolderPermission(handle) !== 'granted') {
        await this.repository.setFolderAvailability({ folderId: folder.id, status: 'needs-permission' });
      }
      return result;
    } finally {
      this.activeScans.delete(scanId);
    }
  }
}

function defaultId() {
  assertRepositoryContract(typeof globalThis.crypto?.randomUUID === 'function', 'cryptoUnavailable', 'Secure Web folder IDs are unavailable');
  return globalThis.crypto.randomUUID();
}

function assertMethods(repository, methods) {
  assertRepositoryContract(repository && typeof repository === 'object', 'invalidScanAdapter', 'Web catalog repository is required');
  for (const method of methods) {
    if (typeof repository[method] !== 'function') {
      throw createRepositoryError('invalidScanAdapter', `Web catalog repository must provide ${method}()`);
    }
  }
}
