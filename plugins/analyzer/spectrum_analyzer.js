const SPECTRUM_TAP_FRAME = 4;
const SPECTRUM_TELEMETRY_VERSION = 1;
// f32 sampleRate, u32 binCount, u16 points, u16 flags, then current[] and peaks[].
const SPECTRUM_PAYLOAD_HEADER_BYTES = 12;
// v1 bit 0 is required at pt=14, where the top three bins are omitted.
const SPECTRUM_FLAG_BINS_TRUNCATED = 1;
const SPECTRUM_MAX_POINTS = 14;
const SPECTRUM_MAX_POINT_BIN_COUNT = 8190;
const SPECTRUM_MIN_DISPLAY_FREQ = 20;
const SPECTRUM_MAX_DISPLAY_FREQ = 40000;
const SPECTRUM_WIDE_BAR_COUNT = 48;
const SPECTRUM_NARROW_BAR_COUNT = 24;
const SPECTRUM_DISPLAY_FREQ_RANGE =
    SPECTRUM_MAX_DISPLAY_FREQ - SPECTRUM_MIN_DISPLAY_FREQ;
const SPECTRUM_LOG_MIN_DISPLAY_FREQ = Math.log10(SPECTRUM_MIN_DISPLAY_FREQ);
const SPECTRUM_LOG_DISPLAY_FREQ_RANGE =
    Math.log10(SPECTRUM_MAX_DISPLAY_FREQ) - SPECTRUM_LOG_MIN_DISPLAY_FREQ;

class SpectrumAnalyzerPlugin extends PluginBase {
    constructor() {
        super('Spectrum Analyzer', 'Real-time spectrum analyzer with peak hold');
        this.initializeDisplayState();
        this.registerProcessor(SpectrumAnalyzerPlugin.processorFunction);
    }

    initializeDisplayState() {
        // Initialize parameters
        this.dr = -96;
        this.pt = 12;
        this.sc = 'log';
        this.hqGeneration = -1;
        this.hqFrameIndex = -1;
        this.hqReceiver = null;
        this.kb = false;
        this.dm = 'line';
        this.cl = 'Normal';
        this.colorGradient = null;
        const fftSize = 1 << this.pt; // Using bit shift for power of 2
        this.spectrum = new Float32Array(fftSize >> 1).fill(-144);
        this.peaks = new Float32Array(fftSize >> 1).fill(-144);
        this.lastProcessTime = performance.now() / 1000;
        this.sampleRate = 48000; // Default, updated from processor messages
        this.spectrumPoints = this.pt;
        this.spectrumFlags = 0;
        this.dspSpectrumSnapshot = null;
        this.peakReceivedAt = null;
        this.peakDecayFrozenElapsed = 0;
        this.peakDecayPaused = false;
        this._dspTelemetryHub = null;
        this._dspTelemetryTapId = null;
        this._dspTelemetryUnsubscribe = null;
        this._boundDspSpectrumTelemetry = (frame, producer) => this.handleDspSpectrumTelemetry(frame, producer);

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

        this.observer = null;
        this.resizeGraphDisposer = null;
        this.graphDpr = 1;
        this.graphCssWidth = 1024;
    }

