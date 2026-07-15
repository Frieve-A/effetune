import assert from 'node:assert/strict';
import test from 'node:test';

import { DurableActionController } from '../../js/ui/library/durable-action-controller.js';

test('session action publishes progress, waiting, cancellation, and terminal state', async () => {
  let listener;
  let clock = 10_000;
  let waitingTick;
  let cancelled = null;
  const states = [];
  const controller = new DurableActionController({
    service: {
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
    },
    now: () => clock,
    setIntervalFn: callback => { waitingTick = callback; return 1; },
    clearIntervalFn() {},
    onStateChange: state => states.push(state)
  });

  await controller.track({
    clientRequestId: 'request-1',
    operationKind: 'addToPlaylist',
    targetName: 'Road trip',
    start: () => Promise.resolve({ kind: 'started', operationId: 'operation-1' })
  });
  assert.equal(controller.state.status, 'active');
  assert.equal(controller.state.phase, 'SNAPSHOTTING');
  assert.equal(controller.state.clientRequestId, 'request-1');

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
  assert.equal(controller.state.retryAvailable, false);
  assert.equal(controller.recover, undefined);
  assert.equal(controller.retry, undefined);
  assert.ok(states.some(state => state.status === 'starting'));
  assert.ok(states.some(state => state.status === 'waiting'));
});

test('playback action does not retain its obsolete client request ID or persistent Undo metadata', async () => {
  const controller = new DurableActionController({ service: {} });
  await controller.track({
    clientRequestId: 'obsolete-playback-id',
    operationKind: 'play',
    start: () => Promise.resolve({
      kind: 'terminal',
      operationId: 'play-operation',
      result: {
        state: 'cancelled',
        operationKind: 'play',
        undoId: 'obsolete-undo',
        undoExpiresAt: 60_000,
        transportVersion: 7
      }
    })
  });

  assert.equal(controller.state.terminalKind, 'cancelled');
  assert.equal(Object.hasOwn(controller.state, 'clientRequestId'), false);
  assert.equal(controller.state.canUndo, false);
  assert.equal(Object.hasOwn(controller.state, 'undoId'), false);
  assert.equal(Object.hasOwn(controller.state, 'transportVersion'), false);
});

test('successful Play replacement exposes one renderer-session Undo', async () => {
  let available = true;
  let undoCalls = 0;
  const controller = new DurableActionController({
    service: {
      canUndoPlaybackSession() { return available; },
      async undoPlaybackSession() {
        undoCalls += 1;
        available = false;
        return { kind: 'published' };
      }
    }
  });
  await controller.track({
    operationKind: 'play',
    start: () => Promise.resolve({
      kind: 'terminal',
      operationId: 'play-operation',
      result: {
        operationKind: 'play',
        destination: 'replace',
        sequenceId: 'sequence-1',
        itemCount: 3,
        firstOrdinal: 0,
        firstEntry: { entryInstanceId: 'entry-1', trackUid: 'track-1' }
      }
    })
  });

  assert.equal(controller.state.canUndo, true);
  assert.deepEqual(await controller.undo(), { kind: 'published' });
  assert.equal(undoCalls, 1);
  assert.equal(controller.state.canUndo, false);
  assert.equal(controller.state.undoApplied, true);
  assert.deepEqual(await controller.undo(), { kind: 'notAvailable' });
});

test('track claims busy state before invoking a second operation factory', async () => {
  let resolveFirst;
  let secondStarts = 0;
  const firstReceipt = new Promise(resolve => { resolveFirst = resolve; });
  const controller = new DurableActionController({ service: {} });

  const first = controller.track({
    clientRequestId: 'first-request',
    operationKind: 'queue',
    start: () => firstReceipt
  });
  const second = await controller.track({
    clientRequestId: 'second-request',
    operationKind: 'queue',
    start: () => {
      secondStarts += 1;
      return Promise.resolve({ kind: 'terminal', result: { state: 'succeeded' } });
    }
  });

  assert.deepEqual(second, { kind: 'busy' });
  assert.equal(secondStarts, 0);
  resolveFirst({ kind: 'terminal', result: { state: 'succeeded' } });
  await first;
});

test('terminal notification owns and cleans up its subscription while status is pending', async () => {
  let listener;
  let resolveStatus;
  let unsubscribeCount = 0;
  const status = new Promise(resolve => { resolveStatus = resolve; });
  const controller = new DurableActionController({
    service: {
      subscribeLibraryOperation(_operationId, next) {
        listener = next;
        return () => { unsubscribeCount += 1; };
      },
      getLibraryOperationStatus() {
        return status;
      }
    }
  });

  const tracked = controller.track({
    clientRequestId: 'subscription-request',
    operationKind: 'importPlaylist',
    start: () => Promise.resolve({ kind: 'started', operationId: 'subscription-operation' })
  });
  await Promise.resolve();
  await Promise.resolve();
  listener({
    kind: 'terminal',
    operationId: 'subscription-operation',
    result: { state: 'succeeded' }
  });
  resolveStatus({
    operationId: 'subscription-operation',
    phase: 'MATERIALIZING',
    progress: { phase: 'MATERIALIZING', processed: 1, total: 2 }
  });
  await tracked;

  assert.equal(controller.state.status, 'terminal');
  assert.equal(controller.state.terminalKind, 'succeeded');
  assert.equal(unsubscribeCount, 1);
});
