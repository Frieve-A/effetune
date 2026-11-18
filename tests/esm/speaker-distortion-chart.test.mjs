import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildDistortionChart,
    chartBands,
    drawDistortionChart,
    emphasizeChartLegend,
    measuredDistortionCurve
} from '../../features/measurement/speaker-distortion-chart.js';
import {
    BAND_EDGES,
    N_BANDS,
    POWER_LENGTH,
    REF_LENGTH,
    SCALE_ADD,
    SCALE_REDUCE,
    SETS
} from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';

const TEXTS = {
    setNames: { L: 'L0', 'L-6': 'L6', 'L-12': 'L12', peaks: 'Pk' },
    legendMeasured: '{set} measured',
    legendPredicted: '{set} predicted',
    legendCheck: 'check',
    legendWould: 'would',
    legendOddOverlay: 'odd',
    legendOddMeasured: '{set} odd',
    legendCompared: 'vs {name}',
    comparedName: 'Other',
    legendLimit: 'floor',
    noteOdd: 'odd note',
    noteAllBelowWith: 'all below with',
    noteAllBelow: 'all below',
    xTitle: 'Hz',
    yTitle: 'dB',
    upperLimitLabel: 'Upper Limit'
};

// Plot frame of the default 640 px width: x 44..628, y 24..290 for -5..-80 dB.
const xPixel = f => Math.round((44 + Math.log10(f / 20) / Math.log10(500) * 584) * 100) / 100;
const yPixel = v => Math.round((24 + (-5 - v) / 75 * 266) * 100) / 100;
const dB = (numerator, denominator) => 10 * Math.log10(numerator / denominator);

/** A channel entry with only the fields the renderer reads; every value is per set and band. */
function makeChannel({
    x = () => 1, v = () => 1e-6, odd = () => 0, oddVar = () => 1e-6, power = () => 1e-2, scales = 5
} = {}) {
    const ref = {};
    const powers = {};
    for (const set of SETS) {
        ref[set] = new Float32Array(REF_LENGTH);
        for (let i = 0; i < N_BANDS; i++) {
            ref[set][i] = x(i, set);
            ref[set][51 + i] = odd(i, set);
            ref[set][102 + i] = v(i, set);
            ref[set][153 + i] = oddVar(i, set);
        }
        powers[set] = Array.from({ length: scales }, (_, s) =>
            Float32Array.from({ length: POWER_LENGTH }, (_, i) => (i < N_BANDS ? power(s, i, set) : 0)));
    }
    return { ref, power: { short: powers, long: powers }, diagnosis: null };
}

const spec = overrides => ({
    bands: BAND_EDGES,
    resolution: 'sixth',
    channel: makeChannel(),
    length: 'short',
    parity: 'even',
    sets: ['L'],
    emph: 'L',
    scale: null,
    upperLimitHz: null,
    compare: null,
    texts: TEXTS,
    ...overrides
});

const byRole = (chart, role) => chart.elements.filter(element => element.role === role);
const curves = (chart, token, dash) => byRole(chart, 'curve').filter(element =>
    element.style.stroke === `var(${token})` && element.style['stroke-dasharray'] === dash);
const areas = (chart, token) => byRole(chart, 'area').filter(element => element.style.fill === `var(${token})`);
const points = element => element.attrs.points.split(' ').map(pair => pair.split(',').map(Number));
const legendTexts = chart => chart.legend.map(entry => entry.text);
const noteText = chart => byRole(chart, 'note')[0]?.text ?? null;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.02, `${actual} != ${expected}`);
// Top edge of a limit polygon: its first half, in drawing order.
const topEdge = element => points(element).slice(0, points(element).length / 2);

test('chartBands groups the 1/6-octave bands into display bands', () => {
    const octave = chartBands(BAND_EDGES, 'octave');
    assert.equal(octave.groups.length, 9);
    assert.deepEqual(octave.groups[8], [48, 49]);
    assert.equal(chartBands(BAND_EDGES, 'third').groups.length, 25);
    assert.equal(chartBands(BAND_EDGES, 'sixth').groups.length, 50);
    assert.equal(octave.lo[0], 25);
    assert.equal(octave.hi[8], 8000);
    assert.equal(octave.fc[1], Math.sqrt(BAND_EDGES[6] * BAND_EDGES[12]));
});

