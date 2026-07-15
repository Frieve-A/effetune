import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';
import { MetadataParseService } from './metadata-parse-service.js';

const MEBIBYTE = 1024 * 1024;

export const DEFAULT_SCAN_SERVICE_CONFIG = Object.freeze({
  maxQueuedDirectories: 10000,
  maxQueuedDirectoryBytes: 32 * MEBIBYTE,
  maxBatchTracks: 500,
  maxBatchBytes: 4 * MEBIBYTE,
  maxBatchDelayMs: 100,
  directoryConcurrency: 8,
  statConcurrency: 16,
  parserConcurrency: 4,
  maxMetadataCandidatesPerPage: 500,
  maxProgressHz: 4,
  maxErrorSamples: 100,
  maxRetryJobs: 10000,
  retryFraction: 0.05,
  minRetryJobs: 100,
  retryWallTimeMs: 60000
});

export const SCAN_REPOSITORY_METHODS = Object.freeze([
  'beginScanFolder',
  'preflightScanBatch',
  'commitScanSeenBatch',
  'listMetadataCandidates',
  'advanceScanMetadataCursor',
  'markScanEnumerationIneligible',
  'recordScanErrors',
  'finalizeScanEnumeration',
  'enqueueScanSweep',
  'runScanSweep',
  'completeScanFolder',
  'completeScanFolderNoSweep',
  'pauseScanFolder'
]);

export const SCAN_FILESYSTEM_METHODS = Object.freeze([
  'enumerateDirectory',
  'statFile'
]);

export class ScanServiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ScanServiceError';
    this.code = code;
    this.details = details;
  }
}

export class BoundedScanService {
  constructor({ repository, filesystem, metadataParser, onProgress = () => {}, config = {}, now = defaultNow }) {
    assertMethods(repository, SCAN_REPOSITORY_METHODS, 'scan repository');
    assertMethods(filesystem, SCAN_FILESYSTEM_METHODS, 'scan filesystem');
    assertRepositoryContract(typeof onProgress === 'function', 'invalidScanAdapter', 'onProgress must be a function');
    this.repository = repository;
    this.filesystem = filesystem;
    this.metadata = new MetadataParseService({ repository, parser: metadataParser });
    this.onProgress = onProgress;
    this.config = validateConfig({ ...DEFAULT_SCAN_SERVICE_CONFIG, ...config });
    this.now = now;
  }

