import assert from 'node:assert/strict';
import test from 'node:test';

import { WebMetadataParser } from '../../js/library/scan/web-metadata-parser.js';

function decodeWindows1252(bytes) {
  return new TextDecoder('windows-1252').decode(Uint8Array.from(bytes));
}

function createParser({ metadata, riffInfoTags = [], languageHints = null, relativePath = 'track.mp3' }) {
  const file = new Blob([]);
  return {
    relativePath,
    parser: new WebMetadataParser({
      filesystem: { async getFile() { return file; } },
      parse: async () => metadata,
      readRiffInfo: async () => riffInfoTags,
      languageHints,
      now: () => 1
    })
  };
}

test('Web catalog metadata parsing keeps the v2 legacy Japanese mojibake repairs', async () => {
  const { parser, relativePath } = createParser({
    relativePath: '日本語/mojibake.mp3',
    languageHints: { language: 'ja', browserLanguage: 'ja-JP' },
    metadata: {
      common: {
        title: '\u201A\u00B1\u201A\u00F1\u201A\u00C9\u201A\u00BF\u201A\u00CD',
        artist: '\u0083A\u0081[\u0083e\u0083B\u0083X\u0083g',
        album: 'Plain Album'
      },
      format: {}
    }
  });

  const result = await parser.parse({ relativePath, skipCovers: true });

  assert.equal(result.title, 'こんにちは');
  assert.equal(result.artist, 'アーティスト');
  assert.equal(result.album, 'Plain Album');
});

test('Web catalog metadata parsing decodes raw CP932 RIFF INFO before text bytes are lost', async () => {
  const { parser, relativePath } = createParser({
    relativePath: '平賀マリカ/MONA LISA.wav',
    languageHints: { language: 'ja' },
    metadata: {
      common: { title: 'MONA LISA', artist: 'bad decoded artist' },
      format: { codec: 'PCM' }
    },
    riffInfoTags: [
      { id: 'IART', data: Uint8Array.from([0x95, 0xbd, 0x89, 0xea, 0x83, 0x7d, 0x83, 0x8a, 0x83, 0x4a, 0x00]) }
    ]
  });

  const result = await parser.parse({ relativePath, skipCovers: true });

  assert.equal(result.artist, '平賀マリカ');
  assert.equal(result.albumArtist, '平賀マリカ');
});

test('Web catalog metadata parsing preserves common text over ID3v1 and numeric genre codes', async () => {
  const { parser, relativePath } = createParser({
    metadata: {
      common: {
        title: 'Long Common Title',
        artists: ['Long Common Artist'],
        album: 'Long Common Album',
        genre: ['Rock']
      },
      native: {
        'ID3v2.3': [{ id: 'TCON', value: '17' }],
        ID3v1: [
          { id: 'title', value: 'Truncated Title' },
          { id: 'artist', value: 'Truncated Artist' },
          { id: 'album', value: 'Truncated Album' },
          { id: 'genre', value: 'Truncated Genre' }
        ]
      },
      format: {}
    }
  });

  const result = await parser.parse({ relativePath, skipCovers: true });

  assert.deepEqual({
    title: result.title,
    artist: result.artist,
    album: result.album,
    genre: result.genre
  }, {
    title: 'Long Common Title',
    artist: 'Long Common Artist',
    album: 'Long Common Album',
    genre: 'Rock'
  });
});

test('Web catalog metadata parsing maps alternate RIFF INFO identifiers', async () => {
  const encode = value => new TextEncoder().encode(`${value}\0`);
  const { parser, relativePath } = createParser({
    relativePath: 'alternate.wav',
    metadata: { common: {}, native: {}, format: { codec: 'PCM' } },
    riffInfoTags: [
      { id: 'TITL', data: encode('Alternate Title') },
      { id: 'IART', data: encode('Alternate Artist') },
      { id: 'IRPD', data: encode('Alternate Album') },
      { id: 'ICRD', data: encode('2021-04-03') }
    ]
  });

  const result = await parser.parse({ relativePath, skipCovers: true });

  assert.deepEqual({
    title: result.title,
    artist: result.artist,
    albumArtist: result.albumArtist,
    album: result.album,
    year: result.year
  }, {
    title: 'Alternate Title',
    artist: 'Alternate Artist',
    albumArtist: 'Alternate Artist',
    album: 'Alternate Album',
    year: 2021
  });
});

