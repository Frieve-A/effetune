import assert from 'node:assert/strict';
import test from 'node:test';

import { UIManager } from '../../js/ui-manager.js';
import { getDiagnosticLog, rememberDiagnosticNames, startDiagnosticRecording } from '../../js/diagnostics/diagnostic-log.js';
import { findArchiveCoverEntry, findArchiveWrdEntry } from '../../js/library/archive/score-entries.js';
import { expandArchivePlaybackSelection } from '../../js/ui/audio-player/archive-playback-selection.js';
import { attachArtworkFiles, getArtworkFiles, getLyricsFiles } from '../../js/ui/audio-player/lyrics-file-links.js';
import { MAX_MATERIALIZED_SEQUENCE_ITEMS } from '../../js/ui/audio-player/playback-sequence.js';
import { resolveWebPlaybackSelection } from '../../js/ui/playback-selection-router.js';
import { zip } from '../helpers/archive-fixtures.mjs';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

function createManager({ resumeResult = true } = {}) {
  const calls = [];
  const player = {
    ui: {
      container: null,
      createPlayerUI() {
        calls.push(['createPlayerUI']);
        this.container = {};
      }
    },
    playbackManager: {
      loadFiles(tracks, append) {
        calls.push(['playbackManager.loadFiles', tracks, append]);
      }
    },
    stateManager: { getCurrentTrackIndex: () => 0 },
    async stop() { calls.push(['stop']); },
    async loadTrack(index) { calls.push(['loadTrack', index]); return true; },
    async loadFiles(tracks, append) { calls.push(['loadFiles', tracks, append]); return true; },
    resumeAudioContextInGesture() {
      calls.push(['resumeAudioContextInGesture']);
      return Promise.resolve(resumeResult);
    }
  };
  const manager = Object.assign(Object.create(UIManager.prototype), {
    audioPlayer: player,
    audioManager: {},
    playbackSelectionGeneration: 0,
    playbackSelectionAbortController: null,
    mobileNav: { setView: view => calls.push(['setView', view]) },
    createAudioPlayer(files, replace) {
      calls.push(['createAudioPlayer', files, replace]);
      return player;
    },
    setError(key, translated) {
      calls.push(['setError', key, translated]);
    }
  });
  return { calls, manager, player };
}

test('Web Open Music begins power-aware resume synchronously before async admission', async () => {
  const { calls, manager } = createManager();

  const resume = manager.beginPlaybackSelectionGestureResume();

  assert.deepEqual(calls, [['resumeAudioContextInGesture']]);
  assert.equal(await resume, true);
});

test('Web Open Music leaves the queue unchanged during admission and commits paused after resume failure', async () => {
  const { calls, manager } = createManager({ resumeResult: false });
  let resolveSelection;
  manager.playbackSelectionResolver = () => new Promise(resolve => { resolveSelection = resolve; });
  const tracks = [{ file: { name: 'album.wav' }, startFrame: 0, endFrame: null }];

  const operation = manager.openWebPlaybackSelection([{ name: 'album.cue' }], Promise.resolve(false));
  await flushMicrotasks();
  assert.equal(calls.some(call => call[0] === 'createAudioPlayer'), false);

  resolveSelection({ kind: 'cue', tracks });
  assert.equal(await operation, true);
  assert.deepEqual(calls, [
    ['createAudioPlayer', [], false],
    ['stop'],
    ['playbackManager.loadFiles', tracks, false],
    ['createPlayerUI'],
    ['loadTrack', 0],
    ['setView', 'player']
  ]);
});

test('Web Open Music rejects atomically without creating or replacing a player', async () => {
  const { calls, manager } = createManager();
  manager.playbackSelectionResolver = async () => {
    const error = new Error('invalid');
    error.code = 'cueSelectionInvalid';
    throw error;
  };

  assert.equal(await manager.openWebPlaybackSelection([{ name: 'album.cue' }], Promise.resolve(true)), false);
  assert.equal(calls.some(call => call[0] === 'createAudioPlayer'), false);
  assert.deepEqual(calls.at(-1), ['setError', 'error.cueSelectionInvalid', true]);
});

