import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test, { mock } from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import * as chart from '../../features/measurement/speaker-distortion-chart.js';
import * as figures from '../../features/measurement/speaker-distortion-figures.js';
import * as constants from '../../js/utils/measurement-dsp/speaker-distortion/constants.js';
import { oddDecision, playedCheckFig } from '../../js/utils/measurement-dsp/speaker-distortion/check.js';
import { createSpeakerModel } from '../helpers/speaker-model-fixture.mjs';
import { instantiateDsp } from '../../js/audio/dsp-wasm-loader.js';
import { DSP_PARAM_PACKERS } from '../../js/audio/dsp-params.generated.js';
import { buildDspPipelineDescriptor } from '../../js/audio/dsp-pipeline-descriptor.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginPath = path.join(repoRoot, 'plugins', 'others', 'speaker_distortion_correction.js');
const pluginSource = await fs.readFile(pluginPath, 'utf8');
const pluginBaseSource = await fs.readFile(path.join(repoRoot, 'plugins', 'plugin-base.js'), 'utf8');

const settle = () => new Promise(resolve => setImmediate(resolve));

// ---- Minimal DOM: just what the plugin's UI code uses ------------------------

class FakeText {
    constructor(text) {
        this.textContent = String(text);
        this.parentNode = null;
    }
}

class FakeElement {
    constructor(document, tag) {
        this.ownerDocument = document;
        this.tagName = tag.toUpperCase();
        this.childNodes = [];
        this.parentNode = null;
        this.attributes = {};
        this.dataset = {};
        this.listeners = {};
        this.classes = new Set();
        this.hidden = false;
        this.disabled = false;
        this.checked = false;
        this.title = '';
        this.clientWidth = 0;
        this._value = '';
    }

    get className() { return [...this.classes].join(' '); }
    set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }

    get classList() {
        const classes = this.classes;
        return {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: (...names) => names.forEach(name => classes.delete(name)),
            contains: name => classes.has(name),
            toggle: (name, force) => {
                const on = force === undefined ? !classes.has(name) : Boolean(force);
                if (on) classes.add(name);
                else classes.delete(name);
                return on;
            }
        };
    }

    get children() { return this.childNodes.filter(node => node instanceof FakeElement); }
    get options() { return this.children.filter(node => node.tagName === 'OPTION'); }

    get value() {
        if (this.tagName !== 'SELECT') return this._value;
        return this.options.some(option => option.value === this._value) ? this._value : '';
    }
    set value(value) { this._value = String(value); }

    get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
    set textContent(value) {
        this.replaceChildren();
        if (value !== '' && value !== null && value !== undefined) this.append(String(value));
    }

    append(...nodes) {
        for (const node of nodes) {
            const child = node instanceof FakeElement || node instanceof FakeText ? node : new FakeText(node);
            if (child.parentNode) {
                child.parentNode.childNodes = child.parentNode.childNodes.filter(item => item !== child);
            }
            child.parentNode = this;
            this.childNodes.push(child);
        }
    }

    appendChild(node) {
        this.append(node);
        return node;
    }

    replaceChildren(...nodes) {
        for (const node of this.childNodes) node.parentNode = null;
        this.childNodes = [];
        this.append(...nodes);
    }

    contains(node) {
        for (let current = node; current; current = current.parentNode) {
            if (current === this) return true;
        }
        return false;
    }

    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }

    matches(selector) {
        const data = /^\[data-([\w-]+)="([^"]*)"\]$/.exec(selector);
        if (data) {
            const key = data[1].replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
            return this.dataset[key] === data[2];
        }
        if (selector.startsWith('.')) return this.classes.has(selector.slice(1));
        return this.tagName === selector.toUpperCase();
    }

    querySelectorAll(selector) {
        const found = [];
        const visit = element => {
            for (const child of element.children) {
                if (child.matches(selector)) found.push(child);
                visit(child);
            }
        };
        visit(this);
        return found;
    }

    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }

    focus() { this.ownerDocument.activeElement = this; }

    addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }

    dispatch(type) {
        for (const listener of this.listeners[type] ?? []) listener({ target: this });
    }

    click() {
        if (!this.disabled) this.dispatch('click');
    }
}

function createDocument() {
    const document = {
        activeElement: null,
        visibilityState: 'visible',
        createElement: tag => new FakeElement(document, tag),
        createElementNS: (namespace, tag) => new FakeElement(document, tag),
        addEventListener() {},
        removeEventListener() {}
    };
    return document;
}

// ---- Plugin harness ----------------------------------------------------------

class PluginBase {
    constructor(name, description) {
        this.name = name;
        this.description = description;
        this.enabled = true;
        this.id = 17;
        this.inputBus = null;
        this.outputBus = null;
        this.channel = null;
        this._wasmAssetOperationRevisions = new Map();
        this.assetOperations = [];
    }

    registerProcessor(source) { this.processorSource = source; }

    parseFiniteNumber(value, minimum, maximum, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
    }

    updateParameters() { this.updateCount = (this.updateCount || 0) + 1; }

    getParameters() {
        return {
            type: this.constructor.name,
            id: this.id,
            enabled: this.enabled,
            ...(this.channel !== null && { channel: this.channel })
        };
    }

    getSerializableParameters() {
        const { type, id, channel, enabled, ...parameters } = JSON.parse(JSON.stringify(this.getParameters()));
        if (channel !== undefined) parameters.ch = channel;
        return { en: enabled, ...parameters };
    }

    _setValidatedParameters(params) {
        if (params.enabled !== undefined) this.enabled = Boolean(params.enabled);
        if (params.channel !== undefined) this.channel = params.channel;
    }

    setSerializedParameters(params) {
        const { en, ch, ...pluginParams } = params;
        this.setParameters({
            ...(en !== undefined && { enabled: en }),
            ...(ch !== undefined && { channel: ch }),
            ...pluginParams
        });
    }

    _nextRevision(slot) {
        const revision = (this._wasmAssetOperationRevisions.get(slot) || 0) + 1;
        this._wasmAssetOperationRevisions.set(slot, revision);
        return revision;
    }

    _isCurrentWasmAssetOperation(slot, operationRevision) {
        return this._wasmAssetOperationRevisions.get(slot) === operationRevision;
    }

    setWasmAsset(slot, descriptor) {
        this.assetOperations.push({ op: 'set', slot, descriptor });
        return this._nextRevision(slot);
    }

    clearWasmAsset(slot) {
        this.assetOperations.push({ op: 'clear', slot });
        return this._nextRevision(slot);
    }

    createParameterControl(label, min, max, step, value, setter, unit, modelKey) {
        const row = this._document.createElement('div');
        row.className = 'parameter-row';
        row.dataset.modelKey = modelKey;
        row.setter = setter;
        return row;
    }

    createSelectControl(label, options, value, setter, modelKey) {
        const row = this._document.createElement('div');
        row.className = 'parameter-row';
        row.dataset.modelKey = modelKey;
        row.setter = setter;
        row.append(this._document.createElement('select'));
        return row;
    }

    createCheckboxControl() {
        const row = this._document.createElement('div');
        row.className = 'parameter-row checkbox-row';
        row.append(this._document.createElement('input'));
        return row;
    }

    createRadioGroup(label, options, value, setter) {
        const row = this._document.createElement('div');
        row.className = 'parameter-row radio-group';
        row.dataset.label = label;
        const optionsElement = this._document.createElement('span');
        optionsElement.className = 'radio-options';
        for (const option of options) {
            const radio = this._document.createElement('input');
            radio.id = `${label}-${option.value}`;
            radio.value = option.value;
            radio.checked = option.value === value;
            radio.addEventListener('click', () => setter(option.value));
            optionsElement.append(radio);
        }
        row.append(optionsElement);
        return row;
    }

    _setupMessageHandler() {}
    onMessage() {}
    cleanup() {}
}