test('grouped values and limits are ratios of summed powers, not averages of dB', () => {
    const channel = makeChannel({
        x: i => 1 + (i % 3) * 0.5,
        v: i => 1e-6 * (1 + (i % 2)),
        power: (s, i) => (i + 10) * 1e-3
    });
    const ref = channel.ref.L;
    const p0 = channel.power.short.L[0];
    const sum = (values, offset, group) => group.reduce((total, i) => total + values[offset + i], 0);
    for (const resolution of ['octave', 'third']) {
        const chart = buildDistortionChart(spec({ channel, resolution }));
        const display = chartBands(BAND_EDGES, resolution);
        const [measured] = curves(chart, '--sdc-l0', undefined);
        const drawn = points(measured);
        const limit = topEdge(areas(chart, '--sdc-lim')[0]);
        display.groups.forEach((group, k) => {
            const xSum = sum(ref, 0, group);
            near(drawn[k][0], xPixel(display.fc[k]));
            near(drawn[k][1], yPixel(dB(sum(p0, 0, group), xSum)));
            near(limit[k][1], yPixel(dB(2 * Math.sqrt(sum(ref, 102, group)), xSum)));
        });
    }
});

test('values outside the axis range keep their position and the plot clips the data layer', () => {
    // Bands 0-9 at -90 dB (below the -80 dB axis), the rest at -20 dB; a noise floor far below both.
    const channel = makeChannel({ v: () => 1e-24, power: (s, i) => (i < 10 ? 1e-9 : 1e-2) });
    const chart = buildDistortionChart(spec({ channel }));
    const [measured] = curves(chart, '--sdc-l0', undefined);
    const drawn = points(measured);
    const bottom = chart.plot.top + chart.plot.height;
    near(drawn[0][1], yPixel(-90));
    assert.ok(drawn[0][1] > bottom && drawn[20][1] < bottom);
    // The noise floor area reaches below the plot instead of resting on its border.
    assert.ok(topEdge(areas(chart, '--sdc-lim')[0]).every(([, y]) => y > bottom));
    // The readout reads the true value and places its point outside the plot.
    near(chart.legend[0].trace[0].ys[0], -90);
    assert.ok(chart.yPixel(chart.legend[0].trace[0].ys[0]) > bottom);
    // Only the data is clipped: grid, tick labels and the note are not.
    for (const element of chart.elements) {
        assert.equal(Boolean(element.clip), ['curve', 'area', 'hline', 'vline'].includes(element.role), element.role);
    }

    // Writing it puts the plot rectangle in a clip path that every data node references.
    const node = tag => ({
        tag, attrs: {}, children: [], style: {},
        setAttribute(name, value) { this.attrs[name] = value; },
        appendChild(child) { this.children.push(child); return child; }
    });
    const svg = { ...node('svg'), ownerDocument: { createElementNS: (ns, tag) => node(tag) }, replaceChildren() { this.children = []; } };
    const written = drawDistortionChart(svg, spec({ channel }));
    const defs = svg.children[svg.children.length - 1];
    const [clipPath] = defs.children;
    assert.equal(clipPath.tag, 'clipPath');
    assert.deepEqual(clipPath.children[0].attrs, { style: '', x: '44', y: '24', width: '584', height: '266' });
    written.elements.forEach((element, i) => {
        assert.equal(svg.children[i].attrs['clip-path'], element.clip ? `url(#${clipPath.attrs.id})` : undefined);
    });
});

test('measuredDistortionCurve gives the measured L values of the chart and null for undrawn bands', () => {
    const channel = makeChannel({
        x: i => 1 + (i % 3) * 0.5,
        power: (s, i) => (i < 10 ? 1e-9 : (i + 10) * 1e-3)
    });
    const display = chartBands(BAND_EDGES, 'third');
    const sum = (values, group) => group.reduce((total, i) => total + values[i], 0);
    const curve = measuredDistortionCurve(channel, 'short', BAND_EDGES, 'third');
    assert.equal(curve.length, display.groups.length);
    display.groups.forEach((group, k) => {
        assert.equal(curve[k][0], display.fc[k]);
        if (group.every(i => i < 10)) assert.equal(curve[k][1], null);
        else near(curve[k][1], dB(sum(channel.power.short.L[0], group), sum(channel.ref.L, group)));
    });
});

