const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');

const {
  DNS_LOOKUP_TIMEOUT_MS,
  OpenHomeMediaGateway,
  normalizeMediaUri
} = require('../../electron/openhome-media-gateway.cjs');

function createServerFactory() {
  return handler => {
    const server = new EventEmitter();
    server.listening = false;
    server.listenOptions = null;
    server.listen = options => {
      server.listenOptions = options;
      server.listening = true;
      queueMicrotask(() => server.emit('listening'));
    };
    server.address = () => ({ address: '127.0.0.1', port: 43123 });
    server.close = callback => {
      server.listening = false;
      callback?.();
    };
    server.handle = handler;
    return server;
  };
}

function createClientResponse() {
  const response = new PassThrough();
  response.statusCode = 0;
  response.headers = new Map();
  response.headersSent = false;
  response.setHeader = (name, value) => response.headers.set(String(name).toLowerCase(), value);
  const originalEnd = response.end.bind(response);
  response.end = (...args) => {
    response.headersSent = true;
    return originalEnd(...args);
  };
  return response;
}

function bodyOf(response) {
  const chunks = [];
  response.on('data', chunk => chunks.push(Buffer.from(chunk)));
  return () => Buffer.concat(chunks).toString('utf8');
}

function createRequestImpl(responses, calls) {
  return (target, options, callback) => {
    const call = { target: target.href, options, request: null, response: null };
    calls.push(call);
    const request = new EventEmitter();
    request.destroyed = false;
    request.setTimeout = (_timeout, handler) => { request.timeoutHandler = handler; };
    request.destroy = error => {
      request.destroyed = true;
      if (error) request.emit('error', error);
    };
    request.end = () => {
      const next = responses.shift();
      const upstream = new PassThrough();
      upstream.statusCode = next.statusCode;
      upstream.headers = next.headers || {};
      call.response = upstream;
      callback(upstream);
      upstream.end(next.body || '');
    };
    call.request = request;
    return request;
  };
}

async function safeDnsLookup() {
  return [{ address: '192.168.50.20', family: 4 }];
}

