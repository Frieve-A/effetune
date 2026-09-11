import { installThemePaletteStub } from '../helpers/theme-palette-stub.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginPath = path.join('plugins', 'analyzer', 'note_spectrogram.js');
const noteCount = 88;
const fineDivisions = 5;
const fineCenter = Math.floor(fineDivisions / 2);
const pitchCount = noteCount * fineDivisions;
const confidenceOffset = 28;
const volumeOffset = confidenceOffset + pitchCount * 4;
const payloadBytes = volumeOffset + pitchCount * 4;
const historyWidth = 1024;

function createGradient(type, coordinates) {
    return {
        type,
        coordinates,
        stops: [],
        addColorStop(offset, color) { this.stops.push({ offset, color }); }
    };
}

function styleSignature(style) {
    return typeof style === 'string' ? style : JSON.stringify(style);
}

class FakeElement {
    constructor(tagName, nullCanvasContext = false) {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.className = '';
        this.attributes = new Map();
        this.style = {};
        this.hidden = false;
        this.listeners = new Map();
        if (this.tagName === 'CANVAS') {
            this.getContext = () => nullCanvasContext ? null : {
                createImageData: (width, height) => ({
                    data: new Uint8ClampedArray(width * height * 4)
                }),
                putImageData() {},
                drawImage() {},
                fillRect() {},
                createLinearGradient: (...coordinates) => createGradient('linear', coordinates),
                createRadialGradient: (...coordinates) => createGradient('radial', coordinates)
            };
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
            this._messageHandlerWorkletNode = null;
            this._syncedUIControls = [];
        }

        _setupMessageHandler() {
            this.messageHandlerSetup = true;
            if (this._nextMessageHandlerWorkletNode !== undefined) {
                this._messageHandlerWorkletNode = this._nextMessageHandlerWorkletNode;
            }
        }

        onMessage(message) {
            this.lastMessage = message;
        }

        registerProcessor(processor) {
            this.processor = processor;
        }

        parseFiniteNumber(value, minimum, maximum, fallback) {
            const number = Number(value);
            if (!Number.isFinite(number)) return fallback;
            return number < minimum ? minimum : (number > maximum ? maximum : number);
        }

        updateParameters() {
            this.updateCount = (this.updateCount || 0) + 1;
        }

        cleanup() {
            this.cleanedUp = true;
        }

        _registerUIControl(modelKey, elements, apply) {
            if (modelKey) this._syncedUIControls.push({ modelKey, elements, apply });
        }

        syncUIControls() {
            for (const control of this._syncedUIControls) {
                control.apply(this[control.modelKey]);
            }
        }
    };
}

async function loadPlugin({ telemetryHub = null, audioContext = null, nullCanvasContext = false,
    now = 0, background = [0, 0, 0], soft = [34, 34, 34], trace = [0, 255, 0] } = {}) {
    const source = await fs.readFile(path.join(repoRoot, pluginPath), 'utf8');
    const window = { dspTelemetryHub: telemetryHub, audioContext };
    const document = {
        createElement: tagName => new FakeElement(tagName, nullCanvasContext)
    };
    const context = vm.createContext({
        PluginBase: createPluginBase(),
        document,
        window,
        performance: { now: () => typeof now === 'function' ? now() : now }
    });
    const palette = installThemePaletteStub(context.window);
    const originalGet = palette.get;
    palette.get = name => name === 'graph-bg-deep' ? `rgba(${background.join(', ')}, 1)`
        : name === 'graph-base-soft' ? `rgba(${soft.join(', ')}, 1)`
        : name === 'accent' ? 'rgba(26, 115, 232, 1)'
        : name === 'graph-trace' ? `rgba(${trace.join(', ')}, 1)` : originalGet(name);
    vm.runInContext(source, context, { filename: pluginPath });
    const Plugin = window.NoteSpectrogramPlugin;
    assert.equal(typeof Plugin, 'function');
    return new Plugin();
}

function createTelemetryFrame({
    frameIndex = 0,
    hopSeconds = 0.01,
    sampleRate = 48000,
    timeSeconds = 1,
    firstMidi = 21,
    mode = 'Fine Presence',
    generation = 1,
    levels = [],
    volumeLevels = []
} = {}) {
    const modeCode = mode === 'Fine Presence' ? fineDivisions :
        (mode === 'F0 Presence' ? 0 : (mode === 'Classic' ? 1 : mode));
    const defaultLevel = modeCode === fineDivisions ? 0 : -96;
    const payload = new DataView(new ArrayBuffer(payloadBytes));
    payload.setFloat32(0, sampleRate, true);
    payload.setFloat32(4, timeSeconds, true);
    payload.setUint16(8, pitchCount, true);
    payload.setUint16(10, firstMidi, true);
    payload.setFloat32(12, hopSeconds, true);
    payload.setUint32(16, frameIndex, true);
    payload.setUint32(20, modeCode, true);
    payload.setUint32(24, generation, true);
    for (let pitch = 0; pitch < pitchCount; pitch++) {
        payload.setFloat32(confidenceOffset + pitch * 4, levels[pitch] ?? defaultLevel, true);
        payload.setFloat32(volumeOffset + pitch * 4, volumeLevels[pitch] ?? -240, true);
    }
    return { frameType: 24, formatVersion: 3, payload };
}

function firstPitchByColumn(plugin, start, count) {
    const values = [];
    for (let column = start; column < start + count; column++) {
        values.push(plugin.history[(column % historyWidth) * pitchCount]);
    }
    return values;
}

function firstPitchPresenceBytesByColumn(plugin, start, count) {
    return firstPitchByColumn(plugin, start, count).map(value => Math.round(value * 255));
}

test('Note Spectrogram restores display preferences and defaults to a horizontal green keyboard', async () => {
    const plugin = await loadPlugin({ nullCanvasContext: true });
    assert.equal(plugin.name, 'Note Spectrogram');
    assert.equal(plugin.processor, 'return data;');
    assert.equal(plugin.constructor.executionCapabilities.requiresWasm, true);
    assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
        type: 'NoteSpectrogramPlugin', enabled: true, cl: 'Normal', pr: 'Semitone', ly: 'Horizontal', vl: true, ts: 2,
        mn: 28, mx: 91, nc: 8
    });
    plugin.setParameters({
        cl: 'Rainbow', pr: 'High', ly: 'Horizontal', vl: false, ts: 100,
        md: 'Classic', cf: 1, dr: -48
    });
    assert.equal(plugin.ts, 10);
    const restored = await loadPlugin();
    restored.setParameters(JSON.parse(JSON.stringify(plugin.getParameters())));
    assert.equal(restored.cl, 'Rainbow');
    assert.equal(restored.pr, 'High');
    assert.equal(restored.ly, 'Horizontal');
    assert.equal(restored.vl, false);
    assert.equal(restored.md, undefined);
    assert.equal(restored.cf, undefined);
    assert.equal(restored.dr, undefined);
    restored.setParameters({ cl: 'invalid', pr: 'invalid', ly: 'invalid', ts: 0 });
    assert.equal(restored.cl, 'Rainbow');
    assert.equal(restored.pr, 'High');
    assert.equal(restored.ly, 'Horizontal');
    assert.equal(restored.ts, 1);
    const legacy = await loadPlugin();
    legacy.setParameters({ rb: true, md: 'F0 Presence', cf: 0.9, dr: -96 });
    assert.equal(legacy.cl, 'Rainbow');
    assert.equal(legacy.pr, 'Semitone');
    assert.equal(legacy.vl, true);
    legacy.setParameters({ cl: 'Normal', rb: true });
    assert.equal(legacy.cl, 'Normal');
    plugin.reset();
    assert.equal(plugin.cl, 'Normal');
    assert.equal(plugin.pr, 'Semitone');
    assert.equal(plugin.ly, 'Horizontal');
    assert.equal(plugin.vl, true);
    assert.equal(plugin.ts, 2);
    assert.equal(plugin.mn, 28);
    assert.equal(plugin.mx, 91);
    assert.equal(plugin.nc, 8);
});

