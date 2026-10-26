const assert = require('node:assert/strict');
const test = require('node:test');

const { registerClipboardIpcHandlers } = require('../../electron/clipboard-ipc.js');
const constants = require('../../electron/constants.js');
const { withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');

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

test('image clipboard accepts bounded PNG from the main frame and rejects invalid callers or images', async t => {
  const oldWindow = constants.getMainWindow();
  t.after(() => constants.setMainWindow(oldWindow));
  const sender = { mainFrame: {} };
  constants.setMainWindow({ webContents: sender });
  const event = { sender, senderFrame: sender.mainFrame };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=', 'base64');
  const writes = [];
  const image = { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) };
  let decoded;
  const nativeImage = { createFromBuffer: bytes => { decoded = bytes; return image; } };
  class ClipboardItem {
    constructor(items) { this.items = items; }
  }
  const ipcMain = createIpcMain();
  const errors = [];
  const clipboard = { write: async value => { writes.push(value); } };
  registerClipboardIpcHandlers(ipcMain, clipboard, { error: (...args) => errors.push(args) });
  const invoke = (caller, bytes) => withModuleLoadStub({ electron: { nativeImage, ClipboardItem } },
    () => ipcMain.handlers.get('write-clipboard-image')(caller, bytes));
  assert.equal(await invoke(event, png), true);
  assert.deepEqual(decoded, png);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].length, 1);
  assert.ok(writes[0][0] instanceof ClipboardItem);
  assert.deepEqual(Object.keys(writes[0][0].items), ['image/png']);
  const blob = writes[0][0].items['image/png'];
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
  assert.equal(await invoke({ sender: {}, senderFrame: sender.mainFrame }, png), false);
  assert.equal(await invoke({ sender, senderFrame: {} }, png), false);
  assert.equal(await invoke(event, new Uint8Array(33)), false);
  assert.equal(await invoke(event, new Uint8Array(32 * 1024 * 1024 + 1)), false);
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(8193, 16);
  assert.equal(await invoke(event, oversized), false);
  image.isEmpty = () => true;
  assert.equal(await invoke(event, png), false);
  image.isEmpty = () => false;
  const failure = new Error('Unavailable');
  clipboard.write = async () => { throw failure; };
  assert.equal(await invoke(event, png), false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1], failure);
  assert.equal(writes.length, 1);
});
