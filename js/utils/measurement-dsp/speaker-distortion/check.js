// Correction check, Check again and the recommended Filter Length of the speaker distortion
// correction, with the odd block's measured checks.
import { LENGTHS, LEVEL_CHECK_K, N_BANDS, ODD_CONFIGS } from './constants.js';
import {
    AMP_MIN_Z, amplifierReferences, estimateAmplifier, evaluateOddChecks, evaluateRule, levelCheckOf, oddActiveClasses,
    oddClassBins, oddMeasuredReason, referenceSums, storedRuleInput, withExecutor
} from './identify.js';
import { activeClasses, aboveLimit, binSets, oddSets } from './preprocess.js';
import { MAX_BIN, combLines } from './signals.js';

const CHECK_SEED = 10;
const CHECK_K = 7;
const MAX_ACCEPTED_DB = 20;

const power = (Y, f) => Y[2 * f] * Y[2 * f] + Y[2 * f + 1] * Y[2 * f + 1];
const positive = value => (value > 0 ? value : 0);
const db = (num, den) => (den > 0 && num >= 0 && Number.isFinite(num / den) ? 10 * Math.log10(num / den) : null);

const storedLevel = channel => channel.calls[0].peakDbfs;
const driveOf = (channel, seed) => channel.drives.find(drive => drive.seed === seed).X;
const lengthIndex = key => LENGTHS.indexOf(key);

// Replays a stored drive as a call at the stored L (factor 1).
function storedCall(executor, channel, seed, targetDbfs, K) {
    return executor.run('call', {
        seed, X: driveOf(channel, seed), targetDbfs, K, fsDev: channel.rateHz, bandwidth: channel.bandwidth
    });
}

// Y and Pn of correction-check recordings played at L + t; the chirp depends only on that level, the
// bandwidth and the rate.
async function analyzeChecks(executor, channel, recordings, t = 0) {
    const { chirp } = await storedCall(executor, channel, CHECK_SEED, storedLevel(channel) + t, 1);
    return Promise.all(recordings.map(capture => executor.run('analyze', {
        capture, fsDev: channel.rateHz, K: CHECK_K, chirp
    })));
}

const floored = (record, bins) => {
    let sum = 0;
    for (const f of bins) sum += positive(power(record.Y, f) - record.Pn[f]);
    return sum;
};

/** Measured figures of a corrected record q against the plain record p (both with `excited`). */
export function checkFigures(plain, corrected, bins, active, dv) {
    const classes = bins.score.map((classBins, c) =>
        (active[c] && aboveLimit([plain], classBins) ? [floored(corrected, classBins), floored(plain, classBins)] : null));
    const used = classes.filter(pair => pair);
    const evenAll = used.length
        ? db(used.reduce((sum, pair) => sum + pair[0], 0), used.reduce((sum, pair) => sum + pair[1], 0)) : null;
    const odd8k = oddSets(plain.excited).odd8k;
    const excitedSum = record => {
        let sum = 0;
        for (let f = 50; f <= MAX_BIN; f++) if (record.excited[f]) sum += power(record.Y, f);
        return sum;
    };
    const Op = floored(plain, odd8k), Oq = floored(corrected, odd8k);
    const Ep = floored(plain, bins.even8k), Eq = floored(corrected, bins.even8k);
    const Xp = excitedSum(plain), Xq = excitedSum(corrected);
    const ref = referenceSums([corrected], bins);
    const bandSums = new Float32Array(3 * N_BANDS);
    bins.bands.forEach((band, i) => {
        let sum = 0;
        for (const f of band) sum += power(corrected.Y, f) - corrected.Pn[f];
        bandSums[i] = sum;
    });
    bandSums.set(ref.subarray(0, N_BANDS), N_BANDS);
    bandSums.set(ref.subarray(102, 102 + N_BANDS), 2 * N_BANDS);
    return {
        dv,
        fig: [
            ...classes.map(pair => (pair ? db(pair[0], pair[1]) : null)),
            evenAll,
            db(Oq + Eq, Op + Ep),
            db(Eq, Ep)
        ],
        level: [db(Op + Ep, Xp), db(Oq + Eq, Xq), db(Ep, Xp), db(Eq, Xq)],
        bandSums
    };
}

