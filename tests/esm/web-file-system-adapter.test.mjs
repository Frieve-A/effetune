import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WebFileSystemScanAdapter, compareFolderRoots, isSameFolderRoot, queryFolderPermission
} from '../../js/library/scan/web-file-system-adapter.js';

function directory(entries = [], overrides = {}) {
  return {
    kind: 'directory', name: 'Music',
    async *values() { yield* entries; },
    async getDirectoryHandle(name) {
      const entry = entries.find(item => item.name === name && item.kind === 'directory');
      if (!entry) throw new DOMException('Missing folder', 'NotFoundError');
      return entry;
    },
    async getFileHandle(name) {
      const entry = entries.find(item => item.name === name && item.kind === 'file');
      if (!entry) throw new DOMException('Missing file', 'NotFoundError');
      return entry;
    },
    ...overrides
  };
}

function file(name, data = 'audio') {
  const blob = new File([data], name, { lastModified: 1234 });
  return { kind: 'file', name, getFile: async () => blob };
}

test('Web directory scanning separates audio, CUE, playlists, subfolders, and optional video', async () => {
  const entries = [file('song.FLAC'), file('album.cue'), file('list.m3u8'),
    file('notes.txt'), file('video.mp4'), directory([], { name: 'Album' })];
  for (const includeVideo of [false, true]) {
    const playlists = [];
    const adapter = new WebFileSystemScanAdapter({
      rootHandle: directory([directory(entries, { name: 'Disc' })]),
      includeVideo, onPlaylistFile: entry => playlists.push(entry)
    });
    const result = await Array.fromAsync(adapter.enumerateDirectory({ relativeDirectory: 'Disc' }));
    assert.deepEqual(result.map(({ kind, relativePath }) => [kind, relativePath]), [
      ['file', 'Disc/song.FLAC'], ['cue', 'Disc/album.cue'],
      ...(includeVideo ? [['file', 'Disc/video.mp4']] : []), ['directory', 'Disc/Album']
    ]);
    assert.deepEqual(playlists, [{ name: 'list.m3u8', path: 'Disc/list.m3u8', relativePath: 'Disc/list.m3u8' }]);
    assert.deepEqual(await adapter.listFileNames('Disc'), ['song.FLAC', 'album.cue', 'list.m3u8', 'notes.txt', 'video.mp4']);
  }
});

test('Web small-file reads enforce the byte limit before allocating and preserve file identity', async () => {
  let reads = 0;
  const source = { size: 4, lastModified: 1234, async arrayBuffer() { reads += 1; return Uint8Array.of(1, 2, 3, 4).buffer; } };
  const adapter = new WebFileSystemScanAdapter({ rootHandle: directory([
    directory([{ kind: 'file', name: 'song.lrc', getFile: async () => source }], { name: 'Album' })
  ]) });
  assert.deepEqual(await adapter.statFile({ entry: { relativePath: 'Album\\song.lrc' } }), {
    fileIdentity: 'fsa:Album/song.lrc', size: 4, mtimeMs: 1234
  });
  assert.deepEqual(await adapter.readSmallFile({ relativePath: 'Album/song.lrc', maximumBytes: 3 }), {
    tooLarge: true, size: 4, bytes: null
  });
  assert.equal(reads, 0);
  assert.deepEqual(await adapter.readSmallFile({ relativePath: 'Album/song.lrc', maximumBytes: 4 }), {
    tooLarge: false, size: 4, bytes: Uint8Array.of(1, 2, 3, 4)
  });
  assert.equal(reads, 1);
});

test('Web scan paths cannot traverse outside the selected directory', async () => {
  let touched = false;
  const adapter = new WebFileSystemScanAdapter({ rootHandle: directory([], {
    async getDirectoryHandle() { touched = true; }, async getFileHandle() { touched = true; }
  }) });
  for (const relativePath of ['../secret.flac', 'Album/../../secret.flac', 'Album\\..\\secret.flac', '']) {
    await assert.rejects(adapter.getFile(relativePath), { code: 'invalidScanPath' });
  }
  await assert.rejects(Array.fromAsync(adapter.enumerateDirectory({ relativeDirectory: '../outside' })), { code: 'invalidScanPath' });
  assert.equal(touched, false);
});

test('Web file failures distinguish permission loss, expired handles, and transient I/O', async () => {
  for (const [name, code] of [
    ['NotAllowedError', 'temporary-permission'], ['NotFoundError', 'handle-expired'], ['NotReadableError', 'transient-io']
  ]) {
    const error = new DOMException('File unavailable', name);
    const rootHandle = directory([], {
      getFileHandle: async () => { throw error; },
      async *values() { yield await Promise.reject(error); }
    });
    const adapter = new WebFileSystemScanAdapter({ rootHandle });
    await assert.rejects(adapter.getFile('song.flac'), { code });
    await assert.rejects(adapter.listFileNames(), { code });
    await assert.rejects(Array.fromAsync(adapter.enumerateDirectory()), { code });
  }
});

