import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisPlot, interpolateCurve, distortionValue } from '../../features/measurement/ui/analysis-plot.js';
import AnalysisController from '../../features/measurement/ui/analysis-controller.js';
import CorrectionHandler from '../../features/measurement/ui/correction-handler.js';
import { replaceGlobal } from '../helpers/global-test-utils.mjs';

test('IR scrollbar follows rendered viewport, origin and available observation interval', t => {
    const elements = new Map();
    t.after(replaceGlobal('document', { getElementById(id) {
        if (!elements.has(id)) elements.set(id, {});
        return elements.get(id);
    } }));
    const controller = new AnalysisController({ graphColors: { original: '#fff' },
        measurementDisplay: { selectedPointIndex: 0, selectedChannel: 'all' } });
    controller.activeTab = 'impulse';
    controller.measurement = { points: [{}] };
    controller.capabilities = { impulse: true };
    controller.readyGeneration = controller.generation;
    controller.record = { sampleRate: 1000, onsetIndex: 100, data: new Float32Array(1000) };
    controller.plots.impulse = { draw() {} };
    Object.assign(controller.settings.impulse, { xMin: 100, xMax: 300, origin: 0 });
    controller.draw();
    const slider = elements.get('impulseResponseScroll');
    assert.equal(slider.disabled, false);
    assert.equal(slider.value, 250);
    Object.assign(controller.settings.impulse, { xMin: 300, xMax: 500, origin: 100 });
    controller.draw();
    assert.equal(slider.value, 625);
    controller.zoomImpulse(0.5);
    assert.ok(Math.abs(slider.value - 550 / 900 * 1000) < 1e-10);
    Object.assign(controller.settings.impulse, { xMin: -200, xMax: 800 });
    controller.draw();
    assert.equal(slider.disabled, true);
    assert.equal(slider.value, 0);
    Object.assign(controller.settings.impulse, { xMin: 100, xMax: 300 });
    controller.draw();
    assert.equal(slider.disabled, false);
    controller.readyGeneration = null;
    controller.draw();
    assert.equal(slider.disabled, true);
});

test('frequency plot snapshots follow the live correction range controls', t => {
    const elements = {
        targetLowFreqSlider: { value: '20' }, targetHighFreqSlider: { value: '20000' },
        frequencyAnalysisConditions: {}, frequencyCopyGraph: {}
    };
    t.after(replaceGlobal('document', { getElementById: id => elements[id] || null }));
    const controller = new AnalysisController({ correctionHandler: CorrectionHandler.prototype,
        measurementDisplay: { selectedPointIndex: 0, selectedChannel: 'all' } });
    controller.measurement = { points: [{}] };
    controller.capabilities = { frequency: true };
    controller.readyGeneration = controller.generation;
    controller.frequencySeries = () => [];
    controller.plots.frequency = { draw() {} };
    controller.draw();
    assert.ok(Math.abs(controller.copySnapshots.frequency.state.frequencyMarkers[0] - 20) < 1e-10);
    assert.ok(Math.abs(controller.copySnapshots.frequency.state.frequencyMarkers[1] - 20000) < 1e-10);
    elements.targetLowFreqSlider.value = '1000';
    controller.draw();
    assert.equal(controller.copySnapshots.frequency.state.frequencyMarkers[0], 1000);
    delete elements.targetLowFreqSlider;
    controller.draw();
    assert.equal(controller.copySnapshots.frequency.state.frequencyMarkers, undefined);
});

