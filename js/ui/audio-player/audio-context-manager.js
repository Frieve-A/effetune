/**
 * AudioContextManager - Handles Web Audio API integration and metadata processing
 * Manages media sources and audio connections
 * UNIFIED STATE MANAGEMENT: All state managed in StateManager only
 */
import { readRiffInfoTagsFromBlob } from '../../library/metadata/riff-info.js';
import { decodeLegacyMetadataBytes, repairLegacyMetadataMojibake } from '../../library/metadata/text-encoding.js';
import {
  clampLogicalTime,
  getPlaybackPhysicalSourceKey,
  getPlaybackRegion,
  getRegionEndTime,
  getRegionStartTime,
  hasPlaybackRegionDescriptor,
  isRegionPlayableInMedia,
  logicalTimeToMediaTime,
  mediaTimeToLogicalTime
} from './playback-region.js';
import {
  choosePlaybackMode,
  normalizePlaybackSourceDescriptor
} from './playback-source-policy.js';

const MEDIA_CANDIDATE_READY_TIMEOUT_MS = 15000;

export class AudioContextManager {
  constructor(audioPlayer, audioManager) {
    this.audioPlayer = audioPlayer;
    this.audioManager = audioManager;
    this.mediaSource = null;
    this.originalSourceNode = null;
    this.currentObjectURL = null;
    this.currentArtworkURL = null;
    
    // Store event handler references for proper removal
    this.eventHandlers = {
      ended: null,
      timeupdate: null,
      error: null,
      loadedmetadata: null,
      ratechange: null
    };
    
    // Store original source node for restoration
    const canonicalInputSource = audioManager.ioManager?.inputSourceNode || audioManager.sourceNode;
    if (canonicalInputSource) {
      this.originalSourceNode = canonicalInputSource;
    }
    
    // Buffer management (only for audio processing, not state)
    this.currentBuffer = null;
    this.nextBuffer = null;
    this.currentBufferSource = null;
    this.pendingBufferSource = null;
    this.scheduledBufferTransition = null;
    this.bufferStartTime = 0;
    this.bufferDuration = 0;
    this.sourceGenerationSequence = 0;
    this.activeSourceGeneration = 0;
    this.mediaSourceGeneration = 0;
    this.pendingMediaActivation = null;
    this.pendingMediaCandidateReadiness = new Set();
    this.privatePipelineSourceGates = new WeakMap();
    
    // Instance tracking for cleanup
    this.currentInstanceId = 0;
    this.playbackInstanceId = 0;
    
    // UI monitoring
    this.bufferMonitoringInterval = null;

    this.loadRequestToken = 0;
    this.activeLoadRequest = null;
    this.metadataRequestToken = 0;
    this.activeMetadataRequest = null;
    this.resolvedProviderTracks = new WeakSet();
    this.nextBufferRequestToken = 0;
    this.activeNextBufferRequest = null;
    this.transitionRequestToken = 0;
    this.activeTransitionRequest = null;
    this.stopRequestToken = 0;
    this.graphRebuildGeneration = 0;
    this.activeGraphRebuildRequest = null;
    this.activeRegion = null;
    this.pendingRegionMetadata = null;
    this.regionBoundaryTimer = null;
    this.regionBoundaryArmToken = 0;
    this.currentPlaybackDecision = null;
  }

  // ===== CORE AUDIO METHODS =====

  /**
   * Ensure that a source reaches every active pipeline input.
   */
  ensurePipelineSourceConnected(sourceNode) {
    const pipelineSourceNode = this.getPipelineSourceNode(sourceNode);
    if (!pipelineSourceNode || !this.audioManager.workletNode) return false;
    if (typeof this.audioManager.ensureSourceConnectedToPipeline === 'function') {
      return this.audioManager.ensureSourceConnectedToPipeline(pipelineSourceNode) === true;
    }
    const canVerifyConnection =
      typeof this.audioManager.isSourceConnectedToPipeline === 'function';
    if (canVerifyConnection &&
        this.audioManager.isSourceConnectedToPipeline(pipelineSourceNode) === true) {
      return true;
    }

    let connected = false;
    try {
      connected = this.audioManager.connectSourceToPipeline?.(pipelineSourceNode) === true;
    } catch (error) {
      return false;
    }
    return connected && (!canVerifyConnection ||
      this.audioManager.isSourceConnectedToPipeline(pipelineSourceNode) === true);
  }

  getPipelineSourceNode(sourceNode) {
    return this.privatePipelineSourceGates.get(sourceNode) || sourceNode;
  }

  isPipelineSourceConnected(sourceNode) {
    const pipelineSourceNode = this.getPipelineSourceNode(sourceNode);
    return !!pipelineSourceNode &&
      this.audioManager.isSourceConnectedToPipeline?.(pipelineSourceNode) === true;
  }

  setPrivatePipelineSourceMuted(sourceNode, muted) {
    const gate = this.privatePipelineSourceGates.get(sourceNode);
    if (!gate) return muted === false;

    try {
      gate.gain.value = muted ? 0 : 1;
      return true;
    } catch (error) {
      return false;
    }
  }

  connectPrivatePipelineSource(sourceNode, { replaceDirectRoute = false } = {}) {
    const existingGate = this.privatePipelineSourceGates.get(sourceNode);
    if (existingGate) {
      return this.setPrivatePipelineSourceMuted(sourceNode, true) &&
        this.ensurePipelineSourceConnected(sourceNode);
    }

    let gate;
    let directRouteRemoved = false;
    let sourceConnectedToGate = false;
    try {
      // Keep an unverified candidate private without muting unrelated sources
      // or changing the master output gain.
      gate = this.audioPlayer.audioContext.createGain();
      gate.gain.value = 0;
      if (replaceDirectRoute) {
        this.audioManager.disconnectSourceFromPipeline?.(sourceNode);
        directRouteRemoved = true;
      }
      sourceNode.connect(gate);
      sourceConnectedToGate = true;
      if (this.audioManager.connectSourceToPipeline?.(gate) !== true) {
        throw new Error('private-pipeline-source-connect-failed');
      }
      this.privatePipelineSourceGates.set(sourceNode, gate);
      return true;
    } catch (error) {
      if (sourceConnectedToGate) {
        try { sourceNode.disconnect(gate); } catch (_) { /* not connected */ }
      }
      try { gate?.disconnect(); } catch (_) { /* not connected */ }
      if (directRouteRemoved) {
        try { this.audioManager.connectSourceToPipeline?.(sourceNode); } catch (_) { /* unavailable */ }
      }
      return false;
    }
  }

  /**
   * Create and connect silent gain node for pipeline maintenance
   */
  createSilentGain() {
    try {
      const ioManager = this.audioManager.ioManager;
      const runningSilentSource = ioManager?.ensureSilentSourceFallback?.() || null;
      if (runningSilentSource) {
        if (!this.ensurePipelineSourceConnected(runningSilentSource)) return null;
        return runningSilentSource;
      }

      // Compatibility fallback for hosts without AudioIOManager. Production
      // uses its looping stereo buffer source so the worklet receives quanta.
      const silentGain = this.audioPlayer.audioContext.createGain();
      silentGain.gain.value = 0;
      if (this.audioManager.workletNode) {
        silentGain.connect(this.audioManager.workletNode);
      }
      return silentGain;
    } catch (e) {
      return null;
    }
  }

  /**
   * Keep AudioManager's exposed source and IO source synchronized.
   */
  setManagedSourceNode(sourceNode) {
    this.audioManager.sourceNode = sourceNode;
    if (this.audioManager.ioManager) {
      // sourceNode is the active compatibility route. Never overwrite the
      // canonical inputSourceNode retained by AudioIOManager.
      this.audioManager.ioManager.sourceNode = sourceNode;
    }
  }

  handoffInputToSilentSource() {
    const previousSource = this.originalSourceNode;
    const silentSource = this.createSilentGain();
    if (!silentSource) return null;
    if (previousSource && previousSource !== silentSource) {
      this.releasePipelineSource(previousSource);
    }
    this.setManagedSourceNode(silentSource);
    return silentSource;
  }

  preparePlayerSourceOwnership() {
    if (this.getUseInputWithPlayer()) {
      return { useInputWithPlayer: true, silentSource: null };
    }
    const previousManagerSource = this.audioManager.sourceNode;
    const previousIoSource = this.audioManager.ioManager?.sourceNode;
    const silentSource = this.createSilentGain();
    return silentSource ? {
      useInputWithPlayer: false,
      silentSource,
      previousManagerSource,
      previousIoSource,
      centrallyManagedSilent: this.audioManager.ioManager?.sourceNode === silentSource
    } : null;
  }

  rollbackPlayerSourceOwnership(ownership) {
    if (ownership?.useInputWithPlayer !== false) return;
    this.audioManager.sourceNode = ownership.previousManagerSource;
    if (this.audioManager.ioManager) {
      this.audioManager.ioManager.sourceNode = ownership.previousIoSource;
    }
    if (!ownership.centrallyManagedSilent &&
        ownership.silentSource !== ownership.previousManagerSource &&
        ownership.silentSource !== ownership.previousIoSource) {
      this.releasePipelineSource(ownership.silentSource);
    }
  }

  commitPlayerSourceOwnership(sourceNode, ownership) {
    if (ownership?.useInputWithPlayer !== false) return;
    const previousSource = this.originalSourceNode;
    if (previousSource && previousSource !== ownership.silentSource && previousSource !== sourceNode) {
      this.releasePipelineSource(previousSource);
    }
    this.setManagedSourceNode(sourceNode || ownership.silentSource);
  }

  replaceCanonicalInputSource(sourceNode) {
    if (this.getUseInputWithPlayer() && sourceNode &&
        !this.ensurePipelineSourceConnected(sourceNode)) {
      return false;
    }
    this.originalSourceNode = sourceNode || null;
    return true;
  }