// Bins and active classes of a stored channel at the model's Upper Limit, with the odd classes of the
// check drive and those active at L.
function checkContext(channel, upperLimitHz) {
    const bins = binSets(upperLimitHz);
    const aRecords = channel.calls.filter(call => call.group === 'a');
    const excited = combLines(CHECK_SEED, channel.bandwidth).excited;
    return {
        bins,
        active: activeClasses(aRecords, bins),
        excited,
        oddBins: oddClassBins(excited),
        activeOdd: oddActiveClasses(aRecords.map(call => ({ ...call, excited: combLines(call.seed, channel.bandwidth).excited })))
    };
}

// Odd figures [o1, o2, o3, oddAll] and total of a pass q against its reference r.
function oddVersus(reference, corrected, { bins, active, oddBins, activeOdd }) {
    const classes = oddBins.map((classBins, c) =>
        (activeOdd[c] && aboveLimit([reference], classBins) ? [floored(corrected, classBins), floored(reference, classBins)] : null));
    const used = classes.filter(pair => pair);
    const oddAll = used.length
        ? db(used.reduce((sum, pair) => sum + pair[0], 0), used.reduce((sum, pair) => sum + pair[1], 0)) : null;
    return {
        odd: [...classes.map(pair => (pair ? db(pair[0], pair[1]) : null)), oddAll],
        total: checkFigures(reference, corrected, bins, active, 0).fig[4]
    };
}

// odd.checkFig[c] of the pass q with the odd block, against its reference r and the plain pass p.
function oddCheckFig(plain, reference, corrected, context, dv) {
    const { fig, level, bandSums } = checkFigures(plain, corrected, context.bins, context.active, dv);
    return { dv, ...oddVersus(reference, corrected, context), vsPlain: { fig, level, bandSums } };
}

// Channel entry with a copy of its odd block changed by `update`, then its measured checks evaluated.
function withOdd(channel, update) {
    const odd = {
        ...channel.odd, on: { ...channel.odd.on }, reason: { ...channel.odd.reason }, checkFig: { ...channel.odd.checkFig }
    };
    update(odd);
    return { ...channel, odd: evaluateOddChecks(odd) };
}

// Recording key of the odd pass of each configuration in the correction check.
const ODD_RECORDINGS = { short: 'shortOdd', long: 'longOdd', alone: 'alone' };

function withRule(channel, key, checkFig) {
    const { on, reason, worst } = evaluateRule(storedRuleInput(channel, key), checkFig);
    return {
        ...channel,
        checkFig: { ...channel.checkFig, [key]: checkFig },
        on: { ...channel.on, [key]: on },
        reason: { ...channel.reason, [key]: reason },
        worst: { ...channel.worst, [key]: worst }
    };
}

/**
 * The correction-check call at L + t: the even weights of `length` (null: none) and, when `odd`, the odd
 * block, corrected at s = 10^(dv/20); the stored plain call when nothing corrects at L.
 */
export function buildCheckCall(channel, plan, length, dv = 0, odd = false, t = 0, { signal = null } = {}) {
    if (length === null && !odd && t === 0) return Promise.resolve(plan.check);
    const gain = 10 ** (t / 20);
    return withExecutor(signal, executor => executor.run('correct', {
        X: driveOf(channel, CHECK_SEED).map(value => value * gain),
        excited: combLines(CHECK_SEED, channel.bandwidth).excited,
        weights: length ? channel.weights[length] : null,
        length: length ? lengthIndex(length) : 0,
        scale: 10 ** (dv / 20),
        odd: odd ? { weights: channel.odd.weights, bounds: channel.odd.bounds } : null,
        targetDbfs: plan.levelDbfs + t,
        K: CHECK_K,
        fsDev: channel.rateHz,
        bandwidth: channel.bandwidth
    }));
}

/** Level check and plain correction-check call rebuilt from a stored channel at the stored L. */
export function checkPlanFromModel(channel, { signal = null } = {}) {
    const L = storedLevel(channel);
    return withExecutor(signal, async executor => {
        const [first, loud, check] = await Promise.all([
            storedCall(executor, channel, 1, L, LEVEL_CHECK_K),
            storedCall(executor, channel, 8, L + 10, LEVEL_CHECK_K),
            storedCall(executor, channel, CHECK_SEED, L, CHECK_K)
        ]);
        return {
            levelDbfs: L,
            ...levelCheckOf(first, loud, { rateHz: channel.rateHz, bandwidth: channel.bandwidth }),
            check: { samples: check.samples, chirp: check.chirp }
        };
    });
}

