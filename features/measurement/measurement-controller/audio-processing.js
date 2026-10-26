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
import {
    prepareMeasurementOutputRoute,
    releaseMeasurementOutputRoute
} from '../audio-utils/output-routing.js';
import { createEssCapturePlan, analyzeEssRecording } from '../../../js/utils/measurement-dsp/ess.js';

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
function scheduledPlaybackFrameForTime(time, sampleRate) {
    return Math.round(time * sampleRate);
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

function createRepeatedSweepAudioBuffer(
    audioContext,
    sweepBuffer,
    repeatCount,
    outputChannels,
    sampleRate
) {
    const intervalSamples = sweepBuffer.length + (sweepBuffer.tailSamples || 0);
    const combinedBufferLength = intervalSamples * repeatCount;
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
            destinationChannel.set(sourceChannel, repeat * intervalSamples);
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
            refScale: processed.refScale,
            acquisitionMethod: processed.acquisitionMethod,
            harmonicAnalysis: processed.harmonicAnalysis
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
                const capturePlan = createEssCapturePlan(
                    sweepBuffer,
                    averagingCount
                );
                const totalPlaybackDuration = capturePlan.playbackSamples / sampleRate;
                console.log(`Sweep duration: ${sweepDuration.toFixed(2)}s, Total playback: ${totalPlaybackDuration.toFixed(2)}s`);
                
                const outputRoute = await prepareMeasurementOutputRoute(
                    audioContext,
                    this.measurementConfig.audioOutputId,
                    outputChannel,
                    {},
                    this.measurementConfig.outputChannelCount ?? explicitOutputChannels
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
                // 0.5s pre-roll + isolated ESS repetitions and tails + 0.5s post-roll
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
                
                // Share the actual capture span, including every ESS tail and pre/post-roll.
                this.startChannelLevelGraph(recordBufferLength / sampleRate);

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
                const finishRecording = async () => {
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

                    try {
                        // Process the recording to extract the impulse response
                        const processStart = performance.now();
                        const processed = await this.processRecordedBuffer(
                            finalBuffer,
                            sweepBuffer,
                            averagingCount,
                            sampleRate,
                            {
                                outputRoute,
                                scheduledPlaybackFrame,
                                captureStartFrame,
                                levelDb: signalLevel,
                                overloaded: hasOverload
                            }
                        );
                        if (operation.settled || this.activeSweepOperation !== operation) return;
                        const frequencyResponse = processed.frequencyResponse;
                        const freqStart = performance.now();
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
     * @param {Object} sweep - Generated ESS excitation and inverse filter
     * @param {number} averagingCount - Number of repetitions
     * @param {number} sampleRate - Sample rate in Hz
     * @returns {Promise<Object>} Linear impulse response and optional harmonic analysis
     */
    async processRecordedBuffer(recordBuffer, sweep, averagingCount, sampleRate, timing = null) {
        const outputTimeReference = outputTimeReferenceForRoute(timing?.outputRoute, timing);
        const settings = {
            repetitions: averagingCount,
            playbackOffsetSamples: outputTimeReference === 'audio-context'
                ? timing.scheduledPlaybackFrame - timing.captureStartFrame
                : Math.round(0.5 * sampleRate),
            outputTimeReference,
            levelDb: timing?.levelDb ?? 0,
            overloaded: Boolean(timing?.overloaded),
            calibration: this.interfaceCalibrationImpulseResponse || null
        };
        let processed;
        if (typeof Worker === 'undefined') {
            // Node test harnesses exercise the same pure analysis used in the browser worker.
            if (typeof window !== 'undefined') throw new Error('Measurement analysis worker unavailable');
            processed = analyzeEssRecording(recordBuffer, sweep, settings);
        } else {
            processed = await new Promise((resolve, reject) => {
                const worker = new Worker(new URL('../../../js/utils/measurement-dsp/analysis-worker.js', import.meta.url), { type: 'module' });
                const elements = this.activeSweepElements;
                const finish = (error, result) => {
                    worker.terminate();
                    if (elements?.analysisWorker === worker) {
                        elements.analysisWorker = null;
                        elements.cancelAnalysis = null;
                    }
                    if (error) reject(error); else resolve(result);
                };
                if (elements) {
                    elements.analysisWorker = worker;
                    elements.cancelAnalysis = () => finish(new SweepCancelledError());
                }
                worker.onmessage = ({ data }) => finish(data.error ? new Error('Measurement analysis failed') : null, data.result);
                worker.onerror = error => finish(error);
                worker.postMessage({ id: 1, type: 'ess', record: { recording: recordBuffer, sweep }, settings }, [recordBuffer.buffer]);
            });
        }
        return { ...processed, impulseResponse: processed.data, analysisImpulseResponse: processed.data,
            sweepLimited: true };
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
            elements.cancelAnalysis?.();
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
    scheduledPlaybackFrameForTime,
    outputTimeReferenceForRoute
};
