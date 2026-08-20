import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';

import * as designCore from '../../js/group-delay-peq/design-core.js';
import { createGroupDelayPeqDesigner } from '../../js/group-delay-peq/designer.js';
import { IR_ASSET_MAGIC, IR_ASSET_TOPOLOGY } from '../../js/ir-library/ir-asset-payload.js';
import {
    estimateIrKernelCommitFootprint,
    selectedIrChannelCount
} from '../../js/ir-library/ir-plugin-contract.js';
import { getPluginExecutionCapabilities } from '../../js/audio/plugin-execution-capabilities.js';

const pluginUrl = new URL('../../plugins/eq/group_delay_peq.js', import.meta.url);
const pluginSource = fs.readFileSync(pluginUrl, 'utf8');
const pluginCss = fs.readFileSync(
    new URL('../../plugins/eq/group_delay_peq.css', import.meta.url),
    'utf8'
);

/* ------------------------------------------------------------------ *
 * Minimal DOM, just rich enough for the graph and the band controls.
 * ------------------------------------------------------------------ */

function parseSelector(selector) {
    const classes = [];
    const attributes = [];
    for (const match of selector.matchAll(/\.([\w-]+)|\[([\w-]+)="([^"]*)"\]/g)) {
        if (match[1]) classes.push(match[1]);
        else attributes.push([match[2], match[3]]);
    }
    return { classes, attributes };
}

function elementClasses(element) {
    const names = new Set(element._classes);
    for (const name of String(element.className || '').split(/\s+/)) if (name) names.add(name);
    return names;
}

function matchesSelector(element, { classes, attributes }) {
    const names = elementClasses(element);
    if (!classes.every(name => names.has(name))) return false;
    return attributes.every(([name, value]) => {
        if (name.startsWith('data-')) {
            const key = name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
            return String(element.dataset?.[key]) === value;
        }
        return String(element.attributes?.[name]) === value;
    });
}

function createElementStub(tagName) {
    const element = {
        tagName,
        namespace: null,
        children: [],
        attributes: {},
        dataset: {},
        style: {},
        listeners: {},
        className: '',
        textContent: '',
        clientWidth: 0,
        clientHeight: 0,
        _classes: new Set(),
        classList: {
            add(name) { element._classes.add(name); },
            remove(name) { element._classes.delete(name); },
            contains(name) { return elementClasses(element).has(name); },
            toggle(name, force) {
                if (force) element._classes.add(name);
                else element._classes.delete(name);
            }
        },
        appendChild(child) { element.children.push(child); return child; },
        append(...nodes) { for (const node of nodes) element.children.push(node); },
        replaceChildren(...nodes) { element.children = nodes; },
        setAttribute(name, value) { element.attributes[name] = String(value); },
        getAttribute(name) { return element.attributes[name]; },
        addEventListener(type, handler) { (element.listeners[type] ||= []).push(handler); },
        removeEventListener() {},
        getBoundingClientRect() {
            return {
                left: 0,
                top: 0,
                width: element.clientWidth,
                height: element.clientHeight
            };
        },
        querySelector(selector) {
            const parsed = parseSelector(selector);
            const walk = node => {
                for (const child of node.children || []) {
                    if (child && typeof child === 'object' && child.tagName) {
                        if (matchesSelector(child, parsed)) return child;
                        const found = walk(child);
                        if (found) return found;
                    }
                }
                return null;
            };
            return walk(element);
        }
    };
    return element;
}

const documentStub = {
    createElement(tagName) { return createElementStub(tagName); },
    createElementNS(namespace, tagName) {
        const element = createElementStub(tagName);
        element.namespace = namespace;
        return element;
    },
    createTextNode(text) { return { nodeType: 3, textContent: String(text) }; },
    addEventListener() {},
    removeEventListener() {},
    body: { classList: { contains: () => false } }
};

function loadPlugin() {
    const calls = [];
    class PluginBase {
        constructor(name, description) {
            this.name = name;
            this.description = description;
            this.id = 'group-delay-peq-test';
            this.enabled = true;
            this.channel = null;
            this.powerGainUpperBoundDb = 0;
        }

        registerProcessor(processor) {
            this.processor = processor;
        }

        getParameters() {
            return { type: this.constructor.name, id: this.id, enabled: this.enabled };
        }

        getSerializableParameters() {
            const { type, id, ...rest } = this.getParameters();
            return rest;
        }

        _setValidatedParameters(parameters) {
            if (parameters.enabled !== undefined) this.enabled = Boolean(parameters.enabled);
            if (parameters.channel !== undefined) this.channel = parameters.channel;
        }

        parseFiniteNumber(value, minimum, maximum, fallback) {
            const number = Number(value);
            if (!Number.isFinite(number)) return fallback;
            return Math.max(minimum, Math.min(maximum, number));
        }

        updateParameters() {
            calls.push(['updateParameters']);
        }

        setWasmAsset(slot, descriptor) {
            calls.push(['setWasmAsset', slot, descriptor]);
            return 17;
        }

        clearWasmAsset(slot) {
            calls.push(['clearWasmAsset', slot]);
        }

        _isCurrentWasmAssetOperation(slot, revision) {
            return slot === 0 && revision === 17;
        }

        createSelectControl(label, options, value, setter) {
            const row = documentStub.createElement('div');
            row.className = 'parameter-row';
            const select = documentStub.createElement('select');
            select.className = 'plugin-select';
            for (const option of options) {
                const element = documentStub.createElement('option');
                element.value = option.value;
                element.textContent = option.label;
                select.appendChild(element);
            }
            select.value = value;
            select.addEventListener('change', () => setter(select.value));
            row.append(label, select);
            return row;
        }

        isHeldByUser() {
            return false;
        }

        layoutMarkerLabels() {}

        cleanup() {
            calls.push(['cleanup']);
        }
    }

    const context = {
        PluginBase,
        window: {},
        document: documentStub,
        console,
        Math,
        Number,
        Object,
        JSON,
        Array,
        Boolean,
        String,
        Error,
        ArrayBuffer,
        Float32Array,
        Float64Array,
        Map,
        Set,
        Promise,
        setTimeout,
        clearTimeout
    };
    vm.runInNewContext(
        `${pluginSource}\nthis.Plugin = GroupDelayPEQPlugin;`,
        context,
        { filename: pluginUrl.pathname }
    );
    return { Plugin: context.Plugin, calls };
}

