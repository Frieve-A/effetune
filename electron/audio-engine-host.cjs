'use strict';

const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { VERSION, UNSUPPORTED_CPU, MAX_FRAME_BYTES, CHUNK_BYTES, kinds, encodeFrame, frameReader, instrumentFrames } = require('./audio-engine-protocol.cjs');

const STARTUP_MS = 10000;
const SHUTDOWN_MS = 1500;
const MAX_FEED_PENDING = 1024 * 1024;

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

function validDriver(driver, platform) {
  return driver === (platform === 'win32' ? 'wasapi' : 'miniaudio');
}

function spawnEngine(processFactory, executable, args) {
  const child = processFactory(executable, args, { shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  let detail = '';
  child.stderr.on('data', bytes => { detail = (detail + bytes.toString()).slice(-4096); });
  child.stdin.on('error', error => { detail = String(error); });
  const exited = new Promise(resolve => {
    child.on('error', error => { detail = String(error); });
    child.once('close', (code, signal) => resolve({ code, signal, detail }));
  });
  return { child, exited };
}

class AudioEngineHost {
  constructor({ root, resources, platform = process.platform, arch = process.arch,
    processFactory = spawn, testBackend, testMuteOutput = false, diagnostic = console.warn }) {
    this.paths = executablePaths({ root, resources, platform, arch });
    this.platform = platform;
    this.processFactory = processFactory;
    this.testBackend = testBackend;
    this.testMuteOutput = testMuteOutput;
    this.diagnostic = diagnostic;
    this.active = null;
  }

  async attempts(driver, list, start) {
    if (!validDriver(driver, this.platform)) throw new Error('Unsupported audio driver');
    const backend = this.testBackend || driver;
    for (const executable of this.paths) {
      const args = list ? ['--list-devices'] : this.testMuteOutput ? ['--mute-device-output'] : [];
      const proc = spawnEngine(this.processFactory, executable, [...args, '--backend', backend]);
      try {
        return await timeout(start(proc, backend), STARTUP_MS);
      } catch (error) {
        if (proc.child.exitCode === null && proc.child.pid) proc.child.kill();
        const exit = await timeout(proc.exited, SHUTDOWN_MS);
        if (exit.code !== UNSUPPORTED_CPU || executable === this.paths.at(-1)) {
          this.diagnostic('Audio engine launch:', error, exit);
          throw error;
        }
        this.diagnostic('Audio engine selected the baseline CPU binary');
      }
    }
  }

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

  async start(driver, control, feed) {
    const closed = this.stop();
    const session = { control, feed, droppedFeed: 0, ended: false, writes: [], queuedBytes: 0, blocked: false,
      feedWrites: [], feedBytes: 0, sequence: 0, transferId: 0 };
    this.active = session;
    try {
      await closed;
      if (session.ended) throw new Error('Audio engine start cancelled');
      const read = await this.attempts(driver, false, async (proc, backend) => {
        if (session.ended) throw new Error('Audio engine start cancelled');
        session.proc = proc;
        const next = frameReader(proc.child.stdout);
        const hello = await next();
        if (!hello) await proc.exited;
        if (hello?.kind !== kinds.control || hello.message.type !== 'hello' ||
            hello.message.version !== VERSION || !hello.message.backends?.includes(backend))
          throw new Error('Audio engine protocol handshake failed');
        if (session.ended) throw new Error('Audio engine start cancelled');
        this.write(session, kinds.control, { type: 'hello', version: VERSION });
        return next;
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
      void this.pump(session, read);
    } catch (error) {
      if (this.active === session) await this.stop();
      throw error;
    }
  }

  write(session, kind, message, attachment) {
    if (session !== this.active || session.ended) return;
    const bytes = attachment ? new Uint8Array(attachment) : undefined;
    const sequence = ++session.sequence;
    if (kind === kinds.feed || message.type === 'feedSilence') {
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

  drainWrites(session) {
    if (session.ended || this.active !== session) return;
    const stream = session.proc.child.stdin;
    session.blocked = false;
    while (session.writes.length || session.feedWrites.length) {
      const control = session.writes[0], feed = session.feedWrites[0];
      let ready;
      if (feed && (!control || feed.sequence < control.sequence || control.allowFeed && control.started)) {
        session.feedWrites.shift();
        // The PCM budget includes pending pipe writes until Node completes them.
        ready = stream.write(feed.frame,() => { session.feedBytes -= feed.frame.length; });
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
    this.active = null;
    session.ended = true;
    session.writes.length = 0;
    session.feedWrites.length = 0;
    session.control.close();
    session.feed.close();
    session.network?.close();
    if (!session.proc) return this.stopping;
    session.proc.child.stdin.end();
    this.stopping = timeout(session.proc.exited, SHUTDOWN_MS).catch(async () => {
      session.proc.child.kill();
      await timeout(session.proc.exited, SHUTDOWN_MS).catch(error => this.diagnostic('Audio engine shutdown:',error));
    }).finally(() => { this.stopping = null; });
    return this.stopping;
  }
}

module.exports = { AudioEngineHost, executablePaths, validDriver, STARTUP_MS, SHUTDOWN_MS, MAX_FEED_PENDING };
