import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTOMATIC_MONITORING_ARM_KEYS,
  AudioPowerState,
  AutomaticMonitoringArmState,
  DEFAULT_POWER_SETTINGS,
  FULL_SUSPEND_DELAY_SECONDS_VALUES,
  INPUT_RESOURCE_STATUS_KEYS,
  InputAvailability,
  InputResourceState,
  InputRouteIntent,
  MonitoringFastWakeBlockerReason,
  NO_ROUTE_IDLE_DELAY_MS,
  POWER_DECISION_KEYS,
  POWER_TRANSITION_KEYS,
  PowerPolicy,
  ProcessingDirective,
  ResumeKind,
  SILENCE_THRESHOLD_DB_VALUES,
  TransitionState,
  WORKLET_PROCESSING_DIRECTIVES,
  classifyInputRoute,
  createStablePowerTransition,
  decidePowerTarget,
  deriveInputSignalObservation,
  getRequiredResourcesForResume,
  mergePowerSavingSettings,
  normalizePowerSettings,
  validateAutomaticMonitoringArm,
  validateInputResourceStatus,
  validatePowerDecision,
  validatePowerTransition
} from '../../js/audio/power-policy.js';

const NOW = 1_000_000;

function disarmedArm() {
  return {
    state: AutomaticMonitoringArmState.DISARMED,
    commandId: null,
    skipEpoch: null,
    armAfterRenderSequence: null
  };
}

function armedArm(state = AutomaticMonitoringArmState.ARMED, epoch = 5) {
  return {
    state,
    commandId: `command-${epoch}`,
    skipEpoch: epoch,
    armAfterRenderSequence: 100 + epoch
  };
}

function makeFacts(overrides = {}) {
  return {
    enabled: true,
    isElectron: false,
    visibility: 'visible',
    pageLifecycle: 'active',
    effectiveState: AudioPowerState.ACTIVE,
    desiredState: AudioPowerState.ACTIVE,
    processingDirective: ProcessingDirective.FULL_PROCESS,
    inputConfigured: false,
    inputRouteIntent: InputRouteIntent.NONE,
    inputResourceState: InputResourceState.NOT_CONFIGURED,
    inputAvailability: InputAvailability.UNKNOWN,
    inputConfigRevision: 3,
    inputGeneration: 13,
    inputAvailabilityRevision: 17,
    routeIntentRevision: 19,
    playerState: 'stopped',
    transportDemand: false,
    dspProcessingDemand: false,
    routedInputSignalState: 'silent',
    routedOutputSignalState: 'silent',
    routedInputObservationFresh: true,
    routedOutputObservationFresh: true,
    outputSignalState: 'silent',
    temporalSkipEligible: true,
    temporalSkipReason: null,
    monitoringFastWakeEligible: true,
    monitoringFastWakeBlockerReason: null,
    workletControl: { automaticMonitoringArm: disarmedArm() },
    workletObservedState: 'active',
    activeFullProcessSettled: true,
    freshActiveRenderSequence: 29,
    renderSequence: 29,
    observationRequestId: 23,
    workletObservationFresh: true,
    resourceHealth: 'healthy',
    forceActiveLeases: 0,
    holdCurrentLeases: 0,
    resourceMutationInProgress: false,
    manualResumeRequired: false,
    resumeKind: ResumeKind.NONE,
    policyGeneration: 7,
    topologyRevision: 11,
    workletGraphGeneration: 12,
    routedInputReleaseEligibleSinceEpochMs: 0,
    routedInputReleasePolicyGeneration: 7,
    routedInputReleaseInputGeneration: 13,
    routedInputReleaseInputAvailabilityRevision: 17,
    routedInputReleaseTopologyRevision: 11,
    routedInputReleaseWorkletGraphGeneration: 12,
    ...overrides
  };
}

test('manual resume latch is dropped when no configured input remains to restore', () => {
  const latched = decidePowerTarget(makeFacts({
    manualResumeRequired: true,
    inputConfigured: true,
    inputResourceState: InputResourceState.RELEASED
  }), { mode: PowerPolicy.BALANCED }, NOW);
  assert.equal(latched.manualResumeRequired, true);

  assert.equal(decidePowerTarget(makeFacts({
    manualResumeRequired: true
  }), { mode: PowerPolicy.BALANCED }, NOW).manualResumeRequired, false);

});

