/**
 * AudioContextManager - Handles Web Audio API integration and metadata processing
 * Manages media sources and audio connections
 * UNIFIED STATE MANAGEMENT: All state managed in StateManager only
 */
import { readRiffInfoTagsFromBlob } from '../../library/metadata/riff-info.js';
import { decodeLegacyMetadataBytes, repairLegacyMetadataMojibake } from '../../library/metadata/text-encoding.js';

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
      loadedmetadata: null
    };
    
    // Store original source node for restoration
    if (audioManager.sourceNode) {
      this.originalSourceNode = audioManager.sourceNode;
    }
    
    // Buffer management (only for audio processing, not state)
    this.currentBuffer = null;
    this.nextBuffer = null;
    this.currentBufferSource = null;
    this.bufferStartTime = 0;
    this.bufferDuration = 0;
    
    // Instance tracking for cleanup
    this.currentInstanceId = 0;
    this.playbackInstanceId = 0;
    
    // UI monitoring
    this.bufferMonitoringInterval = null;

    this.loadRequestToken = 0;
    this.activeLoadRequest = null;
    this.metadataRequestToken = 0;
    this.activeMetadataRequest = null;
    this.nextBufferRequestToken = 0;
    this.activeNextBufferRequest = null;
    this.transitionRequestToken = 0;
    this.activeTransitionRequest = null;
    this.stopRequestToken = 0;
  }

  // ===== CORE AUDIO METHODS =====
  
  /**
   * Create and connect silent gain node for pipeline maintenance
   */
  createSilentGain() {
    try {
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
      this.audioManager.ioManager.sourceNode = sourceNode;
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

  async resumePlaybackAudioContext() {
    const contextManager = this.audioManager?.contextManager;
    if (typeof contextManager?.resumeAudioContext === 'function') {
      await contextManager.resumeAudioContext();
      return;
    }

    const audioContext = this.audioPlayer?.audioContext;
    if (audioContext?.state === 'suspended' && typeof audioContext.resume === 'function') {
      try {
        await audioContext.resume();
      } catch (error) {
        console.warn('[AudioContextManager] AudioContext resume before playback failed:', error);
      }
    }
  }
  
  /**
   * Connect buffer source to audio manager
   */
  connectBufferSource(bufferSource) {
    const useInputWithPlayer = this.getUseInputWithPlayer();
    
    if (useInputWithPlayer) {
      if (this.audioManager.workletNode) {
        this.audioManager.connectSourceToPipeline(bufferSource);
      } else {
        console.warn('[AudioContextManager] Worklet node unavailable; refusing direct destination playback.');
      }
    } else {
      if (this.originalSourceNode) {
        try {
          this.originalSourceNode.disconnect();
          const silentGain = this.createSilentGain();
          if (silentGain) {
            this.setManagedSourceNode(silentGain);
          }
        } catch (e) {
          // Silent fail
        }
      }

      this.setManagedSourceNode(bufferSource);
      if (this.audioManager.workletNode) {
        this.audioManager.connectSourceToPipeline(bufferSource);
      } else {
        console.warn('[AudioContextManager] Worklet node unavailable; refusing direct destination playback.');
      }
    }
  }
  
  /**
   * Connect media source to audio manager
   */
  connectMediaSource(mediaSource) {
    const useInputWithPlayer = this.getUseInputWithPlayer();
    
    if (useInputWithPlayer) {
      if (this.audioManager.workletNode) {
        this.audioManager.connectSourceToPipeline(mediaSource);
      }
    } else {
      if (this.originalSourceNode) {
        try {
          this.originalSourceNode.disconnect();
          const silentGain = this.createSilentGain();
          if (silentGain) {
            this.setManagedSourceNode(silentGain);
          }
        } catch (e) {
          // Silent fail
        }
      }

      this.setManagedSourceNode(mediaSource);
      if (this.audioManager.workletNode) {
        try {
          this.audioManager.connectSourceToPipeline(mediaSource);
        } catch (e) {
          try {
            mediaSource.disconnect();
            this.audioManager.connectSourceToPipeline(mediaSource);
          } catch (innerError) {
            // Silent fail
          }
        }
      }
    }
  }
  
  /**
   * Create and configure buffer source with common settings
   */
  createBufferSource(buffer, instanceId) {
    const bufferSource = this.audioPlayer.audioContext.createBufferSource();
    bufferSource.buffer = buffer;
    
    this.connectBufferSource(bufferSource);
    
    bufferSource.onended = () => {
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
      if (this.originalSourceNode) {
        try {
          this.originalSourceNode.disconnect();
        } catch (e) {
          // Silent fail
        }
      }

      const silentGain = this.createSilentGain();
      if (silentGain) {
        this.setManagedSourceNode(silentGain);
      }
    }
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
        position = elementTime;
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
    if (this.currentBufferSource) {
      try {
        this.currentBufferSource.onended = null;
        this.currentBufferSource.stop();
        this.currentBufferSource.disconnect();
      } catch (e) {
        // Silent fail
      }
      this.currentBufferSource = null;
    }

    if (this.mediaSource) {
      try {
        this.mediaSource.disconnect();
      } catch (e) {
        // Silent fail
      }
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
      ['loadedmetadata', this.eventHandlers.loadedmetadata]
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
      loadedmetadata: null
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
    const newAudioContext = this.audioManager.audioContext;
    if (!newAudioContext) {
      return;
    }

    const state = this.getCurrentState();
    const currentTrack = this.getTrackForGraphRebind(state);
    const wasPlaying = !!state?.isPlaying;
    const wasPaused = !!state?.isPaused;
    const wasStopped = !!state?.isStopped;
    const restorePosition = this.getPlaybackPositionForGraphRebind(state);

    this.detachCurrentGraphNodesForRebind();
    this.audioPlayer.audioContext = newAudioContext;
    this.originalSourceNode = this.audioManager.ioManager?.sourceNode || this.audioManager.sourceNode || null;
    this.currentBuffer = null;
    this.clearNextTrackBuffer();

    if (!currentTrack) {
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

    try {
      const buffer = await this.prepareTrackBuffer(currentTrack);
      const duration = Number.isFinite(buffer.duration) ? buffer.duration : 0;
      const clampedPosition = wasStopped ? 0 : Math.max(0, Math.min(restorePosition, duration));

      this.currentBuffer = buffer;
      this.updateState({
        currentTrack,
        currentTrackName: this.getDisplayTrackName(currentTrack),
        currentBuffer: buffer,
        nextBuffer: null,
        currentTrackDuration: duration,
        currentTrackPosition: clampedPosition,
        playbackMode: 'bufferSource',
        isTransitioning: false,
        transitionType: null,
        isPlaying: false,
        isPaused: !wasStopped && (wasPaused || wasPlaying),
        isStopped: wasStopped
      }, 'Audio graph rebuilt and buffer rebound');

      if (wasPlaying) {
        await this.playBufferSource();
      } else {
        this.maintainSilentSource();
      }

      if (!wasStopped) {
        this.prepareNextTrackBufferWithRepeatMode();
      }
    } catch (error) {
      console.warn('[AudioContextManager] Buffer rebind after audio graph rebuild failed, falling back to audio element:', error);
      if (this.shouldSuppressAudioElementFallback(error)) {
        this.updateState({
          isTransitioning: false,
          transitionType: null,
          isPlaying: false,
          isPaused: false
        }, 'Audio graph rebind failed');
        return;
      }
      try {
        await this.rebindAudioElementAfterGraphRebuild(currentTrack, restorePosition, wasPlaying, wasPaused, wasStopped);
      } catch (fallbackError) {
        console.error('[AudioContextManager] Audio element rebind after graph rebuild failed:', fallbackError);
        this.updateState({
          isTransitioning: false,
          transitionType: null,
          isPlaying: false,
          isPaused: false
        }, 'Audio graph rebind failed');
      }
    }
  }

  /**
   * Fallback path for tracks that cannot be decoded into an AudioBuffer.
   */
  async rebindAudioElementAfterGraphRebuild(track, position, wasPlaying, wasPaused, wasStopped) {
    this.detachAudioElementForGraphRebuild();
    const playableTrack = await this.setupResolvedAudioElement(track);

    const audioElement = this.audioPlayer.audioElement;
    if (audioElement) {
      const applyPosition = () => {
        try {
          const duration = Number.isFinite(audioElement.duration) ? audioElement.duration : 0;
          audioElement.currentTime = duration > 0 ? Math.max(0, Math.min(position, duration)) : Math.max(0, position);
        } catch (e) {
          // Silent fail
        }
      };

      if (audioElement.readyState >= 1) {
        applyPosition();
      } else {
        audioElement.addEventListener('loadedmetadata', applyPosition, { once: true });
      }
    }

    this.updateState({
      currentTrack: playableTrack,
      currentTrackName: this.getDisplayTrackName(playableTrack),
      artworkUrl: '',
      currentBuffer: null,
      nextBuffer: null,
      currentTrackPosition: wasStopped ? 0 : Math.max(0, position),
      playbackMode: 'audioElement',
      isTransitioning: false,
      transitionType: null,
      isPlaying: false,
      isPaused: !wasStopped && (wasPaused || wasPlaying),
      isStopped: wasStopped
    }, 'Audio graph rebuilt and audio element rebound');

    if (wasPlaying) {
      await this.playAudioElement();
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
    return this.getPlaylist().findIndex(playlistTrack => playlistTrack === track);
  }

  getPlaylistTrackAt(index) {
    const normalizedIndex = this.normalizePlaylistIndex(index);
    return normalizedIndex >= 0 ? this.getPlaylist()[normalizedIndex] : null;
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
    const request = {
      token: ++this.loadRequestToken,
      track,
      targetIndex: this.normalizePlaylistIndex(targetIndex)
    };
    this.activeLoadRequest = request;
    this.clearNextTrackBuffer();
    return request;
  }

  isActiveLoadRequest(request) {
    return !!request &&
      this.activeLoadRequest?.token === request.token &&
      this.playbackEntriesMatch(this.activeLoadRequest.track, request.track, request.targetIndex);
  }

  beginTransitionRequest(track, targetIndex = null) {
    const request = {
      token: ++this.transitionRequestToken,
      track,
      targetIndex: this.normalizePlaylistIndex(targetIndex)
    };
    this.activeTransitionRequest = request;
    return request;
  }

  isActiveTransitionRequest(request) {
    return !!request &&
      this.activeTransitionRequest?.token === request.token &&
      this.playbackEntriesMatch(this.activeTransitionRequest.track, request.track, request.targetIndex);
  }

  invalidatePendingTransitionRequests() {
    this.transitionRequestToken++;
    this.activeTransitionRequest = null;
  }

  invalidatePendingPlaybackOperations() {
    this.stopRequestToken++;
    this.loadRequestToken++;
    this.activeLoadRequest = null;
    this.metadataRequestToken++;
    this.activeMetadataRequest = null;
    this.invalidatePendingTransitionRequests();
    this.clearNextTrackBuffer();
  }

  invalidatePendingPlaybackOperationsForStop() {
    this.invalidatePendingPlaybackOperations();
  }

  invalidatePendingPlaybackOperationsForPause() {
    this.invalidatePendingPlaybackOperations();
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
      !this.playbackEntriesMatch(this.activeMetadataRequest.track, request.track, request.targetIndex)) {
      return false;
    }
    if (request.loadRequest && !this.isActiveLoadRequest(request.loadRequest)) {
      return false;
    }
    return this.isCurrentTrackRequestTrack(request.track, request.targetIndex);
  }

  isCurrentTrackRequestTrack(track, targetIndex = null) {
    const normalizedTargetIndex = this.normalizePlaylistIndex(targetIndex);
    const currentIndex = this.audioPlayer.stateManager?.getCurrentTrackIndex?.();
    if (normalizedTargetIndex >= 0 && currentIndex !== normalizedTargetIndex) {
      return false;
    }

    const stateTrack = this.getCurrentState()?.currentTrack;
    if (stateTrack) {
      if (stateTrack === track) return true;

      const stateIndex = this.getPlaylistIdentityIndex(stateTrack);
      const trackIndex = this.getPlaylistIdentityIndex(track);
      if (stateIndex >= 0 && trackIndex >= 0) {
        return stateIndex === trackIndex;
      }

      return samePlaybackEntry(stateTrack, track);
    }

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
    const entry = this.nextBuffer;
    if (!entry?.buffer ||
      entry.requestToken !== this.nextBufferRequestToken ||
      !this.playbackEntriesMatch(entry.track, track, targetIndex)) {
      return null;
    }

    this.nextBuffer = null;
    return entry.buffer;
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

    const playlistIndex = this.getPlaylist().findIndex(playlistTrack => samePlaybackEntry(playlistTrack, track));
    if (playlistIndex >= 0) return playlistIndex;

    return fallbackIndex;
  }
  
  // ===== AUDIO ELEMENT MANAGEMENT =====
  
  /**
   * Set up audio element for a track (metadata and fallback only)
   */
  setupAudioElement(track, targetIndex = null) {
    const currentIndex = this.getTrackIndexForPlaybackEntry(track, targetIndex);
    
    if (!this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement = new Audio();
      this.setupEventHandlers();
    }
    
    if (isFileObject(track.file)) {
      if (this.currentObjectURL) {
        URL.revokeObjectURL(this.currentObjectURL);
      }
      this.currentObjectURL = URL.createObjectURL(track.file);
      this.audioPlayer.audioElement.src = this.currentObjectURL;
    } else if (track.path) {
      let formattedPath = track.path;
      if (window.electronAPI && window.electronIntegration) {
        formattedPath = formattedPath.replace(/\\/g, '/');
        if (!formattedPath.startsWith('file://')) {
          formattedPath = `file://${formattedPath}`;
        }
      }
      this.audioPlayer.audioElement.src = formattedPath;
    } else {
      return false;
    }
    
    this.audioPlayer.audioElement.load();
    this.connectToAudioContext();
    this.setupMediaSessionHandlers();
    
    this.updateState({
      currentTrack: track,
      currentTrackName: this.getDisplayTrackName(track),
      artworkUrl: '',
      currentTrackIndex: currentIndex,
      playbackMode: 'audioElement'
    }, 'Track loaded and audio element setup completed');
    
    this.loadMetadata(track, null, currentIndex);
    return true;
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
      const state = this.getCurrentState();
      if (!state?.isStopped) {
        this.handleTrackEnded();
      }
    };
    
    this.eventHandlers.timeupdate = (event) => {
      if (!isCurrentAudioElementEvent(event)) return;
      const state = this.getCurrentState();
      if (state?.playbackMode === 'audioElement') {
        this.updateState({
          currentTrackPosition: audioElement.currentTime
        });
      }
    };
    
    this.eventHandlers.error = (e) => {
      if (!isCurrentAudioElementEvent(e)) return;
      if (e.target.error && e.target.error.code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        if (window.uiManager) {
          window.uiManager.setError(`Audio playback error: ${e.target.error?.message || 'Unknown error'}`);
        }
      }
    };
    
    this.eventHandlers.loadedmetadata = (event) => {
      if (!isCurrentAudioElementEvent(event)) return;
      this.updateState({
        currentTrackDuration: audioElement.duration || 0
      }, 'Metadata loaded');
      this.updateTrackNameFromMetadata();
    };
    
    audioElement.addEventListener('ended', this.eventHandlers.ended);
    audioElement.addEventListener('timeupdate', this.eventHandlers.timeupdate);
    audioElement.addEventListener('error', this.eventHandlers.error);
    audioElement.addEventListener('loadedmetadata', this.eventHandlers.loadedmetadata);
  }
  
  /**
   * Connect the audio element to the Web Audio API context
   */
  connectToAudioContext() {
    try {
      if (this.mediaSource) {
        try {
          this.mediaSource.disconnect();
        } catch (e) {
          // Silent fail
        }
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
      
      this.connectMediaSource(this.mediaSource);
      
    } catch (error) {
      console.error('Error connecting audio element to context:', error);
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

    if (track?.meta?.title) {
      if (!this.isActiveMetadataRequest(metadataRequest)) return;
      const displayText = this.getDisplayTrackName(track);
      this.updateState({
        currentTrackName: displayText,
        artworkUrl: ''
      }, 'Catalog metadata loaded');
      if (this.audioPlayer.ui?.trackNameDisplay) {
        this.audioPlayer.ui.trackNameDisplay.textContent = displayText;
      }
      const artworkId = track.meta.artworkId;
      if (artworkId && window.libraryManager?.getArtworkThumbURL) {
        window.libraryManager.getArtworkThumbURL(artworkId).then(async artworkUrl => {
          if (!this.isActiveMetadataRequest(metadataRequest) ||
            currentIndex !== this.audioPlayer.stateManager.getCurrentTrackIndex()) {
            return;
          }
          const ownedUrl = await this.adoptLibraryArtworkURL(artworkUrl);
          const isOwnedArtworkUrl = !!ownedUrl && ownedUrl !== artworkUrl;
          if (!this.isActiveMetadataRequest(metadataRequest) ||
            currentIndex !== this.audioPlayer.stateManager.getCurrentTrackIndex()) {
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
          this.updateState({ artworkUrl: ownedUrl || '' }, 'Catalog artwork loaded');
        }).catch(() => {});
      }
      this.updateMediaSessionWithTags(track.meta.title, track.meta.artist || '', track.meta.album || '', '');
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
      if ((metadataRequest && !this.isActiveMetadataRequest(metadataRequest)) ||
        currentIndex !== this.audioPlayer.stateManager.getCurrentTrackIndex()) {
        return false;
      }

      const title = riffInfo?.title || this.normalizeMetadataTagText(tags.title || '', [file.name]);
      const tagReferenceTexts = [title, file.name];
      const artist = riffInfo?.artist || this.normalizeMetadataTagText(tags.artist || '', tagReferenceTexts);
      const album = riffInfo?.album || this.normalizeMetadataTagText(tags.album || '', tagReferenceTexts);
      const artworkUrl = this.createArtworkURL(tags.picture);
      const displayText = title ? (artist ? `${artist} - ${title}` : title) : file.name;

      this.updateState({
        currentTrackName: displayText,
        artworkUrl
      }, 'ID3 metadata loaded');
      if (this.audioPlayer.ui?.trackNameDisplay) {
        this.audioPlayer.ui.trackNameDisplay.textContent = displayText;
      }

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
      if ((metadataRequest && !this.isActiveMetadataRequest(metadataRequest)) ||
        currentIndex !== this.audioPlayer.stateManager.getCurrentTrackIndex()) {
        return;
      }
      
      try {
        if (window.jsmediatags && this.audioPlayer.audioElement.src) {
          window.jsmediatags.read(this.audioPlayer.audioElement.src, {
            onSuccess: (tag) => {
              if ((metadataRequest && !this.isActiveMetadataRequest(metadataRequest)) ||
                currentIndex !== this.audioPlayer.stateManager.getCurrentTrackIndex()) {
                return;
              }

              const tags = tag.tags;
              const title = this.normalizeMetadataTagText(tags.title || '', [track.name]);
              const tagReferenceTexts = [title, track.name];
              const artist = this.normalizeMetadataTagText(tags.artist || '', tagReferenceTexts);
              const album = this.normalizeMetadataTagText(tags.album || '', tagReferenceTexts);
              const artworkUrl = this.createArtworkURL(tags.picture);
              const displayText = title ? (artist ? `${artist} - ${title}` : title) : track.name;
              
              this.updateState({
                currentTrackName: displayText,
                artworkUrl
              }, 'Source metadata loaded');
              if (this.audioPlayer.ui?.trackNameDisplay) {
                this.audioPlayer.ui.trackNameDisplay.textContent = displayText;
              }
              
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
        return this.seek(details.seekTime);
      }
      return undefined;
    });
  }
  
  /**
   * Fallback to MediaSession API with basic track info
   */
  fallbackToMediaSession(currentIndex, metadataRequest = null) {
    if (metadataRequest && !this.isActiveMetadataRequest(metadataRequest)) return;
    if (currentIndex !== this.audioPlayer.stateManager.getCurrentTrackIndex()) return;

    const track = this.audioPlayer.playbackManager?.getTrack(currentIndex);
    if (track?.meta?.title) return;

    if (this.audioPlayer.audioElement?.duration > 0) {
      if (this.audioPlayer.audioElement.title) {
        this.clearArtworkURL();
        this.updateState({
          currentTrackName: this.audioPlayer.audioElement.title,
          artworkUrl: ''
        }, 'Audio element metadata fallback');
        if (this.audioPlayer.ui?.trackNameDisplay) {
          this.audioPlayer.ui.trackNameDisplay.textContent = this.audioPlayer.audioElement.title;
        }
        this.updateMediaSessionWithTags(this.audioPlayer.audioElement.title, '', '', '');
        return;
      }
    }
    
    if (track && track.name) {
      this.clearArtworkURL();
      this.updateState({
        currentTrackName: this.getDisplayTrackName(track),
        artworkUrl: ''
      }, 'Track name metadata fallback');
      if (this.audioPlayer.ui?.trackNameDisplay) {
        this.audioPlayer.ui.trackNameDisplay.textContent = this.getDisplayTrackName(track);
      }
      this.updateMediaSessionWithTags(this.getDisplayTrackName(track), '', '', '');
    }
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
  async play(forcePlay = false) {
    const state = this.getCurrentState();
    if (state?.isTransitioning && !forcePlay) {
      return false;
    }

    const stopToken = this.stopRequestToken;
    await this.resumePlaybackAudioContext();
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
    
    try {
      await this.stopCurrentPlayback();
      if (this.stopRequestToken !== stopToken) {
        return false;
      }
      
      const instanceId = this.currentInstanceId;
      
      const state = this.getCurrentState();
      const resumePosition = state?.isPaused ? state.currentTrackPosition : 0;
      
      this.currentBufferSource = this.createBufferSource(this.currentBuffer, instanceId);
      
      const currentTime = this.audioPlayer.audioContext.currentTime;
      this.currentBufferSource.start(currentTime, resumePosition);
      
      this.bufferStartTime = currentTime - resumePosition;
      this.bufferDuration = this.currentBuffer.duration;
      
      this.updateState({
        isPlaying: true,
        isPaused: false,
        isStopped: false,
        currentInstanceId: instanceId,
        playbackInstanceId: instanceId,
        bufferStartTime: currentTime - resumePosition,
        bufferDuration: this.currentBuffer.duration
      }, 'Buffer source playback started');
      
      this.setupBufferMonitoring();
      return true;
      
    } catch (error) {
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
    
    try {
      await audioElement.play();
      if (this.stopRequestToken !== stopToken || this.audioPlayer.audioElement !== audioElement) {
        try {
          audioElement.pause();
        } catch (e) {
          // Silent fail
        }
        return false;
      }
      
      this.updateState({
        isPlaying: true,
        isPaused: false,
        isStopped: false
      }, 'Audio element playback started');
      return true;
      
    } catch (error) {
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
    }
  }
  
  /**
   * Pause current track
   */
  async pause() {
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
      try {
        this.currentBufferSource.onended = null;
        this.currentBufferSource.stop();
        this.currentBufferSource.disconnect();
        this.currentBufferSource = null;
      } catch (error) {
        // Silent fail
      }
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
    if (this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement.pause();
    }
    
    this.updateState({
      isPlaying: false,
      isPaused: true,
      isStopped: false
    }, 'Audio element paused');
  }
  
  /**
   * Stop current track
   */
  async stop() {
    this.invalidatePendingPlaybackOperationsForStop();
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
      try {
        this.currentBufferSource.onended = null;
        this.currentBufferSource.stop();
        this.currentBufferSource.disconnect();
      } catch (error) {
        // Silent fail
      }
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
    if (this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement.pause();
      this.audioPlayer.audioElement.currentTime = 0;
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
      const clampedTime = Math.max(0, Math.min(time, this.audioPlayer.audioElement.duration));
      const state = this.getCurrentState();
      this.audioPlayer.audioElement.currentTime = clampedTime;
      
      const updates = {
        currentTrackPosition: clampedTime
      };
      if (!state?.isPlaying) {
        updates.isPlaying = false;
        updates.isPaused = true;
        updates.isStopped = false;
      }
      this.updateState(updates, 'Audio element seek completed');
    }
  }
  
  // ===== TRACK MANAGEMENT =====
  
  /**
   * Handle track ended event
   */
  handleTrackEnded() {
    const state = this.getCurrentState();
    if (state?.isStopped) {
      return;
    }
    
    if (state?.isTransitioning) {
      return;
    }
    
    const repeatMode = state?.repeatMode || 'OFF';
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const playlist = this.audioPlayer.playbackManager?.playlist || [];
    
    if (repeatMode === 'ONE') {
      const currentTrack = this.audioPlayer.playbackManager?.getTrack(currentIndex);
      if (currentTrack) {
        this.seamlessTransition(currentTrack, currentIndex).catch(error => {
          console.error('[AudioContextManager] Failed to restart track in repeat ONE mode:', error);
        });
      }
      return;
    }
    
    const isLastTrack = currentIndex >= playlist.length - 1;
    
    if (isLastTrack && repeatMode === 'ALL') {
      if (this.audioPlayer.playbackManager?.onTrackEnded) {
        this.audioPlayer.playbackManager.onTrackEnded();
      } else if (playlist.length > 0) {
        const firstTrack = playlist[0];
        this.transitionToNextTrack(firstTrack, 0).catch(error => {
          console.error('[AudioContextManager] Failed to transition to first track in repeat ALL mode:', error);
        });
      }
      return;
    } else if (isLastTrack && repeatMode === 'OFF') {
      this.stopCurrentPlayback();
      this.maintainSilentSource();
      
      if (this.audioPlayer.playbackManager && this.audioPlayer.playbackManager.playlist.length > 0) {
        const firstTrack = this.audioPlayer.playbackManager.playlist[0];
        const loadRequest = this.beginLoadRequest(firstTrack, 0);
        const isStale = () => !this.isActiveLoadRequest(loadRequest) ||
          !samePlaybackEntry(this.getCurrentState()?.currentTrack, firstTrack) ||
          this.audioPlayer.stateManager?.getCurrentTrackIndex?.() !== 0;
        this.currentBuffer = null;
        this.bufferDuration = 0;
        
        this.updateState({
          currentTrack: firstTrack,
          currentTrackName: this.getDisplayTrackName(firstTrack),
          artworkUrl: '',
          currentTrackPosition: 0,
          currentTrackDuration: 0,
          currentBuffer: null,
          isPlaying: false,
          isPaused: false,
          isStopped: true
        }, 'Playback ended - first track ready for next playback');
        
        this.clearBufferMonitoring();
        
        if (this.audioPlayer.stateManager) {
          this.audioPlayer.stateManager.updateState({
            currentTrackIndex: 0
          }, 'AudioContextManager handleTrackEnded repeat OFF');
        }

        this.loadMetadata(firstTrack, loadRequest, 0);
        
        this.prepareTrackBuffer(firstTrack, isStale).then(buffer => {
          if (isStale() || !buffer) return;

          this.currentBuffer = buffer;
          
          this.updateState({
            currentBuffer: buffer,
            currentTrackDuration: buffer.duration
          }, 'First track buffer prepared for next playback');
          
          this.prepareNextTrackBufferWithRepeatMode();
        }).catch(error => {
          console.error('[AudioContextManager] Failed to prepare first track buffer:', error);
        });
      } else {
        this.updateState({
          currentTrack: null,
          currentTrackIndex: -1,
          currentTrackName: '',
          artworkUrl: '',
          currentTrackDuration: 0,
          currentTrackPosition: 0,
          currentBuffer: null,
          nextBuffer: null,
          isPlaying: false,
          isPaused: false,
          isStopped: true
        }, 'Playback ended - no playlist available');
      }
      
      return;
    } else {
      this.audioPlayer.playbackManager?.onTrackEnded();
    }
  }
  
  /**
   * Stop current playback (internal method)
   */
  async stopCurrentPlayback() {
    if (this.currentBufferSource) {
      try {
        this.currentBufferSource.onended = null;
        this.currentBufferSource.stop();
        this.currentBufferSource.disconnect();
      } catch (error) {
        // Silent fail
      }
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
          
          const timeUntilEnd = this.bufferDuration - elapsedTime;
          if (timeUntilEnd <= 0.1 && timeUntilEnd > 0 && !state?.isTransitioning && !state?.isStopped) {
            this.handleTrackEnded();
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
  async loadTrack(track, targetIndex = null) {
    const trackIndex = this.getTrackIndexForPlaybackEntry(track, targetIndex);
    const loadRequest = this.beginLoadRequest(track, trackIndex);
    const isStale = () => !this.isActiveLoadRequest(loadRequest);
    this.currentBuffer = null;
    this.bufferDuration = 0;

    try {
      this.updateState({
        currentTrack: track,
        currentTrackName: this.getDisplayTrackName(track),
        artworkUrl: '',
        currentTrackIndex: trackIndex,
        currentTrackDuration: 0,
        currentTrackPosition: 0,
        currentBuffer: null,
        isTransitioning: true,
        transitionType: 'loading'
      }, 'Track loading started');
      
      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          currentTrack: track,
          currentTrackIndex: trackIndex
        }, 'AudioContextManager loadTrack');
      }
      
      const buffer = await this.prepareTrackBuffer(track, isStale);
      if (isStale() || !buffer) return false;

      this.currentBuffer = buffer;
      
      this.updateState({
        currentTrackDuration: buffer.duration,
        playbackMode: 'bufferSource',
        isTransitioning: false,
        transitionType: null
      }, 'Track loaded and buffer prepared');
      
      if (isStale()) return false;
      this.loadMetadata(track, loadRequest, trackIndex);
      this.prepareNextTrackBufferWithRepeatMode();
      return true;
      
    } catch (error) {
      if (isStale()) return false;
      console.error('[AudioContextManager] Track loading failed:', error);

      if (!this.shouldSuppressAudioElementFallback(error)) {
        this.updateState({
          playbackMode: 'audioElement',
          isTransitioning: false,
          transitionType: null
        }, 'Falling back to audio element mode');
      }
      
      return this.handleTrackLoadFailure(track, error, loadRequest, trackIndex);
    }
  }
  
  /**
   * Prepare track buffer
   */
  async prepareTrackBuffer(track, isStale = null) {
    try {
      const arrayBuffer = await this.loadTrackData(track, isStale);
      if (isStale?.() || !arrayBuffer) return null;

      const audioBuffer = await new Promise((resolve, reject) => {
        this.audioPlayer.audioContext.decodeAudioData(arrayBuffer, resolve, reject);
      });
      if (isStale?.()) return null;
      
      return audioBuffer;
    } catch (error) {
      console.error('[AudioContextManager] Buffer preparation failed for:', track?.name, error);
      throw error;
    }
  }
  
  /**
   * Load track data as ArrayBuffer
   */
  async loadTrackData(track, isStale = null) {
    try {
      const playableTrack = await this.resolveTrackProvider(track);
      if (isStale?.()) return null;

      if (isFileObject(playableTrack.file)) {
        const arrayBuffer = await playableTrack.file.arrayBuffer();
        if (isStale?.()) return null;
        return arrayBuffer;
      } else if (playableTrack.path) {
        if (this.shouldUseElectronFileRead(playableTrack.path)) {
          const arrayBuffer = await this.loadElectronFileTrackData(playableTrack.path, playableTrack);
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
    if (!track?.provider || track.file || track.path) return track;
    const resolved = await track.provider();
    return {
      ...track,
      ...(resolved?.file ? { file: resolved.file } : {}),
      ...(resolved?.path ? { path: resolved.path } : {})
    };
  }

  async setupResolvedAudioElement(track, isStale = null, targetIndex = null) {
    const playableTrack = await this.resolveTrackProvider(track);
    if (isStale?.()) return null;
    if (!this.setupAudioElement(playableTrack, targetIndex)) {
      throw new Error('Invalid track: no file or path provided');
    }
    return playableTrack;
  }

  async handleTrackLoadFailure(track, error, loadRequest = null, targetIndex = null) {
    const isStale = () => loadRequest && !this.isActiveLoadRequest(loadRequest);

    if (this.shouldSuppressAudioElementFallback(error)) {
      return this.completeTrackLoadFailure(error, error, isStale, targetIndex);
    }

    try {
      const playableTrack = await this.setupResolvedAudioElement(track, isStale, targetIndex);
      if (isStale() || !playableTrack) return false;
      return true;
    } catch (fallbackError) {
      if (isStale()) return false;
      console.error('[AudioContextManager] Audio element fallback failed:', fallbackError);
      return this.completeTrackLoadFailure(fallbackError, error, isStale, targetIndex);
    }
  }

  async completeTrackLoadFailure(error, originalError, isStale = () => false, failedIndex = null) {
    if (isStale()) return false;

    this.updateState({
      isTransitioning: false,
      transitionType: null,
      isPlaying: false,
      isPaused: false
    }, 'Track loading failed');

    if (window.uiManager?.setError) {
      window.uiManager.setError(`Failed to load track: ${error?.message || originalError?.message || 'Unknown error'}`);
    }

    const playbackManager = this.audioPlayer.playbackManager;
    if (playbackManager?.playlist?.length > 1) {
      await playbackManager.playNext(false, {
        allowDuringTransition: true,
        ignoreRepeatOne: true,
        failedIndex: this.normalizePlaylistIndex(failedIndex)
      });
    }
    return false;
  }

  /**
   * Check whether a track path should be loaded through Electron's file API.
   */
  shouldUseElectronFileRead(path) {
    if (!window.electronAPI || !window.electronIntegration?.isElectron || typeof path !== 'string') {
      return false;
    }

    if (/^[A-Za-z]:[\\/]/.test(path)) return true;
    if (/^[A-Za-z][A-Za-z\d+\-.]*:/.test(path)) return false;
    return path.startsWith('/') || path.startsWith('\\\\') || path.includes('\\');
  }

  /**
   * Load an Electron local file path as ArrayBuffer for decodeAudioData.
   */
  async loadElectronFileTrackData(path, track = null) {
    if (typeof window.electronAPI?.library?.readFileBytes === 'function') {
      try {
        const bytes = await window.electronAPI.library.readFileBytes({ path });
        if (bytes instanceof ArrayBuffer) return bytes;
        if (ArrayBuffer.isView(bytes)) {
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        }
      } catch (error) {
        if (this.isLibraryPlaybackEntry(track) && this.isLibraryReadAuthorizationOrLimitError(error)) {
          throw this.markSuppressAudioElementFallback(error);
        }
        if (!this.shouldFallbackToLegacyElectronRead(error)) {
          throw error;
        }
        console.warn('[AudioContextManager] Library byte read failed, falling back to legacy file read:', error);
      }
    }

    if (typeof window.electronAPI?.readFile !== 'function') {
      throw new Error('Failed to load local track: Electron file read API is unavailable');
    }

    const result = await window.electronAPI.readFile(path, true);
    if (!result?.success) {
      throw new Error(`Failed to load local track: ${result?.error || 'Unknown error'}`);
    }

    return this.base64ToArrayBuffer(result.content);
  }

  shouldFallbackToLegacyElectronRead(error) {
    const message = error?.message || String(error || '');
    if (this.isLibraryReadLimitError(error)) return false;
    return message.includes('No library folder has been selected') ||
      message.includes('outside the selected music library folders');
  }

  isLibraryPlaybackEntry(track) {
    return Boolean(track?.libraryTrackId || track?.provider || track?.meta);
  }

  isLibraryReadAuthorizationOrLimitError(error) {
    return this.isLibraryReadAuthorizationError(error) || this.isLibraryReadLimitError(error);
  }

  isLibraryReadAuthorizationError(error) {
    const message = error?.message || String(error || '');
    return message.includes('No library folder has been selected') ||
      message.includes('outside the selected music library folders');
  }

  isLibraryReadLimitError(error) {
    const message = error?.message || String(error || '');
    return error?.code === 'ERR_LIBRARY_READ_LIMIT' ||
      message.includes('ERR_LIBRARY_READ_LIMIT') ||
      message.includes('maximum read size') ||
      message.includes('maximum library read size');
  }

  markSuppressAudioElementFallback(error) {
    if (error && typeof error === 'object') {
      error.suppressAudioElementFallback = true;
    }
    return error;
  }

  shouldSuppressAudioElementFallback(error) {
    return Boolean(error?.suppressAudioElementFallback);
  }

  /**
   * Convert a base64 string returned by Electron IPC to an ArrayBuffer.
   */
  base64ToArrayBuffer(base64Data) {
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
  
  /**
   * Prepare next track buffer considering repeat mode
   */
  async prepareNextTrackBufferWithRepeatMode() {
    if (!this.audioPlayer.playbackManager) return;
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const playlist = this.audioPlayer.playbackManager.playlist;
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
  async prepareNextTrackBufferForTrack(track, targetIndex = null) {
    if (!track) return;
    const request = this.beginNextBufferRequest(track, targetIndex);
    
    try {
      const buffer = await this.prepareTrackBuffer(track, () => !this.isActiveNextBufferRequest(request));
      if (!buffer || !this.isExpectedNextBufferRequest(request)) return;
      this.nextBuffer = {
        buffer,
        track,
        targetIndex: request.targetIndex,
        requestToken: request.token
      };
    } catch (error) {
      if (this.isActiveNextBufferRequest(request)) {
        console.warn('[AudioContextManager] Next track buffer preparation failed:', error);
      }
    }
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
  async transitionToNextTrack(nextTrack, targetIndex = null) {
    const nextTrackIndex = this.getTrackIndexForPlaybackEntry(nextTrack, targetIndex, -1);
    const transitionRequest = this.beginTransitionRequest(nextTrack, nextTrackIndex);
    this.updateState({
      isTransitioning: true,
      transitionType: 'seamless'
    }, 'Transition started');
    
    try {
      const bufferedNextTrack = this.consumeNextBufferForTrack(nextTrack, nextTrackIndex);
      if (bufferedNextTrack) {
        let nextNextIndex = nextTrackIndex + 1;
        if (this.audioPlayer.playbackManager && nextNextIndex >= this.audioPlayer.playbackManager.playlist.length) {
          const state = this.getCurrentState();
          if (state?.repeatMode === 'ALL') {
            nextNextIndex = 0;
          } else {
            nextNextIndex = -1;
          }
        }
        
        if (this.audioPlayer.stateManager && nextTrackIndex >= 0) {
          this.audioPlayer.stateManager.updateState({
            currentTrack: nextTrack,
            currentTrackIndex: nextTrackIndex
          }, 'AudioContextManager transitionToNextTrack');
        }
        
        this.currentBuffer = bufferedNextTrack;
        
        this.updateState({
          currentTrack: nextTrack,
          currentTrackName: this.getDisplayTrackName(nextTrack),
          artworkUrl: '',
          currentTrackDuration: this.currentBuffer.duration,
          currentTrackPosition: 0
        }, 'Switched to next track buffer');
        this.loadMetadata(nextTrack, null, nextTrackIndex);
        
        const started = await this.createAndStartBufferSource(() => !this.isActiveTransitionRequest(transitionRequest));
        if (started === false || !this.isActiveTransitionRequest(transitionRequest)) {
          return false;
        }
        
        if (nextNextIndex >= 0 && this.audioPlayer.playbackManager) {
          const nextNextTrack = this.audioPlayer.playbackManager.getTrack(nextNextIndex);
          if (nextNextTrack) {
            this.prepareNextTrackBufferForTrack(nextNextTrack, nextNextIndex);
          }
        } else {
          this.prepareNextTrackBufferWithRepeatMode();
        }
        
      } else {
        if (this.nextBuffer) {
          this.clearNextTrackBuffer();
        }
        const loaded = await this.loadTrack(nextTrack, nextTrackIndex);
        if (loaded === false || !this.isActiveTransitionRequest(transitionRequest)) {
          return false;
        }
        const started = await this.play();
        if (started === false || !this.isActiveTransitionRequest(transitionRequest)) {
          return false;
        }
      }
      
      this.updateState({
        isTransitioning: false,
        transitionType: null,
        isPlaying: true,
        isPaused: false,
        isStopped: false
      }, 'Transition completed');
      return true;
      
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
  
  /**
   * Create and start buffer source directly (for transitions)
   */
  async createAndStartBufferSource(isStale = null) {
    if (!this.currentBuffer) {
      throw new Error('No current buffer available for playback');
    }
    
    try {
      await this.stopCurrentPlayback();
      if (isStale?.()) return false;
      
      const instanceId = this.currentInstanceId;
      
      this.currentBufferSource = this.createBufferSource(this.currentBuffer, instanceId);
      
      const currentTime = this.audioPlayer.audioContext.currentTime;
      this.currentBufferSource.start(currentTime);
      
      this.bufferStartTime = currentTime;
      this.bufferDuration = this.currentBuffer.duration;
      
      this.updateState({
        isPlaying: true,
        isPaused: false,
        isStopped: false,
        currentInstanceId: instanceId,
        playbackInstanceId: instanceId,
        bufferStartTime: currentTime,
        bufferDuration: this.currentBuffer.duration
      }, 'Buffer source playback started');
      
      this.setupBufferMonitoring();
      return true;
      
    } catch (error) {
      console.error('[AudioContextManager] Buffer source creation failed:', error);
      throw error;
    }
  }
  
  /**
   * Seamless transition to a track (for previous/next track functionality)
   */
  async seamlessTransition(track, targetIndex = null) {
    const trackIndex = this.getTrackIndexForPlaybackEntry(track, targetIndex);
    const transitionRequest = this.beginTransitionRequest(track, trackIndex);
    this.updateState({
      isTransitioning: true,
      transitionType: 'seamless'
    }, 'Seamless transition started');
    
    try {
      const loaded = await this.loadTrack(track, trackIndex);
      if (loaded === false || !this.isActiveTransitionRequest(transitionRequest)) {
        return false;
      }
      const started = await this.play();
      if (started === false || !this.isActiveTransitionRequest(transitionRequest)) {
        return false;
      }
      
      this.updateState({
        isTransitioning: false,
        transitionType: null
      }, 'Seamless transition completed');
      return true;
      
    } catch (error) {
      console.error('[AudioContextManager] Seamless transition failed:', error);
      if (this.isActiveTransitionRequest(transitionRequest)) {
        this.updateState({
          isTransitioning: false,
          transitionType: null
        }, 'Seamless transition failed');
      }
      throw error;
    }
  }
  
  // ===== CLEANUP =====
  
  /**
   * Disconnect and clean up audio connections
   */
  disconnect() {
    this.invalidatePendingPlaybackOperationsForDisconnect();
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
        try {
          this.mediaSource.disconnect();
        } catch (e) {
          // Silent fail
        }
        this.mediaSource = null;
      }
      
      if (this.currentObjectURL) {
        URL.revokeObjectURL(this.currentObjectURL);
        this.currentObjectURL = null;
      }
      
      this.currentBuffer = null;
      this.clearNextTrackBuffer();
      this.clearArtworkURL();
      this.clearBufferMonitoring();
      
      this.updateState({
        currentTrack: null,
        currentTrackIndex: -1,
        currentTrackName: '',
        artworkUrl: '',
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
        
        const silentDataUrl = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        this.audioPlayer.audioElement.src = silentDataUrl;
      }
      
      const useInputWithPlayer = this.getUseInputWithPlayer();
      if (!useInputWithPlayer && this.originalSourceNode) {
        this.setManagedSourceNode(this.originalSourceNode);
        if (this.audioManager.workletNode) {
          try {
            this.audioManager.connectSourceToPipeline(this.audioManager.sourceNode);
          } catch (e) {
            // Silent fail
          }
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
    this.nextBufferRequestToken++;
    this.activeNextBufferRequest = null;
    this.nextBuffer = null;
  }
}

function isFileObject(value) {
  return typeof File !== 'undefined' && value instanceof File;
}

function samePlaybackEntry(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
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
