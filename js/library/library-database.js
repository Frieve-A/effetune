import { MUSIC_LIBRARY_DB_NAME, MUSIC_LIBRARY_DB_VERSION } from './constants.js';

const STORE_NAMES = Object.freeze(['folders', 'tracks', 'artwork', 'playlists', 'meta']);

export class LibraryDatabase {
  constructor({ indexedDB = globalThis.indexedDB } = {}) {
    this.indexedDB = indexedDB;
    this.db = null;
    this.memory = createMemoryStores();
  }

  async open() {
    if (!this.indexedDB) {
      return this;
    }

    this.db = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open(MUSIC_LIBRARY_DB_NAME, MUSIC_LIBRARY_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('folders')) {
          db.createObjectStore('folders', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('tracks')) {
          const store = db.createObjectStore('tracks', { keyPath: 'id' });
          store.createIndex('byFolder', 'folderId', { unique: false });
          store.createIndex('byFolderPath', ['folderId', 'relativePath'], { unique: true });
          store.createIndex('byAlbumKey', 'albumKey', { unique: false });
        }
        if (!db.objectStoreNames.contains('artwork')) {
          db.createObjectStore('artwork', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this;
  }

  async getAllFolders() {
    return this.getAll('folders');
  }

  async getAllTracks() {
    return this.getAll('tracks');
  }

  async getAllPlaylists() {
    return this.getAll('playlists');
  }

  async getFolder(id) {
    return this.get('folders', id);
  }

  async putFolder(folder) {
    await this.put('folders', folder);
    return folder;
  }

  async deleteFolder(folderId) {
    const tracks = await this.getTracksByFolder(folderId);
    await this.markPlaylistTracksUnresolved(tracks);
    await this.transaction(['folders', 'tracks'], 'readwrite', stores => {
      stores.folders.delete(folderId);
      for (const track of tracks) {
        stores.tracks.delete(track.id);
      }
    });
    return tracks.map(track => track.id);
  }

  async updateFolder(folderId, updates) {
    const folder = await this.getFolder(folderId);
    if (!folder) return null;
    const next = { ...folder, ...updates };
    await this.putFolder(next);
    return next;
  }

  async putTracks(tracks = []) {
    if (tracks.length === 0) return [];
    await this.transaction(['tracks'], 'readwrite', stores => {
      for (const track of tracks) {
        stores.tracks.put(track);
      }
    });
    return tracks;
  }

  async deleteTracks(ids = []) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const tracks = (await this.getAllTracks()).filter(track => idSet.has(track.id));
    await this.markPlaylistTracksUnresolved(tracks);
    await this.transaction(['tracks'], 'readwrite', stores => {
      for (const id of ids) {
        stores.tracks.delete(id);
      }
    });
  }

  async markPlaylistTracksUnresolved(tracks = []) {
    if (!tracks.length) return [];
    const trackById = new Map(tracks.map(track => [track.id, track]));
    const playlists = await this.getAllPlaylists();
    const changed = [];
    for (const playlist of playlists) {
      let didChange = false;
      const items = (playlist.items || []).map(item => {
        const track = trackById.get(item?.trackId);
        if (!track) return item;
        didChange = true;
        return {
          ...item,
          trackId: null,
          unresolved: {
            ...(item.unresolved || {}),
            originalTrackId: track.id,
            folderId: track.folderId,
            relativePathHint: track.relativePath,
            sourceLine: track.relativePath,
            fileName: track.fileName,
            title: track.title,
            artist: track.artist || track.albumArtist || '',
            album: track.album || '',
            durationSec: track.durationSec || undefined
          }
        };
      });
      if (didChange) {
        const next = { ...playlist, items, updatedAt: Date.now() };
        await this.putPlaylist(next);
        changed.push(next.id);
      }
    }
    return changed;
  }

  async getTracksByFolder(folderId) {
    const tracks = await this.getAllTracks();
    return tracks.filter(track => track.folderId === folderId);
  }

  async getKnownFilesByFolder(folderId) {
    const tracks = await this.getTracksByFolder(folderId);
    return tracks.map(track => ({
      folderId: track.folderId,
      relativePath: track.relativePath,
      size: track.size,
      mtimeMs: track.mtimeMs,
      trackId: track.id,
      artworkId: track.artworkId || null
    }));
  }

  async putArtwork(artwork) {
    await this.put('artwork', artwork);
    return artwork;
  }

  async getArtwork(id) {
    return this.get('artwork', id);
  }

  async putPlaylist(playlist) {
    await this.put('playlists', playlist);
    return playlist;
  }

  async deletePlaylist(id) {
    await this.delete('playlists', id);
  }

  async get(key, id) {
    if (!this.db) {
      return cloneValue(this.memory[key].get(id) || null);
    }
    return this.request(this.db.transaction(key, 'readonly').objectStore(key).get(id));
  }

  async getAll(key) {
    if (!this.db) {
      return [...this.memory[key].values()].map(cloneValue);
    }
    return this.request(this.db.transaction(key, 'readonly').objectStore(key).getAll());
  }

  async put(key, value) {
    if (!this.db) {
      this.memory[key].set(value.id || value.key, cloneValue(value));
      return value;
    }
    return this.request(this.db.transaction(key, 'readwrite').objectStore(key).put(value));
  }

  async delete(key, id) {
    if (!this.db) {
      this.memory[key].delete(id);
      return;
    }
    return this.request(this.db.transaction(key, 'readwrite').objectStore(key).delete(id));
  }

  async transaction(storeNames, mode, callback) {
    if (!this.db) {
      const stores = {};
      for (const name of storeNames) {
        stores[name] = createMemoryStoreAdapter(this.memory[name]);
      }
      callback(stores);
      return;
    }

    await new Promise((resolve, reject) => {
      const tx = this.db.transaction(storeNames, mode);
      const stores = {};
      for (const name of storeNames) {
        stores[name] = tx.objectStore(name);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      callback(stores);
    });
  }

  request(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async clear() {
    if (!this.db) {
      this.memory = createMemoryStores();
      return;
    }
    await this.transaction(STORE_NAMES, 'readwrite', stores => {
      for (const name of STORE_NAMES) {
        stores[name].clear();
      }
    });
  }
}

function createMemoryStores() {
  return Object.fromEntries(STORE_NAMES.map(name => [name, new Map()]));
}

function createMemoryStoreAdapter(map) {
  return {
    put(value) {
      map.set(value.id || value.key, cloneValue(value));
    },
    delete(id) {
      map.delete(id);
    },
    clear() {
      map.clear();
    }
  };
}

function cloneValue(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch (_) {
      // FileSystem handles are not always cloneable in tests.
    }
  }
  return JSON.parse(JSON.stringify(value));
}
