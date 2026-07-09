const OFFLINE_NOTIFICATION_CLEAR_DELAY_MS = 3000;

export class PlaybackBridge {
  constructor({ index, source, uiManager, getFolders }) {
    this.index = index;
    this.source = source;
    this.uiManager = uiManager;
    this.getFolders = getFolders;
    this.lastSnapshot = null;
    this.offlineNotificationClearTimer = null;
  }

  async playTracks(trackIds, { startIndex = null, shuffle = false } = {}) {
    let entries = this.createQueueEntries(trackIds);
    this.notifyOfflineExcluded(this.countOfflineExcluded(trackIds, entries));
    const requestedStartIndex = resolveStartIndex(trackIds, entries, startIndex);
    const shouldPreserveRequestedTrack = requestedStartIndex !== null;
    if (shuffle) {
      entries = shuffleEntries(entries, requestedStartIndex);
      startIndex = 0;
    } else {
      startIndex = requestedStartIndex ?? 0;
    }
    if (entries.length === 0) return;
    this.captureSnapshot();
    const player = this.uiManager.createAudioPlayer([], true);
    if (player?.stateManager) {
      const requestedTrackId = shouldPreserveRequestedTrack
        ? (entries[startIndex]?.libraryTrackId ?? null)
        : null;
      if (player.stateRestored) {
        // Wait for persisted repeat/shuffle state (async IPC on Electron) so
        // loadFiles applies the restored shuffle mode to the new queue.
        await player.stateRestored;
      }
      player.playbackManager.loadFiles(entries, false);
      if (!player.ui.container) {
        player.ui.createPlayerUI();
      }
      // loadFiles reshuffles a replaced queue when the player's persisted shuffle
      // mode is on; re-locate the requested track so the clicked track still plays.
      const playlist = player.playbackManager.playlist;
      const loadedIndex = requestedTrackId
        ? playlist.findIndex(track => track.libraryTrackId === requestedTrackId)
        : -1;
      if (loadedIndex >= 0) {
        startIndex = loadedIndex;
      }
      player.stateManager.updatePlaylist(playlist, startIndex);
      player.stateManager.updateState({ currentTrackIndex: startIndex }, 'Library playback start index');
      const loaded = await player.loadTrack(startIndex);
      const stateAfterLoad = player.stateManager.getStateSnapshot?.() || {};
      if (loaded !== false && !stateAfterLoad.isPaused) {
        await player.play();
      }
    }
  }

  async playNext(trackIds) {
    const entries = this.createQueueEntries(trackIds);
    const player = this.uiManager.audioPlayer;
    if (!player || entries.length === 0) {
      await this.playTracks(trackIds);
      return;
    }
    this.notifyOfflineExcluded(this.countOfflineExcluded(trackIds, entries));
    const currentIndex = player.stateManager?.getCurrentTrackIndex?.() ?? 0;
    player.playbackManager.loadFiles(entries, true, currentIndex + 1);
  }

  async addToQueue(trackIds) {
    const entries = this.createQueueEntries(trackIds);
    const player = this.uiManager.audioPlayer;
    if (!player || entries.length === 0) {
      await this.playTracks(trackIds);
      return;
    }
    this.notifyOfflineExcluded(this.countOfflineExcluded(trackIds, entries));
    player.playbackManager.loadFiles(entries, true);
  }

  countOfflineExcluded(trackIds, entries) {
    return this.index.getTracksByIds(trackIds).length - entries.length;
  }

  notifyOfflineExcluded(count) {
    if (count <= 0 || typeof this.uiManager?.setError !== 'function') return;
    this.uiManager.setError('status.libraryTracksSkippedOffline', false, { count });
    this.scheduleOfflineNotificationClear();
  }

  scheduleOfflineNotificationClear() {
    if (this.offlineNotificationClearTimer !== null && typeof clearTimeout === 'function') {
      clearTimeout(this.offlineNotificationClearTimer);
    }
    if (typeof setTimeout !== 'function' || typeof this.uiManager?.clearError !== 'function') {
      this.offlineNotificationClearTimer = null;
      return;
    }

    const expectedText = this.getCurrentStatusText();
    const timer = setTimeout(() => {
      if (this.offlineNotificationClearTimer !== timer) return;
      this.offlineNotificationClearTimer = null;
      if (
        expectedText !== null &&
        this.getCurrentStatusText() !== expectedText
      ) {
        return;
      }
      this.uiManager.clearError?.();
    }, OFFLINE_NOTIFICATION_CLEAR_DELAY_MS);
    this.offlineNotificationClearTimer = timer;
    this.offlineNotificationClearTimer?.unref?.();
  }

