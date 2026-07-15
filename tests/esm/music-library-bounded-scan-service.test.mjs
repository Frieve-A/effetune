import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BoundedScanService,
  DEFAULT_SCAN_SERVICE_CONFIG,
  ScanServiceError
} from '../../js/library/scan/bounded-scan-service.js';
import {
  MetadataParseService,
  classifyMetadataParseError,
  metadataParseEligibility
} from '../../js/library/scan/metadata-parse-service.js';

function createRepository(options = {}) {
  const calls = [];
  let preflightCalls = 0;
  const repository = {
    calls,
    async beginScanFolder(input) {
      calls.push(['begin', input]);
      return {
        scanId: input.scanId,
        folderId: input.folderId,
        generation: options.generation ?? 7,
        lifecycleVersion: input.expectedLifecycleVersion,
        parserVersion: 'parser-1',
        continuityBroken: input.resume,
        sweepEligibility: input.resume ? 'INELIGIBLE' : 'PENDING',
        visitedFiles: input.resume ? (options.visitedFiles ?? 0) : 0,
        committedBatches: input.resume ? (options.committedBatches ?? 0) : 0,
        metadataCursor: input.resume ? (options.metadataCursor ?? null) : null
      };
    },
    async preflightScanBatch(input) {
      calls.push(['preflight', input]);
      preflightCalls += 1;
      if (options.preflightFailsAt === preflightCalls) {
        return { ok: false, availableBytes: 10, requiredAvailableBytes: 30, shortfallBytes: 20 };
      }
      return { ok: true };
    },
    async commitScanSeenBatch(input) {
      calls.push(['commit', input]);
      if (options.commitError) throw options.commitError;
      return { committed: true };
    },
    async listMetadataCandidates() {
      return { items: [], nextCursor: null };
    },
    async advanceScanMetadataCursor(input) {
      calls.push(['metadata-cursor', input]);
      return { cursor: input.cursor };
    },
    async markScanEnumerationIneligible(input) {
      calls.push(['ineligible', input]);
    },
    async recordScanErrors(input) {
      calls.push(['errors', input]);
    },
    async finalizeScanEnumeration(input) {
      calls.push(['finalize', input]);
      const eligible = !input.continuityBroken && input.enumerationErrorCount === 0;
      return {
        sweepEligibility: eligible ? 'ELIGIBLE' : 'INELIGIBLE',
        continuityBroken: input.continuityBroken,
        enumerationErrorCount: input.enumerationErrorCount,
        sweepBlockReason: eligible ? null : 'not-clean'
      };
    },
    async enqueueScanSweep(input) {
      calls.push(['enqueue-sweep', input]);
    },
    async runScanSweep(input) {
      calls.push(['run-sweep', input]);
    },
    async completeScanFolder(input) {
      calls.push(['complete', input]);
    },
    async completeScanFolderNoSweep(input) {
      calls.push(['complete-no-sweep', input]);
    },
    async pauseScanFolder(input) {
      calls.push(['pause', input]);
    },
    async claimMetadataParse(input) {
      calls.push(['metadata-claim', input]);
      return { claim: { ...input } };
    },
    async completeMetadataParseSuccess(input) {
      calls.push(['metadata-success', input]);
      return { committed: true };
    },
    async completeMetadataParseFailure(input) {
      calls.push(['metadata-failure', input]);
      return { committed: true };
    },
    async requeueLatestMetadata(input) {
      calls.push(['metadata-requeue', input]);
    },
    async recoverInterruptedMetadataClaims(input) {
      calls.push(['metadata-recover', input]);
      return { changed: 1 };
    }
  };
  return repository;
}

function createFilesystem(count, options = {}) {
  const enumerated = [];
  return {
    enumerated,
    async *enumerateDirectory({ relativeDirectory }) {
      enumerated.push(relativeDirectory);
      if (relativeDirectory !== '') return;
      for (let index = 0; index < count; index += 1) {
        if (options.errorEvery && index % options.errorEvery === 0) {
          yield { kind: 'error', name: `bad-${index}`, error: { code: 'EACCES' }, phase: 'directory-open' };
        } else {
          yield { kind: 'file', name: `Track-${index}.flac`, path: `D:/Music/Track-${index}.flac` };
        }
      }
    },
    async statFile({ entry }) {
      const index = Number.parseInt(entry.name.match(/\d+/)?.[0] ?? '0', 10);
      return { fileIdentity: `file-${index}`, size: 1000 + index, mtimeMs: 2000 + index };
    }
  };
}

