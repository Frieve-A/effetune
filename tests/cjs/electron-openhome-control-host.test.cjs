const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { setImmediate: delay } = require('node:timers/promises');
const test = require('node:test');

const {
  ACTION_TIMEOUT_MS,
  CHANNELS,
  OpenHomeControlHost,
  RESET_TIMEOUT_MS,
  SIDECAR_RETRY_BASE_MS,
  SIDECAR_RETRY_MAX_MS,
  createDefaultFriendlyName,
  extractDidlAlbumArtUri,
  registerOpenHomeIpc
} = require('../../electron/openhome-control-host.cjs');

class FakeSidecar extends EventEmitter {
  constructor() {
    super();
    this.state = 'stopped';
    this.startCalls = [];
    this.stopCalls = 0;
    this.responses = [];
    this.rejections = [];
    this.snapshots = [];
    this.respondAccepted = true;
  }

  getStatus() {
    return { state: this.state, available: true };
  }

  start(configuration) {
    this.startCalls.push(configuration);
    this.state = 'starting';
    this.emit('status');
    return true;
  }

  stop() {
    this.stopCalls += 1;
    this.state = 'stopped';
    return Promise.resolve();
  }

  respond(requestId, result) {
    this.responses.push({ requestId, result });
    return this.respondAccepted;
  }

  reject(requestId, code) {
    this.rejections.push({ requestId, code });
    return true;
  }

  publishState(snapshot) {
    this.snapshots.push(snapshot);
    return this.state === 'ready';
  }
}

class FakeGateway {
  constructor() {
    this.registerCalls = [];
    this.releaseCalls = [];
    this.closeCalls = 0;
  }

  async register(uri) {
    this.registerCalls.push(uri);
    return { token: `token-${this.registerCalls.length}`, playbackUrl: 'http://127.0.0.1:43123/openhome-media/token' };
  }

  release(token) {
    this.releaseCalls.push(token);
    return true;
  }

