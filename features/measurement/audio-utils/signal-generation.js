/**
 * Audio signal generation functions
 */

import FFT from './fft.js';

/**
 * Start white noise playback
 * @param {number} level - Noise level in dB (0 to -36)
 * @param {string} outputDeviceId - The output device ID, or null for default
 * @param {string} channel - The channel to output to ('left', 'right', 'all', or specific channel number '3'-'8')
 * @param {number} minFreq - Lower band edge in Hz (default 1 = effectively unlimited)
 * @param {number} maxFreq - Upper band edge in Hz (default null = up to Nyquist)
 */
async function startWhiteNoise(level = -12, outputDeviceId = null, channel = 'all', minFreq = 1, maxFreq = null) {
    // Make sure any existing white noise is properly stopped first
    if (this.isWhiteNoiseActive) {
        this.stopWhiteNoise();
    }

    // Check if AudioContext exists
    if (!this.audioContext) {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (error) {
            return false;
        }
    }

    // Ensure audio context is running
    const contextReady = await this.ensureAudioContextRunning();
    if (!contextReady) {
        return false;
    }

    try {
        // Get the maximum channel count for the device
        const maxChannels = await this.getDeviceMaxChannelCount(outputDeviceId);
        console.log(`Using max channel count: ${maxChannels}`);

        // Use a power-of-two buffer length (~2 seconds) so we can FFT-band-limit in place.
        // AudioBufferSourceNode loops any length seamlessly; FFT treats the buffer as
        // periodic, so the band-limited result is continuous across loop boundaries.
        const sampleRate = this.audioContext.sampleRate;
        const bufferChannels = maxChannels;
        const bufferSize = 1 << Math.ceil(Math.log2(Math.max(2 * sampleRate, 2)));
        const noiseBuffer = this.audioContext.createBuffer(
            bufferChannels, bufferSize, sampleRate
        );

        // Determine the band-limit range. Apply Sinc-equivalent brick-wall
        // band-limiting only when the user actually requested a narrower band.
        const nyquist = sampleRate / 2;
        const nyquistLimit = Math.max(2, Math.floor(nyquist) - 1);
        const fLo = Math.max(1, Math.min(minFreq ?? 1, nyquistLimit - 1));
        const fHi = Math.max(fLo + 1, Math.min(maxFreq ?? nyquistLimit, nyquistLimit));
        const needsBandlimit = fLo > 1 || fHi < nyquistLimit;

        const halfBuf = bufferSize >>> 1;
        const kLo = Math.max(1, Math.floor(fLo * bufferSize / sampleRate));
        const kHi = Math.min(halfBuf - 1, Math.ceil(fHi * bufferSize / sampleRate));

        // Raised-cosine taper outside [kLo, kHi] for suppressing sinc ringing.
        // The specified band stays at unity gain; outside, a short skirt fades to 0.
        const bandBins = kHi - kLo + 1;
        const nominalTaperLen = 32;
        const taperCap = Math.max(4, Math.min(nominalTaperLen, Math.floor(bandBins / 2)));
        const taperLenLow = Math.min(taperCap, kLo - 1);
        const taperLenHigh = Math.min(taperCap, (halfBuf - 1) - kHi);

        const fft = needsBandlimit ? new FFT(bufferSize) : null;
        const realIn = needsBandlimit ? new Float32Array(bufferSize) : null;
        const imagIn = needsBandlimit ? new Float32Array(bufferSize) : null;
        const realOut = needsBandlimit ? new Float32Array(bufferSize) : null;
        const imagOut = needsBandlimit ? new Float32Array(bufferSize) : null;
        const tdReal = needsBandlimit ? new Float32Array(bufferSize) : null;
        const tdImag = needsBandlimit ? new Float32Array(bufferSize) : null;

        // Precompute the taper-weight mask once; it's the same for every channel.
        const weightMask = needsBandlimit ? new Float32Array(bufferSize) : null;
        if (needsBandlimit) {
            for (let k = 0; k < bufferSize; k++) {
                // Fold the mirror bin so the conjugate pair gets the same weight
                const kFold = k <= halfBuf ? k : bufferSize - k;
                let w;
                if (kFold >= kLo && kFold <= kHi) {
                    w = 1;
                } else if (kFold >= kLo - taperLenLow && kFold < kLo && taperLenLow > 0) {
                    const t = (kFold - (kLo - taperLenLow) + 1) / (taperLenLow + 1);
                    w = 0.5 * (1 - Math.cos(Math.PI * t));
                } else if (kFold > kHi && kFold <= kHi + taperLenHigh && taperLenHigh > 0) {
                    const t = ((kHi + taperLenHigh) - kFold + 1) / (taperLenHigh + 1);
                    w = 0.5 * (1 - Math.cos(Math.PI * t));
                } else {
                    w = 0;
                }
                weightMask[k] = w;
            }
        }

        // Fill buffer with white noise on all channels, optionally band-limited via FFT.
        for (let ch = 0; ch < bufferChannels; ch++) {
            const data = noiseBuffer.getChannelData(ch);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = Math.random() * 2 - 1;
            }

            if (!needsBandlimit) continue;

            // Forward FFT
            for (let i = 0; i < bufferSize; i++) {
                realIn[i] = data[i];
                imagIn[i] = 0;
            }
            fft.transform(realOut, imagOut, realIn, imagIn);

            // Apply raised-cosine mask: unity inside [kLo, kHi], tapered outside
            for (let k = 0; k < bufferSize; k++) {
                const w = weightMask[k];
                realOut[k] *= w;
                imagOut[k] *= w;
            }

            // Inverse FFT back to time domain
            fft.inverseTransform(tdReal, tdImag, realOut, imagOut);

            // Normalize peak to 0.9 to avoid clipping; narrowband noise has a higher crest factor
            let peak = 0;
            for (let i = 0; i < bufferSize; i++) {
                const v = Math.abs(tdReal[i]);
                if (v > peak) peak = v;
            }
            const norm = peak > 1e-9 ? 0.9 / peak : 1;
            for (let i = 0; i < bufferSize; i++) {
                data[i] = tdReal[i] * norm;
            }
        }
        
        // Create audio source from buffer
        this.whiteNoiseNode = this.audioContext.createBufferSource();
        this.whiteNoiseNode.buffer = noiseBuffer;
        this.whiteNoiseNode.loop = true;
        
        // Create gain node for level control
        this.whiteNoiseGain = this.audioContext.createGain();
        this.setNoiseLevel(level);

        // Create channel merger for multichannel output
        this.channelMerger = this.audioContext.createChannelMerger(maxChannels);
        
        // Reset all merger inputs (to silence)
        for (let ch = 0; ch < maxChannels; ch++) {
            const silenceNode = this.audioContext.createGain();
            silenceNode.gain.value = 0;
            silenceNode.connect(this.channelMerger, 0, ch);
        }
        
        // Handle different channel routing
        const targetChannel = parseInt(channel);
        
        // Determine where to connect the noise signal
        if (channel === 'left' || channel === '0') {
            // Route to left channel only
            this.whiteNoiseNode.connect(this.whiteNoiseGain);
            this.whiteNoiseGain.connect(this.channelMerger, 0, 0);
        } else if (channel === 'right' || channel === '1') {
            // Route to right channel only
            this.whiteNoiseNode.connect(this.whiteNoiseGain);
            this.whiteNoiseGain.connect(this.channelMerger, 0, 1);
        } else if (!isNaN(targetChannel) && targetChannel >= 2 && targetChannel < maxChannels) {
            // Route to specific channel (C3-C8)
            this.whiteNoiseNode.connect(this.whiteNoiseGain);
            this.whiteNoiseGain.connect(this.channelMerger, 0, targetChannel);
        } else {
            // Route to all channels (default)
            this.whiteNoiseNode.connect(this.whiteNoiseGain);
            
            // Connect to all available channels
            for (let ch = 0; ch < maxChannels; ch++) {
                this.whiteNoiseGain.connect(this.channelMerger, 0, ch);
            }
        }

        // Handle output device selection
        let audioDestination = this.audioContext.destination;
        
        // Set the channel count of the destination to match our max channels
        if (audioDestination.maxChannelCount) {
            try {
                // Set to maximum available channels
                const channelCount = Math.min(maxChannels, audioDestination.maxChannelCount);
                audioDestination.channelCount = channelCount;
                audioDestination.channelCountMode = 'explicit';
                audioDestination.channelInterpretation = 'discrete';
                console.log(`Set output channel count to ${channelCount}`);
            } catch (e) {
                console.warn('Error setting destination channel count:', e);
            }
        }

        // Device-specific output routing is temporarily disabled for stability
        if (outputDeviceId && false) {
            console.log('Device-specific output routing disabled for measurement stability');
        }
        
        // Connect merger to the destination
        this.channelMerger.connect(audioDestination);
        
        // Start playback
        this.whiteNoiseNode.start(0);
        this.isWhiteNoiseActive = true;
        
        // Add event listener for ended event
        this.whiteNoiseNode.onended = () => {
            this.isWhiteNoiseActive = false;
        };
        
        return true;
    } catch (error) {
        console.error('Error starting white noise:', error);
        this.isWhiteNoiseActive = false;
        return false;
    }
}