function loadPlugin({ sampleRate = 48000, channelCount = 2, records = [], realBase = false } = {}) {
    const document = createDocument();
    const store = {
        measurements: records,
        refreshCount: 0,
        async refresh() { this.refreshCount++; },
        close() {}
    };
    const chartCalls = [];
    const runtime = {
        ...chart,
        ...figures,
        ...constants,
        oddDecision,
        playedCheckFig,
        openMeasurementStore: async () => store,
        drawDistortionChart: (svg, spec) => {
            chartCalls.push(spec);
            return { elements: [], legend: [] };
        }
    };
    const history = { suppressed: 0, withHistorySuppressed(callback) { this.suppressed++; callback(); } };
    const window = {
        workletNode: { channelCount, context: { sampleRate } },
        uiManager: { pipelineManager: { historyManager: history }, updateURL() {} },
        addEventListener() {},
        removeEventListener() {}
    };
    PluginBase.prototype._document = document;
    const context = vm.createContext({
        PluginBase,
        window,
        document,
        console: { ...console, warn() {}, info() {} },
        // Resolve the timer functions at call time so mock.timers applies.
        setTimeout: (...args) => setTimeout(...args),
        clearTimeout: id => clearTimeout(id),
        globalThis: null
    });
    context.globalThis = context;
    if (realBase) {
        vm.runInContext(`${pluginBaseSource}
            PluginBase.prototype._setupMessageHandler = function () { this._hasMessageHandler = true; };
            PluginBase.prototype.registerProcessor = function () {};
        `, context);
    }
    vm.runInContext(pluginSource, context, { filename: 'speaker_distortion_correction.js' });
    const Plugin = window.SpeakerDistortionCorrectionPlugin;
    Plugin.prototype._getRuntime = async () => runtime;
    return { Plugin, context, document, window, store, runtime, chartCalls, history };
}

function record(id, speakerModel, savedAt = Date.now() + 60000, name = 'Desk') {
    return { id, name, savedAt, speakerModel };
}

/** A plugin with `model` selected, looked up and its asset active. */
async function readyPlugin(model = createSpeakerModel(), options = {}) {
    const harness = loadPlugin({ ...options, records: [record('m1', model, 1)] });
    const plugin = new harness.Plugin();
    const panel = options.ui === false ? null : plugin.createUI();
    plugin._runtime = harness.runtime;
    plugin.setParameters(plugin._selectionParameters(harness.store.measurements[0]));
    await settle();
    plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);
    return { ...harness, plugin, panel, model };
}

/** The Auto/On/Off radio row labelled `label`: one option, or the state text that follows the options. */
function channelRow(panel, label) {
    const options = panel.querySelector(`[data-label="${label}"]`).querySelector('.radio-options');
    return {
        option: value => options.children.find(child => child.value === value),
        state: () => options.children.at(-1)
    };
}

function lastAsset(plugin) {
    return plugin.assetOperations.at(-1);
}

function floats(payload) {
    return new Float32Array(payload, 32);
}

const FRAMES = 1247;
const ODD_WEIGHT = 1183;
const ODD_BOUND = 1215;
const CONFIGURATIONS = ['short', 'long', 'alone'];

/** Gives `channel` an odd block; `on`, `reason` and `checkFig` are per configuration. */
function withOdd(channel, { fitReason = null, on = {}, reason = {}, checkFig = {} } = {}) {
    const weights = fitReason === 'belowLimit' || fitReason === 'noFit'
        ? null : Float32Array.from({ length: 32 }, (_, a) => (a + 1) / 100);
    const perConfiguration = values => Object.fromEntries(CONFIGURATIONS.map(c => [c, values(c)]));
    channel.odd = {
        weights,
        bounds: weights && Float32Array.from({ length: 32 }, (_, a) => 0.5 + a / 100),
        lambda: 1,
        figL: { o1: -3, o2: -2, o3: null, oddAll: -2.5 },
        figL6: -1,
        fitReason,
        worst: null,
        on: perConfiguration(c => on[c] === true),
        reason: perConfiguration(c => (c in reason ? reason[c] : on[c] || fitReason ? null : 'notChecked')),
        checkFig: perConfiguration(c => checkFig[c] ?? null)
    };
    return channel;
}

/** A measured odd configuration whose pass against plain has the even 50 Hz–8 kHz figure `even8k`. */
function oddCheck(oddAll, even8k, dv = 0) {
    return {
        dv,
        odd: [-3, -2, null, oddAll],
        total: -1,
        vsPlain: {
            fig: [-4, -3, null, -3.5, -2, even8k],
            level: [-46, -50, -47, -55],
            bandSums: new Float32Array(3 * constants.N_BANDS)
        }
    };
}

// ---- Timing ---------------------------------------------------------------

test('timing matches the delay and processing tables', () => {
    const { context } = loadPlugin();
    const rows = [
        [44100, 28, 110, 764, 846, 10],
        [48000, 30, 120, 766, 856, 10],
        [88200, 56, 286, 475.5, 537, 15],
        [96000, 60, 278, 477.5, 528, 10],
        [176400, 126, 586, 325.75, 356.25, 10],
        [192000, 134, 570, 326.75, 351.75, 10]
    ];
    for (const [rate, shortDelay, longDelay, shortOps, longOps, percent] of rows) {
        const short = context.speakerCorrectionTiming(rate, 'short');
        const long = context.speakerCorrectionTiming(rate, 'long');
        assert.equal(Math.round(short.latencySamples), shortDelay, `${rate} short delay`);
        assert.equal(Math.round(long.latencySamples), longDelay, `${rate} long delay`);
        assert.ok(Math.abs(short.ops - shortOps) < 1e-9, `${rate} short ops ${short.ops}`);
        assert.ok(Math.abs(long.ops - longOps) < 1e-9, `${rate} long ops ${long.ops}`);
        assert.equal(context.speakerCorrectionLongPercent(rate), percent, `${rate} percent`);
    }

    // The odd block adds 80/D + 1 per sample and leaves the delay unchanged.
    const oddRows = [
        [44100, 805, 887, 10],
        [48000, 807, 897, 10],
        [88200, 496.5, 558, 10],
        [96000, 498.5, 549, 10],
        [176400, 336.75, 367.25, 10],
        [192000, 337.75, 362.75, 5]
    ];
    for (const [rate, shortOps, longOps, percent] of oddRows) {
        const short = context.speakerCorrectionTiming(rate, 'short', true);
        const long = context.speakerCorrectionTiming(rate, 'long', true);
        assert.ok(Math.abs(short.ops - shortOps) < 1e-9, `${rate} short+odd ops ${short.ops}`);
        assert.ok(Math.abs(long.ops - longOps) < 1e-9, `${rate} long+odd ops ${long.ops}`);
        assert.equal(short.latencySamples, context.speakerCorrectionTiming(rate, 'short').latencySamples);
        assert.equal(context.speakerCorrectionLongPercent(rate, true), percent, `${rate} odd percent`);
    }
});

// ---- Parameters -------------------------------------------------------------------

test('serialization drops empty UI keys and restores their defaults', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    assert.deepEqual(plugin.getSerializableParameters(), { en: true, dv: 0, md: 'Reduce', fl: 'Short' });

    plugin.setParameters({ ms: 'm1', mn: 'Desk', dv: -6.3, cn: 2, co: 1, cn3: 1, co3: 0x10000, dc: 5 });
    assert.equal(plugin.dv, -6.5);
    assert.equal(plugin.dvs, 'user');
    assert.equal(plugin.co3, 0, 'invalid mask');
    const saved = plugin.getSerializableParameters();
    assert.deepEqual(saved, {
        en: true, dv: -6.5, md: 'Reduce', ms: 'm1', mn: 'Desk', fl: 'Short', cn: 2, co: 1, cn3: 1, dvs: 'user', dc: 5
    });

    const copy = new Plugin();
    copy.setSerializedParameters(saved);
    assert.deepEqual(copy.getSerializableParameters(), saved);
    copy.setSerializedParameters({ en: true, dv: 0, md: 'Reduce', fl: 'Short' });
    assert.equal(copy.ms, '');
    assert.equal(copy.cn, 0);
    assert.equal(copy.co, 0);
    assert.equal(copy.cn3, 0, 'a preset without the key reads Auto');
    assert.equal(copy.co3, 0);
    copy.setSerializedParameters({ en: true, dv: 0, md: 'Reduce', fl: 'Short', cn3: 4, co3: 2 });
    assert.equal(copy.cn3, 4, 'a preset keeps the odd masks');
    assert.equal(copy.co3, 2);
    assert.equal(copy.dvs, '');
    assert.equal(copy.dc, 0);
    plugin.cleanup();
    copy.cleanup();
});

