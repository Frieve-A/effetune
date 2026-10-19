import { installThemePaletteStub } from '../helpers/theme-palette-stub.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { frequencyAxisSource } from '../helpers/spectrum-overlay-harness.mjs';
import { fileURLToPath } from 'node:url';
import { TelemetryHub, TELEMETRY_HEADER_BYTES } from '../../js/audio/telemetry-hub.js';
import { audibleFrameTime, audibleContextTime } from '../../js/audio/visual-sync.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pluginPath = path.join('plugins', 'analyzer', 'note_spectrogram.js');
const noteCount = 88;
const fineDivisions = 5;
const fineCenter = Math.floor(fineDivisions / 2);
const pitchCount = noteCount * fineDivisions;
const confidenceOffset = 32;
const volumeOffset = confidenceOffset + pitchCount * 4;
const revisedOffset = volumeOffset + pitchCount * 4;
const intermediateOffset = revisedOffset + pitchCount * 4;
const revisionBytes = 4 + pitchCount * 4;
const centsOffset = intermediateOffset + 2 * revisionBytes;
const payloadBytes = centsOffset + noteCount * 4;
const historyWidth = 1024;

// Canvas calls used only by the shaded piano keys.
const keyShadingStubs = {
    save() {}, restore() {}, rect() {}, fill() {}, createLinearGradient: () => ({ addColorStop() {} })
};

// Canvas calls used only by the Volume history bar shapes.
const volumePathStubs = {
    save() {}, restore() {}, translate() {}, clip() {}, beginPath() {}, rect() {},
    moveTo() {}, lineTo() {}, closePath() {}, ellipse() {}, fill() {}
};

// Records Volume history rectangles and filled bar paths in drawing order.
function createVolumeContext() {
    const saved = [];
    let path = [];
    const events = [];
    return {
        events,
        globalCompositeOperation: 'source-over',
        save() { saved.push(this.globalCompositeOperation); },
        restore() { this.globalCompositeOperation = saved.pop(); },
        translate() {}, clip() {}, rect() {}, closePath() {}, clearRect() {},
        beginPath() { path = []; },
        moveTo(x, y) { path.push(['point', x, y]); },
        lineTo(x, y) { path.push(['point', x, y]); },
        ellipse(x, y, radiusX, radiusY) { path.push(['ellipse', x, y, radiusX, radiusY]); },
        fill() {
            events.push({ type: 'shape', path, color: styleSignature(this.fillStyle),
                composite: this.globalCompositeOperation });
        },
        fillRect(x, y, width, height) {
            events.push({ type: 'rect', x, y, width, height, color: styleSignature(this.fillStyle),
                composite: this.globalCompositeOperation });
        },
        createLinearGradient: (...coordinates) => createGradient('linear', coordinates)
    };
}

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
                ...volumePathStubs,
                createLinearGradient: (...coordinates) => createGradient('linear', coordinates),
                createRadialGradient: (...coordinates) => createGradient('radial', coordinates)
            };
        }
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    replaceChildren() {
        this.children = [];
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    addEventListener(type, listener) {
        this.listeners.set(type, listener);
    }

    removeEventListener(type, listener) {
        if (this.listeners.get(type) === listener) this.listeners.delete(type);
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

        getWorkletPluginData(parameters = this.getParameters()) {
            return { parameters };
        }

        createSelectControl(label, options, value, setter, modelKey) {
            if (this.createRadioGroup) return this.createRadioGroup(label, options, value, setter, modelKey);
            return new FakeElement('div');
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

const FrequencyAxis = (() => {
    const window = {};
    vm.runInNewContext(frequencyAxisSource, { window });
    return window.FrequencyAxis;
})();

async function loadPlugin({ telemetryHub = null, audioContext = null, nullCanvasContext = false,
    now = 0, background = [0, 0, 0], soft = [34, 34, 34], trace = [0, 255, 0], graphReadout = null,
    requestAnimationFrame, cancelAnimationFrame } = {}) {
    const source = await fs.readFile(path.join(repoRoot, pluginPath), 'utf8');
    const window = { dspTelemetryHub: telemetryHub, audioContext, GraphReadout: graphReadout };
    const document = {
        createElement: tagName => new FakeElement(tagName, nullCanvasContext)
    };
    const context = vm.createContext({
        PluginBase: createPluginBase(),
        document,
        window,
        requestAnimationFrame,
        cancelAnimationFrame,
        performance: { now: () => typeof now === 'function' ? now() : now }
    });
    const palette = installThemePaletteStub(context.window);
    const originalGet = palette.get;
    palette.get = name => name === 'graph-bg-deep' ? `rgba(${background.join(', ')}, 1)`
        : name === 'graph-base-soft' ? `rgba(${soft.join(', ')}, 1)`
        : name === 'accent' ? 'rgba(26, 115, 232, 1)'
        : name === 'graph-trace' ? `rgba(${trace.join(', ')}, 1)` : originalGet(name);
    vm.runInContext(frequencyAxisSource, context, { filename: 'frequency-axis.js' });
    vm.runInContext(source, context, { filename: pluginPath });
    const spectrogramSource = await fs.readFile(path.join(repoRoot, 'plugins', 'analyzer', 'spectrogram.js'), 'utf8');
    vm.runInContext(spectrogramSource, context, { filename: 'spectrogram.js' });
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
    volumeLevels = [],
    revisionAge = 0,
    revisedLevels = [],
    revisions = [],
    pitchCents = []
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
    payload.setUint32(28, revisionAge, true);
    for (let pitch = 0; pitch < pitchCount; pitch++) {
        payload.setFloat32(confidenceOffset + pitch * 4, levels[pitch] ?? defaultLevel, true);
        payload.setFloat32(volumeOffset + pitch * 4, volumeLevels[pitch] ?? -240, true);
        payload.setFloat32(revisedOffset + pitch * 4, revisedLevels[pitch] ?? 0, true);
    }
    for (const revision of revisions) {
        const offset = intermediateOffset + (revision.age === 2 ? 0 : 1) * revisionBytes;
        payload.setUint32(offset, revision.age, true);
        for (let pitch = 0; pitch < pitchCount; pitch++) {
            payload.setFloat32(offset + 4 + pitch * 4, revision.levels[pitch] ?? 0, true);
        }
    }
    for (let note = 0; note < noteCount; note++) {
        payload.setFloat32(centsOffset + note * 4, pitchCents[note] ?? 0, true);
    }
    return { frameType: 24, formatVersion: 6, payload };
}

function firstPitchByColumn(plugin, start, count) {
    const values = [];
    for (let column = start; column < start + count; column++) {
        values.push(plugin.history[(column % historyWidth) * pitchCount]);
    }
    return values;
}

function createTimbreFrame({ event = 2, noteId = 1, midi = 21, startFrameIndex = 10,
    frameIndex = 14, endFrameIndex = 0xffffffff, generation = 1, probabilities = [1, 0, 0, 0, 0, 0, 0, 0, 0] } = {}) {
    const payload = new DataView(new ArrayBuffer(80));
    payload.setFloat32(0, 48000, true);
    payload.setFloat32(4, 1 + frameIndex * .02, true);
    payload.setFloat32(8, .02, true);
    for (const [offset, value] of [[12, generation], [16, frameIndex], [20, noteId], [24, midi],
        [28, event], [32, startFrameIndex], [36, endFrameIndex]]) payload.setUint32(offset, value, true);
    if (event === 2) probabilities.forEach((value, i) => payload.setFloat32(40 + i * 4, value, true));
    return { frameType: 31, formatVersion: 1, payload };
}

function firstPitchPresenceBytesByColumn(plugin, start, count) {
    return firstPitchByColumn(plugin, start, count).map(value => Math.round(value * 255));
}

test('timbre history fades over three display frames while keyboard colors are immediate', async () => {
    for (const pr of ['Semitone', 'High']) {
        for (const vl of [false, true]) {
            const plugin = await loadPlugin();
            plugin.setParameters({ cl: 'Instrument9', pr, vl, mn: 21, mx: 21 });
            plugin.initializeDisplayCanvas(new FakeElement('canvas'));
            plugin.drawGraph = () => {};
            plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [0, 0, 1],
                volumeLevels: [-240, -240, -12] }));
            const palette = plugin._displayPalette();
            plugin.handleTimbreTelemetry(createTimbreFrame({ probabilities: [1, 0, 0, 0, 0, 0, 0, 0, 0] }));
            assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, palette)), [76, 120, 184]);
            for (const expected of [[103, 117, 139], [89, 119, 161], [76, 120, 184]]) {
                plugin.flushTimbreHistory();
                if (pr === 'High' || vl) {
                    const shape = plugin._volumeShapesForColumn(0, 100, palette)[0];
                    assert.equal(shape.fill, `rgba(${expected.join(', ')}, 1)`);
                } else {
                    const offset = 87 * historyWidth * 4;
                    assert.deepEqual(Array.from(plugin.imageData.data.slice(offset, offset + 3)), expected);
                }
                assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, palette)), [76, 120, 184]);
            }
            let repaints = 0;
            plugin.paintColumns = plugin._paintVolumeColumns = () => { repaints++; };
            plugin.flushTimbreHistory();
            assert.equal(repaints, 0, 'completed fades stop repainting');
        }
    }
});

test('timbre notification batches repaint only changed history at the next graph frame', async () => {
    const report = [];
    for (const volume of [false, true]) {
        const plugin = await loadPlugin();
        plugin.cl = 'Instrument9';
        plugin.vl = volume;
        plugin.initializeDisplayCanvas(new FakeElement('canvas'));
        plugin.columnSerial = historyWidth;
        plugin.columnFrames.set(Array.from({ length: historyWidth }, (_, i) => i));
        plugin.history.fill(.8);
        plugin.levelHistory.fill(.8);
        plugin.volumeLevelHistory.fill(-12);
        plugin.activeGeneration = 1;
        plugin.lastFrameIndex = 1023;
        plugin.latestFrameTimeSeconds = 1;
        plugin._paintVolumeHistory(200, plugin._displayPalette());
        const counts = { graph: 0, pixels: 0, volumeFrames: 0, volumeShapes: 0 };
        for (const [method, key] of [['_writePixels', 'pixels'], ['_paintVolumeFrame', 'volumeFrames'],
            ['_volumeShapesForColumn', 'volumeShapes']]) {
            const original = plugin[method].bind(plugin);
            plugin[method] = (...args) => { counts[key]++; return original(...args); };
        }
        plugin.drawGraph = () => {
            counts.graph++;
            plugin.flushTimbreHistory?.();
            if (volume) plugin._paintVolumeHistory(200, plugin._displayPalette());
        };
        const measure = (kind, notify) => {
            Object.keys(counts).forEach(key => { counts[key] = 0; });
            const start = performance.now();
            notify();
            const notificationCounts = { ...counts };
            plugin.drawGraph();
            report.push({ volume, kind, notificationCounts, frameCounts: { ...counts },
                milliseconds: performance.now() - start });
        };
        measure('pitch24', () => plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 1024,
            timeSeconds: 1.01, levels: Array(pitchCount).fill(.8), volumeLevels: Array(pitchCount).fill(-12) })));
        for (const [kind, event] of [['start31', 1], ['result31', 2], ['end31', 3]]) {
            measure(kind, () => {
                for (let note = 0; note < 8; note++) plugin.handleTimbreTelemetry(createTimbreFrame({
                    event, noteId: note + 1, midi: 40 + note, startFrameIndex: 990, frameIndex: 1024,
                    endFrameIndex: event === 3 ? 1020 : 0xffffffff }));
            });
        }
    }
    console.log('Timbre finite Canvas diagnostic:', JSON.stringify(report));
    for (const item of report) {
        assert.equal(item.notificationCounts.graph, 0, 'notifications never synchronously draw the graph');
        assert.equal(item.frameCounts.graph, 1, 'one animation frame handles the whole batch');
        if (item.kind.endsWith('31')) {
            assert.equal(item.notificationCounts.pixels, 0);
            assert.equal(item.notificationCounts.volumeFrames, 0);
            assert.ok(item.frameCounts.volumeFrames < 50, 'only affected Volume frames are repainted');
            assert.ok(item.frameCounts.pixels < 50, 'overlapping note ranges are painted once');
        }
        if (item.kind === 'start31') {
            assert.equal(item.frameCounts.pixels, 0);
            assert.equal(item.frameCounts.volumeFrames, 0);
        }
    }
});

