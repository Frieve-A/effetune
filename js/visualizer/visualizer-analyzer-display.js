import { paletteColor, paletteGradient } from './visualizer-effects.js';
import { THEME_COLOR_ROLES, DEFAULT_THEME_COLORS, DEFAULT_TRACE_COLOR } from './visualizer-model.js';

const ANALYZERS = {
    spectrum: ['SpectrumAnalyzerPlugin', 'handleDspSpectrumTelemetry', 'drawGraph'],
    spectrogram: ['SpectrogramPlugin', 'handleDspSpectrogramTelemetry', 'drawGraph'],
    oscilloscope: ['OscilloscopePlugin', 'handleDspScopeTelemetry', 'drawWaveform'],
    stereo: ['StereoMeterPlugin', 'handleDspStereoFieldTelemetry', 'drawMeter'],
    notes: ['NoteSpectrogramPlugin', 'handleTelemetry', 'drawGraph'],
    chroma: ['ChromaSpiralPlugin', 'handleTelemetry', 'drawGraph'],
    'level-meter': ['LevelMeterPlugin', 'handleDspLevelTelemetry', 'updateMeter'],
    phase: ['PhaseSelectEqPlugin', 'handleDspTelemetry', 'drawVisualizerPhaseMap'],
    'analog-meter': ['AnalogMeterPlugin', 'handleVisualizerTelemetry', 'drawVisualizerMeter']
};

// Input channel numbers behind the two-channel scratch of a source: null, L, R, a pair such as 34, or one channel.
const channelNumbers = channel => {
    if (channel === null || channel === undefined) return [1, 2];
    if (channel === 'L') return [1];
    if (channel === 'R') return [2];
    if (Number(channel) <= 16) return [Number(channel)];
    const first = Number(channel.slice(0, Math.floor(channel.length / 2)));
    return [first, first + 1];
};

const frequencyMidi = frequency => 69 + 12 * Math.log2(frequency / 440);
const colorCss = color => `rgb(${color.map(value => Math.round(value)).join(',')})`;
const hexRgb = hex => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
const themeColorCss = hex => hex.length === 9
    ? `rgba(${hexRgb(hex).join(',')},${parseInt(hex.slice(7), 16) / 255})`
    : `rgb(${hexRgb(hex).join(',')})`;
const DEFAULT_THEME_PALETTE = Object.fromEntries(Object.entries({ ...DEFAULT_THEME_COLORS,
    'graph-trace': DEFAULT_TRACE_COLOR }).map(([role, color]) => [role, themeColorCss(color)]));
let heatmapStyles;
const heatmapColor = intensity => {
    if (!heatmapStyles) {
        const lut = window.SpectrogramPlugin.getHeatmapLuts().rgba;
        heatmapStyles = Array.from({ length: 256 }, (_, index) => {
            const offset = index * 4, alpha = lut[offset + 3] / 255;
            const rgb = Array.from(lut.slice(offset, offset + 3));
            return { alpha, rgb, css: `rgba(${rgb.join(',')},${alpha})` };
        });
    }
    return heatmapStyles[Math.round(Math.max(0, Math.min(1, intensity)) * 255)];
};

export function createAnalyzerDisplay(item, canvas, sources) {
    const definition = ANALYZERS[item.type];
    const Plugin = definition && window[definition[0]];
    if (!Plugin?.prototype.initializeDisplayState) return null;
    return new AnalyzerDisplay(Plugin, definition, item, canvas, sources);
}

