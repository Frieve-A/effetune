import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import '../../plugins/multires-spectrum.js';
import { createAnalyzerDisplay, createSpectrumSmoother } from '../../js/visualizer/visualizer-analyzer-display.js';
import { createBallistics, stepBallistics } from '../../js/visualizer/visualizer-ballistics.js';
import { VisualizerRenderer } from '../../js/visualizer/visualizer-renderer.js';
import { createDefaultLayout, createItem } from '../../js/visualizer/visualizer-model.js';
import { VisualizerSources } from '../../js/visualizer/visualizer-sources.js';
import { withGlobals } from '../helpers/global-test-utils.mjs';

function canvas() {
    const calls = [];
    const context = new Proxy({
        calls,
        createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
        measureText: text => ({ width: text.length * 7, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 }),
        createLinearGradient: () => ({ addColorStop() {} }),
        createRadialGradient: () => ({ addColorStop() {} }),
        createConicGradient: (...coordinates) => {
            const gradient = { coordinates, stops: [], addColorStop(position, color) { this.stops.push([position, color]); } };
            calls.push(['createConicGradient', gradient]);
            return gradient;
        }
    }, {
        get(target, key) { return key in target ? target[key] : (...args) => calls.push([key, ...args]); },
        set(target, key, value) {
            if (key === 'fillStyle' || key === 'strokeStyle' || key === 'globalAlpha') calls.push([key, value]);
            target[key] = value;
            return true;
        }
    });
    return { width: 800, height: 400, getContext: () => context, context };
}

function runtime() {
    let constructions = 0, registrations = 0;
    const clock = { now: 1000 };
    class PluginBase {
        constructor() { constructions++; }
        registerProcessor() { registrations++; }
        updateParameters() {}
        parseFiniteNumber(value, min, max, fallback) {
            return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
        }
    }
    const window = { ThemePalette: { get: name => name === 'graph-trace' ? 'rgba(0,255,0,1)' : 'rgba(16,16,16,1)' } };
    const document = { createElement: () => canvas(), addEventListener() {}, removeEventListener() {} };
    for (const file of ['frequency-axis', 'analyzer/spectrum_analyzer', 'analyzer/spectrogram', 'analyzer/oscilloscope', 'analyzer/stereo_meter',
        'analyzer/note_spectrogram', 'analyzer/chroma_spiral', 'analyzer/level_meter', 'analyzer/analog_meter',
        'analyzer/rhythm_analyzer', 'spatial/phase_select_eq']) {
        vm.runInNewContext(readFileSync(new URL(`../../plugins/${file}.js`, import.meta.url), 'utf8'),
            { window, document, PluginBase, performance: { now: () => clock.now }, Float32Array, DataView, ArrayBuffer,
                MultiresSpectrum: globalThis.MultiresSpectrum, console });
    }
    const subscribers = new Map();
    const sources = {
        subscribeItem(id, callback) { subscribers.set(id, callback); return () => subscribers.delete(id); },
        getFrame: () => null, getModulators: () => ({ level: 0, bass: 0 })
    };
    return { window, document, sources, subscribers, clock, counts: () => [constructions, registrations] };
}

function noteFrame(index = 1) {
    const payload = new DataView(new ArrayBuffer(8840));
    payload.setFloat32(0, 48000, true);
    payload.setFloat32(4, index * .01, true);
    payload.setUint16(8, 440, true);
    payload.setUint16(10, 21, true);
    payload.setFloat32(12, .01, true);
    payload.setUint32(16, index, true);
    payload.setUint32(20, 5, true);
    payload.setUint32(24, 1, true);
    for (let pitch = 0; pitch < 440; pitch++) {
        payload.setFloat32(32 + pitch * 4, pitch === 197 ? .8 : 0, true);
        payload.setFloat32(32 + 440 * 4 + pitch * 4, pitch === 197 ? -42 : -240, true);
    }
    return { frameType: 24, formatVersion: 5, payload };
}

test('Notes and HQ Spectrum accept the first frame after returning to Visualizer', async () => {
    const env = runtime(), subscriptions = new Map();
    let published = [];
    env.document.hidden = false;
    env.document.addEventListener = () => {};
    env.document.removeEventListener = () => {};
    const manager = {
        telemetryHub: { subscribe(tapId, _type, callback) {
            subscriptions.set(tapId, callback);
            return () => subscriptions.delete(tapId);
        } },
        setVisualizerSources(sources) { published = sources; }
    };
    await withGlobals(env, () => {
        const spectrum = createItem('spectrum', 'spectrum');
        spectrum.params.sc = 'log-hq';
        const notes = createItem('notes', 'notes');
        const sources = new VisualizerSources(manager);
        sources.setLayout({ items: [spectrum, notes] });
        sources.setVisible(true);
        const spectrumDisplay = createAnalyzerDisplay(spectrum, canvas(), sources);
        const notesDisplay = createAnalyzerDisplay(notes, canvas(), sources);
        env.window.SpectrumAnalyzerPlugin.prototype.parseDspSpectrumTelemetryFrame = frame => frame.snapshot;
        const send = (type, frame) => {
            const source = published.find(entry => entry.type === type);
            assert.ok(source);
            subscriptions.get(source.tapId)(frame, {});
        };
        const spectrumFrame = frameIndex => ({ frameType: 4, formatVersion: 2,
            snapshot: { highQuality: true, points: 12, generation: 1, frameIndex,
                sampleRate: 48000, current: Float32Array.of(-12), peaks: Float32Array.of(-12) } });
        send('SpectrumAnalyzerPlugin', spectrumFrame(100));
        send('NoteSpectrogramPlugin', noteFrame(100));
        assert.equal(spectrumDisplay.plugin.hqFrameIndex, 100);
        assert.equal(notesDisplay.plugin.lastFrameIndex, 100);

        sources.setVisible(false);
        sources.setVisible(true);
        send('SpectrumAnalyzerPlugin', spectrumFrame(0));
        send('NoteSpectrogramPlugin', noteFrame(1));
        assert.equal(spectrumDisplay.plugin.hqFrameIndex, 0);
        assert.equal(notesDisplay.plugin.lastFrameIndex, 1);
        spectrumDisplay.dispose();
        notesDisplay.dispose();
        sources.dispose();
    });
});

test('Visualizer uses the original analyzer drawing methods without constructing audio pipeline plugins', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        for (const [type, name, method] of [
            ['spectrum', 'SpectrumAnalyzerPlugin', 'drawGraph'],
            ['spectrogram', 'SpectrogramPlugin', 'drawGraph'],
            ['oscilloscope', 'OscilloscopePlugin', 'drawWaveform'],
            ['stereo', 'StereoMeterPlugin', 'drawMeter'],
            ['notes', 'NoteSpectrogramPlugin', 'drawGraph'],
            ['level-meter', 'LevelMeterPlugin', 'updateMeter'],
            ['phase', 'PhaseSelectEqPlugin', 'drawVisualizerPhaseMap'],
            ['analog-meter', 'AnalogMeterPlugin', 'drawVisualizerMeter'],
            ['rhythm-analyzer', 'RhythmAnalyzerPlugin', 'drawVisualizerRhythm']
        ]) {
            const baseline = env.counts();
            const item = createItem(type, type), target = canvas();
            const display = createAnalyzerDisplay(item, target, env.sources);
            assert.equal(display.plugin[method], env.window[name].prototype[method]);
            display.draw(item, 1, 400);
            assert.equal(display.plugin.graphDpr, 2);
            assert.deepEqual(env.counts(), baseline);
            const original = new env.window[name]();
            // Time ballistics and the peak toggle are display-side; only Analog Meter's ph is a plugin field.
            const displayKeys = type === 'analog-meter' ? [] : ['cf', 'ph', 'pf', 'sm', 'pk'];
            for (const key of Object.keys(item.params).filter(key => key in original && !displayKeys.includes(key))) {
                assert.equal(display.plugin[key], item.params[key], `${type}.${key}`);
            }
            display.dispose();
            assert.equal(env.subscribers.has(type), false);
        }
    });
});

test('Analog Meter folds a single selected channel and names it after the input channel', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = { ...createItem('analog-meter', 'meter'), channel: 'R' };
        item.params.md = 'Loudness';
        const target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        assert.equal(display.plugin.channelCount, 1);
        const payload = new DataView(new ArrayBuffer(4 + 16 + 24));
        payload.setUint8(0, 5);
        payload.setUint8(1, 2);
        payload.setUint16(2, 3, true);
        [-20, -18, -21, -19, -23, -22, -24, 6, -1, 12].forEach((value, index) =>
            payload.setFloat32(4 + index * 4, value, true));
        env.subscribers.get('meter')({ frameType: 27, formatVersion: 1, payload }, {});
        const reading = display.plugin.reading;
        assert.equal(reading.channels.length, 1);
        assert.equal(reading.channels[0].needleDb, -20);
        assert.ok(Math.abs(reading.program.momentary - (-23 - 10 * Math.log10(2))) < 1e-4);
        assert.equal(display.plugin.cellTitle(0), 'Ch 2 (reference)');
        display.draw(item, 1, 400);
        assert.ok(target.context.calls.some(([key]) => key === 'stroke'));
        display.dispose();
    });
});

test('VU appearance draws percentages, signs, cropped needles and separate meter faces with effects', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('analog-meter', 'meter');
        Object.assign(item.params, { showPercent: true, readoutUnit: 'percent', showSigns: true,
            showChannel: false, showMode: false, hubSize: 0, needleStart: 40, needleTip: 'taper',
            dialCurvature: 0, faceShape: 'circle', faceOpacity: 1, vignette: 0.5, faceBorderWidth: 3 });
        item.effects = [{ type: 'glow', enabled: true }];
        const target = canvas(), display = createAnalyzerDisplay(item, target, env.sources);
        display.plugin.reading = { channels: [{ needleDb: -14, maxDb: -14 }, { needleDb: -20, maxDb: -20 }] };
        display.draw(item, 1, 800);
        const labels = target.context.calls.filter(([key]) => key === 'fillText').map(([, label]) => label);
        assert.ok(labels.includes('100.0%'));
        assert.ok(labels.includes('50.1%'));
        assert.equal(labels.filter(label => label === '100%').length, 2);
        assert.equal(labels.filter(label => label === '+').length, 2);
        assert.equal(labels.filter(label => label === '−').length, 2);
        assert.equal(labels.some(label => label.startsWith('Ch ')), false);
        assert.equal(labels.includes('VU'), false);
        const signal = display.signalCanvas.context.calls;
        assert.equal(signal.filter(([key]) => key === 'clip').length, 2, 'Each separated needle keeps its window clip');
        assert.equal(signal.filter(([key]) => key === 'closePath').length, 2, 'Tapered needle is a filled triangle');
        assert.equal(signal.some(([key]) => key === 'arc'), false, 'Hidden hubs do not draw');
        const faces = display.underlayCanvas.context.calls;
        assert.equal(faces.filter(([key]) => key === 'fill').length, 2, 'Both face fills remain below the signal layer');
        item.params.md = 'RMS';
        target.context.calls.length = 0;
        display.draw(item, 2, 800);
        assert.equal(target.context.calls.some(([key, label]) => key === 'fillText' && label.includes('%')), false);
        display.dispose();
    });
});

test('Thick arrow needles keep a pointed tip without a shaft stroke beneath it', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = { ...createItem('analog-meter', 'meter'), channel: 'L' };
        Object.assign(item.params, { showAxes: false, showAxisNumbers: false, hubSize: 0 });
        const target = canvas(), display = createAnalyzerDisplay(item, target, env.sources);
        for (const width of [0.5, 2, 8]) {
            for (const hidden of [0, 90]) {
                for (const db of [-24, -14]) {
                    Object.assign(item.params, { needleWidth: width, needleStart: hidden, needleTip: 'line' });
                    display.plugin.reading = { channels: [{ needleDb: db, maxDb: db }] };
                    target.context.calls.length = 0;
                    display.draw(item, 1, 800);
                    const [, baseX, baseY] = target.context.calls.find(([key]) => key === 'moveTo');
                    const [, tipX, tipY] = target.context.calls.find(([key]) => key === 'lineTo');
                    const length = Math.hypot(tipX - baseX, tipY - baseY);
                    const ux = (tipX - baseX) / length, uy = (tipY - baseY) / length;

                    item.params.needleTip = 'arrow';
                    target.context.calls.length = 0;
                    display.draw(item, 1, 800);
                    const calls = target.context.calls;
                    assert.equal(calls.some(([key]) => key === 'stroke'), false, 'No thick centerline can blunt the tip');
                    assert.equal(calls.filter(([key]) => key === 'fill').length, 1, 'Shaft and head form one silhouette');
                    const vertices = calls.filter(([key]) => key === 'moveTo' || key === 'lineTo');
                    const tips = vertices.filter(([, x, y]) => Math.hypot(x - tipX, y - tipY) < 1e-9);
                    assert.equal(tips.length, 1, 'Arrow retains the fixed needle endpoint');
                    for (const [, x, y] of vertices) {
                        const along = (x - baseX) * ux + (y - baseY) * uy;
                        assert.ok(along >= -1e-9 && along <= length + 1e-9, 'Arrow stays within the visible needle length');
                        if (Math.hypot(x - tipX, y - tipY) >= 1e-9) assert.ok(along < length - 1e-9,
                            'Only the pointed vertex reaches the tip');
                    }
                }
            }
        }
        display.dispose();
    });
});

