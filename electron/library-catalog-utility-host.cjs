'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const {
  createFolderConsolidationDialogOptions,
  createLibraryDialogTranslator
} = require('./library-dialog-localization.cjs');
const { createArtworkThumbnail } = require('./library-catalog-scan-runtime.cjs');

const LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION = 1;
const MAX_UTILITY_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_ARTWORK_BRIDGE_MESSAGE_BYTES = 21 * 1024 * 1024;
const MAX_UTILITY_OUTSTANDING_REQUESTS = 32;
const UTILITY_CLOSE_TIMEOUT_MS = 2000;
const UTILITY_OPEN_TIMEOUT_MS = 10000;

const RUNTIME_METHODS = Object.freeze([
  'addFolder', 'requestFolderAccess', 'scanFolders', 'cancelScan', 'removeFolder',
  'requestArtwork', 'resolvePlaybackSource', 'pickPlaylistImport', 'grantDroppedPlaylistImport'
]);
const COORDINATOR_METHODS = Object.freeze([
  'start', 'status', 'cancel', 'getProvisionalEntry', 'readSequencePage',
  'resolveSequenceEntrySource', 'previewPlaylistImport',
  'commitPlaylistImportPreview', 'cancelPlaylistImportPreview'
]);
const REPOSITORY_METHODS = Object.freeze([
  'getCapabilities', 'getCounts', 'createContext', 'getContextCount',
  'queryTracks', 'browseFolderChildren', 'queryEntities', 'readContextPage', 'readContextPageAtOrdinal',
  'resolveEntityAnchor', 'retainContext', 'releaseRetainedContext', 'releaseContext', 'getTrack',
  'createPlaylist', 'createPlaylistWithItems',
  'recordRecentlyPlayed', 'setTrackFavorite', 'getFavoriteTrackUids', 'getSystemPlaylists',
  'renamePlaylist', 'reorderPlaylistItem', 'removePlaylistItem', 'duplicatePlaylist',
  'queryPlaylistItems', 'tombstonePlaylist'
]);

class LibraryCatalogUtilityHost {
  constructor({
    dialog,
    getMainWindow = () => null,
    processFactory,
    dbPath,
    imageAdapter = null,
    translate = createLibraryDialogTranslator(),
    closeTimeoutMs = UTILITY_CLOSE_TIMEOUT_MS
  } = {}) {
    if (!dialog || typeof dialog.showOpenDialog !== 'function') {
      throw createUtilityError('invalidUtilityDialog', 'A dialog adapter is required');
    }
    if (typeof processFactory !== 'function') {
      throw createUtilityError('invalidUtilityProcess', 'An Electron utility process factory is required');
    }
    if (
      typeof dbPath !== 'string' ||
      !path.isAbsolute(dbPath) ||
      path.resolve(dbPath) !== dbPath ||
      path.normalize(dbPath) !== dbPath
    ) {
      throw createUtilityError('invalidDatabasePath', 'A canonical absolute catalog database path is required');
    }
    this.dialog = dialog;
    this.getMainWindow = getMainWindow;
    this.translate = translate;
    this.imageAdapter = imageAdapter;
    this.dbPath = dbPath;
    this.closeTimeoutMs = Number.isFinite(closeTimeoutMs) && closeTimeoutMs > 0
      ? closeTimeoutMs
      : UTILITY_CLOSE_TIMEOUT_MS;
    this.processFactory = processFactory;
    this.modulePath = path.join(__dirname, 'library-catalog-utility.cjs');
    this.closed = false;
    this.closing = false;
    this.failure = null;
    this.readyResolved = false;
    this.failedChildren = new WeakSet();
    this.nextRequestId = 1;
    this.pending = new Map();
    this.repository = new RepositoryFacade(this);
    this.runtime = new UtilityFacade(this, 'runtime', RUNTIME_METHODS, 'scan-event');
    this.coordinator = new UtilityFacade(this, 'coordinator', COORDINATOR_METHODS, 'event');
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.spawnChild();
  }

