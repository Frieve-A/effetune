const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const { AirPlayReceiverHost, MAX_QUEUED_FRAMES } = require('../../electron/airplay-receiver.cjs');

function packet(sequence,timestamp,frames = 1000) {
  const bytes = Buffer.alloc(12 + frames * 4); bytes[0]=128; bytes[1]=96;
  bytes.writeUInt16BE(sequence & 65535,2); bytes.writeUInt32BE(timestamp,4); bytes.writeUInt32BE(7,8);
  return bytes;
}
function harness(available = true, failures = {}) {
  const children = [], sockets = [], statuses = [], diagnostics = [], directories = [];
  const port = new EventEmitter(); port.messages = []; port.start = () => {}; port.close = () => { port.closed = true; };
  port.postMessage = message => port.messages.push(message);
  const host = new AirPlayReceiverHost({ executablePath: '/resources/airplay/uxplay', resourceDirectory: '/resources/airplay',
    fileSystem: { ...fs, statSync() { if (!available) throw new Error('missing'); return { isFile: () => true }; },
      mkdtempSync(prefix) { const directory = fs.realpathSync(fs.mkdtempSync(prefix)); directories.push(directory); return directory; } },
    onStatus: status => statuses.push(status), onDiagnostic: code => diagnostics.push(code),
    processFactory(executable,args,options) {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.executable = executable; child.args = args; child.options = options;
      child.kill = () => { child.killed = true; child.emit('exit',0,null); return true; };
      children.push(child);
      queueMicrotask(() => {
        if (failures.spawnError) { child.emit('error', failures.spawnError); child.emit('close', -1, null); }
        else child.emit('spawn');
      });
      return child;
    },
    socketFactory() {
      const socket = new EventEmitter(); socket.bind = (port,address) => {
        socket.boundAddress = address;
        if (failures.bindError) queueMicrotask(() => socket.emit('error', failures.bindError));
        else socket.emit('listening');
      };
      socket.address = () => ({ port: 41321 }); socket.close = () => { socket.closed = true; };
      sockets.push(socket); return socket;
    }
  });
  return { host, children, sockets, port, statuses, diagnostics, directories,
    receive(sequence,timestamp,frames) { sockets.at(-1).emit('message',packet(sequence,timestamp,frames),{ address: '127.0.0.1',port: 45678 }); },
    credit(generation = host.generation) { port.emit('message',{data:{type:'credit',generation}}); } };
}

test('AirPlay starts only with permission and renderer ownership and uses fixed loopback helper argv', async () => {
  const h = harness();
  await h.host.setConfiguration({enabled:true,friendlyName:'Living Room'});
  assert.equal(h.children.length,0);
  await h.host.attachRendererPort(h.port);
  assert.equal(h.sockets[0].boundAddress,'127.0.0.1');
  assert.equal(h.children[0].options.shell,false);
  assert.deepEqual(h.children[0].args,['-n','Living Room','-nh','-vs','0','-rc',path.join('/resources/airplay','uxplay.conf'),
    '-md',path.join(h.host.artifacts.directory,'metadata.txt'),'-ca',path.join(h.host.artifacts.directory,'artwork'),
    '-artp','pt=96 ! udpsink host=127.0.0.1 port=41321']);
  h.receive(1,0);
  assert.deepEqual(h.port.messages.map(message => message.type),['start','information','artwork','pcm']);
  assert.equal(h.host.getStatus().receiving,false);
  h.port.emit('message',{data:{type:'ready',generation:h.host.generation}});
  assert.equal(h.host.getStatus().receiving,true);
  await h.host.dispose();
  assert.equal(h.children[0].killed,true);
  assert.equal(h.sockets[0].closed,true);
  assert.equal(h.port.closed,true);
});

