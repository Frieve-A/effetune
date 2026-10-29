'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { SubsonicSource } = require('../../electron/subsonic-source.cjs');

const config = { id: 'subsonic:fixture', name: 'Music server', url: 'https://music.example/library/', user: 'listener', password: 'fixture-password' };
const song = { id: 'song-1', title: 'First track', artist: 'Artist', album: 'Album', contentType: 'audio/flac', suffix: 'flac',
  duration: 123, bitRate: 900, coverArt: 'cover-1', transcodedContentType: 'audio/mpeg', transcodedSuffix: 'mp3' };
const response = payload => ({ ok: true, text: async () => JSON.stringify({ 'subsonic-response': { status: 'ok', version: '1.16.1', ...payload } }) });

function fixture(t, handler) {
  const requests = [];
  const source = new SubsonicSource(config, { fetchImpl: async (value, options) => {
    const url = new URL(value);
    requests.push({ url, options });
    return handler(url.pathname.split('/').at(-1).replace('.view', ''), url.searchParams, options);
  } });
  t.after(() => source.close());
  return { source, requests };
}

test('Subsonic authentication uses salted tokens while public source information contains no credential', async t => {
  const { source, requests } = fixture(t, () => response({ openSubsonic: true }));
  assert.deepEqual(await source.test(), { id: config.id, name: config.name, url: config.url, user: config.user, type: 'subsonic', available: true });
  assert.equal(source.openSubsonic, true);
  const { url, options } = requests[0];
  assert.equal(url.pathname, '/library/rest/ping.view');
  assert.equal(url.searchParams.get('u'), 'listener');
  const salt = url.searchParams.get('s');
  assert.match(salt, /^[a-f0-9]{32}$/);
  assert.equal(url.searchParams.get('t'), crypto.createHash('md5').update(config.password + salt).digest('hex'));
  assert.equal(url.searchParams.has('p'), false);
  assert.equal(url.href.includes(config.password), false);
  assert.equal(options.redirect, 'error');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.signal.aborted, false);
  assert.equal(JSON.stringify(source.library()).includes(config.password), false);
  assert.deepEqual(source.library().browseViews.map(view => view.id), ['albums', 'tracks', 'playlists']);
});

test('Subsonic browse and search preserve page boundaries and playlist order including duplicates', async t => {
  const { source, requests } = fixture(t, (action, args) => {
    if (action === 'getAlbumList2') return response({ albumList2: { album: [{ id: 'album-1', name: 'Album', songCount: 2 }] } });
    if (action === 'search3') return response({ searchResult3: { song: [song] } });
    if (action === 'getPlaylists') return response({ playlists: { playlist: [{ id: 'playlist-1', name: 'Favorites', songCount: 3 }] } });
    if (action === 'getAlbum') { assert.equal(args.get('id'), 'album-1'); return response({ album: { song: [song] } }); }
    if (action === 'getPlaylist') return response({ playlist: { entry: [song, { ...song, id: 'song-2', title: 'Second track' }, song] } });
    throw new Error(`Unexpected fixture action: ${action}`);
  });
  const root = await source.browse();
  assert.deepEqual(root.items.map(item => item.id), ['albums', 'tracks', 'playlists']);
  const albums = await source.browse({ objectId: 'albums', start: 2, count: 10 });
  assert.equal(albums.items[0].id, 'album:album-1');
  assert.equal(requests.at(-1).url.searchParams.get('offset'), '2');
  assert.equal(requests.at(-1).url.searchParams.get('size'), '10');
  const tracks = await source.browse({ objectId: 'tracks', query: 'First', start: 3, count: 5 });
  assert.equal(tracks.items[0].serverId, config.id);
  assert.equal(tracks.total, 4);
  assert.equal(requests.at(-1).url.searchParams.get('query'), 'First');
  assert.equal(requests.at(-1).url.searchParams.get('songOffset'), '3');
  assert.equal((await source.browse({ objectId: 'album:album-1' })).items[0].parentId, 'album:album-1');
  assert.equal((await source.browse({ objectId: 'playlists' })).items[0].id, 'playlist:playlist-1');
  const playlist = await source.browse({ objectId: 'playlist:playlist-1' });
  assert.deepEqual(playlist.items.map(item => item.id), ['song-1', 'song-2', 'song-1']);
  const page = await source.browse({ objectId: 'playlist:playlist-1', start: 1, count: 1 });
  assert.equal(page.total, 3);
  assert.deepEqual(page.items.map(item => item.id), ['song-2']);
});