function graphRuntime() {
    return {
        ...designCore,
        IR_ASSET_TOPOLOGY,
        selectedIrChannelCount,
        estimateIrKernelCommitFootprint
    };
}

/** Mount the UI without touching the real dynamic imports, then give it a size. */
function mountUI(plugin, { runtime = graphRuntime(), resolveRuntime = true } = {}) {
    plugin._scheduleDesign = () => {};
    plugin._runtimePromise = Promise.resolve().then(() => {
        if (resolveRuntime) plugin._runtime = runtime;
        return runtime;
    });
    if (resolveRuntime) plugin._runtime = null;
    const container = plugin.createUI();
    plugin.graphContainer.clientWidth = 1024;
    plugin.graphContainer.clientHeight = 480;
    plugin.responseSvg.clientWidth = 984;
    plugin.responseSvg.clientHeight = 440;
    return container;
}

function bandOf(plugin, index) {
    return plugin.uiContainer.querySelector(`.group-delay-peq-band[data-band="${index}"]`);
}

/* ------------------------------------------------------------------ *
 * Parameters
 * ------------------------------------------------------------------ */

test('Group Delay PEQ starts flat and validates every band value', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};

    assert.equal(plugin.name, 'Group Delay PEQ');
    assert.equal(plugin.tp, 16384);
    assert.equal(plugin.lt, '128');
    assert.equal(plugin.offlineDspAssetRequired, false);
    assert.deepEqual(
        Array.from({ length: 5 }, (_, index) => plugin['t' + index]),
        ['pk', 'pk', 'pk', 'pk', 'pk']
    );
    assert.deepEqual(
        Array.from({ length: 5 }, (_, index) => plugin['f' + index]),
        [100, 316, 1000, 3160, 10000]
    );
    assert.deepEqual(
        Array.from({ length: 5 }, (_, index) => plugin['d' + index]),
        [0, 0, 0, 0, 0]
    );
    assert.deepEqual(
        Array.from({ length: 5 }, (_, index) => plugin['q' + index]),
        [0.7, 0.7, 0.7, 0.7, 0.7]
    );
    assert.deepEqual(
        Array.from({ length: 5 }, (_, index) => plugin['e' + index]),
        [true, true, true, true, true]
    );

    assert.equal(plugin._delayLimitMs(), 149.3);
    plugin.setParameters({
        t0: 'fl', t1: 'unsupported',
        f0: 5, f1: 99999,
        d0: 500, d1: -500, d2: 3.5,
        q0: 1000, q1: 0,
        e3: false,
        tp: 12345, lt: '2048'
    });
    assert.equal(plugin.t0, 'fl');
    assert.equal(plugin.t1, 'pk');
    assert.equal(plugin.f0, 20);
    assert.equal(plugin.f1, 20000);
    assert.equal(plugin.d0, 149.3);
    assert.equal(plugin.d1, -149.3);
    assert.equal(plugin.d2, 3.5);
    assert.equal(plugin.q0, 100);
    assert.equal(plugin.q1, 0.1);
    assert.equal(plugin.e3, false);
    assert.equal(plugin.tp, 16384);
    assert.equal(plugin.lt, '128');
    assert.equal(plugin.offlineDspAssetRequired, true);

    for (const type of ['pk', 'ls', 'hs', 'fl']) {
        plugin.setParameters({ t2: type });
        assert.equal(plugin.t2, type);
    }
    plugin.setParameters({ t2: 'ap' });
    assert.equal(plugin.t2, 'fl');

    plugin.setParameters({ tp: 32768, lt: '512' });
    assert.equal(plugin.tp, 32768);
    assert.equal(plugin.lt, '512');
    assert.equal(plugin._delayLimitMs(), 298.6);
    plugin.cleanup();
});

test('Group Delay PEQ clamps only the delays when the tap count drops', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin.setParameters({ tp: 32768, d0: 200, t0: 'hs', q0: 12, d1: -1.5, t1: 'fl', q1: 0.5412 });
    assert.equal(plugin.d0, 200);

    plugin.setParameters({ tp: 4096 });
    assert.equal(plugin._delayLimitMs(), 37.3);
    assert.equal(plugin.d0, 37.3);
    assert.equal(plugin.d1, -1.5);
    // Type and Q are settings of the band, not of the tap budget.
    assert.equal(plugin.t0, 'hs');
    assert.equal(plugin.q0, 12);
    assert.equal(plugin.t1, 'fl');
    assert.equal(plugin.q1, 0.5412);
    plugin.cleanup();
});