test('Web Open Music explains when CUE sibling access is unavailable', async () => {
  const { calls, manager } = createManager();
  manager.playbackSelectionResolver = async () => {
    const error = new Error('source access required');
    error.code = 'cueSelectionSourceAccessRequired';
    error.diagnosticCode = 'cue-not-in-registered-folder';
    throw error;
  };

  assert.equal(await manager.openWebPlaybackSelection([{ name: 'album.cue' }], Promise.resolve(true)), false);
  assert.deepEqual(calls.at(-1), ['setError', 'error.cueSelectionSourceAccessRequired', true]);
});

test('Web Open Music expands an archive and uses artwork and lyrics alongside each track', async () => {
  const { calls, manager } = createManager();
  manager.playbackSelectionResolver = async tracks => ({ kind: 'normal', tracks });
  const archive = new File([zip([
    ['album/Song.mid', 'song'],
    ['album/SONG.WRD', 'lyrics'],
    ['album/cover.jpg', 'inner'],
    ['cover.jpg', 'other folder']
  ])], 'collection.zip');
  const cover = new File(['outer'], 'cover.jpg');
  const wrd = new File(['outer'], 'Song.wrd');

  assert.equal(await manager.openWebPlaybackSelection([archive, cover, wrd], true), true);
  const [song] = calls.find(([method]) => method === 'loadFiles')[1];
  assert.equal(song.name, 'Song.mid');
  assert.equal(await song.text(), 'song');
  assert.equal(await getArtworkFiles(song)[0].text(), 'inner');
  assert.equal(await getLyricsFiles(song)[0].text(), 'lyrics');
});

test('desktop Open Music expands an admitted archive descriptor only for local playback', async () => {
  const { calls, manager, player } = createManager();
  const bytes = zip([['album/Song.kar', 'karaoke']]);
  const descriptor = { path: 'D:\\Music\\collection.zip', name: 'collection.zip', byteLength: bytes.length };
  const openFiles = files => UIManager.prototype.createAudioPlayer.call(manager, files);

  await withGlobals({ window: { electronAPI: { async readFileBytes(path, size) {
    calls.push(['readFileBytes', path, size]);
    return bytes;
  } } } }, async () => {
    assert.equal(await openFiles([descriptor]), player);
    assert.deepEqual(calls[0], ['readFileBytes', descriptor.path, descriptor.byteLength]);
    const [song] = calls[1][1];
    assert.equal(song.name, 'Song.kar');
    assert.equal(await song.text(), 'karaoke');

    manager.networkMusic = { selectedPlayerId: 'remote', async playFiles(files) { calls.push(['playFiles', files]); } };
    assert.equal(await openFiles([descriptor]), player);
    assert.deepEqual(calls.slice(2), [['playFiles', [descriptor]]]);
  });
});

test('startup archive admission changes input mixing only immediately before playback loads', async () => {
  const { calls, manager, player } = createManager();
  const archive = new File([zip([['One.mid', 'one'], ['Two.kar', 'two']])], 'Startup.zip');
  let cancel = true;
  let inputMixing = true;
  manager.expandArchivePlaybackFiles = (files, signal, rememberArchiveNames) => expandArchivePlaybackSelection(files, {
    chooseEntries(choices) {
      assert.equal(inputMixing, true);
      return cancel ? [] : choices;
    },
    reportError: key => assert.fail(key),
    rememberArchiveNames,
    signal
  });
  const startPlayback = () => UIManager.prototype.createAudioPlayer.call(manager, [archive], false, {
    beforeLoad() { inputMixing = false; }
  });
  assert.equal(await startPlayback(), player);
  assert.equal(inputMixing, true);
  assert.deepEqual(calls, []);

  cancel = false;
  player.loadFiles = async files => {
    calls.push(['load', files.map(file => file.name), inputMixing]);
    return false;
  };
  assert.equal(await startPlayback(), player);
  assert.deepEqual(calls, [['load', ['One.mid', 'Two.kar'], false]]);
});

