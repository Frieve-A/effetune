'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { NetworkMusicHost } = require('../../electron/network-music-host.cjs');
const { Discovery, parseXml, service } = require('../../electron/network-music-upnp.cjs');
const { SubsonicSource } = require('../../electron/subsonic-source.cjs');

function fixture() {
  const discovery = new EventEmitter(); discovery.devices = new Map(); discovery.close = () => {};
  const device = { id: 'uuid:av', address: '192.168.1.8', name: 'Renderer', available: true, services: new Map(['AVTransport', 'RenderingControl', 'ConnectionManager'].map(name => [`urn:schemas-upnp-org:service:${name}`, { type: `urn:schemas-upnp-org:service:${name}:1` }])) };
  discovery.devices.set(device.id, device);
  const state = { uri: '', transport: 'STOPPED', elapsed: '0:00:00', duration: '0:00:10', volume: 40, mute: false };
  const calls = [];
  let config = { networkMusicDeviceId: 'uuid:local' };
  const host = new NetworkMusicHost({ getCatalog: async () => null, loadConfig: () => config, saveConfig: next => { config = next; }, discovery, gateway: { close: async () => {} }, getRouteAddress: async () => '192.168.1.5', invoke: async (endpoint, action, args = {}) => {
    calls.push({ action, args });
    switch (action) {
      case 'GetTransportInfo': return { CurrentTransportState: state.transport, CurrentTransportStatus: 'OK' };
      case 'GetPositionInfo': return { TrackURI: state.uri, TrackDuration: state.duration, RelTime: state.elapsed };
      case 'GetMediaInfo': return { CurrentURI: state.uri };
      case 'GetCurrentTransportActions': return { Actions: state.actions ?? 'Play,Pause,Stop,Seek' };
      case 'GetProtocolInfo': return { Sink: 'http-get:*:audio/flac:*' };
      case 'GetVolume': return { CurrentVolume: state.volume };
      case 'GetMute': return { CurrentMute: Number(state.mute) };
      case 'SetVolume': state.volume = args.DesiredVolume; break;
      case 'SetMute': state.mute = Boolean(args.DesiredMute); break;
      case 'SetAVTransportURI': state.uri = args.CurrentURI; state.elapsed = '0:00:00'; await state.afterSetUri?.(); break;
      case 'Play': state.transport = 'PLAYING'; break;
      case 'Pause': state.transport = 'PAUSED_PLAYBACK'; break;
      case 'Stop': state.transport = 'STOPPED'; break;
      default: break;
    }
    return {};
  } });
  host.resolveTrack = async item => ({ ...item, title: item.trackId, uri: `http://192.168.1.9/${item.trackId}.flac`, resources: [{ uri: `http://192.168.1.9/${item.trackId}.flac`, protocolInfo: 'http-get:*:audio/flac:*' }], metadata: '' });
  return { host, discovery, device, state, calls, playerId: device.id };
}
const tracks = [{ serverId: 'source', trackId: 'one' }, { serverId: 'source', trackId: 'two' }];

function waitFor(check) {
  return new Promise((resolve, reject) => {
    const guard = setTimeout(() => { clearInterval(poll); reject(new Error('Expected autonomous player action did not arrive')); }, 10000);
    const poll = setInterval(() => {
      if (check()) { clearInterval(poll); clearTimeout(guard); resolve(); }
    }, 10);
  });
}

test('AVTransport-only descriptions are discovered and manual descriptions retain same-host service checks', async () => {
  const discovery = new Discovery({ fetchXml: async () => Object.assign(parseXml('<root><device><UDN>uuid:av</UDN><friendlyName>Renderer</friendlyName><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/av</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>http://other.example/volume</controlURL></service></serviceList></device></root>'), { connectionAddress: '192.168.1.8' }) });
  const result = await discovery.register('http://renderer.example/device.xml');
  assert.equal(result[0].id, 'uuid:av'); assert.ok(service(result[0], 'AVTransport')); assert.equal(service(result[0], 'RenderingControl'), undefined);
  discovery.close();
});