test('Group Delay PEQ packs the bulk delay and keeps it out of presets', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin.setParameters({ tp: 8192, t4: 'ls', f4: 1234, d4: 2, q4: 3.5, e4: false });

    const parameters = plugin.getParameters();
    assert.equal(parameters.fd, 4096);
    assert.equal(parameters.lt, '128');
    assert.equal(parameters.tp, 8192);
    assert.equal(parameters.t4, 'ls');
    assert.equal(parameters.f4, 1234);
    assert.equal(parameters.d4, 2);
    assert.equal(parameters.q4, 3.5);
    assert.equal(parameters.e4, false);

    const serialized = plugin.getSerializableParameters();
    assert.equal(serialized.fd, undefined);
    assert.equal(serialized.t4, 'ls');

    const restored = new (loadPlugin().Plugin)();
    restored._scheduleDesign = () => {};
    restored.setParameters(serialized);
    for (let index = 0; index < 5; index += 1) {
        assert.equal(restored['t' + index], plugin['t' + index]);
        assert.equal(restored['f' + index], plugin['f' + index]);
        assert.equal(restored['d' + index], plugin['d' + index]);
        assert.equal(restored['q' + index], plugin['q' + index]);
        assert.equal(restored['e' + index], plugin['e' + index]);
    }
    assert.equal(restored.tp, 8192);
    restored.cleanup();
    plugin.cleanup();
});

/* ------------------------------------------------------------------ *
 * Type selector
 * ------------------------------------------------------------------ */

test('Group Delay PEQ offers the four delay shapes and never disables a control row', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const scheduled = [];
    plugin._scheduleDesign = delay => scheduled.push(delay);

    const band = plugin._createBandControls(0);
    const select = band.querySelector('.group-delay-peq-band-type');
    assert.ok(select);
    assert.deepEqual(
        select.children.map(option => option.value),
        ['pk', 'ls', 'hs', 'fl']
    );
    assert.deepEqual(
        select.children.map(option => option.textContent),
        ['Peak', 'LowShelv', 'HighShel', 'FilterGD']
    );
    for (const option of select.children) assert.ok(option.textContent.length <= 8);
    assert.equal(select.value, 'pk');

    plugin.uiCreated = true;
    plugin.uiContainer = { querySelector: () => band };
    const rowInputs = () => [
        band.querySelector('.group-delay-peq-freq-text'),
        band.querySelector('.group-delay-peq-delay-text'),
        band.querySelector('.group-delay-peq-q-text'),
        band.querySelector('.group-delay-peq-q-slider')
    ];
    for (const type of ['ls', 'hs', 'fl', 'pk']) {
        scheduled.length = 0;
        select.value = type;
        for (const handler of select.listeners.change) handler();
        assert.equal(plugin.t0, type);
        assert.deepEqual(scheduled, [150]);
        // No per-type row state: all three parameters stay live for every shape.
        for (const input of rowInputs()) assert.ok(!input.disabled);
    }
    assert.equal(typeof plugin._setSlopeControlsState, 'undefined');
    assert.doesNotMatch(pluginSource, /\.disabled\s*=/);
    plugin.cleanup();
});

test('Group Delay PEQ preserves held number input while synchronising the other controls', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    const band = plugin._createBandControls(0);
    plugin.uiCreated = true;
    plugin.uiContainer = {
        querySelector: selector => selector.includes('data-band="0"') ? band : null
    };
    const frequency = band.querySelector('.group-delay-peq-freq-text');
    const delay = band.querySelector('.group-delay-peq-delay-text');
    const q = band.querySelector('.group-delay-peq-q-text');
    const qSlider = band.querySelector('.group-delay-peq-q-slider');
    const held = new Set([frequency, delay, q]);
    plugin.isHeldByUser = element => held.has(element);

    frequency.value = '12';
    delay.value = '-';
    q.value = '1.';
    plugin.setParameters({ f0: 1000, d0: 2, q0: 3 });

    assert.equal(plugin.f0, 1000);
    assert.equal(plugin.d0, 2);
    assert.equal(plugin.q0, 3);
    assert.equal(frequency.value, '12');
    assert.equal(delay.value, '-');
    assert.equal(q.value, '1.');
    assert.equal(qSlider.getAttribute('aria-valuetext'), '3.00');

    for (const handler of q.listeners.input) handler();
    assert.equal(plugin.q0, 1);
    assert.equal(q.value, '1.');
    for (const handler of q.listeners.change) handler();
    assert.equal(q.value, '1.00');
    plugin.cleanup();
});

test('Group Delay PEQ gives Taps and Latency model keys for external UI updates', () => {
    assert.match(pluginSource,
        /String\(this\.tp\),\s*value => this\.setParameters\(\{ tp: Number\(value\) \}\),\s*'tp'/);
    assert.match(pluginSource,
        /this\.lt,\s*value => this\.setParameters\(\{ lt: value \}\),\s*'lt'/);
});

/* ------------------------------------------------------------------ *
 * Design, staging and offline rendering
 * ------------------------------------------------------------------ */

test('Group Delay PEQ stages a mono FIR through the shared asset contract', async () => {
    const { Plugin, calls } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin.setParameters({ t0: 'fl', d0: 5, q0: 0.7071 });
    const payload = new ArrayBuffer(32 + plugin.tp * Float32Array.BYTES_PER_ELEMENT);
    const result = { payload, rippleDb: 0.01, clamped: false, limitMs: 149.3 };
    plugin._lastDesign = result;
    plugin._designGeneration = 4;
    const footprintCalls = [];
    plugin._runtimePromise = Promise.resolve({
        IR_ASSET_TOPOLOGY,
        selectedIrChannelCount: () => 2,
        estimateIrKernelCommitFootprint: request => {
            footprintCalls.push(request);
            return 4 * 1024 * 1024;
        }
    });

    assert.equal(await plugin._stageDesign(result, 4), true);
    const stage = calls.find(call => call[0] === 'setWasmAsset');
    assert.ok(stage);
    assert.equal(stage[1], 0);
    assert.equal(stage[2].payload, payload);
    assert.equal(stage[2].formatTag, 1);
    assert.equal(stage[2].headBlock, 128);
    assert.equal(stage[2].rateDivider, 1);
    assert.equal(stage[2].pathCount, 0);
    assert.equal(stage[2].inputCount, 0);
    assert.equal(stage[2].processingChannels, 2);
    assert.equal(footprintCalls.length, 1);
    assert.equal(footprintCalls[0].topology, IR_ASSET_TOPOLOGY.mono);
    assert.equal(footprintCalls[0].assetChannels, 1);
    assert.equal(footprintCalls[0].frames, plugin.tp);
    assert.equal(footprintCalls[0].headBlock, 128);

    const signature = JSON.parse(stage[2].externalAssetSignature);
    assert.equal(signature[0], 1);
    assert.equal(signature[1].taps, 16384);
    assert.equal(signature[1].bands.length, 5);
    assert.equal(signature[1].bands[0].type, 'fl');
    assert.equal(signature[1].bands[0].delayMs, 5);
    assert.equal(signature[2], '128');
    assert.equal(plugin._candidateAssetRevision, 17);
    plugin.cleanup();
});

