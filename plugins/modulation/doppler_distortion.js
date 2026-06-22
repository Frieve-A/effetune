/**
 * Doppler Distortion Plugin
 *
 * Simulates the Doppler effect caused by speaker cone movement
 * using a mass-spring-damper physical model and variable delay lines.
 * Adapts delay buffer size based on sample rate.
 * Formats numeric UI display to omit trailing zeros.
 */
class DopplerDistortionPlugin extends PluginBase {
    constructor() {
        super('Doppler Distortion', 'Simulates Doppler distortion caused by speaker cone movement');

        // --- Default Parameter Values ---
        this.cf = 8.0;   // Coil Force Factor (N / input unit) - Scales input signal to force
        this.sm = 0.03;  // Speaker Mass (kg)
        this.sc = 6000;  // Spring Constant (N/m) - Stiffness of the cone suspension
        this.df = 1.5;   // Damping Factor (N·s/m) - Mechanical resistance / energy loss

        // --- Register the Audio Processor ---
        this.registerProcessor(`
            // --- Constants ---
            const SOUND_SPEED = 343.0; // Speed of sound in air (m/s) at ~20°C

            // --- Helper Function: 4-Point Lagrange Interpolation ---
            function lagrangeInterpolation(buffer, index, size) {
                const x0 = Math.floor(index);
                const frac = index - x0;
                const xm1 = buffer[(x0 - 1 + size) % size];
                const x_0 = buffer[ x0      % size];
                const x_1 = buffer[(x0 + 1) % size];
                const x_2 = buffer[(x0 + 2) % size];
                const c0 = xm1 * (frac - 1.0) * (frac - 2.0) * frac * (-1.0 / 6.0);
                const c1 = x_0 * (frac + 1.0) * (frac - 1.0) * (frac - 2.0) * (1.0 / 2.0);
                const c2 = x_1 * (frac + 1.0) * frac * (frac - 2.0) * (-1.0 / 2.0);
                const c3 = x_2 * (frac + 1.0) * frac * (frac - 1.0) * (1.0 / 6.0);
                return c0 + c1 + c2 + c3;
            }

            // --- Processor Entry Point ---
            if (!parameters.enabled) return data;

            // --- Cache Core Parameters & Calculate Time Step ---
            const { sampleRate, channelCount, blockSize, cf: coilForce, sm: speakerMass, sc: springConstant, df: dampingFactor } = parameters;
            const effectiveSpeakerMass = Math.max(1e-6, speakerMass);
            const dt = 1.0 / sampleRate;
            const halfDt = 0.5 * dt;

            // --- Context Initialization or Re-initialization ---
            if (!context.initialized || context.channelCount !== channelCount || context.sampleRate !== sampleRate) {
                const requiredDelayTimeSeconds = 0.085;
                let bufferSize = Math.ceil(requiredDelayTimeSeconds * sampleRate);
                bufferSize = Math.max(256, bufferSize);
                context.delayBufferSize = bufferSize;
                context.baseDelaySamples = bufferSize / 2.0;
                context.delayBuffers = new Array(channelCount);
                context.delayWriteIndices = new Int32Array(channelCount);
                context.speakerPositions = new Float32Array(channelCount);
                context.speakerVelocities = new Float32Array(channelCount);
                for (let ch = 0; ch < channelCount; ++ch) {
                    context.delayBuffers[ch] = new Float32Array(bufferSize).fill(0.0);
                    context.delayWriteIndices[ch] = 0;
                    context.speakerPositions[ch] = 0.0;
                    context.speakerVelocities[ch] = 0.0;
                }
                context.channelCount = channelCount;
                context.sampleRate = sampleRate;
                context.initialized = true;
            }

            const delayBufferSize = context.delayBufferSize;
            const baseDelaySamples = context.baseDelaySamples;

            // --- Main Processing Loop ---
            for (let ch = 0; ch < channelCount; ++ch) {
                const offset = ch * blockSize;
                const delayBuffer = context.delayBuffers[ch];
                let writeIndex = context.delayWriteIndices[ch];
                let speakerPosition = context.speakerPositions[ch];
                let speakerVelocity = context.speakerVelocities[ch];

                // --- Sample Loop ---
                for (let i = 0; i < blockSize; ++i) {
                    const input = data[offset + i];

                    // --- Speaker Physics Simulation (Velocity Verlet) ---
                    const signalForce = input * coilForce;
                    const springForce = -springConstant * speakerPosition;
                    const dampingForce = -dampingFactor * speakerVelocity;
                    let totalForce = signalForce + springForce + dampingForce;
                    let acceleration = totalForce / effectiveSpeakerMass;
                    const halfStepVelocity = speakerVelocity + acceleration * halfDt;
                    speakerPosition += halfStepVelocity * dt;
                    const newSpringForce = -springConstant * speakerPosition;
                    const newDampingForce = -dampingFactor * halfStepVelocity;
                    totalForce = signalForce + newSpringForce + newDampingForce;
                    acceleration = totalForce / effectiveSpeakerMass;
                    speakerVelocity = halfStepVelocity + acceleration * halfDt;

                    // --- Variable Delay Implementation ---
                    delayBuffer[writeIndex] = input;
                    const delayOffsetSamples = (-speakerPosition / SOUND_SPEED) * sampleRate;
                    let totalDelaySamples = baseDelaySamples + delayOffsetSamples;
                    totalDelaySamples = Math.max(0.0, Math.min(delayBufferSize - 1.00001, totalDelaySamples));
                    let readIndex = writeIndex - totalDelaySamples;
                    readIndex = (readIndex % delayBufferSize + delayBufferSize) % delayBufferSize;
                    const outputSample = lagrangeInterpolation(delayBuffer, readIndex, delayBufferSize);
                    data[offset + i] = outputSample;
                    writeIndex = (writeIndex + 1) % delayBufferSize;
                } // End Sample Loop

                // --- Store Updated State ---
                context.delayWriteIndices[ch] = writeIndex;
                context.speakerPositions[ch] = speakerPosition;
                context.speakerVelocities[ch] = speakerVelocity;
            } // End Channel Loop

            return data;
        `);
    }

