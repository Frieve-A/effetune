export const SYSTEM_PLAYLIST_IDS = Object.freeze({
  recentlyPlayed: 'system_recently_played',
  favorites: 'system_favorites'
});

export const SYSTEM_PLAYLIST_ORDER = Object.freeze([
  SYSTEM_PLAYLIST_IDS.recentlyPlayed,
  SYSTEM_PLAYLIST_IDS.favorites
]);

export const RECENTLY_PLAYED_LIMIT = 100;

export function isSystemPlaylistId(id) {
  return typeof id === 'string' && id.startsWith('system_');
}

export function systemPlaylistLabelKey(id) {
  if (id === SYSTEM_PLAYLIST_IDS.recentlyPlayed) {
    return 'library.playlist.system.recentlyPlayed';
  }
  if (id === SYSTEM_PLAYLIST_IDS.favorites) {
    return 'library.playlist.system.favorites';
  }
  return null;
}
