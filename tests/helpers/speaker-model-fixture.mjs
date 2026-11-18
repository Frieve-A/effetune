// Small deterministic speakerModel with the stored layout: by default two
// channels, the first fitted for Short only and with a diagnosis block and a sweep record (with a zero
// single-tone response, so the sweep rule passes), the second fitted for both lengths, switched off and
// without a diagnosis block or a sweep record.
import {
    BAND_EDGES,
    CLASSES,
    N_BANDS,
    POWER_LENGTH,
    REF_LENGTH,
    SCALES,
    SETS,
    SWEEP_FREQUENCIES
} from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';

const CALL_GROUPS = ['a', 'a', 'a', 'a', 'a', 'd', 'd', 'd', 'd', 'e', 'e', 'e', 'e', 'f', 'f', 'f', 'f', 'f', 'f'];

/** A typed array of `length` positive values that depend on `seed` only. */
export function filled(Type, length, seed) {
    const values = new Type(length);
    for (let i = 0; i < length; i++) values[i] = Type === Uint16Array ? (i * 7 + seed) % 40 : ((i * 37 + seed * 11) % 97 + 1) * 1e-6;
    return values;
}

const perSet = make => Object.fromEntries(SETS.map((set, i) => [set, make(set, i)]));

function orderSums(seed) {
    return {
        h: Array.from({ length: 10 }, (_, n) => filled(Float32Array, N_BANDS, seed + n)),
        h1: Array.from({ length: 9 }, (_, n) => filled(Float32Array, N_BANDS, seed + 20 + n)),
        z: Array.from({ length: 9 }, (_, n) => filled(Float32Array, N_BANDS, seed + 40 + n))
    };
}

function diagnosis(seed) {
    return {
        nx: filled(Uint16Array, N_BANDS, seed),
        sets: perSet((set, i) => ({
            ev: filled(Float32Array, N_BANDS, seed + i),
            evPn: filled(Float32Array, N_BANDS, seed + i + 4),
            odPn: filled(Float32Array, N_BANDS, seed + i + 8),
            noise: filled(Float32Array, N_BANDS, seed + i + 12)
        })),
        silence: filled(Float32Array, N_BANDS, seed + 16),
        hum50: filled(Float32Array, 20, seed + 17),
        hum60: filled(Float32Array, 16, seed + 18),
        ess: { essL: orderSums(seed + 100), ess6: orderSums(seed + 200), pts: filled(Uint16Array, N_BANDS, seed + 1) }
    };
}

const SWEEP_COUNT = SWEEP_FREQUENCIES.length;
const sweep = seed => ({
    levelDbfs: -20,
    ...Object.fromEntries(['teRe', 'teIm', 'noise', 'gRatio', 't3Re', 't3Im', 'noise3', 'gRatio3'].map((key, i) => [key, filled(Float32Array, SWEEP_COUNT, seed + i)]))
});

const callData = (seed, K) => ({
    peakDbfs: -20 - seed % 13,
    K,
    Y: filled(Float32Array, 16002, seed),
    Pn: filled(Float32Array, 8001, seed + 1)
});

function channel(index, fitted, withDiagnosis) {
    const seed = 1000 * (index + 1);
    const scaleCount = length => (fitted[length] ? SCALES.length : 1);
    const perLength = make => ({ short: make('short'), long: make('long') });
    return {
        index,
        label: index === 0 ? 'Left' : 'Right',
        rateHz: 48000,
        bandwidth: [20, 20000],
        inputDeviceId: 'mic-1',
        inputDeviceLabel: 'Measurement microphone',
        calls: CALL_GROUPS.map((group, i) => ({
            seed: seed + i, take: i % 2 ? 'B' : 'A', group, ...callData(seed + i, 1 + i % 4)
        })),
        drives: Array.from({ length: 10 }, (_, i) => ({ seed: seed + 50 + i, X: filled(Float32Array, 16002, seed + 50 + i) })),
        checkCall: { seed: seed + 70, take: 'A', group: 'c', ...callData(seed + 70, 7) },
        ampRef: perLength(length => (fitted[length] ? 0.25 : null)),
        checkFig: {
            short: fitted.short ? {
                dv: 0,
                fig: [-4.2, -3.1, null, -3.6, -1.2, -2.5],
                level: [-46.6, -52.1, -45.9, -55.0],
                bandSums: filled(Float32Array, 3 * N_BANDS, seed + 80)
            } : null,
            long: null
        },
        weights: perLength(length => (fitted[length] ? filled(Float32Array, 1182, seed + 90) : null)),
        on: perLength(length => fitted[length] && index === 0),
        reason: perLength(length => (!fitted[length] ? 'noFit' : index === 0 ? null : 'worseInCheck')),
        worst: perLength(length => (fitted[length] && index !== 0 ? { set: 'L', class: 'c2' } : null)),
        power: perLength(length => perSet((set, i) => Array.from({ length: scaleCount(length) },
            (_, s) => filled(Float32Array, POWER_LENGTH, seed + 100 + 10 * i + s)))),
        figL: perLength(length => Array.from({ length: scaleCount(length) },
            (_, s) => CLASSES.map((_, k) => (s === 0 ? 0 : k === 2 ? null : -0.5 * (s + k))))),
        ref: perSet((set, i) => filled(Float32Array, REF_LENGTH, seed + 200 + i)),
        micDistortionWarning: index !== 0,
        periodReference: { offset: 0, sign: 1 },
        recordingGaps: index === 0 ? null : 'corrected',
        report: {
            lambda: perLength(length => (fitted[length] ? 0.01 : null)),
            micWeight: perLength(length => (fitted[length] ? 0.5 : null)),
            micShare: perLength(length => (fitted[length] ? 0.2 : null)),
            worst: perLength(length => (fitted[length] ? -1.5 : null)),
            ceiling: [-3, null, -1]
        },
        diagnosis: withDiagnosis ? diagnosis(seed + 300) : null,
        sweep: withDiagnosis ? sweep(seed + 400) : null,
        sweepResponse: perLength(length => (fitted[length] && withDiagnosis ? new Float32Array(2 * SWEEP_COUNT) : null))
    };
}

/**
 * A valid speakerModel; every call returns a new, independent object. Every
 * channel after the first uses the layout of the second one.
 */
export function createSpeakerModel(channelCount = 2) {
    return {
        revision: 1,
        measuredAt: Date.UTC(2026, 10, 13, 9, 30),
        placement: 'inFront',
        averaging: 2,
        levelDbfs: -20,
        peakDbfs: -8,
        upperLimitHz: 8000,
        bands: [...BAND_EDGES],
        recommendedLength: 'short',
        lastCheck: null,
        channels: Array.from({ length: channelCount }, (_, i) =>
            channel(i, { short: true, long: i > 0 }, i === 0))
    };
}
