import {
    CLASSES,
    LENGTHS,
    N_BANDS,
    ODD_CLASSES,
    ODD_CONFIGS,
    ODD_STATES,
    POWER_LENGTH,
    REF_LENGTH,
    SCALES,
    SETS,
    SWEEP_FREQUENCIES,
    UPPER_LIMIT_RANGE_HZ
} from './constants.js';

export * from './constants.js';
export { buildCapturePlan, callSignalNoise, identifySpeakerModel, judgeLevelCheck, refitSpeakerModel } from './identify.js';
export {
    applyCheckAgain, applyCorrectionCheck, applyLoudCheck, buildCheckCall, checkPlanFromModel, combineAmplifierChange,
    estimateAmplifierChange, loudCheckConfig, oddConfiguration, oddDecision, playedCheckFig, recommendLength
} from './check.js';
export { isMeasurableBand } from './signals.js';
export { sweepH2View, sweepH3View, sweepKappa, sweepStaticView, sweepWorstRise } from './sweep.js';

const DRIVE_COUNT = 10;
const SPECTRUM_LENGTH = 16002;
const NOISE_LENGTH = 8001;
const WEIGHT_COUNT = 1182;
const BAND_SUMS_LENGTH = 3 * N_BANDS;
const MAX_CHANNEL_INDEX = 15;
const PLACEMENTS = ['inFront', 'listeningPosition'];
const AVERAGING = [1, 2, 4, 8];
const CHECK_OUTCOMES = ['same', 'lower', 'louder', 'undetermined'];
const REASONS = ['belowLimit', 'noFit', 'littleGain', 'worseInCheck', 'worseAtLowerVolume', 'worseAtLoudPeaks'];
const ODD_FIT_REASONS = [...REASONS, 'worseForSingleTones'];
const ODD_REASONS = [...ODD_FIT_REASONS, 'notChecked', 'worseOverall', 'worseWhenLoud'];
const LENGTH_REASONS = [...REASONS, 'worseForSingleTones'];
const SWEEP_COUNT = SWEEP_FREQUENCIES.length;
const CLASS_KEYS = CLASSES.map(entry => entry.key);
const HUM50_LENGTH = 20;
const HUM60_LENGTH = 16;
const ESS_ORDERS = 10;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isNumber = Number.isFinite;
const isNumberOrNull = value => value === null || Number.isFinite(value);
const isString = value => typeof value === 'string';
const isBoolean = value => typeof value === 'boolean';
const isF32 = length => value => value instanceof Float32Array && value.length === length;
const isU16 = length => value => value instanceof Uint16Array && value.length === length;
const isArrayOf = (length, test) => value =>
    Array.isArray(value) && value.length === length && value.every(test);
const isNullOr = test => value => value === null || test(value);
const isPerLength = test => value => isObject(value) && LENGTHS.every(length => test(value[length], length));
const isPerSet = test => value => isObject(value) && SETS.every(set => test(value[set]));

function isCall(call) {
    return isObject(call) && Number.isSafeInteger(call.seed) && ['A', 'B'].includes(call.take) &&
        ['a', 'd', 'e', 'f'].includes(call.group) && isCallData(call);
}

// The calls of a standard (19) or fast (10) capture plan.
const isCalls = calls => Array.isArray(calls) && calls.length > 0 && calls.every(isCall);

function isCheckCall(call) {
    return isObject(call) && Number.isSafeInteger(call.seed) && call.take === 'A' && call.group === 'c' &&
        call.K === 7 && isCallData(call);
}

function isCallData(call) {
    return isNumber(call.peakDbfs) && Number.isSafeInteger(call.K) && call.K > 0 &&
        isF32(SPECTRUM_LENGTH)(call.Y) && isF32(NOISE_LENGTH)(call.Pn);
}

const isDrive = drive => isObject(drive) && Number.isSafeInteger(drive.seed) && isF32(SPECTRUM_LENGTH)(drive.X);

// Measured figures without dv: { fig, level, bandSums }.
const isFigures = fig => isObject(fig) && isArrayOf(CLASSES.length, isNumberOrNull)(fig.fig) &&
    isArrayOf(4, isNumberOrNull)(fig.level) && isF32(BAND_SUMS_LENGTH)(fig.bandSums);
const isCheckFig = isNullOr(fig => isFigures(fig) && isNumber(fig.dv));

const isWorst = isNullOr(worst => isObject(worst) && (SETS.includes(worst.set) || worst.set === 'sweep') &&
    CLASS_KEYS.includes(worst.class));

const isPerConfig = test => value => isObject(value) && ODD_CONFIGS.every(c => test(value[c]));
const isOddFigures = isArrayOf(ODD_CLASSES.length, isNumberOrNull);
const isOddCheckFig = isNullOr(fig => isObject(fig) && isNumber(fig.dv) && isOddFigures(fig.odd) &&
    isNumberOrNull(fig.total) && isFigures(fig.vsPlain));
// High-volume check: t null when no level fitted, then without figures.
const isLoud = isNullOr(loud => isObject(loud) && isNumber(loud.dv) &&
    (loud.t === null || (isNumber(loud.t) && isOddFigures(loud.odd) && isNumberOrNull(loud.total))));

