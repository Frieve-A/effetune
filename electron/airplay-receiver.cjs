const fs = require('node:fs');
const path = require('node:path');
const dgram = require('node:dgram');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { L16RtpReceiver, SAMPLE_RATE, CHANNEL_COUNT } = require('./airplay-rtp.cjs');

const MAX_QUEUED_FRAMES = SAMPLE_RATE;
const STOP_TIMEOUT_MS = 1500;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024;
const METADATA_FIELDS = new Map(Object.entries({
  Title: 'title', Artist: 'artist', Album: 'album', 'Album artist': 'albumArtist', Composer: 'composer',
  Genre: 'genre', Comment: 'comment', 'Content description': 'contentDescription', Category: 'category',
  Description: 'description', Format: 'format', Keywords: 'keywords', 'Long Content Description': 'longContentDescription',
  'Sort Artist': 'sortArtist', 'Sort Composer': 'sortComposer', 'Sort Album artist': 'sortAlbumArtist',
  'Sort Name': 'sortName', 'Sort Series': 'sortSeries', 'Sort Album': 'sortAlbum'
}));
// The pinned UxPlay producer writes this transparent placeholder instead of cover art.
const EMPTY_ARTWORK = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001010300000025db56ca00000003504c5445000000a77a3dda0000000174524e530040e6d8660000000a4944415408d76360000000020001e221bc330000000049454e44ae426082', 'hex');

function emptyInformation() {
  return { position: null, duration: null, metadata: {}, sender: {},
    format: { sampleRate: SAMPLE_RATE, channels: CHANNEL_COUNT, bitsPerSample: 16 } };
}

function parseMetadata(bytes) {
  if (!bytes.length || bytes.at(-1) !== 0 || bytes.subarray(0, -1).includes(0)) return null;
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, -1)); }
  catch (_) { return null; }
  const metadata = {};
  let key;
  for (const line of text.split('\n')) {
    const separator = line.indexOf(': ');
    const field = METADATA_FIELDS.get(line.slice(0, separator));
    if (separator >= 0 && field) { key = field; metadata[key] = line.slice(separator + 2); }
    else if (key && line) metadata[key] += `\n${line}`;
  }
  for (const field of Object.keys(metadata)) {
    metadata[field] = metadata[field].trim();
    if (!metadata[field]) delete metadata[field];
  }
  return metadata;
}

function artworkType(bytes) {
  if (bytes.length >= 20 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
      bytes.subarray(-12).equals(Buffer.from('0000000049454e44ae426082', 'hex'))) return 'image/png';
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
      bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9) return 'image/jpeg';
  return null;
}

class AirPlayReceiverHost {
  constructor({ executablePath, resourceDirectory, onDiagnostic = () => {}, onStatus = () => {},
    registryPath = path.join(os.tmpdir(), 'effetune-airplay-gstreamer.bin'),
    processFactory = spawn, socketFactory = () => dgram.createSocket('udp4'), fileSystem = fs,
    now = Date.now, setIntervalFn = setInterval, clearIntervalFn = clearInterval } = {}) {
    this.executablePath = executablePath;
    this.resourceDirectory = resourceDirectory;
    this.registryPath = registryPath;
    this.onDiagnostic = onDiagnostic;
    this.onStatus = onStatus;
    this.processFactory = processFactory;
    this.socketFactory = socketFactory;
    this.fileSystem = fileSystem;
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.enabled = false;
    this.friendlyName = 'EffeTune';
    this.environmentAvailable = true;
    this.rendererPort = null;
    this.child = null;
    this.socket = null;
    this.timer = null;
    this.generation = 0;
    this.state = 'off';
    this.disposed = false;
    this.operation = Promise.resolve();
    this.queue = [];
    this.queuedFrames = 0;
    this.inFlight = false;
    this.sessionStarted = false;
    this.receiver = null;
    this.senderPort = null;
    this.helperOutputBuffer = '';
    this.helperOutputDecoder = new StringDecoder('utf8');
    this.information = emptyInformation();
    this.artwork = null;
    this.artifacts = null;
    this.artifactCleanup = Promise.resolve();
  }

  getStatus() {
    return Object.freeze({ enabled: this.enabled, available: this.isAvailable(), state: this.state,
      receiving: this.state === 'receiving' });
  }

