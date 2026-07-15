import assert from 'node:assert/strict';
import test from 'node:test';

import { DurableLibraryService } from '../../js/library/operations/durable-library-service.js';

function createRequest(overrides = {}) {
  return {
    clientRequestId: 'request-1',
    operationKind: 'addToPlaylist',
    selectionDescriptor: {
      mode: 'all',
      contextToken: 'context-1',
      exclusions: []
    },
    target: { playlistId: 'playlist-1' },
    expectedTargetVersion: 3,
    options: {},
    ...overrides
  };
}

class FakeDurableRepository {
  constructor() {
    this.operations = new Map();
    this.byRequest = new Map();
    this.activeHeavy = null;
  }

  async receiveOperation(request) {
    const existingId = this.byRequest.get(request.clientRequestId);
    if (existingId) {
      const existing = this.operations.get(existingId);
      if (existing.requestDigest !== request.requestDigest) return { kind: 'requestIdReuse' };
      return existing.terminal
        ? { kind: 'terminal', result: existing.result }
        : { kind: 'active', operationId: existingId };
    }
    if (this.activeHeavy) return { kind: 'busy', activeOperationId: this.activeHeavy };
    const operationId = `operation-${this.operations.size + 1}`;
    this.byRequest.set(request.clientRequestId, operationId);
    this.operations.set(operationId, { ...request, operationId, progress: [], phase: 'RECEIVED' });
    this.activeHeavy = operationId;
    return { kind: 'created', operationId };
  }

  async getOperationStatus(operationId) {
    return this.operations.get(operationId) ?? null;
  }

  async requestOperationCancel(operationId) {
    const operation = this.operations.get(operationId);
    if (!operation || operation.terminal) return { kind: 'tooLate' };
    operation.phase = 'CANCEL_REQUESTED';
    return { kind: 'cancelRequested', operationId };
  }

  async transitionOperation(operationId, phase) {
    this.operations.get(operationId).phase = phase;
  }

  async recordOperationProgress(operationId, progress) {
    this.operations.get(operationId).progress.push(progress);
  }

  async completeOperation(operationId, result) {
    const operation = this.operations.get(operationId);
    operation.terminal = true;
    operation.result = result;
    this.activeHeavy = null;
  }
}

test('service starts one durable heavy operation and rejects a different invocation as busy', async () => {
  const repository = new FakeDurableRepository();
  let finish;
  const handlerWait = new Promise(resolve => { finish = resolve; });
  const service = new DurableLibraryService({
    repository,
    handlers: { addToPlaylist: async () => handlerWait }
  });

  const started = await service.start(createRequest());
  const busy = await service.start(createRequest({ clientRequestId: 'request-2' }));
  assert.deepEqual(started, { kind: 'started', operationId: 'operation-1' });
  assert.deepEqual(busy, { kind: 'busy', activeOperationId: 'operation-1' });
  finish({ playlistId: 'playlist-1' });
  await service.running.get('operation-1').task;
  assert.equal((await service.status('operation-1')).result.state, 'succeeded');
});

test('same client request joins only when the service-computed request digest matches', async () => {
  const repository = new FakeDurableRepository();
  let finish;
  const service = new DurableLibraryService({
    repository,
    handlers: { addToPlaylist: () => new Promise(resolve => { finish = resolve; }) }
  });
  const request = createRequest();
  const started = await service.start(request);

  assert.deepEqual(await service.start(request), { kind: 'active', operationId: started.operationId });
  assert.deepEqual(
    await service.start(createRequest({ options: { changed: true } })),
    { kind: 'requestIdReuse' }
  );
  finish({});
  await service.running.get(started.operationId).task;
  assert.equal((await service.status(started.operationId)).result.state, 'succeeded');
});

test('cancel aborts bounded work and stores one durable cancelled result', async () => {
  const repository = new FakeDurableRepository();
  const service = new DurableLibraryService({
    repository,
    handlers: {
      addToPlaylist: async ({ signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
    }
  });
  const started = await service.start(createRequest());
  assert.deepEqual(await service.cancel(started.operationId), {
    kind: 'cancelRequested',
    operationId: started.operationId
  });
  await service.running.get(started.operationId).task;
  const result = await service.status(started.operationId);
  assert.equal(result.result.state, 'cancelled');
  assert.deepEqual(await service.cancel(started.operationId), { kind: 'tooLate' });
});

test('service fails unavailable operation kinds durably without launching work', async () => {
  const repository = new FakeDurableRepository();
  const service = new DurableLibraryService({ repository });
  const result = await service.start(createRequest());

  assert.deepEqual(result, {
    kind: 'terminal',
    result: { state: 'failed', code: 'operationUnavailable' }
  });
  assert.equal((await service.status('operation-1')).result.code, 'operationUnavailable');
});

test('a handler that published its final CAS remains successful when cancellation becomes too late', async () => {
  const repository = new FakeDurableRepository();
  let releaseAfterPublish;
  const afterPublish = new Promise(resolve => { releaseAfterPublish = resolve; });
  const service = new DurableLibraryService({
    repository,
    handlers: {
      addToPlaylist: async ({ operationId }) => {
        repository.operations.get(operationId).terminal = true;
        repository.operations.get(operationId).result = { state: 'committing' };
        await afterPublish;
        return { committed: true, result: { playlistId: 'playlist-1' } };
      }
    }
  });
  const started = await service.start(createRequest());
  await Promise.resolve();
  assert.deepEqual(await service.cancel(started.operationId), { kind: 'tooLate' });
  releaseAfterPublish();
  await service.running.get(started.operationId).task;
  assert.deepEqual((await service.status(started.operationId)).result.result, {
    playlistId: 'playlist-1'
  });
});
