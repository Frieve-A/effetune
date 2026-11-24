'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter, once } = require('node:events');
const { PassThrough, Readable } = require('node:stream');
const { AudioEngineHost, executablePaths } = require('../../electron/audio-engine-host.cjs');
const { kinds, encodeFrame, frameReader, instrumentFrames, CHUNK_BYTES } = require('../../electron/audio-engine-protocol.cjs');
const { registerAudioEngineIpc } = require('../../electron/audio-engine-ipc.cjs');

class Port extends EventEmitter {
  start() { this.started = true; }
  close() { this.closed = true; }
  postMessage(message) { this.emit('sent',message); }
}

function childProcess() {
  const child = Object.assign(new EventEmitter(),{pid:101,exitCode:null,
    stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough()});
  child.finish = code => {
    if (child.exitCode !== null) return;
    child.exitCode = code;
    child.stdout.end();
    child.emit('close',code,null);
  };
  child.kill = () => child.finish(1);
  child.stdin.on('finish',() => child.finish(0));
  return child;
}

test('native host splits framed control, feed, network and telemetry and reports a child exit', async () => {
  const { redactDiagnosticText } = await import('../../js/diagnostics/diagnostic-redaction.js');
  const child = childProcess(), control = new Port(), feed = new Port();
  const host = new AudioEngineHost({root:'.',platform:'win32',arch:'arm64',testBackend:'null',
    redactDiagnosticText,diagnostic() {},processFactory(_executable,args,options) {
      assert.deepEqual(args,['--backend','null']);
      assert.equal(options.shell,false);
      child.stdout.write(encodeFrame(kinds.control,{type:'hello',version:1,backends:['null']}));
      return child;
    }});
  const read = frameReader(child.stdin);
  await host.start('wasapi',control,feed);
  assert.equal((await read()).message.type,'hello');
  const network = host.attachNetwork();
  network.start();
  assert.equal((await read()).message.type,'setNetworkOutputPort');
  feed.emit('message',{data:{type:'feed',attachment:Uint8Array.of(1,2).buffer}});
  assert.deepEqual((await read()).attachment,Buffer.from([1,2]));
  feed.emit('message',{data:{type:'feedSilence'}});
  assert.equal((await read()).kind,kinds.control);
  const packet = once(network,'message');
  child.stdout.write(encodeFrame(kinds.network,{type:'networkOutputPacket'},Buffer.from([7])));
  assert.deepEqual(new Uint8Array((await packet)[0].data.data),Uint8Array.of(7));
  const telemetry = once(control,'sent');
  child.stdout.write(encodeFrame(kinds.telemetry,{type:'dspTelemetry'},Buffer.from([3])));
  const [message] = await telemetry;
  assert.equal(message.recycle,false);
  assert.deepEqual(new Uint8Array(message.packet),Uint8Array.of(3));
  const bytes = new Uint8Array(4 * 1024 * 1024 + 1);
  bytes[bytes.length - 1] = 31;
  control.emit('message',{data:{type:'setPluginAsset',branch:1,pluginId:42,slot:0,attachment:bytes.buffer}});
  assert.ok(host.active.blocked);
  control.emit('message',{data:{type:'requestDspLatency'}});
  feed.emit('message',{data:{type:'feed',attachment:Uint8Array.of(11).buffer}});
  feed.emit('message',{data:{type:'feedSilence'}});
  const begin = (await read()).message;
  assert.equal(begin.type,'beginPluginAsset');
  assert.equal(begin.byteLength,bytes.length);
  const first = await read();
  assert.deepEqual((await read()).attachment,Buffer.from([11]));
  assert.equal((await read()).message.type,'feedSilence');
  const last = await read();
  assert.equal(first.message.transferId,begin.transferId);
  assert.equal(first.attachment.length,bytes.length - 1);
  assert.equal(last.message.offset,first.attachment.length);
  assert.equal(last.attachment[0],31);
  assert.equal((await read()).message.type,'finishPluginAsset');
  assert.equal((await read()).message.type,'requestDspLatency');
  assert.equal(host.active.droppedFeed,0);
  const failed = once(control,'sent');
  child.stderr.write('Failed to open /home/listener/private.wav\n');
  child.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  child.finish(7);
  assert.equal((await failed)[0].type,'engineFailure');
  assert.equal(host.active,null);
  assert.ok(control.closed && feed.closed);
  assert.equal(host.lastExit.variant, 'single');
  assert.equal(host.lastExit.exitCode, 7);
  assert.equal(host.lastExit.stderr, 'Failed to open <path>\n');
});

