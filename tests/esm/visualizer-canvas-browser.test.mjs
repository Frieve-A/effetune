import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { chromium } from 'playwright';
import { ITEM_TYPES } from '../../js/visualizer/visualizer-model.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const moduleScript = path => read(path).replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
const frequencyAxisScript = read('../../plugins/frequency-axis.js');
const { FrequencyAxis } = (() => { const window = {}; vm.runInNewContext(frequencyAxisScript, { window }); return window; })();

test('Gaussian blur retains its scene-relative width and opaque edges at different output sizes', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        const results = await page.evaluate(() => [640, 1280, 2560].map(width => {
            const canvas = createLayer(width, width / 2), ctx = canvas.getContext('2d');
            ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, width, width / 2);
            ctx.fillStyle = '#ffffff'; ctx.fillRect(width / 2, 0, width / 2, width / 2);
            const output = new VisualizerEffects().apply('blur', canvas,
                [normalizeEffect({ type: 'blur', amount: .75 })], 0, {}, 0, true, false, false, width / 1280).canvas;
            const read = (x, y) => [...output.getContext('2d').getImageData(x, y, 1, 1).data];
            return {
                profile: [-.04, -.02, 0, .02, .04].map(offset => read(Math.floor(output.width * (.5 + offset)), output.height / 2)[0]),
                edges: [[0, 0], [output.width - 1, 0], [0, output.height - 1], [output.width - 1, output.height - 1]]
                    .map(([x, y]) => read(x, y)[3])
            };
        }));
        for (const result of results) {
            assert.ok(result.edges.every(alpha => alpha >= 254), 'Edge extension keeps the opaque layer opaque');
            assert.ok(result.profile[1] > 0 && result.profile[3] < 255, 'Gaussian transitions remain smooth');
            assert.ok(result.profile.every((value, index) => Math.abs(value - results[1].profile[index]) <= 6),
                `The same scene positions have the same blur profile: ${JSON.stringify(results)}`);
        }
    } finally { await browser.close(); }
});

test('Lyrics seeking follows rendered transforms, movement and flips including overflow', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        await page.addScriptTag({ content: `{${moduleScript('../../js/library/metadata/lyrics.js')}; window.lyricsLineAt = lyricsLineAt;}` });
        await page.addScriptTag({ content: `{${moduleScript('../../js/visualizer/visualizer-lyrics.js')}; window.lyricsFrame = lyricsFrame; window.lyricsOpacity = lyricsOpacity; window.drawLyrics = drawLyrics;}` });
        const results = await page.evaluate(() => {
            const stage = createLayer(1280, 720), renderer = new VisualizerRenderer(stage), item = createItem('lyrics', 'lyrics');
            item.rect = { x: .3, y: .25, w: .3, h: .3 };
            Object.assign(item.params, { lyricsView: 'list', lyricsMotion: 'step', lyricsFadeIn: 0, lyricsFadeOut: 0 });
            item.style.fontSize = 40;
            const layout = { ...createDefaultLayout(), items: [item] };
            layout.background.color = '#000000';
            const lyrics = { data: { synced: true, lines: [{ text: 'First', time: 0 },
                { text: 'Second', time: 5 }, { text: 'Third', time: 10 }] }, time: 6, duration: 20 };
            const sources = { getModulators: () => ({}), getFrame: () => null };
            // Color the measured row regions so their actual rendered positions can be
            // located from pixels independently of the hit-test transformation.
            const drawItem = renderer.drawItem.bind(renderer);
            renderer.drawItem = (state, item, ...args) => {
                drawItem(state, item, ...args);
                if (item.type !== 'lyrics') return;
                const ctx = state.canvas.getContext('2d');
                ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
                for (const [index, row] of state.lyricsMeasurements.hits.entries()) {
                    ctx.fillStyle = ['#ff0000', '#00ff00', '#0000ff'][index];
                    ctx.fillRect(row.left, row.top, row.right - row.left, row.bottom - row.top);
                }
            };
            const cases = [[], [{ type: 'transform', offsetY: 100 }],
                [{ type: 'transform', angle: 35, skewX: 20, skewY: -10, scaleX: 120, scaleY: 75, offsetX: 20 }],
                [{ type: 'scale-pulse', amount: 1 }, { type: 'shake', amount: 1 }],
                [{ type: 'transform', angle: 20, offsetY: 40 }, { type: 'scale-pulse', amount: 1 }, { type: 'shake', amount: 1 }]];
            const results = [];
            for (const quality of ['high', 'low']) for (const effects of cases) {
                for (const [flipX, flipY] of [[false, false], [true, false], [false, true], [true, true]]) {
                    Object.assign(item, { effects: effects.map(effect => normalizeEffect(effect)), flipX, flipY });
                    renderer.draw(layout, sources, null, .13, { lyrics, quality });
                    const pixels = stage.getContext('2d').getImageData(0, 0, stage.width, stage.height).data;
                    const sums = Array.from({ length: 3 }, () => ({ x: 0, y: 0, count: 0 }));
                    for (let y = 0; y < stage.height; y++) for (let x = 0; x < stage.width; x++) {
                        const offset = (y * stage.width + x) * 4;
                        for (let color = 0; color < 3; color++) if (pixels[offset + color] > 250 &&
                            pixels[offset + (color + 1) % 3] < 5 && pixels[offset + (color + 2) % 3] < 5) {
                            sums[color].x += x + .5; sums[color].y += y + .5; sums[color].count++;
                        }
                    }
                    const rows = renderer.layers.get(item.id).lyricsMeasurements.hits;
                    results.push({ quality, effects, flipX, flipY, rows: sums.map((sum, index) => ({
                        pixels: sum.count, expected: rows[index].time,
                        actual: renderer.lyricsSeekTime(layout, sum.x / sum.count / stage.width, sum.y / sum.count / stage.height)
                    })) });
                }
            }
            renderer.dispose();
            return results;
        });
        for (const result of results) for (const row of result.rows) {
            assert.ok(row.pixels > 100, `Each row is visibly rendered: ${JSON.stringify(result)}`);
            assert.equal(row.actual, row.expected, JSON.stringify(result));
        }
    } finally { await browser.close(); }
});