test('Note Spectrogram exposes display and note range controls', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ cl: 'Rainbow', ts: 8 });
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
    plugin.createCheckboxControl = (label, value, setter, modelKey) => {
        const row = { label, value, setter, modelKey };
        rows.push(row);
        return row;
    };
    plugin.createResponsiveGraph = () => ({
        canvas: new FakeElement('canvas'), container: new FakeElement('div'), dispose() {}
    });
    plugin.drawGraph = () => {};
    plugin.createUI();
    assert.deepEqual(rows.map(row => row.label), [
        'Color', 'Pitch Resolution', 'Layout', 'Volume', 'Time Span', 'Regular Note Limit',
        'Lowest Note', 'Highest Note'
    ]);
    const [color, resolution, layout, volume, timeSpan, regularCandidates, lowestNote, highestNote] = rows;
    assert.deepEqual(JSON.parse(JSON.stringify(color.options)), [
        { value: 'Normal', label: 'Normal' },
        { value: 'Rainbow', label: 'Note Colors' }
    ]);
    assert.equal(color.value, 'Rainbow');
    assert.equal(color.modelKey, 'cl');
    assert.deepEqual(JSON.parse(JSON.stringify(resolution.options)), [
        { value: 'Semitone', label: '1/12 Octave' },
        { value: 'High', label: 'High (1/60 Octave)' }
    ]);
    assert.equal(resolution.value, 'Semitone');
    assert.equal(resolution.modelKey, 'pr');
    resolution.setter('High');
    assert.equal(plugin.pr, 'High');
    resolution.setter('Semitone');
    assert.equal(plugin.pr, 'Semitone');
    assert.deepEqual(Array.from(layout.options), ['Vertical', 'Horizontal']);
    assert.equal(layout.value, 'Horizontal');
    assert.equal(layout.modelKey, 'ly');
    layout.setter('Horizontal');
    assert.equal(plugin.ly, 'Horizontal');
    layout.setter('Vertical');
    assert.equal(plugin.ly, 'Vertical');
    assert.equal(volume.value, true);
    assert.equal(volume.modelKey, 'vl');
    volume.setter(false);
    assert.equal(plugin.vl, false);
    assert.deepEqual([timeSpan.minimum, timeSpan.maximum, timeSpan.step, timeSpan.value], [1, 10, 1, 8]);
    color.setter('Normal');
    assert.equal(plugin.cl, 'Normal');
    color.setter('Rainbow');
    assert.equal(plugin.cl, 'Rainbow');
    timeSpan.setter(12);
    assert.equal(plugin.ts, 10);
    assert.deepEqual(
        [regularCandidates.minimum, regularCandidates.maximum, regularCandidates.step,
            regularCandidates.value, regularCandidates.unit, regularCandidates.modelKey],
        [1, 16, 1, 8, 'notes', 'nc']
    );
    regularCandidates.setter(20);
    assert.equal(plugin.nc, 16);
    plugin.setParameters({ nc: 0 });
    assert.equal(plugin.nc, 1);
    assert.deepEqual(
        [lowestNote.value, lowestNote.modelKey, highestNote.value, highestNote.modelKey],
        [28, 'mn', 91, 'mx']
    );
    lowestNote.setter(95);
    assert.deepEqual([plugin.mn, plugin.mx], [95, 95]);
    highestNote.setter(24);
    assert.deepEqual([plugin.mn, plugin.mx], [24, 24]);
});

test('recreating the UI repaints same-size Volume history with the current theme', async () => {
    const background = [255, 255, 255];
    const soft = [241, 241, 241];
    const plugin = await loadPlugin({ background, soft });
    const fills = [];
    const volumeContext = {
        createLinearGradient(...coordinates) { return createGradient('linear', coordinates); },
        fillRect(x, y, width, height) {
            fills.push({ x, y, width, height, color: this.fillStyle });
        }
    };
    plugin.mn = 21;
    plugin.mx = 21;
    plugin.volumeHistoryCanvas = {
        width: historyWidth,
        height: 100,
        getContext: () => volumeContext
    };
    plugin.createRadioGroup = () => new FakeElement('div');
    plugin.createCheckboxControl = () => new FakeElement('div');
    plugin.createParameterControl = () => new FakeElement('div');
    plugin.createNoteRangeControl = () => new FakeElement('div');
    plugin.createResponsiveGraph = () => ({
        canvas: new FakeElement('canvas'), container: new FakeElement('div'), dispose() {}
    });
    plugin.drawGraph = () => plugin._paintVolumeHistory(100, plugin._displayPalette());

    plugin.createUI();
    assert.ok(fills.some(fill => fill.color === 'rgb(255, 255, 255)'));
    assert.equal(plugin.volumeHistoryDirty, false);

    fills.length = 0;
    background.splice(0, background.length, 7, 11, 20);
    soft.splice(0, soft.length, 25, 33, 51);
    plugin.createUI();

    assert.equal(plugin.volumeHistoryCanvas.height, 100);
    assert.ok(fills.some(fill => fill.color === 'rgb(7, 11, 20)'));
    assert.equal(plugin.volumeHistoryDirty, false);
});

test('Note Spectrogram note range controls use sliders with read-only note names', async () => {
    const plugin = await loadPlugin();
    const row = plugin.createNoteRangeControl(
        'Lowest Note', plugin.mn, value => plugin.setParameters({ mn: value }), 'mn'
    );
    const [label, slider, noteName] = row.children;

    assert.equal(label.textContent, 'Lowest Note:');
    assert.deepEqual(
        [slider.type, slider.min, slider.max, slider.step, slider.value],
        ['range', 21, 108, 1, 28]
    );
    assert.deepEqual(
        [noteName.type, noteName.readOnly, noteName.value],
        ['text', true, 'E1']
    );
    assert.deepEqual(
        [noteName.style.width, noteName.style.boxSizing],
        ['80px', 'border-box']
    );

    slider.value = '60';
    slider.dispatchEvent('input');
    assert.equal(plugin.mn, 60);
    assert.equal(noteName.value, 'C4');

    plugin.setParameters({ mn: 108 });
    plugin.syncUIControls();
    assert.equal(slider.value, 108);
    assert.equal(noteName.value, 'C8');
});

test('Note Spectrogram validates its version 3 telemetry payload', async () => {
    const plugin = await loadPlugin();
    const levels = Array.from({ length: pitchCount }, (_, pitch) => pitch / (pitchCount - 1));
    const volumeLevels = Array.from({ length: pitchCount }, (_, pitch) => -120 + pitch / 10);
    const frame = createTelemetryFrame({
        frameIndex: 42, hopSeconds: 0.0125, generation: 7, levels, volumeLevels
    });
    const snapshot = plugin.parseTelemetryFrame(frame);

    assert.equal(snapshot.sampleRate, 48000);
    assert.equal(snapshot.timeSeconds, 1);
    assert.ok(Math.abs(snapshot.hopSeconds - 0.0125) < 1e-7);
    assert.equal(snapshot.frameIndex, 42);
    assert.equal(snapshot.modeCode, fineDivisions);
    assert.equal(snapshot.generation, 7);
    for (let pitch = 0; pitch < pitchCount; pitch++) {
        assert.ok(Math.abs(snapshot.levels[pitch] - levels[pitch]) < 1e-6);
        assert.ok(Math.abs(snapshot.volumeLevels[pitch] - volumeLevels[pitch]) < 1e-5);
    }

    assert.equal(plugin.parseTelemetryFrame({ ...frame, frameType: 23 }), null);
    assert.equal(plugin.parseTelemetryFrame({ ...frame, formatVersion: 1 }), null);
    assert.equal(plugin.parseTelemetryFrame({
        ...frame,
        payload: new DataView(new ArrayBuffer(payloadBytes - 4))
    }), null);
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({ firstMidi: 20 })), null);
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({ mode: 2 })), null);
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({ generation: 0 })), null);
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({ levels: [1.01] })), null);
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({ volumeLevels: [Infinity] })), null);
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({ mode: 'Classic' })), null);
});