test('Arrow aspect changes its proportions while the tip stays fixed, and hub size reaches zero', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = { ...createItem('analog-meter', 'meter'), channel: 'L' };
        Object.assign(item.params, { showAxes: false, showAxisNumbers: false, hubSize: 0, needleTip: 'arrow', needleWidth: 8 });
        const target = canvas(), display = createAnalyzerDisplay(item, target, env.sources);
        display.plugin.reading = { channels: [{ needleDb: -14, maxDb: -14 }] };
        let fixedTip;
        for (const ratio of [0.25, 1, 4]) {
            for (const hidden of [0, 90]) {
                Object.assign(item.params, { arrowAspect: ratio, needleStart: hidden });
                target.context.calls.length = 0;
                display.draw(item, 1, 800);
                const points = target.context.calls.filter(([key]) => key === 'moveTo' || key === 'lineTo');
                const [, x1, y1] = points[2], [, tx, ty] = points[3], [, x2, y2] = points[4];
                const width = Math.hypot(x2 - x1, y2 - y1);
                const length = Math.hypot(tx - (x1 + x2) / 2, ty - (y1 + y2) / 2);
                assert.ok(Math.abs(length / width - ratio) < 1e-9);
                fixedTip ??= [tx, ty];
                assert.deepEqual([tx, ty], fixedTip, 'Changing arrow proportions never moves the needle endpoint');
            }
        }
        for (const size of [0, 1, 3, 20]) {
            item.params.hubSize = size;
            target.context.calls.length = 0;
            display.draw(item, 1, 800);
            const hubs = target.context.calls.filter(([key]) => key === 'arc');
            assert.equal(hubs.length, size === 0 ? 0 : 1);
            if (size > 0) assert.equal(hubs[0][3], size * display.plugin.graphDpr);
        }
        display.dispose();
    });
});

test('VU needles rotate with voltage at a fixed length through every dial shape and sweep', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = { ...createItem('analog-meter', 'meter'), channel: 'L' };
        Object.assign(item.params, { showAxes: false, showAxisNumbers: false });
        const target = canvas(), display = createAnalyzerDisplay(item, target, env.sources);
        const fullVoltage = 10 ** (3 / 20);
        let needleLength;
        for (const sweep of [30, 100, 160]) {
            for (const curvature of [0, 0.25, 0.5, 1]) {
                for (const pivotOffset of [0, 50]) {
                    Object.assign(item.params, { dialSweep: sweep, dialCurvature: curvature, pivotOffset });
                    let previousAngle;
                    for (const voltage of [0.2, 0.4, 0.6, 0.8, 1]) {
                        const db = item.params.rl + 20 * Math.log10(voltage * fullVoltage);
                        display.plugin.reading = { channels: [{ needleDb: db, maxDb: db }] };
                        target.context.calls.length = 0;
                        display.draw(item, 1, 800);
                        const [, baseX, baseY] = target.context.calls.find(([key]) => key === 'moveTo');
                        const [, tipX, tipY] = target.context.calls.find(([key]) => key === 'lineTo');
                        const length = Math.hypot(tipX - baseX, tipY - baseY);
                        needleLength ??= length;
                        assert.ok(Math.abs(length - needleLength) < 1e-9,
                            'Neither level, curvature, sweep nor pivot translation stretches the needle');
                        const angle = Math.atan2(tipX - baseX, baseY - tipY);
                        const expected = (voltage - 0.5) * sweep * Math.PI / 180;
                        assert.ok(Math.abs(angle - expected) < 1e-12, 'Deflection stays affine in voltage');
                        if (previousAngle !== undefined) assert.ok(Math.abs(angle - previousAngle - 0.2 * sweep * Math.PI / 180) < 1e-12);
                        previousAngle = angle;
                    }
                }
            }
        }
        // Only an explicit needle-length edit changes the physical radius.
        item.params.needleLength = 80;
        target.context.calls.length = 0;
        display.draw(item, 1, 800);
        const [, baseX, baseY] = target.context.calls.find(([key]) => key === 'moveTo');
        const [, tipX, tipY] = target.context.calls.find(([key]) => key === 'lineTo');
        assert.ok(Math.abs(Math.hypot(tipX - baseX, tipY - baseY) - needleLength * 80 / 102) < 1e-9);
        display.dispose();
    });
});

test('Rhythm Analyzer draws the Groove view from a Visualizer telemetry frame', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('rhythm-analyzer', 'rhythm');
        const target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        const payload = new DataView(new ArrayBuffer(1496));
        const source = {};
        [[0, 48000, 'Float32'], [4, 1, 'Uint32'], [8, 480, 'Uint32'], [12, 100, 'Uint32'], [16, 1, 'Float32'],
            [28, 2, 'Uint32'], [32, 1, 'Uint32'], [36, 1, 'Uint32'], [40, .8, 'Float32'], [44, .5, 'Float32'],
            [48, 100, 'Uint32'], [56, 2, 'Uint32'], [60, 120, 'Float32']]
            .forEach(([offset, value, kind]) => payload[`set${kind}`](offset, value, true));
        for (let bin = 0; bin < 192; bin++) payload.setFloat32(64 + bin * 4, bin === 96 ? 1 : .1, true);
        [[1, 1, .8, 0], [1, 1, .96, 1]].forEach(([epoch, beat, beatFraction, band], index) => {
            const base = 832 + index * 32;
            payload.setUint32(base, 90 + index * 8, true);
            payload.setUint32(base + 8, epoch, true);
            payload.setInt32(base + 12, beat, true);
            payload.setFloat32(base + 16, beatFraction, true);
            payload.setFloat32(base + 20, .5, true);
            payload.setFloat32(base + 24, .7, true);
            payload.setUint8(base + 28, band);
        });
        let shownIndex = 2;
        const send = (shown = false) => {
            payload.setUint32(28, shown ? 3 : 2, true);
            const base = 832 + 2 * 32;
            if (shown) {
                payload.setUint32(base, payload.getUint32(12, true), true);
                payload.setUint32(base + 8, 1, true);
                payload.setInt32(base + 12, shownIndex++, true);
                payload.setFloat32(base + 20, .5, true);
                payload.setFloat32(base + 24, 1, true);
                payload.setUint8(base + 29, 2);
            }
            payload.setUint32(1344, 2, true);
            payload.setFloat32(1348, .5, true);
            for (let i = 0; i < 2; i++) {
                payload.setInt32(1352 + 12 * i, payload.getUint32(48, true) + 50 * i, true);
                payload.setInt32(1360 + 12 * i, payload.getInt32(56, true) + i, true);
            }
            env.subscribers.get('rhythm')({ frameType: 28, formatVersion: 4, payload, source }, source);
        };
        send();
        assert.equal(display.plugin.activeGeneration, 1);
        display.draw(item, 1, 400);
        assert.ok(target.context.calls.some(([key]) => key === 'stroke' || key === 'fill' || key === 'fillRect'));
        assert.ok(target.context.calls.some(call => call[0] === 'fillText' && call[1] === '120.0 BPM'), 'BPM overlays the graphs');
        Object.assign(item.params, { vt: false, vm: false, ve: false, vl: false, showAxes: false, showAxisNumbers: false });
        const draws = [];
        target.context.measureText = text => ({ width: text.length * Number(/([\d.]+)px/.exec(target.context.font)?.[1] || 12) * .55 });
        target.context.fillText = (text, x, y, maxWidth) => draws.push({ text, x, y, maxWidth,
            font: target.context.font, align: target.context.textAlign, baseline: target.context.textBaseline,
            spacing: target.context.letterSpacing, shadowBlur: target.context.shadowBlur });
        const redraw = () => { draws.length = 0; target.context.calls.length = 0; display.draw(item, 1, 400, undefined, 2); };
        const arcs = () => target.context.calls.filter(call => call[0] === 'arc');
        redraw();
        assert.equal(display.plugin._readoutFrame.header.length, 0);
        assert.equal(display.plugin._readoutFrame.panels.length, 0);
        assert.deepEqual(arcs().map(call => call.slice(1, 3)), [[400, 200]]);
        assert.ok(arcs()[0][3] > 100, 'Beat circle is large enough to see without graphs');
        assert.deepEqual(draws.map(({ text, x, y, align, baseline }) => ({ text, x, y, align, baseline })),
            [{ text: '120.0 BPM', x: 400, y: 200, align: 'center', baseline: 'middle' }]);
        assert.ok(parseFloat(draws[0].font) < 192, 'BPM scales down to fit inside the circle');
        item.style.beatFitBpm = false;
        redraw();
        assert.equal(draws[0].font, '192px sans-serif', 'Automatic fitting can be disabled');
        item.style.beatFitBpm = true;

        payload.setUint32(32, 0, true);
        send();
        redraw();
        assert.equal(target.context.calls.some(call => call[0] === 'fill'), false, 'Searching is hollow before a detected beat');
        assert.equal(draws[0].text, '120.0 BPM', 'A stored tempo remains visible while searching');
        payload.setUint32(32, 1, true);
        payload.setUint32(48, 100, true);
        payload.setUint32(12, 101, true);
        send(true);
        redraw();
        assert.ok(target.context.calls.some(call => call[0] === 'globalAlpha' && call[1] > .25 && call[1] <= .3), 'Circle lights on the detected beat');
        payload.setUint32(12, 110, true);
        send();
        redraw();
        const pulse = () => target.context.calls.find(call => call[0] === 'globalAlpha' && call[1] !== 1)?.[1];
        const expectedPulse = (age, hold, decay) => .3 * Math.exp(-Math.max(0, age - hold) / decay);
        assert.ok(Math.abs(pulse() - expectedPulse(90, 0, 90)) < 1e-6, 'Circle fades exponentially between beats');
        item.style.beatHoldTime = 50;
        redraw();
        assert.ok(Math.abs(pulse() - expectedPulse(90, 50, 90)) < 1e-6);
        item.style.beatDecayTime = 200;
        redraw();
        assert.ok(Math.abs(pulse() - expectedPulse(90, 50, 200)) < 1e-6, 'A longer decay time fades more slowly');
        item.style.beatHoldTime = 200;
        redraw();
        assert.equal(pulse(), .3, 'The hold time maintains full opacity');
        Object.assign(item.style, { beatHoldTime: 0, beatDecayTime: 90 });
        env.clock.now += 45;
        redraw();
        assert.ok(Math.abs(pulse() - expectedPulse(135, 0, 90)) < 1e-6, 'The pulse fades between telemetry frames');
        payload.setUint32(12, 150, true);
        payload.setUint32(48, 150, true);
        payload.setUint32(56, 3, true);
        send(true);
        redraw();
        assert.equal(pulse(), .3, 'The next detected beat restarts the pulse');
        payload.setUint32(32, 0, true);
        payload.setUint32(12, 160, true);
        send();
        redraw();
        assert.ok(Math.abs(pulse() - expectedPulse(100, 0, 90)) < 1e-6, 'A shown beat finishes fading when the gate closes');
        assert.equal(draws[0].text, '120.0 BPM', 'The stored grid tempo does not depend on the tick gate');

        Object.assign(item.style, { fontSize: 120, fontFamily: 'serif', bold: true, italic: true, align: 'right',
            verticalAlign: 'bottom', letterSpacing: 4, textCase: 'lower', outlineWidth: 2, shadowBlur: 3 });
        item.params.showBeat = false;
        redraw();
        assert.equal(arcs().length, 0);
        assert.deepEqual(draws[0], { text: '120.0 bpm', x: 804, y: 396, maxWidth: 792,
            font: 'italic bold 240px serif', align: 'right', baseline: 'bottom', spacing: '8px', shadowBlur: 6 });
        item.params.showBeat = true;
        item.params.showBpm = false;
        redraw();
        assert.equal(draws.length, 0);
        assert.equal(arcs().length, 1, 'Beat works without BPM');
        Object.assign(item.style, { beatSize: 50, beatLineWidth: 6, beatStrokeOpacity: .4, beatUsePalette: false,
            beatFillColor: '#112233', beatStrokeColor: '#abcdef', beatFillOpacity: .6 });
        redraw();
        assert.equal(arcs()[0][3], 94, 'Circle diameter and border width follow the saved style');
        assert.equal(target.context.lineWidth, 12, 'Circle border scales with the scene like text');
        assert.ok(target.context.calls.some(call => call[0] === 'strokeStyle' && call[1] === '#abcdef'));
        assert.ok(target.context.calls.some(call => call[0] === 'globalAlpha' && call[1] === .4));
        item.style.beatLineWidth = 0;
        redraw();
        assert.equal(target.context.calls.some(call => call[0] === 'stroke'), false, 'A zero-width border is hidden');
        item.params.showBeat = false;
        redraw();
        assert.equal(arcs().length, 0, 'Both indicators can be hidden');
        display.dispose();
    });
});

