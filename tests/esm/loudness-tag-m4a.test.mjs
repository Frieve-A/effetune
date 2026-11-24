import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseFile } from 'music-metadata';
import { getReplayGain } from '../../js/library/metadata/metadata-mapper.js';
import { writeLoudnessTagsToFile } from '../../electron/loudness-tag-writer.mjs';

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value);
  return buffer;
}

function atom(type, ...parts) {
  const content = Buffer.concat(parts);
  return Buffer.concat([uint32(8 + content.length), Buffer.from(type, 'latin1'), content]);
}

const ftyp = atom('ftyp', Buffer.from('M4A \0\0\0\0M4A isom', 'latin1'));
const media = Buffer.alloc(96, 0x44);
const title = atom('©nam', atom('data', uint32(1), uint32(0), Buffer.from('Album title')));
const art = atom('covr', atom('data', uint32(14), uint32(0), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3])));

function existingTag(key, value) {
  return atom('----', atom('mean', uint32(0), Buffer.from('com.apple.iTunes')),
    atom('name', uint32(0), Buffer.from(key)), atom('data', uint32(1), uint32(0), Buffer.from(value)));
}

function makeFile({ width, leading, metadata }) {
  const mdat = atom('mdat', media);
  function movie(base) {
    const offsets = Buffer.alloc(2 * width);
    for (const [i, position] of [0, 48].entries()) {
      if (width === 4) offsets.writeUInt32BE(base + position, i * width);
      else offsets.writeBigUInt64BE(BigInt(base + position), i * width);
    }
    const chunks = atom(width === 4 ? 'stco' : 'co64', uint32(0), uint32(2), offsets);
    const track = atom('trak', atom('mdia', atom('minf', atom('stbl', chunks))));
    return metadata ? atom('moov', track, metadata) : atom('moov', track);
  }
  const moov = movie(ftyp.length + (leading ? movie(0).length : 0) + 8);
  return Buffer.concat(leading ? [ftyp, moov, mdat] : [ftyp, mdat, moov]);
}

function readOffsets(buffer, width) {
  const table = buffer.indexOf(width === 4 ? 'stco' : 'co64', 0, 'latin1') + 12;
  return [0, 1].map(index => width === 4 ? buffer.readUInt32BE(table + index * width)
    : Number(buffer.readBigUInt64BE(table + index * width)));
}

async function fixture(t, contents) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-loudness-m4a-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  const file = path.join(directory, 'track.m4a');
  await fs.writeFile(file, contents);
  const { size, mtimeMs } = await fs.stat(file);
  return { directory, file, track: { sourceKind: 'file', size, mtimeMs: Math.round(mtimeMs), integrated: -21, truePeak: -6,
    albumIntegrated: -17, albumTruePeak: -3 } };
}

test('M4A creates freeform tags in an untagged leading moov and relocates stco chunks', async t => {
  const bytes = makeFile({ width: 4, leading: true });
  const { file, track } = await fixture(t, bytes);
  assert.equal((await writeLoudnessTagsToFile(file, track)).status, 'written');
  const tagged = await fs.readFile(file);
  const first = tagged.indexOf('mdat') + 4;
  assert.ok(first > bytes.indexOf('mdat') + 4);
  assert.deepEqual(readOffsets(tagged, 4), [first, first + 48]);
  assert.deepEqual(tagged.subarray(first), media);
  const values = getReplayGain(await parseFile(file));
  assert.equal(values.trackGainDb, 3);
  assert.ok(Math.abs(values.trackPeak - 10 ** (-6 / 20)) < .000001);
  assert.equal(values.albumGainDb, -1);
  assert.ok(Math.abs(values.albumPeak - 10 ** (-3 / 20)) < .000001);
});

test('M4A replaces only ReplayGain in trailing metadata, removes stale album tags and preserves co64 chunks', async t => {
  const ilst = atom('ilst', title, art, existingTag('replaygain_track_gain', '-7.25 dB'),
    existingTag('REPLAYGAIN_ALBUM_GAIN', '+6.00 dB'), existingTag('REPLAYGAIN_ALBUM_PEAK', '1'));
  const metadata = atom('udta', atom('meta', uint32(0),
    atom('hdlr', Buffer.alloc(8), Buffer.from('mdir'), Buffer.alloc(13)), ilst));
  const bytes = makeFile({ width: 8, leading: false, metadata });
  const { file, track } = await fixture(t, bytes);
  track.albumIntegrated = null;
  track.albumTruePeak = null;
  assert.equal((await writeLoudnessTagsToFile(file, track)).status, 'written');
  const tagged = await fs.readFile(file);
  assert.deepEqual(readOffsets(tagged, 8), readOffsets(bytes, 8));
  assert.deepEqual(tagged.subarray(0, ftyp.length + 8 + media.length), bytes.subarray(0, ftyp.length + 8 + media.length));
  assert.ok(tagged.includes(title));
  assert.ok(tagged.includes(art));
  const parsed = await parseFile(file);
  assert.equal(parsed.common.title, 'Album title');
  const values = getReplayGain(parsed);
  assert.equal(values.trackGainDb, 3);
  assert.equal(values.albumGainDb, null);
  assert.equal(values.albumPeak, null);
});

test('M4A rejects a relocated co64 entry that points at identical bytes in a different position', async t => {
  const bytes = makeFile({ width: 8, leading: true });
  const { directory, file, track } = await fixture(t, bytes);
  const result = await writeLoudnessTagsToFile(file, track, {
    async beforeVerify(temporary) {
      const candidate = await fs.readFile(temporary);
      const index = candidate.indexOf('co64') + 12;
      const old = Number(candidate.readBigUInt64BE(index));
      assert.deepEqual(candidate.subarray(old, old + 16), candidate.subarray(old + 1, old + 17));
      candidate.writeBigUInt64BE(BigInt(old + 1), index);
      await fs.writeFile(temporary, candidate);
    }
  });
  assert.equal(result.status, 'failed');
  assert.deepEqual(await fs.readFile(file), bytes);
  assert.deepEqual(await fs.readdir(directory), ['track.m4a']);
});

test('fragmented M4A and multiple media data atoms are skipped intact', async t => {
  for (const extra of [atom('moof'), atom('mdat', media)]) {
    const bytes = Buffer.concat([makeFile({ width: 4, leading: true }), extra]);
    const { file, track } = await fixture(t, bytes);
    assert.equal((await writeLoudnessTagsToFile(file, track)).status, 'unsupported');
    assert.deepEqual(await fs.readFile(file), bytes);
  }
});
