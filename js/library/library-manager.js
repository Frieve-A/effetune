import { CatalogIndex } from './catalog-index.js';
import { LibraryDatabase } from './library-database.js';
import { ArtworkProcessor } from './metadata/artwork-processor.js';
import { PlaybackBridge } from './playback-bridge.js';
import { PlaylistStore } from './playlists/playlist-store.js';
import { parsePlaylist, serializePlaylist } from './playlists/playlist-formats.js';
import { createUnresolvedPlaylistItem, resolvePlaylistEntries } from './playlists/path-resolver.js';
import { ScanController } from './scan-controller.js';
import { createLibrarySource } from './sources/library-source.js';
import { generateEntityId } from './id-utils.js';

export class LibraryManager {
  constructor({ uiManager, database = new LibraryDatabase(), source = createLibrarySource() } = {}) {
    this.uiManager = uiManager;
    this.database = database;
    this.source = source;
    this.index = new CatalogIndex();
    this.listeners = new Map();
    this.ready = false;
    this.artwork = new ArtworkProcessor(database);
    this.playlists = new PlaylistStore(database, (event, payload) => this.emit(event, payload));
    this.scanController = new ScanController({
      database,
      index: this.index,
      source,
      artworkProcessor: this.artwork,
      emit: (event, payload) => this.handleScanEvent(event, payload),
      getLanguageHints: () => this.getLanguageHints()
    });
    this.playbackBridge = new PlaybackBridge({
      index: this.index,
      source,
      uiManager,
      getFolders: () => this.folders
    });
    this.folders = [];
  }

  async init() {
    await this.database.open();
    this.folders = await this.database.getAllFolders();
    await this.restoreMirroredFolders();
    const tracks = await this.database.getAllTracks();
    await this.index.build({ folders: this.folders, tracks });
    await this.refreshFolderStatuses();
    this.ready = true;
    this.emit('ready', { trackCount: tracks.length, counts: this.index.getCounts() });
    return this;
  }

  async restoreMirroredFolders() {
    if (typeof this.source.loadMirroredFolders !== 'function') return;
    try {
      // Always load the mirror, even when IndexedDB already has folders, so persistent
      // sources can re-register their allowed roots with the host after a restart.
      const folders = await this.source.loadMirroredFolders();
      const knownIds = new Set(this.folders.map(folder => folder.id));
      const now = Date.now();
      let restored = false;
      for (const folder of folders) {
        if (!folder?.id || !folder.path || knownIds.has(folder.id)) continue;
        await this.database.putFolder({
          id: folder.id,
          kind: folder.kind || this.source.kind,
          displayName: folder.displayName || folder.path,
          path: folder.path,
          handle: null,
          addedAt: folder.addedAt || now,
          lastScanAt: folder.lastScanAt || null,
          lastScanStats: folder.lastScanStats || null,
          status: folder.status || 'never-scanned'
        });
        restored = true;
      }
      if (restored) {
        this.folders = await this.database.getAllFolders();
      }
    } catch (error) {
      console.warn('[LibraryManager] Failed to restore mirrored library folders:', error);
    }
  }

  addListener(event, callback) {
    const set = this.listeners.get(event) || new Set();
    set.add(callback);
    this.listeners.set(event, set);
    return () => this.removeListener(event, callback);
  }

  removeListener(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }

  emit(event, payload = {}) {
    this.listeners.get(event)?.forEach(callback => callback(payload));
    this.listeners.get('*')?.forEach(callback => callback(payload, event));
  }

  handleScanEvent(event, payload = {}) {
    if (event === 'folders-changed' && Array.isArray(payload.folders)) {
      this.folders = this.mergeRuntimeFolderState(payload.folders);
      this.index.setFolders(this.folders);
      this.emit(event, { ...payload, folders: this.folders });
      this.syncFolderMirror();
      return;
    }
    this.emit(event, payload);
  }

  async syncFolderMirror() {
    if (typeof this.source.syncFolders !== 'function') return;
    try {
      await this.source.syncFolders(this.folders);
    } catch (error) {
      console.warn('[LibraryManager] Failed to mirror library folders:', error);
    }
  }

