import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUE_MAX_BYTES,
  CUE_MAX_TEXT_CHARACTERS,
  createCueEntryKey,
  createCueSignature,
  createCueTrackMetadata,
  createPlainLogicalStorageId,
  decodeCueBytes,
  parseCueSheet,
  resolveCueSheet,
  validateCueDurations
} from '../../js/library/metadata/cue-sheet.js';

function parse(text, path = 'Disc/album.cue') {
  return parseCueSheet(text, { cueRelativePath: path });
}

test('CUE decoder supports UTF-8 and both UTF-16 BOM byte orders', () => {
  const text = 'TITLE "作品"\nFILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00';
  assert.equal(decodeCueBytes(new TextEncoder().encode(text)).text, text);
  for (const littleEndian of [true, false]) {
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set(littleEndian ? [0xff, 0xfe] : [0xfe, 0xff]);
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      bytes[2 + index * 2] = littleEndian ? code & 0xff : code >>> 8;
      bytes[3 + index * 2] = littleEndian ? code >>> 8 : code & 0xff;
    }
    assert.equal(decodeCueBytes(bytes).text, text);
  }
  assert.deepEqual(decodeCueBytes(new Uint8Array(CUE_MAX_BYTES + 1)), {
    ok: false, code: 'cue-too-large', retryable: false, unsupported: false
  });
});

test('CUE parser creates frame regions and stable logical identities for multi-FILE sheets', () => {
  const parsed = parse(`
    REM DATE 1999
    REM GENRE "Rock"
    PERFORMER "Disc Artist"
    TITLE "Disc Title"
    FILE "one.wav" WAVE
      TRACK 01 AUDIO
        TITLE "First"
        INDEX 00 00:00:00
        INDEX 01 00:00:10
      TRACK 03 AUDIO
        PERFORMER "Guest"
        INDEX 01 01:02:03
    FILE "two.flac" WAVE
      TRACK 04 AUDIO
        INDEX 01 00:00:00
  `);
  const resolved = resolveCueSheet(parsed, ['Disc/one.wav', 'Disc/two.flac']);
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.tracks.map(track => ({
    no: track.trackNo,
    path: track.relativePath,
    start: track.startFrame,
    end: track.endFrame,
    key: track.entryKey
  })), [
    { no: 1, path: 'Disc/one.wav', start: 10, end: 4653, key: 'cue:Disc/album.cue#1' },
    { no: 3, path: 'Disc/one.wav', start: 4653, end: null, key: 'cue:Disc/album.cue#3' },
    { no: 4, path: 'Disc/two.flac', start: 0, end: null, key: 'cue:Disc/album.cue#4' }
  ]);
  const validated = validateCueDurations(resolved, new Map([
    ['Disc/one.wav', { durationSec: 120 }],
    ['Disc/two.flac', { durationSec: 30 }]
  ]));
  assert.equal(validated.ok, true);
  assert.equal(validated.tracks[0].durationSec, (4653 - 10) / 75);
  assert.equal(validated.tracks[1].durationSec, 120 - 4653 / 75);
  const metadata = createCueTrackMetadata(validated, validated.tracks[1], {
    artist: 'Embedded Artist', albumArtist: 'Embedded Album Artist', album: 'Embedded Album',
    title: 'Do not copy', trackNo: 1, discNo: 2, durationSec: 120, sampleRate: 96000
  });
  assert.deepEqual({
    title: metadata.title, artist: metadata.artist, album: metadata.album,
    albumArtist: metadata.albumArtist, albumArtists: metadata.albumArtists,
    trackNo: metadata.trackNo, trackTotal: metadata.trackTotal,
    discNo: metadata.discNo, discTotal: metadata.discTotal, year: metadata.year,
    genre: metadata.genre, sampleRate: metadata.sampleRate
  }, {
    title: 'Track 03', artist: 'Guest', album: 'Disc Title', albumArtist: 'Disc Artist',
    albumArtists: ['Disc Artist'],
    trackNo: 3, trackTotal: 3, discNo: null, discTotal: null, year: 1999,
    genre: 'Rock', sampleRate: 96000
  });
});

