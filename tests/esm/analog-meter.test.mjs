import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginPath = path.join(repoRoot, 'plugins', 'analyzer', 'analog_meter.js');

class FakeElement {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.style = { setProperty: (name, value) => { this.style[name] = value; } };
        this.classes = new Set();
        this.classList = {
            toggle: (name, force) => (force ? this.classes.add(name) : this.classes.delete(name)),
            contains: name => this.classes.has(name)
        };
        this.listeners = new Map();
        this.disabled = false;
        if (this.tagName === 'CANVAS') {
            this.width = 800;
            this.height = 600;
            this.getContext = () => createCanvasContext();
        }
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    setAttribute() {}
    addEventListener(type, listener) { this.listeners.set(type, listener); }

    querySelectorAll() {
        return this.children.flatMap(child => [
            ...(['INPUT', 'SELECT'].includes(child.tagName) ? [child] : []),
            ...child.querySelectorAll()
        ]);
    }
}

function createCanvasContext() {
    const noop = () => {};
    return new Proxy({ measureText: text => ({ width: text.length * 6 }) }, {
        get: (target, name) => target[name] ?? noop,
        set: () => true
    });
}

function createPluginBase() {
    return class PluginBase {
        constructor(name, description) {
            this.name = name;
            this.description = description;
            this.enabled = true;
            this._sectionEnabled = true;
            this.temporalCapability = 'reset-on-resume';
            this.id = 7;
            this.refreshHooks = [];
        }

        registerProcessor(processor) { this.processor = processor; }
        _setupMessageHandler() {}
        onMessage() {}
        updateParameters() { this.updateCount = (this.updateCount || 0) + 1; }
        cleanup() { this.cleanedUp = true; }
        canRunAnimation() { return true; }
        renderPowerUiOnce(callback) { callback(); }
        requestPowerAnimationFrame() { return 1; }
        registerUIRefresh(fn) { this.refreshHooks.push(fn); }

        parseFiniteNumber(value, minimum, maximum, fallback) {
            const number = Number(value);
            if (!Number.isFinite(number)) return fallback;
            return number < minimum ? minimum : (number > maximum ? maximum : number);
        }

        makeRow(tag, label, modelKey) {
            const row = new FakeElement('div');
            row.label = label;
            row.modelKey = modelKey;
            row.appendChild(new FakeElement(tag));
            return row;
        }

        createParameterControl(label, min, max, step, value, setter, unit, modelKey, toDisplay, logarithmic) {
            return Object.assign(this.makeRow('input', label, modelKey), { min, max, step, unit, setter, logarithmic });
        }

        createSelectControl(label, options, value, setter, modelKey) {
            return Object.assign(this.makeRow('select', label, modelKey), { options, setter });
        }

        createRadioGroup(label, options, value, setter, modelKey) {
            return Object.assign(this.makeRow('input', label, modelKey), { options, value, setter });
        }

        createResponsiveGraph(options) {
            this.graphOptions = options;
            const container = new FakeElement('div');
            const canvas = new FakeElement('canvas');
            container.appendChild(canvas);
            return { container, canvas, dispose() {} };
        }
    };
}

async function loadPlugin({ telemetryHub = null, workletNode = null } = {}) {
    const source = await fs.readFile(pluginPath, 'utf8');
    const context = vm.createContext({
        PluginBase: createPluginBase(),
        document: { createElement: tagName => new FakeElement(tagName) },
        performance: { now: () => 0 },
        window: {
            dspTelemetryHub: telemetryHub,
            workletNode,
            ThemePalette: { get: name => `theme-${name}` }
        }
    });
    vm.runInContext(source, context, { filename: pluginPath });
    const Plugin = context.window.AnalogMeterPlugin;
    assert.equal(typeof Plugin, 'function');
    return { Plugin, plugin: new Plugin() };
}

