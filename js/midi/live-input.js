import { recognizeMidiSystemReset, recognizeMidiDrumMode } from './system-reset.js';

// A visible Music Player keeps priority while paused. A queue restored at startup
// leaves live MIDI available until the player starts opening a track.
export function musicPlayerOwnsMidi(powerController) {
  const player = powerController?.player;
  if (!player?.ui?.container) return false;
  const state = player.stateManager?.getStateSnapshot?.();
  return state?.isPlaybackPending === true || !player.playbackManager?.isUnloadedPlaybackSession?.(state);
}

export class MidiLiveInput {
  constructor({ manager, audioManager, powerController = audioManager?.powerPolicyController,
    onDiagnostic = error => console.warn('Live MIDI input:', error) }) {
    this.manager = manager;
    this.audioManager = audioManager;
    this.powerController = powerController;
    this.onDiagnostic = onDiagnostic;
    this.selectedKey = '';
    this.activePort = null;
    this.activeSource = null;
    this.disposed = false;
    this.receive = event => this.onMessage(event);
    this.syncOwnership = () => this.syncSource();
    this.unsubscribeDevices = manager.onChange(this.syncOwnership);
    this.unsubscribePower = powerController?.subscribe(this.syncOwnership);
    audioManager.addEventListener?.('playerPlaybackPendingChanged', this.syncOwnership);
  }

  async select(key) {
    if (this.disposed) return;
    this.selectedKey = typeof key === 'string' ? key : '';
    this.syncSource();
    await this.manager.setPerformanceInput(this.selectedKey, this.receive);
    if (!this.disposed) this.syncSource();
  }

  syncSource() {
    if (this.disposed) return;
    const port = !musicPlayerOwnsMidi(this.powerController) && this.selectedKey
      ? this.manager.findInput(this.selectedKey) : null;
    if (port === this.activePort && (port ? this.selectedKey : null) === this.activeSource) return;
    // A reconnect can reuse the same stable key but is a new source lifetime.
    // Reset the old source before accepting events from the replacement port.
    if (this.activeSource !== null) this.audioManager.setLiveMidiInputSource(null);
    this.activePort = port;
    this.activeSource = port ? this.selectedKey : null;
    if (this.activeSource !== null) this.audioManager.setLiveMidiInputSource(this.activeSource);
  }

  onMessage({ data, timeStamp, sourceKey, port }) {
    if (this.disposed) return;
    this.syncSource();
    if (!this.activePort || port !== this.activePort || sourceKey !== this.activeSource) return;
    // Web MIDI delivers complete packets. System messages edit musical state, never its clock.
    const status = data?.[0], type = status & 0xf0;
    const systemReset = recognizeMidiSystemReset(data);
    const drumMode = recognizeMidiDrumMode(data);
    if ((systemReset || drumMode) && Number.isFinite(timeStamp)) {
      try { this.audioManager.enqueueLiveMidiInput({ data: new Uint8Array([0, drumMode?.channel ?? 0, drumMode?.mode ?? 0]),
        ...(systemReset ? { systemReset } : { drumMode }), timeStamp, sourceKey }); }
      catch (error) { this.onDiagnostic(error); }
      return;
    }
    if (!Number.isInteger(status) || status < 0x80 || status >= 0xf0) return;
    const length = type === 0xc0 || type === 0xd0 ? 2 : 3;
    if (data.length !== length || !Number.isFinite(timeStamp)) return;
    for (let index = 1; index < length; index++) {
      if (!Number.isInteger(data[index]) || data[index] < 0 || data[index] > 127) return;
    }
    try {
      this.audioManager.enqueueLiveMidiInput({ data: new Uint8Array(data), timeStamp, sourceKey });
    } catch (error) { this.onDiagnostic(error); }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeDevices?.();
    this.unsubscribePower?.();
    this.audioManager.removeEventListener?.('playerPlaybackPendingChanged', this.syncOwnership);
    if (this.activeSource !== null) this.audioManager.setLiveMidiInputSource(null);
    this.activeSource = null;
    this.activePort = null;
    Promise.resolve(this.manager.setPerformanceInput('', null)).catch(this.onDiagnostic);
  }
}
