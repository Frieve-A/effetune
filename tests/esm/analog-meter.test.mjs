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

        createParameterControl(label, min, max, step, value, setter, unit, modelKey) {
            return Object.assign(this.makeRow('input', label, modelKey), { min, max, unit, setter });
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
        md: 'VU', it: 0.3, at: 5, rt: 1.5, rl: -14, rg: 40, sc: 0, ph: 1, ln: 0, tg: -23, ls: 0
    });
    assert.deepEqual([...Plugin.MODES], ['VU', 'PPM', 'RMS', 'Sample Peak', 'True Peak', 'Loudness']);

    plugin.setParameters({
        md: 'Loudness', it: 9, at: 0, rt: -1, rl: -40, rg: 100, sc: '2', ph: 20, ln: '1', tg: 0, ls: 1
    });
    assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
        type: 'AnalogMeterPlugin', enabled: true,
        md: 'Loudness', it: 3, at: 1, rt: 0.1, rl: -30, rg: 60, sc: 2, ph: 10, ln: 1, tg: -10, ls: 1
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

test('Analog Meter thins crowded labels to every other one from the reference', async () => {
    const { Plugin } = await loadPlugin();
    const kept = scale => Array.from(Plugin.sparseLabels(scale), tick => tick.value);
    assert.deepEqual(kept(Plugin.scale('Loudness', { tg: -23, ls: 0 })), [-41, -35, -29, -23, -17]);
    assert.deepEqual(kept(Plugin.scale('True Peak', { rl: -18, rg: 30 })), [-30, -20, -10, 0]);
    // DIN keeps its -9 reference and skips the unlabeled -10 mark when counting.
    assert.deepEqual(kept(Plugin.scale('PPM', { rl: -18, rg: 40, sc: 0 })), [-30, -9, 0]);
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
    assert.equal(Plugin.parseTelemetryFrame(frame(6, [[-23, -24]])), null);
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
    const parameters = ui.children.find(child => child.className === 'analog-meter-parameters');
    assert.equal(parameters.children.length, 11);
    const hidden = () => Object.entries(plugin.parameterRows)
        .filter(([, row]) => row.style.display === 'none')
        .map(([key]) => key).sort();
    assert.deepEqual(hidden(), ['at', 'it', 'ln', 'ls', 'ph', 'rg', 'rt', 'sc', 'tg']);

    plugin.setParameters({ md: 'RMS' });
    assert.deepEqual(hidden(), ['at', 'ln', 'ls', 'rt', 'sc', 'tg']);
    plugin.setParameters({ md: 'True Peak' });
    assert.deepEqual(hidden(), ['at', 'it', 'ln', 'ls', 'rl', 'sc', 'tg']);
    plugin.setParameters({ md: 'PPM' });
    assert.deepEqual(hidden(), ['it', 'ln', 'ls', 'tg']);
    plugin.setParameters({ sc: 1 });
    assert.deepEqual(hidden(), ['it', 'ln', 'ls', 'rg', 'tg']);
    plugin.setParameters({ md: 'Loudness' });
    assert.deepEqual(hidden(), ['at', 'it', 'ph', 'rg', 'rl', 'rt', 'sc']);
    assert.equal(plugin.resetButton.style.display, '');
    assert.equal(plugin.graphContainer.style.aspectRatio, '12 / 3');

    plugin.resetButton.listeners.get('click')();
    assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'resetPluginState', pluginId: 7 }]);
});