  close() {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

function createHarness(initialConfig = {}, hostOptions = {}) {
  const { autoResetAck = true, ...controlHostOptions } = hostOptions;
  const sidecar = new FakeSidecar();
  const gateway = new FakeGateway();
  const sends = [];
  let host = null;
  const window = {
    webContents: {
      send: (...args) => {
        sends.push(args);
        if (autoResetAck && args[0] === CHANNELS.reset) {
          queueMicrotask(() => host?.handleRendererResetAck({ resetId: args[1].resetId, ok: true }));
        }
      }
    },
    isDestroyed: () => false
  };
  let config = { ...initialConfig };
  const saves = [];
  host = new OpenHomeControlHost({
    sidecar,
    gateway,
    getMainWindow: () => window,
    loadConfig: () => ({ ...config }),
    saveConfig: next => {
      config = { ...next };
      saves.push(config);
      return true;
    },
    setAppConfig: next => { config = { ...next }; },
    defaultFriendlyName: 'EffeTune (Test PC)',
    ...controlHostOptions
  });
  return { gateway, getConfig: () => config, host, saves, sends, sidecar, window };
}

function registerRendererIpc(t, harness) {
  const handlers = new Map();
  const dispose = registerOpenHomeIpc({
    ipcMain: {
      handle: (channel, handler) => handlers.set(channel, handler),
      removeHandler: channel => handlers.delete(channel)
    },
    host: harness.host,
    getMainWindow: () => harness.window
  });
  t.after(dispose);
  const invoke = (channel, ...args) => handlers.get(channel)({ sender: harness.window.webContents }, ...args);
  return { handlers, invoke, dispose };
}

test('sidecar diagnostics preserve bounded detail for the console mirror', async () => {
  const diagnostics = [];
  const harness = createHarness({}, { onDiagnostic: (...args) => diagnostics.push(args) });
  const detail = 'ohNet startup trace';
  harness.sidecar.emit('diagnostic', { code: 'sidecar-stderr', detail });
  assert.deepEqual(diagnostics, [['sidecar-stderr', detail]]);
  await harness.host.dispose();
});

test('only main-process local actions carry local queue observation authority', async () => {
  const harness = createHarness({ openHomeRemoteControl: true });
  await harness.host.setRendererReady();
  harness.host.setLocalControlEnabled(true);
  try {
    const pending = harness.host.requestLocalAction('Playlist', 'Snapshot');
    await delay();
    const local = harness.sends.find(([channel, action]) => channel === CHANNELS.action && action.action === 'Snapshot')[1];
    harness.host.handleRendererResponse({ requestId: local.requestId, ok: true, result: {} });
    await pending;
    assert.equal(local.localControl, true);
    await harness.host.handleSidecarAction({ requestId: 'lan-snapshot', service: 'Playlist', action: 'Snapshot', args: {}, localControl: true });
    const incoming = harness.sends.find(([channel, action]) => channel === CHANNELS.action && action.requestId === 'lan-snapshot')[1];
    harness.host.handleRendererResponse({ requestId: incoming.requestId, ok: true, result: {} });
    assert.equal(incoming.localControl, false);
  } finally { await harness.host.dispose(); }
});

test('local actions waiting for dispatch are cancelled when advertisement changes their owner epoch', async () => {
  const harness = createHarness({ openHomeRemoteControl: false });
  await harness.host.setRendererReady();
  harness.host.setLocalControlEnabled(true);
  let release;
  harness.host.actionDispatch = new Promise(resolve => { release = resolve; });
  const pending = harness.host.requestLocalAction('Playlist', 'Snapshot');
  const rejected = assert.rejects(pending, { code: 'service-stopped' });
  try {
    await harness.host.setEnabled(true);
    await rejected;
    assert.equal(harness.host.pendingActions.size, 0);
  } finally { release(); await harness.host.dispose(); }
});

test('a revoked local endpoint session cannot dispatch a queued Play action', async () => {
  const { LocalOpenHomePlayer } = require('../../electron/pwa-network-host.cjs');
  const harness = createHarness({ openHomeRemoteControl: false });
  await harness.host.setRendererReady();
  harness.host.setLocalControlEnabled(true);
  const player = new LocalOpenHomePlayer(harness.host);
  const endpoint = player.services.get('urn:av-openhome-org:service:Playlist');
  let release;
  harness.host.actionDispatch = new Promise(resolve => { release = resolve; });
  let authorized = true;
  const pending = endpoint.invoke('Play', {}, () => authorized);
  const rejected = assert.rejects(pending, { code: 'unauthorized' });
  try {
    authorized = false;
    release();
    await rejected;
    assert.equal(harness.sends.some(([channel, action]) => channel === CHANNELS.action && action.action === 'Play'), false);
    assert.equal(harness.host.pendingActions.size, 0);
  } finally { release(); await harness.host.dispose(); }
});

test('a disconnected local session cancels renderer work already dispatched', async () => {
  const harness = createHarness({ openHomeRemoteControl: false });
  await harness.host.setRendererReady();
  harness.host.setLocalControlEnabled(true);
  let authorized = true;
  const pending = harness.host.requestLocalAction('Catalog', 'PlayItems', { items: [{ serverId: 'local', trackId: 'song' }] }, () => authorized);
  const rejected = assert.rejects(pending, { code: 'unauthorized' });
  try {
    await delay();
    assert.equal(harness.sends.some(([channel, action]) => channel === CHANNELS.action && action.action === 'PlayItems'), true);
    authorized = false;
    harness.host.cancelStaleLocalActions();
    await rejected;
    assert.equal(harness.host.pendingActions.size, 0);
    assert.equal(harness.sends.some(([channel, cancel]) => channel === CHANNELS.cancel && cancel.requestId), true);
  } finally { await harness.host.dispose(); }
});

test('Catalog preflight phase reaches the local command owner', async () => {
  const harness = createHarness({ openHomeRemoteControl: false });
  await harness.host.setRendererReady();
  harness.host.setLocalControlEnabled(true);
  try {
    const pending = harness.host.requestLocalAction('Catalog', 'PlayItems', { items: [{ serverId: 'local', trackId: 'missing' }] });
    await delay();
    const action = harness.sends.find(([channel, payload]) => channel === CHANNELS.action && payload.action === 'PlayItems')[1];
    harness.host.handleRendererResponse({ requestId: action.requestId, ok: false,
      error: { code: 'trackUnavailable', phase: 'preflight' } });
    await assert.rejects(pending, { code: 'trackUnavailable', phase: 'preflight' });
  } finally { await harness.host.dispose(); }
});

test('OpenHome host remains stopped until both enablement and renderer readiness are present', async t => {
  const harness = createHarness({ openHomeRemoteControl: false });
  const { invoke } = registerRendererIpc(t, harness);

  await invoke(CHANNELS.rendererReady);
  assert.equal(harness.sidecar.startCalls.length, 0);
  assert.equal(harness.host.getStatus().enabled, false);

  const status = await invoke(CHANNELS.setEnabled, { enabled: true });
  assert.equal(status.enabled, true);
  assert.equal(harness.sidecar.startCalls.length, 1);
  assert.equal(harness.sidecar.startCalls[0].friendlyName, 'EffeTune (Test PC)');
  assert.match(harness.sidecar.startCalls[0].udn, /^uuid:[0-9a-f-]{36}$/i);
  assert.equal(harness.getConfig().openHomeRemoteControl, true);
  assert.match(harness.getConfig().openHomeDeviceId, /^[0-9a-f-]{36}$/i);

  await invoke(CHANNELS.rendererUnavailable);
  assert.equal(harness.sidecar.stopCalls, 1);
  assert.equal(harness.gateway.closeCalls, 1);
  assert.equal(harness.host.getStatus().rendererReady, false);
});

test('OpenHome player name defaults to the computer name and can be changed while published', async t => {
  assert.equal(createDefaultFriendlyName('LISTENING-PC'), 'LISTENING-PC');
  assert.equal(createDefaultFriendlyName(''), 'EffeTune');

  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  });
  const { invoke } = registerRendererIpc(t, harness);
  await invoke(CHANNELS.rendererReady);

  const status = await invoke(CHANNELS.setFriendlyName, { friendlyName: '  EffeTune Living Room  ' });

  assert.equal(status.friendlyName, 'EffeTune Living Room');
  assert.equal(harness.getConfig().openHomeFriendlyName, 'EffeTune Living Room');
  assert.equal(harness.sidecar.stopCalls, 1);
  assert.deepEqual(harness.sidecar.startCalls.map(call => call.friendlyName), [
    'EffeTune (Test PC)',
    'EffeTune Living Room'
  ]);
  await harness.host.dispose();
});

test('OpenHome player name can be saved while disabled and blank restores the default', async () => {
  const harness = createHarness({ openHomeRemoteControl: false });

  assert.equal((await harness.host.setFriendlyName('Bedroom')).friendlyName, 'Bedroom');
  assert.equal(harness.sidecar.startCalls.length, 0);
  assert.equal((await harness.host.setFriendlyName('   ')).friendlyName, 'EffeTune (Test PC)');
  assert.equal(Object.hasOwn(harness.getConfig(), 'openHomeFriendlyName'), false);
  assert.throws(
    () => harness.host.setFriendlyName(`EffeTune ${'x'.repeat(128)}`),
    error => error?.code === 'invalid-setting'
  );
  await harness.host.dispose();
});

