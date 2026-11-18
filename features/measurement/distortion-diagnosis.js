// Pure logic of the four diagnosis result tabs: band values of the stored
// diagnosis block, the chart items of charts T, T3, H, A, B, D and S, the cells of chart C,
// the summary table, the reading list, the comparison and the copied text.
// Texts come from the resolver `t(key, params)`; no DOM and no store.
import {
    CLASSES,
    N_BANDS,
    ODD_CLASSES,
    REF_ODD,
    REF_ODD_VAR,
    REF_VAR,
    REF_X,
    SCALE_MEASURED,
    SCALE_REDUCE,
    oddConfiguration,
    oddDecision,
    sweepH2View,
    sweepH3View,
    sweepStaticView
} from '../../js/utils/measurement-dsp/speaker-distortion/index.js';
import { LIMIT_OPACITY, chartBands } from './speaker-distortion-chart.js';
import {
    classFigure,
    formatDb,
    formatDbfs,
    formatLevel,
    formatMeasuredAt,
    hasFit,
    isQuickEntry,
    levelFigure,
    modelAveragingText
} from './speaker-distortion-figures.js';
import { channelDisplayLabel } from './audio-utils/channel-selection.js';
import { RECORDING_GAP_NOTES } from './measurement-model.js';
import { createLinearTicks, finerDecimalStep } from './ui/analysis-axis-ticks.js';

// Number of calls in each record set: the stored sums cover all calls. Quick plays one take of each call.
export const SET_CALLS = Object.freeze({ L: 12, 'L-6': 2, 'L-12': 1, peaks: 4 });
const QUICK_SET_CALLS = Object.freeze({ L: 6, 'L-6': 1, 'L-12': 1, peaks: 2 });
const setCallsOf = entry => (isQuickEntry(entry) ? QUICK_SET_CALLS : SET_CALLS);
export const RESOLUTIONS = Object.freeze(['octave', 'third', 'sixth']);

const LEVEL_SETS = ['L', 'L-6', 'L-12'];
const ROWS = [
    { key: 'label:bandBelow100', lo: 0, hi: 100 },
    { key: 'label:band100to400', lo: 100, hi: 400 },
    { key: 'label:band400to2k', lo: 400, hi: 2000 },
    { key: 'label:band2kto8k', lo: 2000, hi: 8000 }
];
// Upper edge of the odd-order correction (its oddAll class).
const ODD_HI_HZ = ODD_CLASSES[ODD_CLASSES.length - 1].hi;
const COLUMN_KEYS = ['analysis:diagSumColRange', 'analysis:diagSumColL', 'analysis:diagSumColL6',
    'analysis:diagSumColL12', 'analysis:diagSumColChange', 'analysis:diagSumColKind'];
const BAND_PHRASES = {
    c1: 'message:speakerDistortionBandBelow100',
    c2: 'message:speakerDistortionBand100to400',
    c3: 'message:speakerDistortionBand400to2k',
    even8k: 'message:speakerDistortionBand50to8k'
};
const ORDER_TOKENS = { 2: '--sdc-h2', 3: '--sdc-h3', 5: '--sdc-h5' };
const SWEEP_ORDERS = [2, 3, 5];
const EVEN8K = CLASSES.findIndex(item => item.key === 'even8k');
const MAX_RULE_ITEMS = 5;
// Overload: the 1 dB compression point over at least one octave of 200 Hz – 8 kHz.
const OVERLOAD_LO_HZ = 200;
const OVERLOAD_HI_HZ = 8000;
const OVERLOAD_GAIN_DB = -1;
const OVERLOAD_MIN_BANDS = 3;
const NO_VALUE = '—';

const db = (numerator, denominator) => 10 * Math.log10(numerator / denominator);
const finite = value => (Number.isFinite(value) ? value : null);
const signed = value => `${value >= 0.05 ? '+' : ''}${formatDbfs(value)}`;
// Spreadsheet form: "." decimals and an ASCII minus.
const plainNumber = value => {
    const text = value.toFixed(1);
    return text === '-0.0' ? '0.0' : text;
};

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------- formatting

const kHz = f => String(Math.round(f / 100) / 10);

/** "126 Hz" below 1 kHz, else "1.6 kHz" / "8 kHz". */
export function formatHz(f) {
    return f < 1000 ? `${Math.round(f)} Hz` : `${kHz(f)} kHz`;
}

/** "126 – 252 Hz", "2 – 8 kHz" or "504 Hz – 1 kHz". */
export function formatSpan(lo, hi) {
    const loKHz = lo >= 1000;
    if (loKHz !== hi >= 1000) return `${formatHz(lo)} – ${formatHz(hi)}`;
    return loKHz ? `${kHz(lo)} – ${kHz(hi)} kHz` : `${Math.round(lo)} – ${Math.round(hi)} Hz`;
}

export function channelLabel(entry) {
    return channelDisplayLabel(String(entry.index));
}

export function placementText(model, t) {
    return t(model.placement === 'inFront' ? 'label:positionInFront' : 'label:positionListening');
}

// ---------------------------------------------------------------- band values

/**
 * Multitone value of record set `set` over the 1/6-octave `bands` for parity
 * 'even', 'odd' or 'total', or null when the bands have no tone.
 */
function multitone(entry, set, bands, parity) {
    const diagnosis = entry.diagnosis;
    const ref = entry.ref[set];
    const sums = diagnosis.sets[set];
    const calls = setCallsOf(entry)[set];
    let nx = 0, x = 0, ev = 0, evVar = 0, evPn = 0, od = 0, odVar = 0, odPn = 0;
    for (const i of bands) {
        nx += diagnosis.nx[i];
        x += ref[REF_X + i];
        ev += sums.ev[i];
        evVar += ref[REF_VAR + i];
        evPn += sums.evPn[i];
        od += ref[REF_ODD + i];
        odVar += ref[REF_ODD_VAR + i];
        odPn += sums.odPn[i];
    }
    if (nx === 0 || !(x > 0)) return null;
    x /= calls;
    od /= calls;
    evVar /= calls * calls;
    odVar /= calls * calls;
    const even = parity === 'even';
    const odd = parity === 'odd';
    const v = even ? ev : odd ? od : ev + od;
    const variance = even ? evVar : odd ? odVar : evVar + odVar;
    const pn = even ? evPn : odd ? odPn : evPn + odPn;
    const floor = 2 * Math.sqrt(variance);
    const shown = v > floor;
    return {
        shown,
        usable: shown && v >= 4 * pn,
        V: shown ? db(v, x) : null,
        floorDb: finite(db(floor, x)),
        tone: db(x, nx)
    };
}

// Sweep sums of order n (2..10) over `bands`: harmonic h, fundamental h1 and noise z, all over the sweep points
// where the n-th harmonic lies in the analysed range.
function sweepSums(sweep, bands, n) {
    let h = 0, h1 = 0, z = 0;
    for (const i of bands) {
        h += sweep.h[n - 1][i];
        h1 += sweep.h1[n - 2][i];
        z += sweep.z[n - 2][i];
    }
    return { h, h1, z };
}

/**
 * Harmonic ratio of order n (2..10) of one sweep over `bands`, or null without data: R where it exceeds the noise
 * floor Rz, `raw` (dB) also below it.
 */
function sweepRatio(sweep, bands, n) {
    const { h, h1, z } = sweepSums(sweep, bands, n);
    if (!(h1 > 0)) return null;
    const shown = h > z;
    const raw = finite(db(h, h1));
    return { shown, usable: shown && h >= 4 * z, R: shown ? raw : null, raw, Rz: finite(db(z, h1)) };
}

// The ratio a chart draws: R, or every measured ratio (`raw`) when the noise mask is off.
const drawnRatio = (ratio, unmasked) => (unmasked ? ratio?.raw : ratio?.R) ?? null;

/**
 * THD of one sweep over `bands`: the sum of the power ratios h/h1 of orders 2..10 (each over its own sweep
 * points, so an order whose harmonic leaves the analysed range adds nothing there), with the noise ratios z/h1
 * summed the same way as its floor. Null without data; shown when it exceeds its floor, like sweepRatio.
 */
function sweepThd(sweep, bands) {
    let ratio = 0, floor = 0, any = false;
    for (let n = 2; n <= 10; n++) {
        const { h, h1, z } = sweepSums(sweep, bands, n);
        if (!(h1 > 0)) continue;
        ratio += h / h1;
        floor += z / h1;
        any = true;
    }
    if (!any) return null;
    const shown = ratio > floor;
    const raw = finite(db(ratio, 1));
    return { shown, R: shown ? raw : null, raw, Rz: finite(db(floor, 1)) };
}

