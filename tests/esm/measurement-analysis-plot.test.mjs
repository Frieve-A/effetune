import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisPlot } from '../../features/measurement/ui/analysis-plot.js';
import { createLinearTicks, createFrequencyTicks, finerDecimalStep } from '../../features/measurement/ui/analysis-axis-ticks.js';
import { analyzeWaterfall, analyzeBurstDecay } from '../../js/utils/measurement-dsp/analysis.js';
import { replaceGlobal } from '../helpers/global-test-utils.mjs';

test('frequency and impulse dB axes choose audio intervals with smaller and larger continuations', () => {
    for (const step of [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 3, 6, 12, 24, 48, 96]) {
        const result = createLinearTicks(-3 * step, 3 * step, 6, 'decibels');
        assert.ok(Math.abs(result.step - step) < step * 1e-10, `${step}`);
        assert.equal(result.ticks.length, 7);
        assert.equal(result.ticks[3].value, 0);
    }
    assert.equal(createLinearTicks(-24, 24, 6, 'decibels').step, 12);
    assert.equal(createLinearTicks(-60, 0, 6, 'decibels').step, 12);
});

test('percent levels use 1/2/5 intervals anchored to zero rather than user bounds', () => {
    for (const step of [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]) {
        const result = createLinearTicks(0, 6 * step, 6);
        assert.ok(Math.abs(result.step - step) < step * 1e-10, `${step}`);
    }
    assert.deepEqual(createLinearTicks(0.07, 0.93, 6).ticks.map(tick => tick.label), ['0.2', '0.4', '0.6', '0.8']);
    assert.deepEqual(createLinearTicks(0, 10, 6).ticks.map(tick => tick.value), [0, 2, 4, 6, 8, 10]);
    assert.equal(createLinearTicks(-60, 0, 6).step, 10);
});

test('minor contours use the same decimal ladder exactly two intervals below major ticks', () => {
    for (const [major, minor] of [[0.1, 0.02], [0.2, 0.05], [0.5, 0.1], [1, 0.2], [2, 0.5], [5, 1], [10, 2], [20, 5], [50, 10], [100, 20]]) {
        assert.equal(finerDecimalStep(major, 2), minor);
        assert.equal(finerDecimalStep(finerDecimalStep(major)), minor);
    }
});

test('fractional tick labels stay distinct, decimal, and free of floating noise or negative zero', () => {
    for (const [min, max, unit, expected] of [
        [-0.34, 0.44, 'dB', ['-0.2', '0', '0.2', '0.4']],
        [120.01, 120.09, 'dB', ['120.02', '120.04', '120.06', '120.08']],
        [0, 0.001, '%', ['0', '0.0002', '0.0004', '0.0006', '0.0008', '0.001']],
        [-0.6, -0.2, 'dBr', ['-0.6', '-0.5', '-0.4', '-0.3', '-0.2']]
    ]) {
        const { ticks } = createLinearTicks(min, max, 6, unit === 'dB' ? 'decibels' : 'decimal');
        assert.deepEqual(ticks.map(tick => tick.label), expected);
        assert.ok(ticks.every(tick => tick.value >= min && tick.value <= max && !Object.is(tick.value, -0)));
    }
});

test('short offset linear axes retain an in-range nice tick instead of losing their scale', () => {
    for (const family of ['decimal', 'decibels']) {
        for (const [min, max] of [[3.75, 83.375], [0.3, 17.3], [-83.375, -3.75], [0.03, 0.083]]) {
            const { ticks } = createLinearTicks(min, max, 1, family);
            assert.ok(ticks.length > 0, `${family}: ${min}..${max}`);
            assert.ok(ticks.every(tick => tick.value >= min && tick.value <= max));
        }
    }
    assert.deepEqual(createLinearTicks(3.75, 83.375, 1).ticks, [{ value: 50, label: '50' }]);
    assert.deepEqual(createLinearTicks(0.3, 17.3, 1).ticks, [{ value: 10, label: '10' }]);
});

test('frequency ticks use actual 1/2/5 decades and thin by their logarithmic screen positions', () => {
    const ticks = createFrequencyTicks(23, 18000, 1000);
    assert.deepEqual(ticks.map(tick => tick.value), [50, 100, 200, 500, 1000, 2000, 5000, 10000]);
    for (const tick of ticks) assert.equal(tick.fraction, Math.log(tick.value / 23) / Math.log(18000 / 23));
    const compact = createFrequencyTicks(23, 18000, 220);
    assert.ok(compact.length < ticks.length);
    assert.ok(compact.every(tick => ticks.some(candidate => candidate.value === tick.value)));
    assert.ok(compact.slice(1).every((tick, index) => (tick.fraction - compact[index].fraction) * 220 >= 65));
    assert.deepEqual(createFrequencyTicks(1100, 1200, 800), []);
    assert.deepEqual(createFrequencyTicks(900, 1100, 800).map(tick => tick.value), [1000]);
});

