import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const source = ['visualizer-model', 'visualizer-effects', 'visualizer-renderer'].map(file =>
    readFileSync(new URL(`../../js/visualizer/${file}.js`, import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');

async function withPage(run) {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 64, height: 32 } });
        await page.setContent('<!doctype html><body style="margin:0"></body>');
        await page.addScriptTag({ content: source });
        await run(page);
    } finally {
        await browser.close();
    }
}

test('Color Adjust controls operate in sRGB with neutral defaults and ordered levels', () => withPage(async page => {
    const result = await page.evaluate(() => {
        const input = createLayer(4, 4), ctx = input.getContext('2d');
        const render = (settings, rgb = [64, 128, 192]) => {
            ctx.fillStyle = `rgb(${rgb})`; ctx.fillRect(0, 0, 4, 4);
            const effect = normalizeEffect({ type: 'color-adjust', ...settings });
            const output = new VisualizerEffects().apply('color', input, [effect], 0, {}).canvas;
            return [...output.getContext('2d').getImageData(1, 1, 1, 1).data];
        };
        return {
            neutral: render({}), brightness: render({ brightness: .2 }), contrast: render({ contrast: 2 }),
            saturation: render({ saturation: 0 }), hue: render({ hue: 180 }), gamma: render({ gamma: 2 }),
            input: render({ inputBlack: .25, inputWhite: .75 }), output: render({ outputBlack: .2, outputWhite: .8 }),
            reverseOutput: render({ outputBlack: 1, outputWhite: 0 }), invert: render({ invert: true }),
            temperature: render({ temperature: 1 }), tint: render({ tint: 1 }),
            ordered: render({ inputBlack: .25, inputWhite: .75, gamma: 2, outputBlack: .2, outputWhite: .8, invert: true }, [80, 128, 192])
        };
    });
    const near = (key, expected) => result[key].forEach((value, index) =>
        assert.ok(Math.abs(value - expected[index]) <= 2, `${key}[${index}]: ${value} versus ${expected[index]}`));
    near('neutral', [64, 128, 192, 255]);
    near('brightness', [115, 179, 243, 255]);
    near('contrast', [1, 129, 255, 255]);
    near('saturation', [119, 119, 119, 255]);
    near('hue', [174, 110, 46, 255]);
    near('gamma', [128, 181, 221, 255]);
    near('input', [1, 129, 255, 255]);
    near('output', [89, 128, 166, 255]);
    near('reverseOutput', [191, 127, 63, 255]);
    near('invert', [191, 127, 63, 255]);
    near('temperature', [128, 128, 128, 255]);
    near('tint', [128, 64, 255, 255]);
    near('ordered', [149, 95, 51, 255]);
}));

test('Color-only chains preserve full resolution, identity, alpha, and Amount mixing at every quality', () => withPage(async page => {
    const result = await page.evaluate(() => {
        const input = createLayer(257, 3), ctx = input.getContext('2d');
        const data = ctx.createImageData(input.width, input.height);
        for (let x = 0; x < input.width; x++) for (let y = 0; y < input.height; y++)
            data.data.set([x % 2 ? 30 : 210, 100, 160, x % 256], (y * input.width + x) * 4);
        ctx.putImageData(data, 0, 0);
        const original = ctx.getImageData(0, 0, input.width, input.height).data;
        const failures = [], dimensions = [];
        for (const quality of [0, 1, 2]) for (const settings of [
            {}, { amount: 0, invert: true }, { amount: .5, invert: true }, { gamma: 2, outputBlack: .1 },
            { type: 'color-map', amount: .37 }, { type: 'color-map', amount: 0 }
        ]) {
            const effect = normalizeEffect({ type: 'color-adjust', ...settings });
            const output = new VisualizerEffects().apply('color', input, [effect], 0, {}, quality).canvas;
            dimensions.push([output.width, output.height]);
            const pixels = output.getContext('2d').getImageData(0, 0, output.width, output.height).data;
            const identity = Object.keys(settings).length === 0 || settings.amount === 0;
            for (let index = 0; index < pixels.length; index++) {
                if ((identity || index % 4 === 3) && pixels[index] !== original[index]) {
                    failures.push({ quality, settings, index, actual: pixels[index], expected: original[index] }); break;
                }
            }
        }
        const solid = createLayer(8, 8), solidCtx = solid.getContext('2d');
        solidCtx.fillStyle = 'rgba(40,100,180,.5)'; solidCtx.fillRect(0, 0, 8, 8);
        const processor = new VisualizerEffects();
        const sample = (effects, modulators = {}) => [...processor.apply('mixed', solid,
            effects.map(effect => normalizeEffect(effect)), 0, modulators).canvas.getContext('2d').getImageData(2, 2, 1, 1).data];
        return { failures, dimensions, half: sample([{ type: 'color-adjust', invert: true, amount: .5 }]),
            modulated: sample([{ type: 'color-adjust', invert: true, mod: { source: 'level', depth: 1 } }], { level: .5 }),
            ordered: sample([{ type: 'color-adjust', brightness: .1 }, { type: 'color-adjust', invert: true }]) };
    });
    assert.deepEqual(result.failures, []);
    assert.ok(result.dimensions.every(([width, height]) => width === 257 && height === 3));
    assert.deepEqual(result.modulated, result.half);
    result.half.forEach(value => assert.ok(Math.abs(value - 128) <= 2));
    result.ordered.forEach((value, index) => assert.ok(Math.abs(value - [190, 130, 50, 128][index]) <= 3));
}));