test('Note Spectrogram restores display preferences and defaults to a horizontal green keyboard', async () => {
    const plugin = await loadPlugin({ nullCanvasContext: true });
    assert.equal(plugin.name, 'Note Spectrogram');
    assert.equal(plugin.processor, 'return data;');
    assert.equal(plugin.constructor.executionCapabilities.requiresWasm, true);
    assert.deepEqual(JSON.parse(JSON.stringify(plugin.getParameters())), {
        type: 'NoteSpectrogramPlugin', enabled: true, cl: 'Normal', hl: 'None', pr: 'Semitone', ly: 'Horizontal', vl: true, os: false, ts: 2,
        mn: 28, mx: 91
    });
    plugin.setParameters({
        cl: 'Rainbow', pr: 'High', ly: 'Horizontal', vl: false, os: true, ts: 100,
        md: 'Classic', cf: 1, dr: -48
    });
    assert.equal(plugin.ts, 10);
    const restored = await loadPlugin();
    restored.setParameters(JSON.parse(JSON.stringify(plugin.getParameters())));
    assert.equal(restored.cl, 'Rainbow');
    assert.equal(restored.pr, 'High');
    assert.equal(restored.ly, 'Horizontal');
    assert.equal(restored.vl, false);
    assert.equal(restored.os, true);
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
    assert.equal(legacy.os, false);
    legacy.setParameters({ cl: 'Normal', rb: true });
    assert.equal(legacy.cl, 'Normal');
    plugin.reset();
    assert.equal(plugin.cl, 'Normal');
    assert.equal(plugin.pr, 'Semitone');
    assert.equal(plugin.ly, 'Horizontal');
    assert.equal(plugin.vl, true);
    assert.equal(plugin.os, false);
    assert.equal(plugin.ts, 2);
    assert.equal(plugin.mn, 28);
    assert.equal(plugin.mx, 91);
});

test('onset, instrument and highlight settings derive DSP enablement while presets store only display choices', async () => {
    const plugin = await loadPlugin();
    assert.equal(plugin.getWorkletPluginData().parameters.te, false);
    assert.equal(plugin.timbreEnabled(), false);
    plugin.setParameters({ os: true });
    assert.equal(plugin.getWorkletPluginData().parameters.te, true);
    plugin.setParameters({ os: false });
    assert.equal(plugin.getWorkletPluginData().parameters.te, false);
    plugin.setParameters({ cl: 'Instrument3', hl: 'Vocal' });
    const saved = JSON.parse(JSON.stringify(plugin.getParameters()));
    assert.equal(saved.te, undefined);
    assert.equal(saved.hl, 'Vocal');
    assert.equal(saved.os, false);
    const restored = await loadPlugin();
    restored.setParameters(saved);
    assert.equal(restored.cl, 'Instrument3');
    assert.equal(restored.getWorkletPluginData().parameters.te, true);
    restored.setParameters({ cl: 'Rainbow' });
    assert.equal(restored.getWorkletPluginData().parameters.te, true);
    restored.setParameters({ hl: 'None', te: true });
    assert.equal(restored.getWorkletPluginData().parameters.te, false);
    restored.setParameters({ os: true });
    assert.equal(restored.getWorkletPluginData().parameters.te, true);
    assert.equal(restored.timbreEnabled(), false);
    restored.reset();
    assert.equal(restored.hl, 'None');
    assert.equal(restored.os, false);
    assert.equal(restored.getWorkletPluginData().parameters.te, false);
});

test('onset marks retain separate same-pitch starts in Normal colors and clear with the analysis epoch', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ mn: 21, mx: 40, os: true });
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [1] }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ event: 1, startFrameIndex: 10, frameIndex: 12 }));
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 12, timeSeconds: 1.04, levels: [1] }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ event: 3, frameIndex: 12, endFrameIndex: 12 }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ event: 1, noteId: 2, startFrameIndex: 12, frameIndex: 14 }));
    const context = createVolumeContext();
    context.stroke = () => {};
    const draw = () => {
        context.events.length = 0;
        plugin._drawOnsets(context, historyWidth, 10, 1, 0, plugin._displayPalette());
        return context.events.filter(mark => mark.type === 'shape');
    };
    assert.equal(plugin.timbreEnabled(), false, 'Normal colors still receive note-start events');
    const starts = draw();
    assert.equal(starts.length, 2);
    const expectedPositions = [10, 12].map(frameIndex =>
        (plugin.columnFrames.indexOf(frameIndex) - plugin.writeColumn + historyWidth) % historyWidth);
    assert.deepEqual(starts.map(mark => (mark.path[0][1] + mark.path[1][1]) / 2), expectedPositions,
        'same-pitch retriggers are placed at their separate start frames');
    assert.equal(starts[0].path[0][2], starts[1].path[0][2], 'the two starts share the same pitch');
    for (const [cl, color] of [['Normal', 'rgb(0, 255, 0)'], ['Rainbow', 'rgb(129, 107, 168)'],
        ['Instrument3', 'rgb(156, 156, 156)'], ['Instrument9', 'rgb(143, 114, 199)']]) {
        plugin.setParameters({ cl });
        plugin.handleTimbreTelemetry(createTimbreFrame({ noteId: 2, startFrameIndex: 12,
            probabilities: [0, 0, 1, 0, 0, 0, 0, 0, 0] }));
        assert.equal(draw().at(-1).color, color, `${cl} uses the selected display color`);
    }
    plugin.setParameters({ cl: 'Normal' });
    plugin.setParameters({ os: false });
    assert.equal(draw().length, 0);
    plugin.setParameters({ os: true });
    plugin.handleTelemetry(createTelemetryFrame({ generation: 2, frameIndex: 0, timeSeconds: 2, levels: [1] }));
    assert.equal(draw().length, 0, 'a fresh analysis generation clears the preceding note starts');
    plugin.handleTimbreTelemetry(createTimbreFrame({ generation: 2, event: 1, startFrameIndex: 0, frameIndex: 2 }));
    assert.equal(draw().length, 1);
    plugin.reset();
    assert.equal(draw().length, 0, 'reset clears onset marks');
});

test('onset marks draw over history in both layouts with Volume on or off', async () => {
    for (const background of [[0, 0, 0], [250, 250, 250]]) {
        const plugin = await loadPlugin({ background });
        plugin.setParameters({ mn: 21, mx: 40, os: true });
        plugin.initializeDisplayCanvas(new FakeElement('canvas'));
        plugin.canvas.width = 200;
        plugin.canvas.height = 100;
        plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [1] }));
        plugin.handleTimbreTelemetry(createTimbreFrame({ event: 1, startFrameIndex: 10, frameIndex: 12 }));
        for (const ly of ['Vertical', 'Horizontal']) {
            for (const vl of [false, true]) {
                plugin.ly = ly;
                plugin.vl = vl;
                plugin.volumeHistoryDirty = true;
                const events = [];
                const stack = [];
                let angle = 0;
                let markerPath = [];
                plugin.canvasCtx = {
                    ...keyShadingStubs, ...volumePathStubs,
                    save() { stack.push(angle); },
                    restore() { angle = stack.pop(); },
                    rotate(radians) { angle += radians; },
                    beginPath() { markerPath = []; },
                    moveTo(x, y) { markerPath.push([x, y]); },
                    lineTo(x, y) { markerPath.push([x, y]); },
                    fill() {
                        if (markerPath.length === 3 && this.fillStyle === 'rgb(0, 255, 0)') {
                            events.push({ type: 'mark', angle, path: markerPath });
                        }
                    },
                    fillRect() {},
                    drawImage() { events.push('history'); },
                    arc() {}, stroke() {
                        if (markerPath.length === 3 && this.strokeStyle === `rgba(${background.join(', ')}, 1)`) {
                            events.push('border');
                        }
                    }, fillText() {}, measureText: () => ({ width: 10 }),
                    createRadialGradient: (...coordinates) => createGradient('radial', coordinates)
                };
                plugin.drawGraph();
                const mark = events.find(event => event?.type === 'mark');
                assert.ok(mark, `${ly}, Volume ${vl} draws a start marker`);
                assert.equal(mark.angle, ly === 'Horizontal' ? Math.PI / 2 : 0);
                const [baseA, baseB, tip] = mark.path;
                const baseCenter = [(baseA[0] + baseB[0]) / 2, (baseA[1] + baseB[1]) / 2];
                const frame = plugin._readoutFrame;
                const column = plugin.columnFrames.indexOf(10);
                assert.deepEqual(baseCenter, [((column - plugin.writeColumn + historyWidth) % historyWidth -
                    frame.scrollPhase) * frame.columnWidth, (plugin.mx - 21 + .5) * frame.rowHeight],
                'the base midpoint remains at the onset time and pitch');
                const dx = tip[0] - baseCenter[0];
                const dy = tip[1] - baseCenter[1];
                const screenDx = dx * Math.cos(mark.angle) - dy * Math.sin(mark.angle);
                const screenDy = dx * Math.sin(mark.angle) + dy * Math.cos(mark.angle);
                assert.ok(ly === 'Horizontal' ? Math.abs(screenDx) < 1e-10 && screenDy > 0
                    : screenDx > 0 && Math.abs(screenDy) < 1e-10,
                `${ly} points ${ly === 'Horizontal' ? 'down' : 'right'} after the layout transform`);
                assert.ok(events.indexOf('history') < events.indexOf(mark), 'the marker is visible above the history');
                assert.ok(events.includes('border'), 'the marker has a theme background border');
                plugin.setParameters({ os: false });
                events.length = 0;
                plugin.drawGraph();
                assert.equal(events.some(event => event?.type === 'mark'), false);
                plugin.setParameters({ os: true });
            }
        }
    }
});

test('instrument legends draw upright inside the plot and wrap at mobile widths in either theme', async () => {
    for (const background of [[0, 0, 0], [250, 250, 250]]) {
        const plugin = await loadPlugin({ background });
        plugin.cl = 'Instrument9';
        plugin.hl = 'Vocal';
        for (const horizontal of [false, true]) {
            for (const width of [300, 900]) {
                const labels = [], rectangles = [];
                let rotation = 0;
                const context = {
                    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
                    rotate(angle) { rotation += angle; },
                    measureText(text) { return { width: text.length * 7 }; },
                    fillRect(x, y, w, h) { rectangles.push({ x, y, w, h, color: this.fillStyle }); },
                    fillText(text, x, y) { labels.push({ text, x, y, rotation, color: this.fillStyle }); }
                };
                const height = horizontal ? 160 : 240;
                plugin._drawTimbreLegend(context, width, height);
                assert.deepEqual(labels.map(label => label.text),
                    ['Bass', 'Guitar', 'Piano', 'Strings', 'Wind', 'Synth', 'Organ', 'Other', 'Vocal', 'Highlight: Vocal']);
                for (const label of labels) {
                    assert.equal(label.rotation, 0, 'legend text stays upright');
                    assert.ok(label.x >= 0 && label.x + label.text.length * 7 <= width);
                    assert.ok(label.y > 0 && label.y < height, 'legend stays out of the keyboard gutter');
                    assert.ok(label.color, 'labels use the active theme');
                }
                if (width === 300) assert.ok(new Set(labels.map(label => label.y)).size > 1, 'mobile legend wraps');
                assert.ok(rectangles.some(rectangle => rectangle.color === `rgba(${background.join(', ')}, 1)`));
                const selected = plugin._legendRects.find(rect => rect.target === 'Vocal');
                const border = rectangles.filter(rectangle => rectangle.h === 1);
                assert.equal(border.length, 2, 'only the selected item has a top and bottom border');
                assert.equal(border[0].x, selected.x);
                assert.equal(border[0].y, selected.y);
                assert.equal(border[0].color, labels[0].color, 'the frame follows the active theme text color');
            }
        }
        plugin.cl = 'Instrument3';
        plugin.hl = 'None';
        const labels = [], rectangles = [];
        const context = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
            measureText: text => ({ width: text.length * 7 }),
            fillRect(x, y, width, height) { rectangles.push({ x, y, width, height }); },
            fillText: label => labels.push(label) };
        const draw = () => { labels.length = 0; rectangles.length = 0; plugin._drawTimbreLegend(context, 300, 160); };
        draw();
        assert.deepEqual(labels, ['Vocal', 'Bass', 'Other']);
        const bounds = JSON.stringify(plugin._legendRects);
        const framedTarget = () => {
            const top = rectangles.find(rectangle => rectangle.height === 1);
            return plugin._legendRects.find(rect => rect.x === top?.x && rect.y === top?.y)?.target ?? null;
        };
        assert.equal(framedTarget(), null);
        plugin.setParameters({ hl: 'Bass' });
        draw();
        assert.equal(framedTarget(), 'Bass', 'changing saved Highlight marks its legend item');
        plugin._setLegendHighlight('Vocal');
        draw();
        assert.equal(framedTarget(), 'Vocal', 'hover takes visual priority');
        assert.equal(plugin.hl, 'Bass');
        plugin._boundLegendLeave();
        draw();
        assert.equal(framedTarget(), 'Bass', 'leaving restores the saved selection frame');
        plugin.setParameters({ hl: 'Other9' });
        draw();
        assert.equal(framedTarget(), null, 'Other (9) does not incorrectly mark Other (3)');
        plugin.setParameters({ hl: 'Other3' });
        draw();
        assert.equal(framedTarget(), 'Other3');
        assert.equal(JSON.stringify(plugin._legendRects), bounds, 'frames leave hit bounds and layout unchanged');
    }
});

