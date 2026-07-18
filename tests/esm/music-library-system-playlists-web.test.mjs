import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  dispatchWebSqliteCommand,
  initializeWebSqliteRuntime
} from '../../js/library/repository/web-sqlite-runtime.js';

const RECENTLY_PLAYED_ID = 'system_recently_played';
const FAVORITES_ID = 'system_favorites';

function dispatch(type, payload = {}) {
  return dispatchWebSqliteCommand(type, payload);
}

function playlistTrackUids(playlistId) {
  const page = dispatch('queryPlaylistItems', { playlistId, afterPosition: 0, limit: 500 });
  return { playlist: page.playlist, trackUids: page.items.map(item => item.trackUid) };
}

test('Web system playlists match the Electron lazy, bounded, and resurrection contract', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-system-playlists-'));
  const database = new DatabaseSync(path.join(directory, 'catalog.sqlite'));
  let runtimeOpen = false;
  t.after(() => {
    if (runtimeOpen) dispatch('close');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await initializeWebSqliteRuntime(database, {
    storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
  });
  runtimeOpen = true;

  dispatch('upsertFolders', { folders: [{
    id: 'folder-music',
    kind: 'web-fsa',
    displayName: 'Music',
    path: '/fsa/music',
    status: 'ok',
    scanGeneration: 0,
    lifecycleVersion: 1,
    addedAt: 1,
    lastScanAt: null
  }] });
  dispatch('upsertTracks', {
    tracks: Array.from({ length: 101 }, (_, offset) => {
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
    })
  });

  assert.deepEqual(dispatch('getSystemPlaylists'), []);
  assert.deepEqual(dispatch('getFavoriteTrackUids'), { trackUids: [], truncated: false });
  assert.deepEqual(dispatch('recordRecentlyPlayed', { trackUid: 'missing' }), { kind: 'noop' });
  assert.deepEqual(dispatch('setTrackFavorite', { trackUid: 'missing', favorite: true }), { kind: 'noop' });
  assert.deepEqual(dispatch('setTrackFavorite', { trackUid: 'track-001', favorite: false }), { kind: 'noop' });

  assert.deepEqual(dispatch('createPlaylist', {
    playlistId: 'system_custom', name: 'Reserved', operationId: null, createdAt: 1
  }), { kind: 'systemPlaylist', playlistId: 'system_custom' });
  assert.deepEqual(dispatch('createPlaylistWithItems', {
    playlistId: FAVORITES_ID,
    name: 'Reserved',
    operationId: null,
    items: [{ trackUid: 'track-001' }],
    createdAt: 1
  }), { kind: 'systemPlaylist', playlistId: FAVORITES_ID });
  assert.deepEqual(dispatch('renamePlaylist', {
    playlistId: RECENTLY_PLAYED_ID, name: 'Renamed', expectedVersion: 0, updatedAt: 1
  }), { kind: 'systemPlaylist', playlistId: RECENTLY_PLAYED_ID });

  for (let index = 1; index <= 101; index += 1) {
    const trackUid = `track-${String(index).padStart(3, '0')}`;
    assert.equal(dispatch('recordRecentlyPlayed', { trackUid }).kind, 'recorded');
  }
  let recent = playlistTrackUids(RECENTLY_PLAYED_ID);
  assert.equal(recent.trackUids.length, 100);
  assert.equal(recent.trackUids[0], 'track-101');
  assert.equal(recent.trackUids.at(-1), 'track-002');
  assert.equal(new Set(recent.trackUids).size, 100);
  const version = recent.playlist.version;
  assert.deepEqual(dispatch('recordRecentlyPlayed', { trackUid: 'track-101' }), { kind: 'noop' });
  assert.equal(playlistTrackUids(RECENTLY_PLAYED_ID).playlist.version, version);
  dispatch('recordRecentlyPlayed', { trackUid: 'track-050' });
  recent = playlistTrackUids(RECENTLY_PLAYED_ID);
  assert.equal(recent.trackUids[0], 'track-050');
  assert.equal(recent.trackUids.length, 100);

  assert.equal(dispatch('setTrackFavorite', { trackUid: 'track-001', favorite: true }).kind, 'favorited');
  assert.deepEqual(dispatch('setTrackFavorite', { trackUid: 'track-001', favorite: true }), { kind: 'noop' });
  assert.equal(dispatch('setTrackFavorite', { trackUid: 'track-002', favorite: true }).kind, 'favorited');
  assert.deepEqual(dispatch('getFavoriteTrackUids'), {
    trackUids: ['track-001', 'track-002'], truncated: false
  });
  assert.equal(dispatch('setTrackFavorite', { trackUid: 'track-001', favorite: false }).kind, 'unfavorited');
  assert.deepEqual(dispatch('getFavoriteTrackUids'), { trackUids: ['track-002'], truncated: false });

  dispatch('createPlaylist', {
    playlistId: 'regular', name: 'Regular', operationId: null, createdAt: 2
  });
  const playlistPage = dispatch('queryEntities', {
    type: 'playlist', query: '', sort: 'name', direction: 'asc', scope: null, limit: 50
  });
  assert.deepEqual(playlistPage.rows.map(row => row.id), ['regular']);
  const collectionPage = dispatch('queryEntities', {
    type: 'playlist', query: '', sort: 'name', direction: 'asc', scope: null,
    includeSystemPlaylists: true, limit: 50
  });
  assert.deepEqual(collectionPage.rows.map(row => row.id), [
    FAVORITES_ID, RECENTLY_PLAYED_ID, 'regular'
  ]);
  assert.equal(dispatch('getCounts').playlists, 3);
  assert.deepEqual(dispatch('getSystemPlaylists').map(row => row.itemCount), [100, 1]);

  const favorite = playlistTrackUids(FAVORITES_ID);
  dispatch('tombstonePlaylist', {
    playlistId: FAVORITES_ID,
    expectedVersion: favorite.playlist.version,
    updatedAt: Date.now()
  });
  assert.deepEqual(dispatch('getFavoriteTrackUids'), { trackUids: [], truncated: false });
  dispatch('setTrackFavorite', { trackUid: 'track-003', favorite: true });
  assert.deepEqual(dispatch('getFavoriteTrackUids'), { trackUids: ['track-003'], truncated: false });

  recent = playlistTrackUids(RECENTLY_PLAYED_ID);
  dispatch('tombstonePlaylist', {
    playlistId: RECENTLY_PLAYED_ID,
    expectedVersion: recent.playlist.version,
    updatedAt: Date.now()
  });
  dispatch('recordRecentlyPlayed', { trackUid: 'track-001' });
  assert.deepEqual(playlistTrackUids(RECENTLY_PLAYED_ID).trackUids, ['track-001']);
  assert.deepEqual(dispatch('getSystemPlaylists').map(row => row.itemCount), [1, 1]);
});

test('Web favorite track UIDs use stable keyset pages', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-web-favorite-pages-'));
  const database = new DatabaseSync(path.join(directory, 'catalog.sqlite'));
  let runtimeOpen = false;
  t.after(() => {
    if (runtimeOpen) dispatch('close');
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await initializeWebSqliteRuntime(database, {
    storageManager: { async estimate() { return { quota: 1024 * 1024 * 1024, usage: 0 }; } }
  });
  runtimeOpen = true;
  dispatch('upsertFolders', { folders: [{
    id: 'folder-music', kind: 'web-fsa', displayName: 'Music', path: '/fsa/music',
    status: 'ok', scanGeneration: 0, lifecycleVersion: 1, addedAt: 1, lastScanAt: null
  }] });
  dispatch('upsertTracks', {
    tracks: Array.from({ length: 3 }, (_, offset) => {
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
    })
  });
  for (const trackUid of ['track-001', 'track-002', 'track-003']) {
    dispatch('setTrackFavorite', { trackUid, favorite: true });
  }

  const first = dispatch('getFavoriteTrackUids', { limit: 1 });
  assert.deepEqual(first.trackUids, ['track-001']);
  assert.equal(first.truncated, true);
  assert.deepEqual(Object.keys(first.nextCursor).sort(), ['itemKey', 'position']);

  dispatch('setTrackFavorite', { trackUid: 'track-001', favorite: false });
  const second = dispatch('getFavoriteTrackUids', { limit: 1, cursor: first.nextCursor });
  assert.deepEqual(second.trackUids, ['track-002']);
  assert.equal(second.truncated, true);

  assert.deepEqual(
    dispatch('getFavoriteTrackUids', { limit: 1, cursor: second.nextCursor }),
    { trackUids: ['track-003'], truncated: false }
  );
  assert.throws(
    () => dispatch('getFavoriteTrackUids', { limit: 1_501 }),
    error => error?.code === 'invalidRequestField'
  );
});
