// Shared distortion chart renderer of the Distortion Diagnosis tab and the
// Distortion Correction plugin. It groups the stored 1/6-octave band
// sums into display bands, converts them to dB and draws them as SVG. Every
// text comes from the caller; the draw functions and emphasizeChartLegend are
// the only DOM code.
import {
    N_BANDS,
    REF_ODD,
    REF_ODD_VAR,
    REF_VAR,
    REF_X,
    SCALE_MEASURED
} from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MARGIN = { left: 44, right: 12, top: 24, bottom: 40 };
// Tick values are 12 px in both presentations, as in the measurement window's other graphs and the effect graphs.
const TICK_FONT = 12;
const TITLE_FONT = 12;
// The inset presentation (the effect's graph) follows the app's full-canvas effect graphs (Tilt EQ, Tone Control):
// the plot fills the box, and the tick values and axis titles lie over it at the left and bottom.
const INSET_TITLE_FONT = 14;
// Nearest a curve of the inset comes to the top or bottom edge before the range grows by a 10 dB step.
const INSET_CURVE_CLEARANCE = 1;
const X_TICKS = [[20, '20'], [50, '50'], [100, '100'], [200, '200'], [500, '500'],
    [1000, '1k'], [2000, '2k'], [5000, '5k'], [10000, '10k']];
const DISTORTION_Y_TICKS = [-10, -20, -30, -40, -50, -60, -70, -80];
/** Axis ranges of the distortion chart (Hz, dB re X). */
export const DISTORTION_FRAME = Object.freeze({ xMin: 20, xMax: 10000, yMin: -80, yMax: -5 });
const RESOLUTION_SIZES = { sixth: 1, third: 2, octave: 6 };

const SET_TOKENS = { L: '--sdc-l0', 'L-6': '--sdc-l6', 'L-12': '--sdc-l12', peaks: '--sdc-pk' };

// Gap between the lines of a wrapped note or axis title.
const LINE_GAP = 3;
// Characters set solid, without spaces between words: a line may break after any of them.
const SOLID = '\\u3000-\\u30FF\\u3400-\\u9FFF\\uF900-\\uFAFF\\uFF00-\\uFF60';
// Line-break units: spaces, one solid character with a closing mark that must not start a line, or a word.
const BREAK_UNITS = new RegExp(`\\s+|[${SOLID}][、。，）」]?|[^\\s${SOLID}]+`, 'gu');
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠]/u;

const WIDTH_EMPH = 2.4;
const WIDTH_OTHER = 1.3;
const DOTTED_EXTRA = 0.6;
const FILL_OPACITY = 0.14;
export const LIMIT_OPACITY = 0.15;

// Both host pages define every --sdc-* colour from the theme tokens.
const color = token => `var(${token})`;
const round = value => Math.round(value * 100) / 100;
const db = (numerator, denominator) => 10 * Math.log10(numerator / denominator);
const minusSign = value => String(value).replace('-', '−');

/** Display bands: groups of adjacent chart bands with their edges and geometric centre. */
export function chartBands(bands, resolution) {
    const size = RESOLUTION_SIZES[resolution];
    const groups = [];
    for (let start = 0; start < N_BANDS; start += size) {
        groups.push(Array.from({ length: (start + size > N_BANDS ? N_BANDS : start + size) - start },
            (_, i) => start + i));
    }
    const lo = groups.map(group => bands[group[0]]);
    const hi = groups.map(group => bands[group[group.length - 1] + 1]);
    return { groups, lo, hi, fc: lo.map((value, k) => Math.sqrt(value * hi[k])) };
}

function sumOver(group, values, offset) {
    let sum = 0;
    for (const i of group) sum += values[offset + i];
    return sum;
}

// Per display band: {x, lo, hi, y} when the value is drawn, null otherwise.
function series(display, value) {
    return display.groups.map((group, k) => {
        const y = value(group, k);
        return y === null ? null : { x: display.fc[k], lo: display.lo[k], hi: display.hi[k], y };
    });
}

const isDrawn = points => points.some(point => point !== null);