test('bands at or below the limit, negative sums and gaps draw nothing but the limit area', () => {
    const channel = makeChannel({
        x: i => (i === 20 ? 0 : 1),
        power: (s, i) => ([18, 19, 21, 22, 30].includes(i) ? 1e-2 : i === 25 ? -1e-3 : i === 26 ? 1.5e-3 : 1e-4)
    });
    const chart = buildDistortionChart(spec({ channel }));
    const measured = curves(chart, '--sdc-l0', undefined);
    const display = chartBands(BAND_EDGES, 'sixth');
    assert.deepEqual(measured.map(element => points(element).map(([x]) => x)), [
        [xPixel(display.fc[18]), xPixel(display.fc[19])],
        [xPixel(display.fc[21]), xPixel(display.fc[22])]
    ]);
    // An isolated drawn band is a filled dot at its centre, in the curve's colour, sized by its width.
    const [dot] = byRole(chart, 'dot');
    assert.equal(byRole(chart, 'dot').length, 1);
    near(dot.attrs.cx, xPixel(display.fc[30]));
    near(dot.attrs.cy, yPixel(-20));
    assert.equal(dot.style.fill, 'var(--sdc-l0)');
    assert.deepEqual(dot.match, measured[0].style);
    assert.equal(areas(chart, '--sdc-lim').length, 2);
    assert.equal(noteText(chart), null);
    // Unmasked: bands at or below the limit are drawn too, the limit area stays; gaps and negative sums do not.
    const unmasked = buildDistortionChart(spec({ channel, unmasked: true }));
    const drawn = curves(unmasked, '--sdc-l0', undefined).flatMap(points);
    const at = k => drawn.find(([x]) => Math.abs(x - xPixel(display.fc[k])) < 0.02);
    near(at(18)[1], yPixel(-20));
    near(at(23)[1], yPixel(-40));
    assert.equal(at(20), undefined);
    assert.equal(at(25), undefined);
    assert.equal(areas(unmasked, '--sdc-lim').length, 2);
    const silent = buildDistortionChart(spec({ channel: makeChannel({ power: () => -1e-3 }) }));
    assert.equal(curves(silent, '--sdc-l0', undefined).length, 0);
    assert.equal(noteText(silent), 'all below');
});

test('a long note and y-axis title wrap to fit within the fixed height, and the plot gives up their room', () => {
    const silent = makeChannel({ power: () => -1e-3 });
    const short = buildDistortionChart(spec({ channel: silent, width: 462 }));
    const note = 'All values are below the noise floor. Increase the averaging, then measure again. 全ての値がノイズフロア以下です。';
    const yTitle = 'dB relative to the test signal at the set Signal Level, a title longer than the chart is high';
    const width = (text, size) => text.length * size * 0.6;
    const long = buildDistortionChart(spec({ channel: silent, width: 462, texts: { ...TEXTS, noteAllBelow: note, yTitle } }),
        width);
    const lines = byRole(long, 'note');
    const titles = long.elements.filter(element => element.attrs.transform?.includes('rotate(-90)'));
    assert.ok(lines.length > 1 && titles.length > 1);
    assert.equal(lines.map(line => line.text).join(' ').replace(/\s+/g, ''), note.replace(/\s+/g, ''));
    assert.equal(titles.map(line => line.text).join(' '), yTitle);
    for (const line of lines) assert.ok(width(line.text, 12) <= 462 - long.plot.left - 12);
    for (const line of titles) assert.ok(width(line.text, 12) <= long.height);
    // The chart keeps its height; the plot shrinks by the added note lines and narrows by the added title lines.
    assert.equal(long.height, short.height);
    assert.equal(long.plot.top - short.plot.top, (lines.length - 1) * 15);
    assert.equal(short.plot.height - long.plot.height, long.plot.top - short.plot.top);
    assert.equal(long.plot.left - short.plot.left, (titles.length - 1) * 15);
    near(lines[lines.length - 1].attrs.y, long.plot.top - 8);
});

test('dotted curves appear only where the measured value is drawn and follow the limit below it', () => {
    const channel = makeChannel({
        power: (s, i) => (s === 0 ? (i === 5 ? 1e-3 : 1e-2) : i === 6 ? 1.9e-3 : 2.1e-3)
    });
    const display = chartBands(BAND_EDGES, 'sixth');
    const plain = buildDistortionChart(spec({ channel }));
    const chart = buildDistortionChart(spec({ channel, scale: SCALE_REDUCE, wouldScale: SCALE_ADD }));
    assert.deepEqual(byRole(chart, 'area').filter(element => element.style.fill.includes('--sdc-lim'))
        .map(element => element.attrs.points),
    areas(plain, '--sdc-lim').map(element => element.attrs.points));

    const dotted = curves(chart, '--sdc-l0', '2 3');
    const drawn = dotted.flatMap(points);
    assert.equal(drawn.length, 49);
    assert.ok(!drawn.some(([x]) => x === xPixel(display.fc[5])));
    // Band 6 is below the limit with the correction: the emphasized curve follows the limit there.
    near(drawn.find(([x]) => x === xPixel(display.fc[6]))[1], yPixel(dB(2 * Math.sqrt(1e-6), 1)));
    assert.equal(dotted[0].style['stroke-width'], 3);
    assert.equal(curves(chart, '--sdc-would', '6 4').length, 2);
    assert.deepEqual(legendTexts(chart), ['L0 measured', 'L0 predicted', 'would', 'floor']);
    assert.equal(areas(chart, '--sdc-l0').length, 2);

    assert.equal(byRole(plain, 'curve').filter(element => element.style['stroke-dasharray']).length, 0);
    assert.deepEqual(legendTexts(plain), ['L0 measured', 'floor']);
    assert.equal(areas(plain, '--sdc-l0').length, 0);

    const below = makeChannel({ power: (s) => (s === 0 ? 1e-2 : 1e-3) });
    const hidden = buildDistortionChart(spec({ channel: below, sets: ['L', 'L-6'], scale: SCALE_REDUCE }));
    const [atLimit] = curves(hidden, '--sdc-l0', '2 3');
    assert.ok(points(atLimit).every(([, y]) => Math.abs(y - yPixel(dB(2 * Math.sqrt(1e-6), 1))) < 0.02));
    assert.equal(curves(hidden, '--sdc-l6', '2 3').length, 0);
    assert.deepEqual(legendTexts(hidden), ['L0 measured', 'L6 measured', 'L0 predicted', 'floor']);
    assert.equal(noteText(hidden), 'all below with');
});

