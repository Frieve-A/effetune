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
        navigatorRef = getDefaultNavigator(),
        documentRef = getDefaultDocument()
    } = {}) {
        this.layoutMode = layoutMode;
        this.stateManager = stateManager;
        this.navigatorRef = navigatorRef;
        this.documentRef = documentRef;
        this.lock = null;
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

        this.documentRef.addEventListener?.('visibilitychange', this.onVisibilityChange);
        this.stateManager?.addListener?.('isPlaying', this.onPlayingChange);
        this.layoutUnsubscribe = this.layoutMode?.onChange?.(() => this.sync()) || null;
        this.sync();
    }

    shouldHoldLock() {
        const state = this.stateManager?.getStateSnapshot?.();
        return !!(this.layoutMode?.isMobile && state?.isPlaying && this.visible);
    }

    async sync() {
        if (this.disposed) return;
        this.desiredLockState = this.shouldHoldLock();
        this.syncVersion++;
        if (!this.syncPromise) {
            this.syncPromise = this.runSync();
        }
        await this.syncPromise;
    }

    async runSync() {
        let seenVersion = 0;
        try {
            while (seenVersion !== this.syncVersion) {
                seenVersion = this.syncVersion;
                if (this.disposed) break;
                if (this.desiredLockState) {
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
            this.lock = await this.navigatorRef.wakeLock.request('screen');
            this.lock.addEventListener?.('release', () => {
                this.lock = null;
            });
        } catch (error) {
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
        this.disposed = true;
        this.desiredLockState = false;
        this.syncVersion++;
        this.documentRef.removeEventListener?.('visibilitychange', this.onVisibilityChange);
        this.stateManager?.removeListener?.('isPlaying', this.onPlayingChange);
        this.layoutUnsubscribe?.();
        this.release();
    }
}
