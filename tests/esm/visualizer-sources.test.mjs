import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { VisualizerSources } from '../../js/visualizer/visualizer-sources.js';

test('Oscilloscope shares captures by trigger settings while display edits stay local', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const subscriptions = new Map(), published = [];
    globalThis.window = { OscilloscopePlugin: class {
        parseDspScopeTelemetryFrame(frame) { return frame.snapshot; }
    } };
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, frameType, callback) {
            subscriptions.set(tapId, { frameType, callback });
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); }
    };
    try {
        const sources = new VisualizerSources(manager);
        const first = { id: 'a', type: 'oscilloscope', channel: null,
            params: { dt: 0.01, tm: 'Auto', tl: 0, te: 'Rising', ho: 0.0001,
                dl: 0, vo: 0, showAxes: false, showAxisNumbers: false } };
        sources.setLayout({ items: [first, { ...first, id: 'b', params: { ...first.params, dl: -24 } }] });
        sources.setVisible(true);
        assert.equal(published.at(-1).length, 1);
        const source = published.at(-1)[0];
        assert.deepEqual([source.type, source.params, source.gainDb], ['OscilloscopePlugin',
            { dt: 0.01, tm: 'Auto', tl: 0, te: 'Rising', ho: 0.0001 }, 0]);
        assert.equal(subscriptions.get(source.tapId).frameType, 3);
        const snapshot = { values: Float32Array.of(0, 1, 0) };
        subscriptions.get(source.tapId).callback({ snapshot });
        assert.equal(sources.getFrame('a'), snapshot);
        assert.equal(sources.getFrame('b'), snapshot);
        sources.setLayout({ items: [{ ...first, params: { ...first.params,
            dl: -48, vo: 0.5, showAxes: true } }] });
        assert.equal(published.at(-1)[0].tapId, source.tapId);
        sources.setLayout({ items: [{ ...first, params: { ...first.params, tm: 'Normal' } }] });
        assert.notEqual(published.at(-1)[0].tapId, source.tapId);
        sources.dispose();
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});

test('Chroma shares its native automatic HQ source across display edits and stops when hidden', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const subscriptions = new Map(), published = [], received = [];
    globalThis.window = {};
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, type, callback) {
            subscriptions.set(tapId, { type, callback });
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); }
    };
    try {
        const sources = new VisualizerSources(manager);
        const first = { id: 'a', type: 'chroma', channel: null, params: { dm: 0, lo: 1, hi: 7 } };
        sources.setLayout({ items: [first, { ...first, id: 'b', params: { dm: 1, lo: 3, hi: 5 } }] });
        sources.subscribeItem('a', (frame, producer) => received.push([frame, producer]));
        sources.setVisible(true);
        assert.equal(published.at(-1).length, 1);
        const source = published.at(-1)[0];
        assert.equal(source.type, 'ChromaSpiralPlugin');
        assert.deepEqual(source.params, {});
        assert.equal(source.gainDb, 0);
        assert.equal(subscriptions.get(source.tapId).type, 4);
        const producer = {}, payload = new DataView(new ArrayBuffer(4));
        subscriptions.get(source.tapId).callback({ formatVersion: 2, payload }, producer);
        assert.equal(received[0][0].payload, payload);
        assert.equal(received[0][1], producer);
        sources.setLayout({ items: [{ ...first, params: { dm: 1, lo: 4, hi: 6, ft: -2, lr: 48, df: -90 } }] });
        assert.equal(published.at(-1)[0].tapId, source.tapId);
        sources.setVisible(false);
        assert.deepEqual(published.at(-1), []);
        subscriptions.get(source.tapId).callback({ formatVersion: 2, payload }, producer);
        assert.equal(received.length, 1);
        sources.setVisible(true);
        sources.setLayout({ items: [{ ...first, channel: 'R' }] });
        assert.notEqual(published.at(-1)[0].tapId, source.tapId);
        assert.equal(published.at(-1)[0].channel, 'R');
        sources.dispose();
        assert.equal(subscriptions.size, 0);
    } finally {
        globalThis.window = oldWindow; globalThis.document = oldDocument;
    }
});

