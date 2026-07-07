import assert from 'node:assert/strict';
import test from 'node:test';

import { CatalogIndex } from '../../js/library/catalog-index.js';
import { LibraryDatabase } from '../../js/library/library-database.js';
import { LibraryManager } from '../../js/library/library-manager.js';
import { ArtworkProcessor } from '../../js/library/metadata/artwork-processor.js';
import { createTrackFromMetadata, shouldRetryDuration } from '../../js/library/metadata/metadata-mapper.js';
import { PlaybackBridge } from '../../js/library/playback-bridge.js';
import { PlaylistStore } from '../../js/library/playlists/playlist-store.js';
import { ScanController } from '../../js/library/scan-controller.js';
import { ElectronLibrarySource } from '../../js/library/sources/electron-library-source.js';
import { FsaLibrarySource } from '../../js/library/sources/fsa-library-source.js';
import { ImportLibrarySource } from '../../js/library/sources/import-library-source.js';
import { createLibrarySource } from '../../js/library/sources/library-source.js';
import { comparePathRoots } from '../../js/library/sources/root-containment.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function createArtworkProcessor() {
  const stored = [];
  return {
    stored,
    async storeArtworkBytes(bytes, sourceKind) {
      stored.push({ bytes, sourceKind });
      return 'artwork_1';
    }
  };
}

test('scan controller strips runtime-only objects before indexing and storage', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({
    id: 'f_music',
    displayName: 'Music',
    path: 'D:/Music',
    status: 'ok'
  });

  const index = new CatalogIndex();
  await index.build({ folders: await database.getAllFolders(), tracks: [] });
  const artwork = createArtworkProcessor();
  const events = [];
  const source = {
    scan(_request, sink) {
      const file = { name: 'Song.flac' };
      const handle = { kind: 'file' };
      const provider = async () => file;
      return {
        done: (async () => {
          await sink({
            type: 'batch',
            tracks: [{
              folderId: 'f_music',
              relativePath: 'Album/Song.flac',
              fileName: 'Song.flac',
              title: 'Song',
              artist: 'Artist',
              durationSec: 12,
              artworkBytes: Uint8Array.from([1, 2, 3]),
              artworkSourceKind: 'embedded',
              file,
              handle,
              provider
            }]
          });
          await sink({
            type: 'done',
            seenFiles: [{ folderId: 'f_music', relativePath: 'Album/Song.flac' }]
          });
        })()
      };
    }
  };

  const controller = new ScanController({
    database,
    index,
    source,
    artworkProcessor: artwork,
    emit(event, payload) {
      events.push([event, payload]);
    }
  });

  await controller.scanFolders(await database.getAllFolders());

  const [storedTrack] = await database.getAllTracks();
  const indexedTrack = index.getTrackById(storedTrack.id);
  assert.equal(storedTrack.artworkId, 'artwork_1');
  assert.ok(storedTrack.albumKey);
  assert.equal(storedTrack.albumKey, index.createAlbumKey(storedTrack));
  assert.equal(indexedTrack.albumKey, storedTrack.albumKey);
  assert.equal(storedTrack.file, undefined);
  assert.equal(storedTrack.handle, undefined);
  assert.equal(storedTrack.provider, undefined);
  assert.equal(storedTrack.artworkBytes, undefined);
  assert.equal(storedTrack.artworkSourceKind, undefined);
  assert.equal(indexedTrack.file, undefined);
  assert.equal(artwork.stored[0].sourceKind, 'embedded');
  assert.ok(events.some(([event, payload]) => event === 'scan-state' && payload.phase === 'done'));
});

test('library manager keeps import files in memory for the initial scan but not in persisted folders', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const runtimeFile = { name: 'Runtime.wav' };
  const scanCalls = [];
  const releasedFolders = [];
  const source = {
    kind: 'import',
    async pickFolder() {
      return {
        kind: 'import',
        displayName: 'Picked Files',
        path: null,
        files: [runtimeFile]
      };
    },
    async checkFolder() {
      return 'ok';
    },
    scan(request, sink) {
      scanCalls.push(request.folders[0]);
      return {
        done: sink({ type: 'done', seenFiles: [] })
      };
    },
    releaseFolder(folderId) {
      releasedFolders.push(folderId);
    }
  };
  const uiManager = { createAudioPlayer() {} };
  const manager = new LibraryManager({ uiManager, database, source });
  await manager.init();

  const folder = await manager.addFolder();
  const [persisted] = await database.getAllFolders();

  assert.equal(folder.files, undefined);
  assert.equal(persisted.files, undefined);
  assert.deepEqual(scanCalls[0].files, [runtimeFile]);
  assert.deepEqual(manager.getFolders()[0].files, [runtimeFile]);

  await manager.removeFolder(folder.id);

  assert.deepEqual(releasedFolders, [folder.id]);
});

test('library manager reconnects offline import folders without persisting File objects', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({
    id: 'f_import',
    kind: 'import',
    displayName: 'Imported',
    path: null,
    status: 'needs-permission'
  });
  const runtimeFile = { name: 'Reconnected.wav' };
  const source = {
    async checkFolder() {
      return 'needs-permission';
    },
    async requestAccess(folder) {
      folder.files = [runtimeFile];
      return true;
    },
    scan(_request, sink) {
      return { done: sink({ type: 'done', seenFiles: [] }) };
    }
  };
  const manager = new LibraryManager({ uiManager: {}, database, source });
  await manager.init();

  assert.equal(await manager.requestFolderAccess('f_import'), true);
  const [persisted] = await database.getAllFolders();
  const [runtime] = manager.getFolders();

  assert.equal(persisted.files, undefined);
  assert.equal(runtime.status, 'ok');
  assert.deepEqual(runtime.files, [runtimeFile]);
});

test('scan sweep downgrades removed playlist tracks to unresolved items', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_music', displayName: 'Music', path: 'D:/Music', status: 'ok' };
  const track = {
    id: 't_removed',
    folderId: 'f_music',
    relativePath: 'Gone/Track.flac',
    fileName: 'Track.flac',
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    durationSec: 91
  };
  await database.putFolder(folder);
  await database.putTracks([track]);
  await database.putPlaylist({
    id: 'p_one',
    name: 'Saved',
    createdAt: 1,
    updatedAt: 1,
    items: [{ trackId: 't_removed' }]
  });
  const index = new CatalogIndex();
  await index.build({ folders: [folder], tracks: [track] });
  const events = [];
  const controller = new ScanController({
    database,
    index,
    source: {
      scan(_request, sink) {
        return { done: sink({ type: 'done', seenFiles: [] }) };
      }
    },
    artworkProcessor: createArtworkProcessor(),
    emit(event, payload) {
      events.push([event, payload]);
    }
  });

  await controller.scanFolders([folder]);

  assert.deepEqual(await database.getAllTracks(), []);
  const [playlist] = await database.getAllPlaylists();
  assert.equal(playlist.items[0].trackId, null);
  assert.equal(playlist.items[0].unresolved.originalTrackId, 't_removed');
  assert.equal(playlist.items[0].unresolved.relativePathHint, 'Gone/Track.flac');
  assert.ok(events.some(([event]) => event === 'playlists-changed'));
});

test('scan sweep recalculates artwork refCounts and deletes orphaned artwork', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_music', displayName: 'Music', path: 'D:/Music', status: 'ok' };
  await database.putFolder(folder);
  await database.putTracks([
    { id: 't_keep', folderId: 'f_music', relativePath: 'Keep.flac', fileName: 'Keep.flac', title: 'Keep', artworkId: 'art_keep' },
    { id: 't_gone', folderId: 'f_music', relativePath: 'Gone.flac', fileName: 'Gone.flac', title: 'Gone', artworkId: 'art_gone' }
  ]);
  await database.putArtwork({ id: 'art_keep', thumb: { size: 1 }, sourceKind: 'embedded', refCount: 5 });
  await database.putArtwork({ id: 'art_gone', thumb: { size: 1 }, sourceKind: 'embedded', refCount: 1 });
  const index = new CatalogIndex();
  await index.build({ folders: [folder], tracks: await database.getAllTracks() });
  const controller = new ScanController({
    database,
    index,
    source: {
      scan(_request, sink) {
        return { done: sink({ type: 'done', seenFiles: [{ folderId: 'f_music', relativePath: 'Keep.flac' }] }) };
      }
    },
    artworkProcessor: createArtworkProcessor(),
    emit() {}
  });

  await controller.scanFolders([folder]);

  assert.equal(await database.getArtwork('art_gone'), null);
  assert.equal((await database.getArtwork('art_keep')).refCount, 1);
});

test('scan sweep consumes streamed seen-files events', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_music', displayName: 'Music', path: 'D:/Music', status: 'ok' };
  const track = {
    id: 't_keep',
    folderId: 'f_music',
    relativePath: 'Keep.flac',
    fileName: 'Keep.flac',
    title: 'Keep'
  };
  await database.putFolder(folder);
  await database.putTracks([track]);
  const index = new CatalogIndex();
  await index.build({ folders: [folder], tracks: [track] });
  const controller = new ScanController({
    database,
    index,
    source: {
      scan(_request, sink) {
        return {
          done: (async () => {
            await sink({ type: 'seen-files', files: [{ folderId: 'f_music', relativePath: 'Keep.flac' }] });
            await sink({ type: 'done' });
          })()
        };
      }
    },
    artworkProcessor: createArtworkProcessor(),
    emit() {}
  });

  await controller.scanFolders([folder]);

  assert.deepEqual((await database.getAllTracks()).map(item => item.id), ['t_keep']);
  assert.equal(index.getTrackById('t_keep').title, 'Keep');
});

test('scan restores unresolved playlist items when matching tracks reappear', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_music', displayName: 'Music', path: 'D:/Music', status: 'ok' };
  await database.putFolder(folder);
  await database.putPlaylist({
    id: 'p_one',
    name: 'Saved',
    createdAt: 1,
    updatedAt: 1,
    items: [{
      trackId: null,
      unresolved: {
        sourceLine: 'Album/Song.flac',
        relativePathHint: 'Album/Song.flac',
        title: 'Song',
        artist: 'Artist',
        durationSec: 120
      }
    }]
  });
  const index = new CatalogIndex();
  await index.build({ folders: [folder], tracks: [] });
  const controller = new ScanController({
    database,
    index,
    source: {
      scan(_request, sink) {
        return {
          done: (async () => {
            await sink({
              type: 'batch',
              tracks: [{
                folderId: 'f_music',
                relativePath: 'Album/Song.flac',
                fileName: 'Song.flac',
                title: 'Song',
                artist: 'Artist',
                durationSec: 120
              }]
            });
            await sink({ type: 'done', seenFiles: [{ folderId: 'f_music', relativePath: 'Album/Song.flac' }] });
          })()
        };
      }
    },
    artworkProcessor: createArtworkProcessor(),
    emit() {}
  });

  await controller.scanFolders([folder]);

  const [playlist] = await database.getAllPlaylists();
  assert.ok(playlist.items[0].trackId);
  assert.equal(playlist.items[0].unresolved, undefined);
});

test('scan controller preserves addedAt and reports updates separately from adds', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_music', displayName: 'Music', path: 'D:/Music', status: 'ok' };
  const existing = {
    id: 't_keep_added',
    folderId: 'f_music',
    relativePath: 'Album/Song.flac',
    fileName: 'Song.flac',
    title: 'Old Title',
    addedAt: 111,
    updatedAt: 111
  };
  await database.putFolder(folder);
  await database.putTracks([existing]);
  const index = new CatalogIndex();
  await index.build({ folders: [folder], tracks: [existing] });
  const events = [];
  const controller = new ScanController({
    database,
    index,
    source: {
      scan(_request, sink) {
        return {
          done: (async () => {
            await sink({
              type: 'batch',
              tracks: [{
                id: existing.id,
                folderId: 'f_music',
                relativePath: 'Album/Song.flac',
                fileName: 'Song.flac',
                title: 'New Title'
              }]
            });
            await sink({ type: 'done', seenFiles: [{ folderId: 'f_music', relativePath: 'Album/Song.flac' }] });
          })()
        };
      }
    },
    artworkProcessor: createArtworkProcessor(),
    emit(event, payload) {
      events.push([event, payload]);
    }
  });

  await controller.scanFolders([folder]);

  const [stored] = await database.getAllTracks();
  assert.equal(stored.addedAt, 111);
  assert.equal(stored.title, 'New Title');
  assert.ok(events.some(([event, payload]) => event === 'catalog-changed' && payload.added === 0 && payload.updated === 1));
  assert.ok(events.some(([event, payload]) => event === 'scan-state' && payload.phase === 'done' && payload.added === 0 && payload.updated === 1));
});

