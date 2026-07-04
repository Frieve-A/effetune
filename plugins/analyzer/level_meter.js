class LevelMeterPlugin extends PluginBase {
    constructor() {
        super('Level Meter', 'Displays audio level with peak hold');
        this.lv = [];     // lv: Levels (formerly levels) - Range: -144 to 0 dB
        this.pl = [];     // pl: Peak Levels (formerly peakLevels) - Range: -144 to 0 dB
        this.ph = [];       // ph: Peak Hold Times (formerly peakHoldTimes)
        this.ol = false;                      // ol: Overload (formerly overload)
        this.ot = 0;                          // ot: Overload Time (formerly overloadTime)
        this.OVERLOAD_DISPLAY_TIME = 5.0; // seconds
        this.PEAK_HOLD_TIME = 1.0; // seconds
        this.FALL_RATE = 20; // dB per second
        this.lastProcessTime = performance.now() / 1000;
        this.lastMeterUpdateTime = 0;
        this.METER_UPDATE_INTERVAL = 16; // Match with plugin-base.js
        this.observer = null;
        this.resizeGraphDisposer = null;
        this.graphDpr = 1;
        this.graphCssWidth = 1024;

        // Register processor function that measures audio levels over 1/60 second window
        this.registerProcessor(`
            const numChannels = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate;
            const blocksPerWindow = Math.floor(sampleRate / 30 / blockSize); // Number of blocks in ~1/30 second

            // Initialize context state for block-based peak tracking
            if (!context.initialized) {
                context.peakBuffers = new Array(numChannels)
                    .fill()
                    .map(() => new Float32Array(blocksPerWindow).fill(0));
                context.blockIndex = 0;
                context.blocksPerWindow = blocksPerWindow;
                context.initialized = true;
            }
            
            // Reset state if channel count or window size changes
            if (context.peakBuffers.length !== numChannels || context.blocksPerWindow !== blocksPerWindow) {
                context.peakBuffers = new Array(numChannels)
                    .fill()
                    .map(() => new Float32Array(blocksPerWindow).fill(0));
                context.blockIndex = 0;
                context.blocksPerWindow = blocksPerWindow;
            }
            
            // Calculate current block peaks and store in circular buffers
            const peaks = new Float32Array(numChannels);
            
            for (let ch = 0; ch < numChannels; ch++) {
                const offset = ch * blockSize;
                const end = offset + blockSize;
                let blockPeak = 0.0;
                
                // Find peak in current block
                for (let i = offset; i < end; i++) {
                    const sample = data[i];
                    const absSample = sample < 0 ? -sample : sample;
                    if (absSample > blockPeak) {
                        blockPeak = absSample;
                    }
                }
                
                // Store block peak in circular buffer
                context.peakBuffers[ch][context.blockIndex] = blockPeak;
                
                // Find maximum peak across the stored blocks (~1/30 second window)
                let windowPeak = 0.0;
                for (let i = 0; i < blocksPerWindow; i++) {
                    if (context.peakBuffers[ch][i] > windowPeak) {
                        windowPeak = context.peakBuffers[ch][i];
                    }
                }
                
                peaks[ch] = windowPeak;
            }
            
            // Advance block index for next processing call
            context.blockIndex = (context.blockIndex + 1) % blocksPerWindow;
            
            // Create measurements object
            const channelMeasurements = new Array(numChannels);
            for (let ch = 0; ch < numChannels; ch++) {
                channelMeasurements[ch] = { peak: peaks[ch] };
            }
            
            // Attach measurements to the data buffer for the main thread
            data.measurements = {
                channels: channelMeasurements,
                time: time
            };
            
            return data;
        `);
    }

    // Get current parameters
    getParameters() {
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

    // Handle messages from audio processor
    onMessage(message) {
        if (message.type === 'processBuffer') {
            this.process(message);
        }
    }

    process(message) {
        if (!message?.measurements?.channels) {
            return;
        }

        // Skip processing if plugin is disabled
        if (!this.enabled) {
            return;
        }

        const time = performance.now() / 1000;
        const deltaTime = time - this.lastProcessTime;
        this.lastProcessTime = time;

        // Check and resize arrays if channel count changed
        const numChannels = message.measurements.channels.length;
        if (numChannels !== this.lv.length) {
            this.lv = new Array(numChannels).fill(-144);
            this.pl = new Array(numChannels).fill(-144);
            this.ph = new Array(numChannels).fill(0);
            // Reset overload state if channel count changes, although it might not be strictly necessary
            this.ol = false;
            this.ot = 0;

        }

        // Process each channel
        for (let ch = 0; ch < numChannels; ch++) {
            const channelPeak = message.measurements.channels[ch].peak;
            const dbLevel = this.amplitudeToDB(channelPeak);
            
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
                // After hold time, let peak fall at the same rate as level
                const fallingPeak = this.pl[ch] - this.FALL_RATE * deltaTime;
                // But never fall below current level
                this.pl[ch] = fallingPeak > this.lv[ch] ? fallingPeak : this.lv[ch];
            }
        }

        // Update overload state
        const wasOverloaded = this.ol;
        // Find maximum peak manually instead of using Math.max
        let maxPeak = 0;
        for (let i = 0; i < message.measurements.channels.length; i++) {
            const peak = message.measurements.channels[i].peak;
            if (peak > maxPeak) {
                maxPeak = peak;
            }
        }
        if (maxPeak > 1.0) {
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
        this.foregroundCanvas = foregroundCanvas;
        this.backgroundCanvas = backgroundCanvas;
        this.overloadIndicator = overloadIndicator;
        this.canvasWidth = foregroundCanvas.width || 1024;
        this.canvasHeight = foregroundCanvas.height || 64;
        this.dbRange = 96;
        this.dbStart = -96;
        graph.resize();

        if (this.observer == null) {
            this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
        }
        this.observer.observe(this.foregroundCanvas);

        return container;
    }

    drawStaticBackground() {
        if (!this.backgroundCanvas) return;

        const bgCtx = this.backgroundCanvas.getContext('2d');
        const width = this.backgroundCanvas.width;
        const height = this.backgroundCanvas.height;
        const dpr = this.graphDpr || 1;
        const isNarrow = this.graphCssWidth < 500;
        const gridStep = isNarrow ? 6 : 3;
        const labelStep = isNarrow ? 24 : 12;

        bgCtx.clearRect(0, 0, width, height);

        bgCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        bgCtx.lineWidth = dpr;
        bgCtx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        bgCtx.font = `${10 * dpr}px Arial`;
        bgCtx.textAlign = 'center';
        bgCtx.textBaseline = 'alphabetic';
        for (let db = this.dbStart; db <= 0; db += gridStep) {
            const x = width * (db - this.dbStart) / this.dbRange;

            bgCtx.beginPath();
            bgCtx.moveTo(x, 0);
            bgCtx.lineTo(x, height);
            bgCtx.stroke();

            if (db % labelStep === 0 && db !== 0 && db !== this.dbStart) {
                bgCtx.fillText(db.toString(), x, height - (2 * dpr));
            }
        }
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
            this.updateMeter();
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

    // Clean up resources when plugin is removed
    cleanup() {
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
    updateMeter() {
        if (!this.foregroundCanvas) return;
        
        const ctx = this.foregroundCanvas.getContext('2d');
        ctx.clearRect(0, 0, this.canvasWidth, this.canvasHeight);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

        // Skip drawing if disabled or no channels yet
        if (!this.enabled || this.lv.length === 0) return;

        // Draw each channel
        const numDrawableChannels = this.lv.length; // Use the actual number of channels
        const dpr = this.graphDpr || 1;
        const channelGap = numDrawableChannels > 1 ? 2 * dpr : 0;
        const channelHeight = numDrawableChannels > 0 ? (this.canvasHeight / numDrawableChannels) - channelGap : 0; // Calculate height per channel, add padding if more than one channel

        for (let channel = 0; channel < numDrawableChannels; channel++) {
            const y = channel * (this.canvasHeight / numDrawableChannels); // Calculate y position based on number of channels

            // Create gradient for this channel
            const gradient = ctx.createLinearGradient(0, y, this.canvasWidth, y);
            gradient.addColorStop(0, '#008000');
            gradient.addColorStop(((-12) - this.dbStart) / this.dbRange, '#008000');
            gradient.addColorStop(((-12) - this.dbStart) / this.dbRange, '#808000');
            gradient.addColorStop(((-6) - this.dbStart) / this.dbRange, '#808000');
            gradient.addColorStop(((-6) - this.dbStart) / this.dbRange, '#800000');
            gradient.addColorStop(1, '#800000');

            // Draw level meter
            const level = this.lv[channel];
            const rawLevelWidth = this.canvasWidth * (level - this.dbStart) / this.dbRange;
            const levelWidth = rawLevelWidth < 0 ? 0 : rawLevelWidth;
            ctx.fillStyle = gradient;
            ctx.fillRect(0, y + dpr, levelWidth, channelHeight);

            // Draw peak hold
            const peakLevel = this.pl[channel];
            const peakX = this.canvasWidth * (peakLevel - this.dbStart) / this.dbRange;
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(peakX - dpr, y + dpr, 2 * dpr, channelHeight);

            // Display peak level value
            if (numDrawableChannels <= 4) { // Only show text for 4 or fewer channels
                ctx.fillStyle = '#ffffff';
                ctx.font = `${12 * dpr}px Arial`;
                ctx.textAlign = 'right';
                ctx.textBaseline = 'middle';
                const peakText = peakLevel.toFixed(1) + ' dB';
                // Adjust text position based on channel height
                ctx.fillText(peakText, this.canvasWidth - (10 * dpr), y + channelHeight / 2 + (numDrawableChannels === 1 ? 0 : dpr));
            }
        }

        // Update overload indicator
        this.overloadIndicator.style.display = this.ol ? 'block' : 'none';
    }
}

// Register the plugin
window.LevelMeterPlugin = LevelMeterPlugin;
