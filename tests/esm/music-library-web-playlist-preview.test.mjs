import assert from 'node:assert/strict';
import test from 'node:test';

import { WebLibraryServiceCoordinator } from '../../js/library/operations/web-library-service-coordinator.js';

function createRepository() {
  let operationSequence = 0;
  const operations = new Map();
  const calls = [];
  return {
    calls,
    async queryTracks() { return { rows: [] }; },
    async receiveOperation(request) {
      const operationId = `operation-${++operationSequence}`;
      operations.set(operationId, { phase: 'RECEIVED', request });
      calls.push(['receive', request.operationKind]);
      return { kind: 'created', operationId };
    },
    async getOperationStatus() { return null; },
    async requestOperationCancel() { return { kind: 'cancelRequested' }; },
    async transitionOperation(operationId, phase) {
      operations.get(operationId).phase = phase;
      calls.push(['transition', operationId, phase]);
      return { kind: 'transitioned' };
    },
    async recordOperationProgress() { return { kind: 'recorded' }; },
    async completeOperation(operationId, result) {
      operations.get(operationId).terminal = result;
      calls.push(['complete', operationId, result.state]);
      return { kind: 'terminal', result };
    },
    async createPlaylist(request) {
      calls.push(['create', request.playlistId, request.operationId]);
      return { kind: 'created', state: 'building' };
    },
    async appendPlaylistImportRecords(request) {
      calls.push(['append', request.records.length, request.origin]);
      return { kind: 'staged' };
    },
    async finalizePlaylistImportPage() {
      return {
        processedCount: 2,
        keptCount: 2,
        resolvedCount: 1,
        unresolvedItems: [{ label: 'Missing.flac' }],
        nextPosition: null
      };
    },
    async publishPlaylist(request) {
      calls.push(['publish', request.playlistId]);
      return { kind: 'published', playlistId: request.playlistId, version: 1 };
    }
  };
}

test('Web manual playlist import stages a bounded preview before explicit publish', async () => {
  const repository = createRepository();
  let id = 0;
  const coordinator = new WebLibraryServiceCoordinator({
    repository,
    idFactory: () => `id-${++id}`,
    now: () => 1_000
  });
  const source = {
    name: 'Preview.m3u8',
    size: 48,
    lastModified: 1,
    type: 'audio/x-mpegurl',
    stream: () => (async function* chunks() {
      yield new TextEncoder().encode('#EXTM3U\nAlbum/Track.flac\nMissing.flac\n');
    })()
  };
  const preview = await coordinator.previewPlaylistImport({
    clientRequestId: 'preview-request',
    playlistId: 'preview-playlist',
    name: 'Preview',
    source,
    encoding: null,
    limits: null
  });

  assert.deepEqual({
    playlistName: preview.playlistName,
    totalCount: preview.totalCount,
    resolvedCount: preview.resolvedCount,
    unresolvedCount: preview.unresolvedCount,
    unresolvedItems: preview.unresolvedItems
  }, {
    playlistName: 'Preview',
    totalCount: 2,
    resolvedCount: 1,
    unresolvedCount: 1,
    unresolvedItems: [{ label: 'Missing.flac' }]
  });
  assert.equal(repository.calls.some(call => call[0] === 'publish'), false);
  assert.ok(repository.calls.filter(call => call[0] === 'append').every(call => call[2] === null));

  const result = await coordinator.commitPlaylistImportPreview({
    previewToken: preview.previewToken,
    playlistId: preview.playlistId
  });
  assert.deepEqual(result, {
    playlistId: 'preview-playlist',
    version: 1,
    itemCount: 2,
    resolvedCount: 1,
    unresolvedCount: 1
  });
  assert.deepEqual(await coordinator.commitPlaylistImportPreview({
    previewToken: preview.previewToken,
    playlistId: preview.playlistId
  }), result);
  assert.equal(repository.calls.filter(call => call[0] === 'publish').length, 1);

  const cancelled = await coordinator.previewPlaylistImport({
    clientRequestId: 'cancel-request',
    playlistId: 'cancel-playlist',
    name: 'Cancel',
    source,
    encoding: null,
    limits: null
  });
  assert.deepEqual(await coordinator.cancelPlaylistImportPreview({
    previewToken: cancelled.previewToken,
    playlistId: cancelled.playlistId
  }), { kind: 'cancelled' });
  assert.equal(repository.calls.some(call =>
    call[0] === 'complete' && call[1] === 'operation-2' && call[2] === 'cancelled'
  ), true);
  coordinator.close();
});