test('power settings normalize to an immutable exact three-field policy object', () => {
  assert.deepEqual(normalizePowerSettings(), DEFAULT_POWER_SETTINGS);
  assert.deepEqual(normalizePowerSettings({ powerSaving: {
    mode: 'unknown',
    silenceThresholdDb: NaN,
    fullSuspendDelaySeconds: Infinity,
    extra: true
  } }), DEFAULT_POWER_SETTINGS);
  assert.deepEqual(normalizePowerSettings({
    mode: PowerPolicy.MAXIMUM,
    silenceThresholdDb: -20,
    fullSuspendDelaySeconds: 'never',
    extra: 'discarded'
  }), {
    mode: PowerPolicy.MAXIMUM,
    silenceThresholdDb: -20,
    fullSuspendDelaySeconds: 'never'
  });
  assert.deepEqual(SILENCE_THRESHOLD_DB_VALUES, [-90, -80, -70, -60, -50, -40, -30, -20]);
  assert.deepEqual(FULL_SUSPEND_DELAY_SECONDS_VALUES, [60, 300, 900, 'never']);

  const current = {
    mode: PowerPolicy.CONTINUOUS,
    silenceThresholdDb: -70,
    fullSuspendDelaySeconds: 900
  };
  const partial = { mode: PowerPolicy.MAXIMUM };
  assert.deepEqual(mergePowerSavingSettings(current, partial), {
    mode: PowerPolicy.MAXIMUM,
    silenceThresholdDb: -70,
    fullSuspendDelaySeconds: 900
  });
  assert.deepEqual(current, {
    mode: PowerPolicy.CONTINUOUS,
    silenceThresholdDb: -70,
    fullSuspendDelaySeconds: 900
  });
  assert.deepEqual(partial, { mode: PowerPolicy.MAXIMUM });
});

test('route and routed-signal classification use the observed pipeline level regardless of source', () => {
  assert.equal(classifyInputRoute({ inputConfigured: false }), InputRouteIntent.NONE);
  assert.equal(classifyInputRoute({ inputConfigured: true, playerPresent: false }), InputRouteIntent.EXTERNAL);
  assert.equal(classifyInputRoute({
    inputConfigured: false,
    playerPresent: true,
    useInputWithPlayer: true
  }), InputRouteIntent.PLAYER_ONLY);
  assert.equal(classifyInputRoute({
    inputConfigured: true,
    playerPresent: true,
    useInputWithPlayer: true
  }), InputRouteIntent.MIXED);
  assert.equal(classifyInputRoute({
    inputConfigured: true,
    playerPresent: true,
    useInputWithPlayer: false
  }), InputRouteIntent.PLAYER_ONLY);

  assert.deepEqual(deriveInputSignalObservation(makeFacts({
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.PLAYER_ONLY,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.AVAILABLE,
    inputSignalState: 'active',
    playerState: 'paused',
    transportDemand: false
  })), { state: 'silent', reason: null });
  assert.deepEqual(deriveInputSignalObservation(makeFacts({
    inputRouteIntent: InputRouteIntent.PLAYER_ONLY,
    routedInputSignalState: 'active',
    playerState: 'paused',
    transportDemand: false
  })), { state: 'active', reason: null });
  assert.deepEqual(deriveInputSignalObservation({
    inputConfigured: false,
    playerPresent: true,
    routedInputSignalState: 'active'
  }), { state: 'active', reason: null });
  assert.deepEqual(deriveInputSignalObservation({
    inputConfigured: true,
    playerPresent: true,
    playerSignalState: 'active',
    routedPlayerSignalState: 'active',
    inputSignalForProcessing: 'active',
    inputSignalState: 'active'
  }), { state: 'unknown', reason: 'observation-unavailable' });
});

test('public schema validators keep transition, arm, and input identities exact', () => {
  const transition = createStablePowerTransition(31);
  assert.deepEqual(Object.keys(transition).sort(), [...POWER_TRANSITION_KEYS].sort());
  assert.equal(validatePowerTransition(transition), true);
  assert.equal(validatePowerTransition({ ...transition, topologyRevision: 31 }), false);
  assert.equal(validatePowerTransition({
    state: TransitionState.RESUMING,
    operationId: null,
    generation: 31
  }), false);

  const arm = armedArm();
  assert.deepEqual(Object.keys(arm).sort(), [...AUTOMATIC_MONITORING_ARM_KEYS].sort());
  assert.equal(validateAutomaticMonitoringArm(arm), true);
  assert.equal(validateAutomaticMonitoringArm({ ...arm, armStartFrame: 1 }), false);
  assert.equal(validateAutomaticMonitoringArm({ ...disarmedArm(), skipEpoch: 0 }), false);

  const liveMuted = {
    state: InputResourceState.LIVE,
    availability: InputAvailability.MUTED,
    configured: true,
    inputConfigRevision: 2,
    inputGeneration: 5,
    inputAvailabilityRevision: 8,
    operationId: null,
    observedAtEpochMs: NOW,
    errorCode: null
  };
  assert.deepEqual(Object.keys(liveMuted).sort(), [...INPUT_RESOURCE_STATUS_KEYS].sort());
  assert.equal(validateInputResourceStatus(liveMuted), true);
  assert.equal(validateInputResourceStatus({ ...liveMuted, state: 'muted' }), false);
  assert.equal(validateInputResourceStatus({ ...liveMuted, lifecycleGeneration: 5 }), false);
});

