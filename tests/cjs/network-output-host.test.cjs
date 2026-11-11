const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { NetworkOutputHost, DelayLine, normalizeConfiguration, sanitizeConfiguration, DEFAULT_CONFIGURATION, SAMPLE_RATE, L0_MS, LATENCY_SAMPLES, CAST_POLL_MS } = require('../../electron/network-output-host.cjs');
const { CastSession } = require('../../electron/cast-sender.cjs');
const { FEEDBACK_FRESHNESS_MS } = require('../../electron/network-output-live.cjs');

const settle = async () => { for (let i = 0; i < 8; i += 1) await new Promise(resolve => setImmediate(resolve)); };

function createClock() {
  let now = 1_000;
  let nextId = 1;
  const timers = new Map();
  const add = (callback, delay, repeat) => { const id = nextId++; timers.set(id, { callback, at: now + delay, delay, repeat }); return { id, unref() {} }; };
  return {
    timers,
    now: () => now,
    setTimeoutFn: (callback, delay) => add(callback, delay, false),
    setIntervalFn: (callback, delay) => add(callback, delay, true),
    clearTimeoutFn: handle => timers.delete(handle?.id),
    clearIntervalFn: handle => timers.delete(handle?.id),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        const [id, timer] = due;
        now = timer.at;
        if (timer.repeat) timer.at += timer.delay; else timers.delete(id);
        timer.callback();
        await settle();
      }
      now = end;
    }
  };
}

class FakeStream extends EventEmitter {
  constructor(contentType, token) { super(); this.contentType = contentType; this.token = token; this.writes = []; this.closed = false; this.frames = null; }
  url(host) { return `http://${host}:9000/live/${this.token}`; }
  write(samples) { this.writes.push(Int16Array.from(samples)); }
  framesAt() { return this.frames; }
  close() { this.closed = true; }
}

class FakeCast extends EventEmitter {
  constructor(options, log) { super(); this.options = options; this.log = log; this.closed = false; this.launchResult = undefined; this.status = null; }
  async connect() { this.log.push(['cast-connect', this.options.host, this.options.port]); }
  async launchAndLoad(request) { this.log.push(['cast-load', request]); return this.launchResult; }
  async stop() { this.log.push(['cast-stop']); }
  async mediaStatus(mediaSessionId) { this.log.push(['cast-status', mediaSessionId]); return this.status; }
  close() { this.closed = true; this.log.push(['cast-close']); }
}

function upnpDevice(id, name, { address = '192.168.1.30', connectionManager = true } = {}) {
  const services = new Map([['AVTransport', { id, type: 'AVTransport' }]]);
  if (connectionManager) services.set('ConnectionManager', { id, type: 'ConnectionManager' });
  return { id, name, available: true, address, services, state: { transport: 'NO_MEDIA_PRESENT', uri: '', sink: 'http-get:*:audio/flac:*,http-get:*:audio/mpeg:*' } };
}

function createHarness({ openFails = false } = {}) {
  const clock = createClock();
  const log = [];
  const statuses = [];
  const diagnostics = [];
  const discovery = Object.assign(new EventEmitter(), { devices: new Map(), start: () => { log.push(['discovery-start']); return Promise.resolve(); } });
  const castDiscovery = Object.assign(new EventEmitter(), { devices: new Map(), start: () => log.push(['cast-discovery-start']), stop: () => log.push(['cast-discovery-stop']) });
  const streams = [];
  let nextToken = 1;
  const streamServer = {
    open: async () => { log.push(['server-open']); if (openFails) throw new Error('bind failed'); },
    close: async () => { log.push(['server-close']); },
    createStream: ({ contentType }) => { const stream = new FakeStream(contentType, `t${nextToken++}`); streams.push(stream); return stream; }
  };
  const casts = [];
  // Each hook adjusts the next Cast session before the host uses it (e.g. to make its connect fail).
  const castHooks = [];
  const upnp = {
    service: (device, type) => device?.services?.get(type) ?? null,
    didl: items => JSON.stringify(items),
    didlItem: item => item,
    soap: async (service, action, args) => {
      const device = discovery.devices.get(service.id);
      log.push(['soap', service.id, action, args]);
      if (device.state.fail || device.state.failActions?.includes(action)) throw new Error(`${action} failed`);
      switch (action) {
        case 'GetProtocolInfo': return { Sink: device.state.sink };
        case 'SetAVTransportURI': device.state.uri = args.CurrentURI; return {};
        case 'Play': device.state.transport = 'PLAYING'; return {};
        case 'Stop': device.state.transport = 'STOPPED'; return {};
        case 'GetTransportInfo': return { CurrentTransportState: device.state.transport };
        case 'GetPositionInfo': return { TrackURI: device.state.uri };
        case 'GetMediaInfo': return { CurrentURI: device.state.uri };
        default: throw new Error(`unexpected ${action}`);
      }
    }
  };
  const host = new NetworkOutputHost({
    discovery, castDiscovery, streamServer, upnp,
    createCastSession: options => { const cast = new FakeCast(options, log); casts.push(cast); castHooks.shift()?.(cast); return cast; },
    routeAddress: async () => '192.168.1.5',
    supportsProtocol: (sink, protocol) => sink.split(',').some(entry => entry.split(':')[2] === protocol.split(':')[2]),
    getOwnDeviceIds: () => ['uuid:self'],
    onDiagnostic: (code, detail) => diagnostics.push([code, detail]),
    onStatus: status => statuses.push(status),
    ...clock, clockNow: clock.now
  });
  const states = () => host.getStatus().targets.map(target => [target.id, target.state, target.note]);
  const soaps = (action) => log.filter(entry => entry[0] === 'soap' && (!action || entry[2] === action));
  return { host, clock, log, statuses, diagnostics, discovery, castDiscovery, streams, casts, castHooks, states, soaps };
}

const target = (id, type, name, overrides = {}) => ({ id, type, name, enabled: true, trimMs: 0, ...overrides });

test('disposal publishes no status and never consults the own-device lookup that shutdown has already released', async () => {
  const harness = createHarness();
  const { host, discovery, statuses, diagnostics } = harness;
  discovery.devices.set('uuid:a', upnpDevice('uuid:a', 'living'));
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'living')] });
  const published = statuses.length;
  // closeApplicationServices() releases the OpenHome host before the output host is disposed.
  host.getOwnDeviceIds = () => { throw new TypeError('released'); };
  await host.dispose();
  assert.equal(statuses.length, published, 'nothing receives a status after disposal');
  assert.deepEqual(diagnostics.map(([code]) => code), [], 'a released lookup is not reported as a failure');
  assert.equal(host.disposed, true);
});
const pcm = (frames, value) => ({ type: 'pcm', sampleRate: 44100, channelCount: 2, frames, data: Int16Array.from({ length: frames * 2 }, () => value).buffer });

