import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import { AutomationScheduler, evaluateClockSource } from '../../js/midi/automation-scheduler.js';

function fakeTimer() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    callbacks,
    setTimeoutFn(callback, delay) {
      const id = nextId++;
      callbacks.set(id, { callback, delay });
      return id;
    },
    clearTimeoutFn(id) { callbacks.delete(id); },
    runOnly() {
      assert.equal(callbacks.size, 1, 'scheduler must own one timer handle');
      const [[id, entry]] = callbacks;
      callbacks.delete(id);
      entry.callback();
      return entry.delay;
    }
  };
}

test('clock evaluation reads civil time for all components and shapes', () => {
  const date = new Date(2026, 0, 1, 6, 30, 15, 500);
  assert.equal(evaluateClockSource({ component: 'hour', shape: 'ramp' }, date),
    (6 + 30 / 60 + 15 / 3600 + 500 / 3600000) / 24);
  assert.ok(Math.abs(evaluateClockSource({ component: 'minute', shape: 'sin' }, date) -
    ((Math.sin(2 * Math.PI * ((30 + 15 / 60 + 500 / 60000) / 60)) + 1) / 2)) < 1e-12);
  assert.ok(Math.abs(evaluateClockSource({ component: 'second', shape: 'cos' }, date) -
    ((Math.cos(2 * Math.PI * ((15 + 0.5) / 60)) + 1) / 2)) < 1e-12);
});

test('scheduler dispatches an initial clock sample and re-reads time on later ticks', () => {
  let now = 0;
  let date = new Date(2026, 0, 1, 1, 0, 0, 0);
  const timer = fakeTimer();
  const events = [];
  const scheduler = new AutomationScheduler({
    engine: { onAutomationEvent: (...event) => events.push(event) },
    nowMonotonic: () => now,
    nowDate: () => date,
    ...timer
  });
  scheduler.sync([{ id: 'clock', source: { kind: 'clock', component: 'hour', shape: 'ramp' } }]);
  assert.equal(timer.runOnly(), 0);
  assert.equal(events[0][0], 'clock');
  assert.equal(events[0][1].value, 1 / 24);
  now = 1000;
  date = new Date(2026, 0, 1, 23, 0, 0, 0);
  assert.equal(timer.runOnly(), 1000);
  assert.equal(events[1][1].value, 23 / 24);
  scheduler.dispose();
});

test('timer starts after its interval, avoids catch-up bursts, and reanchors after delay', () => {
  let now = 0;
  const timer = fakeTimer();
  const events = [];
  const scheduler = new AutomationScheduler({
    engine: { onAutomationEvent: (...event) => events.push(event) },
    nowMonotonic: () => now,
    ...timer
  });
  scheduler.sync([{ id: 'timer', source: { kind: 'timer', intervalMs: 1000 } }]);
  assert.equal(timer.callbacks.size, 1);
  assert.equal([...timer.callbacks.values()][0].delay, 1000);
  now = 1000;
  timer.runOnly();
  assert.equal(events.length, 1);
  now = 3500;
  timer.runOnly();
  assert.equal(events.length, 2, 'a delayed callback must emit once only');
  assert.equal([...timer.callbacks.values()][0].delay, 1000, 'deadline reanchors at delivery time');
  scheduler.sync([]);
  assert.equal(timer.callbacks.size, 0);
  scheduler.dispose();
});

test('scheduler shares one timer between mappings and dispose prevents future callbacks', () => {
  let now = 0;
  const timer = fakeTimer();
  const events = [];
  const scheduler = new AutomationScheduler({
    engine: { onAutomationEvent: (...event) => events.push(event) },
    nowMonotonic: () => now,
    ...timer
  });
  scheduler.sync([
    { id: 'first', source: { kind: 'timer', intervalMs: 1000 } },
    { id: 'second', source: { kind: 'timer', intervalMs: 2000 } }
  ]);
  assert.equal(timer.callbacks.size, 1);
  now = 1000;
  timer.runOnly();
  assert.deepEqual(events.map(([id]) => id), ['first']);
  const stale = [...timer.callbacks.values()][0].callback;
  scheduler.dispose();
  stale();
  assert.deepEqual(events.map(([id]) => id), ['first']);
});

