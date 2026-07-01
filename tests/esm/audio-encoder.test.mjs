import assert from 'node:assert/strict';
import test from 'node:test';

import { AudioEncoder } from '../../js/audio/audio-encoder.js';

function createAudioBuffer(channels, sampleRate = 48000) {
  const length = channels[0].length;
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length,
    getChannelData(index) {
      return Float32Array.from(channels[index]);
    }
  };
}

function readAscii(view, offset, length) {
  let text = '';
  for (let i = 0; i < length; i++) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}

function readInt24(view, offset) {
  let value = view.getUint8(offset) |
    (view.getUint8(offset + 1) << 8) |
    (view.getUint8(offset + 2) << 16);
  if (value & 0x800000) {
    value |= 0xff000000;
  }
  return value;
}

test('AudioEncoder writes a 24-bit PCM WAV header and interleaved samples', async () => {
  const encoder = new AudioEncoder();
  const blob = encoder.encodeWAV(createAudioBuffer([
    [-1.2, -0.5],
    [0.5, 1.2]
  ], 44100));
  const view = new DataView(await blob.arrayBuffer());

  assert.equal(blob.type, 'audio/wav');
  assert.equal(view.byteLength, 44 + 2 * 2 * 3);
  assert.equal(readAscii(view, 0, 4), 'RIFF');
  assert.equal(view.getUint32(4, true), 36 + 12);
  assert.equal(readAscii(view, 8, 4), 'WAVE');
  assert.equal(readAscii(view, 12, 4), 'fmt ');
  assert.equal(view.getUint16(20, true), 1);
  assert.equal(view.getUint16(22, true), 2);
  assert.equal(view.getUint32(24, true), 44100);
  assert.equal(view.getUint32(28, true), 44100 * 2 * 3);
  assert.equal(view.getUint16(32, true), 6);
  assert.equal(view.getUint16(34, true), 24);
  assert.equal(readAscii(view, 36, 4), 'data');
  assert.equal(view.getUint32(40, true), 12);

  assert.equal(readInt24(view, 44), -0x800000);
  assert.equal(readInt24(view, 47), Math.round(0.5 * 0x7fffff));
  assert.equal(readInt24(view, 50), Math.round(-0.5 * 0x800000));
  assert.equal(readInt24(view, 53), 0x7fffff);
});