test('timbre results recolor their note history and distinguish same-pitch retriggers', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ cl: 'Instrument3', pr: 'Semitone', vl: false });
    plugin.initializeDisplayCanvas(new FakeElement('canvas'));
    plugin.drawGraph = () => {};
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [1, 1, 1, 1, 1] }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ event: 1, frameIndex: 12 }));
    assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, plugin._displayPalette())), [116, 116, 116]);
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 14, timeSeconds: 1.04, levels: [1, 1, 1, 1, 1] }));
    // The seven Other probabilities sum to .6, exceeding Bass .4, although Bass wins among nine classes.
    plugin.handleTimbreTelemetry(createTimbreFrame({ probabilities: [.4, .35, .25, 0, 0, 0, 0, 0, 0] }));
    for (let frame = 0; frame < 3; frame++) plugin.flushTimbreHistory();
    const pixel = column => Array.from(plugin.imageData.data.subarray((87 * historyWidth + column) * 4,
        (87 * historyWidth + column) * 4 + 3));
    assert.deepEqual(pixel(0), [124, 142, 167]);
    plugin.setParameters({ cl: 'Instrument9' });
    assert.deepEqual(pixel(0), [136, 130, 144]);
    plugin.constructor.timbreColorMode = 'Winner';
    plugin.paintHistoryImage();
    assert.deepEqual(pixel(0), [76, 120, 184], 'the internal switch restores the nine-class winner color');
    plugin.setParameters({ cl: 'Instrument3' });
    assert.deepEqual(pixel(0), [156, 156, 156], 'the winner switch uses the three-class aggregate');
    plugin.constructor.timbreColorMode = 'Probability';
    plugin.setParameters({ cl: 'Instrument9' });
    assert.deepEqual(pixel(0), [136, 130, 144]);
    assert.equal(plugin.timbreNotes.size, 1);
    plugin.handleTimbreTelemetry(createTimbreFrame({ event: 3, frameIndex: 15, endFrameIndex: 15 }));
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 15, timeSeconds: 1.05, levels: [1, 1, 1, 1, 1] }));
    const latestColumn = plugin.writeColumn - 1;
    plugin.handleTimbreTelemetry(createTimbreFrame({ event: 1, noteId: 2, startFrameIndex: 15, frameIndex: 17 }));
    assert.equal(plugin._timbreForColumn(latestColumn, 21).probabilities, null);
    plugin.handleTimbreTelemetry(createTimbreFrame({ noteId: 2, startFrameIndex: 15, frameIndex: 19,
        probabilities: [0, 0, 0, 0, 0, 0, 0, 0, 1] }));
    for (let frame = 0; frame < 3; frame++) plugin.flushTimbreHistory();
    assert.deepEqual(pixel(latestColumn), [214, 107, 94]);
    assert.deepEqual(pixel(0), [136, 130, 144]);
    for (let division = 0; division < 5; division++) {
        assert.deepEqual(Array.from(plugin._noteDisplayColor(latestColumn, 20.6 + division / 5, 1, plugin._displayPalette())),
            [214, 107, 94]);
    }
    plugin.setParameters({ cl: 'Normal', os: false });
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 20, timeSeconds: 1.1, levels: [1] }));
    const offColumn = plugin.writeColumn - 1;
    plugin.setParameters({ cl: 'Instrument3' });
    assert.equal(plugin._timbreForColumn(offColumn, 21), null);
    plugin.clearHistory();
    assert.equal(plugin.timbreNotes.size, 0);
    assert.equal(plugin.timbreDirtyRanges.length, 0);
});

test('instrument colors keep unclassified history, volume and meters neutral in both themes', async () => {
    for (const background of [[0, 0, 0], [250, 250, 250]]) {
        for (const cl of ['Instrument3', 'Instrument9']) {
            const plugin = await loadPlugin({ background });
            plugin.setParameters({ cl, pr: 'High', vl: false, mn: 21, mx: 21 });
            plugin.initializeDisplayCanvas(new FakeElement('canvas'));
            plugin.drawGraph = () => {};
            const palette = plugin._displayPalette();
            const neutral = column => {
                for (const confidence of [.2, 1]) {
                    assert.deepEqual(Array.from(plugin._noteDisplayColor(column, 21, confidence, palette)),
                        [116, 116, 116]);
                }
                plugin._writePixels(column, palette);
                assert.deepEqual(Array.from(plugin.imageData.data.subarray((439 * historyWidth + column) * 4,
                    (439 * historyWidth + column) * 4 + 3)), [116, 116, 116]);
                assert.equal(plugin._volumeBarShape(column * pitchCount,
                    { midi: 21, best: 2, confidence: 1 }, 100, palette).fill, 'rgba(116, 116, 116, 1)');
                const gradients = [];
                plugin._drawVolumeMeters({ createRadialGradient: (...coordinates) => {
                    const gradient = createGradient('radial', coordinates);
                    gradients.push(gradient);
                    return gradient;
                }, ...volumePathStubs, arc() {} }, 200, 100, palette);
                if (plugin.vl) assert.equal(gradients[0]?.stops[0].color, 'rgba(116, 116, 116, 0.65)');
            };
            assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, palette)), [116, 116, 116],
                'missing source history is neutral');
            plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [1, 1, 1, 1, 1],
                volumeLevels: [-12, -12, -12, -12, -12] }));
            neutral(0); // Also represents weak candidates and notes sounding before timbre was enabled.
            plugin.handleTimbreTelemetry(createTimbreFrame({ event: 1, frameIndex: 18 }));
            plugin.vl = true;
            neutral(0); // A known note still awaiting its result.
            plugin.hl = 'Vocal';
            assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, palette)), [116, 116, 116]);
            plugin.hl = 'None';
            plugin.handleTimbreTelemetry(createTimbreFrame({ event: 3, frameIndex: 19, endFrameIndex: 11 }));
            plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 20, timeSeconds: 1.1,
                levels: [1, 1, 1, 1, 1], volumeLevels: [-12, -12, -12, -12, -12] }));
            neutral(plugin.writeColumn - 1); // The current column is outside every classified interval.
            plugin.displayOptions = { noteColor: () => [20, 120, 180] };
            assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, palette)), [20, 120, 180]);
            assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, palette, [30, 140, 190])), [30, 140, 190]);
        }
    }
});

test('instrument category colors stay distinct and agree between three and nine classes', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ cl: 'Instrument9' });
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [1] }));
    const colors = ['4C78B8', 'C99A3B', '8F72C7', '4C9B73', '469EA8', 'BD6FA2', 'A67D60', '9C9C9C', 'D66B5E']
        .map(hex => hex.match(/../g).map(channel => parseInt(channel, 16)));
    for (let category = 0; category < colors.length; category++) {
        const probabilities = Array(9).fill(0);
        probabilities[category] = 1;
        plugin.handleTimbreTelemetry(createTimbreFrame({ probabilities }));
        plugin.cl = 'Instrument9';
        assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, plugin._displayPalette())), colors[category]);
        plugin.cl = 'Instrument3';
        assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, plugin._displayPalette())),
            colors[category === 0 || category === 8 ? category : 7]);
    }
});

test('highlight preserves color overrides and volume geometry, dims uncertain notes, and reads target probability', async () => {
    const readoutWindow = {};
    vm.runInNewContext(await fs.readFile(path.join(repoRoot, 'plugins/graph-readout.js'), 'utf8'), { window: readoutWindow });
    for (const background of [[0, 0, 0], [250, 250, 250]]) {
        const plugin = await loadPlugin({ background, graphReadout: readoutWindow.GraphReadout });
        plugin.setParameters({ cl: 'Rainbow', hl: 'Vocal', mn: 21, mx: 21 });
        plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [0, 0, 1], volumeLevels: [-240, -240, -12] }));
        plugin.displayOptions = { noteColor: () => [20, 120, 180], signalColor: () => ({ rgb: [30, 140, 190], alpha: .75 }) };
        const palette = plugin._displayPalette();
        const pending = plugin._volumeBarShape(0, { midi: 21, best: 2, confidence: 1 }, 100, palette);
        plugin.handleTimbreTelemetry(createTimbreFrame({ probabilities: [0, 0, 0, 0, 0, 0, 0, 0, 1] }));
        for (let frame = 0; frame < 3; frame++) plugin.flushTimbreHistory();
        const certain = plugin._volumeBarShape(0, { midi: 21, best: 2, confidence: 1 }, 100, palette);
        assert.equal(pending.half, certain.half);
        assert.equal(pending.center, certain.center);
        assert.notEqual(pending.fill, certain.fill);
        assert.ok(certain.fill.startsWith('rgba(30, 140, 190,'), 'external signal color wins');
        assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, palette)), [20, 120, 180]);
        for (const horizontal of [true, false]) {
            plugin._readoutFrame = { valid: true, horizontal, canvasWidth: horizontal ? 100 : historyWidth,
                rollWidth: historyWidth, rowHeight: 100, columnWidth: 1, scrollPhase: 0,
                phaseOffset: 0, split: plugin.writeColumn, palette };
            const readout = plugin._readNote(horizontal ? 50 : historyWidth - .5, horizontal ? historyWidth - .5 : 50);
            assert.equal(readout.rows.at(-1).label, 'Vocal');
            assert.equal(readout.rows.at(-1).value, '100%');
        }
    }
});

test('highlight keeps strong black-key notes visible in neutral gray without brightening weak notes', async () => {
    for (const [band, strong, weak] of [[8, 94, 19], [241, 141, 228]]) {
        const plugin = await loadPlugin();
        plugin.setParameters({ cl: 'Rainbow', hl: 'Vocal', vl: false, mn: 30, mx: 30 });
        plugin.initializeDisplayCanvas(new FakeElement('canvas'));
        const palette = plugin._displayPalette();
        palette.blackBand = [band, band, band];
        const pitch = (30 - 21) * fineDivisions + fineCenter;
        const pixel = () => Array.from(plugin.imageData.data.subarray((87 - (30 - 21)) * historyWidth * 4,
            (87 - (30 - 21)) * historyWidth * 4 + 3));
        assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 30, .8, palette)), [116, 116, 116]);
        plugin.history[pitch] = .8;
        plugin._writePixels(0, palette);
        assert.deepEqual(pixel(), [strong, strong, strong]);
        assert.equal(plugin._volumeBarShape(0, { midi: 30, best: pitch, confidence: .8 }, 100, palette).fill,
            'rgba(116, 116, 116, 0.8)');
        plugin.history[pitch] = .1;
        plugin._writePixels(0, palette);
        assert.deepEqual(pixel(), [weak, weak, weak]);
    }
});

