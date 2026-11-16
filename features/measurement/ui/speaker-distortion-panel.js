/**
 * Distortion tab of a speaker distortion measurement: the summary,
 * one block per channel, the Check the correction card with Check again, the Upper Limit refit
 * and the copy button. The text builders are pure (`t` resolves keys) so they can be tested
 * without a DOM.
 */
import i18n from '../i18n.js';
import dataStorage from '../dataStorage.js';
import { copyTextToClipboard } from '../../../js/utils/clipboard-utils.js';
import {
    LENGTHS,
    SCALE_MEASURED,
    SCALE_REDUCE,
    oddConfiguration,
    oddDecision,
    playedCheckFig
} from '../../../js/utils/measurement-dsp/speaker-distortion/index.js';
import {
    bestPossibleTotal,
    classFigure,
    formatDb,
    formatDbfs,
    formatLevel,
    formatMeasuredAt,
    hasFit,
    levelFigure,
    measurementTitle,
    modelAveragingText
} from '../speaker-distortion-figures.js';
import { channelLabel, formatHz, formatSpan, offReasonText, overloadSpan, placementText, rattleSpan }
    from '../distortion-diagnosis.js';
import { cancelRefit, clearRefitState, getRefitState, getSpeakerResultOperation, isSpeakerResultBusy, isValidUpperLimit,
    onRefitChange, startRefit, startSpeakerResultOperation }
    from './speaker-distortion-refit.js';
import { bandLimitedSettings, checkAgainInputs, runCheckAgain } from '../measurement-controller/speaker-distortion-measurement.js';

const NO_VALUE = '—';
const TOAST_MS = 2600;
const RANGE_UPDATED_MS = 6000;
const LENGTH_LABELS = { short: 'label:filterShort', long: 'label:filterLong' };
const REASON_SUFFIX = {
    littleGain: 'LittleGain',
    worseInCheck: 'WorseInCheck',
    worseForSingleTones: 'WorseForSingleTones',
    worseAtLowerVolume: 'WorseAtLowerVolume',
    worseAtLoudPeaks: 'WorseAtLoudPeaks',
    belowLimit: 'BelowLimit',
    noFit: 'NoFit'
};
const FOUND_KEYS = {
    worseInCheck: 'analysis:foundWorseInCheck',
    worseForSingleTones: 'analysis:foundWorseForSingleTones',
    worseAtLowerVolume: 'analysis:foundWorseAtLowerVolume',
    worseAtLoudPeaks: 'analysis:foundWorseAtLoudPeaks'
};
// Odd line texts: when the odd fit rule failed or no odd fit exists, else after the check.
const ODD_FIT_KEYS = {
    littleGain: 'message:speakerDistortionOddFitLittleGain',
    worseInCheck: 'message:speakerDistortionOddFitWorseInCheck',
    worseForSingleTones: 'message:speakerDistortionOddFitWorseForSingleTones',
    worseAtLowerVolume: 'message:speakerDistortionOddFitWorseAtLowerVolume',
    belowLimit: 'message:speakerDistortionOddBelowLimit',
    noFit: 'message:speakerDistortionOddNoFit'
};
const ODD_CHECK_KEYS = {
    littleGain: 'message:speakerDistortionOddLittleGain',
    worseWhenLoud: 'message:speakerDistortionOddWorseWhenLoud'
};
const ODD_CONFIG_KEYS = {
    short: 'analysis:configShortOdd',
    long: 'analysis:configLongOdd',
    alone: 'analysis:configAlone'
};
export const uiText = (key, params) => i18n.t(key, params) ?? key;
export const uiLanguage = () => document.documentElement.lang || 'en';
export const listText = (items, language) => new Intl.ListFormat(language, { type: 'conjunction' }).format(items);
const signedDbfs = value => (value > 0.05 ? `+${formatDbfs(value)}` : formatDbfs(value));
const roundHalf = value => Math.round(2 * value) / 2;
const isChannelCorrecting = (entry, length) => Boolean(entry.on[length]) ||
    oddDecision(entry, oddConfiguration(entry, length), 'auto').plays;
export const isCorrecting = model => model.channels.some(entry => LENGTHS.some(length => isChannelCorrecting(entry, length)));
const hasDetails = entry => LENGTHS.some(length => hasFit(entry, length)) || Boolean(entry.odd?.weights);
const keyOf = measurement => measurement.id ?? measurement;
const sameMeasurement = (a, b) => Boolean(a && b) && keyOf(a) === keyOf(b);

function levelText(value, t) {
    return Number.isFinite(value) ? formatLevel(value, t('analysis:levelFormat')) : t('analysis:speakerDistortionTooSmall');
}

// ---------------------------------------------------------------- pure text builders

/** The clipboard text of the measurement. */
export function buildSpeakerDistortionCopyPayload(measurement, language = 'en') {
    const model = measurement.speakerModel;
    const effect = {
        nm: 'Distortion Correction',
        en: true,
        ms: measurement.id,
        mn: measurementTitle(measurement, language, 'Untitled'),
        md: 'Reduce',
        dv: 0,
        fl: model.recommendedLength === 'short' ? 'Short' : 'Long',
        cn: 0,
        co: 0
    };
    if (model.channels.some(entry => entry.index >= 2 &&
        LENGTHS.some(length => hasFit(entry, length) || isChannelCorrecting(entry, length)))) {
        effect.ch = 'A';
    }
    return JSON.stringify([effect], null, 2);
}