test('Color Map uses luminance, palette endpoints, discrete levels, threshold, and palette motion', () => withPage(async page => {
    const result = await page.evaluate(() => {
        const input = createLayer(1, 1), ctx = input.getContext('2d'), processor = new VisualizerEffects();
        const palette = { stops: [{ pos: 0, color: '#ff0000' }, { pos: .5, color: '#00ff00' }, { pos: 1, color: '#0000ff' }] };
        const sample = (settings, rgb, time = 0) => {
            ctx.fillStyle = `rgb(${rgb})`; ctx.fillRect(0, 0, 1, 1);
            const effect = normalizeEffect({ type: 'color-map', palette, ...settings });
            return [...processor.apply('map', input, [effect], time, {}).canvas.getContext('2d').getImageData(0, 0, 1, 1).data];
        };
        const gray = values => values.map(value => [value, value, value]);
        return {
            continuous: gray([0, 64, 128, 192, 255]).map(rgb => sample({}, rgb)),
            reverse: sample({ palette: { stops: palette.stops.map(stop => ({ ...stop, pos: 1 - stop.pos })) } }, [0, 0, 0]),
            discrete: gray([0, 100, 180, 255]).map(rgb => sample({ steps: 3 }, rgb)),
            threshold: gray([0, 100, 200, 255]).map(rgb => sample({ steps: 2, threshold: .75 }, rgb)),
            thresholdZero: sample({ steps: 2, threshold: 0 }, [0, 0, 0]),
            thresholdOne: gray([254, 255]).map(rgb => sample({ steps: 2, threshold: 1 }, rgb)),
            luminance: [[255, 0, 0], [0, 255, 0], [0, 0, 255]].map(rgb => sample({ palette: undefined }, rgb)),
            mixed: sample({ amount: .5 }, [0, 0, 0]),
            scroll: sample({ palette: { ...palette, motion: { mode: 'scroll', speed: 1 } } }, [0, 0, 0], 5),
            hue: sample({ palette: { stops: [{ pos: 0, color: '#ff0000' }], motion: { mode: 'hue', speed: 1 } } }, [0, 0, 0], 2),
            expectedHue: paletteColor(normalizePalette({ stops: [{ pos: 0, color: '#ff0000' }], motion: { mode: 'hue', speed: 1 } }), 0, 2)
        };
    });
    const near = (actual, expected) => actual.forEach((value, index) =>
        assert.ok(Math.abs(value - expected[index]) <= 2, `${actual} versus ${expected}`));
    result.continuous.forEach((pixel, index) => near(pixel,
        [[255, 0, 0, 255], [127, 128, 0, 255], [0, 254, 1, 255], [0, 126, 129, 255], [0, 0, 255, 255]][index]));
    near(result.reverse, [0, 0, 255, 255]);
    result.discrete.forEach((pixel, index) => near(pixel, [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [0, 0, 255, 255]][index]));
    result.threshold.forEach((pixel, index) => near(pixel, index < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    near(result.thresholdZero, [0, 0, 255, 255]);
    near(result.thresholdOne[0], [255, 0, 0, 255]); near(result.thresholdOne[1], [0, 0, 255, 255]);
    result.luminance.forEach((pixel, index) => near(pixel, Array(3).fill([54, 182, 18][index]).concat(255)));
    near(result.mixed, [128, 0, 0, 255]); near(result.scroll, [0, 255, 0, 255]);
    near(result.hue, result.expectedHue.match(/\d+/g).map(Number).concat(255));
}));

test('Discrete Color Map Scroll keeps distinct levels while the two-level threshold selects bands', () => withPage(async page => {
    const results = await page.evaluate(() => {
        const input = createLayer(1, 1), ctx = input.getContext('2d'), processor = new VisualizerEffects();
        const palette = { stops: [{ pos: 0, color: '#ff0000' }, { pos: 1, color: '#0000ff' }],
            motion: { mode: 'scroll', speed: 1 } };
        const sample = (steps, threshold, time, values) => values.map(value => {
            ctx.fillStyle = `rgb(${value},${value},${value})`; ctx.fillRect(0, 0, 1, 1);
            const effect = normalizeEffect({ type: 'color-map', palette, steps, threshold });
            return [...processor.apply('scroll', input, [effect], time, {}).canvas.getContext('2d').getImageData(0, 0, 1, 1).data];
        });
        return [sample(2, .75, 0, [0, 128, 192, 255]), sample(2, .75, 2, [0, 128, 192, 255]),
            sample(2, .75, 5, [0, 128, 192, 255]), sample(2, .25, 2, [0, 128, 255]),
            sample(3, .5, 0, [0, 128, 255]), sample(3, .5, 5, [0, 128, 255])];
    });
    const expected = [
        [[255, 0, 0], [255, 0, 0], [128, 0, 128], [128, 0, 128]],
        [[204, 0, 51], [204, 0, 51], [77, 0, 179], [77, 0, 179]],
        [[128, 0, 128], [128, 0, 128], [255, 0, 0], [255, 0, 0]],
        [[204, 0, 51], [77, 0, 179], [77, 0, 179]],
        [[255, 0, 0], [170, 0, 85], [85, 0, 170]],
        [[128, 0, 128], [43, 0, 213], [213, 0, 43]]
    ];
    results.forEach((pixels, scenario) => pixels.forEach((pixel, band) => pixel.forEach((value, channel) => {
        const target = channel === 3 ? 255 : expected[scenario][band][channel];
        assert.ok(Math.abs(value - target) <= 2, `scenario ${scenario}, band ${band}, channel ${channel}: ${value} versus ${target}`);
    })));
}));

test('Color effects work on items/backgrounds and retain bounded filter caches and spatial quality', () => withPage(async page => {
    const result = await page.evaluate(() => {
        const canvas = createLayer(64, 32), renderer = new VisualizerRenderer(canvas);
        const layout = createDefaultLayout(), item = createItem('shape', 'color-item');
        item.rect = { x: 0, y: 0, w: .5, h: 1 };
        item.palette.color = '#ff0000'; item.style.fillOpacity = 1; item.style.borderWidth = 0;
        item.effects = [normalizeEffect({ type: 'color-adjust', invert: true })];
        layout.items = [item]; layout.background.color = '#000000';
        layout.background.effects = [normalizeEffect({ type: 'color-map', palette: { stops: [{ pos: 0, color: '#00ff00' }] } }, 'background')];
        renderer.draw(layout, { getModulators: () => ({}), getFrame: () => null }, null, 0, { quality: 'high' });
        const ctx = canvas.getContext('2d');
        const pixels = [[8, 16], [56, 16]].map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
        const processor = new VisualizerEffects(), input = createLayer(100, 100);
        input.getContext('2d').fillRect(0, 0, 100, 100);
        const adjust = normalizeEffect({ type: 'color-adjust', invert: true });
        const output = processor.apply('cache', input, [adjust], 0, {});
        const cached = processor.apply('cache', input, [adjust], 1, {}, 0, false) === output;
        for (let index = 0; index < 30; index++) {
            adjust.amount = index / 30;
            processor.apply('cache', input, [adjust], index, {});
        }
        const cacheLength = processor.states.get('cache').colorFilters.length;
        const mixed = processor.apply('mixed', input, [adjust, normalizeEffect({ type: 'blur' })], 0, {}, 1).canvas.width;
        const opacity = processor.apply('opacity', input, [normalizeEffect({ type: 'opacity' })], 0, {}).canvas.width;
        processor.prune(new Set()); renderer.dispose();
        return { pixels, cached, cacheLength, mixed, opacity, remaining: processor.states.size };
    });
    assert.deepEqual(result.pixels, [[0, 255, 255, 255], [0, 255, 0, 255]]);
    assert.equal(result.cached, true); assert.equal(result.cacheLength, 1);
    assert.equal(result.mixed, 35); assert.equal(result.opacity, 65); assert.equal(result.remaining, 0);
}));

test('Color filters render cross-origin artwork without pixel reads or losing origin protection', () => withPage(async page => {
    await page.route('https://color-test.invalid/', route => route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><body style="margin:0"></body>' }));
    await page.route('https://artwork-test.invalid/art.svg', route => route.fulfill({ contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>' }));
    await page.goto('https://color-test.invalid/');
    await page.addScriptTag({ content: source });
    const tainted = await page.evaluate(async () => {
        const image = new Image(); image.src = 'https://artwork-test.invalid/art.svg'; await image.decode();
        const input = createLayer(8, 8); input.getContext('2d').drawImage(image, 0, 0);
        const processor = new VisualizerEffects();
        const effects = [normalizeEffect({ type: 'color-adjust', invert: true }),
            normalizeEffect({ type: 'color-map', amount: .5, palette: { stops: [{ pos: 0, color: '#ffffff' }] } })];
        const output = processor.apply('cross-origin', input, effects, 0, {}).canvas;
        output.style.display = 'block';
        document.body.append(output);
        try { output.getContext('2d').getImageData(0, 0, 1, 1); return false; }
        catch (error) { return error.name === 'SecurityError'; }
    });
    assert.equal(tainted, true);
    // A screenshot can verify the visible result without reading the tainted bitmap.
    const screenshot = await page.screenshot();
    const pixel = await page.evaluate(async data => {
        const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        return [...ctx.getImageData(4, 4, 1, 1).data];
    }, screenshot.toString('base64'));
    assert.deepEqual(pixel, [128, 255, 255, 255]);
}));
