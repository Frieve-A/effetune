import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const PALETTES = {
    light: { 'graph-bg-deep': '#ffffff', 'graph-label': '#333333', 'graph-grid-strong': '#999999', 'graph-grid-subtle': '#dddddd' },
    dark: { 'graph-bg-deep': '#101418', 'graph-label': '#d0d0d0', 'graph-grid-strong': '#666666', 'graph-grid-subtle': '#303030' }
};

// Page-side helpers: a frame-28 builder and a groove fed through locked and searching states.
const PAGE_HELPERS = `
window.buildRhythmFrame = ({ generation = 1, frameCount, locked = true, lockEpoch = 1, nextBeatIndex = 0, events = [] }) => {
    const payload = new DataView(new ArrayBuffer(1344));
    payload.setFloat32(0, 48000, true);
    payload.setUint32(4, generation, true);
    payload.setUint32(8, 480, true);
    payload.setUint32(12, frameCount, true);
    payload.setFloat32(16, frameCount * 0.01, true);
    payload.setUint32(28, events.length, true);
    payload.setUint32(32, locked ? 1 : 0, true);
    payload.setUint32(36, lockEpoch, true);
    payload.setFloat32(40, locked ? 0.3 : 0.05, true);
    payload.setFloat32(44, locked ? 0.5 : 0, true);
    payload.setUint32(48, frameCount, true);
    payload.setUint32(56, nextBeatIndex, true);
    payload.setFloat32(60, 120, true);
    for (let bin = 0; bin < 192; bin++) {
        const distance = (bin - 96) / 6;
        payload.setFloat32(64 + 4 * bin, Math.exp(-distance * distance), true);
    }
    events.forEach((event, slot) => {
        const base = 832 + 32 * slot;
        const beat = Math.floor(event.x);
        payload.setUint32(base, Math.floor(event.frame), true);
        payload.setFloat32(base + 4, event.frame % 1, true);
        payload.setUint32(base + 8, lockEpoch, true);
        payload.setInt32(base + 12, beat, true);
        payload.setFloat32(base + 16, event.x - beat, true);
        payload.setFloat32(base + 20, 0.5, true);
        payload.setFloat32(base + 24, 0.8, true);
        payload.setUint8(base + 28, event.band);
    });
    return { frameType: 28, formatVersion: 1, payload };
};
window.feedRhythm = (handle, generation = 1) => {
    // One frame per beat at 120 BPM (50 frames of 10 ms), carrying the onsets of the beat that just ended.
    let frameCount = 1;
    let beat = 0;
    const send = options => handle(window.buildRhythmFrame({ generation, frameCount: (frameCount += 50), ...options }));
    const bar = [[0, 0], [1, 1.02], [0, 2], [1, 3.02], ...Array.from({ length: 8 }, (_, i) => [2, i / 2 + 0.01])];
    for (const [lockEpoch, bars] of [[1, 6], [2, 10]]) {
        for (let index = 0; index < 4 * bars; index++, beat++) {
            const events = bar.filter(([, offset]) => Math.floor(offset) === index % 4)
                .map(([band, offset]) => ({ band, x: beat + offset - (index % 4), frame: frameCount + 50 * (offset % 1) }));
            send({ lockEpoch, nextBeatIndex: beat + 1, events });
        }
        if (lockEpoch === 1) {
            for (let index = 0; index < 4; index++) send({ locked: false, lockEpoch });
        }
    }
};
window.checkHeader = (rects, width, height) => {
    const problems = [];
    rects.forEach((rect, index) => {
        if (rect.left < 0 || rect.top < 0 || rect.left + rect.width > width || rect.top + rect.height > height) {
            problems.push(\`rect \${index} leaves the canvas\`);
        }
        for (const other of rects.slice(index + 1)) {
            if (rect.left < other.left + other.width && other.left < rect.left + rect.width &&
                rect.top < other.top + other.height && other.top < rect.top + rect.height) {
                problems.push(\`rect \${index} overlaps another item\`);
            }
        }
    });
    return problems;
};
window.countInk = (context, width, height, background) => {
    const data = context.getImageData(0, 0, width, height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (background ? data[i] !== background[0] || data[i + 1] !== background[1] || data[i + 2] !== background[2] : data[i + 3] > 0) ink++;
    }
    return ink;
};
`;