test('Edge Fade uses independent rectangular widths, a true circle, and whole-mask Amount interpolation', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.addScriptTag({ content: moduleScript('../../js/visualizer/visualizer-effects.js') });
        const result = await page.evaluate(() => {
            const sample = (effect, amount, points) => {
                const canvas = createLayer(200, 100), mask = createLayer(200, 100), ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, 200, 100);
                applyEdgeFade(ctx, mask, { shape: 'rectangle', top: 0, bottom: 0, left: 0, right: 0, circleWidth: .2, ...effect }, amount);
                return points.map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]);
            };
            const points = [[25, 25], [100, 50]];
            return {
                full: sample({ top: .5, left: .25 }, 1, points),
                half: sample({ top: .5, left: .25 }, .5, points),
                zero: sample({ top: .5, left: .25 }, 0, points),
                right: sample({ right: .5 }, 1, [[175, 50], [25, 50]]),
                circle: sample({ shape: 'circle' }, 1, [[20, 50], [100, 50], [145, 50], [100, 95]]),
                sharp: sample({ shape: 'circle', circleWidth: 0 }, 1, [[20, 50], [100, 50], [140, 50]])
            };
        });
        assert.ok(Math.abs(result.full[0] - 66) <= 3);
        assert.equal(result.full[1], 255);
        assert.ok(Math.abs(result.half[0] - (255 + result.full[0]) / 2) <= 2);
        assert.deepEqual(result.zero, [255, 255]);
        assert.ok(Math.abs(result.right[0] - 62) <= 3);
        assert.equal(result.right[1], 255);
        assert.deepEqual(result.circle.slice(0, 2), [0, 255]);
        assert.ok(result.circle[2] > 90 && result.circle[2] < 140);
        assert.ok(Math.abs(result.circle[2] - result.circle[3]) <= 2);
        assert.deepEqual(result.sharp, [0, 255, 255]);
    } finally { await browser.close(); }
});

test('Edge Fade composites every item including analyzer underlays, axes, labels, and backplates', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-counter',
            'visualizer-playback-control', 'visualizer-seek-bar', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        await page.addScriptTag({ content: `{${moduleScript('../../js/visualizer/visualizer-lyrics.js')}; window.lyricsFrame = lyricsFrame; window.lyricsOpacity = lyricsOpacity; window.drawLyrics = drawLyrics;}` });
        const results = await page.evaluate(() => {
            // Exercise the renderer's real split-layer analyzer contract without DSP or live audio.
            window.createAnalyzerDisplay = (_item, canvas) => ({ signalCanvas: createLayer(canvas.width, canvas.height),
                underlayCanvas: createLayer(canvas.width, canvas.height),
                overflowLevelValues: [{ text: 'VALUE', x: canvas.width + 4, y: 30, font: '12px sans-serif',
                    fillStyle: '#ffffff', strokeStyle: '#000000', lineWidth: 1, textAlign: 'left', textBaseline: 'top' }],
                draw() {
                    for (const [layer, color] of [[canvas, '#ffffff'], [this.signalCanvas, '#ffffff'], [this.underlayCanvas, '#008800']]) {
                        const ctx = layer.getContext('2d'); ctx.fillStyle = color;
                        ctx.fillRect(layer === canvas ? 0 : 15, 0, layer === canvas ? 5 : layer.width - 15, layer.height);
                    }
                    return true;
                }, dispose() {} });
            const cover = createLayer(10, 10); cover.naturalWidth = cover.naturalHeight = 10;
            cover.getContext('2d').fillStyle = '#ffffff'; cover.getContext('2d').fillRect(0, 0, 10, 10);
            const results = [], sources = { getModulators: () => ({}), getFrame: () => null };
            const metadata = { title: 'MMMMMM', album: 'MMMMMM', artist: 'MMMMMM', artwork: [{ src: 'cover' }] };
            const lyrics = { data: { synced: false, lines: [{ text: 'MMMMMM' }] }, time: 0, duration: 10 };
            for (const type of ITEM_TYPES) {
                const stage = createLayer(240, 200), renderer = new VisualizerRenderer(stage), item = createItem(type, type);
                renderer.image = url => url ? cover : null;
                item.rect = { x: .125, y: .1, w: .75, h: .8 };
                Object.assign(item.style, { fontSize: 96, outlineWidth: 1, outlineColor: '#ffffff', shadowOpacity: .5, shadowBlur: 4 });
                item.palette.mode = 'solid'; item.palette.color = '#ffffff';
                if (type === 'text') item.params.text = 'MMMMMM';
                if (type === 'lyrics') Object.assign(item.params, { lyricsFadeIn: 0, lyricsFadeOut: 0 });
                item.effects = [normalizeEffect({ type: 'backplate', margin: 30, fill: '#004488', fillOpacity: 1 })];
                const layout = { ...createDefaultLayout(), background: { color: '#000000', image: null, effects: [] }, items: [item] };
                renderer.draw(layout, sources, metadata, 0, { lyrics });
                const before = stage.getContext('2d').getImageData(0, 0, 240, 200).data;
                item.effects.push(normalizeEffect({ type: 'edge-fade', top: 1, left: 1, bottom: 0, right: 0 }));
                renderer.draw(layout, sources, metadata, 0, { lyrics });
                const after = stage.getContext('2d').getImageData(0, 0, 240, 200).data;
                let checked = 0, mismatches = 0, outside = 0;
                for (let y = 0; y < 200; y++) for (let x = 0; x < 240; x++) {
                    const index = (y * 240 + x) * 4;
                    if (x < 30 || x >= 210 || y < 20 || y >= 180) {
                        if (after[index] + after[index + 1] + after[index + 2] > 0) outside++;
                        continue;
                    }
                    if (before[index] + before[index + 1] + before[index + 2] < 50) continue;
                    checked++;
                    const alpha = ((x - 30 + .5) / 180) * ((y - 20 + .5) / 160);
                    if ([0, 1, 2].some(channel => Math.abs(after[index + channel] - before[index + channel] * alpha) > 4)) mismatches++;
                }
                results.push({ type, checked, mismatches, outside }); renderer.dispose();
            }
            return results;
        });
        assert.deepEqual(results.map(result => result.type), ITEM_TYPES);
        for (const result of results) {
            assert.ok(result.checked > 100, result.type);
            assert.equal(result.mismatches, 0, JSON.stringify(result));
            assert.equal(result.outside, 0, result.type);
        }
    } finally { await browser.close(); }
});

