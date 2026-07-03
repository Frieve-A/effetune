/**
 * StateManager - Centralized state management for audio player
 * Handles all state transitions and ensures consistency across components
 */
export class StateManager {
  constructor(audioPlayer) {
    this.audioPlayer = audioPlayer;
    
    // Core state
    this.state = {
      // Playlist state
      playlist: [],
      currentTrackIndex: 0,
      playlistLength: 0,
      
      // Playback state
      isPlaying: false,
      isPaused: false,
      isStopped: true,
      
      // Playback mode
      playbackMode: 'audioElement', // 'audioElement' or 'bufferSource'
      repeatMode: 'OFF', // 'OFF', 'ALL', 'ONE'
      shuffleMode: false,
      seamlessMode: true,
      
      // Transition state
      isTransitioning: false,
      transitionType: null, // 'seamless', 'fallback', 'manual'
      
      // Current track info
      currentTrack: null,
      currentTrackName: '',
      artworkUrl: '',
      currentTrackDuration: 0,
      currentTrackPosition: 0,
      
      // Buffer state
      hasNextTrackBuffer: false,
      bufferPreparationStatus: 'idle', // 'idle', 'preparing', 'ready', 'failed'
      
      // Instance tracking for cleanup
      currentInstanceId: 0,
      playbackInstanceId: 0,
      
      // UI state
      uiEnabled: true,
      seekBarEnabled: true,
      controlsEnabled: true
    };
    
    // State change listeners
    this.listeners = new Map();
    
    // State history for debugging
    this.stateHistory = [];
    this.maxHistorySize = 100;
  }
  
  /**
   * Get current state snapshot
   */
  getStateSnapshot() {
    return { ...this.state };
  }
  
  /**
   * Update state with validation
   */
  updateState(updates, source = 'unknown') {
    const oldState = this.getStateSnapshot();
    const timestamp = Date.now();
    
    // Apply updates
    Object.assign(this.state, updates);
    
    // Validate state consistency
    this.validateState();
    
    // Log state change
    this.logStateChange(oldState, this.getStateSnapshot(), source, timestamp);
    
    // Notify listeners
    this.notifyListeners(updates, source);
  }
  
  /**
   * Validate state consistency
   */
  validateState() {
    // Ensure only one playback state is true
    const playbackStates = [this.state.isPlaying, this.state.isPaused, this.state.isStopped];
    const trueCount = playbackStates.filter(Boolean).length;
    
    if (trueCount !== 1) {
      console.warn('[StateManager] Invalid playback state detected:', {
        isPlaying: this.state.isPlaying,
        isPaused: this.state.isPaused,
        isStopped: this.state.isStopped
      });
      
      // Fix invalid state
      if (this.state.isPlaying) {
        this.state.isPaused = false;
        this.state.isStopped = false;
      } else if (this.state.isPaused) {
        this.state.isPlaying = false;
        this.state.isStopped = false;
      } else {
        this.state.isPlaying = false;
        this.state.isPaused = false;
        this.state.isStopped = true;
      }
    }
    
    // Validate track index
    if (this.state.currentTrackIndex < 0 || this.state.currentTrackIndex >= this.state.playlistLength) {
      console.warn('[StateManager] Invalid track index:', this.state.currentTrackIndex, 'playlist length:', this.state.playlistLength);
      this.state.currentTrackIndex = Math.max(0, Math.min(this.state.currentTrackIndex, this.state.playlistLength - 1));
    }
    
    // Validate repeat mode
    if (!['OFF', 'ALL', 'ONE'].includes(this.state.repeatMode)) {
      console.warn('[StateManager] Invalid repeat mode:', this.state.repeatMode);
      this.state.repeatMode = 'OFF';
    }
    
    // Validate playback mode
    if (!['audioElement', 'bufferSource'].includes(this.state.playbackMode)) {
      console.warn('[StateManager] Invalid playback mode:', this.state.playbackMode);
      this.state.playbackMode = 'audioElement';
    }
  }
  
  /**
   * Log state change for debugging
   */
  logStateChange(oldState, newState, source, timestamp) {
    const change = {
      timestamp,
      source,
      changes: {}
    };
    
    // Find what changed
    for (const [key, newValue] of Object.entries(newState)) {
      if (oldState[key] !== newValue) {
        change.changes[key] = {
          from: oldState[key],
          to: newValue
        };
      }
    }
    
    // Only log if there are actual changes
    if (Object.keys(change.changes).length > 0) {
      this.stateHistory.push(change);
      
      // Keep history size manageable
      if (this.stateHistory.length > this.maxHistorySize) {
        this.stateHistory.shift();
      }
    }
  }
  