  async runFolder({ scanId, folder, scanReason = 'automatic', resume = false, signal } = {}) {
    validateRunInput(scanId, folder);
    const run = await this.#mutation(() => this.repository.beginScanFolder({
      scanId,
      folderId: folder.id,
      normalizedRoot: folder.normalizedRoot ?? folder.path,
      expectedLifecycleVersion: folder.lifecycleVersion,
      resume,
      rootEnumerationRequired: true,
      continuityBroken: resume,
      sweepEligibility: resume ? 'INELIGIBLE' : 'PENDING'
    }));
    assertRunContract(run, folder, resume);

    const context = this.#createContext(run, folder, scanReason, resume, signal);
    await this.#preflight(context, { tracks: 0, bytes: 0, initial: true });
    const batcher = new TimedBatch({
      maxItems: this.config.maxBatchTracks,
      maxBytes: this.config.maxBatchBytes,
      maxDelayMs: this.config.maxBatchDelayMs,
      sizeOf: estimateObservationBytes,
      flush: batch => this.#commitBatch(context, batch)
    });

    try {
      await this.#enumerateRoot(context, batcher);
      await batcher.finish();
      await this.#flushErrors(context);
      const finalized = await this.#mutation(() => this.repository.finalizeScanEnumeration({
        ...runIdentity(context),
        rootToEnd: true,
        enumerationErrorCount: context.counts.enumerationErrors,
        continuityBroken: context.resume || context.ineligible,
        requestedSweepEligibility: context.resume || context.ineligible ? 'INELIGIBLE' : 'ELIGIBLE'
      }));

      if (isFreshEligibleSweep(finalized, context)) {
        await this.#mutation(() => this.repository.enqueueScanSweep({
          ...runIdentity(context),
          expectedSweepEligibility: 'ELIGIBLE',
          expectedContinuityBroken: false
        }));
        let sweep;
        do {
          this.#throwIfAborted(context.signal);
          sweep = await this.#mutation(() => this.repository.runScanSweep({
            ...runIdentity(context),
            expectedSweepEligibility: 'ELIGIBLE',
            expectedContinuityBroken: false
          }));
        } while (sweep?.hasMore === true);
        await this.#mutation(() => this.repository.completeScanFolder({
          ...runIdentity(context),
          status: 'completed'
        }));
        context.status = 'completed';
      } else {
        await this.#mutation(() => this.repository.completeScanFolderNoSweep({
          ...runIdentity(context),
          status: 'completed-no-sweep',
          sweepBlockReason: finalized?.sweepBlockReason ?? (context.resume ? 'resumed-generation' : 'enumeration-error')
        }));
        context.status = 'completed-no-sweep';
      }
      this.#progress(context, true);
      return freezeResult(context);
    } catch (error) {
      await batcher.abort();
      if (error?.name === 'AbortError' || signal?.aborted) {
        await this.#mutation(() => this.repository.pauseScanFolder({
          ...runIdentity(context),
          status: 'paused',
          stopReason: 'user',
          continuityBroken: true,
          sweepEligibility: 'INELIGIBLE'
        }));
      } else if (error?.code !== 'insufficientStorage') {
        await this.#mutation(() => this.repository.pauseScanFolder({
          ...runIdentity(context),
          status: 'paused',
          stopReason: 'system',
          continuityBroken: true,
          sweepEligibility: 'INELIGIBLE',
          sweepBlockReason: 'service-error'
        }));
      }
      throw error;
    }
  }

  #createContext(run, folder, scanReason, resume, signal) {
    return {
      run,
      folder,
      scanReason,
      resume,
      signal,
      ineligible: resume,
      firstEnumerationErrorMarked: false,
      pendingErrorCount: 0,
      pendingErrorSamples: [],
      errorSamplesRecorded: 0,
      status: 'enumerating',
      startedAt: this.now(),
      lastProgressAt: Number.NEGATIVE_INFINITY,
      counts: {
        found: run.visitedFiles ?? 0,
        parsed: 0,
        unchanged: 0,
        metadataRetryable: 0,
        metadataTerminal: 0,
        metadataRetryDeferred: 0,
        enumerationErrors: 0,
        committedBatches: run.committedBatches ?? 0
      },
      queueHighWater: { items: 1, bytes: estimateDirectoryBytes('') },
      retryJobs: 0,
      retryStartedAt: null,
      durableVisitedFiles: run.visitedFiles ?? 0,
      metadataCursor: run.metadataCursor ?? null
    };
  }

  async #enumerateRoot(context, batcher) {
    const queue = new DirectoryQueue(this.config);
    queue.push('');
    const pendingStats = [];
    while (queue.length) {
      this.#throwIfAborted(context.signal);
      const directories = queue.shiftMany(this.config.directoryConcurrency);
      const active = await Promise.all(directories.map(async relativeDirectory => ({
        relativeDirectory,
        iterator: toAsyncIterator(await this.filesystem.enumerateDirectory({
          root: context.folder.path,
          relativeDirectory,
          signal: context.signal
        }))
      })));

      while (active.length) {
        this.#throwIfAborted(context.signal);
        const results = await Promise.all(active.map(async item => {
          try {
            return { item, next: await item.iterator.next() };
          } catch (error) {
            return { item, error };
          }
        }));
        for (let index = results.length - 1; index >= 0; index -= 1) {
          const result = results[index];
          if (result.error) {
            await this.#enumerationError(context, result.error, result.item.relativeDirectory, 'directory-iteration');
            active.splice(index, 1);
            continue;
          }
          if (result.next.done) {
            active.splice(index, 1);
            continue;
          }
          const entry = result.next.value;
          const relativePath = normalizeRelativePath(entry?.relativePath ?? joinRelative(result.item.relativeDirectory, entry?.name));
          if (entry?.kind === 'directory') {
            try {
              queue.push(relativePath);
              context.queueHighWater.items = Math.max(context.queueHighWater.items, queue.highWaterItems);
              context.queueHighWater.bytes = Math.max(context.queueHighWater.bytes, queue.highWaterBytes);
            } catch (error) {
              await this.#enumerationError(context, error, relativePath, 'traversal-queue');
              throw error;
            }
          } else if (entry?.kind === 'file') {
            pendingStats.push({ ...entry, relativePath });
            if (pendingStats.length >= this.config.statConcurrency) {
              await this.#statFiles(context, pendingStats.splice(0), batcher);
            }
          } else if (entry?.kind === 'error') {
            await this.#enumerationError(context, entry.error, relativePath, entry.phase ?? 'enumeration');
          }
        }
      }
      if (pendingStats.length) await this.#statFiles(context, pendingStats.splice(0), batcher);
    }
  }

  async #statFiles(context, files, batcher) {
    const results = await Promise.all(files.map(async file => {
      try {
        const stat = await this.filesystem.statFile({
          root: context.folder.path,
          entry: file,
          signal: context.signal
        });
        return { file, stat };
      } catch (error) {
        return { file, error };
      }
    }));
    for (const result of results) {
      if (result.error) {
        await this.#enumerationError(context, result.error, result.file.relativePath, 'stat');
        continue;
      }
      let observation;
      try {
        observation = Object.freeze({
          relativePath: result.file.relativePath,
          path: result.file.path,
          fileIdentity: String(result.stat.fileIdentity ?? ''),
          size: toSafeNonNegativeInteger(result.stat.size, 'size'),
          mtimeMs: toSafeNonNegativeInteger(Math.round(result.stat.mtimeMs), 'mtimeMs')
        });
      } catch (error) {
        await this.#enumerationError(context, error, result.file.relativePath, 'stat');
        continue;
      }
      context.counts.found += 1;
      await batcher.add(observation);
      this.#progress(context);
    }
  }

  async #commitBatch(context, batch) {
    this.#throwIfAborted(context.signal);
    await this.#preflight(context, { tracks: batch.items.length, bytes: batch.bytes });
    const nextCommittedBatch = context.counts.committedBatches + 1;
    const nextVisitedFiles = context.durableVisitedFiles + batch.items.length;
    await this.#mutation(() => this.repository.commitScanSeenBatch({
      ...runIdentity(context),
      observations: batch.items,
      expectedLifecycleVersion: context.run.lifecycleVersion,
      maxTracks: this.config.maxBatchTracks,
      maxBytes: this.config.maxBatchBytes,
      lastCommittedBatch: nextCommittedBatch,
      cursor: Object.freeze({
        lastRelativePath: batch.items.at(-1)?.relativePath ?? null,
        visitedFiles: nextVisitedFiles,
        committedBatches: nextCommittedBatch
      })
    }));
    context.durableVisitedFiles = nextVisitedFiles;
    context.counts.committedBatches = nextCommittedBatch;
    await this.#drainMetadata(context);
    await this.#flushErrors(context);
  }

  async #drainMetadata(context) {
    let cursor = context.metadataCursor;
    do {
      const page = await this.repository.listMetadataCandidates({
        ...runIdentity(context),
        cursor,
        limit: this.config.maxMetadataCandidatesPerPage,
        parserVersion: context.run.parserVersion
      });
      const items = page?.items ?? [];
      const candidates = [];
      for (const candidate of items) {
        this.#throwIfAborted(context.signal);
        if (isUnchangedMetadataRetry(candidate) && !this.#consumeRetryCredit(context)) {
          context.counts.metadataRetryDeferred += 1;
          continue;
        }
        candidates.push(candidate);
      }
      const results = await this.#mutation(() => this.metadata.processBatch(candidates, {
        scanReason: context.scanReason,
        signal: context.signal,
        concurrency: this.config.parserConcurrency
      }));
      for (const result of results) {
        if (result.status !== 'committed') {
          if (result.reason === 'unchanged-ok') context.counts.unchanged += 1;
          continue;
        }
        context.counts.parsed += 1;
        if (result.metadataStatus === 'retryable-error') context.counts.metadataRetryable += 1;
        if (result.metadataStatus === 'terminal-error') context.counts.metadataTerminal += 1;
      }
      const resumeCursor = page?.resumeCursor ?? cursor;
      if (resumeCursor !== cursor) {
        await this.#mutation(() => this.repository.advanceScanMetadataCursor({
          ...runIdentity(context),
          cursor: resumeCursor
        }));
        context.metadataCursor = resumeCursor;
      }
      cursor = page?.nextCursor ?? null;
    } while (cursor !== null);
  }

  #consumeRetryCredit(context) {
    const allowedByFiles = Math.min(
      this.config.maxRetryJobs,
      Math.max(this.config.minRetryJobs, Math.ceil(context.counts.found * this.config.retryFraction))
    );
    if (context.retryJobs >= allowedByFiles) return false;
    const now = this.now();
    context.retryStartedAt ??= now;
    if (now - context.retryStartedAt >= this.config.retryWallTimeMs) return false;
    context.retryJobs += 1;
    return true;
  }

  async #enumerationError(context, error, relativePath, phase) {
    context.ineligible = true;
    context.counts.enumerationErrors += 1;
    context.pendingErrorCount += 1;
    const sample = {
        phase,
        relativePath: sanitizeRelativePath(relativePath),
        errorCode: sanitizeErrorCode(error?.code),
        retryable: true
      };
    if (!context.firstEnumerationErrorMarked) {
      await this.#mutation(() => this.repository.markScanEnumerationIneligible({
        ...runIdentity(context),
        continuityBroken: false,
        sweepEligibility: 'INELIGIBLE',
        sweepBlockReason: 'enumeration-error',
        incrementErrorCount: 1,
        sample
      }));
      context.firstEnumerationErrorMarked = true;
      context.pendingErrorCount -= 1;
      context.errorSamplesRecorded += 1;
    } else if (context.errorSamplesRecorded + context.pendingErrorSamples.length < this.config.maxErrorSamples) {
      context.pendingErrorSamples.push(sample);
    }
  }

  async #flushErrors(context) {
    if (!context.pendingErrorCount && !context.pendingErrorSamples.length) return;
    const count = context.pendingErrorCount;
    const samples = context.pendingErrorSamples.splice(0, this.config.maxErrorSamples);
    context.pendingErrorCount = 0;
    await this.#mutation(() => this.repository.recordScanErrors({
      ...runIdentity(context),
      occurrenceCount: count,
      samples,
      maxSamples: this.config.maxErrorSamples
    }));
    context.errorSamplesRecorded += samples.length;
  }

  async #preflight(context, batch) {
    const result = await this.repository.preflightScanBatch({
      ...runIdentity(context),
      estimatedTrackCount: batch.tracks,
      estimatedBatchBytes: batch.bytes,
      initial: batch.initial === true
    });
    if (result?.ok !== true) {
      await this.#mutation(() => this.repository.pauseScanFolder({
        ...runIdentity(context),
        status: 'paused',
        stopReason: 'storage',
        continuityBroken: true,
        sweepEligibility: 'INELIGIBLE',
        storage: safeStorageDetails(result)
      }));
      throw new ScanServiceError('insufficientStorage', 'Scan paused because storage preflight failed', safeStorageDetails(result));
    }
  }

  async #mutation(operation) {
    return operation();
  }

  #progress(context, force = false) {
    const now = this.now();
    const interval = 1000 / this.config.maxProgressHz;
    if (!force && now - context.lastProgressAt < interval) return;
    context.lastProgressAt = now;
    this.onProgress(Object.freeze({
      scanId: context.run.scanId,
      folderId: context.run.folderId,
      generation: context.run.generation,
      status: context.status,
      counts: Object.freeze({ ...context.counts }),
      queueHighWater: Object.freeze({ ...context.queueHighWater }),
      durationMs: Math.max(0, now - context.startedAt)
    }));
  }

  #throwIfAborted(signal) {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error ? signal.reason : new DOMException('Scan aborted', 'AbortError');
  }

}