test('AirPlay binary transport stays bounded while renderer credit is delayed and re-buffers old audio', async () => {
  const h = harness();
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({enabled:true});
  for (let index=0;index<100;index+=1) h.receive(index,index*1000);
  assert.equal(h.port.messages.filter(message=>message.type==='pcm').length,1);
  assert.ok(h.host.queuedFrames <= MAX_QUEUED_FRAMES);
  h.credit();
  assert.equal(h.port.messages.filter(message=>message.type==='pcm').length,2);
  assert.ok(h.port.messages.some(message=>message.type==='reset'));
  const oldGeneration = h.host.generation;
  await h.host.stopSession();
  assert.equal(h.children.length,2);
  assert.equal(h.port.messages.at(-1).type,'end');
  h.port.emit('message',{data:{type:'ready',generation:oldGeneration}});
  assert.equal(h.host.getStatus().receiving,false);
  await h.host.dispose();
});

test('AirPlay helper failure and renderer loss release PCM and prevent stale callbacks from restarting audio', async () => {
  const h = harness();
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({enabled:true});
  h.receive(1,0);
  const first = h.children[0], socket = h.sockets[0];
  first.emit('exit',2,null);
  assert.equal(h.host.getStatus().state,'failed');
  assert.equal(h.host.queuedFrames,0);
  socket.emit('message',packet(2,1000),{address:'127.0.0.1',port:45678});
  assert.equal(h.port.messages.at(-1).type,'end');
  await h.host.setRendererUnavailable();
  assert.equal(h.port.closed,true);
  assert.equal(h.children.length,1);
  await h.host.dispose();
});

test('AirPlay unavailable resource closure fails before creating a socket or helper', async () => {
  const h = harness(false);
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({enabled:true});
  assert.equal(h.host.getStatus().state,'unavailable');
  assert.equal(h.sockets.length,0);
  assert.equal(h.children.length,0);
  await h.host.dispose();
});

test('AirPlay ends on the backend connection count and reconnects with a fresh generation', async () => {
  const h = harness();
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({enabled:true});
  const first = h.children[0];
  first.stdout.emit('data',Buffer.from('Open connections: 0\n'));
  await h.host.operation;
  assert.equal(h.children.length,1);
  h.receive(1,0);
  const generation = h.host.generation;
  first.stdout.emit('data',Buffer.from('Open connections: '));
  first.stdout.emit('data',Buffer.from('0\n'));
  await h.host.operation;
  assert.equal(h.children.length,2);
  assert.ok(h.port.messages.some(message=>message.type==='end' && message.generation===generation));
  h.receive(1,0);
  assert.ok(h.host.generation > generation);
  assert.equal(h.port.messages.filter(message=>message.type==='start').at(-1).generation,h.host.generation);
  first.stdout.emit('data',Buffer.from('Open connections: 0\n'));
  await h.host.operation;
  assert.equal(h.children.length,2);
  await h.host.dispose();
});

test('AirPlay recognizes connection teardown after carriage-return progress records across stdout chunks', async t => {
  const records = [
    ['same chunk', ['audio progress (min:sec): 0:05\rOpen connections: 0\n']],
    ['separate chunks', ['audio progress (min:sec): 0:05\r', 'Open connections: 0\n']],
    ['split record and CRLF', ['audio progress (min:sec): 0:05\r', '\nOpen con', 'nections: 0\r', '\n']],
    ['LF progress', ['audio progress (min:sec): 0:05\nOpen connections: 0\n']]
  ];
  for (const [name, chunks] of records) await t.test(name, async subtest => {
    const h = harness();
    subtest.after(() => h.host.dispose());
    await h.host.attachRendererPort(h.port);
    await h.host.setConfiguration({ enabled: true });
    const first = h.children[0], socket = h.sockets[0];
    h.receive(1, 0);
    const generation = h.host.generation;
    h.port.emit('message', { data: { type: 'ready', generation } });
    first.stdout.emit('data', Buffer.from('audio progress (min:sec): 0:04\r'));
    first.stdout.emit('data', Buffer.from('audio paused\r\n'));
    await h.host.operation;
    assert.equal(h.host.getStatus().receiving, true);
    assert.equal(first.killed, undefined);
    assert.equal(h.port.messages.some(message => message.type === 'end'), false);
    for (const chunk of chunks) first.stdout.emit('data', Buffer.from(chunk));
    await h.host.operation;
    assert.equal(first.killed, true);
    assert.equal(socket.closed, true);
    assert.equal(h.children.length, 2);
    assert.equal(h.host.getStatus().receiving, false);
    assert.deepEqual(h.port.messages.filter(message => message.type === 'end'), [{ type: 'end', generation }]);
    assert.ok(h.host.generation > generation);
  });
});

