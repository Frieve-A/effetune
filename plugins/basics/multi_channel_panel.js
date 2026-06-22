class MultiChannelPanelPlugin extends PluginBase {
    constructor() {
        super('MultiChannel Panel', 'Control panel for multiple channels');

        // Maximum number of channels
        this.MAX_CHANNELS = 8;

        // Initialize channel parameters with defaults
        this.m = Array(this.MAX_CHANNELS).fill(false); // m1-m8: Mute for each channel
        this.s = Array(this.MAX_CHANNELS).fill(false); // s1-s8: Solo for each channel
        this.v = Array(this.MAX_CHANNELS).fill(0.0);   // v1-v8: Volume for each channel (-20 to +10 dB)
        this.d = Array(this.MAX_CHANNELS).fill(0.0);   // d1-d8: Delay for each channel (0-30ms)
        this.l = Array(this.MAX_CHANNELS - 1).fill(false); // l1-l7: Link to next channel

        // Initialize level measurement arrays
        this.levels = Array(this.MAX_CHANNELS).fill(-96);
        this.peakLevels = Array(this.MAX_CHANNELS).fill(-96);
        this.peakHoldTimes = Array(this.MAX_CHANNELS).fill(0);

        // Constants for level meter
        this.PEAK_HOLD_TIME = 1.0; // seconds
        this.FALL_RATE = 20; // dB per second
        this.lastProcessTime = performance.now() / 1000;
        this.animationFrameId = null;
        this.isVisible = true;

        // Register processor function that measures audio levels over 1/30 second window
        this.registerProcessor(`
            // This function processes audio data for multiple channels.
            // It applies mute, solo, volume, and delay effects, and calculates peak levels for metering.

            // If the plugin is disabled, pass through the input data without modification.
            if (!parameters.enabled) return data;

            // Retrieve essential parameters for processing.
            const inputBufferChannelCount = parameters.channelCount; // Number of channels in the input buffer.
            const numChannelsToProcess = Math.min(inputBufferChannelCount, 8); // Limit processing to a maximum of 8 channels.
            const blockSize = parameters.blockSize;       // The number of samples in each block per channel.
            const sampleRate = parameters.sampleRate;     // The sample rate of the audio context.
            const blocksPerWindow = Math.floor(sampleRate / 30 / blockSize); // Number of blocks in ~1/30 second

            // Get parameter arrays holding the current state for each channel.
            const muteStates = parameters.m;     // Array of mute states (boolean).
            const soloStates = parameters.s;     // Array of solo states (boolean).
            const volumeLevelsDB = parameters.v; // Array of volume levels in dB.
            const delayTimesMs = parameters.d;   // Array of delay times in milliseconds.

            // Initialize or re-initialize delay buffers if necessary.
            // This occurs if buffers don't exist, channel count changes, or the sample rate changes.
            if (!context.delayBuffers ||
                context.delayBuffers.length !== numChannelsToProcess ||
                context.delaySampleRate !== sampleRate) {
                const maxDelayMilliseconds = 30; // Maximum configurable delay.
                // Calculate buffer size based on max delay and sample rate.
                const calculatedMaxDelaySamples = Math.ceil(sampleRate * maxDelayMilliseconds * 0.001);
                const maxDelaySamples = calculatedMaxDelaySamples < 1 ? 1 : calculatedMaxDelaySamples;
                
                context.delayBuffers = Array.from({ length: numChannelsToProcess }, () => new Float32Array(maxDelaySamples));
                context.delayWriteIndices = Array.from({ length: numChannelsToProcess }, () => 0); // Stores the current write position for each delay buffer.
                context.delaySampleRate = sampleRate;
            }

            // Initialize context state for block-based peak tracking over 1/30 second window
            if (!context.peakTrackingInitialized) {
                context.peakBuffers = new Array(numChannelsToProcess)
                    .fill()
                    .map(() => new Float32Array(blocksPerWindow).fill(0));
                context.blockIndex = 0;
                context.blocksPerWindow = blocksPerWindow;
                context.peakTrackingInitialized = true;
            }
            
            // Reset peak tracking state if channel count or window size changes
            if (context.peakBuffers.length !== numChannelsToProcess || context.blocksPerWindow !== blocksPerWindow) {
                context.peakBuffers = new Array(numChannelsToProcess)
                    .fill()
                    .map(() => new Float32Array(blocksPerWindow).fill(0));
                context.blockIndex = 0;
                context.blocksPerWindow = blocksPerWindow;
            }

            // Determine if any channel is currently soloed.
            // This impacts muting logic: if a channel is soloed, all non-soloed channels are muted.
            let isAnyChannelSoloed = false;
            for (let ch = 0; ch < numChannelsToProcess; ch++) {
                if (soloStates[ch]) {
                    isAnyChannelSoloed = true;
                    break;
                }
            }

            // Allocate peak value storage when channel count or block size changes.
            if (!context.currentBlockPeakValues ||
                context.currentBlockPeakValues.length !== numChannelsToProcess ||
                context.currentBlockPeakValuesBlockSize !== blockSize) {
                context.currentBlockPeakValues = new Float32Array(numChannelsToProcess);
                context.currentBlockPeakValuesBlockSize = blockSize;
            }
            const currentBlockPeakValues = context.currentBlockPeakValues;

            // --- Main processing loop for each channel ---
            for (let ch = 0; ch < numChannelsToProcess; ch++) {
                const channelAudioOffset = ch * blockSize; // Offset to the start of the current channel's data in the 'data' array.

                // Get parameters for the current channel.
                const isChannelMuteActive = muteStates[ch];
                const isChannelSoloActive = soloStates[ch];
                const channelVolumeDB = volumeLevelsDB[ch];
                const channelDelayTimeMs = delayTimesMs[ch];

                // Convert volume from decibels to a linear gain factor.
                const linearGain = Math.pow(10, channelVolumeDB / 20);

                // Access the delay buffer and its properties for the current channel.
                const delayBuffer = context.delayBuffers[ch];
                let writeIndex = context.delayWriteIndices[ch];
                const delayBufferLength = delayBuffer.length; // Cache for performance.

                // Convert delay time from milliseconds to samples, clamped to the allocated buffer.
                let delayInSamples = Math.floor(channelDelayTimeMs * sampleRate * 0.001);
                delayInSamples = delayInSamples < 0 ? 0 : (delayInSamples > delayBufferLength ? delayBufferLength : delayInSamples);

                let channelBlockPeak = 0; // Stores the peak absolute sample value for this channel in the current block (pre-gain).

                // Determine if the current channel should be effectively muted based on solo and mute states.
                const shouldEffectivelyMute = (isAnyChannelSoloed && !isChannelSoloActive) || (!isAnyChannelSoloed && isChannelMuteActive);

                // --- Sample processing loop for the current channel ---
                if (delayInSamples === 0) {
                    // Optimized path for channels with no delay.
                    for (let i = 0; i < blockSize; i++) {
                        const sampleIndex = channelAudioOffset + i;
                        const currentSample = data[sampleIndex];

                        // Track peak absolute sample value (pre-gain, pre-mute) for metering.
                        const absSample = Math.abs(currentSample);
                        if (absSample > channelBlockPeak) {
                            channelBlockPeak = absSample;
                        }

                        // Apply gain and mute.
                        const processedSample = shouldEffectivelyMute ? 0 : currentSample * linearGain;
                        data[sampleIndex] = processedSample;

                        // Store the processed sample in the delay buffer. This ensures that if delay is
                        // activated later, the buffer contains relevant processed audio.
                        delayBuffer[writeIndex] = processedSample; 
                        writeIndex = (writeIndex + 1) % delayBufferLength;
                    }
                } else {
                    // Path for channels with active delay.
                    // Calculate the read index for the circular delay buffer.
                    let readIndex = (writeIndex - delayInSamples + delayBufferLength) % delayBufferLength;

                    for (let i = 0; i < blockSize; i++) {
                        const sampleIndex = channelAudioOffset + i;
                        const currentInputSample = data[sampleIndex];

                        // Track peak absolute sample value of the *input* signal (pre-gain, pre-mute) for metering.
                        const absInputSample = Math.abs(currentInputSample);
                        if (absInputSample > channelBlockPeak) {
                            channelBlockPeak = absInputSample;
                        }

                        // Read before writing so the maximum delay, where read and write indices match,
                        // still returns the sample currently stored in the delay line.
                        const delayedSample = delayBuffer[readIndex];

                        // Apply gain and mute to the current input sample before storing it in the delay buffer.
                        const sampleToStoreInDelayBuffer = shouldEffectivelyMute ? 0 : currentInputSample * linearGain;
                        delayBuffer[writeIndex] = sampleToStoreInDelayBuffer;

                        // The output sample is the delayed sample read from the buffer.
                        data[sampleIndex] = delayedSample;

                        // Advance write and read indices for the circular buffer.
                        writeIndex = (writeIndex + 1) % delayBufferLength;
                        readIndex = (readIndex + 1) % delayBufferLength;
                    }
                }

                // Store the updated write index for the next processing block.
                context.delayWriteIndices[ch] = writeIndex;

                // Store block peak in circular buffer for 1/30 second window tracking
                context.peakBuffers[ch][context.blockIndex] = channelBlockPeak;
                
                // Find maximum peak across the stored blocks (~1/30 second window)
                let windowPeak = 0.0;
                for (let i = 0; i < blocksPerWindow; i++) {
                    if (context.peakBuffers[ch][i] > windowPeak) {
                        windowPeak = context.peakBuffers[ch][i];
                    }
                }
                
                // Store the window peak value (pre-gain, pre-mute absolute peak) for this channel.
                // The main thread will use this along with the 'muted' status for meter display.
                currentBlockPeakValues[ch] = windowPeak;
            }
            
            // Advance block index for next processing call
            context.blockIndex = (context.blockIndex + 1) % blocksPerWindow;

            // Prepare measurement data to be sent to the main thread for UI updates.
            const channelMeasurements = new Array(numChannelsToProcess);
            for (let ch = 0; ch < numChannelsToProcess; ch++) {
                const isChannelEffectivelyMuted = (isAnyChannelSoloed && !soloStates[ch]) || (!isAnyChannelSoloed && muteStates[ch]);
                channelMeasurements[ch] = {
                    peak: currentBlockPeakValues[ch], // Raw peak of the input signal for this block.
                    muted: isChannelEffectivelyMuted  // Effective mute state for this channel.
                };
            }

            // Attach measurements to the output data.
            // The original code included 'time: time', but 'time' is not defined in this scope.
            // If timing information is needed, 'currentTime' (from AudioWorkletGlobalScope) should be used.
            data.measurements = {
                channels: channelMeasurements
            };

            return data; // Return the processed audio data.
        `);
    }

    // Get current parameters
    getParameters() {
        return {
            type: this.constructor.name,
            m: this.m,      // Mute states
            s: this.s,      // Solo states
            v: this.v,      // Volume values
            d: this.d,      // Delay values
            l: this.l,      // Link states
            enabled: this.enabled
        };
    }

    // Set parameters
    setParameters(params) {
        // Update mute states
        for (let i = 0; i < this.MAX_CHANNELS; i++) {
            const muteParam = params[`m${i + 1}`] !== undefined ? params[`m${i + 1}`] : params.m?.[i];
            if (muteParam !== undefined) {
                this.m[i] = !!muteParam; // Convert to boolean
            }

            const soloParam = params[`s${i + 1}`] !== undefined ? params[`s${i + 1}`] : params.s?.[i];
            if (soloParam !== undefined) {
                this.s[i] = !!soloParam; // Convert to boolean
            }

            const volParam = params[`v${i + 1}`] !== undefined ? params[`v${i + 1}`] : params.v?.[i];
            if (volParam !== undefined) {
                const value = this.clampVolume(volParam);
                if (value !== null) {
                    this.v[i] = value;
                }
            }

            const delayParam = params[`d${i + 1}`] !== undefined ? params[`d${i + 1}`] : params.d?.[i];
            if (delayParam !== undefined) {
                const value = this.clampDelay(delayParam);
                if (value !== null) {
                    this.d[i] = value;
                }
            }
        }

        // Update link states
        for (let i = 0; i < this.MAX_CHANNELS - 1; i++) {
            const linkParam = params[`l${i + 1}`] !== undefined ? params[`l${i + 1}`] : params.l?.[i];
            if (linkParam !== undefined) {
                this.l[i] = !!linkParam; // Convert to boolean
            }
        }

        // Apply link settings to ensure linked channels have consistent parameters
        this.applyLinkSettings();

        this.updateParameters();

        // Update UI if it exists
        this.updateUIControls();
    }

    // Apply link settings to ensure linked channels have consistent parameters
    applyLinkSettings() {
        // Process each channel to find linked groups
        for (let ch = 0; ch < this.MAX_CHANNELS; ch++) {
            const linkedGroup = this.findLinkedGroup(ch);

            // If this is the first channel in a linked group, propagate its settings to all linked channels
            if (linkedGroup.length > 1 && linkedGroup[0] === ch) {
                for (let i = 1; i < linkedGroup.length; i++) {
                    const linkedChannel = linkedGroup[i];
                    this.m[linkedChannel] = this.m[ch];
                    this.s[linkedChannel] = this.s[ch];
                    this.v[linkedChannel] = this.v[ch];
                    this.d[linkedChannel] = this.d[ch];
                }
            }
        }
    }

    // Update UI controls based on link status
    updateUIControls() {
        if (!this.muteButtons || !this.soloButtons) return;

        // Update control states based on link
        for (let ch = 0; ch < this.MAX_CHANNELS; ch++) {
            // Find the linked group this channel belongs to
            const linkedGroup = this.findLinkedGroup(ch);

            // If this is the first channel in its group, no need to update
            if (linkedGroup.length > 0 && linkedGroup[0] !== ch) {
                // This channel is linked to an earlier channel, update controls
                const sourceChannel = linkedGroup[0];

                // Update button states but don't trigger setParameter calls
                if (this.muteButtons[ch]) {
                    this.muteButtons[ch].style.backgroundColor = this.m[sourceChannel] ? '#AF4C4C' : '';
                }

                if (this.soloButtons[ch]) {
                    this.soloButtons[ch].style.backgroundColor = this.s[sourceChannel] ? '#4CAF50' : '';
                }
            }
        }
    }

    // Find all channels linked to the specified channel
    findLinkedGroup(channel) {
        const group = [channel];

        // Find earlier channels that might be linked to this one
        for (let i = 0; i < channel; i++) {
            let allLinked = true;
            for (let j = i; j < channel; j++) {
                if (!this.l[j]) {
                    allLinked = false;
                    break;
                }
            }

            if (allLinked) {
                // This earlier channel is linked to the target
                return [i, ...group];
            }
        }

        // Find later channels linked to this one
        let currentChannel = channel;
        while (currentChannel < this.MAX_CHANNELS - 1 && this.l[currentChannel]) {
            group.push(currentChannel + 1);
            currentChannel++;
        }

        return group;
    }

    // Convenience setters
    setMute(channel, state) {
        if (channel >= 0 && channel < this.MAX_CHANNELS) {
            // Find linked channels first
            const linkedGroup = this.findLinkedGroup(channel);

            // Set mute state for the primary channel
            this.m[channel] = state;

            // Apply to all linked channels
            for (const linkedChannel of linkedGroup) {
                if (linkedChannel !== channel) {
                    this.m[linkedChannel] = state;
                    if (this.muteButtons && this.muteButtons[linkedChannel]) {
                        this.muteButtons[linkedChannel].style.backgroundColor = state ? '#AF4C4C' : '';
                    }
                }
            }

            // Update processor parameters after all changes
            this.updateParameters();

            // Update UI
            if (this.muteButtons && this.muteButtons[channel]) {
                this.muteButtons[channel].style.backgroundColor = state ? '#AF4C4C' : '';
            }
        }
    }

    setSolo(channel, state) {
        if (channel >= 0 && channel < this.MAX_CHANNELS) {
            // Find linked channels first
            const linkedGroup = this.findLinkedGroup(channel);

            // Set solo state for the primary channel
            this.s[channel] = state;

            // Apply to all linked channels
            for (const linkedChannel of linkedGroup) {
                if (linkedChannel !== channel) {
                    this.s[linkedChannel] = state;
                    if (this.soloButtons && this.soloButtons[linkedChannel]) {
                        this.soloButtons[linkedChannel].style.backgroundColor = state ? '#4CAF50' : '';
                    }
                }
            }

            // Update processor parameters after all changes
            this.updateParameters();

            // Update UI
            if (this.soloButtons && this.soloButtons[channel]) {
                this.soloButtons[channel].style.backgroundColor = state ? '#4CAF50' : '';
            }
        }
    }

    parseFiniteNumber(value) {
        const numValue = typeof value === 'number' ? value : parseFloat(value);
        return Number.isFinite(numValue) ? numValue : null;
    }

    clampVolume(value) {
        const numValue = this.parseFiniteNumber(value);
        if (numValue === null) return null;
        return numValue < -20 ? -20 : (numValue > 10 ? 10 : numValue);
    }

    clampDelay(value) {
        const numValue = this.parseFiniteNumber(value);
        if (numValue === null) return null;
        return numValue < 0 ? 0 : (numValue > 30 ? 30 : numValue);
    }

    syncVolumeControl(channel, value) {
        const slider = document.getElementById(`${this.id}-${this.name}-v${channel + 1}-slider`);
        const input = document.getElementById(`${this.id}-${this.name}-v${channel + 1}-input`);
        if (slider) slider.value = value;
        if (input) input.value = value;
    }

    syncDelayControl(channel, value) {
        const slider = document.getElementById(`${this.id}-${this.name}-d${channel + 1}-slider`);
        const input = document.getElementById(`${this.id}-${this.name}-d${channel + 1}-input`);
        if (slider) slider.value = value;
        if (input) input.value = value;
    }
    setVolume(channel, value) {
        const clampedValue = this.clampVolume(value);
        if (channel >= 0 && channel < this.MAX_CHANNELS && clampedValue !== null) {
            // Find linked channels first
            const linkedGroup = this.findLinkedGroup(channel);

            // Set volume for the primary channel
            this.v[channel] = clampedValue;
            this.syncVolumeControl(channel, clampedValue);

            // Apply to all linked channels
            for (const linkedChannel of linkedGroup) {
                if (linkedChannel !== channel) {
                    this.v[linkedChannel] = clampedValue;
                    this.syncVolumeControl(linkedChannel, clampedValue);
                }
            }

            // Update processor parameters after all changes
            this.updateParameters();
        }
    }

    setDelay(channel, value) {
        const clampedValue = this.clampDelay(value);
        if (channel >= 0 && channel < this.MAX_CHANNELS && clampedValue !== null) {
            // Find linked channels first
            const linkedGroup = this.findLinkedGroup(channel);

            // Set delay for the primary channel
            this.d[channel] = clampedValue;
            this.syncDelayControl(channel, clampedValue);

            // Apply to all linked channels
            for (const linkedChannel of linkedGroup) {
                if (linkedChannel !== channel) {
                    this.d[linkedChannel] = clampedValue;
                    this.syncDelayControl(linkedChannel, clampedValue);
                }
            }

            // Update processor parameters after all changes
            this.updateParameters();
        }
    }

    setLink(channel, state) {
        if (channel >= 0 && channel < this.MAX_CHANNELS - 1) {
            // Set link state
            this.l[channel] = state;

            if (state) {
                // When linking, synchronize the values from the current channel to the next
                this.m[channel + 1] = this.m[channel];
                this.s[channel + 1] = this.s[channel];
                this.v[channel + 1] = this.v[channel];
                this.d[channel + 1] = this.d[channel];

                // Update UI elements
                if (this.muteButtons && this.muteButtons[channel + 1]) {
                    this.muteButtons[channel + 1].style.backgroundColor = this.m[channel] ? '#AF4C4C' : '';
                }

                if (this.soloButtons && this.soloButtons[channel + 1]) {
                    this.soloButtons[channel + 1].style.backgroundColor = this.s[channel] ? '#4CAF50' : '';
                }

                // Update sliders and inputs
                const volSlider = document.getElementById(`${this.id}-${this.name}-v${channel + 2}-slider`);
                const volInput = document.getElementById(`${this.id}-${this.name}-v${channel + 2}-input`);
                const delaySlider = document.getElementById(`${this.id}-${this.name}-d${channel + 2}-slider`);
                const delayInput = document.getElementById(`${this.id}-${this.name}-d${channel + 2}-input`);

                if (volSlider) volSlider.value = this.v[channel];
                if (volInput) volInput.value = this.v[channel];
                if (delaySlider) delaySlider.value = this.d[channel];
                if (delayInput) delayInput.value = this.d[channel];
            }

            // Update link button UI
            if (this.linkButtons && this.linkButtons[channel]) {
                this.linkButtons[channel].style.backgroundColor = state ? '#4CAFAF' : '';
            }

            // Update parameters to ensure consistency in audio processing
            this.updateParameters();
        }
    }

    // Convert amplitude to dB
    amplitudeToDB(amplitude) {
        // Use a small epsilon to prevent log10(0) which is -Infinity.
        const epsilon = 1e-8; 
        return 20 * Math.log10(amplitude < epsilon ? epsilon : amplitude);
    }

    // Handle messages from audio processor
    onMessage(message) {
        if (message.type === 'processBuffer') {
            this.process(message);
        }
    }

    process(message) {
        if (!message?.measurements?.channels) {
            return;
        }

        const time = performance.now() / 1000;
        const deltaTime = time - this.lastProcessTime;
        this.lastProcessTime = time;

        // Check if any channel is soloed (This logic is duplicated from the processor, consider centralizing if possible,
        // but for UI state based on its own parameters, this might be acceptable)
        let anySolo = false;
        for (let ch = 0; ch < this.MAX_CHANNELS; ch++) {
            if (this.s[ch]) { // Using this.s from the main thread instance
                anySolo = true;
                break;
            }
        }

        // Update level measurements
        const numChannels = Math.min(message.measurements.channels.length, this.MAX_CHANNELS);

        for (let ch = 0; ch < numChannels; ch++) {
            const channelPeakRaw = message.measurements.channels[ch].peak; // Raw peak from processor
            const isChannelEffectivelyMuted = message.measurements.channels[ch].muted; // Effective mute state from processor

            // Apply volume adjustment (gain) for metering, reflecting the current fader position.
            // Muting is already factored into 'isChannelEffectivelyMuted' by the processor before sending the peak.
            // However, the UI meter should reflect the level *after* gain and mute.
            // The processor sends raw peak and a mute flag. The UI applies gain to the raw peak if not muted.
            const gain = Math.pow(10, this.v[ch] / 20); // Volume from main thread's state
            const peakAfterGain = isChannelEffectivelyMuted ? 0 : channelPeakRaw * gain;
            const dbLevel = this.amplitudeToDB(peakAfterGain);

            // Update RMS/VU level with fall rate
            const fallingLevel = this.levels[ch] - this.FALL_RATE * deltaTime;
            // Ensure level doesn't fall below -96dB.
            const clampedFallingLevel = Math.max(-96, fallingLevel); 
            this.levels[ch] = Math.max(dbLevel, clampedFallingLevel);

            // Update peak hold
            if (dbLevel > this.peakLevels[ch]) {
                this.peakLevels[ch] = dbLevel;
                this.peakHoldTimes[ch] = time;
            } else if (time > this.peakHoldTimes[ch] + this.PEAK_HOLD_TIME) {
                // If peak hold time has expired, let the peak level fall.
                const fallingPeak = this.peakLevels[ch] - this.FALL_RATE * deltaTime;
                // Peak should not fall below the current RMS/VU level.
                this.peakLevels[ch] = Math.max(fallingPeak, this.levels[ch]); 
            }
        }
    }

    // Create UI
    createUI() {
        const container = document.createElement('div');
        container.className = 'multichannel-panel-ui';

        // Store UI elements for updates
        this.meterCanvases = [];
        this.meterContexts = [];
        this.linkButtons = [];
        this.muteButtons = [];
        this.soloButtons = [];

        // Create channel controls
        for (let ch = 0; ch < this.MAX_CHANNELS; ch++) {
            // Channel container
            const channelContainer = document.createElement('div');
            channelContainer.className = 'multichannel-panel-channel-container';

            // Row 1: Channel name and level meter
            const row1 = document.createElement('div');
            row1.className = 'multichannel-panel-channel-row multichannel-panel-channel-header';

            // Channel label
            const channelLabel = document.createElement('div');
            channelLabel.className = 'multichannel-panel-channel-label';
            channelLabel.textContent = `Ch ${ch + 1}:`;
            row1.appendChild(channelLabel);

            // Level meter
            const meterCanvas = document.createElement('canvas');
            meterCanvas.className = 'multichannel-panel-level-meter';
            meterCanvas.width = 932; // Consider making these configurable or CSS-driven
            meterCanvas.height = 16;
            this.meterCanvases[ch] = meterCanvas;
            this.meterContexts[ch] = meterCanvas.getContext('2d');
            row1.appendChild(meterCanvas);

            channelContainer.appendChild(row1);

            // Row 2: Controls
            const row2 = document.createElement('div');
            row2.className = 'multichannel-panel-channel-row multichannel-panel-channel-controls';

            // Spacer for channel label alignment
            const channelSpace = document.createElement('div');
            channelSpace.className = 'multichannel-panel-channel-space';
            row2.appendChild(channelSpace);

            // Only show link button for channels 1 through MAX_CHANNELS-1
            if (ch < this.MAX_CHANNELS - 1) {
                const linkButton = document.createElement('button');
                linkButton.className = 'multichannel-panel-link-button';
                linkButton.textContent = '🔗'; // Link symbol
                linkButton.title = `Link Channel ${ch + 1} to Channel ${ch + 2}`;
                linkButton.style.width = '21px';
                linkButton.style.height = '21px';
                linkButton.style.backgroundColor = this.l[ch] ? '#4CAFAF' : ''; // Active color
                linkButton.addEventListener('click', () => {
                    this.setLink(ch, !this.l[ch]);
                    // setLink will update UI, but direct feedback can be good too
                    // linkButton.style.backgroundColor = this.l[ch] ? '#4CAFAF' : ''; 
                });
                this.linkButtons[ch] = linkButton;
                channelSpace.appendChild(linkButton);
            }

            // Control buttons container
            const controlsContainer = document.createElement('div');
            controlsContainer.className = 'multichannel-panel-button-controls';

            // Mute button
            const muteButton = document.createElement('button');
            muteButton.className = 'multichannel-panel-mute-button';
            muteButton.textContent = 'M';
            muteButton.title = `Mute Channel ${ch + 1}`;
            muteButton.style.width = '21px';
            muteButton.style.height = '21px';
            muteButton.style.backgroundColor = this.m[ch] ? '#AF4C4C' : ''; // Muted color
            muteButton.addEventListener('click', () => {
                this.setMute(ch, !this.m[ch]);
                // setMute will update UI
            });
            this.muteButtons[ch] = muteButton;
            controlsContainer.appendChild(muteButton);

            // Solo button
            const soloButton = document.createElement('button');
            soloButton.className = 'multichannel-panel-solo-button';
            soloButton.textContent = 'S';
            soloButton.title = `Solo Channel ${ch + 1}`;
            soloButton.style.width = '21px';
            soloButton.style.height = '21px';
            soloButton.style.backgroundColor = this.s[ch] ? '#4CAF50' : ''; // Soloed color
            soloButton.addEventListener('click', () => {
                this.setSolo(ch, !this.s[ch]);
                 // setSolo will update UI
            });
            this.soloButtons[ch] = soloButton;
            controlsContainer.appendChild(soloButton);

            row2.appendChild(controlsContainer);

            // Volume controls
            const volumeLabel = document.createElement('label');
            volumeLabel.textContent = 'Vol (dB):';
            volumeLabel.htmlFor = `${this.id}-${this.name}-v${ch + 1}-slider`;
            row2.appendChild(volumeLabel);

            const volumeSlider = document.createElement('input');
            volumeSlider.type = 'range';
            volumeSlider.id = `${this.id}-${this.name}-v${ch + 1}-slider`;
            volumeSlider.name = `${this.id}-${this.name}-v${ch + 1}-slider`;
            volumeSlider.min = -20;
            volumeSlider.max = 10;
            volumeSlider.step = 0.1;
            volumeSlider.value = this.v[ch];
            volumeSlider.autocomplete = "off";
            volumeSlider.title = `Volume for Channel ${ch + 1}`;
            volumeSlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setVolume(ch, value);
                volumeInput.value = this.v[ch]; // Sync input field after clamp
            });
            row2.appendChild(volumeSlider);

            const volumeInput = document.createElement('input');
            volumeInput.type = 'number';
            volumeInput.id = `${this.id}-${this.name}-v${ch + 1}-input`;
            volumeInput.name = `${this.id}-${this.name}-v${ch + 1}-input`;
            volumeInput.min = -20;
            volumeInput.max = 10;
            volumeInput.step = 0.1;
            volumeInput.value = this.v[ch];
            volumeInput.autocomplete = "off";
            volumeInput.title = `Volume for Channel ${ch + 1}`;
            volumeInput.style.width = '50px';
            volumeInput.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setVolume(ch, value);
                volumeSlider.value = this.v[ch]; // Sync slider after clamp
                volumeInput.value = this.v[ch];
            });
            row2.appendChild(volumeInput);

            // Delay controls
            const delayLabel = document.createElement('label');
            delayLabel.textContent = 'Delay (ms):';
            delayLabel.htmlFor = `${this.id}-${this.name}-d${ch + 1}-slider`;
            row2.appendChild(delayLabel);

            const delaySlider = document.createElement('input');
            delaySlider.type = 'range';
            delaySlider.id = `${this.id}-${this.name}-d${ch + 1}-slider`;
            delaySlider.name = `${this.id}-${this.name}-d${ch + 1}-slider`;
            delaySlider.min = 0;
            delaySlider.max = 30;
            delaySlider.step = 0.01;
            delaySlider.value = this.d[ch];
            delaySlider.autocomplete = "off";
            delaySlider.title = `Delay for Channel ${ch + 1}`;
            delaySlider.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setDelay(ch, value);
                delayInput.value = this.d[ch]; // Sync input field after clamp
            });
            row2.appendChild(delaySlider);

            const delayInput = document.createElement('input');
            delayInput.type = 'number';
            delayInput.id = `${this.id}-${this.name}-d${ch + 1}-input`;
            delayInput.name = `${this.id}-${this.name}-d${ch + 1}-input`;
            delayInput.min = 0;
            delayInput.max = 30;
            delayInput.step = 0.01;
            delayInput.value = this.d[ch];
            delayInput.autocomplete = "off";
            delayInput.title = `Delay for Channel ${ch + 1}`;
            delayInput.style.width = '50px';
            delayInput.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                this.setDelay(ch, value);
                delaySlider.value = this.d[ch]; // Sync slider after clamp
                delayInput.value = this.d[ch];
            });
            row2.appendChild(delayInput);

            channelContainer.appendChild(row2);
            container.appendChild(channelContainer);
        }

        // Start the animation loop for meters
        this.startAnimation();

        return container;
    }

    startAnimation() {
        if (this.animationFrameId) return; // Animation already running

        const animate = () => {
            if (!this.isVisible) { // Stop if UI is not visible
                this.stopAnimation();
                return;
            }
            this.updateMeters();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        animate();
    }

    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    updateMeters() {
        // Update all meter canvases
        for (let ch = 0; ch < this.MAX_CHANNELS; ch++) {
            if (!this.meterContexts[ch]) continue;

            const canvas = this.meterCanvases[ch];
            const ctx = this.meterContexts[ch];
            const width = canvas.width;
            const height = canvas.height;

            // Clear canvas
            ctx.clearRect(0, 0, width, height);
            ctx.fillStyle = '#000000'; // Background color
            ctx.fillRect(0, 0, width, height);

            // Define meter constants
            const dbRange = 96; // e.g., -96dB to 0dB
            const dbMin = -96;  // Minimum dB value for the meter

            // Get current level and peak level for the channel
            const currentLevelDb = this.levels[ch];
            const peakLevelDb = this.peakLevels[ch];

            // Create gradient for the RMS/VU level bar
            const gradient = ctx.createLinearGradient(0, 0, width, 0);
            // Green up to -12dB
            gradient.addColorStop(0, '#008000'); // Dark green
            gradient.addColorStop(Math.max(0, ((-12) - dbMin) / dbRange), '#008000');
            // Yellow from -12dB to -6dB
            gradient.addColorStop(Math.max(0, ((-12) - dbMin) / dbRange), '#808000'); // Dark yellow
            gradient.addColorStop(Math.max(0, ((-6) - dbMin) / dbRange), '#808000');
            // Red from -6dB to 0dB (and above, though 0dB is typically max for digital)
            gradient.addColorStop(Math.max(0, ((-6) - dbMin) / dbRange), '#800000'); // Dark red
            gradient.addColorStop(1, '#800000');

            // Draw RMS/VU level bar
            const levelWidthRatio = (currentLevelDb - dbMin) / dbRange;
            const levelMeterWidth = Math.max(0, Math.min(1, levelWidthRatio)) * width;
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, levelMeterWidth, height);

            // Draw peak hold indicator
            const peakPositionRatio = (peakLevelDb - dbMin) / dbRange;
            const peakMeterPositionX = Math.max(0, Math.min(1, peakPositionRatio)) * width;
            ctx.fillStyle = '#ffffff'; // White color for peak indicator
            ctx.fillRect(peakMeterPositionX - 1, 0, 2, height); // 2px wide peak line

            // Draw grid lines and labels
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; // Light grid lines
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';   // Light text color
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';

            for (let db = dbMin; db <= 0; db += 3) { // Grid line every 3dB
                const xPos = ((db - dbMin) / dbRange) * width;

                // Draw grid line
                ctx.beginPath();
                ctx.moveTo(xPos, 0);
                ctx.lineTo(xPos, height);
                ctx.stroke();

                // Draw label every 12dB (excluding 0dB and min dB for clarity if too cluttered)
                if (db % 12 === 0 && db !== 0 && db !== dbMin) {
                    ctx.fillText(db.toString(), xPos, height - 6);
                }
            }

            // Display peak level value as text
            ctx.fillStyle = '#ffffff';
            ctx.font = '12px Arial';
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            const peakText = peakLevelDb.toFixed(1) + ' dB';
            ctx.fillText(peakText, width - 10, height / 2 + 1);
        }
    }

    cleanup() {
        this.stopAnimation();
        // Any other cleanup (e.g., removing event listeners from global objects if any)
        super.cleanup();
    }
}

// Register the plugin (assuming this is for a specific plugin system)
window.MultiChannelPanelPlugin = MultiChannelPanelPlugin;
