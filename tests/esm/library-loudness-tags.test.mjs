import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseFile } from 'music-metadata';
import { getReplayGain } from '../../js/library/metadata/metadata-mapper.js';
import { normalizeMtimeMs } from '../../js/library/scan/file-signature.js';
import { writeLoudnessTagsToFile } from '../../electron/loudness-tag-writer.mjs';
import tagJob from '../../electron/loudness-tag-job.cjs';
import { LibraryCatalogScanRuntime } from '../../electron/library-catalog-scan-runtime.cjs';

async function directory(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'effetune-rg-')));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  return root;
}

function flac(tagged) {
  const stream = Buffer.alloc(34);
  stream.writeUInt16BE(4096);
  stream.writeUInt16BE(4096, 2);
  stream.writeBigUInt64BE((44100n << 44n) | (1n << 41n) | (15n << 36n) | 4096n, 10);
  function block(type, data, last) {
    const header = Buffer.alloc(4);
    header[0] = type | (last ? 128 : 0);
    header.writeUIntBE(data.length, 1, 3);
    return Buffer.concat([header, data]);
  }
  const blocks = [Buffer.from('fLaC'), block(0, stream, !tagged)];
  if (tagged) {
    function size(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }
    const comments = ['TITLE=Keep me', 'replaygain_track_gain=+99 dB', 'REPLAYGAIN_ALBUM_GAIN=-50 dB'];
    const data = Buffer.concat([size(3), Buffer.from('org'), size(comments.length),
      ...comments.flatMap(text => [size(text.length), Buffer.from(text)])]);
    blocks.push(block(4, data, true));
  }
  const audio = Buffer.alloc(192, 0x32);
  return { content: Buffer.concat([...blocks, audio]), audio };
}

function mp3(tagged, version = 3) {
  const audio = Buffer.alloc(417 * 5);
  for (let offset = 0; offset < audio.length; offset += 417) audio.writeUInt32BE(0xfffb9000, offset);
  if (!tagged) return { content: audio, audio };
  function frame(id, text) {
    const value = Buffer.from(`\0${text}`);
    const header = Buffer.alloc(10);
    header.write(id);
    header.writeUInt32BE(value.length, 4);
    return Buffer.concat([header, value]);
  }
  const frames = Buffer.concat([frame('TIT2', 'Keep me'), frame('TXXX', 'replaygain_track_gain\0+99 dB'),
    frame('TXXX', 'REPLAYGAIN_ALBUM_GAIN\0-50 dB')]);
  const h = Buffer.from([73, 68, 51, version, 0, 0, 0, 0, frames.length >>> 7, frames.length & 127]);
  return { content: Buffer.concat([h, frames, audio]), audio };
}

async function measurement(filename, album = true) {
  const stat = await fs.stat(filename);
  return { trackUid: path.basename(filename), sourceKind: 'file', size: stat.size, mtimeMs: normalizeMtimeMs(stat.mtimeMs),
    integrated: -22, truePeak: -6, albumIntegrated: album ? -20 : null, albumTruePeak: album ? -3 : null };
}

for (const [ext, fixture] of [['flac', flac], ['mp3', mp3]]) {
  test(`${ext} writes and removes ReplayGain while preserving original audio and unrelated tags`, async t => {
    const root = await directory(t);
    for (const tagged of [false, true]) {
      const filename = path.join(root, `${tagged}.${ext}`);
      const { content, audio } = fixture(tagged);
      await fs.writeFile(filename, content);
      for (const album of [true, false]) {
        const track = await measurement(filename, album);
        const result = await writeLoudnessTagsToFile(filename, track);
        assert.equal(result.status, 'written');
        assert.deepEqual((await fs.readFile(filename)).subarray(-audio.length), audio);
        const meta = await parseFile(filename);
        if (tagged) assert.equal(meta.common.title, 'Keep me');
        const values = getReplayGain(meta);
        assert.equal(values.trackGainDb, 4);
        assert.equal(values.albumGainDb, album ? 2 : null);
        assert.ok(Math.abs(values.trackPeak - 10 ** (-6 / 20)) < 1e-8);
        if (album) assert.ok(Math.abs(values.albumPeak - 10 ** (-3 / 20)) < 1e-8);
        else assert.equal(values.albumPeak, null);
        const current = await measurement(filename);
        assert.deepEqual(result, { status: 'written', size: current.size, mtimeMs: current.mtimeMs });
      }
    }
  });
}