// The sums of one record set that the display test and the values use.
function setSums(channel, length, set, display) {
    const ref = channel.ref[set];
    const powers = channel.power[length][set];
    return display.groups.map(group => {
        const x = sumOver(group, ref, REF_X);
        const limit = 2 * Math.sqrt(sumOver(group, ref, REF_VAR));
        const oddLimit = 2 * Math.sqrt(sumOver(group, ref, REF_ODD_VAR));
        return {
            x, limit, oddLimit,
            odd: sumOver(group, ref, REF_ODD),
            power: scale => (powers[scale] ? sumOver(group, powers[scale], 0) : NaN)
        };
    });
}

// Band value when `power` passes the display test against `limit`, else null; X = 0 is a gap.
function tested(power, x, limit) {
    return x > 0 && power > limit ? db(power, x) : null;
}

// The uncorrected value of a band: even (power at the measured scale) or odd order.
const measuredValue = (band, odd) => (odd ? tested(band.odd, band.x, band.oddLimit)
    : tested(band.power(SCALE_MEASURED), band.x, band.limit));

/** Uncorrected even-order distortion at the set Signal Level: [[centre Hz, dB re X or null]] per display band. */
export function measuredDistortionCurve(channel, length, bands, resolution) {
    const display = chartBands(bands, resolution);
    return setSums(channel, length, 'L', display).map((band, k) => [display.fc[k], measuredValue(band, false)]);
}

