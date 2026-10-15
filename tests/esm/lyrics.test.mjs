import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseLrc, lyricsFromLrcBytes, lyricsFromMetadata, lyricsCandidateNames,
  findLyricsFileName, selectLyrics, lyricsLineAt, boundLyrics
} from '../../js/library/metadata/lyrics.js';
import { decodeTextFileBytes, TEXT_FILE_MAX_BYTES } from '../../js/library/metadata/text-encoding.js';

test('LRC preserves repeated tags, global signed offsets, blank clearing lines and stable ordering', () => {
  const lyrics = parseLrc('[ar:Artist]\n[00:04.500][00:02.50]Repeated\n[00:02.500]Equal\n[00:06]\n[offset:+500]');
  assert.deepEqual(lyrics, { synced: true, lines: [
    { time: 2, text: 'Repeated' }, { time: 2, text: 'Equal' },
    { time: 4, text: 'Repeated' }, { time: 5.5, text: '' }
  ] });
  assert.equal(parseLrc('[offset:-250]\n[00:01.1]Later').lines[0].time, 1.35);
  assert.deepEqual(parseLrc('[ti:Title]\nFirst line\n\nSecond line'), {
    synced: false, lines: [{ text: 'First line' }, { text: 'Second line' }]
  });
  assert.equal(parseLrc('[ar:Artist]\n\n'), null);
});

test('enhanced LRC keeps word spacing and applies offsets to line and word times', () => {
  assert.deepEqual(parseLrc('[offset:100]\n[00:01][00:03]<00:01>Hello <00:01.500>world'), {
    synced: true, lines: [{ time: 0.9, text: 'Hello world', words: [
      { time: 0.9, text: 'Hello ' }, { time: 1.4, text: 'world' }
    ] }, { time: 2.9, text: 'Hello world', words: [
      { time: 2.9, text: 'Hello ' }, { time: 3.4, text: 'world' }
    ] }]
  });
});

test('repeated enhanced tags bound word expansion while retaining late CUE lines', () => {
  const lrc = '[00:01]'.repeat(1000) + '<00:01>x'.repeat(1000) +
    '\n[40:00]<40:00>Late <40:01>line';
  const lyrics = parseLrc(lrc);
  assert.equal(lyrics.lines.length, 1001);
  for (const line of lyrics.lines.slice(0, 1000)) {
    assert.equal(line.time, 1);
    assert.equal(line.text, 'x'.repeat(1000));
    assert.equal(line.words, undefined);
  }
  assert.deepEqual(selectLyrics({ sidecar: lyrics, region: { start: 2400, end: 2460 } }), {
    synced: true, lines: [{ time: 0, text: 'Late line', words: [
      { time: 0, text: 'Late ' }, { time: 1, text: 'line' }
    ] }]
  });
});

test('native metadata preserves full LRC syntax and synced sources outrank plain text', () => {
  assert.deepEqual(lyricsFromMetadata({ native: { ID3v2: [
    { id: 'USLT', value: { text: 'Plain text' } },
    { id: 'Lyrics', value: '[offset:500]\n[00:01][00:02]Timed' }
  ] }, common: { lyrics: 'Ignored projection' } }), {
    synced: true, lines: [{ time: 0.5, text: 'Timed' }, { time: 1.5, text: 'Timed' }]
  });
  for (const id of ['USLT', 'LYRICS', 'UNSYNCEDLYRICS', '©lyr', 'Lyrics', 'WM/Lyrics']) {
    assert.equal(lyricsFromMetadata({ native: { tags: [{ id, value: 'Text' }] } }).lines[0].text, 'Text');
  }
});

