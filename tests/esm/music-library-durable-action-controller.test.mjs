import assert from 'node:assert/strict';
import test from 'node:test';

import { DurableActionController } from '../../js/ui/library/durable-action-controller.js';

function storageHarness() {
  const values = new Map();
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

test('durable action publishes receipt, progress, waiting, cancel, terminal, and retry state', async () => {
  let listener;
  let clock = 10_000;
  let waitingTick;
  let cancelled = null;
  let retries = 0;
  const storage = storageHarness();
  const states = [];
  const service = {
    subscribeLibraryOperation(_operationId, next) {
      listener = next;
      return () => { listener = null; };
    },
    async getLibraryOperationStatus(operationId) {
      return { operationId, phase: 'SNAPSHOTTING', progress: null, result: null };
    },
    async cancelLibraryOperation(operationId) {
      cancelled = operationId;
      return { kind: 'cancelRequested' };
    }
  };
  const controller = new DurableActionController({
    service,
    sessionStorage: storage,
    now: () => clock,
    setIntervalFn: callback => { waitingTick = callback; return 1; },
    clearIntervalFn() {},
    onStateChange: state => states.push(state)
  });

  await controller.track({
    clientRequestId: 'request-1',
    operationKind: 'addToPlaylist',
    targetName: 'Road trip',
    startResult: Promise.resolve({ kind: 'started', operationId: 'operation-1' }),
    startFactory: () => { retries += 1; }
  });
  assert.equal(controller.state.status, 'active');
  assert.equal(controller.state.phase, 'SNAPSHOTTING');
  assert.match(storage.getItem('effetune.library.pendingOperations.v1'), /request-1/);

  listener({
    kind: 'progress',
    progress: { operationId: 'operation-1', phase: 'materializing', processed: 500, total: 1_000 }
  });
  assert.equal(controller.state.processed, 500);
  clock += 5_001;
  waitingTick();
  assert.equal(controller.state.status, 'waiting');

  await controller.cancel();
  assert.equal(cancelled, 'operation-1');
  listener({
    kind: 'terminal',
    operationId: 'operation-1',
    result: { state: 'interrupted', code: 'serviceRestart' }
  });
  assert.equal(controller.state.status, 'terminal');
  assert.equal(controller.state.retryAvailable, true);
  assert.equal(storage.getItem('effetune.library.pendingOperations.v1'), '[]');
  await controller.retry();
  assert.equal(retries, 1);
  assert.ok(states.some(state => state.status === 'starting'));
  assert.ok(states.some(state => state.status === 'waiting'));
});

test('recovery joins an active durable operation and a terminal receipt is not restarted', async () => {
  const storage = storageHarness();
  storage.setItem('effetune.library.pendingOperations.v1', JSON.stringify(['request-active']));
  let subscribed = null;
  const active = new DurableActionController({
    service: {
      async lookupLibraryOperation(clientRequestId) {
        assert.equal(clientRequestId, 'request-active');
        return { kind: 'active', operationId: 'operation-active' };
      },
      subscribeLibraryOperation(operationId) {
        subscribed = operationId;
        return () => {};
      },
      async getLibraryOperationStatus(operationId) {
        return { operationId, phase: 'READY', progress: null, result: null };
      }
    },
    sessionStorage: storage,
    setIntervalFn: () => 1,
    clearIntervalFn() {}
  });
  assert.equal((await active.recover()).kind, 'active');
  assert.equal(subscribed, 'operation-active');
  assert.equal(active.state.phase, 'READY');
  active.close();

  const terminal = new DurableActionController({ service: {}, sessionStorage: storage });
  await terminal.track({
    clientRequestId: 'terminal-request',
    operationKind: 'queue',
    startResult: Promise.resolve({
      kind: 'terminal',
      operationId: 'terminal-operation',
      result: { state: 'succeeded', itemCount: 1_000_000 }
    })
  });
  assert.equal(terminal.state.terminalKind, 'succeeded');
  assert.equal(terminal.state.retryAvailable, false);
});

test('cancelled provisional Play exposes one explicit durable Undo action', async () => {
  let undoRequest = null;
  const controller = new DurableActionController({
    service: {
      async undoCancelledPlay(request) {
        undoRequest = request;
        return {
          kind: 'published',
          transportVersion: 8,
          descriptor: { segments: [{ sequenceId: 'previous', startOrdinal: 0, endOrdinal: 1 }], currentOrdinal: 0 }
        };
      }
    }
  });
  await controller.track({
    clientRequestId: 'cancelled-play',
    operationKind: 'play',
    startResult: Promise.resolve({
      kind: 'terminal',
      operationId: 'play-operation',
      result: {
        state: 'cancelled', operationKind: 'play', undoId: 'transport:play-operation',
        undoExpiresAt: 60_000, transportVersion: 7
      }
    })
  });
  assert.equal(controller.state.canUndo, true);
  assert.deepEqual((await controller.undo()).kind, 'published');
  assert.deepEqual(undoRequest, {
    undoId: 'transport:play-operation', expectedTransportVersion: 7
  });
  assert.equal(controller.state.canUndo, false);
  assert.equal(controller.state.undoApplied, true);
});