function canvasHarness(t) {
    const canvases = [];
    const makeCanvas = () => {
        const ctx = {
            labels: [], strokes: [], setTransform() {}, fillRect() {}, clearRect() {},
            setLineDash(value) { this.dash = value; },
            save() {}, restore() {}, rect() {}, clip() {}, scale() {}, drawImage() {},
            beginPath() {}, moveTo() {}, lineTo() {},
            stroke() { this.strokes.push({ color: this.strokeStyle, width: this.lineWidth, dash: [...this.dash] }); },
            strokeRect() {}, strokeText() {},
            createLinearGradient: () => ({ addColorStop() {} }),
            getImageData: () => ({ data: new Uint8ClampedArray(1024).fill(255) }),
            createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
            putImageData() {},
            fillText(text, x, y) { this.labels.push({ text, x, y, align: this.textAlign }); },
            measureText: text => ({ width: text.length * 6, actualBoundingBoxLeft: text.length * 6 + (text.startsWith('-') ? 2 : 0) })
        };
        const canvas = { style: {}, getContext: () => ctx, addEventListener() {}, removeEventListener() {},
            ownerDocument: { createElement: makeCanvas },
            getBoundingClientRect: () => ({ width: 800, height: 400 }) };
        canvases.push(canvas);
        return canvas;
    };
    t.after(replaceGlobal('window', { ThemePalette: { get: name => name } }));
    t.after(replaceGlobal('document', { createElement: makeCanvas }));
    return { canvases, makeCanvas };
}

test('legend hover brings only the selected frequency or distortion curve forward and never enters exports', t => {
    const { makeCanvas, canvases } = canvasHarness(t);
    let options;
    let legendUpdates = 0;
    window.GraphReadout = { attach(value) {
        options = value;
        return { setLegend() { legendUpdates++; }, clear() {}, refresh() {} };
    } };
    const renderer = new AnalysisPlot(makeCanvas(), { textContent: '' });
    t.after(() => renderer.surface.destroy());
    const context = renderer.canvas.getContext('2d');
    const series = ['#f00', '#0f0', '#00f'].map((color, index) => ({ color,
        label: `Localized series ${index}`, points: [[100, index], [1000, -index]] }));
    const curves = ctx => ctx.strokes.filter(stroke => series.some(entry => entry.color === stroke.color));
    for (const type of ['frequency', 'distortion']) {
        const state = { type, xMin: 100, xMax: 1000, yMin: -10, yMax: 10, unit: 'dB', series };
        const original = structuredClone(state);
        context.strokes = [];
        renderer.draw(state);
        const normal = curves(context);
        const count = legendUpdates;
        context.strokes = [];
        options.onLegendHover(1);
        assert.equal(renderer.hoveredSeries, 1);
        assert.deepEqual(curves(context).map(({ color, width }) => [color, width]),
            [['#f00', 1.6], ['#00f', 1.6], ['#0f0', 3.5]]);
        assert.deepEqual(curves(context).at(-1).dash, [6, 3]);
        assert.equal(legendUpdates, count);
        assert.equal(renderer.read(300, 100), null);
        const exportIndex = canvases.length;
        renderer.renderImage({ title: 'Clean graph' });
        assert.deepEqual(curves(canvases[exportIndex].getContext('2d')), normal);
        assert.equal(renderer.hoveredSeries, 1);
        assert.equal(renderer.state, state);
        context.strokes = [];
        options.onLegendHover(null);
        assert.deepEqual(curves(context), normal);
        assert.ok(renderer.read(300, 100));
        options.onLegendHover(0);
        context.strokes = [];
        renderer.draw({ ...state });
        assert.equal(renderer.hoveredSeries, null);
        assert.deepEqual(curves(context), normal);
        assert.deepEqual(state, original);
    }
    options.onLegendHover(0);
    const updated = renderer.state;
    updated.series = [{ ...series[2], label: '長い翻訳ラベル — matching reordered series' }, series[0]];
    const before = legendUpdates;
    renderer.draw(updated);
    assert.equal(renderer.hoveredSeries, null);
    assert.equal(legendUpdates, before + 1);
    context.strokes = [];
    options.onLegendHover(0);
    assert.deepEqual(curves(context).map(({ color, width }) => [color, width]), [['#f00', 1.6], ['#00f', 3.5]]);
    renderer.clear();
    assert.equal(renderer.hoveredSeries, null);
    assert.equal(renderer.state, null);
});

