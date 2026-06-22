class FiveBandDynamicEQ extends PluginBase {
    constructor() {
        super('5Band Dynamic EQ', 'Five-band dynamic equalizer');

        this.numBands = 5;
        this.bs = [100, 300, 1000, 3000, 10000].map((f, i) => ({
            en: i === 2,    // enabled only on band 3
            ft: 'pk',       // filter type
            f,              // frequency
            q: 1.0,         // Q factor
            mg: 6.0,        // max gain (dB)
            th: -18.0 - i*3,// threshold (dB)
            r: 2.0,         // ratio (linear)
            kn: 3.0,        // knee (dB)
            a: 10.0,        // attack (ms)
            rl: 100.0,      // release (ms)
            scf: f,         // sidechain frequency
            scq: 1.0        // sidechain Q
          }));
        // --- UI State ---
        this.currentBandIndex = 2; // Default selected band: Band 3
        this.animationFrameId = null;
        this.bandTabs = []; // Array to hold tab button elements
        this.bandContentPanes = []; // Array to hold content pane elements
        this.bandEnableCheckboxes = []; // Array to hold checkbox elements

        // --- Canvas References ---
        this.canvas = null;
        this.ctx = null;
        // Updated by IntersectionObserver once the canvas is mounted; the
        // animation loop pauses while the canvas is scrolled out of view.
        this.isVisible = true;
        this.observer = null;
        // Remove fixed width/height, control via CSS
        // this.canvasWidth = 400;
        // this.canvasHeight = 200;

        this.latestSmoothedGains = new Array(this.numBands).fill(0); // Store latest gains for graph

        this.registerProcessor(`
            // --- Helper Envelope Follower ---
            class EnvelopeFollower {
                constructor(sampleRate){ this.sampleRate = sampleRate; this.attackCoef = 0.0; this.releaseCoef = 0.0; this.envelope = 1e-9; }
                setAttack(attackMs){ this.attackCoef = Math.exp(-1000.0 / (attackMs * this.sampleRate)); }
                setRelease(releaseMs){ this.releaseCoef = Math.exp(-1000.0 / (releaseMs * this.sampleRate)); }
                process(input) {
                    const absInput = input < 0.0 ? -input : input; // Faster abs
                    this.envelope = (absInput > this.envelope)
                        ? this.attackCoef * (this.envelope - absInput) + absInput
                        : this.releaseCoef * (this.envelope - absInput) + absInput;
                    if (this.envelope < 1e-9) { this.envelope = 1e-9; } // Prevent log(<=0) without Math.max
                    return 20 * Math.log10(this.envelope);
                }
                processGain(targetGainDB) {
                    this.envelope = (targetGainDB > this.envelope)
                        ? this.attackCoef * (this.envelope - targetGainDB) + targetGainDB
                        : this.releaseCoef * (this.envelope - targetGainDB) + targetGainDB;
                    return this.envelope;
                }
            }

            // --- Biquad Coefficient Calculation ---
            const calculateCoeffs = (type, f, Q, gainDB, sampleRate) => {
                // Bypass for near-zero gain
                if ((gainDB > -1e-5 && gainDB < 1e-5) && (type === 'pk' || type === 'ls' || type === 'hs')) {
                    return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
                }
                const w0 = 2 * Math.PI * f / sampleRate;
                const cos_w0 = Math.cos(w0);
                const sin_w0 = Math.sin(w0);
                const alpha = sin_w0 / (2 * Q);
                let b0=1, b1=0, b2=0, a0=1, a1=0, a2=0;

                switch (type) {
                    case 'pk':
                        const A_pk = Math.pow(10, gainDB / 40);
                        const alphaA_pk = alpha * A_pk; const alphaDivA_pk = alpha / A_pk;
                        b0 = 1 + alphaA_pk; b1 = -2 * cos_w0; b2 = 1 - alphaA_pk;
                        a0 = 1 + alphaDivA_pk; a1 = -2 * cos_w0; a2 = 1 - alphaDivA_pk;
                        break;
                    case 'ls':
                        const A_ls = Math.pow(10, gainDB / 20);
                        const betaLS_term = A_ls * ((A_ls*A_ls + 1)/Q - (A_ls - 1)*(A_ls - 1));
                        const betaLS = Math.sqrt(betaLS_term < 0 ? 0 : betaLS_term); // Basic safety for sqrt
                        b0=A_ls*((A_ls+1) - (A_ls-1)*cos_w0 + betaLS*sin_w0); b1= 2*A_ls*((A_ls-1) - (A_ls+1)*cos_w0); b2=A_ls*((A_ls+1) - (A_ls-1)*cos_w0 - betaLS*sin_w0);
                        a0=(A_ls+1) + (A_ls-1)*cos_w0 + betaLS*sin_w0; a1=-2*((A_ls-1) + (A_ls+1)*cos_w0); a2=(A_ls+1) + (A_ls-1)*cos_w0 - betaLS*sin_w0;
                        break;
                    case 'hs':
                        const A_hs = Math.pow(10, gainDB / 20);
                        const betaHS_term = A_hs * ((A_hs*A_hs + 1)/Q - (A_hs - 1)*(A_hs - 1));
                        const betaHS = Math.sqrt(betaHS_term < 0 ? 0 : betaHS_term); // Basic safety for sqrt
                        b0=A_hs*((A_hs+1) + (A_hs-1)*cos_w0 + betaHS*sin_w0); b1=-2*A_hs*((A_hs-1) + (A_hs+1)*cos_w0); b2=A_hs*((A_hs+1) + (A_hs-1)*cos_w0 - betaHS*sin_w0);
                        a0=(A_hs+1) - (A_hs-1)*cos_w0 + betaHS*sin_w0; a1= 2*((A_hs-1) - (A_hs+1)*cos_w0); a2=(A_hs+1) - (A_hs-1)*cos_w0 - betaHS*sin_w0;
                        break;
                    case 'bp':
                        b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos_w0; a2 = 1 - alpha;
                        break;
                    default:
                        b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; a0 = 1;
                        break;
                }
                // Normalize coefficients
                const norm = 1.0 / a0; // Assume a0 is not zero
                return { b0: b0*norm, b1: b1*norm, b2: b2*norm, a1: a1*norm, a2: a2*norm };
            };

            // --- Processor Main Logic ---
            const channelCount = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate;
            const pluginEnabled = parameters.enabled;
            const numBands = parameters.bs.length; // Use 'bs' based on user provided code

            // --- Context Initialization or Reset ---
            if (!context.initialized || context.channelCount !== channelCount || context.numBands !== numBands || context.sampleRate !== sampleRate) {
                context.bs = []; // Use 'bs' based on user provided code
                for (let i = 0; i < numBands; i++) {
                    const bandStates = []; const levelDetectors = []; const gainEnvelopes = [];
                    for(let ch=0; ch<channelCount; ++ch) {
                        bandStates.push({
                            w1: 0, w2: 0, sc_w1: 0, sc_w2: 0, lastGain: NaN,
                            lastCoeffs: { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 }
                        });
                    }
                    // Level detector and gain envelope only needed once per band for mono dynamics
                    levelDetectors.push(new EnvelopeFollower(sampleRate));
                    gainEnvelopes.push(new EnvelopeFollower(sampleRate));

                    context.bs.push({ // Use 'bs' based on user provided code
                        bandStates: bandStates,
                        levelDetector: levelDetectors[0], // Use the first instance for mono detection
                        gainEnvelope: gainEnvelopes[0],   // Use the first instance for mono gain smoothing
                        smoothedGain: 0,
                        mono_sc_w1: 0, // Mono state for sidechain filter
                        mono_sc_w2: 0  // Mono state for sidechain filter
                    });
                }
                context.channelCount = channelCount; context.numBands = numBands; context.sampleRate = sampleRate; context.initialized = true;
            }

            // --- Pre-calculate parameters for the block ---
            const bandProcessingParams = new Array(numBands);
            const GAIN_THRESHOLD = 1e-4;

            for (let bandIdx = 0; bandIdx < numBands; bandIdx++) {
                const band = parameters.bs[bandIdx]; // Use 'bs' based on user provided code
                const ctxBand = context.bs[bandIdx]; // Use 'bs' based on user provided code
                const param_en = band.en;

                let scCoeffs = null, halfKnee = 0.0, slopeFactor = 0.0;
                if (param_en) {
                    scCoeffs = calculateCoeffs('bp', band.scf, band.scq, 0, sampleRate);
                    halfKnee = band.kn * 0.5;
                    const ratio = band.r;
                    slopeFactor = (ratio === 1.0) ? 0.0 : ((1.0 - 1.0 / ratio) < 0 ? -(1.0 - 1.0 / ratio) : (1.0 - 1.0 / ratio)); // Faster abs

                    // Set attack/release for the single mono detector/envelope
                    ctxBand.levelDetector.setAttack(band.a);
                    ctxBand.levelDetector.setRelease(band.rl);
                    ctxBand.gainEnvelope.setAttack(band.a);
                    ctxBand.gainEnvelope.setRelease(band.rl);
                }

                bandProcessingParams[bandIdx] = {
                    enabled: param_en, ctxBand, scCoeffs,
                    th: band.th, ft: band.ft, f: band.f, q: band.q, kn: band.kn,
                    r: band.r, mg: band.mg, halfKnee, ratio: band.r, slopeFactor, maxGain: band.mg
                };
            }

            // --- Allocate temporary per-sample buffers ---
            let currentSample = new Array(channelCount);
            let processedSample = new Array(channelCount);
            const smoothedGainsForMessage = new Array(numBands).fill(0);

            // --- Process Audio Sample by Sample ---
            for (let i = 0; i < blockSize; i++) {
                // 1. Read input & Calculate Mono Average
                let monoSample = 0.0;
                for (let ch = 0; ch < channelCount; ch++) {
                    const sample = data[ch * blockSize + i];
                    currentSample[ch] = sample;
                    monoSample += sample;
                }
                monoSample /= channelCount;

                // 2. Bypass Logic
                if (!pluginEnabled) {
                    if (i === blockSize - 1) { for (let k=0; k<numBands; k++) smoothedGainsForMessage[k] = 0.0; }
                    // When bypassing, copy input to output directly
                    for (let ch = 0; ch < channelCount; ch++) {
                        data[ch * blockSize + i] = currentSample[ch];
                    }
                    continue; // Skip processing for this sample
                }

                // Initial processed sample is the current sample (for bands that are off)
                for (let ch = 0; ch < channelCount; ch++) {
                    processedSample[ch] = currentSample[ch];
                }


                // 3. Process Bands Sequentially
                for (let bandIdx = 0; bandIdx < numBands; bandIdx++) {
                    const params = bandProcessingParams[bandIdx];

                    if (!params.enabled) {
                        if (i === blockSize - 1) { smoothedGainsForMessage[bandIdx] = 0.0; }
                        continue; // Skip processing for this band
                    }

                    // --- Mono Dynamics Processing ---
                    const { ctxBand, scCoeffs, th, halfKnee, ratio, slopeFactor, maxGain, ft, f, q, kn } = params;
                    const levelDetector = ctxBand.levelDetector;
                    const gainEnvelope = ctxBand.gainEnvelope;

                    // 3a. Mono Sidechain Filter
                    const sc_y0_mono = scCoeffs.b0 * monoSample + ctxBand.mono_sc_w1;
                    ctxBand.mono_sc_w1 = scCoeffs.b1 * monoSample - scCoeffs.a1 * sc_y0_mono + ctxBand.mono_sc_w2;
                    ctxBand.mono_sc_w2 = scCoeffs.b2 * monoSample - scCoeffs.a2 * sc_y0_mono;

                    // 3b. Mono Level Detection
                    const levelDB_mono = levelDetector.process(sc_y0_mono);

                    // 3c. Mono Gain Computation
                    const deltaDB = levelDB_mono - th;
                    let gainMagnitude = 0.0;
                    if (deltaDB > -halfKnee) {
                        if (kn > 1e-9 && deltaDB <= halfKnee) {
                            const x = deltaDB + halfKnee; gainMagnitude = (slopeFactor * x * x) / (2.0 * kn);
                        } else {
                            gainMagnitude = slopeFactor * halfKnee + slopeFactor * (deltaDB - halfKnee);
                        }
                    }
                    const clampedGainMag = gainMagnitude > maxGain ? maxGain : gainMagnitude;
                    const G_ctrl_mono = (ratio >= 1.0) ? -clampedGainMag : clampedGainMag;

                    // 3d. Mono Gain Smoothing
                    const final_G_smoothed_mono = gainEnvelope.processGain(G_ctrl_mono);

                    // Update measurement gain (only needs to be done once per block ideally)
                    if (i === blockSize - 1) {
                       smoothedGainsForMessage[bandIdx] = final_G_smoothed_mono;
                       ctxBand.smoothedGain = final_G_smoothed_mono;
                    }

                    // --- Stereo EQ Filtering (based on mono dynamics) ---
                    for (let ch = 0; ch < channelCount; ch++) {
                        const inputSample = currentSample[ch]; // Use the output of the previous band (or original input)
                        const bandState = ctxBand.bandStates[ch];

                        // 3e. EQ Coefficient Calculation (Conditional, based on mono gain)
                        let eqCoeffs;
                        const gainDiff = final_G_smoothed_mono - bandState.lastGain;
                        if ((gainDiff > -GAIN_THRESHOLD && gainDiff < GAIN_THRESHOLD)) {
                            eqCoeffs = bandState.lastCoeffs;
                        } else {
                            eqCoeffs = calculateCoeffs(ft, f, q, final_G_smoothed_mono, sampleRate);
                            bandState.lastGain = final_G_smoothed_mono; bandState.lastCoeffs = eqCoeffs;
                        }

                        // 3f. Apply EQ Filter (Per Channel)
                        const eq_y0 = eqCoeffs.b0 * inputSample + bandState.w1;
                        bandState.w1 = eqCoeffs.b1 * inputSample - eqCoeffs.a1 * eq_y0 + bandState.w2;
                        bandState.w2 = eqCoeffs.b2 * inputSample - eqCoeffs.a2 * eq_y0;
                        processedSample[ch] = eq_y0; // Store output of this band for this channel
                    } // End channel loop

                    // Swap buffers for next band
                    [currentSample, processedSample] = [processedSample, currentSample];

                } // End band loop

                // 4. Write final output (after all bands processed)
                for (let ch = 0; ch < channelCount; ch++) {
                    // The final 'currentSample' holds the output after the last band's swap
                    data[ch * blockSize + i] = currentSample[ch];
                }
            } // End sample loop

            // 5. Attach measurements to the output data buffer (as per user's code)
            data.measurements = { gains: smoothedGainsForMessage };

            // Return the modified data buffer
            return data;
            `); // End of registerProcessor template literal
    }

    // --- Parameter Handling ---
    getParameters() {
        const params = {
            type: this.constructor.name,
            enabled: this.enabled,
            bs: this.bs.map(b => ({ ...b })) // Return a copy
        };
        return params;
    }

    // Override the setParameters method to add debugging
    setParameters(params) {
        if (!params || typeof params !== 'object') return;
        let requiresUpdate = false;

        if (params.bs && Array.isArray(params.bs) && params.bs.length === this.numBands) {
            for (let i = 0; i < this.numBands; i++) {
                const bandParams = params.bs[i];
                const currentBand = this.bs[i];
                if (!bandParams) continue;

                // Check and set each parameter, mark requiresUpdate if changed
                 if (bandParams.en !== undefined && bandParams.en !== currentBand.en) { 
                    this.setBandEnabled(i, bandParams.en); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.ft !== undefined && bandParams.ft !== currentBand.ft) { 
                    this.setBandFilterType(i, bandParams.ft); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.f !== undefined && bandParams.f !== currentBand.f) { 
                    this.setBandFrequency(i, bandParams.f); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.q !== undefined && bandParams.q !== currentBand.q) { 
                    this.setBandQ(i, bandParams.q); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.mg !== undefined && bandParams.mg !== currentBand.mg) { 
                    this.setBandMaxGain(i, bandParams.mg); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.th !== undefined && bandParams.th !== currentBand.th) { 
                    this.setBandThreshold(i, bandParams.th); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.r !== undefined && bandParams.r !== currentBand.r) { 
                    this.setBandRatio(i, bandParams.r); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.kn !== undefined && bandParams.kn !== currentBand.kn) { 
                    this.setBandKnee(i, bandParams.kn); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.a !== undefined && bandParams.a !== currentBand.a) { 
                    this.setBandAttack(i, bandParams.a); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.rl !== undefined && bandParams.rl !== currentBand.rl) { 
                    this.setBandRelease(i, bandParams.rl); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.scf !== undefined && bandParams.scf !== currentBand.scf) { 
                    this.setBandSidechainFreq(i, bandParams.scf); 
                    requiresUpdate = true; 
                 }
                 if (bandParams.scq !== undefined && bandParams.scq !== currentBand.scq) { 
                    this.setBandSidechainQ(i, bandParams.scq); 
                    requiresUpdate = true; 
                 }
            }
        }

         if (requiresUpdate) {
             this.updateParameters(); // Notify host of changes
             this.updateUI(); // Update UI elements to reflect new parameters
             this._drawGraph(); // Explicitly redraw the graph when parameters change
         }
    }

    // Override updateParameters to add debugging
    updateParameters() {
        super.updateParameters();
    }

    // --- Individual Band Parameter Setters (with Validation) ---

    setBandEnabled(index, value) {
        if (index >= 0 && index < this.numBands && typeof value === 'boolean') {
            this.bs[index].en = value;
            this.updateParameters();
            this._drawGraph();
        }
    }

    setBandFilterType(index, value) {
        if (index >= 0 && index < this.numBands && ['pk', 'ls', 'hs'].includes(value)) {
            this.bs[index].ft = value;
            this.updateParameters();
            this._drawGraph();
        }
    }

    setBandFrequency(index, value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (index >= 0 && index < this.numBands && !isNaN(numValue)) {
            const clampedValue = Math.max(20, Math.min(20000, numValue));
            this.bs[index].f = clampedValue;
            this.updateParameters();
            this._drawGraph();
        }
    }
    
    // Convert slider value (0.0-1.0) to frequency (20Hz-20kHz)
    _sliderToLogFreq(sliderVal) { 
        // Convert slider value (0.0-1.0) to frequency (20Hz-20kHz)
        const minLog = Math.log10(20);
        const maxLog = Math.log10(20000);
        return Math.pow(10, minLog + sliderVal * (maxLog - minLog));
    }
    
    // Convert frequency (20Hz-20kHz) to slider value (0.0-1.0)
    _logFreqToSlider(freq) { 
        // Convert frequency (20Hz-20kHz) to slider value (0.0-1.0)
        const minLog = Math.log10(20);
        const maxLog = Math.log10(20000);
        return (Math.log10(Math.max(20, Math.min(20000, freq))) - minLog) / (maxLog - minLog);
    }

    setBandQ(index, value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (index >= 0 && index < this.numBands && !isNaN(numValue)) {
            this.bs[index].q = Math.max(0.1, Math.min(10.0, numValue));
            this.updateParameters();
            this._drawGraph();
        }
    }

    setBandMaxGain(index, value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (index >= 0 && index < this.numBands && !isNaN(numValue)) {
            this.bs[index].mg = Math.max(0, Math.min(24.0, numValue));
            this.updateParameters();
            this._drawGraph();
        }
    }

    setBandThreshold(index, value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (index >= 0 && index < this.numBands && !isNaN(numValue)) {
            this.bs[index].th = Math.max(-60.0, Math.min(0.0, numValue));
            this.updateParameters();
            this._drawGraph();
        }
    }

    // Ratio is stored internally as a linear ratio. The UI converts slider positions at the boundary.
    setBandRatio(index, value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (index >= 0 && index < this.numBands && !isNaN(numValue)) {
            this.bs[index].r = Math.max(0.1, Math.min(100.0, numValue));
            this.updateParameters();
            this._drawGraph();
        }
    }
    // Convert slider value (-100 to 200) to linear ratio (0.1 to 100)
    _sliderToRatio(sliderVal) { return Math.pow(10, sliderVal / 100); }
    // Convert linear ratio (0.1 to 100) to slider value (-100 to 200)
    _ratioToSlider(ratio) { return 100 * Math.log10(Math.max(0.1, Math.min(100, ratio))); }

    setBandKnee(index, value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (index >= 0 && index < this.numBands && !isNaN(numValue)) {
            this.bs[index].kn = Math.max(0.0, Math.min(10.0, numValue));
            this.updateParameters();
            this._drawGraph();
        }
    }

    setBandAttack(index, value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (index >= 0 && index < this.numBands && !isNaN(numValue)) {
            this.bs[index].a = Math.max(0.1, Math.min(100.0, numValue));
            this.updateParameters();
            this._drawGraph();
        }
    }

    setBandRelease(index, value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (index >= 0 && index < this.numBands && !isNaN(numValue)) {
            this.bs[index].rl = Math.max(1.0, Math.min(1000.0, numValue));
            this.updateParameters();
            this._drawGraph();
        }
    }

    setBandSidechainFreq(index, value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (index >= 0 && index < this.numBands && !isNaN(numValue)) {
            const clampedValue = Math.max(20, Math.min(20000, numValue));
            this.bs[index].scf = clampedValue;
            this.updateParameters();
            this._drawGraph();
        }
    }

     setBandSidechainQ(index, value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        if (index >= 0 && index < this.numBands && !isNaN(numValue)) {
            this.bs[index].scq = Math.max(0.1, Math.min(10.0, numValue));
            this.updateParameters();
            this._drawGraph();
        }
    }


    // --- UI Creation ---
    createUI() {
        this.stopAnimation();
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
            this.resizeObserver = null;
        }

        const container = document.createElement('div');
        container.className = 'five-band-dynamic-eq-plugin-ui plugin-container';
        
        // Unique instance identifier (like multiband_compressor)
        this.instanceId = `five-band-dynamic-eq-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        container.setAttribute('data-instance-id', this.instanceId);

        // --- Band Settings Area ---
        const bandSettingsDiv = document.createElement('div');
        bandSettingsDiv.className = 'fbdyn-band-settings';

        // 1. Band Tabs Container
        const bandTabsContainer = document.createElement('div');
        bandTabsContainer.className = 'fbdyn-band-tabs';
        bandSettingsDiv.appendChild(bandTabsContainer);

        // 2. Band Content Panes Container
        const bandContentsContainer = document.createElement('div');
        bandContentsContainer.className = 'fbdyn-band-contents';
        bandSettingsDiv.appendChild(bandContentsContainer);

        // Reset arrays before populating
        this.bandContentPanes = [];
        this.bandEnableCheckboxes = [];

        // Create tabs for each band
        for (let i = 0; i < this.numBands; i++) {
            const button = document.createElement('button');
            button.className = `fbdyn-band-tab ${i === this.currentBandIndex ? 'active' : ''}`;
            button.dataset.bandIndex = i;
            button.setAttribute('data-instance-id', this.instanceId);
            button.setAttribute('role', 'tab');
            button.setAttribute('aria-controls', `${this.instanceId}-band-content-${i}`);

            const buttonContent = document.createElement('span');
            buttonContent.style.display = 'inline-flex';
            buttonContent.style.alignItems = 'center';
            buttonContent.style.gap = '5px';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.bs[i].en;
            checkbox.id = `${this.instanceId}-band-${i}-enable`;
            checkbox.className = 'fbdyn-band-tab-checkbox';
            checkbox.setAttribute('aria-label', `Enable Band ${i + 1}`);
            checkbox.autocomplete = "off";
            
            // Event listener for checkbox change
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation(); // Prevent triggering the button click
                const index = parseInt(button.dataset.bandIndex, 10);
                this.setBandEnabled(index, e.target.checked);
                this.updateParameters();
                button.classList.toggle('disabled', !e.target.checked);
                this._drawGraph();
            });
            
            buttonContent.appendChild(checkbox);
            this.bandEnableCheckboxes.push(checkbox);

            const buttonText = document.createElement('span');
            buttonText.textContent = `Band ${i + 1}`;
            buttonContent.appendChild(buttonText);
            button.appendChild(buttonContent);

            // Event listener for tab button click
            button.addEventListener('click', (e) => {
                if (e.target === checkbox) return; // Don't select if clicking checkbox
                
                const index = parseInt(e.currentTarget.dataset.bandIndex, 10);
                
                // Update active states
                this.currentBandIndex = index;
                
                // Update UI to reflect the changed selection
                this.updateUI();
                this._drawGraph();
            });

            bandTabsContainer.appendChild(button);
            this.bandTabs = bandTabsContainer.querySelectorAll('.fbdyn-band-tab');
        }

        // Create content pane for each band and populate with controls
        for (let i = 0; i < this.numBands; i++) {
            const contentPane = document.createElement('div');
            contentPane.className = `fbdyn-band-content plugin-parameter-ui ${i === this.currentBandIndex ? 'active' : ''}`;
            contentPane.id = `${this.instanceId}-band-content-${i}`;
            contentPane.setAttribute('data-instance-id', this.instanceId);
            
            // Populate with controls for band `i`
            this._createBandParameterControls(contentPane, i);
            bandContentsContainer.appendChild(contentPane);
            this.bandContentPanes.push(contentPane);
        }

        container.appendChild(bandSettingsDiv);
        // --- End Band Settings Area ---

        // 3. Graph Area
        const graphContainer = document.createElement('div');
        graphContainer.className = 'fbdyn-graph';
        this.canvas = document.createElement('canvas');
        this.canvas.width = 800;
        this.canvas.height = 180;
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        graphContainer.appendChild(this.canvas);
        container.appendChild(graphContainer);

        // Pause the redraw loop while the canvas is off-screen.
        this.observer = new IntersectionObserver(entries => {
            for (const entry of entries) {
                this.isVisible = entry.isIntersecting;
                if (this.isVisible) {
                    this.startAnimation();
                } else {
                    this.stopAnimation();
                }
            }
        });
        this.observer.observe(this.canvas);

        // Initial setup
        this.startAnimation();

        // Setup ResizeObserver
        this.resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                if (width > 0 && height > 0) {
                    // Only update canvas dimensions if size actually changed
                    if (this.canvas.width !== width*2 || this.canvas.height !== height*2) {
                        // Use higher resolution for sharp display
                        this.canvas.width = width * 2;
                        this.canvas.height = height * 2;
                        this._drawGraph();
                    }
                }
            }
        });
        this.resizeObserver.observe(graphContainer);

        return container;
    }

    // Populates a container with parameter controls for a specific band
    _createBandParameterControls(container, bandIndex) {
        const createParameterRow = (label, min, max, step, value, onChange, convertFromSlider, convertToSlider, displayFormat) => {
            const row = document.createElement('div');
            row.classList.add('parameter-row');
            row.style.width = '100%'; // Full width display
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            row.style.margin = '5px 0';
            
            const labelElement = document.createElement('label');
            labelElement.textContent = label + ':';
            labelElement.style.minWidth = '120px';
            row.appendChild(labelElement);
            
            const sliderContainer = document.createElement('div');
            sliderContainer.classList.add('slider-container');
            sliderContainer.style.flex = '1';
            sliderContainer.style.margin = '0 10px';
            
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = min;
            slider.max = max;
            slider.step = step;
            slider.style.width = '100%';
            slider.id = `${this.instanceId}-band${bandIndex}-${label.replace(/[() ]/g, '')}-slider`;
            
            // Set slider value (with conversion)
            const sliderValue = convertToSlider ? convertToSlider(value) : value;
            slider.value = sliderValue;
            
            const numberInput = document.createElement('input');
            numberInput.type = 'number';
            numberInput.min = convertFromSlider ? convertFromSlider(min) : min;
            numberInput.max = convertFromSlider ? convertFromSlider(max) : max;
            numberInput.step = step; // Use same step as slider
            
            // Set initial value according to format
            numberInput.value = displayFormat ? displayFormat(value) : 
                                (step >= 1 ? Math.round(value) : 
                                 (step >= 0.1 ? value.toFixed(1) : value.toFixed(2)));
            
            numberInput.style.width = '70px';
            numberInput.id = `${this.instanceId}-band${bandIndex}-${label.replace(/[() ]/g, '')}-input`;
            
            // Slider change event
            slider.addEventListener('input', (e) => {
                const sliderVal = parseFloat(e.target.value);
                const paramValue = convertFromSlider ? convertFromSlider(sliderVal) : sliderVal;
                
                // Update number input field based on display format
                numberInput.value = displayFormat ? displayFormat(paramValue) : 
                                    (step >= 1 ? Math.round(paramValue) : 
                                     (step >= 0.1 ? paramValue.toFixed(1) : paramValue.toFixed(2)));
                
                onChange(paramValue);
            });
            
            // Number input change event
            numberInput.addEventListener('change', (e) => {
                const paramValue = parseFloat(e.target.value);
                if (!isNaN(paramValue)) {
                    const sliderVal = convertToSlider ? convertToSlider(paramValue) : paramValue;
                    slider.value = sliderVal;
                    onChange(paramValue);
                }
            });
            
            sliderContainer.appendChild(slider);
            row.appendChild(sliderContainer);
            row.appendChild(numberInput);
            return row;
        };
        
        // Filter type dropdown
        const filterTypeRow = document.createElement('div');
        filterTypeRow.classList.add('parameter-row');
        
        const filterTypeLabel = document.createElement('label');
        filterTypeLabel.textContent = 'Filter Type:';
        filterTypeLabel.style.minWidth = '120px';
        filterTypeRow.appendChild(filterTypeLabel);
        
        const filterTypeSelect = document.createElement('select');
        filterTypeSelect.id = `${this.instanceId}-band${bandIndex}-ft-select`;
        filterTypeSelect.style.marginLeft = '10px';
        
        const filterTypes = ['ls', 'pk', 'hs']; // Match actual filter values
        const filterTypeLabels = ['Lowshelf', 'Peak', 'Highshelf']; // Display labels
        
        filterTypes.forEach((type, index) => {
            const option = document.createElement('option');
            option.value = type;
            option.textContent = filterTypeLabels[index];
            filterTypeSelect.appendChild(option);
        });
        
        filterTypeSelect.value = this.bs[bandIndex].ft;
        filterTypeSelect.addEventListener('change', (e) => {
            const typeValue = e.target.value;
            this.setBandFilterType(bandIndex, typeValue);
        });
        
        filterTypeRow.appendChild(filterTypeSelect);
        container.appendChild(filterTypeRow);

        // Create container for two-column grid layout
        const twoColumnContainer = document.createElement('div');
        twoColumnContainer.classList.add('fbdyn-two-columns');
        twoColumnContainer.style.display = 'grid';
        twoColumnContainer.style.gridTemplateColumns = '1fr 1fr';
        twoColumnContainer.style.gap = '20px';
        twoColumnContainer.style.width = '100%';
        container.appendChild(twoColumnContainer);

        // Create left and right column containers
        const leftColumn = document.createElement('div');
        leftColumn.classList.add('fbdyn-column');
        leftColumn.style.display = 'flex';
        leftColumn.style.flexDirection = 'column';
        
        const rightColumn = document.createElement('div');
        rightColumn.classList.add('fbdyn-column');
        rightColumn.style.display = 'flex';
        rightColumn.style.flexDirection = 'column';
        
        twoColumnContainer.appendChild(leftColumn);
        twoColumnContainer.appendChild(rightColumn);
        
        // Frequency parameter - integer display (left column)
        leftColumn.appendChild(createParameterRow(
            'Frequency (Hz)', 0, 1, 0.01, this.bs[bandIndex].f,
            (val) => this.setBandFrequency(bandIndex, val),
            (sliderVal) => this._sliderToLogFreq(sliderVal),
            (freq) => this._logFreqToSlider(freq),
            (val) => Math.round(val) // Integer display only
        ));
        
        // Q parameter (right column)
        rightColumn.appendChild(createParameterRow(
            'Q', 0.1, 10, 0.1, this.bs[bandIndex].q,
            (val) => this.setBandQ(bandIndex, val)
        ));
        
        // Max gain parameter (left column)
        leftColumn.appendChild(createParameterRow(
            'Max Gain (dB)', 0, 24, 0.1, this.bs[bandIndex].mg,
            (val) => this.setBandMaxGain(bandIndex, val)
        ));
        
        // Threshold parameter (right column)
        rightColumn.appendChild(createParameterRow(
            'Threshold (dB)', -60, 0, 0.1, this.bs[bandIndex].th,
            (val) => this.setBandThreshold(bandIndex, val)
        ));
        
        // Ratio parameter - logarithmic to linear conversion (left column)
        leftColumn.appendChild(createParameterRow(
            'Ratio', -100, 200, 1, this.bs[bandIndex].r,
            (val) => this.setBandRatio(bandIndex, val),
            (sliderVal) => this._sliderToRatio(sliderVal),
            (ratio) => this._ratioToSlider(ratio),
            (val) => val.toPrecision(3) // Display linear ratio value
        ));
        
        // Knee width parameter (right column)
        rightColumn.appendChild(createParameterRow(
            'Knee Width (dB)', 0, 30, 0.1, this.bs[bandIndex].kn,
            (val) => this.setBandKnee(bandIndex, val)
        ));
        
        // Attack parameter (right column)
        leftColumn.appendChild(createParameterRow(
            'Attack (ms)', 0.1, 200, 0.1, this.bs[bandIndex].a,
            (val) => this.setBandAttack(bandIndex, val)
        ));
        
        // Release parameter - integer display (left column)
        rightColumn.appendChild(createParameterRow(
            'Release (ms)', 1, 1000, 1, this.bs[bandIndex].rl,
            (val) => this.setBandRelease(bandIndex, val),
            null, null,
            (val) => Math.round(val) // Integer display only
        ));
        
        // Sidechain frequency parameter - integer display (left column)
        leftColumn.appendChild(createParameterRow(
            'SC Freq. (Hz)', 0, 1, 0.01, this.bs[bandIndex].scf,
            (val) => this.setBandSidechainFreq(bandIndex, val),
            (sliderVal) => this._sliderToLogFreq(sliderVal),
            (freq) => this._logFreqToSlider(freq),
            (val) => Math.round(val) // Integer display only
        ));
        
        // Sidechain Q parameter (right column)
        rightColumn.appendChild(createParameterRow(
            'SC Q', 0.1, 10, 0.1, this.bs[bandIndex].scq,
            (val) => this.setBandSidechainQ(bandIndex, val)
        ));
    }

    // --- Graph Drawing ---
    _drawGraph() {
        // Check if canvas context and dimensions are valid
        if (!this.ctx || !this.canvas || this.canvas.width <= 0 || this.canvas.height <= 0) {
            // Avoid drawing if canvas is not ready
            return;
        }

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;

        // --- Clear and Draw Background ---
        // Ensure the canvas is cleared before drawing
        ctx.clearRect(0, 0, width, height);
        // Set background color (matching PEQ style)
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        // --- Draw Grid ---
        // Set grid line style
        ctx.strokeStyle = '#444'; // Darker color for grid lines
        ctx.lineWidth = 2;       // Thicker lines
        // Set grid label style
        ctx.font = '20px Arial'; // Larger font size
        ctx.fillStyle = '#888';  // Darker text color for better visibility

        // Define frequency and gain ranges for the graph axis
        const minFreq = 10;      // Hz, matches PEQ range
        const maxFreq = 40000;   // Hz, matches PEQ range
        const minGain = -12;     // dB
        const maxGain = 12;      // dB
        const gainRange = maxGain - minGain;

        // Pre-computed constants for log-scale frequency mapping (used by
        // every curve and grid-line below). Recomputed only if not yet set.
        if (this._logMinFreq === undefined) {
            this._logMinFreq = Math.log10(minFreq);
            this._logFreqSpan = Math.log10(maxFreq) - this._logMinFreq;
        }
        const logMinFreq = this._logMinFreq;
        const logFreqSpan = this._logFreqSpan;

        // --- Frequency Grid Lines (Vertical) ---
        const freqLines = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
        freqLines.forEach(freq => {
            // Calculate x position on a logarithmic scale
            const x = width * (Math.log10(freq) - logMinFreq) / logFreqSpan;
            // Draw the vertical line
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();

            ctx.textAlign = 'center';
            const label = freq >= 1000 ? `${freq / 1000}k` : freq; // Use 'k' for kHz
            ctx.fillText(label, x, height - 50); // Position labels near the bottom
        });

        // --- Gain Grid Lines (Horizontal) ---
        const gainLines = [-6, 0, 6];
        gainLines.forEach(gain => {
            // Calculate y position on a linear scale
            const y = height * (1 - (gain - minGain) / gainRange);
            // Draw the horizontal line
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();

            // Add gain labels on the left
            ctx.textAlign = 'right';
            ctx.fillText(`${gain}dB`, 80, y + 8); // Adjust position for readability
        });

        // --- Calculate Frequency Points for Curve Plotting ---
        // The frequency axis is static (minFreq/maxFreq are constants), so the
        // sample-frequency array, its log values, and the constant zero-gains
        // fallback array are all built once and reused. Previously, ~1000
        // Float entries were freshly allocated every frame (60 Hz), which was
        // the dominant main-thread allocation site on low-power hardware.
        const numPoints = 500;
        if (!this._freqPoints || this._freqPoints.length !== numPoints + 1) {
            const fp = new Float64Array(numPoints + 1);
            const ratio = maxFreq / minFreq;
            for (let i = 0; i <= numPoints; i++) {
                fp[i] = minFreq * Math.pow(ratio, i / numPoints);
            }
            this._freqPoints = fp;
        }
        if (!this._zeroGains || this._zeroGains.length !== this.numBands) {
            this._zeroGains = new Float64Array(this.numBands);
        }
        const freqPoints = this._freqPoints;

        // --- Draw Static Curves for Selected Band (if enabled) ---
        if (this.currentBandIndex >= 0 && this.currentBandIndex < this.numBands) {
            const band = this.bs[this.currentBandIndex];
            if (band.en) { // Only draw if the selected band is enabled
                // 1. Draw Sidechain Filter Curve (Gray)
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(180, 180, 180, 0.8)'; // Gray color
                ctx.lineWidth = 2;
                for (let i = 0; i < freqPoints.length; i++) {
                    const freq = freqPoints[i];
                    // Calculate bandpass response (at 0dB gain, slightly amplified for visualization)
                    const gain = this._calculateBandResponse(freq, band.scf, 0, band.scq, 'bp');
                    const x = width * (Math.log10(freq) - logMinFreq) / logFreqSpan;
                    const y = height * (1 - (gain - minGain) / gainRange);
                    if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
                }
                ctx.stroke();

                // 2. Draw Static EQ Curve (Light Green, representing potential max/min gain effect)
                ctx.beginPath();
                ctx.strokeStyle = 'rgba(120, 220, 120, 0.8)'; // Light green color
                ctx.lineWidth = 2;
                // Determine the static gain based on ratio (expander/compressor) and max gain setting
                // Ratio < 1 (Expander) -> positive max gain (peak)
                // Ratio >= 1 (Compressor) -> negative max gain (dip)
                const staticGain = band.r < 1 ? band.mg : -band.mg;
                for (let i = 0; i < freqPoints.length; i++) {
                    const freq = freqPoints[i];
                    const gain = this._calculateBandResponse(freq, band.f, staticGain, band.q, band.ft);
                    const x = width * (Math.log10(freq) - logMinFreq) / logFreqSpan;
                    const y = height * (1 - (gain - minGain) / gainRange);
                    if (i === 0) { ctx.moveTo(x, y); } else { ctx.lineTo(x, y); }
                }
                ctx.stroke();
            }
        }

        // --- Draw the Dynamic Combined Response Curve (Bright Green) ---
        // Get the latest smoothed gains from the audio processor, or fall
        // back to the cached zero array if not available yet.
        const currentGains = (this.latestSmoothedGains && this.latestSmoothedGains.length === this.numBands)
                        ? this.latestSmoothedGains
                        : this._zeroGains;

        // Compute and stroke the curve in a single pass; the per-point
        // response is no longer materialized into a temporary array.
        ctx.beginPath();
        ctx.strokeStyle = '#00ff00'; // Bright green (like PEQ)
        ctx.lineWidth = 3;
        for (let i = 0; i < freqPoints.length; i++) {
            const freq = freqPoints[i];
            let totalResponse = 0;
            for (let bandIdx = 0; bandIdx < this.numBands; bandIdx++) {
                const band = this.bs[bandIdx];
                if (!band.en) continue;
                totalResponse += this._calculateBandResponse(freq, band.f, currentGains[bandIdx], band.q, band.ft);
            }
            const x = width * (Math.log10(freq) - logMinFreq) / logFreqSpan;
            const y = height * (1 - (totalResponse - minGain) / gainRange);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();

        // --- Draw Axis Labels ---
        ctx.fillStyle = '#fff'; // Use white for axis labels for clarity
        ctx.font = '20px Arial'; // Match grid label font size
        ctx.textAlign = 'center';

        // Draw "Frequency (Hz)" label at the bottom center
        ctx.fillText('Frequency (Hz)', width / 2, height - 5);

        // Draw "Level (dB)" label vertically on the left side
        ctx.save(); // Save current context state
        ctx.translate(15, height / 2); // Move origin to the left-center edge
        ctx.rotate(-Math.PI / 2); // Rotate text to be vertical
        ctx.textAlign = 'center'; // Ensure text is centered after rotation
        ctx.fillText('Level (dB)', 0, 0);
        ctx.restore(); // Restore context state
    }

    updateUI() {
        // Update checkboxes to reflect internal state
        if (this.bandEnableCheckboxes) {
            this.bandEnableCheckboxes.forEach((checkbox, i) => {
                if (checkbox && checkbox.checked !== this.bs[i].en) {
                    checkbox.checked = this.bs[i].en;
                }
            });
        }
        
        // Update tab appearances
        if (this.bandTabs) {
            this.bandTabs.forEach((tab, i) => {
                tab.classList.toggle('active', i === this.currentBandIndex);
                tab.classList.toggle('disabled', !this.bs[i].en);
            });
        }
        
        // Update content pane visibility
        if (this.bandContentPanes) {
            this.bandContentPanes.forEach((pane, i) => {
                pane.classList.toggle('active', i === this.currentBandIndex);
            });
        }
        
        // Update parameter values in all panes
        if (this.bandContentPanes) {
            for (let bandIndex = 0; bandIndex < this.numBands; bandIndex++) {
                const pane = this.bandContentPanes[bandIndex];
                if (!pane) continue;
                
                const band = this.bs[bandIndex];
                
                // Update Filter Type dropdown
                const ftSelect = pane.querySelector(`#${this.instanceId}-band${bandIndex}-ft-select`);
                if (ftSelect) ftSelect.value = band.ft;
                
                // Update sliders and number inputs
                const updateNamedControl = (name, sliderValue, displayValue) => {
                    const slider = pane.querySelector(`#${this.instanceId}-band${bandIndex}-${name.replace(/[() ]/g, '')}-slider`);
                    const numberInput = pane.querySelector(`#${this.instanceId}-band${bandIndex}-${name.replace(/[() ]/g, '')}-input`);
                    
                    if (slider) slider.value = sliderValue;
                    if (numberInput) numberInput.value = displayValue;
                };
                
                // Frequency parameter - integer display
                updateNamedControl(
                    'Frequency (Hz)', 
                    this._logFreqToSlider(band.f), 
                    Math.round(band.f)
                );
                
                // Q parameter - one decimal place
                updateNamedControl(
                    'Q', 
                    band.q, 
                    band.q.toFixed(1)
                );
                
                // Max gain parameter - one decimal place
                updateNamedControl(
                    'Max Gain (dB)', 
                    band.mg, 
                    band.mg.toFixed(1)
                );
                
                // Threshold parameter - one decimal place
                updateNamedControl(
                    'Threshold (dB)', 
                    band.th, 
                    band.th.toFixed(1)
                );
                
                // Ratio parameter - linear ratio value with precision formatting
                updateNamedControl(
                    'Ratio', 
                    this._ratioToSlider(band.r),
                    band.r.toPrecision(3)
                );
                
                // Attack parameter - one decimal place
                updateNamedControl(
                    'Attack (ms)', 
                    band.a, 
                    band.a.toFixed(1)
                );
                
                // Release parameter - integer display
                updateNamedControl(
                    'Release (ms)', 
                    band.rl, 
                    Math.round(band.rl)
                );
                
                // Knee width parameter - one decimal place
                updateNamedControl(
                    'Knee Width (dB)', 
                    band.kn, 
                    band.kn.toFixed(1)
                );
                
                // Sidechain frequency parameter - integer display
                updateNamedControl(
                    'SC Freq. (Hz)', 
                    this._logFreqToSlider(band.scf), 
                    Math.round(band.scf)
                );
                
                // Sidechain Q parameter - one decimal place
                updateNamedControl(
                    'SC Q', 
                    band.scq, 
                    band.scq.toFixed(1)
                );
            }
        }
        
        // Redraw graph
        this._drawGraph();
    }

    // --- Animation Loop for Dynamic Graph ---
    startAnimation() {
        if (this.animationFrameId) return; // Already running
        if (!this.enabled || !this._sectionEnabled) return; // Skip if disabled or section is off.
        if (this.isVisible === false) return;                // Skip if off-screen.
        const animate = () => {
            if (this.isVisible === false) {
                this.stopAnimation();
                return;
            }
            this._drawGraph();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        this.animationFrameId = requestAnimationFrame(animate);
    }

    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }


    // --- Cleanup ---
    cleanup() {
        this.stopAnimation();
        if (this.resizeObserver) {
             this.resizeObserver.disconnect(); // Disconnect observer
             this.resizeObserver = null;
        }
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.canvas = null;
        this.ctx = null;
        super.cleanup();
    }

    // --- Audio Processor Communication ---
    onMessage(message) {
        // Handle messages from the audio processor, e.g., updated dynamic gain levels
        if (message.type === 'processBuffer' && message.measurements && message.measurements.gains) {
             this.latestSmoothedGains = message.measurements.gains;
        }
    }

    // --- Graph Helper Methods ---
    _getBiquadMagnitude(freq, sampleRate, coeffs) {
        if (!coeffs) return 0;
        const { b0 = 1, b1 = 0, b2 = 0, a1 = 0, a2 = 0 } = coeffs;
        const w = 2 * Math.PI * freq / sampleRate;
        const cos_w = Math.cos(w);
        const cos_2w = 2 * cos_w * cos_w - 1;
        const realNum = b0 + b1 * cos_w + b2 * cos_2w;
        const imagNumCoeff1 = b1 + 2 * b2 * cos_w;
        const realDen = 1 + a1 * cos_w + a2 * cos_2w;
        const imagDenCoeff1 = a1 + 2 * a2 * cos_w;

        let numMagSq, denMagSq;
        if (Math.abs(Math.sin(w)) < 1e-6) {
            numMagSq = realNum * realNum;
            denMagSq = realDen * realDen;
        } else {
            const sin_w = Math.sin(w);
            const imagNum = sin_w * imagNumCoeff1;
            const imagDen = sin_w * imagDenCoeff1;
            numMagSq = realNum * realNum + imagNum * imagNum;
            denMagSq = realDen * realDen + imagDen * imagDen;
        }

        if (denMagSq < 1e-20) return -400;

        const linearGain = Math.sqrt(numMagSq / denMagSq);
        return 20 * Math.log10(Math.max(linearGain, 1e-10));
    }

    _calculateCoeffs(type, f, Q, gainDB, sampleRate = 96000) {
       const w0 = 2 * Math.PI * f / sampleRate;
       const cos_w0 = Math.cos(w0);
       const sin_w0 = Math.sin(w0);
       const safeQ = Math.max(0.01, Q);
       const alpha = sin_w0 / (2 * safeQ);

       let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

        if (Math.abs(gainDB) < 0.01 && (type === 'pk' || type === 'ls' || type === 'hs')) {
             return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
         }

       switch (type) {
           case 'pk':
               const A_pk = Math.pow(10, gainDB / 40);
               if (A_pk === 1) { b0=1; b1=0; b2=0; a1=0; a2=0; break; }
               b0 =   1 + alpha * A_pk;
               b1 =  -2 * cos_w0;
               b2 =   1 - alpha * A_pk;
               a0 =   1 + alpha / A_pk;
               a1 =  -2 * cos_w0;
               a2 =   1 - alpha / A_pk;
               break;
           case 'ls':
                const A_ls = Math.pow(10, gainDB / 20);
                if (A_ls === 1) { b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; break; }
                const term_ls = (A_ls*A_ls + 1)/safeQ - (A_ls-1)*(A_ls-1);
                const betaLS = Math.sqrt(A_ls) * Math.sqrt(Math.max(0, term_ls));
                b0 =    A_ls * ((A_ls + 1) - (A_ls - 1) * cos_w0 + betaLS * sin_w0);
                b1 =  2 * A_ls * ((A_ls - 1) - (A_ls + 1) * cos_w0);
                b2 =    A_ls * ((A_ls + 1) - (A_ls - 1) * cos_w0 - betaLS * sin_w0);
                a0 =           (A_ls + 1) + (A_ls - 1) * cos_w0 + betaLS * sin_w0;
                a1 =   -2 * ((A_ls - 1) + (A_ls + 1) * cos_w0);
                a2 =           (A_ls + 1) + (A_ls - 1) * cos_w0 - betaLS * sin_w0;
               break;
           case 'hs':
                const A_hs = Math.pow(10, gainDB / 20);
                if (A_hs === 1) { b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0; break; }
                const term_hs = (A_hs*A_hs + 1)/safeQ - (A_hs-1)*(A_hs-1);
                const betaHS = Math.sqrt(A_hs) * Math.sqrt(Math.max(0, term_hs));
                b0 =    A_hs * ((A_hs + 1) + (A_hs - 1) * cos_w0 + betaHS * sin_w0);
                b1 = -2 * A_hs * ((A_hs - 1) + (A_hs + 1) * cos_w0);
                b2 =    A_hs * ((A_hs + 1) + (A_hs - 1) * cos_w0 - betaHS * sin_w0);
                a0 =           (A_hs + 1) - (A_hs - 1) * cos_w0 + betaHS * sin_w0;
                a1 =       2 * ((A_hs - 1) - (A_hs + 1) * cos_w0);
                a2 =           (A_hs + 1) - (A_hs - 1) * cos_w0 - betaHS * sin_w0;
               break;
            case 'bp':
                b0 =   alpha;
                b1 =   0;
                b2 =  -alpha;
                a0 =   1 + alpha;
                a1 =  -2 * cos_w0;
                a2 =   1 - alpha;
                break;
            case 'lp':
                b0 = (1 - cos_w0) / 2;
                b1 = 1 - cos_w0;
                b2 = (1 - cos_w0) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cos_w0;
                a2 = 1 - alpha;
                break;
            case 'hp':
                b0 = (1 + cos_w0) / 2;
                b1 = -(1 + cos_w0);
                b2 = (1 + cos_w0) / 2;
                a0 = 1 + alpha;
                a1 = -2 * cos_w0;
                a2 = 1 - alpha;
                break;
           default:
               b0 = 1; b1 = 0; b2 = 0; a1 = 0; a2 = 0;
               break;
       }

       const norm = (a0 === 0 || !isFinite(a0)) ? 1 : a0;
        if (norm === 0) {
           console.warn(`Warning: a0 is zero for filter calculation ${type}, f=${f}, Q=${Q}, gain=${gainDB}`);
            return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
       }

        const finalCoeffs = {
            b0: b0/norm, b1: b1/norm, b2: b2/norm, a1: a1/norm, a2: a2/norm
        };

        for (const key in finalCoeffs) {
           if (!isFinite(finalCoeffs[key])) {
               console.warn(`Warning: Coefficient ${key} is NaN/Infinity for filter ${type}, f=${f}, Q=${Q}, gain=${gainDB}. Resetting to flat.`);
               return { b0: 1, b1: 0, b2: 0, a1: 0, a2: 0 };
           }
        }

       return finalCoeffs;
    }

    // Helper method to calculate band response like in PEQ
    _calculateBandResponse(freq, bandFreq, bandGain, bandQ, bandType) {
        const sampleRate = this.sampleRate || 96000;
        const w0 = 2 * Math.PI * bandFreq / sampleRate;
        const w = 2 * Math.PI * freq / sampleRate;
        const Q = (bandType === 'ls' || bandType === 'hs') ? 0.7071 : bandQ; // Match PEQ's shelf Q
        const alpha = Math.sin(w0) / (2 * Q);
        const cosw0 = Math.cos(w0);
        const A = Math.pow(10, bandGain / 40);
        let b0, b1, b2, a0, a1, a2;
        
        // Bypass if gain is negligible and not a filter type
        if (Math.abs(bandGain) < 0.01 && !['lp', 'hp', 'bp'].includes(bandType)) {
            b0 = 1; b1 = 0; b2 = 0; a0 = 1; a1 = 0; a2 = 0;
        } else {
            switch (bandType) {
                case 'pk': // Peaking EQ
                    b0 = 1 + alpha * A;
                    b1 = -2 * cosw0;
                    b2 = 1 - alpha * A;
                    a0 = 1 + alpha / A;
                    a1 = -2 * cosw0;
                    a2 = 1 - alpha / A;
                    break;
                case 'ls': // Low Shelf
                    const shelfAlpha_ls = 2 * Math.sqrt(A) * alpha;
                    b0 = A * ((A + 1) - (A - 1) * cosw0 + shelfAlpha_ls);
                    b1 = 2 * A * ((A - 1) - (A + 1) * cosw0);
                    b2 = A * ((A + 1) - (A - 1) * cosw0 - shelfAlpha_ls);
                    a0 = (A + 1) + (A - 1) * cosw0 + shelfAlpha_ls;
                    a1 = -2 * ((A - 1) + (A + 1) * cosw0);
                    a2 = (A + 1) + (A - 1) * cosw0 - shelfAlpha_ls;
                    break;
                case 'hs': // High Shelf
                    const shelfAlpha_hs = 2 * Math.sqrt(A) * alpha;
                    b0 = A * ((A + 1) + (A - 1) * cosw0 + shelfAlpha_hs);
                    b1 = -2 * A * ((A - 1) + (A + 1) * cosw0);
                    b2 = A * ((A + 1) + (A - 1) * cosw0 - shelfAlpha_hs);
                    a0 = (A + 1) - (A - 1) * cosw0 + shelfAlpha_hs;
                    a1 = 2 * ((A - 1) - (A + 1) * cosw0);
                    a2 = (A + 1) - (A - 1) * cosw0 - shelfAlpha_hs;
                    break;
                case 'bp': // Band Pass
                    b0 = alpha;
                    b1 = 0;
                    b2 = -alpha;
                    a0 = 1 + alpha;
                    a1 = -2 * cosw0;
                    a2 = 1 - alpha;
                    break;
                case 'lp': // Low Pass
                    b0 = (1 - cosw0) / 2;
                    b1 = 1 - cosw0;
                    b2 = (1 - cosw0) / 2;
                    a0 = 1 + alpha;
                    a1 = -2 * cosw0;
                    a2 = 1 - alpha;
                    break;
                case 'hp': // High Pass
                    b0 = (1 + cosw0) / 2;
                    b1 = -(1 + cosw0);
                    b2 = (1 + cosw0) / 2;
                    a0 = 1 + alpha;
                    a1 = -2 * cosw0;
                    a2 = 1 - alpha;
                    break;
                default:
                    return 0;
            }
        }
        
        // Evaluate the response on the unit circle using z-transform (match PEQ)
        const cosw = Math.cos(w);
        const sinw = Math.sin(w);
        const z1_re = cosw;
        const z1_im = -sinw;
        const z2_re = cosw * cosw - sinw * sinw;
        const z2_im = -2 * cosw * sinw;
        const num_re = b0 + b1 * z1_re + b2 * z2_re;
        const num_im = b1 * z1_im + b2 * z2_im;
        const den_re = a0 + a1 * z1_re + a2 * z2_re;
        const den_im = a1 * z1_im + a2 * z2_im;
        const den_mag_sq = den_re * den_re + den_im * den_im;
        const H_re = (num_re * den_re + num_im * den_im) / den_mag_sq;
        const H_im = (num_im * den_re - num_re * den_im) / den_mag_sq;
        
        return 20 * Math.log10(Math.sqrt(H_re * H_re + H_im * H_im));
    }
}

// Register the plugin globally
window.FiveBandDynamicEQ = FiveBandDynamicEQ;
