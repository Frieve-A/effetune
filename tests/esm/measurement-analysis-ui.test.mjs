import assert from 'node:assert/strict';
import test from 'node:test';
import { AnalysisPlot, interpolateCurve, distortionValue } from '../../features/measurement/ui/analysis-plot.js';
import AnalysisController from '../../features/measurement/ui/analysis-controller.js';
import { getAnalysisCapabilities, getValidHarmonicAnalysis } from '../../features/measurement/measurement-model.js';
import CorrectionHandler from '../../features/measurement/ui/correction-handler.js';
import GraphRenderer from '../../features/measurement/ui/graph-renderer.js';
import dataStorage from '../../features/measurement/dataStorage.js';
import audioUtils from '../../features/measurement/audio-utils/index.js';
import { replaceGlobal } from '../helpers/global-test-utils.mjs';
import { analyzeBurstDecay, analyzeWaterfall, MAX_ANALYSIS_WINDOW_SAMPLES, BURST_TAU_CYCLES, BURST_MINIMUM_SLICES } from '../../js/utils/measurement-dsp/analysis.js';
import { buildWaterfallMesh } from '../../features/measurement/ui/waterfall-surface.js';

test('distortion quality warnings preserve usable data and reject malformed current records', () => {
    const record = { data: Float32Array.of(0, 1, 0), sampleRate: 8000, onsetIndex: 1,
        harmonicAnalysis: { version: 2, method: 'ess', sampleRate: 8000, reference: 'unit-input',
            calibration: 'uncorrected-system', quality: { valid: false, reasons: [] },
            excitation: { startFrequency: 20, endFrequency: 3500, durationSeconds: 1, sweepSamples: 8000, levelDb: -6 },
            orders: [1, 2, 3].map(order => ({ order, onsetIndex: 1, validMinFrequency: 22, validMaxFrequency: 3150 / order,
                data: Float32Array.of(0, 1, 0), referenceData: Float32Array.of(0, 1, 0),
                ...(order > 1 ? { harmonicReferenceData: Float32Array.of(0, 1, 0) } : {}) })) } };
    const controller = Object.create(AnalysisController.prototype);
    const messageFor = current => {
        controller.record = current;
        controller.capabilities = getAnalysisCapabilities(current);
        return controller.distortionQualityWarning();
    };
    assert.equal(getValidHarmonicAnalysis(record), record.harmonicAnalysis);
    const quality = record.harmonicAnalysis.quality;
    for (const [reason, action] of [
        ['clipping', /Lower the playback level or input gain/],
        ['inconsistent-capture', /Keep the microphone and speakers still/],
        ['clock-drift', /Check the audio-device setup/],
        ['overlapping-tail', /Increase Requested sweep length/],
        ['insufficient-harmonic-band', /Widen the sweep range/]
    ]) {
        quality.reasons = [reason];
        const message = messageFor(record);
        assert.match(message, /may be inaccurate/);
        assert.equal(controller.capabilities.distortion, true);
        assert.match(message, action);
        assert.ok(!message.includes(reason));
    }
    quality.reasons = ['inconsistent-capture', 'overlapping-tail', 'overlapping-tail'];
    assert.equal(messageFor(record).match(/Increase Requested sweep length/g).length, 1);
    assert.match(messageFor(record), /Keep the microphone and speakers still/);
    for (const reasons of [[], ['private-unknown-diagnostic']]) {
        quality.reasons = reasons;
        const message = messageFor(record);
        assert.match(message, /Check the recording setup/);
        assert.ok(!message.includes('private-unknown-diagnostic'));
    }
    quality.reasons = ['overlapping-tail'];
    for (const current of [null, { ...record, harmonicAnalysis: undefined },
        { ...record, harmonicAnalysis: { ...record.harmonicAnalysis, orders: [] } },
        { ...record, sampleRate: 16000 }, { ...record, data: Float32Array.of(NaN) }]) {
        assert.equal(messageFor(current), '');
        assert.equal(controller.capabilities.distortion, false);
    }
    quality.valid = true;
    quality.reasons = [];
    assert.equal(getAnalysisCapabilities(record).distortion, true);
    assert.equal(messageFor(record), '');
});

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
        frequencyAnalysisConditions: {}, frequencyCopyGraph: {}, frequencyAutoRange: {}
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
    assert.equal(distortionValue(0.01, '%'), 1);
    assert.equal(distortionValue(0.01, 'dBr'), -40);
    assert.equal(distortionValue(0.1, '%'), 10);
    assert.equal(distortionValue(0.1, 'dBr'), -20);
    assert.equal(distortionValue(0.001, '%'), 0.1);
    assert.equal(distortionValue(0.001, 'dBr'), -60);
    assert.equal(distortionValue(null, '%'), null);
    assert.equal(distortionValue(0, '%'), 0);
    assert.equal(distortionValue(0, 'dBr'), null);
});