function createService({ repository, filesystem, progress = [], now } = {}) {
  return new BoundedScanService({
    repository,
    filesystem,
    metadataParser: { async parse() { return {}; } },
    onProgress: value => progress.push(value),
    now,
    config: { maxBatchDelayMs: 10000 }
  });
}

const folder = { id: 'folder-1', path: 'D:/Music', normalizedRoot: 'd:/music', lifecycleVersion: 3 };

test('bounded scan commits first-of capped batches without knownFiles or all-path input', async () => {
  const repository = createRepository();
  const filesystem = createFilesystem(1201);
  const progress = [];
  let clock = 0;
  const service = createService({ repository, filesystem, progress, now: () => (clock += 10) });

  const result = await service.runFolder({ scanId: 'scan-1', folder });
  const commits = repository.calls.filter(([name]) => name === 'commit').map(([, input]) => input);

  assert.equal(result.status, 'completed');
  assert.equal(result.counts.found, 1201);
  assert.deepEqual(commits.map(commit => commit.observations.length), [500, 500, 201]);
  assert.ok(commits.every(commit => commit.maxTracks === 500 && commit.maxBytes === 4 * 1024 * 1024));
  assert.equal(repository.calls.filter(([name]) => name === 'preflight').length, commits.length + 1);
  assert.deepEqual(filesystem.enumerated, ['']);
  assert.equal(repository.calls.filter(([name]) => name === 'enqueue-sweep').length, 1);
  assert.ok(progress.length <= Math.ceil(result.durationMs / 250) + 2);
  assert.equal(DEFAULT_SCAN_SERVICE_CONFIG.maxQueuedDirectories, 10000);
  assert.equal(DEFAULT_SCAN_SERVICE_CONFIG.maxQueuedDirectoryBytes, 32 * 1024 * 1024);
});

test('resume re-enumerates from root and remains upsert-only even after a clean pass', async () => {
  const repository = createRepository({
    generation: 9,
    visitedFiles: 501,
    committedBatches: 2,
    metadataCursor: 500
  });
  const filesystem = createFilesystem(3);
  const service = createService({ repository, filesystem });

  const result = await service.runFolder({ scanId: 'scan-resume', folder, resume: true });

  assert.deepEqual(filesystem.enumerated, ['']);
  assert.equal(result.status, 'completed-no-sweep');
  assert.equal(result.generation, 9);
  assert.equal(result.counts.found, 504);
  const commit = repository.calls.find(([name]) => name === 'commit')?.[1];
  assert.equal(commit.lastCommittedBatch, 3);
  assert.deepEqual(commit.cursor, {
    lastRelativePath: 'Track-2.flac',
    visitedFiles: 504,
    committedBatches: 3
  });
  assert.equal(repository.calls.some(([name]) => name === 'enqueue-sweep'), false);
  assert.equal(repository.calls.filter(([name]) => name === 'complete-no-sweep').length, 1);
});

test('enumeration errors durably block the whole sweep while samples remain capped', async () => {
  const repository = createRepository();
  const filesystem = createFilesystem(150, { errorEvery: 1 });
  const service = createService({ repository, filesystem });

  const result = await service.runFolder({ scanId: 'scan-errors', folder });
  const errorWrites = repository.calls.filter(([name]) => name === 'errors');
  const sampleCount = errorWrites.reduce((sum, [, input]) => sum + input.samples.length, 0);

  assert.equal(result.status, 'completed-no-sweep');
  assert.equal(result.counts.enumerationErrors, 150);
  assert.equal(repository.calls.filter(([name]) => name === 'ineligible').length, 1);
  assert.ok(sampleCount <= 100);
  assert.equal(repository.calls.some(([name]) => name === 'enqueue-sweep'), false);
});

