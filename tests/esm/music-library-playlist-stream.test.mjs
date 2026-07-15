import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseM3U,
  parsePLS,
  parseXSPF,
  serializeM3U8,
  serializeXSPF
} from '../../js/library/playlists/playlist-formats.js';
import {
  PlaylistEncodingReplayRequiredError,
  PlaylistStreamLimitError,
  parsePlaylistStream,
  serializeM3U8Stream,
  serializeXSPFStream
} from '../../js/library/playlists/playlist-stream.js';

const encoder = new TextEncoder();

function byteChunkFactory(bytes, size) {
  return async function* chunks() {
    for (let offset = 0; offset < bytes.length; offset += size) {
      yield bytes.subarray(offset, Math.min(offset + size, bytes.length));
    }
  };
}

async function collectEntries(records) {
  const entries = [];
  for await (const record of records) {
    assert.equal(record.type, 'entry');
    entries.push(record.entry);
  }
  return entries;
}

async function joinChunks(chunks, maxLength = Number.POSITIVE_INFINITY) {
  const output = [];
  for await (const chunk of chunks) {
    assert.ok(chunk.length <= maxLength, `chunk length ${chunk.length} exceeded ${maxLength}`);
    output.push(chunk);
  }
  return output.join('');
}

test('streaming M3U parsing preserves BOM, CRLF, EXTINF, and URI semantics', async () => {
  const text = [
    '#EXTM3U',
    '#EXTINF:245,Blue Hour - Cafe Song',
    'file:///C:/Music/Blue%20Hour/Cafe%20Song.flac',
    '# comment',
    '#EXTINF:-1,Loose Track',
    '../Loose/Track.wav',
    ''
  ].join('\r\n');
  const body = encoder.encode(text);
  const bytes = new Uint8Array(body.length + 3);
  bytes.set([0xef, 0xbb, 0xbf]);
  bytes.set(body, 3);

  const streamed = await collectEntries(parsePlaylistStream(byteChunkFactory(bytes, 5), { fileName: 'mix.m3u' }));

  assert.deepEqual(streamed, parseM3U(`\ufeff${text}`).entries);
});

test('one-shot async text chunks are detected without a byte-input hint', async () => {
  async function* chunks() {
    yield '';
    yield '\ufeff#EXTM3U\n#EXTINF:1,Artist - Title\n';
    yield 'song.flac\n';
  }

  assert.deepEqual(await collectEntries(parsePlaylistStream(chunks(), { fileName: 'mix.m3u' })), [{
    path: 'song.flac',
    artist: 'Artist',
    title: 'Title',
    durationSec: 1
  }]);
});

test('replayable byte streams preserve legacy Shift_JIS fallback', async () => {
  const bytes = Uint8Array.from([
    0x23, 0x45, 0x58, 0x54, 0x4d, 0x33, 0x55, 0x0a,
    0x23, 0x45, 0x58, 0x54, 0x49, 0x4e, 0x46, 0x3a,
    0x31, 0x2c, 0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x0a,
    0x73, 0x6f, 0x6e, 0x67, 0x2e, 0x66, 0x6c, 0x61, 0x63, 0x0a
  ]);

  const entries = await collectEntries(parsePlaylistStream(byteChunkFactory(bytes, 4), { fileName: 'mix.m3u' }));

  assert.deepEqual(entries, [{ path: 'song.flac', title: 'テスト', durationSec: 1 }]);
});

test('one-shot legacy-capable streams require a safe encoding decision', async () => {
  async function* source() {
    yield encoder.encode('one.flac\n');
  }

  await assert.rejects(
    async () => collectEntries(parsePlaylistStream(source(), { fileName: 'mix.m3u' })),
    PlaylistEncodingReplayRequiredError
  );
  assert.deepEqual(
    await collectEntries(parsePlaylistStream(source(), { fileName: 'mix.m3u', encoding: 'utf-8' })),
    [{ path: 'one.flac' }]
  );
});

test('streaming PLS parsing emits disk-staging-friendly indexed field updates', async () => {
  const source = [
    '[playlist]',
    'Title2=Second Artist - Second Title',
    'File1=First.flac',
    'Length2=321',
    'File2=file:///C:/Music/Second.flac',
    'Title1=First Title',
    'Length1=-1',
    ''
  ].join('\n');
  const updates = [];
  for await (const record of parsePlaylistStream(byteChunkFactory(encoder.encode(source), 7), { fileName: 'mix.pls' })) {
    updates.push(record);
  }

  assert.deepEqual(updates, [
    { type: 'fields', index: 2, fields: { artist: 'Second Artist', title: 'Second Title' } },
    { type: 'fields', index: 1, fields: { path: 'First.flac' } },
    { type: 'fields', index: 2, fields: { durationSec: 321 } },
    { type: 'fields', index: 2, fields: { path: 'C:\\Music\\Second.flac' } },
    { type: 'fields', index: 1, fields: { title: 'First Title' } }
  ]);
  assert.equal(parsePLS(source).entries.length, 2);
});

