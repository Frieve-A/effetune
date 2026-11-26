import assert from 'node:assert/strict';
import test from 'node:test';
import { withGlobals } from '../helpers/global-test-utils.mjs';
import { ANDROID_ORIGIN } from '../../js/android/bridge.js';
import { PwaNetworkMusicTransport } from '../../js/network-music/pwa-transport.js';
import { PwaSubsonicSource } from '../../js/network-music/subsonic-source.js';

test('Android Subsonic retains Android-owned registrations and uses credential-free native references', async () => {
  const source = { id: 'subsonic:test', name: 'Home', url: 'http://music.local:4533/', user: 'listener' };
  const calls = [];
  let saved = false;
  const window = { location: { origin: ANDROID_ORIGIN }, effetuneAndroid: {
    postMessage(text) {
      const { id, command, payload } = JSON.parse(text);
      calls.push(command);
      let result;
      switch (command) {
        case 'network.ensurePermission': result = { granted: true }; break;
        case 'subsonic.list': result = { sources: saved ? [source] : [] }; break;
        case 'subsonic.add':
          assert.equal(payload.url, source.url);
          assert.equal(payload.password, 'fixture');
          saved = true; result = source; break;
        case 'subsonic.test': assert.equal(payload.id, source.id); result = {}; break;
        case 'subsonic.remove': assert.equal(payload.id, source.id); saved = false; result = {}; break;
        default: assert.fail(command);
      }
      queueMicrotask(() => this.onmessage({ data: JSON.stringify({ version: 1, id, ok: true, result }) }));
    }
  } };
  const song = { id: 'song & 42', title: 'Song', contentType: 'audio/flac', coverArt: 'cover & 42' };
  const paths = [];
  let serverError;
  const fetchImpl = async (value, init) => {
    const url = new URL(value);
    paths.push(url.pathname);
    assert.equal(url.origin, ANDROID_ORIGIN);
    assert.equal(url.searchParams.get('source'), source.id);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.mode, 'same-origin');
    assert.equal(url.searchParams.has('t'), false);
    if (serverError) return Response.json({ 'subsonic-response': { status: 'failed', error: { code: serverError } } });
    const data = { status: 'ok' };
    if (url.pathname.endsWith('/search3')) {
      assert.equal(url.searchParams.get('query'), 'song & artist');
      data.searchResult3 = { song: [song] };
    } else {
      assert.equal(url.searchParams.get('id'), song.id);
      data.song = song;
    }
    return Response.json({ 'subsonic-response': data });
  };
  await withGlobals({ window }, async () => {
    const first = new PwaNetworkMusicTransport({ fetchImpl });
    const added = await first.networkMusicConfigure({ subsonic: { ...source, action: 'add', password: 'fixture' } });
    assert.equal(added.sources[0].password, undefined);
    first.dispose();
    const second = new PwaNetworkMusicTransport({ fetchImpl });
    assert.equal((await second.networkMusicGetState()).libraries[0].id, source.id);
    await second.networkMusicConfigure({ subsonic: { action: 'test', id: source.id } });
    const browse = { serverId: source.id, query: 'song & artist' };
    const { items: [item] } = await second.networkMusicBrowse(browse);
    second.browserProtocols = () => [];
    assert.equal(second.canPlayItem(item, 'local'), true);
    assert.equal(second.canPlayItem(item, 'remote'), false);
    const track = await second.networkMusicResolveTrack({ ...item, localPlayback: true });
    assert.deepEqual(paths, ['/subsonic/search3', '/subsonic/getSong']);
    for (const [value, path, id] of [[track.artwork, '/subsonic/artwork', song.coverArt], [track.uri, '/subsonic/stream', song.id]]) {
      const url = new URL(value);
      assert.equal(url.origin, ANDROID_ORIGIN);
      assert.equal(url.pathname, path);
      assert.deepEqual(Object.fromEntries(url.searchParams), { source: source.id, id });
    }
    serverError = 41;
    await assert.rejects(second.networkMusicBrowse(browse), { code: 'subsonicAuthentication' });
    const removed = await second.networkMusicConfigure({ subsonic: { action: 'remove', id: source.id } });
    assert.deepEqual(removed.sources, []);
    second.dispose();
    const third = new PwaNetworkMusicTransport({ fetchImpl });
    assert.deepEqual((await third.networkMusicGetState()).sources, []);
    assert.deepEqual(calls.filter(command => command.startsWith('subsonic.')),
      ['subsonic.list', 'subsonic.add', 'subsonic.list', 'subsonic.test', 'subsonic.remove', 'subsonic.list']);
    third.dispose();
  });
});

test('PWA browser Subsonic still rejects cleartext endpoints', () => {
  assert.throws(() => new PwaSubsonicSource({ url: 'http://music.local', user: 'listener', password: 'fixture' }),
    { code: 'subsonic' + 'Connection' });
});

