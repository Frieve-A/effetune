class MSMatrixPlugin extends PluginBase {
    constructor() {
        super('MS Matrix', 'Mid/Side processing matrix');

        this.md = 0;
        this.mg = 0;
        this.sg = 0;
        this.sw = 0;

        this.registerProcessor(`
            if (parameters.channelCount !== 2 || !parameters.enabled) {
                return data;
            }

            const mode = parameters.md;
            const midGain = Math.pow(10, parameters.mg / 20);
            const sideGain = Math.pow(10, parameters.sg / 20);
            const doSwap = parameters.sw === 1;
            const blockSize = parameters.blockSize;
            const leftOfs = 0;
            const rightOfs = blockSize;

            let L, R, M, S, Mout, Sout;

            if (mode === 0) { // Encode: Stereo → M/S
                if (doSwap) {
                    for (let i = 0; i < blockSize; ++i) {
                        L = data[rightOfs + i]; // Swapped R
                        R = data[leftOfs + i];  // Swapped L
                        M = (L + R) * 0.5;
                        S = (L - R) * 0.5;
                        data[leftOfs + i]  = M * midGain;
                        data[rightOfs + i] = S * sideGain;
                    }
                } else {
                    for (let i = 0; i < blockSize; ++i) {
                        L = data[leftOfs + i];
                        R = data[rightOfs + i];
                        M = (L + R) * 0.5;
                        S = (L - R) * 0.5;
                        data[leftOfs + i]  = M * midGain;
                        data[rightOfs + i] = S * sideGain;
                    }
                }
            } else { // Decode: M/S → Stereo
                if (doSwap) {
                    for (let i = 0; i < blockSize; ++i) {
                        M = data[leftOfs + i];
                        S = data[rightOfs + i];
                        Mout = M * midGain;
                        Sout = S * sideGain;
                        data[leftOfs + i]  = Mout - Sout; // Original R -> Swapped L out
                        data[rightOfs + i] = Mout + Sout; // Original L -> Swapped R out
                    }
                } else {
                    for (let i = 0; i < blockSize; ++i) {
                        M = data[leftOfs + i];
                        S = data[rightOfs + i];
                        Mout = M * midGain;
                        Sout = S * sideGain;
                        data[leftOfs + i]  = Mout + Sout; // Original L
                        data[rightOfs + i] = Mout - Sout; // Original R
                    }
                }
            }
            return data;
        `);
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            md: this.md,
            mg: this.mg,
            sg: this.sg,
            sw: this.sw,
        };
    }

    setParameters(params) {
        const { md, mg, sg, sw, enabled } = params;

        if (md !== undefined) {
            const v = parseInt(md, 10);
            if (v === 0 || v === 1) this.md = v;
        }
        if (mg !== undefined) {
            const v = Number(mg);
            if (!isNaN(v)) this.mg = Math.max(-18, Math.min(18, v));
        }
        if (sg !== undefined) {
            const v = Number(sg);
            if (!isNaN(v)) this.sg = Math.max(-18, Math.min(18, v));
        }
        if (sw !== undefined) {
            const v = parseInt(sw, 10);
            if (v === 0 || v === 1) this.sw = v;
        }
        if (enabled !== undefined) {
            this.enabled = !!enabled;
        }
        this.updateParameters();
    }

    setMode(v)    { this.setParameters({ md: v }); }
    setMidGain(v) { this.setParameters({ mg: v }); }
    setSideGain(v){ this.setParameters({ sg: v }); }
    setSwap(v)    { this.setParameters({ sw: v }); }

    createUI() {
        const container = document.createElement('div');
        container.className = 'ms-matrix-plugin-ui plugin-parameter-ui';

        container.appendChild(this.createRadioGroup(
            'Mode',
            [{ label: 'Encode', value: '0' }, { label: 'Decode', value: '1' }],
            String(this.md),
            value => this.setMode(parseInt(value, 10))
        ));

        container.appendChild(this.createParameterControl(
            'Mid Gain', -18, 18, 0.1, this.mg,
            v => this.setMidGain(v), 'dB'
        ));

        container.appendChild(this.createParameterControl(
            'Side Gain', -18, 18, 0.1, this.sg,
            v => this.setSideGain(v), 'dB'
        ));

        container.appendChild(this.createCheckboxControl(
            'Swap L/R',
            this.sw === 1,
            checked => this.setSwap(checked ? 1 : 0)
        ));

        return container;
    }
}

window.MSMatrixPlugin = MSMatrixPlugin;