test('sidecar diagnostic stderr excludes lines cut by the history limit across chunks', async () => {
  const { redactDiagnosticText } = await import('../../js/diagnostics/diagnostic-redaction.js');
  const suffix = 'Private.wav\n';
  const lastLine = 'Failed to open /home/listener/other.wav\n';
  const filler = 'x'.repeat(4096 - suffix.length - lastLine.length - 1) + '\n';
  for (const chunks of [
    ['Failed to open /home/listener/', suffix + filler + lastLine],
    ['x'.repeat(4097), 'Private.wav', '\n' + lastLine]
  ]) {
    const child = childProcess(), control = new Port();
    const host = new AudioEngineHost({root:'.',platform:'win32',arch:'arm64',redactDiagnosticText,
      diagnostic() {},processFactory() {
        child.stdout.write(encodeFrame(kinds.control,{type:'hello',version:1,backends:['null']}));
        return child;
      }});
    await host.start('null', control, new Port());
    for (const chunk of chunks) child.stderr.write(chunk);
    const failed = once(control, 'sent');
    child.finish(7);
    await failed;
    assert.equal(host.lastExit.stderr.includes('Private.wav'), false);
    assert.ok(host.lastExit.stderr.endsWith('Failed to open <path>\n'));
    assert.ok(Buffer.byteLength(host.lastExit.stderr) <= 4096);
  }
});

test('a navigation can cancel startup before a child spawns',async () => {
  let launches = 0;
  const host = new AudioEngineHost({root:'.',platform:'win32',diagnostic() {},
    processFactory() { ++launches; return childProcess(); }});
  const control = new Port(), feed = new Port();
  const pending = host.start('wasapi',control,feed);
  await host.stop();
  await assert.rejects(pending,/cancelled/);
  assert.equal(launches,0);
  assert.equal(host.active,null);
  assert.ok(control.closed && feed.closed);
});

test('sidecar failure releases native capture only after the process closes',async () => {
  const child = childProcess();
  child.stdin.removeAllListeners('finish');
  const messages = [];
  const control = new Port();
  control.on('sent',m => messages.push(m.type));
  const host = new AudioEngineHost({root:'.',platform:'win32',arch:'arm64',diagnostic() {},
    onSessionExit:() => messages.push('restore'),processFactory() {
      child.stdout.write(encodeFrame(kinds.control,{type:'hello',version:1,backends:['null']}));
      return child;
    }});
  await host.start('null',control,new Port(),new Port());
  host.fail(host.active,new Error('device disconnected'));
  assert.deepEqual(messages,['engineFailure']);
  child.finish(1);
  await host.stopping;
  assert.deepEqual(messages,['engineFailure','restore']);
});

test('the feed survives ordinary pipe backpressure and drops only after reaching its bounded queue',async () => {
  const child = childProcess(), feed = new Port();
  const host = new AudioEngineHost({root:'.',platform:'win32',arch:'arm64',testBackend:'null',diagnostic() {},
    processFactory() {
      child.stdout.write(encodeFrame(kinds.control,{type:'hello',version:1,backends:['null']}));
      return child;
    }});
  await host.start('wasapi',new Port(),feed);
  const read = frameReader(child.stdin);
  assert.equal((await read()).message.type,'hello');
  const block = new Uint8Array(128 * 1024);
  const send = sequence => feed.emit('message',{data:{type:'feed',sequence,attachment:block.buffer}});
  send(0);
  assert.equal(host.active.blocked,true);
  send(1);
  assert.equal(host.active.droppedFeed,0);
  for (let i = 2; i < 16; ++i) send(i);
  const dropped = host.active.droppedFeed;
  assert.ok(dropped > 0 && dropped < 14);
  for (let i = 0; i < 16 - dropped; ++i) assert.equal((await read()).message.sequence,i);
  await host.stop();
  assert.equal(host.lastExit.droppedFeedPackets, dropped);
  assert.equal(host.lastExit.exitCode, 0);
});

