'use strict';

const crypto = require('node:crypto');
const { serveRemoteResource } = require('./network-music-resource.cjs');
const { isAllowedHost } = require('./remote-static-server.cjs');
const { VIEWS, SORT_CAPS, parseSort } = require('./network-music-content.cjs');
const { didl, didlItem, networkUrl } = require('./network-music-upnp.cjs');
const { MAX_QUEUE } = require('./network-music-host.cjs');
const { projectPlayback } = require('./remote-music-dispatcher.cjs');

const PWA_ORIGIN = 'https://effetune.frieve.com';
const PREFIX = '/pwa/v1/';
const MAX_BODY = 16 * 1024 * 1024;
const MAX_GRANT_LENGTH = 8192;
const fail = code => Object.assign(new Error(code), { code });
const mediaKeys = track => [...new Set([track.uri, ...(track.resources || []).map(resource => resource.uri)]
  .filter(uri => typeof uri === 'string' && uri.length > 0)
  .map(uri => crypto.createHash('sha256').update(uri).digest('hex')))];
const uint = (value, maximum = 0xffffffff) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) throw fail('invalidRequest');
  return value;
};

// Adapts the existing host-local action owner to the native playlist controller.
// No discovery or advertisement is needed to address this player.
class LocalOpenHomePlayer {
  constructor(host) {
    this.host = host;
    this.id = `uuid:${host.ensureDeviceId().openHomeDeviceId}`;
    this.controlId = `local:${this.id}`;
    this.address = '127.0.0.1';
    this.services = new Map(['Playlist', 'Time', 'Volume'].map(kind => [
      `urn:av-openhome-org:service:${kind}`,
      { type: `urn:av-openhome-org:service:${kind}:1`, invoke: (action, args, isCurrent) => this.invoke(kind, action, args, isCurrent) }
    ]));
  }
  get available() { return this.host.localControlEnabled && this.host.rendererReady && !this.host.disposed; }
  get name() { return this.host.getFriendlyName(); }
  playCatalogItems(args, isCurrent) { return this.host.requestLocalAction('Catalog', 'PlayItems', args, isCurrent); }
  snapshot() {
    if (!this.reading) {
      this.reading = this.host.requestLocalAction('Playlist', 'Snapshot').finally(() => { this.reading = null; });
    }
    return this.reading;
  }
  async invoke(kind, action, args = {}, isCurrent) {
    if (kind === 'Volume') {
      if (action === 'SetVolume' || action === 'SetMute') return this.host.requestLocalAction('Volume', action, action === 'SetVolume' ? { volume: Number(args.Value) } : { mute: args.Value === 1 || args.Value === true }, isCurrent);
      const state = await this.host.requestLocalAction('Volume', 'Snapshot');
      const field = { Volume: 'volume', VolumeLimit: 'volumeLimit', Mute: 'mute' }[action];
      if (!field) throw fail('unsupported');
      return { Value: typeof state[field] === 'boolean' ? state[field] ? '1' : '0' : state[field] };
    }
    if (kind === 'Time') {
      const state = await this.snapshot();
      return { Seconds: state.seconds, Duration: state.duration };
    }
    if (action === 'ProtocolInfo') return { Value: 'http-get:*:*:*' };
    if (['IdArray', 'IdArrayChanged', 'TransportState', 'Id', 'Repeat', 'Shuffle', 'TracksMax'].includes(action)) {
      const state = await this.snapshot();
      if (action === 'IdArray') return { Array: state.idArray, Token: state.idArrayToken };
      if (action === 'IdArrayChanged') return { Value: Number(args.Token) !== state.idArrayToken ? '1' : '0' };
      const field = { TransportState: 'transportState', Id: 'currentId', Repeat: 'repeat', Shuffle: 'shuffle', TracksMax: 'tracksMax' }[action];
      return { Value: typeof state[field] === 'boolean' ? (state[field] ? '1' : '0') : state[field] };
    }
    const values = {
      SeekSecondAbsolute: { seconds: args.Value }, SeekId: { id: args.Value }, DeleteId: { id: args.Value },
      SetRepeat: { repeat: args.Value === 1 }, SetShuffle: { shuffle: args.Value === 1 },
      Insert: { afterId: args.AfterId, uri: args.Uri, metadata: args.Metadata },
      ReadList: { idList: String(args.IdList || '').split(' ').filter(Boolean).map(Number) }
    };
    const result = await this.host.requestLocalAction('Playlist', action, values[action] || {}, isCurrent);
    if (action === 'Insert') return { NewId: result.newId };
    if (action === 'ReadList') return result;
    return result;
  }
}

