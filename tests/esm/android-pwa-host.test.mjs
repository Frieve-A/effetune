import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startAndroidPwaHost } from '../../js/android/pwa-host.js';
import dispatcher from '../../electron/remote-music-dispatcher.cjs';
import { withLibraryShare } from '../../js/android/library-share.js';
import { withUpnpCore } from '../../js/network-music/upnp/host-core.js';

const origin = 'http://192.168.1.2:47300';
const token = 'a'.repeat(32);
const grant = { uri: origin + '/pwa/v1/media/' + token, artwork: origin + '/pwa/v1/artwork/' + token };

function fixture(extra = {}, commands = {}) {
  const listeners = new Map();
  const calls = [];
  const bridge = {
    on(name, callback) { listeners.set(name, callback); return () => listeners.delete(name); },
    async request(name, args, revision) {
      calls.push({ name, args, revision });
      if (commands[name]) return commands[name](args, revision);
      if (name === 'share.status') return { id: 'host', friendlyName: 'Phone', enabled: true, updateId: 7 };
      if (name === 'pwa.issueGrant') return grant;
      if (name === 'pwa.respond' || name === 'pwa.respondPart') return { accepted: true };
      assert.fail(name);
    }
  };
  const music = { bridge, gatewayPermissions: { libraries: false, players: false },
    sources: new Map(), discovery: { devices: new Map() },
    networkMusicGetState: async () => ({ libraries: [{ id: 'external', available: true }], players: [] }),
    onDiagnostic(error) { throw error; }, ...extra };
  const stop = startAndroidPwaHost(music, async () => dispatcher.projectPlayback);
  const send = (route, body = {}, more = {}) => listeners.get('pwa-request')({ requestId: 'r1', baseOrigin: origin,
    playerId: 'phone', method: route === 'info' ? 'GET' : 'POST', route, body, ...more });
  return { music, calls, send, stop, cancel: () => listeners.get('pwa-cancelled')({ requestId: 'r1' }),
    response: () => calls.at(-1).args };
}