test('scan keeps known tracks when a folder reports an enumeration error', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_music', displayName: 'Music', path: 'D:/Music', status: 'ok' };
  const track = {
    id: 't_keep',
    folderId: 'f_music',
    relativePath: 'Nested/Keep.flac',
    fileName: 'Keep.flac',
    title: 'Keep'
  };
  await database.putFolder(folder);
  await database.putTracks([track]);
  const index = new CatalogIndex();
  await index.build({ folders: [folder], tracks: [track] });
  const controller = new ScanController({
    database,
    index,
    source: {
      scan(_request, sink) {
        return {
          done: (async () => {
            await sink({ type: 'error', folderId: 'f_music', reason: 'permission denied' });
            await sink({ type: 'done', seenFiles: [] });
          })()
        };
      }
    },
    artworkProcessor: createArtworkProcessor(),
    emit() {}
  });

  await controller.scanFolders([folder]);

  assert.equal((await database.getAllTracks())[0].id, 't_keep');
  assert.equal(index.getTrackById('t_keep').title, 'Keep');
});

test('scan downgrades failed roots without marking them ok in mixed scans', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const missingFolder = { id: 'f_missing', displayName: 'Missing', path: 'E:/Missing', status: 'ok' };
  const goodFolder = { id: 'f_good', displayName: 'Good', path: 'D:/Music', status: 'ok' };
  await database.putFolder(missingFolder);
  await database.putFolder(goodFolder);
  const index = new CatalogIndex();
  await index.build({ folders: [missingFolder, goodFolder], tracks: [] });
  const events = [];
  const controller = new ScanController({
    database,
    index,
    source: {
      scan(_request, sink) {
        return {
          done: (async () => {
            await sink({
              type: 'error',
              fatal: false,
              folderId: 'f_missing',
              path: 'E:/Missing',
              category: 'missing',
              reason: 'missing root'
            });
            await sink({
              type: 'batch',
              tracks: [{
                folderId: 'f_good',
                relativePath: 'Song.flac',
                fileName: 'Song.flac',
                title: 'Song'
              }]
            });
            await sink({ type: 'seen-files', files: [{ folderId: 'f_good', relativePath: 'Song.flac' }] });
            await sink({ type: 'done' });
          })()
        };
      }
    },
    artworkProcessor: createArtworkProcessor(),
    emit(event, payload) {
      events.push([event, payload]);
    }
  });

  await controller.scanFolders([missingFolder, goodFolder]);

  const folders = await database.getAllFolders();
  assert.equal(folders.find(folder => folder.id === 'f_missing').status, 'missing');
  assert.equal(folders.find(folder => folder.id === 'f_good').status, 'ok');
  assert.equal(index.getFolders().find(folder => folder.id === 'f_missing').status, 'missing');
  assert.equal(index.getTrackById('t_missing'), null);
  assert.deepEqual((await database.getAllTracks()).map(track => track.relativePath), ['Song.flac']);
  assert.ok(events.some(([event, payload]) => event === 'scan-state' && payload.phase === 'done'));
});

test('scan downgrades folder status after a fatal root permission error', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_denied', displayName: 'Denied', path: 'D:/Denied', status: 'ok' };
  await database.putFolder(folder);
  const index = new CatalogIndex();
  await index.build({ folders: [folder], tracks: [] });
  const events = [];
  const controller = new ScanController({
    database,
    index,
    source: {
      scan(_request, sink) {
        return {
          done: (async () => {
            await sink({
              type: 'error',
              fatal: true,
              folderId: 'f_denied',
              path: 'D:/Denied',
              category: 'permission-denied',
              code: 'EACCES',
              reason: 'permission denied'
            });
            throw new Error('permission denied');
          })()
        };
      }
    },
    artworkProcessor: createArtworkProcessor(),
    emit(event, payload) {
      events.push([event, payload]);
    }
  });

  await controller.scanFolders([folder]);

  const [storedFolder] = await database.getAllFolders();
  assert.equal(storedFolder.status, 'needs-permission');
  assert.equal(index.getFolders()[0].status, 'needs-permission');
  assert.ok(events.some(([event, payload]) => event === 'scan-state' && payload.phase === 'error' && /permission/.test(payload.error)));
});

test('scan coalesces repeated requests for the same active folders', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_music', displayName: 'Music', path: 'D:/Music', status: 'ok' };
  const oldTrack = {
    id: 't_old',
    folderId: 'f_music',
    relativePath: 'Old.flac',
    fileName: 'Old.flac',
    title: 'Old'
  };
  await database.putFolder(folder);
  await database.putTracks([oldTrack]);
  const index = new CatalogIndex();
  await index.build({ folders: [folder], tracks: [oldTrack] });
  let scanCount = 0;
  let resolveScan;
  let firstScanStarted;
  const started = new Promise(resolve => {
    firstScanStarted = resolve;
  });
  const source = {
    scan(_request, sink) {
      scanCount += 1;
      firstScanStarted();
      return {
        done: new Promise(resolve => {
          resolveScan = async () => {
            await sink({
              type: 'batch',
              tracks: [{
                folderId: 'f_music',
                relativePath: 'New.flac',
                fileName: 'New.flac',
                title: 'New'
              }]
            });
            await sink({ type: 'seen-files', files: [{ folderId: 'f_music', relativePath: 'New.flac' }] });
            await sink({ type: 'done' });
            resolve();
          };
        })
      };
    }
  };
  const controller = new ScanController({
    database,
    index,
    source,
    artworkProcessor: createArtworkProcessor(),
    emit() {}
  });

  const firstScan = controller.scanFolders([folder]);
  await started;
  const secondScan = controller.scanFolders([folder]);
  assert.equal(scanCount, 1);
  await resolveScan();
  const [firstResult, secondResult] = await Promise.all([firstScan, secondScan]);

  assert.equal(secondResult.scanId, firstResult.scanId);
  assert.deepEqual((await database.getAllTracks()).map(track => track.relativePath), ['New.flac']);
  assert.equal(index.getTrackById('t_old'), null);
  assert.equal(index.getAllTracks()[0].relativePath, 'New.flac');
});

test('scan coalesces subset requests into an active wider Electron scan', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folderA = { id: 'f_a', kind: 'electron', displayName: 'A', path: 'D:/Music/A', status: 'ok' };
  const folderB = { id: 'f_b', kind: 'electron', displayName: 'B', path: 'D:/Music/B', status: 'ok' };
  await database.putFolder(folderA);
  await database.putFolder(folderB);
  const index = new CatalogIndex();
  await index.build({ folders: [folderA, folderB], tracks: [] });
  const events = [];
  const scanListeners = new Set();
  const scanStartCalls = [];
  const cancelCalls = [];
  let activeScanId = '';
  let resolveScanStarted;
  const scanStarted = new Promise(resolve => {
    resolveScanStarted = resolve;
  });
  const emitScanEvent = event => {
    for (const listener of [...scanListeners]) {
      listener(event);
    }
  };
  const source = new ElectronLibrarySource({
    async scanStart(request) {
      scanStartCalls.push(request);
      if (scanStartCalls.length > 1) {
        return {
          success: false,
          scanId: request.scanId,
          activeScanId,
          error: 'A library scan is already running for one of these roots'
        };
      }
      activeScanId = request.scanId;
      resolveScanStarted();
      return { success: true };
    },
    onScanEvent(callback) {
      scanListeners.add(callback);
      return () => scanListeners.delete(callback);
    },
    async scanCancel(scanId) {
      cancelCalls.push(scanId);
    }
  });
  const controller = new ScanController({
    database,
    index,
    source,
    artworkProcessor: createArtworkProcessor(),
    emit(event, payload) {
      events.push([event, payload]);
    }
  });

  const firstScan = controller.scanFolders([folderA, folderB]);
  await scanStarted;
  const secondScan = controller.scanFolders([folderA]);
  assert.equal(scanStartCalls.length, 1);
  emitScanEvent({
    scanId: activeScanId,
    type: 'batch',
    tracks: [{
      folderId: 'f_a',
      relativePath: 'Album/A.flac',
      fileName: 'A.flac',
      title: 'A'
    }]
  });
  emitScanEvent({ scanId: activeScanId, type: 'seen-files', files: [{ folderId: 'f_a', relativePath: 'Album/A.flac' }] });
  emitScanEvent({ scanId: activeScanId, type: 'done', seenFiles: [{ folderId: 'f_a', relativePath: 'Album/A.flac' }] });
  const [firstResult, secondResult] = await Promise.all([firstScan, secondScan]);

  assert.equal(secondResult.scanId, firstResult.scanId);
  assert.equal(scanStartCalls.length, 1);
  assert.deepEqual(cancelCalls, []);
  assert.equal((await database.getAllFolders()).find(folder => folder.id === 'f_a').status, 'ok');
  assert.deepEqual((await database.getAllTracks()).map(track => track.relativePath), ['Album/A.flac']);
  assert.equal(events.some(([event, payload]) => event === 'scan-state' && payload.phase === 'error'), false);
});

test('scan waits for a user-canceled Electron scan before starting an immediate rescan', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_music', kind: 'electron', displayName: 'Music', path: 'D:/Music', status: 'ok' };
  await database.putFolder(folder);
  const index = new CatalogIndex();
  await index.build({ folders: [folder], tracks: [] });
  const scanListeners = new Set();
  const scanStartCalls = [];
  const cancelCalls = [];
  let firstScanId = '';
  let secondScanId = '';
  let resolveFirstStarted;
  let resolveSecondStarted;
  const firstStarted = new Promise(resolve => {
    resolveFirstStarted = resolve;
  });
  const secondStarted = new Promise(resolve => {
    resolveSecondStarted = resolve;
  });
  const emitScanEvent = event => {
    for (const listener of [...scanListeners]) {
      listener(event);
    }
  };
  const source = new ElectronLibrarySource({
    async scanStart(request) {
      scanStartCalls.push(request);
      if (scanStartCalls.length === 1) {
        firstScanId = request.scanId;
        resolveFirstStarted();
      } else if (scanStartCalls.length === 2) {
        secondScanId = request.scanId;
        resolveSecondStarted();
      }
      return { success: true };
    },
    onScanEvent(callback) {
      scanListeners.add(callback);
      return () => scanListeners.delete(callback);
    },
    async scanCancel(scanId) {
      cancelCalls.push(scanId);
    }
  });
  const controller = new ScanController({
    database,
    index,
    source,
    artworkProcessor: createArtworkProcessor(),
    emit() {}
  });

  const firstScan = controller.scanFolders([folder]);
  await firstStarted;
  assert.equal(controller.cancel(firstScanId), true);
  const secondScan = controller.scanFolders([folder]);

  assert.equal(scanStartCalls.length, 1);
  assert.deepEqual(cancelCalls, [firstScanId]);

  emitScanEvent({ scanId: firstScanId, type: 'error', canceled: true, reason: 'canceled' });
  await secondStarted;
  assert.notEqual(secondScanId, firstScanId);
  emitScanEvent({ scanId: secondScanId, type: 'done', seenFiles: [] });

  const [firstResult, secondResult] = await Promise.all([firstScan, secondScan]);
  assert.equal(firstResult.scanId, firstScanId);
  assert.equal(secondResult.scanId, secondScanId);
  assert.equal(scanStartCalls.length, 2);
});