test('Subsonic metadata separates original and offered conversion while private stream and artwork URLs remain scoped to the server', async t => {
  const { source } = fixture(t, () => response({ song }));
  const original = await source.resolve('song-1');
  assert.equal(original.quality, 'original');
  assert.equal(original.seekable, true);
  assert.equal(original.resources[0].protocolInfo, 'http-get:*:audio/flac:*');
  assert.equal(original.uri, '');
  assert.equal(original.artwork, '');
  assert.doesNotMatch(JSON.stringify(original), /[?&]t=[a-f0-9]{32}/);
  assert.equal(JSON.stringify(original).includes(config.password), false);
  const converted = await source.resolve('song-1', { transcode: true });
  assert.equal(converted.quality, 'transcoded');
  assert.equal(converted.seekable, false);
  assert.equal(converted.resources[0].protocolInfo, 'http-get:*:audio/mpeg:*');
  const raw = new URL((await source.resource('song-1')).uri);
  const stream = new URL((await source.resource('song-1', 'media', { transcode: true })).uri);
  const art = new URL((await source.resource('song-1', 'artwork')).uri);
  assert.equal(raw.origin, new URL(config.url).origin);
  assert.equal(raw.pathname, '/library/rest/stream.view');
  assert.equal(raw.searchParams.get('format'), 'raw');
  assert.equal(stream.searchParams.get('format'), 'mp3');
  assert.equal(art.pathname, '/library/rest/getCoverArt.view');
  assert.equal(art.searchParams.get('id'), 'cover-1');
  assert.equal(art.searchParams.get('size'), '512');
  const unavailable = fixture(t, () => response({ song: { ...song, transcodedContentType: '' } })).source;
  await assert.rejects(unavailable.resolve('song-1', { transcode: true }), { code: 'unsupportedFormat' });
});

test('Subsonic authentication failures and redirect rejection expose useful errors without remote diagnostics', async t => {
  const auth = fixture(t, () => response({ status: 'failed', error: { code: 40, message: 'Private server diagnostic' } })).source;
  await assert.rejects(auth.test(), error => error.code === 'authenticationFailed' && !error.message.includes('Private server diagnostic'));
  assert.equal(auth.publicInfo().available, false);
  const redirect = fixture(t, (_action, _args, options) => {
    assert.equal(options.redirect, 'error');
    throw new TypeError('Redirect to https://other.example/?secret=private');
  }).source;
  await assert.rejects(redirect.browse({ objectId: 'albums' }), error => error.code === 'connectionFailed' && !error.message.includes('secret'));
});

test('removing a Subsonic connection aborts pending work, erases its password and rejects late results', { timeout: 2000 }, async t => {
  let finish;
  const { source, requests } = fixture(t, () => new Promise(resolve => { finish = resolve; }));
  let guard;
  try {
    const pending = source.test();
    const guarded = Promise.race([pending, new Promise((_resolve, reject) => {
      guard = setTimeout(() => reject(new Error('The late response did not settle.')), 1500);
    })]);
    source.close();
    assert.equal(requests[0].options.signal.aborted, true);
    assert.equal(source.config.password, '');
    finish(response({}));
    await assert.rejects(guarded, { code: 'unavailable' });
    assert.equal(source.publicInfo().available, false);
    await assert.rejects(source.resource('song-1'), { code: 'unavailable' });
  } finally { clearTimeout(guard); }
});