test('note readout shows probabilities for the hovered pitch and history interval only', async () => {
    const window = {};
    vm.runInNewContext(await fs.readFile(path.join(repoRoot, 'plugins/graph-readout.js'), 'utf8'), { window });
    const plugin = await loadPlugin({ graphReadout: window.GraphReadout });
    plugin.setParameters({ cl: 'Instrument3', mn: 21, mx: 22, vl: false });
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [0, 0, .7, 0, 0, 0, 0, .8] }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ frameIndex: 22, endFrameIndex: 15,
        probabilities: [.2, .2, 0, 0, 0, 0, 0, 0, .6] }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ noteId: 2, midi: 22, frameIndex: 22 }));
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 15, timeSeconds: 1.05,
        levels: [0, 0, .7, 0, 0, 0, 0, .8] }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ noteId: 3, startFrameIndex: 15, frameIndex: 27,
        probabilities: [0, 1, 0, 0, 0, 0, 0, 0, 0] }));
    const latest = plugin.writeColumn - 1;
    const values = result => Object.fromEntries(result.rows.map(row => [row.label, row.value]));
    for (const horizontal of [false, true]) {
        plugin._readoutFrame = { valid: true, horizontal, canvasWidth: horizontal ? 200 : historyWidth,
            rollWidth: historyWidth, rowHeight: 100, columnWidth: 1, scrollPhase: 0,
            phaseOffset: 0, split: plugin.writeColumn, palette: plugin._displayPalette() };
        const read = (column, midi) => {
            const u = (column - plugin.writeColumn + historyWidth) % historyWidth + .5;
            const v = (22 - midi + .5) * 100;
            return plugin._readNote(horizontal ? 200 - v : u, horizontal ? u : v);
        };
        plugin.cl = 'Instrument3';
        const past = read(0, 21), present = read(latest, 21);
        assert.deepEqual(Array.from(past.rows.slice(3), row => row.label), ['Vocal', 'Bass', 'Other']);
        assert.deepEqual(Array.from(past.rows.slice(3), row => row.value), ['60%', '20%', '20%']);
        assert.equal(values(past).Instrument, 'Vocal');
        assert.equal(values(present).Other, '100%');
        assert.equal(values(read(0, 22)).Bass, '100%', 'another pitch keeps its own result');
        assert.notEqual(past.cursor, present.cursor, 'the cursor preserves the hovered history time');
        assert.ok(past.cursor.startsWith('A0'));
        assert.equal(past.rows[0].label, 'Salience');
        assert.equal(past.rows[1].label, 'Level');
        for (const [cl, hl] of [['Instrument9', 'None'], ['Normal', 'Bass'], ['Rainbow', 'Vocal']]) {
            plugin.cl = cl;
            plugin.hl = hl;
            const result = read(0, 21);
            const groups = result.rows.filter(row => !['Salience', 'Level', 'Instrument'].includes(row.label));
            assert.deepEqual(Array.from(groups, row => row.label),
                ['Bass', 'Guitar', 'Piano', 'Strings', 'Wind', 'Synth', 'Organ', 'Other', 'Vocal']);
            assert.deepEqual(Array.from(groups, row => row.value), ['20%', '20%', '0%', '0%', '0%', '0%', '0%', '0%', '60%']);
            assert.equal(values(read(latest, 21)).Guitar, '100%', 'a same-pitch retrigger uses its own interval');
        }
        plugin.hl = 'Other3';
        assert.equal(values(read(0, 21))['Other (3)'], '20%', 'the extra aggregate target remains readable');
        plugin.columnFrames[0] = 0xffffffff;
        const missing = read(0, 21);
        assert.equal(missing.rows.length, 3);
        assert.equal(values(missing).Instrument, 'Not classified');
        plugin.columnFrames[0] = 10;
        plugin.cl = 'Normal';
        plugin.hl = 'None';
        assert.equal(read(0, 21).rows.length, 2, 'classification OFF keeps the original readout');
    }
});

test('legend hover temporarily highlights its group once per change and restores saved settings', async () => {
    for (const cl of ['Instrument3', 'Instrument9']) {
        for (const ly of ['Vertical', 'Horizontal']) {
            const pending = new Map();
            let nextFrame = 0;
            const plugin = await loadPlugin({
                requestAnimationFrame: callback => { pending.set(++nextFrame, callback); return nextFrame; },
                cancelAnimationFrame: id => pending.delete(id)
            });
            plugin.setParameters({ cl, ly, hl: 'Vocal', vl: ly === 'Horizontal' });
            const canvas = new FakeElement('canvas');
            plugin.initializeDisplayCanvas(canvas);
            plugin.canvasCtx = null;
            plugin.graphDpr = 2;
            // The common graph-coordinate helper converts CSS pixels to canvas pixels.
            plugin.getGraphCoords = (surface, event) => {
                assert.equal(surface, canvas);
                return { x: event.clientX * 2, y: event.clientY * 2 };
            };
            plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [1] }));
            plugin.handleTimbreTelemetry(createTimbreFrame({ probabilities: [.3, .5, 0, 0, 0, 0, 0, 0, .2] }));
            const saved = JSON.stringify(plugin.getParameters());
            plugin._drawTimbreLegend({ ...volumePathStubs, measureText: text => ({ width: text.length * 14 }),
                fillRect() {}, fillText() {} }, 600, 320);
            const other = plugin._legendRects.find(rect => rect.target === (cl === 'Instrument3' ? 'Other3' : 'Other9'));
            const move = rect => canvas.dispatchEvent('pointermove', {
                pointerType: 'mouse', clientX: (rect.x + 2) / 2, clientY: (rect.y + 2) / 2
            });
            let paints = 0;
            const paint = plugin.paintHistoryImage.bind(plugin);
            plugin.paintHistoryImage = () => { paints++; paint(); };
            plugin.volumeHistoryDirty = false;
            move(other);
            for (let i = 0; i < 5; i++) move(other);
            assert.equal(nextFrame, 1, 'repeated moves do not schedule or redraw again');
            assert.equal(paints, 0, 'hover does not synchronously repaint history');
            assert.equal(plugin.volumeHistoryDirty, false);
            assert.equal(plugin._effectiveHighlight(), cl === 'Instrument3' ? 'Other3' : 'Other9');
            const color = Array.from(plugin._noteDisplayColor(0, 21, 1, plugin._displayPalette()));
            const hover = plugin._legendHighlight;
            plugin._legendHighlight = null;
            plugin.hl = hover;
            assert.deepEqual(Array.from(plugin._noteDisplayColor(0, 21, 1, plugin._displayPalette())), color,
                'hover follows exactly the selected Highlight calculation');
            plugin.hl = 'Vocal';
            plugin._legendHighlight = hover;
            if (cl === 'Instrument9') assert.deepEqual(color, [116, 116, 116], 'Other (9) uses only Other probability');
            else assert.ok(color.some(channel => channel !== 116), 'Other (3) includes Guitar probability');
            assert.equal(JSON.stringify(plugin.getParameters()), saved, 'hover does not alter saved settings');
            const bass = plugin._legendRects.find(rect => rect.target === 'Bass');
            move(bass);
            assert.equal(nextFrame, 1, 'a second target shares the pending frame');
            const callback = pending.values().next().value;
            pending.clear();
            callback();
            assert.equal(paints, plugin.vl ? 0 : 1);
            assert.equal(plugin.volumeHistoryDirty, plugin.vl);
            canvas.dispatchEvent('pointerleave');
            assert.equal(plugin._effectiveHighlight(), 'Vocal');
            assert.equal(JSON.stringify(plugin.getParameters()), saved);
            move(other);
            plugin.setParameters({ cl: 'Normal' });
            assert.equal(plugin._effectiveHighlight(), 'Vocal', 'Color changes clear the transient override');
            assert.equal(plugin._legendRects.length, 0);
            plugin.cleanup();
            assert.equal(pending.size, 0, 'cleanup cancels the pending hover frame');
            assert.equal(canvas.listeners.has('pointermove'), false);
            assert.equal(canvas.listeners.has('pointerleave'), false);
        }
    }
});

