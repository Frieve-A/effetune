import { validatePowerSnapshot } from '../audio/power-snapshot.js';

function getDefaultNavigator() {
    return typeof navigator !== 'undefined' ? navigator : {};
}

function getDefaultDocument() {
    return typeof document !== 'undefined'
        ? document
        : { hidden: false, addEventListener() {}, removeEventListener() {} };
}

export class WakeLockManager {
    constructor({
        layoutMode,
        stateManager,
        powerStateProvider = null,
        navigatorRef = getDefaultNavigator(),
        documentRef = getDefaultDocument()
    } = {}) {
        this.layoutMode = layoutMode;
        this.stateManager = stateManager;
        this.powerStateProvider = powerStateProvider;
        this.navigatorRef = navigatorRef;
        this.documentRef = documentRef;
        this.lock = null;
        this.lastPowerSnapshot = null;
        this.powerSnapshotInvalid = false;
        this.visible = !this.documentRef.hidden;
        this.desiredLockState = false;
        this.syncPromise = null;
        this.syncVersion = 0;
        this.disposed = false;
        this.onVisibilityChange = () => {
            this.visible = !this.documentRef.hidden;
            this.sync();
        };
        this.onPlayingChange = () => this.sync();
        this.onPowerStateChange = eventOrSnapshot => {
            const snapshot = eventOrSnapshot?.detail ?? eventOrSnapshot;
            if (validatePowerSnapshot(snapshot)) {
                this.lastPowerSnapshot = snapshot;
                this.powerSnapshotInvalid = false;
            } else {
                this.lastPowerSnapshot = null;
                this.powerSnapshotInvalid = true;
            }
            this.sync();
        };

        this.documentRef.addEventListener?.('visibilitychange', this.onVisibilityChange);
        this.stateManager?.addListener?.('isPlaying', this.onPlayingChange);
        this.layoutUnsubscribe = this.layoutMode?.onChange?.(() => this.sync()) || null;
        this.powerUnsubscribe = this.subscribePowerStateProvider();
        this.sync();
    }

    subscribePowerStateProvider() {
        if (!this.powerStateProvider) return null;
        if (typeof this.powerStateProvider.subscribe === 'function') {
            const unsubscribe = this.powerStateProvider.subscribe(this.onPowerStateChange);
            return typeof unsubscribe === 'function' ? unsubscribe : null;
        }
        if (typeof this.powerStateProvider.addEventListener === 'function') {
            this.powerStateProvider.addEventListener('powerStateChanged', this.onPowerStateChange);
            return () => this.powerStateProvider?.removeEventListener?.(
                'powerStateChanged',
                this.onPowerStateChange
            );
        }
        return null;
    }

    isPowerControllerEnabled() {
        if (!this.powerStateProvider) return false;
        const enabled = this.powerStateProvider.isControllerEnabled?.();
        return enabled !== false;
    }

    getEffectivePowerState() {
        if (this.powerSnapshotInvalid) return null;
        const candidate = this.lastPowerSnapshot ??
            this.powerStateProvider?.getPowerSnapshot?.() ??
            this.powerStateProvider?.getSnapshot?.();
        const snapshot = validatePowerSnapshot(candidate) ? candidate : null;
        return snapshot?.effectiveState;
    }

    isPowerStateAllowed() {
        if (!this.isPowerControllerEnabled()) return true;
        return String(this.getEffectivePowerState() || '').toLowerCase() === 'active';
    }

    shouldHoldLock() {
        const state = this.stateManager?.getStateSnapshot?.();
        return !!(
            this.layoutMode?.isMobile &&
            state?.isPlaying &&
            this.visible &&
            this.isPowerStateAllowed()
        );
    }

    async sync() {
        if (this.disposed) return this.syncPromise;
        this.desiredLockState = this.shouldHoldLock();
        this.syncVersion++;
        return this.ensureSync();
    }

    ensureSync() {
        if (!this.syncPromise) {
            this.syncPromise = this.runSync();
        }
        return this.syncPromise;
    }

    async runSync() {
        let seenVersion = 0;
        try {
            while (seenVersion !== this.syncVersion) {
                seenVersion = this.syncVersion;
                if (this.desiredLockState && !this.disposed) {
                    await this.request();
                } else {
                    await this.release();
                }
            }
        } finally {
            if (this.disposed && this.lock) {
                await this.release();
            }
            this.syncPromise = null;
        }
        if (!this.disposed && seenVersion !== this.syncVersion) {
            await this.sync();
        }
    }

    async request() {
        if (this.lock || !this.navigatorRef.wakeLock?.request) return;
        try {
            const lock = await this.navigatorRef.wakeLock.request('screen');
            if (!lock) return;
            this.lock = lock;
            lock.addEventListener?.('release', () => {
                if (this.lock === lock) {
                    this.lock = null;
                }
            });
        } catch {
            this.lock = null;
        }
    }

    async release() {
        const lock = this.lock;
        this.lock = null;
        try {
            await lock?.release?.();
        } catch (error) {
            // Ignore release races; the browser may already have released it.
        }
    }

    dispose() {
        if (this.disposed) return this.syncPromise || Promise.resolve();
        this.disposed = true;
        this.desiredLockState = false;
        this.syncVersion++;
        this.documentRef.removeEventListener?.('visibilitychange', this.onVisibilityChange);
        this.stateManager?.removeListener?.('isPlaying', this.onPlayingChange);
        this.layoutUnsubscribe?.();
        this.powerUnsubscribe?.();
        this.layoutUnsubscribe = null;
        this.powerUnsubscribe = null;
        return this.ensureSync();
    }
}
