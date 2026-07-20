import assert from 'node:assert/strict';
import test from 'node:test';

import { IrPreparationWorkerClient } from '../../js/ir-library/ir-preparation-worker-client.js';

class FakeWorker {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
    FakeWorker.instance = this;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  postMessage(message, transfer) {
    this.messages.push({ message, transfer });
  }

  emit(type, data) {
    this.listeners.get(type)?.({ data });
  }

  terminate() {
    this.terminated = true;
  }
}

test('IR preparation worker client transfers cloned PCM and preserves the reusable source', async () => {
  const client = new IrPreparationWorkerClient({
    WorkerClass: FakeWorker,
    workerUrl: new URL('https://example.test/ir-worker.js')
  });
  const left = new Float32Array([1, 0.5]);
  const right = new Float32Array([0.25, 0]);
  const pending = client.prepare({ channels: [left, right], sampleRate: 48000, options: {} });

  assert.equal(FakeWorker.instance.options.type, 'module');
  assert.equal(FakeWorker.instance.messages.length, 1);
  const transferred = FakeWorker.instance.messages[0].transfer;
  assert.equal(transferred.length, 2);
  assert.notEqual(transferred[0], left.buffer);
  assert.notEqual(transferred[1], right.buffer);
  assert.deepEqual(
    FakeWorker.instance.messages[0].message.request.channels.map(channel => [...channel]),
    [[1, 0.5], [0.25, 0]]
  );
  assert.equal(left.byteLength, 8);
  assert.equal(right.byteLength, 8);
  assert.deepEqual([...left], [1, 0.5]);
  assert.deepEqual([...right], [0.25, 0]);
  assert.equal(FakeWorker.instance.messages[0].message.request.sampleRate, 48000);

  FakeWorker.instance.emit('message', {
    id: FakeWorker.instance.messages[0].message.id,
    result: { frames: 2 }
  });
  assert.deepEqual(await pending, { frames: 2 });
  client.close();
  assert.equal(FakeWorker.instance.terminated, true);
});

test('IR preparation worker client rejects a worker-safe error message', async () => {
  const client = new IrPreparationWorkerClient({ WorkerClass: FakeWorker });
  const pending = client.prepare({ channels: [new Float32Array([1])], sampleRate: 48000 });
  const { id } = FakeWorker.instance.messages[0].message;
  FakeWorker.instance.emit('message', {
    id,
    error: 'The impulse response could not be prepared.',
    diagnostic: 'internal details'
  });

  await assert.rejects(pending, /could not be prepared/);
  client.close();
});

test('IR preparation worker client emits a payload from cloned cached prepared PCM', async () => {
  const client = new IrPreparationWorkerClient({ WorkerClass: FakeWorker });
  const cached = new Float32Array([1, 0.5, 0.25]);
  const pending = client.emit({
    channels: [cached],
    sampleRate: 48000,
    options: { topology: 1, maxFrames: 2 }
  });
  const posted = FakeWorker.instance.messages[0];
  assert.equal(posted.message.operation, 'emit');
  assert.notEqual(posted.transfer[0], cached.buffer);
  assert.deepEqual([...cached], [1, 0.5, 0.25]);
  FakeWorker.instance.emit('message', { id: posted.message.id, result: { frames: 2 } });
  assert.deepEqual(await pending, { frames: 2 });
  client.close();
});
