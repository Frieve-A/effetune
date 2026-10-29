'use strict';

const crypto = require('node:crypto');
const { didl, didlItem } = require('./network-music-upnp.cjs');
const fail = (code, message) => Object.assign(new Error(message), { code });

class SubsonicSource {
  constructor(config, { fetchImpl = globalThis.fetch } = {}) {
    const url = new URL(config.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || typeof config.user !== 'string' || !config.user || typeof config.password !== 'string' || !config.password) throw fail('invalidRequest', 'Enter the server address, username, and password.');
    url.pathname = url.pathname.replace(/\/$/, '') + '/';
    this.config = { id: config.id || `subsonic:${crypto.randomUUID()}`, name: String(config.name || url.hostname).slice(0, 128), url: url.href, user: config.user, password: config.password };
    this.fetchImpl = fetchImpl; this.pending = new Set(); this.closed = false; this.available = true;
  }
  publicInfo() { const { id, name, url, user } = this.config; return { id, name, url, user, type: 'subsonic', available: this.available && !this.closed }; }
  library() { return { ...this.publicInfo(), searchSupported: true, catalogSearch: true, sortCaps: [], browseViews: ['albums', 'tracks', 'playlists'].map(id => ({ id, objectId: id })) }; }
  endpoint(action, args = {}) {
    const salt = crypto.randomBytes(16).toString('hex');
    const token = crypto.createHash('md5').update(this.config.password + salt).digest('hex');
    const url = new URL(`rest/${action}.view`, this.config.url);
    url.search = new URLSearchParams({ u: this.config.user, t: token, s: salt, v: '1.16.1', c: 'EffeTune', f: 'json', ...args }).toString();
    return url.href;
  }
  async request(action, args = {}) {
    if (this.closed) throw fail('unavailable', 'This music server connection has been removed.');
    const controller = new AbortController(); this.pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000); timer.unref?.();
    try {
      const response = await this.fetchImpl(this.endpoint(action, args), { redirect: 'error', credentials: 'omit', signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw fail('connectionFailed', 'The music server could not be reached. Check its address and connection.');
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw fail('invalidResponse', 'The music server returned too much information.');
      const data = JSON.parse(text)?.['subsonic-response'];
      if (this.closed) throw fail('unavailable', 'This music server connection has been removed.');
      if (data?.status !== 'ok') throw fail([40, 41].includes(Number(data?.error?.code)) ? 'authenticationFailed' : 'unsupported', 'The music server could not complete the request. Check the connection and sign-in details.');
      this.available = true; return data;
    } catch (error) {
      this.available = false;
      if (error.code) throw error;
      throw fail('connectionFailed', 'The music server could not be reached. Check its address and sign-in details.');
    } finally { clearTimeout(timer); this.pending.delete(controller); }
  }
  async test() { const info = await this.request('ping'); this.openSubsonic = info.openSubsonic === true; return this.publicInfo(); }
  track(row, parentId = 'tracks') {
    const id = String(row.id);
    const mime = row.contentType || '';
    return { id, trackId: id, serverId: this.config.id, parentId, title: row.title || row.name || 'Track', artist: row.artist || '', album: row.album || '', genre: row.genre || '', trackNo: row.track, duration: Number(row.duration) || 0,
      coverArtId: row.coverArt ? String(row.coverArt) : '', isContainer: false, playable: Boolean(mime), uri: '', artwork: '',
      quality: 'original', bitRate: Number(row.bitRate) || null, seekable: true,
      resources: mime ? [{ uri: '', protocolInfo: `http-get:*:${mime}:*`, duration: time(Number(row.duration) || 0) }] : [],
      transcodedContentType: row.transcodedContentType || '', transcodedSuffix: row.transcodedSuffix || '' };
  }
  container(row, type, parentId) { return { id: `${type}:${row.id}`, parentId, serverId: this.config.id, title: row.name || row.title || 'Music', artist: row.artist || '', coverArtId: row.coverArt ? String(row.coverArt) : '', isContainer: true, playable: false, childCount: row.songCount, upnpClass: type === 'album' ? 'object.container.album.musicAlbum' : 'object.container.playlistContainer' }; }
  async browse({ objectId = '0', start = 0, count = 100, query = '' } = {}) {
    if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 1 || count > 500 || typeof query !== 'string') throw fail('invalidRequest', 'Choose a valid page of music.');
    let items; let total = null;
    if (objectId === '0' && !query) {
      items = ['albums', 'tracks', 'playlists'].map(id => ({ id, viewId: id, parentId: '0', title: id[0].toUpperCase() + id.slice(1), serverId: this.config.id, isContainer: true, playable: false }));
      total = items.length; items = items.slice(start, start + count);
    } else if (query || objectId === 'tracks') {
      const result = await this.request('search3', { query, songOffset: start, songCount: count, albumCount: 0, artistCount: 0 });
      items = (result.searchResult3?.song || []).map(row => this.track(row));
      if (items.length < count) total = start + items.length;
    } else if (objectId === 'albums') {
      const result = await this.request('getAlbumList2', { type: 'alphabeticalByName', offset: start, size: count });
      items = (result.albumList2?.album || []).map(row => this.container(row, 'album', 'albums'));
      if (items.length < count) total = start + items.length;
    } else if (objectId === 'playlists') {
      const result = await this.request('getPlaylists');
      const rows = result.playlists?.playlist || []; total = rows.length;
      items = rows.slice(start, start + count).map(row => this.container(row, 'playlist', 'playlists'));
    } else if (objectId.startsWith('album:') || objectId.startsWith('playlist:')) {
      const album = objectId.startsWith('album:');
      const result = await this.request(album ? 'getAlbum' : 'getPlaylist', { id: objectId.slice(objectId.indexOf(':') + 1) });
      const rows = album ? result.album?.song || [] : result.playlist?.entry || [];
      total = rows.length; items = rows.slice(start, start + count).map(row => this.track(row, objectId));
    } else throw fail('unsupported', 'Choose an album, track list, or playlist.');
    return { serverId: this.config.id, items, start, total, numberReturned: items.length };
  }
  async resolve(trackId, { transcode = false } = {}) {
    const result = await this.request('getSong', { id: String(trackId) });
    if (!result.song || String(result.song.id) !== String(trackId)) throw fail('trackUnavailable', 'This track is no longer available.');
    const item = this.track(result.song);
    if (transcode) {
      if (!item.transcodedContentType || !item.transcodedSuffix) throw fail('unsupportedFormat', 'The server has not offered a compatible conversion for this track.');
      item.quality = 'transcoded'; item.seekable = false; item.resources[0].protocolInfo = `http-get:*:${item.transcodedContentType}:*`;
    }
    item.metadata = didl([didlItem(item)]); return item;
  }
  async resource(trackId, kind = 'media', { transcode = false } = {}) {
    const item = await this.resolve(trackId, { transcode });
    return { uri: kind === 'artwork' ? item.coverArtId ? this.endpoint('getCoverArt', { id: item.coverArtId, size: 512 }) : '' : this.endpoint('stream', { id: String(trackId), format: transcode ? item.transcodedSuffix : 'raw' }) };
  }
  close() { this.closed = true; this.config.password = ''; for (const pending of this.pending) pending.abort(); this.pending.clear(); }
}
const time = value => `${Math.floor(value / 3600)}:${String(Math.floor(value / 60) % 60).padStart(2, '0')}:${String(Math.floor(value % 60)).padStart(2, '0')}`;

module.exports = { SubsonicSource };