/** The summary line. */
export function summaryLine(model, t, language) {
    return [
        t('analysis:summaryMeasured', { date: formatMeasuredAt(model.measuredAt, language) }),
        t('analysis:summaryPosition', { position: placementText(model, t) }),
        t('analysis:summaryLevels', { level: formatDbfs(model.levelDbfs), peak: formatDbfs(model.peakDbfs) }),
        t('analysis:summaryAveraging', { averaging: modelAveragingText(model) }),
        t('analysis:summaryUpperLimit', { hi: model.upperLimitHz })
    ].join(' · ');
}

/** Label/value rows of the Details tab: the conditions the measurement was made under. */
export function detailRows(model, t) {
    return [
        [t('label:microphonePosition'), placementText(model, t)],
        [t('label:signalLevel'), `${formatDbfs(model.levelDbfs)} dBFS`],
        [t('label:distortionAveraging'), modelAveragingText(model)],
        [t('label:upperLimit'), String(model.upperLimitHz)],
        [t('label:sampleRate'), `${model.channels[0].rateHz} Hz`]
    ];
}

/** One overload warning per span reached at the set Signal Level, naming every channel that reached it. */
export function overloadWarnings(model, t, language) {
    const channels = new Map();
    for (const entry of model.channels) {
        const overload = overloadSpan(model, entry);
        if (!overload) continue;
        const span = formatSpan(overload.lo, overload.hi);
        channels.set(span, [...(channels.get(span) ?? []), channelLabel(entry)]);
    }
    return [...channels].map(([span, labels]) => t('warning:overload', { ch: listText(labels, language), span }));
}

/** The recommended Filter Length line. */
export function recommendedText(model, t, language) {
    const length = model.recommendedLength;
    const on = model.channels.filter(entry => isChannelCorrecting(entry, length)).map(channelLabel);
    if (!on.length) return t('analysis:noLengthCorrects');
    const off = model.channels.filter(entry => !isChannelCorrecting(entry, length)).map(channelLabel);
    const key = off.length === 0 ? 'analysis:recommendedLengthAllOn'
        : off.length > 1 ? 'analysis:recommendedLengthOffPlural' : 'analysis:recommendedLength';
    return t(key, { length: t(LENGTH_LABELS[length]), on: listText(on, language), off: listText(off, language) });
}

/**
 * The measured check of what Auto plays at `length`. If neither block plays, show the measured even-order
 * check so the chart still explains why correction was rejected.
 */
export function playedFigure(entry, length) {
    const configuration = oddConfiguration(entry, length);
    if (oddDecision(entry, configuration, 'auto').plays) {
        return playedCheckFig(entry, entry.on[length] ? length : null, true);
    }
    return entry.checkFig[length] ?? null;
}

/** [totalBefore, totalAfter, evenBefore, evenAfter] and whether they were measured; null without figures. */
export function headlineLevels(entry, length) {
    const check = playedFigure(entry, length);
    if (check) return { levels: check.level, measured: true };
    if (!hasFit(entry, length)) return null;
    const before = levelFigure(entry, length, 'L', SCALE_MEASURED);
    const after = levelFigure(entry, length, 'L', SCALE_REDUCE);
    return { levels: [before.total, after.total, before.even, after.even], measured: false };
}

/**
 * Odd-order level in dB from the total and even-order levels of `headlineLevels`, or null when too small to
 * measure: both cover the same 50 Hz-8 kHz bins against the same signal power, and the total is the odd power
 * plus the even power.
 */
function oddLevel(total, even) {
    if (!Number.isFinite(total)) return null;
    if (!Number.isFinite(even)) return total;
    const value = 10 * Math.log10(10 ** (total / 10) - 10 ** (even / 10));
    return Number.isFinite(value) ? value : null;
}

/**
 * The headline chart of a channel block: {series: [without, with] labels, rows: [{label, cells: [without,
 * with]}]}, each cell {text, value, worse} with `value` the distortion in percent of the test signal (null: too
 * small to measure, text only); null without figures. "With" shows the correction that was measured or predicted.
 */
export function headlineChart(entry, length, t) {
    const headline = headlineLevels(entry, length);
    if (!headline) return null;
    const [totalBefore, totalAfter, evenBefore, evenAfter] = headline.levels;
    const cell = (db, worse) => ({
        text: levelText(db, t), value: Number.isFinite(db) ? 100 * 10 ** (db / 20) : null, worse
    });
    const row = (key, before, after) => ({
        label: t(key),
        cells: [cell(before, false),
            cell(after, Number.isFinite(after) && (!Number.isFinite(before) || after > before))]
    });
    return {
        series: [t('analysis:withoutCorrection'),
            t(headline.measured ? 'analysis:diagLegendCorrectedMeasured' : 'analysis:diagLegendCorrectedPredicted')],
        rows: [
            row('label:totalDistortion', totalBefore, totalAfter),
            row('label:evenOrderDistortion', evenBefore, evenAfter),
            row('label:oddOrderDistortion', oddLevel(totalBefore, evenBefore), oddLevel(totalAfter, evenAfter))
        ]
    };
}

/**
 * The percent axis shared by the headline charts of one measurement: {min: 0, max, step}, `max` the largest
 * value rounded up to a 1-2-5 step of about a quarter of it (nothing is clamped).
 */
export function headlineAxis(charts) {
    const hi = Math.max(0, ...charts.flatMap(chart => chart.rows.flatMap(row => row.cells.map(cell => cell.value)))
        .filter(Number.isFinite));
    if (hi === 0) return { min: 0, max: 1, step: 0.5 };
    const rough = hi / 4;
    const power = 10 ** Math.floor(Math.log10(rough));
    const step = [1, 2, 5, 10].map(m => m * power).find(s => s >= rough);
    return { min: 0, max: Math.ceil(hi / step) * step, step };
}

export function whyText(entry, length, t) {
    return t(isChannelCorrecting(entry, length) ? 'analysis:whyOn' : `analysis:why${REASON_SUFFIX[entry.reason[length]]}`);
}

