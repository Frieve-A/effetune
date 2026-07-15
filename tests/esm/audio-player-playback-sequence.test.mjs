import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CatalogSequence,
  CompositeCatalogSequence,
  MaterializedSequence,
  PendingTransportSlot,
  ReversibleShufflePermutation,
  SequenceQueueProvider
} from '../../js/ui/audio-player/playback-sequence.js';

test('shuffle permutation is reversible without storing an item index array', () => {
  for (const itemCount of [1, 2, 3, 17, 255, 1_001, 10_000]) {
    const permutation = new ReversibleShufflePermutation(itemCount, 0x12345678);
    const shuffled = new Set();
    for (let ordinal = 0; ordinal < itemCount; ordinal += 1) {
      const shuffledOrdinal = permutation.permute(ordinal);
      shuffled.add(shuffledOrdinal);
      assert.equal(permutation.invert(shuffledOrdinal), ordinal);
    }
    assert.equal(shuffled.size, itemCount);
  }
});

test('million-item shuffle resolves representative boundaries deterministically', () => {
  const first = new ReversibleShufflePermutation(1_000_000, 42);
  const second = new ReversibleShufflePermutation(1_000_000, 42);
  const ordinals = [0, 1, 99, 499_999, 999_998, 999_999];

  const values = ordinals.map(ordinal => first.permute(ordinal));
  assert.deepEqual(values, ordinals.map(ordinal => second.permute(ordinal)));
  assert.equal(new Set(values).size, values.length);
  values.forEach((value, index) => assert.equal(first.invert(value), ordinals[index]));
});

test('different shuffle seeds produce different bounded orders', () => {
  const first = new ReversibleShufflePermutation(1_000, 1);
  const second = new ReversibleShufflePermutation(1_000, 2);
  const left = Array.from({ length: 20 }, (_, ordinal) => first.permute(ordinal));
  const right = Array.from({ length: 20 }, (_, ordinal) => second.permute(ordinal));

  assert.notDeepEqual(left, right);
  assert.ok(left.every(ordinal => ordinal >= 0 && ordinal < 1_000));
  assert.ok(right.every(ordinal => ordinal >= 0 && ordinal < 1_000));
});

test('shuffle permutation rejects unsupported sequence sizes and ordinals', () => {
  assert.throws(() => new ReversibleShufflePermutation(-1, 0), RangeError);
  assert.throws(() => new ReversibleShufflePermutation(0x40000001, 0), RangeError);
  assert.throws(() => new ReversibleShufflePermutation(10, Number.MAX_SAFE_INTEGER + 1), RangeError);

  const permutation = new ReversibleShufflePermutation(10, 0);
  assert.throws(() => permutation.permute(10), RangeError);
  assert.throws(() => permutation.invert(-1), RangeError);
});

test('small explicit queues use bounded immutable entry instances', async () => {
  const sequence = new MaterializedSequence([
    { name: 'One' },
    { name: 'Two', entryInstanceId: 'kept-id' }
  ]);
  assert.equal(sequence.itemCount, 2);
  assert.equal(sequence.getEntry(1).entryInstanceId, 'kept-id');
  assert.equal(Object.isFrozen(sequence.getEntry(0)), true);
  assert.deepEqual((await sequence.getWindow({ limit: 2 })).rows.map(row => row.name), ['One', 'Two']);
  assert.throws(() => new MaterializedSequence(Array.from({ length: 4_097 }, () => ({}))), RangeError);
});

test('million-item CatalogSequence keeps current-near pages bounded and resolves source on demand', async () => {
  const pageReads = [];
  const sourceReads = [];
  const sequence = new CatalogSequence({
    sequenceId: 'sequence-1m',
    itemCount: 1_000_000,
    async readPage({ startOrdinal, limit }) {
      pageReads.push([startOrdinal, limit]);
      return {
        rows: Array.from({ length: limit }, (_, offset) => ({
          trackUid: `track-${startOrdinal + offset}`,
          title: `Track ${startOrdinal + offset}`
        }))
      };
    },
    async resolveSource(request) {
      sourceReads.push(request);
      return { path: `/music/${request.trackUid}.flac` };
    }
  });

  for (const ordinal of [0, 200, 400, 600, 800, 999_999]) {
    const entry = await sequence.getEntry(ordinal);
    assert.equal(entry.trackUid, `track-${ordinal}`);
  }
  const stats = sequence.getCacheStats();
  assert.ok(stats.cachedPageCount <= 5);
  assert.ok(stats.cachedRowCount <= 1_000);
  assert.equal(sourceReads.length, 0);
  const last = await sequence.getEntry(999_999);
  assert.deepEqual(await sequence.resolveEntrySource(last), { path: '/music/track-999999.flac' });
  assert.equal(sourceReads.length, 1);
  assert.ok(pageReads.every(([, limit]) => limit <= 200));
});

