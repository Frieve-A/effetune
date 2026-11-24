'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { constants: osConstants } = require('node:os');
const path = require('node:path');
const { VERSION, UNSUPPORTED_CPU, MAX_FRAME_BYTES, CHUNK_BYTES, kinds, encodeFrame, frameReader, instrumentFrames } = require('./audio-engine-protocol.cjs');

const STARTUP_MS = 10000;
const SHUTDOWN_MS = 1500;
const DIAGNOSTIC_STDERR_BYTES = 4096;
const MAX_FEED_PENDING = 1024 * 1024;
const MAX_FILE_PENDING = 512 * 1024;
const FILE_CONTROLS = new Set(['fileStart','fileNext','fileEnd','fileGain','fileFlush','fileCancelNext']);

function *assetFrames(message, bytes, transferId) {
  const branch = message.branch || 0;
  yield encodeFrame(kinds.control,{...message,type:'beginPluginAsset',transferId,byteLength:bytes.byteLength});
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    yield encodeFrame(kinds.control,{type:'pluginAssetChunk',branch,transferId,offset},
      bytes.subarray(offset,offset + CHUNK_BYTES));
  }
  yield encodeFrame(kinds.control,{type:'finishPluginAsset',branch,transferId});
}

function timeout(promise, ms) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Audio engine command timed out')), ms);
  })]).finally(() => clearTimeout(timer));
}

function executablePaths({ platform = process.platform, arch = process.arch, resources, root }) {
  const dir = resources ? path.join(resources, 'audio-engine') :
    path.join(root, 'out', 'native', 'audio-engine', `${platform}-${arch}`);
  return (arch === 'x64' ? ['-v3', ''] : ['']).map(suffix =>
    path.join(dir, `effetune-audio-engine${suffix}${platform === 'win32' ? '.exe' : ''}`));
}

function nativeDriverFor(platform) {
  return platform === 'win32' ? 'wasapi' : 'miniaudio';
}

function validDriver(driver, platform) {
  return driver === nativeDriverFor(platform);
}