test('one saved device name updates both advertised services without revoking library playback', { timeout: 10000 }, async t => {
  const os = require('node:os');
  const { NetworkMusicHost } = require('../../electron/network-music-host.cjs');
  const { Discovery, requestXml } = require('../../electron/network-music-upnp.cjs');
  const { LocalOpenHomePlayer } = require('../../electron/pwa-network-host.cjs');
  const { RemoteControlHost } = require('../../electron/remote-control-host.cjs');
  t.mock.method(os, 'hostname', () => 'LISTENING-PC');
  t.mock.method(os, 'networkInterfaces', () => ({ test: [{ family: 'IPv4', internal: false, address: '127.0.0.1' }] }));
  let music;
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeFriendlyName: 'Saved Room',
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555',
    networkMusicDeviceId: 'uuid:library',
    networkMusicSharing: { enabled: true, folderIds: ['shared'] }
  }, {
    defaultFriendlyName: createDefaultFriendlyName(),
    onFriendlyNameChanged: () => music.refreshFriendlyName()
  });
  const descriptions = [];
  const peer = new Discovery({ fetchXml: async location => { descriptions.push(location); return requestXml(location); } });
  const discovery = new Discovery();
  const announcements = [];
  discovery.start = async () => {};
  discovery.socket = {
    setMulticastInterface() {},
    send(bytes, _port, _address, callback) {
      announcements.push(bytes.toString());
      // Missed withdrawal packets must not leave an available cached name stale.
      const received = bytes.includes('ssdp:byebye') ? Promise.resolve() : peer.receive(bytes, { address: '127.0.0.1' });
      void received.then(() => callback(), callback);
    },
    close() {}
  };
  const localPlayer = new LocalOpenHomePlayer(harness.host);
  music = new NetworkMusicHost({
    localPlayer, discovery, getCatalog: async () => null,
    loadConfig: harness.getConfig, saveConfig() {},
    getFriendlyName: () => harness.host.getFriendlyName()
  });
  const remote = new RemoteControlHost({
    app: {}, getMainWindow: () => null, env: { EFFETUNE_REMOTE_TOKEN: 'fixture-token' }, argv: [],
    config: { loadConfig: harness.getConfig }, networkMusic: music, localPlayer, getPlayerId: () => localPlayer.id,
    log() {}
  });
  t.after(async () => { await remote.dispose(); await music.dispose(); await harness.host.dispose(); });
  await harness.host.setRendererReady();
  await music.start();
  await discovery.multicastSending;
  const server = music.server.server;
  const port = music.server.port;
  const sharing = music.sharing;
  const resource = music.server.resource('track', '127.0.0.1');
  let streamDestroyed = false;
  music.server.streams.add({ destroy() { streamDestroyed = true; } });
  const queue = Promise.resolve();
  music.queues.set('peer', queue);
  remote.pwa.grants.set('grant', { uid: 'track' });
  assert.equal(peer.devices.get(music.id).name, 'Saved Room');
  assert.equal(music.server.name, harness.host.getStatus().friendlyName);

  for (const [input, expected] of [['  New & Room  ', 'New & Room'], ['   ', 'LISTENING-PC']]) {
    const before = descriptions.length;
    await harness.host.setFriendlyName(input);
    assert.equal(descriptions.length, before + 1);
    assert.equal(peer.devices.get(music.id).name, expected);
    assert.equal(harness.sidecar.startCalls.at(-1).friendlyName, expected);
    assert.equal(music.server.name, expected);
    assert.equal((await remote.pwa.info()).name, expected);
    assert.equal(remote.pairing.getInfo().name, expected);
    assert.equal(music.server.server, server);
    assert.equal(music.server.port, port);
    assert.equal(music.server.resource('track', '127.0.0.1').uri, resource.uri);
    assert.equal(streamDestroyed, false);
    assert.equal(music.queues.get('peer'), queue);
    assert.equal(music.sharing, sharing);
    assert.equal(remote.pwa.grants.size, 1);
    assert.equal(harness.gateway.closeCalls, 0);
    assert.equal(harness.sends.filter(([channel]) => channel === CHANNELS.reset).length, 0);
  }
  assert.equal(Object.hasOwn(harness.getConfig(), 'openHomeFriendlyName'), false);
  assert.ok(announcements.some(packet => packet.includes('NTS: ssdp:byebye')));
  assert.equal(new URL(descriptions.at(-1)).searchParams.get('name'), 'LISTENING-PC');

  await harness.host.setEnabled(false);
  const starts = harness.sidecar.startCalls.length;
  await harness.host.setFriendlyName('Library Only');
  assert.equal(peer.devices.get(music.id).name, 'Library Only');
  assert.equal(harness.sidecar.startCalls.length, starts);
  const announcementCount = announcements.length;
  await harness.host.setFriendlyName('Library Only');
  assert.equal(announcements.length, announcementCount);
});

test('OpenHome host serializes lifecycle changes and converges after a stale start', async () => {
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  });
  const operations = [];
  let finishStart;
  harness.sidecar.start = configuration => {
    harness.sidecar.startCalls.push(configuration);
    operations.push('start');
    return new Promise(resolve => { finishStart = resolve; });
  };
  harness.sidecar.stop = () => {
    harness.sidecar.stopCalls += 1;
    operations.push('stop');
    return Promise.resolve();
  };

  const ready = harness.host.setRendererReady();
  await delay();
  const unavailable = harness.host.setRendererUnavailable();
  assert.deepEqual(operations, ['start']);

  finishStart(true);
  await Promise.all([ready, unavailable]);
  assert.deepEqual(operations, ['start', 'stop']);
  assert.equal(harness.host.getStatus().rendererReady, false);
});

test('OpenHome host retries failed starts with capped backoff and cancels retries when disabled', async () => {
  const timers = [];
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  }, {
    setTimer(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { timer.cleared = true; }
  });
  harness.sidecar.start = configuration => {
    harness.sidecar.startCalls.push(configuration);
    harness.sidecar.state = 'unavailable';
    return false;
  };

  await harness.host.setRendererReady();
  assert.equal(harness.sidecar.startCalls.length, 1);
  assert.equal(harness.host.reconciledMode, 'paused');
  assert.equal(timers[0].milliseconds, SIDECAR_RETRY_BASE_MS);

  timers[0].callback();
  await delay();
  assert.equal(harness.sidecar.startCalls.length, 2);
  assert.equal(timers[1].milliseconds, SIDECAR_RETRY_BASE_MS * 2);

  await harness.host.setEnabled(false);
  assert.equal(timers[1].cleared, true);
  timers[1].callback();
  await delay();
  assert.equal(harness.sidecar.startCalls.length, 2);
});

