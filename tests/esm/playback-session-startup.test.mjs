import assert from 'node:assert/strict';
import test from 'node:test';
import { UIManager } from '../../js/ui-manager.js';
import {
  readPlaybackSessionMarker, writePlaybackSessionMarker
} from '../../js/ui/audio-player/playback-session-marker.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function webWindow() {
  const values = new Map();
  return { localStorage: {
    getItem: key => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  } };
}

test('startup leaves the library lazy without a marker and after a stale marker is cleared', async () => {
  await withGlobals({ window: webWindow() }, async () => {
    const ui = Object.create(UIManager.prototype);
    const calls = [];
    ui.getPlaybackSessionStore = () => ({
      async load() { calls.push('read'); return null; },
      async remove(options) {
        assert.equal(options.onlyIfUnscheduled, true);
        assert.equal(options.markerOnly, true);
        assert.equal(options.isCurrent(), true);
        calls.push('remove');
        await writePlaybackSessionMarker(false);
        return true;
      }
    });
    await ui.restorePlaybackSession();
    assert.deepEqual(calls, []);
    await writePlaybackSessionMarker(true);
    await ui.restorePlaybackSession();
    await ui.restorePlaybackSession();
    assert.deepEqual(calls, ['read', 'remove']);
  });
});

test('unavailable catalog retains the marker, and empty restores notify only after deletion', async () => {
  await withGlobals({ window: webWindow() }, async () => {
    const ui = Object.create(UIManager.prototype);
    const messages = [];
    let session;
    ui.getPlaybackSessionStore = () => ({
      load: () => session,
      async remove(options) {
        assert.equal(options.markerOnly, false);
        await writePlaybackSessionMarker(false);
        return true;
      }
    });
    ui.showTransientMessage = key => messages.push(key);
    await writePlaybackSessionMarker(true);
    await ui.restorePlaybackSession();
    assert.equal(await readPlaybackSessionMarker(), true);
    assert.deepEqual(messages, []);
    session = { count: 0, itemCount: 2 };
    await ui.restorePlaybackSession();
    await ui.restorePlaybackSession();
    assert.deepEqual(messages, ['status.playbackSessionNotRestored']);
  });
});

test('startup reuses the empty receiver and rechecks invalidation after its player state loads', async () => {
  await withGlobals({ window: webWindow() }, async () => {
    await writePlaybackSessionMarker(true);
    for (const superseded of [false, true]) {
      const ui = Object.create(UIManager.prototype);
      const calls = [];
      const session = { count: 2, itemCount: 3 };
      ui.audioPlayer = {
        get stateRestored() {
          return Promise.resolve().then(() => {
            if (superseded) ui.invalidatePlaybackSessionRestore();
          });
        },
        playbackManager: {
          sequence: { itemCount: 0 },
          installPlaybackSession(value) { assert.equal(value, session); calls.push('install'); }
        },
        ui: { createPlayerUI: () => calls.push('show') }
      };
      ui.getPlaybackSessionStore = () => ({ load: () => session });
      ui.showTransientMessage = (key, _, { count }) => calls.push(key, count);
      await ui.restorePlaybackSession();
      assert.deepEqual(calls, superseded ? [] : ['install', 'show', 'status.playbackSessionPartiallyRestored', 1]);
    }
  });
});