// Change of order n at 6 dB lower: between ratios at least 6 dB above the noise, or any two with `unmasked`.
function sweepChange(ess, bands, n, unmasked = false) {
    const atL = sweepRatio(ess.essL, bands, n);
    const at6 = sweepRatio(ess.ess6, bands, n);
    if (unmasked) return atL?.raw != null && at6?.raw != null ? at6.raw - atL.raw : null;
    return atL?.usable && at6?.usable ? at6.R - atL.R : null;
}

function gainDifference(ess, bands) {
    let pts = 0, hL = 0, h6 = 0;
    for (const i of bands) {
        pts += ess.pts[i];
        hL += ess.essL.h[0][i];
        h6 += ess.ess6.h[0][i];
    }
    return pts > 0 ? finite(db(hL, h6)) : null;
}

// Number of orders that are at least 10 dB stronger at the set Signal Level than 6 dB lower (rule 4).
function onsetCount(ess, bands) {
    let count = 0;
    for (let n = 2; n <= 10; n++) {
        const atL = sweepRatio(ess.essL, bands, n);
        const at6 = sweepRatio(ess.ess6, bands, n);
        if (!atL?.shown || !at6) continue;
        const upper = at6.shown ? at6.R : at6.Rz;
        if (upper !== null && atL.R - upper >= 10) count++;
    }
    return count;
}

/** Per rule band (1/3 octave) statistics of the rules and of charts A, C and D. */
function ruleBands(model, entry) {
    const display = chartBands(model.bands, 'third');
    const ess = entry.diagnosis.ess;
    const stats = display.groups.map(group => {
        const evenL = multitone(entry, 'L', group, 'even');
        const even6 = multitone(entry, 'L-6', group, 'even');
        const oddL = multitone(entry, 'L', group, 'odd');
        const asymmetryOdd = oddL?.shown ? oddL.V : oddL?.floorDb ?? null;
        return {
            evenChange: evenL?.usable && even6?.usable ? even6.V - evenL.V : null,
            change: Object.fromEntries(SWEEP_ORDERS.map(n => [n, sweepChange(ess, group, n)])),
            gain: gainDifference(ess, group),
            onset: onsetCount(ess, group),
            asymmetry: evenL?.usable && asymmetryOdd !== null ? evenL.V - asymmetryOdd : null
        };
    });
    return { display, stats };
}

// ---------------------------------------------------------------- spans

// Widest span; ties keep the lowest.
const widest = spans => spans.reduce((best, span) =>
    (!best || span.last - span.first > best.last - best.first ? span : best), null);

/** Spans of adjacent bands whose flag is true. */
function flagSpans(flags) {
    const spans = [];
    flags.forEach((flag, k) => {
        if (!flag) return;
        const last = spans[spans.length - 1];
        if (last && last.last === k - 1) last.last = k;
        else spans.push({ first: k, last: k });
    });
    return spans;
}

/**
 * Windowed rule: the widest union of firing three-band windows and the
 * median of `values` over it, or null.
 */
function windowed(values, inScope, condition) {
    const spans = [];
    for (let k = 0; k + 2 < values.length; k++) {
        const window = [k, k + 1, k + 2];
        if (!window.every(j => inScope(j) && values[j] !== null)) continue;
        if (!condition(median(window.map(j => values[j])))) continue;
        const last = spans[spans.length - 1];
        if (last && k <= last.last + 1) last.last = k + 2;
        else spans.push({ first: k, last: k + 2 });
    }
    const span = widest(spans);
    if (!span) return null;
    const inSpan = values.slice(span.first, span.last + 1);
    return { ...span, median: median(inSpan) };
}

const spanText = (display, span) => formatSpan(display.lo[span.first], display.hi[span.last]);

// Widest overload span of the rule band `gains`: { first, last, lo, hi, drop } or null.
function findOverload(display, gains) {
    const flags = gains.map((gain, k) => display.fc[k] >= OVERLOAD_LO_HZ && display.fc[k] <= OVERLOAD_HI_HZ
        && gain !== null && gain <= OVERLOAD_GAIN_DB);
    const span = widest(flagSpans(flags).filter(found => found.last - found.first + 1 >= OVERLOAD_MIN_BANDS));
    if (!span) return null;
    let drop = 0;
    for (let k = span.first; k <= span.last; k++) drop = -gains[k] > drop ? -gains[k] : drop;
    return { ...span, lo: display.lo[span.first], hi: display.hi[span.last], drop };
}

/**
 * Overload span of a channel: the widest run of at least three rule bands
 * (one octave) in 200 Hz – 8 kHz whose gain at the set Signal Level is at least
 * 1 dB lower than at 6 dB lower. Returns { first, last, lo, hi, drop } (lo and
 * hi in Hz, drop the largest gain drop in dB) or null.
 */
export function overloadSpan(model, entry) {
    if (!entry.diagnosis) return null;
    const display = chartBands(model.bands, 'third');
    const ess = entry.diagnosis.ess;
    return findOverload(display, display.groups.map(group => gainDifference(ess, group)));
}

/**
 * Rattle span of a channel (rule 5): the longest run of rule bands whose
 * playback noise at the set Signal Level is at least 6 dB above the silence and
 * at 6 dB lower is not. Returns { lo, hi } in Hz (lo is the rattle start) or null.
 * An overloaded channel has none: its intermodulation noise looks the same.
 */
export function rattleSpan(model, entry) {
    const diagnosis = entry.diagnosis;
    if (!diagnosis || overloadSpan(model, entry)) return null;
    const display = chartBands(model.bands, 'third');
    const flags = display.groups.map(group => {
        let nx = 0, atL = 0, at6 = 0, silence = 0;
        for (const i of group) {
            nx += diagnosis.nx[i];
            atL += diagnosis.sets.L.noise[i];
            at6 += diagnosis.sets['L-6'].noise[i];
            silence += diagnosis.silence[i];
        }
        return nx > 0 && atL >= 4 * silence && at6 < 4 * silence;
    });
    const span = widest(flagSpans(flags));
    return span ? { lo: display.lo[span.first], hi: display.hi[span.last] } : null;
}

// ---------------------------------------------------------------- charts

const LOG_FRAME = { xMin: 20, xMax: 10000 };
const curve = (points, color, width, dash = null) => ({ kind: 'curve', points, color, width, dash });
// `points` (optional) is the series the entry names, for the value readout.
const legend = (text, color, width, dash = null, points = null) => ({ kind: 'legend', text, color, width, dash, points });
const isDrawn = points => points.some(point => point !== null);
const pointAt = (display, k, y) => (y === null ? null : { x: display.fc[k], lo: display.lo[k], hi: display.hi[k], y });

/** Texts of chart E for the shared renderer. */
export function chartETexts(t, comparedName = null) {
    return {
        setNames: {
            L: t('analysis:diagSetL'),
            'L-6': t('analysis:diagSetL6'),
            'L-12': t('analysis:diagSetL12'),
            peaks: t('analysis:diagSetPeaks')
        },
        legendMeasured: t('analysis:diagLegendMeasured'),
        legendPredicted: t('analysis:diagLegendCorrectedPredicted'),
        legendCheck: t('analysis:diagLegendCorrectedMeasured'),
        legendPredictedOther: t('analysis:diagLegendCorrectedOtherPredicted'),
        legendOddMeasured: t('analysis:diagLegendOddMeasured'),
        legendCompared: t('analysis:diagLegendCompared'),
        comparedName,
        legendLimit: t('analysis:diagLegendNoiseFloor'),
        noteOdd: t('analysis:diagNoteOdd'),
        noteAllBelowWith: t('analysis:diagNoteAllBelowWith'),
        noteAllBelow: t('analysis:diagNoteAllBelow'),
        xTitle: t('analysis:diagAxisFrequency'),
        yTitle: t('analysis:diagAxis'),
        upperLimitLabel: t('analysis:diagUpperLimit')
    };
}

/** Filter Length shown first: the recommended one when it has a fit, else the other. */
export function defaultLength(model, entry) {
    const recommended = model.recommendedLength;
    const other = recommended === 'short' ? 'long' : 'short';
    if (hasFit(entry, recommended)) return recommended;
    return hasFit(entry, other) ? other : 'short';
}