/** The band line of a channel block measured with a limited Sweep Bandwidth, or null for a full-band channel. */
export function bandLimitedText(entry, t) {
    return bandLimitedSettings([entry]).length ? t('analysis:bandLimited', { band: formatSpan(...entry.bandwidth) }) : null;
}

/** The odd-order line of a channel block for the configuration Auto plays at `length`. */
export function oddLineText(entry, length, t) {
    const c = oddConfiguration(entry, length);
    const { plays, reason } = oddDecision(entry, c, 'auto');
    // Its numbers are in the headline chart and the odd-order Details chart.
    if (plays) return t(c === 'alone' ? 'message:speakerDistortionOddAlone' : 'message:speakerDistortionOddAlso');
    if (!entry.odd?.weights || entry.odd.fitReason) return t(ODD_FIT_KEYS[reason]);
    if (reason === 'worseOverall') {
        return t(c === 'alone' ? 'message:speakerDistortionOddWorseOverallAlone'
            : 'message:speakerDistortionOddWorseOverall');
    }
    return t(ODD_CHECK_KEYS[reason] ?? 'message:speakerDistortionOddNotChecked');
}

/** The "turn it on anyway" hint of an off channel with a fit, or null. */
export function onAnywayText(entry, length, t) {
    if (!hasFit(entry, length)) return null;
    const reason = entry.reason[length];
    if (reason === 'littleGain') return t('help:onAnywayLittleGain');
    return FOUND_KEYS[reason] ? t('help:onAnywayNotAdvised', { found: t(FOUND_KEYS[reason]) }) : null;
}

/**
 * The Details charts: {columns: [{label, status}], sections: [{head, groups: [{title, rows: [{label,
 * cells: [{text, value, worse, series, note?, best?}]}]}]}]}. `value` is the dB change drawn as a bar (null: text
 * only), `series` the Filter Length whose colour the bar takes (null: neutral) and `best` the best-possible
 * figure drawn as a marker. The first section compares the correction with no correction, one cell
 * per length; the second, present when an odd-order pass was measured, compares each odd-order pass with the same
 * setting without the odd block, one cell per row.
 */
export function detailsTable(model, entry, t) {
    const tooSmall = t('analysis:speakerDistortionTooSmall');
    const checks = new Map(LENGTHS.map(length => [length, playedFigure(entry, length)]));
    const available = length => hasFit(entry, length) || Boolean(checks.get(length));
    const measured = LENGTHS.filter(available).every(length => checks.get(length));
    const valueCell = (value, series, worse = false) => {
        const finite = Number.isFinite(value) ? value : null;
        return { text: formatDb(finite, tooSmall), value: finite, worse, series };
    };
    const cell = (length, value, worse = false) => (available(length)
        ? valueCell(value, length, worse)
        : { text: NO_VALUE, value: null, worse: false, series: length });
    const reasonIs = (length, reason) => entry.reason[length] === reason;
    const checkRow = (label, figIndex, classKey) => ({
        label,
        cells: LENGTHS.map(length => {
            if (!available(length)) return cell(length, null);
            const check = checks.get(length);
            const value = check ? check.fig[figIndex] : classFigure(entry, length, 'L', classKey, SCALE_REDUCE);
            const worse = check ? value > 0
                : reasonIs(length, 'worseInCheck') && entry.worst[length]?.class === classKey;
            return cell(length, value, worse);
        })
    });
    const evenRow = (bandKey, figIndex, classKey) =>
        checkRow(t('analysis:evenRow', { band: t(bandKey) }), figIndex, classKey);
    const totalRow = checkRow(t('label:totalDistortion50to8k'), 4, 'total');
    LENGTHS.forEach((length, index) => {
        const headline = headlineLevels(entry, length);
        if (!headline) return;
        const [totalBefore, , evenBefore] = headline.levels;
        const best = bestPossibleTotal(Number.isFinite(totalBefore) ? totalBefore : null,
            Number.isFinite(evenBefore) ? evenBefore : null);
        Object.assign(totalRow.cells[index], { note: t('analysis:bestPossible', { db: formatDb(best, tooSmall) }), best });
    });
    const otherRow = (label, set, worseReason = null) => ({
        label,
        cells: LENGTHS.map(length => (hasFit(entry, length)
            ? cell(length, classFigure(entry, length, set, 'even8k', SCALE_REDUCE),
                worseReason !== null && reasonIs(length, worseReason))
            : { text: NO_VALUE, value: null, worse: false, series: length }))
    });
    // Odd-order passes against the same setting without the odd block; one cell per row, in the colour of the
    // length it plays with (Short + odd-order, Long + odd-order) or neutral.
    const oddGroup = (title, { odd, total }, series = null) => ({
        title,
        rows: [[t('analysis:oddRow'), odd[3]], [t('label:totalDistortion50to8k'), total]]
            .map(([label, value]) => ({ label, cells: [valueCell(value, series)] }))
    });
    const oddGroups = Object.entries(ODD_CONFIG_KEYS).filter(([c]) => entry.odd?.checkFig[c])
        .map(([c, key]) => oddGroup(t(key), entry.odd.checkFig[c], LENGTHS.includes(c) ? c : null));
    const loud = entry.odd?.loud;
    if (loud && loud.t !== null) {
        oddGroups.push(oddGroup(t('analysis:loudRow', { level: formatDbfs(model.levelDbfs + loud.t) }), loud));
    }
    const even = {
        head: t('analysis:detailsHeader'),
        groups: [
            {
                title: t(measured ? 'analysis:groupMeasured' : 'analysis:groupPredictedStale'),
                rows: [
                    evenRow('label:band50to8k', 5, 'even8k'),
                    evenRow('label:bandBelow100', 0, 'c1'),
                    evenRow('label:band100to400', 1, 'c2'),
                    evenRow('label:band400to2k', 2, 'c3'),
                    totalRow
                ]
            },
            {
                title: t('analysis:groupOtherLevels'),
                rows: [
                    otherRow(t('label:sixDbLower'), 'L-6', 'worseAtLowerVolume'),
                    otherRow(t('label:twelveDbLower'), 'L-12'),
                    otherRow(t('label:loudPeaksUpTo', { level: formatDbfs(model.peakDbfs) }), 'peaks', 'worseAtLoudPeaks')
                ]
            }
        ]
    };
    return {
        columns: LENGTHS.map(length => ({
            label: t(LENGTH_LABELS[length]),
            status: t(isChannelCorrecting(entry, length) ? 'status:passesChecks' : 'status:off')
        })),
        sections: oddGroups.length ? [even, { head: t('analysis:oddDetailsHeader'), groups: oddGroups }] : [even]
    };
}