test('display history rebuilds retain ongoing timbre results without another result notification', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ cl: 'Instrument9', hl: 'Vocal', mn: 21, mx: 21, vl: false });
    plugin.initializeDisplayCanvas(new FakeElement('canvas'));
    plugin.drawGraph = () => {};
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [1] }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ probabilities: [0, 0, 0, 0, 0, 0, 0, 0, 1] }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ noteId: 2, startFrameIndex: 6, endFrameIndex: 9 }));
    for (let frame = 0; frame < 3; frame++) plugin.flushTimbreHistory();
    plugin.setParameters({ ts: 3 });
    assert.equal(plugin.columnSerial, 0, 'Time Span rebuilds the displayed history');
    assert.equal(plugin.timbreNotes.size, 1, 'only ongoing notes are retained');
    assert.equal(plugin.timbreNotes.get(1)?.probabilities[8], 1);
    for (const frameIndex of [15, 1016]) {
        // The long second gap also rebuilds the history, without a DSP generation reset.
        plugin.handleTelemetry(createTelemetryFrame({ frameIndex, timeSeconds: 1 + frameIndex * .01, levels: [1] }));
        const column = (plugin.writeColumn + historyWidth - 1) % historyWidth;
        assert.equal(plugin._timbreForColumn(column, 21)?.noteId, 1);
        assert.deepEqual(Array.from(plugin._noteDisplayColor(column, 21, 1, plugin._displayPalette())), [214, 107, 94]);
        assert.deepEqual(Array.from(plugin.imageData.data.subarray((87 * historyWidth + column) * 4,
            (87 * historyWidth + column) * 4 + 3)), [214, 107, 94]);
    }
    plugin.setParameters({ ts: 4 });
    plugin.setParameters({ cl: 'Normal', hl: 'None', os: false });
    plugin.setParameters({ cl: 'Instrument9', hl: 'Vocal' });
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 1017, timeSeconds: 11.17, levels: [1] }));
    assert.equal(plugin._timbreForColumn(plugin.writeColumn - 1, 21), null,
        'timbre OFF closes the retained note even before fresh pitch telemetry arrives');
    plugin.handleTelemetry(createTelemetryFrame({ generation: 2, frameIndex: 0, timeSeconds: 12, levels: [1] }));
    assert.equal(plugin.timbreNotes.size, 0, 'a DSP generation change discards old identities');
    plugin.handleTimbreTelemetry(createTimbreFrame({ generation: 2, startFrameIndex: 0, frameIndex: 4 }));
    plugin.reset();
    assert.equal(plugin.timbreNotes.size, 0, 'a real reset discards timbre state');
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
        'Color', 'Highlight', 'Pitch Resolution', 'Layout', 'Volume', 'Onsets', 'Time Span',
        'Lowest Note', 'Highest Note'
    ]);
    const [color, highlight, resolution, layout, volume, onsets, timeSpan, lowestNote, highestNote] = rows;
    assert.deepEqual(JSON.parse(JSON.stringify(color.options)), [
        { value: 'Normal', label: 'Normal' },
        { value: 'Rainbow', label: 'Note Colors' },
        { value: 'Instrument3', label: 'Instrument (3)' },
        { value: 'Instrument9', label: 'Instrument (9)' }
    ]);
    assert.equal(color.value, 'Rainbow');
    assert.equal(color.modelKey, 'cl');
    assert.equal(highlight.value, 'None');
    assert.equal(highlight.modelKey, 'hl');
    assert.deepEqual(JSON.parse(JSON.stringify(resolution.options)), [
        { value: 'Semitone', label: '1/12 Octave' },
        { value: 'High', label: 'High' }
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
    assert.equal(onsets.value, false);
    assert.equal(onsets.modelKey, 'os');
    onsets.setter(true);
    assert.equal(plugin.os, true);
    assert.deepEqual([timeSpan.minimum, timeSpan.maximum, timeSpan.step, timeSpan.value], [1, 10, 1, 8]);
    color.setter('Normal');
    assert.equal(plugin.cl, 'Normal');
    color.setter('Heatmap');
    assert.equal(plugin.cl, 'Normal');
    color.setter('Rainbow');
    assert.equal(plugin.cl, 'Rainbow');
    timeSpan.setter(12);
    assert.equal(plugin.ts, 10);
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

test('Note Spectrogram validates its version 6 telemetry payload', async () => {
    const plugin = await loadPlugin();
    const levels = Array.from({ length: pitchCount }, (_, pitch) => pitch / (pitchCount - 1));
    const volumeLevels = Array.from({ length: pitchCount }, (_, pitch) => -120 + pitch / 10);
    const frame = createTelemetryFrame({
        frameIndex: 42, hopSeconds: 0.0125, generation: 7, levels, volumeLevels,
        pitchCents: [7.375, -33.625, 53.875]
    });
    const snapshot = plugin.parseTelemetryFrame(frame);

    assert.equal(snapshot.sampleRate, 48000);
    assert.equal(snapshot.timeSeconds, 1);
    assert.ok(Math.abs(snapshot.hopSeconds - 0.0125) < 1e-7);
    assert.equal(snapshot.frameIndex, 42);
    assert.equal(snapshot.modeCode, fineDivisions);
    assert.equal(snapshot.generation, 7);
    assert.deepEqual(Array.from(snapshot.pitchCents.slice(0, 3)), [7.375, -33.625, 53.875]);
    frame.payload.setFloat32(centsOffset, 0, true);
    assert.equal(snapshot.pitchCents[0], 7.375, 'parsed estimates own their storage');
    for (let pitch = 0; pitch < pitchCount; pitch++) {
        assert.ok(Math.abs(snapshot.levels[pitch] - levels[pitch]) < 1e-6);
        assert.ok(Math.abs(snapshot.volumeLevels[pitch] - volumeLevels[pitch]) < 1e-5);
    }
    assert.equal(snapshot.revisionAge, 0);
    assert.equal(snapshot.revisedLevels, null);
    const revised = plugin.parseTelemetryFrame(createTelemetryFrame({
        frameIndex: 42, revisionAge: 8, revisedLevels: [0.25, 1]
    }));
    assert.equal(revised.revisionAge, 8);
    assert.deepEqual(Array.from(revised.revisedLevels.subarray(0, 3)), [0.25, 1, 0]);

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
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({ pitchCents: [NaN] })), null);
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({ pitchCents: [Infinity] })), null);
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({ revisionAge: 7 })), null);
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({
        revisionAge: 8, revisedLevels: [1.01]
    })), null);
    assert.equal(plugin.parseTelemetryFrame(createTelemetryFrame({
        revisionAge: 8, revisedLevels: [NaN]
    })), null);
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
    assert.equal(plugin.volumeLevelHistory[0], -48);

    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 1, timeSeconds: 1.01, levels: [1], volumeLevels: [-12]
    }));
    assert.equal(plugin.levelReference, -12);
    assert.equal(plugin.levelHistory[0], 0.5);
    assert.equal(plugin.volumeLevelHistory[0], -48);
    assert.equal(plugin.volumeLevelHistory[(plugin.writeColumn - 1) * pitchCount], -12);
});

test('history readout includes measured dB for the displayed pitch in both layouts', async () => {
    const window = {};
    const readoutSource = await fs.readFile(path.join(repoRoot, 'plugins', 'graph-readout.js'), 'utf8');
    vm.runInNewContext(readoutSource, { window });
    const plugin = await loadPlugin({ graphReadout: window.GraphReadout });
    plugin.setParameters({ mn: 21, mx: 21 });
    plugin.handleTelemetry(createTelemetryFrame({
        levels: [0.7, 0, 0.2, 0, 0.8], volumeLevels: [-12, -240, -42.5, -240, -9]
    }));
    for (const ly of ['Horizontal', 'Vertical']) {
        for (const pr of ['Semitone', 'High']) {
            for (const vl of [true, false]) {
                plugin.setParameters({ ly, pr, vl });
                const horizontal = ly === 'Horizontal';
                plugin._readoutFrame = {
                    valid: true, horizontal, canvasWidth: horizontal ? 100 : historyWidth,
                    rollWidth: historyWidth, rowHeight: 100, columnWidth: 1,
                    scrollPhase: 0, phaseOffset: 0, split: plugin.writeColumn,
                    palette: { trace: [0, 255, 0] }
                };
                const readout = plugin._readNote(horizontal ? 50 : historyWidth - 0.5,
                    horizontal ? historyWidth - 0.5 : 50);
                assert.ok(readout.cursor.startsWith('A0 +0¢ · '));
                assert.deepEqual(Array.from(readout.rows, row => [row.label, row.value]), [
                    ['Salience', '80%'],
                    ['Level', '−9.0 dB']
                ]);
                assert.equal(readout.rows[1].color, readout.rows[0].color);
            }
        }
    }
    assert.equal(plugin._readNote(0.5, 50).rows[1].value, '—', 'unwritten history has no level');
    plugin.clearHistory();
    assert.equal(plugin._readNote(historyWidth - 0.5, 50).rows[1].value, '—');
});

test('history crosshair follows the pointer as detected pitches change in both layouts', async () => {
    const window = {};
    vm.runInNewContext(await fs.readFile(path.join(repoRoot, 'plugins/graph-readout.js'), 'utf8'), { window });
    const plugin = await loadPlugin({ graphReadout: window.GraphReadout });
    plugin.setParameters({ mn: 21, mx: 21 });
    let frameIndex = 0;
    for (const ly of ['Horizontal', 'Vertical']) {
        for (const pr of ['High', 'Semitone']) {
            plugin.setParameters({ ly, pr });
            const horizontal = ly === 'Horizontal';
            for (const [cents, confidence] of [[-30, .8], [25, .8], [0, 0]]) {
                plugin.handleTelemetry(createTelemetryFrame({
                    frameIndex, timeSeconds: 1 + frameIndex * .01,
                    levels: [0, 0, confidence], pitchCents: [cents]
                }));
                frameIndex++;
                plugin._readoutFrame = {
                    valid: true, horizontal, canvasWidth: horizontal ? 100 : historyWidth,
                    rollWidth: historyWidth, rowHeight: 100, columnWidth: 1,
                    scrollPhase: 0, phaseOffset: 0, split: plugin.writeColumn,
                    palette: plugin._displayPalette()
                };
                for (const pitchPosition of [37.25, 38.5]) {
                    const x = horizontal ? 100 - pitchPosition : historyWidth - .375;
                    const y = horizontal ? historyWidth - .375 : pitchPosition;
                    const readout = plugin._readNote(x, y);
                    assert.equal(readout.at.x, x, `${ly} ${pr} at ${cents} cents`);
                    assert.equal(readout.at.y, y, `${ly} ${pr} at ${cents} cents`);
                    assert.ok(readout.rows.every(row => row.y === y), 'markers stay at the pointer');
                    assert.equal(readout.rows[0].value, confidence ? '80%' : '0%');
                    if (confidence) {
                        const midi = 21 + (pr === 'High' ? cents / 100 : 0);
                        const note = window.GraphReadout.format.note(440 * 2 ** ((midi - 69) / 12));
                        assert.ok(readout.cursor.startsWith(`${note} · `), 'readout retains the detected pitch');
                    }
                }
            }
        }
    }
});

test('High draws and reads unrounded pitch estimates with Volume on and off in both layouts', async () => {
    const window = {};
    vm.runInNewContext(await fs.readFile(path.join(repoRoot, 'plugins/graph-readout.js'), 'utf8'), { window });
    const plugin = await loadPlugin({ graphReadout: window.GraphReadout });
    plugin.setParameters({ mn: 21, mx: 23, pr: 'High', cl: 'Instrument9' });
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 10, levels: [0, 0, 1],
        pitchCents: [53.875], volumeLevels: [-240, -240, -12] }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ event: 1, frameIndex: 12 }));
    plugin.handleTimbreTelemetry(createTimbreFrame({ probabilities: [1, 0, 0, 0, 0, 0, 0, 0, 0] }));
    for (const vl of [true, false]) {
        for (let frame = 0; frame < 3; frame++) plugin.flushTimbreHistory();
        plugin.setParameters({ vl });
        const shape = plugin._volumeShapesForColumn(0, 100, plugin._displayPalette())[0];
        assert.ok(Math.abs(shape.center - 196.125) < 1e-8);
        assert.equal(shape.fill, 'rgba(76, 120, 184, 1)', 'classification belongs to A0 even above +50 cents');
        if (!vl) assert.equal(shape.half, 10, 'Volume off retains fixed thickness at the exact pitch');
        for (const horizontal of [true, false]) {
            plugin._readoutFrame = { valid: true, horizontal, canvasWidth: horizontal ? 300 : historyWidth,
                rollWidth: historyWidth, rowHeight: 100, columnWidth: 1, scrollPhase: 0,
                phaseOffset: 0, split: plugin.writeColumn, palette: plugin._displayPalette() };
            const readout = plugin._readNote(horizontal ? 300 - shape.center : historyWidth - .5,
                horizontal ? historyWidth - .5 : shape.center);
            assert.ok(readout.cursor.startsWith('A#0 −46¢ · '), readout.cursor);
            assert.equal(readout.rows.find(row => row.label === 'Instrument').value, 'Bass');
            assert.ok(Math.abs((horizontal ? 300 - readout.at.x : readout.at.y) - shape.center) < 1e-8);
            const empty = plugin._readNote(horizontal ? 50 : historyWidth - .5,
                horizontal ? historyWidth - .5 : 250);
            assert.deepEqual(Array.from(empty.rows.slice(0, 2), row => row.value), ['0%', '—']);
            assert.equal(empty.rows.find(row => row.label === 'Instrument').value, 'Not classified');
        }
    }
});

test('merged and revised history retains the winning frame\'s original cent estimate', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ ts: 10, pr: 'High' });
    for (const [frameIndex, confidence, cents] of [[0, .8, 7.375], [1, .9, -33.625], [2, .4, 53.875]]) {
        plugin.handleTelemetry(createTelemetryFrame({ frameIndex, hopSeconds: .004,
            timeSeconds: 1 + frameIndex * .004, levels: [confidence], pitchCents: [cents] }));
    }
    assert.equal(plugin.writeColumn, 1);
    assert.equal(plugin.pitchCentsHistory[0], -33.625);
    plugin.handleTelemetry(createTelemetryFrame({ frameIndex: 8, hopSeconds: .004, timeSeconds: 1.032,
        levels: [.5], pitchCents: [22.125], revisionAge: 8, revisedLevels: [1] }));
    assert.equal(plugin.pitchCentsHistory[0], 7.375, 'revised confidence selects the original estimate');
    assert.equal(plugin.pitchCentsHistory[noteCount], 0, 'missing hops remain blank');
    assert.equal(plugin.pitchCentsHistory[(plugin.writeColumn - 1) * noteCount], 22.125);
    plugin.clearHistory();
    assert.ok(plugin.pitchCentsHistory.every(cents => cents === 0));
});

test('frames merged into one history column retain their peak measured dB', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ ts: 10 });
    for (const [frameIndex, level] of [-48, -70, -24].entries()) {
        plugin.handleTelemetry(createTelemetryFrame({
            frameIndex, hopSeconds: 0.004, timeSeconds: 1 + frameIndex * 0.004,
            levels: [1], volumeLevels: [level]
        }));
        assert.equal(plugin.writeColumn, 1);
        assert.equal(plugin.volumeLevelHistory[0], frameIndex < 2 ? -48 : -24);
    }
});