function readPinnedAddress(lookup) {
  return new Promise((resolve, reject) => {
    lookup('ignored.test', {}, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
}

const GATEWAY_URL = `http://127.0.0.1:43123/openhome-media/${'A'.repeat(32)}`;

class FakeAudioElement {
  constructor() {
    this.assignments = [];
    this._crossOrigin = null;
    this._src = '';
    this.paused = true;
    this.error = null;
    this.readyState = 1;
    this.duration = 60;
  }

  set crossOrigin(value) {
    this.assignments.push(['crossOrigin', value]);
    this._crossOrigin = value;
  }

  get crossOrigin() {
    return this._crossOrigin;
  }

  set src(value) {
    this.assignments.push(['src', value]);
    this._src = value;
  }

  get src() {
    return this._src;
  }

  removeAttribute(name) {
    this.assignments.push(['removeAttribute', name]);
    if (name === 'crossorigin') this._crossOrigin = null;
  }

  addEventListener() {}
  removeEventListener() {}
  load() {}
  pause() { this.paused = true; }
}

async function createAudioContextManager(audioElement = null) {
  const { AudioContextManager } = await import(
    '../../js/ui/audio-player/audio-context-manager.js'
  );
  return new AudioContextManager({
    audioContext: null,
    audioElement,
    stateManager: null
  }, {
    ioManager: {},
    sourceNode: null
  });
}

async function withFakeAudio(callback) {
  const previousAudio = globalThis.Audio;
  globalThis.Audio = FakeAudioElement;
  try {
    await callback();
  } finally {
    if (previousAudio === undefined) delete globalThis.Audio;
    else globalThis.Audio = previousAudio;
  }
}

test('OpenHome gateway sends renderer headers with a bounded Range and omits credentials', async () => {
  const calls = [];
  const gateway = new OpenHomeMediaGateway({
    serverFactory: createServerFactory(),
    httpRequest: createRequestImpl([{
      statusCode: 206,
      headers: {
        'content-type': 'audio/flac',
        'content-length': '4',
        'content-range': 'bytes 2-5/10',
        'accept-ranges': 'bytes',
        'contentfeatures.dlna.org': 'DLNA.ORG_OP=01',
        'transfermode.dlna.org': 'Streaming',
        'set-cookie': 'secret=true'
      },
      body: 'data'
    }], calls),
    dnsLookup: safeDnsLookup,
    randomBytes: () => Buffer.alloc(24, 7)
  });
  const registration = await gateway.register('http://media.test/album/song.flac');
  const response = createClientResponse();
  const readBody = bodyOf(response);

  await gateway.handleRequest({
    method: 'GET',
    url: new URL(registration.playbackUrl).pathname,
    headers: {
      range: 'bytes=2-5',
      accept: 'audio/*',
      authorization: 'Bearer private',
      cookie: 'private=true'
    }
  }, response);

  assert.equal(response.statusCode, 206);
  assert.equal(readBody(), 'data');
  assert.equal(response.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(response.headers.get('contentfeatures.dlna.org'), 'DLNA.ORG_OP=01');
  assert.equal(response.headers.get('transfermode.dlna.org'), 'Streaming');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.has('set-cookie'), false);
  assert.deepEqual(calls[0].options.headers, {
    'accept-encoding': 'identity',
    'getcontentFeatures.dlna.org': '1',
    'transferMode.dlna.org': 'Streaming',
    'User-Agent': 'EffeTune/1.0 UPnP/1.0 DLNADOC/1.50',
    range: 'bytes=2-5',
    accept: 'audio/*'
  });
  assert.deepEqual(await readPinnedAddress(calls[0].options.lookup), {
    address: '192.168.50.20',
    family: 4
  });
  await gateway.close();
});

test('OpenHome gateway follows a validated redirect for HEAD requests', async () => {
  const httpCalls = [];
  const httpsCalls = [];
  const gateway = new OpenHomeMediaGateway({
    serverFactory: createServerFactory(),
    httpRequest: createRequestImpl([{
      statusCode: 302,
      headers: { location: 'https://cdn.test/song.mp3' }
    }], httpCalls),
    httpsRequest: createRequestImpl([{
      statusCode: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '1234' },
      body: 'not-forwarded-for-head'
    }], httpsCalls),
    dnsLookup: safeDnsLookup,
    randomBytes: () => Buffer.alloc(24, 8)
  });
  const registration = await gateway.register('http://media.test/song.mp3');
  const response = createClientResponse();
  const readBody = bodyOf(response);

  await gateway.handleRequest({
    method: 'HEAD',
    url: new URL(registration.playbackUrl).pathname,
    headers: { range: 'bytes=0-' }
  }, response);

  assert.equal(httpCalls.length, 1);
  assert.equal(httpsCalls.length, 1);
  assert.equal(httpCalls[0].request.destroyed, true);
  assert.equal(httpCalls[0].response.destroyed, true);
  assert.equal(httpsCalls[0].options.method, 'HEAD');
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers.get('content-length'), '1234');
  assert.equal(readBody(), '');
  await gateway.close();
});

test('OpenHome gateway bounds DNS lookup time and releases its stream slot', async () => {
  let timerCallback = null;
  let timerDelay = null;
  const diagnostics = [];
  const gateway = new OpenHomeMediaGateway({
    serverFactory: createServerFactory(),
    dnsLookup: () => new Promise(() => {}),
    randomBytes: () => Buffer.alloc(24, 15),
    setTimer(callback, milliseconds) {
      timerCallback = callback;
      timerDelay = milliseconds;
      return 1;
    },
    clearTimer() {},
    onDiagnostic: code => diagnostics.push(code)
  });
  const registration = await gateway.register('http://unresponsive-dns.test/song.flac');
  const response = createClientResponse();
  const handling = gateway.handleRequest({
    method: 'GET',
    url: new URL(registration.playbackUrl).pathname,
    headers: {}
  }, response);
  await Promise.resolve();

  assert.equal(timerDelay, DNS_LOOKUP_TIMEOUT_MS);
  assert.equal(gateway.activeStreams, 1);
  timerCallback();
  await handling;

  assert.equal(response.statusCode, 502);
  assert.deepEqual(diagnostics, ['dns-timeout']);
  assert.equal(gateway.activeStreams, 0);
  await gateway.close();
});

test('OpenHome gateway close cancels pending DNS and waits for slot release', async () => {
  const diagnostics = [];
  const gateway = new OpenHomeMediaGateway({
    serverFactory: createServerFactory(),
    dnsLookup: () => new Promise(() => {}),
    randomBytes: () => Buffer.alloc(24, 16),
    setTimer: () => 1,
    clearTimer() {},
    onDiagnostic: code => diagnostics.push(code)
  });
  const registration = await gateway.register('http://closing-dns.test/song.flac');
  const response = createClientResponse();
  const handling = gateway.handleRequest({
    method: 'GET',
    url: new URL(registration.playbackUrl).pathname,
    headers: {}
  }, response);
  await Promise.resolve();
  assert.equal(gateway.activeStreams, 1);

  await Promise.all([handling, gateway.close()]);

  assert.equal(gateway.activeStreams, 0);
  assert.equal(gateway.activeRequests.size, 0);
  assert.equal(response.destroyed, true);
  assert.deepEqual(diagnostics, []);
});

test('OpenHome gateway releases an upstream request and stream slot when its client disconnects', async () => {
  const calls = [];
  const gateway = new OpenHomeMediaGateway({
    serverFactory: createServerFactory(),
    httpRequest: (target, options, callback) => {
      const request = new EventEmitter();
      request.destroyed = false;
      request.setTimeout = () => {};
      request.destroy = error => {
        if (request.destroyed) return;
        request.destroyed = true;
        if (error) request.emit('error', error);
      };
      request.end = () => {
        const call = { target, options, callback, request };
        calls.push(call);
        if (calls.length === 2) {
          const upstream = new PassThrough();
          upstream.statusCode = 200;
          upstream.headers = { 'content-type': 'audio/flac', 'content-length': '2' };
          callback(upstream);
          upstream.end('ok');
        }
      };
      return request;
    },
    dnsLookup: safeDnsLookup,
    randomBytes: () => Buffer.alloc(24, 17)
  });
  const registration = await gateway.register('http://media.test/song.flac');
  const path = new URL(registration.playbackUrl).pathname;
  const abandonedResponse = createClientResponse();
  const abandonedHandling = gateway.handleRequest({
    method: 'GET',
    url: path,
    headers: {}
  }, abandonedResponse);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(gateway.activeStreams, 1);
  assert.equal(gateway.activeRequests.size, 1);
  abandonedResponse.destroy();
  await abandonedHandling;

  assert.equal(calls[0].request.destroyed, true);
  assert.equal(gateway.activeStreams, 0);
  assert.equal(gateway.activeRequests.size, 0);
  assert.equal(abandonedResponse.listenerCount('close'), 0);
  assert.equal(abandonedResponse.listenerCount('finish'), 0);

  const nextResponse = createClientResponse();
  const readBody = bodyOf(nextResponse);
  await gateway.handleRequest({ method: 'GET', url: path, headers: {} }, nextResponse);

  assert.equal(nextResponse.statusCode, 200);
  assert.equal(readBody(), 'ok');
  assert.equal(gateway.activeStreams, 0);
  assert.equal(gateway.activeRequests.size, 0);
  await gateway.close();
});

test('OpenHome gateway rejects unsafe URIs and revalidates redirect targets', async () => {
  for (const uri of [
    'file:///secret.flac',
    'data:audio/mpeg;base64,AA==',
    'http://user:pass@media.test/song.mp3'
  ]) {
    assert.throws(() => normalizeMediaUri(uri), error => error?.code === 'invalid-uri');
  }

  const diagnostics = [];
  const gateway = new OpenHomeMediaGateway({
    serverFactory: createServerFactory(),
    httpRequest: createRequestImpl([{
      statusCode: 302,
      headers: { location: 'https://user:pass@cdn.test/song.mp3' }
    }], []),
    dnsLookup: safeDnsLookup,
    randomBytes: () => Buffer.alloc(24, 9),
    onDiagnostic: code => diagnostics.push(code)
  });
  const registration = await gateway.register('http://media.test/song.mp3');
  const response = createClientResponse();

  await gateway.handleRequest({
    method: 'GET',
    url: new URL(registration.playbackUrl).pathname,
    headers: {}
  }, response);

  assert.equal(response.statusCode, 502);
  assert.deepEqual(diagnostics, ['invalid-redirect']);
  await gateway.close();
});

test('OpenHome gateway keeps opaque registrations valid until their queue entry is released', async () => {
  let now = 1000;
  const calls = [];
  const gateway = new OpenHomeMediaGateway({
    serverFactory: createServerFactory(),
    httpRequest: createRequestImpl([{
      statusCode: 200,
      headers: { 'content-type': 'audio/wav', 'content-length': '2' },
      body: 'ok'
    }], calls),
    now: () => now,
    dnsLookup: safeDnsLookup,
    randomBytes: () => Buffer.alloc(24, 10)
  });
  const registration = await gateway.register('http://media.test/song.wav');
  now += 365 * 24 * 60 * 60 * 1000;
  const response = createClientResponse();

  await gateway.handleRequest({
    method: 'GET',
    url: new URL(registration.playbackUrl).pathname,
    headers: {}
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(calls.length, 1);

  assert.equal(gateway.release(registration.token), true);
  const releasedResponse = createClientResponse();
  await gateway.handleRequest({
    method: 'GET',
    url: new URL(registration.playbackUrl).pathname,
    headers: {}
  }, releasedResponse);
  assert.equal(releasedResponse.statusCode, 404);
  assert.equal(calls.length, 1);
  await gateway.close();
});

test('OpenHome gateway rejects host-internal literal and DNS addresses', async () => {
  const cases = [
    ['http://0.0.0.0/song.flac', safeDnsLookup],
    ['http://127.0.0.1/song.flac', safeDnsLookup],
    ['http://169.254.169.254/song.flac', safeDnsLookup],
    ['http://224.0.0.1/song.flac', safeDnsLookup],
    ['http://[::1]/song.flac', safeDnsLookup],
    ['http://[fe80::1]/song.flac', safeDnsLookup],
    ['http://media.test/song.flac', async () => [{ address: '127.0.0.1', family: 4 }]]
  ];

  for (const [uri, dnsLookup] of cases) {
    let upstreamCalls = 0;
    const diagnostics = [];
    const gateway = new OpenHomeMediaGateway({
      serverFactory: createServerFactory(),
      httpRequest: () => {
        upstreamCalls += 1;
        throw new Error('must not connect');
      },
      dnsLookup,
      randomBytes: () => Buffer.alloc(24, 11),
      onDiagnostic: code => diagnostics.push(code)
    });
    const registration = await gateway.register(uri);
    const response = createClientResponse();

    await gateway.handleRequest({
      method: 'GET',
      url: new URL(registration.playbackUrl).pathname,
      headers: {}
    }, response);

    assert.equal(response.statusCode, 502, uri);
    assert.equal(upstreamCalls, 0, uri);
    assert.deepEqual(diagnostics, ['address-not-allowed'], uri);
    await gateway.close();
  }
});

test('OpenHome gateway allows LAN and public HTTP targets and pins the validated DNS address', async () => {
  let dnsCalls = 0;
  const calls = [];
  const gateway = new OpenHomeMediaGateway({
    serverFactory: createServerFactory(),
    httpRequest: createRequestImpl([{
      statusCode: 200,
      headers: { 'content-type': 'audio/mpeg', 'content-length': '2' },
      body: 'ok'
    }], calls),
    dnsLookup: async () => {
      dnsCalls += 1;
      return [{
        address: dnsCalls === 1 ? '203.0.113.20' : '127.0.0.1',
        family: 4
      }];
    },
    randomBytes: () => Buffer.alloc(24, 12)
  });
  const registration = await gateway.register('http://public-media.test/song.mp3');
  const response = createClientResponse();

  await gateway.handleRequest({
    method: 'GET',
    url: new URL(registration.playbackUrl).pathname,
    headers: {}
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(dnsCalls, 1);
  assert.deepEqual(await readPinnedAddress(calls[0].options.lookup), {
    address: '203.0.113.20',
    family: 4
  });
  assert.equal(dnsCalls, 1);
  await gateway.close();

  const lanCalls = [];
  const lanGateway = new OpenHomeMediaGateway({
    serverFactory: createServerFactory(),
    httpRequest: createRequestImpl([{
      statusCode: 200,
      headers: { 'content-type': 'audio/flac', 'content-length': '2' },
      body: 'ok'
    }], lanCalls),
    dnsLookup: async () => [{ address: '192.168.1.30', family: 4 }],
    randomBytes: () => Buffer.alloc(24, 13)
  });
  const lanRegistration = await lanGateway.register('http://lan-media.test/song.flac');
  await lanGateway.handleRequest({
    method: 'GET',
    url: new URL(lanRegistration.playbackUrl).pathname,
    headers: {}
  }, createClientResponse());
  assert.deepEqual(await readPinnedAddress(lanCalls[0].options.lookup), {
    address: '192.168.1.30',
    family: 4
  });
  await lanGateway.close();
});

test('OpenHome gateway revalidates redirect DNS and blocks a host-internal destination', async () => {
  const calls = [];
  const diagnostics = [];
  const gateway = new OpenHomeMediaGateway({
    serverFactory: createServerFactory(),
    httpRequest: createRequestImpl([{
      statusCode: 302,
      headers: { location: 'http://metadata.test/latest/song.mp3' }
    }], calls),
    dnsLookup: async hostname => [{
      address: hostname === 'media.test' ? '192.168.1.20' : '169.254.169.254',
      family: 4
    }],
    randomBytes: () => Buffer.alloc(24, 14),
    onDiagnostic: code => diagnostics.push(code)
  });
  const registration = await gateway.register('http://media.test/song.mp3');
  const response = createClientResponse();

  await gateway.handleRequest({
    method: 'GET',
    url: new URL(registration.playbackUrl).pathname,
    headers: {}
  }, response);

  assert.equal(response.statusCode, 502);
  assert.equal(calls.length, 1);
  assert.deepEqual(diagnostics, ['address-not-allowed']);
  await gateway.close();
});

test('player source assignment enables anonymous CORS only for the loopback OpenHome gateway', async () => {
  const manager = await createAudioContextManager();
  const element = new FakeAudioElement();
  element.crossOrigin = 'use-credentials';
  element.assignments.length = 0;

  manager.setAudioElementSource(element, 'blob:local-track');
  assert.equal(element.crossOrigin, 'use-credentials');
  assert.deepEqual(element.assignments, [['src', 'blob:local-track']]);

  manager.setAudioElementSource(element, GATEWAY_URL);
  assert.deepEqual(element.assignments.slice(-2), [
    ['crossOrigin', 'anonymous'],
    ['src', GATEWAY_URL]
  ]);

  manager.setAudioElementSource(element, 'file:///C:/Music/local.flac');
  assert.deepEqual(element.assignments.slice(-2), [
    ['removeAttribute', 'crossorigin'],
    ['src', 'file:///C:/Music/local.flac']
  ]);
  assert.equal(element.crossOrigin, null);

  const directHttp = new FakeAudioElement();
  const nonGatewayUrl = `http://media.test/openhome-media/${'B'.repeat(32)}`;
  manager.setAudioElementSource(directHttp, nonGatewayUrl);
  assert.deepEqual(directHttp.assignments, [['src', nonGatewayUrl]]);
});

test('initial player Audio element applies gateway CORS before src', async () => {
  await withFakeAudio(async () => {
    const manager = await createAudioContextManager();
    manager.getTrackIndexForPlaybackEntry = () => 0;
    manager.setupEventHandlers = () => {};
    manager.getMediaElementSourceUrl = value => value;
    manager.revokeCurrentObjectURL = () => {};
    manager.clearActiveRegion = () => {};
    manager.connectToAudioContext = () => true;
    manager.setupMediaSessionHandlers = () => {};
    manager.updateState = () => {};
    manager.loadMetadata = () => {};

    assert.equal(manager.setupAudioElement({ mediaSource: GATEWAY_URL }, 0), true);
    assert.deepEqual(manager.audioPlayer.audioElement.assignments.slice(0, 2), [
      ['crossOrigin', 'anonymous'],
      ['src', GATEWAY_URL]
    ]);
  });
});

test('player Audio element graph regeneration reapplies gateway CORS before src', async () => {
  await withFakeAudio(async () => {
    const oldElement = new FakeAudioElement();
    oldElement._src = GATEWAY_URL;
    const manager = await createAudioContextManager(oldElement);
    const source = {};
    let createCalls = 0;
    manager.audioPlayer.audioContext = {
      createMediaElementSource() {
        createCalls += 1;
        if (createCalls === 1) {
          const error = new Error('element is already connected');
          error.name = 'InvalidStateError';
          throw error;
        }
        return source;
      }
    };
    manager.setupEventHandlers = () => {};
    manager.connectMediaSource = () => true;

    assert.equal(manager.connectToAudioContext(), true);
    assert.deepEqual(manager.audioPlayer.audioElement.assignments.slice(0, 2), [
      ['crossOrigin', 'anonymous'],
      ['src', GATEWAY_URL]
    ]);
  });
});

test('player transition candidate applies gateway CORS before src', async () => {
  await withFakeAudio(async () => {
    const manager = await createAudioContextManager();
    const source = {};
    manager.audioPlayer.audioContext = {
      createMediaElementSource: element => {
        assert.deepEqual(element.assignments.slice(0, 2), [
          ['crossOrigin', 'anonymous'],
          ['src', GATEWAY_URL]
        ]);
        return source;
      }
    };
    manager.getMediaElementSourceUrl = value => value;
    manager.waitForMediaCandidateReadiness = async () => true;
    manager.preparePlaybackSourceChannels = () => {};
    manager.connectPrivatePipelineSource = () => true;

    const candidate = await manager.prepareMediaTransitionCandidate({
      descriptor: { mediaSource: GATEWAY_URL },
      playableTrack: { mediaSource: GATEWAY_URL }
    }, 7, () => false);

    assert.equal(candidate.element.crossOrigin, 'anonymous');
    assert.equal(candidate.source, source);
  });
});