test('Web playback builds a TEMP sequence directly and tracks the operation in session memory', async () => {
  const calls = [];
  const repository = {
    async retainContext(contextToken) {
      calls.push(['retainContext', contextToken]);
      return { retained: true };
    },
    async releaseRetainedContext(contextToken) {
      calls.push(['releaseRetainedContext', contextToken]);
      return { released: true };
    },
    async queryTracks() { return { rows: [] }; },
    async readContextPage({ cursor }) {
      return cursor === null
        ? {
            catalogVersion: 7,
            rows: [{ trackUid: 'track-1' }, { trackUid: 'track-2' }],
            nextCursor: 'page-2'
          }
        : {
            catalogVersion: 7,
            rows: [{
              trackUid: 'track-3',
              title: 'CUE Track',
              artist: 'Track Artist',
              albumArtist: 'Album Artist',
              album: 'CUE Album',
              artworkId: 'cue-artwork'
            }],
            nextCursor: null
          };
    },
    async createPlaybackSequence(request) {
      calls.push(['createSequence', request]);
      return { sequenceId: request.sequenceId, state: 'building' };
    },
    async appendPlaybackSequenceItems(request) {
      calls.push(['appendSequence', request]);
      return { appendedCount: request.items.length };
    },
    async sealPlaybackSequence(request) {
      calls.push(['sealSequence', request]);
      return { sequenceId: request.sequenceId, state: 'active' };
    },
    async receiveOperation() { throw new Error('playback must not enter the durable ledger'); },
    async getOperationStatus() { return null; },
    async requestOperationCancel() { return { kind: 'tooLate' }; },
    async transitionOperation() {},
    async recordOperationProgress() { return { kind: 'recorded' }; },
    async completeOperation() { return { kind: 'terminal' }; }
  };
  let id = 0;
  const events = [];
  const coordinator = new WebLibraryServiceCoordinator({
    repository,
    idFactory: () => `session-${++id}`,
    now: () => 1_000,
    onEvent: event => events.push(event)
  });

  const receipt = await coordinator.start({
    operationKind: 'play',
    selectionDescriptor: {
      mode: 'all', contextToken: 'context-1', exclusions: ['track-2']
    },
    target: { transport: 'main' },
    options: { currentOrdinal: 1, seed: 11 }
  });
  const provisional = await coordinator.getProvisionalEntry(receipt.operationId);
  const status = await coordinator.waitForTerminal(receipt.operationId);

  assert.deepEqual(provisional, {
    ordinal: 1,
    entryInstanceId: provisional.entryInstanceId,
    trackUid: 'track-3',
    title: 'CUE Track',
    artist: 'Track Artist',
    albumArtist: 'Album Artist',
    album: 'CUE Album',
    artworkId: 'cue-artwork'
  });
  assert.equal(status.result.state, 'succeeded');
  assert.deepEqual(status.result.result.firstEntry, provisional);
  assert.deepEqual(calls[0], ['retainContext', 'context-1']);
  assert.deepEqual(Object.keys(calls[1][1]).sort(), [
    'catalogVersion', 'createdAt', 'seed', 'sequenceId', 'sourceContext'
  ]);
  assert.deepEqual(
    calls.filter(call => call[0] === 'appendSequence').flatMap(call => call[1].items)
      .map(item => [item.ordinal, item.trackUid]),
    [[0, 'track-1'], [1, 'track-3']]
  );
  assert.deepEqual(calls.slice(-2).map(call => call[0]), ['sealSequence', 'releaseRetainedContext']);
  assert.ok(events.some(event => event.kind === 'terminal'));
  coordinator.close();
});

test('Web session playback bounds terminal status and provisional handoffs without evicting active work', async () => {
  const gates = new Map();
  const repository = {
    async retainContext() { return { retained: true }; },
    async releaseRetainedContext() { return { released: true }; },
    async queryTracks() { return { rows: [] }; },
    async readContextPage({ contextToken }) {
      if (contextToken.startsWith('hold-')) {
        await new Promise(resolve => gates.set(contextToken, resolve));
      }
      return {
        catalogVersion: 1,
        rows: [{ trackUid: `track-${contextToken}` }],
        nextCursor: null
      };
    },
    async createPlaybackSequence() { return { state: 'building' }; },
    async appendPlaybackSequenceItems(request) { return { appendedCount: request.items.length }; },
    async sealPlaybackSequence() { return { state: 'active' }; },
    async getOperationStatus() { return null; },
    async requestOperationCancel() { return { kind: 'tooLate' }; },
    async receiveOperation() { throw new Error('playback must remain session-only'); },
    async transitionOperation() {},
    async recordOperationProgress() { return { kind: 'recorded' }; },
    async completeOperation() { return { kind: 'terminal' }; }
  };
  let id = 0;
  const terminalEvents = [];
  const coordinator = new WebLibraryServiceCoordinator({
    repository,
    idFactory: () => `bounded-${++id}`,
    now: (() => { let value = 0; return () => ++value; })(),
    onEvent: event => {
      if (event.kind === 'terminal') terminalEvents.push(event.operationId);
    }
  });
  const start = contextToken => coordinator.start({
    operationKind: 'play',
    selectionDescriptor: { mode: 'all', contextToken, exclusions: [] },
    target: { transport: 'main' },
    options: { currentOrdinal: 0 }
  });

  let firstTerminalId;
  let latestTerminalId;
  for (let index = 0; index < 130; index += 1) {
    const receipt = await start(`terminal-${index}`);
    firstTerminalId ??= receipt.operationId;
    latestTerminalId = receipt.operationId;
    await coordinator.waitForTerminal(receipt.operationId);
  }
  assert.equal(coordinator.playbackOperations.size, 128);
  assert.equal(coordinator.provisionals.size, 128);
  assert.equal(await coordinator.status(firstTerminalId), null);
  assert.equal((await coordinator.status(latestTerminalId)).result.state, 'succeeded');
  assert.equal((await coordinator.getProvisionalEntry(latestTerminalId)).ordinal, 0);

  const active = [];
  terminalEvents.length = 0;
  for (let index = 0; index < 129; index += 1) active.push(await start(`hold-${index}`));
  assert.equal(
    [...coordinator.playbackOperations.values()].filter(operation => operation.finishedAt === null).length,
    129
  );
  assert.notEqual(await coordinator.status(active[0].operationId), null);
  const terminalPromises = active.map(receipt => coordinator.waitForTerminal(receipt.operationId));
  for (const resolve of gates.values()) resolve();
  await Promise.all(terminalPromises);
  assert.equal(coordinator.playbackOperations.size, 128);
  const latestActiveTerminalId = terminalEvents.at(-1);
  assert.equal((await coordinator.status(latestActiveTerminalId)).result.state, 'succeeded');
  coordinator.close();
});
