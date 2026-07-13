import {
  AUTOMATIC_MONITORING_ARM_KEYS,
  AudioPowerState,
  AutomaticMonitoringArmState,
  INPUT_RESOURCE_STATUS_KEYS,
  InputAvailability,
  InputResourceState,
  MonitoringFastWakeBlockerReason,
  POWER_TRANSITION_KEYS,
  ProcessingDirective,
  REQUIRED_RESOURCES_KEYS,
  ResourceHealth,
  ResumeKind,
  SuspendCause,
  TransitionState,
  createStablePowerTransition,
  validateAutomaticMonitoringArm,
  validateInputResourceStatus,
  validatePowerTransition,
  validateRequiredResources
} from './power-policy.js';

export {
  AUTOMATIC_MONITORING_ARM_KEYS,
  INPUT_RESOURCE_STATUS_KEYS,
  POWER_TRANSITION_KEYS,
  REQUIRED_RESOURCES_KEYS
};

export const POWER_SNAPSHOT_SCHEMA_VERSION = 1;

export const POWER_SNAPSHOT_KEYS = Object.freeze([
  'schemaVersion',
  'effectiveState',
  'desiredState',
  'topologyRevision',
  'resourceMutationInProgress',
  'processingDirective',
  'transportDemand',
  'dspProcessingDemand',
  'inputSignalForProcessing',
  'inputRetentionTarget',
  'transition',
  'reason',
  'suspendCause',
  'resumeKind',
  'requiredResources',
  'inputMonitoring',
  'manualResumeRequired',
  'resourceStatus',
  'resourceHealth',
  'transitionError'
]);

export const RESOURCE_STATUS_KEYS = Object.freeze([
  'context',
  'input',
  'route',
  'outputBridge',
  'playerSource',
  'worklets',
  'persistence'
]);

export const CONTEXT_STATUS_KEYS = Object.freeze([
  'state',
  'operationId',
  'observedAtEpochMs',
  'errorCode'
]);

// Kept as a module export for source compatibility. The public resource key is
// `context`; `audioContext` is never emitted in a snapshot.
export const AUDIO_CONTEXT_STATUS_KEYS = CONTEXT_STATUS_KEYS;

export const ROUTE_STATUS_KEYS = Object.freeze([
  'state',
  'intent',
  'routeIntentRevision',
  'observedAtEpochMs',
  'errorCode'
]);

export const OUTPUT_BRIDGE_STATUS_KEYS = Object.freeze([
  'state',
  'operationId',
  'observedAtEpochMs',
  'errorCode'
]);

export const PLAYER_SOURCE_STATUS_KEYS = Object.freeze([
  'state',
  'playerIntentGeneration',
  'observedAtEpochMs',
  'errorCode'
]);

export const PLAYER_STATUS_KEYS = PLAYER_SOURCE_STATUS_KEYS;

export const WORKLETS_STATUS_KEYS = Object.freeze([
  'temporalSkip',
  'automaticMonitoringArm',
  'monitoringFastWakeEligible',
  'monitoringFastWakeBlockerReason',
  'nodes'
]);

export const TEMPORAL_SKIP_KEYS = Object.freeze([
  'status',
  'blockerReason',
  'topologyRevision'
]);

export const WORKLET_NODE_KEYS = Object.freeze([
  'role',
  'workletGraphGeneration',
  'topologyRevision',
  'state',
  'processingState',
  'commandAckId',
  'observationRequestId',
  'firstRenderSeen',
  'renderSequence',
  'lastHeartbeatAt',
  'statePreparation',
  'errorCode'
]);

export const STATE_PREPARATION_KEYS = Object.freeze([
  'state',
  'origin',
  'ownerOperationId',
  'workletGraphGeneration',
  'topologyRevision',
  'skipEpoch',
  'enabledPluginCount',
  'coveredPluginCount',
  'appliedPolicyCounts',
  'skippedFrameCount',
  'commandId',
  'ackCommandId',
  'renderSequence',
  'errorCode'
]);

export const APPLIED_POLICY_COUNTS_KEYS = Object.freeze([
  'stateless',
  'resetOnResume',
  'agedBySkippedFrames',
  'mustProcess'
]);

export const PERSISTENCE_STATUS_KEYS = Object.freeze([
  'state',
  'storage',
  'clientId',
  'sessionId',
  'journalPhase',
  'observedAtEpochMs',
  'errorCode'
]);

export const TRANSITION_ERROR_KEYS = Object.freeze([
  'code',
  'phase',
  'operationId',
  'recoverable',
  'messageKey'
]);

