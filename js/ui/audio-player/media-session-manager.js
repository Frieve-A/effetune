const MEDIA_SESSION_ACTIONS = [
  'play',
  'pause',
  'stop',
  'previoustrack',
  'nexttrack',
  'seekbackward',
  'seekforward',
  'seekto'
];

function getDefaultNavigator() {
  return typeof navigator !== 'undefined' ? navigator : null;
}

function getDefaultMediaMetadata() {
  return typeof MediaMetadata !== 'undefined' ? MediaMetadata : null;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isFinitePositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

export class MediaSessionManager {
  constructor(audioPlayer, {
    navigatorRef = getDefaultNavigator(),
    mediaMetadataCtor = getDefaultMediaMetadata(),
    now = () => Date.now()
  } = {}) {
    this.audioPlayer = audioPlayer;
    this.navigatorRef = navigatorRef;
    this.MediaMetadataCtor = mediaMetadataCtor;
    this.now = now;
    this.disposed = false;
    this.metadataOverride = null;
    this.lastTrackReference = null;
    this.lastMetadataKey = '';
    this.hasSessionMetadata = false;
    this.lastPlaybackState = '';
    this.lastPositionState = null;
    this.lastPositionUpdateTime = 0;
    this.positionStateBlockedForTrackChange = false;
    this.registeredActions = new Set();
    this.stateListener = (_value, key) => this.syncFromState(false, key);

    this.audioPlayer?.stateManager?.addListener?.('*', this.stateListener);
    this.setupActionHandlers();
    this.syncFromState(true);
  }

  get session() {
    return this.navigatorRef?.mediaSession || null;
  }

  updateMetadataFromTags(title, artist, album, artworkUrl = '') {
    this.metadataOverride = {
      title: normalizeText(title),
      artist: normalizeText(artist),
      album: normalizeText(album),
      artworkUrl: normalizeText(artworkUrl)
    };
    this.lastMetadataKey = '';
    this.syncFromState(true);
  }

  setupActionHandlers() {
    const session = this.session;
    if (!session?.setActionHandler || this.disposed) return;

    this.setActionHandler(session, 'play', () => {
      return this.runPlayerCommand(() => this.audioPlayer?.play?.());
    });
    this.setActionHandler(session, 'pause', () => {
      return this.runPlayerCommand(() => this.audioPlayer?.pause?.());
    });
    this.setActionHandler(session, 'stop', () => {
      return this.runPlayerCommand(() => this.audioPlayer?.stop?.());
    });
    this.setActionHandler(session, 'previoustrack', () => {
      return this.runPlayerCommand(() => this.audioPlayer?.playPrevious?.());
    });
    this.setActionHandler(session, 'nexttrack', () => {
      return this.runPlayerCommand(() => this.audioPlayer?.playNext?.());
    });
    this.setActionHandler(session, 'seekbackward', (details = {}) => {
      return this.seekBy(-(Number(details.seekOffset) || 10));
    });
    this.setActionHandler(session, 'seekforward', (details = {}) => {
      return this.seekBy(Number(details.seekOffset) || 10);
    });
    this.setActionHandler(session, 'seekto', (details = {}) => {
      if (Number.isFinite(details.seekTime)) {
        this.audioPlayer?.resumeAudioContextInGesture?.();
        return this.runPlayerCommand(() => this.audioPlayer?.contextManager?.seek?.(details.seekTime));
      }
      return undefined;
    });
  }

  setActionHandler(session, action, handler) {
    try {
      session.setActionHandler(action, handler);
      if (handler) {
        this.registeredActions.add(action);
      } else {
        this.registeredActions.delete(action);
      }
    } catch (_) {
      this.registeredActions.delete(action);
    }
  }

  runPlayerCommand(command) {
    try {
      const result = command?.();
      if (result?.then) {
        return Promise.resolve(result)
          .catch(() => {})
          .finally(() => this.syncFromState(true));
      }
      this.syncFromState(true);
      return result;
    } catch (_) {
      this.syncFromState(true);
      return undefined;
    }
  }

  seekBy(offsetSeconds) {
    const state = this.getState();
    const position = Number(state.currentTrackPosition) || 0;
    this.audioPlayer?.resumeAudioContextInGesture?.();
    return this.runPlayerCommand(() => this.audioPlayer?.contextManager?.seek?.(position + offsetSeconds));
  }

  getState() {
    return this.audioPlayer?.stateManager?.getStateSnapshot?.() || {};
  }

  syncFromState(force = false, changedKey = '') {
    if (this.disposed) return;
    const session = this.session;
    if (!session) return;

    const state = this.getState();
    const trackChanged = this.clearTrackScopedOverridesIfNeeded(session, state);
    this.syncMetadata(session, state, force);
    this.syncPlaybackState(session, state, force);
    if (trackChanged) {
      this.positionStateBlockedForTrackChange = true;
    }
    if (this.shouldDelayPositionStateAfterTrackChange(state, changedKey, force)) return;
    this.syncPositionState(session, state, force, changedKey);
  }

  clearTrackScopedOverridesIfNeeded(session, state) {
    const currentTrack = state.currentTrack || null;
    if (currentTrack === this.lastTrackReference) return;
    const hadPreviousPositionScope = !!this.lastTrackReference || !!this.lastPositionState;
    if (hadPreviousPositionScope) {
      this.clearPositionState(session, true);
    }
    this.lastTrackReference = currentTrack;
    this.metadataOverride = null;
    this.lastMetadataKey = '';
    this.lastPositionState = null;
    return hadPreviousPositionScope;
  }

  shouldDelayPositionStateAfterTrackChange(state, changedKey, force) {
    if (!this.positionStateBlockedForTrackChange) return false;
    if (state.isStopped) {
      this.positionStateBlockedForTrackChange = false;
      return false;
    }

    const duration = Number(state.currentTrackDuration);
    const position = state.isStopped ? 0 : Number(state.currentTrackPosition) || 0;
    if (!isFinitePositiveNumber(duration)) {
      this.positionStateBlockedForTrackChange = false;
      return false;
    }

    const hasFreshZeroPosition = position === 0 &&
      (force || changedKey === 'currentTrackDuration');
    if (hasFreshZeroPosition) {
      this.positionStateBlockedForTrackChange = false;
      return false;
    }

    return true;
  }

  syncMetadata(session, state, force) {
    const metadata = this.buildMetadata(state);
    if (!metadata) {
      this.clearMetadata(session, true);
      return;
    }
    if (!this.MediaMetadataCtor) {
      this.clearMetadata(session, true);
      return;
    }

    const metadataKey = JSON.stringify(metadata);
    if (!force && metadataKey === this.lastMetadataKey) return;

    try {
      session.metadata = new this.MediaMetadataCtor(metadata);
      this.lastMetadataKey = metadataKey;
      this.hasSessionMetadata = true;
    } catch (_) {
      this.clearMetadata(session, true);
    }
  }

  buildMetadata(state) {
    const track = state.currentTrack || null;
    const trackMeta = track?.meta || {};
    const override = this.metadataOverride || {};
    const title = normalizeText(override.title) ||
      normalizeText(trackMeta.title) ||
      normalizeText(state.currentTrackName) ||
      normalizeText(track?.name);

    if (!title) return null;

    const metadata = {
      title,
      artist: normalizeText(override.artist) || normalizeText(trackMeta.artist),
      album: normalizeText(override.album) || normalizeText(trackMeta.album)
    };
    const artworkUrl = normalizeText(override.artworkUrl) ||
      normalizeText(state.artworkUrl) ||
      normalizeText(trackMeta.artworkUrl);
    if (artworkUrl) {
      metadata.artwork = [{ src: artworkUrl }];
    }

    return metadata;
  }

  clearMetadata(session, force = false) {
    if (!force && !this.lastMetadataKey && !this.hasSessionMetadata) return;
    try {
      session.metadata = null;
    } catch (_) {
      // Ignore platforms that expose metadata as read-only.
    }
    this.lastMetadataKey = '';
    this.hasSessionMetadata = false;
  }

  syncPlaybackState(session, state, force) {
    const playbackState = this.getPlaybackState(state);
    if (!force && playbackState === this.lastPlaybackState) return;

    try {
      session.playbackState = playbackState;
      this.lastPlaybackState = playbackState;
    } catch (_) {
      this.lastPlaybackState = '';
    }
  }

  getPlaybackState(state) {
    if (state.isStopped) return 'none';
    if (state.isPlaying) return 'playing';
    if (state.isPaused) return 'paused';
    return 'none';
  }

  syncPositionState(session, state, force, changedKey) {
    if (typeof session.setPositionState !== 'function') return;

    if (state.isStopped) {
      this.clearPositionState(session);
      return;
    }

    const duration = Number(state.currentTrackDuration);
    if (!isFinitePositiveNumber(duration)) {
      this.clearPositionState(session);
      return;
    }

    const rawPosition = Number(state.currentTrackPosition) || 0;
    const position = Math.max(0, Math.min(rawPosition, duration));
    const nextState = {
      duration,
      playbackRate: 1,
      position
    };

    const lastState = this.lastPositionState;
    const positionDelta = lastState ? Math.abs(lastState.position - position) : Infinity;
    const now = this.now();
    const isPositionOnlyUpdate = changedKey === 'currentTrackPosition';
    if (!force &&
      isPositionOnlyUpdate &&
      positionDelta < 1 &&
      now - this.lastPositionUpdateTime < 1000) {
      return;
    }
    if (!force &&
      lastState &&
      lastState.duration === nextState.duration &&
      lastState.playbackRate === nextState.playbackRate &&
      lastState.position === nextState.position) {
      return;
    }

    try {
      session.setPositionState(nextState);
      this.lastPositionState = nextState;
      this.lastPositionUpdateTime = now;
    } catch (_) {
      this.lastPositionState = null;
    }
  }

  clearPositionState(session, force = false) {
    if (!force && !this.lastPositionState) return;
    try {
      session.setPositionState({});
    } catch (_) {
      // Ignore platforms that do not support clearing position state.
    }
    this.lastPositionState = null;
  }

  clearActionHandlers() {
    const session = this.session;
    if (!session?.setActionHandler) return;
    const actions = new Set([...MEDIA_SESSION_ACTIONS, ...this.registeredActions]);
    for (const action of actions) {
      this.setActionHandler(session, action, null);
    }
  }

  clearSession() {
    const session = this.session;
    if (!session) return;
    this.clearActionHandlers();
    this.clearPositionState(session);
    this.clearMetadata(session);
    try {
      session.playbackState = 'none';
    } catch (_) {
      // Ignore platforms that reject explicit playback state updates.
    }
    this.lastPlaybackState = 'none';
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.audioPlayer?.stateManager?.removeListener?.('*', this.stateListener);
    this.clearSession();
    this.audioPlayer = null;
  }
}
