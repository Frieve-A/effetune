'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const LIBRARY_CATALOG_RECOVERY_API_VERSION = 1;
const LIBRARY_CATALOG_DIRECTORY_NAME = 'music-library-v2';
const LIBRARY_CATALOG_RECOVERY_CHANNELS = Object.freeze({
  getState: 'library-recovery-v1:get-state',
  resetCatalog: 'library-recovery-v1:reset-catalog',
  state: 'library-recovery-v1:state'
});

const STATE_MESSAGES = Object.freeze({
  initializing: 'The Music Library is starting. Audio effects remain available.',
  available: '',
  unavailable: 'The Music Library is unavailable. Audio effects remain available. You can reset the saved Library catalog without changing your audio files, presets, or other settings.',
  resetting: 'The saved Music Library catalog is being reset. Audio effects remain available.'
});

class LibraryCatalogRecovery extends EventEmitter {
  constructor({
    userDataPath,
    openCatalog,
    closeCatalog,
    fsPromises = fs.promises,
    onDiagnostic = () => {}
  } = {}) {
    super();
    if (typeof openCatalog !== 'function' || typeof closeCatalog !== 'function') {
      throw new TypeError('Catalog recovery lifecycle adapters are required');
    }
    if (!fsPromises || typeof fsPromises.lstat !== 'function' ||
        typeof fsPromises.rm !== 'function' || typeof fsPromises.unlink !== 'function') {
      throw new TypeError('A filesystem adapter is required');
    }
    this.paths = resolveLibraryCatalogPaths(userDataPath);
    this.openCatalog = openCatalog;
    this.closeCatalog = closeCatalog;
    this.fsPromises = fsPromises;
    this.onDiagnostic = onDiagnostic;
    this.status = 'initializing';
    this.operation = null;
    this.pendingUnavailablePromise = null;
    this.closed = false;
  }

  getState() {
    return publicState(this.status);
  }

  initialize() {
    return this.runExclusive(async () => {
      await this.openOrDegrade('initializing');
      return this.getState();
    });
  }

  markUnavailable(error) {
    this.reportDiagnostic(error);
    if (this.pendingUnavailablePromise) return this.pendingUnavailablePromise;
    const activeOperation = this.operation?.catch(() => {}) ?? Promise.resolve();
    const promise = activeOperation.then(() => {
      if (this.closed) return this.getState();
      return this.runExclusive(async () => {
        this.setStatus('unavailable');
        try {
          await this.closeCatalog();
        } catch (closeError) {
          this.reportDiagnostic(closeError);
        }
        return this.getState();
      });
    });
    const settled = promise.finally(() => {
      if (this.pendingUnavailablePromise === settled) this.pendingUnavailablePromise = null;
    });
    this.pendingUnavailablePromise = settled;
    return settled;
  }

  resetCatalog({ confirmed = false } = {}) {
    if (confirmed !== true) {
      return Promise.resolve(resetResult(
        { reset: false, canceled: true, recovered: false },
        this.getState()
      ));
    }
    if (this.status !== 'unavailable' || this.closed || this.operation) {
      return Promise.resolve(resetResult(
        { reset: false, canceled: false, recovered: false },
        this.getState()
      ));
    }
    return this.runExclusive(async () => {
      if (this.status !== 'unavailable' || this.closed) {
        return resetResult({ reset: false, canceled: false, recovered: false }, this.getState());
      }

      this.setStatus('resetting');
      try {
        await this.closeCatalog();
      } catch (error) {
        this.reportDiagnostic(error);
        this.setStatus('unavailable');
        return resetResult({ reset: false, canceled: false, recovered: false }, this.getState());
      }

      try {
        await removeLibraryCatalogDirectory(this.paths, this.fsPromises);
      } catch (error) {
        this.reportDiagnostic(error);
        this.setStatus('unavailable');
        return resetResult({ reset: false, canceled: false, recovered: false }, this.getState());
      }

      if (this.closed) {
        this.setStatus('unavailable');
        return resetResult({ reset: true, canceled: false, recovered: false }, this.getState());
      }
      await this.openOrDegrade('resetting');
      return resetResult({
        reset: true,
        canceled: false,
        recovered: this.status === 'available'
      }, this.getState());
    });
  }

  async close() {
    this.closed = true;
    await this.operation?.catch(() => {});
    await this.pendingUnavailablePromise?.catch(() => {});
    try {
      await this.closeCatalog();
    } catch (error) {
      this.reportDiagnostic(error);
    }
  }

  async openOrDegrade(progressStatus) {
    if (this.closed) {
      this.setStatus('unavailable');
      return;
    }
    this.setStatus(progressStatus);
    try {
      await this.openCatalog(this.paths);
      if (this.closed) {
        await this.closeCatalog();
        this.setStatus('unavailable');
      } else {
        this.setStatus('available');
      }
    } catch (error) {
      this.reportDiagnostic(error);
      try {
        await this.closeCatalog();
      } catch (closeError) {
        this.reportDiagnostic(closeError);
      }
      this.setStatus('unavailable');
    }
  }