    // --- UI Creation ---
    createUI() {
        const container = document.createElement('div');
        container.className = 'doppler-distortion-plugin-ui plugin-parameter-ui';

        // Create UI controls using the base class helper
        container.appendChild(this.createParameterControl('Coil Force', 0.0, 100.0, 0.1, this.cf, this.setCf.bind(this), 'N / V'));
        container.appendChild(this.createParameterControl('Speaker Mass', 0.001, 0.5, 0.001, this.sm, this.setSm.bind(this), 'kg'));
        container.appendChild(this.createParameterControl('Spring Constant', 1, 100000, 10, this.sc, this.setSc.bind(this), 'N/m'));
        container.appendChild(this.createParameterControl('Damping Factor', 0.0, 50.0, 0.1, this.df, this.setDf.bind(this), 'N·s/m'));

        return container;
    }

    // --- Parameter Getters/Setters --- (No changes needed)
    getParameters() {
        return {
            ...super.getParameters(),
            cf: this.cf,
            sm: this.sm,
            sc: this.sc,
            df: this.df,
        };
    }

    setParameters(params) {
        if (params.cf !== undefined) this.cf = this.parseFiniteNumber(params.cf, 0.0, 100.0, this.cf);
        if (params.sm !== undefined) this.sm = this.parseFiniteNumber(params.sm, 0.001, 0.5, this.sm);
        if (params.sc !== undefined) this.sc = this.parseFiniteNumber(params.sc, 1, 100000, this.sc);
        if (params.df !== undefined) this.df = this.parseFiniteNumber(params.df, 0.0, 50.0, this.df);
        if (params.enabled !== undefined) this.enabled = Boolean(params.enabled);
        this.updateParameters();
    }

    setCf(value) { this.setParameters({ cf: value }); }
    setSm(value) { this.setParameters({ sm: value }); }
    setSc(value) { this.setParameters({ sc: value }); }
    setDf(value) { this.setParameters({ df: value }); }
}

// Make the plugin class available globally or via module export
window.DopplerDistortionPlugin = DopplerDistortionPlugin;
