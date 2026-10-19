import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const script = ['visualizer-model', 'visualizer-effects', 'visualizer-hdr', 'visualizer-renderer'].map(file =>
    readFileSync(new URL(`../../js/visualizer/${file}.js`, import.meta.url), 'utf8')
        .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')).join('\n');
// Synthetic 32x32 neutral PQ/BT.2020 VP9 profile 2 white, encoded at 10 bits.
const videoData = readFileSync(new URL('../fixtures/visualizer-hdr/pq-white.webm', import.meta.url)).toString('base64');

async function withPage(run) {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.HDR_TEST_EXECUTABLE ? { executablePath: process.env.HDR_TEST_EXECUTABLE } : {}),
        args: ['--enable-blink-features=CanvasGlobalHDRHeadroom'],
        ignoreDefaultArgs: ['--force-color-profile=srgb'] });
    try {
        const page = await browser.newPage();
        const warnings = [];
        page.on('console', message => {
            if (message.type() === 'warning' && message.text().startsWith('Visualizer HDR ')) warnings.push(message.text());
        });
        await page.exposeFunction('hdrWarnings', () => [...warnings]);
        await page.route('https://visualizer-hdr.invalid/**', route => route.fulfill({ body: '<!doctype html><body></body>', contentType: 'text/html' }));
        await page.goto('https://visualizer-hdr.invalid/');
        await page.addScriptTag({ content: script });
        await run(page, warnings);
    } finally { await browser.close(); }
}

