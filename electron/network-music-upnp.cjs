'use strict';

const http = require('node:http');
const https = require('node:https');
const dgram = require('node:dgram');
const os = require('node:os');
const net = require('node:net');
const dns = require('node:dns');
const { EventEmitter } = require('node:events');

const { CONTENT, CONNECTION, PLAYLIST, REMOTE_CONTROL, MULTICAST, xml, parseXml, child, children, value, descendants, isLanAddress, networkUrl, parseDidl, didlItem, didl, service, soapEnvelope, parseSoapResponse, parseSoapFault, readDescription } = require('../js/network-music/upnp/protocol.js');

function interfaces() { return Object.values(os.networkInterfaces()).flat().filter(item => item?.family === 'IPv4' && !item.internal).map(item => item.address); }
function requestXml(input, { method = 'GET', headers = {}, body = '', address } = {}) {
  const url = networkUrl(input);
  return new Promise((resolve, reject) => {
    // Preserve the hostname for Host/TLS while binding an SSDP fetch to its sender.
    const lookup = address ? (hostname, options, callback) => dns.lookup(hostname, { family: 4, all: true }, (error, records) => {
      if (error || !records.some(record => record.address === address)) {
        callback(error || new Error('The music device address could not be verified')); return;
      }
      callback(null, options.all ? [{ address, family: 4 }] : address, 4);
    }) : undefined;
    const req = (url.protocol === 'https:' ? https : http).request(url, { method, headers, timeout: 8000, ...(lookup ? { lookup, agent: false } : {}) }, res => {
      const connectionAddress = res.socket?.remoteAddress?.replace(/^::ffff:/, '');
      const chunks = []; let bytes = 0;
      res.on('data', data => { bytes += data.length; if (bytes > 4 * 1024 * 1024) req.destroy(new Error('Device response too large')); else chunks.push(data); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = Object.assign(new Error(`Device request failed (${res.statusCode})`), { httpStatus: res.statusCode });
          try {
            Object.assign(error, parseSoapFault(text));
          } catch { /* Keep the HTTP diagnostic when the peer did not return a SOAP fault. */ }
          reject(error);
        }
        else { try {
          const document = parseXml(text);
          document.connectionAddress = connectionAddress;
          resolve(document);
        } catch (error) { reject(error); } }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Music device did not respond'), { code: 'ETIMEDOUT' })));
    req.on('error', error => { error.networkMusicAddress = url.host; reject(error); });
    req.end(body);
  });
}
async function soap(service, action, args = {}) {
  const body = soapEnvelope(service, action, args);
  let result;
  try { result = await requestXml(service.control, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${service.type}#${action}"`, 'Content-Length': Buffer.byteLength(body) }, body }); }
  catch (error) { Object.assign(error, { upnpService: service.type, upnpAction: action }); throw error; }
  return parseSoapResponse(result, action);
}

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
  constructor({ fetchXml = requestXml } = {}) { super(); this.fetchXml = fetchXml; this.devices = new Map(); this.remoteControls = new Map(); this.loading = new Set(); this.manualLocations = new Set(); this.manualRequests = new Map(); this.socket = null; this.searchSocket = null; this.timer = null; this.startPromise = null; this.multicastSending = Promise.resolve(); }
  start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.open().catch(error => { this.close(); throw error; });
    return this.startPromise;
  }
  async open() {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true }); this.socket = socket;
    // Search replies are unicast to the sending port. Port 1900 is shared with other SSDP listeners such as the
    // Windows SSDP Discovery service, which can receive those replies instead, so searches use their own port.
    const searchSocket = dgram.createSocket('udp4'); this.searchSocket = searchSocket;
    for (const [opened, port] of [[socket, 1900], [searchSocket, 0]]) {
      opened.on('error', error => this.emit('diagnostic', error));
      opened.on('message', (message, remote) => { void this.receive(message, remote).catch(error => this.emit('diagnostic', error)); });
      await new Promise((resolve, reject) => { opened.once('error', reject); opened.bind(port, () => { opened.removeListener('error', reject); resolve(); }); });
      opened.setMulticastTTL(2); opened.unref();
    }
    for (const address of interfaces()) { try { socket.addMembership(MULTICAST, address); } catch (error) { this.emit('diagnostic', error); } }
    this.timer = setInterval(() => this.search(), 30000); this.timer.unref(); this.search();
  }
  search({ refresh = false } = {}) {
    const message = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${MULTICAST}:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n`);
    for (const address of interfaces()) this.sendMulticast(message, address, 'searchSocket');
    let changed = false;
    for (const device of this.devices.values()) if (device.available && device.expires < Date.now() && !this.manualLocations.has(device.location)) { device.available = false; changed = true; }
    for (const endpoint of this.remoteControls.values()) if (endpoint.available && endpoint.expires < Date.now() && !this.manualLocations.has(endpoint.location)) { endpoint.available = false; changed = true; }
    if (changed) this.emit('change');
    const requests = [...this.manualLocations].map(location => this.register(location).catch(error => this.emit('diagnostic', error)));
    if (refresh) {
      // Refresh each known description even when SSDP keeps advertising the same URL.
      const locations = new Map([...this.devices.values(), ...this.remoteControls.values()].map(device => [device.location, device]));
      for (const [location, device] of locations) {
        if (this.manualLocations.has(location)) continue;
        const packet = Buffer.from(`HTTP/1.1 200 OK\r\nUSN: ${device.id}\r\nLOCATION: ${location}\r\n\r\n`);
        requests.push(this.receive(packet, { address: device.address }, false, true).catch(error => {
          this.invalidateLocation(location);
          this.emit('diagnostic', error);
        }));
      }
    }
    this.emit('search');
    return Promise.all(requests);
  }
  sendMulticast(message, address, role = 'socket') {
    const socket = this[role];
    if (!socket) return this.multicastSending;
    this.multicastSending = this.multicastSending.then(async () => {
      if (this[role] !== socket) return;
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
  setManualLocations(inputs) {
    this.manualLocations = new Set(inputs.map(input => networkUrl(input).href));
  }
  unregister(input) {
    const location = networkUrl(input).href;
    this.manualLocations.delete(location);
    this.invalidateLocation(location);
  }
  invalidateLocation(location) {
    let changed = false;
    for (const device of [...this.devices.values(), ...this.remoteControls.values()]) {
      if (device.location === location && device.available) { device.available = false; changed = true; }
    }
    if (changed) this.emit('change');
  }
  register(input) {
    const location = networkUrl(input);
    if (this.manualRequests.has(location.href)) return this.manualRequests.get(location.href);
    const alreadySaved = this.manualLocations.has(location.href);
    this.manualLocations.add(location.href);
    const id = `manual:${location.href}`;
    const request = (async () => {
      try {
        await this.receive(Buffer.from(`HTTP/1.1 200 OK\r\nUSN: ${id}\r\nLOCATION: ${location.href}\r\nCACHE-CONTROL: max-age=1800\r\n\r\n`), { address: location.hostname }, true);
        const devices = [...this.devices.values()].filter(device => device.location === location.href && device.available);
        if (!devices.length) throw new Error('The music device is unavailable');
        return devices;
      } catch (error) {
        this.invalidateLocation(location.href);
        if (!alreadySaved) this.manualLocations.delete(location.href);
        throw error;
      } finally { this.manualRequests.delete(location.href); }
    })();
    this.manualRequests.set(location.href, request);
    return request;
  }
  async receive(buffer, remote, manual = false, refresh = false) {
    if (buffer.length > 16384 || !manual && !isLanAddress(remote.address)) return;
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
    if (!manual && net.isIP(location.hostname) && location.hostname !== remote.address) return;
    const expires = Date.now() + Math.min(1800, Number(/max-age\s*=\s*(\d+)/i.exec(headers['cache-control'])?.[1]) || 180) * 1000;
    const existing = this.devices.get(id) || (manual && [...this.devices.values()].find(device => device.location === location.href)) || [...this.remoteControls.values()].find(endpoint => endpoint.id === id);
    if (!manual && !refresh) {
      // A root device without music services, such as a Sonos player, advertises a UDN that is never stored. Its
      // advertisement renews the embedded devices loaded from the same description instead of reloading it.
      const described = (existing ? [existing] : [...this.devices.values()]).filter(device => device.location === location.href && device.available);
      if (described.length) {
        for (const device of described) if (device.address === remote.address) device.expires = expires;
        return;
      }
    }
    if (!existing && this.devices.size + this.remoteControls.size >= 256) return;
    this.loading.add(id);
    try {
      const document = await this.fetchXml(location.href, manual ? {} : { address: remote.address });
      if (manual && !this.manualLocations.has(location.href)) return;
      const address = document.connectionAddress || (net.isIP(location.hostname) ? remote.address : null);
      if (!net.isIP(address ?? '') || !manual && address !== remote.address) throw new Error('The music device address could not be verified');
      const found = new Set();
      for (const { remoteControl, device: next } of readDescription(document, { location, id, address, expires })) {
        if (remoteControl) { this.remoteControls.set(remoteControl.playerId, remoteControl); continue; }
        const udn = next.id;
        found.add(udn);
        const previous = this.devices.get(udn);
        if (manual && previous?.location === location.href && previous.address === address) Object.assign(previous, next);
        else {
          if (manual && previous?.available) { previous.available = false; this.emit('change'); }
          this.devices.set(udn, next);
        }
      }
      if (manual || refresh) for (const device of this.devices.values()) if (device.location === location.href && !found.has(device.id)) device.available = false;
      this.emit('change');
    } finally { this.loading.delete(id); }
  }
  remoteControlEndpoint(playerId) {
    const device = this.devices.get(playerId);
    const endpoint = this.remoteControls.get(playerId);
    if (!device?.available || !service(device, 'Playlist') || !endpoint?.available || endpoint.expires < Date.now() || endpoint.address !== device.address) return null;
    return endpoint.origin;
  }
  close() {
    clearInterval(this.timer);
    for (const role of ['socket', 'searchSocket']) { try { this[role]?.close(); } catch { /* A failed bind has no open socket. */ } this[role] = null; }
    this.startPromise = null;
  }
}

module.exports = { CONTENT, CONNECTION, PLAYLIST, REMOTE_CONTROL, MULTICAST, xml, parseXml, child, children, value, descendants, interfaces, isLanAddress, networkUrl, requestXml, soap, parseDidl, didlItem, didl, SsdpAdvertisement, Discovery, service };