/**
 * The dB axis shared by the Details charts of one measurement: {min, max, step}. It contains 0 and every
 * drawn value and best-possible figure of `tables` (nothing is clamped), is rounded outward to `step` and is at
 * least 10 dB wide.
 */
export function detailsAxis(tables) {
    const values = tables.flatMap(table => table.sections.flatMap(section => section.groups.flatMap(group =>
        group.rows.flatMap(row => row.cells.flatMap(cell => [cell.value, cell.best]))))).filter(Number.isFinite);
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    const step = hi - lo > 40 ? 10 : 5;
    const min = Math.floor(lo / step) * step;
    const max = Math.ceil(hi / step) * step;
    return { min: max - min < 10 ? max - 10 : min, max, step };
}

/** The status line of the Check the correction card: {text, stale}. */
export function checkStatusText(model, t, language) {
    const length = model.recommendedLength;
    if (model.channels.some(entry => hasFit(entry, length) && !entry.checkFig[length])) {
        return { text: t('status:checkStale'), stale: true };
    }
    return {
        text: model.lastCheck
            ? t('status:lastCheckAt', { when: formatMeasuredAt(model.lastCheck.at, language) })
            : t('status:lastCheckInitial'),
        stale: false
    };
}

/** The result list of a Check again run from the result of `runCheckAgain`. */
export function checkResultLines(result, t) {
    const dv = formatDbfs(result.dv);
    const pair = level => t('analysis:levelPair', { before: levelText(level?.[2], t), after: levelText(level?.[3], t) });
    const lines = result.results.map(item => {
        let text;
        if (!item.checked) {
            text = t('message:againOff');
        } else if (!item.accepted) {
            text = t('message:againUndetermined', { dv });
        } else {
            const w = roundHalf(item.v);
            const db = formatDbfs(w < 0 ? -w : w);
            if (w > 1) text = t('warning:againLouder', { db });
            else if (item.v > -1) text = t('message:againSame', { pair: pair(item.level) });
            else {
                text = t('message:againLower', { db, dv, pair: pair(item.level) });
                if (w < -6) text += ` ${t('message:againLowerLarge')}`;
            }
        }
        return t('analysis:againChannel', { ch: channelLabel(item), text });
    });
    const accepted = result.results.filter(item => item.accepted);
    const ws = accepted.map(item => roundHalf(item.v));
    if (ws.length > 1) {
        let lo = ws[0], hi = ws[0];
        for (const w of ws) {
            if (w < lo) lo = w;
            if (w > hi) hi = w;
        }
        if (hi - lo > 1) {
            const items = accepted.map((item, index) =>
                t('analysis:againSpreadItem', { ch: channelLabel(item), db: signedDbfs(ws[index]) })).join(', ');
            lines.push(t('analysis:againSpread', { items, dv }));
        }
    }
    if (accepted.length) lines.push(t('analysis:checkMeasuredAtMic'));
    return lines;
}

// ---------------------------------------------------------------- shared UI helpers

export function element(tag, className = '', text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = text;
    return node;
}

/** The advice to lower the input by `lowerDb`, a lower bound, so rounded up to at least 1 dB. */
export function lowerInputText(lowerDb) {
    return uiText('message:lowerInputBy', { db: Math.max(1, Math.ceil(lowerDb)) });
}

export function button(text, onClick, className = 'secondary-btn') {
    const node = element('button', className, text);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
}

// ---------------------------------------------------------------- bar charts

const seriesClass = series => `series-${series ?? 'neutral'}`;

function decoration(className, style) {
    const node = element('span', className);
    node.setAttribute('aria-hidden', 'true');
    Object.assign(node.style, style);
    return node;
}

/**
 * A bar chart table: the caption holds `head` (optional) and a legend item per series ({series, label, status?}),
 * a hidden tick row of `axis` labelled by `tickText` and, from `x`, `plotCell` and `barLine`, the plot cells of the
 * body rows. The plot runs left to right in every language; a bar starts at 0 and its number sits beside its end.
 */