test('scan cancels overlapping active scans before starting a wider replacement', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folderA = { id: 'f_a', displayName: 'A', path: 'D:/Music/A', status: 'ok' };
  const folderB = { id: 'f_b', displayName: 'B', path: 'D:/Music/B', status: 'ok' };
  await database.putFolder(folderA);
  await database.putFolder(folderB);
  const index = new CatalogIndex();
  await index.build({ folders: [folderA, folderB], tracks: [] });
  const scans = [];
  let resolveFirstStarted;
  let resolveSecondStarted;
  const firstStarted = new Promise(resolve => {
    resolveFirstStarted = resolve;
  });
  const secondStarted = new Promise(resolve => {
    resolveSecondStarted = resolve;
  });
  const source = {
    scan(request, sink) {
      const scan = {
        request,
        sink,
        canceled: false,
        resolveDone: null
      };
      const done = new Promise(resolve => {
        scan.resolveDone = resolve;
      });
      scans.push(scan);
      if (scans.length === 1) {
        resolveFirstStarted();
      } else if (scans.length === 2) {
        resolveSecondStarted();
      }
      return {
        done,
        cancel() {
          scan.canceled = true;
        }
      };
    }
  };
  const controller = new ScanController({
    database,
    index,
    source,
    artworkProcessor: createArtworkProcessor(),
    emit() {}
  });

  const firstScan = controller.scanFolders([folderA]);
  await firstStarted;
  const secondScan = controller.scanFolders([folderA, folderB]);
  assert.equal(scans[0].canceled, true);
  await scans[0].sink({
    type: 'batch',
    tracks: [{
      folderId: 'f_a',
      relativePath: 'Late.flac',
      fileName: 'Late.flac',
      title: 'Late'
    }]
  });
  scans[0].resolveDone();
  await secondStarted;
  assert.deepEqual(scans.map(scan => scan.request.folders.map(folder => folder.id)), [['f_a'], ['f_a', 'f_b']]);
  await scans[1].sink({
    type: 'batch',
    tracks: [{
      folderId: 'f_a',
      relativePath: 'Replacement.flac',
      fileName: 'Replacement.flac',
      title: 'Replacement'
    }]
  });
  await scans[1].sink({ type: 'seen-files', files: [{ folderId: 'f_a', relativePath: 'Replacement.flac' }] });
  await scans[1].sink({ type: 'done', seenFiles: [{ folderId: 'f_a', relativePath: 'Replacement.flac' }] });
  scans[1].resolveDone();
  await Promise.all([firstScan, secondScan]);

  assert.deepEqual((await database.getAllTracks()).map(track => track.relativePath), ['Replacement.flac']);
  assert.equal(index.getAllTracks().some(track => track.relativePath === 'Late.flac'), false);
  assert.equal(index.getAllTracks()[0].relativePath, 'Replacement.flac');
});

test('electron library source serializes scan events before resolving done', async () => {
  let scanListener;
  let resolveBatch;
  const order = [];
  const source = new ElectronLibrarySource({
    onScanEvent(callback) {
      scanListener = callback;
      return () => {};
    },
    async scanStart() {
      return { success: true };
    },
    async scanCancel() {}
  });
  const scan = source.scan({ scanId: 'scan_1', folders: [] }, async event => {
    order.push(`${event.type}:start`);
    if (event.type === 'batch') {
      await new Promise(resolve => {
        resolveBatch = resolve;
      });
    }
    order.push(`${event.type}:end`);
  });
  let doneResolved = false;
  scan.done.then(() => {
    doneResolved = true;
  });

  scanListener({ scanId: 'scan_1', type: 'batch', tracks: [] });
  scanListener({ scanId: 'scan_1', type: 'done', seenFiles: [] });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(doneResolved, false);
  resolveBatch();
  await scan.done;

  assert.equal(doneResolved, true);
  assert.deepEqual(order, ['batch:start', 'batch:end', 'done:start', 'done:end']);
});

test('FSA library source maps browser tag metadata and embedded artwork when jsmediatags is available', async () => {
  const file = { name: 'fallback.mp3', size: 128, lastModified: 2000 };
  const source = new FsaLibrarySource({
    jsmediatags: {
      read(input, handlers) {
        assert.equal(input, file);
        handlers.onSuccess({
          tags: {
            title: 'Tagged Title',
            artist: 'Tagged Artist',
            album: 'Tagged Album',
            genre: ['Tagged Genre'],
            year: '2026',
            track: '4/10',
            picture: {
              format: 'image/png',
              data: [1, 2, 3]
            }
          }
        });
      }
    }
  });
  const events = [];
  const handle = {
    async *values() {
      yield {
        kind: 'file',
        name: 'Tagged.mp3',
        getFile: async () => file
      };
    }
  };

  await source.scan({
    folders: [{ id: 'f_music', handle }],
    batchSize: 1
  }, event => {
    events.push(event);
  }).done;

  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.title, 'Tagged Title');
  assert.equal(track.artist, 'Tagged Artist');
  assert.equal(track.album, 'Tagged Album');
  assert.equal(track.genre, 'Tagged Genre');
  assert.equal(track.year, 2026);
  assert.equal(track.trackNo, 4);
  assert.equal(track.trackOf, 10);
  assert.equal(track.artworkMime, 'image/png');
  assert.deepEqual(Array.from(new Uint8Array(track.artworkBytes)), [1, 2, 3]);
});

test('music metadata mapper maps common and format fields', () => {
  const track = createTrackFromMetadata({
    folderId: 'f_music',
    relativePath: 'Album/Tagged.flac',
    fileName: 'Tagged.flac',
    ext: 'flac',
    size: 128,
    mtimeMs: 2000
  }, {
    common: {
      title: 'Tagged Title',
      artists: ['One', 'Two'],
      albumartist: 'Various Artists',
      album: 'Tagged Album',
      genre: ['Tagged Genre'],
      year: 2026,
      track: { no: 4, of: 10 },
      disk: { no: 1, of: 2 },
      titlesort: 'Sort Title',
      albumsort: 'Sort Album',
      albumartistsort: 'Sort Album Artist',
      picture: [{
        format: 'image/png',
        type: 'Cover (front)',
        data: Uint8Array.from([4, 5, 6])
      }]
    },
    format: {
      duration: 123.4,
      sampleRate: 48000,
      bitrate: 96000,
      bitsPerSample: 24,
      numberOfChannels: 2,
      codec: 'FLAC'
    }
  }, 3000);

  assert.equal(track.title, 'Tagged Title');
  assert.equal(track.artist, 'One; Two');
  assert.equal(track.albumArtist, 'Various Artists');
  assert.equal(track.album, 'Tagged Album');
  assert.equal(track.genre, 'Tagged Genre');
  assert.equal(track.year, 2026);
  assert.equal(track.trackNo, 4);
  assert.equal(track.trackOf, 10);
  assert.equal(track.discNo, 1);
  assert.equal(track.discOf, 2);
  assert.equal(track.compilation, true);
  assert.equal(track.sortTitle, 'Sort Title');
  assert.equal(track.sortAlbum, 'Sort Album');
  assert.equal(track.sortAlbumArtist, 'Sort Album Artist');
  assert.equal(track.durationSec, 123.4);
  assert.equal(track.sampleRate, 48000);
  assert.equal(track.bitrate, 96000);
  assert.equal(track.bitsPerSample, 24);
  assert.equal(track.channels, 2);
  assert.equal(track.codec, 'FLAC');
  assert.equal(track.artworkMime, 'image/png');
  assert.deepEqual(Array.from(new Uint8Array(track.artworkBytes)), [4, 5, 6]);
  assert.equal(track.addedAt, 3000);
  assert.equal(shouldRetryDuration({ ext: 'mp3' }, { format: {} }), true);
  assert.equal(shouldRetryDuration({ ext: 'aac' }, { format: { duration: 42 } }), false);
  assert.equal(shouldRetryDuration({ ext: 'flac' }, { format: {} }), false);
});

test('FSA library source parses metadata through the worker when available', async () => {
  const file = { name: 'Worker.flac', size: 256, lastModified: 5000 };
  const calls = [];
  class FakeWorker {
    constructor(url, options) {
      calls.push(['construct', String(url), options]);
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    postMessage(message) {
      calls.push(['postMessage', message.candidate.relativePath, message.file]);
      queueMicrotask(() => {
        this.listeners.get('message')?.({
          data: {
            id: message.id,
            ok: true,
            track: {
              folderId: message.candidate.folderId,
              relativePath: message.candidate.relativePath,
              fileName: message.candidate.fileName,
              title: 'Worker Title',
              artist: 'Worker Artist',
              artworkBytes: Uint8Array.from([9]).buffer,
              artworkMime: 'image/png',
              artworkSourceKind: 'embedded'
            }
          }
        });
      });
    }

    terminate() {
      calls.push(['terminate']);
    }
  }
  const source = new FsaLibrarySource({ Worker: FakeWorker });
  const events = [];
  const handle = {
    async *values() {
      yield {
        kind: 'file',
        name: 'Worker.flac',
        getFile: async () => file
      };
    }
  };

  await source.scan({
    folders: [{ id: 'f_music', handle }],
    batchSize: 1
  }, event => {
    events.push(event);
  }).done;

  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.title, 'Worker Title');
  assert.equal(track.artist, 'Worker Artist');
  assert.equal(track.file, file);
  assert.deepEqual(Array.from(new Uint8Array(track.artworkBytes)), [9]);
  assert.equal(calls[0][0], 'construct');
  assert.equal(calls[0][2].type, 'module');
  assert.ok(String(calls[0][1]).endsWith('/metadata-worker.js'));
  assert.deepEqual(calls[1], ['postMessage', 'Worker.flac', file]);
  assert.equal(calls.at(-1)[0], 'terminate');
});