test('direct archive selection filters score entries and keeps their archive positions', async () => {
  const first = new File(['one'], 'first.wav');
  const last = new File(['two'], 'last.flac');
  const archive = new File([zip([
    ['z/Song.mxl', 'score'],
    ['A.mid', 'midi'],
    ['__MACOSX/metadata.mid', 'metadata'],
    ['._A.mid', 'metadata'],
    ['another.zip', 'nested archive'],
    ['music.wav', 'audio']
  ])], 'collection.zip');
  const secondArchive = new File([zip([['Scores/Third.musicxml', 'third']])], 'second.zip');
  const cover = new File(['outer'], 'folder.jpg');
  attachArtworkFiles([archive], [cover]);
  const result = await expandArchivePlaybackSelection([first, archive, last, secondArchive], {
    chooseEntries: (choices, { archiveCount }) => {
      assert.equal(archiveCount, 2);
      assert.deepEqual(choices.map(({ archiveName, path }) => [archiveName, path]), [
        ['collection.zip', 'A.mid'], ['collection.zip', 'z/Song.mxl'], ['second.zip', 'Scores/Third.musicxml']
      ]);
      return choices;
    },
    reportError: key => assert.fail(key)
  });
  assert.deepEqual(result.map(file => file.name), ['first.wav', 'A.mid', 'Song.mxl', 'last.flac', 'Third.musicxml']);
  assert.equal(result[0], first);
  assert.equal(result[3], last);
  assert.equal(getArtworkFiles(result[1])[0], cover);
});

test('direct archive selection distinguishes no scores, cancellation and excessive combined size', async () => {
  const errors = [];
  const reportError = key => errors.push(key);
  const empty = new File([zip([['audio.wav', 'ignored']])], 'empty.zip');
  const ordinaryFile = new File(['regular'], 'free.wav');
  assert.deepEqual(await expandArchivePlaybackSelection([ordinaryFile, empty], { reportError }), []);
  assert.deepEqual(errors, ['midi.archive.noPlayableFiles']);

  const multi = new File([zip([['a.mid', 'one'], ['b.kar', 'two']])], 'multi.zip');
  assert.deepEqual(await expandArchivePlaybackSelection([multi], { chooseEntries: () => [], reportError }), []);
  assert.equal(errors.length, 1);

  const large = new File([zip([['a.mid', Buffer.alloc(31 * 1024 * 1024)]])], 'large.zip');
  assert.deepEqual(await expandArchivePlaybackSelection(Array(9).fill(large), {
    chooseEntries: choices => choices,
    reportError
  }), []);
  assert.deepEqual(errors, ['midi.archive.noPlayableFiles', 'midi.archive.tooLarge']);
});

test('direct archive selection charges shared artwork once and rejects combined companion data beyond the byte limit', async () => {
  const bytes = zip([
    ['Set/One.mid', 'one'], ['Set/Two.mid', 'two'], ['Set/cover.jpg', Buffer.alloc(20 * 1024 * 1024)]
  ]);
  const archive = new File([bytes], 'First.zip');
  const chosen = await expandArchivePlaybackSelection([archive], {
    chooseEntries: choices => choices,
    reportError: key => assert.fail(key)
  });
  assert.equal(getArtworkFiles(chosen[0])[0], getArtworkFiles(chosen[1])[0]);

  const errors = [];
  const archives = Array.from({ length: 13 }, (_, index) => new File([bytes], `Set ${index}.zip`));
  assert.deepEqual(await expandArchivePlaybackSelection(archives, {
    chooseEntries: choices => choices,
    reportError: key => errors.push(key)
  }), []);
  assert.deepEqual(errors, ['midi.archive.tooLarge']);
});

test('archive companion lookups read the archive listing once for thousands of scores in one directory', () => {
  const cover = { path: 'Set/cover.jpg', size: 2, supported: true };
  const words = Array.from({ length: 2500 }, (_, index) => ({ path: `Set/Song ${index}.WRD`, size: 4, supported: true }));
  const entries = [cover, { path: 'Set/COVER.JPG', size: 5, supported: true },
    ...words.flatMap((wrd, index) => [wrd, { path: `Set/Song ${index}.mid`, size: 8, supported: true }])];
  let entryReads = 0;
  const archive = { entries: new Proxy(entries, {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/.test(key)) entryReads++;
      return Reflect.get(target, key, receiver);
    }
  }) };
  for (const [index, wrd] of words.entries()) {
    const path = `Set/SONG ${index}.mid`;
    assert.equal(findArchiveCoverEntry(archive, path), cover);
    assert.equal(findArchiveWrdEntry(archive, path), wrd);
  }
  assert.equal(entryReads, entries.length);
});