  mergeRuntimeFolderState(folders) {
    const runtimeById = new Map(this.folders.map(folder => [folder.id, {
      files: folder.files,
      handle: folder.handle
    }]));
    return folders.map(folder => {
      const runtime = runtimeById.get(folder.id);
      if (!runtime) return folder;
      return {
        ...folder,
        ...(folder.handle ? {} : (runtime.handle ? { handle: runtime.handle } : {})),
        ...(runtime.files ? { files: runtime.files } : {})
      };
    });
  }

  async refreshFolderStatuses() {
    const updated = [];
    for (const folder of this.folders) {
      let status = folder.status || 'never-scanned';
      try {
        status = await this.source.checkFolder(folder);
      } catch (_) {
        status = 'missing';
      }
      const next = await this.database.updateFolder(folder.id, { status }) || { ...folder, status };
      updated.push(this.mergeRuntimeFolderState([next])[0]);
    }
    this.folders = updated;
    this.index.setFolders(this.folders);
    this.emit('folders-changed', { folders: this.folders });
    await this.syncFolderMirror();
  }

  async addFolder() {
    const picked = await this.source.pickFolder();
    if (!picked) return null;
    const now = Date.now();
    const runtimeFiles = picked.files || null;
    const folder = {
      id: generateEntityId('f'),
      kind: picked.kind || this.source.kind,
      displayName: picked.displayName || picked.path || 'Music',
      path: picked.path || null,
      handle: picked.handle || null,
      addedAt: now,
      lastScanAt: null,
      lastScanStats: null,
      status: 'never-scanned'
    };
    const containment = await this.resolveRootContainment(folder);
    if (containment.action === 'reject' || containment.action === 'same') {
      this.emit('folder-add-rejected', { reason: containment.reason, folder, existing: containment.existing || null });
      return containment.action === 'same' ? containment.existing : null;
    }
    if (containment.replace.length && !this.confirmFolderMerge(folder, containment.replace)) {
      this.emit('folder-add-rejected', { reason: 'merge-canceled', folder, existing: containment.replace[0] });
      return null;
    }
    const canceledScans = [];
    for (const child of containment.replace) {
      for (const canceledScan of this.invalidateFolderScans(child.id)) {
        canceledScans.push(canceledScan);
      }
    }
    await Promise.allSettled(canceledScans);
    const removedIds = await this.scanController.runCatalogMutation(async () => {
      const ids = [];
      for (const child of containment.replace) {
        for (const removedId of await this.database.deleteFolder(child.id)) {
          ids.push(removedId);
        }
      }
      if (containment.replace.length) {
        await this.database.recalculateArtworkRefCounts();
      }
      return ids;
    });
    for (const child of containment.replace) {
      await this.releaseSourceFolder(child.id);
    }
    await this.database.putFolder(folder);
    this.folders = this.mergeRuntimeFolderState(await this.database.getAllFolders());
    if (runtimeFiles) {
      this.folders = this.folders.map(item => item.id === folder.id ? { ...item, files: runtimeFiles } : item);
    }
    this.index.applyChanges({ removedIds, folders: this.folders });
    this.emit('folders-changed', { folders: this.folders });
    await this.syncFolderMirror();
    if (removedIds.length) {
      this.emit('catalog-changed', { added: 0, updated: 0, removed: removedIds.length, removedIds });
      this.emit('playlists-changed', { removedTrackIds: removedIds });
    }
    await this.scanFolders([folder.id], { reason: 'folder-added' });
    return folder;
  }

  async resolveRootContainment(candidate, { excludeId = null } = {}) {
    const replace = [];
    const folders = excludeId ? this.folders.filter(folder => folder.id !== excludeId) : this.folders;
    for (const existing of sortFoldersForContainment(folders)) {
      const relation = await this.compareFolders(candidate, existing);
      if (relation === 'same') {
        return { action: 'same', reason: 'same-root', existing, replace: [] };
      }
      if (relation === 'descendant') {
        return { action: 'reject', reason: 'descendant-root', existing, replace: [] };
      }
      if (relation === 'ancestor') {
        replace.push(existing);
      }
    }
    return { action: replace.length ? 'replace-children' : 'add', reason: '', replace };
  }

