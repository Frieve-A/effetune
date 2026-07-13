const SPECTROGRAM_TAP_FRAME = 5;
const SPECTROGRAM_TELEMETRY_VERSION = 1;
const SPECTROGRAM_PAYLOAD_BYTES = 268;
const SPECTROGRAM_PAYLOAD_HEADER_BYTES = 12;
const SPECTROGRAM_CELL_COUNT = 256;
const SPECTROGRAM_HISTORY_WIDTH = 1024;

class SpectrogramPlugin extends PluginBase {
    constructor() {
        super('Spectrogram', 'Real-time spectrogram analyzer');
        
        // Initialize parameters
        this.dr = -96;
        this.pt = 12;  // exponent for FFT size (2^pt)
        const fftSize = 1 << this.pt; // using bit shift for power of 2
        this.spectrum = new Float32Array(fftSize >> 1).fill(-144);
        this.lastProcessTime = performance.now() / 1000;
        this.sampleRate = 48000;

        // dB correction factors for 0dBFS scaling (Hann window, non-normalized FFT)
        // Combined with -20*log10(N) later for FFT normalization part.
        this.correctionAC_val = 10 * Math.log10(16); // For AC components (approx. +12.04dB from window & single-side)
        this.correctionDC_val = 10 * Math.log10(4);  // For DC component (approx. +6.02dB from window)

        // Initialize FFT buffers and tables
        this.real = new Float32Array(fftSize);
        this.imag = new Float32Array(fftSize);
        this.window = new Float32Array(fftSize);
        
        // Precompute sin/cos tables for FFT
        this.sinTable = new Float32Array(fftSize);
        this.cosTable = new Float32Array(fftSize);
        for (let i = 0; i < fftSize; i++) {
            const angle = -2 * Math.PI * i / fftSize; // Standard FFT twiddle factor
            this.sinTable[i] = Math.sin(angle);
            this.cosTable[i] = Math.cos(angle);
        }

        // Initialize Hann window
        for (let i = 0; i < fftSize; i++) {
            // For periodic Hann window, use fftSize in denominator.
            // If symmetric (for convolution), use fftSize - 1.
            // Current is periodic, common for spectral analysis with FFT.
            this.window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize));
        }

        // Initialize spectrogram buffer (256 frequency bins x 1024 time points)
        this.spectrogramBuffer = new Float32Array(256 * 1024).fill(-144);
        this.spectrogramIntensityBuffer = new Uint8Array(
            SPECTROGRAM_CELL_COUNT * SPECTROGRAM_HISTORY_WIDTH
        );
        this.spectrogramColorLut = this.createSpectrogramColorLut();
        this.spectrogramWriteColumn = 0;
        this.spectrogramColumnCount = 0;
        this.dspSpectrogramActive = false;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspSpectrogramTelemetry = frame => this.handleDspSpectrogramTelemetry(frame);

        // Initialize ImageData cache and temporary canvas for drawing
        this.imageDataCache = null;
        this.tempCanvas = null;
        this.tempCtx = null;

        // Cache for main canvas context
        this.canvasCtx = null;
        this.canvas = null;

        this.secondMarkers = [];
        this.prevTime = null;

        // Store event listeners for cleanup
        this.boundEventListeners = new Map();

        // Register processor function (used e.g. in an AudioWorklet)
        this.registerProcessor(SpectrogramPlugin.processorFunction);

        this.observer = null;
        this.resizeGraphDisposer = null;
        this.graphDpr = 1;
        this.graphCssWidth = 1024;
    }

    // Processor function as a string (runs in separate context)
    static processorFunction = `
        // Create result buffer
        const result = data; // Assuming 'data' is the input audio Float32Array from processor

        const { channelCount, blockSize, pt, sampleRate: currentSampleRate } = parameters; 
        const fftSize = Math.pow(2, pt);
        
        if (!context.initialized || context.fftSize !== fftSize || !context.buffer) { 
            context.buffer = [new Float32Array(fftSize)]; 
            context.bufferPosition = 0;
            context.fftSize = fftSize;
            context.initialized = true;
        }

        const averageBuffer = context.buffer[0]; 
        let bufferPosition = context.bufferPosition;
        for (let i = 0; i < blockSize; i++) {
            const leftSample = data[i] || 0; 
            const rightSample = channelCount > 1 && data[blockSize + i] !== undefined ? data[blockSize + i] : leftSample; 
            const averageSample = (leftSample + rightSample) * 0.5; 
            averageBuffer[bufferPosition] = averageSample; 
            bufferPosition = (bufferPosition + 1) & (fftSize - 1);
        }
        context.bufferPosition = bufferPosition; 

        if (context.bufferPosition % (fftSize / 2) === 0) {
            result.measurements = {
                buffer: [Float32Array.from(context.buffer[0])], 
                bufferPosition: context.bufferPosition,
                time: time, // 'time' should be available in AudioWorkletProcessor's process method
                sampleRate: currentSampleRate // Pass current sample rate from processor's parameters
            };
        }
        return result; // In AudioWorklet, this would be 'return true;'
    `;

    // FFT implementation using Cooley-Tukey algorithm
    fft(real, imag) {
        const n = real.length;
        const bits = this.pt; // log2(n)
        // Bit reversal
        for (let i = 0; i < n; i++) {
            const j = this.reverseBits(i, bits);
            if (j > i) {
                const tempR = real[i]; real[i] = real[j]; real[j] = tempR;
                const tempI = imag[i]; imag[i] = imag[j]; imag[j] = tempI;
            }
        }

        // FFT: butterfly computation
        for (let stage = 1, size = 2; size <= n; stage++, size <<= 1) {
            const halfSize = size >> 1;
            const shift = bits - stage; // Used to select twiddle factors from precomputed table
            for (let i = 0; i < n; i += size) {
                for (let j = i, k = 0; j < i + halfSize; j++, k++) {
                    // k << shift provides the correct index into the N-sized twiddle factor table
                    const tableIndex = (k << shift) & (n - 1); 
                    const cos_w = this.cosTable[tableIndex];
                    const sin_w = this.sinTable[tableIndex];
                    const tr = real[j + halfSize] * cos_w - imag[j + halfSize] * sin_w;
                    const ti = real[j + halfSize] * sin_w + imag[j + halfSize] * cos_w;
                    real[j + halfSize] = real[j] - tr;
                    imag[j + halfSize] = imag[j] - ti;
                    real[j] += tr;
                    imag[j] += ti;
                }
            }
        }
    }

    reverseBits(x, bits) {
        let result = 0;
        for (let i = 0; i < bits; i++) {
            result = (result << 1) | (x & 1);
            x >>= 1;
        }
        return result;
    }

    // Convert frequency to log-scaled y coordinate (0-255 for spectrogram buffer)
    freqToY(freq) {
        const minDisplayFreq = 20;
        const nyquistFreq = this.sampleRate / 2;
        // Ensure maxDisplayFreq is at least minDisplayFreq, use Nyquist as upper bound.
        const maxDisplayFreq = 40000; //Fixed

        if (this.sampleRate <= 0 || nyquistFreq <= minDisplayFreq || freq < minDisplayFreq) {
             return 255; // Map to bottom for frequencies below min or invalid sample rate
        }
        if (freq > maxDisplayFreq) {
            return 0; // Map to top for frequencies above max
        }

        const logMin = Math.log10(minDisplayFreq);
        const logMax = Math.log10(maxDisplayFreq);
        const logRange = logMax - logMin;

        if (logRange <= 0) return 255; // Avoid issues with zero or negative range

        // Clamp freq just in case, though prior checks should handle it
        const freqClamped = Math.max(minDisplayFreq, Math.min(freq, maxDisplayFreq));
        
        // Spectrogram typically has low frequencies at the bottom, high at the top.
        // y=0 is top, y=255 is bottom for a 256-pixel high spectrogram image.
        const y = 255 - Math.round(255 * (Math.log10(freqClamped) - logMin) / logRange);
        return y < 0 ? 0 : (y > 255 ? 255 : y);
    }

    binToFreq(bin, fftSize) {
        return (bin * this.sampleRate) / fftSize;
    }

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
        this.real = new Float32Array(fftSize);
        this.imag = new Float32Array(fftSize);
        this.window = new Float32Array(fftSize);
        this.sinTable = new Float32Array(fftSize);
        this.cosTable = new Float32Array(fftSize);
        for (let i = 0; i < fftSize; i++) {
            const angle = -2 * Math.PI * i / fftSize;
            this.sinTable[i] = Math.sin(angle);
            this.cosTable[i] = Math.cos(angle);
            this.window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize));
        }
        
        // Reset spectrogram buffer (dimensions are fixed, but content should clear on FFT change)
        this.spectrogramBuffer.fill(-144);
        this.resetDspSpectrogramHistory();
        this.clearSpectrogramImage();

        this.lastProcessTime = performance.now() / 1000;
        this.updateParameters();
    }

    reset() {
        this.setDBRange(-96);
        this.setPoints(10); // Original reset used 10, constructor 12. Sticking to 10 for reset.
        this.spectrogramBuffer.fill(-144);
        this.resetDspSpectrogramHistory();
        this.clearSpectrogramImage();
        this.secondMarkers = [];
        this.prevTime = null;
        this.updateParameters();
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
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
                SPECTROGRAM_TAP_FRAME,
                this._boundDspSpectrogramTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(
                    tapId,
                    SPECTROGRAM_TAP_FRAME,
                    this._boundDspSpectrogramTelemetry
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

    parseDspSpectrogramTelemetryFrame(frame) {
        if (frame?.frameType !== SPECTROGRAM_TAP_FRAME ||
            frame.formatVersion !== SPECTROGRAM_TELEMETRY_VERSION) {
            return null;
        }
        const payload = frame.payload;
        if (!payload || typeof payload.getFloat32 !== 'function' ||
            typeof payload.getUint16 !== 'function' ||
            typeof payload.getUint8 !== 'function' ||
            !Number.isInteger(payload.byteLength) ||
            payload.byteLength !== SPECTROGRAM_PAYLOAD_BYTES) {
            return null;
        }

        const sampleRate = payload.getFloat32(0, true);
        const timeSeconds = payload.getFloat32(4, true);
        const cellCount = payload.getUint16(8, true);
        const points = payload.getUint16(10, true);
        if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
            !Number.isFinite(timeSeconds) ||
            cellCount !== SPECTROGRAM_CELL_COUNT ||
            points < 8 || points > 14) {
            return null;
        }

        const intensities = new Uint8Array(SPECTROGRAM_CELL_COUNT);
        for (let cell = 0; cell < SPECTROGRAM_CELL_COUNT; cell++) {
            intensities[cell] = payload.getUint8(SPECTROGRAM_PAYLOAD_HEADER_BYTES + cell);
        }
        return { sampleRate, timeSeconds, cellCount, points, intensities };
    }

    handleDspSpectrogramTelemetry(frame) {
        const snapshot = this.parseDspSpectrogramTelemetryFrame(frame);
        if (!snapshot || !this.enabled || !this._sectionEnabled ||
            !this.spectrogramIntensityBuffer) {
            return;
        }
        if (!this.dspSpectrogramActive) {
            this.resetDspSpectrogramHistory();
            this.clearSpectrogramImage();
            this.secondMarkers = [];
            this.prevTime = null;
            this.dspSpectrogramActive = true;
        }

        this.sampleRate = snapshot.sampleRate;
        this.updateSecondMarkers(snapshot.timeSeconds);
        const column = this.spectrogramWriteColumn;
        for (let row = 0; row < SPECTROGRAM_CELL_COUNT; row++) {
            this.spectrogramIntensityBuffer[
                row * SPECTROGRAM_HISTORY_WIDTH + column
            ] = snapshot.intensities[row];
        }
        this.paintDspSpectrogramColumn(column, snapshot.intensities);
        this.spectrogramWriteColumn = (column + 1) % SPECTROGRAM_HISTORY_WIDTH;
        if (this.spectrogramColumnCount < SPECTROGRAM_HISTORY_WIDTH) {
            this.spectrogramColumnCount++;
        }
    }

    updateSecondMarkers(timeSeconds) {
        if (this.prevTime === null) {
            this.prevTime = timeSeconds;
            return;
        }
        if (timeSeconds < this.prevTime) {
            this.secondMarkers = [];
            this.prevTime = timeSeconds;
            return;
        }

        this.secondMarkers = this.secondMarkers.map(value => value - 1).filter(value => value >= 0);
        if (timeSeconds > this.prevTime &&
            Math.floor(timeSeconds) > Math.floor(this.prevTime)) {
            this.secondMarkers.push(SPECTROGRAM_HISTORY_WIDTH - 1);
        }
        this.prevTime = timeSeconds;
    }

    resetDspSpectrogramHistory() {
        this.spectrogramIntensityBuffer?.fill(0);
        this.spectrogramWriteColumn = 0;
        this.spectrogramColumnCount = 0;
    }

    clearSpectrogramImage() {
        if (!this.imageDataCache) return;
        const data = this.imageDataCache.data;
        for (let index = 0; index < data.length; index += 4) {
            data[index] = 0;
            data[index + 1] = 0;
            data[index + 2] = 0;
            data[index + 3] = 255;
        }
        this.tempCtx?.putImageData(this.imageDataCache, 0, 0);
    }

    activateLegacySpectrogram() {
        if (!this.dspSpectrogramActive) return;
        this.dspSpectrogramActive = false;
        this.spectrogramBuffer.fill(-144);
        this.clearSpectrogramImage();
        this.secondMarkers = [];
        this.prevTime = null;
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        if (message.type === 'processBuffer') {
            this.process(message);
        }
    }

    process(message) {
        if (!message?.measurements?.buffer) return;
        if (!this.enabled || !this._sectionEnabled) return;
        if (!this.spectrogramBuffer) return; // Check if spectrogramBuffer exists

        const fftSize = 1 << this.pt;
        const bufferPosition = message.measurements.bufferPosition;
        const [averageBuffer] = message.measurements.buffer;

        if (message.measurements.sampleRate && this.sampleRate !== message.measurements.sampleRate) {
            this.sampleRate = message.measurements.sampleRate;
            // Potentially clear spectrogramBuffer and imageDataCache if sampleRate changes significantly,
            // as frequency mappings will change. For now, just update.
            // this.spectrogramBuffer.fill(-144);
            // if (this.imageDataCache) this.imageDataCache.data.fill(0); // Simplified clear
        }
        
        if (!averageBuffer || fftSize !== averageBuffer.length || !this.imag ) return;

        this.activateLegacySpectrogram();

        this.imag.fill(0);
        for (let i = 0; i < fftSize; i++) {
            const pos = (bufferPosition + i) & (fftSize - 1);
            this.real[i] = averageBuffer[pos] * this.window[i];
        }

        this.fft(this.real, this.imag);

        const fftHalf = fftSize >> 1;
        const fftNormalization = -20 * Math.log10(fftSize); // For 1/N amplitude scaling

        for (let i = 0; i < fftHalf; i++) {
            const rawPower = this.real[i] * this.real[i] + this.imag[i] * this.imag[i];
            let specificCorrection;
            if (i === 0) { // DC component
                specificCorrection = this.correctionDC_val;
            } else { // AC components
                specificCorrection = this.correctionAC_val;
            }
            const db = 10 * Math.log10(rawPower + 1e-24) + specificCorrection + fftNormalization;
            this.spectrum[i] = db < -144 ? -144 : db; // Clamp to a minimum dB
        }

        const spectroWidth = 1024; // Time points
        const spectroHeight = 256;  // Frequency bins for display

        // Scroll spectrogramBuffer and ImageDataCache left by 1 column
        for (let y = 0; y < spectroHeight; y++) {
            const rowStartBuffer = y * spectroWidth;
            this.spectrogramBuffer.copyWithin(rowStartBuffer, rowStartBuffer + 1, rowStartBuffer + spectroWidth);
            if (this.imageDataCache) {
                const rowStartImage = y * spectroWidth * 4;
                this.imageDataCache.data.copyWithin(rowStartImage, rowStartImage + 4, rowStartImage + spectroWidth * 4);
            }
        }

        const t = message.measurements.time;
        if (Number.isFinite(t)) this.updateSecondMarkers(t);
        
        // Add new spectrum data to the rightmost column of the spectrogram display buffer
        const minDisplayFreq = 20;
        const nyquistFreq = this.sampleRate / 2;
        const maxDisplayFreq = 40000; //Fixed
        const logMin = Math.log10(minDisplayFreq);
        const logMax = Math.log10(maxDisplayFreq);
        const logRange = logMax - logMin;

        for (let y = 0; y < spectroHeight; y++) { // y is pixel row, 0=top, 255=bottom
            let dbValue = -144; // Default for out-of-range frequencies
            if (logRange > 0 && this.sampleRate > 0) {
                // Map y (0 to spectroHeight-1, top to bottom) to frequency (log scale, high to low freq)
                const freq = Math.pow(10, logMax - (y / (spectroHeight - 1)) * logRange);
                
                if (freq >= minDisplayFreq && freq <= nyquistFreq) { // Ensure we interpolate within valid FFT data
                    const binFloat = (freq * fftSize) / this.sampleRate;
                    const bin1 = Math.floor(binFloat);
                    
                    if (bin1 < fftHalf) {
                        const bin2 = (bin1 + 1 < fftHalf) ? bin1 + 1 : bin1;
                        const frac = binFloat - bin1;
                        const value1 = this.spectrum[bin1] !== undefined ? this.spectrum[bin1] : -144;
                        const value2 = this.spectrum[bin2] !== undefined ? this.spectrum[bin2] : -144;
                        dbValue = value1 + (value2 - value1) * frac;
                    }
                }
            }
            this.spectrogramBuffer[y * spectroWidth + (spectroWidth - 1)] = dbValue;
            if (this.imageDataCache) {
                const color = this.dbToColor(dbValue);
                const offset = (y * spectroWidth + (spectroWidth - 1)) * 4;
                this.imageDataCache.data[offset] = color[0];
                this.imageDataCache.data[offset + 1] = color[1];
                this.imageDataCache.data[offset + 2] = color[2];
                this.imageDataCache.data[offset + 3] = 255;
            }
        }
        return;
    }

    createUI() {
        if (this.observer) {
            this.observer.disconnect();
        }
        if (this.resizeGraphDisposer) {
            this.resizeGraphDisposer();
            this.resizeGraphDisposer = null;
        }
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        container.appendChild(this.createParameterControl(
            'DB Range', -144, -48, 1, this.dr, (v) => this.setDBRange(v), 'dB'
        ));

        const pointsRow = document.createElement('div');
        pointsRow.className = 'parameter-row';
        const pointsLabel = document.createElement('label');
        pointsLabel.textContent = 'Points:'; pointsLabel.htmlFor = `${this.id}-${this.name}-points-slider`;
        const pointsSlider = document.createElement('input');
        pointsSlider.type = 'range'; pointsSlider.id = `${this.id}-${this.name}-points-slider`; pointsSlider.name = `${this.id}-${this.name}-points-slider`;
        pointsSlider.min = 8; pointsSlider.max = 14; pointsSlider.step = 1; pointsSlider.value = this.pt; pointsSlider.autocomplete = "off";
        const pointsValue = document.createElement('input');
        pointsValue.type = 'number'; pointsValue.id = `${this.id}-${this.name}-points-value`; pointsValue.name = `${this.id}-${this.name}-points-value`;
        pointsValue.value = 1 << this.pt; pointsValue.step = 1; pointsValue.min = 1 << 8; pointsValue.max = 1 << 14; pointsValue.autocomplete = "off";
        const pointsHandler = (e) => {
            const value = parseInt(e.target.value, 10);
            pointsValue.value = 1 << value;
            this.setPoints(value);
        };
        pointsSlider.addEventListener('input', pointsHandler);
        this.boundEventListeners.set(pointsSlider, pointsHandler);

        const pointsValueHandler = (e) => { // Sync from number input
            const numFFTPoints = parseInt(e.target.value);
            const exponent = Math.round(Math.log2(numFFTPoints));
            if (exponent >= 8 && exponent <= 14) {
                pointsSlider.value = exponent;
                pointsValue.value = 1 << exponent;
                this.setPoints(exponent);
            } else {
                pointsValue.value = 1 << this.pt;
            }
        };
        pointsValue.addEventListener('change', pointsValueHandler);
        this.boundEventListeners.set(pointsValue, pointsValueHandler);
        pointsRow.appendChild(pointsLabel); pointsRow.appendChild(pointsSlider); pointsRow.appendChild(pointsValue);
        container.appendChild(pointsRow);

        const { container: graphContainer, canvas, dispose } = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '32 / 15',
            mobileAspectRatio: '4 / 3',
            onResize: ({ canvas, cssWidth, dpr }) => {
                this.canvas = canvas;
                this.graphCssWidth = cssWidth;
                this.graphDpr = dpr;
                this.canvasCtx = canvas.getContext('2d', { alpha: false });
                this.drawGraph();
            }
        });
        this.canvas = canvas;
        this.resizeGraphDisposer = dispose;
        this.canvasCtx = this.canvas.getContext('2d', { alpha: false });

        this.tempCanvas = document.createElement('canvas');
        this.tempCanvas.width = 1024; // Width of spectrogram data
        this.tempCanvas.height = 256; // Height of spectrogram data
        this.tempCtx = this.tempCanvas.getContext('2d');
        this.imageDataCache = this.tempCtx.createImageData(1024, 256);
        const data = this.imageDataCache.data; // Fill initial cache with black
        for (let i = 0, len = data.length; i < len; i += 4) { data[i]=0; data[i+1]=0; data[i+2]=0; data[i+3]=255; }
        if (this.dspSpectrogramActive) {
            this.paintDspSpectrogramImage();
        }
        this.tempCtx.putImageData(this.imageDataCache, 0, 0);
        
        container.appendChild(graphContainer); // Add graph after controls

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
                if (this.canRunAnimation()) this.startAnimation();
                else this.renderPowerUiOnce(() => this.drawGraph());
            } else {
                this.stopAnimation();
            }
        });
    }

    startAnimation() {
        if (this.animationFrameId) return;
        if (!this.enabled || !this._sectionEnabled) return;
        const animate = () => {
            if (!this.isVisible) {
                this.stopAnimation();
                return;
            }
            this.drawGraph();
            this.animationFrameId = this.requestPowerAnimationFrame(animate, 'analyzer');
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
        this.stopAnimation();
        this.disposeDspTelemetrySubscription();
        if (this.observer && this.canvas) {
            this.observer.unobserve(this.canvas);
            this.observer.disconnect();
        }
        if (this.resizeGraphDisposer) {
            this.resizeGraphDisposer();
            this.resizeGraphDisposer = null;
        }
        this.boundEventListeners.forEach((listener, element) => {
            element.removeEventListener('input', listener);
            element.removeEventListener('change', listener);
        });
        this.boundEventListeners.clear();
        this.tempCtx = null;
        this.tempCanvas = null;
        this.canvasCtx = null;
        this.canvas = null;
        this.imageDataCache = null;
        this.spectrogramBuffer = null;
        this.spectrogramIntensityBuffer = null;
        this.spectrogramColorLut = null;
        this.observer = null;
        this.secondMarkers = [];
        this.prevTime = null;
        super.cleanup();
    }

    createSpectrogramColorLut() {
        const lut = new Uint8ClampedArray(256 * 3);
        const colorStops = [
            { pos: 0.000, r: 0,   g: 0,   b: 0 },
            { pos: 0.166, r: 0,   g: 0,   b: 255 },
            { pos: 0.333, r: 0,   g: 255, b: 255 },
            { pos: 0.500, r: 0,   g: 255, b: 0 },
            { pos: 0.666, r: 255, g: 255, b: 0 },
            { pos: 0.833, r: 255, g: 0,   b: 0 },
            { pos: 1.000, r: 255, g: 255, b: 255 }
        ];
        const brightness = 0.75;
        for (let intensity = 0; intensity < 256; intensity++) {
            const normalized = intensity / 255;
            let lower = colorStops[0];
            let upper = colorStops[colorStops.length - 1];
            for (let index = 0; index < colorStops.length - 1; index++) {
                if (normalized >= colorStops[index].pos &&
                    normalized <= colorStops[index + 1].pos) {
                    lower = colorStops[index];
                    upper = colorStops[index + 1];
                    break;
                }
            }
            const range = upper.pos - lower.pos;
            const position = range === 0 ? 0 : (normalized - lower.pos) / range;
            const offset = intensity * 3;
            lut[offset] = Math.round(
                (lower.r + (upper.r - lower.r) * position) * brightness
            );
            lut[offset + 1] = Math.round(
                (lower.g + (upper.g - lower.g) * position) * brightness
            );
            lut[offset + 2] = Math.round(
                (lower.b + (upper.b - lower.b) * position) * brightness
            );
        }
        return lut;
    }

    paintDspSpectrogramColumn(column, intensities) {
        if (!this.imageDataCache || !this.spectrogramColorLut) return;
        const pixels = this.imageDataCache.data;
        for (let row = 0; row < SPECTROGRAM_CELL_COUNT; row++) {
            const colorOffset = intensities[row] * 3;
            const pixelOffset =
                (row * SPECTROGRAM_HISTORY_WIDTH + column) * 4;
            pixels[pixelOffset] = this.spectrogramColorLut[colorOffset];
            pixels[pixelOffset + 1] = this.spectrogramColorLut[colorOffset + 1];
            pixels[pixelOffset + 2] = this.spectrogramColorLut[colorOffset + 2];
            pixels[pixelOffset + 3] = 255;
        }
        this.tempCtx?.putImageData(
            this.imageDataCache,
            0,
            0,
            column,
            0,
            1,
            SPECTROGRAM_CELL_COUNT
        );
    }

    paintDspSpectrogramImage() {
        if (!this.imageDataCache || !this.spectrogramIntensityBuffer ||
            !this.spectrogramColorLut) {
            return;
        }
        const pixels = this.imageDataCache.data;
        for (let row = 0; row < SPECTROGRAM_CELL_COUNT; row++) {
            for (let column = 0; column < SPECTROGRAM_HISTORY_WIDTH; column++) {
                const sourceOffset = row * SPECTROGRAM_HISTORY_WIDTH + column;
                const colorOffset = this.spectrogramIntensityBuffer[sourceOffset] * 3;
                const pixelOffset = sourceOffset * 4;
                pixels[pixelOffset] = this.spectrogramColorLut[colorOffset];
                pixels[pixelOffset + 1] = this.spectrogramColorLut[colorOffset + 1];
                pixels[pixelOffset + 2] = this.spectrogramColorLut[colorOffset + 2];
                pixels[pixelOffset + 3] = 255;
            }
        }
    }


    dbToColor(db) {
        if (db > 0) db = 0; // Clamp db
        const normalizedValue = (db - this.dr) / (-this.dr); // this.dr is negative
        const clampedValue = Math.max(0, Math.min(1, normalizedValue));
        
        const colorStops = [
            { pos: 0.000, r: 0,   g: 0,   b: 0 },
            { pos: 0.166, r: 0,   g: 0,   b: 255 },
            { pos: 0.333, r: 0,   g: 255, b: 255 },
            { pos: 0.500, r: 0,   g: 255, b: 0 },
            { pos: 0.666, r: 255, g: 255, b: 0 },
            { pos: 0.833, r: 255, g: 0,   b: 0 },
            { pos: 1.000, r: 255, g: 255, b: 255 }
        ];
        let lower = colorStops[0], upper = colorStops[colorStops.length - 1];
        for (let i = 0; i < colorStops.length - 1; i++) {
            if (clampedValue >= colorStops[i].pos && clampedValue <= colorStops[i + 1].pos) {
                lower = colorStops[i]; upper = colorStops[i + 1]; break;
            }
        }
        const range = upper.pos - lower.pos;
        const normalizedPos = range === 0 ? 0 : (clampedValue - lower.pos) / range;
        const brightness = 0.75; // As in original
        const r = Math.round((lower.r + (upper.r - lower.r) * normalizedPos) * brightness);
        const g = Math.round((lower.g + (upper.g - lower.g) * normalizedPos) * brightness);
        const b = Math.round((lower.b + (upper.b - lower.b) * normalizedPos) * brightness);
        return [r, g, b];
    }

    drawGraph() {
        if (!this.canvasCtx || !this.imageDataCache || !this.tempCtx || !this.tempCanvas) return;

        const ctx = this.canvasCtx;
        const targetWidth = this.canvas.width;  // Display canvas width
        const targetHeight = this.canvas.height; // Display canvas height
        const dpr = this.graphDpr || 1;
        const isNarrow = this.graphCssWidth < 500;
        
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, targetWidth, targetHeight);
        
        if (this.dspSpectrogramActive) {
            const split = this.spectrogramWriteColumn;
            const firstWidth = SPECTROGRAM_HISTORY_WIDTH - split;
            const firstTargetWidth = targetWidth * firstWidth / SPECTROGRAM_HISTORY_WIDTH;
            if (firstWidth > 0) {
                ctx.drawImage(
                    this.tempCanvas,
                    split,
                    0,
                    firstWidth,
                    SPECTROGRAM_CELL_COUNT,
                    0,
                    0,
                    firstTargetWidth,
                    targetHeight
                );
            }
            if (split > 0) {
                ctx.drawImage(
                    this.tempCanvas,
                    0,
                    0,
                    split,
                    SPECTROGRAM_CELL_COUNT,
                    firstTargetWidth,
                    0,
                    targetWidth - firstTargetWidth,
                    targetHeight
                );
            }
        } else {
            this.tempCtx.putImageData(this.imageDataCache, 0, 0);
            ctx.drawImage(
                this.tempCanvas,
                0,
                0,
                this.tempCanvas.width,
                this.tempCanvas.height,
                0,
                0,
                targetWidth,
                targetHeight
            );
        }

        ctx.strokeStyle = '#888';
        ctx.lineWidth = dpr; // Thinner than spectrum analyzer grid for less prominence

        // --- Dynamic Frequency Grid for Spectrogram Y-Axis ---
        const minDisplayFreq = 20;
        const nyquistFreq = this.sampleRate / 2;
        const maxDisplayFreq = 40000; // Fixed max display frequency

        if (this.sampleRate > 0 && nyquistFreq > minDisplayFreq) {
            // Base frequencies for labels, filter/adjust based on dynamic range
            let baseGridFreqs = isNarrow
                ? [20, 100, 1000, 10000, 20000]
                : [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
            let gridFreqsToDraw = baseGridFreqs.filter(f => f >= minDisplayFreq && f <= maxDisplayFreq);
            // Ensure min/max are candidates if not present, then sort.
            if (!gridFreqsToDraw.includes(minDisplayFreq) && minDisplayFreq > 0) gridFreqsToDraw.push(minDisplayFreq);
            if (!gridFreqsToDraw.includes(maxDisplayFreq)) gridFreqsToDraw.push(maxDisplayFreq);
            gridFreqsToDraw = [...new Set(gridFreqsToDraw)].sort((a,b) => a-b);

            ctx.fillStyle = '#ccc';
            ctx.font = `${(isNarrow ? 11 : 12) * dpr}px Arial`; // Consistent font size
            ctx.textAlign = 'right';

            gridFreqsToDraw.forEach(freq => {
                // freqToY gives pixel row 0-255. Scale this to targetHeight for drawing.
                // Note: freqToY maps low freq to high Y (bottom), high freq to low Y (top).
                const yPixelRow = this.freqToY(freq); 
                const yDrawPos = (yPixelRow / 255) * targetHeight;

                // Draw grid line
                ctx.beginPath();
                ctx.moveTo(0, yDrawPos);
                ctx.lineTo(targetWidth, yDrawPos); // Full width grid line
                ctx.stroke();
                
                // Draw label, avoid edges
                if (yDrawPos > 15 * dpr && yDrawPos < targetHeight - 15 * dpr) {
                     ctx.fillText(freq >= 1000 ? `${Math.round(freq / 100)/10}k` : freq.toString(), (isNarrow ? 46 : 80) * dpr, yDrawPos + (6 * dpr)); // Adjust offset
                }
            });
        }

        // Draw 1-second markers
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 2 * dpr;
        for (const idx of this.secondMarkers) {
            const x = targetWidth * idx / 1024;
            ctx.beginPath();
            ctx.moveTo(x, targetHeight - (16 * dpr));
            ctx.lineTo(x, targetHeight);
            ctx.stroke();
        }

        // Draw axis labels
        ctx.fillStyle = '#fff'; ctx.font = `${(isNarrow ? 13 : 14) * dpr}px Arial`; ctx.textAlign = 'center';
        ctx.fillText('Time', targetWidth / 2, targetHeight - (8 * dpr));
        ctx.save();
        ctx.translate((isNarrow ? 18 : 20) * dpr, targetHeight / 2); ctx.rotate(-Math.PI / 2);
        ctx.fillText('Frequency (Hz)', 0, 0);
        ctx.restore();
    }
}

if (typeof window !== 'undefined' && typeof PluginBase !== 'undefined') {
    window.SpectrogramPlugin = SpectrogramPlugin;
}