async function openPage(browser, width, theme) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.setContent('<!doctype html><body style="margin:0;padding:8px"></body>');
    await page.addScriptTag({ content: `window.ThemePalette = { get: role => (${JSON.stringify(PALETTES[theme])})[role] };` });
    await page.addScriptTag({ content: read('../../plugins/plugin-base.js') });
    await page.addScriptTag({ content: read('../../plugins/graph-readout.js') });
    await page.addScriptTag({ content: read('../../plugins/analyzer/rhythm_analyzer.js') });
    await page.addScriptTag({ content: PAGE_HELPERS });
    return page;
}

test('Rhythm Analyzer effect graph lays out its header at desktop and mobile widths in both themes', { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const width of [1024, 375]) {
            for (const theme of ['light', 'dark']) {
                const page = await openPage(browser, width, theme);
                const result = await page.evaluate(async () => {
                    const plugin = new window.RhythmAnalyzerPlugin();
                    plugin.id = 1;
                    const ui = plugin.createUI();
                    document.body.appendChild(ui);
                    const graph = plugin.canvas.parentElement;
                    // The mobile stylesheet applies --mobile-aspect-ratio below 768 px.
                    if (window.innerWidth < 768) graph.style.aspectRatio = graph.style.getPropertyValue('--mobile-aspect-ratio');
                    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                    window.feedRhythm(frame => plugin.handleTelemetry(frame));
                    plugin.setParameters({ sp: 4, vt: true, ve: true });
                    plugin.drawGraph();
                    const { width, height } = plugin.canvas;
                    const frame = plugin._readoutFrame;
                    const strip = frame.strip;
                    const readout = plugin._readRhythm(strip.left + strip.width - 2, strip.top + strip.height / 2);
                    const lensRead = plugin._readRhythm(frame.lens.left + frame.lens.width / 12, frame.lens.top + frame.lens.height / 2);
                    const latest = plugin._eventPoint((plugin.eventSerial - 1) % plugin.eventU.length, frame.views[0]);
                    const eventRead = plugin._readRhythm(latest.x, latest.y);
                    const background = window.ThemePalette.get('graph-bg-deep').match(/[0-9a-f]{2}/gi).map(hex => parseInt(hex, 16));
                    const out = {
                        width, height,
                        cssWidth: plugin.graphCssWidth,
                        headerCount: frame.header.length,
                        problems: window.checkHeader(frame.header, width, height),
                        panelsInside: [frame.strip, frame.main, frame.echo, frame.lens].every(panel =>
                            panel.left >= 0 && panel.top >= 0 && panel.height > 0 &&
                            panel.left + panel.width <= width && panel.top + panel.height <= height),
                        headerBelowStrip: frame.header.every(rect => rect.top + rect.height <= frame.strip.top),
                        stacked: frame.lens.top >= frame.echo.top + frame.echo.height,
                        echoRows: frame.views.length - 1,
                        segments: plugin.segments.size,
                        ink: window.countInk(plugin.canvasCtx, width, height, background),
                        readout: readout?.cursor ?? null,
                        lensRows: lensRead?.rows?.length ?? 0,
                        eventRead: eventRead?.rows?.[0]?.value ?? null,
                        span: plugin.sp,
                        spanOptions: ui.querySelectorAll('select option').length,
                        spanSelected: (plugin.syncUIControls(), ui.querySelector('select').value),
                        checkboxes: [...ui.querySelectorAll('.checkbox-row label')].map(label => label.textContent),
                        toggles: []
                    };
                    // Unticking panels through their checkboxes reflows the rest; the header always stays.
                    const boxes = Object.fromEntries([...ui.querySelectorAll('.checkbox-row')]
                        .map(row => [row.querySelector('label').textContent, row.querySelector('input')]));
                    const events = plugin.eventSerial;
                    for (const names of [['Tempogram:'], ['Timing lanes:', 'Echo rows:'], ['Beat lens:']]) {
                        for (const name of names) boxes[name].click();
                        const shown = plugin._readoutFrame;
                        const panels = shown.panels;
                        out.toggles.push({
                            keys: ['strip', 'main', 'echo', 'lens'].filter(key => shown[key]),
                            header: shown.header.length,
                            inside: panels.every(panel => panel.left >= 0 && panel.height > 0 &&
                                panel.left + panel.width <= width && panel.top + panel.height <= height &&
                                shown.header.every(rect => rect.top + rect.height <= panel.top)),
                            apart: window.checkHeader(panels, width, height).length === 0,
                            read: panels.every(panel => plugin._readRhythm(panel.left + panel.width / 2, panel.top + panel.height / 2) !== null)
                        });
                    }
                    out.historyKept = plugin.eventSerial === events;
                    plugin.cleanup();
                    return out;
                });
                const label = `${width}px ${theme}`;
                assert.deepEqual(result.problems, [], label);
                assert.ok(result.headerCount >= 6, label);
                assert.ok(result.panelsInside && result.headerBelowStrip, label);
                assert.equal(result.segments, 2, label);
                assert.ok(result.echoRows >= 4 && result.echoRows <= 6, label);
                assert.ok(result.ink > 1000, label);
                assert.match(result.readout, /BPM/, label);
                assert.ok(result.lensRows > 0, label);
                assert.match(result.eventRead, /ms/, label);
                assert.equal(result.span, 4, label);
                assert.equal(result.spanOptions, 5, label);
                assert.equal(result.spanSelected, '4', label);
                assert.deepEqual(result.checkboxes,
                    ['Metronome Click:', 'Tempogram:', 'Timing lanes:', 'Echo rows:', 'Beat lens:'], label);
                assert.deepEqual(result.toggles.map(entry => entry.keys), [['main', 'echo', 'lens'], ['lens'], []], label);
                for (const entry of result.toggles) {
                    assert.ok(entry.header >= 6 && entry.inside && entry.apart && entry.read, `${label} ${entry.keys}`);
                }
                assert.ok(result.historyKept, label);
                // Portrait canvases (mobile 3:4) stack the lens below the echo rows; landscape puts it beside them.
                assert.equal(result.stacked, width === 375, label);
                if (width === 375) assert.ok(result.cssWidth < 500, label);
                await page.close();
            }
        }
    } finally {
        await browser.close();
    }
});

