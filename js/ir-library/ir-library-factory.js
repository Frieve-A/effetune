import { ElectronIrLibraryBackend } from './electron-ir-library-backend.js';
import { IR_LIBRARY_INDEX_NAME, IrLibraryStore } from './ir-library-store.js';
import { PersistentIrPcmCache } from './ir-pcm-cache.js';
import { openOpfsIrLibraryBackend } from './opfs-ir-library-backend.js';

// Written into native storage once the legacy browser-storage (OPFS) library
// has been copied there, or once OPFS was found to hold no library. While it
// exists the desktop app never opens OPFS again, so a locked or corrupt
// Chromium storage layer cannot stall or break the IR library. The OPFS copy
// itself is left untouched so an older version can still read it.
export const IR_LIBRARY_MIGRATION_MARKER_NAME = 'legacy-migration.json';

// Reading the legacy OPFS library is best effort, so a Chromium storage layer
// that never answers (a quota manager held by another process) must not stall
// the desktop app. Beyond this the legacy library is treated as unreadable.
const LEGACY_READ_DEADLINE_MS = 5000;

const encoder = new TextEncoder();
const progressListeners = new Set();
const migrationsByBridge = new WeakMap();

function withDeadline(promise, timeoutMs) {
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Legacy IR library storage did not respond.')), timeoutMs);
    timer?.unref?.();
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function unavailableError() {
  const failure = new Error('The IR library is unavailable.');
  failure.code = 'ir-library-unavailable';
  return failure;
}

export function subscribeIrLibraryMigrationProgress(listener) {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

function emitProgress(progress) {
  for (const listener of [...progressListeners]) {
    try {
      listener(progress);
    } catch {
      // Progress reporting never interrupts the migration itself.
    }
  }
}

async function migrateOpfsLibrary(source, target, indexBytes) {
  // Every legacy read keeps its own deadline: a Chromium storage layer that
  // stops answering part way through the copy must fail the migration instead
  // of leaving the library open pending forever.
  const names = (await withDeadline(source.list(), LEGACY_READ_DEADLINE_MS))
    .filter(name => name !== IR_LIBRARY_INDEX_NAME);
  const progress = { phase: 'copying', completedCount: 0, totalCount: names.length + 1, bytes: 0 };
  emitProgress({ ...progress });
  for (const name of names) {
    const bytes = await withDeadline(source.read(name), LEGACY_READ_DEADLINE_MS);
    if (!bytes) throw new Error('An IR library item disappeared during migration.');
    await target.writeAtomic(name, bytes);
    progress.completedCount += 1;
    progress.bytes += bytes.byteLength;
    emitProgress({ ...progress });
  }
  // The index is committed last so an interrupted copy is retried from scratch
  // instead of exposing a partial library.
  await target.writeAtomic(IR_LIBRARY_INDEX_NAME, indexBytes);
  progress.completedCount += 1;
  progress.bytes += indexBytes.byteLength;
  emitProgress({ ...progress, phase: 'done' });
  return { migratedCount: names.length, migratedBytes: progress.bytes };
}

async function writeMigrationMarker(nativeBackend, result, diagnostic) {
  const marker = {
    version: 1,
    source: 'opfs',
    status: result.status,
    migratedCount: result.migratedCount || 0,
    migratedBytes: result.migratedBytes || 0,
    completedAt: new Date().toISOString()
  };
  try {
    await nativeBackend.writeAtomic(IR_LIBRARY_MIGRATION_MARKER_NAME, encoder.encode(JSON.stringify(marker)));
  } catch (error) {
    // Without the marker the next open re-checks OPFS, which is safe.
    diagnostic?.(error);
  }
}

async function runElectronMigration(nativeBackend, storage, diagnostic) {
  try {
    if (await nativeBackend.exists(IR_LIBRARY_INDEX_NAME)) return { status: 'native' };
    if (await nativeBackend.exists(IR_LIBRARY_MIGRATION_MARKER_NAME)) return { status: 'native' };
  } catch (error) {
    diagnostic?.(error);
    throw unavailableError();
  }
  // Native storage is the library; OPFS is only a legacy source. A broken,
  // locked or unresponsive Chromium storage layer therefore skips the copy
  // instead of taking the library down with it. No marker is written, so the
  // next launch retries the copy.
  let opfsBackend;
  let indexBytes;
  try {
    opfsBackend = await withDeadline(openOpfsIrLibraryBackend(storage), LEGACY_READ_DEADLINE_MS);
    indexBytes = await withDeadline(opfsBackend.read(IR_LIBRARY_INDEX_NAME), LEGACY_READ_DEADLINE_MS);
  } catch (error) {
    diagnostic?.(error);
    return { status: 'skipped' };
  }
  let result;
  try {
    // A copy that starts and then fails would leave the legacy library only
    // half visible, so it keeps reporting the library as unavailable.
    result = indexBytes
      ? { status: 'migrated', ...(await migrateOpfsLibrary(opfsBackend, nativeBackend, indexBytes)) }
      : { status: 'empty' };
  } catch (error) {
    diagnostic?.(error);
    throw unavailableError();
  }
  await writeMigrationMarker(nativeBackend, result, diagnostic);
  return result;
}

/**
 * Copies a legacy OPFS library into Electron native storage exactly once per
 * bridge. Safe to call at startup and again from any library open; concurrent
 * callers share the same run. Resolves to { status } where status is
 * 'native' (nothing to do), 'migrated', 'empty', 'skipped' (the legacy library
 * could not be read; retried on the next launch), or 'not-electron'.
 */
export function ensureElectronIrLibraryMigration(options = {}) {
  const electronBridge = options.electronBridge || globalThis.window?.electronAPI?.irLibraryV1;
  if (!electronBridge) return Promise.resolve({ status: 'not-electron' });
  const storage = options.storage || globalThis.navigator?.storage;
  let migration = migrationsByBridge.get(electronBridge);
  if (!migration) {
    let nativeBackend;
    try {
      nativeBackend = new ElectronIrLibraryBackend(electronBridge);
    } catch (error) {
      options.onDiagnostic?.(error);
      return Promise.reject(unavailableError());
    }
    const current = runElectronMigration(nativeBackend, storage, options.onDiagnostic).catch(error => {
      if (migrationsByBridge.get(electronBridge) === current) migrationsByBridge.delete(electronBridge);
      throw error;
    });
    migration = current;
    migrationsByBridge.set(electronBridge, current);
  }
  return migration;
}

export function resetIrLibraryMigrationForTests(electronBridge) {
  if (electronBridge) migrationsByBridge.delete(electronBridge);
  progressListeners.clear();
}

async function openElectronBackend(electronBridge, storage, diagnostic) {
  await ensureElectronIrLibraryMigration({ electronBridge, storage, onDiagnostic: diagnostic });
  return new ElectronIrLibraryBackend(electronBridge);
}

export async function openIrLibrary(options = {}) {
  let backend;
  let requestPersistence = null;
  const electronBridge = options.electronBridge || globalThis.window?.electronAPI?.irLibraryV1;
  const storage = options.storage || globalThis.navigator?.storage;
  if (electronBridge) {
    backend = await openElectronBackend(electronBridge, storage, options.onDiagnostic);
  } else {
    try {
      backend = await openOpfsIrLibraryBackend(storage);
      if (typeof storage?.persist === 'function') requestPersistence = () => storage.persist();
    } catch (error) {
      options.onDiagnostic?.(error);
      throw unavailableError();
    }
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