for (const openHome of [true, false]) {
  test('Android publishes Subsonic tracks for ' + (openHome ? 'OpenHome' : 'UPnP AV'), async t => {
    const { AndroidNetworkMusicTransport } = await import('../../js/android/network-music-transport.js');
    const { parseDidl } = await import('../../js/network-music/upnp/protocol.js');
    const serverId = 'subsonic:test', playerId = 'renderer', target = '192.168.1.22';
    const base = 'http://192.168.1.10:4040';
    const published = new Map(), sent = [];
    let sink = 'http-get:*:audio/mpeg:*', queue = [], currentUri = '', refuse = false;
    let failPartial = false, offline = false;
    let stalePoll, delayMediaInfo = false, releaseStalePoll;
    const bridge = { on: () => () => {}, async request(command, args) {
      if (command === 'share.status') return { enabled: false, folderIds: [], hasFiles: published.size > 0 };
      if (command === 'share.route') return { address: '192.168.1.10', baseUrl: null };
      if (command === 'share.publish') {
        if (!openHome && failPartial && !stalePoll) {
          delayMediaInfo = true;
          stalePoll = api.getPlayerState({ playerId });
        }
        assert.deepEqual([args.serverId, args.playerId, args.target, args.coverArtId], [serverId, playerId, target, 'cover']);
        assert.equal(args.uri, undefined);
        const entry = [...published.values()].find(row => row.trackId === args.trackId && row.format === args.format) ?? args;
        published.set(entry.token, entry);
        return { token: entry.token, uri: base + '/media/' + entry.token, artwork: base + '/artwork/' + entry.token };
      }
      if (command === 'share.revoke') {
        for (const token of published.keys()) if (args.tokens?.includes(token) || args.keep && !args.keep.includes(token)) published.delete(token);
        return { hasFiles: published.size > 0 };
      }
      assert.fail(command);
    } };
    const api = new AndroidNetworkMusicTransport({ bridge, windowRef: {}, loadConfig: async () => ({}), ensureNetworkAccess: async () => {} });
    t.after(() => api.dispose());
    api.pwa = {
      command: async () => ({ sources: [{ id: serverId, name: 'Music' }] }),
      request: async (_, method, { id }) => {
        assert.equal(method, 'getSong');
        return { song: { id, contentType: 'audio/flac', transcodedContentType: 'audio/mpeg', transcodedSuffix: 'mp3', coverArt: 'cover' } };
      },
      url: () => 'https://upstream.invalid/rest/stream.view?u=user&t=secret',
      configure: async ({ action, id }) => { assert.equal(action, 'remove'); assert.equal(id, serverId); }
    };
    const type = openHome ? 'urn:av-openhome-org:service:Playlist' : 'urn:schemas-upnp-org:service:AVTransport';
    const services = new Map([[type, {}], ['urn:schemas-upnp-org:service:ConnectionManager', {}]]);
    api.discovery.devices.set(playerId, { id: playerId, address: target, available: true, services });
    if (openHome) api.getPlayerState = async () => {
      if (offline) throw new Error('fixture offline');
      return { protocolInfo: sink, queue };
    };
    api.invoke = async (_, action, args) => {
      if (action === 'TracksMax') return { Value: 100 };
      if (action === 'GetProtocolInfo') return { Sink: sink };
      if (action === 'GetMediaInfo') {
        const snapshot = { CurrentURI: currentUri };
        if (!delayMediaInfo) return snapshot;
        delayMediaInfo = false;
        return new Promise(resolve => { releaseStalePoll = () => resolve(snapshot); });
      }
      if (action === 'DeleteAll') queue = [];
      if (failPartial && (action === 'Play' || action === 'Insert' && queue.length)) {
        offline = openHome;
        if (releaseStalePoll) setImmediate(releaseStalePoll);
        throw new Error('fixture partial failure');
      }
      if (action === 'Insert' || action === 'SetAVTransportURI') {
        if (refuse) throw new Error('fixture send failure');
        const uri = args.Uri ?? args.CurrentURI, metadata = args.Metadata ?? args.CurrentURIMetaData;
        assert.doesNotMatch(metadata, /upstream|secret|\?u=/);
        const [item] = parseDidl(metadata);
        const token = new URL(uri).pathname.split('/').pop();
        assert.equal(uri, base + '/media/' + token);
        assert.equal(item.artwork, base + '/artwork/' + token);
        assert.deepEqual([item.resources[0].uri, item.resources[0].protocolInfo], [uri, sink]);
        sent.push(published.get(token));
        currentUri = uri;
        queue.push({ uri });
        return { NewId: queue.length };
      }
      return {};
    };
    const play = trackId => api.networkMusicPlayerCommand({ action: 'replace', play: true, playerId, items: [{ serverId, trackId }] });
    assert.equal((await api.networkMusicGetState()).sources[0].externalPlayback, true);
    await play('song');
    assert.equal(sent.at(-1).format, 'mp3');
    await play('song');
    assert.equal(sent[0].token, sent[1].token);
    sink = 'http-get:*:audio/flac:*';
    await play('song');
    assert.equal(sent.at(-1).format, 'raw');
    assert.equal(published.size, 1);
    if (!openHome) {
      currentUri = base + '/another-controller';
      await api.networkMusicGetPlayerState({ playerId });
      assert.equal(published.size, 0);
    }
    sink = 'http-get:*:audio/wav:*';
    await assert.rejects(play('song'), { code: 'unsupportedFormat' });
    sink = 'http-get:*:audio/flac:*';
    refuse = true;
    await assert.rejects(play('other'), /fixture send failure/);
    assert.ok([...published.values()].every(entry => entry.trackId !== 'other'));
    refuse = false;
    await play('song');
    assert.equal(api.fileSources.size, 1);
    failPartial = true;
    const batch = ['accepted', 'later'].map(trackId => ({ serverId, trackId }));
    await assert.rejects(api.playerCommand({ action: 'replace', play: true, playerId, items: batch }), /partial failure/);
    if (stalePoll) await stalePoll;
    assert.ok([...published.values()].some(row => row.trackId === 'accepted'));
    assert.ok([...published.values()].some(row => row.trackId === 'later'));
    failPartial = offline = false;
    if (openHome) {
      await api.playerCommand({ action: 'pause', playerId });
      assert.deepEqual([...published.values()].map(row => row.trackId), ['accepted']);
    }
    await api.networkMusicConfigure({ subsonic: { action: 'remove', id: serverId } });
    assert.equal(api.fileSources.size, 0);
    await assert.rejects(play('song'), { code: 'unavailable' });
  });
}
