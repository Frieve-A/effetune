import assert from 'node:assert/strict';
import test from 'node:test';

import {
  digestBulkOperationRequest,
  OperationProgressFence,
  validateBulkOperationStart
} from '../../js/library/operations/bulk-operation-protocol.js';

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
    expectedTargetVersion: 4,
    options: { append: true },
    ...overrides
  };
}

test('bulk operation digest is service-computed from canonical request content', async () => {
  const first = await digestBulkOperationRequest(createRequest({
    target: { playlistId: 'playlist-1', secondary: false }
  }));
  const second = await digestBulkOperationRequest(createRequest({
    target: { secondary: false, playlistId: 'playlist-1' }
  }));

  assert.equal(first.requestDigest, second.requestDigest);
  assert.match(first.requestDigest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.canonical.canonicalRequestVersion, 1);
});

test('bulk operation validation rejects caller digests and unknown request fields', () => {
  assert.throws(
    () => validateBulkOperationStart({ ...createRequest(), requestDigest: 'caller-owned' }),
    error => error?.code === 'invalidOperationRequest'
  );
  assert.throws(
    () => validateBulkOperationStart(createRequest({ operationKind: 'unknown' })),
    error => error?.code === 'invalidOperationKind'
  );
});

test('bulk operation validation preserves compact all selection without materializing IDs', () => {
  const request = validateBulkOperationStart(createRequest());
  assert.deepEqual(request.selectionDescriptor, {
    mode: 'all',
    contextToken: 'context-1',
    exclusions: []
  });
  assert.equal(Object.hasOwn(request.selectionDescriptor, 'trackUids'), false);
});

test('sequence-backed playlist save accepts no catalog context and rejects segment overflow before admission', () => {
  const segment = { sequenceId: 'sequence-1', startOrdinal: 0, endOrdinal: 1_000_000 };
  const request = validateBulkOperationStart(createRequest({
    selectionDescriptor: null,
    options: {
      saveId: 'save-1',
      name: 'Queue',
      sourceSequenceDescriptor: { segments: [segment] }
    }
  }));
  assert.equal(request.selectionDescriptor, null);
  assert.deepEqual(request.options.sourceSequenceDescriptor.segments, [segment]);

  assert.throws(() => validateBulkOperationStart(createRequest({
    selectionDescriptor: null,
    options: {
      saveId: 'save-overflow',
      name: 'Overflow',
      sourceSequenceDescriptor: {
        segments: Array.from({ length: 257 }, (_, index) => ({
          sequenceId: `sequence-${index}`,
          startOrdinal: 0,
          endOrdinal: 1
        }))
      }
    }
  })), error => error?.code === 'sequenceSegmentLimitExceeded');
});

test('playlist import digests bounded File metadata while retaining only the runtime source', async () => {
  const file = {
    name: 'list.m3u8',
    size: 1234,
    lastModified: 5678,
    type: 'audio/x-mpegurl',
    stream() { return null; }
  };
  const request = {
    clientRequestId: 'import-1',
    operationKind: 'importPlaylist',
    selectionDescriptor: null,
    target: { playlistId: 'playlist-import' },
    expectedTargetVersion: 0,
    options: { name: 'Imported', source: file, encoding: null, limits: null }
  };
  const digested = await digestBulkOperationRequest(request);

  assert.deepEqual(digested.canonical.options.source, {
    kind: 'web-file',
    name: 'list.m3u8',
    size: 1234,
    lastModified: 5678,
    type: 'audio/x-mpegurl'
  });
  assert.equal(digested.runtime.source, file);
  assert.equal(Object.hasOwn(digested.canonical.options.source, 'stream'), false);
  assert.throws(
    () => validateBulkOperationStart({ ...request, selectionDescriptor: { mode: 'explicit', contextToken: 'context-1', trackUids: [] } }),
    error => error?.code === 'invalidOperationRequest'
  );
});

test('playlist import accepts only the exact opaque Electron grant descriptor', async () => {
  const source = {
    kind: 'electron-import-grant',
    token: 'playlist_import_token',
    name: 'list.m3u8',
    size: 1234,
    lastModified: 5678,
    type: ''
  };
  const request = {
    clientRequestId: 'import-electron',
    operationKind: 'importPlaylist',
    selectionDescriptor: null,
    target: { playlistId: 'playlist-import' },
    expectedTargetVersion: 0,
    options: { name: 'Imported', source, encoding: null, limits: null }
  };
  const digested = await digestBulkOperationRequest(request);
  assert.deepEqual(digested.canonical.options.source, source);
  assert.equal(digested.runtime.source, source);
  assert.throws(
    () => validateBulkOperationStart({
      ...request,
      options: { ...request.options, source: { ...source, path: 'C:\\Music\\list.m3u8' } }
    }),
    error => error?.code === 'invalidOperationRequest'
  );
});

test('progress fence rejects duplicate, late, foreign, and post-terminal events', () => {
  const fence = new OperationProgressFence('operation-1');
  assert.equal(fence.accept({
    operationId: 'other', sequence: 0, phase: 'received', state: 'received', processed: 0, total: null
  }), false);
  assert.equal(fence.accept({
    operationId: 'operation-1', sequence: 0, phase: 'materializing', state: 'running', processed: 10, total: 100
  }), true);
  assert.equal(fence.accept({
    operationId: 'operation-1', sequence: 0, phase: 'materializing', state: 'running', processed: 20, total: 100
  }), false);
  assert.equal(fence.accept({
    operationId: 'operation-1', sequence: 1, phase: 'terminal', state: 'succeeded', processed: 100, total: 100
  }), true);
  assert.equal(fence.terminal, true);
  assert.equal(fence.accept({
    operationId: 'operation-1', sequence: 2, phase: 'materializing', state: 'running', processed: 100, total: 100
  }), false);
});