  async compareFolders(candidate, existing) {
    if (!this.source.compareFolder) return 'unknown';
    try {
      return await this.source.compareFolder(candidate, existing);
    } catch (_) {
      return 'unknown';
    }
  }

  confirmFolderMerge(folder, replaced = []) {
    if (typeof globalThis.confirm !== 'function') return true;
    const first = replaced[0] || {};
    return globalThis.confirm(this.translateWithFallback('library.confirm.mergeFolders', {
      name: first.displayName || first.path || '',
      count: replaced.length
    }, 'Merge {count} existing folder(s) including "{name}" into the new folder?'));
  }

  translateWithFallback(key, params = {}, fallbackText = '') {
    const text = this.uiManager?.t ? this.uiManager.t(key, params) : key;
    if (text && text !== key) return text;
    return Object.entries(params).reduce(
      (result, [param, value]) => result.replace(new RegExp(`\\{${param}\\}`, 'g'), value),
      fallbackText
    );
  }

  getLanguageHints() {
    const nav = globalThis.navigator || {};
    const browserLanguages = Array.isArray(nav.languages) ? nav.languages.slice(0, 8) : [];
    return {
      language: this.uiManager?.userLanguage || '',
      languagePreference: this.uiManager?.languagePreference || '',
      browserLanguage: nav.language || '',
      browserLanguages
    };
  }

  invalidateFolderScans(folderId) {
    const controller = this.scanController;
    const generations = controller?.folderScanGenerations;
    if (!generations) return [];
    generations.set(folderId, (generations.get(folderId) || 0) + 1);
    return controller.cancelOverlappingScansByFolderIds?.([folderId]) || [];
  }

  async removeFolder(folderId) {
    const canceledScans = this.invalidateFolderScans(folderId);
    await Promise.allSettled(canceledScans);
    const removedIds = await this.scanController.runCatalogMutation(async () => {
      const ids = await this.database.deleteFolder(folderId);
      await this.database.recalculateArtworkRefCounts();
      return ids;
    });
    await this.releaseSourceFolder(folderId);
    this.folders = this.mergeRuntimeFolderState(await this.database.getAllFolders());
    this.index.applyChanges({ removedIds, folders: this.folders });
    this.emit('folders-changed', { folders: this.folders });
    await this.syncFolderMirror();
    this.emit('catalog-changed', { added: 0, updated: 0, removed: removedIds.length, removedIds });
    if (removedIds.length) {
      this.emit('playlists-changed', { removedTrackIds: removedIds });
    }
  }

  async releaseSourceFolder(folderId) {
    if (typeof this.source.releaseFolder !== 'function') return;
    try {
      await this.source.releaseFolder(folderId);
    } catch (error) {
      console.warn('[LibraryManager] Failed to release library folder runtime state:', error);
    }
  }

