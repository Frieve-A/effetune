'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const { ArtworkWorkerPool, MAX_ARTWORK_QUEUE } = require('../../electron/library-artwork-worker-pool.cjs');
const { MetadataWorkerPool, MAX_METADATA_QUEUE } = require('../../electron/library-metadata-worker-pool.cjs');

class ControlledWorker extends EventEmitter {
  messages = [];
  terminations = 0;
  postMessage(message) { this.messages.push(message); }
  async terminate() { this.terminations += 1; }
  reply(result, requestId = this.messages.at(-1).requestId) {
    this.emit('message', { type: 'result', requestId, result });
  }
}

const poolTypes = [
  {
    name: 'artwork', Pool: ArtworkWorkerPool, queueLimit: MAX_ARTWORK_QUEUE,
    closedCode: 'artworkPoolClosed', queueCode: 'artworkQueueLimit',
    crashCode: 'artwork-worker-crash', timeoutCode: 'artwork-timeout',
    request: (pool, name, signal) => pool.extract({ filePath: path.resolve(name), signal })
  },
  {
    name: 'metadata', Pool: MetadataWorkerPool, queueLimit: MAX_METADATA_QUEUE,
    closedCode: 'metadataPoolClosed', queueCode: 'metadataQueueLimit',
    crashCode: 'worker-crash', timeoutCode: 'parse-timeout',
    request: (pool, name, signal) => pool.parse({
      path: path.resolve(name), relativePath: name, skipCovers: true, signal
    })
  }
];

function harness(t, spec, options = {}) {
  const workers = [];
  const pool = new spec.Pool({
    workerCount: 2, timeoutMs: 10_000, ...options,
    workerFactory() {
      const worker = new ControlledWorker();
      workers.push(worker);
      return worker;
    }
  });
  t.after(() => pool.close());
  return { pool, workers, request: (name, signal) => spec.request(pool, name, signal) };
}

