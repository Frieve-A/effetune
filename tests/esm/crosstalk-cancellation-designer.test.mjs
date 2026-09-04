import assert from 'node:assert/strict';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

import {
  createCrosstalkCancellationDesigner
} from '../../js/crosstalk-cancellation/designer.js';
import {
  designCrosstalkCancellation
} from '../../js/crosstalk-cancellation/design-core.js';
import {
  IR_ASSET_MAGIC,
  IR_ASSET_TOPOLOGY
} from '../../js/ir-library/ir-asset-payload.js';

class FakeWorker {
  constructor() {
    this.messages = [];
    this.terminateCount = 0;
    this.onmessage = null;
    this.onerror = null;
  }

  postMessage(message) {
    this.messages.push(message);
  }

  emit(message) {
    this.onmessage?.({ data: message });
  }

  terminate() {
    this.terminateCount += 1;
  }
}

function sources(sampleRate = 48000) {
  const source = (id, delay, gain) => {
    const data = new Float32Array(1024);
    data[delay] = gain;
    return {
      id,
      pointCount: 1,
      impulses: [{
        data,
        sampleRate,
        onsetIndex: delay,
        trimStartSamples: 0,
        outputTimeReference: 'audio-context'
      }]
    };
  };
  return {
    ll: source('left::ch=left', 144, 1),
    rl: source('left::ch=right', 158, 0.5),
    lr: source('right::ch=left', 181, 0.39),
    rr: source('right::ch=right', 165, 0.84)
  };
}

const baseConfig = {
  sampleRate: 48000,
  taps: 1024,
  regularization: 0,
  maxGainDb: 24,
  lowFrequency: 300,
  highFrequency: 6000,
  directWindowMs: 8
};

test('XTC designer rejects superseded requests, ignores stale results, and closes once', async () => {
  const worker = new FakeWorker();
  const designer = createCrosstalkCancellationDesigner({ workerFactory: () => worker });
  const first = designer.design(baseConfig, sources());
  const firstRejected = assert.rejects(first, error => error.code === 'design-superseded');
  const second = designer.design({ ...baseConfig, regularization: 10 }, sources());
  const [firstMessage, secondMessage] = worker.messages;
  worker.emit({ type: 'result', requestId: firstMessage.requestId, payload: 'stale' });
  worker.emit({ type: 'result', requestId: secondMessage.requestId, payload: 'current' });
  await firstRejected;
  assert.equal((await second).payload, 'current');

  const pending = designer.design(baseConfig, sources());
  designer.close();
  designer.close();
  await assert.rejects(pending, error => error.code === 'designer-closed');
  await assert.rejects(
    designer.design(baseConfig, sources()),
    error => error.code === 'designer-closed'
  );
  assert.equal(worker.terminateCount, 1);
});

test('XTC worker emits ETA1 trueStereo payload in strict [C11,C21,C12,C22] order', async () => {
  const workerUrl = new URL('../../js/crosstalk-cancellation/design-worker.js', import.meta.url);
  const bootstrap = `
const { parentPort } = require('node:worker_threads');
const queue = [];
let ready = false;
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
const deliver = message => globalThis.onmessage({ data: message });
parentPort.on('message', message => {
  if (ready) deliver(message);
  else queue.push(message);
});
import(${JSON.stringify(workerUrl.href)}).then(() => {
  ready = true;
  while (queue.length) deliver(queue.shift());
}).catch(error => parentPort.postMessage({
  type: 'error',
  requestId: 1,
  message: error && error.stack ? error.stack : String(error)
}));
`;
  const workers = [];
  const designer = createCrosstalkCancellationDesigner({
    workerFactory: () => {
      const worker = new Worker(bootstrap, { eval: true });
      workers.push(worker);
      const adapter = {
        onmessage: null,
        onerror: null,
        postMessage: message => worker.postMessage(message),
        terminate: () => worker.terminate()
      };
      worker.on('message', data => adapter.onmessage?.({ data }));
      worker.on('error', error => adapter.onerror?.({ error }));
      return adapter;
    }
  });

  try {
    const inputSources = sources();
    const direct = designCrosstalkCancellation({ config: baseConfig, sources: inputSources });
    const result = await designer.design(baseConfig, inputSources);
    assert.equal(result.type, 'result');
    assert.equal(result.config.filterDelaySamples, 512);
    const view = new DataView(result.payload);
    assert.equal(view.getUint32(0, true), IR_ASSET_MAGIC);
    assert.equal(view.getUint32(4, true), 4);
    assert.equal(view.getUint32(8, true), 1024);
    assert.equal(view.getUint32(12, true), 48000);
    assert.equal(view.getUint32(16, true), IR_ASSET_TOPOLOGY.trueStereo);
    let offset = 32;
    for (let channel = 0; channel < 4; channel += 1) {
      for (let frame = 0; frame < 1024; frame += 1) {
        assert.equal(view.getFloat32(offset, true), direct.channels[channel][frame]);
        offset += Float32Array.BYTES_PER_ELEMENT;
      }
    }
    const unsupported = sources();
    unsupported.ll.impulses[0].outputTimeReference = 'media-element';
    await assert.rejects(
      designer.design(baseConfig, unsupported),
      error => error.code === 'media-element-time-reference'
    );
  } finally {
    designer.close();
    await Promise.all(workers.map(worker => worker.terminate()));
  }
});