test('Edge Fade preserves inactive rendering and reuses static masks in normal and feed documents', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        const result = await page.evaluate(() => {
            const stage = createLayer(200, 100), renderer = new VisualizerRenderer(stage), item = createItem('shape', 'shape');
            item.rect = { x: 0, y: 0, w: 1, h: 1 }; item.palette.color = '#ffffff';
            const fade = normalizeEffect({ type: 'edge-fade', top: 1, bottom: 0 });
            item.effects = [fade];
            const layout = { ...createDefaultLayout(), background: { color: '#000000', image: null, effects: [] }, items: [item] };
            let level = .5;
            const sources = { getModulators: () => ({ level }), getFrame: () => null };
            const draw = () => renderer.draw(layout, sources, null, 0);
            draw();
            const state = renderer.layers.get('shape'), layer = state.fadeLayer, mask = state.fadeMask;
            let clears = 0; const ctx = layer.getContext('2d'), clear = ctx.clearRect.bind(ctx);
            ctx.clearRect = (...args) => { clears++; clear(...args); };
            draw(); const staticClears = clears;
            fade.left = 1; draw(); const updatedClears = clears;
            Object.assign(fade.mod, { source: 'level', depth: 1 });
            level = .2; draw(); const low = stage.getContext('2d').getImageData(50, 25, 1, 1).data[0];
            level = .8; draw(); const high = stage.getContext('2d').getImageData(50, 25, 1, 1).data[0];
            fade.mod.source = 'none'; fade.amount = 0; draw(); const zero = stage.getContext('2d').getImageData(50, 25, 1, 1).data[0];
            fade.amount = 1; fade.enabled = false; draw(); const disabled = stage.getContext('2d').getImageData(50, 25, 1, 1).data[0];
            fade.enabled = true;
            const feedDocument = document.implementation.createHTMLDocument('Clean Feed');
            const feed = feedDocument.createElement('canvas'); feed.width = 200; feed.height = 100;
            const feedRenderer = new VisualizerRenderer(feed); feedRenderer.draw(layout, sources, null, 0);
            draw();
            const mainPixels = stage.getContext('2d').getImageData(0, 0, 200, 100).data;
            const feedPixels = feed.getContext('2d').getImageData(0, 0, 200, 100).data;
            return { staticClears, updatedClears, low, high, zero, disabled,
                reused: state.fadeLayer === layer && state.fadeMask === mask,
                feedMatches: mainPixels.every((value, index) => value === feedPixels[index]) };
        });
        assert.equal(result.staticClears, 0);
        assert.equal(result.updatedClears, 1);
        assert.ok(result.low > result.high + 80);
        assert.equal(result.zero, 255);
        assert.equal(result.disabled, 255);
        assert.equal(result.reused, true);
        assert.equal(result.feedMatches, true);
    } finally { await browser.close(); }
});

test('Edge Fade repaints cached static items after horizontal and vertical flips', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        const results = await page.evaluate(() => {
            const cover = createLayer(200, 100), coverCtx = cover.getContext('2d');
            cover.naturalWidth = 200; cover.naturalHeight = 100;
            for (const [color, x, y] of [['#ff0000', 0, 0], ['#0000ff', 100, 0], ['#00ff00', 0, 50], ['#ffffff', 100, 50]]) {
                coverCtx.fillStyle = color; coverCtx.fillRect(x, y, 100, 50);
            }
            return ['text', 'title', 'artwork', 'video', 'shape'].map(type => {
                const stage = createLayer(200, 100), renderer = new VisualizerRenderer(stage), item = createItem(type, type);
                item.rect = { x: 0, y: 0, w: 1, h: 1 };
                item.effects = [normalizeEffect({ type: 'edge-fade', top: 0, bottom: 0 })];
                renderer.image = url => url ? cover : null;
                const layout = { ...createDefaultLayout(), items: [item] };
                const sources = { getModulators: () => ({}), getFrame: () => null };
                const draw = () => renderer.draw(layout, sources, { title: 'Static', artwork: [{ src: 'cover' }] }, 0);
                const pixel = () => Array.from(stage.getContext('2d').getImageData(25, 25, 1, 1).data.slice(0, 3));
                draw(); const before = pixel();
                const ctx = renderer.layers.get(type).fadeLayer.getContext('2d'), clear = ctx.clearRect.bind(ctx);
                let clears = 0; ctx.clearRect = (...args) => { clears++; clear(...args); };
                item.flipX = true; draw(); const horizontal = pixel(), afterX = clears;
                item.flipY = true; draw(); const vertical = pixel(), afterY = clears;
                draw(); const held = clears;
                renderer.dispose();
                return { type, before, horizontal, vertical, afterX, afterY, held };
            });
        });
        for (const result of results) {
            assert.equal(result.afterX, 1, result.type);
            assert.equal(result.afterY, 2, result.type);
            assert.equal(result.held, 2, result.type);
        }
        // Video without a playing picture falls back to the cover by default.
        for (const type of ['artwork', 'video']) {
            const picture = results.find(result => result.type === type);
            assert.deepEqual(picture.before, [255, 0, 0], type);
            assert.deepEqual(picture.horizontal, [0, 0, 255], type);
            assert.deepEqual(picture.vertical, [255, 255, 255], type);
        }
    } finally { await browser.close(); }
});

test('Video items draw the current frame with each fit and redraw when the frame time advances', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        const result = await page.evaluate(() => {
            // A canvas stands in for the video element; drawImage accepts both.
            const frame = createLayer(100, 100), frameCtx = frame.getContext('2d');
            Object.assign(frame, { videoWidth: 100, videoHeight: 100, currentTime: 0 });
            frameCtx.fillStyle = '#ff0000'; frameCtx.fillRect(0, 0, 100, 100);
            const sources = { getModulators: () => ({}), getFrame: () => null };
            const pixels = fit => {
                const stage = createLayer(200, 100), renderer = new VisualizerRenderer(stage), item = createItem('video', 'video');
                item.rect = { x: 0, y: 0, w: 1, h: 1 }; item.style.fit = fit;
                const layout = { ...createDefaultLayout(), items: [item] };
                renderer.draw(layout, sources, {}, 0, { video: frame });
                const read = (x, y) => Array.from(stage.getContext('2d').getImageData(x, y, 1, 1).data.slice(0, 4));
                const edge = read(10, 50), center = read(100, 50);
                frameCtx.fillStyle = '#0000ff'; frameCtx.fillRect(0, 0, 100, 100);
                renderer.draw(layout, sources, {}, 0, { video: frame }); const held = read(100, 50);
                frame.currentTime = 1; renderer.draw(layout, sources, {}, 0, { video: frame }); const advanced = read(100, 50);
                frame.currentTime = 0; frameCtx.fillStyle = '#ff0000'; frameCtx.fillRect(0, 0, 100, 100);
                renderer.dispose();
                return { edge, center, held, advanced };
            };
            return { contain: pixels('contain'), cover: pixels('cover'), stretch: pixels('stretch') };
        });
        assert.deepEqual(result.contain.edge.slice(0, 3), [8, 13, 28]);
        for (const fit of ['contain', 'cover', 'stretch']) {
            assert.deepEqual(result[fit].center.slice(0, 3), [255, 0, 0], fit);
            assert.deepEqual(result[fit].held.slice(0, 3), [255, 0, 0], fit);
            assert.deepEqual(result[fit].advanced.slice(0, 3), [0, 0, 255], fit);
        }
        for (const fit of ['cover', 'stretch']) assert.deepEqual(result[fit].edge.slice(0, 3), [255, 0, 0], fit);
    } finally { await browser.close(); }
});

