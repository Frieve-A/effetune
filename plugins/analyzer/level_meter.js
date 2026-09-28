const LEVEL_METER_TAP_LEVEL = 1;
const LEVEL_METER_TELEMETRY_VERSION = 1;
const LEVEL_METER_MAX_TELEMETRY_CHANNELS = 16;

class LevelMeterPlugin extends PluginBase {
    constructor() {
        super('Level Meter', 'Displays audio level with peak hold');
        this.initializeDisplayState();

        // Register processor function that measures audio levels over 1/60 second window
        this.registerProcessor(`
            const numChannels = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate;
            const windowBins = 32;
            const desiredFramesPerBin = sampleRate / 30 / windowBins;
            const framesPerBin = desiredFramesPerBin > 1 ? Math.ceil(desiredFramesPerBin) : 1;

            // Fixed time bins keep the window stable when the host block size changes.
            if (!context.initialized ||
                context.peakBuffers.length !== numChannels ||
                context.peakSampleRate !== sampleRate) {
                context.peakBuffers = new Array(numChannels)
                    .fill()
                    .map(() => new Float32Array(windowBins));
                context.windowPeaks = new Float32Array(numChannels);
                context.currentPeakBin = 0;
                context.currentPeakBinFrames = 0;
                context.framesPerPeakBin = framesPerBin;
                context.peakSampleRate = sampleRate;
                context.initialized = true;
            }

            let processedFrames = 0;
            while (processedFrames < blockSize) {
                if (context.currentPeakBinFrames >= context.framesPerPeakBin) {
                    context.currentPeakBin = (context.currentPeakBin + 1) % windowBins;
                    context.currentPeakBinFrames = 0;
                    for (let ch = 0; ch < numChannels; ch++) {
                        const peaks = context.peakBuffers[ch];
                        const outgoingPeak = peaks[context.currentPeakBin];
                        peaks[context.currentPeakBin] = 0;
                        if (outgoingPeak === context.windowPeaks[ch]) {
                            let windowPeak = 0;
                            for (let bin = 0; bin < windowBins; bin++) {
                                if (peaks[bin] > windowPeak) windowPeak = peaks[bin];
                            }
                            context.windowPeaks[ch] = windowPeak;
                        }
                    }
                }

                const availableFrames = context.framesPerPeakBin - context.currentPeakBinFrames;
                const remainingFrames = blockSize - processedFrames;
                const segmentFrames = remainingFrames < availableFrames ?
                    remainingFrames : availableFrames;
                for (let ch = 0; ch < numChannels; ch++) {
                    const offset = ch * blockSize + processedFrames;
                    const end = offset + segmentFrames;
                    let binPeak = context.peakBuffers[ch][context.currentPeakBin];
                    for (let i = offset; i < end; i++) {
                        const sample = data[i];
                        const absolute = sample < 0 ? -sample : sample;
                        if (absolute > binPeak) binPeak = absolute;
                    }
                    context.peakBuffers[ch][context.currentPeakBin] = binPeak;
                    if (binPeak > context.windowPeaks[ch]) context.windowPeaks[ch] = binPeak;
                }
                context.currentPeakBinFrames += segmentFrames;
                processedFrames += segmentFrames;
            }

            // Create measurements object
            const channelMeasurements = new Array(numChannels);
            for (let ch = 0; ch < numChannels; ch++) {
                channelMeasurements[ch] = { peak: context.windowPeaks[ch] };
            }
            
            // Attach measurements to the data buffer for the main thread
            data.measurements = {
                channels: channelMeasurements,
                time: time
            };
            
            return data;
        `);
    }

    initializeDisplayState() {
        this.lv = [];     // lv: Levels (formerly levels) - Range: -144 to 0 dB
        this.pl = [];     // pl: Peak Levels (formerly peakLevels) - Range: -144 to 0 dB
        this.ph = [];       // ph: Peak Hold Times (formerly peakHoldTimes)
        this.raw = [];      // Latest accepted raw levels, used as the display floor
        this.ol = false;                      // ol: Overload (formerly overload)
        this.ot = 0;                          // ot: Overload Time (formerly overloadTime)
        this.OVERLOAD_DISPLAY_TIME = 5.0; // seconds
        this.PEAK_HOLD_TIME = 1.0; // seconds
        this.FALL_RATE = 20; // dB per second
        this.PEAK_FALL_RATE = 20; // dB per second after the hold
        this.lastProcessTime = performance.now() / 1000;
        this.lastMeterUpdateTime = 0;
        this.METER_UPDATE_INTERVAL = 16; // Match with plugin-base.js
        this.DISPLAY_EXTRAPOLATION_LIMIT = 1 / 60;
        this.displayReceiptTime = this.lastProcessTime;
        this.displayFrozen = false;
        this.displayFrozenExtrapolation = 0;
        this.observer = null;
        this.resizeGraphDisposer = null;
        this.graphDpr = 1;
        this.graphCssWidth = 1024;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspLevelTelemetry = frame => this.handleDspLevelTelemetry(frame);
    }

