const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');
const { LibraryCatalogUtilityHost } = require('../../electron/library-catalog-utility-host.cjs');

test('large desktop sessions cross the utility and catalog boundaries atomically and remain profile-specific', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-session-catalog-')));
  const dbPath = path.join(directory, 'catalog.sqlite');
  let host = await LibraryCatalogHost.open({ dbPath });
  let utility;
  t.after(async () => {
    await utility?.close();
    await host.close();
    const { removeSqliteTestDirectory } = await import('../helpers/sqlite-test-utils.mjs');
    await removeSqliteTestDirectory(directory);
  });

  // Exercise the production utility message budget on both legs of each real SQLite request.
  const child = new EventEmitter();
  child.kill = () => {};
  child.postMessage = message => {
    const reply = data => child.emit('message', { protocolVersion: 1, ...data });
    if (message.type === 'initialize') return queueMicrotask(() => reply({ type: 'ready', ok: true, payload: {} }));
    const result = message.target === 'system' ? Promise.resolve(true) : host.request(...message.args);
    result.then(payload => reply({ type: 'response', requestId: message.requestId, ok: true, payload }),
      error => reply({ type: 'response', requestId: message.requestId, ok: false, error: { message: error.message } }));
  };
  utility = await LibraryCatalogUtilityHost.open({ dialog: { showOpenDialog() {} }, dbPath, processFactory: () => child });
  const send = (action, fields = {}, profileKey = '') => utility.repository.request('playbackSession', {
    action, profileKey, ...fields
  });
  const state = { kind: 'materialized', itemCount: 4096, currentOrdinal: 2020, position: 7, duration: 90 };
  const track = { path: path.join(directory, 'long-folder'.repeat(100), 'file.mid'), name: '曲'.repeat(160), byteLength: 88 };
  await send('begin', { state });
  for (let start = 0; start < state.itemCount; start += 128) {
    const rows = Array.from({ length: 128 }, (_, i) => ({ ordinal: start + i, originalOrdinal: 4095 - start - i, track }));
    await send('append', { rows });
  }
  assert.equal(await send('read'), null);
  await send('commit');
  await send('update', { state: { ...state, position: 22 } });
  await send('begin', { state: { ...state, itemCount: 2, currentOrdinal: 0 } });
  await send('append', { rows: [{ ordinal: 0, track }] });
  await host.close();
  host = await LibraryCatalogHost.open({ dbPath });
  const restored = await send('read');
  assert.equal(restored.restoredCount, 4096);
  assert.equal(restored.currentPreserved, true);
  assert.equal(restored.currentTrack.originalOrdinal, 4095 - 2020);
  assert.equal(restored.state.position, 22);
  let count = 0, startOrdinal = 0;
  do {
    const page = await send('page', { startOrdinal });
    assert.ok(Buffer.byteLength(JSON.stringify(page)) < 1024 * 1024);
    assert.ok(page.rows.every((row, i) => row.ordinal === count + i && row.track.byteLength === 88));
    count += page.rows.length;
    startOrdinal = page.nextOrdinal;
  } while (startOrdinal !== null);
  assert.equal(count, 4096);
  assert.equal(await send('read', {}, 'default'), null);
  await send('begin', { state }, 'default');
  await send('commit', {}, 'default');
  await send('delete');
  assert.equal(await send('read'), null);
  assert.equal((await send('read', {}, 'default')).restoredCount, 0);

  await host.upsertFolders([{ id: 'folder', kind: 'electron', displayName: 'Music', path: directory, status: 'ok' }]);
  await host.upsertTracks(['A', 'B'].map(uid => ({
    trackUid: uid, folderId: 'folder', relativePath: uid + '.mid', fileName: uid + '.mid', title: uid
  })));
  await host.createPlaybackSequence({ sequenceId: 'library', sourceContext: 'test', catalogVersion: 0, seed: 13, createdAt: 0 });
  await host.appendPlaybackSequenceItems({ sequenceId: 'library', items: [
    { ordinal: 0, entryInstanceId: 'one', trackUid: 'A' }, { ordinal: 1, entryInstanceId: 'two', trackUid: 'B' }
  ] });
  await host.sealPlaybackSequence({ sequenceId: 'library', itemCount: 2, currentOrdinal: 0, sealedAt: 1 });
  const mixed = { ...state, kind: 'catalog', itemCount: 5, currentOrdinal: 4 };
  await send('begin', { state: mixed });
  await send('copy', { sequenceId: 'library', sourceOrdinals: [0, 1], destinationOrdinals: [1, 0] });
  await send('append', { rows: [{ ordinal: 2, track }] });
  await send('copy', { ordinal: 3, sequenceId: 'library', startOrdinal: 0, itemCount: 2,
    shuffleSeed: 13, shuffleEpoch: 2, shuffleTransportOffset: 1 });
  await send('commit');
  const mixedResult = await send('read');
  assert.equal(mixedResult.currentTrack.libraryOrdinal, 3);
  const sequence = await host.queryPlaybackSequence({ sequenceId: mixedResult.catalogSequence.sequenceId, ordinal: 0, limit: 4 });
  assert.deepEqual(sequence.items.slice(0, 2).map(item => item.trackUid), ['B', 'A']);
  assert.deepEqual((await send('page', { startOrdinal: 0 })).rows, [
    { ordinal: 0, libraryOrdinal: 0, itemCount: 2 }, { ordinal: 2, originalOrdinal: null, track },
    { ordinal: 3, libraryOrdinal: 2, itemCount: 2 }
  ]);
  await host.removeScanFolder({ folderId: 'folder', expectedLifecycleVersion: 0 });
  const filesOnly = await send('read');
  assert.equal(filesOnly.state.kind, 'catalog');
  assert.equal(filesOnly.catalogSequence, null);
  assert.equal(filesOnly.currentPreserved, false);
  assert.equal(filesOnly.currentOrdinal, 0);
  assert.equal(filesOnly.currentTrack.track.path, track.path);
});