test('HDR retains decoded video and effect headroom through GPU presentation, sharing and display fallback', { timeout: 30000 }, t => withPage(async (page, warnings) => {
    const result = await page.evaluate(async videoData => {
        let high = true;
        window.matchMedia = () => ({ matches: high });
        const canvas = createLayer(32, 32), overlay = createLayer(32, 32);
        const renderer = new VisualizerRenderer(canvas, { hdrCanvas: overlay });
        const sources = { getModulators: () => ({}), getFrame: () => null };
        const item = createItem('video', 'video');
        item.rect = { x: 0, y: 0, w: 1, h: 1 }; item.style.rounded = false;
        const layout = { ...createDefaultLayout(), items: [item] };
        const video = document.createElement('video'); video.muted = true;
        video.src = `data:video/webm;base64,${videoData}`;
        await new Promise((resolve, reject) => { video.onloadeddata = resolve; video.onerror = reject; });
        await new Promise((resolve, reject) => {
            video.requestVideoFrameCallback(() => { video.pause(); resolve(); }); video.play().catch(reject);
        });
        renderer.draw(layout, sources, null, 0, { video, hdr: true });
        const initializing = { active: renderer.hdrActive, hidden: overlay.hidden,
            sdr: canvas.getContext('2d').getImageData(16, 16, 1, 1).data[0] };
        await renderer.hdrOutput.pending;
        if (!renderer.hdrOutput.ready) return { unsupported: true, errors: await window.hdrWarnings(), initializing };
        const read = source => [...source.getContext('2d').getImageData(16, 16, 1, 1,
            { colorSpace: 'display-p3', pixelFormat: 'rgba-float16' }).data];
        const render = effects => {
            item.effects = effects.map(effect => normalizeEffect(effect));
            renderer.draw(layout, sources, null, .1, { video, hdr: true });
            return read(renderer.hdrStage);
        };
        const none = render([]), neutral = render([{ type: 'color-adjust' }]);
        const brightness = render([{ type: 'color-adjust', brightness: .1 }]);
        const blur = render([{ type: 'blur', amount: .3 }]);
        const glow = render([{ type: 'glow', amount: .3 }]);
        const glowAlpha = [[.2, .3, .4], [.5, .5, .5], [0, 0, 0]].map(alphas => {
            const colors = [[2, .5, .25], [.5, 1, 2], [3, 2, 1]];
            const inputs = colors.map((color, index) => {
                const size = index === 1 ? 2 : 32, canvas = createLayer(size, size, true);
                const pixels = new Float16Array(size * size * 4);
                for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([...color, alphas[index]], offset);
                canvas.getContext('2d').putImageData(new ImageData(pixels, size, size,
                    { colorSpace: 'display-p3', pixelFormat: 'rgba-float16' }), 0, 0);
                return canvas;
            });
            renderer.hdrOutput.glow(inputs[0].getContext('2d'), inputs[1], inputs[2]);
            const alpha = Math.min(1, alphas.reduce((sum, value) => sum + value, 0));
            const expected = [0, 1, 2].map(channel => alpha ? colors.reduce((sum, color, i) => sum + color[channel] * alphas[i], 0) / alpha : 0);
            return { actual: read(inputs[0]), expected: [...expected, alpha] };
        });
        const mixed = render([{ type: 'color-map', amount: .5,
            palette: { stops: [{ pos: 0, color: '#000000' }, { pos: 1, color: '#ffffff' }] } }]);
        const trail = render([{ type: 'trail' }]);
        const colorInput = createLayer(4, 4, true), colorContext = colorInput.getContext('2d');
        colorContext.fillStyle = 'rgba(64,128,192,.5)'; colorContext.fillRect(0, 0, 4, 4);
        const colorComparisons = [{}, { brightness: .1 }, { gamma: 2 }, { saturation: 0 }, { hue: 180 },
            { outputBlack: .1, outputWhite: .8 }, { invert: true, amount: .4 }, { type: 'color-map', amount: .4 }]
            .map(settings => {
                const effect = normalizeEffect({ type: 'color-adjust', ...settings });
                return [null, renderer.hdrOutput].map(output => {
                    const canvas = new VisualizerEffects(output).apply('color', colorInput, [effect], 0, {}).canvas;
                    return [...canvas.getContext('2d').getImageData(1, 1, 1, 1, { colorSpace: 'srgb' }).data];
                });
            });
        const gpuReadback = createLayer(32, 32, true);
        const gpuReadContext = gpuReadback.getContext('2d'); gpuReadContext.globalHDRHeadroom = Infinity;
        gpuReadContext.drawImage(overlay, 0, 0);
        const presented = read(gpuReadback);
        const other = new VisualizerRenderer(createLayer(32, 32), { hdrCanvas: createLayer(32, 32) });
        const pendingCopy = other.copyFrom(renderer, { hdr: true });
        await other.hdrOutput.pending;
        const shared = other.copyFrom(renderer, { hdr: true }), copied = read(other.hdrStage);
        high = false;
        const mixedDisplay = other.copyFrom(renderer, { hdr: true });
        other.draw(layout, sources, null, .2, { video, hdr: true });
        const fallback = { active: other.hdrActive, hidden: other.hdrOutput.overlay.hidden,
            value: other.canvas.getContext('2d').getImageData(16, 16, 1, 1).data[0] };
        high = true;
        other.draw(layout, sources, null, .3, { video, hdr: true });
        const resumed = other.hdrActive;
        other.draw(layout, sources, null, .4, { video, hdr: false });
        const disabled = { active: other.hdrActive, device: Boolean(other.hdrOutput.device), hidden: other.hdrOutput.overlay.hidden };
        const unexpectedErrors = await window.hdrWarnings();
        renderer.hdrOutput.device.destroy();
        await renderer.hdrOutput.device.lost;
        renderer.draw(layout, sources, null, .5, { video, hdr: true });
        const lost = { active: renderer.hdrActive, hidden: overlay.hidden };
        renderer.dispose(); other.dispose();
        return { none, neutral, brightness, blur, glow, glowAlpha, mixed, trail, presented, initializing, pendingCopy,
            shared, copied, mixedDisplay, fallback, resumed, disabled, lost, colorComparisons, errors: unexpectedErrors };
    }, videoData);
    assert.deepEqual(result.errors, []);
    if (result.unsupported) {
        assert.equal(result.initializing.hidden, true);
        assert.ok(result.initializing.sdr > 200);
        t.skip('Float16 Canvas headroom/WebGPU unavailable; run with HDR_TEST_EXECUTABLE pointing to a GPU-capable Chromium.');
        return;
    }
    assert.equal(result.initializing.active, false);
    assert.equal(result.initializing.hidden, true);
    assert.ok(result.initializing.sdr > 200);
    assert.ok(result.none[0] > 1.5, JSON.stringify(result));
    assert.ok(Math.abs(result.neutral[0] - result.none[0]) < .03, JSON.stringify(result));
    assert.ok(result.brightness[0] > result.none[0] + .05);
    assert.ok(Math.abs(result.blur[0] - result.none[0]) < .03);
    assert.ok(result.glow[0] >= result.none[0], JSON.stringify(result.glow));
    for (const { actual, expected } of result.glowAlpha) actual.forEach((value, index) =>
        assert.ok(Math.abs(value - expected[index]) < .015, `${actual} versus ${expected}`));
    assert.ok(result.mixed[0] > 1.1 && result.mixed[0] < result.none[0]);
    assert.ok(result.trail[0] > 1.5 && result.presented[0] > 1.5);
    for (const [sdr, hdr] of result.colorComparisons) hdr.forEach((value, index) =>
        assert.ok(Math.abs(value - sdr[index]) <= 3, `${hdr} versus ${sdr}`));
    assert.equal(result.pendingCopy, false);
    assert.equal(result.shared, true);
    assert.ok(result.copied[0] > 1.5);
    assert.equal(result.mixedDisplay, false);
    assert.equal(result.fallback.active, false);
    assert.equal(result.fallback.hidden, true);
    assert.ok(result.fallback.value > 200);
    assert.equal(result.resumed, true);
    assert.deepEqual(result.disabled, { active: false, device: false, hidden: true });
    assert.deepEqual(result.lost, { active: false, hidden: true });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^Visualizer HDR device lost:/);
}));

