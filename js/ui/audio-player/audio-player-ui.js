/**
 * AudioPlayerUI - Handles player UI creation and management
 * Manages user input and display updates
 * UNIFIED STATE MANAGEMENT: UI automatically updates based on state changes
 */

// Inline transport-control icons (colored white via the .player-button CSS rule).
// Kept as a shared map so play/pause and repeat icon swaps reuse the same markup.
const PLAYER_ICONS = {
  play: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" draggable="false"><path d="M8 5.14a1 1 0 0 1 1.52-.85l10.5 6.86a1 1 0 0 1 0 1.7L9.52 19.71A1 1 0 0 1 8 18.86z"/></svg>',
  pause: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" draggable="false"><rect x="7" y="5" width="3.6" height="14" rx="1.4"/><rect x="13.4" y="5" width="3.6" height="14" rx="1.4"/></svg>',
  stop: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" draggable="false"><rect x="6" y="6" width="12" height="12" rx="2.2"/></svg>',
  previous: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" draggable="false"><path d="M13 7.15a.8.8 0 0 0-1.25-.66l-7.2 5.05a.9.9 0 0 0 0 1.48l7.2 5.05A.8.8 0 0 0 13 17.4z"/><path d="M20 7.15a.8.8 0 0 0-1.25-.66l-6.2 4.45a.9.9 0 0 0 0 1.48l6.2 4.45A.8.8 0 0 0 20 17.4z"/></svg>',
  next: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round" stroke-linecap="round" draggable="false"><path d="M11 6.6a.8.8 0 0 1 1.25-.66l7.2 5.05a.9.9 0 0 1 0 1.48l-7.2 5.05A.8.8 0 0 1 11 16.85z"/><path d="M4 6.6a.8.8 0 0 1 1.25-.66l6.2 4.45a.9.9 0 0 1 0 1.48l-6.2 4.45A.8.8 0 0 1 4 16.85z"/></svg>',
  shuffle: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.8-1.1 2-1.7 3.3-1.7H22"/><path d="m18 2 4 4-4 4"/><path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2"/><path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8"/><path d="m18 14 4 4-4 4"/></svg>',
  repeat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
  repeat1: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11.3 10.3 13 9.5V15" stroke-width="1.8"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" draggable="false"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

const PLAYER_ARTWORK_PLACEHOLDER = '<svg width="72" height="72" viewBox="0 0 72 72" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" draggable="false"><path d="M28 50V20l24-5v30"/><circle cx="22" cy="50" r="7"/><circle cx="46" cy="45" r="7"/></svg>';

export class AudioPlayerUI {
  constructor(audioPlayer) {
    this.audioPlayer = audioPlayer;
    this.container = null;
    this.trackNameDisplay = null;
    this.seekBar = null;
    this.timeDisplay = null;
    this.playPauseButton = null;
    this.stopButton = null;
    this.prevButton = null;
    this.nextButton = null;
    this.repeatButton = null;
    this.shuffleButton = null;
    this.closeButton = null;
    this.artworkImage = null;
    this.playlistDisplay = null;
    this.libraryContextMenu = null;
    this.libraryContextMenuCleanup = null;
    this.libraryContextMenuReturnFocus = null;
    this.playlistSelectionGeneration = 0;
    this.playlistSelectionIntent = null;
    this.queueRenderGeneration = 0;
    this.updateInterval = null;
    this.positionRaf = null;
    this._powerUiEnabled = true;
    this.isDisposed = false;
    this.documentRef = globalThis.document || null;
    this.onVisibilityChange = () => this.refreshPowerUiScheduling();
    this.documentRef?.addEventListener?.('visibilitychange', this.onVisibilityChange);
    
    // State change listeners
    this.stateListeners = [];
    
    // Initialize state monitoring
    this.initStateMonitoring();
  }
  
  /**
   * Initialize state monitoring for automatic UI updates
   */
  initStateMonitoring() {
    const stateManager = this.audioPlayer.stateManager;
    if (!stateManager || this.stateListeners.length > 0) return;

    const addStateListener = (key, callback) => {
      stateManager.addListener(key, callback);
      this.stateListeners.push({ key, callback });
    };
    
    // Listen to all state changes
    addStateListener('*', (newValue, key, source) => {
      this.handleStateChange(key, newValue, source);
    });
    
    // Listen to specific state changes
    addStateListener('currentTrack', (track) => {
      this.updateTrackDisplay(track);
      this.notifyLibraryNowPlaying(track);
    });

    addStateListener('currentTrackName', () => {
      this.updateTrackDisplay();
    });

    addStateListener('artworkUrl', (artworkUrl) => {
      this.updateArtwork(artworkUrl);
    });

    addStateListener('isTransitioning', () => {
      this.updateLoadingState();
    });

    addStateListener('transitionType', () => {
      this.updateLoadingState();
    });

    addStateListener('playlist', () => {
      this.updatePlaylistDisplay();
      this.notifyLibraryNowPlaying();
    });

    addStateListener('queueWindow', () => {
      this.updatePlaylistDisplay();
    });

    addStateListener('currentTrackIndex', () => {
      this.updatePlaylistDisplay();
      this.notifyLibraryNowPlaying();
    });
    
    addStateListener('currentTrackPosition', (position) => {
      this.schedulePositionUpdate();
    });
    
    addStateListener('currentTrackDuration', (duration) => {
      this.updateTimeDisplay();
    });
    
    addStateListener('isPlaying', (isPlaying) => {
      this.updatePlayPauseButton();
      this.refreshPowerUiScheduling();
    });
    
    addStateListener('isPaused', (isPaused) => {
      this.updatePlayPauseButton();
    });
    
    addStateListener('isStopped', (isStopped) => {
      this.updateTimeDisplay();
      this.updatePlayPauseButton();
    });
  }

  canRunPlayerUi() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const context = this.audioPlayer.audioManager?.audioContext || this.audioPlayer.audioContext;
    return !this.isDisposed && this._powerUiEnabled && !this.documentRef?.hidden &&
      state?.isPlaying === true && context?.state === 'running';
  }

  schedulePositionUpdate() {
    if (!this.canRunPlayerUi() || this.positionRaf !== null) return;
    this.positionRaf = requestAnimationFrame(() => {
      this.positionRaf = null;
      if (!this.canRunPlayerUi()) return;
      this.audioPlayer.audioManager?.incrementPowerDiagnostic?.('playerPositionRafCallbacks');
      this.updateTimeDisplay();
    });
  }

  setPowerUiEnabled(enabled) {
    this._powerUiEnabled = enabled !== false;
    this.refreshPowerUiScheduling();
  }

  refreshPowerUiScheduling() {
    if (this.canRunPlayerUi()) {
      if (!this.updateInterval) this.startUpdateInterval();
      return;
    }
    this.stopUpdateInterval();
    if (this.positionRaf !== null) {
      cancelAnimationFrame(this.positionRaf);
      this.positionRaf = null;
    }
  }

  removeStateListeners() {
    const stateManager = this.audioPlayer?.stateManager;
    if (stateManager?.removeListener) {
      this.stateListeners.forEach(({ key, callback }) => {
        stateManager.removeListener(key, callback);
      });
    }
    this.stateListeners = [];
  }
  
  /**
   * Handle state changes and update UI accordingly
   */
  handleStateChange(key, newValue, source) {
    // UI updates are handled by specific listeners
  }
  
  /**
   * Create the player UI
   */
  createPlayerUI() {
    this.isDisposed = false;
    this.initStateMonitoring();

    // Create container
    const container = document.createElement('div');
    container.className = 'audio-player';
    
    // Set initial play/pause and repeat icons based on state
    const ICON = PLAYER_ICONS;
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const repeatIcon = state?.repeatMode === 'ONE' ? ICON.repeat1 : ICON.repeat;

    container.innerHTML = `
     <h2>Player</h2>
     <div class="player-artwork">
       <div class="player-artwork-placeholder" aria-hidden="true">${PLAYER_ARTWORK_PLACEHOLDER}</div>
       <img class="player-artwork-image" alt="" hidden>
       <div class="player-loading-spinner player-loading-spinner-artwork" role="status" aria-label="Loading"></div>
     </div>
     <div class="track-name-container">
       <div class="player-loading-spinner player-loading-spinner-inline" role="status" aria-label="Loading"></div>
       <div class="track-name">No track loaded</div>
     </div>
     <div class="player-controls">
        <input type="range" class="seek-bar" min="0" max="100" value="0" step="0.1">
        <div class="time-display">00:00</div>
        <button class="player-button play-pause-button" title="${window.uiManager ? window.uiManager.t('ui.title.playPause') : 'Play or pause'}">${ICON.play}</button>
        <button class="player-button stop-button" title="${window.uiManager ? window.uiManager.t('ui.title.stop') : 'Stop'}">${ICON.stop}</button>
        <button class="player-button prev-button" title="${window.uiManager ? window.uiManager.t('ui.title.prevTrack') : 'Previous track'}">${ICON.previous}</button>
        <button class="player-button next-button" title="${window.uiManager ? window.uiManager.t('ui.title.nextTrack') : 'Next track'}">${ICON.next}</button>
        <button class="player-button repeat-button" title="${window.uiManager ? window.uiManager.t('ui.title.repeat') : 'Toggle repeat mode'}">${repeatIcon}</button>
        <button class="player-button shuffle-button" title="${window.uiManager ? window.uiManager.t('ui.title.shuffle') : 'Toggle shuffle'}">${ICON.shuffle}</button>
        <button class="player-button close-button" title="${window.uiManager ? window.uiManager.t('ui.title.closePlayer') : 'Close player'}">${ICON.close}</button>
        <div class="player-playlist" aria-label="Playlist"></div>
      </div>
    `;

    // Store references to UI elements
    this.container = container;
    this.trackNameDisplay = container.querySelector('.track-name');
    this.seekBar = container.querySelector('.seek-bar');
    this.timeDisplay = container.querySelector('.time-display');
    this.playPauseButton = container.querySelector('.play-pause-button');
    this.stopButton = container.querySelector('.stop-button');
    this.prevButton = container.querySelector('.prev-button');
    this.nextButton = container.querySelector('.next-button');
    this.repeatButton = container.querySelector('.repeat-button');
    this.shuffleButton = container.querySelector('.shuffle-button');
    this.closeButton = container.querySelector('.close-button');
    this.artworkImage = container.querySelector('.player-artwork-image');
    this.playlistDisplay = container.querySelector('.player-playlist');
    container.addEventListener('dragover', event => {
      if (!hasLibraryTrackDrag(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    container.addEventListener('drop', event => this.handleLibraryTrackDrop(event));
    this.trackNameDisplay.tabIndex = 0;
    this.trackNameDisplay.addEventListener('contextmenu', event => {
      this.openLibraryTrackMenu(event, this.getCurrentTrack());
    });
    this.trackNameDisplay.addEventListener('keydown', event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        const track = this.getCurrentTrack();
        if (!track) return;
        event.preventDefault();
        const rect = this.trackNameDisplay.getBoundingClientRect?.() || { left: 16, bottom: 48 };
        this.openLibraryTrackMenu({
          preventDefault() {},
          clientX: rect.left + 12,
          clientY: rect.bottom + 4
        }, track);
      }
    });

    const runPlaybackCommand = command => {
      try {
        void Promise.resolve(command()).catch(error => {
          console.error('Audio player command failed:', error);
          window.uiManager?.setError?.('error.playbackCommandFailed', true);
        });
      } catch (error) {
        console.error('Audio player command failed:', error);
        window.uiManager?.setError?.('error.playbackCommandFailed', true);
      }
    };

    // Add event listeners
    this.playPauseButton.addEventListener('click', () => {
      this.audioPlayer.togglePlayPause();
    });
    this.stopButton.addEventListener('click', () => this.audioPlayer.stop());
    this.prevButton.addEventListener('click', () => runPlaybackCommand(() => this.audioPlayer.playPrevious()));
    this.nextButton.addEventListener('click', () => runPlaybackCommand(() => this.audioPlayer.playNext()));
    this.closeButton.addEventListener('click', () => this.audioPlayer.close());
    
    // Add repeat button event listener
    this.repeatButton.addEventListener('click', () => runPlaybackCommand(
      () => this.audioPlayer.playbackManager.toggleRepeatMode()
    ));
    
    // Add shuffle button event listener
    this.shuffleButton.addEventListener('click', () => runPlaybackCommand(
      () => this.audioPlayer.playbackManager.toggleShuffleMode()
    ));
    
    // Update UI based on loaded state
    this.updatePlayerUIState();
    this.updateArtwork();
    this.updateLoadingState();
    this.updatePlaylistDisplay();
    
    this.seekBar.addEventListener('input', () => {
      // Check if seeking is enabled
      if (this.audioPlayer.stateManager) {
        const state = this.audioPlayer.stateManager.getStateSnapshot();
        if (!state.seekBarEnabled) {
          return;
        }
      }
      
      // Handle seeking using unified state management
      if (this.audioPlayer.contextManager) {
        const state = this.audioPlayer.contextManager.getCurrentState();
        const duration = state.currentTrackDuration;
        if (duration > 0) {
          const seekTime = (this.seekBar.value / 100) * duration;
          if (isFinite(seekTime)) {
            this.audioPlayer.resumeAudioContextInGesture?.();
            this.audioPlayer.contextManager.seek(seekTime);
            this.updateTimeDisplay();
          }
        }
      } else if (this.audioPlayer.audioElement) {
        // Check if audio element has valid duration and is not paused
        if (this.audioPlayer.audioElement.duration && 
            isFinite(this.audioPlayer.audioElement.duration) && 
            !this.audioPlayer.audioElement.paused) {
          const seekTime = (this.seekBar.value / 100) * this.audioPlayer.audioElement.duration;
          if (isFinite(seekTime)) {
            this.audioPlayer.resumeAudioContextInGesture?.();
            this.audioPlayer.contextManager.handleSeek(seekTime, 'user');
            this.updateTimeDisplay();
          }
        }
      }
    });

    this.mountContainerForLayout();

    // Start update interval for time display
    this.startUpdateInterval();

    return container;
  }

  /**
   * Move the existing player container to the active layout.
   * @param {'mobile'|'desktop'=} mode Optional forced destination.
   */
  mountContainerForLayout(mode = undefined) {
    if (!this.container) return;

    const useMobile = mode === 'mobile' || (mode === undefined && window.uiManager?.layoutMode?.isMobile);
    const mobilePlayerView = typeof document.getElementById === 'function'
      ? document.getElementById('mobilePlayerView')
      : null;

    if (useMobile && mobilePlayerView) {
      if (this.container.parentNode !== mobilePlayerView) {
        mobilePlayerView.appendChild(this.container);
      }
      window.uiManager?.releaseAudioPlayerLayoutPlaceholder?.();
      this.updateArtwork();
      window.uiManager?.mobileNav?.updatePlayerPlaceholder?.();
      return;
    }

    // Desktop keeps the player above the Double Blind Test panel when one is open,
    // otherwise just above the main application container.
    const mainContainer = document.querySelector('.main-container');
    const dbtPanel = document.querySelector('.double-blind-test');
    const insertTarget = dbtPanel || mainContainer;
    if (insertTarget && insertTarget.parentNode) {
      const targetParent = insertTarget.parentNode;
      if (this.container.parentNode !== targetParent || this.container.nextSibling !== insertTarget) {
        targetParent.insertBefore(this.container, insertTarget);
      }
    }
    window.uiManager?.releaseAudioPlayerLayoutPlaceholder?.();
    this.updateArtwork();
    window.uiManager?.mobileNav?.updatePlayerPlaceholder?.();
  }

  /**
   * Update player UI based on current state
   */
  updatePlayerUIState() {
    if (!this.repeatButton || !this.shuffleButton) return;
    
    // Get state from StateManager
    const state = this.audioPlayer.stateManager?.getStateSnapshot();
    const repeatMode = state?.repeatMode || 'OFF';
    const shuffleMode = state?.shuffleMode || false;

    // Keep the visual state in sync and let CSS render the active face.
    const repeatActive = repeatMode === 'ALL' || repeatMode === 'ONE';
    this.repeatButton.setAttribute('data-active', repeatActive ? 'true' : 'false');
    
    // Update repeat button state
    switch (repeatMode) {
      case 'ALL':
        this.repeatButton.innerHTML = PLAYER_ICONS.repeat;
        break;
      case 'ONE':
        this.repeatButton.innerHTML = PLAYER_ICONS.repeat1;
        
        // Disable shuffle button in ONE mode
        this.shuffleButton.disabled = true;
        this.shuffleButton.style.opacity = '0.5';
        break;
      case 'OFF':
      default:
        this.repeatButton.innerHTML = PLAYER_ICONS.repeat;
        
        // Enable shuffle button
        this.shuffleButton.disabled = false;
        this.shuffleButton.style.opacity = '1';
        break;
    }
    
    // Update shuffle button state
    const shuffleActive = shuffleMode && repeatMode !== 'ONE';
    this.shuffleButton.setAttribute('data-active', shuffleActive ? 'true' : 'false');
  }

  /**
   * Update play/pause button state
   */
  updatePlayPauseButton() {
    if (!this.playPauseButton) return;
    
    // Get state from StateManager (single source of truth)
    let isPlaying = false;
    
    if (this.audioPlayer.stateManager) {
      const state = this.audioPlayer.stateManager.getStateSnapshot();
      isPlaying = state.isPlaying;
    } else {
      console.warn('[AudioPlayerUI] StateManager not available for updatePlayPauseButton');
      return;
    }
    
    if (isPlaying) {
      this.playPauseButton.innerHTML = PLAYER_ICONS.pause;
    } else {
      this.playPauseButton.innerHTML = PLAYER_ICONS.play;
    }
  }

  /**
   * Update track display with track name
   */
  updateTrackDisplay(track = null) {
    if (!this.trackNameDisplay) return;
    
    // Get track from state if not provided
    let currentTrackName = '';
    if (!track && this.audioPlayer.stateManager) {
      const state = this.audioPlayer.stateManager.getStateSnapshot();
      track = state.currentTrack;
      currentTrackName = state.currentTrackName || '';
    }
    
    if (currentTrackName) {
      this.trackNameDisplay.textContent = currentTrackName;
    } else if (track && track.name) {
      this.trackNameDisplay.textContent = this.getDisplayTrackName(track);
    } else {
      this.trackNameDisplay.textContent = 'No track loaded';
    }
  }

  getCurrentTrack() {
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const playlist = Array.isArray(state?.playlist) ? state.playlist : [];
    return state?.currentTrack || playlist[state?.currentTrackIndex ?? -1] || null;
  }

  notifyLibraryNowPlaying(track = null) {
    const current = track || this.getCurrentTrack();
    window.uiManager?.libraryView?.setNowPlayingTrack?.(current?.libraryTrackId || null);
  }

  updateArtwork(artworkUrl = null) {
    if (!this.artworkImage) return;

    if (artworkUrl === null && this.audioPlayer.stateManager) {
      const state = this.audioPlayer.stateManager.getStateSnapshot();
      artworkUrl = state.artworkUrl || '';
    }

    this.artworkImage.src = artworkUrl || '';
    this.artworkImage.hidden = !artworkUrl;
    const artworkContainer = this.artworkImage.parentNode;
    const placeholder = artworkContainer?.querySelector?.('.player-artwork-placeholder');
    if (placeholder) {
      placeholder.hidden = !!artworkUrl;
    }
    if (artworkContainer?.style) {
      const keepMobilePlaceholder = window.uiManager?.layoutMode?.isMobile;
      const hasArtworkLayout = !!artworkUrl || !!keepMobilePlaceholder;
      artworkContainer.style.display = hasArtworkLayout ? '' : 'none';
      this.container?.setAttribute('data-artwork-layout', hasArtworkLayout ? 'true' : 'false');
    }
  }

  updateLoadingState() {
    if (!this.container) return;
    const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
    const isLoading = state?.isTransitioning === true && state?.transitionType === 'loading';
    this.container.setAttribute('data-loading', isLoading ? 'true' : 'false');
  }

  getDisplayTrackName(track) {
    const title = track?.meta?.title;
    const artist = track?.meta?.artist;
    if (title && artist) return `${artist} - ${title}`;
    if (title) return title;
    return track?.name || '';
  }

  beginPlaylistSelection(shouldPlay) {
    const generation = ++this.playlistSelectionGeneration;
    const inheritedPlayIntent = this.playlistSelectionIntent?.shouldPlay === true;
    const intent = {
      generation,
      shouldPlay: shouldPlay || inheritedPlayIntent
    };
    this.playlistSelectionIntent = intent;
    return intent;
  }

  isCurrentPlaylistSelection(intent) {
    return this.playlistSelectionIntent === intent &&
      intent?.generation === this.playlistSelectionGeneration;
  }

  completePlaylistSelection(intent) {
    if (!this.isCurrentPlaylistSelection(intent)) return;
    this.playlistSelectionIntent = null;
  }

  cancelPlaylistSelectionIntent() {
    this.playlistSelectionGeneration++;
    this.playlistSelectionIntent = null;
  }

  updatePlaylistDisplay() {
    if (!this.playlistDisplay || !this.audioPlayer.stateManager) return;

    const state = this.audioPlayer.stateManager.getStateSnapshot();
    if (state.sequenceKind === 'catalog') {
      this.renderCatalogQueueWindow(state);
      return;
    }
    const playlist = Array.isArray(state.playlist) ? state.playlist : [];
    this.playlistDisplay.innerHTML = '';
    this.playlistDisplay.style.display = playlist.length > 1 ? '' : 'none';

    playlist.forEach((track, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'player-playlist-item';
      if (item.classList && typeof item.classList.toggle === 'function') {
        item.classList.toggle('active', index === state.currentTrackIndex);
      } else if (index === state.currentTrackIndex) {
        item.className += ' active';
      }
      item.textContent = this.getDisplayTrackName(track) || `Track ${index + 1}`;
      item.addEventListener('contextmenu', event => this.openLibraryTrackMenu(event, track));
      item.addEventListener('click', async () => {
        const latestState = this.audioPlayer.stateManager?.getStateSnapshot?.();
        const selection = this.beginPlaylistSelection(
          latestState?.isPlaying || window.uiManager?.layoutMode?.isMobile
        );
        const shouldPlay = selection.shouldPlay;
        const gestureResume = shouldPlay
          ? Promise.resolve(this.audioPlayer.resumeAudioContextInGesture?.() ?? true)
              .then(value => value !== false, () => false)
          : null;
        // Stop the old source before the selected track is published. Loading
        // and gesture activation continue together after this synchronous handoff.
        const stopOldPlayback = shouldPlay
          ? Promise.resolve(this.audioPlayer.stop({
              preservePlaylistSelectionIntent: true
            })).then(() => true)
          : Promise.resolve(true);
        this.audioPlayer.stateManager?.updateState?.({
          currentTrackIndex: index,
          currentTrack: track
        }, 'AudioPlayerUI playlist select');
        try {
          const loadTrack = this.audioPlayer.loadTrack(index);
          const [loaded, resumeReady] = await Promise.all([
            loadTrack,
            shouldPlay ? gestureResume : Promise.resolve(true),
            stopOldPlayback
          ]);
          if (!this.isCurrentPlaylistSelection(selection)) return false;
          if (shouldPlay && loaded !== false && resumeReady) {
            const played = await this.audioPlayer.play(false) !== false;
            return this.isCurrentPlaylistSelection(selection) && played;
          }
          return loaded !== false && resumeReady;
        } finally {
          this.completePlaylistSelection(selection);
        }
      });
      this.playlistDisplay.appendChild(item);
    });
  }

  renderCatalogQueueWindow(state) {
    const generation = ++this.queueRenderGeneration;
    const queueWindow = state.queueWindow;
    const rows = Array.isArray(queueWindow?.rows) ? queueWindow.rows.slice(0, 80) : [];
    const startOrdinal = queueWindow?.startOrdinal ?? 0;
    const totalCount = queueWindow?.totalCount ?? state.playlistLength;
    this.playlistDisplay.innerHTML = '';
    this.playlistDisplay.style.display = state.playlistLength > 1 ? '' : 'none';
    const navigation = document.createElement('div');
    navigation.className = 'player-queue-pagination';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'player-queue-page-previous';
    previous.setAttribute('aria-label', this.t('library.queue.previousPage'));
    previous.textContent = '‹';
    previous.disabled = startOrdinal <= 0;
    previous.addEventListener('click', () => {
      void this.audioPlayer.playbackManager?.refreshCatalogQueuePage?.(Math.max(0, startOrdinal - 80));
    });
    const position = document.createElement('span');
    position.className = 'player-queue-page-position';
    const visibleEnd = Math.min(totalCount, startOrdinal + rows.length);
    position.textContent = `${startOrdinal + 1}–${visibleEnd} / ${totalCount}`;
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'player-queue-page-next';
    next.setAttribute('aria-label', this.t('library.queue.nextPage'));
    next.textContent = '›';
    next.disabled = visibleEnd >= totalCount;
    next.addEventListener('click', () => {
      void this.audioPlayer.playbackManager?.refreshCatalogQueuePage?.(startOrdinal + 80);
    });
    navigation.appendChild(previous);
    navigation.appendChild(position);
    navigation.appendChild(next);
    this.playlistDisplay.appendChild(navigation);
    rows.forEach((track, index) => {
      if (generation !== this.queueRenderGeneration) return;
      const ordinal = startOrdinal + index;
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'player-playlist-item';
      item.dataset.ordinal = String(ordinal);
      item.classList?.toggle?.('active', ordinal === state.currentTrackIndex);
      item.textContent = this.getDisplayTrackName(track) || this.t('library.queue.trackNumber', {
        number: ordinal + 1
      });
      item.addEventListener('contextmenu', event => this.openLibraryTrackMenu(event, track));
      item.addEventListener('click', async () => {
        const latestState = this.audioPlayer.stateManager?.getStateSnapshot?.();
        const shouldPlay = latestState?.isPlaying || window.uiManager?.layoutMode?.isMobile;
        await this.audioPlayer.playbackManager?.selectCatalogOrdinal?.(ordinal, {
          play: shouldPlay,
          userInitiated: true
        });
      });
      this.playlistDisplay.appendChild(item);
    });
  }

  async openLibraryTrackMenu(event, track) {
    if (!track) return;
    event.preventDefault?.();
    const manager = await this.getLibraryManager();
    const libraryTrack = manager?.findTrackForPlaybackEntry?.(track);
    const libraryTrackId = track?.libraryTrackId || libraryTrack?.id;
    this.closeLibraryContextMenu();
    const menu = document.createElement('div');
    menu.className = 'player-library-context-menu';
    menu.setAttribute('role', 'menu');
    menu.style.left = `${Math.max(4, event.clientX || 0)}px`;
    menu.style.top = `${Math.max(4, event.clientY || 0)}px`;
    menu.innerHTML = `
      ${libraryTrackId ? `
        <button type="button" role="menuitem" data-action="show">${escapeHtml(this.t('library.action.showInLibrary'))}</button>
        <button type="button" role="menuitem" data-action="album">${escapeHtml(this.t('library.action.goToAlbum'))}</button>
        <button type="button" role="menuitem" data-action="artist">${escapeHtml(this.t('library.action.goToArtist'))}</button>
        <button type="button" role="menuitem" data-action="playlist">${escapeHtml(this.t('library.action.addToPlaylist'))}</button>
        <hr>
      ` : ''}
      <button type="button" role="menuitem" data-action="save-queue">${escapeHtml(this.t('library.action.saveQueueAsPlaylist'))}</button>
    `;
    menu.querySelector('[data-action="show"]')?.addEventListener('click', async () => {
      await window.uiManager?.showLibraryTrack?.(libraryTrackId);
      this.closeLibraryContextMenu();
    });
    menu.querySelector('[data-action="album"]')?.addEventListener('click', async () => {
      await window.uiManager?.showLibraryTrack?.(libraryTrackId, { view: 'album' });
      this.closeLibraryContextMenu();
    });
    menu.querySelector('[data-action="artist"]')?.addEventListener('click', async () => {
      await window.uiManager?.showLibraryTrack?.(libraryTrackId, { view: 'artist' });
      this.closeLibraryContextMenu();
    });
    menu.querySelector('[data-action="playlist"]')?.addEventListener('click', async () => {
      const rect = menu.getBoundingClientRect?.() || { left: event.clientX || 0, top: event.clientY || 0 };
      await this.openPlayerPlaylistMenu({ clientX: rect.left, clientY: rect.top }, [libraryTrackId]);
    });
    menu.querySelector('[data-action="save-queue"]')?.addEventListener('click', async () => {
      this.closeLibraryContextMenu();
      await this.saveQueueAsPlaylist();
    });
    document.body.appendChild(menu);
    this.libraryContextMenu = menu;
    this.libraryContextMenuReturnFocus = event.currentTarget || event.target || null;
    menu.addEventListener('keydown', keyEvent => this.handleLibraryMenuKeyDown(keyEvent));
    this.attachLibraryContextMenuDismiss(menu);
    clampMenuToViewport(menu);
    menu.querySelector('button:not(:disabled)')?.focus?.();
  }

  async openPlayerPlaylistMenu(point, trackIds) {
    try {
      const manager = await this.getLibraryManager();
      if (!manager) return;
      const playlists = await manager.playlists.list();
      this.closeLibraryContextMenu();
      const menu = document.createElement('div');
      menu.className = 'player-library-context-menu';
      menu.setAttribute('role', 'menu');
      menu.style.left = `${Math.max(4, point.clientX || 0)}px`;
      menu.style.top = `${Math.max(4, point.clientY || 0)}px`;
      menu.innerHTML = `
        <button type="button" role="menuitem" data-action="new">${escapeHtml(this.t('library.action.newPlaylist'))}</button>
        ${playlists.map(playlist => `<button type="button" role="menuitem" data-playlist-id="${escapeHtml(playlist.id)}">${escapeHtml(playlist.name)}</button>`).join('')}
      `;
      menu.querySelector('[data-action="new"]')?.addEventListener('click', async () => {
        this.closeLibraryContextMenu();
        try {
          const name = await this.promptText('library.prompt.playlistName', this.t('library.prompt.queuePlaylistName'));
          if (name) await manager.playlists.create(name, trackIds);
        } catch (error) {
          window.uiManager?.setError?.(error.message || String(error), true);
        }
      });
      menu.querySelectorAll('[data-playlist-id]').forEach(button => {
        button.addEventListener('click', async () => {
          await manager.playlists.addTracks(button.dataset.playlistId, trackIds);
          this.closeLibraryContextMenu();
        });
      });
      document.body.appendChild(menu);
      this.libraryContextMenu = menu;
      this.libraryContextMenuReturnFocus = document.activeElement || null;
      menu.addEventListener('keydown', keyEvent => this.handleLibraryMenuKeyDown(keyEvent));
      this.attachLibraryContextMenuDismiss(menu);
      clampMenuToViewport(menu);
      menu.querySelector('button:not(:disabled)')?.focus?.();
    } catch (error) {
      window.uiManager?.setError?.(error.message || String(error), true);
    }
  }

  async saveQueueAsPlaylist() {
    try {
      const manager = await this.getLibraryManager();
      if (!manager) return;
      const sequenceDescriptor = this.audioPlayer.playbackManager?.getActiveSequenceDescriptor?.();
      if (sequenceDescriptor?.kind === 'catalog' || sequenceDescriptor?.kind === 'composite') {
        const name = await this.promptText('library.prompt.playlistName', this.t('library.prompt.queuePlaylistName'));
        if (name) {
          await window.uiManager?.libraryPlaybackBridge?.saveQueueAsPlaylist({
            name,
            sequenceDescriptor,
            libraryManager: manager
          });
        }
        return;
      }
      const state = this.audioPlayer.stateManager?.getStateSnapshot?.();
      const items = manager.createPlaylistItemsFromQueueEntries
        ? manager.createPlaylistItemsFromQueueEntries(Array.isArray(state?.playlist) ? state.playlist : [])
        : (Array.isArray(state?.playlist) ? state.playlist : []).map(track => track?.libraryTrackId).filter(Boolean);
      if (!items.length) {
        window.uiManager?.setError?.(this.t('library.state.noResolvedTracks'), true);
        return;
      }
      const name = await this.promptText('library.prompt.playlistName', this.t('library.prompt.queuePlaylistName'));
      if (name) await manager.playlists.create(name, items);
    } catch (error) {
      window.uiManager?.setError?.(error.message || String(error), true);
    }
  }

  async handleLibraryTrackDrop(event) {
    const trackIds = getLibraryTrackDragIds(event.dataTransfer);
    if (!trackIds.length) return;
    event.preventDefault?.();
    try {
      const manager = await this.getLibraryManager();
      await manager?.addToQueue?.(trackIds);
    } catch (error) {
      window.uiManager?.setError?.(error.message || String(error), true);
    }
  }

  async getLibraryManager() {
    if (window.uiManager?.ensureLibraryManager) {
      return window.uiManager.ensureLibraryManager();
    }
    return window.uiManager?.libraryManager || null;
  }

  // In-app replacement for window.prompt(): Electron defines prompt() but it
  // always throws, so playlist naming must use a DOM dialog instead.
  promptText(key, fallbackValue = '') {
    return new Promise(resolve => {
      const backdrop = document.createElement('div');
      backdrop.className = 'library-dialog-backdrop player-prompt-backdrop';
      const dialog = document.createElement('form');
      dialog.className = 'library-properties-dialog player-prompt-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.setAttribute('aria-label', this.t(key));
      dialog.style.width = 'min(360px, 100%)';
      dialog.style.padding = '14px';
      dialog.style.display = 'grid';
      dialog.style.gap = '10px';
      const label = document.createElement('label');
      label.className = 'player-prompt-label';
      label.textContent = this.t(key);
      const input = document.createElement('input');
      input.className = 'player-prompt-input';
      input.type = 'text';
      input.value = fallbackValue;
      const buttons = document.createElement('div');
      buttons.className = 'player-prompt-buttons';
      buttons.style.display = 'flex';
      buttons.style.justifyContent = 'flex-end';
      buttons.style.gap = '8px';
      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.className = 'player-prompt-cancel';
      cancelButton.textContent = this.t('library.action.cancel');
      const okButton = document.createElement('button');
      okButton.type = 'submit';
      okButton.className = 'player-prompt-ok';
      okButton.textContent = this.t('library.state.ok');
      buttons.appendChild(cancelButton);
      buttons.appendChild(okButton);
      dialog.appendChild(label);
      dialog.appendChild(input);
      dialog.appendChild(buttons);
      backdrop.appendChild(dialog);
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        if (backdrop.parentNode) {
          backdrop.parentNode.removeChild(backdrop);
        }
        resolve(value == null ? '' : String(value).trim());
      };
      dialog.addEventListener('submit', event => {
        event.preventDefault?.();
        finish(input.value);
      });
      cancelButton.addEventListener('click', () => finish(null));
      backdrop.addEventListener('pointerdown', event => {
        if (event.target === backdrop) finish(null);
      });
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
          event.preventDefault?.();
          finish(null);
        }
      });
      document.body.appendChild(backdrop);
      input.focus?.();
      input.select?.();
    });
  }

  attachLibraryContextMenuDismiss(menu) {
    const closeOnPointerDown = event => {
      if (menu.contains?.(event.target)) return;
      this.closeLibraryContextMenu();
    };
    const closeOnKeyDown = event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeLibraryContextMenu();
      }
    };
    document.addEventListener?.('pointerdown', closeOnPointerDown);
    document.addEventListener?.('keydown', closeOnKeyDown);
    this.libraryContextMenuCleanup = () => {
      document.removeEventListener?.('pointerdown', closeOnPointerDown);
      document.removeEventListener?.('keydown', closeOnKeyDown);
    };
  }

  closeLibraryContextMenu() {
    const returnFocus = this.libraryContextMenuReturnFocus;
    this.libraryContextMenuCleanup?.();
    this.libraryContextMenuCleanup = null;
    if (this.libraryContextMenu?.parentNode) {
      this.libraryContextMenu.parentNode.removeChild(this.libraryContextMenu);
    }
    this.libraryContextMenu = null;
    this.libraryContextMenuReturnFocus = null;
    returnFocus?.focus?.();
  }

  handleLibraryMenuKeyDown(event) {
    const items = Array.from(event.currentTarget.querySelectorAll?.('button:not(:disabled)') || []);
    const index = items.indexOf(document.activeElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      this.closeLibraryContextMenu();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      (items[(index + step + items.length) % items.length] || items[0])?.focus?.();
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      (event.key === 'Home' ? items[0] : items.at(-1))?.focus?.();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      (items[index] || document.activeElement)?.click?.();
    }
  }

  /**
   * Update time display and seek bar
   */
  updateTimeDisplay() {
    if (!this.timeDisplay || !this.seekBar) {
      if (this.isDisposed) {
        return;
      }
      console.warn('[AudioPlayerUI] Time display or seek bar not available');
      return;
    }
    
    let currentTime = 0;
    let duration = 0;
    
    // Get state from StateManager (single source of truth)
    if (this.audioPlayer.stateManager) {
      const state = this.audioPlayer.stateManager.getStateSnapshot();
      currentTime = state.currentTrackPosition || 0;
      duration = state.currentTrackDuration || 0;
    } else {
      console.warn('[AudioPlayerUI] StateManager not available for updateTimeDisplay');
      return;
    }
    
    // Ensure values are valid numbers
    currentTime = isFinite(currentTime) ? Math.max(0, currentTime) : 0;
    duration = isFinite(duration) ? Math.max(0, duration) : 0;
    
    // Format time display
    const timeText = `${this.formatTime(currentTime)} / ${this.formatTime(duration)}`;
    this.timeDisplay.textContent = timeText;
    
    // Update seek bar position
    if (duration > 0) {
      const seekValue = (currentTime / duration) * 100;
      if (isFinite(seekValue) && seekValue >= 0 && seekValue <= 100) {
        this.seekBar.value = seekValue;
      }
    } else {
      // Reset seek bar when no duration
      this.seekBar.value = 0;
    }
    window.uiManager?.refreshRangeFillStyling?.(this.seekBar);
    
    // Force UI update by triggering a reflow
    this.seekBar.style.display = 'none';
    this.seekBar.offsetHeight; // Force reflow
    this.seekBar.style.display = '';
  }

  /**
   * Format time in seconds to MM:SS format
   */
  formatTime(time) {
    if (isNaN(time)) return '00:00';
    
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Start interval for updating time display
   */
  startUpdateInterval() {
    // Clear any existing interval
    this.stopUpdateInterval();
    
    if (!this.canRunPlayerUi()) return;
    // Update every 250ms
    this.updateInterval = setInterval(() => {
      if (!this.canRunPlayerUi()) {
        this.refreshPowerUiScheduling();
        return;
      }
      this.audioPlayer.audioManager?.incrementPowerDiagnostic?.('playerUiTicks');
      this.updateTimeDisplay();
    }, 250);
  }

  /**
   * Stop time display update interval
   */
  stopUpdateInterval() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Remove player UI from DOM
   */
  removeUI() {
    this.isDisposed = true;
    this.stopUpdateInterval();
    if (this.positionRaf !== null) {
      cancelAnimationFrame(this.positionRaf);
      this.positionRaf = null;
    }
    this.documentRef?.removeEventListener?.('visibilitychange', this.onVisibilityChange);
    this.closeLibraryContextMenu();
    this.removeStateListeners();
    
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    
    this.container = null;
    this.trackNameDisplay = null;
    this.seekBar = null;
    this.timeDisplay = null;
    this.playPauseButton = null;
    this.stopButton = null;
    this.prevButton = null;
    this.nextButton = null;
    this.repeatButton = null;
    this.shuffleButton = null;
    this.closeButton = null;
    this.artworkImage = null;
    this.playlistDisplay = null;
    window.uiManager?.mobileNav?.updatePlayerPlaceholder?.();
  }

  t(key, params = {}) {
    const text = window.uiManager?.t ? window.uiManager.t(key, params) : key;
    if (text !== key) return text;
    const fallback = {
      'library.action.showInLibrary': 'Show in Library',
      'library.action.goToAlbum': 'Go to Album',
      'library.action.goToArtist': 'Go to Artist',
      'library.action.addToPlaylist': 'Add to Playlist',
      'library.action.saveQueueAsPlaylist': 'Save Queue as Playlist',
      'library.action.newPlaylist': 'New Playlist',
      'library.prompt.playlistName': 'Playlist name',
      'library.prompt.queuePlaylistName': 'Queue',
      'library.action.cancel': 'Cancel',
      'library.queue.previousPage': 'Previous queue page',
      'library.queue.nextPage': 'Next queue page',
      'library.queue.trackNumber': `Track ${params.number ?? ''}`,
      'library.state.ok': 'OK',
      'library.state.noResolvedTracks': 'There are no available library tracks.'
    };
    return fallback[key] || String(key).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clampMenuToViewport(menu) {
  const rect = menu.getBoundingClientRect?.();
  if (!rect || typeof window === 'undefined') return;
  const margin = 8;
  if (rect.right > window.innerWidth - margin) {
    menu.style.left = `${Math.max(margin, window.innerWidth - rect.width - margin)}px`;
  }
  if (rect.bottom > window.innerHeight - margin) {
    menu.style.top = `${Math.max(margin, window.innerHeight - rect.height - margin)}px`;
  }
}

function hasLibraryTrackDrag(dataTransfer) {
  return Array.from(dataTransfer?.types || []).includes('application/x-effetune-library-tracks');
}

function getLibraryTrackDragIds(dataTransfer) {
  try {
    const raw = dataTransfer?.getData?.('application/x-effetune-library-tracks');
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch (_) {
    return [];
  }
}