test('file PCM keeps its own byte budget and stays ordered with its controls during feed backpressure',async () => {
  const child = childProcess(), feed = new Port(), file = new Port();
  const host = new AudioEngineHost({root:'.',platform:'win32',arch:'arm64',diagnostic() {},
    processFactory() {
      child.stdout.write(encodeFrame(kinds.control,{type:'hello',version:1,backends:['null']}));
      return child;
    }});
  await host.start('null',new Port(),feed,file);
  try {
    const read = frameReader(child.stdin);
    assert.equal((await read()).message.type,'hello');
    for (let sequence = 0; sequence < 16; ++sequence) {
      feed.emit('message',{data:{type:'feed',sequence,attachment:new ArrayBuffer(128 * 1024)}});
    }
    assert.ok(host.active.droppedFeed > 0);
    file.emit('message',{data:{type:'fileStart',generation:1,track:1}});
    for (let sequence = 0; sequence < 4; ++sequence) {
      file.emit('message',{data:{type:'feed',generation:1,track:1,sequence,attachment:new ArrayBuffer(64 * 1024)}});
    }
    file.emit('message',{data:{type:'fileEnd',generation:1,track:1}});
    assert.equal(host.active.fileBytes,256 * 1024);
    for (let i = 0; i < 16 - host.active.droppedFeed; ++i) {
      assert.equal((await read()).message.sequence,i);
    }
    assert.equal((await read()).message.type,'fileStart');
    for (let sequence = 0; sequence < 4; ++sequence) {
      const frame = await read();
      assert.equal(frame.kind,kinds.feed);
      assert.equal(frame.message.stream,'file');
      assert.equal(frame.message.sequence,sequence);
    }
    assert.equal((await read()).message.type,'fileEnd');
    assert.equal(host.active.fileBytes,0);
  } finally {
    await host.stop();
  }
});

test('a new file generation drops unsent stale PCM instead of overflowing during a stdin stall',async () => {
  const child = childProcess(), feed = new Port(), file = new Port();
  const host = new AudioEngineHost({root:'.',platform:'win32',arch:'arm64',diagnostic() {},
    processFactory() {
      child.stdout.write(encodeFrame(kinds.control,{type:'hello',version:1,backends:['null']}));
      return child;
    }});
  await host.start('null',new Port(),feed,file);
  try {
    const read = frameReader(child.stdin);
    assert.equal((await read()).message.type,'hello');
    feed.emit('message',{data:{type:'feed',sequence:0,attachment:new ArrayBuffer(128 * 1024)}});
    assert.equal(host.active.blocked,true);
    // Each seek restarts the renderer's 256 KiB window while the pipe is still stalled.
    for (let generation = 1; generation <= 3; ++generation) {
      file.emit('message',{data:{type:'fileStart',generation,track:1}});
      for (let sequence = 0; sequence < 4; ++sequence) {
        file.emit('message',{data:{type:'feed',generation,track:1,sequence,attachment:new ArrayBuffer(64 * 1024)}});
      }
    }
    assert.equal(host.active?.ended,false);
    assert.equal(host.active.fileBytes,256 * 1024);
    assert.equal((await read()).message.sequence,0);
    for (let generation = 1; generation <= 3; ++generation) {
      const start = await read();
      assert.deepEqual([start.message.type,start.message.generation],['fileStart',generation]);
    }
    for (let sequence = 0; sequence < 4; ++sequence) {
      const frame = await read();
      assert.deepEqual([frame.message.generation,frame.message.sequence],[3,sequence]);
    }
  } finally {
    await host.stop();
  }
});

test('only an unsupported x64 CPU retries the baseline binary for enumeration',async () => {
  for (const [exitCode,count] of [[78,2],[1,1]]) {
    const attempts = [];
    const host = new AudioEngineHost({platform:'linux',arch:'x64',resources:'/app/resources',diagnostic() {},
      processFactory(file,args) {
        attempts.push(file);
        assert.deepEqual(args,['--list-devices','--backend','miniaudio']);
        const child = childProcess();
        queueMicrotask(() => {
          if (attempts.length === 1) return child.finish(exitCode);
          child.stdout.write(JSON.stringify({inputs:[],outputs:[{id:'speaker'}]}));
          child.finish(0);
        });
        return child;
      }});
    if (exitCode === 78) assert.deepEqual((await host.list('miniaudio')).outputs,[{id:'speaker'}]);
    else await assert.rejects(host.list('miniaudio'),/enumeration/);
    assert.equal(attempts.length,count);
    assert.deepEqual(attempts,executablePaths({platform:'linux',arch:'x64',resources:'/app/resources'}).slice(0,count));
  }
});

