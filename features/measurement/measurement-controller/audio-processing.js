/**
 * Audio processing functionality for the measurement controller
 * 
 * Stability improvements implemented:
 * - Interactive latency hint for better real-time performance
 * - Efficient buffer management with explicit initialization
 * - Robust error handling for all audio connections
 * - Memory leak prevention with proper cleanup
 * - Performance monitoring for processing bottlenecks
 */

import audioUtils from '../audio-utils/index.js';
import { FFT } from '../audio-utils/index.js';
import {
    prepareMeasurementOutputRoute,
    releaseMeasurementOutputRoute
} from '../audio-utils/output-routing.js';
import { detectOnset, trimMeasurementImpulseResponse } from '../../../js/utils/measurement-dsp/onset.js';
import {
    applyInterfaceCalibration
} from '../../../js/utils/measurement-dsp/interface-calibration.js';

const SWEEP_START_DELAY_SECONDS = 0.05;

export class SweepCancelledError extends Error {
    constructor() {
        super('Measurement cancelled');
        this.name = 'SweepCancelledError';
    }
}

function clearSweepTimers(elements) {
    if (!elements) return;
    for (const key of ['preRollTimer', 'playbackSafetyTimer', 'finishTimer', 'finalSafetyTimer']) {
        if (elements[key]) clearTimeout(elements[key]);
        elements[key] = null;
    }
    if (elements.checkInterval) clearInterval(elements.checkInterval);
    elements.checkInterval = null;
}
const MAX_PRACTICAL_PATH_LATENCY_SECONDS = 1;

function scheduledPlaybackFrameForTime(time, sampleRate) {
    return Math.round(time * sampleRate);
}

function trimStartOffsetSamples(preRollSamples, analysisStartSamples, timing) {
    if (!Number.isSafeInteger(timing?.scheduledPlaybackFrame) ||
        !Number.isSafeInteger(timing?.captureStartFrame)) {
        return 0;
    }
    const assumedOffset = preRollSamples + analysisStartSamples;
    const measuredOffset = timing.scheduledPlaybackFrame - timing.captureStartFrame;
    return assumedOffset - measuredOffset;
}

function outputTimeReferenceForRoute(route, timing = null) {
    if (route?.mode === 'media-element') return 'media-element';
    if (route?.mode !== 'direct' ||
        !Number.isSafeInteger(timing?.scheduledPlaybackFrame) ||
        !Number.isSafeInteger(timing?.captureStartFrame) ||
        timing.scheduledPlaybackFrame < 0 || timing.captureStartFrame < 0) {
        return 'unknown';
    }
    return 'audio-context';
}

function createSweepCapturePlan(sweepLength, averagingCount, sampleRate) {
    const guardSamples = Math.ceil(
        (SWEEP_START_DELAY_SECONDS + MAX_PRACTICAL_PATH_LATENCY_SECONDS) * sampleRate
    ) + sweepLength;
    const guardPeriods = Math.ceil(guardSamples / sweepLength);
    return {
        guardPeriods,
        repeatCount: guardPeriods + averagingCount,
        analysisStartSamples: guardPeriods * sweepLength
    };
}

function createRepeatedSweepAudioBuffer(
    audioContext,
    sweepBuffer,
    repeatCount,
    outputChannels,
    sampleRate
) {
    const combinedBufferLength = sweepBuffer.length * repeatCount;
    const combinedSweepBuffer = audioContext.createBuffer(
        outputChannels,
        combinedBufferLength,
        sampleRate
    );

    for (let channel = 0; channel < outputChannels; channel++) {
        const sourceChannel = sweepBuffer.channels[channel];
        if (!(sourceChannel instanceof Float32Array) || sourceChannel.length !== sweepBuffer.length) {
            continue;
        }

        const destinationChannel = combinedSweepBuffer.getChannelData(channel);
        for (let repeat = 0; repeat < repeatCount; repeat++) {
            destinationChannel.set(sourceChannel, repeat * sweepBuffer.length);
        }
    }

    return combinedSweepBuffer;
}