test('distortion display limit bounds the THD ceiling and window using only selected recorded orders', () => {
    const controller = new AnalysisController({});
    controller.capabilities = { distortion: true };
    controller.record = { sampleRate: 1000, harmonicAnalysis: { orders: Array.from({ length: 10 }, (_, index) => ({
        order: index + 1, onsetIndex: index < 3 ? 2 : 1,
        data: new Float32Array(index < 3 ? 22 : 10), validMinFrequency: 20, validMaxFrequency: 1000
    })) } };
    const settings = controller.settings.distortion;
    controller.validateSettings('distortion');
    assert.deepEqual([settings.harmonicLimit, settings.maxOrder, settings.before, settings.after], [3, 3, 2, 20]);
    settings.harmonicLimit = 10;
    controller.validateSettings('distortion');
    assert.deepEqual([settings.harmonicLimit, settings.maxOrder, settings.before, settings.after], [10, 3, 1, 9]);
    settings.maxOrder = 10;
    settings.harmonicLimit = 2;
    controller.validateSettings('distortion');
    assert.equal(settings.maxOrder, 2);
    settings.harmonicLimit = 10;
    controller.validateSettings('distortion');
    assert.equal(settings.maxOrder, 2);
    controller.record.harmonicAnalysis.orders.length = 3;
    controller.validateSettings('distortion');
    assert.equal(settings.harmonicLimit, 3);
    assert.equal(settings.maxOrder, 2);
    controller.record.harmonicAnalysis.orders.length = 2;
    controller.syncControls = () => {};
    controller.refresh = () => {};
    controller.reset('distortion');
    assert.deepEqual([controller.settings.distortion.harmonicLimit, controller.settings.distortion.maxOrder], [2, 2]);
});

test('analysis parameter domains follow observed units and support rather than generic ranges', () => {
    const controller = new AnalysisController({});
    controller.record = { sampleRate: 8000, onsetIndex: 16, refScale: 10, data: new Float32Array(4096) };
    controller.record.data[16] = 1;
    assert.deepEqual(controller.controlRange('frequency', 'xMin'), [1, 3999, 1, true]);
    controller.settings.frequency.xMin = 5000; controller.settings.frequency.xMax = 96000;
    controller.validateSettings('frequency');
    assert.deepEqual([controller.settings.frequency.xMin, controller.settings.frequency.xMax], [3999, 4000]);
    assert.deepEqual(controller.controlRange('impulse', 'origin'), [-2, 510, 0.01]);
    controller.settings.impulse.origin = 10;
    assert.deepEqual(controller.controlRange('impulse', 'xMin'), [-12, 499.99, 0.1]);
    controller.settings.impulse.normalize = false;
    assert.deepEqual(controller.controlRange('impulse', 'yMin'), [-0.2, 0.199, 0.1, false]);
    controller.settings.impulse.db = true;
    assert.deepEqual(controller.controlRange('impulse', 'yMin'), [-180, 179.9, 1, false]);
    assert.deepEqual(controller.controlRange('frequency', 'before'), [0, 2, 0.1, true]);
    assert.deepEqual(controller.controlRange('frequency', 'after'), [0.25, 510, 1, true]);
    controller.settings.waterfall.start = 9999;
    controller.settings.waterfall.end = 0;
    controller.settings.waterfall.length = 60000;
    controller.validateSettings('waterfall');
    assert.equal(controller.settings.waterfall.start, 509.5);
    assert.equal(controller.settings.waterfall.length, 0.375);
    assert.ok(controller.settings.waterfall.end > controller.settings.waterfall.start);
    controller.settings.waterfall.mode = 'burst';
    controller.settings.waterfall.xMin = 1;
    controller.settings.waterfall.xMax = 4000;
    controller.settings.waterfall.startCycles = 100;
    controller.settings.waterfall.endCycles = 100;
    controller.validateSettings('waterfall');
    assert.equal(controller.settings.waterfall.xMin, 10);
    assert.equal(controller.settings.waterfall.xMax, Math.floor(4000 / 2 ** (1 / 6)));
    assert.deepEqual([controller.settings.waterfall.startCycles, controller.settings.waterfall.endCycles], [99.9, 100]);
});