test('Phase Map shares one parameter-free Phase Select EQ source across display edits', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const subscriptions = new Map(), published = [], received = [];
    globalThis.window = {};
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, frameType, callback) {
            subscriptions.set(tapId, { frameType, callback });
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); }
    };
    try {
        const sources = new VisualizerSources(manager);
        const first = { id: 'a', type: 'phase', channel: null, params: { ax: 'phase', dr: -72, pe: 0.5 } };
        sources.setLayout({ items: [first, { ...first, id: 'b', params: { ax: 'balance', dr: -48, pe: 2 } }] });
        sources.subscribeItem('b', (frame, producer) => received.push([frame, producer]));
        sources.setVisible(true);
        assert.equal(published.at(-1).length, 1);
        const source = published.at(-1)[0];
        assert.deepEqual([source.type, source.params, source.gainDb], ['PhaseSelectEqPlugin', {}, 0]);
        assert.equal(subscriptions.get(source.tapId).frameType, 20);
        const producer = {}, payload = new DataView(new ArrayBuffer(16));
        subscriptions.get(source.tapId).callback({ frameType: 20, formatVersion: 2, payload }, producer);
        assert.equal(received[0][0].payload, payload);
        assert.equal(received[0][1], producer);
        sources.setLayout({ items: [{ ...first, params: { ax: 'balance', dr: -24, pe: 1 } }] });
        assert.equal(published.at(-1)[0].tapId, source.tapId);
        sources.dispose();
        assert.equal(subscriptions.size, 0);
    } finally {
        globalThis.window = oldWindow; globalThis.document = oldDocument;
    }
});

test('Analog Meter sources carry only the detector parameters of the Analog Meter effect', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const subscriptions = new Map(), published = [];
    globalThis.window = {};
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, frameType, callback) {
            subscriptions.set(tapId, { frameType, callback });
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); }
    };
    try {
        const sources = new VisualizerSources(manager);
        const params = { md: 'PPM', it: 0.3, at: 5, rt: 1.5, rl: -14, rg: 40, sc: 1, ph: 1, ln: 0, tg: -23, ls: 0 };
        sources.setLayout({ items: [{ id: 'a', type: 'analog-meter', channel: null, params }] });
        sources.subscribeItem('a', () => {});
        sources.setVisible(true);
        const source = published.at(-1)[0];
        assert.deepEqual([source.type, source.params, source.gainDb],
            ['AnalogMeterPlugin', { md: 'PPM', it: 0.3, at: 5, rt: 1.5, ln: 0,
                de: 'Average Rectified', nr: 300, os: 1.25 }, 0]);
        assert.equal(subscriptions.get(source.tapId).frameType, 27);
        sources.setLayout({ items: [{ id: 'a', type: 'analog-meter', channel: null,
            params: { ...params, rl: -18, rg: 60, sc: 2, dc: 4, ph: 3, tg: -16, ls: 1, dialCurvature: 0,
                faceShape: 'circle', showPercent: true, needleTip: 'arrow', vignette: 0.8 } }] });
        assert.equal(published.at(-1)[0].tapId, source.tapId);
        sources.setLayout({ items: [{ id: 'a', type: 'analog-meter', channel: null, params: { ...params, md: 'VU' } }] });
        assert.notEqual(published.at(-1)[0].tapId, source.tapId);
        const custom = { ...params, md: 'Custom', de: 'RMS', nr: 1000, os: 0, dc: 3 };
        sources.setLayout({ items: [{ id: 'a', type: 'analog-meter', channel: null, params: custom }] });
        assert.deepEqual(published.at(-1)[0].params,
            { md: 'Custom', it: 0.3, at: 5, rt: 1.5, ln: 0, de: 'RMS', nr: 1000, os: 0 });
        for (const [key, value] of [['de', 'True Peak'], ['nr', 10], ['os', 15]]) {
            const previousTap = published.at(-1)[0].tapId;
            custom[key] = value;
            sources.setLayout({ items: [{ id: 'a', type: 'analog-meter', channel: null, params: custom }] });
            assert.notEqual(published.at(-1)[0].tapId, previousTap, key);
        }
        sources.dispose();
    } finally {
        globalThis.window = oldWindow; globalThis.document = oldDocument;
    }
});

