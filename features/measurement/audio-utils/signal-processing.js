/**
 * Audio signal processing functions
 */

import FFT from './fft.js';
import { smoothFrequencyResponse as smoothSharedFrequencyResponse } from '../../../js/utils/measurement-dsp/smoothing.js';

/**
 * Perform FFT on time-domain signal using optimized Cooley-Tukey algorithm
 * @param {Float32Array} timeDomainData - Time domain signal
 * @param {number} sampleRate - Sample rate in Hz
 * @param {boolean} normalizeWithLastSweep - Whether to normalize with the last sweep's frequency response
 * @returns {Array} Array of [frequency, magnitude] pairs
 */
function calculateFFT(timeDomainData, sampleRate = 48000, normalizeWithLastSweep = false) {
    // Check for null or empty input data
    if (!timeDomainData || timeDomainData.length === 0) {
        console.warn('Invalid or empty time domain data provided to calculateFFT');
        return [];
    }
    
    // Find FFT size as power of 2 (2^n)
    const size = Math.pow(2, Math.ceil(Math.log2(timeDomainData.length)));
    
    // Create FFT instance
    const fft = new FFT(size);
    
    // Create input and output arrays
    const realIn = new Float32Array(size);
    const imagIn = new Float32Array(size);
    const realOut = new Float32Array(size);
    const imagOut = new Float32Array(size);
    
    // Apply window function and copy input data
    const windowBuffer = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        realIn[i] = i < timeDomainData.length 
            ? timeDomainData[i]
            : 0;
    }
    
    // Perform the FFT
    fft.transform(realOut, imagOut, realIn, imagIn);
    
    // Calculate magnitude response
    const fftHalfSize = size >> 1;
    const frequencyResponse = [];
    
    // Calculate correction factors
    const fftSizeCorrection = -20 * Math.log10(size);
    const windowPowerCorrection = 10 * Math.log10(8 / 3);
    const singleSideCorrection = 10 * Math.log10(2);
    const totalCorrection = fftSizeCorrection + windowPowerCorrection + singleSideCorrection;
    
    // For efficiency, use logarithmic spacing for frequency points.
    // Use the sweep band when available so analysis matches what was actually played.
    const minFreq = this.sweepMinFreq || 20;
    const maxFreq = this.sweepMaxFreq || 20000;
    const octaveDivisions = 48; // Points per octave
    
    const minLog = Math.log2(minFreq);
    const maxLog = Math.log2(maxFreq);
    const logRange = maxLog - minLog;
    const numPoints = Math.ceil(logRange * octaveDivisions);
    
    // Normalization reference data
    let sweepResponseMap = null;
    if (normalizeWithLastSweep && this.lastSweepFrequencyResponse && this.lastSweepFrequencyResponse.length > 0) {
        // Convert the last sweep frequency response to a Map for faster lookups
        sweepResponseMap = new Map();
        
        // Check if the response is valid
        let validResponse = true;
        
        // Check data format - could be array of objects or array of arrays
        const isObjectFormat = this.lastSweepFrequencyResponse[0] && 
                             typeof this.lastSweepFrequencyResponse[0] === 'object' &&
                             'frequency' in this.lastSweepFrequencyResponse[0] &&
                             'magnitude' in this.lastSweepFrequencyResponse[0];
                             
        if (isObjectFormat) {
            // Handle object format: [{frequency, magnitude}, ...]
            for (const point of this.lastSweepFrequencyResponse) {
                const freq = point.frequency;
                const db = point.magnitude;
                
                if (isNaN(freq) || isNaN(db) || !isFinite(freq) || !isFinite(db)) {
                    validResponse = false;
                    break;
                }
                sweepResponseMap.set(freq, db);
            }
        } else {
            // Handle array format: [[freq, db], ...]
            for (const entry of this.lastSweepFrequencyResponse) {
                if (!Array.isArray(entry) || entry.length !== 2) {
                    validResponse = false;
                    break;
                }
                
                const [freq, db] = entry;
                if (isNaN(freq) || isNaN(db) || !isFinite(freq) || !isFinite(db)) {
                    validResponse = false;
                    break;
                }
                sweepResponseMap.set(freq, db);
            }
        }
        
        if (!validResponse) {
            console.warn("Invalid sweep frequency response detected, disabling normalization");
            sweepResponseMap = null;
        } else {
            console.log(`Normalizing with TSP frequency response (${this.lastSweepFrequencyResponse.length} points)`);
        }
    }
    
    // Pre-calculate all magnitude values first to avoid multiple FFT bin lookups
    const allBinMagnitudes = new Float32Array(fftHalfSize);
    for (let i = 1; i < fftHalfSize; i++) {
        const real = realOut[i];
        const imag = imagOut[i];
        // Calculate power and convert to dB
        const rawPower = real * real + imag * imag;
        allBinMagnitudes[i] = 10 * Math.log10(rawPower + 1e-24) + totalCorrection;
    }
    
    for (let i = 0; i < numPoints; i++) {
        // Calculate logarithmically spaced frequency
        const t = i / (numPoints - 1);
        const logFreq = minLog + t * logRange;
        const freq = Math.pow(2, logFreq);
        
        // Find closest FFT bin
        const binIndex = Math.round(freq * size / sampleRate);
        if (binIndex >= fftHalfSize || binIndex < 1) continue;
        
        // Get magnitude from pre-calculated array
        let db = allBinMagnitudes[binIndex];
        
        // Apply normalization if needed
        if (normalizeWithLastSweep && sweepResponseMap) {
            // Find nearest frequencies for interpolation
            const nearestFreqs = this.findNearestFrequencies(freq, Array.from(sweepResponseMap.keys()));
            
            if (nearestFreqs.length === 2) {
                // Logarithmic interpolation for frequencies
                const [f1, f2] = nearestFreqs;
                const db1 = sweepResponseMap.get(f1);
                const db2 = sweepResponseMap.get(f2);
                
                // Calculate interpolation position in log scale
                const logF = Math.log10(freq);
                const logF1 = Math.log10(f1);
                const logF2 = Math.log10(f2);
                
                // Calculate interpolation factor (0-1)
                const t = (logF - logF1) / (logF2 - logF1);
                
                // Interpolate the TSP response level
                const sweepDb = db1 + t * (db2 - db1);
                
                // Subtract the TSP response to normalize (division in dB scale)
                db -= sweepDb;
            } else if (nearestFreqs.length === 1) {
                // Exact match or only one nearest frequency
                db -= sweepResponseMap.get(nearestFreqs[0]);
            }
        }
        
        frequencyResponse.push([freq, db]);
    }
    
    // Post-process the frequency response to ensure smoothness
    if (frequencyResponse.length > 0) {
        // Apply a simple smoothing to reduce noise
        const smoothedResponse = [];
        const smoothingRadius = 2;
        
        for (let i = 0; i < frequencyResponse.length; i++) {
            const [freq, _] = frequencyResponse[i];
            let sum = 0;
            let count = 0;
            
            // Average the neighboring points
            for (let j = Math.max(0, i - smoothingRadius); j <= Math.min(frequencyResponse.length - 1, i + smoothingRadius); j++) {
                sum += frequencyResponse[j][1];
                count++;
            }
            
            smoothedResponse.push([freq, sum / count]);
        }
        
        return smoothedResponse;
    }
    
    return frequencyResponse;
}