test('Waterfall rejects results without a surface and recovers with observed zero-level cells', t => {
    const { makeCanvas } = canvasHarness(t);
    const renderer = new AnalysisPlot(makeCanvas(), null);
    t.after(() => renderer.surface.destroy());
    const settings = { type: 'waterfall', xMin: 100, xMax: 1000, yMin: -60, yMax: 0, unit: 'dB', series: [] };
    const observed = { frequencies: [100, 300, 1000], slices: [
        { time: 0, levels: [null, 0, 0] }, { time: 0.1, levels: [null, 0, 0] }
    ] };
    const record = { data: new Float32Array(16384), sampleRate: 48000, onsetIndex: 128, refScale: 1 };
    record.data[128] = 1;
    const noFrequencies = analyzeWaterfall(record, { windowSeconds: 2 / 48000 });
    const oneScalar = analyzeBurstDecay(record, { depthUnit: 'seconds', startSeconds: 0.338322, endSeconds: 0.338332, maxSlices: 48 });
    assert.equal(noFrequencies.frequencies.length, 0);
    assert.equal(oneScalar.slices.flatMap(slice => slice.levels).filter(Number.isFinite).length, 1);
    for (const waterfall of [noFrequencies, oneScalar,
        { frequencies: [100, 1000], slices: [{ time: 0, levels: [0, 0] }] },
        { frequencies: [100, 1000], slices: [{ time: 0, levels: [0, null] }, { time: 0.1, levels: [null, 0] }] }
    ]) {
        assert.equal(renderer.draw({ ...settings, waterfall: observed }), true);
        assert.ok(renderer.surface.raster);
        assert.equal(renderer.draw({ ...settings, waterfall }), false);
        assert.equal(renderer.state, null);
        assert.equal(renderer.surface.raster, null);
        assert.equal(renderer.surface.enabled, false);
        assert.equal(renderer.surface.keyboardPoint(0.5), null);
        assert.throws(() => renderer.renderImage({ title: 'Unavailable' }), /No plotted data/);
    }
    assert.equal(renderer.draw({ ...settings, waterfall: observed }), true);
    assert.equal(renderer.surface.mesh.triangles.length, 2);
    assert.ok(renderer.surface.mesh.triangles.flat().every(vertex => vertex.level === 0));
    assert.ok(renderer.renderImage({ title: 'Observed surface' }).width > 0);
});

test('live and copied plots place nice level and frequency ticks at their actual values', t => {
    const { canvases, makeCanvas } = canvasHarness(t);
    const renderer = new AnalysisPlot(makeCanvas(), null);
    t.after(() => renderer.surface.destroy());
    for (const [unit, yMin, yMax, expected] of [
        ['dB', -23, 26, ['-12', '0', '12', '24']],
        ['dBr', -59, -1, ['-50', '-40', '-30', '-20', '-10']],
        ['%', 0.07, 0.93, ['0.2', '0.4', '0.6', '0.8']]
    ]) {
        const state = { type: unit === 'dB' ? 'frequency' : 'distortion', xMin: 40, xMax: 4000,
            yMin, yMax, unit, series: [] };
        const original = structuredClone(state);
        const context = canvases[0].getContext('2d');
        context.labels = [];
        renderer.draw(state);
        const levelLabels = context.labels.filter(label => label.align === 'right');
        assert.deepEqual(levelLabels.map(label => label.text), expected);
        for (const label of levelLabels) {
            const fraction = (Number(label.text) - yMin) / (yMax - yMin);
            assert.equal(label.y, renderer.plot.top + renderer.plot.height * (1 - fraction) + 4);
        }
        const frequencyLabels = context.labels.filter(label => label.y === renderer.plot.top + renderer.plot.height + 18);
        assert.deepEqual(frequencyLabels.map(label => label.text), ['50', '100', '200', '500', '1k', '2k']);
        for (const label of frequencyLabels) {
            const value = label.text.endsWith('k') ? Number(label.text.slice(0, -1)) * 1000 : Number(label.text);
            assert.equal(label.x, renderer.scaleX(value));
        }
        const exportIndex = canvases.length;
        renderer.renderImage({ title: 'Analysis' });
        assert.deepEqual(canvases[exportIndex].getContext('2d').labels, context.labels);
        assert.deepEqual(state, original);
    }
});