test('Group Delay PEQ releases the filter whenever no enabled band asks for delay', async () => {
    const { Plugin, calls } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin._lastDesign = { payload: new ArrayBuffer(32), rippleDb: 0 };

    assert.equal(await plugin._designAndStage(plugin._designGeneration), true);
    assert.ok(calls.some(call => call[0] === 'clearWasmAsset' && call[1] === 0));
    assert.equal(plugin._lastDesign, null);
    assert.equal(plugin._assetState, 0);
    assert.equal(plugin.powerGainUpperBoundDb, 0);
    plugin.cleanup();
});

test('Group Delay PEQ stays flat with mixed types at zero delay and with disabled bands', async () => {
    const { Plugin, calls } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    // Every shape represented, every delay zero.
    plugin.setParameters({ t0: 'pk', t1: 'ls', t2: 'hs', t3: 'fl', q0: 8, q3: 0.5 });
    assert.equal(plugin._hasDelay(), false);
    assert.equal(plugin.offlineDspAssetRequired, false);
    assert.equal(await plugin._designAndStage(plugin._designGeneration), true);
    assert.ok(calls.some(call => call[0] === 'clearWasmAsset' && call[1] === 0));

    // A delay on a disabled band does not bring the filter back.
    calls.length = 0;
    plugin.setParameters({ d1: 4, e1: false });
    assert.equal(plugin._hasDelay(), false);
    assert.equal(await plugin._designAndStage(plugin._designGeneration), true);
    assert.ok(calls.some(call => call[0] === 'clearWasmAsset' && call[1] === 0));

    plugin.setParameters({ e1: true });
    assert.equal(plugin._hasDelay(), true);
    plugin.cleanup();
});

test('Group Delay PEQ offline state bypasses while flat and warms up by latency plus bulk delay', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._scheduleDesign = () => {};
    plugin.setParameters({ tp: 8192, lt: '256' });

    const bypass = await plugin.createOfflineDspState({ sampleRate: 96000, outputChannelCount: 2 });
    assert.equal(bypass.offlineDspAssetRequired, false);
    assert.equal(bypass.assets.size, 0);
    assert.equal(bypass.parameters.fd, 4096);
    assert.equal(bypass.parameters.lt, '256');

    plugin.setParameters({ t2: 'hs', d2: -3, q2: 2 });
    const payload = new ArrayBuffer(32 + plugin.tp * Float32Array.BYTES_PER_ELEMENT);
    let closed = false;
    plugin._runtimePromise = Promise.resolve({
        IR_ASSET_TOPOLOGY,
        selectedIrChannelCount: () => 4,
        estimateIrKernelCommitFootprint: () => 8 * 1024 * 1024,
        createGroupDelayPeqDesigner: () => ({
            design: config => {
                assert.equal(config.sampleRate, 96000);
                assert.equal(config.taps, 8192);
                assert.equal(config.bands[2].type, 'hs');
                assert.equal(config.bands[2].delayMs, -3);
                assert.equal(config.bands[2].q, 2);
                return Promise.resolve({ payload });
            },
            close: () => { closed = true; }
        })
    });

    const state = await plugin.createOfflineDspState({ sampleRate: 96000, outputChannelCount: 4 });
    assert.equal(state.offlineDspAssetRequired, true);
    assert.equal(closed, true);
    const asset = state.assets.get(0);
    assert.equal(asset.payload, payload);
    assert.equal(asset.headBlock, 256);
    assert.equal(asset.processingChannels, 4);
    assert.equal(asset.warmupSamples, 256 + 4096);
    assert.equal(state.parameters.fd, 4096);
    plugin.cleanup();
});

/* ------------------------------------------------------------------ *
 * Execution capabilities
 * ------------------------------------------------------------------ */

test('Group Delay PEQ declares its execution capabilities on the class itself', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();

    assert.equal(getPluginExecutionCapabilities(plugin), Plugin.executionCapabilities);
    assert.equal(Plugin.executionCapabilities.requiresWasm, true);
    assert.deepEqual(
        Array.from(Plugin.executionCapabilities.supportedSampleRates),
        [44100, 48000, 88200, 96000, 176400, 192000]
    );
    assert.ok(Object.isFrozen(Plugin.executionCapabilities));
    assert.ok(Object.isFrozen(Plugin.executionCapabilities.supportedSampleRates));
    // The compatibility table is reserved for the frozen parity plugins.
    const capabilities = fs.readFileSync(
        new URL('../../js/audio/plugin-execution-capabilities.js', import.meta.url),
        'utf8'
    );
    assert.doesNotMatch(capabilities, /GroupDelayPEQPlugin/);
    plugin.cleanup();
});

/* ------------------------------------------------------------------ *
 * Runtime wiring
 * ------------------------------------------------------------------ */

