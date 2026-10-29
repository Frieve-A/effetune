import { StateManager } from '../ui/audio-player/state-manager.js';

// Presentation and commands for the selected destination. The local AudioPlayer
// remains the owner of the audio engine and the incoming OpenHome service.
export class NetworkPlaybackAdapter {
  constructor(controller, playerId, ui) {
    this.controller = controller;
    this.playerId = playerId;
    this.ui = ui;
    this.isRemote = true;
    this.stateManager = new StateManager(this);
    this.contextManager = {
      getCurrentState: () => this.stateManager.getStateSnapshot(),
      getCurrentPlaybackTime: () => this.getCurrentPlaybackTime(),
      seek: value => this.seek(value)
    };
    this.playbackManager = {
      runPlaybackCommand: command => this.run(command),
      toggleRepeatMode: () => this.command('repeat', { value: !this.remoteState?.repeat }),
      toggleShuffleMode: () => this.command('shuffle', { value: !this.remoteState?.shuffle }),
      selectQueueOrdinal: ordinal => this.command('seekId', { id: this.remoteState?.queue?.[ordinal]?.id }),
      removeQueueEntry: track => this.command('delete', { id: track.id }),
      clearQueue: () => this.command('clear')
    };
    this.sync();
  }

  command(action, args = {}) {
    return this.run(() => this.controller.command(action, args, this.playerId));
  }

  run(command) {
    return Promise.resolve().then(command).catch(error => {
      console.error('Network player command failed:', error);
      this.controller.reportError(error);
      return false;
    });
  }

  togglePlayPause() { return this.command(this.remoteState?.transportState === 'Playing' ? 'pause' : 'play'); }
  pause() { return this.command('pause'); }
  stop() { return this.command('stop'); }
  playPrevious() { return this.command('previous'); }
  playNext() { return this.command('next'); }
  seek(value) {
    const seconds = Number(value);
    this.pendingSeek = {
      seconds: Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0,
      trackId: this.remoteState?.currentId
    };
    this.sync();
    if (!this.seekCommand) {
      this.seekCommand = this.run(async () => {
        try {
          // Keep the latest destination visible through the command's fresh-state read.
          while (this.pendingSeek) {
            const seek = this.pendingSeek;
            await this.controller.command('seek', { seconds: seek.seconds }, this.playerId);
            if (this.pendingSeek === seek) this.pendingSeek = null;
          }
        } finally {
          this.pendingSeek = null;
          this.seekCommand = null;
          this.sync();
        }
      });
    }
    return this.seekCommand;
  }
  setVolume(value) {
    this.pendingVolume = value;
    this.sync();
    if (!this.volumeCommand) {
      this.volumeCommand = this.run(async () => {
        try {
          // Serialize writes and coalesce intermediate inputs while keeping the
          // latest requested value visible until its fresh state is received.
          while (this.pendingVolume !== undefined) {
            const volume = this.pendingVolume;
            await this.controller.command('volume', { value: volume }, this.playerId);
            if (this.pendingVolume === volume) this.pendingVolume = undefined;
          }
        } finally {
          this.pendingVolume = undefined;
          this.volumeCommand = null;
          this.sync();
        }
      });
    }
    return this.volumeCommand;
  }
  setMute(value) { return this.command('mute', { value }); }
  close() { this.ui.removeUI(); }

  getCurrentPlaybackTime() {
    if (this.pendingSeek) return this.pendingSeek.seconds;
    const state = this.stateManager.getStateSnapshot();
    const elapsed = state.isPlaying ? Math.max(0, performance.now() - this.positionReceivedAt) / 1000 : 0;
    const position = state.currentTrackPosition + elapsed;
    return state.currentTrackDuration > 0 ? Math.min(position, state.currentTrackDuration) : position;
  }

  sync() {
    const remote = this.controller.playerStates.get(this.playerId);
    if (this.pendingSeek && (remote?.available === false || remote?.currentId !== this.pendingSeek.trackId)) {
      this.pendingSeek = null;
    }
    const previous = this.stateManager.getStateSnapshot();
    // Re-rendering the same snapshot must not restart the interpolation clock.
    if (remote !== this.remoteState || remote?.position !== previous.currentTrackPosition ||
        remote?.transportState !== this.positionTransport || remote?.currentId !== this.positionTrackId) {
      this.positionReceivedAt = remote?.positionReceivedAt ?? performance.now();
      this.positionTransport = remote?.transportState;
      this.positionTrackId = remote?.currentId;
    }
    this.remoteState = remote;
    const queue = remote?.queue ?? [];
    const signature = JSON.stringify(queue);
    if (signature !== this.queueSignature) {
      this.queueSignature = signature;
      this.playlist = queue.map(track => ({ ...track, name: track.title || 'Untitled' }));
    }
    const currentTrackIndex = queue.findIndex(track => track.id === remote?.currentId);
    const currentTrack = this.playlist[currentTrackIndex] ?? null;
    let artworkUrl = '';
    try {
      const url = new URL(currentTrack?.artwork);
      if (url.protocol === 'http:' || url.protocol === 'https:') artworkUrl = url.href;
    } catch { /* Missing or invalid artwork uses the existing placeholder. */ }
    const available = remote?.available === true;
    const playing = available && remote.transportState === 'Playing';
    const paused = available && remote.transportState === 'Paused';
    const updates = {
      playlist: this.playlist,
      playlistLength: queue.length,
      currentTrackIndex,
      currentTrack,
      currentTrackName: currentTrack ? [currentTrack.artist, currentTrack.title].filter(Boolean).join(' - ') :
        !remote ? 'Connecting' : !available ? 'Unavailable' : '',
      currentTrackDuration: remote?.duration || 0,
      currentTrackPosition: this.pendingSeek?.seconds ?? remote?.position ?? 0,
      artworkUrl,
      isPlaying: playing,
      isPaused: paused,
      isStopped: !playing && !paused,
      repeatMode: remote?.repeat ? 'ALL' : 'OFF',
      shuffleMode: remote?.shuffle === true,
      controlsEnabled: available,
      seekBarEnabled: available && remote?.capabilities?.seek === true && remote?.duration > 0,
      volume: this.pendingVolume ?? remote?.volume ?? 0,
      volumeMax: remote?.volumeMax ?? 100,
      volumeStep: remote?.volumeStep ?? 1,
      mute: remote?.mute === true,
      transportCapabilities: remote?.capabilities ?? {}
    };
    this.stateManager.updateState(Object.fromEntries(Object.entries(updates).filter(([key, value]) => previous[key] !== value)), 'network_player');
  }
}
