import assert from 'node:assert/strict';
import test from 'node:test';

import { LibraryDatabase } from '../../js/library/library-database.js';
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
import {
  createUnresolvedPlaylistItem,
  resolvePlaylistEntries,
  resolvePlaylistEntry
} from '../../js/library/playlists/path-resolver.js';
import { ScanController } from '../../js/library/scan-controller.js';

const folders = [
  { id: 'f_music', path: 'D:\\Music' }
];

const tracks = [
  {
    id: 't_cafe',
    folderId: 'f_music',
    relativePath: 'Blue Hour/Cafe Song.flac',
    title: 'Cafe Song',
    artist: 'Blue Hour',
    durationSec: 245
  },
  {
    id: 't_shared_one',
    folderId: 'f_music',
    relativePath: 'Duplicates/Shared.flac',
    title: 'Shared',
    artist: 'One',
    durationSec: 100
  },
  {
    id: 't_shared_two',
    folderId: 'f_music',
    relativePath: 'Other/Shared.flac',
    title: 'Shared',
    artist: 'Two',
    durationSec: 100
  },
  {
    id: 't_unicode',
    folderId: 'f_music',
    relativePath: 'Unicode/Café.flac',
    title: 'Café',
    artist: 'Accent',
    durationSec: 60
  }
];

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

test('path resolver prioritizes exact absolute matches before metadata', () => {
  const result = resolvePlaylistEntry(
    {
      path: 'D:\\Music\\Duplicates\\Shared.flac',
      artist: 'Blue Hour',
      title: 'Cafe Song',
      durationSec: 245
    },
    { tracks, folders, platform: 'win32' }
  );

  assert.equal(result.status, 'resolved');
  assert.equal(result.trackId, 't_shared_one');
  assert.equal(result.strategy, 'absolute');
});

test('path resolver resolves playlist-relative paths before suffix matching', () => {
  const result = resolvePlaylistEntry(
    { path: '..\\..\\Music\\Blue Hour\\Cafe Song.flac' },
    {
      tracks,
      folders,
      playlistPath: 'D:\\Playlists\\Daily\\mix.m3u8',
      platform: 'win32'
    }
  );

  assert.equal(result.status, 'resolved');
  assert.equal(result.trackId, 't_cafe');
  assert.equal(result.strategy, 'playlist-relative');
});

test('path resolver uses unique relative suffixes and rejects ambiguous suffixes', () => {
  const unique = resolvePlaylistEntry(
    { path: '..\\Archive\\Blue Hour\\Cafe Song.flac' },
    { tracks, folders, platform: 'win32' }
  );
  const ambiguous = resolvePlaylistEntry(
    { path: 'Shared.flac' },
    { tracks, folders, platform: 'win32' }
  );

  assert.equal(unique.status, 'resolved');
  assert.equal(unique.trackId, 't_cafe');
  assert.equal(unique.strategy, 'relative-suffix');
  assert.equal(ambiguous.status, 'unresolved');
});

test('path resolver batch suffix matching prefers longest suffixes and rejects ambiguous suffixes', () => {
  const suffixTracks = [
    { id: 't_album_shared', folderId: 'f_music', relativePath: 'Album/Shared.flac' },
    { id: 't_live_shared', folderId: 'f_music', relativePath: 'Live/Album/Shared.flac' }
  ];

  const result = resolvePlaylistEntries(
    [
      { path: 'Archive/Live/Album/Shared.flac' },
      { path: 'Album/Shared.flac' }
    ],
    { tracks: suffixTracks, folders, platform: 'win32' }
  );

  assert.equal(result.items[0].status, 'resolved');
  assert.equal(result.items[0].trackId, 't_live_shared');
  assert.equal(result.items[0].strategy, 'relative-suffix');
  assert.equal(result.items[1].status, 'unresolved');
});