test('a channel entry without diagnosis draws every series', () => {
    const chart = buildDistortionChart(spec({
        channel: makeChannel({ odd: () => 1e-2, power: (s) => (s === 0 ? 1e-2 : 5e-3) }),
        sets: [...SETS], scale: SCALE_REDUCE, wouldScale: SCALE_ADD, showOdd: true,
        compare: { channel: makeChannel(), length: 'short' }
    }));
    for (const [token, dash, count] of [['--sdc-l0', undefined, 1], ['--sdc-pk', undefined, 1],
        ['--sdc-l12', '2 3', 1], ['--sdc-would', '6 4', 1], ['--sdc-odd', '1 3', 4], ['--sdc-l6', '5 4', 1]]) {
        assert.equal(curves(chart, token, dash).length, count, `${token} ${dash}`);
    }
});

test('the Upper Limit line is labelled on its left and keeps the bands above it', () => {
    const chart = buildDistortionChart(spec({ upperLimitHz: 1000 }));
    const [line] = byRole(chart, 'vline');
    const [label] = byRole(chart, 'vlineLabel');
    assert.equal(byRole(chart, 'vline').length, 1);
    assert.equal(line.attrs.x1, xPixel(1000));
    assert.equal(line.style['stroke-dasharray'], '4 4');
    assert.equal(label.text, 'Upper Limit');
    assert.equal(label.attrs['text-anchor'], 'end');
    assert.ok(label.attrs.x < line.attrs.x1);
    // Low in the plot, clear of the readout legend at the top right.
    assert.ok(label.attrs.y > chart.plot.top + chart.plot.height / 2 && label.attrs.y < chart.plot.top + chart.plot.height);
    assert.ok(points(curves(chart, '--sdc-l0', undefined)[0]).some(([x]) => x > xPixel(1000)));
    assert.equal(byRole(buildDistortionChart(spec({})), 'vline').length, 0);
});

test('scaleSets limits the dotted curves and legendPredictedOther shares one legend entry', () => {
    const channel = makeChannel({ power: (s) => (s === 0 ? 1e-2 : 5e-3) });
    const sets = [...SETS];
    const limited = buildDistortionChart(spec({ channel, sets, scale: SCALE_REDUCE, scaleSets: ['L', 'L-6', 'peaks'] }));
    assert.equal(curves(limited, '--sdc-l12', '2 3').length, 0);
    assert.equal(curves(limited, '--sdc-l6', '2 3').length, 1);
    const shared = buildDistortionChart(spec({ channel, sets, scale: SCALE_REDUCE,
        texts: { ...TEXTS, legendPredictedOther: 'others predicted' } }));
    assert.deepEqual(legendTexts(shared), ['L0 measured', 'L6 measured', 'L12 measured', 'Pk measured',
        'L0 predicted', 'others predicted', 'floor']);
    const sample = shared.legend[5];
    assert.equal(sample.style.stroke, 'var(--sdc-would)');
    assert.equal(sample.style['stroke-dasharray'], '2 3');
});

test('the odd view and the odd overlay test each odd curve against its own odd limit', () => {
    const channel = makeChannel({ v: () => 1e-6, oddVar: () => 1e-4, odd: i => (i === 3 ? 1e-2 : 5e-2) });
    const odd = buildDistortionChart(spec({ channel, parity: 'odd', scale: SCALE_REDUCE }));
    const [oddCurve] = curves(odd, '--sdc-l0', undefined);
    assert.equal(curves(odd, '--sdc-l0', undefined).length, 2);
    near(points(oddCurve)[0][1], yPixel(dB(5e-2, 1)));
    assert.equal(curves(odd, '--sdc-l0', '2 3').length, 0);
    assert.equal(areas(odd, '--sdc-l0').length, 0);
    near(topEdge(areas(odd, '--sdc-lim')[0])[0][1], yPixel(dB(2 * Math.sqrt(1e-4), 1)));
    assert.equal(noteText(odd), 'odd note');
    assert.deepEqual(legendTexts(odd), ['L0 odd', 'floor']);

    const overlay = buildDistortionChart(spec({ channel, showOdd: true }));
    near(topEdge(areas(overlay, '--sdc-lim')[0])[0][1], yPixel(dB(2 * Math.sqrt(1e-6), 1)));
    assert.equal(curves(overlay, '--sdc-odd', '1 3').flatMap(points).length, 49);
    assert.deepEqual(legendTexts(overlay), ['L0 measured', 'odd', 'floor']);
});

