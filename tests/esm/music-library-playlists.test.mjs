import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodePlaylistBytes,
  fileUriToPath,
  parseM3U,
  parsePLS,
  parsePlaylist,
  parseXSPF,
  pathToFileUri,
  serializeM3U8,
  serializePLS,
  serializeXSPF
} from '../../js/library/playlists/playlist-formats.js';
test('playlist byte decoding honors UTF BOMs and legacy Shift_JIS fallback', () => {
  const utf16Text = '#EXTM3U\n#EXTINF:1,Artist - UTF16\nsong.flac\n';
  const utf16Bytes = new Uint8Array(2 + utf16Text.length * 2);
  utf16Bytes[0] = 0xff;
  utf16Bytes[1] = 0xfe;
  for (let index = 0; index < utf16Text.length; index += 1) {
    utf16Bytes[2 + index * 2] = utf16Text.charCodeAt(index);
  }

  assert.deepEqual(decodePlaylistBytes(utf16Bytes, { extension: 'm3u' }), {
    encoding: 'utf-16le',
    text: utf16Text
  });

  const shiftJisBytes = Uint8Array.from([
    0x23, 0x45, 0x58, 0x54, 0x4d, 0x33, 0x55, 0x0a,
    0x23, 0x45, 0x58, 0x54, 0x49, 0x4e, 0x46, 0x3a,
    0x31, 0x2c, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x0a,
    0x73, 0x6f, 0x6e, 0x67, 0x2e, 0x66, 0x6c, 0x61, 0x63, 0x0a
  ]);
  const decoded = decodePlaylistBytes(shiftJisBytes, { extension: 'm3u' });

  assert.equal(decoded.encoding, 'shift_jis');
  assert.match(decoded.text, /テスト/);
});

test('M3U parser handles EXTINF metadata, CRLF, comments, and file URIs', () => {
  const playlist = [
    '\ufeff#EXTM3U',
    '#EXTINF:245,Blue Hour - Cafe Song',
    'file:///C:/Music/Blue%20Hour/Cafe%20Song.flac',
    '# ordinary comment',
    '',
    '#EXTINF:-1,Loose Track',
    '../Loose/Track.wav'
  ].join('\r\n');

  assert.deepEqual(parseM3U(playlist), {
    entries: [
      {
        path: 'C:\\Music\\Blue Hour\\Cafe Song.flac',
        artist: 'Blue Hour',
        title: 'Cafe Song',
        durationSec: 245
      },
      {
        path: '../Loose/Track.wav',
        title: 'Loose Track'
      }
    ]
  });
});

test('M3U8 serializer produces stable text that parses back to playlist entries', () => {
  const entries = [
    {
      path: 'D:\\Music\\Blue Hour\\Cafe Song.flac',
      artist: 'Blue Hour',
      title: 'Cafe Song',
      durationSec: 245.4
    },
    {
      path: '../Loose/Track.wav',
      title: 'Loose Track'
    }
  ];

  const serialized = serializeM3U8(entries);

  assert.equal(serialized, [
    '#EXTM3U',
    '#EXTINF:245,Blue Hour - Cafe Song',
    'D:\\Music\\Blue Hour\\Cafe Song.flac',
    '#EXTINF:-1,Loose Track',
    '../Loose/Track.wav',
    ''
  ].join('\n'));
  assert.deepEqual(parseM3U(serialized).entries, [
    {
      path: 'D:\\Music\\Blue Hour\\Cafe Song.flac',
      artist: 'Blue Hour',
      title: 'Cafe Song',
      durationSec: 245
    },
    {
      path: '../Loose/Track.wav',
      title: 'Loose Track'
    }
  ]);
});

test('PLS parser and serializer preserve indexed files in deterministic order', () => {
  const source = [
    '[playlist]',
    'File2=file:///C:/Music/Second.flac',
    'Title2=Second Artist - Second Title',
    'Length2=321',
    'File1=First.flac',
    'Title1=First Title',
    'Length1=-1',
    'NumberOfEntries=2',
    'Version=2'
  ].join('\n');

  const parsed = parsePLS(source);
  assert.deepEqual(parsed.entries, [
    { path: 'First.flac', title: 'First Title' },
    {
      path: 'C:\\Music\\Second.flac',
      artist: 'Second Artist',
      title: 'Second Title',
      durationSec: 321
    }
  ]);

  assert.equal(serializePLS(parsed.entries), [
    '[playlist]',
    'File1=First.flac',
    'Title1=First Title',
    'Length1=-1',
    'File2=C:\\Music\\Second.flac',
    'Title2=Second Artist - Second Title',
    'Length2=321',
    'NumberOfEntries=2',
    'Version=2',
    ''
  ].join('\n'));
});

test('XSPF parser and serializer handle XML escaping, file URIs, and millisecond durations', () => {
  const entries = [
    {
      path: 'D:\\Music\\A&B.flac',
      title: 'A & B',
      artist: 'Me <You>',
      album: 'The "Best"',
      durationSec: 12.5
    }
  ];
  const serialized = serializeXSPF(entries);

  assert.match(serialized, /file:\/\/\/D:\/Music\/A%26B\.flac/);
  assert.match(serialized, /<title>A &amp; B<\/title>/);
  assert.deepEqual(parseXSPF(serialized).entries, entries);
  assert.deepEqual(parseXSPF(serializeXSPF([{ path: 'Folder/A B.flac' }], { fileUris: false })).entries, [
    { path: 'Folder/A B.flac' }
  ]);
  assert.equal(fileUriToPath(pathToFileUri('\\\\server\\share\\Track 1.flac')), '\\\\server\\share\\Track 1.flac');
});

test('generic playlist parser detects formats from file names', () => {
  const parsed = parsePlaylist('[playlist]\nFile1=one.flac\nNumberOfEntries=1\n', { fileName: 'mix.pls' });

  assert.deepEqual(parsed, {
    format: 'pls',
    encoding: undefined,
    entries: [{ path: 'one.flac' }]
  });
});
