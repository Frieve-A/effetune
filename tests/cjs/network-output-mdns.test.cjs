const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const Module = require('node:module');
const { CastDiscovery, parseCastService } = require('../../electron/network-output-mdns.cjs');

// Serves a stand-in for `bonjour-service` while `callback` runs so no mDNS socket is opened.
function withBonjourModule(exports, callback) {
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    return request === 'bonjour-service' ? exports : originalLoad.call(this, request, parent, isMain);
  };
  try { return callback(); } finally { Module._load = originalLoad; }
}

function createFakeBonjour() {
  const browser = new EventEmitter();
  const calls = [];
  browser.stop = () => calls.push('browser-stop');
  const bonjour = { find: options => { calls.push(['find', options]); return browser; }, destroy: () => calls.push('destroy') };
  return { bonjour, browser, calls };
}

const service = (overrides = {}) => ({
  name: 'Chromecast-abc', port: 8009, addresses: ['fe80::1', '192.168.1.20'],
  txt: { id: 'abc', fn: 'Living Room', md: 'Chromecast' }, ...overrides
});

test('Cast services resolve identity, friendly name, IPv4 endpoint and group flag from mDNS records', () => {
  assert.deepEqual(parseCastService(service()), { id: 'abc', type: 'cast', name: 'Living Room', address: '192.168.1.20', port: 8009, isGroup: false });
  assert.equal(parseCastService(service({ txt: { id: 'g1', fn: 'Everywhere', md: 'Google Cast Group' }, port: 42000 })).isGroup, true);
  assert.equal(parseCastService(service({ txt: { id: 'g1', fn: 'Everywhere', md: 'Google Cast Group' }, port: 42000 })).port, 42000);
  assert.equal(parseCastService(service({ txt: { id: 'x' } })).name, 'Chromecast-abc');
  assert.equal(parseCastService(service({ port: 0 })).port, 8009);
  assert.equal(parseCastService(service({ txt: {} })), null);
  assert.equal(parseCastService(service({ addresses: ['fe80::1'] })), null);
  assert.equal(parseCastService(service({ addresses: ['203.0.113.5', '127.0.0.1'] })), null);
  assert.equal(parseCastService(service({ addresses: ['203.0.113.5', '192.168.1.20'] })).address, '192.168.1.20');
  assert.equal(parseCastService(null), null);
});

test('Cast discovery tracks devices through up, update and down events and clears them on stop', () => {
  const fake = createFakeBonjour();
  const diagnostics = [];
  const discovery = new CastDiscovery({ bonjourFactory: () => fake.bonjour, onDiagnostic: (...args) => diagnostics.push(args) });
  let changes = 0;
  discovery.on('change', () => { changes += 1; });

  discovery.start();
  discovery.start();
  assert.deepEqual(fake.calls, [['find', { type: 'googlecast' }]]);

  fake.browser.emit('up', service());
  assert.equal(changes, 1);
  assert.equal(discovery.devices.get('abc').name, 'Living Room');
  fake.browser.emit('txt-update', service());
  assert.equal(changes, 1, 'identical records do not emit change');
  fake.browser.emit('txt-update', service({ txt: { id: 'abc', fn: 'Kitchen' } }));
  assert.equal(changes, 2);
  assert.equal(discovery.devices.get('abc').name, 'Kitchen');
  fake.browser.emit('srv-update', service({ addresses: ['192.168.1.99'], txt: { id: 'abc', fn: 'Kitchen' } }));
  assert.equal(discovery.devices.get('abc').address, '192.168.1.99');
  fake.browser.emit('up', service({ txt: { id: 'noaddr' }, addresses: [] }));
  assert.equal(discovery.devices.size, 1);
  fake.browser.emit('down', service({ txt: { id: 'unknown' } }));
  assert.equal(changes, 3);
  fake.browser.emit('down', service({ txt: { id: 'abc' } }));
  assert.equal(discovery.devices.size, 0);
  assert.equal(changes, 4);

  fake.browser.emit('up', service());
  discovery.stop();
  assert.deepEqual(fake.calls.slice(1), ['browser-stop', 'destroy']);
  assert.equal(discovery.devices.size, 0);
  assert.equal(changes, 6);
  discovery.stop();
  assert.deepEqual(fake.calls.length, 3);
  assert.deepEqual(diagnostics, []);
});

test('Cast discovery reports a failed browser start and stays stopped', () => {
  const diagnostics = [];
  const discovery = new CastDiscovery({ bonjourFactory: () => { throw new Error('no sockets'); }, onDiagnostic: (code, error) => diagnostics.push([code, error.message]) });
  discovery.start();
  assert.deepEqual(diagnostics, [['cast-discovery-failed', 'no sockets']]);
  assert.equal(discovery.browser, null);
  assert.equal(discovery.bonjour, null);

  const quiet = new CastDiscovery({ bonjourFactory: () => { throw new Error('no sockets'); } });
  quiet.start();
  assert.equal(quiet.browser, null);
  const failingStop = createFakeBonjour();
  failingStop.browser.stop = () => { throw new Error('already stopped'); };
  const stopping = new CastDiscovery({ bonjourFactory: () => failingStop.bonjour });
  stopping.start();
  stopping.stop();
  assert.deepEqual(failingStop.calls.slice(1), ['destroy'], 'a throwing browser stop still destroys the bonjour instance');
});

test('Cast discovery builds its own bonjour instance by default and reports its socket errors', () => {
  const fake = createFakeBonjour();
  const constructed = [];
  class Bonjour {
    constructor(options, errorCallback) { constructed.push({ options, errorCallback }); return fake.bonjour; }
  }
  const diagnostics = [];
  const discovery = new CastDiscovery({ onDiagnostic: (code, error) => diagnostics.push([code, error.message]) });
  withBonjourModule({ Bonjour }, () => discovery.start());
  assert.equal(constructed.length, 1);
  assert.equal(constructed[0].options, undefined);
  assert.deepEqual(fake.calls, [['find', { type: 'googlecast' }]]);
  constructed[0].errorCallback(new Error('EADDRINUSE'));
  assert.deepEqual(diagnostics, [['cast-discovery-error', 'EADDRINUSE']]);
  fake.browser.emit('up', service());
  assert.equal(discovery.devices.get('abc').address, '192.168.1.20');
  discovery.stop();
  assert.deepEqual(fake.calls.slice(1), ['browser-stop', 'destroy']);
  assert.equal(discovery.devices.size, 0);
});