test('Lyrics temporal fades composite decorations and overflow and keep animating held rows in Clean Feed', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        await page.addScriptTag({ content: `{${moduleScript('../../js/visualizer/visualizer-lyrics.js')}; window.lyricsFrame = lyricsFrame; window.lyricsOpacity = lyricsOpacity; window.drawLyrics = drawLyrics;}` });
        const result = await page.evaluate(() => {
            const stage = createLayer(300, 150), renderer = new VisualizerRenderer(stage), item = createItem('lyrics', 'lyrics');
            Object.assign(item.params, { lyricsFadeIn: 0, lyricsFadeOut: 0 });
            item.rect = { x: .2, y: .2, w: .6, h: .6 };
            item.palette.color = '#ffffff';
            Object.assign(item.style, { fontSize: 100, outlineWidth: 3, shadowOpacity: .8, shadowBlur: 8 });
            item.effects = [normalizeEffect({ type: 'backplate', margin: 30, fill: '#ffffff', fillOpacity: 1 })];
            const layout = { ...createDefaultLayout(), background: { color: '#000000', image: null, effects: [] }, items: [item] };
            const data = { synced: false, lines: [{ text: 'MMMM' }] };
            const sources = { getModulators: () => ({}), getFrame: () => null };
            const lyrics = { data, time: 5, duration: 20, isStopped: false };
            renderer.draw(layout, sources, null, 0, { lyrics });
            const before = stage.getContext('2d').getImageData(0, 0, 300, 150).data;
            item.params.lyricsFadeIn = item.params.lyricsFadeOut = 2;
            const main = new VisualizerRenderer(stage);
            const feedDocument = document.implementation.createHTMLDocument('Clean Feed');
            const feed = feedDocument.createElement('canvas'); feed.width = 300; feed.height = 150;
            const clean = new VisualizerRenderer(feed);
            const draw = time => { main.draw(layout, sources, null, time, { lyrics }); clean.draw(layout, sources, null, time, { lyrics }); };
            lyrics.time = 1; draw(100); draw(101);
            const after = stage.getContext('2d').getImageData(0, 0, 300, 150).data;
            let checked = 0, mismatches = 0;
            for (let index = 0; index < before.length; index += 4) {
                if (before[index] + before[index + 1] + before[index + 2] < 30) continue;
                checked++;
                if ([0, 1, 2].some(channel => Math.abs(after[index + channel] - before[index + channel] / 2) > 2)) mismatches++;
            }
            const halfOverflow = stage.getContext('2d').getImageData(57, 50, 1, 1).data[0];
            const feedPixels = feed.getContext('2d').getImageData(0, 0, 300, 150).data;
            const same = after.every((value, index) => value === feedPixels[index]);
            lyrics.time = 5; draw(102); const full = stage.getContext('2d').getImageData(57, 50, 1, 1).data[0];
            lyrics.time = 19; draw(103); const tail = stage.getContext('2d').getImageData(57, 50, 1, 1).data[0];
            draw(108); const paused = stage.getContext('2d').getImageData(57, 50, 1, 1).data[0];
            item.effects.push(normalizeEffect({ type: 'edge-fade', top: 0, bottom: 0 }));
            draw(109); const clipped = stage.getContext('2d').getImageData(57, 50, 1, 1).data[0];
            const inside = stage.getContext('2d').getImageData(65, 50, 1, 1).data[0];
            lyrics.time = 20; draw(110);
            const ended = stage.getContext('2d').getImageData(65, 50, 1, 1).data[0];
            lyrics.data = null; draw(111);
            const pendingPruned = !main.layers.has('lyrics');
            lyrics.data = { synced: false, lines: [{ text: 'Next track' }] }; lyrics.time = 1;
            draw(111); // Arrival immediately follows position without waiting for wall time.
            const late = stage.getContext('2d').getImageData(65, 50, 1, 1).data[0];
            lyrics.time = 5; draw(111);
            const sought = stage.getContext('2d').getImageData(65, 50, 1, 1).data[0];
            lyrics.data = { synced: false, lines: [{ text: 'Another track' }] }; lyrics.time = 1;
            draw(111);
            const switched = stage.getContext('2d').getImageData(65, 50, 1, 1).data[0];
            return { checked, mismatches, halfOverflow, same, full, tail, paused, clipped, inside, ended, pendingPruned, late, sought, switched };
        });
        assert.ok(result.checked > 1000);
        assert.equal(result.mismatches, 0);
        assert.equal(result.halfOverflow, 128);
        assert.equal(result.same, true);
        assert.equal(result.full, 255);
        assert.equal(result.tail, 128);
        assert.equal(result.paused, 128);
        assert.equal(result.clipped, 0);
        assert.equal(result.inside, 128);
        assert.equal(result.ended, 0);
        assert.equal(result.pendingPruned, true);
        assert.equal(result.late, 128);
        assert.equal(result.sought, 255);
        assert.equal(result.switched, 128);
    } finally { await browser.close(); }
});