    static processorFunction = `
        if (parameters.hq === true || parameters.sc === 'log-hq') {
            const analyzer = context.multiresSpectrum;
            if (!analyzer) throw new Error('Spectrum analysis must be prepared before processing');
            const frame = analyzer.process(data, parameters);
            data.measurements = frame ? frame.measurements : null;
            context.multiresFrame = frame;
            return data;
        }
        if (context.multiresSpectrum) {
            const frame = context.multiresSpectrum.captureLegacy(data, parameters, time);
            data.measurements = frame ? frame.measurements : null;
            context.multiresFrame = frame;
            return data;
        }
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
        if (this.sc === 'log-hq') this.resetHqDisplay();
        const fftSize = 1 << newPoints;
        
        this.spectrum = new Float32Array(fftSize >> 1).fill(-144);
        this.peaks = new Float32Array(fftSize >> 1).fill(-144);
        this.real = new Float32Array(fftSize);
        this.imag = new Float32Array(fftSize);
        this.window = new Float32Array(fftSize);
        this.sinTable = new Float32Array(fftSize);
        this.cosTable = new Float32Array(fftSize);
        this.spectrumPoints = newPoints;
        this.spectrumFlags = 0;
        this.dspSpectrumSnapshot = null;
        this.peakReceivedAt = null;
        this.peakDecayFrozenElapsed = 0;

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

    setKeyboardVisible(value) {
        const visible = value === true;
        if (visible === this.kb) return;
        this.kb = visible;
        this.updateParameters();
        this._graphReadout?.clear();
        this.drawGraph();
    }

    setFrequencyScale(value) {
        const scale = value === 'linear' || value === 'log-hq' ? value : 'log';
        if (scale === this.sc) return;
        if (scale === 'log-hq' || this.sc === 'log-hq') this.resetHqDisplay();
        this.sc = scale;
        this.updateParameters();
        this._graphReadout?.clear();
        this.drawGraph();
    }

    resetHqDisplay() {
        // Retain the received watermark: parameter changes can coalesce while audio is paused.
        this.hqFrameIndex = -1;
        this.spectrum = new Float32Array(1 << (this.pt - 1)).fill(-240);
        this.peaks = new Float32Array(1 << (this.pt - 1)).fill(-240);
        this.dspSpectrumSnapshot = null;
        this.peakReceivedAt = null;
    }

    setDisplayMode(value) {
        const mode = value === 'bar' ? 'bar' : 'line';
        if (mode === this.dm) return;
        this.dm = mode;
        this.updateParameters();
        this._graphReadout?.clear();
        this.drawGraph();
    }

    setColor(value) {
        if (!['Normal', 'Heatmap', 'Rainbow'].includes(value) || value === this.cl) return;
        this.cl = value;
        this.colorGradient = null;
        this.updateParameters();
        this.drawGraph();
    }

    frequencyToX(freq, width) {
        if (this.sc === 'linear') {
            return width * (freq - SPECTRUM_MIN_DISPLAY_FREQ) / SPECTRUM_DISPLAY_FREQ_RANGE;
        }
        return width * (Math.log10(freq) - SPECTRUM_LOG_MIN_DISPLAY_FREQ) /
            SPECTRUM_LOG_DISPLAY_FREQ_RANGE;
    }

    displayXToFrequency(position) {
        return this.sc === 'linear'
            ? SPECTRUM_MIN_DISPLAY_FREQ + position * SPECTRUM_DISPLAY_FREQ_RANGE
            : 10 ** (SPECTRUM_LOG_MIN_DISPLAY_FREQ + position * SPECTRUM_LOG_DISPLAY_FREQ_RANGE);
    }

    // Reset parameters
    reset() {
        this.setDBRange(-96);
        this.setPoints(12); // Note: constructor uses 12, reset button might use 10. Keeping 12 here.
        this.setFrequencyScale('log');
        this.setKeyboardVisible(false);
        this.setDisplayMode('line');
        this.setColor('Normal');
    }

    getParameters() {
        this.ensureDspTelemetrySubscription();
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            dr: this.dr,
            pt: this.pt,
            kb: this.kb,
            sc: this.sc,
            hq: this.sc === 'log-hq',
            dm: this.dm,
            cl: this.cl
        };
    }

    setParameters(params) {
        if (params.enabled !== undefined) this.enabled = params.enabled;
        if (params.dr !== undefined) this.setDBRange(params.dr);
        if (params.pt !== undefined) this.setPoints(params.pt);
        if (params.kb !== undefined) this.setKeyboardVisible(params.kb);
        if (params.sc !== undefined) this.setFrequencyScale(params.sc);
        else if (params.hq === true) this.setFrequencyScale('log-hq');
        else if (params.hq === false && this.sc === 'log-hq') this.setFrequencyScale('log');
        if (params.dm !== undefined) this.setDisplayMode(params.dm);
        if (params.cl !== undefined) this.setColor(params.cl);
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
                SPECTRUM_TAP_FRAME,
                this._boundDspSpectrumTelemetry
            );
            if (typeof unsubscribe !== 'function') {
                hub.unsubscribe?.(tapId, SPECTRUM_TAP_FRAME, this._boundDspSpectrumTelemetry);
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

    parseDspSpectrumTelemetryFrame(frame) {
        if (frame?.formatVersion === 2) return globalThis.MultiresSpectrum?.decode(frame, SPECTRUM_TAP_FRAME) ?? null;
        if (frame?.frameType !== SPECTRUM_TAP_FRAME ||
            frame.formatVersion !== SPECTRUM_TELEMETRY_VERSION) {
            return null;
        }
        const payload = frame.payload;
        if (!payload || typeof payload.getUint16 !== 'function' ||
            typeof payload.getUint32 !== 'function' ||
            typeof payload.getFloat32 !== 'function' ||
            !Number.isInteger(payload.byteLength) ||
            payload.byteLength < SPECTRUM_PAYLOAD_HEADER_BYTES + 16) {
            return null;
        }

        const sampleRate = payload.getFloat32(0, true);
        const binCount = payload.getUint32(4, true);
        const points = payload.getUint16(8, true);
        const flags = payload.getUint16(10, true);
        if (!Number.isFinite(sampleRate) || sampleRate <= 0 ||
            points < 8 || points > SPECTRUM_MAX_POINTS ||
            (flags & ~SPECTRUM_FLAG_BINS_TRUNCATED) !== 0) {
            return null;
        }

        const fullBinCount = (1 << (points - 1)) + 1;
        const binsTruncated = (flags & SPECTRUM_FLAG_BINS_TRUNCATED) !== 0;
        if (points === SPECTRUM_MAX_POINTS) {
            if (!binsTruncated || binCount !== SPECTRUM_MAX_POINT_BIN_COUNT ||
                fullBinCount - binCount !== 3) {
                return null;
            }
        } else if (binsTruncated || binCount !== fullBinCount) {
            return null;
        }
        if (payload.byteLength !== SPECTRUM_PAYLOAD_HEADER_BYTES + binCount * 8) {
            return null;
        }

        const current = new Float32Array(binCount);
        const peaks = new Float32Array(binCount);
        const peakOffset = SPECTRUM_PAYLOAD_HEADER_BYTES + binCount * 4;
        for (let bin = 0; bin < binCount; bin++) {
            const currentLevel = payload.getFloat32(
                SPECTRUM_PAYLOAD_HEADER_BYTES + bin * 4,
                true
            );
            const peakLevel = payload.getFloat32(peakOffset + bin * 4, true);
            if (!Number.isFinite(currentLevel) || !Number.isFinite(peakLevel) ||
                peakLevel < -145 || peakLevel > 0) {
                return null;
            }
            current[bin] = currentLevel;
            peaks[bin] = peakLevel;
        }
        return { sampleRate, binCount, points, flags, binsTruncated, current, peaks };
    }

    handleDspSpectrumTelemetry(frame, producer = this._dspTelemetryHub?.port ?? null) {
        const snapshot = this.parseDspSpectrumTelemetryFrame(frame);
        if (!snapshot || !this.enabled || !this._sectionEnabled) return;
        if (snapshot.highQuality) {
            if (this.sc !== 'log-hq' || snapshot.points !== this.pt ||
                producer !== (this._dspTelemetryHub?.port ?? null)) return;
            this.hqReceiver ??= new globalThis.MultiresSpectrum.FrameReceiver();
            if (!this.hqReceiver.accept(snapshot, frame.source ?? producer)) return;
            this.hqGeneration = snapshot.generation;
            this.hqFrameIndex = snapshot.frameIndex;
        } else if (this.sc === 'log-hq') return;
        this.sampleRate = snapshot.sampleRate;
        this.spectrum = snapshot.current;
        this.peaks = snapshot.peaks;
        this.spectrumPoints = snapshot.points;
        this.spectrumFlags = snapshot.flags;
        this.dspSpectrumSnapshot = snapshot;
        this.peakReceivedAt = performance.now() / 1000;
        this.peakDecayFrozenElapsed = 0;
    }

    onMessage(message) {
        this.ensureDspTelemetrySubscription();
        if (message.type === 'processBuffer') {
            this.process(message);
        }
    }

    process(message) {
        if (message?.measurements?.hqFrame) {
            this.handleDspSpectrumTelemetry(message.measurements.hqFrame);
            return;
        }
        if (this.sc === 'log-hq') return;
        if (!message?.measurements?.buffer) {
            return;
        }

        if (!this.enabled || !this._sectionEnabled) {
            return;
        }

        this.dspSpectrumSnapshot = null;
        this.spectrumPoints = this.pt;
        this.spectrumFlags = 0;

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
        this.peakReceivedAt = performance.now() / 1000;
        this.peakDecayFrozenElapsed = 0;
        return;
    }

    createUI() {
        this.ensureDspTelemetrySubscription();
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
            'DB Range', -144, -48, 1, this.dr, (v) => this.setDBRange(v), 'dB', 'dr'
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
        const pointsValueHandler = (e) => {
            const numFFTPoints = parseInt(e.target.value);
            const exponent = Math.round(Math.log2(numFFTPoints)); // Allow nearest power of 2
            if (exponent >= 8 && exponent <= 14) {
                pointsSlider.value = exponent;
                pointsValue.value = 1 << exponent; // Ensure value is a power of 2
                this.setPoints(exponent);
            } else {
                 pointsValue.value = 1 << this.pt; // Revert to current if invalid
            }
        };
        pointsValue.addEventListener('change', pointsValueHandler);
        this.boundEventListeners.set(pointsValue, pointsValueHandler);


        pointsRow.appendChild(pointsLabel);
        pointsRow.appendChild(pointsSlider);
        pointsRow.appendChild(pointsValue);
        container.appendChild(pointsRow);

        const frequencyScaleRow = this.createRadioGroup(
            'Frequency Scale',
            [
                { value: 'log', label: 'Log' },
                { value: 'log-hq', label: 'Log (HQ)' },
                { value: 'linear', label: 'Linear' }
            ],
            this.sc,
            value => this.setFrequencyScale(value), 'sc'
        );
        container.appendChild(frequencyScaleRow);

        const displayModeRow = this.createRadioGroup(
            'Display',
            [
                { value: 'line', label: 'Line' },
                { value: 'bar', label: 'Bar' }
            ],
            this.dm,
            value => this.setDisplayMode(value), 'dm'
        );
        container.appendChild(displayModeRow);
        container.appendChild(this.createRadioGroup(
            'Color',
            [
                { value: 'Normal', label: 'Normal' },
                { value: 'Heatmap', label: 'Heatmap' },
                { value: 'Rainbow', label: 'Note Colors' }
            ],
            this.cl,
            value => this.setColor(value), 'cl'
        ));
        container.appendChild(this.createCheckboxControl(
            'Keyboard', this.kb, value => this.setKeyboardVisible(value), 'kb'
        ));

        const { container: graphContainer, canvas, dispose } = this.createResponsiveGraph({
            maxWidth: 1024,
            aspectRatio: '32 / 15',
            mobileAspectRatio: '4 / 3',
            onResize: ({ canvas, cssWidth, dpr }) => {
                this.canvas = canvas;
                this.graphCssWidth = cssWidth;
                this.graphDpr = dpr;
                this.drawGraph();
            }
        });
        this.canvas = canvas;
        this.resizeGraphDisposer = dispose;

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
            const logScaleRadio = frequencyScaleRow.querySelector('input[value="log"]');
            if (logScaleRadio) logScaleRadio.checked = true;
            const lineDisplayRadio = displayModeRow.querySelector('input[value="line"]');
            if (lineDisplayRadio) lineDisplayRadio.checked = true;
            const normalColorRadio = container.querySelector('input[value="Normal"]');
            if (normalColorRadio) normalColorRadio.checked = true;

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

        // Automation playback and preset recall change the model without touching the
        // DOM, so the Points controls this plugin builds by hand are refreshed here.
        // The pair is left alone while the user holds it, matching how syncUIControls()
        // treats the helper-built controls.
        this.registerUIRefresh(() => {
            if (this.isHeldByUser(pointsSlider) || this.isHeldByUser(pointsValue)) return;
            pointsSlider.value = this.pt;
            window.uiManager?.refreshRangeFillStyling?.(pointsSlider);
            pointsValue.value = 1 << this.pt;
        });

        this._graphReadout = window.GraphReadout?.attach({
            mount: graphContainer,
            surface: this.canvas,
            // The spectrum area, or the keyboard gutter while the pointer is over it.
            plot: point => {
                const frame = this._readoutFrame;
                if (!frame?.valid) return null;
                const onKeys = point.y > frame.plotHeight;
                return {
                    left: 0,
                    top: onKeys ? frame.plotHeight : 0,
                    width: frame.width,
                    height: onKeys ? frame.gutter : frame.plotHeight
                };
            },
            read: (x, y) => this._readSpectrum(x, y),
            crosshair: 'x'
        });
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
        if (!this.enabled || !this._sectionEnabled) return; // Skip if disabled or section is off.
        const startTime = performance.now();
        if (this.peakDecayPaused) {
            this.peakReceivedAt = startTime / 1000 - this.peakDecayFrozenElapsed;
            this.peakDecayPaused = false;
        }
        const animate = (now) => {
            if (!this.isVisible) {
                this.stopAnimation();
                return;
            }
            this.drawGraph(now);
            this.animationFrameId = this.requestPowerAnimationFrame(animate, 'analyzer');
        };
        animate(performance.now());
    }

    stopAnimation(now = performance.now()) {
        if (!this.peakDecayPaused) {
            this.peakDecayFrozenElapsed = this.getPeakDecayElapsed(now);
        }
        this.peakDecayPaused = true;
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    cleanup() {
        this.disposeDspTelemetrySubscription();
        this.stopAnimation(); // Stop animation first
        if (this.observer && this.canvas) { // Check if canvas exists before trying to unobserve
            this.observer.unobserve(this.canvas);
        }
        // Cleanup event listeners
        this.boundEventListeners.forEach((handler, element) => {
            // Determine event type if not stored (assuming 'input' or 'click' primarily)
            // A more robust way is to store {event: 'input', handler: handler}
            element.removeEventListener('input', handler); 
            element.removeEventListener('change', handler);
            element.removeEventListener('click', handler); 
        });
        this.boundEventListeners.clear();
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.resizeGraphDisposer) {
            this.resizeGraphDisposer();
            this.resizeGraphDisposer = null;
        }
        this.canvas = null;
        this.dspSpectrumSnapshot = null;
        this.peakReceivedAt = null;
        this.peakDecayFrozenElapsed = 0;
        this.peakDecayPaused = false;
        this.lastProcessTime = performance.now() / 1000;
        super.cleanup();
    }

    getPeakDecayElapsed(now = performance.now()) {
        if (this.peakDecayPaused) return this.peakDecayFrozenElapsed;
        if (this.peakReceivedAt === null) return 0;

        const fftSize = 1 << this.spectrumPoints;
        const analysisIntervalFrames = Math.max(
            Math.ceil(this.sampleRate / 30),
            fftSize / 2
        );
        const elapsed = Math.max(0, now / 1000 - this.peakReceivedAt);
        return Math.min(elapsed, analysisIntervalFrames / this.sampleRate);
    }

    getKeyboardGeometry(length) {
        const minMidi = 69 + 12 * Math.log2(SPECTRUM_MIN_DISPLAY_FREQ / 440);
        const maxMidi = 69 + 12 * Math.log2(SPECTRUM_MAX_DISPLAY_FREQ / 440);
        const blackClasses = [1, 3, 6, 8, 10];
        const isBlack = midi => blackClasses.includes((midi % 12 + 12) % 12);
        const position = midi => {
            const frequency = 440 * 2 ** ((midi - 69) / 12);
            return Math.max(0, Math.min(length, this.frequencyToX(frequency, length)));
        };
        const keys = [];
        for (let midi = Math.ceil(minMidi - 0.5); midi <= Math.floor(maxMidi + 0.5); midi++) {
            const black = isBlack(midi);
            const lower = position(midi - 0.5);
            const upper = position(midi + 0.5);
            const previousWhite = midi - (isBlack(midi - 1) ? 2 : 1);
            const nextWhite = midi + (isBlack(midi + 1) ? 2 : 1);
            const whiteLower = position((previousWhite + midi) / 2);
            const whiteUpper = position((midi + nextWhite) / 2);
            keys.push({
                midi, black, center: position(midi),
                start: Math.min(lower, upper), end: Math.max(lower, upper),
                whiteStart: Math.min(whiteLower, whiteUpper),
                whiteEnd: Math.max(whiteLower, whiteUpper)
            });
        }
        return keys;
    }

    drawKeyboard(ctx, width, height, gutter, blackDepth, dpr) {
        const background = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-bg-deep') ?? '')
            .match(/[\d.]+/g)?.slice(0, 3).map(Number);
        if (!background || background.length !== 3) return;
        const light = background.every(channel => channel > 127);
        const white = light ? 255 : 238;
        const black = 17;
        const keys = this.getKeyboardGeometry(width);
        const edge = height - gutter;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, edge, width, gutter);
        ctx.clip();
        // A continuous white base keeps subpixel keys aligned without gaps.
        ctx.fillStyle = 'rgb(' + white + ', ' + white + ', ' + white + ')'; // theme-allow: Theme-dependent keyboard color.
        ctx.fillRect(0, edge, width, gutter);
        ctx.strokeStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-label') ?? '');
        ctx.lineWidth = dpr;
        for (const key of keys) {
            if (key.black || key.whiteStart <= 0 || key.whiteStart >= width) continue;
            ctx.beginPath();
            ctx.moveTo(key.whiteStart, edge);
            ctx.lineTo(key.whiteStart, height);
            ctx.stroke();
        }
        const blackKeys = keys.filter(key => key.black);
        window.FrequencyAxis.shadeKeyboard(ctx, { along: 'x', edge, length: width, gutter, blackDepth, dpr },
            blackKeys.map(key => [key.start, key.end]), () => {
                ctx.fillStyle = 'rgb(' + black + ', ' + black + ', ' + black + ')'; // theme-allow: Fixed self-painted black key color.
                for (const key of blackKeys) ctx.fillRect(key.start, edge, key.end - key.start, blackDepth);
            });
        ctx.beginPath();
        ctx.moveTo(0, edge);
        ctx.lineTo(width, edge);
        ctx.stroke();
        ctx.fillStyle = '#111'; // theme-allow: Text on the self-painted white keys.
        ctx.font = (7 * dpr) + 'px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let lastLabelRight = -Infinity;
        for (const key of keys) {
            if (key.midi % 12 !== 0) continue;
            const label = 'C' + (key.midi / 12 - 1);
            const center = (key.whiteStart + key.whiteEnd) / 2;
            const labelWidth = ctx.measureText(label).width;
            const halfExtent = labelWidth / 2;
            const fitsWhiteKey = center - halfExtent >= key.whiteStart + dpr &&
                center + halfExtent <= key.whiteEnd - dpr;
            if ((this.displayOptions?.textContext
                ? center - halfExtent < lastLabelRight + dpr : !fitsWhiteKey) ||
                center - halfExtent < dpr || center + halfExtent > width - dpr) continue;
            (this.displayOptions?.textContext ?? ctx).fillText(label, center, edge + blackDepth + (gutter - blackDepth) / 2);
            lastLabelRight = center + halfExtent;
        }
        ctx.restore();
    }

    drawGraph(now = performance.now()) {
        if (this.displayOptions?.deferDraw) return;
        const frame = (this._readoutFrame ??= {});
        frame.valid = false;
        if (!this.canvas) {
            this._graphReadout?.refresh();
            return;
        }

        const ctx = this.canvas.getContext('2d', { alpha: false });
        const width = this.canvas.width;
        const height = this.canvas.height;
        const dpr = this.graphDpr || 1;
        const vertical = this.displayOptions?.orientation === 'vertical';
        const graphWidth = vertical ? height : width;
        const graphHeight = vertical ? width : height;
        const isNarrow = (vertical ? graphWidth / dpr : this.graphCssWidth) < 500;
        // Keys keep piano proportions at the log-axis semitone width, also on the linear axis.
        const { gutter: keyboardGutter, blackDepth } = this.kb ? window.FrequencyAxis.keyboardDepths(
            graphWidth / Math.log2(SPECTRUM_MAX_DISPLAY_FREQ / SPECTRUM_MIN_DISPLAY_FREQ), graphHeight,
            this.displayOptions?.keyboardLength
        ) : { gutter: 0, blackDepth: 0 };
        const plotHeight = graphHeight - keyboardGutter;

        ctx.fillStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-bg-deep') ?? '');
        if (this.displayOptions?.transparent) ctx.clearRect(0, 0, width, height);
        else ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-grid-subtle') ?? '');
        ctx.lineWidth = dpr;

        // --- Dynamic Frequency Axis Scaling ---
        const minDisplayFreq = SPECTRUM_MIN_DISPLAY_FREQ;
        const nyquistFreq = this.sampleRate / 2;
        // Max display frequency is Nyquist, but ensure it's at least minDisplayFreq
        const maxDisplayFreq = SPECTRUM_MAX_DISPLAY_FREQ;

        if (this.sampleRate <= 0 || nyquistFreq <= minDisplayFreq) { // Not enough range or invalid sampleRate
            ctx.fillStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('text-primary') ?? '');
            ctx.font = `${14 * dpr}px Arial`;
            ctx.textAlign = 'center';
            (this.displayOptions?.textContext ?? ctx).fillText('Invalid Sample Rate or Range', width / 2, height / 2);
            this._graphReadout?.refresh();
            return;
        }

        if (maxDisplayFreq <= minDisplayFreq) {
             ctx.fillStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('text-primary') ?? ''); ctx.font = `${14 * dpr}px Arial`; ctx.textAlign = 'center';
             (this.displayOptions?.textContext ?? ctx).fillText('Invalid Frequency Range', width / 2, height / 2);
             this._graphReadout?.refresh();
             return;
        }

        if (vertical) {
            ctx.save();
            ctx.translate(width, height);
            ctx.transform(0, -1, -1, 0, 0, 0);
        }
        if (keyboardGutter) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(0, 0, graphWidth, plotHeight);
            ctx.clip();
        }
        const drawBars = this.dm === 'bar';
        Object.assign(frame, { valid: true, width: graphWidth, plotHeight, gutter: keyboardGutter, blackDepth, bands: null });
        const deferredTicks = this.drawGrid(
            ctx, graphWidth, plotHeight, dpr, isNarrow, drawBars, Boolean(keyboardGutter)
        );
        if (drawBars) {
            const levels = this.collectSpectrumLevels(graphWidth, now);
            const bandCount = isNarrow ? SPECTRUM_NARROW_BAR_COUNT : SPECTRUM_WIDE_BAR_COUNT;
            const bands = SpectrumAnalyzerPlugin.aggregateBands(levels, graphWidth, bandCount);
            frame.bands = bands;
            const draw = target => this.drawSpectrumBars(target, bands, graphWidth, plotHeight, dpr);
            if (this.displayOptions?.drawSignal) this.displayOptions.drawSignal(ctx, draw, { width: graphWidth, height: plotHeight });
            else draw(ctx);
            this.drawAxisLabels(ctx, graphWidth, plotHeight, dpr, isNarrow, deferredTicks, !keyboardGutter);
        } else {
            this.drawAxisLabels(ctx, graphWidth, plotHeight, dpr, isNarrow, deferredTicks, !keyboardGutter);
            const levels = this.collectSpectrumLevels(graphWidth, now);
            const line = frame.line = { xs: [], spectrum: [], peaks: [] };
            for (const [x, [spectrumLevel, peakLevel]] of levels) {
                line.xs.push(x);
                line.spectrum.push(spectrumLevel);
                line.peaks.push(peakLevel);
            }
            const draw = target => this.drawSpectrumLines(target, levels, graphWidth, plotHeight, dpr);
            if (this.displayOptions?.drawSignal) this.displayOptions.drawSignal(ctx, draw, { width: graphWidth, height: plotHeight });
            else draw(ctx);
        }
        if (keyboardGutter) {
            ctx.restore();
            this.drawKeyboard(ctx, graphWidth, graphHeight, keyboardGutter, blackDepth, dpr);
        }
        if (vertical) ctx.restore();
        this._graphReadout?.refresh();
    }

    // Color drawn at canvas (x, y) for the Heatmap/Rainbow styles; otherwise the given theme color.
    _readoutColor(x, y, fallback) {
        const { width, plotHeight } = this._readoutFrame;
        if (this.cl === 'Rainbow') {
            const color = window.NoteSpectrogramPlugin?.noteColor?.(
                69 + 12 * Math.log2(this.displayXToFrequency(x / width) / 440));
            if (color) return `rgb(${color.map(Math.round).join(',')})`; // theme-allow: Shared Note Spectrogram note colormap.
        } else if (this.cl === 'Heatmap') {
            const lut = window.SpectrogramPlugin?.getHeatmapLuts().rgba;
            const ratio = 1 - y / plotHeight;
            const offset = Math.round((ratio < 0 ? 0 : ratio > 1 ? 1 : ratio) * 255) * 4;
            if (lut) return `rgb(${lut[offset]},${lut[offset + 1]},${lut[offset + 2]})`; // theme-allow: Shared Spectrogram heatmap colormap.
        }
        return fallback;
    }

    // Spectrum and peak-hold levels drawn at canvas x (line: between points, bar: the band under x).
    _readSpectrum(x, y) {
        const frame = this._readoutFrame;
        const { format, seriesValueAt } = window.GraphReadout;
        const { width, plotHeight, bands, line } = frame;
        if (y > plotHeight) {
            const key = window.FrequencyAxis?.hitKey(this.getKeyboardGeometry(width), x, y - plotHeight,
                frame.gutter, frame.blackDepth);
            return key ? { cursor: format.note(440 * 2 ** ((key.midi - 69) / 12)), rows: [], crosshair: 'none' } : null;
        }
        let at = x;
        let levels = [NaN, NaN];
        if (bands) {
            const count = bands.spectrum.length;
            const index = Math.floor(x * count / width);
            const band = index > count - 1 ? count - 1 : index;
            at = (band + 0.5) * width / count;
            if (band >= bands.firstFilled && band <= bands.lastFilled) {
                levels = [bands.spectrum[band], bands.peaks[band]];
            }
        } else if (line) {
            levels = [seriesValueAt(line.xs, line.spectrum, x) ?? NaN, seriesValueAt(line.xs, line.peaks, x) ?? NaN];
        }
        const rowFor = (label, level, token) => {
            const levelY = plotHeight * (level / this.dr);
            return { label, color: this._readoutColor(at, levelY, token), value: format.db(level), y: levelY };
        };
        return {
            cursor: format.frequency(this.displayXToFrequency(at / width)),
            rows: [
                rowFor('Spectrum', levels[0], 'var(--et-graph-trace-fill)'),
                rowFor('Peak hold', levels[1], 'var(--et-graph-trace)')
            ],
            at: { x: at, y }
        };
    }

    drawGrid(ctx, width, height, dpr, isNarrow, deferTicks, keyboard) {
        const minDisplayFreq = SPECTRUM_MIN_DISPLAY_FREQ;
        const maxDisplayFreq = SPECTRUM_MAX_DISPLAY_FREQ;
        const deferredTicks = [];

        if (keyboard) {
            for (const key of this.getKeyboardGeometry(width)) {
                const pitchClass = (key.midi % 12 + 12) % 12;
                if ((pitchClass !== 0 && pitchClass !== 5) ||
                    key.start <= 0 || key.start >= width) continue;
                ctx.strokeStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get(
                    pitchClass === 0 ? 'graph-grid-strong' : 'graph-grid-subtle'
                ) ?? '');
                ctx.lineWidth = dpr;
                ctx.beginPath();
                ctx.moveTo(key.start, 0);
                ctx.lineTo(key.start, height);
                if (this.displayOptions?.showAxes !== false) ctx.stroke();
            }
        } else {
            // Vertical grid lines (frequency) - Dynamic
            let baseGridFreqs = this.sc === 'linear'
                ? (isNarrow
                    ? [20, 10000, 20000, 30000, 40000]
                    : [20, 5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000])
                : (isNarrow
                    ? [20, 100, 1000, 10000, 20000]
                    : [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]);
            // Add Nyquist to the list if it's not too close to another major tick, or for the max label
            // Filter and ensure min/max are present
            let gridFreqsToDraw = baseGridFreqs.filter(f => f >= minDisplayFreq && f <= maxDisplayFreq);
            if (!gridFreqsToDraw.includes(minDisplayFreq) && minDisplayFreq > 0) gridFreqsToDraw.unshift(minDisplayFreq);
            if (!gridFreqsToDraw.includes(maxDisplayFreq)) gridFreqsToDraw.push(maxDisplayFreq);
            gridFreqsToDraw = [...new Set(gridFreqsToDraw)].sort((a, b) => a - b); // Unique & sorted

            gridFreqsToDraw.forEach(freq => {
                const x = this.frequencyToX(freq, width);
                if (x >=0 && x <= width) { // Draw only if within canvas
                    ctx.beginPath();
                    ctx.moveTo(x, 0);
                    ctx.lineTo(x, height);
                    if (this.displayOptions?.showAxes !== false) ctx.stroke();

                    if (freq !== minDisplayFreq && freq !== maxDisplayFreq && x > width*0.02 && x < width*0.98) { // Avoid clutter at edges
                        ctx.fillStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-label') ?? '');
                        ctx.font = `${(isNarrow ? 11 : 12) * dpr}px Arial`;
                        ctx.textAlign = 'center';
                        const text = freq >= 1000 ? `${Math.round(freq / 100)/10}k` : freq;
                        const y = height - ((isNarrow ? 30 : 40) * dpr);
                        if (deferTicks) {
                            deferredTicks.push({ text, x, y, fillStyle: ctx.fillStyle, font: ctx.font, textAlign: ctx.textAlign });
                        } else {
                            if (this.displayOptions?.showAxisNumbers !== false) (this.displayOptions?.textContext ?? ctx).fillText(text, x, y);
                        }
                    }
                }
            });
        }

        // Horizontal grid lines (dB) - No change to this logic
        ctx.strokeStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-grid-subtle') ?? '');
        ctx.lineWidth = dpr;
        const dbStep = isNarrow ? 24 : 12;
        for (let db = 0; db >= this.dr; db -= dbStep) {
            const y = height * (db / this.dr);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            if (this.displayOptions?.showAxes !== false) ctx.stroke();
            if (db !== 0 && db !== this.dr) {
                ctx.fillStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-label') ?? ''); ctx.font = `${(isNarrow ? 11 : 12) * dpr}px Arial`; ctx.textAlign = 'right';
                const text = `${db}dB`;
                const x = (isNarrow ? 46 : 80) * dpr;
                const labelY = y + (6 * dpr);
                if (deferTicks) {
                    deferredTicks.push({ text, x, y: labelY, fillStyle: ctx.fillStyle, font: ctx.font, textAlign: ctx.textAlign });
                } else {
                    if (this.displayOptions?.showAxisNumbers !== false) (this.displayOptions?.textContext ?? ctx).fillText(text, x, labelY);
                }
            }
        }
        return deferredTicks;
    }

    drawAxisLabels(ctx, width, height, dpr, isNarrow, deferredTicks, showFrequency) {
        if (this.displayOptions?.showAxisNumbers === false) return;
        const outline = this.dm === 'bar';
        if (outline) {
            ctx.save();
            ctx.strokeStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-bg-deep') ?? '');
            ctx.lineWidth = 2 * dpr;
            ctx.lineJoin = 'round';
        }
        // Draw axis labels
        ctx.fillStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('text-primary') ?? ''); ctx.font = `${(isNarrow ? 13 : 14) * dpr}px Arial`; ctx.textAlign = 'center';
        if (showFrequency) {
            if (outline) (this.displayOptions?.textContext ?? ctx).strokeText('Frequency (Hz)', width / 2, height - (8 * dpr));
            (this.displayOptions?.textContext ?? ctx).fillText('Frequency (Hz)', width / 2, height - (8 * dpr));
        }
        ctx.save();
        ctx.translate((isNarrow ? 18 : 20) * dpr, height / 2); ctx.rotate(-Math.PI / 2);
        if (outline) (this.displayOptions?.textContext ?? ctx).strokeText('Level (dB)', 0, 0);
        (this.displayOptions?.textContext ?? ctx).fillText('Level (dB)', 0, 0);
        ctx.restore();

        for (const tick of deferredTicks) {
            ctx.fillStyle = tick.fillStyle;
            ctx.font = tick.font;
            ctx.textAlign = tick.textAlign;
            if (outline) (this.displayOptions?.textContext ?? ctx).strokeText(tick.text, tick.x, tick.y);
            (this.displayOptions?.textContext ?? ctx).fillText(tick.text, tick.x, tick.y);
        }
        if (outline) ctx.restore();
    }

    collectSpectrumLevels(width, now) {
        const minDisplayFreq = SPECTRUM_MIN_DISPLAY_FREQ;
        const maxDisplayFreq = SPECTRUM_MAX_DISPLAY_FREQ;
        // Draw spectrum
        const fftSize = 1 << this.spectrumPoints;
        const binCount = this.spectrum.length;
        const xToLevels = new Map();
        const elapsedCapped = this.getPeakDecayElapsed(now);
        
        for (let i = 0; i < binCount; i++) {
            const hq = this.dspSpectrumSnapshot?.highQuality;
            if (hq && (i < this.dspSpectrumSnapshot.firstValidIndex ||
                i >= this.dspSpectrumSnapshot.firstValidIndex + this.dspSpectrumSnapshot.validCellCount)) continue;
            const freq = hq ? (i === binCount - 1 ? 40000 : 20 * Math.exp(i * Math.log(2000) / (binCount - 1))) : (i * this.sampleRate) / fftSize;

            if (freq < minDisplayFreq || freq > maxDisplayFreq) continue;

            const currentFreqClamped = Math.max(minDisplayFreq, Math.min(freq, maxDisplayFreq));
            const x = Math.round(this.frequencyToX(currentFreqClamped, width));
            
            const spectrumLevel = this.spectrum[i] > 0 ? 0 : this.spectrum[i];
            const projectedPeak = this.peaks[i] - 20 * elapsedCapped;
            const peakLevel = Math.max(
                -145,
                Math.min(0, spectrumLevel > projectedPeak ? spectrumLevel : projectedPeak)
            );

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
        return [...xToLevels.entries()].sort((a, b) => a[0] - b[0]);
    }

    getColorStyle(ctx, width, height) {
        if (this.cl === 'Normal') return null;
        const key = `${this.cl}|${this.sc}|${width}|${height}`;
        if (this.colorGradient?.context === ctx && this.colorGradient.key === key) {
            return this.colorGradient.style;
        }
        let gradient;
        if (this.cl === 'Heatmap') {
            const lut = window.SpectrogramPlugin?.getHeatmapLuts().rgba;
            if (!lut) return null;
            gradient = ctx.createLinearGradient(0, height, 0, 0);
            for (let intensity = 0; intensity < 256; intensity++) {
                const offset = intensity * 4;
                gradient.addColorStop(intensity / 255,
                    `rgba(${lut[offset]},${lut[offset + 1]},${lut[offset + 2]},${lut[offset + 3] / 255})`); // theme-allow: Shared Spectrogram heatmap colormap.
            }
        } else {
            const noteColor = window.NoteSpectrogramPlugin?.noteColor;
            if (!noteColor) return null;
            gradient = ctx.createLinearGradient(0, 0, width, 0);
            const firstMidi = 69 + 12 * Math.log2(this.displayXToFrequency(0) / 440);
            const lastMidi = 69 + 12 * Math.log2(this.displayXToFrequency(1) / 440);
            const addStop = (position, midi) => {
                const color = noteColor(midi);
                gradient.addColorStop(position, `rgb(${color.map(Math.round).join(',')})`); // theme-allow: Shared Note Spectrogram note colormap.
            };
            addStop(0, firstMidi);
            for (let midi = Math.ceil(firstMidi); midi <= Math.floor(lastMidi); midi++) {
                const frequency = 440 * 2 ** ((midi - 69) / 12);
                addStop(this.frequencyToX(frequency, width) / width, midi);
            }
            addStop(1, lastMidi);
        }
        this.colorGradient = { context: ctx, key, style: gradient };
        return gradient;
    }

    drawSpectrumLines(ctx, levels, width, height, dpr) {
        // Draw spectrum line
        ctx.beginPath();
        const colorStyle = this.displayOptions?.traceStyle?.(ctx, width, height) ??
            this.getColorStyle(ctx, width, height);
        ctx.strokeStyle = (colorStyle ?? window.ThemePalette?.get('graph-trace-fill') ?? ''); ctx.lineWidth = 2 * dpr;
        let first = true;
        for (const [x, [spectrumLevel]] of levels) {
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
        ctx.strokeStyle = (colorStyle ?? window.ThemePalette?.get('graph-trace') ?? ''); ctx.lineWidth = dpr;
        first = true;
        for (const [x, [, peakLevel]] of levels) {
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

    static aggregateBands(levels, width, bandCount) {
        const spectrum = new Float32Array(bandCount).fill(-Infinity);
        const peaks = new Float32Array(bandCount).fill(-Infinity);
        let firstFilled = bandCount;
        let lastFilled = -1;

        for (const [x, [spectrumLevel, peakLevel]] of levels) {
            const index = Math.floor(x * bandCount / width);
            const band = index >= bandCount ? bandCount - 1 : index;
            if (spectrumLevel > spectrum[band]) spectrum[band] = spectrumLevel;
            if (peakLevel > peaks[band]) peaks[band] = peakLevel;
            if (band < firstFilled) firstFilled = band;
            if (band > lastFilled) lastFilled = band;
        }

        // Bridge gaps only between measured bands, leaving both outer ranges empty.
        for (let band = firstFilled + 1; band < lastFilled; band++) {
            if (spectrum[band] === -Infinity) {
                spectrum[band] = spectrum[band - 1];
                peaks[band] = peaks[band - 1];
            }
        }
        return { spectrum, peaks, firstFilled, lastFilled };
    }

    drawSpectrumBars(ctx, bands, width, height, dpr) {
        const { spectrum, peaks, firstFilled, lastFilled } = bands;
        if (firstFilled > lastFilled) return;

        const bandWidth = width / spectrum.length;
        // All sizes scale with dpr so the Visualizer's fractional graph scale keeps the same proportions.
        const desiredGap = 2 * dpr;
        const gap = bandWidth - desiredGap >= dpr ? desiredGap : 0;
        const barWidth = bandWidth - gap;
        const peakHeight = dpr;
        const segmentPitch = 6 * dpr;
        const quantize = this.displayOptions?.quantizeBars === true;
        const fullBlockCount = Math.floor(height / segmentPitch);

        const noteColor = this.cl === 'Rainbow' ? window.NoteSpectrogramPlugin?.noteColor : null;
        const barColor = this.displayOptions?.barColor ?? (noteColor && ((band, count) => {
            const frequency = this.displayXToFrequency((band + 0.5) / count);
            const midi = 69 + 12 * Math.log2(frequency / 440);
            return `rgb(${noteColor(midi).map(Math.round).join(',')})`; // theme-allow: Shared Note Spectrogram note colormap.
        }));
        const colors = barColor && Array.from({ length: spectrum.length }, (_, band) =>
            barColor(band, spectrum.length));
        const colorStyle = colors ? null : (this.displayOptions?.traceStyle?.(ctx, width, height) ??
            this.getColorStyle(ctx, width, height));
        if (!colors) ctx.fillStyle = (colorStyle ?? window.ThemePalette?.get('graph-trace-fill') ?? '');
        ctx.save();
        ctx.beginPath();
        for (let band = firstFilled; band <= lastFilled; band++) {
            if (colors) ctx.fillStyle = colors[band];
            const x = band * bandWidth + gap / 2;
            const rawY = height * (spectrum[band] / this.dr);
            const y = quantize ? height - Math.floor((height - rawY) / segmentPitch) * segmentPitch : rawY;
            ctx.fillRect(x, y, barWidth, height - y);
            ctx.rect(x, y, barWidth, height - y);
        }

        // Cut horizontal segments only through the bar bodies, preserving the grid.
        ctx.clip();
        ctx.strokeStyle = ((this.displayOptions?.themePalette ?? window.ThemePalette)?.get('graph-bg-deep') ?? '');
        ctx.lineWidth = dpr;
        ctx.beginPath();
        for (let y = height - segmentPitch; y > 0; y -= segmentPitch) {
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
        }
        ctx.stroke();
        ctx.restore();

        if (!colors) ctx.fillStyle = (colorStyle ?? window.ThemePalette?.get('graph-trace') ?? '');
        for (let band = firstFilled; band <= lastFilled; band++) {
            if (colors) ctx.fillStyle = colors[band];
            const x = band * bandWidth + gap / 2;
            const rawY = height * (peaks[band] / this.dr);
            const y = quantize ? height - Math.min(fullBlockCount,
                Math.ceil((height - rawY) / segmentPitch)) * segmentPitch : rawY;
            ctx.fillRect(x, quantize ? y + peakHeight / 2 : y, barWidth,
                quantize ? segmentPitch - peakHeight : peakHeight);
        }
    }
}

// Register plugin (assuming PluginBase and window context for browser)
if (typeof window !== 'undefined' && typeof PluginBase !== 'undefined') {
    window.SpectrumAnalyzerPlugin = SpectrumAnalyzerPlugin;
}