class DirectoryQueue {
  constructor(config) {
    this.config = config;
    this.items = [];
    this.bytes = 0;
    this.highWaterItems = 0;
    this.highWaterBytes = 0;
  }

  get length() {
    return this.items.length;
  }

  push(relativeDirectory) {
    const bytes = estimateDirectoryBytes(relativeDirectory);
    if (this.items.length + 1 > this.config.maxQueuedDirectories ||
        this.bytes + bytes > this.config.maxQueuedDirectoryBytes) {
      throw new ScanServiceError('scanTraversalQueueLimit', 'Scan traversal queue limit exceeded', {
        maxItems: this.config.maxQueuedDirectories,
        maxBytes: this.config.maxQueuedDirectoryBytes
      });
    }
    this.items.push({ relativeDirectory, bytes });
    this.bytes += bytes;
    this.highWaterItems = Math.max(this.highWaterItems, this.items.length);
    this.highWaterBytes = Math.max(this.highWaterBytes, this.bytes);
  }

  shiftMany(count) {
    const shifted = this.items.splice(0, count);
    for (const item of shifted) this.bytes -= item.bytes;
    return shifted.map(item => item.relativeDirectory);
  }
}

class TimedBatch {
  constructor({ maxItems, maxBytes, maxDelayMs, sizeOf, flush }) {
    Object.assign(this, { maxItems, maxBytes, maxDelayMs, sizeOf, flushBatch: flush });
    this.items = [];
    this.bytes = 0;
    this.timer = null;
    this.tail = Promise.resolve();
    this.failure = null;
  }