test('path resolver applies Windows casefolding but keeps macOS comparisons case-sensitive', () => {
  const windowsResult = resolvePlaylistEntry(
    { path: 'd:/music/blue hour/cafe song.flac' },
    { tracks, folders, platform: 'win32' }
  );
  const macResult = resolvePlaylistEntry(
    { path: 'd:/music/blue hour/cafe song.flac' },
    { tracks, folders, platform: 'darwin' }
  );

  assert.equal(windowsResult.status, 'resolved');
  assert.equal(windowsResult.trackId, 't_cafe');
  assert.equal(macResult.status, 'unresolved');
});

test('path resolver normalizes NFC and NFD path spellings', () => {
  const result = resolvePlaylistEntry(
    { path: 'D:\\Music\\Unicode\\Cafe\u0301.flac' },
    { tracks, folders, platform: 'win32' }
  );

  assert.equal(result.status, 'resolved');
  assert.equal(result.trackId, 't_unicode');
});

test('path resolver falls back to metadata only when title, artist, and duration are unique', () => {
  const resolved = resolvePlaylistEntry(
    {
      path: 'Missing/Unknown.flac',
      artist: 'Blue Hour',
      title: 'Cafe Song',
      durationSec: 247
    },
    { tracks, folders, platform: 'win32' }
  );
  const duplicateTracks = [
    ...tracks,
    {
      id: 't_cafe_duplicate',
      folderId: 'f_music',
      relativePath: 'Copies/Cafe Song.flac',
      title: 'Cafe Song',
      artist: 'Blue Hour',
      durationSec: 246
    }
  ];
  const ambiguous = resolvePlaylistEntry(
    {
      path: 'Missing/Unknown.flac',
      artist: 'Blue Hour',
      title: 'Cafe Song',
      durationSec: 247
    },
    { tracks: duplicateTracks, folders, platform: 'win32' }
  );

  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.trackId, 't_cafe');
  assert.equal(resolved.strategy, 'metadata');
  assert.equal(ambiguous.status, 'unresolved');
});

test('path resolver batches entries and reuses unresolved hints for revived tracks', () => {
  const unresolvedItem = createUnresolvedPlaylistItem({
    sourceLine: 'Offline/Missing.flac',
    relativePathHint: 'Blue Hour/Cafe Song.flac',
    title: 'Cafe Song',
    artist: 'Blue Hour',
    durationSec: 245
  });
  const result = resolvePlaylistEntries(
    [
      unresolvedItem,
      { path: 'Still Missing.flac' }
    ],
    { tracks, folders, platform: 'win32' }
  );

  assert.equal(result.resolvedCount, 1);
  assert.equal(result.unresolvedCount, 1);
  assert.equal(result.items[0].trackId, 't_cafe');
  assert.equal(result.items[0].strategy, 'relative-suffix');
});

test('path resolver preserves unresolved XSPF album metadata for export', () => {
  const parsed = parseXSPF([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<playlist version="1" xmlns="http://xspf.org/ns/0/">',
    '  <trackList>',
    '    <track>',
    '      <location>Missing/Album%20Track.flac</location>',
    '      <title>Album Track</title>',
    '      <creator>Missing Artist</creator>',
    '      <album>Missing Album</album>',
    '      <duration>123000</duration>',
    '    </track>',
    '  </trackList>',
    '</playlist>'
  ].join('\n'));

  const resolution = resolvePlaylistEntries(parsed.entries, { tracks, folders, platform: 'win32' });
  const unresolvedItem = createUnresolvedPlaylistItem(resolution.items[0].entry);
  const exported = serializeXSPF([unresolvedItem], { fileUris: false });

  assert.equal(resolution.items[0].status, 'unresolved');
  assert.equal(unresolvedItem.unresolved.album, 'Missing Album');
  assert.match(exported, /<album>Missing Album<\/album>/);
  assert.deepEqual(parseXSPF(exported).entries, [{
    path: 'Missing/Album Track.flac',
    title: 'Album Track',
    artist: 'Missing Artist',
    album: 'Missing Album',
    durationSec: 123
  }]);
});