test('impulse time ticks include negative pretime and retain precise milliseconds in copied plots', t => {
    const { canvases, makeCanvas } = canvasHarness(t);
    const renderer = new AnalysisPlot(makeCanvas(), null);
    t.after(() => renderer.surface.destroy());
    const state = { type: 'impulse', logX: false, xMin: -0.035, xMax: 0.085, yMin: -1, yMax: 1, unit: '×',
        record: { sampleRate: 48000, onsetIndex: 1, data: Float32Array.of(0, 1, 0) },
        origin: 0, windowBefore: 0.02, windowAfter: 0.02, window: 'rectangular', series: [{ color: '#fff', label: 'IR' }] };
    renderer.draw(state);
    const labels = canvases[0].getContext('2d').labels;
    const timeLabels = labels.filter(label => label.y === renderer.plot.top + renderer.plot.height + 18);
    assert.deepEqual(timeLabels.map(label => label.text), ['-0.02', '0', '0.02', '0.04', '0.06', '0.08']);
    for (const label of timeLabels) assert.equal(label.x, renderer.scaleX(Number(label.text)));
    renderer.renderImage({ title: 'Impulse Response' });
    assert.deepEqual(canvases[1].getContext('2d').labels, labels);
});

test('short plots reduce level tick density and linear impulse amplitude uses nice numeric ticks', t => {
    const { makeCanvas } = canvasHarness(t);
    const canvas = makeCanvas();
    const renderer = new AnalysisPlot(canvas, null);
    t.after(() => renderer.surface.destroy());
    const context = canvas.getContext('2d');
    const state = { type: 'frequency', xMin: 20, xMax: 20000, yMin: -24, yMax: 24, unit: 'dB', series: [] };
    renderer.draw(state, { width: 300, height: 146 });
    const labels = context.labels.filter(label => label.align === 'right');
    assert.deepEqual(labels.map(label => label.text), ['-24', '0', '24']);
    assert.ok(labels.slice(1).every((label, index) => labels[index].y - label.y >= 35));
    context.labels = [];
    renderer.draw({ ...state, yMin: -1.05, yMax: 1.05, unit: '×' });
    assert.deepEqual(context.labels.filter(label => label.align === 'right').map(label => label.text),
        ['-1', '-0.5', '0', '0.5', '1']);
});

test('tiny signed and percentage level labels fit the shared live/export rectangle without changing normal margins', t => {
    const { makeCanvas, canvases } = canvasHarness(t);
    const renderer = new AnalysisPlot(makeCanvas(), null);
    t.after(() => renderer.surface.destroy());
    for (const width of [374, 800]) {
        for (const [type, unit, yMin, yMax, expanded] of [
            ['distortion', '%', 1.2e-6, 1.3e-6, true],
            ['distortion', '%', 0, 1e-6, true],
            ['impulse', '×', -1.05e-6, 1.05e-6, true],
            ['distortion', '%', 0, 10, false],
            ['distortion', 'dBr', -60, 0, false],
            ['impulse', '×', -1.05, 1.05, false]
        ]) {
            const impulse = type === 'impulse';
            const state = { type, unit, yMin, yMax, xMin: impulse ? -2 : 20, xMax: impulse ? 30 : 20000,
                logX: !impulse, series: [{ color: '#fff', label: 'Measured', points: [[20, yMin], [20000, yMax]] }],
                record: { sampleRate: 1000, onsetIndex: 2, refScale: 1, data: Float32Array.of(0, -1e-6, 1e-6, 0) },
                origin: 0, windowBefore: 2, windowAfter: 2, window: 'rectangular', peakNormalized: false };
            const context = renderer.canvas.getContext('2d');
            context.labels = [];
            renderer.draw(state, { width, height: 400, dpr: 2 });
            const originalPlot = { ...renderer.plot };
            assert.equal(renderer.plot.left > 60, expanded);
            assert.equal(renderer.plot.left + renderer.plot.width, width - 22);
            assert.equal(renderer.canvas.width, width * 2);
            const labels = context.labels.filter(label => label.align === 'right');
            assert.ok(labels.length > 0);
            for (const label of labels) {
                assert.ok(label.x - context.measureText(label.text).actualBoundingBoxLeft >= 8);
                assert.equal(label.x, renderer.plot.left - 8);
                assert.equal(label.y, renderer.scaleY(Number(label.text)) + 4);
            }
            assert.equal(renderer.scaleX(state.xMin), renderer.plot.left);
            assert.equal(renderer.scaleX(state.xMax), renderer.plot.left + renderer.plot.width);
            const mid = impulse ? 14 : Math.sqrt(20 * 20000);
            assert.ok(Math.abs(renderer.inverseX(renderer.scaleX(mid)) - mid) < 1e-9);
            if (!impulse) assert.match(renderer.read(renderer.scaleX(1000), 100).cursor, /^1000.0 Hz/);
            const exportIndex = canvases.length;
            renderer.renderImage({ title: 'Exact scale' });
            const exported = canvases[exportIndex].getContext('2d').labels.filter(label => label.align === 'right');
            assert.deepEqual(exported, labels);
            assert.deepEqual(renderer.plot, originalPlot);
        }
    }
});