function distortionItems(spec) {
    const display = chartBands(spec.bands, spec.resolution);
    const texts = spec.texts;
    const odd = spec.parity === 'odd';
    const scale = odd ? null : spec.scale ?? null;
    const scaleSets = spec.scaleSets ?? spec.sets;
    const check = !odd && scale !== null && spec.check ? spec.check : null;
    const wouldScale = odd ? null : spec.wouldScale ?? null;
    const setName = set => texts.setNames?.[set] ?? set;
    const width = set => (set === spec.emph ? WIDTH_EMPH : WIDTH_OTHER);

    const measuredOf = sums => series(display, (group, k) => measuredValue(sums[k], odd));

    const perSet = spec.sets.map(set => {
        const sums = setSums(spec.channel, spec.length, set, display);
        const measured = measuredOf(sums);
        const afterMeasured = (k, value) => (measured[k] === null ? null : value);
        const atScale = s => series(display, (group, k) =>
            afterMeasured(k, tested(sums[k].power(s), sums[k].x, sums[k].limit)));
        let corrected = null;
        let isCheck = false;
        // The noise floor that tests the corrected value of a band: the check has its own.
        let correctedBands = sums;
        if (scale !== null && scaleSets.includes(set)) {
            isCheck = check !== null && set === spec.emph;
            if (isCheck) {
                correctedBands = display.groups.map(group => ({
                    x: sumOver(group, check, N_BANDS), limit: 2 * Math.sqrt(sumOver(group, check, 2 * N_BANDS))
                }));
                corrected = series(display, (group, k) => afterMeasured(k, tested(sumOver(group, check, 0),
                    correctedBands[k].x, correctedBands[k].limit)));
            } else {
                corrected = atScale(scale);
            }
        }
        return {
            set, sums, measured, corrected, correctedBands, isCheck,
            would: set === spec.emph && wouldScale !== null ? atScale(wouldScale) : null,
            oddOverlay: !odd && spec.showOdd ? series(display, (group, k) =>
                tested(sums[k].odd, sums[k].x, sums[k].oddLimit)) : null,
            compared: spec.compare
                ? measuredOf(setSums(spec.compare.channel, spec.compare.length, set, display))
                : null
        };
    });
    const emph = perSet.find(entry => entry.set === spec.emph);
    const floorDb = (x, limit) => {
        if (!(x > 0)) return null;
        const value = db(limit, x);
        return Number.isNaN(value) ? null : value;
    };
    const limitDb = k => floorDb(emph.sums[k].x, odd ? emph.sums[k].oddLimit : emph.sums[k].limit);

    const allBelowWith = perSet.some(entry => entry.corrected)
        && !perSet.some(entry => entry.corrected && isDrawn(entry.corrected));
    // Where the correction brings a band of the emphasized set below the noise floor, its curve follows that floor
    // (the value is at most that), so the curve stays continuous instead of vanishing. A floor at or above the
    // measured value tells nothing and leaves a gap.
    if (emph.corrected) {
        emph.corrected = emph.measured.map((point, k) => {
            if (point === null || emph.corrected[k] !== null) return emph.corrected[k];
            const floor = floorDb(emph.correctedBands[k].x, emph.correctedBands[k].limit);
            return floor !== null && floor < point.y ? { ...point, y: floor } : null;
        });
    }

    const items = [];
    const curve = (points, token, width, dash = null) => items.push({ kind: 'curve', points, color: token, width, dash });

    items.push({
        kind: 'area', color: '--sdc-lim', opacity: LIMIT_OPACITY,
        points: display.groups.map((group, k) => {
            const top = limitDb(k);
            return top === null ? null : { x: display.fc[k], lo: display.lo[k], hi: display.hi[k], top, bottom: -Infinity };
        })
    });
    // The shaded change of each level with a corrected curve: the emphasized level's is drawn, the others' are kept
    // for a legend hover on their level (emphasizeChartLegend).
    for (const entry of [emph, ...perSet.filter(other => other !== emph)]) {
        if (!entry.corrected) continue;
        items.push({
            kind: 'area', set: entry.set, hoverOnly: entry !== emph, color: SET_TOKENS[entry.set],
            opacity: FILL_OPACITY,
            points: entry.measured.map((point, k) => (entry.corrected[k] === null ? null : {
                x: point.x, lo: point.lo, hi: point.hi, top: point.y, bottom: entry.corrected[k].y
            }))
        });
    }
    for (const entry of perSet) {
        if (entry.compared) curve(entry.compared, SET_TOKENS[entry.set], WIDTH_OTHER, '5 4');
    }
    if (emph.would) curve(emph.would, '--sdc-would', 1.6, '6 4');
    for (const entry of perSet) {
        if (entry.oddOverlay) curve(entry.oddOverlay, '--sdc-odd', WIDTH_OTHER, '1 3');
    }
    for (const entry of [...perSet.filter(entry => entry !== emph), emph]) {
        curve(entry.measured, SET_TOKENS[entry.set], width(entry.set));
    }
    for (const entry of perSet) {
        if (entry.corrected && !entry.isCheck) {
            curve(entry.corrected, SET_TOKENS[entry.set], width(entry.set) + DOTTED_EXTRA, '2 3');
        }
    }
    if (emph.isCheck) curve(emph.corrected, SET_TOKENS[emph.set], WIDTH_EMPH, '7 4');
    if (Number.isFinite(spec.upperLimitHz)) {
        items.push({ kind: 'vline', x: spec.upperLimitHz, color: '--sdc-range', width: 1, dash: '4 4',
            label: texts.upperLimitLabel });
    }

    // `points` (optional) is the series a legend entry names, for a value readout; `set` (optional) the level whose
    // curve it names.
    const legend = (text, token, lineWidth, dash = null, points = null, set = null) => items.push({ kind: 'legend',
        text, color: token, width: lineWidth, dash, points, set });
    for (const entry of perSet) {
        if (!isDrawn(entry.measured)) continue;
        legend((odd ? texts.legendOddMeasured : texts.legendMeasured).replace('{set}', setName(entry.set)),
            SET_TOKENS[entry.set], width(entry.set), null, entry.measured, entry.set);
    }
    const legendCorrected = entry => (entry.isCheck
        ? legend(texts.legendCheck, SET_TOKENS[entry.set], WIDTH_EMPH, '7 4', entry.corrected, entry.set)
        : legend(texts.legendPredicted.replace('{set}', setName(entry.set)), SET_TOKENS[entry.set],
            width(entry.set) + DOTTED_EXTRA, '2 3', entry.corrected, entry.set));
    const withCorrected = perSet.filter(entry => entry.corrected && isDrawn(entry.corrected));
    if (texts.legendPredictedOther) {
        if (withCorrected.includes(emph)) legendCorrected(emph);
        if (withCorrected.some(entry => entry !== emph)) {
            legend(texts.legendPredictedOther, '--sdc-would', WIDTH_OTHER + DOTTED_EXTRA, '2 3');
        }
    } else {
        withCorrected.forEach(legendCorrected);
    }
    if (emph.would && isDrawn(emph.would)) legend(texts.legendWould, '--sdc-would', 1.6, '6 4', emph.would);
    const oddShown = perSet.filter(entry => entry.oddOverlay && isDrawn(entry.oddOverlay));
    if (oddShown.length) {
        legend(texts.legendOddOverlay, '--sdc-odd', WIDTH_OTHER, '1 3',
            (oddShown.includes(emph) ? emph : oddShown[0]).oddOverlay);
    }
    if (perSet.some(entry => entry.compared && isDrawn(entry.compared))) {
        legend(texts.legendCompared.replace('{name}', texts.comparedName ?? ''), SET_TOKENS[emph.set],
            WIDTH_OTHER, '5 4');
    }
    items.push({ kind: 'legend', text: texts.legendLimit, color: '--sdc-lim', opacity: LIMIT_OPACITY, square: true,
        points: items[0].points });

    let note = null;
    if (odd) note = texts.noteOdd;
    else if (!perSet.some(entry => isDrawn(entry.measured))) note = texts.noteAllBelow;
    else if (allBelowWith) note = texts.noteAllBelowWith;
    if (note) items.push({ kind: 'note', text: note });
    return items;
}

