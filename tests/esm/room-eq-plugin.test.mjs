import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginSource = await fs.readFile(path.join(repoRoot, 'plugins', 'eq', 'room_eq.js'), 'utf8');
const pluginCss = await fs.readFile(path.join(repoRoot, 'plugins', 'eq', 'room_eq.css'), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flushUntil(predicate) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    throw new Error('Expected asynchronous work did not start');
}

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
    }

    registerProcessor(source) {
        this.processorSource = source;
    }

    parseFiniteNumber(value, minimum, maximum, fallback) {
        const number = Number(value);
        return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
    }

    updateParameters() {
        this.updateCount = (this.updateCount || 0) + 1;
    }

    getParameters() {
        return {
            type: this.constructor.name,
            id: this.id,
            enabled: this.enabled,
            ...(this.inputBus !== null && { inputBus: this.inputBus }),
            ...(this.outputBus !== null && { outputBus: this.outputBus }),
            ...(this.channel !== null && { channel: this.channel })
        };
    }

    getSerializableParameters() {
        const serialized = JSON.parse(JSON.stringify(this.getParameters()));
        const { type, id, inputBus, outputBus, channel, ...parameters } = serialized;
        if (inputBus !== undefined) parameters.ib = inputBus;
        if (outputBus !== undefined) parameters.ob = outputBus;
        if (channel !== null && channel !== undefined) parameters.ch = channel;
        return parameters;
    }

    _setValidatedParameters(params) {
        if (params.enabled !== undefined) this.enabled = Boolean(params.enabled);
        if (params.inputBus !== undefined) this.inputBus = params.inputBus;
        if (params.outputBus !== undefined) this.outputBus = params.outputBus;
        if (params.channel !== undefined) this.channel = params.channel;
    }

    setSerializedParameters(params) {
        const { en, ib, ob, ch, ...pluginParams } = params;
        this.setParameters({
            enabled: en,
            ...(ib !== undefined && { inputBus: ib }),
            ...(ob !== undefined && { outputBus: ob }),
            ...(ch !== undefined && { channel: ch }),
            ...pluginParams
        });
    }

    _nextWasmAssetOperationRevision(slot) {
        const revision = (this._wasmAssetOperationRevisions.get(slot) || 0) + 1;
        this._wasmAssetOperationRevisions.set(slot, revision);
        return revision;
    }

    _isCurrentWasmAssetOperation(slot, operationRevision) {
        return this._wasmAssetOperationRevisions.get(slot) === operationRevision;
    }

    setWasmAsset(slot, descriptor) {
        this.asset = { slot, descriptor };
        return this._nextWasmAssetOperationRevision(slot);
    }

    clearWasmAsset(slot) {
        this.asset = null;
        return this._nextWasmAssetOperationRevision(slot);
    }

    cleanup() {}
}

function loadPlugin() {
    const document = {
        visibilityState: 'visible',
        addEventListener() {},
        removeEventListener() {}
    };
    const window = {
        workletNode: { channelCount: 2, context: { sampleRate: 48000 } }
    };
    const context = vm.createContext({
        PluginBase,
        window,
        document,
        console,
        setTimeout,
        clearTimeout,
        globalThis: null
    });
    context.globalThis = context;
    vm.runInContext(pluginSource, context, { filename: 'room_eq.js' });
    return { Plugin: window.RoomEqPlugin, context };
}

