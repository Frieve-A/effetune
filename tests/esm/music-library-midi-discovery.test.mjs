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

function metadata({ relativePath }) {
  const group = relativePath.split('/')[0];
  return { title: path.posix.basename(relativePath), artist: group, albumArtist: group, album: group, genre: group, durationSec: 1 };
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
        getFile: async () => ({ name: relativePath, size: 5, lastModified: 1 }) });
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
      for (const file of files) {
        await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
        await fs.writeFile(path.join(root, file), 'media');
      }
      repository = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
      runtime = await LibraryCatalogScanRuntime.open({ host: repository, metadataParser: parser,
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [root] }) } });
      coordinator = await LibraryServiceCoordinator.open({ repository });
      added = await runtime.addFolder({ includeMidi: true, includeVideo: true });
    } else {
      const database = new DatabaseSync(path.join(directory, 'catalog.sqlite'));
      await initializeWebSqliteRuntime(database, { storageManager: { estimate: async () => ({ quota: 1024 ** 3, usage: 0 }) } });
      repository = new WebSqliteCatalogRepository({ authority: 'test' });
      repository.database = database;
      repository.mode = 'readwrite';
      const root = directoryHandle('Music', files);
      runtime = new WebCatalogScanRuntime({ repository, metadataParserFactory: () => parser,
        handleStore: { list: async () => [], put: async () => {}, get: async () => root, close() {} } });
      coordinator = new WebLibraryServiceCoordinator({ repository });
      if (platform === 'Web session') {
        const { token } = await runtime.beginSessionFolder({ displayName: 'Music' });
        runtime.appendSessionFolderFiles({ token, entries: files.map(relativePath => ({ relativePath,
          file: { name: path.posix.basename(relativePath), size: 5, lastModified: 1 } })) });
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
  });
}
