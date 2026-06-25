class DSD64IMDSimulatorPlugin extends PluginBase {
    constructor() {
        super('DSD64 IMD Simulator', 'Simulates audible intermodulation distortion caused by DSD64 ultrasonic noise (requires 88.2 kHz or higher)');

        // --- Parameters (shortened external names) ---
        this.am = 24.0;   // am: Amount (dB)                 Range: -40.0 .. +50.0
        this.dw = 50;     // dw: Dry-Wet (%)                 Range: 0 .. 100 (50 = full dry + full residual)
        this.ul = -30.0;  // ul: Ultrasonic Level (dBFS RMS) Range: -48.0 .. -18.0
        this.nc = 0;      // nc: Noise Color (%)             Range: -100 .. +100
        this.an = 1.40;   // an: Analog Nonlinearity (%)     Range: 0.00 .. 10.00
        this.eb = 20;     // eb: Even Bias (%)               Range: 0 .. 100
        this.sc = 150;    // sc: Signal Coupling (%)         Range: 0 .. 200
        this.st = 10.5;   // st: Scratch Tone (kHz)          Range: 3.0 .. 14.0
        this.nt = 25;     // nt: Noise Texture (%)           Range: 0 .. 100
        this.cs = 75;     // cs: Cross Sideband (%)          Range: 0 .. 100
        this.hf = 0.0;    // hf: IMD Path HPF (kHz)          Range: 0.0 .. 8.0 (0.0 = Off; HPFs the IMD input AND the summed IMD residual)
        this.ot = 0.0;    // ot: Output Trim (dB)            Range: -24.0 .. +12.0

        // --- UI / visualization state (main thread only) ---
        this.errorState = null;            // warning message when not running at 96 kHz
        this.meterLevels = { add: -140, att: -140, cross: -140, tot: -140, out: -140 };
        this.animationFrameId = null;

        this.registerProcessor(`
            // ===================== Constants =====================
            const LH = 127;            // Hilbert FIR length (odd)
            const DH = (LH - 1) / 2;   // Hilbert group delay = 63 samples
            const MASK = 255;          // circular buffer mask (length 256)
            const SQRT3 = 1.7320508075688772;
            const INV2P31 = 4.656612873077393e-10; // 1 / 2^31 (xorshift32 -> [-1,1) scaling)
            const LP_Q1 = 0.5411961;   // 4th-order Butterworth LP20 stage Qs
            const LP_Q2 = 1.3065630;
            const NPRE = 8192;         // noise-path prewarm length
            const MIN_FS = 88200;      // 2fs lower bound; below this the ultrasonic band cannot exist

            // ===================== Early outs =====================
            if (!parameters.enabled) return data;

            const channelCount = parameters.channelCount;
            const blockSize = parameters.blockSize;
            const sampleRate = parameters.sampleRate;
            const FS = sampleRate;     // all fixed coefficients are derived from the runtime rate

            // Always report state so the UI can show the sample-rate warning.
            data.measurements = { channels: channelCount, sampleRate: sampleRate };

            // The 21-44 kHz ultrasonic band needs Nyquist > 44 kHz, i.e. 2fs or higher.
            // At 1fs (44.1 / 48 kHz) the model is invalid -> dry passthrough (warning shown in UI).
            if (sampleRate < MIN_FS || channelCount === 0) {
                return data;
            }

            // ===================== Biquad coefficient helpers (a0 normalized) =====================
            // Returns [b0, b1, b2, a1, a2]
            function lp2(f, Q) {
                const w = 2 * Math.PI * f / FS, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q);
                const a0 = 1 + al, k = (1 - c) * 0.5;
                return [k / a0, (1 - c) / a0, k / a0, (-2 * c) / a0, (1 - al) / a0];
            }
            function hp2(f, Q) {
                const w = 2 * Math.PI * f / FS, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q);
                const a0 = 1 + al, k = (1 + c) * 0.5;
                return [k / a0, (-(1 + c)) / a0, k / a0, (-2 * c) / a0, (1 - al) / a0];
            }
            function pk(f, Q, gdb) {
                const A = Math.pow(10, gdb / 40), w = 2 * Math.PI * f / FS, c = Math.cos(w), s = Math.sin(w), al = s / (2 * Q);
                const a0 = 1 + al / A;
                return [(1 + al * A) / a0, (-2 * c) / a0, (1 - al * A) / a0, (-2 * c) / a0, (1 - al / A) / a0];
            }
            function hs2(f, gdb) {
                // High shelf, fixed slope S = 1
                const A = Math.pow(10, gdb / 40), w = 2 * Math.PI * f / FS, c = Math.cos(w), s = Math.sin(w);
                const al = (s * 0.5) * Math.SQRT2;           // sqrt((A+1/A)*(1/S-1)+2) = sqrt(2) when S=1
                const beta = 2 * Math.sqrt(A) * al;
                const Ap1 = A + 1, Am1 = A - 1;
                const a0 = Ap1 - Am1 * c + beta;
                return [
                    (A * (Ap1 + Am1 * c + beta)) / a0,
                    (-2 * A * (Am1 + Ap1 * c)) / a0,
                    (A * (Ap1 + Am1 * c - beta)) / a0,
                    (2 * (Am1 - Ap1 * c)) / a0,
                    (Ap1 - Am1 * c - beta) / a0
                ];
            }

            // Direct Form II Transposed single biquad. st is a Float32Array, o the state offset.
            function bq(x, st, o, c) {
                const y = c[0] * x + st[o] + 1e-30;
                st[o]     = c[1] * x - c[3] * y + st[o + 1];
                st[o + 1] = c[2] * x - c[4] * y;
                return y;
            }
            // Process a cascade of biquads. base = ch * (stages*2).
            function casc(x, st, base, coeffs) {
                let y = x;
                const n = coeffs.length;
                for (let s = 0; s < n; s++) y = bq(y, st, base + s * 2, coeffs[s]);
                return y;
            }

            // Mean-square magnitude of the H_U cascade -> RMS gain for unit white noise.
            function computeNU(coeffs) {
                const K = 1024;
                let acc = 0;
                for (let m = 0; m < K; m++) {
                    const w = Math.PI * (m + 0.5) / K;
                    const cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
                    let mag2 = 1;
                    for (let i = 0; i < coeffs.length; i++) {
                        const c = coeffs[i];
                        const nre = c[0] + c[1] * cw + c[2] * c2, nim = -(c[1] * sw + c[2] * s2);
                        const dre = 1 + c[3] * cw + c[4] * c2,    dim = -(c[3] * sw + c[4] * s2);
                        mag2 *= (nre * nre + nim * nim) / (dre * dre + dim * dim);
                    }
                    acc += mag2;
                }
                return Math.sqrt(acc / K);
            }

            // Ultrasonic noise uses a fast per-channel xorshift32 PRNG (cross-render
            // reproducibility is not required). Advanced inline in the loops below.

            // ===================== Parameter -> internal targets =====================
            const A_t      = Math.pow(10, parameters.am / 20);
            const P_t      = parameters.dw / 100;   // Dry-Wet fraction 0..1
            const Gout_t   = Math.pow(10, parameters.ot / 20);
            const sigma_u  = Math.pow(10, parameters.ul / 20);
            const Hnl      = parameters.an / 100;
            const bBias    = parameters.eb / 100;
            const HD2      = Hnl * Math.sin(Math.PI * bBias / 2);
            const HD3      = Hnl * Math.cos(Math.PI * bBias / 2);
            const a2_t     = 2 * HD2;
            const a3_t     = 4 * HD3;
            const gatt_t   = parameters.sc / 100;
            const gcross_t = gatt_t * (parameters.cs / 100);

            // ---- Filter coefficients (cached; rebuilt only when their parameters change) ----
            // IMD Path HPF (24 dB/oct Butterworth, 0 = Off) high-passes both the audible input
            // feeding r_att / r_cross and the summed IMD residual (so r_add is also limited),
            // modelling tweeter-only / crossover-limited IMD. Dry path and noise are unaffected.
            const coeffKey = FS + '|' + parameters.nc + '|' + parameters.nt + '|' + parameters.st + '|' + parameters.hf;
            if (context.coeffKey !== coeffKey) {
                const cCol = parameters.nc / 100;
                const fStart = 24000 + 3000 * cCol;
                // Clamp the upper edge to the safe side of Nyquist (matters at 88.2 kHz).
                const fEndCap = 0.92 * FS * 0.5, fEndRaw = 42000 + 2000 * cCol;
                const fEnd = fEndRaw < fEndCap ? fEndRaw : fEndCap;
                const tilt = 18 + 6 * cCol;
                const R = 12 * parameters.nt / 100;
                const fT = Math.sqrt(fStart * fEnd);
                const W = fEnd - fStart;
                const f1 = fStart + 0.23 * W, f2 = fStart + 0.51 * W, f3 = fStart + 0.78 * W;
                const fF = 1000 * parameters.st;
                const fLraw = 0.15 * fF, fHraw = 2.2 * fF;
                const fL = fLraw < 500 ? 500 : (fLraw > 2500 ? 2500 : fLraw);
                const fH = fHraw < 12000 ? 12000 : (fHraw > 20000 ? 20000 : fHraw);
                context.huC = [hp2(fStart, 0.707), hs2(fT, tilt), pk(f1, 5, 0.6 * R), pk(f2, 7, 1.0 * R), pk(f3, 6, 0.8 * R), lp2(fEnd, 0.707)];
                context.lp20C = [lp2(20000, LP_Q1), lp2(20000, LP_Q2)];
                context.postC = [hp2(fL, 0.707), pk(fF, 0.9, 6), lp2(fH, 0.707)];
                const hpfHz = 1000 * parameters.hf;
                context.imdHpfC = hpfHz > 0 ? [hp2(hpfHz, LP_Q1), hp2(hpfHz, LP_Q2)] : [];
                // N_U normalization depends only on H_U (sampleRate, Noise Color, Noise Texture).
                const huKey = FS + '|' + parameters.nc + '|' + parameters.nt;
                if (context.huKey !== huKey) { context.NU = computeNU(context.huC); context.huKey = huKey; }
                context.coeffKey = coeffKey;
            }
            const huC = context.huC, lp20C = context.lp20C, postC = context.postC, imdHpfC = context.imdHpfC;

            // Time constants
            const alpha_p = 1 - Math.exp(-1 / (FS * 0.25));   // p_mean follower
            const lambda_s = 1 - Math.exp(-1 / (FS * 0.02));  // scalar smoothing (20 ms)
            const alpha_m = 1 - Math.exp(-1 / (FS * 0.3));    // meter follower

            // ===================== (Re)initialization =====================
            if (!context.initialized || context.lastCh !== channelCount) {
                // Hilbert FIR taps (anti-symmetric, only odd m i.e. even i are non-zero)
                const offs = [], coef = [];
                for (let i = 0; i < LH; i++) {
                    const mm = i - DH;
                    if (mm === 0 || (mm & 1) === 0) continue; // keep odd m only
                    const wnd = 0.42 - 0.5 * Math.cos(2 * Math.PI * i / (LH - 1)) + 0.08 * Math.cos(4 * Math.PI * i / (LH - 1));
                    offs.push(i);
                    coef.push((2 / (Math.PI * mm)) * wnd);
                }
                context.hbOff = Int16Array.from(offs);
                context.hbCoef = Float32Array.from(coef);

                // Per-channel xorshift32 PRNG state (seeded from channel index; must be nonzero)
                context.rng = new Uint32Array(channelCount);
                for (let ch = 0; ch < channelCount; ch++) context.rng[ch] = (0x9E3779B1 * (ch + 1) + 0x6D2B79F5) >>> 0 || 1;

                // Per-channel circular buffers (length 256)
                context.bufU = new Float32Array(channelCount * 256);
                context.bufXa = new Float32Array(channelCount * 256);
                context.bufXraw = new Float32Array(channelCount * 256);

                // Per-channel filter states
                context.huZ = new Float32Array(channelCount * 12);   // 6 stages
                context.lpiZ = new Float32Array(channelCount * 4);   // LP20_input
                context.hpfInZ = new Float32Array(channelCount * 4);  // IMD Path HPF on input (2 stages)
                context.hpfOutZ = new Float32Array(channelCount * 4); // IMD Path HPF on summed residual (2 stages)
                context.d2Z = new Float32Array(channelCount * 4);    // LP20_d2
                context.xd2Z = new Float32Array(channelCount * 4);   // LP20_xd2
                context.crossZ = new Float32Array(channelCount * 4); // LP20_cross
                context.postZ = new Float32Array(channelCount * 6);  // H_post (3 stages)
                // Meter-only H_post states so Additive/Attached/Cross are measured
                // after Amount and after Post EQ (consistent with Total IMD).
                // Meter-only states for Additive/Attached (Cross is derived as r - add - att).
                context.postAddZ = new Float32Array(channelCount * 6);
                context.postAttZ = new Float32Array(channelCount * 6);
                context.hpfAddZ = new Float32Array(channelCount * 4);
                context.hpfAttZ = new Float32Array(channelCount * 4);

                context.pMean = new Float32Array(channelCount).fill(2 * sigma_u * sigma_u);
                context.bufPos = 0;

                // Smoothing scalars start at targets
                context.aS = A_t; context.pS = P_t; context.goS = Gout_t;
                context.a2S = a2_t; context.a3S = a3_t; context.gattS = gatt_t; context.gcrossS = gcross_t;

                // N_U normalization (context.NU was computed in the coefficient-cache block)
                context.guS = sigma_u / (context.NU > 1e-12 ? context.NU : 1e-12);

                // Meter powers
                context.mAdd = 0; context.mAtt = 0; context.mCross = 0; context.mTot = 0; context.mOut = 0;

                context.lastCh = channelCount;
                context.initialized = true;

                // ----- Prewarm noise path only (input path stays silent) -----
                const hbOff = context.hbOff, hbCoef = context.hbCoef, hbLen = hbCoef.length;
                const gu = context.guS;
                for (let ch = 0; ch < channelCount; ch++) {
                    const uBase = ch * 256;
                    const huBase = ch * 12, d2Base = ch * 4;
                    let pos = 0;
                    let pm = context.pMean[ch];
                    let rs = context.rng[ch];
                    for (let n = 0; n < NPRE; n++) {
                        rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0;
                        const q = SQRT3 * (rs * INV2P31 - 1);
                        const u = gu * casc(q, context.huZ, huBase, huC);
                        context.bufU[uBase + (pos & MASK)] = u;
                        const u_d = context.bufU[uBase + ((pos - DH) & MASK)];
                        let u_h = 0;
                        for (let t = 0; t < hbLen; t++) u_h += hbCoef[t] * context.bufU[uBase + ((pos - hbOff[t]) & MASK)];
                        const p_inst = u_d * u_d + u_h * u_h;
                        pm += alpha_p * (p_inst - pm);
                        casc(0.5 * (p_inst - pm), context.d2Z, d2Base, lp20C); // warm both LP20_d2 stages
                        pos++;
                    }
                    context.pMean[ch] = pm;
                    context.rng[ch] = rs;
                }
                // Prewarm advanced each channel's local pos by NPRE identically; keep global pos aligned.
                context.bufPos = NPRE & 0xFFFFFFFF;
            }

            const gu_t = sigma_u / (context.NU > 1e-12 ? context.NU : 1e-12);

            // ===================== Main per-sample loop =====================
            const hbCoef = context.hbCoef, hbLen = hbCoef.length;
            const bufU = context.bufU, bufXa = context.bufXa, bufXraw = context.bufXraw;
            const huZ = context.huZ, lpiZ = context.lpiZ, hpfInZ = context.hpfInZ, hpfOutZ = context.hpfOutZ,
                  d2Z = context.d2Z, xd2Z = context.xd2Z, crossZ = context.crossZ, postZ = context.postZ,
                  postAddZ = context.postAddZ, postAttZ = context.postAttZ,
                  hpfAddZ = context.hpfAddZ, hpfAttZ = context.hpfAttZ;
            const pMean = context.pMean;

            const rng = context.rng;
            const hpfOn = imdHpfC.length !== 0;   // hoist out of the per-sample loop

            let bufPos = context.bufPos;
            let aS = context.aS, pS = context.pS, goS = context.goS, guS = context.guS,
                a2S = context.a2S, a3S = context.a3S, gattS = context.gattS, gcrossS = context.gcrossS;
            let mAdd = context.mAdd, mAtt = context.mAtt, mCross = context.mCross, mTot = context.mTot, mOut = context.mOut;
            const invCh = 1 / channelCount;

            for (let i = 0; i < blockSize; i++) {
                // Per-sample scalar smoothing
                aS      += lambda_s * (A_t - aS);
                pS      += lambda_s * (P_t - pS);
                goS     += lambda_s * (Gout_t - goS);
                guS     += lambda_s * (gu_t - guS);
                a2S     += lambda_s * (a2_t - a2S);
                a3S     += lambda_s * (a3_t - a3S);
                gattS   += lambda_s * (gatt_t - gattS);
                gcrossS += lambda_s * (gcross_t - gcrossS);

                const wp = bufPos & MASK;
                const dp = (bufPos - DH) & MASK;

                // Dry-Wet gains and per-term activity (skip work that contributes nothing).
                const wetG = 2 * pS < 1 ? 2 * pS : 1;
                const dryG = 2 - 2 * pS < 1 ? 2 - 2 * pS : 1;
                const wetAudible = pS > 1e-5;
                const addActive = (a2S < 0 ? -a2S : a2S) > 1e-10;
                const attA = a3S * gattS;   const attActive = (attA < 0 ? -attA : attA) > 1e-10;
                const crossA = a2S * gcrossS; const crossActive = (crossA < 0 ? -crossA : crossA) > 1e-10;
                const d2Needed = addActive || attActive;
                // When dry-only or no IMD is generated, output is just the (gained) dry signal.
                // The IMD path is frozen to save CPU (a brief settling transient may occur when
                // wet/IMD is raised again); the dry delay line is still maintained.
                const skipImd = !wetAudible || !(addActive || attActive || crossActive);

                let sqAdd = 0, sqAtt = 0, sqCross = 0, sqTot = 0, sqOut = 0;

                for (let ch = 0; ch < channelCount; ch++) {
                    const base = ch * 256;
                    const x_in = data[ch * blockSize + i];
                    bufXraw[base + wp] = x_in;

                    if (skipImd) {
                        const y = goS * dryG * bufXraw[base + dp];
                        data[ch * blockSize + i] = y;
                        sqOut += y * y;
                        continue;
                    }

                    const huBase = ch * 12, s4 = ch * 4, postBase = ch * 6;

                    // Ultrasonic noise (per-channel xorshift32, unit RMS)
                    let rs = rng[ch];
                    rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0;
                    rng[ch] = rs;
                    const u = guS * casc(SQRT3 * (rs * INV2P31 - 1), huZ, huBase, huC);
                    bufU[base + wp] = u;

                    // Band-limited (optionally HPF'd) input for the IMD model
                    const x_lp = casc(x_in, lpiZ, s4, lp20C);
                    const x_audio = hpfOn ? casc(x_lp, hpfInZ, s4, imdHpfC) : x_lp;
                    bufXa[base + wp] = x_audio;

                    const u_d = bufU[base + dp];
                    const x_d = bufXa[base + dp];
                    const x_dry = bufXraw[base + dp];

                    // u^2 difference-frequency component (needs the Hilbert of u; only for r_add / r_att)
                    let r_add = 0, r_att = 0;
                    if (d2Needed) {
                        // Hilbert taps sit at even delays (0,2,4,...): walk the ring with a plain
                        // stride-2 decrement and one wrap split, so no per-tap mask / offset lookup.
                        let u_h = 0;
                        let split = (wp >> 1) + 1;
                        if (split > hbLen) split = hbLen;
                        let k = base + wp;
                        for (let t = 0; t < split; t++, k -= 2) u_h += hbCoef[t] * bufU[k];
                        k += 256; // taps past the write head wrap to the top of the ring
                        for (let t = split; t < hbLen; t++, k -= 2) u_h += hbCoef[t] * bufU[k];

                        const p_inst = u_d * u_d + u_h * u_h;
                        let pm = pMean[ch];
                        pm += alpha_p * (p_inst - pm);
                        pMean[ch] = pm;
                        const d2 = casc(0.5 * (p_inst - pm), d2Z, s4, lp20C);
                        if (addActive) r_add = a2S * d2;
                        if (attActive) r_att = 3 * a3S * gattS * casc(x_d * d2, xd2Z, s4, lp20C);
                    }
                    // Cross-sideband: real product u_d * x_d, band-limited (no x_h Hilbert needed).
                    let r_cross = 0;
                    if (crossActive) r_cross = 2 * a2S * gcrossS * casc(u_d * x_d, crossZ, s4, lp20C);

                    // IMD Path HPF on the summed residual so r_add is also band-limited.
                    let r_phys = r_add + r_att + r_cross;
                    if (hpfOn) r_phys = casc(r_phys, hpfOutZ, s4, imdHpfC);
                    const r = casc(aS * r_phys, postZ, postBase, postC);
                    const y = goS * (dryG * x_dry + wetG * r);
                    data[ch * blockSize + i] = y;

                    // Accurate per-term meters (after IMD Path HPF, Amount and Post EQ).
                    // Cross is derived from r (linearity), and inactive terms are skipped.
                    const r_add_m = addActive
                        ? casc(aS * (hpfOn ? casc(r_add, hpfAddZ, s4, imdHpfC) : r_add), postAddZ, postBase, postC) : 0;
                    const r_att_m = attActive
                        ? casc(aS * (hpfOn ? casc(r_att, hpfAttZ, s4, imdHpfC) : r_att), postAttZ, postBase, postC) : 0;
                    const r_cross_m = r - r_add_m - r_att_m;
                    sqAdd += r_add_m * r_add_m;
                    sqAtt += r_att_m * r_att_m;
                    sqCross += r_cross_m * r_cross_m;
                    sqTot += r * r;
                    sqOut += y * y;
                }

                // Meter followers (mean power across channels)
                mAdd   += alpha_m * (sqAdd * invCh - mAdd);
                mAtt   += alpha_m * (sqAtt * invCh - mAtt);
                mCross += alpha_m * (sqCross * invCh - mCross);
                mTot   += alpha_m * (sqTot * invCh - mTot);
                mOut   += alpha_m * (sqOut * invCh - mOut);

                bufPos = (bufPos + 1) >>> 0;
            }

            // Persist running state
            context.bufPos = bufPos;
            context.aS = aS; context.pS = pS; context.goS = goS; context.guS = guS;
            context.a2S = a2S; context.a3S = a3S; context.gattS = gattS; context.gcrossS = gcrossS;
            context.mAdd = mAdd; context.mAtt = mAtt; context.mCross = mCross; context.mTot = mTot; context.mOut = mOut;

            const toDb = (p) => 10 * Math.log10(p + 1e-24);
            data.measurements.meters = {
                add: toDb(mAdd), att: toDb(mAtt), cross: toDb(mCross), tot: toDb(mTot), out: toDb(mOut)
            };
            return data;
        `);
    }

    // ===================== Parameter management =====================
    getParameters() {
        return {
            type: this.constructor.name,
            enabled: this.enabled,
            am: this.am, dw: this.dw, ul: this.ul, nc: this.nc, an: this.an, eb: this.eb,
            sc: this.sc, st: this.st, nt: this.nt, cs: this.cs, hf: this.hf, ot: this.ot
        };
    }

    setParameters(p) {
        const setF = (key, min, max) => {
            if (p[key] !== undefined && p[key] !== null) {
                const v = typeof p[key] === 'number' ? p[key] : parseFloat(p[key]);
                if (!isNaN(v)) this[key] = Math.max(min, Math.min(max, v));
            }
        };
        const setI = (key, min, max) => {
            if (p[key] !== undefined && p[key] !== null) {
                const v = typeof p[key] === 'number' ? Math.round(p[key]) : parseInt(p[key], 10);
                if (!isNaN(v)) this[key] = Math.max(min, Math.min(max, v));
            }
        };
        setF('am', -40.0, 50.0);
        setI('dw', 0, 100);
        setF('ul', -48.0, -18.0);
        setI('nc', -100, 100);
        setF('an', 0.0, 10.0);
        setI('eb', 0, 100);
        setI('sc', 0, 200);
        setF('st', 3.0, 14.0);
        setI('nt', 0, 100);
        setI('cs', 0, 100);
        setF('hf', 0.0, 8.0);
        setF('ot', -24.0, 12.0);
        this.updateParameters();
        if (this.transferCanvas) this.drawTransferCurve();
        if (this.diffCanvas) this.drawDifferenceFrequency();
    }

    // Convenience setters
    setAm(v) { this.setParameters({ am: v }); }
    setDw(v) { this.setParameters({ dw: v }); }

    // Display the Dry-Wet control as a dry:wet ratio, matching the DSP gains
    // (dry_gain = min(2-2p, 1), wet_gain = min(2p, 1); 50% = 100:100).
    formatDryWet(v) {
        const p = v / 100;
        const wet = Math.round(100 * Math.min(2 * p, 1));
        const dry = Math.round(100 * Math.min(2 - 2 * p, 1));
        return `${dry}:${wet}`;
    }

    // Custom control for Dry-Wet: slider (0-100) with a read-only "dry:wet" readout (no unit).
    createDryWetControl() {
        const row = document.createElement('div');
        row.className = 'parameter-row';
        const sliderId = `${this.id}-${this.name}-dry-wet-slider`;
        const valueId = `${this.id}-${this.name}-dry-wet-value`;

        const labelEl = document.createElement('label');
        labelEl.textContent = 'Dry-Wet:';
        labelEl.htmlFor = sliderId;

        const slider = document.createElement('input');
        slider.type = 'range';
        slider.id = sliderId;
        slider.name = sliderId;
        slider.min = 0;
        slider.max = 100;
        slider.step = 1;
        slider.value = this.dw;
        slider.autocomplete = 'off';

        const valueEl = document.createElement('input');
        valueEl.type = 'text';
        valueEl.id = valueId;
        valueEl.name = valueId;
        valueEl.readOnly = true;
        valueEl.value = this.formatDryWet(this.dw);
        valueEl.autocomplete = 'off';
        // Match the standard number box (type="number" is 80px fixed); the global
        // input[type="text"] rule would otherwise flex-grow and shrink the slider.
        valueEl.style.flexGrow = '0';
        valueEl.style.width = '80px';

        slider.addEventListener('input', (e) => {
            const v = parseFloat(e.target.value);
            this.setDw(v);
            valueEl.value = this.formatDryWet(v);
        });

        row.appendChild(labelEl);
        row.appendChild(slider);
        row.appendChild(valueEl);
        return row;
    }
    setUl(v) { this.setParameters({ ul: v }); }
    setNc(v) { this.setParameters({ nc: v }); }
    setAn(v) { this.setParameters({ an: v }); }
    setEb(v) { this.setParameters({ eb: v }); }
    setSc(v) { this.setParameters({ sc: v }); }
    setSt(v) { this.setParameters({ st: v }); }
    setNt(v) { this.setParameters({ nt: v }); }
    setCs(v) { this.setParameters({ cs: v }); }
    setHf(v) { this.setParameters({ hf: v }); }
    setOt(v) { this.setParameters({ ot: v }); }

    // ===================== Messaging (warning + meters) =====================
    onMessage(message) {
        if (message.type === 'processBuffer' && message.pluginId === this.id && message.measurements) {
            const m = message.measurements;
            // Sample-rate warning (mirrors the multichannel-mode warning style).
            // The 21-44 kHz ultrasonic band requires at least 88.2 kHz (2fs).
            let error = null;
            if (typeof m.sampleRate === 'number' && m.sampleRate < 88200) {
                error = `This effect requires an 88.2 kHz sample rate or higher (current: ${(m.sampleRate / 1000).toFixed(1)} kHz). 44.1 / 48 kHz cannot represent the ultrasonic band.`;
            }
            if (this.errorState !== error) {
                this.errorState = error;
                this._updateErrorUI();
            }
            if (m.meters) this.meterLevels = m.meters;
        }
    }

    _updateErrorUI() {
        if (!this.errorEl) return;
        this.errorEl.textContent = this.errorState || '';
        this.errorEl.style.display = this.errorState ? 'block' : 'none';
    }

    // ===================== UI =====================
    createUI() {
        const c = document.createElement('div');
        c.className = 'dsd64-imd-plugin-ui plugin-parameter-ui';

        // Sample-rate warning banner
        this.errorEl = document.createElement('div');
        this.errorEl.className = 'dsd64-imd-error';
        this.errorEl.style.display = 'none';
        c.appendChild(this.errorEl);
        this._updateErrorUI();

        // Main parameters
        c.appendChild(this.createParameterControl('Amount', -40.0, 50.0, 0.1, this.am, v => this.setAm(v), 'dB'));
        c.appendChild(this.createDryWetControl());
        c.appendChild(this.createParameterControl('Ultrasonic Level', -48.0, -18.0, 0.5, this.ul, v => this.setUl(v), 'dBFS RMS'));
        c.appendChild(this.createParameterControl('Noise Color', -100, 100, 1, this.nc, v => this.setNc(v), '%'));
        c.appendChild(this.createParameterControl('Analog Nonlinearity', 0.0, 10.0, 0.01, this.an, v => this.setAn(v), '%'));
        c.appendChild(this.createParameterControl('Even Bias', 0, 100, 1, this.eb, v => this.setEb(v), '%'));
        c.appendChild(this.createParameterControl('Signal Coupling', 0, 200, 1, this.sc, v => this.setSc(v), '%'));
        c.appendChild(this.createParameterControl('IMD Path HPF', 0.0, 8.0, 0.1, this.hf, v => this.setHf(v), 'kHz'));
        c.appendChild(this.createParameterControl('Scratch Tone', 3.0, 14.0, 0.1, this.st, v => this.setSt(v), 'kHz'));

        // Advanced / utility parameters
        c.appendChild(this.createParameterControl('Noise Texture', 0, 100, 1, this.nt, v => this.setNt(v), '%'));
        c.appendChild(this.createParameterControl('Cross Sideband', 0, 100, 1, this.cs, v => this.setCs(v), '%'));
        c.appendChild(this.createParameterControl('Output Trim', -24.0, 12.0, 0.1, this.ot, v => this.setOt(v), 'dB'));

        // --- Visualizations ---
        const vizRow = document.createElement('div');
        vizRow.className = 'dsd64-imd-viz';

        // All three views share the same displayed height (200px) and 2x render resolution.
        // Term contribution meters
        const meterWrap = document.createElement('div');
        meterWrap.className = 'dsd64-imd-meter-wrap';
        const meterTitle = document.createElement('div');
        meterTitle.className = 'dsd64-imd-viz-title';
        meterTitle.textContent = 'Term Contribution (dBFS RMS)';
        meterWrap.appendChild(meterTitle);
        this.meterCanvas = document.createElement('canvas');
        this.meterCanvas.width = 640;
        this.meterCanvas.height = 400;
        this.meterCanvas.style.width = '320px';
        this.meterCanvas.style.height = '200px';
        this.meterCanvas.className = 'dsd64-imd-canvas';
        meterWrap.appendChild(this.meterCanvas);
        vizRow.appendChild(meterWrap);

        // Analog transfer curve (Saturation-style: 400x400 canvas shown at 200x200)
        const tcWrap = document.createElement('div');
        tcWrap.className = 'dsd64-imd-tc-wrap';
        const tcTitle = document.createElement('div');
        tcTitle.className = 'dsd64-imd-viz-title';
        tcTitle.textContent = 'Analog Transfer Curve';
        tcWrap.appendChild(tcTitle);
        this.transferCanvas = document.createElement('canvas');
        this.transferCanvas.width = 400;
        this.transferCanvas.height = 400;
        this.transferCanvas.style.width = '200px';
        this.transferCanvas.style.height = '200px';
        this.transferCanvas.className = 'dsd64-imd-tc-canvas';
        tcWrap.appendChild(this.transferCanvas);
        vizRow.appendChild(tcWrap);

        // Difference-frequency view (static; depends on the ultrasonic shaping H_U only)
        const dfWrap = document.createElement('div');
        dfWrap.className = 'dsd64-imd-df-wrap';
        const dfTitle = document.createElement('div');
        dfTitle.className = 'dsd64-imd-viz-title';
        dfTitle.textContent = 'Difference-Frequency (ref. 96 kHz)';
        dfWrap.appendChild(dfTitle);
        this.diffCanvas = document.createElement('canvas');
        this.diffCanvas.width = 800;
        this.diffCanvas.height = 400;
        this.diffCanvas.style.width = '400px';
        this.diffCanvas.style.height = '200px';
        this.diffCanvas.className = 'dsd64-imd-canvas';
        dfWrap.appendChild(this.diffCanvas);
        vizRow.appendChild(dfWrap);

        c.appendChild(vizRow);

        this.drawTransferCurve();
        this.drawDifferenceFrequency();
        this.startAnimation();

        return c;
    }

    startAnimation() {
        if (!this.enabled || !this._sectionEnabled) return;
        if (this.animationFrameId) return;
        const animate = () => {
            this.drawMeters();
            this.animationFrameId = requestAnimationFrame(animate);
        };
        this.animationFrameId = requestAnimationFrame(animate);
    }

    stopAnimation() {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    drawMeters() {
        if (!this.meterCanvas) return;
        const ctx = this.meterCanvas.getContext('2d');
        const W = this.meterCanvas.width, H = this.meterCanvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, W, H);

        const labels = ['Additive', 'Attached', 'Cross', 'Total IMD', 'Output'];
        const keys = ['add', 'att', 'cross', 'tot', 'out'];
        const dbMin = -120, dbMax = 0, range = dbMax - dbMin;
        const labelW = 140;          // 2x resolution
        const valW = 90;
        const barH = (H - 20) / labels.length;

        ctx.font = '20px Arial';
        ctx.textBaseline = 'middle';

        for (let i = 0; i < labels.length; i++) {
            const y = 10 + i * barH;
            const v = Math.max(dbMin, Math.min(dbMax, this.meterLevels[keys[i]]));
            const trackW = W - labelW - valW;
            const w = trackW * (v - dbMin) / range;

            ctx.fillStyle = '#fff';
            ctx.textAlign = 'left';
            ctx.fillText(labels[i], 8, y + barH / 2);

            ctx.fillStyle = '#333';
            ctx.fillRect(labelW, y + barH * 0.15, trackW, barH * 0.6);
            ctx.fillStyle = '#00ff00';
            ctx.fillRect(labelW, y + barH * 0.15, Math.max(0, w), barH * 0.6);

            ctx.fillStyle = '#ccc';
            ctx.textAlign = 'right';
            ctx.fillText(v.toFixed(1), W - 8, y + barH / 2);
        }
    }

    // Analog transfer curve, drawn in the same style as the Saturation plugins.
    // phi(v) = v + a2 v^2 + a3 v^3, with the y = v identity drawn for reference.
    drawTransferCurve() {
        if (!this.transferCanvas) return;
        const ctx = this.transferCanvas.getContext('2d');
        const width = this.transferCanvas.width, height = this.transferCanvas.height;
        ctx.clearRect(0, 0, width, height);

        // Grid
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        for (let x = 0; x <= width; x += width / 4) {
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        }
        for (let y = 0; y <= height; y += height / 4) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
        }

        // in / out labels
        ctx.fillStyle = '#fff';
        ctx.font = '28px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('in', width / 2, height - 5);
        ctx.save();
        ctx.translate(20, height / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('out', 0, 0);
        ctx.restore();

        // -6dB markers
        ctx.fillStyle = '#666';
        ctx.font = '20px Arial';
        ctx.fillText('-6dB', width * 0.25, height - 5);
        ctx.fillText('-6dB', width * 0.75, height - 5);
        ctx.save(); ctx.translate(20, height * 0.25); ctx.rotate(-Math.PI / 2); ctx.fillText('-6dB', 0, 0); ctx.restore();
        ctx.save(); ctx.translate(20, height * 0.75); ctx.rotate(-Math.PI / 2); ctx.fillText('-6dB', 0, 0); ctx.restore();

        const Hnl = this.an / 100, b = this.eb / 100;
        const a2 = 2 * (Hnl * Math.sin(Math.PI * b / 2));
        const a3 = 4 * (Hnl * Math.cos(Math.PI * b / 2));

        // Reference identity y = v
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height);
        ctx.lineTo(width, 0);
        ctx.stroke();

        // Transfer function phi(v)
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < width; i++) {
            const v = (i / width) * 2 - 1;          // map to [-1, 1]
            const y = v + a2 * v * v + a3 * v * v * v;
            const canvasY = ((1 - y) / 2) * height;
            if (i === 0) ctx.moveTo(i, canvasY); else ctx.lineTo(i, canvasY);
        }
        ctx.stroke();
    }

    // --- Helpers shared by the Difference-Frequency view (96 kHz reference) ---
    _biquadCoeffs(type, f, Q, gdb, fs) {
        const w = 2 * Math.PI * f / fs, c = Math.cos(w), s = Math.sin(w);
        if (type === 'lp') {
            const al = s / (2 * Q), a0 = 1 + al, k = (1 - c) * 0.5;
            return [k / a0, (1 - c) / a0, k / a0, (-2 * c) / a0, (1 - al) / a0];
        }
        if (type === 'hp') {
            const al = s / (2 * Q), a0 = 1 + al, k = (1 + c) * 0.5;
            return [k / a0, (-(1 + c)) / a0, k / a0, (-2 * c) / a0, (1 - al) / a0];
        }
        if (type === 'pk') {
            const A = Math.pow(10, gdb / 40), al = s / (2 * Q), a0 = 1 + al / A;
            return [(1 + al * A) / a0, (-2 * c) / a0, (1 - al * A) / a0, (-2 * c) / a0, (1 - al / A) / a0];
        }
        // high shelf, S = 1
        const A = Math.pow(10, gdb / 40), al = (s * 0.5) * Math.SQRT2, beta = 2 * Math.sqrt(A) * al;
        const Ap1 = A + 1, Am1 = A - 1, a0 = Ap1 - Am1 * c + beta;
        return [
            (A * (Ap1 + Am1 * c + beta)) / a0,
            (-2 * A * (Am1 + Ap1 * c)) / a0,
            (A * (Ap1 + Am1 * c - beta)) / a0,
            (2 * (Am1 - Ap1 * c)) / a0,
            (Ap1 - Am1 * c - beta) / a0
        ];
    }

    // Build the H_U cascade at the 96 kHz reference from the current Noise Color / Texture.
    _buildHU(fs) {
        const cCol = this.nc / 100;
        const fStart = 24000 + 3000 * cCol;
        const fEnd = Math.min(42000 + 2000 * cCol, 0.92 * fs * 0.5);
        const tilt = 18 + 6 * cCol;
        const R = 12 * this.nt / 100;
        const fT = Math.sqrt(fStart * fEnd);
        const W = fEnd - fStart;
        const f1 = fStart + 0.23 * W, f2 = fStart + 0.51 * W, f3 = fStart + 0.78 * W;
        return [
            this._biquadCoeffs('hp', fStart, 0.707, 0, fs),
            this._biquadCoeffs('hs', fT, 0, tilt, fs),
            this._biquadCoeffs('pk', f1, 5, 0.6 * R, fs),
            this._biquadCoeffs('pk', f2, 7, 1.0 * R, fs),
            this._biquadCoeffs('pk', f3, 6, 0.8 * R, fs),
            this._biquadCoeffs('lp', fEnd, 0.707, 0, fs)
        ];
    }

    _huMag2(coeffs, f, fs) {
        const w = 2 * Math.PI * f / fs, cw = Math.cos(w), sw = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
        let mag2 = 1;
        for (let i = 0; i < coeffs.length; i++) {
            const c = coeffs[i];
            const nre = c[0] + c[1] * cw + c[2] * c2, nim = -(c[1] * sw + c[2] * s2);
            const dre = 1 + c[3] * cw + c[4] * c2, dim = -(c[3] * sw + c[4] * s2);
            mag2 *= (nre * nre + nim * nim) / (dre * dre + dim * dim);
        }
        return mag2;
    }

    // Difference-Frequency density D(f) = integral |U(nu)|^2 |U(nu+f)|^2 dnu, nu in [20k, 48k].
    // Computed at the 96 kHz reference (matches the spec's fixed 20k-48k band); purely H_U driven.
    drawDifferenceFrequency() {
        if (!this.diffCanvas) return;
        const ctx = this.diffCanvas.getContext('2d');
        const W = this.diffCanvas.width, H = this.diffCanvas.height;
        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, W, H);

        const FS_REF = 96000;
        const coeffs = this._buildHU(FS_REF);

        // Precompute |U|^2 over the ultrasonic support 20k..48k
        const nuLo = 20000, nuHi = 48000, step = 200;
        const nNu = Math.round((nuHi - nuLo) / step) + 1;
        const magNu = new Float64Array(nNu);
        for (let k = 0; k < nNu; k++) magNu[k] = this._huMag2(coeffs, nuLo + k * step, FS_REF);

        // D(f) for audible f = 0..20k
        const fMax = 20000;
        const nF = Math.round(fMax / step) + 1;
        const D = new Float64Array(nF);
        let maxD = 1e-300;
        for (let j = 0; j < nF; j++) {
            const fOut = j * step;
            const shift = Math.round(fOut / step);
            let acc = 0;
            for (let k = 0; k + shift < nNu; k++) acc += magNu[k] * magNu[k + shift];
            D[j] = acc;
            if (acc > maxD) maxD = acc;
        }

        // --- Axes / grid in the EQ (Filter) plugin style, normalized to 0 dB peak ---
        const dbTop = 0, dbBot = -60, dbSpan = dbTop - dbBot;

        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1;
        ctx.font = '20px Arial';

        // Vertical grid + frequency labels (center-aligned, like the EQ plugins).
        // Labels whose value sits on a canvas edge are omitted, not shifted to fit.
        const gridFreqs = [0, 5000, 10000, 15000, 20000];
        ctx.textAlign = 'center';
        gridFreqs.forEach(freq => {
            const x = W * freq / fMax;
            ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
            if (freq > 0 && freq < fMax) {
                ctx.fillStyle = '#666';
                ctx.fillText(`${freq / 1000}k`, x, H - 40);
            }
        });

        // Horizontal grid + dB labels (right-aligned). Edge values (0, -60) are omitted.
        const gridDBs = [0, -12, -24, -36, -48, -60];
        ctx.textAlign = 'right';
        gridDBs.forEach(db => {
            const y = H * (1 - (db - dbBot) / dbSpan);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
            if (db < dbTop && db > dbBot) {
                ctx.fillStyle = '#666';
                ctx.fillText(`${db}dB`, 80, y + 6);
            }
        });

        // Axis titles
        ctx.fillStyle = '#fff';
        ctx.font = '24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Frequency (Hz)', W / 2, H - 5);
        ctx.save();
        ctx.translate(20, H / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText('Level (dB)', 0, 0);
        ctx.restore();

        // Difference-frequency density curve (unified green)
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let j = 0; j < nF; j++) {
            const db = 10 * Math.log10(D[j] / maxD + 1e-24);
            const x = W * j / (nF - 1);
            const y = H * (1 - Math.max(0, Math.min(1, (db - dbBot) / dbSpan)));
            if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    cleanup() {
        this.stopAnimation();
        super.cleanup();
    }
}

// Register the plugin globally
window.DSD64IMDSimulatorPlugin = DSD64IMDSimulatorPlugin;
