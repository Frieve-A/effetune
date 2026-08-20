const GSM_FULL_RATE_SIMULATOR_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
]);
const GSM_FULL_RATE_SIMULATOR_TRANSCODES = Object.freeze(['1', '2', '3']);
const GSM_FULL_RATE_SIMULATOR_PASS_THROUGH_PROCESSOR = 'return data;';
const GSM_FULL_RATE_SIMULATOR_BYPASS_REASONS = Object.freeze({
    unsupportedSampleRate: 'This sample rate is not supported.',
    unsupportedChannelMode: 'This channel setting is not supported.',
    wasmUnavailable: 'WASM audio processing is unavailable.',
    rolloutDisabled: 'DSP processing is disabled.',
    runtimeFallback: 'Audio processing was interrupted.',
    engineStopped: 'Audio processing has stopped.'
});

class GSMFullRateSimulatorPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: GSM_FULL_RATE_SIMULATOR_SAMPLE_RATES,
        supportedChannelModes: Object.freeze(['mono', 'stereo-pair'])
    });

    constructor() {
        super('GSM-FR Simulator',
            'Simulates a GSM Full Rate speech-codec round trip over a radio link, with frame erasure concealment and residual bit errors as reception degrades');
        this.tc = 1;
        this.og = 0;
        this.mx = 100;
        this.ci = 30;
        this.temporalCapability = 'reset-on-resume';
        this.executionState = { state: 'pending', reason: null };
        this._statusElement = null;
        this.registerProcessor(GSM_FULL_RATE_SIMULATOR_PASS_THROUGH_PROCESSOR);
    }

    getTemporalCapability() {
        return 'reset-on-resume';
    }

    getParameters() {
        return {
            type: this.constructor.name,
            tc: this.tc,
            og: this.og,
            mx: this.mx,
            ci: this.ci,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.tc !== undefined) {
            this.tc = Math.round(this.parseFiniteNumber(params.tc, 1, 3, this.tc));
        }
        if (params.og !== undefined) {
            this.og = Math.round(this.parseFiniteNumber(params.og, -24, 12, this.og) * 10) / 10;
        }
        if (params.mx !== undefined) {
            this.mx = Math.round(this.parseFiniteNumber(params.mx, 0, 100, this.mx));
        }
        if (params.ci !== undefined) {
            this.ci = Math.round(this.parseFiniteNumber(params.ci, 4, 30, this.ci) * 10) / 10;
        }
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        this.updateParameters();
    }

    onMessage(message) {
        if (message?.pluginId !== this.id || message.type !== 'dspExecutionState' ||
            message.pluginType !== this.constructor.name || message.validated !== true) return;
        this.executionState = { state: message.state, reason: message.reason || null };
        this._renderStatusMessage();
    }

    // The engine passes audio through untouched whenever this WASM-only plugin
    // cannot run, so the UI has to say why instead of looking simply broken.
    _executionStatusText() {
        if (this.executionState.state !== 'bypassed') return '';
        const reason = GSM_FULL_RATE_SIMULATOR_BYPASS_REASONS[this.executionState.reason];
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

    createUI() {
        const container = document.createElement('div');
        container.className = 'gsm-full-rate-simulator-plugin-ui plugin-parameter-ui';
        container.appendChild(this.createRadioGroup('Transcodes',
            GSM_FULL_RATE_SIMULATOR_TRANSCODES, String(this.tc),
            value => this.setParameters({ tc: Number(value) }), 'tc'));
        container.appendChild(this.createParameterControl(
            'Output', -24, 12, 0.1, this.og,
            value => this.setParameters({ og: value }), 'dB', 'og'));
        container.appendChild(this.createParameterControl(
            'Mix', 0, 100, 1, this.mx,
            value => this.setParameters({ mx: value }), '%', 'mx'));
        container.appendChild(this.createParameterControl(
            'C/I', 4, 30, 0.1, this.ci,
            value => this.setParameters({ ci: value }), 'dB', 'ci'));
        container.appendChild(this._createStatusElement());
        return container;
    }
}

window.GSMFullRateSimulatorPlugin = GSMFullRateSimulatorPlugin;
