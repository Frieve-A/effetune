#!/usr/bin/env node
// Calibration harness for the Tube Simulator "Listening (THD-matched)" preset
// bank.
//
// The harness never rebuilds the DSP: it instantiates the shipped
// plugins/dsp/effetune-dsp.wasm artifact directly and drives the
// TubeSimulatorPlugin kernel through the public engine binding.
//
// Measurement conditions (fixed):
//   * 96 kHz, 1 kHz sine, 0 dBFS peak, stereo, 128-frame blocks.
//   * Input reference `iv` stays at the preset-standard 2.828 Vpk unless the
//     circuit cannot reach the THD target at dr = 0 dB, in which case `iv` is
//     raised (drive = iv * 10^(dr/20) is a single scalar in the kernel, so the
//     two knobs are exactly equivalent).
//   * 3 s (288000 samples) of settling is discarded, then exactly 4608
//     samples (48 whole 1 kHz periods) are analysed with a rectangular-window
//     DFT so every harmonic lands on an integer bin and leaks nothing. 3 s is
//     the measured settling floor of this kernel: the slow bias/supply
//     exponentials of the Line stage are still moving at 0.5 s (12AX7 reads
//     1.0002 % there against a true 1.0644 %, i.e. 6.4 % low), while 3 s and
//     10 s agree to the printed precision on all seven presets.
//   * THD is harmonics 2..10 over the fundamental.
//   * Loudness trim is og = -20*log10(G) with G the measured 1 kHz
//     fundamental input/output gain at og = 0 dB.
//   * Safety: every calibrated record is re-run through a silence -> full-scale
//     step and a noise -> silence decay tail. `shipBlocked` is the verdict, and
//     a blocked record makes the process exit non-zero.
//
// The THD-vs-drive response of this kernel is NOT monotonic (12AX7 open-loop
// has a confirmed non-monotonic region), so the solver is a coarse grid scan
// followed by local refinement of the LOWEST-drive bracket that reaches the
// target: the goal is the plain distortion region, not the clipping region.
//
// Usage:
//   node tests/tools/tube-simulator-lineamp/calibrate-listening-presets.mjs
//   node ... --only=listening-line-12au7-thd1 --json=out.json
//
// Output: JSON array of
//   { id, label, targetThdPercent, dr, iv, og, measuredThdPercent,
//     measuredGainDb, faultCount, shipBlocked, ... } on stdout, progress on
//   stderr.

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { DSP_PARAM_PACKERS } from '../../../js/audio/dsp-params.generated.js';
import { instantiateDsp } from '../../../js/audio/dsp-wasm-loader.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export const SAMPLE_RATE = 96000;
export const BLOCK_SIZE = 128;
export const TELEMETRY_BYTES = 32768;
export const TONE_HZ = 1000;
// 3 s: the measured steady-state floor of this kernel (see the header note).
export const SETTLE_SAMPLES = SAMPLE_RATE * 3;
export const ANALYSIS_SAMPLES = 4608;
export const HARMONIC_ORDERS = Object.freeze([2, 3, 4, 5, 6, 7, 8, 9, 10]);
export const NOMINAL_INPUT_REFERENCE = 2.828;
export const MAX_INPUT_REFERENCE = 20;
// Grid pitch of the coarse THD-vs-drive scan. The response is non-monotonic, so
// a different pitch can bracket a different solution: the default is the value
// the baked bank was generated with, and it is echoed into every output record.
export const DEFAULT_COARSE_STEP_DB = 2;
// RMS bucket level below which the decay envelope stops being an audibility
// question; monotonicity is only judged above it.
export const AUDIBLE_FLOOR_DBFS = -120;
const FUNDAMENTAL_BIN = (TONE_HZ * ANALYSIS_SAMPLES) / SAMPLE_RATE;

