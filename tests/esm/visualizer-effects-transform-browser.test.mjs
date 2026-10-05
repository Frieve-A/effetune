import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const source = ['visualizer-model', 'visualizer-effects', 'visualizer-renderer'].map(file =>
    read(`../../js/visualizer/${file}.js`).replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');

const probe = () => {
    const input = createLayer(800, 400), context = input.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(436, 216, 8, 8);
    const width = 520, height = 260, center = { x: 259.5, y: 129.5 };
    const checks = [], errors = [];
    const expect = (condition, message) => { checks.push(message); if (!condition) errors.push(message); };
    const inspect = (settings = {}, { flipX = false, flipY = false, extras = [], time = 0, modulators = {}, quality = 0 } = {}) => {
        const effect = normalizeEffect({ type: 'transform', ...settings });
        const processor = new VisualizerEffects();
        const output = processor.apply('sample', input, [effect, ...extras], time, modulators, quality, true, flipX, flipY);
        const final = createLayer(width, height), ctx = final.getContext('2d');
        ctx.translate(flipX ? width : 0, flipY ? height : 0);
        ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
        ctx.drawImage(output.canvas, 0, 0, width, height);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        let weight = 0, x = 0, y = 0;
        for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
            const alpha = pixels[(row * width + col) * 4 + 3];
            weight += alpha; x += col * alpha; y += row * alpha;
        }
        return { x: x / weight, y: y / weight, weight, output, effect, processor };
    };
    const near = (actual, expected, name) => expect(Math.abs(actual.x - expected.x) < 1.5 &&
        Math.abs(actual.y - expected.y) < 1.5, `${name}: (${actual.x.toFixed(2)}, ${actual.y.toFixed(2)})`);
    for (const quality of [0, 3]) for (const flipX of [false, true]) for (const flipY of [false, true]) {
        const options = { quality, flipX, flipY }, suffix = `quality=${quality}, flip=${flipX}/${flipY}`;
        const dx = flipX ? -26 : 26, dy = flipY ? -13 : 13;
        near(inspect({}, options), { x: center.x + dx, y: center.y + dy }, `Neutral ${suffix}`);
        near(inspect({ scaleX: 200 }, options), { x: center.x + dx * 2, y: center.y + dy }, `Horizontal scale ${suffix}`);
        near(inspect({ scaleY: 50 }, options), { x: center.x + dx, y: center.y + dy / 2 }, `Vertical scale ${suffix}`);
        near(inspect({ angle: 90 }, options), { x: center.x - dy, y: center.y + dx }, `Clockwise ${suffix}`);
        near(inspect({ angle: -90 }, options), { x: center.x + dy, y: center.y - dx }, `Counterclockwise ${suffix}`);
        near(inspect({ skewX: 45 }, options), { x: center.x + dx + dy, y: center.y + dy }, `Horizontal skew ${suffix}`);
        near(inspect({ skewY: 45 }, options), { x: center.x + dx, y: center.y + dy + dx }, `Vertical skew ${suffix}`);
        near(inspect({ skewX: 45, skewY: 45 }, options), { x: center.x + 2 * dx + dy, y: center.y + dy + dx }, `Both skews ${suffix}`);
        const combined = { scaleX: 200, scaleY: 50, angle: 90, offsetX: 10, offsetY: -10 };
        near(inspect(combined, options), { x: center.x - dy / 2 + 52, y: center.y + dx * 2 - 26 }, `Combined affine ${suffix}`);
        near(inspect(combined, { ...options, extras: ['scale-pulse', 'shake'].map(type => normalizeEffect({ type, amount: 1 })) }),
            { x: center.x - dy / 2 * 1.25 + 52, y: center.y + dx * 2 * 1.25 - 26 + 10.4 }, `Pulse and Shake ${suffix}`);
    }
    const settings = { scaleX: 200, scaleY: 50, angle: 90, offsetX: 10, offsetY: -10, skewX: 20, skewY: -15 };
    const half = inspect({ ...settings, amount: .5 });
    for (const source of ['level', 'bass', 'time']) {
        near(inspect({ ...settings, mod: { source, depth: 1, speed: 1 } }, { modulators: { level: .5, bass: .5 } }),
            half, `${source} modulates all affine controls`);
    }
    const neutral = inspect();
    near(inspect({ ...settings, amount: 0 }), neutral, 'Zero amount restores the original');
    near(inspect({ ...settings, enabled: false }), neutral, 'Disabled Transform restores the original');
    expect(inspect({ scaleX: 0 }).weight === 0, 'Zero horizontal scale collapses the image');
    expect(inspect({ scaleY: 0 }).weight === 0, 'Zero vertical scale collapses the image');
    const cached = inspect({ scaleX: 120 });
    expect(cached.processor.apply('sample', input, [cached.effect], 1, {}, 0, false) === cached.output,
        'Static transforms reuse the rendered layer');
    const ordered = inspect({ scaleX: 200 }, { extras: [normalizeEffect({ type: 'transform', angle: 90 })] });
    near(ordered, { x: center.x - 26, y: center.y + 26 }, 'Multiple transforms compose their matrices');
    return { passed: checks.length - errors.length, total: checks.length, errors };
};