// Splits points at nulls; a single point becomes a segment across its band.
function runs(points, toPixel) {
    const result = [];
    let current = [];
    const flush = () => {
        if (current.length === 1 && Number.isFinite(current[0].lo)) {
            const [point] = current;
            current = [{ ...point, x: point.lo }, { ...point, x: point.hi }];
        }
        if (current.length) result.push(current.map(toPixel));
        current = [];
    };
    for (const point of points) {
        if (point === null) flush();
        else current.push(point);
    }
    flush();
    return result;
}

const pointList = pairs => pairs.map(([x, y]) => `${x},${y}`).join(' ');

function strokeStyle(item) {
    return {
        fill: 'none',
        stroke: color(item.color),
        'stroke-width': item.width,
        ...(item.dash ? { 'stroke-dasharray': item.dash } : {})
    };
}

// Swatch of a legend entry in GraphReadout's legend: short dashes read as dots.
const swatchOf = item => (item.square ? 'fill' : item.dash ? (parseFloat(item.dash) <= 2 ? 'dotted' : 'dashed') : null);

// Width of a text where no canvas measures it (the Node tests): wide characters a full em, others 0.6 em.
function estimateTextWidth(text, size) {
    let ems = 0;
    for (const char of text) ems += WIDE.test(char) ? 1 : 0.6;
    return ems * size;
}

// Text width measured with the font the SVG's text inherits, or the estimate without a real document. The canvas
// is made on the first measurement.
function textWidthIn(svg) {
    const document = svg.ownerDocument;
    if (!document.createElement) return estimateTextWidth;
    let context = null;
    let family = '';
    return (text, size) => {
        if (!context) {
            context = document.createElement('canvas').getContext('2d');
            family = document.defaultView.getComputedStyle(svg).fontFamily || 'sans-serif';
        }
        context.font = `${size}px ${family}`;
        return context.measureText(text).width;
    };
}

// Lines of `text` no wider than `maxWidth`; a single word wider than that keeps a line of its own.
function wrapText(text, size, maxWidth, textWidth) {
    const lines = [];
    let line = '';
    for (const unit of text.match(BREAK_UNITS) ?? []) {
        if (line && textWidth((line + unit).trimEnd(), size) > maxWidth) {
            lines.push(line.trimEnd());
            line = unit.trimStart();
        } else {
            line += unit;
        }
    }
    if (line.trim()) lines.push(line.trimEnd());
    return lines;
}

/**
 * Pure layout of a log-frequency chart of `frame.width` x `frame.height`:
 * `frame` sets the axes, `items` the curves, areas, reference lines, markers,
 * legend entries and the note. Returns the SVG elements to write, in drawing
 * order, in chart coordinates, the plot rectangle and the legend entries,
 * which the host shows through GraphReadout. An `inset` frame is the plot
 * itself, with the tick values (each only where it fits whole, clear of the
 * titles) and the axis titles drawn over it. For a value readout,
 * `frequencyAt` and `yPixel` map chart coordinates, `formatValue` (optional,
 * from the frame) writes a value and a legend entry's `trace` holds its drawn
 * runs as {xs: chart x, ys: dB}. Outside the inset, the y tick labels
 * (`frame.yTickLabel`, optional) widen the left margin as needed, and the note
 * and the y-axis title wrap to the lines that fit (`textWidth(text, size)`
 * measures them); the added lines take their room from the plot. An area item
 * with `hoverOnly` is not drawn: its polygons go to `levelAreas[item.set]`
 * for emphasizeChartLegend.
 */
