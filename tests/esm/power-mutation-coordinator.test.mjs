import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POWER_MUTATION_KINDS,
  PowerActivityLeaseRegistry,
  PowerMutationCoordinator,
  createPowerIntentGuards,
  createPowerMutationTokens
} from '../../js/audio/power-mutation-coordinator.js';

const INITIAL_TOKENS = Object.freeze({
  policyGeneration: 3,
  inputGeneration: 5,
  topologyRevision: 7,
  workletGraphGeneration: 11
});

const INITIAL_GUARDS = Object.freeze({
  routeIntentRevision: 13,
  inputConfigRevision: 17,
  playerIntentGeneration: 19
});

function createCoordinator() {
  const resourceSnapshot = Object.freeze({ identity: 'before' });
  return {
    resourceSnapshot,
    coordinator: new PowerMutationCoordinator({
      tokens: INITIAL_TOKENS,
      guards: INITIAL_GUARDS,
      resourceSnapshot
    })
  };
}

function commit(coordinator, mutationKind, options = {}) {
  return coordinator.commitOwnedMutation({
    ownerOperationId: 'operation-1',
    mutationKind,
    beforeTokens: INITIAL_TOKENS,
    beforeGuards: INITIAL_GUARDS,
    resourceSnapshot: options.resourceSnapshot ?? Object.freeze({ identity: mutationKind }),
    ...(options.topologyChanged === undefined
      ? {}
      : { topologyChanged: options.topologyChanged }),
    ...(options.intentChanges === undefined
      ? {}
      : { intentChanges: options.intentChanges })
  });
}

test('token and guard factories keep every counter in a distinct exact record', () => {
  assert.deepEqual(createPowerMutationTokens(INITIAL_TOKENS), INITIAL_TOKENS);
  assert.deepEqual(createPowerIntentGuards(INITIAL_GUARDS), INITIAL_GUARDS);
  assert.throws(() => createPowerMutationTokens({
    ...INITIAL_TOKENS,
    routeIntentRevision: 1
  }), /unsupported keys/);
  assert.throws(() => createPowerIntentGuards({
    ...INITIAL_GUARDS,
    policyGeneration: 1
  }), /unsupported keys/);
  assert.throws(() => createPowerMutationTokens({
    ...INITIAL_TOKENS,
    inputGeneration: -1
  }), /nonnegative safe integer/);
});

test('the five mutation kinds emit exact results with their required token deltas', () => {
  assert.deepEqual(POWER_MUTATION_KINDS, [
    'input-install',
    'input-release',
    'route-topology-commit',
    'graph-replacement',
    'config-intent-commit'
  ]);

  const cases = [
    {
      kind: 'input-install',
      options: {},
      afterTokens: {
        policyGeneration: 4,
        inputGeneration: 6,
        topologyRevision: 7,
        workletGraphGeneration: 11
      }
    },
    {
      kind: 'input-release',
      options: { topologyChanged: true },
      afterTokens: {
        policyGeneration: 4,
        inputGeneration: 6,
        topologyRevision: 8,
        workletGraphGeneration: 11
      }
    },
    {
      kind: 'route-topology-commit',
      options: {},
      afterTokens: {
        policyGeneration: 4,
        inputGeneration: 5,
        topologyRevision: 8,
        workletGraphGeneration: 11
      }
    },
    {
      kind: 'graph-replacement',
      options: {},
      afterTokens: {
        policyGeneration: 4,
        inputGeneration: 5,
        topologyRevision: 8,
        workletGraphGeneration: 12
      }
    }
  ];

  for (const { kind, options, afterTokens } of cases) {
    const { coordinator } = createCoordinator();
    const result = commit(coordinator, kind, options);
    assert.deepEqual(Object.keys(result).sort(), [
      'afterGuards',
      'beforeGuards',
      'receipt',
      'resourceSnapshot'
    ]);
    assert.deepEqual(Object.keys(result.receipt).sort(), [
      'afterTokens',
      'beforeTokens',
      'mutationKind',
      'mutationSequence',
      'ownerOperationId'
    ]);
    assert.deepEqual(result.receipt.afterTokens, afterTokens);
    assert.deepEqual(result.afterGuards, INITIAL_GUARDS);
    assert.equal(result.receipt.mutationSequence, 1);
  }

  const { coordinator, resourceSnapshot } = createCoordinator();
  const configResult = commit(coordinator, 'config-intent-commit', {
    resourceSnapshot
  });
  assert.deepEqual(configResult.receipt.afterTokens, {
    policyGeneration: 4,
    inputGeneration: 5,
    topologyRevision: 7,
    workletGraphGeneration: 11
  });
  assert.deepEqual(configResult.afterGuards, {
    routeIntentRevision: 13,
    inputConfigRevision: 18,
    playerIntentGeneration: 19
  });
  assert.equal(configResult.resourceSnapshot, resourceSnapshot);
});

