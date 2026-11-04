import test from 'node:test';
import assert from 'node:assert/strict';
import { SfzSamplePageProvider } from '../../js/sfz/sample-page-provider.js';

function fixture(generation = 1, readError = -1) {
  const acks = [], reads = [], tasks = []; let active = 0, maximum = 0, closes = 0;
  const provider = new SfzSamplePageProvider({ assetId: 'a'.repeat(24), generation, createReader() {},
    worker: { async readPage(sample, pageIndex) {
      reads.push([sample, pageIndex]);
      if (sample === readError) throw Object.assign(new Error('authored read failure'), { code: 'sample-read' });
      return { pageIndex, firstFrame: 0, frames: 4096, channels: 1, pcm: new Float32Array(4096) };
    }, close() { closes++; } },
    publish(page) {
      active++; maximum = Math.max(maximum, active);
      return new Promise((resolve, reject) => acks.push({ page,
        resolve(value = true) { active--; resolve(value); }, reject(error) { active--; reject(error); } }));
    } });
  provider.samples = Array.from({ length: 8 }, () => ({ frames: 4096, channels: 1, sampleRate: 48000, revision: 'test' }));
  const request = (samples = [0, 1, 2, 3, 4, 5, 6, 7], resident = false) => {
    const task = provider.requestPages(samples.map(sample => ({ generation, sample, pageIndex: 0, resident })));
    task.catch(() => {}); tasks.push(task); return task;
  };
  return { provider, acks, reads, request, get maximum() { return maximum; }, get closes() { return closes; },
    async close() { provider.close(); for (const ack of acks) ack.resolve(); await Promise.allSettled(tasks); } };
}
async function until(predicate) {
  for (let i = 0; i < 64 && !predicate(); i++) await Promise.resolve();
  assert.ok(predicate(), 'Expected bounded asynchronous provider progress');
}

test('page ACKs overlap within four slots, retain same-key dedupe and accept out-of-order completion', async t => {
  const h = fixture(); t.after(() => h.close());
  const task = h.request([0, 1, 2, 3]); await until(() => h.acks.length === 4);
  assert.equal(h.maximum, 4); assert.equal(h.reads.length, 4);
  const tail = h.request([4, 5, 6, 7]);
  const same = h.request([2]);
  assert.equal(h.provider.pending.size, 8);
  h.acks[2].resolve(); await same; await until(() => h.acks.length === 5);
  assert.equal(h.reads.filter(([sample]) => sample === 2).length, 1);
  assert.equal(h.provider.pending.has('0:0:0'), true);
  for (let index = 0; index < 8; index++) {
    await until(() => h.acks.length > index);
    if (index !== 2) h.acks[index].resolve();
  }
  await Promise.all([task, tail]); assert.equal(h.maximum, 4); assert.equal(h.provider.pending.size, 0);
  assert.deepEqual(h.acks.map(ack => ack.page.sample), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test('a false ACK rejects the batch once and closing prevents later acknowledgements from publishing more pages', async t => {
  const h = fixture(); t.after(() => h.close());
  let rejected = 0;
  const task = h.request(); task.catch(() => { rejected++; h.provider.close(); });
  await until(() => h.acks.length === 4); h.acks[1].resolve(false);
  await assert.rejects(task, { code: 'sample-capacity' });
  for (const ack of h.acks) if (ack !== h.acks[1]) ack.resolve();
  await until(() => h.provider.closed);
  assert.equal(rejected, 1); assert.equal(h.acks.length, 4); assert.equal(h.closes, 1);
  assert.equal(h.provider.pending.size, 0);
});

test('a genuine decode read error retains its code while earlier publication is outstanding', async t => {
  const h = fixture(1, 1); t.after(() => h.close());
  const task = h.request([0, 1]);
  await until(() => h.reads.length === 2);
  await assert.rejects(task, { code: 'sample-read' });
  assert.equal(h.acks.length, 1); assert.equal(h.acks[0].page.sample, 0);
});

test('disposed generation acknowledgements cannot mark resident pages or affect a new provider generation', async t => {
  const old = fixture(1), fresh = fixture(2); t.after(async () => { await old.close(); await fresh.close(); });
  const stale = old.request([0], true); await until(() => old.acks.length === 1);
  old.provider.close(); await assert.rejects(stale, { code: 'sample-cancelled' });
  const current = fresh.request([0], true); await until(() => fresh.acks.length === 1);
  old.acks[0].resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(old.provider.prepared.size, 0); assert.equal(fresh.provider.pending.size, 1);
  assert.equal(fresh.provider.prepared.size, 0); assert.equal(fresh.acks[0].page.generation, 2);
  fresh.acks[0].resolve(); await current; assert.equal(fresh.provider.prepared.size, 1);
});


test('a rejected publication promise preserves its error and settles its request once', async t => {
  const h = fixture(); t.after(() => h.close());
  let rejections = 0;
  const task = h.request([0, 1, 2, 3]);
  task.catch(() => { rejections++; h.provider.close(); });
  await until(() => h.acks.length === 4);
  const error = Object.assign(new Error('authored control failure'), { code: 'control-failed' });
  h.acks[3].reject(error);
  await assert.rejects(task, value => value === error);
  for (const ack of h.acks.slice(0, 3)) ack.resolve();
  await until(() => h.provider.closed);
  assert.equal(rejections, 1); assert.equal(h.closes, 1);
});