test('SYLT fragments assemble newline-delimited rows and retain word timing', () => {
  const syncText = [
    { text: 'Hello ', timestamp: 1000 }, { text: 'world', timestamp: 1500 },
    { text: '\nNext ', timestamp: 3000 }, { text: 'line', timestamp: 3500 }
  ];
  const native = timeStampFormat => ({ native: { ID3v2: [{ id: 'SYLT', value: { timeStampFormat, syncText } }] } });
  assert.deepEqual(lyricsFromMetadata(native(2)), { synced: true, lines: [
    { time: 1, text: 'Hello world', words: [{ time: 1, text: 'Hello ' }, { time: 1.5, text: 'world' }] },
    { time: 3, text: 'Next line', words: [{ time: 3, text: 'Next ' }, { time: 3.5, text: 'line' }] }
  ] });
  assert.deepEqual(lyricsFromMetadata(native(1)), { synced: false, lines: [
    { text: 'Hello world' }, { text: 'Next line' }
  ] });
  assert.deepEqual(lyricsFromMetadata({ native: { ID3v2: [{ id: 'SYLT', value: {
    timeStampFormat: 2, syncText: [{ text: 'One', timestamp: 1000 }, { text: 'Two', timestamp: 2000 }]
  } }] } }), { synced: true, lines: [{ time: 1, text: 'One' }, { time: 2, text: 'Two' }] });
});

test('sidecar names match CUE titles, filename characters, case and NFC', () => {
  assert.deepEqual(lyricsCandidateNames({ fileName: 'Disc/Album.wav' }), ['Album']);
  assert.deepEqual(lyricsCandidateNames({ fileName: 'Album.flac', cue: { title: 'Song', performer: 'Artist' } }),
    ['Artist - Song', 'Song', 'Album']);
  assert.deepEqual(lyricsCandidateNames({ fileName: 'Album.flac', cue: { title: 'Song' } }), ['Song', 'Album']);
  assert.deepEqual(findLyricsFileName(['ALBUM.LRC', 'Artist - Song.LRC'], ['Artist - Song', 'Album']),
    { fileName: 'Artist - Song.LRC', index: 0 });
  assert.deepEqual(findLyricsFileName(['Cafe\u0301.LRC'], ['Café']), { fileName: 'Cafe\u0301.LRC', index: 0 });
  assert.deepEqual(findLyricsFileName(['A_B_C_.lrc'], ['A/B:C?']), { fileName: 'A_B_C_.lrc', index: 0 });
  assert.equal(findLyricsFileName(['Other.lrc'], ['Album']), null);
});

test('selection prefers synced then sidecar, while a per-track CUE sidecar wins directly', () => {
  const plain = { synced: false, lines: [{ text: 'Plain' }] };
  const synced = { synced: true, lines: [{ time: 1, text: 'Synced' }] };
  assert.deepEqual(selectLyrics({ sidecar: plain, embedded: synced }), synced);
  assert.deepEqual(selectLyrics({ sidecar: synced, embedded: plain }), synced);
  const other = { synced: true, lines: [{ time: 1, text: 'Embedded' }] };
  assert.deepEqual(selectLyrics({ sidecar: synced, embedded: other }), synced);
  assert.deepEqual(selectLyrics({ sidecar: plain, embedded: synced, perTrack: true, region: { start: 10, end: 20 } }), plain);
  assert.equal(selectLyrics({}), null);
});

test('CUE image lyrics rebase once, keep the half-open region, and exclude unsynced images', () => {
  const embedded = { synced: true, lines: [
    { time: 9, text: 'Before' }, { time: 10, text: 'First', words: [{ time: 10, text: 'First' }] },
    { time: 15, text: 'Second', words: [{ time: 15.5, text: 'Second' }] }, { time: 20, text: 'After' }
  ] };
  assert.deepEqual(selectLyrics({ embedded, region: { start: 10, end: 20 } }), { synced: true, lines: [
    { time: 0, text: 'First', words: [{ time: 0, text: 'First' }] },
    { time: 5, text: 'Second', words: [{ time: 5.5, text: 'Second' }] }
  ] });
  assert.deepEqual(selectLyrics({ embedded, region: { start: 20, end: null } }), {
    synced: true, lines: [{ time: 0, text: 'After' }]
  });
  assert.equal(embedded.lines[1].time, 10);
  const plain = { synced: false, lines: [{ text: 'Plain' }] };
  assert.equal(selectLyrics({ embedded: plain, region: { start: 0, end: 20 } }), null);
  assert.deepEqual(selectLyrics({ embedded: plain, region: { start: 0, end: null } }), plain);
});

