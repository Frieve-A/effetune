const assert = require('node:assert/strict');
const test = require('node:test');
const { L16RtpReceiver, parseL16RtpPacket, REORDER_WAIT_MS } = require('../../electron/airplay-rtp.cjs');

function packet(sequence, timestamp, samples = [[-32768,32767],[16384,-16384]], ssrc = 7) {
  const bytes = Buffer.alloc(12 + samples.length * 4);
  bytes[0] = 128; bytes[1] = 96;
  bytes.writeUInt16BE(sequence & 65535,2); bytes.writeUInt32BE(timestamp >>> 0,4); bytes.writeUInt32BE(ssrc,8);
  samples.forEach(([left,right], index) => { bytes.writeInt16BE(left,12 + index * 4); bytes.writeInt16BE(right,14 + index * 4); });
  return bytes;
}

test('AirPlay L16 parses stereo big-endian samples and sequence/timestamp rollover', () => {
  const chunks = [];
  const receiver = new L16RtpReceiver({ onPcm: chunk => chunks.push(chunk) });
  receiver.push(packet(65535,4294967294));
  receiver.push(packet(0,0));
  assert.equal(chunks.length,2);
  assert.deepEqual([...new Float32Array(chunks[0].planes[0])],[-1,0.5]);
  assert.deepEqual([...new Float32Array(chunks[0].planes[1])],[32767/32768,-0.5]);
  assert.deepEqual(chunks.map(chunk => chunk.startFrame),[0,2]);
});

test('AirPlay RTP reorders a bounded window and conceals only finite missing samples', () => {
  const chunks = [], resets = [];
  const receiver = new L16RtpReceiver({ onPcm: chunk => chunks.push(chunk), onReset: frame => resets.push(frame) });
  receiver.push(packet(1,0),0);
  receiver.push(packet(3,4),1);
  assert.equal(chunks.length,1);
  receiver.push(packet(2,2),2);
  assert.equal(chunks.length,3);
  assert.equal(receiver.push(packet(2,2),3),false);
  assert.equal(receiver.push(packet(4,6,undefined,99),3),false);
  receiver.push(packet(5,8),4);
  receiver.flush(4 + REORDER_WAIT_MS);
  assert.equal(chunks[3].frameCount,2);
  assert.deepEqual([...new Float32Array(chunks[3].planes[0])],[0,0]);
  receiver.push(packet(100,20000),50);
  assert.equal(resets.length,1);
  assert.equal(receiver.queuedFrames,0);
});

test('AirPlay RTP validates header, payload alignment, extension and padding bounds', () => {
  for (const bytes of [Buffer.alloc(0),Buffer.alloc(12),packet(1,0).subarray(0,15)]) assert.equal(parseL16RtpPacket(bytes),null);
  const extension = packet(1,0); extension[0] |= 16; extension.writeUInt16BE(65535,14);
  assert.equal(parseL16RtpPacket(extension),null);
  const padding = packet(1,0); padding[0] |= 32; padding[padding.length-1] = 255;
  assert.equal(parseL16RtpPacket(padding),null);
  const wrongType = packet(1,0); wrongType[1] = 97;
  assert.equal(parseL16RtpPacket(wrongType),null);
});

module.exports = { packet };