/**
 * Calculate frequency response with 0.01 octave spacing and apply gaussian smoothing
 * @param {Float32Array} timeDomainData - Time domain input signal 
 * @param {number} sampleRate - Sample rate in Hz
 * @param {boolean} normalizeWithLastSweep - Whether to normalize with the last sweep
 * @param {number} octaveSmoothing - Smoothing factor in octaves (default: 0.005)
 * @returns {Array} Array of [frequency, magnitude] pairs with 0.01 octave spacing
 */
function calculateFrequencyResponseWithSmoothing(timeDomainData, sampleRate = 48000, normalizeWithLastSweep = false, octaveSmoothing = 0.005) {
    // Check for null or empty input data
    if (!timeDomainData || timeDomainData.length === 0) {
        console.warn('Invalid or empty time domain data provided to calculateFrequencyResponseWithSmoothing');
        return [];
    }
    
    // First calculate the raw FFT response
    const rawResponse = this.calculateFFT(timeDomainData, sampleRate, normalizeWithLastSweep);
    
    // Check if raw response is valid
    if (!rawResponse || rawResponse.length === 0) {
        console.warn('No frequency response data calculated');
        return [];
    }
    
    // Apply gaussian smoothing to raw data first
    console.log(`Applying gaussian smoothing with sigma: ${octaveSmoothing} octaves`);
    const smoothedRawResponse = this.smoothFrequencyResponse(rawResponse, octaveSmoothing);
    
    // Apply 0.01 octave spacing (100 points per decade)
    const octaveSpacing = 0.01;
    const minFreq = this.sweepMinFreq || 20;
    const maxFreq = this.sweepMaxFreq || 20000;
    
    // Calculate number of points needed
    const minLog = Math.log10(minFreq);
    const maxLog = Math.log10(maxFreq);
    const decades = maxLog - minLog;
    const pointsPerDecade = Math.ceil(1 / octaveSpacing * 10 / 3); // Convert from octaves to decades
    const numPoints = Math.ceil(decades * pointsPerDecade);
    
    console.log(`Generating frequency response with: ${pointsPerDecade} points per decade, total ${numPoints} points`);
    console.log(`Octave spacing: ${octaveSpacing}, smoothing factor: ${octaveSmoothing}`);
    
    // Create frequency grid with 0.01 octave spacing
    const frequencies = [];
    for (let i = 0; i < numPoints; i++) {
        const t = i / (numPoints - 1);
        const logFreq = minLog + t * decades;
        frequencies.push(Math.pow(10, logFreq));
    }
    
    // Interpolate the smoothed response to the new frequency grid
    const interpolatedResponse = frequencies.map(freq => {
        // Extract frequencies from the response data
        // This needs to handle both array format [freq, db] and object format {frequency, magnitude}
        const freqValues = smoothedRawResponse.map(point => {
            // Determine format type and extract frequency
            if (Array.isArray(point)) {
                return point[0]; // Array format: [freq, db]
            } else if (typeof point === 'object' && 'frequency' in point) {
                return point.frequency; // Object format: {frequency, magnitude}
            }
            return 0; // Invalid format, shouldn't happen
        });
        
        // Find nearest frequencies for interpolation
        const nearestFreqs = this.findNearestFrequencies(freq, freqValues);
        
        if (nearestFreqs.length === 2) {
            // Get indices of the nearest frequencies
            const idx1 = freqValues.indexOf(nearestFreqs[0]);
            const idx2 = freqValues.indexOf(nearestFreqs[1]);
            
            // Get the frequency and magnitude values
            let f1, f2, db1, db2;
            
            if (Array.isArray(smoothedRawResponse[idx1])) {
                // Array format
                f1 = smoothedRawResponse[idx1][0];
                f2 = smoothedRawResponse[idx2][0];
                db1 = smoothedRawResponse[idx1][1];
                db2 = smoothedRawResponse[idx2][1];
            } else {
                // Object format
                f1 = smoothedRawResponse[idx1].frequency;
                f2 = smoothedRawResponse[idx2].frequency;
                db1 = smoothedRawResponse[idx1].magnitude;
                db2 = smoothedRawResponse[idx2].magnitude;
            }
            
            // Logarithmic interpolation
            const logF = Math.log10(freq);
            const logF1 = Math.log10(f1);
            const logF2 = Math.log10(f2);
            
            // Calculate interpolation factor
            const t = (logF - logF1) / (logF2 - logF1);
            
            // Interpolate the magnitude
            const db = db1 + t * (db2 - db1);
            
            return [freq, db];
        } else if (nearestFreqs.length === 1) {
            // Exact match or edge case
            const idx = freqValues.indexOf(nearestFreqs[0]);
            
            let db;
            if (Array.isArray(smoothedRawResponse[idx])) {
                db = smoothedRawResponse[idx][1];
            } else {
                db = smoothedRawResponse[idx].magnitude;
            }
            
            return [freq, db];
        } else {
            // Should not happen, but return safe value
            return [freq, 0];
        }
    });
    
    // Return the interpolated response (already smoothed)
    return interpolatedResponse;
}

