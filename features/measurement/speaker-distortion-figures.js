// Figures and number formatting of a speaker distortion model, shared by the
// measurement screen, the Distortion Diagnosis tab and the plugin. Pure
// functions: no DOM and no store.
import {
    CLASSES,
    POWER_CLASS_BASE,
    REF_ODD,
    REF_SET,
    REF_X,
    SCALE_MEASURED
} from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';

const MINUS = '−';
// power entry of the even 50 Hz-8 kHz set, used by total and even8k
const POWER_EVEN_SET = POWER_CLASS_BASE + 4;

function ratioDb(numerator, denominator) {
    const value = 10 * Math.log10(numerator / denominator);
    return Number.isFinite(value) ? value : null;
}

function oneDecimal(value) {
    const text = value.toFixed(1);
    return text === '-0.0' ? '0.0' : text.replace('-', MINUS);
}

// Signed with `decimals` digits; a value that rounds to zero is unsigned.
function signedDb(value, decimals = 1) {
    const magnitude = (value < 0 ? -value : value).toFixed(decimals);
    const half = 0.5 * 10 ** -decimals;
    if (value > half) return `+${magnitude}`;
    if (value < -half) return `${MINUS}${magnitude}`;
    return magnitude;
}

export function hasFit(entry, length) {
    return entry.weights[length] != null;
}

/** Change of a class in dB for record set `set` at scale index `scale`, or null. */
export function classFigure(entry, length, set, classKey, scale) {
    const k = CLASSES.findIndex(item => item.key === classKey);
    if (set === 'L') {
        const value = entry.figL[length]?.[scale]?.[k];
        return Number.isFinite(value) ? value : null;
    }
    const powers = entry.power[length][set];
    if (!powers[scale]) return null;
    const index = k < 4 ? POWER_CLASS_BASE + k : POWER_EVEN_SET;
    const odd = classKey === 'total' ? entry.ref[set][REF_ODD + REF_SET] : 0;
    return ratioDb(odd + powers[scale][index], odd + powers[SCALE_MEASURED][index]);
}

/** Total and even-order levels over 50 Hz-8 kHz in dB relative to the test signal. */
export function levelFigure(entry, length, set, scale) {
    const powers = entry.power[length][set][scale];
    if (!powers) return { total: null, even: null };
    const ref = entry.ref[set];
    const even = powers[POWER_EVEN_SET];
    const x = ref[REF_X + REF_SET];
    return { total: ratioDb(ref[REF_ODD + REF_SET] + even, x), even: ratioDb(even, x) };
}

/** Total distortion change in dB if all even-order distortion were removed. */
export function bestPossibleTotal(totalBefore, evenBefore) {
    if (totalBefore === null || evenBefore === null) return null;
    const value = 10 * Math.log10(1 - 10 ** ((evenBefore - totalBefore) / 10));
    return Number.isFinite(value) ? value : null;
}

export function formatLevel(db, template) {
    const percent = 100 * 10 ** (db / 20);
    const decimals = percent >= 1 ? 1 : percent >= 0.1 ? 2 : 3;
    return template.replace('{db}', oneDecimal(db)).replace('{pct}', percent.toFixed(decimals));
}

export function formatDb(value, nullText, decimals = 1) {
    return value === null ? nullText : `${signedDb(value, decimals)} dB`;
}

export function formatDbRange(a, b, template, nullText) {
    if (a === null || b === null) return nullText;
    const [low, high] = a <= b ? [a, b] : [b, a];
    return template.replace('{a}', signedDb(low)).replace('{b}', signedDb(high));
}

export function formatDbfs(value) {
    return oneDecimal(value);
}

// Distortion Averaging choice that plays one take of each call (stored as this string).
export const QUICK_AVERAGING = 'quick';

/** True for a channel measured with Quick: without a second take of its calls. */
export const isQuickEntry = entry => !entry.calls.some(call => call.take === 'B');

/** Distortion Averaging as shown: "Quick" (a GUI term, English in every language) or "×n". */
export function averagingText(choice) {
    return choice === QUICK_AVERAGING ? 'Quick' : `×${choice}`;
}

/** Distortion Averaging of a speaker model as shown. */
export function modelAveragingText(model) {
    return averagingText(isQuickEntry(model.channels[0]) ? QUICK_AVERAGING : model.averaging);
}

export function nullFigureText(classKey, upperLimitHz, text) {
    const range = CLASSES.find(item => item.key === classKey);
    return range.lo >= upperLimitHz ? text.aboveLimit : text.tooSmall;
}

export function formatMeasuredAt(ms, language) {
    return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
}

/** "{name} — {date time}" for a saved record, "{date time}" for an unsaved one. */
export function measurementTitle(record, language, untitledText) {
    const when = formatMeasuredAt(record.speakerModel.measuredAt, language);
    if (!Number.isFinite(record.savedAt)) return when;
    return `${record.name?.trim() ? record.name : untitledText} — ${when}`;
}

export function formatDuration(seconds, text) {
    const minutes = seconds / 60;
    return minutes < 1.5 ? text.minute : text.minutes.replace('{n}', String(Math.round(minutes)));
}
