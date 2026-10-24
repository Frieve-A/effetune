/**
 * Audio signal generation functions
 */

import FFT from './fft.js';
import { createEssSignal } from '../../../js/utils/measurement-dsp/ess.js';
import { resolveSweepBand } from '../measurement-model.js';
import {
    MeasurementOutputError,
    prepareMeasurementOutputRoute,
    releaseMeasurementOutputRoute
} from './output-routing.js';

function validateSignalOutputChannel(channel) {
    const token = String(channel);
    if (!['left', 'right', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', 'all', 'both'].includes(token)) {
        throw new MeasurementOutputError(`Unsupported measurement output channel: ${token}`);
    }
}

function createBandMask(length, sampleRate, minFreq, maxFreq) {
    const half = length >>> 1;
    const kLo = Math.max(1, Math.floor(minFreq * length / sampleRate));
    const kHi = Math.min(half - 1, Math.ceil(maxFreq * length / sampleRate));
    const taperCap = Math.max(4, Math.min(32, Math.floor((kHi - kLo + 1) / 2)));
    const lowTaper = Math.min(taperCap, kLo - 1);
    const highTaper = Math.min(taperCap, half - 1 - kHi);
    const mask = new Float32Array(length);
    for (let k = kLo - lowTaper; k <= kHi + highTaper; k++) {
        let weight = 1;
        if (k < kLo) {
            weight = 0.5 * (1 - Math.cos(Math.PI * (k - kLo + lowTaper + 1) / (lowTaper + 1)));
        } else if (k > kHi) {
            weight = 0.5 * (1 - Math.cos(Math.PI * (kHi + highTaper - k + 1) / (highTaper + 1)));
        }
        mask[k] = weight;
        mask[length - k] = weight;
    }
    return mask;
}

function nextWhiteNoiseOperationToken(audioState) {
    if (!Number.isSafeInteger(audioState.whiteNoiseOperationToken)) {
        audioState.whiteNoiseOperationToken = 0;
    }
    audioState.whiteNoiseOperationToken += 1;
    return audioState.whiteNoiseOperationToken;
}

function takePublishedWhiteNoiseResources(audioState) {
    const resources = {
        node: audioState.whiteNoiseNode || null,
        gain: audioState.whiteNoiseGain || null,
        channelMerger: audioState.channelMerger || null,
        audioElement: audioState.whiteNoiseAudioElement || null,
        mediaStreamDestination: audioState.whiteNoiseDestination || null
    };
    audioState.whiteNoiseNode = null;
    audioState.whiteNoiseGain = null;
    audioState.channelMerger = null;
    audioState.whiteNoiseAudioElement = null;
    audioState.whiteNoiseDestination = null;
    audioState.whiteNoiseChannel = null;
    audioState.isWhiteNoiseActive = false;
    return resources;
}

function releaseWhiteNoiseResources(resources) {
    if (!resources) return;
    if (resources.node) {
        try {
            resources.node.stop(0);
        } catch (error) {
            console.warn('Error stopping white noise node:', error);
        }
        try {
            resources.node.disconnect();
        } catch (error) {
            console.warn('Error disconnecting white noise node:', error);
        }
    }
    if (resources.gain) {
        try {
            resources.gain.disconnect();
        } catch (error) {
            console.warn('Error disconnecting white noise gain node:', error);
        }
    }
    if (resources.channelMerger) {
        try {
            resources.channelMerger.disconnect();
        } catch (error) {
            console.warn('Error disconnecting channel merger:', error);
        }
    }
    releaseMeasurementOutputRoute(resources);
}

function settleWhiteNoiseStart(audioState, operationToken, published) {
    if (operationToken !== audioState.whiteNoiseOperationToken) return;
    audioState.isWhiteNoisePending = false;
    audioState.whiteNoiseDesiredActive = published || Boolean(audioState.isWhiteNoiseActive);
}

async function prepareSerializedWhiteNoiseOutputRoute(
    audioState,
    operationToken,
    outputDeviceId,
    channel,
    outputChannels
) {
    const previous = audioState.whiteNoiseRouteOperation || Promise.resolve();
    const operation = previous.then(async () => {
        if (operationToken !== audioState.whiteNoiseOperationToken) return null;
        const outputRoute = await prepareMeasurementOutputRoute(
            audioState.audioContext,
            outputDeviceId,
            channel,
            {},
            outputChannels
        );
        if (operationToken !== audioState.whiteNoiseOperationToken) {
            releaseMeasurementOutputRoute(outputRoute);
            return null;
        }
        return outputRoute;
    });
    const queueTail = operation.then(() => {}, () => {});
    audioState.whiteNoiseRouteOperation = queueTail;
    try {
        return await operation;
    } finally {
        if (audioState.whiteNoiseRouteOperation === queueTail) {
            audioState.whiteNoiseRouteOperation = null;
        }
    }
}

/**
 * Start white noise playback
 * @param {number} level - Noise level in dB (0 to -36)
 * @param {string} outputDeviceId - The output device ID, or null for default
 * @param {string} channel - The channel to output to ('left', 'right', 'all', or specific channel number '3'-'16')
 * @param {number} minFreq - Lower band edge in Hz (default 1 = effectively unlimited)
 * @param {number} maxFreq - Upper band edge in Hz (default null = up to Nyquist)
 */
async function startWhiteNoise(level = -12, outputDeviceId = null, channel = 'all', minFreq = 1, maxFreq = null, outputBands = null, outputChannelCount) {
    validateSignalOutputChannel(channel);
    const operationToken = nextWhiteNoiseOperationToken(this);
    this.whiteNoiseDesiredActive = true;
    this.isWhiteNoisePending = true;
    const resources = {
        node: null,
        gain: null,
        channelMerger: null,
        audioElement: null,
        mediaStreamDestination: null
    };

    // Check if AudioContext exists
    if (!this.audioContext) {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        } catch (error) {
            settleWhiteNoiseStart(this, operationToken, false);
            return false;
        }
    }

    // Ensure audio context is running
    const contextReady = await this.ensureAudioContextRunning();
    if (!contextReady || operationToken !== this.whiteNoiseOperationToken) {
        settleWhiteNoiseStart(this, operationToken, false);
        return false;
    }

    try {
        const outputRoute = await prepareSerializedWhiteNoiseOutputRoute(
            this,
            operationToken,
            outputDeviceId,
            channel,
            outputChannelCount ?? (channel === 'all' && Array.isArray(outputBands) ? outputBands.length : undefined)
        );
        if (!outputRoute) return false;
        resources.audioElement = outputRoute.audioElement;
        resources.mediaStreamDestination = outputRoute.mediaStreamDestination;
        if (operationToken !== this.whiteNoiseOperationToken) {
            releaseWhiteNoiseResources(resources);
            return false;
        }
        const outputChannels = outputRoute.outputChannels;
        console.log(`Using ${outputChannels}-channel ${outputRoute.mode} measurement output`);

        // Use a power-of-two buffer length (~2 seconds) so we can FFT-band-limit in place.
        // AudioBufferSourceNode loops any length seamlessly; FFT treats the buffer as
        // periodic, so the band-limited result is continuous across loop boundaries.
        const sampleRate = this.audioContext.sampleRate;
        const separateBands = channel === 'all' && Array.isArray(outputBands);
        const bufferChannels = separateBands ? outputChannels : 1;
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

        const noise = new Float32Array(bufferSize);
        for (let i = 0; i < bufferSize; i++) noise[i] = Math.random() * 2 - 1;
        if (needsBandlimit || separateBands) {
            const fft = new FFT(bufferSize);
            const real = new Float32Array(bufferSize);
            const imag = new Float32Array(bufferSize);
            const filteredReal = new Float32Array(bufferSize);
            const filteredImag = new Float32Array(bufferSize);
            const tdImag = new Float32Array(bufferSize);
            fft.transform(real, imag, noise, tdImag);
            let peak = 0;
            for (let ch = 0; ch < bufferChannels; ch++) {
                const band = separateBands ? outputBands[ch] : { minFreq: fLo, maxFreq: fHi };
                const mask = createBandMask(bufferSize, sampleRate, band.minFreq, band.maxFreq);
                for (let k = 0; k < bufferSize; k++) {
                    filteredReal[k] = real[k] * mask[k];
                    filteredImag[k] = imag[k] * mask[k];
                }
                const data = noiseBuffer.getChannelData(ch);
                fft.inverseTransform(data, tdImag, filteredReal, filteredImag);
                for (const sample of data) peak = Math.max(peak, Math.abs(sample));
            }
            // Share one gain across outputs so their relative levels are preserved.
            const norm = peak > 1e-9 ? 0.9 / peak : 1;
            for (let ch = 0; ch < bufferChannels; ch++) {
                const data = noiseBuffer.getChannelData(ch);
                for (let i = 0; i < bufferSize; i++) data[i] *= norm;
            }
        } else {
            noiseBuffer.getChannelData(0).set(noise);
        }
        
        // Create audio source from buffer
        resources.node = this.audioContext.createBufferSource();
        resources.node.buffer = noiseBuffer;
        resources.node.loop = true;
        
        // Create gain node for level control
        resources.gain = this.audioContext.createGain();
        resources.gain.gain.value = Math.pow(10, level / 20);

        resources.node.connect(resources.gain);
        if (separateBands) {
            resources.gain.channelCount = outputChannels;
            resources.gain.channelCountMode = 'explicit';
            resources.gain.channelInterpretation = 'discrete';
            resources.gain.connect(outputRoute.destination);
        } else {
            resources.channelMerger = this.audioContext.createChannelMerger(outputChannels);
            const targetChannel = channel === 'left' ? 0 : channel === 'right' ? 1 : parseInt(channel);
            if (Number.isInteger(targetChannel)) {
                resources.gain.connect(resources.channelMerger, 0, targetChannel);
            } else {
                for (let ch = 0; ch < outputChannels; ch++) {
                    resources.gain.connect(resources.channelMerger, 0, ch);
                }
            }
            resources.channelMerger.connect(outputRoute.destination);
        }
        
        // Start playback
        resources.node.start(0);
        if (operationToken !== this.whiteNoiseOperationToken) {
            releaseWhiteNoiseResources(resources);
            return false;
        }
        resources.node.onended = () => {
            if (operationToken === this.whiteNoiseOperationToken &&
                this.whiteNoiseNode === resources.node) {
                this.isWhiteNoiseActive = false;
                this.whiteNoiseDesiredActive = false;
                this.isWhiteNoisePending = false;
            }
        };
        const previousResources = takePublishedWhiteNoiseResources(this);
        this.whiteNoiseNode = resources.node;
        this.whiteNoiseGain = resources.gain;
        this.channelMerger = resources.channelMerger;
        this.whiteNoiseAudioElement = resources.audioElement;
        this.whiteNoiseDestination = resources.mediaStreamDestination;
        this.whiteNoiseChannel = String(channel) === 'both' ? 'all' : String(channel);
        this.isWhiteNoiseActive = true;
        settleWhiteNoiseStart(this, operationToken, true);
        releaseWhiteNoiseResources(previousResources);
        
        return true;
    } catch (error) {
        console.error('Error starting white noise:', error);
        releaseWhiteNoiseResources(resources);
        if (operationToken !== this.whiteNoiseOperationToken) return false;
        settleWhiteNoiseStart(this, operationToken, false);
        if (error instanceof MeasurementOutputError) {
            throw error;
        }
        return false;
    }
}