function barChart(className, head, legendItems, axis, tickText) {
    const x = value => (100 * (value - axis.min)) / (axis.max - axis.min);
    const ticks = [];
    for (let i = 0; axis.min + i * axis.step <= axis.max + axis.step / 1000; i++) ticks.push(axis.min + i * axis.step);
    const plotCell = lines => {
        const cell = element('td', 'speaker-distortion-plot');
        const scale = element('div', 'speaker-distortion-scale');
        scale.append(...ticks.map(value =>
            decoration(`speaker-distortion-gridline${value === 0 ? ' zero' : ''}`, { left: `${x(value)}%` })), ...lines);
        cell.append(scale);
        return cell;
    };
    // `cell` is {text, value, worse}; `label` names the series for screen readers, the colour carries it on screen.
    const barLine = (cell, series, label, warn) => {
        const line = element('div', `speaker-distortion-bar-line ${seriesClass(series)}`);
        const text = element('span', `speaker-distortion-value${cell.worse ? ' worse' : ''}`);
        if (label) text.append(element('span', 'speaker-distortion-sr', `${label}: `));
        text.append(cell.text);
        if (cell.value === null) {
            text.classList.add('missing');
        } else {
            const start = x(0), end = x(cell.value);
            line.append(decoration(`speaker-distortion-bar${warn ? ' up' : ''}`,
                { left: `${start < end ? start : end}%`, width: `${start < end ? end - start : start - end}%` }));
            Object.assign(text.style, cell.value > 0 ? { left: `${end}%` } : { right: `${100 - end}%` });
        }
        line.append(text);
        return line;
    };
    const table = element('table', `speaker-distortion-bars ${className}`);
    const caption = element('caption', '', head);
    const legend = element('span', 'speaker-distortion-legend');
    for (const { series, label, status } of legendItems) {
        const item = element('span', `speaker-distortion-legend-item ${seriesClass(series)}`);
        item.append(element('strong', '', label));
        if (status) item.append(' ', element('span', 'speaker-distortion-column-status', status));
        legend.append(item);
    }
    caption.append(legend);
    table.append(caption, element('thead'));
    const axisRow = element('tr');
    axisRow.setAttribute('aria-hidden', 'true');
    axisRow.append(element('td'), plotCell(ticks.map(value => {
        const tick = element('span', 'speaker-distortion-tick', tickText(value));
        tick.style.left = `${x(value)}%`;
        return tick;
    })));
    table.tHead.append(axisRow);
    return { table, x, plotCell, barLine };
}

/** A body row: its header and a plot cell holding `lines`. */
function chartRow(label, plotCell, lines) {
    const tr = element('tr');
    const th = element('th', '', label);
    th.scope = 'row';
    tr.append(th, plotCell(lines));
    return tr;
}

/**
 * The headline chart of a channel block: per row a bar without and with the correction on the shared percent
 * `axis`, the with bar in the warning colour when it is higher.
 */
function headlineElement(chart, axis) {
    const series = ['before', 'after'];
    const decimals = axis.step >= 1 ? 0 : Math.ceil(-Math.log10(axis.step) - 1e-9);
    const { table, plotCell, barLine } = barChart('speaker-distortion-levels', null,
        chart.series.map((label, index) => ({ series: series[index], label })), axis,
        value => (value === 0 ? '0 %' : value.toFixed(decimals)));
    const body = element('tbody');
    for (const row of chart.rows) {
        body.append(chartRow(row.label, plotCell,
            row.cells.map((cell, index) => barLine(cell, series[index], chart.series[index], cell.worse))));
    }
    table.append(body);
    return table;
}

/** A short message at the bottom of the window (2.6 s). */
export function showToast(text, type = 'info') {
    const node = element('div', `speaker-distortion-toast${type === 'error' ? ' error' : ''}`, text);
    node.setAttribute('role', type === 'error' ? 'alert' : 'status');
    document.body.append(node);
    setTimeout(() => node.remove(), TOAST_MS);
}

// Presentation of the current Check again operation and its most recent result.
let check = { key: null, phase: 'idle', inputs: null, pause: null, message: null, result: null };

/** Aborts a running Check again (leaving the measurement screen). */
export function cancelCheckAgain() {
    const operation = getSpeakerResultOperation();
    if (operation?.kind === 'check') operation.controller.abort();
}

// ---------------------------------------------------------------- panel

/**
 * Renders `#speakerDistortionSection`. `host`: {onChanged(), showDiagnosis(index),
 * audio: {prepare(rateHz, {channels, signal}), play(buffer, settings, signal), release()}}.
 */
export class SpeakerDistortionPanel {
    constructor(section, host) {
        this.section = section;
        this.host = host;
        this.measurement = null;
        // One open state for the Details of every channel, kept for as long as the window is open.
        this.detailsOpen = false;
        this.settingsOpen = false;
        this.rangeUpdatedTimer = null;
        onRefitChange(state => {
            if (state.status === 'done') {
                clearTimeout(this.rangeUpdatedTimer);
                this.rangeUpdatedTimer = setTimeout(clearRefitState, RANGE_UPDATED_MS);
            }
            this.host.onChanged();
        });
    }

    render(measurement) {
        if (!sameMeasurement(measurement, this.measurement)) {
            if (check.phase !== 'running') check = { ...check, key: null, phase: 'idle', message: null, result: null };
        }
        this.measurement = measurement;
        this.section.replaceChildren();
        const model = measurement?.speakerModel;
        if (!model) return;
        const t = uiText;
        const language = uiLanguage();
        const refit = getRefitState();
        const refitting = refit.status === 'running' && sameMeasurement(refit.measurement, measurement);
        const add = (...nodes) => this.section.append(...nodes);

        add(element('h3', 'speaker-distortion-heading', t('title:speakerDistortionCorrection')),
            element('p', 'speaker-distortion-summary', summaryLine(model, t, language)));
        if (model.channels.some(entry => entry.micDistortionWarning)) {
            add(element('p', 'speaker-distortion-warning', t('warning:microphoneDistorted', { advice: this.hotAdvice(model) })));
        }
        for (const text of overloadWarnings(model, t, language)) add(element('p', 'speaker-distortion-warning', text));
        if (refitting) add(element('p', 'speaker-distortion-warning', t('warning:previousUpperLimit')));
        add(element('p', 'speaker-distortion-recommended', recommendedText(model, t, language)),
            element('p', 'speaker-distortion-help', t('help:filterLengthGloss')),
            element('p', 'speaker-distortion-help', t('analysis:bandCaption')));
        // The charts of each kind share one axis across the channels so that the channels compare by eye.
        const charts = new Map(model.channels.map(entry => [entry, headlineChart(entry, model.recommendedLength, t)])
            .filter(([, chart]) => chart));
        const chartAxis = headlineAxis([...charts.values()]);
        const tables = new Map(model.channels.filter(hasDetails).map(entry => [entry, detailsTable(model, entry, t)]));
        const axis = detailsAxis([...tables.values()]);
        const grid = element('div', 'speaker-distortion-grid');
        for (const entry of model.channels) {
            const chart = charts.has(entry) ? headlineElement(charts.get(entry), chartAxis) : null;
            const details = tables.has(entry) ? this.detailsElement(tables.get(entry), axis) : null;
            grid.append(this.channelBlock(model, entry, refitting, chart, details));
        }
        add(grid, element('p', 'speaker-distortion-help', t('analysis:secondOrderCaption')));
        add(this.checkCard(measurement), this.settingsBlock(measurement, refit, refitting), this.copyBlock(measurement));
    }

