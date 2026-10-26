import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import http from 'node:http';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const binary = fileURLToPath(new URL(`../../out/native/openhome-sidecar/${process.platform}-${process.arch}/effetune-openhome-sidecar${process.platform === 'win32' ? '.exe' : ''}`, import.meta.url));
const snapshot = {
  avTransport: { state: 'STOPPED', uri: 'https://example.test/song.mp3', metadata: '', duration: 120.125, position: 3,
    status: 'ERROR_OCCURRED', speed: '3/2', playMode: 'SHUFFLE', protocolInfo: 'http-get:*:audio/mpeg:*',
    seekable: true, actions: 'Play,Stop,Seek,Next,Previous' },
  renderingControl: { volume: 70, mute: false }
};

function within(promise, ms = 7000, stage = '') {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Native UPnP response timed out (${stage || promise.stage || 'unspecified'})`)), ms); })])
    .finally(() => clearTimeout(timer));
}

test('native UPnP renderer publishes required services, SOAP errors and initial/change events', { skip: !existsSync(binary), timeout: 30000 }, async t => {
  const address = '127.0.0.1';
  const child = spawn(binary, ['--stdio', '--loopback'], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let buffer = '', diagnostics = '';
  child.stderr.on('data', bytes => { diagnostics += bytes; });
  const exit = new Promise(resolve => child.once('exit', resolve));
  const send = value => child.stdin.write(`${JSON.stringify(value)}\n`);
  const seeks = [];
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  child.stdout.on('data', bytes => {
    buffer += bytes;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (message.type === 'ready') readyResolve();
      if (message.type === 'action') {
        if (message.service === 'AVTransport' && message.action === 'Seek') { seeks.push(message.args.seconds); snapshot.avTransport.position = message.args.seconds; }
        if (message.service === 'RenderingControl' && message.action === 'SetVolume') snapshot.renderingControl.volume = message.args.volume;
        send({ type: 'response', requestId: message.requestId, ok: true,
          result: message.action === 'Snapshot' ? message.service === 'AVTransport' ? snapshot.avTransport : snapshot.renderingControl : {} });
        send({ type: 'state', snapshot });
      }
    }
  });
  const socket = dgram.createSocket('udp4');
  const events = [];
  const receiver = http.createServer((request,response) => {
    let body = '';
    request.on('data', bytes => { body += bytes; });
    request.on('end', () => { events.push(body); response.writeHead(200); response.end(); });
  });
  t.after(async () => {
    try { socket.close(); } catch (_) { /* Not bound after a startup failure. */ }
    receiver.closeAllConnections();
    await new Promise(resolve => receiver.close(resolve));
    send({ type: 'shutdown' });
    try { await within(exit); } catch (_) { child.kill(); await within(exit); }
  });
  send({ type: 'configure', protocolVersion: 1,
    device: { friendlyName: 'EffeTune Test', udn: 'uuid:0b445178-7186-43a7-b619-b79d161e20a0',
      openHomeEnabled: false, upnpAvEnabled: true, upnpAvUdn: 'uuid:9068c0b1-7ccf-43ae-abd5-f89b86e0cbec' } });
  ready.stage = 'ready';
  await within(ready);
  send({ type: 'state', snapshot });
  await new Promise(resolve => receiver.listen(0, address, resolve));
  await new Promise(resolve => socket.bind(0, '0.0.0.0', resolve));
  socket.setMulticastInterface(address);
  socket.setMulticastLoopback(true);
  const location = within(new Promise(resolve => {
    socket.on('message', bytes => { const match = /^LOCATION:\s*(.+)$/im.exec(String(bytes)); if (match && String(bytes).includes('9068c0b1-7ccf-43ae-abd5-f89b86e0cbec')) resolve(match[1].trim()); });
  }), 7000, 'discovery');
  socket.send(Buffer.from('M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 1\r\nST: ssdp:all\r\n\r\n'), 1900, '239.255.255.250');
  const base = await location;
  const description = await (await fetch(base)).text();
  assert.match(description, /urn:schemas-upnp-org:device:MediaRenderer:1/);
  assert.match(description, /EffeTune Test \(UPnP\)/);
  const services = new Map([...description.matchAll(/<service>([\s\S]*?)<\/service>/g)].map(([,xml]) => {
    const value = key => new RegExp(`<${key}>([^<]*)</${key}>`).exec(xml)?.[1];
    return [value('serviceType').split(':').at(-2), { type: value('serviceType'), control: new URL(value('controlURL'),base),
      event: new URL(value('eventSubURL'),base), scpd: new URL(value('SCPDURL'),base) }];
  }));
  assert.deepEqual([...services.keys()].sort(), ['AVTransport','ConnectionManager','RenderingControl']);
  const actions = ['SetAVTransportURI','GetMediaInfo','GetTransportInfo','GetPositionInfo','GetDeviceCapabilities','GetTransportSettings','Play','Pause','Stop','Seek','Next','Previous','GetCurrentTransportActions'];
  const scpd = await (await fetch(services.get('AVTransport').scpd)).text();
  for (const action of actions) assert.ok(scpd.includes(`<name>${action}</name>`), action);
  async function soap(service,action,args) {
    const s = services.get(service);
    const response = await fetch(s.control, { method: 'POST', headers: { 'Content-Type': 'text/xml; charset="utf-8"', SOAPAction: `"${s.type}#${action}"` },
      body: `<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${s.type}">${args}</u:${action}></s:Body></s:Envelope>` });
    return { status: response.status, body: await response.text() };
  }
  const transportInfo = (await soap('AVTransport','GetTransportInfo','<InstanceID>0</InstanceID>')).body;
  assert.match(transportInfo, /<CurrentTransportState>STOPPED/);
  assert.match(transportInfo, /<CurrentTransportStatus>ERROR_OCCURRED/);
  assert.match(transportInfo, /<CurrentSpeed>3\/2/);
  assert.match((await soap('AVTransport','GetTransportSettings','<InstanceID>0</InstanceID>')).body, /<PlayMode>SHUFFLE/);
  assert.match((await soap('AVTransport','GetMediaInfo','<InstanceID>0</InstanceID>')).body, /<MediaDuration>0:02:00.125/);
  assert.match((await soap('AVTransport','Play','<InstanceID>1</InstanceID><Speed>1</Speed>')).body, /<errorCode>718/);
  assert.match((await soap('AVTransport','Play','<InstanceID>0</InstanceID><Speed>2</Speed>')).body, /<errorCode>717/);
  assert.equal((await soap('AVTransport','Seek','<InstanceID>0</InstanceID><Unit>TRACK_NR</Unit><Target>1</Target>')).status, 200);
  assert.equal(seeks.at(-1), 0);
  assert.match((await soap('AVTransport','Seek','<InstanceID>0</InstanceID><Unit>TRACK_NR</Unit><Target>2</Target>')).body, /<errorCode>711/);
  assert.equal((await soap('AVTransport','Seek','<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>0:00:01.125</Target>')).status, 200);
  assert.equal(seeks.at(-1), 1.125);
  assert.equal((await soap('AVTransport','Seek','<InstanceID>0</InstanceID><Unit>ABS_TIME</Unit><Target>0:00:02.1/4</Target>')).status, 200);
  assert.equal(seeks.at(-1), 2.25);
  assert.match((await soap('AVTransport','Seek','<InstanceID>0</InstanceID><Unit>REL_TIME</Unit><Target>0:00:60.1</Target>')).body, /<errorCode>711/);
  assert.match((await soap('AVTransport','Seek','<InstanceID>0</InstanceID><Unit>FRAME</Unit><Target>1</Target>')).body, /<errorCode>710/);
  const sinkProtocols = (await soap('ConnectionManager','GetProtocolInfo','')).body;
  for (const mime of ['audio/mpeg', 'audio/mp3', 'audio/x-mp3', 'audio/flac', 'audio/x-flac',
    'audio/wav', 'audio/x-wav', 'audio/ogg', 'application/ogg', 'audio/webm', 'audio/mp4',
    'audio/x-m4a', 'audio/aac', 'audio/matroska', 'audio/x-matroska']) assert.ok(sinkProtocols.includes(`http-get:*:${mime}:*`), mime);
  assert.equal(sinkProtocols.includes('http-get:*:audio/*:*'), false);
  assert.match((await soap('ConnectionManager','GetCurrentConnectionInfo','<ConnectionID>0</ConnectionID>')).body, /<ProtocolInfo>http-get:\*:audio\/mpeg:\*/);
  snapshot.avTransport.protocolInfo = 'http-get:*:audio/flac:*';
  assert.match((await soap('ConnectionManager','GetCurrentConnectionInfo','<ConnectionID>0</ConnectionID>')).body, /<ProtocolInfo>http-get:\*:audio\/flac:\*/);
  snapshot.avTransport.protocolInfo = '';
  assert.match((await soap('ConnectionManager','GetCurrentConnectionInfo','<ConnectionID>0</ConnectionID>')).body, /<ProtocolInfo><\/ProtocolInfo>|<ProtocolInfo\s*\/>/);
  assert.match((await soap('RenderingControl','ListPresets','<InstanceID>0</InstanceID>')).body, /FactoryDefaults/);
  const subscription = await fetch(services.get('RenderingControl').event, { method: 'SUBSCRIBE', headers: {
    CALLBACK: `<http://${address}:${receiver.address().port}/events>`, NT: 'upnp:event', TIMEOUT: 'Second-30' } });
  assert.equal(subscription.status, 200, diagnostics);
  const sid = subscription.headers.get('sid');
  async function waitEvent(predicate) {
    let timer;
    const pending = new Promise(resolve => {
      timer = setInterval(() => { if (events.some(predicate)) resolve(); }, 10);
    });
    pending.stage = `event: ${events.join(' | ')}`;
    try { await within(pending); } finally { clearInterval(timer); }
  }
  await waitEvent(body => body.includes('Volume') && body.includes('70'));
  assert.equal((await soap('RenderingControl','SetVolume','<InstanceID>0</InstanceID><Channel>Master</Channel><DesiredVolume>35</DesiredVolume>')).status, 200);
  await waitEvent(body => body.includes('Volume') && body.includes('35'));
  await fetch(services.get('RenderingControl').event, { method: 'UNSUBSCRIBE', headers: { SID: sid } });
  events.length = 0;
  const avSubscription = await fetch(services.get('AVTransport').event, { method: 'SUBSCRIBE', headers: {
    CALLBACK: `<http://${address}:${receiver.address().port}/events>`, NT: 'upnp:event', TIMEOUT: 'Second-30' } });
  assert.equal(avSubscription.status, 200);
  await waitEvent(body => body.includes('CurrentPlayMode') && body.includes('SHUFFLE'));
  const initial = events.at(-1);
  for (const field of ['NumberOfTracks', 'CurrentTrack', 'CurrentMediaDuration', 'PlaybackStorageMedium',
    'PossiblePlaybackStorageMedia', 'RecordStorageMedium', 'PossibleRecordStorageMedia', 'RecordMediumWriteStatus',
    'CurrentRecordQualityMode', 'PossibleRecordQualityModes', 'TransportPlaySpeed', 'TransportStatus']) assert.ok(initial.includes(field), field);
  assert.equal(initial.includes('RelativeTimePosition'), false);
  Object.assign(snapshot.avTransport, { playMode: 'REPEAT_ALL', status: 'OK', speed: '1', duration: 240.5 });
  send({ type: 'state', snapshot });
  await waitEvent(body => body.includes('REPEAT_ALL') && body.includes('0:04:00.500'));
  await new Promise(resolve => setTimeout(resolve, 250));
  const count = events.length;
  snapshot.avTransport.position = 4;
  send({ type: 'state', snapshot });
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(events.length, count);
  await fetch(services.get('AVTransport').event, { method: 'UNSUBSCRIBE', headers: { SID: avSubscription.headers.get('sid') } });
});
