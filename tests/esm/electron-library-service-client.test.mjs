import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createElectronLibraryServiceClient,
  ELECTRON_LIBRARY_SERVICE_API_VERSION,
  ElectronLibraryServiceClient
} from '../../js/library/operations/electron-library-service-client.js';

function createApi() {
  const calls = [];
  let eventListener = null;
  const api = {
    apiVersion: 1,
    async start(value) { calls.push(['start', value]); return { method: 'start', value }; },
    async lookupResult(value) { calls.push(['lookupResult', value]); return { method: 'lookupResult', value }; },
    async status(value) { calls.push(['status', value]); return { method: 'status', value }; },
    async cancel(value) { calls.push(['cancel', value]); return { method: 'cancel', value }; },
    onEvent(listener) {
      calls.push(['onEvent', listener]);
      eventListener = listener;
      return () => calls.push(['unsubscribe']);
    }
  };
  const playbackApi = {
    apiVersion: 1,
    async getProvisionalEntry(value) { calls.push(['getProvisionalEntry', value]); return { method: 'getProvisionalEntry', value }; },
    async commitTransportCommand(value) { calls.push(['commitTransportCommand', value]); return { method: 'commitTransportCommand', value }; },
    async getTransportState() { calls.push(['getTransportState']); return { method: 'getTransportState' }; },
    async applyTransportUndo(value) { calls.push(['applyTransportUndo', value]); return { method: 'applyTransportUndo', value }; },
    async readSequencePage(value) { calls.push(['readSequencePage', value]); return { method: 'readSequencePage', value }; },
    async resolveSequenceEntrySource(value) { calls.push(['resolveSequenceEntrySource', value]); return { method: 'resolveSequenceEntrySource', value }; }
  };
  return { api, playbackApi, calls, emit: event => eventListener?.(event) };
}

test('Electron LibraryService client keeps four durable verbs and a separate playback sequence API', async () => {
  const { api, playbackApi, calls } = createApi();
  const client = createElectronLibraryServiceClient({ api, playbackApi });
  assert.ok(client instanceof ElectronLibraryServiceClient);
  assert.equal(ELECTRON_LIBRARY_SERVICE_API_VERSION, 1);
  const request = { clientRequestId: 'request-1' };
  assert.deepEqual(await client.start(request), { method: 'start', value: request });
  assert.deepEqual(await client.lookupResult('request-1'), { method: 'lookupResult', value: 'request-1' });
  assert.deepEqual(await client.status('operation-1'), { method: 'status', value: 'operation-1' });
  assert.deepEqual(await client.cancel('operation-1'), { method: 'cancel', value: 'operation-1' });
  assert.deepEqual(await client.getProvisionalEntry('operation-1'), {
    method: 'getProvisionalEntry', value: 'operation-1'
  });
  assert.deepEqual(await client.commitTransportCommand({ expectedTransportVersion: 2, descriptor: {} }), {
    method: 'commitTransportCommand', value: { expectedTransportVersion: 2, descriptor: {} }
  });
  assert.deepEqual(await client.getTransportState(), { method: 'getTransportState' });
  assert.deepEqual(await client.applyTransportUndo({ undoId: 'transport:operation-1', expectedTransportVersion: 2 }), {
    method: 'applyTransportUndo', value: { undoId: 'transport:operation-1', expectedTransportVersion: 2 }
  });
  assert.deepEqual(await client.readSequencePage({ sequenceId: 'sequence-1', ordinal: 0, limit: 80 }), {
    method: 'readSequencePage',
    value: { sequenceId: 'sequence-1', ordinal: 0, limit: 80 }
  });
  assert.deepEqual(await client.resolveSequenceEntrySource({ trackUid: 'track-1' }), {
    method: 'resolveSequenceEntrySource',
    value: { trackUid: 'track-1' }
  });
  assert.deepEqual(calls.map(call => call[0]), [
    'start', 'lookupResult', 'status', 'cancel', 'getProvisionalEntry', 'commitTransportCommand', 'getTransportState',
    'applyTransportUndo',
    'readSequencePage', 'resolveSequenceEntrySource'
  ]);
});

test('operation subscriptions reject duplicate, out-of-order, foreign, and post-terminal events', () => {
  const { api, playbackApi, calls, emit } = createApi();
  const client = new ElectronLibraryServiceClient({ api, playbackApi });
  const accepted = [];
  const unsubscribe = client.subscribeOperation('operation-1', event => accepted.push(event));
  const progress = (operationId, sequence, processed) => ({
    kind: 'progress',
    progress: {
      operationId,
      sequence,
      phase: 'materializing',
      processed,
      total: 10,
      state: 'running'
    }
  });
  emit(progress('operation-2', 1, 1));
  emit(progress('operation-1', 2, 2));
  emit(progress('operation-1', 1, 1));
  emit(progress('operation-1', 2, 3));
  emit({ kind: 'terminal', operationId: 'operation-2', result: { state: 'succeeded' } });
  emit({ kind: 'terminal', operationId: 'operation-1', result: { state: 'succeeded' } });
  emit(progress('operation-1', 3, 3));
  emit({ kind: 'terminal', operationId: 'operation-1', result: { state: 'succeeded' } });
  assert.deepEqual(accepted.map(event => event.kind), ['progress', 'terminal']);
  assert.equal(accepted[0].progress.sequence, 2);
  unsubscribe();
  assert.equal(calls.at(-1)[0], 'unsubscribe');
});

test('Electron LibraryService client validates API and listener contracts', () => {
  assert.throws(() => new ElectronLibraryServiceClient({ api: null }), /API v1 is unavailable/);
  assert.throws(() => new ElectronLibraryServiceClient({ api: { apiVersion: 2 } }), /API v1 is unavailable/);
  const { api, playbackApi } = createApi();
  assert.throws(() => new ElectronLibraryServiceClient({ api, playbackApi: null }), /playback API v1 is unavailable/);
  const client = new ElectronLibraryServiceClient({ api, playbackApi });
  assert.throws(() => client.subscribeEvents(null), /must be a function/);
  assert.throws(() => client.subscribeOperation('operation', null), /must be a function/);
});
