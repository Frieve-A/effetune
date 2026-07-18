export class RecentlyPlayedTracker {
  constructor({ stateManager, recordTrack, logger = console } = {}) {
    if (!stateManager || typeof stateManager.addListener !== 'function' ||
        typeof stateManager.getStateSnapshot !== 'function') {
      throw new TypeError('stateManager is required');
    }
    if (typeof recordTrack !== 'function') throw new TypeError('recordTrack is required');
    this.stateManager = stateManager;
    this.recordTrack = recordTrack;
    this.logger = logger;
    this.lastTrackUid = null;
    this.disposed = false;
    this.handleStateChange = () => this.evaluate();
    this.stateManager.addListener('currentTrack', this.handleStateChange);
    this.stateManager.addListener('isPlaying', this.handleStateChange);
    this.evaluate();
  }

  evaluate() {
    if (this.disposed) return;
    const snapshot = this.stateManager.getStateSnapshot();
    if (snapshot?.isPlaying !== true) return;
    const trackUid = snapshot.currentTrack?.libraryTrackId ?? snapshot.currentTrack?.trackUid;
    if (typeof trackUid !== 'string' || !trackUid || trackUid === this.lastTrackUid) return;
    this.lastTrackUid = trackUid;
    void Promise.resolve(this.recordTrack(trackUid)).catch(error => {
      this.logger?.error?.('Unable to record the recently played library track:', error);
    });
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.stateManager.removeListener?.('currentTrack', this.handleStateChange);
    this.stateManager.removeListener?.('isPlaying', this.handleStateChange);
  }
}

export function createRecentlyPlayedTracker(options) {
  return new RecentlyPlayedTracker(options);
}