test('conflicting APEv2, unsupported ID3v2 and changed file signatures leave the original intact', async t => {
  const root = await directory(t);
  const filename = path.join(root, 'song.mp3');
  const key = Buffer.from('REPLAYGAIN_TRACK_GAIN\0');
  const data = Buffer.from('-11 dB');
  const item = Buffer.alloc(8);
  item.writeUInt32LE(data.length);
  const footer = Buffer.alloc(32);
  footer.write('APETAGEX');
  footer.writeUInt32LE(2000, 8);
  footer.writeUInt32LE(32 + item.length + key.length + data.length, 12);
  footer.writeUInt32LE(1, 16);
  for (const content of [Buffer.concat([mp3(false).content, item, key, data, footer]), mp3(true, 2).content]) {
    await fs.writeFile(filename, content);
    assert.equal((await writeLoudnessTagsToFile(filename, await measurement(filename))).status, 'unsupported');
    assert.deepEqual(await fs.readFile(filename), content);
  }
  const track = await measurement(filename);
  await fs.appendFile(filename, Buffer.from([0]));
  assert.equal((await writeLoudnessTagsToFile(filename, track)).status, 'changed');
  assert.deepEqual(await fs.readdir(root), ['song.mp3']);
});

test('MP3 absolute chapter and seek indexes retain their audio positions or skip when the tag must grow', async t => {
  const root = await directory(t);
  const filename = path.join(root, 'positions.mp3');
  const { audio } = mp3(false);
  for (const id of ['CHAP', 'ASPI']) {
    for (const padding of [0, 512]) {
      const payload = id === 'CHAP' ? Buffer.concat([Buffer.from('one\0'), Buffer.alloc(16)]) : Buffer.alloc(12);
      const header = Buffer.alloc(10);
      header.write(id);
      header.writeUInt32BE(payload.length, 4);
      const tagSize = header.length + payload.length + padding;
      const mediaStart = 10 + tagSize;
      if (id === 'CHAP') {
        payload.writeUInt32BE(1000, 8);
        payload.writeUInt32BE(mediaStart, 12);
        payload.writeUInt32BE(mediaStart + audio.length, 16);
      } else {
        payload.writeUInt32BE(mediaStart);
        payload.writeUInt32BE(audio.length, 4);
        payload.writeUInt16BE(1, 8);
        payload[10] = 8;
      }
      const tag = Buffer.from([73, 68, 51, 4, 0, 0, 0, 0, tagSize >>> 7, tagSize & 127]);
      const content = Buffer.concat([tag, header, payload, Buffer.alloc(padding), audio]);
      await fs.writeFile(filename, content);
      const result = await writeLoudnessTagsToFile(filename, await measurement(filename));
      const after = await fs.readFile(filename);
      if (padding) {
        assert.equal(result.status, 'written');
        assert.deepEqual(after.subarray(10, 20 + payload.length), content.subarray(10, 20 + payload.length));
        assert.deepEqual(after.subarray(mediaStart), audio);
      } else {
        assert.equal(result.status, 'unsupported');
        assert.deepEqual(after, content);
      }
    }
  }
});

test('tag export requires write access to the original file and respects read-only files', async t => {
  const root = await directory(t);
  const filename = path.join(root, 'restricted.flac');
  const content = flac(false).content;
  await fs.writeFile(filename, content);
  const track = await measurement(filename);
  const denied = await writeLoudnessTagsToFile(filename, track, {
    filesystem: { ...fs, async open(filePath, flags, ...rest) {
      if (flags === 'r+') throw Object.assign(new Error('Write access denied'), { code: 'EACCES' });
      return fs.open(filePath, flags, ...rest);
    } }
  });
  assert.equal(denied.status, 'unavailable');
  await fs.chmod(filename, 0o444);
  try {
    assert.equal((await writeLoudnessTagsToFile(filename, track)).status, 'unavailable');
  } finally { await fs.chmod(filename, 0o600); }
  assert.deepEqual(await fs.readFile(filename), content);
  assert.deepEqual(await fs.readdir(root), ['restricted.flac']);
});