  getPowerSourceStatus() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.() || null;
    const required = state?.isPlaying === true || state?.isTransitioning === true;
    if (!required) return { state: 'not-required', sourcePresent: false };
    const source = state?.playbackMode === 'bufferSource'
      ? this.currentBufferSource
      : this.mediaSource;
    if (!source) return { state: 'disconnected', sourcePresent: false };
    const connected = this.isPipelineSourceConnected(source);
    return {
      state: connected ? 'connected' : 'disconnected',
      sourcePresent: true
    };
  }

  releasePipelineSource(sourceNode, stop = false) {
    if (!sourceNode) return;

    const gate = this.privatePipelineSourceGates.get(sourceNode) || null;
    const pipelineSourceNode = gate || sourceNode;

    if (stop) {
      sourceNode.onended = null;
      try {
        sourceNode.stop();
      } catch (error) {
        // Continue releasing manager-owned edges when the source is already stopped.
      }
    }

    try {
      this.audioManager.disconnectSourceFromPipeline?.(pipelineSourceNode);
    } catch (error) {
      // Source teardown must continue even if manager-owned edge cleanup fails.
    }

    try {
      sourceNode.disconnect();
    } catch (error) {
      // Source teardown is complete even when the underlying node was already disconnected.
    }

    if (gate) {
      try { gate.disconnect(); } catch (_) { /* already disconnected */ }
      this.privatePipelineSourceGates.delete(sourceNode);
    }
  }

  getUseInputWithPlayer() {
    const integration = window.electronIntegration;
    const isElectron = !!(integration?.isElectronEnvironment?.() || integration?.isElectron);
    const preferences = isElectron
      ? (integration?.audioPreferences || window.audioPreferences)
      : (window.audioPreferences || integration?.audioPreferences);
    return preferences?.useInputWithPlayer === true;
  }

  getPlaybackResumeKind() {
    return this.getUseInputWithPlayer() ? 'mixed-play' : 'player-only-play';
  }

  getPlaybackIntentIdentity(sourceGeneration, intendedPosition = 0, intent = null) {
    const state = this.getCurrentState();
    const track = intent?.track || state?.currentTrack || null;
    const fileName = typeof track?.file?.name === 'string' ? track.file.name : '';
    const trackKey = String(
      track?.libraryTrackId || track?.id || track?.path || fileName || track?.name || ''
    );
    return {
      playerIntentGeneration: sourceGeneration,
      sourceGeneration,
      trackKey,
      trackIndex: Number.isInteger(intent?.targetIndex)
        ? intent.targetIndex
        : (Number.isInteger(state?.currentTrackIndex) ? state.currentTrackIndex : -1),
      intendedPosition: Number.isFinite(intendedPosition) ? intendedPosition : 0
    };
  }

  async stagePlaybackActivation(backend, sourceGeneration, intendedPosition = 0, intent = null) {
    if (!this.audioManager?.isStagedAudioActivationEnabled?.()) return null;
    const powerPolicyController = this.audioManager.powerPolicyController;
    const releaseLease = powerPolicyController?.acquireLease?.(
      'player-activation',
      { mode: 'force-active' }
    ) || null;
    try {
      // The lease changes policy facts immediately, but an automatic-monitoring
      // command chosen before the lease was acquired may still be in flight.
      // Do not request the activation proof until reconciliation has consumed
      // the force-active lease and restored full processing.
      if (releaseLease && typeof powerPolicyController.requestReconcile === 'function') {
        await powerPolicyController.requestReconcile('player-activation-lease-barrier');
      }
      const stage = await this.audioManager.stageAudioActivation({
        intentKind: 'player',
        intentIdentity: this.getPlaybackIntentIdentity(sourceGeneration, intendedPosition, intent),
        resumeKind: this.getPlaybackResumeKind(),
        backend,
        requiredResourceKeys: ['audio-context', 'output-bridge', 'player-source', 'worklet'],
        activationAffectingConfig: {
          useInputWithPlayer: this.getUseInputWithPlayer(),
          outputChannels: window.audioPreferences?.outputChannels || 2
        }
      });
      if (stage && releaseLease) {
        Object.defineProperty(stage, '_releasePlayerActivationLease', {
          configurable: true,
          value: releaseLease
        });
      } else if (!stage) {
        releaseLease?.();
      }
      return stage;
    } catch (error) {
      releaseLease?.();
      throw error;
    }
  }

  releasePlaybackActivationStage(stage) {
    const releaseLease = stage?._releasePlayerActivationLease;
    if (typeof releaseLease !== 'function') return;
    delete stage._releasePlayerActivationLease;
    releaseLease();
  }

  async resumePlaybackAudioContext(userInitiated = true) {
    const controller = this.audioManager?.powerPolicyController;
    if (controller?.enabled) {
      if (!userInitiated) {
        if (typeof controller.ensureActiveForAutomaticPlayback !== 'function') return false;
        return await controller.ensureActiveForAutomaticPlayback() !== false;
      }
      if (typeof controller.ensureActive === 'function') {
        return await controller.ensureActive(this.getPlaybackResumeKind()) !== false;
      }
    }
    const contextManager = this.audioManager?.contextManager;
    if (typeof contextManager?.resumeAudioContext === 'function') {
      await contextManager.resumeAudioContext();
      return true;
    }

    const audioContext = this.audioPlayer?.audioContext;
    if (audioContext?.state === 'suspended' && typeof audioContext.resume === 'function') {
      try {
        await audioContext.resume();
      } catch (error) {
        console.warn('[AudioContextManager] AudioContext resume before playback failed:', error);
      }
    }
    return audioContext?.state !== 'suspended';
  }
  
  /**
   * Connect buffer source to audio manager
   */
  connectBufferSource(bufferSource, { privateUntilCommit = false } = {}) {
    const useInputWithPlayer = this.getUseInputWithPlayer();
    if (!this.audioManager.workletNode) {
      console.warn('[AudioContextManager] Worklet node unavailable; refusing direct destination playback.');
      return false;
    }
    if (!useInputWithPlayer && !this.handoffInputToSilentSource()) return false;
    const connected = privateUntilCommit
      ? this.connectPrivatePipelineSource(bufferSource)
      : this.ensurePipelineSourceConnected(bufferSource);
    if (!connected) return false;
    if (!useInputWithPlayer) this.setManagedSourceNode(this.getPipelineSourceNode(bufferSource));
    return true;
  }

  connectScheduledBufferSource(bufferSource) {
    if (!bufferSource || !this.audioManager.workletNode) return false;
    return this.ensurePipelineSourceConnected(bufferSource);
  }
  
  /**
   * Connect media source to audio manager
   */
  connectMediaSource(mediaSource) {
    const useInputWithPlayer = this.getUseInputWithPlayer();
    if (!this.audioManager.workletNode) return false;
    if (!useInputWithPlayer && !this.handoffInputToSilentSource()) return false;
    if (!this.ensurePipelineSourceConnected(mediaSource)) return false;
    if (!useInputWithPlayer) this.setManagedSourceNode(mediaSource);
    return true;
  }
  
  /**
   * Create and configure buffer source with common settings
   */
  createBufferSource(buffer, instanceId, activation = null) {
    const bufferSource = this.audioPlayer.audioContext.createBufferSource();
    bufferSource.buffer = buffer;
    if (!this.connectBufferSource(bufferSource, {
      privateUntilCommit: activation?.privateUntilCommit === true
    })) {
      this.releasePipelineSource(bufferSource);
      throw new Error('pipeline-source-connect-failed');
    }
    
    bufferSource.onended = () => {
      this.releasePipelineSource(bufferSource);
      if (activation && activation.isCommitted?.() !== true) {
        activation.onPendingEnded?.();
        return;
      }
      if (this.commitScheduledBufferTransitionForSource(bufferSource)) return;
      const state = this.audioPlayer.stateManager?.getStateSnapshot();
      if (this.currentInstanceId === instanceId && !state?.isTransitioning && !state?.isStopped) {
        this.handleTrackEnded();
      }
    };
    
    return bufferSource;
  }

  advancePlaybackInstanceToken() {
    this.currentInstanceId++;
    this.playbackInstanceId = this.currentInstanceId;
    return this.currentInstanceId;
  }
  
  /**
   * Maintain silent source for pipeline when useInputWithPlayer is false
   */
  maintainSilentSource() {
    const useInputWithPlayer = this.getUseInputWithPlayer();
    if (!useInputWithPlayer) {
      this.handoffInputToSilentSource();
    }
  }

  getActivePlaybackRegion() {
    return this.activeRegion?.sourceGeneration === this.activeSourceGeneration
      ? this.activeRegion.region
      : null;
  }

  getCurrentPlaybackTime() {
    const state = this.getCurrentState();
    if (state?.playbackMode === 'bufferSource') return this.getCurrentBufferTime();
    const mediaTime = this.audioPlayer.audioElement?.currentTime;
    return mediaTimeToLogicalTime(
      this.getActivePlaybackRegion(),
      Number.isFinite(mediaTime) ? mediaTime : state?.currentTrackPosition
    );
  }

  async restartAudioElementPlayback() {
    this.invalidateAutomaticMoveForManualCommand();
    const audioElement = this.audioPlayer.audioElement;
    if (!audioElement) return false;

    const previousRegion = this.activeRegion;
    if (previousRegion?.sourceGeneration === this.activeSourceGeneration) {
      this.clearRegionBoundaryTimer();
      this.settlePendingRegionMetadata(false);
      const sourceGeneration = Math.max(
        this.sourceGenerationSequence,
        this.activeSourceGeneration
      ) + 1;
      this.sourceGenerationSequence = sourceGeneration;
      this.activeSourceGeneration = sourceGeneration;
      this.activeRegion = {
        region: previousRegion.region,
        track: previousRegion.track,
        sourceGeneration,
        physicalSourceKey: previousRegion.physicalSourceKey,
        boundaryCommitted: false,
        endedRecoveryPromise: null,
        transportPlan: null,
        transportPlanPending: false,
        transportPlanPromise: null,
        metadataValidated: true,
        metadataPromise: Promise.resolve(true)
      };
      this.updateState({
        currentTrackDuration: previousRegion.region.durationSec,
        currentTrackPosition: 0
      }, 'Playback region restarted');
      this.prepareRegionTransportPlan(this.activeRegion);
    }

    await this.seekAudioElement(0);
    return true;
  }

  clearRegionBoundaryTimer() {
    this.regionBoundaryArmToken += 1;
    if (this.regionBoundaryTimer !== null) {
      clearTimeout(this.regionBoundaryTimer);
      this.regionBoundaryTimer = null;
    }
  }

  settlePendingRegionMetadata(value) {
    const pending = this.pendingRegionMetadata;
    if (!pending) return;
    this.pendingRegionMetadata = null;
    pending.resolve(value === true);
  }

  clearActiveRegion() {
    this.clearRegionBoundaryTimer();
    this.settlePendingRegionMetadata(false);
    this.activeRegion = null;
  }

  beginActiveRegion(track, sourceGeneration) {
    const region = getPlaybackRegion(track);
    this.clearActiveRegion();
    if (!region) return null;

    let resolveMetadata;
    const metadataPromise = new Promise(resolve => { resolveMetadata = resolve; });
    const activeRegion = {
      region,
      track,
      sourceGeneration,
      physicalSourceKey: getPlaybackPhysicalSourceKey(track),
      boundaryCommitted: false,
      endedRecoveryPromise: null,
      transportPlan: null,
      transportPlanPending: false,
      transportPlanPromise: null,
      metadataValidated: false,
      metadataPromise
    };
    this.activeRegion = activeRegion;
    this.pendingRegionMetadata = {
      activeRegion,
      resolve: resolveMetadata
    };
    return activeRegion;
  }

  setValidatedActiveRegion(track, sourceGeneration) {
    const region = getPlaybackRegion(track);
    this.clearActiveRegion();
    if (!region) return null;
    this.activeRegion = {
      region,
      track,
      sourceGeneration,
      physicalSourceKey: getPlaybackPhysicalSourceKey(track),
      boundaryCommitted: false,
      endedRecoveryPromise: null,
      transportPlan: null,
      transportPlanPending: false,
      transportPlanPromise: null,
      metadataValidated: true,
      metadataPromise: Promise.resolve(true)
    };
    return this.activeRegion;
  }

  waitForActiveRegionMetadata(sourceGeneration) {
    const activeRegion = this.activeRegion;
    if (!activeRegion || activeRegion.sourceGeneration !== sourceGeneration) return Promise.resolve(true);
    return activeRegion.metadataPromise;
  }

  handleRegionLoadedMetadata(audioElement) {
    const activeRegion = this.activeRegion;
    if (!activeRegion || activeRegion.sourceGeneration !== this.activeSourceGeneration) return false;
    if (!isRegionPlayableInMedia(activeRegion.region, audioElement.duration)) {
      this.settlePendingRegionMetadata(false);
      return true;
    }

    try {
      audioElement.currentTime = getRegionStartTime(activeRegion.region);
    } catch (error) {
      this.settlePendingRegionMetadata(false);
      return true;
    }

    activeRegion.metadataValidated = true;
    this.updateState({
      currentTrackDuration: activeRegion.region.durationSec,
      currentTrackPosition: 0
    }, 'Playback region metadata validated');
    this.settlePendingRegionMetadata(true);
    this.prepareRegionTransportPlan(activeRegion);
    return true;
  }

  prepareRegionTransportPlan(activeRegion = this.activeRegion) {
    if (!activeRegion || activeRegion !== this.activeRegion ||
        activeRegion.sourceGeneration !== this.activeSourceGeneration) return Promise.resolve(null);
    if (activeRegion.transportPlanPending) return activeRegion.transportPlanPromise;
    activeRegion.transportPlan = null;
    const playbackManager = this.audioPlayer.playbackManager;
    if (typeof playbackManager?.preparePlannedRegionMove !== 'function') return Promise.resolve(null);
    activeRegion.transportPlanPending = true;
    const planPromise = playbackManager.preparePlannedRegionMove(activeRegion.track).then(plan => {
      if (activeRegion === this.activeRegion &&
          activeRegion.sourceGeneration === this.activeSourceGeneration &&
          activeRegion.transportPlanPromise === planPromise &&
          !activeRegion.boundaryCommitted) {
        activeRegion.transportPlan = plan;
      }
      return plan;
    }).catch(error => {
      if (activeRegion === this.activeRegion) {
        console.warn('[AudioContextManager] Next playback region preparation failed:', error);
      }
      return null;
    }).finally(() => {
      if (activeRegion.transportPlanPromise === planPromise) {
        activeRegion.transportPlanPending = false;
      }
    });
    activeRegion.transportPlanPromise = planPromise;
    return planPromise;
  }

  refreshActiveRegionTransportPlan() {
    const activeRegion = this.activeRegion;
    if (!activeRegion) {
      const state = this.getCurrentState();
      this.clearNextTrackBuffer();
      if (state?.playbackMode === 'bufferSource' && state.isPlaying === true &&
          state.isStopped !== true) {
        this.prepareNextTrackBufferWithRepeatMode();
        return true;
      }
      return false;
    }
    if (!activeRegion || activeRegion.sourceGeneration !== this.activeSourceGeneration ||
        activeRegion.boundaryCommitted || activeRegion.metadataValidated !== true) {
      return false;
    }
    const currentTrack = this.getCurrentState()?.currentTrack;
    if (!samePlaybackEntry(activeRegion.track, currentTrack)) return false;

    activeRegion.transportPlan = null;
    activeRegion.transportPlanPending = false;
    activeRegion.transportPlanPromise = null;
    this.prepareRegionTransportPlan(activeRegion);
    return true;
  }

  isActiveRegionPlayback(activeRegion, sourceGeneration, armToken) {
    const state = this.getCurrentState();
    return activeRegion === this.activeRegion &&
      activeRegion?.sourceGeneration === sourceGeneration &&
      activeRegion.boundaryCommitted !== true &&
      armToken === this.regionBoundaryArmToken &&
      state?.playbackMode === 'audioElement' &&
      state.isTransitioning !== true &&
      state.isPlaying === true &&
      state.isPaused !== true &&
      state.isStopped !== true;
  }

  armRegionBoundaryTimer() {
    this.clearRegionBoundaryTimer();
    const activeRegion = this.activeRegion;
    const audioElement = this.audioPlayer.audioElement;
    const endTime = getRegionEndTime(activeRegion?.region);
    if (!activeRegion || activeRegion.boundaryCommitted || endTime === null ||
        !audioElement || !this.isActiveRegionPlayback(
          activeRegion,
          activeRegion.sourceGeneration,
          this.regionBoundaryArmToken
        ) || audioElement.paused === true) return;

    const playbackRate = Number(audioElement.playbackRate);
    if (!Number.isFinite(playbackRate) || playbackRate <= 0) return;
    const remaining = endTime - audioElement.currentTime;
    const sourceGeneration = activeRegion.sourceGeneration;
    const armToken = this.regionBoundaryArmToken;
    if (remaining <= 0) {
      queueMicrotask(() => this.commitRegionBoundary(sourceGeneration, armToken));
      return;
    }
    this.regionBoundaryTimer = setTimeout(() => {
      this.regionBoundaryTimer = null;
      this.commitRegionBoundary(sourceGeneration, armToken);
    }, (remaining / playbackRate) * 1000);
  }

  commitRegionBoundary(sourceGeneration, armToken = this.regionBoundaryArmToken) {
    const activeRegion = this.activeRegion;
    const audioElement = this.audioPlayer.audioElement;
    if (!audioElement || !this.isActiveRegionPlayback(activeRegion, sourceGeneration, armToken)) return false;
    const endTime = getRegionEndTime(activeRegion.region);
    if (endTime === null) return false;
    if (audioElement.currentTime < endTime) {
      this.armRegionBoundaryTimer();
      return false;
    }

    activeRegion.boundaryCommitted = true;
    this.clearRegionBoundaryTimer();
    const playbackManager = this.audioPlayer.playbackManager;
    const plan = activeRegion.transportPlanPending !== true &&
      playbackManager?.isPlannedRegionMoveCurrent?.(activeRegion.transportPlan) === true
      ? activeRegion.transportPlan
      : null;
    const nextTrack = plan?.nextTrack ?? null;
    let nextRegion = null;
    try {
      nextRegion = getPlaybackRegion(nextTrack);
    } catch (_) {
      nextRegion = null;
    }
    const samePhysicalSource = activeRegion.physicalSourceKey !== null &&
      activeRegion.physicalSourceKey === getPlaybackPhysicalSourceKey(nextTrack);
    const isContiguous = nextRegion && activeRegion.region.endFrame === nextRegion.startFrame;
    const nextRegionIsPlayable = nextRegion && isRegionPlayableInMedia(nextRegion, audioElement.duration);
    if (samePhysicalSource && isContiguous && nextRegionIsPlayable &&
        playbackManager?.commitPlannedRegionMove?.(plan, {
          position: mediaTimeToLogicalTime(nextRegion, audioElement.currentTime),
          duration: nextRegion.durationSec
        }) === true) {
      const nextSourceGeneration = ++this.sourceGenerationSequence;
      this.activeSourceGeneration = nextSourceGeneration;
      this.activeRegion = {
        region: nextRegion,
        track: nextTrack,
        sourceGeneration: nextSourceGeneration,
        physicalSourceKey: activeRegion.physicalSourceKey,
        boundaryCommitted: false,
        endedRecoveryPromise: null,
        transportPlan: null,
        transportPlanPending: false,
        transportPlanPromise: null,
        metadataValidated: true,
        metadataPromise: Promise.resolve(true)
      };
      this.loadMetadata(nextTrack, null, plan.nextOrdinal);
      this.prepareRegionTransportPlan(this.activeRegion);
      this.armRegionBoundaryTimer();
      this.audioPlayer.ui?.updatePlayerUIState?.();
      return true;
    }

    try {
      audioElement.pause();
      audioElement.currentTime = endTime;
    } catch (_) {
      // Normal transport still owns recovery when the media element cannot be clamped.
    }
    this.updateState({
      isPlaying: false,
      isPaused: true,
      isStopped: false,
      currentTrackPosition: activeRegion.region.durationSec
    }, 'Playback region boundary reached');
    this.transitionRegionBoundaryFallback(plan);
    return true;
  }

  transitionRegionBoundaryFallback(plan = null) {
    const playbackManager = this.audioPlayer.playbackManager;
    if (plan && playbackManager?.isPlannedAutomaticMoveCurrent?.(plan) === true) {
      return this.transitionPreparedAutomaticMove(this.createPreparedAutomaticMove(plan));
    }
    playbackManager?.onTrackEnded?.();
    return false;
  }

  handlePrematureRegionEnded() {
    const activeRegion = this.activeRegion;
    if (!activeRegion || getRegionEndTime(activeRegion.region) === null) {
      return false;
    }
    if (activeRegion.endedRecoveryPromise) return true;
    if (activeRegion.boundaryCommitted) return false;
    activeRegion.boundaryCommitted = true;
    this.clearRegionBoundaryTimer();
    const error = new Error('Playback source ended before the logical track boundary');
    error.code = 'mediaLoadFailed';
    const failedIndex = this.audioPlayer.stateManager?.getCurrentTrackIndex?.();
    const playbackManager = this.audioPlayer.playbackManager;
    const recovery = playbackManager?.catalogSequence &&
        typeof playbackManager.recoverCatalogTrackLoadFailure === 'function'
      ? playbackManager.recoverCatalogTrackLoadFailure(error, failedIndex)
      : this.completeTrackLoadFailure(
          error,
          error,
          () => activeRegion !== this.activeRegion,
          failedIndex
        );
    activeRegion.endedRecoveryPromise = Promise.resolve(recovery).catch(recoveryError => {
      console.error('[AudioContextManager] Playback region end recovery failed:', recoveryError);
      return false;
    });
    return true;
  }

  /**
   * Capture the most accurate playback position before replacing graph nodes.
   */
  getPlaybackPositionForGraphRebind(state) {
    let position = Number.isFinite(state?.currentTrackPosition) ? state.currentTrackPosition : 0;

    if (state?.playbackMode === 'bufferSource' && this.currentBufferSource && this.audioPlayer.audioContext) {
      try {
        const duration = this.bufferDuration || state.currentTrackDuration || 0;
        const elapsedTime = this.audioPlayer.audioContext.currentTime - this.bufferStartTime;
        if (Number.isFinite(elapsedTime)) {
          position = duration > 0 ? Math.max(0, Math.min(elapsedTime, duration)) : Math.max(0, elapsedTime);
        }
      } catch (e) {
        // Fall back to StateManager's last known position.
      }
    } else if (state?.playbackMode === 'audioElement' && this.audioPlayer.audioElement) {
      const elementTime = this.audioPlayer.audioElement.currentTime;
      if (Number.isFinite(elementTime)) {
        position = mediaTimeToLogicalTime(this.getActivePlaybackRegion(), elementTime);
      }
    }

    return Math.max(0, position);
  }

  /**
   * Resolve the track that should remain attached across an audio graph reset.
   */
  getTrackForGraphRebind(state) {
    if (state?.currentTrack) {
      return state.currentTrack;
    }

    const currentIndex = this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ??
      this.audioPlayer.playbackManager?.currentTrackIndex ??
      -1;

    if (currentIndex >= 0) {
      return this.audioPlayer.playbackManager?.getTrack?.(currentIndex) || null;
    }

    return null;
  }

  getDisplayTrackName(track) {
    const title = track?.meta?.title;
    const artist = track?.meta?.artist;
    if (title && artist) return `${artist} - ${title}`;
    if (title) return title;
    return track?.name || '';
  }

  getMetadataRepairHints(referenceTexts = []) {
    const cleanReferences = referenceTexts
      .filter(value => typeof value === 'string')
      .map(value => value.trim())
      .filter(Boolean);
    const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
    const uiManager = typeof window !== 'undefined' ? window.uiManager : null;
    return {
      languagePreference: uiManager?.languagePreference || '',
      language: uiManager?.userLanguage || '',
      browserLanguage: navigatorRef?.language || '',
      browserLanguages: Array.isArray(navigatorRef?.languages) ? navigatorRef.languages.slice(0, 8) : [],
      referenceTexts: cleanReferences
    };
  }

  normalizeMetadataTagText(value, referenceTexts = []) {
    if (value === null || value === undefined) return '';
    return repairLegacyMetadataMojibake(String(value), this.getMetadataRepairHints(referenceTexts)).trim();
  }

  createRiffInfoMetadataPromise(file) {
    if (!this.shouldReadRiffInfoMetadata(file)) return null;
    return this.readRiffInfoMetadata(file).catch(() => null);
  }

  shouldReadRiffInfoMetadata(file) {
    return Boolean(
      file &&
      typeof file.name === 'string' &&
      file.name.toLowerCase().endsWith('.wav') &&
      typeof file.slice === 'function'
    );
  }

  async readRiffInfoMetadata(file) {
    const tags = await readRiffInfoTagsFromBlob(file);
    if (!tags.length) return null;
    const title = this.decodeRiffInfoText(tags, ['INAM', 'TITL'], [file.name]);
    const referenceTexts = [title, file.name];
    const artist = this.decodeRiffInfoText(tags, ['IART'], referenceTexts);
    const album = this.decodeRiffInfoText(tags, ['IPRD', 'IRPD'], referenceTexts);
    return title || artist || album ? { title, artist, album } : null;
  }

  decodeRiffInfoText(tags, ids, referenceTexts = []) {
    const idSet = new Set(ids);
    const tag = tags.find(item => idSet.has(String(item?.id || '').trim().toUpperCase()));
    if (!tag) return '';
    if (typeof tag.value === 'string') return this.normalizeMetadataTagText(tag.value, referenceTexts);
    return decodeLegacyMetadataBytes(tag.data ?? tag.bytes ?? tag.value, this.getMetadataRepairHints(referenceTexts));
  }

  /**
   * Detach nodes that belong to the previous AudioContext.
   */
  detachCurrentGraphNodesForRebind() {
    this.clearRegionBoundaryTimer();
    if (this.pendingBufferSource) {
      this.releasePipelineSource(this.pendingBufferSource, true);
      this.pendingBufferSource = null;
    }
    this.pendingMediaActivation = null;
    if (this.currentBufferSource) {
      this.releasePipelineSource(this.currentBufferSource, true);
      this.currentBufferSource = null;
    }

    if (this.mediaSource) {
      this.releasePipelineSource(this.mediaSource);
      this.mediaSource = null;
    }

    if (this.audioPlayer.audioElement) {
      try {
        this.audioPlayer.audioElement.pause();
      } catch (e) {
        // Silent fail
      }
    }

    this.clearBufferMonitoring();
    this.advancePlaybackInstanceToken();
  }

  /**
   * Drop an element bound to an old AudioContext so fallback playback can bind
   * a fresh MediaElementSource to the new context.
   */
  removeAudioElementEventHandlers(audioElement) {
    if (!audioElement) return;
    const handlers = [
      ['ended', this.eventHandlers.ended],
      ['timeupdate', this.eventHandlers.timeupdate],
      ['error', this.eventHandlers.error],
      ['loadedmetadata', this.eventHandlers.loadedmetadata],
      ['ratechange', this.eventHandlers.ratechange]
    ];

    handlers.forEach(([eventName, handler]) => {
      if (handler) {
        try {
          audioElement.removeEventListener(eventName, handler);
        } catch (e) {
          // Silent fail
        }
      }
    });

    this.eventHandlers = {
      ended: null,
      timeupdate: null,
      error: null,
      loadedmetadata: null,
      ratechange: null
    };
  }

  detachAudioElement(audioElement, { clearSource = false, clearPlayerReference = false } = {}) {
    if (!audioElement) return;

    this.removeAudioElementEventHandlers(audioElement);

    try {
      audioElement.pause();
    } catch (e) {
      // Silent fail
    }

    if (clearSource) {
      try {
        audioElement.src = '';
      } catch (e) {
        // Silent fail
      }
    }

    if (clearPlayerReference && this.audioPlayer.audioElement === audioElement) {
      this.audioPlayer.audioElement = null;
    }
  }

  detachAudioElementForGraphRebuild() {
    this.detachAudioElement(this.audioPlayer.audioElement, {
      clearPlayerReference: true
    });
  }

  /**
   * Rebind an existing player to a freshly recreated AudioContext/Worklet graph.
   */
  async handleAudioGraphRebuilt() {
    const newAudioContext = this.audioManager.contextManager?.audioContext ??
      this.audioManager.audioContext;
    if (!newAudioContext) {
      return;
    }

    const state = this.getCurrentState();
    const currentTrack = this.getTrackForGraphRebind(state);
    const wasPlaying = !!state?.isPlaying;
    const wasPaused = !!state?.isPaused;
    const wasStopped = !!state?.isStopped;
    const restorePosition = this.getPlaybackPositionForGraphRebind(state);
    const currentTrackIndex = state?.currentTrackIndex;
    const graphRebuildGeneration = ++this.graphRebuildGeneration;
    const graphRebuildRequest = currentTrack ? {
      generation: graphRebuildGeneration,
      transportCommandGeneration: state?.transportCommandGeneration ?? 0,
      track: currentTrack,
      trackIndex: currentTrackIndex,
      position: restorePosition,
      transportIntent: {
        isPlaying: wasPlaying,
        isPaused: wasPaused,
        isStopped: wasStopped,
        command: null,
        position: restorePosition
      }
    } : null;
    this.activeGraphRebuildRequest = graphRebuildRequest;
    this.cancelPendingMediaCandidateReadiness();
    this.clearNextTrackBuffer();
    this.clearRegionBoundaryTimer();
    this.clearBufferMonitoring();
    const isGraphRebuildOwnerCurrent = () => {
      if (graphRebuildRequest) return this.isGraphRebuildRequestOwnerCurrent(graphRebuildRequest);
      return graphRebuildGeneration === this.graphRebuildGeneration;
    };
    const isGraphRebuildCurrent = () => {
      if (!isGraphRebuildOwnerCurrent()) {
        return false;
      }
      const currentState = this.getCurrentState();
      const expectedTrackIndex = graphRebuildRequest?.trackIndex ?? currentTrackIndex;
      if (Number.isInteger(expectedTrackIndex) && currentState?.currentTrackIndex !== expectedTrackIndex) {
        return false;
      }
      return !currentState?.currentTrack || samePlaybackEntry(currentState.currentTrack, currentTrack);
    };
    const settleGraphRebindFailure = () => {
      const transportIntent = graphRebuildRequest?.transportIntent ?? {
        isPlaying: false,
        isPaused: !wasStopped,
        isStopped: wasStopped,
        command: null
      };
      this.detachCurrentGraphNodesForRebind();
      this.detachAudioElementForGraphRebuild();
      this.revokeCurrentObjectURL();
      this.clearActiveRegion();
      this.currentBuffer = null;
      this.currentPlaybackDecision = null;
      this.updateState({
        currentBuffer: null,
        nextBuffer: null,
        ...(transportIntent.command
          ? { currentTrackPosition: transportIntent.isStopped ? 0 : graphRebuildRequest.position }
          : {}),
        isTransitioning: false,
        transitionType: null,
        isPlaying: false,
        isPaused: !transportIntent.isStopped,
        isStopped: transportIntent.isStopped
      }, 'Audio graph rebind failed');
    };

    this.audioPlayer.audioContext = newAudioContext;
    this.originalSourceNode = this.audioManager.ioManager?.inputSourceNode ||
      this.audioManager.ioManager?.sourceNode || this.audioManager.sourceNode || null;

    if (!currentTrack) {
      this.detachCurrentGraphNodesForRebind();
      this.currentBuffer = null;
      this.clearNextTrackBuffer();
      this.updateState({
        currentBuffer: null,
        nextBuffer: null,
        isTransitioning: false,
        transitionType: null
      }, 'Audio graph rebuilt without active track');
      return;
    }

    this.updateState({
      isTransitioning: true,
      transitionType: 'audio-reset'
    }, 'Audio graph rebuild rebinding playback');

    let rebuildTrack = currentTrack;
    let rebuildDescriptor = null;
    let rebuildDecisionRecord = null;
    try {
      const revalidation = currentTrack.sourceKind === 'electron-file'
        ? await this.audioPlayer.playbackManager?.prepareCatalogTrackForGraphRebuild?.(currentTrack)
        : null;
      if (Number.isSafeInteger(revalidation?.ordinal) &&
          samePlaybackEntry(revalidation.track ?? currentTrack, graphRebuildRequest.track)) {
        graphRebuildRequest.trackIndex = revalidation.ordinal;
      }
      if (revalidation?.handled) {
        if (isGraphRebuildCurrent()) settleGraphRebindFailure();
        return;
      }
      if (!isGraphRebuildCurrent()) return;
      const isStale = typeof revalidation?.isCurrent === 'function'
        ? () => !isGraphRebuildCurrent() || !revalidation.isCurrent()
        : () => !isGraphRebuildCurrent();
      const playableTrack = revalidation?.track ?? (this.needsTrackProviderResolution(currentTrack)
        ? await this.resolveTrackProvider(currentTrack)
        : currentTrack);
      rebuildTrack = playableTrack;
      if (isStale()) return;
      const descriptor = this.createPlaybackSourceDescriptor(playableTrack);
      const policyDecision = choosePlaybackMode(descriptor);
      const previousDecision = this.currentPlaybackDecision;
      const decisionRecord = previousDecision?.mediaFallbackLocked === true &&
          samePlaybackEntry(previousDecision.playableTrack, currentTrack)
        ? {
            ...previousDecision,
            playableTrack,
            descriptor,
            committedMode: 'media',
            mediaFallbackLocked: true
          }
        : this.createPlaybackDecisionRecord(playableTrack, descriptor, policyDecision);
      rebuildDescriptor = descriptor;
      rebuildDecisionRecord = decisionRecord;

      if (decisionRecord.committedMode === 'unavailable') {
        throw new Error('Playback source is unavailable after audio graph rebuild');
      }
      if (decisionRecord.committedMode === 'media') {
        const rebound = await this.rebindAudioElementAfterGraphRebuild(
          playableTrack,
          graphRebuildRequest.position,
          wasPlaying,
          wasPaused,
          wasStopped,
          isStale,
          descriptor,
          true,
          () => graphRebuildRequest.transportIntent
        );
        if (!rebound) {
          if (isStale()) return;
          throw new Error('Media candidate could not be committed after audio graph rebuild');
        }
        if (!isStale()) this.currentPlaybackDecision = decisionRecord;
        return;
      }

      const buffer = await this.prepareTrackBuffer(playableTrack, isStale, true, descriptor);
      if (!isGraphRebuildCurrent() || !buffer) return;
      const duration = Number.isFinite(buffer.duration) ? buffer.duration : 0;
      const transportIntent = graphRebuildRequest.transportIntent;
      const clampedPosition = transportIntent.isStopped
        ? 0
        : Math.max(0, Math.min(graphRebuildRequest.position, duration));

      this.detachCurrentGraphNodesForRebind();
      this.clearNextTrackBuffer();
      this.currentPlaybackDecision = decisionRecord;
      this.currentBuffer = buffer;
      this.activeSourceGeneration = ++this.sourceGenerationSequence;
      this.updateState({
        currentTrack: playableTrack,
        currentTrackName: this.getDisplayTrackName(playableTrack),
        currentBuffer: buffer,
        nextBuffer: null,
        currentTrackDuration: duration,
        currentTrackPosition: clampedPosition,
        playbackMode: 'bufferSource',
        isTransitioning: false,
        transitionType: null,
        isPlaying: false,
        isPaused: transportIntent.isPaused || transportIntent.isPlaying,
        isStopped: transportIntent.isStopped
      }, 'Audio graph rebuilt and buffer rebound');

      let latestIntent = graphRebuildRequest.transportIntent;
      while (latestIntent.isPlaying) {
        const intentSnapshot = latestIntent;
        const activationSucceeded = await this.playBufferSource();
        if (!isGraphRebuildCurrent()) return;
        latestIntent = graphRebuildRequest.transportIntent;
        if (activationSucceeded && latestIntent.isPlaying) break;
        if (latestIntent === intentSnapshot) {
          throw new Error('Buffer playback activation failed after audio graph rebuild');
        }
      }

      if (!latestIntent.isPlaying) {
        if (this.currentBufferSource) {
          if (latestIntent.isStopped) await this.stopBufferSource();
          else await this.pauseBufferSource();
        } else {
          this.maintainSilentSource();
        }
        this.updateState({
          currentBufferSource: null,
          currentTrackPosition: graphRebuildRequest.position,
          isPlaying: false,
          isPaused: latestIntent.isPaused,
          isStopped: latestIntent.isStopped,
          isTransitioning: false,
          transitionType: null
        }, 'Audio graph rebuild settled latest buffer transport');
      }

      latestIntent = graphRebuildRequest.transportIntent;
      if (!latestIntent.isStopped) {
        this.prepareNextTrackBufferWithRepeatMode();
      }
    } catch (error) {
      if (!isGraphRebuildCurrent()) return;
      const playableTrack = rebuildTrack;
      const descriptor = rebuildDescriptor ?? this.createPlaybackSourceDescriptor(playableTrack);
      const decisionRecord = rebuildDecisionRecord ??
        this.createPlaybackDecisionRecord(playableTrack, descriptor, choosePlaybackMode(descriptor));
      if (decisionRecord.committedMode === 'media' ||
          !decisionRecord.decision.allowMediaFallback || decisionRecord.mediaFallbackLocked === true) {
        console.error('[AudioContextManager] Audio graph rebind failed:', error);
        settleGraphRebindFailure();
        return;
      }
      console.warn('[AudioContextManager] Buffer rebind after audio graph rebuild failed, falling back to audio element:', error);
      try {
        const fallbackRecord = decisionRecord;
        fallbackRecord.committedMode = 'media';
        fallbackRecord.mediaFallbackLocked = true;
        const rebound = await this.rebindAudioElementAfterGraphRebuild(
          playableTrack,
          graphRebuildRequest.position,
          wasPlaying,
          wasPaused,
          wasStopped,
          () => !isGraphRebuildCurrent(),
          descriptor,
          true,
          () => graphRebuildRequest.transportIntent
        );
        if (!rebound) {
          if (!isGraphRebuildCurrent()) return;
          throw new Error('Fallback media candidate could not be committed after audio graph rebuild');
        }
        if (isGraphRebuildCurrent()) this.currentPlaybackDecision = fallbackRecord;
      } catch (fallbackError) {
        if (!isGraphRebuildCurrent()) return;
        console.error('[AudioContextManager] Audio element rebind after graph rebuild failed:', fallbackError);
        settleGraphRebindFailure();
      }
    } finally {
      if (this.activeGraphRebuildRequest === graphRebuildRequest) {
        this.activeGraphRebuildRequest = null;
      }
    }
  }

  /**
   * Fallback path for tracks that cannot be decoded into an AudioBuffer.
   */
  async rebindAudioElementAfterGraphRebuild(
    track,
    position,
    wasPlaying,
    wasPaused,
    wasStopped,
    isStale = null,
    descriptor = null,
    alreadyResolved = false,
    getTransportIntent = null
  ) {
    if (isStale?.()) return false;
    const playableTrack = alreadyResolved ? track : await this.resolveTrackProvider(track);
    if (isStale?.() || !playableTrack) return false;
    const playbackDescriptor = descriptor ?? this.createPlaybackSourceDescriptor(playableTrack);
    const sourceGeneration = ++this.sourceGenerationSequence;
    const prepared = { playableTrack, descriptor: playbackDescriptor };
    let candidate = null;
    let preflight = null;
    try {
      candidate = await this.prepareMediaTransitionCandidate(
        prepared,
        sourceGeneration,
        () => isStale?.() === true
      );
      if (!candidate || isStale?.()) return false;

      const duration = Number.isFinite(candidate.element.duration) ? candidate.element.duration : 0;
      const applyTransportIntent = () => {
        const transportIntent = getTransportIntent?.() ?? {
          isPlaying: wasPlaying,
          isPaused: wasPaused,
          isStopped: wasStopped,
          position
        };
        const logicalPosition = transportIntent.isStopped
          ? 0
          : clampLogicalTime(candidate.region, transportIntent.position);
        const mediaPosition = logicalTimeToMediaTime(candidate.region, logicalPosition);
        candidate.element.currentTime = duration > 0
          ? Math.max(0, Math.min(mediaPosition, duration))
          : Math.max(0, mediaPosition);
        if (!transportIntent.isPlaying && candidate.element.paused === false) {
          candidate.element.pause();
        }
        return { logicalPosition, transportIntent };
      };

      let commitIntent = applyTransportIntent();
      if (commitIntent.transportIntent.isPlaying) await candidate.element.play();
      if (isStale?.() || candidate.element.error) return false;
      commitIntent = applyTransportIntent();

      preflight = this.prepareMutedCandidateCommit(candidate, true);
      if (!preflight) return false;
      if (isStale?.()) {
        this.rollbackPlayerSourceOwnership(preflight.ownership);
        preflight = null;
        return false;
      }
      commitIntent = applyTransportIntent();

      const statePatch = {
        currentTrack: playableTrack,
        currentTrackName: this.getDisplayTrackName(playableTrack),
        artworkUrl: '',
        currentBuffer: null,
        nextBuffer: null,
        currentTrackDuration: candidate.region?.durationSec ?? duration,
        currentTrackPosition: commitIntent.logicalPosition,
        playbackMode: 'audioElement',
        isTransitioning: false,
        transitionType: null,
        isPlaying: commitIntent.transportIntent.isPlaying,
        isPaused: commitIntent.transportIntent.isPaused,
        isStopped: commitIntent.transportIntent.isStopped
      };

      this.teardownCommittedBackendForTransition(candidate);
      this.setPrivatePipelineSourceMuted(candidate.source, false);
      this.commitPlayerSourceOwnership(preflight.managedSource, preflight.ownership);
      this.currentBuffer = null;
      this.clearNextTrackBuffer();
      this.activeSourceGeneration = sourceGeneration;
      this.audioPlayer.audioElement = candidate.element;
      this.mediaSource = candidate.source;
      this.mediaSourceGeneration++;
      this.currentObjectURL = candidate.objectURL;
      this.setupEventHandlers();
      this.setValidatedActiveRegion(playableTrack, sourceGeneration);
      this.setupMediaSessionHandlers();
      this.updateState(statePatch, 'Audio graph rebuilt and audio element rebound');

      candidate.committed = true;
      this.loadMetadata(playableTrack, null, this.getCurrentState()?.currentTrackIndex);
      if (this.activeRegion) {
        this.prepareRegionTransportPlan(this.activeRegion);
        this.armRegionBoundaryTimer();
      }
      return true;
    } finally {
      if (preflight && !candidate?.committed) {
        this.rollbackPlayerSourceOwnership(preflight.ownership);
      }
      if (candidate && !candidate.committed) this.cleanupPreparedTransitionCandidate(candidate);
    }
  }
  
  // ===== STATE MANAGEMENT =====
  
  /**
   * Get current state from StateManager (single source of truth)
   */
  getCurrentState() {
    return this.audioPlayer.stateManager?.getStateSnapshot() || null;
  }
  
  /**
   * Update StateManager state (single source of truth)
   */
  updateState(updates, logMessage = null) {
    if (!this.audioPlayer.stateManager) {
      return;
    }
    if (updates &&
      Object.prototype.hasOwnProperty.call(updates, 'artworkUrl') &&
      this.currentArtworkURL &&
      updates.artworkUrl !== this.currentArtworkURL) {
      this.clearArtworkURL();
    }
    this.audioPlayer.stateManager.updateState(updates, logMessage);
  }

  getPlaylist() {
    return this.audioPlayer.playbackManager?.playlist || [];
  }

  normalizePlaylistIndex(index) {
    const playlist = this.getPlaylist();
    if (Number.isInteger(index) && index >= 0 && index < playlist.length) {
      return index;
    }
    return -1;
  }

  getPlaylistIdentityIndex(track) {
    const playbackManager = this.audioPlayer.playbackManager;
    if (typeof playbackManager?.getTrackIndex === 'function') {
      return playbackManager.getTrackIndex(track, true);
    }
    const playlist = this.getPlaylist();
    return typeof playlist.findIndex === 'function'
      ? playlist.findIndex(playlistTrack => playlistTrack === track)
      : -1;
  }

  getPlaylistTrackAt(index) {
    const normalizedIndex = this.normalizePlaylistIndex(index);
    if (normalizedIndex < 0) return null;
    return this.audioPlayer.playbackManager?.getTrack?.(normalizedIndex) ??
      this.getPlaylist()[normalizedIndex] ??
      null;
  }

  playbackEntriesMatch(left, right, targetIndex = null) {
    if (!left || !right) return false;

    const normalizedTargetIndex = this.normalizePlaylistIndex(targetIndex);
    const targetTrack = this.getPlaylistTrackAt(targetIndex);
    if (targetTrack) {
      const leftIndex = this.getPlaylistIdentityIndex(left);
      const rightIndex = this.getPlaylistIdentityIndex(right);
      if (leftIndex >= 0 && leftIndex !== normalizedTargetIndex) return false;
      if (rightIndex >= 0 && rightIndex !== normalizedTargetIndex) return false;
      if (left === right && leftIndex < 0 && rightIndex < 0) return true;
      return (left === targetTrack || samePlaybackEntry(left, targetTrack)) &&
        (right === targetTrack || samePlaybackEntry(right, targetTrack));
    }

    if (left === right) return true;

    const leftIndex = this.getPlaylistIdentityIndex(left);
    const rightIndex = this.getPlaylistIdentityIndex(right);
    if (leftIndex >= 0 && rightIndex >= 0) {
      return leftIndex === rightIndex;
    }

    return samePlaybackEntry(left, right);
  }

  beginLoadRequest(track, targetIndex = null) {
    this.graphRebuildGeneration += 1;
    this.cancelPendingMediaCandidateReadiness();
    const request = {
      token: ++this.loadRequestToken,
      track,
      targetIndex: this.normalizePlaylistIndex(targetIndex),
      sourceGeneration: ++this.sourceGenerationSequence
    };
    this.activeLoadRequest = request;
    this.clearNextTrackBuffer();
    return request;
  }

  cancelPendingMediaCandidateReadiness() {
    for (const cancel of [...this.pendingMediaCandidateReadiness]) cancel();
  }

  isActiveLoadRequest(request) {
    return !!request &&
      this.activeLoadRequest?.token === request.token &&
      this.activeLoadRequest?.sourceGeneration === request.sourceGeneration &&
      this.playbackEntriesMatch(this.activeLoadRequest.track, request.track, request.targetIndex);
  }

  beginTransitionRequest(track, targetIndex = null) {
    this.graphRebuildGeneration += 1;
    this.cancelPendingMediaCandidateReadiness();
    this.clearRegionBoundaryTimer();
    this.cancelScheduledBufferTransition();
    const request = {
      token: ++this.transitionRequestToken,
      track,
      targetIndex: this.normalizePlaylistIndex(targetIndex),
      sourceGeneration: ++this.sourceGenerationSequence
    };
    this.activeTransitionRequest = request;
    return request;
  }

  invalidateAutomaticMoveForManualCommand() {
    this.clearNextTrackBuffer();
    this.invalidatePendingTransitionRequests();
  }

  isActiveTransitionRequest(request) {
    return !!request &&
      this.activeTransitionRequest?.token === request.token &&
      this.activeTransitionRequest?.sourceGeneration === request.sourceGeneration &&
      this.playbackEntriesMatch(this.activeTransitionRequest.track, request.track, request.targetIndex);
  }

  invalidatePendingTransitionRequests() {
    this.transitionRequestToken++;
    this.activeTransitionRequest = null;
  }

  isGraphRebuildRequestOwnerCurrent(request) {
    if (!request || this.activeGraphRebuildRequest !== request ||
        request.generation !== this.graphRebuildGeneration) {
      return false;
    }
    const state = this.getCurrentState();
    return (state?.transportCommandGeneration ?? 0) === request.transportCommandGeneration;
  }

  getCurrentGraphRebuildRequest() {
    const request = this.activeGraphRebuildRequest;
    if (!this.isGraphRebuildRequestOwnerCurrent(request)) return null;
    const state = this.getCurrentState();
    if (Number.isInteger(request.trackIndex) && state?.currentTrackIndex !== request.trackIndex) {
      return null;
    }
    return !state?.currentTrack || samePlaybackEntry(state.currentTrack, request.track)
      ? request
      : null;
  }

  hasActiveGraphRebuildRequest() {
    return this.getCurrentGraphRebuildRequest() !== null;
  }

  setGraphRebuildTransportIntent(command) {
    const request = this.getCurrentGraphRebuildRequest();
    if (!request) return null;
    if (command === 'stop') request.position = 0;
    request.transportIntent = {
      isPlaying: command === 'play',
      isPaused: command === 'pause',
      isStopped: command === 'stop',
      command,
      position: request.position
    };
    return request;
  }

  invalidateGraphRebuild(transportIntent = null) {
    if (transportIntent && this.setGraphRebuildTransportIntent(transportIntent)) return true;
    this.graphRebuildGeneration += 1;
    return false;
  }

  invalidatePendingPlaybackOperations(transportIntent = null) {
    const preserveGraphRebuild = this.invalidateGraphRebuild(transportIntent);
    this.clearRegionBoundaryTimer();
    this.stopRequestToken++;
    this.loadRequestToken++;
    this.activeLoadRequest = null;
    this.metadataRequestToken++;
    this.activeMetadataRequest = null;
    if (!preserveGraphRebuild) this.cancelPendingMediaCandidateReadiness();
    this.invalidatePendingTransitionRequests();
    this.clearNextTrackBuffer();
  }

  invalidatePendingPlaybackOperationsForStop() {
    this.invalidatePendingPlaybackOperations('stop');
  }

  invalidatePendingPlaybackOperationsForPause() {
    const preserveGraphRebuild = this.invalidateGraphRebuild('pause');
    this.clearRegionBoundaryTimer();
    this.stopRequestToken++;
    this.loadRequestToken++;
    this.activeLoadRequest = null;
    this.metadataRequestToken++;
    this.activeMetadataRequest = null;
    if (!preserveGraphRebuild) this.cancelPendingMediaCandidateReadiness();
    this.invalidatePendingTransitionRequests();
    this.cancelScheduledBufferTransition();
  }

  invalidatePendingPlaybackOperationsForDisconnect() {
    this.invalidatePendingPlaybackOperations();
  }

  beginMetadataRequest(track, loadRequest = null, targetIndex = null) {
    const request = {
      token: ++this.metadataRequestToken,
      track,
      loadRequest,
      targetIndex: this.normalizePlaylistIndex(targetIndex)
    };
    this.activeMetadataRequest = request;
    return request;
  }

  isActiveMetadataRequest(request) {
    if (!request ||
      this.activeMetadataRequest?.token !== request.token ||
      !samePlaybackEntry(this.activeMetadataRequest.track, request.track)) {
      return false;
    }
    if (request.loadRequest && !this.isActiveLoadRequest(request.loadRequest)) {
      return false;
    }
    return this.isCurrentTrackRequestTrack(request.track, request.targetIndex);
  }

  isMetadataRequestCurrent(request, fallbackIndex = null) {
    if (request) return this.isActiveMetadataRequest(request);
    return fallbackIndex === this.audioPlayer.stateManager?.getCurrentTrackIndex?.();
  }

  isCurrentTrackRequestTrack(track, targetIndex = null) {
    const stateTrack = this.getCurrentState()?.currentTrack;
    if (stateTrack) {
      if (stateTrack === track || samePlaybackEntry(stateTrack, track)) return true;

      const stateIndex = this.getPlaylistIdentityIndex(stateTrack);
      const trackIndex = this.getPlaylistIdentityIndex(track);
      if (stateIndex >= 0 && trackIndex >= 0) {
        return stateIndex === trackIndex;
      }
      return false;
    }

    const normalizedTargetIndex = this.normalizePlaylistIndex(targetIndex);
    const currentIndex = this.audioPlayer.stateManager?.getCurrentTrackIndex?.();
    if (normalizedTargetIndex >= 0 && currentIndex !== normalizedTargetIndex) return false;
    if (Number.isInteger(currentIndex) && currentIndex >= 0) {
      const playlistTrack = this.audioPlayer.playbackManager?.getTrack?.(currentIndex) ||
        this.audioPlayer.playbackManager?.playlist?.[currentIndex];
      if (playlistTrack) {
        return this.playbackEntriesMatch(playlistTrack, track, normalizedTargetIndex);
      }
    }

    return true;
  }

  beginNextBufferRequest(track, targetIndex = null) {
    this.cancelScheduledBufferTransition();
    const request = {
      token: ++this.nextBufferRequestToken,
      track,
      targetIndex: this.normalizePlaylistIndex(targetIndex)
    };
    this.activeNextBufferRequest = request;
    this.nextBuffer = null;
    return request;
  }

  isActiveNextBufferRequest(request) {
    return !!request &&
      this.activeNextBufferRequest?.token === request.token &&
      this.playbackEntriesMatch(this.activeNextBufferRequest.track, request.track, request.targetIndex);
  }

  isExpectedNextBufferRequest(request) {
    return this.isActiveNextBufferRequest(request) &&
      this.playbackEntriesMatch(this.getNextTrack(), request.track, request.targetIndex);
  }

  consumeNextBufferForTrack(track, targetIndex = null) {
    return this.consumePreparedNextForTrack(track, targetIndex)?.buffer ?? null;
  }

  consumePreparedNextForTrack(track, targetIndex = null) {
    const entry = this.nextBuffer;
    if (!entry ||
      entry.requestToken !== this.nextBufferRequestToken ||
      !this.playbackEntriesMatch(entry.track, track, targetIndex)) {
      return null;
    }

    this.cancelScheduledBufferTransition();
    this.nextBuffer = null;
    return entry;
  }

  getTrackIndexForPlaybackEntry(track, targetIndex = null, fallbackIndex = 0) {
    const normalizedTargetIndex = this.normalizePlaylistIndex(targetIndex);
    if (normalizedTargetIndex >= 0) return normalizedTargetIndex;

    const identityIndex = this.getPlaylistIdentityIndex(track);
    if (identityIndex >= 0) return identityIndex;

    const stateIndex = this.audioPlayer.stateManager?.getCurrentTrackIndex?.();
    const normalizedStateIndex = this.normalizePlaylistIndex(stateIndex);
    if (normalizedStateIndex >= 0) {
      const stateTrack = this.getPlaylistTrackAt(normalizedStateIndex);
      if (!stateTrack || this.playbackEntriesMatch(stateTrack, track, normalizedStateIndex)) {
        return normalizedStateIndex;
      }
    }

    const playbackManager = this.audioPlayer.playbackManager;
    const playlist = this.getPlaylist();
    const playlistIndex = typeof playbackManager?.getTrackIndex === 'function'
      ? playbackManager.getTrackIndex(track)
      : typeof playlist.findIndex === 'function'
        ? playlist.findIndex(playlistTrack => samePlaybackEntry(playlistTrack, track))
        : -1;
    if (playlistIndex >= 0) return playlistIndex;

    return fallbackIndex;
  }
  
  // ===== AUDIO ELEMENT MANAGEMENT =====
  
  /**
   * Set up audio element for a track (metadata and fallback only)
   */
  setupAudioElement(track, targetIndex = null, sourceGeneration = null, descriptor = null) {
    const currentIndex = this.getTrackIndexForPlaybackEntry(track, targetIndex);
    const nextSourceGeneration = Number.isSafeInteger(sourceGeneration)
      ? sourceGeneration
      : ++this.sourceGenerationSequence;
    const hasRegion = hasPlaybackRegionDescriptor(track);
    if (hasRegion) getPlaybackRegion(track);
    
    if (!this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement = new Audio();
      this.setupEventHandlers();
    }
    
    const mediaSource = descriptor?.mediaSource ?? track.mediaSource ?? track.file ?? track.path ?? null;
    if (isBlobObject(mediaSource)) {
      this.revokeCurrentObjectURL();
      this.currentObjectURL = URL.createObjectURL(mediaSource);
      this.audioPlayer.audioElement.src = this.currentObjectURL;
    } else if (typeof mediaSource === 'string' && mediaSource.length > 0) {
      this.revokeCurrentObjectURL();
      const formattedSource = this.getMediaElementSourceUrl(mediaSource);
      if (!formattedSource) return false;
      this.audioPlayer.audioElement.src = formattedSource;
    } else {
      return false;
    }

    this.activeSourceGeneration = nextSourceGeneration;
    if (hasRegion) {
      this.beginActiveRegion(track, nextSourceGeneration);
    } else {
      this.clearActiveRegion();
    }
    this.audioPlayer.audioElement.load();
    if (!this.connectToAudioContext()) return false;
    this.setupMediaSessionHandlers();
    
    this.updateState({
      currentTrack: track,
      currentTrackName: this.getDisplayTrackName(track),
      artworkUrl: '',
      currentTrackIndex: currentIndex,
      currentTrackDuration: this.getActivePlaybackRegion()?.durationSec ?? 0,
      currentTrackPosition: 0,
      playbackMode: 'audioElement'
    }, 'Track loaded and audio element setup completed');

    if (hasRegion && this.audioPlayer.audioElement.readyState >= 1) {
      this.handleRegionLoadedMetadata(this.audioPlayer.audioElement);
    }
    
    this.loadMetadata(track, null, currentIndex);
    return true;
  }

  getMediaElementSourceUrl(source) {
    if (this.shouldUseElectronFileRead(source)) return electronFilePathToMediaUrl(source);
    return source;
  }

  getDirectElectronMediaSource(track) {
    const source = track?.mediaSource ?? track?.path ?? null;
    return typeof source === 'string' ? this.getMediaElementSourceUrl(source) : null;
  }

  revokeCurrentObjectURL() {
    if (!this.currentObjectURL) return;
    const url = this.currentObjectURL;
    this.currentObjectURL = null;
    URL.revokeObjectURL(url);
  }
  
  /**
   * Set up event handlers for the audio element
   */
  setupEventHandlers() {
    const audioElement = this.audioPlayer.audioElement;
    if (!audioElement) return;

    const isCurrentAudioElementEvent = (event) => {
      const eventTarget = event?.target;
      return this.audioPlayer.audioElement === audioElement &&
        (!eventTarget || eventTarget === audioElement);
    };

    this.eventHandlers.ended = (event) => {
      if (!isCurrentAudioElementEvent(event)) return;
      if (this.pendingMediaActivation?.element === audioElement) {
        this.pendingMediaActivation.invalid = true;
        return;
      }
      const state = this.getCurrentState();
      if (!state?.isStopped) {
        const regionEndTime = getRegionEndTime(this.getActivePlaybackRegion());
        if (regionEndTime !== null && audioElement.currentTime >= regionEndTime) {
          void this.commitRegionBoundary(
            this.activeRegion.sourceGeneration,
            this.regionBoundaryArmToken
          );
          return;
        }
        if (this.handlePrematureRegionEnded()) return;
        this.handleTrackEnded();
      }
    };
    
    this.eventHandlers.timeupdate = (event) => {
      if (!isCurrentAudioElementEvent(event)) return;
      if (this.pendingMediaActivation?.element === audioElement) return;
      const state = this.getCurrentState();
      if (state?.playbackMode === 'audioElement') {
        if (this.activeRegion && !this.activeRegion.boundaryCommitted) {
          void this.commitRegionBoundary(
            this.activeRegion.sourceGeneration,
            this.regionBoundaryArmToken
          );
        }
        this.updateState({
          currentTrackPosition: mediaTimeToLogicalTime(
            this.getActivePlaybackRegion(),
            audioElement.currentTime
          )
        });
      }
    };
    
    this.eventHandlers.error = (e) => {
      if (!isCurrentAudioElementEvent(e)) return;
      if (this.pendingMediaActivation?.element === audioElement) {
        this.pendingMediaActivation.invalid = true;
        return;
      }
      if (this.pendingRegionMetadata?.activeRegion === this.activeRegion) {
        this.settlePendingRegionMetadata(false);
      }
      if (e.target.error && e.target.error.code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        if (window.uiManager) {
          window.uiManager.setError(`Audio playback error: ${e.target.error?.message || 'Unknown error'}`);
        }
      }
    };
    
    this.eventHandlers.loadedmetadata = (event) => {
      if (!isCurrentAudioElementEvent(event)) return;
      if (this.pendingMediaActivation?.element === audioElement) return;
      if (this.handleRegionLoadedMetadata(audioElement)) {
        this.updateTrackNameFromMetadata();
        return;
      }
      this.updateState({
        currentTrackDuration: audioElement.duration || 0
      }, 'Metadata loaded');
      this.updateTrackNameFromMetadata();
    };

    this.eventHandlers.ratechange = (event) => {
      if (!isCurrentAudioElementEvent(event)) return;
      this.armRegionBoundaryTimer();
    };
    
    audioElement.addEventListener('ended', this.eventHandlers.ended);
    audioElement.addEventListener('timeupdate', this.eventHandlers.timeupdate);
    audioElement.addEventListener('error', this.eventHandlers.error);
    audioElement.addEventListener('loadedmetadata', this.eventHandlers.loadedmetadata);
    audioElement.addEventListener('ratechange', this.eventHandlers.ratechange);
  }
  
  /**
   * Connect the audio element to the Web Audio API context
   */
  connectToAudioContext() {
    try {
      if (this.mediaSource) {
        this.releasePipelineSource(this.mediaSource);
        this.mediaSource = null;
      }
      
      try {
        this.mediaSource = this.audioPlayer.audioContext.createMediaElementSource(this.audioPlayer.audioElement);
      } catch (error) {
        if (error.name === 'InvalidStateError' && error.message.includes('already connected')) {
          const oldAudioElement = this.audioPlayer.audioElement;
          const oldSrc = oldAudioElement.src;
          const wasPlaying = !oldAudioElement.paused;

          this.detachAudioElement(oldAudioElement, { clearSource: true });
          
          this.audioPlayer.audioElement = new Audio();
          this.setupEventHandlers();
          
          if (oldSrc) {
            this.audioPlayer.audioElement.src = oldSrc;
          }
          
          this.mediaSource = this.audioPlayer.audioContext.createMediaElementSource(this.audioPlayer.audioElement);
          
          if (wasPlaying) {
            this.audioPlayer.audioElement.play().catch(() => {});
          }
        } else {
          throw error;
        }
      }
      
      if (!this.connectMediaSource(this.mediaSource)) {
        this.releasePipelineSource(this.mediaSource);
        this.mediaSource = null;
        throw new Error('pipeline-source-connect-failed');
      }
      this.mediaSourceGeneration++;
      return true;
      
    } catch (error) {
      console.error('Error connecting audio element to context:', error);
      return false;
    }
  }
  
  // ===== METADATA HANDLING =====
  
  /**
   * Load metadata for a track
   */
  loadMetadata(track, loadRequest = null, targetIndex = null) {
    const metadataRequest = this.beginMetadataRequest(track, loadRequest, targetIndex);
    const currentIndex = metadataRequest.targetIndex >= 0
      ? metadataRequest.targetIndex
      : this.audioPlayer.stateManager.getCurrentTrackIndex();
    this.updateState({
      isTrackPresentationPending: true
    }, 'Track presentation metadata loading');

    if (track?.meta?.title) {
      if (!this.isActiveMetadataRequest(metadataRequest)) return;
      const displayText = this.getDisplayTrackName(track);
      const libraryManager = window.libraryManager;
      const artworkId = libraryManager?.runtime
        ? track.libraryTrackId
        : track.meta.artworkId;
      const cueArtworkUrl = this.createArtworkURL(track.meta.picture);
      const shouldLoadArtwork = !cueArtworkUrl && !!artworkId && !!libraryManager?.getArtworkThumbURL;
      this.updateState({
        currentTrackName: displayText,
        artworkUrl: cueArtworkUrl,
        isTrackPresentationPending: shouldLoadArtwork
      }, 'Catalog metadata loaded');
      this.updateTrackNameDisplayText(displayText);
      if (shouldLoadArtwork) {
        libraryManager.getArtworkThumbURL(
          artworkId,
          libraryManager.runtime ? { reason: 'now-playing' } : undefined
        ).then(async artworkUrl => {
          if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;
          const ownedUrl = await this.adoptLibraryArtworkURL(artworkUrl);
          const isOwnedArtworkUrl = !!ownedUrl && ownedUrl !== artworkUrl;
          if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) {
            // The request went stale while duplicating the artwork. Revoke only
            // our freshly-created owned URL so a late sibling never revokes the
            // current track's live artwork (and the duplicate does not leak).
            if (isOwnedArtworkUrl && typeof URL !== 'undefined' &&
              typeof URL.revokeObjectURL === 'function') {
              try {
                URL.revokeObjectURL(ownedUrl);
              } catch (_) {
                // Ignore revoke failures for stale URLs.
              }
            }
            return;
          }
          if (isOwnedArtworkUrl) {
            // Install as the current owned URL, revoking the previous owned URL.
            this.clearArtworkURL();
            this.currentArtworkURL = ownedUrl;
          }
          this.updateState({
            artworkUrl: ownedUrl || '',
            isTrackPresentationPending: false
          }, 'Catalog artwork loaded');
        }).catch(() => {
          if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;
          this.updateState({
            artworkUrl: '',
            isTrackPresentationPending: false
          }, 'Catalog artwork unavailable');
        });
      }
      this.updateMediaSessionWithTags(
        track.meta.title,
        track.meta.artist || '',
        track.meta.album || '',
        cueArtworkUrl
      );
      return;
    }
    
    if (isFileObject(track.file)) {
      this.readID3Tags(track.file, currentIndex, metadataRequest);
    } else {
      this.tryReadFromAudioElementSrc(track, currentIndex, metadataRequest);
    }
  }
  
  /**
   * Read ID3 tags from a file
   */
  readID3Tags(file, currentIndex, metadataRequest = null) {
    const riffInfoPromise = this.createRiffInfoMetadataPromise(file);
    const applyMetadata = (tags = {}, riffInfo = null) => {
      if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return false;

      const title = riffInfo?.title || this.normalizeMetadataTagText(tags.title || '', [file.name]);
      const tagReferenceTexts = [title, file.name];
      const artist = riffInfo?.artist || this.normalizeMetadataTagText(tags.artist || '', tagReferenceTexts);
      const album = riffInfo?.album || this.normalizeMetadataTagText(tags.album || '', tagReferenceTexts);
      const artworkUrl = this.createArtworkURL(tags.picture);
      const displayText = title ? (artist ? `${artist} - ${title}` : title) : file.name;

      this.updateState({
        currentTrackName: displayText,
        artworkUrl,
        isTrackPresentationPending: false
      }, 'ID3 metadata loaded');
      this.updateTrackNameDisplayText(displayText);

      this.updateMediaSessionWithTags(title || file.name, artist, album, artworkUrl);
      return true;
    };
    const applyRiffInfoFallback = riffInfo => {
      if (riffInfo && applyMetadata({}, riffInfo)) return;
      this.fallbackToMediaSession(currentIndex, metadataRequest);
    };

    if (window.jsmediatags) {
      window.jsmediatags.read(file, {
        onSuccess: (tag) => {
          const tags = tag.tags || {};
          if (riffInfoPromise) {
            riffInfoPromise.then(riffInfo => applyMetadata(tags, riffInfo));
          } else {
            applyMetadata(tags, null);
          }
        },
        onError: (error) => {
          if (error && error.type !== 'tagFormat') {
            console.warn('Error reading ID3 tags:', error);
          }
          if (riffInfoPromise) {
            riffInfoPromise.then(applyRiffInfoFallback);
          } else {
            this.fallbackToMediaSession(currentIndex, metadataRequest);
          }
        }
      });
    } else if (riffInfoPromise) {
      riffInfoPromise.then(applyRiffInfoFallback);
    } else {
      this.fallbackToMediaSession(currentIndex, metadataRequest);
    }
  }
  
  /**
   * Try to read metadata from audio element src
   */
  tryReadFromAudioElementSrc(track, currentIndex, metadataRequest = null) {
    setTimeout(() => {
      if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;
      
      try {
        if (window.jsmediatags && this.audioPlayer.audioElement.src) {
          window.jsmediatags.read(this.audioPlayer.audioElement.src, {
            onSuccess: (tag) => {
              if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;

              const tags = tag.tags;
              const title = this.normalizeMetadataTagText(tags.title || '', [track.name]);
              const tagReferenceTexts = [title, track.name];
              const artist = this.normalizeMetadataTagText(tags.artist || '', tagReferenceTexts);
              const album = this.normalizeMetadataTagText(tags.album || '', tagReferenceTexts);
              const artworkUrl = this.createArtworkURL(tags.picture);
              const displayText = title ? (artist ? `${artist} - ${title}` : title) : track.name;
              
              this.updateState({
                currentTrackName: displayText,
                artworkUrl,
                isTrackPresentationPending: false
              }, 'Source metadata loaded');
              this.updateTrackNameDisplayText(displayText);
              
              this.updateMediaSessionWithTags(title || track.name, artist, album, artworkUrl);
            },
            onError: (error) => {
              if (error && error.type !== 'tagFormat') {
                console.warn('Error reading ID3 tags from src:', error);
              }
              this.fallbackToMediaSession(currentIndex, metadataRequest);
            }
          });
        } else {
          this.fallbackToMediaSession(currentIndex, metadataRequest);
        }
      } catch (error) {
        console.warn('Error reading metadata from audio element src:', error);
        this.fallbackToMediaSession(currentIndex, metadataRequest);
      }
    }, 500);
  }
  
  /**
   * Update MediaSession API with metadata
   */
  updateMediaSessionWithTags(title, artist, album, artworkUrl = '') {
    if (this.audioPlayer?.mediaSessionManager?.updateMetadataFromTags) {
      this.audioPlayer.mediaSessionManager.updateMetadataFromTags(title, artist, album, artworkUrl);
      return;
    }

    const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
    if (navigatorRef && 'mediaSession' in navigatorRef && typeof MediaMetadata !== 'undefined') {
      const metadata = {
        title: title || 'Unknown Title',
        artist: artist || 'Unknown Artist',
        album: album || 'Unknown Album'
      };
      if (artworkUrl) {
        metadata.artwork = [{ src: artworkUrl }];
      }
      navigatorRef.mediaSession.metadata = new MediaMetadata({
        ...metadata
      });
      
      const state = this.getCurrentState();
      navigatorRef.mediaSession.playbackState = state?.isPlaying ? 'playing' : 'paused';
      this.setupMediaSessionHandlers();
    }
  }

  updateTrackNameDisplayText(displayText) {
    const playerUi = this.audioPlayer.ui;
    if (typeof playerUi?.setTrackNameDisplayText === 'function') {
      playerUi.setTrackNameDisplayText(displayText);
    } else if (playerUi?.trackNameDisplay) {
      playerUi.trackNameDisplay.textContent = displayText;
    }
  }

  createArtworkURL(picture) {
    if (!picture?.data?.length || !picture.format || typeof Blob === 'undefined' || typeof URL === 'undefined') {
      this.clearArtworkURL();
      return '';
    }

    try {
      this.clearArtworkURL();
      const bytes = picture.data instanceof Uint8Array ? picture.data : new Uint8Array(picture.data);
      const blob = new Blob([bytes], { type: picture.format });
      this.currentArtworkURL = URL.createObjectURL(blob);
      return this.currentArtworkURL;
    } catch (error) {
      console.warn('Failed to create artwork URL:', error);
      this.clearArtworkURL();
      return '';
    }
  }

  /**
   * Duplicate a library artwork object URL into a player-owned object URL so
   * the library cache can revoke its copy without breaking the player state
   * or MediaSession artwork.
   */
  async adoptLibraryArtworkURL(artworkUrl) {
    if (!artworkUrl) return '';
    if (typeof fetch !== 'function' || typeof URL === 'undefined' ||
      typeof URL.createObjectURL !== 'function') {
      return artworkUrl;
    }
    try {
      const response = await fetch(artworkUrl);
      const blob = await response.blob();
      // Only create and return the owned URL. The caller installs it as
      // this.currentArtworkURL after re-checking staleness, or revokes it if
      // the request went stale, so a late sibling never revokes the current
      // track's live artwork URL.
      return URL.createObjectURL(blob);
    } catch (_) {
      // Fall back to the shared cache URL if duplication fails.
      return artworkUrl;
    }
  }

  clearArtworkURL() {
    if (this.currentArtworkURL && typeof URL !== 'undefined') {
      try {
        URL.revokeObjectURL(this.currentArtworkURL);
      } catch (error) {
        // Ignore stale object URLs.
      }
    }
    this.currentArtworkURL = null;
  }
  
  /**
   * Set up MediaSession API action handlers for media controls
   */
  setupMediaSessionHandlers() {
    if (this.audioPlayer?.mediaSessionManager?.setupActionHandlers) {
      this.audioPlayer.mediaSessionManager.setupActionHandlers();
      return;
    }

    const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
    if (!navigatorRef || !('mediaSession' in navigatorRef)) return;
    
    navigatorRef.mediaSession.setActionHandler('play', () => {
      this.audioPlayer?.resumeAudioContextInGesture?.();
      const result = this.play();
      navigatorRef.mediaSession.playbackState = 'playing';
      return result;
    });
    
    navigatorRef.mediaSession.setActionHandler('pause', () => {
      const result = this.pause();
      navigatorRef.mediaSession.playbackState = 'paused';
      return result;
    });
    
    navigatorRef.mediaSession.setActionHandler('nexttrack', () => {
      return this.audioPlayer.playNext();
    });
    
    navigatorRef.mediaSession.setActionHandler('previoustrack', () => {
      return this.audioPlayer.playPrevious();
    });
    
    navigatorRef.mediaSession.setActionHandler('stop', () => {
      const result = this.stop();
      navigatorRef.mediaSession.playbackState = 'paused';
      return result;
    });
    
    navigatorRef.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        this.audioPlayer?.resumeAudioContextInGesture?.();
        return this.seek(details.seekTime);
      }
      return undefined;
    });
  }
  
  /**
   * Fallback to MediaSession API with basic track info
   */
  fallbackToMediaSession(currentIndex, metadataRequest = null) {
    if (!this.isMetadataRequestCurrent(metadataRequest, currentIndex)) return;

    const track = metadataRequest?.track ?? this.audioPlayer.playbackManager?.getTrack(currentIndex);
    if (track?.meta?.title) return;

    if (this.audioPlayer.audioElement?.duration > 0) {
      if (this.audioPlayer.audioElement.title) {
        this.clearArtworkURL();
        this.updateState({
          currentTrackName: this.audioPlayer.audioElement.title,
          artworkUrl: '',
          isTrackPresentationPending: false
        }, 'Audio element metadata fallback');
        this.updateTrackNameDisplayText(this.audioPlayer.audioElement.title);
        this.updateMediaSessionWithTags(this.audioPlayer.audioElement.title, '', '', '');
        return;
      }
    }
    
    if (track && track.name) {
      const displayText = this.getDisplayTrackName(track);
      this.clearArtworkURL();
      this.updateState({
        currentTrackName: displayText,
        artworkUrl: '',
        isTrackPresentationPending: false
      }, 'Track name metadata fallback');
      this.updateTrackNameDisplayText(displayText);
      this.updateMediaSessionWithTags(displayText, '', '', '');
      return;
    }

    this.updateState({
      isTrackPresentationPending: false
    }, 'Track presentation metadata fallback completed');
  }
  
  /**
   * Update track name from audio metadata
   */
  updateTrackNameFromMetadata() {
    if (!this.audioPlayer.audioElement) return;
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    this.fallbackToMediaSession(currentIndex);
  }

  // ===== PLAYBACK CONTROL =====
  
  /**
   * Play current track
   */
  async play(forcePlay = false, userInitiated = true) {
    const graphRebuildRequest = this.setGraphRebuildTransportIntent('play');
    if (graphRebuildRequest) {
      this.updateState({
        currentTrackPosition: graphRebuildRequest.position,
        isPlaying: false,
        isPaused: true,
        isStopped: false,
        isTransitioning: false,
        transitionType: null
      }, 'Playback queued during audio graph rebuild');
      return true;
    }

    const state = this.getCurrentState();
    if (state?.isTransitioning && !forcePlay) {
      return false;
    }

    const stopToken = this.stopRequestToken;
    if (!await this.resumePlaybackAudioContext(userInitiated)) return false;
    if (this.stopRequestToken !== stopToken) {
      return false;
    }
    
    const currentState = this.getCurrentState();
    if (currentState?.playbackMode === 'bufferSource') {
      return this.playBufferSource(stopToken);
    } else {
      return this.playAudioElement(stopToken);
    }
  }
  
  /**
   * Play using buffer source
   */
  async playBufferSource(stopToken = this.stopRequestToken) {
    if (!this.currentBuffer) {
      return false;
    }

    const buffer = this.currentBuffer;
    const sourceGeneration = this.activeSourceGeneration || ++this.sourceGenerationSequence;
    if (this.activeSourceGeneration === 0) this.activeSourceGeneration = sourceGeneration;
    const initialState = this.getCurrentState();
    const resumePosition = initialState?.isPaused ? initialState.currentTrackPosition : 0;
    let stage = null;
    let candidateSource = null;
    let candidateEnded = false;
    let committed = false;

    try {
      stage = await this.stagePlaybackActivation('buffer-source', sourceGeneration, resumePosition);
      if (this.stopRequestToken !== stopToken || this.currentBuffer !== buffer ||
        this.activeSourceGeneration !== sourceGeneration) {
        return false;
      }
      await this.stopCurrentPlayback();
      if (this.stopRequestToken !== stopToken) {
        return false;
      }

      const instanceId = this.currentInstanceId;
      candidateSource = this.createBufferSource(buffer, instanceId, {
        privateUntilCommit: !!stage,
        isCommitted: () => committed,
        onPendingEnded: () => { candidateEnded = true; }
      });
      this.pendingBufferSource = candidateSource;
      const currentTime = this.audioPlayer.audioContext.currentTime;
      candidateSource.start(currentTime, resumePosition);

      if (stage) {
        const result = await this.audioManager.activateStagedAudioCandidate(stage, {
          acquire: () => candidateSource,
          isCandidateCurrent: source => source === candidateSource &&
            !candidateEnded &&
            this.pendingBufferSource === candidateSource &&
            this.currentBuffer === buffer &&
            this.activeSourceGeneration === sourceGeneration &&
            this.stopRequestToken === stopToken &&
            this.isPipelineSourceConnected(candidateSource),
          commit: () => {
            if (!this.setPrivatePipelineSourceMuted(candidateSource, false)) {
              throw new Error('private-pipeline-source-publish-failed');
            }
            committed = true;
            this.pendingBufferSource = null;
            this.currentBufferSource = candidateSource;
            this.bufferStartTime = currentTime - resumePosition;
            this.bufferDuration = buffer.duration;
            this.updateState({
              isPlaying: true,
              isPaused: false,
              isStopped: false,
              currentInstanceId: instanceId,
              playbackInstanceId: instanceId,
              bufferStartTime: currentTime - resumePosition,
              bufferDuration: buffer.duration
            }, 'Buffer source playback activation committed');
            return true;
          },
          cleanup: source => {
            if (this.pendingBufferSource === source) this.pendingBufferSource = null;
            this.releasePipelineSource(source, true);
          }
        });
        if (!result.activated) return false;
      } else {
        committed = true;
        this.pendingBufferSource = null;
        this.currentBufferSource = candidateSource;
        this.bufferStartTime = currentTime - resumePosition;
        this.bufferDuration = buffer.duration;
        this.updateState({
          isPlaying: true,
          isPaused: false,
          isStopped: false,
          currentInstanceId: instanceId,
          playbackInstanceId: instanceId,
          bufferStartTime: currentTime - resumePosition,
          bufferDuration: buffer.duration
        }, 'Buffer source playback started');
      }

      this.setupBufferMonitoring();
      this.rearmPreparedAutomaticMove();
      return true;

    } catch (error) {
      if (candidateSource && !committed) {
        if (this.pendingBufferSource === candidateSource) this.pendingBufferSource = null;
        this.releasePipelineSource(candidateSource, true);
      }
      if (this.stopRequestToken !== stopToken) {
        return false;
      }
      console.error('[AudioContextManager] Buffer source playback failed:', error);
      this.updateState({
        isPlaying: false,
        isPaused: true,
        isStopped: false
      }, 'Buffer source playback failed');
      return false;
    } finally {
      this.releasePlaybackActivationStage(stage);
    }
  }
  
  /**
   * Play using audio element
   */
  async playAudioElement(stopToken = this.stopRequestToken) {
    const audioElement = this.audioPlayer.audioElement;
    if (!audioElement) {
      return false;
    }

    const sourceGeneration = this.activeSourceGeneration || ++this.sourceGenerationSequence;
    const mediaSource = this.mediaSource;
    const mediaSourceGeneration = this.mediaSourceGeneration;
    if (!this.ensurePipelineSourceConnected(mediaSource)) return false;
    const intendedPosition = Number.isFinite(audioElement.currentTime) ? audioElement.currentTime : 0;
    let stage = null;
    let pendingActivation = null;

    try {
      stage = await this.stagePlaybackActivation('html-media', sourceGeneration, intendedPosition);
      if (this.stopRequestToken !== stopToken || this.audioPlayer.audioElement !== audioElement ||
        this.mediaSource !== mediaSource || this.mediaSourceGeneration !== mediaSourceGeneration) {
        return false;
      }
      if (stage && !this.connectPrivatePipelineSource(mediaSource, { replaceDirectRoute: true })) {
        return false;
      }
      if (stage && !this.getUseInputWithPlayer()) {
        this.setManagedSourceNode(this.getPipelineSourceNode(mediaSource));
      } else if (!stage && !this.setPrivatePipelineSourceMuted(mediaSource, false)) {
        return false;
      }
      pendingActivation = {
        element: audioElement,
        mediaSource,
        mediaSourceGeneration,
        sourceGeneration,
        invalid: false
      };
      this.pendingMediaActivation = pendingActivation;
      await audioElement.play();
      if (this.stopRequestToken !== stopToken || this.audioPlayer.audioElement !== audioElement) {
        if (this.pendingMediaActivation === pendingActivation) {
          this.pendingMediaActivation = null;
          try {
            audioElement.pause();
          } catch (e) {
            // Silent fail
          }
        }
        return false;
      }

      if (stage) {
        const result = await this.audioManager.activateStagedAudioCandidate(stage, {
          acquire: () => pendingActivation,
          isCandidateCurrent: candidate => candidate === pendingActivation &&
            this.pendingMediaActivation === pendingActivation &&
            candidate.invalid === false &&
            this.stopRequestToken === stopToken &&
            this.audioPlayer.audioElement === audioElement &&
            this.mediaSource === mediaSource &&
            this.mediaSourceGeneration === mediaSourceGeneration &&
            audioElement.paused === false &&
            audioElement.ended !== true &&
            this.isPipelineSourceConnected(mediaSource),
          commit: () => {
            if (!this.setPrivatePipelineSourceMuted(mediaSource, false)) {
              throw new Error('private-pipeline-source-publish-failed');
            }
            this.pendingMediaActivation = null;
            this.updateState({
              isPlaying: true,
              isPaused: false,
              isStopped: false
            }, 'Audio element playback activation committed');
            return true;
          },
          cleanup: () => {
            if (this.pendingMediaActivation === pendingActivation) {
              this.pendingMediaActivation = null;
              try { audioElement.pause(); } catch (_) { /* ignore */ }
            }
          }
        });
        if (!result.activated) return false;
      } else {
        if (this.pendingMediaActivation !== pendingActivation) return false;
        if (!this.ensurePipelineSourceConnected(mediaSource)) {
          this.pendingMediaActivation = null;
          try { audioElement.pause(); } catch (_) { /* ignore */ }
          return false;
        }
        this.pendingMediaActivation = null;
        this.updateState({
          isPlaying: true,
          isPaused: false,
          isStopped: false
        }, 'Audio element playback started');
      }
      if (this.activeRegion && !this.activeRegion.transportPlan) {
        this.prepareRegionTransportPlan(this.activeRegion);
      } else if (!this.activeRegion) {
        this.prepareNextTrackBufferWithRepeatMode();
      }
      this.armRegionBoundaryTimer();
      return true;

    } catch (error) {
      if (this.pendingMediaActivation === pendingActivation) {
        this.pendingMediaActivation = null;
        try { audioElement.pause(); } catch (_) { /* ignore */ }
      }
      if (this.stopRequestToken !== stopToken) {
        return false;
      }
      console.error('[AudioContextManager] Audio element playback failed:', error);
      this.updateState({
        isPlaying: false,
        isPaused: true,
        isStopped: false
      }, 'Audio element playback failed');
      return false;
    } finally {
      this.releasePlaybackActivationStage(stage);
    }
  }
  
  /**
   * Pause current track
   */
  async pause() {
    this.cancelScheduledBufferTransition();
    const graphRebuildRequest = this.getCurrentGraphRebuildRequest();
    if (graphRebuildRequest) {
      this.invalidatePendingPlaybackOperationsForPause();
      this.updateState({
        currentTrackPosition: graphRebuildRequest.position,
        isPlaying: false,
        isPaused: true,
        isStopped: false,
        isTransitioning: false,
        transitionType: null
      }, 'Playback paused during audio graph rebuild');
      return;
    }

    const state = this.getCurrentState();
    if (state?.isTransitioning) {
      this.invalidatePendingPlaybackOperationsForPause();
      if (state?.playbackMode === 'bufferSource') {
        await this.pauseBufferSource();
      } else {
        await this.pauseAudioElement();
      }
      this.updateState({
        isPlaying: false,
        isPaused: !state?.isStopped,
        isStopped: !!state?.isStopped,
        isTransitioning: false,
        transitionType: null
      }, 'Playback paused during transition');
      return;
    }

    this.stopRequestToken++;
    
    if (state?.playbackMode === 'bufferSource') {
      await this.pauseBufferSource();
    } else {
      await this.pauseAudioElement();
    }
  }
  
  /**
   * Pause buffer source
   */
  async pauseBufferSource() {
    let currentPosition = 0;
    if (this.currentBufferSource && this.audioPlayer.audioContext) {
      const currentTime = this.audioPlayer.audioContext.currentTime;
      const elapsedTime = currentTime - this.bufferStartTime;
      currentPosition = Math.max(0, Math.min(elapsedTime, this.bufferDuration));
    }
    
    if (this.currentBufferSource) {
      this.releasePipelineSource(this.currentBufferSource, true);
      this.currentBufferSource = null;
    }
    
    this.clearBufferMonitoring();
    this.advancePlaybackInstanceToken();
    this.maintainSilentSource();
    
    this.updateState({
      isPlaying: false,
      isPaused: true,
      isStopped: false,
      currentBufferSource: null,
      currentTrackPosition: currentPosition
    }, 'Buffer source paused');
  }
  
  /**
   * Pause audio element
   */
  async pauseAudioElement() {
    this.clearRegionBoundaryTimer();
    if (this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement.pause();
    }
    
    this.updateState({
      isPlaying: false,
      isPaused: true,
      isStopped: false,
      currentTrackPosition: this.getCurrentPlaybackTime()
    }, 'Audio element paused');
  }
  
  /**
   * Stop current track
   */
  async stop() {
    const graphRebuildRequest = this.getCurrentGraphRebuildRequest();
    this.invalidatePendingPlaybackOperationsForStop();
    if (graphRebuildRequest) {
      this.updateState({
        currentTrackPosition: 0,
        isPlaying: false,
        isPaused: false,
        isStopped: true,
        isTransitioning: false,
        transitionType: null
      }, 'Playback stopped during audio graph rebuild');
      return;
    }

    const state = this.getCurrentState();
    if (state?.playbackMode === 'bufferSource') {
      await this.stopBufferSource();
    } else {
      await this.stopAudioElement();
    }
  }
  
  /**
   * Stop buffer source
   */
  async stopBufferSource() {
    if (this.currentBufferSource) {
      this.releasePipelineSource(this.currentBufferSource, true);
    }
    
    this.clearBufferMonitoring();
    this.advancePlaybackInstanceToken();
    this.maintainSilentSource();
    
    this.updateState({
      isPlaying: false,
      isPaused: false,
      isStopped: true,
      isTransitioning: false,
      transitionType: null,
      currentBufferSource: null,
      currentTrackPosition: 0
    }, 'Buffer source stopped');
  }
  
  /**
   * Stop audio element
   */
  async stopAudioElement() {
    this.clearRegionBoundaryTimer();
    if (this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement.pause();
      this.audioPlayer.audioElement.currentTime = getRegionStartTime(this.getActivePlaybackRegion());
    }
    
    this.maintainSilentSource();
    
    this.updateState({
      isPlaying: false,
      isPaused: false,
      isStopped: true,
      isTransitioning: false,
      transitionType: null,
      currentTrackPosition: 0
    }, 'Audio element stopped');
  }
  
  /**
   * Seek to position
   */
  async seek(time) {
    const graphRebuildRequest = this.getCurrentGraphRebuildRequest();
    if (graphRebuildRequest) {
      const region = getPlaybackRegion(graphRebuildRequest.track);
      const duration = Number.isFinite(region?.durationSec)
        ? region.durationSec
        : this.getCurrentState()?.currentTrackDuration;
      const clampedTime = Number.isFinite(duration)
        ? Math.max(0, Math.min(time, duration))
        : Math.max(0, time);
      const logicalTime = region ? clampLogicalTime(region, clampedTime) : clampedTime;
      graphRebuildRequest.position = logicalTime;
      graphRebuildRequest.transportIntent = {
        ...graphRebuildRequest.transportIntent,
        position: logicalTime
      };
      this.updateState({
        currentTrackPosition: logicalTime
      }, 'Playback seek queued during audio graph rebuild');
      return;
    }

    const state = this.getCurrentState();
    if (state?.isTransitioning) {
      return;
    }
    
    if (state?.playbackMode === 'bufferSource') {
      await this.seekBufferSource(time);
    } else {
      await this.seekAudioElement(time);
    }
  }
  
  /**
   * Seek in buffer source
   */
  async seekBufferSource(time) {
    if (!this.currentBuffer) {
      return;
    }
    
    const clampedTime = Math.max(0, Math.min(time, this.currentBuffer.duration));
    const state = this.getCurrentState();
    const wasPlaying = !!state?.isPlaying;
    
    try {
      await this.stopCurrentPlayback();

      if (!wasPlaying) {
        const currentTime = this.audioPlayer.audioContext?.currentTime || 0;
        this.bufferStartTime = currentTime - clampedTime;
        this.bufferDuration = this.currentBuffer.duration;
        this.currentBufferSource = null;
        this.clearBufferMonitoring();
        this.maintainSilentSource();

        this.updateState({
          isPlaying: false,
          isPaused: true,
          isStopped: false,
          currentInstanceId: this.currentInstanceId,
          playbackInstanceId: this.playbackInstanceId,
          bufferStartTime: currentTime - clampedTime,
          bufferDuration: this.currentBuffer.duration,
          currentTrackPosition: clampedTime
        }, 'Buffer source seek position updated');
        return;
      }
      
      const instanceId = this.currentInstanceId;
      
      this.currentBufferSource = this.createBufferSource(this.currentBuffer, instanceId);
      
      const currentTime = this.audioPlayer.audioContext.currentTime;
      this.currentBufferSource.start(currentTime, clampedTime);
      
      this.bufferStartTime = currentTime - clampedTime;
      this.bufferDuration = this.currentBuffer.duration;
      
      this.updateState({
        isPlaying: true,
        isPaused: false,
        isStopped: false,
        currentInstanceId: instanceId,
        playbackInstanceId: instanceId,
        bufferStartTime: currentTime - clampedTime,
        bufferDuration: this.currentBuffer.duration,
        currentTrackPosition: clampedTime
      }, 'Buffer source seek completed');
      
      this.setupBufferMonitoring();
      this.rearmPreparedAutomaticMove();
      
    } catch (error) {
      console.error('[AudioContextManager] Buffer source seek failed:', error);
      this.updateState({
        isPlaying: false,
        isPaused: true,
        isStopped: false
      }, 'Buffer source seek failed');
    }
  }
  
  /**
   * Seek in audio element
   */
  async seekAudioElement(time) {
    if (this.audioPlayer.audioElement && this.audioPlayer.audioElement.duration) {
      this.clearRegionBoundaryTimer();
      const region = this.getActivePlaybackRegion();
      const logicalTime = region
        ? clampLogicalTime(region, time)
        : Math.max(0, Math.min(time, this.audioPlayer.audioElement.duration));
      const mediaTime = logicalTimeToMediaTime(region, logicalTime);
      const state = this.getCurrentState();
      this.audioPlayer.audioElement.currentTime = mediaTime;
      
      const updates = {
        currentTrackPosition: logicalTime
      };
      if (!state?.isPlaying) {
        updates.isPlaying = false;
        updates.isPaused = true;
        updates.isStopped = false;
      }
      this.updateState(updates, 'Audio element seek completed');
      if (state?.isPlaying) this.armRegionBoundaryTimer();
    }
  }
  
  // ===== TRACK MANAGEMENT =====
  
  /**
   * Handle track ended event
   */
  handleTrackEnded() {
    const state = this.getCurrentState();
    if (state?.isStopped || state?.isTransitioning) return;
    const region = this.activeRegion;
    const regionPlan = region?.transportPlanPending !== true &&
      this.audioPlayer.playbackManager?.isPlannedAutomaticMoveCurrent?.(region?.transportPlan) === true
      ? region.transportPlan
      : null;
    const prepared = this.nextBuffer ?? this.createPreparedAutomaticMove(regionPlan);
    if (prepared?.buffer && prepared.automaticMovePlan &&
        this.schedulePreparedBufferTransition(prepared, true)) {
      return;
    }
    if (prepared?.automaticMovePlan) {
      if (this.audioPlayer.playbackManager?.isPlannedAutomaticMoveCurrent?.(
        prepared.automaticMovePlan
      ) === true) {
        void this.transitionPreparedAutomaticMove(prepared);
      }
      return;
    }
    this.audioPlayer.playbackManager?.onTrackEnded?.();
  }

  createPreparedAutomaticMove(plan) {
    if (!plan?.preparedRequest) return null;
    if (this.nextBuffer?.automaticMovePlan === plan) return this.nextBuffer;
    return {
      ...plan.preparedRequest,
      buffer: null,
      track: plan.nextTrack,
      automaticMovePlan: plan,
      targetIndex: plan.nextOrdinal
    };
  }

  transitionPreparedAutomaticMove(prepared) {
    const plan = prepared?.automaticMovePlan;
    if (!plan || this.audioPlayer.playbackManager?.isPlannedAutomaticMoveCurrent?.(plan) !== true) {
      return Promise.resolve(false);
    }
    return this.transitionToNextTrack(
      plan.nextTrack,
      plan.nextOrdinal,
      false,
      prepared,
      plan
    );
  }

  rearmPreparedAutomaticMove() {
    const prepared = this.nextBuffer;
    const playbackManager = this.audioPlayer.playbackManager;
    const state = this.getCurrentState();
    if (prepared?.automaticMovePlan &&
        playbackManager?.isPlannedAutomaticMoveCurrent?.(prepared.automaticMovePlan) === true) {
      if (prepared.buffer && state?.playbackMode === 'bufferSource' && state.isPlaying === true &&
          state.isPaused !== true && state.isStopped !== true) {
        return this.schedulePreparedBufferTransition(prepared);
      }
      return false;
    }

    if (prepared) this.clearNextTrackBuffer();
    if (state?.isPlaying === true && state.isPaused !== true && state.isStopped !== true) {
      void this.prepareNextTrackBufferWithRepeatMode();
    }
    return false;
  }
  
  /**
   * Stop current playback (internal method)
   */
  async stopCurrentPlayback() {
    this.cancelScheduledBufferTransition();
    if (this.pendingBufferSource) {
      this.releasePipelineSource(this.pendingBufferSource, true);
      this.pendingBufferSource = null;
    }
    if (this.currentBufferSource) {
      this.releasePipelineSource(this.currentBufferSource, true);
      this.currentBufferSource = null;
    }
    
    this.clearBufferMonitoring();
    this.advancePlaybackInstanceToken();
  }
  
  /**
   * Set up buffer monitoring for UI updates
   */
  setupBufferMonitoring() {
    this.clearBufferMonitoring();
    
    this.bufferMonitoringInterval = setInterval(() => {
      const state = this.getCurrentState();
      
      if (this.currentBuffer && this.audioPlayer.audioContext) {
        if (this.currentBufferSource && state?.isPlaying) {
          const currentTime = this.audioPlayer.audioContext.currentTime;
          const elapsedTime = currentTime - this.bufferStartTime;
          const position = Math.max(0, Math.min(elapsedTime, this.bufferDuration));
          
          if (this.scheduledBufferTransition && currentTime >= this.scheduledBufferTransition.boundaryTime) {
            if (this.commitScheduledBufferTransition(this.scheduledBufferTransition)) return;
          }
          
          if (this.audioPlayer.stateManager) {
            this.audioPlayer.stateManager.updateState({
              currentTrackPosition: position
            }, 'Buffer monitoring position update');
          }
        } else if (state?.isStopped && state?.currentTrackDuration > 0) {
          if (state.currentTrackPosition !== 0) {
            this.updateState({
              currentTrackPosition: 0
            }, 'Buffer monitoring reset position to 0 for stopped state');
          }
        }
      } else {
        this.clearBufferMonitoring();
      }
    }, 100);
  }
  
  /**
   * Clear buffer monitoring
   */
  clearBufferMonitoring() {
    if (this.bufferMonitoringInterval) {
      clearInterval(this.bufferMonitoringInterval);
      this.bufferMonitoringInterval = null;
    }
  }
  
  // ===== BUFFER MANAGEMENT =====
  
  /**
   * Load track and prepare buffer
   */
  async loadTrack(track, targetIndex = null, preparedRequest = null) {
    const trackIndex = this.getTrackIndexForPlaybackEntry(track, targetIndex);
    this.invalidateAutomaticMoveForManualCommand();
    const loadRequest = this.beginLoadRequest(track, trackIndex);
    const isStale = () => !this.isActiveLoadRequest(loadRequest);

    try {
      this.updateState({
        isTransitioning: true,
        transitionType: 'loading'
      }, 'Track loading started');

      const suppliedRequest = preparedRequest &&
        this.playbackEntriesMatch(preparedRequest.track, track, trackIndex)
        ? preparedRequest
        : null;
      const prepared = await this.prepareTrackTransitionRequest(
        track,
        trackIndex,
        isStale,
        suppliedRequest,
        null
      );
      if (!prepared || isStale()) return false;
      return await this.activatePreparedTrackLoad(prepared, loadRequest, isStale);
      
    } catch (error) {
      if (isStale()) return false;
      console.error('[AudioContextManager] Track loading failed:', error);
      this.updateState({
        isTransitioning: false,
        transitionType: null
      }, 'Track loading failed without replacing current playback');
      window.uiManager?.setError?.('error.playbackCommandFailed', true);
      return false;
    }
  }
  
  /**
   * Prepare track buffer
   */
  async prepareTrackBuffer(track, isStale = null, alreadyResolved = false, preparedDescriptor = null) {
    const playableTrack = alreadyResolved ? track : await this.resolveTrackProvider(track);
    if (isStale?.() || !playableTrack) return null;
    const descriptor = preparedDescriptor ?? this.createPlaybackSourceDescriptor(playableTrack);
    const decision = choosePlaybackMode(descriptor);
    if (decision.mode !== 'buffer') {
      const error = new Error('This playback source must use media element streaming');
      error.code = decision.mode === 'unavailable'
        ? 'playbackSourceUnavailable'
        : 'playbackSourceMustStream';
      throw error;
    }
    try {
      const arrayBuffer = await this.loadTrackData(descriptor, isStale, true);
      if (isStale?.() || !arrayBuffer) return null;

      const audioBuffer = await new Promise((resolve, reject) => {
        this.audioPlayer.audioContext.decodeAudioData(arrayBuffer, resolve, reject);
      });
      if (isStale?.()) return null;
      
      return audioBuffer;
    } catch (error) {
      console.error('[AudioContextManager] Buffer preparation failed for:', playableTrack?.name, error);
      throw error;
    }
  }
  
  /**
   * Load track data as ArrayBuffer
   */
  async loadTrackData(track, isStale = null, alreadyResolved = false) {
    try {
      const playableTrack = alreadyResolved ? track : await this.resolveTrackProvider(track);
      if (isStale?.()) return null;

      const materializedBytes = playableTrack.bytes ?? playableTrack.data;
      if (materializedBytes instanceof ArrayBuffer) {
        return materializedBytes;
      } else if (ArrayBuffer.isView(materializedBytes)) {
        return materializedBytes.buffer.slice(
          materializedBytes.byteOffset,
          materializedBytes.byteOffset + materializedBytes.byteLength
        );
      } else if (typeof playableTrack.readBytes === 'function') {
        const bytes = await playableTrack.readBytes();
        if (isStale?.()) return null;
        return toOwnedArrayBuffer(bytes);
      } else if (isFileObject(playableTrack.file)) {
        const arrayBuffer = await playableTrack.file.arrayBuffer();
        if (isStale?.()) return null;
        return arrayBuffer;
      } else if (playableTrack.path) {
        if (this.shouldUseElectronFileRead(playableTrack.path)) {
          const arrayBuffer = await this.loadElectronFileTrackData(
            playableTrack.path,
            playableTrack.byteLength ?? playableTrack.fileSize ?? null
          );
          if (isStale?.()) return null;
          return arrayBuffer;
        }

        const response = await fetch(playableTrack.path);
        if (isStale?.()) return null;
        if (!response.ok) {
          throw new Error(`Failed to load track: ${response.statusText}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        if (isStale?.()) return null;
        return arrayBuffer;
      } else {
        throw new Error('Invalid track: no file or path provided');
      }
    } catch (error) {
      console.error('Error loading track data:', error);
      throw error;
    }
  }

  async resolveTrackProvider(track) {
    if (!this.needsTrackProviderResolution(track)) return track;
    const resolved = await track.provider();
    const playableTrack = {
      ...track,
      ...(
        resolved?.data instanceof ArrayBuffer || ArrayBuffer.isView(resolved?.data)
          ? { data: resolved.data }
          : {}
      ),
      ...(resolved?.file ? { file: resolved.file } : {}),
      ...(resolved?.path ? { path: resolved.path } : {}),
      ...(resolved?.mediaSource !== undefined ? { mediaSource: resolved.mediaSource } : {}),
      ...(typeof resolved?.readBytes === 'function' ? { readBytes: resolved.readBytes } : {}),
      ...(resolved?.bytes instanceof ArrayBuffer || ArrayBuffer.isView(resolved?.bytes)
        ? { bytes: resolved.bytes }
        : {}),
      ...(resolved?.kind ? { sourceKind: resolved.kind } : {}),
      ...(resolved?.physicalSourceKey ? { physicalSourceKey: resolved.physicalSourceKey } : {}),
      ...(resolved?.canonicalSourceKey ? { canonicalSourceKey: resolved.canonicalSourceKey } : {}),
      ...(resolved?.sourceKey ? { sourceKey: resolved.sourceKey } : {})
    };
    for (const key of ['byteLength', 'fileSize', 'startFrame', 'endFrame', 'durationSec']) {
      if (Object.prototype.hasOwnProperty.call(resolved ?? {}, key)) playableTrack[key] = resolved[key];
    }
    this.resolvedProviderTracks.add(playableTrack);
    return playableTrack;
  }

  createPlaybackSourceDescriptor(track) {
    let descriptor = normalizePlaybackSourceDescriptor(track);
    if (!descriptor.readBytes && typeof track?.path === 'string' &&
        this.shouldUseElectronFileRead(track.path)) {
      const expectedByteLength = descriptor.byteLength;
      descriptor = Object.freeze({
        ...descriptor,
        readBytes: () => this.loadElectronFileTrackData(track.path, expectedByteLength)
      });
    }
    return descriptor;
  }

  createPlaybackDecisionRecord(playableTrack, descriptor, decision = choosePlaybackMode(descriptor)) {
    return {
      playableTrack,
      descriptor,
      decision,
      committedMode: decision.mode,
      mediaFallbackLocked: false
    };
  }

  createPlaybackRequestSnapshot(playableTrack, targetIndex = null) {
    const descriptor = this.createPlaybackSourceDescriptor(playableTrack);
    return Object.freeze({
      track: playableTrack,
      playableTrack,
      descriptor,
      decisionRecord: this.createPlaybackDecisionRecord(
        playableTrack,
        descriptor,
        choosePlaybackMode(descriptor)
      ),
      targetIndex: this.normalizePlaylistIndex(targetIndex)
    });
  }

  needsTrackProviderResolution(track) {
    return Boolean(track?.provider) && !this.resolvedProviderTracks.has(track) &&
      !track.file && !track.path &&
      !(track.data instanceof ArrayBuffer) && !ArrayBuffer.isView(track.data);
  }

  async setupResolvedAudioElement(
    track,
    isStale = null,
    targetIndex = null,
    sourceGeneration = null,
    descriptor = null,
    alreadyResolved = false
  ) {
    const playableTrack = alreadyResolved ? track : await this.resolveTrackProvider(track);
    if (isStale?.()) return null;
    const playbackDescriptor = descriptor ?? this.createPlaybackSourceDescriptor(playableTrack);
    const previousObjectURL = this.currentObjectURL;
    if (!this.setupAudioElement(playableTrack, targetIndex, sourceGeneration, playbackDescriptor)) {
      this.clearActiveRegion();
      if (this.currentObjectURL && this.currentObjectURL !== previousObjectURL) {
        this.revokeCurrentObjectURL();
      }
      throw new Error('Invalid track: no file or path provided');
    }
    const setupObjectURL = this.currentObjectURL !== previousObjectURL
      ? this.currentObjectURL
      : null;
    if (hasPlaybackRegionDescriptor(playableTrack)) {
      const metadataReady = await this.waitForActiveRegionMetadata(this.activeSourceGeneration);
      if (isStale?.()) {
        if (setupObjectURL && this.currentObjectURL === setupObjectURL) {
          this.revokeCurrentObjectURL();
        }
        return null;
      }
      if (!metadataReady) {
        if (setupObjectURL && this.currentObjectURL === setupObjectURL) {
          this.revokeCurrentObjectURL();
        }
        const error = new Error('Playback region is outside the available media');
        error.code = 'mediaLoadFailed';
        throw error;
      }
    }
    return playableTrack;
  }

  async handleTrackLoadFailure(track, error, loadRequest = null, targetIndex = null) {
    const isStale = () => loadRequest && !this.isActiveLoadRequest(loadRequest);
    return this.completeTrackLoadFailure(error, error, isStale, targetIndex);
  }

  async completeTrackLoadFailure(error, originalError, isStale = () => false, failedIndex = null) {
    if (isStale()) return false;

    this.updateState({
      isTransitioning: false,
      transitionType: null,
      isPlaying: false,
      isPaused: false
    }, 'Track loading failed');

    const playbackManager = this.audioPlayer.playbackManager;
    if (playbackManager?.catalogSequence) {
      return false;
    }

    window.uiManager?.setError?.('error.playbackCommandFailed', true);
    if (playbackManager?.playlist?.length > 1) {
      await playbackManager.playNext(false, {
        allowDuringTransition: true,
        ignoreRepeatOne: true,
        failedIndex: this.normalizePlaylistIndex(failedIndex)
      });
    }
    return false;
  }

  shouldUseElectronFileRead(path) {
    const integration = window.electronIntegration;
    const isElectron = integration?.isElectronEnvironment?.() || integration?.isElectron === true;
    if (!window.electronAPI || !isElectron || typeof path !== 'string') {
      return false;
    }

    if (/^[A-Za-z]:[\\/]/.test(path)) return true;
    if (/^[A-Za-z][A-Za-z\d+\-.]*:/.test(path)) return false;
    return path.startsWith('/') || path.startsWith('\\\\') || path.includes('\\');
  }

  /**
   * Load an Electron local file path as ArrayBuffer for decodeAudioData.
   */
  async loadElectronFileTrackData(path, expectedByteLength = null) {
    if (typeof window.electronAPI?.readFileBytes !== 'function') {
      throw new Error('Failed to load local track: Electron file byte reader is unavailable');
    }
    try {
      const bytes = await window.electronAPI.readFileBytes(path, expectedByteLength);
      if (bytes instanceof ArrayBuffer) return bytes;
      if (ArrayBuffer.isView(bytes)) {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      }
      throw new Error('Electron file byte reader returned invalid data');
    } catch (error) {
      throw error;
    }
  }

  /**
   * Prepare next track buffer considering repeat mode
   */
  async prepareNextTrackBufferWithRepeatMode() {
    if (!this.audioPlayer.playbackManager) return;
    const playbackManager = this.audioPlayer.playbackManager;
    if (typeof playbackManager.preparePlannedAutomaticMove === 'function') {
      const state = this.getCurrentState();
      const plan = await playbackManager.preparePlannedAutomaticMove(state?.currentTrack ?? null);
      if (!plan) {
        this.clearNextTrackBuffer();
        return;
      }
      await this.prepareNextTrackBufferForTrack(plan.nextTrack, plan.nextOrdinal, plan);
      return;
    }

    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const playlist = playbackManager.playlist;
    const state = this.getCurrentState();
    const repeatMode = state?.repeatMode || 'OFF';
    
    let nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) {
      if (repeatMode === 'ALL') {
        nextIndex = 0;
      } else {
        return;
      }
    }
    
    const nextTrack = playlist[nextIndex];
    if (nextTrack) {
      await this.prepareNextTrackBufferForTrack(nextTrack, nextIndex);
    }
  }
  
  /**
   * Prepare buffer for a specific track
   */
  async prepareNextTrackBufferForTrack(track, targetIndex = null, automaticMovePlan = null) {
    if (!track) return;
    const request = this.beginNextBufferRequest(track, targetIndex);
    
    try {
      const isStale = () => !this.isActiveNextBufferRequest(request);
      const planSnapshot = automaticMovePlan?.preparedRequest ?? null;
      const playableTrack = planSnapshot?.playableTrack ?? (this.needsTrackProviderResolution(track)
        ? await this.resolveTrackProvider(track)
        : track);
      if (isStale()) return;
      const descriptor = planSnapshot?.descriptor ?? this.createPlaybackSourceDescriptor(playableTrack);
      const decisionRecord = planSnapshot?.decisionRecord ?? this.createPlaybackDecisionRecord(
          playableTrack,
          descriptor,
          choosePlaybackMode(descriptor)
        );
      if (decisionRecord.committedMode !== 'buffer') {
        if (automaticMovePlan &&
            this.audioPlayer.playbackManager?.isPlannedAutomaticMoveCurrent?.(automaticMovePlan) === true) {
          this.nextBuffer = {
            buffer: null,
            track,
            playableTrack,
            descriptor,
            decisionRecord,
            automaticMovePlan,
            targetIndex: request.targetIndex,
            requestToken: request.token
          };
        }
        return;
      }
      let buffer;
      try {
        buffer = await this.prepareTrackBuffer(playableTrack, isStale, true, descriptor);
      } catch (error) {
        if (decisionRecord.decision.allowMediaFallback && this.isActiveNextBufferRequest(request)) {
          decisionRecord.committedMode = 'media';
          decisionRecord.mediaFallbackLocked = true;
          this.nextBuffer = {
            buffer: null,
            track,
            playableTrack,
            descriptor,
            decisionRecord,
            automaticMovePlan,
            targetIndex: request.targetIndex,
            requestToken: request.token
          };
          return;
        }
        throw error;
      }
      const planIsCurrent = automaticMovePlan
        ? this.audioPlayer.playbackManager?.isPlannedAutomaticMoveCurrent?.(automaticMovePlan) === true
        : this.isExpectedNextBufferRequest(request);
      if (!buffer || !this.isActiveNextBufferRequest(request) || !planIsCurrent) return;
      this.nextBuffer = {
        buffer,
        track,
        playableTrack,
        descriptor,
        decisionRecord,
        automaticMovePlan,
        targetIndex: request.targetIndex,
        requestToken: request.token
      };
      this.schedulePreparedBufferTransition(this.nextBuffer);
    } catch (error) {
      if (this.isActiveNextBufferRequest(request)) {
        console.warn('[AudioContextManager] Next track buffer preparation failed:', error);
      }
    }
  }

  schedulePreparedBufferTransition(prepared, startAtEnded = false) {
    const plan = prepared?.automaticMovePlan;
    const playbackManager = this.audioPlayer.playbackManager;
    const state = this.getCurrentState();
    const audioContext = this.audioPlayer.audioContext;
    if (!prepared?.buffer || !plan || !audioContext || !this.currentBufferSource ||
        state?.playbackMode !== 'bufferSource' || state.isPlaying !== true ||
        state.isPaused === true || state.isStopped === true ||
        playbackManager?.isPlannedAutomaticMoveCurrent?.(plan) !== true) {
      return false;
    }

    const boundaryTime = startAtEnded
      ? audioContext.currentTime
      : this.bufferStartTime + this.bufferDuration;
    if (!Number.isFinite(boundaryTime) || (!startAtEnded && boundaryTime <= audioContext.currentTime)) {
      return false;
    }

    this.cancelScheduledBufferTransition();
    const source = audioContext.createBufferSource();
    const scheduled = {
      source,
      oldSource: this.currentBufferSource,
      buffer: prepared.buffer,
      track: prepared.playableTrack ?? prepared.track,
      descriptor: prepared.descriptor,
      decisionRecord: prepared.decisionRecord,
      plan,
      boundaryTime,
      committed: false,
      cancelled: false,
      instanceId: null,
      sourceGeneration: ++this.sourceGenerationSequence
    };
    source.buffer = prepared.buffer;
    source.onended = () => {
      this.releasePipelineSource(source);
      if (scheduled.cancelled) return;
      if (!scheduled.committed) {
        if (!this.commitScheduledBufferTransition(scheduled)) return;
      }
      const currentState = this.getCurrentState();
      if (this.currentBufferSource === source &&
          this.currentInstanceId === scheduled.instanceId &&
          !currentState?.isTransitioning && !currentState?.isStopped) {
        this.handleTrackEnded();
      }
    };

    try {
      if (!this.connectScheduledBufferSource(source) ||
          playbackManager?.isPlannedAutomaticMoveCurrent?.(plan) !== true ||
          (!startAtEnded && boundaryTime <= audioContext.currentTime)) {
        throw new Error('scheduled-buffer-transition-stale');
      }
      source.start(startAtEnded ? 0 : boundaryTime);
      this.scheduledBufferTransition = scheduled;
      return startAtEnded ? this.commitScheduledBufferTransition(scheduled) : true;
    } catch (error) {
      scheduled.cancelled = true;
      source.onended = null;
      this.releasePipelineSource(source, true);
      return false;
    }
  }

  commitScheduledBufferTransitionForSource(source) {
    const scheduled = this.scheduledBufferTransition;
    if (!scheduled || scheduled.oldSource !== source) return false;
    return this.commitScheduledBufferTransition(scheduled);
  }

  commitScheduledBufferTransition(scheduled = this.scheduledBufferTransition) {
    const playbackManager = this.audioPlayer.playbackManager;
    if (!scheduled || scheduled !== this.scheduledBufferTransition ||
        scheduled.cancelled || scheduled.committed ||
        playbackManager?.isPlannedAutomaticMoveCurrent?.(scheduled.plan) !== true) {
      return false;
    }

    const previousSource = scheduled.oldSource;
    scheduled.instanceId = this.advancePlaybackInstanceToken();
    this.currentBuffer = scheduled.buffer;
    this.currentBufferSource = scheduled.source;
    this.currentPlaybackDecision = scheduled.decisionRecord ?? null;
    this.activeSourceGeneration = scheduled.sourceGeneration;
    this.bufferStartTime = scheduled.boundaryTime;
    this.bufferDuration = scheduled.buffer.duration;

    const committed = playbackManager.commitPlannedAutomaticMove(scheduled.plan, {
      currentBuffer: scheduled.buffer,
      nextBuffer: null,
      currentTrackDuration: scheduled.buffer.duration,
      currentTrackPosition: 0,
      playbackMode: 'bufferSource',
      currentInstanceId: scheduled.instanceId,
      playbackInstanceId: scheduled.instanceId,
      bufferStartTime: scheduled.boundaryTime,
      bufferDuration: scheduled.buffer.duration
    });
    if (!committed) {
      scheduled.cancelled = true;
      scheduled.source.onended = null;
      this.releasePipelineSource(scheduled.source, true);
      this.scheduledBufferTransition = null;
      return false;
    }

    scheduled.committed = true;
    this.scheduledBufferTransition = null;
    this.nextBuffer = null;
    this.activeNextBufferRequest = null;
    if (!this.getUseInputWithPlayer()) {
      this.setManagedSourceNode(this.getPipelineSourceNode(scheduled.source));
    }
    if (previousSource && previousSource !== scheduled.source) {
      previousSource.onended = null;
      this.releasePipelineSource(previousSource);
    }
    this.loadMetadata(scheduled.track, null, scheduled.plan.nextOrdinal);
    this.prepareNextTrackBufferWithRepeatMode();
    return true;
  }

  cancelScheduledBufferTransition() {
    const scheduled = this.scheduledBufferTransition;
    if (!scheduled) return false;
    this.scheduledBufferTransition = null;
    scheduled.cancelled = true;
    scheduled.source.onended = null;
    this.releasePipelineSource(scheduled.source, true);
    return true;
  }
  
  /**
   * Get next track
   */
  getNextTrack() {
    if (this.audioPlayer.stateManager) {
      return this.audioPlayer.stateManager.getNextTrack();
    }
    
    if (!this.audioPlayer.playbackManager || !this.audioPlayer.playbackManager.playlist) {
      return null;
    }
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const playlist = this.audioPlayer.playbackManager.playlist;
    
    let repeatMode = 'OFF';
    if (this.audioPlayer.stateManager) {
      const state = this.audioPlayer.stateManager.getStateSnapshot();
      repeatMode = state?.repeatMode || 'OFF';
    }
    
    let nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) {
      if (repeatMode === 'ALL') {
        nextIndex = 0;
      } else {
        return null;
      }
    }
    
    return playlist[nextIndex] || null;
  }
  
  // ===== TRANSITION METHODS =====
  
  /**
   * Transition to next track
   */
  async transitionToNextTrack(
    nextTrack,
    targetIndex = null,
    userInitiated = true,
    preparedRequest = null,
    automaticMovePlan = null
  ) {
    const nextTrackIndex = this.getTrackIndexForPlaybackEntry(nextTrack, targetIndex, -1);
    const plan = automaticMovePlan ?? preparedRequest?.automaticMovePlan ?? null;
    if (!plan) this.invalidateAutomaticMoveForManualCommand();
    const transitionRequest = this.beginTransitionRequest(nextTrack, nextTrackIndex);
    this.updateState({
      isTransitioning: true,
      transitionType: 'seamless'
    }, 'Transition started');
    
    try {
      let preparedNextTrack = plan ? preparedRequest : null;
      if (plan && !preparedNextTrack) {
        preparedNextTrack = this.consumePreparedNextForTrack(nextTrack, nextTrackIndex);
      } else if (plan && this.nextBuffer === preparedNextTrack) {
        this.nextBuffer = null;
        this.activeNextBufferRequest = null;
      }
      const isStale = () => !this.isActiveTransitionRequest(transitionRequest) ||
        (plan && this.audioPlayer.playbackManager?.isPlannedAutomaticMoveCurrent?.(plan) !== true);
      const prepared = await this.prepareTrackTransitionRequest(
        nextTrack,
        nextTrackIndex,
        isStale,
        preparedNextTrack,
        plan
      );
      if (!prepared || isStale()) return false;
      const activated = await this.activatePreparedTrackTransition(
        prepared,
        transitionRequest,
        userInitiated,
        plan
      );
      if (activated === false && !isStale()) {
        if (plan) {
          const error = new Error('Prepared automatic transition could not be activated');
          await this.completeTrackLoadFailure(error, error, isStale, nextTrackIndex);
        } else {
          this.updateState({
            isTransitioning: false,
            transitionType: null
          }, 'Prepared track transition was not activated');
        }
      }
      return activated;
      
    } catch (error) {
      console.error('[AudioContextManager] Transition failed:', error);
      if (this.isActiveTransitionRequest(transitionRequest)) {
        this.updateState({
          isTransitioning: false,
          transitionType: null
        }, 'Transition failed');
      }
      throw error;
    }
  }

  async prepareTrackTransitionRequest(track, targetIndex, isStale, preparedRequest, plan) {
    const planSnapshot = plan?.preparedRequest ?? null;
    const playableTrack = preparedRequest?.playableTrack ?? planSnapshot?.playableTrack ??
      (this.needsTrackProviderResolution(track) ? await this.resolveTrackProvider(track) : track);
    if (isStale() || !playableTrack) return null;
    const descriptor = preparedRequest?.descriptor ?? planSnapshot?.descriptor ??
      this.createPlaybackSourceDescriptor(playableTrack);
    const decisionRecord = preparedRequest?.decisionRecord ?? planSnapshot?.decisionRecord ??
      this.createPlaybackDecisionRecord(playableTrack, descriptor, choosePlaybackMode(descriptor));
    let buffer = preparedRequest?.buffer ?? null;

    if (decisionRecord.committedMode === 'unavailable') {
      throw new Error('Playback source is unavailable');
    }
    if (decisionRecord.committedMode === 'buffer' && !buffer) {
      try {
        buffer = await this.prepareTrackBuffer(playableTrack, isStale, true, descriptor);
      } catch (error) {
        if (!decisionRecord.decision.allowMediaFallback || decisionRecord.mediaFallbackLocked === true) {
          throw error;
        }
        decisionRecord.committedMode = 'media';
        decisionRecord.mediaFallbackLocked = true;
      }
    }
    if (isStale()) return null;
    return {
      track,
      playableTrack,
      descriptor,
      decisionRecord,
      buffer,
      automaticMovePlan: plan,
      targetIndex
    };
  }

  async activatePreparedTrackLoad(prepared, loadRequest, isStale) {
    let candidate = null;
    try {
      candidate = prepared.decisionRecord.committedMode === 'buffer'
        ? this.prepareBufferTransitionCandidate(prepared, loadRequest.sourceGeneration)
        : await this.prepareMediaTransitionCandidate(prepared, loadRequest.sourceGeneration, isStale);
      if (!candidate || isStale()) return false;
      return this.commitPreparedTrackCandidate(candidate, prepared, null, isStale, false);
    } finally {
      if (candidate && !candidate.committed) this.cleanupPreparedTransitionCandidate(candidate);
    }
  }

  async activatePreparedTrackTransition(prepared, transitionRequest, userInitiated, plan) {
    const isStale = () => !this.isActiveTransitionRequest(transitionRequest) ||
      (plan && this.audioPlayer.playbackManager?.isPlannedAutomaticMoveCurrent?.(plan) !== true);
    const resumed = await this.resumePlaybackAudioContext(userInitiated);
    if (!resumed || isStale()) return false;

    let candidate = null;
    let stage = null;
    try {
      candidate = prepared.decisionRecord.committedMode === 'buffer'
        ? this.prepareBufferTransitionCandidate(prepared, transitionRequest.sourceGeneration)
        : await this.prepareMediaTransitionCandidate(
            prepared,
            transitionRequest.sourceGeneration,
            isStale
          );
      if (!candidate || isStale()) return false;
      stage = await this.stagePlaybackActivation(
        candidate.backend,
        transitionRequest.sourceGeneration,
        0,
        prepared
      );
      if (isStale()) return false;

      if (candidate.mode === 'bufferSource') {
        candidate.startTime = this.audioPlayer.audioContext.currentTime;
        candidate.source.start(candidate.startTime);
      } else {
        await candidate.element.play();
      }
      if (isStale() || candidate.ended === true || candidate.element?.error) return false;

      const commit = () => this.commitPreparedTrackCandidate(candidate, prepared, plan, isStale, true);
      if (stage) {
        const result = await this.audioManager.activateStagedAudioCandidate(stage, {
          acquire: () => candidate,
          isCandidateCurrent: value => value === candidate && !isStale() &&
            candidate.ended !== true && candidate.element?.ended !== true &&
            !candidate.element?.error &&
            this.isPipelineSourceConnected(candidate.source),
          commit,
          cleanup: () => this.cleanupPreparedTransitionCandidate(candidate)
        });
        return result.activated === true;
      }
      return commit();
    } catch (error) {
      if (!isStale()) {
        console.error('[AudioContextManager] Prepared track transition failed:', error);
      }
      return false;
    } finally {
      if (candidate && !candidate.committed) this.cleanupPreparedTransitionCandidate(candidate);
      this.releasePlaybackActivationStage(stage);
    }
  }

  prepareBufferTransitionCandidate(prepared, sourceGeneration) {
    if (!prepared.buffer) throw new Error('Prepared buffer is unavailable');
    const source = this.audioPlayer.audioContext.createBufferSource();
    const candidate = {
      mode: 'bufferSource',
      backend: 'buffer-source',
      source,
      buffer: prepared.buffer,
      sourceGeneration,
      instanceId: this.currentInstanceId + 1,
      startTime: 0,
      ended: false,
      committed: false,
      cleaned: false
    };
    source.buffer = prepared.buffer;
    source.onended = () => {
      if (!candidate.committed) {
        candidate.ended = true;
        return;
      }
      this.releasePipelineSource(source);
      const state = this.getCurrentState();
      if (this.currentBufferSource === source && this.currentInstanceId === candidate.instanceId &&
          !state?.isTransitioning && !state?.isStopped) {
        this.handleTrackEnded();
      }
    };
    if (!this.connectPrivatePipelineSource(source)) {
      source.onended = null;
      this.releasePipelineSource(source, true);
      throw new Error('private-buffer-candidate-connect-failed');
    }
    return candidate;
  }

  async prepareMediaTransitionCandidate(prepared, sourceGeneration, isStale) {
    const sourceValue = prepared.descriptor?.mediaSource ?? prepared.playableTrack?.mediaSource ??
      prepared.playableTrack?.file ?? prepared.playableTrack?.path ?? null;
    const element = new Audio();
    let objectURL = null;
    if (isBlobObject(sourceValue)) {
      objectURL = URL.createObjectURL(sourceValue);
      element.src = objectURL;
    } else if (typeof sourceValue === 'string' && sourceValue.length > 0) {
      const formattedSource = this.getMediaElementSourceUrl(sourceValue);
      if (!formattedSource) throw new Error('Invalid media source');
      element.src = formattedSource;
    } else {
      throw new Error('Invalid track: no media source provided');
    }
    const region = getPlaybackRegion(prepared.playableTrack);
    try {
      if (!await this.waitForMediaCandidateReadiness(
        element,
        region,
        isStale,
        () => element.load()
      )) {
        throw new Error(region
          ? 'Playback region is outside the available media'
          : 'Media source did not become ready');
      }
      if (isStale()) throw new Error('stale-media-transition-candidate');
      const source = this.audioPlayer.audioContext.createMediaElementSource(element);
      const candidate = {
        mode: 'audioElement',
        backend: 'html-media',
        source,
        element,
        objectURL,
        region,
        sourceGeneration,
        ended: false,
        committed: false,
        cleaned: false
      };
      if (!this.connectPrivatePipelineSource(source)) {
        this.releasePipelineSource(source);
        throw new Error('private-media-candidate-connect-failed');
      }
      return candidate;
    } catch (error) {
      try { element.pause(); } catch (_) { /* already stopped */ }
      try { element.src = ''; } catch (_) { /* already cleared */ }
      if (objectURL) URL.revokeObjectURL(objectURL);
      throw error;
    }
  }

  async waitForMediaCandidateReadiness(element, region, isStale, startLoad) {
    const validate = () => {
      try {
        if (isStale() || element.error || element.readyState < 1) return false;
        if (region && !isRegionPlayableInMedia(region, element.duration)) return false;
        if (region) element.currentTime = getRegionStartTime(region);
        return true;
      } catch (error) {
        return false;
      }
    };

    return new Promise(resolve => {
      let settled = false;
      let timeoutId = null;
      const settle = value => {
        if (settled) return;
        settled = true;
        element.removeEventListener('loadedmetadata', onLoaded);
        element.removeEventListener('error', onError);
        this.pendingMediaCandidateReadiness.delete(onStale);
        if (timeoutId !== null) clearTimeout(timeoutId);
        resolve(value);
      };
      const onLoaded = () => settle(validate());
      const onError = () => settle(false);
      const onStale = () => settle(false);
      element.addEventListener('loadedmetadata', onLoaded);
      element.addEventListener('error', onError);
      this.pendingMediaCandidateReadiness.add(onStale);
      timeoutId = setTimeout(() => settle(false), MEDIA_CANDIDATE_READY_TIMEOUT_MS);

      try {
        startLoad();
      } catch (error) {
        settle(false);
        return;
      }

      if (isStale() || element.error) {
        settle(false);
      } else if (element.readyState >= 1) {
        settle(validate());
      }
    });
  }

  prepareMutedCandidateCommit(candidate, startPlayback) {
    const ownership = this.preparePlayerSourceOwnership();
    if (!ownership) return null;
    if (!this.setPrivatePipelineSourceMuted(candidate.source, true) ||
        !this.ensurePipelineSourceConnected(candidate.source)) {
      this.rollbackPlayerSourceOwnership(ownership);
      return null;
    }
    return {
      ownership,
      managedSource: startPlayback || candidate.mode === 'audioElement'
        ? this.getPipelineSourceNode(candidate.source)
        : ownership.silentSource
    };
  }

  teardownCommittedBackendForTransition(candidate) {
    this.cancelScheduledBufferTransition();
    this.clearBufferMonitoring();
    this.clearRegionBoundaryTimer();
    if (this.pendingBufferSource && this.pendingBufferSource !== candidate.source) {
      this.releasePipelineSource(this.pendingBufferSource, true);
    }
    this.pendingBufferSource = null;
    if (this.currentBufferSource && this.currentBufferSource !== candidate.source) {
      this.releasePipelineSource(this.currentBufferSource, true);
    }
    this.currentBufferSource = null;

    if (this.pendingMediaActivation) {
      this.pendingMediaActivation.invalid = true;
      try { this.pendingMediaActivation.element?.pause(); } catch (_) { /* already paused */ }
      this.pendingMediaActivation = null;
    }
    const previousElement = this.audioPlayer.audioElement;
    const previousMediaSource = this.mediaSource;
    if (previousMediaSource && previousMediaSource !== candidate.source) {
      this.releasePipelineSource(previousMediaSource);
    }
    this.mediaSource = null;
    if (previousElement && previousElement !== candidate.element) {
      this.detachAudioElement(previousElement, { clearSource: true, clearPlayerReference: true });
    }
    this.revokeCurrentObjectURL();
    this.clearActiveRegion();
  }

  commitPreparedTrackCandidate(candidate, prepared, plan, isStale, startPlayback) {
    const playbackManager = this.audioPlayer.playbackManager;
    if (isStale() || candidate.element?.error ||
        (plan && playbackManager?.isPlannedAutomaticMoveCurrent?.(plan) !== true)) {
      return false;
    }

    const track = prepared.playableTrack;
    const mediaDuration = Number.isFinite(candidate.element?.duration) ? candidate.element.duration : 0;
    const statePatch = {
      currentTrackDuration: candidate.mode === 'bufferSource'
        ? candidate.buffer.duration
        : (candidate.region?.durationSec ?? mediaDuration),
      currentTrackPosition: 0,
      playbackMode: candidate.mode,
      currentBuffer: candidate.mode === 'bufferSource' ? candidate.buffer : null,
      isPlaying: startPlayback,
      isPaused: false,
      isStopped: !startPlayback,
      isTransitioning: false,
      transitionType: null
    };
    const preflight = this.prepareMutedCandidateCommit(candidate, startPlayback);
    if (!preflight) return false;
    if (isStale() || (plan && playbackManager?.isPlannedAutomaticMoveCurrent?.(plan) !== true)) {
      this.rollbackPlayerSourceOwnership(preflight.ownership);
      return false;
    }

    this.teardownCommittedBackendForTransition(candidate);
    this.setPrivatePipelineSourceMuted(candidate.source, false);
    this.commitPlayerSourceOwnership(preflight.managedSource, preflight.ownership);
    this.currentPlaybackDecision = prepared.decisionRecord;
    this.activeSourceGeneration = candidate.sourceGeneration;
    if (candidate.mode === 'bufferSource') {
      this.currentBuffer = candidate.buffer;
      this.currentBufferSource = startPlayback ? candidate.source : null;
      this.bufferStartTime = startPlayback ? candidate.startTime : 0;
      this.bufferDuration = candidate.buffer.duration;
      this.currentInstanceId = candidate.instanceId;
      this.playbackInstanceId = candidate.instanceId;
      Object.assign(statePatch, {
        currentInstanceId: candidate.instanceId,
        playbackInstanceId: candidate.instanceId,
        bufferStartTime: startPlayback ? candidate.startTime : 0,
        bufferDuration: candidate.buffer.duration
      });
    } else {
      this.currentBuffer = null;
      this.bufferDuration = 0;
      this.audioPlayer.audioElement = candidate.element;
      this.mediaSource = candidate.source;
      this.mediaSourceGeneration++;
      this.currentObjectURL = candidate.objectURL;
      this.setupEventHandlers();
      this.setValidatedActiveRegion(track, candidate.sourceGeneration);
      this.setupMediaSessionHandlers();
    }

    if (plan && startPlayback) {
      playbackManager.commitPlannedAutomaticMove(plan, statePatch);
    } else {
      this.updateState({
        currentTrack: track,
        currentTrackName: this.getDisplayTrackName(track),
        artworkUrl: '',
        currentTrackIndex: prepared.targetIndex,
        ...statePatch
      }, startPlayback
        ? 'Prepared track transition committed'
        : 'Prepared track load committed');
    }

    candidate.committed = true;
    this.nextBuffer = null;
    this.activeNextBufferRequest = null;
    this.loadMetadata(track, null, prepared.targetIndex);
    if (candidate.mode === 'bufferSource') {
      if (startPlayback) {
        this.setupBufferMonitoring();
      } else {
        candidate.source.onended = null;
        this.releasePipelineSource(candidate.source, true);
      }
      this.prepareNextTrackBufferWithRepeatMode();
    } else if (this.activeRegion) {
      this.prepareRegionTransportPlan(this.activeRegion);
      this.armRegionBoundaryTimer();
    } else {
      this.prepareNextTrackBufferWithRepeatMode();
    }
    this.audioPlayer.ui?.updatePlayerUIState?.();
    return true;
  }

  cleanupPreparedTransitionCandidate(candidate) {
    if (!candidate || candidate.cleaned || candidate.committed) return;
    candidate.cleaned = true;
    if (candidate.mode === 'bufferSource') {
      candidate.source.onended = null;
      this.releasePipelineSource(candidate.source, true);
      return;
    }
    try { candidate.element.pause(); } catch (_) { /* already paused */ }
    this.releasePipelineSource(candidate.source);
    try { candidate.element.src = ''; } catch (_) { /* already cleared */ }
    if (candidate.objectURL) URL.revokeObjectURL(candidate.objectURL);
  }
  
  /**
   * Create and start buffer source directly (for transitions)
   */
  async createAndStartBufferSource(isStale = null, activationIntent = null) {
    const buffer = activationIntent?.buffer || this.currentBuffer;
    if (!buffer) {
      throw new Error('No current buffer available for playback');
    }

    const sourceGeneration = Number.isSafeInteger(activationIntent?.sourceGeneration)
      ? activationIntent.sourceGeneration
      : (this.activeSourceGeneration || ++this.sourceGenerationSequence);
    let stage = null;
    let candidateSource = null;
    let candidateEnded = false;
    let committed = false;

    try {
      stage = await this.stagePlaybackActivation(
        'buffer-source',
        sourceGeneration,
        0,
        activationIntent
      );
      if (isStale?.()) return false;
      await this.stopCurrentPlayback();
      if (isStale?.()) return false;

      const instanceId = this.currentInstanceId;
      candidateSource = this.createBufferSource(buffer, instanceId, {
        privateUntilCommit: !!stage,
        isCommitted: () => committed,
        onPendingEnded: () => { candidateEnded = true; }
      });
      this.pendingBufferSource = candidateSource;
      const currentTime = this.audioPlayer.audioContext.currentTime;
      candidateSource.start(currentTime);

      const commitCandidate = () => {
        if (!this.setPrivatePipelineSourceMuted(candidateSource, false)) {
          throw new Error('private-pipeline-source-publish-failed');
        }
        committed = true;
        this.pendingBufferSource = null;
        this.currentBuffer = buffer;
        if (activationIntent?.decisionRecord) {
          this.currentPlaybackDecision = activationIntent.decisionRecord;
        }
        this.activeSourceGeneration = sourceGeneration;
        this.currentBufferSource = candidateSource;
        this.bufferStartTime = currentTime;
        this.bufferDuration = buffer.duration;
        const trackState = activationIntent?.track ? {
          currentTrack: activationIntent.track,
          currentTrackName: this.getDisplayTrackName(activationIntent.track),
          artworkUrl: '',
          currentTrackIndex: activationIntent.targetIndex,
          currentTrackDuration: buffer.duration,
          currentTrackPosition: 0
        } : {};
        this.updateState({
          ...trackState,
          isPlaying: true,
          isPaused: false,
          isStopped: false,
          currentInstanceId: instanceId,
          playbackInstanceId: instanceId,
          bufferStartTime: currentTime,
          bufferDuration: buffer.duration
        }, stage
          ? 'Buffer source transition activation committed'
          : 'Buffer source playback started');
        if (activationIntent?.track && this.audioPlayer.stateManager) {
          this.audioPlayer.stateManager.updateState({
            currentTrack: activationIntent.track,
            currentTrackIndex: activationIntent.targetIndex
          }, 'AudioContextManager transition source committed');
        }
        return true;
      };

      if (stage) {
        const result = await this.audioManager.activateStagedAudioCandidate(stage, {
          acquire: () => candidateSource,
          isCandidateCurrent: source => source === candidateSource &&
            !candidateEnded &&
            this.pendingBufferSource === candidateSource &&
            !isStale?.() &&
            this.isPipelineSourceConnected(candidateSource),
          commit: commitCandidate,
          cleanup: source => {
            if (this.pendingBufferSource === source) this.pendingBufferSource = null;
            this.releasePipelineSource(source, true);
          }
        });
        if (!result.activated) return false;
      } else {
        commitCandidate();
      }

      this.setupBufferMonitoring();
      return true;

    } catch (error) {
      if (candidateSource && !committed) {
        if (this.pendingBufferSource === candidateSource) this.pendingBufferSource = null;
        this.releasePipelineSource(candidateSource, true);
      }
      console.error('[AudioContextManager] Buffer source creation failed:', error);
      throw error;
    } finally {
      this.releasePlaybackActivationStage(stage);
    }
  }
  
  /**
   * Seamless transition to a track (for previous/next track functionality)
   */
  async seamlessTransition(track, targetIndex = null, userInitiated = true) {
    return this.transitionToNextTrack(track, targetIndex, userInitiated);
  }
  
  // ===== CLEANUP =====
  
  /**
   * Disconnect and clean up audio connections
   */
  disconnect() {
    this.invalidatePendingPlaybackOperationsForDisconnect();
    this.clearActiveRegion();
    try {
      if (this.audioPlayer?.mediaSessionManager?.clearActionHandlers) {
        this.audioPlayer.mediaSessionManager.clearActionHandlers();
      } else {
        const navigatorRef = typeof navigator !== 'undefined' ? navigator : null;
        if (navigatorRef && 'mediaSession' in navigatorRef) {
          navigatorRef.mediaSession.setActionHandler('play', null);
          navigatorRef.mediaSession.setActionHandler('pause', null);
          navigatorRef.mediaSession.setActionHandler('nexttrack', null);
          navigatorRef.mediaSession.setActionHandler('previoustrack', null);
          navigatorRef.mediaSession.setActionHandler('stop', null);
          navigatorRef.mediaSession.setActionHandler('seekto', null);
        }
      }
      
      this.stopCurrentPlayback();
      
      if (this.mediaSource) {
        this.releasePipelineSource(this.mediaSource);
        this.mediaSource = null;
      }
      
      this.revokeCurrentObjectURL();
      
      this.currentBuffer = null;
      this.currentPlaybackDecision = null;
      this.clearNextTrackBuffer();
      this.clearArtworkURL();
      this.clearBufferMonitoring();
      
      this.updateState({
        playlist: [],
        playlistLength: 0,
        currentTrack: null,
        currentTrackIndex: -1,
        currentTrackName: '',
        artworkUrl: '',
        isTrackPresentationPending: false,
        currentTrackDuration: 0,
        currentTrackPosition: 0,
        isPlaying: false,
        isPaused: false,
        isStopped: true,
        playbackMode: 'bufferSource',
        isTransitioning: false,
        transitionType: null,
        currentInstanceId: 0,
        playbackInstanceId: 0
      }, 'Disconnected and reset');
      
      if (this.audioPlayer.audioElement) {
        if (this.eventHandlers.ended) {
          this.audioPlayer.audioElement.removeEventListener('ended', this.eventHandlers.ended);
          this.eventHandlers.ended = null;
        }
        if (this.eventHandlers.timeupdate) {
          this.audioPlayer.audioElement.removeEventListener('timeupdate', this.eventHandlers.timeupdate);
          this.eventHandlers.timeupdate = null;
        }
        if (this.eventHandlers.error) {
          this.audioPlayer.audioElement.removeEventListener('error', this.eventHandlers.error);
          this.eventHandlers.error = null;
        }
        if (this.eventHandlers.loadedmetadata) {
          this.audioPlayer.audioElement.removeEventListener('loadedmetadata', this.eventHandlers.loadedmetadata);
          this.eventHandlers.loadedmetadata = null;
        }
        if (this.eventHandlers.ratechange) {
          this.audioPlayer.audioElement.removeEventListener('ratechange', this.eventHandlers.ratechange);
          this.eventHandlers.ratechange = null;
        }
        
        const silentDataUrl = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        this.audioPlayer.audioElement.src = silentDataUrl;
      }
      
      const useInputWithPlayer = this.getUseInputWithPlayer();
      if (!useInputWithPlayer) {
        const canonicalInputSource = (this.audioManager.ioManager
          ? this.audioManager.ioManager.inputSourceNode
          : this.originalSourceNode) || this.originalSourceNode;
        if (canonicalInputSource &&
            this.ensurePipelineSourceConnected(canonicalInputSource)) {
          this.originalSourceNode = canonicalInputSource;
          this.setManagedSourceNode(canonicalInputSource);
        } else {
          // A missing or disconnected canonical input is replaced atomically,
          // so the destroyed player node is never published as the live source.
          const silentSource = this.handoffInputToSilentSource();
          if (!silentSource) {
            throw new Error('pipeline-source-restore-failed');
          }
          this.originalSourceNode = silentSource;
        }
      }
      
    } catch (error) {
      console.error('Error disconnecting audio context:', error);
    }
  }
  
  // ===== UTILITY METHODS =====
  
  /**
   * Check if using buffer playback mode
   */
  isUsingBufferPlayback() {
    const state = this.getCurrentState();
    return state?.playbackMode === 'bufferSource';
  }
  
  /**
   * Get current buffer playback time
   */
  getCurrentBufferTime() {
    const state = this.getCurrentState();
    if (state?.playbackMode === 'bufferSource' && state?.isPlaying) {
      const currentTime = this.audioPlayer.audioContext.currentTime;
      const elapsedTime = currentTime - this.bufferStartTime;
      return Math.max(0, Math.min(elapsedTime, this.bufferDuration));
    }
    return 0;
  }
  
  /**
   * Check if current buffer is available
   */
  hasCurrentBuffer() {
    return this.currentBuffer !== null;
  }
  
  /**
   * Get current buffer
   */
  getCurrentBuffer() {
    return this.currentBuffer;
  }
  
  /**
   * Clear next track buffer
   */
  clearNextTrackBuffer() {
    this.cancelScheduledBufferTransition();
    this.nextBufferRequestToken++;
    this.activeNextBufferRequest = null;
    this.nextBuffer = null;
  }
}

function electronFilePathToMediaUrl(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    const [host, ...segments] = normalized.slice(2).split('/');
    if (!host || segments.length === 0) return null;
    return `file://${host}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
  }
  const rooted = /^[A-Za-z]:\//.test(normalized) ? `/${normalized}` : normalized;
  if (!rooted.startsWith('/')) return null;
  const encoded = rooted.split('/').map((segment, index) => (
    index === 1 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)
  )).join('/');
  return `file://${encoded}`;
}

function isFileObject(value) {
  return typeof File !== 'undefined' && value instanceof File;
}

function isBlobObject(value) {
  if (!value || typeof value !== 'object') return false;
  if (typeof Blob !== 'undefined' && value instanceof Blob) return true;
  if (typeof File !== 'undefined' && value instanceof File) return true;
  return Number.isFinite(value.size) && typeof value.arrayBuffer === 'function';
}

function toOwnedArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  }
  throw new Error('Playback byte reader returned invalid data');
}

function samePlaybackEntry(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.entryInstanceId && right.entryInstanceId) {
    return left.entryInstanceId === right.entryInstanceId;
  }
  if (left.libraryTrackId && right.libraryTrackId) {
    return left.libraryTrackId === right.libraryTrackId;
  }
  if (left.path && right.path) {
    return left.path === right.path;
  }
  if (left.file && right.file) {
    if (left.file === right.file) return true;
    return left.file.name === right.file.name &&
      left.file.size === right.file.size &&
      left.file.lastModified === right.file.lastModified;
  }
  return false;
}