test('no-route deadline is policy-specific, visibility-independent, and exact at the boundary', () => {
  assert.deepEqual(NO_ROUTE_IDLE_DELAY_MS, {
    [PowerPolicy.CONTINUOUS]: 30_000,
    [PowerPolicy.BALANCED]: 15_000,
    [PowerPolicy.MAXIMUM]: 3_000
  });
  for (const mode of Object.values(PowerPolicy)) {
    const delay = NO_ROUTE_IDLE_DELAY_MS[mode];
    for (const visibility of ['visible', 'hidden']) {
      const before = decidePowerTarget(makeFacts({
        visibility,
        noRouteIdleSinceEpochMs: NOW - delay + 1
      }), { mode }, NOW);
      assert.equal(before.targetState, AudioPowerState.ACTIVE, `${mode}/${visibility}/before`);
      assert.equal(before.processingDirective, ProcessingDirective.FULL_PROCESS);
      assert.equal(before.dspProcessingDemand, true);
      assert.equal(before.nextDeadlineAt, NOW + 1);

      const exact = decidePowerTarget(makeFacts({
        visibility,
        noRouteIdleSinceEpochMs: NOW - delay
      }), { mode }, NOW);
      assert.equal(exact.targetState, AudioPowerState.SUSPENDED, `${mode}/${visibility}/exact`);
      assert.equal(exact.processingDirective, ProcessingDirective.SUSPENDED);
      assert.equal(exact.reason, 'idle-no-route');
    }
  }
});

test('must-process blocks no-route suspension without blocking independent input release', () => {
  for (const mode of Object.values(PowerPolicy)) {
    const decision = decidePowerTarget(makeFacts({
      temporalSkipEligible: false,
      temporalSkipReason: MonitoringFastWakeBlockerReason.MUST_PROCESS,
      temporalCapabilityAggregate: 'must-process',
      noRouteIdleSinceEpochMs: NOW - NO_ROUTE_IDLE_DELAY_MS[mode] - 1
    }), { mode }, NOW);
    assert.equal(decision.targetState, AudioPowerState.ACTIVE);
    assert.equal(decision.processingDirective, ProcessingDirective.FULL_PROCESS);
    assert.equal(decision.reason, MonitoringFastWakeBlockerReason.MUST_PROCESS);
    assert.equal(decision.dspProcessingDemand, true);
  }

  const independentRelease = decidePowerTarget(makeFacts({
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.PLAYER_ONLY,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.DISABLED,
    inputUnusedSinceEpochMs: NOW - 300_000,
    inputUnusedInputGeneration: 13,
    temporalSkipEligible: false,
    temporalSkipReason: MonitoringFastWakeBlockerReason.MUST_PROCESS,
    temporalCapabilityAggregate: 'must-process',
    noRouteIdleSinceEpochMs: NOW - 10_000
  }), { mode: PowerPolicy.MAXIMUM }, NOW);
  assert.equal(independentRelease.targetState, AudioPowerState.ACTIVE);
  assert.equal(independentRelease.shouldReleaseInput, true);
  assert.equal(independentRelease.inputReleaseRequest.releaseCause, 'player-only-retention-expired');
});

test('zero-output proof has route precedence while must-process remains the safety override', () => {
  for (const mode of Object.values(PowerPolicy)) {
    const delay = NO_ROUTE_IDLE_DELAY_MS[mode];
    for (const route of Object.values(InputRouteIntent)) {
      const base = {
        inputRouteIntent: route,
        zeroOutputProof: { proven: true, topologyRevision: 11 },
        zeroOutputIdleSinceEpochMs: NOW - delay,
        zeroOutputIdleTopologyRevision: 11,
        zeroOutputIdlePolicyGeneration: 7
      };
      const withoutTransport = decidePowerTarget(makeFacts(base), { mode }, NOW);
      assert.equal(withoutTransport.targetState, AudioPowerState.SUSPENDED, `${mode}/${route}/idle`);
      assert.equal(withoutTransport.dspProcessingDemand, false);

      const withTransport = decidePowerTarget(makeFacts({
        ...base,
        playerState: 'playing',
        transportDemand: true
      }), { mode }, NOW);
      assert.equal(withTransport.targetState, AudioPowerState.ACTIVE, `${mode}/${route}/transport`);
      assert.equal(withTransport.processingDirective, ProcessingDirective.ZERO_OUTPUT_TRANSPORT);
      assert.equal(withTransport.dspProcessingDemand, false);

      const mustProcess = decidePowerTarget(makeFacts({
        ...base,
        temporalSkipEligible: false,
        temporalSkipReason: MonitoringFastWakeBlockerReason.MUST_PROCESS,
        temporalCapabilityAggregate: 'must-process'
      }), { mode }, NOW);
      assert.equal(mustProcess.targetState, AudioPowerState.ACTIVE, `${mode}/${route}/must-process`);
      assert.equal(mustProcess.processingDirective, ProcessingDirective.FULL_PROCESS);
    }
  }

  const staleProof = decidePowerTarget(makeFacts({
    playerState: 'playing',
    transportDemand: true,
    zeroOutputProof: { proven: true, topologyRevision: 10 }
  }), DEFAULT_POWER_SETTINGS, NOW);
  assert.equal(staleProof.processingDirective, ProcessingDirective.FULL_PROCESS);
});

