'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');
const { LibraryCatalogScanRuntime } = require('../../electron/library-catalog-scan-runtime.cjs');
const { LibraryServiceCoordinator } = require('../../electron/library-service-coordinator.cjs');

async function waitForTerminal(runtime, scanId, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = runtime.getScanStatus({ scanId });
    if (!status.active) return status;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for scan ${scanId}`);
}

test('Electron scan runtime adds a picked folder and makes an unchanged million-scale path a metadata no-op', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-scan-'));
  const libraryRoot = path.join(temporary, 'Music');
  await fs.mkdir(libraryRoot);
  await fs.writeFile(path.join(libraryRoot, 'one.mp3'), Buffer.from('not-a-real-mp3'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  let parseCount = 0;
  let receivedLanguageHints = null;
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [libraryRoot] };
      }
    },
    metadataParser: {
      async parse({ languageHints }) {
        parseCount += 1;
        receivedLanguageHints = languageHints;
        return { title: 'One', artist: 'Artist', durationSec: 1 };
      }
    }
  });
  t.after(async () => {
    await runtime.close();
    await host.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const scanEvents = [];
  runtime.on('scan-event', event => scanEvents.push(event));
  const languageHints = {
    language: 'ja',
    languagePreference: 'auto',
    browserLanguage: 'ja-JP',
    browserLanguages: ['ja-JP', 'en-US']
  };
  const added = await runtime.addFolder({ languageHints });
  assert.equal(added.canceled, false);
  assert.equal(added.folder.displayName, 'Music');
  assert.equal(Object.hasOwn(added.folder, 'path'), false);

  const first = added.scan;
  assert.equal(first.accepted, true);
  const firstTerminal = await waitForTerminal(runtime, first.scanId);
  assert.equal(firstTerminal.status, 'completed');
  assert.ok(scanEvents.some(event => event.scanId === first.scanId && event.status === 'running'));
  assert.ok(scanEvents.some(event => event.scanId === first.scanId && event.terminal === true));
  assert.equal(parseCount, 1);
  assert.deepEqual(receivedLanguageHints, languageHints);
  assert.equal((await host.getCounts()).tracks, 1);

  const second = await runtime.scanFolders([added.folder.id]);
  const secondTerminal = await waitForTerminal(runtime, second.scanId);
  assert.equal(secondTerminal.status, 'completed');
  assert.equal(secondTerminal.results[0].counts.unchanged, 1);
  assert.equal(parseCount, 1);

  const all = await runtime.scanFolders(null);
  assert.deepEqual(all.folderIds, [added.folder.id]);
  assert.equal((await waitForTerminal(runtime, all.scanId)).status, 'completed');
  assert.equal(parseCount, 1);
});

test('Electron scan publishes CUE logical tracks with stable source descriptors and one physical metadata parse', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-cue-scan-'));
  const libraryRoot = path.join(temporary, 'Music');
  await fs.mkdir(libraryRoot);
  await fs.writeFile(path.join(libraryRoot, 'album.wav'), Buffer.from('audio'));
  await fs.writeFile(path.join(libraryRoot, 'album.cue'), Buffer.from(`
    PERFORMER "Disc Artist"
    TITLE "Disc Title"
    FILE "album.wav" WAVE
    TRACK 01 AUDIO
    TITLE "First"
    INDEX 01 00:00:00
    TRACK 02 AUDIO
    INDEX 01 00:05:00
  `));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  let parseCount = 0;
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: [libraryRoot] }; } },
    metadataParser: {
      async parse() {
        parseCount += 1;
        return {
          title: 'Embedded title', artist: 'Embedded artist', album: 'Embedded album',
          albumArtist: 'Embedded album artist', genre: 'Rock', durationSec: 12,
          sampleRate: 48000, channels: 2, codec: 'PCM'
        };
      }
    }
  });
  t.after(async () => {
    await runtime.close();
    await host.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const added = await runtime.addFolder();
  assert.equal((await waitForTerminal(runtime, added.scan.scanId)).status, 'completed');
  assert.equal(parseCount, 1);
  assert.equal((await host.getCounts()).tracks, 2);
  const page = await host.queryTracks({ query: '', sort: 'album', direction: 'asc', limit: 10 });
  assert.deepEqual(page.rows.map(row => ({
    sourceKind: row.sourceKind, entryKey: row.entryKey, startFrame: row.startFrame,
    endFrame: row.endFrame, durationSec: row.durationSec, title: row.title,
    artist: row.artist, album: row.album, trackNo: row.trackNo
  })), [
    {
      sourceKind: 'cue-track', entryKey: 'cue:album.cue#1', startFrame: 0,
      endFrame: 375, durationSec: 5, title: 'First', artist: 'Disc Artist',
      album: 'Disc Title', trackNo: 1
    },
    {
      sourceKind: 'cue-track', entryKey: 'cue:album.cue#2', startFrame: 375,
      endFrame: null, durationSec: 7, title: 'Track 02', artist: 'Disc Artist',
      album: 'Disc Title', trackNo: 2
    }
  ]);
  assert.equal(page.rows[0].physicalSourceKey, page.rows[1].physicalSourceKey);
  const firstStorage = await host.getTrackStorageIdentity(page.rows[0].trackUid);
  const secondStorage = await host.getTrackStorageIdentity(page.rows[1].trackUid);
  assert.equal(firstStorage.relativePath, 'album.wav');
  assert.equal(firstStorage.physicalSourceKey, secondStorage.physicalSourceKey);
  assert.deepEqual(
    [firstStorage.startFrame, firstStorage.endFrame, secondStorage.startFrame, secondStorage.endFrame],
    [0, 375, 375, null]
  );
  assert.deepEqual([firstStorage.durationSec, secondStorage.durationSec], [5, 7]);
  assert.equal((await runtime.resolvePlaybackSource(page.rows[0].trackUid)).durationSec, 5);
  await host.releaseContext(page.contextToken);
});

test('Electron scan runtime rejects duplicate and nested roots and confirms parent consolidation once', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-root-overlap-'));
  const libraryRoot = path.join(temporary, 'Music');
  const childRoot = path.join(libraryRoot, 'Album');
  const siblingRoot = path.join(temporary, 'Music2');
  await fs.mkdir(childRoot, { recursive: true });
  await fs.mkdir(siblingRoot);
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  const selections = [libraryRoot, libraryRoot, childRoot, siblingRoot, temporary, temporary];
  const confirmations = [1, 0];
  let confirmationCount = 0;
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [selections.shift()] };
      },
      async showMessageBox() {
        confirmationCount += 1;
        return { response: confirmations.shift() };
      }
    },
    metadataParser: { async parse() { return { title: 'unused' }; } }
  });
  t.after(async () => {
    await runtime.close();
    await host.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const added = await runtime.addFolder();
  await waitForTerminal(runtime, added.scan.scanId);
  const duplicate = await runtime.addFolder();
  const child = await runtime.addFolder();
  const sibling = await runtime.addFolder();
  await waitForTerminal(runtime, sibling.scan.scanId);
  const canceledParent = await runtime.addFolder();
  assert.equal((await host.getCounts()).folders, 2);
  const parent = await runtime.addFolder();
  await waitForTerminal(runtime, parent.scan.scanId);

  assert.deepEqual({ rejected: duplicate.rejected, reason: duplicate.reason }, {
    rejected: true, reason: 'same-root'
  });
  assert.deepEqual({ rejected: child.rejected, reason: child.reason }, {
    rejected: true, reason: 'descendant-root'
  });
  assert.equal(canceledParent.canceled, true);
  assert.equal(parent.folder.displayName, path.basename(temporary));
  assert.equal(confirmationCount, 2);
  assert.equal((await host.getCounts()).folders, 1);
});

test('Electron reconnect advances lifecycle and blocks old tracks until the moved folder is rescanned', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-reconnect-move-'));
  const oldRoot = path.join(temporary, 'Old Music');
  const newRoot = path.join(temporary, 'New Music');
  await fs.mkdir(oldRoot);
  await fs.writeFile(path.join(oldRoot, 'song.mp3'), Buffer.from('old'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  const selections = [oldRoot, newRoot];
  let parseCount = 0;
  let notifyRescanStarted;
  const rescanStarted = new Promise(resolve => { notifyRescanStarted = resolve; });
  let releaseRescan;
  const rescanGate = new Promise(resolve => { releaseRescan = resolve; });
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: [selections.shift()] }; } },
    metadataParser: {
      async parse() {
        parseCount += 1;
        if (parseCount === 2) {
          notifyRescanStarted();
          await rescanGate;
        }
        return { title: 'Song' };
      }
    }
  });
  t.after(async () => {
    releaseRescan();
    await runtime.close();
    await host.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const added = await runtime.addFolder();
  await waitForTerminal(runtime, added.scan.scanId);
  const before = (await host.listScanFolders({ includeRemoved: false })).folders[0];
  const trackPage = await host.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 20 });
  const trackUid = trackPage.rows[0].trackUid;
  await host.releaseContext(trackPage.contextToken);
  await fs.rename(oldRoot, newRoot);
  await fs.appendFile(path.join(newRoot, 'song.mp3'), Buffer.from('-changed'));

  const reconnected = await runtime.requestFolderAccess({ folderId: added.folder.id });
  await rescanStarted;
  const duringRescan = (await host.listScanFolders({ includeRemoved: false })).folders[0];
  assert.equal(reconnected.canceled, false);
  assert.equal(reconnected.scan.accepted, true);
  assert.equal(duringRescan.id, before.id);
  assert.equal(duringRescan.path, path.resolve(await fs.realpath(newRoot)));
  assert.equal(duringRescan.displayName, 'New Music');
  assert.equal(duringRescan.status, 'ok');
  assert.equal(duringRescan.lifecycleVersion, before.lifecycleVersion + 1);
  assert.equal(duringRescan.addedAt, before.addedAt);
  await assert.rejects(
    runtime.resolvePlaybackSource(trackUid),
    error => error?.code === 'sourceUnavailable'
  );

  releaseRescan();
  assert.equal((await waitForTerminal(runtime, reconnected.scan.scanId)).status, 'completed');
  const after = (await host.listScanFolders({ includeRemoved: false })).folders[0];
  assert.ok(after.scanGeneration > before.scanGeneration);
  assert.ok(after.lastScanAt >= before.lastScanAt);
  const source = await runtime.resolvePlaybackSource(trackUid);
  assert.equal(source.path, path.join(newRoot, 'song.mp3'));
});

test('Electron scan content-syncs discovered playlists and overwrites stale in-app items atomically', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-scan-playlist-'));
  const libraryRoot = path.join(temporary, 'Music');
  await fs.mkdir(libraryRoot);
  await fs.writeFile(path.join(libraryRoot, 'one.mp3'), Buffer.from('not-a-real-mp3'));
  await fs.writeFile(path.join(libraryRoot, 'Daily.m3u8'), Buffer.from('#EXTM3U\none.mp3\n'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [libraryRoot] }) },
    metadataParser: { parse: async () => ({ title: 'One', artist: 'Artist', durationSec: 1 }) }
  });
  const coordinator = await LibraryServiceCoordinator.open({
    repository: host,
    importSourceProvider: runtime
  });
  runtime.setPlaylistImportService(coordinator);
  t.after(async () => {
    coordinator.dispose();
    await runtime.close();
    await host.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const added = await runtime.addFolder({});
  const first = await waitForTerminal(runtime, added.scan.scanId);
  assert.equal(first.status, 'completed');
  assert.equal(first.results[0].counts.playlistsFound, 1);
  assert.equal(first.results[0].counts.playlistsImported, 1);
  assert.equal(first.results[0].playlistImportState, 'completed');
  assert.equal(first.results[0].counts.playlistImportsCanceled, 0);
  assert.equal(first.results[0].counts.playlistImportFailures, 0);
  assert.equal((await host.getCounts()).playlists, 1);

  const { automaticPlaylistIdentity } = await import('../../js/library/playlists/automatic-playlist-import.js');
  const identity = automaticPlaylistIdentity(added.folder.id, 'Daily.m3u8');
  const imported = await host.queryPlaylistItems({ playlistId: identity.playlistId, limit: 10 });
  assert.equal(imported.playlist.name, 'Daily');
  assert.equal(imported.items.length, 1);
  assert.equal(typeof imported.items[0].trackUid, 'string');

  const rescanned = await runtime.scanFolders({ folderIds: [added.folder.id] });
  const second = await waitForTerminal(runtime, rescanned.scanId);
  assert.equal(second.results[0].counts.playlistsImported, 0);
  assert.equal(second.results[0].counts.playlistsAlreadyImported, 1);
  assert.equal((await host.getCounts()).playlists, 1);

  await fs.writeFile(
    path.join(libraryRoot, 'Daily.m3u8'),
    Buffer.from('#EXTM3U\nmissing.mp3\none.mp3\n')
  );
  const consumePlaylistImportGrant = runtime.consumePlaylistImportGrant.bind(runtime);
  let failNextChangedImport = true;
  runtime.consumePlaylistImportGrant = async source => {
    const opened = await consumePlaylistImportGrant(source);
    if (!failNextChangedImport) return opened;
    failNextChangedImport = false;
    return {
      ...opened,
      stream: () => ({
        [Symbol.asyncIterator]() {
          return {
            async next() {
              throw Object.assign(new Error('transient read failure'), { code: 'transient-io' });
            }
          };
        }
      })
    };
  };
  const failedChangedScan = await runtime.scanFolders({ folderIds: [added.folder.id] });
  const failedChanged = await waitForTerminal(runtime, failedChangedScan.scanId);
  assert.equal(failedChanged.results[0].counts.playlistImportFailures, 1);
  const preserved = await host.queryPlaylistItems({ playlistId: identity.playlistId, limit: 10 });
  assert.equal(preserved.playlist.version, 1);
  assert.equal(preserved.items.length, 1);
  assert.equal(typeof preserved.items[0].trackUid, 'string');

  const changedScan = await runtime.scanFolders({ folderIds: [added.folder.id] });
  const changed = await waitForTerminal(runtime, changedScan.scanId);
  assert.equal(changed.results[0].counts.playlistsImported, 1);
  const replaced = await host.queryPlaylistItems({ playlistId: identity.playlistId, limit: 10 });
  assert.equal(replaced.playlist.version, 2);
  assert.equal(replaced.items.length, 2);
  assert.equal(replaced.items[0].unresolved.relativePathHint, 'missing.mp3');
  assert.equal(typeof replaced.items[1].trackUid, 'string');

  const context = await host.createContext({
    endpoint: 'tracks', query: '', sort: 'title', direction: 'asc', scope: null
  });
  const manual = await coordinator.start({
    clientRequestId: 'manual-auto-playlist-edit',
    operationKind: 'addToPlaylist',
    selectionDescriptor: {
      mode: 'explicit', contextToken: context.contextToken, trackUids: [replaced.items[1].trackUid]
    },
    target: { playlistId: identity.playlistId },
    expectedTargetVersion: 2,
    options: {}
  });
  assert.equal(manual.kind, 'started');
  assert.equal((await coordinator.waitForTerminal(manual.operationId)).terminalKind, 'success');
  await host.releaseContext(context.contextToken);
  assert.equal((await host.queryPlaylistItems({ playlistId: identity.playlistId, limit: 10 })).items.length, 3);

  await fs.writeFile(
    path.join(libraryRoot, 'Daily.m3u8'),
    Buffer.from('#EXTM3U\nreplacement.mp3\n')
  );
  const authoritativeScan = await runtime.scanFolders({ folderIds: [added.folder.id] });
  const authoritative = await waitForTerminal(runtime, authoritativeScan.scanId);
  assert.equal(authoritative.results[0].counts.playlistsImported, 1);
  const authoritativePlaylist = await host.queryPlaylistItems({ playlistId: identity.playlistId, limit: 10 });
  assert.equal(authoritativePlaylist.playlist.version, 4);
  assert.equal(authoritativePlaylist.items.length, 1);
  assert.equal(authoritativePlaylist.items[0].unresolved.relativePathHint, 'replacement.mp3');

  assert.equal((await host.tombstonePlaylist({
    playlistId: identity.playlistId,
    expectedVersion: 4,
    updatedAt: Date.now()
  })).kind, 'tombstoned');
  assert.equal((await host.getCounts()).playlists, 0);
  const recreateScan = await runtime.scanFolders({ folderIds: [added.folder.id] });
  const recreated = await waitForTerminal(runtime, recreateScan.scanId);
  assert.equal(recreated.results[0].counts.playlistsImported, 1);
  assert.equal(recreated.results[0].counts.playlistsAlreadyImported, 0);
  const recreatedPlaylist = await host.queryPlaylistItems({ playlistId: identity.playlistId, limit: 10 });
  assert.equal(recreatedPlaylist.playlist.version, 1);
  assert.equal(recreatedPlaylist.items[0].unresolved.relativePathHint, 'replacement.mp3');
});

test('Electron scan retries a failed initial automatic playlist import on the next rescan', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-scan-playlist-retry-'));
  const libraryRoot = path.join(temporary, 'Music');
  await fs.mkdir(libraryRoot);
  await fs.writeFile(path.join(libraryRoot, 'one.mp3'), Buffer.from('not-a-real-mp3'));
  await fs.writeFile(
    path.join(libraryRoot, 'Retry.m3u8'),
    Buffer.from(`x${'y'.repeat(1024 * 1024)}\n`)
  );
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [libraryRoot] }) },
    metadataParser: { parse: async () => ({ title: 'One', artist: 'Artist', durationSec: 1 }) }
  });
  const coordinator = await LibraryServiceCoordinator.open({
    repository: host,
    importSourceProvider: runtime
  });
  runtime.setPlaylistImportService(coordinator);
  t.after(async () => {
    coordinator.dispose();
    await runtime.close();
    await host.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const added = await runtime.addFolder({});
  const failed = await waitForTerminal(runtime, added.scan.scanId);
  assert.equal(failed.results[0].counts.playlistImportFailures, 1);
  assert.equal(failed.results[0].counts.playlistsImported, 0);

  await fs.writeFile(path.join(libraryRoot, 'Retry.m3u8'), Buffer.from('#EXTM3U\none.mp3\n'));
  const retriedScan = await runtime.scanFolders({ folderIds: [added.folder.id] });
  const retried = await waitForTerminal(runtime, retriedScan.scanId);
  assert.equal(retried.results[0].counts.playlistsImported, 1);
  assert.equal(retried.results[0].counts.playlistImportFailures, 0);
  const { automaticPlaylistIdentity } = await import('../../js/library/playlists/automatic-playlist-import.js');
  const identity = automaticPlaylistIdentity(added.folder.id, 'Retry.m3u8');
  assert.equal((await host.queryPlaylistItems({ playlistId: identity.playlistId, limit: 10 })).items.length, 1);
});

test('Electron scan runtime resumes deletion for an already tombstoned folder', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-remove-resume-'));
  const libraryRoot = path.join(temporary, 'Music');
  await fs.mkdir(libraryRoot);
  await Promise.all(Array.from({ length: 101 }, (_, index) => {
    const name = `${String(index + 1).padStart(3, '0')}.mp3`;
    return fs.writeFile(path.join(libraryRoot, name), Buffer.from(name));
  }));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [libraryRoot] };
      }
    },
    metadataParser: {
      async parse() {
        return { title: 'One', artist: 'Artist', durationSec: 1 };
      }
    }
  });
  t.after(async () => {
    await runtime.close();
    await host.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const added = await runtime.addFolder({});
  assert.equal((await waitForTerminal(runtime, added.scan.scanId)).status, 'completed');

  const interrupted = await host.removeScanFolder({
    folderId: added.folder.id,
    expectedLifecycleVersion: added.folder.lifecycleVersion
  });
  assert.equal(interrupted.hasMore, true);
  assert.equal(interrupted.lifecycleVersion, added.folder.lifecycleVersion + 1);

  const resumed = await runtime.removeFolder({ folderId: added.folder.id });
  assert.equal(resumed.hasMore, false);
  assert.equal((await host.getCounts()).tracks, 0);
});

test('Electron scan runtime waits for deletion before re-adding the same path', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-readd-'));
  const libraryRoot = path.join(temporary, 'Music');
  await fs.mkdir(libraryRoot);
  await fs.writeFile(path.join(libraryRoot, 'one.mp3'), Buffer.from('not-a-real-mp3'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [libraryRoot] };
      }
    },
    metadataParser: {
      async parse() {
        return { title: 'One', artist: 'Artist', durationSec: 1 };
      }
    }
  });
  t.after(async () => {
    await runtime.close();
    await host.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const added = await runtime.addFolder({});
  assert.equal((await waitForTerminal(runtime, added.scan.scanId)).status, 'completed');

  const originalRemoveScanFolder = host.removeScanFolder.bind(host);
  let releaseFirstDeletionChunk;
  const firstDeletionChunkBlocked = new Promise(resolve => { releaseFirstDeletionChunk = resolve; });
  let markFirstDeletionChunk;
  const firstDeletionChunkReached = new Promise(resolve => { markFirstDeletionChunk = resolve; });
  let shouldBlock = true;
  host.removeScanFolder = async request => {
    const result = await originalRemoveScanFolder(request);
    if (shouldBlock) {
      shouldBlock = false;
      markFirstDeletionChunk();
      await firstDeletionChunkBlocked;
    }
    return result;
  };

  const removal = runtime.removeFolder({ folderId: added.folder.id });
  await firstDeletionChunkReached;
  runtime.canonicalDirectory = async selected => selected;
  const originalListScanFolders = host.listScanFolders.bind(host);
  let readdLookupStarted = false;
  host.listScanFolders = async request => {
    readdLookupStarted = true;
    return originalListScanFolders(request);
  };
  const readd = runtime.addFolder({});
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(readdLookupStarted, false);
  } finally {
    releaseFirstDeletionChunk();
  }

  const [, readded] = await Promise.all([removal, readd]);
  assert.equal((await waitForTerminal(runtime, readded.scan.scanId)).status, 'completed');
  const counts = await host.getCounts();
  assert.equal(counts.folders, 1);
  assert.equal(counts.tracks, 1);
});

test('Electron scan runtime removes every old track before a reduced folder is re-added', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-reduced-readd-'));
  const libraryRoot = path.join(temporary, 'Music');
  const removedTrackPath = path.join(libraryRoot, 'removed.mp3');
  const dbPath = path.join(temporary, 'catalog.sqlite');
  await fs.mkdir(libraryRoot);
  await fs.writeFile(path.join(libraryRoot, 'kept.mp3'), Buffer.from('kept'));
  await fs.writeFile(removedTrackPath, Buffer.from('removed'));
  const host = await LibraryCatalogHost.open({ dbPath });
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [libraryRoot] };
      }
    },
    metadataParser: {
      async parse({ relativePath }) {
        return { title: path.basename(relativePath, '.mp3'), artist: 'Artist', durationSec: 1 };
      }
    }
  });
  t.after(async () => {
    await runtime.close();
    await host.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const added = await runtime.addFolder({});
  assert.equal((await waitForTerminal(runtime, added.scan.scanId)).status, 'completed');
  assert.equal((await host.getCounts()).tracks, 2);

  const removalEvents = [];
  runtime.on('folder-removal-event', event => removalEvents.push(event));
  const removed = await runtime.removeFolder({ folderId: added.folder.id });
  assert.equal(removed.hasMore, false);
  assert.equal(removed.deleted, 2);
  assert.deepEqual(removalEvents[0], {
    folderId: added.folder.id,
    phase: 'removing',
    deleted: 0,
    total: 2,
    remaining: 2,
    terminal: false
  });
  assert.ok(removalEvents.some(event => (
    event.phase === 'removing' && event.deleted === 2 && event.remaining === 0
  )));
  assert.deepEqual(removalEvents.at(-1), {
    folderId: added.folder.id,
    phase: 'done',
    deleted: 2,
    total: 2,
    remaining: 0,
    terminal: true
  });
  assert.equal((await host.getCounts()).tracks, 0);
  const emptyDatabase = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(Number(emptyDatabase.prepare('SELECT count(*) AS count FROM tracks').get().count), 0);
  } finally {
    emptyDatabase.close();
  }
  const emptyPage = await host.queryTracks({
    query: '', sort: 'title', direction: 'asc', limit: 20
  });
  assert.deepEqual(emptyPage.rows, []);
  await host.releaseContext(emptyPage.contextToken);

  await fs.rm(removedTrackPath);
  const readded = await runtime.addFolder({});
  assert.equal((await waitForTerminal(runtime, readded.scan.scanId)).status, 'completed');
  assert.equal((await host.getCounts()).tracks, 1);
  const rebuiltDatabase = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(Number(rebuiltDatabase.prepare('SELECT count(*) AS count FROM tracks').get().count), 1);
    assert.equal(Number(rebuiltDatabase.prepare(`
      SELECT count(*) AS count FROM tracks WHERE relative_path = 'removed.mp3'
    `).get().count), 0);
  } finally {
    rebuiltDatabase.close();
  }
  const page = await host.queryTracks({
    query: '', sort: 'title', direction: 'asc', limit: 20
  });
  assert.deepEqual(page.rows.map(track => track.title), ['kept']);
  await host.releaseContext(page.contextToken);
});

test('Electron catalog resumes an interrupted folder deletion after restart', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-remove-restart-'));
  const libraryRoot = path.join(temporary, 'Music');
  const dbPath = path.join(temporary, 'catalog.sqlite');
  await fs.mkdir(libraryRoot);
  await Promise.all(Array.from({ length: 101 }, (_, index) => {
    const name = `${String(index + 1).padStart(3, '0')}.mp3`;
    return fs.writeFile(path.join(libraryRoot, name), Buffer.from(name));
  }));
  let host = await LibraryCatalogHost.open({ dbPath });
  let runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [libraryRoot] }) },
    metadataParser: {
      async parse({ relativePath }) {
        return { title: path.basename(relativePath, '.mp3'), artist: 'Artist', durationSec: 1 };
      }
    }
  });
  t.after(async () => {
    await runtime?.close();
    await host?.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const added = await runtime.addFolder({});
  assert.equal((await waitForTerminal(runtime, added.scan.scanId)).status, 'completed');
  const firstChunk = await host.removeScanFolder({
    folderId: added.folder.id,
    expectedLifecycleVersion: added.folder.lifecycleVersion
  });
  assert.equal(firstChunk.deleted, 100);
  assert.equal(firstChunk.hasMore, true);
  assert.equal((await host.getScanFolderTrackCount({ folderId: added.folder.id })).trackCount, 1);

  await runtime.close();
  runtime = null;
  await host.close();
  host = await LibraryCatalogHost.open({ dbPath });

  const deadline = Date.now() + 3000;
  while ((await host.getScanFolderTrackCount({ folderId: added.folder.id })).trackCount !== 0 &&
         Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal((await host.getScanFolderTrackCount({ folderId: added.folder.id })).trackCount, 0);
  const folders = await host.listScanFolders({
    folderIds: [added.folder.id],
    includeRemoved: true
  });
  assert.equal(folders.folders[0].status, 'removed');
});

test('Electron scan runtime resumes the same generation without enabling a deletion sweep', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-resume-'));
  const libraryRoot = path.join(temporary, 'Music');
  const trackPath = path.join(libraryRoot, 'resume.mp3');
  await fs.mkdir(libraryRoot);
  await fs.writeFile(trackPath, Buffer.from('initial'));
  await fs.writeFile(path.join(libraryRoot, 'second.mp3'), Buffer.from('second'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  let blockNextParse = false;
  let completedParses = 0;
  let parseStarted;
  const parseStartedPromise = new Promise(resolve => { parseStarted = resolve; });
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [libraryRoot] }) },
    scanConfig: { maxBatchTracks: 1 },
    metadataParser: {
      async parse({ signal }) {
        if (!blockNextParse) {
          completedParses += 1;
          return { title: 'Resume' };
        }
        parseStarted();
        await new Promise((resolve, reject) => {
          const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError', code: 'scan-canceled' }));
          if (signal.aborted) abort();
          else signal.addEventListener('abort', abort, { once: true });
        });
        return { title: 'unreachable' };
      }
    }
  });
  t.after(async () => {
    await runtime.close();
    await host.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const added = await runtime.addFolder({});
  const initial = added.scan;
  assert.equal((await waitForTerminal(runtime, initial.scanId)).status, 'completed');

  await fs.appendFile(trackPath, Buffer.from('-changed'));
  blockNextParse = true;
  const interrupted = await runtime.scanFolders({ folderIds: [added.folder.id], scanReason: 'automatic' });
  await parseStartedPromise;
  const canceled = await runtime.cancelScan({ scanId: interrupted.scanId });
  assert.equal(canceled.status, 'paused');

  blockNextParse = false;
  const resumed = await runtime.scanFolders({
    folderIds: [added.folder.id],
    scanId: interrupted.scanId,
    resume: true,
    scanReason: 'automatic'
  });
  assert.equal(resumed.scanId, interrupted.scanId);
  const terminal = await waitForTerminal(runtime, resumed.scanId);
  assert.equal(terminal.status, 'completed-no-sweep');
  assert.equal(terminal.results.at(-1).continuityBroken, true);
  assert.equal(terminal.results.at(-1).sweepEligibility, 'INELIGIBLE');
  assert.equal((await host.getCounts()).tracks, 2);
  assert.equal(completedParses, 3);
});

test('Electron scan runtime rejects renderer path injection and paths escaping a main-process grant', async () => {
  const host = {
    on() {},
    listScanFolders: async () => ({ folders: [] }),
    beginScanFolder() {}
  };
  const runtime = new LibraryCatalogScanRuntime({
    host,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  });
  runtime.BoundedScanService = class {};
  await assert.rejects(
    runtime.scanFolders({ folderIds: ['folder'], roots: ['C:\\outside'], knownFiles: [] }),
    error => error?.code === 'invalidScanRequest'
  );

  const root = path.resolve(os.tmpdir(), 'granted-root');
  runtime.issueGrant({ id: 'folder', lifecycleVersion: 1 }, root);
  await assert.rejects(
    runtime.resolveGrantedPath(runtime.grants.get('folder'), '../outside.mp3', { allowRoot: false }),
    error => error?.code === 'invalidRelativePath'
  );
  await runtime.close();
});

test('Electron CUE reads use one file handle and never read beyond the configured limit plus one byte', async t => {
  const root = path.resolve(os.tmpdir(), 'bounded-cue-root');
  const candidate = path.join(root, 'disc.cue');
  const source = Buffer.from('123456');
  let advertisedSize = 2;
  let readCalls = 0;
  let closeCalls = 0;
  let largestReadLength = 0;
  const stats = size => ({
    size,
    isFile: () => true,
    isDirectory: () => false,
    isSymbolicLink: () => false
  });
  const runtime = new LibraryCatalogScanRuntime({
    host: { on() {}, removeListener() {}, async listScanFolders() {}, beginScanFolder() {} },
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    filesystem: {
      async lstat() { return stats(1); },
      async realpath() { return candidate; },
      async open(openedPath, flags) {
        assert.equal(openedPath, candidate);
        assert.equal(flags, 'r');
        return {
          async stat() { return stats(advertisedSize); },
          async read(buffer, offset, length, position) {
            readCalls += 1;
            largestReadLength = Math.max(largestReadLength, length);
            const bytesRead = Math.min(length, source.length - position);
            if (bytesRead > 0) source.copy(buffer, offset, position, position + bytesRead);
            return { bytesRead };
          },
          async close() { closeCalls += 1; }
        };
      }
    },
    metadataParser: { async parse() { return {}; } },
    artworkWorkerPool: { async close() {} }
  });
  runtime.issueGrant({ id: 'folder', lifecycleVersion: 1 }, root);
  t.after(() => runtime.close());

  assert.deepEqual(await runtime.readSmallFile({ root, relativePath: 'disc.cue', maximumBytes: 5 }), {
    tooLarge: true,
    size: 6,
    bytes: null
  });
  assert.equal(largestReadLength, 6);
  assert.equal(closeCalls, 1);

  advertisedSize = 7;
  const previousReadCalls = readCalls;
  assert.deepEqual(await runtime.readSmallFile({ root, relativePath: 'disc.cue', maximumBytes: 5 }), {
    tooLarge: true,
    size: 7,
    bytes: null
  });
  assert.equal(readCalls, previousReadCalls);
  assert.equal(closeCalls, 2);
});

test('Electron scan status projects bounded CUE warning DTOs without internal fields', async t => {
  const runtime = new LibraryCatalogScanRuntime({
    host: { on() {}, removeListener() {}, async listScanFolders() {}, beginScanFolder() {} },
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    metadataParser: { async parse() { return {}; } },
    artworkWorkerPool: { async close() {} }
  });
  t.after(() => runtime.close());
  const samples = Array.from({ length: 101 }, (_, index) => ({
    code: `cue-${index}`,
    path: `Disc/${index}.cue`,
    internal: 'not-public'
  }));
  runtime.scans.set('warning-projection', {
    scanId: 'warning-projection',
    folderIds: ['folder'],
    active: false,
    status: 'completed',
    startedAt: 1,
    updatedAt: 2,
    error: null,
    task: null,
    results: [{
      folderId: 'folder', generation: 1, status: 'completed',
      continuityBroken: false, sweepEligibility: 'ELIGIBLE',
      playlistImportState: 'completed', counts: { cueWarnings: 101 },
      warnings: [{ category: 'cue-invalid', count: 101, samples, internal: 'not-public' }]
    }]
  });

  const [warning] = runtime.getScanStatus({ scanId: 'warning-projection' }).results[0].warnings;
  assert.equal(warning.category, 'cue-invalid');
  assert.equal(warning.count, 101);
  assert.equal(warning.samples.length, 100);
  assert.deepEqual(warning.samples[0], { code: 'cue-0', path: 'Disc/0.cue' });
  assert.equal(Object.hasOwn(warning, 'internal'), false);
});

test('Electron scan runtime rehydrates folder availability and restores status after reconnect', async t => {
  const missingRoot = path.resolve(os.tmpdir(), 'effetune-rehydrate-missing');
  const deniedRoot = path.resolve(os.tmpdir(), 'effetune-rehydrate-denied');
  const restoredRoot = path.resolve(os.tmpdir(), 'effetune-rehydrate-restored');
  const folders = [
    {
      id: 'folder-missing', kind: 'electron', displayName: 'Missing', path: missingRoot,
      status: 'ok', scanGeneration: 0, lifecycleVersion: 1, addedAt: 1, lastScanAt: null
    },
    {
      id: 'folder-denied', kind: 'electron', displayName: 'Denied', path: deniedRoot,
      status: 'ok', scanGeneration: 0, lifecycleVersion: 2, addedAt: 2, lastScanAt: null
    },
    {
      id: 'folder-restored', kind: 'electron', displayName: 'Restored', path: restoredRoot,
      status: 'needs-permission', scanGeneration: 0, lifecycleVersion: 3, addedAt: 3, lastScanAt: null
    }
  ];
  const updates = [];
  const missingRoots = new Set([missingRoot]);
  const deniedRoots = new Set([deniedRoot]);
  const host = {
    on() {},
    removeListener() {},
    beginScanFolder() {},
    async listScanFolders({ folderIds } = {}) {
      return {
        folders: folderIds ? folders.filter(folder => folderIds.includes(folder.id)) : folders
      };
    },
    async upsertFolders(rows) {
      for (const row of rows) {
        const index = folders.findIndex(folder => folder.id === row.id);
        folders[index] = { ...row };
        updates.push({ id: row.id, status: row.status });
      }
    }
  };
  const runtime = new LibraryCatalogScanRuntime({
    host,
    dialog: { async showOpenDialog() { return { canceled: false, filePaths: [missingRoot] }; } },
    filesystem: {
      async realpath(root) {
        if (missingRoots.has(root)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return root;
      },
      async lstat() {
        return { isDirectory: () => true, isSymbolicLink: () => false };
      },
      async access(root) {
        if (deniedRoots.has(root)) throw Object.assign(new Error('denied'), { code: 'EACCES' });
      }
    },
    metadataParser: { async parse() { return {}; } },
    artworkWorkerPool: { async close() {} }
  });
  t.after(() => runtime.close());

  await runtime.rehydrateGrants();

  assert.deepEqual(updates, [
    { id: 'folder-missing', status: 'missing' },
    { id: 'folder-denied', status: 'needs-permission' },
    { id: 'folder-restored', status: 'ok' }
  ]);
  assert.deepEqual([...runtime.grants.keys()], ['folder-restored']);

  missingRoots.delete(missingRoot);
  const reconnected = await runtime.requestFolderAccess({ folderId: 'folder-missing' });
  assert.equal(reconnected.folder.status, 'ok');
  assert.equal(runtime.grants.has('folder-missing'), true);
  assert.deepEqual(updates.at(-1), { id: 'folder-missing', status: 'ok' });
});

test('Electron scan runtime serializes fresh scans for the same folder', async () => {
  const root = path.resolve(os.tmpdir(), 'serialized-scan-root');
  const folder = {
    id: 'folder-serialized', kind: 'electron', displayName: 'Music', path: root,
    status: 'ok', lifecycleVersion: 2, scanGeneration: 0
  };
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  let firstStarted;
  const firstStartedPromise = new Promise(resolve => { firstStarted = resolve; });
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const runtime = new LibraryCatalogScanRuntime({
    host: {
      on() {},
      removeListener() {},
      async listScanFolders() { return { folders: [folder] }; },
      beginScanFolder() {}
    },
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    metadataParser: { async parse() { return {}; } },
    artworkWorkerPool: { async close() {} }
  });
  runtime.BoundedScanService = class {
    async runFolder({ scanId }) {
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      if (calls === 1) {
        firstStarted();
        await firstGate;
      }
      active -= 1;
      return {
        scanId, folderId: folder.id, generation: calls, status: 'completed',
        continuityBroken: false, sweepEligibility: 'ELIGIBLE', counts: {}
      };
    }
  };
  runtime.automaticPlaylistModule = {
    AutomaticPlaylistCollector: class {},
    async importAutomaticPlaylists() {
      return {
        state: 'playlist-import-canceled',
        found: 1,
        imported: 0,
        alreadyImported: 0,
        failed: 0,
        canceled: 1
      };
    }
  };
  runtime.issueGrant(folder, root);

  const first = await runtime.scanFolders({ folderIds: [folder.id], scanId: 'scan-first' });
  await firstStartedPromise;
  const second = await runtime.scanFolders({ folderIds: [folder.id], scanId: 'scan-second' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  releaseFirst();
  const firstTerminal = await waitForTerminal(runtime, first.scanId);
  assert.equal(firstTerminal.status, 'completed');
  assert.equal(firstTerminal.results[0].playlistImportState, 'playlist-import-canceled');
  assert.equal(firstTerminal.results[0].counts.playlistImportsCanceled, 1);
  assert.equal((await waitForTerminal(runtime, second.scanId)).status, 'completed');
  assert.equal(maximumActive, 1);
  await runtime.close();
});

test('Electron playback sources require the current folder grant and return canonical absolute paths', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-playback-source-'));
  const selectedRoot = path.join(temporary, 'Music');
  await fs.mkdir(selectedRoot);
  const libraryRoot = await fs.realpath(selectedRoot);
  const fileName = process.platform === 'win32'
    ? 'Track # 100% 日本語.flac'
    : 'Track # ? 100% 日本語.flac';
  const filePath = path.join(libraryRoot, fileName);
  await fs.writeFile(filePath, Buffer.from('audio'));
  const folder = {
    id: 'folder-media-url', kind: 'electron', displayName: 'Music', path: libraryRoot,
    status: 'ok', lifecycleVersion: 7
  };
  const host = {
    on() {},
    removeListener() {},
    beginScanFolder() {},
    async listScanFolders() { return { folders: [folder] }; },
    async getTrackStorageIdentity() {
      return {
        trackUid: 'track-media-url', folderId: folder.id, relativePath: fileName,
        lifecycleVersion: folder.lifecycleVersion, durationSec: 6.25, size: 5
      };
    }
  };
  const runtime = new LibraryCatalogScanRuntime({
    host,
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    metadataParser: { async parse() { return {}; } },
    artworkWorkerPool: { async close() {} }
  });
  t.after(async () => {
    await runtime.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  await assert.rejects(
    runtime.resolvePlaybackSource('track-media-url'),
    error => error?.code === 'folderPermissionRequired' &&
      error?.details?.folderId === folder.id &&
      error?.details?.lifecycleVersion === folder.lifecycleVersion
  );

  runtime.issueGrant(folder, libraryRoot);
  const source = await runtime.resolvePlaybackSource('track-media-url');
  assert.deepEqual(source, {
    kind: 'electron-file',
    trackUid: 'track-media-url',
    folderId: folder.id,
    lifecycleVersion: folder.lifecycleVersion,
    path: filePath,
    byteLength: 5,
    physicalSourceKey: `${folder.id}\0${fileName}`,
    sourceKind: 'file',
    entryKey: null,
    cueRelativePath: null,
    startFrame: null,
    endFrame: null,
    durationSec: 6.25
  });
  assert.equal(path.isAbsolute(source.path), true);
  assert.equal(Object.hasOwn(source, 'mediaUrl'), false);
});

test('Electron playlist import grants hide paths, stream the selected file, and are single-use', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-playlist-grant-'));
  const playlistPath = path.join(temporary, 'Selected.m3u8');
  const expected = Buffer.from('#EXTM3U\nMusic/Track.flac\n');
  await fs.writeFile(playlistPath, expected);
  const host = {
    on() {},
    removeListener() {},
    listScanFolders: async () => ({ folders: [] }),
    beginScanFolder() {}
  };
  const runtime = new LibraryCatalogScanRuntime({
    host,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [playlistPath] }) }
  });
  t.after(async () => {
    await runtime.close();
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  const picked = await runtime.pickPlaylistImport({});
  assert.equal(picked.canceled, false);
  assert.equal(Object.hasOwn(picked.source, 'path'), false);
  assert.equal(picked.source.kind, 'electron-import-grant');

  await assert.rejects(
    runtime.consumePlaylistImportGrant({ ...picked.source, path: playlistPath }),
    error => error?.code === 'invalidPlaylistImportSource'
  );
  const granted = await runtime.consumePlaylistImportGrant(picked.source);
  const chunks = [];
  for await (const chunk of granted.stream()) chunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(chunks), expected);
  await assert.rejects(
    runtime.consumePlaylistImportGrant(picked.source),
    error => error?.code === 'playlistImportGrantInvalid'
  );

  const dropped = await runtime.grantDroppedPlaylistImport({ path: playlistPath });
  assert.equal(Object.hasOwn(dropped.source, 'path'), false);
  const droppedGrant = await runtime.consumePlaylistImportGrant(dropped.source);
  const droppedChunks = [];
  for await (const chunk of droppedGrant.stream()) droppedChunks.push(Buffer.from(chunk));
  assert.deepEqual(Buffer.concat(droppedChunks), expected);
});

test('Electron automatic playlist digest observes scan cancellation before open and between chunks', async t => {
  const selected = path.resolve(os.tmpdir(), 'Automatic.m3u8');
  const stats = {
    dev: 1,
    ino: 2,
    size: 8,
    mtimeMs: 3,
    isFile: () => true,
    isSymbolicLink: () => false
  };
  let openCount = 0;
  let readCount = 0;
  let closeCount = 0;
  let abortDuringRead = null;
  const filesystem = {
    async lstat() { return stats; },
    async realpath() { return selected; },
    async access() {},
    async open() {
      openCount += 1;
      return {
        async stat() { return stats; },
        async read(buffer) {
          readCount += 1;
          buffer.fill(0x61, 0, 4);
          abortDuringRead?.();
          return { bytesRead: 4 };
        },
        async close() { closeCount += 1; }
      };
    }
  };
  const runtime = new LibraryCatalogScanRuntime({
    host: {
      on() {}, removeListener() {},
      listScanFolders: async () => ({ folders: [] }),
      beginScanFolder() {}
    },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    filesystem,
    metadataParser: { async parse() { return {}; } }
  });
  t.after(() => runtime.close());

  const beforeOpen = new AbortController();
  const beforeOpenAbort = Object.assign(new Error('before open'), { name: 'AbortError' });
  beforeOpen.abort(beforeOpenAbort);
  await assert.rejects(
    runtime.issuePlaylistImportGrant(selected, { includeContentDigest: true, signal: beforeOpen.signal }),
    error => error?.name === 'AbortError'
  );
  assert.equal(openCount, 0);

  const betweenChunks = new AbortController();
  const betweenChunksAbort = Object.assign(new Error('between chunks'), { name: 'AbortError' });
  abortDuringRead = () => betweenChunks.abort(betweenChunksAbort);
  await assert.rejects(
    runtime.issuePlaylistImportGrant(selected, { includeContentDigest: true, signal: betweenChunks.signal }),
    error => error?.name === 'AbortError'
  );
  assert.equal(readCount, 1);
  assert.equal(closeCount, 1);
  assert.equal(runtime.playlistImportGrants.size, 0);
});

test('Electron lazy artwork binds its source then decodes before storage admission', async t => {
  const calls = [];
  const host = {
    on() {},
    removeListener() {},
    listScanFolders: async () => ({
      folders: [{ id: 'folder', path: path.resolve(os.tmpdir(), 'Music'), lifecycleVersion: 3, status: 'ok', kind: 'electron' }]
    }),
    beginScanFolder() {},
    getCachedArtwork: async () => null,
    getTrackStorageIdentity: async () => ({
      trackUid: 'track', folderId: 'folder', relativePath: 'Album/song.flac',
      fileIdentity: 'device:inode', size: 100, mtimeMs: 200, lifecycleVersion: 3
    }),
    async claimArtworkSource({ claim }) {
      calls.push(['claim', claim]);
      return { claim: { ...claim, claimId: 'claim-1' } };
    },
    async bindArtworkSourceDetails({ claim, fileStat, embeddedOffset, embeddedLength, mimeType }) {
      const bound = {
        ...claim,
        canonicalSourceIdentity: `Album/song.flac#embedded:${embeddedOffset ?? 'unknown'}:${embeddedLength}:${mimeType}`,
        embeddedOffset,
        embeddedLength
      };
      calls.push(['bind', { claim, fileStat, embeddedOffset, embeddedLength, mimeType }]);
      return { claim: bound };
    },
    async preflightArtworkBatch(request) {
      calls.push(['preflight', request]);
      return { ok: true };
    },
    async publishArtwork(request) {
      calls.push(['publish', request]);
      return { committed: true, artwork: { kind: 'thumbnail', artworkId: 'artwork' } };
    },
    async recordArtworkFailure() { throw new Error('not expected'); },
    async scheduleArtworkStagingGc() { throw new Error('not expected'); }
  };
  const artworkWorkerPool = {
    async extract() {
      return {
        bytes: new Uint8Array([1, 2, 3, 4]), mimeType: 'image/jpeg',
        embeddedOffset: null, embeddedLength: 4,
        fileStat: { size: 100, mtimeMs: 200 }
      };
    },
    async close() {}
  };
  const runtime = new LibraryCatalogScanRuntime({
    host,
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    metadataParser: { async parse() { return {}; } },
    artworkWorkerPool,
    utilitySessionId: 'utility-session',
    imageAdapter: {
      createFromBuffer() {
        calls.push(['decode']);
        return {
          isEmpty: () => false,
          getSize: () => ({ width: 10, height: 10 }),
          toJPEG: () => Buffer.from([5, 6, 7, 8])
        };
      }
    }
  });
  runtime.issueGrant({ id: 'folder', lifecycleVersion: 3 }, path.resolve(os.tmpdir(), 'Music'));
  runtime.resolveGrantedPath = async () => path.resolve(os.tmpdir(), 'Music', 'Album', 'song.flac');
  t.after(() => runtime.close());

  assert.deepEqual(await runtime.requestArtwork({ trackUid: 'track', reason: 'viewport' }), {
    kind: 'thumbnail', artworkId: 'artwork'
  });
  const claim = calls[0][1];
  assert.deepEqual(claim, {
    folderId: 'folder', lifecycleVersion: 3, trackUid: 'track', sourceKind: 'embedded-file',
    canonicalSourceIdentity: 'Album/song.flac',
    fileIdentity: 'device:inode', size: 100, mtimeMs: 200,
    embeddedOffset: null, embeddedLength: null, externalArtworkStat: null,
    extractorVersion: 'electron-artwork-v2', utilitySessionId: 'utility-session'
  });
  assert.equal(calls[1][0], 'bind');
  assert.equal(calls[2][0], 'decode');
  assert.equal(calls[3][0], 'preflight');
  assert.equal(calls[4][0], 'publish');
  assert.deepEqual(calls[4][1].claim, calls[4][1].expectedSourceClaim);
});