test('traversal queue overflow is bounded and durably pauses sweep-ineligible', async () => {
  const repository = createRepository();
  const filesystem = {
    async *enumerateDirectory({ relativeDirectory }) {
      if (relativeDirectory) return;
      yield { kind: 'directory', name: 'one' };
      yield { kind: 'directory', name: 'two' };
      yield { kind: 'directory', name: 'three' };
    },
    async statFile() {
      throw new Error('not reached');
    }
  };
  const service = new BoundedScanService({
    repository,
    filesystem,
    metadataParser: { async parse() { return {}; } },
    config: { maxQueuedDirectories: 2, maxBatchDelayMs: 10000 }
  });

  await assert.rejects(
    () => service.runFolder({ scanId: 'scan-queue', folder }),
    error => error.code === 'scanTraversalQueueLimit'
  );
  assert.equal(repository.calls.filter(([name]) => name === 'ineligible').length, 1);
  const pause = repository.calls.find(([name, input]) => name === 'pause' && input.stopReason === 'system')?.[1];
  assert.equal(pause.sweepEligibility, 'INELIGIBLE');
  assert.equal(repository.calls.some(([name]) => name === 'enqueue-sweep'), false);
});

test('preflight shortfall pauses without entering read-only diagnostic mode', async () => {
  const repository = createRepository({ preflightFailsAt: 2 });
  const service = createService({ repository, filesystem: createFilesystem(1) });

  await assert.rejects(
    () => service.runFolder({ scanId: 'scan-storage', folder }),
    error => error instanceof ScanServiceError && error.code === 'insufficientStorage'
  );
  const pause = repository.calls.find(([name]) => name === 'pause')?.[1];
  assert.equal(pause.stopReason, 'storage');
  assert.equal(pause.sweepEligibility, 'INELIGIBLE');
  assert.equal(repository.calls.some(([name]) => name === 'read-only'), false);
});

test('actual storage write failure stays scoped to the current scan attempt', async () => {
  const failure = Object.assign(new Error('disk full at private path'), { code: 'SQLITE_FULL' });
  const repository = createRepository({ commitError: failure });
  const service = createService({ repository, filesystem: createFilesystem(1) });

  await assert.rejects(
    () => service.runFolder({ scanId: 'scan-full', folder }),
    error => error === failure
  );
  assert.equal(repository.calls.some(([name]) => name === 'read-only'), false);
  await assert.rejects(
    () => service.runFolder({ scanId: 'scan-after-full', folder }),
    error => error === failure
  );
});

test('metadata policy classifies stable errors and explicit rescan never resets the attempt counter', async () => {
  const signature = { fileIdentity: 'file-1', size: 10, mtimeMs: 20 };
  const candidate = {
    folderId: 'folder-1',
    lifecycleVersion: 3,
    generation: 8,
    relativePath: 'Track.flac',
    path: 'D:/Music/Track.flac',
    parserVersion: 'parser-1',
    storedParserVersion: 'parser-1',
    storedSignature: signature,
    observedSignature: { ...signature },
    metadataStatus: 'retryable-error',
    attemptsForSignature: 6,
    attemptedGeneration: 7
  };

  assert.equal(metadataParseEligibility(candidate), false);
  assert.equal(metadataParseEligibility(candidate, { scanReason: 'explicit-rescan' }), true);
  assert.equal(metadataParseEligibility({ ...candidate, attemptedGeneration: 8 }, { scanReason: 'explicit-rescan' }), false);
  assert.deepEqual(classifyMetadataParseError({ code: 'corrupt-container' }), {
    metadataStatus: 'terminal-error', errorCode: 'corrupt-container', retryable: false
  });
  assert.deepEqual(classifyMetadataParseError({ code: 'transport-surprise' }), {
    metadataStatus: 'retryable-error', errorCode: 'unknown-internal', retryable: true
  });
});

