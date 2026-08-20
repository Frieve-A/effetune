const BANDWIDTH_EXTENDER_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000
]);
const BANDWIDTH_EXTENDER_CUTOFF_MODES = Object.freeze(['Auto', 'Manual']);
const BANDWIDTH_EXTENDER_PASS_THROUGH_PROCESSOR = 'return data;';
const BANDWIDTH_EXTENDER_BYPASS_REASONS = Object.freeze({
    unsupportedSampleRate: 'This sample rate is not supported.',
    unsupportedChannelMode: 'This channel setting is not supported.',
    wasmUnavailable: 'WASM audio processing is unavailable.',
    rolloutDisabled: 'DSP processing is disabled.',
    runtimeFallback: 'Audio processing was interrupted.',
    engineStopped: 'Audio processing has stopped.'
});

class BandwidthExtenderPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: BANDWIDTH_EXTENDER_SAMPLE_RATES,
        supportedChannelModes: Object.freeze(['mono', 'stereo-pair'])
    });

    constructor() {
        super('Bandwidth Extender',
            'Generates plausible high-frequency content for bandwidth-limited audio');
        this.ha = 100;
        this.na = 100;
        this.cm = 'Auto';
        this.cf = 16000;
        this.temporalCapability = 'reset-on-resume';
        this.executionState = { state: 'pending', reason: null };
        this._statusElement = null;
        this._manualCutoffRow = null;
        this.registerProcessor(BANDWIDTH_EXTENDER_PASS_THROUGH_PROCESSOR);
    }

    getTemporalCapability() {
        return 'reset-on-resume';
    }

    getParameters() {
        return {
            type: this.constructor.name,
            ha: this.ha,
            na: this.na,
            cm: this.cm,
            cf: this.cf,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.ha !== undefined) {
            this.ha = Math.round(this.parseFiniteNumber(params.ha, 0, 200, this.ha));
        }
        if (params.na !== undefined) {
            this.na = Math.round(this.parseFiniteNumber(params.na, 0, 200, this.na));
        }
        if (params.cm !== undefined) {
            this.cm = this.isAllowedEnum(params.cm, BANDWIDTH_EXTENDER_CUTOFF_MODES, this.cm);
        }
        if (params.cf !== undefined) {
            this.cf = Math.round(this.parseFiniteNumber(params.cf, 6000, 24000, this.cf) / 100) * 100;
        }
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        this._syncCutoffVisibility();
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
        const reason = BANDWIDTH_EXTENDER_BYPASS_REASONS[this.executionState.reason];
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

    _syncCutoffVisibility() {
        if (this._manualCutoffRow) this._manualCutoffRow.hidden = this.cm !== 'Manual';
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'bandwidth-extender-plugin-ui plugin-parameter-ui';
        container.appendChild(this.createParameterControl(
            'Harmonic Amount', 0, 200, 1, this.ha,
            value => this.setParameters({ ha: value }), '%', 'ha'));
        container.appendChild(this.createParameterControl(
            'Noise Amount', 0, 200, 1, this.na,
            value => this.setParameters({ na: value }), '%', 'na'));
        container.appendChild(this.createRadioGroup(
            'Cutoff', BANDWIDTH_EXTENDER_CUTOFF_MODES, this.cm,
            value => this.setParameters({ cm: value }), 'cm'));
        this._manualCutoffRow = this.createParameterControl(
            'Manual Cutoff', 6000, 24000, 100, this.cf,
            value => this.setParameters({ cf: value }), 'Hz', 'cf');
        container.appendChild(this._manualCutoffRow);
        container.appendChild(this._createStatusElement());
        this._syncCutoffVisibility();
        return container;
    }
}

window.BandwidthExtenderPlugin = BandwidthExtenderPlugin;
