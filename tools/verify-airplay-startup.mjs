import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import dgram from 'node:dgram';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { airplayRuntimeEnvironment } from './verify-airplay-package.mjs';

// This fixture owns one short-lived receiver and every socket it opens.
// It never changes the machine's discovery service or other application state.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.resolve(process.argv[2] || path.join(root, 'out', 'native',
  'airplay-receiver', `${process.platform}-${process.arch}`));
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'runtime-manifest.json'), 'utf8'));
assert.equal(manifest.platform, process.platform);
assert.equal(manifest.architecture, process.arch);
const temporaryParent = fs.realpathSync(os.tmpdir());
const temporaryRoot = fs.realpathSync(fs.mkdtempSync(path.join(temporaryParent, 'effetune-airplay-startup-')));
const reservations = [];
let child = null;
let client = null;
let rtp = null;
let output = '';
let childClosed = false;
let childError = null;

// The SETUP control fixture initializes RTP without a media stream or pairing.
// Encode only the byte/string/uint16 dictionary values needed by that request.
function setupBody(timingPort) {
  const values = { eiv: Buffer.alloc(16), ekey: Buffer.alloc(72), deviceID: '02:00:00:00:00:01',
    name: 'EffeTune volume fixture', model: 'Test', timingProtocol: 'NTP', timingPort };
  const objects = [];
  const encode = value => {
    if (typeof value === 'number') {
      const bytes = Buffer.alloc(3); bytes[0] = 0x11; bytes.writeUInt16BE(value, 1); return bytes;
    }
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const type = Buffer.isBuffer(value) ? 0x40 : 0x50;
    const header = data.length < 15 ? Buffer.from([type + data.length]) : Buffer.from([type + 15, 0x10, data.length]);
    return Buffer.concat([header, data]);
  };
  for (const key of Object.keys(values)) objects.push(encode(key));
  for (const value of Object.values(values)) objects.push(encode(value));
  const count = Object.keys(values).length;
  objects.push(Buffer.from([0xd0 + count, ...Array.from({ length: count * 2 }, (_, index) => index)]));
  const offsets = [];
  let length = 8;
  for (const object of objects) { offsets.push(length); length += object.length; }
  const table = Buffer.alloc(offsets.length * 2);
  offsets.forEach((offset, index) => table.writeUInt16BE(offset, index * 2));
  const trailer = Buffer.alloc(32); trailer[6] = 2; trailer[7] = 1;
  trailer.writeBigUInt64BE(BigInt(objects.length), 8);
  trailer.writeBigUInt64BE(BigInt(objects.length - 1), 16);
  trailer.writeBigUInt64BE(BigInt(length), 24);
  return Buffer.concat([Buffer.from('bplist00'), ...objects, table, trailer]);
}

async function reserveTcp() {
  const server = net.createServer();
  server.listen(0, '0.0.0.0');
  await once(server, 'listening');
  reservations.push(server);
  return server.address().port;
}

async function reserveUdp() {
  const socket = dgram.createSocket('udp4');
  socket.bind(0, '0.0.0.0');
  await once(socket, 'listening');
  reservations.push(socket);
  return socket.address().port;
}

function closeReservation(resource) {
  return new Promise(resolve => resource.close(resolve));
}

