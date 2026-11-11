const http = require('node:http');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { isLanAddress } = require('./network-music-upnp.cjs');
const { LIVE_PCM_TYPE, LIVE_CONNECTION_HEADER, LIVE_PATH, FEEDBACK_PATH, MAX_FEEDBACK_BYTES,
  MAX_REPORT_INTERVAL_MS, readFeedbackRequest } = require('./network-output-live.cjs');

const SAMPLE_RATE = 44100;
const CHANNEL_COUNT = 2;
const DLNA_FEATURES = 'DLNA.ORG_OP=00;DLNA.ORG_FLAGS=01700000000000000000000000000000';
const WAV_MIME_TYPE = 'audio/wav';
const MAX_TIMED_PACKETS = 512;
const MAX_ENCODER_QUEUED_FRAMES = SAMPLE_RATE * 2;
// Silence sent ahead of the live audio so a Chromecast receiver starts with a full player buffer. The receiver plays
// it in real time, so it adds to the measured Cast latency that the local delay follows. Shorter prerolls (1-1.5 s)
// let some receivers stall for about 8 s right after starting; 2 s did not in the trials.
const WAV_PREROLL_FRAMES = SAMPLE_RATE * 2;

let mediabunnyPromise = null;
// Mediabunny and its FLAC encoder are ESM-only, so the CommonJS main process loads them lazily once.
function loadMediabunny() {
  mediabunnyPromise ||= Promise.all([import('mediabunny'), import('@mediabunny/flac-encoder')])
    .then(([mediabunny, flac]) => { flac.registerFlacEncoder(); return mediabunny; })
    .catch(error => { mediabunnyPromise = null; throw error; });
  return mediabunnyPromise;
}

// Encodes 44.1 kHz / 16 bit / stereo interleaved PCM into an endless FLAC stream. The output is never finalized, so
// the STREAMINFO block keeps an unknown length; only the monotonically growing tail of the file reaches onData.
async function createFlacEncoder({ onData, onError = () => {}, load = loadMediabunny }) {
  const { Output, FlacOutputFormat, StreamTarget, AudioSampleSource, AudioSample } = await load();
  let sent = 0; let frames = 0; let closed = false; let processing = false; let queuedFrames = 0;
  const queue = [];
  const writable = new WritableStream({ write(chunk) {
    if (closed) return;
    const end = chunk.position + chunk.data.length;
    if (end <= sent) return;
    onData(Buffer.from(chunk.position < sent ? chunk.data.subarray(sent - chunk.position) : chunk.data));
    sent = end;
  } });
  const output = new Output({ format: new FlacOutputFormat({ appendOnly: true }), target: new StreamTarget(writable, { chunked: false }) });
  const source = new AudioSampleSource({ codec: 'flac' });
  output.addAudioTrack(source);
  await output.start();
  async function drain() {
    if (processing) return;
    processing = true;
    while (queue.length) {
      if (closed) break;
      const { samples, timestamp } = queue.shift();
      const sample = new AudioSample({ data: samples, format: 's16', numberOfChannels: CHANNEL_COUNT, sampleRate: SAMPLE_RATE, timestamp });
      try { await source.add(sample); } catch (error) { if (!closed) onError(error); } finally {
        sample.close();
        queuedFrames -= samples.length / CHANNEL_COUNT;
      }
    }
    processing = false;
    if (closed) await output.cancel().catch(() => {});
  }
  return {
    write(samples) {
      if (closed) return false;
      const count = samples.length / CHANNEL_COUNT;
      if (queuedFrames + count > MAX_ENCODER_QUEUED_FRAMES) return false;
      queue.push({ samples: samples.slice(), timestamp: frames / SAMPLE_RATE });
      frames += count;
      queuedFrames += count;
      void drain();
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      queue.length = 0;
      if (!processing) void output.cancel().catch(() => {});
    }
  };
}

// Writes the same PCM as an endless RIFF/WAVE stream: a header with unknown (0xFFFFFFFF) sizes followed by raw
// little-endian samples. Chromecast's media pipeline reads in 32 KiB blocks and FLAC compresses quiet or silent
// audio to a few hundred bytes per second, which stalls it; the constant 176 kB/s of LPCM keeps it fed. Without a
// pre-roll the receiver starts, underruns at once and pauses for about 8 s to refill, ending up that far behind.
function createWavEncoder({ onData }) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'latin1'); header.writeUInt32LE(0xffffffff, 4); header.write('WAVEfmt ', 8, 'latin1');
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(CHANNEL_COUNT, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * CHANNEL_COUNT * 2, 28);
  header.writeUInt16LE(CHANNEL_COUNT * 2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36, 'latin1'); header.writeUInt32LE(0xffffffff, 40);
  let closed = false; let frames = WAV_PREROLL_FRAMES;
  onData(header);
  onData(Buffer.alloc(WAV_PREROLL_FRAMES * CHANNEL_COUNT * 2));
  return {
    write(samples) {
      if (closed) return;
      // Int16Array views are already little-endian on every desktop platform the app runs on; copy so the caller may reuse the block.
      onData(Buffer.from(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)));
      frames += samples.length / CHANNEL_COUNT;
    },
    close() { closed = true; },
    // Stream position in frames, pre-roll included: what the receiver's reported currentTime is measured against.
    get frames() { return frames; }
  };
}