test('Volume range stays stable while the current meter releases without a peak state', async () => {
    const plugin = await loadPlugin();
    const snapshot = (confidence, volume) => ({
        levels: Float32Array.from({ length: pitchCount }, (_, pitch) => pitch === 0 ? confidence : 0),
        volumeLevels: Float32Array.from({ length: pitchCount }, (_, pitch) => pitch === 0 ? volume : -240)
    });

    plugin._updateVolumeState(snapshot(1, -50), 0.01);
    assert.equal(plugin.levelReference, -50);
    assert.equal(plugin._normalizedLevel(-36), 1);
    assert.equal(plugin._normalizedLevel(-60), 0);

    plugin._updateVolumeState(snapshot(1, -20), 0.01);
    assert.equal(plugin.levelReference, -20);
    assert.equal(plugin.meterCurrent[0], -20);
    plugin._updateVolumeState(snapshot(1, -80), 0.5);
    assert.equal(plugin.levelReference, -20);
    assert.equal(plugin.meterCurrent[0], -30);
    plugin._updateVolumeState(snapshot(1, -80), 0.75);
    assert.equal(plugin.levelReference, -25);
    assert.equal(plugin.meterCurrent[0], -45);
    assert.equal('meterPeak' in plugin, false);
    plugin.clearHistory();
    assert.equal(plugin.levelReference, -240);
    assert.equal(plugin.levelReferenceHold, 0);
    assert.equal(plugin.meterCurrent[0], -240);
});

test('Volume history freezes normalized thickness when each column is written', async () => {
    const plugin = await loadPlugin();
    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 0, levels: [1], volumeLevels: [-48]
    }));
    assert.equal(plugin.levelHistory[0], 0.5);

    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 1, timeSeconds: 1.01, levels: [1], volumeLevels: [-12]
    }));
    assert.equal(plugin.levelReference, -12);
    assert.equal(plugin.levelHistory[0], 0.5);
});

test('Volume bars map level to thickness and pitch resolution to center position', async () => {
    const plugin = await loadPlugin();
    const fills = [];
    const context = {
        createLinearGradient(...coordinates) { return createGradient('linear', coordinates); },
        fillRect(x, y, width, height) { fills.push({ x, y, width, height, color: this.fillStyle }); }
    };
    plugin.volumeHistoryCanvas = { width: historyWidth, height: 100, getContext: () => context };
    plugin.mn = 21;
    plugin.mx = 21;
    plugin.pr = 'High';
    plugin.history[0] = 1;
    plugin.levelHistory[0] = 0;
    plugin.volumeHistoryDirty = true;
    plugin._paintVolumeHistory(100, plugin._displayPalette());
    let bar = fills.find(fill => fill.width === 1);
    assert.deepEqual([bar.y, bar.height], [70, 40]);
    assert.deepEqual(bar.color.stops.map(stop => stop.offset), [0, 0.25, 0.75, 1]);

    fills.length = 0;
    plugin.levelHistory[0] = 1;
    plugin.volumeHistoryDirty = true;
    plugin._paintVolumeHistory(100, plugin._displayPalette());
    bar = fills.find(fill => fill.width === 1);
    assert.deepEqual([bar.y, bar.height], [30.5, 119]);

    fills.length = 0;
    plugin.pr = 'Semitone';
    plugin.levelHistory[0] = 0;
    plugin.volumeHistoryDirty = true;
    plugin._paintVolumeHistory(100, plugin._displayPalette());
    bar = fills.find(fill => fill.width === 1);
    assert.deepEqual([bar.y, bar.height], [30, 40]);
});

test('incremental Volume redraw preserves High bars that cross a neighboring row', async () => {
    const plugin = await loadPlugin();
    const fills = [];
    const context = {
        createLinearGradient(...coordinates) { return createGradient('linear', coordinates); },
        fillRect(x, y, width, height) {
            fills.push({ x, y, width, height, color: styleSignature(this.fillStyle) });
        }
    };
    const rasterizeColumn = () => Array.from({ length: 20 }, (_, row) => {
        let color = null;
        for (const fill of fills) {
            if (fill.x <= 0.5 && 0.5 < fill.x + fill.width &&
                fill.y <= row + 0.5 && row + 0.5 < fill.y + fill.height) {
                color = fill.color;
            }
        }
        return color;
    });
    plugin.vl = true;
    plugin.pr = 'High';
    plugin.mn = 21;
    plugin.mx = 22;
    plugin.volumeHistoryCanvas = { width: historyWidth, height: 20, getContext: () => context };
    plugin.history[4] = 1;
    plugin.levelHistory[4] = 1;
    plugin.volumeHistoryDirty = true;
    plugin._paintVolumeHistory(20, plugin._displayPalette());
    const fullRedraw = rasterizeColumn();

    fills.length = 0;
    plugin._paintVolumeColumns(0, 1);
    assert.deepEqual(rasterizeColumn(), fullRedraw);
    assert.match(fullRedraw[8], /rgba\(0, 255, 0, 1\)/);
});

test('Volume backgrounds and guides precede confidence-sorted bars in every redraw path', async () => {
    const plugin = await loadPlugin();
    const fills = [];
    const context = {
        createLinearGradient(...coordinates) { return createGradient('linear', coordinates); },
        fillRect(x, y, width, height) {
            fills.push({ x, y, width, height, color: styleSignature(this.fillStyle) });
        }
    };
    plugin.vl = true;
    plugin.cl = 'Rainbow';
    plugin.mn = 24;
    plugin.mx = 25;
    plugin.graphDpr = 2;
    plugin.volumeHistoryCanvas = { width: historyWidth, height: 20, getContext: () => context };
    const cPitch = (24 - 21) * fineDivisions;
    const sharpPitch = (25 - 21) * fineDivisions;
    plugin.history[cPitch] = 0.8;
    plugin.history[sharpPitch] = 0.3;
    plugin.levelHistory[cPitch] = 1;
    plugin.levelHistory[sharpPitch] = 1;

    const verifyOrder = () => {
        const guide = fills.findIndex(fill => fill.color === 'stub:graph-grid-strong');
        const bars = fills.map((fill, index) => ({ ...fill, index }))
            .filter(fill => fill.color.startsWith('{'));
        assert.equal(bars.length, 2);
        assert.ok(guide >= 0 && guide < bars[0].index);
    };
    const layerColors = () => fills.map(fill => fill.color).filter(color =>
        color === 'stub:graph-grid-strong' || color.startsWith('{'));

    plugin.volumeHistoryDirty = true;
    plugin._paintVolumeHistory(20, plugin._displayPalette());
    verifyOrder();
    const sortedBars = plugin._volumeBarsForColumn(0);
    assert.deepEqual(Array.from(sortedBars, bar => bar.midi), [25, 24]);
    assert.ok(sortedBars[0].confidence < sortedBars[1].confidence);
    const fullRedraw = layerColors();

    fills.length = 0;
    plugin._paintVolumeColumns(0, 1);
    verifyOrder();
    assert.deepEqual(layerColors(), fullRedraw);

    plugin.history[sharpPitch] = plugin.history[cPitch];
    assert.deepEqual(Array.from(plugin._volumeBarsForColumn(0), bar => bar.midi), [24, 25]);
});