test('network output configuration rejects malformed values with TypeError', async () => {
  const valid = { enabled: true, localTrimMs: -2000, targets: [target('a', 'upnp', 'A', { trimMs: 2000 })] };
  assert.deepEqual(normalizeConfiguration(valid), { ...valid, localEnabled: true });
  for (const bad of [
    null, [], { ...valid, enabled: 1 }, { ...valid, localEnabled: 0 }, { ...valid, localTrimMs: 2001 }, { ...valid, localTrimMs: 1.5 }, { ...valid, targets: {} },
    { ...valid, targets: [null] }, { ...valid, targets: [target('', 'upnp', 'A')] }, { ...valid, targets: [target('a', 'airplay', 'A')] },
    { ...valid, targets: [target('a', 'upnp', 'A', { trimMs: -1 })] }, { ...valid, targets: [target('a', 'upnp', 'A', { trimMs: 2001 })] },
    { ...valid, targets: [target('a', 'upnp', 'A', { enabled: 'yes' })] }, { ...valid, targets: [target('a', 'upnp', 'A'), target('a', 'cast', 'B')] }
  ]) assert.throws(() => normalizeConfiguration(bad), TypeError);
  // Saved values fall back to the default instead of throwing, reporting the reason once.
  assert.deepEqual(sanitizeConfiguration(valid), { ...valid, localEnabled: true });
  const reported = [];
  assert.equal(sanitizeConfiguration({ ...valid, localTrimMs: 5000 }, (code, error) => reported.push([code, error.message])), DEFAULT_CONFIGURATION);
  assert.equal(sanitizeConfiguration(undefined, (code, error) => reported.push([code, error.message])), DEFAULT_CONFIGURATION, 'a first run has no entry and nothing to report');
  assert.deepEqual(reported, [['network-output-config-invalid', 'Invalid local trim']]);
  const { host } = createHarness();
  await assert.rejects(host.setConfiguration({ enabled: true }), TypeError);
  assert.deepEqual(host.getStatus(), { enabled: false, localEnabled: true, localTrimMs: 0, localDelayMs: 0,
    syncDelayMs: 0, syncRevision: 0, targets: [] });
});

test('opening the picker discovers devices without starting disabled network output', async () => {
  const { host, log } = createHarness();
  await host.setConfiguration({ ...DEFAULT_CONFIGURATION, targets: [target('a', 'cast', 'A')] });
  log.length = 0;
  await host.setPickerOpen(true);
  assert.equal(host.getStatus().enabled, false);
  assert.deepEqual(log.map(([operation]) => operation), ['cast-discovery-start', 'discovery-start']);
  await host.setRendererUnavailable();
  assert.equal(log.at(-1)[0], 'cast-discovery-stop');
});

test('delay line emits silence for the trimmed span and keeps recent history across resizes', () => {
  const line = new DelayLine(2);
  assert.deepEqual([...line.process(Int16Array.of(1, 1, 2, 2, 3, 3))], [0, 0, 0, 0, 1, 1]);
  assert.deepEqual([...line.process(Int16Array.of(4, 4))], [2, 2]);
  line.setDelay(1);
  assert.deepEqual([...line.process(Int16Array.of(5, 5))], [4, 4]);
  line.setDelay(3);
  assert.deepEqual([...line.process(Int16Array.of(6, 6, 7, 7, 8, 8))], [0, 0, 0, 0, 5, 5]);
  const passthrough = new DelayLine(0);
  const input = Int16Array.of(9, 9);
  assert.equal(passthrough.process(input), input);
});

test('delay changes retain history and finish a transition before applying another target', () => {
  const line = new DelayLine(0);
  line.setDelay(0, true);
  line.process(new Int16Array(800 * 2).fill(12000));
  line.setDelay(500, true);
  const first = line.process(new Int16Array(64 * 2));
  assert.ok(first[0] > 0 && first[0] < 100, 'the new tap fades in');
  line.setDelay(100, true);
  assert.equal(line.nextFrames, 100);
  line.process(new Int16Array(192 * 2));
  assert.equal(line.appliedFrames, 500);
  assert.equal(line.nextFrames, 100);
  line.process(new Int16Array(256 * 2));
  assert.equal(line.appliedFrames, 100);
  assert.equal(line.nextFrames, null);
});

test('status merges saved and discovered targets, hides own renderers and reports the local delay', async () => {
  const harness = createHarness();
  const { host, discovery, castDiscovery } = harness;
  discovery.devices.set('uuid:self', upnpDevice('uuid:self', 'EffeTune'));
  discovery.devices.set('uuid:b', upnpDevice('uuid:b', 'bedroom'));
  discovery.devices.set('uuid:noav', { id: 'uuid:noav', name: 'Server', available: true, services: new Map() });
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8009 });
  await host.setConfiguration({ enabled: false, localTrimMs: -500, targets: [target('uuid:gone', 'upnp', 'Attic'), target('cast1', 'cast', 'Old Name', { trimMs: 100 })] });
  const status = host.getStatus();
  assert.equal(status.localDelayMs, 0);
  assert.deepEqual(status.targets.map(entry => [entry.id, entry.name, entry.present, entry.enabled, entry.trimMs, entry.state]), [
    ['uuid:gone', 'Attic', false, true, 0, 'searching'],
    ['uuid:b', 'bedroom', true, false, 0, 'searching'],
    ['cast1', 'Kitchen', true, true, 100, 'searching']
  ]);
  await host.setConfiguration({ enabled: true, localTrimMs: -500, targets: [target('uuid:gone', 'upnp', 'Attic', { enabled: false })] });
  assert.equal(host.getStatus().localDelayMs, 0);
  await host.setConfiguration({ enabled: true, localTrimMs: -500, targets: [target('uuid:gone', 'upnp', 'Attic')] });
  assert.equal(host.getStatus().localDelayMs, 1500);
  await host.setConfiguration({ enabled: true, localTrimMs: -2000, targets: [target('uuid:gone', 'upnp', 'Attic')] });
  assert.equal(host.getStatus().localDelayMs, 0);
  assert.equal(harness.statuses.length, 4);
  await host.dispose();
});

test('UPnP targets stream through SetAVTransportURI and Play, then follow the renderer transport state', async () => {
  const harness = createHarness();
  const { host, discovery, clock, streams, states, soaps } = harness;
  const device = upnpDevice('uuid:b', 'Bedroom');
  discovery.devices.set('uuid:b', device);
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:b', 'upnp', 'Bedroom')] });
  await settle();
  assert.deepEqual(harness.log.filter(entry => entry[0] !== 'soap').slice(0, 3).map(entry => entry[0]).sort(), ['cast-discovery-start', 'discovery-start', 'server-open']);
  assert.deepEqual(soaps().map(entry => entry[2]), ['GetProtocolInfo', 'SetAVTransportURI', 'Play']);
  const setUri = soaps('SetAVTransportURI')[0][3];
  assert.equal(setUri.CurrentURI, 'http://192.168.1.5:9000/live/t1');
  assert.match(setUri.CurrentURIMetaData, /http-get:\*:audio\/flac:DLNA\.ORG_OP=00;DLNA\.ORG_FLAGS=01700000000000000000000000000000/);
  assert.equal(streams[0].contentType, 'audio/flac');
  assert.deepEqual(states(), [['uuid:b', 'connecting', null]]);

  await clock.advance(2000);
  assert.deepEqual(states(), [['uuid:b', 'playing', null]]);
  assert.deepEqual(harness.statuses.at(-1).targets[0].state, 'playing');

  // The renderer stopped our own URI: start over with a fresh stream token.
  device.state.transport = 'STOPPED';
  await clock.advance(2000);
  await settle();
  assert.equal(streams.length, 2);
  assert.equal(streams[0].closed, true);
  assert.equal(soaps('SetAVTransportURI').at(-1)[3].CurrentURI, 'http://192.168.1.5:9000/live/t2');
  await clock.advance(2000);
  assert.deepEqual(states(), [['uuid:b', 'playing', null]]);

  // Someone else took the renderer: report it and stop polling.
  device.state.uri = 'http://192.168.1.77/other.mp3';
  await clock.advance(2000);
  assert.deepEqual(states(), [['uuid:b', 'unreachable', 'taken']]);
  assert.equal(streams[1].closed, true);
  const soapCount = soaps().length;
  await clock.advance(10_000);
  assert.equal(soaps().length, soapCount);

  await host.resync();
  await settle();
  assert.equal(streams.length, 3);
  await host.dispose();
  assert.equal(soaps('Stop').length, 1);
  assert.deepEqual(harness.log.at(-2), ['server-close']);
  assert.deepEqual(harness.log.at(-1), ['cast-discovery-stop']);
});

