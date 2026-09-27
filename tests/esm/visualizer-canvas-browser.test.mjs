import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const moduleScript = path => read(path).replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
const frequencyAxisScript = read('../../plugins/frequency-axis.js');
const { FrequencyAxis } = (() => { const window = {}; vm.runInNewContext(frequencyAxisScript, { window }); return window; })();

test('Spectrum gradient directions follow frequency and level after rotating the graph', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: read('../../plugins/plugin-base.js') });
        await page.addScriptTag({ content: frequencyAxisScript });
        await page.addScriptTag({ content: read('../../plugins/analyzer/spectrum_analyzer.js') });
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-analyzer-display']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        const results = await page.evaluate(() => {
            const sources = { subscribeItem: () => () => {} }, results = [];
            for (const orientation of ['horizontal', 'vertical']) for (const dm of ['bar', 'line']) {
                const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400;
                const item = createItem('spectrum', 'spectrum');
                Object.assign(item.params, { orientation, dm, quantizeBars: false });
                item.palette.mode = 'gradient';
                item.palette.stops = [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }];
                const display = createAnalyzerDisplay(item, canvas, sources), plugin = display.plugin;
                plugin.collectSpectrumLevels = width => new Map(Array.from({ length: width }, (_, x) => [x, [-24, -24]]));
                const width = orientation === 'vertical' ? 400 : 800;
                const height = orientation === 'vertical' ? 800 : 400;
                const count = width < 500 ? SPECTRUM_NARROW_BAR_COUNT : SPECTRUM_WIDE_BAR_COUNT;
                const frequencyX = fraction => dm === 'bar'
                    ? (Math.floor(count * fraction) + .5) * width / count : width * fraction;
                const pixel = (fraction, level) => {
                    const x = frequencyX(fraction), y = height * level;
                    const point = orientation === 'vertical' ? [800 - y, 400 - x] : [x, y];
                    return [...canvas.getContext('2d').getImageData(Math.floor(point[0]), Math.floor(point[1]), 1, 1).data];
                };
                for (const direction of ['frequency', 'intensity']) {
                    item.palette.direction = direction;
                    display.draw(item, 0, 800);
                    const level = dm === 'bar' ? .5 : .25;
                    results.push({ orientation, dm, direction,
                        first: pixel(.25, level), second: pixel(.75, level),
                        weaker: dm === 'bar' ? pixel(.25, .8) : null });
                }
                display.dispose();
            }
            return results;
        });
        for (const { orientation, dm, direction, first, second, weaker } of results) {
            const description = `${orientation} ${dm} ${direction}`;
            assert.ok(first[3] > 0 && second[3] > 0, description);
            if (direction === 'frequency') {
                assert.ok(second[0] - first[0] > 100, description);
                if (weaker) assert.deepEqual(weaker, first, description);
            } else {
                assert.deepEqual(first, second, description);
                if (weaker) assert.ok(first[0] - weaker[0] > 50 && weaker[2] - first[2] > 50, description);
            }
        }
    } finally {
        await browser.close();
    }
});

