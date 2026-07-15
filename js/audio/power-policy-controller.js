import {
    AudioPowerState,
    AutomaticMonitoringArmState,
    InputRouteIntent,
    InputResourceState,
    ProcessingDirective,
    ResourceHealth,
    ResumeKind,
    SuspendCause,
    createStablePowerTransition,
    decidePowerTarget,
    normalizePowerSettings,
    validateAutomaticMonitoringArm
} from './power-policy.js';
import {
    PowerActivityLeaseRegistry,
    PowerMutationCoordinator,
    createPowerIntentGuards,
    createPowerMutationTokens
} from './power-mutation-coordinator.js';
import {
    analyzeTemporalCapabilities,
    computeLinearPipelineWakeBound,
    createPowerTopologySnapshot,
    getZeroOutputProof,
    isCurrentZeroOutputProof
} from './power-topology.js';
import {
    buildPowerSnapshot,
    createEmptyTransitionError,
    createUnknownStatePreparation,
    validateStatePreparation
} from './power-snapshot.js';
import { PowerSessionJournal } from './power-session-journal.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from './audio-device-constants.js';

const POWER_COMMAND_TIMEOUT_MS = 1500;

function defaultNow() {
    return Date.now();
}

function queryPowerPolicyOverride(windowRef) {
    try {
        const value = new URLSearchParams(windowRef?.location?.search || '').get('powerPolicy');
        if (value === '0' || value === 'off') return false;
        if (value === '1' || value === 'on') return true;
    } catch {
        // Invalid or unavailable URL state does not override persisted settings.
    }
    return null;
}

function readMasterKillSwitch(windowRef) {
    try {
        return windowRef?.localStorage?.getItem('effetune_power_policy_kill_switch') === '1';
    } catch {
        return false;
    }
}

function hasWebPowerProofCapabilities(windowRef) {
    return !!windowRef?.sessionStorage;
}

function normalizePlayerState(snapshot, attached) {
    if (!attached) return 'absent';
    if (snapshot?.isTransitioning) return 'transitioning';
    if (snapshot?.isPlaying) return 'playing';
    if (snapshot?.isPaused) return 'paused';
    return 'stopped';
}

function emptyAutomaticArm() {
    return {
        state: AutomaticMonitoringArmState.DISARMED,
        commandId: null,
        skipEpoch: null,
        armAfterRenderSequence: null
    };
}

function isDspSkippingDirective(directive) {
    return directive === ProcessingDirective.FORCE_MONITORING ||
        directive === ProcessingDirective.BYPASS_TRANSPORT ||
        directive === ProcessingDirective.ZERO_OUTPUT_TRANSPORT ||
        directive === ProcessingDirective.SUSPENDED;
}

function resourceStateFromContext(context) {
    if (!context) return 'unavailable';
    return context.state || 'unknown';
}

export class PowerPolicyController {
    constructor(audioManager, options = {}) {
        if (!audioManager) throw new TypeError('audioManager is required');
        this.audioManager = audioManager;
        this.windowRef = options.windowRef ?? (typeof window !== 'undefined' ? window : null);
        this.documentRef = options.documentRef ?? this.windowRef?.document ??
            (typeof document !== 'undefined' ? document : null);
        this.now = options.now || defaultNow;
        this.setTimeoutFn = options.setTimeoutFn || globalThis.setTimeout?.bind(globalThis);
        this.clearTimeoutFn = options.clearTimeoutFn || globalThis.clearTimeout?.bind(globalThis);
        this.sessionJournal = options.sessionJournal || new PowerSessionJournal({
            storage: this.windowRef?.sessionStorage || null,
            cryptoRef: this.windowRef?.crypto || globalThis.crypto,
            now: this.now
        });
        this.settings = normalizePowerSettings(options.settings ||
            this.windowRef?.appConfig?.powerSaving || {});
        const queryOverride = queryPowerPolicyOverride(this.windowRef);
        const configuredEnabled = options.enabled ?? this.windowRef?.appConfig?.powerPolicyEnabled;
        // The power policy is enabled by default wherever the proof
        // capabilities exist, on the web and in the Electron renderer alike.
        // Precedence: the localStorage kill switch always wins, then an
        // explicit URL override (?powerPolicy=0/1), then an explicit
        // configuration flag (powerPolicyEnabled: false disables). Proof
        // capabilities stay a hard prerequisite so a capability-poor
        // environment keeps the controller fail-safe off even when
        // explicitly requested.
        const requestedEnabled = queryOverride ??
            (typeof configuredEnabled === 'boolean' ? configuredEnabled : true);
        this.enabled = !readMasterKillSwitch(this.windowRef) &&
            requestedEnabled === true &&
            hasWebPowerProofCapabilities(this.windowRef);
        this.started = false;
        this.disposed = false;

        this.mutations = new PowerMutationCoordinator({
            tokens: createPowerMutationTokens(),
            guards: createPowerIntentGuards(),
            resourceSnapshot: null
        });
        this.leases = new PowerActivityLeaseRegistry();
        this.player = null;
        this.playerStateListener = null;
        this.listeners = new Set();
        this.queue = Promise.resolve();
        this.reconcileRequested = false;
        this.reconcilePromise = null;
        this.deadlineTimer = null;
        this.operationSequence = 0;
        this.commandSequence = 0;
        this.observationSequence = 0;
        this.skipEpoch = 0;
        this.effectiveState = AudioPowerState.ACTIVE;
        this.desiredState = AudioPowerState.ACTIVE;
        this.processingDirective = ProcessingDirective.FULL_PROCESS;
        this.reason = 'startup';
        this.suspendCause = null;
        this.transition = createStablePowerTransition(0);
        this.transitionError = null;
        this.resourceHealth = ResourceHealth.UNKNOWN;
        this.manualResumeRequired = false;
        this.resumeKind = ResumeKind.NONE;
        this.nextDeadlineAt = null;
        this.automaticMonitoringArm = emptyAutomaticArm();
        this.statePreparation = createUnknownStatePreparation();
        this.workletObservation = null;
        this.workletAck = null;
        this.workletObservations = new Map();
        this.workletAcks = new Map();
        this.workletArms = new Map();
        this.workletPreparations = new Map();
        this.workletDiagnosticIds = new WeakMap();
        this.workletDiagnosticSequence = 0;
        this.firstRenderWaiters = new Map();
        this.preparationWaiters = new Map();
        this.observationWaiters = new Map();
        this.pendingCommand = null;
        this.lastSkipCommandId = null;
        this.noRouteIdleSinceEpochMs = null;
        this.noRouteIdleEpochTokens = null;
        this.routedSilenceEpochTokens = null;
        this.workletDirectiveResendRequired = false;
        this.gestureResumeInProgress = 0;
        this.gestureResumePromise = null;
        this.gestureResumeKind = ResumeKind.NONE;
        this.gestureResumeOperation = null;
        this.zeroOutputIdleSinceEpochMs = null;
        this.zeroOutputIdlePolicyGeneration = null;
        this.zeroOutputIdleTopologyRevision = null;
        this.zeroOutputIdleWorkletGraphGeneration = null;
        this.currentPowerTopologySnapshot = null;
        this.currentZeroOutputProof = null;
        this.monotonicNow = options.monotonicNow || (() =>
            globalThis.performance?.now?.() ?? this.now());
        this.suspendedTemporalTiming = null;
        this.suspendedTemporalContinuity = true;
        this.inputUnusedSinceEpochMs = null;
        this.inputUnusedInputGeneration = null;
        this.hiddenSinceEpochMs = this.documentRef?.hidden ? this.now() : null;
        this.routedInputSilentSinceEpochMs = null;
        this.routedOutputSilentSinceEpochMs = null;
        this.routedSilenceInputAvailabilityRevision = null;
        this.routedInputReleaseEligibleSinceEpochMs = null;
        this.routedInputReleaseEpochTokens = null;
        this.lastDecision = null;
        this._lastSnapshot = null;
        this.pendingInputChangedEvent = false;
        this.dspUiActivityAllowed = true;
        this.playerUiActivityAllowed = true;
        this.uiPowerGateInitialized = false;
    }

    isControllerEnabled() {
        return this.enabled;
    }

    getEffectiveState() {
        return this.effectiveState;
    }

    getDspUiActivityAllowed() {
        return this.dspUiActivityAllowed;
    }

    getInputConfigRevision() {
        return this._getTokensAndGuards().guards.inputConfigRevision;
    }