test('master bypass skips DSP only for a temporally eligible chain', () => {
  const eligible = decidePowerTarget(makeFacts({
    playerState: 'playing',
    transportDemand: true,
    masterBypass: true
  }), DEFAULT_POWER_SETTINGS, NOW);
  assert.equal(eligible.processingDirective, ProcessingDirective.BYPASS_TRANSPORT);
  assert.equal(eligible.dspProcessingDemand, false);

  const blocked = decidePowerTarget(makeFacts({
    playerState: 'playing',
    transportDemand: true,
    masterBypass: true,
    temporalSkipEligible: false,
    temporalSkipReason: MonitoringFastWakeBlockerReason.MUST_PROCESS,
    temporalCapabilityAggregate: 'must-process'
  }), DEFAULT_POWER_SETTINGS, NOW);
  assert.equal(blocked.processingDirective, ProcessingDirective.FULL_PROCESS);
  assert.equal(blocked.dspProcessingDemand, true);
});

test('automatic Monitoring requires a current one-shot arm and never rearms a consumed identity', () => {
  const routed = {
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.EXTERNAL,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.AVAILABLE,
    routedInputSignalState: 'silent'
  };
  const disarmed = decidePowerTarget(makeFacts({
    ...routed,
    workletControl: { automaticMonitoringArm: disarmedArm() },
    lastSkipEpoch: 8,
    nextSkipEpoch: 9
  }), { mode: PowerPolicy.BALANCED }, NOW);
  assert.equal(disarmed.targetState, AudioPowerState.ACTIVE);
  assert.equal(disarmed.processingDirective, ProcessingDirective.FULL_PROCESS);
  assert.equal(disarmed.workletControl.shouldArmAutomaticMonitoring, true);
  assert.equal(disarmed.workletControl.nextSkipEpoch, 9);
  assert.equal(disarmed.workletControl.armAfterRenderSequence, 29);

  const armed = decidePowerTarget(makeFacts({
    ...routed,
    workletControl: { automaticMonitoringArm: armedArm() }
  }), { mode: PowerPolicy.BALANCED }, NOW);
  assert.equal(armed.targetState, AudioPowerState.ACTIVE);
  assert.equal(armed.processingDirective, ProcessingDirective.ALLOW_AUTOMATIC);
  assert.equal(armed.workletControl.shouldArmAutomaticMonitoring, false);

  const consumedMonitoring = decidePowerTarget(makeFacts({
    ...routed,
    workletControl: {
      automaticMonitoringArm: armedArm(AutomaticMonitoringArmState.CONSUMED)
    },
    workletObservedState: 'monitoring'
  }), { mode: PowerPolicy.BALANCED }, NOW);
  assert.equal(consumedMonitoring.targetState, AudioPowerState.MONITORING);
  assert.equal(consumedMonitoring.processingDirective, ProcessingDirective.ALLOW_AUTOMATIC);

  const consumedWake = decidePowerTarget(makeFacts({
    ...routed,
    workletControl: {
      automaticMonitoringArm: armedArm(AutomaticMonitoringArmState.CONSUMED)
    },
    workletObservedState: 'active',
    activeFullProcessSettled: true
  }), { mode: PowerPolicy.BALANCED }, NOW);
  assert.equal(consumedWake.targetState, AudioPowerState.ACTIVE);
  assert.equal(consumedWake.processingDirective, ProcessingDirective.FULL_PROCESS);
  assert.equal(consumedWake.workletControl.shouldArmAutomaticMonitoring, false);

  const transportDisarmed = decidePowerTarget(makeFacts({
    ...routed,
    inputRouteIntent: InputRouteIntent.MIXED,
    playerState: 'playing',
    transportDemand: true,
    workletControl: { automaticMonitoringArm: disarmedArm() },
    lastSkipEpoch: 11
  }), { mode: PowerPolicy.BALANCED }, NOW);
  assert.equal(transportDisarmed.targetState, AudioPowerState.ACTIVE);
  assert.equal(transportDisarmed.workletControl.shouldArmAutomaticMonitoring, true);
  assert.equal(transportDisarmed.workletControl.nextSkipEpoch, 12);
});

