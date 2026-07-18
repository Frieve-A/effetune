'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');

const RECENTLY_PLAYED_ID = 'system_recently_played';
const FAVORITES_ID = 'system_favorites';

async function openCatalog(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-system-playlists-'));
  const host = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
  t.after(async () => {
    await host.close().catch(() => {});
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { directory, host };
}

async function seedTracks(host, directory, count) {
  await host.upsertFolders([{
    id: 'folder-music',
    kind: 'electron',
    displayName: 'Music',
    path: directory,
    status: 'ok',
    lifecycleVersion: 1
  }]);
  await host.upsertTracks(Array.from({ length: count }, (_, offset) => {
    const index = offset + 1;
    return {
      trackUid: `track-${String(index).padStart(3, '0')}`,
      folderId: 'folder-music',
      relativePath: `Track-${index}.flac`,
      fileName: `Track-${index}.flac`,
      title: `Track ${index}`,
      artist: 'Artist',
      addedAt: index,
      updatedAt: index
    };
  }));
}

async function playlistTrackUids(host, playlistId) {
  const page = await host.queryPlaylistItems({ playlistId, afterPosition: 0, limit: 500 });
  return { playlist: page.playlist, trackUids: page.items.map(item => item.trackUid) };
}

test('Electron system playlists are lazy, bounded, idempotent, and available to playlist collections', async t => {
  const { directory, host } = await openCatalog(t);
  await seedTracks(host, directory, 101);

  assert.deepEqual(await host.getSystemPlaylists(), []);
  assert.deepEqual(await host.getFavoriteTrackUids(), { trackUids: [], truncated: false });
  assert.deepEqual(await host.recordRecentlyPlayed({ trackUid: 'missing' }), { kind: 'noop' });
  assert.deepEqual(await host.setTrackFavorite({ trackUid: 'missing', favorite: true }), { kind: 'noop' });
  assert.deepEqual(await host.setTrackFavorite({ trackUid: 'track-001', favorite: false }), { kind: 'noop' });
  assert.deepEqual(await host.getSystemPlaylists(), []);

  assert.deepEqual(await host.createPlaylist({
    playlistId: 'system_custom', name: 'Reserved', operationId: null, createdAt: 1
  }), { kind: 'systemPlaylist', playlistId: 'system_custom' });
  assert.deepEqual(await host.createPlaylistWithItems({
    playlistId: FAVORITES_ID,
    name: 'Reserved',
    operationId: null,
    items: [{ trackUid: 'track-001' }],
    createdAt: 1
  }), { kind: 'systemPlaylist', playlistId: FAVORITES_ID });
  assert.deepEqual(await host.renamePlaylist({
    playlistId: RECENTLY_PLAYED_ID, name: 'Renamed', expectedVersion: 0, updatedAt: 1
  }), { kind: 'systemPlaylist', playlistId: RECENTLY_PLAYED_ID });

  for (let index = 1; index <= 101; index += 1) {
    const trackUid = `track-${String(index).padStart(3, '0')}`;
    assert.equal((await host.recordRecentlyPlayed({ trackUid })).kind, 'recorded');
  }
  let recent = await playlistTrackUids(host, RECENTLY_PLAYED_ID);
  assert.equal(recent.trackUids.length, 100);
  assert.equal(recent.trackUids[0], 'track-101');
  assert.equal(recent.trackUids.at(-1), 'track-002');
  assert.equal(new Set(recent.trackUids).size, 100);

  const recentVersion = recent.playlist.version;
  assert.deepEqual(await host.recordRecentlyPlayed({ trackUid: 'track-101' }), { kind: 'noop' });
  assert.equal((await playlistTrackUids(host, RECENTLY_PLAYED_ID)).playlist.version, recentVersion);
  await host.recordRecentlyPlayed({ trackUid: 'track-050' });
  recent = await playlistTrackUids(host, RECENTLY_PLAYED_ID);
  assert.equal(recent.trackUids[0], 'track-050');
  assert.equal(recent.trackUids.length, 100);
  assert.equal(new Set(recent.trackUids).size, 100);

  assert.equal((await host.setTrackFavorite({ trackUid: 'track-001', favorite: true })).kind, 'favorited');
  assert.deepEqual(await host.setTrackFavorite({ trackUid: 'track-001', favorite: true }), { kind: 'noop' });
  assert.equal((await host.setTrackFavorite({ trackUid: 'track-002', favorite: true })).kind, 'favorited');
  assert.deepEqual(await host.getFavoriteTrackUids(), {
    trackUids: ['track-001', 'track-002'], truncated: false
  });
  assert.equal((await host.setTrackFavorite({ trackUid: 'track-001', favorite: false })).kind, 'unfavorited');
  assert.deepEqual(await host.setTrackFavorite({ trackUid: 'track-001', favorite: false }), { kind: 'noop' });
  assert.deepEqual(await host.getFavoriteTrackUids(), { trackUids: ['track-002'], truncated: false });

  await host.createPlaylist({
    playlistId: 'regular', name: 'Regular', operationId: null, createdAt: 2
  });
  const playlistPage = await host.queryEntities({
    type: 'playlist', query: '', sort: 'name', direction: 'asc', scope: null, limit: 50
  });
  assert.deepEqual(playlistPage.rows.map(row => row.id), ['regular']);
  const collectionPage = await host.queryEntities({
    type: 'playlist', query: '', sort: 'name', direction: 'asc', scope: null,
    includeSystemPlaylists: true, limit: 50
  });
  assert.deepEqual(collectionPage.rows.map(row => row.id), [
    FAVORITES_ID, RECENTLY_PLAYED_ID, 'regular'
  ]);
  assert.equal((await host.getCounts()).playlists, 3);

  let systems = await host.getSystemPlaylists();
  assert.deepEqual(systems.map(playlist => playlist.playlistId), [RECENTLY_PLAYED_ID, FAVORITES_ID]);
  assert.deepEqual(systems.map(playlist => playlist.name), ['Recently Played', 'Favorites']);
  assert.deepEqual(systems.map(playlist => playlist.itemCount), [100, 1]);

  const favorite = await playlistTrackUids(host, FAVORITES_ID);
  await host.tombstonePlaylist({
    playlistId: FAVORITES_ID,
    expectedVersion: favorite.playlist.version,
    updatedAt: Date.now()
  });
  assert.deepEqual(await host.getFavoriteTrackUids(), { trackUids: [], truncated: false });
  assert.deepEqual((await host.getSystemPlaylists()).map(row => row.playlistId), [RECENTLY_PLAYED_ID]);
  await host.setTrackFavorite({ trackUid: 'track-003', favorite: true });
  assert.deepEqual(await host.getFavoriteTrackUids(), { trackUids: ['track-003'], truncated: false });

  recent = await playlistTrackUids(host, RECENTLY_PLAYED_ID);
  await host.tombstonePlaylist({
    playlistId: RECENTLY_PLAYED_ID,
    expectedVersion: recent.playlist.version,
    updatedAt: Date.now()
  });
  await host.recordRecentlyPlayed({ trackUid: 'track-001' });
  assert.deepEqual((await playlistTrackUids(host, RECENTLY_PLAYED_ID)).trackUids, ['track-001']);
  systems = await host.getSystemPlaylists();
  assert.deepEqual(systems.map(playlist => playlist.itemCount), [1, 1]);
});

test('Electron favorite track UIDs use stable keyset pages', async t => {
  const { directory, host } = await openCatalog(t);
  await seedTracks(host, directory, 3);
  for (const trackUid of ['track-001', 'track-002', 'track-003']) {
    await host.setTrackFavorite({ trackUid, favorite: true });
  }

  const first = await host.getFavoriteTrackUids({ limit: 1 });
  assert.deepEqual(first.trackUids, ['track-001']);
  assert.equal(first.truncated, true);
  assert.deepEqual(Object.keys(first.nextCursor).sort(), ['itemKey', 'position']);

  await host.setTrackFavorite({ trackUid: 'track-001', favorite: false });
  const second = await host.getFavoriteTrackUids({ limit: 1, cursor: first.nextCursor });
  assert.deepEqual(second.trackUids, ['track-002']);
  assert.equal(second.truncated, true);

  const third = await host.getFavoriteTrackUids({ limit: 1, cursor: second.nextCursor });
  assert.deepEqual(third, { trackUids: ['track-003'], truncated: false });
  await assert.rejects(
    host.getFavoriteTrackUids({ limit: 1_501 }),
    error => error?.code === 'invalidRequestField'
  );
});