export const ContextResourceState = Object.freeze({
  RUNNING: 'running',
  SUSPENDED: 'suspended',
  INTERRUPTED: 'interrupted',
  CLOSED: 'closed',
  UNKNOWN: 'unknown'
});

export const AudioContextResourceState = ContextResourceState;

export const RouteResourceState = Object.freeze({
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  NOT_REQUIRED: 'not-required',
  UNKNOWN: 'unknown'
});

export const OutputBridgeResourceState = Object.freeze({
  PLAYING: 'playing',
  PAUSED: 'paused',
  NOT_REQUIRED: 'not-required',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown'
});

export const PlayerSourceResourceState = Object.freeze({
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  NOT_REQUIRED: 'not-required',
  UNKNOWN: 'unknown'
});

export const PlayerResourceState = PlayerSourceResourceState;

export const PersistenceResourceState = Object.freeze({
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  ERROR: 'error',
  UNKNOWN: 'unknown'
});

export const WorkletNodeState = Object.freeze({
  UNSEEN: 'unseen',
  RENDERING: 'rendering',
  STALLED: 'stalled',
  ERROR: 'error'
});

export const WorkletProcessingState = Object.freeze({
  ACTIVE: 'active',
  MONITORING: 'monitoring',
  UNKNOWN: 'unknown'
});

export const TemporalSkipStatus = Object.freeze({
  ELIGIBLE: 'eligible',
  BLOCKED: 'blocked',
  UNKNOWN: 'unknown'
});

export const StatePreparationState = Object.freeze({
  NOT_REQUIRED: 'not-required',
  PENDING: 'pending',
  ACKNOWLEDGED: 'acknowledged',
  ERROR: 'error',
  UNKNOWN: 'unknown'
});

export const StatePreparationOrigin = Object.freeze({
  DELIBERATE: 'deliberate',
  AUTONOMOUS_FAST_WAKE: 'autonomous-fast-wake'
});

const AUDIO_POWER_STATES = new Set(Object.values(AudioPowerState));
const PROCESSING_DIRECTIVES = new Set(Object.values(ProcessingDirective));
const RESOURCE_HEALTH_STATES = new Set(Object.values(ResourceHealth));
const SUSPEND_CAUSES = new Set(Object.values(SuspendCause));
const RESUME_KINDS = new Set(Object.values(ResumeKind));
const CONTEXT_STATES = new Set(Object.values(ContextResourceState));
const ROUTE_STATES = new Set(Object.values(RouteResourceState));
const ROUTE_INTENTS = new Set(['none', 'external', 'mixed', 'player-only']);
const OUTPUT_BRIDGE_STATES = new Set(Object.values(OutputBridgeResourceState));
const PLAYER_SOURCE_STATES = new Set(Object.values(PlayerSourceResourceState));
const PERSISTENCE_STATES = new Set(Object.values(PersistenceResourceState));
const WORKLET_NODE_STATES = new Set(Object.values(WorkletNodeState));
const WORKLET_PROCESSING_STATES = new Set(Object.values(WorkletProcessingState));
const TEMPORAL_SKIP_STATES = new Set(Object.values(TemporalSkipStatus));
const STATE_PREPARATION_STATES = new Set(Object.values(StatePreparationState));
const STATE_PREPARATION_ORIGINS = new Set(Object.values(StatePreparationOrigin));
const MONITORING_BLOCKERS = new Set(Object.values(MonitoringFastWakeBlockerReason));
const INPUT_SIGNAL_STATES = new Set(['active', 'silent', 'unknown']);

const EMPTY_TRANSITION_ERROR = Object.freeze({
  code: null,
  phase: null,
  operationId: null,
  recoverable: false,
  messageKey: null
});

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
}

function isNonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNullableIdentity(value) {
  return value === null || isNonNegativeSafeInteger(value) ||
    (typeof value === 'string' && value.length > 0);
}

function isNullableString(value) {
  return value === null || typeof value === 'string';
}

function isNullableTimestamp(value) {
  return value === null || (Number.isFinite(value) && value >= 0);
}

function normalizeGeneration(value, fallback = 0) {
  return isNonNegativeSafeInteger(value)
    ? value
    : (isNonNegativeSafeInteger(fallback) ? fallback : 0);
}

function normalizeNullableIdentity(value) {
  return isNullableIdentity(value) ? value : null;
}

function normalizeNullableString(value) {
  return isNullableString(value) ? value : null;
}