test('Volume meter draws one blurred current semicircle into the graph area', async () => {
    const plugin = await loadPlugin();
    plugin.mn = 21;
    plugin.mx = 21;
    plugin.levelReference = -36;
    plugin.meterCurrent[0] = -48;
    const arcs = [];
    const moves = [];
    const gradients = [];
    let fills = 0;
    let strokes = 0;
    const context = {
        beginPath() {}, closePath() {},
        moveTo(x, y) { moves.push({ x, y }); },
        arc(x, y, radius, start, end) { arcs.push({ x, y, radius, start, end }); },
        fill() { fills += 1; },
        stroke() { strokes += 1; },
        createRadialGradient(...coordinates) {
            const gradient = createGradient('radial', coordinates);
            gradients.push(gradient);
            return gradient;
        }
    };
    const palette = plugin._displayPalette();

    plugin.vl = false;
    plugin._drawVolumeMeters(context, 100, 20, palette);
    assert.deepEqual([arcs.length, fills, strokes], [0, 0, 0]);
    plugin.vl = true;
    plugin._drawVolumeMeters(context, 100, 20, palette);
    assert.deepEqual([arcs.map(arc => arc.radius), fills, strokes], [[10], 1, 0]);
    assert.deepEqual(moves, [{ x: 100, y: 20 }]);
    assert.equal(arcs[0].start, Math.PI / 2);
    assert.equal(arcs[0].end, Math.PI * 1.5);
    assert.deepEqual(gradients[0].stops.map(stop => stop.offset), [0, 0.75, 1]);
});

test('Volume meter remains above the bars and graph-side in both layouts', async () => {
    const plugin = await loadPlugin();
    plugin.vl = true;
    plugin.mn = 21;
    plugin.mx = 40;
    plugin.levelReference = -36;
    plugin.meterCurrent[0] = -36;
    plugin.canvas = { width: 200, height: 100 };
    plugin.imageData = { data: new Uint8ClampedArray(historyWidth * pitchCount * 4) };
    plugin.tempCtx = { putImageData() {} };
    plugin.tempCanvas = new FakeElement('canvas');
    plugin.history[(historyWidth - 1) * pitchCount] = 1;
    plugin.levelHistory[(historyWidth - 1) * pitchCount] = 1;

    const render = layout => {
        const events = [];
        const stack = [];
        let angle = 0;
        let origin = [0, 0];
        let lineStart = null;
        let lineEnd = null;
        const point = (x, y) => [
            origin[0] + x * Math.cos(angle) - y * Math.sin(angle),
            origin[1] + x * Math.sin(angle) + y * Math.cos(angle)
        ];
        plugin.ly = layout;
        plugin.volumeHistoryDirty = true;
        plugin.canvasCtx = {
            save() { stack.push({ angle, origin }); },
            restore() { ({ angle, origin } = stack.pop()); },
            translate(x, y) { origin = point(x, y); },
            rotate(radians) { angle += radians; },
            fillRect() {},
            drawImage() { events.push('history'); },
            createRadialGradient(...coordinates) {
                return createGradient('radial', coordinates);
            },
            beginPath() { lineStart = null; lineEnd = null; },
            moveTo(x, y) { lineStart = { raw: [x, y], screen: point(x, y) }; },
            lineTo(x, y) { lineEnd = { raw: [x, y], screen: point(x, y) }; },
            arc(x, y, radius) {
                events.push({
                    type: 'meter',
                    center: point(x, y),
                    graphEdge: point(x - radius, y)
                });
            },
            closePath() {},
            fill() { events.push('meter-fill'); },
            stroke() {
                if (lineStart?.raw[0] === lineEnd?.raw[0] && lineStart.raw[1] === 0) {
                    events.push('boundary');
                }
            },
            fillText() {},
            measureText() { return { width: 10 }; }
        };
        plugin.drawGraph();
        const meter = events.find(event => event?.type === 'meter');
        assert.ok(events.lastIndexOf('history') < events.indexOf('meter-fill'));
        assert.ok(events.indexOf('meter-fill') < events.lastIndexOf('boundary'));
        return meter;
    };

    const vertical = render('Vertical');
    assert.ok(vertical.graphEdge[0] < vertical.center[0]);
    const horizontal = render('Horizontal');
    assert.ok(horizontal.graphEdge[1] < horizontal.center[1]);
});

test('Note Spectrogram subscribes once and releases its telemetry callback', async () => {
    const subscriptions = [];
    let unsubscribeCount = 0;
    const telemetryHub = {
        subscribe(tapId, frameType, handler) {
            subscriptions.push({ tapId, frameType, handler });
            return () => { unsubscribeCount += 1; };
        }
    };
    const plugin = await loadPlugin({ telemetryHub });
    plugin.id = 31;
    plugin._setupMessageHandler();
    plugin.getParameters();

    assert.equal(subscriptions.length, 1);
    assert.deepEqual(
        { tapId: subscriptions[0].tapId, frameType: subscriptions[0].frameType },
        { tapId: 31, frameType: 24 }
    );
    subscriptions[0].handler(createTelemetryFrame({ levels: [0.8] }));
    assert.equal(plugin.writeColumn, 1);
    assert.ok(Math.abs(plugin.history[0] - 0.8) < 1e-6);

    plugin.cleanup();
    assert.equal(unsubscribeCount, 1);
    assert.equal(plugin.cleanedUp, true);
});

test('a replacement AudioWorklet starts a fresh telemetry epoch without resubscribing', async () => {
    const subscriptions = [];
    const telemetryHub = {
        subscribe(tapId, frameType, handler) {
            subscriptions.push({ tapId, frameType, handler });
            return () => {};
        }
    };
    const audioContext = { currentTime: 1 };
    const plugin = await loadPlugin({ telemetryHub, audioContext });
    const firstWorkletNode = { port: {} };
    const replacementWorkletNode = { port: {} };
    plugin.id = 32;
    plugin._nextMessageHandlerWorkletNode = firstWorkletNode;
    plugin._setupMessageHandler();
    const handler = subscriptions[0].handler;
    handler(createTelemetryFrame({
        generation: 9, frameIndex: 42, timeSeconds: 1.1, levels: [0.8]
    }));
    assert.equal(plugin.activeGeneration, 9);
    assert.equal(plugin.lastFrameIndex, 42);
    assert.equal(plugin.writeColumn, 1);

    audioContext.currentTime = 10;
    plugin._nextMessageHandlerWorkletNode = replacementWorkletNode;
    plugin._setupMessageHandler();
    assert.equal(subscriptions.length, 1);
    assert.equal(plugin.activeGeneration, null);
    assert.equal(plugin.lastFrameIndex, null);
    assert.equal(plugin.writeColumn, 0);
    assert.equal(plugin.history.some(value => value !== 0), false);

    handler(createTelemetryFrame({
        generation: 1, frameIndex: 0, timeSeconds: 9.9, levels: [1]
    }));
    assert.equal(plugin.writeColumn, 0);
    handler(createTelemetryFrame({
        generation: 1, frameIndex: 0, timeSeconds: 10.1, levels: [0.6]
    }));
    assert.equal(plugin.activeGeneration, 1);
    assert.equal(plugin.lastFrameIndex, 0);
    assert.equal(plugin.writeColumn, 1);
    assert.ok(Math.abs(plugin.history[0] - 0.6) < 1e-6);
});

