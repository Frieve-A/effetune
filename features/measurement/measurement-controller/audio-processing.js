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

import audioUtils from '../audioUtils.js';
import { FFT } from '../audio-utils/index.js';

const AudioProcessing = {
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
    async playAndRecordSweep(sweepBuffer) {
        return new Promise(async (resolve, reject) => {
            try {
                // Reset active elements before starting new sweep
                this.activeSweepElements = {
                    source: null,
                    gainNode: null,
                    recordNode: null,
                    analyzer: null,
                    checkInterval: null,
                    audioElement: null,
                    mediaStreamDestination: null
                };

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
                const totalPlaybackDuration = sweepDuration * (averagingCount + 1); // +1 for safety
                console.log(`Sweep duration: ${sweepDuration.toFixed(2)}s, Total playback: ${totalPlaybackDuration.toFixed(2)}s`);
                
                // Get maximum channel count for selected output device
                const maxChannels = await audioUtils.getDeviceMaxChannelCount(this.measurementConfig.audioOutputId) || 2;
                console.log(`Maximum output channels: ${maxChannels}`);
                
                // Create combined buffer of repeated TSP signals for each channel
                const combinedBufferLength = sweepBuffer.length * (averagingCount + 1);
                
                // Pre-allocate buffer arrays for all channels (Float32Array is zero-initialized)
                const combinedChannelBuffers = [];
                for (let ch = 0; ch < maxChannels; ch++) {
                    combinedChannelBuffers.push(new Float32Array(combinedBufferLength));
                }

                // Copy the sweep into the combined buffer multiple times for each channel
                for (let i = 0; i < averagingCount + 1; i++) {
                    const offset = i * sweepBuffer.length;
                    
                    // Add the sweep signal
                    for (let j = 0; j < sweepBuffer.length; j++) {
                        // Copy to each channel's buffer from the source channel buffers
                        for (let ch = 0; ch < maxChannels; ch++) {
                            if (ch < sweepBuffer.channels.length) {
                                combinedChannelBuffers[ch][offset + j] = sweepBuffer.channels[ch][j];
                            }
                        }
                    }
                }
                
                // Create audio buffer for the combined sweep signal with all channels
                const combinedSweepBuffer = audioContext.createBuffer(
                    maxChannels, combinedBufferLength, sampleRate
                );
                
                // Copy each channel data to audio buffer with error handling
                for (let ch = 0; ch < maxChannels; ch++) {
                    try {
                        if (combinedChannelBuffers[ch] && combinedChannelBuffers[ch].length === combinedBufferLength) {
                            combinedSweepBuffer.copyToChannel(combinedChannelBuffers[ch], ch);
                        } else {
                            console.warn(`Invalid buffer for channel ${ch}`);
                        }
                    } catch (e) {
                        console.warn(`Could not copy to channel ${ch}: ${e.message}`);
                    }
                }
                
                // Clear temporary buffers to free memory
                combinedChannelBuffers.length = 0;
                
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
                this.activeSweepElements.analyzer = analyzer;
                
                let recordNode;
                let recordingStarted = false;
                let recordIndex = 0;
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
                    alert('This browser does not support AudioWorklet. For accurate measurements, please use the latest version of Chrome or Edge.');
                    reject(new Error('AudioWorklet not supported'));
                    return;
                }
                
                try {
                    console.log('Using AudioWorkletNode for recording');
                    
                    // Create recorder worklet node
                    recordNode = await audioUtils.createRecorderWorkletNode(
                        null, // device ID is handled by microphone
                        this.measurementConfig.inputChannel
                    );
                    
                    if (!recordNode) {
                        throw new Error('Failed to create recorder worklet node');
                    }
                    
                    // Store in class variable for later cleanup
                    this.recorderNode = recordNode;
                    // Store in active elements
                    this.activeSweepElements.recordNode = recordNode;
                    
                    // Set up message handling
                    recordNode.port.onmessage = (event) => {
                        if (event.data.status === 'started') {
                            recordingStarted = true;
                            console.log('Recording started');
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
                    if (!audioUtils.microphone) {
                        throw new Error('Microphone source is null. Please ensure microphone access is granted.');
                    }
                    
                    console.log('Connecting microphone to recorder node');
                    // Connect microphone to recorder node and analyzer with error handling
                    try {
                        audioUtils.microphone.connect(recordNode);
                        audioUtils.microphone.connect(analyzer);
                    } catch (connectError) {
                        throw new Error(`Failed to connect microphone: ${connectError.message}`);
                    }
                    
                    // Connect recorder node to destination (needed for WebAudio to work correctly)
                    recordNode.connect(audioContext.destination);
                    
                    // Start recording
                    recordNode.port.postMessage({ command: 'start' });
                    
                } catch (err) {
                    console.error('Failed to create AudioWorkletNode:', err);
                    reject(err);
                    return;
                }
                
                // Track timing
                let startTime = 0;
                let playbackStarted = false;
                let playbackEnded = false;
                
                // Start playback with pre-roll delay
                setTimeout(() => {
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
                        
                        // Get output device ID from measurement config
                        const outputDeviceId = this.measurementConfig.audioOutputId;
                        
                        // Handle output device selection
                        let audioDestination = audioContext.destination;
                        
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
                        
                        // If specific output device is requested, try to use it
                        if (outputDeviceId) {
                            try {
                                console.log(`Attempting to use output device ID: ${outputDeviceId}`);

                                // Create an audio element for output device routing
                                const audioElement = new Audio();
                                const mediaStreamDestination = audioContext.createMediaStreamDestination();

                                // Set media stream destination channel count if possible
                                if (mediaStreamDestination.channelCount !== undefined) {
                                    try {
                                        mediaStreamDestination.channelCount = Math.min(maxChannels, mediaStreamDestination.maxChannelCount || maxChannels);
                                        mediaStreamDestination.channelCountMode = 'explicit';
                                        mediaStreamDestination.channelInterpretation = 'discrete';
                                        console.log(`Set media stream destination channel count to ${mediaStreamDestination.channelCount}`);
                                    } catch (e) {
                                        console.warn('Error setting media stream destination channel count:', e);
                                    }
                                }

                                // Store references for cleanup
                                this.activeSweepElements.audioElement = audioElement;
                                this.activeSweepElements.mediaStreamDestination = mediaStreamDestination;

                                // Connect audio element to media stream
                                audioElement.srcObject = mediaStreamDestination.stream;

                                // Use setSinkId if available
                                if (typeof audioElement.setSinkId === 'function') {
                                    // Execute asynchronously using a Promise
                                    (async () => {
                                        try {
                                            await audioElement.setSinkId(outputDeviceId);
                                            console.log(`Sweep playback output device set to ID: ${outputDeviceId}`);

                                            // Start playback on the audio element
                                            audioElement.play().catch(e => {
                                                console.error('Failed to play audio element:', e);
                                            });
                                        } catch (err) {
                                            console.error('Error in setSinkId:', err);
                                        }
                                    })();

                                    // Use the media stream destination
                                    audioDestination = mediaStreamDestination;
                                } else {
                                    console.warn('setSinkId is not supported in this browser - using default output device');
                                }
                            } catch (error) {
                                console.error('Failed to set output device for sweep playback:', error);
                                // Fall back to default output
                            }
                        }
                        
                        // Connect source -> gain -> output
                        source.connect(gainNode);
                        gainNode.connect(audioDestination);
                        
                        // Store source and gain node in active elements
                        this.activeSweepElements.source = source;
                        this.activeSweepElements.gainNode = gainNode;
                        
                        // Track when playback starts
                        startTime = audioContext.currentTime;
                        playbackStarted = true;
                        console.log(`Playback started at ${startTime}`);
                        
                        // Schedule playback start slightly in the future for better stability
                        const startDelay = 0.05; // 50ms delay
                        source.start(audioContext.currentTime + startDelay);
                        
                        // Track when playback ends
                        source.onended = () => {
                            playbackEnded = true;
                            console.log(`Playback ended at ${audioContext.currentTime}, duration: ${audioContext.currentTime - startTime}s`);
                        };
                        
                        // Safety timeout in case onended doesn't fire
                        setTimeout(() => {
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
                        setTimeout(() => {
                            finishRecording();
                        }, 500);
                    }
                }, 100);
                
                // Store interval in active elements
                this.activeSweepElements.checkInterval = checkInterval;
                
                // Function to clean up and process the recording
                const finishRecording = () => {
                    // Clean up audio nodes
                    try {
                        if (recordNode && recordNode.port) {
                            recordNode.port.onmessage = null; // Remove event listener
                            recordNode.disconnect();
                        }
                        if (analyzer) {
                            analyzer.disconnect();
                        }
                        // Clear active elements references
                        self.activeSweepElements.recordNode = null;
                        self.activeSweepElements.analyzer = null;
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
                    
                    // Process the recording to extract the impulse response
                    const processStart = performance.now();
                    const processedBuffer = this.processRecordedBuffer(finalBuffer, sweepBuffer.length, averagingCount, sampleRate);
                    
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
                    resolve({
                        frequencyResponse: frequencyResponse,
                        hasOverload: hasOverload,
                        maxSignalLevel: maxSignalLevel,
                        fullRecording: finalBuffer,
                        sampleRate: sampleRate
                    });
                };
                
                // Final safety timeout
                setTimeout(() => {
                    if (!playbackEnded || recordNode.connected) {
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
                        
                        reject(new Error('Recording timeout'));
                    }
                }, 2 * (prePostRollTime + totalPlaybackDuration) * 1000);
                
            } catch (error) {
                reject(error);
            }
        });
    },
    
    /**
     * Process the recorded buffer to get impulse response
     * @param {Float32Array} recordBuffer - Full recorded buffer
     * @param {number} sweepLength - Sweep length in samples
     * @param {number} averagingCount - Number of repetitions
     * @param {number} sampleRate - Sample rate in Hz
     * @returns {Float32Array} Processed impulse response
     */
    processRecordedBuffer(recordBuffer, sweepLength, averagingCount, sampleRate) {
        console.time('processRecordedBuffer');
        
        // Log recording information
        console.log(`Recording length: ${recordBuffer.length} samples (${recordBuffer.length/sampleRate}s)`);
        console.log(`Sweep length: ${sweepLength} samples (${sweepLength/sampleRate}s)`);
        
        try {
            // Get inverse filter from audioUtils
            const inverseFilter = audioUtils.lastInverseFilter;
            
            if (!inverseFilter) {
                console.warn('No inverse filter available, returning original recording');
                console.timeEnd('processRecordedBuffer');
                return recordBuffer;
            }
            
            // Assuming there's a pre-roll time before the actual sweep
            const preRollTime = 0.5; // seconds
            const preRollSamples = Math.floor(preRollTime * sampleRate);
            
            // Extract segments based on averaging count
            const segments = [];
            const avgLength = sweepLength * 2; // Double length for convolution result
            
            for (let i = 0; i < averagingCount; i++) {
                const startOffset = preRollSamples + (i * sweepLength);
                
                // Skip if not enough samples
                if (startOffset + avgLength > recordBuffer.length) {
                    console.warn(`Not enough samples for segment ${i+1}`);
                    continue;
                }
                
                // Extract segment using subarray (more efficient)
                const segment = recordBuffer.subarray(startOffset, startOffset + avgLength);
                segments.push(new Float32Array(segment)); // Create a copy for processing
            }
            
            console.log(`Created ${segments.length} segments for averaging`);
            
            // Process each segment to get impulse response
            const processedSegments = [];
            for (let i = 0; i < segments.length; i++) {
                // Get FFT size that can fit both signals
                const paddedSize = Math.pow(2, Math.ceil(Math.log2(segments[i].length + inverseFilter.length - 1)));
                const fft = new FFT(paddedSize);
                
                // Prepare arrays for FFT
                const signalReal = new Float32Array(paddedSize);
                const signalImag = new Float32Array(paddedSize);
                const filterReal = new Float32Array(paddedSize);
                const filterImag = new Float32Array(paddedSize);
                const resultReal = new Float32Array(paddedSize);
                const resultImag = new Float32Array(paddedSize);
                
                // Copy segments with zero padding
                signalReal.set(segments[i]);
                filterReal.set(inverseFilter);
                
                // Transform to frequency domain
                fft.transform(resultReal, resultImag, signalReal, signalImag);
                const signal1Real = new Float32Array(resultReal);
                const signal1Imag = new Float32Array(resultImag);
                
                fft.transform(resultReal, resultImag, filterReal, filterImag);
                
                // Multiply in frequency domain (convolution in time domain)
                for (let j = 0; j < paddedSize; j++) {
                    const real1 = signal1Real[j];
                    const imag1 = signal1Imag[j];
                    const real2 = resultReal[j];
                    const imag2 = resultImag[j];
                    
                    resultReal[j] = real1 * real2 - imag1 * imag2;
                    resultImag[j] = real1 * imag2 + imag1 * real2;
                }
                
                // Transform back to time domain
                fft.inverseTransform(resultReal, resultImag, resultReal, resultImag);
                
                // Copy result
                const impulseResponse = new Float32Array(avgLength);
                for (let j = 0; j < avgLength; j++) {
                    impulseResponse[j] = resultReal[j];
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
                result = recordBuffer;
            }
            
            console.timeEnd('processRecordedBuffer');
            return result;
            
        } catch (error) {
            console.error('Error processing recorded buffer:', error);
            console.timeEnd('processRecordedBuffer');
            return recordBuffer;
        }
    },
    
    /**
     * Stop active sweep playback
     * This is used to clean up active sweep playback when measurement is cancelled
     */
    stopSweepPlayback() {
        console.log('Stopping active sweep playback');
        
        // Clean up active elements
        if (this.activeSweepElements) {
            // Stop source if it exists
            if (this.activeSweepElements.source) {
                try {
                    this.activeSweepElements.source.stop();
                    this.activeSweepElements.source.disconnect();
                } catch (e) {
                    console.warn('Error stopping sweep source:', e);
                }
                this.activeSweepElements.source = null;
            }
            
            // Disconnect gain node
            if (this.activeSweepElements.gainNode) {
                try {
                    this.activeSweepElements.gainNode.disconnect();
                } catch (e) {
                    console.warn('Error disconnecting gain node:', e);
                }
                this.activeSweepElements.gainNode = null;
            }
            
            // Stop audio element if it exists
            if (this.activeSweepElements.audioElement) {
                try {
                    this.activeSweepElements.audioElement.pause();
                    this.activeSweepElements.audioElement.srcObject = null;
                } catch (e) {
                    console.warn('Error stopping audio element:', e);
                }
                this.activeSweepElements.audioElement = null;
            }
            
            // Disconnect media stream destination
            if (this.activeSweepElements.mediaStreamDestination) {
                try {
                    this.activeSweepElements.mediaStreamDestination.disconnect();
                } catch (e) {
                    console.warn('Error disconnecting media stream destination:', e);
                }
                this.activeSweepElements.mediaStreamDestination = null;
            }
            
            // Clean up other elements
            if (this.activeSweepElements.analyzer) {
                try {
                    this.activeSweepElements.analyzer.disconnect();
                } catch (e) {
                    console.warn('Error disconnecting analyzer:', e);
                }
                this.activeSweepElements.analyzer = null;
            }
            
            if (this.activeSweepElements.recordNode) {
                try {
                    this.activeSweepElements.recordNode.port.postMessage({ command: 'stop' });
                    this.activeSweepElements.recordNode.disconnect();
                } catch (e) {
                    console.warn('Error stopping record node:', e);
                }
                this.activeSweepElements.recordNode = null;
            }
            
            if (this.activeSweepElements.checkInterval) {
                clearInterval(this.activeSweepElements.checkInterval);
                this.activeSweepElements.checkInterval = null;
            }
            
            console.log('Sweep playback stopped successfully');
        }
    }
};

export default AudioProcessing;