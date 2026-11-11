const tls = require('node:tls');
const { EventEmitter } = require('node:events');

const NAMESPACE = {
  connection: 'urn:x-cast:com.google.cast.tp.connection',
  heartbeat: 'urn:x-cast:com.google.cast.tp.heartbeat',
  receiver: 'urn:x-cast:com.google.cast.receiver',
  media: 'urn:x-cast:com.google.cast.media'
};
const SENDER_ID = 'sender-0';
const RECEIVER_ID = 'receiver-0';
const DEFAULT_MEDIA_RECEIVER = 'CC1AD845';
const CONNECT_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 10000;
const LOAD_TIMEOUT_MS = 15000;
const PING_INTERVAL_MS = 5000;
const MAX_BUFFERED_BYTES = 1024 * 1024;

// Minimal protobuf codec for CastMessage (castv2): protocol_version(1) varint, source_id(2), destination_id(3),
// namespace(4) strings, payload_type(5) varint, payload_utf8(6) string, payload_binary(7) bytes.
function varint(value) {
  const bytes = [];
  while (value > 0x7f) { bytes.push((value % 0x80) | 0x80); value = Math.floor(value / 0x80); }
  bytes.push(value);
  return bytes;
}
function varintField(number, value) { return Buffer.from([...varint(number * 8), ...varint(value)]); }
function bytesField(number, data) { return Buffer.concat([Buffer.from([...varint(number * 8 + 2), ...varint(data.length)]), data]); }
function readVarint(buffer, offset) {
  let value = 0; let scale = 1;
  for (let index = 0; index < 10; index++) {
    if (offset >= buffer.length) throw new RangeError('Truncated Cast message');
    const byte = buffer[offset++];
    value += (byte & 0x7f) * scale;
    if (!(byte & 0x80)) return { value, offset };
    scale *= 0x80;
  }
  throw new RangeError('Malformed Cast message');
}
function encodeCastMessage({ protocolVersion = 0, sourceId, destinationId, namespace, payloadType = 0, payloadUtf8 = '' }) {
  const body = Buffer.concat([
    varintField(1, protocolVersion),
    bytesField(2, Buffer.from(sourceId, 'utf8')),
    bytesField(3, Buffer.from(destinationId, 'utf8')),
    bytesField(4, Buffer.from(namespace, 'utf8')),
    varintField(5, payloadType),
    bytesField(6, Buffer.from(payloadUtf8, 'utf8'))
  ]);
  const frame = Buffer.allocUnsafe(4 + body.length);
  frame.writeUInt32BE(body.length, 0); body.copy(frame, 4);
  return frame;
}
function decodeCastMessage(buffer) {
  const message = { protocolVersion: 0, sourceId: '', destinationId: '', namespace: '', payloadType: 0, payloadUtf8: '' };
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset); offset = tag.offset;
    const number = Math.floor(tag.value / 8); const wireType = tag.value % 8;
    if (wireType === 0) {
      const field = readVarint(buffer, offset); offset = field.offset;
      if (number === 1) message.protocolVersion = field.value; else if (number === 5) message.payloadType = field.value;
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset); offset = length.offset;
      if (offset + length.value > buffer.length) throw new RangeError('Truncated Cast message');
      const data = buffer.subarray(offset, offset + length.value); offset += length.value;
      if (number === 2) message.sourceId = data.toString('utf8');
      else if (number === 3) message.destinationId = data.toString('utf8');
      else if (number === 4) message.namespace = data.toString('utf8');
      else if (number === 6) message.payloadUtf8 = data.toString('utf8');
      else if (number === 7) message.payloadBinary = Buffer.from(data);
    } else if (wireType === 1) offset += 8;
    else if (wireType === 5) offset += 4;
    else throw new RangeError('Malformed Cast message');
  }
  return message;
}
// Splits length-prefixed frames (4 byte big-endian length + CastMessage) and returns the unconsumed remainder.
function decodeCastMessages(buffer) {
  const messages = []; let offset = 0;
  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32BE(offset);
    if (buffer.length - offset - 4 < length) break;
    messages.push(decodeCastMessage(buffer.subarray(offset + 4, offset + 4 + length)));
    offset += 4 + length;
  }
  return { messages, rest: buffer.subarray(offset) };
}

