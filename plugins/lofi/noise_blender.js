class NoiseBlenderPlugin extends PluginBase {
    constructor() {
        super('Noise Blender', 'Add noise to the audio signal');
        
        // Initialize parameters
        this.nt = 'pink';    // nt: Noise Type - 'white', 'pink', or 'brown'
        this.lv = -36;       // lv: Level (formerly level) - -96 to 0 dB
        this.pc = true;      // pc: Per Channel (formerly perChannel) - true or false
        this.temporalCapability = 'must-process';
        
        // Initialize noise generation state
        this.registerProcessor(`
            // --- Context Initialization & State Management ---
            const { channelCount, blockSize, enabled } = parameters; // Cache parameters early

            // Initialize pink noise state storage if needed
            // Use Float32Array for performance (index access often faster than property access)
            // Store state variables per channel. Pink: 7 (b0-b6), Brown: 2 (lastBrown, dcOffset)
            const needsPinkInit = !context.pinkNoiseState || context.pinkNoiseState.length !== channelCount;
            const needsBrownInit = !context.brownNoiseState || context.brownNoiseState.length !== channelCount;
            const needsNoiseBufferInit = !context.noiseBuffer || context.noiseBuffer.length !== blockSize;

            if (needsPinkInit) {
                context.pinkNoiseState = new Array(channelCount);
                for (let ch = 0; ch < channelCount; ch++) {
                    context.pinkNoiseState[ch] = new Float32Array(7).fill(0.0); // b0-b6
                }
            }
            if (needsBrownInit) {
                context.brownNoiseState = new Array(channelCount);
                for (let ch = 0; ch < channelCount; ch++) {
                    context.brownNoiseState[ch] = new Float32Array(2).fill(0.0); // lastBrown, dcOffset
                }
            }
            if (needsNoiseBufferInit) {
                context.noiseBuffer = new Float32Array(blockSize);
            }
            // Mark context as initialized after first setup
            if (!context.initialized) context.initialized = true;

            // Early exit if disabled
            if (!enabled) return data;

            // --- Parameter Destructuring & Pre-calculation ---
            const {
                nt: noiseType,    // 'white', 'pink', or 'brown'
                lv: levelDb,      // Level in dB
                pc: perChannel    // Generate noise per channel (boolean)
            } = parameters;

            // Convert dB level to linear gain, handle very low levels efficiently
            const levelGain = (levelDb <= -96.0) ? 0.0 : Math.pow(10.0, levelDb / 20.0);

            // --- Noise Generation ---
            const brownNoiseNormalizationFactor = 0.04166666666666666666666666666667; // Factor to approximate RMS normalization
            const brownDecayAlpha = 0.995; // Decay factor for brown noise DC offset removal

            // Branch based on per-channel generation *before* main loops
            if (perChannel) {
                // --- Generate Unique Noise Per Channel ---
                for (let ch = 0; ch < channelCount; ch++) {
                    const offset = ch * blockSize; // Output buffer offset for this channel
                    // Cache the state array for the current channel
                    const pinkState = context.pinkNoiseState[ch];
                    const brownState = context.brownNoiseState[ch]; // Float32Array([lastBrown, dcOffset])

                    // Select noise generation function *outside* the inner sample loop
                    if (noiseType === 'white') {
                        // White noise generation loop for this channel
                        for (let i = 0; i < blockSize; i++) {
                            const white = Math.random() * 2.0 - 1.0;
                            data[offset + i] += white * levelGain; // Add scaled white noise
                        }
                    } else if (noiseType === 'pink') { // Pink noise generation loop for this channel
                        // Cache state variables locally for the inner loop (read/write)
                        let b0 = pinkState[0], b1 = pinkState[1], b2 = pinkState[2], b3 = pinkState[3];
                        let b4 = pinkState[4], b5 = pinkState[5], b6 = pinkState[6];

                        for (let i = 0; i < blockSize; i++) {
                            const white = Math.random() * 2.0 - 1.0;

                            // Apply Paul Kellett's filter coefficients (optimized access)
                            b0 = 0.99886 * b0 + white * 0.0555179;
                            b1 = 0.99332 * b1 + white * 0.0750759;
                            b2 = 0.96900 * b2 + white * 0.1538520;
                            b3 = 0.86650 * b3 + white * 0.3104856;
                            b4 = 0.55000 * b4 + white * 0.5329522;
                            b5 = -0.7616 * b5 - white * 0.0168980; // Note the sign difference

                            // Calculate pink noise output
                            const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
                            b6 = white * 0.115926; // Update b6 state last

                            // Add scaled pink noise to the output buffer
                            data[offset + i] += pink * levelGain;
                        }

                        // Update the context state array with the final values for this block
                        pinkState[0] = b0; pinkState[1] = b1; pinkState[2] = b2; pinkState[3] = b3;
                        pinkState[4] = b4; pinkState[5] = b5; pinkState[6] = b6;
                    } else { // Brown noise generation loop for this channel
                        let lastBrown = brownState[0];
                        let dcOffset = brownState[1];

                        for (let i = 0; i < blockSize; i++) {
                            const white = Math.random() * 2.0 - 1.0;
                            // Integrate white noise
                            const brown = lastBrown + white;
                            // DC offset removal using exponential decay
                            let output = brown - dcOffset;
                            dcOffset = dcOffset * brownDecayAlpha + (1.0 - brownDecayAlpha) * brown;
                            // Normalize and add scaled brown noise
                            output *= brownNoiseNormalizationFactor; // Apply normalization
                            data[offset + i] += output * levelGain;
                            // Store state for next sample
                            lastBrown = brown; // Store the *un-normalized* value for integration
                        }
                        // Update context state
                        brownState[0] = lastBrown;
                        brownState[1] = dcOffset;
                    } // End noise type check for this channel
                } // End channel loop (perChannel === true)

            } else {
                // --- Generate Single Noise Source, Apply to All Channels ---
                // Use the pre-allocated buffer for the shared noise signal
                const noiseBuffer = context.noiseBuffer;
                // Use state from channel 0 for the shared pink noise generation
                const pinkState = context.pinkNoiseState[0];
                const brownState = context.brownNoiseState[0]; // Use channel 0 state for shared brown noise

                // Select noise generation function *outside* the inner sample loop
                if (noiseType === 'white') {
                    // White noise generation loop (fill noiseBuffer)
                    for (let i = 0; i < blockSize; i++) {
                        const white = Math.random() * 2.0 - 1.0;
                        noiseBuffer[i] = white * levelGain; // Store scaled white noise
                    }
                } else if (noiseType === 'pink') { // Pink noise generation loop (fill noiseBuffer)
                    // Cache state variables locally for the inner loop (read/write)
                    let b0 = pinkState[0], b1 = pinkState[1], b2 = pinkState[2], b3 = pinkState[3];
                    let b4 = pinkState[4], b5 = pinkState[5], b6 = pinkState[6];

                    for (let i = 0; i < blockSize; i++) {
                        const white = Math.random() * 2.0 - 1.0;

                        // Apply Paul Kellett's filter coefficients
                        b0 = 0.99886 * b0 + white * 0.0555179;
                        b1 = 0.99332 * b1 + white * 0.0750759;
                        b2 = 0.96900 * b2 + white * 0.1538520;
                        b3 = 0.86650 * b3 + white * 0.3104856;
                        b4 = 0.55000 * b4 + white * 0.5329522;
                        b5 = -0.7616 * b5 - white * 0.0168980;

                        // Calculate pink noise output
                        const pink = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
                        b6 = white * 0.115926;

                        // Store scaled pink noise in the buffer
                        noiseBuffer[i] = pink * levelGain;
                    }

                    // Update the context state array (channel 0) with the final values
                    pinkState[0] = b0; pinkState[1] = b1; pinkState[2] = b2; pinkState[3] = b3;
                    pinkState[4] = b4; pinkState[5] = b5; pinkState[6] = b6;
                } else { // Brown noise generation loop (fill noiseBuffer)
                    let lastBrown = brownState[0];
                    let dcOffset = brownState[1];

                    for (let i = 0; i < blockSize; i++) {
                        const white = Math.random() * 2.0 - 1.0;
                        const brown = lastBrown + white;
                        let output = brown - dcOffset;
                        dcOffset = dcOffset * brownDecayAlpha + (1.0 - brownDecayAlpha) * brown;
                        output *= brownNoiseNormalizationFactor; // Apply normalization
                        noiseBuffer[i] = output * levelGain; // Store normalized, scaled brown noise
                        lastBrown = brown; // Store the *un-normalized* value for integration
                    }
                    // Update context state (channel 0)
                    brownState[0] = lastBrown;
                    brownState[1] = dcOffset;
                } // End noise type check (shared noise)

                // --- Apply Shared Noise Buffer to All Channels ---
                // Skip if gain is zero
                if (levelGain !== 0.0) {
                    for (let ch = 0; ch < channelCount; ch++) {
                        const offset = ch * blockSize;
                        for (let i = 0; i < blockSize; i++) {
                            data[offset + i] += noiseBuffer[i]; // Add noise from buffer
                        }
                    }
                } // End channel loop (!perChannel)
            } // End perChannel check

            // Return the modified data buffer
            return data;
        `);
    }

    getTemporalCapability() {
        return this.enabled !== false && this.lv > -96 ? 'must-process' : 'reset-on-resume';
    }

    // Get current parameters
    getParameters() {
        return {
            type: this.constructor.name,
            nt: this.nt,
            lv: this.lv,
            pc: this.pc,
            enabled: this.enabled
        };
    }

    // Set parameters
    setParameters(params) {
        if (params.nt !== undefined) {
            this.nt = this.isAllowedEnum(params.nt, ['white', 'pink', 'brown'], this.nt);
        }
        if (params.lv !== undefined) {
            this.lv = this.parseFiniteNumber(params.lv, -96, 0, this.lv);
        }
        if (params.pc !== undefined) {
            this.pc = this.isAllowedEnum(params.pc, [true, false], this.pc);
        }
        if (params.enabled !== undefined) {
            this.enabled = params.enabled;
        }
        this.updateParameters();
    }

    // Create UI
    createUI() {
        const container = document.createElement('div');
        container.className = 'noise-blender-plugin-ui plugin-parameter-ui';

        // Noise Type radio buttons
        const typeRow = document.createElement('div');
        typeRow.className = 'parameter-row';
        const typeLabel = document.createElement('label');
        typeLabel.textContent = 'Noise Type:';
        typeRow.appendChild(typeLabel);

        const typeContainer = document.createElement('div');
        typeContainer.className = 'radio-group';
        const types = ['white', 'pink', 'brown'];
        types.forEach(type => {
            const radioId = `${this.id}-${this.name}-noise-type-${type}`;
            const label = document.createElement('label');
            label.htmlFor = radioId;
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.id = radioId;
            radio.name = `${this.id}-${this.name}-noise-type`;
            radio.value = type;
            radio.checked = this.nt === type;
            radio.autocomplete = "off";
            radio.addEventListener('change', () => {
                if (radio.checked) {
                    this.setParameters({ nt: type });
                }
            });
            label.appendChild(radio);
            label.appendChild(document.createTextNode(type.charAt(0).toUpperCase() + type.slice(1)));
            typeContainer.appendChild(label);
        });
        typeRow.appendChild(typeContainer);
        container.appendChild(typeRow);

        // Use helper for Level control
        container.appendChild(this.createParameterControl(
            'Level', -96, 0, 0.1, this.lv, 
            (value) => this.setParameters({ lv: value }), 'dB'
        ));

        // Per Channel checkbox
        const perChannelRow = document.createElement('div');
        perChannelRow.className = 'parameter-row';
        const perChannelId = `${this.id}-${this.name}-per-channel`;
        const perChannelLabel = document.createElement('label');
        perChannelLabel.textContent = 'Per Channel:';
        perChannelLabel.htmlFor = perChannelId;
        const perChannelCheckbox = document.createElement('input');
        perChannelCheckbox.type = 'checkbox';
        perChannelCheckbox.id = perChannelId;
        perChannelCheckbox.name = perChannelId;
        perChannelCheckbox.checked = this.pc;
        perChannelCheckbox.autocomplete = "off";
        perChannelCheckbox.addEventListener('change', (e) => {
            this.setParameters({ pc: e.target.checked });
        });
        perChannelRow.appendChild(perChannelLabel);
        perChannelRow.appendChild(perChannelCheckbox);
        container.appendChild(perChannelRow);

        return container;
    }
}

// Register plugin
window.NoiseBlenderPlugin = NoiseBlenderPlugin;
