import assert from 'node:assert/strict';
import test from 'node:test';

import { createTrackFromMetadata } from '../../js/library/metadata/metadata-mapper.js';
import { computeReplayGainFactor, readReplayGain } from '../../js/ui/audio-player/replay-gain.js';

function mapReplayGain(native, common = {}) {
  return createTrackFromMetadata({ fileName: 'song.flac' }, { common, native, format: {} }).replayGain;
}

const tags = (prefix, values) => Object.entries(values).map(([id, value]) => ({ id: `${prefix}${id}`, value }));

test('ReplayGain tags map from ID3, Vorbis, iTunes, and APEv2 identifiers', () => {
  const expected = { trackGainDb: -6.2, trackPeak: 0.98, albumGainDb: -7.5, albumPeak: 1.02 };
  const upper = { REPLAYGAIN_TRACK_GAIN: '-6.20 dB', REPLAYGAIN_TRACK_PEAK: '0.980000', REPLAYGAIN_ALBUM_GAIN: '-7.5 dB', REPLAYGAIN_ALBUM_PEAK: '1.02' };
  const lower = Object.fromEntries(Object.entries(upper).map(([id, value]) => [id.toLowerCase(), value]));
  assert.deepEqual(mapReplayGain({ 'ID3v2.4': tags('TXXX:', upper) }), expected);
  assert.deepEqual(mapReplayGain({ 'ID3v2.3': tags('TXXX:', lower) }), expected);
  assert.deepEqual(mapReplayGain({ vorbis: tags('', upper) }), expected);
  assert.deepEqual(mapReplayGain({ iTunes: tags('----:com.apple.iTunes:', lower) }), expected);
  assert.deepEqual(mapReplayGain({ APEv2: tags('', { Replaygain_Track_Gain: '+1.5 dB', Replaygain_Track_Peak: '0.5' }) }),
    { trackGainDb: 1.5, trackPeak: 0.5, albumGainDb: null, albumPeak: null });
});

test('ReplayGain mapping converts Opus R128 gains and prefers REPLAYGAIN tags', () => {
  assert.deepEqual(mapReplayGain({ vorbis: [{ id: 'R128_TRACK_GAIN', value: '-512' }, { id: 'R128_ALBUM_GAIN', value: '256' }] }),
    { trackGainDb: 3, trackPeak: null, albumGainDb: 6, albumPeak: null });
  assert.equal(mapReplayGain({ vorbis: [
    { id: 'R128_TRACK_GAIN', value: '-512' },
    { id: 'REPLAYGAIN_TRACK_GAIN', value: '-4 dB' }
  ] }).trackGainDb, -4);
});

test('ReplayGain mapping ignores non-numeric values and falls back to common values', () => {
  assert.deepEqual(mapReplayGain({ vorbis: tags('', { REPLAYGAIN_TRACK_GAIN: 'loud', REPLAYGAIN_TRACK_PEAK: '', R128_ALBUM_GAIN: '1.5' }) }),
    { trackGainDb: null, trackPeak: null, albumGainDb: null, albumPeak: null });
  assert.deepEqual(mapReplayGain({}, { replaygain_track_gain: { dB: -3, ratio: 0.7 }, replaygain_track_peak: { dB: -1, ratio: 0.9 } }),
    { trackGainDb: -3, trackPeak: 0.9, albumGainDb: null, albumPeak: null });
});

test('ReplayGain numeric tags preserve decimal syntax and reject a long invalid numeric suffix', () => {
  for (const [text, expected] of [['+12', 12], ['-12.', -12], ['.75', .75], ['-.75 dB', -.75], ['12.25DB', 12.25]]) {
    assert.equal(mapReplayGain({ vorbis: [{ id: 'REPLAYGAIN_TRACK_GAIN', value: text }] }).trackGainDb, expected);
  }
  assert.equal(mapReplayGain({ vorbis: [{ id: 'REPLAYGAIN_TRACK_GAIN', value: '1'.repeat(100000) + 'x' }] }).trackGainDb, null);
});

test('ReplayGain factor follows mode fallback, preamp, and clipping prevention', () => {
  const both = { trackGainDb: -6, trackPeak: 0.5, albumGainDb: -2, albumPeak: 0.9 };
  const off = { mode: 'off', preampDb: 6, preventClipping: true };
  const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);
  assert.equal(computeReplayGainFactor(both, off), 1);
  assert.equal(computeReplayGainFactor(null, { mode: 'track', preampDb: 6, preventClipping: false }), 1);
  assert.equal(computeReplayGainFactor({ trackGainDb: null, albumGainDb: null }, { mode: 'album', preampDb: 6 }), 1);
  close(computeReplayGainFactor(both, { mode: 'track', preampDb: 0, preventClipping: false }), 10 ** (-6 / 20));
  close(computeReplayGainFactor(both, { mode: 'album', preampDb: 0, preventClipping: false }), 10 ** (-2 / 20));
  close(computeReplayGainFactor({ ...both, trackGainDb: null }, { mode: 'track', preampDb: 3, preventClipping: false }), 10 ** (1 / 20));
  close(computeReplayGainFactor({ ...both, albumGainDb: null }, { mode: 'album', preampDb: 0, preventClipping: false }), 10 ** (-6 / 20));
  // +12 dB on a 0.9 album peak would clip; the factor is held at 1/peak.
  close(computeReplayGainFactor(both, { mode: 'album', preampDb: 14, preventClipping: true }), 1 / 0.9);
  close(computeReplayGainFactor(both, { mode: 'album', preampDb: 14, preventClipping: false }), 10 ** (12 / 20));
  // A missing peak on the selected side uses the other side's peak.
  close(computeReplayGainFactor({ ...both, albumPeak: null }, { mode: 'album', preampDb: 14, preventClipping: true }), 2);
});

test('ReplayGain reads Electron paths once per file and skips non-local sources', async () => {
  const requests = [];
  globalThis.window = {
    electronAPI: {
      async readReplayGain(path) {
        requests.push(path);
        if (path.endsWith('busy.flac') && requests.length === 2) throw new Error('EBUSY');
        return { trackGainDb: -5, trackPeak: 0.8, albumGainDb: null, albumPeak: null };
      }
    }
  };
  try {
    const original = { path: 'C:\\Music\\song.m4a' };
    const converted = { path: 'C:\\Temp\\song.wav', presentationTrack: original };
    assert.equal((await readReplayGain(converted)).trackGainDb, -5);
    assert.equal((await readReplayGain(original)).trackGainDb, -5);
    // Library playback creates a new object for the same file on every start.
    assert.equal((await readReplayGain({ path: 'C:\\Music\\song.m4a' })).trackGainDb, -5);
    assert.equal(await readReplayGain({ path: 'https://example.com/stream.mp3' }), null);
    assert.deepEqual(requests, ['C:\\Music\\song.m4a']);
    // A failed read is not kept for the path, so the next track object reads again.
    assert.equal(await readReplayGain({ path: 'C:\\Music\\busy.flac' }), null);
    assert.equal((await readReplayGain({ path: 'C:\\Music\\busy.flac' })).trackGainDb, -5);
    assert.deepEqual(requests.slice(1), ['C:\\Music\\busy.flac', 'C:\\Music\\busy.flac']);
  } finally {
    delete globalThis.window;
  }
});