test('Transform composes affine controls, existing movement, modulation, and flips on Canvas', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: source });
        const result = await page.evaluate(probe);
        assert.deepEqual(result.errors, [], JSON.stringify(result));
        assert.equal(result.passed, result.total);
    } finally {
        await browser.close();
    }
});

const overflowProbe = () => {
    const canvas = createLayer(640, 400), renderer = new VisualizerRenderer(canvas);
    const layout = createDefaultLayout(), item = createItem('shape', 'subject');
    item.rect = { x: .45, y: .3, w: .2, h: .25 };
    item.palette.color = '#ffffff'; item.style.fillOpacity = 1; item.style.borderWidth = 0;
    layout.background.color = '#000000'; layout.items = [item];
    let level = 0, bass = 0;
    const sources = { getModulators: () => ({ level, bass }), getFrame: () => null };
    const checks = [], errors = [];
    const expect = (condition, message) => { checks.push(message); if (!condition) errors.push(message); };
    const sample = () => {
        const pixels = canvas.getContext('2d').getImageData(0, 0, 640, 400).data;
        let weight = 0, x = 0, y = 0, minX = 640, maxX = -1, minY = 400, maxY = -1;
        for (let row = 0; row < 400; row++) for (let col = 0; col < 640; col++) {
            const value = pixels[(row * 640 + col) * 4];
            if (value <= 10) continue;
            weight += value; x += col * value; y += row * value;
            minX = Math.min(minX, col); maxX = Math.max(maxX, col);
            minY = Math.min(minY, row); maxY = Math.max(maxY, row);
        }
        return { x: x / weight, y: y / weight, weight, minX, maxX, minY, maxY };
    };
    const draw = (settings, extras = [], time = 0, quality = 'high') => {
        item.effects = [normalizeEffect({ type: 'transform', ...settings }), ...extras];
        renderer.draw(layout, sources, null, time, { quality });
        return sample();
    };
    for (const quality of ['high', 'low']) for (const flipX of [false, true]) for (const flipY of [false, true]) {
        item.flipX = flipX; item.flipY = flipY;
        const label = `${quality}, flip=${flipX}/${flipY}`;
        const scaled = draw({ scaleX: 200, scaleY: 200 }, [], 0, quality);
        expect(scaled.minX < 250 && scaled.maxX > 455 && scaled.minY < 90 && scaled.maxY > 250, `Scale overflows all four item edges: ${label}`);
        const rotated = draw({ angle: 90 }, [], 0, quality);
        expect(rotated.minY < 112 && rotated.maxY > 228, `Rotation overflows the item: ${label}`);
        const shifted = draw({ offsetX: 100, offsetY: 100 }, [], 0, quality);
        expect(Math.abs(shifted.x - 479.5) < 1 && Math.abs(shifted.y - 269.5) < 1, `Offset follows screen axes outside the item: ${label}`);
        const skewed = draw({ skewX: 45 }, [], 0, quality);
        expect(skewed.minX < 250 && skewed.maxX > 455, `Skew overflows the item: ${label}`);
        const inactive = draw({ enabled: false, scaleX: 200 }, [], 0, quality);
        expect(inactive.minX >= 287 && inactive.maxX <= 416, `Disabled Transform retains the item bounds: ${label}`);
    }
    item.flipX = item.flipY = false;
    item.style.fillOpacity = 1;
    const glowing = draw({ offsetX: 75 }, [normalizeEffect({ type: 'glow', amount: .5 })]);
    expect(glowing.maxX > 512 && glowing.minX > 310 && glowing.minX < 383 && Math.abs(glowing.y - 169.5) < 2,
        `Glow surrounds the transformed drawing beyond the original frame: ${JSON.stringify(glowing)}`);
    const trail = normalizeEffect({ type: 'trail', amount: .7 });
    draw({ offsetX: 75 }, [trail]);
    const trailHistory = renderer.effects.states.get(item.id).history.get(1);
    item.style.fillOpacity = 0;
    const fading = draw({ offsetX: 75 }, [trail], 1 / 60);
    expect(fading.maxX > 480 && fading.weight > 0, 'Trail keeps the transformed drawing beyond the original frame');
    expect(renderer.effects.states.get(item.id).history.get(1) === trailHistory, 'Overflow trail history survives subsequent frames');
    renderer.effects.states.clear();
    item.style.fillOpacity = 1;
    draw({ offsetX: 60 }, [normalizeEffect({ type: 'trail-feedback', amount: 1, zoom: 0, angle: 3 })]);
    item.style.fillOpacity = 0;
    const feedback = draw({ offsetX: 60 }, [normalizeEffect({ type: 'trail-feedback', amount: 1, zoom: 0, angle: 3 })], 1 / 60);
    expect(Math.abs(feedback.x - (351.5 + 76.8 * Math.cos(Math.PI / 60))) < 1 &&
        Math.abs(feedback.y - (169.5 + 76.8 * Math.sin(Math.PI / 60))) < 1, 'Feedback rotates overflow around the item center');
    item.style.fillOpacity = 1;
    const symmetric = draw({ offsetY: 60 }, [normalizeEffect({ type: 'symmetry', amount: 0 })]);
    expect(Math.abs(symmetric.x - 351.5) < 1 && Math.abs(symmetric.y - 169.5) < 1, 'Symmetry retains the item center on the larger canvas');
    const modulated = { scaleX: 200, mod: { source: 'level', depth: 1, speed: 1 } };
    level = 0; draw(modulated, [trail]);
    const animatedState = renderer.effects.states.get(item.id), animatedHistory = animatedState.history.get(1);
    level = 1; draw(modulated, [trail], 1 / 60);
    expect(renderer.effects.states.get(item.id) === animatedState && animatedState.history.get(1) === animatedHistory,
        'Modulation keeps its canvas and history without resizing each frame');
    item.style.fillOpacity = 0; bass = 1;
    const particles = draw({}, [normalizeEffect({ type: 'particles', amount: 1 })]);
    expect(particles.weight > 0 && particles.minX >= 287 && particles.maxX <= 425 && particles.minY >= 119 && particles.maxY <= 229,
        'Particles originate inside the item on the larger canvas');
    item.style.fillOpacity = 1;
    item.rect.x = .75;
    const sceneEdge = draw({ scaleX: 300 });
    expect(sceneEdge.maxX === 639, 'Overflow clips naturally at the Visualizer screen edge');
    const huge = normalizeEffect({ type: 'transform', scaleX: 300, scaleY: 300, skewX: 60, skewY: 60, angle: 45 });
    draw(huge, Array.from({ length: 15 }, () => structuredClone(huge)));
    const state = renderer.effects.states.get(item.id);
    expect(state.a.width <= 640 && state.a.height <= 400, 'Large composed transforms keep their buffers bounded by the scene');
    renderer.dispose();
    return { passed: checks.length - errors.length, total: checks.length, errors };
};

test('Transform draws outside item frames while keeping screen bounds and effect centers', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body></body>');
        await page.addScriptTag({ content: source });
        const result = await page.evaluate(overflowProbe);
        assert.deepEqual(result.errors, [], JSON.stringify(result));
        assert.equal(result.passed, result.total);
    } finally {
        await browser.close();
    }
});