test('path resolver builds shared lookup data once for batched entries', () => {
  let relativePathReads = 0;
  let titleReads = 0;
  let artistReads = 0;
  let durationReads = 0;
  const makeTrack = ({ id, relativePath, title, artist, durationSec }) => {
    const track = { id, folderId: 'f_music' };
    Object.defineProperties(track, {
      relativePath: {
        get() {
          relativePathReads += 1;
          return relativePath;
        }
      },
      title: {
        get() {
          titleReads += 1;
          return title;
        }
      },
      artist: {
        get() {
          artistReads += 1;
          return artist;
        }
      },
      durationSec: {
        get() {
          durationReads += 1;
          return durationSec;
        }
      }
    });
    return track;
  };
  const countedTracks = [
    makeTrack({ id: 't_one', relativePath: 'Blue Hour/One.flac', title: 'One', artist: 'Artist', durationSec: 60 }),
    makeTrack({ id: 't_two', relativePath: 'Live/Two.flac', title: 'Two', artist: 'Artist', durationSec: 120 })
  ];

  const result = resolvePlaylistEntries(
    [
      { path: 'D:/Music/Blue Hour/One.flac' },
      { path: 'Archive/Live/Two.flac' },
      { title: 'One', artist: 'Artist', durationSec: 60 }
    ],
    { tracks: countedTracks, folders: [{ id: 'f_music', path: 'D:/Music' }], platform: 'win32' }
  );

  assert.equal(result.resolvedCount, 3);
  assert.deepEqual(result.items.map(item => item.trackId), ['t_one', 't_two', 't_one']);
  assert.equal(relativePathReads, countedTracks.length * 2);
  assert.equal(titleReads, countedTracks.length);
  assert.equal(artistReads, countedTracks.length);
  assert.equal(durationReads, countedTracks.length);
});

test('scan controller resolves unresolved playlist items with a single shared resolution context', async () => {
  const database = new LibraryDatabase({ indexedDB: null });
  await database.putFolder({ id: 'f_music', path: 'D:\\Music' });
  await database.putTracks([
    {
      id: 't_one',
      folderId: 'f_music',
      relativePath: 'Blue Hour/One.flac',
      title: 'One',
      artist: 'Blue Hour',
      durationSec: 60
    },
    {
      id: 't_two',
      folderId: 'f_music',
      relativePath: 'Live/Two.flac',
      title: 'Two',
      artist: 'Live Band',
      durationSec: 120
    },
    {
      id: 't_three',
      folderId: 'f_music',
      relativePath: 'Other/Three.flac',
      title: 'Three',
      artist: 'Other',
      durationSec: 180
    }
  ]);
  await database.putPlaylist({
    id: 'p_mix',
    name: 'Mix',
    items: [
      {
        trackId: null,
        label: 'first',
        unresolved: {
          sourceLine: 'Missing/Blue Hour/One.flac',
          relativePathHint: 'Blue Hour/One.flac'
        }
      },
      {
        trackId: null,
        label: 'second',
        unresolved: {
          sourceLine: 'Archive/Live/Two.flac'
        }
      },
      {
        trackId: 't_three',
        label: 'kept'
      }
    ],
    updatedAt: 1
  });

  let getAllTracksCalls = 0;
  const getAllTracks = database.getAllTracks.bind(database);
  database.getAllTracks = async () => {
    getAllTracksCalls += 1;
    return getAllTracks();
  };
  const controller = new ScanController({
    database,
    index: {},
    source: {},
    artworkProcessor: {},
    emit() {}
  });

  const changedIds = await controller.resolveUnresolvedPlaylistItems();
  const [playlist] = await database.getAllPlaylists();

  assert.deepEqual(changedIds, ['p_mix']);
  assert.equal(getAllTracksCalls, 1);
  assert.equal(playlist.items[0].trackId, 't_one');
  assert.equal(playlist.items[0].label, 'first');
  assert.equal('unresolved' in playlist.items[0], false);
  assert.equal(playlist.items[1].trackId, 't_two');
  assert.equal(playlist.items[1].label, 'second');
  assert.equal('unresolved' in playlist.items[1], false);
  assert.equal(playlist.items[2].trackId, 't_three');
  assert.equal(playlist.items[2].label, 'kept');
  assert.notEqual(playlist.updatedAt, 1);
});