test('Horizontal Lyrics traverse natural text widths, fit steps, and preserve box gradients and word fill', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        await page.addScriptTag({ content: `{${moduleScript('../../js/library/metadata/lyrics.js')}; window.lyricsLineAt = lyricsLineAt;}` });
        await page.addScriptTag({ content: `{${moduleScript('../../js/visualizer/visualizer-lyrics.js')}; window.lyricsFrame = lyricsFrame; window.drawLyrics = drawLyrics;}` });
        const result = await page.evaluate(() => {
            const w = 320, h = 100, canvas = createLayer(w, h), ctx = canvas.getContext('2d');
            const item = createItem('lyrics', 'lyrics');
            Object.assign(item.style, { fontSize: 32, fontFamily: 'sans-serif', textCase: 'upper', letterSpacing: 2 });
            item.params.lyricsMotion = 'smooth-horizontal';
            const data = { synced: true, lines: [{ time: 0, text: 'A long beginning with many words to read completely' },
                { time: 4, text: 'Last long sentence must also pass completely' }] };
            const cache = {}, calls = [];
            let measured = 0;
            const measure = ctx.measureText.bind(ctx), fillText = ctx.fillText.bind(ctx);
            ctx.measureText = text => { measured++; return measure(text); };
            ctx.fillText = (text, x, y, maxWidth) => { calls.push({ text, x, y, maxWidth }); fillText(text, x, y, maxWidth); };
            const draw = time => {
                calls.length = 0; ctx.clearRect(0, 0, w, h);
                drawLyrics(ctx, item, lyricsFrame(item, { data, time, duration: 8 }, false), w, h, 1, '#ffffff', null, cache);
                return calls.map(call => ({ ...call }));
            };
            const start = draw(0), count = measured, middle = draw(1), later = draw(2), finish = draw(8);
            const cacheReuse = measured === count;
            const natural = cache.widths[0];
            const anchors = [0, 50, 100].map(position => {
                item.params.lyricsPosition = position;
                return draw(4).find(call => call.text.startsWith('LAST')).x;
            });
            item.params.lyricsPosition = 50;
            const verticalAnchors = ['top', 'middle', 'bottom'].map(align => {
                item.style.verticalAlign = align;
                return draw(4).find(call => call.text.startsWith('LAST')).y;
            });
            item.style.verticalAlign = 'middle';
            item.params.lyricsMotion = 'step-horizontal';
            item.style.align = 'center';
            const stepA = draw(.2), stepB = draw(3), stepStart = draw(4), stepMiddle = draw(4.09), stepNext = draw(4.2);
            const firstX = list => list.find(call => call.text.startsWith('A LONG'))?.x;
            const stepMoves = firstX(stepStart) > firstX(stepMiddle) &&
                stepNext.find(call => call.text.startsWith('LAST')).x < stepMiddle.find(call => call.text.startsWith('LAST')).x;
            const stepFits = stepA[0].maxWidth <= w && stepNext.find(call => call.text.startsWith('LAST')).maxWidth <= w;
            const unsynced = { synced: false, lines: data.lines.map(({ text }) => ({ text })) };
            calls.length = 0;
            drawLyrics(ctx, item, lyricsFrame(item, { data: unsynced, time: 15, duration: 20 }, false), w, h, 1, '#ffffff');
            const unsyncedLast = calls.some(call => call.text.startsWith('LAST') && call.x >= 0 && call.x <= w);
            item.params.lyricsMotion = 'smooth-horizontal'; item.params.lyricsWordFill = true;
            data.lines[0].words = [{ time: 0, text: data.lines[0].text }, { time: 4, text: '' }];
            const solid = createLayer(w, h), gradient = createLayer(w, h), mask = createLayer(w, h), expected = createLayer(w, h);
            const frame = lyricsFrame(item, { data, time: 1, duration: 8 }, false);
            const gradientCtx = gradient.getContext('2d'), palette = normalizePalette({ mode: 'gradient', angle: 45 });
            drawLyrics(solid.getContext('2d'), item, frame, w, h, 1, '#ffffff');
            drawLyrics(gradientCtx, item, frame, w, h, 1, paletteGradient(gradientCtx, palette, w, 0, false, h), mask);
            const expectedCtx = expected.getContext('2d'); expectedCtx.fillStyle = paletteGradient(expectedCtx, palette, w, 0, false, h);
            expectedCtx.fillRect(0, 0, w, h);
            const a = solid.getContext('2d').getImageData(0, 0, w, h).data;
            const b = gradientCtx.getImageData(0, 0, w, h).data;
            const c = expectedCtx.getImageData(0, 0, w, h).data;
            let samples = 0, mismatches = 0;
            for (let i = 0; i < a.length; i += 4) if (a[i + 3] > 230) {
                samples++;
                if ([0, 1, 2].some(channel => Math.abs(b[i + channel] - c[i + channel]) > 3) || Math.abs(a[i + 3] - b[i + 3]) > 2) mismatches++;
            }
            const clears = { synced: true, lines: [...data.lines, { time: 8, text: '' }] };
            calls.length = 0;
            drawLyrics(ctx, item, lyricsFrame(item, { data: clears, time: 8, duration: 8 }, false), w, h, 1, '#ffffff');
            return { start, middle, later, finish, natural, cacheReuse, stepFits, unsyncedLast, anchors, verticalAnchors, stepMoves,
                stepHeld: JSON.stringify(stepA) === JSON.stringify(stepB), samples, mismatches,
                clearHasText: calls.some(call => call.text.length > 0) };
        });
        assert.ok(result.natural > 320, JSON.stringify(result));
        assert.equal(result.start[0].x, 160);
        assert.deepEqual(result.anchors, [0, 160, 320]);
        assert.ok(result.verticalAnchors[0] < result.verticalAnchors[1] && result.verticalAnchors[1] < result.verticalAnchors[2]);
        assert.ok(result.middle[0].x < result.start[0].x && result.later[0].x < result.middle[0].x);
        assert.ok(result.finish.every(call => call.x + call.maxWidth <= 0));
        assert.equal(result.cacheReuse, true);
        assert.equal(result.stepFits, true);
        assert.equal(result.unsyncedLast, true);
        assert.equal(result.stepHeld, true);
        assert.equal(result.stepMoves, true);
        assert.ok(result.samples > 20);
        assert.equal(result.mismatches, 0);
        assert.equal(result.clearHasText, false);
    } finally { await browser.close(); }
});

test('Lyrics gradients use the full item box across rows, alignment, and word highlighting', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        await page.addScriptTag({ content: `{${moduleScript('../../js/visualizer/visualizer-lyrics.js')}; window.lyricsFrame = lyricsFrame; window.lyricsOpacity = lyricsOpacity; window.drawLyrics = drawLyrics;}` });
        const results = await page.evaluate(() => {
            const results = [], w = 420, h = 280;
            const canvas = () => { const value = document.createElement('canvas'); value.width = w; value.height = h; return value; };
            const rows = [{ text: 'Short' }, { text: 'A very long lyric line that must be compressed horizontally to fit the item box' },
                { text: 'Medium length' }];
            for (const spacing of [.5, 1, 2]) for (const align of ['left', 'center', 'right']) for (const view of ['list', 'line', 'word']) {
                for (const [direction, angle] of [['linear', 0], ['linear', 90], ['linear', 45], ['radial', 0]]) {
                    const item = createItem('lyrics', 'lyrics');
                    item.params.lyricsLineSpacing = spacing;
                    Object.assign(item.style, { fontSize: 48, align, letterSpacing: 2, textCase: 'upper' });
                    Object.assign(item.palette, { mode: 'gradient', direction, angle,
                        stops: [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }] });
                    const frame = { rows, list: view !== 'line', next: true, synced: view !== 'list',
                        current: 1, p: 1.2, fill: view === 'word' ? 32.5 : null };
                    const actual = canvas(), mask = canvas(), expected = canvas();
                    new VisualizerRenderer(actual).drawItem({ canvas: actual }, item, null, null, 0, false, frame);
                    drawLyrics(mask.getContext('2d'), item, frame, w, h, w / REFERENCE_WIDTH, '#ffffff');
                    const reference = expected.getContext('2d');
                    reference.drawImage(mask, 0, 0);
                    reference.globalCompositeOperation = 'source-in';
                    reference.fillStyle = paletteGradient(reference, item.palette, w, 0, false, h);
                    reference.fillRect(0, 0, w, h);
                    const drawn = actual.getContext('2d').getImageData(0, 0, w, h).data;
                    const wanted = reference.getImageData(0, 0, w, h).data;
                    let checked = 0, mismatches = 0;
                    for (let index = 0; index < drawn.length; index += 4) {
                        // Read colors inside opaque glyphs, away from antialiasing and word-clip edges.
                        if (wanted[index + 3] < 240) continue;
                        checked++;
                        if ([0, 1, 2].some(channel => Math.abs(drawn[index + channel] - wanted[index + channel]) > 5)) mismatches++;
                    }
                    results.push({ spacing, align, view, direction, angle, checked, mismatches });
                }
            }
            return results;
        });
        for (const result of results) {
            const detail = `${result.align} ${result.view} ${result.direction} ${result.angle}° ${JSON.stringify(result)}`;
            assert.ok(result.checked > 50, detail);
            assert.equal(result.mismatches, 0, detail);
        }
    } finally { await browser.close(); }
});