test('F0 Presence distinguishes normal frame width from missing hops', async () => {
    const normal = await loadPlugin();
    normal.setParameters({ ts: 2 });
    normal.handleTelemetry(createTelemetryFrame({
        frameIndex: 0, timeSeconds: 1, levels: [0.8]
    }));
    normal.handleTelemetry(createTelemetryFrame({
        frameIndex: 1, timeSeconds: 1.01, levels: [0.5]
    }));
    assert.equal(normal.writeColumn, 6);
    assert.deepEqual(
        firstPitchPresenceBytesByColumn(normal, 0, 6),
        [204, 204, 204, 204, 204, 128]
    );

    const dropped = await loadPlugin();
    dropped.setParameters({ ts: 10 });
    dropped.handleTelemetry(createTelemetryFrame({
        frameIndex: 0, timeSeconds: 2, levels: [0.8]
    }));
    dropped.handleTelemetry(createTelemetryFrame({
        frameIndex: 5, timeSeconds: 2.05, levels: [0.5]
    }));
    assert.equal(dropped.writeColumn, 6);
    assert.deepEqual(firstPitchPresenceBytesByColumn(dropped, 0, 6), [204, 0, 0, 0, 0, 128]);

    dropped.setParameters({ ts: 1 });
    assert.equal(dropped.lastFrameIndex, null);
    assert.equal(dropped.writeColumn, 0);
    assert.equal(dropped.history.some(value => value !== 0), false);
});

test('reset and generation fences reject queued telemetry while accepting fresh frames', async () => {
    const audioContext = { currentTime: 9 };
    const plugin = await loadPlugin({ audioContext });
    plugin.handleTelemetry(createTelemetryFrame({ generation: 4, timeSeconds: 9, levels: [0.8] }));
    audioContext.currentTime = 10;
    plugin.reset();
    plugin.handleTelemetry(createTelemetryFrame({ generation: 3, timeSeconds: 9.5, levels: [1] }));
    assert.equal(plugin.writeColumn, 0);
    plugin.handleTelemetry(createTelemetryFrame({ generation: 5, timeSeconds: 10.05, levels: [0.5] }));
    assert.equal(plugin.activeGeneration, 5);
    assert.equal(plugin.history[0], 0.5);
    plugin.handleTelemetry(createTelemetryFrame({ generation: 4, timeSeconds: 12, levels: [1] }));
    assert.equal(plugin.history[0], 0.5);
    plugin.handleTelemetry(createTelemetryFrame({ generation: 6, timeSeconds: 12.1, levels: [0.75] }));
    assert.equal(plugin.activeGeneration, 6);
    assert.equal(plugin.writeColumn, 1);
    assert.equal(plugin.history[0], 0.75);
    audioContext.currentTime = 13;
    plugin.reset();
    plugin.handleTelemetry(createTelemetryFrame({ generation: 7, timeSeconds: 12.9, levels: [0.25] }));
    assert.equal(plugin.activeGeneration, 7);
    assert.equal(plugin.history[0], 0.25);
    audioContext.currentTime = 14;
    plugin.reset();
    plugin.handleTelemetry(createTelemetryFrame({ generation: 7, timeSeconds: 13.5, levels: [1] }));
    assert.equal(plugin.writeColumn, 0);
    plugin.handleTelemetry(createTelemetryFrame({ generation: 7, timeSeconds: 14.1, levels: [0.5] }));
    assert.equal(plugin.writeColumn, 1);
    assert.equal(plugin.history[0], 0.5);
});

test('frame sequence rejects duplicates and stale frames but accepts uint32 wrap', async () => {
    const plugin = await loadPlugin();
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [0.8] }));
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, timeSeconds: 2, levels: [1] }));
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 9, timeSeconds: 3, levels: [1] }));
    assert.equal(plugin.writeColumn, 1);
    assert.ok(Math.abs(plugin.history[0] - 0.8) < 1e-6);

    const wrapped = await loadPlugin();
    wrapped.setParameters({ ts: 10 });
    wrapped.handleTelemetry(createTelemetryFrame({ frameIndex: 0xffffffff, levels: [0.8] }));
    wrapped.handleTelemetry(createTelemetryFrame({ frameIndex: 0, timeSeconds: 2, levels: [0.5] }));
    assert.equal(wrapped.writeColumn, 2);
    assert.deepEqual(firstPitchPresenceBytesByColumn(wrapped, 0, 2), [204, 128]);
});

