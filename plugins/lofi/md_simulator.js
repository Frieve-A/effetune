const MD_SIMULATOR_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
]);
const MD_SIMULATOR_MODES = Object.freeze([
    'SP (292 kbps)', 'LP2 (132 kbps)', 'LP4 (66 kbps)'
]);
const MD_SIMULATOR_PASS_THROUGH_PROCESSOR = 'return data;';
const MD_SIMULATOR_BYPASS_REASONS = Object.freeze({
    unsupportedSampleRate: 'This sample rate is not supported.',
    unsupportedChannelMode: 'This channel setting is not supported.',
    wasmUnavailable: 'WASM audio processing is unavailable.',
    rolloutDisabled: 'DSP processing is disabled.',
    runtimeFallback: 'Audio processing was interrupted.',
    engineStopped: 'Audio processing has stopped.'
});

class MDSimulatorPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: MD_SIMULATOR_SAMPLE_RATES,
        supportedChannelModes: Object.freeze(['mono', 'stereo-pair'])
    });

    constructor() {
        super('MD Simulator',
            'Simulates a MiniDisc-era ATRAC encode and decode round trip');
        this.md = 'SP (292 kbps)';
        this.og = 0;
        this.mx = 100;
        this.temporalCapability = 'reset-on-resume';
        this.executionState = { state: 'pending', reason: null };
        this._statusElement = null;
        this.registerProcessor(MD_SIMULATOR_PASS_THROUGH_PROCESSOR);
    }

    getTemporalCapability() {
        return 'reset-on-resume';
    }

    getParameters() {
        return {
            type: this.constructor.name,
            md: this.md,
            og: this.og,
            mx: this.mx,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.md !== undefined) {
            this.md = this.isAllowedEnum(params.md, MD_SIMULATOR_MODES, this.md);
        }
        if (params.og !== undefined) {
            this.og = Math.round(this.parseFiniteNumber(params.og, -24, 12, this.og) * 10) / 10;
        }
        if (params.mx !== undefined) {
            this.mx = Math.round(this.parseFiniteNumber(params.mx, 0, 100, this.mx));
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
        const reason = MD_SIMULATOR_BYPASS_REASONS[this.executionState.reason];
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
        container.className = 'md-simulator-plugin-ui plugin-parameter-ui';
        container.appendChild(this.createSelectControl('Mode',
            MD_SIMULATOR_MODES, this.md,
            value => this.setParameters({ md: value }), 'md'));
        container.appendChild(this.createParameterControl(
            'Output', -24, 12, 0.1, this.og,
            value => this.setParameters({ og: value }), 'dB', 'og'));
        container.appendChild(this.createParameterControl(
            'Mix', 0, 100, 1, this.mx,
            value => this.setParameters({ mx: value }), '%', 'mx'));
        container.appendChild(this._createStatusElement());
        return container;
    }
}

window.MDSimulatorPlugin = MDSimulatorPlugin;
