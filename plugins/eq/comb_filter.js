// Comb Filter Plugin implementation
// Digital comb filter with feedback/feedforward for harmonic coloration and resonance
const combFilterProcessorFunction = `
if (!parameters.enabled) return data;

const channelCount = parameters.channelCount;
const blockSize = parameters.blockSize;
const fundamentalFreq = parameters.ff; // Fundamental Frequency in Hz
const feedbackGain = parameters.fg;    // Feedback Gain (-1 to 1)
const dryWetMix = parameters.dw;       // Dry-Wet Mix (0 to 100)
const combType = parameters.ct;        // Comb Type: "fb" (Feedback) or "ff" (Feedforward)

// Initialize context if needed
if (!context.initialized) {
    context.delayBuffers = new Array(channelCount);
    context.writePositions = new Array(channelCount);
    context.initialized = true;
}

// Calculate delay in samples
const sampleRate = parameters.sampleRate; // Get sample rate from parameters
const delaySamples = Math.max(2, Math.round(sampleRate / fundamentalFreq));

// Reset buffers if channel count changes or delay changes
if (context.delayBuffers.length !== channelCount || context.lastDelay !== delaySamples) {
    context.delayBuffers = new Array(channelCount);
    context.writePositions = new Array(channelCount);
    for (let ch = 0; ch < channelCount; ch++) {
        context.delayBuffers[ch] = new Float32Array(delaySamples).fill(0);
        context.writePositions[ch] = 0;
    }
    context.lastDelay = delaySamples;
}

// Process each channel
for (let ch = 0; ch < channelCount; ch++) {
    const offset = ch * blockSize;
    const delayBuffer = context.delayBuffers[ch];
    let writePos = context.writePositions[ch];
    
    for (let i = 0; i < blockSize; i++) {
        const inputSample = data[offset + i];
        
        // Read from delay buffer
        const delayedSample = delayBuffer[writePos];
        
        // Comb filter processing based on type
        let wetSample;
        if (combType === "ff") {
            // Feedforward: y[n] = x[n] + feedback * x[n-D]
            wetSample = inputSample + feedbackGain * delayedSample;
        } else {
            // Feedback: y[n] = x[n] + feedback * y[n-D]
            wetSample = inputSample + feedbackGain * delayedSample;
        }
        
        // Write to delay buffer (for both modes, store input for feedforward)
        if (combType === "ff") {
            delayBuffer[writePos] = inputSample; // Store input for feedforward
        } else {
            delayBuffer[writePos] = wetSample;   // Store output for feedback
        }
        
        // Update write position (circular buffer)
        writePos = (writePos + 1) % delaySamples;
        
        // Dry-Wet mix: out[n] = (1 - mix) * x[n] + mix * y[n]
        const mix = dryWetMix / 100.0;
        data[offset + i] = (1 - mix) * inputSample + mix * wetSample;
    }
    
    // Store write position for next block
    context.writePositions[ch] = writePos;
}

// Send sample rate to main thread for UI updates
data.measurements = {
    sampleRate: sampleRate,
    time: time
};

return data;
`;

class CombFilterPlugin extends PluginBase {
    constructor() {
        super("Comb Filter", "Digital comb filter with feedback/feedforward for harmonic coloration");
        this.ff = 440;  // Fundamental Frequency in Hz (20-20000)
        this.fg = 0.4;  // Feedback Gain (-1 to 1)
        this.dw = 50;   // Dry-Wet Mix in % (0-100)
        this.ct = "ff"; // Comb Type: "fb" (Feedback) or "ff" (Feedforward)
        this.sampleRate = 44100; // Default sample rate
        this.registerProcessor(combFilterProcessorFunction);
        
        // Listen for sample rate updates from the audio processor
        this.onMessage = (message) => {
            if (message?.measurements?.sampleRate !== undefined && message.measurements.sampleRate !== this.sampleRate) {
                this.sampleRate = message.measurements.sampleRate;
                // Redraw graph if UI exists
                if (this.canvas) {
                    this.drawGraph(this.canvas);
                }
            }
        };
    }