/**
 * Apply smoothing to frequency response
 * @param {Array} frequencyResponse - Array of [frequency, magnitude] pairs or {frequency, magnitude} objects
 * @param {number} sigma - Smoothing factor in octaves
 * @returns {Array} Smoothed frequency response
 */
function smoothFrequencyResponse(frequencyResponse, sigma = 0.3) {
    return smoothSharedFrequencyResponse(frequencyResponse, sigma);
}

/**
 * Perform synchronous averaging of multiple measurements
 * @param {Array<Float32Array>} measurements - Array of measurement impulse responses
 * @returns {Float32Array} Averaged measurement
 */
function synchronousAverage(measurements) {
    if (!measurements || measurements.length === 0) {
        return new Float32Array(0);
    }
    
    const length = measurements[0].length;
    const result = new Float32Array(length);
    
    // Sum all measurements
    for (let i = 0; i < measurements.length; i++) {
        const measurement = measurements[i];
        for (let j = 0; j < length; j++) {
            result[j] += measurement[j];
        }
    }
    
    // Divide by count to get average
    for (let i = 0; i < length; i++) {
        result[i] /= measurements.length;
    }
    
    return result;
}

/**
 * Export audio buffer as WAV file
 * @param {Float32Array} buffer - Audio buffer to export
 * @param {number} sampleRate - Sample rate
 * @param {string} filename - Output file name
 */