test('parameters are validated and the masks map to Auto, On and Off', () => {
    const { Plugin, context } = loadPlugin();
    const plugin = new Plugin();
    plugin.setParameters({ dv: 5, md: 'Other', fl: 'Medium', cn: 0x10000, co: -1, dvs: 'x', dc: -3 });
    assert.equal(plugin.dv, 0);
    assert.equal(plugin.md, 'Reduce');
    assert.equal(plugin.fl, 'Short');
    assert.equal(plugin.cn, 0);
    assert.equal(plugin.co, 0);
    assert.equal(plugin.dvs, '');
    assert.equal(plugin.dc, 0);
    plugin.setParameters({ dv: -30 });
    assert.equal(plugin.dv, -24);

    assert.equal(context.speakerCorrectionPosition(0, 0, 0), 'auto');
    assert.equal(context.speakerCorrectionPosition(1, 2, 0), 'on');
    assert.equal(context.speakerCorrectionPosition(1, 0, 2), 'off');
    assert.equal(context.speakerCorrectionPosition(1, 2, 2), 'off');
    plugin.cleanup();
});

// ---- Asset -----------------------------------------------------------------------

test('the asset carries the header, the step frame and the corrected channels only', () => {
    const { context } = loadPlugin();
    const model = createSpeakerModel();
    const build = (settings, channels = 2) => context.buildSpeakerCorrectionAsset(model,
        { fl: 'Short', cn: 0, co: 0, cn3: 0, co3: 0, ...settings }, channels, oddDecision);
    const short = build({});
    assert.equal(short.payload.byteLength, 79840);
    const header = new Uint32Array(short.payload, 0, 8);
    assert.deepEqual([...header], [0x31415445, 16, FRAMES, 0, 2, 0, 0, 0]);
    const data = floats(short.payload);
    const weights = model.channels[0].weights.short;
    assert.equal(data[0], weights[0]);
    assert.equal(data[1181], weights[1181]);
    assert.equal(data[1182], 0);
    assert.ok(data.slice(1183, FRAMES).every(value => value === 0), 'no odd block in the model');
    assert.ok(data.slice(FRAMES, FRAMES + 1182).every(value => value === 0), 'Auto channel the model left off');

    const forced = floats(build({ cn: 2 }).payload);
    assert.equal(forced[FRAMES], model.channels[1].weights.short[0]);
    const off = floats(build({ co: 1 }).payload);
    assert.ok(off.slice(0, 1182).every(value => value === 0));
    const mono = floats(build({ cn: 2 }, 1).payload);
    assert.ok(mono.slice(FRAMES, 2 * FRAMES).every(value => value === 0), 'channel outside the output');

    const long = floats(build({ fl: 'Long', cn: 3 }).payload);
    assert.equal(long[1182], 1);
    assert.equal(long[15 * FRAMES + 1182], 1);
    assert.ok(long.slice(0, 1182).every(value => value === 0), 'no Long fit on channel 0');
    assert.equal(long[FRAMES], model.channels[1].weights.long[0]);

    model.channels[0].weights.short[7] = 1000;
    const invalid = build({});
    assert.equal(invalid.payload, undefined);
    assert.deepEqual({ ...invalid.error }, { channel: 0, length: 'short', frame: 7, value: 1000 });
});

test('the asset carries odd frames only where the odd block plays', () => {
    const { context } = loadPlugin();
    const model = createSpeakerModel();
    withOdd(model.channels[0], { on: { short: true } });
    withOdd(model.channels[1]);
    const build = settings => context.buildSpeakerCorrectionAsset(model,
        { fl: 'Short', cn: 0, co: 0, cn3: 0, co3: 0, ...settings }, 2, oddDecision);
    const odd = model.channels[0].odd;

    const auto = floats(build({}).payload);
    assert.deepEqual([...auto.slice(ODD_WEIGHT, ODD_BOUND)], [...odd.weights], 'Auto and odd.on.short');
    assert.deepEqual([...auto.slice(ODD_BOUND, FRAMES)], [...odd.bounds]);
    assert.ok(auto.slice(FRAMES, 2 * FRAMES).every(value => value === 0), 'channel 1 not checked yet');

    const offEven = floats(build({ co: 1 }).payload);
    assert.ok(offEven.slice(0, 1182).every(value => value === 0), 'even switched off');
    assert.ok(offEven.slice(ODD_WEIGHT, FRAMES).every(value => value === 0), 'odd.on.alone is false');

    const alone = floats(build({ co: 1, cn3: 1 }).payload);
    assert.ok(alone.slice(0, 1182).every(value => value === 0));
    assert.deepEqual([...alone.slice(ODD_WEIGHT, ODD_BOUND)], [...odd.weights], 'odd alone, forced On');

    const oddOff = floats(build({ co3: 1 }).payload);
    assert.equal(oddOff[0], model.channels[0].weights.short[0]);
    assert.ok(oddOff.slice(ODD_WEIGHT, FRAMES).every(value => value === 0), 'odd switched off');

    odd.bounds[3] = 0;
    assert.deepEqual({ ...build({}).error }, { channel: 0, length: 'short', frame: ODD_BOUND + 3, value: 0 });
    odd.bounds[3] = 1;
    odd.weights[5] = -1000;
    assert.deepEqual({ ...build({}).error }, { channel: 0, length: 'short', frame: ODD_WEIGHT + 5, value: -1000 });
    assert.ok(build({ co3: 1 }).payload, 'odd values are not checked where the odd block does not play');
});

test('the odd decision follows Auto, On and Off with and without the even block', () => {
    const channel = withOdd({}, { on: { short: true }, reason: { alone: 'worseOverall' } });
    assert.deepEqual(oddDecision(channel, 'short', 'auto'), { plays: true, reason: null });
    assert.deepEqual(oddDecision(channel, 'long', 'auto'), { plays: false, reason: 'notChecked' });
    assert.deepEqual(oddDecision(channel, 'alone', 'auto'), { plays: false, reason: 'worseOverall' });
    for (const c of CONFIGURATIONS) {
        assert.deepEqual(oddDecision(channel, c, 'on'), { plays: true, reason: null });
        assert.deepEqual(oddDecision(channel, c, 'off'), { plays: false, reason: 'off' });
    }
    const fitFailed = withOdd({}, { fitReason: 'worseInCheck' });
    assert.deepEqual(oddDecision(fitFailed, 'short', 'auto'), { plays: false, reason: 'worseInCheck' });
    assert.deepEqual(oddDecision(fitFailed, 'alone', 'on'), { plays: true, reason: null });
    const noFit = withOdd({}, { fitReason: 'belowLimit' });
    assert.deepEqual(oddDecision(noFit, 'short', 'on'), { plays: false, reason: 'belowLimit' });
    assert.deepEqual(oddDecision({}, 'short', 'on'), { plays: false, reason: 'noFit' });

    // The plugin's per-channel decision: c is the Filter Length when the even block plays, else alone.
    const { context } = loadPlugin();
    const model = createSpeakerModel();
    withOdd(model.channels[0], { on: { alone: true } });
    const play = settings => context.speakerCorrectionPlay(model.channels[0], 'short',
        { cn: 0, co: 0, cn3: 0, co3: 0, ...settings }, 2, oddDecision);
    assert.deepEqual({ ...play({}), odd: { ...play({}).odd } },
        { even: true, c: 'short', odd: { plays: false, reason: 'notChecked' } });
    const evenOff = play({ co: 1 });
    assert.deepEqual({ ...evenOff, odd: { ...evenOff.odd } },
        { even: false, c: 'alone', odd: { plays: true, reason: null } });
});