test('Electron artwork rejects decoder-reported image-bomb dimensions before storage admission', async t => {
  let claimCount = 0;
  let bound = false;
  let decoderCalled = false;
  let failure = null;
  let unsafeCall = false;
  const host = {
    on() {}, removeListener() {}, beginScanFolder() {},
    listScanFolders: async () => ({ folders: [{ id: 'folder', path: 'C:\\Music', lifecycleVersion: 1, status: 'ok' }] }),
    getCachedArtwork: async () => null,
    getTrackStorageIdentity: async () => ({
      trackUid: 'track', folderId: 'folder', relativePath: 'song.flac',
      fileIdentity: 'file', size: 10, mtimeMs: 20, lifecycleVersion: 1
    }),
    claimArtworkSource: async ({ claim }) => {
      claimCount += 1;
      return { claim: { ...claim, claimId: 'claim-bomb' } };
    },
    bindArtworkSourceDetails: async ({ claim }) => {
      bound = true;
      return { claim: { ...claim, embeddedLength: 1 } };
    },
    recordArtworkFailure: async request => { failure = request; },
    scheduleArtworkStagingGc: async () => ({ scheduled: true }),
    preflightArtworkBatch: async () => { unsafeCall = true; }
  };
  const runtime = new LibraryCatalogScanRuntime({
    host,
    dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
    metadataParser: { async parse() { return {}; } },
    artworkWorkerPool: {
      async extract() {
        return {
          bytes: new Uint8Array([1]), mimeType: 'image/jpeg',
          embeddedOffset: null, embeddedLength: 1, fileStat: { size: 10, mtimeMs: 20 }
        };
      },
      async close() {}
    },
    imageAdapter: {
      createFromBuffer() {
        decoderCalled = true;
        return {
          isEmpty: () => false,
          getSize: () => ({ width: 20000, height: 1 })
        };
      }
    }
  });
  runtime.issueGrant({ id: 'folder', lifecycleVersion: 1 }, 'C:\\Music');
  runtime.resolveGrantedPath = async () => 'C:\\Music\\song.flac';
  t.after(() => runtime.close());
  const result = await runtime.requestArtwork({ trackUid: 'track', reason: 'viewport' });
  assert.equal(result.kind, 'placeholder');
  assert.equal(result.errorCode, 'artworkDimensionsTooLarge');
  assert.equal(claimCount, 1);
  assert.equal(bound, true);
  assert.equal(decoderCalled, true);
  assert.equal(failure.errorCode, 'artworkDimensionsTooLarge');
  assert.equal(unsafeCall, false);
});
