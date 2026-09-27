import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { frequencyAxisSource } from '../helpers/spectrum-overlay-harness.mjs';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginPath = path.join(repoRoot, 'plugins', 'analyzer', 'pitch_meter.js');
const payloadBytes = 44;

class FakeElement {
    constructor(tagName, context = null) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.style = {};
        this.attributes = new Map();
        this.listeners = new Map();
        if (this.tagName === 'CANVAS') {
            this.width = 800;
            this.height = 360;
            this.getContext = () => context;
        }
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    dispatchEvent(type, event = {}) {
        this.listeners.get(type)?.({ target: this, ...event });
    }
}

function createPluginBase() {
    return class PluginBase {
        constructor(name, description) {
            this.name = name;
            this.description = description;
            this.enabled = true;
            this._sectionEnabled = true;
            this._syncedUIControls = [];
            this._messageHandlerWorkletNode = null;
        }

        registerProcessor(processor) { this.processor = processor; }
        _setupMessageHandler() {}
        onMessage(message) { this.lastMessage = message; }
        updateParameters() { this.updateCount = (this.updateCount || 0) + 1; }
        cleanup() { this.cleanedUp = true; }
        canRunAnimation() { return true; }
        renderPowerUiOnce(callback) { callback(); }
        requestPowerAnimationFrame() { return 1; }

        parseFiniteNumber(value, minimum, maximum, fallback) {
            const number = Number(value);
            if (!Number.isFinite(number)) return fallback;
            return number < minimum ? minimum : (number > maximum ? maximum : number);
        }

        _registerUIControl(modelKey, elements, apply) {
            this._syncedUIControls.push({ modelKey, elements, apply });
        }

        syncUIControls() {
            for (const control of this._syncedUIControls) control.apply(this[control.modelKey]);
        }
    };
}

function createCanvasContext() {
    const calls = [];
    let depth = 0;
    return {
        calls,
        fillRect(...args) { calls.push(['fillRect', depth, ...args]); },
        beginPath() { calls.push(['beginPath', depth]); },
        moveTo(...args) { calls.push(['moveTo', depth, ...args]); },
        lineTo(...args) { calls.push(['lineTo', depth, ...args]); },
        stroke() { calls.push(['stroke', depth]); },
        rect() {}, fill() {}, createLinearGradient: () => ({ addColorStop() {} }),
        save() { depth++; calls.push(['save', depth]); },
        restore() { calls.push(['restore', depth]); depth--; },
        translate(...args) { calls.push(['translate', depth, ...args]); },
        rotate(angle) { calls.push(['rotate', depth, angle]); },
        fillText(text, ...args) { calls.push(['fillText', depth, text, ...args]); },
        measureText(text) { return { width: text.length * parseFloat(this._font) * 0.6 }; },
        set fillStyle(value) { this._fillStyle = value; },
        get fillStyle() { return this._fillStyle; },
        set strokeStyle(value) { this._strokeStyle = value; },
        set lineWidth(value) { this._lineWidth = value; },
        set globalAlpha(value) { this._globalAlpha = value; },
        set font(value) { this._font = value; },
        set textAlign(value) { this._textAlign = value; },
        set textBaseline(value) { this._textBaseline = value; }
    };
}

const FrequencyAxis = (() => {
    const window = {};
    vm.runInNewContext(frequencyAxisSource, { window });
    return window.FrequencyAxis;
})();

async function loadPlugin({ telemetryHub = null, audioContext = null } = {}) {
    const source = await fs.readFile(pluginPath, 'utf8');
    const noteSource = await fs.readFile(path.join(repoRoot, 'plugins', 'analyzer', 'note_spectrogram.js'), 'utf8');
    const spectrogramSource = await fs.readFile(path.join(repoRoot, 'plugins', 'analyzer', 'spectrogram.js'), 'utf8');
    const context = vm.createContext({
        PluginBase: createPluginBase(),
        document: { createElement: tagName => new FakeElement(tagName) },
        performance: { now: () => 0 },
        window: {
            audioContext,
            dspTelemetryHub: telemetryHub,
            ThemePalette: { get: name => `theme-${name}` }
        }
    });
    vm.runInContext(frequencyAxisSource, context, { filename: 'frequency-axis.js' });
    vm.runInContext(noteSource, context, { filename: 'note_spectrogram.js' });
    vm.runInContext(spectrogramSource, context, { filename: 'spectrogram.js' });
    vm.runInContext(source, context, { filename: pluginPath });
    assert.equal(typeof context.window.PitchMeterPlugin, 'function');
    return new context.window.PitchMeterPlugin();
}