test('Guitar sources detect only the playable notes and keep the stream across display edits', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const subscriptions = new Map(), published = [];
    globalThis.window = {};
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, frameType, callback) {
            subscriptions.set(tapId, { frameType, callback });
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); }
    };
    try {
        const sources = new VisualizerSources(manager);
        const params = { tn: [40, 45, 50, 55, 59, 64], fm: 0, fx: 12, cp: 0, pm: 'all', lb: 'sharp' };
        sources.setLayout({ items: [{ id: 'g', type: 'guitar', channel: null, params }] });
        sources.subscribeItem('g', () => {});
        sources.setVisible(true);
        const source = published.at(-1)[0];
        assert.deepEqual([source.type, source.params], ['NoteSpectrogramPlugin', { mn: 40, mx: 76 }]);
        assert.equal(subscriptions.get(source.tapId).frameType, 24);
        sources.setLayout({ items: [{ id: 'g', type: 'guitar', channel: null, params: { ...params, pm: 'shape', lb: 'interval' } }] });
        assert.equal(published.at(-1)[0].tapId, source.tapId);
        sources.setLayout({ items: [{ id: 'g', type: 'guitar', channel: null, params: { ...params, cp: 2 } }] });
        assert.deepEqual(published.at(-1)[0].params, { mn: 42, mx: 76 });
        sources.dispose();
    } finally {
        globalThis.window = oldWindow; globalThis.document = oldDocument;
    }
});

test('Guitar and Notes share their DSP source only when analysis settings and channels match', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const subscriptions = new Map(), published = [], received = [];
    globalThis.window = { NoteSpectrogramPlugin: class {
        parseTelemetryFrame(frame) { return frame.snapshot; }
    } };
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, frameType, callback) {
            subscriptions.set(tapId, { frameType, callback });
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); }
    };
    try {
        const sources = new VisualizerSources(manager);
        const guitar = { id: 'guitar', type: 'guitar', channel: null,
            params: { tn: [40, 45, 50, 55, 59, 64], fm: 0, fx: 12, cp: 0 } };
        const notes = { id: 'notes', type: 'notes', channel: null,
            params: { mn: 40, mx: 76 } };
        sources.setLayout({ items: [guitar, notes] });
        sources.setVisible(true);
        assert.equal(published.at(-1).length, 1);
        assert.equal(subscriptions.size, 1);
        const shared = published.at(-1)[0];
        assert.deepEqual([shared.type, shared.params, shared.channel, shared.gainDb],
            ['NoteSpectrogramPlugin', { mn: 40, mx: 76 }, null, 0]);
        assert.equal(subscriptions.get(shared.tapId).frameType, 24);
        sources.subscribeItem(guitar.id, frame => received.push(frame));
        sources.subscribeItem(notes.id, frame => received.push(frame));
        const snapshot = { notes: [40, 64] };
        subscriptions.get(shared.tapId).callback({ snapshot });
        assert.equal(sources.getFrame(guitar.id), snapshot);
        assert.equal(sources.getFrame(notes.id), snapshot);
        assert.equal(received.length, 2);
        assert.equal(received[0], received[1]);
        for (const different of [
            { ...notes, params: { ...notes.params, mn: 41 } },
            { ...notes, params: { ...notes.params, mx: 77 } },
            { ...notes, channel: 'R' }
        ]) {
            sources.setLayout({ items: [guitar, different] });
            assert.equal(published.at(-1).length, 2);
            assert.equal(subscriptions.size, 2);
            assert.ok(published.at(-1).some(source => source.tapId === shared.tapId));
            sources.setLayout({ items: [guitar, notes] });
            assert.equal(published.at(-1).length, 1);
            assert.equal(published.at(-1)[0].tapId, shared.tapId);
        }
        sources.dispose();
        assert.equal(subscriptions.size, 0);
    } finally {
        globalThis.window = oldWindow; globalThis.document = oldDocument;
    }
});

