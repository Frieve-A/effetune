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
    this.updateInterval = null;
    
    // State change listeners
    this.stateListeners = [];
    
    // Initialize state monitoring
    this.initStateMonitoring();
  }
  
  /**
   * Initialize state monitoring for automatic UI updates
   */
  initStateMonitoring() {
    if (!this.audioPlayer.stateManager) return;
    
    // Listen to all state changes
    this.audioPlayer.stateManager.addListener('*', (newValue, key, source) => {
      this.handleStateChange(key, newValue, source);
    });
    
    // Listen to specific state changes
    this.audioPlayer.stateManager.addListener('currentTrack', (track) => {
      this.updateTrackDisplay(track);
    });

    this.audioPlayer.stateManager.addListener('currentTrackName', () => {
      this.updateTrackDisplay();
    });

    this.audioPlayer.stateManager.addListener('artworkUrl', (artworkUrl) => {
      this.updateArtwork(artworkUrl);
    });

    this.audioPlayer.stateManager.addListener('playlist', () => {
      this.updatePlaylistDisplay();
    });

    this.audioPlayer.stateManager.addListener('currentTrackIndex', () => {
      this.updatePlaylistDisplay();
    });
    
    this.audioPlayer.stateManager.addListener('currentTrackPosition', (position) => {
      requestAnimationFrame(() => {
        this.updateTimeDisplay();
      });
    });
    
    this.audioPlayer.stateManager.addListener('currentTrackDuration', (duration) => {
      this.updateTimeDisplay();
    });
    
    this.audioPlayer.stateManager.addListener('isPlaying', (isPlaying) => {
      this.updatePlayPauseButton();
    });
    
    this.audioPlayer.stateManager.addListener('isPaused', (isPaused) => {
      this.updatePlayPauseButton();
    });
    
    this.audioPlayer.stateManager.addListener('isStopped', (isStopped) => {
      this.updateTimeDisplay();
      this.updatePlayPauseButton();
    });
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
     </div>
     <div class="track-name-container">
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
      </div>
      <div class="player-playlist" aria-label="Playlist"></div>
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

    // Add event listeners
    this.playPauseButton.addEventListener('click', () => {
      this.audioPlayer.togglePlayPause();
    });
    this.stopButton.addEventListener('click', () => this.audioPlayer.stop());
    this.prevButton.addEventListener('click', () => this.audioPlayer.playPrevious());
    this.nextButton.addEventListener('click', () => this.audioPlayer.playNext());
    this.closeButton.addEventListener('click', () => this.audioPlayer.close());
    
    // Add repeat button event listener
    this.repeatButton.addEventListener('click', () => this.audioPlayer.playbackManager.toggleRepeatMode());
    
    // Add shuffle button event listener
    this.shuffleButton.addEventListener('click', () => this.audioPlayer.playbackManager.toggleShuffleMode());
    
    // Update UI based on loaded state
    this.updatePlayerUIState();
    this.updateArtwork();
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
    
    // Update repeat button state
    switch (repeatMode) {
      case 'ALL':
        this.repeatButton.innerHTML = PLAYER_ICONS.repeat;
        this.repeatButton.style.backgroundColor = '#4a9eff'; // Highlight button when active
        break;
      case 'ONE':
        this.repeatButton.innerHTML = PLAYER_ICONS.repeat1;
        this.repeatButton.style.backgroundColor = '#4a9eff';
        
        // Disable shuffle button in ONE mode
        this.shuffleButton.disabled = true;
        this.shuffleButton.style.opacity = '0.5';
        break;
      case 'OFF':
      default:
        this.repeatButton.innerHTML = PLAYER_ICONS.repeat;
        this.repeatButton.style.backgroundColor = ''; // Reset button color
        
        // Enable shuffle button
        this.shuffleButton.disabled = false;
        this.shuffleButton.style.opacity = '1';
        break;
    }
    
    // Update shuffle button state
    if (shuffleMode && repeatMode !== 'ONE') {
      this.shuffleButton.style.backgroundColor = '#4a9eff'; // Highlight button when active
    } else {
      this.shuffleButton.style.backgroundColor = ''; // Reset button color
    }
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
      this.trackNameDisplay.textContent = track.name;
    } else {
      this.trackNameDisplay.textContent = 'No track loaded';
    }
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
      artworkContainer.style.display = artworkUrl || keepMobilePlaceholder ? '' : 'none';
    }
  }

  updatePlaylistDisplay() {
    if (!this.playlistDisplay || !this.audioPlayer.stateManager) return;

    const state = this.audioPlayer.stateManager.getStateSnapshot();
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
      item.textContent = track?.name || `Track ${index + 1}`;
      item.addEventListener('click', async () => {
        const latestState = this.audioPlayer.stateManager?.getStateSnapshot?.();
        this.audioPlayer.stateManager?.updateState?.({
          currentTrackIndex: index,
          currentTrack: track
        }, 'AudioPlayerUI playlist select');
        await this.audioPlayer.loadTrack(index);
        if (latestState?.isPlaying || window.uiManager?.layoutMode?.isMobile) {
          await this.audioPlayer.play();
        }
      });
      this.playlistDisplay.appendChild(item);
    });
  }

  /**
   * Update time display and seek bar
   */
  updateTimeDisplay() {
    if (!this.timeDisplay || !this.seekBar) {
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
    
    // Update every 250ms
    this.updateInterval = setInterval(() => {
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
    this.stopUpdateInterval();
    
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
}
