const UPDATE_STORAGE_KEY = 'effetune_pending_web_update';

export class WebUpdateManager {
    constructor(windowRef = window, logger = console, timeoutMs = 15000) {
        this.window = windowRef;
        this.logger = logger;
        this.timeoutMs = timeoutMs;
        this.registration = null;
        this.busy = false;
        this.ready = false;
        this.waitingBuild = null;
        this.notifiedBuild = null;
        this.reloading = false;
    }

    attach(registration) {
        if (!registration) return;
        this.registration = registration;
        registration.addEventListener?.('updatefound', () => {
            this.observeInstalling(registration.installing);
        });
        const check = () => {
            if (this.window.document?.visibilityState !== 'hidden') void this.check();
        };
        this.window.document?.addEventListener?.('visibilitychange', check);
        this.window.addEventListener?.('pageshow', check);
        this.window.addEventListener?.('online', check);
        this.observeInstalling(registration.installing);
        this.publish();
        void this.refreshWaiting().catch(error => {
            this.logger.warn('Could not inspect the downloaded web update:', error);
        });
        void this.check();
        if (this.ready) void this.verifyUpdate();
    }

    publish() {
        this.window.app?.uiManager?.stateManager?.updateWebUpdateAvailability?.();
    }

    notify(key, error = false) {
        if (this.ready) this.window.app?.uiManager?.setError?.(key, error);
    }

    async onApplicationReady() {
        this.ready = true;
        this.publish();
        await this.verifyUpdate();
        if (this.waitingBuild) this.announceUpdate();
    }

    observeInstalling(worker) {
        this.installingWorker = worker;
        worker?.addEventListener?.('statechange', () => {
            if (worker.state === 'installed') void this.refreshWaiting().catch(error => {
                this.logger.warn('Could not inspect the downloaded web update:', error);
            });
        });
    }