test('tag export rechecks the verified temporary file and leaves a substituted path untouched', async t => {
  const root = await directory(t);
  const filename = path.join(root, 'song.mp3');
  const content = mp3(false).content;
  await fs.writeFile(filename, content);
  const track = await measurement(filename);
  let substituted;
  const userContent = Buffer.from('another file');
  const replaced = await writeLoudnessTagsToFile(filename, track, {
    async beforeReplace(staged) {
      assert.equal(path.extname(staged), '.tmp');
      await fs.rename(staged, path.join(root, 'moved'));
      await fs.writeFile(staged, userContent);
      substituted = staged;
    }
  });
  assert.equal(replaced.status, 'changed');
  assert.deepEqual(await fs.readFile(substituted), userContent);
  const edited = await writeLoudnessTagsToFile(filename, track, {
    beforeReplace: staged => fs.appendFile(staged, userContent)
  });
  assert.equal(edited.status, 'changed');
  assert.deepEqual(await fs.readFile(filename), content);
});

test('a replacement during verification or a busy rename leaves the current original untouched', async t => {
  const root = await directory(t);
  const filename = path.join(root, 'song.flac');
  const original = flac(false).content;
  await fs.writeFile(filename, original);
  const busy = await writeLoudnessTagsToFile(filename, await measurement(filename), {
    filesystem: { ...fs, rename: async () => { throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } }
  });
  assert.equal(busy.status, 'unavailable');
  assert.deepEqual(await fs.readFile(filename), original);
  const replacement = Buffer.from('new user file');
  const changed = await writeLoudnessTagsToFile(filename, await measurement(filename), {
    beforeReplace: async () => {
      const next = path.join(root, 'replacement');
      await fs.writeFile(next, replacement);
      await fs.rename(next, filename);
    }
  });
  assert.equal(changed.status, 'changed');
  assert.deepEqual(await fs.readFile(filename), replacement);
  assert.deepEqual(await fs.readdir(root), ['song.flac']);
});

test('tag export uses the confirmed album snapshot through rescans and updates only successful signatures at the end',
  { timeout: 15000 }, async t => {
  const root = await directory(t);
  const filenames = ['one.flac', 'two.mp3'].map(name => path.join(root, name));
  await Promise.all(filenames.map((name, i) => fs.writeFile(name, i ? mp3(false).content : flac(false).content)));
  const tracks = await Promise.all(filenames.map(name => measurement(name)));
  const revoked = path.join(root, 'revoked.flac');
  const original = flac(false).content;
  await fs.writeFile(revoked, original);
  const revokedTrack = await measurement(revoked);
  let revokeAtReplacement = false;
  let catalog = tracks;
  const updates = [];
  const job = tagJob.createLoudnessTagJob({
    readSnapshot: async () => ({ tracks: [...catalog, revokedTrack] }),
    resolveSource: async uid => {
      if (uid === revokedTrack.trackUid) {
        if (revokeAtReplacement) throw Object.assign(new Error(), { code: 'folderAccessRevoked' });
        revokeAtReplacement = true;
      }
      if (uid === tracks[1].trackUid) {
        const updated = await measurement(filenames[0]);
        assert.notEqual(updated.size, tracks[0].size);
        catalog = [updated, { ...tracks[1], albumIntegrated: null, albumTruePeak: null }];
        assert.equal(updates.length, 0);
      }
      return { path: path.join(root, uid), folderId: 'folder' };
    },
    updateSignatures: rows => updates.push(...rows),
    rescanFolder: async folder => {
      assert.equal(updates.length, 2);
      assert.equal(folder, 'folder');
      return 'completed';
    }
  });
  const preview = await job.prepare();
  assert.equal(preview.eligible, 3);
  const result = await job.write(preview);
  assert.equal(result.written, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.reasons.unavailable, 1);
  assert.deepEqual(await fs.readFile(revoked), original);
  assert.equal(result.rescanFailed, 0);
  assert.deepEqual(result.folderIds, ['folder']);
  assert.equal(updates.length, 2);
  for (const filename of filenames) assert.equal(getReplayGain(await parseFile(filename)).albumGainDb, 2);
  await assert.rejects(job.write(preview));
});

