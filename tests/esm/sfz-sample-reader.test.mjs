import assert from 'node:assert/strict';
import test from 'node:test';
import { File } from 'node:buffer';
import { createSfzFileSampleReader, SFZ_SAMPLE_RANGE_MAX_BYTES } from '../../js/sfz/sample-reader.js';

test('browser sample readers slice exact ranges without reading the whole File', async () => {
  const file = new File([new Uint8Array([10, 20, 30, 40, 50])], 'tone.wav', { lastModified: 123 });
  file.arrayBuffer = () => assert.fail('Must not read the whole File');
  const reader = await createSfzFileSampleReader(file);
  assert.equal(Object.isFrozen(reader), true);
  assert.equal(reader.size, 5);
  assert.equal(reader.revision, '5:123');
  assert.deepEqual([...await reader.readRange(1, 3)], [20, 30, 40]);
  assert.equal((await reader.readRange(5, 0)).byteLength, 0);
  for (const [offset, length] of [[0, SFZ_SAMPLE_RANGE_MAX_BYTES + 1], [5, 1], [-1, 1],
    [1, -.5], [Number.MAX_SAFE_INTEGER, 2]]) {
    await assert.rejects(reader.readRange(offset, length), { code: 'prepare' });
  }
});

test('browser handle readers keep the captured snapshot and reject changed source revisions', async () => {
  let file = new File(['first'], 'tone.wav', { lastModified: 100 });
  const reader = await createSfzFileSampleReader({ getFile: async () => file });
  assert.equal(new TextDecoder().decode(await reader.readRange(0, 5)), 'first');
  file = new File(['other'], 'tone.wav', { lastModified: 101 });
  await assert.rejects(reader.readRange(0, 5), { code: 'source-changed' });
});

test('browser range readers preserve large offsets and fail short or unreadable snapshots', async () => {
  const ranges = [];
  const reader = await createSfzFileSampleReader({ size: 2 ** 34, lastModified: 123,
    arrayBuffer: () => assert.fail('Must not read the whole source'),
    slice(start, end) {
      ranges.push([start, end]);
      return { arrayBuffer: async () => new Uint8Array([7, 8]).buffer };
    } });
  assert.deepEqual([...await reader.readRange(2 ** 32 + 1, 2)], [7, 8]);
  assert.deepEqual(ranges, [[2 ** 32 + 1, 2 ** 32 + 3]]);
  await assert.rejects(reader.readRange(0, 3), { code: 'source-changed' });
  const unreadable = await createSfzFileSampleReader({ size: 5, lastModified: 1,
    slice() { throw new Error('Snapshot is no longer readable'); } });
  await assert.rejects(unreadable.readRange(0, 1), { code: 'source-changed' });
});