function frame(mode, channels, program = null, flags = 0) {
    const bytes = 4 + 8 * channels.length + (program ? 24 : 0);
    const payload = new DataView(new ArrayBuffer(bytes));
    payload.setUint8(0, mode);
    payload.setUint8(1, channels.length);
    payload.setUint16(2, flags, true);
    channels.forEach(([needle, max], index) => {
        payload.setFloat32(4 + 8 * index, needle, true);
        payload.setFloat32(8 + 8 * index, max, true);
    });
    program?.forEach((value, index) => payload.setFloat32(4 + 8 * channels.length + 4 * index, value, true));
    return { frameType: 27, formatVersion: 1, payload };
}

test('Analog Meter declares its parameter contract and execution requirements', async () => {
    const { Plugin, plugin } = await loadPlugin();
    assert.equal(plugin.name, 'Analog Meter');
    assert.equal(plugin.processor, 'return data;');
    assert.equal(Plugin.executionCapabilities.requiresWasm, true);
    assert.equal(plugin.temporalCapability, 'stateless');
    assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
        type: 'AnalogMeterPlugin', enabled: true,
        md: 'VU', it: 0.3, at: 5, rt: 1.5, rl: -14, rg: 40, sc: 0, ph: 1, ln: 0, tg: -23, ls: 0,
        de: 'Average Rectified', nr: 300, os: 1.25, dc: 0
    });
    assert.deepEqual([...Plugin.MODES], ['VU', 'PPM', 'RMS', 'Sample Peak', 'True Peak', 'Loudness', 'Custom']);

    plugin.setParameters({
        md: 'Loudness', it: 9, at: 0, rt: -1, rl: -40, rg: 100, sc: '2', ph: 20, ln: '1', tg: 0, ls: 1
    });
    assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
        type: 'AnalogMeterPlugin', enabled: true,
        md: 'Loudness', it: 3, at: 1, rt: 0.1, rl: -30, rg: 60, sc: 2, ph: 10, ln: 1, tg: -10, ls: 1,
        de: 'Average Rectified', nr: 300, os: 1.25, dc: 0
    });
    plugin.setParameters({ md: 'Bogus', sc: 3, ln: 2, ls: 'x', rl: 'bad' });
    assert.deepEqual([plugin.md, plugin.sc, plugin.ln, plugin.ls, plugin.rl], ['Loudness', 2, 1, 1, -30]);
    plugin.reset();
    assert.equal(plugin.getParameters().md, 'VU');
    assert.equal(plugin.ln, 0);
});

test('Analog Meter scales place the reference marks from the plan', async () => {
    const { Plugin } = await loadPlugin();
    const params = (rl, sc = 0) => ({ rl, rg: 40, sc, tg: -23, ls: 0 });
    const vu = Plugin.scale('VU', params(-18));
    assert.equal(vu.toLabel(-18), 0);
    assert.equal(Plugin.scale('VU', params(-20)).toLabel(-20), 0);
    assert.deepEqual([vu.min, vu.max], [-20, 3]);
    assert.equal(vu.dbPosition(-15), 1);

    const din = Plugin.scale('PPM', params(-18, 0));
    assert.equal(din.toLabel(-18), -9);
    assert.equal(din.toLabel(-9), 0);
    assert.deepEqual([din.min, din.max], [-40, 5]);

    const bbc = Plugin.scale('PPM', params(-18, 1));
    assert.equal(bbc.toLabel(-18), 4);
    assert.equal(bbc.toLabel(-32), 1);
    assert.equal(bbc.toLabel(-26), 2);
    assert.equal(bbc.toLabel(-6), 7);
    assert.equal(bbc.dbPosition(-18), 0.5);

    const decibel = Plugin.scale('PPM', { ...params(-18, 2), rg: 30 });
    assert.equal(decibel.toLabel(-18), 0);
    assert.deepEqual([decibel.min, decibel.max], [-30, 5]);
    assert.deepEqual([decibel.ticks[0].value, decibel.ticks.at(-1).value], [-30, 5]);

    const rms = Plugin.scale('RMS', params(-18));
    assert.equal(rms.toLabel(-18), 0);
    assert.deepEqual([rms.min, rms.max], [-40, 18]);

    const peak = Plugin.scale('True Peak', { ...params(-18), rg: 30 });
    assert.deepEqual([peak.min, peak.max], [-30, 0]);
    assert.equal(peak.dbPosition(1.5), 1);
    assert.equal(peak.readout(1.5), '+1.5 dBTP');
    assert.equal(peak.readout(-240), '-∞');

    const ebu9 = Plugin.scale('Loudness', { tg: -23, ls: 0 });
    assert.deepEqual([ebu9.min, ebu9.max, ebu9.reference], [-41, -14, -23]);
    assert.deepEqual(Array.from(ebu9.ticks, tick => tick.value),Array.from({ length: 10 }, (_, i) => -41 + 3 * i));
    const ebu18 = Plugin.scale('Loudness', { tg: -14, ls: 1 });
    assert.deepEqual([ebu18.min, ebu18.max, ebu18.reference], [-50, 4, -14]);
});

