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
import { createRecentlyPlayedTracker } from '../library/playlists/recently-played-tracker.js';

export class AudioPlayer {
  constructor(audioManager) {
    this.audioManager = audioManager;
    this._audioContext = audioManager.audioContext ?? null;
    this.audioElement = null;
    
    // Initialize centralized state manager first
    this.stateManager = new StateManager(this);
    const windowRef = typeof window !== 'undefined' ? window : null;
    this.recentlyPlayedTracker = createRecentlyPlayedTracker({
      stateManager: this.stateManager,
      recordTrack: async trackUid => {
        const manager = windowRef?.uiManager?.ensureLibraryManager
          ? await windowRef.uiManager.ensureLibraryManager()
          : windowRef?.uiManager?.libraryManager;
        return manager?.playlists?.recordRecentlyPlayed?.(trackUid) ?? { kind: 'noop' };
      }
    });
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

  get audioContext() {
    if (!this._audioContext) {
      this._audioContext = this.audioManager?.contextManager?.audioContext ??
        this.audioManager?.audioContext ?? null;
    }
    return this._audioContext;
  }

  set audioContext(audioContext) {
    this._audioContext = audioContext ?? null;
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
    // Stop the old source before activating the replacement queue.
    const stopOldPlayback = this.stop();
    const stopTokenBefore = this.contextManager?.stopRequestToken;
    this.playbackManager.loadFiles(files, append, insertAt);
    if (!this.ui.container) {
      this.ui.createPlayerUI();
    }
    return this.playbackManager.runWithPlaybackPending(async () => {
      // Capture the token before waiting so a later Stop remains a hard barrier.
      const [resumeReady] = await Promise.all([
        gestureResume,
        stopOldPlayback.then(() => true)
      ]);
      const pausedDuringLoad = typeof stopTokenBefore === 'number' &&
        this.contextManager?.stopRequestToken !== stopTokenBefore;
      if (pausedDuringLoad || !resumeReady) return false;
      const result = await this.playbackManager.selectQueueOrdinal(
        this.stateManager.getCurrentTrackIndex(),
        {
          play: true,
          userInitiated: true,
          skipUnavailable: true,
          playbackReady: resumeReady
        }
      );
      const stoppedDuringSelection = typeof stopTokenBefore === 'number' &&
        this.contextManager?.stopRequestToken !== stopTokenBefore;
      return result?.accepted === true && !stoppedDuringSelection;
    }, 3);
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
    this.recentlyPlayedTracker?.destroy();
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