test('FSA library source reports worker parse errors and falls back to browser tags', async () => {
  const file = { name: 'Broken.mp3', size: 128, lastModified: 7000 };
  class FailingWorker {
    constructor() {
      this.listeners = new Map();
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    postMessage(message) {
      queueMicrotask(() => {
        this.listeners.get('message')?.({
          data: {
            id: message.id,
            ok: false,
            error: 'parse failed'
          }
        });
      });
    }

    terminate() {}
  }
  const source = new FsaLibrarySource({ Worker: FailingWorker });
  const events = [];
  const handle = {
    async *values() {
      yield {
        kind: 'file',
        name: 'Broken.mp3',
        getFile: async () => file
      };
    }
  };

  await source.scan({
    folders: [{ id: 'f_music', handle }],
    batchSize: 1
  }, event => {
    events.push(event);
  }).done;

  const parseError = events.find(event => event.type === 'parse-error');
  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(parseError.folderId, 'f_music');
  assert.equal(parseError.relativePath, 'Broken.mp3');
  assert.match(parseError.reason, /parse failed/);
  assert.equal(track.title, 'Broken');
  assert.equal(track.file, file);
  assert.equal(events.at(-1).type, 'done');
});

test('FSA library source returns null when the directory picker is dismissed', async () => {
  const source = new FsaLibrarySource({
    async showDirectoryPicker() {
      const error = new Error('The user aborted a request.');
      error.name = 'AbortError';
      throw error;
    }
  });
  assert.equal(await source.pickFolder(), null);
});

test('FSA library source reports a cumulative found count across folders', async () => {
  const source = new FsaLibrarySource({});
  const events = [];
  const makeHandle = fileName => ({
    async *values() {
      yield {
        kind: 'file',
        name: fileName,
        getFile: async () => ({ name: fileName, size: 10, lastModified: 1000 })
      };
    }
  });

  await source.scan({
    folders: [
      { id: 'f_one', handle: makeHandle('One.mp3') },
      { id: 'f_two', handle: makeHandle('Two.mp3') }
    ],
    batchSize: 10
  }, event => {
    events.push(event);
  }).done;

  const foundCounts = events.filter(event => event.type === 'enumerate-progress').map(event => event.found);
  assert.deepEqual(foundCounts, [1, 2]);
});

test('FSA library source skips unreadable entries and keeps scanning the folder', async () => {
  const source = new FsaLibrarySource({});
  const events = [];
  const goodFile = { name: 'Good.mp3', size: 10, lastModified: 1000 };
  const handle = {
    async *values() {
      yield {
        kind: 'file',
        name: 'Missing.mp3',
        getFile: async () => {
          const error = new Error('A requested file or directory could not be found.');
          error.name = 'NotFoundError';
          throw error;
        }
      };
      yield {
        kind: 'directory',
        name: 'Broken',
        values() {
          return {
            [Symbol.asyncIterator]() {
              return this;
            },
            async next() {
              throw new Error('directory gone');
            }
          };
        }
      };
      yield {
        kind: 'file',
        name: 'Good.mp3',
        getFile: async () => goodFile
      };
    }
  };

  await source.scan({
    folders: [{ id: 'f_music', handle }],
    batchSize: 10
  }, event => {
    events.push(event);
  }).done;

  const errors = events.filter(event => event.type === 'error');
  assert.equal(errors.length, 2);
  assert.ok(errors.every(event => event.fatal === false && event.folderId === 'f_music'));
  assert.equal(errors[0].relativePath, 'Missing.mp3');
  assert.match(errors[0].reason, /could not be found/);
  assert.equal(errors[1].relativePath, 'Broken');
  assert.match(errors[1].reason, /directory gone/);
  const [track] = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.equal(track.file, goodFile);
  const doneEvent = events.at(-1);
  assert.equal(doneEvent.type, 'done');
  assert.deepEqual(doneEvent.seenPaths, ['Good.mp3']);
});

test('playback bridge replaces the player, queues library entries, and starts at the requested index', async () => {
  const index = new CatalogIndex();
  const tracks = [
    { id: 't_one', folderId: 'f_music', relativePath: 'A/One.flac', fileName: 'One.flac', title: 'One' },
    { id: 't_two', folderId: 'f_music', relativePath: 'B/Two.flac', fileName: 'Two.flac', title: 'Two' }
  ];
  await index.build({
    folders: [{ id: 'f_music', path: 'D:/Music' }],
    tracks
  });

  const calls = [];
  const player = {
    playbackManager: {
      playlist: [],
      originalPlaylist: [],
      loadFiles(files, append, insertAt) {
        calls.push(['loadFiles', files.map(file => file.libraryTrackId), append, insertAt]);
        this.playlist = files.map(file => ({ ...file }));
        this.originalPlaylist = files.map(file => ({ ...file }));
      }
    },
    ui: {
      container: null,
      createPlayerUI() {
        calls.push(['createPlayerUI']);
        this.container = {};
      }
    },
    stateManager: {
      getCurrentTrackIndex() {
        return 0;
      },
      updatePlaylist(playlist, indexValue) {
        calls.push(['updatePlaylist', playlist.map(track => track.libraryTrackId), indexValue]);
      },
      updateState(state, reason) {
        calls.push(['updateState', state, reason]);
      }
    },
    async loadTrack(indexValue) {
      calls.push(['loadTrack', indexValue]);
    },
    async play() {
      calls.push(['play']);
    }
  };
  const uiManager = {
    audioPlayer: null,
    createAudioPlayer(files, replaceExisting) {
      calls.push(['createAudioPlayer', files.length, replaceExisting]);
      this.audioPlayer = player;
      return player;
    }
  };
  const bridge = new PlaybackBridge({
    index,
    source: {},
    uiManager,
    getFolders: () => [{ id: 'f_music', path: 'D:/Music' }]
  });

  await bridge.playTracks(['t_one', 't_two'], { startIndex: 1 });

  assert.deepEqual(calls, [
    ['createAudioPlayer', 0, true],
    ['loadFiles', ['t_one', 't_two'], false, undefined],
    ['createPlayerUI'],
    ['updatePlaylist', ['t_one', 't_two'], 1],
    ['updateState', { currentTrackIndex: 1 }, 'Library playback start index'],
    ['loadTrack', 1],
    ['play']
  ]);
  assert.equal(player.playbackManager.playlist[1].path, 'D:/Music/B/Two.flac');
});

test('playback bridge waits for restored player state before loading library tracks', async () => {
  const index = new CatalogIndex();
  await index.build({
    folders: [{ id: 'f_music', path: 'D:/Music' }],
    tracks: [{ id: 't_one', folderId: 'f_music', relativePath: 'One.flac', fileName: 'One.flac', title: 'One' }]
  });

  const calls = [];
  let restored = false;
  const player = {
    stateRestored: new Promise(resolve => setTimeout(() => {
      restored = true;
      resolve();
    }, 0)),
    playbackManager: {
      playlist: [],
      originalPlaylist: [],
      loadFiles(files) {
        calls.push(['loadFiles', restored]);
        this.playlist = files.map(file => ({ ...file }));
        this.originalPlaylist = files.map(file => ({ ...file }));
      }
    },
    ui: { container: {}, createPlayerUI() {} },
    stateManager: {
      getCurrentTrackIndex() {
        return 0;
      },
      updatePlaylist(playlist, indexValue) {
        calls.push(['updatePlaylist', playlist.map(track => track.libraryTrackId), indexValue]);
      },
      updateState(state, reason) {
        calls.push(['updateState', state, reason]);
      }
    },
    async loadTrack(indexValue) {
      calls.push(['loadTrack', indexValue]);
    },
    async play() {
      calls.push(['play']);
    }
  };
  const uiManager = {
    audioPlayer: null,
    createAudioPlayer() {
      this.audioPlayer = player;
      return player;
    }
  };
  const bridge = new PlaybackBridge({
    index,
    source: {},
    uiManager,
    getFolders: () => [{ id: 'f_music', path: 'D:/Music' }]
  });

  await bridge.playTracks(['t_one']);

  assert.deepEqual(calls.find(call => call[0] === 'loadFiles'), ['loadFiles', true]);
});

test('playback bridge restores the previous queue after a library replacement', async () => {
  const index = new CatalogIndex();
  await index.build({
    folders: [{ id: 'f_music', path: 'D:/Music' }],
    tracks: [{ id: 't_new', folderId: 'f_music', relativePath: 'New.flac', fileName: 'New.flac', title: 'New' }]
  });

  const calls = [];
  const previousPlayer = {
    playbackManager: {
      playlist: [{ libraryTrackId: 't_old', name: 'Old' }],
      originalPlaylist: [{ libraryTrackId: 't_old', name: 'Old' }]
    },
    stateManager: {
      getCurrentTrackIndex() {
        return 0;
      },
      getStateSnapshot() {
        return { isPlaying: false, isPaused: false, isStopped: false };
      }
    }
  };
  const replacementPlayer = {
    playbackManager: {
      playlist: [],
      originalPlaylist: [],
      loadFiles(files) {
        this.playlist = files.map(file => ({ ...file }));
        this.originalPlaylist = files.map(file => ({ ...file }));
      }
    },
    ui: {
      container: {},
      createPlayerUI() {}
    },
    stateManager: {
      updatePlaylist(playlist, indexValue) {
        calls.push(['updatePlaylist', playlist.map(track => track.libraryTrackId), indexValue]);
      },
      updateState(state, reason) {
        calls.push(['updateState', state, reason]);
      }
    },
    async loadTrack(indexValue) {
      calls.push(['loadTrack', indexValue]);
    },
    async play() {
      calls.push(['play']);
    }
  };
  const uiManager = {
    audioPlayer: previousPlayer,
    createAudioPlayer() {
      this.audioPlayer = replacementPlayer;
      return replacementPlayer;
    }
  };
  const bridge = new PlaybackBridge({
    index,
    source: {},
    uiManager,
    getFolders: () => [{ id: 'f_music', path: 'D:/Music' }]
  });

  await bridge.playTracks(['t_new']);

  assert.equal(bridge.canRestoreSnapshot(), true);
  assert.deepEqual(replacementPlayer.playbackManager.playlist.map(track => track.libraryTrackId), ['t_new']);
  assert.equal(await bridge.restoreLastSnapshot(), true);
  assert.deepEqual(replacementPlayer.playbackManager.playlist.map(track => track.libraryTrackId), ['t_old']);
  assert.deepEqual(calls.slice(-3), [
    ['updatePlaylist', ['t_old'], 0],
    ['updateState', { currentTrackIndex: 0 }, 'Library playback queue restore'],
    ['loadTrack', 0]
  ]);
  assert.equal(bridge.canRestoreSnapshot(), false);
});

test('playback bridge stops replacement playback when restoring a paused queue', async () => {
  const index = new CatalogIndex();
  await index.build({
    folders: [{ id: 'f_music', path: 'D:/Music' }],
    tracks: [{ id: 't_new', folderId: 'f_music', relativePath: 'New.flac', fileName: 'New.flac', title: 'New' }]
  });

  const calls = [];
  const previousPlayer = {
    playbackManager: {
      playlist: [{ libraryTrackId: 't_old', name: 'Old' }],
      originalPlaylist: [{ libraryTrackId: 't_old', name: 'Old' }]
    },
    stateManager: {
      getCurrentTrackIndex() {
        return 0;
      },
      getStateSnapshot() {
        return { isPlaying: false, isPaused: true, isStopped: false, currentTrackPosition: 0 };
      }
    }
  };
  const replacementPlayer = {
    playbackManager: {
      playlist: [],
      originalPlaylist: [],
      loadFiles(files) {
        this.playlist = files.map(file => ({ ...file }));
        this.originalPlaylist = files.map(file => ({ ...file }));
      }
    },
    ui: {
      container: {},
      createPlayerUI() {}
    },
    stateManager: {
      updatePlaylist(playlist, indexValue) {
        calls.push(['updatePlaylist', playlist.map(track => track.libraryTrackId), indexValue]);
      },
      updateState(state, reason) {
        calls.push(['updateState', state, reason]);
      }
    },
    async stop() {
      calls.push(['stop']);
    },
    async loadTrack(indexValue) {
      calls.push(['loadTrack', indexValue]);
    },
    async play() {
      calls.push(['play']);
    }
  };
  const uiManager = {
    audioPlayer: previousPlayer,
    createAudioPlayer() {
      this.audioPlayer = replacementPlayer;
      return replacementPlayer;
    }
  };
  const bridge = new PlaybackBridge({
    index,
    source: {},
    uiManager,
    getFolders: () => [{ id: 'f_music', path: 'D:/Music' }]
  });

  await bridge.playTracks(['t_new']);
  calls.length = 0;

  assert.equal(await bridge.restoreLastSnapshot(), true);
  assert.ok(calls.findIndex(call => call[0] === 'stop') < calls.findIndex(call => call[0] === 'loadTrack'));
  assert.deepEqual(calls.find(call => call[0] === 'stop'), ['stop']);
  assert.deepEqual(calls.find(call => call[0] === 'loadTrack'), ['loadTrack', 0]);
  assert.equal(calls.some(call => call[0] === 'play'), false);
});

test('catalog index groups tracks and keeps search results narrowed across queries', async () => {
  const folders = [
    { id: 'f_one', displayName: 'One', path: 'D:/Music' },
    { id: 'f_two', displayName: 'Two', path: 'E:/Archive' }
  ];
  const tracks = [
    {
      id: 't_two',
      folderId: 'f_one',
      relativePath: 'Artist/Album/02 Second.flac',
      fileName: '02 Second.flac',
      title: 'Second',
      artist: 'Artist',
      albumArtist: 'Artist',
      album: 'Album',
      genre: 'Rock',
      year: 2024,
      discNo: 1,
      trackNo: 2,
      durationSec: 220,
      addedAt: 20
    },
    {
      id: 't_one',
      folderId: 'f_one',
      relativePath: 'Artist/Album/01 First.flac',
      fileName: '01 First.flac',
      title: 'First',
      artist: 'Artist',
      albumArtist: 'Artist',
      album: 'Album',
      genre: 'Rock',
      year: 2024,
      discNo: 1,
      trackNo: 1,
      durationSec: 180,
      addedAt: 10
    },
    {
      id: 't_comp',
      folderId: 'f_two',
      relativePath: 'Sampler/Guest.mp3',
      fileName: 'Guest.mp3',
      title: 'Guest Song',
      artist: 'Guest',
      album: 'Sampler',
      genre: 'Pop',
      compilation: true,
      durationSec: 120,
      addedAt: 30
    }
  ];
  const index = new CatalogIndex();
  await index.build({ folders, tracks });

  assert.deepEqual(index.getCounts(), { tracks: 3, albums: 2, artists: 2, genres: 2 });
  assert.deepEqual(index.getTracksByIds(['missing', 't_one']).map(track => track.id), ['t_one']);
  assert.deepEqual(index.getAllTracks({ sort: 'title', direction: 'desc' }).map(track => track.id), ['t_two', 't_comp', 't_one']);
  assert.deepEqual(index.getRecentlyAdded(2).map(track => track.id), ['t_comp', 't_two']);
  assert.equal(index.search('').tracks.length, 0);
  assert.deepEqual(index.search('artist album').trackIds, ['t_two', 't_one']);
  assert.deepEqual(index.search('artist album second').trackIds, ['t_two']);

  const album = index.getAlbums({ sort: 'year' }).find(item => item.name === 'Album');
  assert.ok(album);
  assert.deepEqual(index.getAlbumTracks(album.key).map(track => track.id), ['t_one', 't_two']);
  const artist = index.getArtists().find(item => item.name === 'Artist');
  assert.deepEqual(index.getArtistTracks(artist.key).map(track => track.id), ['t_one', 't_two']);
  const rock = index.getGenres().find(item => item.name === 'Rock');
  assert.deepEqual(index.getGenreTracks(rock.key).map(track => track.id), ['t_one', 't_two']);
  assert.equal(index.getFolders().find(folder => folder.id === 'f_one').trackCount, 2);
  assert.deepEqual(index.getFolderTracks('f_one').map(track => track.id), ['t_one', 't_two']);
  assert.equal(index.findByAbsolutePath('d:\\music\\artist\\album\\01 first.flac').id, 't_one');

  index.applyChanges({
    removedIds: ['t_one'],
    upsert: [{ ...tracks[2], id: 't_new', relativePath: 'Sampler/New.mp3', title: 'New Song' }],
    folders: [{ ...folders[0], displayName: 'Updated' }]
  });
  assert.equal(index.getTrackById('t_one'), null);
  assert.equal(index.getTrackById('t_new').title, 'New Song');
  assert.equal(index.getFolders()[0].displayName, 'Updated');
});

test('catalog index keeps performer artist navigation separate from album artist aggregation', async () => {
  const index = new CatalogIndex();
  await index.build({
    folders: [{ id: 'f_music', displayName: 'Music', path: 'D:/Music' }],
    tracks: [{
      id: 't_guest',
      folderId: 'f_music',
      relativePath: 'Sampler/Guest.flac',
      fileName: 'Guest.flac',
      title: 'Guest Song',
      artist: 'Guest',
      albumArtist: 'Various Artists',
      album: 'Sampler',
      compilation: true
    }]
  });

  const track = index.getTrackById('t_guest');
  assert.notEqual(track.artistDisplayKey, track.artistKey);
  assert.deepEqual(index.getArtists().map(artist => artist.name), ['Various Artists']);
  assert.deepEqual(index.getArtistTracks(track.artistKey).map(item => item.id), ['t_guest']);
  assert.deepEqual(index.getArtistTracks(track.artistDisplayKey).map(item => item.id), ['t_guest']);
});

test('library manager facade returns indexed catalog data and delegates playback commands', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_music', displayName: 'Music', path: 'D:/Music', status: 'ok' };
  const track = {
    id: 't_song',
    folderId: 'f_music',
    relativePath: 'Artist/Song.flac',
    fileName: 'Song.flac',
    title: 'Song',
    artist: 'Artist',
    albumArtist: 'Artist',
    album: 'Album',
    genre: 'Rock',
    addedAt: 1
  };
  await database.putFolder(folder);
  await database.putTracks([track]);
  const source = {
    async checkFolder() {
      return 'ok';
    },
    async requestAccess() {
      return true;
    },
    scan(_request, sink) {
      return { done: sink({ type: 'done', seenFiles: [{ folderId: 'f_music', relativePath: 'Artist/Song.flac' }] }) };
    }
  };
  const manager = new LibraryManager({ uiManager: {}, database, source });
  const events = [];
  const off = manager.addListener('custom', payload => events.push(['custom', payload.value]));
  manager.addListener('*', (payload, event) => events.push(['any', event, payload.value]));
  await manager.init();

  manager.emit('custom', { value: 1 });
  off();
  manager.emit('custom', { value: 2 });
  assert.deepEqual(events.filter(event => event[0] === 'custom'), [['custom', 1]]);
  assert.equal(events.some(event => event[0] === 'any' && event[1] === 'custom'), true);

  manager.handleScanEvent('folders-changed', { folders: [{ ...folder, displayName: 'Merged' }] });
  assert.equal(manager.getFolders()[0].displayName, 'Merged');
  assert.equal(manager.getCounts().tracks, 1);
  assert.deepEqual(manager.getTracks().map(item => item.id), ['t_song']);
  assert.deepEqual(manager.search('song').trackIds, ['t_song']);
  assert.equal(manager.getAlbums()[0].name, 'Album');
  assert.equal(manager.getAlbumTracks(manager.getAlbums()[0].key)[0].id, 't_song');
  assert.equal(manager.getArtists()[0].name, 'Artist');
  assert.equal(manager.getArtistTracks(manager.getArtists()[0].key)[0].id, 't_song');
  assert.equal(manager.getGenres()[0].name, 'Rock');
  assert.equal(manager.getGenreTracks(manager.getGenres()[0].key)[0].id, 't_song');
  assert.equal(manager.getFolderTracks('f_music')[0].id, 't_song');
  assert.equal(manager.getRecentlyAdded(1)[0].id, 't_song');
  assert.equal(manager.getTrackById('t_song').title, 'Song');
  assert.equal(await manager.getArtworkThumbURL(null), '');
  assert.equal(manager.cancelScan('missing'), false);

  const playbackCalls = [];
  manager.playbackBridge = {
    playTracks(ids, options) {
      playbackCalls.push(['playTracks', ids, options]);
    },
    playNext(ids) {
      playbackCalls.push(['playNext', ids]);
    },
    addToQueue(ids) {
      playbackCalls.push(['addToQueue', ids]);
    }
  };
  await manager.playTrackIds(['t_song'], { startIndex: 0, shuffle: true });
  await manager.playNext(['t_song']);
  await manager.addToQueue(['t_song']);
  assert.deepEqual(playbackCalls, [
    ['playTracks', ['t_song'], { startIndex: 0, shuffle: true }],
    ['playNext', ['t_song']],
    ['addToQueue', ['t_song']]
  ]);
});

