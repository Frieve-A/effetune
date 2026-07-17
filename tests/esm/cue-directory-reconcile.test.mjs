import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedScanService } from '../../js/library/scan/bounded-scan-service.js';
import { createCueDirectoryStageHandler } from '../helpers/cue-directory-stage-repository.mjs';

function createRepository(initialTracks) {
  const state = {
    tracks: new Map(initialTracks.map(track => [track.logicalStorageId, { ...track }])),
    seen: new Set(),
    sweeps: 0,
    paused: false,
    ineligible: false
  };
  const stage = createCueDirectoryStageHandler(state);
  const repository = {
    state,
    async beginScanFolder(request) {
      return {
        scanId: request.scanId,
        folderId: request.folderId,
        generation: 1,
        lifecycleVersion: request.expectedLifecycleVersion,
        parserVersion: 'test-v3',
        continuityBroken: false,
        sweepEligibility: 'PENDING',
        visitedFiles: 0,
        committedBatches: 0,
        metadataCursor: null
      };
    },
    async preflightScanBatch() { return { ok: true }; },
    async commitScanSeenBatch(request) {
      for (const observation of request.observations) {
        for (const logical of observation.logicalCandidates) {
          state.seen.add(logical.logicalStorageId);
          state.tracks.set(logical.logicalStorageId, { ...logical });
        }
      }
      return { committed: request.observations.length };
    },
    async listMetadataCandidates() { return { items: [], nextCursor: null, resumeCursor: null }; },
    async advanceScanMetadataCursor() { return { advanced: true }; },
    async markScanEnumerationIneligible() {
      state.ineligible = true;
      return { marked: true };
    },
    async recordScanErrors() { return { recorded: 0 }; },
    async finalizeScanEnumeration(request) {
      return {
        sweepEligibility: request.requestedSweepEligibility,
        continuityBroken: request.continuityBroken,
        enumerationErrorCount: state.ineligible ? 1 : 0,
        sweepBlockReason: state.ineligible ? 'enumeration-error' : null
      };
    },
    async enqueueScanSweep() { return { enqueued: 0 }; },
    async runScanSweep() {
      state.sweeps += 1;
      let deleted = 0;
      for (const logicalStorageId of state.tracks.keys()) {
        if (state.seen.has(logicalStorageId)) continue;
        state.tracks.delete(logicalStorageId);
        deleted += 1;
      }
      return { deleted, hasMore: false };
    },
    async completeScanFolder() { return { completed: true }; },
    async completeScanFolderNoSweep() { return { completed: true }; },
    async pauseScanFolder() {
      state.paused = true;
      return { paused: true };
    },
    async claimMetadataParse() { return { claim: null }; },
    async completeMetadataParseSuccess() { return { committed: false }; },
    async completeMetadataParseFailure() { return { committed: false }; },
    async requeueLatestMetadata() { return { requeued: 0 }; },
    async recoverInterruptedMetadataClaims() { return { changed: 0 }; }
  };
  repository.cueDirectoryStage = stage;
  return repository;
}

function createFilesystem(entriesByDirectory, files, { abortController = null } = {}) {
  return {
    async *enumerateDirectory({ relativeDirectory }) {
      const entries = entriesByDirectory[relativeDirectory] ?? [];
      for (const entry of entries) {
        if (entry.abort) {
          const reason = Object.assign(new Error('cancelled'), { name: 'AbortError' });
          abortController.abort(reason);
          throw reason;
        }
        yield entry;
      }
    },
    async statFile({ entry }) {
      const file = files[entry.relativePath];
      return {
        fileIdentity: `id:${entry.relativePath}:${file.mtimeMs}`,
        size: file.bytes.byteLength,
        mtimeMs: file.mtimeMs
      };
    },
    async readSmallFile({ relativePath, maximumBytes }) {
      const file = files[relativePath];
      return file.bytes.byteLength > maximumBytes
        ? { tooLarge: true, size: file.bytes.byteLength, bytes: null }
        : { tooLarge: false, size: file.bytes.byteLength, bytes: file.bytes };
    }
  };
}

function createService(repository, filesystem) {
  return new BoundedScanService({
    repository,
    filesystem,
    metadataParser: { async parse() { return { durationSec: 20 }; } },
    config: { directoryConcurrency: 1, statConcurrency: 2, maxBatchTracks: 1, maxBatchDelayMs: 1000 }
  });
}

function directory(relativePath) {
  return { kind: 'directory', name: relativePath, relativePath };
}

function fileEntry(relativePath) {
  return {
    kind: relativePath.endsWith('.cue') ? 'cue' : 'file',
    name: relativePath.split('/').at(-1),
    relativePath,
    path: relativePath
  };
}

function file(text, mtimeMs = 1) {
  return { bytes: new TextEncoder().encode(text), mtimeMs };
}

async function run(service, signal) {
  return service.runFolder({
    scanId: 'scan',
    folder: { id: 'folder', path: 'root', normalizedRoot: 'root', lifecycleVersion: 0 },
    signal
  });
}

