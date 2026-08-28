const BLUETOOTH_SBC_SIMULATOR_SAMPLE_RATES = Object.freeze([
    44100, 48000, 88200, 96000, 176400, 192000, 352800, 384000
]);
const BLUETOOTH_SBC_SIMULATOR_BLOCKS = Object.freeze(['4', '8', '12', '16']);
const BLUETOOTH_SBC_SIMULATOR_CHANNEL_MODES = Object.freeze([
    'Joint Stereo', 'Stereo', 'Dual Channel'
]);
const BLUETOOTH_SBC_SIMULATOR_PASS_THROUGH_PROCESSOR = 'return data;';
const BLUETOOTH_SBC_SIMULATOR_BYPASS_REASONS = Object.freeze({
    unsupportedSampleRate: 'This sample rate is not supported.',
    unsupportedChannelMode: 'This channel setting is not supported.',
    wasmUnavailable: 'WASM audio processing is unavailable.',
    rolloutDisabled: 'DSP processing is disabled.',
    runtimeFallback: 'Audio processing was interrupted.',
    engineStopped: 'Audio processing has stopped.'
});

class BluetoothSBCSimulatorPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({
        requiresWasm: true,
        supportedSampleRates: BLUETOOTH_SBC_SIMULATOR_SAMPLE_RATES,
        supportedChannelModes: Object.freeze(['mono', 'stereo-pair'])
    });

    static codecRateForHostRate(hostSampleRate) {
        const rate = Number(hostSampleRate);
        return rate === 44100 || rate === 88200 || rate === 176400 || rate === 352800
            ? 44100
            : 48000;
    }

    static bitrateForSettings({
        hostSampleRate = 48000,
        bitpool = 35,
        channelMode = 'Joint Stereo',
        blocks = 16,
        codecChannels = 2
    } = {}) {
        const codecRate = this.codecRateForHostRate(hostSampleRate);
        const normalizedBitpool = Math.round(Number(bitpool));
        const normalizedBlocks = Math.round(Number(blocks));
        const headerAndScaleFactors = codecChannels === 1
            ? 8
            : (channelMode === 'Joint Stereo' ? 13 : 12);
        // Dual Channel spends a full bitpool on each channel, so its audio payload is twice as
        // long as Stereo at the same bitpool. Mono and the shared-bitpool modes carry one.
        const payloadChannels = codecChannels === 2 && channelMode === 'Dual Channel' ? 2 : 1;
        const frameBytes = headerAndScaleFactors +
            Math.ceil(normalizedBlocks * normalizedBitpool * payloadChannels / 8);
        return frameBytes * codecRate / normalizedBlocks;
    }

    constructor() {
        super('SBC Codec Simulator',
            'Simulates a Bluetooth A2DP SBC encode and decode round trip, ' +
            'with optional link packet loss and frame concealment');
        this.bp = 35;
        this.cm = 'Joint Stereo';
        this.bl = '16';
        this.og = 0;
        this.mx = 100;
        this.pl = 0;
        this.temporalCapability = 'reset-on-resume';
        this.executionState = { state: 'pending', reason: null };
        this._statusElement = null;
        this.hostSampleRate = this._engineSampleRate();
        this.activeCodecChannels = 2;
        this.bitrateElement = null;
        this.registerProcessor(BLUETOOTH_SBC_SIMULATOR_PASS_THROUGH_PROCESSOR);
    }

    getTemporalCapability() {
        return 'reset-on-resume';
    }

    _engineSampleRate() {
        const candidates = [
            this.hostSampleRate,
            window.workletNode?.context?.sampleRate,
            window.audioContext?.sampleRate,
            window.uiManager?.audioManager?.audioContext?.sampleRate
        ];
        const rate = candidates.find(value => Number.isFinite(value) && value > 0);
        return rate || 48000;
    }

    getParameters(options = {}) {
        const sampleRate = Number.isFinite(options.sampleRate) && options.sampleRate > 0
            ? options.sampleRate
            : this.hostSampleRate;
        const outputChannelCount = Number.isInteger(options.outputChannelCount) &&
            options.outputChannelCount >= 1 && options.outputChannelCount <= 16
            ? options.outputChannelCount
            : this.activeCodecChannels;
        const codecChannels = outputChannelCount === 1 ? 1 : 2;
        if (options.commitSampleRate &&
            (sampleRate !== this.hostSampleRate || codecChannels !== this.activeCodecChannels)) {
            this.hostSampleRate = sampleRate;
            this.activeCodecChannels = codecChannels;
            this._refreshBitrate();
        }
        return {
            type: this.constructor.name,
            bp: this.bp,
            cm: this.cm,
            bl: this.bl,
            og: this.og,
            mx: this.mx,
            pl: this.pl,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.bp !== undefined) {
            this.bp = Math.round(this.parseFiniteNumber(params.bp, 2, 53, this.bp));
        }
        if (params.cm !== undefined) {
            this.cm = this.isAllowedEnum(params.cm,
                BLUETOOTH_SBC_SIMULATOR_CHANNEL_MODES, this.cm);
        }
        if (params.bl !== undefined) {
            this.bl = this.isAllowedEnum(String(params.bl),
                BLUETOOTH_SBC_SIMULATOR_BLOCKS, this.bl);
        }
        if (params.og !== undefined) {
            this.og = Math.round(this.parseFiniteNumber(params.og, -24, 12, this.og) * 10) / 10;
        }
        if (params.mx !== undefined) {
            this.mx = Math.round(this.parseFiniteNumber(params.mx, 0, 100, this.mx));
        }
        if (params.pl !== undefined) {
            this.pl = Math.round(this.parseFiniteNumber(params.pl, 0, 20, this.pl) * 10) / 10;
        }
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        this._refreshBitrate();
        this.updateParameters();
    }

    onMessage(message) {
        if (message?.pluginId !== this.id) return;
        if (Number.isFinite(message.sampleRate) && message.sampleRate > 0) {
            this.hostSampleRate = message.sampleRate;
            this._refreshBitrate();
        }
        if (message.type !== 'dspExecutionState' ||
            message.pluginType !== this.constructor.name || message.validated !== true) return;
        this.executionState = { state: message.state, reason: message.reason || null };
        this._renderStatusMessage();
    }

    // The engine passes audio through untouched whenever this WASM-only plugin
    // cannot run, so the UI has to say why instead of looking simply broken.
    _executionStatusText() {
        if (this.executionState.state !== 'bypassed') return '';
        const reason = BLUETOOTH_SBC_SIMULATOR_BYPASS_REASONS[this.executionState.reason];
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

    _bitrateText() {
        const bitsPerSecond = this.constructor.bitrateForSettings({
            hostSampleRate: this.hostSampleRate || this._engineSampleRate(),
            bitpool: this.bp,
            channelMode: this.cm,
            blocks: Number(this.bl),
            codecChannels: this.activeCodecChannels
        });
        return `${(bitsPerSecond / 1000).toFixed(1)} kbit/s`;
    }

    _refreshBitrate() {
        if (this.bitrateElement) this.bitrateElement.textContent = this._bitrateText();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'bluetooth-sbc-simulator-plugin-ui plugin-parameter-ui';
        container.appendChild(this.createParameterControl(
            'Bitpool', 2, 53, 1, this.bp, value => this.setParameters({ bp: value }), '', 'bp'));
        container.appendChild(this.createRadioGroup(
            'Channel Mode', BLUETOOTH_SBC_SIMULATOR_CHANNEL_MODES, this.cm,
            value => this.setParameters({ cm: value }), 'cm'));
        container.appendChild(this.createSelectControl(
            'Blocks', BLUETOOTH_SBC_SIMULATOR_BLOCKS, this.bl,
            value => this.setParameters({ bl: value }), 'bl'));

        const bitrateRow = document.createElement('div');
        bitrateRow.className = 'parameter-row';
        const bitrateId = `${this.id}-${this.name}-bitrate-output`;
        const bitrateLabel = document.createElement('label');
        bitrateLabel.textContent = 'Bitrate:';
        bitrateLabel.htmlFor = bitrateId;
        this.bitrateElement = document.createElement('output');
        this.bitrateElement.id = bitrateId;
        this.bitrateElement.className = 'parameter-value';
        this.bitrateElement.setAttribute('aria-live', 'polite');
        this.bitrateElement.setAttribute('aria-atomic', 'true');
        bitrateRow.appendChild(bitrateLabel);
        bitrateRow.appendChild(this.bitrateElement);
        container.appendChild(bitrateRow);
        this._refreshBitrate();

        container.appendChild(this.createParameterControl(
            'Packet Loss', 0, 20, 0.1, this.pl,
            value => this.setParameters({ pl: value }), '%', 'pl'));
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

window.BluetoothSBCSimulatorPlugin = BluetoothSBCSimulatorPlugin;