test('metadata claim precedes dispatch, failure preserves LKG, and stale completion is requeued', async () => {
  const repository = createRepository();
  let parseStartedAfterClaim = false;
  const parser = {
    async parse({ skipCovers }) {
      parseStartedAfterClaim = repository.calls.some(([name]) => name === 'metadata-claim');
      assert.equal(skipCovers, true);
      throw Object.assign(new Error('bad media'), { code: 'unsupported-container' });
    }
  };
  const service = new MetadataParseService({ repository, parser });
  const signature = { fileIdentity: 'file-2', size: 11, mtimeMs: 22 };
  const candidate = {
    folderId: 'folder-1', lifecycleVersion: 3, generation: 8,
    relativePath: 'Bad.flac', path: 'D:/Music/Bad.flac',
    parserVersion: 'parser-1', storedParserVersion: null,
    storedSignature: null, observedSignature: signature,
    metadataStatus: 'retryable-error', attemptsForSignature: 0, attemptedGeneration: null
  };

  const result = await service.process(candidate);
  const failure = repository.calls.find(([name]) => name === 'metadata-failure')?.[1];

  assert.equal(parseStartedAfterClaim, true);
  assert.equal(result.metadataStatus, 'terminal-error');
  assert.equal(failure.preserveLastKnownGood, true);
  assert.equal(failure.updateDerivedData, false);
  assert.equal(failure.createMinimalRecordIfNoLastKnownGood, true);

  repository.completeMetadataParseSuccess = async input => {
    repository.calls.push(['metadata-success-stale', input]);
    return { committed: false };
  };
  service.parser = { async parse() { return { title: 'New' }; } };
  const stale = await service.process({ ...candidate, metadataStatus: 'retryable-error' });
  assert.equal(stale.status, 'discarded-stale');
  assert.equal(
    repository.calls.find(([name]) => name === 'metadata-success-stale')?.[1].deferAggregateRecompute,
    true
  );
  assert.equal(repository.calls.filter(([name]) => name === 'metadata-requeue').length, 1);

  await service.recoverInterruptedClaims();
  assert.equal(repository.calls.find(([name]) => name === 'metadata-recover')?.[1].errorCode, 'service-interrupted');
});

test('metadata pages batch claims and completions around bounded concurrent parsing', async () => {
  const repository = createRepository();
  repository.claimMetadataParseBatch = async input => {
    repository.calls.push(['metadata-claim-batch', input]);
    return { results: input.requests.map(request => ({ claim: { ...request } })) };
  };
  repository.completeMetadataParseBatch = async input => {
    repository.calls.push(['metadata-completion-batch', input]);
    return { results: input.completions.map(() => ({ committed: true })) };
  };
  let activeParsers = 0;
  let highWaterParsers = 0;
  const service = new MetadataParseService({
    repository,
    parser: {
      async parse({ relativePath }) {
        activeParsers += 1;
        highWaterParsers = Math.max(highWaterParsers, activeParsers);
        await new Promise(resolve => setTimeout(resolve, 0));
        activeParsers -= 1;
        return { title: relativePath };
      }
    }
  });
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    folderId: 'folder-1', trackUid: `track-${index}`, lifecycleVersion: 3, generation: 8,
    relativePath: `Track-${index}.flac`, path: `D:/Music/Track-${index}.flac`,
    parserVersion: 'parser-1', storedParserVersion: null, storedSignature: null,
    observedSignature: { fileIdentity: `file-${index}`, size: 11 + index, mtimeMs: 22 + index },
    metadataStatus: 'retryable-error', attemptsForSignature: 0, attemptedGeneration: null
  }));

  const results = await service.processBatch(candidates, { concurrency: 2 });

  assert.deepEqual(results.map(result => result.status), Array(6).fill('committed'));
  assert.equal(highWaterParsers, 2);
  assert.equal(repository.calls.filter(([name]) => name === 'metadata-claim-batch').length, 1);
  assert.equal(repository.calls.filter(([name]) => name === 'metadata-completion-batch').length, 1);
  assert.equal(repository.calls.some(([name]) => name === 'metadata-claim'), false);
  const completions = repository.calls.find(([name]) => name === 'metadata-completion-batch')[1].completions;
  assert.ok(completions.every(completion =>
    completion.outcome === 'success' && completion.request.deferAggregateRecompute === true));
});

