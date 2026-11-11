'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const http = require('node:http');
const { once } = require('node:events');
const { Readable, Writable } = require('node:stream');
const { LiveStreamServer, createEncoder, createFlacEncoder, createWavEncoder, DLNA_FEATURES } = require('../../electron/network-output-stream.cjs');
const { LIVE_KIND, LIVE_PCM_TYPE, LIVE_CONNECTION_HEADER, isLiveNetworkOutput } = require('../../electron/network-output-live.cjs');
const { OpenHomeMediaGateway } = require('../../electron/openhome-media-gateway.cjs');
const { didl, didlItem } = require('../../electron/network-music-upnp.cjs');

const FRAMES = 2048;

test('FLAC encoder bounds pending PCM and releases queued samples on close', async () => {
  let release;
  const added = [];
  const closed = [];
  let cancelled = 0;
  class AudioSample {
    constructor(options) { this.data = options.data; }
    close() { closed.push(this); }
  }
  class AudioSampleSource {
    add(sample) { added.push(sample); return new Promise(resolve => { release = resolve; }); }
  }
  class Output {
    addAudioTrack() {}
    async start() {}
    async cancel() { cancelled++; }
  }
  const load = async () => ({ Output, AudioSample, AudioSampleSource, FlacOutputFormat: class {}, StreamTarget: class {} });
  const encoder = await createFlacEncoder({ onData() {}, load });
  const samples = new Int16Array(44100 * 2);
  assert.equal(encoder.write(samples), true);
  assert.equal(encoder.write(samples), true);
  assert.equal(encoder.write(block()), false);
  assert.equal(added.length, 1);
  encoder.close();
  release();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(added.length, 1);
  assert.equal(closed.length, 1);
  assert.equal(cancelled, 1);
});

// Passes the PCM bytes straight through so HTTP behaviour can be checked without the FLAC encoder.
function passThroughEncoderFactory(log = []) {
  return async ({ onData }) => {
    const encoder = { writes: 0, closed: 0, write(samples) { encoder.writes++; onData(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)); }, close() { encoder.closed++; } };
    log.push(encoder);
    return encoder;
  };
}
async function openServer(t, options = {}) {
  const server = new LiveStreamServer({ encoderFactory: passThroughEncoderFactory(), ...options });
  await server.open();
  t.after(() => server.close());
  return server;
}
function request(port, path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, resolve);
    req.on('error', reject); req.end();
  });
}
async function drained(res) { res.resume(); await once(res, 'end'); return res; }
function block(fill = 0) { const samples = new Int16Array(FRAMES * 2); if (fill) samples.fill(fill); return samples; }
function collect(res) {
  const chunks = [];
  res.on('data', chunk => chunks.push(chunk));
  res.on('error', () => {});
  return () => Buffer.concat(chunks);
}
async function waitFor(predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for stream data');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function fakeHandle(server, url, { method = 'GET', remote } = {}) {
  const req = Readable.from([]);
  Object.assign(req, { url, method, headers: {}, socket: { remoteAddress: remote } });
  const res = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  res.writeHead = status => { res.statusCode = status; return res; };
  const finished = once(res, 'finish');
  server.handle(req, res);
  await finished;
  return res.statusCode;
}

