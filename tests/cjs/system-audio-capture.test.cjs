const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createSystemAudioCapture } = require('../../electron/system-audio-capture.cjs');

function harness(t, getSources = async () => [{ id: 'screen:0:0' }]) {
  const ipcMain = new EventEmitter();
  const trusted = { mainFrame: {}, isDestroyed: () => false };
  const capture = createSystemAudioCapture({ mainWindow: { webContents: trusted }, ipcMain, desktopCapturer: { getSources } });
  t.after(() => capture.dispose());
  const prepare = (event = { sender: trusted, senderFrame: trusted.mainFrame }) => {
    ipcMain.emit('system-audio:prepare-capture', event); return event.returnValue;
  };
  const request = async (changes = {}) => {
    let streams;
    await capture.handleRequest({ frame: trusted.mainFrame, videoRequested: true, audioRequested: true, ...changes }, value => { streams = value; });
    return streams;
  };
  return { ipcMain, trusted, capture, prepare, request };
}

test('System Audio reservations accept only the trusted main frame', async t => {
  const h = harness(t);
  const unavailable = { ok: false, error: 'unavailable' };
  assert.deepEqual(h.prepare({ sender: {}, senderFrame: h.trusted.mainFrame }), unavailable);
  assert.deepEqual(h.prepare({ sender: h.trusted, senderFrame: {} }), unavailable);
  assert.equal(h.capture.pendingOrder(), null);
  assert.deepEqual(h.prepare(), { ok: true });
  assert.equal(typeof h.capture.pendingOrder(), 'bigint');
  assert.deepEqual(await h.request({ frame: {} }), {});
  assert.equal(h.capture.pendingOrder(), null);
  h.prepare();
  assert.deepEqual(await h.request(), { video: { id: 'screen:0:0' }, audio: 'loopbackWithMute' });
  assert.deepEqual(await h.request(), {});
});

test('An unused System Audio reservation expires', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  const h = harness(t);
  h.prepare();
  t.mock.timers.tick(10001);
  assert.equal(h.capture.pendingOrder(), null);
  assert.deepEqual(await h.request(), {});
});

test('System Audio grants nothing when no screen source is available', async t => {
  t.mock.method(console, 'error', () => {});
  for (const getSources of [async () => [], async () => { throw new Error('denied'); }]) {
    const h = harness(t, getSources);
    h.prepare();
    assert.deepEqual(await h.request(), {});
  }
  assert.equal(console.error.mock.callCount(), 1);
});

test('Disposing System Audio removes its IPC listener and refuses later requests', async t => {
  const h = harness(t);
  h.prepare();
  h.capture.dispose();
  assert.equal(h.ipcMain.listenerCount('system-audio:prepare-capture'), 0);
  assert.equal(h.capture.pendingOrder(), null);
  assert.deepEqual(await h.request(), {});
});
