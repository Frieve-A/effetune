import assert from 'node:assert/strict';
import test from 'node:test';

import { UIManager } from '../../js/ui-manager.js';
import { flushMicrotasks } from '../helpers/global-test-utils.mjs';

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