  isAvailable() {
    try { return this.fileSystem.statSync(this.executablePath).isFile() &&
      this.fileSystem.statSync(path.join(this.resourceDirectory, 'uxplay.conf')).isFile(); }
    catch (_) { return false; }
  }

  publishStatus(state = this.state) {
    this.state = state;
    this.onStatus(this.getStatus());
  }

  enqueue(callback) {
    const next = this.operation.then(callback);
    this.operation = next.catch(error => {
      this.onDiagnostic('airplay-lifecycle-failed', error);
      this.publishStatus('failed');
    });
    return this.operation.then(() => this.getStatus());
  }

  setConfiguration({ enabled, friendlyName = 'EffeTune' } = {}) {
    if (typeof enabled !== 'boolean' || typeof friendlyName !== 'string' ||
        friendlyName.length > 128 || /[\r\n\0]/.test(friendlyName)) return Promise.reject(new TypeError('Invalid AirPlay configuration'));
    const name = friendlyName.trim() || 'EffeTune';
    return this.enqueue(async () => {
      if (this.disposed) return this.getStatus();
      const changed = this.enabled !== enabled || this.friendlyName !== name;
      this.enabled = enabled;
      this.friendlyName = name;
      if (changed) await this.stopChild();
      await this.reconcile();
      return this.getStatus();
    });
  }

  setEnvironmentAvailable(available) {
    return this.enqueue(async () => {
      this.environmentAvailable = available === true;
      if (!this.environmentAvailable) await this.stopChild();
      await this.reconcile();
      return this.getStatus();
    });
  }

  attachRendererPort(port) {
    return this.enqueue(async () => {
      await this.stopChild();
      this.detachRendererPort();
      if (this.disposed) { port?.close(); return; }
      this.rendererPort = port;
      this.portMessageListener = event => this.handlePortMessage(event?.data ?? event);
      this.portCloseListener = () => { if (this.rendererPort === port) void this.setRendererUnavailable(); };
      port.on('message', this.portMessageListener);
      port.on('close', this.portCloseListener);
      port.start();
      await this.reconcile();
    });
  }

  detachRendererPort() {
    const port = this.rendererPort;
    this.rendererPort = null;
    if (!port) return;
    port.removeListener('message', this.portMessageListener);
    port.removeListener('close', this.portCloseListener);
    port.close();
  }

  setRendererUnavailable() {
    return this.enqueue(async () => {
      await this.stopChild();
      this.detachRendererPort();
      this.publishStatus(this.enabled ? 'unavailable' : 'off');
    });
  }

  stopSession() {
    return this.enqueue(async () => {
      await this.stopChild();
      await this.reconcile();
      return this.getStatus();
    });
  }

