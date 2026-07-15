'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');
const { LibraryCatalogScanRuntime } = require('../../electron/library-catalog-scan-runtime.cjs');

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
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: {
      async showOpenDialog() {
        return { canceled: false, filePaths: [libraryRoot] };
      }
    },
    metadataParser: {
      async parse() {
        parseCount += 1;
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
  const added = await runtime.addFolder({});
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

test('Electron scan runtime resumes the same generation without enabling a deletion sweep', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-catalog-resume-'));
  const libraryRoot = path.join(temporary, 'Music');
  const trackPath = path.join(libraryRoot, 'resume.mp3');
  await fs.mkdir(libraryRoot);
  await fs.writeFile(trackPath, Buffer.from('initial'));
  await fs.writeFile(path.join(libraryRoot, 'second.mp3'), Buffer.from('second'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(temporary, 'catalog.sqlite') });
  let blockNextParse = false;
  let parseStarted;
  const parseStartedPromise = new Promise(resolve => { parseStarted = resolve; });
  const runtime = await LibraryCatalogScanRuntime.open({
    host,
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [libraryRoot] }) },
    scanConfig: { maxBatchTracks: 1 },
    metadataParser: {
      async parse({ signal }) {
        if (!blockNextParse) return { title: 'Resume' };
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

test('Electron lazy artwork binds the full source lifecycle and runs storage admission before decode', async t => {
  const calls = [];
  let admitted = false;
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
      admitted = true;
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
        width: 10, height: 10, embeddedOffset: null, embeddedLength: 4,
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
        assert.equal(admitted, true);
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
  assert.equal(calls[2][0], 'preflight');
  assert.equal(calls[3][0], 'publish');
  assert.deepEqual(calls[3][1].claim, calls[3][1].expectedSourceClaim);
});

test('Electron artwork claims before dispatch and rejects image-bomb dimensions before admission or native decode', async t => {
  let claimCount = 0;
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
    bindArtworkSourceDetails: async () => { unsafeCall = true; },
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
          bytes: new Uint8Array([1]), mimeType: 'image/jpeg', width: 20000, height: 1,
          embeddedOffset: null, embeddedLength: 1, fileStat: { size: 10, mtimeMs: 20 }
        };
      },
      async close() {}
    },
    imageAdapter: { createFromBuffer() { unsafeCall = true; } }
  });
  runtime.issueGrant({ id: 'folder', lifecycleVersion: 1 }, 'C:\\Music');
  runtime.resolveGrantedPath = async () => 'C:\\Music\\song.flac';
  t.after(() => runtime.close());
  const result = await runtime.requestArtwork({ trackUid: 'track', reason: 'viewport' });
  assert.equal(result.kind, 'placeholder');
  assert.equal(result.errorCode, 'artworkDimensionsTooLarge');
  assert.equal(claimCount, 1);
  assert.equal(unsafeCall, false);
});
