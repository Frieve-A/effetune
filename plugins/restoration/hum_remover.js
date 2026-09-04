const HUM_REMOVER_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000
]);
const HUM_REMOVER_FREQUENCIES = Object.freeze(['Auto', '50 Hz', '60 Hz']);
const HUM_REMOVER_MAX_HARMONICS = 64;
const HUM_REMOVER_PASS_THROUGH_PROCESSOR = 'return data;';
const HUM_REMOVER_TELEMETRY_FRAME = 23;
const HUM_REMOVER_TELEMETRY_VERSION = 1;
const HUM_REMOVER_TELEMETRY_BYTES = 8;
const HUM_REMOVER_BYPASS_REASONS = Object.freeze({
    unsupportedSampleRate: 'This sample rate is not supported.',
    unsupportedChannelMode: 'This channel setting is not supported.',
    wasmUnavailable: 'WASM audio processing is unavailable.',
    rolloutDisabled: 'DSP processing is disabled.',
    runtimeFallback: 'Audio processing was interrupted.',
    engineStopped: 'Audio processing has stopped.'
});

class HumRemoverPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: HUM_REMOVER_SAMPLE_RATES
    });

    constructor() {
        super('Hum Remover', 'Removes steady electrical hum and its harmonics');
        this.fm = 'Auto';
        this.hc = 8;
        this.sp = 50;
        this.temporalCapability = 'reset-on-resume';
        this.executionState = { state: 'pending', reason: null };
        this.fundamental = 50;
        this.removed = -140;
        this._statusElement = null;
        this._telemetryHudCanvas = null;
        this._telemetryHudDispose = null;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspTelemetry = frame => this.handleDspTelemetry(frame);
        this.registerProcessor(HUM_REMOVER_PASS_THROUGH_PROCESSOR);
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
                tapId, HUM_REMOVER_TELEMETRY_FRAME, this._boundDspTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, HUM_REMOVER_TELEMETRY_FRAME, this._boundDspTelemetry);
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
        if (frame?.frameType !== HUM_REMOVER_TELEMETRY_FRAME ||
            frame.formatVersion !== HUM_REMOVER_TELEMETRY_VERSION) return null;
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            payload.byteLength !== HUM_REMOVER_TELEMETRY_BYTES) return null;
        const fundamental = payload.getFloat32(0, true);
        const removed = payload.getFloat32(4, true);
        return Number.isFinite(fundamental) && Number.isFinite(removed)
            ? { fundamental, removed } : null;
    }

    handleDspTelemetry(frame) {
        const telemetry = this.parseDspTelemetryFrame(frame);
        if (!telemetry) return;
        this.fundamental = telemetry.fundamental;
        this.removed = telemetry.removed;
        this._renderTelemetry();
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            fm: this.fm,
            hc: this.hc,
            sp: this.sp,
            enabled: this.enabled
        };
    }

    setParameters(params = {}) {
        if (params.fm !== undefined) {
            this.fm = this.isAllowedEnum(params.fm, HUM_REMOVER_FREQUENCIES, this.fm);
        }
        if (params.hc !== undefined) {
            this.hc = Math.round(this.parseFiniteNumber(
                params.hc, 1, HUM_REMOVER_MAX_HARMONICS, this.hc));
        }
        if (params.sp !== undefined) this.sp = this.parseFiniteNumber(params.sp, 0, 100, this.sp);
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
        const reason = HUM_REMOVER_BYPASS_REASONS[this.executionState.reason];
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
        const gap = 5 * scale;
        const cardWidth = (width - padding * 2 - gap) / 2;
        const cardHeight = height - padding * 2;
        const fundamental = this.fundamental;
        const removed = this.removed;
        const cards = [
            {
                title: 'FUNDAMENTAL',
                value: `${fundamental.toFixed(2)} Hz`,
                level: (fundamental - 45) / 20
            },
            {
                title: 'REMOVED',
                value: `${removed.toFixed(1)} dBFS`,
                level: (removed + 140) / 140
            }
        ];

        context.clearRect(0, 0, width, height);
        context.fillStyle = '#171717';
        context.fillRect(0, 0, width, height);
        cards.forEach((card, index) => {
            const x = padding + index * (cardWidth + gap);
            const level = card.level < 0 ? 0 : (card.level > 1 ? 1 : card.level);
            context.fillStyle = '#222';
            context.fillRect(x, padding, cardWidth, cardHeight);
            context.strokeStyle = '#454545';
            context.strokeRect(x + 0.5 * scale, padding + 0.5 * scale,
                cardWidth - scale, cardHeight - scale);
            context.fillStyle = '#9db7c7';
            context.textAlign = 'left';
            context.textBaseline = 'top';
            context.font = `600 ${Math.round(9 * scale)}px Arial`;
            context.fillText(card.title, x + 6 * scale, padding + 5 * scale);
            context.fillStyle = '#f0f0f0';
            context.font = `${Math.round(12 * scale)}px Arial`;
            context.fillText(card.value, x + 6 * scale, padding + 22 * scale,
                cardWidth - 12 * scale);
            context.fillStyle = '#363636';
            context.fillRect(x + 6 * scale, padding + cardHeight - 9 * scale,
                cardWidth - 12 * scale, 4 * scale);
            context.fillStyle = '#69c8ff';
            context.fillRect(x + 6 * scale, padding + cardHeight - 9 * scale,
                (cardWidth - 12 * scale) * level, 4 * scale);
        });
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
        graph.canvas.setAttribute('aria-label', 'Hum removal status');
        this._renderTelemetry();
        graph.resize();
        return graph.container;
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
        const container = document.createElement('div');
        container.className = 'hum-remover-plugin-ui plugin-parameter-ui';
        container.appendChild(this.createRadioGroup(
            'Frequency', HUM_REMOVER_FREQUENCIES, this.fm,
            value => this.setParameters({ fm: value }), 'fm'));
        container.appendChild(this.createLogarithmicParameterControl(
            'Harmonics', 1, HUM_REMOVER_MAX_HARMONICS, 1, this.hc,
            value => this.setParameters({ hc: value }), '', 'hc'));
        container.appendChild(this.createParameterControl(
            'Tracking Speed', 0, 100, 1, this.sp,
            value => this.setParameters({ sp: value }), '%', 'sp'));
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

window.HumRemoverPlugin = HumRemoverPlugin;