/** Spec of chart E without width, texts and compare (the view adds them). */
export function chartESpec(model, entry, { length, parity, resolution }) {
    const fitted = hasFit(entry, length);
    const check = entry.checkFig[length];
    return {
        sets: ['L', 'L-6', 'L-12', 'peaks'],
        emph: 'L',
        scale: fitted ? SCALE_REDUCE : null,
        scaleSets: ['L', 'L-6', 'peaks'],
        check: fitted && check && check.dv === 0 ? check.bandSums : null,
        showOdd: false,
        parity,
        length,
        resolution,
        bands: model.bands,
        channel: entry,
        upperLimitHz: model.upperLimitHz
    };
}

function mainsHarmonics(diagnosis) {
    const strong = values => Array.from(values).filter(excess => excess >= 10).length;
    const count50 = strong(diagnosis.hum50);
    const count60 = strong(diagnosis.hum60);
    if (!count50 && !count60) return null;
    const f0 = count50 > count60 || (count50 === count60 && diagnosis.hum50[0] >= diagnosis.hum60[0]) ? 50 : 60;
    const excess = f0 === 50 ? diagnosis.hum50 : diagnosis.hum60;
    const frequencies = [];
    excess.forEach((value, i) => {
        if (value >= 10) frequencies.push((i + 1) * f0);
    });
    return { f0, frequencies };
}

/** Chart B: frame, items and the card note. */
export function chartB(model, entry, resolution, t) {
    const diagnosis = entry.diagnosis;
    const display = chartBands(model.bands, resolution);
    const ref = entry.ref.L;
    const playback = [];
    const guide = [];
    display.groups.forEach((group, k) => {
        let nx = 0, x = 0, noise = 0, silence = 0;
        for (const i of group) {
            nx += diagnosis.nx[i];
            x += ref[REF_X + i];
            noise += diagnosis.sets.L.noise[i];
            silence += diagnosis.silence[i];
        }
        x /= setCallsOf(entry).L;
        const value = power => (nx > 0 && x > 0 ? finite(db(power, x)) : null);
        playback.push(pointAt(display, k, value(noise)));
        guide.push(pointAt(display, k, value(silence)));
    });
    const items = [curve(playback, '--sdc-l0', 2.4), curve(guide, '--sdc-nf', 1.3, '4 3')];
    const mains = mainsHarmonics(diagnosis);
    for (const f of mains?.frequencies ?? []) {
        items.push({ kind: 'vline', x: f, color: '--sdc-mains', width: 1, dash: '2 3' });
    }
    if (isDrawn(playback)) items.push(legend(t('analysis:diagPlaybackMeasured'), '--sdc-l0', 2.4, null, playback));
    if (isDrawn(guide)) items.push(legend(t('analysis:diagRattleGuide'), '--sdc-nf', 1.3, '4 3', guide));
    if (mains) items.push(legend(t('analysis:diagMains', { f: mains.f0 }), '--sdc-mains', 1, '2 3'));
    if (!isDrawn(playback) && !isDrawn(guide)) items.push({ kind: 'note', text: t('analysis:diagNoDataRange') });
    const rattle = rattleSpan(model, entry);
    return {
        frame: { ...LOG_FRAME, yMin: -60, yMax: -10, yTicks: [-10, -20, -30, -40, -50, -60],
            yTitle: t('analysis:diagAxisReL'), xTitle: t('analysis:diagAxisFrequency') },
        items,
        note: rattle ? t('analysis:diagRattleRise', { range: formatSpan(rattle.lo, rattle.hi) })
            : t(overloadSpan(model, entry) ? 'analysis:diagRattleNotChecked' : 'analysis:diagNoRattle'),
        warning: rattle !== null
    };
}

// Chart H's distortion axis: dB re the fundamental, labelled in percent.
const percentTick = v => `${Number((100 * 10 ** (v / 20)).toPrecision(1))} %`;
const distortionFrame = t => {
    const levelFormat = t('analysis:levelFormat');
    return { ...LOG_FRAME, yMin: -80, yMax: 0, yTicks: [0, -20, -40, -60, -80], yTickLabel: percentTick,
        formatValue: value => formatLevel(value, levelFormat),
        yTitle: t('analysis:diagAxisDistortion'), xTitle: t('analysis:diagAxisFundamental') };
};

/**
 * Chart H: THD and H2, H3, H5 of the set Signal Level sweep against the fundamental, and THD 6 dB lower; above
 * the noise floor only unless `unmasked`.
 */
export function chartH(model, entry, resolution, t, unmasked = false) {
    const ess = entry.diagnosis.ess;
    const display = chartBands(model.bands, resolution);
    const atL = display.groups.map(group => sweepThd(ess.essL, group));
    const thd = atL.map((value, k) => pointAt(display, k, drawnRatio(value, unmasked)));
    const thd6 = display.groups.map((group, k) =>
        pointAt(display, k, drawnRatio(sweepThd(ess.ess6, group), unmasked)));
    const orders = SWEEP_ORDERS.map(n => ({ n, points: display.groups.map((group, k) =>
        pointAt(display, k, drawnRatio(sweepRatio(ess.essL, group, n), unmasked))) }));
    const floor = {
        kind: 'area', color: '--sdc-lim', opacity: LIMIT_OPACITY,
        points: atL.map((value, k) => (value?.Rz == null ? null
            : { x: display.fc[k], lo: display.lo[k], hi: display.hi[k], top: value.Rz, bottom: -Infinity }))
    };
    const items = [floor, curve(thd6, '--sdc-pk', 1.3, '5 4')];
    for (const { n, points } of orders) items.push(curve(points, ORDER_TOKENS[n], 1.6));
    items.push(curve(thd, '--sdc-pk', 2.4));
    items.push(legend(t('analysis:diagLegendThd'), '--sdc-pk', 2.4, null, thd));
    for (const { n, points } of orders) items.push(legend(t(`analysis:diagH${n}`), ORDER_TOKENS[n], 1.6, null, points));
    items.push(legend(t('analysis:diagLegendThd6'), '--sdc-pk', 1.3, '5 4', thd6));
    items.push({ kind: 'legend', text: t('analysis:diagLegendNoiseFloor'), color: '--sdc-lim', opacity: LIMIT_OPACITY,
        square: true, points: floor.points });
    if (![thd, thd6, ...orders.map(({ points }) => points)].some(isDrawn)) {
        items.push({ kind: 'note', text: t('analysis:diagNotEnoughSignal') });
    }
    return {
        frame: distortionFrame(t),
        items,
        note: null,
        warning: false
    };
}

// Expected single-tone lines per Filter Length, dotted like chart E's predicted lines.
const SINGLE_TONE_LENGTHS = [['short', 'analysis:diagShort', '--sdc-l0'], ['long', 'analysis:diagLong', '--sdc-l12']];
// Half the 1/24-octave spacing of the sweep points.
const SWEEP_HALF_STEP = 2 ** (1 / 48);

/**
 * Span { lo, hi } of sweep point k: halfway (geometric mean) to its neighbours, so neighbouring points share an
 * edge although the rounded frequencies are not evenly spaced; the outer edges of the first and last point lie
 * half a step out.
 */
function sweepSpan(frequencies, k) {
    const f = frequencies[k];
    return {
        lo: k > 0 ? Math.sqrt(frequencies[k - 1] * f) : f / SWEEP_HALF_STEP,
        hi: k < frequencies.length - 1 ? Math.sqrt(f * frequencies[k + 1]) : f * SWEEP_HALF_STEP
    };
}

/**
 * One harmonic of single tones of the set Signal Level sweep against the fundamental: measured without the
 * correction in `color`, and a dotted expected line for each `expected` { text, color, response } with a
 * response. `viewOf` is the harmonic's sweep view; `noFitKey` is the card note when no line is expected.
 */