    hotAdvice(model) {
        return uiText(model.placement === 'inFront' ? 'advice:hotInFront' : 'advice:hotListeningRun');
    }

    channelBlock(model, entry, refitting, chart, details) {
        const t = uiText;
        const length = model.recommendedLength;
        const block = element('div', `speaker-distortion-block${refitting ? ' updating' : ''}`);
        const header = element('div', 'speaker-distortion-block-header');
        const on = isChannelCorrecting(entry, length);
        header.append(element('h4', '', channelLabel(entry)),
            element('span', `speaker-distortion-tag ${on ? 'on' : 'off'}`, t(on ? 'status:correctionOn' : 'status:correctionOff')),
            element('span', 'speaker-distortion-why', whyText(entry, length, t)));
        if (refitting) header.append(element('span', 'speaker-distortion-badge', t('analysis:speakerDistortionBeingUpdated')));
        block.append(header);
        if (chart) block.append(chart);
        const band = bandLimitedText(entry, t);
        if (band) block.append(element('p', 'speaker-distortion-help', band));
        if (!on) {
            block.append(element('p', '', offReasonText(entry, length, t)));
            const hint = onAnywayText(entry, length, t);
            if (hint) block.append(element('p', 'speaker-distortion-help', hint));
        }
        block.append(element('p', '', oddLineText(entry, length, t)));
        if (!on) {
            block.append(button(t('button:seeWhatMeasurementFound', { ch: channelLabel(entry) }),
                () => this.host.showDiagnosis(entry.index), 'speaker-distortion-link'));
        }
        const rattle = LENGTHS.some(item => hasFit(entry, item)) ? rattleSpan(model, entry) : null;
        if (rattle) {
            block.append(element('p', '', t('analysis:rattleFound', { range: formatSpan(rattle.lo, rattle.hi) })));
            if (rattle.lo >= 500 && rattle.lo < model.upperLimitHz) {
                const exclude = button(t('button:excludeRattle', { f: formatHz(rattle.lo) }),
                    () => this.excludeRattle(this.measurement, rattle.lo));
                exclude.disabled = isSpeakerResultBusy();
                block.append(exclude);
            } else if (rattle.lo >= model.upperLimitHz) {
                block.append(element('p', 'speaker-distortion-help', t('analysis:rattleOutside')));
            }
        }
        if (details) block.append(details);
        return block;
    }

    /**
     * The Details of a channel: one chart per section, a row header and one plot cell per row, a bar per cell on
     * the shared dB `axis`, a value above 0 in the warning colour. Opening or closing the Details of one channel
     * opens or closes those of every channel.
     */
    detailsElement(table, axis) {
        const details = element('details', 'speaker-distortion-details');
        details.open = this.detailsOpen;
        details.addEventListener('toggle', () => {
            this.detailsOpen = details.open;
            for (const other of this.section.querySelectorAll('.speaker-distortion-details')) other.open = details.open;
        });
        details.append(element('summary', '', uiText('label:details')));
        const seriesLabel = Object.fromEntries(LENGTHS.map((length, index) => [length, table.columns[index].label]));
        // The legend names the Short / Long colours once, above the first chart.
        const legend = table.columns.map((column, index) => ({ series: LENGTHS[index], ...column }));
        details.append(...table.sections.map((section, index) =>
            this.detailsChart(section, index ? [] : legend, seriesLabel, axis)));
        return details;
    }

    detailsChart(section, legend, seriesLabel, axis) {
        const { table: node, x, plotCell, barLine } = barChart('', section.head, legend, axis,
            value => (value > 0 ? `+${value}` : value < 0 ? `−${-value}` : '0 dB'));
        const bar = cell => barLine(cell, cell.series, cell.series && seriesLabel[cell.series], cell.value > 0);
        // The best-possible note hangs from its marker, a tick at its value on the line below the bar, toward the
        // wider side of the plot.
        const noteLine = cell => {
            const note = element('div', 'speaker-distortion-cell-note', cell.note);
            if (Number.isFinite(cell.best)) {
                const at = x(cell.best);
                note.classList.add('speaker-distortion-best', at < 50 ? 'right' : 'left');
                if (at < 50) note.style.marginLeft = `${at}%`;
                else note.style.marginRight = `${100 - at}%`;
            }
            return note;
        };
        for (const group of section.groups) {
            const body = element('tbody');
            const titleRow = element('tr', 'speaker-distortion-group');
            const title = element('th', '', group.title);
            title.colSpan = 2;
            title.scope = 'colgroup';
            titleRow.append(title);
            body.append(titleRow);
            for (const row of group.rows) {
                body.append(chartRow(row.label, plotCell,
                    row.cells.flatMap(cell => (cell.note ? [bar(cell), noteLine(cell)] : [bar(cell)]))));
            }
            node.append(body);
        }
        return node;
    }

