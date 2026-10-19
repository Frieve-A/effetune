import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const moduleScript = file => readFileSync(new URL(`../../js/visualizer/${file}.js`, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

const fontCss = readFileSync(new URL('../../css/effetune.css', import.meta.url), 'utf8').match(/@font-face\s*\{[^}]*\}/g).join('\n');

test('Counter redraws changing tape digits and maps reset hits through item effects', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-counter', 'visualizer-renderer', 'visualizer-view']) {
            await page.addScriptTag({ content: moduleScript(file) });
        }
        const result = await page.evaluate(() => {
            const stage = createLayer(640, 360), renderer = new VisualizerRenderer(stage);
            const item = createItem('counter', 'counter');
            item.rect = { x: .15, y: .25, w: .7, h: .5 };
            item.params = normalizeParams('counter', { counterHours: false, counterMinutes: false,
                counterFraction: false, counterMotion: 'tape', counterBoxes: true });
            item.style.fontSize = 150;
            item.effects = [normalizeEffect({ type: 'transform', angle: 20, offsetX: 15, scaleX: 110, scaleY: 90 })];
            item.flipX = true;
            const layout = { ...createDefaultLayout(), items: [item] };
            const sources = { getModulators: () => ({}), getFrame: () => null };
            const draw = time => {
                renderer.draw(layout, sources, null, time, { counters: new Map([['counter', { time, trackIndex: 0, external: true }]]) });
                return renderer.layers.get('counter').canvas.toDataURL();
            };
            const before = draw(9.2), middle = draw(9.7), after = draw(10.2);
            const state = renderer.layers.get('counter');
            const pixels = state.canvas.getContext('2d').getImageData(0, 0, state.canvas.width, state.canvas.height).data;
            let pixelCount = 0, x = 0, y = 0;
            for (let row = 0; row < state.canvas.height; row++) for (let col = 0; col < state.canvas.width; col++) {
                if (pixels[(row * state.canvas.width + col) * 4 + 3] < 100) continue;
                x += col + .5; y += row + .5; pixelCount++;
            }
            const point = state.hitTransform.inverse().transformPoint({ x: x / pixelCount, y: y / pixelCount });
            const hit = renderer.counterAt(layout, point.x / stage.width, point.y / stage.height);
            const miss = renderer.counterAt(layout, .01, .01);
            const canvas = { width: stage.width, height: stage.height,
                getBoundingClientRect: () => ({ left: 10, top: 20, width: 640, height: 360 }) };
            let resets = 0;
            const view = Object.assign(Object.create(VisualizerView.prototype), {
                layout, canvas, renderer, editor: { open: false }, uiManager: {},
                counters: () => new Map([['counter', { time: 10.2, trackIndex: 0, external: true }]]),
                resetCounter: () => { resets++; return true; }
            });
            const event = { clientX: point.x + 10, clientY: point.y + 20, target: { closest: () => null } };
            const reset = view.resetCounterAt(event);
            view.editor.open = true;
            const editReset = view.resetCounterAt(event);
            view.editor.open = false;
            view.counters = () => new Map([['counter', { time: 10.2, trackIndex: 3, external: false }]]);
            const internalReset = view.resetCounterAt(event);
            item.rect = { x: 0, y: 0, w: 1, h: 1 };
            item.effects = [];
            item.flipX = false;
            item.params = normalizeParams('counter', {});
            item.palette = { ...item.palette, mode: 'gradient', direction: 'linear', angle: 0,
                stops: [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }] };
            draw(3661.234);
            const gradientCanvas = renderer.layers.get('counter').canvas;
            const rgba = gradientCanvas.getContext('2d').getImageData(0, 0, gradientCanvas.width, gradientCanvas.height).data;
            const halves = [{ red: 0, blue: 0, count: 0 }, { red: 0, blue: 0, count: 0 }];
            for (let row = 0; row < gradientCanvas.height; row++) for (let col = 0; col < gradientCanvas.width; col++) {
                const offset = (row * gradientCanvas.width + col) * 4;
                if (rgba[offset + 3] < 200) continue;
                const half = halves[col < gradientCanvas.width / 2 ? 0 : 1];
                half.red += rgba[offset]; half.blue += rgba[offset + 2]; half.count++;
            }
            const gradient = halves.map(half => ({ red: half.red / half.count, blue: half.blue / half.count }));
            return { changedDuringRoll: before !== middle, changedAfterCarry: middle !== after,
                pixelCount, hit, miss, reset, editReset, internalReset, resets, gradient };
        });
        assert.equal(result.changedDuringRoll, true);
        assert.equal(result.changedAfterCarry, true);
        assert.ok(result.pixelCount > 100);
        assert.equal(result.hit, 'counter');
        assert.equal(result.miss, null);
        assert.equal(result.reset, true);
        assert.equal(result.editReset, false);
        assert.equal(result.internalReset, false);
        assert.equal(result.resets, 1);
        assert.ok(result.gradient[0].red > result.gradient[0].blue, 'The left digits use the red side of the item gradient');
        assert.ok(result.gradient[1].blue > result.gradient[1].red, 'The right digits use the blue side of the item gradient');
    } finally {
        await browser.close();
    }
});