test('analysis maximum windows respect the DSP sample cap and burst starts retain drawable support', () => {
    const controller = new AnalysisController({});
    for (const sampleRate of [44100, 48000, 192000]) {
        controller.record = { sampleRate, onsetIndex: MAX_ANALYSIS_WINDOW_SAMPLES, data: new Float32Array(2 * MAX_ANALYSIS_WINDOW_SAMPLES) };
        Object.assign(controller.settings.frequency, { before: 1e9, after: 1e9 });
        controller.validateSettings('frequency');
        const { before, after } = controller.settings.frequency;
        assert.ok(Math.round(before / 1000 * sampleRate) + Math.ceil(after / 1000 * sampleRate) <= MAX_ANALYSIS_WINDOW_SAMPLES);
        controller.settings.waterfall.length = 1e9;
        controller.validateSettings('waterfall');
        assert.ok(Math.round(controller.settings.waterfall.length / 1000 * sampleRate) <= MAX_ANALYSIS_WINDOW_SAMPLES);
    }
    controller.record = { sampleRate: 8000, onsetIndex: 16, data: new Float32Array(128) };
    controller.record.data[16] = 1;
    Object.assign(controller.settings.waterfall, { mode: 'burst', xMin: 20, xMax: 4000, start: 1e9, end: 1e9,
        startCycles: 100, endCycles: 100 });
    controller.validateSettings('waterfall');
    const s = controller.settings.waterfall;
    for (const depthUnit of ['seconds', 'cycles']) {
        const start = depthUnit === 'seconds' ? s.start / 1000 : s.startCycles / s.xMax;
        assert.ok(controller.record.onsetIndex + (start + 4 * BURST_TAU_CYCLES / s.xMax) * controller.record.sampleRate <= controller.record.data.length - 1);
        const result = analyzeBurstDecay(controller.record, { depthUnit, startSeconds: s.start / 1000, endSeconds: s.end / 1000,
            startCycles: s.startCycles, endCycles: s.endCycles, minFrequency: s.xMin, maxFrequency: s.xMax, maxSlices: BURST_MINIMUM_SLICES });
        assert.ok(buildWaterfallMesh({ ...s, waterfall: result }).triangles.length > 0);
    }
});

test('analysis increments and readouts match the meaning of each control', () => {
    const controller = new AnalysisController({});
    for (const [tab, key, step, value, formatted] of [
        ['frequency', 'yMin', 1, -24.123, '-24.1'], ['frequency', 'reference', 0.1, 1.234, '1.2'],
        ['frequency', 'smoothing', 0.01, 0.345, '0.34'], ['frequency', 'before', 0.1, 1.234, '1.23'],
        ['frequency', 'after', 1, 100.123, '100.12'], ['impulse', 'origin', 0.01, 0.123, '0.123'],
        ['impulse', 'xMin', 0.1, -1.234, '-1.23'], ['waterfall', 'length', 1, 0.125, '0.125'],
        ['waterfall', 'rise', 0.1, 5.123, '5.12'], ['waterfall', 'start', 0.1, 2.123, '2.12'],
        ['waterfall', 'startCycles', 0.1, 2.123, '2.1'], ['waterfall', 'angle', 1, 35.123, '35.1'],
        ['waterfall', 'elevation', 1, 35.123, '35.1'], ['waterfall', 'zoom', 0.1, 1.234, '1.23']
    ]) {
        assert.equal(controller.controlRange(tab, key)[2], step, `${tab}.${key}`);
        assert.equal(controller.formatControlValue(tab, key, value), formatted, `${tab}.${key}`);
    }
    Object.assign(controller.settings.waterfall, { angle: 35.12345, elevation: 43.54321, zoom: 1.23456 });
    controller.validateSettings('waterfall');
    assert.equal(controller.settings.waterfall.angle, 35.12345);
    assert.equal(controller.settings.waterfall.elevation, 43.54321);
    assert.equal(controller.settings.waterfall.zoom, 1.23456);
});

