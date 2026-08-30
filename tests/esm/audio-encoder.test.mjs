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

test('AudioEncoder writes PCM 16-bit and float32 WAV variants from one contract', async () => {
  const encoder = new AudioEncoder();
  const audioBuffer = createAudioBuffer([[1.5, -0.5]], 48000);
  const pcm16 = new DataView(await encoder.encodeWav(audioBuffer, 'pcm16').arrayBuffer());
  const float32 = new DataView(await encoder.encodeWav(audioBuffer, 'float32').arrayBuffer());

  assert.equal(pcm16.getUint16(20, true), 1);
  assert.equal(pcm16.getUint16(34, true), 16);
  assert.equal(pcm16.getInt16(44, true), 0x7fff);
  assert.equal(float32.getUint16(20, true), 3);
  assert.equal(float32.getUint16(34, true), 32);
  assert.equal(float32.getFloat32(44, true), 1.5);
});

test('AudioEncoder feeds FLAC 16-bit samples with WAV quantization and closes each sample', async () => {
  const samples = [];
  class FakeAudioSample {
    constructor(init) {
      this.init = init;
      this.closed = false;
    }

    close() {
      this.closed = true;
    }
  }
  const source = {
    async add(sample) {
      samples.push(sample);
    }
  };
  const encoder = new AudioEncoder();
  await encoder.addFlacPcm16Samples(
    { AudioSample: FakeAudioSample },
    source,
    createAudioBuffer([[1.5, -0.5, -1.5]], 48000)
  );

  assert.equal(samples.length, 1);
  assert.equal(samples[0].init.format, 's16');
  assert.equal(samples[0].init.timestamp, 0);
  assert.equal(samples[0].closed, true);
  const view = new DataView(samples[0].init.data);
  assert.equal(view.getInt16(0, true), 0x7fff);
  assert.equal(view.getInt16(2, true), -0x4000);
  assert.equal(view.getInt16(4, true), -0x8000);
});

test('AudioEncoder skips same-rate conversion and returns registry metadata', async () => {
  let contextCreations = 0;
  const encoder = new AudioEncoder({
    createOfflineContext() {
      contextCreations++;
      throw new Error('not expected');
    }
  });
  const result = await encoder.encode(createAudioBuffer([[0, 0]], 96000), {
    format: 'wav',
    sampleRate: 96000,
    wavSampleFormat: 'pcm16'
  });

  assert.equal(contextCreations, 0);
  assert.equal(result.extension, 'wav');
  assert.equal(result.mimeType, 'audio/wav');
  assert.equal(result.sampleRate, 96000);
  assert.equal(result.numberOfChannels, 1);
  assert.equal(result.blob.type, 'audio/wav');
});

test('AudioEncoder aborts chunked WAV output and remains reusable', async () => {
  const encoder = new AudioEncoder();
  const controller = new AbortController();
  const largeBuffer = createAudioBuffer([
    new Float32Array(50_000),
    new Float32Array(50_000)
  ], 96000);

  const encoding = encoder.encode(largeBuffer, { format: 'wav', sampleRate: 96000 }, {
    signal: controller.signal
  });
  setTimeout(() => controller.abort(), 0);

  await assert.rejects(
    encoding,
    error => error?.userMessageKey === 'status.processingCanceled'
  );

  const result = await encoder.encode(createAudioBuffer([[0, 0]], 96000), {
    format: 'wav',
    sampleRate: 96000
  });
  assert.equal(result.blob.type, 'audio/wav');
});

test('AudioEncoder resamples once after channel validation', async () => {
  const sourceBuffer = createAudioBuffer([[0, 1, 0, -1]], 48000);
  const renderedBuffer = createAudioBuffer([[0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5]], 96000);
  const calls = [];
  const encoder = new AudioEncoder({
    createOfflineContext(channels, length, sampleRate) {
      calls.push([channels, length, sampleRate]);
      return {
        destination: {},
        createBufferSource() {
          return { connect() {}, start() {} };
        },
        async startRendering() {
          return renderedBuffer;
        }
      };
    }
  });

  const result = await encoder.encode(sourceBuffer, {
    format: 'wav',
    sampleRate: 96000,
    wavSampleFormat: 'pcm24'
  });
  assert.deepEqual(calls, [[1, 8, 96000]]);
  assert.equal(result.sampleRate, 96000);

  await assert.rejects(
    encoder.encode(createAudioBuffer(Array.from({ length: 9 }, () => [0]), 48000), { format: 'flac' }),
    error => error.userMessageKey === 'error.offlineOutput.unsupportedChannels'
  );
  assert.equal(calls.length, 1);
});
