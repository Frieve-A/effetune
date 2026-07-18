import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { PagedPlaylistService } from '../../js/library/playlists/paged-playlist-service.js';
import { RecentlyPlayedTracker } from '../../js/library/playlists/recently-played-tracker.js';
import {
  RECENTLY_PLAYED_LIMIT,
  SYSTEM_PLAYLIST_IDS,
  isSystemPlaylistId,
  systemPlaylistLabelKey
} from '../../js/library/playlists/system-playlists.js';

test('system playlist constants and service calls use the stable repository contract', async () => {
  const calls = [];
  const client = {
    async recordRecentlyPlayed(request) { calls.push(['recent', request]); return { kind: 'recorded' }; },
    async setTrackFavorite(request) { calls.push(['favorite', request]); return { kind: 'favorited' }; },
    async getFavoriteTrackUids(request) {
      calls.push(['favorite-uids', request]);
      return { trackUids: ['track-1'], truncated: false };
    },
    async getSystemPlaylists() { calls.push(['systems']); return []; }
  };
  const service = new PagedPlaylistService({
    client,
    requestIdFactory: () => 'request-id'
  });

  assert.deepEqual(await service.recordRecentlyPlayed('track-1'), { kind: 'recorded' });
  assert.deepEqual(await service.setTrackFavorite('track-1', true), { kind: 'favorited' });
  await service.setTrackFavorite('track-2', false);
  assert.deepEqual(await service.getFavoriteTrackUids(), { trackUids: ['track-1'], truncated: false });
  assert.deepEqual(await service.getSystemPlaylists(), []);
  assert.deepEqual(calls, [
    ['recent', { trackUid: 'track-1' }],
    ['favorite', { trackUid: 'track-1', favorite: true }],
    ['favorite', { trackUid: 'track-2', favorite: false }],
    ['favorite-uids', { limit: 1_500 }],
    ['systems']
  ]);

  assert.equal(SYSTEM_PLAYLIST_IDS.recentlyPlayed, 'system_recently_played');
  assert.equal(SYSTEM_PLAYLIST_IDS.favorites, 'system_favorites');
  assert.equal(RECENTLY_PLAYED_LIMIT, 100);
  assert.equal(isSystemPlaylistId('system_custom'), true);
  assert.equal(isSystemPlaylistId('regular'), false);
  assert.equal(
    systemPlaylistLabelKey(SYSTEM_PLAYLIST_IDS.recentlyPlayed),
    'library.playlist.system.recentlyPlayed'
  );
});

test('PagedPlaylistService collects every favorite UID page and rejects a stalled cursor', async () => {
  const calls = [];
  const pages = [
    {
      trackUids: ['track-1'],
      truncated: true,
      nextCursor: { position: 1024, itemKey: 1 }
    },
    {
      trackUids: ['track-2'],
      truncated: true,
      nextCursor: { position: 2048, itemKey: 2 }
    },
    { trackUids: ['track-3'], truncated: false }
  ];
  const service = new PagedPlaylistService({
    client: {
      async getFavoriteTrackUids(request) {
        calls.push(request);
        return pages.shift();
      }
    },
    requestIdFactory: () => 'request-id'
  });

  assert.deepEqual(await service.getFavoriteTrackUids(), {
    trackUids: ['track-1', 'track-2', 'track-3'],
    truncated: false
  });
  assert.deepEqual(calls, [
    { limit: 1_500 },
    { limit: 1_500, cursor: { position: 1024, itemKey: 1 } },
    { limit: 1_500, cursor: { position: 2048, itemKey: 2 } }
  ]);

  const stalled = new PagedPlaylistService({
    client: {
      async getFavoriteTrackUids() {
        return {
          trackUids: ['track-1'],
          truncated: true,
          nextCursor: { position: 1024, itemKey: 1 }
        };
      }
    },
    requestIdFactory: () => 'request-id'
  });
  await assert.rejects(stalled.getFavoriteTrackUids(), /cursor did not advance/);
});

function createStateManager() {
  const state = { currentTrack: null, isPlaying: false };
  const listeners = new Map();
  return {
    addListener(key, listener) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
    },
    removeListener(key, listener) {
      listeners.get(key)?.delete(listener);
    },
    getStateSnapshot() {
      return { ...state };
    },
    update(patch) {
      const changedKeys = Object.keys(patch).filter(key => state[key] !== patch[key]);
      Object.assign(state, patch);
      for (const key of changedKeys) {
        for (const listener of listeners.get(key) || []) listener(state[key], key, 'test');
      }
    }
  };
}

test('RecentlyPlayedTracker records playback transitions once and remains best effort', async () => {
  const stateManager = createStateManager();
  const calls = [];
  const errors = [];
  const tracker = new RecentlyPlayedTracker({
    stateManager,
    recordTrack(trackUid) {
      calls.push(trackUid);
      return trackUid === 'bad' ? Promise.reject(new Error('catalog busy')) : Promise.resolve();
    },
    logger: { error(...args) { errors.push(args); } }
  });

  stateManager.update({ currentTrack: { libraryTrackId: 'track-a', trackUid: 'fallback-a' } });
  assert.deepEqual(calls, []);
  stateManager.update({ isPlaying: true });
  stateManager.update({ currentTrack: { trackUid: 'track-a' } });
  stateManager.update({ currentTrack: { trackUid: 'track-b' } });
  stateManager.update({ currentTrack: { trackUid: 'track-a' } });
  assert.deepEqual(calls, ['track-a', 'track-b', 'track-a']);

  stateManager.update({ isPlaying: false });
  stateManager.update({ currentTrack: { trackUid: 'bad' } });
  stateManager.update({ isPlaying: true });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, ['track-a', 'track-b', 'track-a', 'bad']);
  assert.equal(errors.length, 1);

  tracker.destroy();
  stateManager.update({ currentTrack: { trackUid: 'track-after-destroy' } });
  assert.equal(calls.includes('track-after-destroy'), false);
});

test('Electron and Web expose every system-playlist transport hop', () => {
  const operations = [
    'recordRecentlyPlayed',
    'setTrackFavorite',
    'getFavoriteTrackUids',
    'getSystemPlaylists'
  ];
  const sources = [
    '../../electron/library-catalog-host.cjs',
    '../../electron/library-catalog-worker.cjs',
    '../../electron/preload.js',
    '../../js/library/repository/electron-catalog-client.js',
    '../../js/library/repository/web-catalog-client.js',
    '../../js/library/repository/web-catalog-repository.js',
    '../../js/library/repository/web-catalog-worker.js',
    '../../js/library/repository/web-sqlite-runtime.js',
    '../../js/library/library-manager-v2.js'
  ].map(relativePath => fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8'));

  for (const operation of operations) {
    for (const source of sources) assert.match(source, new RegExp(`\\b${operation}\\b`));
  }
});