test('Room EQ renders Phase as radio buttons', () => {
    assert.match(pluginSource,
        /createRadioGroup\(this\._t\('roomEq\.parameter\.phase', 'Phase'\), \[/);
    assert.match(pluginSource,
        /roomEq\.phase\.direct', 'Correction'/);
    assert.doesNotMatch(pluginSource,
        /createSelectControl\(this\._t\('roomEq\.parameter\.phase', 'Phase'\), \[/);
});

test('Room EQ renders independent level and phase correction controls', () => {
    assert.match(pluginSource,
        /roomEq\.parameter\.levelCorrection', 'Level Correction'\),\s*0, 100, 1, this\.cr/);
    assert.match(pluginSource,
        /roomEq\.parameter\.phaseCorrection', 'Phase Correction'\),\s*0, 100, 1, this\.pr/);
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    assert.equal(plugin.cr, 100);
    assert.equal(plugin.pr, 100);
    plugin.setParameters({ cr: 49.6 });
    assert.equal(plugin.cr, 50);
    plugin.setParameters({ cr: -1 });
    assert.equal(plugin.cr, 0);
    plugin.setParameters({ pr: 24.6 });
    assert.equal(plugin.pr, 25);
    plugin.cleanup();
});

test('Room EQ accepts Max Boost through 18 dB and caps higher settings', () => {
    assert.match(pluginSource,
        /roomEq\.parameter\.maxBoost', 'Max Boost'\),\s*0, 18, 0\.1, this\.mb/);
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin.setParameters({ mb: 18 });
    assert.equal(plugin.mb, 18);
    plugin.setParameters({ mb: 19 });
    assert.equal(plugin.mb, 18);
    plugin.cleanup();
});

test('Room EQ disables Phase Correction outside Correction mode', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const inputs = [{ disabled: false }, { disabled: false }];
    plugin._phaseCorrectionControl = { querySelectorAll: () => inputs };

    plugin._syncPhaseCorrectionControl();
    assert.ok(inputs.every(input => input.disabled));
    plugin.setParameters({ pm: 'full' });
    assert.ok(inputs.every(input => !input.disabled));
    plugin.setParameters({ pm: 'min' });
    assert.ok(inputs.every(input => input.disabled));
    plugin.cleanup();
});

test('Room EQ renders Reference Point as a consensus-first measurement point list', () => {
    assert.doesNotMatch(pluginSource,
        /createParameterControl\(this\._t\('roomEq\.parameter\.referencePoint'/);
    assert.match(pluginSource, /room-eq-reference-point-/);
    const { Plugin, context } = loadPlugin();
    const plugin = new Plugin();
    assert.equal(plugin.rp, 0);
    const select = {
        children: [],
        value: '',
        disabled: false,
        replaceChildren() { this.children = []; },
        appendChild(child) { this.children.push(child); }
    };
    context.document.createElement = () => ({ value: '', textContent: '' });
    plugin._referencePointSelect = select;

    plugin.rp = 6;
    assert.equal(plugin._renderReferencePoints({
        points: [
            { pointId: 0, name: 'Center seat' },
            { pointId: 5, name: 'Right seat' }
        ]
    }), false);
    assert.deepEqual(
        select.children.map(option => [option.value, option.textContent]),
        [['0', 'Consensus (all points)'], ['1', 'Center seat'], ['6', 'Right seat']]
    );
    assert.equal(select.value, '6');

    plugin.rp = 99;
    assert.equal(plugin._renderReferencePoints({ points: [{ pointId: 0 }] }), true);
    assert.equal(plugin.rp, 0);
    assert.equal(select.value, '0');
    plugin.setParameters({ rp: 'invalid' });
    assert.equal(plugin.rp, 0);
    plugin.cleanup();
});

test('Room EQ serializes one measurement, common delay, and the selected host channel', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin.setParameters({
        pm: 'min',
        tp: 8192,
        ms0: 'measurement-1',
        mn0: 'Listening seat',
        dy0: 1.25,
        cr: 42,
        pr: 73,
        rp: 4,
        channel: 'B'
    });
    const serialized = plugin.getSerializableParameters();
    assert.equal(serialized.ch, 'B');
    assert.equal(serialized.ms, 'measurement-1');
    assert.equal(serialized.mn, 'Listening seat');
    assert.equal(serialized.dl, 1.25);
    assert.equal(serialized.cr, 42);
    assert.equal(serialized.pr, 73);
    assert.equal(serialized.rp, 4);
    assert.equal(serialized.en0, undefined);
    assert.equal(serialized.ce, undefined);
    assert.equal(serialized.fd, undefined);
    assert.equal(serialized.dy, undefined);

    const restored = new Plugin();
    restored.setSerializedParameters(serialized);
    assert.equal(restored.channel, 'B');
    assert.equal(restored.pm, 'min');
    assert.equal(restored.tp, 8192);
    assert.equal(restored.measurementId, 'measurement-1');
    assert.equal(restored.delayMs, 1.25);
    assert.equal(restored.cr, 42);
    assert.equal(restored.pr, 73);
    assert.equal(restored.rp, 4);
    plugin.cleanup();
    restored.cleanup();
});

test('Room EQ owns its Additional EQ editor implementation', () => {
    const { context } = loadPlugin();
    let changedBands = null;
    const editor = context.window.RoomEqPlugin.createAdditionalEqEditor({
        id: 'room-eq-editor',
        bands: [{ frequency: 100, gain: 0, q: 1, type: 'pk', enabled: true }],
        onChange: bands => { changedBands = bands; }
    });
    assert.doesNotMatch(pluginSource, /FiveBandPEQPlugin/);
    assert.match(pluginSource,
        /const qLabel = document\.createElement\('div'\);\s*qLabel\.className = 'room-eq-additional-eq-q-label'/);
    assert.match(pluginCss,
        /\.room-eq-additional-eq-ui \.room-eq-additional-eq-q-slider \{[\s\S]*min-width: 0;/);
    editor.setBand(0, 200, 3, 1.2, 'pk', true);
    assert.equal(changedBands[0].frequency, 200);
    assert.equal(changedBands[0].gain, 3);
    editor.dispose();
});

test('Room EQ graph draws measured, correction, and corrected response curves', () => {
    const { context } = loadPlugin();
    const paths = [];
    context.document.createElementNS = () => ({
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        id: ''
    });
    const responseSvg = {
        clientWidth: 400,
        clientHeight: 200,
        attributes: {},
        children: paths,
        get firstChild() { return this.children[0] || null; },
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(child) { this.children.push(child); },
        removeChild(child) {
            this.children.splice(this.children.indexOf(child), 1);
        }
    };
    const editor = context.window.RoomEqPlugin.createAdditionalEqEditor({
        id: 'room-eq-editor',
        sampleRate: 48000,
        baseResponse: null,
        correctionLowFrequency: 100,
        correctionHighFrequency: 10000,
        bands: [{ frequency: 1000, gain: 6, q: 1, type: 'pk', enabled: true }]
    });
    editor.responseSvg = responseSvg;
    editor.uiCreated = true;
    editor.calculateBandResponse = () => 2;
    editor.updateResponse();
    assert.deepEqual(
        paths.map(element => element.attributes.class),
        [
            'room-eq-correction-boundary room-eq-correction-low-boundary',
            'room-eq-correction-boundary room-eq-correction-high-boundary'
        ]
    );
    editor.syncBaseResponse({
        frequencies: new Float32Array([10, 20, 20000, 40000]),
        measuredDb: new Float32Array([-40, -30, -30, 0]),
        correctionDb: new Float32Array([1, 1, 1, 1]),
        normalizationGainDb: -27
    });

    assert.equal(paths.length, 6);
    assert.equal(paths[0].attributes.class, 'room-eq-measured-response-path');
    assert.equal(paths[0].attributes.stroke, '#b0b0b0');
    assert.equal(paths[0].attributes['stroke-width'], '1');
    assert.match(paths[0].attributes.d, /^M 0\.00,165\.00 /);
    assert.equal(paths[1].attributes.class, 'room-eq-base-response-path');
    assert.equal(paths[1].attributes.stroke, '#80c080');
    assert.equal(paths[1].attributes['stroke-width'], '1');
    assert.match(paths[1].attributes.d, /^M 0\.00,95\.00 /);
    assert.equal(paths[2].attributes.class, 'room-eq-combined-response-path');
    assert.equal(paths[2].attributes.stroke, '#00ff00');
    assert.equal(paths[2].attributes['stroke-width'], '1');
    assert.match(paths[2].attributes.d, /^M 0\.00,85\.00 /);
    assert.equal(paths[3].attributes.class, 'room-eq-corrected-response-path');
    assert.equal(paths[3].attributes.stroke, '#ffffff');
    assert.equal(paths[3].attributes['stroke-width'], '1');
    assert.match(paths[3].attributes.d, /^M 0\.00,150\.00 /);
    const correctedPoints = Array.from(
        paths[3].attributes.d.matchAll(/[ML] ([\d.]+),(-?[\d.]+)/g),
        match => ({ x: Number(match[1]), y: Number(match[2]) })
    );
    const targetFrequencyX = editor.freqToX(20) * responseSvg.clientWidth / 100;
    const targetPoint = correctedPoints.find(point => point.x >= targetFrequencyX);
    assert.ok(Math.abs(targetPoint.y - 100) < 0.01);
    const [lowBoundary, highBoundary] = paths.slice(4);
    assert.equal(
        lowBoundary.attributes.class,
        'room-eq-correction-boundary room-eq-correction-low-boundary'
    );
    assert.equal(lowBoundary.attributes.x1, lowBoundary.attributes.x2);
    assert.equal(
        Number(lowBoundary.attributes.x1),
        Number((editor.freqToX(100) * responseSvg.clientWidth / 100).toFixed(2))
    );
    assert.equal(lowBoundary.attributes.y1, '0');
    assert.equal(lowBoundary.attributes.y2, '200');
    assert.equal(
        highBoundary.attributes.class,
        'room-eq-correction-boundary room-eq-correction-high-boundary'
    );
    assert.equal(
        Number(highBoundary.attributes.x1),
        Number((editor.freqToX(10000) * responseSvg.clientWidth / 100).toFixed(2))
    );
    assert.match(pluginCss,
        /\.room-eq-additional-eq-response \.room-eq-measured-response-path/);
    assert.match(pluginCss,
        /\.room-eq-additional-eq-response \.room-eq-corrected-response-path/);
    assert.match(pluginCss,
        /\.room-eq-additional-eq-response path \{[^}]*stroke-width: 1;/);
    assert.match(pluginCss,
        /\.room-eq-correction-boundary \{[^}]*stroke: #fff;[^}]*stroke-width: 1;[^}]*stroke-dasharray: 2 3;[^}]*stroke-linecap: round;/);
    editor.dispose();
});

test('Room EQ offers frequency and impulse response graph views', () => {
    assert.match(pluginSource, /value: 'frequency',\s+label: this\._t\(\s*'roomEq\.graph\.frequencyResponse'/);
    assert.match(pluginSource, /value: 'impulse',\s+label: this\._t\('roomEq\.graph\.impulseResponse'/);
    assert.match(pluginCss, /\.room-eq-impulse-view \.room-eq-additional-eq-grid/);
    assert.match(pluginCss, /\.room-eq-impulse-response \.room-eq-impulse-before/);
    assert.match(pluginCss, /\.room-eq-impulse-response \.room-eq-impulse-after/);
});

test('Room EQ graph shows a color-matched legend in its upper-right corner', () => {
    for (const label of ['Room EQ', 'Total EQ', 'Before', 'After']) {
        assert.match(pluginSource, new RegExp(`'${label}'`));
    }
    assert.match(pluginCss,
        /\.room-eq-response-legend \{[^}]*top: 5px;[^}]*right: 7px;/s);
    assert.match(pluginCss, /\.room-eq-response-legend-room \{ color: #80c080;/);
    assert.match(pluginCss, /\.room-eq-response-legend-total \{ color: #00ff00;/);
    assert.match(pluginCss, /\.room-eq-response-legend-before \{ color: #b0b0b0;/);
    assert.match(pluginCss, /\.room-eq-response-legend-after \{ color: #fff;/);
    assert.match(pluginCss,
        /\.room-eq-impulse-view \.room-eq-response-legend-room,[\s\S]*\.room-eq-impulse-view \.room-eq-response-legend-total \{\s*display: none;/);
});

test('Room EQ legend emphasis moves a response path to the front and restores it', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const createPath = name => ({
        name,
        parentNode: null,
        classes: new Set(),
        classList: {
            add(className) { this.owner.classes.add(className); },
            remove(className) { this.owner.classes.delete(className); },
            owner: null
        }
    });
    const before = createPath('before');
    const target = createPath('target');
    const after = createPath('after');
    for (const path of [before, target, after]) path.classList.owner = path;
    const container = {
        children: [before, target, after],
        querySelector(selector) { return selector === '.target' ? target : null; },
        appendChild(path) {
            this.children.splice(this.children.indexOf(path), 1);
            this.children.push(path);
            path.parentNode = this;
        },
        insertBefore(path, sibling) {
            this.children.splice(this.children.indexOf(path), 1);
            this.children.splice(this.children.indexOf(sibling), 0, path);
        }
    };
    for (const path of container.children) {
        path.parentNode = container;
        Object.defineProperty(path, 'nextSibling', {
            get() {
                const index = container.children.indexOf(path);
                return container.children[index + 1] || null;
            }
        });
    }

    const restore = plugin._emphasizeResponsePath(container, '.target');

    assert.deepEqual(container.children.map(path => path.name), ['before', 'after', 'target']);
    assert.equal(target.classes.has('room-eq-response-highlighted'), true);
    restore();
    assert.deepEqual(container.children.map(path => path.name), ['before', 'target', 'after']);
    assert.equal(target.classes.has('room-eq-response-highlighted'), false);
    assert.equal(plugin._emphasizeResponsePath(container, '.missing'), null);
    assert.match(pluginCss,
        /\.room-eq-additional-eq-response \.room-eq-response-highlighted,[\s\S]*stroke-width: 3\.5;[\s\S]*opacity: 1;/);
    plugin.cleanup();
});

test('Room EQ impulse graph downsamples without losing narrow extrema', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const samples = new Float32Array(1000);
    samples[401] = 1;
    samples[402] = -1;

    const pathData = plugin._waveformPath(samples, 100, 200, 1);

    assert.match(pathData, /,0\.00/);
    assert.match(pathData, /,200\.00/);
    assert.ok(pathData.split(/[ML]/).length < samples.length);
    plugin.cleanup();
});

test('Room EQ impulse graph uses one even time interval for the displayed range', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const assertTicks = (endMs, interval, ticks) => {
        const result = plugin._impulseTimeTicks(-1, endMs);
        assert.equal(result.interval, interval);
        assert.deepEqual(Array.from(result.ticks), ticks);
    };

    assertTicks(1, 0.5, [-0.5, 0, 0.5]);
    assertTicks(6, 1, [0, 1, 2, 3, 4, 5]);
    assertTicks(20, 5, [0, 5, 10, 15]);
    assertTicks(50, 10, [0, 10, 20, 30, 40]);
    plugin.cleanup();
});

test('Room EQ impulse graph draws gray before and white after waveforms', () => {
    const { Plugin, context } = loadPlugin();
    context.document.createElementNS = () => ({
        attributes: {},
        textContent: '',
        setAttribute(name, value) { this.attributes[name] = value; }
    });
    const svg = (width = 0, height = 0) => ({
        clientWidth: width,
        clientHeight: height,
        attributes: {},
        children: [],
        replaceChildren() { this.children = []; },
        setAttribute(name, value) { this.attributes[name] = value; },
        appendChild(child) { this.children.push(child); }
    });
    const plugin = new Plugin();
    const impulseGrid = svg();
    const impulseResponse = svg(400, 200);
    const unavailable = { hidden: false };
    plugin._responseView = 'impulse';
    plugin._responseViewElements = { impulseGrid, impulseResponse, unavailable };
    plugin._lastDesign = {
        previews: [{
            impulseResponse: {
                startMs: -5,
                durationMs: 5,
                before: new Float32Array([1, 0.5, 0, -0.5]),
                after: new Float32Array([0.8, 0.25, 0, -0.25])
            }
        }]
    };

    plugin._drawImpulseResponse();

    assert.equal(unavailable.hidden, true);
    const gridLines = impulseGrid.children.filter(child => child.attributes.x1 !== undefined);
    const gridLabels = impulseGrid.children.filter(child => child.attributes.x !== undefined);
    const verticalLines = gridLines.filter(
        line => line.attributes.x1 === line.attributes.x2
    );
    const horizontalLines = gridLines.filter(
        line => line.attributes.y1 === line.attributes.y2
    );
    assert.ok(verticalLines.every(
        line => Number(line.attributes.x1) > 0 && Number(line.attributes.x1) < 400
    ));
    const zeroLabel = gridLabels.find(label => label.textContent === '0');
    assert.ok(zeroLabel);
    assert.equal(Number(zeroLabel.attributes.x), 200);
    assert.ok(verticalLines.some(
        line => line.attributes.x1 === zeroLabel.attributes.x
    ));
    assert.ok(horizontalLines.every(
        line => Number(line.attributes.y1) > 0 && Number(line.attributes.y1) < 200
    ));
    assert.ok(gridLabels.every(label =>
        verticalLines.some(line => line.attributes.x1 === label.attributes.x) ||
        horizontalLines.some(line => line.attributes.y1 === label.attributes.y)
    ));
    assert.equal(impulseResponse.children.length, 2);
    assert.equal(impulseResponse.children[0].attributes.class, 'room-eq-impulse-before');
    assert.equal(impulseResponse.children[1].attributes.class, 'room-eq-impulse-after');
    assert.match(impulseResponse.children[0].attributes.d, /^M 0\.00,/);
    assert.match(impulseResponse.children[1].attributes.d, /^M 0\.00,/);
    assert.match(pluginCss,
        /\.room-eq-impulse-before \{\s*stroke: #888;\s*stroke-width: 1;/s);
    assert.match(pluginCss,
        /\.room-eq-impulse-after \{\s*stroke: #fff;\s*stroke-width: 1;/s);
    plugin.cleanup();
});

test('Room EQ sample-rate commits synchronize and redraw the open Additional EQ editor', () => {
    const { Plugin, context } = loadPlugin();
    const plugin = new Plugin();
    const editor = context.window.RoomEqPlugin.createAdditionalEqEditor({
        id: 'room-eq-editor',
        sampleRate: 48000,
        bands: plugin.eqBands
    });
    let responseUpdates = 0;
    editor.uiCreated = true;
    editor.setUIValues = () => {};
    editor.updateMarkers = () => {};
    editor.updateResponse = () => { responseUpdates += 1; };
    plugin._additionalEqEditor = editor;

    plugin.getParameters({ sampleRate: 96000, outputChannelCount: 2, commitSampleRate: true });

    assert.equal(plugin._sampleRate, 96000);
    assert.equal(editor._sampleRate, 96000);
    assert.equal(responseUpdates, 1);
    plugin.cleanup();
});

test('Room EQ correction limits synchronize with the graph boundaries', () => {
    const { Plugin, context } = loadPlugin();
    const plugin = new Plugin();
    const editor = context.window.RoomEqPlugin.createAdditionalEqEditor({
        id: 'room-eq-editor',
        bands: plugin.eqBands
    });
    plugin._additionalEqEditor = editor;

    plugin.setParameters({ fl: 80, fh: 14000 });

    assert.equal(editor.correctionLowFrequency, 80);
    assert.equal(editor.correctionHighFrequency, 14000);
    plugin.cleanup();
});

test('Room EQ omits channel enable and packs one common delay', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin._designStaged = true;
    plugin.setParameters({ gn: 1, dl: 0.5 });
    assert.equal(plugin.getParameters().dy, 24);
    assert.equal(plugin.getParameters().ce, undefined);
    plugin.setParameters({ sm: 0.25 });
    assert.equal(plugin.getParameters().dy, 24);
    assert.equal(plugin.getParameters().ce, undefined);
    plugin.cleanup();
});

test('Room EQ power bound is runtime gain when dry and runtime gain plus resident FIR L1', () => {
    const { Plugin, context } = loadPlugin();
    const plugin = new Plugin();
    plugin.tp = 8192;
    plugin.gn = -3;
    plugin._updatePowerGainBound(null);
    assert.equal(plugin.powerGainUpperBoundDb, -3);

    const payload = vm.runInContext(`new ArrayBuffer(${32 + plugin.tp * 4})`, context);
    const taps = new Float32Array(payload, 32);
    taps[0] = 1.25;
    taps[1] = -0.75;
    plugin._updatePowerGainBound(payload);
    assert.ok(Math.abs(plugin.powerGainUpperBoundDb - (-3 + 20 * Math.log10(2))) < 1e-9);
    plugin.cleanup();
});

test('Room EQ translates channel-independent quality warning codes', () => {
    const { Plugin, context } = loadPlugin();
    context.window.uiManager = {
        t: key => key === 'roomEq.warning.filterAccuracy'
            ? 'Translated filter accuracy warning.'
            : key
    };
    const plugin = new Plugin();
    const warning = plugin._qualityWarningMessage('filterAccuracy');
    assert.equal(warning, 'Translated filter accuracy warning.');
    assert.doesNotMatch(warning, /Channel \d+/);
    plugin.cleanup();
});

test('stale WASM asset state cannot replace current Room EQ status', () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const oldRevision = plugin.setWasmAsset(0, { payload: new ArrayBuffer(0) });
    const currentRevision = plugin.setWasmAsset(0, { payload: new ArrayBuffer(0) });
    plugin._candidateAssetRevision = currentRevision;
    plugin.onWasmAssetState(0, 4, oldRevision);
    assert.equal(plugin._assetState, 0);
    plugin.onWasmAssetState(0, 3, currentRevision);
    assert.equal(plugin._assetState, 3);
    plugin.cleanup();
});

test('superseded designer result is ignored before asset staging', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const first = deferred();
    const second = deferred();
    let calls = 0;
    plugin.measurementId = 'measurement-1';
    plugin._designer = {
        design() {
            calls += 1;
            return calls === 1 ? first.promise : second.promise;
        },
        close() {}
    };
    plugin._getRuntime = async () => ({});
    plugin._getMeasurementStore = async () => ({});
    plugin._sourcesFor = async () => ({ sources: [{}], resolved: [true] });
    const staged = [];
    plugin._stageDesign = async result => {
        staged.push(result.marker);
        return true;
    };

    plugin._designGeneration = 1;
    const oldDesign = plugin._designAndStage(1);
    await flushUntil(() => calls >= 1);
    plugin._designGeneration = 2;
    const currentDesign = plugin._designAndStage(2);
    await flushUntil(() => calls >= 2);
    first.resolve({ marker: 'old', qualityWarnings: [] });
    assert.equal(await oldDesign, false);
    second.resolve({ marker: 'current', qualityWarnings: [] });
    assert.equal(await currentDesign, true);
    assert.deepEqual(staged, ['current']);
    plugin.cleanup();
});

test('restored Room EQ measurement reaches a missing terminal state when no store exists', async () => {
    const { Plugin, context } = loadPlugin();
    const plugin = new Plugin();
    plugin.setSerializedParameters({ ms: 'missing-id', mn: 'Saved listening seat' });
    clearTimeout(plugin._designTimer);
    plugin._designTimer = null;
    const generation = plugin._designGeneration;
    plugin._lastDesign = { payload: new ArrayBuffer(36) };
    plugin.setWasmAsset(0, { payload: new ArrayBuffer(36) });
    plugin._getRuntime = async () => ({});
    plugin._getMeasurementStore = async () => null;

    const select = {
        children: [],
        value: '',
        replaceChildren() { this.children = []; },
        appendChild(child) { this.children.push(child); }
    };
    const status = { textContent: '', dataset: {} };
    context.document.createElement = () => ({ value: '', textContent: '' });
    plugin._measurementRow = { select, status };

    assert.equal(await plugin._designAndStage(generation), false);
    await plugin._renderMeasurement();

    assert.equal(plugin.asset, null);
    assert.equal(plugin.measurementResolved, false);
    assert.equal(plugin._designPending, false);
    assert.equal(plugin._assetState, 0);
    assert.equal(plugin.externalAssetInfo.missing, true);
    assert.equal(plugin.externalAssetInfo.pending, false);
    assert.equal(plugin._statusState, 'warning');
    const missing = select.children.find(option => option.value === 'missing-id');
    assert.ok(missing);
    assert.match(missing.textContent, /Saved listening seat/);
    assert.equal(select.value, 'missing-id');
    assert.equal(status.dataset.state, 'warning');
    plugin.cleanup();
});

test('offline Room EQ provisionally requires any selected measurement', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    assert.equal(plugin.offlineDspAssetRequired, false);
    const unselected = await plugin.createOfflineDspState({
        sampleRate: 48000,
        outputChannelCount: 2
    });
    assert.equal(unselected.offlineDspAssetRequired, false);
    plugin.measurementId = 'listening-seat';
    assert.equal(plugin.offlineDspAssetRequired, true);
    assert.equal(plugin.isOfflineDspAssetRequired({ outputChannelCount: 8 }), true);
    assert.equal(plugin.offlineDspAssetErrorMessageKey, 'roomEq.error.design');
    plugin.cleanup();
});

test('offline Room EQ bypasses missing measurements without designing a unit FIR', async () => {
    const scenarios = [
        {
            name: 'measurement store unavailable',
            store: null,
            sourceState: null
        },
        {
            name: 'selected measurement missing',
            store: {},
            sourceState: {
                sources: [null],
                resolved: false,
                supportsFullPhase: false
            }
        }
    ];

    for (const scenario of scenarios) {
        const { Plugin } = loadPlugin();
        const plugin = new Plugin();
        plugin.measurementId = 'missing-measurement';
        let designCalls = 0;
        let sourceCalls = 0;
        plugin._getRuntime = async () => ({
            createRoomEqDesigner() {
                designCalls += 1;
                return { design() {}, close() {} };
            }
        });
        plugin._getMeasurementStore = async () => scenario.store;
        plugin._sourcesFor = async () => {
            sourceCalls += 1;
            return scenario.sourceState;
        };

        const requirement = await plugin.resolveOfflineDspAssetRequirement();
        const state = await plugin.createOfflineDspState({
            sampleRate: 48000,
            outputChannelCount: 2,
            offlineDspAssetRequirement: requirement
        });

        assert.equal(requirement.required, false, scenario.name);
        assert.equal(state.assets.size, 0, scenario.name);
        assert.equal(state.offlineDspAssetRequired, false, scenario.name);
        assert.equal(plugin.offlineDspAssetRequired, true, scenario.name);
        assert.equal(designCalls, 0, scenario.name);
        assert.equal(sourceCalls, scenario.store ? 1 : 0, scenario.name);
        plugin.cleanup();
    }
});

test('measurement refresh renders the empty choice when its store is unavailable', async () => {
    const { Plugin, context } = loadPlugin();
    const plugin = new Plugin();
    const select = {
        children: [],
        value: '',
        replaceChildren() { this.children = []; },
        appendChild(child) { this.children.push(child); }
    };
    const status = { textContent: '', dataset: {} };
    context.document.createElement = () => ({ value: '', textContent: '' });
    plugin._measurementRow = { select, status };
    plugin._getMeasurementStore = async () => null;
    let designSchedules = 0;
    plugin._scheduleDesign = () => { designSchedules += 1; };

    await plugin._refreshMeasurements(true);

    assert.equal(select.children.length, 1);
    assert.equal(select.children[0].value, '');
    assert.equal(select.value, '');
    assert.equal(status.dataset.state, 'ready');
    assert.equal(designSchedules, 0);
    plugin.cleanup();
});

test('full phase preflight only checks the selected measurement', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin.measurementId = 'impulse';
    const store = {
        async getMeasurement(id) {
            return {
                id,
                averageFrequencyResponse: [[1000, 0]],
                points: [{ pointId: 7 }]
            };
        },
        async getImpulseResponses(id) {
            return id === 'impulse'
                ? [{ pointId: 7, data: new Float32Array([1]) }]
                : [];
        }
    };

    const preflight = await plugin._sourcesFor(store);
    assert.equal(preflight.supportsFullPhase, true);
    assert.equal(preflight.sources.length, 1);
    plugin.cleanup();
});

test('Room EQ orders complete impulse responses and falls back on a partial selected IR', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin.measurementId = 'complete';
    const measurements = {
        complete: {
            id: 'complete',
            points: [{ pointId: 11 }, { pointId: 4 }],
            averageFrequencyResponse: [[1000, -2]]
        },
        partial: {
            id: 'partial',
            points: [{ pointId: 8 }, { pointId: 3 }],
            averageFrequencyResponse: [[1000, -4]]
        }
    };
    const impulses = {
        complete: [
            { pointId: 4, data: new Float32Array([0.4]) },
            { pointId: 11, data: new Float32Array([1.1]) }
        ],
        partial: [{ pointId: 3, data: new Float32Array([0.3]) }]
    };
    const store = {
        async getMeasurement(id) { return measurements[id]; },
        async getImpulseResponses(id) { return impulses[id]; }
    };

    const result = await plugin._sourcesFor(store);
    assert.deepEqual(result.sources[0].impulses.map(impulse => impulse.pointId), [11, 4]);
    assert.equal(result.supportsFullPhase, true);
    plugin.measurementId = 'partial';
    const partial = await plugin._sourcesFor(store);
    assert.equal(partial.sources[0].impulses.length, 0);
    assert.equal(partial.sources[0].measurement.averageFrequencyResponse[0][1], -4);
    assert.equal(partial.supportsFullPhase, false);
    plugin.cleanup();
});

test('Room EQ stages one mono IR for every channel in the selected host bus', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin.tp = 8192;
    plugin.channel = 'A';
    plugin._outputChannelCount = 6;
    const result = { payload: new ArrayBuffer(32 + plugin.tp * 4) };
    plugin._lastDesign = result;
    plugin._getRuntime = async () => ({
        IR_ASSET_TOPOLOGY: { mono: 1 },
        selectedIrChannelCount: () => 6,
        estimateIrKernelCommitFootprint: () => result.payload.byteLength
    });

    assert.equal(await plugin._stageDesign(result), true);
    const candidateRevision = plugin._candidateAssetRevision;
    assert.equal(plugin.asset.descriptor.processingChannels, 6);
    assert.equal(plugin.getParameters().ce, undefined);
    plugin.onWasmAssetState(0, 3, candidateRevision - 1);
    assert.equal(plugin._designStaged, false);
    plugin.onWasmAssetState(0, 2, candidateRevision);
    assert.equal(plugin._designStaged, false);
    plugin.onWasmAssetState(0, 3, candidateRevision);
    assert.equal(plugin._designStaged, true);
    assert.equal(plugin._candidateAssetRevision, null);
    plugin.cleanup();
});

test('rejected replacement cannot reactivate a retained predecessor under the new configuration', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin.tp = 8192;
    const first = { payload: new ArrayBuffer(32 + plugin.tp * 4) };
    plugin._lastDesign = first;
    plugin._getRuntime = async () => ({
        IR_ASSET_TOPOLOGY: { mono: 1 },
        selectedIrChannelCount: () => 2,
        estimateIrKernelCommitFootprint: () => first.payload.byteLength
    });
    await plugin._stageDesign(first);
    const firstRevision = plugin._candidateAssetRevision;
    plugin.onWasmAssetState(0, 3, firstRevision);
    assert.equal(plugin._designStaged, true);

    const replacement = { payload: first.payload.slice(0) };
    plugin._lastDesign = replacement;
    await plugin._stageDesign(replacement);
    const replacementRevision = plugin._candidateAssetRevision;
    assert.equal(plugin._designStaged, false);
    plugin.onWasmAssetRejected(0, 'capacity', replacementRevision, {
        residentRetained: true,
        retainedOperationRevision: firstRevision,
        retainedAssetState: 3
    });
    assert.equal(plugin._designStaged, false);
    plugin._wasmAssetOperationRevisions.set(0, firstRevision);
    plugin.onWasmAssetState(0, 3, firstRevision);
    assert.equal(plugin._designStaged, false);
    assert.equal(plugin._assetState, 4);
    plugin.cleanup();
});

test('cleanup closes a measurement store that opens after disposal and prevents resurrection', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const opening = deferred();
    let closeCalls = 0;
    let openStarted = false;
    const store = { async close() { closeCalls += 1; } };
    plugin._getRuntime = async () => ({
        openMeasurementStore() {
            openStarted = true;
            return opening.promise;
        }
    });

    const pending = plugin._getMeasurementStore();
    await flushUntil(() => openStarted);
    plugin.cleanup();
    opening.resolve(store);
    assert.equal(await pending, null);
    assert.equal(closeCalls, 1);
    assert.equal(plugin._measurementStore, null);
});

test('cleanup invalidates a deferred design before it can stage or render', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const designed = deferred();
    let staged = 0;
    let rendered = 0;
    plugin.measurementId = 'measurement-1';
    plugin._designer = { design: () => designed.promise, close() {} };
    plugin._getRuntime = async () => ({});
    plugin._getMeasurementStore = async () => ({});
    plugin._sourcesFor = async () => ({
        sources: [{}],
        resolved: true,
        supportsFullPhase: true
    });
    plugin._stageDesign = async () => { staged += 1; return true; };
    plugin._renderMeasurement = () => { rendered += 1; };
    plugin._designGeneration = 1;

    const pending = plugin._designAndStage(1);
    await flushUntil(() => true);
    plugin.cleanup();
    designed.resolve({ payload: new ArrayBuffer(0), supportsFullPhase: true, qualityWarnings: [] });
    assert.equal(await pending, false);
    assert.equal(staged, 0);
    assert.equal(rendered, 0);
});

test('restored full phase without IR reports the Correction requirement before design', async () => {
    const { Plugin, context } = loadPlugin();
    context.window.uiManager = {
        t: key => key === 'roomEq.error.directPhaseRequiresIr'
            ? 'Correction requires IR data.'
            : 'The Room EQ filters could not be designed.'
    };
    const plugin = new Plugin();
    plugin.setSerializedParameters({ pm: 'full', ms: 'legacy' });
    let designCalls = 0;
    plugin._designer = {
        async design() {
            designCalls += 1;
            return { payload: new ArrayBuffer(0), supportsFullPhase: false, qualityWarnings: [] };
        },
        close() {}
    };
    plugin._getRuntime = async () => ({});
    plugin._getMeasurementStore = async () => ({});
    plugin._sourcesFor = async () => ({
        sources: [{ measurement: {}, impulses: [] }],
        resolved: true,
        supportsFullPhase: false
    });
    plugin._designGeneration = 1;

    assert.equal(await plugin._designAndStage(1), false);
    assert.equal(designCalls, 0);
    assert.equal(plugin._designStaged, false);
    assert.equal(plugin._lastDesign, null);
    assert.equal(plugin.asset, null);
    assert.equal(plugin._statusMessage, 'Correction requires IR data.');
    plugin.cleanup();
});

test('offline full phase reports the selected measurement without IR before design', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    plugin.pm = 'full';
    plugin.measurementId = 'legacy';
    let designCalls = 0;
    plugin._getRuntime = async () => ({
        createRoomEqDesigner: () => ({
            design() {
                designCalls += 1;
                return Promise.resolve({ payload: new ArrayBuffer(0), supportsFullPhase: false });
            },
            close() {}
        })
    });
    plugin._getMeasurementStore = async () => ({});
    plugin._sourcesFor = async () => ({
        sources: [{ measurement: {}, impulses: [] }],
        resolved: true,
        supportsFullPhase: false
    });

    await assert.rejects(
        plugin.createOfflineDspState({ sampleRate: 48000, outputChannelCount: 4 }),
        error => error?.userMessageKey === 'roomEq.error.directPhaseRequiresIr'
    );
    assert.equal(designCalls, 0);
    assert.equal(plugin.asset, undefined);
    plugin.cleanup();
});

test('offline Room EQ warmup includes filter delay for Linear and Correction', async () => {
    const { Plugin } = loadPlugin();
    for (const [phase, expectedFilterDelay] of [['min', 0], ['lin', 4096], ['full', 4096]]) {
        const plugin = new Plugin();
        plugin.pm = phase;
        plugin.tp = 8192;
        plugin.lt = '128';
        plugin.measurementId = 'measurement-1';
        const payload = new ArrayBuffer(32 + plugin.tp * 4);
        plugin._getRuntime = async () => ({
            IR_ASSET_TOPOLOGY: { mono: 1 },
            selectedIrChannelCount: () => 1,
            createRoomEqDesigner: () => ({
                design: async () => ({ payload, supportsFullPhase: true }),
                close() {}
            }),
            estimateIrKernelCommitFootprint: () => 1024 * 1024
        });
        plugin._getMeasurementStore = async () => ({});
        plugin._sourcesFor = async () => ({
            sources: [{}],
            resolved: true,
            supportsFullPhase: true
        });

        const requirement = await plugin.resolveOfflineDspAssetRequirement();
        const state = await plugin.createOfflineDspState({
            sampleRate: 48000,
            outputChannelCount: 1,
            offlineDspAssetRequirement: requirement
        });
        assert.equal(requirement.required, true);
        assert.equal(state.offlineDspAssetRequired, true);
        assert.equal(state.assets.get(0).warmupSamples, 128 + expectedFilterDelay);
        plugin.cleanup();
    }
});

test('offline Room EQ closes its worker and fails closed when an awaited design snapshot is stale', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const designed = deferred();
    const seen = {};
    let closeCalls = 0;
    plugin.measurementId = 'measurement-old';
    plugin._getRuntime = async () => ({
        IR_ASSET_TOPOLOGY: { mono: 1 },
        selectedIrChannelCount: () => 1,
        createRoomEqDesigner: () => ({
            design(config, sources) {
                seen.config = config;
                seen.sources = sources;
                return designed.promise;
            },
            close() { closeCalls += 1; }
        }),
        estimateIrKernelCommitFootprint: () => 1024
    });
    plugin._getMeasurementStore = async () => ({});
    plugin._sourcesFor = async (_store, _current, measurementId) => {
        seen.measurementId = measurementId;
        return {
            sources: [{ measurement: { id: measurementId }, impulses: [] }],
            resolved: true,
            supportsFullPhase: true
        };
    };

    const requirement = await plugin.resolveOfflineDspAssetRequirement();
    const pending = plugin.createOfflineDspState({
        sampleRate: 48000,
        outputChannelCount: 1,
        offlineDspAssetRequirement: requirement
    });
    await flushUntil(() => seen.config);
    plugin.setParameters({ sm: 0.25, ms: 'measurement-new' });
    designed.resolve({ payload: new ArrayBuffer(36), supportsFullPhase: true });
    await assert.rejects(pending, error => error?.userMessageKey === 'roomEq.error.design');
    assert.equal(seen.config.smoothing, 0.17);
    assert.equal(seen.measurementId, 'measurement-old');
    assert.equal(closeCalls, 1);
    plugin.cleanup();
});

test('offline Room EQ uses the packed parameter snapshot captured before worker design', async () => {
    const { Plugin } = loadPlugin();
    const plugin = new Plugin();
    const designed = deferred();
    plugin.measurementId = 'measurement-1';
    plugin.delayMs = 1;
    plugin.gn = 2;
    plugin._getRuntime = async () => ({
        IR_ASSET_TOPOLOGY: { mono: 1 },
        selectedIrChannelCount: () => 1,
        createRoomEqDesigner: () => ({ design: () => designed.promise, close() {} }),
        estimateIrKernelCommitFootprint: () => 1024
    });
    plugin._getMeasurementStore = async () => ({});
    plugin._sourcesFor = async () => ({
        sources: [{}],
        resolved: true,
        supportsFullPhase: true
    });

    const pending = plugin.createOfflineDspState({ sampleRate: 48000, outputChannelCount: 1 });
    await Promise.resolve();
    plugin.setParameters({ gn: -4, dl: 3 });
    designed.resolve({ payload: new ArrayBuffer(36), supportsFullPhase: true });
    const state = await pending;
    assert.equal(state.parameters.gn, 2);
    assert.equal(state.parameters.dy, 48);
    assert.equal(state.parameters.ce, undefined);
    plugin.cleanup();
});
