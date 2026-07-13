import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTOMATIC_MONITORING_ARM_KEYS,
  AudioPowerState,
  AutomaticMonitoringArmState,
  InputAvailability,
  InputResourceState,
  POWER_TRANSITION_KEYS,
  ProcessingDirective,
  ResourceHealth,
  ResumeKind,
  TransitionState
} from '../../js/audio/power-policy.js';
import {
  APPLIED_POLICY_COUNTS_KEYS,
  CONTEXT_STATUS_KEYS,
  OUTPUT_BRIDGE_STATUS_KEYS,
  PERSISTENCE_STATUS_KEYS,
  PLAYER_SOURCE_STATUS_KEYS,
  POWER_SNAPSHOT_KEYS,
  POWER_SNAPSHOT_SCHEMA_VERSION,
  RESOURCE_STATUS_KEYS,
  ROUTE_STATUS_KEYS,
  STATE_PREPARATION_KEYS,
  TEMPORAL_SKIP_KEYS,
  TRANSITION_ERROR_KEYS,
  WORKLET_NODE_KEYS,
  WORKLETS_STATUS_KEYS,
  StatePreparationOrigin,
  StatePreparationState,
  assertValidPowerSnapshot,
  buildPowerSnapshot,
  createInitialPowerSnapshot,
  createUnknownStatePreparation,
  normalizePowerSnapshot,
  validatePowerResourceStatus,
  validatePowerSnapshot,
  validateStatePreparation,
  validateTransitionError
} from '../../js/audio/power-snapshot.js';

function clone(value) {
  return structuredClone(value);
}

