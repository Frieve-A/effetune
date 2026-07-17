import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedScanService } from '../../js/library/scan/bounded-scan-service.js';
import { createCueDirectoryStageHandler } from '../helpers/cue-directory-stage-repository.mjs';

function createRepository() {
  const state = {
    observations: [], batches: [], ineligible: false, warnings: [], swept: false,
    cueReferenceRequests: [], cueStageActions: []
  };
  const repository = {
    state,
    beginScanFolder: async request => ({
      scanId: request.scanId, folderId: request.folderId, generation: 1,
      lifecycleVersion: request.expectedLifecycleVersion, parserVersion: 'test-v3',
      continuityBroken: false, sweepEligibility: 'INELIGIBLE', visitedFiles: 0,
      committedBatches: 0, metadataCursor: null
    }),
    preflightScanBatch: async () => ({ ok: true }),
    commitScanSeenBatch: async request => {
      state.batches.push(request.observations);
      state.observations.push(...request.observations);
      return { committed: request.observations.length };
    },
    listMetadataCandidates: async () => ({ items: [], nextCursor: null, resumeCursor: null }),
    advanceScanMetadataCursor: async () => ({ advanced: true }),
    markScanEnumerationIneligible: async request => {
      state.ineligible = true;
      state.warnings.push(request.sample);
      return { marked: true };
    },
    recordScanErrors: async request => {
      state.warnings.push(...request.samples);
      return { recorded: request.occurrenceCount };
    },
    finalizeScanEnumeration: async request => ({
      sweepEligibility: request.requestedSweepEligibility,
      continuityBroken: request.continuityBroken,
      enumerationErrorCount: state.ineligible ? 1 : 0,
      sweepBlockReason: state.ineligible ? 'enumeration-error' : null
    }),
    enqueueScanSweep: async () => ({ enqueued: 0 }),
    runScanSweep: async () => {
      state.swept = true;
      return { deleted: 0, hasMore: false };
    },
    completeScanFolder: async () => ({ completed: true }),
    completeScanFolderNoSweep: async () => ({ completed: true }),
    pauseScanFolder: async () => ({ paused: true }),
    claimMetadataParse: async () => ({ claim: null }),
    completeMetadataParseSuccess: async () => ({ committed: false }),
    completeMetadataParseFailure: async () => ({ committed: false }),
    requeueLatestMetadata: async () => ({ requeued: 0 }),
    recoverInterruptedMetadataClaims: async () => ({ changed: 0 })
  };
  const cueDirectoryStage = createCueDirectoryStageHandler(state);
  repository.cueDirectoryStage = async request => {
    state.cueStageActions.push(request.action);
    if (request.action === 'resolve-references') {
      state.cueReferenceRequests.push([...request.references]);
      if (request.references.length > 99) {
        throw Object.assign(new Error('CUE reference page exceeds 99 rows'), { code: 'batchLimitExceeded' });
      }
    }
    return cueDirectoryStage(request);
  };
  return repository;
}

function createFilesystem(files, { readError = null, onReadSmallFile = null } = {}) {
  const entries = Object.entries(files).map(([relativePath, file], index) => ({
    kind: relativePath.endsWith('.cue') ? 'cue' : 'file',
    name: relativePath,
    relativePath,
    path: relativePath,
    sequence: index,
    file
  }));
  return {
    async *enumerateDirectory() {
      yield* entries;
    },
    async statFile({ entry }) {
      const file = files[entry.relativePath];
      return { fileIdentity: `id:${entry.relativePath}`, size: file.bytes.byteLength, mtimeMs: file.mtimeMs };
    },
    async readSmallFile({ relativePath, maximumBytes }) {
      if (readError) throw readError;
      const file = files[relativePath];
      const result = file.bytes.byteLength > maximumBytes
        ? { tooLarge: true, size: file.bytes.byteLength, bytes: null }
        : { tooLarge: false, size: file.bytes.byteLength, bytes: file.bytes };
      onReadSmallFile?.({ relativePath, result });
      return result;
    }
  };
}