test('OpenHome host backs off repeated sidecar crashes without discarding its queue registrations', async () => {
  const timers = [];
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  }, {
    now: () => 1000,
    setTimer(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { timer.cleared = true; }
  });
  harness.host.tokensByTrackId.set(7, 'queue-token');
  await harness.host.setRendererReady();
  harness.sidecar.state = 'ready';
  harness.sidecar.emit('ready');

  harness.sidecar.state = 'failed';
  harness.sidecar.emit('status', { state: 'failed', available: true });
  assert.equal(timers[0].milliseconds, SIDECAR_RETRY_BASE_MS);
  assert.deepEqual([...harness.host.tokensByTrackId], [[7, 'queue-token']]);
  assert.equal(harness.gateway.closeCalls, 0);

  timers[0].callback();
  await delay();
  assert.equal(harness.sidecar.startCalls.length, 2);
  harness.sidecar.state = 'failed';
  harness.sidecar.emit('status', { state: 'failed', available: true });
  assert.equal(timers[1].milliseconds, SIDECAR_RETRY_BASE_MS * 2);
  assert.deepEqual([...harness.host.tokensByTrackId], [[7, 'queue-token']]);

  timers[1].callback();
  await delay();
  harness.host.sidecarRetryAttempt = 99;
  harness.sidecar.state = 'failed';
  harness.sidecar.emit('status', { state: 'failed', available: true });
  assert.equal(timers[2].milliseconds, SIDECAR_RETRY_MAX_MS);

  await harness.host.setRendererUnavailable();
  assert.equal(timers[2].cleared, true);
  assert.deepEqual(harness.gateway.releaseCalls, ['queue-token']);
});

test('OpenHome host never runs a queued crash retry after disposal', async () => {
  const timers = [];
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  }, {
    setTimer(callback, milliseconds) {
      const timer = { callback, milliseconds, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) { timer.cleared = true; }
  });
  await harness.host.setRendererReady();
  harness.sidecar.state = 'failed';
  harness.sidecar.emit('status', { state: 'failed', available: true });
  const startsBeforeDispose = harness.sidecar.startCalls.length;

  await harness.host.dispose();
  assert.equal(timers[0].cleared, true);
  timers[0].callback();
  await delay();
  assert.equal(harness.sidecar.startCalls.length, startsBeforeDispose);
});

test('OpenHome host pauses and resumes advertisement without expiring the remote queue', async () => {
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  });
  await harness.host.setRendererReady();
  harness.host.tokensByTrackId.set(9, 'long-lived-token');
  harness.host.latestSnapshot = { transportState: 'Paused', idArray: 'queue' };
  const startsBeforeSuspend = harness.sidecar.startCalls.length;

  await harness.host.setEnvironmentAvailable(false);
  assert.equal(harness.sidecar.stopCalls, 1);
  assert.equal(harness.gateway.closeCalls, 0);
  assert.deepEqual([...harness.host.tokensByTrackId], [[9, 'long-lived-token']]);
  assert.deepEqual(harness.host.latestSnapshot, { transportState: 'Paused', idArray: 'queue' });
  harness.sidecar.emit('action', {
    requestId: 'suspended-play', service: 'Playlist', action: 'Play', args: {}
  });
  await delay();
  assert.deepEqual(harness.sidecar.rejections.at(-1), {
    requestId: 'suspended-play', code: 'renderer-unavailable'
  });
  assert.equal(harness.sends.some(([channel]) => channel === CHANNELS.action), false);

  await harness.host.setEnvironmentAvailable(true);
  assert.equal(harness.sidecar.startCalls.length, startsBeforeSuspend + 1);
  assert.equal(harness.gateway.closeCalls, 0);
  assert.deepEqual([...harness.host.tokensByTrackId], [[9, 'long-lived-token']]);
  await harness.host.dispose();
});

test('OpenHome host safely restarts advertisement after a network change', async () => {
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  });
  await harness.host.setRendererReady();
  harness.host.tokensByTrackId.set(11, 'network-token');
  const startsBeforeRestart = harness.sidecar.startCalls.length;

  await harness.host.restartForEnvironmentChange();

  assert.equal(harness.sidecar.stopCalls, 1);
  assert.equal(harness.sidecar.startCalls.length, startsBeforeRestart + 1);
  assert.equal(harness.gateway.closeCalls, 0);
  assert.deepEqual([...harness.host.tokensByTrackId], [[11, 'network-token']]);
  await harness.host.dispose();
});

test('OpenHome host gateways Insert media and DIDL artwork and releases both with queue actions', async t => {
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  }, { now: () => 1234 });
  const { invoke } = registerRendererIpc(t, harness);
  await invoke(CHANNELS.rendererReady);

  harness.sidecar.emit('action', {
    requestId: 'insert-1',
    service: 'Playlist',
    action: 'Insert',
    args: {
      afterId: 0,
      uri: 'http://media.test/song.flac',
      metadata: '<DIDL-Lite><item><upnp:albumArtURI>http://art.test/cover.jpg?x=1&amp;y=2</upnp:albumArtURI></item></DIDL-Lite>'
    }
  });
  await delay();

  assert.deepEqual(harness.gateway.registerCalls, [
    'http://media.test/song.flac',
    'http://art.test/cover.jpg?x=1&y=2'
  ]);
  const actionSend = harness.sends.find(([channel]) => channel === CHANNELS.action);
  assert.equal(actionSend[1].deadlineEpochMs, 1234 + ACTION_TIMEOUT_MS);
  assert.equal(actionSend[1].args.uri, 'http://media.test/song.flac');
  assert.equal(actionSend[1].args.playbackUrl, 'http://127.0.0.1:43123/openhome-media/token');
  assert.equal(actionSend[1].args.artworkUrl, 'http://127.0.0.1:43123/openhome-media/token');

  assert.equal(invoke(CHANNELS.response, {
    requestId: 'insert-1', ok: true, result: { newId: 17 }
  }), true);
  assert.deepEqual(harness.sidecar.responses, [{ requestId: 'insert-1', result: { newId: 17 } }]);
  assert.deepEqual([...harness.host.artworkTokensByTrackId], [[17, 'token-2']]);

  harness.sidecar.emit('action', {
    requestId: 'delete-1',
    service: 'Playlist',
    action: 'DeleteId',
    args: { id: 17 }
  });
  await delay();
  invoke(CHANNELS.response, { requestId: 'delete-1', ok: true, result: {} });
  assert.deepEqual(harness.gateway.releaseCalls, ['token-1', 'token-2']);
  await harness.host.dispose();
});

