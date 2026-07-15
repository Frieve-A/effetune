import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AutomaticPlaylistCollector,
  digestPlaylistSource,
  importAutomaticPlaylists
} from '../../js/library/playlists/automatic-playlist-import.js';
import {
  IncrementalSha256,
  sha256Hex
} from '../../js/library/repository/sha256.js';

const encoder = new TextEncoder();

function sourceFrom(text, name = 'Daily.m3u8') {
  const bytes = encoder.encode(text);
  return {
    name,
    size: bytes.byteLength,
    lastModified: 1,
    type: 'audio/x-mpegurl',
    stream() {
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.subarray(0, Math.min(3, bytes.length)));
          if (bytes.length > 3) controller.enqueue(bytes.subarray(3));
          controller.close();
        }
      });
    }
  };
}

function collector(...relativePaths) {
  const value = new AutomaticPlaylistCollector();
  for (const relativePath of relativePaths) value.add({ relativePath });
  return value;
}

test('incremental SHA-256 matches one-shot hashing across chunk boundaries', () => {
  const bytes = encoder.encode('playlist-content\n'.repeat(100));
  const incremental = new IncrementalSha256();
  for (let offset = 0; offset < bytes.length; offset += 17) {
    incremental.update(bytes.subarray(offset, offset + 17));
  }
  assert.equal(incremental.digestHex(), sha256Hex(bytes));
});

test('automatic playlist import skips a source whose successful content digest is unchanged', async () => {
  const source = sourceFrom('#EXTM3U\none.mp3\n');
  const contentDigest = await digestPlaylistSource(source);
  let starts = 0;
  const summary = await importAutomaticPlaylists({
    folderId: 'folder-1',
    collector: collector('Daily.m3u8'),
    attemptId: 'scan-1',
    openSource: async () => ({ source }),
    service: {
      async getAutomaticPlaylistImportState() {
        return { state: 'active', version: 4, contentDigest };
      },
      async startAutomaticPlaylistImport() { starts += 1; },
      async waitForTerminal() { throw new Error('not expected'); }
    }
  });
  assert.equal(starts, 0);
  assert.equal(summary.alreadyImported, 1);
  assert.equal(summary.imported, 0);
});

test('failed automatic content is retried with a new request identity on the next rescan', async () => {
  const requestIds = [];
  const service = {
    async getAutomaticPlaylistImportState() {
      return { state: 'missing', version: null, contentDigest: null };
    },
    async startAutomaticPlaylistImport(request) {
      requestIds.push(request.clientRequestId);
      return { kind: 'terminal', result: { state: 'failed', code: 'parseFailed' } };
    },
    async waitForTerminal() { throw new Error('not expected'); }
  };
  for (const attemptId of ['scan-failed', 'scan-retry']) {
    const summary = await importAutomaticPlaylists({
      service,
      folderId: 'folder-1',
      collector: collector('Daily.m3u8'),
      attemptId,
      openSource: async () => ({ source: sourceFrom('#EXTM3U\none.mp3\n') })
    });
    assert.equal(summary.failed, 1);
  }
  assert.equal(requestIds.length, 2);
  assert.notEqual(requestIds[0], requestIds[1]);
});

test('canceling playlist import after scan completion reports an explicit state without starting work', async () => {
  const controller = new AbortController();
  controller.abort();
  const summary = await importAutomaticPlaylists({
    folderId: 'folder-1',
    collector: collector('Daily.m3u8', 'Later.pls'),
    attemptId: 'scan-cancel',
    signal: controller.signal,
    openSource: async () => { throw new Error('not expected'); },
    service: {
      async getAutomaticPlaylistImportState() { throw new Error('not expected'); },
      async startAutomaticPlaylistImport() { throw new Error('not expected'); },
      async waitForTerminal() { throw new Error('not expected'); }
    }
  });
  assert.equal(summary.state, 'playlist-import-canceled');
  assert.equal(summary.canceled, 2);
  assert.equal(summary.imported, 0);
});
