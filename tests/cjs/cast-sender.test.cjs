'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Duplex } = require('node:stream');
const { CastSession, encodeCastMessage, decodeCastMessages, NAMESPACE } = require('../../electron/cast-sender.cjs');

// A Duplex standing in for the TLS socket: frames written by the session are decoded into `sent`, and
// receiver messages are injected with `reply`.
class FakeSocket extends Duplex {
  constructor() { super(); this.sent = []; this.waiters = []; this.outgoing = Buffer.alloc(0); }
  _read() {}
  _write(chunk, _encoding, callback) {
    this.outgoing = Buffer.concat([this.outgoing, chunk]);
    const { messages, rest } = decodeCastMessages(this.outgoing); this.outgoing = rest;
    for (const message of messages) {
      const entry = { ...message, payload: JSON.parse(message.payloadUtf8) };
      const waiter = this.waiters.shift();
      if (waiter) waiter(entry); else this.sent.push(entry);
    }
    callback();
  }
  next() { return this.sent.length ? Promise.resolve(this.sent.shift()) : new Promise(resolve => this.waiters.push(resolve)); }
  reply(namespace, payload, sourceId = 'receiver-0') { this.push(encodeCastMessage({ sourceId, destinationId: 'sender-0', namespace, payloadUtf8: JSON.stringify(payload) })); }
}
function fakeTimers() {
  const timers = new Map(); let nextId = 1;
  return {
    timers,
    setTimeoutFn: (fn, ms) => { const id = nextId++; timers.set(id, { fn, ms }); return id; },
    clearTimeoutFn: id => timers.delete(id),
    fire(ms) { for (const [id, timer] of timers) if (timer.ms === ms) { timers.delete(id); timer.fn(); return true; } return false; },
    pending(ms) { return Array.from(timers.values()).filter(timer => timer.ms === ms).length; }
  };
}
function fixture({ autoConnect = true } = {}) {
  const socket = new FakeSocket(); const timers = fakeTimers(); const diagnostics = []; let connectOptions = null;
  const connect = (options, callback) => { connectOptions = options; if (autoConnect) process.nextTick(callback); return socket; };
  const session = new CastSession({ host: '192.168.1.20', connect, onDiagnostic: (code, detail) => diagnostics.push([code, detail]), setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  return { socket, timers, diagnostics, session, getConnectOptions: () => connectOptions };
}
async function connected(t, options) {
  const parts = fixture(options);
  t.after(() => parts.session.close());
  const connecting = parts.session.connect();
  const first = await parts.socket.next();
  await connecting;
  return { ...parts, first };
}
const application = { appId: 'CC1AD845', sessionId: 'session-1', transportId: 'web-7', displayName: 'Default Media Receiver' };

test('CastMessage protobuf encoding matches the wire format and decodes across split frames', () => {
  const frame = encodeCastMessage({ sourceId: 'a', destinationId: 'b', namespace: 'c', payloadUtf8: '{}' });
  assert.equal(frame.toString('hex'), '00000011' + '0800' + '120161' + '1a0162' + '220163' + '2800' + '32027b7d');
  const message = { protocolVersion: 0, sourceId: 'sender-0', destinationId: 'receiver-0', namespace: NAMESPACE.receiver, payloadType: 0, payloadUtf8: JSON.stringify({ type: 'GET_STATUS', requestId: 300, text: 'ラウンドトリップ' }) };
  const encoded = Buffer.concat([encodeCastMessage(message), encodeCastMessage({ ...message, payloadUtf8: 'x'.repeat(200) })]);
  const partial = decodeCastMessages(encoded.subarray(0, encoded.length - 5));
  assert.equal(partial.messages.length, 1);
  assert.deepEqual(partial.messages[0], message);
  assert.equal(partial.rest.length, encoded.length - 5 - encoded.readUInt32BE(0) - 4);
  const complete = decodeCastMessages(Buffer.concat([partial.rest, encoded.subarray(encoded.length - 5)]));
  assert.equal(complete.messages.length, 1);
  assert.equal(complete.messages[0].payloadUtf8, 'x'.repeat(200));
  assert.equal(complete.rest.length, 0);
  assert.throws(() => decodeCastMessages(Buffer.from('00000003120561', 'hex')), RangeError);

  // Binary payloads are kept, fixed-width fields are skipped and malformed tags or varints are rejected.
  const raw = body => Buffer.concat([Buffer.from([0, 0, 0, body.length]), Buffer.from(body)]);
  const extra = decodeCastMessages(raw([0x3a, 2, 0xca, 0xfe, 0x41, 1, 2, 3, 4, 5, 6, 7, 8, 0x4d, 1, 2, 3, 4])).messages[0];
  assert.deepEqual(extra.payloadBinary, Buffer.from([0xca, 0xfe]));
  assert.equal(extra.payloadUtf8, '');
  assert.throws(() => decodeCastMessages(raw([0x43, 0])), /Malformed/);
  assert.throws(() => decodeCastMessages(raw(Array(11).fill(0xff))), /Malformed/);
});

test('cast session connects, launches the default receiver, loads a live stream and reports status events', async t => {
  const { socket, session, first, getConnectOptions, timers } = await connected(t);
  assert.deepEqual(getConnectOptions(), { host: '192.168.1.20', port: 8009, rejectUnauthorized: false });
  assert.equal(first.protocolVersion, 0); assert.equal(first.payloadType, 0);
  assert.equal(first.sourceId, 'sender-0'); assert.equal(first.destinationId, 'receiver-0');
  assert.equal(first.namespace, NAMESPACE.connection); assert.deepEqual(first.payload, { type: 'CONNECT' });
  const media = []; const receivers = [];
  session.on('media', event => media.push(event)); session.on('receiver', event => receivers.push(event));

  const loading = session.launchAndLoad({ url: 'http://192.168.1.9:4000/live/abc', contentType: 'audio/flac' });
  const getStatus = await socket.next();
  assert.equal(getStatus.namespace, NAMESPACE.receiver); assert.equal(getStatus.destinationId, 'receiver-0');
  assert.deepEqual(getStatus.payload, { type: 'GET_STATUS', requestId: 1 });
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 1, status: { applications: [{ appId: 'E8C28D3C', sessionId: 'idle' }] } });
  const launch = await socket.next();
  assert.deepEqual(launch.payload, { type: 'LAUNCH', appId: 'CC1AD845', requestId: 2 });
  assert.equal(launch.destinationId, 'receiver-0');
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 2, status: { applications: [application] } });
  const transportConnect = await socket.next();
  assert.equal(transportConnect.namespace, NAMESPACE.connection); assert.equal(transportConnect.destinationId, 'web-7');
  assert.deepEqual(transportConnect.payload, { type: 'CONNECT' });
  const load = await socket.next();
  assert.equal(load.namespace, NAMESPACE.media); assert.equal(load.destinationId, 'web-7');
  assert.deepEqual(load.payload, { type: 'LOAD', requestId: 3, media: { contentId: 'http://192.168.1.9:4000/live/abc', contentType: 'audio/flac', streamType: 'LIVE' }, autoplay: true });
  socket.reply(NAMESPACE.media, { type: 'MEDIA_STATUS', requestId: 3, status: [{ mediaSessionId: 1, playerState: 'BUFFERING' }] }, 'web-7');
  assert.deepEqual(await loading, { appId: 'CC1AD845', sessionId: 'session-1', transportId: 'web-7', playerState: 'BUFFERING' });
  assert.deepEqual(media, [{ playerState: 'BUFFERING', idleReason: null, mediaSessionId: 1, contentId: null }]);
  assert.deepEqual(receivers, [{ appId: 'E8C28D3C', sessionId: 'idle' }, { appId: 'CC1AD845', sessionId: 'session-1' }]);
  assert.equal(timers.pending(15000) + timers.pending(10000), 0);

  socket.reply(NAMESPACE.media, { type: 'MEDIA_STATUS', requestId: 0, status: [{ mediaSessionId: 0, playerState: 'IDLE', idleReason: 'INTERRUPTED' }, { mediaSessionId: 1, playerState: 'PLAYING', media: { contentId: 'http://192.168.1.9:4000/live/abc' } }] }, 'web-7');
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 0, status: { applications: [{ appId: 'OTHERAPP', sessionId: 'session-2', transportId: 'web-8' }] } });
  socket.reply(NAMESPACE.heartbeat, { type: 'PING' });
  const pong = await socket.next();
  assert.equal(pong.namespace, NAMESPACE.heartbeat); assert.equal(pong.destinationId, 'receiver-0'); assert.deepEqual(pong.payload, { type: 'PONG' });
  assert.deepEqual(media.slice(1), [{ playerState: 'IDLE', idleReason: 'INTERRUPTED', mediaSessionId: 0, contentId: null }, { playerState: 'PLAYING', idleReason: null, mediaSessionId: 1, contentId: 'http://192.168.1.9:4000/live/abc' }]);
  assert.deepEqual(receivers.at(-1), { appId: 'OTHERAPP', sessionId: 'session-2' });

  assert.equal(timers.pending(5000), 1);
  assert.ok(timers.fire(5000));
  const ping = await socket.next();
  assert.equal(ping.namespace, NAMESPACE.heartbeat); assert.deepEqual(ping.payload, { type: 'PING' });
  assert.equal(timers.pending(5000), 1);

  const stopping = session.stop();
  const stop = await socket.next();
  assert.deepEqual(stop.payload, { type: 'STOP', sessionId: 'session-1', requestId: 4 });
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 4, status: {} });
  await stopping;
  assert.deepEqual(receivers.at(-1), { appId: null, sessionId: null });

  const closes = []; session.on('close', () => closes.push(true));
  session.close(); session.close();
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(socket.destroyed);
  assert.deepEqual(closes, []);
  assert.equal(timers.pending(5000), 0);
});