test('OpenHome DIDL artwork extraction ignores absent elements and decodes XML character references', () => {
  assert.equal(extractDidlAlbumArtUri('<DIDL-Lite />'), '');
  assert.equal(
    extractDidlAlbumArtUri('<albumArtURI>https://art.test/a&#x2f;b?x=&#49;&amp;y=2</albumArtURI>'),
    'https://art.test/a/b?x=1&y=2'
  );
});

test('OpenHome host commits gateway tokens only after the sidecar accepts queue mutations', async () => {
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  });
  await harness.host.setRendererReady();
  const respond = async (action, result = {}) => {
    harness.sidecar.emit('action', action);
    await delay();
    return harness.host.handleRendererResponse({ requestId: action.requestId, ok: true, result });
  };

  harness.sidecar.respondAccepted = false;
  assert.equal(await respond({
    requestId: 'insert-rejected', service: 'Playlist', action: 'Insert',
    args: { afterId: 0, uri: 'http://media.test/rejected.flac', metadata: '' }
  }, { newId: 1 }), false);
  assert.deepEqual([...harness.host.tokensByTrackId], []);
  assert.deepEqual(harness.gateway.releaseCalls, ['token-1']);

  harness.sidecar.respondAccepted = true;
  assert.equal(await respond({
    requestId: 'insert-accepted', service: 'Playlist', action: 'Insert',
    args: { afterId: 0, uri: 'http://media.test/accepted.flac', metadata: '' }
  }, { newId: 2 }), true);
  assert.deepEqual([...harness.host.tokensByTrackId], [[2, 'token-2']]);

  harness.sidecar.respondAccepted = false;
  assert.equal(await respond({
    requestId: 'delete-rejected', service: 'Playlist', action: 'DeleteId', args: { id: 2 }
  }), false);
  assert.deepEqual([...harness.host.tokensByTrackId], [[2, 'token-2']]);

  harness.sidecar.respondAccepted = true;
  assert.equal(await respond({
    requestId: 'delete-accepted', service: 'Playlist', action: 'DeleteId', args: { id: 2 }
  }), true);
  assert.deepEqual([...harness.host.tokensByTrackId], []);
  assert.deepEqual(harness.gateway.releaseCalls, ['token-1', 'token-2']);

  await respond({
    requestId: 'insert-all-1', service: 'Playlist', action: 'Insert',
    args: { afterId: 0, uri: 'http://media.test/all-1.flac', metadata: '' }
  }, { newId: 3 });
  await respond({
    requestId: 'insert-all-2', service: 'Playlist', action: 'Insert',
    args: { afterId: 3, uri: 'http://media.test/all-2.flac', metadata: '' }
  }, { newId: 4 });
  harness.sidecar.respondAccepted = false;
  assert.equal(await respond({
    requestId: 'delete-all-rejected', service: 'Playlist', action: 'DeleteAll', args: {}
  }), false);
  assert.deepEqual([...harness.host.tokensByTrackId], [[3, 'token-3'], [4, 'token-4']]);

  harness.sidecar.respondAccepted = true;
  assert.equal(await respond({
    requestId: 'delete-all-accepted', service: 'Playlist', action: 'DeleteAll', args: {}
  }), true);
  assert.deepEqual([...harness.host.tokensByTrackId], []);
  assert.deepEqual(harness.gateway.releaseCalls, ['token-1', 'token-2', 'token-3', 'token-4']);
  await harness.host.dispose();
});

test('OpenHome host reserves Insert actions before registration and releases stale results', async () => {
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  });
  let finishRegistration;
  harness.gateway.register = uri => {
    harness.gateway.registerCalls.push(uri);
    return new Promise(resolve => { finishRegistration = resolve; });
  };
  await harness.host.setRendererReady();

  harness.sidecar.emit('action', {
    requestId: 'insert-stale',
    service: 'Playlist',
    action: 'Insert',
    args: { afterId: 0, uri: 'http://media.test/stale.flac', metadata: '' }
  });
  await delay();
  await harness.host.setRendererUnavailable();
  finishRegistration({ token: 'stale-token', playbackUrl: 'http://127.0.0.1/stale' });
  await delay();

  assert.deepEqual(harness.gateway.releaseCalls, ['stale-token']);
  assert.deepEqual(harness.sidecar.rejections, [{
    requestId: 'insert-stale', code: 'renderer-unavailable'
  }]);
  assert.equal(harness.sends.some(([channel]) => channel === CHANNELS.action), false);
});