class AnalyzerDisplay {
    constructor(Plugin, definition, item, canvas, sources) {
        this.type = item.type;
        this.drawMethod = definition[2];
        // Share the plugin's display initialization without constructing a pipeline
        // plugin, registering DSP, or creating its worklet/DOM observers.
        this.plugin = Object.create(Plugin.prototype);
        this.plugin.initializeDisplayState();
        this.channel = item.channel;
        this.plugin.enabled = this.plugin._sectionEnabled = true;
        // This adapter owns neither pipeline updates nor the plugin's DOM controls.
        this.plugin.updateParameters = () => {};
        this.plugin.syncUIControls = () => {};
        this.plugin.ensureDspTelemetrySubscription = () => false;
        this.plugin.canvas = canvas;
        this.plugin.ctx = canvas.getContext('2d');
        this.plugin.displayOptions = {
            transparent: true,
            visualizerAxisLabels: true,
            preserveKeyboardAspect: true,
            themePalette: { get: role => this.themeColors?.[role] ?? DEFAULT_THEME_PALETTE[role] },
            drawSignal: (context, draw, clip) => this.drawSignal(context, draw, clip),
            drawKeyboard: (context, draw, geometry) => this.drawKeyboard(context, draw, geometry),
            drawLevelValue: (context, text, x, y) => this.drawLevelValue(context, text, x, y),
            textContext: {
                fillText: (text, x, y) => this.drawText('fillText', text, x, y),
                strokeText: (text, x, y) => this.drawText('strokeText', text, x, y)
            }
        };
        this.plugin.initializeDisplayCanvas?.(canvas);
        this.params = {};
        this.colors = [];
        this.update(item, 0, canvas.width);
        this.unsubscribe = sources.subscribeItem(item.id, (frame, producer) => {
            this.plugin._dspTelemetryHub = { port: producer };
            this.plugin[definition[1]](frame, producer);
        });
    }