test('piano roll draws note boundaries and applies pitch colors to presence history and keys', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ cl: 'Rainbow', pr: 'High', ly: 'Vertical', vl: false, mn: 21, mx: 108 });
    const fills = [];
    const lines = [];
    plugin.canvas = { width: 1024, height: 440 };
    plugin.imageData = { data: new Uint8ClampedArray(historyWidth * pitchCount * 4) };
    plugin.tempCtx = { putImageData() {} };
    plugin.tempCanvas = new FakeElement('canvas');
    plugin.tempCanvas.width = historyWidth;
    plugin.tempCanvas.height = pitchCount;
    plugin.canvasCtx = {
        fillRect(x, y, width, height) {
            if (x > 0) fills.push({ x, y, width, height, color: this.fillStyle });
        },
        drawImage() {}, beginPath() {},
        moveTo(x, y) { this.lineStart = { x, y }; },
        lineTo() {},
        stroke() { if (this.lineStart.x === 0) lines.push({ ...this.lineStart, color: this.strokeStyle }); },
        fillText() {},
        measureText() { return { width: 10 }; }
    };
    const keyColor = pitch => {
        const midi = 21 + pitch;
        const pitchClass = midi % 12;
        if ([1, 3, 6, 8, 10].includes(pitchClass)) {
            return fills.find(fill => fill.width === 28 && fill.y === (108 - midi) * 5)?.color;
        }
        const whiteMidis = Array.from({ length: noteCount }, (_, index) => 21 + index)
            .filter(note => ![1, 3, 6, 8, 10].includes(note % 12));
        return fills.filter(fill => fill.width > 28)[whiteMidis.indexOf(midi)]?.color;
    };
    const draw = () => { fills.length = 0; lines.length = 0; plugin.drawGraph(); };
    // The newest column is the last buffer column after the ring wraps.
    const latestHistoryOffset = (historyWidth - 1) * pitchCount;
    plugin.history[latestHistoryOffset + fineCenter] = 1;
    plugin.history[latestHistoryOffset + fineDivisions + fineCenter] = 0.5;
    plugin.history[latestHistoryOffset + 2 * fineDivisions + fineCenter] = 0.25;
    plugin.history[0] = 0.75;
    draw();
    assert.equal(keyColor(0), 'rgb(129, 107, 168)');
    assert.equal(keyColor(1), 'rgb(94, 67, 91)');
    assert.equal(keyColor(2), 'rgb(208, 190, 196)');
    assert.equal(keyColor(3), 'rgb(221, 221, 221)');
    assert.equal(keyColor(4), 'rgb(34, 34, 34)');
    assert.deepEqual(lines.filter(line => line.color === 'stub:graph-grid-strong').map(line => line.y),
        [425, 365, 305, 245, 185, 125, 65, 5]);
    assert.deepEqual(lines.filter(line => line.color === 'stub:graph-grid-subtle').map(line => line.y),
        [400, 340, 280, 220, 160, 100, 40]);
    assert.equal(lines.length, 15);

    const noteColors = [
        'AA6256', 'A16939', '8C732A', '6D7C37', '458254', '138474',
        '008292', '387BA7', '6073AF', '816BA8', '996394', 'A76077'
    ].map(hex => hex.match(/../g).map(channel => parseInt(channel, 16)));
    plugin.history.fill(1, (historyWidth - 1) * pitchCount);
    plugin._writePixels(historyWidth - 1);
    draw();
    for (let pitch = 0; pitch < noteCount; pitch++) {
        const color = noteColors[(21 + pitch) % 12];
        assert.equal(keyColor(pitch), `rgb(${color.join(', ')})`, `key MIDI ${21 + pitch}`);
    }
    for (let pitch = 0; pitch < pitchCount; pitch++) {
        const midi = 21 + (pitch - fineCenter) / fineDivisions;
        const lowerMidi = Math.floor(midi);
        const fraction = midi - lowerMidi;
        const lower = noteColors[((lowerMidi % 12) + 12) % 12];
        const upper = noteColors[(((lowerMidi + 1) % 12) + 12) % 12];
        const color = lower.map((channel, index) =>
            Math.round(channel + (upper[index] - channel) * fraction));
        const offset = ((pitchCount - 1 - pitch) * historyWidth + historyWidth - 1) * 4;
        assert.deepEqual(Array.from(plugin.imageData.data.slice(offset, offset + 4)),
            [...color, 255], `history fine pitch ${pitch}`);
    }

    plugin.setParameters({ cl: 'Normal' });
    draw();
    assert.equal(plugin.writeColumn, 0);
    assert.equal(plugin.history[(historyWidth - 1) * pitchCount], 1);
    assert.equal(keyColor(0), 'rgb(0, 255, 0)');
    assert.equal(keyColor(1), 'rgb(0, 255, 0)');
    const latestPixel = ((pitchCount - 1 - fineCenter) * historyWidth + historyWidth - 1) * 4;
    assert.deepEqual(Array.from(plugin.imageData.data.slice(latestPixel, latestPixel + 4)),
        [0, 255, 0, 255]);
    plugin.setParameters({ cl: 'Rainbow' });
    assert.deepEqual(Array.from(plugin.imageData.data.slice(latestPixel, latestPixel + 4)),
        [129, 107, 168, 255]);

    plugin.writeColumn = 1;
    draw();
    assert.equal(keyColor(0), 'rgb(152, 136, 181)');
    plugin.setParameters({ cf: 1 });
    draw();
    assert.equal(keyColor(0), 'rgb(152, 136, 181)');

    plugin.reset();
    plugin.ly = 'Vertical';
    plugin.vl = false;
    plugin.setParameters({ pr: 'High', mn: 21, mx: 108 });
    draw();
    assert.equal(keyColor(0), 'rgb(221, 221, 221)');
});

test('pitch resolution switches between five-cell history and semitone bag rows', async () => {
    const plugin = await loadPlugin();
    plugin.tempCanvas = new FakeElement('canvas');
    plugin.tempCanvas.width = historyWidth;
    plugin.history[0] = 0.2;
    plugin.history[1] = 0.7;

    plugin.setParameters({ pr: 'High' });
    plugin.setParameters({ pr: 'Semitone' });
    assert.equal(plugin.tempCanvas.height, noteCount);
    assert.equal(plugin.imageData.data.length, historyWidth * noteCount * 4);
    assert.ok(Math.abs(plugin._bagConfidence(0, 21) - 0.7) < 1e-6);
    plugin._writePixels(0);
    const semitonePixel = (noteCount - 1) * historyWidth * 4;
    assert.deepEqual(
        Array.from(plugin.imageData.data.slice(semitonePixel, semitonePixel + 4)),
        [0, 178, 0, 255]
    );
    const semitoneBlackKeyPixel = (noteCount - 2) * historyWidth * 4;
    assert.deepEqual(
        Array.from(plugin.imageData.data.slice(semitoneBlackKeyPixel, semitoneBlackKeyPixel + 4)),
        [8, 8, 8, 255]
    );

    plugin.setParameters({ cl: 'Rainbow' });
    assert.deepEqual(
        Array.from(plugin.imageData.data.slice(semitonePixel, semitonePixel + 4)),
        [90, 75, 118, 255]
    );

    plugin.setParameters({ pr: 'High' });
    assert.equal(plugin.tempCanvas.height, pitchCount);
    assert.equal(plugin.imageData.data.length, historyWidth * pitchCount * 4);
    assert.ok(Math.abs(plugin.history[1] - 0.7) < 1e-6);
    const highBlackKeyPixel = (pitchCount - 1 - fineDivisions) * historyWidth * 4;
    assert.deepEqual(
        Array.from(plugin.imageData.data.slice(highBlackKeyPixel, highBlackKeyPixel + 4)),
        [8, 8, 8, 255]
    );

    plugin.setParameters({ pr: 'Semitone' });
    plugin.reset();
    assert.equal(plugin.pr, 'Semitone');
    assert.equal(plugin.tempCanvas.height, noteCount);
});