test('Analyzer layers preserve the scene below them and reflect labels without mirroring their glyphs', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: `
            class PluginBase {
                constructor() { throw new Error('A display must not construct a pipeline plugin'); }
                parseFiniteNumber(value, min, max, fallback) {
                    return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
                }
            }
            window.ThemePalette = { get: name => name === 'graph-trace' ? 'rgba(0,255,0,1)' : 'rgba(24,24,24,1)' };
        ` });
        await page.addScriptTag({ content: frequencyAxisScript });
        for (const file of ['spectrum_analyzer', 'spectrogram', 'stereo_meter', 'note_spectrogram']) {
            await page.addScriptTag({ content: read(`../../plugins/analyzer/${file}.js`) });
        }
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-analyzer-display', 'visualizer-renderer', 'visualizer-editor']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        const results = await page.evaluate(() => {
            const sources = { subscribeItem: () => () => {}, getFrame: () => null, getModulators: () => ({}) };
            const result = [];
            for (const type of ['spectrum', 'spectrogram', 'stereo', 'notes', 'notes-vertical', 'notes-keyless', 'notes-vertical-keyless']) {
                const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400;
                const item = createItem(type.startsWith('notes') ? 'notes' : type, type);
                item.params.showAxes = item.params.showAxisNumbers = true;
                if (type.startsWith('notes')) item.params.kb = !type.endsWith('keyless');
                if (type.includes('vertical')) item.params.ly = 'Vertical';
                const display = createAnalyzerDisplay(item, canvas, sources);
                const context = canvas.getContext('2d');
                if (!(context instanceof CanvasRenderingContext2D)) throw new Error('Expected a native canvas');
                if (type === 'stereo') {
                    display.plugin.sampleRate = 1000;
                    display.plugin.currentMeasurements = { xBuffer: new Float32Array(1000), yBuffer: new Float32Array(1000),
                        currentPosition: 0, peakBuffer: new Float32Array(360) };
                    display.plugin.dspStereoFieldSnapshot = { correlation: 0, balance: 0 };
                }
                const labels = [];
                for (const method of ['fillText', 'strokeText']) {
                    const native = context[method].bind(context);
                    context[method] = (text, x, y) => {
                        const transform = context.getTransform(), box = context.measureText(text);
                        const center = new DOMPoint(x + (box.actualBoundingBoxRight - box.actualBoundingBoxLeft) / 2,
                            y + (box.actualBoundingBoxDescent - box.actualBoundingBoxAscent) / 2).matrixTransform(transform);
                        labels.push({ text, method, color: method === 'strokeText' ? context.strokeStyle : context.fillStyle, center: [center.x, center.y],
                            orientation: [transform.a, transform.b, transform.c, transform.d] });
                        native(text, x, y);
                    };
                }
                for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                    item.flipX = flipX; item.flipY = flipY;
                    labels.length = 0;
                    display.draw(item, 1, 800);
                    result.push({ type, flipX, flipY, labels: structuredClone(labels) });
                }
                if (['spectrum', 'spectrogram', 'stereo'].includes(type)) {
                    item.flipX = item.flipY = false;
                    labels.length = 0;
                    const themeColors = { 'graph-label': '#9c2ee8', 'text-primary': '#d34261',
                        'graph-bg-deep': '#0b3e5a',
                        'graph-grid-subtle': '#126a92', 'graph-grid-strong': '#e2a224',
                        'graph-trace-tertiary': '#34b586' };
                    const strokes = [];
                    const nativeStroke = context.stroke.bind(context);
                    context.stroke = (...args) => { strokes.push(context.strokeStyle); nativeStroke(...args); };
                    const bars = [];
                    const nativeFillRect = context.fillRect.bind(context);
                    if (type === 'stereo') {
                        item.palette.color = '#c15b0e';
                        display.plugin.dspStereoFieldSnapshot = { correlation: 0.5, balance: 6 };
                        context.fillRect = (x, y, width, height) => {
                            if ((x === 0 && width === 16) || (x === 400 && height === 16)) bars.push(context.fillStyle);
                            nativeFillRect(x, y, width, height);
                        };
                    }
                    display.draw(item, 1, 800, themeColors);
                    const themeLabels = structuredClone(labels);
                    const regularStrokes = [...strokes];
                    if (type === 'spectrogram') {
                        item.params.kb = true;
                        strokes.length = 0;
                        display.draw(item, 1, 800, themeColors);
                        item.params.kb = false;
                    }
                    context.stroke = nativeStroke;
                    context.fillRect = nativeFillRect;
                    result.push({ type: 'theme-numbers', analyzer: type, labels: themeLabels,
                        regularStrokes, keyboardStrokes: [...strokes], bars });
                }
                if (type === 'spectrum' || (type.startsWith('notes') && !type.endsWith('keyless'))) {
                    const keyboard = item.params.kb;
                    item.params.kb = true;
                    item.params.showAxisNumbers = false;
                    for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                        item.flipX = flipX; item.flipY = flipY;
                        labels.length = 0;
                        display.draw(item, 1, 800);
                        result.push({ type: 'keyboard-c-labels', analyzer: type, flipX, flipY,
                            labels: structuredClone(labels.filter(label => /^C\d+$/.test(label.text))) });
                    }
                    item.params.kb = keyboard;
                }
                if (type === 'spectrogram') {
                    item.params.kb = true;
                    item.params.showAxisNumbers = false;
                    for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                        item.flipX = flipX; item.flipY = flipY;
                        labels.length = 0;
                        display.draw(item, 1, 800);
                        result.push({ type: 'spectrogram-keyboard-labels', flipX, flipY,
                            labels: structuredClone(labels.filter(label => /^\d+$/.test(label.text))) });
                    }
                    item.params.kb = false;
                }
                item.flipX = item.flipY = false;
                item.params.showAxes = item.params.showAxisNumbers = false;
                display.draw(item, 1, 800);
                const scene = document.createElement('canvas'); scene.width = 800; scene.height = 400;
                const sceneContext = scene.getContext('2d');
                sceneContext.fillStyle = 'rgb(11,22,33)'; sceneContext.fillRect(0, 0, 800, 400);
                sceneContext.drawImage(canvas, 0, 0);
                const backgroundPixel = [...sceneContext.getImageData(10, 10, 1, 1).data];
                const layerPixel = [...context.getImageData(10, 10, 1, 1).data];
                const history = [];
                if (type === 'spectrogram') {
                    const intensities = new Uint8Array(256); intensities[80] = 128;
                    display.plugin.paintDspSpectrogramColumn(0, intensities);
                    const alpha = display.plugin.imageDataCache.data.filter((_, index) => index % 4 === 3);
                    history.push(alpha.some(value => value > 0), alpha.some(value => value === 0));
                    display.plugin.clearSpectrogramImage();
                    history.push(display.plugin.imageDataCache.data.every((value, index) => index % 4 !== 3 || value === 0));
                } else if (type.startsWith('notes')) {
                    display.plugin.history[197] = .8;
                    display.plugin.paintHistoryImage();
                    const alpha = display.plugin.imageData.data.filter((_, index) => index % 4 === 3);
                    history.push(alpha.some(value => value > 0), alpha.some(value => value === 0));
                    history.push(display.plugin.volumeHistoryCanvas.getContext('2d').getImageData(10, 10, 1, 1).data[3] === 0);
                }
                result.push({ type, backgroundPixel, layerPixel, history });
                item.effects = [normalizeEffect({ type: 'opacity', amount: .5 })];
                item.params.showAxes = item.params.showAxisNumbers = true;
                // Like telemetry, assign a fresh raw spectrum; the display derives its own peaks.
                if (type === 'spectrum') display.plugin.spectrum = new Float32Array(display.plugin.spectrum.length).fill(-30);
                if (type === 'spectrogram') {
                    display.plugin.getSpectrogramDisplayTime = () => 1;
                    display.plugin.spectrogramColumnPeriod = .1;
                    display.plugin.spectrogramColumnCount = 2;
                    display.plugin.spectrogramColumnTimes[1022] = .9;
                    display.plugin.spectrogramColumnTimes[1023] = 1;
                    display.plugin.prevTime = 1;
                    display.plugin.imageDataCache.data.fill(128);
                }
                if (type.startsWith('notes')) {
                    display.plugin.history[197] = .8;
                    display.plugin.levelHistory[197] = .8;
                    display.plugin.writeColumn = 1;
                    display.plugin.volumeHistoryDirty = true;
                }
                for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                    item.flipX = flipX; item.flipY = flipY; labels.length = 0;
                    display.draw(item, 1, 800);
                    result.push({ type: 'effect-labels', analyzer: type, flipX, flipY, labels: structuredClone(labels) });
                }
                item.flipX = item.flipY = false;
                display.draw(item, 1, 800);
                const signal = display.signalCanvas;
                const before = signal.getContext('2d').getImageData(0, 0, 800, 400).data;
                const hasSignal = before.some((value, index) => index % 4 === 3 && value > 0);
                item.params.showAxes = item.params.showAxisNumbers = false;
                display.draw(item, 1, 800);
                const after = signal.getContext('2d').getImageData(0, 0, 800, 400).data;
                const signalUnchanged = before.every((value, index) => value === after[index]);
                item.effects = [];
                display.draw(item, 1, 800);
                const combinedAgain = display.signalCanvas === null;
                const stepMethod = type === 'spectrum' ? 'collectSpectrumLevels'
                    : type === 'spectrogram' ? 'getSpectrogramDisplayTime' : type.startsWith('notes') ? '_scrollPhase' : null;
                let drawSteps = 0;
                if (stepMethod) {
                    const step = display.plugin[stepMethod].bind(display.plugin);
                    display.plugin[stepMethod] = (...args) => { drawSteps++; return step(...args); };
                    item.effects = [normalizeEffect({ type: 'opacity', amount: .5 })];
                    if (type.startsWith('notes')) item.params.ts = 3;
                    else item.params.dr = -72;
                    display.draw(item, 1, 800);
                }
                result.push({ type: 'separation', analyzer: type, hasSignal, signalUnchanged,
                    combinedAgain, drawSteps, stepMethod });
                if (type === 'spectrum' || type === 'stereo') {
                    item.params.showAxes = item.params.showAxisNumbers = true;
                    for (const mode of type === 'spectrum' ? ['line', 'bar'] : ['field']) {
                        if (type === 'spectrum') item.params.dm = mode;
                        item.effects = [];
                        display.draw(item, 1, 800);
                        sceneContext.fillStyle = '#182028';
                        sceneContext.fillRect(0, 0, 800, 400);
                        sceneContext.drawImage(canvas, 0, 0);
                        const nativePixels = sceneContext.getImageData(0, 0, 800, 400).data;
                        item.effects = [normalizeEffect({ type: 'opacity', amount: 1 })];
                        display.draw(item, 1, 800);
                        sceneContext.fillRect(0, 0, 800, 400);
                        sceneContext.drawImage(display.underlayCanvas, 0, 0);
                        sceneContext.drawImage(display.signalCanvas, 0, 0);
                        sceneContext.drawImage(canvas, 0, 0);
                        const composedPixels = sceneContext.getImageData(0, 0, 800, 400).data;
                        const maxDifference = nativePixels.reduce((maximum, value, index) =>
                            Math.max(maximum, Math.abs(value - composedPixels[index])), 0);
                        sceneContext.fillRect(0, 0, 800, 400);
                        sceneContext.drawImage(display.signalCanvas, 0, 0);
                        sceneContext.drawImage(display.underlayCanvas, 0, 0);
                        sceneContext.drawImage(canvas, 0, 0);
                        const reversedPixels = sceneContext.getImageData(0, 0, 800, 400).data;
                        const reversedDifference = nativePixels.reduce((maximum, value, index) =>
                            Math.max(maximum, Math.abs(value - reversedPixels[index])), 0);
                        result.push({ type: 'native-order', analyzer: type, mode, maxDifference, reversedDifference });
                    }
                }
            }
            const stage = document.createElement('canvas'); stage.width = 800; stage.height = 400;
            const renderer = new VisualizerRenderer(stage), stageContext = stage.getContext('2d');
            const analyzer = createItem('spectrum', 'analyzer'), title = createItem('title', 'title');
            title.effects = ['scale-pulse', 'shake'].map(type => normalizeEffect({ type, amount: 1 }));
            const effectCalls = [], apply = renderer.effects.apply.bind(renderer.effects);
            renderer.effects.apply = (...args) => {
                if (args[0] === title.id) effectCalls.push({ changed: args[6], flipX: !!args[7], flipY: !!args[8] });
                return apply(...args);
            };
            const transforms = [], drawImage = stageContext.drawImage.bind(stageContext);
            stageContext.drawImage = (...args) => {
                const { a, b, c, d } = stageContext.getTransform();
                transforms.push([a, b, c, d]);
                drawImage(...args);
            };
            for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                analyzer.flipX = title.flipX = flipX; analyzer.flipY = title.flipY = flipY;
                transforms.length = 0;
                renderer.draw({ background: { color: '#0b1621', effects: [] }, items: [analyzer, title] },
                    sources, { title: 'Track' }, 1, { quality: 'high' });
                result.push({ type: 'composition', flipX, flipY, transforms: structuredClone(transforms) });
            }
            result.push({ type: 'effect-flips', calls: effectCalls });
            analyzer.rect = { x: 0, y: 0, w: 1, h: 1 };
            analyzer.effects = [normalizeEffect({ type: 'opacity', amount: 0 }), normalizeEffect({ type: 'shake', amount: 1 })];
            renderer.draw({ background: { color: '#0b1621', effects: [] }, items: [analyzer] },
                sources, {}, 1, { quality: 'high' });
            const expected = document.createElement('canvas'); expected.width = 800; expected.height = 400;
            const expectedContext = expected.getContext('2d');
            expectedContext.fillStyle = '#0b1621'; expectedContext.fillRect(0, 0, 800, 400);
            expectedContext.drawImage(renderer.layers.get(analyzer.id).display.underlayCanvas, 0, 0);
            expectedContext.drawImage(renderer.layers.get(analyzer.id).canvas, 0, 0);
            const actualPixels = stageContext.getImageData(0, 0, 800, 400).data;
            result.push({ type: 'fixed-annotations', matches: expectedContext.getImageData(0, 0, 800, 400).data
                .every((value, index) => value === actualPixels[index]) });
            const boundsStage = document.createElement('canvas'); boundsStage.width = 1280; boundsStage.height = 720;
            const host = document.createElement('div'); host.style.cssText = 'position:relative;width:800px;height:450px';
            boundsStage.style.cssText = 'width:100%;height:100%;display:block'; host.appendChild(boundsStage);
            const overlay = document.createElement('div'); overlay.style.position = 'absolute'; host.appendChild(overlay);
            document.body.appendChild(host);
            const bars = createItem('spectrum', 'bounds'); bars.rect = { x: .2, y: .2, w: .6, h: .6 };
            bars.params.dm = 'bar'; bars.params.sc = 'log';
            bars.palette.stops = [{ pos: 0, color: '#ff00ff' }];
            const boundsLayout = { background: { color: '#000000', effects: [] }, items: [bars] };
            const editor = Object.assign(Object.create(VisualizerEditor.prototype), {
                view: { layout: boundsLayout, updateEditButtons() {} }, open: true, selection: new Set([bars.id]), overlay,
                itemBounds: document.createElement('div')
            });
            editor.updateSelection();
            const hostRect = host.getBoundingClientRect(), overlayRect = overlay.getBoundingClientRect();
            const editorRect = { x: (overlayRect.left - hostRect.left) * 1.6, y: (overlayRect.top - hostRect.top) * 1.6,
                width: overlayRect.width * 1.6, height: overlayRect.height * 1.6 };
            const boundsRenderer = new VisualizerRenderer(boundsStage);
            boundsRenderer.draw(boundsLayout, sources, {}, 1, { quality: 'high' });
            const native = boundsRenderer.layers.get(bars.id).display.plugin;
            native.spectrum = new Float32Array(native.spectrum.length).fill(-30);
            const pixelsBounds = canvas => {
                const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let left = canvas.width, right = -1, bottom = -1;
                for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                    const offset = (y * canvas.width + x) * 4;
                    if (pixels[offset + 3] && (pixels[offset] > 20 || pixels[offset + 1] > 20 || pixels[offset + 2] > 20)) {
                        left = Math.min(left, x); right = Math.max(right, x); bottom = Math.max(bottom, y);
                    }
                }
                return { left, right, bottom };
            };
            const glow = normalizeEffect({ type: 'glow', amount: .5 });
            const pulse = normalizeEffect({ type: 'scale-pulse', amount: .4 });
            const samples = [];
            for (const [name, effects] of [['none', []], ['disabled', [{ ...pulse, enabled: false }]],
                ['glow', [glow]], ['pulse', [pulse]], ['pulse-glow', [pulse, glow]]]) {
                bars.effects = effects;
                boundsRenderer.draw(boundsLayout, sources, {}, 1, { quality: 'high' });
                samples.push({ name, ...pixelsBounds(boundsStage) });
            }
            // Reproduce the former final transform with the same native input.
            const old = document.createElement('canvas'); old.width = 1280; old.height = 720;
            const oldContext = old.getContext('2d');
            oldContext.translate(640, 360); oldContext.scale(1.1, 1.1);
            oldContext.drawImage(boundsRenderer.layers.get(bars.id).display.signalCanvas, -384, -216, 768, 432);
            result.push({ type: 'spectrum-bounds', editorRect, input: [native.canvas.width, native.canvas.height], samples, old: pixelsBounds(old) });
            host.remove();
            return result;
        });
        const expectedCenter = (type, row, original) => {
            const [x, y] = original.center;
            // The default note range has 64 rows along the 800 px or 400 px pitch axis.
            if (type === 'notes') return [x, row.flipY ? y - (400 - FrequencyAxis.keyboardDepths(12 * 800 / 64, 400).gutter) : y];
            if (type === 'notes-vertical') return [row.flipX ? x - (800 - FrequencyAxis.keyboardDepths(12 * 400 / 64, 800).gutter) : x, y];
            return [row.flipX ? 800 - x : x, row.flipY ? 400 - y : y];
        };
        for (const type of ['spectrum', 'spectrogram', 'stereo', 'notes', 'notes-vertical', 'notes-keyless', 'notes-vertical-keyless']) {
            const rows = results.filter(row => row.type === type), baseline = rows[0].labels;
            assert.ok(baseline.length > 0, `${type} has labels`);
            if (type.endsWith('keyless')) assert.ok(baseline.every(label => label.color === '#666666'),
                `${type} labels use the default dark graph label color`);
            for (const row of [...rows.slice(1, 4), ...results.filter(row => row.type === 'effect-labels' && row.analyzer === type)]) {
                assert.equal(row.labels.length, baseline.length, type);
                row.labels.forEach((label, index) => {
                    const original = baseline[index];
                    assert.equal(label.text, original.text);
                    assert.equal(label.method, original.method);
                    label.orientation.forEach((value, axis) => assert.ok(Math.abs(value - original.orientation[axis]) < 1e-9,
                        `${type} ${label.text} glyph orientation`));
                    const expected = expectedCenter(type, row, original);
                    label.center.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < .01,
                        `${type} ${label.text} position ${label.center} expected ${expected}`));
                });
            }
            assert.deepEqual(rows[4].backgroundPixel, [11, 22, 33, 255], type);
            assert.equal(rows[4].layerPixel[3], 0, type);
            assert.ok(rows[4].history.every(Boolean), `${type} keeps data but clears empty history`);
        }
        for (const row of results.filter(row => row.type === 'theme-numbers')) {
            const numbers = row.labels.filter(label => label.method === 'fillText' &&
                /^-?\d+(?:\.\d+)?(?:k|dB)?$/.test(label.text));
            assert.ok(numbers.length > 0, `${row.analyzer} has fixed numeric tick labels`);
            assert.ok(numbers.every(label => label.color === '#9c2ee8'),
                `${row.analyzer} numeric tick labels follow Graph labels`);
            if (row.analyzer === 'spectrogram') {
                assert.ok(row.labels.some(label => label.method === 'fillText' && label.text === 'Time' &&
                    label.color === '#d34261'), 'Spectrogram axis titles follow Axis titles');
                assert.ok(row.labels.some(label => label.method === 'strokeText' && label.text === 'Time' &&
                    label.color === '#0b3e5a'), 'Spectrogram label outlines follow Graph base');
                assert.ok(row.regularStrokes.includes('#126a92'), 'Spectrogram grid follows Fine grid');
                assert.ok(row.keyboardStrokes.includes('#e2a224'), 'Spectrogram keyboard guides follow Major grid');
            }
            if (row.analyzer === 'stereo') assert.deepEqual(row.bars, ['#c15b0e', '#c15b0e'],
                'Stereo correlation and balance bars follow the item palette');
        }
        for (const type of ['spectrum', 'notes', 'notes-vertical']) {
            const rows = results.filter(row => row.type === 'keyboard-c-labels' && row.analyzer === type);
            const baseline = rows[0].labels;
            assert.ok(baseline.length > 0, `${type} shows C labels on the keyboard with axis numbers off`);
            for (const row of rows.slice(1)) {
                assert.equal(row.labels.length, baseline.length);
                row.labels.forEach((label, index) => {
                    const original = baseline[index];
                    assert.equal(label.text, original.text);
                    label.orientation.forEach((value, axis) => assert.ok(Math.abs(value - original.orientation[axis]) < 1e-9,
                        `${type} ${label.text} keyboard glyph orientation`));
                    const expected = expectedCenter(type, row, original);
                    label.center.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < .01,
                        `${type} ${label.text} keyboard label position`));
                });
            }
        }
        const spectrogramKeyboard = results.filter(row => row.type === 'spectrogram-keyboard-labels');
        const spectrogramBaseline = spectrogramKeyboard[0].labels;
        assert.ok(spectrogramBaseline.length > 0, 'Spectrogram shows octave numbers on the keyboard with axis numbers off');
        assert.ok(spectrogramBaseline.some(label => label.method === 'strokeText'));
        assert.ok(spectrogramBaseline.some(label => label.method === 'fillText'));
        for (const row of spectrogramKeyboard.slice(1)) {
            assert.equal(row.labels.length, spectrogramBaseline.length);
            row.labels.forEach((label, index) => {
                const original = spectrogramBaseline[index];
                assert.equal(label.text, original.text);
                assert.equal(label.method, original.method);
                label.orientation.forEach((value, axis) => assert.ok(Math.abs(value - original.orientation[axis]) < 1e-9,
                    `Spectrogram ${label.text} keyboard glyph orientation`));
                const expected = [row.flipX ? 800 - original.center[0] : original.center[0],
                    row.flipY ? 400 - original.center[1] : original.center[1]];
                label.center.forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < .01,
                    `Spectrogram ${label.text} keyboard label position`));
            });
        }
        for (const row of results.filter(row => row.type === 'composition')) {
            assert.deepEqual(row.transforms[1], [1, 0, 0, 1], 'The analyzer is not flipped again during composition');
            assert.deepEqual(row.transforms[2].map(value => value || 0), [row.flipX ? -1 : 1, 0, 0, row.flipY ? -1 : 1],
                'Metadata keeps its existing whole-item flip');
        }
        assert.deepEqual(results.find(row => row.type === 'effect-flips').calls,
            [[false, false], [true, false], [false, true], [true, true]].map(([flipX, flipY], index) => ({ changed: index === 0, flipX, flipY })),
            'Whole-item flips update the effects input and keep movement directions in scene coordinates');
        for (const row of results.filter(row => row.type === 'separation')) {
            assert.equal(row.hasSignal, true, `${row.analyzer} supplies its signal to effects`);
            assert.equal(row.signalUnchanged, true, `${row.analyzer} grid and labels do not enter the signal layer`);
            assert.equal(row.combinedAgain, true, `${row.analyzer} restores the original drawing path without effects`);
            if (row.stepMethod) assert.equal(row.drawSteps, 1, `${row.analyzer} advances display state once when parameters change`);
        }
        assert.equal(results.find(row => row.type === 'fixed-annotations').matches, true,
            'Opacity and shake affect the signal while annotations stay fully visible at their original position');
        const bounds = results.find(row => row.type === 'spectrum-bounds');
        assert.deepEqual(bounds.editorRect, { x: 256, y: 144, width: 768, height: 432 });
        assert.deepEqual(bounds.input, [768, 432]);
        for (const name of ['none', 'disabled', 'pulse']) {
            const sample = bounds.samples.find(value => value.name === name);
            assert.ok(sample.right >= sample.left && sample.bottom >= 144 && sample.left >= 256 &&
                sample.right < 1024 && sample.bottom < 576, JSON.stringify(bounds));
        }
        for (const name of ['glow', 'pulse-glow']) {
            const sample = bounds.samples.find(value => value.name === name);
            assert.ok(sample.left < 256 && sample.bottom >= 576, JSON.stringify(bounds));
        }
        assert.ok(bounds.old.left < 256 && bounds.old.bottom >= 576, JSON.stringify(bounds));
        for (const row of results.filter(row => row.type === 'native-order')) {
            // Separate 8-bit canvas surfaces round antialiased edge blends at
            // each composition step; opaque overlaps retain the native order.
            assert.ok(row.maxDifference <= 4,
                `${row.analyzer} ${row.mode} preserves native overlap order (difference ${row.maxDifference})`);
            if (row.analyzer === 'spectrum') assert.ok(row.reversedDifference > 20,
                `${row.mode} detects the regression when grid lines are placed over the signal`);
        }
    } finally {
        await browser.close();
    }
});

