const assert = require('node:assert/strict');
const test = require('node:test');

const { registerClipboardIpcHandlers } = require('../../electron/clipboard-ipc.js');

function createIpcMain() {
  const handlers = new Map();
  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
}

test('registerClipboardIpcHandlers registers native clipboard read and write handlers', async () => {
  const ipcMain = createIpcMain();
  const writes = [];
  const clipboard = {
    readText: () => 'shared preset',
    writeText: text => writes.push(text)
  };

  registerClipboardIpcHandlers(ipcMain, clipboard);

  assert.equal(await ipcMain.handlers.get('read-clipboard-text')(), 'shared preset');
  assert.equal(await ipcMain.handlers.get('write-clipboard-text')({}, 'copied preset'), true);
  assert.equal(await ipcMain.handlers.get('write-clipboard-text')({}, null), true);
  assert.deepEqual(writes, ['copied preset', '']);
});

test('read clipboard handler logs and returns an empty string when native read rejects', async () => {
  const ipcMain = createIpcMain();
  const errors = [];
  const failure = new Error('clipboard unavailable');

  registerClipboardIpcHandlers(
    ipcMain,
    { readText: () => Promise.reject(failure), writeText: () => Promise.resolve() },
    { error: (...args) => errors.push(args) }
  );

  assert.equal(await ipcMain.handlers.get('read-clipboard-text')(), '');
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1], failure);
});

test('write clipboard handler logs and returns false when native write rejects', async () => {
  const ipcMain = createIpcMain();
  const errors = [];
  const failure = new Error('write denied');

  registerClipboardIpcHandlers(
    ipcMain,
    { readText: () => Promise.resolve(''), writeText: () => Promise.reject(failure) },
    { error: (...args) => errors.push(args) }
  );

  assert.equal(await ipcMain.handlers.get('write-clipboard-text')({}, 'preset'), false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1], failure);
});