test('paused player silence follows the same automatic monitoring path as silent microphone input', () => {
  const common = {
    inputConfigured: true,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.AVAILABLE,
    routedInputSignalState: 'silent',
    routedOutputSignalState: 'silent',
    noRouteIdleSinceEpochMs: NOW - NO_ROUTE_IDLE_DELAY_MS[PowerPolicy.BALANCED],
    workletControl: { automaticMonitoringArm: disarmedArm() }
  };
  const microphone = decidePowerTarget(makeFacts({
    ...common,
    inputRouteIntent: InputRouteIntent.EXTERNAL
  }), { mode: PowerPolicy.BALANCED }, NOW);
  const player = decidePowerTarget(makeFacts({
    ...common,
    inputRouteIntent: InputRouteIntent.PLAYER_ONLY,
    playerPresent: true,
    playerState: 'paused',
    transportDemand: false
  }), { mode: PowerPolicy.BALANCED }, NOW);

  assert.deepEqual({
    targetState: player.targetState,
    processingDirective: player.processingDirective,
    dspProcessingDemand: player.dspProcessingDemand,
    shouldArmAutomaticMonitoring: player.workletControl.shouldArmAutomaticMonitoring
  }, {
    targetState: microphone.targetState,
    processingDirective: microphone.processingDirective,
    dspProcessingDemand: microphone.dspProcessingDemand,
    shouldArmAutomaticMonitoring: microphone.workletControl.shouldArmAutomaticMonitoring
  });
  assert.equal(player.targetState, AudioPowerState.ACTIVE);
  assert.equal(player.processingDirective, ProcessingDirective.FULL_PROCESS);
  assert.equal(player.workletControl.shouldArmAutomaticMonitoring, true);
});

test('fast-wake unsafe routed chains remain Active but maximum deep suspend uses temporal eligibility', () => {
  const unsafeBeforeDeadline = decidePowerTarget(makeFacts({
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.EXTERNAL,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.AVAILABLE,
    monitoringFastWakeEligible: false,
    monitoringFastWakeBlockerReason: MonitoringFastWakeBlockerReason.NOT_WORKLET_LOCAL,
    visibility: 'hidden',
    hiddenSinceEpochMs: NOW - 299_999,
    routedInputSilentSinceEpochMs: NOW - 299_999,
    routedOutputSilentSinceEpochMs: NOW - 299_999,
    routedSilenceInputAvailabilityRevision: 17,
    observationTopologyRevision: 11,
    observationWorkletGraphGeneration: 12
  }), { mode: PowerPolicy.MAXIMUM }, NOW);
  assert.equal(unsafeBeforeDeadline.targetState, AudioPowerState.ACTIVE);
  assert.equal(unsafeBeforeDeadline.processingDirective, ProcessingDirective.FULL_PROCESS);
  assert.equal(unsafeBeforeDeadline.reason, 'temporal-fast-wake-unsafe');

  const exact = decidePowerTarget(makeFacts({
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.EXTERNAL,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.AVAILABLE,
    monitoringFastWakeEligible: false,
    monitoringFastWakeBlockerReason: MonitoringFastWakeBlockerReason.NOT_WORKLET_LOCAL,
    visibility: 'hidden',
    hiddenSinceEpochMs: NOW - 300_000,
    routedInputSilentSinceEpochMs: NOW - 300_000,
    routedOutputSilentSinceEpochMs: NOW - 300_000,
    routedSilenceInputAvailabilityRevision: 17,
    observationTopologyRevision: 11,
    observationWorkletGraphGeneration: 12
  }), { mode: PowerPolicy.MAXIMUM }, NOW);
  assert.equal(exact.targetState, AudioPowerState.SUSPENDED);
  assert.equal(exact.shouldReleaseInput, true);
  assert.equal(exact.manualResumeRequired, true);
  assert.deepEqual(exact.inputReleaseRequest, {
    releaseCause: 'maximum-routed-input-silence',
    policyGeneration: 7,
    inputGeneration: 13,
    topologyRevision: 11,
    workletGraphGeneration: 12,
    hiddenSinceEpochMs: NOW - 300_000,
    routedInputSilentSinceEpochMs: NOW - 300_000,
    routedOutputSilentSinceEpochMs: NOW - 300_000,
    releaseDeadlineAtEpochMs: NOW,
    routeIntent: InputRouteIntent.EXTERNAL,
    inputAvailability: InputAvailability.AVAILABLE,
    inputAvailabilityRevision: 17,
    observationRequestId: 23,
    renderSequence: 29
  });

  const staleEpoch = decidePowerTarget(makeFacts({
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.EXTERNAL,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.AVAILABLE,
    monitoringFastWakeEligible: false,
    monitoringFastWakeBlockerReason: MonitoringFastWakeBlockerReason.NOT_WORKLET_LOCAL,
    visibility: 'hidden',
    hiddenSinceEpochMs: NOW - 300_000,
    routedInputSilentSinceEpochMs: NOW - 300_000,
    routedOutputSilentSinceEpochMs: NOW - 300_000,
    routedSilenceInputAvailabilityRevision: 17,
    routedSilencePolicyGeneration: 6,
    observationTopologyRevision: 11,
    observationWorkletGraphGeneration: 12
  }), { mode: PowerPolicy.MAXIMUM }, NOW);
  assert.equal(staleEpoch.shouldReleaseInput, false);

  const muted = decidePowerTarget(makeFacts({
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.EXTERNAL,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.MUTED,
    workletControl: {
      automaticMonitoringArm: armedArm(AutomaticMonitoringArmState.CONSUMED)
    },
    workletObservedState: 'monitoring',
    visibility: 'hidden',
    hiddenSinceEpochMs: NOW - 600_000,
    routedInputSilentSinceEpochMs: NOW - 600_000,
    routedOutputSilentSinceEpochMs: NOW - 600_000,
    routedSilenceInputAvailabilityRevision: 17
  }), { mode: PowerPolicy.MAXIMUM }, NOW);
  assert.equal(muted.targetState, AudioPowerState.SUSPENDED);
  assert.equal(muted.shouldReleaseInput, false);
  assert.equal(muted.inputRetentionTarget, true);
});

