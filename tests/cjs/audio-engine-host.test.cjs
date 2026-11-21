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
  const child = childProcess(), control = new Port(), feed = new Port();
  const host = new AudioEngineHost({root:'.',platform:'win32',arch:'arm64',testBackend:'null',
    diagnostic() {},processFactory(_executable,args,options) {
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
  child.finish(7);
  assert.equal((await failed)[0].type,'engineFailure');
  assert.equal(host.active,null);
  assert.ok(control.closed && feed.closed);
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
  const contents = Object.assign(new EventEmitter(),{mainFrame:{},postMessage(channel,token,ports) {
    assert.equal(channel,'audio-engine:ports');
    assert.equal(ports.length,2);
  }});
  const host = {stopCount:0,stop() { ++this.stopCount; },async start() { this.started = true; },diagnostic() {}};
  class Channel { constructor() { this.port1 = new Port(); this.port2 = new Port(); } }
  const dispose = registerAudioEngineIpc({ipcMain,MessageChannelMain:Channel,host,
    getMainWindow:()=>({webContents:contents}),loadDriver:()=> 'wasapi'});
  const event = {sender:contents,senderFrame:contents.mainFrame};
  const start = handlers.get('audio-engine:start'), token = 'a'.repeat(36);
  assert.deepEqual(start({...event,senderFrame:{}},'wasapi',token),{ok:false});
  assert.deepEqual(await start(event,'wasapi','bad'),{ok:false});
  assert.equal((await start(event,'wasapi',token)).ok,true);
  const before = host.stopCount;
  contents.emit('did-start-navigation',{},'file:///app',true,true);
  assert.equal(host.stopCount,before);
  contents.emit('did-start-navigation',{},'file:///app',false,true);
  assert.equal(host.stopCount,before+1);
  dispose();
  assert.equal(handlers.size,0);
});
