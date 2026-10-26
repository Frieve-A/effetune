import assert from 'node:assert/strict';
import test from 'node:test';
import { TrackLyrics } from '../../js/ui/audio-player/track-lyrics.js';
import { attachLyricsFiles } from '../../js/ui/audio-player/lyrics-file-links.js';
import { TEXT_FILE_MAX_BYTES } from '../../js/library/metadata/text-encoding.js';
import { createConsoleHarness, flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('lyrics cache starts one request per selected track and ignores stale completions', async () => {
  const lyrics = new TrackLyrics({});
  const pending = new Map();
  lyrics.load = track => {
    const operation = deferred();
    pending.set(track, operation);
    return operation.promise;
  };
  const first = {}, second = {};
  assert.equal(lyrics.get(first), null);
  const firstLoad = pending.get(first);
  assert.equal(lyrics.get(first), null);
  assert.equal(pending.get(first), firstLoad);
  assert.equal(lyrics.get(second), null);
  firstLoad.resolve({ lines: [{ text: 'Old track' }] });
  await flushMicrotasks();
  assert.equal(lyrics.get(second), null);
  const current = { lines: [{ text: 'Current track' }] };
  pending.get(second).resolve(current);
  await flushMicrotasks();
  assert.equal(lyrics.get(second), current);
  assert.equal(lyrics.get(null), null);
  assert.equal(pending.size, 2);
});

test('lyrics load failures leave an empty display and changing tracks allows another load', async () => {
  const diagnostics = [];
  await withGlobals({ console: createConsoleHarness({ debug: (...args) => diagnostics.push(args) }) }, async () => {
    const lyrics = new TrackLyrics({});
    lyrics.load = async () => { throw new Error('Unavailable file'); };
    const track = {};
    lyrics.get(track);
    await flushMicrotasks();
    assert.equal(lyrics.get(track), null);
    assert.equal(diagnostics.length, 1);
    lyrics.get(null);
    lyrics.load = async () => ({ lines: [{ text: 'Loaded' }] });
    lyrics.get(track);
    await flushMicrotasks();
    assert.deepEqual(lyrics.get(track), { lines: [{ text: 'Loaded' }] });
  });
});

test('desktop lyrics resolve dropped file paths and send CUE names and physical region to the bridge', async () => {
  const requests = [];
  const audio = new File([], 'Album.flac');
  const expected = { synced: true, lines: [{ time: 0, text: 'Start' }] };
  await withGlobals({ window: { electronAPI: {
    getPathForFile(file) { assert.equal(file, audio); return '/music/Album.flac'; },
    async readTrackLyrics(request) { requests.push(request); return expected; }
  } } }, async () => {
    const track = { file: audio, startFrame: 750, endFrame: 1500, durationSec: 10, meta: { title: 'Song', artist: 'Artist' } };
    assert.equal(await new TrackLyrics({}).load({ presentationTrack: track }), expected);
    assert.deepEqual(requests, [{ path: '/music/Album.flac', names: ['Artist - Song', 'Song', 'Album'], region: { start: 10, end: 20 } }]);
  });
});

test('dropped Web lyrics prefer the matching sidecar and do not borrow unrelated files', async () => {
  await withGlobals({ window: {} }, async () => {
    const file = new File([], 'Song.flac');
    attachLyricsFiles([file], [new File(['[00:02]Sidecar'], 'SONG.LRC')]);
    const lyrics = new TrackLyrics({});
    lyrics.embedded = async () => ({ synced: true, lines: [{ time: 1, text: 'Embedded' }] });
    assert.deepEqual(await lyrics.load({ file }), { synced: true, lines: [{ time: 2, text: 'Sidecar' }] });
    const other = { file: new File([], 'Other.flac') };
    assert.deepEqual(await lyrics.load(other), { synced: true, lines: [{ time: 1, text: 'Embedded' }] });
    assert.equal(await lyrics.load({}), null);
  });
});

test('library lyrics resolve sidecars on demand and reject oversized files before reading bytes', async () => {
  const requests = [];
  let read = false;
  const lyrics = new TrackLyrics({ libraryOperationService: {
    async resolveTrackSiblingFile(request) {
      requests.push(request);
      return { index: 0, file: { size: TEXT_FILE_MAX_BYTES + 1, arrayBuffer() { read = true; throw new Error('Too large'); } } };
    }
  } });
  assert.equal(await lyrics.sidecar({ libraryTrackId: 'track-1' }, ['Song']), null);
  assert.deepEqual(requests, [{ trackUid: 'track-1', names: ['Song'] }]);
  assert.equal(read, false);
});

test('Web lyrics preserve whichever source succeeds when embedded or sidecar loading fails', async () => {
  await withGlobals({ window: {}, console: createConsoleHarness({ debug() {} }) }, async () => {
    const data = { synced: true, lines: [{ time: 1, text: 'Available' }] };
    for (const failing of ['embedded', 'sidecar']) {
      const lyrics = new TrackLyrics({});
      lyrics.embedded = async () => data;
      lyrics.sidecar = async () => ({ data, index: 0 });
      lyrics[failing] = async () => { throw new Error('Unavailable source'); };
      assert.deepEqual(await lyrics.load({ file: new File([], 'song.flac') }), data);
    }
  });
});

test('CUE album sidecars are rebased while per-track lyrics retain their own timestamps', async () => {
  await withGlobals({ window: {} }, async () => {
    const lyrics = new TrackLyrics({});
    lyrics.embedded = async () => null;
    for (const perTrack of [false, true]) {
      const file = new File([], 'Album.flac');
      const sidecar = new File([perTrack ? '[00:01]Song' : '[00:09]Before\n[00:10]Song\n[00:20]After'], perTrack ? 'Song.lrc' : 'Album.lrc');
      attachLyricsFiles([file], [sidecar]);
      assert.deepEqual(await lyrics.load({
        file, startFrame: 750, endFrame: 1500, durationSec: 10, meta: { title: 'Song' }
      }), { synced: true, lines: [{ time: perTrack ? 1 : 0, text: 'Song' }] });
    }
  });
});