test('Gradient Lyrics preserve decoration colors and reuse their glyph mask when resized', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        await page.addScriptTag({ content: `{${moduleScript('../../js/visualizer/visualizer-lyrics.js')}; window.lyricsFrame = lyricsFrame; window.lyricsOpacity = lyricsOpacity; window.drawLyrics = drawLyrics;}` });
        const result = await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = 420; canvas.height = 280;
            const state = { canvas }, renderer = new VisualizerRenderer(canvas), item = createItem('lyrics');
            Object.assign(item.style, { fontSize: 96, outlineColor: '#ff00ff', shadowColor: '#00ff00',
                shadowOpacity: .8, shadowBlur: 6, shadowX: 5, shadowY: 5 });
            Object.assign(item.palette, { mode: 'gradient', angle: 90,
                stops: [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }] });
            const frame = { rows: [{ text: 'First' }, { text: 'Current lyric' }, { text: 'Next' }], list: true,
                next: true, synced: false, current: 1, p: 1, fill: null };
            const decorations = [];
            for (const outlineWidth of [0, 2]) {
                item.style.outlineWidth = outlineWidth;
                renderer.drawItem(state, item, null, null, 0, false, frame);
                const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let greenShadow = 0, magentaOutline = 0;
                for (let index = 0; index < pixels.length; index += 4) {
                    if (pixels[index + 3] < 20) continue;
                    if (pixels[index + 1] > pixels[index] + 40 && pixels[index + 1] > pixels[index + 2] + 40) greenShadow++;
                    if (pixels[index] + pixels[index + 2] > 400 && pixels[index + 1] < 30) magentaOutline++;
                }
                decorations.push({ outlineWidth, greenShadow, magentaOutline });
            }
            const mask = state.glyphMask;
            renderer.drawItem(state, item, null, null, .1, false, frame);
            const reused = state.glyphMask === mask;
            canvas.width = 440; canvas.height = 300;
            renderer.drawItem(state, item, null, null, .2, false, frame);
            return { decorations, reused, resizedInPlace: state.glyphMask === mask,
                maskWidth: mask.width, maskHeight: mask.height };
        });
        assert.ok(result.decorations.every(row => row.greenShadow > 50));
        assert.ok(result.decorations[1].magentaOutline > 50);
        assert.equal(result.reused, true);
        assert.equal(result.resizedInPlace, true);
        assert.deepEqual([result.maskWidth, result.maskHeight], [440, 300]);
    } finally { await browser.close(); }
});

test('Styled text row offsets preserve glyphs, alignment, outlines, and shadows', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-text']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        const results = await page.evaluate(() => {
            const results = [], w = 300, h = 180;
            for (const align of ['left', 'center', 'right']) for (const verticalAlign of ['top', 'middle', 'bottom']) {
                const canvas = () => { const value = document.createElement('canvas'); value.width = w; value.height = h; return value; };
                const shifted = canvas(), translated = canvas(), implicit = canvas(), explicit = canvas();
                const style = { ...createItem('lyrics').style, align, verticalAlign, fontSize: 30, bold: true, italic: true,
                    textCase: 'upper', letterSpacing: 2, outlineWidth: 1.5, shadowOpacity: .5, shadowBlur: 4, shadowY: 3 };
                const text = 'Long mixed-case text that is compressed to fit';
                drawStyledText(shifted.getContext('2d'), text, style, w, 50, 1, '#ffffff', undefined, undefined, 65.25);
                const reference = translated.getContext('2d');
                reference.translate(0, 65.25);
                drawStyledText(reference, text, style, w, 50, 1, '#ffffff');
                drawStyledText(implicit.getContext('2d'), text, style, w, h, 1, '#ffffff');
                drawStyledText(explicit.getContext('2d'), text, style, w, h, 1, '#ffffff', undefined, undefined, 0);
                const pixels = value => value.getContext('2d').getImageData(0, 0, w, h).data;
                const original = pixels(translated), actual = pixels(shifted), defaultPixels = pixels(implicit), zeroPixels = pixels(explicit);
                results.push({ align, verticalAlign, offsetMatches: actual.every((value, index) => value === original[index]),
                    defaultMatches: defaultPixels.every((value, index) => value === zeroPixels[index]) });
            }
            return results;
        });
        for (const result of results) {
            assert.equal(result.offsetMatches, true, `${result.align} ${result.verticalAlign}`);
            assert.equal(result.defaultMatches, true, `${result.align} ${result.verticalAlign}`);
        }
    } finally { await browser.close(); }
});

test('Spectrum gradient directions follow frequency and level after rotating the graph', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: read('../../plugins/plugin-base.js') });
        await page.addScriptTag({ content: frequencyAxisScript });
        await page.addScriptTag({ content: read('../../plugins/analyzer/spectrum_analyzer.js') });
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-guitar', 'visualizer-analyzer-display']) {
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        }
        const results = await page.evaluate(() => {
            const sources = { subscribeItem: () => () => {} }, results = [];
            for (const orientation of ['horizontal', 'vertical']) for (const dm of ['bar', 'line']) {
                const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400;
                const item = createItem('spectrum', 'spectrum');
                Object.assign(item.params, { orientation, dm, ds: 0 });
                item.palette.mode = 'gradient';
                item.palette.stops = [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }];
                const display = createAnalyzerDisplay(item, canvas, sources), plugin = display.plugin;
                plugin.collectSpectrumLevels = width => new Map(Array.from({ length: width }, (_, x) => [x, [-24, -24]]));
                const width = orientation === 'vertical' ? 400 : 800;
                const height = orientation === 'vertical' ? 800 : 400;
                const count = item.params.bc;
                const frequencyX = fraction => dm === 'bar'
                    ? (Math.floor(count * fraction) + .5) * width / count : width * fraction;
                const pixel = (fraction, level) => {
                    const x = frequencyX(fraction), y = height * level;
                    const point = orientation === 'vertical' ? [800 - y, 400 - x] : [x, y];
                    return [...(display.signalCanvas || canvas).getContext('2d').getImageData(Math.floor(point[0]), Math.floor(point[1]), 1, 1).data];
                };
                for (const direction of ['frequency', 'intensity', 'radial']) for (const angle of [0, 90, -90, 180]) {
                    Object.assign(item.palette, { direction, angle });
                    display.draw(item, 0, 800);
                    const level = dm === 'bar' ? .5 : .25;
                    results.push({ orientation, dm, direction, angle,
                        first: pixel(.25, level), second: pixel(.75, level), center: pixel(.5, level),
                        weaker: dm === 'bar' ? pixel(.25, .8) : null });
                }
                display.dispose();
            }
            return results;
        });
        for (const { orientation, dm, direction, angle, first, second, center, weaker } of results) {
            const description = `${orientation} ${dm} ${direction} ${angle}°`;
            assert.ok(first[3] > 0 && second[3] > 0, description);
            if (direction === 'radial') {
                assert.ok(Math.abs(first[0] - second[0]) <= 12, description);
                assert.ok(first[0] - center[0] > 8 && center[2] - first[2] > 8, description);
            } else {
                const basis = orientation === 'horizontal' ? (direction === 'frequency' ? 0 : -90)
                    : (direction === 'frequency' ? -90 : 0);
                const radians = (basis + angle) * Math.PI / 180;
                const frequency = orientation === 'horizontal' ? Math.cos(radians) : -Math.sin(radians);
                if (Math.abs(frequency) > .99) assert.ok((second[0] - first[0]) * frequency > 100, description);
                else assert.ok(Math.abs(first[0] - second[0]) <= 2, description);
                if (weaker) {
                    const level = orientation === 'horizontal' ? -Math.sin(radians) : Math.cos(radians);
                    if (Math.abs(level) > .99) assert.ok((first[0] - weaker[0]) * level > 50, description);
                    else assert.ok(Math.abs(first[0] - weaker[0]) <= 2, description);
                }
            }
        }
    } finally {
        await browser.close();
    }
});

