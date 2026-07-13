const POWER_AMP_SAG_TAP_MEASUREMENTS = 12;
const POWER_AMP_SAG_TELEMETRY_VERSION = 1;
const POWER_AMP_SAG_TELEMETRY_PAYLOAD_BYTES = 8;

class PowerAmpSagPlugin extends PluginBase {
    constructor() {
        super('Power Amp Sag', 'Simulates power amp voltage sag under load');
        
        // Initialize parameters with default values (using short names)
        this.ss = 3.0;  // ss: Sag Sensitivity (dB) - Range: -18.0 to +18.0
        this.ps = 50;   // ps: Power Stability (%) - Range: 0 to 100
        this.rs = 40;   // rs: Recovery Speed (%) - Range: 0 to 100
        this.mb = false; // mb: Monoblock (true/false) - Independent channel processing
        
        // Internal state for visualization
        this.inputEnvelope = 0;
        this.gainReduction = 0;
        this.lastProcessTime = performance.now() / 1000;
        
        // Graph state
        this.canvasLeft = null;
        this.canvasRight = null;
        this.canvasCtxLeft = null;
        this.canvasCtxRight = null;
        this.animationFrameId = null;
        this.isVisible = false;
        this.observer = null;
        this.graphResizeDisposers = [];
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspPowerAmpSagTelemetry = frame => this.handleDspPowerAmpSagTelemetry(frame);
        
        // History buffers for graph (512 points each) - half of auto_leveler since canvas width is half
        this.inputEnvelopeBuffer = new Float32Array(512).fill(0);
        this.gainReductionBuffer = new Float32Array(512).fill(0);
        this.secondMarkers = [];
        this.prevTime = null;

        this._setupMessageHandler();
        
        this.registerProcessor(`
            // Audio Processor for Power Amp Sag
            // This version implements a more physically-inspired model where the current
            // draw is dependent on the actual output voltage, creating a self-limiting feedback loop.
            // The code remains optimized for performance.

            const BLOCK_SIZE = parameters.blockSize;
            const CHANNEL_COUNT = parameters.channelCount;
            const SAMPLE_RATE = parameters.sampleRate;

            // Skip processing if the plugin is disabled.
            if (!parameters.enabled) {
                return data;
            }

            const isMonoblock = parameters.mb;

            // Initialize or reinitialize context state when the mode or channel layout changes.
            if (!context.initialized || context.monoblockMode !== isMonoblock || context.channelCount !== CHANNEL_COUNT) {
                if (isMonoblock) {
                    // Monoblock mode: separate PSU and envelope follower per channel.
                    context.vPsu = new Array(CHANNEL_COUNT).fill(1.0);
                    context.envFollower = new Array(CHANNEL_COUNT).fill(0);
                } else {
                    // Shared mode: single PSU and envelope follower for all channels.
                    context.vPsu = 1.0;
                    context.envFollower = 0;
                }
                context.monoblockMode = isMonoblock;
                context.channelCount = CHANNEL_COUNT;
                context.initialized = true;
            }

            // --- Parameter Conversions and Pre-computation ---

            const G_sens_sag = Math.pow(10, parameters.ss / 20);

            // Pre-calculate envelope follower coefficients.
            const envAttackTime = 0.001; // 1ms
            const envReleaseTime = 0.010; // 10ms
            const envAttackCoeff = Math.exp(-1.0 / (envAttackTime * SAMPLE_RATE));
            const envReleaseCoeff = Math.exp(-1.0 / (envReleaseTime * SAMPLE_RATE));
            const invEnvAttackCoeff = 1.0 - envAttackCoeff;
            const invEnvReleaseCoeff = 1.0 - envReleaseCoeff;

            // Pre-calculate PSU parameters.
            const capacitance = 0.001 + (parameters.ps / 100) * 0.099;
            const chargeRate = 2.0 + (parameters.rs / 100) * 18.0;

            // Pre-calculate sample rate inverse for performance, avoiding division in the loop.
            const invSampleRate = 1.0 / SAMPLE_RATE;

            const result = new Float32Array(data.length);
            let maxEnvelope = 0;
            let totalGainReduction = 0;

            // --- Main Processing Loop ---

            if (isMonoblock) {
                // Monoblock mode: process each channel independently.
                // Loop channels first, then samples for better data locality and cache performance.
                let maxEnvThisBlock = 0;
                for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
                    const offset = ch * BLOCK_SIZE;
                    // Cache channel-specific state in local variables for faster access.
                    let vPsu = context.vPsu[ch];
                    let envFollower = context.envFollower[ch];

                    for (let i = 0; i < BLOCK_SIZE; i++) {
                        const sample = data[offset + i];
                        const adjustedSample = sample * G_sens_sag;
                        const inputLevel = adjustedSample >= 0 ? adjustedSample : -adjustedSample;

                        // Apply envelope follower to find the ideal output level.
                        if (inputLevel > envFollower) {
                            envFollower = envFollower * envAttackCoeff + inputLevel * invEnvAttackCoeff;
                        } else {
                            envFollower = envFollower * envReleaseCoeff + inputLevel * invEnvReleaseCoeff;
                        }

                        // Track the maximum envelope across all samples for visualization.
                        if (envFollower > maxEnvThisBlock) {
                            maxEnvThisBlock = envFollower;
                        }

                        // --- MODIFIED LOGIC ---
                        // The actual output envelope is limited by the current PSU voltage.
                        const actualOutputEnvelope = envFollower * vPsu;
                        // Current draw is based on the *actual* output power.
                        const I_draw = actualOutputEnvelope * actualOutputEnvelope;
                        // --- END MODIFIED LOGIC ---

                        // Update PSU voltage based on this current draw.
                        const discharge = (I_draw / capacitance) * invSampleRate;
                        const recharge = chargeRate * (1.0 - vPsu) * invSampleRate;
                        vPsu = vPsu - discharge + recharge;

                        // Apply the *newly calculated* sag gain to the original sample.
                        result[offset + i] = sample * vPsu;
                    }

                    // Store the updated state back to the context for the next block.
                    context.vPsu[ch] = vPsu;
                    context.envFollower[ch] = envFollower;
                }
                maxEnvelope = maxEnvThisBlock;

                // Calculate average gain reduction from final PSU voltages for visualization.
                totalGainReduction = 0;
                for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
                    totalGainReduction += 20 * Math.log10(context.vPsu[ch]);
                }
                if (CHANNEL_COUNT > 0) {
                    totalGainReduction /= CHANNEL_COUNT;
                }

            } else {
                // Shared mode: a single PSU affects all channels.
                // Cache context state in local variables.
                let vPsu = context.vPsu;
                let envFollower = context.envFollower;
                let maxEnvThisBlock = 0;
                const invChannelCount = 1.0 / CHANNEL_COUNT;

                for (let i = 0; i < BLOCK_SIZE; i++) {
                    // Calculate combined input level (RMS-like) from all channels.
                    let inputLevelSq = 0;
                    for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
                        const offset = ch * BLOCK_SIZE;
                        const adjustedSample = data[offset + i] * G_sens_sag;
                        inputLevelSq += adjustedSample * adjustedSample;
                    }
                    const inputLevel = Math.sqrt(inputLevelSq * invChannelCount);

                    // Apply envelope follower.
                    if (inputLevel > envFollower) {
                        envFollower = envFollower * envAttackCoeff + inputLevel * invEnvAttackCoeff;
                    } else {
                        envFollower = envFollower * envReleaseCoeff + inputLevel * invEnvReleaseCoeff;
                    }
                    
                    // Track maximum envelope for visualization.
                    if (envFollower > maxEnvThisBlock) {
                        maxEnvThisBlock = envFollower;
                    }

                    // --- MODIFIED LOGIC ---
                    // The actual output envelope is limited by the current PSU voltage.
                    const actualOutputEnvelope = envFollower * vPsu;
                    // Current draw is based on the *actual* output power.
                    const I_draw = actualOutputEnvelope * actualOutputEnvelope;
                    // --- END MODIFIED LOGIC ---
                    
                    // Update PSU voltage.
                    const discharge = (I_draw / capacitance) * invSampleRate;
                    const recharge = chargeRate * (1.0 - vPsu) * invSampleRate;
                    vPsu = vPsu - discharge + recharge;
                    
                    // Apply the same, newly calculated sag gain to all channels.
                    for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
                        const offset = ch * BLOCK_SIZE;
                        result[offset + i] = data[offset + i] * vPsu;
                    }
                }

                // Store the updated state back to the context.
                context.vPsu = vPsu;
                context.envFollower = envFollower;
                
                // Use the true maximum envelope of the block and the final gain reduction.
                maxEnvelope = maxEnvThisBlock;
                totalGainReduction = 20 * Math.log10(vPsu);
            }

            // --- Attach Measurements for Visualization ---
            result.measurements = {
                inputEnvelope: maxEnvelope * 100, // as percentage
                gainReduction: totalGainReduction, // as dB
                time: time
            };
            
            return result;
        `);
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
                POWER_AMP_SAG_TAP_MEASUREMENTS,
                this._boundDspPowerAmpSagTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(
                    tapId,
                    POWER_AMP_SAG_TAP_MEASUREMENTS,
                    this._boundDspPowerAmpSagTelemetry
                );
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

    parseDspPowerAmpSagTelemetryFrame(frame) {
        if (frame?.frameType !== POWER_AMP_SAG_TAP_MEASUREMENTS ||
            frame.formatVersion !== POWER_AMP_SAG_TELEMETRY_VERSION) {
            return null;
        }
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            payload.byteLength !== POWER_AMP_SAG_TELEMETRY_PAYLOAD_BYTES) {
            return null;
        }
        const inputEnvelope = payload.getFloat32(0, true);
        const gainReduction = payload.getFloat32(4, true);
        if (!Number.isFinite(inputEnvelope) || inputEnvelope < 0 ||
            !Number.isFinite(gainReduction) || gainReduction > 0) {
            return null;
        }
        return { inputEnvelope, gainReduction };
    }

