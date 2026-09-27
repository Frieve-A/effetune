import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const moduleScript = path => read(path).replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');

test('Chroma stays drawable when a small visualizer tile receives a signal', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: read('../../plugins/plugin-base.js') });
        for (const file of ['note_spectrogram', 'chroma_spiral']) {
            await page.addScriptTag({ content: read(`../../plugins/analyzer/${file}.js`) });
        }
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-analyzer-display', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        const result = await page.evaluate(() => {
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = 400;
            const renderer = new VisualizerRenderer(canvas);
            const item = createItem('chroma', 'small-chroma');
            item.rect = { x: 0, y: 0, w: 0.2, h: 0.2 };
            const layout = { ...createDefaultLayout(), items: [item] };
            const sources = {
                getModulators: () => ({ level: 0, bass: 0 }),
                getFrame: () => null,
                subscribeItem: () => () => {}
            };
            const draw = () => renderer.draw(layout, sources, {}, 1, { quality: 'high' });
            draw();
            const display = renderer.layers.get(item.id).display;
            display.plugin.display = [{ midi: 69, level: -12 }];
            display.plugin.levelReference = -12;
            draw();
            item.rect.w = item.rect.h = 0.4;
            draw();
            const { inner, pitch, midiLow } = display.plugin.getSpiralGeometry(160, 160, display.plugin.graphDpr);
            const point = ChromaSpiralPlugin.spiralPoint(69, midiLow, inner, pitch);
            const pixel = display.plugin.canvasCtx.getImageData(
                Math.round(80 + point.x), Math.round(80 + point.y), 1, 1).data;
            display.dispose();
            return { pitch, signalAlpha: pixel[3] };
        });
        assert.ok(result.pitch > 0 && result.signalAlpha > 0);
    } finally {
        await browser.close();
    }
});