test('Scroll moves linear and radial gradient peaks continuously in either direction', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: moduleScript('../../js/visualizer/visualizer-effects.js') });
        const frames = await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 120;
            const ctx = canvas.getContext('2d'), frames = [];
            const palette = { stops: [{ pos: 0, color: '#000000' }, { pos: .5, color: '#ffffff' },
                { pos: 1, color: '#000000' }], motion: { mode: 'scroll', speed: 1 } };
            for (const reverse of [false, true]) for (const direction of ['frequency', 'radial'])
                for (const start of [.1, 9.9]) for (let frame = 0; frame < 12; frame++) {
                    const time = start + frame / 60; palette.direction = direction;
                    palette.motion.reverse = reverse;
                    ctx.fillStyle = paletteGradient(ctx, palette, canvas.width, time, false, canvas.height);
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    const row = ctx.getImageData(0, canvas.height / 2, canvas.width, 1).data;
                    let peak = -1, positions = [];
                    for (let x = direction === 'radial' ? canvas.width / 2 : 0; x < canvas.width; x++) {
                        if (row[x * 4] > peak) { peak = row[x * 4]; positions = [x + .5]; }
                        else if (row[x * 4] === peak) positions.push(x + .5);
                    }
                    const actual = positions.reduce((sum, x) => sum + x, 0) / positions.length;
                    const radius = Math.hypot(canvas.width, canvas.height) / 2;
                    const position = ((.5 - time * .1 * (reverse ? -1 : 1)) % 1 + 1) % 1;
                    const expected = direction === 'radial' ? canvas.width / 2 + radius * position : canvas.width * position;
                    frames.push({ reverse, direction, frame, actual, expected, peak });
                }
            return frames;
        });
        for (const frame of frames) {
            assert.ok(Math.abs(frame.actual - frame.expected) <= 1.5, JSON.stringify(frame));
            assert.ok(frame.peak >= 254, JSON.stringify(frame));
        }
    } finally {
        await browser.close();
    }
});

test('Text and Shape use their full rectangular bounds for gradient angles and radial centers', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-text', 'visualizer-renderer'])
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        const results = await page.evaluate(() => {
            const stage = document.createElement('canvas'); stage.width = 1280;
            const renderer = new VisualizerRenderer(stage), results = [];
            for (const type of ['shape', 'text']) {
                const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 200;
                const context = canvas.getContext('2d'), item = createItem(type, type), coordinates = [];
                const linear = context.createLinearGradient.bind(context), radial = context.createRadialGradient.bind(context);
                context.createLinearGradient = (...args) => { coordinates.push(args); return linear(...args); };
                context.createRadialGradient = (...args) => { coordinates.push(args); return radial(...args); };
                item.palette.mode = 'gradient';
                item.palette.stops = [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }];
                if (type === 'shape') item.style.borderWidth = 0;
                for (const direction of ['linear', 'radial']) for (const angle of [0, 90]) {
                    Object.assign(item.palette, { direction, angle });
                    renderer.drawItem({ canvas }, item, {}, null, 0, true);
                    const pixel = (x, y) => [...context.getImageData(x, y, 1, 1).data];
                    results.push({ type, direction, angle, coordinates: coordinates.at(-1),
                        top: pixel(400, 10), bottom: pixel(400, 190), center: pixel(400, 100), edge: pixel(10, 100) });
                }
            }
            return results;
        });
        for (const result of results) {
            const { type, direction, angle, coordinates, top, bottom, center, edge } = result;
            if (direction === 'radial') {
                assert.deepEqual(coordinates, [400, 100, 0, 400, 100, Math.hypot(800, 200) / 2]);
                if (type === 'shape') assert.ok(center[2] > 250 && edge[0] > 230, JSON.stringify(result));
            } else if (angle === 90) {
                assert.ok(Math.abs(coordinates[1]) < 1e-9 && Math.abs(coordinates[3] - 200) < 1e-9, JSON.stringify(result));
                if (type === 'shape') assert.ok(bottom[0] - top[0] > 220, JSON.stringify(result));
            } else assert.deepEqual(coordinates, [0, 0, 800, 0]);
        }
    } finally {
        await browser.close();
    }
});