test('layouts rotate the same piano keyboard while keeping labels upright', async () => {
    let now = 1000;
    const plugin = await loadPlugin({ now: () => now });
    const fills = [], images = [], labels = [], lines = [];
    const stack = [];
    let angle = 0, origin = [0, 0];
    const point = (x, y) => [
        origin[0] + x * Math.cos(angle) - y * Math.sin(angle),
        origin[1] + x * Math.sin(angle) + y * Math.cos(angle)
    ];
    plugin.setParameters({ pr: 'High', ly: 'Vertical', vl: false, mn: 21, mx: 108 });
    plugin.canvas = { width: 880, height: 440 };
    plugin.imageData = { data: new Uint8ClampedArray(historyWidth * pitchCount * 4) };
    plugin.tempCtx = { putImageData() {} };
    plugin.tempCanvas = {};
    plugin.canvasCtx = {
        save() { stack.push({ angle, origin }); },
        restore() { ({ angle, origin } = stack.pop()); },
        translate(x, y) { origin = point(x, y); },
        rotate(radians) { angle += radians; },
        fillRect(x, y, width, height) {
            fills.push({
                center: point(x + width / 2, y + height / 2),
                color: this.fillStyle,
                width,
                height
            });
        },
        drawImage(source, sx, sy, sw, sh, x, y, width, height) {
            images.push({ source, start: point(x, y), end: point(x + width, y + height) });
        },
        fillText(text, x, y) {
            labels.push({ text, position: point(x, y), angle, textBaseline: this.textBaseline });
        },
        measureText() {
            return { width: 10, actualBoundingBoxAscent: 5, actualBoundingBoxDescent: 2 };
        },
        beginPath() { this.lineStart = null; this.lineEnd = null; },
        moveTo(x, y) { this.lineStart = point(x, y); },
        lineTo(x, y) { this.lineEnd = point(x, y); },
        stroke() {
            if (this.lineStart && this.lineEnd) {
                lines.push({ start: this.lineStart, end: this.lineEnd });
            }
        }
    };
    plugin.handleTelemetry(createTelemetryFrame({ levels: [1] }));
    const history = plugin.history.slice();
    const frameIndex = plugin.lastFrameIndex;
    const writeColumn = plugin.writeColumn;
    // Changing layout redraws even when animation is stopped.
    plugin.setParameters({ ly: 'Horizontal' });
    const blackKeys = fills.filter(fill => Math.abs(fill.width - 28) < 1e-6);
    const whiteKeys = fills.filter(fill => Math.abs(fill.width - 44.8) < 1e-6);
    assert.equal(blackKeys.length, 36);
    assert.equal(whiteKeys.length, 52);
    const blackKeyPitches = Array.from({ length: noteCount }, (_, pitch) => pitch)
        .filter(pitch => [1, 3, 6, 8, 10].includes((21 + pitch) % 12));
    blackKeys.forEach((key, index) => {
        assert.ok(Math.abs(key.center[0] - (blackKeyPitches[index] + 0.5) * 10) < 1e-6);
    });
    assert.ok(blackKeys.every(key => Math.abs(key.center[1] - 409.2) < 1e-6));
    assert.ok(whiteKeys.every(key => Math.abs(key.center[1] - 417.6) < 1e-6));
    assert.equal(whiteKeys[0].color, 'rgb(0, 255, 0)');
    for (let octave = 0; octave < 7; octave++) {
        const cKey = whiteKeys[2 + octave * 7];
        const left = cKey.center[0] - cKey.height / 2;
        assert.ok(Math.abs(left - (30 + octave * 120)) < 1e-6);
    }
    assert.ok(labels.every(label => Math.abs(label.angle) < 1e-6));
    assert.ok(labels.every(label => Math.abs(label.position[1] - 438) < 1e-6));
    assert.ok(labels.every(label => label.textBaseline === 'bottom'));
    labels.forEach((label, index) => {
        const expectedCenter = 30 + index * 120 + 60 / 7;
        assert.ok(Math.abs(label.position[0] - expectedCenter) < 1e-6);
    });
    const horizontalLines = lines.filter(line =>
        Math.abs(line.start[1] - line.end[1]) < 1e-6 &&
        Math.abs(line.start[0] - line.end[0]) > 1e-6
    );
    assert.ok(horizontalLines.every(line => Math.abs(line.start[1] - 395.2) < 1e-6));
    assert.deepEqual(labels.map(label => label.text), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    assert.ok(labels[0].position[0] < labels.at(-1).position[0]);
    assert.ok(Math.abs(images.at(-1).end[1] - 395.2) < 1e-6);
    const previousY = images[0].start[1];
    now += plugin.columnPeriod * 500;
    images.length = 0;
    plugin.drawGraph();
    assert.ok(images[0].start[1] < previousY);
    assert.ok(Math.abs(images[0].start[1] - previousY + 0.5 * 395.2 / historyWidth) < 1e-6);
    assert.ok(Math.abs(images.at(-1).end[1] - 395.2) < 1e-6);
    assert.equal(stack.length, 0);
    assert.equal(angle, 0);
    assert.deepEqual(origin, [0, 0]);
    assert.equal(plugin.scaledHistoryCanvas.height, 880);
    labels.length = 0;
    plugin.setParameters({ mn: 28, mx: 96 });
    assert.deepEqual(labels.map(label => label.text), ['C2', 'C3', 'C4', 'C5', 'C6']);
    fills.length = 0;
    labels.length = 0;
    plugin.setParameters({ ly: 'Vertical' });
    const verticalBlackKeys = fills.filter(fill => Math.abs(fill.width - 28) < 1e-6);
    const verticalWhiteKeys = fills.filter(fill => Math.abs(fill.width - 44.8) < 1e-6);
    assert.ok(verticalBlackKeys.length > 0);
    assert.ok(verticalWhiteKeys.length > 0);
    assert.ok(verticalBlackKeys.every(key => Math.abs(key.center[0] - 849.2) < 1e-6));
    assert.ok(verticalWhiteKeys.every(key => Math.abs(key.center[0] - 857.6) < 1e-6));
    assert.ok(labels.every(label => Math.abs(label.angle) < 1e-6));
    assert.ok(labels.every(label => Math.abs(label.position[0] - 871.6) < 1e-6));
    const verticalRowHeight = plugin.canvas.height / (plugin.mx - plugin.mn + 1);
    labels.forEach(label => {
        const midi = (Number(label.text.slice(1)) + 1) * 12;
        const whiteKeyCenter = plugin.canvas.height - ((midi - plugin.mn) * verticalRowHeight +
            0.5 * 12 * verticalRowHeight / 7);
        assert.ok(Math.abs(label.position[1] - 1.5 - whiteKeyCenter) < 1e-6);
    });
    assert.equal(plugin.scaledHistoryCanvas.height, 440);
    assert.deepEqual(plugin.history, history);
    assert.equal(plugin.lastFrameIndex, frameIndex);
    assert.equal(plugin.writeColumn, writeColumn);
});

test('all confidence values are displayed without a threshold in both colors', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ pr: 'High', vl: false });
    plugin.imageData = { data: new Uint8ClampedArray(historyWidth * pitchCount * 4) };
    const offset = ((pitchCount - 1 - fineCenter) * historyWidth) * 4;
    const pixel = () => Array.from(plugin.imageData.data.slice(offset, offset + 4));
    plugin.setParameters({ cf: 1, dr: -48, md: 'Classic' });
    for (const cl of ['Normal', 'Rainbow']) {
        plugin.setParameters({ cl });
        plugin.history[fineCenter] = 0.1;
        plugin._writePixels(0);
        assert.deepEqual(pixel(), cl === 'Normal' ? [0, 26, 0, 255] : [13, 11, 17, 255]);
        plugin.history[fineCenter] = 0;
        plugin._writePixels(0);
        assert.deepEqual(pixel(), [0, 0, 0, 255]);
        plugin.history[fineCenter] = 1;
        plugin._writePixels(0);
        assert.deepEqual(pixel(), cl === 'Normal' ? [0, 255, 0, 255] : [129, 107, 168, 255]);
    }
});

