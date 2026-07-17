import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';
import {
  CUE_MAX_BYTES,
  createCueSignature,
  createCueTrackMetadata,
  createPlainLogicalStorageId,
  decodeCueBytes,
  parseCueSheet,
  resolveCueSheet,
  validateCueDurations
} from '../metadata/cue-sheet.js';
import { classifyMetadataParseError, MetadataParseService } from './metadata-parse-service.js';

const MEBIBYTE = 1024 * 1024;
const CUE_STAGE_PAGE_ROWS = 8;
const CUE_WARNING_CATEGORIES = Object.freeze([
  'cue-invalid',
  'cue-unsupported',
  'cue-too-large'
]);

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
  'cueDirectoryStage',
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
    this.metadataParser = metadataParser;
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
      weightOf: estimateObservationRows,
      flush: batch => this.#commitBatch(context, batch)
    });

    let destructiveSweepStarted = false;
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
        this.#throwIfAborted(context.signal);
        await this.#mutation(() => this.repository.enqueueScanSweep({
          ...runIdentity(context),
          expectedSweepEligibility: 'ELIGIBLE',
          expectedContinuityBroken: false
        }));
        destructiveSweepStarted = true;
        let sweep;
        do {
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
      if (destructiveSweepStarted) throw error;
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
      pendingWarningSamples: [],
      cueWarningCounts: Object.fromEntries(CUE_WARNING_CATEGORIES.map(category => [category, 0])),
      cueWarningSamples: [],
      diagnosticSamplesRecorded: 0,
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
        cueWarnings: 0,
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
    while (queue.length) {
      this.#throwIfAborted(context.signal);
      const directories = queue.shiftMany(this.config.directoryConcurrency);
      const results = await Promise.all(directories.map(relativeDirectory =>
        this.#readDirectory(context, relativeDirectory, batcher)));
      for (const result of results) {
        for (const relativePath of result.directories) {
          try {
            queue.push(relativePath);
            context.queueHighWater.items = Math.max(context.queueHighWater.items, queue.highWaterItems);
            context.queueHighWater.bytes = Math.max(context.queueHighWater.bytes, queue.highWaterBytes);
          } catch (error) {
            await this.#enumerationError(context, error, relativePath, 'traversal-queue');
            throw error;
          }
        }
        await this.#processCueDirectory(context, result.relativeDirectory, result.barrierCount, batcher, result.failed);
      }
    }
  }

  async #readDirectory(context, relativeDirectory, batcher) {
    const result = { relativeDirectory, directories: [], barrierCount: 0, failed: false };
    const ordinaryPage = [];
    const barrierPage = [];
    let barrierSequence = 0;
    let iterator;
    try {
      await this.#cueStage(context, relativeDirectory, 'reset');
      iterator = toAsyncIterator(await this.filesystem.enumerateDirectory({
        root: context.folder.path,
        relativeDirectory,
        signal: context.signal
      }));
      for (;;) {
        this.#throwIfAborted(context.signal);
        const next = await iterator.next();
        if (next.done) break;
        const entry = next.value;
        const relativePath = normalizeRelativePath(entry?.relativePath ?? joinRelative(relativeDirectory, entry?.name));
        if (entry?.kind === 'directory') result.directories.push(relativePath);
        else if (entry?.kind === 'cue' || (entry?.kind === 'file' && isCueBarrierPath(relativePath))) {
          barrierPage.push({
            relativePath,
            path: entry?.path ?? null,
            kind: isCuePath(relativePath) ? 'cue' : 'audio',
            sequence: barrierSequence++
          });
          result.barrierCount += 1;
          if (barrierPage.length >= CUE_STAGE_PAGE_ROWS) {
            await this.#cueStage(context, relativeDirectory, 'append-entries', { entries: barrierPage.splice(0) });
          }
        } else if (entry?.kind === 'file') {
          ordinaryPage.push({ ...entry, relativePath });
          if (ordinaryPage.length >= this.config.statConcurrency) {
            await this.#statFiles(context, ordinaryPage.splice(0), batcher);
          }
        }
        else if (entry?.kind === 'error') {
          result.failed = true;
          await this.#enumerationError(context, entry.error, relativePath, entry.phase ?? 'enumeration');
        }
      }
      if (ordinaryPage.length) await this.#statFiles(context, ordinaryPage.splice(0), batcher);
      if (barrierPage.length) {
        await this.#cueStage(context, relativeDirectory, 'append-entries', { entries: barrierPage.splice(0) });
      }
    } catch (error) {
      this.#throwIfAborted(context.signal);
      result.failed = true;
      await this.#enumerationError(context, error, relativeDirectory, 'directory-iteration');
    }
    return result;
  }

  async #processCueDirectory(context, relativeDirectory, barrierCount, batcher, enumerationFailed) {
    if (enumerationFailed) {
      await this.#cueStage(context, relativeDirectory, 'clear');
      return;
    }
    if (barrierCount === 0) {
      await this.#cueStage(context, relativeDirectory, 'clear');
      return;
    }
    if (await this.#stageCueObservations(context, relativeDirectory)) {
      await this.#cueStage(context, relativeDirectory, 'clear');
      return;
    }
    const retryableFailure = await this.#stageCueSheetsAndMetadata(context, relativeDirectory);
    if (retryableFailure) {
      await this.#enumerationError(
        context, retryableFailure.error, retryableFailure.relativePath, retryableFailure.phase
      );
      await this.#cueStage(context, relativeDirectory, 'clear');
      return;
    }
    const validationFailure = await this.#validateAndAcceptCueSheets(context, relativeDirectory);
    if (validationFailure) {
      await this.#enumerationError(
        context, validationFailure.error, validationFailure.relativePath, validationFailure.phase
      );
      await this.#cueStage(context, relativeDirectory, 'clear');
      return;
    }
    await this.#publishCueDirectory(context, relativeDirectory, batcher);
    await this.#cueStage(context, relativeDirectory, 'clear');
  }

  async #stageCueObservations(context, relativeDirectory) {
    let cursor = null;
    let failed = false;
    do {
      const page = await this.#cueStage(context, relativeDirectory, 'list-files', {
        cursor,
        limit: CUE_STAGE_PAGE_ROWS
      });
      const results = await Promise.all(page.items.map(async file => {
        try {
          return { file, stat: await this.filesystem.statFile({
            root: context.folder.path,
            entry: file,
            signal: context.signal
          }) };
        } catch (error) {
          return { file, error };
        }
      }));
      const observations = [];
      for (const result of results) {
        if (result.error) {
          this.#throwIfAborted(context.signal);
          failed = true;
          await this.#enumerationError(context, result.error, result.file.relativePath, 'stat');
          continue;
        }
        try {
          observations.push(createObservation(result.file, result.stat));
          context.counts.found += 1;
          this.#progress(context);
        } catch (error) {
          failed = true;
          await this.#enumerationError(context, error, result.file.relativePath, 'stat');
        }
      }
      if (observations.length) {
        await this.#cueStage(context, relativeDirectory, 'update-observations', { observations });
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return failed;
  }

  async #stageCueSheetsAndMetadata(context, relativeDirectory) {
    let cursor = null;
    do {
      const page = await this.#cueStage(context, relativeDirectory, 'list-files', {
        cursor,
        limit: 1,
        kind: 'cue'
      });
      for (const cueObservation of page.items) {
        try {
          assertRepositoryContract(
            typeof this.filesystem.readSmallFile === 'function',
            'invalidScanAdapter',
            'CUE enumeration requires readSmallFile()'
          );
          const read = await this.filesystem.readSmallFile({
            root: context.folder.path,
            relativePath: cueObservation.relativePath,
            maximumBytes: CUE_MAX_BYTES,
            signal: context.signal
          });
          await this.#assertObservationFresh(
            context, cueObservation, 'CUE file changed while it was being read'
          );
          if (read?.tooLarge) {
            this.#cueWarning(context, 'cue-too-large', cueObservation.relativePath);
            continue;
          }
          const decoded = decodeCueBytes(read?.bytes);
          const parsed = decoded.ok
            ? parseCueSheet(decoded.text, { cueRelativePath: cueObservation.relativePath })
            : decoded;
          const resolved = await this.#resolveParsedCueSheet(context, relativeDirectory, parsed);
          if (!resolved.ok) {
            this.#cueWarning(context, resolved.code, cueObservation.relativePath);
            continue;
          }
          await this.#cueStage(context, relativeDirectory, 'stage-sheet', {
            cue: resolved,
            cueOrderKey: codeUnitOrderKey(resolved.cueRelativePath),
            cueSignature: createCueSignature({
              size: cueObservation.size,
              mtimeMs: cueObservation.mtimeMs,
              bytes: read.bytes
            })
          });
        } catch (error) {
          this.#throwIfAborted(context.signal);
          return { error, relativePath: cueObservation.relativePath, phase: 'cue-read' };
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== null);

    cursor = null;
    do {
      const page = await this.#cueStage(context, relativeDirectory, 'list-sources', {
        cursor,
        limit: CUE_STAGE_PAGE_ROWS
      });
      for (const observation of page.items) {
        try {
          const metadata = await this.metadataParser.parse({
            path: observation.path,
            relativePath: observation.relativePath,
            skipCovers: true,
            signal: context.signal
          });
          await this.#assertObservationFresh(
            context, observation, 'Referenced CUE source changed during metadata parsing'
          );
          await this.#cueStage(context, relativeDirectory, 'update-source', {
            relativePath: observation.relativePath,
            metadataStatus: 'ok',
            metadata
          });
        } catch (error) {
          this.#throwIfAborted(context.signal);
          const classification = classifyMetadataParseError(error);
          if (classification.retryable) {
            return { error, relativePath: observation.relativePath, phase: 'cue-source-metadata' };
          }
          try {
            await this.#assertObservationFresh(
              context, observation, 'Referenced CUE source changed during metadata parsing'
            );
          } catch (freshnessError) {
            this.#throwIfAborted(context.signal);
            return {
              error: freshnessError,
              relativePath: observation.relativePath,
              phase: 'cue-source-metadata'
            };
          }
          await this.#cueStage(context, relativeDirectory, 'update-source', {
            relativePath: observation.relativePath,
            metadataStatus: 'terminal'
          });
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return null;
  }

  async #validateAndAcceptCueSheets(context, relativeDirectory) {
    let cursor = null;
    do {
      const page = await this.#cueStage(context, relativeDirectory, 'list-sheets', {
        status: 'parsed',
        cursor,
        limit: 1
      });
      for (const record of page.items) {
        this.#throwIfAborted(context.signal);
        try {
          const stagedFile = await this.#cueStage(context, relativeDirectory, 'get-file', {
            relativePath: record.cueRelativePath
          });
          const cueObservation = stagedFile.file;
          const read = await this.filesystem.readSmallFile({
            root: context.folder.path,
            relativePath: cueObservation.relativePath,
            maximumBytes: CUE_MAX_BYTES,
            signal: context.signal
          });
          await this.#assertObservationFresh(
            context, cueObservation, 'CUE file changed during validation'
          );
          if (read?.tooLarge) throw createRepositoryError('transient-io', 'CUE file changed during validation');
          const signature = createCueSignature({
            size: cueObservation.size,
            mtimeMs: cueObservation.mtimeMs,
            bytes: read.bytes
          });
          if (signature !== record.cueSignature) {
            throw createRepositoryError('transient-io', 'CUE file changed during validation');
          }
          const decoded = decodeCueBytes(read.bytes);
          const parsed = decoded.ok
            ? parseCueSheet(decoded.text, { cueRelativePath: cueObservation.relativePath })
            : decoded;
          const resolved = await this.#resolveParsedCueSheet(context, relativeDirectory, parsed);
          if (!resolved.ok) {
            this.#cueWarning(context, resolved.code, record.cueRelativePath);
            await this.#cueStage(context, relativeDirectory, 'validate-sheet', {
              cueRelativePath: record.cueRelativePath,
              valid: false
            });
            continue;
          }
          const sourcePage = await this.#cueStage(context, relativeDirectory, 'get-source-metadata', {
            relativePaths: resolved.resolvedFiles
          });
          const terminal = sourcePage.items.some(item => item.metadataStatus !== 'ok');
          const metadata = new Map(sourcePage.items.map(item => [item.relativePath, item.metadata]));
          const checked = terminal ? null : validateCueDurations(resolved, metadata);
          if (terminal || !checked?.ok) {
            this.#cueWarning(
              context,
              terminal ? 'cue-source-metadata-unsupported' : checked.code,
              record.cueRelativePath
            );
            await this.#cueStage(context, relativeDirectory, 'validate-sheet', {
              cueRelativePath: record.cueRelativePath,
              valid: false
            });
          } else {
            await this.#cueStage(context, relativeDirectory, 'validate-sheet', {
              cueRelativePath: record.cueRelativePath,
              valid: true,
              durations: checked.tracks.map(track => ({
                trackNo: track.trackNo,
                durationSec: track.durationSec
              }))
            });
          }
        } catch (error) {
          this.#throwIfAborted(context.signal);
          return { error, relativePath: record.cueRelativePath, phase: 'cue-validation' };
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== null);

    cursor = null;
    do {
      const page = await this.#cueStage(context, relativeDirectory, 'list-sheets', {
        status: 'valid',
        cursor,
        limit: 1
      });
      for (const record of page.items) {
        this.#throwIfAborted(context.signal);
        const accepted = await this.#cueStage(context, relativeDirectory, 'accept-sheet', {
          cueRelativePath: record.cueRelativePath
        });
        if (!accepted.accepted) {
          this.#cueWarning(context, 'cue-source-conflict', record.cueRelativePath);
        }
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
    return null;
  }

  async #resolveParsedCueSheet(context, relativeDirectory, parsed) {
    if (!parsed.ok) return parsed;
    const references = parsed.files
      .filter(file => file.audioTrackCount > 0)
      .map(file => file.reference);
    const available = await this.#cueStage(context, relativeDirectory, 'resolve-references', { references });
    return resolveCueSheet(parsed, available.availableRelativePaths);
  }

  async #assertObservationFresh(context, observation, message) {
    let restat;
    try {
      restat = await this.filesystem.statFile({
        root: context.folder.path,
        entry: observation,
        signal: context.signal
      });
    } catch (error) {
      this.#throwIfAborted(context.signal);
      throw createRepositoryError('transient-io', message);
    }
    if (!sameObservationSignature(observation, restat)) {
      throw createRepositoryError('transient-io', message);
    }
  }

  async #publishCueDirectory(context, relativeDirectory, batcher) {
    let cursor = null;
    do {
      const page = await this.#cueStage(context, relativeDirectory, 'list-files', {
        cursor,
        limit: CUE_STAGE_PAGE_ROWS
      });
      for (const staged of page.items) {
        this.#throwIfAborted(context.signal);
        const observation = createObservation(staged, staged);
        let logicalCandidates = [];
        if (staged.kind === 'audio') {
          let trackCursor = null;
          let claimed = false;
          do {
            const logical = await this.#cueStage(context, relativeDirectory, 'list-logical', {
              relativePath: observation.relativePath,
              cursor: trackCursor,
              limit: CUE_STAGE_PAGE_ROWS
            });
            if (!logical.sheet) break;
            claimed = true;
            const record = logical.sheet;
            const cue = {
              cueRelativePath: record.cueRelativePath,
              disc: record.disc,
              tracks: { length: record.trackTotal }
            };
            logicalCandidates.push(...logical.items.map(track => ({
                logicalStorageId: track.logicalStorageId,
                relativePath: track.relativePath,
                path: observation.path,
                fileIdentity: observation.fileIdentity,
                size: observation.size,
                mtimeMs: observation.mtimeMs,
                sourceKind: 'cue-track',
                entryKey: track.entryKey,
                cueRelativePath: record.cueRelativePath,
                startFrame: track.startFrame,
                endFrame: track.endFrame,
                cueSignature: record.cueSignature,
                metadata: createCueTrackMetadata(cue, track, record.metadata)
              })));
            trackCursor = logical.nextCursor;
          } while (trackCursor !== null);
          if (!claimed) logicalCandidates = [createPlainLogicalCandidate(observation)];
        }
        await batcher.add({ ...observation, logicalCandidates });
      }
      cursor = page.nextCursor;
    } while (cursor !== null);
  }

  #cueStage(context, relativeDirectory, action, payload = {}) {
    return this.repository.cueDirectoryStage({
      ...runIdentity(context),
      directoryPath: relativeDirectory,
      action,
      ...payload
    });
  }

  #cueWarning(context, code, relativePath) {
    const normalizedCode = sanitizeErrorCode(code);
    const category = cueWarningCategory(normalizedCode);
    const path = sanitizeRelativePath(relativePath);
    context.counts.cueWarnings += 1;
    context.cueWarningCounts[category] += 1;
    if (context.cueWarningSamples.length < this.config.maxErrorSamples) {
      context.cueWarningSamples.push(Object.freeze({ category, code: normalizedCode, path }));
    }
    if (
      context.diagnosticSamplesRecorded + context.pendingErrorSamples.length +
        context.pendingWarningSamples.length >= this.config.maxErrorSamples
    ) return;
    context.pendingWarningSamples.push({
      category: 'cue-warning',
      code: normalizedCode,
      path
    });
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
        this.#throwIfAborted(context.signal);
        await this.#enumerationError(context, result.error, result.file.relativePath, 'stat');
        continue;
      }
      let observation;
      try {
        observation = createObservation(result.file, result.stat);
      } catch (error) {
        await this.#enumerationError(context, error, result.file.relativePath, 'stat');
        continue;
      }
      context.counts.found += 1;
      await batcher.add({ ...observation, logicalCandidates: [createPlainLogicalCandidate(observation)] });
      this.#progress(context);
    }
  }

  async #commitBatch(context, batch) {
    this.#throwIfAborted(context.signal);
    await this.#preflight(context, { tracks: batch.weight, bytes: batch.bytes });
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
      category: 'enumeration',
      code: sanitizeErrorCode(error?.code),
      path: sanitizeRelativePath(relativePath),
      phase,
      retryable: true
    };
    if (!context.firstEnumerationErrorMarked) {
      if (
        context.diagnosticSamplesRecorded + context.pendingErrorSamples.length +
          context.pendingWarningSamples.length >= this.config.maxErrorSamples
      ) context.pendingWarningSamples.pop();
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
      context.diagnosticSamplesRecorded += 1;
    } else if (
      context.diagnosticSamplesRecorded + context.pendingErrorSamples.length +
        context.pendingWarningSamples.length < this.config.maxErrorSamples
    ) {
      context.pendingErrorSamples.push(sample);
    }
  }

  async #flushErrors(context) {
    if (!context.pendingErrorCount && !context.pendingErrorSamples.length && !context.pendingWarningSamples.length) return;
    const count = context.pendingErrorCount;
    const capacity = this.config.maxErrorSamples - context.diagnosticSamplesRecorded;
    const errors = context.pendingErrorSamples.splice(0);
    const warnings = context.pendingWarningSamples.splice(0);
    const samples = errors.slice(0, capacity);
    samples.push(...warnings.slice(0, capacity - samples.length));
    context.pendingErrorCount = 0;
    await this.#mutation(() => this.repository.recordScanErrors({
      ...runIdentity(context),
      occurrenceCount: count,
      samples,
      maxSamples: this.config.maxErrorSamples
    }));
    context.diagnosticSamplesRecorded += samples.length;
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
      warnings: freezeCueWarnings(context),
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
  constructor({ maxItems, maxBytes, maxDelayMs, sizeOf, weightOf, flush }) {
    Object.assign(this, { maxItems, maxBytes, maxDelayMs, sizeOf, weightOf, flushBatch: flush });
    this.items = [];
    this.bytes = 0;
    this.weight = 0;
    this.timer = null;
    this.tail = Promise.resolve();
    this.failure = null;
  }

  async add(item) {
    await this.tail;
    if (this.failure) throw this.failure;
    const bytes = this.sizeOf(item);
    const weight = this.weightOf(item);
    if (bytes > this.maxBytes) throw new ScanServiceError('scanBatchItemTooLarge', 'A scan observation exceeds the batch byte limit');
    if (!Number.isSafeInteger(weight) || weight < 1 || weight > this.maxItems) {
      throw new ScanServiceError('scanBatchItemTooLarge', 'A scan observation exceeds the batch row limit');
    }
    if (this.items.length && (this.weight + weight > this.maxItems || this.bytes + bytes > this.maxBytes)) {
      await this.flush();
    }
    this.items.push(item);
    this.bytes += bytes;
    this.weight += weight;
    this.#schedule();
    if (this.weight >= this.maxItems || this.bytes >= this.maxBytes) await this.flush();
  }

  async flush() {
    if (!this.items.length) return this.tail;
    clearTimeout(this.timer);
    this.timer = null;
    const batch = { items: this.items, bytes: this.bytes, weight: this.weight };
    this.items = [];
    this.bytes = 0;
    this.weight = 0;
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
    this.weight = 0;
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
    warnings: freezeCueWarnings(context),
    queueHighWater: Object.freeze({ ...context.queueHighWater }),
    durationMs: Math.max(0, context.lastProgressAt - context.startedAt)
  });
}