  async requestFolderAccess(folderId) {
    const folder = this.folders.find(item => item.id === folderId);
    if (!folder) return false;
    const candidate = { ...folder };
    const granted = await this.source.requestAccess(candidate);
    if (!granted) return false;
    const containment = await this.resolveRootContainment(candidate, { excludeId: folderId });
    if (containment.action === 'reject' || containment.action === 'same') {
      this.emit('folder-add-rejected', { reason: containment.reason, folder: candidate, existing: containment.existing || null });
      return false;
    }
    if (containment.replace.length && !this.confirmFolderMerge(candidate, containment.replace)) {
      this.emit('folder-add-rejected', { reason: 'merge-canceled', folder: candidate, existing: containment.replace[0] });
      return false;
    }
    let status = 'ok';
    try {
      status = await this.source.checkFolder(candidate);
    } catch (_) {
      status = 'ok';
    }
    if (status === 'needs-permission' && candidate.files) {
      status = 'ok';
    }
    const canceledScans = [];
    for (const child of containment.replace) {
      for (const canceledScan of this.invalidateFolderScans(child.id)) {
        canceledScans.push(canceledScan);
      }
    }
    await Promise.allSettled(canceledScans);
    const removedIds = await this.scanController.runCatalogMutation(async () => {
      const ids = [];
      for (const child of containment.replace) {
        for (const removedId of await this.database.deleteFolder(child.id)) {
          ids.push(removedId);
        }
      }
      if (containment.replace.length) {
        await this.database.recalculateArtworkRefCounts();
      }
      return ids;
    });
    for (const child of containment.replace) {
      await this.releaseSourceFolder(child.id);
    }
    const updates = {
      displayName: candidate.displayName,
      path: candidate.path || null,
      handle: candidate.handle || null,
      status
    };
    const updated = await this.database.updateFolder(folder.id, updates) || { ...folder, ...updates };
    this.folders = this.mergeRuntimeFolderState(await this.database.getAllFolders()).map(item => item.id === folderId ? {
      ...updated,
      ...(candidate.handle ? { handle: candidate.handle } : {}),
      ...(candidate.files ? { files: candidate.files } : {})
    } : item);
    this.index.applyChanges({ removedIds, folders: this.folders });
    this.emit('folders-changed', { folders: this.folders });
    await this.syncFolderMirror();
    if (removedIds.length) {
      this.emit('catalog-changed', { added: 0, updated: 0, removed: removedIds.length, removedIds });
      this.emit('playlists-changed', { removedTrackIds: removedIds });
    }
    return true;
  }

  async scanFolders(folderIds = null, options = {}) {
    const set = folderIds ? new Set(folderIds) : null;
    const folders = this.folders.filter(folder => !set || set.has(folder.id));
    return this.scanController.scanFolders(folders, options);
  }

  cancelScan(scanId) {
    return this.scanController.cancel(scanId);
  }

  getCounts() {
    return this.index.getCounts();
  }

  getFolders() {
    return this.index.getFolders();
  }

  getTracks(options = {}) {
    return this.index.getAllTracks(options);
  }

  search(query) {
    return this.index.search(query);
  }

  getAlbums(options = {}) {
    return this.index.getAlbums(options);
  }

  getAlbumTracks(albumKey) {
    return this.index.getAlbumTracks(albumKey);
  }

  getArtists() {
    return this.index.getArtists();
  }

  getArtistTracks(artistKey) {
    return this.index.getArtistTracks(artistKey);
  }

  getGenres() {
    return this.index.getGenres();
  }

  getGenreTracks(genreKey) {
    return this.index.getGenreTracks(genreKey);
  }

  getSubfolders() {
    return this.index.getSubfolders();
  }

  getSubfolderTracks(subfolderKey) {
    return this.index.getSubfolderTracks(subfolderKey);
  }

  getFolderTracks(folderId) {
    return this.index.getFolderTracks(folderId);
  }

  getRecentlyAdded(limit) {
    return this.index.getRecentlyAdded(limit);
  }

  getTrackById(id) {
    return this.index.getTrackById(id);
  }

  findTrackForPlaybackEntry(entry = {}) {
    if (entry.libraryTrackId) {
      const track = this.index.getTrackById(entry.libraryTrackId);
      if (track) return track;
    }
    if (entry.path) {
      const track = this.index.findByAbsolutePath(entry.path);
      if (track) return track;
    }
    return null;
  }

  createPlaylistItemsFromQueueEntries(entries = []) {
    return (entries || []).map(entry => {
      const track = this.findTrackForPlaybackEntry(entry);
      if (track) return { trackId: track.id };
      return createUnresolvedPlaylistItem({
        path: entry.path || entry.name || entry.file?.name || '',
        title: entry.meta?.title || entry.name || entry.file?.name || '',
        artist: entry.meta?.artist || '',
        album: entry.meta?.album || '',
        durationSec: entry.meta?.durationSec || null
      });
    }).filter(item => item.trackId || item.unresolved?.sourceLine || item.unresolved?.title);
  }

  async getArtworkThumbURL(artworkId) {
    return this.artwork.getThumbURL(artworkId);
  }