// ---- Selection, lookup and staging --------------------------------------

test('a measurement saved after the effect asked for one is adopted and staged', async () => {
    const model = createSpeakerModel();
    const { Plugin, store, window } = loadPlugin({ records: [record('m1', model)] });
    // Opening Acoustic Measurement replaces the page, so the effect is rebuilt from its settings.
    const before = new Plugin();
    let request = null;
    let saved = null;
    window.openSpeakerDistortionMeasurement = value => {
        request = value;
        saved = before.getSerializableParameters();
    };
    before._openMeasurement({ view: 'speakerDistortionSetup' });
    assert.deepEqual(request, { view: 'speakerDistortionSetup' });
    assert.ok(saved.mr > 0);
    before.cleanup();
    const plugin = new Plugin();
    plugin.setSerializedParameters(saved);
    await plugin._refresh();
    await settle();
    assert.equal(plugin.ms, 'm1');
    assert.equal(plugin.mr, 0);
    assert.match(plugin.mn, /^Desk — /);
    assert.equal(plugin.fl, 'Short');
    assert.equal(plugin.channel, null);
    assert.equal(plugin._modelState, 'found');
    assert.ok(store.refreshCount >= 1);
    const asset = lastAsset(plugin);
    assert.equal(asset.op, 'set');
    assert.equal(asset.slot, 0);
    const { payload, ...descriptor } = asset.descriptor;
    assert.deepEqual(descriptor, {
        formatTag: 1,
        headBlock: 0,
        rateDivider: 1,
        pathCount: 0,
        inputCount: 0,
        processingChannels: 2,
        footprintBytes: 79840,
        externalAssetSignature: JSON.stringify(['m1', 1, null, 'Short', 0, 0, 0, 0])
    });
    assert.equal(payload.byteLength, 79840);
    assert.equal(plugin._state(), 'preparing');
    plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);
    assert.equal(plugin._state(), 'ready');
    plugin.cleanup();
});

test('only a measurement saved after the request is adopted, and surround models select all channels', async () => {
    const { Plugin, runtime, store } = loadPlugin({ records: [record('old', createSpeakerModel(), 1)] });
    const plugin = new Plugin();
    plugin.setParameters({ mr: 2 });
    await plugin._refresh();
    assert.equal(plugin.ms, '');
    store.measurements = [record('new', createSpeakerModel())];
    plugin.setParameters({ mr: 0 });
    await plugin._refresh();
    assert.equal(plugin.ms, '', 'nothing is adopted without a request');
    plugin._runtime = runtime;
    const selection = plugin._selectionParameters(record('m4', createSpeakerModel(4), 1));
    assert.equal(selection.channel, 'A');
    assert.equal(selection.fl, 'Short');
    assert.deepEqual([selection.cn, selection.co, selection.cn3, selection.co3], [0, 0, 0, 0], 'a new selection clears the masks');
    plugin.cleanup();
});

test('selecting or adopting odd-only surround correction selects all channels', async () => {
    const model = createSpeakerModel(1);
    const entry = model.channels[0];
    entry.index = 2;
    entry.weights = { short: null, long: null };
    entry.on = { short: false, long: false };
    withOdd(entry, { on: { alone: true } });
    const measurement = record('odd-surround', model, 5);
    const { Plugin, runtime } = loadPlugin({ channelCount: 4, records: [measurement] });
    const plugin = new Plugin();
    plugin._runtime = runtime;
    try {
        assert.equal(plugin._selectionParameters(measurement).channel, 'A');
        entry.odd.fitReason = 'littleGain';
        assert.equal(plugin._selectionParameters(measurement).channel, undefined,
            'an odd fit rejected by Auto does not require surround routing');
        entry.odd.fitReason = null;
        plugin.setParameters({ mr: 1 });
        await plugin._refresh();
        await settle();
        assert.equal(plugin.ms, measurement.id);
        assert.equal(plugin.channel, 'A');
        const asset = lastAsset(plugin).descriptor;
        assert.equal(asset.processingChannels, 4);
        assert.equal(floats(asset.payload)[2 * FRAMES + ODD_WEIGHT], entry.odd.weights[0]);
    } finally {
        plugin.cleanup();
    }
});

test('a missing measurement clears the asset and reports it', async () => {
    const { Plugin } = loadPlugin({ records: [] });
    const plugin = new Plugin();
    plugin.setParameters({ ms: 'gone', mn: 'Old desk' });
    await settle();
    assert.equal(plugin._state(), 'missing');
    assert.equal(lastAsset(plugin).op, 'clear');
    const info = plugin.externalAssetInfo;
    assert.equal(info.missing, true);
    assert.equal(info.pending, false);
    assert.deepEqual([...info.ids, ...info.names, info.kind], ['gone', 'Old desk', 'Measurement']);
    plugin.cleanup();
});

test('selecting None immediately clears the active asset and ignores a pending lookup', async () => {
    const { plugin, model } = await readyPlugin();
    let finishLookup;
    plugin._getMeasurementStore = () => finishLookup ? Promise.resolve({ measurements: [] })
        : new Promise(resolve => { finishLookup = resolve; });
    const pending = plugin._refresh();
    await settle();
    plugin.setParameters({ ms: '', mn: '', mr: 0 });
    assert.equal(lastAsset(plugin).op, 'clear');
    assert.equal(plugin._stagedBytes, null);
    assert.equal(plugin._stagedSignature, null);
    assert.equal(plugin._assetState, 0);
    finishLookup({ measurements: [record('m1', model)] });
    await pending;
    assert.equal(lastAsset(plugin).op, 'clear');
    assert.equal(plugin._model, null);
    plugin.cleanup();
});

test('routing preserves the physical bank and sends its selected span for live and offline processing', async () => {
    const model = createSpeakerModel(4);
    for (const entry of model.channels) entry.on.short = true;
    withOdd(model.channels[1], { on: { short: true } });
    const { plugin } = await readyPlugin(model, { channelCount: 4, ui: false });
    const initialOperations = plugin.assetOperations.length;
    const routes = [[null, [0, 1]], ['A', [0, 1, 2, 3]], ['R', [1]], ['34', [2, 3]], ['4', [3]]];
    for (const [channel, physical] of routes) {
        plugin.setParameters({ channel });
        const descriptor = lastAsset(plugin).descriptor;
        assert.equal(descriptor.processingChannels, 4);
        const data = floats(descriptor.payload);
        for (const entry of model.channels) {
            assert.equal(data[entry.index * FRAMES], entry.weights.short[0], `${channel}: physical ${entry.index}`);
        }
        assert.ok(data.subarray(4 * FRAMES).every(value => value === 0));
        assert.equal(plugin.getParameters()._scf, physical[0]);
        assert.equal(plugin.getParameters()._scc, physical.length);
        assert.equal(plugin.assetOperations.length, initialOperations, 'routing never queues a replacement bank');
        assert.equal(plugin.getSerializableParameters()._scf, undefined);
        assert.equal(plugin.getSerializableParameters()._scc, undefined);
        const infos = plugin._channelInfos();
        assert.deepEqual(infos.filter(info => info.playing).map(info => info.entry.index), physical);
        const offline = await plugin.createOfflineDspState({ outputChannelCount: 4 });
        assert.equal(offline.assets.get(0).processingChannels, 4);
        assert.equal(offline.parameters._scf, physical[0]);
        assert.equal(offline.parameters._scc, physical.length);
        assert.deepEqual(new Uint8Array(offline.assets.get(0).payload), new Uint8Array(descriptor.payload));
        assert.equal(data[FRAMES + ODD_WEIGHT], model.channels[1].odd.weights[0]);
    }
    const requirement = await plugin.resolveOfflineDspAssetRequirement({ outputChannelCount: 4 });
    plugin.setParameters({ channel: 'R' });
    await assert.rejects(plugin.createOfflineDspState({ outputChannelCount: 4, offlineDspAssetRequirement: requirement }),
        error => error.userMessageKey === 'speakerDistortionCorrection.error.offline');
    plugin.cleanup();
});