test('piano roll scrolls by monotonic fractional time and freezes across pauses', async () => {
    let now = 1000;
    const plugin = await loadPlugin({ now: () => now });
    plugin.setParameters({ pr: 'High', ly: 'Vertical', vl: false, ts: 2 });
    const drawCalls = [];
    plugin.canvas = { width: 1024, height: 440 };
    plugin.imageData = { data: new Uint8ClampedArray(historyWidth * pitchCount * 4) };
    plugin.tempCtx = { putImageData() {} };
    plugin.tempCanvas = {};
    plugin.canvasCtx = {
        fillRect() {},
        drawImage(...args) { drawCalls.push(args); },
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
        measureText() { return { width: 10 }; }
    };
    const rollWidth = plugin.canvas.width - 44.8;
    const historySources = split => {
        plugin.writeColumn = split;
        drawCalls.length = 0;
        plugin.drawGraph();
        return new Set(drawCalls.filter(call => call[0] === plugin.scaledHistoryCanvas)
            .map(call => Array.from({ length: call[3] }, (_, index) => call[1] + index))
            .flat());
    };
    for (const split of [0, 1, historyWidth - 1]) {
        const sources = historySources(split);
        const latest = (split + historyWidth - 1) % historyWidth;
        assert.equal(sources.size, historyWidth - 1);
        assert.equal(sources.has(latest), false);
        for (let column = 0; column < historyWidth; column++) {
            if (column !== latest) assert.equal(sources.has(column), true);
        }
    }
    plugin.writeColumn = 0;
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 0, timeSeconds: 1, levels: [1] }));
    drawCalls.length = 0;
    plugin.drawGraph();
    const initialHistoryDestinationX = drawCalls[0][5];
    assert.equal(plugin.scaledHistoryCanvas.height, plugin.canvas.height);
    assert.equal(drawCalls[0][4], plugin.canvas.height);
    assert.equal(drawCalls[0][8], plugin.canvas.height);
    const initialLatestCall = drawCalls.at(-1);
    assert.equal(initialLatestCall[1], (plugin.writeColumn + historyWidth - 1) % historyWidth);
    assert.equal(initialLatestCall[2], 85);
    assert.equal(initialLatestCall[4], 320);
    assert.equal(initialLatestCall[5] + initialLatestCall[7], rollWidth);
    now += plugin.columnPeriod * 500;
    drawCalls.length = 0;
    plugin.drawGraph();
    assert.ok(drawCalls[0][5] < initialHistoryDestinationX);
    assert.ok(Math.abs(drawCalls[0][5] -
        (initialHistoryDestinationX - 0.5 * rollWidth / historyWidth)) < 1e-6);
    const halfPhaseLatestCall = drawCalls.at(-1);
    assert.equal(halfPhaseLatestCall[1], (plugin.writeColumn + historyWidth - 1) % historyWidth);
    assert.equal(halfPhaseLatestCall[5] + halfPhaseLatestCall[7], rollWidth);

    plugin.animationFrameId = 1;
    plugin.stopAnimation();
    const frozenHistoryDestinationX = drawCalls[0][5];
    now += 1000;
    drawCalls.length = 0;
    plugin.drawGraph();
    assert.equal(drawCalls[0][5], frozenHistoryDestinationX);

    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 1, timeSeconds: 2, levels: [0.5] }));
    drawCalls.length = 0;
    plugin.drawGraph();
    now += plugin.latestHopSeconds * 1000;
    drawCalls.length = 0;
    plugin.drawGraph();
    const resumedLatestCall = drawCalls.at(-1);
    assert.equal(resumedLatestCall[1], plugin.writeColumn - 1);
    assert.equal(resumedLatestCall[5] + resumedLatestCall[7], rollWidth);
    const resumedHistoryDestinationX = drawCalls[0][5];
    now += 1000;
    drawCalls.length = 0;
    plugin.drawGraph();
    assert.equal(drawCalls[0][5], resumedHistoryDestinationX);

    let animationCallback;
    plugin.isVisible = true;
    plugin.requestPowerAnimationFrame = callback => { animationCallback = callback; return 1; };
    for (let cycle = 0; cycle < 8; cycle++) {
        plugin.stopAnimation();
        const gate = cycle % 2 === 0 ? 'enabled' : '_sectionEnabled';
        plugin[gate] = false;
        now += 20000;
        plugin.handleTelemetry(createTelemetryFrame({ frameIndex: cycle + 2 }));
        plugin[gate] = true;
        plugin.handleTelemetry(createTelemetryFrame({ frameIndex: cycle + 3, levels: [1] }));
        plugin.startAnimation();
        drawCalls.length = 0;
        animationCallback(now + 4);
        const latestCall = drawCalls.at(-1);
        assert.equal(latestCall[1], (plugin.writeColumn + historyWidth - 1) % historyWidth);
        assert.ok(Math.abs(latestCall[5] + latestCall[7] - rollWidth) < 1e-9);
        assert.ok(Math.abs(latestCall[7] - (1 + 0.004 / plugin.columnPeriod) * rollWidth / historyWidth) < 1e-9);
    }

    plugin.setParameters({ ts: 10 });
    assert.equal(plugin.columnPeriod, 10 / historyWidth);
    assert.equal(plugin.writeColumn, 0);
    plugin.handleTelemetry(createTelemetryFrame({
        generation: 2, frameIndex: 1, timeSeconds: 3, levels: [0.5]
    }));
    assert.equal(plugin.writeColumn, 1);
});

test('piano roll keeps the render clock continuous across delayed telemetry delivery', async () => {
    let now = 1000;
    const plugin = await loadPlugin({ now: () => now });
    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 0, timeSeconds: 1, hopSeconds: 0.02, levels: [1]
    }));
    plugin._scrollPhase(now);
    plugin.scrollAnchorPending = false;

    now = 1025;
    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 1, timeSeconds: 1.02, hopSeconds: 0.02, levels: [0.5]
    }));

    const expectedLead = 0.005 / plugin.columnPeriod;
    assert.ok(Math.abs(plugin._scrollPhase(now) - plugin.columnPhase - expectedLead) < 1e-5);
});


test('pitch bands, white keys and Normal confidence gradients follow the theme', async () => {
    const themes = [
        { name: 'Paper', trace: [0, 128, 0], background: [255, 255, 255], soft: [241, 241, 241], blackBand: [241, 241, 241] },
        { name: 'Mint', trace: [10, 122, 47], background: [255, 255, 255], soft: [238, 243, 240], blackBand: [238, 243, 240] },
        { name: 'Midnight', trace: [46, 230, 166], background: [7, 11, 20], soft: [25, 33, 51], blackBand: [15, 19, 28] }
    ];
    for (const theme of themes) {
        for (const resolution of ['High', 'Semitone']) {
            const plugin = await loadPlugin(theme);
            plugin.setParameters({ pr: resolution, mn: 21, mx: 108 });
            plugin.tempCanvas = new FakeElement('canvas');
            plugin.tempCanvas.width = historyWidth;
            plugin.configureHistoryImage();
            plugin.canvas = { width: 1024, height: 440 };
            const fills = [];
            plugin.canvasCtx = {
                fillRect(x) { if (x > 0) fills.push(this.fillStyle); },
                drawImage() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
                save() {}, restore() {}, translate() {}, rotate() {}, measureText() { return { width: 8 }; }
            };
            const displayCount = resolution === 'High' ? pitchCount : noteCount;
            const whitePitch = resolution === 'High' ? fineCenter : 0;
            const blackPitch = resolution === 'High' ? fineDivisions + fineCenter : 1;
            const pixel = pitch => {
                const offset = (displayCount - 1 - pitch) * historyWidth * 4;
                return Array.from(plugin.imageData.data.slice(offset, offset + 4));
            };
            assert.deepEqual(pixel(whitePitch), [...theme.background, 255], theme.name + ' white band');
            assert.deepEqual(pixel(blackPitch), [...theme.blackBand, 255], theme.name + ' black band');
            const whiteKey = theme.name === 'Midnight' ? [221, 221, 221] : [255, 255, 255];
            const blackKey = [34, 34, 34];
            for (const layout of ['Horizontal', 'Vertical']) {
                plugin.ly = layout;
                fills.length = 0;
                plugin.drawGraph();
                assert.ok(fills.includes(`rgb(${whiteKey.join(', ')})`), theme.name + ' white key ' + layout);
                assert.ok(fills.includes(`rgb(${blackKey.join(', ')})`), theme.name + ' black key ' + layout);
            }
            const mix = (base, confidence) => base.map((channel, index) =>
                Math.round(channel + (theme.trace[index] - channel) * confidence));
            for (const confidence of [0.25, 0.5, 1]) {
                plugin.history[fineCenter] = confidence;
                plugin.history[fineDivisions + fineCenter] = confidence;
                plugin._writePixels(0);
                assert.deepEqual(pixel(whitePitch), [...mix(theme.background, confidence), 255]);
                assert.deepEqual(pixel(blackPitch), [...mix(theme.blackBand, confidence), 255]);
                plugin.writeColumn = 1;
                for (const layout of ['Horizontal', 'Vertical']) {
                    plugin.ly = layout;
                    fills.length = 0;
                    plugin.drawGraph();
                    for (const base of [whiteKey, blackKey]) {
                        assert.ok(fills.includes(`rgb(${mix(base, confidence).join(', ')})`),
                            `${theme.name} ${layout} confidence ${confidence}`);
                    }
                }
            }
        }
    }
});