test('scheduler preserves an interval deadline across non-schedule mapping edits', () => {
  let now = 0;
  const timer = fakeTimer();
  const scheduler = new AutomationScheduler({ engine: {}, nowMonotonic: () => now, ...timer });
  const original = { id: 'timer', source: { kind: 'timer', schedule: 'interval', intervalMs: 1000 } };
  scheduler.sync([original]);
  now = 400;
  scheduler.sync([{ ...original, target: { param: 'changed' }, map: { amount: 2 } }]);
  assert.equal([...timer.callbacks.values()][0].delay, 600);
  scheduler.sync([{ ...original, source: { kind: 'timer', schedule: 'interval', intervalMs: 2000 } }]);
  assert.equal([...timer.callbacks.values()][0].delay, 2000);
  scheduler.dispose();
});

test('scheduler never forwards an over-limit interval delay to setTimeout', () => {
  let now = 0;
  const timer = fakeTimer();
  const scheduler = new AutomationScheduler({ engine: {}, nowMonotonic: () => now, ...timer });
  scheduler.sync([{ id: 'invalid', source: { kind: 'timer', schedule: 'interval', intervalMs: 2_147_483_648 } }]);
  assert.equal(timer.callbacks.size, 0);
  scheduler.dispose();
});

test('once schedules fire only after a runtime crossing and a future edit rearms them', () => {
  let now = 0;
  let date = new Date(2026, 0, 1, 12, 0, 0);
  const timer = fakeTimer();
  const events = [];
  const scheduler = new AutomationScheduler({
    engine: { onAutomationEvent: (...event) => events.push(event) }, nowMonotonic: () => now,
    nowDate: () => date, ...timer
  });
  const source = { kind: 'timer', schedule: 'once', date: '2026-01-01', hour: 12, minute: 0, second: 2 };
  scheduler.sync([{ id: 'once', source, target: { instance: 'first' }, map: { lo: 0, hi: 1 } }]);
  now = 1000;
  date = new Date(2026, 0, 1, 12, 0, 1);
  timer.runOnly();
  assert.equal(events.length, 0);
  now = 2000;
  date = new Date(2026, 0, 1, 12, 0, 3);
  timer.runOnly();
  assert.deepEqual(events.map(([id]) => id), ['once']);
  scheduler.sync([{ id: 'once', source, target: { instance: 'all' }, map: { lo: 0.2, hi: 0.8, amount: 2 } }]);
  now = 3000;
  date = new Date(2026, 0, 1, 12, 0, 4);
  timer.runOnly();
  assert.equal(events.length, 1, 'ordinary sync must not rearm a fired once schedule');
  scheduler.sync([{ id: 'once', source: { ...source, date: '2026-01-02' } }]);
  now = 4000;
  date = new Date(2026, 0, 2, 12, 0, 3);
  timer.runOnly();
  assert.equal(events.length, 2, 'a changed schedule identity rearms once');
  scheduler.dispose();
});

test('past once schedules do not catch up and daily schedules fire once per local date', () => {
  let now = 0;
  let date = new Date(2026, 0, 1, 17, 59, 59);
  const timer = fakeTimer();
  const events = [];
  const scheduler = new AutomationScheduler({
    engine: { onAutomationEvent: (...event) => events.push(event) }, nowMonotonic: () => now,
    nowDate: () => date, ...timer
  });
  scheduler.sync([
    { id: 'expired', source: { kind: 'timer', schedule: 'once', date: '2026-01-01', hour: 17, minute: 0, second: 0 } },
    { id: 'daily', source: { kind: 'timer', schedule: 'daily', hour: 18, minute: 0, second: 0 } }
  ]);
  now = 1000;
  date = new Date(2026, 0, 1, 18, 0, 0);
  timer.runOnly();
  assert.deepEqual(events.map(([id]) => id), ['daily']);
  now = 2000;
  date = new Date(2026, 0, 1, 18, 0, 1);
  timer.runOnly();
  assert.equal(events.length, 1);
  now = 3000;
  date = new Date(2026, 0, 2, 18, 0, 0);
  timer.runOnly();
  assert.deepEqual(events.map(([id]) => id), ['daily', 'daily']);
  scheduler.dispose();
});

test('a delayed daily delivery consumes that local date and advances to the following date', () => {
  let now = 0;
  let date = new Date(2026, 0, 1, 17, 0, 0);
  const timer = fakeTimer();
  const events = [];
  const scheduler = new AutomationScheduler({
    engine: { onAutomationEvent: (...event) => events.push(event) }, nowMonotonic: () => now,
    nowDate: () => date, ...timer
  });
  scheduler.sync([{ id: 'daily', source: { kind: 'timer', schedule: 'daily', hour: 18, minute: 0, second: 0 } }]);
  now = 1000;
  date = new Date(2026, 0, 2, 17, 0, 0);
  timer.runOnly();
  assert.equal(events.length, 1, 'the armed prior-day occurrence is consumed once');
  now = 2000;
  date = new Date(2026, 0, 2, 18, 0, 0);
  timer.runOnly();
  assert.equal(events.length, 1, 'daily automation fires at most once on the delivery local date');
  now = 3000;
  date = new Date(2026, 0, 1, 18, 0, 0);
  timer.runOnly();
  assert.equal(events.length, 1, 'a backward clock change cannot replay a consumed daily date');
  now = 4000;
  date = new Date(2026, 0, 3, 18, 0, 0);
  timer.runOnly();
  assert.equal(events.length, 2, 'the next daily occurrence is the day after delivery');
  scheduler.dispose();
});