/**
 * Channel entry with checkCall, ampRef, checkFig (dv 0), on, reason and worst set from the
 * correction-check recordings { plain, short?, long?, shortOdd?, longOdd?, alone? },
 * and odd.checkFig of every odd pass played with its measured checks evaluated. An odd pass of a length is used only
 * with the pass of that length. `upperLimitHz` is the model's Upper Limit.
 */
export function applyCorrectionCheck(channel, recordings, { signal = null, upperLimitHz }) {
    return withExecutor(signal, async executor => {
        const keys = LENGTHS.filter(key => recordings[key] && channel.weights[key]);
        const configs = channel.odd?.weights
            ? ODD_CONFIGS.filter(c => recordings[ODD_RECORDINGS[c]] && (c === 'alone' || keys.includes(c))) : [];
        const context = checkContext(channel, upperLimitHz);
        const [plain, ...records] = (await analyzeChecks(executor, channel, [
            recordings.plain, ...keys.map(key => recordings[key]), ...configs.map(c => recordings[ODD_RECORDINGS[c]])
        ])).map(record => ({ ...record, excited: context.excited }));
        const checkCall = {
            seed: CHECK_SEED, take: 'A', group: 'c', K: CHECK_K, peakDbfs: storedLevel(channel), Y: plain.Y, Pn: plain.Pn
        };
        const ampRef = await amplifierReferences(executor, { ...channel, checkCall });
        let result = { ...channel, checkCall, ampRef, checkFig: { short: null, long: null } };
        keys.forEach((key, i) => {
            result = withRule(result, key, checkFigures(plain, records[i], context.bins, context.active, 0));
        });
        if (!channel.odd) return result;
        return withOdd(result, odd => {
            for (const c of ODD_CONFIGS) odd.checkFig[c] = null;
            configs.forEach((c, i) => {
                const reference = c === 'alone' ? plain : records[keys.indexOf(c)];
                odd.checkFig[c] = oddCheckFig(plain, reference, records[keys.length + i], context, 0);
            });
        });
    });
}

/** Amplifier change estimate of a Check again plain recording: { a, se, z, db, accepted }. */
export function estimateAmplifierChange(channel, length, recording, { signal = null } = {}) {
    return withExecutor(signal, async executor => {
        const none = { a: null, se: null, z: null, db: null, accepted: false };
        if (!channel.weights[length]) return none;
        const [record] = await analyzeChecks(executor, channel, [recording]);
        const estimate = await estimateAmplifier(executor, {
            record,
            X: driveOf(channel, CHECK_SEED),
            excited: combLines(CHECK_SEED, channel.bandwidth).excited,
            weights: channel.weights[length],
            length: lengthIndex(length)
        });
        if (!estimate) return none;
        const ampRef = channel.ampRef[length];
        const V = ampRef !== null && estimate.a > 0 && ampRef > 0 ? 20 * Math.log10(estimate.a / ampRef) : null;
        const accepted = V !== null && estimate.z >= AMP_MIN_Z && (V < 0 ? -V : V) <= MAX_ACCEPTED_DB;
        return { ...estimate, db: V, accepted };
    });
}

/** dv and outcome of Check again from the per-channel estimates. */
export function combineAmplifierChange(estimates, currentDv) {
    const accepted = estimates.filter(estimate => estimate?.accepted);
    if (accepted.some(estimate => estimate.db > 1)) return { dv: 0, outcome: 'louder' };
    if (!accepted.length) return { dv: currentDv, outcome: 'undetermined' };
    const mean = accepted.reduce((sum, estimate) => sum + estimate.db, 0) / accepted.length;
    if (mean > -1) return { dv: 0, outcome: 'same' };
    const dv = Math.round(2 * mean) / 2;
    return { dv: dv < -24 ? -24 : dv > 0 ? 0 : dv, outcome: 'lower' };
}

/**
 * Channel entry from the Check again recordings { plain, corrected?, odd? } played at `dv`: with
 * `corrected`, checkFig[length] is replaced and the rule of that length evaluated again; with `odd` (the odd
 * block in configuration c = `length` when `corrected` exists, else `alone`), odd.checkFig[c] is replaced
 * against that pass and its measured checks evaluated again.
 */