test('metadata batch cancellation completes every claim as retryable before aborting', async () => {
  const repository = createRepository();
  repository.claimMetadataParseBatch = async input => ({
    results: input.requests.map(request => ({ claim: { ...request } }))
  });
  let completionBatch;
  repository.completeMetadataParseBatch = async input => {
    completionBatch = input;
    return { results: input.completions.map(() => ({ committed: true })) };
  };
  const controller = new AbortController();
  const abort = Object.assign(new Error('cancel metadata page'), { name: 'AbortError' });
  const service = new MetadataParseService({
    repository,
    parser: {
      async parse() {
        controller.abort(abort);
        return {};
      }
    }
  });
  const candidates = Array.from({ length: 2 }, (_, index) => ({
    folderId: 'folder-1', trackUid: `cancel-track-${index}`, lifecycleVersion: 3, generation: 8,
    relativePath: `Cancel-${index}.flac`, path: `D:/Music/Cancel-${index}.flac`,
    parserVersion: 'parser-1', storedParserVersion: null, storedSignature: null,
    observedSignature: { fileIdentity: `cancel-file-${index}`, size: 11, mtimeMs: 22 },
    metadataStatus: 'retryable-error', attemptsForSignature: 0, attemptedGeneration: null
  }));

  await assert.rejects(
    service.processBatch(candidates, { signal: controller.signal, concurrency: 2 }),
    error => error === abort
  );
  assert.equal(completionBatch.completions.length, 2);
  assert.ok(completionBatch.completions.every(completion =>
    completion.outcome === 'failure' &&
    completion.request.metadataStatus === 'retryable-error' &&
    completion.request.errorCode === 'service-interrupted'));
});

test('metadata cancellation avoids new claims and restores a claimed item as retryable', async () => {
  const candidate = {
    folderId: 'folder-1', trackUid: 'track-1', lifecycleVersion: 3, generation: 8,
    relativePath: 'Cancel.flac', path: 'D:/Music/Cancel.flac',
    parserVersion: 'parser-1', storedParserVersion: null,
    storedSignature: null, observedSignature: { fileIdentity: 'file-1', size: 11, mtimeMs: 22 },
    metadataStatus: 'retryable-error', attemptsForSignature: 0, attemptedGeneration: null
  };

  const preClaimRepository = createRepository();
  const preClaimController = new AbortController();
  const preClaimAbort = Object.assign(new Error('cancel before claim'), { name: 'AbortError' });
  preClaimController.abort(preClaimAbort);
  const preClaimService = new MetadataParseService({
    repository: preClaimRepository,
    parser: { async parse() { throw new Error('parser must not run'); } }
  });
  await assert.rejects(
    preClaimService.process(candidate, { signal: preClaimController.signal }),
    error => error === preClaimAbort
  );
  assert.equal(preClaimRepository.calls.some(([name]) => name === 'metadata-claim'), false);

  const claimedRepository = createRepository();
  const claimedController = new AbortController();
  const claimedAbort = Object.assign(new Error('cancel after claim'), { name: 'AbortError' });
  const claimedService = new MetadataParseService({
    repository: claimedRepository,
    parser: {
      async parse() {
        claimedController.abort(claimedAbort);
        return { title: 'must not commit' };
      }
    }
  });
  await assert.rejects(
    claimedService.process(candidate, { signal: claimedController.signal }),
    error => error === claimedAbort
  );
  const failure = claimedRepository.calls.find(([name]) => name === 'metadata-failure')?.[1];
  assert.deepEqual({
    metadataStatus: failure.metadataStatus,
    errorCode: failure.errorCode,
    retryable: failure.retryable,
    preserveLastKnownGood: failure.preserveLastKnownGood,
    updateDerivedData: failure.updateDerivedData
  }, {
    metadataStatus: 'retryable-error',
    errorCode: 'service-interrupted',
    retryable: true,
    preserveLastKnownGood: true,
    updateDerivedData: false
  });
  assert.equal(claimedRepository.calls.some(([name]) => name === 'metadata-success'), false);
});