  /**
   * Add state change listener
   */
  addListener(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key).add(callback);
  }
  
  /**
   * Remove state change listener
   */
  removeListener(key, callback) {
    if (this.listeners.has(key)) {
      this.listeners.get(key).delete(callback);
    }
  }
  
  /**
   * Notify listeners of state changes
   */
  notifyListeners(changes, source) {
    for (const [key, newValue] of Object.entries(changes)) {
      // Notify specific key listeners
      if (this.listeners.has(key)) {
        const listeners = this.listeners.get(key);
        listeners.forEach(callback => {
          try {
            callback(newValue, key, source);
          } catch (error) {
            console.error('[StateManager] Listener error:', error);
          }
        });
      }
      
      // Notify wildcard listeners
      if (this.listeners.has('*')) {
        const wildcardListeners = this.listeners.get('*');
        wildcardListeners.forEach(callback => {
          try {
            callback(newValue, key, source);
          } catch (error) {
            console.error('[StateManager] Wildcard listener error:', error);
          }
        });
      }
    }
  }
  
  /**
   * Get current track index
   */
  getCurrentTrackIndex() {
    return this.state.currentTrackIndex;
  }
  
  /**
   * Get current track
   */
  getCurrentTrack() {
    if (this.state.currentTrackIndex >= 0 && this.state.currentTrackIndex < this.state.playlist.length) {
      return this.state.playlist[this.state.currentTrackIndex];
    }
    return null;
  }
  
  /**
   * Get next track
   */
  getNextTrack() {
    const nextIndex = this.getNextTrackIndex();
    if (nextIndex >= 0 && nextIndex < this.state.playlist.length) {
      return this.state.playlist[nextIndex];
    }
    return null;
  }
  
  /**
   * Get next track index
   */
  getNextTrackIndex() {
    if (this.state.playlistLength === 0) return -1;
    
    let nextIndex = this.state.currentTrackIndex + 1;
    
    if (nextIndex >= this.state.playlistLength) {
      if (this.state.repeatMode === 'ALL') {
        nextIndex = 0;
      } else {
        return -1; // No next track
      }
    }
    
    return nextIndex;
  }
  
  /**
   * Get previous track index
   */
  getPreviousTrackIndex() {
    if (this.state.playlistLength === 0) return -1;
    
    let prevIndex = this.state.currentTrackIndex - 1;
    
    if (prevIndex < 0) {
      if (this.state.repeatMode === 'ALL') {
        prevIndex = this.state.playlistLength - 1;
      } else {
        return -1; // No previous track
      }
    }
    
    return prevIndex;
  }
  
  /**
   * Update playlist
   */
  updatePlaylist(playlist, currentIndex = 0) {
    this.updateState({
      playlist: [...playlist],
      playlistLength: playlist.length,
      currentTrackIndex: Math.max(0, Math.min(currentIndex, playlist.length - 1)),
      currentTrack: playlist.length > 0 ? playlist[Math.max(0, Math.min(currentIndex, playlist.length - 1))] : null
    }, 'playlist_update');
  }
  
  /**
   * Set playback state
   */
  setPlaybackState(state) {
    const updates = {
      isPlaying: state === 'playing',
      isPaused: state === 'paused',
      isStopped: state === 'stopped'
    };
    
    this.updateState(updates, 'playback_state_change');
  }
  
  /**
   * Set playback mode
   */
  setPlaybackMode(mode) {
    this.updateState({ playbackMode: mode }, 'playback_mode_change');
  }
  
  /**
   * Set transition state
   */
  setTransitionState(isTransitioning, type = null) {
    this.updateState({
      isTransitioning,
      transitionType: type
    }, 'transition_state_change');
  }
  
  /**
   * Update track info
   */
  updateTrackInfo(track, duration = 0, position = 0) {
    this.updateState({
      currentTrack: track,
      currentTrackDuration: duration,
      currentTrackPosition: position
    }, 'track_info_update');
  }
  
  /**
   * Set buffer state
   */
  setBufferState(hasBuffer, status = 'idle') {
    this.updateState({
      hasNextTrackBuffer: hasBuffer,
      bufferPreparationStatus: status
    }, 'buffer_state_change');
  }
  
  /**
   * Set UI state
   */
  setUIState(enabled, options = {}) {
    this.updateState({
      uiEnabled: enabled,
      seekBarEnabled: options.seekBarEnabled !== undefined ? options.seekBarEnabled : enabled,
      controlsEnabled: options.controlsEnabled !== undefined ? options.controlsEnabled : enabled
    }, 'ui_state_change');
  }
  
  /**
   * Get state history for debugging
   */
  getStateHistory() {
    return [...this.stateHistory];
  }
  
  /**
   * Clear state history
   */
  clearStateHistory() {
    this.stateHistory = [];
  }
  
  /**
   * Get debug information
   */
  getDebugInfo() {
    return {
      currentState: this.getStateSnapshot(),
      stateHistory: this.stateHistory.slice(-10), // Last 10 changes
      listeners: Array.from(this.listeners.keys()),
      listenerCounts: Object.fromEntries(
        Array.from(this.listeners.entries()).map(([key, set]) => [key, set.size])
      )
    };
  }
}