test('live stream server enforces LAN-only token routes and DLNA streaming headers', async t => {
  const server = await openServer(t);
  assert.ok(server.port > 0);
  await server.open();
  const stream = server.createStream();
  assert.match(stream.token, /^[0-9a-f]{32}$/);
  assert.equal(stream.url('192.168.1.9'), `http://192.168.1.9:${server.port}/live/${stream.token}`);
  assert.equal((await drained(await request(server.port, '/other'))).statusCode, 404);
  assert.equal((await drained(await request(server.port, `/live/${'0'.repeat(32)}`))).statusCode, 404);
  assert.equal((await drained(await request(server.port, `/live/${stream.token}`, { method: 'POST' }))).statusCode, 405);
  assert.equal(await fakeHandle(server, `/live/${stream.token}`, { remote: '8.8.8.8' }), 403);
  assert.equal(await fakeHandle(server, `/live/${stream.token}`, { remote: '::ffff:203.0.113.5' }), 403);

  let connections = 0; stream.on('connected', () => connections++);
  const head = await drained(await request(server.port, `/live/${stream.token}`, { method: 'HEAD' }));
  assert.equal(head.statusCode, 200);
  assert.equal(head.headers['content-type'], 'audio/flac');
  assert.equal(head.headers['content-length'], undefined);
  assert.equal(head.headers['transfer-encoding'], undefined);
  assert.equal(connections, 0);
  assert.equal(stream.connected, false);

  const res = await request(server.port, `/live/${stream.token}`, { headers: { Range: 'bytes=100-' } });
  const body = collect(res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['content-type'], 'audio/flac');
  assert.equal(res.headers['contentfeatures.dlna.org'], DLNA_FEATURES);
  assert.equal(res.headers['transfermode.dlna.org'], 'Streaming');
  assert.equal(res.headers.connection, 'close');
  assert.equal(res.headers['cache-control'], 'no-cache');
  assert.equal(res.headers['content-length'], undefined);
  assert.equal(res.headers['transfer-encoding'], undefined);
  assert.equal(res.headers['content-range'], undefined);
  assert.equal(res.headers.date, undefined);
  const headerNames = new Set(res.rawHeaders.filter((_, index) => index % 2 === 0));
  assert.ok(headerNames.has('contentFeatures.dlna.org') && headerNames.has('transferMode.dlna.org'));
  await waitFor(() => stream.connected);
  assert.equal(connections, 1);
  stream.write(block(7));
  await waitFor(() => body().length >= FRAMES * 4);
  const data = body();
  assert.deepEqual([0, 2, 4, 6].map(position => data.readInt16LE(position)), [7, 7, 7, 7]);
  res.destroy();
});

test('a new GET for the same token replaces the previous connection without a disconnect event', async t => {
  const encoders = [];
  const server = await openServer(t, { encoderFactory: passThroughEncoderFactory(encoders) });
  const stream = server.createStream({ contentType: 'audio/x-flac' });
  const events = []; stream.on('disconnected', () => events.push('disconnected')); stream.on('overflow', () => events.push('overflow'));
  const first = await request(server.port, `/live/${stream.token}`);
  const firstBody = collect(first);
  assert.equal(first.headers['content-type'], 'audio/x-flac');
  await waitFor(() => stream.connected);
  stream.write(block(1));
  await waitFor(() => firstBody().length >= FRAMES * 4);
  const firstClosed = new Promise(resolve => first.once('close', resolve));
  const second = await request(server.port, `/live/${stream.token}`);
  const secondBody = collect(second);
  await firstClosed;
  assert.equal(encoders.length, 2);
  assert.equal(encoders[0].closed, 1);
  await waitFor(() => stream.connected);
  stream.write(block(2));
  await waitFor(() => secondBody().length >= FRAMES * 4);
  assert.equal(encoders[0].writes, 1);
  assert.equal(encoders[1].writes, 1);
  assert.equal(firstBody().length, FRAMES * 4);
  assert.deepEqual(events, []);

  second.destroy();
  await waitFor(() => events.length > 0);
  assert.deepEqual(events, ['disconnected']);
  assert.equal(stream.connected, false);
  assert.equal(encoders[1].closed, 1);
  stream.write(block(3));
  assert.equal(encoders[1].writes, 1);

  // Closing the stream drops the token and the current connection silently.
  const third = await request(server.port, `/live/${stream.token}`);
  collect(third);
  await waitFor(() => stream.connected);
  stream.close();
  await once(third, 'close');
  assert.deepEqual(events, ['disconnected']);
  assert.equal(stream.connected, false);
  assert.equal((await drained(await request(server.port, `/live/${stream.token}`))).statusCode, 404);
  stream.close();
  await server.close();
  assert.equal(server.port, 0);
  await server.close();
});

