import { assertRepositoryContract, createRepositoryError } from '../repository/contract-errors.js';
import {
  metadataCompletionMatchesClaim,
  shouldDispatchMetadataParse
} from './scan-state-machine.js';

const TERMINAL_ERROR_CODES = new Set([
  'corrupt-container',
  'corrupt-tag',
  'unsupported-codec',
  'unsupported-container',
  'metadata-too-large',
  'deterministic-decoder-rejection'
]);

const RETRYABLE_ERROR_CODES = new Set([
  'transient-io',
  'temporary-permission',
  'handle-expired',
  'worker-crash',
  'parse-timeout',
  'resource-exhausted',
  'service-interrupted'
]);

export const METADATA_REPOSITORY_METHODS = Object.freeze([
  'claimMetadataParse',
  'completeMetadataParseSuccess',
  'completeMetadataParseFailure',
  'requeueLatestMetadata',
  'recoverInterruptedMetadataClaims'
]);

export function metadataParseEligibility(candidate, { scanReason = 'automatic' } = {}) {
  assertRepositoryContract(candidate && typeof candidate === 'object', 'invalidMetadataCandidate', 'Metadata candidate is required');
  return shouldDispatchMetadataParse({
    status: candidate.metadataStatus,
    storedSignature: candidate.storedSignature,
    observedSignature: candidate.observedSignature,
    storedParserVersion: candidate.storedParserVersion,
    parserVersion: candidate.parserVersion,
    attemptCount: candidate.attemptsForSignature,
    lastAttemptGeneration: candidate.attemptedGeneration,
    generation: candidate.generation,
    explicitRescan: scanReason === 'explicit-rescan'
  });
}

export function classifyMetadataParseError(error) {
  const code = sanitizeErrorCode(error?.code);
  if (TERMINAL_ERROR_CODES.has(code)) {
    return Object.freeze({ metadataStatus: 'terminal-error', errorCode: code, retryable: false });
  }
  return Object.freeze({
    metadataStatus: 'retryable-error',
    errorCode: RETRYABLE_ERROR_CODES.has(code) ? code : 'unknown-internal',
    retryable: true
  });
}

export class MetadataParseService {
  constructor({ repository, parser }) {
    assertMethods(repository, METADATA_REPOSITORY_METHODS, 'metadata repository');
    assertRepositoryContract(typeof parser?.parse === 'function', 'invalidMetadataParser', 'Metadata parser must provide parse()');
    this.repository = repository;
    this.parser = parser;
  }

  async recoverInterruptedClaims() {
    return this.repository.recoverInterruptedMetadataClaims({
      metadataStatus: 'retryable-error',
      errorCode: 'service-interrupted',
      preserveLastKnownGood: true,
      updateDerivedData: false
    });
  }

  async process(candidate, { scanReason = 'automatic', signal } = {}) {
    if (!metadataParseEligibility(candidate, { scanReason })) {
      return Object.freeze({ status: 'skipped', reason: metadataSkipReason(candidate, scanReason) });
    }
    throwIfAborted(signal);

    const expectedClaim = {
      folderId: candidate.folderId,
      trackUid: candidate.trackUid,
      logicalStorageId: candidate.logicalStorageId,
      lifecycleVersion: candidate.lifecycleVersion,
      generation: candidate.generation,
      relativePath: candidate.relativePath,
      parserVersion: candidate.parserVersion,
      signature: candidate.observedSignature,
      cueSignature: candidate.cueSignature ?? null,
      sourceKind: candidate.sourceKind ?? 'file',
      entryKey: candidate.entryKey ?? null,
      cueRelativePath: candidate.cueRelativePath ?? null,
      startFrame: candidate.startFrame ?? null,
      endFrame: candidate.endFrame ?? null
    };
    const claimed = await this.repository.claimMetadataParse({
      ...expectedClaim,
      explicitRescan: scanReason === 'explicit-rescan'
    });
    if (!claimed?.claim) return Object.freeze({ status: 'skipped', reason: 'claim-rejected' });
    assertRepositoryContract(
      metadataCompletionMatchesClaim(expectedClaim, claimed.claim),
      'invalidMetadataClaim',
      'Repository returned a claim that does not match the requested source'
    );
    const claim = Object.freeze({ ...claimed.claim, signature: { ...claimed.claim.signature } });

    let metadata;
    try {
      throwIfAborted(signal);
      metadata = candidate.metadata ?? await this.parser.parse({
          path: candidate.path,
          relativePath: candidate.relativePath,
          skipCovers: true,
          signal
        });
      throwIfAborted(signal);
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        await this.#completeInterrupted(claim);
        throw abortReason(signal, error);
      }
      return this.#completeFailure(claim, error);
    }

