'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Readable, Writable } = require('node:stream');
const { Discovery, CONTENT, PLAYLIST, parseXml, parseDidl, didl, didlItem, xml, service } = require('../../electron/network-music-upnp.cjs');
const { MusicServer, byteRange, scpd } = require('../../electron/network-music-server.cjs');
const { NetworkMusicHost, registerNetworkMusicIpc, supportsProtocol } = require('../../electron/network-music-host.cjs');
const { LibraryCatalogHost } = require('../../electron/library-catalog-host.cjs');
const fileAccess = require('../../electron/file-access.cjs');

class FakeDiscovery extends EventEmitter {
  constructor() { super(); this.devices = new Map(); this.starts = 0; }
  async start() { this.starts++; }
  search() {}
  close() {}
}
function device(id, kind, extra = {}) {
  return { id, name: 'Same name', available: true, address: '192.168.1.5', services: new Map([[kind === 'Playlist' ? 'urn:av-openhome-org:service:Playlist' : 'urn:schemas-upnp-org:service:ContentDirectory', { type: kind === 'Playlist' ? PLAYLIST : CONTENT, control: `http://192.168.1.5/${id}` }]]), ...extra };
}
function fixture(options = {}) {
  const discovery = new FakeDiscovery(); let config = { networkMusicDeviceId: 'uuid:local', networkMusicSharing: { enabled: true, folderIds: ['shared'] } };
  const repository = { listScanFolders: async () => ({ folders: [{ id: 'shared', displayName: 'Shared' }, { id: 'private', displayName: 'Private' }] }), getTrack: async uid => ({ trackUid: uid, title: uid, durationSec: 65 }), getTrackStorageIdentity: async () => ({ folderId: 'shared', relativePath: 'track.flac', sourceKind: 'file' }) };
  const runtime = { resolvePlaybackSource: async uid => ({ path: 'D:\\Music\\song.flac', trackUid: uid, folderId: uid === 'private-track' ? 'private' : 'shared', sourceKind: uid === 'cue' ? 'cue-track' : 'file' }), requestArtwork: async () => ({ bytes: new Uint8Array([1, 2]), mimeType: 'image/jpeg' }) };
  const gateway = { register: async uri => ({ playbackUrl: `http://127.0.0.1:1234/proxy?source=${encodeURIComponent(uri)}` }), close: async () => {} };
  const host = new NetworkMusicHost({ getCatalog: async () => ({ repository, runtime }), loadConfig: () => config, saveConfig: next => { config = next; }, discovery, gateway, getRouteAddress: async () => '192.168.1.9', ...options });
  host.server.enabled = true; host.server.port = 4567;
  return { host, discovery, repository, runtime, getConfig: () => config };
}

test('XML and DIDL preserve escaped metadata and reject external entity definitions', () => {
  const title = 'A & <B> "title"';
  const metadata = didl([didlItem({ id: '1', title, artist: 'Artist', uri: 'http://192.168.1.2/a?x=1&y=2' })]);
  const [item] = parseDidl(metadata);
  assert.equal(item.title, title);
  assert.equal(item.resources[0].uri, 'http://192.168.1.2/a?x=1&y=2');
  assert.throws(() => parseXml('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///secret">]><x>&secret;</x>'));
  assert.throws(() => parseXml('<root><x></root>'));
  assert.equal(parseXml('<x><![CDATA[A < B]]></x>').children[0].text, 'A < B');
  assert.ok(parseXml(scpd('ContentDirectory')));
  assert.ok(parseXml(scpd('ConnectionManager')));
});

test('XML consumes attributes and markup in order and rejects malformed long input', () => {
  const node = parseXml(`<?xml version="1.0"?><root a="A > B" b='C &amp; D'><!--ignored--><x/></root>`).children[0];
  assert.deepEqual({ ...node.attrs }, { a: 'A > B', b: 'C & D' });
  assert.equal(node.children[0].name, 'x');
  for (const malformed of [
    '<root ' + 'a'.repeat(32768) + '/>',
    '<root ' + 'a'.repeat(32768) + '="unterminated/>',
    '<root a="1"b="2"/>', '<root a "1"/>', '<root a="<"/>',
    '<root/> <', '<root><!--unterminated</root>', '<root><![CDATA[unterminated</root>',
    '<root><?unterminated</root>', '<root></root extra>', '<'.repeat(32768)
  ]) assert.throws(() => parseXml(malformed), /Invalid device response/);
});

test('SSDP discovery uses stable UDNs, same-host services, and byebye availability', async () => {
  let requests = 0;
  const discovery = new Discovery({ fetchXml: async () => {
    requests++;
    return parseXml(`<root><URLBase>http://192.168.1.5:1234/base/</URLBase><device><UDN>uuid:one</UDN><friendlyName>Room</friendlyName><serviceList><service><serviceType>${CONTENT}</serviceType><controlURL>control</controlURL></service></serviceList></device><device><UDN>uuid:two</UDN><friendlyName>Room</friendlyName><serviceList><service><serviceType>${PLAYLIST}</serviceType><controlURL>/playlist</controlURL></service></serviceList></device></root>`);
  } });
  const packet = Buffer.from('HTTP/1.1 200 OK\r\nUSN: uuid:one::upnp:rootdevice\r\nLOCATION: http://192.168.1.5:1234/device.xml\r\nCACHE-CONTROL: max-age=100\r\n\r\n');
  await discovery.receive(packet, { address: '192.168.1.5' });
  assert.equal(discovery.devices.size, 2);
  assert.equal(service(discovery.devices.get('uuid:one'), 'ContentDirectory').control, 'http://192.168.1.5:1234/base/control');
  await discovery.receive(packet, { address: '192.168.1.5' });
  assert.equal(requests, 1);
  await discovery.receive(Buffer.from('NOTIFY * HTTP/1.1\r\nUSN: uuid:two\r\nNTS: ssdp:byebye\r\n\r\n'), { address: '192.168.1.5' });
  assert.equal(discovery.devices.get('uuid:two').available, false);
  await discovery.receive(packet, { address: '192.168.1.6' });
  assert.equal(requests, 1, 'A LAN advertisement cannot redirect description requests to a different host');
});