test('a receiver that stops reading triggers overflow and the connection is dropped', async t => {
  const server = await openServer(t, { maxQueuedBytes: 64 * 1024 });
  const stream = server.createStream();
  const events = []; stream.on('disconnected', () => events.push('disconnected')); stream.on('overflow', () => events.push('overflow'));
  const res = await request(server.port, `/live/${stream.token}`);
  res.on('error', () => {});
  res.pause();
  t.after(() => res.destroy());
  await waitFor(() => stream.connected);
  for (let index = 0; index < 4096 && !events.length; index++) stream.write(block(index + 1));
  assert.deepEqual(events, ['overflow']);
  assert.equal(stream.connected, false);
  // The paused client only observes the server-side close once it reads again.
  res.resume();
  await once(res, 'close');
  assert.deepEqual(events, ['overflow']);
});

test('a GET is closed without connecting when no encoder can be created, and an encoder failure counts as a disconnect', async t => {
  const silent = new LiveStreamServer({ encoderFactory: async () => { throw new Error('no encoder'); } });
  await silent.open();
  t.after(() => silent.close());
  const stream = silent.createStream();
  const events = []; for (const name of ['connected', 'disconnected', 'overflow']) stream.on(name, () => events.push(name));
  const res = await request(silent.port, `/live/${stream.token}`);
  const body = collect(res);
  await once(res, 'close');
  assert.equal(body().length, 0);
  assert.equal(stream.connected, false);
  assert.deepEqual(events, []);
  assert.equal((await drained(await request(silent.port, `/live/${stream.token}`, { method: 'HEAD' }))).statusCode, 200, 'the token stays valid for the next attempt');

  const diagnostics = [];
  const failing = await openServer(t, {
    onDiagnostic: (code, error) => diagnostics.push([code, error.message]),
    encoderFactory: async ({ onError }) => ({ write() { onError(new Error('encoder broke')); }, close() {} })
  });
  const broken = failing.createStream();
  const brokenEvents = []; for (const name of ['connected', 'disconnected', 'overflow']) broken.on(name, () => brokenEvents.push(name));
  const brokenRes = await request(failing.port, `/live/${broken.token}`);
  collect(brokenRes);
  await waitFor(() => broken.connected);
  broken.write(block(1));
  await once(brokenRes, 'close');
  assert.deepEqual(brokenEvents, ['connected', 'disconnected']);
  assert.equal(broken.connected, false);
  assert.deepEqual(diagnostics, [['encoder-error', 'encoder broke']]);
});

test('a failed bind rejects open and is retried by the next open, while close waits for a pending open', async t => {
  const diagnostics = [];
  const server = new LiveStreamServer({ encoderFactory: passThroughEncoderFactory(), onDiagnostic: (code, error) => diagnostics.push([code, error.message]) });
  t.after(() => server.close());
  const listen = server.listen;
  server.listen = async () => { throw new Error('EACCES'); };
  const opening = server.open();
  const closing = server.close();
  await assert.rejects(opening, /EACCES/);
  await closing;
  assert.equal(server.port, 0);
  await assert.rejects(server.open(), /EACCES/);

  server.listen = listen;
  const pending = server.open();
  await server.close();
  await pending;
  assert.equal(server.port, 0, 'close issued during open shuts the bound server down');

  await server.open();
  assert.ok(server.port > 0);
  server.server.emit('error', new Error('socket hiccup'));
  assert.deepEqual(diagnostics, [['server-error', 'socket hiccup']]);
  assert.equal((await drained(await request(server.port, '/other'))).statusCode, 404, 'the server keeps serving after a runtime error');
});