test('direct routing publishes the physical span together and measurement replacement still clears the bank', async () => {
    const { plugin, panel, window, model } = await readyPlugin();
    const source = await fs.readFile(path.join(repoRoot, 'plugins', 'plugin-base.js'), 'utf8');
    plugin.updateParameters = vm.runInNewContext(`${source}\nPluginBase.prototype.updateParameters;`, { window });
    plugin._lastUpdatedChannel = plugin.channel;
    plugin._notifyWasmAssetSnapshotChange = () => {};
    plugin.getWorkletPluginData = parameters => ({ channel: plugin.channel, parameters });
    window.uiManager.updateURL = () => {};
    const published = [];
    window.workletNode.port = { postMessage: message => published.push({ message, asset: lastAsset(plugin) }) };
    let finishLookup;
    try {
        const previousRevision = plugin._effectiveAssetRevision;
        const before = plugin.assetOperations.length;
        // The routing dialog assigns channel directly rather than calling setParameters.
        plugin.channel = 'R';
        plugin.updateParameters();
        assert.equal(plugin.assetOperations.length, before);
        assert.equal(published.at(-1).message.plugin.channel, 'R');
        const right = published.at(-1).asset.descriptor;
        assert.equal(right.processingChannels, 2);
        assert.equal(published.at(-1).message.plugin.parameters._scf, 1);
        assert.equal(published.at(-1).message.plugin.parameters._scc, 1);
        assert.equal(plugin._effectiveAssetRevision, previousRevision);
        assert.equal(panel.querySelector('.room-eq-latency').textContent, '0 samples / 0.0 ms · active');

        plugin.channel = 'L';
        plugin.updateParameters();
        const left = published.at(-1).asset.descriptor;
        assert.equal(left.processingChannels, 2);
        assert.equal(floats(left.payload)[0], model.channels[0].weights.short[0]);
        plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);
        assert.equal(panel.querySelector('.room-eq-latency').textContent, '30 samples / 0.6 ms · active');
        const staged = plugin.assetOperations.length;
        plugin.updateParameters();
        assert.equal(plugin.assetOperations.length, staged, 'unchanged routing does not restage');

        const next = record('next-speakers', createSpeakerModel(3), 2);
        const lookup = new Promise(resolve => { finishLookup = resolve; });
        plugin._getMeasurementStore = () => lookup;
        plugin.setParameters(plugin._selectionParameters(next));
        assert.equal(published.at(-1).message.plugin.channel, 'A');
        assert.equal(published.at(-1).asset.op, 'clear', 'clear the previous speakers before publishing the new route');
        assert.deepEqual(plugin.assetOperations.slice(staged).map(operation => operation.op), ['clear']);
        assert.equal(plugin._stagedBytes, null);
        assert.equal(plugin._stagedSignature, null);
        assert.equal(plugin._effectiveAssetRevision, null);
        assert.equal(plugin._state(), 'preparing');
        await settle();
        assert.equal(lastAsset(plugin).op, 'clear', 'the old correction stays cleared during the asynchronous lookup');
        finishLookup({ measurements: [next] });
        await settle();
        assert.equal(plugin._model, next.speakerModel);
        assert.equal(lastAsset(plugin).op, 'set');
    } finally {
        finishLookup?.({ measurements: [] });
        plugin.cleanup();
    }
});

test('real asset delivery keeps physical speaker banks stable across routes while an acknowledgement is pending', async () => {
    const model = createSpeakerModel(4);
    for (const entry of model.channels) entry.on.short = true;
    const { Plugin, window, runtime } = loadPlugin({
        realBase: true, channelCount: 4, records: [record('m1', model, 1)]
    });
    const messages = [];
    window.workletNode.port = { postMessage: message => messages.push(message) };
    const plugin = new Plugin();
    plugin.id = 17;
    plugin._runtime = runtime;
    const delivery = () => plugin._wasmAssetDeliveries.get(window.workletNode)?.get(0);
    const acknowledge = () => {
        const request = delivery().inflight;
        assert.equal(plugin.acknowledgeWasmAssetOperation(window.workletNode, 0, request.operationRevision), true);
        plugin.onWasmAssetState(0, request.type === 'set' ? 3 : 0, request.operationRevision);
    };
    try {
        plugin.setParameters({ ms: 'm1' });
        await settle();
        acknowledge(); // Initial clear releases the first bank.
        acknowledge();
        plugin.setParameters({ fl: 'Long' });
        const inflight = delivery().inflight;
        plugin.setParameters({ fl: 'Short' });
        const queued = delivery().queued;
        assert.ok(queued && queued !== inflight, 'the production queue holds the replacement behind the acknowledgement');
        const postedAssets = messages.filter(message => message.type === 'setPluginAsset').length;
        for (const [channel, first, count] of [[null, 0, 2], ['R', 1, 1], ['L', 0, 1], ['34', 2, 2], ['R', 1, 1]]) {
            plugin.channel = channel;
            plugin.updateParameters();
            const update = messages.at(-1);
            assert.equal(update.type, 'updatePlugin');
            assert.equal(update.plugin.channel, channel);
            assert.equal(update.plugin.parameters._scf, first);
            assert.equal(update.plugin.parameters._scc, count);
            assert.equal(delivery().inflight, inflight);
            assert.equal(delivery().queued, queued, 'routing does not overwrite the queued filter change');
        }
        assert.equal(messages.filter(message => message.type === 'setPluginAsset').length, postedAssets);
        acknowledge();
        const replacement = messages.at(-1);
        assert.equal(replacement.type, 'setPluginAsset');
        for (const entry of model.channels) {
            assert.equal(floats(replacement.payload)[entry.index * FRAMES], entry.weights.short[0]);
        }
        acknowledge();
        assert.equal(delivery(), undefined);
    } finally {
        plugin.cleanup();
    }
});

