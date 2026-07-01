import assert from 'node:assert/strict';
import test from 'node:test';

import {
  startRendererWatchdogHeartbeat,
  stopRendererWatchdogHeartbeat
} from '../../js/electron-watchdog.js';
import { flushMicrotasks, withGlobals } from '../helpers/global-test-utils.mjs';

async function withWatchdogGlobals(electronAPI, callback) {
  const intervals = [];
  const cleared = [];

  await withGlobals({
    window: { electronAPI },
    setInterval: (fn, delay) => {
      const id = { fn, delay };
      intervals.push(id);
      return id;
    },
    clearInterval: id => cleared.push(id)
  }, async () => {
    stopRendererWatchdogHeartbeat();
    try {
      await callback({ intervals, cleared });
    } finally {
      stopRendererWatchdogHeartbeat();
    }
  });
}

test('startRendererWatchdogHeartbeat is a no-op without rendererPing', async () => {
  await withWatchdogGlobals({}, async ({ intervals, cleared }) => {
    startRendererWatchdogHeartbeat('missing-ping');
    assert.deepEqual(intervals, []);
    assert.deepEqual(cleared, []);
  });
});

test('startRendererWatchdogHeartbeat arms watchdog, pings after arming, and starts one interval', async () => {
  const calls = [];
  const electronAPI = {
    rendererPing: () => calls.push(['ping']),
    armRendererWatchdog: reason => {
      calls.push(['arm', reason]);
      return Promise.resolve();
    }
  };

  await withWatchdogGlobals(electronAPI, async ({ intervals, cleared }) => {
    startRendererWatchdogHeartbeat('renderer-page');
    startRendererWatchdogHeartbeat('ignored-second-start');
    await flushMicrotasks();

    assert.deepEqual(calls, [['arm', 'renderer-page'], ['ping']]);
    assert.equal(intervals.length, 1);
    assert.equal(intervals[0].delay, 2000);

    intervals[0].fn();
    assert.deepEqual(calls, [['arm', 'renderer-page'], ['ping'], ['ping']]);

    stopRendererWatchdogHeartbeat();
    stopRendererWatchdogHeartbeat();
    assert.deepEqual(cleared, [intervals[0]]);
  });
});

test('startRendererWatchdogHeartbeat pings immediately when arm hook is absent', async () => {
  const calls = [];
  const electronAPI = {
    rendererPing: () => calls.push(['ping'])
  };

  await withWatchdogGlobals(electronAPI, async ({ intervals }) => {
    startRendererWatchdogHeartbeat();
    assert.deepEqual(calls, [['ping']]);
    assert.equal(intervals.length, 1);
  });
});

test('renderer watchdog ping failures are swallowed', async () => {
  const electronAPI = {
    rendererPing: () => {
      throw new Error('renderer gone');
    }
  };

  await withWatchdogGlobals(electronAPI, async ({ intervals }) => {
    assert.doesNotThrow(() => startRendererWatchdogHeartbeat());
    assert.equal(intervals.length, 1);
    assert.doesNotThrow(() => intervals[0].fn());
  });
});
