class PitchShifterPlugin extends PluginBase {
    constructor() {
        super('Pitch Shifter', 'Change the pitch of audio');

        // Initialize parameters
        this.ps = 0;      // Pitch Shift (semitones), range: -6 to +6
        this.ft = 0;      // Fine Tune (cents), range: -50 to +50
        this.ws = 150;    // Window Size (ms), range: 80-500ms (1ms step)
        this.xf = 35;     // XFade Time (ms), range: 20-40ms (0.1ms step)

        // Register signal processing code as a string
        this.registerProcessor(`
            const { ps, ft, ws, xf, channelCount, blockSize, sampleRate } = parameters;

            // Calculate pitch factor (avoiding Math.pow if pitch is unchanged)
            // ps: semitones, ft: fine tune cents
            let pitchFactor = 1.0;
            if (ps !== 0 || ft !== 0) {
                pitchFactor = Math.pow(2, ps / 12 + ft / 1200);
                // Handle potential NaN/Infinity from Math.pow
                if (!(pitchFactor > 0.0 && pitchFactor < Infinity)) { // Faster than !isFinite() && > 0
                     pitchFactor = 1.0;
                }
            }

            // Early exit if processing is disabled or pitch factor is 1.0 (no change)
            if (!parameters.enabled || pitchFactor === 1.0) {
                return data; // Return original data directly
            }

            // Convert window size from ms to samples (use bitwise OR for flooring positive numbers)
            const windowSize = (ws * sampleRate / 1000) | 0;
            // Convert XFade (hop) time from ms to samples
            const hopSize = (xf * sampleRate / 1000) | 0;
            // Ensure hopSize is valid
            const effectiveHopSize = (hopSize > 0 && hopSize < windowSize) ? hopSize : (windowSize / 2) | 0; // Default to half window if invalid

            // Calculate required buffer size (at least 2 windows + hop)
            // Needs enough space to write a full window while reading potentially pitch-shifted data
            const bufferSize = windowSize * 3; // Maintain original buffer sizing logic

            // Check if context needs initialization or reset
            const needsReset = !context.initialized ||
                               context.inputBuffer?.length !== channelCount ||
                               context.windowSize !== windowSize ||
                               context.hopSize !== effectiveHopSize; // Added hopSize check

            if (needsReset) {
                context.windowSize = windowSize;
                context.hopSize = effectiveHopSize; // Store effective hop size
                context.inputBuffer = new Array(channelCount);
                context.outputBuffer = new Array(channelCount);
                context.windowedFrame = new Array(channelCount); // Pre-allocate window buffer
                context.inputWriteIndex = new Array(channelCount).fill(0);
                context.processCounter = new Array(channelCount).fill(0);
                context.outputWriteIndex = new Array(channelCount).fill(0);
                context.outputReadPos = new Array(channelCount).fill(0.0);

                for (let ch = 0; ch < channelCount; ch++) {
                    // Allocate Float32Arrays for audio data
                    context.inputBuffer[ch] = new Float32Array(windowSize);
                    context.outputBuffer[ch] = new Float32Array(bufferSize);
                    context.windowedFrame[ch] = new Float32Array(windowSize); // Pre-allocate
                    // Note: Indices and counters are already initialized with fill(0)
                }
                context.initialized = true;
            }

            // Use the effective hop size stored in context
            const currentHopSize = context.hopSize;
            const oneOverHopSize = 1.0 / currentHopSize; // Pre-calculate for window function

            // Target number of samples needed in output buffer for continuous reading
            // Add a buffer margin (e.g., 1 sample) for floating point comparisons
            const targetUnread = currentHopSize * pitchFactor + 1;

            // --- Main Processing Loop per Channel ---
            for (let ch = 0; ch < channelCount; ch++) {
                // --- Cache context variables locally for faster access ---
                const inBuf = context.inputBuffer[ch];
                const outBuf = context.outputBuffer[ch];
                const windowedFrame = context.windowedFrame[ch]; // Use pre-allocated buffer
                let inputWriteIndex = context.inputWriteIndex[ch];
                let processCounter = context.processCounter[ch];
                let outputWriteIndex = context.outputWriteIndex[ch];
                // outputReadPos is handled separately in the output section

                const inOffset = ch * blockSize; // Input offset for this channel

                // --- Input Buffering and Processing Trigger ---
                for (let i = 0; i < blockSize; i++) {
                    // Write input sample to circular buffer
                    inBuf[inputWriteIndex] = data[inOffset + i];

                    // Increment write index (manual modulo for potential speedup)
                    inputWriteIndex++;
                    if (inputWriteIndex === windowSize) {
                        inputWriteIndex = 0;
                    }
                    processCounter++;

                    // Calculate unread samples in output buffer (integer operations)
                    // Needs floor of read pos - use local copy updated later
                    const floorReadPos = context.outputReadPos[ch] | 0; // Use bitwise OR for floor
                    let unread = outputWriteIndex - floorReadPos;
                    if (unread < 0) { // Manual modulo for negative results
                        unread += bufferSize;
                    }

                    // --- Process Frame when needed and possible ---
                    // Process if output buffer runs low AND enough input samples are available
                    while (unread < targetUnread && processCounter >= windowSize) {
                        // Apply window function to the frame in input buffer
                        // The window is shaped like: / (sqrt ramp up, flat top, sqrt ramp down)
                        for (let j = 0; j < windowSize; j++) {
                            // Calculate read index for input buffer (circular)
                            let readIndex = inputWriteIndex + j;
                            if (readIndex >= windowSize) { // Manual modulo
                                readIndex -= windowSize;
                            }
                            const inputSample = inBuf[readIndex];

                            // Apply window gain
                            let windowGain;
                            if (j < currentHopSize) {
                                // Ramp up (sqrt shape)
                                windowGain = Math.sqrt((j + 1) * oneOverHopSize);
                            } else if (j < windowSize - currentHopSize) {
                                // Flat top (gain = 1)
                                windowGain = 1.0;
                            } else {
                                // Ramp down (sqrt shape)
                                windowGain = Math.sqrt((windowSize - j) * oneOverHopSize);
                            }
                            windowedFrame[j] = inputSample * windowGain;
                        }

                        // Overlap-add windowed frame to output buffer
                        for (let j = 0; j < windowSize; j++) {
                            // Calculate write index for output buffer (circular)
                            let writeIndex = outputWriteIndex + j;
                            if (writeIndex >= bufferSize) { // Manual modulo
                                writeIndex -= bufferSize;
                            }

                            // Add during overlap, replace otherwise
                            if (j < currentHopSize) {
                                outBuf[writeIndex] += windowedFrame[j];
                            } else {
                                outBuf[writeIndex] = windowedFrame[j];
                            }
                        }

                        // Advance output write index (by window size - hop size)
                        const advance = windowSize - currentHopSize;
                        outputWriteIndex += advance;
                        if (outputWriteIndex >= bufferSize) { // Manual modulo
                           outputWriteIndex -= bufferSize;
                        }

                        // Decrease process counter (consumed one window)
                        processCounter -= currentHopSize; // Consume hopSize samples worth of processing count

                         // Recalculate unread samples for the while loop condition
                        const currentFloorReadPos = context.outputReadPos[ch] | 0;
                        unread = outputWriteIndex - currentFloorReadPos;
                        if (unread < 0) {
                            unread += bufferSize;
                        }
                    } // End while (process frame)
                } // End for (input samples)

                // --- Update context with modified local variables ---
                context.inputWriteIndex[ch] = inputWriteIndex;
                context.processCounter[ch] = processCounter;
                context.outputWriteIndex[ch] = outputWriteIndex;
                // Note: outputReadPos updated in the output section below

            } // End for (channels)


            // --- Output Generation ---
            // Allocate/reuse final output buffer when block size changes
            if (!context.finalOutput || context.finalOutput.length !== data.length) {
                context.finalOutput = new Float32Array(data.length);
            }
            const finalOutput = context.finalOutput;

            for (let ch = 0; ch < channelCount; ch++) {
                const outBuf = context.outputBuffer[ch];
                const outOffset = ch * blockSize;
                let readPos = context.outputReadPos[ch]; // Get current read position

                // Handle potential non-finite read position (e.g., after reset)
                // Check > 0 && < Infinity might be slightly faster than isFinite sometimes
                if (!(readPos >= 0.0 && readPos < bufferSize)) {
                     readPos = 0.0;
                }

                // Recalculate unread samples based on potentially updated write index
                const outputWriteIndex = context.outputWriteIndex[ch]; // Get latest write index
                const floorReadPos = readPos | 0;
                let unread = outputWriteIndex - floorReadPos;
                if (unread < 0) {
                    unread += bufferSize;
                }

                // Only generate output if enough data is available
                if (unread >= targetUnread) {
                    for (let i = 0; i < blockSize; i++) {
                        // Calculate integer index and fractional part for interpolation
                        const currentReadPosInt = readPos | 0; // Faster floor
                        const frac = readPos - currentReadPosInt; // Faster frac

                        // Optimized index calculation (manual modulo)
                        // Assumes readPos is kept within [0, bufferSize) by the wrap-around logic
                        let intIndex = currentReadPosInt;
                        // No need for '% bufferSize' if readPos is correctly wrapped below
                        // if (intIndex >= bufferSize) intIndex -= bufferSize; // Should not happen if wrapped

                        // Calculate next index for interpolation (manual modulo)
                        let nextIndex = intIndex + 1;
                        if (nextIndex === bufferSize) {
                            nextIndex = 0;
                        }

                        // Linear interpolation
                        const sample1 = outBuf[intIndex];
                        const sample2 = outBuf[nextIndex];
                        finalOutput[outOffset + i] = sample1 + (sample2 - sample1) * frac; // (1-frac)*s1 + frac*s2 = s1 + (s2-s1)*frac

                        // Advance read position by pitch factor
                        readPos += pitchFactor;

                        // Wrap read position around the buffer (manual modulo)
                        // It's crucial to keep readPos within [0, bufferSize)
                        if (readPos >= bufferSize) {
                             // Use while loop for safety in case pitchFactor is very large (unlikely but safe)
                             while (readPos >= bufferSize) {
                                 readPos -= bufferSize;
                             }
                        }
                        // Should not become negative if pitchFactor > 0 and starts >= 0
                    }
                } else {
                    // Not enough data - output silence or handle differently?
                    // Original code implies outputting whatever is interpolated, which might be old data/zeros if buffer runs dry.
                    // For safety and matching potential original behaviour (though risky if buffer is truly empty),
                    // let's replicate the read logic but it might produce artifacts.
                    // A safer alternative would be to output zeros:
                    // for (let i = 0; i < blockSize; i++) { finalOutput[outOffset + i] = 0.0; }
                    // Replicating original's implied behaviour:
                     for (let i = 0; i < blockSize; i++) {
                        const currentReadPosInt = readPos | 0;
                        const frac = readPos - currentReadPosInt;
                        let intIndex = currentReadPosInt;
                        let nextIndex = intIndex + 1;
                        if (nextIndex === bufferSize) nextIndex = 0;

                        const sample1 = outBuf[intIndex];
                        const sample2 = outBuf[nextIndex];
                        finalOutput[outOffset + i] = sample1 + (sample2 - sample1) * frac;
                        readPos += pitchFactor;
                         if (readPos >= bufferSize) {
                             while (readPos >= bufferSize) readPos -= bufferSize;
                         }
                    }
                     // Consider adding a warning or different handling for buffer underrun
                }

                // Update context with the final read position for this channel
                context.outputReadPos[ch] = readPos;
            }

            // Copy final output back to the provided buffer
            data.set(finalOutput);
            return data;
        `);
    }