/**
 * Stop white noise playback
 */
function stopWhiteNoise() {
    try {
        nextWhiteNoiseOperationToken(this);
        this.whiteNoiseDesiredActive = false;
        this.isWhiteNoisePending = false;
        releaseWhiteNoiseResources(takePublishedWhiteNoiseResources(this));
    } catch (error) {
        console.error('Error stopping white noise:', error);
    }
}

function cancelPendingWhiteNoiseStart() {
    if (!this.isWhiteNoisePending) return false;
    nextWhiteNoiseOperationToken(this);
    this.isWhiteNoisePending = false;
    this.whiteNoiseDesiredActive = Boolean(this.isWhiteNoiseActive);
    return true;
}

async function waitForWhiteNoiseRouteIdle() {
    await this.whiteNoiseRouteOperation;
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

/** Generate the common ESS definition used by every output route. */
function generateESS(length = 131072, sampleRate = 48000, channel = 'all',
    minFreq = 20, maxFreq = 20000, bandLimited = true, outputBands = null) {
    validateSignalOutputChannel(channel);
    if (!this.initialized) return null;
    const { minFreq: startFrequency, maxFreq: endFrequency } = resolveSweepBand({
        acquisitionMethod: 'ess', sweepBandLimited: bandLimited, sweepMinFreq: minFreq, sweepMaxFreq: maxFreq
    }, channel, sampleRate, length);
    const definition = createEssSignal({ length, sampleRate, startFrequency, endFrequency });
    const width = channel === 'all' && Array.isArray(outputBands) ? outputBands.length
        : Math.max(2, Number.isInteger(Number(channel)) ? Number(channel) + 1 : 2);
    const selected = channel === 'left' ? 0 : channel === 'right' ? 1 : Number(channel);
    const channels = Array.from({ length: width }, (_, index) => {
        const data = new Float32Array(definition.length);
        if (channel !== 'all' && channel !== 'both' && selected !== index) return data;
        data.set(definition.signal);
        if (channel === 'all' && outputBands) {
            const band = outputBands[index];
            for (let i = 0; i < data.length; i++) {
                const frequency = startFrequency * Math.exp(i / (sampleRate * definition.sweepConstant));
                if (frequency < band.minFreq || frequency > band.maxFreq) data[i] = 0;
                else {
                    const edge = Math.min(Math.log(frequency / band.minFreq), Math.log(band.maxFreq / frequency));
                    if (edge < 0.02) data[i] *= 0.5 - 0.5 * Math.cos(Math.PI * edge / 0.02);
                }
            }
        }
        return data;
    });
    this.sweepMinFreq = startFrequency;
    this.sweepMaxFreq = endFrequency;
    return { ...definition, channels, left: channels[0], right: channels[1] };
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
    cancelPendingWhiteNoiseStart,
    waitForWhiteNoiseRouteIdle,
    setNoiseLevel,
    generateESS,
    applyWindow
};