export function applyCheckAgain(channel, length, recordings, dv, { signal = null, upperLimitHz }) {
    return withExecutor(signal, async executor => {
        const context = checkContext(channel, upperLimitHz);
        const names = ['plain', 'corrected', 'odd'].filter(name => recordings[name]);
        const analyzed = await analyzeChecks(executor, channel, names.map(name => recordings[name]));
        const { plain, corrected, odd } = Object.fromEntries(names.map((name, i) =>
            [name, { ...analyzed[i], excited: context.excited }]));
        const result = corrected
            ? withRule(channel, length, checkFigures(plain, corrected, context.bins, context.active, dv)) : channel;
        if (!odd) return result;
        return withOdd(result, entry => {
            entry.checkFig[corrected ? length : 'alone'] = oddCheckFig(plain, corrected ?? plain, odd, context, dv);
        });
    });
}

/**
 * Configuration the high-volume check plays: the first of `short`, `long`, `alone` that passes
 * tests 1-3; null when `odd.loud` exists, the fit rule failed or none passes.
 */
export function loudCheckConfig(channel) {
    const odd = channel.odd;
    if (!odd?.weights || odd.fitReason || odd.loud) return null;
    return ODD_CONFIGS.find(c => oddMeasuredReason(odd, c) === null) ?? null;
}

/**
 * Channel entry with odd.loud set from the high-volume recordings { reference, odd } of configuration c played
 * at L + t and `dv`, or { dv, t: null } when `recordings` is null (no level fits), and every
 * configuration evaluated again.
 */
export function applyLoudCheck(channel, c, t, recordings, dv, { signal = null, upperLimitHz }) {
    if (!recordings) return Promise.resolve(withOdd(channel, odd => { odd.loud = { dv, t: null }; }));
    return withExecutor(signal, async executor => {
        const context = checkContext(channel, upperLimitHz);
        const [reference, corrected] = (await analyzeChecks(executor, channel, [recordings.reference, recordings.odd], t))
            .map(record => ({ ...record, excited: context.excited }));
        const { odd, total } = oddVersus(reference, corrected, context);
        return withOdd(channel, entry => { entry.loud = { dv, t, odd, total }; });
    });
}

/** Configuration c that plays at `length` with the odd switch on Auto: `length` with the even block, else `alone`. */
export const oddConfiguration = (entry, length) => (entry.on[length] ? length : 'alone');

/**
 * Whether the odd block of `channel` plays in configuration `c` ('short', 'long' or 'alone') with the switch
 * `mode` ('auto', 'on' or 'off'), and why not: { plays, reason }. `reason` is null when it plays, 'off' when
 * switched off, the fit reason when the fit rule failed (or no odd fit exists), else the measured reason of c.
 */
export function oddDecision(channel, c, mode) {
    const odd = channel.odd;
    if (!odd?.weights) return { plays: false, reason: odd?.fitReason ?? 'noFit' };
    if (mode === 'off') return { plays: false, reason: 'off' };
    if (mode === 'on') return { plays: true, reason: null };
    if (odd.fitReason) return { plays: false, reason: odd.fitReason };
    return odd.on[c] ? { plays: true, reason: null } : { plays: false, reason: odd.reason[c] ?? 'notChecked' };
}

/**
 * Measured figures of what plays on `channel` at Filter Length `length` ('short', 'long' or null when the even
 * block does not play): the odd pass against plain ({ dv, fig, level, bandSums }) when `oddPlays`, otherwise the
 * stored even check of `length`; null when not measured.
 */
export function playedCheckFig(channel, length, oddPlays) {
    if (!oddPlays) return length ? channel.checkFig[length] ?? null : null;
    const fig = channel.odd?.checkFig[length ?? 'alone'];
    return fig ? { dv: fig.dv, ...fig.vsPlain } : null;
}

/** Recommended Filter Length; a channel counts what plays at each length with the odd switch on Auto. */
export function recommendLength(model) {
    const mean = key => model.channels.reduce((sum, channel) => {
        const even = channel.on[key];
        const oddPlays = oddDecision(channel, even ? key : 'alone', 'auto').plays;
        const played = playedCheckFig(channel, even ? key : null, oddPlays);
        const value = played ? played.fig[5] : even ? channel.figL[key][1]?.[5] ?? null : null;
        return sum + ((even || oddPlays) && value !== null ? -value : 0);
    }, 0) / model.channels.length;
    return mean('long') >= mean('short') + 1 ? 'long' : 'short';
}
