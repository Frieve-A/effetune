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
    if (this.api.isPwa && id !== 'local' && this.selectedLibraryId === 'local') {
      const library = this.state.libraries.find(source => source.available !== false &&
        (this.api.canPlayItem?.({ serverId: source.id }, id) ?? true));
      if (library) {
        this.selectedLibraryId = library.id;
        this.libraryGeneration += 1;
      }
    }
    this.emit();
    this.uiManager.refreshApplicationMenu?.();
    void this.refreshPlayer();
  }

  async refreshPlayer(force = false) {
    const id = this.selectedPlayerId;
    const generation = this.playerGeneration;
    if (id === 'local' || this.disposed) return;
    if (this.refreshingPlayer?.generation === generation && !force) return;
    const request = { generation };
    this.refreshingPlayer = request;
    try {
      const state = await this.api.networkMusicGetPlayerState({ playerId: id });
      if (!this.disposed && generation === this.playerGeneration && this.refreshingPlayer === request) {
        this.playerStates.set(id, { ...state, available: true, positionReceivedAt: performance.now() });
        this.emit();
      }
    } catch (error) {
      console.warn('Network player state is unavailable:', error.code, error);
      if (!this.disposed && generation === this.playerGeneration && this.refreshingPlayer === request) {
        this.playerStates.set(id, { ...this.playerStates.get(id), available: false });
        this.emit();
      }
    } finally {
      if (this.refreshingPlayer === request) this.refreshingPlayer = null;
    }
  }

  async command(action, args = {}, playerId = this.selectedPlayerId, preparation = {}) {
    if (playerId === 'local') throw new Error('Network commands require an external player');
    const generation = this.playerGeneration;
    let result;
    try {
      result = await this.api.networkMusicPlayerCommand({ ...args, playerId, action,
        ...(this.api.isPwa ? { ...preparation, isCurrent: () => playerId === this.selectedPlayerId && generation === this.playerGeneration && !this.disposed && (preparation.isCurrent?.() ?? true) } : {}) });
    } catch (error) {
      if (error.outcome === 'unknown' && generation === this.playerGeneration && !this.disposed) await this.refreshPlayer(action === 'volume');
      throw error;
    }
    if (result?.accepted !== false && playerId === this.selectedPlayerId) {
      await this.refreshPlayer(action === 'volume' || action === 'seek');
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
      connectionFailed: 'networkMusic.pwa.connectionFailed',
      gatewayRequired: 'networkMusic.settings.gatewayRequired', subsonicConnection: 'networkMusic.settings.subsonicConnection',
      subsonicAuthentication: 'networkMusic.settings.subsonicAuthentication',
      forbidden: 'networkMusic.permissionDenied'
    }[error?.code] ?? 'networkMusic.error';
  }

  reportError(error) {
    this.uiManager.setError(this.errorKey(error), true);
  }

  async playItems(items, operationKind = 'play', startIndex = 0, preparation = {}) {
    const playerId = this.selectedPlayerId;
    const generation = this.playerGeneration;
    const isCurrent = () => generation === this.playerGeneration && !this.disposed && (preparation.isCurrent?.() ?? true);
    if (!isCurrent()) return { accepted: false };
    if (playerId !== 'local') {
      if (!this.api.isPwa) preparation.onCommit?.();
      return this.command(operationKind === 'play' ? 'replace' : 'insert', {
        items, position: operationKind === 'playNext' ? 'afterCurrent' : 'end', play: operationKind === 'play',
        ...(operationKind === 'play' ? { startIndex } : {})
      }, playerId, preparation);
    }
    this.uiManager.beginPlaybackSelectionGestureResume?.();
    if (this.api.playLocalItems) return this.api.playLocalItems({ items, uiManager: this.uiManager, operationKind, startIndex,
      isCurrent, onCommit: preparation.onCommit });
    const tracks = await Promise.all(items.map(item => this.api.networkMusicResolveTrack({ ...item, localPlayback: true })));
    // A delayed source resolution must never start playback after its target has changed.
    if (!isCurrent()) return { accepted: false };
    const player = this.uiManager.audioPlayer ?? await this.uiManager.createAudioPlayer([], false);
    if (!isCurrent()) return { accepted: false };
    preparation.onCommit?.();
    return player.activateOpenHomePlaybackAdapter().playNetworkTracks(tracks, operationKind,
      isCurrent, startIndex);
  }

  canPlayItem(item) {
    if (item.playable === false) return false;
    if (this.api.canPlayItem && !this.api.canPlayItem(item, this.selectedPlayerId)) return false;
    const supported = this.playerStates.get(this.selectedPlayerId)?.protocolInfo;
    if (this.selectedPlayerId === 'local' || !supported) return true;
    const mimeTypes = (item.resources ?? []).map(resource => resource.protocolInfo?.split(':')[2]?.toLowerCase()).filter(Boolean);
    if (item.transcodedContentType) mimeTypes.push(item.transcodedContentType.toLowerCase());
    if (!mimeTypes.length) return true;
    return supported.split(',').some(protocol => {
      const mime = protocol.trim().split(':')[2]?.toLowerCase();
      return mime === '*' || mimeTypes.includes(mime);
    });
  }

  unavailableItemKey(item) {
    if (item.sourceKind === 'cue-track' || item.startFrame != null || item.endFrame != null) return 'networkMusic.cueUnsupported';
    if (item.requiresGateway && this.selectedPlayerId !== 'local') return 'networkMusic.settings.gatewayRequired';
    if (item.playable === false && item.resources?.length === 0) return 'networkMusic.noPlayableResource';
    return 'networkMusic.unsupported';
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