function exportWAV(buffer, sampleRate, filename) {
    // Create WAV file header
    const createWavHeader = (dataLength) => {
        const headerLength = 44;
        const header = new ArrayBuffer(headerLength);
        const view = new DataView(header);
        
        // RIFF chunk descriptor
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataLength, true);
        writeString(view, 8, 'WAVE');
        
        // fmt sub-chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // fmt chunk size
        view.setUint16(20, 3, true);  // audio format (3 for IEEE float)
        view.setUint16(22, 1, true);  // number of channels (mono)
        view.setUint32(24, sampleRate, true); // sample rate
        view.setUint32(28, sampleRate * 4, true); // byte rate (sample rate * block align)
        view.setUint16(32, 4, true);  // block align (channels * bits per sample / 8)
        view.setUint16(34, 32, true); // bits per sample
        
        // data sub-chunk
        writeString(view, 36, 'data');
        view.setUint32(40, dataLength, true); // data chunk size
        
        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }
        
        return header;
    };
    
    // Calculate data length in bytes
    const dataLength = buffer.length * 4; // 4 bytes per float32 sample
    const header = createWavHeader(dataLength);
    const wavFile = new ArrayBuffer(header.byteLength + dataLength);
    const wavView = new DataView(wavFile);
    
    // Copy header
    new Uint8Array(wavFile, 0, header.byteLength).set(new Uint8Array(header));
    
    // Copy audio data as 32-bit float PCM
    // Make sure we're using little-endian format (true as the third parameter)
    for (let i = 0; i < buffer.length; i++) {
        wavView.setFloat32(header.byteLength + i * 4, buffer[i], true);
    }
    
    // Create and trigger download
    const blob = new Blob([wavFile], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'audio.wav';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

export {
    calculateFFT,
    calculateFrequencyResponseWithSmoothing,
    smoothFrequencyResponse,
    synchronousAverage,
    exportWAV
};