test('HDR initialization failure preserves the SDR canvas and off releases a pending device', { timeout: 30000 }, () => withPage(async page => {
    const result = await page.evaluate(async () => {
        window.matchMedia = () => ({ matches: true });
        const canvas = createLayer(8, 8), overlay = createLayer(8, 8);
        const renderer = new VisualizerRenderer(canvas, { hdrCanvas: overlay });
        const layout = createDefaultLayout(); layout.items = []; layout.background.color = '#ff0000';
        const sources = { getModulators: () => ({}), getFrame: () => null };
        renderer.hdrOutput.initialize = async () => { throw new Error('GPU unavailable'); };
        renderer.draw(layout, sources, null, 0, { hdr: true });
        await renderer.hdrOutput.pending;
        renderer.draw(layout, sources, null, 1, { hdr: true });
        const failed = { active: renderer.hdrActive, hidden: overlay.hidden,
            pixel: [...canvas.getContext('2d').getImageData(0, 0, 1, 1).data], warnings: (await window.hdrWarnings()).length };
        renderer.setHdrEnabled(false);
        let finish;
        renderer.hdrOutput.initialize = async () => { await new Promise(resolve => { finish = resolve; }); throw new Error('Canceled initialization'); };
        renderer.draw(layout, sources, null, 2, { hdr: true });
        renderer.setHdrEnabled(false);
        finish(); await renderer.hdrOutput.pending;
        const canceled = { active: renderer.hdrOutput.ready || false, failed: renderer.hdrOutput.failed, warnings: (await window.hdrWarnings()).length };
        renderer.clear();
        const clear = canvas.getContext('2d').getImageData(0, 0, 1, 1).data[3];
        renderer.dispose();
        return { failed, canceled, clear };
    });
    assert.deepEqual(result.failed, { active: false, hidden: true, pixel: [255, 0, 0, 255], warnings: 1 });
    assert.deepEqual(result.canceled, { active: false, failed: false, warnings: 1 });
    assert.equal(result.clear, 0);
}));