    assertNoArtworkPayload(metadata);
    const completion = { ...claim, signature: { ...claim.signature } };
    assertRepositoryContract(
      metadataCompletionMatchesClaim(claim, completion),
      'invalidMetadataCompletion',
      'Metadata completion must carry the exact dispatch claim'
    );
    const result = await this.repository.completeMetadataParseSuccess({
      claim: completion,
      metadata,
      metadataStatus: 'ok',
      clearErrorAndRetryState: true,
      updateLastKnownGood: true,
      updateDerivedData: true,
      deferAggregateRecompute: true
    });
    if (!result?.committed) {
      await this.#requeueLatest(claim);
      return Object.freeze({ status: 'discarded-stale' });
    }
    return Object.freeze({ status: 'committed', metadataStatus: 'ok' });
  }

  async processBatch(candidates, { scanReason = 'automatic', signal, concurrency = 4 } = {}) {
    assertRepositoryContract(Array.isArray(candidates), 'invalidMetadataCandidate', 'Metadata candidate batch must be an array');
    if (
      typeof this.repository.claimMetadataParseBatch !== 'function' ||
      typeof this.repository.completeMetadataParseBatch !== 'function'
    ) {
      return mapConcurrentResults(candidates, concurrency, candidate => this.process(candidate, { scanReason, signal }));
    }

    const results = new Array(candidates.length);
    const pending = [];
    for (const [index, candidate] of candidates.entries()) {
      if (!metadataParseEligibility(candidate, { scanReason })) {
        results[index] = Object.freeze({ status: 'skipped', reason: metadataSkipReason(candidate, scanReason) });
        continue;
      }
      pending.push({
        index,
        candidate,
        expectedClaim: {
          folderId: candidate.folderId,
          trackUid: candidate.trackUid,
          logicalStorageId: candidate.logicalStorageId,
          lifecycleVersion: candidate.lifecycleVersion,
          generation: candidate.generation,
          relativePath: candidate.relativePath,
          parserVersion: candidate.parserVersion,
          signature: candidate.observedSignature,
          cueSignature: candidate.cueSignature ?? null,
          sourceKind: candidate.sourceKind ?? 'file',
          entryKey: candidate.entryKey ?? null,
          cueRelativePath: candidate.cueRelativePath ?? null,
          startFrame: candidate.startFrame ?? null,
          endFrame: candidate.endFrame ?? null
        }
      });
    }
    if (pending.length === 0) return results;
    throwIfAborted(signal);

    const claimedBatch = await this.repository.claimMetadataParseBatch({
      requests: pending.map(({ expectedClaim }) => ({
        ...expectedClaim,
        explicitRescan: scanReason === 'explicit-rescan'
      }))
    });
    assertRepositoryContract(
      Array.isArray(claimedBatch?.results) && claimedBatch.results.length === pending.length,
      'invalidMetadataClaim',
      'Repository returned an invalid metadata claim batch'
    );

    const claimed = [];
    for (const [batchIndex, item] of pending.entries()) {
      const claim = claimedBatch.results[batchIndex]?.claim;
      if (!claim) {
        results[item.index] = Object.freeze({ status: 'skipped', reason: 'claim-rejected' });
        continue;
      }
      assertRepositoryContract(
        metadataCompletionMatchesClaim(item.expectedClaim, claim),
        'invalidMetadataClaim',
        'Repository returned a claim that does not match the requested source'
      );
      claimed.push({
        ...item,
        claim: Object.freeze({ ...claim, signature: { ...claim.signature } })
      });
    }
    if (claimed.length === 0) return results;

    const completions = await mapConcurrentResults(claimed, concurrency, async item => {
      let metadata;
      try {
        throwIfAborted(signal);
        metadata = item.candidate.metadata ?? await this.parser.parse({
            path: item.candidate.path,
            relativePath: item.candidate.relativePath,
            skipCovers: true,
            signal
          });
        throwIfAborted(signal);
      } catch (error) {
        const interrupted = signal?.aborted || error?.name === 'AbortError';
        const classification = interrupted
          ? { metadataStatus: 'retryable-error', errorCode: 'service-interrupted', retryable: true }
          : classifyMetadataParseError(error);
        return {
          ...item,
          ...classification,
          abortError: interrupted ? abortReason(signal, error) : null,
          completion: {
            outcome: 'failure',
            request: {
              claim: item.claim,
              ...classification,
              preserveLastKnownGood: true,
              updateDerivedData: false,
              createMinimalRecordIfNoLastKnownGood: true
            }
          }
        };
      }
      assertNoArtworkPayload(metadata);
      const completionClaim = { ...item.claim, signature: { ...item.claim.signature } };
      assertRepositoryContract(
        metadataCompletionMatchesClaim(item.claim, completionClaim),
        'invalidMetadataCompletion',
        'Metadata completion must carry the exact dispatch claim'
      );
      return {
        ...item,
        metadataStatus: 'ok',
        completion: {
          outcome: 'success',
          request: {
            claim: completionClaim,
            metadata,
            metadataStatus: 'ok',
            clearErrorAndRetryState: true,
            updateLastKnownGood: true,
            updateDerivedData: true,
            deferAggregateRecompute: true
          }
        }
      };
    });

    const completedBatch = await this.repository.completeMetadataParseBatch({
      completions: completions.map(item => item.completion)
    });
    assertRepositoryContract(
      Array.isArray(completedBatch?.results) && completedBatch.results.length === completions.length,
      'invalidMetadataCompletion',
      'Repository returned an invalid metadata completion batch'
    );
    const staleClaims = [];
    for (const [batchIndex, item] of completions.entries()) {
      if (!completedBatch.results[batchIndex]?.committed) {
        staleClaims.push(item.claim);
        results[item.index] = Object.freeze({ status: 'discarded-stale' });
        continue;
      }
      results[item.index] = Object.freeze({
        status: 'committed',
        metadataStatus: item.metadataStatus,
        ...(item.errorCode ? { errorCode: item.errorCode, retryable: item.retryable } : {})
      });
    }
    await Promise.all(staleClaims.map(claim => this.#requeueLatest(claim)));
    const interrupted = completions.find(item => item.abortError);
    if (interrupted) throw interrupted.abortError;
    return results;
  }

  async #completeFailure(claim, error) {
    const classification = classifyMetadataParseError(error);
    const result = await this.repository.completeMetadataParseFailure({
      claim,
      ...classification,
      preserveLastKnownGood: true,
      updateDerivedData: false,
      createMinimalRecordIfNoLastKnownGood: true
    });
    if (!result?.committed) {
      await this.#requeueLatest(claim);
      return Object.freeze({ status: 'discarded-stale', ...classification });
    }
    return Object.freeze({ status: 'committed', ...classification });
  }

  async #completeInterrupted(claim) {
    const result = await this.repository.completeMetadataParseFailure({
      claim,
      metadataStatus: 'retryable-error',
      errorCode: 'service-interrupted',
      retryable: true,
      preserveLastKnownGood: true,
      updateDerivedData: false,
      createMinimalRecordIfNoLastKnownGood: true
    });
    if (!result?.committed) await this.#requeueLatest(claim);
  }

  async #requeueLatest(claim) {
    await this.repository.requeueLatestMetadata({
      folderId: claim.folderId,
      logicalStorageId: claim.logicalStorageId,
      relativePath: claim.relativePath,
      staleClaim: claim,
      maxItems: 1
    });
  }
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw abortReason(signal);
}