test('the shared SSDP advertiser preserves MediaServer targets and stops answering when sharing stops', async t => {
  t.mock.method(os, 'networkInterfaces', () => ({ test: [{ family: 'IPv4', internal: false, address: '192.168.1.9' }] }));
  const discovery = new Discovery();
  const packets = [];
  discovery.socket = { setMulticastInterface() {}, send: (bytes, port, address, callback) => { packets.push({ text: bytes.toString(), port, address }); callback?.(); } };
  const server = new MusicServer({ id: 'uuid:library', name: 'Library', discovery });
  t.after(() => server.advertisement.dispose());
  server.enabled = true; server.port = 48882; server.advertisement.start();
  await discovery.multicastSending;
  assert.equal(packets.length, 5);
  assert.ok(packets.every(packet => packet.text.includes('LOCATION: http://192.168.1.9:48882/device.xml') && packet.text.includes('NTS: ssdp:alive')));
  const search = { firstLine: 'M-SEARCH * HTTP/1.1', headers: { man: '"ssdp:discover"', st: CONTENT }, remote: { address: '192.168.1.5', port: 48883 } };
  discovery.emit('packet', search);
  assert.equal(packets.length, 6);
  assert.equal(packets.at(-1).port, 48883);
  assert.ok(packets.at(-1).text.includes(`ST: ${CONTENT}`));
  server.advertisement.stop(); server.enabled = false;
  await discovery.multicastSending;
  assert.equal(packets.filter(packet => packet.text.includes('NTS: ssdp:byebye')).length, 5);
  discovery.emit('packet', search);
  assert.equal(packets.length, 11);
});

test('overlapping SSDP announcements and searches keep each delayed send on its selected interface', async t => {
  const addresses = ['192.168.1.9', '172.20.0.1'];
  t.mock.method(os, 'networkInterfaces', () => ({ test: addresses.map(address => ({ family: 'IPv4', internal: false, address })) }));
  const discovery = new Discovery();
  const packets = [];
  let selected;
  discovery.socket = {
    setMulticastInterface(address) { selected = address; },
    send(bytes, _port, _target, callback) {
      const requested = selected;
      queueMicrotask(() => { packets.push({ requested, actual: selected, text: bytes.toString() }); callback?.(); });
    }
  };
  const server = new MusicServer({ id: 'uuid:library', name: 'Library', discovery });
  t.after(() => server.advertisement.dispose());
  server.enabled = true; server.port = 48882;
  server.advertisement.start();
  discovery.search();
  server.advertisement.announce('ssdp:alive');
  discovery.search();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(packets.length, 24);
  assert.ok(packets.every(packet => packet.requested === packet.actual));
  for (const address of addresses) {
    assert.equal(packets.filter(packet => packet.actual === address).length, 12);
    assert.ok(packets.filter(packet => packet.actual === address && packet.text.startsWith('NOTIFY'))
      .every(packet => packet.text.includes(`LOCATION: http://${address}:48882/device.xml`)));
  }
});

test('SSDP send errors release the next interface and closing discards queued sends', async t => {
  t.mock.method(os, 'networkInterfaces', () => ({ test: ['192.168.1.9', '172.20.0.1'].map(address => ({ family: 'IPv4', internal: false, address })) }));
  const discovery = new Discovery();
  const sends = []; const errors = [];
  let selected; let closed = false;
  discovery.on('diagnostic', error => errors.push(error));
  discovery.socket = {
    setMulticastInterface(address) { selected = address; },
    send(_bytes, _port, _target, callback) { sends.push({ address: selected, callback }); },
    close() { closed = true; }
  };
  discovery.search();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sends.length, 1);
  const error = new Error('Fixture send failure');
  sends[0].callback(error);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sends.map(send => send.address), ['192.168.1.9', '172.20.0.1']);
  assert.deepEqual(errors, [error]);
  discovery.search();
  discovery.close();
  assert.equal(discovery.socket, null);
  const restarted = [];
  discovery.socket = {
    setMulticastInterface(address) { selected = address; },
    send(_bytes, _port, _target, callback) { restarted.push(selected); callback(); },
    close() {}
  };
  discovery.search();
  sends[1].callback();
  await discovery.multicastSending;
  assert.equal(closed, true);
  assert.equal(sends.length, 2);
  assert.deepEqual(restarted, ['192.168.1.9', '172.20.0.1']);
  discovery.close();
});

test('network music disposal waits for its queued byebye before closing the discovery socket', async t => {
  t.mock.method(os, 'networkInterfaces', () => ({ test: [{ family: 'IPv4', internal: false, address: '192.168.1.9' }] }));
  const discovery = new Discovery();
  const packets = [];
  let completeFirstSend; let closed = false;
  discovery.socket = {
    setMulticastInterface() {},
    send(bytes, _port, _target, callback) {
      packets.push(bytes.toString());
      if (packets.length === 1) completeFirstSend = callback;
      else queueMicrotask(callback);
    },
    close() { closed = true; }
  };
  const { host } = fixture({ discovery });
  t.after(() => { host.server.advertisement.dispose(); discovery.close(); });
  const disposing = host.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(host.server.enabled, false);
  assert.equal(closed, false);
  assert.equal(packets.length, 1);
  completeFirstSend();
  await disposing;
  assert.equal(closed, true);
  assert.equal(packets.length, 5);
  assert.ok(packets.every(packet => packet.includes('NTS: ssdp:byebye')));
});

test('byte ranges support complete, bounded, open-ended, suffix and invalid requests', () => {
  assert.deepEqual(byteRange(null, 10), { start: 0, end: 9, partial: false });
  assert.deepEqual(byteRange('bytes=2-4', 10), { start: 2, end: 4, partial: true });
  assert.deepEqual(byteRange('bytes=7-', 10), { start: 7, end: 9, partial: true });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9, partial: true });
  for (const header of ['bytes=-0', 'bytes=10-', 'bytes=3-1', 'bytes=0-1,4-5', 'bytes=-']) assert.equal(byteRange(header, 10), null);
});

async function responseFor(server, url, { method = 'GET', headers = {}, body = '', remote = '192.168.1.10' } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  Object.assign(req, { url, method, headers, socket: { remoteAddress: remote, localAddress: '192.168.1.9' } });
  const chunks = [];
  const res = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  res.writeHead = (status, values = {}) => { res.statusCode = status; res.headers = values; res.headersSent = true; return res; };
  const finished = new Promise((resolve, reject) => { res.on('finish', resolve); res.on('error', reject); });
  await server.handle(req, res);
  await finished;
  return { status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() };
}

