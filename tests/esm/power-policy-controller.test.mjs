import assert from 'node:assert/strict';
import test from 'node:test';
import { PowerPolicyController } from '../../js/audio/power-policy-controller.js';
import { NO_AUDIO_INPUT_DEVICE_ID } from '../../js/audio/audio-device-constants.js';
import { validatePowerSnapshot } from '../../js/audio/power-snapshot.js';

function createHarness({
  settings = { mode: 'balanced', silenceThresholdDb: -80, fullSuspendDelaySeconds: 300 },
  player = null,
  input = null,
  inputDeviceId = null,
  pipeline = [],
  outputGain = null,
  structuralProof = null,
  contextState = 'running',
  workletSilentWhileSuspended = false,
  silentInputConnected = false,
  firstRenderActivity = null,
  hostVisibility = null,
  hostVisibilityRead = null,
  pageHidden = false
} = {}) {
  let now = 0;
  let renderSequence = 0;
  let timerSequence = 0;
  let configuredTemporalCapabilities = [];
  let skippedFrameCount = 0;
  let bridgePauseCount = 0;
  let hostVisibilityListener = null;
  let hostVisibilitySnapshot = hostVisibility;
  const timers = new Map();
  const sessionValues = new Map();
  const events = [];
  const posted = [];
  const inputState = input || {
    state: 'not-configured',
    inputAvailability: 'unknown',
    inputAvailabilityRevision: 0,
    inputGeneration: 0,
    inputResourceId: null,
    inputConfigured: false,
    inputSourcePresent: false,
    trackState: 'absent'
  };
  const context = {
    state: contextState,
    sampleRate: 48000,
    destination: { channelCount: 2 },
    async suspend() { this.state = 'suspended'; },
    async resume() { this.state = 'running'; }
  };
  let controller;
  const arm = {
    state: 'disarmed',
    commandId: null,
    skipEpoch: null,
    armAfterRenderSequence: null
  };
  const port = {
    postMessage(message) {
      if (workletSilentWhileSuspended && context.state !== 'running') return;
      posted.push(message);
      if (message.type === 'configurePowerPolicy') {
        configuredTemporalCapabilities = message.monitoringPreparationCapabilities || [];
      }
      if (message.type === 'prepareTemporalStateAndResume') {
        const counts = {
          stateless: 0,
          resetOnResume: 0,
          agedBySkippedFrames: 0,
          mustProcess: 0
        };
        for (const entry of configuredTemporalCapabilities) {
          if (entry.capability === 'stateless') counts.stateless++;
          else if (entry.capability === 'must-process') counts.mustProcess++;
          else if (entry.capability === 'age-by-skipped-frames' &&
            message.elapsedContinuity === 'verified') counts.agedBySkippedFrames++;
          else counts.resetOnResume++;
        }
        const derivedFrames = message.elapsedContinuity === 'verified'
          ? Math.floor(message.suspendedElapsedMs * message.resumeSampleRate / 1000)
          : 0;
        queueMicrotask(() => {
          controller.handleWorkletPowerEvent({
            type: 'temporalStateResumed',
            state: 'acknowledged',
            origin: 'deliberate',
            ownerOperationId: message.ownerOperationId,
            commandId: message.commandId,
            resumeCommandId: message.resumeCommandId,
            ackCommandId: message.ackCommandId,
            skipEpoch: message.skipEpoch,
            workletGraphGeneration: message.workletGraphGeneration,
            topologyRevision: message.topologyRevision,
            enabledPluginCount: configuredTemporalCapabilities.length,
            coveredPluginCount: configuredTemporalCapabilities.length,
            appliedPolicyCounts: counts,
            skippedFrameCount: skippedFrameCount + derivedFrames,
            renderSequence,
            errorCode: null
          });
          controller.handleWorkletPowerEvent({
            type: 'powerFirstRender',
            commandId: message.resumeCommandId,
            skipEpoch: null,
            state: 'active',
            processingDirective: 'full-process',
            inputActive: firstRenderActivity?.inputActive ?? false,
            outputActive: firstRenderActivity?.outputActive ?? false,
            workletGraphGeneration: message.workletGraphGeneration,
            topologyRevision: message.topologyRevision,
            renderSequence: ++renderSequence,
            skippedFrameCount: 0
          });
        });
      }
      if (message.type === 'requestPowerObservation') {
        queueMicrotask(() => controller.handleWorkletPowerEvent({
          type: 'powerObservation',
          observationRequestId: message.observationRequestId,
          reason: null,
          state: 'active',
          processingDirective: 'full-process',
          inputActive: false,
          outputActive: false,
          inputPower: 0,
          outputPower: 0,
          workletGraphGeneration: message.workletGraphGeneration,
          topologyRevision: message.topologyRevision,
          commandId: message.commandId,
          skipEpoch: null,
          renderSequence: ++renderSequence,
          skippedFrameCount: 0,
          automaticMonitoringArm: { ...arm },
          counters: {
            renderQuanta: renderSequence,
            detectorQuanta: renderSequence,
            fullProcessQuanta: 0,
            telemetryPosts: 0
          }
        }));
      }
      if (message.type === 'setPowerProcessingState') {
        if (message.processingDirective === 'force-monitoring' ||
          message.processingDirective === 'zero-output-transport' ||
          message.processingDirective === 'bypass-transport') skippedFrameCount = 128;
        if (message.processingDirective === 'allow-automatic') {
          arm.state = 'armed';
          arm.commandId = message.commandId;
          arm.skipEpoch = message.skipEpoch;
          arm.armAfterRenderSequence = message.armAfterRenderSequence;
        } else {
          arm.state = 'disarmed';
          arm.commandId = null;
          arm.skipEpoch = null;
          arm.armAfterRenderSequence = null;
        }
        queueMicrotask(() => {
          controller.handleWorkletPowerEvent({
            type: 'powerStateAck',
            commandId: message.commandId,
            skipEpoch: message.skipEpoch,
            state: message.state,
            processingDirective: message.processingDirective,
            workletGraphGeneration: message.workletGraphGeneration,
            topologyRevision: message.topologyRevision,
          renderSequence,
          automaticMonitoringArm: { ...arm }
        });
          controller.handleWorkletPowerEvent({
            type: 'powerFirstRender',
            commandId: message.commandId,
            skipEpoch: message.skipEpoch,
            state: message.state,
            processingDirective: message.processingDirective,
            inputActive: firstRenderActivity?.inputActive ?? false,
            outputActive: firstRenderActivity?.outputActive ?? false,
            workletGraphGeneration: message.workletGraphGeneration,
            topologyRevision: message.topologyRevision,
            renderSequence: ++renderSequence,
            skippedFrameCount
          });
        });
      }
    }
  };
  const inputSourceNode = inputState.inputSourcePresent ? { id: 'input-source' } : null;
  const silentInputSourceNode = silentInputConnected ? { id: 'silent-source' } : null;
  const initialPipelineSource = inputSourceNode || silentInputSourceNode;
  const connectedSources = new Set(initialPipelineSource && !player ? [initialPipelineSource] : []);
  const audioManager = {
    pipelineA: pipeline,
    pipelineB: null,
    pipeline,
    masterBypass: false,
    sourceNode: initialPipelineSource,
    workletNode: { port },
    contextManager: {
      audioContext: context,
      powerStateDelegate: null,
      setPowerStateDelegate(value) { this.powerStateDelegate = value; },
      async suspendForPowerPolicy() { await context.suspend(); return context.state === 'suspended'; },
      async resumeForPowerPolicy() { await context.resume(); return true; }
    },
    ioManager: {
      inputGeneration: inputState.inputGeneration,
      audioElement: null,
      outputGainNode: outputGain === null ? null : { gain: { value: outputGain } },
      powerOutputStructurallyZero: false,
      inputSourceNode,
      sourceNode: initialPipelineSource,
      inputRouteConnected: inputState.inputSourcePresent && !player,
      _silentSourceNode: silentInputSourceNode,
      silentInputGainNode: silentInputSourceNode,
      ensureSilentSourceFallback() {
        if (!this._silentSourceNode) this._silentSourceNode = { id: 'silent-source' };
        this.silentInputGainNode = this._silentSourceNode;
        return this._silentSourceNode;
      },
      adoptSilentSourceFallback(sourceNode) {
        if (sourceNode !== this._silentSourceNode) return false;
        this.sourceNode = sourceNode;
        return true;
      },
      getInputSnapshot() { return { ...inputState }; },
      markInputNotConfigured() {
        if (this.inputSourceNode) return false;
        inputState.state = 'not-configured';
        inputState.inputAvailability = 'unknown';
        inputState.inputResourceId = null;
        inputState.inputConfigured = false;
        inputState.inputSourcePresent = false;
        inputState.trackState = 'absent';
        this.inputRouteConnected = false;
        return true;
      },
      releaseAudioInput() {
        const before = { ...inputState };
        inputState.state = 'released';
        inputState.inputAvailability = 'unknown';
        inputState.inputAvailabilityRevision++;
        inputState.inputGeneration++;
        inputState.inputResourceId = null;
        inputState.inputSourcePresent = false;
        inputState.trackState = 'ended';
        this.inputGeneration = inputState.inputGeneration;
        this.inputSourceNode = null;
        this.inputRouteConnected = false;
        return { before, after: { ...inputState }, stoppedTrackCount: 1 };
      },
      beginReacquireAudioInput() {
        inputState.state = 'live';
        inputState.inputAvailability = 'available';
        inputState.inputAvailabilityRevision++;
        inputState.inputGeneration++;
        inputState.inputConfigured = true;
        this.inputGeneration = inputState.inputGeneration;
        this.inputSourceNode = { id: 'reacquired' };
        return Promise.resolve({ ...inputState });
      },
      pauseOutputBridge() { bridgePauseCount++; },
      playOutputBridgeForGesture() { return Promise.resolve(true); }
    },
    powerDiagnostics: { increment() {}, mergeWorkletCounters() {} },
    getCurrentPipeline() { return this.pipeline; },
    getActivePowerWorklets() { return [this.workletNode]; },
    getPowerWorkletGraphGeneration() { return 0; },
    getPowerTopologyRevision() { return 0; },
    getStructuralZeroOutputProof() { return structuralProof; },
    getPowerChannelFanInBound() { return 1; },
    broadcastToActiveWorklets(message) { port.postMessage(message); },
    dispatchEvent(name, event) { events.push({ name, event }); },
    adoptPowerMutation() {},
    setPlayerPowerUiEnabled() {},
    connectSourceToPipeline(node) {
      connectedSources.add(node);
      if (node === this.ioManager.inputSourceNode) this.ioManager.inputRouteConnected = true;
      return true;
    },
    ensureSourceConnectedToPipeline(node) {
      if (this.isSourceConnectedToPipeline(node)) return true;
      return this.connectSourceToPipeline(node) === true &&
        this.isSourceConnectedToPipeline(node);
    },
    disconnectSourceFromPipeline(node) {
      connectedSources.delete(node);
      if (node === this.ioManager.inputSourceNode) this.ioManager.inputRouteConnected = false;
    },
    isSourceConnectedToPipeline(node) {
      return connectedSources.has(node);
    }
  };
  const windowRef = {
    appConfig: { powerSaving: settings },
    audioPreferences: {
      inputDeviceId: inputDeviceId ??
        (inputState.inputConfigured ? 'mic' : NO_AUDIO_INPUT_DEVICE_ID),
      useInputWithPlayer: player?.useInputWithPlayer === true
    },
    location: { search: '' },
    localStorage: { getItem() { return null; } },
    sessionStorage: {
      getItem(key) { return sessionValues.has(key) ? sessionValues.get(key) : null; },
      setItem(key, value) { sessionValues.set(key, String(value)); }
    },
    crypto: { randomUUID: () => `test-${sessionValues.size}` }
  };
  if (hostVisibility !== null) {
    windowRef.electronAPI = {
      async getWindowVisibility() {
        return hostVisibilityRead ? hostVisibilityRead() : hostVisibilitySnapshot;
      },
      onWindowVisibilityChanged(listener) {
        hostVisibilityListener = listener;
        return () => {
          if (hostVisibilityListener === listener) hostVisibilityListener = null;
        };
      }
    };
  }
  controller = new PowerPolicyController(audioManager, {
    settings,
    enabled: true,
    windowRef,
    documentRef: { hidden: pageHidden },
    now: () => now,
    monotonicNow: () => now,
    setTimeoutFn(callback, delay) {
      const id = ++timerSequence;
      timers.set(id, { callback, delay, at: now + delay });
      return id;
    },
    clearTimeoutFn(id) { timers.delete(id); }
  });
  audioManager.powerPolicyController = controller;
  if (player) controller.attachPlayer(player.instance);
  return {
    controller,
    audioManager,
    context,
    events,
    inputState,
    posted,
    get bridgePauseCount() { return bridgePauseCount; },
    emitHostVisibility(hidden) {
      hostVisibilitySnapshot = { hidden };
      hostVisibilityListener?.(hostVisibilitySnapshot);
    },
    setNow(value) { now = value; },
    async fireDueTimers() {
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.callback();
        }
      }
      for (let index = 0; index < 8; index++) await Promise.resolve();
    },
    async flush() {
      for (let index = 0; index < 8; index++) await Promise.resolve();
    }
  };
}

function createPausedPlayer() {
  const listeners = new Map();
  const snapshot = {
    isPlaying: false,
    isPaused: true,
    isStopped: false,
    isTransitioning: false
  };
  const instance = {
    stateManager: {
      getStateSnapshot: () => ({ ...snapshot }),
      addListener(key, callback) { listeners.set(key, callback); },
      removeListener(key) { listeners.delete(key); }
    },
    contextManager: {
      replaceCanonicalInputSource() {},
      getUseInputWithPlayer: () => false,
      getPowerSourceStatus: () => ({ state: 'not-required', sourcePresent: false })
    }
  };
  return { instance, useInputWithPlayer: false, snapshot };
}

function currentRoutedReleaseRequest(harness) {
  const tokens = harness.controller._getTokensAndGuards().tokens;
  const observation = harness.controller.workletObservation || {};
  return {
    releaseCause: 'maximum-routed-input-silence',
    ...tokens,
    hiddenSinceEpochMs: 0,
    routedInputSilentSinceEpochMs: 0,
    routedOutputSilentSinceEpochMs: 0,
    releaseDeadlineAtEpochMs: 0,
    routeIntent: 'external',
    inputAvailability: 'available',
    inputAvailabilityRevision: harness.inputState.inputAvailabilityRevision,
    observationRequestId: observation.observationRequestId ?? 1,
    renderSequence: observation.renderSequence ?? 1
  };
}