function singleToneChart(entry, viewOf, color, expected, noFitKey, t) {
    const items = [];
    let note = null;
    if (!entry.sweep) {
        items.push({ kind: 'note', text: t('analysis:diagChannelFailed') });
    } else {
        const view = viewOf(entry.sweep, null);
        const at = (k, y) => (y === null ? null
            : { x: view.frequencies[k], ...sweepSpan(view.frequencies, k), y });
        const series = values => values.map((y, k) => at(k, y));
        const measured = series(view.measured);
        const floor = {
            kind: 'area', color: '--sdc-lim', opacity: LIMIT_OPACITY,
            points: view.noise.map((top, k) => (top === null ? null : { ...at(k, top), top, bottom: -Infinity }))
        };
        const lines = expected.filter(line => line.response)
            .map(line => ({ ...line, points: series(viewOf(entry.sweep, line.response).expected) }));
        items.push(floor, curve(measured, color, 2.4));
        for (const line of lines) items.push(curve(line.points, line.color, 2.2, '2 3'));
        items.push(legend(t('analysis:diagLegendSingleToneMeasured'), color, 2.4, null, measured));
        for (const line of lines) items.push(legend(line.text, line.color, 2.2, '2 3', line.points));
        items.push({ kind: 'legend', text: t('analysis:diagLegendNoiseFloor'), color: '--sdc-lim', opacity: LIMIT_OPACITY,
            square: true, points: floor.points });
        if (!isDrawn(measured)) items.push({ kind: 'note', text: t('analysis:diagNotEnoughSignal') });
        else if (!lines.length) note = t(noFitKey);
    }
    return {
        frame: distortionFrame(t),
        items,
        note,
        warning: false
    };
}

/** Chart T: single-tone second harmonic, expected with each fitted Filter Length. */
export function chartT(model, entry, t) {
    const expected = SINGLE_TONE_LENGTHS.map(([length, nameKey, color]) => ({
        text: t('analysis:diagLegendSingleToneExpected', { length: t(nameKey) }),
        color,
        response: entry.sweepResponse?.[length] ?? null
    }));
    return singleToneChart(entry, sweepH2View, '--sdc-h2', expected, 'analysis:diagNoFit', t);
}

/**
 * Chart T3: single-tone third harmonic, expected with the odd-order correction whenever it was fitted, also
 * when it stays off, so that a model error shows.
 */
export function chartT3(model, entry, t) {
    const expected = [{ text: t('analysis:diagLegendSingleToneExpectedOdd'), color: '--sdc-odd',
        response: entry.odd?.sweepResponse ?? null }];
    return singleToneChart(entry, sweepH3View, '--sdc-h3', expected, 'analysis:diagNoOddFit', t);
}

/**
 * Shades the overload span over the full height like chart E's noise floor and adds its legend, which has no
 * readout. Returns the card note, or null without an overload.
 */
function markOverload(items, display, stats, t, noteKey) {
    const overload = findOverload(display, stats.map(band => band.gain));
    if (!overload) return null;
    const edge = x => ({ x, top: Infinity, bottom: -Infinity });
    items.unshift({ kind: 'area', color: '--sdc-l6', opacity: LIMIT_OPACITY, points: [edge(overload.lo), edge(overload.hi)] });
    items.push({ kind: 'legend', text: t('analysis:diagOverloadRange'), color: '--sdc-l6', opacity: LIMIT_OPACITY, square: true });
    return t(noteKey, { span: formatSpan(overload.lo, overload.hi) });
}

/**
 * Chart A: change of H2, H3 and H5 at 6 dB lower Signal Level; between ratios at least 6 dB above the noise
 * unless `unmasked`.
 */
export function chartA(model, entry, t, unmasked = false) {
    const { display, stats } = ruleBands(model, entry);
    const items = [
        { kind: 'hline', y: 0, dash: '6 4' },
        { kind: 'hline', y: -6, color: '--sdc-h2', width: 1, dash: '6 4' },
        { kind: 'hline', y: -12, color: '--sdc-h3', width: 1, dash: '6 4' }
    ];
    const change = (k, n) => (unmasked ? sweepChange(entry.diagnosis.ess, display.groups[k], n, true)
        : stats[k].change[n]);
    const orders = SWEEP_ORDERS.map(n => ({ n, points: stats.map((band, k) => pointAt(display, k, change(k, n))) }));
    for (const { n, points } of orders) items.push(curve(points, ORDER_TOKENS[n], 1.6));
    for (const { n, points } of orders) items.push(legend(t(`analysis:diagH${n}`), ORDER_TOKENS[n], 1.6, null, points));
    items.push(legend(t('analysis:diagGuideCorrectable'), '--sdc-h2', 1, '6 4'));
    const note = markOverload(items, display, stats, t, 'analysis:diagOverloadNoteA');
    if (!orders.some(({ points }) => isDrawn(points))) items.push({ kind: 'note', text: t('analysis:diagNotEnoughSignal') });
    return {
        frame: { ...LOG_FRAME, yMin: -18, yMax: 6, yTicks: [6, 0, -6, -12, -18],
            yTitle: t('analysis:diagAxisChange'), xTitle: t('analysis:diagAxisFrequency') },
        items,
        note,
        warning: note !== null
    };
}

/** Chart D: gain at the set Signal Level minus the gain at 6 dB lower, so compression is a dip. */
export function chartD(model, entry, t) {
    const { display, stats } = ruleBands(model, entry);
    const points = stats.map((band, k) => pointAt(display, k, band.gain));
    const items = [{ kind: 'hline', y: 0, dash: '6 4' }, curve(points, '--sdc-l0', 1.6),
        legend(t('analysis:diagSetL'), '--sdc-l0', 1.6, null, points)];
    const note = markOverload(items, display, stats, t, 'analysis:diagOverloadNoteD');
    if (!isDrawn(points)) items.push({ kind: 'note', text: t('analysis:diagNoDataRange') });
    return {
        frame: { ...LOG_FRAME, yMin: -6, yMax: 2, yTicks: [2, 0, -2, -4, -6],
            yTitle: t('analysis:diagAxisGainDiff'), xTitle: t('analysis:diagAxisFrequency') },
        items,
        note,
        warning: note !== null
    };
}

// Instantaneous levels of chart S's map, −100 % to +100 % of the peak in 5 % steps: the edges are the peaks.
const STATIC_LEVELS = Array.from({ length: 41 }, (_, i) => (i - 20) / 20);

/**
 * Gain range of chart S in dB, from the largest peak gain `max`: `range` is the smallest value of the 1-2-5
 * series (…, 0.01, 0.02, 0.05, 0.1, …, 1, 2, 5, 10, …) at or above it, 0.1 dB without one; `ticks` split each
 * half into four (five when `range` starts with 5) and `label` writes a tick with the decimals the step needs;
 * `barTicks` [[value, text]] marks ±range, ±range/2 and 0 for a colour bar; `readDecimals` writes a readout
 * to two significant digits at the range's magnitude, at least one decimal.
 */
export function staticScale(max) {
    if (!(max > 0)) return staticScale(0.1);
    let exponent = Math.floor(Math.log10(max));
    // The tolerance keeps a maximum on a series value from moving up to the next one.
    let mantissa = [1, 2, 5, 10].find(m => m * 10 ** exponent >= max * (1 - 1e-9));
    if (mantissa === 10) {
        mantissa = 1;
        exponent++;
    }
    const range = Number((mantissa * 10 ** exponent).toPrecision(1));
    const intervals = mantissa === 5 ? 5 : 4;
    const tickDecimals = Math.max(0, (mantissa === 1 ? 2 : mantissa === 2 ? 1 : 0) - exponent);
    const ticks = Array.from({ length: 2 * intervals + 1 },
        (_, i) => Number(((intervals - i) * range / intervals).toFixed(tickDecimals)));
    const text = decimals => value => value.toFixed(decimals).replace('-', '−');
    // Half of a range starting with 5 needs one decimal more than its step (2.5 of 5).
    const half = text(tickDecimals + (mantissa === 5 ? 1 : 0));
    return { range, ticks, label: text(tickDecimals),
        barTicks: [range, range / 2, 0, -range / 2, -range].map(value => [value, half(value)]),
        readDecimals: Math.max(1, 1 - exponent) };
}

/**
 * Chart S: gain at the positive and the negative peak of single tones relative to small signals, from the static
 * share of the 2nd and 3rd harmonic, with dotted bounds as if all of it were static and the noise band around 0 dB.
 * `map` holds the same gain at every instantaneous level for the Map view: `columns` [{ lo, hi, gains }] with
 * `gains` per STATIC_LEVELS `levels`, null where both peaks are inside the noise band. The range (`scale`)
 * follows the peak gains outside the noise band, all of them when none is, and is shared by both views.
 * `unmasked` fills every column, with `below` set where both peaks are inside the band, and scales to all peaks.
 */
