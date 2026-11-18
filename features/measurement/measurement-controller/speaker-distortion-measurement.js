/**
 * Speaker distortion measurement orchestration: the per-channel run (level check, captures,
 * analysis, correction check), Check again and the model assembly. Playback, pauses and status
 * display are injected by the caller; the analysis functions come from the speaker-distortion
 * module (`deps`, the module namespace by default) and are resolved at call time.
 */
import * as speakerDistortion from '../../../js/utils/measurement-dsp/speaker-distortion/index.js';
import { essPlaybackSeconds } from '../../../js/utils/measurement-dsp/ess.js';
import { MAX_REPLAYS } from '../../../js/utils/measurement-dsp/recording-gaps.js';

// A recording whose peak |x| reaches this value is an overload.
export const CAPTURE_OVERLOAD_PEAK = 0.999;

const LEVEL_CHECK_SECONDS = 8.5;
// The analysis of one channel takes about 18 s on a desktop computer.
const ANALYSIS_SECONDS = 20;
// Plain, Short and Long (9.5 s each with 0.5 s gaps) and three odd passes; the
// high-volume check is not counted.
const CORRECTION_CHECK_SECONDS = 29.5 + 3 * 10;
const AFTER_CAPTURES_SECONDS = ANALYSIS_SECONDS + CORRECTION_CHECK_SECONDS;
const PASS_GAP_SECONDS = 0.5;
// The capture plan: per take the calls of seeds 1-6 at L, 7 at L − 6 and 8-9 at L + 10, then 7 at
// L − 12 once, two sweeps and silence, 0.5 s apart. Each call plays 7 × averaging periods of 1 s
// and 2.5 s more.
const CALLS_PER_TAKE = 9;
const CAPTURE_GAP_SECONDS = 0.5;
const LOUD_STEPS_DB = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
// An overloaded capture records this much more (one call period) so the excess estimate sees
// its loud part, then stops.
const OVERLOAD_TAIL_SECONDS = 1;
const OVERLOAD_BLOCK_SECONDS = 0.02;
// Retry on Noise: a test signal whose recording has more than NOISE_LIMIT_DB more noise than the level
// check plays again, at most MAX_REPLAYS times.
const NOISE_LIMIT_DB = 10;

/**
 * Planned duration in seconds of one channel with run settings `settings` (level check, captures with
 * gaps, analysis and correction check); `fast` (Quick) plays one take of each call instead of two.
 */
export function perChannelSeconds({ averaging, fast = false, sweepLength, rateHz, bandwidth }) {
    const calls = CALLS_PER_TAKE * (fast ? 1 : 2) + 1;
    const sweepSeconds = essPlaybackSeconds({ length: sweepLength, sampleRate: rateHz,
        startFrequency: bandwidth[0], endFrequency: bandwidth[1] });
    return LEVEL_CHECK_SECONDS + calls * (7 * averaging + 2.5) + 3 * sweepSeconds
        + (calls + 2) * CAPTURE_GAP_SECONDS + AFTER_CAPTURES_SECONDS;
}

// Range of the test signals in Hz: the sweeps start at 20 Hz and the multitone lines end below 8 kHz.
const TEST_SIGNAL_RANGE_HZ = [20, 8000];

/** The per-channel run settings whose Sweep Bandwidth cuts into the test signal range. */
export const bandLimitedSettings = settingsList => settingsList.filter(({ bandwidth: [lowHz, highHz] }) =>
    lowHz > TEST_SIGNAL_RANGE_HZ[0] || highHz < TEST_SIGNAL_RANGE_HZ[1]);

/** A failed step of a run or Check again; `kind` is 'playback' or 'analysis'. */
export class SpeakerDistortionStepError extends Error {
    constructor(kind, cause) {
        super(`Speaker distortion ${kind} failed`, { cause });
        this.kind = kind;
    }
}

class OverloadStop extends Error {
    constructor(excessDb) {
        super('Speaker distortion capture overloaded');
        this.excessDb = excessDb;
    }
}

/** The user asked to measure the current channel again. */
class ChannelRestart extends Error {
    constructor() {
        super('Speaker distortion channel restarted');
    }
}