function telemetryFrame({
    frameType = 26,
    formatVersion = 1,
    sampleRate = 48000,
    timeSeconds = 1,
    hopSeconds = 0.01,
    frameIndex = 0,
    generation = 1,
    f0Hz = 440,
    midi = 69,
    cents = 0,
    confidence = 0.9,
    levelDb = -12,
    voiced = true,
    flags = voiced ? 1 : 0,
    reserved = 0
} = {}) {
    const payload = new DataView(new ArrayBuffer(payloadBytes));
    payload.setFloat32(0, sampleRate, true);
    payload.setFloat32(4, timeSeconds, true);
    payload.setFloat32(8, hopSeconds, true);
    payload.setUint32(12, frameIndex, true);
    payload.setUint32(16, generation, true);
    payload.setFloat32(20, f0Hz, true);
    payload.setFloat32(24, midi, true);
    payload.setFloat32(28, cents, true);
    payload.setFloat32(32, confidence, true);
    payload.setFloat32(36, levelDb, true);
    payload.setUint16(40, flags, true);
    payload.setUint16(42, reserved, true);
    return { frameType, formatVersion, payload };
}

test('Pitch Meter exposes its compact parameter contract and UI controls', async () => {
    const plugin = await loadPlugin();
    assert.equal(plugin.name, 'Pitch Meter');
    assert.equal(plugin.processor, 'return data;');
    assert.equal(plugin.constructor.executionCapabilities.requiresWasm, true);
    assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
        type: 'PitchMeterPlugin', enabled: true, rf: 440, mn: 36, mx: 96, ly: 'Horizontal', cl: 'Normal'
    });

    plugin.setParameters({ rf: 500, mn: 12, mx: 120, ly: 'Vertical' });
    assert.deepEqual([plugin.rf, plugin.mn, plugin.mx, plugin.ly], [480, 21, 108, 'Vertical']);
    plugin.setParameters({ cl: 'Heatmap' });
    assert.equal(plugin.getParameters().cl, 'Heatmap');
    plugin.setParameters({ rf: 'invalid', ly: 'Diagonal' });
    assert.deepEqual([plugin.rf, plugin.ly], [480, 'Vertical']);
    plugin.reset();
    assert.deepEqual([plugin.rf, plugin.mn, plugin.mx, plugin.ly], [440, 36, 96, 'Horizontal']);
    assert.equal(plugin.cl, 'Normal');

    const rows = [];
    plugin.createRadioGroup = (label, options, value, setter, modelKey) => {
        const row = { label, options, value, setter, modelKey };
        rows.push(row);
        return row;
    };
    plugin.createParameterControl = (label, minimum, maximum, step, value, setter, unit, modelKey) => {
        const row = { label, minimum, maximum, step, value, setter, unit, modelKey };
        rows.push(row);
        return row;
    };
    plugin.createNoteRangeControl = (label, value, setter, modelKey) => {
        const row = { label, value, setter, modelKey };
        rows.push(row);
        return row;
    };
    const canvas = new FakeElement('canvas', createCanvasContext());
    let graphOptions;
    plugin.createResponsiveGraph = options => {
        graphOptions = options;
        return { canvas, container: new FakeElement('div'), dispose() {} };
    };
    plugin.createUI();
    assert.deepEqual(rows.map(row => row.label), [
        'Color', 'Layout', 'Reference A4', 'Lowest Note', 'Highest Note'
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(rows[0].options)), [
        { value: 'Normal', label: 'Normal' },
        { value: 'Heatmap', label: 'Heatmap' },
        { value: 'Rainbow', label: 'Note Colors' }
    ]);
    assert.deepEqual(Array.from(rows[1].options), ['Vertical', 'Horizontal']);
    assert.deepEqual(
        [rows[2].minimum, rows[2].maximum, rows[2].step, rows[2].unit],
        [400, 480, 1, 'Hz']
    );
    assert.deepEqual([graphOptions.maxWidth, graphOptions.aspectRatio, graphOptions.mobileAspectRatio],
        [1024, '32 / 15', '4 / 3']);
    assert.equal(canvas.attributes.get('aria-label'), 'Single-note pitch history');
});