test('shared media handler supports GET HEAD Range and revokes existing URLs without path disclosure', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-network-media-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const file = path.join(directory, 'private-name.flac'); await fs.writeFile(file, '0123456789');
  let permitted = true; let resolutions = 0;
  const server = new MusicServer({ id: 'uuid:library', name: 'Library', discovery: new FakeDiscovery(), browse: async () => ({ items: [], total: 0 }), resolveSource: async () => { resolutions++; if (!permitted) throw new Error('revoked'); return { path: file }; }, getArtwork: async () => ({ bytes: new Uint8Array([65, 66]), mimeType: 'image/jpeg' }) });
  server.enabled = true; server.port = 1234;
  const resource = server.resource('private-track-id', '192.168.1.9');
  assert.equal(resource.uri, server.resource('private-track-id', '192.168.1.9').uri);
  assert.ok(!resource.uri.includes('private'));
  const mediaPath = new URL(resource.uri).pathname;
  const full = await responseFor(server, mediaPath);
  assert.equal(full.status, 200); assert.equal(full.body, '0123456789');
  const partial = await responseFor(server, mediaPath, { headers: { range: 'bytes=2-5' } });
  assert.equal(partial.status, 206); assert.equal(partial.body, '2345'); assert.equal(partial.headers['Content-Range'], 'bytes 2-5/10');
  const head = await responseFor(server, mediaPath, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.body, ''); assert.equal(head.headers['Content-Length'], 10);
  assert.equal((await responseFor(server, mediaPath, { headers: { range: 'bytes=10-' } })).status, 416);
  assert.equal((await responseFor(server, new URL(resource.artwork).pathname)).body, 'AB');
  assert.equal((await responseFor(server, mediaPath, { remote: '8.8.8.8' })).status, 403);
  permitted = false;
  assert.equal((await responseFor(server, mediaPath)).status, 404);
  permitted = true; server.revoke();
  const count = resolutions;
  assert.equal((await responseFor(server, mediaPath)).status, 404);
  assert.equal(resolutions, count);
  assert.notEqual(server.resource('private-track-id', '192.168.1.9').uri, resource.uri);
});

test('ContentDirectory SOAP browse publishes escaped playable metadata and rejects unsupported sorting', async () => {
  const server = new MusicServer({ id: 'uuid:library', name: 'Library', discovery: new FakeDiscovery(), browse: async request => {
    assert.equal(request.address, '192.168.1.9'); assert.equal(request.start, 3); assert.equal(request.count, 10);
    return { items: [{ id: 'opaque', title: 'A & B', uri: 'http://192.168.1.9/media/token' }], total: 20 };
  } });
  server.enabled = true;
  const request = sort => `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:Browse xmlns:u="${CONTENT}"><ObjectID>0</ObjectID><BrowseFlag>BrowseDirectChildren</BrowseFlag><Filter>*</Filter><StartingIndex>3</StartingIndex><RequestedCount>10</RequestedCount><SortCriteria>${sort}</SortCriteria></u:Browse></s:Body></s:Envelope>`;
  const response = await responseFor(server, '/control/ContentDirectory', { method: 'POST', body: request('') });
  assert.equal(response.status, 200);
  const envelope = parseXml(response.body); const body = envelope.children[0].children[0].children[0];
  assert.equal(parseDidl(body.children.find(item => item.name === 'Result').text)[0].title, 'A & B');
  assert.equal((await responseFor(server, '/control/ContentDirectory', { method: 'POST', body: request('+dc:title') })).status, 200);
  assert.equal((await responseFor(server, '/control/ContentDirectory', { method: 'POST', body: request('+unsupported') })).status, 500);
});

test('external browsing follows server paging and advertised search, and local playback alone uses proxy', async () => {
  const calls = [];
  const { host, discovery } = fixture({ invoke: async (_service, action, args) => {
    calls.push({ action, args });
    return { Result: didl([didlItem({ id: 'track', title: 'Song', uri: 'http://192.168.1.7/song.flac', protocolInfo: 'http-get:*:audio/flac:*' })]), TotalMatches: '1000' };
  } });
  discovery.devices.set('server', device('server', 'ContentDirectory'));
  const page = await host.browse({ serverId: 'server', objectId: 'album', start: 100, count: 50 });
  assert.equal(page.total, 1000); assert.equal(calls[0].args.StartingIndex, 100); assert.equal(calls[0].args.RequestedCount, 50);
  assert.equal(page.items[0].playable, true);
  await assert.rejects(host.browse({ serverId: 'server', query: 'title' }), { code: 'unsupported' });
  discovery.devices.get('server').searchSupported = true;
  await host.browse({ serverId: 'server', query: 'A "B"' });
  assert.equal(calls.at(-1).action, 'Search'); assert.equal(calls.at(-1).args.SearchCriteria, 'dc:title contains "A" and dc:title contains "\\"B\\""');
  const direct = await host.resolveTrack({ serverId: 'server', trackId: 'track' });
  assert.equal(direct.uri, 'http://192.168.1.7/song.flac');
  const local = await host.resolveTrack({ serverId: 'server', trackId: 'track', localPlayback: true });
  assert.match(local.uri, /^http:\/\/127\.0\.0\.1:/);
});

test('generic server text search preserves literal Unicode tokens using only advertised metadata fields', async () => {
  const calls = [];
  const { host, discovery } = fixture({ invoke: async (_service, action, args) => {
    calls.push({ action, args }); return { Result: didl([]), TotalMatches: '0' };
  } });
  discovery.devices.set('server', device('server', 'ContentDirectory', { manufacturer: 'EffeTune', searchSupported: true, searchCaps: ['upnp:artist', 'upnp:album'] }));
  await host.browse({ serverId: 'server', query: 'Quartet Skies' });
  assert.equal(calls[0].action, 'Search', 'A manufacturer name never enables the catalog extension');
  assert.equal(calls[0].args.SearchCriteria, '(upnp:artist contains "Quartet" or upnp:album contains "Quartet") and (upnp:artist contains "Skies" or upnp:album contains "Skies")');
  discovery.devices.get('server').searchCaps = ['dc:title'];
  await host.browse({ serverId: 'server', query: '  Álpha\tガラス  ' });
  assert.equal(calls[1].args.SearchCriteria, 'dc:title contains "Álpha" and dc:title contains "ガラス"');
});