function seedTopologyBoundPowerEvidence(harness) {
  const { controller, audioManager } = harness;
  const tokens = controller._getTokensAndGuards().tokens;
  const node = audioManager.workletNode;
  const automaticMonitoringArm = {
    state: 'armed',
    commandId: 'seed-command',
    skipEpoch: controller.skipEpoch,
    armAfterRenderSequence: 41
  };
  const observation = {
    type: 'powerObservation',
    observationRequestId: 41,
    state: 'active',
    processingDirective: 'full-process',
    workletGraphGeneration: tokens.workletGraphGeneration,
    topologyRevision: tokens.topologyRevision,
    renderSequence: 41,
    receivedAtEpochMs: 0,
    errorCode: null
  };
  const acknowledgement = {
    type: 'powerStateAck',
    commandId: 'seed-command',
    workletGraphGeneration: tokens.workletGraphGeneration,
    topologyRevision: tokens.topologyRevision
  };
  const preparation = {
    state: 'acknowledged',
    origin: 'deliberate',
    ownerOperationId: 'seed-operation',
    workletGraphGeneration: tokens.workletGraphGeneration,
    topologyRevision: tokens.topologyRevision,
    skipEpoch: controller.skipEpoch,
    enabledPluginCount: 0,
    coveredPluginCount: 0,
    appliedPolicyCounts: {
      stateless: 0,
      resetOnResume: 0,
      agedBySkippedFrames: 0,
      mustProcess: 0
    },
    skippedFrameCount: 0,
    commandId: 'seed-command',
    ackCommandId: 'seed-ack',
    renderSequence: 41,
    errorCode: null
  };

  controller.workletObservation = observation;
  controller.workletAck = acknowledgement;
  controller.statePreparation = preparation;
  controller.workletObservations.set(node, observation);
  controller.workletAcks.set(node, acknowledgement);
  controller.workletArms.set(node, automaticMonitoringArm);
  controller.workletPreparations.set(node, preparation);
  controller.automaticMonitoringArm = automaticMonitoringArm;
  controller.lastSkipCommandId = 'seed-command';
  controller.suspendedTemporalTiming = {
    startedAtMonotonicMs: 0,
    sampleRate: harness.context.sampleRate,
    skipEpoch: controller.skipEpoch,
    topologyRevision: tokens.topologyRevision,
    workletGraphGeneration: tokens.workletGraphGeneration
  };
  controller.suspendedTemporalContinuity = true;
  controller.currentPowerTopologySnapshot = { topologyRevision: tokens.topologyRevision };
  controller.currentZeroOutputProof = { topologyRevision: tokens.topologyRevision };
  controller.noRouteIdleSinceEpochMs = 1;
  controller.noRouteIdleEpochTokens = { ...tokens };
  controller.routedInputSilentSinceEpochMs = 1;
  controller.routedOutputSilentSinceEpochMs = 1;
  controller.routedSilenceEpochTokens = { ...tokens };
  controller.routedInputReleaseEligibleSinceEpochMs = 1;
  controller.routedInputReleaseEpochTokens = {
    ...tokens,
    inputAvailabilityRevision: 1,
    routeIntent: 'external'
  };
  return {
    skipEpoch: controller.skipEpoch,
    lastSkipCommandId: controller.lastSkipCommandId,
    suspendedTemporalTiming: controller.suspendedTemporalTiming,
    topologyRevision: tokens.topologyRevision
  };
}

function captureTopologyBoundPowerEvidence(controller) {
  return {
    snapshot: controller.getSnapshot(),
    primaryObservation: controller.workletObservation,
    primaryAck: controller.workletAck,
    statePreparation: controller.statePreparation,
    observationCount: controller.workletObservations.size,
    ackCount: controller.workletAcks.size,
    armCount: controller.workletArms.size,
    preparationCount: controller.workletPreparations.size,
    automaticMonitoringArm: controller.automaticMonitoringArm,
    skipEpoch: controller.skipEpoch,
    lastSkipCommandId: controller.lastSkipCommandId,
    suspendedTemporalTiming: controller.suspendedTemporalTiming,
    suspendedTemporalContinuity: controller.suspendedTemporalContinuity,
    currentPowerTopologySnapshot: controller.currentPowerTopologySnapshot,
    currentZeroOutputProof: controller.currentZeroOutputProof,
    noRouteIdleSinceEpochMs: controller.noRouteIdleSinceEpochMs,
    routedInputSilentSinceEpochMs: controller.routedInputSilentSinceEpochMs,
    routedOutputSilentSinceEpochMs: controller.routedOutputSilentSinceEpochMs,
    routedInputReleaseEligibleSinceEpochMs: controller.routedInputReleaseEligibleSinceEpochMs
  };
}

function assertTopologyBoundPowerEvidenceInvalidated(
  captured,
  seeded,
  { temporalStateReset = false } = {}
) {
  assert.equal(validatePowerSnapshot(captured.snapshot), true);
  assert.equal(captured.snapshot.topologyRevision, seeded.topologyRevision + 1);
  assert.equal(captured.primaryObservation, null);
  assert.equal(captured.primaryAck, null);
  assert.equal(captured.statePreparation.state, 'unknown');
  assert.equal(captured.observationCount, 0);
  assert.equal(captured.ackCount, 0);
  assert.equal(captured.armCount, 0);
  assert.equal(captured.preparationCount, 0);
  assert.deepEqual(captured.automaticMonitoringArm, {
    state: 'disarmed',
    commandId: null,
    skipEpoch: null,
    armAfterRenderSequence: null
  });
  assert.equal(captured.skipEpoch, seeded.skipEpoch + (temporalStateReset ? 1 : 0));
  assert.equal(
    captured.lastSkipCommandId,
    temporalStateReset ? null : seeded.lastSkipCommandId
  );
  assert.deepEqual(
    captured.suspendedTemporalTiming,
    temporalStateReset ? null : seeded.suspendedTemporalTiming
  );
  assert.equal(captured.suspendedTemporalContinuity, !temporalStateReset);
  assert.equal(captured.currentPowerTopologySnapshot, null);
  assert.equal(captured.currentZeroOutputProof, null);
  assert.equal(captured.noRouteIdleSinceEpochMs, null);
  assert.equal(captured.routedInputSilentSinceEpochMs, null);
  assert.equal(captured.routedOutputSilentSinceEpochMs, null);
  assert.equal(captured.routedInputReleaseEligibleSinceEpochMs, null);
}

test('balanced silent no-route stays active through its idle deadline before suspending', async () => {
  const harness = createHarness();
  await harness.controller.start();
  assert.equal(harness.controller.getEffectiveState(), 'ACTIVE');
  assert.equal(harness.controller.getSnapshot().processingDirective, 'full-process');
  assert.equal(harness.controller.getDspUiActivityAllowed(), true);
  assert.equal(validatePowerSnapshot(harness.controller.getSnapshot()), true);
  assert.equal(harness.context.state, 'running');

  harness.setNow(14_999);
  await harness.controller.requestReconcile('before-deadline');
  assert.equal(harness.context.state, 'running');

  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline');
  assert.equal(harness.controller.getEffectiveState(), 'SUSPENDED');
  assert.equal(harness.context.state, 'suspended');
  assert.ok(harness.posted.some(message => message.type === 'setUiTelemetryEnabled' && !message.enabled));
});

test('suspend commitment uses post-command first-render activity and never suspends on stale silence', async () => {
  const harness = createHarness({
    firstRenderActivity: {
      inputActive: true,
      outputActive: true
    }
  });
  let suspendCalls = 0;
  harness.audioManager.contextManager.suspendForPowerPolicy = async () => {
    suspendCalls += 1;
    harness.context.state = 'suspended';
    return true;
  };

  await harness.controller.start();
  assert.equal(harness.controller.workletObservation.inputActive, false);
  assert.equal(harness.controller.workletObservation.outputActive, false);

  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline-with-fresh-activity');

  assert.equal(suspendCalls, 0);
  assert.equal(harness.context.state, 'running');
  assert.equal(harness.controller.getEffectiveState(), 'ACTIVE');
  assert.equal(harness.controller.workletObservation.inputActive, true);
  assert.equal(harness.controller.workletObservation.outputActive, true);
});