  getCurrentStatusText() {
    return this.uiManager?.stateManager?.errorDisplay?.textContent
      ?? this.uiManager?.errorDisplay?.textContent
      ?? null;
  }

  createQueueEntries(trackIds) {
    const folderById = new Map(this.getFolders().map(folder => [folder.id, folder]));
    return this.index.getTracksByIds(trackIds).filter(track => {
      const folder = folderById.get(track.folderId);
      return isPlayableFolder(folder, track);
    }).map(track => {
      const folder = folderById.get(track.folderId);
      const path = folder?.path ? `${folder.path.replace(/[\\/]+$/, '')}/${track.relativePath}` : null;
      return {
        path,
        name: track.fileName || track.title,
        file: track.file || null,
        libraryTrackId: track.id,
        meta: {
          title: track.title,
          artist: track.artist || track.albumArtist || '',
          album: track.album || '',
          durationSec: track.durationSec || null,
          artworkId: track.artworkId || null
        },
        provider: path ? undefined : async () => this.source.resolveForPlayback({ ...track, folder })
      };
    });
  }

  captureSnapshot() {
    const player = this.uiManager.audioPlayer;
    if (!player?.playbackManager) {
      this.lastSnapshot = null;
      return;
    }
    if (!player.playbackManager.playlist?.length) {
      this.lastSnapshot = null;
      return;
    }
    const state = player.stateManager?.getStateSnapshot?.() || {};
    this.lastSnapshot = {
      playlist: [...player.playbackManager.playlist],
      originalPlaylist: [...player.playbackManager.originalPlaylist],
      index: player.stateManager?.getCurrentTrackIndex?.() ?? 0,
      position: Number(state.currentTrackPosition) || 0,
      wasPlaying: Boolean(state.isPlaying && !state.isPaused && !state.isStopped)
    };
  }

  canRestoreSnapshot() {
    return Boolean(this.lastSnapshot?.playlist?.length);
  }

  async restoreLastSnapshot() {
    if (!this.canRestoreSnapshot()) return false;
    const snapshot = this.lastSnapshot;
    const player = this.uiManager.audioPlayer || this.uiManager.createAudioPlayer?.([], true);
    if (!player?.playbackManager) return false;
    // Silence the current replacement queue before swapping playlists so the
    // restored track loads from a clean, non-playing state. This stops any
    // residual source from the replacement queue and lets play() below resume
    // from the seeked position instead of restarting the buffer from 0:00.
    await player.stop?.();
    player.playbackManager.playlist = snapshot.playlist.map(track => ({ ...track }));
    player.playbackManager.originalPlaylist = snapshot.originalPlaylist.map(track => ({ ...track }));
    if (!player.ui?.container) {
      player.ui?.createPlayerUI?.();
    }
    if (player.stateManager) {
      player.stateManager.updatePlaylist(player.playbackManager.playlist, snapshot.index);
      player.stateManager.updateState?.({ currentTrackIndex: snapshot.index }, 'Library playback queue restore');
    }
    const loaded = await player.loadTrack?.(snapshot.index);
    if (loaded !== false && snapshot.position > 0) {
      // Seek while stopped to set the resume position without starting
      // playback; play() below then resumes from this position.
      await player.contextManager?.seek?.(snapshot.position);
    }
    if (snapshot.wasPlaying && loaded !== false) {
      await player.play?.();
    }
    this.lastSnapshot = null;
    return true;
  }
}

function isPlayableFolder(folder, track) {
  if (track.file) return true;
  if (!folder) return false;
  if (folder.status === 'missing' || folder.status === 'needs-permission') return false;
  return true;
}

function resolveStartIndex(trackIds, entries, startIndex) {
  if (!Number.isInteger(startIndex) || entries.length === 0) return null;
  const playableIds = new Set(entries.map(entry => entry.libraryTrackId));
  const clamped = Math.max(0, Math.min(startIndex, trackIds.length - 1));
  let mapped = 0;
  for (let i = 0; i < clamped; i++) {
    if (playableIds.has(trackIds[i])) mapped += 1;
  }
  return Math.min(mapped, entries.length - 1);
}

function shuffleEntries(entries, startIndex = null) {
  const output = [...entries];
  const first = Number.isInteger(startIndex) ? output.splice(startIndex, 1)[0] : null;
  for (let i = output.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [output[i], output[j]] = [output[j], output[i]];
  }
  return first ? [first, ...output] : output;
}
