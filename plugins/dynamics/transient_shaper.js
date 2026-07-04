class TransientShaperPlugin extends PluginBase {
    constructor() {
        super('Transient Shaper', 'Controls transient and sustain portions of the signal');

        this.fa = 1.0;   // Fast attack (ms)
        this.fr = 20.0;  // Fast release (ms)
        this.sa = 20.0;  // Slow attack (ms)
        this.sr = 300.0; // Slow release (ms)
        this.gt = 6.0;   // Transient gain (dB)
        this.gs = 0.0;   // Sustain gain (dB)
        this.sm = 5.0;   // Gain smoothing (ms)

        // Graph state
        this.canvas = null;
        this.canvasCtx = null;
        this.boundEventListeners = new Map();
        this.animationFrameId = null;
        this.graphResizeDispose = null;

        // Gain history buffer (1024 points) initialized with NaN so that no initial bottom line is drawn
        this.gainBuffer = new Float32Array(1024).fill(NaN);
        this.secondMarkers = [];
        this.prevTime = null;

        this.observer = null;

        this.registerProcessor(`
            if (!parameters.enabled) return data;

            const { fa, fr, sa, sr, gt, gs, sm, blockSize, channelCount, sampleRate } = parameters;

            const LN10_OVER_20 = Math.LN10 / 20;

            const gTr = Math.exp(gt * LN10_OVER_20);
            const gSus = Math.exp(gs * LN10_OVER_20);

            const aFaAtk = Math.exp(-1.0 / (fa * 0.001 * sampleRate));
            const aFaRel = Math.exp(-1.0 / (fr * 0.001 * sampleRate));
            const aSaAtk = Math.exp(-1.0 / (sa * 0.001 * sampleRate));
            const aSaRel = Math.exp(-1.0 / (sr * 0.001 * sampleRate));
            const aSmooth = Math.exp(-1.0 / (sm * 0.001 * sampleRate));

            if (!context.fastEnv || context.fastEnv.length !== channelCount) {
                context.fastEnv = new Float32Array(channelCount);
                context.slowEnv = new Float32Array(channelCount);
                context.gain = 1.0;
            }

            const fastEnv = context.fastEnv;
            const slowEnv = context.slowEnv;
            let g = context.gain;

            for (let i = 0; i < blockSize; i++) {
                let maxDiff = 0;

                for (let ch = 0; ch < channelCount; ch++) {
                    const index = ch * blockSize + i;
                    const xAbs = data[index] < 0 ? -data[index] : data[index];

                    const coeffFast = xAbs > fastEnv[ch] ? aFaAtk : aFaRel;
                    fastEnv[ch] = fastEnv[ch] * coeffFast + xAbs * (1 - coeffFast);

                    const coeffSlow = xAbs > slowEnv[ch] ? aSaAtk : aSaRel;
                    slowEnv[ch] = slowEnv[ch] * coeffSlow + xAbs * (1 - coeffSlow);

                    const diff = fastEnv[ch] - slowEnv[ch];
                    if (diff > maxDiff) maxDiff = diff;
                }

                const T = maxDiff > 0 ? maxDiff : 0;
                const gTrVal = 1 + (gTr - 1) * T;
                const gSusVal = 1 + (gSus - 1) * (1 - T);
                const target = gTrVal * gSusVal;

                g = (1 - aSmooth) * target + aSmooth * g;

                for (let ch = 0; ch < channelCount; ch++) {
                    const index = ch * blockSize + i;
                    let y = data[index] * g;
                    if (y > 1.0) y = 1.0;
                    else if (y < -1.0) y = -1.0;
                    data[index] = y;
                }
            }

            context.gain = g;

            // Add gain measurement for graph display
            const gainInDb = 20 * Math.log10(g);
            data.measurements = {
                gain: gainInDb,
                time: time
            };

            return data;
        `);
    }

    onMessage(message) {
        if (message.type === 'processBuffer' && message.measurements) {
            // Shift gain buffer
            this.gainBuffer.copyWithin(0, 1);

            // Shift marker positions
            this.secondMarkers = this.secondMarkers.map(v => v - 1).filter(v => v >= 0);

            const t = message.measurements.time;
            if (this.prevTime !== null && !Number.isNaN(t) && Math.floor(this.prevTime) !== Math.floor(t)) {
                this.secondMarkers.push(this.gainBuffer.length - 1);
            }
            this.prevTime = t;

            // Store gain value
            this.gainBuffer[this.gainBuffer.length - 1] = message.measurements.gain;
        }
    }

    setParameters(params) {
        if (params.fa !== undefined) this.fa = this.parseFiniteNumber(params.fa, 0.1, 10.0, this.fa);
        if (params.fr !== undefined) this.fr = this.parseFiniteNumber(params.fr, 1, 200, this.fr);
        if (params.sa !== undefined) this.sa = this.parseFiniteNumber(params.sa, 1, 100, this.sa);
        if (params.sr !== undefined) this.sr = this.parseFiniteNumber(params.sr, 50, 1000, this.sr);
        if (params.gt !== undefined) this.gt = this.parseFiniteNumber(params.gt, -24, 24, this.gt);
        if (params.gs !== undefined) this.gs = this.parseFiniteNumber(params.gs, -24, 24, this.gs);
        if (params.sm !== undefined) this.sm = this.parseFiniteNumber(params.sm, 0.1, 20.0, this.sm);
        if (params.enabled !== undefined) this.enabled = params.enabled;
        this.updateParameters();
    }

    setFa(value) { this.setParameters({ fa: value }); }
    setFr(value) { this.setParameters({ fr: value }); }
    setSa(value) { this.setParameters({ sa: value }); }
    setSr(value) { this.setParameters({ sr: value }); }
    setGt(value) { this.setParameters({ gt: value }); }
    setGs(value) { this.setParameters({ gs: value }); }
    setSm(value) { this.setParameters({ sm: value }); }

    getParameters() {
        return {
            type: this.constructor.name,
            fa: this.fa,
            fr: this.fr,
            sa: this.sa,
            sr: this.sr,
            gt: this.gt,
            gs: this.gs,
            sm: this.sm,
            enabled: this.enabled
        };
    }

    handleIntersect(entries) {
        entries.forEach(entry => {
            this.isVisible = entry.isIntersecting;
            if (this.isVisible) {
                this.startAnimation();
            } else {
                this.stopAnimation();
            }
        });
    }

    startAnimation() {
        if (!this.enabled || !this._sectionEnabled) return;
        if (this.animationFrameId) return;

        const animate = () => {
            if (!this.isVisible) {
                this.stopAnimation();
                return;
            }
            this.drawGraph();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        animate();
    }

    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    drawGraph() {
        if (!this.canvasCtx) return;
        const ctx = this.canvasCtx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const cssWidth = this.canvas.clientWidth || width;
        const dpr = cssWidth > 0 ? width / cssWidth : 1;
        const tickFontSize = 12 * dpr;
        const axisFontSize = 14 * dpr;
        const labelX = 80 * dpr;
        const axisX = 20 * dpr;
        const tickOffset = 6 * dpr;
        const bottomOffset = 5 * dpr;
        const isMobileLayout = typeof document !== 'undefined' && document.body && document.body.classList.contains('layout-mobile');
        const graphLineWidth = (isMobileLayout ? 2 : 1) * dpr;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        // Draw grid lines and labels
        ctx.strokeStyle = '#333';
        ctx.lineWidth = graphLineWidth;
        ctx.textAlign = 'right';
        ctx.font = `${tickFontSize}px Arial`;
        ctx.fillStyle = '#ccc';

        // Draw horizontal grid lines (6dB steps from -24dB to +24dB)
        for (let db = -4; db <= 4; db += 2) {
            const y = height * (1 - (db + 6) / 12);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            ctx.fillText(`${db}`, labelX, y + tickOffset);
        }

        // Draw axis labels
        ctx.save();
        ctx.font = `${axisFontSize}px Arial`;
        ctx.translate(axisX, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText('Gain (dB)', 0, 0);
        ctx.restore();

        ctx.textAlign = 'center';
        ctx.fillText('Time', width / 2, height - bottomOffset);

        // Draw 1-second markers
        ctx.strokeStyle = '#555';
        ctx.lineWidth = graphLineWidth;
        for (const idx of this.secondMarkers) {
            const x = width * idx / this.gainBuffer.length;
            ctx.beginPath();
            ctx.moveTo(x, height - (8 * dpr));
            ctx.lineTo(x, height);
            ctx.stroke();
        }

        // Draw gain history; skip segments with NaN values
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = graphLineWidth;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < this.gainBuffer.length; i++) {
            const value = this.gainBuffer[i];
            if (isNaN(value)) continue;
            const x = width * i / this.gainBuffer.length;
            const y = height * (1 - (value + 6) / 12);
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        if (started) {
            ctx.stroke();
        }
    }

    createUI() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.graphResizeDispose) {
            this.graphResizeDispose();
            this.graphResizeDispose = null;
        }
        const container = document.createElement('div');
        container.className = 'transient-shaper-plugin-ui plugin-parameter-ui';

        container.appendChild(this.createParameterControl('Fast Attack', 0.1, 10.0, 0.1, this.fa, this.setFa.bind(this), 'ms'));
        container.appendChild(this.createParameterControl('Fast Release', 1, 200, 1, this.fr, this.setFr.bind(this), 'ms'));
        container.appendChild(this.createParameterControl('Slow Attack', 1, 100, 1, this.sa, this.setSa.bind(this), 'ms'));
        container.appendChild(this.createParameterControl('Slow Release', 50, 1000, 5, this.sr, this.setSr.bind(this), 'ms'));
        container.appendChild(this.createParameterControl('Transient Gain', -24, 24, 0.1, this.gt, this.setGt.bind(this), 'dB'));
        container.appendChild(this.createParameterControl('Sustain Gain', -24, 24, 0.1, this.gs, this.setGs.bind(this), 'dB'));
        container.appendChild(this.createParameterControl('Smoothing', 0.1, 20.0, 0.1, this.sm, this.setSm.bind(this), 'ms'));

        const { container: graphContainer, canvas, dispose } = this.createResponsiveGraph({
            maxWidth: 2048,
            aspectRatio: '2048 / 300',
            mobileAspectRatio: '2.5 / 1',
            className: 'transient-shaper-graph',
            onResize: ({ canvas }) => {
                this.canvas = canvas;
                this.canvasCtx = canvas.getContext('2d');
                this.drawGraph();
            }
        });
        this.canvas = canvas;
        this.canvasCtx = canvas.getContext('2d');
        this.graphResizeDispose = dispose;
        
        container.appendChild(graphContainer);
        
        if (this.observer == null) {
            this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
        }
        this.observer.observe(this.canvas);

        return container;
    }

    cleanup() {
        // Cancel animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }

        // Remove event listeners
        for (const [element, listener] of this.boundEventListeners) {
            element.removeEventListener('input', listener);
            element.removeEventListener('change', listener);
        }
        this.boundEventListeners.clear();

        // Release canvas resources
        if (this.graphResizeDispose) {
            this.graphResizeDispose();
            this.graphResizeDispose = null;
        }
        if (this.canvas) {
            this.canvas.width = 0;
            this.canvas.height = 0;
            this.canvas = null;
        }
        this.canvasCtx = null;

        // Reset buffer to NaN so that initial graph is blank
        this.gainBuffer.fill(NaN);
        this.secondMarkers = [];
        this.prevTime = null;

        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }

        super.cleanup();
    }
}

window.TransientShaperPlugin = TransientShaperPlugin;