  async add(item) {
    await this.tail;
    if (this.failure) throw this.failure;
    const bytes = this.sizeOf(item);
    if (bytes > this.maxBytes) throw new ScanServiceError('scanBatchItemTooLarge', 'A scan observation exceeds the batch byte limit');
    if (this.items.length && (this.items.length + 1 > this.maxItems || this.bytes + bytes > this.maxBytes)) {
      await this.flush();
    }
    this.items.push(item);
    this.bytes += bytes;
    this.#schedule();
    if (this.items.length >= this.maxItems || this.bytes >= this.maxBytes) await this.flush();
  }

  async flush() {
    if (!this.items.length) return this.tail;
    clearTimeout(this.timer);
    this.timer = null;
    const batch = { items: this.items, bytes: this.bytes };
    this.items = [];
    this.bytes = 0;
    this.tail = this.tail.then(() => this.flushBatch(batch)).catch(error => {
      this.failure = error;
      throw error;
    });
    return this.tail;
  }

  async finish() {
    await this.flush();
    await this.tail;
    if (this.failure) throw this.failure;
  }

  async abort() {
    clearTimeout(this.timer);
    this.timer = null;
    this.items = [];
    this.bytes = 0;
    try {
      await this.tail;
    } catch {
      // The original failure is rethrown by the scan service.
    }
  }

