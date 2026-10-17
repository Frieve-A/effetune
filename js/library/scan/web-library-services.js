import { createRepositoryError } from '../repository/contract-errors.js';
import { normalizeRelativePath } from '../constants.js';
import { WebFolderHandleStore } from './web-folder-handle-store.js';

const STORAGE_PERSIST_TIMEOUT_MS = 2_000;

export function createWebLibraryServices({
  client,
  windowRef = globalThis.window,
  handleStore = null,
  translate = null,
  persistTimeoutMs = STORAGE_PERSIST_TIMEOUT_MS
} = {}) {
  const storedHandles = handleStore ?? createStoredHandleStore(windowRef);
  const folderService = {
    async addFolder(options = {}) {
      const selection = await pickLibraryFolder(windowRef, options);
      if (!selection) return null;
      await persistStorage(windowRef, persistTimeoutMs);
      const request = {
        ...selection,
        displayName: options.displayName ?? selection.displayName,
        scan: options.scan !== false,
        scanReason: options.scanReason ?? 'automatic',
        languageHints: options.languageHints ?? null,
        includeVideo: options.includeVideo === true
      };
      const result = await client.addFolder(request);
      if (result?.confirmationRequired !== true) return result;
      if (!confirmParentFolderMerge(windowRef, translate)) return { canceled: true };
      for (const folder of result.contained ?? []) {
        await client.removeFolder({ folderId: folder.id });
      }
      const added = await client.addFolder(request);
      if (added?.confirmationRequired === true) {
        throw createRepositoryError('folderRootsChanged', 'Library folders changed while adding the parent folder');
      }
      return added;
    },

    async requestFolderAccess(folderIdOrOptions, options = {}) {
      const folderId = typeof folderIdOrOptions === 'string'
        ? folderIdOrOptions
        : folderIdOrOptions?.folderId;
      const request = typeof folderIdOrOptions === 'object'
        ? folderIdOrOptions
        : options;
      throwIfAborted(request.signal);
      let selection = selectionFrom(request);
      if (!selection && typeof windowRef?.showDirectoryPicker === 'function') {
        const stored = await restoreStoredHandleAccess(storedHandles, folderId, request);
        throwIfAborted(request.signal);
        if (stored.handle) {
          selection = { handle: stored.handle, displayName: stored.handle.name };
        } else if (stored.attempted) {
          return null;
        } else {
          const handle = await pickDirectory(windowRef, request);
          throwIfAborted(request.signal);
          if (handle) selection = { handle, displayName: handle.name };
        }
      }
      selection ??= await pickLibraryFolder(windowRef, request);
      throwIfAborted(request.signal);
      if (!selection) return null;
      await persistStorage(windowRef, persistTimeoutMs);
      throwIfAborted(request.signal);
      const result = await client.requestFolderAccess({ folderId, ...selection });
      throwIfAborted(request.signal);
      return result;
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

async function restoreStoredHandleAccess(handleStore, folderId, request = {}) {
  if (!handleStore || typeof folderId !== 'string' || folderId.length === 0) {
    return { attempted: false, handle: null };
  }
  let handle;
  try {
    handle = await handleStore.get(folderId);
    throwIfAborted(request.signal);
  } catch (error) {
    throwIfAborted(request.signal);
    console.warn('Unable to read the saved library folder handle.', error);
    return { attempted: false, handle: null };
  }
  if (!handle) return { attempted: false, handle: null };
  try {
    if (typeof handle.queryPermission === 'function') {
      const current = await handle.queryPermission({ mode: 'read' });
      throwIfAborted(request.signal);
      if (current === 'granted') return { attempted: true, handle };
    }
    if (typeof handle.requestPermission !== 'function') {
      return { attempted: false, handle: null };
    }
    const permission = await runUserInteraction(
      request,
      () => handle.requestPermission({ mode: 'read' })
    );
    return { attempted: true, handle: permission === 'granted' ? handle : null };
  } catch (error) {
    throwIfAborted(request.signal);
    console.warn('Unable to restore access to the saved library folder.', error);
    return { attempted: true, handle: null };
  }
}

async function pickDirectory(windowRef, request = {}) {
  if (typeof windowRef?.showDirectoryPicker !== 'function') {
    throw createRepositoryError('folderPickerUnavailable', 'File System Access folder selection is unavailable');
  }
  try {
    return await runUserInteraction(request, () => windowRef.showDirectoryPicker({
      mode: 'read',
      startIn: 'music',
      id: 'effetune-library-v2'
    }));
  } catch (error) {
    if (error?.name === 'AbortError') return null;
    throw error;
  }
}

function directoryHandleFrom(options) {
  if (options?.kind === 'directory') return options;
  return options?.handle?.kind === 'directory' ? options.handle : null;
}

function selectionFrom(options = {}) {
  const handle = directoryHandleFrom(options);
  if (handle) return { handle, displayName: handle.name };
  const sessionFiles = sessionFilesFrom(options.files ?? options.sessionFiles);
  if (!sessionFiles) return null;
  return {
    sessionFiles,
    displayName: options.displayName ?? inferRootName(options.files ?? options.sessionFiles)
  };
}

async function pickLibraryFolder(windowRef, options = {}) {
  const supplied = selectionFrom(options);
  if (supplied) return supplied;
  if (typeof windowRef?.showDirectoryPicker === 'function') {
    const handle = await pickDirectory(windowRef, options);
    return handle ? { handle, displayName: handle.name } : null;
  }
  const files = await pickDirectoryFiles(windowRef, options);
  const sessionFiles = sessionFilesFrom(files);
  return sessionFiles?.length
    ? { sessionFiles, displayName: inferRootName(files) }
    : null;
}

function sessionFilesFrom(files) {
  if (files == null) return null;
  const values = Array.from(files);
  return values.map(file => ({ file, relativePath: normalizeImportPath(file) }));
}

function normalizeImportPath(file) {
  const raw = file?.webkitRelativePath || file?.relativePath || file?.name;
  const parts = String(raw || '').replaceAll('\\', '/').split('/').filter(Boolean);
  return normalizeRelativePath(parts.length > 1 ? parts.slice(1).join('/') : parts.join('/'));
}

function inferRootName(files) {
  const first = Array.from(files ?? [])[0];
  const raw = first?.webkitRelativePath || first?.relativePath || first?.name || '';
  return String(raw).split(/[\\/]/)[0] || 'Imported Folder';
}

function pickDirectoryFiles(windowRef, request = {}) {
  if (!windowRef?.document?.createElement || !windowRef.document.body) {
    return Promise.reject(createRepositoryError('folderPickerUnavailable', 'Folder selection is unavailable'));
  }
  return runUserInteraction(request, () => new Promise(resolve => {
    const input = windowRef.document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    input.style.display = 'none';
    let settled = false;
    let focusTimer = null;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (focusTimer !== null) clearTimeout(focusTimer);
      windowRef.removeEventListener?.('focus', onFocus);
      const files = Array.from(input.files || []);
      input.remove();
      resolve(files);
    };
    const onFocus = () => {
      focusTimer = setTimeout(settle, 1000);
    };
    input.addEventListener('change', settle, { once: true });
    input.addEventListener('cancel', settle, { once: true });
    windowRef.addEventListener?.('focus', onFocus, { once: true });
    windowRef.document.body.appendChild(input);
    input.click();
  }));
}

async function persistStorage(windowRef, timeoutMs) {
  let timeoutId = null;
  try {
    const persistPromise = windowRef?.navigator?.storage?.persist?.();
    if (!persistPromise) return;
    await Promise.race([
      persistPromise,
      new Promise(resolve => {
        timeoutId = setTimeout(resolve, timeoutMs);
      })
    ]);
  } catch {
    // Persistence is a best-effort browser hint.
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

async function runUserInteraction(request, action) {
  throwIfAborted(request.signal);
  request.onUserInteractionChange?.(true);
  try {
    return await action();
  } finally {
    request.onUserInteractionChange?.(false);
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason ?? createRepositoryError('cancelled', 'Operation cancelled');
}

function confirmParentFolderMerge(windowRef, translate) {
  const key = 'library.confirm.mergeFolders';
  const translated = typeof translate === 'function' ? translate(key) : key;
  const message = translated && translated !== key
    ? translated
    : 'The selected folder contains folders that are already in the library. Replace them with the selected parent folder?';
  return typeof windowRef?.confirm === 'function' && windowRef.confirm(message) === true;
}