test('browse and search expose actual page progress when servers cap pages or omit totals', async () => {
  for (const query of ['', 'Song']) {
    for (const unknownTotal of [false, true]) {
      const offsets = [];
      const pageLimit = unknownTotal ? 100 : 20;
      const { host, discovery } = fixture({ invoke: async (_service, action, args) => {
        assert.equal(action, query ? 'Search' : 'Browse');
        offsets.push(args.StartingIndex);
        const length = Math.min(pageLimit, 150 - args.StartingIndex);
        const items = Array.from({ length }, (_, index) => didlItem({ id: `track-${args.StartingIndex + index}`, title: 'Song', uri: `http://192.168.1.7/${args.StartingIndex + index}.flac`, protocolInfo: 'http-get:*:audio/flac:*' }));
        return { Result: didl(items), NumberReturned: String(length), TotalMatches: unknownTotal ? '0' : '150' };
      } });
      discovery.devices.set('server', device('server', 'ContentDirectory', { searchSupported: true }));
      const ids = []; let start = 0;
      while (true) {
        const page = await host.browse({ serverId: 'server', start, count: 100, query });
        assert.equal(page.numberReturned, page.items.length);
        assert.equal(page.start, start);
        assert.equal(page.total, unknownTotal && page.items.length ? null : unknownTotal ? 0 : 150);
        ids.push(...page.items.map(item => item.trackId));
        if (!page.numberReturned) break;
        start += page.numberReturned;
        if (page.total !== null && start >= page.total) break;
      }
      assert.deepEqual(ids, Array.from({ length: 150 }, (_, index) => `track-${index}`));
      assert.deepEqual(offsets, unknownTotal ? [0, 100, 150] : [0, 20, 40, 60, 80, 100, 120, 140]);
    }
  }
});