function exactKeys(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function completeSnapshot() {
  return buildPowerSnapshot({
    effectiveState: AudioPowerState.MONITORING,
    desiredState: AudioPowerState.SUSPENDED,
    topologyRevision: 20,
    resourceMutationInProgress: true,
    processingDirective: ProcessingDirective.ALLOW_AUTOMATIC,
    transportDemand: true,
    dspProcessingDemand: false,
    inputSignalForProcessing: 'silent',
    inputRetentionTarget: true,
    transition: {
      state: TransitionState.RESUMING,
      operationId: 'resume-1',
      generation: 10
    },
    reason: 'automatic-monitoring',
    suspendCause: 'idle-no-route',
    resumeKind: ResumeKind.MIXED_PLAY,
    requiredResources: {
      blocking: ['context', 'worklets', 'playerSource'],
      healthy: ['input', 'route'],
      allowActiveWhenHealthyMissing: true
    },
    inputMonitoring: true,
    manualResumeRequired: true,
    resourceStatus: {
      context: {
        state: 'running',
        operationId: 'resume-1',
        observedAtEpochMs: 123_000,
        errorCode: null
      },
      input: {
        state: InputResourceState.LIVE,
        availability: InputAvailability.MUTED,
        configured: true,
        inputConfigRevision: 4,
        inputGeneration: 40,
        inputAvailabilityRevision: 50,
        operationId: null,
        observedAtEpochMs: 123_001,
        errorCode: null
      },
      route: {
        state: 'connected',
        intent: 'mixed',
        routeIntentRevision: 6,
        observedAtEpochMs: 123_002,
        errorCode: null
      },
      outputBridge: {
        state: 'playing',
        operationId: 'resume-1',
        observedAtEpochMs: 123_003,
        errorCode: null
      },
      playerSource: {
        state: 'connected',
        playerIntentGeneration: 7,
        observedAtEpochMs: 123_004,
        errorCode: null
      },
      worklets: {
        temporalSkip: {
          status: 'eligible',
          blockerReason: null,
          topologyRevision: 20
        },
        automaticMonitoringArm: {
          state: AutomaticMonitoringArmState.CONSUMED,
          commandId: 'arm-7',
          skipEpoch: 7,
          armAfterRenderSequence: 70
        },
        monitoringFastWakeEligible: true,
        monitoringFastWakeBlockerReason: null,
        nodes: [{
          role: 'primary',
          workletGraphGeneration: 30,
          topologyRevision: 20,
          state: 'rendering',
          processingState: 'monitoring',
          commandAckId: 'arm-7',
          observationRequestId: 9,
          firstRenderSeen: true,
          renderSequence: 77,
          lastHeartbeatAt: 123_005,
          statePreparation: {
            state: StatePreparationState.ACKNOWLEDGED,
            origin: StatePreparationOrigin.AUTONOMOUS_FAST_WAKE,
            ownerOperationId: null,
            workletGraphGeneration: 30,
            topologyRevision: 20,
            skipEpoch: 7,
            enabledPluginCount: 2,
            coveredPluginCount: 2,
            appliedPolicyCounts: {
              stateless: 1,
              resetOnResume: 1,
              agedBySkippedFrames: 0,
              mustProcess: 0
            },
            skippedFrameCount: 256,
            commandId: 'arm-7',
            ackCommandId: 'arm-7',
            renderSequence: 77,
            errorCode: null
          },
          errorCode: null
        }]
      },
      persistence: {
        state: 'available',
        storage: 'session',
        clientId: 'client-1',
        sessionId: 'session-1',
        journalPhase: 'committed',
        observedAtEpochMs: 123_006,
        errorCode: null
      }
    },
    resourceHealth: ResourceHealth.DEGRADED,
    transitionError: {
      code: 'input-not-ready',
      phase: 'resource-commit',
      operationId: 'resume-1',
      recoverable: true,
      messageKey: 'error.powerState.inputNotReady'
    }
  });
}

test('initial public snapshot has the exact 20-key and seven-resource contract', () => {
  const snapshot = createInitialPowerSnapshot();
  assert.equal(POWER_SNAPSHOT_KEYS.length, 20);
  assert.equal(RESOURCE_STATUS_KEYS.length, 7);
  exactKeys(snapshot, POWER_SNAPSHOT_KEYS);
  exactKeys(snapshot.transition, POWER_TRANSITION_KEYS);
  exactKeys(snapshot.resourceStatus, RESOURCE_STATUS_KEYS);
  exactKeys(snapshot.resourceStatus.context, CONTEXT_STATUS_KEYS);
  exactKeys(snapshot.resourceStatus.route, ROUTE_STATUS_KEYS);
  exactKeys(snapshot.resourceStatus.outputBridge, OUTPUT_BRIDGE_STATUS_KEYS);
  exactKeys(snapshot.resourceStatus.playerSource, PLAYER_SOURCE_STATUS_KEYS);
  exactKeys(snapshot.resourceStatus.worklets, WORKLETS_STATUS_KEYS);
  exactKeys(snapshot.resourceStatus.worklets.temporalSkip, TEMPORAL_SKIP_KEYS);
  exactKeys(
    snapshot.resourceStatus.worklets.automaticMonitoringArm,
    AUTOMATIC_MONITORING_ARM_KEYS
  );
  exactKeys(snapshot.resourceStatus.persistence, PERSISTENCE_STATUS_KEYS);
  exactKeys(snapshot.transitionError, TRANSITION_ERROR_KEYS);
  assert.deepEqual(snapshot.transitionError, {
    code: null,
    phase: null,
    operationId: null,
    recoverable: false,
    messageKey: null
  });
  assert.equal(snapshot.schemaVersion, POWER_SNAPSHOT_SCHEMA_VERSION);
  assert.equal(validatePowerSnapshot(snapshot), true);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.resourceStatus.worklets.nodes), true);
});