    update(item, time, cssWidth) {
        const plugin = this.plugin;
        if ((this.type === 'level-meter' || this.type === 'analog-meter') && this.channel !== item.channel) {
            // The source changes on channel selection; hide the old held peak
            // until a frame from the newly selected source arrives.
            plugin.initializeDisplayState();
            this.channel = item.channel;
        }
        plugin.graphCssWidth = cssWidth;
        plugin.graphDpr = cssWidth > 0 ? plugin.canvas.width / cssWidth : 1;
        const params = item.params;
        const changed = {};
        for (const [key, value] of Object.entries(params)) {
            if (value !== this.params[key]) changed[key] = value;
        }
        const options = plugin.displayOptions;
        options.showAxes = params.showAxes;
        options.showAxisNumbers = params.showAxisNumbers;
        if (this.type === 'spectrum' || this.type === 'level-meter') options.orientation = params.orientation;
        if (this.type === 'spectrum') options.quantizeBars = params.quantizeBars;
        if (this.type === 'level-meter') {
            plugin.dbStart = params.dr ?? -96;
            plugin.dbRange = -plugin.dbStart;
            options.showLevelValues = params.showLevelValues;
            options.channel = item.channel;
        }
        if (this.type === 'analog-meter') {
            options.channelLabels = channelNumbers(item.channel);
            // Before the first telemetry frame arrives, fold the display to the
            // selected channel count immediately instead of waiting for a frame.
            if (!plugin.reading) plugin.channelCount = options.channelLabels.length;
        }
        if (this.type === 'notes') {
            options.showKeyboard = params.kb;
            options.keyboardLabelFontSize = (cssWidth < 500 ? 11 : 12) * plugin.graphDpr;
        }
        if (this.type === 'stereo') {
            options.showCorrelation = params.showCorrelation;
            options.showBalance = params.showBalance;
        }
        // The effect's on-screen visibility gate does not apply to this host.
        if (this.type === 'phase') plugin.isVisible = true;
        if (Object.keys(changed).length) {
            // Native controls repaint immediately; this host draws once after all
            // parameters and layers are ready instead.
            options.deferDraw = true;
            try { plugin.setParameters(changed); }
            finally { options.deferDraw = false; }
            if (changed.showAxes !== undefined) plugin.volumeHistoryDirty = true;
            this.params = { ...params };
        }
        const paletteKey = JSON.stringify(item.palette);
        const notePlugin = window.NoteSpectrogramPlugin;
        const mode = item.palette.mode;
        const intensityGradient = mode === 'gradient' && item.palette.direction === 'intensity';
        const fixedNotes = mode === 'note-colors' && Boolean(notePlugin?.noteColor);
        const phase = mode !== 'gradient' || item.palette.motion.mode === 'none' || !item.palette.motion.speed ? 0 : time;
        if (this.paletteKey === paletteKey && this.phase === phase &&
            ['mn', 'mx', 'lo', 'hi', 'sc', 'orientation'].every(key => changed[key] === undefined)) return;
        this.paletteKey = paletteKey;
        this.phase = phase;
        this.colors = mode === 'gradient' ? Array.from({ length: 256 }, (_, index) =>
            paletteColor(item.palette, index / 255, time).match(/[\d.]+/g).map(Number)) : [];
        const paletteRgb = position => mode === 'solid' ? hexRgb(item.palette.color)
            : this.colors[Math.max(0, Math.min(255, Math.round(position * 255)))];
        options.barColor = fixedNotes && this.type === 'spectrum'
            ? (band, count) => colorCss(notePlugin.noteColor(frequencyMidi(
                plugin.displayXToFrequency((band + .5) / count))))
            : null;
        if (this.type === 'oscilloscope') {
            options.traceStyle = context => mode === 'solid'
                ? item.palette.color : paletteGradient(context, item.palette, plugin.canvas.width, time);
        } else if (this.type === 'level-meter') {
            const vertical = params.orientation === 'vertical';
            let cachedContext, cachedWidth, cachedGradient;
            options.traceStyle = (context, _y, width) => {
                if (mode === 'solid') return item.palette.color;
                if (context !== cachedContext || width !== cachedWidth) {
                    cachedContext = context; cachedWidth = width;
                    if (mode === 'heatmap') {
                        cachedGradient = context.createLinearGradient(0, vertical ? width : 0,
                            vertical ? 0 : width, 0);
                        for (let intensity = 0; intensity <= 255; intensity++)
                            cachedGradient.addColorStop(intensity / 255, heatmapColor(intensity / 255).css);
                    } else cachedGradient = paletteGradient(context, item.palette, width, time, vertical);
                }
                return cachedGradient;
            };
        } else if (mode === 'solid' && this.type === 'spectrum') {
            options.traceStyle = () => item.palette.color;
        } else if (this.type === 'spectrum' && (mode === 'heatmap' || intensityGradient)) {
            let cachedContext, cachedHeight, cachedGradient;
            options.traceStyle = (context, _width, height) => {
                if (context !== cachedContext || height !== cachedHeight) {
                    cachedContext = context; cachedHeight = height;
                    if (mode === 'heatmap') {
                        cachedGradient = context.createLinearGradient(0, cachedHeight, 0, 0);
                        for (let intensity = 0; intensity <= 255; intensity++)
                            cachedGradient.addColorStop(intensity / 255, heatmapColor(intensity / 255).css);
                    } else cachedGradient = paletteGradient(context, item.palette, height, time, true);
                }
                return cachedGradient;
            };
        } else if (fixedNotes && this.type === 'spectrum') {
            let cachedContext, cachedWidth, cachedHeight, cachedFlipX, cachedFlipY, cachedGradient;
            options.traceStyle = (context, width) => {
                if (context !== cachedContext || width !== cachedWidth || plugin.canvas.height !== cachedHeight ||
                    this.flipX !== cachedFlipX || this.flipY !== cachedFlipY) {
                    cachedContext = context; cachedWidth = width; cachedHeight = plugin.canvas.height;
                    cachedFlipX = this.flipX; cachedFlipY = this.flipY;
                    cachedGradient = context.createLinearGradient(0, 0, width, 0);
                    const firstMidi = frequencyMidi(plugin.displayXToFrequency(0));
                    const lastMidi = frequencyMidi(plugin.displayXToFrequency(1));
                    cachedGradient.addColorStop(0, colorCss(notePlugin.noteColor(firstMidi)));
                    for (let midi = Math.ceil(firstMidi); midi <= Math.floor(lastMidi); midi++) {
                        const frequency = 440 * 2 ** ((midi - 69) / 12);
                        cachedGradient.addColorStop(plugin.frequencyToX(frequency, width) / width,
                            colorCss(notePlugin.noteColor(midi)));
                    }
                    cachedGradient.addColorStop(1, colorCss(notePlugin.noteColor(lastMidi)));
                }
                return cachedGradient;
            };
        } else options.traceStyle = (context, width) => paletteGradient(context, item.palette, width, time);
        options.noteColor = mode === 'solid' || mode === 'heatmap' ? () => hexRgb(item.palette.color) : fixedNotes
            ? midi => notePlugin.noteColors[((Math.round(midi) % 12) + 12) % 12]
            : intensityGradient ? (_midi, intensity) => paletteRgb(intensity)
            : midi => paletteRgb(item.palette.mapping === 'octave'
                ? ((midi % 12) + 12) % 12 / 12
                : this.type === 'chroma'
                    ? (midi - (plugin.lo + 1) * 12) / Math.max(12, (plugin.hi - plugin.lo + 1) * 12)
                    : (midi - plugin.mn) / Math.max(1, plugin.mx - plugin.mn));
        options.signalColor = mode === 'heatmap' ? (_midi, intensity) => heatmapColor(intensity) : null;
        if (intensityGradient && this.type === 'chroma') {
            const colors = this.colors.map((rgb, index) => ({ rgb, alpha: index / 255,
                css: `rgba(${rgb.join(',')},${index / 255})` }));
            options.signalColor = (_midi, intensity) => colors[Math.max(0, Math.min(255, Math.round(intensity * 255)))];
        }
        options.heatmapColorLut = mode === 'heatmap' ? window.SpectrogramPlugin.getHeatmapLuts().rgba : null;
        if (this.type === 'chroma') {
            options.spiralFillColor = mode === 'gradient' && !intensityGradient && item.palette.mapping !== 'octave'
                ? midi => colorCss(options.noteColor(midi)) : null;
            if (mode === 'solid') options.spiralFillStyle = () => item.palette.color;
            else if (mode === 'heatmap' || intensityGradient || options.spiralFillColor) options.spiralFillStyle = null;
            else {
                let cachedContext, cachedWidth, cachedHeight, cachedFlipX, cachedFlipY, cachedGradient;
                options.spiralFillStyle = context => {
                    if (context !== cachedContext || plugin.canvas.width !== cachedWidth || plugin.canvas.height !== cachedHeight ||
                        this.flipX !== cachedFlipX || this.flipY !== cachedFlipY) {
                        cachedContext = context; cachedWidth = plugin.canvas.width; cachedHeight = plugin.canvas.height;
                        cachedFlipX = this.flipX; cachedFlipY = this.flipY;
                        cachedGradient = context.createConicGradient(-Math.PI / 2, 0, 0);
                        for (let index = 0; index <= 24; index++) {
                            const color = fixedNotes ? notePlugin.noteColor(index / 2) : paletteRgb(index === 24 ? 0 : index / 24);
                            cachedGradient.addColorStop(index / 24, colorCss(color));
                        }
                    }
                    return cachedGradient;
                };
            }
        }
        if (this.type === 'phase') {
            const styles = mode === 'solid' ? null : Array.from({ length: 256 }, (_, index) =>
                colorCss(mode === 'heatmap' ? heatmapColor(index / 255).rgb : paletteRgb(index / 255)));
            const byLevel = mode === 'heatmap' || intensityGradient;
            options.pointColor = styles
                ? (position, level) => styles[Math.max(0, Math.min(255, Math.round((byLevel ? level : position) * 255)))]
                : () => item.palette.color;
        }
        if (this.type === 'analog-meter') {
            options.needleColor = mode === 'solid' ? () => item.palette.color : position => colorCss(paletteRgb(position));
        }
        if (this.type === 'stereo') {
            // Keep the original age buckets, fading into the scene beneath the graph.
            // Gradients depend on palette and graph geometry, never sample count.
            let centerX, centerY, flipX, flipY;
            let styles = [];
            const sampleColor = (color, age) => `rgba(${color.join(',')},${age / 255})`;
            options.sampleStyle = (context, x, y, age) => {
                if (x !== centerX || y !== centerY || flipX !== this.flipX || flipY !== this.flipY) {
                    centerX = x; centerY = y; flipX = this.flipX; flipY = this.flipY; styles = [];
                }
                if (!styles[age]) {
                    if (mode === 'solid' || item.palette.stops.length === 1) {
                        styles[age] = sampleColor(paletteRgb(0), age);
                    } else {
                        const gradient = context.createConicGradient(-Math.PI / 2, x, y);
                        for (let index = 0; index <= 24; index++) {
                            gradient.addColorStop(index / 24, sampleColor(paletteRgb(index / 24), age));
                        }
                        styles[age] = gradient;
                    }
                }
                return styles[age];
            };
        }
        if (this.type === 'spectrogram') {
            options.colorLut = intensityGradient ? Uint8ClampedArray.from(this.colors.flat()) : null;
            options.frequencyColorLut = mode === 'heatmap' || intensityGradient ? null : Uint8ClampedArray.from(
                Array.from({ length: 256 }, (_, row) =>
                    fixedNotes ? notePlugin.noteColor(frequencyMidi(plugin.displayRowToFrequency(row)))
                        : paletteRgb(1 - row / 255)).flat());
            plugin.spectrogramColorLut = plugin.createSpectrogramColorLut();
            plugin.repaintSpectrogramHistory();
        } else if (this.type === 'notes') {
            plugin.paintHistoryImage();
            plugin.volumeHistoryDirty = true;
        }
    }