test('Visualizer revises pending Rhythm Analyzer dots on each fresh display path', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('rhythm-analyzer', 'rhythm'), target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        const payload = new DataView(new ArrayBuffer(1496));
        for (const [offset, value, kind] of [[0, 48000, 'Float32'], [4, 1, 'Uint32'], [8, 480, 'Uint32'],
            [12, 150, 'Uint32'], [16, 1.5, 'Float32'], [28, 1, 'Uint32'], [32, 1, 'Uint32'],
            [36, 1, 'Uint32'], [40, .8, 'Float32'], [44, .5, 'Float32'], [48, 50, 'Uint32'],
            [60, 120, 'Float32'], [832, 100, 'Uint32'], [840, 1, 'Uint32'], [844, 1, 'Int32'],
            [852, .5, 'Float32'], [856, .7, 'Float32'], [1344, 3, 'Uint32'], [1348, .5, 'Float32']]) {
            payload[`set${kind}`](offset, value, true);
        }
        payload.setUint8(861, 3);
        for (let i = 0; i < 3; i++) {
            payload.setInt32(1352 + 12 * i, 50 + 50 * i, true);
            payload.setInt32(1360 + 12 * i, i, true);
        }
        const source = {};
        const send = () => env.subscribers.get('rhythm')({ frameType: 28, formatVersion: 4, payload, source }, source);
        send();
        display.draw(item, 1, 400);
        const before = display.plugin.displayedEvent(0, env.clock.now).u;
        env.clock.now += 17;
        payload.setUint32(28, 0, true);
        payload.setInt32(1364, 120, true);
        payload.setInt32(1376, 170, true);
        send();
        assert.ok(display.plugin.eventU[0] < before);
        assert.ok(Math.abs(display.plugin.displayedEvent(0, env.clock.now).u - before) < 1e-9);
        env.clock.now += 100;
        display.draw(item, 1, 400);
        assert.ok(display.plugin.displayedEvent(0, env.clock.now).u < before);
        assert.equal(display.plugin.eventSerial, 1);
        assert.equal(display.plugin.eventTimed[0], 0);
        display.dispose();
    });
});

function phaseFrame(points, sequence = 0, maximumDb = 0) {
    const payload = new DataView(new ArrayBuffer(16 + points.length * 16));
    payload.setFloat32(0, 48000, true);
    payload.setUint16(4, points.length, true);
    payload.setUint32(8, 4096, true);
    payload.setFloat32(12, maximumDb, true);
    points.forEach(([frequency, phase, balance, level], index) => {
        [frequency, phase, balance, level].forEach((value, field) =>
            payload.setFloat32(16 + index * 16 + field * 4, value, true));
    });
    return { frameType: 20, formatVersion: 2, sequence, flags: 0, payload };
}

test('Phase Map draws the Phase Select EQ point cloud without the effect regions or background', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('phase', 'phase'), target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        env.subscribers.get('phase')(phaseFrame([[1000, 90, -50, -10], [2000, 0, 0, -80]]), {});
        const arcs = () => target.context.calls.filter(call => call[0] === 'arc');
        display.draw(item, 1, 400);
        assert.deepEqual(arcs().map(call => call[1]), [300], 'Phase maps -180..180 degrees across the width');
        const smallRadius = arcs()[0][3], initialRange = item.params.dr;
        assert.ok(smallRadius > 0.6 + 1.1, 'Visualizer points exceed the plugin graph\'s largest point');
        assert.ok(target.context.calls.some(call => call[0] === 'clearRect'));
        for (const method of ['fillRect', 'strokeRect', 'stroke', 'fillText'])
            assert.equal(target.context.calls.some(call => call[0] === method), false, method);
        assert.ok(target.context.calls.some(call => call[0] === 'fillStyle' && call[1] === item.palette.color));

        target.context.calls.length = 0;
        Object.assign(item.params, { ax: 'balance', dr: -96, showAxes: true, showAxisNumbers: true });
        display.draw(item, 1, 400);
        assert.deepEqual(arcs().map(call => call[1]), [100, 200], 'Balance axis and wider level range');
        const [strongAlpha, weakAlpha] = target.context.calls
            .filter(call => call[0] === 'globalAlpha' && call[1] !== 1).map(call => call[1]);
        assert.ok(weakAlpha >= 0.35 && weakAlpha < strongAlpha, 'Weak points stay visible below strong ones');
        assert.ok(target.context.calls.some(call => call[0] === 'stroke'));
        assert.ok(target.context.calls.some(call => call[0] === 'fillText' && call[1] === '1k'));
        const labelStyle = target.context.calls.findLast((call, index) => call[0] === 'fillStyle'
            && index < target.context.calls.findIndex(entry => entry[0] === 'fillText'));
        assert.equal(labelStyle[1], 'rgb(102,102,102)', 'Axis labels use the Visualizer graph-label default');
        assert.equal(target.context.calls.some(call => call[0] === 'strokeRect'), false, 'No regions or handles');

        target.context.calls.length = 0;
        item.palette.mode = 'heatmap';
        display.draw(item, 1, 400);
        assert.ok(target.context.calls.some(call => call[0] === 'fillStyle' && /^rgb\(/.test(call[1])));

        target.context.calls.length = 0;
        Object.assign(item.params, { ax: 'phase', dr: initialRange });
        Object.assign(target, { width: 2000, height: 1200 });
        display.draw(item, 1, 1000);
        assert.ok(Math.abs(arcs()[0][3] / smallRadius - 2.4 / 1.5) < 1e-9, 'Point size follows the item size');
        display.dispose();
    });
});

test('Phase Map measures quiet frames against the Reference Floor', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('phase', 'phase'), target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        const arcs = () => target.context.calls.filter(call => call[0] === 'arc');
        const points = [[1000, 90, -50, 0], [2000, 0, 0, -50]];
        // A raw kernel maximum of -97 dB is about -90 dBFS, 50 dB under the -40 dB default.
        const send = sequence => env.subscribers.get('phase')(phaseFrame(points, sequence, -97), {});
        env.subscribers.get('phase')(phaseFrame(points, 0), {});
        display.draw(item, 1, 400);
        const loudRadius = arcs()[0][3];
        assert.equal(arcs().length, 2);

        target.context.calls.length = 0;
        send(5);
        display.draw(item, 1, 400);
        assert.equal(arcs().length, 1, 'Points under Reference Floor + DB Range disappear');
        assert.ok(arcs()[0][3] < loudRadius, 'The strongest quiet point shrinks');

        target.context.calls.length = 0;
        item.params.ml = -120;
        display.draw(item, 1, 400);
        send(10);
        target.context.calls.length = 0;
        display.draw(item, 1, 400);
        assert.equal(arcs().length, 2, 'A lower floor keeps the strongest component as the reference');
        assert.equal(arcs()[0][3], loudRadius);
        display.dispose();
    });
});

test('Oscilloscope displays telemetry through the native trace with Visualizer palette and axes', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('oscilloscope', 'scope'), target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        assert.ok(display);
        const payload = new DataView(new ArrayBuffer(16 + 4 * 4));
        payload.setFloat32(0, 48000, true);
        payload.setUint32(4, 4, true);
        payload.setUint32(8, 0, true);
        [0, 0.5, -0.5, 0].forEach((value, index) => payload.setFloat32(16 + index * 4, value, true));
        const source = {};
        env.subscribers.get('scope')({ frameType: 3, formatVersion: 2, payload, source }, {});
        target.context.calls.length = 0;
        display.draw(item, 1, 400);
        assert.equal(display.plugin.scopeSnapshot.values.length, 4);
        assert.ok(target.context.calls.some(call => call[0] === 'strokeStyle' && call[1] === item.palette.color));
        assert.equal(target.context.calls.filter(call => call[0] === 'fillText').length, 0);
        assert.ok(target.context.calls.some(call => call[0] === 'clearRect'));
        item.params.showAxes = item.params.showAxisNumbers = true;
        target.context.calls.length = 0;
        display.draw(item, 1, 400);
        assert.ok(target.context.calls.some(call => call[0] === 'fillText' && call[1] === 'Time (ms)'));
        item.params.showAxes = false;
        target.context.calls.length = 0;
        display.draw(item, 1, 400);
        assert.ok(target.context.calls.some(call => call[0] === 'fillText' && call[1] === 'Time (ms)'),
            'Axis labels remain visible without grid lines');
        assert.equal(target.context.calls.filter(call => call[0] === 'stroke').length, 1,
            'Only the waveform is stroked when axes and grid are hidden');
        const gradients = [];
        target.context.createLinearGradient = (...coordinates) => {
            assert.ok(coordinates.every(Number.isFinite), 'Gradient coordinates must be finite');
            const gradient = { coordinates, stops: [], addColorStop(position, color) { this.stops.push([position, color]); } };
            gradients.push(gradient);
            return gradient;
        };
        item.palette.color = '#ff0000';
        target.context.calls.length = 0;
        display.draw(item, 2, 400);
        assert.ok(target.context.calls.some(call => call[0] === 'strokeStyle' && call[1] === '#ff0000'));
        item.palette.mode = 'gradient';
        item.palette.stops = [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }];
        item.palette.motion = { mode: 'hue', speed: 0.5 };
        display.draw(item, 3, 400);
        display.draw(item, 4, 400);
        assert.equal(gradients.length, 2);
        assert.deepEqual(gradients.map(gradient => gradient.coordinates), [[0, 0, 800, 0], [0, 0, 800, 0]]);
        assert.notDeepEqual(gradients[0].stops, gradients[1].stops);
        const oldSnapshot = display.plugin.scopeSnapshot;
        env.subscribers.get('scope')({ frameType: 3, formatVersion: 2, payload, source: {} }, {});
        assert.notEqual(display.plugin.scopeSnapshot, oldSnapshot);
        display.dispose();
    });
});

test('A one-second stereo window batches all 48000 samples by age instead of changing canvas color per point', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('stereo', 'stereo'), target = canvas();
        item.params.wt = 1;
        item.palette.mode = 'gradient';
        item.palette.stops = [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }];
        const display = createAnalyzerDisplay(item, target, env.sources);
        display.plugin.sampleRate = 48000;
        display.plugin.currentMeasurements = {
            xBuffer: new Float32Array(48000).fill(.5), yBuffer: new Float32Array(48000).fill(.3),
            currentPosition: 0, peakBuffer: new Float32Array(360)
        };
        display.plugin.dspStereoFieldSnapshot = { correlation: 0, balance: 0 };
        target.context.calls.length = 0;
        display.draw(item, 1, 800);
        const count = name => target.context.calls.filter(call => call[0] === name).length;
        assert.ok(count('fillStyle') <= 270, `${count('fillStyle')} fillStyle changes`);
        assert.equal(count('rect'), 48000);
        assert.equal(count('fill'), 256);
        assert.ok(count('fillRect') < 10);
        assert.equal(count('createConicGradient'), 256);
        const gradients = target.context.calls.filter(call => call[0] === 'createConicGradient').map(call => call[1]);
        assert.deepEqual(gradients[255].coordinates, [-Math.PI / 2, 400, 200]);
        assert.deepEqual(gradients[0].stops[0], [0, 'rgba(255,0,0,0)']);
        assert.deepEqual(gradients[128].stops[0], [0, `rgba(255,0,0,${128 / 255})`]);
        assert.deepEqual(gradients[255].stops[0], [0, 'rgba(255,0,0,1)']);
        assert.deepEqual(gradients[255].stops.at(-1), [1, 'rgba(0,0,255,1)']);
        target.context.calls.length = 0;
        display.draw(item, 2, 800);
        assert.equal(count('createConicGradient'), 0);
        assert.equal(count('fill'), 256);
        target.width = 1000;
        display.draw(item, 3, 1000);
        assert.equal(count('createConicGradient'), 256);
        item.palette.motion = { mode: 'hue', speed: .5 };
        target.context.calls.length = 0;
        display.draw(item, 4, 1000);
        assert.equal(count('createConicGradient'), 256);
        assert.equal(count('fill'), 256);
        assert.equal(count('rect'), 48000);
        assert.ok(count('fillStyle') <= 270);
        assert.ok(count('fillRect') < 10);
        item.palette.stops = [{ pos: 0, color: '#ff0000' }];
        target.context.calls.length = 0;
        display.draw(item, 5, 1000);
        assert.equal(count('createConicGradient'), 0);
        assert.equal(count('fill'), 256);
        assert.equal(count('rect'), 48000);
        assert.ok(count('fillStyle') <= 270);
        assert.ok(count('fillRect') < 10);
    });
});

test('Scroll moves Chroma and Stereo circular patterns continuously while preserving sample opacity', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        for (const type of ['chroma', 'stereo']) {
            const item = createItem(type, type), target = canvas();
            item.palette.mode = 'gradient'; item.palette.mapping = 'octave';
            item.palette.motion = { mode: 'scroll', speed: 1 };
            item.palette.stops = [{ pos: 0, color: '#000000' }, { pos: .5, color: '#ffffff' },
                { pos: 1, color: '#000000' }];
            const display = createAnalyzerDisplay(item, target, env.sources);
            for (const time of [.1, .1 + 1 / 60, 9.99, 10.01]) {
                display.draw(item, time, 800);
                const options = display.plugin.displayOptions;
                const gradient = type === 'chroma' ? options.spiralFillStyle(target.context)
                    : options.sampleStyle(target.context, 400, 200, 128);
                const peakColor = type === 'chroma' ? 'rgb(255,255,255)' : `rgba(255,255,255,${128 / 255})`;
                const peak = gradient.stops.find(([, color]) => color === peakColor);
                const expected = ((.5 - time * .1) % 1 + 1) % 1;
                assert.ok(Math.abs(peak[0] - expected) < 1e-9, `${type} at ${time}`);
                assert.equal(gradient.stops[0][0], 0);
                assert.equal(gradient.stops.at(-1)[0], 1);
                assert.equal(gradient.stops[0][1], gradient.stops.at(-1)[1], 'The moving pattern stays continuous at the repeat boundary');
                if (type === 'stereo') assert.ok(gradient.stops.every(([, color]) => color.endsWith(`,${128 / 255})`)));
            }
            display.dispose();
        }
    });
});