/**
 * Stop white noise playback
 */
function stopWhiteNoise() {
    // Only proceed if white noise is active
    if (!this.isWhiteNoiseActive) return;
    
    try {
        // Stop the noise source first
        if (this.whiteNoiseNode) {
            try {
                this.whiteNoiseNode.stop(0);
                this.whiteNoiseNode.disconnect();
            } catch (e) {
                console.warn('Error stopping/disconnecting white noise node:', e);
            }
            this.whiteNoiseNode = null;
        }
        
        // Disconnect gain node
        if (this.whiteNoiseGain) {
            try {
                this.whiteNoiseGain.disconnect();
            } catch (e) {
                console.warn('Error disconnecting white noise gain node:', e);
            }
            this.whiteNoiseGain = null;
        }
        
        // Disconnect channel merger
        if (this.channelMerger) {
            try {
                this.channelMerger.disconnect();
            } catch (e) {
                console.warn('Error disconnecting channel merger:', e);
            }
            this.channelMerger = null;
        }
        
        // Stop audio element if it exists
        if (this.whiteNoiseAudioElement) {
            try {
                this.whiteNoiseAudioElement.pause();
                this.whiteNoiseAudioElement.srcObject = null;
            } catch (e) {
                console.warn('Error stopping audio element:', e);
            }
            this.whiteNoiseAudioElement = null;
        }
        
        // Disconnect media stream destination if it exists
        if (this.whiteNoiseDestination) {
            try {
                this.whiteNoiseDestination.disconnect();
            } catch (e) {
                console.warn('Error disconnecting media stream destination:', e);
            }
            this.whiteNoiseDestination = null;
        }
        
        // Set flag
        this.isWhiteNoiseActive = false;
    } catch (error) {
        console.error('Error stopping white noise:', error);
    }
}