function normalizeTimestamp(value) {
  return isNullableTimestamp(value) ? value : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

function createEmptyAppliedPolicyCounts() {
  return {
    stateless: 0,
    resetOnResume: 0,
    agedBySkippedFrames: 0,
    mustProcess: 0
  };
}

export function createUnknownStatePreparation() {
  return {
    state: StatePreparationState.UNKNOWN,
    origin: null,
    ownerOperationId: null,
    workletGraphGeneration: null,
    topologyRevision: null,
    skipEpoch: null,
    enabledPluginCount: 0,
    coveredPluginCount: 0,
    appliedPolicyCounts: createEmptyAppliedPolicyCounts(),
    skippedFrameCount: 0,
    commandId: null,
    ackCommandId: null,
    renderSequence: null,
    errorCode: null
  };
}

export function createEmptyTransitionError() {
  return { ...EMPTY_TRANSITION_ERROR };
}

function createDefaultSnapshot() {
  return {
    schemaVersion: POWER_SNAPSHOT_SCHEMA_VERSION,
    effectiveState: AudioPowerState.ACTIVE,
    desiredState: AudioPowerState.ACTIVE,
    topologyRevision: 0,
    resourceMutationInProgress: false,
    processingDirective: ProcessingDirective.FULL_PROCESS,
    transportDemand: false,
    dspProcessingDemand: false,
    inputSignalForProcessing: 'unknown',
    inputRetentionTarget: false,
    transition: createStablePowerTransition(0),
    reason: 'initializing',
    suspendCause: SuspendCause.UNKNOWN,
    resumeKind: ResumeKind.NONE,
    requiredResources: {
      blocking: [],
      healthy: [],
      allowActiveWhenHealthyMissing: false
    },
    inputMonitoring: false,
    manualResumeRequired: false,
    resourceStatus: {
      context: {
        state: ContextResourceState.UNKNOWN,
        operationId: null,
        observedAtEpochMs: null,
        errorCode: null
      },
      input: {
        state: InputResourceState.NOT_CONFIGURED,
        availability: InputAvailability.UNKNOWN,
        configured: false,
        inputConfigRevision: 0,
        inputGeneration: 0,
        inputAvailabilityRevision: 0,
        operationId: null,
        observedAtEpochMs: null,
        errorCode: null
      },
      route: {
        state: RouteResourceState.NOT_REQUIRED,
        intent: 'none',
        routeIntentRevision: 0,
        observedAtEpochMs: null,
        errorCode: null
      },
      outputBridge: {
        state: OutputBridgeResourceState.NOT_REQUIRED,
        operationId: null,
        observedAtEpochMs: null,
        errorCode: null
      },
      playerSource: {
        state: PlayerSourceResourceState.NOT_REQUIRED,
        playerIntentGeneration: 0,
        observedAtEpochMs: null,
        errorCode: null
      },
      worklets: {
        temporalSkip: {
          status: TemporalSkipStatus.UNKNOWN,
          blockerReason: null,
          topologyRevision: 0
        },
        automaticMonitoringArm: {
          state: AutomaticMonitoringArmState.DISARMED,
          commandId: null,
          skipEpoch: null,
          armAfterRenderSequence: null
        },
        monitoringFastWakeEligible: false,
        monitoringFastWakeBlockerReason:
          MonitoringFastWakeBlockerReason.NOT_WORKLET_LOCAL,
        nodes: []
      },
      persistence: {
        state: PersistenceResourceState.UNKNOWN,
        storage: 'session',
        clientId: null,
        sessionId: null,
        journalPhase: null,
        observedAtEpochMs: null,
        errorCode: null
      }
    },
    resourceHealth: ResourceHealth.UNKNOWN,
    transitionError: createEmptyTransitionError()
  };
}

function normalizeTransition(candidate) {
  const generation = normalizeGeneration(candidate?.generation);
  if (!isObject(candidate)) return createStablePowerTransition(generation);
  const state = Object.values(TransitionState).includes(candidate.state)
    ? candidate.state
    : TransitionState.STABLE;
  const operationId = state === TransitionState.STABLE
    ? null
    : normalizeNullableIdentity(candidate.operationId);
  const normalized = { state, operationId, generation };
  return validatePowerTransition(normalized)
    ? normalized
    : createStablePowerTransition(generation);
}

function normalizeRequiredResources(candidate) {
  if (!validateRequiredResources(candidate)) {
    return { blocking: [], healthy: [], allowActiveWhenHealthyMissing: false };
  }
  return {
    blocking: [...candidate.blocking],
    healthy: [...candidate.healthy],
    allowActiveWhenHealthyMissing: candidate.allowActiveWhenHealthyMissing
  };
}

function normalizeInputStatus(candidate) {
  const source = isObject(candidate) ? candidate : {};
  const state = Object.values(InputResourceState).includes(source.state)
    ? source.state
    : InputResourceState.NOT_CONFIGURED;
  const configured = state === InputResourceState.NOT_CONFIGURED
    ? false
    : (state === InputResourceState.LIVE || source.configured === true);
  const availability = state === InputResourceState.NOT_CONFIGURED
    ? InputAvailability.UNKNOWN
    : (Object.values(InputAvailability).includes(source.availability)
        ? source.availability
        : InputAvailability.UNKNOWN);
  return {
    state,
    availability,
    configured,
    inputConfigRevision: normalizeGeneration(source.inputConfigRevision),
    inputGeneration: normalizeGeneration(source.inputGeneration),
    inputAvailabilityRevision: normalizeGeneration(source.inputAvailabilityRevision),
    operationId: normalizeNullableIdentity(source.operationId),
    observedAtEpochMs: normalizeTimestamp(source.observedAtEpochMs),
    errorCode: normalizeNullableString(source.errorCode)
  };
}

function normalizeStatePreparation(candidate) {
  if (!isObject(candidate)) return createUnknownStatePreparation();
  const state = STATE_PREPARATION_STATES.has(candidate.state)
    ? candidate.state
    : StatePreparationState.UNKNOWN;
  if (state === StatePreparationState.UNKNOWN) return createUnknownStatePreparation();
  const countsSource = isObject(candidate.appliedPolicyCounts)
    ? candidate.appliedPolicyCounts
    : {};
  const normalized = {
    state,
    origin: STATE_PREPARATION_ORIGINS.has(candidate.origin) ? candidate.origin : null,
    ownerOperationId: normalizeNullableIdentity(candidate.ownerOperationId),
    workletGraphGeneration: candidate.workletGraphGeneration === null
      ? null
      : normalizeGeneration(candidate.workletGraphGeneration),
    topologyRevision: candidate.topologyRevision === null
      ? null
      : normalizeGeneration(candidate.topologyRevision),
    skipEpoch: candidate.skipEpoch === null ? null : normalizeGeneration(candidate.skipEpoch),
    enabledPluginCount: normalizeGeneration(candidate.enabledPluginCount),
    coveredPluginCount: normalizeGeneration(candidate.coveredPluginCount),
    appliedPolicyCounts: {
      stateless: normalizeGeneration(countsSource.stateless),
      resetOnResume: normalizeGeneration(countsSource.resetOnResume),
      agedBySkippedFrames: normalizeGeneration(countsSource.agedBySkippedFrames),
      mustProcess: normalizeGeneration(countsSource.mustProcess)
    },
    skippedFrameCount: normalizeGeneration(candidate.skippedFrameCount),
    commandId: normalizeNullableIdentity(candidate.commandId),
    ackCommandId: normalizeNullableIdentity(candidate.ackCommandId),
    renderSequence: candidate.renderSequence === null
      ? null
      : normalizeGeneration(candidate.renderSequence),
    errorCode: normalizeNullableString(candidate.errorCode)
  };
  return validateStatePreparation(normalized)
    ? normalized
    : createUnknownStatePreparation();
}

function normalizeWorkletNode(candidate, topologyRevision) {
  const source = isObject(candidate) ? candidate : {};
  const workletGraphGeneration = normalizeGeneration(source.workletGraphGeneration);
  const normalizedStatePreparation = normalizeStatePreparation(source.statePreparation);
  const statePreparationIsCurrent =
    (normalizedStatePreparation.workletGraphGeneration === null ||
      normalizedStatePreparation.workletGraphGeneration === workletGraphGeneration) &&
    (normalizedStatePreparation.topologyRevision === null ||
      normalizedStatePreparation.topologyRevision === topologyRevision);
  return {
    role: typeof source.role === 'string' && source.role.length > 0 ? source.role : 'primary',
    workletGraphGeneration,
    topologyRevision,
    state: WORKLET_NODE_STATES.has(source.state) ? source.state : WorkletNodeState.UNSEEN,
    processingState: WORKLET_PROCESSING_STATES.has(source.processingState)
      ? source.processingState
      : WorkletProcessingState.UNKNOWN,
    commandAckId: normalizeNullableIdentity(source.commandAckId),
    observationRequestId: source.observationRequestId === null
      ? null
      : normalizeGeneration(source.observationRequestId),
    firstRenderSeen: source.firstRenderSeen === true,
    renderSequence: source.renderSequence === null
      ? null
      : normalizeGeneration(source.renderSequence),
    lastHeartbeatAt: normalizeTimestamp(source.lastHeartbeatAt),
    statePreparation: statePreparationIsCurrent
      ? normalizedStatePreparation
      : createUnknownStatePreparation(),
    errorCode: normalizeNullableString(source.errorCode)
  };
}

function normalizeTemporalSkip(candidate, topologyRevision) {
  const source = isObject(candidate) ? candidate : {};
  const status = TEMPORAL_SKIP_STATES.has(source.status)
    ? source.status
    : TemporalSkipStatus.UNKNOWN;
  return {
    status,
    blockerReason: status === TemporalSkipStatus.BLOCKED
      ? MonitoringFastWakeBlockerReason.MUST_PROCESS
      : null,
    topologyRevision
  };
}

function normalizeAutomaticMonitoringArm(candidate) {
  if (!validateAutomaticMonitoringArm(candidate)) {
    return {
      state: AutomaticMonitoringArmState.DISARMED,
      commandId: null,
      skipEpoch: null,
      armAfterRenderSequence: null
    };
  }
  return { ...candidate };
}

function normalizeTransitionError(candidate) {
  if (!isObject(candidate)) return createEmptyTransitionError();
  const normalized = {
    code: normalizeNullableString(candidate.code),
    phase: normalizeNullableString(candidate.phase),
    operationId: normalizeNullableIdentity(candidate.operationId),
    recoverable: candidate.recoverable === true,
    messageKey: normalizeNullableString(candidate.messageKey)
  };
  return validateTransitionError(normalized) ? normalized : createEmptyTransitionError();
}

export function normalizePowerSnapshot(candidate = {}) {
  const source = isObject(candidate) ? candidate : {};
  const defaults = createDefaultSnapshot();
  const resources = isObject(source.resourceStatus) ? source.resourceStatus : {};
  const contextSource = isObject(resources.context) ? resources.context : {};
  const routeSource = isObject(resources.route) ? resources.route : {};
  const bridgeSource = isObject(resources.outputBridge) ? resources.outputBridge : {};
  const playerSource = isObject(resources.playerSource) ? resources.playerSource : {};
  const workletsSource = isObject(resources.worklets) ? resources.worklets : {};
  const persistenceSource = isObject(resources.persistence) ? resources.persistence : {};
  const topologyRevision = normalizeGeneration(source.topologyRevision);
  const monitoringFastWakeEligible = workletsSource.monitoringFastWakeEligible === true;
  const monitoringFastWakeBlockerReason = monitoringFastWakeEligible
    ? null
    : (MONITORING_BLOCKERS.has(workletsSource.monitoringFastWakeBlockerReason)
        ? workletsSource.monitoringFastWakeBlockerReason
        : MonitoringFastWakeBlockerReason.NOT_WORKLET_LOCAL);
  const nodes = Array.isArray(workletsSource.nodes)
    ? workletsSource.nodes.map(node => normalizeWorkletNode(node, topologyRevision))
    : [];

  const snapshot = {
    schemaVersion: POWER_SNAPSHOT_SCHEMA_VERSION,
    effectiveState: AUDIO_POWER_STATES.has(source.effectiveState)
      ? source.effectiveState
      : defaults.effectiveState,
    desiredState: AUDIO_POWER_STATES.has(source.desiredState)
      ? source.desiredState
      : defaults.desiredState,
    topologyRevision,
    resourceMutationInProgress: source.resourceMutationInProgress === true,
    processingDirective: PROCESSING_DIRECTIVES.has(source.processingDirective)
      ? source.processingDirective
      : defaults.processingDirective,
    transportDemand: source.transportDemand === true,
    dspProcessingDemand: source.dspProcessingDemand === true,
    inputSignalForProcessing: INPUT_SIGNAL_STATES.has(source.inputSignalForProcessing)
      ? source.inputSignalForProcessing
      : defaults.inputSignalForProcessing,
    inputRetentionTarget: source.inputRetentionTarget === true,
    transition: normalizeTransition(source.transition),
    reason: normalizeNullableString(source.reason),
    suspendCause: source.suspendCause === null || SUSPEND_CAUSES.has(source.suspendCause)
      ? source.suspendCause
      : defaults.suspendCause,
    resumeKind: RESUME_KINDS.has(source.resumeKind) ? source.resumeKind : defaults.resumeKind,
    requiredResources: normalizeRequiredResources(source.requiredResources),
    inputMonitoring: source.inputMonitoring === true,
    manualResumeRequired: source.manualResumeRequired === true,
    resourceStatus: {
      context: {
        state: CONTEXT_STATES.has(contextSource.state)
          ? contextSource.state
          : defaults.resourceStatus.context.state,
        operationId: normalizeNullableIdentity(contextSource.operationId),
        observedAtEpochMs: normalizeTimestamp(contextSource.observedAtEpochMs),
        errorCode: normalizeNullableString(contextSource.errorCode)
      },
      input: normalizeInputStatus(resources.input),
      route: {
        state: ROUTE_STATES.has(routeSource.state)
          ? routeSource.state
          : defaults.resourceStatus.route.state,
        intent: ROUTE_INTENTS.has(routeSource.intent)
          ? routeSource.intent
          : defaults.resourceStatus.route.intent,
        routeIntentRevision: normalizeGeneration(routeSource.routeIntentRevision),
        observedAtEpochMs: normalizeTimestamp(routeSource.observedAtEpochMs),
        errorCode: normalizeNullableString(routeSource.errorCode)
      },
      outputBridge: {
        state: OUTPUT_BRIDGE_STATES.has(bridgeSource.state)
          ? bridgeSource.state
          : defaults.resourceStatus.outputBridge.state,
        operationId: normalizeNullableIdentity(bridgeSource.operationId),
        observedAtEpochMs: normalizeTimestamp(bridgeSource.observedAtEpochMs),
        errorCode: normalizeNullableString(bridgeSource.errorCode)
      },
      playerSource: {
        state: PLAYER_SOURCE_STATES.has(playerSource.state)
          ? playerSource.state
          : defaults.resourceStatus.playerSource.state,
        playerIntentGeneration: normalizeGeneration(playerSource.playerIntentGeneration),
        observedAtEpochMs: normalizeTimestamp(playerSource.observedAtEpochMs),
        errorCode: normalizeNullableString(playerSource.errorCode)
      },
      worklets: {
        temporalSkip: normalizeTemporalSkip(workletsSource.temporalSkip, topologyRevision),
        automaticMonitoringArm: normalizeAutomaticMonitoringArm(
          workletsSource.automaticMonitoringArm
        ),
        monitoringFastWakeEligible,
        monitoringFastWakeBlockerReason,
        nodes
      },
      persistence: {
        state: PERSISTENCE_STATES.has(persistenceSource.state)
          ? persistenceSource.state
          : defaults.resourceStatus.persistence.state,
        storage: 'session',
        clientId: normalizeNullableIdentity(persistenceSource.clientId),
        sessionId: normalizeNullableIdentity(persistenceSource.sessionId),
        journalPhase: normalizeNullableString(persistenceSource.journalPhase),
        observedAtEpochMs: normalizeTimestamp(persistenceSource.observedAtEpochMs),
        errorCode: normalizeNullableString(persistenceSource.errorCode)
      }
    },
    resourceHealth: RESOURCE_HEALTH_STATES.has(source.resourceHealth)
      ? source.resourceHealth
      : defaults.resourceHealth,
    transitionError: normalizeTransitionError(source.transitionError)
  };

  if (!validatePowerSnapshot(snapshot)) {
    throw new TypeError('Could not normalize a valid power snapshot');
  }
  return deepFreeze(snapshot);
}

export function buildPowerSnapshot(candidate = {}) {
  return normalizePowerSnapshot(candidate);
}

export function createInitialPowerSnapshot(overrides = {}) {
  return normalizePowerSnapshot(overrides);
}

export function validateStatePreparation(value) {
  if (!hasExactKeys(value, STATE_PREPARATION_KEYS) ||
      !STATE_PREPARATION_STATES.has(value.state) ||
      !(value.origin === null || STATE_PREPARATION_ORIGINS.has(value.origin)) ||
      !isNullableIdentity(value.ownerOperationId) ||
      !(value.workletGraphGeneration === null ||
        isNonNegativeSafeInteger(value.workletGraphGeneration)) ||
      !(value.topologyRevision === null || isNonNegativeSafeInteger(value.topologyRevision)) ||
      !(value.skipEpoch === null || isNonNegativeSafeInteger(value.skipEpoch)) ||
      !isNonNegativeSafeInteger(value.enabledPluginCount) ||
      !isNonNegativeSafeInteger(value.coveredPluginCount) ||
      !hasExactKeys(value.appliedPolicyCounts, APPLIED_POLICY_COUNTS_KEYS) ||
      !APPLIED_POLICY_COUNTS_KEYS.every(key =>
        isNonNegativeSafeInteger(value.appliedPolicyCounts[key])) ||
      !isNonNegativeSafeInteger(value.skippedFrameCount) ||
      !isNullableIdentity(value.commandId) ||
      !isNullableIdentity(value.ackCommandId) ||
      !(value.renderSequence === null || isNonNegativeSafeInteger(value.renderSequence)) ||
      !isNullableString(value.errorCode)) return false;

  if (value.state === StatePreparationState.UNKNOWN) {
    return value.origin === null && value.ownerOperationId === null &&
      value.workletGraphGeneration === null && value.topologyRevision === null &&
      value.skipEpoch === null && value.enabledPluginCount === 0 &&
      value.coveredPluginCount === 0 && value.skippedFrameCount === 0 &&
      value.commandId === null && value.ackCommandId === null &&
      value.renderSequence === null && value.errorCode === null &&
      APPLIED_POLICY_COUNTS_KEYS.every(key => value.appliedPolicyCounts[key] === 0);
  }

  if (value.origin === StatePreparationOrigin.DELIBERATE) {
    if (value.ownerOperationId === null) return false;
  } else if (value.origin === StatePreparationOrigin.AUTONOMOUS_FAST_WAKE) {
    if (value.ownerOperationId !== null) return false;
  } else {
    return false;
  }

  if (value.state === StatePreparationState.ERROR) {
    if (value.errorCode === null) return false;
  } else if (value.errorCode !== null) {
    return false;
  }

  if (value.state === StatePreparationState.ACKNOWLEDGED ||
      value.state === StatePreparationState.NOT_REQUIRED) {
    const total = APPLIED_POLICY_COUNTS_KEYS.reduce(
      (sum, key) => sum + value.appliedPolicyCounts[key],
      0
    );
    if (value.coveredPluginCount !== value.enabledPluginCount ||
        total !== value.enabledPluginCount ||
        value.appliedPolicyCounts.mustProcess !== 0) return false;
  }
  return true;
}

export function validateTransitionError(value) {
  if (!hasExactKeys(value, TRANSITION_ERROR_KEYS) ||
      !isNullableString(value.code) ||
      !isNullableString(value.phase) ||
      !isNullableIdentity(value.operationId) ||
      typeof value.recoverable !== 'boolean' ||
      !isNullableString(value.messageKey)) return false;
  if (value.code === null) {
    return value.phase === null && value.operationId === null &&
      value.recoverable === false && value.messageKey === null;
  }
  return value.code.length > 0 && typeof value.phase === 'string' && value.phase.length > 0;
}

function validateObservedResource(value, keys, states) {
  return hasExactKeys(value, keys) && states.has(value.state) &&
    isNullableIdentity(value.operationId) &&
    isNullableTimestamp(value.observedAtEpochMs) &&
    isNullableString(value.errorCode);
}

function validateRouteStatus(value) {
  return hasExactKeys(value, ROUTE_STATUS_KEYS) &&
    ROUTE_STATES.has(value.state) && ROUTE_INTENTS.has(value.intent) &&
    isNonNegativeSafeInteger(value.routeIntentRevision) &&
    isNullableTimestamp(value.observedAtEpochMs) && isNullableString(value.errorCode);
}

function validatePlayerSourceStatus(value) {
  return hasExactKeys(value, PLAYER_SOURCE_STATUS_KEYS) &&
    PLAYER_SOURCE_STATES.has(value.state) &&
    isNonNegativeSafeInteger(value.playerIntentGeneration) &&
    isNullableTimestamp(value.observedAtEpochMs) && isNullableString(value.errorCode);
}

function validatePersistenceStatus(value) {
  return hasExactKeys(value, PERSISTENCE_STATUS_KEYS) &&
    PERSISTENCE_STATES.has(value.state) && value.storage === 'session' &&
    isNullableIdentity(value.clientId) && isNullableIdentity(value.sessionId) &&
    isNullableString(value.journalPhase) &&
    isNullableTimestamp(value.observedAtEpochMs) && isNullableString(value.errorCode);
}

function validateTemporalSkip(value) {
  if (!hasExactKeys(value, TEMPORAL_SKIP_KEYS) ||
      !TEMPORAL_SKIP_STATES.has(value.status) ||
      !isNonNegativeSafeInteger(value.topologyRevision)) return false;
  if (value.status === TemporalSkipStatus.BLOCKED) {
    return value.blockerReason === MonitoringFastWakeBlockerReason.MUST_PROCESS;
  }
  return value.blockerReason === null;
}

function validateWorkletNode(value, topologyRevision) {
  return hasExactKeys(value, WORKLET_NODE_KEYS) &&
    typeof value.role === 'string' && value.role.length > 0 &&
    isNonNegativeSafeInteger(value.workletGraphGeneration) &&
    value.topologyRevision === topologyRevision &&
    WORKLET_NODE_STATES.has(value.state) &&
    WORKLET_PROCESSING_STATES.has(value.processingState) &&
    isNullableIdentity(value.commandAckId) &&
    (value.observationRequestId === null ||
      isNonNegativeSafeInteger(value.observationRequestId)) &&
    typeof value.firstRenderSeen === 'boolean' &&
    (value.renderSequence === null || isNonNegativeSafeInteger(value.renderSequence)) &&
    isNullableTimestamp(value.lastHeartbeatAt) &&
    validateStatePreparation(value.statePreparation) &&
    (value.statePreparation.workletGraphGeneration === null ||
      value.statePreparation.workletGraphGeneration === value.workletGraphGeneration) &&
    (value.statePreparation.topologyRevision === null ||
      value.statePreparation.topologyRevision === topologyRevision) &&
    isNullableString(value.errorCode);
}

export function validatePowerResourceStatus(value, topologyRevision) {
  if (!hasExactKeys(value, RESOURCE_STATUS_KEYS)) return false;
  if (!validateObservedResource(value.context, CONTEXT_STATUS_KEYS, CONTEXT_STATES) ||
      !validateInputResourceStatus(value.input) ||
      !validateRouteStatus(value.route) ||
      !validateObservedResource(
        value.outputBridge,
        OUTPUT_BRIDGE_STATUS_KEYS,
        OUTPUT_BRIDGE_STATES
      ) ||
      !validatePlayerSourceStatus(value.playerSource) ||
      !validatePersistenceStatus(value.persistence)) return false;

  const worklets = value.worklets;
  return hasExactKeys(worklets, WORKLETS_STATUS_KEYS) &&
    validateTemporalSkip(worklets.temporalSkip) &&
    worklets.temporalSkip.topologyRevision === topologyRevision &&
    validateAutomaticMonitoringArm(worklets.automaticMonitoringArm) &&
    typeof worklets.monitoringFastWakeEligible === 'boolean' &&
    (worklets.monitoringFastWakeEligible
      ? worklets.monitoringFastWakeBlockerReason === null
      : MONITORING_BLOCKERS.has(worklets.monitoringFastWakeBlockerReason)) &&
    Array.isArray(worklets.nodes) &&
    worklets.nodes.every(node => validateWorkletNode(node, topologyRevision));
}

export function validatePowerSnapshot(value) {
  return hasExactKeys(value, POWER_SNAPSHOT_KEYS) &&
    value.schemaVersion === POWER_SNAPSHOT_SCHEMA_VERSION &&
    AUDIO_POWER_STATES.has(value.effectiveState) &&
    AUDIO_POWER_STATES.has(value.desiredState) &&
    isNonNegativeSafeInteger(value.topologyRevision) &&
    typeof value.resourceMutationInProgress === 'boolean' &&
    PROCESSING_DIRECTIVES.has(value.processingDirective) &&
    typeof value.transportDemand === 'boolean' &&
    typeof value.dspProcessingDemand === 'boolean' &&
    INPUT_SIGNAL_STATES.has(value.inputSignalForProcessing) &&
    typeof value.inputRetentionTarget === 'boolean' &&
    validatePowerTransition(value.transition) &&
    isNullableString(value.reason) &&
    (value.suspendCause === null || SUSPEND_CAUSES.has(value.suspendCause)) &&
    RESUME_KINDS.has(value.resumeKind) &&
    validateRequiredResources(value.requiredResources) &&
    typeof value.inputMonitoring === 'boolean' &&
    typeof value.manualResumeRequired === 'boolean' &&
    validatePowerResourceStatus(value.resourceStatus, value.topologyRevision) &&
    RESOURCE_HEALTH_STATES.has(value.resourceHealth) &&
    validateTransitionError(value.transitionError);
}

export function assertValidPowerSnapshot(value) {
  if (!validatePowerSnapshot(value)) throw new TypeError('Invalid public power snapshot');
  return value;
}