test('small ratio views preserve significant values and raw IR ranges follow the signal', () => {
    const controller = new AnalysisController({});
    const s = controller.settings.distortion;
    for (const value of [1e-7, 1.23e-7, 0.000123, 0.00123, 0.123, 10]) {
        Object.assign(s, { yMin: 0, yMax: value }); controller.validateSettings('distortion');
        assert.equal(s.yMax, value);
        assert.equal(Number(controller.formatControlValue('distortion', 'yMax', value)), value);
    }
    Object.assign(s, { yMin: 1e-7, yMax: 1.01e-7 }); controller.validateSettings('distortion');
    assert.deepEqual([s.yMin, s.yMax], [1e-7, 1.01e-7]);
    controller.syncControls = () => {}; controller.refresh = () => {};
    controller.activeTab = 'distortion'; controller.readyGeneration = controller.generation;
    controller.currentPlotState = { ...s, type: 'distortion', unit: '%', series: [{ points: [[20, 0.000123], [1000, 0.000234]] }] };
    controller.autoRange('distortion');
    assert.ok(s.yMin > 0 && s.yMin < 0.000123 && s.yMax > 0.000234 && s.yMax < 0.001);
    s.unit = 'dBr';
    controller.currentPlotState = { ...s, type: 'distortion', unit: 'dBr', series: [{ points: [[20, -40.123], [1000, -39.789]] }] };
    controller.autoRange('distortion');
    assert.ok(s.yMin <= -40.123 && s.yMax >= -39.789);
    assert.equal(Number(s.yMin.toFixed(1)), s.yMin); assert.equal(Number(s.yMax.toFixed(1)), s.yMax);
    controller.record = { sampleRate: 48000, onsetIndex: 16, refScale: 1, data: new Float32Array(512) };
    controller.record.data[16] = 0.000001;
    controller.settings.impulse.normalize = false;
    controller.activeTab = 'impulse';
    controller.currentPlotState = { ...controller.settings.impulse, type: 'impulse', unit: '×' };
    controller.autoRange('impulse');
    const range = controller.controlRange('impulse', 'yMax');
    assert.ok(range[1] > 0.000001 && range[1] <= 0.000002);
    assert.ok(range[2] < 0.000001);
    assert.ok(controller.settings.impulse.yMax > controller.record.data[16]);
    assert.ok(controller.settings.impulse.yMin < -controller.record.data[16]);
});

test('auto range only consumes a completed plot in the current target, unit and presentation', () => {
    const controller = new AnalysisController({});
    controller.targetKey = 'current'; controller.readyGeneration = controller.generation;
    controller.syncControls = () => {};
    let refreshes = 0; controller.refresh = () => { refreshes++; };
    const settings = controller.settings.frequency;
    const completed = { ...settings, type: 'frequency', unit: 'dB', targetKey: 'current', series: [{ points: [[20, -3], [20000, 3]] }] };
    const before = structuredClone(settings);
    controller.currentPlotState = completed; controller.readyGeneration = null;
    controller.autoRange('frequency'); assert.deepEqual(settings, before);
    controller.readyGeneration = controller.generation;
    for (const mismatch of [{ targetKey: 'previous' }, { unit: '%' }, { source: 'ir' }, { reference: 1 }, { normalize: false }, { smoothing: 0.5 }]) {
        controller.currentPlotState = { ...completed, ...mismatch };
        controller.autoRange('frequency'); assert.deepEqual(settings, before);
    }
    assert.equal(refreshes, 0);
    controller.currentPlotState = completed; controller.autoRange('frequency');
    assert.equal(refreshes, 1); assert.ok(settings.yMin <= -3 && settings.yMax >= 3);
});

