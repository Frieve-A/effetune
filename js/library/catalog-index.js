import { createFallbackDisplayName, UNKNOWN_ALBUM, UNKNOWN_ARTIST, VARIOUS_ARTISTS } from './constants.js';
import { includesAllTokens, normalizeSearchText, tokenizeSearchQuery } from './search-normalizer.js';

const EMPTY_COUNTS = Object.freeze({
  tracks: 0,
  albums: 0,
  artists: 0,
  genres: 0
});
const DISPLAY_ARTIST_KEY_PREFIX = 'display-artist\u0000';

export class CatalogIndex {
  constructor({ locale = undefined } = {}) {
    this.locale = locale;
    this.collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    this.tracks = [];
    this.trackById = new Map();
    this.folders = [];
    this.folderById = new Map();
    this.albums = new Map();
    this.artists = new Map();
    this.genres = new Map();
    this.folderTracks = new Map();
    this.lastSearch = { query: '', ids: null };
  }

  async build({ tracks = [], folders = [] } = {}) {
    this.folders = [...folders];
    this.folderById = new Map(this.folders.map(folder => [folder.id, folder]));
    this.tracks = tracks.map(track => this.prepareTrack(track));
    this.trackById = new Map(this.tracks.map(track => [track.id, track]));
    this.rebuildAggregates();
    return this;
  }

  setFolders(folders = []) {
    this.folders = [...folders];
    this.folderById = new Map(this.folders.map(folder => [folder.id, folder]));
    this.rebuildAggregates();
  }

  applyChanges({ upsert = [], removedIds = [], folders = null } = {}) {
    const hasRemovals = removedIds.length > 0;
    const hasFolderChanges = Boolean(folders);
    const hasUpdates = upsert.some(track => track?.id && this.trackById.has(track.id));

    if (!hasRemovals && !hasFolderChanges && !hasUpdates) {
      for (const track of upsert) {
        if (!track?.id) continue;
        const prepared = this.prepareTrack(track);
        this.trackById.set(prepared.id, prepared);
        this.tracks.push(prepared);
        this.addPreparedTrack(prepared);
      }
      this.lastSearch = { query: '', ids: null };
      return;
    }

    for (const id of removedIds) {
      this.trackById.delete(id);
    }
    for (const track of upsert) {
      this.trackById.set(track.id, this.prepareTrack(track));
    }
    if (folders) {
      this.folders = [...folders];
      this.folderById = new Map(this.folders.map(folder => [folder.id, folder]));
    }
    this.tracks = [...this.trackById.values()];
    this.rebuildAggregates();
    this.lastSearch = { query: '', ids: null };
  }

  getCounts() {
    if (this.tracks.length === 0) return EMPTY_COUNTS;
    return {
      tracks: this.tracks.length,
      albums: this.albums.size,
      artists: this.artists.size,
      genres: this.genres.size
    };
  }

  getTrackById(id) {
    return this.trackById.get(id) || null;
  }

  getTracksByIds(ids = []) {
    return ids.map(id => this.getTrackById(id)).filter(Boolean);
  }

  getAllTracks({ sort = 'artist', direction = 'asc', ids = null } = {}) {
    const source = ids ? ids.map(id => this.trackById.get(id)).filter(Boolean) : [...this.tracks];
    return this.sortTracks(source, sort, direction);
  }