test('Level Meter reuses its parameter-free telemetry source across display edits', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const subscriptions = new Map(), published = [], received = [];
    globalThis.window = { LevelMeterPlugin: class {
        parseDspLevelTelemetryFrame(frame) { return frame.measurements; }
    } };
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, frameType, callback) {
            subscriptions.set(tapId, { frameType, callback });
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); }
    };
    try {
        const sources = new VisualizerSources(manager);
        const meter = { id: 'meter', type: 'level-meter', channel: 'R',
            params: { showAxes: false, showAxisNumbers: false } };
        sources.setLayout({ items: [meter] });
        sources.subscribeItem(meter.id, (frame, producer) => received.push([frame, producer]));
        sources.setVisible(true);
        const source = published.at(-1)[0];
        assert.deepEqual([source.type, source.channel, source.params, source.gainDb],
            ['LevelMeterPlugin', 'R', {}, 0]);
        assert.equal(subscriptions.get(source.tapId).frameType, 1);
        const measurements = { channels: [{ peak: 0.5, rms: 0.25, clipped: false }] };
        const producer = {};
        subscriptions.get(source.tapId).callback({ frameType: 1, formatVersion: 1, measurements }, producer);
        assert.deepEqual(sources.getFrame(meter.id), measurements);
        assert.equal(received[0][1], producer);
        sources.setLayout({ items: [{ ...meter, flipX: true,
            params: { showAxes: true, showAxisNumbers: true,
                orientation: 'vertical', showLevelValues: true } }] });
        assert.equal(published.at(-1)[0].tapId, source.tapId);
        assert.deepEqual(published.at(-1)[0].params, {}, 'Display controls do not enter the DSP source');
        sources.setVisible(false);
        assert.deepEqual(published.at(-1), []);
        sources.dispose();
        assert.equal(subscriptions.size, 0);
    } finally {
        globalThis.window = oldWindow; globalThis.document = oldDocument;
    }
});

test('Visualizer sources share matching analyzers and stop outside the visible view', () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const listeners = new Map();
    const subscriptions = new Map();
    const published = [];
    globalThis.document = {
        hidden: false,
        addEventListener(type, callback) { listeners.set(type, callback); },
        removeEventListener(type) { listeners.delete(type); }
    };
    globalThis.window = {
        location: { search: '' },
        audioPreferences: { useWasmDsp: true },
        SpectrumAnalyzerPlugin: class {
            parseDspSpectrumTelemetryFrame(frame) { return frame.snapshot; }
        },
        LevelMeterPlugin: class {
            parseDspLevelTelemetryFrame(frame) { return frame.snapshot; }
        }
    };
    const manager = {
        isDspReady: () => true,
        telemetryHub: {
            subscribe(tapId, frameType, callback) {
                subscriptions.set(tapId, { frameType, callback });
                return () => subscriptions.delete(tapId);
            }
        },
        addEventListener() {},
        removeEventListener() {},
        setVisualizerSources(sources) { published.push(sources); }
    };
    try {
        const sources = new VisualizerSources(manager);
        sources.setLayout({ items: [
            { id: 'a', type: 'spectrum', channel: null,
                effects: [{ mod: { source: 'level' } }] },
            { id: 'b', type: 'spectrum', channel: null },
            { id: 'single', type: 'spectrum', channel: '12' },
            { id: 'c', type: 'notes', channel: 'R' }
        ] });
        sources.setVisible(true);
        assert.equal(sources.getStatus(), 'ready');
        assert.equal(published.at(-1).length, 4);
        assert.equal(subscriptions.size, 4);
        const spectrum = published.at(-1).find(source => source.type === 'SpectrumAnalyzerPlugin' && source.channel === null);
        const single = published.at(-1).find(source => source.type === 'SpectrumAnalyzerPlugin' && source.channel === '12');
        const meter = published.at(-1).find(source => source.type === 'LevelMeterPlugin');
        assert.notEqual(spectrum.tapId, single.tapId);
        const receivedA = [];
        const receivedB = [];
        const stopA = sources.subscribeItem('a', (frame, producer) => receivedA.push([frame, producer]));
        sources.subscribeItem('b', frame => receivedB.push(frame));
        const snapshot = { points: 12, sampleRate: 48000, current: Float32Array.of(-12, -24) };
        const rawFrame = { snapshot };
        const producer = {};
        subscriptions.get(spectrum.tapId).callback(rawFrame, producer);
        assert.equal(sources.getFrame('a'), snapshot);
        assert.equal(sources.getFrame('b'), snapshot);
        assert.equal(receivedA[0][0].snapshot, snapshot);
        assert.equal(receivedA[0][0], receivedB[0]);
        assert.equal(receivedA[0][1], producer);
        assert.ok(receivedA[0][0].source);
        assert.equal(sources.getFrame('single'), null);
        assert.equal(sources.getModulators().level, 0, 'Spectrum bins do not stand in for overall RMS');
        subscriptions.get(meter.tapId).callback({ snapshot: { channels: [{ rms: 0.25 }, { rms: 0.1 }] } });
        assert.equal(sources.getModulators().level, 1);
        const singleSnapshot = { current: Float32Array.of(-6) };
        subscriptions.get(single.tapId).callback({ snapshot: singleSnapshot });
        assert.equal(sources.getFrame('single'), singleSnapshot);
        assert.equal(sources.getFrame('a'), snapshot);
        stopA();
        sources.setLayout({ items: [{ id: 'single', type: 'spectrum', channel: '12',
            effects: [{ mod: { source: 'bass' } }] }] });
        assert.equal(published.at(-1).length, 2);
        assert.equal(published.at(-1).find(source => source.channel === null).type, 'SpectrumAnalyzerPlugin');
        assert.equal(sources.getFrame('single'), singleSnapshot);
        globalThis.document.hidden = true;
        listeners.get('visibilitychange')();
        assert.equal(published.at(-1).length, 0);
        assert.equal(sources.getFrame('a'), null);
        globalThis.document.hidden = false;
        sources.setLayout({ items: [{ id: 'particle', type: 'stereo',
            effects: [{ type: 'particles', mod: { source: 'none' } }] }] });
        listeners.get('visibilitychange')();
        assert.equal(published.at(-1).length, 2);
        sources.dispose();
        assert.equal(subscriptions.size, 0);
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});