test('compare adds dashed measured curves of the other entry', () => {
    const chart = buildDistortionChart(spec({ sets: ['L', 'L-6'],
        compare: { channel: makeChannel({ power: () => 2e-2 }), length: 'short' } }));
    const compared = curves(chart, '--sdc-l6', '5 4');
    assert.equal(compared.length, 1);
    near(points(compared[0])[0][1], yPixel(dB(2e-2, 1)));
    assert.equal(curves(chart, '--sdc-l0', '5 4').length, 1);
    assert.deepEqual(legendTexts(chart), ['L0 measured', 'L6 measured', 'vs Other', 'floor']);
});

// Check band sums: corrected power 4e-3, X = 1 and variance 1e-6 in every band.
function checkSums() {
    const check = new Float32Array(3 * N_BANDS);
    check.fill(4e-3, 0, N_BANDS);
    check.fill(1, N_BANDS, 2 * N_BANDS);
    check.fill(1e-6, 2 * N_BANDS);
    return check;
}

test('check replaces the dotted curve of the emphasized set with the check curve', () => {
    const check = checkSums();
    const channel = makeChannel({ power: (s) => (s === 0 ? 1e-2 : 5e-3) });
    const chart = buildDistortionChart(spec({ channel, sets: ['L', 'L-6'], scale: SCALE_REDUCE, check }));
    const [checkCurve] = curves(chart, '--sdc-l0', '7 4');
    assert.equal(checkCurve.style['stroke-width'], 2.4);
    near(points(checkCurve)[0][1], yPixel(dB(4e-3, 1)));
    assert.equal(curves(chart, '--sdc-l0', '2 3').length, 0);
    assert.equal(curves(chart, '--sdc-l6', '2 3').length, 1);
    assert.deepEqual(legendTexts(chart), ['L0 measured', 'L6 measured', 'check', 'L6 predicted', 'floor']);
    // Below its own limit the check curve follows that limit; a limit above the measured value leaves a gap.
    const display = chartBands(BAND_EDGES, 'sixth');
    const noisy = checkSums();
    noisy[3] = noisy[7] = 1e-3;
    noisy[2 * N_BANDS + 3] = 4e-6;
    noisy[2 * N_BANDS + 7] = 1e-4;
    const noisyChart = buildDistortionChart(spec({ channel, scale: SCALE_REDUCE, check: noisy }));
    const drawn = curves(noisyChart, '--sdc-l0', '7 4').flatMap(points);
    near(drawn.find(([x]) => x === xPixel(display.fc[3]))[1], yPixel(dB(2 * Math.sqrt(4e-6), 1)));
    assert.ok(!drawn.some(([x]) => x === xPixel(display.fc[7])));
    // The shading reaches up to that limit in the band the check curve rides on, and only there; unmasked the same.
    const shadeTop = (chart, k) => areas(chart, '--sdc-lim').flatMap(topEdge).find(([x]) => x === xPixel(display.fc[k]))[1];
    const plainChart = buildDistortionChart(spec({ channel, scale: SCALE_REDUCE, check: checkSums() }));
    near(shadeTop(noisyChart, 3), yPixel(dB(2 * Math.sqrt(4e-6), 1)));
    assert.ok(shadeTop(plainChart, 3) > shadeTop(noisyChart, 3));
    for (const k of [2, 4, 7]) assert.equal(shadeTop(noisyChart, k), shadeTop(plainChart, k));
    const unmaskedChart = buildDistortionChart(spec({ channel, scale: SCALE_REDUCE, check: noisy, unmasked: true }));
    assert.deepEqual(areas(unmaskedChart, '--sdc-lim').map(points), areas(noisyChart, '--sdc-lim').map(points));
    for (const value of [null, undefined]) {
        const plain = buildDistortionChart(spec({ channel, sets: ['L', 'L-6'], scale: SCALE_REDUCE, check: value }));
        assert.equal(curves(plain, '--sdc-l0', '2 3').length, 1);
        assert.equal(curves(plain, '--sdc-l0', '7 4').length, 0);
    }
});

