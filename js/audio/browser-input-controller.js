/** Owns Browser playback separately from the configured audio input device. */
export class BrowserInputController {
    constructor(audioManager, api, onChange = () => {}) {
        this.audioManager = audioManager;
        this.api = api;
        this.onChange = onChange;
        this.stream = null;
        this.sourceNode = null;
        this.generation = null;
        this.revision = 0;
        this.selected = false;
        this.active = false;
        this.pending = null;
        audioManager.ioManager.browserInput = this;
        this.unsubscribe = api.onState(state => {
            if (this.active && (state.captureActive === false ||
                state.captureGeneration !== this.generation)) {
                void this.release({ keepSelection: true }).catch(error => {
                    console.error('Browser capture cleanup failed:', error);
                });
            }
        });
    }

    select() {
        if (this.active && this.stream?.getAudioTracks().some(track => track.readyState === 'live')) {
            return Promise.resolve(true);
        }
        if (this.pending) return this.pending;
        const revision = ++this.revision;
        this.selected = true;
        const releaseLease = this.audioManager.powerPolicyController.acquireLease('browser-capture', {
            mode: 'hold-current', scope: 'resource-mutation'
        });
        let capture;
        try {
            const reservation = this.api.prepareCapture();
            if (reservation.ok === false || !Number.isSafeInteger(reservation.generation)) {
                throw new Error('Browser capture could not be prepared');
            }
            this.generation = reservation.generation;
            // Both calls begin on the click stack, before the first await.
            capture = navigator.mediaDevices.getDisplayMedia({
                video: true,
                audio: { channelCount: 2, echoCancellation: false,
                    noiseSuppression: false, autoGainControl: false }
            });
            this.audioManager.contextManager.audioContext?.resume().catch(() => {});
            this.audioManager.ioManager.playOutputBridgeForGesture?.().catch(() => {});
        } catch (error) {
            capture = Promise.reject(error);
        }
        this.onChange('acquiring');
        this.pending = this.install(capture, revision).finally(() => {
            releaseLease();
            if (this.revision === revision) this.pending = null;
        });
        return this.pending;
    }

    async install(capture, revision) {
        let stream;
        try {
            stream = await capture;
            if (revision !== this.revision) {
                this.audioManager.ioManager._stopStreamTracksOnce(stream);
                return false;
            }
            this.stream = stream;
            const tracks = stream.getAudioTracks();
            if (tracks.length === 0 || tracks.some(track => track.readyState !== 'live')) {
                throw new Error('Browser capture has no live audio');
            }
            for (const track of tracks) {
                const settings = track.getSettings();
                if (settings.echoCancellation === true || settings.noiseSuppression === true ||
                    settings.autoGainControl === true) throw new Error('Browser audio processing is enabled');
            }
            for (const track of stream.getVideoTracks()) track.stop();
            for (const track of tracks) {
                track.addEventListener('ended', () => {
                    if (this.stream === stream) void this.release({ keepSelection: true });
                }, { once: true });
            }
            if (!await this.bindGraph(revision)) throw new Error('Browser playback could not be connected');
            await this.activate();
            this.audioManager.powerPolicyController.ensureActive('mixed-play')
                .catch(error => console.error('Browser audio could not resume:', error));
            return true;
        } catch (error) {
            console.error('Browser audio capture failed:', error);
            if (revision === this.revision) {
                await this.release({ keepSelection: true });
                this.onChange('error');
            } else if (stream) this.audioManager.ioManager._stopStreamTracksOnce(stream);
            return false;
        }
    }

    async bindGraph(revision = this.revision) {
        if (!this.selected || !this.stream) return true;
        this.detachGraph();
        const source = this.audioManager.contextManager.audioContext.createMediaStreamSource(this.stream);
        this.sourceNode = source;
        return this.audioManager.powerPolicyController.selectBrowserPlaybackSource(
            source, () => revision === this.revision && this.selected
        );
    }

    detachGraph() {
        if (!this.sourceNode) return;
        this.audioManager.disconnectSourceFromPipeline(this.sourceNode);
        this.sourceNode.disconnect();
        this.sourceNode = null;
    }

    getPowerSourceStatus() {
        const connected = !!this.sourceNode &&
            this.audioManager.isSourceConnectedToPipeline(this.sourceNode);
        return { state: connected ? 'connected' : 'disconnected', sourcePresent: !!this.sourceNode };
    }

    async activate() {
        const revision = this.revision;
        const state = await this.api.setCaptureState({ generation: this.generation, active: true });
        if (state.ok === false || revision !== this.revision) {
            throw new Error('Browser capture selection was superseded');
        }
        this.active = true;
        this.onChange('active');
    }

    async release({ keepSelection = false } = {}) {
        const hadSelection = this.selected;
        const revision = ++this.revision;
        this.pending = null;
        this.active = false;
        const generation = this.generation;
        if (generation !== null) {
            const state = await this.api.setCaptureState({ generation, active: false });
            if (state.ok === false) throw new Error('Browser audio could not be muted');
        }
        if (revision !== this.revision) return false;
        const io = this.audioManager.ioManager;
        if (!hadSelection) {
            this.detachGraph();
            io._stopStreamTracksOnce(this.stream);
            this.stream = null;
            this.generation = null;
            return true;
        }
        const silent = io.ensureSilentSourceFallback();
        if (this.audioManager.ensureSourceConnectedToPipeline(silent) !== true) {
            throw new Error('Browser playback could not be released safely');
        }
        this.detachGraph();
        io._stopStreamTracksOnce(this.stream);
        this.stream = null;
        this.generation = null;
        this.selected = keepSelection;
        this.onChange(keepSelection ? 'resume' : 'device');
        await this.audioManager.powerPolicyController.refreshPlaybackInputRouting();
        return true;
    }
}