test('ordinary Waterfall window and latest-start endpoints produce drawable meshes at supported rates', () => {
    for (const sampleRate of [8000, 48000, 192000]) {
        const controller = new AnalysisController({});
        controller.record = { sampleRate, onsetIndex: 128, data: new Float32Array(16384) };
        controller.record.data[128] = 1;
        const s = controller.settings.waterfall;
        controller.validateSettings('waterfall');
        for (const endpoint of ['minimum length', 'maximum length', 'latest start']) {
            Object.assign(s, { start: 0, end: 1e9, length: endpoint === 'maximum length' ? 1e9 : 0, rise: 0 });
            if (endpoint === 'latest start') s.start = 1e9;
            controller.validateSettings('waterfall');
            const result = analyzeWaterfall(controller.record, { startSeconds: s.start / 1000, endSeconds: s.end / 1000,
                windowSeconds: s.length / 1000, riseSeconds: s.rise / 1000, window: 'tukey', maxSlices: 48 });
            assert.ok(buildWaterfallMesh({ ...s, waterfall: result }).triangles.length > 0, `${sampleRate}: ${endpoint}`);
        }
    }
});

test('frequency readouts pair the observed frequency with one wavelength in meters', () => {
    const plot = Object.create(AnalysisPlot.prototype);
    plot.hoveredSeries = null;
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
    plot.hoveredSeries = null;
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


test('WAV export follows only the current completed selection, including failed and superseded loads', async t => {
    const elements = new Map();
    t.after(replaceGlobal('document', {
        getElementById(id) {
            if (!elements.has(id)) elements.set(id, {});
            return elements.get(id);
        },
        querySelectorAll: () => []
    }));
    const measurements = ['a', 'b', 'c'].map(id => ({ id, name: `Measurement ${id}`, outputChannel: 'left',
        points: [{ pointId: 0, name: 'Seat', ir: { stored: true }, frequencyResponse: [[100, 0], [1000, 0]] }] }));
    const records = measurements.map(({ id }, index) => ({ measurementId: id, pointId: 0,
        sampleRate: 48000, onsetIndex: 0, data: Float32Array.of(index + 1, 0) }));
    const loads = [];
    const exports = [];
    t.mock.method(dataStorage, 'getMeasurementById', id => measurements.find(measurement => measurement.id === id));
    t.mock.method(dataStorage, 'getImpulseResponse', () => new Promise((resolve, reject) => loads.push({ resolve, reject })));
    t.mock.method(audioUtils, 'exportWAV', (...args) => exports.push(args));
    t.mock.method(console, 'error', () => {});
    const ui = { selectedMeasurementId: 'a', measurementDisplay: { selectedPointIndex: 0, selectedChannel: 'all' } };
    ui.graphRenderer = new GraphRenderer(ui);
    const controller = new AnalysisController(ui);
    controller.activeTab = 'details';
    controller.controls.frequency = { source: { options: [{}, {}] } };
    for (const method of ['syncControls', 'validateSettings', 'updateDetails']) t.mock.method(controller, method, () => {});
    const button = document.getElementById('exportImpulseResponseWav');
    const assertUnavailable = () => {
        assert.equal(button.disabled, true);
        assert.equal(ui.graphRenderer.impulseResponse, null);
        const count = exports.length;
        ui.graphRenderer.exportImpulseResponseWav();
        assert.equal(exports.length, count);
    };
    let pending = controller.refresh();
    loads[0].resolve(records[0]);
    await pending;
    assert.equal(button.disabled, false);
    ui.graphRenderer.exportImpulseResponseWav();
    assert.equal(exports[0][0], records[0].data);
    assert.match(exports[0][2], /^measurement_a_seat_/);

    ui.selectedMeasurementId = 'b';
    pending = controller.refresh();
    assertUnavailable();
    loads[1].reject(new Error('read failed'));
    await pending;
    assertUnavailable();

    const superseded = controller.refresh();
    ui.selectedMeasurementId = 'c';
    pending = controller.refresh();
    loads[2].resolve(records[1]);
    await superseded;
    assertUnavailable();
    loads[3].resolve(records[2]);
    await pending;
    assert.equal(button.disabled, false);
    ui.graphRenderer.exportImpulseResponseWav();
    assert.equal(exports[1][0], records[2].data);
    assert.match(exports[1][2], /^measurement_c_seat_/);

    ui.selectedMeasurementId = 'missing';
    await controller.refresh();
    assertUnavailable();
});