test('hovering an entry of another level shades that level\'s change until the hover ends', () => {
    // A minimal DOM: ordered children, sibling lookup, insertion, removal and classes.
    const node = tag => ({
        tag, attrs: {}, children: [], parent: null, classes: new Set(),
        get classList() { return { add: name => this.classes.add(name), remove: name => this.classes.delete(name) }; },
        get nextSibling() { return this.parent.children[this.parent.children.indexOf(this) + 1] ?? null; },
        setAttribute(name, value) { this.attrs[name] = value; },
        getAttribute(name) { return this.attrs[name] ?? null; },
        insertBefore(child, place) {
            if (child.parent) child.parent.removeChild(child);
            child.parent = this;
            this.children.splice(place ? this.children.indexOf(place) : this.children.length, 0, child);
            return child;
        },
        appendChild(child) { return this.insertBefore(child, null); },
        removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parent = null; return child; }
    });
    const svg = Object.assign(node('svg'), { ownerDocument: { createElementNS: (ns, tag) => node(tag) },
        style: {}, replaceChildren() { this.children = []; } });
    // L-6 is below its limit in band 10, so its shaded change has two parts.
    const channel = makeChannel({ power: (s, i, set) => (set === 'L-6' && i === 10 ? 1e-7 : s === 0 ? 1e-2 : 5e-3) });
    const chart = drawDistortionChart(svg, spec({ channel, sets: ['L', 'L-6'], scale: SCALE_REDUCE }));
    const before = [...svg.children];
    const clipPath = before.find(child => child.tag === 'polyline').attrs['clip-path'];
    const fills = () => svg.children.filter(child => child.tag === 'polygon').map(child => child.attrs.style);
    const drawnFills = fills();
    assert.equal(drawnFills.filter(style => style.includes('--sdc-l0')).length, 1);
    assert.equal(drawnFills.some(style => style.includes('--sdc-l6')), false);
    assert.equal(chart.levelAreas['L-6'].length, 2);

    for (const text of ['L6 measured', 'L6 predicted']) {
        const undo = emphasizeChartLegend(svg, chart, text);
        const shaded = svg.children.filter(child => child.tag === 'polygon' && child.attrs.style.includes('--sdc-l6'));
        assert.deepEqual(shaded.map(child => child.attrs.points), chart.levelAreas['L-6'].map(area => area.attrs.points));
        assert.ok(shaded.every(child => child.attrs.style.includes('fill-opacity: 0.14')
            && child.attrs['clip-path'] === clipPath));
        assert.equal(fills().some(style => style.includes('--sdc-l0')), false);
        undo();
        assert.deepEqual(svg.children, before);
        assert.ok(svg.children.every(child => !child.classes.has('sdc-highlighted')));
    }
    // The emphasized level's entry and the floor leave the shading as drawn.
    const undo = emphasizeChartLegend(svg, chart, 'L0 measured');
    assert.deepEqual(fills(), drawnFills);
    undo();
    assert.equal(emphasizeChartLegend(svg, chart, 'floor'), null);
    // The single entry of the other levels' predictions names no level.
    const shared = drawDistortionChart(svg, spec({ channel, sets: ['L', 'L-6'], scale: SCALE_REDUCE,
        texts: { ...TEXTS, legendPredictedOther: 'others predicted' } }));
    const sharedFills = fills();
    emphasizeChartLegend(svg, shared, 'others predicted');
    assert.deepEqual(fills(), sharedFills);
});

test('the legend is returned beside the drawing and the chart takes the given height', () => {
    const chart = buildDistortionChart(spec({
        channel: makeChannel({ odd: () => 1e-2, power: (s) => (s === 0 ? 1e-2 : 5e-3) }),
        sets: [...SETS], scale: SCALE_REDUCE, wouldScale: SCALE_ADD, showOdd: true,
        compare: { channel: makeChannel(), length: 'short' }
    }));
    assert.equal(chart.legend.length, 12);
    assert.equal(chart.elements.some(element => element.role.startsWith('legend')), false);
    const plain = ({ text, square, style, color, swatch }) => ({ text, square, style, color, swatch });
    assert.deepEqual(plain(chart.legend[0]), { text: 'L0 measured', square: false,
        style: { fill: 'none', stroke: 'var(--sdc-l0)', 'stroke-width': 2.4 }, color: '--sdc-l0', swatch: null });
    assert.deepEqual(plain(chart.legend[11]), { text: 'floor', square: true,
        style: { fill: 'var(--sdc-lim)', 'fill-opacity': 0.15, stroke: 'none' }, color: '--sdc-lim', swatch: 'fill' });
    assert.deepEqual(chart.legend.map(entry => entry.swatch).slice(4, 11),
        ['dotted', 'dotted', 'dotted', 'dotted', 'dashed', 'dotted', 'dashed']);
    // A legend entry's trace is its drawn curve in chart x and dB.
    const measured = curves(chart, '--sdc-l0', undefined).flatMap(points);
    const trace = chart.legend[0].trace.flatMap(run => run.xs.map((x, i) => [x, chart.yPixel(run.ys[i])]));
    assert.deepEqual(trace, measured);
    assert.equal(chart.legend.find(entry => entry.text === 'vs Other').trace, null);
    assert.deepEqual([320, 1200].map(width => buildDistortionChart(spec({ width })).height), [330, 330]);
    assert.equal(buildDistortionChart(spec({ width: 1200, height: 528 })).height, 528);
});