test('Level and frequency-band modulation use separate adaptive ranges and share one spectrum', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const oldPerformance = globalThis.performance;
    const subscriptions = new Map(), published = [];
    let milliseconds = 0;
    globalThis.performance = { now: () => milliseconds };
    globalThis.window = {
        LevelMeterPlugin: class { parseDspLevelTelemetryFrame(frame) { return frame.snapshot; } },
        SpectrumAnalyzerPlugin: class { parseDspSpectrumTelemetryFrame(frame) { return frame.snapshot; } }
    };
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, _frameType, callback) {
            subscriptions.set(tapId, callback);
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); }
    };
    try {
        const sources = new VisualizerSources(manager);
        sources.setLayout({ background: { effects: [
            { enabled: true, mod: { source: 'level' } },
            { enabled: true, mod: { source: 'bass' } },
            { enabled: true, mod: { source: 'mid' } },
            { enabled: true, mod: { source: 'treble' } }
        ] }, items: [{ id: 'spectrum', type: 'spectrum', params: {},
            effects: [{ mod: { source: 'mid' } }, { mod: { source: 'treble' } }] }] });
        sources.setVisible(true);
        assert.equal(published.at(-1).length, 2);
        const meter = published.at(-1).find(source => source.type === 'LevelMeterPlugin');
        const spectrum = published.at(-1).find(source => source.type === 'SpectrumAnalyzerPlugin');
        const spectrumAt = db => {
            const current = new Float32Array(2049).fill(-240);
            for (const index of [8, 80, 800]) {
                current[index - 1] = current[index + 1] = db - 6.0206;
                current[index] = db;
            }
            return { points: 12, sampleRate: 48000, current };
        };
        const quiet = { level: 0, bass: 0, mid: 0, treble: 0, beat: 0, width: 0 };
        const loud = { ...quiet, level: 1, bass: 1, mid: 1, treble: 1 };
        subscriptions.get(meter.tapId)({ snapshot: { channels: [{ rms: 0.1 }, { rms: 0.04 }] } });
        subscriptions.get(spectrum.tapId)({ snapshot: spectrumAt(-12) });
        assert.deepEqual(sources.getModulators(), loud);

        milliseconds = 1000;
        subscriptions.get(meter.tapId)({ snapshot: { channels: [{ rms: 0.1 * 10 ** (-12 / 20) }] } });
        subscriptions.get(spectrum.tapId)({ snapshot: spectrumAt(-24) });
        const quieter = sources.getModulators();
        assert.ok(quieter.level > 0.49 && quieter.level < 0.51, JSON.stringify(quieter));
        for (const band of ['bass', 'mid', 'treble']) {
            assert.ok(quieter[band] > 0.49 && quieter[band] < 0.52, JSON.stringify(quieter));
        }

        milliseconds = 2250;
        subscriptions.get(meter.tapId)({ snapshot: { channels: [{ rms: 0.1 * 10 ** (-12 / 20) }] } });
        subscriptions.get(spectrum.tapId)({ snapshot: spectrumAt(-24) });
        assert.deepEqual(sources.getModulators(), loud,
            'The held reference follows a sustained quieter passage');

        sources.setVisible(false);
        assert.deepEqual(sources.getModulators(), quiet);
        sources.setVisible(true);
        const restartedMeter = published.at(-1).find(source => source.type === 'LevelMeterPlugin');
        const restartedSpectrum = published.at(-1).find(source => source.type === 'SpectrumAnalyzerPlugin');
        subscriptions.get(restartedMeter.tapId)({ snapshot: { channels: [{ rms: 0.0001 }] } });
        subscriptions.get(restartedSpectrum.tapId)({ snapshot: spectrumAt(-90) });
        assert.deepEqual(sources.getModulators(), quiet);

        // A strong tone in one band must not drive either of the other bands.
        for (const [band, index, sampleRate] of [
            ['bass', 8, 48000], ['mid', 80, 48000], ['treble', 800, 48000],
            // Exact 150 Hz, 2 kHz and 20 kHz bins keep the upper boundary in its band.
            ['bass', 15, 40960], ['mid', 200, 40960], ['treble', 2000, 40960]
        ]) {
            sources.setVisible(false);
            sources.setVisible(true);
            const activeSpectrum = published.at(-1).find(source => source.type === 'SpectrumAnalyzerPlugin');
            const snapshot = spectrumAt(-240);
            snapshot.sampleRate = sampleRate;
            snapshot.current[index] = -12;
            subscriptions.get(activeSpectrum.tapId)({ snapshot });
            assert.deepEqual(sources.getModulators(), { ...quiet, [band]: 1 });
        }
        sources.dispose();
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
        globalThis.performance = oldPerformance;
    }
});