  #schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.flush().catch(() => {});
    }, this.maxDelayMs);
  }
}

async function mapConcurrent(items, concurrency, operation) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await operation(items[current]);
    }
  });
  await Promise.all(workers);
}

function toAsyncIterator(iterable) {
  if (iterable?.[Symbol.asyncIterator]) return iterable[Symbol.asyncIterator]();
  if (iterable?.[Symbol.iterator]) {
    const iterator = iterable[Symbol.iterator]();
    return { next: () => Promise.resolve(iterator.next()) };
  }
  throw createRepositoryError('invalidScanEnumerator', 'enumerateDirectory() must return an iterable');
}

function isFreshEligibleSweep(finalized, context) {
  return !context.resume && !context.ineligible &&
    finalized?.sweepEligibility === 'ELIGIBLE' &&
    finalized?.continuityBroken === false &&
    Number(finalized?.enumerationErrorCount ?? 0) === 0;
}

function runIdentity(context) {
  return {
    scanId: context.run.scanId,
    folderId: context.run.folderId,
    generation: context.run.generation,
    expectedLifecycleVersion: context.run.lifecycleVersion
  };
}

function freezeResult(context) {
  return Object.freeze({
    ...runIdentity(context),
    status: context.status,
    continuityBroken: context.resume || context.ineligible,
    sweepEligibility: context.status === 'completed' ? 'ELIGIBLE' : 'INELIGIBLE',
    counts: Object.freeze({ ...context.counts }),
    queueHighWater: Object.freeze({ ...context.queueHighWater }),
    durationMs: Math.max(0, context.lastProgressAt - context.startedAt)
  });
}

function validateRunInput(scanId, folder) {
  assertRepositoryContract(typeof scanId === 'string' && scanId.length > 0, 'invalidScanRequest', 'scanId is required');
  assertRepositoryContract(typeof folder?.id === 'string' && folder.id.length > 0, 'invalidScanRequest', 'folder.id is required');
  assertRepositoryContract(typeof folder?.path === 'string' && folder.path.length > 0, 'invalidScanRequest', 'folder.path is required');
  assertRepositoryContract(Number.isSafeInteger(folder?.lifecycleVersion) && folder.lifecycleVersion >= 0, 'invalidScanRequest', 'folder.lifecycleVersion is required');
}

