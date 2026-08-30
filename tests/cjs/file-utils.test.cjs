const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { saveFile } = require('../../electron/file-utils');

function createTemporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-file-utils-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('saveFile atomically replaces an existing file after a complete write', async t => {
  const directory = createTemporaryDirectory(t);
  const filePath = path.join(directory, 'output.wav');
  fs.writeFileSync(filePath, 'original');
  const replacement = Buffer.from('replacement audio');

  const result = await saveFile(filePath, replacement.toString('base64'));

  assert.deepEqual(result, { success: true });
  assert.deepEqual(fs.readFileSync(filePath), replacement);
  assert.deepEqual(fs.readdirSync(directory), ['output.wav']);
});

test('saveFile preserves the previous file when writing the temporary file fails', async t => {
  t.mock.method(console, 'error', () => {});
  const directory = createTemporaryDirectory(t);
  const filePath = path.join(directory, 'output.wav');
  fs.writeFileSync(filePath, 'original');
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = (target, content, ...args) => {
    if (typeof target === 'number') {
      originalWriteFileSync(target, Buffer.from('partial'));
      const error = new Error('simulated write failure');
      error.code = 'ENOSPC';
      throw error;
    }
    return originalWriteFileSync(target, content, ...args);
  };

  try {
    const result = await saveFile(filePath, Buffer.from('replacement').toString('base64'));
    assert.equal(result.success, false);
    assert.match(result.error, /simulated write failure/);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }

  assert.equal(fs.readFileSync(filePath, 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(directory), ['output.wav']);
});

test('saveFile preserves the previous file when atomic rename is unavailable', async t => {
  t.mock.method(console, 'error', () => {});
  const directory = createTemporaryDirectory(t);
  const filePath = path.join(directory, 'output.wav');
  fs.writeFileSync(filePath, 'original');
  const originalRenameSync = fs.renameSync;
  fs.renameSync = (source, destination) => {
    if (destination === filePath) {
      const error = new Error('simulated rename failure');
      error.code = 'EPERM';
      throw error;
    }
    return originalRenameSync(source, destination);
  };

  try {
    const result = await saveFile(filePath, Buffer.from('replacement').toString('base64'));
    assert.equal(result.success, false);
    assert.match(result.error, /simulated rename failure/);
  } finally {
    fs.renameSync = originalRenameSync;
  }

  assert.equal(fs.readFileSync(filePath, 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(directory), ['output.wav']);
});