    // Get current parameters
    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: 'LevelMeterPlugin', // Use class name instead of constructor name
            id: this.id,
            enabled: this.enabled
            // Removed dynamic measurement values (lv, pl, ol) as they don't need to be saved
        };
    }

    // Set parameters
    setParameters(params) {
        // Note: levels, peakLevels, and overload are read-only measurement values
        // and should not be set externally
        this.updateParameters();
    }

    // Convert linear amplitude to dB
    amplitudeToDB(amplitude) {
        return 20 * Math.log10(amplitude < 1e-8 ? 1e-8 : amplitude);
    }

    _setupMessageHandler() {
        super._setupMessageHandler();
        this.ensureDspTelemetrySubscription?.();
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
                LEVEL_METER_TAP_LEVEL,
                this._boundDspLevelTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, LEVEL_METER_TAP_LEVEL, this._boundDspLevelTelemetry);
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

    parseDspLevelTelemetryFrame(frame) {
        if (frame?.frameType !== LEVEL_METER_TAP_LEVEL ||
            frame.formatVersion !== LEVEL_METER_TELEMETRY_VERSION) {
            return null;
        }
        const payload = frame.payload;
        if (!payload || typeof payload.getUint32 !== 'function' ||
            typeof payload.getFloat32 !== 'function') {
            return null;
        }
        if (!Number.isInteger(payload.byteLength) || payload.byteLength < 8) return null;

        const channelCount = payload.getUint32(0, true);
        if (channelCount < 1 || channelCount > LEVEL_METER_MAX_TELEMETRY_CHANNELS) return null;
        const expectedBytes = 8 + channelCount * 8;
        if (payload.byteLength !== expectedBytes) return null;

        const clipFlags = payload.getUint32(4 + channelCount * 8, true);
        const validClipMask = (1 << channelCount) - 1;
        if ((clipFlags & ~validClipMask) !== 0) return null;

        const channels = new Array(channelCount);
        for (let channel = 0; channel < channelCount; channel++) {
            const offset = 4 + channel * 8;
            const peak = payload.getFloat32(offset, true);
            const rms = payload.getFloat32(offset + 4, true);
            if (!Number.isFinite(peak) || peak < 0 || !Number.isFinite(rms) || rms < 0) {
                return null;
            }
            channels[channel] = {
                peak,
                rms,
                clipped: (clipFlags & (1 << channel)) !== 0
            };
        }
        return { channels, clipFlags };
    }

    handleDspLevelTelemetry(frame) {
        const measurements = this.parseDspLevelTelemetryFrame(frame);
        if (!measurements) return;
        this.process({ measurements });
    }

    // Handle messages from audio processor
    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        if (message.type === 'processBuffer') {
            this.process(message);
        }
    }

    process(message) {
        if (!message?.measurements?.channels) {
            return;
        }

        // Skip processing if plugin is disabled
        if (!this.enabled || !this._sectionEnabled) {
            return;
        }

        const time = performance.now() / 1000;
        const previousProcessTime = this.lastProcessTime;
        const deltaTime = time > previousProcessTime ? time - previousProcessTime : 0;
        this.lastProcessTime = time;
        this.displayReceiptTime = time;
        this.displayFrozenExtrapolation = 0;

        // Check and resize arrays if channel count changed
        const numChannels = message.measurements.channels.length;
        if (numChannels !== this.lv.length) {
            this.lv = new Array(numChannels).fill(-144);
            this.pl = new Array(numChannels).fill(-144);
            this.ph = new Array(numChannels).fill(0);
            this.raw = new Array(numChannels).fill(-144);
            // Reset overload state if channel count changes, although it might not be strictly necessary
            this.ol = false;
            this.ot = 0;

        }

        // Process each channel
        for (let ch = 0; ch < numChannels; ch++) {
            const channelPeak = message.measurements.channels[ch].peak;
            const dbLevel = this.amplitudeToDB(channelPeak);
            this.raw[ch] = dbLevel;
            
            // Update level with fall rate
            const fallingLevel = this.lv[ch] - this.FALL_RATE * deltaTime;
            const clampedFallingLevel = fallingLevel < -144 ? -144 : fallingLevel;
            this.lv[ch] = dbLevel > clampedFallingLevel ? dbLevel : clampedFallingLevel;

            // Update peak hold
            if (dbLevel > this.pl[ch]) {
                // New peak detected - update peak and hold time
                this.pl[ch] = dbLevel;
                this.ph[ch] = time;
            } else if (time > this.ph[ch] + this.PEAK_HOLD_TIME) {
                // After hold time, let the peak fall at its own rate
                const peakFallStart = this.ph[ch] + this.PEAK_HOLD_TIME;
                const peakFallTime = time > peakFallStart ?
                    time - (previousProcessTime > peakFallStart ? previousProcessTime : peakFallStart) : 0;
                const fallingPeak = this.pl[ch] - this.PEAK_FALL_RATE * peakFallTime;
                // But never fall below current level
                this.pl[ch] = fallingPeak > this.lv[ch] ? fallingPeak : this.lv[ch];
            }
        }

        // Update overload state
        const wasOverloaded = this.ol;
        // Find maximum peak manually instead of using Math.max
        let maxPeak = 0;
        let clipped = false;
        for (let i = 0; i < message.measurements.channels.length; i++) {
            const channel = message.measurements.channels[i];
            const peak = channel.peak;
            if (peak > maxPeak) {
                maxPeak = peak;
            }
            if (channel.clipped === true) clipped = true;
        }
        if (clipped || maxPeak > 1.0) {
            this.ol = true;
            this.ot = time;
        } else if (time > this.ot + this.OVERLOAD_DISPLAY_TIME) {
            this.ol = false;
        }

        // Only update parameters when overload state changes
        if (this.ol !== wasOverloaded) {
            this.updateParameters();
        }
    }

    // Create UI elements for the plugin
    createUI() {
        this.ensureDspTelemetrySubscription();
        this.stopAnimation();
        if (this.observer) {
            this.observer.disconnect();
        }
        if (this.resizeGraphDisposer) {
            this.resizeGraphDisposer();
            this.resizeGraphDisposer = null;
        }
        let backgroundCanvas = null;
        const graph = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '16 / 1',
            mobileAspectRatio: '8 / 1',
            className: 'level-meter-plugin-ui',
            onResize: ({ canvas, cssWidth, dpr }) => {
                this.foregroundCanvas = canvas;
                this.graphDpr = dpr;
                this.graphCssWidth = cssWidth;
                this.canvasWidth = canvas.width;
                this.canvasHeight = canvas.height;
                if (backgroundCanvas) {
                    if (backgroundCanvas.width !== canvas.width) backgroundCanvas.width = canvas.width;
                    if (backgroundCanvas.height !== canvas.height) backgroundCanvas.height = canvas.height;
                    this.drawStaticBackground();
                }
            }
        });
        const container = graph.container;
        this.resizeGraphDisposer = graph.dispose;

        // Initialize animation frame ID
        this.animationFrameId = null;

        // Create foreground canvas for meter (displayed in background)
        const foregroundCanvas = graph.canvas;
        foregroundCanvas.className = 'meter-foreground';

        // Create background canvas for grid and labels (displayed in foreground)
        backgroundCanvas = document.createElement('canvas');
        backgroundCanvas.className = 'meter-background';
        container.appendChild(backgroundCanvas);

        // Create overload indicator
        const overloadIndicator = document.createElement('div');
        overloadIndicator.className = 'overload-indicator';
        overloadIndicator.textContent = 'OVERLOAD';
        overloadIndicator.style.display = 'none';
        container.appendChild(overloadIndicator);

        // Store UI elements for updates
        this.initializeDisplayCanvas(foregroundCanvas);
        this.backgroundCanvas = backgroundCanvas;
        this.overloadIndicator = overloadIndicator;
        graph.resize();

        if (this.observer == null) {
            this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
        }
        this.observer.observe(this.foregroundCanvas);

        return container;
    }

    initializeDisplayCanvas(canvas) {
        this.foregroundCanvas = canvas;
        this.canvasWidth = canvas.width || 1024;
        this.canvasHeight = canvas.height || 64;
        this.dbRange = 96;
        this.dbStart = -96;
    }

    drawStaticBackground() {
        const canvas = this.backgroundCanvas || (this.displayOptions && this.foregroundCanvas);
        if (!canvas) return;

        const bgCtx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;
        const dpr = this.graphDpr || 1;
        const vertical = this.displayOptions?.orientation === 'vertical';
        const isNarrow = (vertical ? height / dpr : this.graphCssWidth) < 500;
        const gridStep = isNarrow ? 6 : 3;
        const labelStep = isNarrow ? 24 : 12;
        const options = this.displayOptions;
        const showAxes = options?.showAxes !== false;
        const showNumbers = options?.showAxisNumbers !== false;

        if (this.backgroundCanvas) bgCtx.clearRect(0, 0, width, height);
        if (!showAxes && !showNumbers) return;

        const palette = options?.themePalette ?? window.ThemePalette;
        bgCtx.strokeStyle = (palette?.get('graph-grid-soft') ?? '');
        bgCtx.lineWidth = dpr;
        bgCtx.fillStyle = (palette?.get(options?.visualizerAxisLabels ? 'graph-label' : 'graph-label-soft') ?? '');
        bgCtx.font = `${(options?.visualizerAxisLabels ? (isNarrow ? 11 : 12) : 10) * dpr}px Arial`;
        bgCtx.textAlign = vertical ? 'left' : 'center';
        bgCtx.textBaseline = vertical ? 'middle' : 'alphabetic';
        for (let db = Math.ceil(this.dbStart / gridStep) * gridStep; db <= 0; db += gridStep) {
            const position = (db - this.dbStart) / this.dbRange;
            const x = width * position;
            const y = height * (1 - position);

            if (showAxes) {
                bgCtx.beginPath();
                bgCtx.moveTo(vertical ? 0 : x, vertical ? y : 0);
                bgCtx.lineTo(vertical ? width : x, vertical ? y : height);
                bgCtx.stroke();
            }

            if (showNumbers && db % labelStep === 0 && db !== 0 && db !== this.dbStart) {
                const text = db.toString(), textX = vertical ? 2 * dpr : x;
                const textY = vertical ? y : height - (2 * dpr);
                if (options?.visualizerAxisLabels) {
                    bgCtx.save();
                    bgCtx.strokeStyle = palette?.get('graph-bg-deep') ?? '';
                    bgCtx.lineWidth = 2 * dpr;
                    bgCtx.lineJoin = 'round';
                    (options.textContext ?? bgCtx).strokeText(text, textX, textY);
                    bgCtx.restore();
                }
                (options?.textContext ?? bgCtx).fillText(text, textX, textY);
            }
        }
    }

    handleIntersect(entries) {
        entries.forEach(entry => {
            this.isVisible = entry.isIntersecting;
            if (this.isVisible) {
                if (this.canRunAnimation()) this.startAnimation();
                else this.renderPowerUiOnce(() => this.updateMeter());
            } else {
                this.stopAnimation();
            }
        });
    }

    startAnimation() {
        if (!this.enabled || !this._sectionEnabled) return;
        if (this.animationFrameId) return;
        if (this.displayFrozen) {
            const now = performance.now() / 1000;
            this.displayReceiptTime = now - this.displayFrozenExtrapolation;
            this.displayFrozen = false;
        }

        const animate = timestamp => {
            if (!this.isVisible) {
                this.stopAnimation();
                return;
            }
            this.updateMeter(timestamp);
            this.animationFrameId = this.requestPowerAnimationFrame(animate, 'analyzer');
        };
        animate(performance.now());
    }

    stopAnimation() {
        this.displayFrozen = true;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    // Clean up resources when plugin is removed
    cleanup() {
        this.disposeDspTelemetrySubscription();
        this.stopAnimation();
        if (this.observer) {
            if (this.foregroundCanvas) {
                this.observer.unobserve(this.foregroundCanvas);
            }
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.resizeGraphDisposer) {
            this.resizeGraphDisposer();
            this.resizeGraphDisposer = null;
        }
        this.foregroundCanvas = null;
        this.backgroundCanvas = null;
        this.overloadIndicator = null;
        super.cleanup();
    }
   
    // Update meter display
    updateMeter(now = performance.now()) {
        if (!this.foregroundCanvas) return;
        if (this.displayOptions) {
            this.canvasWidth = this.foregroundCanvas.width;
            this.canvasHeight = this.foregroundCanvas.height;
        }

        const ctx = this.foregroundCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        const options = this.displayOptions;
        if (!options?.transparent) {
            ctx.fillStyle = ((options?.themePalette ?? window.ThemePalette)?.get('graph-bg-deep') ?? '');
            ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);
        }

        // Skip drawing if disabled or no channels yet
        if (!this.enabled || this.lv.length === 0) {
            if (options) this.drawStaticBackground();
            return;
        }

        // A selected mono source is duplicated into the two-channel DSP scratch buffer.
        // Its two telemetry values describe the same channel, so display it once.
        const channel = options?.channel;
        const singleChannel = channel === 'L' || channel === 'R' ||
            (typeof channel === 'string' && /^([1-9]|1[0-6])$/.test(channel));
        const channelLabels = !options ? null : singleChannel ? [channel] : channel == null
            ? ['L', 'R']
            : [channel.slice(0, channel.length / 2), channel.slice(channel.length / 2)];
        const numDrawableChannels = singleChannel ? 1 : this.lv.length;
        const showPeaks = options?.showPeaks !== false;
        const elapsed = now / 1000 - this.displayReceiptTime;
        const extrapolation = this.displayFrozen ? this.displayFrozenExtrapolation :
            (elapsed > 0 ? (elapsed < this.DISPLAY_EXTRAPOLATION_LIMIT ? elapsed : this.DISPLAY_EXTRAPOLATION_LIMIT) : 0);
        if (!this.displayFrozen) this.displayFrozenExtrapolation = extrapolation;
        const renderTime = this.lastProcessTime + extrapolation;
        const dpr = this.graphDpr || 1;
        const vertical = options?.orientation === 'vertical';
        const channelGap = numDrawableChannels > 1 ? 2 * dpr : 0;
        const channelSpan = (vertical ? this.canvasWidth : this.canvasHeight) / numDrawableChannels;
        const channelSize = channelSpan - channelGap;
        const meterLength = vertical ? this.canvasHeight : this.canvasWidth;
        // A host may split the bar into segments of segmentDb dB, drawn like the Spectrum Analyzer's quantized bars.
        const segmentPitch = options?.segmentDb > 0 ? meterLength * options.segmentDb / this.dbRange : 0;
        const fullBlockCount = segmentPitch ? Math.floor(meterLength / segmentPitch) : 0;

        for (let channel = 0; channel < numDrawableChannels; channel++) {
            const start = channel * channelSpan;

            // Draw level meter
            const fallingLevel = this.lv[channel] - this.FALL_RATE * extrapolation;
            const projectedLevel = this.raw[channel] > fallingLevel ? this.raw[channel] : fallingLevel;
            const level = projectedLevel < -144 ? -144 : projectedLevel;
            const rawLevelLength = meterLength * (level - this.dbStart) / this.dbRange;
            const clampedLength = rawLevelLength < 0 ? 0 : rawLevelLength;
            const levelLength = segmentPitch ? Math.floor(clampedLength / segmentPitch) * segmentPitch : clampedLength;

            // Draw peak hold
            let peakLevel = this.pl[channel];
            const peakFallStart = this.ph[channel] + this.PEAK_HOLD_TIME;
            const peakFallElapsed = renderTime > peakFallStart ?
                renderTime - (this.lastProcessTime > peakFallStart ? this.lastProcessTime : peakFallStart) : 0;
            if (peakFallElapsed > 0) {
                const fallingPeak = this.pl[channel] - this.PEAK_FALL_RATE * (peakFallElapsed < this.DISPLAY_EXTRAPOLATION_LIMIT ? peakFallElapsed : this.DISPLAY_EXTRAPOLATION_LIMIT);
                peakLevel = fallingPeak > level ? fallingPeak : level;
            } else if (peakLevel < level) {
                peakLevel = level;
            }
            const peakPosition = meterLength * (peakLevel - this.dbStart) / this.dbRange;
            const drawSignal = target => {
                let style = options?.traceStyle?.(target, start,
                    vertical ? this.canvasHeight : this.canvasWidth, channelSize);
                if (!style) {
                    const gradient = vertical
                        ? target.createLinearGradient(0, this.canvasHeight, 0, 0)
                        : target.createLinearGradient(0, start, this.canvasWidth, start);
                    gradient.addColorStop(0, '#008000'); // theme-allow: Fixed signal-level or self-painted colormap color.
                    gradient.addColorStop(((-12) - this.dbStart) / this.dbRange, '#008000'); // theme-allow: Fixed signal-level or self-painted colormap color.
                    gradient.addColorStop(((-12) - this.dbStart) / this.dbRange, '#808000'); // theme-allow: Fixed signal-level or self-painted colormap color.
                    gradient.addColorStop(((-6) - this.dbStart) / this.dbRange, '#808000'); // theme-allow: Fixed signal-level or self-painted colormap color.
                    gradient.addColorStop(((-6) - this.dbStart) / this.dbRange, '#800000'); // theme-allow: Fixed signal-level or self-painted colormap color.
                    gradient.addColorStop(1, '#800000'); // theme-allow: Fixed signal-level or self-painted colormap color.
                    style = gradient;
                }
                target.fillStyle = style;
                if (vertical) target.fillRect(start + dpr, this.canvasHeight - levelLength, channelSize, levelLength);
                else target.fillRect(0, start + dpr, levelLength, channelSize);
                const palette = options?.themePalette ?? window.ThemePalette;
                if (segmentPitch) {
                    // Cut the bar body into segments with gaps in the background color.
                    target.fillStyle = palette?.get('graph-bg-deep') ?? '';
                    for (let position = segmentPitch; position < levelLength; position += segmentPitch) {
                        if (vertical) target.fillRect(start + dpr, this.canvasHeight - position - dpr / 2, channelSize, dpr);
                        else target.fillRect(position - dpr / 2, start + dpr, dpr, channelSize);
                    }
                }
                if (!showPeaks) return;
                if (segmentPitch) {
                    // The peak lights the whole segment it falls in.
                    const blocks = Math.ceil(peakPosition / segmentPitch);
                    const blockEnd = (blocks < fullBlockCount ? blocks : fullBlockCount) * segmentPitch - dpr / 2;
                    target.fillStyle = style;
                    if (vertical) target.fillRect(start + dpr, this.canvasHeight - blockEnd, channelSize, segmentPitch - dpr);
                    else target.fillRect(blockEnd - segmentPitch + dpr, start + dpr, segmentPitch - dpr, channelSize);
                    return;
                }
                target.fillStyle = palette?.get('text-primary') ?? '';
                if (vertical) target.fillRect(start + dpr, this.canvasHeight - peakPosition - dpr,
                    channelSize, 2 * dpr);
                else target.fillRect(peakPosition - dpr, start + dpr, 2 * dpr, channelSize);
            };
            if (options?.drawSignal) options.drawSignal(ctx, drawSignal);
            else drawSignal(ctx);

            // Display peak level value
            if (numDrawableChannels <= 4 && (!options || options.showLevelValues !== false)) {
                ctx.fillStyle = (options?.themePalette ?? window.ThemePalette)?.get('text-primary') ?? '';
                ctx.font = `${12 * dpr}px Arial`;
                ctx.textAlign = vertical ? 'center' : 'right';
                ctx.textBaseline = vertical ? 'top' : 'middle';
                const peakText = (channelLabels ? `${channelLabels[channel]} ` : '') + (showPeaks ? peakLevel : level).toFixed(1) + ' dB';
                const textX = vertical ? start + channelSize / 2 : this.canvasWidth - (10 * dpr);
                const textY = vertical ? 2 * dpr : start + channelSize / 2 + (numDrawableChannels === 1 ? 0 : dpr);
                if (options?.drawLevelValue) options.drawLevelValue(ctx, peakText, textX, textY);
                else (options?.textContext ?? ctx).fillText(peakText, textX, textY);
            }
        }

        // Update overload indicator
        if (options) {
            this.drawStaticBackground();
            if (this.ol) {
                const label = 'OVERLOAD';
                ctx.save();
                ctx.font = `bold ${12 * dpr}px Arial`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.globalAlpha = Math.floor(now / 250) % 2 ? 0.5 : 1;
                const badgeWidth = ctx.measureText(label).width + 16 * dpr;
                const badgeHeight = 20 * dpr;
                ctx.fillStyle = window.getComputedStyle?.(this.foregroundCanvas)?.getPropertyValue('--et-danger').trim() || '#b91c1c';
                ctx.fillRect((this.canvasWidth - badgeWidth) / 2, (this.canvasHeight - badgeHeight) / 2,
                    badgeWidth, badgeHeight);
                ctx.fillStyle = window.getComputedStyle?.(this.foregroundCanvas)?.getPropertyValue('--et-on-status').trim() || '#ffffff';
                (options.textContext ?? ctx).fillText(label, this.canvasWidth / 2, this.canvasHeight / 2);
                ctx.restore();
            }
        } else this.overloadIndicator.style.display = this.ol ? 'block' : 'none';
    }
}

// Register the plugin
window.LevelMeterPlugin = LevelMeterPlugin;