test('Group Delay PEQ design modules import files and exports that exist', async () => {
    const moduleDirectory = new URL('../../js/group-delay-peq/', import.meta.url);
    const sources = ['design-core.js', 'design-worker.js', 'designer.js'];
    for (const name of sources) {
        const fileUrl = new URL(name, moduleDirectory);
        const source = fs.readFileSync(fileUrl, 'utf8');
        const named = [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'([^']+)'/g)];
        const defaults = [...source.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*'([^']+)'/g)];
        for (const [, bindings, specifier] of named) {
            const target = new URL(specifier, fileUrl);
            assert.ok(fs.existsSync(target), `${name} imports missing file ${specifier}`);
            const module = await import(target.href);
            for (const binding of bindings.split(',').map(entry => entry.trim()).filter(Boolean)) {
                assert.ok(binding in module, `${name}: ${specifier} has no export ${binding}`);
            }
        }
        for (const [, , specifier] of defaults) {
            const target = new URL(specifier, fileUrl);
            assert.ok(fs.existsSync(target), `${name} imports missing file ${specifier}`);
            const module = await import(target.href);
            assert.ok('default' in module, `${name}: ${specifier} has no default export`);
        }
    }
    // The designer resolves its worker through a URL, which no import graph checks.
    assert.ok(fs.existsSync(new URL('design-worker.js', moduleDirectory)));

    // Everything the plugin pulls in at runtime, and every name it reads off the
    // merged runtime object, has to exist. A missing name (IR_ASSET_TOPOLOGY was the
    // known case) only shows up in the browser otherwise.
    const runtime = {};
    for (const match of pluginSource.matchAll(/import\('([^']+)'\)/g)) {
        const target = new URL(match[1], pluginUrl);
        assert.ok(fs.existsSync(target), `plugin imports missing file ${match[1]}`);
        Object.assign(runtime, await import(target.href));
    }
    const used = new Set(
        [...pluginSource.matchAll(/runtime\.([A-Za-z_$][\w$]*)/g)].map(match => match[1])
    );
    assert.ok(used.size >= 4);
    for (const name of used) assert.ok(name in runtime, `runtime has no export ${name}`);
});

test('Group Delay PEQ design worker answers a real design request', async () => {
    const workerUrl = new URL('../../js/group-delay-peq/design-worker.js', import.meta.url);
    // The worker is written against the browser Worker API, so bridge it onto
    // worker_threads before importing it. Requests that arrive before the dynamic
    // import settles are queued.
    const bootstrap = `
const { parentPort } = require('node:worker_threads');
const queue = [];
let ready = false;
globalThis.postMessage = (message, transfer) => parentPort.postMessage(message, transfer);
const deliver = message => globalThis.onmessage({ data: message });
parentPort.on('message', message => {
    if (ready) deliver(message);
    else queue.push(message);
});
import(${JSON.stringify(workerUrl.href)}).then(() => {
    ready = true;
    while (queue.length) deliver(queue.shift());
}).catch(error => parentPort.postMessage({
    type: 'error',
    requestId: 1,
    message: 'bootstrap failed: ' + (error && error.stack ? error.stack : error)
}));
`;
    const workers = [];
    const designer = createGroupDelayPeqDesigner({
        workerFactory: () => {
            const worker = new Worker(bootstrap, { eval: true });
            workers.push(worker);
            const adapter = {
                onmessage: null,
                onerror: null,
                postMessage: message => worker.postMessage(message),
                terminate: () => worker.terminate()
            };
            worker.on('message', data => adapter.onmessage?.({ data }));
            worker.on('error', error => adapter.onerror?.({ error }));
            return adapter;
        }
    });

    try {
        const result = await designer.design({
            bands: [
                { type: 'pk', frequency: 1000, delayMs: 2, q: 1, enabled: true },
                { type: 'fl', frequency: 60, delayMs: -1, q: 0.7071, enabled: true }
            ],
            taps: 4096,
            sampleRate: 48000
        });
        assert.equal(result.type, 'result');
        assert.ok(result.payload instanceof ArrayBuffer);
        assert.equal(result.payload.byteLength, 32 + 4096 * Float32Array.BYTES_PER_ELEMENT);
        const view = new DataView(result.payload);
        assert.equal(view.getUint32(0, true), IR_ASSET_MAGIC);
        assert.equal(view.getUint32(4, true), 1);
        assert.equal(view.getUint32(8, true), 4096);
        assert.equal(view.getUint32(12, true), 48000);
        assert.equal(view.getUint32(16, true), IR_ASSET_TOPOLOGY.mono);
        assert.equal(result.bulkDelaySamples, 2048);
        assert.equal(result.clamped, false);
        assert.ok(result.rippleDb < 0.1, `ripple ${result.rippleDb}`);
        assert.equal(result.response.frequencies.length, 128);
        assert.equal(result.response.realizedMs.length, 128);
        assert.equal(result.response.targetMs.length, 128);
    } finally {
        designer.close();
        await Promise.all(workers.map(worker => worker.terminate()));
    }
});

/* ------------------------------------------------------------------ *
 * Graph
 * ------------------------------------------------------------------ */

test('Group Delay PEQ draws the target and realized curves in the shared colours', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    mountUI(plugin);
    plugin._runtime = graphRuntime();
    plugin.setParameters({ d2: 3 });
    const frequencies = Float64Array.from([100, 1000, 10000]);
    plugin._lastDesign = {
        rippleDb: 0.01,
        response: {
            frequencies,
            targetMs: Float64Array.from([0, 3, 0]),
            realizedMs: Float64Array.from([0.02, 2.98, -0.01])
        }
    };

    plugin.updateResponse();
    const paths = plugin.responseSvg.children;
    assert.equal(paths.length, 2);
    assert.equal(paths[0].attributes.class, 'group-delay-peq-target-response');
    assert.equal(paths[0].attributes.stroke, 'rgba(176, 176, 176, 0.7)');
    assert.equal(paths[0].attributes.fill, 'none');
    assert.equal(paths[1].attributes.class, 'group-delay-peq-realized-response');
    assert.equal(paths[1].attributes.stroke, '#00ff00');

    // Flat settings clear the design, which is the only time Realized goes away.
    plugin._lastDesign = null;
    plugin.setParameters({ d2: 0 });
    plugin.updateResponse();
    assert.equal(plugin.responseSvg.children.length, 1);
    assert.equal(plugin.responseSvg.children[0].attributes.class, 'group-delay-peq-target-response');
    plugin.cleanup();
});

