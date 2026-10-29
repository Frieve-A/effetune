import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const script = path => readFileSync(new URL(path, import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '');

test('Canvas playback accepts touch release before click without activating drags or cancelled touches', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ hasTouch: true, viewport: { width: 600, height: 400 } });
        await page.addScriptTag({ content: 'class VisualizerRenderer {}' });
        await page.addScriptTag({ content: script('../../js/visualizer/visualizer-view.js') });
        await page.addScriptTag({ content: script('../../js/visualizer/visualizer-feed.js') });
        await page.evaluate(() => {
            window.commands = [];
            window.events = [];
            const view = Object.assign(Object.create(VisualizerView.prototype), {
                editor: { open: false }, layout: {},
                playback: () => ({ available: true }),
                createPlaybackControls() {}, beginCounterPointer() {}, counterAt: () => null,
                runPlaybackAction: action => commands.push(action)
            });
            window.open = () => window;
            window.feed = new VisualizerFeed(view);
            feed.canvas.style.cssText = 'position:absolute;left:0;top:0;width:300px;height:200px';
            feed.renderer.playbackItemAt = () => ({ id: 'play', action: 'play-pause' });
            for (const type of ['pointerdown', 'pointerup', 'pointerleave', 'click']) {
                feed.canvas.addEventListener(type, () => events.push(type));
            }
        });
        await page.touchscreen.tap(100, 100);
        assert.deepEqual(await page.evaluate(() => events), ['pointerdown', 'pointerup', 'pointerleave', 'click']);
        assert.deepEqual(await page.evaluate(() => commands), ['play-pause']);
        await page.mouse.click(100, 100);
        assert.equal(await page.evaluate(() => commands.length), 2, 'Mouse click still activates once');
        await page.mouse.move(100, 100);
        await page.mouse.down();
        await page.mouse.move(120, 100);
        await page.mouse.up();
        assert.equal(await page.evaluate(() => commands.length), 2, 'Dragging does not activate');
        await page.evaluate(() => {
            for (const type of ['pointerdown', 'pointercancel', 'pointerleave', 'click']) {
                feed.canvas.dispatchEvent(new PointerEvent(type, {
                    pointerType: 'touch', pointerId: 5, clientX: 100, clientY: 100,
                    button: 0, buttons: type === 'pointerdown' ? 1 : 0
                }));
            }
        });
        assert.equal(await page.evaluate(() => commands.length), 2, 'Cancelled touch cannot activate');
    } finally {
        await browser.close();
    }
});

test('Playback controls preserve native keyboard activation, dynamic labels, and focus across redraws', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<main><div id="stage"></div></main>');
        await page.addScriptTag({ content: script('../../js/visualizer/visualizer-view.js') });
        await page.addScriptTag({ content: script('../../js/utils/space-key-guard.js') });
        await page.evaluate(() => {
            window.commands = [];
            window.state = { currentTrack: {}, isPlaying: false, repeatMode: 'OFF', shuffleMode: false,
                currentTrackDuration: 120, currentTrackPosition: 30, seekBarEnabled: true };
            const player = { ui: { container: {} }, stateManager: { getStateSnapshot: () => state },
                togglePlayPause() { commands.push('play-pause'); state.isPlaying = !state.isPlaying; },
                contextManager: { seek(time) { commands.push(['seek', time]); state.currentTrackPosition = time; } },
                playbackManager: { runPlaybackCommand(command) { return Promise.resolve(command()); },
                    toggleShuffleMode() { commands.push('shuffle'); state.shuffleMode = !state.shuffleMode; } }
            };
            window.player = player;
            window.view = Object.assign(Object.create(VisualizerView.prototype), {
                uiManager: { getPlaybackTarget: () => player, t: key => key }, editor: { open: false },
                layout: { items: [
                    { id: 'play', type: 'playback-control', params: { action: 'play-pause' } },
                    { id: 'shuffle', type: 'playback-control', params: { action: 'shuffle' } },
                    { id: 'seek', type: 'seek-bar', params: {} }
                ] }, showControls() {}
            });
            view.createPlaybackControls(document.getElementById('stage'));
            view.syncPlaybackControls();
            installSpaceKeyGuard(document);
            // Existing global playback shortcuts leave native buttons to their own activation.
            document.addEventListener('keydown', event => {
                if (event.key === ' ' && !event.target.matches('button, [role="button"], a, .interactive')) commands.push('global-space');
            });
        });
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => view.playback().focusedId), 'play');
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Play');
        await page.keyboard.press('Space');
        await page.evaluate(() => view.syncPlaybackControls());
        assert.deepEqual(await page.evaluate(() => commands), ['play-pause']);
        assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Pause');
        assert.equal(await page.evaluate(() => view.playback().focusedId), 'play');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Space');
        await page.evaluate(() => view.syncPlaybackControls());
        assert.deepEqual(await page.evaluate(() => commands), ['play-pause', 'play-pause', 'shuffle']);
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-pressed')), 'true');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Seek Bar');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Home');
        await page.keyboard.press('End');
        const seeks = await page.evaluate(() => commands.slice(-3));
        assert.ok(Math.abs(seeks[0][1] - 31) < 1e-9);
        assert.deepEqual(seeks.slice(1), [['seek', 0], ['seek', 120]]);
        assert.equal(await page.evaluate(() => view.playback().focusedId), 'seek');
        await page.evaluate(() => {
            state.repeatMode = 'ONE';
            view.syncPlaybackControls();
        });
        assert.equal(await page.locator('button').nth(1).isDisabled(), true);
        await page.evaluate(() => { player.ui.container = null; view.syncPlaybackControls(); });
        assert.equal(await page.locator('.visualizer-playback-accessibility > *').count(), 0);
        assert.equal(await page.evaluate(() => view.playback().available), false);
        await page.evaluate(() => { player.ui.container = {}; state.isPlaying = false; view.syncPlaybackControls(); });
        assert.equal(await page.locator('input[type="range"]').count(), 1, 'Paused player keeps the seek bar');
        await page.evaluate(() => { view.editor.open = true; view.syncPlaybackControls(); });
        assert.equal(await page.locator('button:enabled').count(), 0);
        assert.equal(await page.evaluate(() => view.playbackFocusedId), null);
        await page.evaluate(() => { view.layout.items = []; view.syncPlaybackControls(); });
        assert.equal(await page.locator('button').count(), 0);
    } finally {
        await browser.close();
    }
});