export function chartS(model, entry, t, unmasked = false) {
    const items = [];
    const columns = [];
    let scale = staticScale(0);
    if (!entry.sweep?.t3Re) {
        items.push({ kind: 'note', text: t('analysis:diagChannelFailed') });
    } else {
        const view = sweepStaticView(entry.sweep, STATIC_LEVELS);
        const span = k => sweepSpan(view.frequencies, k);
        const all = [], outside = [];
        view.noise.forEach((noise, k) => {
            if (noise === null) return;
            const peaks = [view.positive[k], view.negative[k]].map(value => (value < 0 ? -value : value));
            const shown = peaks.filter(value => value > noise);
            all.push(...peaks);
            outside.push(...shown);
            const below = !shown.length;
            if (!unmasked) columns.push({ ...span(k), gains: below ? null : view.map[k] });
            else columns.push({ ...span(k), gains: view.map[k], below });
        });
        scale = staticScale(Math.max(0, ...(outside.length && !unmasked ? outside : all)));
        const at = (k, y) => (y === null ? null : { x: view.frequencies[k], ...span(k), y });
        const series = values => values.map((y, k) => at(k, y));
        const positive = series(view.positive), negative = series(view.negative);
        const upper = series(view.upper), lower = series(view.lower);
        const band = {
            kind: 'area', color: '--sdc-lim', opacity: LIMIT_OPACITY,
            points: view.noise.map((top, k) => (top === null ? null : { ...at(k, top), top, bottom: -top }))
        };
        items.push(band, { kind: 'hline', y: 0, dash: '6 4' },
            curve(upper, '--sdc-nf', 1.2, '2 3'), curve(lower, '--sdc-nf', 1.2, '2 3'),
            curve(positive, '--sdc-l0', 2), curve(negative, '--sdc-l6', 2),
            legend(t('analysis:diagLegendPositivePeak'), '--sdc-l0', 2, null, positive),
            legend(t('analysis:diagLegendNegativePeak'), '--sdc-l6', 2, null, negative),
            // One entry for both bounds: its hover emphasizes both (same style), its readout traces the upper one.
            legend(t('analysis:diagLegendAllStatic'), '--sdc-nf', 1.2, '2 3', upper),
            { kind: 'legend', text: t('analysis:diagLegendNoiseFloor'), color: '--sdc-lim', opacity: LIMIT_OPACITY,
                square: true, points: band.points });
        if (!isDrawn(positive)) items.push({ kind: 'note', text: t('analysis:diagNotEnoughSignal') });
    }
    return {
        frame: { ...LOG_FRAME, yMin: -scale.range, yMax: scale.range, yTicks: scale.ticks,
            yTickLabel: scale.label,
            formatValue: value => formatDb(value, NO_VALUE, scale.readDecimals),
            yTitle: t('analysis:diagAxisPeakGain'), xTitle: t('analysis:diagAxisFundamental') },
        items,
        note: null,
        warning: false,
        map: { levels: STATIC_LEVELS, columns, scale }
    };
}

/**
 * Chart C cells: { lo, hi, order, R } for every shown ratio of the set Signal Level sweep, or with `unmasked`
 * for every measured one, with `below` marking those inside the noise floor.
 */
export function chartCCells(model, entry, unmasked = false) {
    const display = chartBands(model.bands, 'third');
    const cells = [];
    display.groups.forEach((group, k) => {
        for (let order = 2; order <= 10; order++) {
            const ratio = sweepRatio(entry.diagnosis.ess.essL, group, order);
            const R = drawnRatio(ratio, unmasked);
            if (R === null) continue;
            const cell = { lo: display.lo[k], hi: display.hi[k], order, R };
            cells.push(unmasked ? { ...cell, below: !ratio.shown } : cell);
        }
    });
    return cells;
}

// ---------------------------------------------------------------- display settings

const levelResolution = () => 0.1;
/**
 * Display setting kinds, as on the acoustic graphs: the limits, the unit, whether the slider is logarithmic and
 * the input resolution at a value. `hz` is every frequency axis; `percent` the level axis of charts T, T3 and H
 * (dB re the fundamental, entered in percent); `db` the other dB axes; `dbr` chart C's colour range; `fine`
 * chart S's gain, down to a thousandth of a dB.
 */
export const RANGE_KINDS = Object.freeze({
    hz: { min: 10, max: 20000, unit: 'Hz', log: true, resolution: () => 1 },
    percent: { min: 1e-5, max: 100, unit: '%', log: true,
        resolution: value => (value < 1 ? 10 ** (Math.floor(Math.log10(value)) - 2) : 0.01) },
    db: { min: -160, max: 40, unit: 'dB', log: false, resolution: levelResolution },
    dbr: { min: -160, max: 0, unit: 'dBr', log: false, resolution: levelResolution },
    fine: { min: -20, max: 20, unit: 'dB', log: false,
        resolution: value => ((value < 0 ? -value : value) >= 10 ? 0.1 : (value < 0 ? -value : value) >= 1 ? 0.01 : 0.001) }
});
export const RANGE_KEYS = Object.freeze(['xMin', 'xMax', 'yMin', 'yMax']);
const tidy = value => Number(value.toPrecision(12));
const decimalsOf = step => (step < 1 ? Math.ceil(-Math.log10(step) - 1e-9) : 0);
const minus = text => text.replace('-', '−');
const percentOf = v => tidy(100 * 10 ** (v / 20));
const kindOf = (key, kind) => (key.startsWith('x') ? 'hz' : kind);

/** A value of `kind` written to its input resolution. */
export function formatRange(kind, value) {
    return String(Number(value.toFixed(decimalsOf(RANGE_KINDS[kind].resolution(value)))));
}

/** Display values { xMin, xMax, yMin, yMax } of a chart frame; a percent axis converts its dB. */
export function rangeDefaults(frame, kind) {
    const level = kind === 'percent' ? percentOf : v => v;
    return { xMin: frame.xMin, xMax: frame.xMax, yMin: level(frame.yMin), yMax: level(frame.yMax) };
}

/** Allowed [min, max] of setting `key` against the other end of its axis in `range`, one resolution apart. */
export function rangeBounds(kind, range, key) {
    const { min, max, resolution } = RANGE_KINDS[kindOf(key, kind)];
    const axis = key[0];
    const low = range[`${axis}Min`], high = range[`${axis}Max`];
    return key.endsWith('Min') ? [min, tidy(high - resolution(high))] : [tidy(low + resolution(low)), max];
}

// Values of `step` from `min` to `max`, edges included.
function stepsWithin(min, max, step) {
    const values = [];
    const decimals = decimalsOf(step);
    for (let i = Math.floor(min / step); i * step <= max + step * 1e-6; i++) {
        const value = Number((i * step).toFixed(decimals));
        if (value >= min - step * 1e-6 && value <= max + step * 1e-6) values.push(value);
    }
    return values;
}

// The next coarser 1-2-5 step: 1 → 2, 2 → 5, 5 → 10.
function coarserStep(step) {
    const mantissa = Math.round(step / 10 ** Math.floor(Math.log10(step) + 1e-9));
    return tidy(step * (mantissa === 2 ? 2.5 : 2));
}

// 4 to 8 values of a 1-2-5 step within the range, edges included: the step of `createLinearTicks`, its coarser step
// when that gives too many, its finer step (or the one between) when too few.
function linearValues(min, max) {
    const { step } = createLinearTicks(min, max, 8);
    const values = stepsWithin(min, max, step);
    if (values.length > 8) return stepsWithin(min, max, coarserStep(step));
    if (values.length >= 4) return values;
    const finer = finerDecimalStep(step);
    const finerValues = stepsWithin(min, max, finer);
    return finerValues.length > 8 ? stepsWithin(min, max, coarserStep(finer)) : finerValues;
}

// The 1-2-5 values of each decade within a log range, edges included.
function decadeValues(min, max, factors) {
    const values = [];
    for (let exponent = Math.floor(Math.log10(min)); exponent <= Math.floor(Math.log10(max)); exponent++) {
        for (const factor of factors) {
            const value = tidy(factor * 10 ** exponent);
            if (value >= min * (1 - 1e-9) && value <= max * (1 + 1e-9)) values.push(value);
        }
    }
    return values;
}

/**
 * Ticks [[Hz, text]] of a set frequency range, edges included: the 1-2-5 values over a decade or more (the
 * decades only past nine), linear steps in a narrower range.
 */
export function frequencyTicks(min, max) {
    let values = max / min >= 10 ? decadeValues(min, max, [1, 2, 5]) : linearValues(min, max);
    if (values.length > 9) values = decadeValues(min, max, [1]);
    return values.map(value => [value, value >= 1000 ? `${tidy(value / 1000)}k` : String(value)]);
}