test('Pitch Meter validates telemetry and keeps only ordered frames from the newest generation', async () => {
    const plugin = await loadPlugin();
    const first = telemetryFrame({ frameIndex: 10, generation: 3 });
    assert.deepEqual(JSON.parse(JSON.stringify(plugin.parseTelemetryFrame(first))), {
        sampleRate: 48000,
        timeSeconds: 1,
        hopSeconds: Math.fround(0.01),
        frameIndex: 10,
        generation: 3,
        f0Hz: 440,
        midi: 69,
        cents: 0,
        confidence: Math.fround(0.9),
        levelDb: -12,
        voiced: true
    });
    assert.equal(plugin.parseTelemetryFrame({ ...first, frameType: 25 }), null);
    assert.equal(plugin.parseTelemetryFrame({ ...first, formatVersion: 2 }), null);
    assert.equal(plugin.parseTelemetryFrame({ ...first,
        payload: new DataView(new ArrayBuffer(payloadBytes - 1)) }), null);
    assert.equal(plugin.parseTelemetryFrame(telemetryFrame({ midi: 20.9 }))?.midi,
        Math.fround(20.9));
    assert.equal(plugin.parseTelemetryFrame(telemetryFrame({ midi: 108.1 }))?.midi,
        Math.fround(108.1));
    assert.equal(plugin.parseTelemetryFrame(telemetryFrame({ midi: 20.49 })), null);
    assert.equal(plugin.parseTelemetryFrame(telemetryFrame({ midi: 108.51 })), null);
    assert.equal(plugin.parseTelemetryFrame(telemetryFrame({ voiced: false, flags: 0 })), null);
    assert.equal(plugin.parseTelemetryFrame(telemetryFrame({ flags: 3 })), null);

    plugin.handleTelemetry(first);
    assert.equal(plugin.writeColumn, 1);
    assert.equal(plugin.pitchHistory[0], 69);
    assert.equal(plugin.currentNote, 'A4');
    assert.equal(plugin.currentCents, '+0.0 cent');
    plugin.handleTelemetry(first);
    assert.equal(plugin.writeColumn, 1, 'duplicate frame is ignored');

    plugin.handleTelemetry(telemetryFrame({
        timeSeconds: 1.01, frameIndex: 11, generation: 3,
        f0Hz: 0, midi: 0, cents: 0, confidence: 0, voiced: false, flags: 0
    }));
    assert.equal(plugin.writeColumn, 6);
    assert.equal(plugin.voicedHistory[5], 0);
    assert.equal(plugin.currentNote, '');
    assert.equal(plugin.currentCents, '');

    plugin.handleTelemetry(telemetryFrame({
        timeSeconds: 1.02, frameIndex: 0, generation: 4,
        f0Hz: 523.251, midi: 72, cents: 0.2, confidence: 0.8
    }));
    assert.equal(plugin.writeColumn, 1);
    assert.equal(plugin.pitchHistory[0], 72);
    assert.equal(plugin.activeGeneration, 4);
    plugin.handleTelemetry(telemetryFrame({ frameIndex: 12, generation: 3 }));
    assert.equal(plugin.pitchHistory[0], 72, 'late frame from old generation is ignored');
});

test('Pitch Meter uses Note Spectrogram volume normalization for Heatmap line color', async () => {
    const plugin = await loadPlugin();
    plugin.handleTelemetry(telemetryFrame({ frameIndex: 0, levelDb: -12 }));
    assert.equal(plugin.volumeHistory[0], 1);
    plugin.handleTelemetry(telemetryFrame({ frameIndex: 1, timeSeconds: 1.01, levelDb: -36 }));
    const latestColumn = (plugin.writeColumn + 1023) % 1024;
    assert.equal(plugin.volumeHistory[latestColumn], 0);
    const palette = plugin._displayPalette();
    plugin.setParameters({ cl: 'Heatmap' });
    assert.equal(plugin._lineColor(69, 0, palette), 'rgb(0, 0, 0)');
    assert.equal(plugin._lineColor(69, 1, palette), 'rgb(191, 191, 191)');
    plugin.setParameters({ cl: 'Rainbow' });
    assert.equal(plugin._lineColor(69, 0, palette), 'rgb(129, 107, 168)');
    assert.equal(plugin.volumeHistory[0], 1, 'changing color retains history');
});