test('a logical mutation advances only the intent guards explicitly committed with it', () => {
  const { coordinator } = createCoordinator();
  const result = commit(coordinator, 'input-release', {
    topologyChanged: true,
    intentChanges: {
      routeIntentRevision: false,
      inputConfigRevision: true,
      playerIntentGeneration: false
    }
  });
  assert.deepEqual(result.afterGuards, {
    routeIntentRevision: 13,
    inputConfigRevision: 18,
    playerIntentGeneration: 19
  });
  assert.deepEqual(coordinator.getSnapshot(), {
    tokens: result.receipt.afterTokens,
    guards: result.afterGuards,
    resourceSnapshot: result.resourceSnapshot,
    mutationSequence: 1
  });
});

test('stale or malformed mutation requests fail before coordinator state changes', () => {
  const { coordinator, resourceSnapshot } = createCoordinator();
  const initial = coordinator.getSnapshot();

  assert.throws(() => coordinator.commitOwnedMutation({
    ownerOperationId: 'operation-1',
    mutationKind: 'input-install',
    beforeTokens: { ...INITIAL_TOKENS, policyGeneration: 2 },
    beforeGuards: INITIAL_GUARDS,
    resourceSnapshot: Object.freeze({ identity: 'after' })
  }), /stale/);
  assert.deepEqual(coordinator.getSnapshot(), initial);

  assert.throws(() => coordinator.commitOwnedMutation({
    ownerOperationId: 'operation-1',
    mutationKind: 'input-install',
    beforeTokens: INITIAL_TOKENS,
    beforeGuards: INITIAL_GUARDS,
    resourceSnapshot: Object.freeze({ identity: 'after' }),
    unsupported: true
  }), /unsupported keys/);
  assert.throws(() => commit(coordinator, 'route-topology-commit', {
    topologyChanged: false
  }), /must change topologyRevision/);
  assert.throws(() => commit(coordinator, 'graph-replacement', {
    intentChanges: {
      routeIntentRevision: true,
      inputConfigRevision: false,
      playerIntentGeneration: false
    }
  }), /cannot change intent guards/);
  assert.throws(() => commit(coordinator, 'config-intent-commit', {
    resourceSnapshot: Object.freeze({ identity: 'different' })
  }), /preserve resourceSnapshot identity/);
  assert.equal(coordinator.getSnapshot().resourceSnapshot, resourceSnapshot);
  assert.equal(coordinator.getSnapshot().mutationSequence, 0);
});

test('activity leases distinguish wake demand from barriers and release idempotently', () => {
  const leases = new PowerActivityLeaseRegistry();
  const releaseLoadA = leases.acquireLease('player-load', { mode: 'force-active' });
  const releaseLoadB = leases.acquireLease('player-load', { mode: 'force-active' });
  const releaseReset = leases.acquireLease('audio-reset', {
    mode: 'hold-current',
    scope: 'resource-mutation'
  });
  const releaseOffline = leases.acquireLease('offline-processing', {
    mode: 'hold-current',
    scope: 'resource-neutral'
  });

  assert.deepEqual(leases.getSnapshot(), {
    forceActiveCount: 2,
    holdCurrentCount: 2,
    resourceMutationInProgress: true,
    leases: [
      { token: 1, reason: 'player-load', mode: 'force-active', scope: null },
      { token: 2, reason: 'player-load', mode: 'force-active', scope: null },
      { token: 3, reason: 'audio-reset', mode: 'hold-current', scope: 'resource-mutation' },
      { token: 4, reason: 'offline-processing', mode: 'hold-current', scope: 'resource-neutral' }
    ]
  });

  assert.equal(releaseReset(), true);
  assert.equal(releaseReset(), false);
  assert.equal(leases.getSnapshot().resourceMutationInProgress, false);
  assert.equal(releaseLoadA(), true);
  assert.equal(releaseLoadB(), true);
  assert.equal(leases.clear(), 1);
  assert.equal(releaseOffline(), false);
  assert.deepEqual(leases.getSnapshot(), {
    forceActiveCount: 0,
    holdCurrentCount: 0,
    resourceMutationInProgress: false,
    leases: []
  });

  assert.throws(() => leases.acquireLease('bad-hold', {
    mode: 'hold-current'
  }), /valid scope/);
  assert.throws(() => leases.acquireLease('bad-force', {
    mode: 'force-active',
    scope: 'resource-neutral'
  }), /do not accept a scope/);
});