test('a target taken by another app is not restarted when its device disappears and reappears', async () => {
  const harness = createHarness();
  const { host, discovery, clock, states, soaps } = harness;
  const device = upnpDevice('uuid:b', 'Bedroom');
  discovery.devices.set('uuid:b', device);
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:b', 'upnp', 'Bedroom')] });
  await settle();
  await clock.advance(2000);
  device.state.uri = 'http://192.168.1.77/other.mp3';
  await clock.advance(2000);
  assert.deepEqual(states(), [['uuid:b', 'unreachable', 'taken']]);

  const loads = soaps('SetAVTransportURI').length;
  discovery.devices.delete('uuid:b');
  discovery.emit('change');
  await settle();
  discovery.devices.set('uuid:b', device);
  discovery.emit('change');
  await settle();
  await clock.advance(10_000);
  assert.equal(soaps('SetAVTransportURI').length, loads);
  assert.deepEqual(states(), [['uuid:b', 'unreachable', 'taken']]);
  await host.dispose();
});

test('UPnP renderers without FLAC support or without reachable SOAP are reported and retried appropriately', async () => {
  const harness = createHarness();
  const { host, discovery, clock, states, soaps } = harness;
  const noFlac = upnpDevice('uuid:mp3', 'Radio');
  noFlac.state.sink = 'http-get:*:audio/mpeg:*';
  const flaky = upnpDevice('uuid:flaky', 'Hall');
  discovery.devices.set('uuid:mp3', noFlac);
  discovery.devices.set('uuid:flaky', flaky);
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:mp3', 'upnp', 'Radio'), target('uuid:flaky', 'upnp', 'Hall')] });
  await settle();
  assert.deepEqual(states(), [['uuid:flaky', 'connecting', null], ['uuid:mp3', 'unreachable', 'format']]);
  assert.equal(harness.streams.length, 1);

  flaky.state.fail = true;
  await clock.advance(2000);
  await clock.advance(2000);
  assert.deepEqual(states()[0], ['uuid:flaky', 'connecting', null], 'a failed poll is tolerated until it repeats');
  await clock.advance(2000);
  assert.deepEqual(states()[0], ['uuid:flaky', 'unreachable', 'offline']);
  assert.equal(harness.streams[0].closed, true);
  const before = soaps().length;
  await clock.advance(29_000);
  assert.equal(soaps().length, before);
  flaky.state.fail = false;
  await clock.advance(1000);
  await settle();
  assert.deepEqual(states()[0], ['uuid:flaky', 'connecting', null]);
  assert.equal(harness.streams.length, 2);

  // A renderer that disappears from discovery is offline; it returns on the next discovery change.
  discovery.devices.delete('uuid:flaky');
  discovery.emit('change');
  await settle();
  assert.deepEqual(states()[0], ['uuid:flaky', 'unreachable', 'offline']);
  assert.equal(host.getStatus().targets[0].present, false);
  discovery.devices.set('uuid:flaky', upnpDevice('uuid:flaky', 'Hall'));
  discovery.emit('change');
  await settle();
  assert.deepEqual(states()[0], ['uuid:flaky', 'connecting', null]);
  await host.dispose();
});

test('a UPnP renderer whose GetProtocolInfo returns an empty Sink is streamed as FLAC', async () => {
  const harness = createHarness();
  const { host, discovery, clock, streams, states, soaps } = harness;
  const device = upnpDevice('uuid:plain', 'Plain');
  device.state.sink = '';
  discovery.devices.set('uuid:plain', device);
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:plain', 'upnp', 'Plain')] });
  await settle();
  assert.deepEqual(soaps().map(entry => entry[2]), ['GetProtocolInfo', 'SetAVTransportURI', 'Play']);
  assert.match(soaps('SetAVTransportURI')[0][3].CurrentURIMetaData, /http-get:\*:audio\/flac:/);
  assert.equal(streams[0].contentType, 'audio/flac');
  assert.deepEqual(states(), [['uuid:plain', 'connecting', null]]);
  await clock.advance(2000);
  assert.deepEqual(states(), [['uuid:plain', 'playing', null]]);
  await host.dispose();
});

test('PCM is trimmed per target, overflow backs off only that target and gaps are filled in real time', async () => {
  const harness = createHarness();
  const { host, discovery, clock, streams } = harness;
  discovery.devices.set('uuid:a', upnpDevice('uuid:a', 'A'));
  discovery.devices.set('uuid:b', upnpDevice('uuid:b', 'B'));
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A'), target('uuid:b', 'upnp', 'B', { trimMs: 100 })] });
  await settle();
  const [streamA, streamB] = streams;
  const port = Object.assign(new EventEmitter(), { started: 0, closed: 0, start() { this.started += 1; }, close() { this.closed += 1; } });
  await host.attachRendererPort(port);
  assert.equal(port.started, 1);

  port.emit('message', { data: pcm(2048, 7) });
  port.emit('message', { data: pcm(2048, 7) });
  port.emit('message', { type: 'pcm', sampleRate: 48000, channelCount: 2, frames: 10, data: new ArrayBuffer(40) });
  port.emit('message', { type: 'pcm', sampleRate: 44100, channelCount: 1, frames: 10, data: new ArrayBuffer(20) });
  assert.equal(streamA.writes.length, 2);
  assert.ok(streamA.writes[0].every(value => value === 7));
  const delayed = Int16Array.from([...streamB.writes[0], ...streamB.writes[1]]);
  assert.ok(delayed.subarray(0, 4410 * 2).every(value => value === 0), 'trimmed target starts with 100 ms of silence');
  assert.ok(delayed.subarray(4410 * 2).every(value => value === 7));

  streamB.emit('overflow');
  await settle();
  assert.equal(streamB.closed, true);
  assert.equal(streamA.closed, false);
  assert.equal(streams.length, 3, 'the overloaded target restarts on a fresh stream instead of going offline');
  assert.deepEqual(harness.states().find(entry => entry[0] === 'uuid:b').slice(1), ['connecting', null]);
  assert.equal(harness.diagnostics.some(([code]) => code === 'network-output-stream-overflow'), true);

  // A second renderer port replaces the first; the first is closed.
  const replacement = Object.assign(new EventEmitter(), { start() {}, close() { this.closed = true; } });
  await host.attachRendererPort(replacement);
  assert.equal(port.closed, 1);
  port.emit('message', { data: pcm(2048, 1) });
  assert.equal(streamA.writes.length, 2, 'messages from a detached port are ignored');

  // When the renderer goes quiet, the host keeps the streams clocked with silence.
  const writesBefore = streamA.writes.length;
  await clock.advance(250 + 40);
  const silence = streamA.writes.slice(writesBefore);
  assert.ok(silence.length >= 1);
  assert.ok(silence.at(-1).every(value => value === 0));
  const frames = silence.reduce((sum, chunk) => sum + chunk.length / 2, 0);
  assert.ok(frames >= Math.floor(20 * 44.1) && frames <= Math.ceil(40 * 44.1) + 1, `silence frames ${frames}`);
  replacement.emit('message', { data: pcm(2048, 3) });
  const afterPcm = streamA.writes.length;
  await clock.advance(200);
  assert.equal(streamA.writes.length, afterPcm, 'silence fill pauses once PCM resumes');

  await host.setRendererUnavailable();
  assert.equal(replacement.closed, true);
  await clock.advance(300);
  assert.ok(streamA.writes.length > afterPcm, 'silence keeps flowing without a renderer');
  await host.dispose();
});