test('OpenHome host preserves arrival order when Insert and Play overlap', async () => {
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  });
  let finishRegistration;
  harness.gateway.register = uri => {
    harness.gateway.registerCalls.push(uri);
    return new Promise(resolve => { finishRegistration = resolve; });
  };
  await harness.host.setRendererReady();

  harness.sidecar.emit('action', {
    requestId: 'insert-pending',
    service: 'Playlist',
    action: 'Insert',
    args: { afterId: 0, uri: 'http://media.test/pending.flac', metadata: '' }
  });
  harness.sidecar.emit('action', {
    requestId: 'play-overlap', service: 'Playlist', action: 'Play', args: {}
  });
  await delay();

  assert.deepEqual(harness.gateway.registerCalls, ['http://media.test/pending.flac']);
  assert.deepEqual(harness.sidecar.rejections, []);
  assert.equal(harness.sends.some(([channel]) => channel === CHANNELS.action), false);

  finishRegistration({ token: 'pending-token', playbackUrl: 'http://127.0.0.1/pending' });
  await delay();
  const rendererActions = harness.sends
    .filter(([channel]) => channel === CHANNELS.action)
    .map(([, action]) => action.requestId);
  assert.deepEqual(rendererActions, ['insert-pending', 'play-overlap']);
  assert.equal(harness.host.handleRendererResponse({
    requestId: 'insert-pending', ok: true, result: { newId: 19 }
  }), true);
  assert.equal(harness.host.handleRendererResponse({
    requestId: 'play-overlap', ok: true, result: {}
  }), true);
  await harness.host.dispose();
});

test('OpenHome host cancels timed-out renderer work, ignores late responses, and reuses the slot', async () => {
  let timeoutCallback = null;
  let timeoutDelay = null;
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  }, {
    setTimer(callback, milliseconds) {
      timeoutCallback = callback;
      timeoutDelay = milliseconds;
      return 1;
    },
    clearTimer() {}
  });
  await harness.host.setRendererReady();

  harness.sidecar.emit('action', {
    requestId: 'play-timeout', service: 'Playlist', action: 'Play', args: {}
  });
  await delay();
  assert.equal(timeoutDelay, ACTION_TIMEOUT_MS);
  assert.equal(typeof timeoutCallback, 'function');

  timeoutCallback();
  assert.deepEqual(harness.sends.filter(([channel]) => channel === CHANNELS.cancel), [[
    CHANNELS.cancel, { requestId: 'play-timeout' }
  ]]);
  assert.deepEqual(harness.sidecar.rejections, [{
    requestId: 'play-timeout', code: 'action-timeout'
  }]);
  assert.equal(harness.host.handleRendererResponse({
    requestId: 'play-timeout', ok: true, result: {}
  }), false);

  harness.sidecar.emit('action', {
    requestId: 'play-after-timeout', service: 'Playlist', action: 'Play', args: {}
  });
  await delay();
  assert.deepEqual(harness.sends
    .filter(([channel]) => channel === CHANNELS.action)
    .map(([, action]) => action.requestId), ['play-timeout', 'play-after-timeout']);
  assert.equal(harness.host.handleRendererResponse({
    requestId: 'play-after-timeout', ok: true, result: {}
  }), true);
  await harness.host.dispose();
});

test('OpenHome host rejects and releases its only pending action when disabled', async () => {
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  });
  await harness.host.setRendererReady();
  harness.sidecar.emit('action', {
    requestId: 'insert-disable',
    service: 'Playlist',
    action: 'Insert',
    args: { afterId: 0, uri: 'http://media.test/disable.flac', metadata: '' }
  });
  await delay();

  await harness.host.setEnabled(false);

  assert.deepEqual(harness.sidecar.rejections, [{
    requestId: 'insert-disable', code: 'service-stopped'
  }]);
  assert.deepEqual(harness.gateway.releaseCalls, ['token-1']);
  assert.deepEqual(harness.sends.filter(([channel]) => channel === CHANNELS.cancel), [[
    CHANNELS.cancel, { requestId: 'insert-disable' }
  ]]);
  assert.equal(harness.host.handleRendererResponse({
    requestId: 'insert-disable', ok: true, result: { newId: 20 }
  }), false);
});

test('OpenHome disable resets the renderer before stopping advertisement and releasing tokens', async t => {
  const order = [];
  let finishStop;
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  }, { autoResetAck: false });
  const { invoke } = registerRendererIpc(t, harness);
  harness.sidecar.stop = () => {
    order.push('sidecar-stop');
    return new Promise(resolve => { finishStop = resolve; });
  };
  harness.gateway.release = token => {
    order.push(`release:${token}`);
    harness.gateway.releaseCalls.push(token);
    return true;
  };
  harness.gateway.close = () => {
    order.push('gateway-close');
    harness.gateway.closeCalls += 1;
    return Promise.resolve();
  };
  await invoke(CHANNELS.rendererReady);
  harness.sidecar.emit('action', {
    requestId: 'insert-disable-order', service: 'Playlist', action: 'Insert',
    args: { afterId: 0, uri: 'http://media.test/order.flac', metadata: '' }
  });
  await delay();
  invoke(CHANNELS.response, {
    requestId: 'insert-disable-order', ok: true, result: { newId: 9 }
  });
  invoke(CHANNELS.state, { transportState: 'Playing', idArray: 'stale' });
  const snapshotCount = harness.sidecar.snapshots.length;

  const disabling = invoke(CHANNELS.setEnabled, { enabled: false });
  await delay();
  const reset = harness.sends.find(([channel]) => channel === CHANNELS.reset);
  assert.equal(harness.host.getStatus().enabled, false);
  assert.equal(invoke(CHANNELS.state, { transportState: 'Playing', idArray: 'new-stale' }), false);
  assert.equal(harness.sidecar.snapshots.length, snapshotCount);
  assert.deepEqual(order, []);

  assert.equal(invoke(CHANNELS.resetAck, { resetId: reset[1].resetId, ok: true }), true);
  await delay();
  assert.deepEqual(order, ['sidecar-stop']);
  finishStop();
  await disabling;
  assert.deepEqual(order, ['sidecar-stop', 'release:token-1', 'gateway-close']);
  assert.equal(harness.host.latestSnapshot, null);

  harness.sidecar.stop = () => Promise.resolve();
  await invoke(CHANNELS.setEnabled, { enabled: true });
  harness.sidecar.emit('ready');
  assert.equal(harness.sidecar.snapshots.length, snapshotCount);
  await harness.host.dispose();
});

