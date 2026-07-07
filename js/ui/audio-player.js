/**
 * Audio Player class for music file playback
 * Handles playback of audio files and integration with the effect pipeline
 * This is the main entry point that coordinates between specialized modules
 */
import { PlaybackManager } from './audio-player/playback-manager.js';
import { AudioPlayerUI } from './audio-player/audio-player-ui.js';
import { AudioContextManager } from './audio-player/audio-context-manager.js';
import { StateManager } from './audio-player/state-manager.js';
import { MediaSessionManager } from './audio-player/media-session-manager.js';
import { WakeLockManager } from '../utils/wake-lock-manager.js';

export class AudioPlayer {
  constructor(audioManager) {
    this.audioManager = audioManager;
    this.audioContext = audioManager.audioContext;
    this.audioElement = null;
    
    // Initialize centralized state manager first
    this.stateManager = new StateManager(this);
    const windowRef = typeof window !== 'undefined' ? window : null;
    this.wakeLockManager = new WakeLockManager({
      layoutMode: windowRef?.uiManager?.layoutMode,
      stateManager: this.stateManager,
      navigatorRef: windowRef?.navigator,
      documentRef: windowRef?.document
    });
    
    // Initialize sub-modules with state manager reference
    this.playbackManager = new PlaybackManager(this);
    this.ui = new AudioPlayerUI(this);
    this.contextManager = new AudioContextManager(this, audioManager);
    this.mediaSessionManager = new MediaSessionManager(this);
    
    // Set up state manager listeners
    this.setupStateManagerListeners();
    
    // Load saved player state
    this.stateRestored = this.playbackManager.loadPlayerState().then(() => {
      if (this.ui.container) {
        this.ui.updatePlayerUIState();
      }
    }).catch(() => {});
  }
  
  /**
   * Enhanced loadFiles with seamless playback support
   * @param {(string[]|File[])} files - Array of file paths or File objects to load
   * @param {boolean} append - Whether to append to existing playlist or replace it
   * @param {number|null} insertAt - Optional insertion index for append operations
   */
  async loadFiles(files, append = false, insertAt = null) {
    this.playbackManager.loadFiles(files, append, insertAt);
    if (!this.ui.container) {
      this.ui.createPlayerUI();
    }
    const loaded = await this.loadTrack(this.stateManager.getCurrentTrackIndex());
    const state = this.stateManager.getStateSnapshot?.() || {};
    if (loaded !== false && !state.isPaused) {
      await this.play();
    }
  }
  
  /**
   * Enhanced loadTrack with unified state management
   * @param {number} index - Index of the track to load
   */
  async loadTrack(index) {
    const track = this.playbackManager.getTrack(index);
    if (!track) {
      return false;
    }
    return await this.contextManager.loadTrack(track) !== false;
  }
  
  /**
   * Kick a suspended AudioContext resume synchronously within the caller's
   * user-gesture call stack. WebKit only honors resume() while the gesture's
   * transient activation is alive, so this must run before any awaits.
   */
  resumeAudioContextInGesture() {
    try {
      const result = this.audioManager?.contextManager?.resumeAudioContext?.();
      if (result && typeof result.catch === 'function') {
        result.catch(() => {});
      }
    } catch (_) { /* never block playback on resume failures */ }
  }

  /**
   * Play the current track
   */
  async play() {
    this.resumeAudioContextInGesture();
    await this.playbackManager.play();
  }
  
  /**
   * Pause the current track
   */
  async pause() {
    await this.playbackManager.pause();
  }
  
  /**
   * Toggle between play and pause
   */
  async togglePlayPause() {
    this.resumeAudioContextInGesture();
    await this.playbackManager.togglePlayPause();
  }
  
  /**
   * Stop playback and reset position
   */
  async stop() {
    await this.playbackManager.stop();
  }
  
  /**
   * Play the previous track
   */
  async playPrevious() {
    return this.playbackManager.playPrevious();
  }
  
  /**
   * Play the next track
   * @param {boolean} userInitiated - Whether this was initiated by user action (default: true)
   */
  async playNext(userInitiated = true) {
    return this.playbackManager.playNext(userInitiated);
  }
  
  /**
   * Fast forward the current track by 10 seconds
   */
  fastForward() {
    this.playbackManager.fastForward();
  }
  
  /**
   * Rewind the current track by 10 seconds
   */
  rewind() {
    this.playbackManager.rewind();
  }
  
  /**
   * Set up state manager listeners for UI updates
   * Note: Most UI updates are now handled automatically by AudioPlayerUI's state monitoring
   */
  setupStateManagerListeners() {
    // Listen for UI state changes that require special handling
    this.stateManager.addListener('seekBarEnabled', (enabled) => {
      if (this.ui && this.ui.seekBar) {
        this.ui.seekBar.disabled = !enabled;
      }
    });
    
    this.stateManager.addListener('controlsEnabled', (enabled) => {
      if (this.ui) {
        const controls = [
          this.ui.playPauseButton,
          this.ui.stopButton,
          this.ui.prevButton,
          this.ui.nextButton,
          this.ui.repeatButton,
          this.ui.shuffleButton
        ];
        
        controls.forEach(control => {
          if (control) {
            control.disabled = !enabled;
          }
        });
      }
    });
  }
  
  /**
   * NEW: Enhanced close method with proper cleanup
   */
  close() {
    console.log('[AudioPlayer] Closing audio player');
    
    // Save player state
    this.playbackManager.savePlayerState();
    
    // Disconnect audio context
    this.contextManager.disconnect();
    this.contextManager.clearNextTrackBuffer();
    
    // Remove UI
    this.ui.removeUI();
    
    // Dispose playback manager
    this.playbackManager.dispose();

    // Clear OS-level media controls and metadata
    this.mediaSessionManager?.dispose();

    // Release screen wake lock, if held
    this.wakeLockManager?.dispose();
    
    // Clear state manager
    this.stateManager.clearStateHistory();
    
    // Clean up references
    this.audioElement = null;
    if (window.uiManager) {
      window.uiManager.audioPlayer = null;
    }
    
    console.log('[AudioPlayer] Audio player closed');
  }
  
  /**
   * Get debug information
   * @returns {Object} Debug info
   */
  getDebugInfo() {
    return {
      stateManager: this.stateManager.getDebugInfo(),
      playbackManager: {
        currentTrackIndex: this.stateManager.getCurrentTrackIndex(),
        playlistLength: this.playbackManager.playlist.length,
        state: this.stateManager.getStateSnapshot()
      },
      contextManager: {
        currentPlaybackMode: this.contextManager.currentPlaybackMode,
        isUsingBufferPlayback: this.contextManager.isUsingBufferPlayback(),
        hasNextTrackBuffer: !!this.contextManager.nextTrackBuffer,
        isTransitioning: this.contextManager.isTransitioning
      }
    };
  }
}