for (const artifact of ['effetune-dsp.wasm', 'effetune-dsp.simd.wasm']) {
    test(`staged routes report their latency through the ABI before processing (${artifact})`, async () => {
        const { plugin } = await readyPlugin(createSpeakerModel(), { ui: false });
        const binding = await instantiateDsp(await fs.readFile(new URL(`../../plugins/dsp/${artifact}`, import.meta.url)));
        let id;
        try {
            assert.ok(binding.createEngine());
            assert.equal(binding.prepare(48000, 2, 128, 256 * 1024), 0);
            id = binding.createInstance('SpeakerDistortionCorrectionPlugin');
            const packer = DSP_PARAM_PACKERS.get('SpeakerDistortionCorrectionPlugin');
            const stageRoute = channel => {
                plugin.setParameters({ channel });
                assert.equal(binding.instanceSetParams(id, packer.pack(plugin.getParameters()), packer.hash), 0);
            };
            const process = () => {
                const audio = binding.getArenaViews();
                audio.scratch.allChannels.fill(0.125);
                assert.equal(binding.instanceProcess(id, binding.pointerForArenaView(audio.scratch.allChannels),
                    1, 128, 0), 0);
                return audio.scratch.allChannels.subarray(0, 128);
            };
            const descriptor = lastAsset(plugin).descriptor;
            stageRoute('R');
            assert.equal(binding.instanceSetAsset(id, 0, new Uint8Array(descriptor.payload), descriptor), 0);
            assert.equal(binding.instanceLatency(id), 0, 'pending bank respects the pending uncorrected route');
            assert.ok(process().every(value => value === 0.125));

            stageRoute('L');
            assert.equal(binding.instanceLatency(id), 30, 'zero-to-nonzero is visible before any process call');
            process();
            stageRoute('R');
            assert.equal(binding.instanceLatency(id), 0, 'nonzero-to-zero is visible before any process call');
            assert.ok(process().every(value => value === 0.125));

            // A replacement bank's length and the latest staged route both affect the next block.
            const longPayload = descriptor.payload.slice(0);
            const data = floats(longPayload);
            for (let channel = 0; channel < 16; channel++) data[channel * FRAMES + 1182] = 1;
            assert.equal(binding.instanceSetAsset(id, 0, new Uint8Array(longPayload), descriptor), 0);
            stageRoute('L');
            assert.equal(binding.instanceLatency(id), 120);
            stageRoute('R');
            assert.equal(binding.instanceLatency(id), 0);
            stageRoute('L');
            assert.equal(binding.instanceLatency(id), 120);
            binding.instanceAssetAbort(id, 0);
            assert.equal(binding.instanceLatency(id), 0, 'clearing overrides a staged corrected route');
        } finally {
            if (id) binding.destroyInstance(id);
            binding.close();
            plugin.cleanup();
        }
    });

    test(`routed assets process the matching speaker and preserve bypass latency (${artifact})`, async () => {
        const model = createSpeakerModel(4);
        for (const entry of model.channels) {
            entry.on.short = true;
            entry.weights.short.fill(0);
            entry.weights.short[0] = (entry.index + 1) * 0.1;
        }
        const { plugin } = await readyPlugin(model, { channelCount: 4, ui: false });
        const binding = await instantiateDsp(await fs.readFile(new URL(`../../plugins/dsp/${artifact}`, import.meta.url)));
        const frames = 128, channels = 4;
        try {
            assert.ok(binding.createEngine());
            assert.equal(binding.prepare(48000, channels, frames, 256 * 1024), 0);
            const render = channel => {
                plugin.setParameters({ channel });
                const descriptor = lastAsset(plugin).descriptor;
                const id = binding.createInstance('SpeakerDistortionCorrectionPlugin');
                try {
                    const packer = DSP_PARAM_PACKERS.get('SpeakerDistortionCorrectionPlugin');
                    assert.equal(binding.instanceSetParams(id, packer.pack(plugin.getParameters()), packer.hash), 0);
                    assert.equal(binding.instanceSetAsset(id, 0, new Uint8Array(descriptor.payload), descriptor), 0);
                    // Activate at a block boundary before the pipeline sizes its compensation delays.
                    const audio = binding.getArenaViews();
                    audio.scratch.allChannels.fill(0);
                    assert.equal(binding.instanceProcess(id, binding.pointerForArenaView(audio.scratch.allChannels),
                        descriptor.processingChannels, frames, 0), 0);
                    const latency = binding.instanceLatency(id);
                    assert.equal(binding.pipelineConfigure(buildDspPipelineDescriptor([
                        { enabled: true, inputBus: 0, outputBus: 0, channel }
                    ], { getInstanceId: () => id })), 0);
                    const output = Array.from({ length: channels }, () => []);
                    for (let block = 0; block < 5; block++) {
                        for (let c = 0; c < channels; c++) for (let f = 0; f < frames; f++) {
                            audio.combined[c * frames + f] = 0.1 * Math.sin((block * frames + f) * (c + 1) / 30) + 0.02;
                        }
                        assert.equal(binding.pipelineProcess(channels, frames, block * frames / 48000), 0);
                        for (let c = 0; c < channels; c++) output[c].push(...audio.combined.subarray(c * frames, (c + 1) * frames));
                    }
                    binding.instanceAssetAbort(id, 0);
                    assert.equal(binding.instanceLatency(id), 0, 'clearing the asset removes its delay');
                    audio.scratch.allChannels.fill(0.125);
                    assert.equal(binding.instanceProcess(id, binding.pointerForArenaView(audio.scratch.allChannels),
                        descriptor.processingChannels, frames, 0), 0);
                    assert.ok(audio.scratch.allChannels.subarray(0, descriptor.processingChannels * frames)
                        .every(value => value === 0.125), 'cleared asset passes through');
                    return { output, latency };
                } finally {
                    binding.destroyInstance(id);
                }
            };
            const all = render('A');
            assert.equal(all.latency, 30);
            for (const [channel, selected] of [[null, [0, 1]], ['R', [1]], ['34', [2, 3]]]) {
                const actual = render(channel);
                assert.equal(actual.latency, 30);
                for (const c of selected) assert.deepEqual(actual.output[c], all.output[c], `${channel}: speaker ${c}`);
            }
            // A measured speaker outside the route must not activate the kernel's global delay.
            model.channels = [model.channels[0]];
            plugin._applyModel(model);
            const unmeasured = render('R');
            assert.equal(unmeasured.latency, 0);
            assert.ok(unmeasured.output[1].every((value, f) =>
                value === Math.fround(0.1 * Math.sin(f * 2 / 30) + 0.02)), 'unmeasured route passes through');
        } finally {
            plugin.cleanup();
            binding.close();
        }
    });
}

test('re-staging follows fl, cn, co, the channel count and the revision, never dv or md', async () => {
    const { plugin, model, panel } = await readyPlugin();
    const sets = () => plugin.assetOperations.filter(item => item.op === 'set').length;
    const initial = sets();
    plugin.setParameters({ dv: -6 });
    plugin.setParameters({ md: 'Add' });
    plugin.setParameters({ dvs: 'user', dc: 3 });
    plugin.setParameters({ md: 'Reduce' });
    assert.equal(sets(), initial);

    plugin.setParameters({ cn: 2 });
    assert.equal(sets(), initial + 1);
    plugin.setParameters({ co: 2 });
    assert.equal(sets(), initial + 2);
    plugin.setParameters({ co: 0, cn: 0 });
    assert.equal(sets(), initial + 2, 'identical bytes are not staged again');
    plugin.setParameters({ fl: 'Long' });
    assert.equal(sets(), initial + 3);
    plugin.setParameters({ fl: 'Short' });

    const before = sets();
    plugin.getParameters({ sampleRate: 48000, outputChannelCount: 1, commitSampleRate: true });
    await settle();
    assert.equal(sets(), before + 1);
    assert.equal(lastAsset(plugin).descriptor.processingChannels, 1);
    plugin.getParameters({ sampleRate: 48000, outputChannelCount: 2, commitSampleRate: true });
    await settle();

    // Same revision, identical bytes: nothing staged, no updated flag.
    const quiet = sets();
    await plugin._refresh();
    assert.equal(sets(), quiet);
    assert.equal(plugin._updated, false);

    // New revision with different bytes: staged and flagged.
    model.revision = 2;
    model.channels[0].weights.short[0] += 1e-3;
    await plugin._refresh();
    assert.equal(sets(), quiet + 1);
    assert.equal(plugin._updated, true);
    plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);
    assert.match(panel.querySelector('.room-eq-status').textContent, /^Updated from the measurement\.$/);
    plugin.setParameters({ dv: -1 });
    assert.equal(plugin._updated, false);
    plugin.cleanup();
});

test('a newer Check again result sets the volume once and without an undo step', async () => {
    const { plugin, model, history } = await readyPlugin();
    const sets = () => plugin.assetOperations.filter(item => item.op === 'set').length;
    const initial = sets();

    model.lastCheck = { at: 1000, outcome: 'lower', dv: -4.5 };
    await plugin._refresh();
    assert.equal(plugin.dv, -4.5);
    assert.equal(plugin.dvs, 'check');
    assert.equal(plugin.dc, 1000);
    assert.equal(history.suppressed, 1);
    assert.equal(sets(), initial, 'identical bytes are not staged again');
    assert.equal(plugin._updated, false);

    plugin.setParameters({ dv: -2 });
    assert.equal(plugin.dvs, 'user');
    await plugin._refresh();
    assert.equal(plugin.dv, -2, 'an applied result is not applied again');

    model.lastCheck = { at: 2000, outcome: 'undetermined', dv: -9 };
    model.channels[0].on.short = false;
    await plugin._refresh();
    assert.equal(plugin.dv, -2);
    assert.equal(plugin.dvs, 'user');
    assert.equal(plugin.dc, 2000);
    assert.equal(sets(), initial + 1, 'a changed decision re-stages');
    assert.equal(plugin._updated, false);
    plugin.cleanup();
});