/** Ticks [[dB, text]] of a set level range, edges included. */
export function levelTicks(min, max) {
    return linearValues(min, max).map(value => [value, minus(String(value))]);
}

/**
 * Ticks [[%, text]] of a set percent range (log axis), edges included: decades, else the 1-2-5 values (1-3 when those
 * are too many), else linear steps.
 */
export function percentTicks(min, max) {
    let values = decadeValues(min, max, [1]);
    if (values.length < 4) {
        values = decadeValues(min, max, [1, 2, 5]);
        if (values.length > 8) values = decadeValues(min, max, [1, 3]);
    }
    if (values.length < 4) values = linearValues(min, max);
    return values.map(value => [value, `${value} %`]);
}

/**
 * The frame of a log-frequency chart with the set display values `override` (any of RANGE_KEYS) of a level axis
 * of `kind`: an axis with a set value gets ticks of its own range; without one the frame is returned as it is.
 */
export function rangedFrame(frame, override, kind) {
    const has = axis => override[`${axis}Min`] !== undefined || override[`${axis}Max`] !== undefined;
    if (!has('x') && !has('y')) return frame;
    const range = { ...rangeDefaults(frame, kind), ...override };
    const ranged = { ...frame };
    if (has('x')) {
        ranged.xMin = range.xMin;
        ranged.xMax = range.xMax;
        ranged.xTicks = frequencyTicks(range.xMin, range.xMax);
    }
    if (has('y')) {
        const percent = kind === 'percent';
        const level = percent ? v => 20 * Math.log10(v / 100) : v => v;
        const labels = new Map((percent ? percentTicks : levelTicks)(range.yMin, range.yMax)
            .map(([value, text]) => [level(value), text]));
        ranged.yMin = level(range.yMin);
        ranged.yMax = level(range.yMax);
        ranged.yTicks = [...labels.keys()];
        ranged.yTickLabel = v => labels.get(v);
    }
    return ranged;
}

/** Chart S's map scale with set display values: the colours span ±max(|from|, |to|). */
export function staticMapScale(scale, override) {
    if (override.yMin === undefined && override.yMax === undefined) return scale;
    const abs = value => (value < 0 ? -value : value);
    const low = abs(override.yMin ?? -scale.range), high = abs(override.yMax ?? scale.range);
    const range = low > high ? low : high;
    return { ...scale, range,
        barTicks: [range, range / 2, 0, -range / 2, -range].map(value => [value, minus(String(tidy(value)))]) };
}

/**
 * Auto range of a chart from the `extent` { xMin, xMax, yMin?, yMax? } (Hz, axis dB) of what it draws: the
 * frequencies as drawn, the levels with a tenth of their span as margin (at least one resolution step, 1 dB on a
 * percent axis), rounded outward to the input resolution and kept inside the limits. Chart S's gain (`fine`)
 * returns to its own range, so its values are left unset.
 */
export function autoRange(kind, extent) {
    const range = {};
    const outward = (k, value, round) => {
        const step = RANGE_KINDS[k].resolution(value);
        const { min, max } = RANGE_KINDS[k];
        const rounded = tidy(round(value / step) * step);
        return rounded < min ? min : rounded > max ? max : rounded;
    };
    range.xMin = outward('hz', extent.xMin, Math.floor);
    range.xMax = outward('hz', extent.xMax, Math.ceil);
    if (range.xMax <= range.xMin) range.xMax = range.xMin + 1;
    if (kind !== 'fine' && extent.yMin !== undefined) {
        const span = extent.yMax - extent.yMin;
        if (kind === 'percent') {
            const margin = span / 10 > 1 ? span / 10 : 1;
            range.yMin = outward(kind, percentOf(extent.yMin - margin), Math.floor);
            range.yMax = outward(kind, percentOf(extent.yMax + margin), Math.ceil);
        } else {
            const margin = span / 10 > 0.1 ? span / 10 : 0.1;
            range.yMin = outward(kind, extent.yMin - margin, Math.floor);
            range.yMax = outward(kind, extent.yMax + margin, Math.ceil);
        }
        if (range.yMax <= range.yMin) range.yMin = rangeBounds(kind, range, 'yMin')[1];
    }
    return range;
}

// ---------------------------------------------------------------- facts line

export function factsLine(model, entry, length, t, language) {
    const check = !entry.checkFig[length]
        ? t('analysis:diagFactsNotChecked')
        : model.lastCheck
            ? t('analysis:diagFactsCheckedAgain', { when: formatMeasuredAt(model.lastCheck.at, language) })
            : t('analysis:diagFactsChecked');
    const text = t('analysis:diagFacts', {
        ch: channelLabel(entry),
        date: formatMeasuredAt(model.measuredAt, language),
        position: placementText(model, t),
        level: formatDbfs(model.levelDbfs),
        peak: formatDbfs(model.peakDbfs),
        averaging: modelAveragingText(model),
        check
    });
    const notes = [text];
    if (entry.micDistortionWarning) notes.push(t('analysis:diagMicrophoneDistorted'));
    if (entry.recordingGaps) notes.push(t(RECORDING_GAP_NOTES[entry.recordingGaps]));
    return notes.join(' · ');
}

// ---------------------------------------------------------------- summary

function rowBands(model) {
    return ROWS.map((row, r) => {
        const bands = [];
        for (let i = 0; i < N_BANDS; i++) {
            const centre = Math.sqrt(model.bands[i] * model.bands[i + 1]);
            if (centre >= row.lo && (r === ROWS.length - 1 || centre < row.hi)) bands.push(i);
        }
        return bands;
    });
}

const levelText = (stat, t) => (stat.shown ? formatLevel(stat.V, t('analysis:levelFormat')) : t('analysis:diagTooSmall'));

function kindText(model, entry, length, row, bands, rattle, t) {
    const limit = model.upperLimitHz;
    let kind;
    if (row.lo >= limit) {
        kind = 'Outside';
    } else {
        const even = multitone(entry, 'L', bands, 'even');
        const odd = multitone(entry, 'L', bands, 'odd');
        if (!hasFit(entry, length) || !even?.usable) kind = 'TooSmall';
        else if (odd?.shown && odd.V > even.V) {
            // The odd block works only below ODD_HI_HZ and only where Auto plays it.
            const oddPlays = row.lo < ODD_HI_HZ
                && oddDecision(entry, oddConfiguration(entry, length), 'auto').plays;
            kind = oddPlays ? 'OddReduced' : 'Odd';
        } else kind = 'SecondOrder';
    }
    let text = t(`analysis:diagKind${kind}`);
    if (limit > row.lo && limit < row.hi) text += t('analysis:diagKindCorrectedUpTo', { f: formatHz(limit) });
    if (rattle && rattle.lo < row.hi && rattle.hi > row.lo) {
        text += t('analysis:diagKindRattle', { range: formatSpan(rattle.lo, rattle.hi) });
    }
    return text;
}

/** Whether two channels are compared by loudness at the microphone. */
export function isMatched(model, entry, otherModel, otherEntry) {
    return Boolean(entry.inputDeviceId) && entry.inputDeviceId === otherEntry.inputDeviceId
        && model.placement === otherModel.placement;
}

// Compared value a of one cell: { a } (null below the noise floor) or { differ: true }.
function comparedValue(own, others, set, matched) {
    if (!matched) return { a: others[set]?.shown ? others[set].V : null };
    const points = LEVEL_SETS.map(name => others[name]).filter(stat => stat?.shown)
        .map(stat => [stat.tone, stat.V]).sort((p, q) => p[0] - q[0]);
    if (!points.length) return { a: null };
    const first = points[0];
    const last = points[points.length - 1];
    const tone = own.tone;
    if (tone < first[0] - 1.5 || tone > last[0] + 1.5) return { differ: true };
    if (tone <= first[0]) return { a: first[1] };
    if (tone >= last[0]) return { a: last[1] };
    const upper = points.findIndex(point => point[0] >= tone);
    const [t0, v0] = points[upper - 1];
    const [t1, v1] = points[upper];
    return { a: t1 === t0 ? v1 : v0 + (v1 - v0) * (tone - t0) / (t1 - t0) };
}