test('Web catalog metadata parsing repairs mojibake across non-Japanese scripts', async () => {
  const cases = [
    {
      fileName: 'cyrillic.mp3',
      title: decodeWindows1252([0xd0, 0x9f, 0xd1, 0x80, 0xd0, 0xb8, 0xd0, 0xb2, 0xd0, 0xb5, 0xd1, 0x82]),
      expected: 'Привет'
    },
    {
      fileName: 'korean.mp3',
      title: decodeWindows1252([0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4]),
      expected: '안녕하세요'
    },
    {
      fileName: 'chinese.mp3',
      title: decodeWindows1252([0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7]),
      expected: '你好世界'
    },
    {
      fileName: 'greek.mp3',
      title: decodeWindows1252([0xce, 0x93, 0xce, 0xb5, 0xce, 0xb9, 0xce, 0xac]),
      expected: 'Γειά'
    },
    {
      fileName: 'arabic.mp3',
      title: decodeWindows1252([0xd9, 0x85, 0xd8, 0xb1, 0xd8, 0xad, 0xd8, 0xa8, 0xd8, 0xa7]),
      expected: 'مرحبا'
    },
    {
      fileName: 'hebrew.mp3',
      title: decodeWindows1252([0xd7, 0xa9, 0xd7, 0x9c, 0xd7, 0x95, 0xd7, 0x9d]),
      expected: 'שלום'
    },
    {
      fileName: 'utf8-western.mp3',
      title: decodeWindows1252([0x42, 0x65, 0x79, 0x6f, 0x6e, 0x63, 0xc3, 0xa9]),
      expected: 'Beyoncé'
    }
  ];

  for (const item of cases) {
    const { parser, relativePath } = createParser({
      relativePath: item.fileName,
      metadata: { common: { title: item.title }, format: {} }
    });
    const result = await parser.parse({ relativePath, skipCovers: true });
    assert.equal(result.title, item.expected, item.fileName);
  }
});

test('Web catalog metadata parsing preserves clean accented Latin text under unrelated hints', async () => {
  const cases = [
    { title: 'Éçàùîô', languageHints: { language: 'ru' } },
    { title: 'Café', languageHints: { language: 'ru' } },
    { title: 'Grüße', languageHints: { language: 'el' } }
  ];

  for (const item of cases) {
    const { parser, relativePath } = createParser({
      metadata: { common: { title: item.title }, format: {} },
      languageHints: item.languageHints
    });
    const result = await parser.parse({ relativePath, skipCovers: true });
    assert.equal(result.title, item.title);
  }
});

test('Web catalog metadata parsing preserves the full catalog technical projection', async () => {
  const { parser, relativePath } = createParser({
    metadata: {
      common: {
        title: 'Projection',
        artist: 'Artist',
        albumartist: 'Various Artists',
        compilation: true,
        disk: { no: 2, of: 3 },
        track: { no: 7, of: 12 }
      },
      format: {
        duration: 123.5,
        sampleRate: 96_000,
        bitrate: 2_304_000,
        bitsPerSample: 24,
        numberOfChannels: 2,
        codec: 'FLAC'
      }
    }
  });

  const result = await parser.parse({ relativePath, skipCovers: true });

  assert.deepEqual({
    compilation: result.compilation,
    discNo: result.discNo,
    discTotal: result.discTotal,
    trackNo: result.trackNo,
    trackTotal: result.trackTotal,
    bitrate: result.bitrate,
    bitsPerSample: result.bitsPerSample,
    channels: result.channels
  }, {
    compilation: true,
    discNo: 2,
    discTotal: 3,
    trackNo: 7,
    trackTotal: 12,
    bitrate: 2_304_000,
    bitsPerSample: 24,
    channels: 2
  });
});

