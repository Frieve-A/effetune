import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PowerSessionJournal,
  validatePowerSessionJournalRecord
} from '../../js/audio/power-session-journal.js';

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function cryptoSequence() {
  let sequence = 0;
  return { randomUUID: () => `id-${++sequence}` };
}

function eligibility() {
  return {
    releaseCause: 'player-only-retention-expired',
    policyGeneration: 1,
    inputGeneration: 2,
    topologyRevision: 3,
    workletGraphGeneration: 4,
    inputUnusedSinceEpochMs: 10,
    inputUnusedInputGeneration: 2,
    routeIntent: 'player-only',
    routeIntentRevision: 5
  };
}

function prepare(journal, operationId = 'release-1') {
  return journal.prepare({
    operationId,
    releaseCause: 'player-only-retention-expired',
    releaseEligibility: eligibility(),
    suspendCause: 'idle-no-route',
    policy: 'maximum',
    inputConfigured: true,
    inputGeneration: 2,
    createdAtEpochMs: 100
  });
}

test('session journal persists exact phases and restores only its own identity', () => {
  const storage = new MemoryStorage();
  const cryptoRef = cryptoSequence();
  const first = new PowerSessionJournal({ storage, cryptoRef, now: () => 100 });
  const prepared = prepare(first);
  assert.equal(validatePowerSessionJournalRecord(prepared), true);
  assert.equal(first.getStatus().journalPhase, 'prepared');
  assert.equal(first.advance('release-1', 'committed'), null);
  assert.equal(first.advance('release-1', 'input-stopped').phase, 'input-stopped');
  assert.equal(first.advance('release-1', 'committed').phase, 'committed');

  const restored = new PowerSessionJournal({ storage, cryptoRef, now: () => 101 });
  assert.deepEqual(restored.restoreManualResumeRecord(), {
    ...prepared,
    phase: 'committed'
  });
  assert.equal(restored.getStatus().journalPhase, 'committed');
  assert.equal(restored.clear('release-1'), true);
  assert.equal(restored.restoreManualResumeRecord(), null);
  assert.equal(restored.getStatus().journalPhase, null);
});

test('foreign, malformed, unavailable, and failed storage records fail closed', () => {
  const unavailable = new PowerSessionJournal({ storage: null, cryptoRef: cryptoSequence() });
  assert.equal(unavailable.getStatus().state, 'unavailable');
  assert.equal(prepare(unavailable), null);

  const throwingStorage = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); }
  };
  const failed = new PowerSessionJournal({ storage: throwingStorage, cryptoRef: cryptoSequence() });
  assert.equal(failed.getStatus().state, 'error');
  assert.equal(failed.getStatus().errorCode, 'session-storage-read-failed');

  const storage = new MemoryStorage();
  const first = new PowerSessionJournal({ storage, cryptoRef: cryptoSequence(), now: () => 100 });
  const record = prepare(first);
  const identity = JSON.parse(storage.getItem('effetune_power_session_identity_v1'));
  storage.setItem('effetune_power_transition_journals', JSON.stringify({
    version: 1,
    clientId: identity.clientId,
    sessionId: identity.sessionId,
    records: [
      { ...record, clientId: 'foreign-client' },
      { ...record, extraAlias: true }
    ]
  }));
  const second = new PowerSessionJournal({ storage, cryptoRef: cryptoSequence(), now: () => 101 });
  assert.equal(second.restoreManualResumeRecord(), null);
});