function freezeCueWarnings(context) {
  return Object.freeze(CUE_WARNING_CATEGORIES.flatMap(category => {
    const count = context.cueWarningCounts[category];
    if (count === 0) return [];
    return [Object.freeze({
      category,
      count,
      samples: Object.freeze(context.cueWarningSamples
        .filter(sample => sample.category === category)
        .map(sample => Object.freeze({ code: sample.code, path: sample.path })))
    })];
  }));
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
  return 128 + utf8Length(observation.relativePath) + utf8Length(observation.fileIdentity) +
    utf8Length(JSON.stringify(observation.logicalCandidates ?? []));
}

function estimateObservationRows(observation) {
  const count = Array.isArray(observation.logicalCandidates) ? observation.logicalCandidates.length : 1;
  return Math.max(1, count);
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

function cueWarningCategory(code) {
  if (code === 'cue-too-large') return 'cue-too-large';
  if (code === 'cue-no-audio-tracks' || code === 'cue-source-metadata-unsupported') {
    return 'cue-unsupported';
  }
  return 'cue-invalid';
}

function toSafeNonNegativeInteger(value, field) {
  assertRepositoryContract(Number.isSafeInteger(value) && value >= 0, 'invalidScanStat', `${field} must be a non-negative safe integer`);
  return value;
}

function createObservation(file, stat) {
  return Object.freeze({
    relativePath: file.relativePath,
    path: file.path,
    fileIdentity: String(stat.fileIdentity ?? ''),
    size: toSafeNonNegativeInteger(stat.size, 'size'),
    mtimeMs: toSafeNonNegativeInteger(Math.round(stat.mtimeMs), 'mtimeMs')
  });
}

function createPlainLogicalCandidate(observation) {
  return Object.freeze({
    logicalStorageId: createPlainLogicalStorageId(observation.relativePath),
    relativePath: observation.relativePath,
    path: observation.path,
    fileIdentity: observation.fileIdentity,
    size: observation.size,
    mtimeMs: observation.mtimeMs,
    sourceKind: 'file',
    entryKey: null,
    cueRelativePath: null,
    startFrame: null,
    endFrame: null,
    cueSignature: null,
    metadata: null
  });
}

function isCueBarrierPath(relativePath) {
  const extension = fileExtension(relativePath);
  return extension === 'cue' || extension === 'wav' || extension === 'flac';
}

function isCuePath(relativePath) {
  return fileExtension(relativePath) === 'cue';
}

function fileExtension(relativePath) {
  const name = String(relativePath ?? '').split('/').at(-1) ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function sameObservationSignature(observation, stat) {
  return observation.fileIdentity === String(stat.fileIdentity ?? '') &&
    observation.size === Number(stat.size) &&
    observation.mtimeMs === Math.round(Number(stat.mtimeMs));
}

function codeUnitOrderKey(value) {
  let key = '';
  for (let index = 0; index < value.length; index += 1) {
    key += value.charCodeAt(index).toString(16).padStart(4, '0');
  }
  return key;
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