test('Group Delay PEQ draws the realized curve out to the edges of the plot', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    mountUI(plugin);
    plugin._runtime = graphRuntime();
    plugin.setParameters({ d2: 3 });
    const width = plugin.responseSvg.clientWidth;
    const xOf = command => Number(command.replace(/^[ML] /, '').split(',')[0]);

    // The measured grid spans the plot at this rate, so the green curve starts at the
    // left edge and ends at the right one, just as the grey target curve does.
    const frequencies = designCore.groupDelayPeqResponseFrequencies(96000);
    plugin._lastDesign = {
        rippleDb: 0.01,
        response: {
            frequencies,
            targetMs: new Float64Array(frequencies.length),
            realizedMs: new Float64Array(frequencies.length)
        }
    };
    plugin.updateResponse();
    let realized = plugin.responseSvg.children[1].attributes.d.split(' L ');
    assert.equal(xOf(realized[0]), 0);
    assert.ok(Math.abs(xOf(realized[realized.length - 1]) - width) < 0.5);

    // Below Nyquist there is nothing to measure, so the curve ends where the data does
    // rather than being stretched past it.
    const limited = designCore.groupDelayPeqResponseFrequencies(48000);
    plugin._lastDesign = {
        rippleDb: 0.01,
        response: {
            frequencies: limited,
            targetMs: new Float64Array(limited.length),
            realizedMs: new Float64Array(limited.length)
        }
    };
    plugin.updateResponse();
    realized = plugin.responseSvg.children[1].attributes.d.split(' L ');
    assert.equal(xOf(realized[0]), 0);
    assert.ok(xOf(realized[realized.length - 1]) < width);
    plugin.cleanup();
});

test('Group Delay PEQ scales the axis from the band delays as well as the curve', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    mountUI(plugin);
    plugin._runtime = graphRuntime();

    // A very narrow peak falls between the drawing grid points, so the curve alone
    // would leave the marker outside the plot.
    plugin.setParameters({
        d0: 12, q0: 100, f0: 1000,
        e1: false, e2: false, e3: false, e4: false
    });
    const drawn = plugin._drawFrequencies(plugin.responseSvg.clientWidth);
    const curve = designCore.groupDelayPeqTargetMs({
        bands: plugin._bands(),
        taps: plugin.tp,
        sampleRate: 48000,
        frequencies: drawn
    });
    let curvePeak = 0;
    for (const value of curve) curvePeak = Math.max(curvePeak, Math.abs(value));
    assert.ok(curvePeak < 12, `curve peak ${curvePeak} should miss the narrow bell`);

    plugin.updateResponse();
    assert.ok(plugin._scale.range >= 12, `range ${plugin._scale.range}`);
    const markerY = plugin.delayToY(12);
    assert.ok(markerY >= 0 && markerY <= 100, `marker at ${markerY}%`);

    plugin.cleanup();
});

test('Group Delay PEQ scales the axis from the summed curve when bands overlap', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    mountUI(plugin);
    plugin._runtime = graphRuntime();

    // Two same-sign peaks close together add up well past the largest single delay.
    plugin.setParameters({
        f0: 1000, d0: 4, q0: 1,
        f1: 1100, d1: 4, q1: 1,
        e2: false, e3: false, e4: false
    });
    const drawn = plugin._drawFrequencies(plugin.responseSvg.clientWidth);
    const curve = designCore.groupDelayPeqTargetMs({
        bands: plugin._bands(),
        taps: plugin.tp,
        sampleRate: 48000,
        frequencies: drawn
    });
    let curvePeak = 0;
    for (const value of curve) curvePeak = Math.max(curvePeak, Math.abs(value));
    assert.ok(curvePeak > 4, `summed curve peak ${curvePeak} should exceed the band delays`);

    plugin.updateResponse();
    assert.ok(plugin._scale.range >= curvePeak, `range ${plugin._scale.range}`);
    assert.ok(plugin._scale.range > 5, 'the curve, not the band delays, raised the scale');
    plugin.cleanup();
});