function abortReason(signal, fallback = null) {
  if (signal?.reason instanceof Error) return signal.reason;
  if (fallback instanceof Error && fallback.name === 'AbortError') return fallback;
  return new DOMException('Scan aborted', 'AbortError');
}

function metadataSkipReason(candidate, scanReason) {
  if (candidate.attemptedGeneration === candidate.generation) return 'attempted-generation';
  if (candidate.metadataStatus === 'terminal-error') return 'terminal-cached';
  if (candidate.metadataStatus === 'ok') return 'unchanged-ok';
  if (candidate.attemptsForSignature >= 6 && scanReason !== 'explicit-rescan') return 'retry-cap';
  return 'ineligible';
}

function sanitizeErrorCode(value) {
  const code = String(value ?? '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(code) ? code : 'unknown-internal';
}

function assertNoArtworkPayload(metadata) {
  assertRepositoryContract(metadata && typeof metadata === 'object', 'invalidMetadataResult', 'Metadata parser must return an object');
  for (const field of ['artwork', 'cover', 'covers', 'picture', 'pictures', 'images']) {
    assertRepositoryContract(metadata[field] == null, 'metadataArtworkForbidden', 'Scan metadata results must not contain artwork payloads');
  }
}

function assertMethods(target, methods, label) {
  assertRepositoryContract(target && typeof target === 'object', 'invalidScanAdapter', `${label} is required`);
  for (const method of methods) {
    if (typeof target[method] !== 'function') {
      throw createRepositoryError('invalidScanAdapter', `${label} must provide ${method}()`);
    }
  }
}

async function mapConcurrentResults(items, concurrency, operation) {
  const results = new Array(items.length);
  let index = 0;
  const workerCount = Math.min(Math.max(1, Number(concurrency) || 1), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      results[current] = await operation(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}