    getParameters() {
        return {
            type: this.constructor.name,
            ps: this.ps,
            ft: this.ft,
            ws: this.ws,
            xf: this.xf,
            enabled: this.enabled
        };
    }

    setParameters(params) {
        if (params.ps !== undefined) {
            const rounded = Math.round(this.parseFiniteNumber(params.ps, -6, 6, this.ps));
            this.ps = rounded < -6 ? -6 : (rounded > 6 ? 6 : rounded);
        }
        if (params.ft !== undefined) {
            const rounded = Math.round(this.parseFiniteNumber(params.ft, -50, 50, this.ft));
            this.ft = rounded < -50 ? -50 : (rounded > 50 ? 50 : rounded);
        }
        if (params.ws !== undefined) {
            const size = this.parseFiniteNumber(params.ws, 80, 500, this.ws);
            // Window Size range: 80-500ms (1ms step)
            const rounded = Math.round(size);
            this.ws = rounded < 80 ? 80 : (rounded > 500 ? 500 : rounded);
        }
        if (params.xf !== undefined) {
            const xfade = this.parseFiniteNumber(params.xf, 20, 40, this.xf);
            // XFade Time range: 20-40ms (0.1ms step)
            const rounded = Math.round(xfade * 10) / 10;
            this.xf = rounded < 20 ? 20 : (rounded > 40 ? 40 : rounded);
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        this.updateParameters();
    }

    setPitchShifter(value) {
        this.setParameters({ ps: value });
    }

    setFineTune(value) {
        this.setParameters({ ft: value });
    }

    setWindowSize(value) {
        this.setParameters({ ws: value });
    }

    setXFadeTime(value) {
        this.setParameters({ xf: value });
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'pitch-shift-plugin-ui plugin-parameter-ui';

        // Use base helper to create controls
        container.appendChild(this.createParameterControl(
            'Pitch Shift', -6, 6, 1, this.ps,
            this.setPitchShifter.bind(this), 'semitones'
        ));

        container.appendChild(this.createParameterControl(
            'Fine Tune', -50, 50, 1, this.ft,
            this.setFineTune.bind(this), 'cents'
        ));

        container.appendChild(this.createParameterControl(
            'Window Size', 80, 500, 1, this.ws,
            this.setWindowSize.bind(this), 'ms'
        ));

        container.appendChild(this.createParameterControl(
            'XFade Time', 20, 40, 0.1, this.xf,
            this.setXFadeTime.bind(this), 'ms'
        ));

        return container;
    }
}

window.PitchShifterPlugin = PitchShifterPlugin;