test('maximum routed-silence suspension is source-neutral while microphone release is not', () => {
  const common = {
    visibility: 'hidden',
    hiddenSinceEpochMs: NOW - 300_000,
    routedInputSilentSinceEpochMs: NOW - 300_000,
    routedOutputSilentSinceEpochMs: NOW - 300_000,
    observationTopologyRevision: 11,
    observationWorkletGraphGeneration: 12,
    playerState: 'paused',
    transportDemand: false
  };
  const player = decidePowerTarget(makeFacts({
    ...common,
    inputRouteIntent: InputRouteIntent.PLAYER_ONLY,
    playerPresent: true
  }), { mode: PowerPolicy.MAXIMUM }, NOW);
  const microphone = decidePowerTarget(makeFacts({
    ...common,
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.EXTERNAL,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.AVAILABLE,
    routedSilenceInputAvailabilityRevision: 17
  }), { mode: PowerPolicy.MAXIMUM }, NOW);

  assert.equal(player.targetState, AudioPowerState.SUSPENDED);
  assert.equal(player.reason, 'maximum-routed-input-silence');
  assert.equal(player.shouldReleaseInput, false);
  assert.equal(player.manualResumeRequired, false);
  assert.equal(microphone.targetState, AudioPowerState.SUSPENDED);
  assert.equal(microphone.shouldReleaseInput, true);
  assert.equal(microphone.inputReleaseRequest.releaseCause, 'maximum-routed-input-silence');
});

test('microphone release requires a full continuously-available interval after muted silence', () => {
  const common = {
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.EXTERNAL,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.AVAILABLE,
    visibility: 'hidden',
    hiddenSinceEpochMs: NOW - 600_000,
    routedInputSilentSinceEpochMs: NOW - 600_000,
    routedOutputSilentSinceEpochMs: NOW - 600_000,
    observationTopologyRevision: 11,
    observationWorkletGraphGeneration: 12
  };
  const before = decidePowerTarget(makeFacts({
    ...common,
    routedInputReleaseEligibleSinceEpochMs: NOW - 59_999
  }), {
    mode: PowerPolicy.MAXIMUM,
    fullSuspendDelaySeconds: 60
  }, NOW);
  assert.equal(before.targetState, AudioPowerState.SUSPENDED);
  assert.equal(before.shouldReleaseInput, false);
  assert.equal(before.inputRetentionTarget, true);
  assert.equal(before.nextDeadlineAt, NOW + 1);

  const exact = decidePowerTarget(makeFacts({
    ...common,
    routedInputReleaseEligibleSinceEpochMs: NOW - 60_000
  }), {
    mode: PowerPolicy.MAXIMUM,
    fullSuspendDelaySeconds: 60
  }, NOW);
  assert.equal(exact.targetState, AudioPowerState.SUSPENDED);
  assert.equal(exact.shouldReleaseInput, true);
  assert.equal(exact.inputRetentionTarget, false);
});

