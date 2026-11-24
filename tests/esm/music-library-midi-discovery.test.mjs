import { PagedPlaylistService } from '../../js/library/playlists/paged-playlist-service.js';
import { zip } from '../helpers/archive-fixtures.mjs';
import { getLyricsFiles } from '../../js/ui/audio-player/lyrics-file-links.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { WebSqliteCatalogRepository } from '../../js/library/repository/web-catalog-repository.js';
import { initializeWebSqliteRuntime } from '../../js/library/repository/web-sqlite-runtime.js';
import { WebCatalogScanRuntime } from '../../js/library/scan/web-scan-runtime.js';
import { WebLibraryServiceCoordinator } from '../../js/library/operations/web-library-service-coordinator.js';
import { removeSqliteTestDirectory } from '../helpers/sqlite-test-utils.mjs';

const require = createRequire(import.meta.url);
const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');
const { LibraryCatalogScanRuntime } = require('../../electron/library-catalog-scan-runtime.cjs');
const { LibraryServiceCoordinator } = require('../../electron/library-service-coordinator.cjs');
const files = ['Audio/song.flac', 'Video/clip.mp4', ...['mid', 'midi', 'kar', 'musicxml', 'xml', 'mxl'].map(extension => `Scores/piece.${extension}`),
  'Scores/C# minor.mid', 'Scores/C# collection/piece.mxl'];

const archivePath = 'Scores/C# scores.zip';
const archiveBytes = zip([['Set/Song.kar', 'music'], ['Set/SONG.WRD', 'words'], ['Other/SONG.WRD', 'other'], ['Set/cover.jpg', 'art']]);
const allPaths = [...files, archivePath];
function testFile(relativePath) {
  const name = path.posix.basename(relativePath);
  return new File([name.endsWith('.zip') ? archiveBytes : 'media'], name, { lastModified: 1 });
}

function metadata({ relativePath, archiveEntryPath }) {
  const group = relativePath.split('/')[0];
  return { title: path.posix.basename(archiveEntryPath || relativePath), artist: group, albumArtist: group, album: group, genre: group, durationSec: 1 };
}