test('late source frames already replaced by silence are discarded and a new epoch rebases', async () => {
  const { host, discovery, clock, streams } = createHarness();
  discovery.devices.set('uuid:a', upnpDevice('uuid:a', 'A'));
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A')] });
  await settle();
  const port = Object.assign(new EventEmitter(), { start() {}, close() {} });
  await host.attachRendererPort(port);
  const send = (epoch, frame, count, value) => port.emit('message', { data: { ...pcm(count, value), sourceEpoch: epoch, sourceFrame: frame } });
  send(1, 0, 2048, 1000);
  await clock.advance(290);
  const afterSilence = streams[0].writes.length;
  send(1, 2048, 512, 2000);
  assert.equal(streams[0].writes.length, afterSilence, 'the late block is already covered by silence');
  send(2, 0, 2048, 3000);
  assert.equal(streams[0].writes.length, afterSilence + 1);
  assert.equal(streams[0].writes.at(-1).at(-1), 3000);
  send(1, 4096, 2048, 4000);
  assert.equal(streams[0].writes.length, afterSilence + 1, 'old epoch is ignored');
  await host.dispose();
});

test('indexed packets are acknowledged on their owning port and resume fades span short suffixes', async () => {
  const { host, discovery, clock, streams } = createHarness();
  discovery.devices.set('uuid:a', upnpDevice('uuid:a', 'A'));
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A')] });
  await settle();
  const acks = [];
  const port = Object.assign(new EventEmitter(), { start() {}, close() {}, postMessage(message) { acks.push(message); } });
  await host.attachRendererPort(port);
  const send = (epoch, frame, count) => port.emit('message', { data: { ...pcm(count, 12800), sourceEpoch: epoch, sourceFrame: frame } });
  send(1, 0, 2048);
  await clock.advance(290);
  const partialStart = host.sourceNextFrame - 32;
  send(1, partialStart, 64);
  const partial = streams[0].writes.at(-1);
  assert.equal(partial.length, 64);
  assert.equal(partial[0], 100);
  assert.equal(partial.at(-1), 3200);
  send(1, partialStart + 64, 128);
  const next = streams[0].writes.at(-1);
  assert.equal(next[0], 3300);
  assert.equal(next[190], 12800);
  send(0, 0, 16);
  assert.deepEqual(acks.map(({ sourceEpoch, sourceFrame }) => [sourceEpoch, sourceFrame]),
    [[1, 0], [1, partialStart], [1, partialStart + 64], [0, 0]]);
  const replacement = Object.assign(new EventEmitter(), { start() {}, close() {}, postMessage() {} });
  await host.attachRendererPort(replacement);
  send(1, 2048, 16);
  assert.equal(acks.length, 4, 'the detached port receives no acknowledgment');
  await host.dispose();
});

test('a new epoch crossfades from the previous tail before silence starts', async () => {
  const { host, discovery, streams } = createHarness();
  discovery.devices.set('uuid:a', upnpDevice('uuid:a', 'A'));
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A')] });
  await settle();
  const acks = [];
  const port = Object.assign(new EventEmitter(), { start() {}, close() {}, postMessage(message) { acks.push(message); } });
  await host.attachRendererPort(port);
  host.packetSourceTiming = () => ({ firstFrameTimeMs: 0, frameDurationMs: 1 / 44.1, revision: 1, uncertaintyMs: 0 });
  const send = (epoch, frame, frames, value) => port.emit('message', { data: { ...pcm(frames, value), sourceEpoch: epoch, sourceFrame: frame } });
  send(1, 0, 256, 1000);
  assert.equal(streams[0].writes.at(-1)[0], 1000, 'the initial epoch is unchanged');
  send(2, 0, 64, 13800);
  const first = streams[0].writes.at(-1);
  assert.equal(first[0], 1100);
  assert.equal(first.at(-1), 7400);
  send(1, 256, 64, -10000);
  assert.equal(streams[0].writes.at(-1), first, 'late old-epoch PCM is not emitted');
  send(2, 64, 64, 13800);
  assert.equal(streams[0].writes.at(-1)[0], 7500);
  assert.equal(streams[0].writes.at(-1).at(-1), 13800);
  assert.equal(host.packetTiming.length, 1, 'crossfaded packets do not claim a unique source time');
  assert.deepEqual(acks.map(({ sourceEpoch, sourceFrame }) => [sourceEpoch, sourceFrame]), [[1, 0], [2, 0], [1, 256], [2, 64]]);
  await host.dispose();
});

test('paced input after a frozen source clock eventually resumes in the same epoch', async () => {
  const { host, discovery, clock, streams } = createHarness();
  discovery.devices.set('uuid:a', upnpDevice('uuid:a', 'A'));
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A')] });
  await settle();
  const port = Object.assign(new EventEmitter(), { start() {}, close() {} });
  await host.attachRendererPort(port);
  const send = frame => port.emit('message', { data: { ...pcm(882, 1000), sourceEpoch: 1, sourceFrame: frame } });
  send(0);
  await clock.advance(1250);
  const before = streams[0].writes.length;
  for (let index = 1; index <= 16; index++) {
    send(index * 882);
    await clock.advance(20);
  }
  assert.ok(streams[0].writes.slice(before).some(chunk => chunk.at(-1) === 1000));
  await host.dispose();
});