// Listening bank definition. Circuit values are inherited verbatim
// from the canonical presets; only dr / iv / og are calibrated.
export const LISTENING_BANK = Object.freeze([
    Object.freeze({
        id: 'listening-line-12au7-thd1', label: 'Line 12AU7 @1%',
        base: 'line-default', overrides: Object.freeze({}), targetThdPercent: 1
    }),
    Object.freeze({
        id: 'listening-line-12at7-thd1', label: 'Line 12AT7 @1%',
        base: 'line-default', overrides: Object.freeze({ tp: '12AT7' }), targetThdPercent: 1
    }),
    Object.freeze({
        id: 'listening-line-12ax7-thd1', label: 'Line 12AX7 @1%',
        base: 'line-default', overrides: Object.freeze({ tp: '12AX7' }), targetThdPercent: 1
    }),
    Object.freeze({
        id: 'listening-line-12au7-open-loop-thd3', label: 'Line 12AU7 Open-Loop @3%',
        base: 'line-default', overrides: Object.freeze({ nf: 0 }), targetThdPercent: 3
    }),
    Object.freeze({
        id: 'listening-power-el84-pentode-thd2', label: 'EL84 Pentode @2%',
        base: 'power-el84-pentode-10w', overrides: Object.freeze({}), targetThdPercent: 2
    }),
    Object.freeze({
        id: 'listening-power-el84-distributed-thd2', label: 'EL84 Distributed @2%',
        base: 'power-el84-distributed-10w', overrides: Object.freeze({}), targetThdPercent: 2
    }),
    Object.freeze({
        id: 'listening-power-el34-distributed-thd2', label: 'EL34 Distributed @2%',
        base: 'power-el34-distributed-20-37w', overrides: Object.freeze({}), targetThdPercent: 2
    })
]);

// Reads TUBE_SIMULATOR_CANONICAL_PRESETS / TUBE_SIMULATOR_LISTENING_PRESETS out
// of the browser plugin without importing it as a module and without editing
// it: the accessor snippet is appended to the evaluated source only.
export function readPluginPresetTables(root = repoRoot) {
    const source = fs.readFileSync(
        path.join(root, 'plugins', 'saturation', 'tube_simulator.js'), 'utf8');
    const context = vm.createContext({
        PluginBase: class { registerProcessor() {} },
        console, performance: { now: () => 0 }, window: {}
    });
    vm.runInContext(
        `${source}\n;window.__presetTables = {` +
        ' canonical: TUBE_SIMULATOR_CANONICAL_PRESETS,' +
        ' listening: TUBE_SIMULATOR_LISTENING_PRESETS,' +
        ' fields: TUBE_SIMULATOR_PARAMETER_FIELDS };',
        context,
        { filename: 'tube_simulator.js' }
    );
    const tables = context.window.__presetTables;
    // Array.from rehomes the vm-realm arrays into this realm so that strict
    // deep-equality (which compares prototypes) works on the results.
    const copy = presets => Array.from(presets, preset => ({
        id: preset.id, label: preset.label, params: { ...preset.params }
    }));
    return {
        fields: Array.from(tables.fields),
        canonical: copy(tables.canonical),
        listening: copy(tables.listening)
    };
}

// drive = iv * 10^(dr/20); a single drive offset in dB relative to the nominal
// 2.828 Vpk reference therefore maps onto (dr, iv) unambiguously.
export function driveOffsetToParams(offsetDb) {
    if (offsetDb <= 0) {
        return { dr: offsetDb, iv: NOMINAL_INPUT_REFERENCE };
    }
    return {
        dr: 0,
        iv: Math.min(
            MAX_INPUT_REFERENCE,
            NOMINAL_INPUT_REFERENCE * Math.pow(10, offsetDb / 20)
        )
    };
}

export const MIN_DRIVE_OFFSET_DB = -96;
export const MAX_DRIVE_OFFSET_DB =
    20 * Math.log10(MAX_INPUT_REFERENCE / NOMINAL_INPUT_REFERENCE);

function goertzelBin(samples, bin) {
    // Rectangular-window DFT at an exact integer bin.
    const omega = (2 * Math.PI * bin) / samples.length;
    let real = 0;
    let imaginary = 0;
    for (let index = 0; index < samples.length; index++) {
        const phase = omega * index;
        real += samples[index] * Math.cos(phase);
        imaginary -= samples[index] * Math.sin(phase);
    }
    return Math.hypot(real, imaginary);
}