  async getArtworkThumbBlob(artworkId) {
    return this.artwork.getThumbBlob(artworkId);
  }

  async playTrackIds(trackIds, options = {}) {
    const result = await this.playbackBridge.playTracks(trackIds, options);
    if (this.playbackBridge.canRestoreSnapshot?.()) {
      this.emit('queue-replaced', {});
    }
    return result;
  }

  async playNext(trackIds) {
    return this.playbackBridge.playNext(trackIds);
  }

  async addToQueue(trackIds) {
    return this.playbackBridge.addToQueue(trackIds);
  }

  async restorePlaybackQueue() {
    const restored = await this.playbackBridge.restoreLastSnapshot();
    if (restored) {
      this.emit('queue-restored', {});
    }
    return restored;
  }

  canShowInFolder() {
    return Boolean(this.source.capabilities?.showInFolder && this.source.showInFolder);
  }

  async showTrackInFolder(trackId) {
    if (!this.canShowInFolder()) return false;
    const track = this.index.getTrackById(trackId);
    if (!track) return false;
    const folder = this.folders.find(item => item.id === track.folderId);
    return Boolean(await this.source.showInFolder({ ...track, folder }));
  }

  async importPlaylist({ content, fileName = 'Imported Playlist', playlistPath = '' } = {}) {
    const preview = this.previewPlaylistImport({ content, fileName, playlistPath });
    return this.commitPlaylistImport(preview);
  }

  previewPlaylistImport({ content, fileName = 'Imported Playlist', playlistPath = '' } = {}) {
    const parsed = parsePlaylist(content, { fileName });
    const resolution = resolvePlaylistEntries(parsed.entries, {
      tracks: this.index.getAllTracks({ sort: 'path' }),
      folders: this.folders,
      playlistPath,
      platform: getRuntimePlatform()
    });
    const items = resolution.items.map(item => (
      item.status === 'resolved'
        ? { trackId: item.trackId }
        : createUnresolvedPlaylistItem(item.entry)
    ));
    return {
      playlistName: createPlaylistName(fileName),
      items,
      format: parsed.format,
      encoding: parsed.encoding,
      resolvedCount: resolution.resolvedCount,
      unresolvedCount: resolution.unresolvedCount,
      totalCount: resolution.items.length,
      unresolvedItems: resolution.items.filter(item => item.status !== 'resolved')
    };
  }

  async commitPlaylistImport(preview) {
    const playlist = await this.playlists.create(preview.playlistName || 'Imported Playlist', preview.items || []);
    return {
      ...preview,
      playlist
    };
  }

  async resolvePlaylistItem(playlistId, itemIndex) {
    const playlist = await this.playlists.get(playlistId);
    if (!playlist) return { status: 'missing-playlist' };
    const items = [...(playlist.items || [])];
    const item = items[itemIndex];
    if (!item) return { status: 'missing-item' };
    if (item.trackId && this.index.getTrackById(item.trackId)) {
      return { status: 'resolved', trackId: item.trackId, playlist };
    }

    const resolution = resolvePlaylistEntries([item], {
      tracks: this.index.getAllTracks({ sort: 'path' }),
      folders: this.folders,
      platform: getRuntimePlatform()
    });
    const result = resolution.items[0];
    if (result?.status !== 'resolved' || !result.trackId) {
      return { status: 'unresolved', reason: result?.reason || 'no-match', playlist };
    }

    items[itemIndex] = { trackId: result.trackId };
    const updatedPlaylist = await this.playlists.replaceItems(playlistId, items);
    return {
      status: 'resolved',
      trackId: result.trackId,
      playlist: updatedPlaylist
    };
  }

  async exportPlaylist(playlistId, { format = 'm3u8', targetPath = '', preferRelative = false } = {}) {
    const playlist = await this.playlists.get(playlistId);
    if (!playlist) return '';
    const entries = this.createPlaylistExportEntries(playlist, { targetPath, preferRelative });
    return serializePlaylist(entries, {
      format,
      fileUris: Boolean(this.source.capabilities?.absolutePaths)
    });
  }

