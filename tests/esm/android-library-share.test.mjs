import assert from 'node:assert/strict';
import test from 'node:test';
import { CatalogSequence } from '../../js/ui/audio-player/playback-sequence.js';
import { AndroidNetworkMusicTransport } from '../../js/android/network-music-transport.js';
import { CONTENT, parseDidl, parseSoapResponse, soapEnvelope } from '../../js/network-music/upnp/protocol.js';

const BASE_URL = 'http://192.168.1.5:8200';
const TRACKS = [
  { trackUid: 'shared', folderId: 'music', title: 'Shared song', relativePath: 'a/shared.flac', fileIdentity: 'content://tree/music/shared.flac', size: 1234 },
  { trackUid: 'private', folderId: 'other', title: 'Private song', relativePath: 'private.flac', fileIdentity: 'content://tree/other/private.flac', size: 99 }
];

function shareFixture(t) {
  const handlers = new Map(), calls = [], responses = [], waiters = [];
  let status = { enabled: false, folderIds: [], id: 'uuid:self', baseUrl: null, updateId: 1 };
  let watchers = 0;
  const bridge = {
    on(event, fn) { handlers.set(event, fn); return () => handlers.delete(event); },
    async request(command, payload) {
      calls.push({ command, payload });
      if (command === 'share.status') return status;
      if (command === 'share.start') return (status = { ...status, enabled: true, folderIds: payload.folderIds, baseUrl: BASE_URL });
      if (command === 'share.stop') return (status = { ...status, enabled: false, folderIds: payload.folderIds, baseUrl: null });
      if (command === 'share.respond') { responses.push(payload); waiters.shift()?.(payload); return {}; }
      if (command === 'upnp.search') return {};
      throw new Error(`Unexpected bridge command ${command}`);
    }
  };
  const client = {
    async queryEntities({ type }) {
      assert.equal(type, 'folder');
      return { rows: [{ id: 'music', displayName: 'Music' }, { id: 'other', displayName: 'Other' }], nextCursor: null, contextToken: 'folders' };
    },
    async releaseContext() {},
    subscribeInvalidations() { watchers++; return () => { watchers--; }; },
    async getTrack(uid) { return TRACKS.find(track => track.trackUid === uid) ?? null; },
    async getTrackStorageIdentity(uid) {
      const track = TRACKS.find(entry => entry.trackUid === uid);
      return track && { trackUid: uid, folderId: track.folderId, relativePath: track.relativePath, sourceKind: 'file', fileIdentity: track.fileIdentity, size: track.size };
    },
    async querySharedLibrary({ folderIds, kind }) {
      assert.equal(kind, 'tracks');
      const rows = TRACKS.filter(track => folderIds.includes(track.folderId)).map(track => ({ ...track, kind: 'track' }));
      return { rows, total: rows.length };
    }
  };
  const api = new AndroidNetworkMusicTransport({ bridge,
    windowRef: { uiManager: { ensureLibraryManager: async () => ({ client }) } },
    loadConfig: async () => ({}), saveConfig: async () => true, ensureNetworkAccess: async () => {} });
  t.after(() => api.dispose());
  const ask = request => {
    const reply = new Promise(resolve => waiters.push(resolve));
    handlers.get('share-request')(request);
    return reply;
  };
  return { api, calls, responses, ask, watchers: () => watchers };
}