test('maximum player-only signal monitoring and microphone release use independent clocks', () => {
  const playerOnly = {
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.PLAYER_ONLY,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.MUTED,
    playerState: 'paused',
    transportDemand: false,
    routedInputSignalState: 'silent',
    routedOutputSignalState: 'silent',
    inputUnusedSinceEpochMs: NOW - 3_000,
    inputUnusedInputGeneration: 13,
    noRouteIdleSinceEpochMs: NOW - 3_000
  };
  const contextOnly = decidePowerTarget(makeFacts(playerOnly), {
    mode: PowerPolicy.MAXIMUM,
    fullSuspendDelaySeconds: 300
  }, NOW);
  assert.equal(contextOnly.targetState, AudioPowerState.ACTIVE);
  assert.equal(contextOnly.processingDirective, ProcessingDirective.FULL_PROCESS);
  assert.equal(contextOnly.inputSignalForProcessing, 'silent');
  assert.equal(contextOnly.inputRetentionTarget, true);
  assert.equal(contextOnly.shouldReleaseInput, false);
  assert.equal(contextOnly.nextDeadlineAt, NOW + 297_000);

  const release = decidePowerTarget(makeFacts({
    ...playerOnly,
    inputUnusedSinceEpochMs: NOW - 300_000
  }), { mode: PowerPolicy.MAXIMUM }, NOW);
  assert.equal(release.targetState, AudioPowerState.ACTIVE);
  assert.equal(release.inputRetentionTarget, false);
  assert.equal(release.shouldReleaseInput, true);
  assert.equal(release.inputReleaseRequest.releaseCause, 'player-only-retention-expired');
  assert.equal(release.inputReleaseRequest.inputUnusedInputGeneration, 13);

  const staleGeneration = decidePowerTarget(makeFacts({
    ...playerOnly,
    inputUnusedSinceEpochMs: NOW - 600_000,
    inputUnusedInputGeneration: 12
  }), { mode: PowerPolicy.MAXIMUM }, NOW);
  assert.equal(staleGeneration.shouldReleaseInput, false);
  assert.equal(staleGeneration.inputRetentionTarget, true);

  const never = decidePowerTarget(makeFacts({
    ...playerOnly,
    inputUnusedSinceEpochMs: NOW - 900_000
  }), {
    mode: PowerPolicy.MAXIMUM,
    fullSuspendDelaySeconds: 'never'
  }, NOW);
  assert.equal(never.targetState, AudioPowerState.ACTIVE);
  assert.equal(never.inputRetentionTarget, true);
  assert.equal(never.shouldReleaseInput, false);
});

test('zero-output precedence does not turn routed-silence release into an input-only action', () => {
  const decision = decidePowerTarget(makeFacts({
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.EXTERNAL,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.AVAILABLE,
    zeroOutputProof: { proven: true, topologyRevision: 11 },
    zeroOutputIdleSinceEpochMs: NOW - 3_000,
    zeroOutputIdleTopologyRevision: 11,
    zeroOutputIdlePolicyGeneration: 7,
    visibility: 'hidden',
    hiddenSinceEpochMs: NOW - 600_000,
    routedInputSilentSinceEpochMs: NOW - 600_000,
    routedOutputSilentSinceEpochMs: NOW - 600_000,
    routedSilenceInputAvailabilityRevision: 17,
    observationTopologyRevision: 11,
    observationWorkletGraphGeneration: 12
  }), { mode: PowerPolicy.MAXIMUM }, NOW);
  assert.equal(decision.targetState, AudioPowerState.SUSPENDED);
  assert.equal(decision.reason, 'zero-output-no-transport');
  assert.equal(decision.shouldReleaseInput, false);
  assert.equal(decision.inputRetentionTarget, true);
});

test('hold-current preserves effective target and suppresses all new power side effects', () => {
  const decision = decidePowerTarget(makeFacts({
    desiredState: AudioPowerState.MONITORING,
    effectiveState: AudioPowerState.MONITORING,
    processingDirective: ProcessingDirective.FORCE_MONITORING,
    holdCurrentLeases: 1,
    inputConfigured: true,
    inputRouteIntent: InputRouteIntent.PLAYER_ONLY,
    inputResourceState: InputResourceState.LIVE,
    inputAvailability: InputAvailability.AVAILABLE,
    inputUnusedSinceEpochMs: NOW - 900_000,
    inputUnusedInputGeneration: 13,
    zeroOutputProof: { proven: true, topologyRevision: 11 },
    zeroOutputIdleSinceEpochMs: NOW - 30_000
  }), { mode: PowerPolicy.MAXIMUM }, NOW);
  assert.equal(decision.targetState, AudioPowerState.MONITORING);
  assert.equal(decision.processingDirective, ProcessingDirective.FORCE_MONITORING);
  assert.equal(decision.shouldReleaseInput, false);
  assert.equal(decision.workletControl.shouldArmAutomaticMonitoring, false);
});