try {
  const tcpPorts = [await reserveTcp(), await reserveTcp(), await reserveTcp()];
  const udpPorts = [await reserveUdp(), await reserveUdp(), await reserveUdp()];
  rtp = dgram.createSocket('udp4');
  rtp.bind(0, '127.0.0.1');
  await once(rtp, 'listening');
  await Promise.all(reservations.splice(0).map(closeReservation));
  const hardwareAddress = Buffer.concat([Buffer.from([2]), randomBytes(5)]).toString('hex')
    .match(/../g).join(':');
  const args = ['-n', `EffeTune startup smoke ${randomUUID().slice(0, 8)}`, '-nh', '-vs', '0',
    '-rc', path.join(directory, 'uxplay.conf'),
    '-artp', `pt=96 ! udpsink host=127.0.0.1 port=${rtp.address().port}`,
    '-m', hardwareAddress, '-p', 'tcp', tcpPorts.join(','), '-p', 'udp', udpPorts.join(',')];
  child = spawn(path.join(directory, process.platform === 'win32' ? 'uxplay.exe' : 'uxplay'), args,
    { cwd: directory, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: airplayRuntimeEnvironment(directory, path.join(temporaryRoot, 'registry.bin')) });
  const append = bytes => {
    output = (output + bytes.toString('utf8').replaceAll('\r', '')).slice(-65536);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  child.on('error', error => { childError = error; });
  child.once('close', () => { childClosed = true; });
  const deadline = Date.now() + 8000;
  async function expectLine(pattern, offset = 0) {
    while (!pattern.test(output.slice(offset))) {
      if (childError) throw childError;
      assert.equal(childClosed, false, `UxPlay exited before initialization/lifecycle completed:\n${output}`);
      assert.ok(Date.now() < deadline, `UxPlay startup fixture timed out:\n${output}`);
      await delay(20);
    }
  }
  await expectLine(/^Initialized server socket\(s\)$/m);
  // UxPlay reserves tcp[0] for mirror data and tcp[1] for control requests.
  client = net.createConnection({ host: '127.0.0.1', port: tcpPorts[1] });
  client.on('error', error => { childError = error; });
  await expectLine(/^Open connections: 1$/m);
  let response = '';
  client.on('data', bytes => { response = (response + bytes.toString('latin1')).slice(-65536); });
  let sequence = 0;
  async function request(method, type, body) {
    sequence += 1;
    response = '';
    client.write(Buffer.concat([Buffer.from(`${method} rtsp://127.0.0.1/fixture RTSP/1.0\r\nCSeq: ${sequence}\r\nContent-Type: ${type}\r\nContent-Length: ${body.length}\r\n\r\n`), body]));
    for (;;) {
      const boundary = response.indexOf('\r\n\r\n');
      const length = boundary < 0 ? 0 : Number(/\r\nContent-Length:\s*(\d+)/i.exec(response.slice(0, boundary))?.[1] || 0);
      if (boundary >= 0 && response.length >= boundary + 4 + length) break;
      if (childError) throw childError;
      assert.equal(childClosed, false, output);
      assert.ok(Date.now() < deadline, `RTSP fixture timed out:\n${output}`);
      await delay(20);
    }
    assert.match(response, /^RTSP\/1\.0 200 /);
  }
  await request('SETUP', 'application/x-apple-binary-plist', setupBody(rtp.address().port));
  for (const [db, fraction] of [[-15, '0.5'], [-144, '0'], [-30, '0'], [0, '1']]) {
    const observationStart = output.length;
    await request('SET_PARAMETER', 'text/parameters', Buffer.from(`volume: ${db}\r\n`));
    await expectLine(new RegExp(`^EFFETUNE_AIRPLAY_VOLUME \\{"fraction":${fraction.replace('.', '\\.')}\\}$`, 'm'), observationStart);
  }
  client.end();
  await expectLine(/^Open connections: 0$/m);
  assert.equal(childClosed, false);
  assert.ok(!/Required gstreamer .*not found|gst_parse_launch error|dnssd_.*failed/i.test(output));
  console.log('Packaged UxPlay startup passed: production audio argv, private ports, actual volume -15/-144/-30/0 dB → slider 0.5/0/0/1, connection lifecycle 1 → 0');
} catch (error) {
  error.message += `\nFixture receiver output:\n${output}`;
  throw error;
} finally {
  client?.destroy();
  if (child && !childClosed) {
    child.kill('SIGTERM');
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (childClosed) break;
      await delay(20);
    }
    if (!childClosed) {
      child.kill('SIGKILL');
      const forcedDeadline = Date.now() + 2000;
      while (Date.now() < forcedDeadline) {
        if (childClosed) break;
        await delay(20);
      }
    }
    assert.equal(childClosed, true, 'The fixture receiver did not close');
  }
  if (rtp) await closeReservation(rtp);
  await Promise.all(reservations.map(closeReservation));
  assert.equal(path.dirname(temporaryRoot), temporaryParent);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
