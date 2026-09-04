const NOISE_REDUCTION_PASS_THROUGH_PROCESSOR = 'return data;';

class NoiseReductionPlugin extends PluginBase {
    static executionCapabilities = Object.freeze({ requiresWasm: true });

    constructor() {
        super('Noise Reduction', 'Reduces steady background noise while preserving the music');
        this.temporalCapability = 'reset-on-resume';
        this.rd = 12;
        this.sn = 0;
        this.sm = 50;
        this.hf = 50;
        this.mix = 100;
        this.registerProcessor(NOISE_REDUCTION_PASS_THROUGH_PROCESSOR);
    }

    setParameters(params = {}) {
        if (!params || typeof params !== 'object') return;
        if (params.rd !== undefined) this.rd = this.parseFiniteNumber(params.rd, 0, 24, this.rd);
        if (params.sn !== undefined) this.sn = this.parseFiniteNumber(params.sn, -12, 12, this.sn);
        if (params.sm !== undefined) this.sm = this.parseFiniteNumber(params.sm, 0, 100, this.sm);
        if (params.hf !== undefined) this.hf = this.parseFiniteNumber(params.hf, 0, 100, this.hf);
        if (params.mix !== undefined) this.mix = this.parseFiniteNumber(params.mix, 0, 100, this.mix);
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        this.updateParameters();
    }

    setRd(value) { this.setParameters({ rd: value }); }
    setSn(value) { this.setParameters({ sn: value }); }
    setSm(value) { this.setParameters({ sm: value }); }
    setHf(value) { this.setParameters({ hf: value }); }
    setMix(value) { this.setParameters({ mix: value }); }

    getParameters() {
        return {
            type: this.constructor.name,
            rd: this.rd,
            sn: this.sn,
            sm: this.sm,
            hf: this.hf,
            mix: this.mix,
            enabled: this.enabled
        };
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';
        container.appendChild(this.createParameterControl(
            'Reduction', 0, 24, 0.5, this.rd, value => this.setRd(value), 'dB', 'rd'));
        container.appendChild(this.createParameterControl(
            'Sensitivity', -12, 12, 0.5, this.sn, value => this.setSn(value), 'dB', 'sn'));
        container.appendChild(this.createParameterControl(
            'Smoothing', 0, 100, 1, this.sm, value => this.setSm(value), '%', 'sm'));
        container.appendChild(this.createParameterControl(
            'Treble Care', 0, 100, 1, this.hf, value => this.setHf(value), '%', 'hf'));
        container.appendChild(this.createParameterControl(
            'Mix', 0, 100, 1, this.mix, value => this.setMix(value), '%', 'mix'));
        return container;
    }

    cleanup() {
        super.cleanup();
    }
}

window.NoiseReductionPlugin = NoiseReductionPlugin;
