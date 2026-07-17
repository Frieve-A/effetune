import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';

export const WEB_FOLDER_HANDLE_DATABASE_NAME = 'effetune_music_library_v3_handles';
export const WEB_FOLDER_HANDLE_DATABASE_VERSION = 1;

const HANDLE_STORE = 'folderHandlesV3';

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || createRepositoryError('handleStoreRequestFailed', 'Folder handle store request failed'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || createRepositoryError('handleStoreTransactionFailed', 'Folder handle store transaction aborted'));
    transaction.onerror = () => reject(transaction.error || createRepositoryError('handleStoreTransactionFailed', 'Folder handle store transaction failed'));
  });
}

async function runTransaction(database, mode, callback) {
  const transaction = database.transaction([HANDLE_STORE], mode);
  const done = transactionDone(transaction);
  try {
    const result = await callback(transaction.objectStore(HANDLE_STORE));
    await done;
    return result;
  } catch (error) {
    try {
      transaction.abort();
    } catch {
      // The transaction may already be complete.
    }
    await done.catch(() => {});
    throw error;
  }
}

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = indexedDB.open(WEB_FOLDER_HANDLE_DATABASE_NAME, WEB_FOLDER_HANDLE_DATABASE_VERSION);
    request.onupgradeneeded = event => {
      try {
        assertRepositoryContract(
          event.oldVersion >= 0 && event.oldVersion < WEB_FOLDER_HANDLE_DATABASE_VERSION,
          'unsupportedHandleStoreUpgrade',
          'Unsupported Web folder handle-store migration'
        );
        if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
          request.result.createObjectStore(HANDLE_STORE, { keyPath: 'folderId' });
        }
      } catch (error) {
        request.transaction?.abort?.();
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(request.error || createRepositoryError('handleStoreOpenFailed', 'Unable to open the Web folder handle store'));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(createRepositoryError('concurrentUseUnsupported', 'Folder handle store open was blocked'));
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.close();
        settled = true;
        reject(createRepositoryError('incompleteHandleStoreUpgrade', 'Web folder handle store is missing after upgrade'));
        return;
      }
      settled = true;
      resolve(request.result);
    };
  });
}

export class WebFolderHandleStore {
  constructor({ indexedDB = globalThis.indexedDB, now = () => Date.now() } = {}) {
    this.indexedDB = indexedDB;
    this.now = now;
    this.database = null;
  }

  async open() {
    if (this.database) return;
    assertRepositoryContract(this.indexedDB && typeof this.indexedDB.open === 'function', 'indexedDbUnavailable', 'IndexedDB is required for persistent folder handles');
    this.database = await openDatabase(this.indexedDB);
    this.database.onversionchange = () => this.close();
  }

  close() {
    this.database?.close();
    this.database = null;
  }

  async put({ folderId, handle }) {
    await this.open();
    assertDirectoryHandle(handle);
    await runTransaction(this.database, 'readwrite', store => requestResult(store.put({
      folderId: nonEmptyString(folderId, 'folderId'),
      handle,
      updatedAt: this.now()
    })));
  }

  async get(folderId) {
    await this.open();
    const row = await runTransaction(this.database, 'readonly', store => requestResult(store.get(nonEmptyString(folderId, 'folderId'))));
    return row?.handle ?? null;
  }

  async list({ limit = 1_000 } = {}) {
    await this.open();
    assertRepositoryContract(Number.isSafeInteger(limit) && limit > 0 && limit <= 1_000, 'invalidLimit', 'Folder handle limit must be 1..1000');
    const rows = [];
    await runTransaction(this.database, 'readonly', store => new Promise((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error || createRepositoryError('handleStoreRequestFailed', 'Folder handle cursor failed'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor || rows.length >= limit) {
          resolve();
          return;
        }
        rows.push({ folderId: cursor.value.folderId, handle: cursor.value.handle });
        cursor.continue();
      };
    }));
    return rows;
  }

  async delete(folderId) {
    await this.open();
    await runTransaction(this.database, 'readwrite', store => requestResult(store.delete(nonEmptyString(folderId, 'folderId'))));
  }
}

export function assertDirectoryHandle(handle) {
  assertRepositoryContract(
    handle && handle.kind === 'directory' && typeof handle.values === 'function',
    'invalidFolderHandle',
    'A FileSystemDirectoryHandle is required'
  );
  return handle;
}

function nonEmptyString(value, field) {
  assertRepositoryContract(typeof value === 'string' && value.length > 0, 'invalidFolderHandle', `${field} is required`);
  return value;
}