test('Volume bars map level to thickness and pitch resolution to center position', async () => {
    const plugin = await loadPlugin();
    const context = createVolumeContext();
    const shapes = () => context.events.filter(event => event.type === 'shape').map(event =>
        event.path.map(([kind, ...values]) => [kind, ...values.map(value => Math.round(value * 1e8) / 1e8)]));
    plugin.volumeHistoryCanvas = { width: historyWidth, height: 100, getContext: () => context };
    plugin.mn = 21;
    plugin.mx = 21;
    plugin.pr = 'High';
    plugin.writeColumn = 1;
    plugin.history[0] = 1;
    plugin.pitchCentsHistory[0] = -33.75;
    plugin.levelHistory[0] = 0;
    plugin.volumeHistoryDirty = true;
    plugin._paintVolumeHistory(100, plugin._displayPalette());
    assert.deepEqual(shapes(), [[['ellipse', 1, 83.75, 1, 10]]]);

    context.events.length = 0;
    plugin.levelHistory[0] = 1;
    plugin.volumeHistoryDirty = true;
    plugin._paintVolumeHistory(100, plugin._displayPalette());
    assert.deepEqual(shapes(), [[['ellipse', 1, 83.75, 1, 49.5]]]);

    context.events.length = 0;
    plugin.pr = 'Semitone';
    plugin.levelHistory[0] = 0;
    plugin.volumeHistoryDirty = true;
    plugin._paintVolumeHistory(100, plugin._displayPalette());
    assert.deepEqual(shapes(), [[['ellipse', 1, 50, 1, 10]]]);
});

test('Volume frames join overlapping bars across held columns and round off the rest', async () => {
    const plugin = await loadPlugin();
    const context = createVolumeContext();
    const shapes = () => context.events.filter(event => event.type === 'shape');
    const round = path => path.map(([kind, ...values]) =>
        [kind, ...values.map(value => Math.round(value * 100) / 100)]);
    plugin.volumeHistoryCanvas = { width: historyWidth, height: 100, getContext: () => context };
    plugin.mn = 21;
    plugin.mx = 21;
    plugin.pr = 'High';
    plugin.writeColumn = 4;
    plugin.volumeFrameEnds[1] = 0;
    plugin.volumeFrameEnds[2] = 0;
    plugin.history[2] = 1;
    const current = 3 * pitchCount;
    plugin.history[current + 2] = 0.5;
    plugin.history[current + 3] = 1;
    plugin.pitchCentsHistory[3 * noteCount] = 16.75;

    plugin.volumeHistoryDirty = true;
    plugin._paintVolumeHistory(100, plugin._displayPalette());
    const [onset, band] = shapes();
    assert.deepEqual(onset.path, [['ellipse', 1, 50, 1, 10]]);
    // The center follows the reported estimate, independently of the fine-bin peak.
    assert.deepEqual(round(band.path),
        [['point', 1, 40], ['point', 4, 23.25], ['point', 4, 43.25], ['point', 1, 60]]);
    assert.deepEqual(JSON.parse(band.color).coordinates, [1, 0, 4, 0]);

    plugin.history.fill(0, current, current + pitchCount);
    context.events.length = 0;
    plugin._paintVolumeColumns(3, 1);
    assert.deepEqual(shapes().map(shape => shape.path), [[['ellipse', 1, 50, 3, 10]]]);
});

test('High pitch traces stay connected within a semitone even when their widths do not overlap', async () => {
    for (const volume of [false, true]) {
        const plugin = await loadPlugin();
        const context = createVolumeContext();
        plugin.mn = plugin.mx = 21;
        plugin.pr = 'High';
        plugin.vl = volume;
        plugin.writeColumn = 2;
        plugin.history[2] = plugin.history[pitchCount + 2] = 1;
        plugin.pitchCentsHistory[0] = -40;
        plugin.pitchCentsHistory[noteCount] = 40;
        plugin._paintVolumeFrame(context, 1, 100, 100, plugin._displayPalette(), true);
        const shapes = context.events.filter(event => event.type === 'shape');
        assert.equal(shapes.length, 1);
        assert.deepEqual(shapes[0].path.map(([kind, ...values]) =>
            [kind, ...values.map(value => Math.round(value))]),
        [['point', 1, 80], ['point', 2, 0], ['point', 2, 20], ['point', 1, 100]]);
    }
});

test('overlapping neighboring traces preserve their own continuations without duplicate links', async () => {
    const plugin = await loadPlugin();
    const context = createVolumeContext();
    plugin.mn = 21;
    plugin.mx = 22;
    plugin.pr = 'High';
    plugin.vl = true;
    plugin.writeColumn = 2;
    plugin.history[2] = plugin.history[7] = 1;
    plugin.history[pitchCount + 2] = plugin.history[pitchCount + 7] = 1;
    plugin.levelHistory.fill(1);
    plugin.pitchCentsHistory[0] = 49;
    plugin.pitchCentsHistory[1] = -49;
    plugin.pitchCentsHistory[noteCount] = 49;
    plugin.pitchCentsHistory[noteCount + 1] = -40;
    plugin._paintVolumeFrame(context, 1, 200, 100, plugin._displayPalette(), true);
    let shapes = context.events.filter(event => event.type === 'shape');
    assert.equal(shapes.length, 2);
    assert.ok(shapes.every(shape => shape.path.every(([kind]) => kind === 'point')));
    assert.notEqual(shapes[0].path[0][2], shapes[1].path[0][2]);

    // A new adjacent note must not also reuse the continuing note's old bar.
    plugin.history[7] = 0;
    context.events.length = 0;
    plugin._paintVolumeFrame(context, 1, 200, 100, plugin._displayPalette(), true);
    shapes = context.events.filter(event => event.type === 'shape');
    assert.equal(shapes.length, 2);
    assert.equal(shapes[0].path[0][0], 'point');
    assert.equal(shapes[1].path[0][0], 'ellipse');
});

test('incremental Volume redraw matches the full redraw of the latest frame', async () => {
    const plugin = await loadPlugin();
    const context = createVolumeContext();
    const shapes = () => context.events.filter(event => event.type === 'shape');
    plugin.vl = true;
    plugin.pr = 'High';
    plugin.mn = 21;
    plugin.mx = 22;
    plugin.volumeHistoryCanvas = { width: historyWidth, height: 20, getContext: () => context };
    plugin.writeColumn = 1;
    plugin.history[4] = 1;
    plugin.levelHistory[4] = 1;
    plugin.volumeHistoryDirty = true;
    plugin._paintVolumeHistory(20, plugin._displayPalette());
    const fullRedraw = shapes();

    context.events.length = 0;
    plugin._paintVolumeColumns(0, 1);
    assert.deepEqual(shapes(), fullRedraw);
    assert.match(fullRedraw[0].color, /rgba\(0, 255, 0, 1\)/);
});

test('Volume bars use theme-appropriate compositing without confidence sorting', async () => {
    for (const { background, composite } of [
        { background: [0, 0, 0], composite: 'lighter' },
        { background: [255, 255, 255], composite: 'darken' }
    ]) {
        const plugin = await loadPlugin({ background });
        const context = createVolumeContext();
        plugin.vl = true;
        plugin.cl = 'Rainbow';
        plugin.mn = 24;
        plugin.mx = 25;
        plugin.graphDpr = 2;
        plugin.writeColumn = 1;
        plugin.volumeHistoryCanvas = { width: historyWidth, height: 20, getContext: () => context };
        const cPitch = (24 - 21) * fineDivisions;
        const sharpPitch = (25 - 21) * fineDivisions;
        plugin.history[cPitch] = 0.8;
        plugin.history[sharpPitch] = 0.3;
        plugin.levelHistory[cPitch] = 1;
        plugin.levelHistory[sharpPitch] = 1;

        const verifyOrder = () => {
            const guide = context.events.findIndex(event => event.color === 'stub:graph-grid-strong');
            const bars = context.events.map((event, index) => ({ ...event, index }))
                .filter(event => event.type === 'shape');
            assert.equal(bars.length, 2);
            assert.ok(guide >= 0 && guide < bars[0].index);
            for (const event of context.events) {
                assert.equal(event.composite, event.type === 'shape' ? composite : 'source-over');
            }
            assert.equal(context.globalCompositeOperation, 'source-over');
        };
        const layerColors = () => context.events.map(event => event.color).filter(color =>
            color === 'stub:graph-grid-strong' || color.startsWith('rgba('));

        plugin.volumeHistoryDirty = true;
        plugin._paintVolumeHistory(20, plugin._displayPalette());
        verifyOrder();
        const bars = plugin._volumeBarsForColumn(0);
        assert.deepEqual(Array.from(bars, bar => bar.midi), [24, 25]);
        assert.ok(bars[0].confidence > bars[1].confidence);
        const fullRedraw = layerColors();

        context.events.length = 0;
        plugin._paintVolumeColumns(0, 1);
        verifyOrder();
        assert.deepEqual(layerColors(), fullRedraw);

        plugin.history[sharpPitch] = plugin.history[cPitch];
        assert.deepEqual(Array.from(plugin._volumeBarsForColumn(0), bar => bar.midi), [24, 25]);
    }
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
    assert.deepEqual(gradients[0].stops.map(stop => stop.color), [
        'rgba(0, 255, 0, 0.65)', 'rgba(0, 255, 0, 0.65)', 'rgba(0, 255, 0, 0)'
    ]);
    plugin.displayOptions = { signalColor: () => ({ rgb: [255, 128, 64], alpha: .5 }) };
    plugin._drawVolumeMeters(context, 100, 20, palette);
    assert.equal(gradients[1].stops[0].color, 'rgba(255, 128, 64, 0.325)');
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
        ...keyShadingStubs,
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

    assert.equal(subscriptions.length, 2);
    assert.deepEqual(
        { tapId: subscriptions[0].tapId, frameType: subscriptions[0].frameType },
        { tapId: 31, frameType: 24 }
    );
    subscriptions[0].handler(createTelemetryFrame({ levels: [0.8] }));
    assert.equal(plugin.writeColumn, 1);
    assert.ok(Math.abs(plugin.history[0] - 0.8) < 1e-6);

    plugin.cleanup();
    assert.equal(plugin.volumeLevelHistory, null);
    assert.equal(unsubscribeCount, 2);
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
    assert.equal(subscriptions.length, 2);
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
        frameIndex: 0, timeSeconds: 1, levels: [0.8], volumeLevels: [-48]
    }));
    normal.handleTelemetry(createTelemetryFrame({
        frameIndex: 1, timeSeconds: 1.01, levels: [0.5], volumeLevels: [-12]
    }));
    assert.equal(normal.writeColumn, 6);
    assert.deepEqual(
        firstPitchPresenceBytesByColumn(normal, 0, 6),
        [204, 204, 204, 204, 204, 128]
    );
    assert.deepEqual(Array.from({ length: 6 }, (_, column) => normal.volumeLevelHistory[column * pitchCount]),
        [-48, -48, -48, -48, -48, -12]);

    const dropped = await loadPlugin();
    dropped.setParameters({ ts: 10 });
    dropped.handleTelemetry(createTelemetryFrame({
        frameIndex: 0, timeSeconds: 2, levels: [0.8], volumeLevels: [-48]
    }));
    dropped.handleTelemetry(createTelemetryFrame({
        frameIndex: 5, timeSeconds: 2.05, levels: [0.5], volumeLevels: [-12]
    }));
    assert.equal(dropped.writeColumn, 6);
    assert.deepEqual(firstPitchPresenceBytesByColumn(dropped, 0, 6), [204, 0, 0, 0, 0, 128]);
    assert.deepEqual(Array.from({ length: 6 }, (_, column) => dropped.volumeLevelHistory[column * pitchCount]),
        [-48, NaN, NaN, NaN, NaN, -12]);

    dropped.setParameters({ ts: 1 });
    assert.equal(dropped.lastFrameIndex, null);
    assert.equal(dropped.writeColumn, 0);
    assert.equal(dropped.history.some(value => value !== 0), false);
    assert.equal(dropped.volumeLevelHistory.some(Number.isFinite), false);
});