test('wall occurrences are consumed even when the engine declines them, with one timer for mixed schedules', () => {
  let now = 0;
  let date = new Date(2026, 0, 1, 11, 59, 59);
  const timer = fakeTimer();
  let calls = 0;
  const scheduler = new AutomationScheduler({
    engine: { onAutomationEvent() { calls++; return false; } }, nowMonotonic: () => now,
    nowDate: () => date, ...timer
  });
  scheduler.sync([
    { id: 'interval', source: { kind: 'timer', schedule: 'interval', intervalMs: 1000 } },
    { id: 'once', source: { kind: 'timer', schedule: 'once', date: '2026-01-01', hour: 12, minute: 0, second: 0 } }
  ]);
  assert.equal(timer.callbacks.size, 1);
  now = 1000;
  date = new Date(2026, 0, 1, 12, 0, 0);
  timer.runOnly();
  assert.equal(calls, 2);
  now = 2000;
  date = new Date(2026, 0, 1, 12, 0, 1);
  timer.runOnly();
  assert.equal(calls, 3, 'only the interval fires after the once occurrence is consumed');
  scheduler.dispose();
});

test('daily local schedules use host DST semantics exactly once in America/New_York', () => {
  const schedulerUrl = new URL('../../js/midi/automation-scheduler.js', import.meta.url).href;
  const script = `
    import { AutomationScheduler } from ${JSON.stringify(schedulerUrl)};
    function makeTimer() { let callback; return { setTimeoutFn(fn) { callback = fn; return 1; }, clearTimeoutFn() {}, run() { callback(); } }; }
    function runDaily(start, checks, source) {
      let monotonic = 0; let current = start; const timer = makeTimer(); const events = [];
      const scheduler = new AutomationScheduler({ engine: { onAutomationEvent: (...args) => events.push(args) }, nowMonotonic: () => monotonic, nowDate: () => current, ...timer });
      scheduler.sync([{ id: 'daily', source }]);
      for (const next of checks) { monotonic += 1000; current = next; timer.run(); }
      return events.length;
    }
    const spring = runDaily(new Date(2026, 2, 8, 1, 59, 59), [new Date(2026, 2, 8, 3, 30, 0)], { kind: 'timer', schedule: 'daily', hour: 2, minute: 30, second: 0 });
    const fall = runDaily(new Date(2026, 10, 1, 0, 59, 59), [new Date(2026, 10, 1, 1, 30, 0), new Date('2026-11-01T06:30:00Z')], { kind: 'timer', schedule: 'daily', hour: 1, minute: 30, second: 0 });
    const nextDay = runDaily(new Date(2026, 2, 8, 19, 0, 0), [new Date(2026, 2, 9, 18, 0, 0)], { kind: 'timer', schedule: 'daily', hour: 18, minute: 0, second: 0 });
    if (spring !== 1 || fall !== 1 || nextDay !== 1) process.exit(1);
  `;
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    env: { ...process.env, TZ: 'America/New_York' }, stdio: 'pipe'
  }));
});

test('scheduler default timer wrappers preserve the global native receiver when scheduling and clearing', () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const calls = [];
  let handle = 0;
  try {
    globalThis.setTimeout = function nativeSetTimeout(...args) {
      assert.equal(this, globalThis);
      calls.push({ kind: 'set', args });
      return ++handle;
    };
    globalThis.clearTimeout = function nativeClearTimeout(...args) {
      assert.equal(this, globalThis);
      calls.push({ kind: 'clear', args });
    };
    const scheduler = new AutomationScheduler({ engine: {}, nowMonotonic: () => 0 });
    scheduler.sync([{ id: 'timer', source: { kind: 'timer', schedule: 'interval', intervalMs: 1000 } }]);
    scheduler.sync([]);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].kind, 'set');
    assert.equal(typeof calls[0].args[0], 'function');
    assert.equal(calls[0].args[1], 1000);
    assert.deepEqual(calls[1], { kind: 'clear', args: [1] });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