export function isOverloaded(recording) {
    for (let i = 0; i < recording.length; i++) {
        const x = recording[i];
        if (x >= CAPTURE_OVERLOAD_PEAK || x <= -CAPTURE_OVERLOAD_PEAK) return true;
    }
    return false;
}

/**
 * How far, in dB, the clipped `recording` went over full scale, at least. Each clipped 20 ms block is
 * read as a sinusoid A·sin(): the quantile u of |x| below the clipped share is A·sin(uπ/2). The sweeps
 * stay sinusoidal through a speaker and come out close; peakier signals such as the calls come out
 * lower, so the loudest block is a lower bound. The clipping itself proves full scale, so the result is
 * never below 0 dB; that is also the result when every clipped block is almost all clipped.
 */
export function overloadExcessDb(recording, rateHz) {
    const block = Math.round(OVERLOAD_BLOCK_SECONDS * rateHz);
    const sorted = new Float32Array(block);
    let amplitude = 1;
    for (let start = 0; start + block <= recording.length; start += block) {
        for (let i = 0; i < block; i++) {
            const x = recording[start + i];
            sorted[i] = x < 0 ? -x : x;
        }
        sorted.sort();
        let clipped = 0;
        while (clipped < block && sorted[block - 1 - clipped] >= CAPTURE_OVERLOAD_PEAK) clipped++;
        if (clipped === 0 || clipped > 0.95 * block) continue;
        const u = 0.8 * (1 - clipped / block);
        const value = sorted[Math.floor(u * block)] / Math.sin(u * Math.PI / 2);
        if (value > amplitude) amplitude = value;
    }
    return 20 * Math.log10(amplitude);
}

/** How much, in dB, the input must come down so that a peak of `peakDb` dBFS passes the level check. */
export function lowerByDb(peakDb) {
    return peakDb - 20 * Math.log10(speakerDistortion.LEVEL_CHECK_OVERLOAD);
}

/** How much, in dB, the input must come down after an overloaded level check of `recording` judged as `judged`. */
export function levelCheckLowerDb(recording, judged, rateHz) {
    return lowerByDb(isOverloaded(recording) ? overloadExcessDb(recording, rateHz) : -judged.headroomDb);
}

/** Recorder-chunk check that ends a capture OVERLOAD_TAIL_SECONDS after its first overloaded sample. */
function overloadStopper(rateHz) {
    let left = null;
    return chunk => {
        if (left === null) {
            if (isOverloaded(chunk)) left = OVERLOAD_TAIL_SECONDS * rateHz;
        } else {
            left -= chunk.length;
        }
        return left !== null && left <= 0;
    };
}

/** Appends `gapSeconds` of silence to `samples`. */
function withGap(samples, gapSeconds, rateHz) {
    const gap = Math.round(gapSeconds * rateHz);
    if (gap <= 0) return samples;
    const buffer = new Float32Array(samples.length + gap);
    buffer.set(samples);
    return buffer;
}

function peakOf(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i++) {
        const x = samples[i] < 0 ? -samples[i] : samples[i];
        if (x > peak) peak = x;
    }
    return peak;
}

function abortError(signal) {
    return signal.reason instanceof Error ? signal.reason : new DOMException('Cancelled', 'AbortError');
}