test('playlist store normalizes item inputs and emits changes for edits', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const events = [];
  const store = new PlaylistStore(database, (event, payload) => events.push([event, payload.playlistId]));

  const created = await store.create('Daily', ['t_one', { id: 't_two' }, { trackId: 't_three' }, { unresolved: { sourceLine: 'missing.flac' } }]);
  assert.deepEqual(created.items.map(item => item.trackId || item.unresolved.sourceLine), ['t_one', 't_two', 't_three', 'missing.flac']);
  assert.equal((await store.list())[0].name, 'Daily');
  assert.equal(await store.duplicate('missing', 'Nope'), null);
  const duplicate = await store.duplicate(created.id, 'Daily Copy');
  assert.equal(duplicate.name, 'Daily Copy');
  assert.deepEqual(duplicate.items.map(item => item.trackId || item.unresolved.sourceLine), ['t_one', 't_two', 't_three', 'missing.flac']);
  duplicate.items[3].unresolved.sourceLine = 'changed.flac';
  assert.equal((await store.get(created.id)).items[3].unresolved.sourceLine, 'missing.flac');
  assert.equal(await store.rename('missing', 'Nope'), null);
  assert.equal((await store.rename(created.id, 'Renamed')).name, 'Renamed');
  assert.equal(await store.addTracks('missing', ['none']), null);
  assert.equal((await store.addTracks(created.id, [{ id: 't_four' }])).items.at(-1).trackId, 't_four');
  assert.equal(await store.replaceItems('missing', []), null);
  assert.deepEqual((await store.replaceItems(created.id, ['t_final'])).items, [{ trackId: 't_final' }]);
  await store.delete(created.id);
  await store.delete(duplicate.id);

  assert.deepEqual(await store.list(), []);
  assert.deepEqual(events.map(event => event[0]), [
    'playlists-changed',
    'playlists-changed',
    'playlists-changed',
    'playlists-changed',
    'playlists-changed',
    'playlists-changed',
    'playlists-changed'
  ]);
});

test('artwork processor stores reusable thumbnails and revokes old object URLs', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const createdUrls = [];
  const revokedUrls = [];
  await withGlobals({
    URL: {
      createObjectURL(blob) {
        const url = `blob:test-${createdUrls.length}`;
        createdUrls.push([url, blob]);
        return url;
      },
      revokeObjectURL(url) {
        revokedUrls.push(url);
      }
    }
  }, async () => {
    const processor = new ArtworkProcessor(database);
    processor.maxUrls = 1;

    assert.equal(await processor.storeArtworkBytes(null), null);
    const firstId = await processor.storeArtworkBytes(Uint8Array.from([1, 2, 3]), 'embedded');
    assert.equal(await processor.storeArtworkBytes(Uint8Array.from([1, 2, 3]), 'embedded'), firstId);
    assert.equal((await database.getArtwork(firstId)).refCount, 2);
    const secondId = await processor.storeArtworkBytes(Uint8Array.from([4, 5, 6]).buffer, 'external');
    assert.notEqual(secondId, firstId);

    assert.equal(await processor.getThumbURL('missing'), '');
    const [firstUrlA, firstUrlB] = await Promise.all([
      processor.getThumbURL(firstId),
      processor.getThumbURL(firstId)
    ]);
    assert.equal(firstUrlA, 'blob:test-0');
    assert.equal(firstUrlB, 'blob:test-0');
    assert.equal(createdUrls.length, 1);
    assert.equal(await processor.getThumbURL(firstId), 'blob:test-0');
    assert.equal(await processor.getThumbURL(secondId), 'blob:test-1');
    assert.deepEqual(revokedUrls, ['blob:test-0']);
    processor.dispose();
    assert.deepEqual(revokedUrls, ['blob:test-0', 'blob:test-1']);
  });
});

test('library source selection chooses the best available folder provider', () => {
  assert.equal(createLibrarySource({
    windowRef: {
      electronIntegration: { isElectronEnvironment: () => true },
      electronAPI: { library: {} }
    }
  }).kind, 'electron');
  assert.equal(createLibrarySource({
    windowRef: {
      electronIntegration: { isElectron: true },
      electronAPI: { library: {} }
    }
  }).kind, 'electron');
  assert.equal(createLibrarySource({ windowRef: { showDirectoryPicker() {} } }).kind, 'fsa');
  assert.equal(createLibrarySource({ windowRef: { document: {} } }).kind, 'import');
});

test('library manager rejects child roots and replaces contained children with an ancestor root', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({ id: 'f_rock', kind: 'electron', displayName: 'Rock', path: 'D:/Music/Rock', status: 'ok' });
  await database.putFolder({ id: 'f_jazz', kind: 'electron', displayName: 'Jazz', path: 'D:/Music/Jazz', status: 'ok' });
  await database.putTracks([
    { id: 't_rock', folderId: 'f_rock', relativePath: 'Song.flac', fileName: 'Song.flac', title: 'Song' },
    { id: 't_jazz', folderId: 'f_jazz', relativePath: 'Tune.flac', fileName: 'Tune.flac', title: 'Tune' }
  ]);
  const picked = [
    { kind: 'electron', path: 'D:/Music/Rock/Live', displayName: 'Live' },
    { kind: 'electron', path: 'D:/Music', displayName: 'Music' }
  ];
  const events = [];
  const source = new ElectronLibrarySource({
    async selectFolder() {
      return picked.shift();
    },
    async validateRoots() {
      return [{ exists: true, readable: true }];
    },
    async scanStart() {
      return { success: true };
    },
    onScanEvent(callback) {
      queueMicrotask(() => callback({ scanId: activeScanId, type: 'done', seenFiles: [] }));
      return () => {};
    },
    async scanCancel() {}
  });
  let activeScanId = '';
  const originalScan = source.scan.bind(source);
  source.scan = (options, sink) => {
    activeScanId = options.scanId;
    return originalScan(options, sink);
  };
  const manager = new LibraryManager({ uiManager: {}, database, source });
  manager.addListener('*', (payload, event) => events.push([event, payload]));
  await manager.init();

  assert.equal(await manager.addFolder(), null);
  assert.deepEqual((await database.getAllFolders()).map(folder => folder.path).sort(), ['D:/Music/Jazz', 'D:/Music/Rock']);
  assert.equal(events.some(([event, payload]) => event === 'folder-add-rejected' && payload.reason === 'descendant-root'), true);

  const ancestor = await manager.addFolder();
  assert.equal(ancestor.path, 'D:/Music');
  assert.deepEqual((await database.getAllFolders()).map(folder => folder.path), ['D:/Music']);
  assert.deepEqual(await database.getAllTracks(), []);
  assert.equal(events.some(([event, payload]) => event === 'catalog-changed' && payload.removed === 2), true);
});