// ---- Figures and texts --------------------------------------------------------

test('the record set follows the dv boundaries', async () => {
    const { plugin } = await readyPlugin();
    for (const [dv, set] of [[0, 'L'], [-2.5, 'L'], [-3, 'L-6'], [-8.5, 'L-6'], [-9, 'L-12'], [-15.5, 'L-12']]) {
        plugin.setParameters({ dv });
        assert.equal(plugin._recordSet(), set, `dv ${dv}`);
    }
    plugin.cleanup();
});

test('figures are measured only for the checked volume in Reduce, and increases read as worse', async () => {
    const { plugin, panel } = await readyPlugin();
    const firstRow = () => panel.querySelector('tbody').children[0];
    const tag = () => firstRow().querySelector('.sdc-tag')?.textContent;

    assert.equal(tag(), 'measured');
    assert.match(firstRow().children[2].textContent, /^−46\.6 dB → −52\.1 dB\(0\.47 % → 0\.25 %\)/);
    assert.equal(plugin._evenChange(plugin._channelInfos()[0]), -2.5);

    plugin.setParameters({ dv: -1 });
    assert.equal(tag(), 'predicted');
    assert.equal(plugin._evenChange(plugin._channelInfos()[0]), -3);
    plugin.setParameters({ dv: 0, md: 'Add' });
    assert.equal(tag(), 'predicted');
    assert.equal(firstRow().children[5].textContent, '—');
    plugin.setParameters({ md: 'Reduce' });
    plugin._model.lastCheck = { at: 1, outcome: 'louder', dv: 0 };
    assert.equal(plugin._isMeasured(plugin._channelInfos()[0]), false);
    plugin._model.lastCheck = null;

    assert.equal(plugin._changeNode(0.5).className, 'worse');
    assert.equal(plugin._changeNode(0.05).className, '');
    assert.equal(plugin._changeNode(null).textContent, 'too small to measure');
    plugin.setParameters({ md: 'Add' });
    assert.equal(plugin._changeNode(0.5).className, '');
    plugin.cleanup();
});

test('the facts list the measurement and the check', async () => {
    const { plugin, panel } = await readyPlugin();
    const facts = () => panel.querySelector('.sdc-facts').children.map(line => line.textContent);
    const lines = facts();
    assert.match(lines[0], /^Measured .+ · Signal Level −20\.0 dBFS · Upper Limit 8000 Hz · Checked with the measurement$/);
    assert.equal(lines.length, 1);
    plugin._model.lastCheck = { at: 5, outcome: 'same', dv: 0 };
    plugin.setParameters({ fl: 'Long' });
    assert.match(facts()[0], / · Not checked since the Upper Limit changed$/);
    plugin.cleanup();
});

test('channel rows show each state, keep the reason as a tooltip and disable On and Off when nothing can be corrected', async () => {
    const { plugin, panel } = await readyPlugin();
    const left = () => channelRow(panel, 'Left Even-order');
    const right = () => channelRow(panel, 'Right Even-order');
    assert.equal(left().state().textContent, 'Corrected · −2.5 dB');
    assert.equal(right().state().textContent, 'Off');
    assert.equal(right().state().title, 'The correction check measured more distortion between 100 and 400 Hz.');
    const worst = { set: 'L', class: 'even8k' };
    const entry = { reason: { short: 'worseInCheck' }, worst: { short: worst } };
    assert.equal(plugin._reasonText(entry, 'short'), 'The correction check measured more distortion between 50 Hz and 8 kHz.');
    worst.class = 'total';
    assert.equal(plugin._reasonText(entry, 'short'), 'The correction check measured more overall distortion.');
    entry.reason.short = 'worseForSingleTones';
    worst.class = 'even8k';
    assert.equal(plugin._reasonText(entry, 'short'), 'The correction would add distortion to single tones above 2 kHz.');

    right().option('on').click();
    assert.equal(plugin.cn, 2);
    assert.equal(plugin._graphChannel, 1);
    assert.match(right().state().textContent, /^On \(by you\) · /);

    left().option('off').click();
    assert.equal(plugin.co, 1);
    assert.equal(left().state().textContent, 'Off (by you)');

    plugin.setParameters({ fl: 'Long', cn: 0, co: 0 });
    assert.equal(left().option('on').disabled, true);
    assert.equal(left().option('off').disabled, true);
    assert.equal(left().option('auto').checked, true);
    assert.equal(left().state().textContent, 'Off');
    plugin.cleanup();
});

test('routed channels missing from the measurement are listed as not measured', async () => {
    const { plugin, panel } = await readyPlugin(createSpeakerModel(), { channelCount: 4 });
    const labels = () => plugin._ui.channels.querySelectorAll('.radio-group').map(row => row.dataset.label);
    const states = () => ['Left', 'Right', 'Ch 3', 'Ch 4']
        .map(label => channelRow(panel, `${label} Even-order`).state().textContent);
    const tableRows = () => panel.querySelector('tbody').children
        .map(row => row.children.map(cell => cell.textContent));
    plugin.setParameters({ channel: 'A' });
    assert.deepEqual(labels(), ['Left', 'Right', 'Ch 3', 'Ch 4'].flatMap(label => [`${label} Even-order`, `${label} Odd-order`]));
    assert.deepEqual(states().slice(2), ['Not measured', 'Not measured']);
    const third = channelRow(panel, 'Ch 3 Even-order');
    assert.equal(third.state().title, 'This channel is not in the selected measurement.');
    assert.equal(third.option('auto').checked, true);
    assert.equal(third.option('on').disabled, true);
    assert.equal(third.option('off').disabled, true);
    assert.equal(channelRow(panel, 'Ch 4 Odd-order').option('on').disabled, true);
    assert.equal(channelRow(panel, 'Ch 4 Odd-order').state().textContent, '');
    const { cn, co, _graphChannel: graphChannel } = plugin;
    third.option('auto').click();
    assert.deepEqual([plugin.cn, plugin.co, plugin._graphChannel], [cn, co, graphChannel]);
    assert.deepEqual(tableRows().map(row => row.slice(0, 2)), [
        ['Left', 'Corrected'], ['Right', 'Off'], ['Ch 3', 'Not measured'], ['Ch 4', 'Not measured']
    ]);
    assert.deepEqual(tableRows()[2].slice(2), ['—', '—', '—', '—']);
    assert.deepEqual(plugin._ui.channelSelect.options.map(option => option.textContent), ['Left', 'Right']);

    plugin.setParameters({ channel: '34' });
    assert.deepEqual(states(), ['Not used', 'Not used', 'Not measured', 'Not measured']);
    plugin.cleanup();
});

