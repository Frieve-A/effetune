class SaturationPlugin extends PluginBase {
    constructor() {
        super('Saturation', 'Saturation effect with drive and bias control');
        this.os = 1;
        this.dr = 1.5;   // dr: Drive (0.0-10.0)
        this.bs = 0.1;   // bs: Bias (-0.3 to 0.3)
        this.mx = 100;   // mx: Mix (0-100%)
        this.gn = -2;    // gn: Gain (-18 to +18 dB)

        // Register processor with ideal up/downsampling including anti-alias filtering during decimation.
        this.registerProcessor(`
            if (!parameters.enabled) return data;
            ${PluginBase.oversamplingProcessorSource(8, 1)}
            const {
                dr: drive,
                bs: bias,
                mx: mix,
                gn: gain,
                channelCount,
                blockSize,
                sampleRate
            } = parameters;
            const nextDrive = Math.fround(drive);
            const nextBias = Math.fround(bias);
            const nextMix = Math.fround(mix) / 100;
            const nextGain = Math.pow(10, Math.fround(gain) / 20);
            const nextBiasOffset = Math.fround(Math.tanh(nextDrive * nextBias));
            const rampFrames = Math.max(1, Math.ceil(sampleRate * 0.005));
            if (context.saturationCurrentDrive === undefined) {
                context.saturationCurrentDrive = nextDrive;
                context.saturationCurrentBias = nextBias;
                context.saturationCurrentMix = nextMix;
                context.saturationCurrentGain = nextGain;
                context.saturationCurrentBiasOffset = nextBiasOffset;
                context.saturationTargetDrive = nextDrive;
                context.saturationTargetBias = nextBias;
                context.saturationTargetMix = nextMix;
                context.saturationTargetGain = nextGain;
                context.saturationTargetBiasOffset = nextBiasOffset;
                context.saturationStepDrive = 0;
                context.saturationStepBias = 0;
                context.saturationStepMix = 0;
                context.saturationStepGain = 0;
                context.saturationStepBiasOffset = 0;
                context.saturationRemaining = 0;
            } else if (nextDrive !== context.saturationTargetDrive ||
                nextBias !== context.saturationTargetBias ||
                nextMix !== context.saturationTargetMix ||
                nextGain !== context.saturationTargetGain ||
                nextBiasOffset !== context.saturationTargetBiasOffset) {
                context.saturationTargetDrive = nextDrive;
                context.saturationTargetBias = nextBias;
                context.saturationTargetMix = nextMix;
                context.saturationTargetGain = nextGain;
                context.saturationTargetBiasOffset = nextBiasOffset;
                context.saturationStepDrive =
                    (nextDrive - context.saturationCurrentDrive) / rampFrames;
                context.saturationStepBias =
                    (nextBias - context.saturationCurrentBias) / rampFrames;
                context.saturationStepMix =
                    (nextMix - context.saturationCurrentMix) / rampFrames;
                context.saturationStepGain =
                    (nextGain - context.saturationCurrentGain) / rampFrames;
                context.saturationStepBiasOffset =
                    (nextBiasOffset - context.saturationCurrentBiasOffset) / rampFrames;
                context.saturationRemaining = rampFrames;
            }

            let currentDrive = context.saturationCurrentDrive;
            let currentBias = context.saturationCurrentBias;
            let currentMix = context.saturationCurrentMix;
            let currentGain = context.saturationCurrentGain;
            let currentBiasOffset = context.saturationCurrentBiasOffset;
            const shapeSaturation = sample => {
                const shapedInput = Math.fround(currentDrive * (sample + currentBias));
                return Math.fround(Math.tanh(shapedInput)) - currentBiasOffset;
            };
            for (let frame = 0; frame < blockSize; ++frame) {
                if (context.saturationRemaining > 0) {
                    currentDrive += context.saturationStepDrive;
                    currentBias += context.saturationStepBias;
                    currentMix += context.saturationStepMix;
                    currentGain += context.saturationStepGain;
                    currentBiasOffset += context.saturationStepBiasOffset;
                    if (--context.saturationRemaining === 0) {
                        currentDrive = context.saturationTargetDrive;
                        currentBias = context.saturationTargetBias;
                        currentMix = context.saturationTargetMix;
                        currentGain = context.saturationTargetGain;
                        currentBiasOffset = context.saturationTargetBiasOffset;
                    }
                }
                for (let channel = 0; channel < channelCount; ++channel) {
                    const index = channel * blockSize + frame;
                    const dry = data[index];
                    const wet = shapeSample(channel, dry, shapeSaturation);
                    const delayedDry = delaySample(channel, dry);
                    data[index] = (delayedDry * (1 - currentMix) + wet * currentMix) * currentGain;
                }
            }
            context.saturationCurrentDrive = currentDrive;
            context.saturationCurrentBias = currentBias;
            context.saturationCurrentMix = currentMix;
            context.saturationCurrentGain = currentGain;
            context.saturationCurrentBiasOffset = currentBiasOffset;
            return data;
        `);
    }

    setParameters(params) {
        if (params.os !== undefined) {
            this.os = this.isAllowedEnum(Number(params.os), [1, 2, 4, 8], this.os);
        }
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
            os: this.os,
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
        ctx.strokeStyle = (window.ThemePalette?.get('graph-grid') ?? '');
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
        ctx.fillStyle = (window.ThemePalette?.get('text-primary') ?? '');
        ctx.font = '28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('in', width / 2, height - 5);
        ctx.save();
        ctx.translate(20, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('out', 0, 0);
        ctx.restore();
        ctx.fillStyle = (window.ThemePalette?.get('graph-label') ?? '');
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
        ctx.strokeStyle = (window.ThemePalette?.get('graph-trace') ?? '');
        ctx.lineWidth = 2;
        ctx.beginPath();
        const mixRatio = this.mx / 100;
        for (let i = 0; i < width; i++) {
            const x = this._transferX(i, width);
            const canvasY = this._transferY(x, height, mixRatio);
            if (i === 0) {
                ctx.moveTo(i, canvasY);
            } else {
                ctx.lineTo(i, canvasY);
            }
        }
        ctx.stroke();

        const frame = (this._readoutFrame ??= {});
        frame.width = width;
        frame.height = height;
        frame.mixRatio = mixRatio;
        frame.valid = true;
        this._graphReadout?.refresh();
    }

    // Input level plotted at canvas x (the transfer graph spans -1..1 across the full width).
    _transferX(x, width) {
        return (x / width) * 2 - 1;
    }

    // Canvas y of the transfer curve's output for an input on the -1..1 axis.
    _transferY(x, height, mixRatio = this.mx / 100) {
        const wet = Math.tanh(this.dr * (x + this.bs)) - Math.tanh(this.dr * this.bs);
        const y = ((1 - mixRatio) * x + mixRatio * wet) * Math.pow(10, this.gn / 20);
        return ((1 - y) / 2) * height;
    }

    // Reads the transfer curve at canvas pixel x.
    _readGraph(x) {
        const frame = this._readoutFrame;
        if (!frame?.valid) return null;
        const { format } = window.GraphReadout;
        const inValue = this._transferX(x, frame.width);
        const y = this._transferY(inValue, frame.height, frame.mixRatio);
        const outValue = 1 - 2 * y / frame.height;
        return {
            cursor: `in ${format.number(inValue)}`,
            rows: [{ label: 'out', color: (window.ThemePalette?.get('graph-trace') ?? ''), value: format.number(outValue), y }],
            at: { x, y }
        };
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'saturation-plugin-ui plugin-parameter-ui';
        container.appendChild(this.createSelectControl(
            'Oversampling', [1, 2, 4, 8].map(value => ({ value, label: value + 'x' })),
            this.os, value => this.setParameters({ os: Number(value) }), 'os'
        ));

        // Use base helper to create controls
        container.appendChild(this.createParameterControl(
            'Drive', 0, 10, 0.1, this.dr,
            this.setDr.bind(this), '', 'dr'
        ));

        container.appendChild(this.createParameterControl(
            'Bias', -0.3, 0.3, 0.01, this.bs,
            this.setBs.bind(this), '', 'bs'
        ));

        container.appendChild(this.createParameterControl(
            'Mix', 0, 100, 1, this.mx,
            this.setMx.bind(this), '%', 'mx'
        ));

        // Graph container for canvas and labels
        const graphContainer = document.createElement('div');
        graphContainer.style.position = 'relative';
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        canvas.style.width = '200px';
        canvas.style.height = '200px';
        canvas.style.backgroundColor = 'var(--et-graph-bg-deep)';
        this.canvas = canvas;
        this.updateTransferGraph(); // Initial graph draw
        graphContainer.appendChild(canvas);
        container.appendChild(graphContainer);
        this._graphReadout = window.GraphReadout?.attach({
            mount: graphContainer,
            surface: canvas,
            read: x => this._readGraph(x),
            crosshair: 'xy'
        });

        // Gain control
        container.appendChild(this.createParameterControl(
            'Gain', -18, 18, 0.1, this.gn,
            this.setGn.bind(this), 'dB', 'gn'
        ));

        return container;
    }
}

window.SaturationPlugin = SaturationPlugin;