test('Beat and Width share analyzer sources and Beat interpolates real DSP telemetry between draws', async () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const oldPerformance = globalThis.performance;
    const subscriptions = new Map(), published = [];
    let milliseconds = 0;
    const pluginWindow = {};
    vm.runInNewContext(await readFile(new URL('../../plugins/analyzer/rhythm_analyzer.js', import.meta.url), 'utf8'),
        { PluginBase: class {}, window: pluginWindow, console });
    globalThis.performance = { now: () => milliseconds };
    globalThis.window = {
        RhythmAnalyzerPlugin: pluginWindow.RhythmAnalyzerPlugin,
        StereoMeterPlugin: class { parseDspStereoFieldTelemetryFrame(frame) { return frame.snapshot; } }
    };
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, frameType, callback) {
            subscriptions.set(tapId, { frameType, callback });
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); }
    };
    const frame = (period = 0.5, preview = null) => {
        const payload = new DataView(new ArrayBuffer(1496));
        payload.setFloat32(0, 48000, true);
        payload.setUint32(4, 1, true);
        payload.setUint32(8, 480, true);
        payload.setUint32(12, 100, true);
        // Host time is deliberately different from the generation's analysis time.
        payload.setFloat32(16, 42.123, true);
        payload.setFloat32(40, period > 0 ? 0.7 : 0, true);
        payload.setFloat32(44, period, true);
        payload.setUint32(48, 100, true);
        payload.setFloat32(60, period > 0 ? 60 / period : 0, true);
        if (preview) {
            payload.setUint32(1344, 1, true);
            payload.setFloat32(1348, preview.period, true);
            payload.setInt32(1352, preview.frame, true);
        }
        return { frameType: 28, formatVersion: 4, payload };
    };
    const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
    const sources = new VisualizerSources(manager);
    try {
        const items = [{ id: 'rhythm', type: 'rhythm-analyzer', params: {} },
            { id: 'stereo', type: 'stereo', params: {}, effects: [{ mod: { source: 'beat' } }] }];
        sources.setLayout({ items, background: { effects: [
            { mod: { source: 'beat' } }, { mod: { source: 'width' } }
        ] } });
        sources.setVisible(true);
        assert.equal(published.at(-1).length, 2, 'Display and modulation share the same analyzer instances');
        const rhythm = published.at(-1).find(source => source.type === 'RhythmAnalyzerPlugin');
        const stereo = published.at(-1).find(source => source.type === 'StereoMeterPlugin');
        assert.equal(subscriptions.get(rhythm.tapId).frameType, 28);
        const receiveBeat = subscriptions.get(rhythm.tapId).callback;
        receiveBeat(frame());
        assert.equal(sources.getFrame('rhythm').periodSeconds, 0.5, 'The real Rhythm parser consumes the payload');
        for (const [time, value] of [[0, 1], [125, 0.5], [250, 0], [500, 1]]) {
            milliseconds = time;
            near(sources.getModulators().beat, value);
        }
        milliseconds = 1000;
        receiveBeat(frame(1));
        milliseconds = 1250;
        near(sources.getModulators().beat, 0.5);
        milliseconds = 1500;
        near(sources.getModulators().beat, 0);
        // The current preview takes precedence over the older committed interval.
        receiveBeat(frame(0.5, { frame: 75, period: 1 }));
        near(sources.getModulators().beat, 0.5);
        milliseconds = 1750;
        near(sources.getModulators().beat, 0);
        receiveBeat(frame(0));
        assert.equal(sources.getModulators().beat, 0);
        for (const [correlation, width] of [[1, 0], [-1, 0], [0, 1], [0.5, 0.5], [-0.5, 0.5]]) {
            subscriptions.get(stereo.tapId).callback({ snapshot: { correlation, peakL: 0, peakR: 0 } });
            assert.equal(sources.getModulators().width, width, 'Width follows correlation even for silent samples');
        }
        receiveBeat(frame());
        sources.setVisible(false);
        assert.equal(sources.getModulators().beat, 0);
        assert.equal(sources.getModulators().width, 0);
        sources.setVisible(true);
        assert.equal(sources.getModulators().beat, 0);
        assert.equal(sources.getModulators().width, 0);
        sources.setLayout({ items: items.map(item => ({ ...item, effects: [] })) });
        assert.equal(published.at(-1).length, 2, 'Removing modulation preserves the displayed analyzers');
        const resumedRhythm = published.at(-1).find(source => source.type === 'RhythmAnalyzerPlugin');
        subscriptions.get(resumedRhythm.tapId).callback(frame());
        assert.equal(sources.getModulators().beat, 0, 'A remaining display tap cannot drive disabled modulation');
    } finally {
        sources.dispose();
        assert.equal(subscriptions.size, 0);
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
        globalThis.performance = oldPerformance;
    }
});