    draw(item, time, cssWidth, themeColors) {
        this.flipX = item.flipX;
        this.flipY = item.flipY;
        const themeKey = JSON.stringify(themeColors || {});
        if (this.themeKey !== themeKey) {
            this.themeKey = themeKey;
            this.themeColors = {};
            for (const role of THEME_COLOR_ROLES) {
                const color = themeColors?.[role];
                if (color) this.themeColors[role] = themeColorCss(color);
            }
        }
        const themeSignature = THEME_COLOR_ROLES.map(role => this.plugin.displayOptions.themePalette.get(role)).join('|');
        if (this.themeSignature !== themeSignature) {
            this.themeSignature = themeSignature;
            this.plugin.volumeHistoryDirty = true;
        }
        const options = this.plugin.displayOptions;
        const separate = item.effects.some(effect => effect.enabled);
        if (options.separateAnnotations !== separate) this.plugin.volumeHistoryDirty = true;
        options.separateAnnotations = separate;
        this.signalCanvas = null;
        this.underlayCanvas = null;
        this.overflowLevelValues = [];
        this.capturedUnderlay = false;
        if (separate) {
            this.signalLayer ||= document.createElement('canvas');
            if (this.signalLayer.width !== this.plugin.canvas.width) this.signalLayer.width = this.plugin.canvas.width;
            if (this.signalLayer.height !== this.plugin.canvas.height) this.signalLayer.height = this.plugin.canvas.height;
            this.signalLayer.getContext('2d').clearRect(0, 0, this.signalLayer.width, this.signalLayer.height);
            this.signalCanvas = this.signalLayer;
            if (this.type === 'spectrum' || this.type === 'stereo' || this.type === 'chroma' || this.type === 'oscilloscope' || this.type === 'phase') {
                this.underlayLayer ||= document.createElement('canvas');
                if (this.underlayLayer.width !== this.plugin.canvas.width) this.underlayLayer.width = this.plugin.canvas.width;
                if (this.underlayLayer.height !== this.plugin.canvas.height) this.underlayLayer.height = this.plugin.canvas.height;
                this.underlayLayer.getContext('2d').clearRect(0, 0, this.underlayLayer.width, this.underlayLayer.height);
                this.underlayCanvas = this.underlayLayer;
            }
        }
        const context = this.plugin.ctx;
        context.save();
        context.translate(this.flipX ? this.plugin.canvas.width : 0, this.flipY ? this.plugin.canvas.height : 0);
        context.scale(this.flipX ? -1 : 1, this.flipY ? -1 : 1);
        try {
            this.update(item, time, cssWidth);
            this.plugin[this.drawMethod](time * 1000);
        } finally {
            context.restore();
        }
    }

