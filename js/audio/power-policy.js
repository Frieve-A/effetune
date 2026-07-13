export const AudioPowerState = Object.freeze({
  ACTIVE: 'ACTIVE',
  MONITORING: 'MONITORING',
  SUSPENDED: 'SUSPENDED'
});

export const PowerPolicy = Object.freeze({
  CONTINUOUS: 'continuous',
  BALANCED: 'balanced',
  MAXIMUM: 'maximum'
});

export const ProcessingDirective = Object.freeze({
  FULL_PROCESS: 'full-process',
  ALLOW_AUTOMATIC: 'allow-automatic',
  FORCE_MONITORING: 'force-monitoring',
  BYPASS_TRANSPORT: 'bypass-transport',
  ZERO_OUTPUT_TRANSPORT: 'zero-output-transport',
  SUSPENDED: 'suspended'
});

export const InputRouteIntent = Object.freeze({
  NONE: 'none',
  EXTERNAL: 'external',
  MIXED: 'mixed',
  PLAYER_ONLY: 'player-only'
});

export const TemporalPowerSkipCapability = Object.freeze({
  STATELESS: 'stateless',
  RESET_ON_RESUME: 'reset-on-resume',
  AGE_BY_SKIPPED_FRAMES: 'age-by-skipped-frames',
  MUST_PROCESS: 'must-process'
});

export const InputResourceState = Object.freeze({
  NOT_CONFIGURED: 'not-configured',
  ACQUIRING: 'acquiring',
  LIVE: 'live',
  ENDED: 'ended',
  DENIED: 'denied',
  RELEASED: 'released',
  ERROR: 'error',
  UNKNOWN: 'unknown'
});

export const InputAvailability = Object.freeze({
  AVAILABLE: 'available',
  MUTED: 'muted',
  DISABLED: 'disabled',
  UNKNOWN: 'unknown'
});

export const ResourceHealth = Object.freeze({
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown'
});

export const TransitionState = Object.freeze({
  STABLE: 'stable',
  SUSPENDING: 'suspending',
  RESUMING: 'resuming',
  RELEASING_INPUT: 'releasing-input',
  ROLLING_BACK: 'rolling-back'
});

export const AutomaticMonitoringArmState = Object.freeze({
  DISARMED: 'disarmed',
  ARMED: 'armed',
  CONSUMED: 'consumed'
});

export const MonitoringFastWakeBlockerReason = Object.freeze({
  NOT_WORKLET_LOCAL: 'temporal-preparation-not-worklet-local',
  UNBOUNDED: 'temporal-preparation-unbounded',
  ALLOCATING: 'temporal-preparation-allocating',
  MUST_PROCESS: 'temporal-must-process',
  RUNTIME_FAILED: 'temporal-preparation-runtime-failed'
});

export const ResumeKind = Object.freeze({
  NONE: 'none',
  ROUTE_ACTIVATION: 'route-activation',
  PLAYER_ONLY_PLAY: 'player-only-play',
  MIXED_PLAY: 'mixed-play',
  DEDICATED_INPUT: 'dedicated-input',
  UNEXPECTED_RECOVERY: 'unexpected-recovery'
});

export const SuspendCause = Object.freeze({
  IDLE_NO_ROUTE: 'idle-no-route',
  ZERO_OUTPUT_NO_TRANSPORT: 'zero-output-no-transport',
  MAXIMUM_ROUTED_INPUT_SILENCE: 'maximum-routed-input-silence',
  BROWSER: 'browser',
  UNKNOWN: 'unknown'
});

export const DEFAULT_POWER_SETTINGS = Object.freeze({
  mode: PowerPolicy.BALANCED,
  silenceThresholdDb: -80,
  fullSuspendDelaySeconds: 300
});

export const NO_ROUTE_IDLE_DELAY_MS = Object.freeze({
  [PowerPolicy.CONTINUOUS]: 30_000,
  [PowerPolicy.BALANCED]: 15_000,
  [PowerPolicy.MAXIMUM]: 3_000
});

export const ROUTED_MONITORING_SILENCE_DELAY_MS = 60_000;
export const SILENCE_THRESHOLD_DB_VALUES = Object.freeze([-90, -80, -70, -60, -50, -40, -30, -20]);
export const FULL_SUSPEND_DELAY_SECONDS_VALUES = Object.freeze([60, 300, 900, 'never']);
export const WORKLET_PROCESSING_DIRECTIVES = Object.freeze([
  ProcessingDirective.FULL_PROCESS,
  ProcessingDirective.ALLOW_AUTOMATIC,
  ProcessingDirective.FORCE_MONITORING,
  ProcessingDirective.BYPASS_TRANSPORT,
  ProcessingDirective.ZERO_OUTPUT_TRANSPORT
]);

export const POWER_TRANSITION_KEYS = Object.freeze(['state', 'operationId', 'generation']);
export const AUTOMATIC_MONITORING_ARM_KEYS = Object.freeze([
  'state',
  'commandId',
  'skipEpoch',
  'armAfterRenderSequence'
]);
export const INPUT_RESOURCE_STATUS_KEYS = Object.freeze([
  'state',
  'availability',
  'configured',
  'inputConfigRevision',
  'inputGeneration',
  'inputAvailabilityRevision',
  'operationId',
  'observedAtEpochMs',
  'errorCode'
]);
export const REQUIRED_RESOURCES_KEYS = Object.freeze([
  'blocking',
  'healthy',
  'allowActiveWhenHealthyMissing'
]);
export const POWER_DECISION_KEYS = Object.freeze([
  'targetState',
  'reason',
  'nextDeadlineAt',
  'policyGeneration',
  'topologyRevision',
  'workletGraphGeneration',
  'inputGeneration',
  'processingDirective',
  'temporalSkipEligible',
  'temporalSkipReason',
  'monitoringFastWakeEligible',
  'monitoringFastWakeBlockerReason',
  'workletControl',
  'skipEpoch',
  'transportDemand',
  'dspProcessingDemand',
  'inputSignalForProcessing',
  'inputRetentionTarget',
  'shouldReleaseInput',
  'inputReleaseRequest',
  'manualResumeRequired',
  'requiredResources'
]);