export function analyseTone(samples) {
    const fundamental = goertzelBin(samples, FUNDAMENTAL_BIN);
    let harmonicPower = 0;
    const harmonics = [];
    for (const order of HARMONIC_ORDERS) {
        const magnitude = goertzelBin(samples, FUNDAMENTAL_BIN * order);
        harmonics.push(magnitude);
        harmonicPower += magnitude * magnitude;
    }
    const thdPercent = fundamental > 0
        ? (Math.sqrt(harmonicPower) / fundamental) * 100
        : Number.NaN;
    // Peak amplitude of the fundamental for a rectangular window of N samples.
    const amplitude = (2 * fundamental) / samples.length;
    return { thdPercent, fundamentalAmplitude: amplitude, harmonics };
}

/**
 * Runs one steady-state measurement on a freshly created instance so that the
 * very first setParams applies without a reset-class transition (which would
 * otherwise inject a 60 ms dry window).
 */
export function measureSteadyState(binding, packer, params, options = {}) {
    const settle = options.settleSamples ?? SETTLE_SAMPLES;
    const analysis = options.analysisSamples ?? ANALYSIS_SAMPLES;
    const amplitude = options.amplitude ?? 1;
    const instance = binding.createInstance('TubeSimulatorPlugin');
    if (!instance) throw new Error('failed to create a TubeSimulatorPlugin instance');
    try {
        // The automatic output safety reduction is switched off for the measurement. It sits
        // behind the amplifier model and attenuates whatever runs past digital full scale, and
        // this probe drives a 0 dBFS tone on purpose, so leaving it on would report the
        // protection's attenuation as the preset's gain and its own gain ride as distortion.
        // The baked THD and 1 kHz gain describe the model, which the setting does not touch.
        // The speaker actually connected is set to the tap the record was designed around, which
        // is where the baked THD and gain were measured. Left on the parameter default it would
        // be a mismatch for every record whose assumed load is not 8 ohms, and the measurement
        // would describe a plant the record does not.
        const status = binding.instanceSetParams(
            instance,
            packer.pack({ ...params, rl: Number(params.sl ?? 8), ag: false }),
            packer.hash);
        if (status !== 0) throw new Error(`instanceSetParams rejected the record (${status})`);
        const captured = new Float64Array(analysis);
        const total = settle + analysis;
        let produced = 0;
        while (produced < total) {
            const frames = Math.min(BLOCK_SIZE, total - produced);
            const arena = binding.getArenaViews();
            for (let channel = 0; channel < 2; channel++) {
                const offset = channel * BLOCK_SIZE;
                for (let frame = 0; frame < frames; frame++) {
                    arena.combined[offset + frame] =
                        amplitude * Math.sin((2 * Math.PI * TONE_HZ * (produced + frame)) / SAMPLE_RATE);
                }
            }
            const code = binding.instanceProcess(
                instance, arena.offsets.combined, 2, frames, produced / SAMPLE_RATE);
            if (code !== 0) throw new Error(`instanceProcess failed (${code})`);
            const view = binding.getArenaViews();
            for (let frame = 0; frame < frames; frame++) {
                const absolute = produced + frame;
                if (absolute >= settle) captured[absolute - settle] = view.combined[frame];
            }
            produced += frames;
        }
        const event = binding.instanceRuntimeEvent(instance);
        const analysed = analyseTone(captured);
        return {
            ...analysed,
            gainDb: 20 * Math.log10(analysed.fundamentalAmplitude / amplitude),
            runtimeEvent: event,
            finite: captured.every(Number.isFinite)
        };
    } finally {
        binding.destroyInstance(instance);
    }
}

/**
 * Drives 1 s of 0.9 FS noise followed by digital silence and reports the output
 * envelope in 0.5 s RMS buckets. Power-stage self-oscillation is not excited by
 * pure silence from reset, so the noise burst is the required primer.
 *
 * The bias/supply recovery of the Line stage is a genuinely slow exponential,
 * so a single 2 s reading is not by itself a verdict: the criterion applied
 * here is "envelope decays monotonically and reaches the inaudible floor",
 * with the 2 s reading reported alongside it.
 *
 * Monotonicity is judged in the audible region only. Once a bucket has fallen
 * below AUDIBLE_FLOOR_DBFS the remaining numbers are denormal-grade arithmetic
 * noise (-239.1 -> -237.7 dBFS is a typical "rise"), and treating those as a
 * non-monotonic tail would report a fault nobody can hear.
 */
