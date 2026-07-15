import { createRepositoryError } from '../repository/contract-errors.js';

export const METADATA_AUTOMATIC_ATTEMPT_LIMIT = 6;

export function createScanFolderState({ scanId, folderId, generation, lifecycleVersion }) {
  for (const [field, value] of Object.entries({ scanId, folderId })) {
    if (typeof value !== 'string' || value.length === 0) {
      throw createRepositoryError('invalidScanState', `${field} must be a non-empty string`);
    }
  }
  if (!Number.isSafeInteger(generation) || generation < 0 ||
      !Number.isSafeInteger(lifecycleVersion) || lifecycleVersion < 0) {
    throw createRepositoryError('invalidScanState', 'Scan generation and lifecycle version must be non-negative integers');
  }
  return Object.freeze({
    scanId,
    folderId,
    generation,
    expectedLifecycleVersion: lifecycleVersion,
    status: 'running',
    continuityBroken: false,
    sweepEligibility: 'ELIGIBLE',
    rootEnumerationRequired: true,
    destructiveCommitStarted: false,
    deletionState: null
  });
}

export function reduceScanFolderState(state, event) {
  if (!state || typeof state !== 'object' || !event || typeof event !== 'object') {
    throw createRepositoryError('invalidScanTransition', 'Scan transition requires state and event objects');
  }
  if (event.type === 'destructive-commit-started') {
    requireStatus(state, ['running']);
    if (state.continuityBroken || state.sweepEligibility !== 'ELIGIBLE') {
      throw createRepositoryError('sweepIneligible', 'Interrupted scan generations cannot start destructive reconciliation');
    }
    return freezeState(state, { destructiveCommitStarted: true, deletionState: 'running' });
  }
  if (event.type === 'pause') {
    requireStatus(state, ['running']);
    return breakContinuity(state, {
      status: 'paused',
      deletionState: state.destructiveCommitStarted ? 'blocked-interrupted' : state.deletionState
    });
  }
  if (event.type === 'cancel') {
    requireStatus(state, ['running', 'paused']);
    if (state.destructiveCommitStarted) {
      return breakContinuity(state, { status: 'paused', deletionState: 'blocked-interrupted' });
    }
    return breakContinuity(state, { status: 'cancelled' });
  }
  if (event.type === 'crash') {
    requireStatus(state, ['running', 'paused']);
    return breakContinuity(state, {
      status: 'interrupted',
      deletionState: state.destructiveCommitStarted ? 'blocked-interrupted' : state.deletionState
    });
  }
  if (event.type === 'resume') {
    requireStatus(state, ['paused', 'interrupted']);
    return freezeState(state, {
      status: 'running',
      continuityBroken: true,
      sweepEligibility: 'INELIGIBLE',
      rootEnumerationRequired: true,
      destructiveCommitStarted: false
    });
  }
  if (event.type === 'complete') {
    requireStatus(state, ['running']);
    return freezeState(state, {
      status: state.continuityBroken || state.sweepEligibility !== 'ELIGIBLE'
        ? 'completed-no-sweep'
        : 'completed',
      rootEnumerationRequired: false,
      deletionState: state.deletionState === 'running' ? 'completed' : state.deletionState
    });
  }
  throw createRepositoryError('invalidScanTransition', `Unknown scan transition: ${event.type}`);
}

export function shouldDispatchMetadataParse({
  status,
  storedSignature,
  observedSignature,
  storedParserVersion,
  parserVersion,
  attemptCount = 0,
  lastAttemptGeneration = null,
  generation,
  explicitRescan = false
}) {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw createRepositoryError('invalidMetadataRetry', 'generation must be a non-negative integer');
  }
  const inputChanged = !sameSignature(storedSignature, observedSignature) || storedParserVersion !== parserVersion;
  if (inputChanged) return true;
  if (lastAttemptGeneration === generation) return false;
  if (status === 'ok') return false;
  if (status === 'terminal-error') return false;
  if (status === 'parsing') return false;
  if (status !== 'retryable-error') return true;
  if (explicitRescan) return true;
  return Number.isSafeInteger(attemptCount) && attemptCount < METADATA_AUTOMATIC_ATTEMPT_LIMIT;
}

export function metadataCompletionMatchesClaim(claim, completion) {
  if (!claim || !completion) return false;
  return claim.folderId === completion.folderId &&
    claim.lifecycleVersion === completion.lifecycleVersion &&
    claim.generation === completion.generation &&
    claim.relativePath === completion.relativePath &&
    claim.parserVersion === completion.parserVersion &&
    sameSignature(claim.signature, completion.signature);
}

function breakContinuity(state, changes) {
  return freezeState(state, {
    ...changes,
    continuityBroken: true,
    sweepEligibility: 'INELIGIBLE',
    rootEnumerationRequired: true
  });
}

function freezeState(state, changes) {
  return Object.freeze({ ...state, ...changes });
}

function requireStatus(state, allowed) {
  if (!allowed.includes(state.status)) {
    throw createRepositoryError('invalidScanTransition', `Cannot transition from ${state.status}`);
  }
}

function sameSignature(left, right) {
  if (!left || !right) return false;
  return left.fileIdentity === right.fileIdentity &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs;
}
