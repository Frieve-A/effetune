import { ElectronIrLibraryBackend } from './electron-ir-library-backend.js';
import { IrLibraryStore } from './ir-library-store.js';
import { PersistentIrPcmCache } from './ir-pcm-cache.js';
import { openOpfsIrLibraryBackend } from './opfs-ir-library-backend.js';

export async function openIrLibrary(options = {}) {
  let backend;
  let requestPersistence = null;
  const electronBridge = options.electronBridge || globalThis.window?.electronAPI?.irLibraryV1;
  try {
    backend = await openOpfsIrLibraryBackend(options.storage);
    const storage = options.storage || globalThis.navigator?.storage;
    if (!electronBridge && typeof storage?.persist === 'function') requestPersistence = () => storage.persist();
  } catch (error) {
    if (!electronBridge) {
      options.onDiagnostic?.(error);
      const failure = new Error('The IR library is unavailable.');
      failure.code = 'ir-library-unavailable';
      throw failure;
    }
    options.onDiagnostic?.(error);
    backend = new ElectronIrLibraryBackend(electronBridge);
  }
  let pcmCache = null;
  try {
    pcmCache = await new PersistentIrPcmCache(backend, options).open();
  } catch (error) {
    options.onDiagnostic?.(error);
  }
  const store = new IrLibraryStore(backend, { ...options, requestPersistence, pcmCache });
  await store.open();
  return store;
}
