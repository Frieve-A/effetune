import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createScanFolderState,
  metadataCompletionMatchesClaim,
  reduceScanFolderState,
  shouldDispatchMetadataParse
} from '../../js/library/scan/scan-state-machine.js';

function createState() {
  return createScanFolderState({
    scanId: 'scan-1',
    folderId: 'folder-1',
    generation: 8,
    lifecycleVersion: 3
  });
}

test('resumed scan remains sweep-ineligible after a complete root re-enumeration', () => {
  const paused = reduceScanFolderState(createState(), { type: 'pause' });
  const resumed = reduceScanFolderState(paused, { type: 'resume' });
  const completed = reduceScanFolderState(resumed, { type: 'complete' });

  assert.equal(resumed.continuityBroken, true);
  assert.equal(resumed.sweepEligibility, 'INELIGIBLE');
  assert.equal(resumed.rootEnumerationRequired, true);
  assert.equal(completed.status, 'completed-no-sweep');
  assert.equal(completed.sweepEligibility, 'INELIGIBLE');
});

test('cancel and crash after destructive commit leave deletion work blocked-interrupted', () => {
  const destructive = reduceScanFolderState(createState(), { type: 'destructive-commit-started' });
  const cancelled = reduceScanFolderState(destructive, { type: 'cancel' });
  const crashed = reduceScanFolderState(destructive, { type: 'crash' });

  assert.equal(cancelled.status, 'paused');
  assert.equal(cancelled.deletionState, 'blocked-interrupted');
  assert.equal(crashed.status, 'interrupted');
  assert.equal(crashed.deletionState, 'blocked-interrupted');
});

test('interrupted generation cannot enter destructive reconciliation', () => {
  const resumed = reduceScanFolderState(
    reduceScanFolderState(createState(), { type: 'pause' }),
    { type: 'resume' }
  );
  assert.throws(
    () => reduceScanFolderState(resumed, { type: 'destructive-commit-started' }),
    error => error?.code === 'sweepIneligible'
  );
});

test('metadata retry policy separates automatic caps from explicit rescan attempts', () => {
  const signature = { fileIdentity: 'file-1', size: 123, mtimeMs: 456 };
  const base = {
    status: 'retryable-error',
    storedSignature: signature,
    observedSignature: { ...signature },
    storedParserVersion: 'parser-1',
    parserVersion: 'parser-1',
    attemptCount: 6,
    lastAttemptGeneration: 7,
    generation: 8
  };

  assert.equal(shouldDispatchMetadataParse(base), false);
  assert.equal(shouldDispatchMetadataParse({ ...base, explicitRescan: true }), true);
  assert.equal(shouldDispatchMetadataParse({ ...base, explicitRescan: true, lastAttemptGeneration: 8 }), false);
  assert.equal(shouldDispatchMetadataParse({ ...base, observedSignature: { ...signature, size: 124 } }), true);
  assert.equal(shouldDispatchMetadataParse({
    ...base,
    lastAttemptGeneration: 8,
    observedSignature: { ...signature, size: 124 }
  }), true);
});

test('terminal metadata cache invalidates only for signature or parser changes', () => {
  const signature = { fileIdentity: 'file-2', size: 22, mtimeMs: 33 };
  const base = {
    status: 'terminal-error',
    storedSignature: signature,
    observedSignature: { ...signature },
    storedParserVersion: 'parser-1',
    parserVersion: 'parser-1',
    attemptCount: 1,
    lastAttemptGeneration: 4,
    generation: 5
  };

  assert.equal(shouldDispatchMetadataParse(base), false);
  assert.equal(shouldDispatchMetadataParse({ ...base, parserVersion: 'parser-2' }), true);
});

test('metadata completion commits only against its exact lifecycle and source claim', () => {
  const claim = {
    folderId: 'folder-1',
    lifecycleVersion: 2,
    generation: 9,
    relativePath: 'album/track.flac',
    parserVersion: 'parser-1',
    signature: { fileIdentity: 'id-1', size: 100, mtimeMs: 200 }
  };
  assert.equal(metadataCompletionMatchesClaim(claim, { ...claim, signature: { ...claim.signature } }), true);
  assert.equal(metadataCompletionMatchesClaim(claim, {
    ...claim,
    signature: { ...claim.signature, mtimeMs: 201 }
  }), false);
});