test('Visualizer BPM fits inside the beat circle across sizes and preserves manual typography', { timeout: 60000 }, async () => {
    const bundle = await build({ stdin: { contents: `export { createAnalyzerDisplay } from './js/visualizer/visualizer-analyzer-display.js'; export { createItem } from './js/visualizer/visualizer-model.js';`,
        resolveDir: fileURLToPath(new URL('../../', import.meta.url)) },
    bundle: true, write: false, format: 'iife', globalName: 'RhythmCircleTest' });
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await openPage(browser, 1024, 'dark');
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const results = await page.evaluate(() => {
            const results = [];
            for (const [width, height, scale, decorated] of [[800, 400, 1], [320, 180, 1], [360, 640, 1], [1600, 800, 2], [800, 400, 1, true]]) {
                const item = RhythmCircleTest.createItem('rhythm-analyzer', 'circle');
                if (decorated) Object.assign(item.style, { fontSize: 120, fontFamily: 'serif', bold: true, italic: true, letterSpacing: 6, outlineWidth: 5 });
                Object.assign(item.params, { vt: false, vm: false, ve: false, vl: false, showAxes: false, showAxisNumbers: false });
                const canvas = document.createElement('canvas');
                canvas.width = width; canvas.height = height;
                const ctx = canvas.getContext('2d');
                const fillText = ctx.fillText.bind(ctx), arc = ctx.arc.bind(ctx);
                let circle, textBox, receive;
                ctx.arc = (x, y, radius, ...rest) => { circle = { x, y, radius }; arc(x, y, radius, ...rest); };
                ctx.fillText = (text, x, y, ...rest) => {
                    const metrics = ctx.measureText(text);
                    textBox = { x, y, left: metrics.actualBoundingBoxLeft, right: metrics.actualBoundingBoxRight,
                        top: metrics.actualBoundingBoxAscent, bottom: metrics.actualBoundingBoxDescent,
                        outline: ctx.lineWidth / 2, spacing: parseFloat(ctx.letterSpacing) || 0, font: ctx.font };
                    fillText(text, x, y, ...rest);
                };
                const display = RhythmCircleTest.createAnalyzerDisplay(item, canvas,
                    { subscribeItem(_id, callback) { receive = callback; return () => {}; } });
                for (const locked of [true, false]) {
                    receive(window.buildRhythmFrame({ frameCount: locked ? 100 : 110, locked }), {});
                    display.draw(item, 1, width / scale, undefined, scale);
                    const offsetX = textBox.x - circle.x;
                    const xs = [offsetX - textBox.left - textBox.outline, offsetX + textBox.right + textBox.outline];
                    const ys = [-textBox.top - textBox.outline, textBox.bottom + textBox.outline];
                    const extent = Math.max(...xs.flatMap(x => ys.map(y => Math.hypot(x, y))));
                    results.push({ width, height, locked, fits: extent <= circle.radius - item.style.beatLineWidth * scale / 2,
                        // Canvas serializes the computed letter spacing with limited precision.
                        centered: Math.abs(textBox.x - textBox.spacing / 2 - circle.x) < 1e-4 && Math.abs(textBox.y - circle.y) < 1e-6 });
                }
                item.style.beatFitBpm = false;
                display.draw(item, 1, width / scale, undefined, scale);
                const manualFont = `${item.style.italic ? 'italic ' : ''}${item.style.bold ? 'bold ' : ''}${item.style.fontSize * scale}px ${item.style.fontFamily}`;
                results.push({ manual: textBox.font === manualFont });
                item.style.beatFitBpm = true;
                item.style.align = 'left';
                display.draw(item, 1, width / scale, undefined, scale);
                results.push({ manual: textBox.font === manualFont });
                display.dispose();
            }
            return results;
        });
        for (const result of results) {
            if ('manual' in result) assert.equal(result.manual, true, 'Manual text size and placement remain available');
            else assert.ok(result.fits && result.centered, JSON.stringify(result));
        }
    } finally {
        await browser.close();
    }
});