function comparedDisplay(own, value, t) {
    if (value.differ) return { text: t('analysis:diagCmpLevelsDiffer'), cls: 'same' };
    const a = value.a;
    if (a !== null && own.shown) {
        const d = own.V - a;
        const params = { a: formatDbfs(a), d: signed(d) };
        if (d <= -2) return { text: t('analysis:diagCmpCleaner', params), cls: 'better' };
        if (d >= 2) return { text: t('analysis:diagCmpWorse', params), cls: 'worse' };
        return { text: t('analysis:diagCmpSame', params), cls: 'same' };
    }
    if (a !== null) {
        return own.floorDb !== null && a > own.floorDb
            ? { text: t('analysis:diagCmpCleanerBy', { a: formatDbfs(a), d: formatDbfs(a - own.floorDb) }), cls: 'better' }
            : { text: t('analysis:diagCmpPlain', { a: formatDbfs(a) }), cls: 'same' };
    }
    return { text: t('analysis:diagCmpTooSmall'), cls: own.shown ? 'worse' : 'same' };
}

/** Summary lines under the table for Filter Length `length`; empty without a fit. */
export function summaryLines(entry, length, t) {
    if (!hasFit(entry, length)) return [];
    const level = value => (value === null || value === undefined
        ? t('analysis:diagTooSmall') : formatLevel(value, t('analysis:levelFormat')));
    const pair = (before, after) => `${level(before)} → ${level(after)}`;
    const predicted = set => [levelFigure(entry, length, set, SCALE_MEASURED), levelFigure(entry, length, set, SCALE_REDUCE)];
    const check = entry.checkFig[length];
    let line2;
    if (check) {
        const [totalBefore, totalAfter, evenBefore, evenAfter] = check.level;
        line2 = t('analysis:diagSumLine2Measured',
            { total: pair(totalBefore, totalAfter), even: pair(evenBefore, evenAfter) });
    } else {
        const [before, after] = predicted('L');
        line2 = t('analysis:diagSumLine2Predicted',
            { total: pair(before.total, after.total), even: pair(before.even, after.even) });
    }
    const evenPair = set => {
        const [before, after] = predicted(set);
        return pair(before.even, after.even);
    };
    return [
        t('analysis:diagSumLine1', { length: t(length === 'short' ? 'analysis:diagShort' : 'analysis:diagLong') }),
        line2,
        t('analysis:diagSumLine3', { pair: evenPair('L-6') }),
        t('analysis:diagSumLine4', { pair: evenPair('peaks') })
    ];
}

/**
 * Summary table. `compare` is { model, entry } of the compared channel
 * or null. Each row: { name, empty, cells: [{ text, V, compared }], change, kind }.
 */
export function summaryTable(model, entry, length, t, compare = null) {
    const rattle = rattleSpan(model, entry);
    const matched = compare ? isMatched(model, entry, compare.model, compare.entry) : false;
    const rows = rowBands(model).map((bands, r) => {
        const row = ROWS[r];
        const name = t(row.key);
        const stats = Object.fromEntries(LEVEL_SETS.map(set => [set, multitone(entry, set, bands, 'total')]));
        if (!stats.L) {
            return { name, empty: true, cells: LEVEL_SETS.map(() => ({ text: NO_VALUE, V: null, compared: null })),
                change: { text: NO_VALUE, value: null }, kind: NO_VALUE };
        }
        const others = compare
            ? Object.fromEntries(LEVEL_SETS.map(set => [set, multitone(compare.entry, set, bands, 'total')]))
            : null;
        const cells = LEVEL_SETS.map(set => {
            const stat = stats[set];
            if (!stat) return { text: NO_VALUE, V: null, compared: null };
            const value = others ? comparedValue(stat, others, set, matched) : null;
            return {
                text: levelText(stat, t),
                V: stat.V,
                compared: value ? { ...value, ...comparedDisplay(stat, value, t) } : null
            };
        });
        const change = stats.L.usable && stats['L-6']?.usable ? stats['L-6'].V - stats.L.V : null;
        return {
            name,
            empty: false,
            cells,
            change: { text: formatDb(change, NO_VALUE), value: change },
            kind: kindText(model, entry, length, row, bands, rattle, t)
        };
    });
    return { heads: COLUMN_KEYS.map(key => t(key)), rows, lines: summaryLines(entry, length, t), matched };
}