test('Visualizer activation and DSP reinitialization start fresh Spectrum and Notes streams', () => {
    const oldWindow = globalThis.window, oldDocument = globalThis.document;
    const subscriptions = new Map(), published = [], received = [];
    const events = new Map();
    let hostVisibilityChanged;
    globalThis.window = {
        electronAPI: { onWindowVisibilityChanged(callback) {
            hostVisibilityChanged = callback;
            return () => { hostVisibilityChanged = null; };
        } },
        SpectrumAnalyzerPlugin: class { parseDspSpectrumTelemetryFrame(frame) { return frame.snapshot; } },
        NoteSpectrogramPlugin: class { parseTelemetryFrame(frame) { return frame.snapshot; } }
    };
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, _type, callback) {
            subscriptions.set(tapId, callback);
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); },
        addEventListener(type, callback) { events.set(type, callback); },
        removeEventListener(type, callback) { if (events.get(type) === callback) events.delete(type); }
    };
    try {
        const sources = new VisualizerSources(manager);
        sources.setLayout({ items: [
            { id: 'spectrum', type: 'spectrum', params: { sc: 'log-hq' } },
            { id: 'notes', type: 'notes' }
        ] });
        sources.subscribeItem('spectrum', frame => received.push(['spectrum', frame.source]));
        sources.subscribeItem('notes', frame => received.push(['notes', frame.source]));
        sources.setVisible(true);
        const original = published.at(-1);
        const oldCallbacks = new Map(original.map(source => [source.type, subscriptions.get(source.tapId)]));
        for (const source of original) oldCallbacks.get(source.type)({ snapshot: { frameIndex: 100 } });
        assert.equal(received.length, 2);

        sources.setVisible(false);
        assert.deepEqual(published.at(-1), []);
        sources.setVisible(true);
        const restarted = published.at(-1);
        assert.deepEqual(restarted.map(source => source.type), original.map(source => source.type));
        for (let index = 0; index < original.length; index++) {
            assert.notEqual(restarted[index].tapId, original[index].tapId);
            assert.equal(subscriptions.has(original[index].tapId), false);
            const before = received.length;
            oldCallbacks.get(original[index].type)({ snapshot: { frameIndex: 101 } });
            assert.equal(received.length, before, 'Old telemetry cannot enter the restarted stream');
            subscriptions.get(restarted[index].tapId)({ snapshot: { frameIndex: 0 } });
            assert.notEqual(received.at(-1)[1], received[index][1]);
            assert.equal(sources.getFrame(['spectrum', 'notes'][index]).frameIndex, 0);
        }
        const beforeMinimize = restarted.map(source => source.tapId);
        hostVisibilityChanged({ hidden: true });
        assert.deepEqual(published.at(-1), []);
        hostVisibilityChanged({ hidden: false });
        assert.ok(published.at(-1).every((source, index) => source.tapId !== beforeMinimize[index]));
        const beforeDspRestart = published.at(-1).map(source => source.tapId);
        events.get('dspReady')();
        assert.ok(published.at(-1).every((source, index) => source.tapId !== beforeDspRestart[index]));
        sources.dispose();
        assert.equal(hostVisibilityChanged, null);
        assert.equal(events.has('dspReady'), false);
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});

