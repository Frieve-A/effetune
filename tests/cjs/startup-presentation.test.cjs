const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createStartupPresentation } = require('../../electron/startup-presentation.cjs');

function harness() {
  const window = new EventEmitter();
  window.webContents = { mainFrame: {} };
  window.isDestroyed = () => false;
  const ipcMain = new EventEmitter();
  let quitting = false;
  const calls = [];
  const startup = createStartupPresentation({ window, ipcMain,
    isQuitting: () => quitting, present: () => calls.push('present') });
  return { window, ipcMain, calls, startup,
    quit: () => { quitting = true; },
    prepared: (event = { sender: window.webContents, senderFrame: window.webContents.mainFrame }) =>
      ipcMain.emit('renderer-ready-for-presentation', event) };
}

test('startup presents the prepared application even if the hidden window never paints', () => {
  for (const painted of [false, true]) {
    const h = harness();
    if (painted) h.window.emit('ready-to-show');
    assert.deepEqual(h.calls, []);
    h.prepared();
    assert.deepEqual(h.calls, ['present']);
    h.window.emit('ready-to-show');
    h.prepared();
    assert.deepEqual(h.calls, ['present']);
    assert.equal(h.ipcMain.listenerCount('renderer-ready-for-presentation'), 0);
  }
});

test('other windows and subframes cannot present the main window', () => {
  const h = harness();
  h.window.emit('ready-to-show');
  h.prepared({ sender: {}, senderFrame: {} });
  h.prepared({ sender: h.window.webContents, senderFrame: {} });
  assert.equal(h.startup.isReady(), false);
  assert.deepEqual(h.calls, []);
  h.prepared();
  assert.deepEqual(h.calls, ['present']);
});

test('closing or quitting during initialization never presents a window afterwards', () => {
  for (const close of [false, true]) {
    const h = harness();
    if (close) h.window.emit('closed');
    else h.quit();
    h.prepared();
    h.window.emit('ready-to-show');
    assert.deepEqual(h.calls, []);
    h.window.emit('closed');
    assert.equal(h.ipcMain.listenerCount('renderer-ready-for-presentation'), 0);
  }
});