test('AirPlay replays actual sender, receiver format and complete progress records without an elapsed-time clock', async t => {
  const h = harness();
  t.after(() => h.host.dispose());
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({ enabled: true });
  const output = h.children[0].stdout;
  const sender = Buffer.from('connection request from 音楽 iPad (iPad13,4) with deviceID = private-id\n');
  output.emit('data', sender.subarray(0, 25));
  output.emit('data', sender.subarray(25));
  output.emit('data', Buffer.from('ct=2 spf=352 usingScreen=0 isMedia=1  audioFormat=0x40000\n'));
  output.emit('data', Buffer.from('audio progress (min:sec):   1:05; remaining:   2:10; track len'));
  assert.equal(h.host.information.position, null);
  output.emit('data', Buffer.from('gth 3:15\r'));
  assert.equal(h.port.messages.length, 0);
  h.receive(1, 0);
  const info = h.port.messages.find(message => message.type === 'information').information;
  assert.deepEqual(info, { position: 65, duration: 195, metadata: {},
    sender: { name: '音楽 iPad', model: 'iPad13,4' },
    format: { codec: 'ALAC', sampleRate: 44100, channels: 2, bitsPerSample: 16 } });
  assert.equal(JSON.stringify(info).includes('private-id'), false);
  const count = h.port.messages.filter(message => message.type === 'information').length;
  output.emit('data', Buffer.from('audio paused\r'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(h.host.information.position, 65);
  assert.equal(h.port.messages.filter(message => message.type === 'information').length, count);
  const generation = h.host.generation;
  await h.host.stopSession();
  output.emit('data', Buffer.from('audio progress (min:sec): 9:59; remaining: 0:01; track length 10:00\r'));
  assert.ok(h.host.generation > generation);
  assert.equal(h.host.information.position, null);
  assert.deepEqual(h.host.information.sender, {});
});

test('AirPlay bounded private exports preserve independent artwork and replace complete metadata snapshots', async t => {
  const h = harness();
  t.after(() => h.host.dispose());
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({ enabled: true });
  const directory = fs.realpathSync(h.host.artifacts.directory);
  const metadataFile = path.join(directory, 'metadata.txt'), artworkFile = path.join(directory, 'artwork');
  const artwork = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN8sAAAAASUVORK5CYII=', 'base64');
  fs.writeFileSync(artworkFile, artwork);
  fs.writeFileSync(metadataFile, 'Title: incomplete');
  await h.host.readArtifacts();
  assert.deepEqual(h.host.information.metadata, {});
  assert.equal(h.host.artwork, null);
  await h.host.readArtifacts();
  assert.equal(h.host.artwork.mimeType, 'image/png');
  fs.writeFileSync(metadataFile, 'Title: 曲名\nArtist: Artist\nAlbum artist: Group\nComposer: Composer\nGenre: Classical\nComment: first line\nsecond line\nSort Name: Sort title\nKeywords: one, two\n\0');
  await h.host.readArtifacts();
  h.receive(1, 0);
  assert.deepEqual(h.port.messages.find(message => message.type === 'information').information.metadata, {
    title: '曲名', artist: 'Artist', albumArtist: 'Group', composer: 'Composer', genre: 'Classical',
    comment: 'first line\nsecond line', sortName: 'Sort title', keywords: 'one, two'
  });
  assert.deepEqual(Buffer.from(h.port.messages.find(message => message.type === 'artwork').artwork.bytes), artwork);
  const artworkCount = h.port.messages.filter(message => message.type === 'artwork').length;
  fs.writeFileSync(metadataFile, 'Title: Next song\n\0');
  await h.host.readArtifacts();
  assert.deepEqual(h.host.information.metadata, { title: 'Next song' });
  assert.equal(h.port.messages.filter(message => message.type === 'artwork').length, artworkCount);
  assert.deepEqual(Buffer.from(h.host.artwork.bytes), artwork);
  fs.writeFileSync(artworkFile, artwork.subarray(0, artwork.length - 4));
  await h.host.readArtifacts();
  await h.host.readArtifacts();
  assert.equal(h.port.messages.filter(message => message.type === 'artwork').length, artworkCount);
  fs.truncateSync(artworkFile, 8 * 1024 * 1024 + 1);
  await h.host.readArtifacts();
  assert.equal(h.port.messages.filter(message => message.type === 'artwork').length, artworkCount);
  await h.host.stopSession();
  assert.equal(fs.existsSync(directory), false);
  assert.equal(h.host.artwork, null);
  assert.deepEqual(h.host.information.metadata, {});
});

test('AirPlay reports only observed sender slider volume and consumes complete information records', async t => {
  const h = harness();
  t.after(() => h.host.dispose());
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({ enabled: true });
  const output = h.children[0].stdout;
  assert.equal(h.host.information.sender.volumePercent, undefined);
  output.emit('data', Buffer.from('EFFETUNE_AIRPLAY_VOL'));
  output.emit('data', Buffer.from('UME {"fraction":0.5}\r\n'));
  assert.equal(h.host.information.sender.volumePercent, 50);
  output.emit('data', Buffer.from('connection request from Phone (Model) with deviceID = hidden\n'));
  h.receive(1, 0);
  assert.deepEqual(h.port.messages.find(message => message.type === 'information').information.sender,
    { volumePercent: 50, name: 'Phone', model: 'Model' });
  for (const fraction of ['0', '1', '5e-1']) {
    output.emit('data', Buffer.from(`EFFETUNE_AIRPLAY_VOLUME {"fraction":${fraction}}\n`));
    assert.equal(h.port.messages.at(-1).information.sender.volumePercent, Number(fraction) * 100);
  }
  assert.equal(h.diagnostics.includes('airplay-helper-output'), false);
  for (const fraction of ['-1', '1.5', 'NaN', '1e999']) {
    output.emit('data', Buffer.from(`EFFETUNE_AIRPLAY_VOLUME {"fraction":${fraction}}\n`));
    assert.equal(h.host.information.sender.volumePercent, 50);
  }
  assert.ok(h.diagnostics.includes('airplay-helper-output'));
  const generation = h.host.generation;
  await h.host.stopSession();
  output.emit('data', Buffer.from('EFFETUNE_AIRPLAY_VOLUME {"fraction":1}\n'));
  assert.ok(h.host.generation > generation);
  assert.equal(h.host.information.sender.volumePercent, undefined);
});

test('AirPlay discards an export read that completes after its helper generation ends', async t => {
  const h = harness();
  t.after(() => h.host.dispose());
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({ enabled: true });
  h.receive(1, 0);
  let finishRead;
  const read = new Promise(resolve => { finishRead = resolve; });
  const readArtifact = h.host.readArtifact;
  h.host.readArtifact = () => read;
  const pending = h.host.readArtifacts();
  const stopping = h.host.stopSession();
  await new Promise(resolve => setImmediate(resolve));
  finishRead({ bytes: Buffer.from('Title: stale\n\0'), version: '1' });
  await Promise.all([pending, stopping]);
  h.host.readArtifact = readArtifact;
  assert.equal(h.host.information.metadata.title, undefined);
  assert.equal(h.port.messages.some(message => message.information?.metadata.title === 'stale'), false);
});


test('AirPlay environment loss ends reception while retaining its renderer port and resumes one fresh helper', { timeout: 2000 }, async t => {
  const h = harness();
  t.after(() => h.host.dispose());
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({ enabled: true });
  h.receive(1, 0);
  h.receive(2, 1000);
  const generation = h.host.generation;
  h.port.emit('message', { data: { type: 'ready', generation } });
  assert.equal(h.host.getStatus().state, 'receiving');
  assert.ok(h.host.queuedFrames > 0);
  const child = h.children[0], socket = h.sockets[0], receiver = h.host.receiver;
  const lateMessage = socket.listeners('message')[0];
  await h.host.setEnvironmentAvailable(false);
  assert.equal(h.host.getStatus().state, 'unavailable');
  assert.equal(child.killed, true);
  assert.equal(socket.closed, true);
  assert.equal(h.host.timer, null);
  assert.equal(h.host.child, null);
  assert.equal(h.host.receiver, null);
  assert.equal(h.host.queuedFrames, 0);
  assert.equal(h.host.inFlight, false);
  assert.equal(h.host.rendererPort, h.port);
  assert.equal(h.port.closed, undefined);
  assert.deepEqual(h.port.messages.filter(message => message.type === 'end'), [{ type: 'end', generation }]);
  assert.ok(h.directories.every(directory => !fs.existsSync(directory)));
  const messageCount = h.port.messages.length;
  lateMessage(packet(3, 2000), { address: '127.0.0.1', port: 45678 });
  receiver.push(packet(3, 2000), Date.now());
  child.stdout.emit('data', Buffer.from('EFFETUNE_AIRPLAY_VOLUME {"fraction":1}\n'));
  h.credit(generation);
  h.port.emit('message', { data: { type: 'ready', generation } });
  assert.equal(h.port.messages.length, messageCount);
  assert.equal(h.host.getStatus().state, 'unavailable');
  await h.host.setEnvironmentAvailable(true);
  assert.equal(h.children.length, 2);
  assert.equal(h.sockets.length, 2);
  assert.equal(h.host.getStatus().state, 'ready');
  child.emit('exit', 0, null);
  lateMessage(packet(4, 3000), { address: '127.0.0.1', port: 45678 });
  assert.equal(h.port.messages.length, messageCount);
  assert.equal(h.host.child, h.children[1]);
  h.receive(1, 0);
  h.port.emit('message', { data: { type: 'ready', generation: h.host.generation } });
  assert.equal(h.host.getStatus().state, 'receiving');
  assert.ok(h.host.generation > generation);
  assert.equal(h.port.messages.filter(message => message.type === 'start').length, 2);
  assert.equal(h.port.messages.at(-1).generation, h.host.generation);
  assert.deepEqual(h.diagnostics, []);
});

test('AirPlay escalates an ignored graceful stop and waits for close before creating its replacement', { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const signals = [];
  let child;
  t.after(async () => { t.mock.timers.reset(); child?.emit('close', 0, 'SIGKILL'); await h.host.dispose(); });
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({ enabled: true });
  h.receive(1, 0);
  child = h.children[0];
  child.kill = signal => { signals.push(signal ?? 'SIGTERM'); return true; };
  const restarting = h.host.stopSession();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(signals, ['SIGTERM']);
  t.mock.timers.tick(1499);
  await Promise.resolve();
  assert.deepEqual(signals, ['SIGTERM']);
  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(h.children.length, 1, 'the original process owns the slot until close');
  assert.equal(h.host.child, child);
  assert.equal(h.sockets[0].closed, true);
  child.emit('close', null, 'SIGKILL');
  await restarting;
  assert.equal(h.children.length, 2);
  assert.equal(h.host.child, h.children[1]);
  assert.equal(h.host.getStatus().state, 'ready');
  assert.equal(fs.existsSync(h.directories[0]), false);
  h.receive(1, 0);
  assert.equal(h.port.messages.at(-1).type, 'pcm');
  assert.deepEqual(h.diagnostics, []);
});

test('AirPlay bounds shutdown failure and never overlaps a helper that ignores both termination signals', { timeout: 2000 }, async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  const signals = [];
  let child;
  t.after(async () => { t.mock.timers.reset(); child?.emit('close', 0, 'SIGKILL'); await h.host.dispose(); });
  await h.host.attachRendererPort(h.port);
  await h.host.setConfiguration({ enabled: true });
  h.receive(1, 0);
  child = h.children[0];
  child.kill = signal => { signals.push(signal ?? 'SIGTERM'); return true; };
  const restarting = h.host.stopSession();
  await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(1500);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  t.mock.timers.tick(1499);
  await Promise.resolve();
  assert.notEqual(h.host.getStatus().state, 'failed');
  t.mock.timers.tick(1);
  const status = await restarting;
  assert.equal(status.state, 'failed');
  assert.ok(h.diagnostics.includes('airplay-lifecycle-failed'));
  assert.equal(h.host.child, child);
  assert.equal(h.host.socket, null);
  assert.equal(h.host.timer, null);
  assert.equal(h.host.queuedFrames, 0);
  assert.equal(h.port.closed, undefined);
  assert.equal(h.port.messages.at(-1).type, 'end');
  await h.host.setConfiguration({ enabled: true });
  assert.equal(h.children.length, 1, 'failed termination must not release the process slot');
  assert.equal(h.host.getStatus().state, 'failed');
  child.emit('close', null, 'SIGKILL');
  await h.host.artifactCleanup;
  assert.equal(h.host.child, null);
  assert.ok(h.directories.every(directory => !fs.existsSync(directory)));
});

for (const failure of ['bind', 'socket', 'spawn']) {
  test(`AirPlay ${failure} errors release owned resources and allow explicit recovery without accepting stale data`, { timeout: 2000 }, async t => {
    const error = new Error(`fixture ${failure} failure`);
    const failures = failure === 'bind' ? { bindError: error } : failure === 'spawn' ? { spawnError: error } : {};
    const h = harness(true, failures);
    t.after(() => h.host.dispose());
    await h.host.attachRendererPort(h.port);
    await h.host.setConfiguration({ enabled: true });
    const socket = h.sockets[0], child = h.children[0];
    const lateMessage = socket.listeners('message')[0];
    const generation = h.host.generation;
    if (failure === 'socket') {
      h.receive(1, 0);
      h.port.emit('message', { data: { type: 'ready', generation } });
      assert.equal(h.host.getStatus().state, 'receiving');
      socket.emit('error', error);
      await h.host.operation;
      assert.equal(child.killed, true);
      assert.equal(h.port.messages.at(-1).type, 'end');
    }
    await h.host.artifactCleanup;
    assert.equal(h.host.getStatus().state, 'failed');
    assert.equal(h.statuses.at(-1).state, 'failed');
    assert.ok(h.diagnostics.includes(failure === 'bind' ? 'airplay-lifecycle-failed' : failure === 'socket' ? 'airplay-socket-failed' : 'airplay-helper-failed'));
    assert.equal(socket.closed, true);
    assert.equal(h.host.socket, null);
    assert.equal(h.host.child, null);
    assert.equal(h.host.receiver, null);
    assert.equal(h.host.timer, null);
    assert.equal(h.host.queuedFrames, 0);
    assert.equal(h.host.inFlight, false);
    assert.ok(h.directories.every(directory => !fs.existsSync(directory)));
    assert.equal(h.host.rendererPort, h.port);
    assert.equal(h.port.closed, undefined);
    const childCount = h.children.length;
    failures.bindError = failures.spawnError = null;
    await h.host.setConfiguration({ enabled: true });
    assert.equal(h.children.length, childCount + 1);
    assert.equal(h.host.getStatus().state, 'ready');
    const messageCount = h.port.messages.length;
    const diagnosticCount = h.diagnostics.length;
    lateMessage?.(packet(2, 1000), { address: '127.0.0.1', port: 45678 });
    socket.emit('message', packet(2, 1000), { address: '127.0.0.1', port: 45678 });
    socket.emit('listening');
    child?.stdout.emit('data', Buffer.from('EFFETUNE_AIRPLAY_VOLUME {"fraction":1}\n'));
    child?.emit('spawn');
    child?.emit('exit', 1, null);
    h.port.emit('message', { data: { type: 'ready', generation } });
    assert.equal(h.host.getStatus().state, 'ready');
    assert.equal(h.port.messages.length, messageCount);
    assert.equal(h.diagnostics.length, diagnosticCount);
    h.receive(1, 0);
    h.port.emit('message', { data: { type: 'ready', generation: h.host.generation } });
    assert.equal(h.host.getStatus().state, 'receiving');
    assert.equal(h.port.messages.at(-1).type, 'pcm');
    assert.equal(h.host.information.sender.volumePercent, undefined);
  });
}