class PwaNetworkHost {
  constructor({ remote, music, player, origin = PWA_ORIGIN }) {
    Object.assign(this, { remote, music, player, origin });
    this.grants = new Map();
    this.grantKey = crypto.randomBytes(32);
    this.trackGrants = new Map();
    this.responses = new Set();
    this.sharing = music.sharing;
    this.permissions = music.gatewayPermissions;
    this.sourceGeneration = music.sourceGeneration;
    this.sharingChanged = () => {
      if (this.sharing !== music.sharing || this.permissions !== music.gatewayPermissions || this.sourceGeneration !== music.sourceGeneration) { this.revoke(); this.sharing = music.sharing; this.permissions = music.gatewayPermissions; this.sourceGeneration = music.sourceGeneration; }
    };
    music.on('state', this.sharingChanged);
  }
  allowed(req) {
    let originAllowed = req.headers.origin === this.origin;
    if (!originAllowed) {
      try {
        const origin = new URL(req.headers.origin);
        originAllowed = origin.origin === req.headers.origin && origin.protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(origin.hostname);
      } catch { /* Missing and malformed origins are not browser clients we trust. */ }
    }
    return originAllowed && (this.remote.isAllowedHost?.(req.headers.host) ?? isAllowedHost(req.headers.host));
  }
  authorized(req) {
    const supplied = Buffer.from(String(req.headers.authorization || ''));
    const expected = Buffer.from(`Bearer ${this.remote.token}`);
    return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
  }
  acceptsUpgrade(req) {
    return req.url?.split('?')[0] === `${PREFIX}effects` && this.allowed(req) && this.remote.listening;
  }
  revoke() {
    this.grants.clear(); this.trackGrants.clear();
    this.grantKey = crypto.randomBytes(32);
    for (const response of this.responses) response.destroy();
    this.responses.clear();
  }
  dispose() { this.revoke(); this.music.removeListener('state', this.sharingChanged); }
  base(req) { return this.remote.endpointOrigin?.() || `${this.remote.secure ? 'https' : 'http'}://${req.headers.host}`; }
  sourceAllowed(serverId) { return serverId === this.music.id || this.music.gatewayPermissions?.libraries === true && (this.music.discovery.devices.get(serverId)?.available === true || this.music.sources?.has(serverId)); }
  targetId(id) {
    if (!id || id === this.player.id) return this.player.controlId;
    if (this.music.gatewayPermissions?.players !== true || !this.music.discovery.devices.get(id)?.available) throw fail('forbidden');
    return id;
  }
  async gatewayTrack({ serverId, trackId, audience, target }, req) {
    if (!this.sourceAllowed(serverId)) throw fail('forbidden');
    if (audience === 'player' && (!target || typeof target.hostId !== 'string' || typeof target.playerId !== 'string')) throw fail('invalidRequest');
    const track = await this.resolveGatewayTrack({ serverId, trackId, target });
    return this.issueGatewayTrack({ serverId, trackId, audience, target }, track, req);
  }
  async resolveGatewayTrack({ serverId, trackId, target }) {
    if (!this.sourceAllowed(serverId)) throw fail('forbidden');
    const permissions = this.music.gatewayPermissions;
    const sourceGeneration = this.music.sourceGeneration;
    const source = this.music.sources?.get(serverId);
    let track = source ? await source.resolve(trackId) : await this.music.resolveTrack({ serverId, trackId });
    if (source && target?.protocolInfo && !track.resources.some(resource => this.music.supportsProtocol(target.protocolInfo, resource.protocolInfo))) {
      track = await source.resolve(trackId, { transcode: true });
      if (!track.resources.some(resource => this.music.supportsProtocol(target.protocolInfo, resource.protocolInfo))) throw fail('unsupportedFormat');
    }
    if (!this.sourceAllowed(serverId) || permissions !== this.music.gatewayPermissions || sourceGeneration !== this.music.sourceGeneration) throw fail('forbidden');
    return this.selectGatewayResource(serverId, track, target);
  }
  selectGatewayResource(serverId, track, target) {
    if (!track.isContainer) {
      const resource = (track.resources || []).find(resource => !target?.protocolInfo || this.music.supportsProtocol(target.protocolInfo, resource.protocolInfo));
      if (!resource) throw fail('unsupportedFormat');
      const uri = resource.uri ? networkUrl(resource.uri).href : this.music.sources?.has(serverId) ? '' : null;
      if (uri === null) throw fail('unsupportedFormat');
      track = { ...track, uri, resources: [resource] };
    }
    return track;
  }
  grantSignature(payload) {
    this.sharingChanged();
    return crypto.createHmac('sha256', this.grantKey).update(this.remote.token).update('\0').update(payload).digest('base64url');
  }
  readGatewayGrant(token) {
    if (token.length === 32) return this.grants.get(token);
    if (token.length <= 43 || token.length > MAX_GRANT_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const payload = token.slice(0, -43); const signature = token.slice(-43);
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(this.grantSignature(payload)))) return null;
    try {
      const [serverId, trackId, hostId, playerId, protocolInfo] = JSON.parse(Buffer.from(payload, 'base64url').toString());
      return { serverId, trackId, audience: 'player', target: { hostId, playerId, protocolInfo }, stateless: true,
        keyGeneration: this.grantKey, token: this.remote.token, permissions: this.music.gatewayPermissions, sourceGeneration: this.music.sourceGeneration };
    } catch { return null; }
  }
  issueGatewayTrack({ serverId, trackId, audience, target }, track, req) {
    track = this.selectGatewayResource(serverId, track, target);
    for (const [id, grant] of this.grants) if (grant.expires < Date.now()) this.grants.delete(id);
    let token;
    if (audience === 'player') {
      // Queues can outlive the browser. A signed source reference needs no retained
      // per-track grant and remains revocable through the same authorization owner.
      const payload = Buffer.from(JSON.stringify([serverId, trackId, target.hostId, target.playerId, track.resources[0].protocolInfo])).toString('base64url');
      if (payload.length + 43 > MAX_GRANT_LENGTH) throw fail('invalidRequest');
      token = payload + this.grantSignature(payload);
    } else {
      token = crypto.randomBytes(24).toString('base64url');
      this.grants.set(token, { serverId, trackId, audience, target, track, token: this.remote.token, expires: Date.now() + 3600000,
        permissions: this.music.gatewayPermissions, sourceGeneration: this.music.sourceGeneration });
    }
    const uri = `${this.base(req)}${PREFIX}media/${token}`;
    const artwork = track.artwork || track.coverArtId ? `${this.base(req)}${PREFIX}artwork/${token}` : '';
    const item = { ...track, uri: track.isContainer ? '' : uri, artwork, resources: (track.resources || []).map(resource => ({ ...resource, uri })) };
    item.metadata = didl([didlItem(item)]);
    return item;
  }
  browserGatewayTrack(serverId, track, req) {
    const intent = { serverId, trackId: track.trackId || track.id, audience: 'browser' };
    if (track.isContainer || (track.resources || []).length < 2) return this.issueGatewayTrack(intent, track, req);
    const variants = track.resources.map(resource => this.issueGatewayTrack(intent, { ...track, uri: resource.uri, resources: [resource] }, req));
    const item = { ...variants[0], resources: variants.flatMap(variant => variant.resources) };
    item.metadata = didl([didlItem(item)]); return item;
  }
  grantCurrent(grant) {
    return grant && this.remote.listening && this.remote.token === grant.token && (grant.stateless ? grant.keyGeneration === this.grantKey : Date.now() < grant.expires) &&
      this.sourceAllowed(grant.serverId) && this.music.gatewayPermissions === grant.permissions && this.music.sourceGeneration === grant.sourceGeneration;
  }
  async validatePlayerTrack(track, playerId) {
    const source = networkUrl(track.uri);
    if (source.search || !/^\/(?:media\/[A-Za-z0-9_-]{32}|pwa\/v1\/media\/[A-Za-z0-9_-]{32,8192})$/.test(source.pathname) || !Array.isArray(track.resources) || !track.resources.length || track.resources.some(resource => resource.uri !== track.uri)) throw fail('invalidRequest');
    if (source.pathname.startsWith('/pwa/')) {
      const token = source.pathname.split('/').at(-1);
      let grant = this.readGatewayGrant(token);
      if (grant) { if (!this.grantCurrent(grant)) throw fail('forbidden'); }
      else {
        const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 8000); timer.unref?.();
        try {
          const response = await fetch(`${source.origin}${PREFIX}grant/${token}`, { redirect: 'error', credentials: 'omit', signal: controller.signal });
          const text = await response.text();
          if (!response.ok || text.length > 4096) throw fail('forbidden');
          grant = JSON.parse(text);
        } catch (error) { throw fail(error.code === 'forbidden' ? 'forbidden' : 'unavailable'); }
        finally { clearTimeout(timer); }
      }
      if (grant?.audience !== 'player' || grant.target?.hostId !== this.music.id || grant.target?.playerId !== (playerId || this.player.id)) throw fail('forbidden');
    }
    let artwork = '';
    try {
      const art = networkUrl(track.artwork);
      if (!art.search && art.origin === source.origin && art.pathname === source.pathname.replace('/media/', '/artwork/')) artwork = art.href;
    } catch { /* Artwork is optional and cannot introduce a separate destination. */ }
    // The peer's metadata is descriptive text, never an independent media route.
    return { ...track, artwork, metadata: didl([didlItem({ ...track, artwork })]) };
  }
  async serveGatewayResource(req, res, grant, kind) {
    const current = () => this.grantCurrent(grant) && (grant.stateless || this.grants.has(grant.key));
    if (!current()) { res.writeHead(404); res.end(); return; }
    if (grant.stateless) grant.track = await this.resolveGatewayTrack(grant);
    const source = this.music.sources?.get(grant.serverId);
    const resource = kind === 'artwork' && source && grant.track.coverArtId ? { uri: source.endpoint('getCoverArt', { id: grant.track.coverArtId, size: 512 }) } :
      await this.music.gatewaySource?.(grant.serverId, grant.trackId, kind, { transcode: grant.track.quality === 'transcoded' }) || { uri: kind === 'artwork' ? grant.track.artwork : grant.track.uri };
    if (!resource.uri || !current()) { res.writeHead(404); res.end(); return; }
    await serveRemoteResource(req, res, resource, current, kind);
  }
  grant(nativeToken, req) {
    const uid = this.music.server.tokens.get(nativeToken);
    if (!uid) return null;
    let token = this.trackGrants.get(nativeToken);
    if (!token) {
      token = crypto.randomBytes(24).toString('base64url');
      this.trackGrants.set(nativeToken, token);
      this.grants.set(token, { uid, nativeToken });
    }
    return { uri: `${this.base(req)}${PREFIX}media/${token}`, artwork: `${this.base(req)}${PREFIX}artwork/${token}` };
  }
  browserTrack(item, req) {
    const publicItem = this.music.publicTrack(item, this.music.id);
    publicItem.mediaKeys = mediaKeys(publicItem);
    const uid = this.music.server.tokens.get((item.id || '').split(':')[1]);
    if (uid) publicItem.mediaKeys.push(...mediaKeys({ uri: `${this.music.id}:catalog:${uid}` }));
    const nativeToken = (item.uri || item.artwork || '').split('/').at(-1);
    const grant = this.grant(nativeToken, req);
    if (!grant) return publicItem;
    publicItem.artwork = grant.artwork;
    publicItem.uri = item.uri ? grant.uri : '';
    publicItem.resources = publicItem.resources.map(resource => ({ ...resource, uri: grant.uri }));
    publicItem.metadata = didl([didlItem(publicItem)]);
    return publicItem;
  }
  async info() {
    const sharing = this.music.sharing.enabled && this.music.server.enabled;
    const state = await this.music.getState();
    return {
      hostId: this.music.id, name: this.player.name, playerId: this.player.id, libraryId: this.music.id,
      queueTracksMax: MAX_QUEUE,
      libraries: this.music.gatewayPermissions?.libraries ? state.libraries.map(({ id, name, available, searchSupported, catalogSearch, sortCaps, browseViews }) => ({ id, name, available, searchSupported, catalogSearch, sortCaps, browseViews })) : [],
      players: this.music.gatewayPermissions?.players ? state.players.map(player => ({ ...player, isEffeTune: false })) : [],
      capabilities: { playback: this.player.available, catalogPlayback: true, effects: this.remote.rendererReady, sharing,
        browseViews: sharing ? VIEWS.map(view => ({ id: view.id, objectId: `view:${view.id}` })) : [],
        searchSupported: sharing, catalogSearch: sharing, sortCaps: sharing ? SORT_CAPS : [] }
    };
  }
  handle(req, res) {
    if (!req.url?.startsWith(PREFIX)) return false;
    void this.serve(req, res).catch(error => {
      this.remote.log('[remote] PWA request failed:', error?.code || 'request-failed', error);
      if (!res.headersSent) this.json(res, error?.code === 'forbidden' ? 403 : error?.code === 'unauthorized' ? 401 : 400, { error: { code: error?.code || 'requestFailed' } });
      else res.destroy();
    });
    return true;
  }
  json(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
  }
  playerState(state, req) {
    const projected = projectPlayback(state, 0, MAX_QUEUE);
    projected.queue = projected.queue.map((item, index) => {
      const track = state.queue[index]; let artwork = '';
      try {
        const media = networkUrl(track.uri); const art = networkUrl(track.artwork);
        if (media.origin === art.origin && !art.search && art.pathname === media.pathname.replace('/media/', '/artwork/')) {
          if (/^\/pwa\/v1\/artwork\/[A-Za-z0-9_-]{32,8192}$/.test(art.pathname)) artwork = art.href;
          else if (req && this.music.server.tokens.has(media.pathname.split('/').at(-1))) artwork = this.grant(media.pathname.split('/').at(-1), req)?.artwork || '';
        }
      } catch { /* Keep unavailable or unrelated artwork out of the browser. */ }
      if (!artwork && req && state.playerId === this.player.controlId && track.libraryTrackId) {
        // Local catalog playback has no media URI; reuse its existing shared-library grant.
        const nativeToken = this.music.server.trackTokens.get(track.libraryTrackId);
        if (nativeToken) artwork = this.grant(nativeToken, req)?.artwork || '';
      }
      return { ...item, artwork, mediaKeys: [...mediaKeys(track),
        ...(state.playerId === this.player.controlId && track.libraryTrackId
          ? mediaKeys({ uri: `${this.music.id}:catalog:${track.libraryTrackId}` }) : [])] };
    });
    return { ...projected, playerId: state.playerId === this.player.controlId ? this.player.id : state.playerId,
      protocolInfo: state.protocolInfo || '', queueOwner: state.queueOwner, tracksMax: MAX_QUEUE };
  }
  async body(req) {
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fail('invalidRequest');
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY) throw fail('invalidRequest');
      chunks.push(chunk);
    }
    const result = JSON.parse(Buffer.concat(chunks).toString());
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw fail('invalidRequest');
    return result;
  }
  async serve(req, res) {
    const route = req.url.split('?')[0].slice(PREFIX.length);
    const media = /^(media|artwork)\/([A-Za-z0-9_-]{32,8192})$/.exec(route);
    const ticket = /^grant\/([A-Za-z0-9_-]{32,8192})$/.exec(route);
    const externalGrant = media ? this.readGatewayGrant(media[2]) : ticket ? this.readGatewayGrant(ticket[1]) : null;
    const rendererRequest = externalGrant?.audience === 'player' && req.headers.origin === undefined;
    if (!this.remote.listening || !(this.allowed(req) || rendererRequest && (this.remote.isAllowedHost?.(req.headers.host) ?? isAllowedHost(req.headers.host)))) { this.json(res, 403, { error: { code: 'forbidden' } }); return; }
    if (!rendererRequest) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    if (req.method === 'OPTIONS') {
      const method = req.headers['access-control-request-method'];
      const headers = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if (!['GET', 'HEAD', 'POST'].includes(method) || headers.some(header => !['authorization', 'content-type', 'range'].includes(header))) { res.writeHead(403); res.end(); return; }
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range', 'Access-Control-Max-Age': '600' }); res.end(); return;
    }
    if (ticket) {
      if (req.method !== 'GET' || externalGrant?.audience !== 'player' || !this.grantCurrent(externalGrant)) { res.writeHead(404); res.end(); return; }
      this.json(res, 200, { audience: externalGrant.audience, target: externalGrant.target }); return;
    }
    if (media) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const grant = externalGrant;
      if (grant?.serverId) {
        grant.key = media[2];
        this.responses.add(res); res.once('close', () => this.responses.delete(res));
        await this.serveGatewayResource(req, res, grant, media[1]); return;
      }
      const isCurrent = () => this.remote.listening && this.grants.get(media[2]) === grant && this.music.server.tokens.get(grant?.nativeToken) === grant?.uid;
      if (!grant || !isCurrent()) { res.writeHead(404); res.end(); return; }
      this.responses.add(res); res.once('close', () => this.responses.delete(res));
      await this.music.server.serveResource(req, res, grant.uid, media[1], isCurrent);
      return;
    }
    if (!this.authorized(req)) { this.json(res, 401, { error: { code: 'unauthorized' } }); return; }
    const token = this.remote.token;
    const permissions = this.music.gatewayPermissions;
    const sourceGeneration = this.music.sourceGeneration;
    const sharing = this.music.sharing;
    const current = () => this.remote.listening && this.remote.token === token && permissions === this.music.gatewayPermissions && sourceGeneration === this.music.sourceGeneration;
    let result;
    if (route === 'info' && req.method === 'GET') result = await this.info();
    else if (route === 'player' && req.method === 'GET') result = await this.music.getPlayerState({ playerId: this.targetId(new URL(req.url, this.base(req)).searchParams.get('playerId')) });
    else if (req.method === 'POST') {
      const input = await this.body(req);
      if (!current()) throw fail(this.remote.token === token ? 'forbidden' : 'unauthorized');
      if (route === 'browse') {
        const serverId = input.serverId || this.music.id;
        if (!this.sourceAllowed(serverId)) throw fail('forbidden');
        const objectId = input.objectId ?? '0';
        if (typeof objectId !== 'string' || objectId.length > 256 || typeof (input.query ?? '') !== 'string') throw fail('invalidRequest');
        const start = uint(input.start ?? 0); const count = uint(input.count ?? 100, 500);
        if (serverId !== this.music.id) {
          const page = await this.music.browse({ ...input, serverId, objectId, start, count: Math.max(1, count) });
          result = { ...page, items: page.items.map(item => this.browserGatewayTrack(serverId, item, req)) };
        } else {
        const page = await this.music.browseShared({ objectId, start, count: Math.max(1, count), sort: parseSort(input.sortCriteria ?? ''), catalogQuery: input.query || null, address: req.socket.localAddress.replace(/^::ffff:/, '') });
        result = { ...page, start, numberReturned: page.items.length, updateId: this.music.server.updateId, items: page.items.map(item => this.browserTrack(item, req)) };
        }
      } else if (route === 'resolve') {
        if (typeof input.trackId !== 'string' || !['browser', 'player'].includes(input.audience)) throw fail('invalidRequest');
        if (input.serverId && input.serverId !== this.music.id) result = await this.gatewayTrack(input, req);
        else {
        const page = await this.music.browseShared({ objectId: input.trackId, metadata: true, address: req.socket.localAddress.replace(/^::ffff:/, '') });
        const track = page.items[0];
        if (!track || track.isContainer || !track.playable) throw fail('unsupportedFormat');
        await this.music.sharedSource(this.music.server.tokens.get(input.trackId.split(':')[1]));
        result = input.audience === 'browser' ? this.browserTrack(track, req) : this.music.publicTrack(track, this.music.id);
        }
      } else if (route === 'player') {
        let items;
        if (input.items !== undefined) {
          if (input.tracks !== undefined || this.targetId(input.playerId) !== this.player.controlId ||
              !Array.isArray(input.items) || !input.items.length || input.items.length > MAX_QUEUE) throw fail('invalidSelection');
          items = [];
          for (const item of input.items) {
            if (typeof item?.trackId !== 'string' || item.trackId.length > 256 || !item.trackId.startsWith('track:')) throw fail('invalidRequest');
            const uid = this.music.server.tokens.get(item.trackId.split(':')[1]);
            if (!uid) throw fail('trackUnavailable');
            await this.music.sharedSource(uid);
            items.push({ serverId: 'local', trackId: uid });
          }
        }
        let tracks;
        if (input.tracks !== undefined) {
          if (!Array.isArray(input.tracks) || input.tracks.length > MAX_QUEUE) throw fail('invalidSelection');
          this.targetId(input.playerId);
          tracks = [];
          for (const track of input.tracks) {
            if (typeof track.metadata !== 'string' || track.metadata.length > 65536 || !Array.isArray(track.resources)) throw fail('invalidRequest');
            tracks.push(await this.validatePlayerTrack(track, input.playerId));
          }
        }
        const { action, seconds, value, id, afterId, position, play, startIndex } = input;
        const isAuthorized = () => current() && (!items || sharing === this.music.sharing && sharing.enabled && this.music.server.enabled) &&
          (!input.playerId || input.playerId === this.player.id || this.music.gatewayPermissions?.players === true);
        const command = { playerId: this.targetId(input.playerId), action, seconds, value, id, items, tracks, afterId, position, play, startIndex, gatewayResolved: true, isCurrent: () => current() && isAuthorized(), isAuthorized };
        try { result = await this.music.playerCommand(command); }
        catch (error) {
          if (!command.mutationStarted || !current()) throw error;
          let playback;
          try { playback = this.playerState(await this.music.getPlayerState({ playerId: command.playerId }), req); }
          catch (stateError) { this.music.onDiagnostic(stateError); }
          this.json(res, 409, { error: { code: error.code || 'requestFailed' }, outcome: 'unknown', ...(playback ? { playback } : {}) }); return;
        }
      } else { this.json(res, 404, { error: { code: 'unsupported' } }); return; }
    } else { this.json(res, 404, { error: { code: 'unsupported' } }); return; }
    if (!current()) { this.json(res, this.remote.token === token ? 403 : 401, { error: { code: this.remote.token === token ? 'forbidden' : 'unauthorized' } }); return; }
    this.json(res, 200, route === 'player' ? this.playerState(result, req) : result);
  }
}

module.exports = { PwaNetworkHost, LocalOpenHomePlayer, PWA_ORIGIN };