test('Web scans reject unusable iterators and stale subdirectory handles', async () => {
  const adapter = new WebFileSystemScanAdapter({ rootHandle: directory([], {
    values() { throw new Error('Expired iterator'); }
  }) });
  await assert.rejects(Array.fromAsync(adapter.enumerateDirectory()), { code: 'handle-expired' });
  await assert.rejects(adapter.listFileNames('missing'), { code: 'handle-expired' });
});

test('Web file stats reject invalid sizes and timestamps before returning a source', async () => {
  for (const [stat, code] of [
    [{ size: -1, lastModified: 0 }, 'metadata-too-large'],
    [{ size: Number.MAX_SAFE_INTEGER + 1, lastModified: 0 }, 'metadata-too-large'],
    [{ size: 0, lastModified: NaN }, 'transient-io']
  ]) {
    const adapter = new WebFileSystemScanAdapter({ rootHandle: directory([
      { kind: 'file', name: 'song.flac', getFile: async () => stat }
    ]) });
    await assert.rejects(adapter.getFile('song.flac'), { code });
  }
});

test('Web file reads and directory iteration discard results after cancellation', async () => {
  const controller = new AbortController();
  const reason = new DOMException('Canceled', 'AbortError');
  const adapter = new WebFileSystemScanAdapter({ rootHandle: directory([
    { kind: 'file', name: 'song.lrc', getFile: async () => ({
      size: 1, lastModified: 1234,
      async arrayBuffer() { controller.abort(reason); return new Uint8Array(1).buffer; }
    }) }
  ]) });
  await assert.rejects(adapter.readSmallFile({ relativePath: 'song.lrc', maximumBytes: 1, signal: controller.signal }), error => error === reason);
  await assert.rejects(adapter.listFileNames('', controller.signal), error => error === reason);
  await assert.rejects(Array.fromAsync(adapter.enumerateDirectory({ signal: controller.signal })), error => error === reason);
  const iterationController = new AbortController();
  const iterator = new WebFileSystemScanAdapter({ rootHandle: directory([file('a.flac'), file('b.flac')]) })
    .enumerateDirectory({ signal: iterationController.signal });
  assert.equal((await iterator.next()).value.name, 'a.flac');
  iterationController.abort(reason);
  await assert.rejects(iterator.next(), error => error === reason);
});

test('Web file operations preserve cancellation and repository errors during pending reads', async () => {
  for (const error of [new DOMException('Canceled', 'AbortError'), Object.assign(new Error('Parser limit'), { code: 'metadata-too-large' })]) {
    const adapter = new WebFileSystemScanAdapter({ rootHandle: directory([], {
      async getFileHandle() { throw error; }
    }) });
    await assert.rejects(adapter.getFile('song.flac'), actual => actual === error);
  }
  for (const reason of [new DOMException('Canceled while reading', 'AbortError'), new Error('Library closed')]) {
    const controller = new AbortController();
    const adapter = new WebFileSystemScanAdapter({ rootHandle: directory([
      { kind: 'file', name: 'song.flac', async getFile() {
        controller.abort(reason);
        return { size: 1, lastModified: 0 };
      } }
    ]) });
    await assert.rejects(adapter.getFile('song.flac', controller.signal), error => error === reason);
    const listingController = new AbortController();
    const listing = new WebFileSystemScanAdapter({ rootHandle: directory([], {
      async *values() {
        listingController.abort(reason);
        yield file('song.flac');
      }
    }) });
    await assert.rejects(listing.listFileNames('', listingController.signal), error => error === reason);
  }
});

test('folder containment distinguishes same, ancestor, descendant, and unrelated handles', async () => {
  for (const [forward, backward, expected] of [[[], null, 'same'], [['Disc'], null, 'ancestor'],
    [null, [], 'same'], [null, ['Disc'], 'descendant'], [null, null, 'unrelated']]) {
    const candidate = directory([], { resolve: async () => forward });
    const existing = directory([], { resolve: async () => backward });
    assert.equal(await compareFolderRoots(candidate, existing), expected);
    assert.equal(await isSameFolderRoot(candidate, existing), expected === 'same');
  }
  const root = directory();
  assert.equal(await compareFolderRoots(root, root), 'same');
  assert.equal(await compareFolderRoots(directory([], { isSameEntry: async () => true }), root), 'same');
  await assert.rejects(compareFolderRoots(directory(), directory()), { code: 'folderContainmentUnavailable' });
  assert.equal(await isSameFolderRoot(directory(), directory()), false);
  await assert.rejects(compareFolderRoots(directory([], { isSameEntry: async () => { throw new Error('Revoked'); } }), root),
    { code: 'folderContainmentUnavailable' });
});

test('folder permission checks remain read-only and treat denied or failed queries as needing permission', async () => {
  assert.equal(await queryFolderPermission(directory()), 'granted');
  for (const permission of ['granted', 'prompt', 'denied']) {
    const root = directory([], { async queryPermission(options) {
      assert.deepEqual(options, { mode: 'read' });
      return permission;
    } });
    assert.equal(await queryFolderPermission(root), permission === 'granted' ? 'granted' : 'needs-permission');
  }
  assert.equal(await queryFolderPermission(directory([], { async queryPermission() { throw new Error('Revoked'); } })), 'needs-permission');
});
