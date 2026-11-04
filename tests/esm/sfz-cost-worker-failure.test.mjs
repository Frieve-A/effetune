import assert from 'node:assert/strict';
import test from 'node:test';
import { SfzEffectCost } from '../../js/sfz/effect-cost.js';
import { attachSfzEffectCostWorker } from '../../js/sfz/effect-cost-worker.js';
import { audioManagerSfzRuntimeMethods } from '../../js/audio/audio-manager-sfz-runtime.js';

class CostWorker {
  static instances = [];
  constructor() { this.requests = []; this.terminated = false; CostWorker.instances.push(this); }
  postMessage(data) {
    this.requests.push(data);
    if (data.type === 'module') queueMicrotask(() => this.onmessage({ data: { id: data.id, ok: true } }));
  }
  terminate() { this.terminated = true; }
  result(bytes) {
    const request = this.requests.findLast(value => value.type === 'estimate');
    assert.ok(request);
    this.onmessage({ data: { id: request.id, ok: true, bytes } });
  }
}
const payload = () => { const result = new ArrayBuffer(4096), words = new Uint32Array(result);
  words.set([0x31415445, 1, (4096 - 32) / 4, 1]); words[8 + 4] = 16; return result; };
const context = { sampleRate: 48000, processingChannels: 2, maxFrames: 128, minimumPhysicalBpm: 0 };
const drain = async () => { for (let tick = 0; tick < 8; tick++) await Promise.resolve(); };
const until = async predicate => {
  for (let turn = 0; turn < 100; turn++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
  assert.fail('The sizing request did not reach its worker');
};

test('worker faults reject preparation visibly and the same module recreates a closed worker', { timeout: 3000 }, async () => {
  const previous = globalThis.Worker; globalThis.Worker = CostWorker; CostWorker.instances.length = 0;
  const manager = { dspModuleInfo: { module: {} }, estimateSfzEffectPreparation: audioManagerSfzRuntimeMethods.estimateSfzEffectPreparation };
  try {
    const first = manager.estimateSfzEffectPreparation(payload(), context);
    const rejected = assert.rejects(first, { code: 'prepare' });
    await until(() => CostWorker.instances[0]?.requests.some(request => request.type === 'estimate'));
    const broken = CostWorker.instances[0]; broken.onerror(new Error('authored worker failure')); await rejected;
    assert.equal(manager._sfzEffectCost.worker.closed, true); assert.equal(broken.terminated, true);
    assert.equal(manager._sfzEffectCost.worker.pending.size, 0);
    const second = manager.estimateSfzEffectPreparation(payload(), { ...context, playerKind: 1 });
    await until(() => CostWorker.instances[1]?.requests.some(request => request.type === 'estimate'));
    assert.equal(CostWorker.instances[1].requests.find(request => request.type === 'estimate').context.playerKind, 1);
    assert.equal(CostWorker.instances.length, 2);
    broken.result(999);
    assert.equal(manager._sfzEffectCost.worker.pending.size, 1, 'A retired worker cannot settle the replacement request with the same sequence ID');
    CostWorker.instances[1].result(1024);
    assert.equal(await second, 1024);
  } finally { manager._sfzEffectCost?.worker.close(); globalThis.Worker = previous; }
});

test('sizing worker forwards the player kind to the native binding', async () => {
  const queries = [], responses = [], endpoint = { postMessage: response => responses.push(response) };
  attachSfzEffectCostWorker(endpoint, async () => ({ close() {},
    estimateSfzEffectPreparation(_control, context) {
      queries.push(context.playerKind);
      return context.playerKind ? 2048 : 1024;
    } }));
  endpoint.onmessage({ data: { id: 1, type: 'module', module: {} } });
  await until(() => responses.length === 1);
  for (const playerKind of [0, 1]) endpoint.onmessage({ data: {
    id: playerKind + 2, type: 'estimate', control: new ArrayBuffer(64), payloadBytes: 64,
    context: { ...context, playerKind }, formatTag: 1
  } });
  await until(() => responses.length === 3);
  assert.deepEqual(queries, [0, 1]);
  assert.deepEqual(responses.map(response => response.bytes), [undefined, 1024, 2048]);
});

test('an explicit epoch cancellation remains cancellation, while failed module setup closes its cached worker', { timeout: 3000 }, async () => {
  const worker = new CostWorker(), cost = new SfzEffectCost({}, { workerFactory: () => worker });
  await cost.ready;
  const query = cost.estimate(payload(), context), cancelled = assert.rejects(query, { code: 'cancelled' });
  await drain(); cost.close(); await cancelled;
  assert.equal(cost.pending.size, 0);
  const failed = new CostWorker(); failed.postMessage = data => queueMicrotask(() => failed.onmessage({ data: { id: data.id, ok: false } }));
  const startup = new SfzEffectCost({}, { workerFactory: () => failed });
  await assert.rejects(startup.ready, { code: 'prepare' });
  assert.equal(startup.closed, true); assert.equal(failed.terminated, true);
});
