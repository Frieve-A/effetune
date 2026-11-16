// Simulated plants of plan-algorithm §12.5 for the speaker distortion tests.
//
// createPlant(config).capture(samples, { fsDev, group }) turns the device-rate samples of
// one call into a simulated device-rate capture: plant → fixed linear response (45 Hz
// second-order high-pass, Q 0.7, plus one resonance) → optional microphone m·y² →
// latency (a base delay plus a 0/1-sample jitter between calls) → white noise near
// −59 dBFS rms. The capture is 0.5 s longer than the call. Everything is seeded, so the
// n-th capture of two plants with the same config is identical.
//
// Plants:
// - 'speaker': JS port of the asymmetric woofer simulator of the R&D harness (electrical,
//   mechanical and reluctance equations with polynomial Bl(x), Kms(x), Le(x), optional
//   thermal Re modulation and first-order Doppler; RK4 at 4× oversampling). Presets:
//   reference, noDoppler, sealed35, small, leDominated, thermal.
// - 'quadratic': u + sign·a·(H·u)² + b·(H·u)³ with H a band filter. `flipGroups` flips the
//   even sign in the calls of those groups; `levelFlat` scales the even term by the
//   inverse square of the call rms (relative to `levelFlat` itself).
// - 'twoWay': the speaker preset behind a fourth-order (LR4) low-pass, summed with a
//   linear tweeter branch behind the matching high-pass.
const C_SOUND = 343;
const OVERSAMPLING = 4;

// Parameters of the R&D simulator ('small_woofer' defaults; the asymmetric woofer overrides).
const SMALL_WOOFER = Object.freeze({
    Re0: 6, Le0: 0.45e-3, le: [-0.30, -0.10, 0, 0], Bl0: 5, bl: [-0.015, -0.16, 0, 0], Mms: 8e-3, Rms: 1,
    Kms0: 3150, km: [0.02, 0.30, 0, 0], xref: 3e-3, thermal: false, alpha: 0.00393, Rtv: 4, tauT: 3,
    doppler: true, voltsPerFullScale: 12
});
const ASYM_WOOFER = Object.freeze({
    ...SMALL_WOOFER, Kms0: 1000, Rms: 4, bl: [-0.14, -0.05, 0, 0], km: [-0.04, 0.30, -0.70, 0.30], le: [0.45, 0.05, 0, 0]
});

export const SPEAKER_PRESETS = Object.freeze({
    reference: ASYM_WOOFER,
    noDoppler: Object.freeze({ ...ASYM_WOOFER, doppler: false }),
    sealed35: Object.freeze({ ...ASYM_WOOFER, Kms0: ASYM_WOOFER.Mms * (2 * Math.PI * 35) ** 2 }),
    small: SMALL_WOOFER,
    leDominated: Object.freeze({ ...ASYM_WOOFER, Le0: 1.2e-3, le: [-0.5, 0.1, 0, 0], bl: [-0.02, -0.05, 0, 0], km: [0.01, 0.05, 0, 0] }),
    thermal: Object.freeze({ ...ASYM_WOOFER, thermal: true })
});

