'use strict';

const crypto = require('node:crypto');
const { isAllowedHost } = require('./remote-static-server.cjs');
const { VIEWS, SORT_CAPS, parseSort } = require('./network-music-content.cjs');
const { didl, didlItem, networkUrl } = require('./network-music-upnp.cjs');
const { MAX_QUEUE } = require('./network-music-host.cjs');

const PWA_ORIGIN = 'https://effetune.frieve.com';
const PREFIX = '/pwa/v1/';
const MAX_BODY = 16 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), { code });
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
    this.services = new Map(['Playlist', 'Time'].map(kind => [
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
    this.trackGrants = new Map();
    this.responses = new Set();
    this.sharing = music.sharing;
    this.sharingChanged = () => {
      if (this.sharing !== music.sharing) { this.revoke(); this.sharing = music.sharing; }
    };
    music.on('state', this.sharingChanged);
  }
  allowed(req) {
    return req.headers.origin === this.origin && isAllowedHost(req.headers.host);
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
    for (const response of this.responses) response.destroy();
    this.responses.clear();
  }
  dispose() { this.revoke(); this.music.removeListener('state', this.sharingChanged); }
  base(req) { return `${this.remote.secure ? 'https' : 'http'}://${req.headers.host}`; }
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
    const nativeToken = (item.uri || item.artwork || '').split('/').at(-1);
    const grant = this.grant(nativeToken, req);
    if (!grant) return publicItem;
    publicItem.artwork = grant.artwork;
    publicItem.uri = item.uri ? grant.uri : '';
    publicItem.resources = publicItem.resources.map(resource => ({ ...resource, uri: grant.uri }));
    publicItem.metadata = didl([didlItem(publicItem)]);
    return publicItem;
  }
  info() {
    const sharing = this.music.sharing.enabled && this.music.server.enabled;
    return {
      hostId: this.music.id, name: this.player.name, playerId: this.player.id, libraryId: this.music.id,
      queueTracksMax: MAX_QUEUE,
      capabilities: { playback: this.player.available, effects: this.remote.rendererReady, sharing,
        browseViews: sharing ? VIEWS.map(view => ({ id: view.id, objectId: `view:${view.id}` })) : [],
        searchSupported: sharing, catalogSearch: sharing, sortCaps: sharing ? SORT_CAPS : [] }
    };
  }
  handle(req, res) {
    if (!req.url?.startsWith(PREFIX)) return false;
    void this.serve(req, res).catch(error => {
      this.remote.log('[remote] PWA request failed:', error?.code || 'request-failed');
      if (!res.headersSent) this.json(res, 400, { error: { code: error?.code || 'requestFailed' } });
      else res.destroy();
    });
    return true;
  }
  json(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
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
    if (!this.remote.listening || !this.allowed(req)) { this.json(res, 403, { error: { code: 'forbidden' } }); return; }
    res.setHeader('Access-Control-Allow-Origin', this.origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    if (req.method === 'OPTIONS') {
      const method = req.headers['access-control-request-method'];
      const headers = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
      if (!['GET', 'HEAD', 'POST'].includes(method) || headers.some(header => !['authorization', 'content-type', 'range'].includes(header))) { res.writeHead(403); res.end(); return; }
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, Range', 'Access-Control-Max-Age': '600' }); res.end(); return;
    }
    const route = req.url.split('?')[0].slice(PREFIX.length);
    const media = /^(media|artwork)\/([A-Za-z0-9_-]{32})$/.exec(route);
    if (media) {
      if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
      const grant = this.grants.get(media[2]);
      const isCurrent = () => this.remote.listening && this.grants.get(media[2]) === grant && this.music.server.tokens.get(grant?.nativeToken) === grant?.uid;
      if (!grant || !isCurrent()) { res.writeHead(404); res.end(); return; }
      this.responses.add(res); res.once('close', () => this.responses.delete(res));
      await this.music.server.serveResource(req, res, grant.uid, media[1], isCurrent);
      return;
    }
    if (!this.authorized(req)) { this.json(res, 401, { error: { code: 'unauthorized' } }); return; }
    const token = this.remote.token;
    const current = () => this.remote.listening && this.remote.token === token;
    let result;
    if (route === 'info' && req.method === 'GET') result = this.info();
    else if (route === 'player' && req.method === 'GET') result = await this.music.getPlayerState({ playerId: this.player.controlId });
    else if (req.method === 'POST') {
      const input = await this.body(req);
      if (!current()) throw fail('unauthorized');
      if (route === 'browse') {
        const objectId = input.objectId ?? '0';
        if (typeof objectId !== 'string' || objectId.length > 256 || typeof (input.query ?? '') !== 'string') throw fail('invalidRequest');
        const start = uint(input.start ?? 0); const count = uint(input.count ?? 100, 500);
        const page = await this.music.browseShared({ objectId, start, count: Math.max(1, count), sort: parseSort(input.sortCriteria ?? ''), catalogQuery: input.query || null, address: req.socket.localAddress.replace(/^::ffff:/, '') });
        result = { ...page, start, numberReturned: page.items.length, updateId: this.music.server.updateId, items: page.items.map(item => this.browserTrack(item, req)) };
      } else if (route === 'resolve') {
        if (typeof input.trackId !== 'string' || !['browser', 'player'].includes(input.audience)) throw fail('invalidRequest');
        const page = await this.music.browseShared({ objectId: input.trackId, metadata: true, address: req.socket.localAddress.replace(/^::ffff:/, '') });
        const track = page.items[0];
        if (!track || track.isContainer || !track.playable) throw fail('unsupportedFormat');
        await this.music.sharedSource(this.music.server.tokens.get(input.trackId.split(':')[1]));
        result = input.audience === 'browser' ? this.browserTrack(track, req) : this.music.publicTrack(track, this.music.id);
      } else if (route === 'player') {
        if (input.tracks !== undefined) {
          if (!Array.isArray(input.tracks) || input.tracks.length > MAX_QUEUE) throw fail('invalidSelection');
          for (const track of input.tracks) {
            networkUrl(track.uri);
            if (typeof track.metadata !== 'string' || track.metadata.length > 65536 || !Array.isArray(track.resources)) throw fail('invalidRequest');
            for (const resource of track.resources) networkUrl(resource.uri);
          }
        }
        const { action, seconds, value, id, tracks, afterId, position, play, startIndex } = input;
        result = await this.music.playerCommand({ playerId: this.player.controlId, action, seconds, value, id, tracks, afterId, position, play, startIndex, isCurrent: current });
      } else { this.json(res, 404, { error: { code: 'unsupported' } }); return; }
    } else { this.json(res, 404, { error: { code: 'unsupported' } }); return; }
    if (!current()) { this.json(res, 401, { error: { code: 'unauthorized' } }); return; }
    this.json(res, 200, route === 'player' ? { ...result, playerId: this.player.id, tracksMax: MAX_QUEUE } : result);
  }
}

module.exports = { PwaNetworkHost, LocalOpenHomePlayer, PWA_ORIGIN };