test('track-scoped REM DATE and REM GENRE do not replace disc metadata', () => {
  const parsed = parse(`
    REM DATE 1999
    REM GENRE "Disc Genre"
    REM REPLAYGAIN_ALBUM_GAIN -6.20 dB
    FILE "album.wav" WAVE
      TRACK 01 AUDIO
        REM DATE 2025
        REM GENRE "Track Genre"
        REM REPLAYGAIN_TRACK_GAIN -5.00 dB
        INDEX 01 00:00:00
  `);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.disc.date, '1999');
  assert.equal(parsed.disc.genre, 'Disc Genre');
});

test('CUE parser ellipsizes oversized titles instead of rejecting the sheet', () => {
  const longTitle = `Long ${'title '.repeat(700)}\u{1F3B5}`;
  const parsed = parse(`
    TITLE "${longTitle}"
    FILE "album.wav" WAVE
      TRACK 01 AUDIO
        TITLE "${longTitle}"
        INDEX 01 00:00:00
  `);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.disc.title.length, CUE_MAX_TEXT_CHARACTERS);
  assert.equal(parsed.disc.title.endsWith('...'), true);
  assert.equal(parsed.tracks[0].title.length, CUE_MAX_TEXT_CHARACTERS);
  assert.equal(parsed.tracks[0].title.endsWith('...'), true);
  assert.equal(parsed.tracks[0].title.startsWith(longTitle.slice(0, 100)), true);
});

test('CUE parser deterministically rejects unsafe, duplicate, reversed, and invalid index input', () => {
  const cases = [
    ['FILE "../album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00', 'cue-unsafe-file'],
    ['FILE "album.wav" WAVE\nTRACK 02 AUDIO\nINDEX 01 00:00:00\nTRACK 02 AUDIO\nINDEX 01 00:01:00', 'cue-invalid-track-order'],
    ['FILE "album.wav" WAVE\nTRACK 02 AUDIO\nINDEX 01 00:00:00\nTRACK 01 AUDIO\nINDEX 01 00:01:00', 'cue-invalid-track-order'],
    ['FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:75:00', 'cue-invalid-index-time'],
    ['FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 00 00:01:00\nINDEX 01 00:00:00', 'cue-invalid-index-order'],
    ['FILE "album.wav" WAVE\nTRACK 01 AUDIO', 'cue-missing-index-01']
  ];
  for (const [source, code] of cases) assert.equal(parse(source).code, code);
});

test('CUE resolution prefers NFC exact names and only permits unique case-insensitive fallback', () => {
  const parsed = parse('FILE "Album.WAV" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00');
  assert.equal(resolveCueSheet(parsed, ['Disc/album.wav']).tracks[0].relativePath, 'Disc/album.wav');
  assert.equal(resolveCueSheet(parsed, ['Disc/album.wav', 'Disc/ALBUM.wav']).code, 'cue-ambiguous-reference');
  assert.equal(resolveCueSheet(parsed, ['Disc/other.wav']).code, 'cue-missing-reference');
});

test('non-AUDIO-only sheets do not claim sources and duration boundary failures are deterministic', () => {
  const unsupported = parse('FILE "album.wav" WAVE\nTRACK 01 MODE1/2352\nINDEX 01 00:00:00');
  assert.equal(unsupported.code, 'cue-no-audio-tracks');
  assert.equal(unsupported.unsupported, true);

  const parsed = resolveCueSheet(
    parse('FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 01:00:00'),
    ['Disc/album.wav']
  );
  assert.equal(validateCueDurations(parsed, new Map([['Disc/album.wav', { durationSec: 30 }]])).code, 'cue-index-out-of-range');
});

test('logical identity and signature helpers are deterministic', () => {
  assert.equal(createPlainLogicalStorageId('A\\song.wav'), 'file:A/song.wav');
  assert.equal(createCueEntryKey('A\\disc.cue', 7), 'cue:A/disc.cue#7');
  const bytes = new TextEncoder().encode('cue');
  assert.equal(
    createCueSignature({ size: bytes.length, mtimeMs: 10, bytes }),
    createCueSignature({ size: bytes.length, mtimeMs: 10, bytes })
  );
});