test('archive filenames remain redacted through Web rejection and delayed drop playback', async t => {
  const privatePath = 'Folder/Selected Private Melody.mid';
  const privateName = privatePath.split('/').at(-1);
  const unrelatedNames = Array.from({ length: 220 }, (_, index) => `Recent Name ${index}.wav`);
  const archive = new File([zip([
    [privatePath, 'midi'],
    ...Array.from({ length: 110 }, (_, index) => [`Unused/Other track ${index}.mid`, 'midi'])
  ])], 'Selected.zip');
  const configureArchivePicker = manager => {
    manager.expandArchivePlaybackFiles = (files, signal, rememberArchiveNames) => expandArchivePlaybackSelection(files, {
      chooseEntries: choices => choices.filter(choice => choice.path === privatePath),
      reportError: key => assert.fail(key),
      rememberArchiveNames,
      signal
    });
  };
  t.after(startDiagnosticRecording({ console }));

  const web = createManager();
  configureArchivePicker(web.manager);
  web.manager.playbackSelectionResolver = (files, options) => {
    rememberDiagnosticNames('track', unrelatedNames);
    return resolveWebPlaybackSelection(files, options);
  };
  const album = new File(['FILE "Album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00\n'], 'Album.cue');
  assert.equal(await web.manager.openWebPlaybackSelection([archive, album, new File(['audio'], 'Album.wav')], true), false);
  assert.deepEqual(web.calls, [['setError', 'error.cueSelectionMixed', true]]);

  const drop = createManager();
  configureArchivePicker(drop.manager);
  let finishDrop;
  drop.player.loadFiles = ([file]) => new Promise(resolve => {
    finishDrop = () => {
      rememberDiagnosticNames('track', unrelatedNames);
      console.warn('Drop load diagnostic:', file.name);
      resolve(true);
    };
  });
  await UIManager.prototype.createAudioPlayer.call(drop.manager, [archive]);
  finishDrop();
  await flushMicrotasks();

  const log = getDiagnosticLog().console;
  for (const label of ['Open Music selection diagnostic:', 'Drop load diagnostic:']) {
    const diagnostic = log.find(({ args }) => args[0] === label);
    assert.ok(diagnostic);
    assert.match(diagnostic.args[1], /<track>/);
    assert.ok(!diagnostic.args[1].includes(privateName));
  }
});

test('archive admission rejects the combined queue count before touching the current player', async () => {
  const archive = new File([zip([['Set/One.mid', 'one']])], 'Scores.zip');
  const ordinary = new File(['data'], 'Ordinary.wav');
  const inputs = [archive, ...Array(MAX_MATERIALIZED_SEQUENCE_ITEMS).fill(ordinary)];
  for (const web of [true, false]) {
    const { calls, manager, player } = createManager();
    const result = web
      ? await manager.openWebPlaybackSelection(inputs, true)
      : await UIManager.prototype.createAudioPlayer.call(manager, inputs);
    assert.equal(result, web ? false : player);
    assert.deepEqual(calls, [['setError', 'midi.archive.tooManyFiles', true]]);
  }
});

test('a newer plain drop supersedes pending Web archive admission through queue publication', async () => {
  for (const pending of ['expansion', 'player']) {
    const { calls, manager, player } = createManager();
    let continueAdmission;
    let reached;
    const waiting = new Promise(resolve => { reached = resolve; });
    const hold = value => new Promise(resolve => {
      continueAdmission = () => resolve(value);
      reached();
    });
    const olderTrack = new File(['midi'], 'Older.mid');
    const newerTrack = new File(['audio'], 'Newer.wav');
    if (pending === 'expansion') manager.expandArchivePlaybackFiles = () => hold([olderTrack]);
    else manager.createAudioPlayer = () => hold(player);
    manager.playbackSelectionResolver = async tracks => ({ kind: 'normal', tracks });
    const archive = new File([zip([['Older.mid', 'midi']])], 'Older.zip');
    const opening = manager.openWebPlaybackSelection([archive], true);
    await waiting;
    assert.equal(await UIManager.prototype.createAudioPlayer.call(manager, [newerTrack]), player);
    continueAdmission();
    assert.equal(await opening, false);
    assert.deepEqual(calls, [['loadFiles', [newerTrack], false]]);
  }
});