test('Pitch Meter subscribes to frame 26 and keeps horizontal labels upright', async () => {
    const subscriptions = [];
    let unsubscribed = 0;
    const hub = {
        subscribe(tapId, frameType, callback) {
            subscriptions.push({ tapId, frameType, callback });
            return () => { unsubscribed++; };
        }
    };
    const plugin = await loadPlugin({ telemetryHub: hub });
    plugin.id = 17;
    assert.equal(plugin.ensureDspTelemetrySubscription(), true);
    assert.deepEqual(subscriptions.map(({ tapId, frameType }) => ({ tapId, frameType })), [
        { tapId: 17, frameType: 26 }
    ]);

    const context = createCanvasContext();
    plugin.canvas = new FakeElement('canvas', context);
    plugin.canvasCtx = context;
    plugin.handleTelemetry(telemetryFrame());
    plugin.storeHistoryColumn(0, 69, 0.8, true);
    plugin.storeHistoryColumn(1, 69.1, 0.9, true);
    plugin.writeColumn = 2;
    plugin.drawGraph();
    assert.ok(context.calls.some(call => call[0] === 'rotate' && call[2] === Math.PI / 2));
    assert.ok(context.calls.some(call => call[0] === 'fillText' &&
        call[1] === 0 && call[2] === 'A4'));
    assert.ok(context.calls.some(call => call[0] === 'fillText' &&
        call[1] === 0 && call[2] === '+0.0 cent'));

    context.calls.length = 0;
    plugin.setParameters({ ly: 'Vertical' });
    plugin.drawGraph();
    assert.equal(context.calls.some(call => call[0] === 'rotate'), false);
    plugin.cleanup();
    assert.equal(unsubscribed, 1);
});

test('Pitch Meter uses continuous white keys with black overlays in both layouts', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ mn: 21, mx: 108 });
    for (const layout of ['Vertical', 'Horizontal']) {
        const context = createCanvasContext();
        plugin.canvas = new FakeElement('canvas', context);
        plugin.canvasCtx = context;
        plugin.setParameters({ ly: layout });
        plugin.drawGraph();

        const horizontal = layout === 'Horizontal';
        const width = horizontal ? plugin.canvas.height : plugin.canvas.width;
        const height = horizontal ? plugin.canvas.width : plugin.canvas.height;
        const { gutter, blackDepth } = FrequencyAxis.keyboardDepths(12 * height / 88, width);
        const rollWidth = width - gutter;
        const whiteKeys = context.calls
            .filter(call => call[0] === 'fillRect' && call[2] === rollWidth && call[4] === gutter)
            .map(call => [call[3], call[3] + call[5]])
            .sort((left, right) => left[0] - right[0]);
        const blackKeys = context.calls.filter(call =>
            call[0] === 'fillRect' && call[2] === rollWidth && call[4] === blackDepth
        );
        assert.ok(whiteKeys.length > 0);
        assert.ok(blackKeys.length > 0);
        assert.equal(whiteKeys[0][0], 0);
        let coveredUntil = 0;
        for (const [start, end] of whiteKeys) {
            assert.ok(start <= coveredUntil + 1e-9, `${layout} white-key gap at ${start}`);
            if (end > coveredUntil) coveredUntil = end;
        }
        assert.ok(Math.abs(coveredUntil - height) < 1e-9);
        assert.ok(blackKeys.every(call => call[5] === height / 88));
    }

    const context = createCanvasContext();
    plugin.canvas = new FakeElement('canvas', context);
    plugin.canvasCtx = context;
    plugin.setParameters({ ly: 'Vertical' });
    plugin.storeHistoryColumn(0, 20.9, 0.8, true);
    plugin.storeHistoryColumn(1, 21.1, 0.9, true);
    plugin.writeColumn = 2;
    plugin.drawGraph();
    const edgeTrace = context.calls.filter(call => call[0] === 'lineTo')
        .find(call => call[3] > plugin.canvas.height * 0.99);
    assert.ok(edgeTrace, 'fractional pitch remains visible inside the bottom half-row');
});
