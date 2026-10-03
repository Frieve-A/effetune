'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { pickLanAddress } = require('../../electron/remote-control-host.cjs');

const iface = (name, address, mac = '00:11:22:33:44:55') =>
  [name, [{ address, family: 'IPv4', internal: false, mac }]];
const pick = (...entries) => pickLanAddress(Object.fromEntries(entries));

test('Linux: libvirt, docker and LXD bridges never win over the real LAN adapter', () => {
  const result = pick(
    iface('virbr0', '192.168.122.1', '52:54:00:aa:bb:cc'),
    iface('docker0', '172.17.0.1', '02:42:ac:11:00:01'),
    iface('br-3f2a9c1d', '172.18.0.1', '02:42:11:22:33:44'),
    iface('lxdbr0', '10.88.5.1', '00:16:3e:11:22:33'),
    iface('wlan0', '192.168.1.50')
  );
  assert.equal(result.best, '192.168.1.50');
  assert.deepEqual(result.offered.map(o => o.name), ['wlan0']);
});

test('Linux: VPN and overlay adapters are not offered next to eth0', () => {
  const result = pick(
    iface('wg0', '10.66.66.2', '00:00:00:00:00:00'),
    iface('tailscale0', '100.101.102.103'),
    iface('cni-podman0', '10.88.0.1', 'aa:bb:cc:dd:ee:ff'),
    iface('enp3s0', '192.168.1.77')
  );
  assert.deepEqual(result.offered.map(o => o.name), ['enp3s0']);
});

test('macOS: Internet Sharing bridge, vmnet and utun are skipped, en0 is offered', () => {
  const result = pick(
    iface('bridge100', '192.168.2.1', 'aa:bb:cc:00:00:01'),
    iface('vmnet8', '192.168.88.1', '00:50:56:c0:00:08'),
    iface('utun3', '10.8.0.6', ''),
    iface('utun4', '100.77.178.77', ''),
    iface('en0', '192.168.1.138')
  );
  assert.equal(result.best, '192.168.1.138');
  assert.deepEqual(result.offered.map(o => o.name), ['en0']);
});

test('only a VPN adapter has a private address: it is still the best guess', () => {
  const result = pick(iface('utun3', '10.8.0.6', ''), iface('en0', '169.254.9.9'));
  assert.equal(result.best, '10.8.0.6');
});

test('Linux: Incus bridge and NordLynx are skipped; WSL2 in NAT mode falls back to its only address', () => {
  const result = pick(
    iface('incusbr0', '10.85.239.1', '10:66:6a:00:00:01'),
    iface('nordlynx', '10.5.0.2', ''),
    iface('eth0', '192.168.1.4')
  );
  assert.deepEqual(result.offered.map(o => o.name), ['eth0']);
  const nat = pick(iface('eth0', '172.24.80.5', '00:15:5d:aa:bb:cc'));
  assert.equal(nat.best, '172.24.80.5');
});