export function measureDecayTail(binding, packer, params, options = {}) {
    const noiseSamples = options.noiseSamples ?? SAMPLE_RATE;
    const silenceSamples = options.silenceSamples ?? SAMPLE_RATE * 12;
    const bucketSamples = options.bucketSamples ?? SAMPLE_RATE / 2;
    const inaudibleDbfs = options.inaudibleDbfs ?? AUDIBLE_FLOOR_DBFS;
    const instance = binding.createInstance('TubeSimulatorPlugin');
    if (!instance) throw new Error('failed to create a TubeSimulatorPlugin instance');
    try {
        const status = binding.instanceSetParams(instance, packer.pack(params), packer.hash);
        if (status !== 0) throw new Error(`instanceSetParams rejected the record (${status})`);
        let seed = 0x9e3779b9;
        const nextNoise = () => {
            seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
            return ((seed / 0x100000000) * 2 - 1) * 0.9;
        };
        const total = noiseSamples + silenceSamples;
        const bucketCount = Math.floor(silenceSamples / bucketSamples);
        const energy = new Float64Array(bucketCount);
        const counts = new Float64Array(bucketCount);
        let produced = 0;
        let peakDuringNoise = 0;
        while (produced < total) {
            const frames = Math.min(BLOCK_SIZE, total - produced);
            const arena = binding.getArenaViews();
            for (let frame = 0; frame < frames; frame++) {
                const value = produced + frame < noiseSamples ? nextNoise() : 0;
                arena.combined[frame] = value;
                arena.combined[BLOCK_SIZE + frame] = value;
            }
            const code = binding.instanceProcess(
                instance, arena.offsets.combined, 2, frames, produced / SAMPLE_RATE);
            if (code !== 0) throw new Error(`instanceProcess failed (${code})`);
            const view = binding.getArenaViews();
            for (let frame = 0; frame < frames; frame++) {
                const absolute = produced + frame;
                const sample = view.combined[frame];
                if (absolute < noiseSamples) {
                    peakDuringNoise = Math.max(peakDuringNoise, Math.abs(sample));
                    continue;
                }
                const bucket = Math.floor((absolute - noiseSamples) / bucketSamples);
                if (bucket >= bucketCount) continue;
                energy[bucket] += sample * sample;
                counts[bucket] += 1;
            }
            produced += frames;
        }
        const envelopeDbfs = Array.from(energy, (value, index) => {
            const rms = counts[index] > 0 ? Math.sqrt(value / counts[index]) : 0;
            return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
        });
        const bucketSeconds = bucketSamples / SAMPLE_RATE;
        const twoSecondBucket = Math.round(2 / bucketSeconds) - 1;
        const inaudibleIndex = envelopeDbfs.findIndex(value => value <= inaudibleDbfs);
        return {
            envelopeDbfs,
            bucketSeconds,
            tailRmsDbfs: envelopeDbfs[Math.min(twoSecondBucket, envelopeDbfs.length - 1)],
            finalRmsDbfs: envelopeDbfs[envelopeDbfs.length - 1],
            audibleFloorDbfs: inaudibleDbfs,
            decayMonotonic: envelopeDbfs.every((value, index) =>
                index === 0 ||
                value <= inaudibleDbfs ||
                value <= envelopeDbfs[index - 1] + 0.5),
            secondsToInaudible: inaudibleIndex < 0 ? null : (inaudibleIndex + 1) * bucketSeconds,
            peakDuringNoise,
            runtimeEvent: binding.instanceRuntimeEvent(instance)
        };
    } finally {
        binding.destroyInstance(instance);
    }
}

/**
 * Silence -> full-scale step, exercising the transient the plan's safety check
 * calls for. Returns the runtime event after the step.
 */
