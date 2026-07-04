/**
 * PlaybackManager - Handles playlist management and playback control
 * Includes functionality for playback modes, state management, and keyboard shortcuts
 */
export class PlaybackManager {
  constructor(audioPlayer) {
    this.audioPlayer = audioPlayer;
    this.playlist = [];
    this.originalPlaylist = []; // For shuffle mode
    
    // Additional properties for seamless playback
    this.transitionInProgress = false;
    this.seamlessMode = true; // Enable seamless mode by default
    this.keydownHandler = null;
    
    // Initialize keyboard shortcuts
    this.initKeyboardShortcuts();
  }
  
  /**
   * Load files into the playlist
   */
  loadFiles(files, append = false) {
    if (!files || files.length === 0) {
      return;
    }
    
    if (!append) {
      this.playlist = [];
      this.originalPlaylist = [];
    }
    
    files.forEach(file => {
      if (typeof file === 'string') {
        const fileName = file.split(/[\\/]/).pop();
        const trackEntry = {
          path: file,
          name: fileName,
          file: null
        };
        this.playlist.push(trackEntry);
        this.originalPlaylist.push({...trackEntry});
      } else if (file instanceof File) {
        const trackEntry = {
          path: null,
          name: file.name,
          file: file
        };
        this.playlist.push(trackEntry);
        this.originalPlaylist.push({...trackEntry});
      }
    });
    
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const shuffleMode = state?.shuffleMode || false;
    
    if (shuffleMode && !append) {
      const isCurrentlyPlaying = state?.isPlaying || false;
      this.shufflePlaylistFromBeginning(isCurrentlyPlaying);
    } else if (shuffleMode && append) {
      const isCurrentlyPlaying = state?.isPlaying || false;
      this.shufflePlaylistFromBeginning(isCurrentlyPlaying);
    }
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updatePlaylist(this.playlist, 0);
    }
  }

  syncPlaylistState(currentIndex = 0) {
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updatePlaylist(this.playlist, currentIndex);
    }
  }
  
  /**
   * Get track at specified index
   */
  getTrack(index) {
    if (index >= 0 && index < this.playlist.length) {
      return this.playlist[index];
    }
    return null;
  }
  
  /**
   * Play the current track
   */
  async play() {
    if (this.audioPlayer.contextManager) {
      const currentTrack = this.getTrack(this.audioPlayer.stateManager.getCurrentTrackIndex());
      if (currentTrack && !this.audioPlayer.contextManager.hasCurrentBuffer()) {
        await this.audioPlayer.contextManager.seamlessTransition(currentTrack);
      }
      
      await this.audioPlayer.contextManager.play();
    } else {
      console.warn('[PlaybackManager] ContextManager not available for play');
    }
  }
  
  /**
   * Pause the current track
   */
  async pause() {
    if (this.audioPlayer.contextManager) {
      await this.audioPlayer.contextManager.pause();
    } else {
      console.warn('[PlaybackManager] ContextManager not available for pause');
    }
  }
  
  /**
   * Toggle between play and pause
   */
  async togglePlayPause() {
    if (!this.audioPlayer.stateManager) {
      console.warn('[PlaybackManager] StateManager not available for togglePlayPause');
      return;
    }
    
    const state = this.audioPlayer.stateManager.getStateSnapshot();
    
    if (state.isPlaying) {
      await this.pause();
    } else {
      await this.play();
    }
  }
  
  /**
   * Stop playback and reset position
   */
  async stop() {
    if (this.audioPlayer.contextManager) {
      await this.audioPlayer.contextManager.stop();
    } else {
      console.warn('[PlaybackManager] ContextManager not available for stop');
    }
  }
  
  /**
   * Enhanced playPrevious with seamless transition
   */
  async playPrevious() {
    if (this.playlist.length === 0 || this.transitionInProgress) return;
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const shuffleMode = state?.shuffleMode || false;
    const repeatMode = state?.repeatMode || 'OFF';
    
    if (this.audioPlayer.contextManager && this.audioPlayer.contextManager.isUsingBufferPlayback()) {
      const currentTime = this.audioPlayer.contextManager.getCurrentBufferTime();
      if (currentTime > 3) {
        const currentTrack = this.getTrack(currentIndex);
        if (currentTrack) {
          await this.audioPlayer.contextManager.seamlessTransition(currentTrack);
        }
        return;
      }
    } else if (this.audioPlayer.audioElement && this.audioPlayer.audioElement.currentTime > 3) {
      this.audioPlayer.audioElement.currentTime = 0;
      this.play();
      return;
    }
    
    let newIndex;
    
    if (shuffleMode) {
      newIndex = currentIndex - 1;
      
      if (newIndex < 0) {
        if (repeatMode === 'ALL') {
          this.reshufflePlaylist();
          newIndex = this.playlist.length - 1;
        } else {
          if (this.audioPlayer.contextManager && this.audioPlayer.contextManager.isUsingBufferPlayback()) {
            const currentTrack = this.getTrack(currentIndex);
            if (currentTrack) {
              await this.audioPlayer.contextManager.seamlessTransition(currentTrack);
            }
          } else {
            this.audioPlayer.audioElement.currentTime = 0;
            this.play();
          }
          return;
        }
      }
    } else {
      newIndex = currentIndex - 1;
      
      if (newIndex < 0) {
        if (repeatMode === 'ALL') {
          newIndex = this.playlist.length - 1;
        } else {
          if (this.audioPlayer.contextManager && this.audioPlayer.contextManager.isUsingBufferPlayback()) {
            const currentTrack = this.getTrack(currentIndex);
            if (currentTrack) {
              await this.audioPlayer.contextManager.seamlessTransition(currentTrack);
            }
          } else {
            this.audioPlayer.audioElement.currentTime = 0;
            this.play();
          }
          return;
        }
      }
    }
    
    const prevTrack = this.getTrack(newIndex);
    if (!prevTrack) return;
    
    if (this.seamlessMode && state?.isPlaying && !state?.isPaused) {
      this.transitionInProgress = true;
      
      try {
        await this.audioPlayer.contextManager.loadTrack(prevTrack);
        await this.audioPlayer.contextManager.play();
        
        if (this.audioPlayer.stateManager) {
          this.audioPlayer.stateManager.updateState({
            currentTrackIndex: newIndex
          }, 'PlaybackManager playPrevious seamless');
        }
        
      } catch (error) {
        console.warn('Seamless transition failed, using fallback:', error);
        if (this.audioPlayer.stateManager) {
          this.audioPlayer.stateManager.updateState({
            currentTrackIndex: newIndex
          }, 'PlaybackManager playPrevious fallback');
        }
        this.audioPlayer.loadTrack(newIndex);
        this.play();
      } finally {
        this.transitionInProgress = false;
      }
    } else {
      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          currentTrackIndex: newIndex
        }, 'PlaybackManager playPrevious');
      }
      this.audioPlayer.loadTrack(newIndex);
      this.play();
    }
    
    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayPauseButton();
    }
  }
  
  /**
   * Enhanced playNext with seamless transition and proper error handling
   */
  async playNext(userInitiated = true) {
    if (this.playlist.length === 0) {
      return;
    }
    
    if (this.transitionInProgress) {
      return;
    }
    
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const repeatMode = state?.repeatMode || 'OFF';
    const shuffleMode = state?.shuffleMode || false;
    
    if (repeatMode === 'ONE' && !userInitiated) {
      if (this.audioPlayer.contextManager && this.audioPlayer.contextManager.isUsingBufferPlayback()) {
        const currentTrack = this.getTrack(this.audioPlayer.stateManager.getCurrentTrackIndex());
        if (currentTrack) {
          await this.audioPlayer.contextManager.seamlessTransition(currentTrack);
        }
      } else {
        this.audioPlayer.audioElement.currentTime = 0;
        this.play();
      }
      return;
    }
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    let newIndex;
    
    if (shuffleMode) {
      newIndex = currentIndex + 1;
      
      if (newIndex >= this.playlist.length) {
        if (repeatMode === 'ALL') {
          this.reshufflePlaylist();
          newIndex = 0;
        } else {
          return;
        }
      }
    } else {
      newIndex = currentIndex + 1;
      
      if (newIndex >= this.playlist.length) {
        if (repeatMode === 'ALL') {
          newIndex = 0;
        } else {
          return;
        }
      }
    }
    
    const nextTrack = this.getTrack(newIndex);
    if (!nextTrack) {
      console.warn('[PlaybackManager] No next track available');
      return;
    }
    
    this.transitionInProgress = true;
    
    try {
      if (this.audioPlayer.contextManager) {
        await this.audioPlayer.contextManager.transitionToNextTrack(nextTrack);
      } else {
        console.warn('[PlaybackManager] ContextManager not available for transition');
      }
      
      if (this.audioPlayer.ui) {
        this.audioPlayer.ui.updatePlayPauseButton();
      }
      
    } catch (error) {
      console.error('[PlaybackManager] Transition failed:', error);
      
      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          isTransitioning: false,
          transitionType: null
        }, 'PlaybackManager playNext error');
      }
    } finally {
      this.transitionInProgress = false;
    }
  }
  
  /**
   * Handle track ended event
   */
  onTrackEnded() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    if (state?.isStopped) {
      return;
    }
    
    if (this.transitionInProgress) {
      return;
    }
    
    const repeatMode = state?.repeatMode || 'OFF';
    const shuffleMode = state?.shuffleMode || false;
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const isLastTrack = currentIndex >= this.playlist.length - 1;
    
    if (repeatMode === 'ONE') {
      const currentTrack = this.getTrack(currentIndex);
      if (currentTrack && this.audioPlayer.contextManager) {
        this.audioPlayer.contextManager.seamlessTransition(currentTrack).catch(error => {
          console.error('[PlaybackManager] Failed to restart track in repeat ONE mode:', error);
        });
      }
      return;
    }
    
    if (isLastTrack && repeatMode === 'ALL') {
      if (shuffleMode) {
        this.reshufflePlaylist();
        const firstTrack = this.getTrack(0);
        if (firstTrack && this.audioPlayer.contextManager) {
          this.audioPlayer.contextManager.transitionToNextTrack(firstTrack).catch(error => {
            console.error('[PlaybackManager] Failed to transition to first track after reshuffle:', error);
          });
        }
      } else {
        if (this.audioPlayer.stateManager) {
          this.audioPlayer.stateManager.updateState({
            currentTrackIndex: 0
          }, 'PlaybackManager onTrackEnded repeat ALL');
        }
        
        const firstTrack = this.getTrack(0);
        if (firstTrack && this.audioPlayer.contextManager) {
          this.audioPlayer.contextManager.transitionToNextTrack(firstTrack).catch(error => {
            console.error('[PlaybackManager] Failed to transition to first track:', error);
          });
        }
      }
      return;
    }
    
    if (isLastTrack && repeatMode === 'OFF') {
      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          currentTrackIndex: 0
        }, 'PlaybackManager onTrackEnded repeat OFF');
      }
      
      if (this.audioPlayer.contextManager) {
        this.audioPlayer.contextManager.stop();
      }
      return;
    }
    
    this.playNext(false);
  }
  
  /**
   * Reset to first track and prepare buffer
   */
  resetToFirstTrack(autoPlay = true) {
    if (this.playlist.length === 0) {
      console.warn('[PlaybackManager] No playlist to reset');
      return;
    }
    
    const finalIndex = 0;
    this.syncPlaylistState(finalIndex);
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        currentTrackIndex: finalIndex,
        currentTrackPosition: 0,
        isPlaying: false,
        isPaused: false,
        isStopped: true
      }, 'PlaybackManager resetToFirstTrack');
    }
    
    if (this.audioPlayer.contextManager) {
      const track = this.getTrack(finalIndex);
      if (track) {
        this.audioPlayer.contextManager.seamlessTransition(track).catch(error => {
          console.error('[PlaybackManager] Failed to load first track:', error);
        });
      }
    }
  }
  
  /**
   * Shuffle the playlist from the beginning
   */
  shufflePlaylistFromBeginning(autoPlay = true) {
    if (this.originalPlaylist.length === 0) {
      console.warn('[PlaybackManager] No original playlist to shuffle');
      return;
    }
    
    const playlistCopy = [...this.originalPlaylist];
    
    for (let i = playlistCopy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playlistCopy[i], playlistCopy[j]] = [playlistCopy[j], playlistCopy[i]];
    }
    
    this.playlist = playlistCopy;
    this.resetToFirstTrack(autoPlay);
  }
  
  /**
   * Reshuffle the playlist while maintaining the current track position
   */
  reshufflePlaylist() {
    if (this.originalPlaylist.length === 0) {
      console.warn('[PlaybackManager] No original playlist to reshuffle');
      return;
    }
    
    const currentTrack = this.playlist[this.audioPlayer.stateManager.getCurrentTrackIndex()];
    
    const playlistCopy = [...this.originalPlaylist];
    
    for (let i = playlistCopy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [playlistCopy[i], playlistCopy[j]] = [playlistCopy[j], playlistCopy[i]];
    }
    
    this.playlist = playlistCopy;
    
    const newIndex = this.playlist.findIndex(track =>
      (track.path === currentTrack.path && track.name === currentTrack.name) ||
      (track.file && currentTrack.file && track.file.name === currentTrack.file.name)
    );
    
    const finalIndex = newIndex === -1 ? 0 : newIndex;
    this.syncPlaylistState(finalIndex);
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        currentTrackIndex: finalIndex,
        currentTrackPosition: 0
      }, 'PlaybackManager reshufflePlaylist');
    }
  }
  
  /**
   * Toggle shuffle mode
   */
  toggleShuffleMode() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    if (state?.repeatMode === 'ONE') return;
    
    const newShuffleMode = !(state?.shuffleMode || false);
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        shuffleMode: newShuffleMode
      }, 'PlaybackManager toggleShuffleMode');
    }
    
    if (newShuffleMode) {
      const isCurrentlyPlaying = state?.isPlaying || false;
      
      if (this.audioPlayer.contextManager) {
        this.audioPlayer.contextManager.stop();
      }
      
      this.shufflePlaylistFromBeginning(isCurrentlyPlaying);
      
    } else {
      if (this.audioPlayer.contextManager) {
        this.audioPlayer.contextManager.stop();
      }
      
      this.playlist = [...this.originalPlaylist];
      this.resetToFirstTrack(false);
    }
    
    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayerUIState();
    }
    
    this.savePlayerState();
  }
  
  /**
   * Toggle repeat mode (OFF -> ALL -> ONE -> OFF)
   */
  toggleRepeatMode() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const currentRepeatMode = state?.repeatMode || 'OFF';
    let newRepeatMode;
    
    switch (currentRepeatMode) {
      case 'OFF':
        newRepeatMode = 'ALL';
        break;
      case 'ALL':
        newRepeatMode = 'ONE';
        
        if (state?.shuffleMode) {
          this.toggleShuffleMode();
        }
        break;
      case 'ONE':
        newRepeatMode = 'OFF';
        break;
      default:
        newRepeatMode = 'OFF';
    }
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        repeatMode: newRepeatMode
      }, 'PlaybackManager toggleRepeatMode');
    }
    
    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayerUIState();
    }
    
    this.savePlayerState();
  }
  
  /**
   * Initialize keyboard shortcuts
   */
  initKeyboardShortcuts() {
    if (this.keydownHandler) return;

    this.keydownHandler = (e) => {
      // Check if audio player is initialized
      if (!this.audioPlayer) return;
      
      if (e.target.matches('input:not([type="range"]), textarea, select')) {
        return;
      }
      
      switch (e.key) {
        case ' ':
          if (!e.target.matches('button, [role="button"], a, .interactive')) {
            e.preventDefault();
            this.togglePlayPause();
          }
          break;
          
        case 'n':
        case 'N':
          if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              this.playNext();
            }
          }
          break;
          
        case 'p':
        case 'P':
          if (!e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              this.playPrevious();
            }
          }
          break;
          
        case 'ArrowRight':
          if (e.ctrlKey) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              this.playNext();
            }
          } else if (e.shiftKey) {
            e.preventDefault();
            this.fastForward();
          }
          break;
          
        case 'ArrowLeft':
          if (e.ctrlKey) {
            e.preventDefault();
            if (this.audioPlayer.contextManager) {
              this.playPrevious();
            }
          } else if (e.shiftKey) {
            e.preventDefault();
            this.rewind();
          }
          break;
          
        case 'f':
        case 'F':
        case '.':
          if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.fastForward();
          }
          break;
          
        case 'r':
        case 'R':
          if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.rewind();
          }
          break;
          
        case ',':
          if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.rewind();
          }
          break;
          

          
        case 'h':
        case 'H':
          if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.toggleShuffleMode();
          }
          break;
          
        case 'm':
        case 'M':
          if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && !e.target.matches('input, textarea')) {
            e.preventDefault();
            this.toggleRepeatMode();
          }
          break;
          

          

          

          
        default:
          break;
      }
    };

    document.addEventListener('keydown', this.keydownHandler);
  }
  
  /**
   * Fast forward the current track by 10 seconds
   */
  fastForward() {
    if (this.audioPlayer.contextManager) {
      const state = this.audioPlayer.contextManager.getCurrentState();
      const currentTime = state?.currentTrackPosition || 0;
      const duration = state?.currentTrackDuration || 0;
      const newTime = Math.min(currentTime + 10, duration);
      this.audioPlayer.contextManager.seek(newTime);
    } else {
      console.warn('[PlaybackManager] ContextManager not available for fastForward');
    }
  }
  
  /**
   * Rewind the current track by 10 seconds
   */
  rewind() {
    if (this.audioPlayer.contextManager) {
      const state = this.audioPlayer.contextManager.getCurrentState();
      const currentTime = state?.currentTrackPosition || 0;
      const newTime = Math.max(currentTime - 10, 0);
      this.audioPlayer.contextManager.seek(newTime);
    } else {
      console.warn('[PlaybackManager] ContextManager not available for rewind');
    }
  }
  
  /**
   * Load player state from storage
   */
  async loadPlayerState() {
    const windowRef = typeof window !== 'undefined' ? window : {};
    if (!windowRef.electronAPI || !windowRef.electronIntegration) {
      this.loadPlayerStateFromLocalStorage(windowRef);
      return Promise.resolve();
    }
    
    try {
      const userDataPath = await windowRef.electronAPI.getPath('userData');
      const stateFilePath = await windowRef.electronAPI.joinPaths(userDataPath, 'player-state.json');
      const fileExists = await windowRef.electronAPI.fileExists(stateFilePath);
      
      if (fileExists) {
        const result = await windowRef.electronAPI.readFile(stateFilePath);
        
        if (result.success) {
          const playerState = JSON.parse(result.content);
          this.applyPlayerState(playerState, 'PlaybackManager loadPlayerState');
        }
      }
      return Promise.resolve();
    } catch (error) {
      console.error('Failed to load player state:', error);
      return Promise.resolve();
    }
  }

  loadPlayerStateFromLocalStorage(windowRef = typeof window !== 'undefined' ? window : {}) {
    try {
      const rawState = windowRef.localStorage?.getItem('effetune_player_state');
      if (!rawState) return;
      this.applyPlayerState(JSON.parse(rawState), 'PlaybackManager loadPlayerState localStorage');
    } catch (error) {
      console.warn('Failed to load web player state:', error);
    }
  }

  applyPlayerState(playerState, source) {
    if (!this.audioPlayer.stateManager || !playerState || typeof playerState !== 'object') return;

    const updates = {};
    if (playerState.repeatMode) {
      updates.repeatMode = playerState.repeatMode;
    }
    if (playerState.shuffleMode !== undefined) {
      updates.shuffleMode = !!playerState.shuffleMode;
    }
    if (Object.keys(updates).length > 0) {
      this.audioPlayer.stateManager.updateState(updates, source);
    }
  }

  getPersistentPlayerState() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    return {
      repeatMode: state?.repeatMode || 'OFF',
      shuffleMode: state?.shuffleMode || false
    };
  }
  
  /**
   * Save player state to storage
   */
  async savePlayerState() {
    const windowRef = typeof window !== 'undefined' ? window : {};
    const playerState = this.getPersistentPlayerState();
    if (!windowRef.electronAPI || !windowRef.electronIntegration) {
      try {
        windowRef.localStorage?.setItem('effetune_player_state', JSON.stringify(playerState));
      } catch (error) {
        console.warn('Failed to save web player state:', error);
      }
      return;
    }
    
    try {
      const userDataPath = await windowRef.electronAPI.getPath('userData');
      const stateFilePath = await windowRef.electronAPI.joinPaths(userDataPath, 'player-state.json');
      
      await windowRef.electronAPI.saveFile(stateFilePath, JSON.stringify(playerState, null, 2));
    } catch (error) {
      console.error('Failed to save player state:', error);
    }
  }
  
  /**
   * Enhanced clear method with proper cleanup
   */
  clear() {
    this.playlist = [];
    this.originalPlaylist = [];
    this.transitionInProgress = false;

    if (!this.audioPlayer) return;
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        isPlaying: false,
        isPaused: false,
        isStopped: true,
        currentTrackPosition: 0
      }, 'PlaybackManager clear');
    }
    
    this.audioPlayer.contextManager.clearNextTrackBuffer();
    
    if (this.audioPlayer.audioElement) {
      this.audioPlayer.audioElement.pause();
      this.audioPlayer.audioElement.currentTime = 0;
    }
  }

  /**
   * Dispose resources owned by this playback manager
   */
  dispose() {
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }

    this.clear();
  }
}