test('plain-to-CUE publication retains the old plain row after a later retryable directory failure', async () => {
  const cue = 'FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00';
  const repository = createRepository([{
    logicalStorageId: 'file:Good/album.wav', relativePath: 'Good/album.wav', sourceKind: 'file'
  }]);
  const filesystem = createFilesystem({
    '': [directory('Good'), directory('Bad')],
    Good: [fileEntry('Good/album.cue'), fileEntry('Good/album.wav')],
    Bad: [{ kind: 'error', relativePath: 'Bad', error: { code: 'EACCES' }, phase: 'directory-open' }]
  }, {
    'Good/album.cue': file(cue),
    'Good/album.wav': file('audio')
  });

  const result = await run(createService(repository, filesystem));

  assert.equal(result.status, 'completed-no-sweep');
  assert.equal(repository.state.sweeps, 0);
  assert.deepEqual([...repository.state.tracks.keys()], [
    'file:Good/album.wav',
    'cue:Good/album.cue#1'
  ]);
});

test('CUE-to-plain publication retains the old CUE rows after a later cancellation', async () => {
  const controller = new AbortController();
  const repository = createRepository([
    {
      logicalStorageId: 'cue:Good/album.cue#1', relativePath: 'Good/album.wav',
      sourceKind: 'cue-track'
    },
    {
      logicalStorageId: 'cue:Good/album.cue#2', relativePath: 'Good/album.wav',
      sourceKind: 'cue-track'
    }
  ]);
  const filesystem = createFilesystem({
    '': [directory('Good'), directory('Bad')],
    Good: [fileEntry('Good/album.wav')],
    Bad: [{ abort: true }]
  }, {
    'Good/album.wav': file('audio')
  }, { abortController: controller });

  await assert.rejects(run(createService(repository, filesystem), controller.signal), {
    name: 'AbortError'
  });

  assert.equal(repository.state.paused, true);
  assert.equal(repository.state.sweeps, 0);
  assert.deepEqual([...repository.state.tracks.keys()], [
    'cue:Good/album.cue#1',
    'cue:Good/album.cue#2',
    'file:Good/album.wav'
  ]);
});

test('CUE-to-plain publication removes old CUE rows only in the eligible final sweep', async () => {
  const repository = createRepository([
    {
      logicalStorageId: 'cue:Good/album.cue#1', relativePath: 'Good/album.wav',
      sourceKind: 'cue-track'
    },
    {
      logicalStorageId: 'cue:Good/album.cue#2', relativePath: 'Good/album.wav',
      sourceKind: 'cue-track'
    }
  ]);
  const filesystem = createFilesystem({
    '': [directory('Good')],
    Good: [fileEntry('Good/album.wav')]
  }, {
    'Good/album.wav': file('audio')
  });

  const result = await run(createService(repository, filesystem));

  assert.equal(result.status, 'completed');
  assert.equal(repository.state.sweeps, 1);
  assert.deepEqual([...repository.state.tracks.keys()], ['file:Good/album.wav']);
});

test('cancel after the first bounded sweep chunk cannot pause a destructive generation', async () => {
  const controller = new AbortController();
  const repository = createRepository(Array.from({ length: 205 }, (_, index) => ({
    logicalStorageId: `file:stale-${index}.flac`,
    relativePath: `stale-${index}.flac`,
    sourceKind: 'file'
  })));
  repository.runScanSweep = async () => {
    repository.state.sweeps += 1;
    const stale = [...repository.state.tracks.keys()]
      .filter(logicalStorageId => !repository.state.seen.has(logicalStorageId))
      .slice(0, 100);
    for (const logicalStorageId of stale) repository.state.tracks.delete(logicalStorageId);
    if (repository.state.sweeps === 1) {
      controller.abort(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
    }
    return {
      deleted: stale.length,
      hasMore: [...repository.state.tracks.keys()]
        .some(logicalStorageId => !repository.state.seen.has(logicalStorageId))
    };
  };
  const filesystem = createFilesystem({ '': [] }, {});

  const result = await run(createService(repository, filesystem), controller.signal);

  assert.equal(result.status, 'completed');
  assert.equal(repository.state.paused, false);
  assert.equal(repository.state.sweeps, 3);
  assert.equal(repository.state.tracks.size, 0);
});

test('a post-commit sweep failure leaves the destructive generation unpaused for recovery', async () => {
  const repository = createRepository(Array.from({ length: 205 }, (_, index) => ({
    logicalStorageId: `file:stale-${index}.flac`,
    relativePath: `stale-${index}.flac`,
    sourceKind: 'file'
  })));
  repository.runScanSweep = async () => {
    repository.state.sweeps += 1;
    if (repository.state.sweeps === 2) throw new Error('catalog worker interrupted');
    const stale = [...repository.state.tracks.keys()].slice(0, 100);
    for (const logicalStorageId of stale) repository.state.tracks.delete(logicalStorageId);
    return { deleted: stale.length, hasMore: true };
  };
  const filesystem = createFilesystem({ '': [] }, {});

  await assert.rejects(run(createService(repository, filesystem)), /catalog worker interrupted/);

  assert.equal(repository.state.paused, false);
  assert.equal(repository.state.sweeps, 2);
  assert.equal(repository.state.tracks.size, 105);
});