  static async open(options) {
    const host = new LibraryCatalogUtilityHost(options);
    const openTimeoutMs = Number.isFinite(options?.openTimeoutMs) && options.openTimeoutMs > 0
      ? options.openTimeoutMs
      : UTILITY_OPEN_TIMEOUT_MS;
    let timeoutId;
    try {
      await Promise.race([
        host.ready,
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(createUtilityError(
            'utilityOpenTimeout', 'Library utility initialization timed out'
          )), openTimeoutMs);
        })
      ]);
      return host;
    } catch (error) {
      await host.close();
      throw error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async request(target, method, args = []) {
    await this.ready;
    if (this.failure) throw this.failure;
    if (this.closed || this.closing) throw createUtilityError('utilityClosed', 'Library utility is closed');
    if (this.pending.size >= MAX_UTILITY_OUTSTANDING_REQUESTS) {
      throw createUtilityError('utilityBusy', 'The music library is busy. Please try again.');
    }
    const requestId = this.nextRequestId++;
    const message = {
      protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
      type: 'request', requestId, target, method, args
    };
    assertBoundedMessage(message);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.post(message);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }

  post(message) {
    this.child.postMessage(message);
  }

  spawnChild() {
    const child = this.processFactory(this.modulePath);
    this.child = child;
    child.on('message', message => {
      if (child === this.child) this.handleMessage(unwrapMessage(message));
    });
    child.on('exit', code => {
      if (!this.closed && !this.closing) {
        this.handleChildFailure(child, createUtilityError('utilityExited', `Library utility exited with code ${code}`)).catch(() => {});
      }
    });
    child.on('error', error => this.handleChildFailure(child, error).catch(() => {}));
    child.postMessage({
      type: 'initialize',
      dbPath: this.dbPath,
      protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION
    });
  }

  async handleChildFailure(child, error) {
    if (this.closed || this.closing || child !== this.child || this.failedChildren.has(child)) return;
    this.failedChildren.add(child);
    child.kill?.();
    await this.failPermanently(createUtilityError(
      'utilityUnavailable',
      'The music library utility is unavailable.',
      { lastCode: String(error?.code || error?.name || 'utilityError').slice(0, 128) }
    ));
  }

  async handleMessage(message) {
    if (!message || message.protocolVersion !== LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION) {
      await this.handleChildFailure(this.child, createUtilityError('utilityProtocolMismatch', 'Library utility protocol mismatch'));
      return;
    }
    try {
      assertBoundedMessage(
        message,
        message.type === 'artwork-thumbnail-request'
          ? MAX_ARTWORK_BRIDGE_MESSAGE_BYTES
          : MAX_UTILITY_MESSAGE_BYTES
      );
    } catch (error) {
      await this.handleChildFailure(this.child, error);
      return;
    }
    if (message.type === 'ready') {
      if (message.ok === false) {
        await this.handleChildFailure(this.child, deserializeError(message.error));
      } else {
        if (!this.readyResolved) {
          this.readyResolved = true;
          this.resolveReady(message.payload);
        }
      }
      return;
    }
    if (message.type === 'response') {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      this.pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.payload);
      else pending.reject(deserializeError(message.error));
      return;
    }
    if (message.type === 'fatal') {
      const failedChild = this.child;
      failedChild.kill?.();
      await this.handleChildFailure(failedChild, deserializeError(message.error));
      return;
    }
    if (message.type === 'dialog-request') {
      await this.handleDialogRequest(message);
      return;
    }
    if (message.type === 'artwork-thumbnail-request') {
      await this.handleArtworkThumbnailRequest(message);
      return;
    }
    if (message.type === 'event') {
      const facade = message.target === 'runtime'
        ? this.runtime
        : message.target === 'repository' ? this.repository : this.coordinator;
      facade.emit(message.eventName, message.payload);
    }
  }

  async handleDialogRequest(message) {
    try {
      const result = await this.performDialog(message.kind);
      this.postUtilityResponse('dialog-response', message.requestId, true, result);
    } catch (error) {
      this.postUtilityResponse('dialog-response', message.requestId, false, null, error);
    }
  }

  async handleArtworkThumbnailRequest(message) {
    try {
      const source = message.bytes;
      if (!ArrayBuffer.isView(source) && !(source instanceof ArrayBuffer)) {
        throw createUtilityError('invalidArtworkThumbnailRequest', 'Artwork thumbnail bytes are invalid');
      }
      const result = createArtworkThumbnail(source, this.imageAdapter);
      this.postUtilityResponse('artwork-thumbnail-response', message.requestId, true, result);
    } catch (error) {
      this.postUtilityResponse('artwork-thumbnail-response', message.requestId, false, null, error);
    }
  }

  async performDialog(kind) {
    if (kind === 'folder') {
      const result = await this.dialog.showOpenDialog(this.getMainWindow(), {
        title: 'Select Music Folder', properties: ['openDirectory']
      });
      if (result.canceled || !Array.isArray(result.filePaths) || result.filePaths.length !== 1) {
        return { canceled: true, filePaths: [] };
      }
      const selected = result.filePaths[0];
      if (typeof selected !== 'string' || !path.isAbsolute(selected)) {
        throw createUtilityError('invalidFolderPath', 'Selected folder path is invalid');
      }
      const canonical = path.resolve(await fs.promises.realpath(path.resolve(selected)));
      const stats = await fs.promises.lstat(canonical);
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw createUtilityError('invalidFolderPath', 'Selected folder must be a real directory');
      }
      await fs.promises.access(canonical, fs.constants.R_OK);
      return { canceled: false, filePaths: [canonical] };
    }
    if (kind === 'playlist') {
      return this.dialog.showOpenDialog(this.getMainWindow(), {
        title: 'Import Playlist', properties: ['openFile'],
        filters: [{ name: 'Playlists', extensions: ['m3u', 'm3u8', 'pls', 'xspf'] }]
      });
    }
    if (kind === 'folder-consolidation') {
      if (typeof this.dialog.showMessageBox !== 'function') {
        throw createUtilityError('invalidUtilityDialog', 'A confirmation dialog adapter is required');
      }
      return this.dialog.showMessageBox(
        this.getMainWindow(),
        createFolderConsolidationDialogOptions(this.translate)
      );
    }
    throw createUtilityError('unknownDialogRequest', 'Library utility requested an unknown dialog');
  }

  postUtilityResponse(type, requestId, ok, payload, error) {
    const message = {
      protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
      type, requestId, ok,
      ...(ok ? { payload } : { error: serializeError(error) })
    };
    assertBoundedMessage(message);
    this.post(message);
  }

  async failPermanently(error) {
    if (this.failure) return;
    this.failure = error;
    if (!this.readyResolved) {
      this.rejectReady(error);
    }
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.repository.emit('failure', error);
    this.runtime.emit('failure', error);
    this.coordinator.emit('failure', error);
  }

  async close() {
    if (this.closed || this.closing) return;
    this.closing = true;
    let timeoutId;
    try {
      await Promise.race([
        this.requestDuringClose('system', 'close', []),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(createUtilityError(
            'utilityCloseTimeout', 'Library utility close timed out'
          )), this.closeTimeoutMs);
        })
      ]);
    } catch {
      // A failed or unresponsive utility is terminated below.
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      this.closed = true;
      this.child.kill?.();
      const error = createUtilityError('utilityClosed', 'Library utility is closed');
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    }
  }

  async requestDuringClose(target, method, args) {
    await this.ready;
    if (this.failure) throw this.failure;
    const requestId = this.nextRequestId++;
    const message = {
      protocolVersion: LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
      type: 'request', requestId, target, method, args
    };
    assertBoundedMessage(message);
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      try {
        this.post(message);
      } catch (error) {
        this.pending.delete(requestId);
        reject(error);
      }
    });
  }
}