test('tag job synchronizes successful writes after a worker failure and isolates revoked folders during rescan',
  { timeout: 10000 }, async () => {
    const tracks = ['one', 'two', 'three'].map(trackUid => ({ trackUid, size: 20, mtimeMs: 30 }));
    const scans = [];
    const signatures = [];
    const options = { includeVideo: true, includeMidi: true, languageHints: { language: 'ja' } };
    let entered;
    let release;
    const scanning = new Promise(resolve => { entered = resolve; });
    const terminal = new Promise(resolve => { release = resolve; });
    let opened = 0;
    let closed = 0;
    const job = tagJob.createLoudnessTagJob({
      readSnapshot: () => ({ tracks }),
      resolveSource: uid => ({ folderId: uid, path: uid }),
      makeWriter: () => {
        opened++;
        return {
          write: async filename => {
            if (filename === 'two') throw new Error('Worker exited');
            return { status: 'written', size: 40, mtimeMs: 50 };
          },
          close: () => { closed++; }
        };
      },
      updateSignatures: rows => { signatures.push(...rows.map(row => row.trackUid)); },
      rescanFolder: async (folderId, scanOptions) => {
        scans.push([folderId, scanOptions]);
        if (folderId === 'one') throw Object.assign(new Error(), { code: 'folderAccessRevoked' });
        entered();
        return terminal;
      }
    });
    const result = job.write({ ...await job.prepare(), scanOptions: options });
    await scanning;
    try {
      assert.deepEqual(signatures, ['one', 'three']);
      assert.deepEqual(scans, [['one', options], ['three', options]]);
      assert.equal(opened, 2);
      assert.equal(closed, 2);
      await assert.rejects(job.prepare(), /already running/);
    } finally { release('completed'); }
    const counts = await result;
    assert.equal(counts.written, 2);
    assert.equal(counts.failed, 1);
    assert.equal(counts.skipped, 0);
    assert.equal(counts.rescanFailed, 1);
    assert.equal((await job.prepare()).eligible, 3);
  });

test('tag writing cannot follow a catalog path or directory link outside the granted library', async t => {
  const root = await directory(t);
  const granted = path.join(root, 'library');
  const outside = path.join(root, 'outside');
  await Promise.all([fs.mkdir(granted), fs.mkdir(outside)]);
  await fs.symlink(outside, path.join(granted, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const target = path.join(outside, 'external.mp3');
  const audio = mp3(false).content;
  await fs.writeFile(target, audio);
  const folder = { id: 'library', kind: 'electron', path: granted, lifecycleVersion: 1, status: 'ok' };
  const base = await measurement(target);
  const tracks = ['../outside/external.mp3', 'link/external.mp3'].map((relativePath, i) =>
    ({ ...base, trackUid: String(i), folderId: folder.id, relativePath, lifecycleVersion: 1 }));
  const runtime = new LibraryCatalogScanRuntime({ host: {
    on() {}, removeListener() {}, beginScanFolder() {}, listScanFolders: () => ({ folders: [folder] }),
    getTrackStorageIdentity: uid => tracks.find(row => row.trackUid === uid)
  }, dialog: { showOpenDialog() {} }, metadataParser: { parse() {} }, artworkWorkerPool: { close() {} } });
  t.after(() => runtime.close());
  runtime.issueGrant(folder, granted);
  const job = tagJob.createLoudnessTagJob({ readSnapshot: () => ({ tracks }),
    resolveSource: uid => runtime.resolvePlaybackSource(uid),
    updateSignatures: () => assert.fail('No signatures should change') });
  const result = await job.write(await job.prepare());
  assert.equal(result.skipped, 2);
  assert.deepEqual(await fs.readFile(target), audio);
  assert.deepEqual(await fs.readdir(outside), ['external.mp3']);
});