test('OpenHome queues enable behind disable reset and cleanup without publishing stale state', async () => {
  const order = [];
  let finishStop;
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  }, { autoResetAck: false });
  await harness.host.setRendererReady();
  const startsBeforeRace = harness.sidecar.startCalls.length;
  harness.sidecar.start = configuration => {
    order.push('start');
    harness.sidecar.startCalls.push(configuration);
    return true;
  };
  harness.sidecar.stop = () => {
    order.push('stop');
    return new Promise(resolve => { finishStop = resolve; });
  };
  harness.gateway.release = token => {
    order.push(`release:${token}`);
    harness.gateway.releaseCalls.push(token);
    return true;
  };
  harness.gateway.close = () => {
    order.push('close');
    harness.gateway.closeCalls += 1;
    return Promise.resolve();
  };
  harness.sidecar.emit('action', {
    requestId: 'insert-enable-race', service: 'Playlist', action: 'Insert',
    args: { afterId: 0, uri: 'http://media.test/race.flac', metadata: '' }
  });
  await delay();
  harness.host.handleRendererResponse({
    requestId: 'insert-enable-race', ok: true, result: { newId: 11 }
  });
  harness.host.publishState({ transportState: 'Playing', idArray: 'old' });
  const snapshotCount = harness.sidecar.snapshots.length;

  const disable = harness.host.setEnabled(false);
  const enable = harness.host.setEnabled(true);
  harness.sidecar.emit('action', {
    requestId: 'action-during-reset', service: 'Playlist', action: 'Play', args: {}
  });
  assert.equal(harness.host.publishState({ transportState: 'Playing', idArray: 'blocked' }), false);
  await delay();
  assert.deepEqual(harness.sidecar.rejections.at(-1), {
    requestId: 'action-during-reset', code: 'renderer-unavailable'
  });
  const reset = harness.sends.filter(([channel]) => channel === CHANNELS.reset).at(-1)[1];
  harness.host.handleRendererResetAck({ resetId: reset.resetId, ok: true });
  await delay();
  assert.deepEqual(order, ['stop']);
  assert.deepEqual(harness.gateway.releaseCalls, []);

  finishStop();
  await Promise.all([disable, enable]);
  assert.deepEqual(order, ['stop', 'release:token-1', 'close', 'start']);
  assert.deepEqual(harness.gateway.releaseCalls, ['token-1']);
  assert.equal(harness.gateway.closeCalls, 1);
  assert.equal(harness.sidecar.startCalls.length, startsBeforeRace + 1);
  assert.equal(harness.host.latestSnapshot, null);
  harness.sidecar.emit('ready');
  assert.equal(harness.sidecar.snapshots.length, snapshotCount);

  harness.sidecar.stop = () => Promise.resolve();
  await harness.host.dispose();
});

test('OpenHome rapid settings transitions do not duplicate cleanup or leak registrations', async () => {
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  });
  await harness.host.setRendererReady();
  harness.sidecar.emit('action', {
    requestId: 'insert-rapid-settings', service: 'Playlist', action: 'Insert',
    args: { afterId: 0, uri: 'http://media.test/rapid.flac', metadata: '' }
  });
  await delay();
  harness.host.handleRendererResponse({
    requestId: 'insert-rapid-settings', ok: true, result: { newId: 12 }
  });
  const startsBeforeTransitions = harness.sidecar.startCalls.length;

  await Promise.all([
    harness.host.setEnabled(false),
    harness.host.setEnabled(true),
    harness.host.setEnabled(false),
    harness.host.setEnabled(true)
  ]);

  assert.equal(harness.host.getStatus().enabled, true);
  assert.equal(harness.host.resetRequired, false);
  assert.equal(harness.host.pendingDisableTransitions, 0);
  assert.deepEqual(harness.gateway.releaseCalls, ['token-1']);
  assert.equal(harness.gateway.closeCalls, 1);
  assert.equal(harness.sidecar.stopCalls, 1);
  assert.equal(harness.sidecar.startCalls.length, startsBeforeTransitions + 1);
  assert.deepEqual([...harness.host.tokensByTrackId], []);
  await harness.host.dispose();
});

test('OpenHome reset timeout preserves renderer liveness and enable retries the reset', async () => {
  let timerCallback = null;
  let timerDelay = null;
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  }, {
    autoResetAck: false,
    setTimer(callback, milliseconds) {
      timerCallback = callback;
      timerDelay = milliseconds;
      return 1;
    },
    clearTimer() {}
  });
  await harness.host.setRendererReady();
  const startsBeforeDisable = harness.sidecar.startCalls.length;
  const disabling = harness.host.setEnabled(false);
  await delay();
  assert.equal(timerDelay, RESET_TIMEOUT_MS);
  timerCallback();
  await disabling;
  assert.equal(harness.host.getStatus().rendererReady, true);
  assert.equal(harness.host.resetRequired, true);

  const enabling = harness.host.setEnabled(true);
  await delay();
  assert.equal(harness.sidecar.startCalls.length, startsBeforeDisable);
  const resets = harness.sends.filter(([channel]) => channel === CHANNELS.reset);
  const retry = resets.at(-1)[1];
  harness.host.handleRendererResetAck({ resetId: retry.resetId, ok: true });
  await enabling;
  assert.equal(harness.host.resetRequired, false);
  assert.equal(harness.sidecar.startCalls.length, startsBeforeDisable + 1);
  await harness.host.dispose();
});