test('Notes move the keyboard to the opposite side without reversing its keys', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: `
            class PluginBase {
                constructor() { throw new Error('A display must not construct a pipeline plugin'); }
                parseFiniteNumber(value, min, max, fallback) {
                    return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
                }
            }
            window.ThemePalette = { get: () => 'rgb(24,24,24)' };
        ` });
        await page.addScriptTag({ content: frequencyAxisScript });
        await page.addScriptTag({ content: read('../../plugins/analyzer/note_spectrogram.js') });
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-analyzer-display'])
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        const results = await page.evaluate(() => {
            const sources = { subscribeItem: () => () => {} };
            return ['Horizontal', 'Vertical'].map(layout => {
                const canvas = document.createElement('canvas');
                canvas.width = 800; canvas.height = 400;
                const item = createItem('notes', layout);
                Object.assign(item.params, { ly: layout, kb: true, vl: false, showAxes: false, showAxisNumbers: false });
                const display = createAnalyzerDisplay(item, canvas, sources);
                const horizontal = layout === 'Horizontal';
                const length = horizontal ? canvas.width : canvas.height;
                const depth = horizontal ? canvas.height : canvas.width;
                const rowHeight = length / (item.params.mx - item.params.mn + 1);
                const gutter = FrequencyAxis.keyboardDepths(12 * rowHeight, depth).gutter;
                const rollWidth = depth - gutter;
                const context = canvas.getContext('2d');
                const nativeFillText = context.fillText.bind(context);
                const labels = [];
                context.fillText = (text, x, y) => {
                    if (/^C\d+$/.test(text)) {
                        const metrics = context.measureText(text);
                        labels.push({ text, fontSize: parseFloat(context.font), width: metrics.width,
                            height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent });
                    }
                    nativeFillText(text, x, y);
                };
                const rows = [];
                for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                    item.flipX = flipX; item.flipY = flipY;
                    labels.length = 0;
                    display.draw(item, 1, 800);
                    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
                    const pixel = (x, y) => [...pixels.slice((Math.floor(y) * canvas.width + Math.floor(x)) * 4,
                        (Math.floor(y) * canvas.width + Math.floor(x)) * 4 + 4)];
                    const moved = horizontal ? flipY : flipX;
                    const keyDepth = moved ? 10 : rollWidth + 10;
                    const keys = Array.from({ length: item.params.mx - item.params.mn + 1 }, (_, index) => {
                        const position = (index + .5) * rowHeight;
                        return horizontal ? pixel(canvas.width - position, keyDepth) : pixel(keyDepth, position);
                    });
                    const oldSide = moved
                        ? horizontal ? pixel(canvas.width / 2, rollWidth + 10) : pixel(rollWidth + 10, canvas.height / 2)
                        : null;
                    rows.push({ flipX, flipY, keys, oldSide, labels: structuredClone(labels) });
                }
                item.params.vl = true;
                const meters = [];
                for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                    item.flipX = flipX; item.flipY = flipY;
                    const moved = horizontal ? flipY : flipX;
                    // The volume semicircle bulges from the key boundary into the roll.
                    const meterDepth = moved ? gutter + rowHeight / 2 : rollWidth - rowHeight / 2;
                    const position = (item.params.mx - 60 + .5) * rowHeight;
                    const sample = level => {
                        display.draw(item, 1, 800);
                        display.plugin.meterCurrent.fill(level);
                        display.draw(item, 1, 800);
                        return [...(horizontal
                            ? context.getImageData(canvas.width - position, meterDepth, 1, 1)
                            : context.getImageData(meterDepth, position, 1, 1)).data];
                    };
                    meters.push({ flipX, flipY, silent: sample(-Infinity), loud: sample(0) });
                }
                display.dispose();
                return { layout, rows, meters, lowestNote: item.params.mn, highestNote: item.params.mx,
                    keySpan: 12 * rowHeight / 7 - 2,
                    keyDepth: gutter * (1 - 95 / 150) - 2 };
            });
        });
        for (const { layout, rows, meters, lowestNote, highestNote, keySpan, keyDepth } of results) {
            for (const row of meters) {
                assert.notDeepEqual(row.loud, row.silent,
                    `${layout} flipX=${row.flipX} flipY=${row.flipY} draws the volume meter beside the keys`);
            }
            const blackKeyClasses = new Set([1, 3, 6, 8, 10]);
            const expectedKeys = Array.from({ length: highestNote - lowestNote + 1 },
                (_, index) => blackKeyClasses.has((highestNote - index) % 12));
            // This dark fixture paints silent black/white keys at 17/238 before depth shading.
            const keyColorMidpoint = (17 + 238) / 2;
            for (const row of rows) {
                assert.deepEqual(row.keys.map(pixel => pixel[0] < keyColorMidpoint), expectedKeys,
                    `${layout} flipX=${row.flipX} flipY=${row.flipY} keeps MIDI key order`);
                assert.ok(row.keys.every(pixel => pixel[3] === 255), `${layout} keyboard keys stay opaque`);
                if (row.oldSide) assert.equal(row.oldSide[3], 0, `${layout} vacates the original keyboard side`);
            }
            const labels = rows[0].labels;
            assert.ok(labels.some(label => label.text === 'C4'));
            assert.ok(labels.every(label => label.fontSize > 7 && label.fontSize <= 12),
                `${layout} keyboard labels grow toward the axis number size`);
            assert.ok(labels.every(label => label.width <= (layout === 'Horizontal' ? keySpan : keyDepth) + .01 &&
                label.height <= (layout === 'Horizontal' ? keyDepth : keySpan) + .01),
            `${layout} keyboard labels fit their white keys`);
        }
    } finally {
        await browser.close();
    }
});