test('host queue hands off original media and advances once only on confirmed natural completion', async t => {
  const f = fixture(); t.after(() => f.host.dispose());
  assert.equal((await f.host.getState()).players[0].id, f.playerId);
  const started = await f.host.playerCommand({ playerId: f.playerId, action: 'replace', items: tracks, play: true });
  assert.equal(started.queue.length, 2); assert.equal(started.queueOwner, 'host'); assert.equal(f.state.uri, 'http://192.168.1.9/one.flac');
  f.state.transport = 'STOPPED'; f.state.elapsed = '0:00:10';
  await Promise.all([f.host.getPlayerState({ playerId: f.playerId }), f.host.getPlayerState({ playerId: f.playerId })]);
  await f.host.queues.get(f.playerId);
  assert.equal(f.state.uri, 'http://192.168.1.9/two.flac');
  assert.equal(f.calls.filter(call => call.action === 'SetAVTransportURI').length, 2);
  await f.host.playerCommand({ playerId: f.playerId, action: 'stop' });
  f.state.elapsed = '0:00:10'; await f.host.getPlayerState({ playerId: f.playerId });
  assert.equal(f.calls.filter(call => call.action === 'SetAVTransportURI').length, 2);
  await f.host.playerCommand({ playerId: f.playerId, action: 'volume', value: 25 });
  await f.host.playerCommand({ playerId: f.playerId, action: 'mute', value: true });
  const muted = await f.host.getPlayerState({ playerId: f.playerId }); assert.equal(muted.volume, 25); assert.equal(muted.mute, true);
});

test('AV polling continues and completes the queue after the initiating UI closes without further player reads', { timeout: 20000 }, async t => {
  const f = fixture(); t.after(() => f.host.dispose());
  let current = true;
  await f.host.playerCommand({ playerId: f.playerId, action: 'replace', items: tracks, play: true, isCurrent: () => current });
  current = false;
  f.state.transport = 'STOPPED'; f.state.elapsed = '0:00:10';
  await waitFor(() => f.calls.filter(call => call.action === 'Play').length === 2);
  assert.equal(f.state.uri, 'http://192.168.1.9/two.flac');
  assert.deepEqual(f.calls.filter(call => call.action === 'SetAVTransportURI').map(call => call.args.CurrentURI), [
    'http://192.168.1.9/one.flac', 'http://192.168.1.9/two.flac'
  ]);
  f.state.transport = 'STOPPED'; f.state.elapsed = '0:00:10';
  const reads = f.calls.filter(call => call.action === 'GetTransportInfo').length;
  await waitFor(() => f.calls.filter(call => call.action === 'GetTransportInfo').length >= reads + 2);
  assert.equal(f.state.transport, 'STOPPED');
  assert.equal(f.calls.filter(call => call.action === 'Play').length, 2, 'The completed queue must not restart');
});

test('autonomous AV polling releases continuation on revocation, disconnection or a diagnosed transport failure', async t => {
  for (const reason of ['revocation', 'disconnection', 'read failure', 'handoff failure']) {
    await t.test(reason, { timeout: 20000 }, async t => {
      const f = fixture(); t.after(() => f.host.dispose());
      const diagnostics = []; f.host.onDiagnostic = error => diagnostics.push(error);
      let authorized = true; let failureActive = false;
      const failure = new Error(`Renderer ${reason}`);
      const invoke = f.host.invoke;
      f.host.invoke = (endpoint, action, args, isCurrent) => {
        if (failureActive && action === (reason === 'handoff failure' ? 'SetAVTransportURI' : 'GetTransportInfo')) {
          f.calls.push({ action, args }); return Promise.reject(failure);
        }
        return invoke(endpoint, action, args, isCurrent);
      };
      await f.host.playerCommand({ playerId: f.playerId, action: 'replace', items: tracks, play: true, isAuthorized: () => authorized });
      const before = f.calls.length;
      if (reason === 'revocation') authorized = false;
      else if (reason === 'disconnection') f.device.available = false;
      else failureActive = true;
      f.state.transport = 'STOPPED'; f.state.elapsed = '0:00:10';
      if (failureActive) await waitFor(() => diagnostics.length > 0);
      else await delay(2100);
      assert.deepEqual(diagnostics, failureActive ? [failure] : []);
      if (!failureActive) assert.equal(f.calls.length, before, 'Revoked or unavailable targets must not receive polling requests');
      assert.equal(f.calls.filter(call => call.action === 'SetAVTransportURI').length, reason === 'handoff failure' ? 2 : 1);
      const after = f.calls.length;
      authorized = true; f.device.available = true; failureActive = false;
      await delay(2100);
      assert.equal(f.calls.length, after, 'Recovery must not restart polling or the discarded queue');
      assert.equal(f.state.uri, 'http://192.168.1.9/one.flac');
    });
  }
});