test('library manager rejects reconnecting an offline folder to an existing root', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({ id: 'f_music', kind: 'electron', displayName: 'Music', path: 'D:/Music', status: 'ok' });
  await database.putFolder({ id: 'f_missing', kind: 'electron', displayName: 'Missing', path: 'E:/Missing', status: 'missing' });
  const source = {
    async checkFolder(folder) {
      return folder.path === 'E:/Missing' ? 'missing' : 'ok';
    },
    async requestAccess(folder) {
      folder.path = 'D:/Music';
      folder.displayName = 'Music Again';
      return true;
    },
    async compareFolder(candidate, existing) {
      return comparePathRoots(candidate?.path, existing?.path);
    },
    scan(_request, sink) {
      return { done: sink({ type: 'done', seenFiles: [] }) };
    }
  };
  const events = [];
  const manager = new LibraryManager({ uiManager: {}, database, source });
  manager.addListener('*', (payload, event) => events.push([event, payload]));
  await manager.init();

  assert.equal(await manager.requestFolderAccess('f_missing'), false);

  const folders = await database.getAllFolders();
  assert.equal(folders.find(folder => folder.id === 'f_missing').path, 'E:/Missing');
  assert.equal(manager.getFolders().find(folder => folder.id === 'f_missing').path, 'E:/Missing');
  assert.equal(events.some(([event, payload]) => event === 'folder-add-rejected' && payload.reason === 'same-root'), true);
});

test('library manager rejects reconnecting an offline folder below an existing root', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({ id: 'f_music', kind: 'electron', displayName: 'Music', path: 'D:/Music', status: 'ok' });
  await database.putFolder({ id: 'f_missing', kind: 'electron', displayName: 'Missing', path: 'E:/Missing', status: 'missing' });
  const source = {
    async checkFolder(folder) {
      return folder.path === 'E:/Missing' ? 'missing' : 'ok';
    },
    async requestAccess(folder) {
      folder.path = 'D:/Music/Jazz';
      folder.displayName = 'Jazz';
      return true;
    },
    async compareFolder(candidate, existing) {
      return comparePathRoots(candidate?.path, existing?.path);
    },
    scan(_request, sink) {
      return { done: sink({ type: 'done', seenFiles: [] }) };
    }
  };
  const events = [];
  const manager = new LibraryManager({ uiManager: {}, database, source });
  manager.addListener('*', (payload, event) => events.push([event, payload]));
  await manager.init();

  assert.equal(await manager.requestFolderAccess('f_missing'), false);

  assert.deepEqual((await database.getAllFolders()).map(folder => folder.path).sort(), ['D:/Music', 'E:/Missing']);
  assert.equal(manager.getFolders().find(folder => folder.id === 'f_missing').path, 'E:/Missing');
  assert.equal(events.some(([event, payload]) => event === 'folder-add-rejected' && payload.reason === 'descendant-root'), true);
});

test('library manager replaces child roots when reconnecting an offline folder to their parent', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({ id: 'f_jazz', kind: 'electron', displayName: 'Jazz', path: 'D:/Music/Jazz', status: 'ok' });
  await database.putFolder({ id: 'f_missing', kind: 'electron', displayName: 'Missing', path: 'E:/Missing', status: 'missing' });
  await database.putTracks([
    { id: 't_jazz', folderId: 'f_jazz', relativePath: 'Tune.flac', fileName: 'Tune.flac', title: 'Tune' }
  ]);
  const releasedFolders = [];
  const source = {
    async checkFolder(folder) {
      return folder.path === 'E:/Missing' ? 'missing' : 'ok';
    },
    async requestAccess(folder) {
      folder.path = 'D:/Music';
      folder.displayName = 'Music';
      return true;
    },
    async compareFolder(candidate, existing) {
      return comparePathRoots(candidate?.path, existing?.path);
    },
    releaseFolder(folderId) {
      releasedFolders.push(folderId);
    },
    scan(_request, sink) {
      return { done: sink({ type: 'done', seenFiles: [] }) };
    }
  };
  const events = [];
  const manager = new LibraryManager({ uiManager: {}, database, source });
  manager.addListener('*', (payload, event) => events.push([event, payload]));
  await manager.init();

  const reconnected = await withGlobals({ confirm: () => true }, () => manager.requestFolderAccess('f_missing'));

  assert.equal(reconnected, true);
  assert.deepEqual((await database.getAllFolders()).map(folder => [folder.id, folder.path]), [['f_missing', 'D:/Music']]);
  assert.deepEqual(await database.getAllTracks(), []);
  assert.deepEqual(releasedFolders, ['f_jazz']);
  assert.equal(manager.getCounts().tracks, 0);
  assert.equal(events.some(([event, payload]) => event === 'catalog-changed' && payload.removed === 1), true);
});

test('electron library source validates folders and delegates playback helpers', async () => {
  const calls = [];
  const source = new ElectronLibrarySource({
    async selectFolder() {
      return { path: 'D:\\Music', displayName: 'Music' };
    },
    async validateRoots(paths) {
      calls.push(['validateRoots', paths]);
      return [{ exists: true, readable: paths[0] !== 'D:\\Blocked' }];
    },
    async readArtwork(request) {
      calls.push(['readArtwork', request.path]);
      return { content: 'art' };
    },
    async showInFolder(pathValue) {
      calls.push(['showInFolder', pathValue]);
    },
    async saveFolders(folders) {
      calls.push(['saveFolders', folders]);
      return { success: true, count: folders.length };
    },
    async loadFolders() {
      calls.push(['loadFolders']);
      return {
        success: true,
        folders: [{
          id: 'f_mirror',
          kind: 'electron',
          displayName: 'Mirror',
          path: 'D:/Mirror',
          handle: { ignored: true }
        }]
      };
    }
  });

  assert.deepEqual(await source.pickFolder(), { kind: 'electron', path: 'D:\\Music', displayName: 'Music' });
  assert.equal(await source.checkFolder({ path: 'D:\\Music' }), 'ok');
  assert.equal(await source.checkFolder({ path: 'D:\\Blocked' }), 'needs-permission');
  assert.equal(await source.requestAccess({ path: 'D:\\Music' }), true);
  const blockedFolder = { path: 'D:\\Blocked', displayName: 'Blocked' };
  assert.equal(await source.requestAccess(blockedFolder), true);
  assert.equal(blockedFolder.path, 'D:\\Music');
  assert.deepEqual(await source.resolveForPlayback({ path: 'D:/Music/Song.flac' }), { path: 'D:/Music/Song.flac' });
  assert.deepEqual(await source.resolveForPlayback({ folderPath: 'D:/Music/', relativePath: 'Album/Song.flac' }), { path: 'D:/Music/Album/Song.flac' });
  assert.deepEqual(await source.readArtwork({ absolutePath: 'D:/Music/Song.flac' }), { content: 'art' });
  await source.showInFolder({ absolutePath: 'D:/Music/Song.flac' });
  assert.equal(calls.some(call => call[0] === 'showInFolder'), true);
  assert.deepEqual(await source.syncFolders([{ id: 'f_music', path: 'D:/Music', handle: {}, files: [] }]), {
    success: true,
    count: 1
  });
  assert.equal(calls.some(call => call[0] === 'saveFolders' && call[1][0].path === 'D:/Music'), true);
  assert.deepEqual(await source.loadMirroredFolders(), [{
    id: 'f_mirror',
    kind: 'electron',
    displayName: 'Mirror',
    path: 'D:/Mirror',
    handle: null
  }]);
});

test('electron reconnect leaves runtime and DB folders unchanged when picked validation fails', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({
    id: 'f_missing',
    kind: 'electron',
    displayName: 'Missing',
    path: 'E:/Missing',
    status: 'missing'
  });
  const source = new ElectronLibrarySource({
    async selectFolder() {
      return { path: 'D:/Picked', displayName: 'Picked' };
    },
    async validateRoots(paths) {
      return paths[0] === 'D:/Picked'
        ? [{ exists: true, readable: false }]
        : [{ exists: false, readable: false }];
    },
    async scanStart() {
      return { success: true };
    },
    onScanEvent() {
      return () => {};
    },
    async scanCancel() {}
  });
  const manager = new LibraryManager({ uiManager: {}, database, source });
  await manager.init();

  assert.equal(await manager.requestFolderAccess('f_missing'), false);

  const [persisted] = await database.getAllFolders();
  const [runtime] = manager.getFolders();
  assert.equal(persisted.path, 'E:/Missing');
  assert.equal(persisted.displayName, 'Missing');
  assert.equal(runtime.path, 'E:/Missing');
  assert.equal(runtime.displayName, 'Missing');
});

test('library manager restores Electron mirrored folders when the catalog DB is empty', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  const manager = new LibraryManager({
    uiManager: {},
    database,
    source: {
      kind: 'electron',
      capabilities: {},
      async loadMirroredFolders() {
        return [{
          id: 'f_mirror',
          kind: 'electron',
          displayName: 'Mirror',
          path: 'D:/Mirror',
          addedAt: 1000,
          status: 'ok'
        }];
      },
      async checkFolder() {
        return 'ok';
      },
      scan() {
        return { done: Promise.resolve() };
      }
    }
  });

  await manager.init();
  assert.deepEqual((await database.getAllFolders()).map(folder => folder.path), ['D:/Mirror']);
  assert.equal(manager.getFolders()[0].displayName, 'Mirror');
});

test('root containment keeps Windows roots case-insensitive and POSIX roots case-sensitive', () => {
  assert.equal(comparePathRoots('D:\\Music', 'd:/music/Album'), 'ancestor');
  assert.equal(comparePathRoots('\\\\Server\\Share', '//server/share/Album'), 'ancestor');
  assert.equal(comparePathRoots('//Server/Share/Music', '\\\\server\\share\\MUSIC'), 'same');
  assert.equal(comparePathRoots('\\\\Server\\Share', '\\\\server\\Other'), 'separate');
  assert.equal(comparePathRoots('/Music', '/Music/Album'), 'ancestor');
  assert.equal(comparePathRoots('/Music', '/music/Album'), 'separate');
});

test('FSA library source persists storage best-effort and compares handles for duplicate and containment checks', async () => {
  let persistCalled = false;
  const rootHandle = { name: 'Music' };
  const childHandle = { name: 'Album' };
  rootHandle.isSameEntry = async other => other === rootHandle;
  rootHandle.resolve = async other => other === childHandle ? ['Album'] : null;
  childHandle.isSameEntry = async other => other === childHandle;
  childHandle.resolve = async () => null;
  const source = new FsaLibrarySource({
    navigator: {
      storage: {
        async persist() {
          persistCalled = true;
          return true;
        }
      }
    },
    async showDirectoryPicker() {
      return rootHandle;
    }
  });

  const picked = await source.pickFolder();
  assert.equal(persistCalled, true);
  assert.equal(picked.handle, rootHandle);
  assert.equal(await source.compareFolder({ handle: rootHandle }, { handle: rootHandle }), 'same');
  assert.equal(await source.compareFolder({ handle: rootHandle }, { handle: childHandle }), 'ancestor');
  assert.equal(await source.compareFolder({ handle: childHandle }, { handle: rootHandle }), 'descendant');
});