const AudioProcessing = {
    createSweepMeasurementResult(processed, details) {
        return {
            ...details,
            impulseResponse: processed.impulseResponse,
            irValid: processed.irValid,
            onsetIndex: processed.onsetIndex,
            prerollSamples: processed.prerollSamples,
            trimStartSamples: processed.trimStartSamples,
            outputTimeReference: processed.outputTimeReference,
            sweepLimited: processed.sweepLimited,
            peakDb: processed.peakDb,
            refScale: processed.refScale
        };
    },

    /**
     * Active audio elements for the current sweep
     */
    activeSweepElements: {
        source: null,
        gainNode: null,
        recordNode: null,
        analyzer: null,
        checkInterval: null,
        audioElement: null,
        mediaStreamDestination: null
    },
    
    /**
     * Playback sweep and record input simultaneously
     * @param {Object} sweepBuffer - Sweep signal buffer object with left and right channels
     * @returns {Object} Measurement result with impulse response and overload flag
     */
    async playAndRecordSweep(sweepBuffer, outputChannel = this.measurementConfig.outputChannel, explicitOutputChannels) {
        return new Promise(async (resolve, reject) => {
            const operation = {
                settled: false,
                reject,
                resolve
            };
            const settleResolve = value => {
                if (operation.settled) return;
                operation.settled = true;
                if (this.activeSweepOperation === operation) this.activeSweepOperation = null;
                resolve(value);
            };
            const settleReject = error => {
                if (operation.settled) return;
                operation.settled = true;
                if (this.activeSweepOperation === operation) this.activeSweepOperation = null;
                reject(error);
            };
            try {
                // Reset active elements before starting new sweep
                const elements = {
                    source: null,
                    gainNode: null,
                    recordNode: null,
                    analyzer: null,
                    checkInterval: null,
                    preRollTimer: null,
                    playbackSafetyTimer: null,
                    finishTimer: null,
                    finalSafetyTimer: null,
                    audioElement: null,
                    mediaStreamDestination: null,
                    operation
                };
                this.activeSweepElements = elements;
                this.activeSweepOperation = operation;

                const audioContext = audioUtils.audioContext;
                if (!audioContext || audioContext.state !== 'running') {
                    throw new Error('Audio context is not running');
                }

                // Verify that microphone input is working
                if (!audioUtils.microphone) {
                    throw new Error('Microphone input is not initialized. Please check browser settings.');
                }
                
                console.log(`Audio context state: ${audioContext.state}, sample rate: ${audioContext.sampleRate}Hz`);
                console.log(`Microphone connected: ${audioUtils.microphone !== null}`);
                
                const sampleRate = audioContext.sampleRate;
                const averagingCount = parseInt(this.measurementConfig.averaging);
                
                // Get the current signal level setting
                const signalLevel = parseFloat(document.getElementById('noiseLevel').value);
                console.log(`Using signal level: ${signalLevel} dB`);
                
                // Calculate the expected playback duration
                const sweepDuration = sweepBuffer.length / sampleRate;
                const capturePlan = createSweepCapturePlan(
                    sweepBuffer.length,
                    averagingCount,
                    sampleRate
                );
                const totalPlaybackDuration = sweepDuration * capturePlan.repeatCount;
                console.log(`Sweep duration: ${sweepDuration.toFixed(2)}s, Total playback: ${totalPlaybackDuration.toFixed(2)}s`);
                
                const outputRoute = await prepareMeasurementOutputRoute(
                    audioContext,
                    this.measurementConfig.audioOutputId,
                    outputChannel,
                    {},
                    explicitOutputChannels
                );
                if (operation.settled || this.activeSweepOperation !== operation) {
                    releaseMeasurementOutputRoute(outputRoute);
                    return;
                }
                const outputChannels = outputRoute.outputChannels;
                elements.audioElement = outputRoute.audioElement;
                elements.mediaStreamDestination = outputRoute.mediaStreamDestination;
                console.log(`Using ${outputChannels}-channel ${outputRoute.mode} measurement output`);

                const combinedSweepBuffer = createRepeatedSweepAudioBuffer(
                    audioContext,
                    sweepBuffer,
                    capturePlan.repeatCount,
                    outputChannels,
                    sampleRate
                );
                
                // Calculate recording buffer length - match exactly with playback plus some padding
                // Instead of using fixed delays, calculate exact timing:
                // 0.5s pre-roll + TSP playback + 0.5s post-roll
                const prePostRollTime = 0.5; // seconds
                const recordBufferLength = Math.ceil(sampleRate * (prePostRollTime + totalPlaybackDuration + prePostRollTime));
                const recordBuffer = new Float32Array(recordBufferLength);
                
                console.log(`Recording buffer: ${(recordBufferLength/sampleRate).toFixed(2)}s (${recordBufferLength} samples)`);
                
                // Create analyzer to detect overload
                const analyzer = audioContext.createAnalyser();
                analyzer.fftSize = 2048;
                const analyzerData = new Uint8Array(analyzer.frequencyBinCount);
                
                // Store analyzer in active elements
                elements.analyzer = analyzer;
                
                let recordNode;
                let recordingStarted = false;
                let recordIndex = 0;
                let captureStartFrame = null;
                let scheduledPlaybackFrame = null;
                let hasOverload = false;
                let maxSignalLevel = -100; // Variable to track maximum signal level
                
                // Store reference to this to use in inner functions
                const self = this;
                
                // Function to update analyzer and check for overload
                const checkOverload = () => {
                    analyzer.getByteTimeDomainData(analyzerData);
                    for (let i = 0; i < analyzerData.length; i++) {
                        if (analyzerData[i] < 5 || analyzerData[i] > 250) {
                            hasOverload = true;
                            break;
                        }
                    }
                    
                    // Get current input level and update maximum value
                    const currentLevel = audioUtils.getInputLevel();
                    maxSignalLevel = Math.max(maxSignalLevel, currentLevel);
                };
                
                // Check if AudioWorklet is supported
                if (!audioUtils.audioWorkletSupported) {
                    console.error('AudioWorklet is not supported in this browser');
                    this.stopSweepPlayback(operation);
                    settleReject(new Error('AudioWorklet not supported'));
                    return;
                }
                
                try {
                    console.log('Using AudioWorkletNode for recording');
                    
                    // Create recorder worklet node
                    recordNode = await audioUtils.createRecorderWorkletNode(
                        null // Device and channel selection are handled by the shared input route.
                    );
                    if (operation.settled || this.activeSweepOperation !== operation) {
                        try {
                            recordNode?.port?.postMessage({ command: 'stop' });
                            recordNode?.disconnect();
                        } catch (_) {
                            // The abandoned recorder may already be disconnected.
                        }
                        releaseMeasurementOutputRoute(outputRoute);
                        return;
                    }
                    
                    if (!recordNode) {
                        throw new Error('Failed to create recorder worklet node');
                    }
                    
                    // Store in class variable for later cleanup
                    this.recorderNode = recordNode;
                    // Store in active elements
                    elements.recordNode = recordNode;
                    
                    // Set up message handling
                    recordNode.port.onmessage = (event) => {
                        if (event.data.status === 'started') {
                            recordingStarted = true;
                            console.log('Recording started');
                        } else if (event.data.status === 'capture-frame') {
                            captureStartFrame = event.data.startFrame;
                        } else if (event.data.buffer) {
                            // Received audio data from worklet
                            const incomingBuffer = event.data.buffer;
                            // Ensure buffer is a Float32Array
                            const bufferArray = incomingBuffer instanceof Float32Array ? incomingBuffer : new Float32Array(incomingBuffer);
                            // Copy incoming buffer to record buffer at correct position
                            // Use more efficient array copy
                            const copyLength = Math.min(bufferArray.length, recordBuffer.length - recordIndex);
                            if (copyLength > 0) {
                                recordBuffer.set(bufferArray.subarray(0, copyLength), recordIndex);
                                recordIndex += copyLength;
                            }
                        } else if (event.data.status === 'stopped' || event.data.status === 'complete') {
                            console.log(`Recording ${event.data.status} with ${event.data.buffer?.length || 0} samples`);
                            if (event.data.buffer) {
                                // Copy remaining buffer if any
                                const incomingBuffer = event.data.buffer;
                                // Ensure buffer is a Float32Array
                                const bufferArray = incomingBuffer instanceof Float32Array ? incomingBuffer : new Float32Array(incomingBuffer);
                                // Use more efficient array copy
                                const copyLength = Math.min(bufferArray.length, recordBuffer.length - recordIndex);
                                if (copyLength > 0) {
                                    recordBuffer.set(bufferArray.subarray(0, copyLength), recordIndex);
                                    recordIndex += copyLength;
                                }
                            }
                        }
                    };
                    
                    // Verify microphone is not null before trying to connect
                    if (!audioUtils.channelGain) {
                        throw new Error('Measurement input is unavailable. Please check the selected input device.');
                    }
                    
                    console.log('Connecting microphone to recorder node');
                    // The shared input route applies Left, Right, or Both exactly
                    // once, so level adjustment and recording observe the same mono signal.
                    try {
                        audioUtils.channelGain.connect(recordNode);
                        audioUtils.channelGain.connect(analyzer);
                    } catch (connectError) {
                        throw new Error(`Failed to connect microphone: ${connectError.message}`);
                    }
                    
                    // Connect recorder node to destination (needed for WebAudio to work correctly)
                    recordNode.connect(audioContext.destination);
                    
                    // Start recording
                    recordNode.port.postMessage({ command: 'start' });
                    
                } catch (err) {
                    console.error('Failed to create AudioWorkletNode:', err);
                    this.stopSweepPlayback(operation);
                    settleReject(err);
                    return;
                }
                
                // Track timing
                let startTime = 0;
                let playbackStarted = false;
                let playbackEnded = false;
                
                // Start playback with pre-roll delay
                elements.preRollTimer = setTimeout(() => {
                    if (operation.settled || this.activeSweepOperation !== operation) return;
                    try {
                        // Make sure audio context is still running
                        if (audioContext.state !== 'running') {
                            console.log('Resuming audio context before playback');
                            audioContext.resume();
                        }
                        
                        // Create audio source
                        const source = audioContext.createBufferSource();
                        source.buffer = combinedSweepBuffer;
                        
                        // Create gain node for output level control
                        const gainNode = audioContext.createGain();
                        
                        // Convert dB to linear gain
                        const linearGain = Math.pow(10, signalLevel / 20);
                        gainNode.gain.value = linearGain;
                        gainNode.channelCount = outputChannels;
                        gainNode.channelCountMode = 'explicit';
                        gainNode.channelInterpretation = 'discrete';
                        
                        // Connect source -> gain -> output
                        source.connect(gainNode);
                        gainNode.connect(outputRoute.destination);
                        
                        // Store source and gain node in active elements
                        elements.source = source;
                        elements.gainNode = gainNode;
                        
                        // Track when playback starts
                        startTime = audioContext.currentTime;
                        const scheduledPlaybackTime = startTime + SWEEP_START_DELAY_SECONDS;
                        scheduledPlaybackFrame = scheduledPlaybackFrameForTime(
                            scheduledPlaybackTime,
                            sampleRate
                        );
                        playbackStarted = true;
                        console.log(`Playback started at ${startTime}`);
                        
                        // Schedule playback start slightly in the future for better stability
                        source.start(scheduledPlaybackTime);
                        
                        // Track when playback ends
                        source.onended = () => {
                            playbackEnded = true;
                            console.log(`Playback ended at ${audioContext.currentTime}, duration: ${audioContext.currentTime - startTime}s`);
                        };
                        
                        // Safety timeout in case onended doesn't fire
                        elements.playbackSafetyTimer = setTimeout(() => {
                            if (operation.settled || this.activeSweepOperation !== operation) return;
                            if (!playbackEnded) {
                                playbackEnded = true;
                                console.log(`Forcing playback end at ${audioContext.currentTime}, duration: ${audioContext.currentTime - startTime}s`);
                            }
                        }, (totalPlaybackDuration + 0.5) * 1000);
                    } catch (error) {
                        console.error('Error starting playback:', error);
                        playbackEnded = true; // Mark as ended to trigger cleanup
                    }
                    
                }, prePostRollTime * 1000);
                
                // Setup a periodic check for analyzing the recording
                const checkInterval = setInterval(() => {
                    // Update the analyzer info
                    checkOverload();
                    
                    // If playback has ended and we've recorded enough post-roll samples or record buffer is full
                    if ((playbackEnded && audioContext.currentTime > startTime + totalPlaybackDuration + prePostRollTime) ||
                        recordIndex >= recordBuffer.length) {
                        
                        clearInterval(checkInterval);
                        
                        // Stop the recording
                        recordNode.port.postMessage({ command: 'stop' });
                        
                        // Small delay to ensure all audio data is received
                        elements.finishTimer = setTimeout(() => {
                            finishRecording();
                        }, 500);
                    }
                }, 100);
                
                // Store interval in active elements
                elements.checkInterval = checkInterval;
                
                // Function to clean up and process the recording
                const finishRecording = () => {
                    if (operation.settled || this.activeSweepOperation !== operation) return;
                    clearSweepTimers(elements);
                    // Clean up audio nodes
                    try {
                        if (recordNode && recordNode.port) {
                            recordNode.port.onmessage = null; // Remove event listener
                            recordNode.disconnect();
                        }
                        if (analyzer) {
                            analyzer.disconnect();
                        }
                        self.cleanupSweepOutput(operation);
                        // Clear active elements references
                        elements.recordNode = null;
                        elements.analyzer = null;
                        elements.checkInterval = null;
                        self.recorderNode = null;
                    } catch (e) {
                        console.error("Error during cleanup:", e);
                    }
                    
                    console.log(`Recording completed: ${recordIndex}/${recordBuffer.length} samples, max level: ${maxSignalLevel.toFixed(1)}dB`);
                    
                    // Create a properly sized buffer with the recorded data
                    let finalBuffer;
                    if (recordIndex < recordBuffer.length) {
                        finalBuffer = new Float32Array(recordIndex);
                        finalBuffer.set(recordBuffer.subarray(0, recordIndex));
                    } else {
                        finalBuffer = recordBuffer;
                    }
                    
                    // Save full recording for debugging
                    this.fullRecordBuffer = finalBuffer;

                    try {
                        // Process the recording to extract the impulse response
                        const processStart = performance.now();
                        const processed = this.processRecordedBuffer(
                            finalBuffer,
                            sweepBuffer.length,
                            averagingCount,
                            sampleRate,
                            {
                                outputRoute,
                                scheduledPlaybackFrame,
                                captureStartFrame
                            }
                        );
                        const processedBuffer = processed.analysisImpulseResponse;

                        // Save synchronized buffer for debugging
                        this.syncedBuffer = processedBuffer;

                        // Calculate smoothed frequency response with 0.005 octave spacing
                        const freqStart = performance.now();
                        const frequencyResponse = audioUtils.calculateFrequencyResponseWithSmoothing(
                            processedBuffer,
                            sampleRate,
                            true, // Normalize with last sweep
                            0.005  // Octave smoothing factor
                        );

                        const processEnd = performance.now();
                        console.log(`Processing: ${(processEnd - processStart).toFixed(1)}ms (freq: ${(processEnd - freqStart).toFixed(1)}ms)`);

                        // Clear large temporary buffers
                        finalBuffer = null;

                        // Resolve promise with processed data
                        settleResolve(this.createSweepMeasurementResult(processed, {
                            frequencyResponse: frequencyResponse,
                            hasOverload: hasOverload,
                            maxSignalLevel: maxSignalLevel,
                            fullRecording: finalBuffer,
                            sampleRate: sampleRate
                        }));
                    } catch (error) {
                        finalBuffer = null;
                        console.error('Recorded sweep processing failed:', error);
                        settleReject(error);
                    }
                };
                
                // Final safety timeout
                elements.finalSafetyTimer = setTimeout(() => {
                    if (operation.settled || this.activeSweepOperation !== operation) return;
                    if (!playbackEnded || recordingStarted) {
                        console.warn(`Recording timeout after ${2 * (prePostRollTime + totalPlaybackDuration)}s`);
                        
                        // Clean up
                        try {
                            if (recordNode) {
                                recordNode.disconnect();
                            }
                            analyzer.disconnect();
                        } catch (e) {
                            console.error("Error during cleanup:", e);
                        }
                        this.stopSweepPlayback(operation);
                        settleReject(new Error('Recording timeout'));
                    }
                }, 2 * (prePostRollTime + totalPlaybackDuration) * 1000);
                
            } catch (error) {
                this.stopSweepPlayback(operation);
                settleReject(error);
            }
        });
    },
    
    /**
     * Process the recorded buffer to get impulse response
     * @param {Float32Array} recordBuffer - Full recorded buffer
     * @param {number} sweepLength - Sweep length in samples
     * @param {number} averagingCount - Number of repetitions
     * @param {number} sampleRate - Sample rate in Hz
     * @returns {Object} Processed and trimmed impulse response
     */
    processRecordedBuffer(recordBuffer, sweepLength, averagingCount, sampleRate, timing = null) {
        console.time('processRecordedBuffer');
        const calibrationRequired = Boolean(this.interfaceCalibrationImpulseResponse);
        
        // Log recording information
        console.log(`Recording length: ${recordBuffer.length} samples (${recordBuffer.length/sampleRate}s)`);
        console.log(`Sweep length: ${sweepLength} samples (${sweepLength/sampleRate}s)`);
        
        try {
            // Get inverse filter from audioUtils
            const inverseFilter = audioUtils.lastInverseFilter;
            
            if (!inverseFilter) {
                console.warn('No inverse filter available, returning original recording');
                if (calibrationRequired) {
                    throw new Error('The measured impulse response could not be created');
                }
                console.timeEnd('processRecordedBuffer');
                return {
                    analysisImpulseResponse: recordBuffer,
                    impulseResponse: null,
                    irValid: false
                };
            }
            
            // Assuming there's a pre-roll time before the actual sweep
            const preRollTime = 0.5; // seconds
            const preRollSamples = Math.floor(preRollTime * sampleRate);
            const capturePlan = createSweepCapturePlan(
                sweepLength,
                averagingCount,
                sampleRate
            );
            const trimOffset = trimStartOffsetSamples(
                preRollSamples,
                capturePlan.analysisStartSamples,
                timing
            );
            const outputTimeReference = outputTimeReferenceForRoute(timing?.outputRoute, timing);
            
            // Extract complete steady-state periods for circular deconvolution.
            // Guard periods cover the scheduled start and practical device-path
            // latency, plus one complete settling period. Any remaining offset
            // only rotates a complete period and therefore shifts the recovered
            // impulse response without changing its frequency response.
            const segments = [];
            
            for (let i = 0; i < averagingCount; i++) {
                const startOffset = preRollSamples +
                    capturePlan.analysisStartSamples +
                    (i * sweepLength);
                
                // Skip if not enough samples
                if (startOffset + sweepLength > recordBuffer.length) {
                    console.warn(`Not enough samples for segment ${i+1}`);
                    continue;
                }
                
                segments.push(recordBuffer.subarray(startOffset, startOffset + sweepLength));
            }
            
            console.log(`Created ${segments.length} segments for averaging`);
            if (segments.length !== averagingCount) {
                const error = new Error(
                    'The recording did not contain enough complete sweep periods. Please try the measurement again.'
                );
                error.isIncompleteSweepRecording = true;
                throw error;
            }
            
            // Circular convolution is implemented by folding the tail of a
            // zero-padded linear convolution back into one sweep period.
            const filterLength = Math.min(inverseFilter.length, sweepLength);
            if (filterLength < 1) {
                throw new Error('Inverse filter is empty');
            }
            const linearLength = sweepLength + filterLength - 1;
            const paddedSize = Math.pow(2, Math.ceil(Math.log2(linearLength)));
            const fft = new FFT(paddedSize);
            const filterInputReal = new Float32Array(paddedSize);
            const filterInputImag = new Float32Array(paddedSize);
            const filterReal = new Float32Array(paddedSize);
            const filterImag = new Float32Array(paddedSize);
            for (let i = 0; i < filterLength; i++) {
                filterInputReal[i] = inverseFilter[i];
            }
            fft.transform(filterReal, filterImag, filterInputReal, filterInputImag);

            const processedSegments = [];
            for (let i = 0; i < segments.length; i++) {
                const signalReal = new Float32Array(paddedSize);
                const signalImag = new Float32Array(paddedSize);
                const resultReal = new Float32Array(paddedSize);
                const resultImag = new Float32Array(paddedSize);
                
                signalReal.set(segments[i]);
                fft.transform(resultReal, resultImag, signalReal, signalImag);
                
                for (let j = 0; j < paddedSize; j++) {
                    const real1 = resultReal[j];
                    const imag1 = resultImag[j];
                    const real2 = filterReal[j];
                    const imag2 = filterImag[j];
                    
                    resultReal[j] = real1 * real2 - imag1 * imag2;
                    resultImag[j] = real1 * imag2 + imag1 * real2;
                }
                
                fft.inverseTransform(resultReal, resultImag, resultReal, resultImag);
                
                const impulseResponse = new Float32Array(sweepLength);
                for (let j = 0; j < sweepLength; j++) {
                    const wrappedIndex = j + sweepLength;
                    impulseResponse[j] = resultReal[j] +
                        (wrappedIndex < linearLength ? resultReal[wrappedIndex] : 0);
                }
                
                processedSegments.push(impulseResponse);
            }
            
            // Average all processed segments
            let result;
            if (processedSegments.length > 0) {
                const length = processedSegments[0].length;
                result = new Float32Array(length);
                
                for (let i = 0; i < processedSegments.length; i++) {
                    for (let j = 0; j < length; j++) {
                        result[j] += processedSegments[i][j] / processedSegments.length;
                    }
                }
            } else {
                console.warn('No processed segments available');
                if (calibrationRequired) {
                    throw new Error('The measured impulse response could not be created');
                }
                console.timeEnd('processRecordedBuffer');
                return {
                    analysisImpulseResponse: recordBuffer,
                    impulseResponse: null,
                    irValid: false
                };
            }
            
            const onsetIndex = detectOnset(result, sampleRate);
            const trimmed = trimMeasurementImpulseResponse(
                result,
                sampleRate,
                sweepLength,
                onsetIndex,
                trimOffset
            );
            // The analysis window starts a whole guard period after the pre-roll,
            // and that guard is not part of the path latency, so remove it from the
            // anchor. The anchor turns negative when the capture leads the pre-roll.
            // Without an audio-context time reference the capture offset is unknown,
            // so no anchor exists: drop it rather than store a meaningless one.
            if (outputTimeReference === 'audio-context') {
                trimmed.trimStartSamples -= capturePlan.analysisStartSamples;
            } else {
                trimmed.trimStartSamples = null;
            }
            let peak = 0;
            for (const sample of trimmed.data) {
                const magnitude = sample < 0 ? -sample : sample;
                if (magnitude > peak) peak = magnitude;
            }
            const refScale = audioUtils.lastDeconvolutionRefScale || 1;

            if (calibrationRequired) {
                const calibrated = applyInterfaceCalibration({
                    data: trimmed.data,
                    onsetIndex: trimmed.onsetIndex,
                    prerollSamples: trimmed.prerollSamples,
                    refScale
                }, this.interfaceCalibrationImpulseResponse, {
                    sampleRate,
                    minFrequency: this.currentSweepBand?.minFreq ?? this.currentMeasurement.sweepMinFreq,
                    maxFrequency: this.currentSweepBand?.maxFreq ?? this.currentMeasurement.sweepMaxFreq,
                    outputLength: trimmed.data.length,
                    prerollSamples: trimmed.prerollSamples
                });
                console.timeEnd('processRecordedBuffer');
                return {
                    ...trimmed,
                    ...calibrated,
                    analysisImpulseResponse: calibrated.data,
                    impulseResponse: calibrated.data,
                    irValid: true,
                    outputTimeReference
                };
            }

            // The stored IR keeps its reference scale; frequency analysis uses
            // unit-reference samples so changing the sweep band cannot add gain.
            for (let index = 0; index < result.length; index++) result[index] /= refScale;
            console.timeEnd('processRecordedBuffer');
            return {
                ...trimmed,
                analysisImpulseResponse: result,
                impulseResponse: trimmed.data,
                irValid: true,
                outputTimeReference,
                peakDb: peak > 0 ? 20 * Math.log10(peak) : -Infinity,
                refScale
            };
            
        } catch (error) {
            console.error('Error processing recorded buffer:', error);
            console.timeEnd('processRecordedBuffer');
            if (calibrationRequired || error?.isIncompleteSweepRecording) throw error;
            return {
                analysisImpulseResponse: recordBuffer,
                impulseResponse: null,
                irValid: false
            };
        }
    },
    
    cleanupSweepOutput(operation) {
        const elements = this.activeSweepElements;
        if (!operation || this.activeSweepOperation !== operation ||
            elements?.operation !== operation) return false;

        if (elements.source) {
            try {
                elements.source.stop();
            } catch (_) {
                // The source may already have ended.
            }
            try {
                elements.source.disconnect();
            } catch (error) {
                console.warn('Error disconnecting sweep source:', error);
            }
            elements.source = null;
        }

        if (elements.gainNode) {
            try {
                elements.gainNode.disconnect();
            } catch (error) {
                console.warn('Error disconnecting gain node:', error);
            }
            elements.gainNode = null;
        }

        releaseMeasurementOutputRoute({
            audioElement: elements.audioElement,
            mediaStreamDestination: elements.mediaStreamDestination
        });
        elements.audioElement = null;
        elements.mediaStreamDestination = null;
        return true;
    },

    /**
     * Stop active sweep playback
     * This is used to clean up active sweep playback when measurement is cancelled
     */
    stopSweepPlayback(operation) {
        const elements = this.activeSweepElements;
        if (!operation || this.activeSweepOperation !== operation ||
            elements?.operation !== operation) return false;
        console.log('Stopping active sweep playback');
        
        // Clean up active elements
        if (elements) {
            clearSweepTimers(elements);
            this.cleanupSweepOutput(operation);
            
            // Clean up other elements
            if (elements.analyzer) {
                try {
                    elements.analyzer.disconnect();
                } catch (e) {
                    console.warn('Error disconnecting analyzer:', e);
                }
                elements.analyzer = null;
            }
            
            if (elements.recordNode) {
                const recordNode = elements.recordNode;
                try {
                    recordNode.port.postMessage({ command: 'stop' });
                    recordNode.disconnect();
                } catch (e) {
                    console.warn('Error stopping record node:', e);
                }
                elements.recordNode = null;
                if (this.recorderNode === recordNode) {
                    this.recorderNode = null;
                }
            }
            
            if (elements.checkInterval) {
                clearInterval(elements.checkInterval);
                elements.checkInterval = null;
            }
            
            console.log('Sweep playback stopped successfully');
        }
        return true;
    },

    cancelActiveSweep() {
        const operation = this.activeSweepOperation;
        if (operation && !operation.settled) {
            operation.settled = true;
            operation.reject(new SweepCancelledError());
        }
        this.stopSweepPlayback(operation);
        if (this.activeSweepOperation === operation) this.activeSweepOperation = null;
    }
};

export default AudioProcessing;
export {
    createRepeatedSweepAudioBuffer,
    createSweepCapturePlan,
    scheduledPlaybackFrameForTime,
    trimStartOffsetSamples,
    outputTimeReferenceForRoute
};
