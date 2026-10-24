import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

test('Seek Bar follows time, hides with absent player and maps transformed drags to track endpoints', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 620 } });
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-playback-control', 'visualizer-seek-bar', 'visualizer-renderer']) {
            await page.addScriptTag({ content: readFileSync(new URL(`../../js/visualizer/${file}.js`, import.meta.url), 'utf8')
                .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') });
        }
        const result = await page.evaluate(() => {
            const canvas = createLayer(960, 600); document.body.appendChild(canvas);
            const renderer = new VisualizerRenderer(canvas), sources = { getModulators: () => ({}), getFrame: () => null };
            const item = createItem('seek-bar', 'seek');
            item.rect = { x: .15, y: .3, w: .7, h: .15 };
            item.effects = [normalizeEffect({ type: 'transform', angle: 20, offsetX: 10 })]; item.flipX = true;
            const button = createItem('playback-control', 'button');
            const layout = { ...createDefaultLayout(), items: [item, button] };
            const playback = { available: true, position: 0, duration: 200, seekEnabled: true, enabled: { 'play-pause': true } };
            renderer.draw(layout, sources, null, 0, { playback });
            const startImage = renderer.layers.get(item.id).canvas.toDataURL();
            playback.position = 100;
            renderer.draw(layout, sources, null, 0, { playback });
            const state = renderer.layers.get(item.id), middleImage = state.canvas.toDataURL();
            const point = ratio => state.hitTransform.inverse().transformPoint({ x: state.seekBounds.left +
                (state.seekBounds.right - state.seekBounds.left) * ratio, y: state.canvas.height / 2 });
            const middle = point(.5), outside = point(1.5);
            const hit = renderer.seekBarAt(layout, middle.x / canvas.width, middle.y / canvas.height);
            const clamped = renderer.seekBarValue(layout, item.id, outside.x / canvas.width, outside.y / canvas.height);
            const copy = new VisualizerRenderer(createLayer(480, 300)); copy.copyFrom(renderer);
            const feedHit = copy.seekBarAt(layout, middle.x / canvas.width, middle.y / canvas.height);
            playback.seekingId = item.id; playback.seekPosition = 200;
            renderer.draw(layout, sources, null, 0, { playback });
            const endImage = state.canvas.toDataURL();
            playback.available = false;
            renderer.draw(layout, sources, null, 0, { playback });
            const hidden = !renderer.layers.has(item.id) && !renderer.layers.has(button.id) && renderer.seekBarAt(layout, .5, .35) === null && renderer.playbackControlAt(layout, .5, .8) === null;
            renderer.draw(layout, sources, null, 0, { playback, editing: true });
            const editable = renderer.layers.has(item.id) && renderer.layers.has(button.id);
            const items = [];
            for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) {
                const bar = createItem('seek-bar', `${row}-${col}`);
                bar.rect = { x: .04 + col * .33, y: .08 + row * .23, w: .27, h: .11 };
                Object.assign(bar.params, SEEK_APPEARANCES[['slim', 'classic', 'bold'][row]]);
                items.push(bar);
            }
            const small = createItem('seek-bar', 'small'); small.rect = { x: .04, y: .82, w: .12, h: .06 };
            const wide = createItem('seek-bar', 'wide'); wide.rect = { x: .25, y: .8, w: .7, h: .1 }; wide.params.rounding = false;
            items.push(small, wide);
            // Draw separate time states in one canvas without introducing per-item transport state.
            renderer.draw({ ...layout, items: [] }, sources, null, 0, { playback });
            for (const bar of items) {
                const w = canvas.width * bar.rect.w, h = canvas.height * bar.rect.h;
                const layer = createLayer(w, h);
                const column = Number(bar.id.split('-')[1]);
                drawSeekBar(layer.getContext('2d'), bar, w, h, canvas.width / REFERENCE_WIDTH, bar.palette.color,
                    { available: true, duration: 100, position: column * 50 || 0, seekEnabled: bar.id !== '2-1', focusedId: bar.id === '1-1' ? bar.id : null });
                canvas.getContext('2d').drawImage(layer, bar.rect.x * canvas.width, bar.rect.y * canvas.height);
            }
            return { changed: startImage !== middleImage && middleImage !== endImage, hit, feedHit, clamped, hidden, editable };
        });
        if (process.env.VISUALIZER_SEEK_SCREENSHOT) await page.screenshot({ path: process.env.VISUALIZER_SEEK_SCREENSHOT });
        assert.equal(result.changed, true);
        assert.equal(result.hit.id, 'seek'); assert.ok(Math.abs(result.hit.value - .5) < 1e-10);
        assert.deepEqual(result.feedHit, result.hit);
        assert.equal(result.clamped, 1);
        assert.equal(result.hidden, true);
        assert.equal(result.editable, true);
    } finally { await browser.close(); }
});