test('suspend tears sessions down with Stop and resume reconnects; a failed server start marks every target', async () => {
  const harness = createHarness();
  const { host, discovery, states, soaps, streams } = harness;
  discovery.devices.set('uuid:a', upnpDevice('uuid:a', 'A'));
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A')] });
  await settle();
  await host.setEnvironmentAvailable(false);
  await settle();
  assert.equal(soaps('Stop').length, 1);
  assert.equal(streams[0].closed, true);
  assert.deepEqual(states(), [['uuid:a', 'searching', null]]);
  assert.deepEqual(harness.log.filter(entry => entry[0] === 'server-close'), [['server-close']]);
  await host.setEnvironmentAvailable(true);
  await settle();
  assert.equal(streams.length, 2);
  assert.deepEqual(states(), [['uuid:a', 'connecting', null]]);
  await host.setConfiguration({ enabled: false, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A')] });
  await settle();
  assert.equal(soaps('Stop').length, 2);
  assert.deepEqual(harness.log.filter(entry => entry[0] !== 'soap').slice(-2), [['cast-discovery-stop'], ['server-close']]);
  await host.dispose();

  const failing = createHarness({ openFails: true });
  failing.discovery.devices.set('uuid:a', upnpDevice('uuid:a', 'A'));
  await failing.host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A'), target('cast1', 'cast', 'Kitchen')] });
  assert.deepEqual(failing.states(), [['uuid:a', 'unreachable', 'startFailed'], ['cast1', 'unreachable', 'startFailed']]);
  assert.equal(failing.diagnostics[0][0], 'network-output-server-failed');
  await failing.host.dispose();
});

test('Cast targets launch the default receiver, follow only their own media session and back off after repeated drops', async () => {
  const harness = createHarness();
  const { host, castDiscovery, clock, casts, streams, states, diagnostics } = harness;
  const loadedUrl = () => harness.log.filter(entry => entry[0] === 'cast-load').at(-1)[1].url;
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8010 });
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('cast1', 'cast', 'Kitchen')] });
  await settle();
  assert.equal(casts.length, 1);
  assert.deepEqual(harness.log.filter(entry => entry[0].startsWith('cast-')).slice(1), [
    ['cast-connect', '192.168.1.40', 8010],
    ['cast-load', { url: 'http://192.168.1.5:9000/live/t1', contentType: 'audio/wav' }]
  ]);
  assert.deepEqual(states(), [['cast1', 'connecting', null]]);
  casts[0].emit('receiver', { appId: 'CC1AD845', sessionId: 's1' });
  // The previous item ending and our item being created idle are part of a normal load, not drops.
  casts[0].emit('media', { playerState: 'IDLE', idleReason: 'ERROR', mediaSessionId: 7, contentId: 'http://192.168.1.5:9000/live/old' });
  casts[0].emit('media', { playerState: 'IDLE', idleReason: null, mediaSessionId: 1, contentId: loadedUrl() });
  casts[0].emit('media', { playerState: 'IDLE', idleReason: 'INTERRUPTED', mediaSessionId: 7, contentId: null });
  await settle();
  assert.equal(casts.length, 1);
  assert.deepEqual(states(), [['cast1', 'connecting', null]]);
  casts[0].emit('media', { playerState: 'BUFFERING', idleReason: null, mediaSessionId: 1, contentId: null });
  assert.deepEqual(states(), [['cast1', 'connecting', null]], 'BUFFERING is not observed playback');
  casts[0].emit('media', { playerState: 'PLAYING', idleReason: null, mediaSessionId: 1, contentId: null });
  assert.deepEqual(states(), [['cast1', 'playing', null]]);
  casts[0].emit('receiver', { appId: 'CC1AD845', sessionId: 's1' });
  await clock.advance(15_000);
  assert.deepEqual(states(), [['cast1', 'playing', null]]);
  assert.equal(casts.length, 1, 'a playing target has no start timeout');
  casts[0].emit('receiver', { appId: 'E8C28D3C', sessionId: 's2' });
  await settle();
  assert.deepEqual(states(), [['cast1', 'unreachable', 'taken']]);
  assert.equal(casts[0].closed, true);
  assert.equal(streams[0].closed, true);

  await host.resync();
  await settle();
  assert.equal(casts.length, 2);
  casts[1].emit('media', { playerState: 'IDLE', idleReason: 'FINISHED', mediaSessionId: 2, contentId: loadedUrl() });
  await settle();
  assert.equal(casts.length, 3, 'an ended media session restarts the target');
  assert.deepEqual(diagnostics.at(-1).map(entry => entry instanceof Error ? entry.message : entry), ['network-output-cast-failed', 'Cast playback ended (FINISHED)']);
  casts[2].emit('close'); await settle();
  assert.equal(casts.length, 4);
  casts[3].emit('error', new Error('socket reset'));
  await settle();
  assert.deepEqual(states(), [['cast1', 'unreachable', null]]);
  assert.equal(casts.length, 4);
  await clock.advance(30_000);
  await settle();
  assert.equal(casts.length, 5, 'offline targets retry after 30 s');
  assert.deepEqual(states(), [['cast1', 'connecting', null]]);
  await clock.advance(15_000);
  assert.equal(casts.length, 6, 'a load that never reaches playback is retried after the start timeout');
  assert.deepEqual(diagnostics.at(-1).map(entry => entry instanceof Error ? entry.message : entry), ['network-output-cast-failed', 'Cast playback did not start']);
  await host.dispose();
  assert.deepEqual(harness.log.slice(-4), [['cast-stop'], ['cast-close'], ['server-close'], ['cast-discovery-stop']]);
});

test('a Cast receiver that keeps closing its stream goes offline after repeated drops and retries after 30 s', async () => {
  const harness = createHarness();
  const { host, castDiscovery, clock, casts, streams, states, diagnostics } = harness;
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8010 });
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('cast1', 'cast', 'Kitchen')] });
  await settle();
  assert.equal(casts.length, 1);
  streams.at(-1).emit('disconnected');
  await settle();
  assert.equal(casts.length, 2, 'the first drop restarts the target');
  streams.at(-1).emit('disconnected');
  await settle();
  assert.equal(casts.length, 3, 'the second drop restarts the target');
  streams.at(-1).emit('disconnected');
  await settle();
  assert.deepEqual(states(), [['cast1', 'unreachable', null]]);
  assert.equal(casts.length, 3, 'the third drop stops reloading');
  const failed = diagnostics.filter(([code]) => code === 'network-output-cast-failed');
  assert.equal(failed.length, 3);
  assert.ok(failed.every(([, error]) => error.message === 'Receiver closed the stream'));
  await clock.advance(29_000);
  assert.equal(casts.length, 3);
  await clock.advance(1000);
  await settle();
  assert.equal(casts.length, 4, 'the target retries after 30 s');
  await host.dispose();
});

test('a Cast receiver that buffers and then errors on every load still goes offline after repeated drops', async () => {
  const harness = createHarness();
  const { host, castDiscovery, casts, states } = harness;
  const loadedUrl = () => harness.log.filter(entry => entry[0] === 'cast-load').at(-1)[1].url;
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8010 });
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('cast1', 'cast', 'Kitchen')] });
  await settle();
  for (let i = 1; i <= 3; i += 1) {
    assert.equal(casts.length, i);
    const cast = casts.at(-1);
    cast.emit('media', { playerState: 'BUFFERING', idleReason: null, mediaSessionId: i, contentId: loadedUrl() });
    cast.emit('media', { playerState: 'IDLE', idleReason: 'ERROR', mediaSessionId: i, contentId: null });
    await settle();
  }
  assert.deepEqual(states(), [['cast1', 'unreachable', null]]);
  assert.equal(casts.length, 3, 'BUFFERING does not reset the drop count');
  await host.dispose();
});