test('framed reads reject truncated headers and bodies and parse arbitrary stream boundaries', async () => {
  const original = encodeFrame(kinds.telemetry,{type:'dspTelemetry'},Buffer.from([1,2,3]));
  const read = frameReader(Readable.from([...original].map(byte => Buffer.from([byte]))));
  assert.deepEqual((await read()).attachment,Buffer.from([1,2,3]));
  assert.equal(await read(),null);
  for (const bytes of [Buffer.from([4,0,0,0]),original.subarray(0,2),original.subarray(0,-1)]) {
    await assert.rejects(frameReader(Readable.from([bytes])));
  }
});

test('instrument checkpoint frames reassemble in order and reject incomplete transfers',async () => {
  const bytes = Buffer.alloc(CHUNK_BYTES + 17,41);
  bytes[CHUNK_BYTES] = 18;
  const message = {type:'midiCheckpoints',checkpoints:[{pluginId:5,byteOffset:0,byteLength:bytes.length}]};
  const frames = [...instrumentFrames(message,bytes)];
  assert.equal(frames.length,2);
  const read = frameReader(Readable.from(frames));
  const result = await read();
  assert.deepEqual(result.message,message);
  assert.deepEqual(result.attachment,bytes);
  assert.equal(await read(),null);
  await assert.rejects(frameReader(Readable.from(frames.slice(0,1)))(),/chunk/);
});

test('only the main frame owns the driver and a full navigation releases its ports', async () => {
  const ipcMain = new EventEmitter(), handlers = new Map();
  ipcMain.handle = (name,fn) => handlers.set(name,fn);
  ipcMain.removeHandler = name => handlers.delete(name);
  const contents = Object.assign(new EventEmitter(),{mainFrame:{},postMessage(channel,{token,variant},ports) {
    assert.equal(channel,'audio-engine:ports');
    assert.equal(token,'a'.repeat(36));
    assert.equal(variant,'baseline');
    assert.equal(ports.length,3);
  }});
  const host = {stopCount:0,stop() { ++this.stopCount; },available:()=>true,
    async start(driver) { assert.equal(driver,'null'); this.started = true; return 'baseline'; },diagnostic() {}};
  class Channel { constructor() { this.port1 = new Port(); this.port2 = new Port(); } }
  const dispose = registerAudioEngineIpc({ipcMain,MessageChannelMain:Channel,host,
    getMainWindow:()=>({webContents:contents}),loadDriver:()=> 'wasapi'});
  const event = {sender:contents,senderFrame:contents.mainFrame};
  const start = handlers.get('audio-engine:start'), token = 'a'.repeat(36);
  assert.deepEqual(start({...event,senderFrame:{}},'wasapi',token),{ok:false});
  assert.deepEqual(await start(event,'wasapi','bad'),{ok:false});
  assert.equal(handlers.get('audio-engine:available')(event),true);
  assert.equal(host.started,undefined);
  assert.equal((await start(event,'null',token)).ok,true);
  const before = host.stopCount;
  contents.emit('did-start-navigation',{},'file:///app',true,true);
  assert.equal(host.stopCount,before);
  contents.emit('did-start-navigation',{},'file:///app',false,true);
  assert.equal(host.stopCount,before+1);
  host.lastExit = {variant:'single'};
  host.start = async () => {
    host.active = {exitInfo:{variant:'baseline'}};
    await Promise.resolve();
    host.active = null;
    throw new Error('Handshake failed');
  };
  assert.deepEqual(await start(event,'null',token),{ok:false,reason:'unavailable',variant:'baseline'});
  host.start = async () => { throw new Error('No executable attempted'); };
  assert.deepEqual(await start(event,'null',token),{ok:false,reason:'unavailable'});
  dispose();
  assert.equal(handlers.size,0);
});