test('40, 80 and 160 ms revisions progressively update the same historical frame', async () => {
    const plugin = await loadPlugin();
    plugin.initializeDisplayCanvas(new FakeElement('canvas'));
    for (let frameIndex = 0; frameIndex <= 8; frameIndex++) {
        const levels = frameIndex === 0 ? [0.1] : [0.7];
        const revisions = frameIndex === 2 ? [{ age: 2, levels: [0.3] }]
            : frameIndex === 4 ? [{ age: 4, levels: [0.6] }] : [];
        plugin.handleTelemetry(createTelemetryFrame({
            frameIndex, hopSeconds: 0.02, timeSeconds: 1 + frameIndex * 0.02,
            levels, revisions, revisionAge: frameIndex === 8 ? 8 : 0, revisedLevels: [0.9]
        }));
        const expected = frameIndex >= 8 ? 0.9 : frameIndex >= 4 ? 0.6 : frameIndex >= 2 ? 0.3 : 0.1;
        assert.ok(Math.abs(plugin.history[0] - expected) < 1e-6, `frame ${frameIndex}`);
        if (frameIndex > 0) {
            const latest = (plugin.writeColumn + historyWidth - 1) % historyWidth;
            assert.ok(Math.abs(plugin.history[latest * pitchCount] - 0.7) < 1e-6);
        }
    }
});

test('one telemetry frame owns and applies all three revision planes', async () => {
    const plugin = await loadPlugin();
    plugin.initializeDisplayCanvas(new FakeElement('canvas'));
    for (let frameIndex = 0; frameIndex < 8; frameIndex++) {
        plugin.handleTelemetry(createTelemetryFrame({
            frameIndex, hopSeconds: 0.02, timeSeconds: 1 + frameIndex * 0.02, levels: [0.1]
        }));
    }
    const frame = createTelemetryFrame({ frameIndex: 8, hopSeconds: 0.02, timeSeconds: 1.16,
        revisions: [{ age: 2, levels: [0.3] }, { age: 4, levels: [0.6] }],
        revisionAge: 8, revisedLevels: [0.9] });
    const snapshot = plugin.parseTelemetryFrame(frame);
    assert.deepEqual(Array.from(snapshot.revisions, revision => revision.age), [2, 4, 8]);
    plugin.handleTelemetry(frame);
    for (const [frameIndex, expected] of [[6, 0.3], [4, 0.6], [0, 0.9]]) {
        const column = frameIndex === 0 ? 0 : Math.floor(frameIndex * 0.02 * historyWidth / 2);
        assert.ok(Math.abs(plugin.history[column * pitchCount] - expected) < 1e-6);
    }
    frame.payload.setFloat32(intermediateOffset + 4, NaN, true);
    assert.equal(plugin.parseTelemetryFrame(frame), null);
    assert.ok(Math.abs(snapshot.revisions[0].levels[0] - 0.3) < 1e-6);
});

test('revisions rewrite the revised frame columns, including repeated gap columns', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ ts: 2 });
    for (let frameIndex = 0; frameIndex <= 7; frameIndex++) {
        plugin.handleTelemetry(createTelemetryFrame({
            frameIndex, timeSeconds: 1 + frameIndex * 0.01, levels: [frameIndex === 0 ? 0.8 : 0.5]
        }));
    }
    assert.deepEqual(firstPitchPresenceBytesByColumn(plugin, 0, 6), [204, 204, 204, 204, 204, 128]);
    let painted = 0;
    plugin.paintColumns = (start, count) => { painted += count; };
    let volumePaint = null;
    plugin._paintVolumeColumns = (start, count) => { volumePaint = [start, count]; };
    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 8, timeSeconds: 1.08, levels: [0.5], revisionAge: 8, revisedLevels: [0.25]
    }));
    assert.deepEqual(firstPitchPresenceBytesByColumn(plugin, 0, 6), [64, 64, 64, 64, 64, 128]);
    // Five columns for the new frame plus the five revised columns.
    assert.equal(painted, 10);
    // Volume repaints through the next frame's end column (5), which links to the revised frame.
    assert.deepEqual(volumePaint, [0, 6]);

    for (let frameIndex = 9; frameIndex <= 30; frameIndex++) {
        plugin.handleTelemetry(createTelemetryFrame({
            frameIndex, timeSeconds: 1 + frameIndex * 0.01, levels: [0.5],
            revisionAge: 8, revisedLevels: [0.25]
        }));
    }
    // Only the revisable frames and an older frame sharing their first column remain.
    assert.ok(plugin.frameRecords.length <= 9);
});

test('a revision of a merged column keeps the max of its other frames', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ ts: 10 });
    // Three 4 ms frames share the first 9.8 ms column.
    const levels = [0.2, 0.9, 0.4, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
    for (let frameIndex = 0; frameIndex <= 8; frameIndex++) {
        plugin.handleTelemetry(createTelemetryFrame({
            frameIndex, hopSeconds: 0.004, timeSeconds: 1 + frameIndex * 0.004,
            levels: [levels[frameIndex]]
        }));
    }
    assert.ok(Math.abs(plugin.history[0] - 0.9) < 1e-6);
    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 9, hopSeconds: 0.004, timeSeconds: 1.036, levels: [0.1],
        revisionAge: 8, revisedLevels: [0.3]
    }));
    assert.ok(Math.abs(plugin.history[0] - 0.4) < 1e-6);
    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 10, hopSeconds: 0.004, timeSeconds: 1.04, levels: [0.1],
        revisionAge: 8, revisedLevels: [1]
    }));
    assert.equal(plugin.history[0], 1);
});

test('Volume rendering skips invisible candidates before color and path creation', async () => {
    const plugin = await loadPlugin();
    const context = createVolumeContext();
    plugin.mn = 21;
    plugin.mx = 22;
    plugin.writeColumn = 2;
    let colors = 0;
    plugin._noteDisplayColor = () => { colors++; return [255, 128, 64]; };
    const draw = () => {
        context.events.length = 0;
        colors = 0;
        plugin._paintVolumeFrame(context, 1, 100, 50, plugin._displayPalette(), true);
        return context.events.filter(event => event.type === 'shape');
    };
    for (const pr of ['Semitone', 'High']) {
        plugin.pr = pr;
        for (const confidence of [0, 0.000001, 0.49 / 255]) {
            plugin.history.fill(confidence);
            assert.equal(draw().length, 0);
            assert.equal(colors, 0, 'invisible candidates do not need color lookup or shape construction');
            assert.equal(plugin.history[0], Math.fround(confidence), 'analysis history stays intact');
        }
        plugin.history.fill(0.51 / 255);
        assert.equal(draw().length, 2, 'the first representable alpha still draws both notes');
    }
    plugin.history.fill(1);
    plugin.displayOptions = { signalColor: () => ({ rgb: [255, 128, 64], alpha: 0.000001 }) };
    assert.equal(draw().length, 0, 'custom signal opacity also determines visibility');
    assert.equal(colors, 0);
    plugin.history.fill(0.000001);
    plugin.displayOptions.signalColor = () => ({ rgb: [255, 128, 64], alpha: .5 });
    assert.equal(draw().length, 2, 'custom signal opacity already includes its intensity mapping');
});

test('Volume revisions recover invisible candidates without changing stored level or thickness', async () => {
    for (const confidence of [0.1, 0.000001]) {
        const plugin = await loadPlugin();
        plugin.mn = plugin.mx = 21;
        plugin.handleTelemetry(createTelemetryFrame({
            frameIndex: 0, hopSeconds: 0.02, levels: [confidence], volumeLevels: [-48]
        }));
        const palette = plugin._displayPalette();
        const originalBar = plugin._volumeBarsForColumn(0)[0];
        const originalShape = plugin._volumeBarShape(0, originalBar, 100, palette);
        assert.ok(Math.abs(originalBar.confidence - confidence) < 1e-6);
        assert.equal(plugin.levelHistory[0], 0.5);
        assert.equal(originalShape?.half ?? null, confidence === 0.1 ? 29.75 : null);

        for (let frameIndex = 1; frameIndex <= 8; frameIndex++) {
            plugin.handleTelemetry(createTelemetryFrame({
                frameIndex, timeSeconds: 1 + frameIndex * 0.02, hopSeconds: 0.02,
                volumeLevels: [-12], revisionAge: frameIndex === 8 ? 8 : 0,
                revisedLevels: [0.9]
            }));
        }
        const revisedBar = plugin._volumeBarsForColumn(0)[0];
        assert.ok(Math.abs(revisedBar.confidence - 0.9) < 1e-6);
        assert.equal(plugin.levelHistory[0], 0.5);
        assert.equal(plugin._volumeBarShape(0, revisedBar, 100, palette).half, 29.75);
    }
});