export function measureStepSafety(binding, packer, params, options = {}) {
    const silenceSamples = options.silenceSamples ?? SAMPLE_RATE / 4;
    const driveSamples = options.driveSamples ?? SAMPLE_RATE;
    const instance = binding.createInstance('TubeSimulatorPlugin');
    if (!instance) throw new Error('failed to create a TubeSimulatorPlugin instance');
    try {
        const status = binding.instanceSetParams(instance, packer.pack(params), packer.hash);
        if (status !== 0) throw new Error(`instanceSetParams rejected the record (${status})`);
        const total = silenceSamples + driveSamples;
        let produced = 0;
        let finite = true;
        while (produced < total) {
            const frames = Math.min(BLOCK_SIZE, total - produced);
            const arena = binding.getArenaViews();
            for (let frame = 0; frame < frames; frame++) {
                const absolute = produced + frame;
                const value = absolute < silenceSamples
                    ? 0
                    : Math.sin((2 * Math.PI * TONE_HZ * absolute) / SAMPLE_RATE);
                arena.combined[frame] = value;
                arena.combined[BLOCK_SIZE + frame] = value;
            }
            const code = binding.instanceProcess(
                instance, arena.offsets.combined, 2, frames, produced / SAMPLE_RATE);
            if (code !== 0) throw new Error(`instanceProcess failed (${code})`);
            const view = binding.getArenaViews();
            for (let frame = 0; frame < frames; frame++) {
                if (!Number.isFinite(view.combined[frame])) finite = false;
            }
            produced += frames;
        }
        return { finite, runtimeEvent: binding.instanceRuntimeEvent(instance) };
    } finally {
        binding.destroyInstance(instance);
    }
}

function thdAtOffset(cache, binding, packer, baseParams, offsetDb) {
    const key = offsetDb.toFixed(6);
    if (cache.has(key)) return cache.get(key);
    const { dr, iv } = driveOffsetToParams(offsetDb);
    const result = measureSteadyState(binding, packer, { ...baseParams, dr, iv, og: 0 });
    const record = { offsetDb, dr, iv, ...result };
    cache.set(key, record);
    return record;
}

/**
 * Coarse grid scan + local refinement. Returns the solution with the LOWEST
 * drive that reaches the target, plus every sampled point and the observed
 * non-monotonic intervals.
 */
export function solveDriveForThd(binding, packer, baseParams, targetThdPercent, options = {}) {
    const coarseStepDb = options.coarseStepDb ?? DEFAULT_COARSE_STEP_DB;
    const minOffset = options.minOffsetDb ?? MIN_DRIVE_OFFSET_DB;
    const maxOffset = options.maxOffsetDb ?? MAX_DRIVE_OFFSET_DB;
    const toleranceDb = options.toleranceDb ?? 0.002;
    const onSample = options.onSample ?? (() => {});
    const cache = new Map();

    const grid = [];
    for (let offset = minOffset; offset < maxOffset; offset += coarseStepDb) {
        grid.push(Number(offset.toFixed(6)));
    }
    grid.push(Number(maxOffset.toFixed(6)));

    const samples = [];
    for (const offset of grid) {
        const record = thdAtOffset(cache, binding, packer, baseParams, offset);
        samples.push(record);
        onSample(record);
    }

    const nonMonotonicIntervals = [];
    for (let index = 1; index < samples.length; index++) {
        if (samples[index].thdPercent < samples[index - 1].thdPercent) {
            nonMonotonicIntervals.push({
                fromOffsetDb: samples[index - 1].offsetDb,
                toOffsetDb: samples[index].offsetDb,
                fromThdPercent: samples[index - 1].thdPercent,
                toThdPercent: samples[index].thdPercent
            });
        }
    }

    // Lowest-drive upward crossing of the target.
    let bracket = null;
    for (let index = 1; index < samples.length; index++) {
        const low = samples[index - 1];
        const high = samples[index];
        if ((low.thdPercent - targetThdPercent) * (high.thdPercent - targetThdPercent) <= 0 &&
            low.thdPercent !== high.thdPercent) {
            bracket = { low, high };
            break;
        }
    }

    if (!bracket) {
        const best = samples.reduce((accumulator, candidate) =>
            Math.abs(candidate.thdPercent - targetThdPercent) <
            Math.abs(accumulator.thdPercent - targetThdPercent) ? candidate : accumulator);
        return {
            reachedTarget: false, solution: best, samples, nonMonotonicIntervals,
            coarseStepDb,
            maxThdPercent: Math.max(...samples.map(sample => sample.thdPercent))
        };
    }

    // Bisection inside the bracket, where the response is locally monotonic.
    let low = bracket.low;
    let high = bracket.high;
    while (high.offsetDb - low.offsetDb > toleranceDb) {
        const middleOffset = Number(((low.offsetDb + high.offsetDb) / 2).toFixed(6));
        const middle = thdAtOffset(cache, binding, packer, baseParams, middleOffset);
        onSample(middle);
        const lowSide = low.thdPercent - targetThdPercent;
        const middleSide = middle.thdPercent - targetThdPercent;
        if (lowSide === 0) { high = low; break; }
        if (lowSide * middleSide <= 0) high = middle; else low = middle;
    }
    const solution =
        Math.abs(low.thdPercent - targetThdPercent) <= Math.abs(high.thdPercent - targetThdPercent)
            ? low : high;
    return {
        reachedTarget: true, solution, samples, nonMonotonicIntervals,
        coarseStepDb,
        maxThdPercent: Math.max(...samples.map(sample => sample.thdPercent))
    };
}