  async reconcile() {
    if (this.disposed || !this.enabled) { this.publishStatus('off'); return; }
    if (!this.environmentAvailable || !this.rendererPort || !this.isAvailable()) {
      this.publishStatus('unavailable'); return;
    }
    if (this.child) return;
    this.publishStatus('starting');
    const socket = this.socketFactory();
    this.socket = socket;
    await new Promise((resolve, reject) => {
      const failed = error => { socket.removeListener('listening', listening); reject(error); };
      const listening = () => { socket.removeListener('error', failed); resolve(); };
      socket.once('error', failed);
      socket.once('listening', listening);
      socket.bind(0, '127.0.0.1');
    }).catch(error => { this.closeSocket(); throw error; });
    const generation = ++this.generation;
    this.information = emptyInformation();
    this.artwork = null;
    this.helperOutputBuffer = '';
    this.helperOutputDecoder = new StringDecoder('utf8');
    this.sessionEnding = false;
    this.receiver = new L16RtpReceiver({
      onPcm: chunk => this.acceptPcm(chunk, generation),
      onReset: startFrame => this.resetPcm(startFrame, generation),
      onDiagnostic: code => this.onDiagnostic(code)
    });
    socket.on('message', (bytes, remote) => {
      if (this.socket !== socket || generation !== this.generation || remote.address !== '127.0.0.1' ||
          (this.senderPort !== null && remote.port !== this.senderPort)) return;
      if (this.receiver.push(bytes, this.now()) && this.senderPort === null) this.senderPort = remote.port;
    });
    socket.on('error', error => {
      this.onDiagnostic('airplay-socket-failed', error);
      void this.enqueue(async () => { await this.stopChild(); this.publishStatus('failed'); });
    });
    try {
      const directory = this.fileSystem.mkdtempSync(path.join(os.tmpdir(), 'effetune-airplay-'));
      this.artifacts = { directory, generation, metadata: null, artwork: null, candidate: null, lastPoll: 0, pending: null };
    } catch (error) { this.closeSocket(); throw error; }
    const args = ['-n', this.friendlyName, '-nh', '-vs', '0', '-rc', path.join(this.resourceDirectory, 'uxplay.conf'),
      '-md', path.join(this.artifacts.directory, 'metadata.txt'), '-ca', path.join(this.artifacts.directory, 'artwork'),
      '-artp', `pt=96 ! udpsink host=127.0.0.1 port=${socket.address().port}`];
    const env = { ...process.env,
      PATH: [this.resourceDirectory, path.join(this.resourceDirectory, 'bin'), process.env.PATH || ''].join(path.delimiter),
      GST_PLUGIN_PATH_1_0: path.join(this.resourceDirectory, 'plugins'),
      GST_PLUGIN_SYSTEM_PATH_1_0: '', GST_REGISTRY_FORK: 'no', GST_REGISTRY_1_0: this.registryPath };
    let child;
    try {
      child = this.processFactory(this.executablePath, args, { cwd: this.resourceDirectory,
        env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) { this.closeSocket(); await this.cleanupArtifacts(); throw error; }
    this.child = child;
    child.once('spawn', () => { if (this.child === child) this.publishStatus('ready'); });
    child.on('error', error => {
      this.onDiagnostic('airplay-helper-failed', error);
      if (this.child === child) { this.finishSession(); this.closeSocket(); void this.cleanupArtifacts(); this.publishStatus('failed'); }
    });
    const terminated = (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.finishSession();
      this.closeSocket();
      void this.cleanupArtifacts();
      if (this.stoppingChild !== child) {
        this.onDiagnostic('airplay-helper-exited', { code, signal });
        this.publishStatus(this.enabled && !this.disposed ? 'failed' : 'off');
      }
    };
    child.once('exit', terminated);
    child.once('close', terminated);
    child.stdout?.on('data', bytes => this.handleHelperOutput(bytes, generation));
    child.stderr?.on('data', bytes => {
      if (generation === this.generation) this.onDiagnostic('airplay-helper-output', String(bytes).slice(0, 2048));
    });
    this.timer = this.setIntervalFn(() => {
      this.receiver?.flush(this.now());
      const artifacts = this.artifacts;
      if (artifacts && this.now() - artifacts.lastPoll >= 250) void this.readArtifacts();
    }, 20);
    this.timer?.unref?.();
  }

  handleHelperOutput(bytes, generation) {
    if (generation !== this.generation) return;
    // The pinned producer exposes the backend's existing connection count at INFO level.
    // Silence alone cannot distinguish a paused sender from a disconnected session.
    this.helperOutputBuffer += this.helperOutputDecoder.write(Buffer.isBuffer(bytes) ? bytes : Buffer.from(String(bytes)));
    let boundary;
    // UxPlay progress uses CR; lifecycle logs use LF, including CRLF on Windows.
    while ((boundary = this.helperOutputBuffer.search(/[\r\n]/)) >= 0) {
      const line = this.helperOutputBuffer.slice(0, boundary).trim();
      this.helperOutputBuffer = this.helperOutputBuffer.slice(boundary + 1);
      if (line && !this.handleInformationRecord(line)) this.onDiagnostic('airplay-helper-output', line.slice(0, 2048));
      if (line === 'Open connections: 0' && this.sessionStarted && !this.sessionEnding) {
        this.sessionEnding = true;
        void this.enqueue(async () => {
          if (generation !== this.generation) return;
          await this.stopChild();
          await this.reconcile();
        });
      }
    }
    if (this.helperOutputBuffer.length > 4096) {
      this.onDiagnostic('airplay-helper-output', this.helperOutputBuffer.slice(0, 2048));
      this.helperOutputBuffer = '';
    }
  }

  handleInformationRecord(line) {
    const volume = /^EFFETUNE_AIRPLAY_VOLUME \{"fraction":(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\}$/.exec(line);
    if (volume) {
      const fraction = Number(volume[1]);
      if (Number.isFinite(fraction) && fraction >= 0 && fraction <= 1) {
        this.information = { ...this.information, sender: { ...this.information.sender,
          volumePercent: fraction * 100 } };
        this.publishInformation();
        return true;
      }
      return false;
    }
    const progress = /^audio progress \(min:sec\):\s*(\d+):([0-5]\d); remaining:\s*(\d+):([0-5]\d); track length (\d+):([0-5]\d)$/.exec(line);
    if (progress) {
      const position = Number(progress[1]) * 60 + Number(progress[2]);
      const duration = Number(progress[5]) * 60 + Number(progress[6]);
      if (Number.isSafeInteger(position) && Number.isSafeInteger(duration)) {
        this.information = { ...this.information, position, duration: duration > 0 ? duration : null };
        this.publishInformation();
      }
      return true;
    }
    const format = /^ct=(2|8) spf=\d+ usingScreen=\d+ isMedia=\d+\s+audioFormat=0x[0-9a-f]+$/i.exec(line);
    if (format) {
      this.information = { ...this.information, format: { ...this.information.format,
        codec: format[1] === '2' ? 'ALAC' : 'AAC-ELD' } };
      this.publishInformation();
      return true;
    }
    const suffix = line.lastIndexOf(') with deviceID = ');
    const modelStart = line.lastIndexOf(' (', suffix);
    if (line.startsWith('connection request from ') && suffix > modelStart && modelStart >= 24) {
      this.information = { ...this.information, sender: {
        ...this.information.sender, name: line.slice(24, modelStart).trim().slice(0, 256), model: line.slice(modelStart + 2, suffix).trim().slice(0, 128)
      } };
      this.publishInformation();
      return true;
    }
    return false;
  }

  publishInformation() {
    if (this.sessionStarted) this.post({ type: 'information', generation: this.generation, information: this.information });
  }

  publishArtwork() {
    if (this.sessionStarted) this.post({ type: 'artwork', generation: this.generation,
      artwork: this.artwork });
  }

  async readArtifact(filePath, limit, previousVersion) {
    let handle;
    try {
      handle = await this.fileSystem.promises.open(filePath, 'r');
      const before = await handle.stat();
      if (!before.isFile() || before.size < 1 || before.size > limit) return null;
      if (`${before.mtimeMs}:${before.size}` === previousVersion) return null;
      const bytes = Buffer.alloc(before.size);
      const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      const after = await handle.stat();
      if (bytesRead !== bytes.length || before.size !== after.size || before.mtimeMs !== after.mtimeMs) return null;
      return { bytes, version: `${after.mtimeMs}:${after.size}` };
    } catch (error) {
      if (!['ENOENT', 'EACCES', 'EPERM'].includes(error.code)) this.onDiagnostic('airplay-information-read-failed', error);
      return null;
    } finally { await handle?.close(); }
  }

  async readArtifacts() {
    const artifacts = this.artifacts;
    if (!artifacts || artifacts.pending) return artifacts?.pending;
    artifacts.lastPoll = this.now();
    artifacts.pending = (async () => {
      const metadataFile = await this.readArtifact(path.join(artifacts.directory, 'metadata.txt'), MAX_METADATA_BYTES);
      if (this.artifacts !== artifacts || artifacts.generation !== this.generation) return;
      if (metadataFile && !metadataFile.bytes.equals(artifacts.metadata ?? Buffer.alloc(0))) {
        const metadata = parseMetadata(metadataFile.bytes);
        if (metadata) {
          artifacts.metadata = metadataFile.bytes;
          this.information = { ...this.information, metadata };
          this.publishInformation();
        }
      }
      const image = await this.readArtifact(path.join(artifacts.directory, 'artwork'), MAX_ARTWORK_BYTES, artifacts.artwork?.version);
      if (this.artifacts !== artifacts || artifacts.generation !== this.generation || !image) return;
      if (artifacts.artwork?.version === image.version && artifacts.artwork.bytes.equals(image.bytes)) return;
      const mimeType = artworkType(image.bytes);
      if (!mimeType) { artifacts.candidate = null; return; }
      // The producer rewrites files in place. Accept artwork only after two identical complete reads.
      if (artifacts.candidate?.version !== image.version || !artifacts.candidate.bytes.equals(image.bytes)) {
        artifacts.candidate = image;
        return;
      }
      artifacts.artwork = image;
      artifacts.candidate = null;
      this.artwork = image.bytes.equals(EMPTY_ARTWORK) ? null : {
        mimeType, bytes: image.bytes.buffer.slice(image.bytes.byteOffset, image.bytes.byteOffset + image.bytes.length)
      };
      this.publishArtwork();
    })();
    try { await artifacts.pending; }
    catch (error) { this.onDiagnostic('airplay-information-read-failed', error); }
    finally { artifacts.pending = null; }
  }

  cleanupArtifacts() {
    const artifacts = this.artifacts;
    if (!artifacts) return this.artifactCleanup;
    this.artifacts = null;
    this.artifactCleanup = this.artifactCleanup.then(async () => {
      await artifacts.pending?.catch(() => {});
      await this.fileSystem.promises.rm(artifacts.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }).catch(error => this.onDiagnostic('airplay-information-cleanup-failed', error));
    return this.artifactCleanup;
  }

  post(message) {
    try { this.rendererPort?.postMessage(message); return !!this.rendererPort; }
    catch (error) { this.onDiagnostic('airplay-port-failed', error); void this.setRendererUnavailable(); return false; }
  }

  acceptPcm(chunk, generation) {
    if (generation !== this.generation || !this.rendererPort) return;
    if (!this.sessionStarted) {
      this.sessionStarted = true;
      this.post({ type: 'start', generation, sampleRate: SAMPLE_RATE, channelCount: CHANNEL_COUNT });
      this.publishInformation();
      this.publishArtwork();
    }
    if (this.queuedFrames + chunk.frameCount > MAX_QUEUED_FRAMES) this.resetPcm(chunk.startFrame, generation);
    this.queue.push(chunk);
    this.queuedFrames += chunk.frameCount;
    this.pump();
  }

  resetPcm(startFrame, generation) {
    this.queue = [];
    this.queuedFrames = 0;
    this.pendingReset = { type: 'reset', generation, startFrame };
    this.onDiagnostic('airplay-pcm-rebuffer');
  }

  pump() {
    if (this.inFlight || !this.rendererPort || !this.queue.length) return;
    if (this.pendingReset) { this.post(this.pendingReset); this.pendingReset = null; }
    const chunk = this.queue.shift();
    this.queuedFrames -= chunk.frameCount;
    this.inFlight = true;
    // Electron MessagePortMain clones binary ArrayBuffers; the renderer can transfer them onward.
    this.post({ type: 'pcm', generation: this.generation, ...chunk });
  }

  handlePortMessage(message) {
    if (!message || message.generation !== this.generation || !this.sessionStarted) return;
    if (message.type === 'credit') { this.inFlight = false; this.pump(); }
    if (message.type === 'ready') this.publishStatus('receiving');
  }

  finishSession() {
    if (this.sessionStarted) this.post({ type: 'end', generation: this.generation });
    this.sessionStarted = false;
    this.inFlight = false;
    this.queue = [];
    this.queuedFrames = 0;
    this.pendingReset = null;
    this.senderPort = null;
    this.receiver = null;
    this.information = emptyInformation();
    this.artwork = null;
    this.generation += 1;
  }

  closeSocket() {
    if (this.timer) this.clearIntervalFn(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) { socket.removeAllListeners('message'); socket.removeAllListeners('error'); try { socket.close(); } catch (_) { /* Already closed. */ } }
  }

  async stopChild() {
    const child = this.child;
    this.finishSession();
    this.closeSocket();
    if (!child) { await this.cleanupArtifacts(); return; }
    this.stoppingChild = child;
    let timer;
    const exit = new Promise(resolve => { child.once('exit', resolve); child.once('close', resolve); });
    child.kill();
    await Promise.race([exit, new Promise(resolve => { timer = setTimeout(resolve, STOP_TIMEOUT_MS); })]);
    clearTimeout(timer);
    if (this.child === child) {
      child.kill('SIGKILL');
      await Promise.race([exit, new Promise(resolve => { timer = setTimeout(resolve, STOP_TIMEOUT_MS); })]);
      clearTimeout(timer);
    }
    if (this.child === child) throw new Error('AirPlay helper did not terminate');
    await this.cleanupArtifacts();
    this.stoppingChild = null;
  }

  dispose() {
    return this.enqueue(async () => {
      this.disposed = true;
      await this.stopChild();
      this.detachRendererPort();
      this.publishStatus('off');
    });
  }
}

function createAirPlayReceiverHost(options) { return new AirPlayReceiverHost(options); }
module.exports = { AirPlayReceiverHost, createAirPlayReceiverHost, MAX_QUEUED_FRAMES };
