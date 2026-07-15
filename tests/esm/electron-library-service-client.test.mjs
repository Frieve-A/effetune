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
    async status(value) { calls.push(['status', value]); return { method: 'status', value }; },
    async cancel(value) { calls.push(['cancel', value]); return { method: 'cancel', value }; },
    async previewPlaylistImport(value) { calls.push(['previewPlaylistImport', value]); return { method: 'previewPlaylistImport', value }; },
    async commitPlaylistImportPreview(value) { calls.push(['commitPlaylistImportPreview', value]); return { method: 'commitPlaylistImportPreview', value }; },
    async cancelPlaylistImportPreview(value) { calls.push(['cancelPlaylistImportPreview', value]); return { method: 'cancelPlaylistImportPreview', value }; },
    onEvent(listener) {
      calls.push(['onEvent', listener]);
      eventListener = listener;
      return () => calls.push(['unsubscribe']);
    }
  };
  const playbackApi = {
    apiVersion: 1,
    async getProvisionalEntry(value) { calls.push(['getProvisionalEntry', value]); return { method: 'getProvisionalEntry', value }; },
    async readSequencePage(value) { calls.push(['readSequencePage', value]); return { method: 'readSequencePage', value }; },
    async resolveSequenceEntrySource(value) {
      calls.push(['resolveSequenceEntrySource', value]);
      return {
        kind: 'electron-file',
        trackUid: value.trackUid,
        folderId: 'folder-1',
        lifecycleVersion: 3,
        fileName: 'Track.flac',
        path: 'C:\\Music\\Track.flac'
      };
    },
  };
  return { api, playbackApi, calls, emit: event => eventListener?.(event) };
}

test('Electron LibraryService client keeps session operation verbs and playback sequence reads', async () => {
  const { api, playbackApi, calls } = createApi();
  const client = createElectronLibraryServiceClient({ api, playbackApi });
  assert.ok(client instanceof ElectronLibraryServiceClient);
  assert.equal(ELECTRON_LIBRARY_SERVICE_API_VERSION, 1);
  const request = { clientRequestId: 'request-1' };
  assert.deepEqual(await client.start(request), { method: 'start', value: request });
  assert.deepEqual(await client.status('operation-1'), { method: 'status', value: 'operation-1' });
  assert.deepEqual(await client.cancel('operation-1'), { method: 'cancel', value: 'operation-1' });
  const previewRequest = { source: { kind: 'electron-import-grant' } };
  assert.deepEqual(await client.previewPlaylistImport(previewRequest), {
    method: 'previewPlaylistImport', value: previewRequest
  });
  const previewIdentity = { previewToken: 'preview-1', playlistId: 'playlist-1' };
  assert.deepEqual(await client.commitPlaylistImportPreview(previewIdentity), {
    method: 'commitPlaylistImportPreview', value: previewIdentity
  });
  assert.deepEqual(await client.cancelPlaylistImportPreview(previewIdentity), {
    method: 'cancelPlaylistImportPreview', value: previewIdentity
  });
  assert.deepEqual(await client.getProvisionalEntry('operation-1'), {
    method: 'getProvisionalEntry', value: 'operation-1'
  });
  assert.deepEqual(await client.readSequencePage({ sequenceId: 'sequence-1', ordinal: 0, limit: 80 }), {
    method: 'readSequencePage',
    value: { sequenceId: 'sequence-1', ordinal: 0, limit: 80 }
  });
  const source = await client.resolveSequenceEntrySource({ trackUid: 'track-1' });
  assert.deepEqual(source, {
    kind: 'electron-file',
    trackUid: 'track-1',
    folderId: 'folder-1',
    lifecycleVersion: 3,
    fileName: 'Track.flac',
    path: 'C:\\Music\\Track.flac'
  });
  assert.deepEqual(calls.map(call => call[0]), [
    'start', 'status', 'cancel', 'previewPlaylistImport',
    'commitPlaylistImportPreview', 'cancelPlaylistImportPreview',
    'getProvisionalEntry', 'readSequencePage', 'resolveSequenceEntrySource'
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
      state: 'running',
      updatedAt: 1_000 + sequence
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

test('playback permission envelopes retain folder lifecycle details in the renderer', async () => {
  const { api, playbackApi } = createApi();
  playbackApi.resolveSequenceEntrySource = async () => ({
    code: 'folderPermissionRequired',
    details: { folderId: 'folder-9', lifecycleVersion: 4 }
  });
  const client = new ElectronLibraryServiceClient({ api, playbackApi });
  await assert.rejects(
    client.resolveSequenceEntrySource({ trackUid: 'track-9' }),
    error => error.code === 'folderPermissionRequired' &&
      error.details.folderId === 'folder-9' && error.details.lifecycleVersion === 4
  );
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
