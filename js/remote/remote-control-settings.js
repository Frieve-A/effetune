const settingsByApi = new WeakMap();

export function getRemoteControlSettings(api) {
    if (!settingsByApi.has(api)) settingsByApi.set(api, new RemoteControlSettings(api));
    return settingsByApi.get(api);
}

class RemoteControlSettings {
    constructor(api) {
        this.api = api;
        this.status = null;
        this.busy = false;
        this.errorKey = null;
        this.listeners = new Set();
        this.generation = 0;
    }

    subscribe(listener) {
        this.listeners.add(listener);
        if (this.listeners.size === 1) {
            this.removeStatusListener = this.api.onStatus(status => {
                this.status = status;
                this.emit();
            });
            void this.update(() => this.api.getStatus());
        } else listener();
        return () => {
            this.listeners.delete(listener);
            if (this.listeners.size) return;
            this.removeStatusListener?.();
            this.removeStatusListener = null;
            this.generation += 1;
            this.status = null;
            this.busy = false;
            this.errorKey = null;
        };
    }

    emit() {
        for (const listener of this.listeners) listener();
    }

    setEnabled(enabled) {
        return this.update(() => this.api.setEnabled(enabled));
    }

    async update(task) {
        if (this.busy) return;
        const generation = this.generation;
        this.busy = true;
        this.errorKey = null;
        this.emit();
        try {
            const status = await task();
            if (generation === this.generation) this.status = status;
        } catch (error) {
            console.error('[remote] settings update failed:', error);
            if (generation === this.generation) this.errorKey = 'updateFailed';
        } finally {
            if (generation === this.generation) {
                this.busy = false;
                this.emit();
            }
        }
    }
}