test('Main and Clean Feed activate the frontmost button or seek bar in shared draw order', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        for (const file of ['visualizer-model', 'visualizer-effects', 'visualizer-text', 'visualizer-playback-control',
            'visualizer-seek-bar', 'visualizer-renderer', 'visualizer-view']) {
            await page.addScriptTag({ content: script(`../../js/visualizer/${file}.js`) });
        }
        const results = await page.evaluate(() => {
            const sources = { getModulators: () => ({}), getFrame: () => null }, commands = [];
            const state = { currentTrack: {}, currentTrackDuration: 100, currentTrackPosition: 20, seekBarEnabled: true };
            const player = { ui: { container: {} }, stateManager: { getStateSnapshot: () => state },
                playNext() { commands.push('next'); }, contextManager: { seek(value) { commands.push(value); } },
                playbackManager: { runPlaybackCommand(command) { return Promise.resolve(command()); } } };
            const surface = left => ({ getBoundingClientRect: () => ({ left, top: 10, width: 600, height: 400 }) });
            const feed = { canvas: surface(650), renderer: new VisualizerRenderer(createLayer(600, 400)) };
            const view = Object.assign(Object.create(VisualizerView.prototype), {
                uiManager: { getPlaybackTarget: () => player, t: key => key }, editor: { open: false },
                canvas: surface(10), renderer: new VisualizerRenderer(createLayer(600, 400)), feed
            });
            const button = createItem('playback-control', 'next'); button.params.action = 'next';
            const seek = createItem('seek-bar', 'seek');
            button.rect = { x: .25, y: .25, w: .5, h: .5 };
            seek.rect = { ...button.rect };
            const results = [];
            for (const items of [[seek, button], [button, seek]]) {
                view.layout = { ...createDefaultLayout(), items };
                feed.renderer.draw(view.layout, sources, null, 0, { playback: view.playback() });
                view.renderer.copyFrom(feed.renderer);
                for (const owner of [view, feed]) {
                    commands.length = 0;
                    const rect = owner.canvas.getBoundingClientRect();
                    const event = { clientX: rect.left + 300, clientY: rect.top + 200, pointerId: 1, button: 0, target: {} };
                    view.beginPlaybackInteraction(event, owner);
                    view.finishSeekPointer(event, owner);
                    view.activatePlaybackControl(event, owner);
                    results.push({ owner: owner === view ? 'main' : 'feed', top: items[1].type, commands: [...commands] });
                }
            }
            return results;
        });
        assert.deepEqual(results.map(result => [result.owner, result.top, result.commands]), [
            ['main', 'playback-control', ['next']], ['feed', 'playback-control', ['next']],
            ['main', 'seek-bar', [50]], ['feed', 'seek-bar', [50]]
        ]);
    } finally {
        await browser.close();
    }
});