test('WAV encoder emits an endless RIFF header, a silent pre-roll and raw little-endian PCM, and is chosen for audio/wav', async () => {
  const chunks = [];
  const encoder = createWavEncoder({ onData: data => chunks.push(data) });
  const header = chunks[0];
  assert.equal(header.length, 44);
  assert.equal(header.subarray(0, 4).toString('latin1'), 'RIFF');
  assert.equal(header.readUInt32LE(4), 0xffffffff);
  assert.equal(header.subarray(8, 16).toString('latin1'), 'WAVEfmt ');
  assert.deepEqual([header.readUInt16LE(20), header.readUInt16LE(22), header.readUInt32LE(24), header.readUInt32LE(28), header.readUInt16LE(32), header.readUInt16LE(34)], [1, 2, 44100, 176400, 4, 16]);
  assert.equal(header.subarray(36, 40).toString('latin1'), 'data');
  assert.equal(header.readUInt32LE(40), 0xffffffff);
  // Two seconds of silence are sent ahead of the live audio.
  assert.equal(chunks[1].length, 44100 * 2 * 2 * 2);
  assert.equal(encoder.frames, 44100 * 2);
  assert.ok(chunks[1].every(byte => byte === 0));
  const samples = Int16Array.from([1, -2, 0x1234, -0x1234]);
  encoder.write(samples);
  samples.fill(0);
  assert.deepEqual(Array.from(chunks[2]), [1, 0, 0xfe, 0xff, 0x34, 0x12, 0xcc, 0xed]);
  assert.equal(encoder.frames, 44100 * 2 + 2, 'the position counts pre-roll and written frames');
  encoder.close();
  encoder.write(Int16Array.from([5, 5]));
  assert.equal(chunks.length, 3);

  const wav = await createEncoder({ contentType: 'audio/wav', onData: () => {} });
  assert.equal(typeof wav.write, 'function');
  const flac = await createEncoder({ contentType: 'audio/flac', onData: () => {} });
  flac.close();
  assert.notEqual(flac.write, wav.write);
});

test('FLAC encoder reports a failing data sink and closes quietly with or without an error handler', async () => {
  const noisy = [];
  const encoder = await createFlacEncoder({ onData: () => { throw new Error('sink gone'); }, onError: error => noisy.push(error.message) });
  const tone = () => { const samples = block(); for (let n = 0; n < samples.length; n++) samples[n] = Math.round(8000 * Math.sin(n * 0.05)); return samples; };
  for (let index = 0; index < 32; index++) encoder.write(tone());
  await waitFor(() => noisy.length > 0);
  assert.equal(noisy[0], 'sink gone');
  encoder.close();
  encoder.close();
  encoder.write(tone());
  const reported = noisy.length;
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(noisy.length, reported, 'errors stop once the encoder is closed');

  const quiet = await createFlacEncoder({ onData: () => { throw new Error('sink gone'); } });
  for (let index = 0; index < 32; index++) quiet.write(tone());
  await new Promise(resolve => setTimeout(resolve, 300));
  quiet.close();
  await new Promise(resolve => setTimeout(resolve, 100));
});

function crc8(bytes) {
  let crc = 0;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff; }
  return crc;
}
// Walks the metadata blocks and returns the offset of the first frame plus the STREAMINFO block.
function parseFlacHeader(buffer) {
  assert.equal(buffer.subarray(0, 4).toString('latin1'), 'fLaC');
  let offset = 4; let streamInfo = null; let last = false;
  while (!last) {
    const header = buffer[offset]; const length = buffer.readUIntBE(offset + 1, 3);
    last = Boolean(header & 0x80);
    if ((header & 0x7f) === 0) streamInfo = buffer.subarray(offset + 4, offset + 4 + length);
    offset += 4 + length;
  }
  return { offset, streamInfo };
}
// Finds consecutive fixed-block-size (4096 frames, 44.1 kHz, 16 bit, any stereo decorrelation) frame headers by
// validating the CRC-8.
function parseFlacFrames(buffer, start) {
  const frames = []; let offset = start;
  while (offset + 6 <= buffer.length) {
    if (buffer[offset] !== 0xff || buffer[offset + 1] !== 0xf8 || buffer[offset + 2] !== 0xc9 || (buffer[offset + 3] & 0x0f) !== 0x08) { offset++; continue; }
    let position = offset + 4; const lead = buffer[position++]; let ones = 0;
    while (ones < 7 && lead & (0x80 >> ones)) ones++;
    let number = ones === 0 ? lead : lead & (0x7f >> ones);
    for (let index = 1; index < ones; index++) number = number * 64 + (buffer[position++] & 0x3f);
    if (ones !== 1 && position < buffer.length && crc8(buffer.subarray(offset, position)) === buffer[position] && number === frames.length) {
      frames.push({ offset, number }); offset = position + 1;
    } else offset++;
  }
  return frames;
}