test('CatalogSequence shuffle Next and Previous are deterministic and reversible without arrays', async () => {
  const sequence = new CatalogSequence({
    sequenceId: 'sequence-shuffle',
    itemCount: 100_000,
    shuffleSeed: 91,
    async readPage({ startOrdinal, limit }) {
      return { rows: Array.from({ length: limit }, (_, index) => ({ trackUid: `t${startOrdinal + index}` })) };
    },
    async resolveSource() {
      return {};
    }
  });
  sequence.setShuffle(true);
  const firstOrder = [0, 1, 2, 50_000, 99_999].map(ordinal => sequence.toCanonicalOrdinal(ordinal));
  firstOrder.forEach((canonical, index) => {
    assert.equal(sequence.toTransportOrdinal(canonical), [0, 1, 2, 50_000, 99_999][index]);
  });
  let ordinal = 99_999;
  ordinal = sequence.moveTransportOrdinal(ordinal, 1, 'ALL');
  assert.equal(ordinal, 0);
  ordinal = sequence.moveTransportOrdinal(ordinal, -1, 'ALL');
  assert.equal(ordinal, 99_999);
  assert.deepEqual(
    [0, 1, 2, 50_000, 99_999].map(value => sequence.toCanonicalOrdinal(value)),
    firstOrder
  );
});

test('shuffle Repeat All epochs never repeat the boundary track for multi-item sequences', () => {
  for (const itemCount of [2, 3, 7, 31, 257]) {
    for (let seed = 0; seed < 40; seed += 1) {
      const forward = createCatalogSequence(itemCount, seed, `forward-${itemCount}-${seed}`);
      forward.setShuffle(true);
      for (let epoch = 0; epoch < 20; epoch += 1) {
        const previousFinal = forward.toCanonicalOrdinal(itemCount - 1);
        assert.equal(forward.moveTransportOrdinal(itemCount - 1, 1, 'ALL'), 0);
        assert.notEqual(forward.toCanonicalOrdinal(0), previousFinal);
        assert.equal(forward.toTransportOrdinal(forward.toCanonicalOrdinal(0)), 0);
      }

      const reverse = createCatalogSequence(itemCount, seed, `reverse-${itemCount}-${seed}`);
      reverse.setShuffle(true);
      for (let epoch = 0; epoch < 20; epoch += 1) {
        const previousFirst = reverse.toCanonicalOrdinal(0);
        assert.equal(reverse.moveTransportOrdinal(0, -1, 'ALL'), itemCount - 1);
        assert.notEqual(reverse.toCanonicalOrdinal(itemCount - 1), previousFirst);
        assert.equal(
          reverse.toTransportOrdinal(reverse.toCanonicalOrdinal(itemCount - 1)),
          itemCount - 1
        );
      }
    }
  }
});

test('composite catalog sequences preserve prefix, inserted segment, and tail without materialization', async () => {
  const original = createCatalogSequence(6, 1, 'original');
  const inserted = createCatalogSequence(3, 2, 'inserted');
  const sequence = new CompositeCatalogSequence({
    sequenceId: 'composite',
    segments: [
      { sequence: original, startOrdinal: 0, itemCount: 3 },
      { sequence: inserted, startOrdinal: 0, itemCount: 3 },
      { sequence: original, startOrdinal: 3, itemCount: 3 }
    ]
  });
  const window = await sequence.getWindow({ startOrdinal: 0, limit: 9 });
  assert.deepEqual(window.rows.map(entry => entry.trackUid), [
    'original-0', 'original-1', 'original-2',
    'inserted-0', 'inserted-1', 'inserted-2',
    'original-3', 'original-4', 'original-5'
  ]);
  assert.equal(sequence.getDescriptor().segments.length, 3);
});

test('queue provider returns only a bounded window for a query-backed sequence', async () => {
  const sequence = new CatalogSequence({
    sequenceId: 'queue-window',
    itemCount: 1_000_000,
    async readPage({ startOrdinal, limit }) {
      return { rows: Array.from({ length: limit }, (_, index) => ({ trackUid: `q${startOrdinal + index}` })) };
    },
    async resolveSource() {
      return {};
    }
  });
  const provider = new SequenceQueueProvider(sequence);
  const window = await provider.getWindow(500_000, 80);
  assert.equal(provider.itemCount, 1_000_000);
  assert.equal(window.rows.length, 80);
  assert.equal(window.startOrdinal, 499_960);
  const next = await provider.getNextPage(80);
  assert.equal(next.startOrdinal, 500_040);
  const previous = await provider.getPreviousPage(80);
  assert.equal(previous.startOrdinal, 499_960);
});