test('Level Meter draws oversized values beyond its item and gives axis numbers the Visualizer style', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: `
            class PluginBase {
                constructor() { throw new Error('A display must not construct a pipeline plugin'); }
                parseFiniteNumber(value, min, max, fallback) {
                    return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
                }
            }
            window.ThemePalette = { get: role => role === 'graph-bg-deep' ? '#070809' : '#444444' };
        ` });
        await page.addScriptTag({ content: read('../../plugins/analyzer/level_meter.js') });
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-analyzer-display', 'visualizer-renderer'])
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        const results = await page.evaluate(() => {
            const stage = document.createElement('canvas'); stage.width = 800; stage.height = 400;
            const item = createItem('level-meter', 'meter');
            item.channel = 'L';
            item.params.showLevelValues = item.params.showAxes = item.params.showAxisNumbers = true;
            item.rect = { x: .02, y: .3, w: .05, h: .2 };
            // Graph Scale 1.6 on the 800 px stage keeps one graph pixel per canvas pixel.
            const layout = { graphScale: 1.6, background: { color: '#111111', effects: [] }, items: [item] };
            const sources = { subscribeItem: () => () => {}, getFrame: () => null, getModulators: () => ({}) };
            const renderer = new VisualizerRenderer(stage);
            renderer.draw(layout, sources, {}, 1, { quality: 'high' });
            const plugin = renderer.layers.get(item.id).display.plugin;
            plugin.lv = plugin.pl = plugin.raw = [-6];
            plugin.ph = [0];
            plugin.displayFrozen = true;
            plugin.displayFrozenExtrapolation = 0;
            const stageContext = stage.getContext('2d');
            const itemContext = renderer.layers.get(item.id).canvas.getContext('2d');
            const stageValues = [], axisStrokes = [], axisFills = [], gridStrokes = [], localValues = [];
            const signalWidths = [];
            const itemFillRect = itemContext.fillRect.bind(itemContext);
            itemContext.fillRect = (x, y, width, height) => {
                if (itemContext.fillStyle === item.palette.color) signalWidths.push(width);
                itemFillRect(x, y, width, height);
            };
            const stageFill = stageContext.fillText.bind(stageContext);
            stageContext.fillText = (text, x, y, ...rest) => {
                if (text.endsWith(' dB')) {
                    const metrics = stageContext.measureText(text);
                    stageValues.push({ text, left: x - metrics.actualBoundingBoxLeft,
                        right: x + metrics.actualBoundingBoxRight, color: stageContext.fillStyle });
                }
                stageFill(text, x, y, ...rest);
            };
            const itemStroke = itemContext.stroke.bind(itemContext);
            itemContext.stroke = (...args) => {
                gridStrokes.push(itemContext.strokeStyle);
                itemStroke(...args);
            };
            for (const method of ['strokeText', 'fillText']) {
                const native = itemContext[method].bind(itemContext);
                itemContext[method] = (text, ...args) => {
                    if (/^-\d+$/.test(text)) (method === 'strokeText' ? axisStrokes : axisFills).push({
                        text, x: args[0], font: itemContext.font,
                        color: method === 'strokeText' ? itemContext.strokeStyle : itemContext.fillStyle,
                        lineWidth: itemContext.lineWidth, lineJoin: itemContext.lineJoin
                    });
                    if (text.endsWith(' dB')) localValues.push({ text, color: itemContext.fillStyle });
                    native(text, ...args);
                };
            }
            const rows = [];
            for (const orientation of ['horizontal', 'vertical']) {
                item.params.orientation = orientation;
                for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                    stageValues.length = axisStrokes.length = axisFills.length = gridStrokes.length = localValues.length = 0;
                    renderer.draw(layout, sources, {}, 1, { quality: 'high' });
                    rows.push({ orientation, flipX, flipY, stageValues: structuredClone(stageValues),
                        axisStrokes: structuredClone(axisStrokes), axisFills: structuredClone(axisFills),
                        localValues: [...localValues] });
                }
            }
            item.rect = { x: .1, y: .3, w: .8, h: .2 };
            item.params.orientation = 'horizontal';
            stageValues.length = axisStrokes.length = axisFills.length = gridStrokes.length = localValues.length = 0;
            renderer.draw(layout, sources, {}, 1, { quality: 'high' });
            const wide = { stageValues: structuredClone(stageValues), axisStrokes: structuredClone(axisStrokes),
                localValues: structuredClone(localValues), signalWidth: signalWidths.at(-1) };
            item.params.dr = -61;
            axisFills.length = signalWidths.length = 0;
            renderer.draw(layout, sources, {}, 1, { quality: 'high' });
            const range = { dbStart: plugin.dbStart, dbRange: plugin.dbRange,
                canvasWidth: plugin.foregroundCanvas.width, ticks: structuredClone(axisFills),
                signalWidth: signalWidths.at(-1) };
            item.params.dr = -96;
            item.rect = { x: .02, y: .3, w: .05, h: .2 };
            layout.background.themeColors = {
                'graph-label': '#00ffff', 'graph-label-soft': '#ff5500',
                'graph-grid-soft': '#00aa00', 'graph-bg-deep': '#000099', 'text-primary': '#fafafa'
            };
            stageValues.length = axisStrokes.length = axisFills.length = gridStrokes.length = localValues.length = 0;
            renderer.draw(layout, sources, {}, 1, { quality: 'high' });
            const themed = { value: structuredClone(stageValues), fills: structuredClone(axisFills),
                outlines: structuredClone(axisStrokes), grid: [...gridStrokes] };
            const colorContext = document.createElement('canvas').getContext('2d');
            const canonical = color => { colorContext.fillStyle = color; return colorContext.fillStyle; };
            const expected = Object.fromEntries(Object.entries(layout.background.themeColors).map(([role, color]) =>
                [role, canonical(color)]));
            delete layout.background.themeColors;
            const appColors = { 'graph-label': '#6611bb', 'graph-label-soft': '#ff5500',
                'graph-grid-soft': '#336600',
                'graph-bg-deep': '#223344', 'text-primary': '#eecc44' };
            window.ThemePalette.get = role => appColors[role] ?? '#444444';
            stageValues.length = axisStrokes.length = axisFills.length = gridStrokes.length = localValues.length = 0;
            renderer.draw(layout, sources, {}, 1, { quality: 'high' });
            const defaultTheme = { value: structuredClone(stageValues), fills: structuredClone(axisFills),
                outlines: structuredClone(axisStrokes), grid: [...gridStrokes] };
            return { rows, wide, range, themed, expected, defaultTheme };
        });
        for (const row of results.rows) {
            assert.equal(row.stageValues.length, 1, `${row.orientation} draws its full value on the stage`);
            assert.equal(row.localValues.length, 0, 'The clipped item canvas does not draw the value');
            const value = row.stageValues[0];
            assert.equal(value.text, 'L -6.0 dB');
            assert.ok(value.left >= 0 && value.right <= 800, `${row.orientation} value fits the stage`);
            assert.ok(value.left < 16 || value.right > 56, 'Only the value may leave the narrow item');
            assert.ok(row.axisStrokes.length > 0);
            assert.deepEqual(row.axisStrokes.map(label => label.text), row.axisFills.map(label => label.text));
            assert.ok(row.axisStrokes.every(label => label.font === '11px Arial' &&
                label.color === '#000000' && label.lineWidth === 2 && label.lineJoin === 'round'));
        }
        assert.equal(results.wide.stageValues.length, 0, 'A fitting value stays in the item canvas');
        assert.deepEqual(results.wide.localValues.map(label => label.text), ['L -6.0 dB']);
        assert.ok(results.wide.axisStrokes.every(label => label.font === '12px Arial'));
        assert.equal(results.range.dbStart, -61);
        assert.equal(results.range.dbRange, 61);
        assert.ok(results.range.ticks.some(tick => tick.text === '-60' &&
            Math.abs(tick.x - results.range.canvasWidth / 61) < 0.01));
        assert.ok(results.range.signalWidth < results.wide.signalWidth);
        assert.ok(results.themed.fills.length > 0 &&
            results.themed.fills.every(label => label.color === results.expected['graph-label']));
        assert.ok(results.themed.outlines.every(label => label.color === results.expected['graph-bg-deep']));
        assert.ok(results.themed.grid.length > 0 &&
            results.themed.grid.every(color => color === results.expected['graph-grid-soft']));
        assert.deepEqual(results.themed.value.map(value => value.color), [results.expected['text-primary']]);
        assert.ok(results.defaultTheme.fills.every(label => label.color === '#666666'));
        assert.ok(results.defaultTheme.outlines.every(label => label.color === '#000000'));
        assert.ok(results.defaultTheme.grid.every(color => color === 'rgba(246, 248, 251, 0.2)'));
        assert.deepEqual(results.defaultTheme.value.map(value => value.color), ['#f6f8fb']);
    } finally {
        await browser.close();
    }
});

