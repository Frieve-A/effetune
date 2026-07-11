import { DEFAULT_SCAN_BATCH_SIZE, normalizeRelativePath } from './constants.js';
import { createTrackId } from './id-utils.js';
import { resolvePlaylistEntries } from './playlists/path-resolver.js';

export class ScanController {
  constructor({ database, index, source, artworkProcessor, emit, getLanguageHints = () => ({}) }) {
    this.database = database;
    this.index = index;
    this.source = source;
    this.artworkProcessor = artworkProcessor;
    this.emit = emit;
    this.getLanguageHints = getLanguageHints;
    this.activeScans = new Map();
    this.folderScanGenerations = new Map();
    this.catalogMutationQueue = Promise.resolve();
  }

  async scanFolders(folders, { reason = 'manual', retryActiveScanConflict = true } = {}) {
    const scanId = `scan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const targetFolders = folders.filter(folder => folder && folder.status !== 'missing' && folder.status !== 'needs-permission');
    if (targetFolders.length === 0) {
      this.emit('scan-state', { scanId, phase: 'idle', found: 0, parsed: 0, skipped: 0, reason });
      return { scanId, skipped: true };
    }

    const targetFolderIds = new Set(targetFolders.map(folder => folder.id));
    while (true) {
      const existingScan = this.findActiveScanContainingFolderIds(targetFolderIds);
      if (existingScan?.resultPromise) {
        return existingScan.resultPromise;
      }

      const canceledOverlappingScans = this.cancelOverlappingScansByFolderIds(targetFolderIds);
      if (!canceledOverlappingScans.length) break;
      await Promise.allSettled(canceledOverlappingScans);
    }

    const folderGenerations = new Map();
    const previousFolderGenerations = new Map();
    for (const folder of targetFolders) {
      const previousGeneration = this.folderScanGenerations.get(folder.id) || 0;
      const generation = previousGeneration + 1;
      previousFolderGenerations.set(folder.id, previousGeneration);
      this.folderScanGenerations.set(folder.id, generation);
      folderGenerations.set(folder.id, generation);
    }
    const isFolderCurrent = folderId => folderGenerations.get(folderId) === this.folderScanGenerations.get(folderId);
    const getCurrentTargetFolders = () => targetFolders.filter(folder => isFolderCurrent(folder.id));
    const hasCurrentTarget = () => getCurrentTargetFolders().length > 0;

    const controller = {
      canceled: false,
      cancel: null,
      folderIds: targetFolderIds,
      resultPromise: null
    };
    let resolveScanResult;
    controller.resultPromise = new Promise(resolve => {
      resolveScanResult = resolve;
    });
    let settled = false;
    let settledResult = null;
    const finish = result => {
      if (!settled) {
        settled = true;
        settledResult = result;
      }
      return result;
    };
    this.activeScans.set(scanId, controller);
    let found = 0;
    let parsed = 0;
    let skipped = 0;
    let addedTotal = 0;
    let updatedTotal = 0;
    let artworkRefCountsDirty = false;
    const seenByFolder = new Map(targetFolders.map(folder => [folder.id, new Set()]));
    const knownFilesByFolder = new Map(targetFolders.map(folder => [folder.id, []]));
    const foldersWithEnumerationErrors = new Set();
    const folderErrorStatuses = new Map();

    const commitBatch = async (tracks, artworks = []) => {
      const currentTracks = tracks.filter(track => isFolderCurrent(track.folderId));
      if (!currentTracks.length) return;
      const dirtyBeforeBatch = artworkRefCountsDirty;
      let wroteArtwork = false;
      const artworkRefCounts = new Map();
      for (const track of currentTracks) {
        if (!track.artworkId) continue;
        artworkRefCounts.set(track.artworkId, (artworkRefCounts.get(track.artworkId) || 0) + 1);
      }
      for (const artwork of artworks) {
        if (!artwork?.id || !artwork.bytes) continue;
        const refCount = artworkRefCounts.get(artwork.id) || 0;
        if (refCount === 0) continue;
        await this.artworkProcessor.storeArtworkBytes(artwork.bytes, artwork.sourceKind || 'embedded', {
          id: artwork.id,
          mime: artwork.mime,
          refCount
        });
        wroteArtwork = true;
        artworkRefCountsDirty = true;
      }
      const preparedEntries = [];
      for (const track of currentTracks) {
        if (!isFolderCurrent(track.folderId)) continue;
        const relativePath = normalizeRelativePath(track.relativePath);
        const id = track.id || await createTrackId(track.folderId, relativePath);
        const now = Date.now();
        const existing = this.index.getTrackById(id);
        let artworkId = track.artworkId || null;
        if (!artworkId && track.artworkBytes) {
          artworkId = await this.artworkProcessor.storeArtworkBytes(track.artworkBytes, track.artworkSourceKind || 'embedded');
          wroteArtwork = Boolean(artworkId) || wroteArtwork;
          artworkRefCountsDirty = Boolean(artworkId) || artworkRefCountsDirty;
        }
        preparedEntries.push({
          track: {
            ...track,
            id,
            relativePath,
            artworkId,
            addedAt: existing?.addedAt || track.addedAt || now,
            updatedAt: now,
            albumKey: track.albumKey || this.index.createAlbumKey(track),
            artworkBytes: undefined,
            artworkSourceKind: undefined,
            file: undefined,
            handle: undefined,
            provider: undefined
          },
          isNew: !existing
        });
      }
      if (!preparedEntries.length) return;
      if (controller.canceled) return;
      const currentEntries = preparedEntries.filter(entry => isFolderCurrent(entry.track.folderId));
      if (!currentEntries.length) return;
      const prepared = currentEntries.map(entry => entry.track);
      const added = currentEntries.filter(entry => entry.isNew).length;
      const updated = currentEntries.length - added;
      await this.database.putTracks(prepared);
      if (updated > 0) {
        artworkRefCountsDirty = true;
      } else if (wroteArtwork && !dirtyBeforeBatch) {
        artworkRefCountsDirty = false;
      }
      this.index.applyChanges({ upsert: prepared });
      addedTotal += added;
      updatedTotal += updated;
      this.emit('catalog-changed', { added, updated, removed: 0, tracks: prepared });
    };

    const flushBatch = (tracks, artworks = []) => this.runCatalogMutation(
      () => commitBatch(tracks, artworks)
    );

    const refreshFolders = async () => {
      const folders = await this.database.getAllFolders();
      this.index.setFolders(folders);
      this.emit('folders-changed', { folders });
      return folders;
    };

    const updateScanFolderStatuses = async (statusByFolderId, { markOkFolders = [] } = {}) => {
      const now = Date.now();
      const removedCount = 0;
      for (const [folderId, status] of statusByFolderId) {
        if (!isFolderCurrent(folderId)) continue;
        await this.database.updateFolder(folderId, {
          lastScanAt: now,
          status
        });
      }
      for (const folder of markOkFolders) {
        if (!isFolderCurrent(folder.id)) continue;
        await this.database.updateFolder(folder.id, {
          lastScanAt: now,
          status: 'ok',
          lastScanStats: { found, parsed, added: addedTotal, updated: updatedTotal, removed: removedCount, durationMs: 0 }
        });
      }
      await refreshFolders();
    };

    const sink = async event => {
      if (!event || controller.canceled) return;
      if (!hasCurrentTarget()) return;
      switch (event.type) {
        case 'enumerate-progress':
          if (event.folderId && !isFolderCurrent(event.folderId)) return;
          found = event.found ?? found;
          this.emit('scan-state', { scanId, phase: 'scanning', found, parsed, skipped, currentPath: event.currentPath || '' });
          break;
        case 'skipped':
          if (event.folderId && !isFolderCurrent(event.folderId)) return;
          skipped += event.count || 0;
          if (event.folderId && event.relativePath) {
            seenByFolder.get(event.folderId)?.add(normalizeRelativePath(event.relativePath));
          }
          this.emit('scan-state', { scanId, phase: 'scanning', found, parsed, skipped, currentPath: event.currentPath || '' });
          break;
        case 'batch':
          {
            const currentTracks = (event.tracks || []).filter(track => isFolderCurrent(track.folderId));
            if (!currentTracks.length) return;
            for (const track of currentTracks) {
              seenByFolder.get(track.folderId)?.add(normalizeRelativePath(track.relativePath));
            }
            parsed += currentTracks.length;
            await flushBatch(currentTracks, event.artworks || []);
          }
          this.emit('scan-state', { scanId, phase: 'scanning', found, parsed, skipped, currentPath: event.currentPath || '' });
          break;
        case 'seen-files':
          for (const file of event.files || []) {
            if (!file?.folderId || !isFolderCurrent(file.folderId)) continue;
            seenByFolder.get(file.folderId)?.add(normalizeRelativePath(file.relativePath));
          }
          break;
        case 'done':
          if (event.seenFiles) {
            for (const file of event.seenFiles) {
              if (!isFolderCurrent(file.folderId)) continue;
              seenByFolder.get(file.folderId)?.add(normalizeRelativePath(file.relativePath));
            }
          }
          if (event.seenPaths && event.folderId && isFolderCurrent(event.folderId)) {
            const set = seenByFolder.get(event.folderId);
            event.seenPaths.forEach(path => set?.add(normalizeRelativePath(path)));
          }
          break;
        case 'parse-error':
          if (event.folderId && !isFolderCurrent(event.folderId)) return;
          this.emit('scan-state', { scanId, phase: 'scanning', found, parsed, skipped, error: event.reason, currentPath: event.relativePath || '' });
          break;
        case 'error':
          if (event.folderId) {
            if (!isFolderCurrent(event.folderId)) return;
            foldersWithEnumerationErrors.add(event.folderId);
            if (isFolderLevelScanError(event)) {
              folderErrorStatuses.set(event.folderId, folderStatusFromScanError(event));
            }
          } else {
            getCurrentTargetFolders().forEach(folder => {
              foldersWithEnumerationErrors.add(folder.id);
              folderErrorStatuses.set(folder.id, folderStatusFromScanError(event));
            });
          }
          if (hasCurrentTarget()) {
            this.emit('scan-state', { scanId, phase: 'error', found, parsed, skipped, error: event.reason || 'Scan failed' });
          }
          break;
        default:
          break;
      }
    };

    try {
      const knownFiles = [];
      for (const folder of targetFolders) {
        const folderKnownFiles = await this.database.getKnownFilesByFolder(folder.id);
        const snapshot = knownFilesByFolder.get(folder.id);
        for (const file of folderKnownFiles) {
          snapshot.push(file);
          knownFiles.push({
            folderId: file.folderId,
            relativePath: file.relativePath,
            size: file.size,
            mtimeMs: file.mtimeMs
          });
        }
      }

      if (controller.canceled) {
        return finish({ scanId, found, parsed, skipped, stale: true });
      }
      if (!hasCurrentTarget()) {
        return finish({ scanId, found, parsed, skipped, stale: true });
      }
      this.emit('scan-state', { scanId, phase: 'scanning', found, parsed, skipped, currentPath: '', reason });

      const handle = this.source.scan({
        scanId,
        folders: targetFolders,
        knownFiles,
        batchSize: DEFAULT_SCAN_BATCH_SIZE,
        languageHints: this.getLanguageHints()
      }, sink);
      controller.cancel = () => handle?.cancel?.();
      await handle.done;
      if (!controller.canceled && hasCurrentTarget()) {
        const sweepFolders = getCurrentTargetFolders().filter(folder => !foldersWithEnumerationErrors.has(folder.id));
        const removedIds = await this.runCatalogMutation(async () => {
          const ids = await this.sweepRemovedTracks(sweepFolders, seenByFolder, isFolderCurrent, knownFilesByFolder);
          if (ids.length > 0) artworkRefCountsDirty = true;
          if (artworkRefCountsDirty) {
            await this.recalculateArtworkRefCounts();
            artworkRefCountsDirty = false;
          }
          return ids;
        });
        if (!hasCurrentTarget()) return finish({ scanId, found, parsed, skipped, stale: true });
        const currentFolders = getCurrentTargetFolders();
        const okFolders = currentFolders.filter(folder => !folderErrorStatuses.has(folder.id));
        const restoredPlaylistIds = await this.resolveUnresolvedPlaylistItems();
        if (removedIds.length) {
          this.index.applyChanges({ removedIds });
          this.emit('catalog-changed', { added: 0, updated: 0, removed: removedIds.length, removedIds });
        }
        if (removedIds.length || restoredPlaylistIds.length) {
          this.emit('playlists-changed', { removedTrackIds: removedIds, playlistIds: restoredPlaylistIds });
        }
        const now = Date.now();
        for (const [folderId, status] of folderErrorStatuses) {
          if (!isFolderCurrent(folderId)) continue;
          await this.database.updateFolder(folderId, {
            lastScanAt: now,
            status
          });
        }
        for (const folder of okFolders) {
          await this.database.updateFolder(folder.id, {
            lastScanAt: now,
            status: 'ok',
            lastScanStats: { found, parsed, added: addedTotal, updated: updatedTotal, removed: removedIds.length, durationMs: 0 }
          });
        }
        await refreshFolders();
        this.emit('scan-state', { scanId, phase: 'done', found, parsed, skipped, added: addedTotal, updated: updatedTotal, removed: removedIds.length });
      }
      return finish({ scanId, found, parsed, skipped });
    } catch (error) {
      const activeConflictScan = this.findReusableActiveScanFromConflict(error, targetFolderIds);
      if (!controller.canceled && activeConflictScan?.resultPromise) {
        restoreFolderScanGenerations(this.folderScanGenerations, previousFolderGenerations, folderGenerations);
        this.activeScans.delete(scanId);
        return finish(await activeConflictScan.resultPromise);
      }
      if (!controller.canceled && isActiveScanConflictError(error)) {
        restoreFolderScanGenerations(this.folderScanGenerations, previousFolderGenerations, folderGenerations);
        this.activeScans.delete(scanId);
        if (retryActiveScanConflict) {
          return finish(await this.scanFolders(targetFolders, { reason, retryActiveScanConflict: false }));
        }
        return finish({ scanId, found, parsed, skipped, stale: true, activeScanId: error.activeScanId });
      }
      if (!controller.canceled && hasCurrentTarget()) {
        if (folderErrorStatuses.size === 0) {
          getCurrentTargetFolders().forEach(folder => folderErrorStatuses.set(folder.id, 'error'));
        }
        await updateScanFolderStatuses(folderErrorStatuses);
        this.emit('scan-state', {
          scanId,
          phase: 'error',
          found,
          parsed,
          skipped,
          error: error?.message || String(error || 'Scan failed')
        });
      }
      return finish({ scanId, found, parsed, skipped });
    } finally {
      if (artworkRefCountsDirty) {
        try {
          await this.runCatalogMutation(() => this.recalculateArtworkRefCounts());
          artworkRefCountsDirty = false;
        } catch (_) {
          // Preserve the original scan outcome if best-effort cleanup also fails.
        }
      }
      if (!settled) {
        finish({ scanId, found, parsed, skipped, stale: true });
      }
      this.activeScans.delete(scanId);
      resolveScanResult?.(settledResult);
    }
  }

  findActiveScanContainingFolderIds(folderIds) {
    for (const controller of this.activeScans.values()) {
      if (controller.canceled || !setContainsAll(controller.folderIds, folderIds)) continue;
      return controller;
    }
    return null;
  }

  runCatalogMutation(callback) {
    const operation = this.catalogMutationQueue.then(callback, callback);
    this.catalogMutationQueue = operation.catch(() => {});
    return operation;
  }

  findActiveScanByFolderIds(folderIds) {
    for (const controller of this.activeScans.values()) {
      if (controller.canceled || !setsEqual(controller.folderIds, folderIds)) continue;
      return controller;
    }
    return null;
  }

  findReusableActiveScanFromConflict(error, folderIds) {
    if (!isActiveScanConflictError(error)) return null;
    const controller = this.activeScans.get(error.activeScanId);
    if (!controller || controller.canceled || !setContainsAll(controller.folderIds, folderIds)) return null;
    return controller;
  }

  cancel(scanId) {
    const controller = this.activeScans.get(scanId);
    if (!controller) return false;
    if (controller.canceled) return false;
    controller.canceled = true;
    controller.cancel?.();
    this.emit('scan-state', { scanId, phase: 'canceled' });
    return true;
  }

  cancelOverlappingScansByFolderIds(folderIds) {
    const targetIds = normalizeFolderIdSet(folderIds);
    if (!targetIds.size) return [];
    const canceled = [];
    for (const [scanId, controller] of [...this.activeScans.entries()]) {
      const scanFolderIds = controller.folderIds || new Set();
      if (setsOverlap(targetIds, scanFolderIds)) {
        const resultPromise = controller.resultPromise;
        if (controller.canceled) {
          if (resultPromise) canceled.push(resultPromise);
          continue;
        }
        if (this.cancel(scanId) && resultPromise) {
          canceled.push(resultPromise);
        }
      }
    }
    return canceled;
  }

  cancelScansByFolderIds(folderIds) {
    const targetIds = normalizeFolderIdSet(folderIds);
    if (!targetIds.size) return 0;
    let canceled = 0;
    for (const [scanId, controller] of [...this.activeScans.entries()]) {
      const scanFolderIds = controller.folderIds || new Set();
      if (setsOverlap(targetIds, scanFolderIds) && this.cancel(scanId)) {
        canceled += 1;
      }
    }
    return canceled;
  }

  cancelScanByFolderId(folderId) {
    return this.cancelScansByFolderIds([folderId]) > 0;
  }

  async sweepRemovedTracks(folders, seenByFolder, isFolderCurrent = () => true, knownFilesByFolder = null) {
    const removedIds = [];
    for (const folder of folders) {
      if (!isFolderCurrent(folder.id)) continue;
      const seen = seenByFolder.get(folder.id) || new Set();
      const hasSnapshot = knownFilesByFolder?.has(folder.id);
      const known = hasSnapshot
        ? knownFilesByFolder.get(folder.id)
        : await this.database.getTracksByFolder(folder.id);
      if (!isFolderCurrent(folder.id)) continue;
      for (const track of known) {
        if (track.trackId && !seen.has(normalizeRelativePath(track.relativePath))) {
          removedIds.push(track.trackId);
        } else if (track.id && !seen.has(normalizeRelativePath(track.relativePath))) {
          removedIds.push(track.id);
        }
      }
    }
    if (!removedIds.length) return removedIds;
    await this.database.deleteTracks(removedIds);
    return removedIds;
  }

  async recalculateArtworkRefCounts() {
    return this.database.recalculateArtworkRefCounts();
  }

  async resolveUnresolvedPlaylistItems() {
    const playlists = await this.database.getAllPlaylists();
    if (!playlists.length) return [];

    const unresolvedItems = [];
    const itemRefs = [];
    for (const playlist of playlists) {
      const items = playlist.items || [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (item?.trackId || !item?.unresolved) continue;
        unresolvedItems.push(item);
        itemRefs.push({ playlistId: playlist.id, index });
      }
    }
    if (!unresolvedItems.length) return [];

    const tracks = await this.database.getAllTracks();
    if (!tracks.length) return [];
    const folders = await this.database.getAllFolders();
    const resolution = resolvePlaylistEntries(unresolvedItems, { tracks, folders, platform: getRuntimePlatform() });
    const resolvedByPlaylistId = new Map();
    resolution.items.forEach((result, resultIndex) => {
      if (result.status !== 'resolved' || !result.trackId) return;
      const ref = itemRefs[resultIndex];
      const matches = resolvedByPlaylistId.get(ref.playlistId) ?? new Map();
      matches.set(ref.index, result);
      resolvedByPlaylistId.set(ref.playlistId, matches);
    });
    const changed = [];

    for (const playlist of playlists) {
      const resolvedItems = resolvedByPlaylistId.get(playlist.id);
      if (!resolvedItems) continue;
      const items = (playlist.items || []).map((item, index) => {
        const result = resolvedItems.get(index);
        if (!result) return item;
        const { unresolved: _unresolved, ...rest } = item;
        return {
          ...rest,
          trackId: result.trackId
        };
      });
      const next = { ...playlist, items, updatedAt: Date.now() };
      await this.database.putPlaylist(next);
      changed.push(next.id);
    }

    return changed;
  }
}

function getRuntimePlatform() {
  return globalThis.window?.electronAPI?.platform || globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '';
}

function isFolderLevelScanError(event = {}) {
  return !event.relativePath;
}

function folderStatusFromScanError(event = {}) {
  const category = String(event.category || '').toLowerCase();
  const code = String(event.code || '').toUpperCase();
  const reason = String(event.reason || '').toLowerCase();

  if (category === 'missing' || code === 'ENOENT') return 'missing';
  if (category === 'permission-denied' || code === 'EACCES' || code === 'EPERM') return 'needs-permission';
  if (reason.includes('no library folder has been selected') ||
    reason.includes('outside the selected music library folders') ||
    reason.includes('permission')) {
    return 'needs-permission';
  }
  return 'error';
}

function isActiveScanConflictError(error = {}) {
  return Boolean(error?.activeScanId);
}

function restoreFolderScanGenerations(currentGenerations, previousGenerations, assignedGenerations) {
  for (const [folderId, assignedGeneration] of assignedGenerations) {
    if (currentGenerations.get(folderId) !== assignedGeneration) continue;
    const previousGeneration = previousGenerations.get(folderId) || 0;
    if (previousGeneration > 0) {
      currentGenerations.set(folderId, previousGeneration);
    } else {
      currentGenerations.delete(folderId);
    }
  }
}

function normalizeFolderIdSet(folderIds) {
  const ids = folderIds instanceof Set ? [...folderIds] : (Array.isArray(folderIds) ? folderIds : [folderIds]);
  return new Set(ids.filter(Boolean));
}

function setContainsAll(left, right) {
  if (!left || !right || left.size < right.size) return false;
  for (const item of right) {
    if (!left.has(item)) return false;
  }
  return true;
}

function setsOverlap(left, right) {
  if (!left || !right) return false;
  for (const item of left) {
    if (right.has(item)) return true;
  }
  return false;
}

function setsEqual(left, right) {
  if (!left || !right || left.size !== right.size) return false;
  for (const item of left) {
    if (!right.has(item)) return false;
  }
  return true;
}