test('Stereo correlation and balance controls hide each meter without hiding the waveform or other meter', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('stereo', 'stereo'), target = canvas();
        item.params.showAxes = item.params.showAxisNumbers = true;
        const display = createAnalyzerDisplay(item, target, env.sources);
        display.plugin.sampleRate = 100;
        display.plugin.currentMeasurements = {
            xBuffer: new Float32Array(100).fill(.5), yBuffer: new Float32Array(100).fill(.3),
            currentPosition: 0, peakBuffer: new Float32Array(360)
        };
        display.plugin.dspStereoFieldSnapshot = { correlation: .5, balance: 6 };
        const draw = () => {
            target.context.calls.length = 0;
            display.draw(item, 1, 800);
            const calls = target.context.calls;
            return {
                correlationBar: calls.some(call => call[0] === 'fillRect' && call[1] === 0),
                balanceBar: calls.some(call => call[0] === 'fillRect' && call[2] === 384),
                labels: calls.filter(call => call[0] === 'fillText').map(call => call[1]),
                outlined: calls.filter(call => call[0] === 'strokeText').map(call => call[1]),
                waveform: calls.some(call => call[0] === 'rect'),
                peak: calls.some(call => call[0] === 'closePath')
            };
        };
        const both = draw();
        assert.equal(both.correlationBar, true);
        assert.equal(both.balanceBar, true);
        assert.ok(both.labels.includes('LR Correlation') && both.labels.includes('LR Balance'));
        assert.ok(both.outlined.includes('LR Correlation') && both.outlined.includes('LR Balance'), 'Titles over the bars are outlined');
        item.params.showCorrelation = false;
        const balanceOnly = draw();
        assert.equal(balanceOnly.correlationBar, false);
        assert.equal(balanceOnly.balanceBar, true);
        assert.ok(!balanceOnly.labels.includes('LR Correlation') && balanceOnly.labels.includes('LR Balance'));
        assert.ok(!balanceOnly.labels.includes('0.5') && balanceOnly.labels.includes('6dB'));
        item.params.showCorrelation = true;
        item.params.showBalance = false;
        const correlationOnly = draw();
        assert.equal(correlationOnly.correlationBar, true);
        assert.equal(correlationOnly.balanceBar, false);
        assert.ok(correlationOnly.labels.includes('LR Correlation') && !correlationOnly.labels.includes('LR Balance'));
        assert.ok(correlationOnly.labels.includes('0.5') && !correlationOnly.labels.includes('6dB'));
        item.params.showCorrelation = false;
        const neither = draw();
        assert.equal(neither.correlationBar, false);
        assert.equal(neither.balanceBar, false);
        assert.equal(neither.waveform, true);
        assert.equal(neither.peak, true);
        display.dispose();
    });
});

test('Notes retain received history across canvas size and palette changes without copying the keyboard into it', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const stage = canvas(), renderer = new VisualizerRenderer(stage), item = createItem('notes', 'notes');
        item.params.vl = false;
        item.params.kb = item.params.showAxisNumbers = true;
        const layout = createDefaultLayout(); layout.items = [item];
        renderer.draw(layout, env.sources, {}, 1);
        env.subscribers.get('notes')(noteFrame(), {});
        const state = renderer.layers.get('notes'), plugin = state.display.plugin;
        assert.equal(plugin.lastFrameIndex, 1);
        const history = plugin.history, recorded = history.slice(), column = plugin.writeColumn;
        assert.ok(recorded.some(value => value > 0));
        stage.width = 1000; stage.height = 600;
        item.palette.stops[0].color = '#ff0000';
        renderer.draw(layout, env.sources, {}, 1);
        assert.equal(renderer.layers.get('notes'), state);
        assert.equal(plugin.history, history);
        assert.deepEqual(history, recorded);
        assert.equal(plugin.writeColumn, column);
        // Graphics scale with the stage on a 1280-wide basis at the default Graph Scale.
        assert.ok(Math.abs(plugin.graphDpr - 1000 / 1280) < 1e-12);
        assert.notEqual(plugin.tempCanvas, state.canvas);
        assert.notEqual(plugin.scaledHistoryCanvas, state.canvas);
        assert.ok(state.canvas.context.calls.some(call => call[0] === 'fillText'));
        for (const historyCanvas of [plugin.tempCanvas, plugin.scaledHistoryCanvas]) {
            assert.equal(historyCanvas.context.calls.some(call => call[0] === 'fillText'), false);
            assert.equal(historyCanvas.context.calls.some(call => call[0] === 'drawImage' && call[1] === state.canvas), false);
        }
        env.subscribers.get('notes')(noteFrame(2), {});
        assert.equal(plugin.lastFrameIndex, 2);
        layout.items = [];
        renderer.draw(layout, env.sources, {}, 1);
        assert.equal(env.subscribers.size, 0);
    });
});

test('Guitar marks every fret of a detected note in range, or one playable shape', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('guitar', 'guitar');
        const stage = canvas();
        const display = createAnalyzerDisplay(item, stage, env.sources);
        // C4 sounds on the B string at fret 1, the G string at fret 5, and the D string at fret 10.
        const labels = pm => {
            item.params.pm = pm;
            stage.context.calls.length = 0;
            display.draw(item, 1, 800);
            return stage.context.calls.filter(call => call[0] === 'fillText' && call[1] === 'C').length;
        };
        display.draw(item, 0, 800);
        env.subscribers.get('guitar')(noteFrame(), {});
        assert.equal(labels('all'), 3);
        assert.equal(labels('shape'), 1);
        assert.equal(labels('shape-dim'), 3);
        // Narrowing the fret range removes the positions outside it.
        item.params.fx = 7;
        assert.equal(labels('all'), 2);
        item.params.fm = 3;
        assert.equal(labels('all'), 1);
        display.dispose();
    });
});

test('Guitar scale guide rings every scale position, fills the roots, and draws the capo and fretboard fill', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('guitar', 'guitar');
        Object.assign(item.params, { fx: 12, ro: 0 });
        const stage = canvas();
        const display = createAnalyzerDisplay(item, stage, env.sources);
        const count = (name, params) => {
            Object.assign(item.params, params);
            stage.context.calls.length = 0;
            display.draw(item, 0, 800);
            return stage.context.calls.filter(call => call[0] === name).length;
        };
        // C major pentatonic in standard tuning over frets 0-12: five positions per string,
        // plus fret 12 on every string whose open note is in the scale (all but B).
        assert.equal(count('arc', { sk: 'major-pentatonic' }) - count('arc', { sk: 'none' }), 35);
        // One C per string between frets 1 and 11.
        assert.equal(count('fill', { sk: 'major-pentatonic' }) - count('fill', { sk: 'none' }), 6);
        assert.equal(count('fillRect', { cp: 3 }) - count('fillRect', { cp: 0 }), 1);
        assert.equal(count('fillRect', { fb: true }) - count('fillRect', { fb: false }), 1);
        display.dispose();
    });
});

test('Fretless Guitar places a note on its fret line and slides it with the detected pitch', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('guitar', 'guitar');
        Object.assign(item.params, { fl: true, fx: 7 });
        const stage = canvas();
        const display = createAnalyzerDisplay(item, stage, env.sources);
        const draw = time => {
            stage.context.calls.length = 0;
            display.draw(item, time, 800);
            const calls = stage.context.calls;
            return {
                wires: calls.filter(call => call[0] === 'moveTo').map(call => call[1]),
                labels: calls.filter(call => call[0] === 'fillText' && call[1] === 'C').map(call => call[2]).sort((a, b) => a - b)
            };
        };
        draw(0);
        env.subscribers.get('guitar')(noteFrame(1), {});
        // C4 at fret 1 on the B string and fret 5 on the G string, each exactly on its fret line.
        const centered = draw(1);
        assert.equal(centered.labels.length, 2);
        for (const x of centered.labels) assert.ok(centered.wires.some(wire => Math.abs(wire - x) < 1e-6));
        // Equal confidence in the next fine bin puts the pitch 0.1 semitone sharp, between the lines.
        const sharp = noteFrame(2);
        sharp.payload.setFloat32(32 + 198 * 4, .8, true);
        env.subscribers.get('guitar')(sharp, {});
        const moved = draw(2);
        moved.labels.forEach((x, index) => {
            const next = moved.wires.filter(wire => wire > centered.labels[index] + 1e-6).sort((a, b) => a - b)[0];
            assert.ok(x > centered.labels[index] && x < next);
        });
        display.dispose();
    });
});

test('A vibrato across a semitone keeps one Guitar mark and changes only its note name', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('guitar', 'guitar');
        Object.assign(item.params, { fl: true, fx: 3 });
        const stage = canvas();
        const display = createAnalyzerDisplay(item, stage, env.sources);
        // A frame whose only detection is one fine bin; bin 199 is C4 + 0.4 and bin 200 is C#4 - 0.4.
        const frame = (index, bin) => {
            const result = noteFrame(index);
            result.payload.setFloat32(32 + 197 * 4, 0, true);
            result.payload.setFloat32(32 + bin * 4, .8, true);
            return result;
        };
        const names = time => {
            stage.context.calls.length = 0;
            display.draw(item, time, 800);
            return stage.context.calls.filter(call => call[0] === 'fillText' && /^C#?$/.test(call[1])).map(call => call[1]);
        };
        display.draw(item, 0, 800);
        env.subscribers.get('guitar')(frame(1, 199), {});
        assert.deepEqual(names(1), ['C']);
        // Well within the fall time, a separate C mark would still be fading out.
        env.subscribers.get('guitar')(frame(2, 200), {});
        assert.deepEqual(names(1.05), ['C#']);
        display.dispose();
    });
});

test('Guitar Size by Volume scales each dot by its note volume on the Note Spectrogram scale', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('guitar', 'guitar');
        const stage = canvas();
        const display = createAnalyzerDisplay(item, stage, env.sources);
        const largest = vs => {
            item.params.vs = vs;
            stage.context.calls.length = 0;
            display.draw(item, 1, 800);
            return Math.max(...stage.context.calls.filter(call => call[0] === 'arc').map(call => call[3]));
        };
        display.draw(item, 0, 800);
        env.subscribers.get('guitar')(noteFrame(1), {});
        // C4 at -42 dB sits 18 dB into the 24 dB scale that ends at -36 dB.
        assert.ok(Math.abs(largest(true) / largest(false) - (1 / 3 + 2 / 3 * .75)) < 1e-9);
        display.dispose();
    });
});

test('A flat open-string note on a Fretless Guitar moves to a lower string', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('guitar', 'guitar');
        Object.assign(item.params, { fl: true, fx: 5, pm: 'all' });
        const stage = canvas();
        const display = createAnalyzerDisplay(item, stage, env.sources);
        // Bin 217 is E4, the open high E string and fret 5 of the B string; bin 216 is 20 cents flat.
        const frame = (index, bin) => {
            const result = noteFrame(index);
            result.payload.setFloat32(32 + 197 * 4, 0, true);
            result.payload.setFloat32(32 + bin * 4, .8, true);
            return result;
        };
        const marks = time => {
            stage.context.calls.length = 0;
            display.draw(item, time, 800);
            return stage.context.calls.filter(call => call[0] === 'fillText' && call[1] === 'E').length;
        };
        display.draw(item, 0, 800);
        env.subscribers.get('guitar')(frame(1, 217), {});
        assert.equal(marks(1), 2);
        env.subscribers.get('guitar')(frame(2, 216), {});
        assert.equal(marks(2), 1);
        display.dispose();
    });
});

test('Guitar shows a note the revision finds and removes one it rules out', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('guitar', 'guitar');
        item.params.cf = 2;
        const stage = canvas();
        // Frame 9 carries the revised detection of frame 1.
        const frame = (index, detected, revised) => {
            const result = noteFrame(index);
            result.payload.setFloat32(32 + 197 * 4, detected ? .8 : 0, true);
            if (index === 9) {
                result.payload.setUint32(28, 8, true);
                result.payload.setFloat32(32 + 880 * 4 + 197 * 4, revised ? .8 : 0, true);
            }
            return result;
        };
        const marks = (first, revised) => {
            const display = createAnalyzerDisplay(item, stage, env.sources);
            display.draw(item, 0, 800);
            let count = 0;
            for (let index = 1; index <= 9; index++) {
                env.subscribers.get('guitar')(frame(index, index === 1 && first, revised), {});
                stage.context.calls.length = 0;
                display.draw(item, index * .01, 800);
                count = stage.context.calls.filter(call => call[0] === 'fillText' && call[1] === 'C').length;
            }
            display.dispose();
            return count;
        };
        assert.ok(marks(false, true) > 0);
        // With a 2 s fall time, only the revision removes the frame-1 detection by frame 9.
        assert.equal(marks(true, false), 0);
    });
});

