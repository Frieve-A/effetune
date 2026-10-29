import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PwaSubsonicSource, subsonicToken } from '../../js/network-music/subsonic-source.js';
import { PwaNetworkMusicTransport } from '../../js/network-music/pwa-transport.js';
import { isPwaNetworkMediaUrl } from '../../js/network-music/pwa-connection.js';

const response = body => ({ ok: true, text: async () => JSON.stringify({ 'subsonic-response': { status: 'ok', ...body } }) });
const connection = { name: 'Home', url: 'https://music.example.com/music', user: 'listener', password: 'private-secret' };

test('Subsonic token matches UTF-8 protocol vectors without sending the password', async t => {
  for (const value of ['sesamec19b2d', '音楽のパスワード', '', 'a'.repeat(100)]) {
    assert.equal(subsonicToken(value), createHash('md5').update(value).digest('hex'));
  }
  let request;
  const source = new PwaSubsonicSource({ ...connection, fetchImpl: async (url, init) => { request = { url: new URL(url), init }; return response({}); } });
  t.after(() => source.dispose());
  await source.test();
  assert.equal(request.url.pathname, '/music/rest/ping.view');
  assert.equal(request.url.searchParams.get('t'), createHash('md5').update(connection.password + request.url.searchParams.get('s')).digest('hex'));
  assert.equal(request.init.redirect, 'error');
  assert.equal(request.init.credentials, 'omit');
  assert.ok(!request.url.href.includes(connection.password));
  assert.throws(() => new PwaSubsonicSource({ ...connection, url: 'http://music.example.com' }), { code: 'subsonicConnection' });
});

test('Subsonic albums, search pages and playlist duplicate occurrences retain their references', async t => {
  const requests = [];
  const song = { id: 'track-a', title: 'Title', contentType: 'audio/flac', duration: 123, coverArt: 'cover-a' };
  const source = new PwaSubsonicSource({ ...connection, fetchImpl: async address => {
    const url = new URL(address); requests.push(url);
    if (url.pathname.endsWith('/getAlbumList2.view')) return response({ albumList2: { album: [{ id: 'album-a', name: 'Album' }] } });
    if (url.pathname.endsWith('/getPlaylist.view')) return response({ playlist: { entry: [song, { ...song, title: 'Repeated' }, { ...song, id: 'b' }] } });
    if (url.pathname.endsWith('/getSong.view')) return response({ song });
    return response({ searchResult3: { song: [song] } });
  } });
  t.after(() => source.dispose());
  assert.equal((await source.browse({ objectId: 'albums', start: 2, count: 5 })).items[0].id, 'album:album-a');
  assert.equal(requests.at(-1).searchParams.get('offset'), '2');
  const playlist = await source.browse({ objectId: 'playlist:list-a', count: 2 });
  assert.deepEqual(playlist.items.map(item => item.trackId), ['track-a', 'track-a']);
  assert.equal(playlist.total, 3);
  assert.equal(playlist.items[0].durationSec, 123);
  await source.browse({ query: 'music', start: 20, count: 10 });
  assert.equal(requests.at(-1).searchParams.get('songOffset'), '20');
  const track = await source.resolveTrack('track-a');
  assert.equal(new URL(track.uri).searchParams.get('format'), 'raw');
  assert.equal(track.quality, 'original');
  assert.equal(isPwaNetworkMediaUrl(track.uri), true);
  source.dispose();
  assert.equal(isPwaNetworkMediaUrl(track.uri), false);
});

test('direct PWA Subsonic connections stay session-only and cannot send login URLs to another player', async t => {
  const writes = [];
  const api = new PwaNetworkMusicTransport({ windowRef: null, storage: { getItem: () => null, setItem: (...args) => writes.push(args) }, fetchImpl: async () => response({}) });
  t.after(() => api.dispose());
  await api.networkMusicConfigure({ subsonic: { action: 'add', ...connection } });
  const state = await api.networkMusicGetState();
  assert.equal(state.sources.length, 1);
  assert.equal(state.sources[0].password, undefined);
  assert.equal(writes.length, 0);
  const item = { serverId: state.sources[0].id, trackId: 'track' };
  assert.equal(api.canPlayItem(item, 'local'), true);
  assert.equal(api.canPlayItem(item, 'another-player'), false);
  await assert.rejects(api.networkMusicResolveTrack(item), { code: 'gatewayRequired' });
  await api.networkMusicConfigure({ subsonic: { action: 'remove', id: item.serverId } });
  assert.equal((await api.networkMusicGetState()).sources.length, 0);
});

test('Subsonic authentication, CORS and cancelled late responses do not create a usable connection', async t => {
  const bad = new PwaSubsonicSource({ ...connection, fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ 'subsonic-response': { status: 'failed', error: { code: 40, message: connection.password } } }) }) });
  t.after(() => bad.dispose());
  await assert.rejects(bad.test(), error => error.code === 'subsonicAuthentication' && !error.message.includes(connection.password));
  const denied = new PwaSubsonicSource({ ...connection, fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  t.after(() => denied.dispose());
  await assert.rejects(denied.test(), { code: 'subsonicConnection' });
  let finish;
  const api = new PwaNetworkMusicTransport({ windowRef: null, fetchImpl: async () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => api.dispose());
  const pending = api.networkMusicConfigure({ subsonic: { action: 'add', ...connection } });
  api.cancelSourceRegistration();
  finish(response({}));
  await assert.rejects(pending, { code: 'unavailable' });
  assert.equal((await api.networkMusicGetState()).sources.length, 0);
});