test('Visualizer sources retain display-only edits and replace analysis sources without stale delivery', () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const subscriptions = new Map();
    const published = [];
    globalThis.window = { location: { search: '' }, audioPreferences: { useWasmDsp: true } };
    globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
    const manager = {
        telemetryHub: { subscribe(tapId, _type, callback) {
            subscriptions.set(tapId, callback);
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published.push(sources); }
    };
    try {
        const sources = new VisualizerSources(manager);
        const received = [];
        sources.subscribeItem('one', (frame, producer) => received.push([frame, producer]));
        const item = { id: 'one', type: 'spectrum', channel: null,
            params: { pt: 12, sc: 'log', dr: -96, gainDb: 0, kb: false } };
        sources.setLayout({ items: [item] });
        sources.setVisible(true);
        const first = published.at(-1)[0];
        const oldCallback = subscriptions.get(first.tapId);
        oldCallback({ frameType: 4, formatVersion: 1 });
        const firstIdentity = received[0][0].source;
        sources.setLayout({ items: [{ ...item, params: { ...item.params, sc: 'linear',
            dr: -72, kb: true, showAxes: false }, flipX: true }] });
        assert.equal(published.at(-1)[0].tapId, first.tapId);
        sources.setLayout({ items: [{ ...item, params: { ...item.params,
            sc: 'log-hq', gainDb: 6 } }] });
        const next = published.at(-1)[0];
        assert.notEqual(next.tapId, first.tapId);
        assert.deepEqual([next.params.pt, next.params.sc, next.params.hq, next.gainDb],
            [12, 'log-hq', true, 6]);
        oldCallback({ stale: true });
        assert.equal(received.length, 1);
        const hq = { frameType: 4, formatVersion: 2 };
        const producer = {};
        subscriptions.get(next.tapId)(hq, producer);
        assert.equal(received.length, 2);
        assert.equal(received[1][0].formatVersion, 2);
        assert.notEqual(received[1][0].source, firstIdentity);
        assert.equal(received[1][1], producer);
        sources.dispose();
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});

test('Visualizer status follows primary DSP readiness across failure and reinitialization', () => {
    const oldWindow = globalThis.window;
    const oldDocument = globalThis.document;
    const worklet = {};
    const capabilities = new Map();
    globalThis.window = { location: { search: '' }, audioPreferences: { useWasmDsp: true } };
    globalThis.document = { addEventListener() {}, removeEventListener() {} };
    const manager = {
        isDspReady: () => capabilities.has(worklet),
        setVisualizerSources() {},
        telemetryHub: { subscribe: () => () => {} }
    };
    try {
        const beforeReady = new VisualizerSources(manager);
        assert.equal(beforeReady.getStatus(), 'unavailable');
        capabilities.set(worklet, { kernels: [] });
        assert.equal(beforeReady.getStatus(), 'ready');
        capabilities.delete(worklet);
        assert.equal(beforeReady.getStatus(), 'unavailable');
        const afterFailure = new VisualizerSources(manager);
        assert.equal(afterFailure.getStatus(), 'unavailable');
        capabilities.set(worklet, { kernels: [] });
        assert.equal(beforeReady.getStatus(), 'ready');
        assert.equal(afterFailure.getStatus(), 'ready');
        beforeReady.dispose();
        afterFailure.dispose();
    } finally {
        globalThis.window = oldWindow;
        globalThis.document = oldDocument;
    }
});
