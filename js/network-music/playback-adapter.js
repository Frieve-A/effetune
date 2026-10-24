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
      getCurrentPlaybackTime: () => this.stateManager.getStateSnapshot().currentTrackPosition,
      seek: value => {
        const seconds = Number(value);
        return this.command('seek', { seconds: Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0 });
      }
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
  setVolume(value) { return this.command('volume', { value }); }
  close() { this.ui.removeUI(); }

  sync() {
    const remote = this.controller.playerStates.get(this.playerId);
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
      currentTrackPosition: remote?.position || 0,
      artworkUrl,
      isPlaying: playing,
      isPaused: paused,
      isStopped: !playing && !paused,
      repeatMode: remote?.repeat ? 'ALL' : 'OFF',
      shuffleMode: remote?.shuffle === true,
      controlsEnabled: available,
      seekBarEnabled: available && remote?.capabilities?.seek === true && remote?.duration > 0,
      volume: remote?.volume ?? 0,
      volumeMax: remote?.volumeMax ?? 100,
      transportCapabilities: remote?.capabilities ?? {}
    };
    const previous = this.stateManager.getStateSnapshot();
    this.stateManager.updateState(Object.fromEntries(Object.entries(updates).filter(([key, value]) => previous[key] !== value)), 'network_player');
  }
}
