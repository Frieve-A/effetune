// HTTP, resampling and the input route belong to the audio service. Only
// transport control and the sender's timing feedback cross the page bridge.
export class AndroidLivePcm {
    constructor(player, host, feedback) {
        this.player = player;
        this.host = host;
        this.feedback = feedback;
        this.ownsPlayerSource = true;
    }

    async start(entry, isCurrent = () => true) {
        this.stop();
        const id = crypto.randomUUID();
        const controller = new AbortController();
        this.controller = controller;
        this.id = id;
        this.sessionId = entry.liveSessionId;
        this.removeEnded = this.host.on('live-ended', event => {
            if (event.id !== id || this.id !== id) return;
            this.stop();
            this.player.stateManager.updateState({ isPlaying: false, isPaused: false, isStopped: true },
                'Network live playback ended');
        });
        let ready = false;
        try {
            const reply = await this.host.request('live.start', { id, sessionId: this.sessionId });
            if (!reply.connectionId || controller.signal.aborted || !isCurrent()) return false;
            this.connectionId = reply.connectionId;
            this.source = { id };
            ready = true;
            return true;
        } catch (error) {
            console.warn('Android live playback could not start', error);
            return false;
        } finally {
            if (!ready && this.id === id) this.stop();
        }
    }

    followReceiveRoute(generation) { this.routeGeneration = generation; }

    async activate() {
        const id = this.id;
        try {
            const reply = await this.host.request('live.activate', { id, generation: this.routeGeneration });
            return this.id === id && reply.active === true;
        } catch (error) {
            console.warn('Android live route could not activate', error);
            return false;
        }
    }

    async position() {
        const id = this.id;
        if (!id) return null;
        const value = await this.host.request('live.position', { id });
        return this.id === id && Number.isFinite(value.positionFrames) ? value : null;
    }

    beginReporting() {
        const id = this.id;
        const connection = { sessionId: this.sessionId, connectionId: this.connectionId };
        const report = async () => {
            try {
                const probeId = await this.feedback.probeLivePlayback(connection);
                if (!probeId || this.id !== id) return;
                const position = await this.position();
                const manager = this.player.audioManager;
                const route = manager.networkRoute;
                if (!position?.started || this.id !== id || route?.generation !== this.routeGeneration ||
                    !route.receiveActive) return;
                const paths = manager.networkPaths?.revision === route.revision ? manager.networkPaths : null;
                const suffix = route.receiveId == null && paths && manager.nativeLatencyPublished
                    ? manager.dspPipelineLatencySamples : paths?.receive?.localSamples;
                const ms = 1000 / position.sampleRate;
                await this.feedback.reportLivePlayback({ ...connection, probeId, positionFrames: position.positionFrames,
                    revision: route.revision, dspMs: Number.isFinite(suffix) ? suffix * ms : null,
                    softwareOutputMs: Number.isFinite(paths?.localDelaySamples)
                        ? (position.outputDelayFrames + paths.localDelaySamples) * ms : null,
                    physicalOutputMs: position.physicalOutputMs });
            } catch (error) { console.warn('Android live timing report failed', error); }
            finally { if (this.id === id) this.timer = setTimeout(report, 1000); }
        };
        void report();
    }

    stop() {
        const id = this.id;
        this.id = null;
        this.source = null;
        this.sessionId = this.connectionId = this.routeGeneration = null;
        this.controller?.abort();
        this.controller = null;
        this.removeEnded?.();
        this.removeEnded = null;
        clearTimeout(this.timer);
        if (id) void this.host.request('live.stop', { id }).catch(error => console.warn('Android live stop failed', error));
    }
}
