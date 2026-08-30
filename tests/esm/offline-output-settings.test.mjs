import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_OFFLINE_OUTPUT_SETTINGS,
  OFFLINE_OUTPUT_FORMATS,
  getOfflineOutputFormat,
  normalizeOfflineOutputSettings,
  snapshotOfflineOutputSettings,
  validateOfflineOutputChannels
} from '../../js/audio/offline-output-settings.js';

test('offline output defaults preserve the legacy WAV contract', () => {
  assert.deepEqual(normalizeOfflineOutputSettings(), DEFAULT_OFFLINE_OUTPUT_SETTINGS);
  assert.deepEqual(normalizeOfflineOutputSettings([]), DEFAULT_OFFLINE_OUTPUT_SETTINGS);
  assert.deepEqual(normalizeOfflineOutputSettings({ format: 'unknown' }), DEFAULT_OFFLINE_OUTPUT_SETTINGS);
});

test('format lookup rejects prototype property names as corrupt settings', () => {
  for (const format of ['toString', 'constructor', '__proto__']) {
    assert.equal(getOfflineOutputFormat(format), OFFLINE_OUTPUT_FORMATS.wav);
    assert.deepEqual(
      normalizeOfflineOutputSettings({ format }),
      DEFAULT_OFFLINE_OUTPUT_SETTINGS
    );
  }
});

test('offline output normalization uses format-specific sample rates without coercion', () => {
  const input = {
    format: 'flac',
    sampleRate: 192000,
    wavSampleFormat: 'float32',
    flacSampleFormat: 'pcm16',
    mp3BitrateKbps: 192,
    m4aBitrateKbps: 320
  };
  const original = structuredClone(input);
  const normalized = normalizeOfflineOutputSettings(input);
  assert.deepEqual(normalized, {
    format: 'flac',
    sampleRate: 192000,
    wavSampleFormat: 'float32',
    flacSampleFormat: 'pcm16'
  });
  assert.deepEqual(input, original);
  assert.deepEqual(
    normalizeOfflineOutputSettings({ format: 'mp3', sampleRate: 48000 }),
    DEFAULT_OFFLINE_OUTPUT_SETTINGS
  );
  assert.deepEqual(
    normalizeOfflineOutputSettings({ format: 'm4a', sampleRate: 44100 }),
    DEFAULT_OFFLINE_OUTPUT_SETTINGS
  );
  assert.equal(normalizeOfflineOutputSettings({ format: 'flac', sampleRate: '48000' }).sampleRate, 96000);
  assert.equal(normalizeOfflineOutputSettings({ format: 'wav', wavSampleFormat: 'bad' }).wavSampleFormat, 'pcm24');
  assert.equal(normalizeOfflineOutputSettings({ format: 'flac', flacSampleFormat: 'bad' }).flacSampleFormat, 'pcm24');
});

test('format registry provides one source for storage metadata and channel limits', () => {
  assert.deepEqual(
    Object.values(OFFLINE_OUTPUT_FORMATS).map(({ id, extension, mimeType, maxChannels }) => ({
      id, extension, mimeType, maxChannels
    })),
    [
      { id: 'wav', extension: 'wav', mimeType: 'audio/wav', maxChannels: 16 },
      { id: 'flac', extension: 'flac', mimeType: 'audio/flac', maxChannels: 8 }
    ]
  );
  assert.equal(getOfflineOutputFormat('bad'), OFFLINE_OUTPUT_FORMATS.wav);
  assert.deepEqual(OFFLINE_OUTPUT_FORMATS.flac.qualityOptions.map(option => option.id), ['pcm16', 'pcm24']);
  assert.doesNotThrow(() => validateOfflineOutputChannels({ format: 'wav' }, 16));
  assert.doesNotThrow(() => validateOfflineOutputChannels({ format: 'flac' }, 8));
  assert.throws(
    () => validateOfflineOutputChannels({ format: 'flac' }, 9),
    error => error.userMessageKey === 'error.offlineOutput.unsupportedChannels'
  );
});

test('offline output snapshots are normalized, independent, and immutable', () => {
  const config = {
    offlineOutput: {
      format: 'flac',
      sampleRate: 44100,
      wavSampleFormat: 'float32',
      flacSampleFormat: 'pcm16'
    }
  };
  const snapshot = snapshotOfflineOutputSettings(config);
  config.offlineOutput.format = 'wav';
  assert.equal(snapshot.format, 'flac');
  assert.equal(snapshot.sampleRate, 44100);
  assert.equal(snapshot.wavSampleFormat, 'float32');
  assert.equal(snapshot.flacSampleFormat, 'pcm16');
  assert.equal(Object.isFrozen(snapshot), true);
});
