'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PARTITION, closeAllClientWindows, isJoinableHost, openRemoteClientWindow, parseJoinInput
} = require('../../electron/remote-client-window.cjs');
const { RemoteControlHost } = require('../../electron/remote-control-host.cjs');

function createFakeBrowserWindow(created) {
  return class FakeBrowserWindow {
    constructor(options) {
      this.options = options;
      this.handlers = {};
      this.destroyed = false;
      this.loaded = [];
      this.shown = 0;
      this.focused = 0;
      const handlers = this.handlers;
      this.webContents = {
        setWindowOpenHandler: fn => { handlers.windowOpen = fn; },
        on: (type, fn) => { handlers[type] = fn; },
        session: { setPermissionRequestHandler: fn => { handlers.permission = fn; } }
      };
      created.push(this);
    }

    setMenuBarVisibility() {}
    on(type, fn) { this.handlers[type] = fn; }
    loadURL(url) { this.loaded.push(url); return Promise.resolve(); }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    restore() {}
    show() { this.shown += 1; }
    focus() { this.focused += 1; }
    destroy() { this.destroyed = true; this.handlers.closed?.(); }
  };
}

test('pairing links from the Remote Control window are understood', () => {
  const link = parseJoinInput('http://192.168.1.5:47300/?t=abcd1234');
  assert.deepEqual([link.ok, link.host, link.port, link.token, link.origin],
    [true, '192.168.1.5', 47300, 'abcd1234', 'http://192.168.1.5:47300']);
  assert.equal(link.url, 'http://192.168.1.5:47300/?t=abcd1234');
  assert.equal(parseJoinInput('ws://10.0.0.2:47301/?t=tok_en-1').origin, 'http://10.0.0.2:47301');
  assert.equal(parseJoinInput('  http://192.168.0.9:47302/?t=abcdef  ').token, 'abcdef');
  assert.equal(parseJoinInput('http://studio.local:47300/?t=abcd').host, 'studio.local');
  assert.equal(parseJoinInput('http://[::1]:47300/?t=abcd').host, '[::1]');
});

test('other links are refused with a message', () => {
  const bad = input => parseJoinInput(input);
  assert.equal(bad('').ok, false);
  assert.equal(bad('hello').ok, false);
  assert.equal(bad('https://192.168.1.5:47300/?t=abcd').ok, false);
  assert.equal(bad('http://192.168.1.5/?t=abcd').ok, false, 'no port');
  assert.equal(bad('http://192.168.1.5:0/?t=abcd').ok, false);
  assert.equal(bad('http://192.168.1.5:70000/?t=abcd').ok, false);
  assert.equal(bad('http://example.com:47300/?t=abcd').ok, false);
  assert.equal(bad('http://8.8.8.8:47300/?t=abcd').ok, false);
  assert.equal(bad('http://192.168.1.5:47300/').ok, false, 'no token');
  assert.equal(bad('http://192.168.1.5:47300/?t=a').ok, false, 'token too short');
  assert.equal(bad('http://192.168.1.5:47300/?t=bad%20token').ok, false);
  assert.equal(bad('192.168.1.5:47300/ab').ok, false);
  assert.equal(bad('not a url://x').ok, false);
  assert.equal(bad('http://[').ok, false);
});

test('only private, loopback, local and VPN addresses can be joined', () => {
  for (const host of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '127.0.0.1', 'localhost',
    '[::1]', 'nas.local', '100.64.0.1']) {
    assert.equal(isJoinableHost(host), true, host);
  }
  for (const host of ['172.32.0.1', '11.0.0.1', '192.169.0.1', 'evil.example', '256.1.1.1', 'a.local.evil.com', '', undefined]) {
    assert.equal(isJoinableHost(host), false, String(host));
  }
});