test('frequency correction markers use current axes in both graph and copied image', t => {
    const canvases = [];
    const makeCanvas = () => {
        let path = [];
        const strokes = [];
        const ctx = {
            strokes, setTransform() {}, fillRect() {}, fillText() {}, setLineDash() {},
            save() {}, restore() {}, rect() {}, clip() {}, scale() {}, drawImage() {},
            beginPath() { path = []; }, moveTo(x, y) { path.push([x, y]); }, lineTo(x, y) { path.push([x, y]); },
            stroke() { strokes.push({ color: this.strokeStyle, path }); },
            measureText(text) { return { width: text.length * 6 }; }
        };
        const canvas = { style: {}, getContext: () => ctx, addEventListener() {}, removeEventListener() {},
            getBoundingClientRect: () => ({ width: 800, height: 400 }) };
        canvases.push(canvas);
        return canvas;
    };
    t.after(replaceGlobal('window', { ThemePalette: { get: name => name } }));
    t.after(replaceGlobal('document', { createElement: makeCanvas }));
    const plot = new AnalysisPlot(makeCanvas(), null);
    t.after(() => plot.surface.destroy());
    const state = { type: 'frequency', xMin: 40, xMax: 4000, yMin: -24, yMax: 24,
        unit: 'dB', series: [], frequencyMarkers: [20, 80, 1000, 20000] };
    plot.draw(state);
    const expected = [80, 1000].map(frequency => [[plot.scaleX(frequency), plot.plot.top],
        [plot.scaleX(frequency), plot.plot.top + plot.plot.height]]);
    const markers = canvas => canvas.getContext('2d').strokes.filter(stroke => stroke.color === 'text-primary').map(stroke => stroke.path);
    assert.deepEqual(markers(canvases[0]), expected);
    plot.renderImage({ title: 'Frequency Response' });
    assert.deepEqual(markers(canvases[1]), expected);
    for (const hiddenState of [{ ...state, frequencyMarkers: undefined }, { ...state, type: 'distortion' }]) {
        canvases[0].getContext('2d').strokes.length = 0;
        plot.draw(hiddenState);
        assert.deepEqual(markers(canvases[0]), []);
    }
});

test('analysis readout interpolates drawn logarithmic segments without bridging missing data', () => {
    const points = [[100, 0], [1000, 20], [2000, null], [4000, 4]];
    assert.ok(Math.abs(interpolateCurve(points, Math.sqrt(100 * 1000)) - 10) < 1e-10);
    assert.equal(interpolateCurve(points, 1500), null);
    assert.equal(interpolateCurve(points, 3000), null);
    assert.equal(interpolateCurve(points, 50), null);
    assert.equal(interpolateCurve(points, 1000), 20);
});

test('distortion units derive from the same ratio and preserve missing values', () => {
    assert.equal(distortionValue(0.001, '%'), 0.1);
    assert.equal(distortionValue(0.001, 'dBr'), -60);
    assert.equal(distortionValue(null, '%'), null);
    assert.equal(distortionValue(0, '%'), 0);
    assert.equal(distortionValue(0, 'dBr'), null);
});

test('frequency readouts pair the observed frequency with one wavelength in meters', () => {
    const plot = Object.create(AnalysisPlot.prototype);
    plot.plot = {}; plot.dpr = 1;
    plot.inverseX = value => value; plot.scaleY = value => value;
    for (const type of ['frequency', 'distortion', 'waterfall']) {
        plot.state = { type, depthUnit: 'cycles', unit: 'dB', series: [{ label: 'Observed', color: '#fff', points: [[20, 0], [20000, 0]] }] };
        for (const [frequency, distance] of [[20, '17'], [1000, '0.34'], [20000, '0.017']]) {
            plot.surface = { read: () => ({ frequency, time: 0.01, cycles: 10, level: -2, x: 1, y: 1 }) };
            const result = plot.read(frequency, 0);
            assert.ok(result.cursor.startsWith(`${frequency.toFixed(1)} Hz · λ ${distance} m`), `${type}: ${result.cursor}`);
            if (type === 'waterfall') assert.match(result.cursor, /10.00 ms · 10.00 cycles$/);
        }
    }
});

test('IR readout excludes unobserved time and anchors the displayed sample', () => {
    const plot = Object.create(AnalysisPlot.prototype);
    plot.state = { type: 'impulse', origin: 0, unit: '×', record: { onsetIndex: 16, sampleRate: 8000, data: new Float32Array(80) },
        series: [{ label: 'IR', color: '#fff' }] };
    plot.plot = {}; plot.dpr = 2;
    plot.inverseX = value => value;
    plot.scaleX = value => value;
    plot.scaleY = value => value;
    plot.amplitude = value => value;
    plot.envelope = [{ minimumIndex: 16, maximumIndex: 16, minimum: 1, maximum: 1 }];
    assert.equal(plot.read(-3, 0), null);
    assert.equal(plot.read(8, 0), null);
    const result = plot.read(0, 0);
    assert.equal(result.cursor, '0.000 ms');
    assert.deepEqual(result.at, { x: 0, y: 2 });
    assert.match(result.rows[0].value, /1.000/);
});
