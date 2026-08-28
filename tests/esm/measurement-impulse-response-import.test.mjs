import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { DataStorage, MeasurementImportError } from '../../features/measurement/dataStorage.js';
import {
  createImpulseResponseMeasurement,
  decodeImpulseResponseWav,
  frequencyResponseFromImpulseResponse,
  importImpulseResponseWav
} from '../../features/measurement/impulse-response-import.js';
import { IR_LIBRARY_MAX_ORIGINAL_BYTES } from '../../js/ir-library/ir-library-limits.js';

function impulse(length = 256, onset = 12, gain = 1) {
  const samples = new Float32Array(length);
  samples[onset] = gain;
  return samples;
}

function wavHeader({ channels = 1, sampleRate = 48000, frames = 1 } = {}) {
  const dataBytes = channels * frames * 4;
  const bytes = new Uint8Array(44 + dataBytes);
  const view = new DataView(bytes.buffer);
  const write = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index);
  };
  write(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 4, true);
  view.setUint16(32, channels * 4, true);
  view.setUint16(34, 32, true);
  write(36, 'data');
  view.setUint32(40, dataBytes, true);
  return bytes.buffer;
}

test('measurement Import input accepts exported JSON and impulse-response WAV files', () => {
  const html = fs.readFileSync(new URL(
    '../../features/measurement/measurement.html', import.meta.url
  ), 'utf8');
  assert.match(html, /id="importInput"[^>]*accept="\.json,\.wav"/);
});

test('impulse response analysis produces the logarithmic frequency response used by measurements', () => {
  const response = frequencyResponseFromImpulseResponse(impulse(), 48000, 12);

  assert.ok(response.length > 900);
  assert.ok(response.every(([frequency, magnitude]) =>
    Number.isFinite(frequency) && frequency >= 20 && frequency <= 20000 &&
    Number.isFinite(magnitude)));
  assert.ok(response.every(([, magnitude]) => Math.abs(magnitude) < 1e-6));
});

test('mono WAV PCM becomes a normal measurement with one persisted impulse response', () => {
  const samples = impulse(512, 24, 0.5);
  const { measurement, records } = createImpulseResponseMeasurement({
    id: 'measurement-ir',
    name: 'Room capture',
    channels: [samples],
    sampleRate: 48000,
    timestamp: '2026-08-27T00:00:00.000Z'
  });

  assert.equal(measurement.outputChannel, 'all');
  assert.equal(measurement.points.length, 1);
  assert.equal(measurement.points[0].ir.stored, true);
  assert.equal(measurement.points[0].ir.onsetIndex, 24);
  assert.deepEqual(measurement.averageFrequencyResponse, measurement.points[0].frequencyResponse);
  assert.equal(records.length, 1);
  assert.equal(records[0].measurementId, measurement.id);
  assert.equal(records[0].pointId, measurement.points[0].pointId);
  assert.equal(records[0].data, samples);
});

test('multichannel WAV PCM uses the existing virtual measurement channel contract', () => {
  const { measurement, records } = createImpulseResponseMeasurement({
    id: 'measurement-stereo-ir',
    name: 'Stereo room',
    channels: [impulse(256, 10), impulse(256, 18, 0.25)],
    sampleRate: 48000
  });

  assert.equal(measurement.outputChannel, 'multi');
  assert.deepEqual(measurement.outputChannels, ['left', 'right']);
  assert.deepEqual(measurement.points[0].channels.map(entry => ({
    channel: entry.channel,
    irId: entry.irId,
    stored: entry.ir.stored
  })), [
    { channel: 'left', irId: 1, stored: true },
    { channel: 'right', irId: 2, stored: true }
  ]);
  assert.deepEqual(records.map(record => [record.pointId, record.channel]), [
    [1, 'left'],
    [2, 'right']
  ]);
  assert.deepEqual(measurement.channelResponses.map(entry => entry.channel), ['left', 'right']);
});

