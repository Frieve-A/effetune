import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWebCueSiblingFiles } from '../../js/ui/web-cue-source-resolver.js';

function parsedCue(reference = 'album.wav') {
  return {
    ok: true,
    files: [{ reference, audioTrackCount: 2 }]
  };
}

test('CUE-only Web selection resolves sibling audio and artwork from its registered folder handle', async () => {
  const cueFileHandle = { kind: 'file', async getFile() { return null; } };
  const rootHandle = {
    kind: 'directory',
    async *values() {},
    async resolve(handle) {
      assert.equal(handle, cueFileHandle);
      return ['Album', 'disc.cue'];
    },
    async queryPermission() { return 'granted'; }
  };
  const album = { name: 'ALBUM.WAV', size: 100, lastModified: 1 };
  const cover = { name: 'cover.png', size: 20, lastModified: 1 };
  const requestedPaths = [];
  let closed = 0;

  const files = await resolveWebCueSiblingFiles({
    cueFileHandle,
    parsedCue: parsedCue('album.wav'),
    handleStore: {
      async list() { return [{ folderId: 'music', handle: rootHandle }]; },
      close() { closed += 1; }
    },
    filesystemFactory(handle) {
      assert.equal(handle, rootHandle);
      return {
        async listFileNames(directory) {
          assert.equal(directory, 'Album');
          return ['disc.cue', 'ALBUM.WAV', 'cover.png', 'notes.txt'];
        },
        async getFile(relativePath) {
          requestedPaths.push(relativePath);
          return relativePath.endsWith('cover.png') ? cover : album;
        }
      };
    }
  });

  assert.deepEqual(files, [album, cover]);
  assert.deepEqual(requestedPaths, ['Album/ALBUM.WAV', 'Album/cover.png']);
  assert.equal(closed, 1);
});

test('CUE-only Web selection reports missing registered-folder access without scanning unrelated roots', async () => {
  const cueFileHandle = { kind: 'file', async getFile() { return null; } };
  let closed = 0;

  await assert.rejects(
    resolveWebCueSiblingFiles({
      cueFileHandle,
      parsedCue: parsedCue(),
      handleStore: {
        async list() {
          return [{
            folderId: 'other',
            handle: {
              kind: 'directory',
              async *values() {},
              async resolve() { return null; }
            }
          }];
        },
        close() { closed += 1; }
      }
    }),
    error => error?.code === 'cueSelectionSourceAccessRequired' &&
      error?.diagnosticCode === 'cue-not-in-registered-folder'
  );
  assert.equal(closed, 1);
});

test('CUE-only Web selection requests read access only for the registered folder containing the CUE', async () => {
  const cueFileHandle = { kind: 'file', async getFile() { return null; } };
  const calls = [];
  const unrelatedHandle = {
    kind: 'directory',
    async *values() {},
    async resolve(handle) {
      calls.push(['unrelated.resolve', handle]);
      return null;
    },
    async queryPermission() {
      calls.push(['unrelated.queryPermission']);
      return 'prompt';
    },
    async requestPermission() {
      calls.push(['unrelated.requestPermission']);
      return 'granted';
    }
  };
  const albumHandle = {
    kind: 'directory',
    async *values() {},
    async resolve(handle) {
      calls.push(['album.resolve', handle]);
      return ['album.cue'];
    },
    async queryPermission() {
      calls.push(['album.queryPermission']);
      return 'prompt';
    },
    async requestPermission(options) {
      calls.push(['album.requestPermission', options]);
      return 'granted';
    }
  };
  const album = { name: 'album.wav', size: 100, lastModified: 1 };

  const files = await resolveWebCueSiblingFiles({
    cueFileHandle,
    parsedCue: parsedCue(),
    handleStore: {
      async list() {
        return [
          { folderId: 'unrelated', handle: unrelatedHandle },
          { folderId: 'album', handle: albumHandle }
        ];
      },
      close() {}
    },
    filesystemFactory(handle) {
      assert.equal(handle, albumHandle);
      return {
        async listFileNames(directory) {
          calls.push(['album.listFileNames', directory]);
          return ['album.cue', 'album.wav'];
        },
        async getFile(relativePath) {
          calls.push(['album.getFile', relativePath]);
          return album;
        }
      };
    }
  });

  assert.deepEqual(files, [album]);
  assert.deepEqual(calls, [
    ['unrelated.resolve', cueFileHandle],
    ['album.resolve', cueFileHandle],
    ['album.queryPermission'],
    ['album.requestPermission', { mode: 'read' }],
    ['album.listFileNames', ''],
    ['album.getFile', 'album.wav']
  ]);
});
