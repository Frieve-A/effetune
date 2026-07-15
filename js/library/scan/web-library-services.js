import { createRepositoryError } from '../repository/contract-errors.js';
import { WebFolderHandleStore } from './web-folder-handle-store.js';

export function createWebLibraryServices({ client, windowRef = globalThis.window, handleStore = null } = {}) {
  const storedHandles = handleStore ?? createStoredHandleStore(windowRef);
  const folderService = {
    async addFolder(options = {}) {
      const handle = directoryHandleFrom(options) ?? await pickDirectory(windowRef);
      if (!handle) return null;
      await persistStorage(windowRef);
      return client.addFolder({
        handle,
        displayName: options.displayName ?? handle.name,
        scan: options.scan !== false,
        scanReason: options.scanReason ?? 'automatic'
      });
    },

    async requestFolderAccess(folderIdOrOptions, options = {}) {
      const folderId = typeof folderIdOrOptions === 'string'
        ? folderIdOrOptions
        : folderIdOrOptions?.folderId;
      const request = typeof folderIdOrOptions === 'object'
        ? folderIdOrOptions
        : options;
      let handle = directoryHandleFrom(request);
      if (!handle) {
        const stored = await restoreStoredHandleAccess(storedHandles, folderId);
        if (stored.handle) {
          handle = stored.handle;
        } else if (stored.attempted) {
          return null;
        } else {
          handle = await pickDirectory(windowRef);
        }
      }
      if (!handle) return null;
      await persistStorage(windowRef);
      return client.requestFolderAccess({ folderId, handle });
    },

    async removeFolder(folderIdOrOptions) {
      const folderId = typeof folderIdOrOptions === 'string'
        ? folderIdOrOptions
        : folderIdOrOptions?.folderId;
      return client.removeFolder({ folderId });
    }
  };

  const scanService = {
    scanFolders: options => client.scanFolders(options ?? {}),
    cancelScan: scanIdOrOptions => client.cancelScan(typeof scanIdOrOptions === 'string'
      ? { scanId: scanIdOrOptions }
      : scanIdOrOptions ?? {})
  };

  return Object.freeze({ folderService, scanService });
}

function createStoredHandleStore(windowRef) {
  if (!windowRef?.indexedDB) return null;
  return new WebFolderHandleStore({ indexedDB: windowRef.indexedDB });
}

async function restoreStoredHandleAccess(handleStore, folderId) {
  if (!handleStore || typeof folderId !== 'string' || folderId.length === 0) {
    return { attempted: false, handle: null };
  }
  let handle;
  try {
    handle = await handleStore.get(folderId);
  } catch (error) {
    console.warn('Unable to read the saved library folder handle.', error);
    return { attempted: false, handle: null };
  }
  if (!handle) return { attempted: false, handle: null };
  try {
    if (typeof handle.queryPermission === 'function') {
      const current = await handle.queryPermission({ mode: 'read' });
      if (current === 'granted') return { attempted: true, handle };
    }
    if (typeof handle.requestPermission !== 'function') {
      return { attempted: false, handle: null };
    }
    const permission = await handle.requestPermission({ mode: 'read' });
    return { attempted: true, handle: permission === 'granted' ? handle : null };
  } catch (error) {
    console.warn('Unable to restore access to the saved library folder.', error);
    return { attempted: true, handle: null };
  }
}

async function pickDirectory(windowRef) {
  if (typeof windowRef?.showDirectoryPicker !== 'function') {
    throw createRepositoryError('folderPickerUnavailable', 'File System Access folder selection is unavailable');
  }
  try {
    return await windowRef.showDirectoryPicker({
      mode: 'read',
      startIn: 'music',
      id: 'effetune-library-v2'
    });
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    throw error;
  }
}

function directoryHandleFrom(options) {
  if (options?.kind === 'directory') return options;
  return options?.handle?.kind === 'directory' ? options.handle : null;
}

async function persistStorage(windowRef) {
  try {
    await windowRef?.navigator?.storage?.persist?.();
  } catch {
    // Persistence is a best-effort browser hint.
  }
}