  createPlaylistExportEntries(playlist, options = {}) {
    const folderById = new Map(this.folders.map(folder => [folder.id, folder]));
    return (playlist.items || []).map(item => {
      const track = item.trackId ? this.index.getTrackById(item.trackId) : null;
      if (track) {
        const folder = folderById.get(track.folderId);
        const pathInfo = createExportPath(folder, track, options);
        return {
          path: pathInfo.path,
          relative: pathInfo.relative,
          title: track.title,
          artist: track.artist || track.albumArtist || '',
          album: track.album || '',
          durationSec: track.durationSec
        };
      }
      const unresolved = item.unresolved || {};
      return {
        path: unresolved.sourceLine || unresolved.relativePathHint || '',
        title: unresolved.title || '',
        artist: unresolved.artist || '',
        album: unresolved.album || '',
        durationSec: unresolved.durationSec
      };
    }).filter(entry => entry.path);
  }
}

function createPlaylistName(fileName) {
  const base = String(fileName || 'Imported Playlist')
    .split(/[\\/]/)
    .pop()
    .replace(/\.(m3u8?|pls|xspf)$/i, '')
    .trim();
  return base || 'Imported Playlist';
}

function createExportPath(folder, track, { targetPath = '', preferRelative = false } = {}) {
  if (folder?.path) {
    const absolutePath = `${folder.path.replace(/[\\/]+$/, '')}/${track.relativePath}`;
    if (preferRelative && targetPath && isPathInsideRoot(targetPath, folder.path)) {
      const relativePath = relativePathFrom(dirnamePath(targetPath), absolutePath);
      if (relativePath) return { path: relativePath, relative: true };
    }
    return { path: absolutePath, relative: false };
  }
  const root = folder?.displayName || folder?.id || 'Music';
  return { path: `${root}/${track.relativePath}`, relative: true };
}

function sortFoldersForContainment(folders = []) {
  return [...folders].sort((a, b) => {
    const left = `${a.path || a.displayName || ''}\0${a.id || ''}`;
    const right = `${b.path || b.displayName || ''}\0${b.id || ''}`;
    return left.localeCompare(right);
  });
}

function getRuntimePlatform() {
  return globalThis.window?.electronAPI?.platform || globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '';
}

function normalizeExportPath(value = '') {
  let text = String(value || '').replace(/\\/g, '/').trim();
  const prefix = text.startsWith('//') ? '//' : '';
  if (prefix) text = text.slice(2);
  text = text.replace(/\/+/g, '/').replace(/\/$/, '');
  return `${prefix}${text}`;
}

function dirnamePath(value = '') {
  const normalized = normalizeExportPath(value);
  const index = normalized.lastIndexOf('/');
  if (index <= 0) return '';
  return normalized.slice(0, index);
}

function isPathInsideRoot(pathValue, rootValue) {
  const platform = getRuntimePlatform();
  const caseInsensitive = platform === 'win32' || /win/i.test(platform);
  const path = normalizeExportPath(pathValue);
  const root = normalizeExportPath(rootValue);
  const left = caseInsensitive ? path.toLowerCase() : path;
  const right = caseInsensitive ? root.toLowerCase() : root;
  return left === right || left.startsWith(`${right}/`);
}

function relativePathFrom(fromDir, toPath) {
  const from = normalizeExportPath(fromDir).split('/').filter(Boolean);
  const to = normalizeExportPath(toPath).split('/').filter(Boolean);
  if (!from.length || !to.length) return '';
  const platform = getRuntimePlatform();
  const caseInsensitive = platform === 'win32' || /win/i.test(platform);
  const norm = value => (caseInsensitive ? value.toLowerCase() : value);
  if (/^[A-Za-z]:$/.test(from[0]) && norm(from[0]) !== norm(to[0])) return '';
  let common = 0;
  while (common < from.length && common < to.length && norm(from[common]) === norm(to[common])) {
    common += 1;
  }
  const up = from.slice(common).map(() => '..');
  const down = to.slice(common);
  return [...up, ...down].join('/') || to.at(-1) || '';
}