test('sixteen-channel WAV PCM preserves the Ch 1 through Ch 16 token contract', () => {
  const { measurement, records } = createImpulseResponseMeasurement({
    id: 'measurement-16ch-ir',
    name: 'Sixteen channel room',
    channels: Array.from({ length: 16 }, (_, index) => impulse(64, index + 1)),
    sampleRate: 48000
  });

  assert.deepEqual(measurement.outputChannels,
    ['left', 'right', ...Array.from({ length: 14 }, (_, index) => String(index + 2))]);
  assert.equal(measurement.points[0].channels.at(-1).channel, '15');
  assert.equal(records.at(-1).channel, '15');
});

test('WAV import decodes, stores measurement and IR records atomically, and preserves decoded rate', async () => {
  const calls = [];
  const storage = {
    irPersistenceAvailable: true,
    generateId: () => 'measurement-imported-ir',
    async addMeasurement(measurement, records, options) {
      calls.push({ measurement, records, options });
    }
  };
  const file = {
    name: 'listening-room.wav',
    async arrayBuffer() { return wavHeader(); }
  };

  const id = await importImpulseResponseWav(file, storage, {
    decode: async () => ({ channels: [impulse()], sampleRate: 44100 })
  });

  assert.equal(id, 'measurement-imported-ir');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].measurement.name, 'listening-room');
  assert.equal(calls[0].measurement.sampleRate, 44100);
  assert.equal(calls[0].records[0].sampleRate, 44100);
  assert.deepEqual(calls[0].options, { requireImpulseResponses: true });
});

test('oversized WAV import rejects before reading the file', async () => {
  let arrayBufferCalls = 0;
  const file = {
    name: 'oversized.wav',
    size: IR_LIBRARY_MAX_ORIGINAL_BYTES + 1,
    async arrayBuffer() { arrayBufferCalls += 1; return wavHeader(); }
  };
  const storage = { irPersistenceAvailable: true };

  await assert.rejects(() => importImpulseResponseWav(file, storage), error =>
    error instanceof MeasurementImportError && error.kind === 'size');
  assert.equal(arrayBufferCalls, 0);
});

test('invalid WAV and storage failure do not report a successful import', async () => {
  let addCalls = 0;
  const storage = {
    irPersistenceAvailable: true,
    generateId: () => 'unused',
    async addMeasurement() { addCalls += 1; }
  };
  await assert.rejects(() => importImpulseResponseWav({
    name: 'invalid.wav',
    async arrayBuffer() { return new ArrayBuffer(32); }
  }, storage), TypeError);
  assert.equal(addCalls, 0);

  storage.addMeasurement = async () => {
    addCalls += 1;
    throw new Error('quota');
  };
  await assert.rejects(() => importImpulseResponseWav({
    name: 'valid.wav',
    async arrayBuffer() { return wavHeader(); }
  }, storage, {
    decode: async () => ({ channels: [impulse()], sampleRate: 48000 })
  }), error => error instanceof MeasurementImportError && error.kind === 'storage');
  assert.equal(addCalls, 1);
});

test('required impulse-response persistence rejects IndexedDB fallback without publishing metadata', async () => {
  const storage = new DataStorage();
  storage.indexedDbUnavailable = true;
  storage.openDatabase = async () => {
    throw Object.assign(new Error('unavailable'), { name: 'InvalidStateError' });
  };
  let fallbackWrites = 0;
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem() { fallbackWrites += 1; } };
  try {
    await assert.rejects(() => storage.addMeasurement({
      id: 'strict-ir',
      name: 'Strict IR',
      points: []
    }, [{
      measurementId: 'strict-ir',
      pointId: 0,
      data: impulse()
    }], { requireImpulseResponses: true }));
    assert.deepEqual(storage.measurements, []);
    assert.equal(fallbackWrites, 0);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});

test('WAV decoder validates the file before invoking the injected decoder', async () => {
  let decodeCalls = 0;
  const decoded = await decodeImpulseResponseWav(wavHeader({ channels: 2, frames: 4 }), {
    decode: async () => {
      decodeCalls += 1;
      return { channels: [impulse(), impulse()], sampleRate: 48000 };
    }
  });
  assert.equal(decodeCalls, 1);
  assert.equal(decoded.channels.length, 2);
});
