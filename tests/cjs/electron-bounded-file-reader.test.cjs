'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MAX_FILE_BYTES,
  readFileBytes
} = require('../../electron/bounded-file-reader.js');

test('bounded file reader returns an ArrayBuffer for a regular file', async t => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'effetune-byte-reader-'));
  t.after(() => fs.promises.rm(temporary, { recursive: true, force: true }));
  const filePath = path.join(temporary, 'audio.bin');
  await fs.promises.writeFile(filePath, Buffer.from([1, 2, 3, 4]));

  const result = await readFileBytes(filePath);
  assert.ok(result instanceof ArrayBuffer);
  assert.deepEqual([...new Uint8Array(result)], [1, 2, 3, 4]);
});

test('bounded file reader rejects oversized and non-regular files', async t => {
  const temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'effetune-byte-limit-'));
  t.after(() => fs.promises.rm(temporary, { recursive: true, force: true }));
  const oversized = path.join(temporary, 'oversized.bin');
  await fs.promises.writeFile(oversized, '');
  await fs.promises.truncate(oversized, MAX_FILE_BYTES + 1);

  await assert.rejects(readFileBytes(oversized), error => error?.code === 'ERR_LIBRARY_READ_LIMIT');
  await assert.rejects(readFileBytes(temporary), error => error?.code === 'ERR_FILE_NOT_REGULAR');
});