test('Spectrum Note Colors bars and peaks use one center-frequency color through orientation and flips', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: `
            class PluginBase {
                constructor() { throw new Error('A display must not construct a pipeline plugin'); }
                parseFiniteNumber(value, min, max, fallback) {
                    return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
                }
            }
            window.ThemePalette = { get: () => 'rgba(24,24,24,1)' };
        ` });
        for (const file of ['spectrum_analyzer', 'note_spectrogram'])
            await page.addScriptTag({ content: read(`../../plugins/analyzer/${file}.js`) });
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-analyzer-display'])
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        const results = await page.evaluate(() => {
            const sources = { subscribeItem: () => () => {}, getFrame: () => null, getModulators: () => ({}) };
            return ['horizontal', 'vertical'].flatMap(orientation =>
                [[false, false], [true, false], [false, true], [true, true]].map(([flipX, flipY]) => {
                    const canvas = document.createElement('canvas');
                    canvas.width = orientation === 'vertical' ? 400 : 800;
                    canvas.height = orientation === 'vertical' ? 800 : 400;
                    const item = createItem('spectrum', 'note-bars');
                    item.palette.mode = 'note-colors';
                    Object.assign(item.params, { dm: 'bar', sc: 'log-hq', kb: false,
                        showAxes: false, showAxisNumbers: false, orientation });
                    item.flipX = flipX; item.flipY = flipY;
                    const display = createAnalyzerDisplay(item, canvas, sources);
                    const plugin = display.plugin;
                    plugin.collectSpectrumLevels = width => [10, 11].map(band =>
                        [Math.round((band + .5) * width / 48), [-30, -20]]);
                    const context = canvas.getContext('2d');
                    display.draw(item, 1, 800);
                    const expected = [10, 11].map(band => {
                        const frequency = plugin.displayXToFrequency((band + .5) / 48);
                        const midi = 69 + 12 * Math.log2(frequency / 440);
                        return `rgb(${NoteSpectrogramPlugin.noteColor(midi).map(Math.round).join(',')})`;
                    });
                    const pixels = [10, 11].map(band => {
                        const bandX = (band + .5) * 800 / 48;
                        const x = orientation === 'vertical' ? 266 : bandX;
                        const y = orientation === 'vertical' ? 800 - bandX : 134;
                        const sampleX = flipX ? canvas.width - x : x;
                        const sampleY = flipY ? canvas.height - y : y;
                        return [...context.getImageData(Math.floor(sampleX) - 3, Math.floor(sampleY) - 3, 7, 7).data];
                    });
                    display.dispose();
                    return { orientation, flipX, flipY, expected, pixels };
                }));
        });
        for (const row of results) {
            row.pixels.forEach((pixels, index) => {
                const rgb = row.expected[index].match(/\d+/g).map(Number);
                const interior = Array.from({ length: 49 }, (_, sample) => pixels.slice(sample * 4, sample * 4 + 4));
                assert.ok(interior.some(pixel => rgb.every((value, channel) =>
                    Math.abs(value - pixel[channel]) <= 2)),
                `${row.orientation} flipX=${row.flipX} flipY=${row.flipY} band ${index} keeps its note color`);
            });
        }
    } finally {
        await browser.close();
    }
});