function layoutLogFrequencyChart(frame, items, textWidth = estimateTextWidth) {
    const inset = Boolean(frame.inset);
    const { width, height } = frame;
    const tickFont = TICK_FONT;
    const tickLabel = frame.yTickLabel ?? minusSign;
    const note = items.findLast(item => item.kind === 'note')?.text ?? null;
    let margin = { left: 0, right: 0, top: 0, bottom: 0 };
    let noteLines = note ? [note] : [];
    let yTitleLines = [];
    if (!inset) {
        const labelWidth = Math.max(...frame.yTicks.map(v => textWidth(tickLabel(v), tickFont)));
        // The y-axis title is centred on the plot, so it may reach into the top margin when the note takes room.
        yTitleLines = wrapText(frame.yTitle ?? '', TITLE_FONT, height - MARGIN.top - MARGIN.bottom, textWidth);
        // The tick labels end 4 px left of the plot, clear of a single-line title 18 px wide.
        const left = (labelWidth + 22 > MARGIN.left ? Math.ceil(labelWidth + 22) : MARGIN.left)
            + (yTitleLines.length > 1 ? (yTitleLines.length - 1) * (TITLE_FONT + LINE_GAP) : 0);
        noteLines = note ? wrapText(note, tickFont, width - left - MARGIN.right, textWidth) : [];
        const top = MARGIN.top + (noteLines.length > 1 ? (noteLines.length - 1) * (tickFont + LINE_GAP) : 0);
        margin = { ...MARGIN, left, top };
    }
    const left = margin.left;
    const right = width - margin.right;
    const top = margin.top;
    const bottom = height - margin.bottom;
    const logSpan = Math.log10(frame.xMax / frame.xMin);
    const xPixel = f => round(left + Math.log10(f / frame.xMin) / logSpan * (right - left));
    // Values are not clamped: the SVG clips the data to the plot, so a value out of range leaves through the
    // border. An unbounded value (an area to the edge, a floor of zero power) lies one plot height beyond it.
    const span = bottom - top;
    const yPixel = v => (v === Infinity ? top - span : v === -Infinity ? bottom + span
        : round(top + (frame.yMax - v) / (frame.yMax - frame.yMin) * span));
    const textStyle = { fill: color('--sdc-text') };
    const elements = [];
    const add = (tag, attrs, style, extra = {}) => elements.push({ tag, attrs, style, ...extra });
    // Data drawn only inside the plot rectangle (`clip`); axes, labels and the note are not clipped.
    const addData = (tag, attrs, style, role) => add(tag, attrs, style, { role, clip: true });
    const text = (x, y, value, size, anchor, style = textStyle, role = 'text') =>
        add('text', { x: round(x), y: round(y), 'font-size': size, 'text-anchor': anchor }, style, { text: value, role });
    const gridStyle = { stroke: color('--sdc-grid'), 'stroke-width': 1 };

    // Inset, the x labels run along the bottom of the plot and the y labels end 48 px from its left edge, where the
    // full-canvas effect graphs put them; a label is drawn only whole inside the box and clear of the titles.
    const xLabelY = inset ? height - 24 : bottom + 14;
    // The box of a text line of `size` at baseline `y`, from its left edge `x0`.
    const textBox = (x0, y, w, size) => ({ x0, x1: x0 + w, y0: y - size * 0.75, y1: y + size * 0.25 });
    // Inset, the boxes the tick labels must keep clear of, starting with the axis titles'.
    const taken = [];
    if (inset) {
        const xTitleWidth = textWidth(frame.xTitle ?? '', INSET_TITLE_FONT);
        const yTitleWidth = textWidth(frame.yTitle ?? '', INSET_TITLE_FONT);
        // Rotated, the y title's ascent lies left of its baseline at x = 14.
        taken.push(textBox(width / 2 - xTitleWidth / 2, height - 5, xTitleWidth, INSET_TITLE_FONT), {
            x0: 14 - INSET_TITLE_FONT * 0.75, x1: 14 + INSET_TITLE_FONT * 0.25,
            y0: height / 2 - yTitleWidth / 2, y1: height / 2 + yTitleWidth / 2
        });
    }
    const fits = box => box.x0 >= 0 && box.x1 <= width && box.y0 >= 0 && box.y1 <= height
        && !taken.some(other => box.x0 < other.x1 && other.x0 < box.x1 && box.y0 < other.y1 && other.y0 < box.y1);
    const tick = (x, y, label, anchor) => {
        if (inset) {
            const w = textWidth(label, tickFont);
            const box = textBox(anchor === 'middle' ? x - w / 2 : x - w, y, w, tickFont);
            if (!fits(box)) return;
            taken.push(box);
        }
        text(x, y, label, tickFont, anchor);
    };
    // Inset, the plot's edges are the box's: a grid line on one would read as a border, so it is left out.
    const gridAt = (position, start, end) => !inset || (position > start && position < end);
    for (const [f, label] of frame.xTicks ?? X_TICKS) {
        if (f < frame.xMin || f > frame.xMax) continue;
        if (gridAt(xPixel(f), left, right)) {
            add('line', { x1: xPixel(f), y1: top, x2: xPixel(f), y2: bottom }, gridStyle, { role: 'grid' });
        }
        tick(xPixel(f), xLabelY, label, 'middle');
    }
    for (const v of frame.yTicks) {
        if (gridAt(yPixel(v), top, bottom)) {
            add('line', { x1: left, y1: yPixel(v), x2: right, y2: yPixel(v) }, gridStyle, { role: 'grid' });
        }
        tick(inset ? 48 : left - 4, yPixel(v) + 4, tickLabel(v), 'end');
    }
    if (inset) {
        const titleStyle = { fill: color('--sdc-title') };
        text(width / 2, height - 5, frame.xTitle ?? '', INSET_TITLE_FONT, 'middle', titleStyle);
        add('text', { x: 0, y: 0, 'font-size': INSET_TITLE_FONT, 'text-anchor': 'middle',
            transform: `translate(14 ${round(height / 2)}) rotate(-90)` }, titleStyle,
        { text: frame.yTitle ?? '', role: 'text' });
    } else {
        text((left + right) / 2, bottom + 32, frame.xTitle ?? '', TITLE_FONT, 'middle');
        // Rotated, the first line of the y-axis title is the leftmost.
        yTitleLines.forEach((line, i) => add('text', { x: 0, y: 0, 'font-size': TITLE_FONT, 'text-anchor': 'middle',
            transform: `translate(${12 + i * (TITLE_FONT + LINE_GAP)} ${round((top + bottom) / 2)}) rotate(-90)` },
        textStyle, { text: line, role: 'text' }));
    }

    const legend = [];
    const levelAreas = {};
    let extent = null;
    for (const item of items) {
        if (item.kind === 'curve') {
            for (const point of item.points) {
                if (!Number.isFinite(point?.y)) continue;
                const lo = point.lo ?? point.x, hi = point.hi ?? point.x;
                if (!extent) extent = { xMin: lo, xMax: hi, yMin: point.y, yMax: point.y };
                if (lo < extent.xMin) extent.xMin = lo;
                if (hi > extent.xMax) extent.xMax = hi;
                if (point.y < extent.yMin) extent.yMin = point.y;
                if (point.y > extent.yMax) extent.yMax = point.y;
            }
            for (const run of runs(item.points, point => [xPixel(point.x), yPixel(point.y)])) {
                addData('polyline', { points: pointList(run) }, strokeStyle(item), 'curve');
            }
        } else if (item.kind === 'area') {
            const polygons = runs(item.points, point => [xPixel(point.x), yPixel(point.top), yPixel(point.bottom)])
                .map(run => ({
                    tag: 'polygon',
                    attrs: { points: pointList([...run.map(([x, y]) => [x, y]), ...run.reverse().map(([x, , y]) => [x, y])]) },
                    style: { fill: color(item.color), 'fill-opacity': item.opacity, stroke: 'none' },
                    role: 'area', clip: true, set: item.set ?? null
                }));
            if (item.hoverOnly) levelAreas[item.set] = polygons;
            else elements.push(...polygons);
        } else if (item.kind === 'hline') {
            addData('line', { x1: left, y1: yPixel(item.y), x2: right, y2: yPixel(item.y) },
                strokeStyle({ color: '--sdc-grid', width: 1, ...item }), 'hline');
        } else if (item.kind === 'vline') {
            if (!(item.x >= frame.xMin && item.x <= frame.xMax)) continue;
            const x = xPixel(item.x);
            addData('line', { x1: x, y1: top, x2: x, y2: bottom }, strokeStyle(item), 'vline');
            // The label sits low, clear of the legend at the top right.
            if (item.label) {
                text(x - 4, inset ? xLabelY - tickFont - 4 : bottom - 6, item.label, tickFont, 'end',
                    { fill: color(item.color) }, 'vlineLabel');
            }
        } else if (item.kind === 'legend') {
            legend.push({
                text: item.text,
                square: Boolean(item.square),
                style: item.square
                    ? { fill: color(item.color), 'fill-opacity': item.opacity, stroke: 'none' }
                    : strokeStyle(item),
                color: item.color,
                swatch: swatchOf(item),
                set: item.set ?? null,
                trace: item.points ? runs(item.points, point => [xPixel(point.x), point.y ?? point.top])
                    .map(run => ({ xs: run.map(([x]) => x), ys: run.map(([, y]) => y) })) : null
            });
        }
    }

    // Inset, the note sits at the top, right of the y tick labels; outside it, above the plot, its last line where a
    // single line would be.
    const noteTop = inset ? top + 16 : top - 8 - (noteLines.length - 1) * (tickFont + LINE_GAP);
    noteLines.forEach((line, i) => text(inset ? 56 : left, noteTop + i * (tickFont + LINE_GAP), line,
        tickFont, 'start', textStyle, 'note'));
    return {
        width, height, inset, elements, legend, levelAreas, extent, yPixel, formatValue: frame.formatValue ?? null,
        plot: { left, top, width: right - left, height: bottom - top },
        frequencyAt: x => frame.xMin * 10 ** ((x - left) / (right - left) * logSpan)
    };
}

