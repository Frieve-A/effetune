import assert from 'node:assert/strict';
import test from 'node:test';

import { WebCatalogRepositoryClient } from '../../js/library/repository/web-catalog-client.js';
import {
  installWebCatalogWorker,
  WEB_CATALOG_MAX_MESSAGE_BYTES,
  WEB_CATALOG_WORKER_PROTOCOL_VERSION
} from '../../js/library/repository/web-catalog-worker.js';

function createWorkerScope() {
  const listeners = new Set();
  const messages = [];
  return {
    messages,
    addEventListener(type, listener) {
      if (type === 'message') listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === 'message') listeners.delete(listener);
    },
    postMessage(message) {
      messages.push(message);
    },
    dispatch(data) {
      for (const listener of listeners) listener({ data });
    }
  };
}

test('Worker protocol accepts only versioned bounded method requests and forwards invalidations', async () => {
  const scope = createWorkerScope();
  let invalidationListener;
  let closed = false;
  const repository = {
    async open(options) { return { mode: options.mode }; },
    subscribeInvalidations(listener) {
      invalidationListener = listener;
      return () => { invalidationListener = null; };
    },
    close() { closed = true; }
  };
  const uninstall = installWebCatalogWorker(scope, { repository });
  scope.dispatch({ protocolVersion: 99, requestId: 'bad', method: 'open', args: [] });
  assert.equal(scope.messages.at(-1).error.code, 'invalidWorkerRequest');

  scope.dispatch({
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'oversized',
    method: 'open',
    args: [{ padding: 'x'.repeat(WEB_CATALOG_MAX_MESSAGE_BYTES) }]
  });
  assert.equal(scope.messages.at(-1).error.code, 'requestTooLarge');

  scope.dispatch({
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'open-1',
    method: 'open',
    args: [{ mode: 'readwrite' }]
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(scope.messages.at(-1), {
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'open-1',
    ok: true,
    result: { mode: 'readwrite' }
  });
  invalidationListener({ catalogVersion: 1, changedScopes: ['tracks'] });
  assert.equal(scope.messages.at(-1).type, 'invalidation');
  uninstall();
  assert.equal(closed, true);
});

test('Worker exposes only the durable operation controls and bounded sequence access', async () => {
  const scope = createWorkerScope();
  const calls = [];
  const serviceCoordinator = Object.fromEntries([
    ['start', { state: 'accepted' }],
    ['lookupResult', { state: 'running' }],
    ['status', { phase: 'SNAPSHOTTING' }],
    ['cancel', { state: 'cancelRequested' }],
    ['readSequencePage', { items: [], nextCursor: null }],
    ['resolveSequenceEntrySource', { name: 'track.flac' }]
  ].map(([method, result]) => [method, async (...args) => {
    calls.push([method, args]);
    return result;
  }]));
  serviceCoordinator.close = () => {};
  const repository = { close() {} };
  const uninstall = installWebCatalogWorker(scope, { repository, serviceCoordinator });
  const requests = [
    ['startOperation', [{ operationType: 'queue' }]],
    ['lookupOperationResult', ['request-1']],
    ['getOperationStatus', ['operation-1']],
    ['cancelOperation', ['operation-1']],
    ['readSequencePage', [{ sequenceId: 'sequence-1', limit: 25 }]],
    ['resolveSequenceEntrySource', [{ sequenceId: 'sequence-1', ordinal: 0 }]]
  ];
  for (const [index, [method, args]] of requests.entries()) {
    scope.dispatch({
      protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
      requestId: `service-${index}`,
      method,
      args
    });
  }
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls.map(([method]) => method), [
    'start',
    'lookupResult',
    'status',
    'cancel',
    'readSequencePage',
    'resolveSequenceEntrySource'
  ]);
  assert.equal(scope.messages.filter(message => message.ok).length, requests.length);

  for (const method of ['completeOperation', 'appendPlaylistItems', 'publishPlaylist']) {
    scope.dispatch({
      protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
      requestId: `raw-mutation-${method}`,
      method,
      args: []
    });
    assert.equal(scope.messages.at(-1).error.code, 'invalidWorkerRequest');
  }
  uninstall();
});

test('Worker replaces an oversized repository response with a bounded typed error', async () => {
  const scope = createWorkerScope();
  const repository = {
    async getTrack() { return { title: 'x'.repeat(WEB_CATALOG_MAX_MESSAGE_BYTES) }; },
    close() {}
  };
  const uninstall = installWebCatalogWorker(scope, { repository });
  scope.dispatch({
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    requestId: 'large-response',
    method: 'getTrack',
    args: ['track-1']
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(scope.messages.at(-1).error.code, 'responseTooLarge');
  uninstall();
});

class FakeWorker {
  constructor() {
    this.listeners = { message: new Set(), error: new Set() };
    this.terminated = false;
    this.messages = [];
  }

  addEventListener(type, listener) {
    this.listeners[type].add(listener);
  }

  postMessage(message) {
    this.messages.push(message);
    queueMicrotask(() => {
      const response = message.method === 'getCounts'
        ? { tracks: 3 }
        : null;
      this.emit('message', {
        protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
        requestId: message.requestId,
        ok: true,
        result: response
      });
    });
  }

  emit(type, data) {
    for (const listener of this.listeners[type]) listener({ data });
  }

  terminate() {
    this.terminated = true;
  }
}

test('client uses the dedicated Worker protocol and relays invalidation messages', async () => {
  const worker = new FakeWorker();
  const client = new WebCatalogRepositoryClient({ worker });
  assert.equal(client.appendPlaylistItems, undefined);
  assert.equal(client.publishPlaylist, undefined);
  assert.deepEqual(await client.getCounts(), { tracks: 3 });
  const invalidations = [];
  client.subscribeInvalidations(event => invalidations.push(event));
  worker.emit('message', {
    protocolVersion: WEB_CATALOG_WORKER_PROTOCOL_VERSION,
    type: 'invalidation',
    invalidation: { catalogVersion: 4, changedScopes: ['tracks'] }
  });
  assert.deepEqual(invalidations, [{ catalogVersion: 4, changedScopes: ['tracks'] }]);
  await assert.rejects(
    client.getTrack('x'.repeat(WEB_CATALOG_MAX_MESSAGE_BYTES)),
    error => error.code === 'requestTooLarge'
  );
  assert.equal(worker.messages.length, 1);
  await client.close();
  assert.equal(worker.terminated, true);
});