test('Custom detector and dial settings validate, select controls, and preserve needle adjustments', async () => {
    const { Plugin, plugin } = await loadPlugin();
    const ui = plugin.createUI();
    const parameters = ui.children.find(child => child.className === 'analyzer-parameters');
    const visible = () => parameters.children.filter(row => row.modelKey !== 'md' && row.style.display !== 'none')
        .map(row => row.modelKey);
    const disabled = () => Object.entries(plugin.parameterRows)
        .filter(([, row]) => row.style.display !== 'none' && row.querySelectorAll().every(input => input.disabled))
        .map(([key]) => key);
    const customRows = ['de', 'it', 'rt', 'nr', 'os', 'dc', 'rl', 'rg', 'ph'];
    plugin.setParameters({ md: 'Custom' });
    assert.deepEqual(visible(), customRows);
    assert.deepEqual(disabled(), ['it', 'rt', 'rg']);
    assert.ok(plugin.parameterRows.it.classList.contains('parameter-disabled'));
    assert.equal(plugin.parameterRows.nr.logarithmic, true);
    assert.equal(plugin.parameterRows.os.step, 0.05);
    for (const de of ['RMS', 'Sample Peak', 'True Peak']) {
        plugin.setParameters({ de, dc: 3 });
        assert.deepEqual(visible(), customRows);
        assert.deepEqual(disabled(), [de === 'RMS' ? 'rt' : 'it']);
    }
    plugin.handleTelemetry(frame(6, [[-18, -17]]));
    assert.equal(plugin.reading.channels[0].needleDb, -18);
    assert.equal(plugin.holds[0].db, -17);
    const reading = plugin.reading;
    plugin.setParameters({ nr: 9000, os: -1, dc: '4' });
    assert.deepEqual([plugin.nr, plugin.os, plugin.dc], [3000, 0, 4]);
    assert.equal(plugin.reading, reading);
    assert.deepEqual(visible(), customRows);
    assert.deepEqual(disabled(), ['it', 'rl']);
    plugin.setParameters({ de: 'bad', dc: 1.5, nr: 'bad', os: Infinity });
    assert.deepEqual([plugin.de, plugin.dc, plugin.nr, plugin.os], ['True Peak', 4, 3000, 0]);
    plugin.setParameters({ nr: 0, os: 99, de: 'Average Rectified', dc: 2 });
    assert.deepEqual([plugin.nr, plugin.os], [1, 25]);
    assert.equal(plugin.reading, null);
    assert.equal(plugin.holds.length, 0);
    assert.deepEqual(visible(), customRows);
    assert.deepEqual(disabled(), ['it', 'rt', 'rg']);
    assert.equal(Plugin.isParameterActive('at', plugin), false);
    plugin.setParameters({ it: 1.25, rt: 2.33, rl: -18, rg: 50 });
    for (const de of ['Average Rectified', 'RMS', 'Sample Peak', 'True Peak']) {
        for (const dc of [0, 1, 2, 3, 4]) {
            plugin.setParameters({ de, dc });
            assert.deepEqual(visible(), customRows, 'Detector and Dial preserve the control layout');
            assert.deepEqual([plugin.it, plugin.rt, plugin.rl, plugin.rg], [1.25, 2.33, -18, 50]);
        }
    }
    plugin.setParameters({ md: 'RMS' });
    assert.deepEqual(visible(), ['it', 'rl', 'rg', 'ph']);
    assert.deepEqual(disabled(), []);
    assert.equal(plugin.parameterRows.it.classList.contains('parameter-disabled'), false);
    plugin.cleanup();
});

