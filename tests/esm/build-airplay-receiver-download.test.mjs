import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { downloadLockedArchive } from '../../scripts/build-airplay-receiver.mjs';

const url = 'https://example.invalid/archive.tar.gz';
const archive = Buffer.from('verified archive bytes');
const sha256 = createHash('sha256').update(archive).digest('hex');

async function destinationFor(t) {
  const directory = await mkdtemp(join(tmpdir(), 'effetune-airplay-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'source-cache', 'archive.tar.gz');
}

test('resumes a reset response body and caches only the verified archive', async t => {
  const destination = await destinationFor(t);
  const reset = new TypeError('terminated', {
    cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (requestedUrl, init) => {
    assert.equal(requestedUrl, url);
    await assert.rejects(stat(destination), { code: 'ENOENT' });
    if (++calls === 1) {
      assert.equal(init, undefined);
      return new Response(new ReadableStream({
        start(controller) { controller.enqueue(archive.subarray(0, 4)); },
        pull(controller) { controller.error(reset); }
      }));
    }
    assert.deepEqual(init, { headers: { Range: 'bytes=4-' } });
    return new Response(archive.subarray(4), { status: 206 });
  });
  t.mock.method(console, 'warn', () => {});

  await downloadLockedArchive(url, destination, sha256);
  assert.deepEqual(await readFile(destination), archive);
  await downloadLockedArchive(url, destination, sha256);
  assert.equal(calls, 2);
});

test('stops retrying when a mirror ignores Range and repeats partial transfers', async t => {
  const destination = await destinationFor(t);
  const reset = new TypeError('terminated', {
    cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
  });
  const partialSizes = [4, 5, 4, 5, 4];
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    const size = partialSizes.shift();
    assert.notEqual(size, undefined, 'requests must stop after three resets without progress');
    return {
      ok: true,
      status: 200,
      body: (async function* () {
        yield archive.subarray(0, size);
        throw reset;
      })()
    };
  });
  t.mock.method(console, 'warn', () => {});

  await assert.rejects(downloadLockedArchive(url, destination, sha256), error => error === reset);
  assert.equal(fetchMock.mock.callCount(), 5);
  await assert.rejects(stat(destination), { code: 'ENOENT' });
});

test('a checksum mismatch is terminal and writes no cache file', async t => {
  const destination = await destinationFor(t);
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response('wrong archive'));

  await assert.rejects(downloadLockedArchive(url, destination, sha256), {
    message: `Archive checksum mismatch: ${url}`
  });
  assert.equal(fetchMock.mock.callCount(), 1);
  await assert.rejects(stat(destination), { code: 'ENOENT' });
});
