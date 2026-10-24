'use strict';

const http = require('node:http');
const https = require('node:https');
const dgram = require('node:dgram');
const os = require('node:os');
const { EventEmitter } = require('node:events');

const CONTENT = 'urn:schemas-upnp-org:service:ContentDirectory:1';
const CONNECTION = 'urn:schemas-upnp-org:service:ConnectionManager:1';
const PLAYLIST = 'urn:av-openhome-org:service:Playlist:1';
const REMOTE_CONTROL = 'urn:effetune-org:service:RemoteControl:1';
const METADATA = 'urn:effetune-org:metadata-1-0';
const MULTICAST = '239.255.255.250';
const xml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const decode = value => value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, entity) => {
  if (entity[0] !== '#') return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[entity] ?? whole;
  const code = entity[1] === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
});

// A bounded, non-validating XML reader: no DTDs, external entities, or expansion.
function parseXml(source) {
  if (typeof source !== 'string' || source.length > 4 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error('Invalid device response');
  const root = { name: '', children: [], text: '', attrs: Object.create(null) };
  const stack = [root];
  const tokens = source.match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]*>|[^<]+/g) ?? [];
  for (const token of tokens) {
    if (token.startsWith('<?') || token.startsWith('<!--')) continue;
    if (token.startsWith('<![CDATA[')) { stack.at(-1).text += token.slice(9, -3); continue; }
    if (token.startsWith('</')) {
      if (stack.length === 1 || stack.at(-1).qualified !== token.slice(2, -1).trim()) throw new Error('Invalid device response');
      stack.pop();
    } else if (token[0] === '<') {
      const match = /^<([\w:.-]+)/.exec(token);
      if (!match || stack.length > 64) throw new Error('Invalid device response');
      const node = { name: match[1].split(':').at(-1), qualified: match[1], children: [], text: '', attrs: Object.create(null), namespaces: { ...stack.at(-1).namespaces } };
      for (const attr of token.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[attr[1]] = decode(attr[2] ?? attr[3]);
      for (const [key, uri] of Object.entries(node.attrs)) if (key === 'xmlns' || key.startsWith('xmlns:')) node.namespaces[key === 'xmlns' ? '' : key.slice(6)] = uri;
      stack.at(-1).children.push(node);
      if (!token.endsWith('/>')) stack.push(node);
    } else stack.at(-1).text += decode(token);
  }
  if (stack.length !== 1) throw new Error('Invalid device response');
  return root;
}
const children = (node, name) => (node?.children ?? []).filter(child => child.name === name);
const child = (node, name) => children(node, name)[0];
const value = (node, name) => child(node, name)?.text ?? '';
function descendants(node, name) { return (node?.children ?? []).flatMap(item => [...(item.name === name ? [item] : []), ...descendants(item, name)]); }
function interfaces() { return Object.values(os.networkInterfaces()).flat().filter(item => item?.family === 'IPv4' && !item.internal).map(item => item.address); }
function isLanAddress(address) { return /^(10\.|192\.168\.|169\.254\.|127\.)/.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address); }
function networkUrl(input, base) {
  const url = new URL(input, base);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Unsupported music address');
  return url;
}
function requestXml(input, { method = 'GET', headers = {}, body = '' } = {}) {
  const url = networkUrl(input);
  return new Promise((resolve, reject) => {
    const req = (url.protocol === 'https:' ? https : http).request(url, { method, headers, timeout: 8000 }, res => {
      const chunks = []; let bytes = 0;
      res.on('data', data => { bytes += data.length; if (bytes > 4 * 1024 * 1024) req.destroy(new Error('Device response too large')); else chunks.push(data); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = Object.assign(new Error(`Device request failed (${res.statusCode})`), { httpStatus: res.statusCode });
          try {
            const fault = descendants(parseXml(text), 'UPnPError')[0];
            if (fault) { error.upnpCode = value(fault, 'errorCode'); error.upnpDescription = value(fault, 'errorDescription'); }
          } catch { /* Keep the HTTP diagnostic when the peer did not return a SOAP fault. */ }
          reject(error);
        }
        else { try { resolve(parseXml(text)); } catch (error) { reject(error); } }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Music device did not respond')));
    req.on('error', reject);
    req.end(body);
  });
}
async function soap(service, action, args = {}) {
  if (!service) throw new Error('This player does not support this operation');
  const body = `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${xml(service.type)}">${Object.entries(args).map(([key, val]) => `<${key}>${xml(val)}</${key}>`).join('')}</u:${action}></s:Body></s:Envelope>`;
  let result;
  try { result = await requestXml(service.control, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${service.type}#${action}"`, 'Content-Length': Buffer.byteLength(body) }, body }); }
  catch (error) { Object.assign(error, { upnpService: service.type, upnpAction: action }); throw error; }
  const response = descendants(result, `${action}Response`)[0];
  if (!response) throw new Error('Music device returned an invalid response');
  return Object.fromEntries(response.children.map(item => [item.name, item.text]));
}
function parseDidl(text) {
  const vendor = (item, name) => item.children.find(node => node.name === name && node.namespaces?.[node.qualified.includes(':') ? node.qualified.split(':')[0] : ''] === METADATA)?.text ?? '';
  const optionalNumber = text => text !== '' && Number.isFinite(Number(text)) ? Number(text) : null;
  return descendants(parseXml(text), 'DIDL-Lite').flatMap(root => root.children).map(item => ({
    id: item.attrs.id, parentId: item.attrs.parentID, title: value(item, 'title'), artist: value(item, 'artist'), album: value(item, 'album'),
    isContainer: item.name === 'container', artwork: value(item, 'albumArtURI'), upnpClass: value(item, 'class'),
    childCount: optionalNumber(item.attrs.childCount ?? ''), refId: item.attrs.refID || '',
    genre: value(item, 'genre'), trackNo: optionalNumber(value(item, 'originalTrackNumber')), date: value(item, 'date'),
    viewId: vendor(item, 'view'), addedAt: optionalNumber(vendor(item, 'addedAt')), displayPath: vendor(item, 'displayPath'),
    trackCount: optionalNumber(vendor(item, 'trackCount')), totalDurationSec: optionalNumber(vendor(item, 'totalDurationSec')),
    flatObjectId: vendor(item, 'flatObjectId'), treeObjectId: vendor(item, 'treeObjectId'),
    albumObjectId: vendor(item, 'albumObjectId'), artistObjectId: vendor(item, 'artistObjectId'),
    catalogSearch: vendor(item, 'catalogSearch') === '1',
    resources: children(item, 'res').map(resource => ({ uri: resource.text, protocolInfo: resource.attrs.protocolInfo ?? '', duration: resource.attrs.duration ?? '', size: resource.attrs.size ?? '' }))
  }));
}
function didlItem(item, parentId = '0') {
  const tag = item.isContainer ? 'container' : 'item';
  const fields = { 'dc:title': item.title, 'upnp:class': item.upnpClass || (item.isContainer ? 'object.container' : 'object.item.audioItem.musicTrack'), 'upnp:artist': item.artist, 'upnp:album': item.album, 'upnp:genre': item.genre, 'upnp:originalTrackNumber': item.trackNo, 'dc:date': item.date, 'upnp:albumArtURI': item.artwork, 'et:view': item.viewId, 'et:addedAt': item.addedAt, 'et:displayPath': item.displayPath, 'et:trackCount': item.trackCount, 'et:totalDurationSec': item.totalDurationSec, 'et:flatObjectId': item.flatObjectId, 'et:treeObjectId': item.treeObjectId };
  Object.assign(fields, { 'et:albumObjectId': item.albumObjectId, 'et:artistObjectId': item.artistObjectId, 'et:catalogSearch': item.catalogSearch ? '1' : '' });
  const metadata = Object.entries(fields).filter(([, val]) => val !== undefined && val !== null && val !== '').map(([name, val]) => `<${name}>${xml(val)}</${name}>`).join('');
  const resources = item.isContainer ? [] : item.resources ?? [{ uri: item.uri, protocolInfo: item.protocolInfo ?? 'http-get:*:audio/mpeg:*' }];
  return `<${tag} id="${xml(item.id)}" parentID="${xml(parentId)}" restricted="1"${item.isContainer && Number.isInteger(item.childCount) ? ` childCount="${item.childCount}"` : ''}${item.isContainer ? ' searchable="1"' : item.refId ? ` refID="${xml(item.refId)}"` : ''}>${metadata}${resources.map(res => `<res protocolInfo="${xml(res.protocolInfo)}"${res.size ? ` size="${xml(res.size)}"` : ''}${res.duration ? ` duration="${xml(res.duration)}"` : ''}>${xml(res.uri)}</res>`).join('')}</${tag}>`;
}
const didl = items => `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:et="${METADATA}">${items.join('')}</DIDL-Lite>`;

class SsdpAdvertisement {
  constructor({ discovery, getDescription, onDiagnostic = () => {} }) {
    Object.assign(this, { discovery, getDescription, onDiagnostic });
    this.packet = packet => this.respond(packet);
    discovery.on('packet', this.packet);
  }
  start() {
    clearInterval(this.timer);
    this.announce('ssdp:alive');
    this.timer = setInterval(() => this.announce('ssdp:alive'), 60000);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); this.timer = null; return this.announce('ssdp:byebye'); }
  dispose() { clearInterval(this.timer); this.discovery.removeListener('packet', this.packet); }
  announce(nts) {
    const description = this.getDescription();
    const socket = this.discovery.socket;
    if (!description || !socket) return;
    for (const address of interfaces()) for (const target of description.targets) {
      const message = Buffer.from(`NOTIFY * HTTP/1.1\r\nHOST: ${MULTICAST}:1900\r\nNT: ${target}\r\nNTS: ${nts}\r\nUSN: ${description.id}${target === description.id ? '' : `::${target}`}\r\nLOCATION: ${description.location(address)}\r\nCACHE-CONTROL: max-age=180\r\nSERVER: EffeTune/1.0 UPnP/1.0\r\n\r\n`);
      this.discovery.sendMulticast(message, address);
    }
    return this.discovery.multicastSending;
  }
  respond({ firstLine, headers, remote }) {
    const description = this.getDescription();
    if (!description || firstLine !== 'M-SEARCH * HTTP/1.1' || headers.man !== '"ssdp:discover"') return;
    const targets = headers.st === 'ssdp:all' ? description.targets : description.targets.filter(target => target === headers.st);
    for (const address of interfaces()) for (const target of targets) {
      const message = Buffer.from(`HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=180\r\nEXT:\r\nLOCATION: ${description.location(address)}\r\nSERVER: EffeTune/1.0 UPnP/1.0\r\nST: ${target}\r\nUSN: ${description.id}${target === description.id ? '' : `::${target}`}\r\n\r\n`);
      try { this.discovery.socket?.send(message, remote.port, remote.address); } catch (error) { this.onDiagnostic(error); }
    }
  }
}

class Discovery extends EventEmitter {
  constructor({ fetchXml = requestXml } = {}) { super(); this.fetchXml = fetchXml; this.devices = new Map(); this.remoteControls = new Map(); this.loading = new Set(); this.socket = null; this.timer = null; this.startPromise = null; this.multicastSending = Promise.resolve(); }
  start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.open().catch(error => { this.close(); throw error; });
    return this.startPromise;
  }
  async open() {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }); this.socket = socket;
    socket.on('error', error => this.emit('diagnostic', error));
    socket.on('message', (message, remote) => { void this.receive(message, remote).catch(error => this.emit('diagnostic', error)); });
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.bind(1900, () => { socket.removeListener('error', reject); resolve(); }); });
    for (const address of interfaces()) { try { socket.addMembership(MULTICAST, address); } catch (error) { this.emit('diagnostic', error); } }
    socket.setMulticastTTL(2); socket.unref();
    this.timer = setInterval(() => this.search(), 30000); this.timer.unref(); this.search();
  }
  search() {
    if (!this.socket) return;
    const message = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${MULTICAST}:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n`);
    for (const address of interfaces()) this.sendMulticast(message, address);
    let changed = false;
    for (const device of this.devices.values()) if (device.available && device.expires < Date.now()) { device.available = false; changed = true; }
    for (const endpoint of this.remoteControls.values()) if (endpoint.available && endpoint.expires < Date.now()) { endpoint.available = false; changed = true; }
    if (changed) this.emit('change');
  }
  sendMulticast(message, address) {
    const socket = this.socket;
    if (!socket) return this.multicastSending;
    this.multicastSending = this.multicastSending.then(async () => {
      if (this.socket !== socket) return;
      try {
        // Node resolves even numeric destinations asynchronously. Keep the
        // interface selected until this socket has finished sending the packet.
        socket.setMulticastInterface(address);
        await new Promise((resolve, reject) => socket.send(message, 1900, MULTICAST,
          error => error ? reject(error) : resolve()));
      } catch (error) { this.emit('diagnostic', error); }
    });
    return this.multicastSending;
  }
  async receive(buffer, remote) {
    if (buffer.length > 16384 || !isLanAddress(remote.address)) return;
    const lines = buffer.toString().split('\r\n');
    const headers = Object.create(null);
    for (const line of lines.slice(1)) { const index = line.indexOf(':'); if (index > 0) headers[line.slice(0, index).toLowerCase()] = line.slice(index + 1).trim(); }
    this.emit('packet', { firstLine: lines[0], headers, remote });
    const id = headers.usn?.split('::')[0];
    if (headers.nts === 'ssdp:byebye') {
      const device = this.devices.get(id);
      let changed = Boolean(device);
      if (device) device.available = false;
      for (const endpoint of this.remoteControls.values()) if (endpoint.id === id) { endpoint.available = false; changed = true; }
      if (changed) this.emit('change'); return;
    }
    if (!id || !headers.location || this.loading.has(id)) return;
    const location = networkUrl(headers.location);
    if (location.hostname !== remote.address) return;
    const expires = Date.now() + Math.min(1800, Number(/max-age=(\d+)/i.exec(headers['cache-control'])?.[1]) || 180) * 1000;
    const existing = this.devices.get(id) || [...this.remoteControls.values()].find(endpoint => endpoint.id === id);
    if (existing?.location === location.href && existing.available) { existing.expires = expires; return; }
    if (!existing && this.devices.size + this.remoteControls.size >= 256) return;
    this.loading.add(id);
    try {
      const document = await this.fetchXml(location.href);
      const declaredBase = descendants(document, 'URLBase')[0]?.text;
      const base = declaredBase ? networkUrl(declaredBase) : location;
      if (base.hostname !== location.hostname) return;
      for (const device of descendants(document, 'device')) {
        const udn = value(device, 'UDN'); if (!udn) continue;
        const services = new Map();
        for (const entry of children(child(device, 'serviceList'), 'service')) {
          const type = value(entry, 'serviceType'); const control = networkUrl(value(entry, 'controlURL'), base);
          if (control.hostname !== location.hostname) continue;
          services.set(type.replace(/:\d+$/, ''), { type, control: control.href });
        }
        const endpoint = services.get(REMOTE_CONTROL.replace(/:\d+$/, ''));
        const playerId = value(device, 'playerId');
        if (endpoint && playerId && playerId.length <= 512 && udn === id) {
          const url = new URL(endpoint.control);
          if (url.origin === location.origin && url.pathname === '/.well-known/effetune/pair' && !url.search) {
            this.remoteControls.set(playerId, { id: udn, playerId, origin: url.origin, address: remote.address, location: location.href, expires, available: true });
          }
        }
        if (![...services.keys()].some(type => type.endsWith(':Playlist') || type.endsWith(':ContentDirectory'))) continue;
        this.devices.set(udn, { id: udn, name: value(device, 'friendlyName') || 'Music device', manufacturer: value(device, 'manufacturer'), services, location: location.href, address: remote.address, expires, available: true });
      }
      this.emit('change');
    } finally { this.loading.delete(id); }
  }
  remoteControlEndpoint(playerId) {
    const device = this.devices.get(playerId);
    const endpoint = this.remoteControls.get(playerId);
    if (!device?.available || !service(device, 'Playlist') || !endpoint?.available || endpoint.expires < Date.now() || endpoint.address !== device.address) return null;
    return endpoint.origin;
  }
  close() { clearInterval(this.timer); try { this.socket?.close(); } catch { /* A failed bind has no open socket. */ } this.socket = null; this.startPromise = null; }
}
const service = (device, name) => device?.services.get(`urn:${name === 'ContentDirectory' || name === 'ConnectionManager' ? 'schemas-upnp-org' : 'av-openhome-org'}:service:${name}`);

module.exports = { CONTENT, CONNECTION, PLAYLIST, REMOTE_CONTROL, MULTICAST, xml, parseXml, child, children, value, descendants, interfaces, isLanAddress, networkUrl, requestXml, soap, parseDidl, didlItem, didl, SsdpAdvertisement, Discovery, service };
