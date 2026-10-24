import { MAX_QUEUE_LENGTH } from '../ui/audio-player/openhome-playback-adapter.js';

export class NetworkMusicController {
  constructor({ api, uiManager }) {
    this.api = api;
    this.uiManager = uiManager;
    this.state = { libraries: [], players: [], sharing: { enabled: false, folderIds: [], folders: [] } };
    this.selectedLibraryId = 'local';
    this.selectedPlayerId = 'local';
    this.libraryLocations = new Map();
    this.playerStates = new Map();
    this.listeners = new Set();
    this.playerGeneration = 0;
    this.libraryGeneration = 0;
    this.disposed = false;
  }

  get selectedPlayer() {
    return this.state.players.find(player => player.id === this.selectedPlayerId) ??
      this.lastSelectedPlayer ?? null;
  }

  get queueTracksMax() {
    return Math.min(this.state.queueTracksMax ?? MAX_QUEUE_LENGTH, MAX_QUEUE_LENGTH);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    if (!this.disposed) for (const listener of this.listeners) listener(this);
  }

  async initialize() {
    this.unsubscribe = this.api.onNetworkMusicState?.(state => this.applyState(state));
    this.applyState(await this.api.networkMusicGetState());
    await this.discover();
    this.timer = setInterval(() => { void this.refreshPlayer(); }, 2000);
    this.timer.unref?.();
  }

  applyState(state) {
    if (this.disposed || !state) return;
    this.state = state;
    this.emit();
  }

  async discover() {
    this.applyState(await this.api.networkMusicDiscover());
    await this.refreshPlayer();
  }

  selectLibrary(id) {
    this.selectedLibraryId = id;
    this.libraryGeneration += 1;
    this.emit();
  }

  selectPlayer(id) {
    this.selectedPlayerId = id;
    this.lastSelectedPlayer = id === 'local' ? null : this.state.players.find(player => player.id === id);
    this.playerGeneration += 1;
    this.emit();
    this.uiManager.refreshApplicationMenu?.();
    void this.refreshPlayer();
  }

  async refreshPlayer() {
    const id = this.selectedPlayerId;
    const generation = this.playerGeneration;
    if (id === 'local' || this.disposed) return;
    if (this.refreshingPlayer === generation) return;
    this.refreshingPlayer = generation;
    try {
      const state = await this.api.networkMusicGetPlayerState({ playerId: id });
      if (!this.disposed && generation === this.playerGeneration) {
        this.playerStates.set(id, { ...state, available: true });
        this.emit();
      }
    } catch (error) {
      console.warn('Network player state is unavailable:', error);
      if (!this.disposed && generation === this.playerGeneration) {
        this.playerStates.set(id, { ...this.playerStates.get(id), available: false });
        this.emit();
      }
    } finally {
      if (this.refreshingPlayer === generation) this.refreshingPlayer = null;
    }
  }

  async command(action, args = {}, playerId = this.selectedPlayerId) {
    if (playerId === 'local') throw new Error('Network commands require an external player');
    const generation = this.playerGeneration;
    const result = await this.api.networkMusicPlayerCommand({ ...args, playerId, action,
      ...(this.api.isPwa ? { isCurrent: () => playerId === this.selectedPlayerId && generation === this.playerGeneration && !this.disposed } : {}) });
    if (playerId === this.selectedPlayerId) {
      await this.refreshPlayer();
      if (['play', 'replace', 'insert', 'seekId'].includes(action)) await this.uiManager.networkMusicView?.showPlayer();
    }
    return result;
  }

  async playSelection(request) {
    const playerId = this.selectedPlayerId;
    try {
      const receipt = await this.api.networkMusicPlaySelection({ ...request, playerId });
      if (playerId === this.selectedPlayerId) {
        await this.refreshPlayer();
        await this.uiManager.networkMusicView?.showPlayer();
      }
      return receipt;
    } catch (error) {
      console.error('Network library playback failed:', error);
      error.networkMusic = true;
      throw error;
    }
  }