test('odd-order rows, the status line and Check again count a playing odd block as corrected', async () => {
    const model = createSpeakerModel();
    withOdd(model.channels[0], { on: { short: true }, checkFig: { short: oddCheck(-3.2, -2.9) } });
    withOdd(model.channels[1], { on: { alone: true }, checkFig: { alone: oddCheck(-2.4, 0.1) } });
    const { plugin, panel } = await readyPlugin(model);
    const names = ['Left', 'Right'];
    const oddRow = index => channelRow(panel, `${names[index]} Odd-order`);
    const oddText = index => oddRow(index).state().textContent;
    const status = () => panel.querySelector('.room-eq-status').textContent;
    const activate = () => plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);
    // Plain copy: the plugin's arrays come from the vm realm.
    const checkAgain = () => JSON.parse(JSON.stringify(plugin._checkAgainChannels()));

    // Left: even and odd play; {change} is the measured pass of both against plain.
    assert.match(channelRow(panel, 'Left Even-order').state().textContent, /^Corrected · −2\.9 dB$/);
    assert.equal(oddText(0), 'Corrected · −3.2 dB');
    // Right: the even block stays off, the odd block plays alone.
    assert.equal(oddText(1), 'Corrected · −2.4 dB');
    assert.equal(status(), 'Correcting Left and Right.');
    assert.deepEqual(checkAgain(), { channels: [0, 1], oddChannels: [0, 1], configurations: ['short', 'alone'] });
    assert.equal(panel.querySelector('.sdc-check-again').disabled, false);

    oddRow(1).option('off').click();
    assert.equal(plugin.co3, 2);
    activate();
    assert.equal(oddText(1), 'Off (by you)');
    assert.equal(status(), 'Correcting Left.');

    // Even forced on: the odd block of Right is now measured with Short, which no check has done yet.
    plugin.setParameters({ cn: 2, co3: 0 });
    activate();
    assert.equal(oddText(1), 'Off (not checked)');
    assert.deepEqual(checkAgain(), { channels: [0, 1], oddChannels: [0, 1], configurations: ['short', 'short'] });
    oddRow(1).option('on').click();
    assert.deepEqual([plugin.cn3, plugin.co3], [2, 0]);
    activate();
    assert.equal(oddText(1), 'On (by you)');
    assert.equal(status(),
        'Correcting Left and Right (Right turned on by you) (Right odd-order turned on by you).');

    // Reasons without a playing odd block.
    plugin.setParameters({ cn: 0, cn3: 0 });
    const right = () => plugin._oddState(plugin._channelInfos()[1]).title;
    const odd = plugin._model.channels[1].odd;
    odd.on.alone = false;
    odd.reason.alone = 'worseWhenLoud';
    assert.equal(right(), 'The correction check measured more distortion at high volume.');
    odd.reason.alone = 'worseOverall';
    assert.equal(right(), 'Total distortion would not be lower.');
    odd.fitReason = 'worseAtLowerVolume';
    assert.equal(right(), 'Expected to raise odd-order distortion at lower volume.');
    odd.fitReason = 'worseForSingleTones';
    assert.equal(right(), 'Expected to raise odd-order distortion for single tones.');
    withOdd(plugin._model.channels[1], { fitReason: 'belowLimit' });
    assert.equal(right(), 'Odd-order distortion was too small to measure.');
    plugin._render();
    assert.equal(oddRow(1).option('on').disabled, true);
    plugin.cleanup();
});

test('the status line lists the prefixes in order and names forced channels', async () => {
    const { plugin, panel } = await readyPlugin();
    const status = () => panel.querySelector('.room-eq-status').textContent;
    const warning = () => panel.querySelector('.room-eq-status').dataset.state === 'warning';
    const latency = () => panel.querySelector('.room-eq-latency').textContent;
    assert.equal(status(), 'Correcting Left.');
    assert.equal(latency(), '30 samples / 0.6 ms · active');
    assert.equal(warning(), false);

    plugin.setParameters({ cn: 2 });
    plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);
    assert.equal(status(), 'Correcting Left and Right (Right turned on by you).');
    plugin.setParameters({ md: 'Add' });
    assert.equal(status(),
        'Adding distortion on Left and Right (Mode: Add) (Right turned on by you).');
    assert.equal(warning(), true, 'Add mode shows the status line as a warning');
    plugin.setParameters({ md: 'Reduce', cn: 0 });
    plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);

    plugin._updated = true;
    plugin.onPipelinePositionChanged({ followedByAudioEffect: true });
    plugin.handleOverloadTelemetry({ frameType: 1, formatVersion: 1, payload: new DataView(new Float32Array([1.5]).buffer) });
    // One message by priority: Overload, then the pipeline position, then the update notice.
    assert.equal(status(), 'Overload: lower the level before this effect.');
    plugin._overloaded = false;
    plugin._renderStatus();
    assert.equal(status(), 'Not the last effect: the correction may be wrong.');
    plugin.onPipelinePositionChanged({ followedByAudioEffect: false });
    assert.equal(status(), 'Updated from the measurement.');
    plugin._updated = false;

    plugin.setParameters({ co: 1 });
    plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);
    assert.equal(status(), 'No channel is corrected.');
    assert.equal(latency(), '0 samples / 0.0 ms · active');
    plugin.setParameters({ co: 3 });
    plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);
    assert.equal(status(), 'All channels are turned off in this effect.');
    plugin.setParameters({ co: 0, fl: 'Long' });
    plugin.onWasmAssetState(0, 3, plugin._candidateAssetRevision);
    assert.equal(status(), 'No channel is corrected with the Long filter.');
    plugin.cleanup();
});

test('the Empty state offers the measurement and an unsupported rate shows in the status line', async () => {
    const empty = loadPlugin();
    const emptyPlugin = new empty.Plugin();
    const emptyPanel = emptyPlugin.createUI();
    await settle();
    assert.equal(emptyPanel.querySelector('.room-eq-status').textContent, 'Select a measurement to begin.');
    assert.match(emptyPanel.querySelector('.sdc-facts').textContent, /^No distortion measurement yet\./);
    emptyPlugin.cleanup();

    const { plugin, panel } = await readyPlugin(createSpeakerModel(), { sampleRate: 32000 });
    assert.equal(panel.querySelector('.room-eq-status').textContent, 'Off: needs a sample rate of 44.1 kHz or higher.');
    assert.equal(panel.querySelector('.room-eq-status').dataset.state, 'warning');
    assert.equal(panel.querySelector('.room-eq-latency').textContent, '0 samples / 0.0 ms · active');
    assert.equal(panel.querySelector('.sdc-body').hidden, true);
    plugin.cleanup();
});

test('an overload is held for five seconds after the last frame', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        const { plugin, panel } = await readyPlugin();
        const status = () => panel.querySelector('.room-eq-status').textContent;
        const frame = peak => ({ frameType: 1, formatVersion: 1, payload: new DataView(new Float32Array([peak]).buffer) });
        plugin.handleOverloadTelemetry(frame(0.9));
        assert.equal(plugin._overloaded, false);
        plugin.handleOverloadTelemetry(frame(1.2));
        assert.match(status(), /^Overload/);
        mock.timers.tick(4000);
        plugin.handleOverloadTelemetry(frame(1.1));
        mock.timers.tick(4000);
        assert.match(status(), /^Overload/);
        mock.timers.tick(1000);
        assert.equal(status(), 'Correcting Left.');
        plugin.cleanup();
    } finally {
        mock.timers.reset();
    }
});

// ---- Offline render ----------------------------------------------------------------

test('offline export builds the same asset and fails clearly without the measurement', async () => {
    const { plugin, store } = await readyPlugin(createSpeakerModel(), { ui: false });
    const requirement = await plugin.resolveOfflineDspAssetRequirement({ outputChannelCount: 2 });
    assert.equal(requirement.required, true);
    const state = await plugin.createOfflineDspState({ outputChannelCount: 2, offlineDspAssetRequirement: requirement });
    assert.equal(state.offlineDspAssetRequired, true);
    assert.equal(state.parameters.dv, 0);
    assert.equal(state.parameters.md, 'Reduce');
    const descriptor = state.assets.get(0);
    assert.equal(descriptor.processingChannels, 2);
    assert.deepEqual(new Uint8Array(descriptor.payload), new Uint8Array(plugin._stagedBytes));

    store.measurements = [];
    await assert.rejects(plugin.resolveOfflineDspAssetRequirement({ outputChannelCount: 2 }),
        error => error.userMessageKey === 'speakerDistortionCorrection.error.offline');
    plugin.setParameters({ ms: '' });
    assert.equal(plugin.externalAssetInfo, null);
    assert.equal(plugin.isOfflineDspAssetRequired(), false);
    plugin.cleanup();
});

// ---- Locales -------------------------------------------------------------------------

test('the export error message has an English locale entry', async () => {
    const text = await fs.readFile(path.join(repoRoot, 'js', 'locales', 'en.json5'), 'utf8');
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    assert.ok(text.includes(`"${plugin.offlineDspAssetErrorMessageKey}":`));
    plugin.cleanup();
});