function directoryHandle(name, paths) {
  const handles = new Map();
  for (const relativePath of paths) {
    const separator = relativePath.indexOf('/');
    if (separator >= 0) {
      const childName = relativePath.slice(0, separator);
      if (!handles.has(childName)) handles.set(childName, directoryHandle(childName,
        paths.filter(value => value.startsWith(`${childName}/`)).map(value => value.slice(childName.length + 1))));
    } else {
      handles.set(relativePath, { kind: 'file', name: relativePath,
        getFile: async () => testFile(relativePath) });
    }
  }
  return { kind: 'directory', name, queryPermission: async () => 'granted',
    async *values() { yield* handles.values(); },
    getDirectoryHandle: async childName => handles.get(childName),
    getFileHandle: async childName => handles.get(childName) };
}

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Library integration operation timed out')), 10_000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function waitUntil(predicate) {
  const deadline = Date.now() + 10_000;
  while (!await predicate()) {
    assert.ok(Date.now() < deadline, 'Library background operation timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

for (const platform of ['Electron', 'Web', 'Web session']) {
  test(`${platform} MIDI discovery updates catalog queries, aggregates, and playlist playback after refresh`, async t => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-midi-discovery-')));
    let repository;
    let runtime;
    let coordinator;
    t.after(async () => {
      coordinator?.dispose?.();
      coordinator?.close?.();
      await runtime?.close();
      await repository?.close();
      await removeSqliteTestDirectory(directory);
    });
    const parser = { parse: async input => metadata(input) };
    let added;
    if (platform === 'Electron') {
      const root = path.join(directory, 'Music');
      for (const file of allPaths) {
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await fs.writeFile(path.join(root, file), file === archivePath ? archiveBytes : 'media');
      }
      repository = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
      runtime = await LibraryCatalogScanRuntime.open({ host: repository, metadataParser: parser,
        artworkThumbnailer: async bytes => {
          assert.equal(Buffer.from(bytes).toString(), 'art');
          return { bytes: Uint8Array.of(1), width: 1, height: 1, mimeType: 'image/jpeg' };
        },
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) } });
      coordinator = await LibraryServiceCoordinator.open({ repository, importSourceProvider: runtime });
      added = await runtime.addFolder({ includeMidi: true, includeVideo: true });
    } else {
      const database = new DatabaseSync(path.join(directory, 'catalog.sqlite'));
      await initializeWebSqliteRuntime(database, { storageManager: { estimate: async () => ({ quota: 1024 ** 3, usage: 0 }) } });
      repository = new WebSqliteCatalogRepository({ authority: 'test' });
      repository.database = database;
      repository.mode = 'readwrite';
      const root = directoryHandle('Music', allPaths);
      runtime = new WebCatalogScanRuntime({ repository, metadataParserFactory: () => parser,
        handleStore: { list: async () => [], put: async () => {}, get: async () => root, close() {} } });
      coordinator = new WebLibraryServiceCoordinator({ repository, sourceProvider: runtime });
      if (platform === 'Web session') {
        const { token } = await runtime.beginSessionFolder({ displayName: 'Music' });
        runtime.appendSessionFolderFiles({ token, entries: allPaths.map(relativePath => ({ relativePath, file: testFile(relativePath) })) });
        added = await runtime.commitSessionFolder({ token, includeMidi: true, includeVideo: true });
      } else added = await runtime.addFolder({ handle: root, includeMidi: true, includeVideo: true });
    }
    async function complete(result) {
      if (platform !== 'Electron') return;
      await waitUntil(() => !runtime.getScanStatus({ scanId: result.scanId }).active);
      assert.equal(runtime.getScanStatus({ scanId: result.scanId }).status, 'completed');
    }
    async function tracks(request = {}) {
      const page = await repository.queryTracks({ query: '', limit: 20, ...request });
      const count = await repository.getContextCount({ contextToken: page.contextToken });
      await repository.releaseContext(page.contextToken);
      return { ...page, totalCount: count.totalCount };
    }
    async function assertCatalog(expectedFiles, expectedGroups) {
      assert.equal((await repository.getCounts()).tracks, expectedFiles.length);
      assert.deepEqual((await tracks()).rows.map(row => row.title).sort(), expectedFiles.map(file => path.posix.basename(file)).sort());
      assert.equal((await tracks({ scope: { folderId: added.folder.id } })).totalCount, expectedFiles.length);
      assert.equal((await tracks({ query: 'piece' })).totalCount, expectedFiles.filter(file => path.posix.basename(file).includes('piece')).length);
      for (const type of ['album', 'artist', 'genre']) {
        const page = await repository.queryEntities({ type, query: '', limit: 20 });
        assert.deepEqual(page.rows.map(row => row.name).sort(), [...expectedGroups].sort());
        assert.equal(page.rows.reduce((sum, row) => sum + row.trackCount, 0), expectedFiles.length);
        await repository.releaseContext(page.contextToken);
      }
      const children = await repository.browseFolderChildren({ folderId: added.folder.id, path: '', limit: 20 });
      assert.deepEqual(children.children.map(child => child.name).sort(), [...expectedGroups].sort());
    }
    async function playbackCount(scope = { playlistId: 'all-media' }) {
      const context = await repository.createContext({ endpoint: 'tracks', scope });
      try {
        const receipt = await coordinator.start({ operationKind: 'play', target: { transport: 'main' }, options: { seed: 17 },
          selectionDescriptor: { mode: 'all', contextToken: context.contextToken, exclusions: [] } });
        const terminal = await bounded(coordinator.waitForTerminal(receipt.operationId));
        assert.equal(terminal.result.state, 'succeeded');
        assert.equal(terminal.result.result.shuffleSeed, 17);
        return (await repository.queryPlaybackSequence({ sequenceId: terminal.result.result.sequenceId, ordinal: 0, limit: 20 })).items.length;
      } finally {
        await repository.releaseContext(context.contextToken);
      }
    }
    await complete(added.scan);
    await assertCatalog(files, ['Audio', 'Video', 'Scores']);
    const originalTracks = (await tracks()).rows;
    await repository.createPlaylistWithItems({ playlistId: 'all-media', name: 'All Media', createdAt: 1,
      items: originalTracks.map(row => ({ trackUid: row.trackUid })) });
    assert.equal(await playbackCount(), files.length);

    await complete(await runtime.scanFolders({ folderIds: [added.folder.id], includeVideo: true }));
    await assertCatalog(files.slice(0, 2), ['Audio', 'Video']);
    const disabledPlaylist = await repository.queryPlaylistItems({ playlistId: 'all-media', limit: 20 });
    assert.equal(disabledPlaylist.items.filter(item => item.trackUid === null).length, files.length - 2);
    assert.equal(await playbackCount(), 2);
    assert.equal(await playbackCount({ folderId: added.folder.id }), 2);

    await complete(await runtime.scanFolders({ folderIds: [added.folder.id], includeMidi: true, includeVideo: true }));
    await assertCatalog(files, ['Audio', 'Video', 'Scores']);
    assert.deepEqual((await tracks()).rows.filter(row => row.artist !== 'Scores').map(row => row.trackUid).sort(),
      originalTracks.filter(row => row.artist !== 'Scores').map(row => row.trackUid).sort());
    await waitUntil(async () => (await repository.queryPlaylistItems({ playlistId: 'all-media', limit: 20 })).items.every(item => item.trackUid !== null));
    assert.equal(await playbackCount(), files.length);

    const archiveOptions = { folderIds: [added.folder.id], includeMidi: true, includeVideo: true, includeMidiArchives: true };
    await complete(await runtime.scanFolders(archiveOptions));
    const archived = (await tracks()).rows.find(row => row.title === 'Song.kar');
    assert.equal(archived.sourceKind, 'archive-entry');
    const source = await coordinator.resolveSequenceEntrySource({ trackUid: archived.trackUid });
    if (platform === 'Electron') {
      assert.equal(source.fileName, 'Song.kar');
      assert.equal(Buffer.from(source.bytes).toString(), 'music');
      assert.equal(Buffer.from(source.wrd.bytes).toString(), 'words');
      assert.equal(source.path, undefined);
      const cover = await runtime.requestArtwork({ trackUid: archived.trackUid, reason: 'viewport' });
      assert.equal(cover.kind, 'thumbnail');
    } else {
      assert.equal(source.file.name, 'Song.kar');
      assert.equal(await source.file.text(), 'music');
      assert.equal(await getLyricsFiles(source.file)[0].text(), 'words');
    }
    await repository.createPlaylistWithItems({ playlistId: 'archived', name: 'Archived', createdAt: 2,
      items: [{ trackUid: archived.trackUid }] });
    await complete(await runtime.scanFolders({ ...archiveOptions, includeMidiArchives: false }));
    assert.equal((await repository.queryPlaylistItems({ playlistId: 'archived' })).items[0].trackUid, null);
    await complete(await runtime.scanFolders(archiveOptions));
    await waitUntil(async () => (await repository.queryPlaylistItems({ playlistId: 'archived' })).items[0].trackUid !== null);
  });
}

