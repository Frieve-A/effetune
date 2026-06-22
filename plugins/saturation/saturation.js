class SaturationPlugin extends PluginBase {
    constructor() {
        super('Saturation', 'Saturation effect with drive and bias control');
        this.dr = 1.5;   // dr: Drive (0.0-10.0)
        this.bs = 0.1;   // bs: Bias (-0.3 to 0.3)
        this.mx = 100;   // mx: Mix (0-100%)
        this.gn = -2;    // gn: Gain (-18 to +18 dB)

        // Register processor with ideal up/downsampling including anti-alias filtering during decimation.
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            const {
                dr: drive,
                bs: bias,
                mx: mix,
                gn: gain,
                channelCount,
                blockSize,
                sampleRate
            } = parameters;
            const mixRatio = mix / 100;
            const gainLinear = Math.pow(10, gain / 20);
            const biasOffset = Math.tanh(drive * bias);

            const len = data.length;
            for (let i = 0; i < len; i++) {
                const dry = data[i];
                const wet = Math.tanh(drive * (dry + bias)) - biasOffset;
                data[i] = (dry * (1 - mixRatio) + wet * mixRatio) * gainLinear;
            }
            return data;
        `);
    }

    setParameters(params) {
        let graphNeedsUpdate = false;
        if (params.dr !== undefined) {
            this.dr = this.parseFiniteNumber(params.dr, 0, 10, this.dr);
            graphNeedsUpdate = true;
        }
        if (params.bs !== undefined) {
            this.bs = this.parseFiniteNumber(params.bs, -0.3, 0.3, this.bs);
            graphNeedsUpdate = true;
        }
        if (params.mx !== undefined) {
            this.mx = this.parseFiniteNumber(params.mx, 0, 100, this.mx);
            graphNeedsUpdate = true;
        }
        if (params.gn !== undefined) {
            this.gn = this.parseFiniteNumber(params.gn, -18, 18, this.gn);
            graphNeedsUpdate = true;
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        this.updateParameters();
        if (graphNeedsUpdate) {
            this.updateTransferGraph();
        }
    }

    // Set drive amount (0.0-10.0)
    setDr(value) { this.setParameters({ dr: value }); }

    // Set bias amount (-0.3 to 0.3)
    setBs(value) { this.setParameters({ bs: value }); }

    // Set mix ratio (0-100%)
    setMx(value) { this.setParameters({ mx: value }); }

    // Set output gain (-18 to +18 dB)
    setGn(value) { this.setParameters({ gn: value }); }

    getParameters() {
        return {
            type: this.constructor.name,
            dr: this.dr,
            bs: this.bs,
            mx: this.mx,
            gn: this.gn,
            enabled: this.enabled
        };
    }

    updateTransferGraph() {
        const canvas = this.canvas;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        ctx.clearRect(0, 0, width, height);
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        for (let x = 0; x <= width; x += width / 4) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let y = 0; y <= height; y += height / 4) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        ctx.fillStyle = '#fff';
        ctx.font = '28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('in', width / 2, height - 5);
        ctx.save();
        ctx.translate(20, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('out', 0, 0);
        ctx.restore();
        ctx.fillStyle = '#666';
        ctx.font = '20px Arial';
        ctx.fillText('-6dB', width * 0.25, height - 5);
        ctx.fillText('-6dB', width * 0.75, height - 5);
        ctx.save();
        ctx.translate(20, height * 0.25);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('-6dB', 0, 0);
        ctx.restore();
        ctx.save();
        ctx.translate(20, height * 0.75);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('-6dB', 0, 0);
        ctx.restore();
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        const mixRatio = this.mx / 100;
        for (let i = 0; i < width; i++) {
            const x = (i / width) * 2 - 1;
            const wet = Math.tanh(this.dr * (x + this.bs)) - Math.tanh(this.dr * this.bs);
            const y = ((1 - mixRatio) * x + mixRatio * wet) * Math.pow(10, this.gn / 20);
            const canvasY = ((1 - y) / 2) * height;
            if (i === 0) {
                ctx.moveTo(i, canvasY);
            } else {
                ctx.lineTo(i, canvasY);
            }
        }
        ctx.stroke();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'saturation-plugin-ui plugin-parameter-ui';

        // Use base helper to create controls
        container.appendChild(this.createParameterControl(
            'Drive', 0, 10, 0.1, this.dr,
            this.setDr.bind(this)
        ));

        container.appendChild(this.createParameterControl(
            'Bias', -0.3, 0.3, 0.01, this.bs,
            this.setBs.bind(this)
        ));

        container.appendChild(this.createParameterControl(
            'Mix', 0, 100, 1, this.mx,
            this.setMx.bind(this), '%'
        ));

        // Graph container for canvas and labels
        const graphContainer = document.createElement('div');
        graphContainer.style.position = 'relative';
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        canvas.style.width = '200px';
        canvas.style.height = '200px';
        canvas.style.backgroundColor = '#222';
        this.canvas = canvas;
        this.updateTransferGraph(); // Initial graph draw
        graphContainer.appendChild(canvas);
        container.appendChild(graphContainer);

        // Gain control
        container.appendChild(this.createParameterControl(
            'Gain', -18, 18, 0.1, this.gn,
            this.setGn.bind(this), 'dB'
        ));

        return container;
    }
}

window.SaturationPlugin = SaturationPlugin;