function spawnEngine(processFactory, executable, args) {
  const child = processFactory(executable, args, { shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  let detail = '';
  let stderr = Buffer.alloc(0);
  let discardStderrLine = false;
  let spawnError;
  child.stderr.on('data', bytes => {
    detail = (detail + bytes.toString()).slice(-4096);
    if (discardStderrLine) {
      const newline = bytes.indexOf(0x0a);
      if (newline === -1) return;
      bytes = bytes.subarray(newline + 1);
      discardStderrLine = false;
    }
    const tail = Buffer.concat([stderr, bytes]);
    if (tail.length <= DIAGNOSTIC_STDERR_BYTES) {
      stderr = tail;
      return;
    }
    // Drop a clipped line so redaction sees the start of every retained token.
    const newline = tail.indexOf(0x0a, tail.length - DIAGNOSTIC_STDERR_BYTES - 1);
    discardStderrLine = newline === -1;
    stderr = discardStderrLine ? Buffer.alloc(0) : Buffer.from(tail.subarray(newline + 1));
  });
  child.stdin.on('error', error => { detail = String(error); });
  const exited = new Promise(resolve => {
    child.on('error', error => { spawnError = error.code; detail = String(error); });
    child.once('close', (code, signal) => resolve({ code, signal, detail, spawnError }));
  });
  return { child, exited, get diagnosticStderr() { return stderr.toString(); } };
}

class AudioEngineHost {
  constructor({ root, resources, platform = process.platform, arch = process.arch,
    processFactory = spawn, testBackend, testMuteOutput = false, onSessionExit, diagnostic = console.warn,
    recordDiagnosticEvent, redactDiagnosticText = () => '' }) {
    this.paths = executablePaths({ root, resources, platform, arch });
    this.platform = platform;
    this.processFactory = processFactory;
    this.testBackend = testBackend;
    this.testMuteOutput = testMuteOutput;
    this.onSessionExit = onSessionExit;
    this.diagnostic = diagnostic;
    this.recordDiagnosticEvent = recordDiagnosticEvent;
    this.redactDiagnosticText = redactDiagnosticText;
    this.lastExit = null;
    this.active = null;
  }

  async attempts(driver, list, start) {
    if (!validDriver(driver, this.platform) && (list || driver !== 'null'))
      throw new Error('Unsupported audio driver');
    const backend = driver === 'null' ? driver : this.testBackend || driver;
    for (const executable of this.paths) {
      const args = list ? ['--list-devices'] : this.testMuteOutput ? ['--mute-device-output'] : [];
      const proc = spawnEngine(this.processFactory, executable, [...args, '--backend', backend]);
      try {
        const variant = this.paths.length === 1 ? null : executable === this.paths.at(-1) ? 'baseline' : 'v3';
        return await timeout(start(proc, backend, variant), STARTUP_MS);
      } catch (error) {
        if (proc.child.exitCode === null && proc.child.pid) proc.child.kill();
        const exit = await timeout(proc.exited, SHUTDOWN_MS);
        if ((exit.code !== UNSUPPORTED_CPU && exit.spawnError !== 'ENOENT') || executable === this.paths.at(-1)) {
          this.diagnostic('Audio engine launch:', error, exit);
          throw error;
        }
        this.diagnostic('Audio engine selected the baseline CPU binary');
      }
    }
  }

  available() { return this.paths.some(executable => existsSync(executable)); }

  async list(driver) {
    return this.attempts(driver, true, async ({ child, exited }) => {
      let bytes = 0;
      const chunks = [];
      for await (const chunk of child.stdout) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) throw new Error('Device list too large');
        chunks.push(chunk);
      }
      if ((await exited).code !== 0) throw new Error('Device enumeration failed');
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!Array.isArray(result.outputs) || !Array.isArray(result.inputs)) throw new Error('Malformed device list');
      return result;
    });
  }

  async start(driver, control, feed, file) {
    const closed = this.stop();
    const session = { control, feed, file, droppedFeed: 0, ended: false, writes: [], queuedBytes: 0, blocked: false,
      feedWrites: [], feedBytes: 0, fileWrites: [], fileBytes: 0, sequence: 0, transferId: 0 };
    this.active = session;
    try {
      await closed;
      if (session.ended) throw new Error('Audio engine start cancelled');
      const {read, variant} = await this.attempts(driver, false, async (proc, backend, variant) => {
        if (session.ended) throw new Error('Audio engine start cancelled');
        session.proc = proc;
        const exitInfo = { variant: variant ?? 'single', epochMs: null, exitCode: null, signal: null,
          spawnError: null, droppedFeedPackets: 0, stderr: '' };
        session.exitInfo = exitInfo;
        void proc.exited.then(({ code, signal, spawnError }) => {
          const fields = {
            variant: exitInfo.variant, exitCode: Number.isInteger(code) ? code : null,
            signal: signal ? (Object.hasOwn(osConstants.signals, signal) ? signal : 'unknown') : null,
            spawnError: spawnError ? (Object.hasOwn(osConstants.errno, spawnError) ? spawnError : 'unknown') : null,
            droppedFeedPackets: session.droppedFeed
          };
          Object.assign(exitInfo, fields, { epochMs: Date.now(), stderr: this.redactDiagnosticText(proc.diagnosticStderr) });
          this.lastExit = exitInfo;
          this.recordDiagnosticEvent?.('nativeEngineExit', fields);
        });
        const next = frameReader(proc.child.stdout);
        const hello = await next();
        if (!hello) await proc.exited;
        if (hello?.kind !== kinds.control || hello.message.type !== 'hello' ||
            hello.message.version !== VERSION || !hello.message.backends?.includes(backend))
          throw new Error('Audio engine protocol handshake failed');
        if (session.ended) throw new Error('Audio engine start cancelled');
        this.write(session, kinds.control, { type: 'hello', version: VERSION });
        return {read:next, variant};
      });
      for (const [port, kind] of [[control,kinds.control],[feed,kinds.feed]]) {
        port.on('message', ({data}) => {
          try {
            const { attachment, ...message } = data;
            const actual = kind === kinds.feed && message.type === 'feedSilence' ? kinds.control : kind;
            this.write(session, actual, message, attachment);
          } catch (error) {
            this.fail(session, error);
          }
        });
        port.start();
      }
      file?.on('message', ({data}) => {
        try {
          const {attachment, ...message} = data;
          if (message.type !== 'feed' && !FILE_CONTROLS.has(message.type)) throw new Error('Invalid file audio command');
          const pcm = message.type === 'feed';
          if (pcm) message.stream = 'file';
          if (message.type === 'fileStart') this.dropStaleFilePcm(session, message.generation);
          this.write(session, pcm ? kinds.feed : kinds.control, message, attachment, true);
        } catch (error) {
          this.fail(session,error);
        }
      });
      file?.start();
      void this.pump(session, read);
      return variant;
    } catch (error) {
      if (this.active === session) await this.stop();
      throw error;
    }
  }

  write(session, kind, message, attachment, fromFile = false) {
    if (session !== this.active || session.ended) return;
    const bytes = attachment ? new Uint8Array(attachment) : undefined;
    const sequence = ++session.sequence;
    if (fromFile) {
      const size = bytes?.byteLength || 0;
      if (session.fileBytes + size > MAX_FILE_PENDING) throw new Error('Audio engine file queue overflow');
      session.fileWrites.push({frame:encodeFrame(kind,message,bytes),sequence,size,
        generation:message.generation,pcm:kind === kinds.feed});
      session.fileBytes += size;
    } else if (kind === kinds.feed || message.type === 'feedSilence') {
      const frame = encodeFrame(kind,message,bytes);
      if (kind === kinds.feed && session.feedBytes + frame.length > MAX_FEED_PENDING) {
        session.droppedFeed++;
        return;
      }
      session.feedBytes += frame.length;
      session.feedWrites.push({frame,sequence});
    } else if (message.type === 'setPluginAsset' && bytes?.length > CHUNK_BYTES) {
      session.transferId = (session.transferId + 1) >>> 0 || 1;
      session.writes.push({frames:assetFrames(message,bytes,session.transferId),size:0,sequence,allowFeed:true});
    } else if (['midiTransport','sfzStartRuntime'].includes(message.type) && bytes?.length > CHUNK_BYTES) {
      session.writes.push({frames:instrumentFrames(message,bytes),size:0,sequence,allowFeed:true});
    } else {
      const frame = encodeFrame(kind,message,bytes);
      session.queuedBytes += frame.length;
      if (session.queuedBytes > MAX_FRAME_BYTES + 4) throw new Error('Audio engine control queue overflow');
      session.writes.push({frames:[frame].values(),size:frame.length,sequence});
    }
    if (!session.blocked) this.drainWrites(session);
  }

  // The renderer restarts its file window for each generation and the sidecar
  // discards older-generation PCM, so unsent stale PCM only occupies the budget.
  dropStaleFilePcm(session, generation) {
    if (session !== this.active || session.ended) return;
    session.fileWrites = session.fileWrites.filter(entry => {
      if (!entry.pcm || !(entry.generation < generation)) return true;
      session.fileBytes -= entry.size;
      return false;
    });
  }

  drainWrites(session) {
    if (session.ended || this.active !== session) return;
    const stream = session.proc.child.stdin;
    session.blocked = false;
    while (session.writes.length || session.feedWrites.length || session.fileWrites.length) {
      const control = session.writes[0], feed = session.feedWrites[0], file = session.fileWrites[0];
      const nextFile = file && (!feed || file.sequence < feed.sequence);
      const source = nextFile ? file : feed;
      let ready;
      if (source && (!control || source.sequence < control.sequence || control.allowFeed && control.started)) {
        // The PCM budget includes pending pipe writes until Node completes them.
        if (nextFile) {
          session.fileWrites.shift();
          ready = stream.write(file.frame,() => { session.fileBytes -= file.size; });
        } else {
          session.feedWrites.shift();
          ready = stream.write(feed.frame,() => { session.feedBytes -= feed.frame.length; });
        }
      } else {
        const frame = control.frames.next();
        if (frame.done) {
          session.writes.shift();
          session.queuedBytes -= control.size;
          continue;
        }
        control.started = true;
        ready = stream.write(frame.value);
      }
      if (!ready) {
        session.blocked = true;
        stream.once('drain',() => {
          try { this.drainWrites(session); } catch (error) { this.fail(session,error); }
        });
        return;
      }
    }
  }

  async pump(session, read) {
    try {
      for (;;) {
        const frame = await read();
        if (session.ended) return;
        if (!frame) {
          const {code,signal,detail} = await timeout(session.proc.exited,SHUTDOWN_MS);
          throw new Error(`Audio engine exited (${code ?? signal}): ${detail}`);
        }
        const { kind, message, attachment } = frame;
        const buffer = attachment.buffer.slice(attachment.byteOffset, attachment.byteOffset + attachment.byteLength);
        if (kind === kinds.network) {
          session.network?.emit('message', { data: { ...message, data: buffer } });
        } else if (kind === kinds.telemetry) {
          session.control.postMessage({ ...message, packet: buffer, recycle: false });
        } else if (kind === kinds.control) {
          if (message.type === 'dspReady' && !message.branch) session.primaryEpoch = message.endpointEpoch;
          if (attachment.length) message.attachment = buffer;
          if (message.type === 'powerObservation') message.droppedFeedPackets = session.droppedFeed;
          session.control.postMessage(message);
        } else throw new Error('Unexpected audio engine output');
      }
    } catch (error) {
      if (!session.ended) this.fail(session, error);
    }
  }

  fail(session, error) {
    if (this.active !== session || session.ended) return;
    this.diagnostic('Audio engine stopped:', error);
    try { session.control.postMessage({type:'engineFailure',reason:'stopped'}); }
    catch (portError) { this.diagnostic('Audio engine owner disconnected:',portError); }
    finally { void this.stop(); }
  }

  attachNetwork() {
    const session = this.active;
    if (!session || session.ended) return null;
    const port = new EventEmitter();
    const endpointEpoch = session.primaryEpoch;
    // The host resets its source epoch when it installs the new port. Start
    // packet production only after its listener and ACK destination are bound.
    port.start = () => {
      session.network = port;
      this.write(session, kinds.control, {type:'setNetworkOutputPort',attached:true,endpointEpoch});
    };
    port.close = () => {
      if (session.network === port) session.network = null;
      port.emit('close');
    };
    port.postMessage = message => {
      if (session.network === port) this.write(session, kinds.control, {...message,endpointEpoch});
    };
    return port;
  }

  stop() {
    const session = this.active;
    if (!session) return this.stopping;
    if (session.exitInfo) {
      session.exitInfo.droppedFeedPackets = session.droppedFeed;
      this.lastExit = session.exitInfo;
    }
    this.active = null;
    session.ended = true;
    session.writes.length = 0;
    session.feedWrites.length = 0;
    session.fileWrites.length = 0;
    session.control.close();
    session.feed.close();
    session.file?.close();
    session.network?.close();
    if (!session.proc) return this.stopping;
    void session.proc.exited.then(() => this.onSessionExit?.());
    session.proc.child.stdin.end();
    this.stopping = timeout(session.proc.exited, SHUTDOWN_MS).catch(async () => {
      session.proc.child.kill();
      await timeout(session.proc.exited, SHUTDOWN_MS).catch(error => this.diagnostic('Audio engine shutdown:',error));
    }).finally(() => { this.stopping = null; });
    return this.stopping;
  }
}

module.exports = { AudioEngineHost, executablePaths, nativeDriverFor, validDriver, STARTUP_MS, SHUTDOWN_MS, MAX_FEED_PENDING, MAX_FILE_PENDING };
