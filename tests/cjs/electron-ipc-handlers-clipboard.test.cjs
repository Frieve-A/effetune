const assert = require('node:assert/strict');
const test = require('node:test');

const { loadFreshModule, withModuleLoadStub } = require('../helpers/cjs-module-utils.cjs');

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

test('registerIpcHandlers wires native clipboard read and write handlers', () => {
  const electron = createElectronStub();

  withModuleLoadStub({ electron }, () => {
    const { registerIpcHandlers } = loadFreshModule('../../electron/ipc-handlers.js');
    registerIpcHandlers();
  });

  assert.equal(electron.handlers.get('read-clipboard-text')(), 'initial');
  assert.equal(electron.handlers.get('write-clipboard-text')({}, 'updated'), true);
  assert.equal(electron.clipboard.text, 'updated');
});