function spreadsheetText(value) {
    const text = value.replace(/[\t\r\n\u0085\u2028\u2029]/g, ' ');
    return /^["=+@\-＝＋＠－]/.test(text.trimStart()) ? `'${text}` : text;
}

/** Tab-separated summary for pasting into a spreadsheet. */
export function summaryTsv(model, entry, table, t, { name, language, comparedName = null }) {
    const lines = [
        [t('analysis:diagnosis'), spreadsheetText(name), spreadsheetText(channelLabel(entry)), placementText(model, t),
            t('analysis:diagSignalLevel', { level: formatDbfs(model.levelDbfs) }),
            formatMeasuredAt(model.measuredAt, language)].join('\t'),
        table.heads.join('\t')
    ];
    const tooSmall = t('analysis:diagTooSmall');
    for (const row of table.rows) {
        const levels = row.cells.map(cell => (row.empty ? '' : cell.V === null ? tooSmall : plainNumber(cell.V)));
        const change = row.change.value === null ? '' : plainNumber(row.change.value);
        lines.push([row.name, ...levels, change, row.empty ? '' : row.kind].join('\t'));
    }
    lines.push(...table.lines);
    if (comparedName !== null) {
        for (const row of table.rows) {
            const values = row.cells.map(cell => {
                if (!cell.compared) return '';
                if (cell.compared.differ) return t('analysis:diagCmpLevelsDiffer');
                return cell.compared.a === null ? tooSmall : plainNumber(cell.compared.a);
            });
            const label = spreadsheetText(`${row.name}, ${t('analysis:diagCopyCompared', { name: comparedName })}`);
            lines.push([label, ...values, '', '']
                .join('\t'));
        }
    }
    return lines.join('\n');
}

// ---------------------------------------------------------------- reading list

/** Why the measurement left a channel's correction off at a length, or null when it did not. */
export function offReasonText(entry, length, t) {
    const code = entry.reason[length];
    if (!code) return null;
    const key = `message:speakerDistortionReason${code[0].toUpperCase()}${code.slice(1)}`;
    const worst = entry.worst[length]?.class;
    // Single tones are judged by fundamental, so their widest class is everything above 2 kHz.
    if (code === 'worseForSingleTones') {
        return t(key, { band: t(worst === 'even8k' ? 'message:speakerDistortionBandAbove2k' : BAND_PHRASES[worst]) });
    }
    if (code !== 'worseInCheck') return t(key);
    // The total figure has no band of its own, so its sentence names the overall distortion.
    return worst === 'total' ? t(`${key}Total`) : t(key, { band: t(BAND_PHRASES[worst]) });
}

function rule1Action(model, entry, t) {
    if (entry.on.short || entry.on.long) {
        const recommended = model.recommendedLength;
        const length = entry.on[recommended] ? recommended : recommended === 'short' ? 'long' : 'short';
        const check = entry.checkFig[length];
        const aFigure = check ? check.fig[EVEN8K] : classFigure(entry, length, 'L', 'even8k', SCALE_REDUCE);
        const bFigure = classFigure(entry, length, 'L-6', 'even8k', SCALE_REDUCE);
        const a = Number.isFinite(aFigure) ? -aFigure : null;
        const b = bFigure === null ? null : -bFigure;
        const params = {
            length: t(length === 'short' ? 'analysis:diagShort' : 'analysis:diagLong'),
            a: a === null ? NO_VALUE : formatDbfs(a),
            kind: t(check ? 'analysis:diagMeasured' : 'analysis:diagPredicted')
        };
        if (b === null) return { tag: 'on', text: t('analysis:diagR1ActionNoL6', params) };
        let text = t('analysis:diagR1Action', { ...params, b: formatDbfs(b) });
        const absA = a === null ? 0 : a < 0 ? -a : a;
        if ((b < 0 ? -b : b) < absA / 2) text += t('analysis:diagR1NearOnly');
        return { tag: 'on', text };
    }
    const short = offReasonText(entry, 'short', t);
    const long = offReasonText(entry, 'long', t);
    const reasons = short === long
        ? [short]
        : [short && t('analysis:speakerDistortionShortPrefix', { reason: short }),
            long && t('analysis:speakerDistortionLongPrefix', { reason: long })];
    return { tag: 'off', text: [t('analysis:diagR1NotExpected'), ...reasons.filter(Boolean)].join(' ') };
}

// The result tab that shows a chart a finding names; chart E is on the findings' own tab.
const EVIDENCE_TABS = { A: 'diagnosisLevel', B: 'diagnosisLevel', D: 'diagnosisLevel', C: 'diagnosisHarmonics' };

/**
 * Reading list: items { obs, tab (the result tab of the chart the observation
 * names, null when none or on the findings' own tab), tag ('on' | 'off' | null),
 * text, button ({ text, hz }) or null, muted (text) or null }.
 */
export function readingList(model, entry, t) {
    const { display, stats } = ruleBands(model, entry);
    // An observation that names chart `key`; the tab of that chart goes with it.
    const observed = (obsKey, key, params = {}) => ({
        obs: t(obsKey, { ...params, chart: t(`analysis:diagTitle${key}`) }),
        tab: EVIDENCE_TABS[key] ?? null
    });
    const span = found => spanText(display, found);
    const inRange = (lo, hi) => k => display.fc[k] >= lo && display.fc[k] <= hi;
    const all = () => true;
    const item = (observation, tag, text, extra = {}) => ({ ...observation, tag, text, button: null, muted: null, ...extra });
    const items = [];

    // Overload: first, as it limits every other reading at the set Signal Level.
    const overload = findOverload(display, stats.map(band => band.gain));
    if (overload) {
        items.push(item(observed('analysis:diagOverloadObs', 'D', { m: formatDbfs(overload.drop), span: span(overload) }),
            'off', `${t('analysis:diagOverloadCause')} ${t('analysis:diagOverloadAction')}`));
    }

    // Rule 1: square-law even-order distortion.
    const square = median => median >= -8 && median <= -4;
    const multitoneFound = windowed(stats.map(band => band.evenChange), inRange(50, 2000), square);
    const sweepFound = windowed(stats.map(band => band.change[2]), inRange(50, 2000), square);
    const useSweep = sweepFound && (!multitoneFound || sweepFound.last - sweepFound.first > multitoneFound.last - multitoneFound.first);
    const rule1 = useSweep ? sweepFound : multitoneFound;
    let rule1Correctable = false;
    if (rule1) {
        const action = rule1Action(model, entry, t);
        rule1Correctable = action.tag === 'on';
        items.push(item(observed('analysis:diagR1Obs', useSweep ? 'A' : 'E', {
            source: t(useSweep ? 'analysis:diagR1SourceH2' : 'analysis:diagR1SourceEven'),
            m: formatDbfs(-rule1.median),
            span: span(rule1)
        }), action.tag, `${t('analysis:diagR1Cause')} ${action.text}`));
    }

    // Rules 2 and 3: level-invariant and rising distortion per order.
    const orderList = condition => SWEEP_ORDERS
        .map(n => ({ n, found: windowed(stats.map(band => band.change[n]), all, condition) }))
        .filter(entryFound => entryFound.found)
        .map(({ n, found }) => t('analysis:diagOrderAt', { order: `H${n}`, span: span(found) }))
        .join(t('analysis:diagListSeparator'));
    for (const [rule, condition] of [[2, m => (m < 0 ? -m : m) <= 2], [3, m => m >= 2]]) {
        const list = orderList(condition);
        if (list) {
            items.push(item(observed(`analysis:diagR${rule}Obs`, 'A', { list }), 'off',
                `${t(`analysis:diagR${rule}Cause`)} ${t(`analysis:diagR${rule}Action`)}`));
        }
    }

    // Rule 4: sudden onset.
    const onset = widest(flagSpans(stats.map(band => band.onset >= 3)));
    if (onset) {
        let k = 0;
        for (let j = onset.first; j <= onset.last; j++) k = stats[j].onset > k ? stats[j].onset : k;
        items.push(item(observed('analysis:diagR4Obs', 'C', { k, span: span(onset) }), 'off',
            `${t('analysis:diagR4Cause')} ${t('analysis:diagR4Action', { span: span(onset) })}`));
    }

    // Rule 5: rattle or buzz.
    const rattle = rattleSpan(model, entry);
    if (rattle) {
        const range = formatSpan(rattle.lo, rattle.hi);
        const start = rattle.lo;
        const limit = model.upperLimitHz;
        items.push(item(observed('analysis:diagR5Obs', 'B', { span: range }), 'off',
            t('analysis:diagR5Action', { span: range }), {
                button: start >= 500 && start < limit
                    ? { text: t('button:excludeRattle', { f: formatHz(start) }), hz: Math.round(start) } : null,
                muted: start >= limit ? t('analysis:rattleOutside') : null
            }));
    }

    // Rule 6: hum.
    const diagnosis = entry.diagnosis;
    let hum = null;
    for (const [f0, excess] of [[50, diagnosis.hum50], [60, diagnosis.hum60]]) {
        excess.forEach((value, i) => {
            if (value >= 10 && (!hum || value > hum.excess)) hum = { f: (i + 1) * f0, excess: value };
        });
    }
    if (hum) {
        items.push(item(observed('analysis:diagR6Obs', 'B', { f: hum.f, e: formatDbfs(hum.excess) }), 'off',
            `${t('analysis:diagR6Cause')} ${t('analysis:diagR6Action')}`));
    }

    // Rules 7 and 8: gain changes with level (rule 7 is a milder overload).
    const gains = range => stats.map((band, k) => (range(k) && band.gain !== null ? k : -1)).filter(k => k >= 0);
    const sagBands = gains(inRange(200, 8000));
    const rule7 = !overload && sagBands.length >= 3 && sagBands.every(k => stats[k].gain <= -0.3);
    if (rule7) {
        items.push(item(observed('analysis:diagR7Obs', 'D'), 'off',
            `${t('analysis:diagR7Cause')} ${t('analysis:diagR7Action')}`));
    }
    const bassBands = gains(inRange(40, 100));
    const bassMedian = bassBands.length >= 2 ? median(bassBands.map(k => stats[k].gain)) : 0;
    if (!overload && !rule7 && bassMedian <= -0.5) {
        const bass = { first: bassBands[0], last: bassBands[bassBands.length - 1] };
        items.push(item(observed('analysis:diagR8Obs', 'D', { span: span(bass), m: formatDbfs(-bassMedian) }), 'off',
            `${t('analysis:diagR8Cause')} ${t('analysis:diagR8Action', { f: Math.round(display.hi[bass.last]) })}`));
    }

    // Rule 9: asymmetry.
    const asymmetry = windowed(stats.map(band => band.asymmetry), all, m => m >= 6);
    if (asymmetry) {
        const on = rule1Correctable;
        items.push(item(observed('analysis:diagR9Obs', 'E', { span: span(asymmetry) }), on ? 'on' : 'off',
            `${t('analysis:diagR9Cause')} ${t(on ? 'analysis:diagR9ActionOn' : 'analysis:diagR9ActionOff')}`));
    }

    const result = items.slice(0, MAX_RULE_ITEMS);
    if (!rule1) {
        const missing = widest(flagSpans(stats.map((band, k) =>
            inRange(50, 2000)(k) && band.evenChange === null && band.change[2] === null)));
        if (missing) {
            result.push(item({ obs: t('analysis:diagNotEvalObs', { span: span(missing) }), tab: null }, null,
                t('analysis:diagNotEvalAction')));
        }
    }
    if (!result.length) result.push(item({ obs: t('analysis:diagNothingFound'), tab: null }, null, null));
    return result;
}

// ---------------------------------------------------------------- compare options

/**
 * Compare options: the other channels of this measurement with a
 * diagnosis block, then every such channel of the other measurements saved on
 * this device, newest first. Each: { id, index, label }.
 */
export function compareOptions(measurement, channelIndex, saved, t, language) {
    const withDiagnosis = record => record.speakerModel?.channels.filter(channel => channel.diagnosis) ?? [];
    const options = withDiagnosis(measurement)
        .filter(channel => channel.index !== channelIndex)
        .map(channel => ({ id: measurement.id, index: channel.index,
            label: t('analysis:diagCompareThis', { channel: channelLabel(channel) }) }));
    const others = saved.filter(record => record.id !== measurement.id && Number.isFinite(record.savedAt))
        .sort((a, b) => b.savedAt - a.savedAt);
    for (const record of others) {
        const name = record.name?.trim() || (record.speakerModel ? formatMeasuredAt(record.speakerModel.measuredAt, language) : '');
        for (const channel of withDiagnosis(record)) {
            options.push({ id: record.id, index: channel.index,
                label: t('analysis:diagCompareOther', { name, channel: channelLabel(channel) }) });
        }
    }
    return options;
}