test('Notes use the keyboard space for history and hide its meters until the keyboard is shown again', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        for (const ly of ['Horizontal', 'Vertical']) {
            const item = createItem('notes', 'notes'), target = canvas();
            assert.equal(item.params.kb, false);
            assert.equal(item.params.showAxes, false);
            assert.equal(item.params.showAxisNumbers, false);
            item.params.ly = ly;
            const display = createAnalyzerDisplay(item, target, env.sources);
            env.subscribers.get('notes')(noteFrame(), {});
            const plugin = display.plugin, history = plugin.history, column = plugin.writeColumn;
            plugin.meterCurrent.fill(-24);
            const draw = themeColors => {
                target.context.calls.length = 0;
                display.draw(item, 1, 800, themeColors);
                return target.context.calls.slice();
            };
            const hidden = draw();
            assert.equal(hidden.some(call => call[0] === 'fillRect'), false);
            assert.equal(hidden.some(call => call[0] === 'fillText'), false);
            assert.equal(hidden.some(call => call[0] === 'arc'), false);
            const extent = calls => Math.max(...calls.filter(call => call[0] === 'drawImage').map(call => call[6] + call[8]));
            const fullExtent = ly === 'Horizontal' ? target.height : target.width;
            assert.equal(extent(hidden), fullExtent);
            item.params.kb = true;
            const shown = draw();
            assert.ok(shown.some(call => call[0] === 'fillRect'));
            assert.ok(shown.some(call => call[0] === 'arc'), 'Showing the keyboard restores its meters');
            assert.ok(shown.some(call => call[0] === 'fillText' && /^C\d+$/.test(call[1])),
                'Keyboard note names remain visible when axis numbers are off');
            const [pitchLength, crossLength] = ly === 'Horizontal'
                ? [target.width, target.height] : [target.height, target.width];
            const keyboardDepth = env.window.FrequencyAxis.keyboardDepths(
                12 * pitchLength / (plugin.mx - plugin.mn + 1), crossLength).gutter;
            assert.ok(Math.abs(extent(shown) - (fullExtent - keyboardDepth)) < 1e-8,
                `${ly}: ${extent(shown)} vs ${fullExtent - keyboardDepth}`);
            assert.equal(target.context.fillStyle, '#111');
            item.params.kb = false;
            item.params.showAxisNumbers = true;
            const labels = draw();
            assert.equal(labels.some(call => call[0] === 'fillRect'), false);
            assert.ok(labels.some(call => call[0] === 'fillText'), 'Pitch labels are independent');
            assert.equal(target.context.fillStyle, 'rgb(102,102,102)');
            draw({ 'graph-label': '#eeeeee' });
            assert.equal(target.context.fillStyle, 'rgb(238,238,238)');
            item.params.showAxisNumbers = false;
            assert.equal(draw().some(call => call[0] === 'fillText'), false);
            item.params.showAxisNumbers = true;
            assert.equal(extent(labels), fullExtent);
            if (ly === 'Vertical') {
                assert.equal(target.context.textAlign, 'right');
                assert.ok(labels.filter(call => call[0] === 'fillText').every(call => call[2] === target.width - 2));
            }
            item.params.showAxisNumbers = false;
            delete item.params.kb;
            const nativeDefault = draw();
            assert.ok(nativeDefault.some(call => call[0] === 'fillRect'), 'An unspecified native option keeps the keyboard');
            assert.ok(nativeDefault.some(call => call[0] === 'fillText' && /^C\d+$/.test(call[1])));
            assert.equal(target.context.fillStyle, '#111');
            assert.equal(plugin.history, history);
            assert.equal(plugin.writeColumn, column);
            display.dispose();
        }
    });
});

test('Axis lines and labels can be hidden independently while the spectrum trace remains', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('spectrum', 'spectrum'), target = canvas();
        item.params.showAxes = item.params.showAxisNumbers = true;
        const display = createAnalyzerDisplay(item, target, env.sources);
        const count = () => {
            target.context.calls.length = 0;
            display.draw(item, 1, 800);
            return { strokes: target.context.calls.filter(call => call[0] === 'stroke').length,
                labels: target.context.calls.filter(call => call[0] === 'fillText').map(call => call[1]) };
        };
        const all = count();
        item.params.showAxes = false;
        const labels = count();
        assert.deepEqual(labels.labels, all.labels);
        assert.ok(labels.strokes > 0 && labels.strokes < all.strokes);
        item.params.showAxisNumbers = false;
        assert.equal(count().labels.length, 0);
        item.params.showAxes = true;
        const axes = count();
        assert.equal(axes.labels.length, 0);
        assert.equal(axes.strokes, all.strokes);
        item.params.kb = true;
        assert.ok(count().labels.some(label => /^C\d+$/.test(label)),
            'Keyboard C labels remain when axis numbers are off');
        item.params.kb = false;
        assert.equal(count().labels.length, 0);
        item.params.showAxisNumbers = true;
        assert.ok(count().labels.length > 0, 'Graph axis labels remain independently available');
    });
});

test('Spectrum Max Frequency moves the right edge of the frequency axis on both scales', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('spectrum', 'spectrum'), target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        display.draw(item, 1, 800);
        assert.equal(Math.round(display.plugin.displayXToFrequency(1)), 40000);
        for (const sc of ['log-hq', 'linear']) {
            Object.assign(item.params, { mf: 20000, sc });
            display.draw(item, 1, 800);
            assert.equal(Math.round(display.plugin.displayXToFrequency(1)), 20000, sc);
            assert.equal(Math.round(display.plugin.displayXToFrequency(0)), 20, sc);
        }
    });
});

test('Spectrogram Max Frequency moves the top of the frequency axis over the full-range history', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('spectrogram', 'spectrogram'), target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        display.draw(item, 1, 800);
        assert.equal(Math.round(display.plugin.displayRowToFrequency(0)), 40000);
        assert.equal(display.plugin.displayRowToCanonicalRow(0), 0);
        for (const sc of ['log-hq', 'linear']) {
            Object.assign(item.params, { mf: 20000, sc });
            display.draw(item, 1, 800);
            assert.equal(Math.round(display.plugin.displayRowToFrequency(0)), 20000, sc);
            assert.equal(Math.round(display.plugin.displayRowToFrequency(255)), 20, sc);
            // History rows stay log-spaced over 20 Hz-40 kHz; 20 kHz lies one octave below the top.
            assert.ok(Math.abs(display.plugin.displayRowToCanonicalRow(0) - 255 * Math.log10(2) / Math.log10(2000)) < 1e-9, sc);
            assert.ok(Math.abs(display.plugin.displayRowToCanonicalRow(255) - 255) < 1e-9, sc);
        }
    });
});

test('Linear frequency axes up to 10 kHz label every 1 kHz', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        for (const type of ['spectrum', 'spectrogram']) {
            const item = createItem(type, type), target = canvas();
            Object.assign(item.params, { sc: 'linear', mf: 10000, showAxes: true, showAxisNumbers: true });
            const display = createAnalyzerDisplay(item, target, env.sources);
            display.draw(item, 1, 800);
            const labels = target.context.calls.filter(call => call[0] === 'fillText').map(call => String(call[1]));
            for (let khz = 1; khz <= 9; khz++) assert.ok(labels.includes(`${khz}k`), `${type} ${khz}k`);
        }
    });
});

test('Spectrogram keyboard octave labels remain when graph labels hide and octave colors repeat by pitch', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('spectrogram', 'spectrogram'), target = canvas();
        item.params.kb = true;
        item.params.showAxisNumbers = true;
        const display = createAnalyzerDisplay(item, target, env.sources);
        target.context.calls.length = 0;
        display.draw(item, 1, 800);
        assert.ok(target.context.calls.some(call => call[0] === 'strokeText'));
        item.params.showAxisNumbers = false;
        target.context.calls.length = 0;
        display.draw(item, 1, 800);
        assert.ok(target.context.calls.some(call => call[0] === 'strokeText'));
        item.params.kb = false;
        target.context.calls.length = 0;
        display.draw(item, 1, 800);
        assert.equal(target.context.calls.some(call => call[0] === 'fillText' || call[0] === 'strokeText'), false);
        item.params.showAxisNumbers = true;
        target.context.calls.length = 0;
        display.draw(item, 1, 800);
        assert.ok(target.context.calls.some(call => call[0] === 'fillText'), 'Graph labels remain independently available');

        const notes = createItem('notes', 'notes');
        notes.palette.mode = 'gradient';
        notes.palette.stops = [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }];
        notes.palette.mapping = 'octave';
        const noteDisplay = createAnalyzerDisplay(notes, canvas(), env.sources);
        const color = midi => noteDisplay.plugin.displayOptions.noteColor(midi);
        assert.deepEqual(color(60), color(72));
        assert.notDeepEqual(color(60), color(66));
        notes.palette.mapping = 'range';
        noteDisplay.draw(notes, 1, 800);
        assert.notDeepEqual(color(60), color(72));

    });
});

test('Layout theme colors and reset remain independent of the app theme and preserve soft grid alpha', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const theme = env.window.ThemePalette;
        const originalGet = theme.get;
        for (const type of ['spectrum', 'spectrogram', 'stereo', 'notes']) {
            const item = createItem(type, type), target = canvas();
            item.params.showAxes = item.params.showAxisNumbers = true;
            if (type !== 'stereo') item.params.kb = true;
            const display = createAnalyzerDisplay(item, target, env.sources);
            if (type === 'stereo') {
                display.plugin.currentMeasurements = { xBuffer: new Float32Array(128), yBuffer: new Float32Array(128),
                    currentPosition: 0, peakBuffer: new Float32Array(360) };
            }
            target.context.calls.length = 0;
            display.draw(item, 1, 800, {
                'graph-label': '#123456', 'graph-bg-deep': '#ffffff', 'text-primary': '#ab12cd'
            });
            assert.ok(target.context.calls.some(call => call[0] === 'strokeStyle' || call[0] === 'fillStyle'
                ? call[1] === 'rgb(18,52,86)' : false), `${type} uses the layout label color`);
            if (type === 'stereo') assert.ok(target.context.calls.some(call =>
                call[0] === 'strokeStyle' && call[1] === 'rgb(171,18,205)'),
            'Stereo peak contour uses the layout theme color');
            assert.equal(display.plugin.displayOptions.themePalette.get('graph-trace'), 'rgb(0,255,0)');
            assert.equal(display.plugin.displayOptions.themePalette.get('graph-grid-soft'), 'rgba(246,248,251,0.2)');
            assert.equal(theme.get, originalGet, 'The global theme is never replaced');
            assert.equal(env.subscribers.size, 1, 'Color changes preserve the existing source subscription');
            target.context.calls.length = 0;
            display.draw(item, 1, 800);
            assert.equal(target.context.calls.some(call => call[1] === 'rgb(18,52,86)'), false);
            theme.get = role => role === 'graph-label' ? 'rgba(40,50,60,1)' : originalGet(role);
            display.draw(item, 1, 800);
            assert.equal(target.context.calls.some(call => call[1] === 'rgba(40,50,60,1)'), false);
            assert.equal(display.plugin.displayOptions.themePalette.get('graph-label'), 'rgb(102,102,102)');
            display.draw(item, 1, 800, { 'graph-grid-soft': '#12345633' });
            assert.equal(display.plugin.displayOptions.themePalette.get('graph-grid-soft'), 'rgba(18,52,86,0.2)');
            theme.get = originalGet;
            display.dispose();
        }
    });
});

test('Spectrum gradients follow frequency or level in either orientation and display mode', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('spectrum', 'spectrum');
        item.palette.mode = 'gradient';
        item.palette.stops = [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }];
        const target = canvas(), display = createAnalyzerDisplay(item, target, env.sources);
        target.context.createLinearGradient = (...coordinates) => ({ coordinates, stops: [],
            addColorStop(position, color) { this.stops.push([position, color]); } });
        for (const orientation of ['horizontal', 'vertical']) for (const dm of ['line', 'bar']) {
            item.params.orientation = orientation; item.params.dm = dm;
            for (const direction of ['frequency', 'intensity']) {
                item.palette.direction = direction;
                display.draw(item, 0, 800);
                const options = display.plugin.displayOptions;
                const gradient = options.traceStyle(target.context, 320, 160);
                assert.deepEqual(gradient.coordinates, direction === 'frequency' ? [0, 0, 320, 0] : [0, 160, 0, 0]);
                assert.equal(gradient.stops[0][1], 'rgb(0,0,255)');
                assert.equal(gradient.stops.at(-1)[1], 'rgb(255,0,0)');
                assert.equal(options.barColor, null);
                if (direction === 'intensity') {
                    assert.equal(options.traceStyle(target.context, 320, 160), gradient);
                    assert.notEqual(options.traceStyle(target.context, 320, 80), gradient);
                }
            }
        }
        item.palette.direction = 'intensity'; item.palette.motion.mode = 'hue'; item.palette.motion.speed = .25;
        display.draw(item, 1, 800);
        assert.notEqual(display.plugin.displayOptions.traceStyle(target.context, 320, 160).stops[0][1], 'rgb(0,0,255)');
        display.dispose();
    });
});

