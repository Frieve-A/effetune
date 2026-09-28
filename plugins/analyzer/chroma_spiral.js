class ChromaSpiralPlugin extends PluginBase {
    constructor() {
        super('Chroma Spiral', 'Spectrum by note and octave');
        this.initializeDisplayState();
        this.registerProcessor(ChromaSpiralPlugin.processorFunction);
    }

    initializeDisplayState() {
        this.dm = 0;
        this.lo = 1;
        this.hi = 7;
        this.ft = 3;
        this.lr = 24;
        this.df = -60;
        this.snapshot = null;
        this.display = null;
        this.receiver = null;
        this.levelReference = null;
        this.levelReferenceHold = 0;
        this.canvas = null;
        this.canvasCtx = null;
        this.ctx = null;
        this.graphDpr = 1;
        this.observer = null;
        this.resizeGraphDisposer = null;
        this.isVisible = false;
        this.animationFrameId = null;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundTelemetry = (frame, producer) => this.handleTelemetry(frame, producer);
    }

    initializeDisplayCanvas(canvas) {
        this.canvas = canvas;
        this.canvasCtx = canvas.getContext('2d', { alpha: this.displayOptions?.transparent === true });
        this.ctx = this.canvasCtx;
    }

    static automaticPoints = sampleRate => {
        let points = 8;
        while (points < 14 && sampleRate / (4 * (1 << points)) > 1.5) points++;
        return points;
    };

    static processorFunction = `
        const analyzer = context.multiresSpectrum;
        if (!analyzer) throw new Error('Chroma analysis must be prepared before processing');
        const settings = context.chromaParameters || (context.chromaParameters = {
            pt: (${ChromaSpiralPlugin.automaticPoints.toString()})(analyzer.sampleRate), hq: true
        });
        settings.blockSize = parameters.blockSize;
        settings.channelCount = parameters.channelCount;
        const frame = analyzer.process(data, settings);
        data.measurements = frame ? frame.measurements : null;
        context.multiresFrame = frame;
        return data;
    `;

    static octaveCorrection(frequency, tilt = 3) {
        return tilt * Math.log2((frequency > 100 ? frequency : 100) / 100);
    }

    static spectrumCells(snapshot, lo, hi, tilt = 3) {
        const midiLow = (lo + 1) * 12 - 0.5;
        const midiHigh = (hi + 2) * 12 - 0.5;
        const cells = [];
        const logRange = Math.log(snapshot.maxFrequency / snapshot.minFrequency);
        for (let i = snapshot.firstValidIndex; i < snapshot.firstValidIndex + snapshot.validCellCount; i++) {
            const frequency = snapshot.minFrequency * Math.exp(i * logRange / (snapshot.cellCount - 1));
            const midi = 69 + 12 * Math.log2(frequency / 440);
            if (midi < midiLow || midi >= midiHigh) continue;
            const level = snapshot.current[i] + ChromaSpiralPlugin.octaveCorrection(frequency, tilt);
            cells.push({ midi, level });
        }
        return cells;
    }

    static spiralPoint(midi, midiLow, innerRadius, pitch) {
        const angle = (midi - 60) * Math.PI / 6;
        const radius = innerRadius + (midi - midiLow) / 12 * pitch;
        return { x: Math.sin(angle) * radius, y: -Math.cos(angle) * radius, radius, angle };
    }

    getSpiralGeometry(width, height, dpr = 1) {
        const outer = Math.min(width, height) / 2 - 32 * dpr;
        const inner = Math.max(14 * dpr, outer * 0.1);
        return { outer, inner, pitch: (outer - inner) / (this.hi - this.lo + 2),
            midiLow: (this.lo + 1) * 12, midiEnd: (this.hi + 2) * 12 - 0.5 };
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return { type: this.constructor.name, enabled: this.enabled, dm: this.dm, lo: this.lo, hi: this.hi,
            ft: this.ft, lr: this.lr, df: this.df };
    }

    setParameters(params = {}) {
        if (params.enabled !== undefined) this.enabled = params.enabled !== false;
        const previousLo = this.lo;
        const previousHi = this.hi;
        const previousTilt = this.ft;
        if (params.dm === 0 || params.dm === 1 || params.dm === 2) this.dm = params.dm;
        if (params.lo !== undefined) {
            this.lo = Math.round(this.parseFiniteNumber(params.lo, 1, 8, this.lo));
            if (this.lo > this.hi) this.hi = this.lo;
        }
        if (params.hi !== undefined) {
            this.hi = Math.round(this.parseFiniteNumber(params.hi, 1, 9, this.hi));
            if (this.hi < this.lo) this.lo = this.hi;
        }
        if (params.ft !== undefined) this.ft = this.parseFiniteNumber(params.ft, -6, 6, this.ft);
        if (params.lr !== undefined) this.lr = this.parseFiniteNumber(params.lr, 6, 96, this.lr);
        if (params.df !== undefined) this.df = this.parseFiniteNumber(params.df, -120, -24, this.df);
        if (previousLo !== this.lo || previousHi !== this.hi || previousTilt !== this.ft) {
            this.levelReference = null;
            if (this.snapshot) this.updateDisplay(this.snapshot, 0);
        }
        this.updateParameters();
        this.syncUIControls?.();
        if (!this.displayOptions?.deferDraw) this.drawGraph();
    }

    reset() {
        this.setParameters({ dm: 0, lo: 1, hi: 7, ft: 3, lr: 24, df: -60 });
    }

    _setupMessageHandler() {
        const previous = this._messageHandlerWorkletNode;
        super._setupMessageHandler();
        if (previous !== this._messageHandlerWorkletNode) {
            this.receiver = null;
            this.snapshot = null;
            this.display = null;
            this.levelReference = null;
        }
        this.ensureDspTelemetrySubscription();
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        if (message?.measurements?.hqFrame) this.handleTelemetry(message.measurements.hqFrame);
    }

    ensureDspTelemetrySubscription() {
        const hub = window.dspTelemetryHub;
        const tapId = this.id;
        const validTapId = Number.isInteger(tapId) && tapId >= 0 && tapId <= 0xffffffff;
        const validHub = hub && typeof hub.subscribe === 'function';

        if (!validTapId || !validHub) {
            if (this._dspTelemetryUnsubscribe &&
                (hub !== this._dspTelemetryHub || tapId !== this._dspTelemetryTapId)) {
                this.disposeDspTelemetrySubscription();
            }
            return false;
        }
        if (this._dspTelemetryUnsubscribe &&
            hub === this._dspTelemetryHub && tapId === this._dspTelemetryTapId) {
            return true;
        }

        this.disposeDspTelemetrySubscription();
        try {
            const unsubscribe = hub.subscribe(
                tapId,
                4,
                this._boundTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, 4, this._boundTelemetry);
                return false;
            }
            this._dspTelemetryHub = hub;
            this._dspTelemetryTapId = tapId;
            this._dspTelemetryUnsubscribe = unsubscribe;
            return true;
        } catch (error) {
            return false;
        }
    }

    disposeDspTelemetrySubscription() {
        const unsubscribe = this._dspTelemetryUnsubscribe;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        if (!unsubscribe) return;
        try {
            unsubscribe();
        } catch (error) {
            // Ignore stale telemetry subscription cleanup failures.
        }
    }

    handleTelemetry(frame, producer = this._dspTelemetryHub?.port ?? null) {
        if (!this.enabled || !this._sectionEnabled || producer !== (this._dspTelemetryHub?.port ?? null)) return;
        const snapshot = globalThis.MultiresSpectrum.decode(frame, 4);
        if (!snapshot || snapshot.points !== ChromaSpiralPlugin.automaticPoints(snapshot.sampleRate)) return;
        this.receiver ??= new globalThis.MultiresSpectrum.FrameReceiver();
        if (!this.receiver.accept(snapshot, frame.source ?? producer)) return;
        const elapsed = this.receiver.streamChanged || !this.snapshot
            ? snapshot.hopSamples / snapshot.sampleRate
            : Math.max(0, snapshot.timeSeconds - this.snapshot.timeSeconds);
        if (this.receiver.streamChanged) this.levelReference = null;
        this.snapshot = snapshot;
        this.updateDisplay(snapshot, elapsed);
    }

    updateDisplay(snapshot, elapsed) {
        const helper = window.NoteSpectrogramPlugin;
        this.display = ChromaSpiralPlugin.spectrumCells(snapshot, this.lo, this.hi, this.ft);
        let peak = helper.levelFloor;
        for (const cell of this.display) if (cell.level > peak) peak = cell.level;
        if (this.levelReference === null) {
            this.levelReference = helper.levelFloor;
            this.levelReferenceHold = 0;
        }
        helper.updateLevelReference(this, peak, elapsed);
    }

    createUI() {
        this.stopAnimation();
        this.observer?.disconnect();
        this.resizeGraphDisposer?.();
        this.ensureDspTelemetrySubscription();
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';
        // Two columns on desktop, one on mobile (css/effetune.css and css/effetune-mobile.css).
        const parameters = document.createElement('div');
        parameters.className = 'analyzer-parameters';
        parameters.appendChild(this.createRadioGroup('Color', [
            { value: 0, label: 'Normal' }, { value: 1, label: 'Normal 2' },
            { value: 2, label: 'Note Colors' }
        ], this.dm, value => this.setParameters({ dm: Number(value) }), 'dm'));
        parameters.appendChild(this.createParameterControl('Lowest Octave', 1, 8, 1, this.lo,
            value => this.setParameters({ lo: value }), '', 'lo'));
        parameters.appendChild(this.createParameterControl('Highest Octave', 1, 9, 1, this.hi,
            value => this.setParameters({ hi: value }), '', 'hi'));
        parameters.appendChild(this.createParameterControl('Frequency Tilt', -6, 6, 0.5, this.ft,
            value => this.setParameters({ ft: value }), 'dB/oct', 'ft'));
        parameters.appendChild(this.createParameterControl('Level Range', 6, 96, 1, this.lr,
            value => this.setParameters({ lr: value }), 'dB', 'lr'));
        parameters.appendChild(this.createParameterControl('Display Floor', -120, -24, 1, this.df,
            value => this.setParameters({ df: value }), 'dB', 'df'));
        container.appendChild(parameters);
        const graph = this.createResponsiveGraph({
            maxWidth: 640, aspectRatio: '1 / 1', mobileAspectRatio: '1 / 1',
            onResize: ({ canvas, dpr }) => {
                this.initializeDisplayCanvas(canvas);
                this.graphDpr = dpr;
                this.drawGraph();
            }
        });
        graph.container.style.margin = '1rem auto 0';
        this.initializeDisplayCanvas(graph.canvas);
        this.resizeGraphDisposer = graph.dispose;
        this.canvas.setAttribute('aria-label', 'Spectrum by note and octave');
        container.appendChild(graph.container);
        if (typeof IntersectionObserver === 'function') {
            this.observer = new IntersectionObserver(entries => {
                for (const entry of entries) {
                    this.isVisible = entry.isIntersecting;
                    if (this.isVisible) {
                        if (this.canRunAnimation()) this.startAnimation();
                        else this.renderPowerUiOnce(() => this.drawGraph());
                    } else this.stopAnimation();
                }
            });
            this.observer.observe(this.canvas);
        } else {
            this.isVisible = true;
            this.startAnimation();
        }
        this.drawGraph();
        this._graphReadout = window.GraphReadout?.attach({
            mount: graph.container,
            surface: this.canvas,
            read: (x, y) => this._readSpiral(x, y),
            crosshair: 'none'
        });
        return container;
    }

    startAnimation() {
        if (this.animationFrameId !== null || !this.enabled || !this._sectionEnabled) return;
        const animate = () => {
            if (!this.isVisible) { this.stopAnimation(); return; }
            this.drawGraph();
            this.animationFrameId = this.requestPowerAnimationFrame(animate, 'analyzer');
        };
        animate();
    }

    stopAnimation() {
        if (this.animationFrameId !== null) cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
    }

    drawGraph() {
        if (!this.canvas || !this.canvasCtx) {
            this._graphReadout?.refresh();
            return;
        }
        const ctx = this.canvasCtx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const dpr = this.graphDpr;
        const fontSize = 12 * dpr;
        const { outer, inner, pitch, midiLow, midiEnd } = this.getSpiralGeometry(width, height, dpr);
        const palette = name => (this.displayOptions?.themePalette ?? window.ThemePalette)?.get(name) ?? '';
        if (this.displayOptions?.transparent) ctx.clearRect(0, 0, width, height);
        else {
            ctx.fillStyle = palette('graph-bg-deep');
            ctx.fillRect(0, 0, width, height);
        }
        const frame = (this._readoutFrame ??= {});
        Object.assign(frame, { valid: outer > inner, centerX: width / 2, centerY: height / 2,
            inner, pitch, midiLow, midiEnd });
        if (outer <= inner) {
            this._graphReadout?.refresh();
            return;
        }
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.lineWidth = dpr;
        ctx.strokeStyle = palette('graph-base-soft');
        ctx.beginPath();
        for (let pc = 0; pc < 12; pc++) {
            const angle = pc * Math.PI / 6;
            ctx.moveTo(Math.sin(angle) * inner, -Math.cos(angle) * inner);
            ctx.lineTo(Math.sin(angle) * outer, -Math.cos(angle) * outer);
        }
        if (this.displayOptions?.showAxes !== false) ctx.stroke();
        ctx.beginPath();
        for (let midi = midiLow; midi <= midiEnd; midi += 0.125) {
            const point = ChromaSpiralPlugin.spiralPoint(midi, midiLow, inner, pitch);
            if (midi === midiLow) ctx.moveTo(point.x, point.y);
            else ctx.lineTo(point.x, point.y);
        }
        if (this.displayOptions?.showAxes !== false) ctx.stroke();
        const helper = window.NoteSpectrogramPlugin;
        const drawSignal = ctx => {
            if (!this.display?.length) return;
            if (this.dm !== 1) {
                for (const cell of this.display) {
                    const intensity = helper.normalizedLevel(cell.level, this.levelReference, this.lr, this.df);
                    if (intensity <= 0) continue;
                    const point = ChromaSpiralPlugin.spiralPoint(cell.midi, midiLow, inner, pitch);
                    const radius = Math.sqrt(intensity) * pitch / 2;
                    const signalColor = this.displayOptions?.signalColor?.(cell.midi, intensity);
                    ctx.globalAlpha = signalColor ? 1 : intensity;
                    ctx.fillStyle = signalColor
                        ? signalColor.css
                        : this.displayOptions?.noteColor
                        ? `rgb(${this.displayOptions.noteColor(cell.midi).join(',')})`
                        : this.dm === 2
                            ? `rgb(${helper.noteColors[Math.round(cell.midi) % 12].join(',')})` // theme-allow: Shared semantic note colors.
                            : palette('graph-trace');
                    ctx.beginPath();
                    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;
            } else {
                const points = this.display.map(cell => {
                    const base = ChromaSpiralPlugin.spiralPoint(cell.midi, midiLow, inner, pitch);
                    const intensity = helper.normalizedLevel(cell.level, this.levelReference, this.lr, this.df);
                    const length = intensity * pitch;
                    return { baseX: base.x, baseY: base.y,
                        midi: cell.midi, intensity,
                        x: base.x + Math.sin(base.angle) * length,
                        y: base.y - Math.cos(base.angle) * length };
                });
                if (this.displayOptions?.signalColor || this.displayOptions?.spiralFillColor) {
                    for (let i = 1; i < points.length; i++) {
                        const before = points[i - 1], after = points[i];
                        const midi = (before.midi + after.midi) / 2;
                        const color = this.displayOptions.signalColor?.(midi,
                            (before.intensity + after.intensity) / 2);
                        if (color && !color.alpha) continue;
                        ctx.fillStyle = color?.css ?? this.displayOptions.spiralFillColor(midi);
                        ctx.beginPath();
                        ctx.moveTo(before.baseX, before.baseY);
                        ctx.lineTo(before.x, before.y);
                        ctx.lineTo(after.x, after.y);
                        ctx.lineTo(after.baseX, after.baseY);
                        ctx.closePath();
                        ctx.fill();
                    }
                } else {
                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);
                    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
                    // Return along the spiral baseline so the fill follows every turn.
                    for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(points[i].baseX, points[i].baseY);
                    ctx.closePath();
                    ctx.fillStyle = this.displayOptions?.spiralFillStyle?.(ctx) ?? palette('graph-trace');
                    ctx.fill();
                }
            }
        };
        if (this.displayOptions?.drawSignal) this.displayOptions.drawSignal(ctx, drawSignal);
        else drawSignal(ctx);
        if (this.displayOptions?.showAxisNumbers !== false) {
            const textContext = this.displayOptions?.textContext ?? ctx;
            ctx.fillStyle = palette('graph-label');
            ctx.font = `${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
            for (let pc = 0; pc < 12; pc++) {
                const angle = pc * Math.PI / 6;
                const x = Math.sin(angle) * (outer + 16 * dpr);
                const y = -Math.cos(angle) * (outer + 16 * dpr);
                if (Math.abs(x) + ctx.measureText(names[pc]).width / 2 <= width / 2 &&
                    Math.abs(y) + fontSize / 2 <= height / 2) textContext.fillText(names[pc], x, y);
            }
            if (pitch >= fontSize + 2 * dpr) {
                ctx.textAlign = 'right';
                // Octave numbers sit on the spiral itself; a Visualizer palette can match the text color.
                const outline = this.displayOptions?.visualizerAxisLabels;
                ctx.strokeStyle = palette('graph-bg-deep');
                ctx.lineWidth = 2 * dpr;
                ctx.lineJoin = 'round';
                for (let octave = this.lo; octave <= this.hi; octave++) {
                    const y = -inner - (octave - this.lo) * pitch;
                    if (outline) textContext.strokeText(String(octave), -6 * dpr, y);
                    textContext.fillText(String(octave), -6 * dpr, y);
                }
            }
        }
        ctx.restore();
        this._graphReadout?.refresh();
    }

    // Snaps canvas pixel (x, y) to the nearest drawn spiral cell.
    _readSpiral(x, y) {
        const frame = this._readoutFrame;
        if (!frame?.valid) return null;
        const { format } = window.GraphReadout;
        const { inner, pitch, midiLow } = frame;
        const dx = x - frame.centerX;
        const dy = y - frame.centerY;
        const phase = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1;
        const turn = Math.round((Math.hypot(dx, dy) - inner) / pitch - phase);
        const midi = midiLow + (turn + phase) * 12;
        if (midi < midiLow - 0.5 || midi > frame.midiEnd) return null;
        let cell = null;
        for (const candidate of this.display ?? []) {
            if (!cell || Math.abs(candidate.midi - midi) < Math.abs(cell.midi - midi)) cell = candidate;
        }
        const cellMidi = cell && Math.abs(cell.midi - midi) <= 0.5 ? cell.midi : midi;
        const frequency = 440 * 2 ** ((cellMidi - 69) / 12);
        const cursor = `${format.note(frequency, 440)} · ${format.frequency(frequency)}`;
        const base = ChromaSpiralPlugin.spiralPoint(cellMidi, midiLow, inner, pitch);
        const at = { x: frame.centerX + base.x, y: frame.centerY + base.y };
        if (cellMidi !== cell?.midi) return { cursor, rows: [{ label: 'Level', value: format.percent(NaN) }], at };
        const intensity = window.NoteSpectrogramPlugin.normalizedLevel(cell.level, this.levelReference, this.lr, this.df);
        if (this.dm === 1) {
            // Normal 2 draws the level as a radial line, so the dot sits on its tip.
            at.x += Math.sin(base.angle) * intensity * pitch;
            at.y -= Math.cos(base.angle) * intensity * pitch;
        }
        return {
            cursor,
            at,
            rows: [{
                label: 'Level',
                color: this.dm === 2
                    ? `rgb(${window.NoteSpectrogramPlugin.noteColors[Math.round(cell.midi) % 12].join(',')})` // theme-allow: Shared semantic note colors.
                    : 'var(--et-graph-trace)',
                value: format.percent(intensity),
                y: at.y
            }]
        };
    }

    cleanup() {
        this.stopAnimation();
        this.disposeDspTelemetrySubscription();
        this.observer?.disconnect();
        this.resizeGraphDisposer?.();
        this.resizeGraphDisposer = null;
        this.observer = null;
        this.canvas = null;
        this.canvasCtx = null;
        this.ctx = null;
        this.snapshot = null;
        this.display = null;
        this.receiver = null;
        super.cleanup();
    }
}

if (typeof window !== 'undefined' && typeof PluginBase !== 'undefined') {
    window.ChromaSpiralPlugin = ChromaSpiralPlugin;
}