function createService(files, {
  metadata, readError = null, config = {}, onReadSmallFile = null, onParse = null
} = {}) {
  const repository = createRepository();
  const parses = [];
  const service = new BoundedScanService({
    repository,
    filesystem: createFilesystem(files, { readError, onReadSmallFile }),
    metadataParser: {
      async parse(request) {
        parses.push(request.relativePath);
        onParse?.(request);
        if (metadata instanceof Error) throw metadata;
        return { ...metadata };
      }
    },
    config: { directoryConcurrency: 1, statConcurrency: 2, maxBatchDelayMs: 1000, ...config }
  });
  return { service, repository, parses };
}

function file(text = '', mtimeMs = 1) {
  return { bytes: new TextEncoder().encode(text), mtimeMs };
}

async function scan(service) {
  return service.runFolder({
    scanId: 'scan', folder: { id: 'folder', path: 'root', normalizedRoot: 'root', lifecycleVersion: 0 }
  });
}

test('valid CUE publishes logical regions and parses physical source metadata once', async () => {
  const cue = `
    PERFORMER "Disc Artist"
    TITLE "Disc"
    FILE "album.wav" WAVE
    TRACK 01 AUDIO
    TITLE "One"
    INDEX 01 00:00:00
    TRACK 02 AUDIO
    INDEX 01 00:10:00
  `;
  const { service, repository, parses } = createService({
    'disc.cue': file(cue),
    'album.wav': file('audio')
  }, {
    metadata: {
      title: 'Embedded title', artist: 'Embedded artist', album: 'Embedded album',
      albumArtist: 'Embedded album artist', genre: 'Embedded genre', durationSec: 30,
      sampleRate: 48000, channels: 2, codec: 'PCM'
    }
  });
  const result = await scan(service);
  assert.equal(result.status, 'completed');
  assert.deepEqual(parses, ['album.wav']);
  const audio = repository.state.observations.find(item => item.relativePath === 'album.wav');
  assert.equal(audio.logicalCandidates.length, 2);
  assert.deepEqual(audio.logicalCandidates.map(item => ({
    id: item.logicalStorageId,
    start: item.startFrame,
    end: item.endFrame,
    title: item.metadata.title,
    artist: item.metadata.artist,
    duration: item.metadata.durationSec
  })), [
    { id: 'cue:disc.cue#1', start: 0, end: 750, title: 'One', artist: 'Disc Artist', duration: 10 },
    { id: 'cue:disc.cue#2', start: 750, end: null, title: 'Track 02', artist: 'Disc Artist', duration: 20 }
  ]);
  assert.equal(repository.state.swept, true);
  assert.equal(repository.state.cueStageActions.includes('reconcile-logical'), false);
  assert.ok(repository.state.cueStageMaxPageRows <= 8);
  assert.equal(repository.state.cueStageClearCount, 1);
});

test('CUE reference resolution ignores 99 non-AUDIO FILE blocks on initial and validation reads', async () => {
  const nonAudioFiles = Array.from({ length: 99 }, (_, index) => `
    FILE "data-${index}.bin" BINARY
    TRACK 01 MODE1/2352
  `).join('');
  const cue = `${nonAudioFiles}
    FILE "album.wav" WAVE
    TRACK 01 AUDIO
    INDEX 01 00:00:00
  `;
  const { service, repository, parses } = createService({
    'disc.cue': file(cue),
    'album.wav': file('audio')
  }, { metadata: { durationSec: 30 } });

  const result = await scan(service);

  assert.equal(result.status, 'completed');
  assert.deepEqual(repository.state.cueReferenceRequests, [['album.wav'], ['album.wav']]);
  assert.deepEqual(parses, ['album.wav']);
  const audio = repository.state.observations.find(item => item.relativePath === 'album.wav');
  assert.deepEqual(audio.logicalCandidates.map(item => item.logicalStorageId), ['cue:disc.cue#1']);
});