    // ------------------------------------------------------------ Check the correction

    checkCard(measurement) {
        const t = uiText;
        const model = measurement.speakerModel;
        const card = element('div', 'speaker-distortion-card');
        const status = checkStatusText(model, t, uiLanguage());
        const inputs = checkAgainInputs(model);
        const busy = isSpeakerResultBusy();
        const again = button(t('button:checkAgain'), () => this.openCheckAgain(measurement, inputs));
        again.disabled = busy || !inputs.channels.length || check.phase === 'prepare';
        card.append(element('h4', '', t('title:checkCorrection')), element('p', '', status.text), again,
            element('p', 'speaker-distortion-help', t('help:checkAgain')));
        const current = sameMeasurement(check.key, measurement);
        if (current && check.phase === 'prepare') {
            const box = element('div', 'speaker-distortion-box');
            const placement = t(model.placement === 'inFront' ? 'message:checkAgainPlaceInFront'
                : 'message:checkAgainPlaceListening');
            const start = button(t('button:startCheck'), () => this.runCheck(measurement), 'primary-btn');
            start.disabled = busy;
            box.append(element('p', '', t('message:checkAgainPrepare', { placement })),
                element('p', 'speaker-distortion-help', t('help:checkAgainOrder')),
                this.buttonRow(start, button(t('button:cancel'), () => this.setCheck({ phase: 'idle' }))));
            card.append(box);
        }
        if (current && check.phase === 'running') {
            const labels = model.channels.filter(entry => check.inputs.channels.includes(entry.index)).map(channelLabel);
            card.append(element('p', 'speaker-distortion-progress',
                t('status:checking', { channels: listText(labels, uiLanguage()) })));
            if (check.pause) card.append(this.checkPauseBox(model, check.pause));
            else card.append(this.buttonRow(button(t('button:cancel'), cancelCheckAgain)));
        }
        if (current && check.message) card.append(element('p', check.message.className, check.message.text));
        if (current && check.result && !status.stale && check.result.upperLimitHz === model.upperLimitHz) {
            const list = element('ul', 'speaker-distortion-check-results');
            for (const line of check.result.lines) list.append(element('li', '', line));
            card.append(list);
        }
        return card;
    }

    checkPauseBox(model, pause) {
        const t = uiText;
        const ch = channelLabel(pause.entry);
        const box = element('div', 'speaker-distortion-box');
        const resume = key => button(t(key, { ch }), () => {
            this.setCheck({ pause: null });
            pause.resolve();
        }, 'primary-btn');
        if (pause.kind === 'checkTarget') {
            box.append(element('p', '', t('message:checkTargetChannel', { ch })), this.buttonRow(
                resume('button:startCheckingChannel'), button(t('button:cancel'), cancelCheckAgain)));
        } else {
            const texts = pause.kind === 'checkLevelOverload'
                ? [t('warning:checkLevelOverload', { advice: this.hotAdvice(model) }), lowerInputText(pause.lowerDb)]
                : [t('warning:levelCheckQuiet')];
            box.append(...texts.map(text => element('p', 'speaker-distortion-warning', text)), this.buttonRow(
                resume('button:checkLevelAgain'), button(t('button:cancel'), cancelCheckAgain)));
        }
        return box;
    }

    buttonRow(...buttons) {
        const row = element('div', 'speaker-distortion-buttons');
        row.append(...buttons);
        return row;
    }

    setCheck(changes) {
        check = { ...check, ...changes };
        this.host.onChanged();
    }

    /**
     * Opens the preparation box for `inputs` = {channels, oddChannels, configurations, length, currentDv}
     *; channels the measurement does not have are dropped with their configurations.
     */
    openCheckAgain(measurement, inputs) {
        if (isSpeakerResultBusy()) return;
        const indices = measurement.speakerModel.channels.map(entry => entry.index);
        const known = index => indices.includes(index);
        const { channels, oddChannels = [], configurations = [] } = inputs;
        this.setCheck({ key: measurement, phase: 'prepare', message: null, result: null,
            inputs: { ...inputs, channels: channels.filter(known), oddChannels: oddChannels.filter(known),
                configurations: configurations.filter((_, i) => known(channels[i])) } });
    }

    async runCheck(measurement) {
        if (check.phase !== 'prepare' || !sameMeasurement(check.key, measurement)) return;
        const inputs = check.inputs;
        const operation = startSpeakerResultOperation('check', measurement, signal => this.performCheck(measurement, inputs, signal));
        if (!operation) return;
        this.setCheck({ phase: 'running', pause: null, message: null, result: null });
        try {
            await operation.completion;
        } finally {
            this.setCheck({ phase: 'idle', pause: null });
        }
    }