  async playFiles(files, playerId = this.selectedPlayerId) {
    if (files.some(file => file?.kind === 'cue' || file?.sourceKind === 'cue-track' || file?.startFrame != null || file?.endFrame != null)) {
      this.uiManager.setError('networkMusic.cueUnsupported', true);
      return false;
    }
    try {
      const filePaths = files.map(file => typeof file === 'string' ? file : file.path);
      await this.api.networkMusicPlayFiles({ playerId, filePaths, operationKind: 'play' });
      if (playerId === this.selectedPlayerId) {
        await this.refreshPlayer();
        await this.uiManager.networkMusicView?.showPlayer();
      }
      return true;
    } catch (error) {
      console.error('Network music file playback failed:', error);
      this.reportError(error);
      return false;
    }
  }

  errorKey(error) {
    if (this.api.isPwa && error?.code === 'sharingRequired') return 'networkMusic.pwa.notShared';
    return {
      queueFull: 'networkMusic.queueFull', queueTooLarge: 'networkMusic.queueFull',
      cueUnsupported: 'networkMusic.cueUnsupported', unsupportedFormat: 'networkMusic.unsupported',
      sharingRequired: 'networkMusic.sharingRequired', folderNotShared: 'networkMusic.folderNotShared',
      libraryRequired: 'networkMusic.libraryRequired', registrationExpired: 'networkMusic.pwa.registrationExpired',
      connectionFailed: 'networkMusic.pwa.connectionFailed'
    }[error?.code] ?? 'networkMusic.error';
  }

  reportError(error) {
    this.uiManager.setError(this.errorKey(error), true);
  }

  async playItems(items, operationKind = 'play', startIndex = 0) {
    const playerId = this.selectedPlayerId;
    const generation = this.playerGeneration;
    if (playerId !== 'local') {
      return this.command(operationKind === 'play' ? 'replace' : 'insert', {
        items, position: operationKind === 'playNext' ? 'afterCurrent' : 'end', play: operationKind === 'play',
        ...(operationKind === 'play' ? { startIndex } : {})
      });
    }
    this.uiManager.beginPlaybackSelectionGestureResume?.();
    if (this.api.playLocalItems) return this.api.playLocalItems({ items, uiManager: this.uiManager, operationKind, startIndex,
      isCurrent: () => generation === this.playerGeneration && !this.disposed });
    const tracks = await Promise.all(items.map(item => this.api.networkMusicResolveTrack({ ...item, localPlayback: true })));
    // A delayed source resolution must never start playback after its target has changed.
    if (generation !== this.playerGeneration || this.disposed) return;
    const player = this.uiManager.audioPlayer ?? await this.uiManager.createAudioPlayer([], false);
    if (generation !== this.playerGeneration || this.disposed) return;
    return player.activateOpenHomePlaybackAdapter().playNetworkTracks(tracks, operationKind,
      () => generation === this.playerGeneration && !this.disposed, startIndex);
  }

  canPlayItem(item) {
    if (item.playable === false) return false;
    if (this.api.canPlayItem && !this.api.canPlayItem(item, this.selectedPlayerId)) return false;
    const supported = this.playerStates.get(this.selectedPlayerId)?.protocolInfo;
    if (this.selectedPlayerId === 'local' || !supported) return true;
    const mimeTypes = (item.resources ?? []).map(resource => resource.protocolInfo?.split(':')[2]?.toLowerCase()).filter(Boolean);
    if (!mimeTypes.length) return true;
    return supported.split(',').some(protocol => {
      const mime = protocol.trim().split(':')[2]?.toLowerCase();
      return mime === '*' || mimeTypes.includes(mime);
    });
  }

  dispose() {
    this.disposed = true;
    this.playerGeneration += 1;
    this.libraryGeneration += 1;
    clearInterval(this.timer);
    this.unsubscribe?.();
    this.api.dispose?.();
    this.listeners.clear();
  }
}
