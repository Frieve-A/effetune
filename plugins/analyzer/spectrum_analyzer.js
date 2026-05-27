class SpectrumAnalyzerPlugin extends PluginBase {
    constructor() {
        super('Spectrum Analyzer', 'Real-time spectrum analyzer with peak hold');
        
        // Initialize parameters
        this.dr = -96;
        this.pt = 12;
        const fftSize = 1 << this.pt; // Using bit shift for power of 2
        this.spectrum = new Float32Array(fftSize >> 1).fill(-144);
        this.peaks = new Float32Array(fftSize >> 1).fill(-144);
        this.lastProcessTime = performance.now() / 1000;
        this.sampleRate = 48000; // Default, updated from processor messages

        // dB correction factors for 0dBFS scaling (assuming 1/N FFT normalization & Hann window)
        this.correctionAC = 10 * Math.log10(16); // For AC components (approx. +12.04dB)
        this.correctionDC = 10 * Math.log10(4);  // For DC component (approx. +6.02dB)

        // Initialize FFT buffers and tables
        this.real = new Float32Array(fftSize);
        this.imag = new Float32Array(fftSize);
        this.window = new Float32Array(fftSize);
        this.sinTable = new Float32Array(fftSize);
        this.cosTable = new Float32Array(fftSize);

        // Combined loop: Initialize sin/cos tables for FFT and Hann window
        const factor = 2 * Math.PI / fftSize;
        for (let i = 0; i < fftSize; i++) {
            const t = factor * i;
            this.sinTable[i] = -Math.sin(t); // sin(-t)
            this.cosTable[i] = Math.cos(t);
            this.window[i] = 0.5 * (1 - Math.cos(t));
        }

        // Store event listeners for cleanup
        this.boundEventListeners = new Map();

        // Register processor function
        this.registerProcessor(SpectrumAnalyzerPlugin.processorFunction);
        this.observer = null;
    }

    static processorFunction = `
        // Reuse result buffer from context
        let result = context.resultBuffer;
        if (!result || result.length !== data.length) {
            result = new Float32Array(data.length);
            context.resultBuffer = result;
        }
        result.set(data);

        const { channelCount, blockSize, pt } = parameters; // Removed ch
        const fftSize = 1 << pt; // Using bit shift for power of 2
        
        // Initialize context if needed - Modified for single average buffer
        if (!context.initialized || context.fftSize !== fftSize || !context.buffer) { // Check if buffer exists
            context.buffer = [new Float32Array(fftSize)]; // Single buffer in an array
            context.bufferPosition = 0;
            context.fftSize = fftSize;
            context.initialized = true;
        }

        // --- Process input data: Calculate average and write to single buffer ---
        const averageBuffer = context.buffer[0]; // Target the single buffer
        let bufferPosition = context.bufferPosition;
        for (let i = 0; i < blockSize; i++) {
            const leftSample = data[i] || 0; // Get Left sample (or 0 if undefined)
            const rightSample = channelCount > 1 ? data[blockSize + i] : leftSample; // Get Right sample (or use Left if mono)
            const averageSample = (leftSample + rightSample) * 0.5; // Calculate arithmetic average
            averageBuffer[bufferPosition] = averageSample; // Write average to buffer[0]
            bufferPosition = (bufferPosition + 1) & (fftSize - 1);
        }
        context.bufferPosition = bufferPosition; // Update position

        // Send buffer to UI every half FFT size
        if (context.bufferPosition % (fftSize / 2) === 0) {
            result.measurements = {
                buffer: [Float32Array.from(context.buffer[0])], // Send copy of average buffer in array
                bufferPosition: context.bufferPosition,
                time: time,
                sampleRate: parameters.sampleRate 
            };
        }

        return result;
    `;

    // FFT implementation
    fft(real, imag) {
        const n = real.length;
        
        // Bit reversal
        for (let i = 0; i < n; i++) {
            const j = this.reverseBits(i);
            if (j > i) {
                [real[i], real[j]] = [real[j], real[i]];
                [imag[i], imag[j]] = [imag[j], imag[i]];
            }
        }

        // FFT
        for (let stage = 1, size = 2; size <= n; stage++, size <<= 1) {
            const halfSize = size >> 1;
            const shift = this.pt - stage;
            
            for (let i = 0; i < n; i += size) {
                for (let j = i, k = 0; j < i + halfSize; j++, k++) {
                    const tableIndex = (k << shift) & (n - 1);
                    const cos = this.cosTable[tableIndex];
                    const sin = this.sinTable[tableIndex];
                    
                    const tr = real[j + halfSize] * cos - imag[j + halfSize] * sin;
                    const ti = real[j + halfSize] * sin + imag[j + halfSize] * cos;
                    
                    real[j + halfSize] = (real[j] - tr) * 0.5;
                    imag[j + halfSize] = (imag[j] - ti) * 0.5;
                    real[j] = (real[j] + tr) * 0.5;
                    imag[j] = (imag[j] + ti) * 0.5;
                }
            }
        }
    }

    reverseBits(x) {
        let result = 0;
        const bits = this.pt;
        for (let i = 0; i < bits; i++) {
            result = (result << 1) | (x & 1);
            x >>= 1;
        }
        return result;
    }

    // Parameter setters
    setDBRange(value) {
        const val = typeof value === 'number' ? value : parseFloat(value);
        this.dr = val < -144 ? -144 : (val > -48 ? -48 : val);
        this.updateParameters();
    }

    setPoints(value) {
        const parsedValue = typeof value === 'number' ? value : parseFloat(value);
        const newPoints = parsedValue < 8 ? 8 : (parsedValue > 14 ? 14 : parsedValue);
        if (newPoints === this.pt) return;
        
        this.pt = newPoints; // Update pt first
        const fftSize = 1 << newPoints;
        
        this.spectrum = new Float32Array(fftSize >> 1).fill(-144);
        this.peaks = new Float32Array(fftSize >> 1).fill(-144);
        this.real = new Float32Array(fftSize);
        this.imag = new Float32Array(fftSize);
        this.window = new Float32Array(fftSize);
        this.sinTable = new Float32Array(fftSize);
        this.cosTable = new Float32Array(fftSize);

        const factor = 2 * Math.PI / fftSize;
        for (let i = 0; i < fftSize; i++) {
            const t = factor * i;
            this.sinTable[i] = -Math.sin(t);
            this.cosTable[i] = Math.cos(t);
            this.window[i] = 0.5 * (1 - Math.cos(t));
        }
        
        this.lastProcessTime = performance.now() / 1000;
        this.updateParameters();
    }

    // Reset parameters
    reset() {
        this.setDBRange(-96);
        this.setPoints(12); // Note: constructor uses 12, reset button might use 10. Keeping 12 here.
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            dr: this.dr,
            pt: this.pt
        };
    }

    setParameters(params) {
        if (params.enabled !== undefined) this.enabled = params.enabled;
        if (params.dr !== undefined) this.setDBRange(params.dr);
        if (params.pt !== undefined) this.setPoints(params.pt);
        this.updateParameters();
    }

    onMessage(message) {
        if (message.type === 'processBuffer') {
            this.process(message);
        }
    }

    process(message) {
        if (!message?.measurements?.buffer) {
            return;
        }

        if (!this.enabled) {
            return;
        }

        const fftSize = 1 << this.pt;
        const halfFft = fftSize >> 1;
        const bufferPosition = message.measurements.bufferPosition;
        const [averageBuffer] = message.measurements.buffer;

        if (!averageBuffer || fftSize !== averageBuffer.length) return;

        // Update sampleRate if it has changed
        if (message.measurements.sampleRate && this.sampleRate !== message.measurements.sampleRate) {
            this.sampleRate = message.measurements.sampleRate;
            // this.updateParameters(); // Could inform processor if needed, or just for UI
        }

        this.imag.fill(0);
        let pos = bufferPosition % fftSize;
        for (let i = 0; i < fftSize; i++) {
            let sample = averageBuffer[pos];
            this.real[i] = sample * this.window[i];
            pos++;
            if (pos >= fftSize) pos = 0;
        }

        this.fft(this.real, this.imag);

        // Calculate magnitude spectrum
        for (let i = 0; i < halfFft; i++) {
            const rawPower = this.real[i] * this.real[i] + this.imag[i] * this.imag[i];
            
            let currentCorrection;
            if (i === 0) { // DC component
                currentCorrection = this.correctionDC;
            } else { // AC components
                currentCorrection = this.correctionAC;
            }
            
            const db = 10 * Math.log10(rawPower + 1e-24) + currentCorrection;
            this.spectrum[i] = db;
        }

        const currentTime = message.measurements.time;
        const deltaTime = this.lastProcessTime < currentTime ? currentTime - this.lastProcessTime : 0.02;
        const decay = 20 * deltaTime;

        if (!this.peaks || this.peaks.length !== halfFft) {
            this.peaks = new Float32Array(halfFft).fill(-145);
        }

        for (let i = 0; i < halfFft; i++) {
            if (isNaN(this.peaks[i]) || this.peaks[i] < -145 || this.peaks[i] > 0) {
                this.peaks[i] = -145;
            }
            const decayedPeak = this.peaks[i] - decay;
            const newPeak = this.spectrum[i] > decayedPeak ? this.spectrum[i] : decayedPeak;
            this.peaks[i] = newPeak < -145 ? -145 : newPeak > 0 ? 0 : newPeak;
        }
        
        this.lastProcessTime = currentTime;
        return;
    }

    createUI() {
        if (this.observer) {
            this.observer.disconnect();
        }
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        container.appendChild(this.createParameterControl(
            'DB Range', -144, -48, 1, this.dr, (v) => this.setDBRange(v), 'dB'
        ));

        const pointsRow = document.createElement('div');
        pointsRow.className = 'parameter-row';
        const pointsLabel = document.createElement('label');
        pointsLabel.textContent = 'Points:';
        pointsLabel.htmlFor = `${this.id}-${this.name}-points-slider`;
        const pointsSlider = document.createElement('input');
        pointsSlider.type = 'range'; pointsSlider.id = `${this.id}-${this.name}-points-slider`; pointsSlider.name = `${this.id}-${this.name}-points-slider`;
        pointsSlider.min = 8; pointsSlider.max = 14; pointsSlider.step = 1; pointsSlider.value = this.pt; pointsSlider.autocomplete = "off";
        const pointsValue = document.createElement('input');
        pointsValue.type = 'number'; pointsValue.id = `${this.id}-${this.name}-points-value`; pointsValue.name = `${this.id}-${this.name}-points-value`;
        pointsValue.value = 1 << this.pt; pointsValue.step = 1; pointsValue.min = 1 << 8; pointsValue.max = 1 << 14; pointsValue.autocomplete = "off";

        const pointsHandler = (e) => {
            const value = parseInt(e.target.value);
            pointsValue.value = 1 << value; // Update text input when slider changes
            this.setPoints(value);
        };
        pointsSlider.addEventListener('input', pointsHandler);
        this.boundEventListeners.set(pointsSlider, pointsHandler);
        
        // Update slider when text input changes
        pointsValue.addEventListener('change', (e) => {
            const numFFTPoints = parseInt(e.target.value);
            const exponent = Math.round(Math.log2(numFFTPoints)); // Allow nearest power of 2
            if (exponent >= 8 && exponent <= 14) {
                pointsSlider.value = exponent;
                pointsValue.value = 1 << exponent; // Ensure value is a power of 2
                this.setPoints(exponent);
            } else {
                 pointsValue.value = 1 << this.pt; // Revert to current if invalid
            }
        });


        pointsRow.appendChild(pointsLabel);
        pointsRow.appendChild(pointsSlider);
        pointsRow.appendChild(pointsValue);
        container.appendChild(pointsRow);

        const graphContainer = document.createElement('div');
        graphContainer.className = 'graph-container';
        graphContainer.style.position = 'relative'; graphContainer.style.width = '1024px'; graphContainer.style.height = '480px';
        
        const canvas = document.createElement('canvas');
        canvas.width = 2048; canvas.height = 960;
        canvas.style.width = '1024px'; canvas.style.height = '480px';
        graphContainer.appendChild(canvas);
        this.canvas = canvas;

        const resetButton = document.createElement('button');
        resetButton.className = 'analyzer-reset-button'; resetButton.textContent = 'Reset';
        const resetHandler = () => {
            const defaultDBRange = -96;
            const defaultPoints = 12; // Reset to 12 as per constructor/reset method
            
            // Update UI elements before calling internal reset
            const dbRangeSlider = container.querySelector(`input[type="range"][min="-144"]`); // Example selector
            if(dbRangeSlider) dbRangeSlider.value = defaultDBRange;
            // Update associated span for dbRangeSlider if you have one.

            pointsSlider.value = defaultPoints;
            pointsValue.value = 1 << defaultPoints;

            this.reset(); // This will call setDBRange and setPoints
        };
        resetButton.addEventListener('click', resetHandler);
        this.boundEventListeners.set(resetButton, resetHandler);
        graphContainer.appendChild(resetButton);
        container.appendChild(graphContainer);

        if (this.observer == null) {
            this.observer = new IntersectionObserver(this.handleIntersect.bind(this));
        }
        this.observer.observe(this.canvas);
        return container;
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
        if (this.animationFrameId) return;
        if (!this.enabled || !this._sectionEnabled) return; // Skip if disabled or section is off.
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

    cleanup() {
        this.stopAnimation(); // Stop animation first
        if (this.observer && this.canvas) { // Check if canvas exists before trying to unobserve
            this.observer.unobserve(this.canvas);
        }
        // Cleanup event listeners
        this.boundEventListeners.forEach((handler, element) => {
            // Determine event type if not stored (assuming 'input' or 'click' primarily)
            // A more robust way is to store {event: 'input', handler: handler}
            element.removeEventListener('input', handler); 
            element.removeEventListener('click', handler); 
        });
        this.boundEventListeners.clear();
        this.lastProcessTime = performance.now() / 1000;
    }

    drawGraph() {
        if (!this.canvas) return;
        
        const ctx = this.canvas.getContext('2d', { alpha: false });
        const width = this.canvas.width;
        const height = this.canvas.height;

        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;

        // --- Dynamic Frequency Axis Scaling ---
        const minDisplayFreq = 20; // Hz
        const nyquistFreq = this.sampleRate / 2;
        // Max display frequency is Nyquist, but ensure it's at least minDisplayFreq
        let maxDisplayFreq = 40000; // Fixed max display frequency

        if (this.sampleRate <= 0 || nyquistFreq <= minDisplayFreq) { // Not enough range or invalid sampleRate
            ctx.fillStyle = '#fff';
            ctx.font = '28px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Invalid Sample Rate or Range', width / 2, height / 2);
            return;
        }

        const logMinDisplayFreq = Math.log10(minDisplayFreq);
        const logMaxDisplayFreq = Math.log10(maxDisplayFreq);
        const logFreqRange = logMaxDisplayFreq - logMinDisplayFreq;

        if (logFreqRange <= 0) { // Avoid division by zero or negative log range
             ctx.fillStyle = '#fff'; ctx.font = '28px Arial'; ctx.textAlign = 'center';
             ctx.fillText('Invalid Frequency Range for Log Scale', width / 2, height / 2);
             return;
        }

        // Vertical grid lines (frequency) - Dynamic
        let baseGridFreqs = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]; // Common audio freqs
        // Add Nyquist to the list if it's not too close to another major tick, or for the max label
        // Filter and ensure min/max are present
        let gridFreqsToDraw = baseGridFreqs.filter(f => f >= minDisplayFreq && f <= maxDisplayFreq);
        if (!gridFreqsToDraw.includes(minDisplayFreq) && minDisplayFreq > 0) gridFreqsToDraw.unshift(minDisplayFreq);
        if (!gridFreqsToDraw.includes(maxDisplayFreq)) gridFreqsToDraw.push(maxDisplayFreq);
        gridFreqsToDraw = [...new Set(gridFreqsToDraw)].sort((a, b) => a - b); // Unique & sorted

        gridFreqsToDraw.forEach(freq => {
            const x = width * (Math.log10(freq) - logMinDisplayFreq) / logFreqRange;
            if (x >=0 && x <= width) { // Draw only if within canvas
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();

                if (freq !== minDisplayFreq && freq !== maxDisplayFreq && x > width*0.02 && x < width*0.98) { // Avoid clutter at edges
                    ctx.fillStyle = '#666';
                    ctx.font = '24px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText(freq >= 1000 ? `${Math.round(freq / 100)/10}k` : freq, x, height - 80);
                }
            }
        });

        // Horizontal grid lines (dB) - No change to this logic
        const dbStep = 12;
        for (let db = 0; db >= this.dr; db -= dbStep) {
            const y = height * (db / this.dr);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
            if (db !== 0 && db !== this.dr) {
                ctx.fillStyle = '#666'; ctx.font = '24px Arial'; ctx.textAlign = 'right';
                ctx.fillText(`${db}dB`, 160, y + 12);
            }
        }

        // Draw axis labels
        ctx.fillStyle = '#fff'; ctx.font = '28px Arial'; ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', width / 2, height - 10);
        ctx.save();
        ctx.translate(40, height / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('Level (dB)', 0, 0);
        ctx.restore();

        // Draw spectrum
        const fftSize = 1 << this.pt;
        const binCount = fftSize >> 1;
        const xToLevels = new Map();
        
        for (let i = 0; i < binCount; i++) {
            const freq = (i * this.sampleRate) / fftSize; // Correct bin frequency calculation

            if (freq < minDisplayFreq || freq > maxDisplayFreq || logFreqRange <=0 ) continue;

            const currentFreqClamped = Math.max(minDisplayFreq, Math.min(freq, maxDisplayFreq));
            const x = Math.round(width * (Math.log10(currentFreqClamped) - logMinDisplayFreq) / logFreqRange);
            
            const spectrumLevel = this.spectrum[i] > 0 ? 0 : this.spectrum[i];
            const peakLevel = this.peaks[i] > 0 ? 0 : this.peaks[i];

            if (!xToLevels.has(x)) {
                xToLevels.set(x, [spectrumLevel, peakLevel]);
            } else {
                const [currentSpectrum, currentPeak] = xToLevels.get(x);
                xToLevels.set(x, [
                    currentSpectrum > spectrumLevel ? currentSpectrum : spectrumLevel,
                    currentPeak > peakLevel ? currentPeak : peakLevel
                ]);
            }
        }
        
        // Sort map entries by x-coordinate for correct line drawing
        const sortedXToLevels = new Map([...xToLevels.entries()].sort((a, b) => a[0] - b[0]));

        // Draw spectrum line
        ctx.beginPath();
        ctx.strokeStyle = '#008800'; ctx.lineWidth = 4;
        let first = true;
        for (const [x, [spectrumLevel]] of sortedXToLevels) {
            const y = height * (spectrumLevel / this.dr);
            if (first) {
                ctx.moveTo(x, y);
                first = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // Draw peak hold line
        ctx.beginPath();
        ctx.strokeStyle = '#00ff00'; ctx.lineWidth = 2;
        first = true;
        for (const [x, [, peakLevel]] of sortedXToLevels) {
            const y = height * (peakLevel / this.dr);
            if (first) {
                ctx.moveTo(x, y);
                first = false;
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    }
}

// Register plugin (assuming PluginBase and window context for browser)
if (typeof window !== 'undefined' && typeof PluginBase !== 'undefined') {
    window.SpectrumAnalyzerPlugin = SpectrumAnalyzerPlugin;
}