test('the inset presentation fills its box and draws whole tick values and the axis titles over it', () => {
    const chart = buildDistortionChart(spec({ channel: makeChannel(), inset: true, width: 984, height: 440 }));
    assert.equal(chart.height, 440);
    assert.deepEqual(chart.plot, { left: 0, top: 0, width: 984, height: 440 });
    for (const f of [20, 1000, 10000]) near(chart.frequencyAt(Math.log10(f / 20) / Math.log10(500) * 984), f);
    // The default range holds the -20 dB curve: -5 dB at the top edge, -80 dB at the bottom.
    assert.deepEqual([chart.yPixel(-5), chart.yPixel(-80)], [0, 440]);
    // No grid line lies on an edge of the box (20 Hz, 10 kHz, -80 dB are left out).
    const grid = chart.elements.filter(element => element.role === 'grid');
    const vertical = grid.filter(({ attrs }) => attrs.x1 === attrs.x2).map(({ attrs }) => attrs.x1);
    assert.equal(vertical.length, 7);
    assert.ok(vertical.every(x => x > 0 && x < 984));
    const horizontal = grid.filter(({ attrs }) => attrs.y1 === attrs.y2).map(({ attrs }) => attrs.y1);
    assert.equal(horizontal.length, 7);
    assert.ok(horizontal.every(y => y > 0 && y < 440));
    const texts = chart.elements.filter(element => element.role === 'text');
    const at = value => texts.find(element => element.text === value);
    // Tilt EQ's titles: 14 px, the x title 5 px above the bottom, the y title rotated 14 px from the left.
    assert.deepEqual(at(TEXTS.xTitle).attrs, { x: 492, y: 435, 'font-size': 14, 'text-anchor': 'middle' });
    assert.equal(at(TEXTS.yTitle).attrs.transform, 'translate(14 220) rotate(-90)');
    assert.equal(at(TEXTS.yTitle).style.fill, 'var(--sdc-title)');
    // Its 12 px ticks: x values 24 px above the bottom, y values ending 48 px from the left. The values at the ends
    // (20 Hz, 10 kHz, -80 dB) would not fit whole and are left out.
    const ticks = texts.filter(element => element.attrs['font-size'] === 12);
    assert.deepEqual(ticks.filter(element => element.attrs.y === 416).map(element => element.text),
        ['50', '100', '200', '500', '1k', '2k', '5k']);
    assert.deepEqual(ticks.filter(element => element.attrs.x === 48).map(element => element.text),
        ['−10', '−20', '−30', '−40', '−50', '−60', '−70']);
});

test('the inset range grows in 10 dB steps so no curve runs along an edge', () => {
    const range = power => {
        const chart = buildDistortionChart(spec({ channel: makeChannel({ power: () => power, v: () => 1e-20 }),
            inset: true, width: 984, height: 440 }));
        const ticks = chart.elements.filter(element => element.role === 'grid' && element.attrs.y1 === element.attrs.y2);
        return [ticks.length, chart.yPixel(dB(power, 1))];
    };
    // A 0 dB curve lifts the top to +5 dB (lines 0 to -70; -80 is the bottom edge); a -87 dB curve drops the bottom
    // to -90 dB (lines -10 to -80).
    const [highTicks, highY] = range(1);
    assert.equal(highTicks, 8);
    near(highY, 5 / 85 * 440);
    const [lowTicks, lowY] = range(10 ** -8.7);
    assert.equal(lowTicks, 8);
    near(lowY, 82 / 85 * 440);
    // Outside the inset the range stays -80 to -5 dB.
    const outside = buildDistortionChart(spec({ channel: makeChannel({ power: () => 1, v: () => 1e-20 }) }));
    assert.deepEqual([outside.yPixel(-5), outside.yPixel(-80)], [yPixel(-5), yPixel(-80)]);
});

// Kinds, styles and texts of every drawn element except the frame, then the legend entries.
const snapshot = chart => [...chart.elements.filter(element => !['grid', 'text'].includes(element.role)),
    ...chart.legend.map(entry => ({ ...entry, role: 'legend' }))].map(element =>
    [element.role, (element.style.stroke && element.style.stroke !== 'none' ? element.style.stroke
        : element.style.fill),
        element.style['stroke-dasharray'] ?? element.style['fill-opacity'] ?? '', element.style['stroke-width'] ?? '',
        element.text ?? ''].filter(part => part !== '').join(' '));