/** Seeded uniform [0, 1) generator (mulberry32). */
function uniform(state) {
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function gaussian(random) {
    const u = 1 - random();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

// RBJ cookbook biquads, normalized to a0 = 1.
export function biquad(type, f, fs, q, gainDb = 0) {
    const w = 2 * Math.PI * f / fs;
    const cw = Math.cos(w), alpha = Math.sin(w) / (2 * q);
    const A = 10 ** (gainDb / 40);
    const [b, a] = type === 'highpass' ? [[(1 + cw) / 2, -(1 + cw), (1 + cw) / 2], [1 + alpha, -2 * cw, 1 - alpha]]
        : type === 'lowpass' ? [[(1 - cw) / 2, 1 - cw, (1 - cw) / 2], [1 + alpha, -2 * cw, 1 - alpha]]
            : [[1 + alpha * A, -2 * cw, 1 - alpha * A], [1 + alpha / A, -2 * cw, 1 - alpha / A]];
    return { b0: b[0] / a[0], b1: b[1] / a[0], b2: b[2] / a[0], a1: a[1] / a[0], a2: a[2] / a[0] };
}

/** Cascade of biquads (direct form I) over a signal, returning a new Float64Array. */
export function filterCascade(signal, sections) {
    let out = Float64Array.from(signal);
    for (const { b0, b1, b2, a1, a2 } of sections) {
        const y = new Float64Array(out.length);
        let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
        for (let n = 0; n < out.length; n++) {
            const x = out[n];
            const v = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1; x1 = x; y2 = y1; y1 = v;
            y[n] = v;
        }
        out = y;
    }
    return out;
}

/** The fixed linear response every plant ends in. */
export const linearResponse = fs => [biquad('highpass', 45, fs, 0.7), biquad('peaking', 2500, fs, 3, 4)];

const lr4 = (type, f, fs) => [biquad(type, f, fs, Math.SQRT1_2), biquad(type, f, fs, Math.SQRT1_2)];

function besselI0(x) {
    let sum = 1, term = 1;
    for (let k = 1; term > 1e-17 * sum; k++) { term *= (x / (2 * k)) ** 2; sum += term; }
    return sum;
}

// scipy firwin(48·os + 1, 0.96/os, window=('kaiser', 9)): windowed sinc normalized to unit DC gain.
const ANTI_ALIAS = (() => {
    const length = 48 * OVERSAMPLING + 1, middle = (length - 1) / 2, cutoff = 0.96 / OVERSAMPLING;
    const taps = Float64Array.from({ length }, (_, n) => {
        const m = n - middle;
        const sinc = m === 0 ? 1 : Math.sin(Math.PI * cutoff * m) / (Math.PI * cutoff * m);
        return cutoff * sinc * besselI0(9 * Math.sqrt(1 - ((n - middle) / middle) ** 2)) / besselI0(9);
    });
    const sum = taps.reduce((acc, value) => acc + value, 0);
    return taps.map(value => value / sum);
})();

// Zero-stuffed, centered interpolation by OVERSAMPLING (gain OVERSAMPLING restores the level).
function upsample(signal) {
    const d = (ANTI_ALIAS.length - 1) / 2;
    const out = new Float64Array(signal.length * OVERSAMPLING);
    for (let i = 0; i < out.length; i++) {
        let sum = 0;
        // Contributions come from z[i + d − k] with (i + d − k) a multiple of OVERSAMPLING.
        for (let k = (i + d) % OVERSAMPLING; k < ANTI_ALIAS.length; k += OVERSAMPLING) {
            const n = (i + d - k) / OVERSAMPLING;
            if (n >= 0 && n < signal.length) sum += ANTI_ALIAS[k] * signal[n];
        }
        out[i] = sum * OVERSAMPLING;
    }
    return out;
}

function downsample(signal) {
    const d = (ANTI_ALIAS.length - 1) / 2;
    const out = new Float64Array(signal.length / OVERSAMPLING);
    for (let i = 0; i < out.length; i++) {
        const center = i * OVERSAMPLING + d;
        let sum = 0;
        for (let k = 0; k < ANTI_ALIAS.length; k++) {
            const n = center - k;
            if (n >= 0 && n < signal.length) sum += ANTI_ALIAS[k] * signal[n];
        }
        out[i] = sum;
    }
    return out;
}

/** Cone acceleration (with optional Doppler) of the woofer for digital input u at fs, in output full scale. */
export function simulateSpeaker(input, fs, p) {
    const u = upsample(input);
    const h = 1 / (fs * OVERSAMPLING);
    const n = u.length;
    const acceleration = new Float64Array(n);
    const excursion = new Float64Array(n);
    const { Re0, Le0, le, Bl0, bl, Mms, Rms, Kms0, km, xref, alpha, Rtv, tauT } = p;
    const poly = (c, q) => 1 + q * (c[0] + q * (c[1] + q * (c[2] + q * c[3])));
    let di = 0, dv = 0;
    const deriv = (i, x, v, uin, Re) => {
        let q = x / xref;
        q = q > 3 ? 3 : q < -3 ? -3 : q;
        const blx = Bl0 * poly(bl, q), kmx = Kms0 * poly(km, q), lex = Le0 * poly(le, q);
        const dle = Le0 / xref * (le[0] + 2 * le[1] * q + 3 * le[2] * q * q + 4 * le[3] * q * q * q);
        di = (uin - Re * i - blx * v - i * dle * v) / lex;
        dv = (blx * i - Rms * v - kmx * x + 0.5 * i * i * dle) / Mms;
    };
    let i = 0, x = 0, v = 0, dT = 0;
    const volts = p.voltsPerFullScale;
    for (let k = 0; k < n; k++) {
        const Re = p.thermal ? Re0 * (1 + alpha * dT) : Re0;
        const u0 = volts * u[k], u1 = k + 1 < n ? volts * u[k + 1] : u0, um = 0.5 * (u0 + u1);
        deriv(i, x, v, u0, Re);
        const d1i = di, d1x = v, d1v = dv;
        acceleration[k] = d1v;
        excursion[k] = x;
        deriv(i + 0.5 * h * d1i, x + 0.5 * h * d1x, v + 0.5 * h * d1v, um, Re);
        const d2i = di, d2x = v + 0.5 * h * d1v, d2v = dv;
        deriv(i + 0.5 * h * d2i, x + 0.5 * h * d2x, v + 0.5 * h * d2v, um, Re);
        const d3i = di, d3x = v + 0.5 * h * d2v, d3v = dv;
        deriv(i + h * d3i, x + h * d3x, v + h * d3v, u1, Re);
        const d4i = di, d4x = v + h * d3v, d4v = dv;
        i += h / 6 * (d1i + 2 * d2i + 2 * d3i + d4i);
        x += h / 6 * (d1x + 2 * d2x + 2 * d3x + d4x);
        v += h / 6 * (d1v + 2 * d2v + 2 * d3v + d4v);
        if (p.thermal) dT += h / tauT * (Rtv * Re * i * i - dT);
    }
    if (p.doppler) {
        // a(t + x/c) ≈ a + (x/c)·da/dt, with numpy.gradient's central differences.
        const gradient = new Float64Array(n);
        for (let k = 0; k < n; k++) {
            gradient[k] = k === 0 ? (acceleration[1] - acceleration[0]) / h
                : k === n - 1 ? (acceleration[k] - acceleration[k - 1]) / h
                    : (acceleration[k + 1] - acceleration[k - 1]) / (2 * h);
        }
        for (let k = 0; k < n; k++) acceleration[k] += excursion[k] / C_SOUND * gradient[k];
    }
    const out = downsample(acceleration);
    const gain = Re0 * Mms / (Bl0 * volts);
    for (let k = 0; k < out.length; k++) out[k] *= gain;
    return out;
}

const rms = signal => Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / signal.length);

/**
 * A plant of §12.5. Options:
 * - kind: 'speaker' | 'quadratic' | 'twoWay'; preset (speaker, twoWay): a SPEAKER_PRESETS key;
 *   voltsPerFullScale overrides the preset's drive sensitivity (sets the distortion level).
 * - quadratic: a (even), b (odd), bandHz [high-pass, low-pass] of H, flipGroups, levelFlat
 *   (reference rms; 0 = off).
 * - twoWay: crossoverHz.
 * - mic: m of + m·y²; noiseDbfs (null = no noise); latencySamples (at the device rate);
 *   jitter (0/1-sample jitter between calls); seed.
 */
export function createPlant({
    kind = 'speaker', preset = 'reference', voltsPerFullScale, a = 0.05, b = 0, bandHz = [40, 1500],
    flipGroups = [], levelFlat = 0, crossoverHz = 1200, mic = 0, noiseDbfs = -59, latencySamples = 300,
    jitter = true, seed = 1
} = {}) {
    const speaker = { ...SPEAKER_PRESETS[preset], ...(voltsPerFullScale ? { voltsPerFullScale } : {}) };
    const random = uniform(0x5EED0000 + seed);
    const plant = (input, fs, group) => {
        if (kind === 'speaker') return simulateSpeaker(input, fs, speaker);
        if (kind === 'twoWay') {
            const woofer = simulateSpeaker(filterCascade(input, lr4('lowpass', crossoverHz, fs)), fs, speaker);
            const tweeter = filterCascade(input, lr4('highpass', crossoverHz, fs));
            return woofer.map((value, n) => value + tweeter[n]);
        }
        const band = filterCascade(input, [biquad('highpass', bandHz[0], fs, Math.SQRT1_2), biquad('lowpass', bandHz[1], fs, Math.SQRT1_2)]);
        const sign = flipGroups.includes(group) ? -1 : 1;
        const even = sign * a * (levelFlat ? (levelFlat / rms(input)) ** 2 : 1);
        return Float64Array.from(input, (value, n) => value + even * band[n] * band[n] + b * band[n] ** 3);
    };
    return {
        /** Simulated capture (Float32Array at fsDev) of one call's samples; group names the §3.1 call group. */
        capture(samples, { fsDev = 48000, group = 'a' } = {}) {
            const extra = Math.round(0.5 * fsDev);
            const input = new Float64Array(samples.length + extra);
            input.set(samples);
            let y = filterCascade(plant(input, fsDev, group), linearResponse(fsDev));
            if (mic) y = y.map(value => value + mic * value * value);
            const delay = latencySamples + (jitter && random() < 0.5 ? 1 : 0);
            const noise = noiseDbfs === null ? 0 : 10 ** (noiseDbfs / 20);
            const out = new Float32Array(input.length);
            for (let n = 0; n < out.length; n++) {
                out[n] = (n >= delay ? y[n - delay] : 0) + (noise ? noise * gaussian(random) : 0);
            }
            return out;
        }
    };
}