test('Android library sharing answers Browse with shared-folder tracks only and stops cleanly', async t => {
  const { api, calls, ask, watchers } = shareFixture(t);
  const initial = await api.networkMusicGetState();
  assert.deepEqual(initial.sharing, { enabled: false, folderIds: [], folders: [] });
  assert.equal(watchers(), 0);

  const state = await api.networkMusicSetSharing({ enabled: true, folderIds: ['music', 'music'] });
  assert.deepEqual(calls.find(call => call.command === 'share.start').payload, { folderIds: ['music'] });
  assert.deepEqual(state.sharing, { enabled: true, folderIds: ['music'],
    folders: [{ id: 'music', name: 'Music' }, { id: 'other', name: 'Other' }] });
  assert.ok(calls.every(call => !Object.hasOwn(call.payload ?? {}, 'friendlyName')));

  const body = soapEnvelope({ type: CONTENT }, 'Browse', { ObjectID: 'view:tracks', BrowseFlag: 'BrowseDirectChildren',
    Filter: '*', StartingIndex: 0, RequestedCount: 0, SortCriteria: '' });
  const reply = await ask({ requestId: 7, service: 'ContentDirectory', action: 'Browse', body, baseUrl: BASE_URL, updateId: 3 });
  assert.equal(reply.requestId, 7);
  assert.equal(reply.failed, undefined);
  const result = parseSoapResponse(reply.body, 'Browse');
  assert.deepEqual([result.NumberReturned, result.TotalMatches, result.UpdateID], ['1', '1', '3']);
  const [item] = parseDidl(result.Result);
  assert.equal(item.title, 'Shared song');
  const { uri, protocolInfo, size } = item.resources[0];
  const token = uri.slice(`${BASE_URL}/media/`.length);
  assert.equal(uri, `${BASE_URL}/media/${token}`);
  assert.deepEqual([protocolInfo, size], ['http-get:*:audio/flac:*', '1234']);
  assert.equal(item.artwork, `${BASE_URL}/artwork/${token}`);
  assert.match(token, /^[A-Za-z0-9_-]{1,128}$/);

  const media = await ask({ requestId: 8, service: 'Resource', action: 'media', body: token });
  assert.deepEqual(media, { requestId: 8, uri: 'content://tree/music/shared.flac', mime: 'audio/flac', size: 1234 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(watchers(), 1);

  const stopped = await api.networkMusicSetSharing({ enabled: false, folderIds: ['music'] });
  assert.equal(stopped.sharing.enabled, false);
  assert.ok(calls.some(call => call.command === 'share.stop'));
  assert.equal(watchers(), 0);
  const fault = await ask({ requestId: 9, service: 'ContentDirectory', action: 'Browse', body, baseUrl: BASE_URL, updateId: 3 });
  assert.equal(fault.failed, true);
  assert.match(fault.body, /<errorCode>701<\/errorCode>/);
});

test('Android sharing settings retry status and can stop with an unavailable catalog', async t => {
  const { api, calls } = shareFixture(t);
  await api.networkMusicSetSharing({ enabled: true, folderIds: ['music'] });
  const request = api.bridge.request.bind(api.bridge);
  let failStatus = true;
  api.bridge.request = (name, args) => {
    if (name === 'share.status' && failStatus) return Promise.reject(new Error('unavailable'));
    return request(name, args);
  };
  api.getCatalog = async () => null;
  await assert.rejects(api.networkMusicGetState({ loadSharingFolders: true }));
  failStatus = false;
  const { sharing } = await api.networkMusicGetState({ loadSharingFolders: true });
  assert.equal(sharing.enabled, true);
  assert.equal(sharing.foldersUnavailable, true);
  const stopped = await api.networkMusicSetSharing({ enabled: false, folderIds: sharing.folderIds });
  assert.equal(stopped.sharing.enabled, false);
  assert.deepEqual(calls.find(call => call.command === 'share.stop').payload.folderIds, ['music']);
});

test('Android publishes the media source before returning a local track to a player', async t => {
  const { api } = shareFixture(t);
  await api.networkMusicSetSharing({ enabled: true, folderIds: ['music'] });
  const calls = [];
  api.bridge.request = async (command, payload) => { calls.push({ command, payload }); return {}; };
  const track = await api.resolveTrack({ serverId: 'local', trackId: 'shared', address: BASE_URL });
  assert.deepEqual(calls, [{ command: 'share.publish', payload: { token: track.uri.split('/').pop(),
    uri: TRACKS[0].fileIdentity, mime: 'audio/flac', size: 1234, updateId: 1 } }]);
});

test('Android keeps the opened files in the AV queue after playback fails', async t => {
  const { api } = shareFixture(t);
  const device = { id: 'av', address: '192.168.1.8', available: true,
    services: new Map([['urn:schemas-upnp-org:service:AVTransport', {}]]) };
  api.discovery.devices.set(device.id, device);
  api.avPlayers.state = async () => ({ queue: api.avPlayers.owners.get('av')?.queue ?? [], protocolInfo: '' });
  api.avPlayers.start = async () => { throw new Error('player unavailable'); };
  const published = [], revoked = [];
  api.bridge.request = async (command, args) => {
    if (command === 'share.route') return { baseUrl: null };
    if (command === 'documents.stat') return { name: 'song.flac', size: 1234 };
    if (command === 'share.publish') { published.push(args); return { uri: BASE_URL + '/media/' + args.token }; }
    if (command === 'share.revoke') { revoked.push(args); return { hasFiles: args.keep.length > 0 }; }
    assert.fail(command);
  };
  await assert.rejects(api.playFiles({ playerId: 'av', filePaths: [TRACKS[0].fileIdentity] }), /player unavailable/);
  assert.equal(published.length, 1);
  assert.deepEqual(published[0], { token: published[0].token, uri: TRACKS[0].fileIdentity, size: 1234,
    mime: 'audio/flac', target: device.address, playerId: device.id });
  assert.deepEqual(revoked, [{ playerId: 'av', keep: [published[0].token] }]);
});

test('Android sends large score ranges in bounded bridge messages', async t => {
  const { api } = shareFixture(t);
  const bytes = new Uint8Array(1200000);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const { token } = api.mediaUrl('score');
  api.sharedSource = async () => ({ bytes });
  const parts = [];
  let offset = 17;
  api.bridge.request = async (command, args) => {
    if (command === 'share.respond') {
      assert.deepEqual(args, { requestId: 'range', size: bytes.length, mime: 'audio/midi' });
      return { accepted: true, offset, end: bytes.length - 3 };
    }
    assert.equal(command, 'share.respondPart');
    assert.equal(args.offset, offset);
    assert.ok(Buffer.byteLength(JSON.stringify({ command, payload: args })) < 1024 * 1024);
    const data = Buffer.from(args.data, 'base64');
    parts.push(data);
    offset += data.length;
    return { accepted: true };
  };
  await api.answerShare({ requestId: 'range', service: 'Resource', action: 'media', body: token });
  assert.deepEqual(Buffer.concat(parts), Buffer.from(bytes.subarray(17, -3)));
});

test('Android library sharing rejects unknown folders and unshared tracks', async t => {
  const { api, calls, ask } = shareFixture(t);
  await assert.rejects(api.networkMusicSetSharing({ enabled: true, folderIds: ['missing'] }), { code: 'invalidSharing' });
  assert.equal(calls.some(call => call.command === 'share.start'), false);

  await api.networkMusicSetSharing({ enabled: true, folderIds: ['music'] });
  const { token } = api.mediaUrl('private');
  assert.deepEqual(await ask({ requestId: 1, service: 'Resource', action: 'media', body: token }), { requestId: 1, failed: true });
  await assert.rejects(api.networkMusicResolveTrack({ serverId: 'local', trackId: 'private' }), { code: 'folderNotShared' });
});

test('Android sends the local catalog shuffle order from its head or the chosen occurrence', async t => {
  const { api } = shareFixture(t);
  const rows = Array.from({ length: 17 }, (_, ordinal) => ({ trackUid: String(ordinal) }));
  api.getCatalog = async () => ({ repository: {
    getContextCount: async () => ({ totalCount: rows.length }),
    readContextPageAtOrdinal: async () => ({ pageStartOrdinal: 0, rows })
  } });
  const commands = [];
  api.playerCommand = async command => commands.push(command);
  const selectionDescriptor = { mode: 'all', contextToken: 'snapshot', exclusions: [] };
  for (const currentOrdinal of [undefined, 0, 8]) {
    const seed = 71;
    const sequence = new CatalogSequence({ sequenceId: 'local', itemCount: rows.length,
      shuffleEnabled: true, shuffleSeed: seed, readPage: async () => rows, resolveSource: async () => ({}) });
    if (currentOrdinal !== undefined) sequence.shuffleTransportOffset = sequence.toTransportOrdinal(currentOrdinal);
    await api.playSelection({ playerId: 'remote', operationKind: 'play', selectionDescriptor,
      options: { seed, currentOrdinal } });
    const { items, startIndex } = commands.at(-1);
    assert.equal(startIndex, 0);
    assert.deepEqual(items.map(item => item.trackId), rows.map((_, index) => String(sequence.toCanonicalOrdinal(index))));
  }
});

test('catalog sends register the same document for each destination queue', async t => {
  const { api } = shareFixture(t);
  await api.networkMusicSetSharing({ enabled: true, folderIds: ['music'] });
  const publications = [];
  api.bridge.request = async (name, args) => {
    if (name === 'share.route') return { baseUrl: BASE_URL };
    if (name === 'share.publish') { publications.push(args); return {}; }
    if (name === 'share.revoke') return { hasFiles: true };
    assert.fail(name);
  };
  const state = { protocolInfo: 'http-get:*:*:*', queue: [] };
  api.getPlayerState = api.avPlayers.state = async () => state;
  api.invoke = async (_, action) => action === 'TracksMax' ? { Value: 10 } : { NewId: 1 };
  for (const [id, type] of [['oh', 'urn:av-openhome-org:service:Playlist'], ['av', 'urn:schemas-upnp-org:service:AVTransport']]) {
    api.discovery.devices.set(id, { id, available: true, address: '192.168.1.8', services: new Map([[type, {}]]) });
    await api.playerCommand({ playerId: id, action: 'replace', items: [{ serverId: 'local', trackId: 'shared' }] });
  }
  assert.deepEqual(publications.map(({ token, playerId, updateId }) => [token, playerId, updateId]), [
    [api.trackTokens.get('shared'), 'oh', 1], [api.trackTokens.get('shared'), 'av', 1]
  ]);
});