test('info and browse use host-owned capabilities and the shared catalog', async () => {
  const catalog = new (withLibraryShare(withUpnpCore()))();
  catalog.sharing = { enabled: true, folderIds: ['shared'] };
  catalog.shareBaseUrl = 'http://192.168.1.2:51000';
  catalog.shareUpdateId = 7;
  let query;
  catalog.getCatalog = async () => ({ repository: {
    querySharedLibrary: async args => {
      query = args;
      return { rows: [{ kind: 'track', title: 'Song', trackUid: 'one' }], total: 9 };
    },
    getTrack: async () => ({ trackUid: 'one', title: 'Song' }),
    getTrackStorageIdentity: async () => ({ folderId: 'shared', relativePath: 'song.flac', fileIdentity: 'content://tree/song' })
  } });
  const f = fixture({ browseShared: args => catalog.browseShared({ ...args, address: catalog.shareBaseUrl }),
    publishSharedSource: catalog.publishSharedSource.bind(catalog),
    publicTrack: catalog.publicTrack.bind(catalog), sharedSource: uid => catalog.sharedSource(uid),
    trackUidForToken: token => catalog.trackUidForToken(token) }, {
    'share.status': () => ({ id: 'host', enabled: true, baseUrl: catalog.shareBaseUrl, updateId: 7 }),
    'share.publish': () => ({}) });
  await f.send('info');
  assert.equal(f.response().body.hostId, 'host');
  assert.equal(f.response().body.capabilities.browseViews.length, 9);
  assert.deepEqual(f.response().body.libraries, []);
  await f.send('browse', { objectId: 'view:tracks', sortCriteria: '-dc:title', query: 'song', start: 4 });
  assert.deepEqual(query.folderIds, ['shared']);
  assert.equal(query.count, 100);
  assert.equal(query.catalogQuery, 'song');
  assert.equal(query.sort[0].direction, 'desc');
  assert.equal(f.response().body.items[0].uri, grant.uri);
  assert.equal(f.response().body.items[0].mediaKeys.length, 2);
  assert.doesNotMatch(JSON.stringify(f.response().body), /content:\/\/|51000/);
  assert.equal(f.response().body.updateId, 7);
  const trackId = f.response().body.items[0].trackId;
  assert.ok(!f.calls.some(call => call.name === 'share.publish'));
  const issued = f.calls.filter(call => call.name === 'pwa.issueGrant').length;
  await f.send('resolve', { trackId, audience: 'player' });
  assert.equal(f.response().body.uri, catalog.shareBaseUrl + '/media/' + trackId.split(':')[1]);
  assert.deepEqual(f.calls.find(call => call.name === 'share.publish').args, { token: trackId.split(':')[1],
    uri: 'content://tree/song', mime: 'audio/flac', size: -1, updateId: 7, _pwaRequestId: 'r1' });
  assert.doesNotMatch(JSON.stringify(f.response().body), /content:\/\//);
  assert.equal(f.calls.filter(call => call.name === 'pwa.issueGrant').length, issued);
  await f.send('browse', { count: 501 });
  assert.deepEqual(f.response().body, { error: { code: 'invalidRequest' } });
});

test('gateway permission checks precede reads and a supplied grant target cannot escape', async () => {
  const upstream = 'https://appassets.androidplatform.net/subsonic/stream?id=track';
  const f = fixture({ sources: new Map([['external', {}]]), networkMusicResolveTrack: async () => ({
    id: 'track', title: 'Song', playable: true, uri: upstream, headers: { Authorization: 'private' },
    artwork: 'https://appassets.androidplatform.net/subsonic/artwork?id=cover',
    transcodedResource: { protocolInfo: 'http-get:*:audio/mpeg:*', format: 'mp3' },
    resources: [{ uri: 'content://media/private', protocolInfo: 'http-get:*:audio/flac:*' }],
    metadata: '<media>https://upstream.example/?password=private</media>' }) });
  for (const [route, input] of [['browse', { serverId: 'external' }], ['player', { playerId: 'elsewhere' }]]) {
    await f.send(route, input);
    assert.equal(f.response().status, 403);
  }
  f.music.gatewayPermissions.libraries = true;
  await f.send('resolve', { audience: 'player', serverId: 'external', trackId: 'track' });
  assert.deepEqual(f.response().body, { error: { code: 'invalidRequest' } });
  await f.send('resolve', { audience: 'browser', serverId: 'external', trackId: 'track', target: { uri: 'content://elsewhere' } });
  assert.equal(f.response().status, 200);
  assert.deepEqual(f.calls.find(call => call.name === 'pwa.issueGrant').args.target, { coverArtId: 'cover' });
  const row = f.response().body;
  assert.equal(row.uri, grant.uri);
  assert.equal(row.resources[0].uri, grant.uri);
  assert.equal(row.artwork, grant.artwork);
  assert.doesNotMatch(JSON.stringify(row), /appassets|content:\/\/|upstream|private/);
  await f.send('resolve', { audience: 'browser', serverId: 'external', trackId: 'track',
    target: { protocolInfo: 'http-get:*:audio/mpeg:*', format: 'untrusted' } });
  assert.equal(f.response().body.resources[0].protocolInfo, 'http-get:*:audio/mpeg:*');
  assert.equal(f.calls.filter(call => call.name === 'pwa.issueGrant').at(-1).args.target.format, 'mp3');
});

test('cancellation during catalog access suppresses grants and replies', async () => {
  let started, finish;
  const entered = new Promise(resolve => { started = resolve; });
  const f = fixture({ browseShared: () => { started(); return new Promise(resolve => { finish = resolve; }); } });
  const waiting = f.send('browse');
  await entered;
  f.cancel();
  finish({ items: [], total: 0 });
  await waiting;
  assert.equal(f.calls.some(call => call.name.startsWith('pwa.')), false);
  f.stop();
});

test('large UTF-8 bodies and replies are acknowledged in byte order', async () => {
  const title = '漢🎵'.repeat(85000);
  const body = Buffer.from(JSON.stringify({ objectId: '0', query: title }));
  const size = 512 * 1024;
  const f = fixture({ publicTrack: item => item, trackUidForToken: () => null,
    browseShared: async ({ catalogQuery }) => {
      assert.equal(catalogQuery, title);
      return { items: [{ id: 'a', title, isContainer: true }], total: 1 };
    } }, { 'pwa.readBody': ({ offset }) => {
      const part = body.subarray(offset, offset + size);
      return { data: part.toString('base64'), nextOffset: offset + part.length, done: offset + part.length === body.length };
    } });
  await f.send('browse', null, { bodyBytes: body.length });
  const parts = f.calls.filter(call => call.name === 'pwa.respondPart').map(call => call.args);
  assert.ok(parts.length >= 2);
  let offset = 0;
  const data = parts.map((part, index) => {
    assert.equal(part.status, 200);
    assert.equal(part.offset, offset);
    assert.equal(part.done, index + 1 === parts.length);
    const bytes = Buffer.from(part.data, 'base64');
    assert.ok(bytes.length <= size);
    offset += bytes.length;
    return bytes;
  });
  assert.equal(offset, parts[0].total);
  assert.equal(JSON.parse(Buffer.concat(data)).items[0].title, title);
});

test('native queue pages share a revision and private media keys match across reads', async () => {
  const rows = Array.from({ length: 101 }, (_, id) => ({ id: id + 1, uri: 'content://folder/' + id, title: 'Song' }));
  const f = fixture({}, { 'playback.getPublic': ({ start, count }, revision) => {
    assert.equal(revision, start ? 42 : undefined);
    return { revision: 42, start, total: rows.length, queue: rows.slice(start, start + count), currentId: 101 };
  } });
  await f.send('player', {}, { method: 'GET' });
  const state = f.response().body;
  assert.equal(state.playerId, 'phone');
  assert.equal(state.queue.length, 101);
  assert.equal(state.currentTrack.id, 101);
  assert.match(state.queue[100].mediaKeys[0], /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(state), /content:/);
});

test('Android queue replacement checks the peer grant before changing playback', async () => {
  const target = { hostId: 'host', playerId: 'phone' };
  let text = JSON.stringify({ audience: 'player', target });
  const f = fixture({}, {
    'upnp.http': () => ({ status: 200, text }),
    'playback.queue.begin': () => ({}), 'playback.queue.commit': () => ({}),
    'playback.queue.append': () => ({}),
    'playback.getPublic': () => ({ revision: 1, start: 0, total: 0, queue: [] })
  });
  const tracks = [{ ...grant, metadata: '', resources: [{ uri: grant.uri }] }];
  const replace = () => f.send('player', { action: 'replace', tracks });
  await replace();
  assert.equal(f.response().status, 200);
  assert.equal(f.calls.find(call => call.name === 'upnp.http').args.url, origin + '/pwa/v1/grant/' + token);
  text = JSON.stringify({ audience: 'player', target: { ...target, playerId: 'other' } });
  await replace();
  assert.deepEqual(f.response().body, { error: { code: 'forbidden' } });
  text = 'invalid JSON';
  await replace();
  assert.deepEqual(f.response().body, { error: { code: 'unavailable' } });
  assert.equal(f.calls.filter(call => call.name === 'playback.queue.begin').length, 1);
});

test('remote Play Next inserts and selects in shuffled playback order', async () => {
  const queue = [3, 1, 2].map(id => ({ id, title: String(id) }));
  const f = fixture({}, {
    'playback.getPublic': () => ({ revision: 1, start: 0, total: queue.length, queue, shuffle: true, currentId: 3 }),
    'upnp.http': () => ({ status: 200, text: JSON.stringify({ audience: 'player', target: { hostId: 'host', playerId: 'phone' } }) }),
    'playback.insert': () => ({}), 'playback.select': () => ({}), 'playback.play': () => ({})
  });
  const track = { ...grant, metadata: '', resources: [{ uri: grant.uri }] };
  await f.send('player', { action: 'insert', position: 'afterCurrent', play: true, startIndex: 1, tracks: [track, track] });
  assert.equal(f.response().status, 200);
  assert.deepEqual(f.calls.filter(({ name }) => ['playback.insert', 'playback.select'].includes(name))
    .map(({ name, args }) => [name, args.index, args.transportOrder]), [['playback.insert', 1, true], ['playback.select', 2, true]]);
});

test('a failed mutation returns 409 with refreshed playback without retrying', async () => {
  const f = fixture({}, { 'pwa.playerControl': () => { throw Object.assign(new Error(), { code: 'unavailable' }); },
    'playback.getPublic': () => ({ revision: 1, start: 0, total: 0, queue: [] }) });
  await f.send('player', { action: 'play' });
  assert.equal(f.response().status, 409);
  assert.equal(f.response().body.outcome, 'unknown');
  assert.equal(f.response().body.playback.playerId, 'phone');
  assert.equal(f.calls.filter(call => call.name === 'pwa.playerControl').length, 1);
  const uri = origin + '/media/' + token;
  const track = { uri, title: '音'.repeat(7000), metadata: '', resources: [{ uri }] };
  const batches = [];
  const queue = fixture({}, { 'playback.queue.begin': () => ({}), 'playback.queue.commit': () => ({}),
    'playback.queue.append': args => { batches.push(args); return {}; },
    'playback.getPublic': () => ({ revision: 2, start: 0, total: 0, queue: [] }) });
  await queue.send('player', { action: 'replace', tracks: Array(60).fill(track) });
  assert.equal(queue.response().status, 200);
  assert.ok(batches.length > 1);
  assert.equal(batches.flatMap(batch => batch.items).length, 60);
  assert.ok(batches.every(batch => Buffer.byteLength(JSON.stringify(batch)) < 1024 * 1024));
});

test('PWA gateways resolve both external sources and verify the destination before sending tracks', async t => {
  const lan = 'http://192.168.1.2:51999';
  const sink = 'http-get:*:audio/mpeg:*';
  const flac = 'http-get:*:audio/flac:*';
  const upstream = 'http://192.168.1.9:8200/private?u=user&t=secret';
  const permissions = { libraries: true, players: true };
  const grants = new Map(), sent = [];
  const state = { libraries: ['upnp', 'subsonic:test'].map(id => ({ id, available: true })),
    players: [{ id: 'renderer', available: true }] };
  const source = fixture({ gatewayPermissions: permissions, networkMusicGetState: async () => state,
    sources: new Map([['subsonic:test', {}]]), discovery: { devices: new Map([
      ['upnp', { address: '192.168.1.9' }], ['renderer', { address: '192.168.1.8' }]]) },
    networkMusicResolveTrack: async ({ serverId, localPlayback }) => {
      const saved = serverId.startsWith('subsonic:');
      assert.equal(localPlayback, saved);
      return { id: 'song', playable: true, uri: upstream, artwork: 'http://192.168.1.9/cover?id=art',
        resources: [{ uri: upstream, protocolInfo: flac }, ...(saved ? [] : [{ uri: upstream, protocolInfo: sink }])],
        ...(saved && { transcodedResource: { format: 'mp3', protocolInfo: sink } }) };
    },
    playerCommand: async request => { sent.push(request); return { queue: [] }; } }, {
    'share.status': () => ({ id: 'host', enabled: false }),
    'pwa.issueGrant': ({ serverId, audience, target, player }) => {
      assert.equal(audience, 'player');
      assert.equal(player.protocolInfo, sink);
      assert.equal(player.address, player.hostId === 'host' ? '192.168.1.8' : undefined);
      assert.deepEqual(target, serverId === 'upnp'
        ? { uri: upstream, artwork: 'http://192.168.1.9/cover?id=art', address: '192.168.1.9' }
        : { coverArtId: 'art', format: 'mp3' });
      const uri = lan + '/pwa/v1/media/' + String(grants.size + 1).padStart(48, '0');
      grants.set(uri.replace('/media/', '/grant/'), { audience, target: player });
      return { uri, artwork: uri.replace('/media/', '/artwork/') };
    },
    'upnp.http': ({ url }) => ({ status: grants.has(url) ? 200 : 404, text: JSON.stringify(grants.get(url) || {}) })
  });
  t.after(source.stop);
  const { PwaNetworkHost } = (await import('../../electron/pwa-network-host.cjs')).default;
  const { EventEmitter } = await import('node:events');
  const desktop = new PwaNetworkHost({ remote: { token: 'test', listening: true }, player: { id: 'desktop-player' },
    music: Object.assign(new EventEmitter(), { id: 'peer', sources: new Map(), discovery: { devices: new Map() } }) });
  t.after(() => desktop.dispose());
  t.mock.method(globalThis, 'fetch', async url => ({ ok: grants.has(url), text: async () => JSON.stringify(grants.get(url) || {}) }));
  let last;
  for (const serverId of ['upnp', 'subsonic:test']) {
    for (const hostId of ['host', 'peer']) {
      const target = { hostId, playerId: 'renderer', protocolInfo: sink, address: '192.168.1.99', uri: upstream };
      await source.send('resolve', { audience: 'player', serverId, trackId: 'song', target });
      assert.equal(source.response().status, 200);
      const track = source.response().body;
      assert.equal(track.resources.length, 1);
      assert.equal(track.resources[0].protocolInfo, sink);
      assert.equal(track.resources[0].uri, track.uri);
      assert.doesNotMatch(JSON.stringify(track), /private|secret|192\.168\.1\.9/);
      if (serverId.startsWith('subsonic:')) assert.equal(track.quality, 'transcoded');
      if (hostId === 'host') {
        await source.send('player', { playerId: 'renderer', action: 'replace', tracks: [track] });
        assert.equal(source.response().status, 200);
        assert.equal(sent.at(-1).tracks[0].uri, track.uri);
        last = track;
      } else {
        assert.equal((await desktop.validatePlayerTrack(track, 'renderer')).uri, track.uri);
        await source.send('player', { playerId: 'renderer', action: 'replace', tracks: [track] });
        assert.equal(source.response().status, 403);
      }
    }
  }
  // A signed track issued by the desktop follows the same Android external-player command.
  const peerTrack = desktop.issueGatewayTrack({ serverId: 'peer', trackId: 'peer-song', audience: 'player',
    target: { hostId: 'host', playerId: 'renderer' } }, { id: 'peer-song', resources: [{ uri: upstream, protocolInfo: sink }] },
    { headers: { host: '192.168.1.3:47300' } });
  const peerGrant = desktop.readGatewayGrant(new URL(peerTrack.uri).pathname.split('/').pop());
  grants.set(peerTrack.uri.replace('/media/', '/grant/'), { audience: peerGrant.audience, target: peerGrant.target });
  await source.send('player', { playerId: 'renderer', action: 'replace', tracks: [peerTrack] });
  assert.equal(source.response().status, 200);
  assert.equal(sent.at(-1).tracks[0].uri, peerTrack.uri);
  const count = sent.length;
  permissions.players = false;
  await source.send('player', { playerId: 'renderer', action: 'replace', tracks: [last] });
  assert.equal(source.response().status, 403);
  permissions.players = true;
  grants.clear(); // The issuing service invalidates its generation when permissions change.
  await source.send('player', { playerId: 'renderer', action: 'replace', tracks: [last] });
  assert.equal(source.response().status, 403);
  assert.equal(sent.length, count);
  const resolveTrack = source.music.networkMusicResolveTrack;
  source.music.networkMusicResolveTrack = async args => {
    const track = await resolveTrack(args);
    source.music.gatewayPermissions = { libraries: false, players: true };
    return track;
  };
  await source.send('resolve', { serverId: 'upnp', trackId: 'song', audience: 'player',
    target: { hostId: 'peer', playerId: 'renderer', protocolInfo: sink } });
  assert.equal(source.response().status, 403);
  assert.equal(grants.size, 0);
});

test('queue artwork for a known renderer uses the browser grant on the paired origin', async () => {
  const lan = 'http://192.168.1.2:51000';
  const track = { id: 1, uri: lan + '/pwa/v1/media/' + token, artwork: lan + '/pwa/v1/artwork/' + token };
  const f = fixture({ gatewayPermissions: { players: true }, getPlayerState: async () => ({ queue: [track] }),
    networkMusicGetState: async () => ({ players: [{ id: 'renderer', available: true }] }) }, {
    'pwa.issueGrant': args => {
      assert.deepEqual(args, { audience: 'browser', origin: lan, playerArtworkToken: token, playerId: 'renderer', requestId: 'r1' });
      return grant;
    }
  });
  await f.send('player', { playerId: 'renderer' }, { method: 'GET' });
  assert.equal(f.response().body.queue[0].artwork, grant.artwork);
});