/** Pure description of a distortion chart (no DOM); `textWidth` measures the texts that wrap. */
export function buildDistortionChart(spec, textWidth = estimateTextWidth) {
    const texts = spec.texts;
    const items = distortionItems(spec);
    let { yMin, yMax } = DISTORTION_FRAME;
    let yTicks = DISTORTION_Y_TICKS;
    // The inset plot fills its box, so no curve may run along an edge: the range grows in whole 10 dB steps until
    // every drawn curve is inside it (an area may still leave through an edge).
    if (spec.inset) {
        for (const item of items) {
            if (item.kind !== 'curve') continue;
            for (const point of item.points) {
                if (!Number.isFinite(point?.y)) continue;
                while (point.y < yMin + INSET_CURVE_CLEARANCE) yMin -= 10;
                while (point.y > yMax - INSET_CURVE_CLEARANCE) yMax += 10;
            }
        }
        yTicks = [];
        for (let v = Math.floor(yMax / 10) * 10; v >= yMin; v -= 10) yTicks.push(v);
    }
    return layoutLogFrequencyChart({
        width: spec.width ?? 640,
        ...DISTORTION_FRAME,
        yMin,
        yMax,
        yTicks,
        yTitle: texts.yTitle,
        xMax: spec.xMax ?? DISTORTION_FRAME.xMax,
        xTitle: texts.xTitle,
        inset: spec.inset,
        height: spec.height ?? 330,
        // A set display range of a full-size chart (the diagnosis' chart E).
        ...spec.frame
    }, items, textWidth);
}

