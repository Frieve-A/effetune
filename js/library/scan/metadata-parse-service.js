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

    const expectedClaim = {
      folderId: candidate.folderId,
      trackUid: candidate.trackUid,
      lifecycleVersion: candidate.lifecycleVersion,
      generation: candidate.generation,
      relativePath: candidate.relativePath,
      parserVersion: candidate.parserVersion,
      signature: candidate.observedSignature
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
      metadata = await this.parser.parse({
        path: candidate.path,
        relativePath: candidate.relativePath,
        skipCovers: true,
        signal
      });
    } catch (error) {
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
      updateDerivedData: true
    });
    if (!result?.committed) {
      await this.#requeueLatest(claim);
      return Object.freeze({ status: 'discarded-stale' });
    }
    return Object.freeze({ status: 'committed', metadataStatus: 'ok' });
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

  async #requeueLatest(claim) {
    await this.repository.requeueLatestMetadata({
      folderId: claim.folderId,
      relativePath: claim.relativePath,
      staleClaim: claim,
      maxItems: 1
    });
  }
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