    setFundamentalFreq(freq) { this.setParameters({ ff: freq }); }
    setFeedbackGain(gain) { this.setParameters({ fg: gain }); }
    setDryWetMix(mix) { this.setParameters({ dw: mix }); }
    setCombType(type) { this.setParameters({ ct: type }); }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            ff: this.ff,
            fg: this.fg,
            dw: this.dw,
            ct: this.ct
        };
    }

    setParameters(params) {
        if (params.enabled !== undefined) this.enabled = params.enabled;
        if (params.ff !== undefined) {
            const value = typeof params.ff === "number" ? params.ff : parseFloat(params.ff);
            this.ff = value < 20 ? 20 : (value > 20000 ? 20000 : value);
        }
        if (params.fg !== undefined) {
            const value = typeof params.fg === "number" ? params.fg : parseFloat(params.fg);
            this.fg = value < -1 ? -1 : (value > 1 ? 1 : value);
        }
        if (params.ct !== undefined) {
            this.ct = params.ct === "ff" ? "ff" : "fb";
        }
        if (params.dw !== undefined) {
            const value = typeof params.dw === "number" ? params.dw : parseFloat(params.dw);
            this.dw = value < 0 ? 0 : (value > 100 ? 100 : value);
        }
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement("div");
        container.className = "comb-filter-plugin-ui plugin-parameter-ui";

        // Create graph container and canvas
        const { container: graphContainer, canvas } = this.createResponsiveGraph({
            maxWidth: 600,
            aspectRatio: "5 / 2",
            mobileAspectRatio: "2 / 1",
            className: "comb-filter-graph",
            onResize: ({ canvas }) => this.drawGraph(canvas)
        });
        graphContainer.style.margin = "10px auto";
        canvas.style.margin = "0 auto";

        // Create Fundamental Frequency row
        const freqRow = this.createParameterControl("Fundamental Frequency", 20, 20000, 1, this.ff,
            (value) => {
                this.setFundamentalFreq(value);
                this.drawGraph(canvas);
            },
            'Hz'
        );

        // Create Comb Type radio buttons
        const combTypeRow = document.createElement("div");
        combTypeRow.className = "parameter-row";
        
        const combTypeLabel = document.createElement("label");
        combTypeLabel.textContent = "Comb Type:";
        combTypeLabel.style.minWidth = "120px";
        combTypeRow.appendChild(combTypeLabel);
        
        const radioGroup = document.createElement("div");
        radioGroup.className = "radio-group";
        
        const feedbackRadio = document.createElement("input");
        feedbackRadio.type = "radio";
        feedbackRadio.name = `comb-type-${this.id}`;
        feedbackRadio.id = `feedback-${this.id}`;
        feedbackRadio.value = "fb";
        feedbackRadio.checked = this.ct === "fb";
        feedbackRadio.autocomplete = "off";
        
        const feedbackLabel = document.createElement("label");
        feedbackLabel.htmlFor = `feedback-${this.id}`;
        feedbackLabel.textContent = "Feedback";
        
        const feedforwardRadio = document.createElement("input");
        feedforwardRadio.type = "radio";
        feedforwardRadio.name = `comb-type-${this.id}`;
        feedforwardRadio.id = `feedforward-${this.id}`;
        feedforwardRadio.value = "ff";
        feedforwardRadio.checked = this.ct === "ff";
        feedforwardRadio.autocomplete = "off";
        
        const feedforwardLabel = document.createElement("label");
        feedforwardLabel.htmlFor = `feedforward-${this.id}`;
        feedforwardLabel.textContent = "Feedforward";
        
        // Add event listeners
        const updateCombType = () => {
            const selectedType = feedbackRadio.checked ? "fb" : "ff";
            this.setCombType(selectedType);
            this.drawGraph(canvas);
        };
        
        feedbackRadio.addEventListener("change", updateCombType);
        feedforwardRadio.addEventListener("change", updateCombType);
        
        radioGroup.appendChild(feedbackRadio);
        radioGroup.appendChild(feedbackLabel);
        radioGroup.appendChild(feedforwardRadio);
        radioGroup.appendChild(feedforwardLabel);
        combTypeRow.appendChild(radioGroup);

        // Create Feedback Gain row (updated range)
        const feedbackRow = this.createParameterControl("Feedback Gain", -1, 1, 0.01, this.fg,
            (value) => {
                this.setFeedbackGain(value);
                this.drawGraph(canvas);
            }
        );

        // Create Dry-Wet Mix row
        const mixRow = this.createParameterControl("Dry-Wet Mix", 0, 100, 1, this.dw,
            (value) => {
                this.setDryWetMix(value);
                this.drawGraph(canvas);
            },
            '%'
        );

        container.appendChild(freqRow);
        container.appendChild(combTypeRow);
        container.appendChild(feedbackRow);
        container.appendChild(mixRow);
        container.appendChild(graphContainer);
        this.canvas = canvas; // Store canvas reference for redrawing
        this.drawGraph(canvas);
        return container;
    }

    drawGraph(canvas) {
        const ctx = canvas.getContext("2d");
        const rect = canvas.getBoundingClientRect();
        const cssWidth = rect.width || canvas.clientWidth || canvas.width;
        const cssHeight = rect.height || canvas.clientHeight || canvas.height;
        const dpr = canvas.width / cssWidth || 1;
        const width = Math.max(1, Math.round(cssWidth));
        const height = Math.max(1, Math.round(cssHeight));
        const isMobileLayout = typeof document !== 'undefined' && document.body && document.body.classList.contains('layout-mobile');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        // Draw grid (same as Band Pass Filter)
        ctx.strokeStyle = "#444";
        ctx.lineWidth = isMobileLayout ? 1 : 0.5;
        ctx.font = "12px Arial";
        const freqs = [2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        freqs.forEach(freq => {
            const x = width * (Math.log10(freq) - Math.log10(1)) / (Math.log10(40000) - Math.log10(1));
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
            if (freq >= 1 && freq <= 40000) {
                ctx.fillStyle = "#666";
                ctx.textAlign = "center";
                ctx.fillText(freq >= 1000 ? `${freq/1000}k` : freq, x, height - 24);
            }
        });
        const dBs = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
        dBs.forEach(db => {
            const y = height * (1 - (db + 24) / 48);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            if (db > -24 && db < 24) {
                ctx.fillStyle = "#666";
                ctx.textAlign = "right";
                ctx.fillText(`${db}dB`, 48, y + 4);
            }
        });
        ctx.fillStyle = "#fff";
        ctx.font = "14px Arial";
        ctx.textAlign = "center";
        ctx.fillText("Frequency (Hz)", width / 2, height - 5);
        ctx.save();
        ctx.translate(14, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("Level (dB)", 0, 0);
        ctx.restore();

        // Calculate and draw Comb Filter frequency response
        // Use the stored sample rate from the plugin instance
        const sampleRate = this.sampleRate;
        const delaySamples = Math.max(2, Math.round(sampleRate / this.ff));
        const effectiveFreq = sampleRate / delaySamples;
        
        // Calculate delay distance in mm (speed of sound ≈ 343 m/s)
        const speedOfSound = 343; // m/s
        const delayTimeMs = (delaySamples / sampleRate) * 1000; // ms
        const delayDistanceMm = (speedOfSound * delayTimeMs / 1000) * 1000; // mm
        
        ctx.beginPath();
        ctx.strokeStyle = "#00ff00";
        ctx.lineWidth = isMobileLayout ? 2 : 1;
        
        for (let i = 0; i < width; i++) {
            const freq = Math.pow(10, Math.log10(1) + (i / width) * (Math.log10(40000) - Math.log10(1)));
            
            // Calculate Comb Filter frequency response based on type
            const omega = 2 * Math.PI * freq / sampleRate;
            const theta = omega * delaySamples;
            const cosTheta = Math.cos(theta);
            
            let magnitude;
            if (this.ct === "ff") {
                // Feedforward: H(z) = 1 + feedback * z^(-D)
                // |H(f)| = sqrt(1 + feedback² + 2*feedback*cos(2π*f*D/Fs))
                magnitude = Math.sqrt(1 + this.fg * this.fg + 2 * this.fg * cosTheta);
            } else {
                // Feedback: H(z) = 1 / (1 - feedback * z^(-D))
                // |H(f)| = 1 / sqrt(1 + feedback² - 2*feedback*cos(2π*f*D/Fs))
                magnitude = 1 / Math.sqrt(1 + this.fg * this.fg - 2 * this.fg * cosTheta);
            }
            
            // Calculate overall response with Dry-Wet Mix
            // |Overall(f)| = |(1 - mix) + mix * H(f)|
            const mix = this.dw / 100.0;
            const overallMagnitude = Math.abs((1 - mix) + mix * magnitude);
            
            // Convert to dB
            const responseDB = 20 * Math.log10(overallMagnitude);
            const y = height * (1 - (responseDB + 24) / 48);
            
            i === 0 ? ctx.moveTo(i, y) : ctx.lineTo(i, y);
        }
        ctx.stroke();
        
        // Draw fundamental frequency marker
        const markerX = width * (Math.log10(effectiveFreq) - Math.log10(1)) / (Math.log10(40000) - Math.log10(1));
        if (markerX >= 0 && markerX <= width) {
            ctx.strokeStyle = "#ff0000";
            ctx.lineWidth = isMobileLayout ? 2 : 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(markerX, 0);
            ctx.lineTo(markerX, height);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Label the fundamental frequency and delay distance (larger text for 1/2 resolution)
            ctx.fillStyle = "#ff0000";
            ctx.font = "13px Arial";
            ctx.textAlign = "center";
            ctx.fillText(`${effectiveFreq.toFixed(1)} Hz`, markerX, 30);
            ctx.fillText(`${delayDistanceMm.toFixed(1)} mm`, markerX, 46);
        }
    }
}

window.CombFilterPlugin = CombFilterPlugin;