// Odd block: weights and bounds are both present or both null.
const isOdd = odd => isObject(odd) &&
    (odd.weights === null ? odd.bounds === null : isF32(ODD_STATES)(odd.weights) && isF32(ODD_STATES)(odd.bounds)) &&
    isNumberOrNull(odd.lambda) && isObject(odd.figL) && ODD_CLASSES.every(({ key }) => isNumberOrNull(odd.figL[key])) &&
    isNumberOrNull(odd.figL6) && isNullOr(reason => ODD_FIT_REASONS.includes(reason))(odd.fitReason) &&
    isNullOr(worst => isObject(worst) && ['L', 'L-6'].includes(worst.set) &&
        ODD_CLASSES.some(({ key }) => key === worst.class))(odd.worst) &&
    isPerConfig(isBoolean)(odd.on) && isPerConfig(isNullOr(reason => ODD_REASONS.includes(reason)))(odd.reason) &&
    isPerConfig(isOddCheckFig)(odd.checkFig) && isLoud(odd.loud) && isNullOr(isF32(2 * SWEEP_COUNT))(odd.sweepResponse);

// A length with a fit stores every scale; a length without one only the measured scale.
const scaleCount = (channel, length) => (channel.weights[length] ? SCALES.length : 1);

const isOrderSums = sums => isObject(sums) && isArrayOf(ESS_ORDERS, isF32(N_BANDS))(sums.h) &&
    isArrayOf(ESS_ORDERS - 1, isF32(N_BANDS))(sums.h1) && isArrayOf(ESS_ORDERS - 1, isF32(N_BANDS))(sums.z);

const isDiagnosis = isNullOr(diagnosis => isObject(diagnosis) && isU16(N_BANDS)(diagnosis.nx) &&
    isPerSet(set => isObject(set) && ['ev', 'evPn', 'odPn', 'noise'].every(key => isF32(N_BANDS)(set[key])))(
        diagnosis.sets) &&
    isF32(N_BANDS)(diagnosis.silence) && isF32(HUM50_LENGTH)(diagnosis.hum50) &&
    isF32(HUM60_LENGTH)(diagnosis.hum60) && isObject(diagnosis.ess) && isOrderSums(diagnosis.ess.essL) &&
    isOrderSums(diagnosis.ess.ess6) && isU16(N_BANDS)(diagnosis.ess.pts));

const isSweep = isNullOr(sweep => isObject(sweep) && isNumber(sweep.levelDbfs) &&
    ['teRe', 'teIm', 'noise', 'gRatio', 't3Re', 't3Im', 'noise3', 'gRatio3'].every(key => isF32(SWEEP_COUNT)(sweep[key])));

function isChannel(channel) {
    if (!isObject(channel) || !Number.isSafeInteger(channel.index) || channel.index < 0 ||
        channel.index > MAX_CHANNEL_INDEX || !isString(channel.label) || !isNumber(channel.rateHz) ||
        channel.rateHz <= 0 || !isArrayOf(2, isNumber)(channel.bandwidth) ||
        !isString(channel.inputDeviceId) || !isString(channel.inputDeviceLabel) ||
        !isCalls(channel.calls) || !isArrayOf(DRIVE_COUNT, isDrive)(channel.drives) ||
        !isNullOr(isCheckCall)(channel.checkCall) || !isPerLength(isNumberOrNull)(channel.ampRef) ||
        !isPerLength(isCheckFig)(channel.checkFig) || !isPerLength(isNullOr(isF32(WEIGHT_COUNT)))(channel.weights) ||
        !isPerLength(isBoolean)(channel.on) || !isPerLength(isNullOr(reason => LENGTH_REASONS.includes(reason)))(channel.reason) ||
        !isPerLength(isWorst)(channel.worst) || !isPerSet(isF32(REF_LENGTH))(channel.ref) ||
        !isBoolean(channel.micDistortionWarning) || !isDiagnosis(channel.diagnosis) || !isSweep(channel.sweep) ||
        !isPerLength(isNullOr(isF32(2 * SWEEP_COUNT)))(channel.sweepResponse) ||
        (channel.odd !== undefined && !isOdd(channel.odd))) {
        return false;
    }
    const report = channel.report;
    return isPerLength((power, length) =>
        isPerSet(isArrayOf(scaleCount(channel, length), isF32(POWER_LENGTH)))(power))(channel.power) &&
        isPerLength((figures, length) =>
            isArrayOf(scaleCount(channel, length), isArrayOf(CLASSES.length, isNumberOrNull))(figures))(channel.figL) &&
        isObject(report) && ['lambda', 'micWeight', 'micShare', 'worst'].every(key =>
            isPerLength(isNumberOrNull)(report[key])) &&
        isArrayOf(3, isNumberOrNull)(report.ceiling);
}

const isLastCheck = isNullOr(check => isObject(check) && isNumber(check.at) &&
    CHECK_OUTCOMES.includes(check.outcome) && isNumber(check.dv));

/** True when `model` has the stored speakerModel layout. */
export function validateSpeakerModel(model) {
    return isObject(model) && isNumber(model.revision) && isNumber(model.measuredAt) &&
        PLACEMENTS.includes(model.placement) && AVERAGING.includes(model.averaging) &&
        isNumber(model.levelDbfs) && isNumber(model.peakDbfs) && isNumber(model.upperLimitHz) &&
        model.upperLimitHz >= UPPER_LIMIT_RANGE_HZ[0] && model.upperLimitHz <= UPPER_LIMIT_RANGE_HZ[1] &&
        isArrayOf(N_BANDS + 1, isNumber)(model.bands) && LENGTHS.includes(model.recommendedLength) &&
        isLastCheck(model.lastCheck) && Array.isArray(model.channels) && model.channels.length > 0 &&
        model.channels.every((channel, i) => isChannel(channel) &&
            (i === 0 || channel.index > model.channels[i - 1].index));
}
