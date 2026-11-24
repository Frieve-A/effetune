import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open as openFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlobSource, createFileHandleSource, getArchiveFormat, openArchive } from '../../js/library/archive/archive-reader.js';
import { createArchiveCache } from '../../js/library/archive/archive-cache.js';
import { findArchiveWrdEntry } from '../../js/library/archive/score-entries.js';
import { createArchiveEntryTrackMetadata } from '../../js/library/metadata/midi-metadata.js';
import { zip, tar, gzip } from '../helpers/archive-fixtures.mjs';
import { lzh } from '../helpers/lzh-encoder.mjs';

const open = (bytes, name) => openArchive(createBlobSource(new Blob([bytes])), name);
const code = kind => ({ code: 'archive-' + kind });
const text = async (archive, name) => Buffer.from(await archive.read(name)).toString();

test('ZIP lists stored and deflated files, skips unsafe paths and uses the first duplicate', async () => {
  const entries = [['a\\song.mid', 'first'], ['a/song.mid', 'second'], ['../outside', ''], ['/root', ''], ['a//b', ''], ['C:\\drive', ''], ['./C:/drive.mid', ''], ['folder/', '']];
  for (const method of [0, 8]) {
    const archive = await open(zip(entries, method), 'set.zip');
    assert.deepEqual(archive.entries.map(e => e.path), ['a/song.mid', 'a/song.mid']);
    assert.equal(await text(archive, 'a/song.mid'), 'first');
  }
});

test('archive score metadata parses the literal final extension after a sharp or question mark', async () => {
  const data = Buffer.from('4d546864000000060000000101e04d54726b0000000400ff2f00', 'hex');
  for (const name of ['Score.xml#2.mid', 'Score.mxl?2.kar']) {
    const archive = await open(zip([[name, data]]), 'book.zip');
    const track = await createArchiveEntryTrackMetadata({ relativePath: 'book.zip' }, archive, name);
    assert.equal(track.codec, 'MIDI');
    assert.equal(track.title, name.slice(0, -4));
  }
});

test('ZIP rejects ZIP64 and checks method, encryption, declared size and CRC at extraction', async () => {
  function changed(edit) {
    const bytes = zip([['score.mid', '0123456']]);
    const offset = bytes.indexOf(Buffer.from([80, 75, 1, 2]));
    edit(bytes, offset);
    return open(bytes, 'test.zip');
  }
  for (const edit of [(bytes, pos) => bytes.writeUInt16LE(1, pos + 8), (bytes, pos) => bytes.writeUInt16LE(12, pos + 10)]) {
    const archive = await changed(edit);
    assert.equal(archive.entries[0].supported, false);
    await assert.rejects(archive.read('score.mid'), code('unsupported'));
  }
  await assert.rejects(changed((b, i) => b.writeUInt32LE(0xffffffff, i + 42)), code('unsupported'));
  for (const [offset, value, kind] of [[16, 1, 'corrupt'], [24, 2 ** 26, 'too-large'], [24, 1, 'too-large']]) {
    const archive = await changed((b, i) => b.writeUInt32LE(value, i + offset));
    await assert.rejects(archive.read('score.mid'), code(kind));
  }
});

test('tar lists ustar, GNU long and pax paths, skipping links; gzip and tgz round-trip', async () => {
  const bytes = tar([['base.mid', 'ustar', '0', 'folder'], ['long', 'long/path.mid\0', 'L'], ['short', 'gnu'],
    ['pax', '21 path=pax/song.mid\n', 'x'], ['short', 'pax'], ['link', '', '2']]);
  for (const [name, data] of [['list.tar', bytes], ['list.tgz', gzip(bytes)], ['list.TAR.GZ', gzip(bytes)]]) {
    const archive = await open(data, name);
    assert.deepEqual(archive.entries.map(e => e.path), ['folder/base.mid', 'long/path.mid', 'pax/song.mid']);
    assert.deepEqual(await Promise.all(archive.entries.map(e => text(archive, e.path))), ['ustar', 'gnu', 'pax']);
  }
  assert.equal(getArchiveFormat('song.mid.gz'), 'gz');
  assert.equal(getArchiveFormat('book.mxl'), null);
  const single = await open(gzip('single'), 'dir/song.mid.gz');
  assert.equal(await text(single, 'song.mid'), 'single');
});

test('GNU tar timestamps leave score and WRD sibling paths intact', async () => {
  const bytes = tar([['set/song.mid', 'score'], ['set/song.wrd', 'lyrics']], { gnu: true });
  const archive = await open(bytes, 'set.tar');
  assert.deepEqual(archive.entries.map(e => e.path), ['set/song.mid', 'set/song.wrd']);
  const wrd = findArchiveWrdEntry(archive, 'set/song.mid');
  assert.equal(await text(archive, wrd.path), 'lyrics');
});