test('Rhythm Analyzer draws through the Visualizer adapter path with split signal and text layers', { timeout: 60000 }, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await openPage(browser, 1024, 'dark');
        await page.addScriptTag({ type: 'module', content: `${read('../../js/visualizer/visualizer-effects.js')}\nwindow.VisualizerEffects = VisualizerEffects; window.rhythmPaletteColor = paletteColor;` });
        await page.waitForFunction(() => Boolean(window.VisualizerEffects));
        const result = await page.evaluate(() => {
            const plugin = Object.create(window.RhythmAnalyzerPlugin.prototype);
            plugin.initializeDisplayState();
            plugin.enabled = plugin._sectionEnabled = true;
            plugin.updateParameters = () => {};
            plugin.syncUIControls = () => {};
            plugin.ensureDspTelemetrySubscription = () => {};
            const canvas = document.createElement('canvas');
            canvas.width = 800;
            canvas.height = 450;
            const signal = document.createElement('canvas');
            signal.width = 800;
            signal.height = 450;
            plugin.canvas = canvas;
            plugin.ctx = canvas.getContext('2d');
            const signalContext = signal.getContext('2d');
            const markerPositions = [];
            plugin.displayOptions = {
                transparent: true,
                themePalette: window.ThemePalette,
                drawSignal: (context, draw) => draw(signalContext),
                textContext: { fillText: (...args) => plugin.ctx.fillText(...args), strokeText() {} },
                markerColor: position => {
                    markerPositions.push(position);
                    return 'rgb(0, 200, 255)';
                }
            };
            plugin.graphCssWidth = 800;
            plugin.graphDpr = 1;
            plugin.setParameters({ sp: 8 });
            window.feedRhythm(frame => plugin.handleVisualizerTelemetry(frame), 3);
            plugin.drawVisualizerRhythm();
            const withText = {
                header: plugin._readoutFrame.header.length,
                problems: window.checkHeader(plugin._readoutFrame.header, 800, 450),
                signalInk: window.countInk(signalContext, 800, 450),
                textInk: window.countInk(plugin.ctx, 800, 450)
            };
            plugin.displayOptions.showAxisNumbers = false;
            plugin.displayOptions.showAxes = false;
            signalContext.clearRect(0, 0, 800, 450);
            plugin.drawVisualizerRhythm();
            const hiddenSignalInk = window.countInk(signalContext, 800, 450);
            plugin.setParameters({ vt: false, vm: false, ve: false, vl: true });
            signalContext.clearRect(0, 0, 800, 450);
            plugin.drawVisualizerRhythm();
            const lensSignalInk = window.countInk(signalContext, 800, 450);
            const lensAnnotationInk = window.countInk(plugin.ctx, 800, 450);
            const output = new window.VisualizerEffects().apply('lens', signal, [
                { type: 'opacity', enabled: true, amount: 0, mod: { source: 'none', depth: 0 } }
            ], 0, {});
            const composite = document.createElement('canvas');
            composite.width = 800;
            composite.height = 450;
            const compositeContext = composite.getContext('2d');
            compositeContext.globalAlpha = output.opacity;
            compositeContext.drawImage(output.canvas, 0, 0, 800, 450);
            compositeContext.globalAlpha = 1;
            compositeContext.drawImage(canvas, 0, 0);
            const zeroOpacityInk = window.countInk(compositeContext, 800, 450);
            const gradient = {
                stops: [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }],
                motion: { mode: 'none', speed: 0 }
            };
            const positionColor = position => window.rhythmPaletteColor(gradient, position);
            plugin.displayOptions.markerColor = positionColor;
            plugin.displayOptions.tempogramColor = positionColor;
            plugin.tempogram.fill(1);
            plugin.tempogramDirty = true;
            plugin.setParameters({ vt: true, vm: true, ve: true });
            signalContext.clearRect(0, 0, 800, 450);
            plugin.drawVisualizerRhythm();
            const panelColors = ['strip', 'main', 'echo', 'lens'].map(key => {
                const rect = plugin._readoutFrame[key];
                const pixels = signalContext.getImageData(Math.ceil(rect.left), Math.ceil(rect.top),
                    Math.floor(rect.width), Math.floor(rect.height)).data;
                let red = 0, blue = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index + 3] < 30) continue;
                    if (pixels[index] > pixels[index + 2]) red++;
                    if (pixels[index + 2] > pixels[index]) blue++;
                }
                return { key, red, blue };
            });
            const rasterBefore = Array.from(plugin.tempogramImageContext.getImageData(0, 0, 1, 1).data);
            // A palette or motion update replaces the adapter's callback without changing telemetry.
            plugin.displayOptions.tempogramColor = position => positionColor(1 - position);
            plugin.drawVisualizerRhythm();
            const rasterAfter = Array.from(plugin.tempogramImageContext.getImageData(0, 0, 1, 1).data);
            plugin.displayOptions.markerColor = () => 'rgb(0, 200, 255)';
            plugin.displayOptions.tempogramColor = null;
            plugin.drawVisualizerRhythm();
            const solidRaster = Array.from(plugin.tempogramImageContext.getImageData(0, 0, 1, 1).data);
            return {
                withText,
                hiddenHeader: plugin._readoutFrame.header.length,
                hiddenSignalInk,
                lensSignalInk,
                lensAnnotationInk,
                zeroOpacityInk,
                panelColors,
                rasterBefore,
                rasterAfter,
                solidRaster,
                markerInRange: markerPositions.length > 0 && markerPositions.every(value => value >= 0 && value <= 1),
                marker120: markerPositions.some(value => Math.abs(value - Math.log2(4) / 4) < 1e-6)
            };
        });
        assert.ok(result.withText.header >= 5);
        assert.deepEqual(result.withText.problems, []);
        assert.ok(result.withText.signalInk > 500);
        assert.ok(result.withText.textInk > 500);
        assert.equal(result.hiddenHeader, 0);
        assert.ok(result.hiddenSignalInk > 500);
        assert.ok(result.lensSignalInk > 0);
        assert.equal(result.lensAnnotationInk, 0);
        assert.equal(result.zeroOpacityInk, 0);
        for (const colors of result.panelColors) {
            assert.ok(colors.red > 0 && colors.blue > 0, `${colors.key} spans the gradient`);
        }
        assert.ok(result.rasterBefore[2] > result.rasterBefore[0]);
        assert.ok(result.rasterAfter[0] > result.rasterAfter[2]);
        assert.deepEqual(result.solidRaster, [208, 208, 208, 255]);
        assert.ok(result.markerInRange && result.marker120);
        await page.close();
    } finally {
        await browser.close();
    }
});