test('Custom dials use the corresponding existing scales and VU percent appearance', async () => {
    const { Plugin, plugin } = await loadPlugin();
    const params = { ...plugin.getParameters(), md: 'Custom', rl: -18, rg: 42 };
    for (const [dc, mode, sc] of [[0, 'VU', 0], [1, 'PPM', 0], [2, 'PPM', 1], [3, 'RMS', 0], [4, 'Sample Peak', 0]]) {
        const custom = Plugin.scale('Custom', { ...params, dc });
        const original = Plugin.scale(mode, { ...params, sc });
        assert.deepEqual([custom.unit, custom.min, custom.max, custom.reference, custom.redFrom],
            [original.unit, original.min, original.max, original.reference, original.redFrom]);
        assert.deepEqual(custom.ticks, original.ticks);
        for (const db of [-200, -60, -18, 0, 3]) {
            assert.equal(custom.dbPosition(db), original.dbPosition(db));
            assert.equal(custom.readout(db), original.readout(db));
        }
        assert.equal(Plugin.usesVuDial({ ...params, dc }), dc === 0);
    }
    assert.equal(Plugin.scale('Custom', { ...params, dc: 4, de: 'True Peak' }).unit, 'dBTP');
    plugin.setParameters({ md: 'Custom', dc: 0, rl: -18 });
    plugin.handleTelemetry(frame(6, [[-18, -18]]));
    const text = [];
    const context = createCanvasContext();
    plugin.drawCellContent(context, { grid: '', label: '', text: '', danger: '' }, Plugin.scale('Custom', plugin),
        0, 0, 400, 300, 0, 0, { textContext: { fillText: value => text.push(value) },
            meterAppearance: { showPercent: true, readoutUnit: 'percent' } });
    assert.ok(text.includes('Custom'));
    assert.ok(text.includes('100%'));
    assert.ok(text.includes('100.0%'));
});

test('Analog Meter thins crowded labels to every other one from the reference', async () => {
    const { Plugin } = await loadPlugin();
    const kept = scale => Array.from(Plugin.sparseLabels(scale), tick => tick.value);
    assert.deepEqual(kept(Plugin.scale('Loudness', { tg: -23, ls: 0 })), [-41, -35, -29, -23, -17]);
    assert.deepEqual(kept(Plugin.scale('True Peak', { rl: -18, rg: 30 })), [-30, -20, -10, 0]);
    // DIN keeps its -9 reference and skips the unlabeled -10 mark when counting.
    assert.deepEqual(kept(Plugin.scale('PPM', { rl: -18, rg: 40, sc: 0 })), [-30, -9, 0]);
});