test('FSA library source can replace a denied folder handle during reconnect', async () => {
  const oldHandle = {
    async requestPermission() {
      return 'denied';
    }
  };
  const newHandle = {
    name: 'Recovered',
    async requestPermission() {
      return 'granted';
    }
  };
  const source = new FsaLibrarySource({
    async showDirectoryPicker() {
      return newHandle;
    }
  });
  const folder = { id: 'f_fsa', displayName: 'Old', handle: oldHandle };

  assert.equal(await source.requestAccess(folder), true);
  assert.equal(folder.displayName, 'Recovered');
  assert.equal(folder.handle, newHandle);
});

test('FSA library source rejects reconnect picks that are known to be a different directory', async () => {
  const oldHandle = {
    async requestPermission() {
      return 'denied';
    },
    async isSameEntry(other) {
      return other === oldHandle;
    }
  };
  const wrongHandle = {
    name: 'Wrong',
    async isSameEntry() {
      return false;
    }
  };
  const source = new FsaLibrarySource({
    async showDirectoryPicker() {
      return wrongHandle;
    }
  });
  const folder = { id: 'f_fsa', displayName: 'Old', handle: oldHandle };

  assert.equal(await source.requestAccess(folder), false);
  assert.equal(folder.displayName, 'Old');
  assert.equal(folder.handle, oldHandle);
});

test('playback bridge skips tracks whose library folder is offline', async () => {
  const index = new CatalogIndex();
  await index.build({
    folders: [
      { id: 'f_ok', path: 'D:/Music', status: 'ok' },
      { id: 'f_missing', path: 'E:/Music', status: 'missing' }
    ],
    tracks: [
      { id: 't_ok', folderId: 'f_ok', relativePath: 'Ok.flac', fileName: 'Ok.flac', title: 'Ok' },
      { id: 't_missing', folderId: 'f_missing', relativePath: 'Missing.flac', fileName: 'Missing.flac', title: 'Missing' }
    ]
  });
  const bridge = new PlaybackBridge({
    index,
    source: {},
    uiManager: {},
    getFolders: () => [
      { id: 'f_ok', path: 'D:/Music', status: 'ok' },
      { id: 'f_missing', path: 'E:/Music', status: 'missing' }
    ]
  });

  assert.deepEqual(bridge.createQueueEntries(['t_ok', 't_missing']).map(entry => entry.libraryTrackId), ['t_ok']);
});

test('playback bridge remaps the start index around offline tracks and reports the excluded count', async () => {
  const index = new CatalogIndex();
  const folders = [
    { id: 'f_ok', path: 'D:/Music', status: 'ok' },
    { id: 'f_missing', path: 'E:/Music', status: 'missing' }
  ];
  await index.build({
    folders,
    tracks: [
      { id: 't_gone', folderId: 'f_missing', relativePath: 'Gone.flac', fileName: 'Gone.flac', title: 'Gone' },
      { id: 't_one', folderId: 'f_ok', relativePath: 'One.flac', fileName: 'One.flac', title: 'One' },
      { id: 't_two', folderId: 'f_ok', relativePath: 'Two.flac', fileName: 'Two.flac', title: 'Two' }
    ]
  });

  const calls = [];
  const player = {
    playbackManager: {
      playlist: [],
      originalPlaylist: [],
      loadFiles(files) {
        this.playlist = files.map(file => ({ ...file }));
        this.originalPlaylist = files.map(file => ({ ...file }));
      }
    },
    ui: { container: {}, createPlayerUI() {} },
    stateManager: {
      getCurrentTrackIndex() {
        return 0;
      },
      updatePlaylist(playlist, indexValue) {
        calls.push(['updatePlaylist', playlist.map(track => track.libraryTrackId), indexValue]);
      },
      updateState(state, reason) {
        calls.push(['updateState', state, reason]);
      }
    },
    async loadTrack(indexValue) {
      calls.push(['loadTrack', indexValue]);
    },
    async play() {
      calls.push(['play']);
    }
  };
  const uiManager = {
    audioPlayer: null,
    createAudioPlayer() {
      this.audioPlayer = player;
      return player;
    },
    setError(message, isError, params) {
      calls.push(['setError', message, isError, params]);
    }
  };
  const bridge = new PlaybackBridge({ index, source: {}, uiManager, getFolders: () => folders });

  await bridge.playTracks(['t_gone', 't_one', 't_two'], { startIndex: 2 });

  assert.deepEqual(calls, [
    ['setError', 'status.libraryTracksSkippedOffline', false, { count: 1 }],
    ['updatePlaylist', ['t_one', 't_two'], 1],
    ['updateState', { currentTrackIndex: 1 }, 'Library playback start index'],
    ['loadTrack', 1],
    ['play']
  ]);
});

test('playback bridge notifies without playback when every requested track is offline', async () => {
  const index = new CatalogIndex();
  const folders = [{ id: 'f_missing', path: 'E:/Music', status: 'missing' }];
  await index.build({
    folders,
    tracks: [{ id: 't_gone', folderId: 'f_missing', relativePath: 'Gone.flac', fileName: 'Gone.flac', title: 'Gone' }]
  });

  const calls = [];
  const uiManager = {
    audioPlayer: null,
    createAudioPlayer() {
      calls.push(['createAudioPlayer']);
      return null;
    },
    setError(message, isError, params) {
      calls.push(['setError', message, isError, params]);
    }
  };
  const bridge = new PlaybackBridge({ index, source: {}, uiManager, getFolders: () => folders });

  await bridge.playTracks(['t_gone'], { startIndex: 0 });

  assert.deepEqual(calls, [['setError', 'status.libraryTracksSkippedOffline', false, { count: 1 }]]);
});

test('playback bridge keeps the requested track when the player shuffle mode reorders the queue', async () => {
  const index = new CatalogIndex();
  const folders = [{ id: 'f_music', path: 'D:/Music', status: 'ok' }];
  await index.build({
    folders,
    tracks: [
      { id: 't_one', folderId: 'f_music', relativePath: 'One.flac', fileName: 'One.flac', title: 'One' },
      { id: 't_two', folderId: 'f_music', relativePath: 'Two.flac', fileName: 'Two.flac', title: 'Two' }
    ]
  });

  const calls = [];
  const player = {
    playbackManager: {
      playlist: [],
      originalPlaylist: [],
      loadFiles(files) {
        // Simulate the player's persisted shuffle mode reordering a replaced queue.
        this.playlist = files.map(file => ({ ...file })).reverse();
        this.originalPlaylist = files.map(file => ({ ...file }));
      }
    },
    ui: { container: {}, createPlayerUI() {} },
    stateManager: {
      getCurrentTrackIndex() {
        return 0;
      },
      updatePlaylist(playlist, indexValue) {
        calls.push(['updatePlaylist', playlist.map(track => track.libraryTrackId), indexValue]);
      },
      updateState(state, reason) {
        calls.push(['updateState', state, reason]);
      }
    },
    async loadTrack(indexValue) {
      calls.push(['loadTrack', indexValue]);
    },
    async play() {
      calls.push(['play']);
    }
  };
  const uiManager = {
    audioPlayer: null,
    createAudioPlayer() {
      this.audioPlayer = player;
      return player;
    }
  };
  const bridge = new PlaybackBridge({ index, source: {}, uiManager, getFolders: () => folders });

  await bridge.playTracks(['t_one', 't_two'], { startIndex: 1 });

  assert.deepEqual(calls, [
    ['updatePlaylist', ['t_two', 't_one'], 0],
    ['updateState', { currentTrackIndex: 0 }, 'Library playback start index'],
    ['loadTrack', 0],
    ['play']
  ]);
});

test('library manager imports and exports playlist files through the catalog', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_music', displayName: 'Music', path: 'D:/Music', status: 'ok' };
  const track = {
    id: 't_song',
    folderId: 'f_music',
    relativePath: 'Album/Song.flac',
    fileName: 'Song.flac',
    title: 'Song',
    artist: 'Artist',
    album: 'Album',
    durationSec: 123
  };
  await database.putFolder(folder);
  await database.putTracks([track]);
  const manager = new LibraryManager({
    uiManager: {},
    database,
    source: {
      capabilities: { absolutePaths: true },
      async checkFolder() {
        return 'ok';
      },
      scan(_request, sink) {
        return { done: sink({ type: 'done', seenFiles: [{ folderId: 'f_music', relativePath: 'Album/Song.flac' }] }) };
      }
    }
  });
  await manager.init();

  const importRequest = {
    fileName: 'daily.m3u8',
    playlistPath: 'D:/Playlists/daily.m3u8',
    content: '#EXTM3U\n#EXTINF:123,Artist - Song\nD:/Music/Album/Song.flac\nMissing.flac\n'
  };
  const preview = manager.previewPlaylistImport(importRequest);

  assert.equal(preview.playlistName, 'daily');
  assert.equal(preview.resolvedCount, 1);
  assert.equal(preview.unresolvedCount, 1);
  assert.equal(preview.totalCount, 2);
  assert.equal(preview.unresolvedItems[0].entry.path, 'Missing.flac');

  const imported = await manager.commitPlaylistImport(preview);

  assert.equal(imported.playlist.name, 'daily');
  assert.equal(imported.resolvedCount, 1);
  assert.equal(imported.unresolvedCount, 1);
  const stored = await manager.playlists.get(imported.playlist.id);
  assert.equal(stored.items[0].trackId, 't_song');
  assert.equal(stored.items[1].unresolved.sourceLine, 'Missing.flac');
  await database.putTracks([{
    id: 't_missing',
    folderId: 'f_music',
    relativePath: 'Missing.flac',
    fileName: 'Missing.flac',
    title: 'Missing',
    artist: 'Artist',
    durationSec: 100
  }]);
  await manager.index.build({ folders: manager.getFolders(), tracks: await database.getAllTracks() });
  assert.equal((await manager.resolvePlaylistItem('missing', 0)).status, 'missing-playlist');
  assert.equal((await manager.resolvePlaylistItem(imported.playlist.id, 9)).status, 'missing-item');
  const resolvedItem = await manager.resolvePlaylistItem(imported.playlist.id, 1);
  assert.equal(resolvedItem.status, 'resolved');
  assert.equal(resolvedItem.trackId, 't_missing');
  assert.equal((await manager.playlists.get(imported.playlist.id)).items[1].trackId, 't_missing');
  assert.match(await manager.exportPlaylist(imported.playlist.id, { format: 'm3u8' }), /D:\/Music\/Album\/Song\.flac/);
  assert.match(await manager.exportPlaylist(imported.playlist.id, { format: 'xspf' }), /file:\/\/\/D:\/Music\/Album\/Song\.flac/);
  assert.match(
    await manager.exportPlaylist(imported.playlist.id, {
      format: 'm3u8',
      targetPath: 'D:/Music/Playlists/daily.m3u8',
      preferRelative: true
    }),
    /\.\.\/Album\/Song\.flac/
  );
  assert.deepEqual(manager.createPlaylistItemsFromQueueEntries([
    { path: 'D:/Music/Album/Song.flac', meta: { title: 'Song' } },
    { path: 'D:/Other/Missing.flac', name: 'Missing.flac' }
  ]), [
    { trackId: 't_song' },
    {
      trackId: null,
      unresolved: {
        sourceLine: 'D:/Other/Missing.flac',
        title: 'Missing.flac',
        artist: undefined,
        durationSec: undefined,
        relativePathHint: undefined
      }
    }
  ]);
});

test('removing a folder invalidates its in-flight scan so late batches are dropped', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({ id: 'f_music', displayName: 'Music', path: 'D:/Music', status: 'ok' });
  let deliverLateBatch;
  let finishScan;
  let scanStarted;
  let cancelCalls = 0;
  const started = new Promise(resolve => {
    scanStarted = resolve;
  });
  const source = {
    async checkFolder() {
      return 'ok';
    },
    scan(_request, sink) {
      const done = new Promise(resolve => {
        deliverLateBatch = () => sink({
          type: 'batch',
          tracks: [{ folderId: 'f_music', relativePath: 'Late.flac', fileName: 'Late.flac', title: 'Late' }]
        });
        finishScan = async () => {
          await sink({ type: 'done', seenFiles: [{ folderId: 'f_music', relativePath: 'Late.flac' }] });
          resolve();
        };
      });
      scanStarted();
      return {
        done,
        cancel() {
          cancelCalls += 1;
        }
      };
    }
  };
  const manager = new LibraryManager({ uiManager: {}, database, source });
  await manager.init();

  const scanPromise = manager.scanFolders(['f_music']);
  await started;
  await manager.removeFolder('f_music');
  assert.equal(cancelCalls, 1);
  await deliverLateBatch();
  await finishScan();
  await scanPromise;

  assert.deepEqual(await database.getAllTracks(), []);
  assert.deepEqual(await database.getAllFolders(), []);
  assert.equal(manager.getCounts().tracks, 0);
});

