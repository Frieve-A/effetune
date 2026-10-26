const assert = require('node:assert/strict');
const test = require('node:test');

const { loadFreshModule, withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');
const constants = require('../../electron/constants.js');

function createElectronStub() {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
    on() {}
  };
  const clipboard = {
    text: 'initial',
    readText() {
      return this.text;
    },
    writeText(text) {
      this.text = text;
    }
  };

  return {
    app: {
      getPath: () => '',
      setLoginItemSettings() {}
    },
    clipboard,
    dialog: {},
    ipcMain,
    shell: {},
    systemPreferences: {},
    Menu: {},
    handlers
  };
}

test('registerIpcHandlers wires native clipboard read and write handlers', async () => {
  const electron = createElectronStub();

  withModuleLoadStub({ electron }, () => {
    const { registerIpcHandlers } = loadFreshModule('../../electron/ipc-handlers.js');
    registerIpcHandlers();
  });

  assert.equal(await electron.handlers.get('read-clipboard-text')(), 'initial');
  assert.equal(await electron.handlers.get('write-clipboard-text')({}, 'updated'), true);
  assert.equal(electron.clipboard.text, 'updated');
});

test('registerIpcHandlers writes PNG through the Electron 45 clipboard contract', async t => {
  const oldWindow = constants.getMainWindow();
  t.after(() => constants.setMainWindow(oldWindow));
  const sender = { mainFrame: {} };
  constants.setMainWindow({ webContents: sender });
  const event = { sender, senderFrame: sender.mainFrame };
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=', 'base64');
  const electron = createElectronStub();
  electron.ClipboardItem = class {
    constructor(items) { this.items = items; }
    get types() { return Object.keys(this.items); }
    async getType(type) { return this.items[type]; }
  };
  electron.nativeImage = {
    createFromBuffer(bytes) {
      assert.deepEqual(bytes, png);
      return { isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) };
    }
  };
  let completeWrite;
  electron.clipboard.write = async items => {
    assert.equal(items.length, 1);
    assert.ok(items[0] instanceof electron.ClipboardItem);
    assert.deepEqual(items[0].types, ['image/png']);
    const blob = await items[0].getType('image/png');
    assert.ok(blob instanceof Blob);
    assert.equal(blob.type, 'image/png');
    assert.deepEqual(Buffer.from(await blob.arrayBuffer()), png);
    await new Promise(resolve => { completeWrite = resolve; });
  };
  withModuleLoadStub({ electron }, () => {
    const { registerIpcHandlers } = loadFreshModule('../../electron/ipc-handlers.js');
    registerIpcHandlers();
  });
  const result = withModuleLoadStub({ electron }, () =>
    electron.handlers.get('write-clipboard-image')(event, png));
  let completed = false;
  result.then(() => { completed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(typeof completeWrite, 'function');
  assert.equal(completed, false, 'IPC must await the native clipboard write');
  completeWrite();
  assert.equal(await result, true);
});