function svgNode(document, tag, attrs, style = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
    node.setAttribute('style', Object.entries(style).map(([name, value]) => `${name}: ${value}`).join('; '));
    return node;
}

let clipCount = 0;

/**
 * Writes the chart and returns it; an inset chart is sized by its host. The clip path of the plot rectangle
 * comes last, so svg child i still draws chart element i (emphasizeChartLegend relies on it).
 */
function writeChart(svg, chart) {
    const document = svg.ownerDocument;
    const clipId = `sdc-plot-clip-${++clipCount}`;
    svg.replaceChildren();
    svg.setAttribute('viewBox', `0 0 ${chart.width} ${chart.height}`);
    if (!chart.inset) svg.style.width = '100%';
    for (const element of chart.elements) {
        const node = svgNode(document, element.tag, element.attrs, element.style);
        if (element.text !== undefined) node.textContent = element.text;
        if (element.clip) node.setAttribute('clip-path', `url(#${clipId})`);
        svg.appendChild(node);
    }
    const { left, top, width, height } = chart.plot;
    const clipPath = svgNode(document, 'clipPath', { id: clipId });
    clipPath.appendChild(svgNode(document, 'rect', { x: left, y: top, width, height }));
    const defs = svgNode(document, 'defs', {});
    defs.appendChild(clipPath);
    svg.appendChild(defs);
    return chart;
}