test('Meter marks follow the electrical needle angle on circular, elliptical and straight dials', async () => {
    const { Plugin } = await loadPlugin();
    const radius = 200;
    const scale = Plugin.scale('VU', { rl: -14 });
    for (const sweep of [30, 100, 160]) {
        const radians = sweep * Math.PI / 360;
        for (const curvature of [0, 0.000001, 0.01, 0.25, 0.5, 0.99, 1]) {
            for (const offset of [0, 100]) {
                const geometry = Plugin.geometry(300, 400, radius, radians, curvature, offset);
                for (const tick of scale.ticks) {
                    const position = scale.valuePosition(tick.value);
                    const [x, y] = geometry.pointAt(position, radius);
                    const dx = x - geometry.pivotX, dy = geometry.pivotY - y;
                    const angle = Math.atan2(dx, dy);
                    assert.ok(Math.abs(angle - (-radians + 2 * radians * position)) < 1e-12);
                    assert.ok(Math.hypot(dx, dy) <= radius + 1e-9, 'Dial stays within the fixed needle circle');
                    if (curvature === 0) {
                        assert.ok(Math.abs(dy - radius * Math.cos(radians)) < 1e-9, 'All straight marks share one height');
                    } else {
                        // Verify the implicit ellipse equation independently of the ray solver.
                        const center = (1 - curvature) * radius * Math.cos(radians);
                        const ellipse = (dx / radius) ** 2 + ((dy - center) / (curvature * radius)) ** 2;
                        assert.ok(Math.abs(ellipse - 1) < 1e-8, 'Every mark lies on the actual ellipse');
                    }
                }
                for (const position of [0, 1]) {
                    const [x, y] = geometry.pointAt(position, radius);
                    assert.ok(Math.abs(Math.hypot(x - 300, geometry.pivotY - y) - radius) < 1e-9);
                }
                // The limiting straight and circular cases must not jump at their boundaries.
                const nearby = Plugin.geometry(300, 400, radius, radians,
                    curvature === 0 ? 1e-6 : Math.max(0, curvature - 1e-6), offset);
                const [x, y] = geometry.pointAt(0.6, radius);
                const [nx, ny] = nearby.pointAt(0.6, radius);
                assert.ok(Math.hypot(x - nx, y - ny) < 0.001);
            }
        }
    }
});

test('Analog Meter grid uses at most four meters per row', async () => {
    const { Plugin } = await loadPlugin();
    const shape = cells => {
        const grid = Plugin.grid(cells);
        return [grid.columns, grid.rows];
    };
    assert.deepEqual(shape(1), [1, 1]);
    assert.deepEqual(shape(2), [2, 1]);
    assert.deepEqual(shape(5), [4, 2]);
    assert.deepEqual(shape(16), [4, 4]);
    assert.deepEqual(shape(17), [4, 5]);
    assert.equal(Plugin.aspect(Plugin.grid(5)), '16 / 6');
});

test('Analog Meter decodes type 27 frames and places the program meter first in Loudness', async () => {
    let subscription = null;
    const hub = {
        subscribe(tapId, type, callback) {
            subscription = { tapId, type, callback };
            return () => { subscription = null; };
        }
    };
    const { Plugin, plugin } = await loadPlugin({ telemetryHub: hub });
    plugin.getParameters();
    assert.equal(subscription.tapId, 7);
    assert.equal(subscription.type, 27);

    const program = [-20, -21, -22, 6, 0.5, 12];
    const parsed = Plugin.parseTelemetryFrame(frame(5, [[-23, -24]], program, 3));
    assert.equal(parsed.channelCount, 1);
    assert.equal(parsed.integratedValid, true);
    assert.equal(parsed.lraValid, true);
    assert.equal(parsed.program.maxTruePeak, 0.5);
    assert.equal(Plugin.parseTelemetryFrame(frame(5, [[-23, -24]])), null);
    assert.equal(Plugin.parseTelemetryFrame(frame(0, [[-23, -24]], program)), null);
    assert.equal(Plugin.parseTelemetryFrame(frame(6, [[-23, -24]])).mode, 6);
    assert.equal(Plugin.parseTelemetryFrame(frame(7, [[-23, -24]])), null);
    assert.equal(Plugin.parseTelemetryFrame({ ...frame(0, [[0, 0]]), formatVersion: 2 }), null);

    // Frames from another mode are ignored until the kernel reports the selected mode.
    subscription.callback(frame(5, [[-23, -24]], program, 3));
    assert.equal(plugin.reading, null);
    plugin.setParameters({ md: 'Loudness' });
    const channels = Array.from({ length: 16 }, () => [-30, -31]);
    subscription.callback(frame(5, channels, program, 1));
    assert.equal(plugin.channelCount, 16);
    assert.equal(plugin.cellCount(), 17);
    assert.equal(plugin.cellReading(-1), -20);
    assert.equal(plugin.cellTitle(-1), 'Program (reference)');
    assert.equal(plugin.cellTitle(0), 'Ch 1 (reference)');
    plugin.setParameters({ ln: 1 });
    assert.equal(plugin.cellReading(-1), -21);
    assert.equal(plugin.cellReading(3), -31);

    plugin.cleanup();
    assert.equal(subscription, null);
});