test('Electron scans 500 long archive entries and exports playlists after archive discovery is disabled', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-archive-paging-')));
  let host;
  let runtime;
  t.after(async () => {
    await runtime?.close();
    await host?.close();
    await removeSqliteTestDirectory(directory);
  });
  const root = path.join(directory, 'Music');
  await fs.mkdir(root);
  const name = '曲'.repeat(79) + '.zip';
  const memberDirectory = ('組'.repeat(38) + '/').repeat(5);
  const entries = Array.from({ length: 500 }, (_, index) => [memberDirectory + index + '.mid', 'score']);
  await fs.writeFile(path.join(root, name), zip(entries, 0));
  host = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
  const pages = [];
  const readCandidates = host.listMetadataCandidates.bind(host);
  host.listMetadataCandidates = async request => {
    const page = await readCandidates(request);
    if (page.items.length) pages.push({ cursor: request.cursor, ...page });
    return page;
  };
  runtime = await LibraryCatalogScanRuntime.open({ host, metadataParser: { parse: async input => metadata(input) },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) } });
  const result = await runtime.addFolder({ includeMidi: true, includeMidiArchives: true });
  await waitUntil(() => !runtime.getScanStatus({ scanId: result.scan.scanId }).active);
  assert.equal(runtime.getScanStatus({ scanId: result.scan.scanId }).status, 'completed');
  assert.equal((await host.getCounts()).tracks, entries.length);
  assert.ok(pages.length > 1);
  for (let index = 1; index < pages.length; index++) {
    assert.equal(pages[index].cursor, pages[index - 1].nextCursor);
    assert.equal(pages[index].cursor, pages[index - 1].resumeCursor);
  }
  assert.equal(pages.at(-1).nextCursor, null);
  assert.deepEqual(pages.flatMap(page => page.items.map(item => item.entryKey)),
    entries.map(([entry]) => 'archive:' + name + '#' + entry));

  const playlistId = 'long-entries';
  const trackIds = [];
  const query = { query: '', limit: 500 };
  let trackPage = await host.queryTracks(query);
  assert.ok(trackPage.rows.length < query.limit);
  const firstIds = trackPage.rows.map(row => row.trackUid);
  for (;;) {
    trackIds.push(...trackPage.rows.map(row => row.trackUid));
    if (!trackPage.nextCursor) break;
    trackPage = await host.queryTracks({ ...query, contextToken: trackPage.contextToken, cursor: trackPage.nextCursor });
  }
  const previous = await host.queryTracks({ ...query, contextToken: trackPage.contextToken, cursor: trackPage.previousCursor });
  assert.equal(previous.rows.at(-1).trackUid, trackIds[trackIds.indexOf(trackPage.rows[0].trackUid) - 1]);
  for (const ordinal of [0, firstIds.length, 499]) {
    const jumped = await host.readContextPageAtOrdinal({ contextToken: trackPage.contextToken, limit: 500, ordinal });
    assert.equal(jumped.rows[ordinal - jumped.pageStartOrdinal].trackUid, trackIds[ordinal]);
  }
  await host.releaseContext(trackPage.contextToken);
  assert.equal(new Set(trackIds).size, 500);
  await fs.writeFile(path.join(root, 'plain.mid'), 'plain');
  const plainScan = await runtime.scanFolders({ folderIds: [result.folder.id], includeMidi: true, includeMidiArchives: true });
  await waitUntil(() => !runtime.getScanStatus({ scanId: plainScan.scanId }).active);
  const plainPage = await host.queryTracks({ query: 'plain', limit: 1 });
  const plainUid = plainPage.rows[0].trackUid;
  await host.releaseContext(plainPage.contextToken);
  await host.createPlaylistWithItems({ playlistId, name: 'Archived and ordinary MIDI', createdAt: 1,
    items: [...trackIds.slice(0, 499), plainUid].map(trackUid => ({ trackUid })) });
  const disabled = await runtime.scanFolders({ folderIds: [result.folder.id], includeMidi: true });
  await waitUntil(() => !runtime.getScanStatus({ scanId: disabled.scanId }).active);

  const positions = [];
  let itemPages = 0;
  const readItems = host.queryPlaylistItems.bind(host);
  host.queryPlaylistItems = async request => {
    const page = await readItems(request);
    assert.equal(request.afterPosition, positions.at(-1) ?? 0);
    if (page.items.length) itemPages++;
    positions.push(...page.items.map(item => item.position));
    if (positions.length < 500) assert.equal(page.nextPosition, positions.at(-1));
    return page;
  };
  const service = new PagedPlaylistService({ client: host, requestIdFactory: () => 'export' });
  const chunks = [];
  const summary = await service.exportToSink(playlistId, { format: 'm3u8', relative: false,
    sink: { write(chunk) { chunks.push(chunk); }, commit() {}, abort() {} } });
  assert.deepEqual(summary, { exportedCount: 1, skippedTrackCount: 499 });
  assert.ok(itemPages > 1);
  assert.equal(new Set(positions).size, 500);
  assert.match(chunks.join(''), /plain\.mid/);
  assert.doesNotMatch(chunks.join(''), /\.zip/);

});
