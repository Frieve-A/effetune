import assert from 'node:assert/strict';
import { addLoudnessBlock, encodeHistogram } from '../../js/library/loudness/histogram.js';

export async function verifyLoudnessCatalog(db, request, tagSnapshot) {
  const ids = ['a', 'b', 'c', 'silent'];
  const folder = { id: 'music', displayName: 'Music', kind: 'web-fsa', status: 'ok' };
  await request('upsertFolders', { folders: [folder] });
  await request('upsertTracks', { tracks: ids.map(trackUid => ({
    trackUid, folderId: folder.id, relativePath: trackUid + '.flac', title: trackUid, size: 100, mtimeMs: 20
  })) });
  db.exec(`INSERT INTO albums(album_key,identity_version,name,artist,sort_name,sort_artist,track_count)
    VALUES ('one',1,'One','Artist',X'',X'',2),('unknown',1,'Unknown Album','Artist',X'',X'',2);
    UPDATE tracks SET album_key = CASE WHEN track_uid IN ('a','b') THEN 'one' ELSE 'unknown' END`);

  const page = (afterTrackUid = '') => request('listPendingLoudness', { afterTrackUid, limit: 2 });
  assert.deepEqual((await page()).tracks.map(t => t.trackUid), ['a', 'b']);
  assert.deepEqual((await page('b')).tracks.map(t => t.trackUid), ['c', 'silent']);
  const row = (trackUid, integrated, truePeak) => {
    const bins = new Map();
    if (integrated !== null) addLoudnessBlock(bins, integrated);
    return { trackUid, size: 100, mtimeMs: 20.4, status: 'measured', integrated, truePeak,
      lra: 0, histogram: encodeHistogram(bins) };
  };
  const save = (...measurements) => request('saveTrackLoudness', { measurements });
  await assert.rejects(async () => save({ ...row('a', -20, -1), histogram: new Uint8Array([1, 2, 3]) }));
  await save(row('a', -20, -1), row('b', -30, -15), row('c', -10, -2), row('silent', null, null));
  assert.equal((await page()).totalCount, 0);
  const read = trackUid => request('getTrackLoudness', { trackUid });
  const stats = () => request('getLoudnessStats', { coverage: 60 });
  const finalize = () => request('finalizeLoudness', {});
  assert.equal(await read('silent'), null);
  async function assertStale(trackPlr) {
    assert.equal((await read('a')).albumIntegrated, null);
    const s = await stats();
    assert.equal(s.albumPlr, s.trackPlr);
    if (trackPlr !== undefined) assert.equal(s.trackPlr, trackPlr);
    if (tagSnapshot) {
      const tracks = (await tagSnapshot()).tracks;
      assert.equal(tracks.find(t => t.trackUid === 'a').albumIntegrated, null);
      assert.ok(tracks.every(t => t.trackUid !== 'silent'));
    }
  }
  await assertStale(15);
  await finalize();
  let album = await read('a');
  assert.equal(album.integrated, -20);
  assert.equal(album.albumTruePeak, -1);
  assert.ok(Math.abs(album.albumIntegrated - 10 * Math.log10((.01 + .001) / 2)) < 1e-9);
  assert.equal((await read('c')).albumIntegrated, null);
  assert.equal((await stats()).albumPlr, -1 - album.albumIntegrated);

  db.exec("UPDATE tracks SET size = 120 WHERE track_uid = 'b'");
  assert.equal(await read('b'), null);
  assert.deepEqual((await page()).tracks.map(t => t.trackUid), ['b']);
  await save({ ...row('b', -10, -7), size: 120 });
  await assertStale(8);
  await finalize();
  assert.notEqual((await read('a')).albumIntegrated, album.albumIntegrated);

  db.exec("UPDATE tracks SET album_key = 'unknown' WHERE track_uid = 'b'");
  await assertStale();
  await finalize();
  album = await read('a');
  assert.equal(album.albumIntegrated, -20);
  db.exec("UPDATE tracks SET album_key = 'one' WHERE track_uid = 'b'");
  await finalize();
  db.exec("DELETE FROM tracks WHERE track_uid = 'b'");
  await assertStale();
  await finalize();
  assert.equal((await read('a')).albumIntegrated, -20);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM track_loudness WHERE track_uid = 'b'").get().n, 0);
  if (tagSnapshot) {
    // Tag replacement changes only the file signature. The album survives the subsequent scan.
    assert.deepEqual(await request('updateLoudnessTagSignatures',
      { rows: [{ trackUid: 'a', size: 100, mtimeMs: 20, newSize: 119, newMtimeMs: 25.8 }] }), { updated: 1 });
    assert.deepEqual({ ...db.prepare("SELECT size, mtime_ms FROM tracks WHERE track_uid = 'a'").get() },
      { size: 119, mtime_ms: 26 });
    assert.equal((await read('a')).albumIntegrated, -20);
    assert.equal((await page()).totalCount, 0);
    db.exec("UPDATE tracks SET size = 300 WHERE track_uid = 'a'");
    assert.deepEqual(await request('updateLoudnessTagSignatures',
      { rows: [{ trackUid: 'a', size: 119, mtimeMs: 26, newSize: 150, newMtimeMs: 29 }] }), { updated: 0 });
    assert.equal(await read('a'), null);
    assert.deepEqual((await page()).tracks.map(track => track.trackUid), ['a']);
  }
}