test('Group Delay PEQ maps drag height to delay and widens rather than shrinks the axis', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    mountUI(plugin);
    plugin._runtime = graphRuntime();
    plugin._scale = { range: 10, gridStep: 2 };

    assert.equal(plugin.yToDelay(0), 10);
    assert.equal(plugin.yToDelay(50), 0);
    assert.equal(plugin.yToDelay(100), -10);
    assert.equal(plugin.delayToY(10), 0);
    assert.equal(plugin.delayToY(-10), 100);
    assert.equal(plugin.delayToY(0), 50);

    plugin.activeDragMarker = 0;
    plugin.hasMoved = true;
    plugin._dragScaleExpansions = 0;
    // The plot starts 20 px down and is 440 px tall, so its bottom edge is at 460.
    // Sitting on the edge is not a step of its own: the pointer has spent no travel
    // outside the plot yet, so the axis stays where it is.
    const bottom = { clientX: 512, clientY: 460 };
    plugin.handleDragMove(bottom);
    assert.equal(plugin._scale.gridStep, 2);
    assert.equal(plugin._scale.range, 10);
    assert.equal(plugin.d0, -10);

    // Holding still cannot widen the axis: how far it opens is a function of the
    // pointer travel, not of how many mousemove events the browser delivers.
    for (let event = 0; event < 6; event += 1) plugin.handleDragMove(bottom);
    assert.equal(plugin._scale.gridStep, 2);
    assert.equal(plugin._scale.range, 10);
    assert.equal(plugin.d0, -10);

    // Pushing out past the edge is what widens it, one step per travel step.
    plugin.handleDragMove({ clientX: 512, clientY: 460 + Plugin.EDGE_EXPAND_STEP_PX });
    assert.equal(plugin._scale.gridStep, 5);
    assert.equal(plugin.d0, -25);

    // Away from the edge the scale is left alone, and it never shrinks mid-drag.
    plugin.handleDragMove({ clientX: 512, clientY: 240 });
    assert.equal(plugin._scale.gridStep, 5);
    assert.equal(plugin.d0, 0);
    // The far edge widens on the same rule, measured against the travel already
    // spent, so a wiggle between the two edges cannot ratchet the axis open.
    plugin.handleDragMove({ clientX: 512, clientY: 20 });
    assert.equal(plugin._scale.gridStep, 5);
    assert.equal(plugin.d0, 25);
    plugin.handleDragMove({ clientX: 512, clientY: 20 - 2 * Plugin.EDGE_EXPAND_STEP_PX });
    assert.equal(plugin._scale.gridStep, 10);
    assert.equal(plugin.d0, 50);

    // Ending the drag recomputes the scale from scratch.
    plugin.setBand(0, { delayMs: 1 });
    plugin.handleDragEnd();
    assert.equal(plugin.activeDragMarker, null);
    assert.equal(plugin._scale.range, 5);
    assert.equal(plugin._scale.gridStep, 1);
    plugin.cleanup();
});

test('Group Delay PEQ reaches the whole delay range with the drag alone', () => {
    const sweep = eventCount => {
        const { Plugin } = loadPlugin();
        const plugin = new Plugin();
        mountUI(plugin);
        plugin._runtime = graphRuntime();
        plugin.activeDragMarker = 0;
        plugin.hasMoved = true;
        // One stroke of 96 px past the bottom edge, cut into eventCount reports.
        for (let step = 1; step <= eventCount; step += 1) {
            plugin.handleDragMove({ clientX: 512, clientY: 460 + 96 * step / eventCount });
        }
        const result = { range: plugin._scale.range, delay: plugin.d0, limit: plugin._delayLimitMs() };
        plugin.cleanup();
        return result;
    };
    // The same gesture must land on the same axis whatever the event rate is.
    const reference = sweep(96);
    assert.deepEqual(sweep(1), reference);
    assert.deepEqual(sweep(4), reference);
    assert.deepEqual(sweep(12), reference);
    // And that gesture has to cover the whole parameter range, as on the FIR PEQ.
    assert.equal(reference.delay, -reference.limit);
});

test('Group Delay PEQ keeps the delay of a marker on the axis edge through a sideways drag', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    mountUI(plugin);
    plugin._runtime = graphRuntime();

    // The axis covers exactly the largest delay, so this marker is drawn on the very
    // edge of the plot and a grab starts with the pointer already at the boundary.
    plugin.setParameters({ d0: 5, e0: false });
    plugin.updateResponse();
    const assertScaleUnchanged = () => {
        assert.equal(plugin._scale.range, 5);
        assert.equal(plugin._scale.gridStep, 1);
    };
    assertScaleUnchanged();

    const slideSideways = (edgeY, clientX) => {
        plugin.activeDragMarker = 0;
        plugin.hasMoved = true;
        plugin._dragScaleExpansions = 0;
        plugin.handleDragMove({ clientX, clientY: edgeY });
        plugin.handleDragEnd();
    };

    // Sideways travel moves the frequency and leaves the delay untouched, drag after
    // drag. Counting the edge itself as the first widening step used to double the
    // delay on every re-grab, so the value ratcheted away from what the user set.
    assert.equal(plugin.delayToY(plugin.d0), 0);
    const topStartFrequency = plugin.f0;
    for (const clientX of [560, 620, 680]) {
        slideSideways(20, clientX);
        assert.equal(plugin.d0, 5, 'a sideways drag along the top edge changed the delay');
        assertScaleUnchanged();
    }
    assert.ok(plugin.f0 > topStartFrequency, 'the sideways drag did not move the band frequency');

    plugin.setParameters({ d0: -5 });
    plugin.updateResponse();
    assert.equal(plugin.delayToY(plugin.d0), 100);
    const bottomStartFrequency = plugin.f0;
    for (const clientX of [440, 380, 320]) {
        slideSideways(460, clientX);
        assert.equal(plugin.d0, -5, 'a sideways drag along the bottom edge changed the delay');
        assertScaleUnchanged();
    }
    assert.ok(plugin.f0 < bottomStartFrequency, 'the sideways drag did not move the band frequency');
    plugin.cleanup();
});

test('Group Delay PEQ keeps the marker of a disabled band inside the plot', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    mountUI(plugin);
    plugin._runtime = graphRuntime();
    plugin.setParameters({ d0: 40 });
    plugin.updateResponse();
    plugin.updateMarkers();
    const enabledTop = plugin.markers[0].style.top;

    // A marker is drawn for every band, so the scale has to cover the disabled ones
    // as well. The curves must not: a disabled band shapes nothing.
    plugin.setParameters({ e0: false });
    plugin.updateResponse();
    plugin.updateMarkers();
    assert.equal(plugin.markers[0].style.top, enabledTop);
    const top = parseFloat(plugin.markers[0].style.top);
    assert.ok(top >= 0 && top <= 100, `disabled marker at ${plugin.markers[0].style.top}`);
    assert.ok(plugin._scale.range >= 40, `range ${plugin._scale.range}`);
    assert.ok(plugin.markers[0].classList.contains('disabled'));

    const curve = designCore.groupDelayPeqTargetMs({
        bands: plugin._bands(),
        taps: plugin.tp,
        sampleRate: 48000,
        frequencies: plugin._drawFrequencies(plugin.responseSvg.clientWidth)
    });
    let curvePeak = 0;
    for (const value of curve) curvePeak = Math.max(curvePeak, Math.abs(value));
    assert.ok(curvePeak < 1e-9, `disabled band still shapes the target curve (${curvePeak})`);
    plugin.cleanup();
});