test('canonical snapshot keeps generation and freshness identities only in nested resources', () => {
  const snapshot = completeSnapshot();
  assert.equal(assertValidPowerSnapshot(snapshot), snapshot);
  assert.equal(snapshot.transition.generation, 10);
  assert.equal(snapshot.topologyRevision, 20);
  assert.equal(snapshot.resourceStatus.input.inputGeneration, 40);
  assert.equal(snapshot.resourceStatus.input.inputAvailabilityRevision, 50);
  assert.equal(snapshot.resourceStatus.route.routeIntentRevision, 6);
  assert.equal(snapshot.resourceStatus.playerSource.playerIntentGeneration, 7);
  assert.equal(snapshot.resourceStatus.worklets.nodes[0].workletGraphGeneration, 30);
  assert.equal(snapshot.resourceStatus.worklets.nodes[0].renderSequence, 77);
  exactKeys(snapshot.resourceStatus.worklets.nodes[0], WORKLET_NODE_KEYS);
  exactKeys(snapshot.resourceStatus.worklets.nodes[0].statePreparation, STATE_PREPARATION_KEYS);
  exactKeys(
    snapshot.resourceStatus.worklets.nodes[0].statePreparation.appliedPolicyCounts,
    APPLIED_POLICY_COUNTS_KEYS
  );
  for (const alias of [
    'policyGeneration',
    'workletGraphGeneration',
    'inputGeneration',
    'inputAvailabilityRevision',
    'inputSignalReason',
    'temporalSkipEligible',
    'temporalSkipReason',
    'monitoringFastWakeEligible',
    'monitoringFastWakeBlockerReason',
    'nextDeadlineAt',
    'uiGates'
  ]) {
    assert.equal(alias in snapshot, false, alias);
  }
  assert.equal(Object.isFrozen(snapshot.resourceStatus.worklets.nodes[0]), true);
});

test('strict validation rejects missing, extra, legacy, and stale nested fields', () => {
  const mutations = [
    value => { delete value.topologyRevision; },
    value => { value.policyGeneration = 10; },
    value => { value.resourceStatus.audioContext = value.resourceStatus.context; },
    value => { value.resourceStatus.player = value.resourceStatus.playerSource; },
    value => { delete value.resourceStatus.persistence; },
    value => { value.resourceStatus.worklets.renderSequence = 77; },
    value => { value.resourceStatus.worklets.nodes[0].generation = 30; },
    value => { value.resourceStatus.worklets.nodes[0].topologyRevision++; },
    value => { value.resourceStatus.worklets.nodes[0].statePreparation.armStartFrame = 1; },
    value => { value.resourceStatus.persistence.storage = 'local'; },
    value => { value.transitionError = null; },
    value => { value.schemaVersion++; }
  ];
  for (const mutate of mutations) {
    const invalid = clone(completeSnapshot());
    mutate(invalid);
    assert.equal(validatePowerSnapshot(invalid), false);
  }
});

test('state preparation enforces nullable owner and exact plugin accounting', () => {
  const autonomous = clone(
    completeSnapshot().resourceStatus.worklets.nodes[0].statePreparation
  );
  assert.equal(validateStatePreparation(autonomous), true);
  const deliberate = {
    ...autonomous,
    origin: StatePreparationOrigin.DELIBERATE,
    ownerOperationId: 'operation-9'
  };
  assert.equal(validateStatePreparation(deliberate), true);
  assert.equal(validateStatePreparation({ ...autonomous, ownerOperationId: 'wrong-owner' }), false);
  assert.equal(validateStatePreparation({ ...deliberate, ownerOperationId: null }), false);
  assert.equal(validateStatePreparation({ ...autonomous, coveredPluginCount: 1 }), false);
  assert.equal(validateStatePreparation({
    ...autonomous,
    appliedPolicyCounts: { ...autonomous.appliedPolicyCounts, mustProcess: 1 }
  }), false);
});

test('normalization fails stale state preparation identities closed to unknown', () => {
  const current = clone(completeSnapshot());
  const currentPreparation = clone(
    current.resourceStatus.worklets.nodes[0].statePreparation
  );
  const normalizedCurrent = normalizePowerSnapshot(current);
  assert.deepEqual(
    normalizedCurrent.resourceStatus.worklets.nodes[0].statePreparation,
    currentPreparation
  );

  const mutations = [
    value => { value.workletGraphGeneration--; },
    value => { value.topologyRevision--; }
  ];
  for (const mutate of mutations) {
    const stale = clone(current);
    mutate(stale.resourceStatus.worklets.nodes[0].statePreparation);
    const normalized = normalizePowerSnapshot(stale);
    assert.deepEqual(
      normalized.resourceStatus.worklets.nodes[0].statePreparation,
      createUnknownStatePreparation()
    );
    assert.equal(validatePowerSnapshot(normalized), true);
  }
});