test('Seek thumb shapes and inward borders preserve endpoints, hit geometry, and unclipped small bars', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
        await page.setContent('<style>body{margin:0;background:#10161d}canvas{display:block}</style>');
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-seek-bar']) {
            await page.addScriptTag({ content: readFileSync(new URL(`../../js/visualizer/${file}.js`, import.meta.url), 'utf8')
                .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') });
        }
        const result = await page.evaluate(() => {
            const shapes = ['circle', 'square', 'diamond', 'bar'], geometry = [], masks = [], borders = [], small = [];
            const pixels = canvas => {
                const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
                let minX = canvas.width, maxX = -1, minY = canvas.height, maxY = -1, green = 0, pink = 0, alpha = 0;
                for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
                    const i = (y * canvas.width + x) * 4;
                    if (!data[i + 3]) continue;
                    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
                    alpha = Math.max(alpha, data[i + 3]);
                    if (data[i + 1] > data[i]) green++;
                    else if (data[i] > data[i + 1]) pink++;
                }
                return { minX, maxX, minY, maxY, green, pink, alpha };
            };
            for (const shape of shapes) {
                const item = createItem('seek-bar', shape);
                Object.assign(item.params, { thumbShape: shape, thumbSize: 40, thumbColor: '#00ff88',
                    thumbBorderWidth: 2, thumbBorderColor: '#ff55aa', trackOpacity: 0 });
                for (const position of [0, 50, 100]) {
                    const canvas = createLayer(220, 56);
                    const bounds = drawSeekBar(canvas.getContext('2d'), item, 220, 56, 1, '#00000000',
                        { duration: 100, position, seekEnabled: true });
                    geometry.push({ shape, position, bounds });
                    borders.push({ shape, position, ...pixels(canvas) });
                    if (position === 50) masks.push(canvas.toDataURL());
                }
                item.params.thumbBorderWidth = 8;
                for (const position of [0, 100]) {
                    const canvas = createLayer(68, 20);
                    drawSeekBar(canvas.getContext('2d'), item, 68, 20, .75, '#00000000', { duration: 100, position, seekEnabled: true });
                    small.push({ shape, ...pixels(canvas) });
                }
            }
            const canvas = createLayer(1000, 650), ctx = canvas.getContext('2d'); document.body.appendChild(canvas);
            ctx.fillStyle = '#10161d'; ctx.fillRect(0, 0, 1000, 650);
            ctx.font = '600 20px system-ui'; ctx.fillStyle = '#e6e9ed';
            ['Start', 'Middle', 'End'].forEach((label, col) => ctx.fillText(label, 185 + col * 275, 44));
            shapes.forEach((shape, row) => {
                const item = createItem('seek-bar', shape);
                Object.assign(item.params, { thumbShape: shape, thumbSize: 28, thumbColor: '#e7c690',
                    thumbBorderWidth: row === 0 ? 0 : 2, thumbBorderColor: '#6a5132', trackOpacity: .5 });
                ctx.font = '500 18px system-ui'; ctx.fillStyle = '#c2cad3';
                ctx.fillText(shape[0].toUpperCase() + shape.slice(1), 25, 105 + row * 110);
                [0, 50, 100].forEach((position, col) => {
                    ctx.save(); ctx.translate(155 + col * 275, 67 + row * 110);
                    drawSeekBar(ctx, item, 240, 60, 1, '#e0ba7a', { duration: 100, position, seekEnabled: true });
                    ctx.restore();
                });
            });
            const detail = createItem('seek-bar', 'detail');
            Object.assign(detail.params, { thumbShape: 'diamond', thumbSize: 34, thumbBorderWidth: 3, thumbBorderColor: '#8b6a3f' });
            for (const [label, x, enabled, focused] of [['Focused', 155, true, true], ['Disabled', 430, false, false], ['Compact', 705, true, false]]) {
                ctx.font = '500 16px system-ui'; ctx.fillStyle = '#9aa6b3'; ctx.fillText(label, x, 555);
                ctx.save(); ctx.translate(x, 575);
                drawSeekBar(ctx, detail, label === 'Compact' ? 120 : 240, 30, .75, '#e0ba7a',
                    { duration: 100, position: 58, seekEnabled: enabled, focusedId: focused ? detail.id : null });
                ctx.restore();
            }
            return { geometry, borders, small, uniqueMasks: new Set(masks).size };
        });
        assert.equal(result.uniqueMasks, 4, 'All four thumb silhouettes are visibly distinct');
        const referenceBounds = result.geometry[0].bounds;
        for (const { bounds } of result.geometry) assert.deepEqual(bounds, referenceBounds, 'Shape does not change seek mapping');
        for (const sample of result.borders) {
            assert.ok(sample.green > 0 && sample.pink > 0, `${sample.shape} keeps both its fill and border`);
            assert.ok(sample.minX >= 1 && sample.maxX < 219 && sample.minY >= 1 && sample.maxY < 55, `${sample.shape} stays inside its item`);
            const center = referenceBounds.left + (referenceBounds.right - referenceBounds.left) * sample.position / 100;
            assert.ok(Math.abs((sample.minX + sample.maxX + 1) / 2 - center) <= 1, `${sample.shape} remains centered at its seek value`);
        }
        for (const sample of result.small) {
            assert.ok(sample.maxX >= sample.minX, `${sample.shape} remains visible in a short item`);
            assert.ok(sample.minX >= 0 && sample.maxX < 68 && sample.minY >= 0 && sample.maxY < 20);
        }
        if (process.env.VISUALIZER_SEEK_THUMB_SCREENSHOT) await page.screenshot({ path: process.env.VISUALIZER_SEEK_THUMB_SCREENSHOT });
    } finally { await browser.close(); }
});
