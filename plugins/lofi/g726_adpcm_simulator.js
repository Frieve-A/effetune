const G726_ADPCM_SIMULATOR_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
]);
const G726_ADPCM_SIMULATOR_BITRATES = Object.freeze(['16', '24', '32', '40']);
const G726_ADPCM_SIMULATOR_PASS_THROUGH_PROCESSOR = 'return data;';
const G726_ADPCM_SIMULATOR_BYPASS_REASONS = Object.freeze({
    unsupportedSampleRate: 'This sample rate is not supported.',
    unsupportedChannelMode: 'This channel setting is not supported.',
    wasmUnavailable: 'WASM audio processing is unavailable.',
    rolloutDisabled: 'DSP processing is disabled.',
    runtimeFallback: 'Audio processing was interrupted.',
    engineStopped: 'Audio processing has stopped.'
});

class G726ADPCMSimulatorPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: G726_ADPCM_SIMULATOR_SAMPLE_RATES,
        supportedChannelModes: Object.freeze(['mono', 'stereo-pair'])
    });

    constructor() {
        super('G.726 Simulator',
            'Simulates a G.726 speech-codec round trip with an optional noisy radio link');
        this.br = '32';
        this.og = 0;
        this.mx = 100;
        this.re = -6;
        this.temporalCapability = 'reset-on-resume';
        this.executionState = { state: 'pending', reason: null };
        this._statusElement = null;
        this.registerProcessor(G726_ADPCM_SIMULATOR_PASS_THROUGH_PROCESSOR);
    }

    getTemporalCapability() {
        return 'reset-on-resume';
    }

    getParameters() {
        return {
            type: this.constructor.name,
            br: this.br,
            og: this.og,
            mx: this.mx,
            re: this.re,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.br !== undefined) {
            this.br = this.isAllowedEnum(String(params.br),
                G726_ADPCM_SIMULATOR_BITRATES, this.br);
        }
        if (params.og !== undefined) {
            this.og = Math.round(this.parseFiniteNumber(params.og, -24, 12, this.og) * 10) / 10;
        }
        if (params.mx !== undefined) {
            this.mx = Math.round(this.parseFiniteNumber(params.mx, 0, 100, this.mx));
        }
        if (params.re !== undefined) {
            this.re = Math.round(this.parseFiniteNumber(params.re, -6, -2, this.re) * 10) / 10;
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
        const reason = G726_ADPCM_SIMULATOR_BYPASS_REASONS[this.executionState.reason];
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
        container.className = 'g726-adpcm-simulator-plugin-ui plugin-parameter-ui';
        container.appendChild(this.createSelectControl('Bitrate',
            G726_ADPCM_SIMULATOR_BITRATES.map(value => ({ value, label: `${value} kbit/s` })),
            this.br, value => this.setParameters({ br: value }), 'br'));
        container.appendChild(this.createParameterControl(
            'Output', -24, 12, 0.1, this.og,
            value => this.setParameters({ og: value }), 'dB', 'og'));
        container.appendChild(this.createParameterControl(
            'Mix', 0, 100, 1, this.mx,
            value => this.setParameters({ mx: value }), '%', 'mx'));
        container.appendChild(this.createParameterControl(
            'Bit Error Rate', -6, -2, 0.1, this.re,
            value => this.setParameters({ re: value }), '10^x', 're'));
        container.appendChild(this._createStatusElement());
        return container;
    }
}

window.G726ADPCMSimulatorPlugin = G726ADPCMSimulatorPlugin;