test('Web catalog metadata parsing drops technical values that the catalog cannot store', async () => {
  const { parser, relativePath } = createParser({
    metadata: {
      common: {
        title: 'Invalid Technical Values'
      },
      format: {
        duration: -1,
        sampleRate: -1,
        bitrate: -1,
        bitsPerSample: 24.5,
        numberOfChannels: -2
      }
    }
  });

  const result = await parser.parse({ relativePath, skipCovers: true });

  assert.deepEqual({
    durationSec: result.durationSec,
    sampleRate: result.sampleRate,
    bitrate: result.bitrate,
    bitsPerSample: result.bitsPerSample,
    channels: result.channels
  }, {
    durationSec: null,
    sampleRate: null,
    bitrate: null,
    bitsPerSample: null,
    channels: null
  });
});

test('Web catalog metadata parsing retries duration and tolerates optional RIFF tag failure', async () => {
  const parseModes = [];
  const parser = new WebMetadataParser({
    filesystem: { async getFile() { return new Blob([]); } },
    async parse(_file, options) {
      parseModes.push(options.duration);
      options.observer({ tag: { type: 'ID3v2', id: 'TIT2', value: 'Retry Duration' } });
      return {
        common: { title: 'Retry Duration' },
        format: options.duration ? { duration: 42 } : {}
      };
    },
    async readRiffInfo() {
      throw new Error('RIFF INFO is unavailable');
    }
  });

  const result = await parser.parse({ relativePath: 'retry.mp3', skipCovers: true });

  assert.deepEqual(parseModes, [false, true]);
  assert.equal(result.title, 'Retry Duration');
  assert.equal(result.durationSec, 42);
});

test('Web catalog metadata parsing classifies corrupt container failures', async () => {
  const parser = new WebMetadataParser({
    filesystem: { async getFile() { return new Blob([]); } },
    async parse() {
      const error = new Error('Unable to read corrupt container');
      error.name = 'CouldNotDetermineFileTypeError';
      throw error;
    },
    async readRiffInfo() { return []; }
  });

  await assert.rejects(
    parser.parse({ relativePath: 'corrupt.mp3', skipCovers: true }),
    error => error?.code === 'corrupt-container'
  );
});

test('Web catalog metadata parsing preserves cancellation and bounds repository text fields', async () => {
  const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  const abortedParser = new WebMetadataParser({
    filesystem: { async getFile() { return new Blob([]); } },
    async parse() { throw abort; },
    async readRiffInfo() { return []; }
  });
  await assert.rejects(
    abortedParser.parse({ relativePath: 'cancel.mp3', skipCovers: true }),
    error => error === abort && error?.code !== 'parse-timeout'
  );

  const { parser, relativePath } = createParser({
    metadata: {
      common: {
        title: 't'.repeat(4_100),
        artist: 'a'.repeat(4_100),
        albumartist: 'r'.repeat(4_100),
        album: 'l'.repeat(4_100),
        genre: ['g'.repeat(4_100)]
      },
      format: { codec: 'c'.repeat(600) }
    }
  });
  const bounded = await parser.parse({ relativePath, skipCovers: true });
  assert.deepEqual({
    title: bounded.title.length,
    artist: bounded.artist.length,
    albumArtist: bounded.albumArtist.length,
    album: bounded.album.length,
    genre: bounded.genre.length,
    codec: bounded.codec.length
  }, {
    title: 4096,
    artist: 4096,
    albumArtist: 4096,
    album: 4096,
    genre: 4096,
    codec: 512
  });
});