test('joining opens one sandboxed window without Node, a preload or popups', () => {
  const created = [];
  const deps = { BrowserWindow: createFakeBrowserWindow(created), getMainWindow: () => null };
  const result = openRemoteClientWindow('http://192.168.1.5:47311/?t=abcd1234', deps);
  assert.deepEqual(result, { ok: true });
  const [win] = created;
  assert.deepEqual(win.options.webPreferences,
    { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: PARTITION });
  assert.equal(win.options.webPreferences.preload, undefined);
  assert.match(win.options.title, /192\.168\.1\.5/);
  assert.deepEqual(win.loaded, ['http://192.168.1.5:47311/?t=abcd1234']);
  assert.deepEqual(win.handlers.windowOpen(), { action: 'deny' });
  let prevented = 0;
  const event = { preventDefault: () => { prevented += 1; } };
  win.handlers['will-navigate'](event, 'http://192.168.1.5:47311/other');
  assert.equal(prevented, 0, 'same origin may navigate');
  win.handlers['will-navigate'](event, 'https://evil.example/');
  win.handlers['will-navigate'](event, 'http://192.168.1.5:9/');
  win.handlers['will-navigate'](event, 'not a url');
  assert.equal(prevented, 3);
  let granted = null;
  win.handlers.permission(null, 'media', value => { granted = value; });
  assert.equal(granted, false);
  win.handlers['page-title-updated']({ preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 4);
  closeAllClientWindows();
});

test('joining the same server again reuses its window', () => {
  const created = [];
  const deps = { BrowserWindow: createFakeBrowserWindow(created), getMainWindow: () => null };
  openRemoteClientWindow('http://192.168.1.5:47312/?t=abcd1234', deps);
  const second = openRemoteClientWindow('http://192.168.1.5:47312/?t=newtoken9', deps);
  assert.deepEqual(second, { ok: true, reused: true });
  assert.equal(created.length, 1);
  assert.equal(created[0].loaded.at(-1), 'http://192.168.1.5:47312/?t=newtoken9');
  assert.equal(created[0].focused, 1);
  openRemoteClientWindow('http://192.168.1.5:47313/?t=abcd1234', deps);
  assert.equal(created.length, 2);
  created[0].destroy();
  openRemoteClientWindow('http://192.168.1.5:47312/?t=abcd1234', deps);
  assert.equal(created.length, 3, 'a closed window is replaced');
  closeAllClientWindows();
  assert.ok(created.every(win => win.destroyed));
});

test('joining this very computer focuses the main window instead', () => {
  const created = [];
  const main = { shown: 0, focused: 0, isDestroyed: () => false, isMinimized: () => true, restore() { this.restored = true; },
    show() { this.shown += 1; }, focus() { this.focused += 1; } };
  const deps = {
    BrowserWindow: createFakeBrowserWindow(created),
    getMainWindow: () => main,
    isSelf: (host, port) => host === '192.168.1.5' && port === 47300
  };
  assert.deepEqual(openRemoteClientWindow('http://192.168.1.5:47300/?t=abcd1234', deps), { ok: true, self: true });
  assert.equal(created.length, 0);
  assert.deepEqual([main.restored, main.shown, main.focused], [true, 1, 1]);
  assert.equal(openRemoteClientWindow('http://192.168.1.5:47301/?t=abcd1234', deps).self, undefined);
  closeAllClientWindows();
});

test('a failed parse reaches the caller untouched and a load failure is only logged', async () => {
  const created = [];
  const logs = [];
  class Failing extends createFakeBrowserWindow(created) {
    loadURL() { return Promise.reject(new Error('refused')); }
  }
  assert.equal(openRemoteClientWindow('nope', { BrowserWindow: Failing, getMainWindow: () => null }).ok, false);
  assert.equal(created.length, 0);
  assert.equal(openRemoteClientWindow('http://10.0.0.8:47314/?t=abcd1234',
    { BrowserWindow: Failing, getMainWindow: () => null, log: (...args) => logs.push(args.join(' ')) }).ok, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.match(logs[0], /refused/);
  closeAllClientWindows();
});

test('the host knows its own addresses', () => {
  const host = new RemoteControlHost({
    app: { getAppPath: () => __dirname, getVersion: () => '1', isPackaged: true },
    getMainWindow: () => null,
    env: { EFFETUNE_REMOTE_TOKEN: 'abcd1234' },
    argv: [],
    log: () => {}
  });
  host.listening = true;
  host.port = 47300;
  host.lan = { best: '192.168.1.5', candidates: [{ address: '192.168.1.5' }], offered: [{ address: '192.168.1.5', name: 'Wi-Fi' }] };
  assert.equal(host.isOwnAddress('192.168.1.5', 47300), true);
  assert.equal(host.isOwnAddress('127.0.0.1', 47300), true);
  assert.equal(host.isOwnAddress('localhost', 47300), true);
  assert.equal(host.isOwnAddress('192.168.1.5', 47301), false);
  assert.equal(host.isOwnAddress('192.168.1.6', 47300), false);
  host.listening = false;
  assert.equal(host.isOwnAddress('127.0.0.1', 47300), false, 'a stopped server is not joined by itself');
  assert.equal(host.joinRemote('nope').ok, false);
});
