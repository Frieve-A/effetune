'use strict';

const http = require('node:http');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const net = require('node:net');
const { pipeline } = require('node:stream');
const { serveRemoteResource } = require('./network-music-resource.cjs');
const { CONTENT, CONNECTION, SsdpAdvertisement, xml, parseXml, descendants, value, didl, didlItem, interfaces, isLanAddress, networkUrl } = require('./network-music-upnp.cjs');
const { SEARCH_CAPS, SORT_CAPS, parseSearch, parseSort } = require('./network-music-content.cjs');

const TYPES = Object.freeze({ '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'audio/webm' });
const SOURCE_PROTOCOLS = [...new Set(Object.values(TYPES))].map(type => `http-get:*:${type}:*`).join(',');
const ACTIONS = {
  ContentDirectory: {
    GetSearchCapabilities: [['SearchCaps', 'out', 'string']], GetSortCapabilities: [['SortCaps', 'out', 'string']], GetSystemUpdateID: [['Id', 'out', 'ui4']],
    Browse: [['ObjectID', 'in', 'string'], ['BrowseFlag', 'in', 'string'], ['Filter', 'in', 'string'], ['StartingIndex', 'in', 'ui4'], ['RequestedCount', 'in', 'ui4'], ['SortCriteria', 'in', 'string'], ['Result', 'out', 'string'], ['NumberReturned', 'out', 'ui4'], ['TotalMatches', 'out', 'ui4'], ['UpdateID', 'out', 'ui4']],
    Search: [['ContainerID', 'in', 'string'], ['SearchCriteria', 'in', 'string'], ['Filter', 'in', 'string'], ['StartingIndex', 'in', 'ui4'], ['RequestedCount', 'in', 'ui4'], ['SortCriteria', 'in', 'string'], ['Result', 'out', 'string'], ['NumberReturned', 'out', 'ui4'], ['TotalMatches', 'out', 'ui4'], ['UpdateID', 'out', 'ui4']]
  },
  ConnectionManager: { GetProtocolInfo: [['Source', 'out', 'string'], ['Sink', 'out', 'string']], GetCurrentConnectionIDs: [['ConnectionIDs', 'out', 'string']], GetCurrentConnectionInfo: [['ConnectionID', 'in', 'i4'], ['RcsID', 'out', 'i4'], ['AVTransportID', 'out', 'i4'], ['ProtocolInfo', 'out', 'string'], ['PeerConnectionManager', 'out', 'string'], ['PeerConnectionID', 'out', 'i4'], ['Direction', 'out', 'string'], ['Status', 'out', 'string']] }
};
ACTIONS.ContentDirectory.X_EffeTune_Search = ACTIONS.ContentDirectory.Search.map(([name, direction, type]) => [name === 'SearchCriteria' ? 'Query' : name, direction, type]);
function scpd(name) {
  const definitions = ACTIONS[name];
  const args = new Map();
  const actions = Object.entries(definitions).map(([action, fields]) => `<action><name>${action}</name><argumentList>${fields.map(([key, direction, type]) => { args.set(key, type); return `<argument><name>${key}</name><direction>${direction}</direction><relatedStateVariable>A_ARG_TYPE_${key}</relatedStateVariable></argument>`; }).join('')}</argumentList></action>`).join('');
  const eventFields = name === 'ContentDirectory' ? { SystemUpdateID: ['ui4', '0'] } : { SourceProtocolInfo: ['string', SOURCE_PROTOCOLS], SinkProtocolInfo: ['string', ''], CurrentConnectionIDs: ['string', ''] };
  return `<?xml version="1.0"?><scpd xmlns="urn:schemas-upnp-org:service-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><actionList>${actions}</actionList><serviceStateTable>${[...args].map(([key, type]) => `<stateVariable sendEvents="no"><name>A_ARG_TYPE_${key}</name><dataType>${type}</dataType></stateVariable>`).join('')}${Object.entries(eventFields).map(([key, [type, initial]]) => `<stateVariable sendEvents="yes"><name>${key}</name><dataType>${type}</dataType><defaultValue>${xml(initial)}</defaultValue></stateVariable>`).join('')}</serviceStateTable></scpd>`;
}
function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return null;
  let start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  let end = match[1] ? (match[2] ? Number(match[2]) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  end = Math.min(end, size - 1);
  return { start, end, partial: true };
}
class MusicServer {
  constructor({ id, name, getName = () => name, discovery, browse, resolveSource, getArtwork, advertise = true, onDiagnostic = () => {} }) {
    Object.assign(this, { id, getName, discovery, browse, resolveSource, getArtwork, advertise, onDiagnostic });
    this.server = null; this.port = 0; this.enabled = false; this.tokens = new Map(); this.trackTokens = new Map(); this.streams = new Set(); this.subscribers = new Map(); this.updateId = 0;
    this.resourceTargets = new Map();
    this.advertisement = new SsdpAdvertisement({ discovery, getDescription: () => this.enabled && this.advertise ? { id: this.id, targets: this.targets(), location: address => `${this.base(address)}/device.xml?name=${encodeURIComponent(this.name)}` } : null, onDiagnostic });
  }
  get name() { return this.getName(); }
  start() {
    if (!this.startPromise) this.startPromise = this.open().catch(error => { this.startPromise = null; throw error; });
    return this.startPromise;
  }
  async open() {
    if (this.server) return;
    const server = http.createServer((req, res) => { void this.handle(req, res).catch(error => { this.onDiagnostic(error); if (!res.headersSent) res.writeHead(500); res.end(); }); });
    server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxHeadersCount = 32;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); }); });
    server.on('error', this.onDiagnostic); this.server = server; this.port = server.address().port; this.enabled = true;
    if (this.advertise) this.advertisement.start();
  }
  base(address) { return `http://${address || interfaces()[0]}:${this.port}`; }
  targets() { return ['upnp:rootdevice', this.id, 'urn:schemas-upnp-org:device:MediaServer:1', CONTENT, CONNECTION]; }
  resource(trackUid, address, targetAddress = null) {
    if (targetAddress !== null) {
      targetAddress = targetAddress.replace(/^::ffff:/, '');
      if (!net.isIP(targetAddress)) throw new Error('The playback device address could not be verified');
    }
    let token = this.trackTokens.get(trackUid);
    if (!token) { token = crypto.randomBytes(24).toString('base64url'); this.trackTokens.set(trackUid, token); this.tokens.set(token, trackUid); }
    if (targetAddress) this.resourceTargets.set(token, targetAddress);
    return { uri: `${this.base(address)}/media/${token}`, artwork: `${this.base(address)}/artwork/${token}` };
  }
  rendererResource(trackUid) {
    this.resource(trackUid, '127.0.0.1', '127.0.0.1');
    const token = this.trackTokens.get(trackUid);
    const base = `${this.base('127.0.0.1')}/openhome-media/`;
    return { uri: `${base}${token}`, artwork: `${base}artwork/${token}` };
  }
  revokeSource(uid) {
    const token = this.trackTokens.get(uid);
    this.trackTokens.delete(uid); this.tokens.delete(token); this.resourceTargets.delete(token);
    for (const response of this.resourceResponses?.get(uid) || []) response.destroy();
    this.resourceResponses?.delete(uid);
  }
  revoke() {
    this.tokens.clear(); this.trackTokens.clear(); this.resourceTargets.clear(); this.updateId = (this.updateId + 1) >>> 0;
    for (const stream of this.streams) stream.destroy();
    this.streams.clear();
    for (const responses of this.resourceResponses?.values() || []) for (const response of responses) response.destroy();
    this.resourceResponses?.clear();
    for (const subscription of this.subscribers.values()) this.notify(subscription);
  }
  async close() {
    await this.startPromise?.catch(this.onDiagnostic);
    const announcement = this.advertisement.stop(); this.enabled = false; this.revoke(); this.subscribers.clear();
    const server = this.server; this.server = null; this.startPromise = null; this.port = 0;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await announcement;
  }
  description() {
    return `<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0"><specVersion><major>1</major><minor>0</minor></specVersion><device><deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType><friendlyName>${xml(this.name)}</friendlyName><manufacturer>EffeTune</manufacturer><modelName>EffeTune Music Library</modelName><UDN>${xml(this.id)}</UDN><serviceList>${['ContentDirectory', 'ConnectionManager'].map(name => `<service><serviceType>urn:schemas-upnp-org:service:${name}:1</serviceType><serviceId>urn:upnp-org:serviceId:${name}</serviceId><SCPDURL>/${name}.xml</SCPDURL><controlURL>/control/${name}</controlURL><eventSubURL>/event/${name}</eventSubURL></service>`).join('')}</serviceList></device></root>`;
  }
  async handle(req, res) {
    const remote = req.socket.remoteAddress?.replace(/^::ffff:/, '');
    if (!this.enabled || !isLanAddress(remote ?? '')) { res.writeHead(403); res.end(); return; }
    const route = req.url?.split('?')[0];
    const rendererRoute = route?.startsWith('/openhome-media/');
    if (rendererRoute) {
      if (remote !== '127.0.0.1') { res.writeHead(403); res.end(); return; }
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, Content-Type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS', 'Access-Control-Allow-Headers': 'Range' });
        res.end(); return;
      }
    }
    if (!this.advertise && !route?.startsWith('/media/') && !route?.startsWith('/artwork/') && !rendererRoute) { res.writeHead(404); res.end(); return; }
    if (route?.startsWith('/event/')) { this.subscription(req, res, route.slice(7), remote); return; }
    if (req.method === 'POST' && route?.startsWith('/control/')) { await this.control(req, res, route.slice(9)); return; }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    if (route === '/device.xml' || ['/ContentDirectory.xml', '/ConnectionManager.xml'].includes(route)) {
      const body = route === '/device.xml' ? this.description() : scpd(route.slice(1, -4));
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }); res.end(req.method === 'HEAD' ? undefined : body); return;
    }
    const match = rendererRoute
      ? /^\/openhome-media\/(?:(artwork)\/)?([a-zA-Z0-9_-]{32})$/.exec(route)
      : /^\/(media|artwork)\/([a-zA-Z0-9_-]{32})$/.exec(route ?? '');
    const uid = match && this.tokens.get(match[2]);
    if (!uid) { res.writeHead(404); res.end(); return; }
    if (this.resourceTargets.has(match[2]) && this.resourceTargets.get(match[2]) !== remote) { res.writeHead(403); res.end(); return; }
    await this.serveResource(req, res, uid, match[1] || 'media', () => this.enabled && this.tokens.get(match[2]) === uid);
  }
  async serveResource(req, res, uid, kind, isCurrent) {
    this.resourceResponses ||= new Map();
    if (!this.resourceResponses.has(uid)) this.resourceResponses.set(uid, new Set());
    const responses = this.resourceResponses.get(uid); responses.add(res);
    res.once('close', () => { responses.delete(res); if (!responses.size) this.resourceResponses.delete(uid); });
    let source;
    try { source = await this.resolveSource(uid); } catch { res.writeHead(404); res.end(); return; }
    if (!isCurrent()) { res.writeHead(404); res.end(); return; }
    if (source.remote) return serveRemoteResource(req, res, await source.resource(kind), () => isCurrent() && source.isCurrent(), kind, this.streams);
    if (kind === 'artwork') {
      const artwork = await this.getArtwork(uid);
      const bytes = artwork?.bytes ? Buffer.from(artwork.bytes) : null;
      if (!bytes || !isCurrent()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': artwork.mimeType || 'image/jpeg', 'Content-Length': bytes.length }); res.end(req.method === 'HEAD' ? undefined : bytes); return;
    }
    const handle = await fs.promises.open(source.path, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || !isCurrent()) { await handle.close(); res.writeHead(404); res.end(); return; }
    const range = byteRange(req.headers.range, stat.size);
    if (!range) { await handle.close(); res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); res.end(); return; }
    const headers = { 'Content-Type': TYPES[path.extname(source.path).toLowerCase()] || 'application/octet-stream', 'Content-Length': Math.max(0, range.end - range.start + 1), 'Accept-Ranges': 'bytes', 'transferMode.dlna.org': 'Streaming' };
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
    res.writeHead(range.partial ? 206 : 200, headers);
    if (req.method === 'HEAD' || stat.size === 0) { await handle.close(); res.end(); return; }
    const stream = handle.createReadStream({ start: range.start, end: range.end }); this.streams.add(stream);
    pipeline(stream, res, error => { this.streams.delete(stream); if (error && !res.destroyed) res.destroy(error); });
  }
  async control(req, res, name) {
    const serviceType = name === 'ContentDirectory' ? CONTENT : name === 'ConnectionManager' ? CONNECTION : null;
    if (!serviceType) { res.writeHead(404); res.end(); return; }
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 65536) { res.writeHead(413); res.end(); return; } chunks.push(chunk); }
    try {
      const envelope = parseXml(Buffer.concat(chunks).toString());
      const action = descendants(envelope, 'Body')[0]?.children[0];
      if (!action || !Object.hasOwn(ACTIONS[name], action.name)) throw new Error('401');
      let result;
      if (action.name === 'Browse' || action.name === 'Search' || action.name === 'X_EffeTune_Search') {
        const isCatalogSearch = action.name === 'X_EffeTune_Search';
        const isSearch = action.name === 'Search' || isCatalogSearch;
        if (!isSearch && !['BrowseMetadata', 'BrowseDirectChildren'].includes(value(action, 'BrowseFlag'))) throw new Error('402');
        const sort = parseSort(value(action, 'SortCriteria'));
        const search = isSearch && !isCatalogSearch ? parseSearch(value(action, 'SearchCriteria')) : null;
        const catalogQuery = isCatalogSearch ? value(action, 'Query') : null;
        const start = Number(value(action, 'StartingIndex')); const count = Number(value(action, 'RequestedCount'));
        if (!Number.isSafeInteger(start) || start < 0 || start > 0xffffffff || !Number.isSafeInteger(count) || count < 0 || count > 0xffffffff) throw new Error('402');
        const objectId = value(action, isSearch ? 'ContainerID' : 'ObjectID');
        const updateId = this.updateId;
        const page = await this.browse({ objectId, metadata: !isSearch && value(action, 'BrowseFlag') === 'BrowseMetadata', start, count: Math.min(count || 500, 500), sort, search, catalogQuery, address: req.socket.localAddress.replace(/^::ffff:/, '') });
        result = { Result: didl(page.items.map(item => didlItem(item, item.parentId ?? objectId))), NumberReturned: page.items.length, TotalMatches: page.total, UpdateID: updateId };
      } else if (action.name === 'GetSearchCapabilities') result = { SearchCaps: SEARCH_CAPS.join(',') };
      else if (action.name === 'GetSortCapabilities') result = { SortCaps: SORT_CAPS.join(',') };
      else if (action.name === 'GetSystemUpdateID') result = { Id: this.updateId };
      else if (action.name === 'GetProtocolInfo') result = { Source: SOURCE_PROTOCOLS, Sink: '' };
      else if (action.name === 'GetCurrentConnectionIDs') result = { ConnectionIDs: '' };
      else throw new Error('706');
      const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action.name}Response xmlns:u="${serviceType}">${Object.entries(result).map(([key, val]) => `<${key}>${xml(val)}</${key}>`).join('')}</u:${action.name}Response></s:Body></s:Envelope>`;
      res.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' }); res.end(body);
    } catch (error) {
      this.onDiagnostic(error);
      const code = /^\d{3}$/.test(error.message) ? error.message : '701';
      res.writeHead(500, { 'Content-Type': 'text/xml; charset=utf-8' });
      res.end(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>UPnPError</faultstring><detail><UPnPError xmlns="urn:schemas-upnp-org:control-1-0"><errorCode>${code}</errorCode><errorDescription>Request could not be completed</errorDescription></UPnPError></detail></s:Fault></s:Body></s:Envelope>`);
    }
  }
  subscription(req, res, name, remote) {
    if (!Object.hasOwn(ACTIONS, name)) { res.writeHead(404); res.end(); return; }
    for (const [sid, entry] of this.subscribers) if (entry.expires < Date.now()) this.subscribers.delete(sid);
    const previous = this.subscribers.get(req.headers.sid);
    if (req.method === 'UNSUBSCRIBE' && previous?.remote === remote) { this.subscribers.delete(req.headers.sid); res.writeHead(200); res.end(); return; }
    if (req.method !== 'SUBSCRIBE') { res.writeHead(405); res.end(); return; }
    let entry = previous;
    if (entry && entry.remote !== remote) entry = null;
    if (!req.headers.sid && this.subscribers.size < 64 && req.headers.nt === 'upnp:event') {
      try {
        const callback = networkUrl((req.headers.callback ?? '').replace(/^<|>$/g, ''));
        if (callback.hostname === remote && callback.protocol === 'http:') entry = { sid: `uuid:${crypto.randomUUID()}`, callback, remote, name, seq: 0 };
      } catch { /* Invalid callbacks are rejected without making a request. */ }
    }
    if (!entry) { res.writeHead(412); res.end(); return; }
    entry.expires = Date.now() + 1800000; this.subscribers.set(entry.sid, entry);
    res.writeHead(200, { SID: entry.sid, TIMEOUT: 'Second-1800' }); res.end();
    if (!previous) setImmediate(() => this.notify(entry));
  }
  notify(entry) {
    if (entry.expires < Date.now()) return;
    const properties = entry.name === 'ContentDirectory' ? { SystemUpdateID: this.updateId } : { SourceProtocolInfo: SOURCE_PROTOCOLS, SinkProtocolInfo: '', CurrentConnectionIDs: '' };
    const body = `<e:propertyset xmlns:e="urn:schemas-upnp-org:event-1-0">${Object.entries(properties).map(([key, val]) => `<e:property><${key}>${xml(val)}</${key}></e:property>`).join('')}</e:propertyset>`;
    const req = http.request(entry.callback, { method: 'NOTIFY', timeout: 3000, headers: { NT: 'upnp:event', NTS: 'upnp:propchange', SID: entry.sid, SEQ: entry.seq++, 'Content-Type': 'text/xml', 'Content-Length': Buffer.byteLength(body) } }, res => res.resume());
    req.on('error', this.onDiagnostic); req.on('timeout', () => req.destroy()); req.end(body);
  }
}

module.exports = { MusicServer, byteRange, scpd, TYPES, SOURCE_PROTOCOLS };
