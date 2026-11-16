const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createSystemAudioCapture } = require('../../electron/system-audio-capture.cjs');
const { createSystemAudioMuteKeeper } = require('../../electron/system-audio-mute-keeper.cjs');

function harness(t, getSources = async () => [{ id: 'screen:0:0' }], keeper) {
  const ipcMain = new EventEmitter();
  const trusted = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const keeperCalls = [];
  const muteKeeper = keeper || Object.fromEntries(['prepare', 'hold', 'release', 'reset', 'dispose']
    .map(name => [name, async () => { keeperCalls.push(name); }]));
  const capture = createSystemAudioCapture({ mainWindow: { webContents: trusted }, ipcMain, desktopCapturer: { getSources }, muteKeeper });
  t.after(() => capture.dispose());
  const trustedEvent = () => ({ sender: trusted, senderFrame: trusted.mainFrame });
  const send = (channel, event = trustedEvent()) => {
    ipcMain.emit(channel, event); return event.returnValue;
  };
  const prepare = event => send('system-audio:prepare-capture', event);
  const request = async (changes = {}) => {
    let streams;
    await capture.handleRequest({ frame: trusted.mainFrame, videoRequested: true, audioRequested: true, ...changes }, value => { streams = value; });
    return streams;
  };
  return { ipcMain, trusted, capture, keeperCalls, send, prepare, request };
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

test('Navigation and renderer loss clear unconsumed System Audio reservations', async t => {
  const h = harness(t);
  for (const event of ['did-navigate', 'render-process-gone']) {
    h.prepare();
    h.trusted.emit(event);
    assert.equal(h.capture.pendingOrder(), null);
    assert.deepEqual(await h.request(), {});
  }
});

test('Navigation during source lookup rejects the stale request without preparing a helper', async t => {
  let resolveSources;
  const sources = new Promise(resolve => { resolveSources = resolve; });
  let lookups = 0;
  const h = harness(t, () => ++lookups === 1 ? sources : [{ id: 'screen:new' }]);
  h.prepare();
  const replies = [];
  const pending = h.capture.handleRequest({ frame: h.trusted.mainFrame, videoRequested: true, audioRequested: true },
    value => replies.push(value));
  h.trusted.emit('did-navigate');
  h.prepare();
  assert.deepEqual(await h.request(), { video: { id: 'screen:new' }, audio: 'loopbackWithMute' });
  resolveSources([{ id: 'screen:old' }]);
  await pending;
  assert.deepEqual(replies, [{}]);
  assert.deepEqual(h.keeperCalls, ['reset', 'prepare']);
});

test('Navigation during mute preparation rejects the stale request and stops its helper', async t => {
  const helpers = [];
  const keeper = createSystemAudioMuteKeeper({ spawn: () => {
    const child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(), stdout: new PassThrough(), killed: false
    });
    child.kill = () => { child.killed = true; };
    helpers.push(child);
    return child;
  } });
  const h = harness(t, undefined, keeper);
  h.prepare();
  const replies = [];
  const pending = h.capture.handleRequest({ frame: h.trusted.mainFrame, videoRequested: true, audioRequested: true },
    value => replies.push(value));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(helpers.length, 1);
  h.trusted.emit('did-navigate');
  assert.equal(helpers[0].killed, true);
  await pending;
  assert.deepEqual(replies, [{}]);
  helpers[0].stdout.write('ready 0\n');
  assert.equal(helpers.length, 1);
  assert.deepEqual(replies, [{}]);
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

test('System Audio keeps the default output muted only for trusted live captures', async t => {
  const h = harness(t);
  h.prepare();
  assert.deepEqual(await h.request(), { video: { id: 'screen:0:0' }, audio: 'loopbackWithMute' });
  assert.deepEqual(h.keeperCalls, ['prepare']);
  assert.equal(h.send('system-audio:capture-started', { sender: {}, senderFrame: h.trusted.mainFrame }), null);
  h.send('system-audio:capture-started');
  h.send('system-audio:capture-stopped');
  h.trusted.emit('did-navigate');
  h.trusted.emit('render-process-gone');
  assert.deepEqual(h.keeperCalls, ['prepare', 'hold', 'release', 'reset', 'reset']);
});

test('Disposing System Audio removes its listeners and refuses later requests', async t => {
  const h = harness(t);
  h.prepare();
  h.capture.dispose();
  for (const channel of ['system-audio:prepare-capture', 'system-audio:capture-started', 'system-audio:capture-stopped']) {
    assert.equal(h.ipcMain.listenerCount(channel), 0);
  }
  assert.equal(h.trusted.listenerCount('did-navigate'), 0);
  assert.equal(h.capture.pendingOrder(), null);
  assert.deepEqual(await h.request(), {});
  assert.deepEqual(h.keeperCalls, ['dispose']);
});