test('an unconfigured input uses the common no-route DSP decision', () => {
  for (const mode of Object.values(PowerPolicy)) {
    const delay = NO_ROUTE_IDLE_DELAY_MS[mode];
    const commonFacts = {
      inputRouteIntent: InputRouteIntent.NONE,
      transportDemand: false,
      noRouteIdleSinceEpochMs: NOW - delay + 1
    };
    const unconfigured = decidePowerTarget(makeFacts({
      ...commonFacts,
      inputConfigured: false,
      inputResourceState: InputResourceState.RELEASED
    }), { mode }, NOW);
    assert.equal(unconfigured.targetState, AudioPowerState.ACTIVE);
    assert.equal(unconfigured.processingDirective, ProcessingDirective.FULL_PROCESS);
    assert.equal(unconfigured.reason, 'idle-no-route');

    const generator = decidePowerTarget(makeFacts({
      noRouteIdleSinceEpochMs: NOW - delay,
      generatorActive: true
    }), { mode }, NOW);
    assert.equal(generator.targetState, AudioPowerState.ACTIVE);
    assert.equal(generator.processingDirective, ProcessingDirective.FULL_PROCESS);
  }
});

test('a connected silent input follows the same DSP path as a silent external input', () => {
  for (const mode of Object.values(PowerPolicy)) {
    const commonFacts = {
      pipelineInputConnected: true,
      routedInputSignalState: 'silent',
      routedOutputSignalState: 'silent',
      inputSignalForProcessing: 'silent',
      outputSignalState: 'silent'
    };
    const silentFallback = decidePowerTarget(makeFacts({
      ...commonFacts,
      inputRouteIntent: InputRouteIntent.NONE,
      inputConfigured: false,
      inputResourceState: InputResourceState.NOT_CONFIGURED
    }), { mode }, NOW);
    const silentExternalInput = decidePowerTarget(makeFacts({
      ...commonFacts,
      inputRouteIntent: InputRouteIntent.EXTERNAL,
      inputConfigured: true,
      inputResourceState: InputResourceState.LIVE,
      inputAvailability: InputAvailability.AVAILABLE
    }), { mode }, NOW);
    for (const key of ['targetState', 'processingDirective', 'dspProcessingDemand', 'reason']) {
      assert.equal(silentFallback[key], silentExternalInput[key], `${mode}/${key}`);
    }
  }
});

test('generation domains remain distinct in every pure decision', () => {
  const decision = decidePowerTarget(makeFacts({
    policyGeneration: 2,
    topologyRevision: 3,
    workletGraphGeneration: 5,
    inputGeneration: 7,
    noRouteIdleSinceEpochMs: NOW
  }), DEFAULT_POWER_SETTINGS, NOW);
  assert.equal(decision.policyGeneration, 2);
  assert.equal(decision.topologyRevision, 3);
  assert.equal(decision.workletGraphGeneration, 5);
  assert.equal(decision.inputGeneration, 7);
  assert.deepEqual(Object.keys(decision).sort(), [...POWER_DECISION_KEYS].sort());
  assert.equal(validatePowerDecision(decision), true);
  assert.deepEqual(createStablePowerTransition(decision.policyGeneration), {
    state: TransitionState.STABLE,
    operationId: null,
    generation: 2
  });
});

test('required resume resources distinguish blocking mixed playback from healthy input', () => {
  assert.deepEqual(getRequiredResourcesForResume(ResumeKind.PLAYER_ONLY_PLAY, {
    inputRouteIntent: InputRouteIntent.PLAYER_ONLY
  }), {
    blocking: ['context', 'outputBridge', 'worklets', 'playerSource'],
    healthy: [],
    allowActiveWhenHealthyMissing: false
  });
  assert.deepEqual(getRequiredResourcesForResume(ResumeKind.MIXED_PLAY, {
    inputRouteIntent: InputRouteIntent.MIXED
  }), {
    blocking: ['context', 'outputBridge', 'worklets', 'playerSource'],
    healthy: ['input', 'route'],
    allowActiveWhenHealthyMissing: true
  });
  assert.equal(WORKLET_PROCESSING_DIRECTIVES.includes(ProcessingDirective.SUSPENDED), false);
});
