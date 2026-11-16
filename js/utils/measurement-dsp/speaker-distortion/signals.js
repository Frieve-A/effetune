// Excitation signals of the speaker distortion identification.
import { resampleWindowedSinc } from '../resample.js';
import { SDC_BUFFER } from './kernels.js';

export const N = 48000;
export const MAX_BIN = 8000;
export const SPECTRUM_BINS = MAX_BIN + 1;

const GROUPS = 998;
const ITERATIONS = 100;
const CHIRP_SECONDS = 0.25;
const GAP_SECONDS = 0.25;
const CHIRP_FADE = 480;
const CHIRP_OFFSET = 10 ** (-2 / 20);

/** Deterministic uniform [0, 1) generator. */
export function mulberry32(state) {
    return () => {
        state = (state + 0x6D2B79F5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Whether seed `seed` gets the clip-and-restore iteration (not the loud-peak seeds 8 and 9). */
const iteratesPhases = seed => seed !== 8 && seed !== 9;

/**
 * Line set, amplitudes and start phases of seed `seed` within the Sweep Bandwidth [lo, hi]:
 * { excited: Uint8Array(8001), target: Float64Array(8001), phase: Float64Array(8001) }. The amplitudes
 * and phases are those of the full-band line set; the band only drops the lines outside [lo, hi].
 */
export function combLines(seed, [lowHz, highHz]) {
    const random = mulberry32(2600 + seed);
    const present = new Uint8Array(SPECTRUM_BINS);
    for (let group = 0; group < GROUPS; group++) {
        const size = group === GROUPS - 1 ? 2 : 4;
        const first = 21 + 8 * group;
        for (let i = 0; i < size; i++) present[first + 2 * i] = 1;
        present[first + 2 * Math.floor(random() * size)] = 0;
    }
    const phase = new Float64Array(SPECTRUM_BINS);
    let lowPower = 0;
    let highCount = 0;
    for (let k = 21; k < MAX_BIN; k += 2) {
        if (!present[k]) continue;
        phase[k] = 2 * Math.PI * random();
        if (k <= 499) {
            const amplitude = k <= 120 ? 1 : 120 / k;
            lowPower += amplitude * amplitude;
        } else {
            highCount++;
        }
    }
    const highAmplitude = Math.sqrt(lowPower / (4 * highCount));
    const excited = new Uint8Array(SPECTRUM_BINS);
    const target = new Float64Array(SPECTRUM_BINS);
    for (let k = 21; k < MAX_BIN; k += 2) {
        if (!present[k] || k < lowHz || k > highHz) continue;
        excited[k] = 1;
        target[k] = k <= 120 ? 1 : k <= 499 ? 120 / k : highAmplitude;
    }
    return { excited, target, phase };
}

/** One 48 kHz period x = Σ_k X[k]·e^(+j2πkn/N) over the conjugate-symmetric spectrum, left in IO. */
export function synthesizeInto(context, X) {
    const io = context.view(SDC_BUFFER.IO);
    io.fill(0);
    io[0] = X[0];
    for (let i = 2; i < X.length; i++) io[i] = X[i];
    context.fft(true);
    return io;
}

// Every present line of a seed.
const FULL_BAND = [0, MAX_BIN];

/**
 * Unit-scale full-band COMB drive of seed `seed`: { X: Float64Array(16002), excited }. The
 * clip-and-restore iteration uses the module's 48000-point transform in `context`.
 */
export function combDrive(context, seed) {
    const { excited, target, phase } = combLines(seed, FULL_BAND);
    const X = new Float64Array(2 * SPECTRUM_BINS);
    for (let k = 0; k < SPECTRUM_BINS; k++) {
        if (!excited[k]) continue;
        X[2 * k] = target[k] * Math.cos(phase[k]);
        X[2 * k + 1] = target[k] * Math.sin(phase[k]);
    }
    if (!iteratesPhases(seed)) return { X, excited };
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
        const io = synthesizeInto(context, X);
        let peak = 0;
        for (let n = 0; n < N; n++) {
            const value = io[n] < 0 ? -io[n] : io[n];
            if (value > peak) peak = value;
        }
        const clip = 0.75 * peak;
        for (let n = 0; n < N; n++) io[n] = io[n] > clip ? clip : io[n] < -clip ? -clip : io[n];
        context.fft();
        for (let k = 1; k < SPECTRUM_BINS; k++) {
            if (!excited[k]) continue;
            const re = io[2 * k];
            const im = io[2 * k + 1];
            const magnitude = Math.sqrt(re * re + im * im);
            if (magnitude > 0) {
                X[2 * k] = target[k] * re / magnitude;
                X[2 * k + 1] = target[k] * im / magnitude;
            }
        }
    }
    return { X, excited };
}

const peakOf = (signal, from, to) => {
    let peak = 0;
    for (let n = from; n < to; n++) {
        const value = signal[n] < 0 ? -signal[n] : signal[n];
        if (value > peak) peak = value;
    }
    return peak;
};

const resampleTo = (signal, fsDev) => resampleWindowedSinc(signal, N, fsDev);

/** Start and end frequency of the sync chirp within the selected bandwidth. */
export function syncChirpRange(bandwidth) {
    const [lowHz, highHz] = bandwidth;
    const startHz = lowHz > 100 ? lowHz : 100;
    const endHz = highHz < 8000 ? highHz : 8000;
    return startHz < endHz ? [startHz, endHz] : bandwidth;
}

// Lowest and highest line the level check judges.
const JUDGED_LINE_RANGE_HZ = [50, MAX_BIN - 1];

/**
 * Whether the Sweep Bandwidth [lo, hi] can be measured: it spans at least 8 Hz of the judged
 * lines, so it holds four consecutive odd line slots and every seed (which drops one slot of
 * each group of four) keeps at least two lines.
 */
export function isMeasurableBand(bandwidth) {
    const [lowHz, highHz] = bandwidth;
    const [lineLow, lineHigh] = JUDGED_LINE_RANGE_HZ;
    return (highHz < lineHigh ? highHz : lineHigh) - (lowHz > lineLow ? lowHz : lineLow) >= 8;
}

/** Unit-peak sync chirp at 48 kHz. */
function syncChirp(bandwidth) {
    const length = CHIRP_SECONDS * N;
    const [f1, f2] = syncChirpRange(bandwidth);
    const logRatio = Math.log(f2 / f1);
    const chirp = new Float64Array(length);
    for (let n = 0; n < length; n++) {
        const fade = n < CHIRP_FADE ? 0.5 - 0.5 * Math.cos(Math.PI * n / CHIRP_FADE)
            : n >= length - CHIRP_FADE ? 0.5 - 0.5 * Math.cos(Math.PI * (length - 1 - n) / CHIRP_FADE) : 1;
        chirp[n] = fade * Math.sin(2 * Math.PI * f1 * CHIRP_SECONDS / logRatio *
            (Math.exp(n / N * logRatio / CHIRP_SECONDS) - 1));
    }
    return chirp;
}

// The K + 2 periods of the 48 kHz `period` after the chirp and gap, with whole-period fades, at fsDev.
function periodicAt(period, K, fsDev) {
    const start = (CHIRP_SECONDS + GAP_SECONDS) * N;
    const periodic = new Float64Array(start + (K + 2) * N);
    for (let i = 0; i < K + 2; i++) {
        const offset = start + i * N;
        for (let n = 0; n < N; n++) {
            const fade = i === 0 ? 0.5 - 0.5 * Math.cos(Math.PI * n / N)
                : i === K + 1 ? 0.5 + 0.5 * Math.cos(Math.PI * n / N) : 1;
            periodic[offset + n] = period[n] * fade;
        }
    }
    return resampleTo(periodic, fsDev);
}

// Peak of the K averaged periods of a device-rate call or periodic part.
const periodicPeak = (signal, K, fsDev) => peakOf(signal, Math.round(1.5 * fsDev), Math.round((1.5 + K) * fsDev));

// Factor that brings the peak of the K averaged periods of `periodicDev` to `targetDbfs`.
const levelFactor = (periodicDev, targetDbfs, K, fsDev) => 10 ** (targetDbfs / 20) / periodicPeak(periodicDev, K, fsDev);

/**
 * Device-rate call from the 48 kHz period `period`: chirp, gap and K + 2 periods with
 * whole-period fades. With `factor` null the periodic part is scaled so that the peak of its K
 * averaged periods equals `targetDbfs`; a corrected pass passes factor 1 because its period
 * already has the played scale. The chirp peaks 2 dB below the target. Returns
 * { samples: Float32Array, chirp: Float32Array, factor }.
 */
export function assembleCall(period, { targetDbfs, K, fsDev, bandwidth, factor = null }) {
    const periodicDev = periodicAt(period, K, fsDev);
    const chirpDev = resampleTo(syncChirp(bandwidth), fsDev);
    const scale = factor ?? levelFactor(periodicDev, targetDbfs, K, fsDev);
    const chirpFactor = 10 ** (targetDbfs / 20) * CHIRP_OFFSET / peakOf(chirpDev, 0, chirpDev.length);
    const samples = new Float32Array(periodicDev.length);
    for (let n = 0; n < samples.length; n++) samples[n] = periodicDev[n] * scale;
    for (let n = 0; n < chirpDev.length; n++) samples[n] += chirpDev[n] * chirpFactor;
    return { samples, chirp: samples.slice(0, chirpDev.length), factor: scale };
}

/**
 * Call of a drive: { samples, chirp, X, factor } with X = X_unit × the level factor
 * as Float32Array(16002), the stored drive spectrum. `settings.factor` fixes the factor (the (e)
 * call plays the (d) factor × 10^(−6/20)).
 */
export function buildCall(context, unitX, settings) {
    const period = Float64Array.from(synthesizeInto(context, unitX));
    const { samples, chirp, factor } = assembleCall(period, settings);
    const X = new Float32Array(unitX.length);
    for (let i = 0; i < X.length; i++) X[i] = unitX[i] * factor;
    return { samples, chirp, X, factor };
}

/**
 * Call of seed `seed` within `settings.bandwidth`: the full-band call with the lines outside the
 * band removed, as a crossover would remove them. Every in-band line keeps its full-band phase and
 * played level, so the peak of a band-limited call is not held at the target (the phases keep the
 * crest factor low only for the full line set); `factor` is the full-band factor, reduced only when
 * the call would otherwise peak above 0 dBFS (`settings.factor` fixes it as in buildCall).
 */
export function seedCall(context, seed, settings) {
    const { X, excited: present } = combDrive(context, seed);
    const { excited } = combLines(seed, settings.bandwidth);
    if (!present.some((line, k) => line && !excited[k])) return buildCall(context, X, settings);
    const { targetDbfs, K, fsDev, factor = null } = settings;
    const fullFactor = factor ?? levelFactor(periodicAt(synthesizeInto(context, X), K, fsDev), targetDbfs, K, fsDev);
    for (let k = 0; k < SPECTRUM_BINS; k++) {
        if (excited[k]) continue;
        X[2 * k] = 0;
        X[2 * k + 1] = 0;
    }
    const call = buildCall(context, X, { ...settings, factor: fullFactor });
    if (factor !== null || periodicPeak(call.samples, K, fsDev) <= 1) return call;
    // Dropping lines can raise the peak of a loud call above full scale: bring it to exactly 0 dBFS.
    return buildCall(context, X, {
        ...settings,
        factor: levelFactor(periodicAt(synthesizeInto(context, X), K, fsDev), 0, K, fsDev),
    });
}

/** Level check signal from capture 1 and capture 16 at device rate `fsDev`. */
export function levelCheckSignal(capture1, capture16, fsDev) {
    const first = Math.round(3.5 * fsDev);
    const pause = Math.round(0.5 * fsDev);
    const loud = Math.round(1.5 * fsDev);
    const signal = new Float32Array(first + pause + loud + Math.round(3 * fsDev));
    signal.set(capture1.subarray(0, first));
    signal.set(capture16.subarray(0, loud), first + pause);
    return signal;
}