test('album lyrics keep late CUE regions until the selected result is bounded', () => {
  const timestamp = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const text = 'A'.repeat(48);
  const lrc = Array.from({ length: 500 }, (_, index) => {
    const time = timestamp(index * 6);
    return `[${time}]<${time}>${text}`;
  }).join('\n');
  const sidecar = lyricsFromLrcBytes(new TextEncoder().encode(lrc));
  const embedded = lyricsFromMetadata({ native: { tags: [{ id: 'Lyrics', value: lrc }] } });
  const sylt = lyricsFromMetadata({ native: { tags: [{ id: 'SYLT', value: {
    timeStampFormat: 2, syncText: Array.from({ length: 500 }, (_, index) => [
      { timestamp: index * 6000, text: `\n${text.slice(0, 24)}` },
      { timestamp: index * 6000 + 1000, text: text.slice(24) }
    ]).flat()
  } }] } });
  for (const source of [sidecar, embedded, sylt]) {
    assert.equal(source.lines.length, 500);
    const selected = selectLyrics({ embedded: source, region: { start: 2400, end: 3000 } });
    assert.equal(selected.lines.length, 100);
    assert.equal(selected.lines[0].time, 0);
    assert.equal(selected.lines[0].words[0].time, 0);
    assert.equal(selected.lines.at(-1).time, 594);
    assert.ok(new TextEncoder().encode(JSON.stringify({ lyrics: selected })).byteLength < 512 * 1024);
    assert.ok(selectLyrics({ sidecar: source }).lines.length < 500);
  }
});

test('line lookup picks the last equal timestamp and leaves pre-start time unselected', () => {
  const lines = [{ time: 1 }, { time: 2 }, { time: 2 }, { time: 5 }];
  for (const [time, index] of [[-1, -1], [1, 0], [1.5, 0], [2, 2], [4, 2], [5, 3], [100, 3]]) {
    assert.equal(lyricsLineAt(lines, time), index);
  }
  assert.equal(lyricsLineAt([], 0), -1);
});

test('shared text decoder handles UTF-8, UTF-16 byte orders and Shift_JIS fallback', () => {
  const text = '[00:01]作品';
  assert.equal(decodeTextFileBytes(new TextEncoder().encode(text)), text);
  for (const little of [true, false]) {
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes.set(little ? [0xff, 0xfe] : [0xfe, 0xff]);
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      bytes[index * 2 + 2] = little ? code & 255 : code >>> 8;
      bytes[index * 2 + 3] = little ? code >>> 8 : code & 255;
    }
    assert.equal(decodeTextFileBytes(bytes), text);
  }
  assert.equal(decodeTextFileBytes(Uint8Array.from([0x82, 0xa0])), 'あ');
  assert.deepEqual(lyricsFromLrcBytes(new TextEncoder().encode(text)), {
    synced: true, lines: [{ time: 1, text: '作品' }]
  });
  assert.equal(lyricsFromLrcBytes(new Uint8Array(TEXT_FILE_MAX_BYTES + 1)), null);
  assert.equal(lyricsFromLrcBytes(Uint8Array.from([0xff, 0xfe, 0x01])), null);
});

test('bounded lyrics truncate oversized payloads below the metadata worker JSON limit', () => {
  const text = '\u0000'.repeat(4096);
  const lines = Array.from({ length: 3000 }, (_, index) => ({
    time: index, text, words: [{ time: index, text }]
  }));
  const result = boundLyrics({ synced: true, lines });
  assert.ok(result.lines.length < lines.length);
  assert.ok(new TextEncoder().encode(JSON.stringify({ lyrics: result })).byteLength < 512 * 1024);
  const many = boundLyrics({ synced: true, lines: Array.from({ length: 3000 }, () => ({
    time: Number.MAX_VALUE, text: '', words: Array.from({ length: 4 }, () => ({ time: Number.MAX_VALUE, text: '' }))
  })) });
  assert.ok(many.lines.length <= 2048);
  assert.ok(new TextEncoder().encode(JSON.stringify({ lyrics: many })).byteLength < 512 * 1024);
});