function assertRunContract(run, folder, resume) {
  assertRepositoryContract(run?.folderId === folder.id, 'invalidScanRun', 'Repository returned a different folder');
  assertRepositoryContract(Number.isSafeInteger(run?.generation) && run.generation >= 0, 'invalidScanRun', 'Repository must return a generation');
  assertRepositoryContract(run?.lifecycleVersion === folder.lifecycleVersion, 'invalidScanRun', 'Repository lifecycle version mismatch');
  assertRepositoryContract(
    Number.isSafeInteger(run?.visitedFiles) && run.visitedFiles >= 0,
    'invalidScanRun',
    'Repository must return the durable visited-file coordinate'
  );
  assertRepositoryContract(
    Number.isSafeInteger(run?.committedBatches) && run.committedBatches >= 0,
    'invalidScanRun',
    'Repository must return the durable committed-batch coordinate'
  );
  if (resume) {
    assertRepositoryContract(run.continuityBroken === true && run.sweepEligibility === 'INELIGIBLE', 'invalidScanRun', 'Resumed runs must remain sweep-ineligible');
  }
}

function validateConfig(config) {
  for (const field of [
    'maxQueuedDirectories', 'maxQueuedDirectoryBytes', 'maxBatchTracks', 'maxBatchBytes',
    'maxBatchDelayMs', 'directoryConcurrency', 'statConcurrency', 'parserConcurrency',
    'maxMetadataCandidatesPerPage', 'maxProgressHz', 'maxErrorSamples'
  ]) {
    assertRepositoryContract(Number.isSafeInteger(config[field]) && config[field] > 0, 'invalidScanConfig', `${field} must be a positive integer`);
  }
  return Object.freeze(config);
}

function estimateObservationBytes(observation) {
  return 128 + utf8Length(observation.relativePath) + utf8Length(observation.fileIdentity);
}

function estimateDirectoryBytes(relativeDirectory) {
  return 64 + utf8Length(relativeDirectory);
}

function utf8Length(value) {
  return new TextEncoder().encode(String(value ?? '')).byteLength;
}

function normalizeRelativePath(value) {
  const path = String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '');
  assertRepositoryContract(path && !path.split('/').includes('..'), 'invalidScanPath', 'Enumerator returned an unsafe relative path');
  return path;
}

function sanitizeRelativePath(value) {
  return String(value ?? '').replace(/[\r\n\0]/g, '').slice(0, 1024);
}

function joinRelative(directory, name) {
  return directory ? `${directory}/${name ?? ''}` : String(name ?? '');
}

function sanitizeErrorCode(value) {
  const code = String(value ?? '').toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,62}$/.test(code) ? code : 'unknown-error';
}

function toSafeNonNegativeInteger(value, field) {
  assertRepositoryContract(Number.isSafeInteger(value) && value >= 0, 'invalidScanStat', `${field} must be a non-negative safe integer`);
  return value;
}

function safeStorageDetails(result) {
  return {
    availableBytes: safeIntegerOrZero(result?.availableBytes),
    requiredAvailableBytes: safeIntegerOrZero(result?.requiredAvailableBytes),
    shortfallBytes: safeIntegerOrZero(result?.shortfallBytes)
  };
}

function safeIntegerOrZero(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function assertMethods(target, methods, label) {
  assertRepositoryContract(target && typeof target === 'object', 'invalidScanAdapter', `${label} is required`);
  for (const method of methods) {
    assertRepositoryContract(typeof target[method] === 'function', 'invalidScanAdapter', `${label} must provide ${method}()`);
  }
}

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function isUnchangedMetadataRetry(candidate) {
  if (candidate?.metadataStatus !== 'retryable-error' || !candidate.storedSignature) return false;
  if (candidate.storedParserVersion !== candidate.parserVersion) return false;
  const left = candidate.storedSignature;
  const right = candidate.observedSignature;
  return Boolean(right) && left.fileIdentity === right.fileIdentity &&
    left.size === right.size && left.mtimeMs === right.mtimeMs &&
    Number(candidate.attemptsForSignature ?? 0) > 0;
}