/**
 * Set white noise output level
 * @param {number} levelDb - White noise level in dB (0 to -36)
 * @returns {boolean} Whether the level was successfully set
 */
function setNoiseLevel(levelDb) {
    try {
        if (!this.whiteNoiseGain) {
            return false;
        }
        
        if (!this.isWhiteNoiseActive) {
            console.warn('Setting noise level while white noise is not active');
        }
        
        // Convert dB to linear gain (0dB = 1.0)
        const linearGain = Math.pow(10, levelDb / 20);
        
        // Apply gain
        this.whiteNoiseGain.gain.value = linearGain;
        
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * Generate a Time-Stretched Pulse (TSP) signal and its inverse filter
 * @param {number} length - Signal length in samples
 * @param {number} sampleRate - Sample rate in Hz
 * @param {string} channel - Output channel ('left', 'right', 'all', or specific channel number '2'-'7')
 * @param {number} minFreq - Lower frequency bound of the sweep in Hz (default 20)
 * @param {number} maxFreq - Upper frequency bound of the sweep in Hz (default 20000)
 * @returns {{left: Float32Array, right: Float32Array, length: number, frequencyResponse: Array, peakOffset: number,
 *   inverseFilter: Float32Array
 * }}
 */
function generateTSP(length = 65536, sampleRate = 48000, channel = 'all', minFreq = 20, maxFreq = 20000) {
    if (!this.initialized) {
        return null;
    }
    if (length <= 0 || sampleRate <= 0) {
        return null;
    }

    // Round up to the nearest power of 2
    const N = 1 << Math.ceil(Math.log2(length));
    const halfN = N >>> 1;

    // Clamp and sanitize band limits. Allow the usable range [1, Nyquist - 1] Hz.
    const nyquist = sampleRate / 2;
    const nyquistLimit = Math.max(2, Math.floor(nyquist) - 1);
    const fLo = Math.max(1, Math.min(minFreq, nyquistLimit - 1));
    const fHi = Math.max(fLo + 1, Math.min(maxFreq, nyquistLimit));

    // Record sweep band on the instance so analysis code can reference it
    this.sweepMinFreq = fLo;
    this.sweepMaxFreq = fHi;

    // Translate band limits to FFT bin indices
    const kLo = Math.max(1, Math.floor(fLo * N / sampleRate));
    const kHi = Math.min(halfN - 1, Math.ceil(fHi * N / sampleRate));

    // Compute raised-cosine taper lengths outside the flat band.
    // The specified band [kLo, kHi] stays at unity gain; outside, a short
    // cosine skirt replaces the brick-wall cut to suppress sinc-like time-domain
    // ringing that would otherwise be audible as edge-frequency tones.
    const bandBins = kHi - kLo + 1;
    const nominalTaperLen = 32;
    const taperCap = Math.max(4, Math.min(nominalTaperLen, Math.floor(bandBins / 2)));
    const taperLenLow = Math.min(taperCap, kLo - 1);
    const taperLenHigh = Math.min(taperCap, (halfN - 1) - kHi);
    const kLoExt = kLo - taperLenLow;
    const kHiExt = kHi + taperLenHigh;

    // Create frequency-domain representation of TSP signal
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    const invReal = new Float32Array(N);
    const invImag = new Float32Array(N);

    // Populate the extended range [kLoExt, kHiExt]. Inside [kLo, kHi] the weight
    // is 1; outside, a raised-cosine half window fades to 0 over taperLen bins.
    for (let k = kLoExt; k <= kHiExt; k++) {
        let w;
        if (k < kLo) {
            const t = (k - kLoExt + 1) / (taperLenLow + 1);
            w = 0.5 * (1 - Math.cos(Math.PI * t));
        } else if (k > kHi) {
            const t = (kHiExt - k + 1) / (taperLenHigh + 1);
            w = 0.5 * (1 - Math.cos(Math.PI * t));
        } else {
            w = 1;
        }

        // Phase function: -2πk²/N creates a quadratic phase shift
        // This results in a logarithmic frequency sweep when converted to time domain
        const phi = -2 * Math.PI * k * k / N;

        // Calculate sine and cosine values, weighted by the taper
        const c = w * Math.cos(phi);
        const s = w * Math.sin(phi);

        // Forward TSP (quadratic phase spectrum, tapered at band edges)
        real[k] = c;
        imag[k] = s;
        real[N - k] = c;       // Conjugate symmetric for real output
        imag[N - k] = -s;      // Negative for complex conjugate

        // Inverse filter (negative quadratic phase, same taper so product is w²)
        invReal[k] = c;
        invImag[k] = -s;       // Negative sign for inverse filter
        invReal[N - k] = c;    // Conjugate symmetric
        invImag[N - k] = s;    // Positive for complex conjugate
    }

    // Create FFT processor
    const fft = new FFT(N);
    
    // Allocate time-domain arrays
    const tdR = new Float32Array(N), tdI = new Float32Array(N);
    const ifR = new Float32Array(N), ifI = new Float32Array(N);

    // Transform to time domain
    fft.inverseTransform(tdR, tdI, real, imag);
    fft.inverseTransform(ifR, ifI, invReal, invImag);

    // Extract the real parts for the time-domain signals
    const tspSignal = new Float32Array(N);
    tspSignal.set(tdR);
    
    const inverseFilter = new Float32Array(N);
    inverseFilter.set(ifR);

    // Normalize TSP signal to target RMS level (-3dB)
    let sumSq = 0;
    for (let i = 0; i < N; i++) sumSq += tspSignal[i] * tspSignal[i];
    const rms = Math.sqrt(sumSq / N);
    const targetRms = Math.pow(10, -3 / 20); // -3dB
    let norm = rms > 1e-9 ? targetRms / rms : 1;

    // Narrowband TSPs can have a higher crest factor, so cap the peak below full scale
    let tspPeak = 0;
    for (let i = 0; i < N; i++) tspPeak = Math.max(tspPeak, Math.abs(tspSignal[i]));
    const peakCeiling = 0.95;
    if (tspPeak * norm > peakCeiling) {
        norm = peakCeiling / tspPeak;
    }
    for (let i = 0; i < N; i++) tspSignal[i] *= norm;

    // Normalize inverse filter to peak of 1.0
    let peak = 0;
    for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(inverseFilter[i]));
    const invNorm = peak > 1e-9 ? 1 / peak : 1;
    for (let i = 0; i < N; i++) inverseFilter[i] *= invNorm;

    // Get maximum number of channels this device might support
    const MAX_CHANNELS = 8;
    
    // Create output buffers for all possible channels
    const channelBuffers = [];
    for (let i = 0; i < MAX_CHANNELS; i++) {
        channelBuffers.push(new Float32Array(N));
    }
    
    // For backward compatibility
    const left = channelBuffers[0];
    const right = channelBuffers[1];
    
    // Convert legacy 'both' value to 'all'
    if (channel === 'both') {
        channel = 'all';
    }
    
    // Parse channel if it's a string number
    const targetChannel = parseInt(channel);
    
    // Copy TSP signal to specified channel(s)
    if (channel === 'left' || channel === '0') {
        // Left channel only
        left.set(tspSignal);
    } else if (channel === 'right' || channel === '1') {
        // Right channel only
        right.set(tspSignal);
    } else if (!isNaN(targetChannel) && targetChannel >= 2 && targetChannel < MAX_CHANNELS) {
        // Specific channel (Ch 3-8)
        channelBuffers[targetChannel].set(tspSignal);
    } else {
        // All channels (default)
        for (let i = 0; i < MAX_CHANNELS; i++) {
            channelBuffers[i].set(tspSignal);
        }
    }

    // Save the generated signals for future reference
    this.lastTspSignal = tspSignal;
    this.lastInverseFilter = inverseFilter;
    
    // Find the peak position for later synchronization
    let maxVal = 0;
    let maxPos = 0;
    for (let i = 0; i < N; i++) {
        if (Math.abs(tspSignal[i]) > maxVal) {
            maxVal = Math.abs(tspSignal[i]);
            maxPos = i;
        }
    }
    this.tspPeakOffset = maxPos;
    
    // Create a frequency response curve (flat for TSP) across the sweep band
    const freqResponseLength = 128;
    const freqResponse = new Array(freqResponseLength);
    const logRatio = Math.log10(fHi / fLo);
    for (let i = 0; i < freqResponseLength; i++) {
        freqResponse[i] = {
            frequency: fLo * Math.pow(10, i * logRatio / (freqResponseLength - 1)),
            magnitude: 0
        };
    }
    this.lastSweepFrequencyResponse = freqResponse;
    
    // Return buffer with all channels
    return {
        left,
        right,
        channels: channelBuffers,
        length: N,
        frequencyResponse: freqResponse,
        peakOffset: maxPos,
        inverseFilter
    };
}

/**
 * Apply a half-Hann window to reduce transients
 * @param {Float32Array} buffer - Audio buffer to apply window to
 */
function applyWindow(buffer) {
    const len = buffer.length;
    for (let i = 0; i < len; i++) {
        // Hann window: 0.5 * (1 - cos(2π × i/(N-1)))
        const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (len - 1)));
        buffer[i] *= window;
    }
    return buffer;
}

export {
    startWhiteNoise,
    stopWhiteNoise,
    setNoiseLevel,
    generateTSP,
    applyWindow
}; 