test('streaming XSPF tokenizer preserves supported fields and XML escaping across chunks', async () => {
  const entries = [{
    path: 'D:\\Music\\A&B.flac',
    title: 'A & B',
    artist: 'Me <You>',
    album: 'The "Best"',
    durationSec: 12.5
  }];
  const source = `<!-- <track><location>ignored</location></track> -->\n${serializeXSPF(entries)}`;

  const streamed = await collectEntries(parsePlaylistStream(
    byteChunkFactory(encoder.encode(source), 3),
    { fileName: 'mix.xspf' }
  ));

  assert.deepEqual(streamed, entries);
  assert.deepEqual(parseXSPF(serializeXSPF(entries)).entries, entries);
});

test('streaming parsers fail with typed errors on oversized bounded buffers', async () => {
  const oversizedLine = encoder.encode(`${'a'.repeat(65)}\n`);
  await assert.rejects(
    async () => collectEntries(parsePlaylistStream(byteChunkFactory(oversizedLine, 16), {
      fileName: 'mix.m3u8',
      limits: { maxLineChars: 64 }
    })),
    error => error instanceof PlaylistStreamLimitError && error.kind === 'line characters'
  );

  const oversizedXml = encoder.encode(`<playlist><trackList><track><location>${'x'.repeat(65)}</location></track></trackList></playlist>`);
  await assert.rejects(
    async () => collectEntries(parsePlaylistStream(byteChunkFactory(oversizedXml, 16), {
      fileName: 'mix.xspf',
      limits: { maxXmlValueChars: 64 }
    })),
    error => error instanceof PlaylistStreamLimitError && error.kind === 'XML value characters'
  );
});

test('streaming serializers preserve synchronous output and bound every chunk', async () => {
  const entries = Array.from({ length: 200 }, (_, index) => ({
    path: `Folder/Track ${index}.flac`,
    title: `Track & ${index}`,
    artist: 'Artist',
    durationSec: index
  }));

  assert.equal(
    await joinChunks(serializeM3U8Stream(entries, { limits: { maxOutputChunkChars: 256 } }), 256),
    serializeM3U8(entries)
  );
  assert.equal(
    await joinChunks(serializeXSPFStream(entries, {
      fileUris: false,
      limits: { maxOutputChunkChars: 512 }
    }), 512),
    serializeXSPF(entries, { fileUris: false })
  );
});

test('100k-entry streaming parse and serialize keep records and chunks bounded', { timeout: 30000 }, async () => {
  const entryCount = 100000;
  const maxInputChunkBytes = 8192;
  const source = async function* generate() {
    let chunk = '#EXTM3U\n';
    for (let index = 0; index < entryCount; index += 1) {
      const record = `#EXTINF:${index % 300},Artist - Track ${index}\nFolder/Track ${index}.flac\n`;
      if (chunk.length + record.length > maxInputChunkBytes) {
        yield encoder.encode(chunk);
        chunk = '';
      }
      chunk += record;
    }
    if (chunk) yield encoder.encode(chunk);
  };

  let parsed = 0;
  let bufferedRecords = 0;
  let peakBufferedRecords = 0;
  for await (const record of parsePlaylistStream(source, { fileName: 'large.m3u8' })) {
    bufferedRecords += 1;
    peakBufferedRecords = Math.max(peakBufferedRecords, bufferedRecords);
    assert.equal(record.entry.path, `Folder/Track ${parsed}.flac`);
    parsed += 1;
    bufferedRecords -= 1;
  }
  assert.equal(parsed, entryCount);
  assert.equal(peakBufferedRecords, 1);

  const entries = async function* generateEntries() {
    for (let index = 0; index < entryCount; index += 1) {
      yield { path: `Folder/Track ${index}.flac`, title: `Track ${index}` };
    }
  };
  let chunks = 0;
  let peakChunkChars = 0;
  for await (const chunk of serializeM3U8Stream(entries(), { limits: { maxOutputChunkChars: 4096 } })) {
    chunks += 1;
    peakChunkChars = Math.max(peakChunkChars, chunk.length);
  }
  assert.ok(chunks > 100);
  assert.ok(peakChunkChars <= 4096);
});