    async performCheck(measurement, inputs, signal) {
        const model = measurement.speakerModel;
        const message = (key, className = '') => ({ text: uiText(key), className });
        try {
            signal.throwIfAborted();
            const entries = model.channels.filter(entry => inputs.channels.includes(entry.index));
            const rateHz = entries[0]?.rateHz;
            if (!rateHz || entries.some(entry => entry.rateHz !== rateHz)) {
                throw new Error('The checked channels must use the same sample rate.');
            }
            await this.host.audio.prepare(rateHz, { channels: inputs.channels, signal });
            signal.throwIfAborted();
            const result = await runCheckAgain({
                model,
                ...inputs,
                play: (buffer, settings, stopWhen) => this.host.audio.play(buffer, settings, signal, stopWhen),
                pause: (kind, info) => new Promise(resolve => this.setCheck({ pause: { ...info, kind, resolve } })),
                signal
            });
            signal.throwIfAborted();
            if (measurement.id) {
                if (!dataStorage.getMeasurementById(measurement.id)) {
                    check.message = message('message:speakerDistortionMeasurementMissing', 'speaker-distortion-error');
                    return;
                }
                if (!await dataStorage.updateMeasurement(measurement.id, { speakerModel: result.model })) {
                    console.error('The checked speaker model could not be written to storage.');
                    check.message = message('error:speakerDistortionSaveFailed', 'speaker-distortion-error');
                    return;
                }
            } else {
                measurement.speakerModel = result.model;
            }
            check.result = { lines: checkResultLines(result, uiText), upperLimitHz: result.model.upperLimitHz };
        } catch (error) {
            if (signal.aborted) {
                check.message = message('message:checkCancelled');
            } else {
                console.error('Check again failed:', error);
                check.message = message(error?.kind === 'analysis' ? 'error:speakerDistortionAnalysisFailed'
                    : 'error:speakerDistortionPlaybackFailed', 'speaker-distortion-error');
            }
        } finally {
            await this.host.audio.release();
        }
    }

    // ------------------------------------------------------------ Correction settings

    settingsBlock(measurement, refit, refitting) {
        const t = uiText;
        const model = measurement.speakerModel;
        const details = element('details', 'speaker-distortion-settings');
        details.open = this.settingsOpen || refitting;
        details.addEventListener('toggle', () => { this.settingsOpen = details.open; });
        details.append(element('summary', '', t('title:correctionSettings')));
        const row = element('div', 'speaker-distortion-limit');
        const label = element('label', '', t('label:upperLimit'));
        const input = element('input');
        input.type = 'number';
        input.min = '500';
        input.max = '8000';
        input.step = '1';
        input.id = 'speakerDistortionUpperLimit';
        input.value = String(refitting ? refit.upperLimitHz : model.upperLimitHz);
        label.htmlFor = input.id;
        const update = button(t('button:updateResult'), () => startRefit(measurement, Number(input.value)), 'primary-btn');
        const rangeError = element('p', 'speaker-distortion-error', t('error:upperLimitRange'));
        const validate = () => {
            const value = Number(input.value);
            const valid = input.value.trim() !== '' && isValidUpperLimit(value);
            rangeError.hidden = valid || input.value.trim() === '';
            update.disabled = !valid || value === model.upperLimitHz || isSpeakerResultBusy();
        };
        input.addEventListener('input', validate);
        validate();
        row.append(label, input, update);
        details.append(row, rangeError, element('p', 'speaker-distortion-help', t('help:upperLimit')));
        if (sameMeasurement(refit.measurement, measurement)) details.append(this.refitStatus(model, refit));
        return details;
    }

    refitStatus(model, refit) {
        const t = uiText;
        const box = element('div', 'speaker-distortion-refit');
        if (refit.status === 'running') {
            box.append(element('p', 'speaker-distortion-progress', t('status:updatingUpperLimit')));
            const list = element('ul', 'speaker-distortion-rows');
            refit.progress.forEach((row, index) => {
                const text = row.status === 'done' ? t('status:done') : row.status === 'percent'
                    ? t('status:speakerDistortionPercent', { n: Math.floor(row.fraction * 100) }) : t('status:waiting');
                const item = element('li');
                item.append(element('span', '', channelLabel(model.channels[index])), element('span', '', text));
                list.append(item);
            });
            box.append(list, this.buttonRow(button(t('button:cancel'), cancelRefit)));
        } else {
            const key = { done: 'message:rangeUpdated', cancelled: 'message:speakerDistortionUpdateCancelled',
                failed: 'message:speakerDistortionUpdateFailed', saveFailed: 'error:speakerDistortionSaveFailed' }[refit.status];
            const error = refit.status === 'failed' || refit.status === 'saveFailed';
            if (key) box.append(element('p', error ? 'speaker-distortion-error' : '', t(key)));
        }
        return box;
    }

    /** `button:excludeRattle`: Upper Limit = the rattle start rounded to whole hertz, then refit. */
    excludeRattle(measurement, hz) {
        this.settingsOpen = true;
        return startRefit(measurement, Math.round(hz));
    }

    // ------------------------------------------------------------ Copy

    copyBlock(measurement) {
        const t = uiText;
        const box = element('div', 'speaker-distortion-copy');
        if (!isCorrecting(measurement.speakerModel)) {
            box.append(element('p', 'speaker-distortion-help', t('help:nothingToCorrect')));
            return box;
        }
        const copy = button(t('button:copySpeakerDistortionCorrection'), async () => {
            try {
                const copied = await copyTextToClipboard(buildSpeakerDistortionCopyPayload(measurement, uiLanguage()));
                showToast(t(copied ? 'message:copied' : 'error:speakerDistortionCopyFailed'), copied ? 'info' : 'error');
            } catch (error) {
                console.error('The Distortion Correction settings could not be copied:', error);
                showToast(t('error:speakerDistortionCopyFailed'), 'error');
            }
        }, 'primary-btn');
        const saved = Number.isFinite(measurement.savedAt);
        const busy = isSpeakerResultBusy();
        copy.disabled = !saved || busy;
        box.append(copy);
        if (!saved) box.append(element('p', 'speaker-distortion-help', t('help:copySaveFirst')));
        else if (busy) box.append(element('p', 'speaker-distortion-help', t('message:speakerDistortionWaitForUpdate')));
        box.append(element('p', 'speaker-distortion-help', t('help:howToUse')));
        return box;
    }
}