test('zero-AUDIO CUE does not resolve or claim a source and keeps plain-file semantics', async () => {
  const cue = `
    FILE "album.wav" WAVE
    TRACK 01 MODE1/2352
  `;
  const { service, repository, parses } = createService({
    'disc.cue': file(cue),
    'album.wav': file('audio')
  }, { metadata: { durationSec: 30 } });

  const result = await scan(service);

  assert.equal(result.status, 'completed');
  assert.deepEqual(repository.state.cueReferenceRequests, []);
  assert.deepEqual(parses, []);
  const audio = repository.state.observations.find(item => item.relativePath === 'album.wav');
  assert.deepEqual(audio.logicalCandidates.map(item => ({
    logicalStorageId: item.logicalStorageId,
    sourceKind: item.sourceKind,
    cueRelativePath: item.cueRelativePath
  })), [{
    logicalStorageId: 'file:album.wav',
    sourceKind: 'file',
    cueRelativePath: null
  }]);
  assert.deepEqual(result.warnings, [{
    category: 'cue-unsupported',
    count: 1,
    samples: [{ code: 'cue-no-audio-tracks', path: 'disc.cue' }]
  }]);
});

test('CUE logical tracks count toward the bounded scan row limit', async () => {
  const cue = `
    FILE "album.wav" WAVE
    TRACK 01 AUDIO
    INDEX 01 00:00:00
    TRACK 02 AUDIO
    INDEX 01 00:10:00
  `;
  const { service, repository } = createService({
    'disc.cue': file(cue),
    'album.wav': file('audio')
  }, {
    metadata: { durationSec: 30 },
    config: { maxBatchTracks: 2 }
  });

  const result = await scan(service);

  assert.equal(repository.state.batches.length, 2);
  assert.ok(repository.state.batches.every(batch => batch.reduce((count, observation) =>
    count + Math.max(1, observation.logicalCandidates.length), 0) <= 2));
});