test('OpenHome renderer disappearance fails an in-flight reset and stops without early token release', async t => {
  let finishStop;
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  }, { autoResetAck: false });
  const { invoke } = registerRendererIpc(t, harness);
  harness.sidecar.stop = () => new Promise(resolve => { finishStop = resolve; });
  await invoke(CHANNELS.rendererReady);
  harness.sidecar.emit('action', {
    requestId: 'insert-renderer-loss', service: 'Playlist', action: 'Insert',
    args: { afterId: 0, uri: 'http://media.test/loss.flac', metadata: '' }
  });
  await delay();
  invoke(CHANNELS.response, {
    requestId: 'insert-renderer-loss', ok: true, result: { newId: 10 }
  });

  const disabling = invoke(CHANNELS.setEnabled, { enabled: false });
  await delay();
  const unavailable = invoke(CHANNELS.rendererUnavailable);
  await delay();
  assert.deepEqual(harness.gateway.releaseCalls, []);
  finishStop();
  await Promise.all([disabling, unavailable]);
  assert.equal(harness.host.getStatus().rendererReady, false);
  assert.equal(harness.host.resetRequired, true);
  assert.deepEqual(harness.gateway.releaseCalls, ['token-1']);
  const reloading = invoke(CHANNELS.rendererReady);
  await delay();
  assert.equal(invoke(CHANNELS.state, { transportState: 'Playing', idArray: 'stale-before-reset' }), false);
  const reset = harness.sends.filter(([channel]) => channel === CHANNELS.reset).at(-1)[1];
  assert.equal(invoke(CHANNELS.resetAck, { resetId: reset.resetId, ok: true }), true);
  await reloading;
  assert.equal(harness.host.resetRequired, false);
  assert.equal(harness.host.latestSnapshot, null);
  await harness.host.dispose();
});

test('OpenHome host rejects actions while renderer is unavailable', async () => {
  const harness = createHarness({
    openHomeRemoteControl: true,
    openHomeDeviceId: '11111111-2222-4333-8444-555555555555'
  });
  harness.sidecar.emit('action', {
    requestId: 'play-1', service: 'Playlist', action: 'Play', args: {}
  });
  await delay();

  assert.deepEqual(harness.sidecar.rejections, [{
    requestId: 'play-1', code: 'renderer-unavailable'
  }]);
  assert.equal(harness.sends.some(([channel]) => channel === CHANNELS.action), false);
  await harness.host.dispose();
});

test('OpenHome IPC accepts requests only from the current renderer', async t => {
  const harness = createHarness();
  const { handlers, invoke, dispose } = registerRendererIpc(t, harness);

  assert.throws(
    () => handlers.get(CHANNELS.getStatus)({ sender: {} }),
    error => error?.code === 'invalid-sender'
  );
  assert.equal((await invoke(CHANNELS.getStatus)).apiVersion, 1);

  dispose();
  assert.equal(handlers.size, 0);
  await harness.host.dispose();
});

test('UPnP AV has independent permission and persistent identity while sharing the sidecar', async t => {
  const h = createHarness();
  const { invoke } = registerRendererIpc(t, h);
  await invoke(CHANNELS.rendererReady);
  await invoke(CHANNELS.setUpnpAvEnabled, { enabled: true });
  assert.equal(h.host.getStatus().enabled, false);
  assert.equal(h.host.getStatus().upnpAvEnabled, true);
  const config = h.getConfig();
  assert.notEqual(config.upnpAvDeviceId, config.openHomeDeviceId);
  assert.equal(h.sidecar.startCalls.at(-1).openHomeEnabled, false);
  assert.equal(h.sidecar.startCalls.at(-1).upnpAvEnabled, true);
  await invoke(CHANNELS.setEnabled, { enabled: true });
  await invoke(CHANNELS.setEnabled, { enabled: false });
  assert.equal(h.host.getDesiredServiceMode(), 'running');
  assert.equal(h.sidecar.startCalls.at(-1).upnpAvUdn, `uuid:${config.upnpAvDeviceId}`);
  assert.equal(h.sends.filter(([channel]) => channel === CHANNELS.reset).length, 0);
  await invoke(CHANNELS.setUpnpAvEnabled, { enabled: false });
  assert.equal(h.host.getDesiredServiceMode(), 'stopped');
  assert.equal(h.sends.filter(([channel]) => channel === CHANNELS.reset).length, 1);
  await h.host.dispose();
});

test('UPnP URI replacement keeps old gateway registrations until its single queue commit', async () => {
  const h = createHarness({ upnpAvRemoteControl: true });
  await h.host.setRendererReady();
  h.host.tokensByTrackId.set(7, 'old');
  await h.host.handleSidecarAction({ requestId: 'av-uri', service: 'AVTransport', action: 'SetAVTransportURI',
    args: { uri: 'https://example.test/new.mp3', metadata: '' } });
  const action = h.sends.find(([channel]) => channel === CHANNELS.action)[1];
  assert.match(action.args.playbackUrl, /^http:\/\/127\.0\.0\.1:/);
  assert.deepEqual(h.gateway.releaseCalls, []);
  h.host.handleRendererResponse({ requestId: 'av-uri', ok: true, result: { newId: 9 } });
  assert.deepEqual(h.gateway.releaseCalls, ['old']);
  assert.equal(h.host.tokensByTrackId.get(9), 'token-1');
  await h.host.dispose();
});

test('development receiver resolves the freshly built platform helper without replacing a running old helper', async () => {
  const path = require('node:path');
  const { createOpenHomeControlHost } = require('../../electron/openhome-control-host.cjs');
  for (const packaged of [false, true]) {
    const host = createOpenHomeControlHost({ app: { isPackaged: packaged, getAppPath: () => '/workspace' },
      processRef: { platform: 'win32', arch: 'x64', resourcesPath: '/resources' },
      constants: { setAppConfig() {} }, config: { loadConfig: () => ({}), saveConfig: () => true }, getMainWindow: () => null });
    assert.equal(host.sidecar.sidecarPath, packaged
      ? path.join('/resources', 'openhome', 'effetune-openhome-sidecar.exe')
      : path.join('/workspace', 'out', 'native', 'openhome-sidecar', 'win32-x64', 'effetune-openhome-sidecar.exe'));
    await host.dispose();
  }
});