test('cast session reuses a running media receiver, rejects failed loads and stops the session it loaded into', async t => {
  const { socket, session } = await connected(t);
  const loading = session.launchAndLoad({ url: 'http://192.168.1.9:4000/live/def', contentType: 'audio/flac' });
  await socket.next();
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 1, status: { applications: [application] } });
  assert.equal((await socket.next()).destinationId, 'web-7');
  const load = await socket.next();
  assert.equal(load.payload.type, 'LOAD'); assert.equal(load.payload.requestId, 2);
  socket.reply(NAMESPACE.media, { type: 'LOAD_FAILED', requestId: 2 }, 'web-7');
  await assert.rejects(loading, /load failed/);
  const stopping = session.stop();
  const stop = await socket.next();
  assert.equal(stop.namespace, NAMESPACE.receiver);
  assert.deepEqual(stop.payload, { type: 'STOP', sessionId: 'session-1', requestId: 3 });
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 3, status: {} });
  await stopping;
});

test('cast session reads the media position with GET_STATUS for the matching media session', async t => {
  const { socket, session } = await connected(t);
  const loading = session.launchAndLoad({ url: 'http://192.168.1.9:4000/live/abc', contentType: 'audio/flac' });
  await socket.next();
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 1, status: { applications: [application] } });
  await socket.next();
  await socket.next();
  socket.reply(NAMESPACE.media, { type: 'MEDIA_STATUS', requestId: 2, status: [{ mediaSessionId: 1, playerState: 'BUFFERING' }] }, 'web-7');
  await loading;

  const reading = session.mediaStatus(1);
  const request = await socket.next();
  assert.equal(request.destinationId, 'web-7'); assert.equal(request.namespace, NAMESPACE.media);
  assert.deepEqual(request.payload, { type: 'GET_STATUS', mediaSessionId: 1, requestId: 3 });
  socket.reply(NAMESPACE.media, { type: 'MEDIA_STATUS', requestId: 3, status: [{ mediaSessionId: 0, playerState: 'IDLE' }, { mediaSessionId: 1, playerState: 'PLAYING', currentTime: 12.5 }] }, 'web-7');
  assert.deepEqual(await reading, { playerState: 'PLAYING', currentTime: 12.5 });

  const missing = session.mediaStatus(9);
  const second = await socket.next();
  assert.equal(second.payload.requestId, 4);
  socket.reply(NAMESPACE.media, { type: 'MEDIA_STATUS', requestId: 4, status: [{ mediaSessionId: 0, playerState: 'IDLE' }] }, 'web-7');
  assert.equal(await missing, null);
});