    handleDspPowerAmpSagTelemetry(frame) {
        const measurements = this.parseDspPowerAmpSagTelemetryFrame(frame);
        if (!measurements) return;
        this.onMessage({
            type: 'processBuffer',
            measurements: { ...measurements, time: performance.now() / 1000 }
        });
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        if (message.type === 'processBuffer' && message.measurements) {
            // Update visualization data
            this.inputEnvelope = message.measurements.inputEnvelope;
            this.gainReduction = message.measurements.gainReduction;
            
            // Shift history buffers
            this.inputEnvelopeBuffer.copyWithin(0, 1);
            this.gainReductionBuffer.copyWithin(0, 1);
            
            // Shift marker positions
            this.secondMarkers = this.secondMarkers.map(v => v - 1).filter(v => v >= 0);
            
            const t = message.measurements.time;
            if (this.prevTime !== null && !Number.isNaN(t) && Math.floor(this.prevTime) !== Math.floor(t)) {
                this.secondMarkers.push(this.inputEnvelopeBuffer.length - 1);
            }
            this.prevTime = t;
            
            // Add new values
            this.inputEnvelopeBuffer[this.inputEnvelopeBuffer.length - 1] = this.inputEnvelope;
            this.gainReductionBuffer[this.gainReductionBuffer.length - 1] = this.gainReduction;
        }
    }
    
    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            ss: this.ss,
            ps: this.ps,
            rs: this.rs,
            mb: this.mb
        };
    }
    
    setParameters(params) {
        if (params.ss !== undefined) {
            const value = typeof params.ss === 'number' ? params.ss : parseFloat(params.ss);
            if (!isNaN(value)) {
                this.ss = Math.max(-18.0, Math.min(18.0, value));
            }
        }
        if (params.ps !== undefined) {
            const value = typeof params.ps === 'number' ? params.ps : parseFloat(params.ps);
            if (!isNaN(value)) {
                this.ps = Math.max(0, Math.min(100, Math.round(value)));
            }
        }
        if (params.rs !== undefined) {
            const value = typeof params.rs === 'number' ? params.rs : parseFloat(params.rs);
            if (!isNaN(value)) {
                this.rs = Math.max(0, Math.min(100, Math.round(value)));
            }
        }
        if (params.mb !== undefined) {
            this.mb = Boolean(params.mb);
        }
        this.updateParameters();
    }
    
    // Individual parameter setters
    setSagSensitivity(value) { this.setParameters({ ss: value }); }
    setPowerStability(value) { this.setParameters({ ps: value }); }
    setRecoverySpeed(value) { this.setParameters({ rs: value }); }
    setMonoblock(value) { this.setParameters({ mb: value }); }
    
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
            this.drawGraphs();
            this.animationFrameId = this.requestPowerAnimationFrame(animate);
        };
        animate();
    }
    
    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    disposeGraphResizeObservers() {
        this.graphResizeDisposers.forEach(dispose => dispose());
        this.graphResizeDisposers = [];
    }
    
    drawGraphs() {
        // Draw left graph - Input Envelope
        if (this.canvasCtxLeft) {
            this.drawSingleGraph(
                this.canvasCtxLeft,
                this.canvasLeft.width,
                this.canvasLeft.height,
                'Input Envelope',
                this.inputEnvelopeBuffer,
                '#00ff00',
                0,
                100,
                10,
                '%'
            );
        }
        
        // Draw right graph - Gain Reduction
        if (this.canvasCtxRight) {
            this.drawSingleGraph(
                this.canvasCtxRight,
                this.canvasRight.width,
                this.canvasRight.height,
                'Gain Reduction',
                this.gainReductionBuffer,
                '#ffffff',
                -12,
                2,
                2,
                'dB'
            );
        }
    }
    
    drawSingleGraph(ctx, width, height, title, buffer, color, minValue, maxValue, step, unit) {
        const canvas = ctx.canvas;
        const cssWidth = canvas.clientWidth || width;
        const dpr = cssWidth > 0 ? width / cssWidth : 1;
        const tickFontSize = 12 * dpr;
        const axisFontSize = 14 * dpr;
        const valueFontSize = 13 * dpr;
        const labelX = 80 * dpr;
        const axisX = 20 * dpr;
        const tickOffset = 6 * dpr;
        const bottomOffset = 5 * dpr;
        const secondMarkerHeight = 8 * dpr;
        const valueInset = 10 * dpr;
        const labelEvery = cssWidth < 480 && unit === '%' ? step * 2 : step;
        const isMobileLayout = typeof document !== 'undefined' && document.body && document.body.classList.contains('layout-mobile');
        const graphLineWidth = (isMobileLayout ? 2 : 1) * dpr;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);
        
        // Draw grid lines and labels - matching auto_leveler style
        ctx.strokeStyle = '#333';
        ctx.lineWidth = graphLineWidth;
        ctx.textAlign = 'right';
        ctx.font = `${tickFontSize}px Arial`;
        ctx.fillStyle = '#ccc';
        
        // Draw horizontal grid lines
        const range = maxValue - minValue;
        for (let value = minValue; value <= maxValue; value += step) {
            const y = height * (1 - (value - minValue) / range);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            
            // Only draw text if it won't be cut off (text height is about 24px)
            if (y >= tickFontSize / 2 && y <= height - tickFontSize / 2 && (value - minValue) % labelEvery === 0) {
                ctx.fillText(`${value}`, labelX, y + tickOffset);
            }
        }
        
        // Draw axis labels
        ctx.save();
        ctx.font = `${axisFontSize}px Arial`;
        ctx.translate(axisX, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText(`${title} (${unit})`, 0, 0);
        ctx.restore();
        
        // Draw Time label at bottom
        ctx.textAlign = 'center';
        ctx.fillText('Time', width / 2, height - bottomOffset);
        
        // Draw 1-second markers
        ctx.strokeStyle = '#555';
        ctx.lineWidth = graphLineWidth;
        for (const idx of this.secondMarkers) {
            const x = width * idx / buffer.length;
            ctx.beginPath();
            ctx.moveTo(x, height - secondMarkerHeight);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        
        // Draw the graph line
        ctx.strokeStyle = color;
        ctx.lineWidth = graphLineWidth;
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < buffer.length; i++) {
            const value = buffer[i];
            const x = width * i / buffer.length;
            const y = height * (1 - (value - minValue) / range);
            
            if (!started) {
                ctx.moveTo(x, y);
                started = true;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
        
        // Display current value at top right - fixed position
        const currentValue = buffer[buffer.length - 1];
        const x = width - valueInset;
        const y = 20 * dpr;  // Fixed position from top
        
        ctx.fillStyle = color;
        ctx.textAlign = 'right';
        ctx.font = `${valueFontSize}px Arial`;
        ctx.fillText(currentValue.toFixed(1) + ' ' + unit, x, y);
    }
    
    createUI() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.disposeGraphResizeObservers();
        
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';
        
        // Create parameter controls
        container.appendChild(this.createParameterControl(
            'Sensitivity',
            -18.0,
            18.0,
            0.1,
            this.ss,
            (value) => this.setSagSensitivity(value),
            'dB'
        ));
        
        container.appendChild(this.createParameterControl(
            'Stability',
            0,
            100,
            1,
            this.ps,
            (value) => this.setPowerStability(value),
            '%'
        ));
        
        container.appendChild(this.createParameterControl(
            'Recovery Spd',
            0,
            100,
            1,
            this.rs,
            (value) => this.setRecoverySpeed(value),
            '%'
        ));
        
        // Monoblock checkbox control
        const monoblockRow = document.createElement('div');
        monoblockRow.className = 'parameter-row';
        const monoblockLabel = document.createElement('label');
        monoblockLabel.textContent = 'Monoblock:';
        const monoblockCheckboxId = `${this.id}-${this.name}-monoblock`;
        monoblockLabel.htmlFor = monoblockCheckboxId;
        const monoblockCheckbox = document.createElement('input');
        monoblockCheckbox.type = 'checkbox';
        monoblockCheckbox.id = monoblockCheckboxId;
        monoblockCheckbox.name = monoblockCheckboxId;
        monoblockCheckbox.checked = this.mb;
        monoblockCheckbox.autocomplete = "off";
        monoblockCheckbox.addEventListener('change', (e) => {
            this.setMonoblock(e.target.checked);
        });
        monoblockRow.appendChild(monoblockLabel);
        monoblockRow.appendChild(monoblockCheckbox);
        container.appendChild(monoblockRow);
        
        // Create graph container
        const graphContainer = document.createElement('div');
        graphContainer.className = 'power-amp-sag-graphs';
        
        const leftGraph = this.createResponsiveGraph({
            maxWidth: 1014,
            aspectRatio: '1014 / 300',
            mobileAspectRatio: '2.5 / 1',
            className: 'power-amp-sag-graph-left',
            onResize: ({ canvas }) => {
                this.canvasLeft = canvas;
                this.canvasCtxLeft = canvas.getContext('2d');
                this.drawGraphs();
            }
        });
        const rightGraph = this.createResponsiveGraph({
            maxWidth: 1014,
            aspectRatio: '1014 / 300',
            mobileAspectRatio: '2.5 / 1',
            className: 'power-amp-sag-graph-right',
            onResize: ({ canvas }) => {
                this.canvasRight = canvas;
                this.canvasCtxRight = canvas.getContext('2d');
                this.drawGraphs();
            }
        });

        this.canvasLeft = leftGraph.canvas;
        this.canvasRight = rightGraph.canvas;
        this.canvasCtxLeft = this.canvasLeft.getContext('2d');
        this.canvasCtxRight = this.canvasRight.getContext('2d');
        this.graphResizeDisposers.push(leftGraph.dispose, rightGraph.dispose);
        
        graphContainer.appendChild(leftGraph.container);
        graphContainer.appendChild(rightGraph.container);
        container.appendChild(graphContainer);
        
        // Set up intersection observer
        if (this.observer == null) {
            this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
        }
        this.observer.observe(this.canvasLeft);
        this.observer.observe(this.canvasRight);
        
        return container;
    }
    
    cleanup() {
        this.disposeDspTelemetrySubscription();
        // Reset internal state
        this.inputEnvelope = 0;
        this.gainReduction = 0;
        
        // Cancel animation frame
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
        
        // Disconnect observer
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.disposeGraphResizeObservers();
        
        // Release canvas resources
        if (this.canvasLeft) {
            this.canvasLeft.width = 0;
            this.canvasLeft.height = 0;
            this.canvasLeft = null;
        }
        if (this.canvasRight) {
            this.canvasRight.width = 0;
            this.canvasRight.height = 0;
            this.canvasRight = null;
        }
        this.canvasCtxLeft = null;
        this.canvasCtxRight = null;
        
        // Reset buffers
        this.inputEnvelopeBuffer.fill(0);
        this.gainReductionBuffer.fill(0);
        this.secondMarkers = [];
        this.prevTime = null;

        super.cleanup();
    }
}

window.PowerAmpSagPlugin = PowerAmpSagPlugin;