test('sharing permission and CUE bounds are checked before issuing remote resources', async () => {
  const { host } = fixture();
  await assert.rejects(host.resolveTrack({ serverId: 'local', trackId: 'private-track' }), { code: 'folderNotShared' });
  await assert.rejects(host.resolveTrack({ serverId: 'local', trackId: 'cue' }), { code: 'cueUnsupported' });
  const track = await host.resolveTrack({ serverId: 'local', trackId: 'file', address: '192.168.1.9' });
  assert.match(track.uri, /^http:\/\/192\.168\.1\.9:4567\/media\//);
  assert.equal(parseDidl(track.metadata)[0].resources[0].uri, track.uri);
  host.sharing.enabled = false;
  await assert.rejects(host.resolveTrack({ serverId: 'local', trackId: 'file' }), { code: 'sharingRequired' });
});

function playerFixture({ protocolInfo = 'http-get:*:audio/flac:*', ...hostOptions } = {}) {
  const calls = []; let entries = [{ id: 7, uri: 'http://192.168.1.7/original', metadata: didl([didlItem({ id: 'original', title: 'Original', uri: 'http://192.168.1.7/original' })]) }]; let nextId = 8; let currentId = 7; let changed = false;
  const fixtureValue = fixture({ invoke: async (endpoint, action, args = {}) => {
    calls.push({ endpoint, action, args });
    if (endpoint.type === CONTENT) return { Result: didl([didlItem({ id: args.ObjectID, title: 'External', uri: `http://192.168.1.7/${args.ObjectID}`, protocolInfo: 'http-get:*:audio/flac:*' })]) };
    if (action === 'IdArray') { const bytes = Buffer.alloc(entries.length * 4); entries.forEach((entry, index) => bytes.writeUInt32BE(entry.id, index * 4)); return { Token: '1', Array: bytes.toString('base64') }; }
    if (action === 'TransportState') return { Value: 'Stopped' };
    if (action === 'Id') return { Value: currentId };
    if (action === 'Repeat' || action === 'Shuffle') return { Value: '0' };
    if (action === 'ReadList') return { TrackList: `<TrackList>${args.IdList.split(' ').map(id => entries.find(item => item.id === Number(id))).filter(Boolean).map(item => `<Entry><Id>${item.id}</Id><Uri>${xml(item.uri)}</Uri><Metadata>${xml(item.metadata)}</Metadata></Entry>`).join('')}</TrackList>` };
    if (action === 'IdArrayChanged') return { Value: changed ? '1' : '0' };
    if (action === 'ProtocolInfo') return { Value: protocolInfo };
    if (action === 'TracksMax') return { Value: '99' };
    if (action === 'DeleteAll') { entries = []; currentId = 0; return {}; }
    if (action === 'SeekId') { currentId = args.Value; return {}; }
    if (action === 'Insert') { const id = nextId++; const index = args.AfterId ? entries.findIndex(entry => entry.id === args.AfterId) + 1 : 0; entries.splice(index, 0, { id, uri: args.Uri, metadata: args.Metadata }); return { NewId: id }; }
    return {};
  }, ...hostOptions });
  fixtureValue.discovery.devices.set('player', device('player', 'Playlist'));
  fixtureValue.discovery.devices.set('server', device('server', 'ContentDirectory'));
  return { ...fixtureValue, calls, setChanged: value => { changed = value; } };
}

test('mixed-source inserts use player-owned stable queue IDs and direct source URLs', async () => {
  const { host, calls } = playerFixture();
  const state = await host.playerCommand({ playerId: 'player', action: 'insert', items: [{ serverId: 'local', trackId: 'file' }, { serverId: 'server', trackId: 'external' }] });
  assert.deepEqual(state.queue.map(item => item.id), [7, 8, 9]);
  const inserts = calls.filter(call => call.action === 'Insert');
  assert.match(inserts[0].args.Uri, /^http:\/\/192\.168\.1\.9:4567\/media\//);
  assert.equal(inserts[1].args.Uri, 'http://192.168.1.7/external');
  assert.equal(inserts[1].args.AfterId, 8);
  assert.equal(parseDidl(inserts[1].args.Metadata)[0].title, 'External');
  assert.equal(calls.some(call => ['Play', 'Stop', 'SeekId'].includes(call.action)), false);
  assert.equal(state.capabilities.volume, false);
  assert.equal(state.protocolInfo, 'http-get:*:audio/flac:*');
});

test('native replacement starts at the requested occurrence and rejects bounds or destination limits before mutation', async () => {
  const { host, calls } = playerFixture();
  const items = ['first', 'middle', 'first'].map(trackId => ({ serverId: 'server', trackId }));
  assert.equal((await host.getState()).queueTracksMax, 4096);
  const state = await host.playerCommand({ playerId: 'player', action: 'replace', items, play: true, startIndex: 2 });
  assert.equal(state.queue.length, 3); assert.equal(state.currentId, state.queue[2].id);
  assert.equal(state.queue[0].uri, state.queue[2].uri); assert.notEqual(state.queue[0].id, state.queue[2].id);
  assert.equal(calls.find(call => call.action === 'SeekId').args.Value, state.queue[2].id);
  const callCount = calls.length;
  for (const startIndex of [-1, 3, 1.5, 'invalid']) await assert.rejects(host.playerCommand({ playerId: 'player', action: 'replace', items, play: true, startIndex }), { code: 'invalidRequest' });
  assert.equal(calls.length, callCount, 'Invalid ordinals do not resolve resources or touch the destination');
  const invoke = host.invoke;
  host.invoke = (endpoint, action, args) => action === 'TracksMax' ? Promise.resolve({ Value: '2' }) : invoke(endpoint, action, args);
  const mutationCount = calls.filter(call => ['Insert', 'DeleteAll', 'SeekId', 'Play'].includes(call.action)).length;
  await assert.rejects(host.playerCommand({ playerId: 'player', action: 'replace', items, play: true }), { code: 'queueFull' });
  assert.equal(calls.filter(call => ['Insert', 'DeleteAll', 'SeekId', 'Play'].includes(call.action)).length, mutationCount);
});

test('queued append and play-next intents use the latest serialized player state', async () => {
  const { host, calls } = playerFixture();
  const insert = (trackId, extra = {}) => host.playerCommand({ playerId: 'player', action: 'insert', items: [{ serverId: 'server', trackId }], ...extra });
  const states = await Promise.all([insert('first', { position: 'end' }), insert('second', { position: 'end' })]);
  assert.deepEqual(states[1].queue.map(item => item.uri), ['http://192.168.1.7/original', 'http://192.168.1.7/first', 'http://192.168.1.7/second']);
  const [, next] = await Promise.all([host.playerCommand({ playerId: 'player', action: 'seekId', id: 8 }), insert('next', { position: 'afterCurrent' })]);
  assert.deepEqual(next.queue.map(item => item.id), [7, 8, 10, 9]);
  const explicit = await insert('explicit', { afterId: 7 });
  assert.deepEqual(explicit.queue.map(item => item.id), [7, 11, 8, 10, 9]);
  assert.deepEqual(calls.filter(call => call.action === 'Insert').map(call => call.args.AfterId), [7, 8, 8, 7]);
});

test('advertised player formats and source resources remain available before rejecting unsupported playback', async () => {
  const { host, calls } = playerFixture({ protocolInfo: 'http-get:*:audio/mpeg:*' });
  const state = await host.getPlayerState({ playerId: 'player' });
  const track = await host.resolveTrack({ serverId: 'server', trackId: 'flac' });
  const localTrack = await host.resolveTrack({ serverId: 'local', trackId: 'file', address: '192.168.1.9' });
  assert.equal(state.protocolInfo, 'http-get:*:audio/mpeg:*');
  assert.equal(track.resources[0].protocolInfo, 'http-get:*:audio/flac:*');
  assert.equal(localTrack.resources[0].protocolInfo, 'http-get:*:audio/flac:*');
  for (const action of ['insert', 'replace']) {
    await assert.rejects(host.playerCommand({ playerId: 'player', action, items: [{ serverId: 'server', trackId: 'flac' }], play: true }), { code: 'unsupportedFormat' });
  }
  assert.equal(calls.some(call => ['DeleteAll', 'Insert', 'Play'].includes(call.action)), false);
});

test('failed source resolution never clears the existing player queue', async () => {
  const { host, calls } = playerFixture();
  await assert.rejects(host.playerCommand({ playerId: 'player', action: 'replace', items: [{ serverId: 'local', trackId: 'cue' }], play: true }), { code: 'cueUnsupported' });
  assert.equal(calls.some(call => call.action === 'DeleteAll'), false);
});

test('authoritative queue reads reject concurrent changes and unsupported volume never touches local audio', async () => {
  const { host, calls, setChanged } = playerFixture();
  setChanged(true);
  await assert.rejects(host.getPlayerState({ playerId: 'player' }), { code: 'queueChanged' });
  const prior = calls.length;
  await assert.rejects(host.playerCommand({ playerId: 'missing', action: 'play' }), { code: 'unavailable' });
  assert.equal(calls.length, prior);
  await assert.rejects(host.playerCommand({ playerId: 'player', action: 'volume', value: 30 }), { code: 'unsupported' });
  assert.equal(calls.length, prior);
});

test('protocol compatibility is checked by declared MIME type', () => {
  assert.equal(supportsProtocol('http-get:*:audio/flac:*,http-get:*:audio/mpeg:*', 'http-get:*:audio/flac:*'), true);
  assert.equal(supportsProtocol('http-get:*:audio/mpeg:*', 'http-get:*:audio/flac:*'), false);
  assert.equal(supportsProtocol('', 'http-get:*:audio/flac:*'), false);
});

test('catalog sharing pages only selected folders using the actual SQLite repository', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-network-catalog-')));
  const repository = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
  t.after(async () => { await repository.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  await repository.upsertFolders([{ id: 'shared', kind: 'electron', path: directory, displayName: 'Shared', status: 'ok' }, { id: 'private', kind: 'electron', path: directory, displayName: 'Private', status: 'ok' }]);
  await repository.upsertTracks(Array.from({ length: 4 }, (_, index) => ({ trackUid: `track-${index}`, folderId: index === 3 ? 'private' : 'shared', relativePath: `${index}.flac`, fileName: `${index}.flac`, title: `Song ${index}`, durationSec: 30 })));
  const { host } = fixture({ getCatalog: async () => ({ repository, runtime: { resolvePlaybackSource: async uid => ({ path: path.join(directory, `${uid}.flac`), folderId: 'shared', sourceKind: 'file' }) } }) });
  const root = await host.browseShared({ objectId: '0', start: 0, count: 100, address: '192.168.1.9' });
  assert.deepEqual(root.items.map(item => item.viewId), ['tracks', 'albums', 'artists', 'genres', 'subfolders', 'files', 'folders', 'recent', 'playlists']);
  const page = await host.browseShared({ objectId: root.items[0].id, start: 1, count: 1, address: '192.168.1.9' });
  assert.equal(page.total, 3); assert.equal(page.items.length, 1); assert.equal(page.items[0].title, 'Song 1');
  assert.equal(page.items[0].resources[0].protocolInfo, 'http-get:*:audio/flac:*');
  assert.ok(!JSON.stringify(page).includes(directory));
  assert.deepEqual((await host.browseShared({ objectId: root.items[0].id, start: 5, count: 1, address: '192.168.1.9' })).items, []);
  host.repository.removeListener('invalidation', host.catalogChanged);
});

test('network IPC rejects non-main frames and returns safe errors', async () => {
  const { host } = fixture(); const handlers = new Map(); const mainFrame = {}; const webContents = { mainFrame, send() {} };
  const dispose = registerNetworkMusicIpc({ ipcMain: { handle: (key, fn) => handlers.set(key, fn), removeHandler: key => handlers.delete(key) }, host, getMainWindow: () => ({ webContents, isDestroyed: () => false }) });
  await assert.rejects(handlers.get('network-music:GetState')({ sender: webContents, senderFrame: {} }), { code: 'unauthorized' });
  const state = await handlers.get('network-music:GetState')({ sender: webContents, senderFrame: mainFrame });
  assert.deepEqual(state.sharing.folderIds, ['shared']);
  host.browse = async () => { throw new Error('secret filesystem detail'); };
  const failure = await handlers.get('network-music:Browse')({ sender: webContents, senderFrame: mainFrame });
  assert.equal(failure.networkMusicError.code, 'networkMusicUnavailable');
  assert.ok(!failure.networkMusicError.message.includes('secret'));
  dispose(); assert.equal(handlers.size, 0);
});

test('external devices remain available when the local catalog is unavailable', async () => {
  const { host, discovery } = fixture({ getCatalog: async () => { throw new Error('catalog down'); } });
  discovery.devices.set('player', device('player', 'Playlist'));
  const state = await host.getState();
  assert.equal(state.players.length, 1); assert.deepEqual(state.sharing.folders, []);
});

test('player lists exclude only the local UDN on initial state, refresh and discovery changes', async t => {
  const localPlayer = { id: 'uuid:self' };
  const { host, discovery } = fixture({ localPlayer });
  t.after(() => host.dispose());
  const self = device(localPlayer.id, 'Playlist', { manufacturer: 'EffeTune' });
  const peer = device('uuid:peer', 'Playlist', { manufacturer: 'EffeTune' });
  const library = device('uuid:library', 'ContentDirectory', { libraryProbed: true });
  for (const entry of [self, peer, library]) discovery.devices.set(entry.id, entry);
  const assertState = state => {
    assert.deepEqual(state.players, [{ id: peer.id, name: peer.name, available: peer.available, isEffeTune: true }]);
    assert.deepEqual(state.libraries.map(entry => entry.id), [library.id]);
  };
  assertState(await host.getState());
  assertState(await host.discover());
  assert.equal(host.device(peer.id, 'Playlist'), peer);
  self.available = false;
  peer.available = false;
  const changed = new Promise(resolve => host.once('state', resolve));
  discovery.emit('change');
  assertState(await changed);
  assert.equal(discovery.devices.get(self.id), self);
});

test('catalog selections retain playlist identities and original queue order while choosing the starting track', async () => {
  const { host, calls, repository } = playerFixture();
  const released = [];
  repository.retainContext = async () => {};
  repository.releaseRetainedContext = async token => released.push(token);
  repository.readContextPage = async () => ({ rows: [{ playlistItemKey: 'item-a', trackUid: 'first' }, { playlistItemKey: 'item-b', trackUid: 'second' }], nextCursor: null });
  const receipt = await host.playSelection({ playerId: 'player', operationKind: 'play', selectionDescriptor: { contextToken: 'snapshot', mode: 'explicit', trackUids: ['item-a', 'item-b'] }, options: { currentOrdinal: 1 } });
  assert.equal(receipt.result.state, 'succeeded');
  const inserts = calls.filter(call => call.action === 'Insert');
  assert.deepEqual(inserts.map(call => parseDidl(call.args.Metadata)[0].title), ['first', 'second']);
  assert.equal(calls.find(call => call.action === 'SeekId').args.Value, 9);
  assert.deepEqual(released, ['snapshot']);
  await assert.rejects(host.playSelection({ playerId: 'player', operationKind: 'queue', selectionDescriptor: { contextToken: 'snapshot', mode: 'explicit', trackUids: ['missing'] } }), { code: 'selectionChanged' });
  assert.deepEqual(released, ['snapshot', 'snapshot']);
});

test('actual SQLite selection reaches remote queue creation with the library double-click request', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-network-selection-')));
  const repository = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
  t.after(async () => { await repository.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  await repository.upsertFolders([{ id: 'shared', kind: 'electron', path: directory, displayName: 'Shared', status: 'ok' }]);
  await repository.upsertTracks(Array.from({ length: 3 }, (_, index) => ({ trackUid: `track-${index}`, folderId: 'shared', relativePath: `${index}.flac`, fileName: `${index}.flac`, title: `Song ${index}`, durationSec: 30 })));
  const { host, calls } = playerFixture({ getCatalog: async () => ({ repository, runtime: { resolvePlaybackSource: async uid => ({ ...await repository.getTrackStorageIdentity(uid), path: path.join(directory, `${uid}.flac`) }) } }) });
  t.after(() => host.repository?.removeListener('invalidation', host.catalogChanged));
  const page = await repository.queryTracks({ query: '', sort: 'title', direction: 'asc', limit: 20 });
  const request = { playerId: 'player', operationKind: 'play', selectionDescriptor: { mode: 'all', contextToken: page.contextToken, exclusions: [] }, options: { currentOrdinal: 1, sourceOrdinal: 1 } };
  host.sharing.enabled = false;
  await assert.rejects(host.playSelection(request), { code: 'sharingRequired' });
  host.sharing.enabled = true; host.sharing.folderIds = [];
  await assert.rejects(host.playSelection(request), { code: 'folderNotShared' });
  assert.equal(calls.some(call => ['DeleteAll', 'Insert', 'Play'].includes(call.action)), false);
  host.sharing.folderIds = ['shared'];
  const result = await host.playSelection(request);
  assert.equal(result.result.state, 'succeeded');
  assert.deepEqual(calls.filter(call => call.action === 'Insert').map(call => parseDidl(call.args.Metadata)[0].title), ['Song 0', 'Song 1', 'Song 2']);
  assert.equal(calls.find(call => call.action === 'SeekId').args.Value, 9);
  await repository.releaseContext(page.contextToken);
});

test('private local catalog browse returns exact pages across ordinal boundaries with sharing disabled', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-local-browse-')));
  const repository = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
  t.after(async () => { await repository.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  await repository.upsertFolders([{ id: 'private', kind: 'electron', path: directory, displayName: 'Private', status: 'ok' }]);
  await repository.upsertTracks(Array.from({ length: 505 }, (_, index) => ({ trackUid: `track-${index}`, folderId: 'private',
    relativePath: `${index}.flac`, fileName: `${index}.flac`, title: `Song ${String(index).padStart(3, '0')}`, durationSec: 30 })));
  const { host } = fixture({ getCatalog: async () => ({ repository }) });
  host.sharing.enabled = false;
  t.after(() => host.repository?.removeListener('invalidation', host.catalogChanged));
  const root = await host.browse({ serverId: 'local', objectId: '0', start: 498, count: 5, query: 'Song' });
  assert.equal(root.total, 505);
  assert.equal(root.numberReturned, 5);
  assert.deepEqual(root.items.map(item => item.trackId), ['track-498', 'track-499', 'track-500', 'track-501', 'track-502']);
  assert.ok(root.items.every(item => item.serverId === 'local' && item.playable));
  const empty = await host.browse({ serverId: 'local', start: 505, count: 5 });
  assert.equal(empty.total, 505);
  assert.deepEqual(empty.items, []);
});

test('local target preflights private and remote refs before one native mixed queue action', async () => {
  const localActions = [];
  const localPlayer = { controlId: 'local:uuid:player', available: true, address: '127.0.0.1',
    services: new Map([['urn:av-openhome-org:service:Playlist', { type: PLAYLIST }]]),
    async playCatalogItems(args, isCurrent) { localActions.push({ args, isCurrent }); } };
  const repository = { getTrack: async uid => uid === 'missing' ? null : ({ trackUid: uid, title: uid }) };
  const runtime = { resolvePlaybackSource: async uid => {
    if (uid === 'missing') throw Object.assign(new Error('Missing'), { code: 'trackNotFound' });
    return { kind: 'electron-file', path: 'C:/music/song.flac', sourceKind: 'cue-track', startFrame: 100, endFrame: 200 };
  } };
  const { host } = fixture({ localPlayer, getCatalog: async () => ({ repository, runtime }) });
  host.sharing.enabled = false;
  host.invoke = async (_endpoint, action) => action === 'TracksMax' ? { Value: 100 } : {};
  host.getPlayerState = async () => ({ playerId: localPlayer.controlId, queue: [], currentId: 0, protocolInfo: 'http-get:*:*:*' });
  host.pruneFiles = () => {};
  host.resolveTrack = async () => ({ resources: [{ uri: 'http://media.test/remote.flac', protocolInfo: 'http-get:*:audio/flac:*' }] });
  const items = [{ serverId: 'local', trackId: 'song' }, { serverId: 'remote', trackId: 'other' },
    { serverId: 'local', trackId: 'song' }];
  await host.playerCommand({ playerId: localPlayer.controlId, action: 'replace', items, play: true, startIndex: 2 });
  assert.deepEqual(localActions[0].args.items, items);
  assert.equal(localActions[0].args.operationKind, 'play');
  assert.equal(localActions[0].args.startIndex, 2);
  assert.equal(localActions[0].isCurrent(), true);
  await assert.rejects(host.playerCommand({ playerId: localPlayer.controlId, action: 'replace',
    items: [{ serverId: 'local', trackId: 'missing' }], play: true }));
  assert.equal(localActions.length, 1, 'A missing local source does not replace the queue');
  localPlayer.playCatalogItems = async () => { throw Object.assign(new Error('Gone'), { code: 'trackUnavailable', phase: 'preflight' }); };
  const pending = { playerId: localPlayer.controlId, action: 'replace', items: [{ serverId: 'local', trackId: 'song' }], play: true };
  await assert.rejects(host.playerCommand(pending), { code: 'trackUnavailable' });
  assert.equal(pending.mutationStarted, false, 'A renderer preflight failure is not an uncertain queue mutation');
});

test('opened files use explicit grants and private destination-bound URLs without enabling library sharing', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-network-open-')));
  const selected = path.join(directory, 'selected.flac');
  const unselected = path.join(directory, 'unselected.flac');
  await fs.writeFile(selected, '0123456789'); await fs.writeFile(unselected, 'private');
  const { host, calls, discovery } = playerFixture({ getRouteAddress: async () => '127.0.0.1' });
  discovery.devices.get('player').address = '127.0.0.1';
  host.sharing.enabled = false;
  t.after(async () => { await host.dispose(); fileAccess.clear(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  await assert.rejects(host.playFiles({ playerId: 'player', filePaths: [unselected] }), { code: 'fileAccessRequired' });
  assert.equal(calls.some(call => call.action === 'DeleteAll'), false);
  fileAccess.grantRead(selected);
  await assert.rejects(host.playFiles({ playerId: 'player', filePaths: [selected, unselected] }), { code: 'fileAccessRequired' });
  assert.equal(host.fileServer.server, null); assert.equal(host.fileSources.size, 0);
  assert.equal(calls.some(call => call.action === 'DeleteAll'), false);
  const state = await host.playFiles({ playerId: 'player', filePaths: [selected] });
  assert.equal(state.queue.length, 1); assert.equal(state.queue[0].title, 'selected');
  assert.equal(host.sharing.enabled, false); assert.equal(host.discovery.starts, 0);
  const uri = new URL(state.queue[0].uri);
  assert.equal(uri.hostname, '127.0.0.1'); assert.ok(!state.queue[0].metadata.includes(directory));
  const partial = await fetch(uri, { headers: { Range: 'bytes=2-5' } });
  assert.equal(partial.status, 206); assert.equal(await partial.text(), '2345');
  assert.equal((await responseFor(host.fileServer, uri.pathname, { remote: '192.168.1.6' })).status, 403);
  assert.equal((await responseFor(host.fileServer, '/device.xml', { remote: '127.0.0.1' })).status, 404);
  assert.equal((await responseFor(host.fileServer, '/control/ContentDirectory', { method: 'POST', remote: '127.0.0.1' })).status, 404);
  await host.playerCommand({ playerId: 'player', action: 'clear' });
  assert.equal((await responseFor(host.fileServer, uri.pathname, { remote: '127.0.0.1' })).status, 404);
  assert.equal(host.fileSources.size, 0);
  const requeued = await host.playFiles({ playerId: 'player', filePaths: [selected] });
  await host.invoke(service(discovery.devices.get('player'), 'Playlist'), 'DeleteAll');
  await host.getPlayerState({ playerId: 'player' });
  assert.equal((await responseFor(host.fileServer, new URL(requeued.queue[0].uri).pathname, { remote: '127.0.0.1' })).status, 404);
  await host.playFiles({ playerId: 'player', filePaths: [selected] });
  await host.dispose();
  assert.equal(host.fileSources.size, 0); assert.equal(host.fileServer.tokens.size, 0);
  assert.equal(host.fileServer.enabled, false); assert.equal(host.fileServer.server, null);
});

test('passive discovery state never opens the catalog and restore never sends playback commands', async () => {
  const initializations = []; const commands = [];
  const { host } = fixture({ getCatalog: async initialize => { initializations.push(initialize); return null; }, invoke: async (_service, action) => { commands.push(action); } });
  host.sharing.enabled = false;
  await host.start();
  await host.getState();
  assert.deepEqual(initializations, [false]);
  assert.deepEqual(commands, []);
});

test('sharing settings explicitly open the SQLite catalog before returning editable folder choices', async t => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-network-settings-')));
  let catalog = null;
  const initializations = [];
  const { host, getConfig } = fixture({ getCatalog: async initialize => {
    initializations.push(initialize);
    if (initialize && !catalog) {
      const repository = await LibraryCatalogHost.open({ dbPath: path.join(directory, 'catalog.sqlite') });
      catalog = { repository };
      await repository.upsertFolders([{ id: 'shared', kind: 'electron', path: directory, displayName: 'Saved music folder', status: 'ok' }]);
    }
    return catalog;
  } });
  t.after(async () => { await host.dispose(); await catalog?.repository.close(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
  assert.deepEqual((await host.getState()).sharing.folders, []);
  assert.deepEqual(initializations, [false]);
  const loaded = await host.getState({ loadSharingFolders: true });
  assert.deepEqual(loaded.sharing.folders, [{ id: 'shared', name: 'Saved music folder' }]);
  assert.deepEqual(loaded.sharing.folderIds, ['shared']);
  host.server.start = async () => {};
  await host.setSharing({ enabled: loaded.sharing.enabled, folderIds: loaded.sharing.folderIds });
  assert.deepEqual(getConfig().networkMusicSharing.folderIds, ['shared']);
  for (const missing of [false, true]) {
    host.getCatalog = async () => { if (missing) return null; throw new Error('catalog unavailable'); };
    await assert.rejects(host.getState({ loadSharingFolders: true }));
  }
});

test('delayed player reads cannot revoke files inserted by a completed command', async t => {
  for (const timing of ['before command', 'during command']) {
    await t.test(timing, { timeout: 5000 }, async t => {
      const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-network-state-race-')));
      const file = path.join(directory, 'selected.flac'); await fs.writeFile(file, 'audio'); fileAccess.grantRead(file);
      const { host, discovery } = playerFixture({ getRouteAddress: async () => '127.0.0.1' });
      const player = discovery.devices.get('player'); player.address = '127.0.0.1';
      player.services.set('urn:av-openhome-org:service:Time', { type: 'urn:av-openhome-org:service:Time:1', control: 'http://127.0.0.1/time' });
      const invoke = host.invoke;
      const timeReached = Promise.withResolvers(); const releaseTime = Promise.withResolvers();
      const insertReached = Promise.withResolvers(); const releaseInsert = Promise.withResolvers();
      let delayTime = timing === 'before command'; let delayInsert = timing === 'during command';
      host.invoke = async (endpoint, action, args) => {
        if (action === 'Time') {
          if (delayTime) { delayTime = false; timeReached.resolve(); await releaseTime.promise; }
          return { Seconds: '0', Duration: '30' };
        }
        if (action === 'Insert' && delayInsert) { delayInsert = false; insertReached.resolve(); await releaseInsert.promise; }
        return invoke(endpoint, action, args);
      };
      t.after(async () => { releaseTime.resolve(); releaseInsert.resolve(); await host.dispose(); fileAccess.clear(); await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
      let oldRead; let opening;
      if (timing === 'before command') {
        oldRead = host.getPlayerState({ playerId: 'player' }); await timeReached.promise;
        opening = host.playFiles({ playerId: 'player', filePaths: [file] });
      } else {
        opening = host.playFiles({ playerId: 'player', filePaths: [file] }); await insertReached.promise;
        delayTime = true; oldRead = host.getPlayerState({ playerId: 'player' }); await timeReached.promise;
        releaseInsert.resolve();
      }
      const current = await opening;
      releaseTime.resolve(); await oldRead;
      const uri = current.queue[0].uri;
      const response = await fetch(uri);
      assert.equal(response.status, 200); assert.equal(await response.text(), 'audio');
      await invoke(service(player, 'Playlist'), 'DeleteAll');
      await host.getPlayerState({ playerId: 'player' });
      assert.equal((await responseFor(host.fileServer, new URL(uri).pathname, { remote: '127.0.0.1' })).status, 404);
    });
  }
});

test('changing share configuration revokes issued URLs and persists explicit folder choices', async () => {
  const { host, getConfig } = fixture();
  const original = host.server.resource('file', '192.168.1.9');
  host.server.start = async () => { host.server.enabled = true; };
  const state = await host.setSharing({ enabled: true, folderIds: ['private'] });
  assert.deepEqual(state.sharing.folderIds, ['private']);
  assert.deepEqual(getConfig().networkMusicSharing, { enabled: true, folderIds: ['private'] });
  assert.equal(host.server.tokens.has(new URL(original.uri).pathname.split('/').at(-1)), false);
  await assert.rejects(host.setSharing({ enabled: true, folderIds: ['missing'] }), { code: 'invalidSharing' });
});