test('AV queue selection and deletion preserve occurrence IDs while seeking sends the requested time', async t => {
  const f = fixture(); t.after(() => f.host.dispose());
  f.state.duration = '0:03:00';
  const started = await f.host.playerCommand({ playerId: f.playerId, action: 'replace', items: [...tracks, tracks[0]], play: true });
  const [first, second, third] = started.queue;
  const selected = await f.host.playerCommand({ playerId: f.playerId, action: 'seekId', id: third.id });
  assert.equal(selected.currentId, third.id);
  await f.host.playerCommand({ playerId: f.playerId, action: 'seek', seconds: 65 });
  assert.deepEqual(f.calls.find(call => call.action === 'Seek').args, { InstanceID: 0, Unit: 'REL_TIME', Target: '0:01:05' });
  const pruned = await f.host.playerCommand({ playerId: f.playerId, action: 'delete', id: first.id });
  assert.deepEqual(pruned.queue.map(track => track.id), [second.id, third.id]);
  assert.equal(pruned.currentId, third.id, 'Deleting an earlier occurrence must preserve the active occurrence');
  assert.equal(f.calls.filter(call => call.action === 'SetAVTransportURI').length, 2);
  const replaced = await f.host.playerCommand({ playerId: f.playerId, action: 'delete', id: third.id });
  assert.equal(replaced.currentId, second.id);
  assert.equal(f.state.uri, 'http://192.168.1.9/two.flac');
  const empty = await f.host.playerCommand({ playerId: f.playerId, action: 'delete', id: second.id });
  assert.equal(empty.queueOwner, 'device');
  assert.equal(empty.capabilities.next, false);
  assert.equal(f.state.transport, 'STOPPED');
});

test('optional AV service read failures keep Play and Stop usable without advertising unavailable controls', async t => {
  const f = fixture(); t.after(() => f.host.dispose());
  const optional = new Set(['GetCurrentTransportActions', 'GetProtocolInfo', 'GetVolume', 'GetMute']);
  const invoke = f.host.invoke;
  f.host.invoke = (endpoint, action, args, isCurrent) => optional.has(action)
    ? Promise.reject(Object.assign(new Error('Action not supported by this renderer'), { upnpCode: '401' }))
    : invoke(endpoint, action, args, isCurrent);
  const started = await f.host.playerCommand({ playerId: f.playerId, action: 'replace', items: tracks, play: true });
  assert.equal(started.transportState, 'Playing');
  assert.equal(started.queueOwner, 'host');
  assert.equal(started.protocolInfo, '');
  assert.equal(started.volume, null); assert.equal(started.mute, null);
  for (const action of ['play', 'stop']) assert.equal(started.capabilities[action], true);
  for (const action of ['pause', 'seek', 'volume', 'mute']) assert.equal(started.capabilities[action], false);
  await assert.rejects(f.host.playerCommand({ playerId: f.playerId, action: 'pause' }), { code: 'unsupported' });
  await f.host.playerCommand({ playerId: f.playerId, action: 'stop' });
  const resumed = await f.host.playerCommand({ playerId: f.playerId, action: 'play' });
  assert.equal(resumed.transportState, 'Playing');
  assert.equal(f.calls.some(call => call.action === 'Pause'), false);
});