    commitInputConfigIntent(inputConfigRevision) {
        const before = this._getTokensAndGuards();
        if (inputConfigRevision === before.guards.inputConfigRevision) return true;
        if (!Number.isSafeInteger(inputConfigRevision) ||
            inputConfigRevision !== before.guards.inputConfigRevision + 1) return false;
        const mutation = this.mutations.commitOwnedMutation({
            ownerOperationId: `input-config-${++this.operationSequence}`,
            mutationKind: 'config-intent-commit',
            beforeTokens: before.tokens,
            beforeGuards: before.guards,
            resourceSnapshot: before.resourceSnapshot,
            topologyChanged: false
        });
        this.audioManager.adoptPowerMutation?.(mutation);
        this._configureWorklets();
        if (this.started) this.requestReconcile('input-config-intent').catch(() => {});
        return true;
    }

    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this.listeners.add(listener);
        listener(this.getSnapshot());
        return () => this.listeners.delete(listener);
    }

    async start() {
        if (this.started || this.disposed) return this.getSnapshot();
        this.started = true;
        if (!this.enabled) return this.getSnapshot();
        this._synchronizeResourceGenerations();
        const restoredRelease = this.sessionJournal.restoreManualResumeRecord?.();
        if (restoredRelease?.manualResumeRequired === true) {
            this.manualResumeRequired = true;
        }
        this.audioManager.contextManager?.setPowerStateDelegate?.(this);
        this._configureWorklets();
        this._requestWorkletObservation();
        await this.requestReconcile('start');
        return this.getSnapshot();
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this._clearDeadlineTimer();
        this.detachPlayer(this.player);
        this.leases.clear();
        for (const waiter of this.firstRenderWaiters.values()) {
            waiter.resolve(false);
            this.clearTimeoutFn?.(waiter.timer);
        }
        this.firstRenderWaiters.clear();
        for (const waiter of this.preparationWaiters.values()) {
            waiter.resolve(false);
            this.clearTimeoutFn?.(waiter.timer);
        }
        this.preparationWaiters.clear();
        for (const waiter of this.observationWaiters.values()) {
            waiter.resolve(null);
            this.clearTimeoutFn?.(waiter.timer);
        }
        this.observationWaiters.clear();
        this.listeners.clear();
        if (this.audioManager.contextManager?.powerStateDelegate === this) {
            this.audioManager.contextManager.setPowerStateDelegate(null);
        }
    }

    updateSettings(settings) {
        this.settings = normalizePowerSettings(settings);
        this._incrementPolicyGeneration();
        this._configureWorklets();
        return this.requestReconcile('settings-updated');
    }

    attachPlayer(player) {
        if (this.player === player) return;
        this.detachPlayer(this.player);
        this.player = player || null;
        if (this.player?.stateManager?.addListener) {
            this.playerStateListener = () => {
                this._incrementPlayerIntentGeneration();
                this.requestReconcile('player-state').catch(() => {});
            };
            this.player.stateManager.addListener('*', this.playerStateListener);
        }
        this._incrementPolicyGeneration();
        this.requestReconcile('player-attached').catch(() => {});
    }

    detachPlayer(player) {
        if (!this.player || (player && player !== this.player)) return;
        if (this.playerStateListener) {
            this.player.stateManager?.removeListener?.('*', this.playerStateListener);
        }
        this.player = null;
        this.playerStateListener = null;
        if (!this.disposed) {
            this._incrementPolicyGeneration();
            this.requestReconcile('player-detached').catch(() => {});
        }
    }

    acquireLease(reason, options = { mode: 'force-active' }) {
        const releaseLease = this.leases.acquireLease(reason, options);
        this.requestReconcile(`lease-acquired:${reason}`).catch(() => {});
        let released = false;
        return () => {
            if (released) return false;
            released = true;
            const result = releaseLease();
            this.requestReconcile(`lease-released:${reason}`).catch(() => {});
            return result;
        };
    }

    requestReconcile(reason = 'unspecified') {
        if (!this.enabled || this.disposed) return Promise.resolve(this.getSnapshot());
        this.reconcileRequested = true;
        this.lastReconcileReason = reason;
        if (this.reconcilePromise) return this.reconcilePromise;
        this.reconcilePromise = this._enqueue(async () => {
            while (this.reconcileRequested && !this.disposed) {
                this.reconcileRequested = false;
                this._maybeClearStaleManualResumeLatch();
                const now = this.now();
                const facts = this._collectFacts(now);
                const decision = decidePowerTarget(facts, this.settings, now);
                this.lastDecision = decision;
                await this._applyDecision(decision);
                this._scheduleDeadline(decision.nextDeadlineAt);
            }
            return this.getSnapshot();
        }).finally(() => {
            this.reconcilePromise = null;
        });
        return this.reconcilePromise;
    }

    _maybeClearStaleManualResumeLatch() {
        if (this.manualResumeRequired !== true || this.disposed) return false;
        // A gesture resume or an in-flight input release owns the latch right now.
        if (this.gestureResumeInProgress > 0) return false;
        if (this.transition.state === 'releasing-input') return false;
        if (this.leases.getSnapshot().resourceMutationInProgress === true) return false;
        if (this.audioManager.contextManager?.audioContext?.state !== 'running') return false;
        const route = this._deriveRouteAndPlayerFacts();
        const input = route.inputSnapshot;
        if (input.state !== InputResourceState.LIVE ||
            input.inputAvailability !== 'available' ||
            input.inputConfigured !== true) {
            return false;
        }
        // The player-only intent deliberately keeps a live input out of the route;
        // every routed intent must show the input actually connected.
        if (route.inputRouteIntent !== InputRouteIntent.PLAYER_ONLY &&
            route.inputRouteConnected !== true) {
            return false;
        }
        // Only a fresh worklet observation under the current identity proves the
        // graph is really rendering with this input.
        const tokens = this._getTokensAndGuards().tokens;
        const observation = this.workletObservation;
        const observationFresh = !!observation &&
            observation.workletGraphGeneration === tokens.workletGraphGeneration &&
            observation.topologyRevision === tokens.topologyRevision;
        if (!observationFresh) return false;
        // The journal must be dropped with the latch; a reload would otherwise
        // restore it. Keep the latch if any record cannot be cleared.
        for (;;) {
            const record = this.sessionJournal.restoreManualResumeRecord?.();
            if (!record) break;
            if (this.sessionJournal.clear?.(record.operationId) !== true) return false;
        }
        this.manualResumeRequired = false;
        return true;
    }

    _enqueue(operation) {
        const next = this.queue.then(operation, operation);
        this.queue = next.catch(() => {});
        return next;
    }

    _getTokensAndGuards() {
        return this.mutations.getSnapshot();
    }

    _synchronizeResourceGenerations() {
        const snapshot = this._getTokensAndGuards();
        const inputGeneration = this.audioManager.ioManager?.inputGeneration ??
            snapshot.tokens.inputGeneration;
        const workletGraphGeneration = this.audioManager.getPowerWorkletGraphGeneration?.() ??
            snapshot.tokens.workletGraphGeneration;
        const topologyRevision = this.audioManager.getPowerTopologyRevision?.() ??
            snapshot.tokens.topologyRevision;
        this.mutations = new PowerMutationCoordinator({
            tokens: {
                ...snapshot.tokens,
                inputGeneration,
                topologyRevision,
                workletGraphGeneration
            },
            guards: snapshot.guards,
            resourceSnapshot: snapshot.resourceSnapshot,
            mutationSequence: snapshot.mutationSequence
        });
    }

    _invalidateTopologyBoundPowerEvidence({ resetWorkletTemporalState = false } = {}) {
        this.workletObservation = null;
        this.workletAck = null;
        this.statePreparation = createUnknownStatePreparation();
        this.workletObservations.clear();
        this.workletAcks.clear();
        this.workletArms.clear();
        this.workletPreparations.clear();
        this.automaticMonitoringArm = emptyAutomaticArm();
        if (resetWorkletTemporalState) {
            this.skipEpoch++;
            this.lastSkipCommandId = null;
            this.suspendedTemporalTiming = null;
            this.suspendedTemporalContinuity = false;
        }
        this.currentPowerTopologySnapshot = null;
        this.currentZeroOutputProof = null;
        this._clearZeroOutputIdleClock();
        this.noRouteIdleSinceEpochMs = null;
        this.noRouteIdleEpochTokens = null;
        this.routedInputSilentSinceEpochMs = null;
        this.routedOutputSilentSinceEpochMs = null;
        this.routedSilenceInputAvailabilityRevision = null;
        this.routedSilenceEpochTokens = null;
        this.routedInputReleaseEligibleSinceEpochMs = null;
        this.routedInputReleaseEpochTokens = null;
        for (const waiter of this.preparationWaiters.values()) {
            waiter.resolve(false);
            this.clearTimeoutFn?.(waiter.timer);
        }
        this.preparationWaiters.clear();
        for (const waiter of this.firstRenderWaiters.values()) {
            this.clearTimeoutFn?.(waiter.timer);
            waiter.resolve('stale-topology');
        }
        this.firstRenderWaiters.clear();
        for (const waiter of this.observationWaiters.values()) {
            this.clearTimeoutFn?.(waiter.timer);
            waiter.resolve(null);
        }
        this.observationWaiters.clear();
    }

    handleWorkletGraphReplacement(resourceSnapshot = null) {
        if (!this.enabled || this.disposed) return null;
        const before = this._getTokensAndGuards();
        const mutation = this.mutations.commitOwnedMutation({
            ownerOperationId: `graph-${++this.operationSequence}`,
            mutationKind: 'graph-replacement',
            beforeTokens: before.tokens,
            beforeGuards: before.guards,
            resourceSnapshot,
            topologyChanged: true
        });
        this._invalidateTopologyBoundPowerEvidence({ resetWorkletTemporalState: true });
        this.audioManager.adoptPowerMutation?.(mutation);
        if (this.started) {
            this._configureWorklets();
            this._requestWorkletObservation();
            this.requestReconcile('worklet-graph-replaced').catch(() => {});
        }
        return mutation;
    }

    notifyTopologyChanged(
        reason = 'topology-changed',
        { resetWorkletTemporalState = false } = {}
    ) {
        if (!this.enabled || this.disposed) return null;
        const before = this._getTokensAndGuards();
        const mutation = this.mutations.commitOwnedMutation({
            ownerOperationId: `topology-${++this.operationSequence}`,
            mutationKind: 'route-topology-commit',
            beforeTokens: before.tokens,
            beforeGuards: before.guards,
            resourceSnapshot: before.resourceSnapshot,
            topologyChanged: true
        });
        this._invalidateTopologyBoundPowerEvidence({ resetWorkletTemporalState });
        this.audioManager.adoptPowerMutation?.(mutation);
        if (this.started) {
            this._configureWorklets();
            this._requestWorkletObservation();
            this.requestReconcile(reason).catch(() => {});
        }
        return mutation;
    }

    _incrementPolicyGeneration() {
        const snapshot = this._getTokensAndGuards();
        const tokens = { ...snapshot.tokens, policyGeneration: snapshot.tokens.policyGeneration + 1 };
        this.mutations = new PowerMutationCoordinator({
            tokens,
            guards: snapshot.guards,
            resourceSnapshot: snapshot.resourceSnapshot,
            mutationSequence: snapshot.mutationSequence
        });
    }

    _incrementPlayerIntentGeneration() {
        const snapshot = this._getTokensAndGuards();
        const guards = {
            ...snapshot.guards,
            playerIntentGeneration: snapshot.guards.playerIntentGeneration + 1
        };
        this.mutations = new PowerMutationCoordinator({
            tokens: { ...snapshot.tokens, policyGeneration: snapshot.tokens.policyGeneration + 1 },
            guards,
            resourceSnapshot: snapshot.resourceSnapshot,
            mutationSequence: snapshot.mutationSequence
        });
    }

    _deriveRouteAndPlayerFacts() {
        const playerSnapshot = this.player?.stateManager?.getStateSnapshot?.() || null;
        const playerState = normalizePlayerState(playerSnapshot, !!this.player);
        const transportDemand = playerState === 'playing' || playerState === 'transitioning';
        const preferences = this.windowRef?.audioPreferences ||
            this.windowRef?.electronIntegration?.audioPreferences || {};
        const inputSnapshot = this.audioManager.ioManager?.getInputSnapshot?.() || {
            state: InputResourceState.UNKNOWN,
            inputAvailability: 'unknown',
            inputAvailabilityRevision: 0,
            inputGeneration: 0,
            inputConfigured: false,
            inputSourcePresent: false,
            trackState: 'absent',
            inputResourceId: null
        };
        let inputRouteIntent = InputRouteIntent.NONE;
        if (this.player) {
            inputRouteIntent = preferences.useInputWithPlayer === true &&
                inputSnapshot.inputConfigured === true
                ? InputRouteIntent.MIXED
                : InputRouteIntent.PLAYER_ONLY;
        } else if (inputSnapshot.inputConfigured) {
            inputRouteIntent = InputRouteIntent.EXTERNAL;
        }
        const inputSource = this.audioManager.ioManager?.inputSourceNode || null;
        const inputRouteConnected = !!inputSource && (
            this.audioManager.isSourceConnectedToPipeline?.(inputSource) === true ||
            inputSnapshot.inputRouteConnected === true
        );
        const pipelineInputSource = this.audioManager.ioManager?.sourceNode || inputSource;
        const pipelineInputConnected = !!pipelineInputSource &&
            this.audioManager.isSourceConnectedToPipeline?.(pipelineInputSource) === true;
        const playerSourceStatus = this.player?.contextManager?.getPowerSourceStatus?.() || {
            state: transportDemand ? 'unknown' : 'not-required',
            sourcePresent: false
        };
        return {
            playerSnapshot,
            playerState,
            transportDemand,
            inputRouteIntent,
            inputSnapshot,
            inputRouteConnected,
            pipelineInputConnected,
            playerSourceStatus,
            useInputWithPlayer: preferences.useInputWithPlayer === true
        };
    }

    _clearZeroOutputIdleClock() {
        this.zeroOutputIdleSinceEpochMs = null;
        this.zeroOutputIdlePolicyGeneration = null;
        this.zeroOutputIdleTopologyRevision = null;
        this.zeroOutputIdleWorkletGraphGeneration = null;
    }

    _deriveCurrentZeroOutputProof(coordinator, pipeline, context, worklets) {
        const channelCount = context?.destination?.channelCount;
        const physicalOutputCount = Number.isSafeInteger(channelCount) && channelCount > 0
            ? channelCount
            : 1;
        const ioManager = this.audioManager.ioManager;
        const outputGainNode = ioManager?.outputGainNode;
        const topologySnapshot = createPowerTopologySnapshot({
            topologyRevision: coordinator.tokens.topologyRevision,
            workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
            plugins: pipeline,
            masterBypass: this.audioManager.masterBypass === true,
            physicalOutputCount,
            // AudioParam.value may still be zero while the startup safety fade
            // is already ramping to one. Only an explicit stable owner flag is
            // eligible to produce a structural final-gain-zero proof.
            finalOutputGain: ioManager?.powerOutputStructurallyZero === true ? 0 : null,
            // AudioIOManager owns every physical sink connection, and no post-gain
            // injection path exists in the application topology.
            finalOutputGainPostDominatesAllOutputs: !!outputGainNode && !!context &&
                worklets.length > 0,
            hasPostGainInjection: false,
            parallelPipelineActive: this.audioManager.isParallelProcessing?.() === true
        });
        const produced = getZeroOutputProof(topologySnapshot);
        const supplied = this.audioManager.getStructuralZeroOutputProof?.() || null;
        const proof = isCurrentZeroOutputProof(supplied, topologySnapshot) ? supplied : produced;
        this.currentPowerTopologySnapshot = topologySnapshot;
        this.currentZeroOutputProof = isCurrentZeroOutputProof(proof, topologySnapshot)
            ? proof
            : produced;
        return this.currentZeroOutputProof;
    }

    _updateDeadlineClocks(
        now,
        routeFacts,
        temporal,
        zeroOutputProof,
        tokens,
        lease,
        inputSignalState,
        outputSignalState
    ) {
        const pipelineSilent = inputSignalState === 'silent' && outputSignalState === 'silent';
        const pipelineSignalRouted = routeFacts.pipelineInputConnected ||
            routeFacts.inputRouteIntent !== InputRouteIntent.NONE;
        if (!pipelineSignalRouted && !routeFacts.transportDemand &&
            temporal.temporalSkipEligible && pipelineSilent) {
            const epochStale = !!this.noRouteIdleEpochTokens &&
                (this.noRouteIdleEpochTokens.policyGeneration !== tokens.policyGeneration ||
                    this.noRouteIdleEpochTokens.topologyRevision !== tokens.topologyRevision);
            if (!Number.isFinite(this.noRouteIdleSinceEpochMs) || epochStale) {
                this.noRouteIdleSinceEpochMs = now;
                this.noRouteIdleEpochTokens = {
                    policyGeneration: tokens.policyGeneration,
                    topologyRevision: tokens.topologyRevision
                };
            }
        } else {
            this.noRouteIdleSinceEpochMs = null;
            this.noRouteIdleEpochTokens = null;
        }

        const zeroOutputCurrent = isCurrentZeroOutputProof(
            zeroOutputProof,
            this.currentPowerTopologySnapshot
        );
        const zeroOutputEligible = zeroOutputCurrent && !routeFacts.transportDemand &&
            temporal.temporalSkipEligible && lease.forceActiveCount === 0 &&
            lease.resourceMutationInProgress !== true;
        const zeroClockIdentityChanged = this.zeroOutputIdlePolicyGeneration !==
                tokens.policyGeneration ||
            this.zeroOutputIdleTopologyRevision !== tokens.topologyRevision ||
            this.zeroOutputIdleWorkletGraphGeneration !== tokens.workletGraphGeneration;
        if (zeroOutputEligible) {
            if (!Number.isFinite(this.zeroOutputIdleSinceEpochMs) || zeroClockIdentityChanged) {
                this.zeroOutputIdleSinceEpochMs = now;
                this.zeroOutputIdlePolicyGeneration = tokens.policyGeneration;
                this.zeroOutputIdleTopologyRevision = tokens.topologyRevision;
                this.zeroOutputIdleWorkletGraphGeneration = tokens.workletGraphGeneration;
            }
        } else {
            this._clearZeroOutputIdleClock();
        }

        const input = routeFacts.inputSnapshot;
        if (routeFacts.inputRouteIntent === InputRouteIntent.PLAYER_ONLY && input.state === InputResourceState.LIVE) {
            if (this.inputUnusedInputGeneration !== input.inputGeneration) {
                this.inputUnusedSinceEpochMs = now;
                this.inputUnusedInputGeneration = input.inputGeneration;
            }
        } else {
            this.inputUnusedSinceEpochMs = null;
            this.inputUnusedInputGeneration = null;
        }
    }

    _bindRoutedSilenceEpoch(tokens, route) {
        if (this.routedSilenceEpochTokens) return;
        this.routedSilenceEpochTokens = {
            policyGeneration: tokens.policyGeneration,
            topologyRevision: tokens.topologyRevision,
            workletGraphGeneration: tokens.workletGraphGeneration,
            routeIntent: route.inputRouteIntent
        };
    }

    _updateRoutedInputReleaseClock(now, tokens, route, inputBackedRoute) {
        const input = route.inputSnapshot;
        const eligible = inputBackedRoute && input.state === InputResourceState.LIVE &&
            input.inputAvailability === 'available';
        const epoch = this.routedInputReleaseEpochTokens;
        const identityChanged = !!epoch &&
            (epoch.policyGeneration !== tokens.policyGeneration ||
                epoch.inputGeneration !== input.inputGeneration ||
                epoch.inputAvailabilityRevision !== input.inputAvailabilityRevision ||
                epoch.topologyRevision !== tokens.topologyRevision ||
                epoch.workletGraphGeneration !== tokens.workletGraphGeneration ||
                epoch.routeIntent !== route.inputRouteIntent);
        if (!eligible) {
            this.routedInputReleaseEligibleSinceEpochMs = null;
            this.routedInputReleaseEpochTokens = null;
            return;
        }
        if (!Number.isFinite(this.routedInputReleaseEligibleSinceEpochMs) || identityChanged) {
            this.routedInputReleaseEligibleSinceEpochMs = now;
            this.routedInputReleaseEpochTokens = {
                policyGeneration: tokens.policyGeneration,
                inputGeneration: input.inputGeneration,
                inputAvailabilityRevision: input.inputAvailabilityRevision,
                topologyRevision: tokens.topologyRevision,
                workletGraphGeneration: tokens.workletGraphGeneration,
                routeIntent: route.inputRouteIntent
            };
        }
    }

    _collectFacts(now) {
        const coordinator = this._getTokensAndGuards();
        const route = this._deriveRouteAndPlayerFacts();
        const temporal = analyzeTemporalCapabilities(this.audioManager.getCurrentPipeline?.() ||
            this.audioManager.pipeline || []);
        const allEnabledPluginsStateless = temporal.capabilities.every(
            item => item.capability === 'stateless'
        );
        const temporalSkipEligible = temporal.temporalSkipEligible;
        const currentPipeline = this.audioManager.getCurrentPipeline?.() ||
            this.audioManager.pipeline || [];
        const gainBound = this.audioManager.getPowerGraphAmplitudeBound?.(currentPipeline) ||
            computeLinearPipelineWakeBound(
                currentPipeline,
                this.audioManager.getPowerChannelFanInBound?.() || 1
            );
        const monitoringFastWakeEligible = temporal.monitoringFastWakeEligible &&
            allEnabledPluginsStateless && gainBound.finite;
        const monitoringBlocker = monitoringFastWakeEligible
            ? null
            : (temporal.blockerReason || (allEnabledPluginsStateless
                ? 'temporal-preparation-unbounded'
                : 'temporal-preparation-not-worklet-local'));
        const safeTemporal = {
            ...temporal,
            temporalSkipEligible,
            monitoringFastWakeEligible,
            blockerReason: temporalSkipEligible ? null : temporal.blockerReason
        };
        const lease = this.leases.getSnapshot();
        const observation = this.workletObservation;
        const workletObservationFresh = !!observation &&
            observation.workletGraphGeneration === coordinator.tokens.workletGraphGeneration &&
            observation.topologyRevision === coordinator.tokens.topologyRevision;
        const inputAvailability = route.inputSnapshot.inputAvailability;
        const inputBackedRoute = route.inputRouteIntent === InputRouteIntent.EXTERNAL ||
            route.inputRouteIntent === InputRouteIntent.MIXED;
        const hasPipelineSignalRoute = route.pipelineInputConnected ||
            route.inputRouteIntent === InputRouteIntent.PLAYER_ONLY || inputBackedRoute;
        this._updateRoutedInputReleaseClock(
            now,
            coordinator.tokens,
            route,
            inputBackedRoute
        );
        if (this.routedSilenceEpochTokens &&
            (this.routedSilenceEpochTokens.policyGeneration !== coordinator.tokens.policyGeneration ||
                this.routedSilenceEpochTokens.topologyRevision !== coordinator.tokens.topologyRevision ||
                this.routedSilenceEpochTokens.workletGraphGeneration !==
                    coordinator.tokens.workletGraphGeneration ||
                this.routedSilenceEpochTokens.routeIntent !== route.inputRouteIntent)) {
            // Silence epochs are only meaningful under the identity they were
            // measured with; remeasure from fresh observations after any change.
            this.routedInputSilentSinceEpochMs = null;
            this.routedOutputSilentSinceEpochMs = null;
            this.routedSilenceEpochTokens = null;
        }
        if (workletObservationFresh && hasPipelineSignalRoute) {
            if (observation.inputActive === false) {
                if (!Number.isFinite(this.routedInputSilentSinceEpochMs)) {
                    this.routedInputSilentSinceEpochMs = now;
                    this._bindRoutedSilenceEpoch(coordinator.tokens, route);
                }
            } else {
                this.routedInputSilentSinceEpochMs = null;
            }
            if (observation.outputActive === false) {
                if (!Number.isFinite(this.routedOutputSilentSinceEpochMs)) {
                    this.routedOutputSilentSinceEpochMs = now;
                    this._bindRoutedSilenceEpoch(coordinator.tokens, route);
                }
            } else {
                this.routedOutputSilentSinceEpochMs = null;
            }
            if (!Number.isFinite(this.routedInputSilentSinceEpochMs) &&
                !Number.isFinite(this.routedOutputSilentSinceEpochMs)) {
                this.routedSilenceEpochTokens = null;
            }
            this.routedSilenceInputAvailabilityRevision = inputBackedRoute &&
                inputAvailability === 'available'
                ? route.inputSnapshot.inputAvailabilityRevision
                : null;
        } else if (!hasPipelineSignalRoute) {
            this.routedInputSilentSinceEpochMs = null;
            this.routedOutputSilentSinceEpochMs = null;
            this.routedSilenceInputAvailabilityRevision = null;
            this.routedSilenceEpochTokens = null;
        }

        const context = this.audioManager.contextManager?.audioContext;
        const worklets = this.audioManager.getActivePowerWorklets?.() || [];
        const hasWorklet = worklets.length > 0 || !!this.audioManager.workletNode;
        const requiredResourcesKnown = !!context && hasWorklet;
        const temporalDegraded = safeTemporal.blockerReason !== null || !gainBound.finite;
        const resourceHealth = requiredResourcesKnown
            ? (temporalDegraded ? ResourceHealth.DEGRADED : ResourceHealth.HEALTHY)
            : ResourceHealth.UNKNOWN;
        this.resourceHealth = resourceHealth;

        const routedSignalState = workletObservationFresh
            ? (observation.inputActive ? 'active' : 'silent')
            : 'unknown';
        const outputSignalState = workletObservationFresh
            ? (observation.outputActive ? 'active' : 'silent')
            : 'unknown';
        const zeroOutputProof = this._deriveCurrentZeroOutputProof(
            coordinator,
            currentPipeline,
            context,
            Array.isArray(worklets) ? worklets : [...worklets]
        );
        const zeroOutputProven = isCurrentZeroOutputProof(
            zeroOutputProof,
            this.currentPowerTopologySnapshot
        );
        this._updateDeadlineClocks(
            now,
            route,
            safeTemporal,
            zeroOutputProof,
            coordinator.tokens,
            lease,
            routedSignalState,
            outputSignalState
        );

        return {
            enabled: this.enabled,
            isElectron: false,
            ...coordinator.tokens,
            ...coordinator.guards,
            inputRouteIntent: route.inputRouteIntent,
            playerPresent: !!this.player,
            playerState: route.playerState,
            transportDemand: route.transportDemand,
            useInputWithPlayer: route.useInputWithPlayer,
            pipelineInputConnected: route.pipelineInputConnected,
            inputConfigured: route.inputSnapshot.inputConfigured,
            inputSourcePresent: route.inputSnapshot.inputSourcePresent === true,
            inputResourceState: route.inputSnapshot.state,
            inputAvailability: route.inputSnapshot.inputAvailability,
            inputAvailabilityRevision: route.inputSnapshot.inputAvailabilityRevision,
            inputResourceStatus: {
                state: route.inputSnapshot.state,
                availability: route.inputSnapshot.inputAvailability,
                inputAvailabilityRevision: route.inputSnapshot.inputAvailabilityRevision,
                inputGeneration: route.inputSnapshot.inputGeneration,
                configured: route.inputSnapshot.inputConfigured
            },
            inputSignalForProcessing: routedSignalState,
            routedInputSignalState: routedSignalState,
            routedOutputSignalState: outputSignalState,
            routedInputObservationFresh: workletObservationFresh,
            routedOutputObservationFresh: workletObservationFresh,
            outputSignalState,
            temporalSkipEligible,
            temporalSkipReason: temporalSkipEligible ? null : safeTemporal.blockerReason,
            temporalMustProcess: temporal.blockerReason === 'temporal-must-process',
            monitoringFastWakeEligible,
            monitoringFastWakeBlockerReason: monitoringBlocker,
            forceActiveLeases: lease.forceActiveCount,
            holdCurrentLeases: lease.holdCurrentCount,
            resourceMutationInProgress: lease.resourceMutationInProgress,
            masterBypass: this.audioManager.masterBypass === true,
            parallelPipelineActive: this.audioManager.isParallelProcessing?.() === true,
            zeroOutputProof,
            zeroOutputProven,
            zeroOutputIdleSinceEpochMs: this.zeroOutputIdleSinceEpochMs,
            zeroOutputIdlePolicyGeneration: this.zeroOutputIdlePolicyGeneration,
            zeroOutputIdleTopologyRevision: this.zeroOutputIdleTopologyRevision,
            zeroOutputIdleWorkletGraphGeneration: this.zeroOutputIdleWorkletGraphGeneration,
            physicalOutputIds: this.currentPowerTopologySnapshot?.physicalOutputIds || [],
            noRouteIdleSinceEpochMs: this.noRouteIdleSinceEpochMs,
            noRouteIdlePolicyGeneration: this.noRouteIdleEpochTokens?.policyGeneration,
            noRouteIdleTopologyRevision: this.noRouteIdleEpochTokens?.topologyRevision,
            inputUnusedSinceEpochMs: this.inputUnusedSinceEpochMs,
            inputUnusedInputGeneration: this.inputUnusedInputGeneration,
            visibility: this.documentRef?.hidden ? 'hidden' : 'visible',
            hiddenSinceEpochMs: this.hiddenSinceEpochMs,
            routedInputSilentSinceEpochMs: this.routedInputSilentSinceEpochMs,
            routedOutputSilentSinceEpochMs: this.routedOutputSilentSinceEpochMs,
            routedSilenceInputAvailabilityRevision: this.routedSilenceInputAvailabilityRevision,
            routedSilencePolicyGeneration: this.routedSilenceEpochTokens?.policyGeneration,
            routedSilenceInputGeneration: this.routedSilenceEpochTokens?.inputGeneration,
            routedSilenceTopologyRevision: this.routedSilenceEpochTokens?.topologyRevision,
            routedSilenceWorkletGraphGeneration: this.routedSilenceEpochTokens?.workletGraphGeneration,
            routedSilenceRouteIntent: this.routedSilenceEpochTokens?.routeIntent,
            routedInputReleaseEligibleSinceEpochMs: this.routedInputReleaseEligibleSinceEpochMs,
            routedInputReleasePolicyGeneration: this.routedInputReleaseEpochTokens?.policyGeneration,
            routedInputReleaseInputGeneration: this.routedInputReleaseEpochTokens?.inputGeneration,
            routedInputReleaseInputAvailabilityRevision:
                this.routedInputReleaseEpochTokens?.inputAvailabilityRevision,
            routedInputReleaseTopologyRevision: this.routedInputReleaseEpochTokens?.topologyRevision,
            routedInputReleaseWorkletGraphGeneration:
                this.routedInputReleaseEpochTokens?.workletGraphGeneration,
            routedInputReleaseRouteIntent: this.routedInputReleaseEpochTokens?.routeIntent,
            observationRequestId: observation?.observationRequestId ?? this.observationSequence,
            observationTopologyRevision: observation?.topologyRevision,
            observationWorkletGraphGeneration: observation?.workletGraphGeneration,
            renderSequence: observation?.renderSequence ?? 0,
            freshActiveRenderSequence: observation?.renderSequence ?? 0,
            workletObservationFresh,
            resourceHealth,
            resourcesKnown: requiredResourcesKnown,
            canSuspend: requiredResourcesKnown,
            effectiveState: this.effectiveState,
            desiredState: this.desiredState,
            processingDirective: this.processingDirective,
            workletObservedState: observation?.state ||
                (this.effectiveState === AudioPowerState.MONITORING ? 'monitoring' : 'active'),
            automaticMonitoringArm: this.automaticMonitoringArm,
            activeFullProcessSettled: this.effectiveState === AudioPowerState.ACTIVE &&
                this.processingDirective === ProcessingDirective.FULL_PROCESS && workletObservationFresh,
            lastSkipEpoch: this.skipEpoch,
            nextSkipEpoch: this.skipEpoch + 1,
            manualResumeRequired: this.manualResumeRequired,
            resumeKind: this.resumeKind
        };
    }

    _configureWorklets() {
        if (!this.enabled) return;
        const coordinator = this._getTokensAndGuards();
        const pipeline = this.audioManager.getCurrentPipeline?.() || this.audioManager.pipeline || [];
        const temporal = analyzeTemporalCapabilities(pipeline);
        const allEnabledPluginsStateless = temporal.capabilities.every(
            item => item.capability === 'stateless'
        );
        const bound = this.audioManager.getPowerGraphAmplitudeBound?.(pipeline) ||
            computeLinearPipelineWakeBound(
                pipeline,
                this.audioManager.getPowerChannelFanInBound?.() || 1
            );
        const monitoringFastWakeEligible = temporal.monitoringFastWakeEligible &&
            allEnabledPluginsStateless && bound.finite;
        const temporalSkipEligible = temporal.temporalSkipEligible;
        this._broadcast({
            type: 'configurePowerPolicy',
            enabled: true,
            workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
            topologyRevision: coordinator.tokens.topologyRevision,
            commandId: ++this.commandSequence,
            silenceThresholdDb: this.settings.silenceThresholdDb,
            silenceDurationSeconds: 60,
            wakeGainMarginDb: bound.finite ? bound.db : 0,
            enabledPluginCount: temporal.capabilities.length,
            monitoringPreparationCapabilities: temporal.capabilities.map((item, index) => ({
                pluginId: item.pluginId ?? `pipeline-${index}`,
                capability: item.capability,
                descriptor: item.descriptor
            })),
            temporalSkipEligible,
            monitoringFastWakeEligible,
            monitoringFastWakeBlockerReason: monitoringFastWakeEligible
                ? null
                : (temporal.blockerReason || 'temporal-preparation-unbounded')
        });
    }

    _broadcast(message) {
        if (typeof this.audioManager.broadcastToActiveWorklets === 'function') {
            this.audioManager.broadcastToActiveWorklets(message);
            return;
        }
        this.audioManager.workletNode?.port?.postMessage?.(message);
    }

    _requestWorkletObservation() {
        const coordinator = this._getTokensAndGuards();
        this._broadcast({
            type: 'requestPowerObservation',
            observationRequestId: ++this.observationSequence,
            commandId: ++this.commandSequence,
            workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
            topologyRevision: coordinator.tokens.topologyRevision
        });
    }

    _requestFreshWorkletObservation() {
        const coordinator = this._getTokensAndGuards();
        const observationRequestId = ++this.observationSequence;
        return new Promise(resolve => {
            const timer = this.setTimeoutFn?.(() => {
                this.observationWaiters.delete(observationRequestId);
                resolve(null);
            }, POWER_COMMAND_TIMEOUT_MS);
            this.observationWaiters.set(observationRequestId, { resolve, timer });
            this._broadcast({
                type: 'requestPowerObservation',
                observationRequestId,
                commandId: ++this.commandSequence,
                workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
                topologyRevision: coordinator.tokens.topologyRevision
            });
        });
    }

    _setTransition(state, operationId = null) {
        const generation = this._getTokensAndGuards().tokens.policyGeneration;
        this.transition = { state, operationId, generation };
        this._emitSnapshot();
    }

    _clearRecoveredTransitionError() {
        if (this.transitionError?.recoverable !== true || this.pendingCommand) return;
        const contextState = this.audioManager.contextManager?.audioContext?.state;
        if (this.effectiveState === AudioPowerState.SUSPENDED) {
            // The policy-desired suspension is in effect; a leftover recoverable
            // error from an earlier failed transition is no longer current.
            if (contextState === 'suspended') this.transitionError = null;
            return;
        }
        const tokens = this._getTokensAndGuards().tokens;
        const observation = this.workletObservation;
        const observationFresh = !!observation &&
            observation.workletGraphGeneration === tokens.workletGraphGeneration &&
            observation.topologyRevision === tokens.topologyRevision;
        if (contextState === 'running' && observationFresh) this.transitionError = null;
    }

    async _applyDecision(decision) {
        const forceDirectiveResend = this.workletDirectiveResendRequired === true;
        const deferInputReleaseUntilSuspend = decision.shouldReleaseInput === true &&
            decision.targetState === AudioPowerState.SUSPENDED;
        const canApplyInputRelease = request => request?.releaseCause ===
            'user-disabled-input' || this.gestureResumeInProgress === 0;
        this.workletDirectiveResendRequired = false;
        this.desiredState = decision.targetState;
        this.reason = decision.reason;
        this.nextDeadlineAt = decision.nextDeadlineAt;
        if (!decision.shouldReleaseInput) {
            this.manualResumeRequired = decision.manualResumeRequired;
        }
        this.suspendCause = Object.values(SuspendCause).includes(decision.reason) ? decision.reason : null;
        if (decision.shouldReleaseInput && !deferInputReleaseUntilSuspend &&
            canApplyInputRelease(decision.inputReleaseRequest)) {
            await this.requestInputRelease(decision.inputReleaseRequest);
        }

        if (decision.workletControl.shouldArmAutomaticMonitoring) {
            await this._armAutomaticMonitoring(decision);
            return;
        }
        if (decision.targetState === AudioPowerState.SUSPENDED) {
            if (this.effectiveState !== AudioPowerState.SUSPENDED) {
                await this._enterSuspended(decision);
            } else if (forceDirectiveResend && this.gestureResumeInProgress > 0) {
                // A user-gesture resume is still in flight; re-suspending here
                // would roll back the context the gesture just resumed (mirror
                // of the _enterSuspended gesture guard). Keep the resend flag
                // armed so the reconcile that follows the gesture settles the
                // directive instead.
                this.workletDirectiveResendRequired = true;
                this._setUiPowerGate(this.effectiveState, this.processingDirective);
                this._emitSnapshot();
            } else if (forceDirectiveResend) {
                // The context left suspension outside policy control while the
                // policy still wants it suspended. Restore the suspended context
                // so the pre-suspend monitoring directive cannot keep copying
                // unprocessed input to the output.
                await this.audioManager.contextManager?.suspendForPowerPolicy?.();
                this._clearRecoveredTransitionError();
                this._setUiPowerGate(this.effectiveState, this.processingDirective);
                this._emitSnapshot();
            } else {
                this._clearRecoveredTransitionError();
                this._setUiPowerGate(this.effectiveState, this.processingDirective);
                this._emitSnapshot();
            }
            if (deferInputReleaseUntilSuspend &&
                this.effectiveState === AudioPowerState.SUSPENDED &&
                canApplyInputRelease(decision.inputReleaseRequest)) {
                const now = this.now();
                const currentDecision = decidePowerTarget(
                    this._collectFacts(now),
                    this.settings,
                    now
                );
                if (currentDecision.targetState === AudioPowerState.SUSPENDED &&
                    currentDecision.shouldReleaseInput === true &&
                    canApplyInputRelease(currentDecision.inputReleaseRequest)) {
                    await this.requestInputRelease(currentDecision.inputReleaseRequest);
                }
            }
            return;
        }
        if (this.effectiveState === AudioPowerState.SUSPENDED && !forceDirectiveResend) {
            // Non-gesture policy reconciliation cannot consume activation. A CTA
            // or transport gesture calls ensureActive explicitly. An unexpected
            // context recovery sets the directive-resend flag instead because the
            // context is already running.
            this._setUiPowerGate(this.effectiveState, this.processingDirective);
            this._emitSnapshot();
            return;
        }
        if (!forceDirectiveResend &&
            decision.targetState === AudioPowerState.MONITORING &&
            this.effectiveState === AudioPowerState.MONITORING &&
            decision.processingDirective === ProcessingDirective.ALLOW_AUTOMATIC) {
            this._clearRecoveredTransitionError();
            this.processingDirective = decision.processingDirective;
            this._setUiPowerGate(this.effectiveState, this.processingDirective);
            this._emitSnapshot();
            return;
        }
        if (!forceDirectiveResend &&
            decision.targetState === this.effectiveState &&
            decision.processingDirective === this.processingDirective) {
            this._clearRecoveredTransitionError();
            this._setUiPowerGate(this.effectiveState, this.processingDirective);
            this._emitSnapshot();
            return;
        }
        await this._applyWorkletState(decision.targetState, decision.processingDirective);
    }

    async _armAutomaticMonitoring(decision) {
        const nextSkipEpoch = decision.workletControl.nextSkipEpoch;
        const commandId = ++this.commandSequence;
        this.workletArms.clear();
        this.automaticMonitoringArm = emptyAutomaticArm();
        const applied = await this._applyWorkletState(
            AudioPowerState.ACTIVE,
            ProcessingDirective.ALLOW_AUTOMATIC,
            {
                commandId,
                skipEpoch: nextSkipEpoch,
                armAfterRenderSequence: decision.workletControl.armAfterRenderSequence
            }
        );
        if (applied) {
            this.skipEpoch = nextSkipEpoch;
            this._updateAggregateAutomaticMonitoringArm();
        } else {
            this.workletArms.clear();
            this.automaticMonitoringArm = emptyAutomaticArm();
        }
        this._emitSnapshot();
    }

    _setPreparationForNodes(preparation) {
        this.statePreparation = preparation;
        for (const node of this._getActiveWorkletNodes()) {
            this.workletPreparations.set(node, preparation);
        }
    }

    _waitForTemporalPreparation(ackCommandId, expectations) {
        return new Promise(resolve => {
            const timer = this.setTimeoutFn?.(() => {
                this.preparationWaiters.delete(ackCommandId);
                resolve(false);
            }, POWER_COMMAND_TIMEOUT_MS);
            const nodes = this._getActiveWorkletNodes();
            this.preparationWaiters.set(ackCommandId, {
                ...expectations,
                resolve,
                timer,
                expectedNodes: new Set(nodes),
                expectedCount: nodes.length || 1,
                seenNodes: new Set(),
                anonymousCount: 0
            });
        });
    }

    _getSuspendedTemporalElapsed(coordinator, skippedFrameCount) {
        const timing = this.suspendedTemporalTiming;
        const sampleRate = this.audioManager.contextManager?.audioContext?.sampleRate;
        if (!timing && Number.isFinite(sampleRate) && sampleRate > 0) {
            return {
                skippedFrameCount,
                suspendedElapsedMs: 0,
                elapsedContinuity: 'verified',
                resumeSampleRate: sampleRate
            };
        }
        const identityCurrent = timing && this.suspendedTemporalContinuity &&
            timing.skipEpoch === this.skipEpoch &&
            timing.topologyRevision === coordinator.tokens.topologyRevision &&
            timing.workletGraphGeneration === coordinator.tokens.workletGraphGeneration &&
            Number.isFinite(sampleRate) && sampleRate > 0 && sampleRate === timing.sampleRate;
        const now = this.monotonicNow();
        const elapsed = identityCurrent && Number.isFinite(now) &&
            Number.isFinite(timing.startedAtMonotonicMs)
            ? now - timing.startedAtMonotonicMs
            : NaN;
        if (!Number.isFinite(elapsed) || elapsed < 0) {
            return {
                skippedFrameCount,
                suspendedElapsedMs: 0,
                elapsedContinuity: 'unknown',
                resumeSampleRate: Number.isFinite(sampleRate) && sampleRate > 0
                    ? sampleRate
                    : null
            };
        }
        return {
            skippedFrameCount,
            suspendedElapsedMs: elapsed,
            elapsedContinuity: 'verified',
            resumeSampleRate: sampleRate
        };
    }

    async _prepareTemporalStateForResume(operationId, coordinator) {
        if (this.lastSkipCommandId === null) return true;
        const temporal = analyzeTemporalCapabilities(
            this.audioManager.getCurrentPipeline?.() || this.audioManager.pipeline || []
        );
        if (!temporal.temporalSkipEligible) return false;
        const enabledPluginCount = temporal.capabilities.length;
        const statelessCount = temporal.capabilities.filter(
            item => item.capability === 'stateless'
        ).length;
        const observedSkippedFrameCount = this.workletObservation?.skippedFrameCount;
        const skippedFrameCount = Number.isSafeInteger(observedSkippedFrameCount) &&
            observedSkippedFrameCount >= 0 ? observedSkippedFrameCount : 0;
        if (statelessCount === enabledPluginCount) {
            const notRequired = {
                state: 'not-required',
                origin: 'deliberate',
                ownerOperationId: operationId,
                workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
                topologyRevision: coordinator.tokens.topologyRevision,
                skipEpoch: this.skipEpoch,
                enabledPluginCount,
                coveredPluginCount: enabledPluginCount,
                appliedPolicyCounts: {
                    stateless: statelessCount,
                    resetOnResume: 0,
                    agedBySkippedFrames: 0,
                    mustProcess: 0
                },
                skippedFrameCount,
                commandId: this.lastSkipCommandId,
                ackCommandId: null,
                renderSequence: this.workletObservation?.renderSequence ?? null,
                errorCode: null
            };
            this._setPreparationForNodes(notRequired);
            return validateStatePreparation(notRequired);
        }

        // The worklet pre-validates the skipped-frame base against its live
        // counter, so a base taken from a stale heartbeat fails whenever frames
        // advanced since. Refresh the observation right before preparing.
        const freshObservation = await this._requestFreshWorkletObservation();
        const freshSkippedFrameCount = freshObservation?.skippedFrameCount;
        const prepareSkippedFrameCount = Number.isSafeInteger(freshSkippedFrameCount) &&
            freshSkippedFrameCount >= 0 ? freshSkippedFrameCount : skippedFrameCount;
        const ackCommandId = ++this.commandSequence;
        const elapsed = this._getSuspendedTemporalElapsed(coordinator, prepareSkippedFrameCount);
        const derivedFrames = elapsed.elapsedContinuity === 'verified'
            ? Math.floor(elapsed.suspendedElapsedMs * elapsed.resumeSampleRate / 1000)
            : 0;
        const expectedSkippedFrameCount = Number.isSafeInteger(derivedFrames) &&
            Number.isSafeInteger(prepareSkippedFrameCount + derivedFrames)
            ? prepareSkippedFrameCount + derivedFrames
            : prepareSkippedFrameCount;
        const pending = {
            state: 'pending',
            origin: 'deliberate',
            ownerOperationId: operationId,
            workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
            topologyRevision: coordinator.tokens.topologyRevision,
            skipEpoch: this.skipEpoch,
            enabledPluginCount,
            coveredPluginCount: 0,
            appliedPolicyCounts: {
                stateless: 0,
                resetOnResume: 0,
                agedBySkippedFrames: 0,
                mustProcess: 0
            },
            skippedFrameCount: prepareSkippedFrameCount,
            commandId: this.lastSkipCommandId,
            ackCommandId,
            renderSequence: null,
            errorCode: null
        };
        this._setPreparationForNodes(pending);
        const prepared = this._waitForTemporalPreparation(ackCommandId, {
            ownerOperationId: operationId,
            commandId: this.lastSkipCommandId,
            skipEpoch: this.skipEpoch,
            enabledPluginCount,
            expectedSkippedFrameCount
        });
        this._broadcast({
            type: 'prepareTemporalState',
            origin: 'deliberate',
            ownerOperationId: operationId,
            commandId: this.lastSkipCommandId,
            ackCommandId,
            skipEpoch: this.skipEpoch,
            ...elapsed,
            workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
            topologyRevision: coordinator.tokens.topologyRevision
        });
        return prepared;
    }

    async _applyWorkletState(targetState, directive, commandOptions = {}) {
        const coordinator = this._getTokensAndGuards();
        const priorWorkletState = commandOptions.restoreOnFailure === true
            ? this._captureWorkletCommandState()
            : null;
        const commandId = commandOptions.commandId ?? ++this.commandSequence;
        const operationId = `power-${++this.operationSequence}`;
        const commandSkipEpoch = isDspSkippingDirective(directive)
            ? (commandOptions.skipEpoch ?? this.skipEpoch + 1)
            : (commandOptions.skipEpoch ?? this.skipEpoch);
        this._setTransition(targetState === AudioPowerState.ACTIVE ? 'resuming' : 'suspending', operationId);
        this.pendingCommand = { commandId, targetState, directive, operationId };
        if (targetState === AudioPowerState.ACTIVE &&
            directive === ProcessingDirective.FULL_PROCESS && this.lastSkipCommandId !== null) {
            const prepared = await this._prepareTemporalStateForResume(operationId, coordinator);
            if (!prepared) {
                this.transitionError = {
                    code: 'temporal-state-preparation-failed',
                    message: 'Temporal plugin state could not be prepared safely.',
                    operationId,
                    recoverable: true
                };
                this.resourceHealth = ResourceHealth.DEGRADED;
                this.pendingCommand = null;
                this._setTransition('stable', null);
                return false;
            }
        }
        const expectedWorkletState = targetState === AudioPowerState.MONITORING
            ? 'monitoring'
            : 'active';
        const firstRenderPromise = this._waitForFirstRender(
            commandId,
            expectedWorkletState,
            directive
        );
        this._broadcast({
            type: 'setUiTelemetryEnabled',
            enabled: targetState === AudioPowerState.ACTIVE &&
                directive !== ProcessingDirective.BYPASS_TRANSPORT &&
                directive !== ProcessingDirective.ZERO_OUTPUT_TRANSPORT,
            commandId,
            workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
            topologyRevision: coordinator.tokens.topologyRevision
        });
        this._broadcast({
            type: 'setPowerProcessingState',
            state: targetState === AudioPowerState.MONITORING ? 'monitoring' : 'active',
            processingDirective: directive,
            commandId,
            skipEpoch: commandSkipEpoch,
            armAfterRenderSequence: commandOptions.armAfterRenderSequence ?? null,
            workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
            topologyRevision: coordinator.tokens.topologyRevision
        });
        const rendered = await firstRenderPromise;
        if (rendered === 'stale-topology') {
            // The topology changed while waiting for the first render; this
            // command identity is stale, so settle without a false timeout and
            // let the fresh facts reconcile.
            this.pendingCommand = null;
            this._setTransition('stable', null);
            this.requestReconcile('stale-topology-transition').catch(() => {});
            return false;
        }
        if (!rendered) {
            let restored = true;
            if (commandOptions.restoreOnFailure === true) {
                restored = await this._restoreWorkletCommandState(priorWorkletState, coordinator);
                if (!restored) {
                    this.workletDirectiveResendRequired = true;
                    this.requestReconcile('failed-worklet-command-rollback').catch(() => {});
                }
            }
            this.transitionError = {
                code: 'worklet-render-timeout',
                message: 'The audio processor did not confirm a fresh render.',
                operationId,
                recoverable: true
            };
            this.resourceHealth = ResourceHealth.DEGRADED;
            this.pendingCommand = null;
            this._setTransition('stable', null);
            return false;
        }
        this.effectiveState = targetState;
        this.processingDirective = directive;
        if (directive === ProcessingDirective.FULL_PROCESS) {
            this.lastSkipCommandId = null;
            this.suspendedTemporalTiming = null;
            this.suspendedTemporalContinuity = true;
        } else if (isDspSkippingDirective(directive)) {
            this.lastSkipCommandId = commandId;
            this.skipEpoch = commandSkipEpoch;
        }
        this.audioManager.powerDiagnostics?.recordEffectiveCommit?.(
            coordinator.tokens.workletGraphGeneration
        );
        this.transitionError = null;
        this.pendingCommand = null;
        this._setTransition('stable', null);
        this._setUiPowerGate(targetState, directive);
        return true;
    }

    _waitForFirstRender(
        commandId,
        expectedState,
        expectedDirective,
        { requireActivityObservation = false } = {}
    ) {
        return new Promise(resolve => {
            const timer = this.setTimeoutFn?.(() => {
                this.firstRenderWaiters.delete(commandId);
                resolve(false);
            }, POWER_COMMAND_TIMEOUT_MS);
            const worklets = this.audioManager.getActivePowerWorklets?.() || [];
            const expectedNodes = new Set(worklets.filter(Boolean));
            if (expectedNodes.size === 0 && this.audioManager.workletNode) {
                expectedNodes.add(this.audioManager.workletNode);
            }
            this.firstRenderWaiters.set(commandId, {
                resolve,
                timer,
                expectedState,
                expectedDirective,
                requireActivityObservation,
                expectedNodes,
                seenNodes: new Set(),
                observations: new Map(),
                anonymousObservations: [],
                anonymousCount: 0,
                expectedCount: expectedNodes.size || 1
            });
        });
    }

    async _enterSuspended(decision) {
        const coordinator = this._getTokensAndGuards();
        const operationId = `power-${++this.operationSequence}`;
        const commandId = ++this.commandSequence;
        const commandSkipEpoch = this.skipEpoch + 1;
        this._setTransition('suspending', operationId);
        const safeDirective = decision.reason === SuspendCause.ZERO_OUTPUT_NO_TRANSPORT
            ? ProcessingDirective.ZERO_OUTPUT_TRANSPORT
            : ProcessingDirective.FORCE_MONITORING;
        const firstRenderPromise = this._waitForFirstRender(
            commandId,
            safeDirective === ProcessingDirective.FORCE_MONITORING ? 'monitoring' : 'active',
            safeDirective,
            { requireActivityObservation: true }
        );
        this._broadcast({
            type: 'setUiTelemetryEnabled',
            enabled: false,
            commandId,
            workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
            topologyRevision: coordinator.tokens.topologyRevision
        });
        this._broadcast({
            type: 'setPowerProcessingState',
            state: safeDirective === ProcessingDirective.FORCE_MONITORING ? 'monitoring' : 'active',
            processingDirective: safeDirective,
            commandId,
            skipEpoch: commandSkipEpoch,
            armAfterRenderSequence: null,
            workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
            topologyRevision: coordinator.tokens.topologyRevision
        });
        const rendered = await firstRenderPromise;
        if (rendered === 'stale-topology') {
            this._setTransition('stable', null);
            this.requestReconcile('stale-topology-transition').catch(() => {});
            return false;
        }
        if (!rendered) {
            this.transitionError = {
                code: 'suspend-observation-timeout',
                message: 'Suspension was cancelled because the processor state was not confirmed.',
                operationId,
                recoverable: true
            };
            this._setTransition('stable', null);
            return false;
        }
        this.skipEpoch = commandSkipEpoch;
        this.lastSkipCommandId = commandId;
        const currentDecision = decidePowerTarget(this._collectFacts(this.now()), this.settings, this.now());
        if (this.gestureResumeInProgress > 0 ||
            currentDecision.targetState !== AudioPowerState.SUSPENDED) {
            this._setTransition('rolling-back', operationId);
            await this._applyWorkletState(AudioPowerState.ACTIVE, ProcessingDirective.FULL_PROCESS);
            return false;
        }
        try {
            const suspended = await this.audioManager.contextManager?.suspendForPowerPolicy?.();
            if (!suspended) throw new Error('AudioContext did not enter suspended state');
            const postSuspendDecision = decidePowerTarget(
                this._collectFacts(this.now()),
                this.settings,
                this.now()
            );
            if (this.gestureResumeInProgress > 0 ||
                postSuspendDecision.targetState !== AudioPowerState.SUSPENDED) {
                this._setTransition('rolling-back', operationId);
                const resumed = await this.audioManager.contextManager?.resumeForPowerPolicy?.(
                    ResumeKind.UNEXPECTED_RECOVERY
                );
                if (resumed === false) {
                    throw new Error('AudioContext did not resume after a stale suspension');
                }
                await this._applyWorkletState(
                    AudioPowerState.ACTIVE,
                    ProcessingDirective.FULL_PROCESS
                );
                return false;
            }
            this.audioManager.ioManager?.pauseOutputBridge?.();
            this.effectiveState = AudioPowerState.SUSPENDED;
            this.processingDirective = ProcessingDirective.SUSPENDED;
            this.suspendedTemporalTiming = {
                startedAtMonotonicMs: this.monotonicNow(),
                sampleRate: this.audioManager.contextManager?.audioContext?.sampleRate ?? null,
                skipEpoch: this.skipEpoch,
                topologyRevision: coordinator.tokens.topologyRevision,
                workletGraphGeneration: coordinator.tokens.workletGraphGeneration
            };
            this.suspendedTemporalContinuity = Number.isFinite(
                this.suspendedTemporalTiming.startedAtMonotonicMs
            ) && Number.isFinite(this.suspendedTemporalTiming.sampleRate);
            this.audioManager.powerDiagnostics?.recordEffectiveCommit?.(
                coordinator.tokens.workletGraphGeneration
            );
            this.transitionError = null;
            this._setTransition('stable', null);
            this._setUiPowerGate(AudioPowerState.SUSPENDED, ProcessingDirective.SUSPENDED);
            return true;
        } catch (error) {
            this.transitionError = {
                code: 'audio-context-suspend-failed',
                message: error?.message || String(error),
                operationId,
                recoverable: true
            };
            this.resourceHealth = ResourceHealth.DEGRADED;
            this._setTransition('rolling-back', operationId);
            await this.audioManager.contextManager?.resumeForPowerPolicy?.('unexpected-recovery');
            await this._applyWorkletState(AudioPowerState.ACTIVE, ProcessingDirective.FULL_PROCESS);
            return false;
        }
    }

    _setUiPowerGate(state, directive) {
        const hidden = this.documentRef?.hidden === true;
        const structuralZero = isCurrentZeroOutputProof(
            this.currentZeroOutputProof,
            this.currentPowerTopologySnapshot
        );
        const physicalOutputSuppressed = this.audioManager.masterBypass === true || structuralZero;
        const dspUiEnabled = state === AudioPowerState.ACTIVE &&
            directive !== ProcessingDirective.BYPASS_TRANSPORT &&
            directive !== ProcessingDirective.ZERO_OUTPUT_TRANSPORT &&
            !physicalOutputSuppressed && !hidden;
        const coordinator = this._getTokensAndGuards();
        const playerUiEnabled = state !== AudioPowerState.SUSPENDED && !hidden;
        const dspGateChanged = !this.uiPowerGateInitialized ||
            this.dspUiActivityAllowed !== dspUiEnabled;
        const playerGateChanged = !this.uiPowerGateInitialized ||
            this.playerUiActivityAllowed !== playerUiEnabled;
        this.dspUiActivityAllowed = dspUiEnabled;
        this.playerUiActivityAllowed = playerUiEnabled;
        this.uiPowerGateInitialized = true;
        if (dspGateChanged) {
            this._broadcast({
                type: 'setUiTelemetryEnabled',
                enabled: dspUiEnabled,
                commandId: ++this.commandSequence,
                workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
                topologyRevision: coordinator.tokens.topologyRevision
            });
            for (const pipeline of [this.audioManager.pipelineA, this.audioManager.pipelineB]) {
                if (!Array.isArray(pipeline)) continue;
                for (const plugin of pipeline) plugin?.setPowerUiEnabled?.(dspUiEnabled);
            }
        }
        if (playerGateChanged) {
            this.audioManager.setPlayerPowerUiEnabled?.(playerUiEnabled);
        }
    }

    _getActiveWorkletNodes() {
        const active = this.audioManager.getActivePowerWorklets?.() || [];
        const candidates = Array.isArray(active)
            ? active
            : (typeof active[Symbol.iterator] === 'function' ? [...active] : []);
        const nodes = [];
        const seen = new Set();
        for (const node of candidates) {
            if (!node || seen.has(node)) continue;
            seen.add(node);
            nodes.push(node);
        }
        if (nodes.length === 0 && this.audioManager.workletNode) {
            nodes.push(this.audioManager.workletNode);
        }
        return nodes;
    }

    _updateAggregateAutomaticMonitoringArm() {
        const nodes = this._getActiveWorkletNodes();
        if (nodes.length === 0) {
            this.automaticMonitoringArm = emptyAutomaticArm();
            return;
        }
        const arms = nodes.map(node => this.workletArms.get(node));
        if (arms.some(arm => !validateAutomaticMonitoringArm(arm))) {
            this.automaticMonitoringArm = emptyAutomaticArm();
            return;
        }
        const first = arms[0];
        const allAgree = arms.every(arm =>
            arm.state === first.state &&
            arm.commandId === first.commandId &&
            arm.skipEpoch === first.skipEpoch &&
            arm.armAfterRenderSequence === first.armAfterRenderSequence
        );
        this.automaticMonitoringArm = allAgree ? { ...first } : emptyAutomaticArm();
    }

    handleWorkletPowerEvent(data, workletNode = null) {
        if (!this.enabled || !data || typeof data !== 'object') return false;
        const tokens = this._getTokensAndGuards().tokens;
        if (data.workletGraphGeneration !== tokens.workletGraphGeneration ||
            data.topologyRevision !== tokens.topologyRevision) return false;
        const nodeKey = workletNode || this.audioManager.workletNode || null;
        if (data.type === 'powerStateAck') {
            this.workletAck = data;
            if (nodeKey) this.workletAcks.set(nodeKey, data);
            if (nodeKey && Object.hasOwn(data, 'automaticMonitoringArm')) {
                if (validateAutomaticMonitoringArm(data.automaticMonitoringArm)) {
                    this.workletArms.set(nodeKey, { ...data.automaticMonitoringArm });
                } else {
                    this.workletArms.delete(nodeKey);
                }
                this._updateAggregateAutomaticMonitoringArm();
            }
            return true;
        }
        if (data.type === 'powerFirstRender') {
            const waiter = this.firstRenderWaiters.get(data.commandId);
            const freshObservation = {
                ...data,
                receivedAtEpochMs: this.now()
            };
            if (waiter) {
                const matches = data.state === waiter.expectedState &&
                    data.processingDirective === waiter.expectedDirective &&
                    (!waiter.requireActivityObservation ||
                        (typeof data.inputActive === 'boolean' &&
                            typeof data.outputActive === 'boolean'));
                if (!matches) {
                    this.firstRenderWaiters.delete(data.commandId);
                    this.clearTimeoutFn?.(waiter.timer);
                    waiter.resolve(false);
                } else {
                    if (nodeKey) {
                        waiter.seenNodes.add(nodeKey);
                        waiter.observations.set(nodeKey, freshObservation);
                    } else {
                        waiter.anonymousCount++;
                        waiter.anonymousObservations.push(freshObservation);
                    }
                    const seenCount = waiter.seenNodes.size + waiter.anonymousCount;
                    if (seenCount >= waiter.expectedCount) {
                        this.firstRenderWaiters.delete(data.commandId);
                        this.clearTimeoutFn?.(waiter.timer);
                        this.workletObservation = aggregateFirstRenderObservations([
                            ...waiter.observations.values(),
                            ...waiter.anonymousObservations
                        ]);
                        waiter.resolve(true);
                    }
                }
            } else {
                this.workletObservation = freshObservation;
            }
            if (nodeKey) {
                this.workletObservations.set(nodeKey, freshObservation);
            }
            return true;
        }
        if (data.type === 'powerObservation' || data.type === 'powerHeartbeat') {
            const observationWaiter = this.observationWaiters.get(data.observationRequestId);
            if (observationWaiter) {
                this.observationWaiters.delete(data.observationRequestId);
                this.clearTimeoutFn?.(observationWaiter.timer);
                observationWaiter.resolve(data);
            }
            this.workletObservation = data;
            if (nodeKey) {
                this.workletObservations.set(nodeKey, {
                    ...data,
                    receivedAtEpochMs: this.now()
                });
            }
            if (data.automaticMonitoringArm) {
                if (nodeKey && validateAutomaticMonitoringArm(data.automaticMonitoringArm)) {
                    this.workletArms.set(nodeKey, { ...data.automaticMonitoringArm });
                } else if (nodeKey) {
                    this.workletArms.delete(nodeKey);
                }
                this._updateAggregateAutomaticMonitoringArm();
            }
            if (data.state === 'monitoring') {
                this.effectiveState = AudioPowerState.MONITORING;
                this.processingDirective = ProcessingDirective.ALLOW_AUTOMATIC;
                this.audioManager.powerDiagnostics?.recordEffectiveCommit?.(
                    tokens.workletGraphGeneration
                );
                this._setUiPowerGate(this.effectiveState, this.processingDirective);
            } else if (data.reason === 'signal-wake') {
                this.effectiveState = AudioPowerState.ACTIVE;
                this.processingDirective = ProcessingDirective.FULL_PROCESS;
                this.workletArms.clear();
                this.automaticMonitoringArm = emptyAutomaticArm();
                this.audioManager.powerDiagnostics?.recordEffectiveCommit?.(
                    tokens.workletGraphGeneration
                );
                this._setUiPowerGate(this.effectiveState, this.processingDirective);
            }
            let sourceId = 'primary';
            if (workletNode && (typeof workletNode === 'object' || typeof workletNode === 'function')) {
                sourceId = this.workletDiagnosticIds.get(workletNode);
                if (!sourceId) {
                    sourceId = `worklet-${++this.workletDiagnosticSequence}`;
                    this.workletDiagnosticIds.set(workletNode, sourceId);
                }
            }
            this.audioManager.powerDiagnostics?.mergeWorkletCounters?.(
                data.counters,
                {
                    runtime: this.audioManager.dspCapabilities ? 'wasm' : 'js',
                    sourceId,
                    workletGraphGeneration: tokens.workletGraphGeneration
                }
            );
            this._emitSnapshot();
            this.requestReconcile('worklet-observation').catch(() => {});
            return true;
        }
        if (data.type === 'temporalStatePrepared') {
            const hasCoverage = Number.isSafeInteger(data.enabledPluginCount) &&
                Number.isSafeInteger(data.coveredPluginCount) &&
                data.appliedPolicyCounts && typeof data.appliedPolicyCounts === 'object';
            const candidate = hasCoverage ? {
                state: data.state,
                origin: data.origin,
                ownerOperationId: data.ownerOperationId ?? null,
                workletGraphGeneration: data.workletGraphGeneration,
                topologyRevision: data.topologyRevision,
                skipEpoch: data.skipEpoch ?? null,
                enabledPluginCount: data.enabledPluginCount,
                coveredPluginCount: data.coveredPluginCount,
                appliedPolicyCounts: {
                    stateless: data.appliedPolicyCounts.stateless ?? 0,
                    resetOnResume: data.appliedPolicyCounts.resetOnResume ?? 0,
                    agedBySkippedFrames: data.appliedPolicyCounts.agedBySkippedFrames ?? 0,
                    mustProcess: data.appliedPolicyCounts.mustProcess ?? 0
                },
                skippedFrameCount: data.skippedFrameCount ?? 0,
                commandId: data.commandId ?? null,
                ackCommandId: data.ackCommandId ?? null,
                renderSequence: data.renderSequence ?? null,
                errorCode: data.errorCode ?? null
            } : createUnknownStatePreparation();
            const candidateValid = validateStatePreparation(candidate);
            this.statePreparation = candidateValid ? candidate : createUnknownStatePreparation();
            if (nodeKey) this.workletPreparations.set(nodeKey, this.statePreparation);
            const waiter = this.preparationWaiters.get(data.ackCommandId);
            if (waiter) {
                const matches = candidateValid && candidate.state === 'acknowledged' &&
                    candidate.ownerOperationId === waiter.ownerOperationId &&
                    candidate.commandId === waiter.commandId &&
                    candidate.skipEpoch === waiter.skipEpoch &&
                    candidate.enabledPluginCount === waiter.enabledPluginCount &&
                    candidate.coveredPluginCount === waiter.enabledPluginCount &&
                    candidate.skippedFrameCount === waiter.expectedSkippedFrameCount &&
                    candidate.appliedPolicyCounts.mustProcess === 0;
                if (!matches) {
                    this.preparationWaiters.delete(data.ackCommandId);
                    this.clearTimeoutFn?.(waiter.timer);
                    waiter.resolve(false);
                } else {
                    if (nodeKey) waiter.seenNodes.add(nodeKey);
                    else waiter.anonymousCount++;
                    if (waiter.seenNodes.size + waiter.anonymousCount >= waiter.expectedCount) {
                        this.preparationWaiters.delete(data.ackCommandId);
                        this.clearTimeoutFn?.(waiter.timer);
                        waiter.resolve(true);
                    }
                }
            }
            this._emitSnapshot();
            return true;
        }
        return false;
    }

    handleContextStateChange({ state, intentional = false } = {}) {
        if (!this.enabled || this.disposed) return;
        if ((state === 'suspended' || state === 'interrupted') && !intentional &&
            this.effectiveState !== AudioPowerState.SUSPENDED) {
            this.resourceHealth = ResourceHealth.DEGRADED;
            this.reason = 'browser';
            this._emitSnapshot();
        } else if (state === 'running' && this.effectiveState === AudioPowerState.SUSPENDED) {
            // Do not adopt ACTIVE without a confirmed worklet render: mark the
            // directive dirty so reconcile bypasses its equality short-circuits
            // and re-sends the desired directive to the worklet.
            this.workletDirectiveResendRequired = true;
            this.requestReconcile('unexpected-context-recovery').catch(() => {});
        }
    }

    handleInputResourceEvent() {
        this.pendingInputChangedEvent = true;
        this.requestReconcile('input-resource').catch(() => {});
    }

    handlePageLifecycleEvent(type, detail = {}) {
        if (!this.enabled || this.disposed) return;
        const now = this.now();
        if (type === 'visibilitychange' || type === 'startup' || type === 'pageshow' || type === 'resume') {
            const hidden = detail.hidden ?? this.documentRef?.hidden;
            if (hidden) {
                if (!Number.isFinite(this.hiddenSinceEpochMs)) this.hiddenSinceEpochMs = now;
                this._setUiPowerGate(this.effectiveState, this.processingDirective);
            } else {
                this.hiddenSinceEpochMs = null;
                this._setUiPowerGate(this.effectiveState, this.processingDirective);
            }
        } else if (type === 'freeze' || type === 'pagehide') {
            if (!Number.isFinite(this.hiddenSinceEpochMs)) this.hiddenSinceEpochMs = now;
            this.suspendedTemporalContinuity = false;
            this._setUiPowerGate(this.effectiveState, this.processingDirective);
        }
        this._requestWorkletObservation();
        this.requestReconcile(`lifecycle:${type}`).catch(() => {});
    }

    _handoffPipelineToSilentSource({ canonicalRequired = true } = {}) {
        const ioManager = this.audioManager.ioManager;
        const inputSource = ioManager?.inputSourceNode || null;
        const silentSource = ioManager?.ensureSilentSourceFallback?.() || null;
        if (!silentSource) return { success: false, topologyChanged: false };

        const silentSourceWasConnected =
            this.audioManager.isSourceConnectedToPipeline?.(silentSource) === true;
        const inputSourceWasConnected = !!inputSource &&
            this.audioManager.isSourceConnectedToPipeline?.(inputSource) === true;
        const silentSourceConnected = silentSourceWasConnected ||
            this.audioManager.ensureSourceConnectedToPipeline?.(silentSource) === true;
        if (!silentSourceConnected ||
            this.audioManager.isSourceConnectedToPipeline?.(silentSource) !== true) {
            return { success: false, topologyChanged: false };
        }

        const canonicalSourceReplaced = this.player?.contextManager
            ?.replaceCanonicalInputSource?.(silentSource);
        if (canonicalSourceReplaced === false && canonicalRequired) {
            if (!silentSourceWasConnected) {
                this.audioManager.disconnectSourceFromPipeline?.(silentSource);
            }
            return { success: false, topologyChanged: false };
        }
        if (ioManager && (!ioManager.sourceNode || ioManager.sourceNode === inputSource)) {
            ioManager.sourceNode = silentSource;
        }
        if (!this.audioManager.sourceNode || this.audioManager.sourceNode === inputSource) {
            this.audioManager.sourceNode = silentSource;
        }
        if (inputSource && inputSource !== silentSource) {
            this.audioManager.disconnectSourceFromPipeline?.(inputSource);
        }
        return {
            success: true,
            topologyChanged: !silentSourceWasConnected || inputSourceWasConnected
        };
    }

    _extendGestureResumeOperation(operation, resumeKind) {
        if (!operation || operation.phase !== 'collecting') return;
        operation.requestedKinds.add(resumeKind);
        if (resumeKind === ResumeKind.DEDICATED_INPUT) {
            operation.resumeKind = resumeKind;
            operation.requiresInputSuccess = true;
        } else if (resumeKind === ResumeKind.MIXED_PLAY &&
            operation.resumeKind !== ResumeKind.DEDICATED_INPUT) {
            operation.resumeKind = resumeKind;
        }

        const ioManager = this.audioManager.ioManager;
        const input = ioManager?.getInputSnapshot?.();
        const preferences = this.windowRef?.audioPreferences ||
            this.windowRef?.electronIntegration?.audioPreferences || {};
        const selectedInputDeviceId = preferences.inputDeviceId;
        const inputResumable = input?.state !== InputResourceState.NOT_CONFIGURED ||
            (typeof selectedInputDeviceId === 'string' &&
                selectedInputDeviceId.length > 0 &&
                selectedInputDeviceId !== NO_AUDIO_INPUT_DEVICE_ID);
        const kindNeedsInput = resumeKind === ResumeKind.DEDICATED_INPUT ||
            resumeKind === ResumeKind.MIXED_PLAY;
        if (!kindNeedsInput || !inputResumable) return;
        operation.needsInput = true;
        if (input?.state === InputResourceState.LIVE || operation.inputPromise) return;

        operation.inputMutationBefore = this._getTokensAndGuards();
        try {
            operation.inputPromise = Promise.resolve(
                ioManager.beginReacquireAudioInput({ requireVisible: true })
            );
        } catch (error) {
            operation.inputPromise = Promise.reject(error);
        }
        operation.resourceVersion++;
    }

    _gestureOperationSatisfiesResumeKind(operation, resumeKind) {
        if (!operation) return false;
        if (resumeKind === ResumeKind.DEDICATED_INPUT) {
            return operation.requiresInputSuccess === true;
        }
        if (resumeKind === ResumeKind.MIXED_PLAY) {
            return operation.requestedKinds.has(ResumeKind.MIXED_PLAY) ||
                operation.requiresInputSuccess === true;
        }
        return true;
    }

    _gestureOperationHasCommittedPredecessor(operation) {
        let predecessor = operation?.predecessorOperation || null;
        while (predecessor) {
            if (predecessor.commitSucceeded === true) return true;
            predecessor = predecessor.predecessorOperation || null;
        }
        return false;
    }

    _captureWorkletCommandState() {
        const nodes = this._getActiveWorkletNodes();
        if (nodes.length === 0) return null;
        const statuses = nodes.map(node =>
            this.workletObservations.get(node) || this.workletAcks.get(node) || null
        );
        if (statuses.some(status => !status)) return null;
        const first = statuses[0];
        if ((first.state !== 'active' && first.state !== 'monitoring') ||
            typeof first.processingDirective !== 'string') {
            return null;
        }
        const allAgree = statuses.every(status =>
            status.state === first.state &&
            status.processingDirective === first.processingDirective
        );
        if (!allAgree) return null;
        return {
            state: first.state,
            processingDirective: first.processingDirective,
            skipEpoch: Number.isSafeInteger(first.skipEpoch) ? first.skipEpoch : this.skipEpoch,
            uiTelemetryEnabled: this.dspUiActivityAllowed === true
        };
    }

    async _restoreWorkletCommandState(priorState, coordinator) {
        if (!priorState) return false;
        const current = this._getTokensAndGuards().tokens;
        if (current.workletGraphGeneration !== coordinator.tokens.workletGraphGeneration ||
            current.topologyRevision !== coordinator.tokens.topologyRevision) {
            return false;
        }
        const commandId = ++this.commandSequence;
        const rendered = this._waitForFirstRender(
            commandId,
            priorState.state,
            priorState.processingDirective
        );
        this._broadcast({
            type: 'setUiTelemetryEnabled',
            enabled: priorState.uiTelemetryEnabled,
            commandId,
            workletGraphGeneration: current.workletGraphGeneration,
            topologyRevision: current.topologyRevision
        });
        this._broadcast({
            type: 'setPowerProcessingState',
            state: priorState.state,
            processingDirective: priorState.processingDirective,
            commandId,
            skipEpoch: priorState.skipEpoch,
            armAfterRenderSequence: null,
            workletGraphGeneration: current.workletGraphGeneration,
            topologyRevision: current.topologyRevision
        });
        return await rendered === true;
    }

    beginUserGestureResume(resumeKind = ResumeKind.UNEXPECTED_RECOVERY, inheritedRollback = null) {
        if (!this.enabled) return this.audioManager.contextManager?.resumeAudioContext?.();
        if (resumeKind === ResumeKind.UNEXPECTED_RECOVERY &&
            this.effectiveState !== AudioPowerState.SUSPENDED &&
            this.manualResumeRequired !== true &&
            this.audioManager.contextManager?.audioContext?.state === 'running') {
            if (this.transitionError?.recoverable === true) {
                this.transitionError = null;
                this._emitSnapshot();
            }
            return Promise.resolve(true);
        }
        if (this.gestureResumePromise) {
            const currentOperation = this.gestureResumeOperation;
            if (currentOperation?.phase === 'collecting') {
                this._extendGestureResumeOperation(currentOperation, resumeKind);
                return this.gestureResumePromise;
            }
            if (this._gestureOperationSatisfiesResumeKind(currentOperation, resumeKind)) {
                return this.gestureResumePromise;
            }
            // The current transaction has already frozen its resource set. Start
            // the stronger request now so input acquisition still begins inside
            // this user-activation stack, then serialize its commit behind the
            // transaction already in progress.
            currentOperation.rollbackOwnershipTransferred = true;
            inheritedRollback = {
                contextWasRunning: currentOperation.contextWasRunning,
                bridgeWasPaused: currentOperation.bridgeWasPaused,
                inputResource: currentOperation.acquiredInputResource,
                operation: currentOperation
            };
            this.gestureResumePromise = null;
            this.gestureResumeKind = ResumeKind.NONE;
            this.gestureResumeOperation = null;
            return this.beginUserGestureResume(resumeKind, inheritedRollback);
        }
        this.gestureResumeInProgress += 1;
        const audioElement = this.audioManager.ioManager?.audioElement || null;
        const gestureOperation = {
            phase: 'collecting',
            requestedKinds: new Set(),
            resumeKind,
            requiresInputSuccess: false,
            needsInput: false,
            inputMutationBefore: null,
            inputPromise: null,
            acquiredInputResource: null,
            resourceVersion: 0,
            contextWasRunning: inheritedRollback?.contextWasRunning ??
                this.audioManager.contextManager?.audioContext?.state === 'running',
            bridgeWasPaused: inheritedRollback?.bridgeWasPaused ??
                (!!audioElement && audioElement.paused === true),
            inheritedInputResource: inheritedRollback?.inputResource || null,
            predecessorOperation: inheritedRollback?.operation || null,
            rollbackOwnershipTransferred: false,
            commitSucceeded: false,
            contextPromise: null,
            bridgePromise: null
        };
        try {
            gestureOperation.contextPromise = Promise.resolve(
                this.audioManager.contextManager?.resumeForPowerPolicy?.(resumeKind) ?? true
            );
        } catch (error) {
            gestureOperation.contextPromise = Promise.reject(error);
        }
        try {
            gestureOperation.bridgePromise = Promise.resolve(
                this.audioManager.ioManager?.playOutputBridgeForGesture?.() ?? true
            );
        } catch (error) {
            gestureOperation.bridgePromise = Promise.reject(error);
        }
        this._extendGestureResumeOperation(gestureOperation, resumeKind);
        this.gestureResumeOperation = gestureOperation;

        const settleResources = async () => {
            let resourceVersion;
            let results;
            do {
                resourceVersion = gestureOperation.resourceVersion;
                results = await Promise.allSettled([
                    gestureOperation.contextPromise,
                    gestureOperation.bridgePromise,
                    gestureOperation.inputPromise || Promise.resolve(null)
                ]);
            } while (resourceVersion !== gestureOperation.resourceVersion);
            return results;
        };
        const operation = this._enqueue(async () => {
            const results = await settleResources();
            if (gestureOperation.inputPromise &&
                results[2].status === 'fulfilled' && results[2].value) {
                gestureOperation.acquiredInputResource = {
                    ...(this.audioManager.ioManager?.getInputSnapshot?.() || results[2].value)
                };
            }
            gestureOperation.phase = 'committing';
            try {
                    const finalResumeKind = gestureOperation.resumeKind;
                    const needsInput = gestureOperation.needsInput;
                    let inputMutationBefore = gestureOperation.inputMutationBefore;
                    const contextReady = results[0].status === 'fulfilled' &&
                        results[0].value !== false &&
                        this.audioManager.contextManager?.audioContext?.state === 'running';
                    const bridgeReady = results[1].status === 'fulfilled' &&
                        results[1].value !== false;
                    let inputReady = !needsInput || results[2].status === 'fulfilled';
                    const mixedCanContinue = !gestureOperation.requiresInputSuccess &&
                        gestureOperation.requestedKinds.has(ResumeKind.MIXED_PLAY) &&
                        contextReady && bridgeReady;
                    const newlyAcquiredInput = inputMutationBefore &&
                        results[2].status === 'fulfilled' && !!results[2].value;
                    const rollbackInputResource = newlyAcquiredInput
                        ? gestureOperation.acquiredInputResource
                        : gestureOperation.inheritedInputResource;
                    const ownsCurrentInputResource = () => {
                        if (!rollbackInputResource) return false;
                        const current = this.audioManager.ioManager?.getInputSnapshot?.() || null;
                        if (current?.state !== InputResourceState.LIVE &&
                            current?.state !== InputResourceState.ACQUIRING) {
                            return false;
                        }
                        if (current.inputGeneration !== rollbackInputResource.inputGeneration) {
                            return false;
                        }
                        return !rollbackInputResource.inputResourceId ||
                            !current.inputResourceId ||
                            current.inputResourceId === rollbackInputResource.inputResourceId;
                    };
                    const rollbackNewInput = async () => {
                        if (!newlyAcquiredInput && !gestureOperation.inheritedInputResource) {
                            return true;
                        }
                        if (!newlyAcquiredInput &&
                            gestureOperation.predecessorOperation?.commitSucceeded === true) {
                            return true;
                        }
                        if (!ownsCurrentInputResource()) return true;
                        if (inputMutationBefore) {
                            try {
                                const mutation = this.mutations.commitOwnedMutation({
                                    ownerOperationId: `input-install-${++this.operationSequence}`,
                                    mutationKind: 'input-install',
                                    beforeTokens: inputMutationBefore.tokens,
                                    beforeGuards: inputMutationBefore.guards,
                                    resourceSnapshot: this.audioManager.ioManager?.getInputSnapshot?.() || null,
                                    topologyChanged: false
                                });
                                this.audioManager.adoptPowerMutation?.(mutation);
                                inputMutationBefore = null;
                            } catch {
                                this._resynchronizeInputGeneration({ synchronizeResourceSnapshot: true });
                            }
                        }
                        if (gestureOperation.rollbackOwnershipTransferred) {
                            return true;
                        }
                        const rolledBack = await this.requestAudioReconfigurationInputRelease({
                            handoffToSilent: true,
                            disconnectInput: true
                        });
                        if (!rolledBack) this._resynchronizeInputGeneration();
                        inputReady = false;
                        return rolledBack;
                    };
                    const rejectResume = async () => {
                        this.resourceHealth = inputReady
                            ? ResourceHealth.BLOCKED
                            : ResourceHealth.DEGRADED;
                        this.transitionError = {
                            code: 'resume-resource-failed',
                            message: 'One or more audio resources could not be resumed.',
                            operationId: null,
                            recoverable: true
                        };
                        const predecessorCommitted =
                            this._gestureOperationHasCommittedPredecessor(gestureOperation);
                        if (!gestureOperation.rollbackOwnershipTransferred &&
                            !predecessorCommitted &&
                            gestureOperation.bridgeWasPaused) {
                            this.audioManager.ioManager?.pauseOutputBridge?.();
                        }
                        if (!gestureOperation.rollbackOwnershipTransferred &&
                            !predecessorCommitted &&
                            !gestureOperation.contextWasRunning &&
                            this.audioManager.contextManager?.audioContext?.state === 'running') {
                            await this.audioManager.contextManager?.suspendForPowerPolicy?.();
                        }
                        this._emitSnapshot();
                        return false;
                    };
                    if (!contextReady || !bridgeReady || (!inputReady && !mixedCanContinue)) {
                        await rollbackNewInput();
                        return rejectResume();
                    }
                    if (!inputReady && mixedCanContinue) {
                        this.resourceHealth = ResourceHealth.DEGRADED;
                    }
                    if (results[2].status === 'fulfilled' && results[2].value &&
                        !ownsCurrentInputResource()) {
                        inputReady = false;
                        if (!mixedCanContinue) return rejectResume();
                        this.resourceHealth = ResourceHealth.DEGRADED;
                    } else if (results[2].status === 'fulfilled' && results[2].value) {
                        this.pendingInputChangedEvent = true;
                        const route = this._deriveRouteAndPlayerFacts().inputRouteIntent;
                        const routeNeedsInput = route === InputRouteIntent.EXTERNAL ||
                            route === InputRouteIntent.MIXED;
                        const inputSource = this.audioManager.ioManager?.inputSourceNode || null;
                        if (routeNeedsInput) {
                            inputReady =
                                this.audioManager.ensureSourceConnectedToPipeline?.(inputSource) === true;
                        }
                        const topologyChanged = routeNeedsInput && inputReady;
                        if (inputMutationBefore) {
                            try {
                                const mutation = this.mutations.commitOwnedMutation({
                                    ownerOperationId: `input-install-${++this.operationSequence}`,
                                    mutationKind: 'input-install',
                                    beforeTokens: inputMutationBefore.tokens,
                                    beforeGuards: inputMutationBefore.guards,
                                    resourceSnapshot: this.audioManager.ioManager?.getInputSnapshot?.() || null,
                                    topologyChanged
                                });
                                if (topologyChanged) {
                                    this._invalidateTopologyBoundPowerEvidence();
                                }
                                this.audioManager.adoptPowerMutation?.(mutation);
                                inputMutationBefore = null;
                            } catch {
                                this._resynchronizeInputGeneration();
                                inputReady = false;
                            }
                        }
                        const canonicalSourceReplaced = inputReady
                            ? this.player?.contextManager
                                ?.replaceCanonicalInputSource?.(inputSource)
                            : false;
                        if (canonicalSourceReplaced === false) inputReady = false;
                        if (inputReady && route === InputRouteIntent.EXTERNAL) {
                            this.audioManager.ioManager.sourceNode = inputSource;
                            this.audioManager.sourceNode = inputSource;
                        }
                        if (!inputReady) {
                            const rolledBack = await this.requestAudioReconfigurationInputRelease({
                                handoffToSilent: true,
                                disconnectInput: true
                            });
                            if (!rolledBack) {
                                this._resynchronizeInputGeneration();
                            }
                            if (!mixedCanContinue) return rejectResume();
                            this.resourceHealth = ResourceHealth.DEGRADED;
                        }
                    }
                    if (gestureOperation.requiresInputSuccess && needsInput) {
                        const inputAfter = this.audioManager.ioManager?.getInputSnapshot?.() || null;
                        const inputSource = this.audioManager.ioManager?.inputSourceNode || null;
                        const route = this._deriveRouteAndPlayerFacts().inputRouteIntent;
                        const routeNeedsInput = route === InputRouteIntent.EXTERNAL ||
                            route === InputRouteIntent.MIXED;
                        inputReady = inputAfter?.state === InputResourceState.LIVE && !!inputSource;
                        if (inputReady && routeNeedsInput) {
                            inputReady =
                                this.audioManager.ensureSourceConnectedToPipeline?.(inputSource) === true;
                        }
                        if (inputReady) {
                            inputReady = this.player?.contextManager
                                ?.replaceCanonicalInputSource?.(inputSource) !== false;
                        }
                        if (!inputReady) {
                            await rollbackNewInput();
                            return rejectResume();
                        }
                    }
                    if (finalResumeKind === ResumeKind.DEDICATED_INPUT ||
                        finalResumeKind === ResumeKind.MIXED_PLAY) {
                        const inputAfter = this.audioManager.ioManager?.getInputSnapshot?.() || null;
                        const inputDemandSatisfied = !needsInput ||
                            inputAfter?.state === InputResourceState.LIVE;
                        if (inputDemandSatisfied) {
                            const journalStatus = this.sessionJournal.getStatus?.();
                            const journalCleared = journalStatus?.journalPhase === null ||
                                this.sessionJournal.clear?.() === true;
                            if (journalCleared) {
                                this.manualResumeRequired = false;
                            } else {
                                this.manualResumeRequired = true;
                                this.resourceHealth = ResourceHealth.DEGRADED;
                            }
                        }
                    }
                    this.resumeKind = finalResumeKind;
                    this.workletArms.clear();
                    this.automaticMonitoringArm = emptyAutomaticArm();
                    this._configureWorklets();
                    let workletReady = false;
                    try {
                        workletReady = await this._applyWorkletState(
                            AudioPowerState.ACTIVE,
                            ProcessingDirective.FULL_PROCESS,
                            { restoreOnFailure: true }
                        );
                    } catch {
                        workletReady = false;
                    }
                    if (!workletReady) {
                        await rollbackNewInput();
                        return rejectResume();
                    }
                    // A successful user gesture starts a fresh no-route idle period;
                    // an expired pre-resume clock must not immediately undo the resume.
                    this.noRouteIdleSinceEpochMs = null;
                    this.noRouteIdleEpochTokens = null;
                    this.requestReconcile('gesture-resume').catch(() => {});
                    gestureOperation.commitSucceeded = true;
                    return true;
            } finally {
                this.gestureResumeInProgress = Math.max(0, this.gestureResumeInProgress - 1);
            }
        });
        const sharedPromise = operation.finally(() => {
            if (this.gestureResumePromise === sharedPromise) {
                this.gestureResumePromise = null;
                this.gestureResumeKind = ResumeKind.NONE;
                this.gestureResumeOperation = null;
            }
        });
        this.gestureResumePromise = sharedPromise;
        this.gestureResumeKind = resumeKind;
        return sharedPromise;
    }

    _isFullyActive() {
        return this.effectiveState === AudioPowerState.ACTIVE &&
            this.processingDirective === ProcessingDirective.FULL_PROCESS &&
            this.transition.state === 'stable' &&
            this.audioManager.contextManager?.audioContext?.state === 'running';
    }

    ensureActiveForAutomaticPlayback() {
        return Promise.resolve(this._isFullyActive());
    }

    ensureActive(resumeKind = ResumeKind.UNEXPECTED_RECOVERY) {
        if (!this.enabled) return this.audioManager.contextManager?.resumeAudioContext?.();
        if (this._isFullyActive()) {
            return Promise.resolve(true);
        }
        return this.beginUserGestureResume(resumeKind);
    }

    requestResumeFromUserGesture(resumeKind = ResumeKind.DEDICATED_INPUT) {
        return this.beginUserGestureResume(resumeKind);
    }

    async requestSilentInputSelection(inputConfigRevision) {
        const before = this._getTokensAndGuards();
        if (!Number.isSafeInteger(inputConfigRevision) ||
            inputConfigRevision !== before.guards.inputConfigRevision + 1) {
            return false;
        }
        const ioManager = this.audioManager.ioManager;
        const input = ioManager?.getInputSnapshot?.() || null;
        const inputResourcePresent = input?.state === InputResourceState.LIVE ||
            input?.state === InputResourceState.ACQUIRING ||
            input?.trackState === 'live' || !!ioManager?.inputSourceNode;
        if (inputResourcePresent) {
            const released = await this.requestUserDisabledInputRelease(inputConfigRevision);
            if (released !== true) return false;
            if (this.started) this.requestReconcile('input-selection-silent').catch(() => {});
            return true;
        }

        const operationId = `input-silent-${++this.operationSequence}`;
        this._setTransition('releasing-input', operationId);
        const releaseLease = this.leases.acquireLease('input-silent-selection', {
            mode: 'hold-current',
            scope: 'resource-mutation'
        });
        try {
            const handoff = this._handoffPipelineToSilentSource();
            if (!handoff.success) throw new Error('silent-source-handoff-failed');
            if (ioManager?.markInputNotConfigured?.() !== true) {
                throw new Error('silent-input-state-commit-failed');
            }
            if (handoff.topologyChanged) {
                const mutation = this.mutations.commitOwnedMutation({
                    ownerOperationId: operationId,
                    mutationKind: 'route-topology-commit',
                    beforeTokens: before.tokens,
                    beforeGuards: before.guards,
                    resourceSnapshot: ioManager?.getInputSnapshot?.() || null,
                    topologyChanged: true,
                    intentChanges: {
                        routeIntentRevision: false,
                        inputConfigRevision: true,
                        playerIntentGeneration: false
                    }
                });
                this._invalidateTopologyBoundPowerEvidence();
                this.audioManager.adoptPowerMutation?.(mutation);
            } else if (!this.commitInputConfigIntent(inputConfigRevision)) {
                throw new Error('input-config-intent-stale');
            }
            this.pendingInputChangedEvent = true;
            this._configureWorklets();
            this._setTransition('stable', null);
            if (this.started) this.requestReconcile('input-selection-silent').catch(() => {});
            return true;
        } catch (error) {
            this.transitionError = {
                code: 'input-release-failed',
                message: error?.message || String(error),
                operationId,
                recoverable: true
            };
            this.resourceHealth = ResourceHealth.DEGRADED;
            this._setTransition('stable', null);
            return false;
        } finally {
            releaseLease();
        }
    }

    requestUserDisabledInputRelease(inputConfigRevision) {
        const before = this._getTokensAndGuards();
        if (!Number.isSafeInteger(inputConfigRevision) ||
            inputConfigRevision !== before.guards.inputConfigRevision + 1) {
            return Promise.resolve(false);
        }
        return this.requestInputRelease({
            releaseCause: 'user-disabled-input',
            ...before.tokens,
            inputConfigRevision
        });
    }

    requestAudioReconfigurationInputRelease(options = {}) {
        const before = this._getTokensAndGuards();
        return this.requestInputRelease({
            releaseCause: 'audio-reconfiguration',
            ...before.tokens,
            inputConfigRevision: before.guards.inputConfigRevision
        }, options);
    }

    async requestInputRelease(releaseRequest, options = {}) {
        if (!releaseRequest || this.disposed) return false;
        const operationId = `input-release-${++this.operationSequence}`;
        this._setTransition('releasing-input', operationId);
        const releaseLease = this.leases.acquireLease('input-release', {
            mode: 'hold-current',
            scope: 'resource-mutation'
        });
        let before = null;
        let releaseCause = null;
        let requiresSessionJournal = false;
        let graphTopologyChanged = false;
        let physicalReleaseApplied = false;
        try {
            before = this._getTokensAndGuards();
            const routeFacts = this._deriveRouteAndPlayerFacts();
            releaseCause = releaseRequest.releaseCause;
            requiresSessionJournal = releaseCause !== 'user-disabled-input' &&
                releaseCause !== 'audio-reconfiguration';
            for (const key of [
                'policyGeneration',
                'inputGeneration',
                'topologyRevision',
                'workletGraphGeneration'
            ]) {
                if (releaseRequest[key] !== before.tokens[key]) {
                    throw new Error('input-release-eligibility-stale');
                }
            }
            if (releaseCause === 'maximum-routed-input-silence' &&
                !routeFacts.inputRouteConnected) {
                throw new Error('input-release-route-stale');
            }
            if (releaseCause === 'player-only-retention-expired' &&
                routeFacts.inputRouteConnected) {
                throw new Error('input-release-route-stale');
            }
            const inputWasRouteConnected = routeFacts.inputRouteConnected;
            const disconnectInputDuringRelease = inputWasRouteConnected &&
                (releaseCause !== 'audio-reconfiguration' || options.disconnectInput === true);
            graphTopologyChanged = releaseCause === 'maximum-routed-input-silence';
            const inputBefore = this.audioManager.ioManager?.getInputSnapshot?.() || null;
            if (requiresSessionJournal) {
                const prepared = this.sessionJournal.prepare?.({
                    operationId,
                    releaseCause,
                    releaseEligibility: releaseRequest,
                    suspendCause: this.suspendCause,
                    policy: this.settings.mode,
                    inputConfigured: inputBefore?.inputConfigured === true,
                    inputGeneration: inputBefore?.inputGeneration ?? 0,
                    createdAtEpochMs: this.now()
                });
                if (!prepared) throw new Error('session-journal-unavailable');
                this.manualResumeRequired = true;
            }
            const handoff = this._handoffPipelineToSilentSource({
                canonicalRequired: options.canonicalRequired !== false
            });
            if (!handoff.success) {
                throw new Error('silent-source-handoff-failed');
            }
            graphTopologyChanged = graphTopologyChanged || handoff.topologyChanged;
            const inputAtStop = this.audioManager.ioManager?.getInputSnapshot?.() || null;
            const releasableInputPresent = inputAtStop?.state === InputResourceState.LIVE ||
                inputAtStop?.state === InputResourceState.ACQUIRING ||
                inputAtStop?.trackState === 'live' ||
                !!this.audioManager.ioManager?.inputSourceNode;
            const releaseResult = releasableInputPresent
                ? this.audioManager.ioManager?.releaseAudioInput?.({
                    reason: releaseCause,
                    disconnect: disconnectInputDuringRelease
                })
                : {
                    alreadyAbsent: true,
                    stoppedTrackCount: 0,
                    before: inputAtStop ? { ...inputAtStop } : null,
                    after: inputAtStop ? { ...inputAtStop } : null
                };
            const stopped = releaseResult?.stoppedTrackCount > 0;
            const beforeState = releaseResult?.before?.state ?? null;
            const alreadyAbsent = releaseResult?.stoppedTrackCount === 0 &&
                (releaseResult?.alreadyAbsent === true ||
                    beforeState === 'ended' || beforeState === 'released' ||
                    beforeState === 'not-configured' || beforeState === null);
            if (!stopped && !alreadyAbsent) {
                throw new Error('input-stop-not-confirmed');
            }
            if (releaseCause === 'user-disabled-input' &&
                this.audioManager.ioManager?.markInputNotConfigured?.() !== true) {
                throw new Error('silent-input-state-commit-failed');
            }
            physicalReleaseApplied = true;
            if (requiresSessionJournal) {
                this.sessionJournal.advance?.(operationId, 'input-stopped');
            }
            const resourceSnapshot = this.audioManager.ioManager?.getInputSnapshot?.() || null;
            const mutation = this.mutations.commitOwnedMutation({
                ownerOperationId: operationId,
                mutationKind: 'input-release',
                beforeTokens: before.tokens,
                beforeGuards: before.guards,
                resourceSnapshot,
                topologyChanged: graphTopologyChanged,
                ...(releaseCause === 'user-disabled-input' && {
                    intentChanges: {
                        routeIntentRevision: false,
                        inputConfigRevision: true,
                        playerIntentGeneration: false
                    }
                })
            });
            if (graphTopologyChanged) {
                this._invalidateTopologyBoundPowerEvidence();
            }
            this.audioManager.adoptPowerMutation?.(mutation);
            if (requiresSessionJournal) {
                this.sessionJournal.advance?.(operationId, 'committed');
            }
            this.audioManager.powerDiagnostics?.increment?.('inputReleaseTransactions');
            this.audioManager.powerDiagnostics?.increment?.(
                'inputTrackStops',
                releaseResult?.stoppedTrackCount || 0
            );
            this.pendingInputChangedEvent = true;
            this._configureWorklets();
            this._setTransition('stable', null);
            return true;
        } catch (error) {
            if (physicalReleaseApplied) {
                try {
                    if (this._recoverAppliedInputRelease({
                        before,
                        releaseCause,
                        releaseRequest,
                        graphTopologyChanged,
                        operationId,
                        requiresSessionJournal
                    })) {
                        this._setTransition('stable', null);
                        return true;
                    }
                } catch {
                    // Preserve the original release error below when recovery fails.
                }
            }
            this._resynchronizeInputGeneration();
            this.transitionError = {
                code: error?.message === 'session-journal-unavailable'
                    ? 'input-release-proof-unavailable'
                    : 'input-release-failed',
                message: error?.message || String(error),
                operationId,
                recoverable: true
            };
            this.resourceHealth = ResourceHealth.DEGRADED;
            this._setTransition('stable', null);
            return false;
        } finally {
            releaseLease();
        }
    }

    _recoverAppliedInputRelease({
        before,
        releaseCause,
        releaseRequest,
        graphTopologyChanged,
        operationId,
        requiresSessionJournal
    }) {
        if (!before) return false;
        const ioManager = this.audioManager.ioManager;
        const input = ioManager?.getInputSnapshot?.() || null;
        const inputAbsent = !ioManager?.inputSourceNode && input?.trackState !== 'live' &&
            input?.state !== InputResourceState.LIVE &&
            input?.state !== InputResourceState.ACQUIRING;
        if (!inputAbsent) return false;

        if (releaseCause === 'user-disabled-input') {
            const silentSource = ioManager?.silentInputGainNode;
            if (input?.state !== InputResourceState.NOT_CONFIGURED || !silentSource ||
                this.audioManager.isSourceConnectedToPipeline?.(silentSource) !== true) {
                return false;
            }
        }

        this._resynchronizeInputGeneration({ synchronizeResourceSnapshot: true });
        if (releaseCause === 'user-disabled-input' &&
            !this.commitInputConfigIntent(releaseRequest.inputConfigRevision)) {
            return false;
        }

        if (graphTopologyChanged) {
            const expectedTopologyRevision = before.tokens.topologyRevision + 1;
            if (this._getTokensAndGuards().tokens.topologyRevision < expectedTopologyRevision) {
                this.notifyTopologyChanged('input-release-recovered');
            }
            this._invalidateTopologyBoundPowerEvidence();
        }
        if (requiresSessionJournal) {
            this.sessionJournal.advance?.(operationId, 'committed');
        }
        this.transitionError = null;
        this.resourceHealth = ResourceHealth.UNKNOWN;
        this.pendingInputChangedEvent = true;
        this._configureWorklets();
        if (this.started) this.requestReconcile('input-release-recovered').catch(() => {});
        return true;
    }

    _resynchronizeInputGeneration({ synchronizeResourceSnapshot = false } = {}) {
        const snapshot = this._getTokensAndGuards();
        const inputGeneration = this.audioManager.ioManager?.inputGeneration;
        if (!Number.isSafeInteger(inputGeneration)) return;
        const generationChanged = inputGeneration !== snapshot.tokens.inputGeneration;
        if (!generationChanged && !synchronizeResourceSnapshot) return;
        // A failed release transaction must not leave the controller tokens
        // or resource snapshot behind the state the IO manager already applied.
        this.mutations = new PowerMutationCoordinator({
            tokens: { ...snapshot.tokens, inputGeneration },
            guards: snapshot.guards,
            resourceSnapshot: generationChanged || synchronizeResourceSnapshot
                ? this.audioManager.ioManager?.getInputSnapshot?.() || null
                : snapshot.resourceSnapshot,
            mutationSequence: snapshot.mutationSequence
        });
    }

    _scheduleDeadline(deadlineAt) {
        this._clearDeadlineTimer();
        if (!Number.isFinite(deadlineAt) || this.disposed) return;
        const delay = deadlineAt > this.now() ? deadlineAt - this.now() : 0;
        this.deadlineTimer = this.setTimeoutFn?.(() => {
            this.deadlineTimer = null;
            this.requestReconcile('deadline').catch(() => {});
        }, delay);
    }

    _clearDeadlineTimer() {
        if (this.deadlineTimer !== null) {
            this.clearTimeoutFn?.(this.deadlineTimer);
            this.deadlineTimer = null;
        }
    }

    _emitSnapshot() {
        const previousSnapshot = this._lastSnapshot;
        const snapshot = this.getSnapshot();
        this._lastSnapshot = snapshot;
        for (const listener of this.listeners) {
            try { listener(snapshot); } catch { /* listener isolation */ }
        }
        this.audioManager.dispatchEvent?.('powerStateChanged', { detail: snapshot });
        if (this.pendingInputChangedEvent) {
            this.pendingInputChangedEvent = false;
            this.audioManager.dispatchEvent?.('audioInputChanged', {
                detail: { snapshot, changedResource: 'input' }
            });
        }
        const resumeBecameRequired = snapshot.manualResumeRequired &&
            previousSnapshot?.manualResumeRequired !== true;
        const resourcesBecameBlocked = snapshot.resourceHealth === ResourceHealth.BLOCKED &&
            previousSnapshot?.resourceHealth !== ResourceHealth.BLOCKED;
        if (resumeBecameRequired || resourcesBecameBlocked) {
            this.audioManager.dispatchEvent?.('powerResumeRequired', {
                detail: {
                    snapshot,
                    reason: snapshot.transitionError.code || snapshot.reason
                }
            });
        }
    }

    _getSnapshotWorkletNodes(coordinator) {
        const nodes = this._getActiveWorkletNodes();
        return nodes.map((node, index) => {
            const observation = this.workletObservations.get(node) ||
                (index === 0 ? this.workletObservation : null);
            const ack = this.workletAcks.get(node) || (index === 0 ? this.workletAck : null);
            const statePreparation = this.workletPreparations.get(node) ||
                (index === 0 ? this.statePreparation : createUnknownStatePreparation());
            const observedProcessingState = observation?.processingState || observation?.state;
            return {
                role: node === this.audioManager.workletNode
                    ? 'primary'
                    : `parallel-${index + 1}`,
                workletGraphGeneration: coordinator.tokens.workletGraphGeneration,
                topologyRevision: coordinator.tokens.topologyRevision,
                state: observation?.errorCode ? 'error' : (observation ? 'rendering' : 'unseen'),
                processingState: observedProcessingState === 'active' ||
                    observedProcessingState === 'monitoring'
                    ? observedProcessingState
                    : 'unknown',
                commandAckId: ack?.commandId ?? null,
                observationRequestId: observation?.observationRequestId ?? null,
                firstRenderSeen: Number.isSafeInteger(observation?.renderSequence),
                renderSequence: observation?.renderSequence ?? null,
                lastHeartbeatAt: observation?.receivedAtEpochMs ?? null,
                statePreparation,
                errorCode: observation?.errorCode ?? null
            };
        });
    }

    getSnapshot() {
        const coordinator = this._getTokensAndGuards();
        const route = this._deriveRouteAndPlayerFacts();
        const decision = this.lastDecision;
        const input = route.inputSnapshot;
        const context = this.audioManager.contextManager?.audioContext;
        const lease = this.leases.getSnapshot();
        const now = this.now();
        const temporalSkipEligible = decision?.temporalSkipEligible === true;
        const temporalMustProcess = decision?.temporalSkipReason === 'temporal-must-process';
        let routeState = 'not-required';
        if (route.inputRouteIntent === InputRouteIntent.PLAYER_ONLY && route.transportDemand) {
            routeState = route.playerSourceStatus.state;
        } else if (route.inputRouteIntent === InputRouteIntent.EXTERNAL) {
            routeState = route.inputRouteConnected ? 'connected' :
                (input.inputSourcePresent ? 'disconnected' : 'unknown');
        } else if (route.inputRouteIntent === InputRouteIntent.MIXED) {
            const playerReady = !route.transportDemand || route.playerSourceStatus.state === 'connected';
            routeState = route.inputRouteConnected && playerReady ? 'connected' :
                (input.inputSourcePresent ? 'disconnected' : 'unknown');
        }
        const monitoringFastWakeEligible = decision?.monitoringFastWakeEligible === true;
        const persistenceStatus = this.sessionJournal.getStatus?.() || {
            state: 'unknown',
            storage: 'session',
            clientId: null,
            sessionId: null,
            journalPhase: null,
            observedAtEpochMs: null,
            errorCode: null
        };
        const transitionError = this.transitionError ? {
            code: this.transitionError.code,
            phase: this.transitionError.phase || 'power-transition',
            operationId: this.transitionError.operationId ?? null,
            recoverable: this.transitionError.recoverable === true,
            messageKey: this.transitionError.messageKey ||
                `error.powerState.${this.transitionError.code}`
        } : createEmptyTransitionError();
        return buildPowerSnapshot({
            effectiveState: this.effectiveState,
            desiredState: this.desiredState,
            topologyRevision: coordinator.tokens.topologyRevision,
            resourceMutationInProgress: lease.resourceMutationInProgress,
            processingDirective: this.processingDirective,
            transportDemand: decision?.transportDemand ?? route.transportDemand,
            dspProcessingDemand: decision?.dspProcessingDemand ?? true,
            inputSignalForProcessing: decision?.inputSignalForProcessing ?? 'unknown',
            inputRetentionTarget: decision?.inputRetentionTarget ?? true,
            transition: { ...this.transition },
            reason: this.reason,
            suspendCause: this.suspendCause,
            resumeKind: this.resumeKind,
            requiredResources: decision?.requiredResources || {
                blocking: [], healthy: [], allowActiveWhenHealthyMissing: false
            },
            inputMonitoring: (route.inputRouteIntent === InputRouteIntent.EXTERNAL ||
                route.inputRouteIntent === InputRouteIntent.MIXED) &&
                this.effectiveState === AudioPowerState.MONITORING,
            manualResumeRequired: this.manualResumeRequired,
            resourceStatus: {
                context: {
                    state: resourceStateFromContext(context),
                    operationId: this.transition.operationId,
                    observedAtEpochMs: now,
                    errorCode: null
                },
                input: {
                    state: input.state,
                    availability: input.inputAvailability,
                    configured: input.inputConfigured,
                    inputConfigRevision: coordinator.guards.inputConfigRevision,
                    inputAvailabilityRevision: input.inputAvailabilityRevision,
                    inputGeneration: input.inputGeneration,
                    operationId: this.transition.state === 'releasing-input'
                        ? this.transition.operationId
                        : null,
                    observedAtEpochMs: now,
                    errorCode: null
                },
                route: {
                    state: routeState,
                    intent: route.inputRouteIntent,
                    routeIntentRevision: coordinator.guards.routeIntentRevision,
                    observedAtEpochMs: now,
                    errorCode: null
                },
                outputBridge: {
                    state: this.audioManager.ioManager?.audioElement
                        ? (this.audioManager.ioManager.audioElement.paused ? 'paused' : 'playing')
                        : 'not-required',
                    operationId: null,
                    observedAtEpochMs: now,
                    errorCode: null
                },
                playerSource: {
                    state: route.playerSourceStatus.state,
                    playerIntentGeneration: coordinator.guards.playerIntentGeneration,
                    observedAtEpochMs: now,
                    errorCode: null
                },
                worklets: {
                    temporalSkip: {
                        status: temporalSkipEligible
                            ? 'eligible'
                            : (temporalMustProcess ? 'blocked' : 'unknown'),
                        blockerReason: temporalMustProcess ? 'temporal-must-process' : null,
                        topologyRevision: coordinator.tokens.topologyRevision
                    },
                    automaticMonitoringArm: { ...this.automaticMonitoringArm },
                    monitoringFastWakeEligible,
                    monitoringFastWakeBlockerReason: monitoringFastWakeEligible
                        ? null
                        : (decision?.monitoringFastWakeBlockerReason ||
                            'temporal-preparation-not-worklet-local'),
                    nodes: this._getSnapshotWorkletNodes(coordinator)
                },
                persistence: persistenceStatus
            },
            resourceHealth: this.resourceHealth,
            transitionError
        });
    }
}

function aggregateFirstRenderObservations(observations) {
    const valid = observations.filter(Boolean);
    if (valid.length === 0) return null;
    const latest = valid.at(-1);
    return {
        ...latest,
        inputActive: valid.some(observation => observation.inputActive === true),
        outputActive: valid.some(observation => observation.outputActive === true),
        renderSequence: Math.max(...valid.map(observation =>
            Number.isSafeInteger(observation.renderSequence) ? observation.renderSequence : 0
        )),
        receivedAtEpochMs: Math.max(...valid.map(observation =>
            Number.isFinite(observation.receivedAtEpochMs) ? observation.receivedAtEpochMs : 0
        ))
    };
}
