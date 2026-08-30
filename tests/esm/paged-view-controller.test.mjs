import assert from 'node:assert/strict';
import test from 'node:test';

import { PagedViewController } from '../../js/ui/library/paged-view-controller.js';

function createTimerHarness() {
  let callback = null;
  let delay = null;
  let now = 0;
  return {
    clearTimeoutFn() {
      callback = null;
      delay = null;
    },
    fire() {
      const scheduled = callback;
      callback = null;
      delay = null;
      scheduled?.();
    },
    get delay() {
      return delay;
    },
    monotonicNow() {
      return now;
    },
    setNow(value) {
      now = value;
    },
    setTimeoutFn(nextCallback, nextDelay) {
      callback = nextCallback;
      delay = nextDelay;
      return 1;
    }
  };
}

test('first library page may load longer than the inactivity timeout while making progress', async () => {
  const timer = createTimerHarness();
  let reportProgress;
  let resolvePage;
  const controller = new PagedViewController({
    inactivityTimeoutMs: 100,
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
    monotonicNow: timer.monotonicNow,
    loadFirstPage(identity) {
      reportProgress = identity.reportProgress;
      return new Promise(resolve => {
        resolvePage = resolve;
      });
    }
  });

  const resultPromise = controller.start({ endpoint: 'entities', entityType: 'album' });
  await Promise.resolve();
  assert.equal(timer.delay, 100);

  timer.setNow(90);
  reportProgress();
  timer.setNow(100);
  timer.fire();
  assert.equal(timer.delay, 90);

  timer.setNow(180);
  resolvePage({ rows: [{ albumKey: 'album-1' }], totalCount: 1 });
  const result = await resultPromise;

  assert.equal(result.terminal, 'committed');
  assert.equal(controller.state.phase, 'committed');
});

test('first library page times out after continuous inactivity', async () => {
  const timer = createTimerHarness();
  const controller = new PagedViewController({
    inactivityTimeoutMs: 100,
    setTimeoutFn: timer.setTimeoutFn,
    clearTimeoutFn: timer.clearTimeoutFn,
    monotonicNow: timer.monotonicNow,
    loadFirstPage: () => new Promise(() => {})
  });

  const resultPromise = controller.start({ endpoint: 'tracks' });
  await Promise.resolve();
  timer.setNow(100);
  timer.fire();
  const result = await resultPromise;

  assert.equal(result.terminal, 'timedOut');
  assert.equal(controller.state.phase, 'timedOut');
  assert.match(controller.state.error.message, /stopped responding/);
});
