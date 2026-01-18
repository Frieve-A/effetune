class DattorroPlateReverbPlugin extends PluginBase {
    constructor() {
        super('Dattorro Plate Reverb', 'Classic plate reverb based on Dattorro algorithm');

        // Parameter defaults based on Dattorro paper recommendations
        this.pd = 10.0;   // Pre Delay (ms)
        this.bw = 0.9995; // Input Bandwidth
        this.id1 = 0.750; // Input Diffusion 1
        this.id2 = 0.625; // Input Diffusion 2
        this.dc = 0.50;   // Decay
        this.dd1 = 0.70;  // Decay Diffusion 1
        this.dp = 0.0005; // Damping
        this.md = 1.0;    // Mod Depth
        this.mr = 1.0;    // Mod Rate (Hz)
        this.wm = 30;     // Wet Mix (%)
        this.dm = 100;    // Dry Mix (%)

        // Register processor function
        this.registerProcessor(`
            // Skip processing if disabled
            if (!parameters.enabled) return data;

            const channelCount = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate;

            const TWO_PI = 6.283185307179586;
            const HALF_PI = 1.5707963267948966;

            // Original Dattorro sample rate for delay scaling
            const DATTORRO_SAMPLE_RATE = 29761.0;
            const sampleRateScale = sampleRate / DATTORRO_SAMPLE_RATE;

            // Cache parameters
            const p_pd = parameters.pd;
            const p_bw = parameters.bw;
            const p_id1 = parameters.id1;
            const p_id2 = parameters.id2;
            const p_dc = parameters.dc;
            const p_dd1 = parameters.dd1;
            // Decay diffusion 2 derived from decay
            let p_dd2 = p_dc + 0.15;
            if (p_dd2 < 0.25) p_dd2 = 0.25;
            if (p_dd2 > 0.50) p_dd2 = 0.50;
            const p_dp = parameters.dp;
            const p_md = parameters.md;
            const p_mr = parameters.mr;
            const p_wm = parameters.wm;
            const p_dm = parameters.dm;

            // Initialization
            if (!context.initialized || context.sampleRate !== sampleRate) {
                context.sampleRate = sampleRate;

                // Input diffuser delays (scaled from original sample rate)
                context.inputDiffDelay0 = Math.max(1, Math.round((142 - 1) * sampleRateScale) + 1);
                context.inputDiffDelay1 = Math.max(1, Math.round((107 - 1) * sampleRateScale) + 1);
                context.inputDiffDelay2 = Math.max(1, Math.round((379 - 1) * sampleRateScale) + 1);
                context.inputDiffDelay3 = Math.max(1, Math.round((277 - 1) * sampleRateScale) + 1);

                // Tank A delay lines
                context.tankADiff1Size = Math.max(1, Math.round((672 - 1) * sampleRateScale) + 1);
                context.tankADelay1Size = Math.max(1, Math.round((4453 - 1) * sampleRateScale) + 1);
                context.tankADiff2Size = Math.max(1, Math.round((1800 - 1) * sampleRateScale) + 1);
                context.tankADelay2Size = Math.max(1, Math.round((3720 - 1) * sampleRateScale) + 1);

                // Tank B delay lines
                context.tankBDiff1Size = Math.max(1, Math.round((908 - 1) * sampleRateScale) + 1);
                context.tankBDelay1Size = Math.max(1, Math.round((4217 - 1) * sampleRateScale) + 1);
                context.tankBDiff2Size = Math.max(1, Math.round((2656 - 1) * sampleRateScale) + 1);
                context.tankBDelay2Size = Math.max(1, Math.round((3163 - 1) * sampleRateScale) + 1);

                // Pre-delay buffer (max 100ms)
                const maxPreDelaySamples = Math.max(1, Math.ceil(sampleRate * 0.1));
                context.preDelayBuffer = new Float32Array(maxPreDelaySamples).fill(0.0);
                context.preDelayPos = 0;

                // Input low-pass filter state
                context.inputLpfState = 0.0;

                // Input diffuser buffers
                context.inputDiff0Buffer = new Float32Array(context.inputDiffDelay0).fill(0.0);
                context.inputDiff1Buffer = new Float32Array(context.inputDiffDelay1).fill(0.0);
                context.inputDiff2Buffer = new Float32Array(context.inputDiffDelay2).fill(0.0);
                context.inputDiff3Buffer = new Float32Array(context.inputDiffDelay3).fill(0.0);
                context.inputDiff0Pos = 0;
                context.inputDiff1Pos = 0;
                context.inputDiff2Pos = 0;
                context.inputDiff3Pos = 0;

                // Tank A buffers (with extra space for modulation)
                const modBuffer = Math.max(1, Math.ceil((16 + 1) * sampleRateScale)) + 2;
                context.tankADiff1Buffer = new Float32Array(context.tankADiff1Size + modBuffer).fill(0.0);
                context.tankADiff1Pos = 0;
                context.tankADelay1Buffer = new Float32Array(context.tankADelay1Size).fill(0.0);
                context.tankADelay1Pos = 0;
                context.tankADampState = 0.0;
                context.tankADiff2Buffer = new Float32Array(context.tankADiff2Size).fill(0.0);
                context.tankADiff2Pos = 0;
                context.tankADelay2Buffer = new Float32Array(context.tankADelay2Size).fill(0.0);
                context.tankADelay2Pos = 0;

                // Tank B buffers
                context.tankBDiff1Buffer = new Float32Array(context.tankBDiff1Size + modBuffer).fill(0.0);
                context.tankBDiff1Pos = 0;
                context.tankBDelay1Buffer = new Float32Array(context.tankBDelay1Size).fill(0.0);
                context.tankBDelay1Pos = 0;
                context.tankBDampState = 0.0;
                context.tankBDiff2Buffer = new Float32Array(context.tankBDiff2Size).fill(0.0);
                context.tankBDiff2Pos = 0;
                context.tankBDelay2Buffer = new Float32Array(context.tankBDelay2Size).fill(0.0);
                context.tankBDelay2Pos = 0;

                // Cross-feedback and LFO states
                context.tankAOut = 0.0;
                context.tankBOut = 0.0;
                context.lfoPhase1 = 0.0;
                context.lfoPhase2 = HALF_PI;
                context.tankAInterpState = 0.0;
                context.tankBInterpState = 0.0;

                // Left output tap positions
                context.tapL_BDelay1_266 = Math.max(1, Math.round(266 * sampleRateScale));
                context.tapL_BDelay1_2974 = Math.max(1, Math.round(2974 * sampleRateScale));
                context.tapL_BDiff2_1913 = Math.max(1, Math.round(1913 * sampleRateScale));
                context.tapL_BDelay2_1996 = Math.max(1, Math.round(1996 * sampleRateScale));
                context.tapL_ADelay1_1990 = Math.max(1, Math.round(1990 * sampleRateScale));
                context.tapL_ADiff2_187 = Math.max(1, Math.round(187 * sampleRateScale));
                context.tapL_ADelay2_1066 = Math.max(1, Math.round(1066 * sampleRateScale));

                // Right output tap positions
                context.tapR_ADelay1_353 = Math.max(1, Math.round(353 * sampleRateScale));
                context.tapR_ADelay1_3627 = Math.max(1, Math.round(3627 * sampleRateScale));
                context.tapR_ADiff2_1228 = Math.max(1, Math.round(1228 * sampleRateScale));
                context.tapR_ADelay2_2673 = Math.max(1, Math.round(2673 * sampleRateScale));
                context.tapR_BDelay1_2111 = Math.max(1, Math.round(2111 * sampleRateScale));
                context.tapR_BDiff2_335 = Math.max(1, Math.round(335 * sampleRateScale));
                context.tapR_BDelay2_121 = Math.max(1, Math.round(121 * sampleRateScale));

                context.initialized = true;
            }

            // Pre-calculate coefficients
            const preDelaySamples = (p_pd * sampleRate * 0.001) | 0;
            const bandwidth = p_bw;
            const inputDiff1 = p_id1;
            const inputDiff2 = p_id2;
            const decay = p_dc;
            const decayDiff1 = p_dd1;
            const decayDiff2 = p_dd2;
            const damping = p_dp;
            const oneMinusDamping = 1.0 - damping;

            const modDepth = p_md * sampleRateScale;
            const modRate = p_mr;
            const wetMix = p_wm * 0.01;
            const dryMix = p_dm * 0.01;

            const lfoIncrement = (sampleRate > 0) ? (TWO_PI * modRate / sampleRate) : 0.0;

            // Cache buffers locally
            const preDelayBuffer = context.preDelayBuffer;
            const preDelayLength = preDelayBuffer.length;

            const inputDiff0Buffer = context.inputDiff0Buffer;
            const inputDiff1Buffer = context.inputDiff1Buffer;
            const inputDiff2Buffer = context.inputDiff2Buffer;
            const inputDiff3Buffer = context.inputDiff3Buffer;
            const inputDiff0Size = context.inputDiffDelay0;
            const inputDiff1Size = context.inputDiffDelay1;
            const inputDiff2Size = context.inputDiffDelay2;
            const inputDiff3Size = context.inputDiffDelay3;

            const tankADiff1Buffer = context.tankADiff1Buffer;
            const tankADelay1Buffer = context.tankADelay1Buffer;
            const tankADiff2Buffer = context.tankADiff2Buffer;
            const tankADelay2Buffer = context.tankADelay2Buffer;
            const tankADiff1Size = context.tankADiff1Size;
            const tankADelay1Size = context.tankADelay1Size;
            const tankADiff2Size = context.tankADiff2Size;
            const tankADelay2Size = context.tankADelay2Size;

            const tankBDiff1Buffer = context.tankBDiff1Buffer;
            const tankBDelay1Buffer = context.tankBDelay1Buffer;
            const tankBDiff2Buffer = context.tankBDiff2Buffer;
            const tankBDelay2Buffer = context.tankBDelay2Buffer;
            const tankBDiff1Size = context.tankBDiff1Size;
            const tankBDelay1Size = context.tankBDelay1Size;
            const tankBDiff2Size = context.tankBDiff2Size;
            const tankBDelay2Size = context.tankBDelay2Size;

            const tankADiff1BufferLen = tankADiff1Buffer.length;
            const tankBDiff1BufferLen = tankBDiff1Buffer.length;

            // Cache tap positions
            const tapL_BDelay1_266 = context.tapL_BDelay1_266;
            const tapL_BDelay1_2974 = context.tapL_BDelay1_2974;
            const tapL_BDiff2_1913 = context.tapL_BDiff2_1913;
            const tapL_BDelay2_1996 = context.tapL_BDelay2_1996;
            const tapL_ADelay1_1990 = context.tapL_ADelay1_1990;
            const tapL_ADiff2_187 = context.tapL_ADiff2_187;
            const tapL_ADelay2_1066 = context.tapL_ADelay2_1066;
            const tapR_ADelay1_353 = context.tapR_ADelay1_353;
            const tapR_ADelay1_3627 = context.tapR_ADelay1_3627;
            const tapR_ADiff2_1228 = context.tapR_ADiff2_1228;
            const tapR_ADelay2_2673 = context.tapR_ADelay2_2673;
            const tapR_BDelay1_2111 = context.tapR_BDelay1_2111;
            const tapR_BDiff2_335 = context.tapR_BDiff2_335;
            const tapR_BDelay2_121 = context.tapR_BDelay2_121;

            // Local state variables
            let preDelayPos = context.preDelayPos;
            let inputLpfState = context.inputLpfState;
            let inputDiff0Pos = context.inputDiff0Pos;
            let inputDiff1Pos = context.inputDiff1Pos;
            let inputDiff2Pos = context.inputDiff2Pos;
            let inputDiff3Pos = context.inputDiff3Pos;
            let tankADiff1Pos = context.tankADiff1Pos;
            let tankADelay1Pos = context.tankADelay1Pos;
            let tankADiff2Pos = context.tankADiff2Pos;
            let tankADelay2Pos = context.tankADelay2Pos;
            let tankADampState = context.tankADampState;
            let tankBDiff1Pos = context.tankBDiff1Pos;
            let tankBDelay1Pos = context.tankBDelay1Pos;
            let tankBDiff2Pos = context.tankBDiff2Pos;
            let tankBDelay2Pos = context.tankBDelay2Pos;
            let tankBDampState = context.tankBDampState;
            let tankAOut = context.tankAOut;
            let tankBOut = context.tankBOut;
            let lfoPhase1 = context.lfoPhase1;
            let lfoPhase2 = context.lfoPhase2;
            let tankAInterpState = context.tankAInterpState;
            let tankBInterpState = context.tankBInterpState;

            // Process audio
            for (let i = 0; i < blockSize; i++) {
                // Sum input channels to mono
                let inputSample = 0.0;
                for (let ch = 0; ch < channelCount; ch++) {
                    inputSample += data[ch * blockSize + i];
                }
                inputSample /= channelCount;

                // Pre-delay
                let signal;
                if (preDelaySamples > 0 && preDelaySamples < preDelayLength) {
                    let readIdx = preDelayPos - preDelaySamples;
                    if (readIdx < 0) readIdx += preDelayLength;
                    signal = preDelayBuffer[readIdx];
                } else {
                    signal = inputSample;
                }
                preDelayBuffer[preDelayPos] = inputSample;
                if (++preDelayPos >= preDelayLength) preDelayPos = 0;

                // Input low-pass filter (bandwidth control)
                inputLpfState = inputLpfState + bandwidth * (signal - inputLpfState);
                signal = inputLpfState;

                // Input diffusers (4 cascaded allpass filters)
                let delayed0 = inputDiff0Buffer[inputDiff0Pos];
                let temp0 = signal - inputDiff1 * delayed0;
                inputDiff0Buffer[inputDiff0Pos] = temp0;
                signal = delayed0 + inputDiff1 * temp0;
                if (++inputDiff0Pos >= inputDiff0Size) inputDiff0Pos = 0;

                let delayed1 = inputDiff1Buffer[inputDiff1Pos];
                let temp1 = signal - inputDiff1 * delayed1;
                inputDiff1Buffer[inputDiff1Pos] = temp1;
                signal = delayed1 + inputDiff1 * temp1;
                if (++inputDiff1Pos >= inputDiff1Size) inputDiff1Pos = 0;

                let delayed2 = inputDiff2Buffer[inputDiff2Pos];
                let temp2 = signal - inputDiff2 * delayed2;
                inputDiff2Buffer[inputDiff2Pos] = temp2;
                signal = delayed2 + inputDiff2 * temp2;
                if (++inputDiff2Pos >= inputDiff2Size) inputDiff2Pos = 0;

                let delayed3 = inputDiff3Buffer[inputDiff3Pos];
                let temp3 = signal - inputDiff2 * delayed3;
                inputDiff3Buffer[inputDiff3Pos] = temp3;
                signal = delayed3 + inputDiff2 * temp3;
                if (++inputDiff3Pos >= inputDiff3Size) inputDiff3Pos = 0;

                // Update LFO phases
                lfoPhase1 += lfoIncrement;
                lfoPhase2 += lfoIncrement;
                if (lfoPhase1 >= TWO_PI) lfoPhase1 -= TWO_PI;
                if (lfoPhase2 >= TWO_PI) lfoPhase2 -= TWO_PI;

                const lfo1 = Math.sin(lfoPhase1) * modDepth;
                const lfo2 = Math.sin(lfoPhase2) * modDepth;

                // Save previous tank outputs for cross-feedback
                const prevTankAOut = tankAOut;
                const prevTankBOut = tankBOut;

                // Process Tank A
                const tankAInput = signal + decay * prevTankBOut;

                // Modulated allpass with Thiran interpolation
                const tankADiff1Delay = tankADiff1Size + lfo1;
                const tankADiff1DelayInt = tankADiff1Delay | 0;
                const tankADiff1Frac = tankADiff1Delay - tankADiff1DelayInt;
                const tankAAlpha = (1.0 - tankADiff1Frac) / (1.0 + tankADiff1Frac);

                let tankADiff1Idx = tankADiff1Pos - tankADiff1DelayInt;
                if (tankADiff1Idx < 0) tankADiff1Idx += tankADiff1BufferLen;
                const tankACurrentSample = tankADiff1Buffer[tankADiff1Idx];

                let tankADiff1IdxPrev = tankADiff1Idx - 1;
                if (tankADiff1IdxPrev < 0) tankADiff1IdxPrev += tankADiff1BufferLen;
                const tankAPrevSample = tankADiff1Buffer[tankADiff1IdxPrev];

                const tankADiff1Delayed = tankAAlpha * tankACurrentSample + tankAPrevSample - tankAAlpha * tankAInterpState;
                tankAInterpState = tankADiff1Delayed;

                // Decay diffuser 1 (negative coefficient)
                const tankADiff1Temp = tankAInput + decayDiff1 * tankADiff1Delayed;
                tankADiff1Buffer[tankADiff1Pos] = tankADiff1Temp;
                const tankADiff1Out = tankADiff1Delayed - decayDiff1 * tankADiff1Temp;
                if (++tankADiff1Pos >= tankADiff1BufferLen) tankADiff1Pos = 0;

                // Delay line 1
                const tankADelay1Out = tankADelay1Buffer[tankADelay1Pos];
                tankADelay1Buffer[tankADelay1Pos] = tankADiff1Out;
                if (++tankADelay1Pos >= tankADelay1Size) tankADelay1Pos = 0;

                // Damping filter
                tankADampState = tankADampState + oneMinusDamping * (tankADelay1Out - tankADampState);
                const tankADamped = tankADampState * decay;

                // Decay diffuser 2
                const tankADiff2Delayed = tankADiff2Buffer[tankADiff2Pos];
                const tankADiff2Temp = tankADamped - decayDiff2 * tankADiff2Delayed;
                tankADiff2Buffer[tankADiff2Pos] = tankADiff2Temp;
                const tankADiff2Out = tankADiff2Delayed + decayDiff2 * tankADiff2Temp;
                if (++tankADiff2Pos >= tankADiff2Size) tankADiff2Pos = 0;

                // Delay line 2
                const tankADelay2Out = tankADelay2Buffer[tankADelay2Pos];
                tankADelay2Buffer[tankADelay2Pos] = tankADiff2Out;
                if (++tankADelay2Pos >= tankADelay2Size) tankADelay2Pos = 0;

                tankAOut = tankADelay2Out;

                // Process Tank B
                const tankBInput = signal + decay * prevTankAOut;

                // Modulated allpass with Thiran interpolation
                const tankBDiff1Delay = tankBDiff1Size + lfo2;
                const tankBDiff1DelayInt = tankBDiff1Delay | 0;
                const tankBDiff1Frac = tankBDiff1Delay - tankBDiff1DelayInt;
                const tankBAlpha = (1.0 - tankBDiff1Frac) / (1.0 + tankBDiff1Frac);

                let tankBDiff1Idx = tankBDiff1Pos - tankBDiff1DelayInt;
                if (tankBDiff1Idx < 0) tankBDiff1Idx += tankBDiff1BufferLen;
                const tankBCurrentSample = tankBDiff1Buffer[tankBDiff1Idx];

                let tankBDiff1IdxPrev = tankBDiff1Idx - 1;
                if (tankBDiff1IdxPrev < 0) tankBDiff1IdxPrev += tankBDiff1BufferLen;
                const tankBPrevSample = tankBDiff1Buffer[tankBDiff1IdxPrev];

                const tankBDiff1Delayed = tankBAlpha * tankBCurrentSample + tankBPrevSample - tankBAlpha * tankBInterpState;
                tankBInterpState = tankBDiff1Delayed;

                // Decay diffuser 1 (negative coefficient)
                const tankBDiff1Temp = tankBInput + decayDiff1 * tankBDiff1Delayed;
                tankBDiff1Buffer[tankBDiff1Pos] = tankBDiff1Temp;
                const tankBDiff1Out = tankBDiff1Delayed - decayDiff1 * tankBDiff1Temp;
                if (++tankBDiff1Pos >= tankBDiff1BufferLen) tankBDiff1Pos = 0;

                // Delay line 1
                const tankBDelay1Out = tankBDelay1Buffer[tankBDelay1Pos];
                tankBDelay1Buffer[tankBDelay1Pos] = tankBDiff1Out;
                if (++tankBDelay1Pos >= tankBDelay1Size) tankBDelay1Pos = 0;

                // Damping filter
                tankBDampState = tankBDampState + oneMinusDamping * (tankBDelay1Out - tankBDampState);
                const tankBDamped = tankBDampState * decay;

                // Decay diffuser 2
                const tankBDiff2Delayed = tankBDiff2Buffer[tankBDiff2Pos];
                const tankBDiff2Temp = tankBDamped - decayDiff2 * tankBDiff2Delayed;
                tankBDiff2Buffer[tankBDiff2Pos] = tankBDiff2Temp;
                const tankBDiff2Out = tankBDiff2Delayed + decayDiff2 * tankBDiff2Temp;
                if (++tankBDiff2Pos >= tankBDiff2Size) tankBDiff2Pos = 0;

                // Delay line 2
                const tankBDelay2Out = tankBDelay2Buffer[tankBDelay2Pos];
                tankBDelay2Buffer[tankBDelay2Pos] = tankBDiff2Out;
                if (++tankBDelay2Pos >= tankBDelay2Size) tankBDelay2Pos = 0;

                tankBOut = tankBDelay2Out;

                // Output tapping
                let leftOut = 0.0;
                let idx;

                idx = tankBDelay1Pos - tapL_BDelay1_266; if (idx < 0) idx += tankBDelay1Size;
                leftOut += tankBDelay1Buffer[idx];
                idx = tankBDelay1Pos - tapL_BDelay1_2974; if (idx < 0) idx += tankBDelay1Size;
                leftOut += tankBDelay1Buffer[idx];
                idx = tankBDiff2Pos - tapL_BDiff2_1913; if (idx < 0) idx += tankBDiff2Size;
                leftOut -= tankBDiff2Buffer[idx];
                idx = tankBDelay2Pos - tapL_BDelay2_1996; if (idx < 0) idx += tankBDelay2Size;
                leftOut += tankBDelay2Buffer[idx];
                idx = tankADelay1Pos - tapL_ADelay1_1990; if (idx < 0) idx += tankADelay1Size;
                leftOut -= tankADelay1Buffer[idx];
                idx = tankADiff2Pos - tapL_ADiff2_187; if (idx < 0) idx += tankADiff2Size;
                leftOut -= tankADiff2Buffer[idx];
                idx = tankADelay2Pos - tapL_ADelay2_1066; if (idx < 0) idx += tankADelay2Size;
                leftOut -= tankADelay2Buffer[idx];

                let rightOut = 0.0;

                idx = tankADelay1Pos - tapR_ADelay1_353; if (idx < 0) idx += tankADelay1Size;
                rightOut += tankADelay1Buffer[idx];
                idx = tankADelay1Pos - tapR_ADelay1_3627; if (idx < 0) idx += tankADelay1Size;
                rightOut += tankADelay1Buffer[idx];
                idx = tankADiff2Pos - tapR_ADiff2_1228; if (idx < 0) idx += tankADiff2Size;
                rightOut -= tankADiff2Buffer[idx];
                idx = tankADelay2Pos - tapR_ADelay2_2673; if (idx < 0) idx += tankADelay2Size;
                rightOut += tankADelay2Buffer[idx];
                idx = tankBDelay1Pos - tapR_BDelay1_2111; if (idx < 0) idx += tankBDelay1Size;
                rightOut -= tankBDelay1Buffer[idx];
                idx = tankBDiff2Pos - tapR_BDiff2_335; if (idx < 0) idx += tankBDiff2Size;
                rightOut -= tankBDiff2Buffer[idx];
                idx = tankBDelay2Pos - tapR_BDelay2_121; if (idx < 0) idx += tankBDelay2Size;
                rightOut -= tankBDelay2Buffer[idx];

                // Scale output
                leftOut *= 0.6;
                rightOut *= 0.6;

                // Apply wet/dry mix to output
                if (channelCount === 1) {
                    data[i] = data[i] * dryMix + (leftOut + rightOut) * 0.5 * wetMix;
                } else {
                    const dryLeft = data[i];
                    const dryRight = data[blockSize + i];
                    data[i] = dryLeft * dryMix + leftOut * wetMix;
                    data[blockSize + i] = dryRight * dryMix + rightOut * wetMix;
                }
            }

            // Update context state
            context.preDelayPos = preDelayPos;
            context.inputLpfState = inputLpfState;
            context.inputDiff0Pos = inputDiff0Pos;
            context.inputDiff1Pos = inputDiff1Pos;
            context.inputDiff2Pos = inputDiff2Pos;
            context.inputDiff3Pos = inputDiff3Pos;
            context.tankADiff1Pos = tankADiff1Pos;
            context.tankADelay1Pos = tankADelay1Pos;
            context.tankADiff2Pos = tankADiff2Pos;
            context.tankADelay2Pos = tankADelay2Pos;
            context.tankADampState = tankADampState;
            context.tankBDiff1Pos = tankBDiff1Pos;
            context.tankBDelay1Pos = tankBDelay1Pos;
            context.tankBDiff2Pos = tankBDiff2Pos;
            context.tankBDelay2Pos = tankBDelay2Pos;
            context.tankBDampState = tankBDampState;
            context.tankAOut = tankAOut;
            context.tankBOut = tankBOut;
            context.lfoPhase1 = lfoPhase1;
            context.lfoPhase2 = lfoPhase2;
            context.tankAInterpState = tankAInterpState;
            context.tankBInterpState = tankBInterpState;

            return data;
        `);
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            pd: this.pd,
            bw: this.bw,
            id1: this.id1,
            id2: this.id2,
            dc: this.dc,
            dd1: this.dd1,
            dp: this.dp,
            md: this.md,
            mr: this.mr,
            wm: this.wm,
            dm: this.dm
        };
    }

    setParameters(params) {
        if (params.pd !== undefined) this.pd = Math.max(0.0, Math.min(100.0, Number(params.pd)));
        if (params.bw !== undefined) this.bw = Math.max(0.0, Math.min(1.0, Number(params.bw)));
        if (params.id1 !== undefined) this.id1 = Math.max(0.0, Math.min(1.0, Number(params.id1)));
        if (params.id2 !== undefined) this.id2 = Math.max(0.0, Math.min(1.0, Number(params.id2)));
        if (params.dc !== undefined) this.dc = Math.max(0.0, Math.min(1.0, Number(params.dc)));
        if (params.dd1 !== undefined) this.dd1 = Math.max(0.0, Math.min(1.0, Number(params.dd1)));
        if (params.dp !== undefined) this.dp = Math.max(0.0, Math.min(1.0, Number(params.dp)));
        if (params.md !== undefined) this.md = Math.max(0.0, Math.min(16.0, Number(params.md)));
        if (params.mr !== undefined) this.mr = Math.max(0.0, Math.min(10.0, Number(params.mr)));
        if (params.wm !== undefined) this.wm = Math.max(0, Math.min(100, Math.floor(Number(params.wm))));
        if (params.dm !== undefined) this.dm = Math.max(0, Math.min(100, Math.floor(Number(params.dm))));
        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'plugin-parameter-ui';

        container.appendChild(this.createParameterControl('Pre Delay', 0.0, 100.0, 0.1, this.pd, (value) => this.setParameters({ pd: value }), 'ms'));
        container.appendChild(this.createParameterControl('Bandwidth', 0.0, 1.0, 0.001, this.bw, (value) => this.setParameters({ bw: value })));
        container.appendChild(this.createParameterControl('Input Diff 1', 0.0, 1.0, 0.01, this.id1, (value) => this.setParameters({ id1: value })));
        container.appendChild(this.createParameterControl('Input Diff 2', 0.0, 1.0, 0.01, this.id2, (value) => this.setParameters({ id2: value })));
        container.appendChild(this.createParameterControl('Decay', 0.0, 1.0, 0.01, this.dc, (value) => this.setParameters({ dc: value })));
        container.appendChild(this.createParameterControl('Decay Diff 1', 0.0, 1.0, 0.01, this.dd1, (value) => this.setParameters({ dd1: value })));
        container.appendChild(this.createParameterControl('Damping', 0.0, 1.0, 0.001, this.dp, (value) => this.setParameters({ dp: value })));
        container.appendChild(this.createParameterControl('Mod Depth', 0.0, 16.0, 0.1, this.md, (value) => this.setParameters({ md: value }), 'samples'));
        container.appendChild(this.createParameterControl('Mod Rate', 0.0, 10.0, 0.1, this.mr, (value) => this.setParameters({ mr: value }), 'Hz'));
        container.appendChild(this.createParameterControl('Wet Mix', 0, 100, 1, this.wm, (value) => this.setParameters({ wm: value }), '%'));
        container.appendChild(this.createParameterControl('Dry Mix', 0, 100, 1, this.dm, (value) => this.setParameters({ dm: value }), '%'));

        return container;
    }
}

// Register the plugin globally
window.DattorroPlateReverbPlugin = DattorroPlateReverbPlugin;