  getRecentlyAdded(limit = 500) {
    return [...this.tracks]
      .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0))
      .slice(0, limit);
  }

  search(query, { limit = Infinity } = {}) {
    const tokens = tokenizeSearchQuery(query);
    if (tokens.length === 0) {
      this.lastSearch = { query: '', ids: null };
      return { query: '', trackIds: [], tracks: [], albums: [], artists: [], playlists: [] };
    }

    const normalized = normalizeSearchText(query);
    const sourceTracks = this.lastSearch.ids && normalized.startsWith(this.lastSearch.query)
      ? this.lastSearch.ids.map(id => this.trackById.get(id)).filter(Boolean)
      : this.tracks;
    const tracks = [];
    for (const track of sourceTracks) {
      if (includesAllTokens(track.searchBlob, tokens)) {
        tracks.push(track);
        if (tracks.length >= limit) break;
      }
    }
    const trackIds = tracks.map(track => track.id);
    this.lastSearch = { query: normalized, ids: trackIds };
    const trackIdSet = new Set(trackIds);
    return {
      query: normalized,
      trackIds,
      tracks,
      albums: this.getAlbums().filter(album => album.trackIds.some(id => trackIdSet.has(id))).slice(0, 20),
      artists: this.getArtists().filter(artist => artist.trackIds.some(id => trackIdSet.has(id))).slice(0, 20),
      playlists: []
    };
  }

  getAlbums({ sort = 'artist' } = {}) {
    const albums = [...this.albums.values()];
    albums.sort((a, b) => {
      if (sort === 'year') return (b.year || 0) - (a.year || 0) || this.collator.compare(a.name, b.name);
      if (sort === 'recent') return (b.addedAt || 0) - (a.addedAt || 0);
      if (sort === 'title') return this.collator.compare(a.name, b.name);
      return this.collator.compare(a.artist, b.artist) || this.collator.compare(a.name, b.name);
    });
    return albums;
  }

  getAlbumTracks(albumKey) {
    const album = this.albums.get(albumKey);
    return album ? this.sortTracks(this.getTracksByIds(album.trackIds), 'album') : [];
  }

  getArtists() {
    const artists = [...this.artists.values()];
    artists.sort((a, b) => this.collator.compare(a.name, b.name));
    return artists;
  }

  getArtistTracks(artistKey) {
    const artist = this.artists.get(artistKey);
    if (artist) return this.sortTracks(this.getTracksByIds(artist.trackIds), 'album');
    if (this.isDisplayArtistKey(artistKey)) {
      return this.sortTracks(this.tracks.filter(track => track.artistDisplayKey === artistKey), 'album');
    }
    return [];
  }

  getGenres() {
    const genres = [...this.genres.values()];
    genres.sort((a, b) => this.collator.compare(a.name, b.name));
    return genres;
  }

  getGenreTracks(genreKey) {
    const genre = this.genres.get(genreKey);
    return genre ? this.sortTracks(this.getTracksByIds(genre.trackIds), 'artist') : [];
  }

  getFolders() {
    return this.folders.map(folder => ({
      ...folder,
      trackCount: this.folderTracks.get(folder.id)?.length || 0
    }));
  }

  getFolderTracks(folderId) {
    const ids = this.folderTracks.get(folderId) || [];
    return this.sortTracks(this.getTracksByIds(ids), 'path');
  }

  findByAbsolutePath(absPath) {
    const normalized = normalizeSearchText(String(absPath || '').replace(/\\/g, '/'));
    if (!normalized) return null;
    for (const track of this.tracks) {
      const folder = this.folderById.get(track.folderId);
      if (!folder?.path) continue;
      const full = `${folder.path.replace(/\\/g, '/')}/${track.relativePath}`;
      if (normalizeSearchText(full) === normalized) return track;
    }
    return null;
  }

  prepareTrack(track) {
    const title = track.title || createFallbackDisplayName(track.fileName || track.relativePath);
    const artist = track.artist || '';
    const albumArtist = track.albumArtist || artist || '';
    const album = track.album || '';
    const genre = track.genre || '';
    const searchBlob = normalizeSearchText([
      title,
      artist,
      albumArtist,
      album,
      genre,
      track.fileName,
      track.relativePath
    ].filter(Boolean).join('\n'));
    const prepared = {
      ...track,
      title,
      artist,
      albumArtist,
      album,
      genre,
      searchBlob
    };
    prepared.albumKey = track.albumKey || this.createAlbumKey(prepared);
    prepared.artistKey = normalizeSearchText(prepared.albumArtist || artist || UNKNOWN_ARTIST);
    prepared.artistDisplayKey = this.createDisplayArtistKey(prepared);
    prepared.genreKey = genre ? normalizeSearchText(genre) : '';
    return prepared;
  }

  rebuildAggregates() {
    this.albums = new Map();
    this.artists = new Map();
    this.genres = new Map();
    this.folderTracks = new Map();
    for (const track of this.tracks) {
      this.addPreparedTrack(track);
    }
  }

  addPreparedTrack(track) {
    this.addToAlbum(track);
    this.addToArtist(track);
    this.addToGenre(track);
    const folderTracks = this.folderTracks.get(track.folderId) || [];
    folderTracks.push(track.id);
    this.folderTracks.set(track.folderId, folderTracks);
  }

  addToAlbum(track) {
    const key = track.albumKey || this.createAlbumKey(track);
    const artist = track.compilation ? VARIOUS_ARTISTS : (track.albumArtist || track.artist || UNKNOWN_ARTIST);
    const name = track.album || UNKNOWN_ALBUM;
    const album = this.albums.get(key) || {
      key,
      name,
      artist,
      year: track.year || null,
      artworkId: track.artworkId || null,
      trackIds: [],
      durationSec: 0,
      addedAt: track.addedAt || 0
    };
    album.trackIds.push(track.id);
    album.durationSec += Number(track.durationSec) || 0;
    album.year = album.year || track.year || null;
    album.artworkId = album.artworkId || track.artworkId || null;
    album.addedAt = Math.max(album.addedAt || 0, track.addedAt || 0);
    this.albums.set(key, album);
  }

  addToArtist(track) {
    const key = track.artistKey || normalizeSearchText(track.albumArtist || track.artist || UNKNOWN_ARTIST);
    const name = track.albumArtist || track.artist || UNKNOWN_ARTIST;
    const artist = this.artists.get(key) || {
      key,
      name,
      albumKeys: new Set(),
      trackIds: [],
      artworkId: track.artworkId || null
    };
    artist.trackIds.push(track.id);
    artist.albumKeys.add(track.albumKey);
    artist.artworkId = artist.artworkId || track.artworkId || null;
    this.artists.set(key, artist);
  }

  addToGenre(track) {
    if (!track.genreKey) return;
    const genre = this.genres.get(track.genreKey) || {
      key: track.genreKey,
      name: track.genre || 'Unknown Genre',
      trackIds: []
    };
    genre.trackIds.push(track.id);
    this.genres.set(track.genreKey, genre);
  }

  createAlbumKey(track) {
    const artist = track.compilation ? VARIOUS_ARTISTS : (track.albumArtist || track.artist || UNKNOWN_ARTIST);
    return `${normalizeSearchText(artist)}\u0000${normalizeSearchText(track.album || UNKNOWN_ALBUM)}`;
  }

  createDisplayArtistKey(track) {
    return `${DISPLAY_ARTIST_KEY_PREFIX}${normalizeSearchText(track.artist || track.albumArtist || UNKNOWN_ARTIST)}`;
  }

  isDisplayArtistKey(key) {
    return String(key || '').startsWith(DISPLAY_ARTIST_KEY_PREFIX);
  }

  sortTracks(tracks, sort = 'artist', direction = 'asc') {
    const sign = direction === 'desc' ? -1 : 1;
    const output = [...tracks];
    output.sort((a, b) => sign * this.compareTracks(a, b, sort));
    return output;
  }

  compareTracks(a, b, sort) {
    if (sort === 'title') return this.collator.compare(a.title, b.title);
    if (sort === 'added') return (b.addedAt || 0) - (a.addedAt || 0);
    if (sort === 'duration') return (a.durationSec || 0) - (b.durationSec || 0);
    if (sort === 'path') return this.collator.compare(a.relativePath || '', b.relativePath || '');
    if (sort === 'album') {
      return this.collator.compare(a.album || '', b.album || '') ||
        ((a.discNo || 0) - (b.discNo || 0)) ||
        ((a.trackNo || 0) - (b.trackNo || 0)) ||
        this.collator.compare(a.title || '', b.title || '');
    }
    if (sort === 'genre') return this.collator.compare(a.genre || '', b.genre || '') || this.collator.compare(a.title || '', b.title || '');
    return this.collator.compare(a.albumArtist || a.artist || '', b.albumArtist || b.artist || '') ||
      this.collator.compare(a.album || '', b.album || '') ||
      ((a.discNo || 0) - (b.discNo || 0)) ||
      ((a.trackNo || 0) - (b.trackNo || 0)) ||
      this.collator.compare(a.relativePath || a.title || '', b.relativePath || b.title || '');
  }
}