function createEncoder({ contentType, ...options }) {
  return contentType === WAV_MIME_TYPE ? createWavEncoder(options) : createFlacEncoder(options);
}

class LiveStream extends EventEmitter {
  constructor(server, contentType) {
    super();
    this.server = server; this.contentType = contentType;
    this.token = crypto.randomBytes(16).toString('hex');
    this.connection = null; this.closed = false;
  }
  url(hostAddress) { return `http://${hostAddress}:${this.server.port}/live/${this.token}`; }
  get connected() { return Boolean(this.connection?.encoder || this.connection?.pcm); }
  // Frames handed to the receiver by a sender-clock instant on a WAV stream; null before it connects and for FLAC,
  // which has no position. Audio arrives in packets, so the position continues from the last write at the stream rate.
  framesAt(timeMs) {
    const connection = this.connection;
    const frames = connection?.encoder?.frames;
    return Number.isFinite(frames) ? frames + (timeMs - connection.writtenAt) * SAMPLE_RATE / 1000 : null;
  }
  write(samples, timing = []) {
    const connection = this.connection;
    if (!connection?.pcm) {
      if (!connection?.encoder) return;
      connection.writtenAt = this.server.clockNow();
      if (connection.encoder.write(samples) === false && connection.active) {
        this.drop(connection, false);
        this.emit('overflow');
      }
      return;
    }
    const start = connection.frames;
    connection.frames += samples.length / CHANNEL_COUNT;
    const writtenAt = this.server.clockNow();
    connection.timeline.push({ start, end: connection.frames, writtenAt, timing });
    if (connection.timeline.length > MAX_TIMED_PACKETS) connection.timeline.shift();
    this.send(connection, Buffer.from(new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength)));
  }
  close() {
    if (this.closed) return;
    this.closed = true; this.server.streams.delete(this.token);
    this.drop(this.connection, false);
  }
  // A new GET replaces the previous connection silently; the receiver re-fetching is not a disconnect.
  async attach(res, { pcm = false, remote } = {}) {
    const connection = { res, encoder: null, active: true, pcm, remote, id: crypto.randomBytes(16).toString('hex'),
      frames: 0, timeline: [], probe: null, receiverId: null, report: null };
    if (pcm) res.setHeader(LIVE_CONNECTION_HEADER, connection.id);
    res.flushHeaders();
    this.drop(this.connection, false);
    this.connection = connection;
    res.on('close', () => this.drop(connection, true));
    if (pcm) {
      this.emit('connected');
      return;
    }
    let encoder;
    try {
      encoder = await this.server.encoderFactory({ contentType: this.contentType, onData: data => this.send(connection, data), onError: error => { this.server.onDiagnostic('encoder-error', error); this.drop(connection, true); } });
    } catch (error) {
      this.server.onDiagnostic('encoder-unavailable', error);
      this.drop(connection, false); return;
    }
    if (!connection.active) { encoder.close(); return; }
    connection.encoder = encoder; connection.writtenAt = this.server.clockNow();
    this.emit('connected');
  }
  feedback(remote, request) {
    const connection = this.connection;
    if (!connection?.pcm || connection.id !== request.connectionId || connection.remote !== remote ||
        (connection.receiverId !== null && connection.receiverId !== request.sessionId)) return null;
    const now = this.server.clockNow();
    if (!request.probeId) {
      connection.receiverId = request.sessionId;
      const probeId = crypto.randomBytes(16).toString('hex');
      connection.probe = { probeId, startedAt: now };
      return { probeId };
    }
    const probe = connection.probe;
    if (!probe || probe.probeId !== request.probeId) return null;
    connection.probe = null;
    const elapsed = now - probe.startedAt;
    const previous = connection.report;
    if (elapsed < 0 || elapsed > MAX_REPORT_INTERVAL_MS || request.positionFrames > connection.frames ||
        (previous && (request.positionFrames <= previous.positionFrames || request.revision < previous.revision))) return null;
    connection.report = request;

    // The receiver samples after the probe and before the reply. Both ends of this interval use the sender's clock.
    const frame = Math.floor(request.positionFrames) - 1;
    const packet = connection.timeline.findLast(entry => frame >= entry.start && frame < entry.end);
    const frameOffset = packet ? frame - packet.start : -1;
    const source = packet?.timing.find(entry => frameOffset >= entry.offset && frameOffset < entry.offset + entry.frames);
    const tapAt = source ? source.firstFrameTimeMs + (frameOffset - source.offset) * source.frameDurationMs : null;
    const sampledAt = probe.startedAt + elapsed / 2;
    this.emit('feedback', { ...request, receivedAt: now,
      routeRevision: source?.revision ?? null,
      transportMs: packet ? sampledAt - packet.writtenAt : null,
      ingressMs: source ? packet.writtenAt - tapAt - source.delayFrames * 1000 / SAMPLE_RATE : null,
      uncertaintyMs: elapsed / 2 + (source?.uncertaintyMs ?? 0)
    });
    return {};
  }
  send(connection, data) {
    if (!connection.active) return;
    connection.res.write(data);
    if (connection.res.writableLength > this.server.maxQueuedBytes) { this.drop(connection, false); this.emit('overflow'); }
  }
  drop(connection, disconnected) {
    if (!connection?.active) return;
    connection.active = false;
    connection.encoder?.close();
    if (!connection.res.destroyed) connection.res.destroy();
    if (this.connection === connection) {
      this.connection = null;
      if (connection.pcm) this.emit('feedback-ended');
    }
    if (disconnected) this.emit('disconnected');
  }
}