class UtilityFacade extends EventEmitter {
  constructor(host, target, methods, eventName) {
    super();
    this.host = host;
    this.target = target;
    this.eventName = eventName;
    for (const method of methods) {
      this[method] = (...args) => host.request(target, method, args);
    }
  }
}

class RepositoryFacade extends EventEmitter {
  constructor(host) {
    super();
    this.host = host;
    this.request = (command, payload = {}) => host.request('repository', 'request', [command, payload]);
    for (const method of REPOSITORY_METHODS) {
      this[method] = (...args) => host.request('repository', method, args);
    }
  }
}

function unwrapMessage(message) {
  return message && Object.hasOwn(message, 'data') ? message.data : message;
}

function assertBoundedMessage(value, maximumBytes = MAX_UTILITY_MESSAGE_BYTES) {
  let json;
  let binaryBytes = 0;
  try {
    json = JSON.stringify(value, (_key, item) => {
      if (ArrayBuffer.isView(item)) {
        binaryBytes += item.byteLength;
        return { binaryByteLength: item.byteLength };
      }
      if (item instanceof ArrayBuffer) {
        binaryBytes += item.byteLength;
        return { binaryByteLength: item.byteLength };
      }
      return item;
    });
  } catch { json = null; }
  if (!json || Buffer.byteLength(json, 'utf8') + binaryBytes > maximumBytes) {
    throw createUtilityError('utilityMessageTooLarge', 'Library utility message exceeds the byte limit');
  }
}

function serializeError(error) {
  return {
    name: String(error?.name || 'Error').slice(0, 128),
    code: String(error?.code || 'utilityError').slice(0, 128),
    message: String(error?.message || 'Library utility request failed').slice(0, 1024),
    details: error?.details && typeof error.details === 'object' ? error.details : {}
  };
}

function deserializeError(payload = {}) {
  return createUtilityError(payload.code || 'utilityError', payload.message || 'Library utility request failed', payload.details);
}

function createUtilityError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'LibraryCatalogUtilityError';
  error.code = code;
  error.details = details || {};
  return error;
}

module.exports = {
  LIBRARY_CATALOG_UTILITY_PROTOCOL_VERSION,
  LibraryCatalogUtilityHost,
  MAX_ARTWORK_BRIDGE_MESSAGE_BYTES,
  MAX_UTILITY_MESSAGE_BYTES,
  MAX_UTILITY_OUTSTANDING_REQUESTS,
  UTILITY_CLOSE_TIMEOUT_MS,
  UTILITY_OPEN_TIMEOUT_MS
};