test('Radial gradients color the signal layer of each frequency graph and follow its size and motion', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        for (const type of ['spectrum', 'spectrogram', 'notes', 'chroma', 'phase']) {
            const item = createItem(type, type), target = canvas();
            item.palette.mode = 'gradient'; item.palette.direction = 'radial';
            item.palette.stops = [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }];
            const display = createAnalyzerDisplay(item, target, env.sources);
            display.draw(item, 0, 800);
            const signal = display.signalCanvas, gradients = [];
            assert.ok(signal, type);
            assert.equal(display.plugin.displayOptions.separateAnnotations, true);
            display.paletteLayer.context.createRadialGradient = (...coordinates) => {
                const gradient = { coordinates, stops: [], addColorStop(position, color) { this.stops.push([position, color]); } };
                gradients.push(gradient); return gradient;
            };
            display.draw(item, 0, 800);
            assert.deepEqual(gradients.at(-1).coordinates, [400, 200, 0, 400, 200, Math.hypot(800, 400) / 2]);
            assert.deepEqual(gradients.at(-1).stops[0], [0, 'rgb(0,0,255)']);
            assert.deepEqual(gradients.at(-1).stops.at(-1), [1, 'rgb(255,0,0)']);
            target.width = 1000; target.height = 200;
            item.palette.motion.mode = 'hue'; item.palette.motion.speed = 1;
            display.draw(item, 2, 1000);
            assert.deepEqual(gradients.at(-1).coordinates, [500, 100, 0, 500, 100, Math.hypot(1000, 200) / 2]);
            assert.notDeepEqual(gradients.at(-1).stops, gradients[0].stops);
            item.palette.direction = 'frequency'; display.draw(item, 2, 1000);
            assert.equal(display.signalCanvas, null);
            assert.equal(display.plugin.displayOptions.separateAnnotations, false);
            display.dispose();
        }
    });
});

test('Linear and radial palettes color each meter signal while retaining custom beat colors and BPM decorations', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        for (const type of ['stereo', 'analog-meter', 'rhythm-analyzer']) {
            const item = createItem(type, type), target = canvas();
            Object.assign(item.palette, { mode: 'gradient', direction: 'linear', angle: 90,
                stops: [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }] });
            const display = createAnalyzerDisplay(item, target, env.sources);
            if (type === 'stereo') {
                display.plugin.sampleRate = 1280;
                display.plugin.currentMeasurements = { xBuffer: new Float32Array(128).fill(.5), yBuffer: new Float32Array(128).fill(.3),
                    currentPosition: 0, peakBuffer: new Float32Array(360) };
                display.plugin.dspStereoFieldSnapshot = { correlation: 0, balance: 0 };
            }
            display.draw(item, 0, 800);
            assert.ok(display.signalCanvas, type);
            const gradients = [];
            display.paletteLayer.context.createLinearGradient = (...coordinates) => {
                gradients.push(coordinates); return { addColorStop() {} };
            };
            display.draw(item, 0, 800);
            const [x0, y0, x1, y1] = gradients.at(-1);
            assert.ok(Math.abs(x0 - 400) < 1e-9 && Math.abs(x1 - 400) < 1e-9, type);
            assert.ok(Math.abs(y0) < 1e-9 && Math.abs(y1 - 400) < 1e-9, type);
            display.signalCanvas.context.calls.length = 0;
            display.drawSignal(target.context, context => { context.fillStyle = '#123456'; context.fill(); }, { palette: false });
            assert.ok(display.signalCanvas.context.calls.some(call => call[0] === 'fillStyle' && call[1] === '#123456'));
            item.palette.direction = 'radial'; display.draw(item, 0, 800);
            assert.ok(display.signalCanvas, type);
            if (type === 'rhythm-analyzer') {
                display.signalCanvas.context.calls.length = 0;
                item.style.outlineWidth = 2; item.style.outlineColor = '#654321';
                display.plugin.displayOptions.drawBpm(target.context, '120 BPM', '#ff0000');
                assert.ok(display.signalCanvas.context.calls.some(call => call[0] === 'strokeStyle' && call[1] === '#654321'));
                assert.ok(display.signalCanvas.context.calls.some(call => call[0] === 'fillText' && call[1] === '120 BPM'));
            }
            display.dispose();
        }
    });
});

test('Spectrogram switches gradient lookup between frequency and intensity and repaints existing history', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('spectrogram', 'spectrogram');
        item.palette.mode = 'gradient';
        item.palette.stops = [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }];
        const target = canvas(), display = createAnalyzerDisplay(item, target, env.sources), plugin = display.plugin;
        plugin.dspSpectrogramActive = true;
        plugin.spectrogramIntensityBuffer.fill(128);
        const pixel = row => Array.from(plugin.imageDataCache.data.slice(row * 1024 * 4, row * 1024 * 4 + 4));
        for (const direction of ['intensity', 'frequency', 'intensity']) {
            target.context.calls.length = 0;
            item.palette.direction = direction; display.draw(item, 0, 800);
            assert.equal(target.context.calls.filter(([name]) => name === 'clearRect').length, 1, 'History updates draw the graph once');
            const options = plugin.displayOptions;
            if (direction === 'intensity') {
                assert.equal(options.frequencyColorLut, null);
                assert.equal(options.colorLut.length, 256 * 3);
                assert.deepEqual(pixel(0), [128, 0, 127, 128]);
                assert.deepEqual(pixel(255), pixel(0));
                plugin.paintDspSpectrogramColumn(0, new Uint8Array(256).fill(255));
                assert.deepEqual(pixel(0), [255, 0, 0, 255]);
                assert.deepEqual(pixel(255), pixel(0));
            } else {
                assert.equal(options.colorLut, null);
                assert.deepEqual(pixel(0), [255, 0, 0, 128]);
                assert.deepEqual(pixel(255), [0, 0, 255, 128]);
            }
        }
        display.dispose();
    });
});

test('Pitch gradient angles follow Notes layout and rotate Chroma colors around the octave', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('notes', 'notes'), target = canvas();
        Object.assign(item.palette, { mode: 'gradient', direction: 'frequency', angle: 90 });
        const display = createAnalyzerDisplay(item, target, env.sources);
        display.draw(item, 0, 800);
        const gradients = [];
        display.paletteLayer.context.createLinearGradient = (...coordinates) => {
            gradients.push(coordinates); return { addColorStop() {} };
        };
        for (const ly of ['Vertical', 'Horizontal']) {
            item.params.ly = ly; display.draw(item, 0, 800);
            const [x0, y0, x1, y1] = gradients.at(-1);
            assert.ok(Math.abs(ly === 'Vertical' ? y1 - y0 : x1 - x0) < 1e-9, ly);
            assert.ok(Math.abs(ly === 'Vertical' ? x1 - x0 - 800 : y1 - y0 - 400) < 1e-9, ly);
        }
        display.dispose();
        const chroma = createItem('chroma', 'chroma'), chromaCanvas = canvas();
        Object.assign(chroma.palette, { mode: 'gradient', direction: 'frequency', mapping: 'octave',
            stops: [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }] });
        const spiral = createAnalyzerDisplay(chroma, chromaCanvas, env.sources);
        spiral.draw(chroma, 0, 800);
        const original = spiral.plugin.displayOptions.noteColor(60);
        chroma.palette.angle = 90; spiral.draw(chroma, 0, 800);
        assert.deepEqual(spiral.plugin.displayOptions.noteColor(63), original);
        assert.deepEqual(spiral.plugin.displayOptions.spiralFillStyle(chromaCanvas.context).coordinates, [0, 0, 0]);
        spiral.dispose();
    });
});

test('Level Meter rotated gradients resize when the bar thickness changes', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('level-meter', 'levels'), target = canvas();
        item.params.orientation = 'vertical';
        Object.assign(item.palette, { mode: 'gradient', direction: 'linear', angle: 45 });
        target.context.createLinearGradient = (...coordinates) => ({ coordinates, addColorStop() {} });
        const display = createAnalyzerDisplay(item, target, env.sources);
        display.draw(item, 0, 800);
        const first = display.plugin.displayOptions.traceStyle(target.context, 0, 400);
        target.width = 1000; display.draw(item, 0, 1000);
        const resized = display.plugin.displayOptions.traceStyle(target.context, 0, 400);
        assert.notDeepEqual(resized.coordinates, first.coordinates);
        display.dispose();
    });
});

test('Notes intensity gradients color pitch confidence and note volume while preserving history', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('notes', 'notes');
        item.palette.mode = 'gradient'; item.palette.direction = 'intensity'; item.palette.mapping = 'octave';
        item.palette.stops = [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }];
        const display = createAnalyzerDisplay(item, canvas(), env.sources), plugin = display.plugin;
        plugin.history[197] = .5; plugin.levelHistory[197] = 1;
        plugin.paintHistoryImage();
        const history = plugin.history;
        const row = 88 - 1 - (60 - 21), offset = row * 1024 * 4;
        assert.deepEqual(Array.from(plugin.imageData.data.slice(offset, offset + 4)), [128, 0, 127, 128]);
        const gradients = [];
        const context = { createLinearGradient: () => {
            const gradient = { stops: [], addColorStop(position, color) { this.stops.push([position, color]); } };
            gradients.push(gradient); return gradient;
        }, fillRect() {} };
        const bar = plugin._volumeBarShape(0, { midi: 60, best: 197, confidence: .5 }, 8, plugin._displayPalette());
        assert.equal(bar.fill, 'rgba(255, 0, 0, 0.5)');
        plugin.mn = plugin.mx = 60; plugin._normalizedLevel = () => 1;
        plugin._drawVolumeMeters({ createRadialGradient: context.createLinearGradient,
            beginPath() {}, moveTo() {}, arc() {}, closePath() {}, fill() {} }, 100, 8, plugin._displayPalette());
        assert.ok(gradients[0].stops.some(([, color]) => color === 'rgba(255, 0, 0, 0.5)'));
        item.palette.direction = 'frequency'; display.draw(item, 0, 800);
        assert.equal(plugin.history, history);
        assert.deepEqual(plugin.displayOptions.noteColor(60), plugin.displayOptions.noteColor(72));
        item.palette.direction = 'intensity'; display.draw(item, 0, 800);
        assert.deepEqual(plugin.displayOptions.noteColor(60, .5), plugin.displayOptions.noteColor(72, .5));
        assert.notDeepEqual(plugin.displayOptions.noteColor(60, .5), plugin.displayOptions.noteColor(60, 1));
        display.dispose();
    });
});

test('Chroma intensity gradients color dots and fill segments by level and restore frequency colors', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('chroma', 'chroma');
        item.palette.mode = 'gradient'; item.palette.direction = 'intensity';
        item.palette.stops = [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }];
        const target = canvas(), display = createAnalyzerDisplay(item, target, env.sources), plugin = display.plugin;
        plugin.display = [{ midi: 60, level: -24 }, { midi: 61, level: -12 }, { midi: 62, level: -12 }];
        plugin.levelReference = -12;
        for (const dm of [0, 1]) {
            item.params.dm = dm; target.context.calls.length = 0;
            display.draw(item, 0, 800);
            const options = plugin.displayOptions;
            assert.equal(options.spiralFillStyle, null);
            assert.deepEqual(options.signalColor(60, .5), options.signalColor(72, .5));
            const styles = target.context.calls.filter(call => call[0] === 'fillStyle').map(call => call[1]);
            assert.ok(styles.includes('rgba(255,0,0,1)'), `${dm}: loud signal uses the end color`);
            assert.ok(styles.some(style => typeof style === 'string' && style.startsWith('rgba(') && style !== 'rgba(255,0,0,1)'));
        }
        item.palette.direction = 'frequency'; display.draw(item, 0, 800);
        assert.equal(plugin.displayOptions.signalColor, null);
        assert.equal(plugin.displayOptions.spiralFillStyle, null);
        assert.equal(typeof plugin.displayOptions.spiralFillColor, 'function');
        assert.notEqual(plugin.displayOptions.spiralFillColor(60), plugin.displayOptions.spiralFillColor(72));
        assert.equal(plugin.displayOptions.spiralFillColor(60), `rgb(${plugin.displayOptions.noteColor(60).map(Math.round).join(',')})`);
        item.palette.mapping = 'octave'; display.draw(item, 0, 800);
        assert.equal(plugin.displayOptions.spiralFillColor, null);
        assert.equal(typeof plugin.displayOptions.spiralFillStyle, 'function');
        display.dispose();
    });
});