test('Heatmap keeps native colors on black while its dark values reveal the scene and Opacity still applies', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: `
            class PluginBase {
                constructor() { throw new Error('A display must not construct a pipeline plugin'); }
                parseFiniteNumber(value, min, max, fallback) {
                    return Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
                }
            }
            window.ThemePalette = { get: () => 'rgb(0,0,0)' };
        ` });
        await page.addScriptTag({ content: read('../../plugins/analyzer/spectrogram.js') });
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-analyzer-display'])
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        const samples = await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400;
            const item = createItem('spectrogram', 'heatmap'); item.palette.mode = 'heatmap';
            const display = createAnalyzerDisplay(item, canvas, {
                subscribeItem: () => () => {}, getFrame: () => null, getModulators: () => ({})
            });
            const { rgb } = SpectrogramPlugin.getHeatmapLuts();
            const results = [];
            for (const intensity of [0, 32, 128, 224, 255]) {
                display.plugin.paintDspSpectrogramColumn(0, new Uint8Array(256).fill(intensity));
                const signal = [...display.plugin.imageDataCache.data.slice(0, 4)];
                const pixel = document.createElement('canvas'); pixel.width = pixel.height = 1;
                pixel.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(signal), 1, 1), 0, 0);
                const backgrounds = [];
                for (const color of ['rgb(0,0,0)', 'rgb(40,60,80)']) {
                    const scene = document.createElement('canvas'); scene.width = scene.height = 1;
                    const context = scene.getContext('2d');
                    context.fillStyle = color; context.fillRect(0, 0, 1, 1);
                    context.drawImage(pixel, 0, 0);
                    backgrounds.push([...context.getImageData(0, 0, 1, 1).data]);
                }
                results.push({ intensity, signal, nativeRgb: [...rgb.slice(intensity * 3, intensity * 3 + 3)], backgrounds });
            }
            const effects = new VisualizerEffects();
            const opacity = effects.apply('heatmap', canvas,
                [normalizeEffect({ type: 'opacity', amount: .5 })], 0, {}).opacity;
            display.dispose();
            return { results, opacity };
        });
        assert.equal(samples.opacity, .5);
        for (const { intensity, signal, nativeRgb, backgrounds } of samples.results) {
            assert.ok(nativeRgb.every((value, channel) => Math.abs(backgrounds[0][channel] - value) <= 1),
                `Heatmap ${intensity} retains native color on black`);
            assert.equal(backgrounds[0][3], 255);
            if (intensity === 0) assert.deepEqual(backgrounds[1], [40, 60, 80, 255]);
            else if (signal[3] < 255) assert.ok(backgrounds[1].some((value, channel) =>
                channel < 3 && value !== backgrounds[0][channel]), `Heatmap ${intensity} reveals the scene`);
        }
    } finally {
        await browser.close();
    }
});