test('external URI replacement, unavailable devices and cancelled preflight never resend a queue', async t => {
  const f = fixture(); t.after(() => f.host.dispose());
  await f.host.playerCommand({ playerId: f.playerId, action: 'replace', items: tracks, play: true });
  f.state.uri = 'http://192.168.1.9/another.flac';
  const external = await f.host.getPlayerState({ playerId: f.playerId });
  assert.equal(external.queueOwner, 'device'); assert.equal(external.queue.length, 1); assert.equal(external.capabilities.next, false);
  const before = f.calls.filter(call => call.action === 'SetAVTransportURI').length;
  await assert.rejects(f.host.playerCommand({ playerId: f.playerId, action: 'replace', items: tracks, play: true, isCurrent: () => false }), { code: 'unauthorized' });
  assert.equal(f.calls.filter(call => call.action === 'SetAVTransportURI').length, before);
  f.device.available = false; await assert.rejects(f.host.getPlayerState({ playerId: f.playerId }), { code: 'unavailable' });
  f.device.available = true; await f.host.getPlayerState({ playerId: f.playerId });
  assert.equal(f.calls.filter(call => call.action === 'SetAVTransportURI').length, before);
});

test('missing RenderingControl never advertises volume or mute and nonterminal stopped state does not advance', async t => {
  const f = fixture(); t.after(() => f.host.dispose());
  f.device.services.delete('urn:schemas-upnp-org:service:RenderingControl');
  await f.host.playerCommand({ playerId: f.playerId, action: 'replace', items: tracks, play: true });
  f.state.transport = 'STOPPED'; f.state.elapsed = '0:00:02';
  const state = await f.host.getPlayerState({ playerId: f.playerId });
  assert.equal(state.capabilities.volume, false); assert.equal(state.capabilities.mute, false);
  assert.equal(f.state.uri, 'http://192.168.1.9/one.flac');
  await assert.rejects(f.host.playerCommand({ playerId: f.playerId, action: 'mute', value: true }), { code: 'unsupported' });
});

test('AV queue revocation removes automatic continuation while a changed selection leaves authorized playback running', async t => {
  for (const revoke of [true, false]) {
    const f = fixture(); t.after(() => f.host.dispose());
    let authorized = true; let current = true;
    await f.host.playerCommand({ playerId: f.playerId, action: 'replace', items: tracks, play: true,
      isCurrent: () => current, isAuthorized: () => authorized });
    current = false;
    if (revoke) authorized = false;
    f.state.transport = 'STOPPED'; f.state.elapsed = '0:00:10';
    const observed = await f.host.getPlayerState({ playerId: f.playerId });
    await f.host.queues.get(f.playerId);
    assert.equal(f.calls.filter(call => call.action === 'SetAVTransportURI').length, revoke ? 1 : 2);
    assert.equal(observed.queueOwner, revoke ? 'device' : 'host');
    assert.equal(f.host.avPlayers.owners.has(f.playerId), !revoke);
  }
});

test('AV queue authorization is checked again after URI handoff before sending Play', async t => {
  const f = fixture(); t.after(() => f.host.dispose());
  let authorized = true;
  f.state.afterSetUri = () => { authorized = false; };
  await assert.rejects(f.host.playerCommand({ playerId: f.playerId, action: 'replace', items: tracks, play: true,
    isAuthorized: () => authorized }), { code: 'unauthorized' });
  assert.equal(f.calls.filter(call => call.action === 'SetAVTransportURI').length, 1);
  assert.equal(f.calls.filter(call => call.action === 'Play').length, 0);
  await f.host.getPlayerState({ playerId: f.playerId });
  assert.equal(f.host.avPlayers.owners.has(f.playerId), false);
});

