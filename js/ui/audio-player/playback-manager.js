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
    this.failedTrackSkipState = null;
    
    // Initialize keyboard shortcuts
    this.initKeyboardShortcuts();
  }
  
  /**
   * Load files into the playlist
   */
  loadFiles(files, append = false, insertAt = null) {
    if (!files || files.length === 0) {
      return;
    }
    
    if (!append) {
      this.playlist = [];
      this.originalPlaylist = [];
    }

    const newEntries = files
      .map(file => this.createTrackEntry(file))
      .filter(Boolean);

    if (newEntries.length === 0) {
      return;
    }

    this.clearFailedTrackSkipState();

    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const shuffleMode = state?.shuffleMode || false;
    const shouldInsert = append && Number.isInteger(insertAt);
    const currentIndex = Number.isInteger(state?.currentTrackIndex)
      ? state.currentTrackIndex
      : (this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0);
    let nextIndex = append ? currentIndex : 0;

    if (shouldInsert) {
      const playlistIndex = Math.max(0, Math.min(insertAt, this.playlist.length));
      this.playlist.splice(playlistIndex, 0, ...newEntries);
      const originalIndex = Math.max(0, Math.min(insertAt, this.originalPlaylist.length));
      this.originalPlaylist.splice(originalIndex, 0, ...newEntries.map(track => ({ ...track })));
      if (playlistIndex <= currentIndex) {
        nextIndex = currentIndex + newEntries.length;
      }
    } else {
      this.playlist.push(...newEntries);
      this.originalPlaylist.push(...newEntries.map(track => ({ ...track })));
    }
    
    if (shuffleMode && !append) {
      const isCurrentlyPlaying = state?.isPlaying || false;
      this.shufflePlaylistFromBeginning(isCurrentlyPlaying);
    }
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updatePlaylist(this.playlist, nextIndex);
    }

    if (append && this.audioPlayer.contextManager?.nextBuffer) {
      // The pre-decoded next-track buffer may no longer match the track that
      // follows the current one (e.g. library 'Play Next' insert, or append
      // after the last track with repeat ALL). Drop it and re-prepare.
      this.audioPlayer.contextManager.clearNextTrackBuffer();
      this.audioPlayer.contextManager.prepareNextTrackBufferWithRepeatMode();
    }
  }

  createTrackEntry(input) {
    if (typeof input === 'string') {
      const fileName = input.split(/[\\/]/).pop();
      return {
        path: input,
        name: fileName,
        file: null
      };
    }

    if (input instanceof File) {
      return {
        path: null,
        name: input.name,
        file: input
      };
    }

    if (input && typeof input === 'object') {
      const hasLibraryFields = input.provider || input.meta || input.libraryTrackId || input.path || input.file || input.name;
      if (!hasLibraryFields) return null;
      const metaTitle = input.meta?.title;
      const metaArtist = input.meta?.artist;
      const fallbackName = input.path ? input.path.split(/[\\/]/).pop() : 'Track';
      return {
        path: input.path || null,
        name: input.name || (metaArtist && metaTitle ? `${metaArtist} - ${metaTitle}` : (metaTitle || fallbackName)),
        file: input.file || null,
        ...(input.meta && { meta: input.meta }),
        ...(input.libraryTrackId && { libraryTrackId: input.libraryTrackId }),
        ...(input.provider && { provider: input.provider })
      };
    }

    return null;
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
      const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
      const currentTrack = this.getTrack(currentIndex);
      if (currentTrack && !this.audioPlayer.contextManager.hasCurrentBuffer()) {
        await this.audioPlayer.contextManager.seamlessTransition(currentTrack, currentIndex);
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
      const wasTransitioning = this.transitionInProgress;
      await this.audioPlayer.contextManager.pause();
      if (wasTransitioning) {
        this.transitionInProgress = false;
      }
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
    this.transitionInProgress = false;
    this.clearFailedTrackSkipState();
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
    this.clearFailedTrackSkipState();
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const shuffleMode = state?.shuffleMode || false;
    const repeatMode = state?.repeatMode || 'OFF';
    
    if (this.audioPlayer.contextManager && this.audioPlayer.contextManager.isUsingBufferPlayback()) {
      const currentTime = this.audioPlayer.contextManager.getCurrentBufferTime();
      if (currentTime > 3) {
        const currentTrack = this.getTrack(currentIndex);
        if (currentTrack) {
          await this.audioPlayer.contextManager.seamlessTransition(currentTrack, currentIndex);
        }
        return;
      }
    } else if (this.audioPlayer.audioElement && this.audioPlayer.audioElement.currentTime > 3) {
      this.audioPlayer.audioElement.currentTime = 0;
      await this.play();
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
              await this.audioPlayer.contextManager.seamlessTransition(currentTrack, currentIndex);
            }
          } else {
            this.audioPlayer.audioElement.currentTime = 0;
            await this.play();
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
              await this.audioPlayer.contextManager.seamlessTransition(currentTrack, currentIndex);
            }
          } else {
            this.audioPlayer.audioElement.currentTime = 0;
            await this.play();
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
        await this.audioPlayer.contextManager.loadTrack(prevTrack, newIndex);
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
        const loaded = await this.audioPlayer.loadTrack?.(newIndex);
        if (loaded !== false) {
          await this.play();
        }
      } finally {
        this.transitionInProgress = false;
      }
    } else {
      if (this.audioPlayer.stateManager) {
        this.audioPlayer.stateManager.updateState({
          currentTrackIndex: newIndex
        }, 'PlaybackManager playPrevious');
      }
      const loaded = await this.audioPlayer.loadTrack?.(newIndex);
      if (loaded !== false) {
        await this.play();
      }
    }
    
    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayPauseButton();
    }
  }
  
  /**
   * Enhanced playNext with seamless transition and proper error handling
   */
  async playNext(userInitiated = true, options = {}) {
    if (this.playlist.length === 0) {
      return;
    }

    const ignoreRepeatOne = options?.ignoreRepeatOne === true;
    const failedIndex = Number.isInteger(options?.failedIndex) ? options.failedIndex : null;
    const failedTrackSkipState = failedIndex !== null
      ? this.recordFailedTrackSkip(failedIndex)
      : null;
    const isInternalFailureSkip = options?.allowDuringTransition === true ||
      (!userInitiated && ignoreRepeatOne && failedIndex !== null);
    const ownsTransitionGuard = !this.transitionInProgress;

    if (this.transitionInProgress && !isInternalFailureSkip) {
      return;
    }

    if (!failedTrackSkipState) {
      this.clearFailedTrackSkipState();
    } else if (this.hasFailedEveryPlaylistEntry(failedTrackSkipState)) {
      await this.stopAfterFailedTrackSkipExhausted();
      return;
    }
    
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const repeatMode = state?.repeatMode || 'OFF';
    const shuffleMode = state?.shuffleMode || false;
    
    if (repeatMode === 'ONE' && !userInitiated && !ignoreRepeatOne) {
      if (this.audioPlayer.contextManager && this.audioPlayer.contextManager.isUsingBufferPlayback()) {
        const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
        const currentTrack = this.getTrack(currentIndex);
        if (currentTrack) {
          await this.audioPlayer.contextManager.seamlessTransition(currentTrack, currentIndex);
        }
      } else {
        this.audioPlayer.audioElement.currentTime = 0;
        this.play();
      }
      return;
    }
    
    const currentIndex = this.audioPlayer.stateManager.getCurrentTrackIndex();
    const newIndex = this.getNextTrackIndex(currentIndex, repeatMode, shuffleMode, failedTrackSkipState);
    if (newIndex === null) {
      if (failedTrackSkipState && repeatMode === 'ALL') {
        await this.stopAfterFailedTrackSkipExhausted();
      }
      return;
    }
    
    const nextTrack = this.getTrack(newIndex);
    if (!nextTrack) {
      console.warn('[PlaybackManager] No next track available');
      return;
    }
    
    this.transitionInProgress = true;
    
    try {
      let transitionResult = true;
      if (this.audioPlayer.contextManager) {
        transitionResult = await this.audioPlayer.contextManager.transitionToNextTrack(nextTrack, newIndex);
      } else {
        console.warn('[PlaybackManager] ContextManager not available for transition');
      }

      if (transitionResult !== false) {
        this.clearFailedTrackSkipState();
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
      if (ownsTransitionGuard) {
        this.transitionInProgress = false;
      }
    }
  }

  getNextTrackIndex(currentIndex, repeatMode, shuffleMode, failedTrackSkipState = null) {
    let nextIndex = currentIndex;
    let reshuffled = false;

    for (let attempts = 0; attempts < this.playlist.length; attempts++) {
      nextIndex += 1;

      if (nextIndex >= this.playlist.length) {
        if (repeatMode !== 'ALL') {
          return null;
        }

        if (shuffleMode && !reshuffled) {
          this.reshufflePlaylist();
          this.reindexFailedTrackSkipState(failedTrackSkipState);
          reshuffled = true;
        }
        nextIndex = 0;
      }

      if (!this.isFailedTrackSkipCandidate(nextIndex, failedTrackSkipState)) {
        return nextIndex;
      }
    }

    return null;
  }

  recordFailedTrackSkip(failedIndex) {
    if (!this.failedTrackSkipState ||
      this.failedTrackSkipState.playlistLength !== this.playlist.length) {
      this.failedTrackSkipState = {
        playlistLength: this.playlist.length,
        failedIndices: new Set(),
        failedTracks: []
      };
    }

    if (failedIndex >= 0 && failedIndex < this.playlist.length) {
      this.failedTrackSkipState.failedIndices.add(failedIndex);
      const failedTrack = this.getTrack(failedIndex);
      if (failedTrack && !this.failedTrackSkipState.failedTracks.includes(failedTrack)) {
        this.failedTrackSkipState.failedTracks.push(failedTrack);
      }
    }

    return this.failedTrackSkipState;
  }

  reindexFailedTrackSkipState(failedTrackSkipState) {
    if (!failedTrackSkipState) return;

    failedTrackSkipState.failedIndices = new Set();
    for (const failedTrack of failedTrackSkipState.failedTracks) {
      const index = this.playlist.findIndex(track => track === failedTrack);
      if (index >= 0) {
        failedTrackSkipState.failedIndices.add(index);
      }
    }
  }

  isFailedTrackSkipCandidate(index, failedTrackSkipState) {
    if (!failedTrackSkipState) return false;
    if (failedTrackSkipState.failedIndices.has(index)) return true;

    const track = this.getTrack(index);
    return !!track && failedTrackSkipState.failedTracks.includes(track);
  }

  hasFailedEveryPlaylistEntry(failedTrackSkipState) {
    return !!failedTrackSkipState &&
      this.playlist.length > 0 &&
      failedTrackSkipState.failedIndices.size >= this.playlist.length;
  }

  clearFailedTrackSkipState() {
    this.failedTrackSkipState = null;
  }

  async stopAfterFailedTrackSkipExhausted() {
    console.warn('[PlaybackManager] All playlist tracks failed to load; stopping playback');
    this.clearFailedTrackSkipState();
    this.transitionInProgress = false;

    if (this.audioPlayer.contextManager) {
      await this.audioPlayer.contextManager.stop();
    } else {
      console.warn('[PlaybackManager] ContextManager not available for stop');
    }

    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        isPlaying: false,
        isPaused: false,
        isStopped: true,
        isTransitioning: false,
        transitionType: null
      }, 'PlaybackManager failed track skip exhausted');
    }

    if (this.audioPlayer.ui) {
      this.audioPlayer.ui.updatePlayPauseButton();
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
        this.audioPlayer.contextManager.seamlessTransition(currentTrack, currentIndex).catch(error => {
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
          this.audioPlayer.contextManager.transitionToNextTrack(firstTrack, 0).catch(error => {
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
          this.audioPlayer.contextManager.transitionToNextTrack(firstTrack, 0).catch(error => {
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
        const loadOperation = autoPlay
          ? this.audioPlayer.contextManager.seamlessTransition(track, finalIndex)
          : this.audioPlayer.contextManager.loadTrack(track, finalIndex);
        loadOperation.catch(error => {
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
    
    const newIndex = this.playlist.findIndex(track => samePlaybackEntry(track, currentTrack));
    
    const finalIndex = newIndex === -1 ? 0 : newIndex;
    this.syncPlaylistState(finalIndex);
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        currentTrackIndex: finalIndex,
        currentTrackPosition: 0
      }, 'PlaybackManager reshufflePlaylist');
    }
  }

  disableShuffleModePreservingCurrentTrack(state) {
    if (this.originalPlaylist.length === 0) {
      return null;
    }

    const currentIndex = Number.isInteger(state?.currentTrackIndex)
      ? state.currentTrackIndex
      : (this.audioPlayer.stateManager?.getCurrentTrackIndex?.() ?? 0);
    const currentTrack = this.playlist[currentIndex];

    this.playlist = [...this.originalPlaylist];

    const restoredIndex = this.playlist.findIndex(track => samePlaybackEntry(track, currentTrack));
    let finalIndex = restoredIndex === -1 ? currentIndex : restoredIndex;
    if (!Number.isInteger(finalIndex) || finalIndex < 0 || finalIndex >= this.playlist.length) {
      finalIndex = 0;
    }

    this.syncPlaylistState(finalIndex);

    if (this.audioPlayer.contextManager?.nextBuffer) {
      this.audioPlayer.contextManager.clearNextTrackBuffer();
    }

    return finalIndex;
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
    let restoredCurrentTrackIndex = null;
    
    switch (currentRepeatMode) {
      case 'OFF':
        newRepeatMode = 'ALL';
        break;
      case 'ALL':
        newRepeatMode = 'ONE';
        
        if (state?.shuffleMode) {
          restoredCurrentTrackIndex = this.disableShuffleModePreservingCurrentTrack(state);
        }
        break;
      case 'ONE':
        newRepeatMode = 'OFF';
        break;
      default:
        newRepeatMode = 'OFF';
    }
    
    if (this.audioPlayer.stateManager) {
      const updates = {
        repeatMode: newRepeatMode
      };
      if (state?.shuffleMode && newRepeatMode === 'ONE') {
        updates.shuffleMode = false;
        if (restoredCurrentTrackIndex !== null) {
          updates.currentTrackIndex = restoredCurrentTrackIndex;
        }
      }
      this.audioPlayer.stateManager.updateState(updates, 'PlaybackManager toggleRepeatMode');
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
    const currentRepeatMode = this.audioPlayer.stateManager.getStateSnapshot?.()?.repeatMode || 'OFF';
    const repeatMode = playerState.repeatMode || currentRepeatMode;
    if (playerState.repeatMode) {
      updates.repeatMode = playerState.repeatMode;
    }
    if (playerState.repeatMode === 'ONE' || playerState.shuffleMode !== undefined) {
      updates.shuffleMode = normalizeShuffleModeForRepeat(repeatMode, playerState.shuffleMode);
    }
    if (Object.keys(updates).length > 0) {
      this.audioPlayer.stateManager.updateState(updates, source);
    }
  }

  getPersistentPlayerState() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const repeatMode = state?.repeatMode || 'OFF';
    return {
      repeatMode,
      shuffleMode: normalizeShuffleModeForRepeat(repeatMode, state?.shuffleMode)
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
    this.clearFailedTrackSkipState();

    if (!this.audioPlayer) return;
    
    if (this.audioPlayer.stateManager) {
      this.audioPlayer.stateManager.updateState({
        playlist: [],
        playlistLength: 0,
        currentTrack: null,
        currentTrackIndex: 0,
        currentTrackName: '',
        artworkUrl: '',
        isPlaying: false,
        isPaused: false,
        isStopped: true,
        currentTrackDuration: 0,
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

function normalizeShuffleModeForRepeat(repeatMode, shuffleMode) {
  return repeatMode === 'ONE' ? false : !!shuffleMode;
}
