import { networkMusicError, registerPwaDirectMedia } from './pwa-connection.js';
import { ensureAndroidNetworkAccess } from '../android/network.js';

// Subsonic's token authentication specifies MD5 over UTF-8 password + salt.
const shifts = [[7, 12, 17, 22], [5, 9, 14, 20], [4, 11, 16, 23], [6, 10, 15, 21]];
const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 0x100000000));
export function subsonicToken(value) {
  const bytes = new TextEncoder().encode(value);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const data = new DataView(padded.buffer);
  data.setUint32(padded.length - 8, bytes.length * 8, true);
  data.setUint32(padded.length - 4, Math.floor(bytes.length / 0x20000000), true);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < padded.length; offset += 64) {
    let [a, b, c, d] = state;
    for (let index = 0; index < 64; index++) {
      const round = Math.floor(index / 16);
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const word = round === 0 ? index : round === 1 ? (5 * index + 1) % 16 : round === 2 ? (3 * index + 5) % 16 : 7 * index % 16;
      const sum = (a + f + constants[index] + data.getUint32(offset + word * 4, true)) | 0;
      const shift = shifts[round][index % 4];
      [a, b, c, d] = [d, (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0, b, c];
    }
    for (const [index, value] of [a, b, c, d].entries()) state[index] = (state[index] + value) | 0;
  }
  return state.flatMap(word => [0, 8, 16, 24].map(shift => ((word >>> shift) & 255).toString(16).padStart(2, '0'))).join('');
}

export class PwaSubsonicSource {
  constructor({ name, url, user, password, fetchImpl = globalThis.fetch?.bind(globalThis), cryptoImpl = globalThis.crypto }) {
    let endpoint;
    try { endpoint = new URL(url); } catch { throw networkMusicError('subsonicConnection'); }
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
        !user || !password || typeof password !== 'string' || password.length > 4096) throw networkMusicError('subsonicConnection');
    this.endpoint = `${endpoint.origin}${endpoint.pathname.replace(/\/$/, '').replace(/\/rest$/, '')}/rest/`;
    Object.assign(this, { name: name || endpoint.hostname, user, password, fetchImpl, cryptoImpl });
    this.id = `subsonic:${cryptoImpl.randomUUID()}`;
    this.pending = new Set();
    this.media = new Set();
    this.closed = false;
  }

  url(method, params = {}) {
    if (this.closed) throw networkMusicError('unavailable');
    const salt = this.cryptoImpl.randomUUID().replaceAll('-', '');
    const url = new URL(`${method}.view`, this.endpoint);
    url.search = new URLSearchParams({ u: this.user, t: subsonicToken(this.password + salt), s: salt,
      v: '1.16.1', c: 'EffeTune', f: 'json', ...params });
    return url.href;
  }

  async request(method, params) {
    const networkPermission = ensureAndroidNetworkAccess();
    if (networkPermission) await networkPermission;
    const controller = new AbortController();
    this.pending.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(this.url(method, params), { mode: 'cors', credentials: 'omit', redirect: 'error',
        cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal });
      if (!response.ok) throw networkMusicError('subsonicConnection');
      const text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw networkMusicError('invalidResponse');
      const result = JSON.parse(text)?.['subsonic-response'];
      if (result?.status !== 'ok') throw networkMusicError(result?.error?.code === 40 ? 'subsonicAuthentication' : 'subsonicConnection');
      if (this.closed) throw networkMusicError('unavailable');
      return result;
    } catch (error) {
      if (error.networkMusic) throw error;
      throw networkMusicError('subsonicConnection');
    } finally { clearTimeout(timer); this.pending.delete(controller); }
  }

  async test() { await this.request('ping'); return true; }
  get descriptor() {
    return { id: this.id, name: this.name, type: 'subsonic', available: !this.closed, searchSupported: true, externalPlayback: false,
      browseViews: ['albums', 'tracks', 'playlists'].map(id => ({ id, objectId: id })), sortCaps: [] };
  }

  track(song) {
    return { id: String(song.id), trackId: String(song.id), serverId: this.id, title: song.title || song.name || '',
      artist: song.artist || '', album: song.album || '', duration: Number(song.duration) || 0, durationSec: Number(song.duration) || 0,
      playable: true, requiresGateway: true,
      artwork: song.coverArt ? this.url('getCoverArt', { id: song.coverArt, size: '512' }) : '',
      resources: song.contentType ? [{ protocolInfo: `http-get:*:${song.contentType}:*` }] : [],
      mimeType: song.contentType || '', bitrate: song.bitRate, sampleRate: song.samplingRate, bitDepth: song.bitDepth };
  }

  async browse({ objectId = 'albums', start = 0, count = 100, query = '' } = {}) {
    start = Number.isSafeInteger(start) && start > 0 ? start : 0;
    count = Number.isSafeInteger(count) && count > 0 ? Math.min(count, 500) : 100;
    let items, total = null;
    if (query || objectId === 'tracks') {
      const result = await this.request('search3', { query, songCount: String(count), songOffset: String(start), albumCount: '0', artistCount: '0' });
      items = (result.searchResult3?.song ?? []).map(song => this.track(song));
    } else if (objectId.startsWith('album:') || objectId.startsWith('playlist:')) {
      const playlist = objectId.startsWith('playlist:');
      const result = await this.request(playlist ? 'getPlaylist' : 'getAlbum', { id: objectId.slice(objectId.indexOf(':') + 1) });
      const songs = playlist ? result.playlist?.entry ?? [] : result.album?.song ?? [];
      total = songs.length;
      items = songs.slice(start, start + count).map(song => this.track(song));
    } else if (objectId === 'playlists') {
      const result = await this.request('getPlaylists');
      const playlists = result.playlists?.playlist ?? [];
      total = playlists.length;
      items = playlists.slice(start, start + count).map(item => ({ id: `playlist:${item.id}`, title: item.name, isContainer: true,
        upnpClass: 'object.container.playlistContainer', trackCount: item.songCount }));
    } else {
      const result = await this.request('getAlbumList2', { type: 'alphabeticalByName', size: String(count), offset: String(start) });
      items = (result.albumList2?.album ?? []).map(item => ({ id: `album:${item.id}`, title: item.name || item.album,
        artist: item.artist, isContainer: true, upnpClass: 'object.container.album.musicAlbum', trackCount: item.songCount,
        artwork: item.coverArt ? this.url('getCoverArt', { id: item.coverArt, size: '512' }) : '' }));
    }
    return { items, total, start, count, numberReturned: items.length };
  }

  async resolveTrack(trackId) {
    const result = await this.request('getSong', { id: trackId });
    if (!result.song) throw networkMusicError('unavailable');
    const track = this.track(result.song);
    const uri = this.url('stream', { id: trackId, format: 'raw' });
    const revoke = registerPwaDirectMedia(uri);
    this.media.add(revoke);
    return { ...track, uri, quality: 'original' };
  }

  dispose() {
    this.closed = true;
    this.password = '';
    for (const request of this.pending) request.abort();
    for (const revoke of this.media) revoke();
    this.media.clear();
  }
}