test('CUE logical publish reads track staging through bounded pages', async () => {
  const tracks = Array.from({ length: 10 }, (_, index) => `
    TRACK ${String(index + 1).padStart(2, '0')} AUDIO
    INDEX 01 00:${String(index).padStart(2, '0')}:00
  `).join('');
  const { service, repository } = createService({
    'disc.cue': file(`FILE "album.wav" WAVE${tracks}`),
    'album.wav': file('audio')
  }, { metadata: { durationSec: 20 } });

  await scan(service);

  const audio = repository.state.observations.find(item => item.relativePath === 'album.wav');
  assert.deepEqual(audio.logicalCandidates.map(item => item.metadata.trackNo), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('deterministically invalid CUE publishes every enumerated WAV/FLAC as plain', async () => {
  const { service, repository, parses } = createService({
    'bad.cue': file('FILE "missing.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00'),
    'album.wav': file('audio'),
    'other.flac': file('audio')
  }, { metadata: { durationSec: 30 } });
  const result = await scan(service);
  assert.deepEqual(parses, []);
  const logical = repository.state.observations.flatMap(item => item.logicalCandidates);
  assert.deepEqual(logical.map(item => item.logicalStorageId).sort(), [
    'file:album.wav', 'file:other.flac'
  ]);
  assert.deepEqual(repository.state.warnings, [{
    category: 'cue-warning', code: 'cue-missing-reference', path: 'bad.cue'
  }]);
  assert.deepEqual(result.warnings, [{
    category: 'cue-invalid',
    count: 1,
    samples: [{ code: 'cue-missing-reference', path: 'bad.cue' }]
  }]);
  assert.equal(repository.state.swept, true);
});

test('CUE completion warnings coalesce categories, counts, and globally bounded samples', async () => {
  const { service } = createService({
    'invalid.cue': file('FILE "missing.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00'),
    'unsupported.cue': file('REM COMMENT "no audio tracks"'),
    'large.cue': file('x'.repeat(1024 * 1024 + 1)),
    'album.wav': file('audio')
  }, { metadata: { durationSec: 30 }, config: { maxErrorSamples: 2 } });

  const result = await scan(service);

  assert.deepEqual(result.warnings.map(({ category, count }) => ({ category, count })), [
    { category: 'cue-invalid', count: 1 },
    { category: 'cue-unsupported', count: 1 },
    { category: 'cue-too-large', count: 1 }
  ]);
  assert.equal(result.warnings.reduce((total, warning) => total + warning.samples.length, 0), 2);
  assert.equal(result.counts.enumerationErrors, 0);
  assert.equal(result.status, 'completed');
});

test('retryable CUE read failure publishes no staged logical changes and blocks sweep', async () => {
  const error = Object.assign(new Error('temporary'), { code: 'transient-io' });
  const { service, repository } = createService({
    'disc.cue': file('FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00'),
    'album.wav': file('audio')
  }, { metadata: { durationSec: 30 }, readError: error });
  const result = await scan(service);
  assert.equal(result.status, 'completed-no-sweep');
  assert.equal(repository.state.observations.flatMap(item => item.logicalCandidates).length, 0);
  assert.equal(repository.state.cueStageActions.includes('reconcile-logical'), false);
  assert.equal(repository.state.swept, false);
});

test('too-large CUE freshness race preserves existing logical rows and blocks directory publish', async () => {
  const files = {
    'large.cue': file('x'.repeat(1024 * 1024 + 1)),
    'album.wav': file('audio')
  };
  const { service, repository } = createService(files, {
    metadata: { durationSec: 30 },
    onReadSmallFile({ relativePath }) {
      if (relativePath === 'large.cue') files[relativePath].mtimeMs += 1;
    }
  });
  const existing = { logicalStorageId: 'cue:previous.cue#1', relativePath: 'album.wav' };
  repository.state.observations.push(existing);

  const result = await scan(service);

  assert.equal(result.status, 'completed-no-sweep');
  assert.deepEqual(repository.state.observations, [existing]);
  assert.equal(repository.state.cueStageActions.includes('reconcile-logical'), false);
  assert.equal(repository.state.swept, false);
  assert.equal(result.counts.enumerationErrors, 1);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(repository.state.warnings.map(({ phase, code, retryable, path }) => ({
    phase, code, retryable, path
  })), [{ phase: 'cue-read', code: 'transient-io', retryable: true, path: 'large.cue' }]);
});

test('terminal source metadata freshness race preserves existing CUE rows and stays retryable', async () => {
  const files = {
    'disc.cue': file('FILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00'),
    'album.wav': file('audio')
  };
  const terminal = Object.assign(new Error('unsupported'), { code: 'unsupported-container' });
  const { service, repository } = createService(files, {
    metadata: terminal,
    onParse({ relativePath }) {
      if (relativePath === 'album.wav') delete files[relativePath];
    }
  });
  const existing = { logicalStorageId: 'cue:disc.cue#1', relativePath: 'album.wav' };
  repository.state.observations.push(existing);

  const result = await scan(service);

  assert.equal(result.status, 'completed-no-sweep');
  assert.deepEqual(repository.state.observations, [existing]);
  assert.equal(repository.state.cueStageActions.includes('reconcile-logical'), false);
  assert.equal(repository.state.swept, false);
  assert.equal(result.counts.enumerationErrors, 1);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(repository.state.warnings.map(({ phase, code, retryable, path }) => ({
    phase, code, retryable, path
  })), [{ phase: 'cue-source-metadata', code: 'transient-io', retryable: true, path: 'album.wav' }]);
});

test('CUE conflict resolution uses code-unit cue path order and invalidates the whole loser', async () => {
  const cue = title => `TITLE "${title}"\nFILE "album.wav" WAVE\nTRACK 01 AUDIO\nINDEX 01 00:00:00`;
  const { service, repository, parses } = createService({
    'B.cue': file(cue('B')),
    'A.cue': file(cue('A')),
    'album.wav': file('audio')
  }, { metadata: { durationSec: 30 } });
  await scan(service);
  const logical = repository.state.observations.flatMap(item => item.logicalCandidates);
  assert.equal(logical.length, 1);
  assert.equal(logical[0].entryKey, 'cue:A.cue#1');
  assert.deepEqual(parses, ['album.wav']);
});