test('cast session times out when the TLS handshake never completes and reports remote closure', async t => {
  const timedOut = fixture({ autoConnect: false });
  t.after(() => timedOut.session.close());
  const closes = []; timedOut.session.on('close', () => closes.push(true));
  const connecting = timedOut.session.connect();
  assert.equal(timedOut.timers.pending(10000), 1);
  assert.ok(timedOut.timers.fire(10000));
  await assert.rejects(connecting, /timed out/);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(timedOut.socket.destroyed);
  assert.deepEqual(closes, []);

  const { socket, session, timers } = await connected(t);
  const remoteCloses = []; const errors = [];
  session.on('close', () => remoteCloses.push(true)); session.on('error', error => errors.push(error));
  const loading = session.launchAndLoad({ url: 'http://192.168.1.9:4000/live/ghi', contentType: 'audio/flac' });
  await socket.next();
  socket.push(null); socket.destroy();
  await assert.rejects(loading, /closed/);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(remoteCloses, [true]);
  assert.deepEqual(errors, []);
  assert.equal(timers.pending(5000), 0);
  await assert.rejects(session.stop().then(() => session.launchAndLoad({ url: 'x', contentType: 'audio/flac' })), /not connected/);
});

test('cast session surfaces socket errors and malformed frames through the error event', async t => {
  const { socket, session, diagnostics } = await connected(t);
  const errors = []; session.on('error', error => errors.push(error.message));
  socket.emit('error', new Error('ECONNRESET'));
  assert.deepEqual(errors, ['ECONNRESET']);
  assert.deepEqual(diagnostics.map(([code]) => code), ['cast-error']);
  assert.ok(socket.destroyed);

  const malformed = await connected(t);
  const malformedErrors = []; malformed.session.on('error', error => malformedErrors.push(error));
  malformed.socket.push(Buffer.from('00000002ff', 'hex'));
  malformed.socket.push(Buffer.from('ff', 'hex'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(malformedErrors.length, 1);
  assert.ok(malformed.socket.destroyed);
});

test('cast session without a diagnostic sink skips unreadable payloads and still raises socket errors', async t => {
  const socket = new FakeSocket(); const timers = fakeTimers();
  const session = new CastSession({ host: '192.168.1.21', connect: (_options, callback) => { process.nextTick(callback); return socket; }, setTimeoutFn: timers.setTimeoutFn, clearTimeoutFn: timers.clearTimeoutFn });
  t.after(() => session.close());
  const connecting = session.connect();
  await socket.next();
  await connecting;
  const receivers = []; session.on('receiver', event => receivers.push(event));
  socket.push(encodeCastMessage({ sourceId: 'receiver-0', destinationId: 'sender-0', namespace: NAMESPACE.receiver, payloadUtf8: '{not json' }));
  socket.reply(NAMESPACE.receiver, 'not an object');
  socket.reply('urn:x-cast:com.example.unknown', { type: 'HELLO' });
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 0, status: {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(receivers, [{ appId: null, sessionId: null }], 'the session keeps reading after unreadable or foreign messages');
  assert.equal(socket.sent.length, 0);
  const errors = []; session.on('error', error => errors.push(error.message));
  socket.emit('error', new Error('ECONNRESET'));
  assert.deepEqual(errors, ['ECONNRESET']);
  assert.ok(socket.destroyed);
});

test('cast session fails requests the receiver ignores or rejects and forgets a transport the receiver closes', async t => {
  const { socket, session, timers, diagnostics } = await connected(t);
  const stream = { url: 'http://192.168.1.9:4000/live/jkl', contentType: 'audio/flac' };
  const unanswered = session.launchAndLoad(stream);
  await socket.next();
  assert.equal(timers.pending(10000), 1);
  assert.ok(timers.fire(10000));
  await assert.rejects(unanswered, /GET_STATUS timed out/);

  const rejected = session.launchAndLoad(stream);
  assert.equal((await socket.next()).payload.requestId, 2);
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 1, status: { applications: [application] } });
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 2, status: { applications: [] } });
  const launch = await socket.next();
  assert.equal(launch.payload.type, 'LAUNCH', 'a late answer to the timed-out request does not satisfy the new one');
  socket.reply(NAMESPACE.receiver, { type: 'LAUNCH_ERROR', requestId: 3, reason: 'CANCELLED' });
  await assert.rejects(rejected, /rejected the request \(CANCELLED\)/);
  assert.equal(timers.pending(10000), 0, 'settled requests release their timers');

  const stalled = session.launchAndLoad(stream);
  await socket.next();
  socket.reply(NAMESPACE.receiver, { type: 'RECEIVER_STATUS', requestId: 4, status: { applications: [application] } });
  await socket.next();
  assert.equal((await socket.next()).payload.type, 'LOAD');
  assert.equal(timers.pending(15000), 1);
  socket.reply(NAMESPACE.connection, { type: 'CLOSE' }, 'web-7');
  assert.equal(session.transportId, null);
  assert.ok(timers.fire(15000));
  await assert.rejects(stalled, /LOAD timed out/);
  assert.equal(await session.mediaStatus(1), null, 'a closed media connection has no status to ask for');
  await assert.rejects(session.request(NAMESPACE.media, null, { type: 'GET_STATUS' }, 10000), /not connected/);
  assert.equal(timers.pending(10000), 0, 'a request without a destination leaves no pending timer');
  assert.equal(socket.sent.length, 0);
  assert.deepEqual(diagnostics, [['cast-connection-closed', 'web-7']]);
});