test('Bundled Counter fonts redraw paused main/feed layers after loading and render the gallery', async () => {
    const browser = await chromium.launch({ headless: true });
    let releaseFonts;
    const fontGate = new Promise(resolve => { releaseFonts = resolve; });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
        await page.route('https://counter.test/**', async route => {
            const name = new URL(route.request().url()).pathname.split('/').pop();
            if (name.endsWith('.woff2')) {
                await fontGate;
                await route.fulfill({ contentType: 'font/woff2', body: readFileSync(new URL(`../../css/fonts/${name}`, import.meta.url)) });
            } else await route.fulfill({ contentType: 'text/html', body: `<style>${fontCss}</style><body style="margin:0"></body>` });
        });
        await page.goto('https://counter.test/css/index.html');
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-counter', 'visualizer-renderer']) {
            await page.addScriptTag({ content: moduleScript(file) });
        }
        const before = await page.evaluate(() => {
            const feed = document.createElement('iframe'); document.body.appendChild(feed);
            window.fontChecks = COUNTER_DIGIT_FONTS.map(([family], index) => {
                const item = createItem('counter', `font-${index}`);
                item.style.fontFamily = family; item.style.fontSize = 150;
                item.rect = { x: 0, y: 0, w: 1, h: 1 };
                Object.assign(item.params, { counterHours: false, counterMinutes: false, counterFraction: false });
                const layout = { ...createDefaultLayout(), items: [item] };
                const canvases = [document.createElement('canvas'), feed.contentDocument.createElement('canvas')];
                const renderers = canvases.map(canvas => { canvas.width = 640; canvas.height = 180; return new VisualizerRenderer(canvas); });
                const draw = () => renderers.map(renderer => {
                    renderer.draw(layout, { getModulators: () => ({}), getFrame: () => null }, null, 0,
                        { counters: new Map([[item.id, { time: 88, trackIndex: 0, playing: false, stamp: 0 }]]) });
                    return renderer.layers.get(item.id).canvas.toDataURL();
                });
                return { family, item, renderers, draw, before: draw() };
            });
            return fontChecks.map(({ family }) => document.fonts.check(`100px ${family}`, '0123456789'));
        });
        assert.ok(before.every(loaded => !loaded));
        releaseFonts();
        await page.waitForFunction(() => fontChecks.every(({ item, renderers }) =>
            renderers.every(renderer => renderer.layers.get(item.id).signature === '')));
        const metrics = await page.evaluate(() => {
            return fontChecks.map(({ family, item, renderers, draw, before }) => {
                const after = draw();
                const ctx = document.createElement('canvas').getContext('2d');
                ctx.font = `100px ${family}`;
                const widths = [...'0123456789'].map(digit => ctx.measureText(digit).width);
                const glyph = ctx.measureText('8');
                const separator = ctx.measureText(': /').width;
                ctx.font = '100px monospace';
                return { changed: after.map((value, index) => value !== before[index]), widths,
                    height: glyph.actualBoundingBoxAscent + glyph.actualBoundingBoxDescent,
                    fallbackSeparator: separator === ctx.measureText(': /').width,
                    mainDocumentLayers: renderers.every(renderer => renderer.layers.get(item.id).canvas.ownerDocument === document) };
            });
        });
        for (const result of metrics) {
            assert.deepEqual(result.changed, [true, true]);
            assert.ok(result.widths.every(width => Math.abs(width - 60) < .01), 'The original font uses its 600-unit advance');
            assert.ok(result.height >= 60 && result.height <= 80);
            assert.equal(result.fallbackSeparator, true);
            assert.equal(result.mainDocumentLayers, true);
        }
        const gallery = JSON.parse(readFileSync(new URL('../../presets/visualizer/16x9.json', import.meta.url), 'utf8'))['Counter Gallery'];
        const result = await page.evaluate(layout => {
            document.body.replaceChildren();
            const canvas = createLayer(1280, 720); document.body.appendChild(canvas);
            const renderer = new VisualizerRenderer(canvas);
            const sources = { getModulators: () => ({}), getFrame: () => null };
            const counters = new Map(layout.items.filter(item => item.type === 'counter').map(item => [item.id,
                { time: 59.95, trackIndex: 2, external: true, playing: true, speed: 1, source: 1, stamp: 0 }]));
            renderer.draw(layout, sources, null, 0, { counters });
            for (const descriptor of counters.values()) { descriptor.time = 60.05; descriptor.stamp = .1; }
            renderer.draw(layout, sources, null, .1, { counters });
            for (const descriptor of counters.values()) { descriptor.time = 60.1; descriptor.stamp = .15; }
            renderer.draw(layout, sources, null, .15, { counters });
            return layout.items.filter(item => item.type === 'counter').map(item => {
                const state = renderer.layers.get(item.id);
                const box = state.counterBounds;
                const pixels = state.canvas.getContext('2d').getImageData(0, 0, state.canvas.width, state.canvas.height).data;
                return { id: item.id, fits: box.left >= -.01 && box.top >= -.01 && box.right <= state.canvas.width + .01 &&
                    box.bottom <= state.canvas.height + .01, painted: pixels.some((value, index) => index % 4 === 3 && value > 0) };
            });
        }, gallery);
        assert.equal(result.length, 8);
        for (const counter of result) { assert.equal(counter.fits, true, counter.id); assert.equal(counter.painted, true, counter.id); }
    } finally {
        releaseFonts();
        await browser.close();
    }
});
