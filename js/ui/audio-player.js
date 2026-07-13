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
      documentRef: windowRef?.document,
      powerStateProvider: audioManager?.powerPolicyController || null
    });
    
    // Initialize sub-modules with state manager reference
    this.playbackManager = new PlaybackManager(this);
    this.ui = new AudioPlayerUI(this);
    this.contextManager = new AudioContextManager(this, audioManager);
    this.mediaSessionManager = new MediaSessionManager(this);
    
    // Set up state manager listeners
    this.setupStateManagerListeners();
    this.audioManager?.powerPolicyController?.attachPlayer?.(this);
    
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
    // Start the resume while transient user activation is still available.
    // File loading and decoding below can outlive WebKit's activation window.
    const gestureResume = this.resumeAudioContextInGesture();
    // Stop the old source before publishing the replacement queue. The stop,
    // decode, and gesture resume then settle in parallel, so pending activation
    // can never leave old audio playing behind the new track UI.
    const stopOldPlayback = this.stop();
    const stopTokenBefore = this.contextManager?.stopRequestToken;
    this.playbackManager.loadFiles(files, append, insertAt);
    if (!this.ui.container) {
      this.ui.createPlayerUI();
    }
    // Capture the stop/pause token before loading so we can distinguish a
    // pause/stop requested DURING this load (must not auto-start) from a player
    // that was merely already paused when reused to open new files (must start
    // playback for the freshly-opened files).
    const loadTrack = this.loadTrack(this.stateManager.getCurrentTrackIndex());
    const [resumeReady, loaded] = await Promise.all([
      gestureResume,
      loadTrack,
      stopOldPlayback.then(() => true)
    ]);
    const pausedDuringLoad = typeof stopTokenBefore === 'number' &&
      this.contextManager?.stopRequestToken !== stopTokenBefore;
    if (loaded === false || pausedDuringLoad || !resumeReady) return false;
    return await this.play(false) !== false;
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
    // UNIFIED STATE: Use context manager's loadTrack method.
    // Propagate the load result so callers can skip the follow-up play()
    // when the load was aborted by a user pause/stop.
    return await this.contextManager.loadTrack(track) !== false;
  }
  
  /**
   * Kick a suspended AudioContext resume synchronously within the caller's
   * user-gesture call stack. WebKit only honors resume() while the gesture's
   * transient activation is alive, so this must run before any awaits.
   */
  resumeAudioContextInGesture() {
    try {
      const controller = this.audioManager?.powerPolicyController;
      const result = controller?.enabled
        ? controller.beginUserGestureResume?.(
            this.contextManager?.getPlaybackResumeKind?.() || 'player-only-play'
          )
        : this.audioManager?.contextManager?.resumeAudioContext?.();
      return Promise.resolve(result ?? true).then(value => value !== false, () => false);
    } catch (_) {
      return Promise.resolve(false);
    }
  }

  /**
   * Play the current track
   * @param {boolean} userInitiated - Whether this command is running in a user gesture
   */
  async play(userInitiated = true) {
    if (userInitiated) this.resumeAudioContextInGesture();
    return await this.playbackManager.play(userInitiated);
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
    await this.playbackManager.togglePlayPause(() => this.resumeAudioContextInGesture());
  }
  
  /**
   * Stop playback and reset position
   * @param {Object} options - Stop behavior options
   * @param {boolean} options.preservePlaylistSelectionIntent - Keep an in-flight selection's play intent
   */
  async stop({ preservePlaylistSelectionIntent = false } = {}) {
    if (!preservePlaylistSelectionIntent) {
      this.ui?.cancelPlaylistSelectionIntent?.();
    }
    await this.playbackManager.stop();
  }
  
  /**
   * Play the previous track
   * @param {boolean} userInitiated - Whether this command is running in a user gesture
   */
  async playPrevious(userInitiated = true) {
    return this.playbackManager.playPrevious(userInitiated);
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
    this.playbackManager.fastForward(true);
  }
  
  /**
   * Rewind the current track by 10 seconds
   */
  rewind() {
    this.playbackManager.rewind(true);
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
    this.audioManager?.powerPolicyController?.detachPlayer?.(this);
    
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