function roundTo(value, digits) {
    const scale = Math.pow(10, digits);
    return Math.round(value * scale) / scale;
}

export async function calibrate(options = {}) {
    const only = options.only ?? null;
    const log = options.log ?? (message => process.stderr.write(`${message}\n`));
    const tables = readPluginPresetTables();
    const canonicalById = new Map(tables.canonical.map(preset => [preset.id, preset.params]));
    const wasmBytes = fs.readFileSync(
        path.join(repoRoot, 'plugins', 'dsp', 'effetune-dsp.wasm'));
    const packer = DSP_PARAM_PACKERS.get('TubeSimulatorPlugin');
    if (!packer) throw new Error('TubeSimulatorPlugin parameter packer is unavailable');

    const results = [];
    for (const entry of LISTENING_BANK) {
        if (only && entry.id !== only) continue;
        const base = canonicalById.get(entry.base);
        if (!base) throw new Error(`unknown base preset ${entry.base}`);
        const baseParams = { ...base, ...entry.overrides };
        const started = Date.now();
        // A fresh binding per preset guarantees a clean engine and keeps the
        // first setParams of every instance transition-free.
        const binding = await instantiateDsp(wasmBytes);
        try {
            if (binding.createEngine() === 0) throw new Error('createEngine failed');
            const prepared = binding.prepare(SAMPLE_RATE, 2, BLOCK_SIZE, TELEMETRY_BYTES);
            if (prepared !== 0) throw new Error(`prepare failed (${prepared})`);

            let sampleCount = 0;
            const solved = solveDriveForThd(binding, packer, baseParams, entry.targetThdPercent, {
                coarseStepDb: options.coarseStepDb,
                onSample: record => {
                    sampleCount++;
                    log(`  [${entry.id}] offset=${record.offsetDb.toFixed(4)} dB ` +
                        `THD=${record.thdPercent.toFixed(4)}% gain=${record.gainDb.toFixed(3)} dB`);
                }
            });

            // The baked record carries the rounded knob values, so the loudness
            // trim is derived from a measurement taken at exactly those values.
            const dr = roundTo(solved.solution.dr, 4);
            const iv = roundTo(solved.solution.iv, 4);
            const atRounded = measureSteadyState(
                binding, packer, { ...baseParams, dr, iv, og: 0 });
            const og = roundTo(-atRounded.gainDb, 3);
            const ogClamped = Math.min(48, Math.max(-48, og));
            const verified = measureSteadyState(
                binding, packer, { ...baseParams, dr, iv, og: ogClamped });
            const step = measureStepSafety(
                binding, packer, { ...baseParams, dr, iv, og: ogClamped });
            const decay = measureDecayTail(
                binding, packer, { ...baseParams, dr, iv, og: ogClamped });

            const faultCount = [verified, step, decay]
                .filter(measurement => (measurement.runtimeEvent?.cause ?? 0) !== 0).length;
            const params = { ...baseParams, dr, iv, og: ogClamped };

            // Ship gate: a preset that latches a permanent dry
            // state, emits a non-finite sample, or fails to decay while still
            // audible must not be shipped. This is the verdict, not a reading.
            const outputFinite = verified.finite && step.finite;
            const shipBlockedReasons = [];
            if (faultCount > 0) shipBlockedReasons.push('runtime fault latched');
            if (!outputFinite) shipBlockedReasons.push('non-finite output');
            if (!decay.decayMonotonic) {
                shipBlockedReasons.push(
                    `decay tail rises above ${decay.audibleFloorDbfs} dBFS`);
            }
            const shipBlocked = shipBlockedReasons.length > 0;
            if (shipBlocked) {
                log(`[${entry.id}] SHIP BLOCKED: ${shipBlockedReasons.join('; ')}`);
            }

            results.push({
                id: entry.id,
                label: entry.label,
                base: entry.base,
                targetThdPercent: entry.targetThdPercent,
                dr,
                iv,
                og: ogClamped,
                ogClampedFromDb: og === ogClamped ? null : og,
                measuredThdPercent: roundTo(verified.thdPercent, 4),
                measuredGainDb: roundTo(verified.gainDb, 4),
                calibrationThdPercent: roundTo(solved.solution.thdPercent, 4),
                calibrationGainDb: roundTo(solved.solution.gainDb, 4),
                reachedTarget: solved.reachedTarget,
                coarseStepDb: solved.coarseStepDb,
                settleSamples: SETTLE_SAMPLES,
                analysisSamples: ANALYSIS_SAMPLES,
                maxAchievableThdPercent: roundTo(solved.maxThdPercent, 4),
                nonMonotonicIntervals: solved.nonMonotonicIntervals.map(interval => ({
                    fromOffsetDb: roundTo(interval.fromOffsetDb, 4),
                    toOffsetDb: roundTo(interval.toOffsetDb, 4),
                    fromThdPercent: roundTo(interval.fromThdPercent, 4),
                    toThdPercent: roundTo(interval.toThdPercent, 4)
                })),
                faultCount,
                runtimeEvents: {
                    steadyState: verified.runtimeEvent,
                    silenceToFullScaleStep: step.runtimeEvent,
                    noiseDecay: decay.runtimeEvent
                },
                decayTailRmsDbfsAt2s: Number.isFinite(decay.tailRmsDbfs)
                    ? roundTo(decay.tailRmsDbfs, 2) : -999,
                decayFinalRmsDbfs: Number.isFinite(decay.finalRmsDbfs)
                    ? roundTo(decay.finalRmsDbfs, 2) : -999,
                decayMonotonic: decay.decayMonotonic,
                decayAudibleFloorDbfs: decay.audibleFloorDbfs,
                decaySecondsToInaudible: decay.secondsToInaudible,
                decayEnvelopeDbfs: decay.envelopeDbfs.map(value =>
                    Number.isFinite(value) ? roundTo(value, 2) : -999),
                decayPeakDuringNoise: roundTo(decay.peakDuringNoise, 6),
                outputFinite,
                shipBlocked,
                shipBlockedReasons,
                measurementCount: sampleCount,
                elapsedSeconds: roundTo((Date.now() - started) / 1000, 1),
                params
            });
            const summary = results.at(-1);
            log(`[${entry.id}] dr=${dr} iv=${iv} og=${ogClamped} ` +
                `THD=${verified.thdPercent.toFixed(4)}% gain=${verified.gainDb.toFixed(4)} dB ` +
                `faults=${faultCount} tail@2s=${summary.decayTailRmsDbfsAt2s} dBFS ` +
                `final=${summary.decayFinalRmsDbfs} dBFS ` +
                `inaudibleAfter=${summary.decaySecondsToInaudible}s ` +
                `monotonic=${summary.decayMonotonic} shipBlocked=${summary.shipBlocked} ` +
                `(${summary.elapsedSeconds}s)`);
        } finally {
            binding.close();
        }
    }
    return results;
}

function parseArguments(argv) {
    const options = {};
    for (const argument of argv) {
        const match = /^--([^=]+)(?:=(.*))?$/.exec(argument);
        if (!match) continue;
        const [, key, value] = match;
        if (key === 'only') options.only = value;
        else if (key === 'json') options.json = value;
        else if (key === 'coarse-step') options.coarseStepDb = Number(value);
    }
    return options;
}

const invokedDirectly = process.argv[1] &&
    path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
    const options = parseArguments(process.argv.slice(2));
    const results = await calibrate(options);
    const serialized = JSON.stringify(results, null, 2);
    if (options.json) fs.writeFileSync(options.json, `${serialized}\n`);
    process.stdout.write(`${serialized}\n`);
    const blocked = results.filter(result => result.shipBlocked);
    if (blocked.length > 0) {
        process.stderr.write(
            `SHIP BLOCKED (${blocked.length}/${results.length}): ` +
            `${blocked.map(result => result.id).join(', ')}\n`);
        process.exitCode = 1;
    }
}