test('pending transport keeps one generation-tagged slot and fences timeout and stale callbacks', async () => {
  const timers = [];
  const slot = new PendingTransportSlot({
    runtime: 'electron',
    setTimeoutFn(callback, delay) {
      timers.push({ callback, delay, cleared: false });
      return timers.length - 1;
    },
    clearTimeoutFn(index) {
      if (timers[index]) timers[index].cleared = true;
    }
  });
  let resolveFirst;
  const first = slot.run('next', ({ isCurrent }) => new Promise(resolve => {
    resolveFirst = () => resolve(isCurrent() ? 'current' : 'late');
  }));
  await Promise.resolve();
  const second = slot.run('previous', async ({ isCurrent }) => isCurrent() ? 'previous' : 'late');
  resolveFirst();
  assert.deepEqual(await first, { accepted: false, reason: 'stale', generation: 1 });
  assert.equal((await second).value, 'previous');
  assert.equal(timers[0].delay, 3_000);

  const timedOut = slot.run('next', () => new Promise(() => {}));
  timers.at(-1).callback();
  assert.deepEqual(await timedOut, { accepted: false, reason: 'timeout', generation: 3 });
});

test('pending transport invokes timer adapters without rebinding their host receiver', async () => {
  let setReceiver = 'not-called';
  let clearReceiver = 'not-called';
  const slot = new PendingTransportSlot({
    setTimeoutFn: function setTimer() {
      setReceiver = this;
      return 1;
    },
    clearTimeoutFn: function clearTimer() {
      clearReceiver = this;
    }
  });

  assert.equal((await slot.run('next', async () => 'ready')).value, 'ready');
  assert.equal(setReceiver, undefined);
  assert.equal(clearReceiver, undefined);
});

test('transport slot prioritizes explicit commands, coalesces duplicate ended, and records interruption state', async () => {
  let finishExplicit;
  const slot = new PendingTransportSlot();
  const explicit = slot.run({
    kind: 'next',
    playbackGeneration: 8,
    sourceEntryInstanceId: 'entry-8',
    reason: 'explicit'
  }, () => new Promise(resolve => { finishExplicit = resolve; }));
  const endedBehindExplicit = await slot.run({
    kind: 'ended',
    playbackGeneration: 8,
    sourceEntryInstanceId: 'entry-8',
    reason: 'ended'
  }, async () => 'wrong-successor');
  assert.equal(endedBehindExplicit.reason, 'lower-priority');
  finishExplicit('explicit-successor');
  assert.equal((await explicit).value, 'explicit-successor');

  let finishEnded;
  let endedExecutions = 0;
  const endedCommand = {
    kind: 'ended',
    playbackGeneration: 9,
    sourceEntryInstanceId: 'entry-9',
    reason: 'ended'
  };
  const firstEnded = slot.run(endedCommand, () => {
    endedExecutions += 1;
    return new Promise(resolve => { finishEnded = resolve; });
  });
  const duplicateEnded = slot.run(endedCommand, async () => {
    endedExecutions += 1;
    return 'duplicate';
  });
  assert.equal(firstEnded, duplicateEnded);
  await Promise.resolve();
  finishEnded('ended-successor');
  assert.equal((await duplicateEnded).value, 'ended-successor');
  assert.equal(endedExecutions, 1);

  slot.run('next', () => new Promise(() => {}));
  const serialized = slot.getStateSnapshot();
  slot.invalidate();
  assert.equal(slot.lastTerminal.state, 'interrupted');
  const recovered = new PendingTransportSlot({ recoveredState: serialized });
  assert.equal(recovered.getStateSnapshot().state, 'interrupted');
  assert.equal(recovered.getStateSnapshot().sourceEntryInstanceId, serialized.sourceEntryInstanceId);
  assert.ok(recovered.generation > serialized.generation);
});

function createCatalogSequence(itemCount, shuffleSeed, sequenceId) {
  return new CatalogSequence({
    sequenceId,
    itemCount,
    shuffleSeed,
    async readPage({ startOrdinal, limit }) {
      return {
        rows: Array.from({ length: limit }, (_, index) => ({
          entryInstanceId: `${sequenceId}-${startOrdinal + index}`,
          trackUid: `${sequenceId}-${startOrdinal + index}`
        }))
      };
    },
    async resolveSource({ trackUid }) {
      return { path: `/${trackUid}` };
    }
  });
}
