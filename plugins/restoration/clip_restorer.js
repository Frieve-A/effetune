const CLIP_RESTORER_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000
]);
const CLIP_RESTORER_PASS_THROUGH_PROCESSOR = 'return data;';
const CLIP_RESTORER_TELEMETRY_FRAME = 22;
const CLIP_RESTORER_TELEMETRY_VERSION = 1;
const CLIP_RESTORER_TELEMETRY_BYTES = 4;
const CLIP_RESTORER_BYPASS_REASONS = Object.freeze({
    unsupportedSampleRate: 'This sample rate is not supported.',
    unsupportedChannelMode: 'This channel setting is not supported.',
    wasmUnavailable: 'WASM audio processing is unavailable.',
    rolloutDisabled: 'DSP processing is disabled.',
    runtimeFallback: 'Audio processing was interrupted.',
    engineStopped: 'Audio processing has stopped.'
});

class ClipRestorerPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: CLIP_RESTORER_SAMPLE_RATES
    });

    constructor() {
        super('Clip Restorer', 'Restores peaks flattened by hard clipping');
        this.th = -0.1;
        this.og = -3;
        this.temporalCapability = 'reset-on-resume';
        this.executionState = { state: 'pending', reason: null };
        this.restoredPercent = 0;
        this._statusElement = null;
        this._telemetryHudCanvas = null;
        this._telemetryHudDispose = null;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspTelemetry = frame => this.handleDspTelemetry(frame);
        this.registerProcessor(CLIP_RESTORER_PASS_THROUGH_PROCESSOR);
    }

    getTemporalCapability() {
        return 'reset-on-resume';
    }

    _setupMessageHandler() {
        super._setupMessageHandler();
        this.ensureDspTelemetrySubscription();
    }

    ensureDspTelemetrySubscription() {
        const hub = window.dspTelemetryHub;
        const tapId = this.id;
        const validTapId = Number.isInteger(tapId) && tapId >= 0 && tapId <= 0xffffffff;
        const validHub = hub && typeof hub.subscribe === 'function';
        if (!validTapId || !validHub) {
            if (this._dspTelemetryUnsubscribe &&
                (hub !== this._dspTelemetryHub || tapId !== this._dspTelemetryTapId)) {
                this.disposeDspTelemetrySubscription();
            }
            return false;
        }
        if (this._dspTelemetryUnsubscribe &&
            hub === this._dspTelemetryHub && tapId === this._dspTelemetryTapId) return true;

        this.disposeDspTelemetrySubscription();
        try {
            const unsubscribe = hub.subscribe(
                tapId, CLIP_RESTORER_TELEMETRY_FRAME, this._boundDspTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, CLIP_RESTORER_TELEMETRY_FRAME, this._boundDspTelemetry);
                return false;
            }
            this._dspTelemetryHub = hub;
            this._dspTelemetryTapId = tapId;
            this._dspTelemetryUnsubscribe = unsubscribe;
            return true;
        } catch (error) {
            return false;
        }
    }

    disposeDspTelemetrySubscription() {
        const unsubscribe = this._dspTelemetryUnsubscribe;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        if (!unsubscribe) return;
        try {
            unsubscribe();
        } catch (error) {
            // Ignore stale telemetry subscription cleanup failures.
        }
    }

    parseDspTelemetryFrame(frame) {
        if (frame?.frameType !== CLIP_RESTORER_TELEMETRY_FRAME ||
            frame.formatVersion !== CLIP_RESTORER_TELEMETRY_VERSION) return null;
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            payload.byteLength !== CLIP_RESTORER_TELEMETRY_BYTES) return null;
        const restoredPercent = payload.getFloat32(0, true);
        return Number.isFinite(restoredPercent) && restoredPercent >= 0 ? restoredPercent : null;
    }

    handleDspTelemetry(frame) {
        const restoredPercent = this.parseDspTelemetryFrame(frame);
        if (restoredPercent === null) return;
        this.restoredPercent = restoredPercent;
        this._renderTelemetry();
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            th: this.th,
            og: this.og,
            enabled: this.enabled
        };
    }

    setParameters(params = {}) {
        if (params.th !== undefined) this.th = this.parseFiniteNumber(params.th, -18, 0, this.th);
        if (params.og !== undefined) this.og = this.parseFiniteNumber(params.og, -12, 0, this.og);
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        this.updateParameters();
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        if (message?.type !== 'dspExecutionState' || message.pluginId !== this.id ||
            message.pluginType !== this.constructor.name || message.validated !== true) return;
        this.executionState = { state: message.state, reason: message.reason || null };
        this._renderStatusMessage();
    }

    _executionStatusText() {
        if (this.executionState.state !== 'bypassed') return '';
        const reason = CLIP_RESTORER_BYPASS_REASONS[this.executionState.reason];
        return reason ? `${reason} ${this.name} is bypassed. Audio remains unchanged.` : '';
    }

    _renderStatusMessage() {
        if (!this._statusElement) return;
        const message = this._executionStatusText();
        this._statusElement.textContent = message;
        this._statusElement.hidden = !message;
    }

    _createStatusElement() {
        const status = document.createElement('div');
        status.className = 'plugin-execution-status';
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        this._statusElement = status;
        this._renderStatusMessage();
        return status;
    }

    _renderTelemetry() {
        const canvas = this._telemetryHudCanvas;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        const width = canvas.width;
        const height = canvas.height;
        const cssWidth = canvas.clientWidth || canvas.getBoundingClientRect?.().width || width || 1;
        const scale = width / cssWidth;
        const padding = 6 * scale;
        const cardWidth = width - padding * 2;
        const cardHeight = height - padding * 2;
        const restored = this.restoredPercent;
        const level = restored <= 0 ? 0 : (restored >= 100 ? 1 : restored / 100);

        context.clearRect(0, 0, width, height);
        context.fillStyle = '#171717';
        context.fillRect(0, 0, width, height);
        context.fillStyle = '#222';
        context.fillRect(padding, padding, cardWidth, cardHeight);
        context.strokeStyle = '#454545';
        context.strokeRect(padding + 0.5 * scale, padding + 0.5 * scale,
            cardWidth - scale, cardHeight - scale);
        context.fillStyle = '#9db7c7';
        context.textAlign = 'left';
        context.textBaseline = 'top';
        context.font = `600 ${Math.round(9 * scale)}px Arial`;
        context.fillText('RESTORED', padding + 6 * scale, padding + 5 * scale);
        context.fillStyle = '#f0f0f0';
        context.font = `${Math.round(16 * scale)}px Arial`;
        context.fillText(`${restored.toFixed(2)}%`, padding + 6 * scale, padding + 22 * scale);
        context.fillStyle = '#363636';
        context.fillRect(padding + 6 * scale, padding + cardHeight - 9 * scale,
            cardWidth - 12 * scale, 4 * scale);
        context.fillStyle = '#69c8ff';
        context.fillRect(padding + 6 * scale, padding + cardHeight - 9 * scale,
            (cardWidth - 12 * scale) * level, 4 * scale);
    }

    _createTelemetryHud() {
        this._telemetryHudDispose?.();
        const graph = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '16 / 1',
            mobileAspectRatio: '3 / 1',
            className: 'restoration-telemetry-hud',
            onResize: () => this._renderTelemetry()
        });
        this._telemetryHudCanvas = graph.canvas;
        this._telemetryHudDispose = graph.dispose;
        graph.canvas.setAttribute('aria-label', 'Clip restoration status');
        this._renderTelemetry();
        graph.resize();
        return graph.container;
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        const container = document.createElement('div');
        container.className = 'clip-restorer-plugin-ui plugin-parameter-ui';
        container.appendChild(this.createParameterControl(
            'Threshold', -18, 0, 0.01, this.th,
            value => this.setParameters({ th: value }), 'dB', 'th'));
        container.appendChild(this.createParameterControl(
            'Output Gain', -12, 0, 0.1, this.og,
            value => this.setParameters({ og: value }), 'dB', 'og'));
        container.appendChild(this._createStatusElement());
        container.appendChild(this._createTelemetryHud());
        return container;
    }

    cleanup() {
        this.disposeDspTelemetrySubscription();
        this._telemetryHudDispose?.();
        this._telemetryHudDispose = null;
        this._telemetryHudCanvas = null;
        super.cleanup();
    }
}

window.ClipRestorerPlugin = ClipRestorerPlugin;