test('LZH levels 0-2 support stored, LH4 through LH7, overlapping matches and single-symbol blocks', async () => {
  const data = Buffer.concat([Buffer.from(Array.from({length: 256}, (_, i) => i)), Buffer.from('grand piano '.repeat(100))]);
  for (const method of ['lh0', 'lh4', 'lh5', 'lh6', 'lh7']) for (const level of [0, 1, 2]) {
    const archive = await open(lzh([['set/music.mid', data], ['one.mid', 'Q']], { level, method }), 'set.LHA');
    assert.deepEqual(archive.entries.map(e => e.path), ['set/music.mid', 'one.mid']);
    assert.deepEqual(Buffer.from(await archive.read('set/music.mid')), data);
    assert.equal(await text(archive, 'one.mid'), 'Q');
  }
});

test('LZH decodes legacy names before normalizing backslashes, validates header and data CRCs', async () => {
  const sjis = Buffer.from([0x83,0x5c,0x83,0x69,0x83,0x5e,0x82,0xcc,0x8b,0xc8,46,109,105,100]);
  const bytes = lzh([[sjis, 'score']], { method: 'lh0' });
  const name = 'ソナタの曲.mid';
  assert.equal(await text(await open(bytes, 'set.lzh'), name), 'score');
  const nested = Buffer.concat([Buffer.from([0x83, 0x5c, 47]), sjis]);
  for (const level of [0, 1, 2]) {
    const archive = await open(lzh([[nested, 'score']], { level }), 'set.lzh');
    assert.equal(await text(archive, 'ソ/' + name), 'score');
  }
  const badHeader = Buffer.from(bytes);
  badHeader[27] ^= 1;
  await assert.rejects(open(badHeader, 'set.lzh'), code('corrupt'));
  bytes[bytes.length - 2] ^= 1;
  await assert.rejects((await open(bytes, 'set.lzh')).read(name), code('corrupt'));
});

test('short unflagged Shift_JIS names decode as Japanese, while other legacy names keep the fallback', async () => {
  const name = (bytes, text) => [Buffer.from([...bytes, 46, 109, 105, 100]), text + '.mid'];
  const names = [name([0x8b, 0xc8], '曲'), name([0x83, 0x5c], 'ソ'), name([0xbf, 0xde, 0xb3], 'ｿﾞｳ'),
    name([0x83, 0x5c, 0x5c, 0x8b, 0xc8], 'ソ/曲'), name([0x43, 0x61, 0x66, 0xe9], 'Café')];
  const entries = names.map(([bytes]) => [bytes, 'score']);
  const archives = [await open(zip(entries), 'set.zip'),
    ...await Promise.all([0, 1, 2].map(level => open(lzh(entries, { level, method: 'lh0' }), 'set.lzh')))];
  for (const archive of archives) assert.deepEqual(archive.entries.map(e => e.path), names.map(([, text]) => text));
});

test('LZH treats 0xFF as a path separator at every header level', async () => {
  const name = Buffer.from([...Buffer.from('set'), 255, ...Buffer.from('song.mid')]);
  for (const level of [0, 1, 2]) {
    assert.equal(await text(await open(lzh([[name, 'score']], { level, method: 'lh0' }), 'set.lzh'), 'set/song.mid'), 'score');
  }
});

test('tar and LZH bound entry counts including headers omitted from the list', async () => {
  for (const [name, header] of [['large.tar', tar([['link', '', '2']]).subarray(0, 512)],
    ['large.lzh', lzh([['x', '']], { method: 'lh0', level: 0 }).subarray(0, -1)]]) {
    const source = { size: header.length * 65536, read: (_offset, length) => header.subarray(0, length) };
    await assert.rejects(openArchive(source, name), code('too-large'));
  }
});

test('a source I/O error is preserved through streaming decompression', async () => {
  const error = Object.assign(new Error('read failed'), { code: 'EIO' });
  await assert.rejects(openArchive({ size: 10, read() { throw error; } }, 'set.tgz'), actual => actual === error);
});

test('a physical file shortened after stat is a read failure, whereas malformed archive bounds are corruption', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'effetune-archive-eof-')));
  const path = join(directory, 'set.zip');
  const bytes = zip([['song.mid', 'score']]);
  await writeFile(path, bytes);
  const handle = await openFile(path, 'r+');
  t.after(async () => { await handle.close(); await rm(directory, { recursive: true, force: true }); });
  const source = createFileHandleSource(handle, (await handle.stat()).size);
  await handle.truncate(bytes.length - 1);
  await assert.rejects(openArchive(source, 'set.zip'), { code: 'EIO' });
  await assert.rejects(openArchive(createFileHandleSource(handle, bytes.length - 1), 'set.zip'), code('corrupt'));
});

test('archive cache reuses concurrent opens and closes displaced and idle archives after last use', async () => {
  const cache = createArchiveCache(5);
  let release, closed = [], opens = 0;
  const opened = name => async () => ({ archive: ++opens, close: () => closed.push(name) });
  const gate = new Promise(resolve => { release = resolve; });
  const held = cache.use('a', opened('a'), () => gate);
  assert.equal(await cache.use('a', opened('duplicate'), archive => archive), 1);
  assert.equal(await cache.use('b', opened('b'), archive => archive), 2);
  assert.deepEqual(closed, []);
  release();
  await held;
  assert.deepEqual(closed, ['a']);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.deepEqual(closed, ['a', 'b']);
});