test('Fixed Note Colors follow pitch without palette motion while Spectrogram keeps signal intensity', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const Note = env.window.NoteSpectrogramPlugin;
        assert.deepEqual(Array.from(Note.noteColor(60)), Array.from(Note.noteColors[0]));
        assert.deepEqual(Array.from(Note.noteColor(60.5)), Array.from(Note.noteColors[0], (value, index) =>
            (value + Note.noteColors[1][index]) / 2));
        const makeItem = type => {
            const item = createItem(type, type);
            item.palette.mode = 'note-colors';
            item.palette.motion.mode = 'hue';
            item.palette.motion.speed = 1;
            return item;
        };
        const spectrum = makeItem('spectrum');
        const spectrumDisplay = createAnalyzerDisplay(spectrum, canvas(), env.sources);
        const gradientContext = { createLinearGradient: () => ({ stops: [], addColorStop(position, color) {
            this.stops.push([position, color]);
        } }) };
        spectrumDisplay.draw(spectrum, 1, 800);
        const traceStyle = spectrumDisplay.plugin.displayOptions.traceStyle;
        const originalGradient = traceStyle(gradientContext, 800);
        const frequency = midi => 440 * 2 ** ((midi - 69) / 12);
        const stopAt = (gradient, position) => gradient.stops.find(([x]) => Math.abs(x - position) < 1e-9);
        const midiPosition = midi => spectrumDisplay.plugin.frequencyToX(frequency(midi), 800) / 800;
        const logA = midiPosition(33);
        assert.equal(originalGradient.stops[0][0], 0);
        assert.equal(originalGradient.stops.at(-1)[0], 1);
        for (const midi of [33, 45, 57])
            assert.equal(stopAt(originalGradient, midiPosition(midi))?.[1], `rgb(${Note.noteColors[9].join(',')})`);
        assert.equal(stopAt(originalGradient, midiPosition(60))?.[1], `rgb(${Note.noteColors[0].join(',')})`);
        assert.equal(traceStyle(gradientContext, 800), originalGradient);
        spectrumDisplay.draw(spectrum, 2, 800);
        assert.equal(spectrumDisplay.plugin.displayOptions.traceStyle, traceStyle);
        assert.deepEqual(traceStyle(gradientContext, 800).stops, originalGradient.stops);
        assert.equal(spectrumDisplay.phase, 0, 'Hue motion does not animate fixed note colors');
        spectrum.params.sc = 'linear';
        spectrumDisplay.draw(spectrum, 2, 800);
        const linearGradient = spectrumDisplay.plugin.displayOptions.traceStyle(gradientContext, 800);
        assert.notEqual(linearGradient, originalGradient);
        assert.ok(midiPosition(33) < logA && midiPosition(33) < .01);
        for (const midi of [33, 45, 57])
            assert.equal(stopAt(linearGradient, midiPosition(midi))?.[1], `rgb(${Note.noteColors[9].join(',')})`);
        assert.equal(stopAt(linearGradient, midiPosition(60))?.[1], `rgb(${Note.noteColors[0].join(',')})`);
        spectrumDisplay.dispose();

        const spectrogram = makeItem('spectrogram');
        const spectrogramDisplay = createAnalyzerDisplay(spectrogram, canvas(), env.sources);
        const plugin = spectrogramDisplay.plugin;
        const lut = plugin.displayOptions.frequencyColorLut;
        assert.equal(lut.length, 256 * 3);
        for (const row of [0, 64, 128, 192, 255]) {
            const midi = 69 + 12 * Math.log2(plugin.displayRowToFrequency(row) / 440);
            assert.deepEqual(Array.from(lut.slice(row * 3, row * 3 + 3)),
                Array.from(Note.noteColor(midi), Math.round));
        }
        plugin.paintDspSpectrogramColumn(0, new Uint8Array(256).fill(128));
        for (const row of [64, 192]) {
            const offset = row * 1024 * 4;
            assert.deepEqual(Array.from(plugin.imageDataCache.data.slice(offset, offset + 3)),
                Array.from(lut.slice(row * 3, row * 3 + 3)));
            assert.equal(plugin.imageDataCache.data[offset + 3], 128);
        }
        spectrogramDisplay.draw(spectrogram, 2, 800);
        assert.equal(plugin.displayOptions.frequencyColorLut, lut);
        plugin.dspSpectrogramActive = true;
        plugin.spectrogramIntensityBuffer.fill(128);
        spectrogram.palette.mode = 'gradient';
        spectrogram.palette.stops = [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }];
        spectrogram.palette.motion.mode = 'none';
        spectrogramDisplay.draw(spectrogram, 2, 800);
        const gradientLut = plugin.displayOptions.frequencyColorLut;
        assert.deepEqual(Array.from(gradientLut.slice(0, 3)), [255, 0, 0]);
        assert.deepEqual(Array.from(gradientLut.slice(255 * 3, 255 * 3 + 3)), [0, 0, 255]);
        const historyOffset = (128 * 1024 + 100) * 4;
        assert.deepEqual(Array.from(plugin.imageDataCache.data.slice(historyOffset, historyOffset + 3)),
            Array.from(gradientLut.slice(128 * 3, 128 * 3 + 3)));
        assert.equal(plugin.imageDataCache.data[historyOffset + 3], 128);
        plugin.paintDspSpectrogramColumn(0, new Uint8Array(256).fill(64));
        plugin.paintDspSpectrogramColumn(1, new Uint8Array(256).fill(224));
        for (const row of [64, 192]) {
            const first = (row * 1024) * 4, second = first + 4;
            assert.deepEqual(Array.from(plugin.imageDataCache.data.slice(first, first + 3)),
                Array.from(plugin.imageDataCache.data.slice(second, second + 3)));
            assert.equal(plugin.imageDataCache.data[first + 3], 64);
            assert.equal(plugin.imageDataCache.data[second + 3], 224);
        }
        spectrogram.palette.motion.mode = 'hue';
        spectrogramDisplay.draw(spectrogram, 3, 800);
        assert.notDeepEqual(Array.from(plugin.displayOptions.frequencyColorLut), Array.from(gradientLut));
        assert.deepEqual(Array.from(plugin.imageDataCache.data.slice(historyOffset, historyOffset + 3)),
            Array.from(plugin.displayOptions.frequencyColorLut.slice(128 * 3, 128 * 3 + 3)));
        assert.equal(plugin.imageDataCache.data[historyOffset + 3], 128);
        spectrogram.palette.mode = 'note-colors';
        spectrogramDisplay.draw(spectrogram, 4, 800);
        assert.deepEqual(Array.from(plugin.displayOptions.frequencyColorLut), Array.from(lut));
        spectrogramDisplay.dispose();

        const notes = makeItem('notes');
        const notesDisplay = createAnalyzerDisplay(notes, canvas(), env.sources);
        assert.deepEqual(Array.from(notesDisplay.plugin.displayOptions.noteColor(60)), Array.from(Note.noteColors[0]));
        notesDisplay.draw(notes, 2, 800);
        assert.equal(notesDisplay.phase, 0);
        notesDisplay.dispose();
    });
});

test('Spectrum Note Colors use each bar center for both the bar and peak', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('spectrum', 'note-bars');
        item.palette.mode = 'note-colors';
        item.params.dm = 'bar';
        const target = canvas();
        const fills = [];
        target.context.fillRect = (...rect) => fills.push({ rect, color: target.context.fillStyle });
        const display = createAnalyzerDisplay(item, target, env.sources);
        const plugin = display.plugin;
        assert.equal(plugin.displayOptions.quantizeBars, true);
        const spectrum = new Float32Array(48).fill(-Infinity);
        const peaks = new Float32Array(48).fill(-Infinity);
        for (const band of [10, 11]) { spectrum[band] = -30; peaks[band] = -20; }
        const bands = { spectrum, peaks, firstFilled: 10, lastFilled: 11 };
        for (const scale of ['linear', 'log', 'log-hq']) {
            item.params.sc = scale;
            display.draw(item, 1, 800);
            fills.length = 0;
            plugin.drawSpectrumBars(target.context, bands, 800, 400, 1);
            const expected = [10, 11].map(band => {
                const frequency = plugin.displayXToFrequency((band + .5) / 48);
                const midi = 69 + 12 * Math.log2(frequency / 440);
                return `rgb(${env.window.NoteSpectrogramPlugin.noteColor(midi).map(Math.round).join(',')})`;
            });
            assert.deepEqual(fills.map(fill => fill.color), [...expected, ...expected], scale);
        }
        item.palette.mode = 'gradient';
        item.params.quantizeBars = false;
        display.draw(item, 1, 800);
        assert.equal(plugin.displayOptions.barColor, null);
        assert.equal(plugin.displayOptions.quantizeBars, false);
        display.dispose();
    });
});

test('Solid fixes the signal color while Heatmap moves native Spectrogram brightness into alpha', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const solid = createItem('spectrum', 'solid');
        solid.palette.color = '#123456';
        const spectrum = createAnalyzerDisplay(solid, canvas(), env.sources);
        assert.equal(spectrum.plugin.displayOptions.traceStyle(), '#123456');
        const gradients = [];
        const gradientContext = { createLinearGradient(...coordinates) {
            gradients.push(coordinates);
            return { addColorStop() {} };
        } };
        solid.palette.mode = 'heatmap';
        solid.params.kb = true;
        spectrum.draw(solid, 1, 800);
        spectrum.plugin.displayOptions.traceStyle(gradientContext, 800, 300);
        assert.deepEqual(gradients[0], [0, 300, 0, 0]);
        spectrum.dispose();

        const stereoItem = createItem('stereo', 'stereo-solid');
        stereoItem.palette.color = '#123456';
        const stereo = createAnalyzerDisplay(stereoItem, canvas(), env.sources);
        assert.equal(stereo.plugin.displayOptions.sampleStyle(gradientContext, 0, 0, 128),
            `rgba(18,52,86,${128 / 255})`);
        stereo.dispose();

        const item = createItem('spectrogram', 'heatmap'), target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        const plugin = display.plugin;
        item.palette.color = '#123456';
        display.draw(item, 1, 800);
        assert.deepEqual(Array.from(plugin.displayOptions.frequencyColorLut.slice(0, 6)),
            [18, 52, 86, 18, 52, 86]);
        plugin.paintDspSpectrogramColumn(0, new Uint8Array(256).fill(128));
        assert.deepEqual(Array.from(plugin.imageDataCache.data.slice(0, 4)), [18, 52, 86, 128]);

        item.palette.mode = 'heatmap';
        item.palette.motion = { mode: 'hue', speed: 1 };
        plugin.dspSpectrogramActive = true;
        plugin.spectrogramIntensityBuffer.fill(128);
        display.draw(item, 2, 800);
        const { rgb, rgba } = env.window.SpectrogramPlugin.getHeatmapLuts();
        assert.equal(display.phase, 0);
        assert.equal(plugin.displayOptions.frequencyColorLut, null);
        assert.deepEqual(Array.from(plugin.imageDataCache.data.slice(0, 4)), Array.from(rgba.slice(128 * 4, 128 * 4 + 4)));
        for (const intensity of [0, 32, 128, 224, 255]) {
            const source = intensity * 3, output = intensity * 4, alpha = rgba[output + 3] / 255;
            for (let channel = 0; channel < 3; channel++)
                assert.ok(Math.abs(Math.round(rgba[output + channel] * alpha) - rgb[source + channel]) <= 1);
        }
        assert.equal(rgba[3], 0, 'Native black becomes transparent');
        const native = new env.window.SpectrogramPlugin();
        assert.equal(native.displayOptions?.heatmapColorLut, undefined);
        native.setColor('Heatmap');
        assert.equal(native.createSpectrogramColorLut(), rgb, 'Native Heatmap retains its original opaque RGB palette');

        const levels = new Uint8Array(256).fill(64);
        plugin.paintDspSpectrogramColumn(0, levels);
        levels.fill(224);
        plugin.paintDspSpectrogramColumn(1, levels);
        assert.deepEqual(Array.from(plugin.imageDataCache.data.slice(0, 4)), Array.from(rgba.slice(64 * 4, 64 * 4 + 4)));
        assert.deepEqual(Array.from(plugin.imageDataCache.data.slice(4, 8)), Array.from(rgba.slice(224 * 4, 224 * 4 + 4)));
        plugin.spectrogramBuffer.fill(-48);
        plugin.paintLegacySpectrogramImage();
        assert.deepEqual(Array.from(plugin.imageDataCache.data.slice(0, 4)), Array.from(rgba.slice(128 * 4, 128 * 4 + 4)));
        display.dispose();
    });
});

test('Notes Heatmap uses confidence for history and volume bars without a second intensity fade', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('notes', 'notes'); item.palette.mode = 'heatmap';
        const display = createAnalyzerDisplay(item, canvas(), env.sources);
        const plugin = display.plugin;
        const confidence = .5, index = Math.round(confidence * 255) * 4;
        const rgba = env.window.SpectrogramPlugin.getHeatmapLuts().rgba;
        plugin.history[197] = confidence;
        plugin.paintHistoryImage();
        const row = 88 - 1 - (60 - 21);
        const pixel = (row * 1024) * 4;
        assert.deepEqual(Array.from(plugin.imageData.data.slice(pixel, pixel + 4)),
            Array.from(rgba.slice(index, index + 4)));
        const gradients = [];
        const context = { createLinearGradient: () => {
            const gradient = { stops: [], addColorStop(position, color) { this.stops.push([position, color]); } };
            gradients.push(gradient); return gradient;
        }, fillRect() {} };
        const bar = plugin._volumeBarShape(0, { midi: 60, best: 197, confidence }, 8, plugin._displayPalette());
        assert.ok(bar.fill.endsWith(`, ${rgba[index + 3] / 255})`));
        plugin.mn = plugin.mx = 60;
        plugin.vl = true;
        plugin._normalizedLevel = () => confidence;
        const glow = { createRadialGradient: context.createLinearGradient,
            beginPath() {}, moveTo() {}, arc() {}, closePath() {}, fill() {} };
        plugin._drawVolumeMeters(glow, 100, 8, plugin._displayPalette());
        assert.ok(gradients[0].stops.some(([, color]) => color.endsWith(`, ${rgba[index + 3] / 255 * .5})`)));
        assert.equal(display.phase, 0);
        display.dispose();
    });
});

