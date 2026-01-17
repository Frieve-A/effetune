class DelayPlugin extends PluginBase {
    constructor() {
        super('Delay', 'Feedback delay with damping controls');

        // Parameters (defaults)
        this.pd = 0;      // Pre-Delay (ms)
        this.ds = 150;    // Delay Size (ms)
        this.dp = 50;     // Damping (%): 0 = no filter, 100 = fully filtered in feedback path
        this.hd = 5000;   // High Damp cutoff (Hz)  -> low-pass
        this.ld = 100;    // Low Damp cutoff (Hz)   -> high-pass
        this.mx = 16;     // Wet/Dry Mix (%)
        this.fb = 50;     // Feedback (%)
        this.pp = 0;      // Ping-Pong (%)

        this.registerProcessor(`
            if (!parameters.enabled) return data;

            const channelCount = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate;
            const twoPI = 2.0 * Math.PI;

            const initializeContext = (ctx, chCount, sRate) => {
                ctx.sampleRate = sRate;

                // +1 to allow exact max delay without aliasing to 0 in a ring buffer
                const maxPreDelaySamples = Math.ceil(sRate * 0.1) + 1; // up to 100ms
                const maxDelaySamples    = Math.ceil(sRate * 5.0) + 1; // up to 5s

                ctx.preDelayBuffer = new Array(chCount);
                ctx.delayBuffer    = new Array(chCount);

                // Filter states:
                // ldState = low-pass state at (Low Damp cutoff) used to form high-pass by subtraction
                // hdState = low-pass state at (High Damp cutoff) applied after high-pass (band-pass overall)
                ctx.hdState = new Float32Array(chCount).fill(0.0);
                ctx.ldState = new Float32Array(chCount).fill(0.0);

                for (let ch = 0; ch < chCount; ch++) {
                    ctx.preDelayBuffer[ch] = {
                        buffer: new Float32Array(maxPreDelaySamples),
                        pos: 0,
                        length: maxPreDelaySamples
                    };
                    ctx.delayBuffer[ch] = {
                        buffer: new Float32Array(maxDelaySamples),
                        pos: 0,
                        length: maxDelaySamples
                    };
                }

                ctx.channelCount = chCount;
                ctx.initialized = true;
            };

            if (!context.initialized || context.sampleRate !== sampleRate || context.channelCount !== channelCount) {
                initializeContext(context, channelCount, sampleRate);
            }

            const preDelayBuffers = context.preDelayBuffer;
            const delayBuffers    = context.delayBuffer;
            const hdStates        = context.hdState;
            const ldStates        = context.ldState;

            const maxPreDelayLen = preDelayBuffers[0].length;
            const maxDelayLen    = delayBuffers[0].length;

            // Clamp to ring-buffer usable range [0..len-1] (len would fold to 0)
            const preDelaySamples = Math.max(
                0,
                Math.min(maxPreDelayLen - 1, Math.floor(parameters.pd * sampleRate * 0.001))
            );
            const delaySamples = Math.max(
                1,
                Math.min(maxDelayLen - 1, Math.floor(parameters.ds * sampleRate * 0.001))
            );

            const dampAmount = Math.max(0.0, Math.min(1.0, parameters.dp * 0.01));
            const oneMinusDampAmount = 1.0 - dampAmount;

            const nyquist = 0.5 * sampleRate;

            // Ensure cutoffs are valid and ordered (ld <= hd) for a sensible band-pass in feedback
            let hdCutoff = Math.max(20.0, Math.min(nyquist - 1.0, parameters.hd));
            let ldCutoff = Math.max(20.0, Math.min(nyquist - 1.0, parameters.ld));
            if (ldCutoff > hdCutoff) {
                const tmp = ldCutoff;
                ldCutoff = hdCutoff;
                hdCutoff = tmp;
            }

            // 1-pole low-pass pole coefficients
            const aHD = Math.exp(-twoPI * hdCutoff / sampleRate);
            const aLD = Math.exp(-twoPI * ldCutoff / sampleRate);

            const feedbackGain = Math.max(0.0, Math.min(0.99, parameters.fb * 0.01));

            // Constant-power wet/dry
            const wetMix = Math.max(0.0, Math.min(1.0, parameters.mx * 0.01));
            const angle = wetMix * (Math.PI * 0.5);
            const dryGain = Math.cos(angle);
            const wetGain = Math.sin(angle);

            const pingPongMix = Math.max(0.0, Math.min(1.0, parameters.pp * 0.01));
            const isStereo = channelCount === 2;

            // Reusable stereo temps (no per-sample allocation)
            let ds0 = 0.0, ds1 = 0.0;
            let fbSrc0 = 0.0, fbSrc1 = 0.0;
            let dampFb0 = 0.0, dampFb1 = 0.0;

            // Damping filter in feedback path:
            // x -> LPF@ld => lpLD; hp = x - lpLD; then LPF@hd => bp
            // final = x*(1-dp) + bp*dp
            const dampFeedback = (ch, x) => {
                let lpLD = ldStates[ch];
                lpLD = (1.0 - aLD) * x + aLD * lpLD;
                const hp = x - lpLD;

                let lpHD = hdStates[ch];
                lpHD = (1.0 - aHD) * hp + aHD * lpHD;

                ldStates[ch] = lpLD;
                hdStates[ch] = lpHD;

                return x * oneMinusDampAmount + lpHD * dampAmount;
            };

            for (let i = 0; i < blockSize; i++) {

                // Stereo: read once, compute ping-pong feedback once
                if (isStereo) {
                    const dL = delayBuffers[0];
                    const dR = delayBuffers[1];

                    const posL = dL.pos;
                    const posR = dR.pos;

                    const readPosL = (posL - delaySamples + dL.length) % dL.length;
                    const readPosR = (posR - delaySamples + dR.length) % dR.length;

                    ds0 = dL.buffer[readPosL];
                    ds1 = dR.buffer[readPosR];

                    const mono = 0.5 * (ds0 + ds1);

                    if (pingPongMix <= 0.5) {
                        const t = pingPongMix * 2.0;     // 0..1
                        const it = 1.0 - t;
                        fbSrc0 = ds0 * it + mono * t;
                        fbSrc1 = ds1 * it + mono * t;
                    } else {
                        const t = (pingPongMix - 0.5) * 2.0; // 0..1
                        const it = 1.0 - t;
                        fbSrc0 = mono * it + ds1 * t; // crossfeed
                        fbSrc1 = mono * it + ds0 * t;
                    }

                    dampFb0 = dampFeedback(0, fbSrc0);
                    dampFb1 = dampFeedback(1, fbSrc1);
                }

                for (let ch = 0; ch < channelCount; ch++) {
                    const idx = ch * blockSize + i;
                    const input = data[idx];

                    // --- Pre-Delay (fix: pd=0 must be true zero delay) ---
                    const pre = preDelayBuffers[ch];
                    const preBuf = pre.buffer;
                    const preLen = pre.length;
                    let prePos = pre.pos;

                    let preOut;
                    if (preDelaySamples === 0) {
                        preOut = input;
                        // keep buffer warm (optional)
                        preBuf[prePos] = input;
                        prePos++;
                        if (prePos >= preLen) prePos = 0;
                    } else {
                        const preReadPos = (prePos - preDelaySamples + preLen) % preLen;
                        preOut = preBuf[preReadPos];

                        preBuf[prePos] = input;
                        prePos++;
                        if (prePos >= preLen) prePos = 0;
                    }
                    pre.pos = prePos;

                    // --- Main Delay ---
                    const d = delayBuffers[ch];
                    const dBuf = d.buffer;
                    const dLen = d.length;
                    let dPos = d.pos;

                    const writePos = dPos;
                    const readPos = (dPos - delaySamples + dLen) % dLen;

                    const wet = isStereo
                        ? (ch === 0 ? ds0 : (ch === 1 ? ds1 : dBuf[readPos]))
                        : dBuf[readPos];

                    let fbDamped;
                    if (isStereo && ch === 0) {
                        fbDamped = dampFb0;
                    } else if (isStereo && ch === 1) {
                        fbDamped = dampFb1;
                    } else {
                        // Mono or extra channels: feedback source is the delayed signal of that channel
                        fbDamped = dampFeedback(ch, wet);
                    }

                    // Write: pre-delayed input + feedback
                    dBuf[writePos] = preOut + fbDamped * feedbackGain;

                    dPos++;
                    if (dPos >= dLen) dPos = 0;
                    d.pos = dPos;

                    // --- Output Mix ---
                    data[idx] = input * dryGain + wet * wetGain;
                }
            }

            return data;
        `);
    }

    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            pd: this.pd,
            ds: this.ds,
            dp: this.dp,
            hd: this.hd,
            ld: this.ld,
            mx: this.mx,
            fb: this.fb,
            pp: this.pp
        };
    }

    setParameters(params) {
        if (params.pd !== undefined) this.pd = Math.max(0, Math.min(100, Number(params.pd)));       // 0..100 ms
        if (params.ds !== undefined) this.ds = Math.max(1, Math.min(5000, Number(params.ds)));      // 1..5000 ms
        if (params.dp !== undefined) this.dp = Math.max(0, Math.min(100, Number(params.dp)));       // 0..100 %

        // Make UI/validation consistent and actually usable
        if (params.hd !== undefined) this.hd = Math.max(20, Math.min(20000, Number(params.hd)));    // 20..20000 Hz
        if (params.ld !== undefined) this.ld = Math.max(20, Math.min(20000, Number(params.ld)));    // 20..20000 Hz

        if (params.mx !== undefined) this.mx = Math.max(0, Math.min(100, Number(params.mx)));       // 0..100 %
        if (params.fb !== undefined) this.fb = Math.max(0, Math.min(99, Number(params.fb)));        // 0..99 %
        if (params.pp !== undefined) this.pp = Math.max(0, Math.min(100, Number(params.pp)));       // 0..100 %

        this.updateParameters();
    }

    createUI() {
        const container = document.createElement('div');
        container.className = 'delay-plugin-ui plugin-parameter-ui';

        container.appendChild(this.createParameterControl(
            'Pre-Delay', 0, 100, 0.1, this.pd,
            (value) => this.setParameters({ pd: value }), 'ms'
        ));

        container.appendChild(this.createParameterControl(
            'Delay Size', 1, 5000, 1, this.ds,
            (value) => this.setParameters({ ds: value }), 'ms'
        ));

        container.appendChild(this.createParameterControl(
            'Damping', 0, 100, 1, this.dp,
            (value) => this.setParameters({ dp: value }), '%'
        ));

        container.appendChild(this.createParameterControl(
            'High Damp', 20, 20000, 1, this.hd,
            (value) => this.setParameters({ hd: value }), 'Hz'
        ));

        container.appendChild(this.createParameterControl(
            'Low Damp', 20, 20000, 1, this.ld,
            (value) => this.setParameters({ ld: value }), 'Hz'
        ));

        container.appendChild(this.createParameterControl(
            'Mix', 0, 100, 1, this.mx,
            (value) => this.setParameters({ mx: value }), '%'
        ));

        container.appendChild(this.createParameterControl(
            'Feedback', 0, 99, 1, this.fb,
            (value) => this.setParameters({ fb: value }), '%'
        ));

        container.appendChild(this.createParameterControl(
            'Ping-Pong', 0, 100, 1, this.pp,
            (value) => this.setParameters({ pp: value }), '%'
        ));

        return container;
    }
}

window.DelayPlugin = DelayPlugin;