class CastSession extends EventEmitter {
  constructor({ host, port = 8009, connect = tls.connect, onDiagnostic = () => {}, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    super();
    Object.assign(this, { host, port, connectFn: connect, onDiagnostic, setTimeoutFn, clearTimeoutFn });
    this.socket = null; this.closed = false; this.buffer = Buffer.alloc(0);
    this.requestId = 0; this.pending = new Map(); this.pingTimer = null;
    this.appId = null; this.sessionId = null; this.transportId = null;
  }
  async connect() {
    if (this.socket) throw new Error('Cast session already connected');
    const secured = withResolvers();
    const socket = this.connectFn({ host: this.host, port: this.port, rejectUnauthorized: false }, () => secured.resolve());
    this.socket = socket;
    socket.on('data', chunk => this.receiveData(chunk));
    socket.on('error', error => { secured.reject(error); this.fail(error); });
    socket.on('close', () => { secured.reject(new Error('Cast connection closed')); this.failPending(new Error('Cast connection closed')); if (!this.closed) { this.closed = true; this.stopPing(); this.emit('close'); } });
    const timer = this.setTimeoutFn(() => secured.reject(new Error('Cast connection timed out')), CONNECT_TIMEOUT_MS);
    try { await secured.promise; } catch (error) { this.close(); throw error; } finally { this.clearTimeoutFn(timer); }
    this.send(NAMESPACE.connection, RECEIVER_ID, { type: 'CONNECT' });
    this.schedulePing();
  }
  async launchAndLoad({ url, contentType }) {
    const status = await this.request(NAMESPACE.receiver, RECEIVER_ID, { type: 'GET_STATUS' }, REQUEST_TIMEOUT_MS);
    let application = findApplication(status);
    if (!application) {
      const launched = await this.request(NAMESPACE.receiver, RECEIVER_ID, { type: 'LAUNCH', appId: DEFAULT_MEDIA_RECEIVER }, REQUEST_TIMEOUT_MS);
      application = findApplication(launched);
      if (!application) throw new Error('Cast receiver did not launch the media receiver');
    }
    this.appId = application.appId; this.sessionId = application.sessionId; this.transportId = application.transportId;
    this.send(NAMESPACE.connection, this.transportId, { type: 'CONNECT' });
    const media = await this.request(NAMESPACE.media, this.transportId, { type: 'LOAD', media: { contentId: url, contentType, streamType: 'LIVE' }, autoplay: true }, LOAD_TIMEOUT_MS);
    return { appId: this.appId, sessionId: this.sessionId, transportId: this.transportId, playerState: media.status?.[0]?.playerState ?? null };
  }
  // The media receiver this stream was loaded into is ours to stop, whether or not this sender launched it.
  async stop() {
    if (!this.socket || this.closed || !this.sessionId) return;
    await this.request(NAMESPACE.receiver, RECEIVER_ID, { type: 'STOP', sessionId: this.sessionId }, REQUEST_TIMEOUT_MS);
  }
  // Playback position of one media session; a LIVE stream counts currentTime from the start of the stream.
  async mediaStatus(mediaSessionId) {
    // The receiver closed the media connection, so there is no session left to ask.
    if (!this.transportId) return null;
    const payload = await this.request(NAMESPACE.media, this.transportId, { type: 'GET_STATUS', mediaSessionId }, REQUEST_TIMEOUT_MS);
    const status = (Array.isArray(payload.status) ? payload.status : []).find(entry => entry?.mediaSessionId === mediaSessionId) ?? null;
    return status ? { playerState: status.playerState ?? null, currentTime: Number.isFinite(status.currentTime) ? status.currentTime : null } : null;
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.stopPing();
    this.failPending(new Error('Cast session closed'));
    this.socket?.destroy();
  }
  send(namespace, destinationId, payload) {
    if (this.closed || !this.socket) return;
    this.socket.write(encodeCastMessage({ sourceId: SENDER_ID, destinationId, namespace, payloadUtf8: JSON.stringify(payload) }));
  }
  request(namespace, destinationId, payload, timeoutMs) {
    if (this.closed || !this.socket || !destinationId) return Promise.reject(new Error('Cast session is not connected'));
    const requestId = ++this.requestId;
    const { promise, resolve, reject } = withResolvers();
    const timer = this.setTimeoutFn(() => this.settle(requestId, null, new Error(`Cast ${payload.type} timed out`)), timeoutMs);
    this.pending.set(requestId, { resolve, reject, timer });
    this.send(namespace, destinationId, { ...payload, requestId });
    return promise;
  }
  settle(requestId, result, error) {
    const entry = this.pending.get(requestId);
    if (!entry) return;
    this.pending.delete(requestId); this.clearTimeoutFn(entry.timer);
    if (error) entry.reject(error); else entry.resolve(result);
  }
  failPending(error) { for (const requestId of Array.from(this.pending.keys())) this.settle(requestId, null, error); }
  fail(error) {
    this.onDiagnostic('cast-error', error);
    if (!this.closed && this.listenerCount('error')) this.emit('error', error);
    this.close();
  }
  schedulePing() {
    this.pingTimer = this.setTimeoutFn(() => { this.send(NAMESPACE.heartbeat, RECEIVER_ID, { type: 'PING' }); this.schedulePing(); }, PING_INTERVAL_MS);
  }
  stopPing() { if (this.pingTimer !== null) { this.clearTimeoutFn(this.pingTimer); this.pingTimer = null; } }
  receiveData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_BUFFERED_BYTES) { this.fail(new Error('Cast message too large')); return; }
    let decoded;
    try { decoded = decodeCastMessages(this.buffer); } catch (error) { this.fail(error); return; }
    this.buffer = decoded.rest;
    for (const message of decoded.messages) this.receive(message);
  }
  receive(message) {
    if (message.payloadType !== 0) return;
    let payload;
    try { payload = JSON.parse(message.payloadUtf8); } catch { this.onDiagnostic('cast-invalid-payload', message.namespace); return; }
    if (!payload || typeof payload !== 'object') return;
    switch (message.namespace) {
      case NAMESPACE.heartbeat:
        if (payload.type === 'PING') this.send(NAMESPACE.heartbeat, message.sourceId, { type: 'PONG' });
        return;
      case NAMESPACE.connection:
        if (payload.type === 'CLOSE') { this.onDiagnostic('cast-connection-closed', message.sourceId); if (message.sourceId === this.transportId) this.transportId = null; }
        return;
      case NAMESPACE.receiver:
        if (payload.type === 'RECEIVER_STATUS') {
          const application = payload.status?.applications?.[0];
          this.emit('receiver', { appId: application?.appId ?? null, sessionId: application?.sessionId ?? null });
          this.settle(payload.requestId, payload, null);
        } else if (payload.type === 'LAUNCH_ERROR' || payload.type === 'INVALID_REQUEST') {
          this.settle(payload.requestId, null, new Error(`Cast receiver rejected the request (${payload.reason ?? payload.type})`));
        }
        return;
      case NAMESPACE.media:
        if (payload.type === 'MEDIA_STATUS') {
          // One status per media session the receiver still reports; idleReason is present only once an item has ended.
          for (const status of Array.isArray(payload.status) ? payload.status : []) {
            if (status?.playerState) this.emit('media', { playerState: status.playerState, idleReason: status.idleReason ?? null, mediaSessionId: status.mediaSessionId ?? null, contentId: status.media?.contentId ?? null });
          }
          this.settle(payload.requestId, payload, null);
        } else if (['LOAD_FAILED', 'LOAD_CANCELLED', 'INVALID_REQUEST', 'INVALID_PLAYER_STATE'].includes(payload.type)) {
          this.settle(payload.requestId, null, new Error(`Cast media load failed (${payload.type})`));
        }
        return;
      default:
        return;
    }
  }
}

function findApplication(status) { return status.status?.applications?.find(application => application.appId === DEFAULT_MEDIA_RECEIVER) ?? null; }
function withResolvers() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

module.exports = { CastSession, encodeCastMessage, decodeCastMessages, NAMESPACE, DEFAULT_MEDIA_RECEIVER };