test('plugin-style and tab-style specs draw the expected items', () => {
    const channel = makeChannel({ odd: () => 1e-2, power: (s) => (s === 0 ? 1e-2 : 5e-3) });
    const plugin = buildDistortionChart(spec({
        channel, resolution: 'third', sets: [...SETS], emph: 'L-6', scale: SCALE_ADD, wouldScale: null,
        showOdd: true, upperLimitHz: 8000, texts: { ...TEXTS, legendPredictedOther: 'others predicted' }
    }));
    assert.deepEqual(snapshot(plugin), PLUGIN_SNAPSHOT);
    const check = checkSums();
    const tab = buildDistortionChart(spec({
        channel, resolution: 'octave', sets: [...SETS], scale: SCALE_REDUCE, scaleSets: ['L', 'L-6', 'peaks'],
        check, upperLimitHz: 2000, showOdd: false
    }));
    assert.deepEqual(snapshot(tab), TAB_SNAPSHOT);
});

const PLUGIN_SNAPSHOT = [
    'area var(--sdc-lim) 0.15',
    'area var(--sdc-l6) 0.14',
    'curve var(--sdc-odd) 1 3 1.3',
    'curve var(--sdc-odd) 1 3 1.3',
    'curve var(--sdc-odd) 1 3 1.3',
    'curve var(--sdc-odd) 1 3 1.3',
    'curve var(--sdc-l0) 1.3',
    'curve var(--sdc-l12) 1.3',
    'curve var(--sdc-pk) 1.3',
    'curve var(--sdc-l6) 2.4',
    'curve var(--sdc-l0) 2 3 1.9',
    'curve var(--sdc-l6) 2 3 3',
    'curve var(--sdc-l12) 2 3 1.9',
    'curve var(--sdc-pk) 2 3 1.9',
    'vline var(--sdc-range) 4 4 1',
    'vlineLabel var(--sdc-range) Upper Limit',
    'legend var(--sdc-l0) 1.3 L0 measured',
    'legend var(--sdc-l6) 2.4 L6 measured',
    'legend var(--sdc-l12) 1.3 L12 measured',
    'legend var(--sdc-pk) 1.3 Pk measured',
    'legend var(--sdc-l6) 2 3 3 L6 predicted',
    'legend var(--sdc-would) 2 3 1.9 others predicted',
    'legend var(--sdc-odd) 1 3 1.3 odd',
    'legend var(--sdc-lim) 0.15 floor'
];

const TAB_SNAPSHOT = [
    'area var(--sdc-lim) 0.15',
    'area var(--sdc-l0) 0.14',
    'curve var(--sdc-l6) 1.3',
    'curve var(--sdc-l12) 1.3',
    'curve var(--sdc-pk) 1.3',
    'curve var(--sdc-l0) 2.4',
    'curve var(--sdc-l6) 2 3 1.9',
    'curve var(--sdc-pk) 2 3 1.9',
    'curve var(--sdc-l0) 7 4 2.4',
    'vline var(--sdc-range) 4 4 1',
    'vlineLabel var(--sdc-range) Upper Limit',
    'legend var(--sdc-l0) 2.4 L0 measured',
    'legend var(--sdc-l6) 1.3 L6 measured',
    'legend var(--sdc-l12) 1.3 L12 measured',
    'legend var(--sdc-pk) 1.3 Pk measured',
    'legend var(--sdc-l0) 7 4 2.4 check',
    'legend var(--sdc-l6) 2 3 1.9 L6 predicted',
    'legend var(--sdc-pk) 2 3 1.9 Pk predicted',
    'legend var(--sdc-lim) 0.15 floor'
];

test('a set display frame redraws the axes from its range and the drawn extent is returned', () => {
    const channel = makeChannel({ power: s => (s === 0 ? 1e-2 : 5e-3) });
    const plain = buildDistortionChart(spec({ channel }));
    // The default frame of the diagnosis' chart E draws as without one.
    assert.deepEqual(buildDistortionChart(spec({ channel, frame: { xMin: 20, xMax: 10000, yMin: -80, yMax: -5 } })).elements,
        plain.elements);
    assert.ok(plain.extent.xMin < plain.extent.xMax && plain.extent.yMin <= plain.extent.yMax);
    const set = buildDistortionChart(spec({ channel, frame: { xMin: 100, xMax: 1000, xTicks: [[200, '200'], [500, '500']],
        yMin: -40, yMax: -20, yTicks: [-30], yTickLabel: () => 'thirty' } }));
    assert.deepEqual(byRole(set, 'text').map(element => element.text).filter(text => ['200', '500', 'thirty', '20'].includes(text)),
        ['200', '500', 'thirty']);
    assert.equal(byRole(set, 'grid').length, 3);
    assert.equal(buildDistortionChart(spec({ channel: makeChannel({ power: () => -1e-3 }) })).extent, null);
});