test('input status normalization preserves state invariants for transient candidates', () => {
  const live = clone(completeSnapshot());
  live.resourceStatus.input.configured = false;
  const normalizedLive = normalizePowerSnapshot(live);
  assert.equal(normalizedLive.resourceStatus.input.state, InputResourceState.LIVE);
  assert.equal(normalizedLive.resourceStatus.input.configured, true);
  assert.equal(validatePowerSnapshot(normalizedLive), true);

  const notConfigured = clone(completeSnapshot());
  notConfigured.resourceStatus.input.state = InputResourceState.NOT_CONFIGURED;
  notConfigured.resourceStatus.input.configured = true;
  notConfigured.resourceStatus.input.availability = InputAvailability.AVAILABLE;
  const normalizedNotConfigured = normalizePowerSnapshot(notConfigured);
  assert.equal(normalizedNotConfigured.resourceStatus.input.configured, false);
  assert.equal(normalizedNotConfigured.resourceStatus.input.availability, InputAvailability.UNKNOWN);
  assert.equal(validatePowerSnapshot(normalizedNotConfigured), true);
});

test('temporal skip and automatic arm fail closed to canonical nested values', () => {
  const normalized = buildPowerSnapshot({
    topologyRevision: 8,
    resourceStatus: {
      worklets: {
        temporalSkip: {
          status: 'blocked',
          blockerReason: 'wrong-alias',
          topologyRevision: 3
        },
        automaticMonitoringArm: {
          state: 'armed',
          commandId: null,
          skipEpoch: 4,
          armAfterRenderSequence: 5
        },
        monitoringFastWakeEligible: false,
        monitoringFastWakeBlockerReason: 'wrong-reason',
        nodes: []
      }
    }
  });
  assert.deepEqual(normalized.resourceStatus.worklets.temporalSkip, {
    status: 'blocked',
    blockerReason: 'temporal-must-process',
    topologyRevision: 8
  });
  assert.deepEqual(normalized.resourceStatus.worklets.automaticMonitoringArm, {
    state: 'disarmed',
    commandId: null,
    skipEpoch: null,
    armAfterRenderSequence: null
  });
  assert.equal(
    normalized.resourceStatus.worklets.monitoringFastWakeBlockerReason,
    'temporal-preparation-not-worklet-local'
  );
});

test('transitionError is always an exact object and no-error fields are all canonical', () => {
  assert.equal(validateTransitionError({
    code: null,
    phase: null,
    operationId: null,
    recoverable: false,
    messageKey: null
  }), true);
  assert.equal(validateTransitionError(null), false);
  assert.equal(validateTransitionError({
    code: null,
    phase: 'resume',
    operationId: null,
    recoverable: false,
    messageKey: null
  }), false);
});

test('normalization is immutable and ignores private or legacy candidate aliases', () => {
  const candidate = {
    topologyRevision: 4,
    policyGeneration: 99,
    workletGraphGeneration: 88,
    uiGates: { telemetryEnabled: true },
    privateSafetyGateHandle: { gateNodeId: 'private' },
    resourceStatus: {
      audioContext: { state: 'running' },
      player: { state: 'playing' },
      persistence: {
        state: 'available',
        storage: 'session',
        clientId: 'client',
        sessionId: 'session',
        journalPhase: null,
        observedAtEpochMs: 10,
        errorCode: null
      }
    }
  };
  const before = clone(candidate);
  const normalized = normalizePowerSnapshot(candidate);
  assert.deepEqual(candidate, before);
  exactKeys(normalized, POWER_SNAPSHOT_KEYS);
  exactKeys(normalized.resourceStatus, RESOURCE_STATUS_KEYS);
  assert.equal('policyGeneration' in normalized, false);
  assert.equal('audioContext' in normalized.resourceStatus, false);
  assert.equal('player' in normalized.resourceStatus, false);
  assert.equal(validatePowerResourceStatus(normalized.resourceStatus, 4), true);
});
