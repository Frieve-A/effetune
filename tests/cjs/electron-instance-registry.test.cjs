const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  INSTANCE_REGISTRY_DIRECTORY,
  createInstanceRegistry
} = require('../../electron/instance-registry.cjs');

function createHarness(t, options = {}) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'effetune-instances-'));
  t.after(() => fs.rmSync(userDataPath, { recursive: true, force: true }));
  const clock = { now: 1000 };
  const alive = new Set(options.alive || []);
  const warnings = [];
  const sleeps = [];
  const registry = createInstanceRegistry({
    userDataPath,
    pid: options.pid ?? 500,
    now: () => clock.now,
    isProcessAlive: pid => alive.has(pid),
    sleep: async ms => {
      sleeps.push(ms);
      clock.now += ms;
      options.onSleep?.(clock, alive, sleeps.length);
    },
    logger: { warn(...args) { warnings.push(args.join(' ')); } }
  });
  const directory = path.join(userDataPath, INSTANCE_REGISTRY_DIRECTORY);
  const writeForeign = (pid, record) => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `${pid}.json`), JSON.stringify(record));
  };
  const readOwn = () => JSON.parse(fs.readFileSync(path.join(directory, `${options.pid ?? 500}.json`), 'utf8'));
  return { registry, directory, clock, alive, warnings, sleeps, writeForeign, readOwn };
}

test('instance registry records its own process and marks the quit time in place', t => {
  const harness = createHarness(t);
  assert.deepEqual(harness.registry.register(), { pid: 500, startedAt: 1000 });
  assert.deepEqual(harness.readOwn(), { pid: 500, startedAt: 1000 });
  harness.clock.now = 5000;
  assert.deepEqual(harness.registry.markQuitting(), { pid: 500, startedAt: 1000, quittingAt: 5000 });
  assert.deepEqual(harness.readOwn(), { pid: 500, startedAt: 1000, quittingAt: 5000 });
  assert.deepEqual(fs.readdirSync(harness.directory), ['500.json']);
});

test('instance registry marks quitting even when the process never registered', t => {
  const harness = createHarness(t);
  assert.deepEqual(harness.registry.markQuitting(), { pid: 500, startedAt: 1000, quittingAt: 1000 });
});

test('instance registry lists living foreign processes and discards records of dead or unreadable ones', t => {
  const harness = createHarness(t, { alive: [600, 700] });
  harness.registry.register();
  harness.writeForeign(600, { pid: 600, startedAt: 10, quittingAt: 900 });
  harness.writeForeign(700, 'not json');
  harness.writeForeign(800, { pid: 800, startedAt: 10 });
  fs.writeFileSync(path.join(harness.directory, 'notes.txt'), 'ignored');

  assert.deepEqual(harness.registry.findOtherInstances(), [
    { pid: 600, startedAt: 10, quittingAt: 900 },
    { pid: 700, startedAt: null, quittingAt: null }
  ]);
  assert.deepEqual(fs.readdirSync(harness.directory).sort(), ['500.json', '600.json', '700.json', 'notes.txt']);
});

test('instance registry reports nothing when the registry directory does not exist yet', async t => {
  const harness = createHarness(t);
  assert.deepEqual(harness.registry.findOtherInstances(), []);
  assert.deepEqual(await harness.registry.waitForQuittingPredecessors({ timeoutMs: 1000 }), { waitedMs: 0, remaining: [] });
});

test('instance registry waits for a quitting predecessor until it disappears', async t => {
  const harness = createHarness(t, {
    alive: [600],
    onSleep(clock, alive, count) { if (count === 3) alive.delete(600); }
  });
  harness.writeForeign(600, { pid: 600, startedAt: 10, quittingAt: 900 });

  const result = await harness.registry.waitForQuittingPredecessors({ timeoutMs: 35000, pollMs: 250 });
  assert.deepEqual(result, { waitedMs: 750, remaining: [] });
  assert.deepEqual(harness.sleeps, [250, 250, 250]);
  assert.deepEqual(fs.readdirSync(harness.directory), []);
  assert.deepEqual(harness.warnings, []);
});

test('instance registry does not wait for processes that never began quitting or whose quit time is stale', async t => {
  const harness = createHarness(t, { alive: [600, 700] });
  harness.writeForeign(600, { pid: 600, startedAt: 10 });
  harness.writeForeign(700, { pid: 700, startedAt: 10, quittingAt: 1000 - 35000 });

  const result = await harness.registry.waitForQuittingPredecessors({ timeoutMs: 35000 });
  assert.deepEqual(result, { waitedMs: 0, remaining: [] });
  assert.deepEqual(harness.sleeps, []);
});

test('instance registry gives up after the timeout and reports the process it was waiting for', async t => {
  const harness = createHarness(t, { alive: [600] });
  harness.writeForeign(600, { pid: 600, startedAt: 10, quittingAt: 1500 });

  const result = await harness.registry.waitForQuittingPredecessors({ timeoutMs: 1000, pollMs: 400 });
  assert.equal(result.waitedMs, 1200);
  assert.deepEqual(result.remaining, [{ pid: 600, startedAt: 10, quittingAt: 1500 }]);
  assert.deepEqual(harness.sleeps, [400, 400, 400]);
  assert.equal(harness.warnings.length, 1);
  assert.ok(harness.warnings[0].includes('600'));
});

test('instance registry requires a user data path', () => {
  assert.throws(() => createInstanceRegistry({}), TypeError);
});