    request(worker, message) {
        if (!worker) return Promise.reject(new Error('Service worker is unavailable.'));
        return new Promise((resolve, reject) => {
            const channel = new this.window.MessageChannel();
            let settled = false;
            const finish = (error, value) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                channel.port1.close();
                channel.port2.close();
                if (error) reject(error);
                else resolve(value);
            };
            const timer = setTimeout(() => finish(new Error('Service worker response timed out.')), this.timeoutMs);
            channel.port1.onmessage = event => finish(null, event.data);
            try {
                worker.postMessage(message, [channel.port2]);
            } catch (error) {
                finish(error);
            }
        });
    }

    async refreshWaiting() {
        const worker = this.registration?.waiting;
        if (!worker || worker.state === 'redundant') {
            this.waitingBuild = null;
            this.publish();
            return null;
        }
        const response = await this.request(worker, { type: 'GET_BUILD' });
        if (worker !== this.registration.waiting) return this.refreshWaiting();
        if (typeof response?.build !== 'string' || !response.build) throw new Error('Invalid service worker build.');
        this.waitingBuild = response.build;
        this.publish();
        this.announceUpdate();
        return worker;
    }

    announceUpdate() {
        if (!this.ready || this.notifiedBuild === this.waitingBuild) return;
        this.notifiedBuild = this.waitingBuild;
        this.notify('status.updateReady');
    }

    waitForInstallation(worker) {
        if (!worker || worker.state === 'installed' || worker.state === 'activated') return Promise.resolve();
        return new Promise((resolve, reject) => {
            const finish = error => {
                clearTimeout(timer);
                worker.removeEventListener?.('statechange', changed);
                if (error) reject(error);
                else resolve();
            };
            const changed = () => {
                if (worker.state === 'redundant') finish(new Error('The web update could not be installed.'));
                else if (worker.state === 'installed' || worker.state === 'activated') finish();
            };
            const timer = setTimeout(() => finish(new Error('Web update download timed out.')), this.timeoutMs * 4);
            worker.addEventListener('statechange', changed);
            changed();
        });
    }

    async check(manual = false) {
        if (!this.registration || this.busy) return;
        this.busy = true;
        this.publish();
        if (manual) this.notify('status.updateChecking');
        try {
            if (this.window.navigator.onLine === false) throw new Error('The browser is offline.');
            this.installingWorker = this.registration.installing;
            let timer;
            try {
                await Promise.race([
                    this.registration.update(),
                    new Promise((resolve, reject) => {
                        timer = setTimeout(() => reject(new Error('Web update check timed out.')), this.timeoutMs * 4);
                    })
                ]);
            } finally {
                clearTimeout(timer);
            }
            await this.waitForInstallation(this.registration.installing || this.installingWorker);
            const worker = await this.refreshWaiting();
            if (!worker && manual) this.notify('status.updateCurrent');
        } catch (error) {
            this.logger.warn('Web update check failed:', error);
            try {
                await this.refreshWaiting();
            } catch (waitingError) {
                this.logger.warn('Could not inspect the downloaded web update:', waitingError);
            }
            if (manual) this.notify(this.waitingBuild ? 'status.updateReady' : 'error.updateCheckFailed', !this.waitingBuild);
        } finally {
            this.busy = false;
            this.publish();
        }
    }

    waitForController(build, worker) {
        const serviceWorker = this.window.navigator.serviceWorker;
        let changed;
        let timer;
        let settled = false;
        const promise = new Promise((resolve, reject) => {
            const finish = error => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                serviceWorker.removeEventListener('controllerchange', changed);
                if (error) reject(error);
                else resolve();
            };
            changed = async () => {
                try {
                    const current = await this.request(serviceWorker.controller, { type: 'GET_BUILD' });
                    if (current?.build === build) finish();
                } catch (error) {
                    this.logger.warn('Could not verify the active web update:', error);
                }
            };
            serviceWorker.addEventListener('controllerchange', changed);
            timer = setTimeout(async () => {
                await changed();
                if (!settled) finish(new Error('Web update activation timed out.'));
            }, this.timeoutMs);
            void changed();
            try {
                worker.postMessage({ type: 'ACTIVATE_UPDATE', build });
            } catch (error) {
                finish(error);
            }
        });
        return promise;
    }

    async apply() {
        if (!this.registration || this.busy || this.reloading) return;
        this.busy = true;
        this.publish();
        let restore;
        try {
            const worker = await this.refreshWaiting();
            if (!worker) return;
            const build = this.waitingBuild;
            restore = await this.window.app.prepareWebUpdate();
            this.window.sessionStorage.setItem(UPDATE_STORAGE_KEY, build);
            this.notify('status.updateApplying');
            // Activation is verified through controllerchange, not through an acknowledgement.
            await this.waitForController(build, worker);
            this.reloading = true;
            this.window.location.reload();
        } catch (error) {
            this.reloading = false;
            this.logger.warn('Web update could not be applied:', error);
            try {
                this.window.sessionStorage.removeItem(UPDATE_STORAGE_KEY);
            } catch (storageError) {
                this.logger.warn('Could not clear an unsuccessful web update:', storageError);
            }
            try {
                await restore?.();
            } catch (restoreError) {
                this.logger.warn('Could not restore playback after an unsuccessful web update:', restoreError);
            }
            this.notify('error.updateApplyFailed', true);
        } finally {
            if (!this.reloading) this.busy = false;
            this.publish();
        }
    }

    async verifyUpdate() {
        if (!this.registration || this.verifying) return;
        this.verifying = true;
        try {
            const expected = this.window.sessionStorage?.getItem(UPDATE_STORAGE_KEY);
            if (!expected) return;
            const response = await this.request(this.window.navigator.serviceWorker.controller, { type: 'GET_BUILD' });
            this.window.sessionStorage.removeItem(UPDATE_STORAGE_KEY);
            if (response?.build !== expected) throw new Error('The running web build differs from the requested update.');
            this.notify('success.appUpdated');
        } catch (error) {
            this.logger.warn('Web update verification failed:', error);
            this.notify('error.updateVerificationFailed', true);
        } finally {
            this.verifying = false;
        }
    }
}