/** Resolves with `promise`, or rejects as soon as `signal` aborts. */
function unlessAborted(promise, signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const onAbort = () => reject(abortError(signal));
        signal.addEventListener('abort', onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
}

/**
 * Shared step runner: playback and module calls with abort and failure classification.
 * `play(buffer, settings, stopWhen, signal)` resolves with the recording of `buffer` and stops playing
 * once `signal` aborts; a host that records in chunks may end the capture early once `stopWhen(chunk)`,
 * when given, returns true.
 */
function createSteps({ play, pause, signal }) {
    const guard = async (kind, call) => {
        signal.throwIfAborted();
        try {
            const result = await call();
            signal.throwIfAborted();
            return result;
        } catch (error) {
            if (signal.aborted) throw abortError(signal);
            if (error instanceof SpeakerDistortionStepError || error instanceof OverloadStop) throw error;
            throw new SpeakerDistortionStepError(kind, error);
        }
    };
    return {
        play: (samples, gapSeconds, settings) =>
            guard('playback', () => play(withGap(samples, gapSeconds, settings.rateHz), settings, undefined, signal)),
        playChecked: async (samples, gapSeconds, settings) => {
            const recording = await guard('playback', () =>
                play(withGap(samples, gapSeconds, settings.rateHz), settings, overloadStopper(settings.rateHz), signal));
            if (isOverloaded(recording)) throw new OverloadStop(overloadExcessDb(recording, settings.rateHz));
            return recording;
        },
        module: call => guard('analysis', call),
        pause: async (kind, info) => {
            await unlessAborted(Promise.resolve(pause(kind, info)), signal);
        }
    };
}

/**
 * Runs the speaker distortion measurement for every channel of `settingsList` (ascending index).
 * `first` = {plan, judged}: the capture plan and passed level check of step 2 for the first channel.
 * With `retryOnNoise`, a test signal recorded with too much noise plays again (see playJudged).
 * While a channel plays its test signals or is analysed, `onRestartable(restart)` hands over a function
 * that discards that channel's recordings and starts it again from its first test signal, without a
 * new level check; `onRestartable(null)` withdraws it.
 * Resolves with the new measurement record; rejects with an AbortError on cancel or with
 * SpeakerDistortionStepError on failure. Nothing is kept on rejection.
 */
export async function runSpeakerDistortionMeasurement({ settingsList, placement, averaging, first,
    retryOnNoise = false, play, pause, onStatus = () => {}, onRestartable = () => {}, signal,
    deps = speakerDistortion }) {
    const steps = createSteps({ play, pause, signal });
    const entries = [];
    let levelDbfs = first.plan.levelDbfs;
    for (let channelIndex = 0; channelIndex < settingsList.length; channelIndex++) {
        const settings = settingsList[channelIndex];
        const waitingSeconds = (settingsList.length - channelIndex - 1) * perChannelSeconds(settings);
        let plan = channelIndex === 0 ? first.plan : null;
        let channelSeconds = 0;
        // `left` is the planned time left in this channel and `stepSeconds` the planned length of the
        // step that starts now; `progress` carries both as a share of the channel for the progress bar.
        const status = (row, phase = null, left = 0, stepSeconds = 0, extra = {}) => onStatus({
            channelIndex, row, phase, secondsLeft: left + waitingSeconds,
            progress: phase && { done: channelSeconds - left, total: channelSeconds, stepSeconds },
            ...extra
        });
        console.info('Speaker distortion: channel settings', settings);
        let judged = channelIndex === 0 ? first.judged : null;
        if (placement === 'inFront' && channelIndex > 0) {
            status('waitingForMicrophone');
            await steps.pause('moveMicrophone', { settings });
        }
        if (!plan) {
            plan = await steps.module(() => deps.buildCapturePlan(settings, { signal }));
            levelDbfs = plan.levelDbfs;
        }
        const capturesSeconds = index => plan.captures.slice(index).reduce((sum, capture) =>
            sum + capture.samples.length / settings.rateHz + capture.gapSeconds, 0);
        channelSeconds = LEVEL_CHECK_SECONDS + capturesSeconds(0) + AFTER_CAPTURES_SECONDS;
        for (;;) {
            // How far to lower the input after an overloaded level check.
            let lowerDb = null;
            while (judged?.outcome !== 'passed') {
                if (judged) {
                    status('levelCheckFailed');
                    await steps.pause(judged.outcome === 'overloaded' ? 'levelOverload' : 'levelQuiet',
                        { settings, lowerDb });
                }
                status('checkingLevel', 'checkingLevelOn', channelSeconds, LEVEL_CHECK_SECONDS);
                const recording = await steps.play(plan.levelCheck, 0, settings);
                judged = await steps.module(() => deps.judgeLevelCheck(recording, plan));
                lowerDb = judged.outcome === 'overloaded' ? levelCheckLowerDb(recording, judged, settings.rateHz) : null;
                console.info(`Speaker distortion: ${settings.label} level check ${judged.outcome}, `
                    + `headroom ${judged.headroomDb} dB`);
            }
            const attempt = new AbortController();
            const attemptSignal = AbortSignal.any([signal, attempt.signal]);
            onRestartable(() => attempt.abort(new ChannelRestart()));
            try {
                const entry = await measureChannel({ settings, plan, status, capturesSeconds, deps,
                    steps: createSteps({ play, pause, signal: attemptSignal }), signal: attemptSignal,
                    noise: retryOnNoise ? { reference: judged.noisePower } : null })
                    .finally(() => onRestartable(null));
                entries.push(entry);
                status('done');
                break;
            } catch (error) {
                if (error instanceof ChannelRestart) {
                    console.info(`Speaker distortion: ${settings.label} measured again from its first test signal`);
                    continue;
                }
                if (!(error instanceof OverloadStop)) throw error;
                console.info(`Speaker distortion: ${settings.label} overloaded by at least ${error.excessDb} dB, `
                    + 'restarting the channel');
                status('stopped');
                await steps.pause('captureOverload', { settings, lowerDb: lowerByDb(error.excessDb) });
                judged = null;
            }
        }
    }
    const speakerModel = assembleSpeakerModel({ entries, placement, averaging, levelDbfs,
        measuredAt: Date.now(), deps });
    return createSpeakerDistortionRecord(speakerModel);
}

/**
 * Plays `samples` with the overload check. With `noise` = { reference } (a noise power) and a `call`
 * { seed, K, chirp }, unusable recordings, recordings with noise above the limit and recordings that lost
 * too many periods to recording gaps are retried. If no recording passes, keep the quietest usable one
 * (one that kept its periods first); its noise becomes the reference only when the noise was steady (every
 * usable play within the limit of the quietest), not for a passing disturbance.
 * `show(retrying)` shows the status before each play.
 */
async function playJudged({ samples, gapSeconds, call, noise, settings, steps, show, signal, deps }) {
    show(false);
    if (!noise || !call) return steps.playChecked(samples, gapSeconds, settings);
    const db = power => (10 * Math.log10(power)).toFixed(1);
    const margin = 10 ** (NOISE_LIMIT_DB / 10);
    const limit = noise.reference * margin;
    let best = null;
    let worst = 0;
    let usable = 0;
    for (let play = 0; play <= MAX_REPLAYS; play++) {
        if (play > 0) show(true);
        const recording = await steps.playChecked(samples, gapSeconds, settings);
        try {
            const powers = await steps.module(() => deps.callSignalNoise(recording, call, settings, { signal }));
            const power = powers.noise;
            if (!Number.isFinite(powers.signal) || powers.signal <= 0 || !Number.isFinite(power) || power < 0) {
                throw new SpeakerDistortionStepError('analysis', new Error('The recording has no usable noise estimate.'));
            }
            const lost = powers.periodsLost;
            console.info(`Speaker distortion: ${settings.label} S/N ${db(powers.signal / power)} dB, `
                + `noise ${db(power / noise.reference)} dB over the reference`
                + (lost ? '; too many periods lost to recording gaps' : ''));
            if (!lost && power <= limit) return recording;
            if (!lost) {
                usable++;
                if (power > worst) worst = power;
            }
            if (!best || (best.lost && !lost) || (best.lost === lost && power < best.power)) best = { recording, power, lost };
        } catch (error) {
            signal.throwIfAborted();
            if (play === MAX_REPLAYS && !best) throw error;
            console.warn(`Speaker distortion: ${settings.label} could not judge the recording's noise.`, error);
        }
        if (play < MAX_REPLAYS) console.info(`Speaker distortion: ${settings.label} playing the test signal again`);
    }
    if (usable > 1 && !best.lost && worst <= best.power * margin) {
        noise.reference = best.power;
        console.info(`Speaker distortion: ${settings.label} kept the quietest usable recording; `
            + 'the noise was steady, so its noise is the new reference');
    } else {
        console.info(`Speaker distortion: ${settings.label} kept the quietest usable recording; `
            + 'the noise was not shown to be steady, so the reference is unchanged');
    }
    return best.recording;
}

async function measureChannel({ settings, plan, steps, status, capturesSeconds, signal, noise, deps }) {
    const recordings = [];
    for (let index = 0; index < plan.captures.length; index++) {
        const capture = plan.captures[index];
        const show = retrying => status('testSignalOf', retrying ? 'noiseRetry' : 'playingTestSignal',
            capturesSeconds(index) + AFTER_CAPTURES_SECONDS,
            capture.samples.length / settings.rateHz + capture.gapSeconds,
            { capture: index + 1, captureCount: plan.captures.length });
        recordings.push(await playJudged({ samples: capture.samples, gapSeconds: capture.gapSeconds,
            call: capture.kind === 'call' ? capture : null, noise, settings, steps, show, signal, deps }));
    }
    const analyzing = share => status('analyzing', 'analyzingChannel',
        AFTER_CAPTURES_SECONDS - share * ANALYSIS_SECONDS);
    analyzing(0);
    const started = performance.now();
    let entry = await steps.module(() => deps.identifySpeakerModel({ recordings, plan, settings, signal,
        onProgress: analyzing }));
    console.info(`Speaker distortion: ${settings.label} analysis took ${Math.round(performance.now() - started)} ms`);
    const showCheck = retrying => status('correctionCheck', retrying ? 'noiseRetry' : 'checkingCorrection',
        CORRECTION_CHECK_SECONDS, CORRECTION_CHECK_SECONDS);
    showCheck(false);
    const playCheckCall = async (call, gapSeconds) => {
        const { seed, K } = plan.check;
        let retried = false;
        const recording = await playJudged({ samples: call.samples, gapSeconds,
            call: { seed, K, chirp: call.chirp }, noise, settings, steps, signal, deps,
            show: retrying => {
                if (!retrying) return;
                retried = true;
                showCheck(true);
            } });
        if (retried) showCheck(false);
        return recording;
    };
    // Passes { name, length, odd }: plain, the lengths with even weights, then with a passed odd fit rule
    // each of those lengths with the odd block and the odd block alone.
    const lengths = deps.LENGTHS.filter(length => entry.weights[length]);
    const oddLengths = entry.odd?.weights && entry.odd.fitReason === null ? [...lengths, null] : [];
    const passList = [
        { name: 'plain', length: null, odd: false },
        ...lengths.map(length => ({ name: length, length, odd: false })),
        ...oddLengths.map(length => ({ name: length ? `${length}Odd` : 'alone', length, odd: true }))
    ];
    const calls = [];
    for (const pass of passList) {
        calls.push(await steps.module(() => deps.buildCheckCall(entry, plan, pass.length, 0, pass.odd, 0, { signal })));
    }
    const recordingsByPass = {};
    for (let index = 0; index < calls.length; index++) {
        recordingsByPass[passList[index].name] = await playCheckCall(calls[index],
            index < calls.length - 1 ? PASS_GAP_SECONDS : 0);
    }
    entry = await steps.module(() => deps.applyCorrectionCheck(entry, recordingsByPass,
        { signal, upperLimitHz: settings.upperLimitHz }));
    return playLoudCheck({ entry, plan, dv: 0, steps, signal, upperLimitHz: settings.upperLimitHz, deps, playCheckCall });
}

/**
 * High-volume check when `loudCheckConfig` names a configuration: the largest t of 10…1 dB at
 * which its drive both with and without the odd block peaks at or below 0 dBFS, then that configuration without
 * and with the odd block at L + t and `dv`. Resolves with the entry, odd.loud set.
 */
async function playLoudCheck({ entry, plan, dv, steps, signal, upperLimitHz, deps, playCheckCall }) {
    const c = deps.loudCheckConfig(entry);
    if (!c) return entry;
    const length = c === 'alone' ? null : c;
    for (const t of LOUD_STEPS_DB) {
        const oddCall = await steps.module(() => deps.buildCheckCall(entry, plan, length, dv, true, t, { signal }));
        if (peakOf(oddCall.samples) > 1) continue;
        const referenceCall = await steps.module(() => deps.buildCheckCall(entry, plan, length, dv, false, t, { signal }));
        if (peakOf(referenceCall.samples) > 1) continue;
        console.info(`Speaker distortion: ${entry.label} high-volume check (${c}) at L + ${t} dB`);
        const reference = await playCheckCall(referenceCall, PASS_GAP_SECONDS);
        const odd = await playCheckCall(oddCall, 0);
        return steps.module(() => deps.applyLoudCheck(entry, c, t, { reference, odd }, dv, { signal, upperLimitHz }));
    }
    console.info(`Speaker distortion: ${entry.label} high-volume check (${c}) has no level that fits`);
    return steps.module(() => deps.applyLoudCheck(entry, c, null, null, dv, { signal, upperLimitHz }));
}

/** Builds the speaker model of a finished run. */
export function assembleSpeakerModel({ entries, placement, averaging, levelDbfs, measuredAt,
    deps = speakerDistortion }) {
    const model = {
        revision: Date.now(),
        measuredAt,
        placement,
        averaging,
        levelDbfs,
        peakDbfs: levelDbfs + 10,
        upperLimitHz: deps.UPPER_LIMIT_RANGE_HZ[1],
        bands: [...deps.BAND_EDGES],
        lastCheck: null,
        channels: [...entries].sort((a, b) => a.index - b.index),
        recommendedLength: null
    };
    model.recommendedLength = deps.recommendLength(model);
    return model;
}

/**
 * Saves an unsaved result through `store.addMeasurement`; resolves with the new id.
 * `savedAt` is set here only, so later updates of the stored record keep it.
 */
export function saveSpeakerDistortionRecord(record, { name, untitled, store }) {
    return store.addMeasurement({
        ...record,
        name: name.trim() || untitled,
        timestamp: new Date(record.speakerModel.measuredAt).toISOString(),
        savedAt: Date.now()
    });
}

/** The toast after a save: the effect's setup request means the result is used right away. */
export function savedMessageKey(openedBySetupRequest) {
    return openedBySetupRequest ? 'message:measurementSavedAndUsed' : 'message:measurementSaved';
}

export function createSpeakerDistortionRecord(speakerModel) {
    return {
        name: '',
        timestamp: new Date(speakerModel.measuredAt).toISOString(),
        points: [],
        speakerModel
    };
}

/** dv_c of Check again step 5: the change to apply for an estimate, in dB. */
export function channelVolumeChange(estimate, currentDv) {
    if (!estimate?.accepted) return currentDv;
    const v = estimate.db;
    if (v > -1) return 0;
    const rounded = Math.round(2 * v) / 2;
    return rounded < -24 ? -24 : rounded > 0 ? 0 : rounded;
}

/**
 * The inputs of Check again opened from the card: the channels where the even block plays at the
 * recommended length or the odd block plays or awaits its check with Auto, the odd ones in
 * `oddChannels`, and per channel its configuration (`length`, or `alone` without the even block).
 */
export function checkAgainInputs(model) {
    const length = model.recommendedLength;
    const lastCheck = model.lastCheck;
    const configurationOf = entry => speakerDistortion.oddConfiguration(entry, length);
    const oddChecked = entry => {
        const { plays, reason } = speakerDistortion.oddDecision(entry, configurationOf(entry), 'auto');
        return plays || reason === 'notChecked';
    };
    const checked = model.channels.filter(entry => entry.on[length] || oddChecked(entry));
    return {
        channels: checked.map(entry => entry.index),
        oddChannels: checked.filter(oddChecked).map(entry => entry.index),
        configurations: checked.map(configurationOf),
        length,
        currentDv: lastCheck && lastCheck.outcome !== 'undetermined' ? lastCheck.dv : 0
    };
}

/**
 * Runs Check again on `model` for the output channel indices `channels` at `length`; `configurations`
 * (parallel to `channels`) names what plays on each: `length` with the even block, `alone` without it.
 * The channels in `oddChannels` also play the odd block in that configuration, and the high-volume
 * check when it is due.
 * Resolves with {model, dv, outcome, results}: a copy of the model with the updated entries,
 * `lastCheck` and `recommendedLength` (revision unchanged), and one result per model channel
 * ({index, label, checked, accepted, v, level}) for the result list; `level` is that of what plays.
 */
export async function runCheckAgain({ model, channels, oddChannels = [], configurations = [], length, currentDv,
    play, pause, onStatus = () => {}, signal, deps = speakerDistortion }) {
    const steps = createSteps({ play, pause, signal });
    const checked = model.channels.filter(entry => channels.includes(entry.index));
    const updated = new Map();
    const estimates = new Map();
    const levels = new Map();
    for (const original of checked) {
        let entry = original;
        const evenPass = (configurations[channels.indexOf(entry.index)] ?? length) !== 'alone' &&
            Boolean(entry.weights[length]) && entry.ampRef[length] !== null;
        const oddPass = oddChannels.includes(entry.index) && Boolean(entry.odd?.weights);
        const canEstimate = Boolean(entry.weights[length]) && entry.ampRef[length] !== null;
        const settings = { rateHz: entry.rateHz, label: entry.label, index: entry.index };
        const status = phase => onStatus({ index: entry.index, phase });
        if (model.placement === 'inFront') {
            status('waitingForMicrophone');
            await steps.pause('checkTarget', { entry });
        }
        const checkPlan = await steps.module(() => deps.checkPlanFromModel(entry, { signal }));
        for (;;) {
            status('checkingLevel');
            const levelRecording = await steps.play(checkPlan.levelCheck, 0, settings);
            const judged = await steps.module(() => deps.judgeLevelCheck(levelRecording, checkPlan));
            console.info(`Check again: ${entry.label} level check ${judged.outcome}`);
            if (judged.outcome !== 'passed') {
                await (judged.outcome === 'overloaded'
                    ? steps.pause('checkLevelOverload',
                        { entry, lowerDb: levelCheckLowerDb(levelRecording, judged, settings.rateHz) })
                    : steps.pause('checkLevelQuiet', { entry }));
                continue;
            }
            status('checking');
            try {
                const plain = await steps.playChecked(checkPlan.check.samples,
                    evenPass || oddPass ? PASS_GAP_SECONDS : 0, settings);
                if (!evenPass && !oddPass) break;
                const estimate = canEstimate
                    ? await steps.module(() => deps.estimateAmplifierChange(entry, length, plain, { signal })) : null;
                const dv = canEstimate ? channelVolumeChange(estimate, currentDv) : currentDv;
                const recordings = { plain };
                if (evenPass) {
                    const call = await steps.module(() => deps.buildCheckCall(entry, checkPlan, length, dv, false, 0, { signal }));
                    recordings.corrected = await steps.playChecked(call.samples, oddPass ? PASS_GAP_SECONDS : 0, settings);
                }
                if (oddPass) {
                    const call = await steps.module(() =>
                        deps.buildCheckCall(entry, checkPlan, evenPass ? length : null, dv, true, 0, { signal }));
                    recordings.odd = await steps.playChecked(call.samples, 0, settings);
                }
                entry = await steps.module(() => deps.applyCheckAgain(entry, length, recordings, dv,
                    { signal, upperLimitHz: model.upperLimitHz }));
                if (oddPass) {
                    entry = await playLoudCheck({ entry, plan: checkPlan, dv, steps, signal,
                        playCheckCall: (call, gapSeconds) => steps.playChecked(call.samples, gapSeconds, settings),
                        upperLimitHz: model.upperLimitHz, deps });
                }
                if (estimate) estimates.set(entry.index, estimate);
                const c = evenPass ? length : 'alone';
                levels.set(entry.index, deps.playedCheckFig(entry, evenPass ? length : null,
                    oddPass && Boolean(entry.odd.on[c]))?.level ?? null);
                updated.set(entry.index, entry);
                break;
            } catch (error) {
                if (!(error instanceof OverloadStop)) throw error;
                await steps.pause('checkLevelOverload', { entry, lowerDb: lowerByDb(error.excessDb) });
            }
        }
    }
    const { dv, outcome } = deps.combineAmplifierChange([...estimates.values()], currentDv);
    const next = {
        ...model,
        channels: model.channels.map(entry => updated.get(entry.index) ?? entry),
        lastCheck: { at: Date.now(), outcome, dv }
    };
    next.recommendedLength = deps.recommendLength(next);
    const results = model.channels.map(entry => {
        const estimate = estimates.get(entry.index);
        return {
            index: entry.index,
            label: entry.label,
            checked: channels.includes(entry.index),
            accepted: Boolean(estimate?.accepted),
            v: estimate?.accepted ? estimate.db : null,
            level: levels.get(entry.index) ?? null
        };
    });
    return { model: next, dv, outcome, length, results };
}