test('a Cast receiver whose application keeps ending before playback becomes unreachable instead of reloading forever', async () => {
  const harness = createHarness();
  const { host, castDiscovery, casts, states } = harness;
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8010 });
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('cast1', 'cast', 'Kitchen')] });
  await settle();
  for (let i = 1; i <= 3; i += 1) {
    assert.equal(casts.length, i);
    casts.at(-1).emit('receiver', { appId: 'CC1AD845', sessionId: 's1' });
    casts.at(-1).emit('receiver', {});
    await settle();
  }
  assert.deepEqual(states(), [['cast1', 'unreachable', null]]);
  assert.equal(casts.length, 3, 'an ended receiver application counts as a drop');
  await host.dispose();
});

test('a UPnP renderer survives a single failed poll and goes offline after repeated poll failures', async () => {
  const harness = createHarness();
  const { host, discovery, clock, states, soaps } = harness;
  const device = upnpDevice('uuid:p', 'Study');
  discovery.devices.set('uuid:p', device);
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:p', 'upnp', 'Study')] });
  await settle();
  await clock.advance(2000);
  assert.deepEqual(states(), [['uuid:p', 'playing', null]]);
  const loads = soaps('SetAVTransportURI').length;
  device.state.failActions = ['GetTransportInfo'];
  await clock.advance(2000); await settle();
  device.state.failActions = [];
  await clock.advance(2000); await settle();
  assert.deepEqual(states(), [['uuid:p', 'playing', null]], 'a single failed poll is tolerated');
  assert.equal(soaps('SetAVTransportURI').length, loads);
  device.state.failActions = ['GetTransportInfo'];
  await clock.advance(2000); await settle();
  await clock.advance(2000); await settle();
  assert.deepEqual(states(), [['uuid:p', 'playing', null]], 'two failures are not enough');
  await clock.advance(2000); await settle();
  assert.deepEqual(states(), [['uuid:p', 'unreachable', 'offline']]);
  assert.equal(soaps('SetAVTransportURI').length, loads);
  await host.dispose();
});

test('a UPnP renderer keeps its stream across closed connections and goes offline after repeated stops of its own URI', async () => {
  const harness = createHarness();
  const { host, discovery, clock, streams, states, soaps, diagnostics } = harness;
  const device = upnpDevice('uuid:b', 'Bedroom');
  discovery.devices.set('uuid:b', device);
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:b', 'upnp', 'Bedroom')] });
  await settle();
  // A probing GET that closes must not invalidate the URL the renderer is about to fetch again.
  streams[0].emit('disconnected');
  await settle();
  assert.equal(streams.length, 1);
  assert.equal(streams[0].closed, false);
  assert.equal(soaps('SetAVTransportURI').length, 1);
  assert.deepEqual(states(), [['uuid:b', 'connecting', null]]);

  const stop = async () => { device.state.transport = 'STOPPED'; await clock.advance(2000); await settle(); };
  await stop();
  await stop();
  await clock.advance(2000);
  assert.deepEqual(states(), [['uuid:b', 'playing', null]], 'observed playback clears the earlier drops');
  await stop();
  await stop();
  assert.deepEqual(states(), [['uuid:b', 'connecting', null]]);
  await stop();
  assert.deepEqual(states(), [['uuid:b', 'unreachable', null]]);
  assert.equal(diagnostics.filter(([code]) => code === 'network-output-upnp-failed').length, 5);
  const loads = soaps('SetAVTransportURI').length;
  await clock.advance(29_000);
  assert.equal(soaps('SetAVTransportURI').length, loads, 'an offline renderer is not reloaded');
  await clock.advance(1000);
  await settle();
  assert.equal(soaps('SetAVTransportURI').length, loads + 1, 'the target retries after 30 s');
  await host.dispose();
});

test('a host without injected callbacks offers every renderer, stays quiet and builds real Cast sessions', async () => {
  const discovery = Object.assign(new EventEmitter(), { devices: new Map(), start: async () => { throw new Error('ssdp down'); } });
  discovery.devices.set('uuid:self', upnpDevice('uuid:self', 'EffeTune'));
  const castDiscovery = Object.assign(new EventEmitter(), { devices: new Map(), start() {}, stop() {} });
  const streamServer = { open: async () => {}, close: async () => {}, createStream() { throw new Error('not expected'); } };
  const host = new NetworkOutputHost({ discovery, castDiscovery, streamServer, upnp: { service: (device, type) => device?.services?.get(type) ?? null } });
  assert.deepEqual(host.getStatus().targets.map(entry => entry.id), ['uuid:self'], 'without an own-id provider nothing is hidden');
  const status = await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [] });
  await settle();
  assert.equal(status.enabled, true, 'a failing discovery start is absorbed by the default diagnostic sink');
  castDiscovery.emit('change');
  const cast = host.createCastSession({ host: '192.168.1.40', port: 8010, onDiagnostic: host.onDiagnostic });
  assert.ok(cast instanceof CastSession);
  assert.equal(cast.host, '192.168.1.40');
  assert.equal(cast.port, 8010);
  assert.equal(cast.socket, null, 'creating a session does not open a connection');
  await host.dispose();
});

test('discovery failures and a throwing operation are reported, a closed renderer port is dropped', async () => {
  const harness = createHarness();
  const { host, discovery, castDiscovery, streams, diagnostics, states } = harness;
  discovery.devices.set('uuid:a', upnpDevice('uuid:a', 'A'));
  discovery.start = () => Promise.reject(new Error('ssdp down'));
  castDiscovery.start = () => { throw new Error('mdns down'); };
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A')] });
  await settle();
  assert.deepEqual(diagnostics.map(([code, error]) => [code, error.message]), [['network-output-operation-failed', 'mdns down']]);
  assert.deepEqual(states(), [['uuid:a', 'searching', null]]);
  castDiscovery.start = () => {};
  await host.resync();
  await settle();
  assert.deepEqual(diagnostics.map(([code, error]) => [code, error.message]), [['network-output-operation-failed', 'mdns down'], ['network-output-discovery-failed', 'ssdp down']]);
  assert.deepEqual(states(), [['uuid:a', 'connecting', null]], 'the host keeps operating after the failed operation');
  assert.equal(streams.length, 1);

  const port = Object.assign(new EventEmitter(), { closed: 0, start() {}, close() { this.closed += 1; } });
  await host.attachRendererPort(port);
  port.emit('message', { data: pcm(100, 5) });
  assert.equal(streams[0].writes.length, 1);
  port.emit('close');
  await settle();
  assert.equal(port.closed, 1);
  port.emit('message', { data: pcm(100, 5) });
  assert.equal(streams[0].writes.length, 1, 'a port that closed itself no longer feeds audio');

  await host.setConfiguration({ enabled: false, localTrimMs: 0, targets: [] });
  const published = harness.statuses.length;
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8009 });
  castDiscovery.emit('change');
  assert.equal(harness.statuses.length, published + 1, 'discovery changes are published even while disabled');
  assert.deepEqual(harness.statuses.at(-1).targets.map(entry => entry.id), ['uuid:a', 'cast1']);
  await host.dispose();
});