  setStatus(status) {
    if (!Object.hasOwn(STATE_MESSAGES, status)) throw new TypeError('Invalid catalog recovery status');
    if (this.status === status) return;
    this.status = status;
    this.emit('state', this.getState());
  }

  runExclusive(operation) {
    if (this.operation) return this.operation;
    const promise = Promise.resolve().then(operation);
    const settled = promise.finally(() => {
      if (this.operation === settled) this.operation = null;
    });
    this.operation = settled;
    return settled;
  }

  reportDiagnostic(error) {
    try {
      this.onDiagnostic(error);
    } catch {
      // Diagnostics must not interfere with recovery.
    }
  }
}

function registerLibraryCatalogRecoveryIpc({ ipcMain, recovery, getMainWindow }) {
  if (!ipcMain || typeof ipcMain.handle !== 'function' || typeof ipcMain.removeHandler !== 'function' ||
      !recovery || typeof recovery.getState !== 'function' || typeof recovery.resetCatalog !== 'function' ||
      typeof getMainWindow !== 'function') {
    throw new TypeError('Catalog recovery IPC dependencies are invalid');
  }
  const handlers = {
    [LIBRARY_CATALOG_RECOVERY_CHANNELS.getState]: (event, request) => {
      assertAuthorizedSender(event, getMainWindow);
      assertEmptyRequest(request);
      return recovery.getState();
    },
    [LIBRARY_CATALOG_RECOVERY_CHANNELS.resetCatalog]: (event, request) => {
      assertAuthorizedSender(event, getMainWindow);
      assertConfirmedResetRequest(request);
      return recovery.resetCatalog({ confirmed: request.confirmed });
    }
  };
  const registered = [];
  try {
    for (const [channel, handler] of Object.entries(handlers)) {
      ipcMain.handle(channel, handler);
      registered.push(channel);
    }
  } catch (error) {
    for (const channel of registered) ipcMain.removeHandler(channel);
    throw error;
  }

  const relayState = state => {
    const mainWindow = getMainWindow();
    if (!isUsableMainWindow(mainWindow)) return;
    mainWindow.webContents.send(LIBRARY_CATALOG_RECOVERY_CHANNELS.state, state);
  };
  recovery.on('state', relayState);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    recovery.removeListener('state', relayState);
    for (const channel of registered) ipcMain.removeHandler(channel);
  };
}

function resolveLibraryCatalogPaths(userDataPath) {
  if (typeof userDataPath !== 'string' || !path.isAbsolute(userDataPath)) {
    throw new TypeError('An absolute user data path is required');
  }
  const userDataDirectory = path.resolve(userDataPath);
  const catalogDirectory = path.resolve(userDataDirectory, LIBRARY_CATALOG_DIRECTORY_NAME);
  if (path.dirname(catalogDirectory) !== userDataDirectory ||
      path.basename(catalogDirectory) !== LIBRARY_CATALOG_DIRECTORY_NAME) {
    throw new TypeError('The catalog directory must be a direct child of user data');
  }
  return Object.freeze({
    userDataDirectory,
    catalogDirectory,
    catalogPath: path.join(catalogDirectory, 'catalog.sqlite')
  });
}

async function removeLibraryCatalogDirectory(paths, fsPromises = fs.promises) {
  const expected = resolveLibraryCatalogPaths(paths?.userDataDirectory);
  if (paths.catalogDirectory !== expected.catalogDirectory || paths.catalogPath !== expected.catalogPath) {
    throw new TypeError('Catalog reset target is invalid');
  }
  let stats;
  try {
    stats = await fsPromises.lstat(expected.catalogDirectory);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  if (stats.isSymbolicLink()) {
    await fsPromises.unlink(expected.catalogDirectory);
    return;
  }
  if (!stats.isDirectory()) throw new TypeError('Catalog reset target is not a directory');
  await fsPromises.rm(expected.catalogDirectory, {
    recursive: true,
    force: false,
    maxRetries: 3,
    retryDelay: 100
  });
}

function publicState(status) {
  return Object.freeze({
    apiVersion: LIBRARY_CATALOG_RECOVERY_API_VERSION,
    status,
    available: status === 'available',
    canReset: status === 'unavailable',
    message: STATE_MESSAGES[status]
  });
}

function resetResult(result, state) {
  return Object.freeze({ ...result, state });
}

function assertEmptyRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).length !== 0) {
    throw new TypeError('Catalog recovery request is invalid');
  }
}

function assertConfirmedResetRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).length !== 1 || request.confirmed !== true) {
    throw new TypeError('Catalog recovery reset request is invalid');
  }
}

function assertAuthorizedSender(event, getMainWindow) {
  const mainWindow = getMainWindow();
  if (!isUsableMainWindow(mainWindow) || !event || event.sender !== mainWindow.webContents) {
    throw new TypeError('Catalog recovery sender is not authorized');
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

module.exports = {
  LIBRARY_CATALOG_DIRECTORY_NAME,
  LIBRARY_CATALOG_RECOVERY_API_VERSION,
  LIBRARY_CATALOG_RECOVERY_CHANNELS,
  LibraryCatalogRecovery,
  registerLibraryCatalogRecoveryIpc,
  removeLibraryCatalogDirectory,
  resolveLibraryCatalogPaths
};