test('revisions of dropped or cleared frames are ignored', async () => {
    const plugin = await loadPlugin();
    plugin.setParameters({ ts: 10 });
    for (const frameIndex of [0, 2, 3, 4, 5, 6, 7]) {
        plugin.handleTelemetry(createTelemetryFrame({
            frameIndex, timeSeconds: 2 + frameIndex * 0.01, levels: [0.8]
        }));
    }
    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 8, timeSeconds: 2.08, levels: [0.8], revisionAge: 8, revisedLevels: [0.5]
    }));
    assert.deepEqual(firstPitchPresenceBytesByColumn(plugin, 0, 3), [128, 0, 204]);
    const before = Float32Array.from(plugin.history);
    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 9, timeSeconds: 2.09, levels: [0.8], revisionAge: 8,
        revisedLevels: Array(pitchCount).fill(1)
    }));
    const latest = (plugin.writeColumn + historyWidth - 1) % historyWidth;
    for (let index = 0; index < before.length; index++) {
        if (Math.floor(index / pitchCount) === latest) continue;
        assert.equal(plugin.history[index], before[index]);
    }

    plugin.handleTelemetry(createTelemetryFrame({
        frameIndex: 18, timeSeconds: 2.18, generation: 2, levels: [0.8],
        revisionAge: 8, revisedLevels: [0.1]
    }));
    assert.equal(plugin.writeColumn, 1);
    assert.ok(Math.abs(plugin.history[0] - 0.8) < 1e-6);
    plugin.clearHistory();
    assert.equal(plugin.frameRecords.length, 0);
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
    plugin.displayOptions = { separateAnnotations: true };
    plugin.canvas = { width: 1024, height: 440 };
    plugin.imageData = { data: new Uint8ClampedArray(historyWidth * pitchCount * 4) };
    plugin.tempCtx = { putImageData() {} };
    plugin.tempCanvas = new FakeElement('canvas');
    plugin.tempCanvas.width = historyWidth;
    plugin.tempCanvas.height = pitchCount;
    plugin.canvasCtx = {
        ...keyShadingStubs,
        ...volumePathStubs,
        fillRect(x, y, width, height) {
            if (x > 0) fills.push({ x, y, width, height, color: this.fillStyle });
            else if (height === 1) lines.push({ y: y + .5, color: this.fillStyle });
        },
        drawImage() {}, beginPath() {},
        moveTo(x, y) { this.lineStart = { x, y }; },
        lineTo() {},
        stroke() { if (this.lineStart.x === 0) lines.push({ ...this.lineStart, color: this.strokeStyle }); },
        fillText() {},
        measureText() { return { width: 10 }; }
    };
    const { blackDepth } = FrequencyAxis.keyboardDepths(12 * 5, 1024);
    const keyColor = pitch => {
        const midi = 21 + pitch;
        const pitchClass = midi % 12;
        if ([1, 3, 6, 8, 10].includes(pitchClass)) {
            return fills.find(fill => Math.abs(fill.width - blackDepth) < 1e-9 &&
                fill.y === (108 - midi) * 5)?.color;
        }
        const whiteMidis = Array.from({ length: noteCount }, (_, index) => 21 + index)
            .filter(note => ![1, 3, 6, 8, 10].includes(note % 12));
        return fills.filter(fill => fill.width > blackDepth)[whiteMidis.indexOf(midi)]?.color;
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
    assert.equal(keyColor(1), 'rgb(85, 58, 83)');
    assert.equal(keyColor(2), 'rgb(220, 203, 208)');
    assert.equal(keyColor(3), 'rgb(238, 238, 238)');
    assert.equal(keyColor(4), 'rgb(17, 17, 17)');
    plugin.hl = 'Vocal';
    draw();
    assert.equal(keyColor(0), 'rgb(129, 107, 168)', 'Note Colors keeps the full-confidence key color with Highlight');
    assert.equal(keyColor(1), 'rgb(85, 58, 83)', 'Note Colors keeps the half-confidence black key color with Highlight');
    assert.equal(keyColor(2), 'rgb(220, 203, 208)', 'Note Colors keeps the quarter-confidence white key color with Highlight');
    assert.notDeepEqual(Array.from(plugin._noteDisplayColor(historyWidth - 1, 21, 1, plugin._displayPalette())),
        [129, 107, 168], 'the graph still applies Highlight');
    plugin.hl = 'None';
    draw();
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
    plugin.hl = 'Vocal';
    draw();
    assert.equal(keyColor(0), 'rgb(0, 255, 0)', 'Normal preserves the white key color with Highlight');
    assert.equal(keyColor(1), 'rgb(0, 255, 0)', 'Normal preserves the black key color with Highlight');
    assert.notDeepEqual(Array.from(plugin._noteDisplayColor(historyWidth - 1, 21, 1, plugin._displayPalette())),
        [0, 255, 0], 'Normal graph Highlight is still active');
    plugin.hl = 'None';
    draw();
    const latestPixel = ((pitchCount - 1 - fineCenter) * historyWidth + historyWidth - 1) * 4;
    assert.deepEqual(Array.from(plugin.imageData.data.slice(latestPixel, latestPixel + 4)),
        [0, 255, 0, 255]);
    for (const cl of ['Instrument3', 'Instrument9']) {
        plugin.setParameters({ cl });
        draw();
        assert.equal(keyColor(0), 'rgb(116, 116, 116)');
        assert.equal(keyColor(1), 'rgb(116, 116, 116)');
    }
    plugin.setParameters({ cl: 'Rainbow' });
    assert.deepEqual(Array.from(plugin.imageData.data.slice(latestPixel, latestPixel + 4)),
        [129, 107, 168, 255]);

    plugin.writeColumn = 1;
    draw();
    assert.equal(keyColor(0), 'rgb(156, 140, 186)');
    plugin.setParameters({ cf: 1 });
    draw();
    assert.equal(keyColor(0), 'rgb(156, 140, 186)');

    plugin.reset();
    plugin.ly = 'Vertical';
    plugin.vl = false;
    plugin.setParameters({ pr: 'High', mn: 21, mx: 108 });
    draw();
    assert.equal(keyColor(0), 'rgb(238, 238, 238)');
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
    const fills = [], images = [], labels = [], lines = [], outlines = [];
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
        ...keyShadingStubs,
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
        beginPath() { this.lineStart = null; this.lineEnd = null; this.points = []; },
        moveTo(x, y) {
            this.lineStart = point(x, y);
            this.points.push(this.lineStart);
        },
        lineTo(x, y) {
            this.lineEnd = point(x, y);
            this.points.push(this.lineEnd);
        },
        stroke() {
            if (this.points.length === 4) {
                outlines.push({ points: this.points, color: this.strokeStyle, lineWidth: this.lineWidth });
            } else if (this.lineStart && this.lineEnd) {
                lines.push({ start: this.lineStart, end: this.lineEnd });
            }
        }
    };
    plugin.handleTelemetry(createTelemetryFrame({ levels: [1, 0, 0, 0, 0, .5] }));
    const history = plugin.history.slice();
    const frameIndex = plugin.lastFrameIndex;
    const writeColumn = plugin.writeColumn;
    // Changing layout redraws even when animation is stopped.
    plugin.setParameters({ ly: 'Horizontal' });
    // Horizontal: 88 rows of 10 px across the 880 px width, keys 440 px deep at most.
    const { gutter, blackDepth } = FrequencyAxis.keyboardDepths(12 * 10, 440);
    const rollHeight = 440 - gutter;
    const blackKeys = fills.filter(fill => Math.abs(fill.width - blackDepth) < 1e-6);
    const whiteKeys = fills.filter(fill => Math.abs(fill.width - gutter) < 1e-6);
    assert.equal(blackKeys.length, 36);
    assert.equal(whiteKeys.length, 52);
    assert.equal(outlines.length, 1, 'only the active black key is outlined');
    assert.equal(outlines[0].color, 'rgba(206, 231, 206, 0.5)',
        'the outline mixes 20% of the displayed key fill into white');
    assert.equal(outlines[0].lineWidth, 1);
    const [keyX, keyY] = blackKeys[0].center;
    const halfWidth = (blackKeys[0].height - 1) / 2;
    const halfDepth = (blackKeys[0].width - 1) / 2;
    const expectedOutline = [
        [keyX + halfWidth, keyY - halfDepth], [keyX + halfWidth, keyY + halfDepth],
        [keyX - halfWidth, keyY + halfDepth], [keyX - halfWidth, keyY - halfDepth]
    ];
    outlines[0].points.forEach((point, index) => {
        assert.ok(point.every((value, axis) => Math.abs(value - expectedOutline[index][axis]) < 1e-6),
            'the outline follows the sides and front while leaving the top edge open');
    });
    const blackKeyPitches = Array.from({ length: noteCount }, (_, pitch) => pitch)
        .filter(pitch => [1, 3, 6, 8, 10].includes((21 + pitch) % 12));
    blackKeys.forEach((key, index) => {
        assert.ok(Math.abs(key.center[0] - (blackKeyPitches[index] + 0.5) * 10) < 1e-6);
    });
    assert.ok(blackKeys.every(key => Math.abs(key.center[1] - (rollHeight + blackDepth / 2)) < 1e-6));
    assert.ok(whiteKeys.every(key => Math.abs(key.center[1] - (440 - gutter / 2)) < 1e-6));
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
    assert.ok(horizontalLines.every(line => Math.abs(line.start[1] - rollHeight) < 1e-6));
    assert.deepEqual(labels.map(label => label.text), ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    assert.ok(labels[0].position[0] < labels.at(-1).position[0]);
    assert.ok(Math.abs(images.at(-1).end[1] - rollHeight) < 1e-6);
    const previousY = images[0].start[1];
    now += plugin.columnPeriod * 500;
    images.length = 0;
    plugin.drawGraph();
    assert.ok(images[0].start[1] < previousY);
    assert.ok(Math.abs(images[0].start[1] - previousY + 0.5 * rollHeight / historyWidth) < 1e-6);
    assert.ok(Math.abs(images.at(-1).end[1] - rollHeight) < 1e-6);
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
    // Vertical: 69 rows across the 440 px height, keys 880 px deep at most.
    const vertical = FrequencyAxis.keyboardDepths(12 * 440 / 69, 880);
    const verticalBlackKeys = fills.filter(fill => Math.abs(fill.width - vertical.blackDepth) < 1e-6);
    const verticalWhiteKeys = fills.filter(fill => Math.abs(fill.width - vertical.gutter) < 1e-6);
    assert.ok(verticalBlackKeys.length > 0);
    assert.ok(verticalWhiteKeys.length > 0);
    assert.ok(verticalBlackKeys.every(key =>
        Math.abs(key.center[0] - (880 - vertical.gutter + vertical.blackDepth / 2)) < 1e-6));
    assert.ok(verticalWhiteKeys.every(key => Math.abs(key.center[0] - (880 - vertical.gutter / 2)) < 1e-6));
    assert.ok(labels.every(label => Math.abs(label.angle) < 1e-6));
    assert.ok(labels.every(label =>
        Math.abs(label.position[0] - (880 - (vertical.gutter - vertical.blackDepth) / 2)) < 1e-6));
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

    plugin.mn = 21;
    plugin.mx = 108;
    for (const layout of ['Horizontal', 'Vertical']) {
        plugin.ly = layout;
        for (const [scale, dpr] of [[.5, 1], [2, 1], [2, 2]]) {
            plugin.canvas.width = 880 * scale;
            plugin.canvas.height = 440 * scale;
            plugin.graphDpr = dpr;
            outlines.length = 0;
            plugin.drawGraph();
            assert.equal(outlines.length, 1);
            assert.equal(outlines[0].lineWidth, scale * (layout === 'Horizontal' ? 1 : .5),
                `${layout} outline scales with the keyboard at DPR ${dpr}`);
        }
    }
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
        ...keyShadingStubs,
        fillRect() {},
        drawImage(...args) { drawCalls.push(args); },
        beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, fillText() {},
        measureText() { return { width: 10 }; }
    };
    const rollWidth = plugin.canvas.width - FrequencyAxis.keyboardDepths(
        12 * 440 / (plugin.mx - plugin.mn + 1), 1024).gutter;
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
    assert.equal(initialLatestCall[2], 0);
    assert.equal(initialLatestCall[4], plugin.canvas.height);
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
        ...keyShadingStubs,
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
            const whiteKey = theme.name === 'Midnight' ? [238, 238, 238] : [255, 255, 255];
            const blackKey = [17, 17, 17];
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

test('Visual Sync preserves continuous Note Spectrogram history when the output clock observation changes', async t => {
    for (const arrivalTime of [1020, 1040]) {
        await t.test('next frame arrives at ' + arrivalTime + ' ms', async () => {
            let now = 1000;
            let timer = null;
            let clockOffset = 0;
            const delivered = [];
            const hub = new TelemetryHub({
                now: () => audibleContextTime({
                    outputTimestamp: { contextTime: 1, performanceTime: 1000 + clockOffset },
                    performanceTime: now }),
                schedule: callback => { timer = () => { timer = null; callback(); }; return 1; },
                cancel: () => { timer = null; },
                port: { postMessage({ packet }) { new Uint8Array(packet).fill(0); } }
            });
            const plugin = await loadPlugin({ telemetryHub: hub, now: () => now });
            plugin.id = 7;
            plugin.ensureDspTelemetrySubscription();
            hub.subscribe(7, 24, frame => delivered.push(frame.sequence));
            hub.setVisualSyncResolver((tapId, endFrame) => audibleFrameTime({ endFrame, sampleRate: 48000 }));
            const send = frameIndex => {
                const frame = createTelemetryFrame({ frameIndex, hopSeconds: 0.02,
                    timeSeconds: 1 + frameIndex * 0.02,
                    levels: new Array(pitchCount).fill(0.75),
                    volumeLevels: new Array(pitchCount).fill(-12) });
                const packet = new ArrayBuffer(TELEMETRY_HEADER_BYTES + payloadBytes);
                const header = new DataView(packet);
                header.setUint16(0, frame.frameType, true);
                header.setUint16(2, frame.formatVersion, true);
                header.setUint32(4, plugin.id, true);
                header.setUint32(8, frameIndex, true);
                header.setUint16(12, payloadBytes, true);
                new Uint8Array(packet, TELEMETRY_HEADER_BYTES).set(new Uint8Array(frame.payload.buffer));
                hub.handleMessage({ type: 'dspTelemetry', packet, bytes: packet.byteLength,
                    endFrame: 48000 + frameIndex * 960 });
            };
            send(0);
            clockOffset = 25;
            now = 1020;
            send(1);
            clockOffset = -5;
            now = arrivalTime;
            send(2);
            now = 1045;
            timer?.();
            assert.equal(timer, null);

            const written = plugin.history.subarray(0, plugin.writeColumn * pitchCount);
            assert.equal(written.every(level => level === 0.75), true,
                'Continuous nonzero analysis must not acquire black history columns');
            assert.deepEqual(delivered, [0, 1, 2]);
            assert.equal(plugin.lastFrameIndex, 2);
            assert.equal(hub.getStats().visualSyncDropped, 0);
            assert.equal(hub.getStats().coreDroppedFrames, 0);
        });
    }
});