test('zero-output suspension requires a current generated proof and restarts its clock after proof loss', async () => {
  const harness = createHarness({
    outputGain: 1,
    structuralProof: {
      proven: true,
      topologyRevision: 0,
      workletGraphGeneration: 99,
      proofKind: 'final-output-gain-zero',
      coveredPhysicalOutputIds: ['physical-output-0', 'physical-output-1'],
      reason: null
    },
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 1,
      inputResourceId: 'mic-proof',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  harness.setNow(30_000);
  await harness.controller.requestReconcile('stale-proof');
  assert.equal(harness.context.state, 'running');

  harness.audioManager.ioManager.outputGainNode.gain.value = 0;
  harness.audioManager.ioManager.powerOutputStructurallyZero = true;
  await harness.controller.requestReconcile('current-proof-start');
  assert.equal(harness.controller.processingDirective, 'zero-output-transport');
  harness.setNow(44_999);
  await harness.controller.requestReconcile('before-zero-deadline');
  assert.equal(harness.context.state, 'running');
  harness.setNow(45_000);
  await harness.controller.requestReconcile('zero-deadline');
  assert.equal(harness.context.state, 'suspended');
});

test('startup safety fade zero never closes an active Analyzer UI gate', async () => {
  const gates = [];
  const analyzer = {
    id: 'startup-analyzer',
    enabled: true,
    temporalCapability: 'stateless',
    powerGainUpperBoundDb: 0,
    constructor: { name: 'AnalyzerPlugin' },
    setPowerUiEnabled(value) { gates.push(value); }
  };
  const harness = createHarness({
    settings: { mode: 'continuous', silenceThresholdDb: -80, fullSuspendDelaySeconds: 300 },
    outputGain: 0,
    pipeline: [analyzer],
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 1,
      inputResourceId: 'startup-mic',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });

  await harness.controller.start();
  await harness.flush();

  assert.equal(harness.controller.getEffectiveState(), 'ACTIVE');
  assert.equal(harness.controller.currentZeroOutputProof?.proven, false);
  assert.equal(gates.at(-1), true);
  assert.equal(harness.controller.getDspUiActivityAllowed(), true);
});

test('named DSP UI suppression pauses analyzers until every suppression reason is cleared', async () => {
  const gates = [];
  const analyzer = {
    id: 'mini-player-analyzer',
    enabled: true,
    temporalCapability: 'stateless',
    powerGainUpperBoundDb: 0,
    constructor: { name: 'AnalyzerPlugin' },
    setPowerUiEnabled(value) { gates.push(value); }
  };
  const harness = createHarness({ pipeline: [analyzer] });

  await harness.controller.start();
  harness.controller.setDspUiSuppressed('mini-player', true);
  assert.equal(harness.controller.getDspUiActivityAllowed(), false);
  assert.equal(gates.at(-1), false);

  harness.controller.setDspUiSuppressed('hidden-panel', true);
  harness.controller.setDspUiSuppressed('mini-player', false);
  assert.equal(harness.controller.getDspUiActivityAllowed(), false);

  harness.controller.setDspUiSuppressed('hidden-panel', false);
  assert.equal(harness.controller.getDspUiActivityAllowed(), true);
  assert.equal(gates.at(-1), true);
});

test('must-process blocks no-route demotion and reports degraded health', async () => {
  const harness = createHarness({
    pipeline: [{ id: 1, enabled: true, temporalCapability: 'must-process' }]
  });
  await harness.controller.start();
  harness.setNow(60_000);
  await harness.controller.requestReconcile('long-idle');
  const snapshot = harness.controller.getSnapshot();
  assert.equal(snapshot.effectiveState, 'ACTIVE');
  assert.equal(snapshot.processingDirective, 'full-process');
  assert.equal(snapshot.resourceHealth, 'degraded');
  assert.equal(harness.context.state, 'running');
});

test('parallel pipelines keep full processing until their observations can be aggregated safely', async () => {
  const harness = createHarness();
  harness.audioManager.isParallelProcessing = () => true;
  await harness.controller.start();
  harness.setNow(60_000);
  await harness.controller.requestReconcile('parallel-still-active');
  assert.equal(harness.controller.getEffectiveState(), 'ACTIVE');
  assert.equal(harness.controller.getSnapshot().processingDirective, 'full-process');
  assert.equal(harness.controller.lastDecision.reason, 'full-process-lease');
  assert.equal(harness.context.state, 'running');
});

test('reset-on-resume chains suspend and acknowledge canonical preparation before full DSP', async () => {
  const harness = createHarness({
    pipeline: [{ id: 1, enabled: true, temporalCapability: 'reset-on-resume' }]
  });
  await harness.controller.start();
  const powerConfiguration = harness.posted.find(message =>
    message.type === 'configurePowerPolicy');
  assert.equal(powerConfiguration.monitoringFastWakeEligible, true);
  assert.equal(powerConfiguration.wakeOnAnyInput, true);
  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline');
  assert.equal(harness.context.state, 'suspended');
  const suspensionCommand = harness.posted.find(message =>
    message.type === 'setPowerProcessingState' &&
    message.processingDirective === 'force-monitoring');
  assert.ok(suspensionCommand);

  harness.setNow(16_000);
  const releaseLease = harness.controller.acquireLease('resume-test');
  const resumed = await harness.controller.requestResumeFromUserGesture('player-only-play');
  await harness.flush();
  assert.equal(resumed, true);
  assert.equal(harness.context.state, 'running');
  const preparationIndex = harness.posted.findIndex(message =>
    message.type === 'prepareTemporalStateAndResume');
  const fullProcessIndex = harness.posted.findIndex((message, index) =>
    index > preparationIndex && message.type === 'setPowerProcessingState' &&
    message.processingDirective === 'full-process');
  assert.ok(preparationIndex >= 0);
  assert.equal(fullProcessIndex, -1);
  assert.equal(harness.posted[preparationIndex].suspendedElapsedMs, 1000);
  const preparation = harness.controller.getSnapshot().resourceStatus.worklets.nodes[0]
    .statePreparation;
  assert.equal(preparation.state, 'acknowledged');
  assert.equal(preparation.appliedPolicyCounts.resetOnResume, 1);
  releaseLease();
});

test('suspended zero-output configuration installs a fresh zero guard', () => {
  const harness = createHarness();
  harness.controller.effectiveState = 'suspended';
  harness.controller.processingDirective = 'suspended';
  harness.controller.suspendCause = 'zero-output-no-transport';
  harness.controller.skipEpoch = 3;
  harness.controller.lastSkipCommandId = 4;
  harness.controller.suspendedTemporalTiming = {
    completedElapsedMs: 500,
    startedAtMonotonicMs: 1000,
    endedAtMonotonicMs: null,
    sampleRate: 48000,
    skipEpoch: 3,
    topologyRevision: 0,
    workletGraphGeneration: 0
  };

  const configuration = harness.controller._configureWorklets();
  assert.equal(configuration.hostGuardDirective, 'zero-output-transport');
  assert.equal(configuration.hostGuardSkipEpoch, 4);
  assert.equal(harness.controller.lastSkipCommandId, configuration.commandId);
  assert.equal(harness.controller.suspendedTemporalTiming.skipEpoch, 4);
});

test('same-identity settings updates preserve deliberate zero and bypass guards', async () => {
  for (const directive of ['zero-output-transport', 'bypass-transport']) {
    const harness = createHarness();
    harness.controller.effectiveState = 'ACTIVE';
    harness.controller.processingDirective = directive;
    harness.controller.skipEpoch = 3;
    harness.controller.lastSkipCommandId = 4;
    harness.controller.commandSequence = 4;
    harness.controller.requestReconcile = () => Promise.resolve();

    await harness.controller.updateSettings({
      mode: 'balanced',
      silenceThresholdDb: -80,
      fullSuspendDelaySeconds: 300
    });

    const configuration = harness.posted.findLast(message =>
      message.type === 'configurePowerPolicy');
    assert.equal(configuration.hostGuardDirective, directive);
    assert.equal(configuration.hostGuardSkipEpoch, 4);
    assert.equal(configuration.preserveHostSkipState, true);
  }
});

test('failed resume accumulates only repeated AudioContext suspend intervals', async () => {
  const harness = createHarness({
    pipeline: [{ id: 1, enabled: true, temporalCapability: 'reset-on-resume' }]
  });
  await harness.controller.start();
  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline');
  assert.equal(harness.context.state, 'suspended');

  const originalBroadcast = harness.audioManager.broadcastToActiveWorklets.bind(
    harness.audioManager
  );
  const atomicMessages = [];
  harness.audioManager.broadcastToActiveWorklets = message => {
    if (message.type !== 'prepareTemporalStateAndResume') {
      originalBroadcast(message);
      return;
    }
    harness.posted.push(message);
    atomicMessages.push(message);
    queueMicrotask(() => harness.controller.handleWorkletPowerEvent({
      type: 'temporalStateResumed',
      state: 'error',
      origin: 'deliberate',
      ownerOperationId: message.ownerOperationId,
      commandId: message.commandId,
      resumeCommandId: atomicMessages[0].resumeCommandId,
      ackCommandId: message.ackCommandId,
      skipEpoch: message.skipEpoch,
      workletGraphGeneration: message.workletGraphGeneration,
      topologyRevision: message.topologyRevision,
      enabledPluginCount: 1,
      coveredPluginCount: 1,
      appliedPolicyCounts: {
        stateless: 0,
        resetOnResume: 0,
        agedBySkippedFrames: 0,
        mustProcess: 0
      },
      skippedFrameCount: 128,
      renderSequence: 2,
      errorCode: 'temporal-preparation-runtime-failed',
      monitoringFastWakeEligible: false,
      monitoringFastWakeBlockerReason: 'temporal-preparation-runtime-failed'
    }));
  };
  let resuspendAt = 17_000;
  harness.audioManager.contextManager.suspendForPowerPolicy = async () => {
    harness.setNow(resuspendAt);
    harness.context.state = 'suspended';
    return true;
  };

  const skipCommandsBeforeFailure = harness.posted.filter(message =>
    message.type === 'setPowerProcessingState').length;
  harness.setNow(16_000);
  assert.equal(await harness.controller.beginUserGestureResume('player-only-play'), false);
  assert.equal(harness.posted.filter(message =>
    message.type === 'setPowerProcessingState').length, skipCommandsBeforeFailure);
  assert.equal(harness.controller.getEffectiveState(), 'SUSPENDED');
  assert.equal(harness.controller.processingDirective, 'suspended');
  assert.equal(harness.controller.suspendedTemporalTiming.completedElapsedMs, 1000);
  assert.equal(harness.controller.suspendedTemporalTiming.startedAtMonotonicMs, 17_000);
  assert.equal(harness.controller.suspendedTemporalTiming.endedAtMonotonicMs, null);

  resuspendAt = 21_000;
  harness.setNow(20_000);
  assert.equal(await harness.controller.beginUserGestureResume('player-only-play'), false);
  assert.equal(atomicMessages.length, 2);
  assert.equal(atomicMessages[1].commandId, atomicMessages[0].commandId);
  assert.equal(atomicMessages[1].skipEpoch, atomicMessages[0].skipEpoch);
  assert.equal(atomicMessages[1].suspendedElapsedMs, 4000);
  assert.equal(harness.controller.suspendedTemporalTiming.completedElapsedMs, 4000);
  assert.equal(harness.controller.suspendedTemporalTiming.startedAtMonotonicMs, 21_000);
  assert.equal(harness.controller.getEffectiveState(), 'SUSPENDED');
});

test('maximum player-only keeps signal monitoring alive while microphone release uses its own deadline', async () => {
  const player = createPausedPlayer();
  const harness = createHarness({
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
    player,
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 5,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  harness.setNow(3_000);
  await harness.controller.requestReconcile('context-deadline');
  assert.equal(harness.context.state, 'running');
  assert.equal(harness.inputState.state, 'live');

  harness.setNow(59_999);
  await harness.controller.requestReconcile('before-input-deadline');
  assert.equal(harness.inputState.state, 'live');

  harness.setNow(60_000);
  await harness.controller.requestReconcile('input-deadline');
  assert.equal(harness.inputState.state, 'released', JSON.stringify(harness.controller.lastDecision));
  assert.equal(harness.controller.getSnapshot().manualResumeRequired, true);
  assert.equal(harness.context.state, 'running');
});

test('paused player remains a silent routed source instead of becoming no-route', async () => {
  const player = createPausedPlayer();
  const harness = createHarness({ player });
  await harness.controller.start();

  harness.setNow(15_000);
  await harness.controller.requestReconcile('paused-player-silence');
  await harness.flush();

  assert.equal(harness.context.state, 'running');
  assert.notEqual(harness.controller.getEffectiveState(), 'SUSPENDED');
  assert.equal(harness.controller.lastDecision.inputSignalForProcessing, 'silent');
  assert.notEqual(harness.controller.lastDecision.reason, 'idle-no-route');
});

test('native Electron visibility remains hidden when the DOM visibility API stays visible', async () => {
  const harness = createHarness({ hostVisibility: { hidden: true } });
  await harness.controller.start();

  let facts = harness.controller._collectFacts(0);
  assert.equal(facts.visibility, 'hidden');
  assert.equal(facts.hiddenSinceEpochMs, 0);

  harness.controller.handlePageLifecycleEvent('visibilitychange', { hidden: false });
  await harness.flush();
  facts = harness.controller._collectFacts(0);
  assert.equal(facts.visibility, 'hidden');
  assert.equal(facts.hiddenSinceEpochMs, 0);

  harness.emitHostVisibility(false);
  await harness.flush();
  facts = harness.controller._collectFacts(0);
  assert.equal(facts.visibility, 'visible');
  assert.equal(facts.hiddenSinceEpochMs, null);
});

test('host and page visibility share one UI and telemetry power gate', async () => {
  const pluginUiStates = [];
  const playerUiStates = [];
  const plugin = {
    id: 1,
    enabled: true,
    temporalCapability: 'stateless',
    setPowerUiEnabled(enabled) { pluginUiStates.push(enabled); }
  };
  const harness = createHarness({
    pipeline: [plugin],
    hostVisibility: { hidden: false }
  });
  harness.audioManager.setPlayerPowerUiEnabled = enabled => playerUiStates.push(enabled);
  await harness.controller.start();
  pluginUiStates.length = 0;
  playerUiStates.length = 0;
  harness.posted.length = 0;

  harness.emitHostVisibility(true);
  await harness.flush();
  assert.equal(harness.controller.getDspUiActivityAllowed(), false);
  assert.equal(harness.controller.playerUiActivityAllowed, false);
  assert.deepEqual(pluginUiStates, [false]);
  assert.deepEqual(playerUiStates, [false]);
  assert.ok(harness.posted.some(message =>
    message.type === 'setUiTelemetryEnabled' && message.enabled === false
  ));

  harness.controller.handlePageLifecycleEvent('visibilitychange', { hidden: true });
  const pluginCallCount = pluginUiStates.length;
  const playerCallCount = playerUiStates.length;
  harness.emitHostVisibility(false);
  await harness.flush();
  assert.equal(harness.controller.getDspUiActivityAllowed(), false);
  assert.equal(harness.controller.playerUiActivityAllowed, false);
  assert.equal(pluginUiStates.length, pluginCallCount);
  assert.equal(playerUiStates.length, playerCallCount);

  harness.controller.handlePageLifecycleEvent('visibilitychange', { hidden: false });
  await harness.flush();
  assert.equal(harness.controller.getDspUiActivityAllowed(), true);
  assert.equal(harness.controller.playerUiActivityAllowed, true);
  assert.equal(pluginUiStates.at(-1), true);
  assert.equal(playerUiStates.at(-1), true);
  assert.ok(harness.posted.some(message =>
    message.type === 'setUiTelemetryEnabled' && message.enabled === true
  ));
});

test('configuration carries the current UI gate across worklet graph identities', async () => {
  const harness = createHarness({ hostVisibility: { hidden: true } });
  await harness.controller.start();
  let configuration = harness.posted.findLast(message =>
    message.type === 'configurePowerPolicy');
  assert.equal(configuration.uiTelemetryEnabled, false);

  harness.posted.length = 0;
  harness.controller.handleWorkletGraphReplacement();
  configuration = harness.posted.findLast(message =>
    message.type === 'configurePowerPolicy');
  assert.equal(configuration.uiTelemetryEnabled, false);

  harness.emitHostVisibility(false);
  await harness.flush();
  harness.posted.length = 0;
  harness.controller.handleWorkletGraphReplacement();
  configuration = harness.posted.findLast(message =>
    message.type === 'configurePowerPolicy');
  assert.equal(configuration.uiTelemetryEnabled, true);
});

test('hidden web startup configures telemetry off without an Electron visibility API', async () => {
  for (const pageHidden of [true, false]) {
    const harness = createHarness({ pageHidden });
    assert.equal(harness.controller.windowRef.electronAPI, undefined);

    await harness.controller.start();

    const configuration = harness.posted.find(message =>
      message.type === 'configurePowerPolicy');
    assert.equal(configuration.uiTelemetryEnabled, !pageHidden);
  }
});

test('a startup visibility event wins over an older asynchronous snapshot', async () => {
  let resolveVisibilityRead;
  const visibilityRead = new Promise(resolve => {
    resolveVisibilityRead = resolve;
  });
  const harness = createHarness({
    hostVisibility: { hidden: false },
    hostVisibilityRead: () => visibilityRead
  });

  const startPromise = harness.controller.start();
  await Promise.resolve();
  harness.emitHostVisibility(true);
  assert.equal(harness.posted.filter(
    message => message.type === 'requestPowerObservation' ||
      message.type === 'configurePowerPolicy'
  ).length, 0);

  resolveVisibilityRead({ hidden: false });
  await startPromise;
  const facts = harness.controller._collectFacts(0);
  assert.equal(facts.visibility, 'hidden');
  assert.equal(facts.hiddenSinceEpochMs, 0);
});

test('runtime monitoring failure stays latched for the current topology identity', async () => {
  const harness = createHarness({
    pipeline: [{ id: 1, enabled: true, temporalCapability: 'stateless' }]
  });
  await harness.controller.start();
  const oldTokens = harness.controller._getTokensAndGuards().tokens;
  const failure = {
    type: 'temporalStateResumed',
    state: 'error',
    origin: 'deliberate',
    ownerOperationId: 'failed-resume',
    commandId: 3,
    resumeCommandId: 4,
    ackCommandId: 5,
    skipEpoch: 1,
    workletGraphGeneration: oldTokens.workletGraphGeneration,
    topologyRevision: oldTokens.topologyRevision,
    enabledPluginCount: 1,
    coveredPluginCount: 0,
    appliedPolicyCounts: {
      stateless: 0,
      resetOnResume: 0,
      agedBySkippedFrames: 0,
      mustProcess: 0
    },
    skippedFrameCount: 128,
    renderSequence: 3,
    errorCode: 'temporal-preparation-runtime-failed',
    monitoringFastWakeEligible: false,
    monitoringFastWakeBlockerReason: 'temporal-preparation-runtime-failed'
  };

  assert.equal(harness.controller.handleWorkletPowerEvent(failure, {}), true);
  await harness.flush();
  let facts = harness.controller._collectFacts(0);
  assert.equal(facts.monitoringFastWakeEligible, false);
  assert.equal(facts.monitoringFastWakeBlockerReason, 'temporal-preparation-runtime-failed');
  let snapshot = harness.controller.getSnapshot();
  assert.equal(snapshot.resourceHealth, 'degraded');
  assert.equal(snapshot.resourceStatus.worklets.monitoringFastWakeEligible, false);
  assert.equal(
    snapshot.resourceStatus.worklets.monitoringFastWakeBlockerReason,
    'temporal-preparation-runtime-failed'
  );

  harness.controller.handleWorkletPowerEvent({
    type: 'powerHeartbeat',
    state: 'active',
    processingDirective: 'full-process',
    inputActive: false,
    outputActive: false,
    workletGraphGeneration: oldTokens.workletGraphGeneration,
    topologyRevision: oldTokens.topologyRevision,
    monitoringFastWakeEligible: true,
    monitoringFastWakeBlockerReason: null
  });
  await harness.controller.updateSettings({
    mode: 'balanced',
    silenceThresholdDb: -75,
    fullSuspendDelaySeconds: 300
  });
  facts = harness.controller._collectFacts(0);
  assert.equal(facts.monitoringFastWakeEligible, false);

  harness.controller.notifyTopologyChanged('test-topology-change');
  await harness.flush();
  facts = harness.controller._collectFacts(0);
  assert.equal(facts.monitoringFastWakeEligible, true);
  assert.equal(harness.controller.handleWorkletPowerEvent(failure), false);
  snapshot = harness.controller.getSnapshot();
  assert.equal(snapshot.resourceStatus.worklets.monitoringFastWakeEligible, true);
});

test('a monitoring observation preserves an explicit force-monitoring directive', async () => {
  const harness = createHarness();
  await harness.controller.start();
  const tokens = harness.controller._getTokensAndGuards().tokens;
  harness.controller.handleWorkletPowerEvent({
    type: 'powerObservation',
    reason: 'config-wake',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    inputActive: false,
    outputActive: false,
    workletGraphGeneration: tokens.workletGraphGeneration,
    topologyRevision: tokens.topologyRevision,
    monitoringFastWakeEligible: true,
    monitoringFastWakeBlockerReason: null
  });
  assert.equal(harness.controller.getEffectiveState(), 'MONITORING');
  assert.equal(harness.controller.processingDirective, 'force-monitoring');
});

test('maximum hidden routed silence can suspend a paused player without releasing a microphone', async () => {
  const player = createPausedPlayer();
  const harness = createHarness({
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
    player
  });
  await harness.controller.start();
  harness.controller.documentRef.hidden = true;
  harness.controller.handlePageLifecycleEvent('visibilitychange', { hidden: true });
  await harness.flush();

  harness.setNow(59_999);
  await harness.controller.requestReconcile('before-routed-silence-deadline');
  assert.equal(harness.context.state, 'running');

  harness.setNow(60_000);
  await harness.controller.requestReconcile('routed-silence-deadline');
  await harness.flush();
  assert.equal(harness.context.state, 'suspended');
  assert.equal(harness.controller.getEffectiveState(), 'SUSPENDED');
  assert.equal(harness.controller.lastDecision.shouldReleaseInput, false);
  assert.equal(harness.controller.lastDecision.reason, 'maximum-routed-input-silence');
});

test('maximum hidden microphone silence suspends before releasing the input resource', async () => {
  const harness = createHarness({
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 5,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  harness.controller.documentRef.hidden = true;
  harness.controller.handlePageLifecycleEvent('visibilitychange', { hidden: true });
  await harness.flush();

  harness.setNow(60_000);
  await harness.controller.requestReconcile('routed-input-silence-deadline');
  await harness.flush();

  assert.equal(harness.context.state, 'suspended');
  assert.equal(harness.controller.getEffectiveState(), 'SUSPENDED');
  assert.equal(harness.inputState.state, 'released');
  assert.equal(harness.controller.getSnapshot().manualResumeRequired, true);
});

test('muted microphone time does not count toward the independent release deadline', async () => {
  const harness = createHarness({
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
    input: {
      state: 'live',
      inputAvailability: 'muted',
      inputAvailabilityRevision: 1,
      inputGeneration: 5,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  harness.controller.documentRef.hidden = true;
  harness.controller.handlePageLifecycleEvent('visibilitychange', { hidden: true });
  await harness.flush();

  harness.setNow(60_000);
  await harness.controller.requestReconcile('muted-routed-silence-deadline');
  assert.equal(harness.context.state, 'suspended');
  assert.equal(harness.inputState.state, 'live');

  harness.inputState.inputAvailability = 'available';
  harness.inputState.inputAvailabilityRevision = 2;
  await harness.controller.requestReconcile('microphone-available');
  assert.equal(harness.inputState.state, 'live');
  assert.equal(harness.controller.nextDeadlineAt, 120_000);

  harness.setNow(119_999);
  await harness.controller.requestReconcile('before-available-release-deadline');
  assert.equal(harness.inputState.state, 'live');

  harness.setNow(120_000);
  await harness.controller.requestReconcile('available-release-deadline');
  assert.equal(harness.inputState.state, 'released');
});

test('a routed-signal change during suspension cancels stale microphone release', async () => {
  const harness = createHarness({
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 5,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  harness.controller.documentRef.hidden = true;
  harness.controller.handlePageLifecycleEvent('visibilitychange', { hidden: true });
  await harness.flush();
  harness.audioManager.contextManager.suspendForPowerPolicy = async () => {
    harness.context.state = 'suspended';
    harness.controller.workletObservation = {
      ...harness.controller.workletObservation,
      inputActive: true,
      outputActive: true,
      renderSequence: harness.controller.workletObservation.renderSequence + 1
    };
    return true;
  };

  harness.setNow(60_000);
  await harness.controller.requestReconcile('signal-resumed-during-suspend');
  await harness.flush();

  assert.equal(harness.context.state, 'running');
  assert.equal(harness.controller.getEffectiveState(), 'ACTIVE');
  assert.equal(harness.inputState.state, 'live');
  assert.equal(harness.controller.getSnapshot().manualResumeRequired, false);
  assert.equal(harness.bridgePauseCount, 0);
});

test('a topology-changing input release invalidates evidence before publishing the mutation', async () => {
  const harness = createHarness({
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 5,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  await harness.flush();
  const seeded = seedTopologyBoundPowerEvidence(harness);
  let evidenceAtAdoption = null;
  harness.audioManager.adoptPowerMutation = mutation => {
    if (mutation.receipt.mutationKind === 'input-release') {
      evidenceAtAdoption = captureTopologyBoundPowerEvidence(harness.controller);
    }
  };

  const released = await harness.controller.requestInputRelease(
    currentRoutedReleaseRequest(harness)
  );

  assert.equal(released, true);
  assert.ok(evidenceAtAdoption);
  assertTopologyBoundPowerEvidenceInvalidated(evidenceAtAdoption, seeded);
});

test('maximum input release connects running silence before disconnecting and stopping the microphone', async () => {
  const harness = createHarness({
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 5,
      inputResourceId: 'mic-maximum-handoff',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  await harness.flush();

  const inputSource = harness.audioManager.ioManager.inputSourceNode;
  const order = [];
  const originalEnsureSilent = harness.audioManager.ioManager
    .ensureSilentSourceFallback.bind(harness.audioManager.ioManager);
  harness.audioManager.ioManager.ensureSilentSourceFallback = () => {
    order.push('start-silent');
    return originalEnsureSilent();
  };
  const originalConnect = harness.audioManager.connectSourceToPipeline
    .bind(harness.audioManager);
  harness.audioManager.connectSourceToPipeline = source => {
    if (source !== inputSource) order.push('connect-silent');
    return originalConnect(source);
  };
  const originalDisconnect = harness.audioManager.disconnectSourceFromPipeline
    .bind(harness.audioManager);
  harness.audioManager.disconnectSourceFromPipeline = source => {
    if (source === inputSource) order.push('disconnect-input');
    return originalDisconnect(source);
  };
  const originalRelease = harness.audioManager.ioManager.releaseAudioInput;
  harness.audioManager.ioManager.releaseAudioInput = function (options) {
    order.push('stop-input');
    assert.equal(
      harness.audioManager.isSourceConnectedToPipeline(this._silentSourceNode),
      true
    );
    return originalRelease.call(this, options);
  };

  const released = await harness.controller.requestInputRelease(
    currentRoutedReleaseRequest(harness)
  );

  assert.equal(released, true);
  assert.deepEqual(order, [
    'start-silent',
    'connect-silent',
    'disconnect-input',
    'stop-input'
  ]);
});

test('requestSilentInputSelection hands a live microphone to a running silent source', async () => {
  const harness = createHarness({
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 5,
      inputResourceId: 'mic-live-disable',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  await harness.flush();
  harness.controller.windowRef.audioPreferences.inputDeviceId = NO_AUDIO_INPUT_DEVICE_ID;
  harness.inputState.inputConfigured = false;

  const inputSource = harness.audioManager.ioManager.inputSourceNode;
  const before = harness.controller._getTokensAndGuards();
  const handoffOrder = [];
  let adoptedMutation = null;
  const originalEnsureSilent = harness.audioManager.ioManager
    .ensureSilentSourceFallback.bind(harness.audioManager.ioManager);
  harness.audioManager.ioManager.ensureSilentSourceFallback = () => {
    handoffOrder.push('create-silent');
    return originalEnsureSilent();
  };
  const originalConnectSource = harness.audioManager.connectSourceToPipeline
    .bind(harness.audioManager);
  harness.audioManager.connectSourceToPipeline = source => {
    handoffOrder.push(source === inputSource ? 'connect-input' : 'connect-silent');
    return originalConnectSource(source);
  };
  const originalDisconnectSource = harness.audioManager.disconnectSourceFromPipeline
    .bind(harness.audioManager);
  harness.audioManager.disconnectSourceFromPipeline = source => {
    handoffOrder.push(source === inputSource ? 'disconnect-input' : 'disconnect-other');
    return originalDisconnectSource(source);
  };
  const originalRelease = harness.audioManager.ioManager.releaseAudioInput;
  harness.audioManager.ioManager.releaseAudioInput = function (options) {
    handoffOrder.push('stop-input');
    assert.equal(
      harness.audioManager.isSourceConnectedToPipeline(this._silentSourceNode),
      true
    );
    assert.equal(harness.audioManager.isSourceConnectedToPipeline(inputSource), false);
    const result = originalRelease.call(this, options);
    this.inputSourceNode = null;
    harness.inputState.inputResourceId = null;
    harness.inputState.inputSourcePresent = false;
    harness.inputState.trackState = 'ended';
    return result;
  };
  const originalMarkNotConfigured = harness.audioManager.ioManager
    .markInputNotConfigured.bind(harness.audioManager.ioManager);
  harness.audioManager.ioManager.markInputNotConfigured = () => {
    handoffOrder.push('mark-not-configured');
    return originalMarkNotConfigured();
  };
  harness.audioManager.adoptPowerMutation = mutation => {
    adoptedMutation = mutation;
  };

  const applied = await harness.controller.requestSilentInputSelection(
    before.guards.inputConfigRevision + 1
  );
  const after = harness.controller._getTokensAndGuards();
  const silentSource = harness.audioManager.ioManager._silentSourceNode;

  assert.equal(applied, true);
  assert.equal(adoptedMutation.receipt.mutationKind, 'input-release');
  assert.equal(after.tokens.inputGeneration, before.tokens.inputGeneration + 1);
  assert.equal(after.tokens.topologyRevision, before.tokens.topologyRevision + 1);
  assert.equal(after.guards.inputConfigRevision, before.guards.inputConfigRevision + 1);
  assert.equal(harness.inputState.state, 'not-configured');
  assert.equal(harness.audioManager.ioManager.sourceNode, silentSource);
  assert.equal(harness.audioManager.sourceNode, silentSource);
  assert.equal(harness.audioManager.isSourceConnectedToPipeline(silentSource), true);
  assert.equal(harness.audioManager.isSourceConnectedToPipeline(inputSource), false);
  assert.deepEqual(handoffOrder, [
    'create-silent',
    'connect-silent',
    'disconnect-input',
    'stop-input',
    'mark-not-configured'
  ]);
  assert.equal(harness.controller.getEffectiveState(), 'ACTIVE');
  assert.equal(harness.controller.processingDirective, 'allow-automatic');
  assert.equal(harness.context.state, 'running');
});

test('a physical silent handoff remains committed when release bookkeeping fails afterward', async () => {
  const harness = createHarness({
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 8,
      inputResourceId: 'mic-bookkeeping-failure',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  await harness.flush();
  harness.controller.windowRef.audioPreferences.inputDeviceId = NO_AUDIO_INPUT_DEVICE_ID;
  harness.inputState.inputConfigured = false;

  const before = harness.controller._getTokensAndGuards();
  const originalCommit = harness.controller.mutations.commitOwnedMutation
    .bind(harness.controller.mutations);
  let injected = false;
  harness.controller.mutations.commitOwnedMutation = request => {
    if (!injected && request.mutationKind === 'input-release') {
      injected = true;
      throw new Error('injected post-release commit failure');
    }
    return originalCommit(request);
  };

  const applied = await harness.controller.requestSilentInputSelection(
    before.guards.inputConfigRevision + 1
  );
  const after = harness.controller._getTokensAndGuards();
  const silentSource = harness.audioManager.ioManager._silentSourceNode;

  assert.equal(injected, true);
  assert.equal(applied, true);
  assert.equal(harness.inputState.state, 'not-configured');
  assert.equal(after.tokens.inputGeneration, before.tokens.inputGeneration + 1);
  assert.equal(after.tokens.topologyRevision, before.tokens.topologyRevision + 1);
  assert.equal(after.guards.inputConfigRevision, before.guards.inputConfigRevision + 1);
  assert.equal(harness.audioManager.isSourceConnectedToPipeline(silentSource), true);
  assert.equal(harness.controller.getSnapshot().transitionError.code, null);
});

test('requestSilentInputSelection creates and commits a silent edge for an already released input', async () => {
  const harness = createHarness({
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 2,
      inputGeneration: 4,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  await harness.controller.start();
  await harness.flush();
  harness.controller.windowRef.audioPreferences.inputDeviceId = NO_AUDIO_INPUT_DEVICE_ID;
  harness.inputState.inputConfigured = false;

  const before = harness.controller._getTokensAndGuards();
  let releaseCount = 0;
  let adoptedMutation = null;
  const originalRelease = harness.audioManager.ioManager.releaseAudioInput;
  harness.audioManager.ioManager.releaseAudioInput = function (options) {
    releaseCount++;
    return originalRelease.call(this, options);
  };
  harness.audioManager.adoptPowerMutation = mutation => {
    adoptedMutation = mutation;
  };

  const applied = await harness.controller.requestSilentInputSelection(
    before.guards.inputConfigRevision + 1
  );
  const after = harness.controller._getTokensAndGuards();
  const silentSource = harness.audioManager.ioManager._silentSourceNode;

  assert.equal(applied, true);
  assert.equal(releaseCount, 0);
  assert.equal(adoptedMutation.receipt.mutationKind, 'route-topology-commit');
  assert.equal(after.tokens.inputGeneration, before.tokens.inputGeneration);
  assert.equal(after.tokens.topologyRevision, before.tokens.topologyRevision + 1);
  assert.equal(after.guards.inputConfigRevision, before.guards.inputConfigRevision + 1);
  assert.equal(harness.inputState.state, 'not-configured');
  assert.equal(harness.audioManager.ioManager.sourceNode, silentSource);
  assert.equal(harness.audioManager.sourceNode, silentSource);
  assert.equal(harness.audioManager.isSourceConnectedToPipeline(silentSource), true);
  assert.equal(harness.controller.getEffectiveState(), 'ACTIVE');
  assert.equal(harness.controller.processingDirective, 'allow-automatic');
  assert.equal(harness.context.state, 'running');
});

test('route-out input disable still advances topology for the new silent pipeline edge', async () => {
  const player = createPausedPlayer();
  const harness = createHarness({
    player,
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 2,
      inputResourceId: 'route-out-mic',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  const before = harness.controller._getTokensAndGuards();
  let releaseDisconnect = null;
  const originalRelease = harness.audioManager.ioManager.releaseAudioInput;
  harness.audioManager.ioManager.releaseAudioInput = function (options) {
    releaseDisconnect = options.disconnect;
    return originalRelease.call(this, options);
  };

  const released = await harness.controller.requestUserDisabledInputRelease(
    before.guards.inputConfigRevision + 1
  );
  const after = harness.controller._getTokensAndGuards();

  assert.equal(released, true);
  assert.equal(releaseDisconnect, false);
  assert.equal(after.tokens.topologyRevision, before.tokens.topologyRevision + 1);
  assert.equal(
    harness.audioManager.isSourceConnectedToPipeline(
      harness.audioManager.ioManager._silentSourceNode
    ),
    true
  );
});

test('a failed silent handoff preserves the live input and config revision', async () => {
  const harness = createHarness({
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 3,
      inputResourceId: 'handoff-failure-mic',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  const before = harness.controller._getTokensAndGuards();
  const inputSource = harness.audioManager.ioManager.inputSourceNode;
  let releaseCount = 0;
  const originalRelease = harness.audioManager.ioManager.releaseAudioInput;
  harness.audioManager.ioManager.releaseAudioInput = function (options) {
    releaseCount++;
    return originalRelease.call(this, options);
  };
  harness.audioManager.ensureSourceConnectedToPipeline = source =>
    source === inputSource;

  const released = await harness.controller.requestUserDisabledInputRelease(
    before.guards.inputConfigRevision + 1
  );
  const after = harness.controller._getTokensAndGuards();
  const silentSource = harness.audioManager.ioManager._silentSourceNode;

  assert.equal(released, false);
  assert.equal(releaseCount, 0);
  assert.equal(harness.inputState.state, 'live');
  assert.equal(harness.inputState.inputGeneration, 3);
  assert.deepEqual(after.tokens, before.tokens);
  assert.deepEqual(after.guards, before.guards);
  assert.equal(harness.audioManager.ioManager.sourceNode, inputSource);
  assert.equal(harness.audioManager.sourceNode, inputSource);
  assert.equal(harness.audioManager.isSourceConnectedToPipeline(inputSource), true);
  assert.equal(harness.audioManager.isSourceConnectedToPipeline(silentSource), false);
});

test('a rejected canonical silent source rolls back its new edge', async () => {
  const player = createPausedPlayer();
  player.instance.contextManager.replaceCanonicalInputSource = () => false;
  const harness = createHarness({
    player,
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 4,
      inputResourceId: 'canonical-failure-mic',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  const inputSource = harness.audioManager.ioManager.inputSourceNode;
  harness.audioManager.connectSourceToPipeline(inputSource);
  await harness.controller.start();
  const before = harness.controller._getTokensAndGuards();

  const released = await harness.controller.requestUserDisabledInputRelease(
    before.guards.inputConfigRevision + 1
  );
  const silentSource = harness.audioManager.ioManager._silentSourceNode;

  assert.equal(released, false);
  assert.equal(harness.inputState.state, 'live');
  assert.deepEqual(harness.controller._getTokensAndGuards(), before);
  assert.equal(harness.audioManager.ioManager.sourceNode, inputSource);
  assert.equal(harness.audioManager.isSourceConnectedToPipeline(inputSource), true);
  assert.equal(harness.audioManager.isSourceConnectedToPipeline(silentSource), false);
});

test('a topology-changing input install invalidates evidence before publishing the mutation', async () => {
  const harness = createHarness({
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 2,
      inputGeneration: 6,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  await harness.controller.start();
  await harness.flush();
  const seeded = seedTopologyBoundPowerEvidence(harness);
  let evidenceAtAdoption = null;
  harness.audioManager.adoptPowerMutation = mutation => {
    if (mutation.receipt.mutationKind === 'input-install') {
      evidenceAtAdoption = captureTopologyBoundPowerEvidence(harness.controller);
    }
  };

  const resumed = await harness.controller.requestResumeFromUserGesture('dedicated-input');
  await harness.flush();

  assert.equal(resumed, true);
  assert.ok(evidenceAtAdoption);
  assertTopologyBoundPowerEvidenceInvalidated(evidenceAtAdoption, seeded);
  const preparation = harness.controller.getSnapshot().resourceStatus.worklets.nodes[0]
    .statePreparation;
  assert.equal(preparation.state, 'acknowledged');
  assert.notEqual(preparation.commandId, seeded.lastSkipCommandId);
  const guardedConfiguration = harness.posted.findLast(message =>
    message.type === 'configurePowerPolicy' && message.hostGuardDirective);
  assert.ok(guardedConfiguration);
  assert.equal(preparation.commandId > guardedConfiguration.commandId, true);
});

test('a failed input route install is released and never published as resumed', async () => {
  const harness = createHarness({
    silentInputConnected: true,
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 2,
      inputGeneration: 6,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  let releaseCount = 0;
  const adoptedMutationKinds = [];
  const preservedSilentSource = harness.audioManager.ioManager._silentSourceNode;
  const originalRelease = harness.audioManager.ioManager.releaseAudioInput;
  harness.audioManager.ioManager.releaseAudioInput = function (options) {
    releaseCount++;
    return originalRelease.call(this, options);
  };
  harness.audioManager.connectSourceToPipeline = () => false;
  harness.audioManager.adoptPowerMutation = mutation => {
    adoptedMutationKinds.push(mutation.receipt.mutationKind);
  };
  await harness.controller.start();
  await harness.flush();

  const resumed = await harness.controller.requestResumeFromUserGesture('dedicated-input');
  await harness.flush();

  const snapshot = harness.controller.getSnapshot();
  assert.equal(resumed, false);
  assert.equal(releaseCount, 1);
  assert.deepEqual(adoptedMutationKinds, ['input-install', 'input-release']);
  assert.equal(harness.inputState.state, 'released');
  assert.equal(
    harness.controller._getTokensAndGuards().tokens.inputGeneration,
    harness.inputState.inputGeneration
  );
  assert.equal(harness.audioManager.ioManager.sourceNode, preservedSilentSource);
  assert.equal(
    harness.audioManager.isSourceConnectedToPipeline(preservedSilentSource),
    true
  );
  assert.equal(snapshot.transitionError.code, 'resume-resource-failed');
  assert.notEqual(snapshot.resourceHealth, 'healthy');
});

test('stale worklet identities are ignored and a user gesture can resume required resources', async () => {
  const player = createPausedPlayer();
  const harness = createHarness({
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
    player,
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 2,
      inputGeneration: 6,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  harness.controller.effectiveState = 'suspended';
  harness.context.state = 'suspended';
  assert.equal(harness.controller.handleWorkletPowerEvent({
    type: 'powerObservation',
    workletGraphGeneration: 99,
    topologyRevision: 0
  }), false);

  const resumed = await harness.controller.requestResumeFromUserGesture('dedicated-input');
  await harness.flush();
  assert.equal(resumed, true);
  assert.equal(harness.context.state, 'running');
  assert.equal(harness.inputState.state, 'live');
  assert.notEqual(harness.controller.getEffectiveState(), 'SUSPENDED');
});

test('gesture begin and ensureActive share one in-flight context and input acquisition', async () => {
  const harness = createHarness({
    contextState: 'suspended',
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 1,
      inputGeneration: 4,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  harness.controller.effectiveState = 'suspended';
  let resumeContext;
  let acquireInput;
  let contextResumeCount = 0;
  let inputAcquireCount = 0;
  const originalAcquire = harness.audioManager.ioManager.beginReacquireAudioInput.bind(
    harness.audioManager.ioManager
  );
  harness.audioManager.contextManager.resumeForPowerPolicy = () => {
    contextResumeCount++;
    return new Promise(resolve => {
      resumeContext = () => {
        harness.context.state = 'running';
        resolve(true);
      };
    });
  };
  harness.audioManager.ioManager.beginReacquireAudioInput = () => {
    inputAcquireCount++;
    return new Promise(resolve => {
      acquireInput = () => resolve(originalAcquire());
    });
  };

  const begun = harness.controller.beginUserGestureResume('dedicated-input');
  const ensured = harness.controller.ensureActive('dedicated-input');
  assert.strictEqual(ensured, begun);
  assert.equal(contextResumeCount, 1);
  assert.equal(inputAcquireCount, 1);

  acquireInput();
  await harness.flush();
  resumeContext();
  assert.equal(await begun, true);
  assert.equal(harness.inputState.state, 'live');
});

test('different resume kinds merge into one gesture transaction without duplicate mutation', async () => {
  const harness = createHarness({
    contextState: 'suspended',
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 1,
      inputGeneration: 4,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  harness.controller.effectiveState = 'suspended';
  let resumeContext;
  let acquireInput;
  let contextResumeCount = 0;
  let inputAcquireCount = 0;
  let mutationCount = 0;
  const originalAcquire = harness.audioManager.ioManager.beginReacquireAudioInput.bind(
    harness.audioManager.ioManager
  );
  harness.audioManager.contextManager.resumeForPowerPolicy = () => {
    contextResumeCount++;
    return new Promise(resolve => {
      resumeContext = () => {
        harness.context.state = 'running';
        resolve(true);
      };
    });
  };
  harness.audioManager.ioManager.beginReacquireAudioInput = () => {
    inputAcquireCount++;
    return new Promise(resolve => {
      acquireInput = () => resolve(originalAcquire());
    });
  };
  harness.audioManager.adoptPowerMutation = () => { mutationCount++; };

  const playerResume = harness.controller.beginUserGestureResume('player-only-play');
  const inputResume = harness.controller.beginUserGestureResume('dedicated-input');
  assert.strictEqual(inputResume, playerResume);
  assert.equal(contextResumeCount, 1);
  assert.equal(inputAcquireCount, 1);

  acquireInput();
  resumeContext();
  assert.equal(await playerResume, true);
  assert.equal(harness.inputState.inputGeneration, 5);
  assert.equal(mutationCount, 1);
  assert.equal(harness.controller.getSnapshot().resumeKind, 'dedicated-input');
});

test('stronger resumes arriving during commit acquire input in follow-up gesture transactions', async () => {
  for (const strongerKind of ['mixed-play', 'dedicated-input']) {
    const harness = createHarness({
      contextState: 'suspended',
      input: {
        state: 'released',
        inputAvailability: 'unknown',
        inputAvailabilityRevision: 1,
        inputGeneration: 4,
        inputResourceId: null,
        inputConfigured: true,
        inputSourcePresent: false,
        trackState: 'ended'
      }
    });
    harness.controller.effectiveState = 'SUSPENDED';
    let finishFirstWorklet;
    let inputAcquireCount = 0;
    let applyCount = 0;
    const originalApply = harness.controller._applyWorkletState.bind(harness.controller);
    const originalAcquire = harness.audioManager.ioManager.beginReacquireAudioInput.bind(
      harness.audioManager.ioManager
    );
    harness.controller._applyWorkletState = (...args) => {
      applyCount++;
      if (applyCount === 1) {
        return new Promise(resolve => { finishFirstWorklet = resolve; });
      }
      return originalApply(...args);
    };
    harness.audioManager.ioManager.beginReacquireAudioInput = (...args) => {
      inputAcquireCount++;
      return originalAcquire(...args);
    };

    const playerResume = harness.controller.beginUserGestureResume('player-only-play');
    await harness.flush();
    assert.equal(harness.controller.gestureResumeOperation.phase, 'committing');

    const inputResume = harness.controller.beginUserGestureResume(strongerKind);
    assert.notStrictEqual(inputResume, playerResume);
    assert.equal(inputAcquireCount, 1);
    assert.equal(harness.controller.gestureResumeOperation.resumeKind, strongerKind);

    finishFirstWorklet(true);
    assert.equal(await playerResume, true);
    assert.equal(await inputResume, true);
    assert.equal(inputAcquireCount, 1);
    assert.equal(harness.inputState.state, 'live');
    assert.equal(harness.controller.getSnapshot().resumeKind, strongerKind);
  }
});

test('a dedicated follow-up owns resources acquired by a failing mixed commit', async () => {
  const harness = createHarness({
    contextState: 'suspended',
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 1,
      inputGeneration: 4,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  harness.controller.effectiveState = 'suspended';
  let finishMixedWorklet;
  let applyCount = 0;
  let inputAcquireCount = 0;
  const originalApply = harness.controller._applyWorkletState.bind(harness.controller);
  const originalAcquire = harness.audioManager.ioManager.beginReacquireAudioInput.bind(
    harness.audioManager.ioManager
  );
  harness.controller._applyWorkletState = (...args) => {
    applyCount++;
    if (applyCount === 1) {
      return new Promise(resolve => { finishMixedWorklet = resolve; });
    }
    return originalApply(...args);
  };
  harness.audioManager.ioManager.beginReacquireAudioInput = (...args) => {
    inputAcquireCount++;
    return originalAcquire(...args);
  };

  const mixedResume = harness.controller.beginUserGestureResume('mixed-play');
  await harness.flush();
  assert.equal(harness.controller.gestureResumeOperation.phase, 'committing');
  assert.equal(harness.inputState.state, 'live');

  const dedicatedResume = harness.controller.beginUserGestureResume('dedicated-input');
  assert.notStrictEqual(dedicatedResume, mixedResume);
  finishMixedWorklet(false);

  assert.equal(await mixedResume, false);
  assert.equal(harness.context.state, 'running');
  assert.equal(harness.bridgePauseCount, 0);
  assert.equal(harness.inputState.state, 'live');
  assert.equal(await dedicatedResume, true);
  assert.equal(inputAcquireCount, 1);
  assert.equal(harness.inputState.state, 'live');
  assert.equal(
    harness.audioManager.isSourceConnectedToPipeline(
      harness.audioManager.ioManager.inputSourceNode
    ),
    true
  );
});

test('a failed dedicated follow-up preserves resources committed by a successful mixed resume', async () => {
  const harness = createHarness({
    contextState: 'suspended',
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 1,
      inputGeneration: 4,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  harness.controller.effectiveState = 'suspended';
  let finishMixedWorklet;
  let applyCount = 0;
  const originalApply = harness.controller._applyWorkletState.bind(harness.controller);
  harness.controller._applyWorkletState = (...args) => {
    applyCount++;
    if (applyCount === 1) {
      return new Promise(resolve => { finishMixedWorklet = resolve; });
    }
    if (applyCount === 2) return Promise.resolve(false);
    return originalApply(...args);
  };

  const mixedResume = harness.controller.beginUserGestureResume('mixed-play');
  await harness.flush();
  assert.equal(harness.controller.gestureResumeOperation.phase, 'committing');
  const dedicatedResume = harness.controller.beginUserGestureResume('dedicated-input');
  finishMixedWorklet(true);

  assert.equal(await mixedResume, true);
  assert.equal(await dedicatedResume, false);
  assert.equal(harness.context.state, 'running');
  assert.equal(harness.bridgePauseCount, 0);
  assert.equal(harness.inputState.state, 'live');
  assert.equal(
    harness.audioManager.isSourceConnectedToPipeline(
      harness.audioManager.ioManager.inputSourceNode
    ),
    true
  );
});

test('a dedicated gesture cannot commit without a live connected input', async () => {
  const harness = createHarness({
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 3,
      inputResourceId: 'missing-source',
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'live'
    }
  });

  assert.equal(
    await harness.controller.beginUserGestureResume('dedicated-input'),
    false
  );
  assert.equal(harness.audioManager.ioManager.inputSourceNode, null);
});

test('failed non-dedicated resume restores context and output bridge to their prior states', async () => {
  for (const failedResource of ['context', 'bridge', 'worklet']) {
    const harness = createHarness({ contextState: 'suspended' });
    harness.controller.effectiveState = 'suspended';
    const audioElement = { paused: true };
    harness.audioManager.ioManager.audioElement = audioElement;
    harness.audioManager.ioManager.playOutputBridgeForGesture = async () => {
      if (failedResource === 'bridge') throw new Error('bridge failed');
      audioElement.paused = false;
      return true;
    };
    harness.audioManager.ioManager.pauseOutputBridge = () => {
      audioElement.paused = true;
      return true;
    };
    if (failedResource === 'context') {
      harness.audioManager.contextManager.resumeForPowerPolicy = async () => false;
    } else if (failedResource === 'worklet') {
      harness.controller._applyWorkletState = async () => false;
    }

    assert.equal(
      await harness.controller.beginUserGestureResume('player-only-play'),
      false,
      failedResource
    );
    assert.equal(harness.context.state, 'suspended', failedResource);
    assert.equal(audioElement.paused, true, failedResource);
  }
});

test('a partial worklet resume failure restores the prior worklet command and telemetry state', async () => {
  const harness = createHarness();
  const primary = harness.audioManager.workletNode;
  const secondary = { port: { postMessage() {} } };
  const tokens = harness.controller._getTokensAndGuards().tokens;
  const priorStatus = node => harness.controller.handleWorkletPowerEvent({
    type: 'powerFirstRender',
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    inputActive: false,
    outputActive: false,
    inputPower: 0,
    outputPower: 0,
    commandId: 7,
    skipEpoch: 3,
    renderSequence: 8,
    workletGraphGeneration: tokens.workletGraphGeneration,
    topologyRevision: tokens.topologyRevision
  }, node);
  priorStatus(primary);
  priorStatus(secondary);
  harness.controller.effectiveState = 'monitoring';
  harness.controller.processingDirective = 'force-monitoring';
  harness.controller.dspUiActivityAllowed = false;
  harness.controller.uiPowerGateInitialized = true;
  harness.audioManager.getActivePowerWorklets = () => [primary, secondary];
  assert.deepEqual(harness.controller._captureWorkletCommandState(), {
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    skipEpoch: 3,
    uiTelemetryEnabled: false
  });
  const commandMessages = [];
  harness.audioManager.broadcastToActiveWorklets = message => {
    commandMessages.push(message);
    if (message.type !== 'setPowerProcessingState') return;
    const isResumeCommand = message.processingDirective === 'full-process';
    for (const [index, node] of [primary, secondary].entries()) {
      const processingDirective = isResumeCommand && index === 1
        ? 'force-monitoring'
        : message.processingDirective;
      queueMicrotask(() => harness.controller.handleWorkletPowerEvent({
        type: 'powerFirstRender',
        state: message.state,
        processingDirective,
        commandId: message.commandId,
        skipEpoch: message.skipEpoch,
        renderSequence: 9 + index,
        workletGraphGeneration: message.workletGraphGeneration,
        topologyRevision: message.topologyRevision
      }, node));
    }
  };

  assert.equal(
    await harness.controller.beginUserGestureResume('player-only-play'),
    false
  );

  const powerCommands = commandMessages.filter(message =>
    message.type === 'setPowerProcessingState'
  );
  const telemetryCommands = commandMessages.filter(message =>
    message.type === 'setUiTelemetryEnabled'
  );
  assert.deepEqual(powerCommands.map(message => [message.state, message.processingDirective]), [
    ['active', 'full-process'],
    ['monitoring', 'force-monitoring']
  ]);
  assert.deepEqual(telemetryCommands.map(message => message.enabled), [true, false]);
  assert.equal(powerCommands[1].skipEpoch, 4);
  assert.ok(powerCommands[1].skipEpoch > powerCommands[0].skipEpoch);
  assert.equal(harness.controller.effectiveState, 'MONITORING');
  assert.equal(harness.controller.processingDirective, 'force-monitoring');
  assert.equal(harness.controller.skipEpoch, 4);
  assert.equal(harness.controller.lastSkipCommandId, powerCommands[1].commandId);
  assert.equal(harness.controller.dspUiActivityAllowed, false);
  assert.equal(harness.controller.workletDirectiveResendRequired, false);
});

test('restoring full processing does not advance the skip epoch', async () => {
  const harness = createHarness();
  harness.controller.skipEpoch = 5;
  harness.controller.lastSkipCommandId = null;
  const coordinator = harness.controller._getTokensAndGuards();
  const restored = await harness.controller._restoreWorkletCommandState({
    state: 'active',
    processingDirective: 'full-process',
    skipEpoch: 3,
    uiTelemetryEnabled: true
  }, coordinator);

  assert.equal(restored, true);
  const command = harness.posted.findLast(message =>
    message.type === 'setPowerProcessingState');
  assert.equal(command.processingDirective, 'full-process');
  assert.equal(command.skipEpoch, 5);
  assert.equal(harness.controller.skipEpoch, 5);
  assert.equal(harness.controller.lastSkipCommandId, null);
});

test('failed skip rollback reservations are never reused', async () => {
  const harness = createHarness();
  const sentEpochs = [];
  harness.controller.skipEpoch = 1;
  harness.controller._waitForFirstRender = () => Promise.resolve(false);
  harness.controller._broadcast = message => {
    if (message.type === 'setPowerProcessingState') sentEpochs.push(message.skipEpoch);
  };
  const priorState = {
    state: 'monitoring',
    processingDirective: 'force-monitoring',
    skipEpoch: 3,
    uiTelemetryEnabled: false
  };
  const coordinator = harness.controller._getTokensAndGuards();

  assert.equal(await harness.controller._restoreWorkletCommandState(
    priorState,
    coordinator
  ), false);
  assert.equal(await harness.controller._restoreWorkletCommandState(
    priorState,
    coordinator
  ), false);
  assert.deepEqual(sentEpochs, [4, 5]);
  assert.equal(harness.controller.skipEpoch, 5);
  assert.equal(harness.controller.lastSkipCommandId, null);
});

test('skip rollback preserves only an unprepared temporal interval', async () => {
  for (const preserveHostSkipState of [true, false]) {
    const harness = createHarness();
    harness.controller.skipEpoch = 1;
    harness.controller.lastSkipCommandId = 7;
    harness.controller.suspendedTemporalTiming = {
      startedAtMonotonicMs: 0,
      endedAtMonotonicMs: 1000,
      sampleRate: 48000,
      skipEpoch: 1,
      topologyRevision: 0,
      workletGraphGeneration: 0
    };
    harness.controller.suspendedTemporalContinuity = true;
    harness.setNow(1300);
    const restored = await harness.controller._restoreWorkletCommandState({
      state: 'monitoring',
      processingDirective: 'force-monitoring',
      skipEpoch: 1,
      uiTelemetryEnabled: false
    }, harness.controller._getTokensAndGuards(), { preserveHostSkipState });

    assert.equal(restored, true);
    const rollback = harness.posted.findLast(message =>
      message.type === 'setPowerProcessingState');
    assert.equal(rollback.preserveHostSkipState, preserveHostSkipState);
    assert.equal(harness.controller.suspendedTemporalTiming.skipEpoch, 2);
    if (preserveHostSkipState) {
      assert.equal(harness.controller.suspendedTemporalTiming.startedAtMonotonicMs, 0);
      assert.equal(harness.controller.suspendedTemporalTiming.endedAtMonotonicMs, 1000);
    } else {
      assert.equal(harness.controller.suspendedTemporalTiming.startedAtMonotonicMs, 1300);
      assert.equal(harness.controller.suspendedTemporalTiming.endedAtMonotonicMs, 1300);
    }
  }
});

test('atomic resume selects the rollback baseline from preparation completion', async () => {
  for (const [resumeResult, expectedPreserve] of [
    ['temporal-resume-failed', true],
    ['temporal-resume-render-failed', false]
  ]) {
    const harness = createHarness();
    harness.controller.lastSkipCommandId = 7;
    harness.controller.skipEpoch = 1;
    harness.controller._captureWorkletCommandState = () => ({
      state: 'monitoring',
      processingDirective: 'force-monitoring',
      skipEpoch: 1,
      uiTelemetryEnabled: false
    });
    harness.controller._prepareTemporalStateAndResume = async () => resumeResult;
    let rollbackOptions = null;
    harness.controller._restoreWorkletCommandState = async (_prior, _coordinator, options) => {
      rollbackOptions = options;
      return true;
    };

    assert.equal(await harness.controller._applyWorkletState(
      'ACTIVE',
      'full-process',
      { restoreOnFailure: true }
    ), false);
    assert.deepEqual(rollbackOptions, { preserveHostSkipState: expectedPreserve });
  }
});

test('atomic resume replays one unconfirmed preparation without preserving a double-timeout interval', async () => {
  const pipeline = [{ id: 1, enabled: true, temporalCapability: 'reset-on-resume' }];
  {
    const harness = createHarness({ pipeline });
    const messages = [];
    harness.controller.lastSkipCommandId = 7;
    harness.controller.skipEpoch = 1;
    harness.audioManager.broadcastToActiveWorklets = message => messages.push(message);
    const resume = harness.controller._prepareTemporalStateAndResume(
      'power-replay',
      harness.controller._getTokensAndGuards(),
      8
    );
    await harness.flush();

    harness.setNow(1500);
    await harness.fireDueTimers();
    const attempts = messages.filter(message =>
      message.type === 'prepareTemporalStateAndResume');
    assert.equal(attempts.length, 2);
    const [{ ackCommandId: firstAckCommandId, ...firstIdentity },
      { ackCommandId: retryAckCommandId, ...retryIdentity }] = attempts;
    assert.notEqual(retryAckCommandId, firstAckCommandId);
    assert.deepEqual(retryIdentity, firstIdentity);

    const retry = attempts[1];
    harness.controller.handleWorkletPowerEvent({
      type: 'temporalStateResumed',
      state: 'acknowledged',
      origin: 'deliberate',
      ownerOperationId: retry.ownerOperationId,
      commandId: retry.commandId,
      resumeCommandId: retry.resumeCommandId,
      ackCommandId: retry.ackCommandId,
      skipEpoch: retry.skipEpoch,
      workletGraphGeneration: retry.workletGraphGeneration,
      topologyRevision: retry.topologyRevision,
      enabledPluginCount: 1,
      coveredPluginCount: 1,
      appliedPolicyCounts: {
        stateless: 0,
        resetOnResume: 1,
        agedBySkippedFrames: 0,
        mustProcess: 0
      },
      skippedFrameCount: 128,
      renderSequence: 1,
      errorCode: null
    }, harness.audioManager.workletNode);
    harness.controller.handleWorkletPowerEvent({
      type: 'powerFirstRender',
      commandId: retry.resumeCommandId,
      state: 'active',
      processingDirective: 'full-process',
      inputActive: false,
      outputActive: false,
      inputPower: 0,
      outputPower: 0,
      workletGraphGeneration: retry.workletGraphGeneration,
      topologyRevision: retry.topologyRevision,
      renderSequence: 2,
      skippedFrameCount: 0
    }, harness.audioManager.workletNode);
    assert.equal(await resume, true);
    assert.equal(harness.controller.statePreparation.state, 'acknowledged');
  }

  {
    const harness = createHarness({ pipeline });
    const messages = [];
    harness.controller.lastSkipCommandId = 7;
    harness.controller.skipEpoch = 1;
    harness.controller.effectiveState = 'monitoring';
    harness.controller.processingDirective = 'force-monitoring';
    harness.controller.suspendedTemporalTiming = {
      startedAtMonotonicMs: 0,
      endedAtMonotonicMs: 1000,
      sampleRate: 48000,
      skipEpoch: 1,
      topologyRevision: 0,
      workletGraphGeneration: 0
    };
    harness.controller._captureWorkletCommandState = () => ({
      state: 'monitoring',
      processingDirective: 'force-monitoring',
      skipEpoch: 1,
      uiTelemetryEnabled: false
    });
    harness.audioManager.broadcastToActiveWorklets = message => {
      messages.push(message);
      if (message.type !== 'setPowerProcessingState') return;
      queueMicrotask(() => harness.controller.handleWorkletPowerEvent({
        type: 'powerFirstRender',
        commandId: message.commandId,
        skipEpoch: message.skipEpoch,
        state: message.state,
        processingDirective: message.processingDirective,
        inputActive: false,
        outputActive: false,
        inputPower: 0,
        outputPower: 0,
        workletGraphGeneration: message.workletGraphGeneration,
        topologyRevision: message.topologyRevision,
        renderSequence: 1,
        skippedFrameCount: 0
      }, harness.audioManager.workletNode));
    };

    const resume = harness.controller._applyWorkletState(
      'ACTIVE',
      'full-process',
      { restoreOnFailure: true }
    );
    await harness.flush();
    harness.setNow(1500);
    await harness.fireDueTimers();
    harness.setNow(3000);
    await harness.fireDueTimers();

    assert.equal(await resume, false);
    assert.equal(messages.filter(message =>
      message.type === 'prepareTemporalStateAndResume').length, 2);
    const rollback = messages.findLast(message =>
      message.type === 'setPowerProcessingState');
    assert.equal(rollback.preserveHostSkipState, false);
    assert.equal(harness.controller.suspendedTemporalTiming.startedAtMonotonicMs, 3000);
    assert.equal(harness.controller.suspendedTemporalTiming.endedAtMonotonicMs, 3000);
  }
});

test('an unresolvable partial worklet resume schedules directive reconciliation', async () => {
  const harness = createHarness();
  const primary = harness.audioManager.workletNode;
  const secondary = { port: { postMessage() {} } };
  const reconcileReasons = [];
  harness.audioManager.getActivePowerWorklets = () => [primary, secondary];
  harness.audioManager.broadcastToActiveWorklets = message => {
    if (message.type !== 'setPowerProcessingState') return;
    for (const [index, node] of [primary, secondary].entries()) {
      queueMicrotask(() => harness.controller.handleWorkletPowerEvent({
        type: 'powerFirstRender',
        state: message.state,
        processingDirective: index === 0
          ? message.processingDirective
          : 'force-monitoring',
        commandId: message.commandId,
        skipEpoch: message.skipEpoch,
        renderSequence: 1 + index,
        workletGraphGeneration: message.workletGraphGeneration,
        topologyRevision: message.topologyRevision
      }, node));
    }
  };
  harness.controller.requestReconcile = reason => {
    reconcileReasons.push(reason);
    return Promise.resolve();
  };

  assert.equal(
    await harness.controller.beginUserGestureResume('player-only-play'),
    false
  );
  assert.equal(harness.controller.workletDirectiveResendRequired, true);
  assert.ok(reconcileReasons.includes('failed-worklet-command-rollback'));
});

test('automatic playback continuation never starts a gesture resume', async () => {
  const harness = createHarness({ contextState: 'suspended' });
  harness.controller.effectiveState = 'suspended';
  let gestureResumeCount = 0;
  harness.controller.beginUserGestureResume = () => {
    gestureResumeCount++;
    return Promise.resolve(true);
  };

  assert.equal(await harness.controller.ensureActiveForAutomaticPlayback(), false);
  assert.equal(gestureResumeCount, 0);
  assert.equal(harness.context.state, 'suspended');
});

test('automatic playback continuation accepts a running context while monitoring settles', async () => {
  const harness = createHarness();
  let gestureResumeCount = 0;
  harness.controller.beginUserGestureResume = () => {
    gestureResumeCount++;
    return Promise.resolve(true);
  };

  harness.controller.effectiveState = 'ACTIVE';
  harness.controller.processingDirective = 'allow-automatic';
  assert.equal(await harness.controller.ensureActiveForAutomaticPlayback(), true);

  harness.controller.effectiveState = 'MONITORING';
  assert.equal(await harness.controller.ensureActiveForAutomaticPlayback(), true);

  harness.context.state = 'suspended';
  assert.equal(await harness.controller.ensureActiveForAutomaticPlayback(), false);
  assert.equal(gestureResumeCount, 0);
});

test('a partial gesture resume rolls acquired input back without clearing the release journal', async () => {
  for (const failedResource of ['context', 'bridge', 'host-guard', 'atomic-resume']) {
    const harness = createHarness({
      input: {
        state: 'live',
        inputAvailability: 'available',
        inputAvailabilityRevision: 1,
        inputGeneration: 3,
        inputResourceId: 'mic-1',
        inputConfigured: true,
        inputSourcePresent: true,
        trackState: 'live'
      }
    });
    await harness.controller.start();
    await harness.flush();
    assert.equal(await harness.controller.requestInputRelease(
      currentRoutedReleaseRequest(harness)
    ), true);
    harness.controller.effectiveState = 'suspended';
    harness.context.state = 'suspended';
    let rollbackReleaseCount = 0;
    const originalRelease = harness.audioManager.ioManager.releaseAudioInput.bind(
      harness.audioManager.ioManager
    );
    harness.audioManager.ioManager.releaseAudioInput = options => {
      rollbackReleaseCount++;
      return originalRelease(options);
    };
    if (failedResource === 'context') {
      harness.audioManager.contextManager.resumeForPowerPolicy = async () => false;
    } else if (failedResource === 'bridge') {
      harness.audioManager.ioManager.playOutputBridgeForGesture = () =>
        Promise.reject(new Error('bridge failed'));
    } else {
      harness.controller.lastSkipCommandId = 10;
      harness.controller.skipEpoch = 2;
      harness.controller._ensureHostGuardRendered = async () =>
        failedResource !== 'host-guard';
      harness.controller._applyWorkletState = async () =>
        failedResource !== 'atomic-resume';
    }

    assert.equal(await harness.controller.beginUserGestureResume('dedicated-input'), false);
    const snapshot = harness.controller.getSnapshot();
    assert.equal(rollbackReleaseCount, 1, failedResource);
    assert.equal(harness.inputState.state, 'released', failedResource);
    assert.equal(
      harness.controller._getTokensAndGuards().tokens.inputGeneration,
      harness.inputState.inputGeneration,
      failedResource
    );
    assert.equal(snapshot.manualResumeRequired, true, failedResource);
    assert.equal(snapshot.resourceStatus.persistence.journalPhase, 'committed', failedResource);
    assert.equal(
      harness.audioManager.isSourceConnectedToPipeline(
        harness.audioManager.ioManager._silentSourceNode
      ),
      true,
      failedResource
    );
  }
});

test('an unrelated recovery gesture is a no-op while audio is already active', async () => {
  const harness = createHarness();
  await harness.controller.start();
  await harness.flush();
  const initialState = harness.controller.getEffectiveState();
  assert.notEqual(initialState, 'SUSPENDED');
  assert.equal(harness.context.state, 'running');
  const postedBefore = harness.posted.length;
  const eventsBefore = harness.events.length;

  assert.equal(await harness.controller.beginUserGestureResume('unexpected-recovery'), true);
  await harness.flush();

  assert.equal(harness.posted.length, postedBefore);
  assert.equal(harness.events.length, eventsBefore);
  assert.equal(harness.context.state, 'running');
  assert.equal(harness.controller.getEffectiveState(), initialState);
  assert.equal(harness.controller.getSnapshot().transition.state, 'stable');
});

test('public events use detail and share one exact snapshot reference', async () => {
  const harness = createHarness({
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 3,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });

  await harness.controller.start();
  assert.equal(harness.controller.getSnapshot().suspendCause, null);
  const released = await harness.controller.requestInputRelease(
    currentRoutedReleaseRequest(harness)
  );
  assert.equal(released, true);

  const inputEvent = harness.events.find(item => item.name === 'audioInputChanged');
  const resumeEvent = harness.events.find(item => item.name === 'powerResumeRequired');
  assert.ok(inputEvent);
  assert.ok(resumeEvent);
  assert.deepEqual(Object.keys(inputEvent.event), ['detail']);
  assert.deepEqual(Object.keys(resumeEvent.event), ['detail']);
  assert.equal(inputEvent.event.detail.changedResource, 'input');
  assert.equal(validatePowerSnapshot(inputEvent.event.detail.snapshot), true);
  assert.strictEqual(resumeEvent.event.detail.snapshot, inputEvent.event.detail.snapshot);

  const matchingPowerEvent = harness.events.find(item =>
    item.name === 'powerStateChanged' &&
    item.event.detail === inputEvent.event.detail.snapshot
  );
  assert.ok(matchingPowerEvent);
  assert.deepEqual(Object.keys(matchingPowerEvent.event), ['detail']);
});

test('automatic input release stops the local input and records its resume latch', async () => {
  const harness = createHarness({
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 3,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  let stoppedTrackCount = 0;
  const originalRelease = harness.audioManager.ioManager.releaseAudioInput;
  harness.audioManager.ioManager.releaseAudioInput = function (releaseOptions) {
    const result = originalRelease.call(this, releaseOptions);
    stoppedTrackCount += result.stoppedTrackCount;
    return result;
  };

  await harness.controller.start();
  const released = await harness.controller.requestInputRelease(
    currentRoutedReleaseRequest(harness)
  );
  const snapshot = harness.controller.getSnapshot();
  assert.equal(released, true);
  assert.equal(harness.inputState.state, 'released');
  assert.equal(stoppedTrackCount, 1);
  assert.equal(snapshot.manualResumeRequired, true);
  assert.equal(snapshot.transitionError.code, null);
  assert.equal(snapshot.resourceStatus.persistence.journalPhase, 'committed');
});

test('automatic monitoring arm is public only after every active worklet agrees', () => {
  const harness = createHarness();
  const primary = harness.audioManager.workletNode;
  const secondary = { port: { postMessage() {} } };
  harness.audioManager.getActivePowerWorklets = () => [primary, secondary];
  const arm = {
    state: 'armed',
    commandId: 41,
    skipEpoch: 7,
    armAfterRenderSequence: 19
  };
  const ack = automaticMonitoringArm => ({
    type: 'powerStateAck',
    commandId: 41,
    workletGraphGeneration: 0,
    topologyRevision: 0,
    automaticMonitoringArm
  });

  assert.equal(harness.controller.handleWorkletPowerEvent(ack(arm), primary), true);
  assert.equal(
    harness.controller.getSnapshot().resourceStatus.worklets.automaticMonitoringArm.state,
    'disarmed'
  );
  assert.equal(harness.controller.handleWorkletPowerEvent(ack({
    ...arm,
    skipEpoch: arm.skipEpoch + 1
  }), secondary), true);
  assert.equal(
    harness.controller.getSnapshot().resourceStatus.worklets.automaticMonitoringArm.state,
    'disarmed'
  );

  assert.equal(harness.controller.handleWorkletPowerEvent(ack(arm), secondary), true);
  assert.deepEqual(
    harness.controller.getSnapshot().resourceStatus.worklets.automaticMonitoringArm,
    arm
  );
});

test('controller is enabled by default with proof capabilities and honors overrides', () => {
  const makeWindow = (overrides = {}) => ({
    appConfig: {},
    location: { search: '' },
    localStorage: { getItem() { return null; } },
    sessionStorage: { getItem() { return null; }, setItem() {} },
    crypto: { randomUUID: () => 'id' },
    ...overrides
  });
  const make = windowRef => new PowerPolicyController({}, {
    windowRef,
    documentRef: { hidden: false },
    setTimeoutFn() { return 1; },
    clearTimeoutFn() {}
  });

  // Capability detection is the default: no explicit opt-in required.
  assert.equal(make(makeWindow()).isControllerEnabled(), true);
  // The Electron renderer is no longer force-disabled.
  assert.equal(make(makeWindow({ electronAPI: {} })).isControllerEnabled(), true);
  // URL override.
  assert.equal(make(makeWindow({
    location: { search: '?powerPolicy=1' }
  })).isControllerEnabled(), true);
  assert.equal(make(makeWindow({
    location: { search: '?powerPolicy=0' }
  })).isControllerEnabled(), false);
  // Config flag: explicit false disables, explicit true stays enabled.
  assert.equal(make(makeWindow({
    appConfig: { powerPolicyEnabled: true }
  })).isControllerEnabled(), true);
  assert.equal(make(makeWindow({
    appConfig: { powerPolicyEnabled: false }
  })).isControllerEnabled(), false);
  // URL override beats the config flag in both directions.
  assert.equal(make(makeWindow({
    appConfig: { powerPolicyEnabled: true },
    location: { search: '?powerPolicy=0' }
  })).isControllerEnabled(), false);
  assert.equal(make(makeWindow({
    appConfig: { powerPolicyEnabled: false },
    location: { search: '?powerPolicy=1' }
  })).isControllerEnabled(), true);
  // The local release journal is the only required persistence capability.
  assert.equal(make(makeWindow({ indexedDB: undefined, navigator: undefined }))
    .isControllerEnabled(), true);
  const noCapabilities = makeWindow();
  delete noCapabilities.sessionStorage;
  assert.equal(make(noCapabilities).isControllerEnabled(), false);
  const noCapabilitiesOptIn = makeWindow({ appConfig: { powerPolicyEnabled: true } });
  delete noCapabilitiesOptIn.sessionStorage;
  assert.equal(make(noCapabilitiesOptIn).isControllerEnabled(), false);
  // The kill switch always wins, even over an explicit URL opt-in.
  assert.equal(make(makeWindow({
    localStorage: { getItem(key) {
      return key === 'effetune_power_policy_kill_switch' ? '1' : null;
    } }
  })).isControllerEnabled(), false);
  assert.equal(make(makeWindow({
    location: { search: '?powerPolicy=1' },
    localStorage: { getItem(key) {
      return key === 'effetune_power_policy_kill_switch' ? '1' : null;
    } }
  })).isControllerEnabled(), false);
});

test('selecting no-audio-input without a live resource never starts a release transaction', async () => {
  const harness = createHarness({
    inputDeviceId: NO_AUDIO_INPUT_DEVICE_ID,
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 2,
      inputGeneration: 4,
      inputResourceId: null,
      inputConfigured: false,
      inputSourcePresent: false,
      trackState: 'absent'
    }
  });
  await harness.controller.start();
  await harness.flush();
  await harness.controller.requestReconcile('heartbeat-1');
  await harness.controller.requestReconcile('heartbeat-2');
  const snapshot = harness.controller.getSnapshot();
  assert.equal(harness.controller.lastDecision.shouldReleaseInput, false);
  assert.equal(harness.controller.lastDecision.inputReleaseRequest, null);
  assert.equal(snapshot.transitionError.code, null);
  assert.equal(harness.inputState.inputGeneration, 4);
  assert.equal(snapshot.resourceStatus.persistence.journalPhase, null);
});

test('unexpected context recovery resends the worklet directive through reconcile', async () => {
  const player = createPausedPlayer();
  const harness = createHarness();
  await harness.controller.start();
  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline');
  assert.equal(harness.controller.getEffectiveState(), 'SUSPENDED');
  assert.equal(harness.context.state, 'suspended');

  player.snapshot.isPlaying = true;
  player.snapshot.isPaused = false;
  harness.controller.attachPlayer(player.instance);
  harness.setNow(16_000);
  harness.context.state = 'running';
  const postedBefore = harness.posted.length;
  harness.controller.handleContextStateChange({ state: 'running' });
  await harness.controller.requestReconcile('after-recovery');
  await harness.flush();
  assert.equal(harness.controller.getEffectiveState(), 'ACTIVE');
  const atomicResume = harness.posted.slice(postedBefore).find(message =>
    message.type === 'prepareTemporalStateAndResume');
  assert.ok(atomicResume);
  assert.equal(atomicResume.suspendedElapsedMs, 1000);
});

test('unexpected recovery while suspension is still desired re-suspends the context', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline');
  assert.equal(harness.context.state, 'suspended');

  harness.context.state = 'running';
  harness.controller.handleContextStateChange({ state: 'running' });
  await harness.controller.requestReconcile('after-recovery');
  await harness.flush();
  assert.equal(harness.context.state, 'suspended');
  assert.equal(harness.controller.getEffectiveState(), 'SUSPENDED');
});

test('failed unexpected-recovery suspension defers input release until a later retry succeeds', async () => {
  for (const failureMode of ['false', 'throw']) {
    const harness = createHarness({
      settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
      input: {
        state: 'live',
        inputAvailability: 'available',
        inputAvailabilityRevision: 1,
        inputGeneration: 5,
        inputResourceId: 'mic-1',
        inputConfigured: true,
        inputSourcePresent: true,
        trackState: 'live'
      }
    });
    await harness.controller.start();
    harness.controller.documentRef.hidden = true;
    harness.controller.handlePageLifecycleEvent('visibilitychange', { hidden: true });
    await harness.flush();
    harness.setNow(60_000);
    harness.controller.effectiveState = 'SUSPENDED';
    harness.controller.processingDirective = 'suspended';
    harness.controller.workletDirectiveResendRequired = true;
    harness.context.state = 'running';

    const beforeFailure = harness.controller.getSnapshot();
    const inputGeneration = harness.inputState.inputGeneration;
    let releaseCount = 0;
    const releaseAudioInput = harness.audioManager.ioManager.releaseAudioInput.bind(
      harness.audioManager.ioManager
    );
    harness.audioManager.ioManager.releaseAudioInput = (...args) => {
      releaseCount++;
      return releaseAudioInput(...args);
    };

    let suspendAttempts = 0;
    let allowSuspend = false;
    harness.audioManager.contextManager.suspendForPowerPolicy = async () => {
      suspendAttempts++;
      if (!allowSuspend) {
        if (failureMode === 'throw') throw new Error('suspend failed');
        return false;
      }
      await harness.context.suspend();
      return true;
    };
    await harness.controller.requestReconcile(`failed-${failureMode}`);

    const failedSnapshot = harness.controller.getSnapshot();
    assert.ok(suspendAttempts >= 1, failureMode);
    assert.equal(harness.context.state, 'running', failureMode);
    assert.equal(harness.controller.workletDirectiveResendRequired, true, failureMode);
    assert.equal(failedSnapshot.transitionError.code, 'audio-context-suspend-failed', failureMode);
    assert.equal(failedSnapshot.transitionError.recoverable, true, failureMode);
    assert.equal(failedSnapshot.resourceHealth, 'degraded', failureMode);
    assert.equal(releaseCount, 0, failureMode);
    assert.equal(harness.inputState.state, 'live', failureMode);
    assert.equal(harness.inputState.inputGeneration, inputGeneration, failureMode);
    assert.equal(
      failedSnapshot.resourceStatus.persistence.journalPhase,
      beforeFailure.resourceStatus.persistence.journalPhase,
      failureMode
    );
    assert.equal(failedSnapshot.manualResumeRequired, beforeFailure.manualResumeRequired, failureMode);

    const attemptsBeforeRetry = suspendAttempts;
    allowSuspend = true;
    await harness.controller.requestReconcile(`retry-${failureMode}`);
    const recoveredSnapshot = harness.controller.getSnapshot();
    assert.ok(suspendAttempts > attemptsBeforeRetry, failureMode);
    assert.equal(harness.context.state, 'suspended', failureMode);
    assert.equal(harness.controller.workletDirectiveResendRequired, false, failureMode);
    assert.equal(recoveredSnapshot.transitionError.code, null, failureMode);
    assert.equal(releaseCount, 1, failureMode);
    assert.equal(harness.inputState.state, 'released', failureMode);
    assert.equal(harness.inputState.inputGeneration, inputGeneration + 1, failureMode);
    assert.equal(recoveredSnapshot.resourceStatus.persistence.journalPhase, 'committed', failureMode);
    assert.equal(recoveredSnapshot.manualResumeRequired, true, failureMode);
  }
});

test('directive resend during an in-progress gesture resume defers instead of re-suspending', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline');
  assert.equal(harness.context.state, 'suspended');

  harness.context.state = 'running';
  harness.controller.gestureResumeInProgress = 1;
  harness.controller.handleContextStateChange({ state: 'running' });
  await harness.controller.requestReconcile('after-recovery');
  await harness.flush();
  assert.equal(harness.context.state, 'running');
  assert.equal(harness.controller.workletDirectiveResendRequired, true);
  assert.equal(harness.controller.getEffectiveState(), 'SUSPENDED');

  harness.controller.gestureResumeInProgress = 0;
  await harness.controller.requestReconcile('after-gesture');
  await harness.flush();
  assert.equal(harness.context.state, 'suspended');
});

test('an in-progress gesture resume aborts a queued suspend commitment', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.controller.gestureResumeInProgress = 1;
  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline');
  assert.equal(harness.context.state, 'running');
  assert.notEqual(harness.controller.getEffectiveState(), 'SUSPENDED');

  harness.controller.gestureResumeInProgress = 0;
  await harness.controller.requestReconcile('deadline-retry');
  assert.equal(harness.context.state, 'suspended');

  const resumed = await harness.controller.requestResumeFromUserGesture('player-only-play');
  await harness.flush();
  assert.equal(resumed, true);
  assert.equal(harness.controller.gestureResumeInProgress, 0);
});

test('a gesture arriving while AudioContext suspension is pending rolls the suspension back', async () => {
  const harness = createHarness();
  await harness.controller.start();
  let suspendedCommitCount = 0;
  harness.audioManager.powerDiagnostics.recordEffectiveCommit = () => {
    if (harness.controller.getEffectiveState() === 'SUSPENDED') suspendedCommitCount++;
  };
  let notifySuspendStarted;
  let finishSuspend;
  const suspendStarted = new Promise(resolve => { notifySuspendStarted = resolve; });
  const suspendGate = new Promise(resolve => { finishSuspend = resolve; });
  harness.audioManager.contextManager.suspendForPowerPolicy = async () => {
    notifySuspendStarted();
    await suspendGate;
    harness.context.state = 'suspended';
    return true;
  };

  harness.setNow(15_000);
  const suspending = harness.controller.requestReconcile('deadline');
  await suspendStarted;

  const resuming = harness.controller.requestResumeFromUserGesture('player-only-play');
  await harness.flush();
  finishSuspend();
  await suspending;
  const resumed = await resuming;
  await harness.flush();

  assert.equal(resumed, true);
  assert.equal(harness.context.state, 'running');
  assert.notEqual(harness.controller.getEffectiveState(), 'SUSPENDED');
  assert.notEqual(harness.controller.getSnapshot().processingDirective, 'suspended');
  assert.equal(harness.controller.gestureResumeInProgress, 0);
  assert.equal(suspendedCommitCount, 0);
});

test('ensureActive does not bypass a pending non-full-process transition', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.controller.effectiveState = 'ACTIVE';
  harness.controller.processingDirective = 'force-monitoring';
  harness.controller._setTransition('suspending', 'power-test');
  let resumeKind = null;
  harness.controller.beginUserGestureResume = kind => {
    resumeKind = kind;
    return Promise.resolve(true);
  };

  assert.equal(await harness.controller.ensureActive('player-only-play'), true);
  assert.equal(resumeKind, 'player-only-play');
});

test('topology change during a pending transition settles without a false render timeout', async () => {
  const harness = createHarness();
  let drop = true;
  const original = harness.audioManager.broadcastToActiveWorklets.bind(harness.audioManager);
  harness.audioManager.broadcastToActiveWorklets = message => {
    if (drop && message.type === 'setPowerProcessingState') return;
    original(message);
  };
  const pending = harness.controller.start();
  await harness.flush();
  drop = false;
  harness.controller.notifyTopologyChanged('test-topology');
  await pending;
  await harness.flush();
  const snapshot = harness.controller.getSnapshot();
  assert.notEqual(snapshot.transitionError.code, 'worklet-render-timeout');
  assert.equal(snapshot.transition.state, 'stable');
});

test('a topology notification invalidates evidence before publishing the mutation', async () => {
  const harness = createHarness();
  await harness.controller.start();
  await harness.flush();
  const seeded = seedTopologyBoundPowerEvidence(harness);
  let evidenceAtAdoption = null;
  harness.audioManager.adoptPowerMutation = mutation => {
    if (mutation.receipt.mutationKind === 'route-topology-commit') {
      evidenceAtAdoption = captureTopologyBoundPowerEvidence(harness.controller);
    }
  };

  harness.controller.notifyTopologyChanged('test-topology-evidence');

  assert.ok(evidenceAtAdoption);
  assertTopologyBoundPowerEvidenceInvalidated(evidenceAtAdoption, seeded);
  await harness.flush();
});

test('worklet mutations give file and input playback the same master bypass cycle', async () => {
  const player = createPausedPlayer();
  player.snapshot.isPlaying = true;
  player.snapshot.isPaused = false;
  const pipeline = [{ id: 1, enabled: true, temporalCapability: 'stateless' }];
  const cases = [
    ['file', createHarness({ player, pipeline })],
    ['input', createHarness({
      pipeline,
      input: {
        state: 'live',
        inputAvailability: 'available',
        inputAvailabilityRevision: 1,
        inputGeneration: 1,
        inputResourceId: 'master-toggle-input',
        inputConfigured: true,
        inputSourcePresent: true,
        trackState: 'live'
      }
    })]
  ];

  for (const [sourceKind, harness] of cases) {
    await harness.controller.start();
    await harness.flush();

    harness.audioManager.masterBypass = true;
    harness.controller.notifyTopologyChanged('pipeline-master-bypass', {
      resetWorkletTemporalState: true
    });
    await harness.flush();
    assert.equal(
      harness.controller.processingDirective,
      'bypass-transport',
      `${sourceKind} bypass`
    );
    assert.notEqual(harness.controller.lastSkipCommandId, null, `${sourceKind} skip command`);

    const bypassSkipEpoch = harness.controller.skipEpoch;
    harness.audioManager.masterBypass = false;
    harness.controller.notifyTopologyChanged('pipeline-master-bypass', {
      resetWorkletTemporalState: true
    });

    assert.equal(harness.controller.lastSkipCommandId, null, `${sourceKind} reset command`);
    assert.equal(
      harness.controller.skipEpoch,
      bypassSkipEpoch + 1,
      `${sourceKind} reset epoch`
    );
    await harness.flush();
    assert.equal(harness.controller.processingDirective, 'full-process', `${sourceKind} resume`);
    assert.equal(harness.controller.getDspUiActivityAllowed(), true, `${sourceKind} UI gate`);
    assert.ok(harness.posted.some(message =>
      message.type === 'setUiTelemetryEnabled' && message.enabled === true
    ), `${sourceKind} telemetry resume`);
  }
});

test('a worklet graph replacement also resets temporal skip lineage', async () => {
  const harness = createHarness();
  await harness.controller.start();
  await harness.flush();
  const seeded = seedTopologyBoundPowerEvidence(harness);
  let evidenceAtAdoption = null;
  harness.audioManager.adoptPowerMutation = mutation => {
    if (mutation.receipt.mutationKind === 'graph-replacement') {
      evidenceAtAdoption = captureTopologyBoundPowerEvidence(harness.controller);
    }
  };

  harness.controller.handleWorkletGraphReplacement();

  assert.ok(evidenceAtAdoption);
  assertTopologyBoundPowerEvidenceInvalidated(evidenceAtAdoption, seeded, {
    temporalStateReset: true
  });
  await harness.flush();
});

test('topology changes restart the no-route idle clock from fresh observation', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.setNow(10_000);
  await harness.controller.requestReconcile('mid-idle');
  harness.controller.notifyTopologyChanged('plugin-added');
  await harness.flush();
  await harness.controller.requestReconcile('after-topology');
  assert.equal(harness.controller.noRouteIdleSinceEpochMs, 10_000);

  harness.setNow(15_000);
  await harness.controller.requestReconcile('old-deadline');
  assert.equal(harness.context.state, 'running');

  harness.setNow(25_000);
  await harness.controller.requestReconcile('new-deadline');
  assert.equal(harness.context.state, 'suspended');
});

test('no-route idle clock requires fresh silence from both pipeline input and output', async () => {
  const harness = createHarness();
  await harness.controller.start();
  const initialObservation = { ...harness.controller.workletObservation };
  let renderSequence = initialObservation.renderSequence;
  const setFreshActivity = (inputActive, outputActive) => {
    harness.controller.workletObservation = {
      ...initialObservation,
      inputActive,
      outputActive,
      renderSequence: ++renderSequence
    };
  };

  assert.equal(harness.controller.noRouteIdleSinceEpochMs, 0);

  harness.setNow(1_000);
  setFreshActivity(true, false);
  await harness.controller.requestReconcile('input-active');
  assert.equal(harness.controller.noRouteIdleSinceEpochMs, null);

  harness.setNow(2_000);
  setFreshActivity(false, true);
  await harness.controller.requestReconcile('output-active');
  assert.equal(harness.controller.noRouteIdleSinceEpochMs, null);

  harness.setNow(3_000);
  harness.controller.workletObservation = null;
  await harness.controller.requestReconcile('observation-unknown');
  assert.equal(harness.controller.noRouteIdleSinceEpochMs, null);

  harness.setNow(4_000);
  setFreshActivity(false, false);
  await harness.controller.requestReconcile('pipeline-silent');
  assert.equal(harness.controller.noRouteIdleSinceEpochMs, 4_000);
});

test('autoplay-suspended startup recovers on the first successful gesture without a false timeout', async () => {
  const harness = createHarness({
    contextState: 'suspended',
    workletSilentWhileSuspended: true
  });
  const startPromise = harness.controller.start();
  await harness.flush();
  harness.setNow(1600);
  await harness.fireDueTimers();
  await startPromise;
  await harness.flush();

  let snapshot = harness.controller.getSnapshot();
  assert.equal(snapshot.transitionError.code, null);
  assert.equal(harness.context.state, 'suspended');

  harness.setNow(20_000);
  const resumed = await harness.controller.ensureActive('route-activation');
  await harness.flush();
  assert.equal(resumed, true);
  assert.notEqual(harness.context.state, 'closed');

  await harness.controller.requestReconcile('after-gesture');
  await harness.flush();
  snapshot = harness.controller.getSnapshot();
  assert.equal(snapshot.transitionError.code, null);
  assert.equal(snapshot.manualResumeRequired, false);
  assert.notEqual(snapshot.resourceHealth, 'blocked');
});

test('a stale recoverable transition error clears once the policy settles with healthy evidence', async () => {
  const harness = createHarness();
  await harness.controller.start();
  await harness.flush();
  harness.controller.transitionError = {
    code: 'input-release-failed',
    message: 'stale',
    operationId: 'op-1',
    recoverable: true
  };

  await harness.controller.requestReconcile('steady');
  await harness.flush();
  assert.equal(harness.controller.getSnapshot().transitionError.code, null);
});

test('a stale recoverable transition error clears during an automatic suspend', async () => {
  const harness = createHarness();
  await harness.controller.start();
  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline');
  assert.equal(harness.controller.getEffectiveState(), 'SUSPENDED');
  harness.controller.transitionError = {
    code: 'resume-resource-failed',
    message: 'stale',
    operationId: null,
    recoverable: true
  };

  await harness.controller.requestReconcile('suspended-steady');
  const snapshot = harness.controller.getSnapshot();
  assert.equal(snapshot.transitionError.code, null);
  assert.equal(snapshot.manualResumeRequired, false);
});

test('silent fallback uses common routed-silence processing and never demands a microphone', async () => {
  const harness = createHarness({
    inputDeviceId: NO_AUDIO_INPUT_DEVICE_ID,
    silentInputConnected: true
  });
  let reacquireCount = 0;
  harness.audioManager.ioManager.beginReacquireAudioInput = () => {
    reacquireCount++;
    return Promise.reject(new Error('microphone must not be requested'));
  };
  await harness.controller.start();
  harness.setNow(14_999);
  await harness.controller.requestReconcile('before-deadline');
  assert.equal(harness.controller.getEffectiveState(), 'ACTIVE');
  assert.equal(harness.controller.getDspUiActivityAllowed(), true);
  assert.equal(harness.context.state, 'running');
  assert.equal(harness.controller.noRouteIdleSinceEpochMs, null);
  assert.notEqual(harness.controller.lastDecision.reason, 'idle-no-route');

  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline');
  assert.notEqual(harness.controller.getEffectiveState(), 'SUSPENDED');
  assert.equal(harness.context.state, 'running');

  const resumed = await harness.controller.requestResumeFromUserGesture('dedicated-input');
  await harness.flush();
  const snapshot = harness.controller.getSnapshot();
  assert.equal(resumed, true);
  assert.equal(reacquireCount, 0);
  assert.equal(snapshot.transitionError.code, null);
  assert.equal(snapshot.manualResumeRequired, false);
  assert.notEqual(snapshot.resourceHealth, 'blocked');
  assert.equal(harness.context.state, 'running');
});

test('an explicit input resume clears the manual latch when the input is already live', async () => {
  const harness = createHarness({
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 3,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  harness.controller.manualResumeRequired = true;

  const resumed = await harness.controller.requestResumeFromUserGesture('dedicated-input');
  await harness.flush();
  assert.equal(resumed, true);
  assert.equal(harness.controller.getSnapshot().manualResumeRequired, false);
});

test('mixed playback resume reacquires a released configured input', async () => {
  const player = createPausedPlayer();
  player.useInputWithPlayer = true;
  player.instance.contextManager.getUseInputWithPlayer = () => true;
  const harness = createHarness({
    player,
    inputDeviceId: 'mic',
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 2,
      inputGeneration: 4,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  let reacquireCount = 0;
  const originalReacquire = harness.audioManager.ioManager.beginReacquireAudioInput
    .bind(harness.audioManager.ioManager);
  harness.audioManager.ioManager.beginReacquireAudioInput = () => {
    reacquireCount++;
    return originalReacquire();
  };
  await harness.controller.start();
  harness.controller.manualResumeRequired = true;

  const resumed = await harness.controller.requestResumeFromUserGesture('mixed-play');
  await harness.flush();

  assert.equal(resumed, true);
  assert.equal(reacquireCount, 1);
  assert.equal(harness.inputState.state, 'live');
  assert.equal(harness.controller.getSnapshot().manualResumeRequired, false);
});

test('user interaction resumes the current route and restores a released routed input', async () => {
  const harness = createHarness({
    inputDeviceId: 'mic',
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 2,
      inputGeneration: 4,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  let reacquireCount = 0;
  const originalReacquire = harness.audioManager.ioManager.beginReacquireAudioInput
    .bind(harness.audioManager.ioManager);
  harness.audioManager.ioManager.beginReacquireAudioInput = () => {
    reacquireCount++;
    return originalReacquire();
  };
  await harness.controller.start();
  harness.controller.manualResumeRequired = true;

  const resumed = await harness.controller.requestResumeFromUserInteraction();
  await harness.flush();

  assert.equal(resumed, true);
  assert.equal(reacquireCount, 1);
  assert.equal(harness.inputState.state, 'live');
  assert.equal(harness.controller.getSnapshot().manualResumeRequired, false);
});

test('user interaction reuses the existing resume kind for each current route', async () => {
  const input = {
    state: 'live',
    inputAvailability: 'available',
    inputAvailabilityRevision: 1,
    inputGeneration: 1,
    inputResourceId: 'mic-1',
    inputConfigured: true,
    inputSourcePresent: true,
    trackState: 'live'
  };
  const external = createHarness({ input: { ...input } });
  const player = createPausedPlayer();
  const playerOnly = createHarness({ player, input: { ...input } });
  const mixedPlayer = createPausedPlayer();
  mixedPlayer.useInputWithPlayer = true;
  mixedPlayer.instance.contextManager.getUseInputWithPlayer = () => true;
  const mixed = createHarness({ player: mixedPlayer, input: { ...input } });

  for (const [harness, expectedKind] of [
    [external, 'dedicated-input'],
    [playerOnly, 'route-activation'],
    [mixed, 'mixed-play']
  ]) {
    let actualKind = null;
    harness.controller.ensureActive = kind => {
      actualKind = kind;
      return Promise.resolve(true);
    };
    assert.equal(await harness.controller.requestResumeFromUserInteraction(), true);
    assert.equal(actualKind, expectedKind);
  }
});

test('the maximum-policy input release latch clears after the dedicated-input resume gesture', async () => {
  const player = createPausedPlayer();
  const harness = createHarness({
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
    player,
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 5,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  harness.setNow(3_000);
  await harness.controller.requestReconcile('context-deadline');
  assert.equal(harness.context.state, 'running');
  assert.equal(harness.inputState.state, 'live');

  harness.setNow(59_999);
  await harness.controller.requestReconcile('before-input-deadline');
  assert.equal(harness.inputState.state, 'live');

  harness.setNow(60_000);
  await harness.controller.requestReconcile('input-deadline');
  assert.equal(harness.inputState.state, 'released', JSON.stringify(harness.controller.lastDecision));
  assert.equal(harness.controller.getSnapshot().manualResumeRequired, true);

  let fullRenderCommitted = false;
  const originalApplyWorkletState = harness.controller._applyWorkletState.bind(harness.controller);
  harness.controller._applyWorkletState = async (...args) => {
    const result = await originalApplyWorkletState(...args);
    if (result === true) fullRenderCommitted = true;
    return result;
  };
  const originalJournalClear = harness.controller.sessionJournal.clear.bind(
    harness.controller.sessionJournal
  );
  harness.controller.sessionJournal.clear = (...args) => {
    assert.equal(fullRenderCommitted, true);
    return originalJournalClear(...args);
  };

  const resumed = await harness.controller.requestResumeFromUserGesture('dedicated-input');
  await harness.flush();
  const snapshot = harness.controller.getSnapshot();
  assert.equal(resumed, true);
  assert.equal(snapshot.manualResumeRequired, false);
  assert.equal(snapshot.transitionError.code, null);
  assert.equal(harness.inputState.state, 'live');
});

test('a stale committed journal latch clears automatically once the input is live, routed, and freshly observed', async () => {
  const harness = createHarness({
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 3,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  harness.controller.sessionJournal.prepare({
    operationId: 'stale-op',
    releaseCause: 'player-only-retention-expired',
    releaseEligibility: { releaseCause: 'player-only-retention-expired' },
    suspendCause: null,
    policy: 'maximum',
    inputConfigured: true,
    inputGeneration: 1,
    createdAtEpochMs: 0
  });
  harness.controller.sessionJournal.advance('stale-op', 'input-stopped');
  harness.controller.sessionJournal.advance('stale-op', 'committed');

  await harness.controller.start();
  await harness.flush();

  const snapshot = harness.controller.getSnapshot();
  assert.equal(snapshot.manualResumeRequired, false);
  assert.equal(snapshot.resourceStatus.persistence.journalPhase, null);
});

test('a restored journal latch is kept while the input stays stopped', async () => {
  const harness = createHarness({
    input: {
      state: 'released',
      inputAvailability: 'unknown',
      inputAvailabilityRevision: 2,
      inputGeneration: 4,
      inputResourceId: null,
      inputConfigured: true,
      inputSourcePresent: false,
      trackState: 'ended'
    }
  });
  harness.controller.sessionJournal.prepare({
    operationId: 'stale-op',
    releaseCause: 'player-only-retention-expired',
    releaseEligibility: { releaseCause: 'player-only-retention-expired' },
    suspendCause: null,
    policy: 'maximum',
    inputConfigured: true,
    inputGeneration: 1,
    createdAtEpochMs: 0
  });
  harness.controller.sessionJournal.advance('stale-op', 'input-stopped');
  harness.controller.sessionJournal.advance('stale-op', 'committed');

  await harness.controller.start();
  await harness.flush();
  await harness.controller.requestReconcile('steady');
  harness.controller.handlePageLifecycleEvent('visibilitychange', { hidden: false });
  await harness.flush();

  const snapshot = harness.controller.getSnapshot();
  assert.equal(snapshot.manualResumeRequired, true);
  assert.equal(snapshot.resourceStatus.persistence.journalPhase, 'committed');
});

test('the maximum-policy release latch survives reconciles and lifecycle events until a gesture or live input', async () => {
  const player = createPausedPlayer();
  const harness = createHarness({
    settings: { mode: 'maximum', silenceThresholdDb: -80, fullSuspendDelaySeconds: 60 },
    player,
    input: {
      state: 'live',
      inputAvailability: 'available',
      inputAvailabilityRevision: 1,
      inputGeneration: 5,
      inputResourceId: 'mic-1',
      inputConfigured: true,
      inputSourcePresent: true,
      trackState: 'live'
    }
  });
  await harness.controller.start();
  harness.setNow(3_000);
  await harness.controller.requestReconcile('context-deadline');
  assert.equal(harness.context.state, 'running');
  assert.equal(harness.inputState.state, 'live');

  harness.setNow(60_000);
  await harness.controller.requestReconcile('input-deadline');
  assert.equal(harness.inputState.state, 'released', JSON.stringify(harness.controller.lastDecision));
  assert.equal(harness.controller.getSnapshot().manualResumeRequired, true);

  harness.controller.handlePageLifecycleEvent('visibilitychange', { hidden: false });
  await harness.flush();
  await harness.controller.requestReconcile('still-latched');
  await harness.flush();

  const snapshot = harness.controller.getSnapshot();
  assert.equal(snapshot.manualResumeRequired, true);
  assert.equal(harness.inputState.state, 'released');
  assert.equal(snapshot.resourceStatus.persistence.journalPhase, 'committed');
});

test('temporal preparation leaves the live skipped-frame base to the worklet', async () => {
  const harness = createHarness({
    pipeline: [{ id: 1, enabled: true, temporalCapability: 'reset-on-resume' }]
  });
  await harness.controller.start();
  harness.setNow(15_000);
  await harness.controller.requestReconcile('deadline');
  assert.equal(harness.context.state, 'suspended');
  const observationsBeforeResume = harness.posted.filter(message =>
    message.type === 'requestPowerObservation').length;

  const resumed = await harness.controller.requestResumeFromUserGesture('player-only-play');
  await harness.flush();
  assert.equal(resumed, true);
  const prepareIndex = harness.posted.findIndex(m =>
    m.type === 'prepareTemporalStateAndResume');
  assert.ok(prepareIndex >= 0);
  assert.equal(Object.hasOwn(harness.posted[prepareIndex], 'skippedFrameCount'), false);
  assert.equal(harness.posted.slice(0, prepareIndex).filter(message =>
    message.type === 'requestPowerObservation').length, observationsBeforeResume);
  const preparation = harness.controller.getSnapshot().resourceStatus.worklets.nodes[0]
    .statePreparation;
  assert.equal(preparation.state, 'acknowledged');
  assert.equal(Number.isSafeInteger(preparation.skippedFrameCount), true);
});