test('FLAC stream starts with STREAMINFO of unknown length and stays continuous across silence and audio', async t => {
  const server = await openServer(t, { encoderFactory: createFlacEncoder });
  const stream = server.createStream();
  const res = await request(server.port, `/live/${stream.token}`);
  const body = collect(res);
  t.after(() => res.destroy());
  await waitFor(() => stream.connected);
  const blocks = 24;
  for (let index = 0; index < blocks; index++) {
    const samples = block();
    if (index >= 8) for (let n = 0; n < samples.length; n++) samples[n] = Math.round(8000 * Math.sin(n * 0.05 + index));
    stream.write(samples);
  }
  await waitFor(() => body().length >= 42);
  const { offset, streamInfo } = parseFlacHeader(body());
  assert.equal(streamInfo.length, 34);
  // Unfinalized STREAMINFO: block-size bounds are the FLAC extremes and frame sizes / total samples stay unknown (0).
  assert.equal(streamInfo.readUInt16BE(0), 16);
  assert.equal(streamInfo.readUInt16BE(2), 65535);
  assert.equal(streamInfo.readUIntBE(4, 3), 0);
  assert.equal(streamInfo.readUIntBE(7, 3), 0);
  const rateBits = streamInfo.readUIntBE(10, 3);
  assert.equal(rateBits >>> 4, 44100);
  assert.equal((rateBits >>> 1) & 7, 1);
  assert.equal((rateBits & 1) * 16 + (streamInfo[13] >>> 4), 15);
  assert.equal(streamInfo.readUIntBE(13, 5) % 2 ** 36, 0);
  const expectedFrames = Math.floor(blocks * FRAMES / 4096) - 2;
  await waitFor(() => parseFlacFrames(body(), offset).length >= expectedFrames);
  const frames = parseFlacFrames(body(), offset);
  assert.deepEqual(frames.map(frame => frame.number), frames.map((_, index) => index));
  assert.ok(frames.length >= 8, `expected frames across the silence to audio switch, got ${frames.length}`);
  assert.ok(frames[1].offset - frames[0].offset < 32);
  assert.ok(frames[7].offset - frames[6].offset > 1000);
  stream.close();
  await once(res, 'close');
});

test('a WAV stream has no position before a client attaches, then continues from the last write on the sender clock', async t => {
  let now = 1000;
  const server = await openServer(t, { clockNow: () => now, encoderFactory: createEncoder });
  const stream = server.createStream({ contentType: 'audio/wav' });
  assert.equal(stream.framesAt(now), null);
  const connected = once(stream, 'connected');
  const response = await request(server.port, new URL(stream.url('127.0.0.1')).pathname);
  response.resume();
  await connected;
  assert.equal(stream.framesAt(1000), 44100 * 2, 'the pre-roll is sent on attach');
  now = 1040;
  stream.write(new Int16Array(882 * 2));
  assert.equal(stream.framesAt(1040), 44100 * 2 + 882);
  assert.equal(stream.framesAt(1060), 44100 * 2 + 882 * 2, 'a packet later the position is one packet further');
  response.destroy();
});

test('the versioned DIDL hint is bound to the resource URI in its item', () => {
  const uri = `http://192.168.1.2:6000/live/${'b'.repeat(32)}`;
  const item = { id: 'effetune-network-output', title: 'EffeTune', uri, protocolInfo: 'http-get:*:audio/flac:*' };
  const marked = didl([didlItem({ ...item, streamKind: LIVE_KIND })]);
  assert.equal(isLiveNetworkOutput(uri, marked), true);
  assert.equal(isLiveNetworkOutput(uri, didl([didlItem(item)])), false);
  assert.equal(isLiveNetworkOutput(uri, marked.replace(LIVE_KIND, 'live-pcm-v2')), false);
  assert.equal(isLiveNetworkOutput(uri, marked.replace('urn:effetune-org:metadata-1-0', 'urn:someone-else')), false);
  assert.equal(isLiveNetworkOutput(uri, marked.replace('192.168.1.2', '192.168.1.3')), false);
  assert.equal(isLiveNetworkOutput(uri, `${marked}<item/>`), false);
});