test('Radial Spectrogram gradients preserve history opacity and annotations while their colors move', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: read('../../plugins/plugin-base.js') });
        await page.addScriptTag({ content: frequencyAxisScript });
        await page.addScriptTag({ content: read('../../plugins/analyzer/spectrogram.js') });
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-guitar', 'visualizer-analyzer-display'])
            await page.addScriptTag({ content: moduleScript(`../../js/visualizer/${file}.js`) });
        const result = await page.evaluate(() => {
            const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 400;
            const item = createItem('spectrogram', 'radial-history');
            item.params.showAxes = item.params.showAxisNumbers = true;
            item.effects = [normalizeEffect({ type: 'opacity' })];
            item.palette.stops = [{ pos: 0, color: '#0000ff' }, { pos: 1, color: '#ff0000' }];
            const display = createAnalyzerDisplay(item, canvas, { subscribeItem: () => () => {} }), plugin = display.plugin;
            plugin.dspSpectrogramActive = true;
            plugin.spectrogramIntensityBuffer.fill(128);
            plugin.spectrogramColumnPeriod = .01; plugin.spectrogramColumnCount = 1024;
            for (let column = 0; column < 1024; column++) plugin.spectrogramColumnTimes[column] = 1 - (1023 - column) * .01;
            plugin.prevTime = 1; plugin.getSpectrogramDisplayTime = () => 1;
            plugin.repaintSpectrogramHistory();
            const history = plugin.spectrogramIntensityBuffer;
            const pixels = target => target.getContext('2d').getImageData(0, 0, 800, 400).data;
            display.draw(item, 0, 800);
            const before = pixels(display.signalCanvas), labels = pixels(canvas);
            item.palette.mode = 'gradient'; item.palette.direction = 'radial'; item.effects = [];
            display.draw(item, 0, 800);
            const radial = pixels(display.signalCanvas);
            const center = [...display.signalCanvas.getContext('2d').getImageData(400, 200, 1, 1).data];
            const outer = [...display.signalCanvas.getContext('2d').getImageData(10, 10, 1, 1).data];
            const sameAnnotations = pixels(canvas).every((value, index) => value === labels[index]);
            item.palette.motion.mode = 'hue'; item.palette.motion.speed = 1;
            display.draw(item, 2, 800);
            const moved = pixels(display.signalCanvas);
            item.palette.motion.mode = 'none'; item.palette.angle = 90; item.palette.direction = 'frequency';
            display.draw(item, 2, 800);
            const rotatedFirst = [...display.signalCanvas.getContext('2d').getImageData(100, 200, 1, 1).data];
            const rotatedLast = [...display.signalCanvas.getContext('2d').getImageData(700, 200, 1, 1).data];
            const rotatedOpacity = pixels(display.signalCanvas).every((value, index) => index % 4 !== 3 || value === before[index]);
            const rotatedAnnotations = pixels(canvas).every((value, index) => value === labels[index]);
            item.palette.angle = 0; display.draw(item, 2, 800);
            const nativeLayerRestored = display.signalCanvas === null;
            const historyRetained = plugin.spectrogramIntensityBuffer === history && history.every(value => value === 128);
            display.dispose();
            return { center, outer, sameAnnotations, nativeLayerRestored, historyRetained, rotatedFirst, rotatedLast, rotatedOpacity, rotatedAnnotations,
                hasSignal: radial.some((value, index) => index % 4 === 3 && value > 0),
                opacityPreserved: radial.every((value, index) => index % 4 !== 3 || value === before[index]),
                motionPreservesOpacity: moved.every((value, index) => index % 4 !== 3 || value === radial[index]),
                motionChangesColor: moved.some((value, index) => index % 4 !== 3 && value !== radial[index]) };
        });
        assert.equal(result.hasSignal, true);
        assert.equal(result.opacityPreserved, true, JSON.stringify(result));
        assert.equal(result.motionPreservesOpacity, true);
        assert.equal(result.motionChangesColor, true);
        assert.equal(result.sameAnnotations, true);
        assert.equal(result.nativeLayerRestored, true);
        assert.equal(result.historyRetained, true);
        assert.equal(result.rotatedOpacity, true);
        assert.equal(result.rotatedAnnotations, true);
        assert.ok(result.rotatedLast[0] - result.rotatedFirst[0] > 180, JSON.stringify(result));
        assert.ok(result.center[2] > 240 && result.outer[0] > 180);
        assert.equal(result.center[3], 128);
        assert.equal(result.outer[3], 128);
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
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-text', 'visualizer-ballistics', 'visualizer-guitar', 'visualizer-analyzer-display', 'visualizer-renderer', 'visualizer-editor']) {
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
            if (type.endsWith('keyless')) {
                assert.ok(baseline.filter(label => label.method === 'fillText').every(label => label.color === '#666666'),
                    `${type} labels use the default dark graph label color`);
                assert.ok(baseline.some(label => label.method === 'strokeText'), `${type} labels over the roll are outlined`);
            }
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
            [[false, false], [true, false], [false, true], [true, true]].map(([flipX, flipY]) => ({ changed: true, flipX, flipY })),
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
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-guitar', 'visualizer-analyzer-display'])
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
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-guitar', 'visualizer-analyzer-display', 'visualizer-renderer'])
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
                    if (text.endsWith(' dB')) localValues.push({ text, method, color: itemContext.fillStyle });
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
        assert.deepEqual(results.wide.localValues.map(label => [label.method, label.text]),
            [['strokeText', 'L -6.0 dB'], ['fillText', 'L -6.0 dB']], 'The value is outlined over its bar');
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
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-guitar', 'visualizer-analyzer-display'])
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

test('Note Spectrogram bars fade into both key backgrounds without adding the background twice', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.addScriptTag({ content: 'class PluginBase {}' });
        await page.addScriptTag({ content: read('../../plugins/analyzer/note_spectrogram.js') });
        const samples = await page.evaluate(() => {
            const results = [];
            for (const background of [[0, 0, 0], [7, 11, 20], [255, 255, 255]]) {
                window.ThemePalette = { get: name => ({
                    'graph-bg-deep': `rgb(${background.join(',')})`,
                    'graph-base-soft': 'rgb(241,241,241)',
                    'graph-trace': 'rgb(128,64,32)'
                })[name] };
                const plugin = Object.create(NoteSpectrogramPlugin.prototype);
                plugin.initializeDisplayState();
                Object.assign(plugin, { mn: 21, mx: 22, writeColumn: 4,
                    displayOptions: { showAxes: false } });
                plugin.volumeFrameEnds[1] = plugin.volumeFrameEnds[2] = 0;
                plugin.levelHistory.fill(1);
                const palette = plugin._displayPalette();
                const canvas = document.createElement('canvas');
                canvas.width = 1024; canvas.height = 80;
                const context = canvas.getContext('2d');
                for (const [pr, vl] of [['Semitone', true], ['High', true], ['High', false]]) {
                    Object.assign(plugin, { pr, vl });
                    for (const confidence of [0, 0.000001, 0.49 / 255, 0.51 / 255, .1, .5, 1]) {
                        plugin.history.fill(confidence);
                        plugin._paintVolumeFrame(context, 3, 80, 40, palette, true);
                        results.push({ pr, vl, confidence, composite: palette.volumeCompositeOperation,
                            backgrounds: [palette.whiteBand, palette.blackBand],
                            pixels: [60, 20].map(y => [...context.getImageData(2, y, 1, 1).data]) });
                    }
                }
            }
            return results;
        });
        for (const sample of samples) {
            sample.pixels.forEach((pixel, key) => {
                const background = sample.backgrounds[key];
                if (sample.confidence < 0.5 / 255) {
                    assert.deepEqual(pixel, [...background, 255], JSON.stringify(sample));
                } else {
                    const alpha = Math.round(sample.confidence * 255) / 255;
                    const expected = background.map((channel, index) => sample.composite === 'lighter'
                        ? Math.min(255, channel + [128, 64, 32][index] * alpha)
                        : channel + (Math.min(channel, [128, 64, 32][index]) - channel) * alpha);
                    assert.ok(expected.every((channel, index) => Math.abs(pixel[index] - channel) <= 1),
                        JSON.stringify(sample));
                    assert.equal(pixel[3], 255);
                }
            });
        }
    } finally { await browser.close(); }
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
        for (const file of ['visualizer-effects', 'visualizer-model', 'visualizer-ballistics', 'visualizer-guitar', 'visualizer-analyzer-display'])
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