test('teardown reports failing Stop requests, start failures are classified per transport and protocol info is optional', async () => {
  const harness = createHarness();
  const { host, discovery, castDiscovery, casts, castHooks, diagnostics, soaps, states, clock } = harness;
  const device = upnpDevice('uuid:a', 'A');
  device.state.failActions = ['GetProtocolInfo'];
  discovery.devices.set('uuid:a', device);
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8009 });
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A'), target('cast1', 'cast', 'Kitchen')] });
  await settle();
  assert.deepEqual(soaps().map(entry => entry[2]), ['GetProtocolInfo', 'SetAVTransportURI', 'Play']);
  assert.match(soaps('SetAVTransportURI')[0][3].CurrentURIMetaData, /http-get:\*:audio\/flac:/, 'FLAC is assumed when the renderer cannot describe its sinks');
  assert.deepEqual(states(), [['uuid:a', 'connecting', null], ['cast1', 'connecting', null]]);

  device.state.failActions = ['Stop'];
  casts[0].stop = async () => { throw new Error('cast stop failed'); };
  await host.setEnvironmentAvailable(false);
  await settle();
  const reported = () => diagnostics.map(([code, error]) => [code, error.message]).sort();
  assert.deepEqual(reported(), [['network-output-cast-failed', 'cast stop failed'], ['network-output-upnp-failed', 'Stop failed']]);
  assert.equal(casts[0].closed, true, 'the Cast connection is closed even when STOP fails');
  assert.deepEqual(states(), [['uuid:a', 'searching', null], ['cast1', 'searching', null]]);
  casts[0].emit('error', new Error('late socket error'));
  assert.equal(diagnostics.length, 2, 'errors from a torn-down Cast session are ignored');

  device.state.failActions = ['SetAVTransportURI'];
  castHooks.push(cast => { cast.connect = async () => { throw new Error('connection refused'); }; });
  await host.setEnvironmentAvailable(true);
  await settle();
  assert.deepEqual(reported(), [['network-output-cast-failed', 'cast stop failed'], ['network-output-cast-failed', 'connection refused'], ['network-output-upnp-failed', 'SetAVTransportURI failed'], ['network-output-upnp-failed', 'Stop failed']]);
  assert.deepEqual(states(), [['uuid:a', 'unreachable', 'offline'], ['cast1', 'connecting', null]], 'a refused Cast connection is retried at once, a UPnP failure waits');
  assert.equal(casts.length, 3);

  device.state.failActions = [];
  await host.resync();
  await settle();
  assert.deepEqual(states()[0], ['uuid:a', 'connecting', null]);
  device.state.transport = 'STOPPED';
  device.state.uri = 'http://192.168.1.77/other.mp3';
  await clock.advance(2000);
  assert.deepEqual(states()[0], ['uuid:a', 'unreachable', 'taken'], 'a stopped renderer holding a foreign URI was taken over');
  await host.dispose();
});

test('a stopped renderer reporting an empty URI is resumed, not treated as taken over', async () => {
  const { host, discovery, clock, soaps, states } = createHarness();
  const device = upnpDevice('uuid:a', 'A');
  discovery.devices.set('uuid:a', device);
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:a', 'upnp', 'A')] });
  await settle();
  const loads = soaps('SetAVTransportURI').length;
  device.state.transport = 'NO_MEDIA_PRESENT';
  device.state.uri = '';
  await clock.advance(2000);
  await settle();
  assert.notEqual(states()[0][2], 'taken');
  assert.equal(soaps('SetAVTransportURI').length, loads + 1, 'the same stream is loaded again');
  await host.dispose();
});

test('resync publishes a new revision even when the common delay and target states stay the same', async () => {
  const { host, statuses } = createHarness();
  const before = await host.setConfiguration({
    enabled: true, localEnabled: false, localTrimMs: 300, targets: [target('uuid:missing', 'upnp', 'Bedroom')]
  });
  assert.equal(before.syncDelayMs, L0_MS);
  assert.equal(before.localDelayMs, L0_MS + 300);
  const published = statuses.length;
  const after = await host.resync();
  assert.deepEqual(after, { ...before, syncRevision: before.syncRevision + 1 });
  assert.equal(statuses.length, published + 1);
  assert.equal(statuses.at(-1).syncRevision, after.syncRevision);
  await host.dispose();
});

test('cast latency measured from the receiver position raises the local delay and cancels it on the sender', async () => {
  const harness = createHarness();
  const { host, discovery, castDiscovery, clock, casts, log } = harness;
  const framesFor = ms => Math.round(ms * SAMPLE_RATE / 1000);
  discovery.devices.set('uuid:b', upnpDevice('uuid:b', 'Bedroom'));
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8010 });
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('uuid:b', 'upnp', 'Bedroom'), target('cast1', 'cast', 'Kitchen')] });
  await settle();
  const castSession = host.sessions.get('cast1');
  const upnpSession = host.sessions.get('uuid:b');
  casts[0].emit('media', { playerState: 'PLAYING', idleReason: null, mediaSessionId: 1, contentId: castSession.url });
  assert.equal(host.getStatus().localDelayMs, L0_MS, 'nothing is measured yet');
  assert.equal(castSession.delay.frames, 0);
  assert.equal(upnpSession.delay.frames, 0);

  const poll = async (frames, currentTime, polls = LATENCY_SAMPLES) => {
    castSession.stream.frames = frames;
    casts[0].status = { playerState: 'PLAYING', currentTime };
    await clock.advance(polls * CAST_POLL_MS);
  };
  await poll(44100 * 6, 1.5, LATENCY_SAMPLES - 1);
  assert.equal(host.getStatus().syncDelayMs, L0_MS, 'the estimate needs a complete sample window');
  await poll(44100 * 6, 1.42, 1);
  assert.deepEqual(log.filter(entry => entry[0] === 'cast-status').at(-1), ['cast-status', 1]);
  assert.equal(host.getStatus().localDelayMs, 4500, 'a stale position reads late, so the smallest reading of the window counts');
  assert.equal(host.getStatus().syncDelayMs, 4500);
  assert.equal(castSession.delay.frames, 0);
  assert.equal(upnpSession.delay.frames, framesFor(2500));

  await poll(44100 * 6, 1.51);
  assert.equal(host.getStatus().localDelayMs, 4500, 'a change under 20 ms is ignored');
  await poll(44100 * 6, 1.0);
  assert.equal(host.getStatus().localDelayMs, 5000);
  assert.equal(upnpSession.delay.frames, framesFor(3000));

  const loadsBefore = log.filter(entry => entry[0] === 'cast-load').length;
  await poll(44100 * 20, 5, 1);
  await settle();
  assert.equal(log.filter(entry => entry[0] === 'cast-load').length, loadsBefore, 'one outlier does not restart playback');
  await poll(44100 * 20, 5, 7);
  await settle();
  assert.equal(log.filter(entry => entry[0] === 'cast-load').length, loadsBefore + 1, 'two seconds of over-limit observations restart the receiver');
  assert.equal(host.getStatus().localDelayMs, L0_MS, 'the measurement is forgotten with the session');
  assert.equal(host.sessions.get('uuid:b').delay.frames, 0);
  assert.equal(harness.diagnostics.at(-1)[1].message, 'Cast playback is 15000 ms behind');

  await host.setConfiguration({ enabled: false, localTrimMs: 0, targets: [] });
  assert.equal(host.getStatus().localDelayMs, 0);
  await host.dispose();
});