test('Visualizer keyboards keep their key depth in proportion as graph items resize', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        for (const [type, layouts] of [
            ['spectrum', [null]], ['spectrogram', [null]],
            ['notes', ['Horizontal', 'Vertical']]
        ]) for (const ly of layouts) {
            const ratios = [];
            for (const [scale, pixelRatio] of [[.5, 1], [1, 1], [2, 1], [1, 2]]) {
                const item = createItem(type, type);
                item.params.kb = true;
                if (ly) item.params.ly = ly;
                const target = canvas();
                target.width = 1024 * scale;
                target.height = 480 * scale;
                const display = createAnalyzerDisplay(item, target, env.sources);
                target.context.calls.length = 0;
                display.draw(item, 1, target.width / pixelRatio);
                const calls = target.context.calls;
                const depth = type === 'spectrum'
                    ? calls.find(call => call[0] === 'rect' && call[1] === 0 &&
                        call[2] > 0 && call[3] === target.width)?.[4]
                    : type === 'spectrogram'
                        ? calls.find(call => call[0] === 'rect' && call[1] > 0 &&
                            call[2] === 0 && call[4] === target.height)?.[3]
                        : Math.max(...calls.filter(call => call[0] === 'fillRect').map(call => call[3]));
                assert.ok(depth > 0, `${type} ${ly ?? ''}: keyboard visible at ${scale}x`);
                const blackDepth = type === 'spectrum' ? 4 : 3;
                assert.ok(calls.some(call => call[0] === 'fillRect' &&
                    Math.abs(call[blackDepth] - depth * 95 / 150) < 1e-8),
                `${type} ${ly ?? ''}: black keys retain their depth relative to white keys`);
                const pitchLength = type === 'spectrum' ? target.width
                    : type === 'spectrogram' || ly === 'Vertical' ? target.height : target.width;
                ratios.push(depth / pitchLength);
                item.params.kb = false;
                target.context.calls.length = 0;
                display.draw(item, 1, target.width / pixelRatio);
                const hidden = target.context.calls;
                assert.equal(type === 'spectrum'
                    ? hidden.some(call => call[0] === 'rect' && call[1] === 0 && call[2] > 0 && call[3] === target.width)
                    : type === 'spectrogram'
                        ? hidden.some(call => call[0] === 'rect' && call[1] > 0 && call[2] === 0 && call[4] === target.height)
                        : hidden.some(call => call[0] === 'fillRect'), false,
                `${type} ${ly ?? ''}: hidden keyboard has no gutter`);
                display.dispose();
            }
            for (const ratio of ratios.slice(1)) {
                assert.ok(Math.abs(ratio - ratios[0]) < 1e-10,
                    `${type} ${ly ?? ''}: keyboard key aspect remains stable`);
            }
        }
    });
});

test('Display ballistics pass through at zero fall time, fall 20 dB per fall time, and hold peaks', () => {
    const instant = createBallistics(2, false);
    stepBallistics(instant, Float32Array.of(-10, -30), 0, 0);
    stepBallistics(instant, Float32Array.of(-50, -70), 0, 0);
    assert.deepEqual(Array.from(instant.cur), [-50, -70]);

    const state = createBallistics(1, true);
    stepBallistics(state, [-10], 0, 2, 1, 0.5);
    assert.deepEqual([state.cur[0], state.peak[0]], [-10, -10]);
    stepBallistics(state, [-100], 0, 2, 1, 0.5);
    assert.deepEqual([state.cur[0], state.peak[0]], [-10, -10]);
    stepBallistics(state, [-100], 2, 2, 1, 0.5);
    // The current value falls 20 dB in 2 s; the peak holds 1 s, then falls 40 dB/s for 1 s.
    assert.equal(state.cur[0], -30);
    assert.equal(state.peak[0], -30);
    stepBallistics(state, [-100], 0.5, 2, 1, 0.5);
    // The -30 dB value reached at the last step is itself held.
    assert.equal(state.cur[0], -35);
    assert.equal(state.peak[0], -30);
    stepBallistics(state, [-20], 0, 2, 1, 0.5);
    stepBallistics(state, [-100], 0.5, 2, 1, 0.5);
    assert.deepEqual([state.cur[0], state.peak[0]], [-25, -20]);
    assert.ok([...state.cur, ...state.peak].every(Number.isFinite));

    // A brief return to the held level must not make a neighbor 0.01 dB lower fall away.
    const pair = createBallistics(2, true);
    let widest = 0;
    for (let frame = 0; frame < 180; frame++) {
        const level = frame === 0 || frame === 54 ? -10 : -30;
        stepBallistics(pair, [level, frame === 54 ? level - 0.01 : level], 1 / 60, 0, 1.5, 2);
        const gap = Math.abs(pair.peak[0] - pair.peak[1]);
        if (gap > widest) widest = gap;
    }
    assert.ok(widest <= 0.01 + 1e-9, `neighbor peaks diverged by ${widest} dB`);
});

test('Spectrum smoothing is an identity at zero and spreads a spike symmetrically in log frequency', () => {
    const smooth = createSpectrumSmoother();
    const levels = new Float32Array(1001).fill(-240);
    levels.fill(-145, 100, 900);
    levels[500] = 0;
    assert.equal(smooth(levels, 0, { start: 100, end: 900 }), levels);

    const output = smooth(levels, 0.5, { start: 100, end: 900 });
    for (let i = 0; i < 100; i++) assert.equal(output[i], -240);
    for (let i = 900; i < 1001; i++) assert.equal(output[i], -240);
    assert.ok(output[500] < -10 && output[520] > -100);
    for (let d = 1; d < 58; d++) assert.ok(Math.abs(output[500 - d] - output[500 + d]) < 1e-6);
    let power = 0;
    for (let i = 100; i < 900; i++) {
        assert.ok(output[i] >= -145);
        power += 10 ** (output[i] / 10);
    }
    assert.ok(Math.abs(power - 1) < 1e-6);
    assert.equal(smooth(levels, 0.5, { start: 100, end: 900 }), output);

    const bins = new Float32Array(4096).fill(-145);
    bins[0] = 3;
    bins[1000] = 0;
    const linear = smooth(bins, 1);
    assert.equal(linear[0], 3);
    for (const octave of [0.1, 0.3, 0.5]) {
        assert.ok(Math.abs(linear[Math.round(1000 * 2 ** octave)] - linear[Math.round(1000 / 2 ** octave)]) < 0.5);
    }
    assert.ok(linear[1000] < -10 && linear[1500] < linear[1200]);
});

test('Spectrum smoothing keeps quiet high bins accurate next to a loud low end', () => {
    const quiet = new Float32Array(8192);
    for (let i = 0; i < quiet.length; i++) quiet[i] = -130 + 3 * Math.sin(i * 0.37);
    const loud = quiet.slice();
    loud.fill(0, 0, 40);
    const reference = createSpectrumSmoother()(quiet, 0.3);
    const output = createSpectrumSmoother()(loud, 0.3);
    for (let i = 100; i < quiet.length; i++) assert.ok(Math.abs(output[i] - reference[i]) < 1e-3, `bin ${i}`);
});

test('Spectrum applies fall time, peak hold and peak fall to telemetry, and hides peaks when Peak is off', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('spectrum', 'spectrum'), target = canvas();
        Object.assign(item.params, { sc: 'log', cf: 1, ph: 0.5, pf: 2 });
        const display = createAnalyzerDisplay(item, target, env.sources);
        env.window.SpectrumAnalyzerPlugin.prototype.parseDspSpectrumTelemetryFrame = frame => frame.snapshot;
        const send = level => env.subscribers.get('spectrum')({ snapshot: { sampleRate: 48000, points: 8, flags: 0,
            current: new Float32Array(128).fill(level), peaks: new Float32Array(128).fill(level) } }, {});
        send(-60);
        display.draw(item, 1, 800);
        assert.equal(display.plugin.spectrum[10], -60);
        send(-100);
        display.draw(item, 1.25, 800);
        assert.equal(display.plugin.spectrum[10], -65);
        assert.equal(display.plugin.peaks[10], -60);
        display.draw(item, 1.75, 800);
        assert.equal(display.plugin.spectrum[10], -75);
        // A value entered at the start of a hold slot is held for 1.25 x ph, then falls.
        assert.equal(display.plugin.peaks[10], -61.25);
        assert.equal(display.plugin.peakDecayPaused, true);

        const hiddenPeakPoints = () => {
            target.context.calls.length = 0;
            display.draw(item, 1.75, 800);
            return target.context.calls.filter(call =>
                (call[0] === 'lineTo' || call[0] === 'fillRect') && !Number.isFinite(call[2])).length;
        };
        assert.equal(hiddenPeakPoints(), 0);
        item.params.pk = false;
        assert.ok(hiddenPeakPoints() > 0);
        item.params.dm = 'bar';
        assert.ok(hiddenPeakPoints() > 0);
        item.params.pk = true;
        assert.equal(hiddenPeakPoints(), 0);
        display.dispose();
    });
});

test('Level Meter reapplies time parameters after a channel change and hides its peak marker when Peak is off', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('level-meter', 'meter'), target = canvas();
        Object.assign(item.params, { cf: 0, ph: 2.5, pf: 4, showLevelValues: true });
        const display = createAnalyzerDisplay(item, target, env.sources);
        const plugin = display.plugin;
        const check = () => {
            assert.equal(plugin.FALL_RATE, Number.MAX_VALUE);
            assert.equal(plugin.PEAK_HOLD_TIME, 2.5);
            assert.equal(plugin.PEAK_FALL_RATE, 5);
        };
        check();
        display.draw({ ...item, channel: 'L' }, 1, 800);
        check();
        display.draw(item, 1, 800);
        const draw = () => {
            Object.assign(plugin, { lv: [-10, -10], raw: [-10, -10], pl: [-3, -3], ph: [1, 1] });
            target.context.calls.length = 0;
            display.draw(item, 1, 800);
            const calls = target.context.calls;
            return { markers: calls.filter(call => call[0] === 'fillRect' && call[3] === 2 * plugin.graphDpr).length,
                texts: calls.filter(call => call[0] === 'fillText').map(call => call[1]) };
        };
        const shown = draw();
        assert.equal(shown.markers, 2);
        assert.ok(shown.texts.includes('L -3.0 dB'));
        item.params.pk = false;
        const hidden = draw();
        assert.equal(hidden.markers, 0);
        assert.ok(hidden.texts.includes('L -10.0 dB'));
        display.dispose();
    });
});

test('Chroma releases cell levels at its fall time', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('chroma', 'chroma'), target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        const plugin = display.plugin;
        plugin.levelReference = -20;
        plugin.display = [{ midi: 60, level: -20.3 }, { midi: 61, level: -40 }];
        display.draw(item, 1, 800);
        assert.deepEqual(plugin.display.map(cell => cell.level), [-20.3, -40]);
        item.params.cf = 2;
        plugin.display = [{ midi: 60, level: -80 }, { midi: 61, level: -30 }];
        display.draw(item, 1.5, 800);
        assert.deepEqual(plugin.display.map(cell => cell.level), [-25.3, -30]);
        display.dispose();
    });
});

test('Stereo hides only its peak contour when Peak is off', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('stereo', 'stereo'), target = canvas();
        const display = createAnalyzerDisplay(item, target, env.sources);
        const measurements = display.plugin.currentMeasurements = {
            xBuffer: new Float32Array(100).fill(.5), yBuffer: new Float32Array(100).fill(.3),
            currentPosition: 0, peakBuffer: new Float32Array(360).fill(.5)
        };
        display.plugin.sampleRate = 100;
        const draw = () => {
            target.context.calls.length = 0;
            display.draw(item, 1, 800);
            const calls = target.context.calls;
            return { hidden: calls.filter(call => call[0] === 'lineTo' && Number.isNaN(call[1])).length,
                samples: calls.filter(call => call[0] === 'rect').length };
        };
        const shown = draw();
        assert.equal(shown.hidden, 0);
        item.params.pk = false;
        const hidden = draw();
        assert.equal(hidden.hidden, 359);
        assert.equal(hidden.samples, shown.samples);
        assert.equal(display.plugin.currentMeasurements, measurements);
        display.dispose();
    });
});

test('Stereo peak contour holds and then falls at the Peak Fall Time rate', async () => {
    const env = runtime();
    await withGlobals(env, () => {
        const item = createItem('stereo', 'stereo');
        const display = createAnalyzerDisplay(item, canvas(), env.sources);
        const db = values => 20 * Math.log10(values[0]);
        const params = { ph: .5, pf: 2 };
        display.stepStereo(new Float32Array(360).fill(1), params, 0);
        const quiet = new Float32Array(360).fill(.1);
        assert.ok(Math.abs(db(display.stepStereo(quiet, params, .5))) < 1e-5, 'held');
        // Held for 1.25 x ph (a value entered at the start of a hold slot), then 10 dB/s.
        assert.ok(Math.abs(db(display.stepStereo(quiet, params, 1)) + 8.75) < 1e-4, 'falls 10 dB per second');
        // The defaults follow the DSP envelope, which already falls 20 dB/s.
        const defaults = { ph: item.params.ph, pf: item.params.pf };
        display.stepStereo(new Float32Array(360).fill(1), defaults, 0);
        assert.ok(Math.abs(db(display.stepStereo(new Float32Array(360).fill(10 ** -.5), defaults, .5)) + 10) < 1e-4);
        display.dispose();
    });
});
