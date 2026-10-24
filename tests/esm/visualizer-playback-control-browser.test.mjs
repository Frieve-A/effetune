import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

test('Playback controls redraw state, render styled labels and map transformed main/feed hits', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1020, height: 740 } });
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-playback-control', 'visualizer-renderer']) {
            await page.addScriptTag({ content: readFileSync(new URL(`../../js/visualizer/${file}.js`, import.meta.url), 'utf8')
                .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '') });
        }
        const result = await page.evaluate(() => {
            const canvas = createLayer(1000, 720); document.body.appendChild(canvas);
            const renderer = new VisualizerRenderer(canvas), sources = { getModulators: () => ({}), getFrame: () => null };
            const enabled = Object.fromEntries(PLAYBACK_ACTIONS.map(action => [action, true]));
            const playback = { enabled, playing: false, shuffle: true, repeat: 'ONE' };
            const item = createItem('playback-control', 'transformed');
            item.rect = { x: .1, y: .1, w: .2, h: .2 };
            item.effects = [normalizeEffect({ type: 'transform', angle: 25, offsetX: 30, scaleX: 110, scaleY: 90 })];
            item.flipX = true;
            const layout = { ...createDefaultLayout(), items: [item] };
            renderer.draw(layout, sources, null, 0, { playback });
            const before = renderer.layers.get(item.id).canvas.toDataURL();
            playback.playing = true;
            renderer.draw(layout, sources, null, 0, { playback });
            const state = renderer.layers.get(item.id), after = state.canvas.toDataURL();
            const point = state.hitTransform.inverse().transformPoint({ x: state.canvas.width / 2, y: state.canvas.height / 2 });
            const hit = renderer.playbackControlAt(layout, point.x / canvas.width, point.y / canvas.height);
            const copy = new VisualizerRenderer(createLayer(500, 300)); copy.copyFrom(renderer);
            const copiedHit = copy.playbackControlAt(layout, point.x / canvas.width, point.y / canvas.height);
            playback.focusedId = item.id;
            renderer.draw(layout, sources, null, 0, { playback });
            const focus = state.canvas.toDataURL();
            item.effects = [normalizeEffect({ type: 'opacity', amount: 0 })];
            renderer.draw(layout, sources, null, 0, { playback });
            const hidden = renderer.playbackControlAt(layout, .2, .2);
            const items = [];
            for (let row = 0; row < 3; row++) for (let col = 0; col < 6; col++) {
                const control = createItem('playback-control', `${row}-${col}`);
                control.rect = { x: .025 + col * .165, y: .04 + row * .24, w: .14, h: .18 };
                Object.assign(control.params, PLAYBACK_APPEARANCES[['glass', 'raised', 'minimal'][row]], { action: PLAYBACK_ACTIONS[col] });
                if (row === 0) control.params.shape = 'ellipse';
                if (row === 1) { control.params.display = 'icon-label'; control.style.fontSize = 18; }
                items.push(control);
            }
            items[15].params.display = 'label'; items[15].params.label = 'Next';
            items[16].params.radius = 200; items[16].params.fillOpacity = .8;
            items[17].params.borderWidth = 2;
            const small = createItem('playback-control', 'small');
            small.rect = { x: .025, y: .82, w: .04, h: .055 }; small.params.radius = 0;
            const pill = createItem('playback-control', 'pill');
            pill.rect = { x: .14, y: .79, w: .3, h: .13 }; pill.params.radius = 200;
            pill.params.display = 'label'; pill.params.label = 'Listen'; pill.style.fontSize = 28;
            const wide = createItem('playback-control', 'wide');
            wide.rect = { x: .53, y: .79, w: .4, h: .13 }; wide.params.display = 'icon-label';
            wide.params.label = 'My playlist'; wide.style.fontSize = 24;
            items.push(small, pill, wide);
            renderer.draw({ ...layout, items }, sources, null, 0, { playback: { ...playback, focusedId: '0-0', enabled: { ...enabled, stop: false } } });
            return { changed: before !== after, focused: focus !== after, hit, copiedHit, hidden };
        });
        if (process.env.VISUALIZER_PLAYBACK_SCREENSHOT) await page.screenshot({ path: process.env.VISUALIZER_PLAYBACK_SCREENSHOT });
        assert.equal(result.changed, true);
        assert.equal(result.focused, true);
        assert.deepEqual(result.hit, { id: 'transformed', action: 'play-pause' });
        assert.deepEqual(result.copiedHit, result.hit);
        assert.equal(result.hidden, null);
    } finally { await browser.close(); }
});