test('Chroma receives native HQ frames and keeps its guides and upright labels outside signal effects', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: read('../../plugins/plugin-base.js') });
        await page.addScriptTag({ content: read('../../plugins/frequency-axis.js') });
        await page.addScriptTag({ content: `
            window.ThemePalette = { get: role => role === 'graph-trace' ? 'rgb(0,255,0)' : 'rgb(90,90,90)' };
            const TelemetryFrameType = { TAP_LEVEL: 1, TAP_SPECTRUM: 4, TAP_SPECTROGRAM_COL: 5, TAP_STEREO_FIELD: 6 };
        ` });
        for (const file of ['../multires-spectrum', 'spectrum_analyzer', 'spectrogram', 'stereo_meter', 'note_spectrogram', 'chroma_spiral', 'level_meter']) {
            await page.addScriptTag({ content: read(`../../plugins/analyzer/${file}.js`) });
        }
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-sources', 'visualizer-ballistics', 'visualizer-analyzer-display', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        const result = await page.evaluate(() => {
            const callbacks = new Map();
            const manager = {
                telemetryHub: { subscribe(tap, type, callback) {
                    callbacks.set(tap, { type, callback }); return () => callbacks.delete(tap);
                } },
                setVisualizerSources(value) { this.sources = value; }
            };
            const sources = new VisualizerSources(manager);
            const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
            const renderer = new VisualizerRenderer(canvas);
            const item = createItem('chroma', 'spiral');
            item.rect = { x: 0, y: 0, w: 1, h: 1 };
            item.params.lo = item.params.hi = 4;
            const layout = { ...createDefaultLayout(), items: [item] };
            sources.setLayout(layout); sources.setVisible(true);
            const draw = () => renderer.draw(layout, sources, {}, 1, { quality: 'high' });
            draw();
            const display = renderer.layers.get(item.id).display;
            if (!(display.plugin.canvasCtx instanceof CanvasRenderingContext2D)) throw new Error('Expected native Canvas');
            const factoryUpdates = [];
            for (const [type, key, value] of [['spectrum', 'dr', -72], ['spectrogram', 'dr', -72],
                ['stereo', 'wt', .2], ['notes', 'ts', 3], ['chroma', 'ft', -2]]) {
                const part = createItem(type, `factory-${type}`);
                const target = document.createElement('canvas'); target.width = 640; target.height = 480;
                const adapter = createAnalyzerDisplay(part, target, sources);
                part.params[key] = value;
                adapter.draw(part, 1, 640);
                factoryUpdates.push(adapter.plugin.getParameters()[key] === value &&
                    !Object.hasOwn(adapter.plugin, '_syncedUIControls') &&
                    !Object.hasOwn(adapter.plugin, 'processorString'));
                adapter.dispose();
            }
            const native = new window.ChromaSpiralPlugin();
            let nativeControls;
            try {
                native.id = 42;
                const ui = native.createUI();
                native.setParameters({ lo: 3, hi: 5, ft: -2, dm: 1 });
                nativeControls = native.syncUIControls === PluginBase.prototype.syncUIControls &&
                    ui.querySelector('input[id$="lowest-octave-slider"]').value === '3' &&
                    ui.querySelector('input[id$="highest-octave-slider"]').value === '5' &&
                    ui.querySelector('input[id$="frequency-tilt-slider"]').value === '-2' &&
                    ui.querySelector('input[type="radio"][value="1"]').checked;
            } finally { native.cleanup(); }
            const payload = new DataView(new ArrayBuffer(48 + 2048 * 8));
            payload.setFloat32(0, 48000, true); payload.setUint16(4, 13, true);
            payload.setUint32(8, 4096, true); payload.setUint32(12, 1, true);
            payload.setUint32(16, 40000, true); payload.setUint32(28, 2048, true);
            payload.setFloat32(32, 20, true); payload.setFloat32(36, 40000, true);
            const valid = Array.from({ length: 2048 }, (_, i) => 20 * Math.exp(i * Math.log(2000) / 2047))
                .filter(hz => hz <= 24000).length;
            payload.setUint32(44, valid, true);
            for (let i = 0; i < 4096; i++) payload.setFloat32(48 + i * 4, -20, true);
            const producer = {};
            let updates = 0;
            const update = display.plugin.updateDisplay.bind(display.plugin);
            display.plugin.updateDisplay = (...args) => { updates++; update(...args); };
            const source = manager.sources[0];
            callbacks.get(source.tapId).callback({ frameType: 4, formatVersion: 2, payload }, producer);
            const accepted = display.plugin.snapshot?.points === 13 && display.plugin.display.length > 0;
            const pixels = target => target.getContext('2d').getImageData(0, 0, 640, 480).data;
            const hasPixels = target => pixels(target).some((value, i) => i % 4 === 3 && value > 0);
            const labels = [];
            const context = display.plugin.canvasCtx;
            const fillText = context.fillText.bind(context);
            context.fillText = (text, x, y) => {
                const transform = context.getTransform();
                labels.push([text, transform.a, transform.b, transform.c, transform.d]);
                fillText(text, x, y);
            };
            const modes = [];
            for (const dm of [0, 1]) {
                item.params.dm = dm;
                item.params.showAxes = item.params.showAxisNumbers = true;
                item.effects = [];
                draw();
                const original = pixels(display.plugin.canvas);
                item.effects = [normalizeEffect({ type: 'opacity', amount: 1 })];
                draw();
                const combined = document.createElement('canvas'); combined.width = 640; combined.height = 480;
                const ctx = combined.getContext('2d');
                for (const layer of [display.underlayCanvas, display.signalCanvas, display.plugin.canvas]) ctx.drawImage(layer, 0, 0);
                const split = pixels(combined);
                let maximumDifference = 0;
                // Compare visible, premultiplied color: transparent-edge RGB is
                // undefined after the browser's separate layer rounding.
                for (let i = 0; i < original.length; i += 4) {
                    maximumDifference = Math.max(maximumDifference, Math.abs(original[i + 3] - split[i + 3]));
                    for (let channel = 0; channel < 3; channel++) maximumDifference = Math.max(maximumDifference,
                        Math.abs(original[i + channel] * original[i + 3] - split[i + channel] * split[i + 3]) / 255);
                }
                const signal = pixels(display.signalCanvas);
                const underlay = hasPixels(display.underlayCanvas), foreground = hasPixels(display.plugin.canvas);
                const signalVisible = hasPixels(display.signalCanvas);
                item.params.showAxes = item.params.showAxisNumbers = false;
                draw();
                const unchangedSignal = pixels(display.signalCanvas).every((value, i) => value === signal[i]);
                const hiddenAuxiliary = !hasPixels(display.underlayCanvas) && !hasPixels(display.plugin.canvas);
                item.params.showAxes = item.params.showAxisNumbers = true;
                let upright = true, labelCount = 0;
                for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                    item.flipX = flipX; item.flipY = flipY; labels.length = 0;
                    draw(); labelCount += labels.length;
                    upright &&= labels.every(([, a, b, c, d]) => a === 1 && b === 0 && c === 0 && d === 1);
                }
                item.flipX = item.flipY = false;
                modes.push({ maximumDifference, signalVisible, underlay, foreground, unchangedSignal, hiddenAuxiliary, upright, labelCount });
            }
            item.effects = [];
            item.params.showAxes = item.params.showAxisNumbers = false;
            item.palette.mode = 'note-colors';
            item.params.dm = 1;
            draw();
            const geometry = display.plugin.getSpiralGeometry(640, 480, 1);
            const base = window.ChromaSpiralPlugin.spiralPoint(63, geometry.midiLow, geometry.inner, geometry.pitch);
            const sampleX = Math.floor(320 + base.x + geometry.pitch * .3), sampleY = 240;
            const referenceColor = [...display.plugin.canvasCtx.getImageData(sampleX, sampleY, 1, 1).data];
            const flippedColors = [];
            for (const [flipX, flipY] of [[true, false], [false, true], [true, true]]) {
                item.flipX = flipX; item.flipY = flipY; draw();
                flippedColors.push([...display.plugin.canvasCtx.getImageData(flipX ? 639 - sampleX : sampleX,
                    flipY ? 479 - sampleY : sampleY, 1, 1).data]);
            }
            item.flipX = item.flipY = false;
            draw();
            const directAgain = display.signalCanvas === null && display.underlayCanvas === null;
            const transparent = display.plugin.canvasCtx.getImageData(0, 0, 1, 1).data[3] === 0;
            item.palette.mode = 'heatmap';
            item.params.dm = 1;
            item.effects = [normalizeEffect({ type: 'opacity', amount: 1 })];
            display.plugin.levelReference = -12;
            display.plugin.display = [{ midi: 60, level: -30 }, { midi: 61, level: -34 }, { midi: 62, level: -38 }];
            draw();
            const heatmapPixels = pixels(display.signalCanvas);
            const heatmapFill = {
                partial: heatmapPixels.some((value, index) => index % 4 === 3 && value > 0 && value < 255),
                opaqueBlack: heatmapPixels.some((value, index) => index % 4 === 0 &&
                    heatmapPixels[index + 3] === 255 && value === 0 &&
                    heatmapPixels[index + 1] === 0 && heatmapPixels[index + 2] === 0)
            };
            sources.setVisible(false);
            const stopped = manager.sources.length === 0;
            display.dispose(); sources.dispose();
            return { accepted, sourceType: source.type, emptyParams: Object.keys(source.params).length === 0,
                modes, updates, factoryUpdates, nativeControls, referenceColor, flippedColors,
                directAgain, transparent, heatmapFill, stopped, subscriptions: callbacks.size };
        });
        assert.equal(result.accepted, true);
        assert.equal(result.sourceType, 'ChromaSpiralPlugin');
        assert.equal(result.emptyParams, true);
        assert.equal(result.updates, 1);
        assert.deepEqual(result.factoryUpdates, [true, true, true, true, true]);
        assert.equal(result.nativeControls, true);
        for (const mode of result.modes) {
            assert.ok(mode.maximumDifference <= 3, JSON.stringify(mode));
            assert.ok(mode.signalVisible && mode.underlay && mode.foreground, JSON.stringify(mode));
            assert.ok(mode.unchangedSignal && mode.hiddenAuxiliary && mode.upright && mode.labelCount > 0, JSON.stringify(mode));
        }
        assert.equal(result.referenceColor[3], 255);
        for (const color of result.flippedColors) assert.ok(color.every((value, index) =>
            Math.abs(value - result.referenceColor[index]) <= 3), JSON.stringify(result));
        assert.ok(result.directAgain && result.transparent && result.stopped);
        assert.deepEqual(result.heatmapFill, { partial: true, opaqueBlack: false });
        assert.equal(result.subscriptions, 0);
        const meter = await page.evaluate(() => {
            const callbacks = new Map();
            const manager = {
                telemetryHub: { subscribe(tap, type, callback) {
                    callbacks.set(tap, { type, callback }); return () => callbacks.delete(tap);
                } },
                setVisualizerSources(value) { this.sources = value; }
            };
            const sources = new VisualizerSources(manager);
            const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 200;
            const renderer = new VisualizerRenderer(canvas);
            const item = createItem('level-meter', 'meter');
            item.rect = { x: 0, y: 0, w: 1, h: 1 };
            const layout = { ...createDefaultLayout(), items: [item] };
            sources.setLayout(layout); sources.setVisible(true);
            const draw = () => renderer.draw(layout, sources, {}, 1, { quality: 'high' });
            draw();
            const display = renderer.layers.get(item.id).display;
            const factory = display?.plugin instanceof LevelMeterPlugin &&
                !Object.hasOwn(display.plugin, 'processorString');
            let parameterUpdates = 0;
            const setParameters = display.plugin.setParameters.bind(display.plugin);
            display.plugin.setParameters = params => { parameterUpdates++; setParameters(params); };
            item.params.showAxes = true;
            draw();
            const payload = new DataView(new ArrayBuffer(24));
            payload.setUint32(0, 2, true);
            payload.setFloat32(4, .5, true);
            payload.setFloat32(8, .25, true);
            payload.setFloat32(12, .01, true);
            payload.setFloat32(16, .005, true);
            payload.setUint32(20, 1, true);
            const source = manager.sources[0];
            callbacks.get(source.tapId).callback({ frameType: 1, formatVersion: 1, payload }, {});
            const colorModes = [];
            for (const mode of ['solid', 'gradient', 'heatmap']) {
                item.palette.mode = mode;
                draw();
                const style = display.plugin.displayOptions.traceStyle(display.plugin.ctx, 0, 800, 200);
                colorModes.push(mode === 'solid' ? style === item.palette.color : style instanceof CanvasGradient);
            }
            item.params.showAxes = item.params.showAxisNumbers = false;
            item.params.showLevelValues = true;
            item.effects = [normalizeEffect({ type: 'opacity', amount: .5 })];
            const context = display.plugin.ctx;
            const labels = [];
            const fillText = context.fillText.bind(context);
            context.fillText = (text, x, y) => {
                const transform = context.getTransform();
                const box = context.measureText(text);
                const center = new DOMPoint(x + (box.actualBoundingBoxRight - box.actualBoundingBoxLeft) / 2,
                    y + (box.actualBoundingBoxDescent - box.actualBoundingBoxAscent) / 2).matrixTransform(transform);
                labels.push({ text, center: [center.x, center.y],
                    transform: [transform.a, transform.b, transform.c, transform.d] });
                fillText(text, x, y);
            };
            const orientations = [];
            for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                item.flipX = flipX; item.flipY = flipY; labels.length = 0;
                draw();
                orientations.push(labels.every(label => label.transform.every((value, index) =>
                    value === [1, 0, 0, 1][index])));
            }
            const alpha = target => target.getContext('2d').getImageData(0, 0, target.width, target.height).data
                .some((value, index) => index % 4 === 3 && value > 0);
            const layers = [alpha(display.signalCanvas), alpha(display.plugin.canvas)];
            const annotations = labels.map(label => label.text);
            const received = [display.plugin.lv.length, display.plugin.pl.length, display.plugin.ol];
            const signalContext = display.signalCanvas.getContext('2d');
            const fillRects = [];
            const fillRect = signalContext.fillRect.bind(signalContext);
            signalContext.fillRect = (...args) => { fillRects.push(args); fillRect(...args); };
            item.flipX = item.flipY = false;
            item.params.orientation = 'vertical';
            labels.length = fillRects.length = 0;
            draw();
            const verticalLabels = structuredClone(labels);
            const verticalBar = fillRects[0];
            const left = display.signalCanvas.getContext('2d').getImageData(50, 80, 1, 1).data[3];
            const right = display.signalCanvas.getContext('2d').getImageData(450, 80, 1, 1).data[3];
            const verticalColorAxes = [];
            for (const mode of ['gradient', 'heatmap']) {
                item.palette.mode = mode; draw();
                const gradientContext = { createLinearGradient(...axes) {
                    verticalColorAxes.push(axes); return { addColorStop() {} };
                } };
                display.plugin.displayOptions.traceStyle(gradientContext, 0, 200, 400);
            }
            const verticalFlips = [];
            for (const [flipX, flipY] of [[true, false], [false, true], [true, true]]) {
                item.flipX = flipX; item.flipY = flipY; labels.length = 0;
                draw();
                verticalFlips.push(labels.length === verticalLabels.length && labels.every((label, index) =>
                    label.transform.every((value, axis) => value === [1, 0, 0, 1][axis]) &&
                    Math.abs(label.center[0] - (flipX ? 800 - verticalLabels[index].center[0]
                        : verticalLabels[index].center[0])) < .01 &&
                    Math.abs(label.center[1] - (flipY ? 200 - verticalLabels[index].center[1]
                        : verticalLabels[index].center[1])) < .01));
            }
            item.flipX = item.flipY = false;
            item.channel = 'L'; sources.setLayout(layout);
            fillRects.length = 0; draw();
            const clearedOnChannelSwitch = display.plugin.lv.length === 0 && fillRects.length === 0;
            const monoPayload = new DataView(new ArrayBuffer(24));
            monoPayload.setUint32(0, 2, true);
            for (const offset of [4, 12]) {
                monoPayload.setFloat32(offset, .5, true);
                monoPayload.setFloat32(offset + 4, .25, true);
            }
            monoPayload.setUint32(20, 1, true);
            const monoSource = manager.sources[0];
            callbacks.get(monoSource.tapId).callback({ frameType: 1, formatVersion: 1, payload: monoPayload }, {});
            labels.length = fillRects.length = 0; draw();
            const singleChannel = fillRects.length === 2 && labels.some(label => label.text === 'L -6.0 dB');
            item.params.showLevelValues = false;
            labels.length = 0; draw();
            const valuesHidden = labels.every(label => !label.text.includes('dB')) &&
                labels.some(label => label.text === 'OVERLOAD');
            item.params.showLevelValues = true;
            item.channel = null; sources.setLayout(layout);
            fillRects.length = 0; draw();
            const clearedOnPairReturn = display.plugin.lv.length === 0 && fillRects.length === 0;
            const pairSource = manager.sources[0];
            callbacks.get(pairSource.tapId).callback({ frameType: 1, formatVersion: 1, payload }, {});
            fillRects.length = 0; draw();
            const pairChannels = fillRects.length === 4;
            item.params.orientation = 'horizontal';
            fillRects.length = 0; draw();
            const horizontalBar = fillRects[0];
            item.rect.w = .5;
            draw();
            const resized = display.plugin.canvasWidth === 400 && display.plugin.canvasHeight === 200;
            sources.setVisible(false);
            const stopped = manager.sources.length === 0;
            display.dispose(); sources.dispose();
            return { factory, parameterUpdates, sourceType: source.type, received, colorModes, resized,
                orientations, layers, annotations, verticalBar, horizontalBar, left, right, verticalColorAxes, verticalFlips,
                clearedOnChannelSwitch, singleChannel, valuesHidden, clearedOnPairReturn, pairChannels,
                stopped, subscriptions: callbacks.size };
        });
        assert.equal(meter.factory, true);
        assert.ok(meter.parameterUpdates > 0);
        assert.equal(meter.sourceType, 'LevelMeterPlugin');
        assert.deepEqual(meter.received, [2, 2, true]);
        assert.deepEqual(meter.colorModes, [true, true, true]);
        assert.equal(meter.resized, true);
        assert.deepEqual(meter.orientations, [true, true, true, true]);
        assert.deepEqual(meter.layers, [true, true]);
        assert.ok(meter.annotations.some(label => label === 'L -6.0 dB'));
        assert.ok(meter.annotations.includes('OVERLOAD'));
        assert.ok(meter.verticalBar[0] > 0 && meter.verticalBar[1] > 0 &&
            Math.abs(meter.verticalBar[1] + meter.verticalBar[3] - 200) < .01 &&
            meter.horizontalBar[0] === 0 && meter.horizontalBar[2] > 0,
        JSON.stringify([meter.verticalBar, meter.horizontalBar]));
        assert.ok(meter.left > 0 && meter.right === 0, 'Vertical levels rise from bottom with independent left/right strengths');
        assert.deepEqual(meter.verticalColorAxes, [[0, 200, 0, 0], [0, 200, 0, 0]]);
        assert.deepEqual(meter.verticalFlips, [true, true, true]);
        assert.ok(meter.clearedOnChannelSwitch && meter.singleChannel && meter.valuesHidden &&
            meter.clearedOnPairReturn && meter.pairChannels);
        assert.equal(meter.stopped, true);
        assert.equal(meter.subscriptions, 0);
        const spectrum = await page.evaluate(() => {
            const sources = { subscribeItem: () => () => {}, getFrame: () => null, getModulators: () => ({}) };
            const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 480;
            const renderer = new VisualizerRenderer(canvas);
            const item = createItem('spectrum', 'vertical-spectrum');
            item.rect = { x: 0, y: 0, w: 1, h: 1 };
            item.params.orientation = 'vertical';
            item.params.kb = true;
            item.params.showAxisNumbers = true;
            item.effects = [normalizeEffect({ type: 'opacity', amount: .5 })];
            const layout = { ...createDefaultLayout(), items: [item] };
            const draw = () => renderer.draw(layout, sources, {}, 1, { quality: 'high' });
            draw();
            const display = renderer.layers.get(item.id).display;
            display.plugin.spectrum.fill(-48);
            display.plugin.peaks.fill(-24);
            const labels = [];
            const context = display.plugin.ctx;
            const fillText = context.fillText.bind(context);
            context.fillText = (text, x, y) => {
                const matrix = context.getTransform();
                const point = new DOMPoint(x, y).matrixTransform(matrix);
                labels.push({ text, position: [point.x, point.y],
                    transform: [matrix.a, matrix.b, matrix.c, matrix.d] });
                fillText(text, x, y);
            };
            const signal = display.signalCanvas.getContext('2d');
            const lineMatrices = [];
            const moveTo = signal.moveTo.bind(signal);
            signal.moveTo = (...args) => {
                const matrix = signal.getTransform();
                lineMatrices.push([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]);
                moveTo(...args);
            };
            const modes = [];
            for (const mode of ['line', 'bar']) {
                item.params.dm = mode;
                labels.length = lineMatrices.length = 0;
                draw();
                modes.push({ mode, labels: labels.map(label => label.text), upright: labels.length > 0 &&
                    labels.every(label => label.transform.every((value, index) => value === [1, 0, 0, 1][index])),
                signal: display.signalCanvas.getContext('2d').getImageData(0, 0, 800, 480).data.some((value, index) => index % 4 === 3 && value > 0),
                transformed: lineMatrices.some(matrix => matrix[0] === 0 && matrix[1] === -1 && matrix[2] === -1 && matrix[3] === 0) });
            }
            const axes = [];
            for (const mode of ['gradient', 'note-colors', 'heatmap']) {
                item.palette.mode = mode; draw();
                display.plugin.displayOptions.traceStyle({ createLinearGradient(...values) {
                    axes.push({ mode, values }); return { addColorStop() {} };
                } }, 480, 800);
            }
            item.palette.mode = 'solid';
            const keyboardRects = [];
            const rect = context.rect.bind(context);
            context.rect = (...args) => {
                if (args[0] === 0 && args[1] > 0 && args[2] === display.plugin.canvas.height)
                    keyboardRects.push(args);
                rect(...args);
            };
            draw();
            const fullKeyboardRatio = keyboardRects.at(-1)?.[3] / display.plugin.canvas.height;
            item.rect.h = .5; keyboardRects.length = 0; draw();
            const halfKeyboardRatio = keyboardRects.at(-1)?.[3] / display.plugin.canvas.height;
            item.rect.h = 1;
            const flips = [];
            for (const [flipX, flipY] of [[true, false], [false, true], [true, true]]) {
                item.flipX = flipX; item.flipY = flipY; labels.length = 0;
                draw();
                flips.push(labels.length > 0 && labels.every(label =>
                    label.transform.every((value, index) => value === [1, 0, 0, 1][index])));
            }
            item.flipX = item.flipY = false;
            item.params.kb = false; labels.length = 0; draw();
            const frequencyTitle = labels.find(label => label.text === 'Frequency (Hz)');
            const withoutKeyboard = frequencyTitle?.transform.every((value, index) =>
                value === [0, -1, 1, 0][index]) && frequencyTitle.position[0] < 20;
            item.params.orientation = 'horizontal'; labels.length = lineMatrices.length = 0; draw();
            const horizontal = lineMatrices.some(matrix => matrix[0] === 1 && matrix[1] === 0 &&
                matrix[2] === 0 && matrix[3] === 1) && labels.some(label => label.text === 'Frequency (Hz)');
            const original = new SpectrumAnalyzerPlugin();
            original.canvas = document.createElement('canvas');
            original.canvas.width = 800; original.canvas.height = 480;
            const nativeContext = original.canvas.getContext('2d');
            const nativeTransforms = [];
            const transform = nativeContext.transform.bind(nativeContext);
            nativeContext.transform = (...args) => { nativeTransforms.push(args); transform(...args); };
            original.drawGraph();
            original.cleanup();
            return { modes, axes, flips, withoutKeyboard, horizontal,
                keyboardAspect: Math.abs(fullKeyboardRatio - halfKeyboardRatio) < 1e-10,
                nativeHorizontal: nativeTransforms.length === 0 };
        });
        for (const mode of spectrum.modes) {
            assert.ok(mode.upright && mode.signal && mode.labels.some(label => label.startsWith('C')),
                JSON.stringify(mode));
            if (mode.mode === 'line') assert.equal(mode.transformed, true);
        }
        assert.deepEqual(spectrum.axes, [
            { mode: 'gradient', values: [0, 0, 480, 0] },
            { mode: 'note-colors', values: [0, 0, 480, 0] },
            { mode: 'heatmap', values: [0, 800, 0, 0] }
        ]);
        assert.deepEqual(spectrum.flips, [true, true, true]);
        assert.ok(spectrum.withoutKeyboard && spectrum.horizontal && spectrum.nativeHorizontal && spectrum.keyboardAspect);
    } finally {
        await browser.close();
    }
});
