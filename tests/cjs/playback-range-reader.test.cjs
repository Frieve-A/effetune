const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const fileAccess = require('../../electron/file-access.cjs');
const { registerPlaybackRangeReader, MAX_RANGE_BYTES } = require('../../electron/playback-range-reader.cjs');

test('playback range sessions enforce grants, bounded reads, ownership and release', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dsd-range-')));
  const file = path.join(root, 'track.dsf');
  const handlers = new Map();
  const sender = new EventEmitter();
  const event = { sender };
  registerPlaybackRangeReader({ fileIpc: { handle: (name, action) => handlers.set(name, action) },
    assertFile: value => fileAccess.assertPath(value, 'read') });
  const call = (name, ...args) => handlers.get(name)(event, ...args);
  let session;
  try {
    const handle = await fs.open(file, 'w');
    await handle.truncate(3 * 1024 * 1024 * 1024);
    await handle.write(new Uint8Array([11, 22, 33]), 0, 3, 2 ** 31 + 5);
    await handle.close();
    await assert.rejects(call('open-playback-range', file));
    fileAccess.grantRead(file);
    session = await call('open-playback-range', file);
    assert.equal(session.size, 3 * 1024 * 1024 * 1024);
    assert.deepEqual(await call('read-playback-range', session.token, 2 ** 31 + 5, 3), new Uint8Array([11, 22, 33]));
    await assert.rejects(call('read-playback-range', session.token, 0, MAX_RANGE_BYTES + 1));
    await assert.rejects(handlers.get('read-playback-range')({ sender: {} }, session.token, 0, 1));
    await assert.rejects(call('read-playback-range', session.token, session.size, 1));
    await call('close-playback-range', session.token);
    await assert.rejects(call('read-playback-range', session.token, 0, 1));
    const opening = call('open-playback-range', file);
    sender.emit('did-start-navigation', {}, 'file:///next.html', false, true);
    await assert.rejects(opening, /Playback source changed/);
    const concurrent = await Promise.allSettled(Array.from({ length: 9 }, () => call('open-playback-range', file)));
    assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 8);
    await Promise.all(concurrent.filter(result => result.status === 'fulfilled')
      .map(result => call('close-playback-range', result.value.token)));
    session = await call('open-playback-range', file);
    sender.emit('destroyed');
    await assert.rejects(call('read-playback-range', session.token, 0, 1));
  } finally {
    if (session) await call('close-playback-range', session.token);
    fileAccess.clear();
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
