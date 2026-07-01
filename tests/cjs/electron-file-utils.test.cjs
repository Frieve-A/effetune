const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  createTempDir,
  loadFreshModule,
  withMutedConsoleAsync,
  withPatchedPropertyAsync
} = require('../helpers/cjs-module-utils.cjs');

test('saveFile writes base64 strings as binary content', async () => {
  const fileUtils = loadFreshModule('../../electron/file-utils.js');
  const filePath = path.join(createTempDir('effetune-file-utils'), 'binary.bin');

  assert.deepEqual(await fileUtils.saveFile(filePath, Buffer.from('binary data').toString('base64')), { success: true });
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'binary data');
});

test('saveFile writes non-base64 values as regular content', async () => {
  const fileUtils = loadFreshModule('../../electron/file-utils.js');
  const filePath = path.join(createTempDir('effetune-file-utils'), 'plain.txt');

  assert.deepEqual(await fileUtils.saveFile(filePath, 'plain text with spaces'), { success: true });
  assert.equal(fs.readFileSync(filePath, 'utf8'), 'plain text with spaces');
});

test('saveFile reports filesystem write errors', async () => {
  const fileUtils = loadFreshModule('../../electron/file-utils.js');

  await withMutedConsoleAsync('error', async () => {
    await withPatchedPropertyAsync(fs, 'writeFileSync', () => {
      throw new Error('disk full');
    }, async () => {
      assert.deepEqual(await fileUtils.saveFile('ignored.txt', 'content'), {
        success: false,
        error: 'disk full'
      });
    });
  });
});

test('readFile reads text and binary payloads', async () => {
  const fileUtils = loadFreshModule('../../electron/file-utils.js');
  const dir = createTempDir('effetune-file-utils');
  const textPath = path.join(dir, 'text.txt');
  const binaryPath = path.join(dir, 'audio.bin');
  fs.writeFileSync(textPath, 'hello');
  fs.writeFileSync(binaryPath, Buffer.from([0, 1, 2, 255]));

  assert.deepEqual(await fileUtils.readFile(textPath), { success: true, content: 'hello' });
  assert.deepEqual(await fileUtils.readFile(binaryPath, true), {
    success: true,
    content: 'AAEC/w==',
    isBinary: true
  });
});

test('readFile reports missing files', async () => {
  const fileUtils = loadFreshModule('../../electron/file-utils.js');
  const result = await fileUtils.readFile(path.join(createTempDir('effetune-file-utils'), 'missing.txt'));

  assert.equal(result.success, false);
  assert.match(result.error, /ENOENT|no such file/i);
});

test('readFileAsBuffer returns base64 and reports read errors', async () => {
  const fileUtils = loadFreshModule('../../electron/file-utils.js');
  const filePath = path.join(createTempDir('effetune-file-utils'), 'buffer.bin');
  fs.writeFileSync(filePath, Buffer.from('buffered'));

  assert.deepEqual(await fileUtils.readFileAsBuffer(filePath), {
    success: true,
    buffer: Buffer.from('buffered').toString('base64')
  });

  await withMutedConsoleAsync('error', async () => {
    const result = await fileUtils.readFileAsBuffer(path.join(createTempDir('effetune-file-utils'), 'missing.bin'));
    assert.equal(result.success, false);
    assert.match(result.error, /ENOENT|no such file/i);
  });
});

test('fileExists and joinPaths mirror filesystem helpers', () => {
  const fileUtils = loadFreshModule('../../electron/file-utils.js');
  const dir = createTempDir('effetune-file-utils');
  const filePath = path.join(dir, 'exists.txt');
  fs.writeFileSync(filePath, 'x');

  assert.equal(fileUtils.fileExists(filePath), true);
  assert.equal(fileUtils.fileExists(path.join(dir, 'missing.txt')), false);
  assert.equal(fileUtils.joinPaths('root', 'child', 'file.txt'), path.join('root', 'child', 'file.txt'));
});

test('savePipelineStateToFile rejects empty and invalid formats', async () => {
  const fileUtils = loadFreshModule('../../electron/file-utils.js');
  const dir = createTempDir('effetune-file-utils');

  assert.deepEqual(await fileUtils.savePipelineStateToFile(null, dir), {
    success: false,
    error: 'Empty pipeline state'
  });
  assert.deepEqual(await fileUtils.savePipelineStateToFile([], dir), {
    success: false,
    error: 'Empty pipeline state'
  });
  assert.deepEqual(await fileUtils.savePipelineStateToFile({ pipelineA: [] }, dir), {
    success: false,
    error: 'Empty pipeline state'
  });
  assert.deepEqual(await fileUtils.savePipelineStateToFile({ pipeline: [] }, dir), {
    success: false,
    error: 'Invalid pipeline state format'
  });
});

test('savePipelineStateToFile writes single and dual pipeline states', async () => {
  const fileUtils = loadFreshModule('../../electron/file-utils.js');
  const singleDir = path.join(createTempDir('effetune-file-utils'), 'nested');
  const singleState = [{ name: 'Volume', enabled: true }];
  assert.deepEqual(await fileUtils.savePipelineStateToFile(singleState, singleDir), { success: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(singleDir, 'pipeline-state.json'), 'utf8')), singleState);

  const dualADir = createTempDir('effetune-file-utils');
  const dualAState = { pipelineA: [{ name: 'A' }], pipelineB: [], currentPipeline: 'A' };
  assert.deepEqual(await fileUtils.savePipelineStateToFile(dualAState, dualADir), { success: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dualADir, 'pipeline-state.json'), 'utf8')), dualAState);

  const dualBDir = createTempDir('effetune-file-utils');
  const dualBState = { pipelineA: [], pipelineB: [{ name: 'B' }], currentPipeline: 'B' };
  assert.deepEqual(await fileUtils.savePipelineStateToFile(dualBState, dualBDir), { success: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dualBDir, 'pipeline-state.json'), 'utf8')), dualBState);
});

test('savePipelineStateToFile reports write errors', async () => {
  const fileUtils = loadFreshModule('../../electron/file-utils.js');

  await withMutedConsoleAsync('error', async () => {
    await withPatchedPropertyAsync(fs, 'writeFileSync', () => {
      throw new Error('cannot write state');
    }, async () => {
      assert.deepEqual(await fileUtils.savePipelineStateToFile([{ name: 'Volume' }], createTempDir('effetune-file-utils')), {
        success: false,
        error: 'cannot write state'
      });
    });
  });
});