class LiveStreamServer extends EventEmitter {
  constructor({ onDiagnostic = () => {}, maxQueuedBytes = 2 * 1024 * 1024, encoderFactory = createEncoder,
    clockNow = () => performance.now() } = {}) {
    super();
    Object.assign(this, { onDiagnostic, maxQueuedBytes, encoderFactory, clockNow });
    this.server = null; this.opening = null; this.streams = new Map();
  }
  get port() { return this.server?.address()?.port ?? 0; }
  open() {
    this.opening ||= this.listen().catch(error => { this.opening = null; throw error; });
    return this.opening;
  }
  async listen() {
    const server = http.createServer((req, res) => this.handle(req, res));
    server.requestTimeout = 10000; server.headersTimeout = 10000; server.maxHeadersCount = 32;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '0.0.0.0', () => { server.removeListener('error', reject); resolve(); }); });
    server.on('error', error => this.onDiagnostic('server-error', error));
    this.server = server;
  }
  async close() {
    const opening = this.opening; this.opening = null;
    if (opening) await opening.catch(() => {});
    for (const stream of Array.from(this.streams.values())) stream.close();
    const server = this.server; this.server = null;
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
  createStream({ contentType = 'audio/flac' } = {}) {
    const stream = new LiveStream(this, contentType);
    this.streams.set(stream.token, stream);
    return stream;
  }
  handle(req, res) {
    const remote = req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '';
    if (!isLanAddress(remote)) { res.writeHead(403); res.end(); return; }
    const path = req.url?.split('?')[0] ?? '';
    const feedback = FEEDBACK_PATH.exec(path);
    const match = feedback ?? LIVE_PATH.exec(path);
    const stream = match && this.streams.get(match[1]);
    if (!stream) { res.writeHead(404); res.end(); return; }
    if (feedback) { this.handleFeedback(req, res, remote, stream); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    const pcm = stream.contentType !== WAV_MIME_TYPE && req.headers.accept === LIVE_PCM_TYPE;
    // No Content-Length and no chunked encoding: the body runs until the connection closes (Range requests are ignored).
    res.useChunkedEncodingByDefault = false; res.sendDate = false;
    res.setHeader('Content-Type', pcm ? LIVE_PCM_TYPE : stream.contentType);
    res.setHeader('contentFeatures.dlna.org', DLNA_FEATURES);
    res.setHeader('transferMode.dlna.org', 'Streaming');
    res.setHeader('Connection', 'close');
    res.setHeader('Cache-Control', 'no-cache');
    if (req.method === 'HEAD') { res.writeHead(200); res.end(); return; }
    // Node only sends headers with the first body chunk; receivers expect them before the encoder produces data.
    void stream.attach(res, { pcm, remote });
  }
  handleFeedback(req, res, remote, stream) {
    const finish = status => { res.writeHead(status, { Connection: 'close', 'Cache-Control': 'no-store' }); res.end(); };
    if (req.method !== 'POST') { finish(405); return; }
    if (req.headers['content-type'] !== 'application/json' ||
        !Number.isInteger(Number(req.headers['content-length'])) || Number(req.headers['content-length']) < 1 ||
        Number(req.headers['content-length']) > MAX_FEEDBACK_BYTES) { finish(400); return; }
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('error', () => res.destroy());
    req.on('end', () => {
      let request;
      try { request = readFeedbackRequest(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (_) { /* Invalid JSON is handled like other invalid feedback. */ }
      if (!request) { finish(400); return; }
      const result = stream.feedback(remote, request);
      if (!result) { finish(409); return; }
      if (!result.probeId) { finish(204); return; }
      res.writeHead(200, { 'Content-Type': 'application/json', Connection: 'close', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(result));
    });
  }
}

module.exports = { LiveStreamServer, LiveStream, createEncoder, createFlacEncoder, createWavEncoder, DLNA_FEATURES, WAV_MIME_TYPE };