test('negotiated gateway PCM has a fresh frame origin per GET and a single-use feedback probe', async t => {
  let now = 1000;
  const server = await openServer(t, { clockNow: () => now });
  const stream = server.createStream();
  const gateway = new OpenHomeMediaGateway({
    httpRequest: (target, options, callback) => http.request(new URL(target.pathname, `http://127.0.0.1:${server.port}`),
      { ...options, lookup: undefined }, callback)
  });
  t.after(() => gateway.close());
  const registration = await gateway.register(stream.url('192.168.1.2'), { live: true });
  const gatewayUrl = new URL(registration.playbackUrl);
  const getPcm = () => request(gatewayUrl.port, gatewayUrl.pathname, { headers: { Accept: LIVE_PCM_TYPE } });
  const response = await getPcm();
  const body = collect(response);
  assert.equal(response.headers['content-type'], LIVE_PCM_TYPE);
  const connectionId = response.headers[LIVE_CONNECTION_HEADER];
  assert.match(connectionId, /^[0-9a-f]{32}$/);
  const position = { sessionId: registration.token, connectionId };
  const observed = [];
  stream.on('feedback', sample => observed.push(sample));
  const writeBlock = (value, firstFrameTimeMs) => stream.write(block(value), [{ offset: 0, frames: FRAMES, firstFrameTimeMs,
    frameDurationMs: 1000 / 44100, revision: 7, delayFrames: 2205, uncertaintyMs: 10 }]);
  writeBlock(513, 900);
  await waitFor(() => body().length === FRAMES * 4);
  assert.equal(body().readInt16LE(0), 513);
  assert.equal(body().readInt16LE((FRAMES * 2 - 1) * 2), 513);
  const report = (probeId, positionFrames) => ({ ...position, probeId, positionFrames, dspMs: 37,
    softwareOutputMs: 10, physicalOutputMs: 9, revision: 12 });
  now = 1140;
  const firstProbe = await gateway.requestLiveFeedback(position);
  assert.match(firstProbe, /^[0-9a-f]{32}$/);
  now = 1160;
  assert.equal(await gateway.requestLiveFeedback(report(firstProbe, 1)), true);
  assert.equal(await gateway.requestLiveFeedback(report(firstProbe, 2)), null, 'a probe is single-use');
  assert.equal(observed[0].ingressMs, 50);
  assert.equal(observed[0].transportMs, 150);
  assert.equal(observed[0].uncertaintyMs, 20);
  now = 1140 + (FRAMES - 1) * 1000 / 44100;
  const lastProbe = await gateway.requestLiveFeedback(position);
  now += 20;
  assert.equal(await gateway.requestLiveFeedback(report(lastProbe, FRAMES)), true);
  assert.ok(Math.abs(observed[1].ingressMs + observed[1].transportMs - 200) < 0.001,
    'packet fill is counted once regardless of the mark position');
  const lateProbe = await gateway.requestLiveFeedback(position);
  now += 301;
  assert.equal(await gateway.requestLiveFeedback(report(lateProbe, FRAMES)), null);

  const reconnected = await getPcm();
  const nextBody = collect(reconnected);
  const nextConnectionId = reconnected.headers[LIVE_CONNECTION_HEADER];
  assert.notEqual(nextConnectionId, connectionId);
  assert.equal(await gateway.requestLiveFeedback(position), null);
  writeBlock(514, now - 100);
  await waitFor(() => nextBody().length === FRAMES * 4);
  assert.equal(nextBody().readInt16LE(0), 514);
  assert.match(await gateway.requestLiveFeedback({ ...position, connectionId: nextConnectionId }), /^[0-9a-f]{32}$/);
  assert.equal(gateway.release(registration.token), true);
  assert.equal(await gateway.requestLiveFeedback(position), null);
});
