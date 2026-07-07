import { generateEntityId } from '../id-utils.js';

export class PlaylistStore {
  constructor(database, emit = () => {}) {
    this.database = database;
    this.emit = emit;
  }

  async list() {
    return (await this.database.getAllPlaylists())
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  async get(id) {
    return this.database.get('playlists', id);
  }

  async create(name = 'New Playlist', items = []) {
    const now = Date.now();
    const playlist = {
      id: generateEntityId('p'),
      name,
      createdAt: now,
      updatedAt: now,
      items: normalizeItems(items)
    };
    await this.database.putPlaylist(playlist);
    this.emit('playlists-changed', { playlistId: playlist.id });
    return playlist;
  }

  async rename(id, name) {
    const playlist = await this.database.get('playlists', id);
    if (!playlist) return null;
    playlist.name = name;
    playlist.updatedAt = Date.now();
    await this.database.putPlaylist(playlist);
    this.emit('playlists-changed', { playlistId: id });
    return playlist;
  }

  async delete(id) {
    await this.database.deletePlaylist(id);
    this.emit('playlists-changed', { playlistId: id });
  }

  async duplicate(id, name) {
    const playlist = await this.database.get('playlists', id);
    if (!playlist) return null;
    return this.create(name || `${playlist.name} Copy`, playlist.items || []);
  }

  async addTracks(id, trackIds) {
    const playlist = await this.database.get('playlists', id);
    if (!playlist) return null;
    playlist.items.push(...normalizeItems(trackIds));
    playlist.updatedAt = Date.now();
    await this.database.putPlaylist(playlist);
    this.emit('playlists-changed', { playlistId: id });
    return playlist;
  }

  async replaceItems(id, items) {
    const playlist = await this.database.get('playlists', id);
    if (!playlist) return null;
    playlist.items = normalizeItems(items);
    playlist.updatedAt = Date.now();
    await this.database.putPlaylist(playlist);
    this.emit('playlists-changed', { playlistId: id });
    return playlist;
  }
}

function normalizeItems(items) {
  return (items || []).map(item => {
    if (typeof item === 'string') return { trackId: item };
    if (item.trackId || item.unresolved) {
      return {
        ...item,
        ...(item.unresolved ? { unresolved: { ...item.unresolved } } : {})
      };
    }
    return { trackId: item.id };
  });
}