test('Cast stalls reported as PLAYING reach the drop limit instead of restarting forever', async () => {
  const { host, castDiscovery, clock, casts, log, states } = createHarness();
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8010 });
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('cast1', 'cast', 'Kitchen')] });
  await settle();
  const session = host.sessions.get('cast1');
  const stall = async () => {
    const cast = casts.at(-1);
    cast.emit('media', { playerState: 'PLAYING', idleReason: null, mediaSessionId: 1, contentId: session.url });
    session.stream.frames = 44100 * 20;
    cast.status = { playerState: 'PLAYING', currentTime: 5 };
    await clock.advance(8 * CAST_POLL_MS);
    await settle();
  };
  const loads = () => log.filter(entry => entry[0] === 'cast-load').length;
  const loadsBefore = loads();
  await stall();
  assert.equal(loads(), loadsBefore + 1, 'a single stall restarts the receiver');
  await stall();
  assert.equal(loads(), loadsBefore + 2);
  await stall();
  assert.equal(loads(), loadsBefore + 2, 'the third stall gives up instead of restarting');
  assert.deepEqual(states().find(state => state[0] === 'cast1'), ['cast1', 'unreachable', null]);
  await host.dispose();
});

test('Cast position from an earlier HTTP connection is ignored', async () => {
  const { host, castDiscovery, casts } = createHarness();
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8010 });
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('cast1', 'cast', 'Kitchen')] });
  await settle();
  const session = host.sessions.get('cast1');
  casts[0].emit('media', { playerState: 'PLAYING', mediaSessionId: 1, contentId: session.url });
  session.stream.connection = {};
  session.stream.frames = 44100 * 5;
  let resolveStatus;
  casts[0].mediaStatus = () => new Promise(resolve => { resolveStatus = resolve; });
  const poll = host.pollCast(session);
  session.stream.connection = {};
  resolveStatus({ playerState: 'PLAYING', currentTime: 2 });
  await poll;
  assert.deepEqual(session.latencySamples, []);
  await host.dispose();
});

test('Cast poll accepts a matching media event emitted before its status reply', async () => {
  const { host, castDiscovery, casts } = createHarness();
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8010 });
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('cast1', 'cast', 'Kitchen')] });
  await settle();
  const session = host.sessions.get('cast1');
  const event = { playerState: 'PLAYING', mediaSessionId: 1, contentId: session.url };
  casts[0].emit('media', event);
  session.stream.frames = 44100 * 5;
  casts[0].mediaStatus = async () => { casts[0].emit('media', event); return { playerState: 'PLAYING', currentTime: 2 }; };
  for (let index = 0; index < LATENCY_SAMPLES; index++) await host.pollCast(session);
  assert.equal(session.latencyMs, 3000);
  casts[0].mediaStatus = async () => {
    casts[0].emit('media', { ...event, playerState: 'BUFFERING' });
    return { playerState: 'PLAYING', currentTime: 2 };
  };
  const samples = session.latencySamples.length;
  await host.pollCast(session);
  assert.equal(session.latencySamples.length, samples);
  await host.dispose();
});

test('expired Cast measurements return legacy delay to its default', async () => {
  const { host, castDiscovery, clock } = createHarness();
  castDiscovery.devices.set('cast1', { id: 'cast1', name: 'Kitchen', address: '192.168.1.40', port: 8010 });
  await host.setConfiguration({ enabled: true, localTrimMs: 0, targets: [target('cast1', 'cast', 'Kitchen')] });
  await settle();
  const session = host.sessions.get('cast1');
  for (let index = 0; index < LATENCY_SAMPLES; index++) host.recordLatency(session, 4500);
  assert.equal(host.getStatus().syncDelayMs, 4500);
  await clock.advance(FEEDBACK_FRESHNESS_MS + 1);
  assert.equal(host.getStatus().syncDelayMs, L0_MS);
  await host.dispose();
});

test('without a send tap the local delay is shortened by the output device latency', async () => {
  const { host, discovery } = createHarness();
  discovery.devices.set('uuid:b', upnpDevice('uuid:b', 'Bedroom'));
  await host.setConfiguration({ enabled: true, localTrimMs: 30, targets: [target('uuid:b', 'upnp', 'Bedroom')] });
  await settle();
  assert.equal(host.getStatus().localDelayMs, L0_MS + 30);
  host.updateRoute({ active: false, physicalOutputMs: 56.4 });
  assert.equal(host.getStatus().localDelayMs, L0_MS + 30 - 56);
  assert.equal(host.getStatus().syncDelayMs, L0_MS);
  host.updateRoute({ active: false, physicalOutputMs: 70 });
  assert.equal(host.getStatus().localDelayMs, L0_MS + 30 - 56, 'a change under 20 ms is ignored');
  host.updateRoute({ active: false, physicalOutputMs: null });
  assert.equal(host.getStatus().localDelayMs, L0_MS + 30);
  await host.dispose();
});

test('marker routes align measured suffixes and trim, then fall back when feedback expires', async () => {
  const { host, discovery, clock, streams } = createHarness();
  discovery.devices.set('uuid:b', upnpDevice('uuid:b', 'Bedroom'));
  const config = { enabled: true, localEnabled: true, localTrimMs: -100,
    targets: [target('uuid:b', 'upnp', 'Bedroom', { trimMs: 50 })] };
  await host.setConfiguration(config);
  await settle();
  const route = { active: true, revision: 7, localReachable: true, dspMs: 250, softwareOutputMs: 30, physicalOutputMs: 20,
    contextFrame: 0, frameTimeMs: clock.now(), clockUncertaintyMs: 15 };
  host.updateRoute(route);
  assert.equal(host.getStatus().localDelayMs, 1600);
  assert.equal(host.getStatus().targets[0].syncState, 'unmeasured');

  const sample = { connectionId: 'abc', revision: 4, routeRevision: 7, receivedAt: clock.now(), uncertaintyMs: 30,
    ingressMs: 20, transportMs: 130, dspMs: 200, softwareOutputMs: 20, physicalOutputMs: 10 };
  streams[0].emit('feedback', sample);
  assert.equal(host.getStatus().localDelayMs, 0, 'negative trim raises the feasible common target');
  assert.equal(host.sessions.get('uuid:b').delay.frames, 3087, '70 ms includes the target trim');
  assert.equal(host.getStatus().networkTiming.measured, false, 'transition samples have no unique arrival time');
  host.handlePortMessage(pcm(2048, 100));
  assert.deepEqual(host.getStatus().networkTiming, { measured: true, arrivalMs: 450, revision: 7 });

  await host.setConfiguration({ ...config, localEnabled: false });
  host.handlePortMessage(pcm(2048, 100));
  assert.deepEqual(host.getStatus().networkTiming, { measured: true, arrivalMs: 430, revision: 7 });

  await host.setConfiguration(config);
  streams[0].emit('feedback', { ...sample, revision: 5, dspMs: 9500 });
  assert.equal(host.getStatus().localDelayMs, 8000);
  assert.equal(host.getStatus().targets[0].syncState, 'limited');
  await clock.advance(3001);
  assert.equal(host.getStatus().localDelayMs, 1600);
  assert.equal(host.getStatus().networkTiming.measured, false);
  assert.equal(host.getStatus().targets[0].syncState, 'unmeasured');
  await host.dispose();
});