test('Group Delay PEQ redraws the grid and the markers when the scale changes', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    mountUI(plugin);
    plugin._runtime = graphRuntime();
    plugin.updateResponse();
    plugin.updateMarkers();

    const gridBefore = plugin.gridSvg.children[0];
    const labelsBefore = plugin.gridSvg.children
        .filter(child => child.tagName === 'text')
        .map(child => child.textContent);
    const markerBefore = plugin.markers[0].style.top;
    const rangeBefore = plugin._scale.range;

    plugin.setParameters({ d0: 40 });
    assert.notEqual(plugin._scale.range, rangeBefore);
    assert.notEqual(plugin.gridSvg.children[0], gridBefore);
    const labelsAfter = plugin.gridSvg.children
        .filter(child => child.tagName === 'text')
        .map(child => child.textContent);
    assert.notDeepEqual(labelsAfter, labelsBefore);
    assert.notEqual(plugin.markers[0].style.top, markerBefore);
    assert.equal(
        plugin.markers[0].style.top,
        `${20 / 480 * 100 + plugin.delayToY(40) / 100 * (440 / 480 * 100)}%`
    );
    plugin.cleanup();
});

test('Group Delay PEQ leaves the axis labels off the edges of the plot', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    mountUI(plugin);
    plugin._runtime = graphRuntime();
    plugin._renderGrid();

    const labels = plugin.gridSvg.children
        .filter(child => child.tagName === 'text')
        .map(child => child.textContent);
    const { range } = plugin._scale;
    // A label centred on the top or bottom grid line would be cut in half by the SVG
    // viewport, so those two lines carry no label while every inner one still does.
    assert.ok(!labels.includes(`${range}ms`), `top edge label drawn (${labels.join(',')})`);
    assert.ok(!labels.includes(`${-range}ms`), `bottom edge label drawn (${labels.join(',')})`);
    assert.ok(labels.includes('0ms'));
    assert.ok(labels.includes(`${range - plugin._scale.gridStep}ms`));
    // The frequency labels sit well inside the 10 Hz to 40 kHz axis, so they all stay.
    assert.ok(labels.includes('20'));
    assert.ok(labels.includes('20k'));
    plugin.cleanup();
});

test('Group Delay PEQ draws the target curve once the runtime resolves, even while flat', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    mountUI(plugin);

    assert.equal(plugin._runtime, null);
    plugin.updateResponse();
    assert.equal(plugin.responseSvg.children.length, 0);

    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(plugin._runtime);
    assert.equal(plugin._hasDelay(), false);
    assert.equal(plugin.responseSvg.children.length, 1);
    assert.equal(plugin.responseSvg.children[0].attributes.class, 'group-delay-peq-target-response');
    assert.ok(plugin.responseSvg.children[0].attributes.d.startsWith('M '));
    plugin.cleanup();
});

/* ------------------------------------------------------------------ *
 * Registration and styles
 * ------------------------------------------------------------------ */

test('Group Delay PEQ is registered and styled under its own class names', () => {
    const registry = fs.readFileSync(
        new URL('../../plugins/plugins.txt', import.meta.url),
        'utf8'
    ).split(/\r?\n/);
    const index = registry.indexOf(
        'eq/group_delay_peq: Group Delay PEQ | EQ | GroupDelayPEQPlugin | css'
    );
    assert.ok(index > 0, 'plugins.txt entry missing');
    assert.match(registry[index - 1], /^eq\/group_delay_eq: Group Delay EQ /);
    assert.match(registry[index + 1], /^eq\/hi_pass_filter: Hi Pass Filter /);

    assert.match(pluginCss, /\.group-delay-peq-plugin-ui \.group-delay-peq-graph/);
    assert.match(pluginCss, /\.group-delay-peq-legend-realized/);
    assert.match(pluginCss, /\.group-delay-peq-marker/);
    assert.match(pluginCss, /\.group-delay-peq-band-type/);
    assert.match(pluginCss, /\.group-delay-peq-delay-text/);
    assert.match(pluginCss, /\.group-delay-peq-q-slider/);
    assert.doesNotMatch(pluginCss, /gain/);
    assert.doesNotMatch(pluginCss, /slope/);
    assert.doesNotMatch(pluginSource, /createRadioGroup/);
    assert.doesNotMatch(pluginSource, /group-delay-eq/);

    const locales = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'];
    const keys = [...pluginSource.matchAll(/'(groupDelayPeq\.[\w.]+)'/g)].map(match => match[1]);
    assert.ok(keys.length >= 20);
    for (const locale of locales) {
        const source = fs.readFileSync(
            new URL(`../../js/locales/${locale}.json5`, import.meta.url),
            'utf8'
        );
        for (const key of keys) {
            assert.ok(source.includes(`"${key}":`), `${locale}.json5 has no ${key}`);
        }
        for (const [id, name] of [['pk', 'Peak'], ['ls', 'LowShelv'], ['hs', 'HighShel'], ['fl', 'FilterGD']]) {
            assert.ok(
                source.includes(`"groupDelayPeq.type.${id}": "${name}"`),
                `${locale}.json5 type ${id}`
            );
        }
    }
    assert.equal(path.basename(pluginUrl.pathname), 'group_delay_peq.js');
});