export function drawDistortionChart(svg, spec) {
    return writeChart(svg, buildDistortionChart(spec, textWidthIn(svg)));
}

export function drawLogFrequencyChart(svg, frame, items) {
    return writeChart(svg, layoutLogFrequencyChart(frame, items, textWidthIn(svg)));
}

// ---------------------------------------------------------------- readout (GraphReadout)

/** GraphReadout legend items of a drawn chart's legend entries. */
export function chartReadoutLegend(chart) {
    return chart.legend.map(entry => ({
        label: entry.text,
        color: color(entry.color),
        swatch: entry.swatch,
        // An area's swatch shows its fill at the area's opacity.
        swatchOpacity: entry.square ? entry.style['fill-opacity'] : undefined
    }));
}

/**
 * Readout at chart x: each traced legend entry's value in dB (or as the chart's `formatValue` writes it), a dash
 * where its curve has a gap.
 */
export function readChartAt(chart, x) {
    const { format, seriesValueAt } = globalThis.GraphReadout;
    const formatValue = chart.formatValue ?? format.db;
    const rows = chart.legend.filter(entry => entry.trace).map(entry => {
        const run = entry.trace.find(({ xs }) => x >= xs[0] && x <= xs[xs.length - 1]);
        const value = run ? seriesValueAt(run.xs, run.ys, x) : null;
        const row = { label: entry.text, color: color(entry.color), value: value === null ? format.db(NaN) : formatValue(value) };
        if (value !== null) row.y = chart.yPixel(value);
        return row;
    });
    return { cursor: format.frequency(chart.frequencyAt(x)), rows };
}

const STROKED_ROLES = new Set(['curve', 'hline', 'vline']);

// While the entry of a level whose shaded change is kept aside is hovered, its polygons take the place of the drawn
// ones (the emphasized level's), under the curves; returns the undo. Nothing hidden stays in the svg.
function swapLevelArea(svg, chart, set) {
    const polygons = set === null ? null : chart.levelAreas?.[set];
    if (!polygons?.length) return () => {};
    // Read before any node moves: svg child i draws chart element i.
    const shown = chart.elements.flatMap((element, index) => (element.role === 'area' && element.set !== null
        ? [svg.children[index]] : []));
    const place = svg.children[chart.elements.findIndex(element => element.role === 'curve')];
    const clipPath = place.getAttribute('clip-path');
    const added = polygons.map(polygon => {
        const node = svgNode(svg.ownerDocument, polygon.tag, polygon.attrs, polygon.style);
        node.setAttribute('clip-path', clipPath);
        return svg.insertBefore(node, place);
    });
    for (const node of shown) svg.removeChild(node);
    return () => {
        for (const node of shown) svg.insertBefore(node, added[0]);
        for (const node of added) svg.removeChild(node);
    };
}

/**
 * Draws the lines of the legend entry named `text` (those with its style) thick and on top and returns the
 * undo, or null. An area is not a line, and lifting it over the curves would cover them, so it stays as is; the
 * entry of another level than the emphasized one shades that level's change instead.
 */
export function emphasizeChartLegend(svg, chart, text) {
    const entry = chart?.legend.find(item => item.text === text);
    if (!entry || entry.square || !svg) return null;
    const keys = Object.keys(entry.style);
    // The chart writes its elements in order, so svg child i draws chart element i.
    const nodes = chart.elements.flatMap((element, index) => (STROKED_ROLES.has(element.role)
        && Object.keys(element.style).length === keys.length
        && keys.every(key => element.style[key] === entry.style[key]) ? [svg.children[index]] : []));
    const places = nodes.map(node => node.nextSibling);
    const undoArea = swapLevelArea(svg, chart, entry.set ?? null);
    for (const node of nodes) {
        node.classList.add('sdc-highlighted');
        svg.appendChild(node);
    }
    return () => {
        // Reinsert from the last so a node whose place is another moved node finds it back in place.
        for (let i = nodes.length - 1; i >= 0; i--) {
            nodes[i].classList.remove('sdc-highlighted');
            svg.insertBefore(nodes[i], places[i]);
        }
        undoArea();
    };
}
