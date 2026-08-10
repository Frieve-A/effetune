const PITCH_SHIFTER_HQ_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000
]);
const PITCH_SHIFTER_HQ_PASS_THROUGH_PROCESSOR = 'return data;';
const PITCH_SHIFTER_HQ_BYPASS_REASONS = Object.freeze({
    unsupportedSampleRate: 'This sample rate is not supported.',
    unsupportedChannelMode: 'This channel setting is not supported.',
    wasmUnavailable: 'High-quality audio processing is unavailable.',
    rolloutDisabled: 'High-quality audio processing is disabled.',
    runtimeFallback: 'Audio processing was interrupted.',
    engineStopped: 'Audio processing has stopped.'
});

class PitchShifterHQPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: PITCH_SHIFTER_HQ_SAMPLE_RATES
    });

    constructor() {
        super('Pitch Shifter HQ',
            'Changes audio pitch with higher quality while preserving playback speed');
        this.ps = 0;
        this.ft = 0;
        this.temporalCapability = 'reset-on-resume';
        this.executionState = { state: 'pending', reason: null };
        this._statusElement = null;
        this.registerProcessor(PITCH_SHIFTER_HQ_PASS_THROUGH_PROCESSOR);
    }

    getTemporalCapability() {
        return 'reset-on-resume';
    }

    getParameters() {
        return {
            type: this.constructor.name,
            ps: this.ps,
            ft: this.ft,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.ps !== undefined) {
            this.ps = Math.round(this.parseFiniteNumber(params.ps, -6, 6, this.ps));
        }
        if (params.ft !== undefined) {
            this.ft = Math.round(this.parseFiniteNumber(params.ft, -50, 50, this.ft));
        }
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        this.updateParameters();
    }

    onMessage(message) {
        if (message?.type !== 'dspExecutionState' || message.pluginId !== this.id ||
            message.pluginType !== this.constructor.name || message.validated !== true) return;
        this.executionState = { state: message.state, reason: message.reason || null };
        this._renderStatusMessage();
    }

    _executionStatusText() {
        if (this.executionState.state !== 'bypassed') return '';
        const reason = PITCH_SHIFTER_HQ_BYPASS_REASONS[this.executionState.reason];
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
        container.className = 'pitch-shifter-hq-plugin-ui plugin-parameter-ui';
        container.appendChild(this.createParameterControl(
            'Pitch Shift', -6, 6, 1, this.ps,
            value => this.setParameters({ ps: value }), 'semitones'));
        container.appendChild(this.createParameterControl(
            'Fine Tune', -50, 50, 1, this.ft,
            value => this.setParameters({ ft: value }), 'cents'));
        container.appendChild(this._createStatusElement());
        return container;
    }
}

window.PitchShifterHQPlugin = PitchShifterHQPlugin;
