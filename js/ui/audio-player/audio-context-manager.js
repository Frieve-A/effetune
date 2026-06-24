/**
 * AudioContextManager - Handles Web Audio API integration and metadata processing
 * Manages media sources and audio connections
 * UNIFIED STATE MANAGEMENT: All state managed in StateManager only
 */
export class AudioContextManager {
  constructor(audioPlayer, audioManager) {
    this.audioPlayer = audioPlayer;
    this.audioManager = audioManager;
    this.mediaSource = null;
    this.originalSourceNode = null;
    this.currentObjectURL = null;
    
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
  
  /**
   * Connect buffer source to audio manager
   */
  connectBufferSource(bufferSource) {
    const useInputWithPlayer = window.electronIntegration?.audioPreferences?.useInputWithPlayer || false;
    
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
    const useInputWithPlayer = window.electronIntegration?.audioPreferences?.useInputWithPlayer || false;
    
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
  
  /**
   * Maintain silent source for pipeline when useInputWithPlayer is false
   */
  maintainSilentSource() {
    const useInputWithPlayer = window.electronIntegration?.audioPreferences?.useInputWithPlayer || false;
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
    this.currentInstanceId++;
  }

  /**
   * Drop an element bound to an old AudioContext so fallback playback can bind
   * a fresh MediaElementSource to the new context.
   */
  detachAudioElementForGraphRebuild() {
    const audioElement = this.audioPlayer.audioElement;
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

    try {
      audioElement.pause();
    } catch (e) {
      // Silent fail
    }

    this.audioPlayer.audioElement = null;
    this.eventHandlers = {
      ended: null,
      timeupdate: null,
      error: null,
      loadedmetadata: null
    };
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
    this.nextBuffer = null;

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
        currentTrackName: currentTrack.name,
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
      await this.rebindAudioElementAfterGraphRebuild(currentTrack, restorePosition, wasPlaying, wasPaused, wasStopped);
    }
  }

  /**
   * Fallback path for tracks that cannot be decoded into an AudioBuffer.
   */
  async rebindAudioElementAfterGraphRebuild(track, position, wasPlaying, wasPaused, wasStopped) {
    this.detachAudioElementForGraphRebuild();
    this.setupAudioElement(track);

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
      currentTrack: track,
      currentTrackName: track.name,
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
    this.audioPlayer.stateManager.updateState(updates, logMessage);
  }
  
  // ===== AUDIO ELEMENT MANAGEMENT =====
  
  /**
   * Set up audio element for a track (metadata and fallback only)
   */
  setupAudioElement(track) {
    const currentIndex = this.audioPlayer.playbackManager?.currentTrackIndex ?? -1;
    
    if (!this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement = new Audio();
      this.setupEventHandlers();
    }
    
    if (track.file instanceof File) {
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
      return;
    }
    
    this.audioPlayer.audioElement.load();
    this.connectToAudioContext();
    this.setupMediaSessionHandlers();
    
    this.updateState({
      currentTrack: track,
      currentTrackName: track.name,
      currentTrackIndex: this.audioPlayer.playbackManager?.currentTrackIndex ?? -1,
      playbackMode: 'audioElement'
    }, 'Track loaded and audio element setup completed');
    
    this.loadMetadata(track);
  }
  
  /**
   * Set up event handlers for the audio element
   */
  setupEventHandlers() {
    this.eventHandlers.ended = () => {
      const state = this.getCurrentState();
      if (!state?.isStopped) {
        this.handleTrackEnded();
      }
    };
    
    this.eventHandlers.timeupdate = () => {
      const state = this.getCurrentState();
      if (state?.playbackMode === 'audioElement' && this.audioPlayer.audioElement) {
        this.updateState({
          currentTrackPosition: this.audioPlayer.audioElement.currentTime
        });
      }
    };
    
    this.eventHandlers.error = (e) => {
      if (e.target.error && e.target.error.code !== MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        if (window.uiManager) {
          window.uiManager.setError(`Audio playback error: ${e.target.error?.message || 'Unknown error'}`);
        }
      }
    };
    
    this.eventHandlers.loadedmetadata = () => {
      if (this.audioPlayer.audioElement) {
        this.updateState({
          currentTrackDuration: this.audioPlayer.audioElement.duration || 0
        }, 'Metadata loaded');
      }
      this.updateTrackNameFromMetadata();
    };
    
    this.audioPlayer.audioElement.addEventListener('ended', this.eventHandlers.ended);
    this.audioPlayer.audioElement.addEventListener('timeupdate', this.eventHandlers.timeupdate);
    this.audioPlayer.audioElement.addEventListener('error', this.eventHandlers.error);
    this.audioPlayer.audioElement.addEventListener('loadedmetadata', this.eventHandlers.loadedmetadata);
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
  loadMetadata(track) {
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    
    if (track.file instanceof File) {
      this.readID3Tags(track.file, currentIndex);
    } else {
      this.tryReadFromAudioElementSrc(track, currentIndex);
    }
  }
  
  /**
   * Read ID3 tags from a file
   */
  readID3Tags(file, currentIndex) {
    if (window.jsmediatags) {
      window.jsmediatags.read(file, {
        onSuccess: (tag) => {
          const tags = tag.tags;
          const title = tags.title || '';
          const artist = tags.artist || '';
          const album = tags.album || '';
          
          if (this.audioPlayer.ui && this.audioPlayer.ui.trackNameDisplay) {
            if (currentIndex === this.audioPlayer.stateManager.getCurrentTrackIndex()) {
              let displayText = title;
              if (artist) {
                displayText = `${artist} - ${displayText}`;
              }
              this.audioPlayer.ui.trackNameDisplay.textContent = displayText || file.name;
            }
          }
          
          this.updateMediaSessionWithTags(title || file.name, artist, album);
        },
        onError: (error) => {
          if (error && error.type !== 'tagFormat') {
            console.warn('Error reading ID3 tags:', error);
          }
          this.fallbackToMediaSession(currentIndex);
        }
      });
    } else {
      this.fallbackToMediaSession(currentIndex);
    }
  }
  
  /**
   * Try to read metadata from audio element src
   */
  tryReadFromAudioElementSrc(track, currentIndex) {
    setTimeout(() => {
      if (currentIndex !== this.audioPlayer.stateManager.getCurrentTrackIndex()) return;
      
      try {
        if (window.jsmediatags && this.audioPlayer.audioElement.src) {
          window.jsmediatags.read(this.audioPlayer.audioElement.src, {
            onSuccess: (tag) => {
              const tags = tag.tags;
              const title = tags.title || '';
              const artist = tags.artist || '';
              const album = tags.album || '';
              
              if (this.audioPlayer.ui && this.audioPlayer.ui.trackNameDisplay) {
                let displayText = title;
                if (artist) {
                  displayText = `${artist} - ${displayText}`;
                }
                this.audioPlayer.ui.trackNameDisplay.textContent = displayText || track.name;
              }
              
              this.updateMediaSessionWithTags(title || track.name, artist, album);
            },
            onError: (error) => {
              if (error && error.type !== 'tagFormat') {
                console.warn('Error reading ID3 tags from src:', error);
              }
              this.fallbackToMediaSession(currentIndex);
            }
          });
        } else {
          this.fallbackToMediaSession(currentIndex);
        }
      } catch (error) {
        console.warn('Error reading metadata from audio element src:', error);
        this.fallbackToMediaSession(currentIndex);
      }
    }, 500);
  }
  
  /**
   * Update MediaSession API with metadata
   */
  updateMediaSessionWithTags(title, artist, album) {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: title || 'Unknown Title',
        artist: artist || 'Unknown Artist',
        album: album || 'Unknown Album'
      });
      
      const state = this.getCurrentState();
      navigator.mediaSession.playbackState = state?.isPlaying ? 'playing' : 'paused';
      this.setupMediaSessionHandlers();
    }
  }
  
  /**
   * Set up MediaSession API action handlers for media controls
   */
  setupMediaSessionHandlers() {
    if (!('mediaSession' in navigator)) return;
    
    navigator.mediaSession.setActionHandler('play', () => {
      this.play();
      navigator.mediaSession.playbackState = 'playing';
    });
    
    navigator.mediaSession.setActionHandler('pause', () => {
      this.pause();
      navigator.mediaSession.playbackState = 'paused';
    });
    
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      this.audioPlayer.playNext();
    });
    
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      this.audioPlayer.playPrevious();
    });
    
    navigator.mediaSession.setActionHandler('stop', () => {
      this.stop();
      navigator.mediaSession.playbackState = 'paused';
    });
    
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        this.seek(details.seekTime);
      }
    });
  }
  
  /**
   * Fallback to MediaSession API with basic track info
   */
  fallbackToMediaSession(currentIndex) {
    if (!this.audioPlayer.audioElement) return;
    
    if (currentIndex !== this.audioPlayer.stateManager.getCurrentTrackIndex()) return;
    
    if (this.audioPlayer.audioElement.duration > 0) {
      if (this.audioPlayer.audioElement.title) {
        if (this.audioPlayer.ui && this.audioPlayer.ui.trackNameDisplay) {
          this.audioPlayer.ui.trackNameDisplay.textContent = this.audioPlayer.audioElement.title;
        }
        return;
      }
    }
    
    const track = this.audioPlayer.playbackManager?.getTrack(currentIndex);
    if (track && track.name && this.audioPlayer.ui && this.audioPlayer.ui.trackNameDisplay) {
      this.audioPlayer.ui.trackNameDisplay.textContent = track.name;
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
      return;
    }
    
    if (state?.playbackMode === 'bufferSource') {
      await this.playBufferSource();
    } else {
      await this.playAudioElement();
    }
  }
  
  /**
   * Play using buffer source
   */
  async playBufferSource() {
    if (!this.currentBuffer) {
      return;
    }
    
    try {
      await this.stopCurrentPlayback();
      
      this.playbackInstanceId++;
      const instanceId = this.playbackInstanceId;
      
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
        bufferStartTime: currentTime - resumePosition,
        bufferDuration: this.currentBuffer.duration
      }, 'Buffer source playback started');
      
      this.setupBufferMonitoring();
      
    } catch (error) {
      console.error('[AudioContextManager] Buffer source playback failed:', error);
      this.updateState({
        isPlaying: false,
        isPaused: true,
        isStopped: false
      }, 'Buffer source playback failed');
    }
  }
  
  /**
   * Play using audio element
   */
  async playAudioElement() {
    if (!this.audioPlayer.audioElement) {
      return;
    }
    
    try {
      await this.audioPlayer.audioElement.play();
      
      this.updateState({
        isPlaying: true,
        isPaused: false,
        isStopped: false
      }, 'Audio element playback started');
      
    } catch (error) {
      console.error('[AudioContextManager] Audio element playback failed:', error);
      this.updateState({
        isPlaying: false,
        isPaused: true,
        isStopped: false
      }, 'Audio element playback failed');
    }
  }
  
  /**
   * Pause current track
   */
  async pause() {
    const state = this.getCurrentState();
    if (state?.isTransitioning) {
      return;
    }
    
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
    this.currentInstanceId++;
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
    
    this.currentInstanceId++;
    this.maintainSilentSource();
    
    this.updateState({
      isPlaying: false,
      isPaused: false,
      isStopped: true,
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
    
    try {
      await this.stopCurrentPlayback();
      
      this.playbackInstanceId++;
      const instanceId = this.playbackInstanceId;
      
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
      this.audioPlayer.audioElement.currentTime = clampedTime;
      
      this.updateState({
        currentTrackPosition: clampedTime
      }, 'Audio element seek completed');
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
        this.seamlessTransition(currentTrack).catch(error => {
          console.error('[AudioContextManager] Failed to restart track in repeat ONE mode:', error);
        });
      }
      return;
    }
    
    const isLastTrack = currentIndex >= playlist.length - 1;
    
    if (isLastTrack && repeatMode === 'ALL') {
      if (this.audioPlayer.playbackManager && this.audioPlayer.playbackManager.playlist.length > 0) {
        const firstTrack = this.audioPlayer.playbackManager.playlist[0];
        
        if (this.audioPlayer.stateManager) {
          this.audioPlayer.stateManager.updateState({
            currentTrackIndex: 0
          }, 'AudioContextManager handleTrackEnded repeat ALL');
        }
        
        this.transitionToNextTrack(firstTrack).catch(error => {
          console.error('[AudioContextManager] Failed to transition to first track in repeat ALL mode:', error);
          this.audioPlayer.playbackManager?.onTrackEnded();
        });
      } else {
        this.audioPlayer.playbackManager?.onTrackEnded();
      }
      return;
    } else if (isLastTrack && repeatMode === 'OFF') {
      this.stopCurrentPlayback();
      this.maintainSilentSource();
      
      if (this.audioPlayer.playbackManager && this.audioPlayer.playbackManager.playlist.length > 0) {
        const firstTrack = this.audioPlayer.playbackManager.playlist[0];
        
        this.updateState({
          currentTrack: firstTrack,
          currentTrackName: firstTrack.name,
          currentTrackPosition: 0,
          currentTrackDuration: 0,
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
        
        this.prepareTrackBuffer(firstTrack).then(buffer => {
          this.currentBuffer = buffer;
          
          this.updateState({
            currentBuffer: buffer,
            currentTrackDuration: buffer.duration
          }, 'First track buffer prepared for next playback');
          
          this.setupBufferMonitoring();
          this.prepareNextTrackBufferWithRepeatMode();
        }).catch(error => {
          console.error('[AudioContextManager] Failed to prepare first track buffer:', error);
        });
      } else {
        this.updateState({
          currentTrack: null,
          currentTrackIndex: -1,
          currentTrackName: '',
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
    
    this.currentInstanceId++;
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
  async loadTrack(track) {
    try {
      this.updateState({
        currentTrack: track,
        currentTrackName: track.name,
        isTransitioning: true,
        transitionType: 'loading'
      }, 'Track loading started');
      
      if (this.audioPlayer.stateManager) {
        const trackIndex = this.audioPlayer.playbackManager.playlist.findIndex(t => 
          (t.path === track.path && t.name === track.name) ||
          (t.file && track.file && t.file.name === track.file.name)
        );
        
        this.audioPlayer.stateManager.updateState({
          currentTrack: track,
          currentTrackIndex: trackIndex >= 0 ? trackIndex : 0
        }, 'AudioContextManager loadTrack');
      }
      
      const buffer = await this.prepareTrackBuffer(track);
      this.currentBuffer = buffer;
      
      this.updateState({
        currentTrackDuration: buffer.duration,
        playbackMode: 'bufferSource',
        isTransitioning: false,
        transitionType: null
      }, 'Track loaded and buffer prepared');
      
      this.loadMetadata(track);
      this.prepareNextTrackBufferWithRepeatMode();
      
    } catch (error) {
      console.error('[AudioContextManager] Track loading failed:', error);
      
      this.updateState({
        playbackMode: 'audioElement',
        isTransitioning: false,
        transitionType: null
      }, 'Falling back to audio element mode');
      
      this.setupAudioElement(track);
    }
  }
  
  /**
   * Prepare track buffer
   */
  async prepareTrackBuffer(track) {
    try {
      const arrayBuffer = await this.loadTrackData(track);
      const audioBuffer = await new Promise((resolve, reject) => {
        this.audioPlayer.audioContext.decodeAudioData(arrayBuffer, resolve, reject);
      });
      
      return audioBuffer;
    } catch (error) {
      console.error('[AudioContextManager] Buffer preparation failed for:', track?.name, error);
      throw error;
    }
  }
  
  /**
   * Load track data as ArrayBuffer
   */
  async loadTrackData(track) {
    try {
      if (track.file instanceof File) {
        return await track.file.arrayBuffer();
      } else if (track.path) {
        if (this.shouldUseElectronFileRead(track.path)) {
          return await this.loadElectronFileTrackData(track.path);
        }

        const response = await fetch(track.path);
        if (!response.ok) {
          throw new Error(`Failed to load track: ${response.statusText}`);
        }
        return await response.arrayBuffer();
      } else {
        throw new Error('Invalid track: no file or path provided');
      }
    } catch (error) {
      console.error('Error loading track data:', error);
      throw error;
    }
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
  async loadElectronFileTrackData(path) {
    const result = await window.electronAPI.readFile(path, true);
    if (!result?.success) {
      throw new Error(`Failed to load local track: ${result?.error || 'Unknown error'}`);
    }

    return this.base64ToArrayBuffer(result.content);
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
      await this.prepareNextTrackBufferForTrack(nextTrack);
    }
  }
  
  /**
   * Prepare buffer for a specific track
   */
  async prepareNextTrackBufferForTrack(track) {
    if (!track) return;
    
    try {
      const buffer = await this.prepareTrackBuffer(track);
      this.nextBuffer = buffer;
    } catch (error) {
      console.warn('[AudioContextManager] Next track buffer preparation failed:', error);
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
  async transitionToNextTrack(nextTrack) {
    this.updateState({
      isTransitioning: true,
      transitionType: 'seamless'
    }, 'Transition started');
    
    try {
      if (this.nextBuffer) {
        const nextTrackIndex = this.audioPlayer.playbackManager.playlist.findIndex(track => 
          (track.path === nextTrack.path && track.name === nextTrack.name) ||
          (track.file && nextTrack.file && track.file.name === nextTrack.file.name)
        );
        
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
        
        this.currentBuffer = this.nextBuffer;
        this.nextBuffer = null;
        
        this.updateState({
          currentTrack: nextTrack,
          currentTrackName: nextTrack.name,
          currentTrackDuration: this.currentBuffer.duration
        }, 'Switched to next track buffer');
        
        await this.createAndStartBufferSource();
        
        if (nextNextIndex >= 0 && this.audioPlayer.playbackManager) {
          const nextNextTrack = this.audioPlayer.playbackManager.getTrack(nextNextIndex);
          if (nextNextTrack) {
            this.prepareNextTrackBufferForTrack(nextNextTrack);
          }
        } else {
          this.prepareNextTrackBufferWithRepeatMode();
        }
        
      } else {
        await this.loadTrack(nextTrack);
        await this.play();
      }
      
      this.updateState({
        isTransitioning: false,
        transitionType: null,
        isPlaying: true,
        isPaused: false,
        isStopped: false
      }, 'Transition completed');
      
    } catch (error) {
      console.error('[AudioContextManager] Transition failed:', error);
      this.updateState({
        isTransitioning: false,
        transitionType: null
      }, 'Transition failed');
      throw error;
    }
  }
  
  /**
   * Create and start buffer source directly (for transitions)
   */
  async createAndStartBufferSource() {
    if (!this.currentBuffer) {
      throw new Error('No current buffer available for playback');
    }
    
    try {
      await this.stopCurrentPlayback();
      
      this.playbackInstanceId++;
      const instanceId = this.playbackInstanceId;
      
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
        bufferStartTime: currentTime,
        bufferDuration: this.currentBuffer.duration
      }, 'Buffer source playback started');
      
      this.setupBufferMonitoring();
      
    } catch (error) {
      console.error('[AudioContextManager] Buffer source creation failed:', error);
      throw error;
    }
  }
  
  /**
   * Seamless transition to a track (for previous/next track functionality)
   */
  async seamlessTransition(track) {
    this.updateState({
      isTransitioning: true,
      transitionType: 'seamless'
    }, 'Seamless transition started');
    
    try {
      await this.loadTrack(track);
      await this.play();
      
      this.updateState({
        isTransitioning: false,
        transitionType: null
      }, 'Seamless transition completed');
      
    } catch (error) {
      console.error('[AudioContextManager] Seamless transition failed:', error);
      this.updateState({
        isTransitioning: false,
        transitionType: null
      }, 'Seamless transition failed');
      throw error;
    }
  }
  
  // ===== CLEANUP =====
  
  /**
   * Disconnect and clean up audio connections
   */
  disconnect() {
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('stop', null);
        navigator.mediaSession.setActionHandler('seekto', null);
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
      this.nextBuffer = null;
      this.clearBufferMonitoring();
      
      this.updateState({
        currentTrack: null,
        currentTrackIndex: -1,
        currentTrackName: '',
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
      
      const useInputWithPlayer = window.electronIntegration?.audioPreferences?.useInputWithPlayer || false;
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
    this.nextBuffer = null;
  }
}