for (const spec of poolTypes) {
  test(`${spec.name} jobs respect concurrency, run in FIFO order, and reuse idle workers`, async t => {
    const { request, workers } = harness(t, spec);
    const first = request('first.flac');
    const second = request('second.flac');
    const third = request('third.flac');
    const fourth = request('fourth.flac');
    assert.equal(workers.length, 2);
    workers[1].reply({ title: 'second' });
    assert.equal(workers[1].messages.at(-1).filePath, path.resolve('third.flac'));
    workers[0].reply({ title: 'first' });
    assert.equal(workers[0].messages.at(-1).filePath, path.resolve('fourth.flac'));
    workers[1].reply({ title: 'third' });
    workers[0].reply(null);
    assert.deepEqual(await Promise.all([first, second, third, fourth]), [
      { title: 'first' }, { title: 'second' }, { title: 'third' }, null
    ]);
    assert.equal(workers.length, 2);
    assert.ok(workers.every(worker => worker.terminations === 0));
  });

  test(`${spec.name} replies from earlier requests cannot settle a later job`, async t => {
    const { request, workers } = harness(t, spec);
    const first = request('first.flac');
    const worker = workers[0];
    const firstId = worker.messages[0].requestId;
    worker.reply({ title: 'first' });
    await first;
    const second = request('second.flac');
    let settled = false;
    void second.then(() => { settled = true; });
    worker.reply({ title: 'stale' }, firstId);
    worker.emit('message', null);
    await Promise.resolve();
    assert.equal(settled, false);
    worker.reply({ title: 'second' });
    assert.deepEqual(await second, { title: 'second' });
    worker.reply({ title: 'duplicate' });
    const third = request('third.flac');
    worker.reply({ title: 'third' });
    assert.deepEqual(await third, { title: 'third' });
    assert.equal(workers.length, 1);
  });

  test(`${spec.name} file errors preserve the worker for the next request`, async t => {
    const { request, workers } = harness(t, spec);
    const failed = assert.rejects(request('bad.flac'), { code: 'corrupt-container', message: 'Invalid audio' });
    workers[0].emit('message', {
      type: 'error', requestId: workers[0].messages[0].requestId,
      error: { code: 'corrupt-container', message: 'Invalid audio' }
    });
    await failed;
    const next = request('good.flac');
    workers[0].reply({ title: 'good' });
    assert.deepEqual(await next, { title: 'good' });
    assert.equal(workers.length, 1);
    assert.equal(workers[0].terminations, 0);
  });

  for (const event of ['error', 'exit']) {
    test(`${spec.name} worker ${event} rejects its job and dispatches queued work to a replacement`, async t => {
      const { request, workers } = harness(t, spec);
      const failed = assert.rejects(request('failed.flac'), { code: spec.crashCode });
      const other = request('other.flac');
      const queued = request('queued.flac');
      workers[0].emit(event, event === 'error' ? new Error('Worker failed') : 1);
      await failed;
      assert.equal(workers[0].terminations, 1);
      assert.equal(workers.length, 3);
      assert.equal(workers[2].messages[0].filePath, path.resolve('queued.flac'));
      workers[0].reply({ title: 'late' });
      workers[2].reply({ title: 'queued' });
      workers[1].reply({ title: 'other' });
      assert.deepEqual(await Promise.all([other, queued]), [{ title: 'other' }, { title: 'queued' }]);
    });
  }

  test(`${spec.name} idle worker exit removes the dead worker before reuse`, async t => {
    const { request, workers } = harness(t, spec);
    const first = request('first.flac');
    workers[0].reply(null);
    await first;
    workers[0].emit('exit', 0);
    const next = request('next.flac');
    assert.equal(workers.length, 2);
    workers[1].reply({ title: 'next' });
    assert.deepEqual(await next, { title: 'next' });
  });

  test(`${spec.name} queued cancellation leaves active work intact and never dispatches the canceled job`, async t => {
    const { request, workers } = harness(t, spec);
    const active = [request('first.flac'), request('second.flac')];
    const controller = new AbortController();
    const reason = new Error('Canceled by user');
    const canceled = assert.rejects(request('canceled.flac', controller.signal), error => error === reason);
    const next = request('next.flac');
    controller.abort(reason);
    await canceled;
    workers[0].reply(null);
    assert.equal(workers[0].messages.at(-1).filePath, path.resolve('next.flac'));
    workers[0].reply({ title: 'next' });
    workers[1].reply(null);
    await Promise.all(active);
    assert.deepEqual(await next, { title: 'next' });
    assert.ok(workers.every(worker => worker.terminations === 0));
  });

  test(`${spec.name} active cancellation terminates only its worker and preserves queued work`, async t => {
    const { request, workers } = harness(t, spec);
    const controller = new AbortController();
    const canceled = assert.rejects(request('canceled.flac', controller.signal), { name: 'AbortError' });
    const other = request('other.flac');
    const queued = request('queued.flac');
    controller.abort('user cancellation');
    await canceled;
    assert.equal(workers[0].terminations, 1);
    assert.equal(workers[1].terminations, 0);
    workers[2].reply({ title: 'queued' });
    workers[1].reply(null);
    assert.deepEqual(await queued, { title: 'queued' });
    await other;
  });

  test(`${spec.name} already canceled requests allocate no workers`, async t => {
    const { request, workers } = harness(t, spec);
    const reason = new Error('Canceled before dispatch');
    await assert.rejects(request('track.flac', AbortSignal.abort(reason)), error => error === reason);
    assert.equal(workers.length, 0);
  });

  test(`${spec.name} queue limits reject overload and closing settles every accepted request`, async t => {
    const { pool, request, workers } = harness(t, spec);
    const pending = Array.from({ length: spec.queueLimit + 2 }, (_, index) =>
      assert.rejects(request(`${index}.flac`), { code: spec.closedCode }));
    await assert.rejects(request('over-limit.flac'), { code: spec.queueCode });
    assert.equal(workers.length, 2);
    await pool.close();
    await Promise.all(pending);
    assert.ok(workers.every(worker => worker.terminations > 0));
    const terminations = workers.map(worker => worker.terminations);
    await pool.close();
    assert.deepEqual(workers.map(worker => worker.terminations), terminations);
    await assert.rejects(request('after-close.flac'), { code: spec.closedCode });
    assert.equal(workers.length, 2);
  });

  test(`${spec.name} timeout frees a hung worker so later requests can succeed`, async t => {
    const { request, workers } = harness(t, spec, { timeoutMs: 100 });
    let guard;
    const failed = Promise.race([
      request('hung.flac'),
      new Promise((_, reject) => { guard = setTimeout(() => reject(new Error('Timeout did not settle')), 5000); })
    ]);
    try {
      await assert.rejects(failed, { code: spec.timeoutCode });
    } finally {
      clearTimeout(guard);
    }
    assert.equal(workers[0].terminations, 1);
    const next = request('next.flac');
    workers[1].reply({ title: 'next' });
    assert.deepEqual(await next, { title: 'next' });
  });
}

test('metadata workers reject oversized, unserializable, and invalid replies before reusing a worker', async t => {
  const spec = poolTypes[1];
  const { request, workers } = harness(t, spec);
  const circular = {};
  circular.self = circular;
  for (const reply of [
    { type: 'result', result: { title: 'x'.repeat(512 * 1024) } },
    { type: 'result', result: circular },
    { type: 'unexpected', result: {} }
  ]) {
    const rejected = assert.rejects(request('bad.flac'), { code: 'metadata-too-large' });
    const worker = workers.at(-1);
    worker.emit('message', { ...reply, requestId: worker.messages.at(-1).requestId });
    await rejected;
    assert.equal(worker.terminations, 1);
  }
  const next = request('valid.flac');
  workers.at(-1).reply({ title: 'valid' });
  assert.deepEqual(await next, { title: 'valid' });
});
