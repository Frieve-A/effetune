'use strict';

const { EventEmitter } = require('node:events');
const net = require('node:net');
const { isLanAddress } = require('./network-music-upnp.cjs');

const CAST_GROUP_MODEL = 'Google Cast Group';

// Translate one mDNS `_googlecast._tcp` service into a sender target.
// The TXT `id` is the stable identity; the first LAN IPv4 address is the endpoint.
function parseCastService(service) {
  const txt = service?.txt && typeof service.txt === 'object' ? service.txt : {};
  const id = typeof txt.id === 'string' ? txt.id.trim() : '';
  if (!id) return null;
  const address = (Array.isArray(service.addresses) ? service.addresses : [])
    .find(value => net.isIPv4(value) && isLanAddress(value) && !value.startsWith('127.'));
  if (!address) return null;
  const friendly = typeof txt.fn === 'string' ? txt.fn.trim() : '';
  return {
    id,
    type: 'cast',
    name: friendly || (typeof service.name === 'string' && service.name) || id,
    address,
    port: Number.isInteger(service.port) && service.port > 0 ? service.port : 8009,
    isGroup: txt.md === CAST_GROUP_MODEL
  };
}

class CastDiscovery extends EventEmitter {
  constructor({ bonjourFactory, onDiagnostic = () => {} } = {}) {
    super();
    this.onDiagnostic = onDiagnostic;
    this.bonjourFactory = bonjourFactory ?? (() => {
      const { Bonjour } = require('bonjour-service');
      return new Bonjour(undefined, error => this.onDiagnostic('cast-discovery-error', error));
    });
    this.bonjour = null;
    this.browser = null;
    this.devices = new Map();
  }

  start() {
    if (this.browser) return;
    try {
      this.bonjour = this.bonjourFactory();
      this.browser = this.bonjour.find({ type: 'googlecast' });
    } catch (error) {
      this.onDiagnostic('cast-discovery-failed', error);
      this.stop();
      return;
    }
    const update = service => this.update(service);
    this.browser.on('up', update);
    this.browser.on('txt-update', update);
    this.browser.on('srv-update', update);
    this.browser.on('down', service => this.remove(service));
  }

  stop() {
    const { browser, bonjour } = this;
    this.browser = null;
    this.bonjour = null;
    try { browser?.stop(); } catch (error) { this.onDiagnostic('cast-discovery-error', error); }
    try { bonjour?.destroy(); } catch (error) { this.onDiagnostic('cast-discovery-error', error); }
    if (this.devices.size) {
      this.devices.clear();
      this.emit('change');
    }
  }

  update(service) {
    const device = parseCastService(service);
    if (!device) return;
    const previous = this.devices.get(device.id);
    if (previous && ['name', 'address', 'port', 'isGroup'].every(key => previous[key] === device[key])) return;
    this.devices.set(device.id, device);
    this.emit('change');
  }

  remove(service) {
    const id = typeof service?.txt?.id === 'string' ? service.txt.id.trim() : '';
    if (!id || !this.devices.delete(id)) return;
    this.emit('change');
  }
}

module.exports = { CastDiscovery, parseCastService };