    drawSignal(context, draw, clip) {
        if (!this.signalCanvas) { draw(context); return; }
        if (this.underlayCanvas && !this.capturedUnderlay) {
            // Preserve the native order: these grid lines and labels precede
            // the first signal, while subsequent labels stay in the foreground.
            this.underlayCanvas.getContext('2d').drawImage(this.plugin.canvas, 0, 0);
            context.save();
            context.resetTransform();
            context.clearRect(0, 0, this.plugin.canvas.width, this.plugin.canvas.height);
            context.restore();
            this.capturedUnderlay = true;
        }
        const target = this.signalCanvas.getContext('2d');
        target.save();
        target.setTransform(context.getTransform());
        // Only these native drawing blocks move to the signal layer. Their
        // calculations and history updates still run once, in the original order.
        for (const property of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin',
            'miterLimit', 'globalAlpha', 'globalCompositeOperation', 'imageSmoothingEnabled']) target[property] = context[property];
        if (clip) { target.beginPath(); target.rect(0, 0, clip.width, clip.height); target.clip(); }
        try { draw(target); }
        finally { target.restore(); }
    }

    drawKeyboard(context, draw, { horizontal, width, height, rollWidth, boundary }) {
        // The native horizontal layout rotates the keyboard, swapping its canvas axes.
        // Keys are mirrored back in place across their depth; boundary marks stay
        // on the boundary so they still face the roll.
        const flipWidth = !boundary && (horizontal ? this.flipY : this.flipX);
        const flipHeight = horizontal ? this.flipX : this.flipY;
        if (!flipWidth && !flipHeight) { draw(); return; }
        context.save();
        context.translate(flipWidth ? width + rollWidth : 0, flipHeight ? height : 0);
        context.scale(flipWidth ? -1 : 1, flipHeight ? -1 : 1);
        this.drawingKeyboard = true;
        try { draw(); }
        finally { this.drawingKeyboard = false; context.restore(); }
    }

    drawLevelValue(context, text, x, y) {
        const metrics = context.measureText(text);
        const width = metrics.width;
        const left = metrics.actualBoundingBoxLeft ?? (context.textAlign === 'right' ? width : width / 2);
        const right = metrics.actualBoundingBoxRight ?? (context.textAlign === 'right' ? 0 : width / 2);
        const ascent = metrics.actualBoundingBoxAscent ?? 0;
        const descent = metrics.actualBoundingBoxDescent ?? 0;
        const centerX = (right - left) / 2;
        const centerY = (descent - ascent) / 2;
        const transform = context.getTransform?.();
        const matrix = Number.isFinite(transform?.a) ? transform : { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
        const originX = matrix.a * (x + centerX) + matrix.c * (y + centerY) + matrix.e - centerX;
        const originY = matrix.b * (x + centerX) + matrix.d * (y + centerY) + matrix.f - centerY;
        if (originX - left >= 0 && originX + right <= this.plugin.canvas.width) {
            this.drawText('fillText', text, x, y);
            return;
        }
        this.overflowLevelValues.push({ text, x: originX, y: originY, font: context.font,
            fillStyle: context.fillStyle, textAlign: context.textAlign, textBaseline: context.textBaseline });
    }

    drawText(method, text, x, y) {
        const context = this.plugin.ctx;
        const uprightSpectrum = this.type === 'spectrum' && this.params.orientation === 'vertical';
        if (this.drawingKeyboard || (!this.flipX && !this.flipY && !uprightSpectrum)) {
            context[method](text, x, y);
            return;
        }
        const matrix = context.getTransform();
        const metrics = context.measureText(text);
        const centerX = (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2;
        const centerY = (metrics.actualBoundingBoxDescent - metrics.actualBoundingBoxAscent) / 2;
        const sx = this.flipX ? -1 : 1, sy = this.flipY ? -1 : 1;
        // Reflect the label's position and alignment box, while preserving its
        // original glyph orientation (including the native rotated axis titles).
        const a = matrix.a * sx, b = matrix.b * sy;
        const c = matrix.c * sx, d = matrix.d * sy;
        const px = matrix.a * (x + centerX) + matrix.c * (y + centerY) + matrix.e;
        const py = matrix.b * (x + centerX) + matrix.d * (y + centerY) + matrix.f;
        context.save();
        if (uprightSpectrum) {
            // Frequency is the vertical axis; keep its title readable along that axis.
            const frequencyTitle = text === 'Frequency (Hz)';
            const ta = frequencyTitle ? 0 : 1, tb = frequencyTitle ? -1 : 0;
            const tc = frequencyTitle ? 1 : 0, td = frequencyTitle ? 0 : 1;
            context.setTransform(ta, tb, tc, td, px - ta * centerX - tc * centerY,
                py - tb * centerX - td * centerY);
        } else context.setTransform(a, b, c, d, px - a * centerX - c * centerY, py - b * centerX - d * centerY);
        context[method](text, 0, 0);
        context.restore();
    }

    dispose() { this.unsubscribe(); }
}