test('Analog Meter peak hold holds for the set time and then follows the detector', async () => {
    const { Plugin } = await loadPlugin();
    const state = { db: NaN, time: 0, overTime: null };
    Plugin.updateHold(state, -6, 0, 1);
    Plugin.updateHold(state, -12, 500, 1);
    assert.equal(state.db, -6);
    Plugin.updateHold(state, -12, 1000, 1);
    assert.equal(state.db, -12);
    Plugin.updateHold(state, 0.5, 1100, 1);
    assert.equal(Plugin.isOverLit(state, 2000, 1), true);
    assert.equal(Plugin.isOverLit(state, 2100, 1), false);
    Plugin.updateHold(state, -30, 3000, 0);
    assert.equal(state.db, -30);
    assert.equal(Plugin.isOverLit(state, 3000, 0), false);
    // With Peak Hold 0 the over lamp still lights and stays on for 1 second.
    Plugin.updateHold(state, 0.2, 4000, 0);
    assert.equal(state.db, 0.2);
    assert.equal(Plugin.isOverLit(state, 4900, 0), true);
    assert.equal(Plugin.isOverLit(state, 5000, 0), false);
});

test('Analog Meter Reset posts resetPluginState and parameters follow the mode', async () => {
    const messages = [];
    const workletNode = { port: { postMessage: message => messages.push(message) } };
    const { plugin } = await loadPlugin({ workletNode });
    const ui = plugin.createUI();
    assert.equal(plugin.resetButton.style.display, 'none');
    const parameters = ui.children.find(child => child.className === 'analyzer-parameters');
    assert.equal(parameters.children.length, 15);
    const hidden = () => Object.entries(plugin.parameterRows)
        .filter(([, row]) => row.style.display === 'none')
        .map(([key]) => key).sort();
    assert.deepEqual(hidden(), ['at', 'dc', 'de', 'it', 'ln', 'ls', 'nr', 'os', 'ph', 'rg', 'rt', 'sc', 'tg']);

    plugin.setParameters({ md: 'RMS' });
    assert.deepEqual(hidden(), ['at', 'dc', 'de', 'ln', 'ls', 'nr', 'os', 'rt', 'sc', 'tg']);
    plugin.setParameters({ md: 'True Peak' });
    assert.deepEqual(hidden(), ['at', 'dc', 'de', 'it', 'ln', 'ls', 'nr', 'os', 'rl', 'sc', 'tg']);
    plugin.setParameters({ md: 'PPM' });
    assert.deepEqual(hidden(), ['dc', 'de', 'it', 'ln', 'ls', 'nr', 'os', 'tg']);
    plugin.setParameters({ sc: 1 });
    assert.deepEqual(hidden(), ['dc', 'de', 'it', 'ln', 'ls', 'nr', 'os', 'rg', 'tg']);
    plugin.setParameters({ md: 'Loudness' });
    assert.deepEqual(hidden(), ['at', 'dc', 'de', 'it', 'nr', 'os', 'ph', 'rg', 'rl', 'rt', 'sc']);
    assert.equal(plugin.resetButton.style.display, '');
    assert.equal(plugin.graphContainer.style.aspectRatio, '12 / 3');

    plugin.resetButton.listeners.get('click')();
    assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'resetPluginState', pluginId: 7 }]);
});