test('replacing a child folder cancels its active Electron scan', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({ id: 'f_jazz', kind: 'electron', displayName: 'Jazz', path: 'D:/Music/Jazz', status: 'ok' });
  await database.putTracks([
    { id: 't_jazz', folderId: 'f_jazz', relativePath: 'Tune.flac', fileName: 'Tune.flac', title: 'Tune' }
  ]);
  const scanListeners = new Set();
  const cancelCalls = [];
  let resolveChildScanStarted;
  const childScanStarted = new Promise(resolve => {
    resolveChildScanStarted = resolve;
  });
  const emitScanEvent = event => {
    for (const listener of [...scanListeners]) {
      listener(event);
    }
  };
  const source = new ElectronLibrarySource({
    async selectFolder() {
      return { path: 'D:/Music', displayName: 'Music' };
    },
    async validateRoots() {
      return [{ exists: true, readable: true }];
    },
    async scanStart(request) {
      const [root] = request.roots || [];
      if (root?.folderId === 'f_jazz') {
        resolveChildScanStarted(request.scanId);
      } else {
        queueMicrotask(() => emitScanEvent({ scanId: request.scanId, type: 'done', seenFiles: [] }));
      }
      return { success: true };
    },
    onScanEvent(callback) {
      scanListeners.add(callback);
      return () => scanListeners.delete(callback);
    },
    async scanCancel(scanId) {
      cancelCalls.push(scanId);
      queueMicrotask(() => emitScanEvent({ scanId, type: 'error', canceled: true, reason: 'canceled' }));
    }
  });
  const manager = new LibraryManager({ uiManager: {}, database, source });
  await manager.init();

  const childScanPromise = manager.scanFolders(['f_jazz']);
  const childScanId = await childScanStarted;
  const merged = await withGlobals({ confirm: () => true }, () => manager.addFolder());
  await childScanPromise;

  assert.equal(merged.path, 'D:/Music');
  assert.deepEqual(cancelCalls, [childScanId]);
  assert.deepEqual((await database.getAllFolders()).map(folder => folder.path), ['D:/Music']);
  assert.deepEqual(await database.getAllTracks(), []);
});

test('library manager reloads the folder mirror on init even when folders already exist', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({
    id: 'f_music',
    kind: 'electron',
    displayName: 'Local Name',
    path: 'D:/Music',
    status: 'ok'
  });
  let loadCalls = 0;
  const manager = new LibraryManager({
    uiManager: {},
    database,
    source: {
      kind: 'electron',
      capabilities: {},
      async loadMirroredFolders() {
        loadCalls += 1;
        return [
          { id: 'f_music', kind: 'electron', displayName: 'Mirror Name', path: 'D:/Music', status: 'never-scanned' },
          { id: 'f_extra', kind: 'electron', displayName: 'Extra', path: 'E:/Extra', addedAt: 1000, status: 'ok' }
        ];
      },
      async checkFolder() {
        return 'ok';
      },
      scan() {
        return { done: Promise.resolve() };
      }
    }
  });

  await manager.init();

  assert.equal(loadCalls, 1);
  const folders = await database.getAllFolders();
  assert.equal(folders.find(folder => folder.id === 'f_music').displayName, 'Local Name');
  assert.equal(folders.find(folder => folder.id === 'f_extra').path, 'E:/Extra');
});

test('library manager asks for confirmation before replacing children with an ancestor root', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({ id: 'f_jazz', kind: 'electron', displayName: 'Jazz', path: 'D:/Music/Jazz', status: 'ok' });
  await database.putTracks([
    { id: 't_jazz', folderId: 'f_jazz', relativePath: 'Tune.flac', fileName: 'Tune.flac', title: 'Tune' }
  ]);
  let activeScanId = '';
  const source = new ElectronLibrarySource({
    async selectFolder() {
      return { path: 'D:/Music', displayName: 'Music' };
    },
    async validateRoots() {
      return [{ exists: true, readable: true }];
    },
    async scanStart() {
      return { success: true };
    },
    onScanEvent(callback) {
      queueMicrotask(() => callback({ scanId: activeScanId, type: 'done', seenFiles: [] }));
      return () => {};
    },
    async scanCancel() {}
  });
  const originalScan = source.scan.bind(source);
  source.scan = (options, sink) => {
    activeScanId = options.scanId;
    return originalScan(options, sink);
  };
  const events = [];
  const manager = new LibraryManager({ uiManager: {}, database, source });
  manager.addListener('*', (payload, event) => events.push([event, payload]));
  await manager.init();

  const messages = [];
  const canceled = await withGlobals({
    confirm(message) {
      messages.push(message);
      return false;
    }
  }, () => manager.addFolder());

  assert.equal(canceled, null);
  assert.match(messages[0], /Jazz/);
  assert.match(messages[0], /1/);
  assert.deepEqual((await database.getAllFolders()).map(folder => folder.path), ['D:/Music/Jazz']);
  assert.deepEqual((await database.getAllTracks()).map(track => track.id), ['t_jazz']);
  assert.equal(events.some(([event, payload]) => event === 'folder-add-rejected' && payload.reason === 'merge-canceled'), true);

  const merged = await withGlobals({ confirm: () => true }, () => manager.addFolder());

  assert.equal(merged.path, 'D:/Music');
  assert.deepEqual((await database.getAllFolders()).map(folder => folder.path), ['D:/Music']);
  assert.deepEqual(await database.getAllTracks(), []);
});

test('playlist relative export preserves UNC share roots', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  const folder = { id: 'f_unc', displayName: 'Share', path: '\\\\Server\\Share\\Music', status: 'ok' };
  const track = {
    id: 't_unc',
    folderId: 'f_unc',
    relativePath: 'Album/Song.flac',
    fileName: 'Song.flac',
    title: 'Song'
  };
  await database.putFolder(folder);
  await database.putTracks([track]);
  const manager = new LibraryManager({
    uiManager: {},
    database,
    source: {
      capabilities: { absolutePaths: true },
      async checkFolder() {
        return 'ok';
      },
      scan(_request, sink) {
        return { done: sink({ type: 'done', seenFiles: [{ folderId: 'f_unc', relativePath: 'Album/Song.flac' }] }) };
      }
    }
  });
  await manager.init();
  const playlist = await manager.playlists.create('UNC', ['t_unc']);

  const exported = await manager.exportPlaylist(playlist.id, {
    format: 'm3u8',
    targetPath: '\\\\Server\\Share\\Music\\Playlists\\mix.m3u8',
    preferRelative: true
  });

  assert.match(exported, /\.\.\/Album\/Song\.flac/);
});

test('XSPF export keeps mixed relative and absolute Electron folder paths valid', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.open();
  await database.putFolder({ id: 'f_music', kind: 'electron', displayName: 'Music', path: 'D:/Music', status: 'ok' });
  await database.putFolder({ id: 'f_archive', kind: 'electron', displayName: 'Archive', path: 'E:/Archive', status: 'ok' });
  await database.putTracks([
    {
      id: 't_music',
      folderId: 'f_music',
      relativePath: 'Album/Song.flac',
      fileName: 'Song.flac',
      title: 'Song'
    },
    {
      id: 't_archive',
      folderId: 'f_archive',
      relativePath: 'Other/Keep.flac',
      fileName: 'Keep.flac',
      title: 'Keep'
    }
  ]);
  const manager = new LibraryManager({
    uiManager: {},
    database,
    source: {
      capabilities: { absolutePaths: true },
      async checkFolder() {
        return 'ok';
      },
      scan(_request, sink) {
        return { done: sink({ type: 'done', seenFiles: [] }) };
      }
    }
  });
  await manager.init();
  const playlist = await manager.playlists.create('Mixed', ['t_music', 't_archive']);

  const exported = await manager.exportPlaylist(playlist.id, {
    format: 'xspf',
    targetPath: 'D:/Music/Playlists/mix.xspf',
    preferRelative: true
  });

  assert.match(exported, /<location>\.\.\/Album\/Song\.flac<\/location>/);
  assert.match(exported, /<location>file:\/\/\/E:\/Archive\/Other\/Keep\.flac<\/location>/);
  assert.doesNotMatch(exported, /E%3A\/Archive\/Other\/Keep\.flac/);
});

test('import library source keeps picked files available for playback in the session', async () => {
  const files = [
    { name: 'Song.mp3', webkitRelativePath: 'Root/Album/Song.mp3', size: 10, lastModified: 1000 },
    { name: 'Loose.wav', size: 20, lastModified: 2000 }
  ];
  let removedInput = false;
  const windowRef = {
    document: {
      createElement() {
        return {
          style: {},
          files,
          addEventListener(_type, listener) {
            this.listener = listener;
          },
          click() {
            this.listener?.();
          },
          remove() {
            removedInput = true;
          }
        };
      },
      body: {
        appendChild(input) {
          assert.equal(input.style.display, 'none');
        }
      }
    }
  };
  const source = new ImportLibrarySource(windowRef);
  assert.deepEqual(await source.pickDirectoryFiles(), files);
  assert.equal(removedInput, true);
  const picked = await source.pickFolder();
  assert.equal(picked.displayName, 'Root');
  assert.equal(await source.checkFolder(), 'needs-permission');

  const reconnectTarget = {};
  assert.equal(await source.requestAccess(reconnectTarget), true);
  assert.deepEqual(reconnectTarget.files, files);

  const events = [];
  await source.scan({
    folders: [{ id: 'f_import', files }],
    batchSize: 1
  }, event => {
    events.push(event);
  }).done;

  const tracks = events.filter(event => event.type === 'batch').flatMap(event => event.tracks);
  assert.deepEqual(tracks.map(track => track.relativePath), ['Album/Song.mp3', 'Loose.wav']);
  assert.deepEqual(await source.resolveForPlayback({ folderId: 'f_import', relativePath: 'Album/Song.mp3' }), { file: files[0] });
  await assert.rejects(() => source.resolveForPlayback({ folderId: 'f_import', relativePath: 'Missing.mp3' }), /offline/);

  const replacementFiles = [
    { name: 'Song.mp3', webkitRelativePath: 'Root/Album/Song.mp3', size: 30, lastModified: 3000 }
  ];
  await source.scan({
    folders: [{ id: 'f_import', files: replacementFiles }],
    batchSize: 1
  }, () => {}).done;

  assert.deepEqual(await source.resolveForPlayback({ folderId: 'f_import', relativePath: 'Album/Song.mp3' }), { file: replacementFiles[0] });
  await assert.rejects(() => source.resolveForPlayback({ folderId: 'f_import', relativePath: 'Loose.wav' }), /offline/);

  source.releaseFolder('f_import');
  await assert.rejects(() => source.resolveForPlayback({ folderId: 'f_import', relativePath: 'Album/Song.mp3' }), /offline/);
});

test('import library source resolves NFD-named files against NFC track paths', async () => {
  const nfdName = 'Café.mp3'.normalize('NFD'); // decomposed form as reported on macOS
  const files = [
    { name: nfdName, webkitRelativePath: `Root/Album/${nfdName}`, size: 10, lastModified: 1000 }
  ];
  const source = new ImportLibrarySource({});
  source.replaceSessionFiles('f_import', files);
  const nfcPath = `Album/${nfdName}`.normalize('NFC');
  assert.notEqual(nfcPath, `Album/${nfdName}`);
  assert.deepEqual(await source.resolveForPlayback({ folderId: 'f_import', relativePath: nfcPath }), { file: files[0] });
});