const WORKLET_CONTROL_KEYS = Object.freeze([
  'automaticMonitoringArm',
  'shouldArmAutomaticMonitoring',
  'armAfterRenderSequence',
  'nextSkipEpoch'
]);
const POWER_POLICY_VALUES = new Set(Object.values(PowerPolicy));
const AUDIO_POWER_STATE_VALUES = new Set(Object.values(AudioPowerState));
const PROCESSING_DIRECTIVE_VALUES = new Set(Object.values(ProcessingDirective));
const INPUT_ROUTE_INTENT_VALUES = new Set(Object.values(InputRouteIntent));
const INPUT_RESOURCE_STATE_VALUES = new Set(Object.values(InputResourceState));
const INPUT_AVAILABILITY_VALUES = new Set(Object.values(InputAvailability));
const TRANSITION_STATE_VALUES = new Set(Object.values(TransitionState));
const ARM_STATE_VALUES = new Set(Object.values(AutomaticMonitoringArmState));
const MONITORING_BLOCKER_VALUES = new Set(Object.values(MonitoringFastWakeBlockerReason));
const RESUME_KIND_VALUES = new Set(Object.values(ResumeKind));
const INPUT_SIGNAL_VALUES = new Set(['active', 'silent', 'unknown']);

const DISARMED_AUTOMATIC_MONITORING_ARM = Object.freeze({
  state: AutomaticMonitoringArmState.DISARMED,
  commandId: null,
  skipEpoch: null,
  armAfterRenderSequence: null
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) return false;
  const keys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNullableIdentity(value) {
  return value === null || isNonNegativeSafeInteger(value) ||
    (typeof value === 'string' && value.length > 0);
}

function isNullableTimestamp(value) {
  return value === null || (Number.isFinite(value) && value >= 0);
}

function getLeaseCount(value) {
  if (Number.isFinite(value)) return value > 0 ? value : 0;
  if (Array.isArray(value) || value instanceof Set || value instanceof Map) return value.size ?? value.length;
  return value ? 1 : 0;
}

function toGeneration(value) {
  return isNonNegativeSafeInteger(value) ? value : 0;
}

function getInputStatus(facts) {
  const status = facts.resourceStatus?.input;
  return {
    state: status?.state ?? facts.inputResourceState ?? InputResourceState.UNKNOWN,
    availability: status?.availability ?? facts.inputAvailability ?? InputAvailability.UNKNOWN,
    configured: typeof status?.configured === 'boolean'
      ? status.configured
      : Boolean(facts.inputConfigured),
    inputConfigRevision: toGeneration(status?.inputConfigRevision ?? facts.inputConfigRevision),
    inputGeneration: toGeneration(status?.inputGeneration ?? facts.inputGeneration),
    inputAvailabilityRevision: toGeneration(
      status?.inputAvailabilityRevision ?? facts.inputAvailabilityRevision
    )
  };
}

function getAutomaticMonitoringArm(facts) {
  const candidate = facts.workletControl?.automaticMonitoringArm ??
    facts.automaticMonitoringArm ??
    facts.resourceStatus?.worklets?.automaticMonitoringArm;
  if (!validateAutomaticMonitoringArm(candidate) || facts.automaticMonitoringArmCurrent === false) {
    return { ...DISARMED_AUTOMATIC_MONITORING_ARM };
  }
  return { ...candidate };
}

function getTemporalFacts(facts) {
  const temporalStatus = facts.resourceStatus?.worklets?.temporalSkip;
  const mustProcess = facts.temporalCapabilityAggregate === TemporalPowerSkipCapability.MUST_PROCESS ||
    facts.temporalMustProcess === true ||
    temporalStatus?.blockerReason === MonitoringFastWakeBlockerReason.MUST_PROCESS ||
    facts.temporalSkipReason === MonitoringFastWakeBlockerReason.MUST_PROCESS;
  let eligible;
  if (mustProcess) {
    eligible = false;
  } else if (typeof facts.temporalSkipEligible === 'boolean') {
    eligible = facts.temporalSkipEligible;
  } else {
    eligible = temporalStatus?.status === 'eligible';
  }

  let temporalSkipReason = eligible ? null : facts.temporalSkipReason ?? temporalStatus?.blockerReason;
  if (!eligible && !temporalSkipReason) {
    temporalSkipReason = mustProcess
      ? MonitoringFastWakeBlockerReason.MUST_PROCESS
      : 'temporal-capability-unknown';
  }

  let monitoringFastWakeEligible = facts.monitoringFastWakeEligible;
  if (typeof monitoringFastWakeEligible !== 'boolean') {
    monitoringFastWakeEligible = facts.resourceStatus?.worklets?.monitoringFastWakeEligible === true;
  }
  if (mustProcess) monitoringFastWakeEligible = false;

  let monitoringFastWakeBlockerReason = monitoringFastWakeEligible
    ? null
    : facts.monitoringFastWakeBlockerReason ??
      facts.resourceStatus?.worklets?.monitoringFastWakeBlockerReason;
  if (!monitoringFastWakeEligible && !monitoringFastWakeBlockerReason) {
    monitoringFastWakeBlockerReason = mustProcess
      ? MonitoringFastWakeBlockerReason.MUST_PROCESS
      : MonitoringFastWakeBlockerReason.NOT_WORKLET_LOCAL;
  }
  if (!monitoringFastWakeEligible &&
      !MONITORING_BLOCKER_VALUES.has(monitoringFastWakeBlockerReason)) {
    monitoringFastWakeBlockerReason = MonitoringFastWakeBlockerReason.NOT_WORKLET_LOCAL;
  }

  return {
    eligible,
    mustProcess,
    temporalSkipReason,
    monitoringFastWakeEligible,
    monitoringFastWakeBlockerReason
  };
}

function hasCurrentZeroOutputProof(facts) {
  const proof = facts.zeroOutputProof;
  const proven = proof?.proven === true || facts.zeroOutputProven === true;
  if (!proven) return false;
  const proofRevision = proof?.topologyRevision ?? facts.zeroOutputProofTopologyRevision;
  return proofRevision === undefined || proofRevision === facts.topologyRevision;
}

function hasMasterBypass(facts) {
  return facts.masterBypass === true || facts.masterBypassEnabled === true;
}

function hasFreshWorkletObservation(facts) {
  if (facts.effectiveState === AudioPowerState.SUSPENDED) return true;
  if (typeof facts.workletObservationFresh === 'boolean') return facts.workletObservationFresh;
  if (typeof facts.freshWorkletObservation === 'boolean') return facts.freshWorkletObservation;
  return false;
}

function resourcesKnown(facts) {
  return facts.resourceHealth !== ResourceHealth.UNKNOWN;
}

function deadlineStatus(startEpochMs, delayMs, now) {
  if (!Number.isFinite(startEpochMs) || !Number.isFinite(delayMs)) {
    return { exists: false, reached: false, deadlineAt: null };
  }
  const elapsed = Math.max(0, now - startEpochMs);
  const deadlineAt = now < startEpochMs
    ? now + delayMs
    : startEpochMs + delayMs;
  return {
    exists: true,
    reached: elapsed >= delayMs,
    deadlineAt
  };
}

function earlierDeadline(first, second) {
  if (!Number.isFinite(first)) return Number.isFinite(second) ? second : null;
  if (!Number.isFinite(second)) return first;
  return Math.min(first, second);
}

function isPlayerRunningState(playerState) {
  return playerState === 'playing' || playerState === 'starting' ||
    playerState === 'seeking' || playerState === 'transitioning';
}

function isRoutedIntent(routeIntent) {
  return routeIntent === InputRouteIntent.EXTERNAL || routeIntent === InputRouteIntent.MIXED;
}

function routeCarriesPipelineSignal(routeIntent) {
  return routeIntent === InputRouteIntent.PLAYER_ONLY || isRoutedIntent(routeIntent);
}

function hasPipelineSignalSource(facts, routeIntent) {
  return facts.pipelineInputConnected === true || routeCarriesPipelineSignal(routeIntent);
}

function getWorkletObservedState(facts) {
  return facts.workletObservedState ?? facts.workletState ?? facts.resourceStatus?.worklets?.state;
}

function isCurrentZeroOutputClock(facts) {
  const topologyMatches = facts.zeroOutputIdleTopologyRevision === undefined ||
    facts.zeroOutputIdleTopologyRevision === facts.topologyRevision;
  const policyMatches = facts.zeroOutputIdlePolicyGeneration === undefined ||
    facts.zeroOutputIdlePolicyGeneration === facts.policyGeneration;
  return topologyMatches && policyMatches;
}

function isCurrentNoRouteClock(facts) {
  const topologyMatches = facts.noRouteIdleTopologyRevision === undefined ||
    facts.noRouteIdleTopologyRevision === facts.topologyRevision;
  const policyMatches = facts.noRouteIdlePolicyGeneration === undefined ||
    facts.noRouteIdlePolicyGeneration === facts.policyGeneration;
  return topologyMatches && policyMatches;
}

function hasHardFullProcessBlocker(facts, temporal) {
  return temporal.mustProcess || facts.resourceMutationInProgress === true ||
    getLeaseCount(facts.forceActiveLeases) > 0 ||
    facts.parallelPipelineActive === true;
}

function hasHoldCurrentBarrier(facts) {
  return getLeaseCount(facts.holdCurrentLeases) > 0 ||
    facts.holdCurrent === true ||
    facts.offlineProcessingBarrier === true;
}

function canCommitSuspended(facts) {
  return facts.effectiveState === AudioPowerState.SUSPENDED ||
    (hasFreshWorkletObservation(facts) && resourcesKnown(facts));
}

function makeCommonReleaseIdentity(facts, inputStatus) {
  return {
    policyGeneration: toGeneration(facts.policyGeneration),
    inputGeneration: inputStatus.inputGeneration,
    topologyRevision: toGeneration(facts.topologyRevision),
    workletGraphGeneration: toGeneration(facts.workletGraphGeneration)
  };
}

function getPlayerOnlyReleaseStatus(facts, settings, now, routeIntent, inputStatus) {
  if (settings.mode !== PowerPolicy.MAXIMUM ||
      settings.fullSuspendDelaySeconds === 'never' ||
      routeIntent !== InputRouteIntent.PLAYER_ONLY ||
      !inputStatus.configured ||
      inputStatus.state !== InputResourceState.LIVE ||
      !Number.isFinite(facts.inputUnusedSinceEpochMs) ||
      facts.inputUnusedInputGeneration !== inputStatus.inputGeneration ||
      facts.manualResumeRequired === true) {
    return { eligible: false, reached: false, deadlineAt: null };
  }
  const status = deadlineStatus(
    facts.inputUnusedSinceEpochMs,
    settings.fullSuspendDelaySeconds * 1000,
    now
  );
  return { eligible: true, ...status };
}

function getMaximumRoutedSilenceStatus(facts, settings, now, routeIntent, temporal) {
  const delay = settings.fullSuspendDelaySeconds;
  const hidden = facts.visibility === 'hidden' ||
    facts.pageLifecycle === 'hidden' || facts.pageLifecycle === 'frozen';
  const observationFresh = facts.routedInputObservationFresh === true &&
    facts.routedOutputObservationFresh === true &&
    hasFreshWorkletObservation(facts);
  const observationIdentityCurrent =
    isNonNegativeSafeInteger(facts.observationRequestId) &&
    isNonNegativeSafeInteger(facts.renderSequence) &&
    (facts.observationTopologyRevision === undefined ||
      facts.observationTopologyRevision === facts.topologyRevision) &&
    (facts.observationWorkletGraphGeneration === undefined ||
      facts.observationWorkletGraphGeneration === facts.workletGraphGeneration);
  const causeTokensCurrent =
    (facts.routedSilencePolicyGeneration === undefined ||
      facts.routedSilencePolicyGeneration === facts.policyGeneration) &&
    (facts.routedSilenceTopologyRevision === undefined ||
      facts.routedSilenceTopologyRevision === facts.topologyRevision) &&
    (facts.routedSilenceWorkletGraphGeneration === undefined ||
      facts.routedSilenceWorkletGraphGeneration === facts.workletGraphGeneration) &&
    (facts.routedSilenceRouteIntent === undefined ||
      facts.routedSilenceRouteIntent === routeIntent);
  const silenceCurrent = facts.routedInputSignalState === 'silent' &&
    facts.routedOutputSignalState === 'silent';
  const blocked = hasHardFullProcessBlocker(facts, temporal) ||
    getLeaseCount(facts.holdCurrentLeases) > 0 ||
    deriveDspProcessingDemand(facts);

  if (settings.mode !== PowerPolicy.MAXIMUM || delay === 'never' ||
      !hasPipelineSignalSource(facts, routeIntent) || !hidden || !temporal.eligible || blocked ||
      !observationFresh || !observationIdentityCurrent ||
      !causeTokensCurrent || !silenceCurrent || !resourcesKnown(facts) ||
      !Number.isFinite(facts.hiddenSinceEpochMs) ||
      !Number.isFinite(facts.routedInputSilentSinceEpochMs) ||
      !Number.isFinite(facts.routedOutputSilentSinceEpochMs)) {
    return { eligible: false, reached: false, deadlineAt: null, startAt: null };
  }

  const startAt = Math.max(
    facts.hiddenSinceEpochMs,
    facts.routedInputSilentSinceEpochMs,
    facts.routedOutputSilentSinceEpochMs
  );
  return {
    eligible: true,
    startAt,
    ...deadlineStatus(startAt, delay * 1000, now)
  };
}

function getMaximumRoutedInputReleaseStatus(
  facts,
  settings,
  now,
  routeIntent,
  inputStatus,
  routedSilenceStatus
) {
  const releaseEpochCurrent =
    facts.routedInputReleasePolicyGeneration === facts.policyGeneration &&
    facts.routedInputReleaseInputGeneration === inputStatus.inputGeneration &&
    facts.routedInputReleaseInputAvailabilityRevision ===
      inputStatus.inputAvailabilityRevision &&
    facts.routedInputReleaseTopologyRevision === facts.topologyRevision &&
    facts.routedInputReleaseWorkletGraphGeneration === facts.workletGraphGeneration &&
    (facts.routedInputReleaseRouteIntent === undefined ||
      facts.routedInputReleaseRouteIntent === routeIntent);
  if (!routedSilenceStatus?.eligible || !isRoutedIntent(routeIntent) ||
      inputStatus.state !== InputResourceState.LIVE ||
      inputStatus.availability !== InputAvailability.AVAILABLE ||
      !Number.isFinite(facts.routedInputReleaseEligibleSinceEpochMs) ||
      !releaseEpochCurrent) {
    return { eligible: false, reached: false, deadlineAt: null, startAt: null };
  }
  const startAt = Math.max(
    routedSilenceStatus.startAt,
    facts.routedInputReleaseEligibleSinceEpochMs
  );
  return {
    eligible: true,
    startAt,
    ...deadlineStatus(startAt, settings.fullSuspendDelaySeconds * 1000, now)
  };
}

function makePlayerOnlyReleaseRequest(facts, inputStatus) {
  return {
    releaseCause: 'player-only-retention-expired',
    ...makeCommonReleaseIdentity(facts, inputStatus),
    inputUnusedSinceEpochMs: facts.inputUnusedSinceEpochMs,
    inputUnusedInputGeneration: facts.inputUnusedInputGeneration,
    routeIntent: InputRouteIntent.PLAYER_ONLY,
    routeIntentRevision: toGeneration(facts.routeIntentRevision)
  };
}

function makeMaximumRoutedReleaseRequest(facts, inputStatus, routeIntent, deadlineAt) {
  return {
    releaseCause: 'maximum-routed-input-silence',
    ...makeCommonReleaseIdentity(facts, inputStatus),
    hiddenSinceEpochMs: facts.hiddenSinceEpochMs,
    routedInputSilentSinceEpochMs: facts.routedInputSilentSinceEpochMs,
    routedOutputSilentSinceEpochMs: facts.routedOutputSilentSinceEpochMs,
    releaseDeadlineAtEpochMs: deadlineAt,
    routeIntent,
    inputAvailability: InputAvailability.AVAILABLE,
    inputAvailabilityRevision: inputStatus.inputAvailabilityRevision,
    observationRequestId: facts.observationRequestId,
    renderSequence: facts.renderSequence
  };
}

function normalizeRequiredResourceList(values) {
  return [...new Set((values || []).filter(value => typeof value === 'string' && value.length > 0))];
}

function createRequiredResources(blocking = [], healthy = [], allowActiveWhenHealthyMissing = false) {
  return {
    blocking: normalizeRequiredResourceList(blocking),
    healthy: normalizeRequiredResourceList(healthy),
    allowActiveWhenHealthyMissing: Boolean(allowActiveWhenHealthyMissing)
  };
}

export function normalizePowerSettings(config = {}) {
  const candidate = isObject(config?.powerSaving) ? config.powerSaving :
    (isObject(config) ? config : {});
  return {
    mode: POWER_POLICY_VALUES.has(candidate.mode) ? candidate.mode : DEFAULT_POWER_SETTINGS.mode,
    silenceThresholdDb: SILENCE_THRESHOLD_DB_VALUES.includes(candidate.silenceThresholdDb)
      ? candidate.silenceThresholdDb
      : DEFAULT_POWER_SETTINGS.silenceThresholdDb,
    fullSuspendDelaySeconds: FULL_SUSPEND_DELAY_SECONDS_VALUES.includes(
      candidate.fullSuspendDelaySeconds
    )
      ? candidate.fullSuspendDelaySeconds
      : DEFAULT_POWER_SETTINGS.fullSuspendDelaySeconds
  };
}

export function mergePowerSavingSettings(currentPowerSaving = {}, partialPowerSaving = {}) {
  return normalizePowerSettings({
    ...normalizePowerSettings(currentPowerSaving),
    ...(isObject(partialPowerSaving) ? partialPowerSaving : {})
  });
}

export function classifyInputRoute(facts = {}) {
  if (INPUT_ROUTE_INTENT_VALUES.has(facts.inputRouteIntent)) return facts.inputRouteIntent;
  const inputConfigured = facts.inputConfigured === true;
  const playerPresent = typeof facts.playerPresent === 'boolean'
    ? facts.playerPresent
    : facts.hasPlayer === true || facts.player != null ||
      (typeof facts.playerState === 'string' && facts.playerState !== 'absent');
  if (playerPresent) {
    return facts.useInputWithPlayer === true && inputConfigured
      ? InputRouteIntent.MIXED
      : InputRouteIntent.PLAYER_ONLY;
  }
  return inputConfigured ? InputRouteIntent.EXTERNAL : InputRouteIntent.NONE;
}

export function deriveTransportDemand(facts = {}) {
  if (typeof facts.transportDemand === 'boolean') return facts.transportDemand;
  return isPlayerRunningState(facts.playerState) || facts.transportTransitionActive === true;
}

export function deriveInputSignalObservation(facts = {}) {
  const routeIntent = classifyInputRoute(facts);
  if (!hasPipelineSignalSource(facts, routeIntent)) {
    return { state: 'silent', reason: 'not-routed' };
  }

  if (facts.routedInputObservationFresh === false) {
    return { state: 'unknown', reason: 'observation-stale' };
  }
  const state = facts.routedInputSignalState;
  return INPUT_SIGNAL_VALUES.has(state)
    ? { state, reason: null }
    : { state: 'unknown', reason: 'observation-unavailable' };
}

export function deriveInputSignalForProcessing(facts = {}) {
  return deriveInputSignalObservation(facts).state;
}

export function deriveDspProcessingDemand(facts = {}) {
  const temporal = getTemporalFacts(facts);
  if (temporal.mustProcess) return true;
  if (hasHardFullProcessBlocker(facts, temporal)) return true;
  if (hasCurrentZeroOutputProof(facts) && temporal.eligible) return false;
  if (hasMasterBypass(facts) && temporal.eligible) return false;
  if (deriveInputSignalForProcessing(facts) === 'active') return true;
  if (facts.outputSignalState === 'active' || facts.outputTailActive === true ||
      facts.keepAlivePluginActive === true || facts.continuousDcBlocker === true ||
      facts.generatorActive === true) return true;
  if (typeof facts.dspProcessingDemand === 'boolean') return facts.dspProcessingDemand;
  return deriveTransportDemand(facts);
}

export function deriveInputRetentionTarget(facts = {}, settings = {}, now = 0) {
  const normalizedSettings = normalizePowerSettings(settings);
  const inputStatus = getInputStatus(facts);
  if (!inputStatus.configured) return false;

  const explicitResume = facts.inputResumeRequested === true ||
    facts.resumeKind === ResumeKind.DEDICATED_INPUT || facts.resumeKind === ResumeKind.MIXED_PLAY;
  if (facts.manualResumeRequired === true && !explicitResume) return false;
  if (normalizedSettings.mode !== PowerPolicy.MAXIMUM) return true;

  const routeIntent = classifyInputRoute(facts);
  const playerRelease = getPlayerOnlyReleaseStatus(
    facts,
    normalizedSettings,
    now,
    routeIntent,
    inputStatus
  );
  if (playerRelease.reached) return false;

  const temporal = getTemporalFacts(facts);
  if (!deriveTransportDemand(facts) && hasCurrentZeroOutputProof(facts) && temporal.eligible) {
    return true;
  }

  const routedSilence = getMaximumRoutedSilenceStatus(
    facts,
    normalizedSettings,
    now,
    routeIntent,
    temporal
  );
  const routedInputRelease = getMaximumRoutedInputReleaseStatus(
    facts,
    normalizedSettings,
    now,
    routeIntent,
    inputStatus,
    routedSilence
  );
  return !routedInputRelease.reached;
}

export function getRequiredResourcesForResume(resumeKind, facts = {}) {
  const kind = RESUME_KIND_VALUES.has(resumeKind) ? resumeKind : ResumeKind.NONE;
  const output = facts.outputBridgeRequired === false ? [] : ['outputBridge'];
  const liveGraph = ['context', ...output, 'worklets'];
  const routeIntent = classifyInputRoute(facts);

  switch (kind) {
    case ResumeKind.ROUTE_ACTIVATION:
      if (isRoutedIntent(routeIntent) && facts.routeActivationRequiresInput !== false) {
        return createRequiredResources([...liveGraph, 'input', 'route']);
      }
      return createRequiredResources([...liveGraph, 'route']);
    case ResumeKind.PLAYER_ONLY_PLAY:
      return createRequiredResources([...liveGraph, 'playerSource']);
    case ResumeKind.MIXED_PLAY:
      return createRequiredResources(
        [...liveGraph, 'playerSource'],
        ['input', 'route'],
        true
      );
    case ResumeKind.DEDICATED_INPUT:
      return createRequiredResources([...liveGraph, 'input', 'route']);
    case ResumeKind.UNEXPECTED_RECOVERY:
      return validateRequiredResources(facts.requiredResources)
        ? {
            blocking: [...facts.requiredResources.blocking],
            healthy: [...facts.requiredResources.healthy],
            allowActiveWhenHealthyMissing: facts.requiredResources.allowActiveWhenHealthyMissing
          }
        : createRequiredResources(liveGraph);
    default:
      return createRequiredResources();
  }
}

export function deriveProcessingDirective(facts = {}, settings = {}, now = 0) {
  return decidePowerTarget(facts, settings, now).processingDirective;
}

export function decidePowerTarget(facts = {}, settings = {}, now = 0) {
  if (!isObject(facts)) throw new TypeError('facts must be an object');
  if (!Number.isFinite(now) || now < 0) throw new TypeError('now must be a non-negative finite number');

  const normalizedSettings = normalizePowerSettings(settings);
  const routeIntent = classifyInputRoute(facts);
  const transportDemand = deriveTransportDemand(facts);
  const inputSignalForProcessing = deriveInputSignalForProcessing({ ...facts, inputRouteIntent: routeIntent });
  const inputStatus = getInputStatus(facts);
  const temporal = getTemporalFacts(facts);
  const arm = getAutomaticMonitoringArm(facts);
  const hardFullProcessBlocker = hasHardFullProcessBlocker(facts, temporal);
  const holdCurrent = hasHoldCurrentBarrier(facts);
  const zeroOutputProven = hasCurrentZeroOutputProof(facts);
  const masterBypass = hasMasterBypass(facts);
  const noRouteDelayMs = NO_ROUTE_IDLE_DELAY_MS[normalizedSettings.mode];
  const inputRetentionBeforeDecision = deriveInputRetentionTarget(facts, normalizedSettings, now);
  const policyGeneration = toGeneration(facts.policyGeneration);
  const topologyRevision = toGeneration(facts.topologyRevision);
  const workletGraphGeneration = toGeneration(facts.workletGraphGeneration);
  const inputGeneration = inputStatus.inputGeneration;
  const currentWorkletState = getWorkletObservedState(facts);
  const pipelineSignalSourcePresent = hasPipelineSignalSource(facts, routeIntent);

  let targetState = AudioPowerState.ACTIVE;
  let reason = 'dsp-processing-demand';
  let processingDirective = ProcessingDirective.FULL_PROCESS;
  let dspProcessingDemand = deriveDspProcessingDemand({ ...facts, inputRouteIntent: routeIntent });
  let nextDeadlineAt = null;
  let shouldArmAutomaticMonitoring = false;
  let armAfterRenderSequence = null;
  let nextSkipEpoch = null;
  let audioBranchResolved = false;
  let maximumRoutedSilence = null;
  let maximumRoutedInputRelease = null;

  if (facts.enabled === false || facts.isElectron === true) {
    reason = 'legacy-controller';
    dspProcessingDemand = true;
  } else if (holdCurrent) {
    targetState = AUDIO_POWER_STATE_VALUES.has(facts.desiredState)
      ? facts.desiredState
      : (AUDIO_POWER_STATE_VALUES.has(facts.effectiveState)
          ? facts.effectiveState
          : AudioPowerState.ACTIVE);
    processingDirective = PROCESSING_DIRECTIVE_VALUES.has(facts.processingDirective)
      ? facts.processingDirective
      : ProcessingDirective.FULL_PROCESS;
    reason = 'hold-current';
    dspProcessingDemand = typeof facts.dspProcessingDemand === 'boolean'
      ? facts.dspProcessingDemand
      : processingDirective === ProcessingDirective.FULL_PROCESS;
    audioBranchResolved = true;
  } else if (hardFullProcessBlocker) {
    targetState = AudioPowerState.ACTIVE;
    processingDirective = ProcessingDirective.FULL_PROCESS;
    dspProcessingDemand = true;
    reason = temporal.mustProcess
      ? MonitoringFastWakeBlockerReason.MUST_PROCESS
      : 'full-process-lease';
    audioBranchResolved = true;
  }

  if (!audioBranchResolved && zeroOutputProven && temporal.eligible) {
    if (transportDemand) {
      targetState = AudioPowerState.ACTIVE;
      processingDirective = ProcessingDirective.ZERO_OUTPUT_TRANSPORT;
      dspProcessingDemand = false;
      reason = 'zero-output-transport';
    } else {
      const start = isCurrentZeroOutputClock(facts)
        ? facts.zeroOutputIdleSinceEpochMs
        : null;
      const deadline = deadlineStatus(
        Number.isFinite(start) ? start : now,
        noRouteDelayMs,
        now
      );
      const suspended = (deadline.reached && canCommitSuspended(facts)) ||
        facts.effectiveState === AudioPowerState.SUSPENDED;
      targetState = suspended ? AudioPowerState.SUSPENDED : AudioPowerState.ACTIVE;
      processingDirective = suspended
        ? ProcessingDirective.SUSPENDED
        : ProcessingDirective.ZERO_OUTPUT_TRANSPORT;
      dspProcessingDemand = false;
      reason = SuspendCause.ZERO_OUTPUT_NO_TRANSPORT;
      nextDeadlineAt = suspended ? null : deadline.deadlineAt;
    }
    audioBranchResolved = true;
  }

  if (!audioBranchResolved && transportDemand) {
    targetState = AudioPowerState.ACTIVE;
    reason = 'transport-demand';
    if (masterBypass && temporal.eligible) {
      processingDirective = ProcessingDirective.BYPASS_TRANSPORT;
      dspProcessingDemand = false;
      reason = 'bypass-transport';
    } else if (pipelineSignalSourcePresent && !temporal.monitoringFastWakeEligible) {
      reason = temporal.monitoringFastWakeBlockerReason ===
        MonitoringFastWakeBlockerReason.RUNTIME_FAILED
        ? MonitoringFastWakeBlockerReason.RUNTIME_FAILED
        : 'temporal-fast-wake-unsafe';
    } else if (pipelineSignalSourcePresent && temporal.monitoringFastWakeEligible) {
      if (arm.state === AutomaticMonitoringArmState.ARMED) {
        processingDirective = ProcessingDirective.ALLOW_AUTOMATIC;
        reason = 'automatic-monitoring-armed';
      } else if (arm.state === AutomaticMonitoringArmState.CONSUMED &&
                 currentWorkletState === 'monitoring' && hasFreshWorkletObservation(facts)) {
        targetState = AudioPowerState.MONITORING;
        processingDirective = ProcessingDirective.ALLOW_AUTOMATIC;
        dspProcessingDemand = false;
        reason = 'automatic-monitoring';
      } else if (arm.state === AutomaticMonitoringArmState.DISARMED &&
                 facts.activeFullProcessSettled === true && hasFreshWorkletObservation(facts)) {
        shouldArmAutomaticMonitoring = true;
        armAfterRenderSequence = isNonNegativeSafeInteger(facts.freshActiveRenderSequence)
          ? facts.freshActiveRenderSequence
          : (isNonNegativeSafeInteger(facts.renderSequence) ? facts.renderSequence : null);
        const priorEpoch = isNonNegativeSafeInteger(facts.lastSkipEpoch) ? facts.lastSkipEpoch : 0;
        nextSkipEpoch = isNonNegativeSafeInteger(facts.nextSkipEpoch) &&
          facts.nextSkipEpoch > priorEpoch
          ? facts.nextSkipEpoch
          : priorEpoch + 1;
      }
    }
    audioBranchResolved = true;
  }

  if (!audioBranchResolved && pipelineSignalSourcePresent) {
    maximumRoutedSilence = getMaximumRoutedSilenceStatus(
      facts,
      normalizedSettings,
      now,
      routeIntent,
      temporal
    );
    maximumRoutedInputRelease = getMaximumRoutedInputReleaseStatus(
      facts,
      normalizedSettings,
      now,
      routeIntent,
      inputStatus,
      maximumRoutedSilence
    );
    if (maximumRoutedSilence.reached && canCommitSuspended(facts)) {
      targetState = AudioPowerState.SUSPENDED;
      processingDirective = ProcessingDirective.SUSPENDED;
      dspProcessingDemand = false;
      reason = SuspendCause.MAXIMUM_ROUTED_INPUT_SILENCE;
      audioBranchResolved = true;
    } else if (!resourcesKnown(facts) || !hasFreshWorkletObservation(facts)) {
      targetState = AudioPowerState.ACTIVE;
      processingDirective = ProcessingDirective.FULL_PROCESS;
      dspProcessingDemand = true;
      reason = 'resource-observation-unknown';
      audioBranchResolved = true;
    } else if (normalizedSettings.mode === PowerPolicy.CONTINUOUS) {
      targetState = AudioPowerState.ACTIVE;
      processingDirective = masterBypass && temporal.eligible
        ? ProcessingDirective.BYPASS_TRANSPORT
        : ProcessingDirective.FULL_PROCESS;
      dspProcessingDemand = processingDirective === ProcessingDirective.FULL_PROCESS;
      reason = 'continuous-route';
      audioBranchResolved = true;
    } else if (!temporal.monitoringFastWakeEligible) {
      targetState = AudioPowerState.ACTIVE;
      processingDirective = ProcessingDirective.FULL_PROCESS;
      dspProcessingDemand = true;
      reason = temporal.monitoringFastWakeBlockerReason ===
        MonitoringFastWakeBlockerReason.RUNTIME_FAILED
        ? MonitoringFastWakeBlockerReason.RUNTIME_FAILED
        : 'temporal-fast-wake-unsafe';
      nextDeadlineAt = maximumRoutedSilence?.deadlineAt ?? null;
      audioBranchResolved = true;
    } else if (arm.state === AutomaticMonitoringArmState.CONSUMED &&
               currentWorkletState === 'monitoring' && hasFreshWorkletObservation(facts)) {
      targetState = AudioPowerState.MONITORING;
      processingDirective = ProcessingDirective.ALLOW_AUTOMATIC;
      dspProcessingDemand = false;
      reason = 'automatic-monitoring';
      nextDeadlineAt = maximumRoutedSilence?.deadlineAt ?? null;
      audioBranchResolved = true;
    } else if (arm.state === AutomaticMonitoringArmState.ARMED) {
      targetState = AudioPowerState.ACTIVE;
      processingDirective = ProcessingDirective.ALLOW_AUTOMATIC;
      dspProcessingDemand = true;
      reason = 'automatic-monitoring-armed';
      nextDeadlineAt = maximumRoutedSilence?.deadlineAt ?? null;
      audioBranchResolved = true;
    } else {
      targetState = AudioPowerState.ACTIVE;
      processingDirective = ProcessingDirective.FULL_PROCESS;
      dspProcessingDemand = true;
      reason = 'automatic-monitoring-disarmed';
      if (arm.state === AutomaticMonitoringArmState.DISARMED &&
          facts.activeFullProcessSettled === true && hasFreshWorkletObservation(facts)) {
        shouldArmAutomaticMonitoring = true;
        armAfterRenderSequence = isNonNegativeSafeInteger(facts.freshActiveRenderSequence)
          ? facts.freshActiveRenderSequence
          : (isNonNegativeSafeInteger(facts.renderSequence) ? facts.renderSequence : null);
        const priorEpoch = isNonNegativeSafeInteger(facts.lastSkipEpoch) ? facts.lastSkipEpoch : 0;
        nextSkipEpoch = isNonNegativeSafeInteger(facts.nextSkipEpoch) && facts.nextSkipEpoch > priorEpoch
          ? facts.nextSkipEpoch
          : priorEpoch + 1;
      }
      nextDeadlineAt = maximumRoutedSilence?.deadlineAt ?? null;
      audioBranchResolved = true;
    }
  }

  if (!audioBranchResolved && dspProcessingDemand) {
    targetState = AudioPowerState.ACTIVE;
    processingDirective = ProcessingDirective.FULL_PROCESS;
    reason = 'dsp-processing-demand';
    audioBranchResolved = true;
  }

  if (!audioBranchResolved) {
    if (!temporal.eligible) {
      targetState = AudioPowerState.ACTIVE;
      processingDirective = ProcessingDirective.FULL_PROCESS;
      dspProcessingDemand = true;
      reason = temporal.mustProcess
        ? MonitoringFastWakeBlockerReason.MUST_PROCESS
        : temporal.temporalSkipReason;
    } else {
      const idleStart = isCurrentNoRouteClock(facts) && Number.isFinite(facts.noRouteIdleSinceEpochMs)
        ? facts.noRouteIdleSinceEpochMs
        : (isCurrentNoRouteClock(facts) && Number.isFinite(facts.idleSinceEpochMs)
            ? facts.idleSinceEpochMs
            : now);
      const deadline = deadlineStatus(idleStart, noRouteDelayMs, now);
      const suspended = (deadline.reached && canCommitSuspended(facts)) ||
        facts.effectiveState === AudioPowerState.SUSPENDED;
      if (deadline.reached && !suspended) {
        targetState = AudioPowerState.ACTIVE;
        processingDirective = ProcessingDirective.FULL_PROCESS;
        dspProcessingDemand = true;
        reason = 'resource-observation-unknown';
      } else {
        targetState = suspended ? AudioPowerState.SUSPENDED : AudioPowerState.ACTIVE;
        processingDirective = suspended
          ? ProcessingDirective.SUSPENDED
          : ProcessingDirective.FULL_PROCESS;
        dspProcessingDemand = !suspended;
        reason = SuspendCause.IDLE_NO_ROUTE;
        nextDeadlineAt = suspended ? null : deadline.deadlineAt;
      }
    }
  }

  let inputRetentionTarget = inputRetentionBeforeDecision;
  let shouldReleaseInput = false;
  let inputReleaseRequest = null;
  // The manual-resume latch only guards reacquisition of a configured input;
  // without a configured input there is nothing for the gesture to restore.
  const manualResumeLatchRelevant = inputStatus.configured === true;
  let manualResumeRequired = Boolean(facts.manualResumeRequired) && manualResumeLatchRelevant;
  const playerOnlyRelease = getPlayerOnlyReleaseStatus(
    facts,
    normalizedSettings,
    now,
    routeIntent,
    inputStatus
  );

  if (!holdCurrent && facts.enabled !== false && facts.isElectron !== true) {
    if (reason === SuspendCause.MAXIMUM_ROUTED_INPUT_SILENCE &&
               maximumRoutedInputRelease?.reached) {
      inputRetentionTarget = false;
      shouldReleaseInput = true;
      manualResumeRequired = true;
      inputReleaseRequest = makeMaximumRoutedReleaseRequest(
        facts,
        inputStatus,
        routeIntent,
        maximumRoutedInputRelease.deadlineAt
      );
    } else if (playerOnlyRelease.reached) {
      inputRetentionTarget = false;
      shouldReleaseInput = true;
      manualResumeRequired = true;
      inputReleaseRequest = makePlayerOnlyReleaseRequest(facts, inputStatus);
    }
  }

  if (!shouldReleaseInput && playerOnlyRelease.eligible && !playerOnlyRelease.reached) {
    nextDeadlineAt = earlierDeadline(nextDeadlineAt, playerOnlyRelease.deadlineAt);
  }
  if (!shouldReleaseInput && maximumRoutedInputRelease?.eligible &&
      !maximumRoutedInputRelease.reached) {
    nextDeadlineAt = earlierDeadline(nextDeadlineAt, maximumRoutedInputRelease.deadlineAt);
  }

  const resumeKind = RESUME_KIND_VALUES.has(facts.resumeKind) ? facts.resumeKind : ResumeKind.NONE;
  const requiredResources = getRequiredResourcesForResume(resumeKind, {
    ...facts,
    inputRouteIntent: routeIntent
  });

  const workletControl = {
    automaticMonitoringArm: arm,
    shouldArmAutomaticMonitoring,
    armAfterRenderSequence: shouldArmAutomaticMonitoring
      ? armAfterRenderSequence
      : arm.armAfterRenderSequence,
    nextSkipEpoch: shouldArmAutomaticMonitoring ? nextSkipEpoch : null
  };

  return {
    targetState,
    reason,
    nextDeadlineAt,
    policyGeneration,
    topologyRevision,
    workletGraphGeneration,
    inputGeneration,
    processingDirective,
    temporalSkipEligible: temporal.eligible,
    temporalSkipReason: temporal.temporalSkipReason,
    monitoringFastWakeEligible: temporal.monitoringFastWakeEligible,
    monitoringFastWakeBlockerReason: temporal.monitoringFastWakeBlockerReason,
    workletControl,
    skipEpoch: arm.skipEpoch,
    transportDemand,
    dspProcessingDemand,
    inputSignalForProcessing,
    inputRetentionTarget,
    shouldReleaseInput,
    inputReleaseRequest,
    manualResumeRequired,
    requiredResources
  };
}

export function validatePowerTransition(value) {
  if (!hasExactKeys(value, POWER_TRANSITION_KEYS) ||
      !TRANSITION_STATE_VALUES.has(value.state) ||
      !isNonNegativeSafeInteger(value.generation) ||
      !isNullableIdentity(value.operationId)) return false;
  return value.state === TransitionState.STABLE
    ? value.operationId === null
    : value.operationId !== null;
}

export function createStablePowerTransition(policyGeneration) {
  if (!isNonNegativeSafeInteger(policyGeneration)) {
    throw new TypeError('policyGeneration must be a non-negative safe integer');
  }
  return {
    state: TransitionState.STABLE,
    operationId: null,
    generation: policyGeneration
  };
}

export function validateAutomaticMonitoringArm(value) {
  if (!hasExactKeys(value, AUTOMATIC_MONITORING_ARM_KEYS) || !ARM_STATE_VALUES.has(value.state)) {
    return false;
  }
  if (value.state === AutomaticMonitoringArmState.DISARMED) {
    return value.commandId === null && value.skipEpoch === null &&
      value.armAfterRenderSequence === null;
  }
  return value.commandId !== null && isNullableIdentity(value.commandId) &&
    isNonNegativeSafeInteger(value.skipEpoch) &&
    isNonNegativeSafeInteger(value.armAfterRenderSequence);
}

export function validateInputResourceStatus(value) {
  if (!hasExactKeys(value, INPUT_RESOURCE_STATUS_KEYS) ||
      !INPUT_RESOURCE_STATE_VALUES.has(value.state) ||
      !INPUT_AVAILABILITY_VALUES.has(value.availability) ||
      typeof value.configured !== 'boolean' ||
      !isNonNegativeSafeInteger(value.inputConfigRevision) ||
      !isNonNegativeSafeInteger(value.inputGeneration) ||
      !isNonNegativeSafeInteger(value.inputAvailabilityRevision) ||
      !isNullableIdentity(value.operationId) ||
      !isNullableTimestamp(value.observedAtEpochMs) ||
      !(value.errorCode === null || typeof value.errorCode === 'string')) return false;

  if (value.state === InputResourceState.NOT_CONFIGURED) {
    return value.configured === false && value.availability === InputAvailability.UNKNOWN;
  }
  if (value.state === InputResourceState.LIVE) return value.configured === true;
  return true;
}

export function validateRequiredResources(value) {
  return hasExactKeys(value, REQUIRED_RESOURCES_KEYS) &&
    Array.isArray(value.blocking) && value.blocking.every(item => typeof item === 'string') &&
    new Set(value.blocking).size === value.blocking.length &&
    Array.isArray(value.healthy) && value.healthy.every(item => typeof item === 'string') &&
    new Set(value.healthy).size === value.healthy.length &&
    typeof value.allowActiveWhenHealthyMissing === 'boolean';
}

export function validatePowerDecision(value) {
  return hasExactKeys(value, POWER_DECISION_KEYS) &&
    AUDIO_POWER_STATE_VALUES.has(value.targetState) &&
    (value.reason === null || typeof value.reason === 'string') &&
    isNullableTimestamp(value.nextDeadlineAt) &&
    isNonNegativeSafeInteger(value.policyGeneration) &&
    isNonNegativeSafeInteger(value.topologyRevision) &&
    isNonNegativeSafeInteger(value.workletGraphGeneration) &&
    isNonNegativeSafeInteger(value.inputGeneration) &&
    PROCESSING_DIRECTIVE_VALUES.has(value.processingDirective) &&
    typeof value.temporalSkipEligible === 'boolean' &&
    (value.temporalSkipReason === null || typeof value.temporalSkipReason === 'string') &&
    typeof value.monitoringFastWakeEligible === 'boolean' &&
    (value.monitoringFastWakeEligible
      ? value.monitoringFastWakeBlockerReason === null
      : MONITORING_BLOCKER_VALUES.has(value.monitoringFastWakeBlockerReason)) &&
    hasExactKeys(value.workletControl, WORKLET_CONTROL_KEYS) &&
    validateAutomaticMonitoringArm(value.workletControl.automaticMonitoringArm) &&
    typeof value.workletControl.shouldArmAutomaticMonitoring === 'boolean' &&
    (value.workletControl.armAfterRenderSequence === null ||
      isNonNegativeSafeInteger(value.workletControl.armAfterRenderSequence)) &&
    (value.workletControl.nextSkipEpoch === null ||
      isNonNegativeSafeInteger(value.workletControl.nextSkipEpoch)) &&
    (value.skipEpoch === null || isNonNegativeSafeInteger(value.skipEpoch)) &&
    typeof value.transportDemand === 'boolean' &&
    typeof value.dspProcessingDemand === 'boolean' &&
    INPUT_SIGNAL_VALUES.has(value.inputSignalForProcessing) &&
    typeof value.inputRetentionTarget === 'boolean' &&
    typeof value.shouldReleaseInput === 'boolean' &&
    (value.inputReleaseRequest === null || isObject(value.inputReleaseRequest)) &&
    typeof value.manualResumeRequired === 'boolean' &&
    validateRequiredResources(value.requiredResources);
}

export function assertValidPowerDecision(value) {
  if (!validatePowerDecision(value)) throw new TypeError('Invalid power decision schema');
  return value;
}