test('an unsent AV host queue exposes Play and starts even when an empty renderer advertises no actions', async t => {
  for (const action of ['replace', 'insert']) {
    const f = fixture(); t.after(() => f.host.dispose()); f.state.actions = '';
    const queued = await f.host.playerCommand({ playerId: f.playerId, action, items: tracks, play: false });
    assert.equal(queued.capabilities.play, true);
    assert.equal(f.calls.filter(call => call.action === 'SetAVTransportURI').length, 0);
    await f.host.playerCommand({ playerId: f.playerId, action: 'play' });
    assert.deepEqual(f.calls.filter(call => ['SetAVTransportURI', 'Play'].includes(call.action)).map(call => call.action), ['SetAVTransportURI', 'Play']);
    assert.equal(f.state.uri, 'http://192.168.1.9/one.flac');
  }
});

test('Subsonic source routing hides credentials, selects only an offered compatible conversion and revokes removed resources', async t => {
  const f = fixture(); t.after(() => f.host.dispose());
  const source = new SubsonicSource({ id: 'subsonic:fixture', name: 'Server', url: 'https://music.example/', user: 'listener', password: 'private-password' }, { fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ 'subsonic-response': { status: 'ok', song: { id: 'song', title: 'Song', contentType: 'audio/flac', coverArt: 'cover', transcodedContentType: 'audio/mpeg', transcodedSuffix: 'mp3', duration: 10 } } }) }) });
  f.host.sources.set(source.config.id, source);
  f.host.fileServer.start = async () => { f.host.fileServer.enabled = true; f.host.fileServer.port = 12345; };
  f.host.fileServer.close = async () => f.host.fileServer.revoke();
  const resolver = NetworkMusicHost.prototype.resolveTrack.bind(f.host);
  const original = await resolver({ serverId: source.config.id, trackId: 'song', localPlayback: true });
  assert.equal(original.quality, 'original'); assert.match(original.uri, /^http:\/\/127\.0\.0\.1:12345\/openhome-media\//);
  assert.equal(JSON.stringify(original).includes('private-password'), false); assert.equal(JSON.stringify(original).includes('?u='), false);
  const converted = await resolver({ serverId: source.config.id, trackId: 'song', address: '192.168.1.5', protocolInfo: 'http-get:*:audio/mpeg:*' });
  assert.equal(converted.quality, 'transcoded'); assert.equal(converted.resources[0].protocolInfo, 'http-get:*:audio/mpeg:*');
  assert.equal(converted.seekable, false);
  assert.ok((await f.host.getState()).sources.every(item => !Object.hasOwn(item, 'password')));
  const request = async (uri, method = 'GET', remoteAddress = '127.0.0.1') => {
    const result = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      writeHead(status, headers = {}) { this.status = status; for (const [name, value] of Object.entries(headers)) this.setHeader(name, value); },
      end() {} };
    await f.host.fileServer.handle({ url: new URL(uri).pathname, method, headers: { range: 'bytes=0-9' }, socket: { remoteAddress } }, result);
    return result;
  };
  f.host.fileServer.serveResource = async (req, res, uid, kind, isCurrent) => {
    assert.equal(isCurrent(), true);
    assert.equal(kind, 'media');
    const upstream = await f.host.fileSources.get(uid).resource(kind);
    assert.equal(new URL(upstream.uri).pathname, '/rest/stream.view');
    assert.equal(new URL(upstream.uri).searchParams.get('u'), 'listener');
    res.writeHead(206, { 'Content-Range': 'bytes 0-9/100' }); res.end();
  };
  const media = await request(original.uri);
  assert.equal(media.status, 206);
  assert.equal(media.headers['access-control-allow-origin'], '*');
  assert.match(media.headers['access-control-expose-headers'], /Content-Range/);
  const preflight = await request(original.uri, 'OPTIONS');
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-headers'], 'Range');
  assert.equal((await request(original.uri, 'GET', '192.168.1.8')).status, 403);
  await f.host.configure({ subsonic: { action: 'remove', id: source.config.id } });
  assert.equal(source.closed, true); assert.equal(f.host.fileSources.size, 0); assert.equal(f.host.fileServer.tokens.size, 0);
  assert.equal((await request(original.uri)).status, 404);
});
