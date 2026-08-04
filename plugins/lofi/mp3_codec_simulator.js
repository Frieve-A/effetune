const MP3_CODEC_SIMULATOR_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
]);
const MP3_CODEC_SIMULATOR_MPEG1_BITRATES = Object.freeze([
    '32', '48', '64', '80', '96', '112', '128', '160', '192', '224', '256', '320'
]);
const MP3_CODEC_SIMULATOR_MPEG2_BITRATES = Object.freeze([
    '32', '48', '64', '80', '96', '112', '128', '160'
]);
const MP3_CODEC_SIMULATOR_PASS_THROUGH_PROCESSOR = `return data;`;
const MP3_CODEC_SIMULATOR_BYPASS_REASONS = Object.freeze({
    unsupportedSampleRate: 'This sample rate is not supported.',
    unsupportedChannelMode: 'This channel setting is not supported.',
    wasmUnavailable: 'WASM audio processing is unavailable.',
    rolloutDisabled: 'DSP processing is disabled.',
    runtimeFallback: 'Audio processing was interrupted.',
    engineStopped: 'Audio processing has stopped.'
});

class MP3CodecSimulatorPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: MP3_CODEC_SIMULATOR_SAMPLE_RATES,
        supportedChannelModes: Object.freeze(['mono', 'stereo-pair'])
    });

    constructor() {
        super('MP3 Codec Simulator',
            'Simulates a clean low-bitrate MPEG Layer III encode and decode round trip');
        this.cr = '44.1 kHz (MPEG-1)';
        this.br = '64';
        this.sm = 'Joint Stereo';
        this.rv = true;
        this.og = 0;
        this.mx = 100;
        this.temporalCapability = 'reset-on-resume';
        this.executionState = { state: 'pending', reason: null };
        this._statusElement = null;
        this.bitrateSelect = null;
        this.registerProcessor(MP3_CODEC_SIMULATOR_PASS_THROUGH_PROCESSOR);
    }

    getTemporalCapability() {
        return 'reset-on-resume';
    }

    getParameters() {
        return {
            type: this.constructor.name,
            cr: this.cr,
            br: this.br,
            sm: this.sm,
            rv: this.rv,
            og: this.og,
            mx: this.mx,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.cr !== undefined) {
            this.cr = this.isAllowedEnum(params.cr,
                ['22.05 kHz (MPEG-2)', '44.1 kHz (MPEG-1)'], this.cr);
        }
        const bitrates = this.cr === '22.05 kHz (MPEG-2)'
            ? MP3_CODEC_SIMULATOR_MPEG2_BITRATES
            : MP3_CODEC_SIMULATOR_MPEG1_BITRATES;
        if (params.br !== undefined) {
            this.br = this.isAllowedEnum(String(params.br), bitrates,
                bitrates.includes(this.br) ? this.br : '160');
        } else if (!bitrates.includes(this.br)) {
            this.br = '160';
        }
        if (params.sm !== undefined) {
            this.sm = this.isAllowedEnum(params.sm, ['Joint Stereo', 'Stereo'], this.sm);
        }
        if (params.rv !== undefined) {
            this.rv = this.isAllowedEnum(params.rv, [true, false], this.rv);
        }
        if (params.og !== undefined) {
            this.og = Math.round(this.parseFiniteNumber(params.og, -24, 12, this.og) * 10) / 10;
        }
        if (params.mx !== undefined) {
            this.mx = Math.round(this.parseFiniteNumber(params.mx, 0, 100, this.mx));
        }
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        this._syncBitrateOptions();
        this.updateParameters();
    }

    onMessage(message) {
        if (message?.type !== 'dspExecutionState' || message.pluginId !== this.id ||
            message.pluginType !== this.constructor.name || message.validated !== true) return;
        this.executionState = { state: message.state, reason: message.reason || null };
        this._renderStatusMessage();
    }

    // The engine passes audio through untouched whenever this WASM-only plugin
    // cannot run, so the UI has to say why instead of looking simply broken.
    _executionStatusText() {
        if (this.executionState.state !== 'bypassed') return '';
        const reason = MP3_CODEC_SIMULATOR_BYPASS_REASONS[this.executionState.reason];
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

    static _bitrateOptions(values) {
        return values.map(value => ({ value, label: `${value} kbit/s` }));
    }

    _syncBitrateOptions() {
        if (!this.bitrateSelect) return;
        const values = this.cr === '22.05 kHz (MPEG-2)'
            ? MP3_CODEC_SIMULATOR_MPEG2_BITRATES
            : MP3_CODEC_SIMULATOR_MPEG1_BITRATES;
        const current = this.br;
        this.bitrateSelect.replaceChildren();
        for (const value of values) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = `${value} kbit/s`;
            this.bitrateSelect.appendChild(option);
        }
        this.bitrateSelect.value = values.includes(current) ? current : '160';
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'mp3-codec-simulator-plugin-ui plugin-parameter-ui';
        container.appendChild(this.createSelectControl('Codec Rate',
            ['22.05 kHz (MPEG-2)', '44.1 kHz (MPEG-1)'], this.cr,
            value => this.setParameters({ cr: value })));
        const bitrateRow = this.createSelectControl('Bitrate',
            this.constructor._bitrateOptions(this.cr === '22.05 kHz (MPEG-2)'
                ? MP3_CODEC_SIMULATOR_MPEG2_BITRATES
                : MP3_CODEC_SIMULATOR_MPEG1_BITRATES),
            this.br, value => this.setParameters({ br: value }));
        // createSelectControl returns the row only, so keep the select element
        // reference that _syncBitrateOptions() rebuilds on codec-rate changes.
        this.bitrateSelect = bitrateRow.querySelector('select');
        this._syncBitrateOptions();
        container.appendChild(bitrateRow);
        container.appendChild(this.createRadioGroup('Stereo Mode',
            ['Joint Stereo', 'Stereo'], this.sm,
            value => this.setParameters({ sm: value })));

        const reservoirRow = document.createElement('div');
        reservoirRow.className = 'parameter-row';
        const reservoirLabel = document.createElement('label');
        const reservoir = document.createElement('input');
        const reservoirId = `${this.id}-bit-reservoir`;
        reservoirLabel.textContent = 'Bit Reservoir:';
        reservoirLabel.htmlFor = reservoirId;
        reservoir.type = 'checkbox';
        reservoir.id = reservoirId;
        reservoir.name = reservoirId;
        reservoir.checked = this.rv;
        reservoir.autocomplete = 'off';
        reservoir.addEventListener('change', event => this.setParameters({ rv: event.target.checked }));
        reservoirRow.appendChild(reservoirLabel);
        reservoirRow.appendChild(reservoir);
        container.appendChild(reservoirRow);

        container.appendChild(this.createParameterControl(
            'Output', -24, 12, 0.1, this.og, value => this.setParameters({ og: value }), 'dB'));
        container.appendChild(this.createParameterControl(
            'Mix', 0, 100, 1, this.mx, value => this.setParameters({ mx: value }), '%'));
        container.appendChild(this._createStatusElement());
        return container;
    }
}

window.MP3CodecSimulatorPlugin = MP3CodecSimulatorPlugin;
