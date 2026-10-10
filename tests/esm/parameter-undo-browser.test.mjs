import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const origin = 'https://effetune.test';

async function openVolumePipeline(t, count) {
    const browser = await chromium.launch();
    t.after(() => browser.close());
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const html = (await fs.readFile(path.join(root, 'effetune.html'), 'utf8'))
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    await page.route(`${origin}/**`, async route => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: html });
        const file = path.resolve(root, `.${pathname}`);
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return route.fulfill({ status: 403, body: '' });
        const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
            '.json5': 'application/json', '.json': 'application/json' };
        await route.fulfill({ contentType: types[path.extname(file)], body: await fs.readFile(file) });
    });
    await page.goto(origin);
    await page.addScriptTag({ url: `${origin}/plugins/plugin-base.js` });
    await page.addScriptTag({ url: `${origin}/plugins/basics/volume.js` });
    await page.evaluate(async count => {
        const { PluginManager } = await import('./js/plugin-manager.js');
        const { UIManager } = await import('./js/ui-manager.js');
        const { AudioManager } = await import('./js/audio-manager.js');
        window.pluginManager = new PluginManager();
        pluginManager.pluginClasses.Volume = window.VolumePlugin;
        // Exercise the normal editor without acquiring audio or starting the app.
        window.audioManager = new AudioManager();
        audioManager.pipelineA.push(...Array.from({ length: count }, () => pluginManager.createPlugin('Volume')));
        window.uiManager = new UIManager(pluginManager, audioManager);
        window.pipelineManager = uiManager.pipelineManager;
        audioManager.pipelineManager = pipelineManager;
        audioManager.pipelineA.forEach(plugin => uiManager.expandedPlugins.add(plugin));
        await uiManager.localizationReady;
        uiManager.initDragAndDrop();
        uiManager.initRangeFillStyling();
        uiManager.updatePipelineUI();
        pipelineManager.historyManager.saveState();
        document.documentElement.classList.remove('app-starting');
    }, count);
    return { page, errors };
}

test('a long Volume drag stays one undo operation while a timer mapping has no matching effect',
    { timeout: 30000 }, async t => {
        const { page, errors } = await openVolumePipeline(t, 1);
        await page.evaluate(async () => {
            const { MidiMappingEngine } = await import('./js/midi/midi-mapping-engine.js');
            const mapping = { id: 'background-timer', device: '', source: { kind: 'timer', intervalMs: 1000 },
                target: { type: 'AMRadioSimulatorPlugin', instance: 'first', param: 'st', element: 0 },
                map: { lo: 0, hi: 100, behavior: 'randomWalk', amount: 0.1, dir: 1 } };
            const engine = new MidiMappingEngine({ store: { mappings: [mapping] } });
            window.automationFrames = 0;
            setInterval(() => {
                engine.onAutomationEvent(mapping.id, { kind: 'timer' });
                window.automationFrames++;
            }, 1000);
        });
        const slider = page.locator('#pipelineList input[type="range"]').first();
        const bounds = await slider.boundingBox();
        const y = bounds.y + bounds.height / 2;
        await page.mouse.move(bounds.x + bounds.width * 0.7, y);
        await page.mouse.down();
        for (let move = 1; move <= 20; move++) {
            await new Promise(resolve => setTimeout(resolve, 550));
            await page.mouse.move(bounds.x + bounds.width * (0.7 - move * 0.02), y);
            assert.equal(await page.evaluate(() => pipelineManager.historyManager.history.length), 2);
        }
        await page.mouse.up();
        await page.waitForFunction(() => !pipelineManager.uiEventHandler.parameterOperation);
        assert.ok(await page.evaluate(() => automationFrames >= 10));
        const finalValue = await page.evaluate(() => audioManager.pipeline[0].vl);
        await page.locator('#undoButton').click();
        assert.equal(await page.evaluate(() => audioManager.pipeline[0].vl), 0);
        await page.locator('#redoButton').click();
        assert.equal(await page.evaluate(() => audioManager.pipeline[0].vl), finalValue);
        assert.deepEqual(errors, []);
    });

for (const count of [1, 2]) {
    test(`a slow Volume drag after editing ${count === 1 ? 'its' : 'another effect\'s'} number field is one undo operation`,
        { timeout: 30000 }, async t => {
            const { page, errors } = await openVolumePipeline(t, count);
            const values = () => page.evaluate(() => audioManager.pipeline.map(plugin => plugin.vl));
            const historyLength = () => page.evaluate(() => pipelineManager.historyManager.history.length);
            await page.locator('#pipelineList input[type="number"]').first().fill('-6');
            assert.equal(await historyLength(), 2);
            const slider = page.locator('#pipelineList input[type="range"]').nth(count - 1);
            const bounds = await slider.boundingBox();
            const y = bounds.y + bounds.height / 2;
            await page.mouse.move(bounds.x + bounds.width * 0.7, y);
            await page.mouse.down();
            for (const fraction of [0.74, 0.78, 0.82]) {
                await new Promise(resolve => setTimeout(resolve, 650));
                await page.mouse.move(bounds.x + bounds.width * fraction, y);
                assert.equal(await page.evaluate(() => pipelineManager.uiEventHandler.parameterOperation?.pointerActive), true);
                assert.equal(await historyLength(), 3);
            }
            await new Promise(resolve => setTimeout(resolve, 1100));
            await page.mouse.move(bounds.x + bounds.width * 0.85, y);
            await page.mouse.up();
            await page.waitForFunction(() => !pipelineManager.uiEventHandler.parameterOperation);
            assert.equal(await historyLength(), 3);
            const finalValues = await values();

            await page.locator('#undoButton').click();
            assert.deepEqual(await values(), count === 1 ? [-6] : [-6, 0]);
            await page.locator('#undoButton').click();
            assert.deepEqual(await values(), Array(count).fill(0));
            await page.locator('#redoButton').click();
            assert.deepEqual(await values(), count === 1 ? [-6] : [-6, 0]);
            await page.locator('#redoButton').click();
            assert.deepEqual(await values(), finalValues);

            const nextSlider = page.locator('#pipelineList input[type="range"]').nth(count - 1);
            const nextBounds = await nextSlider.boundingBox();
            const nextY = nextBounds.y + nextBounds.height / 2;
            await page.mouse.move(nextBounds.x + nextBounds.width * 0.7, nextY);
            await page.mouse.down();
            await page.mouse.move(nextBounds.x + nextBounds.width * 0.75, nextY);
            await page.mouse.up();
            await page.waitForFunction(() => !pipelineManager.uiEventHandler.parameterOperation);
            assert.equal(await historyLength(), 4, 'a separate drag creates a separate undo entry');
            await page.locator('#undoButton').click();
            assert.deepEqual(await values(), finalValues);
            assert.deepEqual(errors, []);
        });
}

for (const commit of ['Enter', 'blur']) {
    test(`committing a clamped Volume number with ${commit} retains the whole edit in one undo operation`,
        { timeout: 30000 }, async t => {
            const { page, errors } = await openVolumePipeline(t, 1);
            const input = page.locator('#pipelineList input[type="number"]').first();
            await input.fill('12');
            await input.fill('30');
            assert.equal(await page.evaluate(() => audioManager.pipeline[0].vl), 12);
            if (commit === 'Enter') await input.press('Enter');
            else await page.locator('#pipelineMenuButton').focus();
            await page.waitForFunction(() => !pipelineManager.uiEventHandler.parameterOperation);
            assert.equal(await page.evaluate(() => audioManager.pipeline[0].vl), 24);
            assert.equal(await page.evaluate(() => pipelineManager.historyManager.history.length), 2);
            await page.locator('#undoButton').click();
            assert.equal(await page.evaluate(() => audioManager.pipeline[0].vl), 0);
            await page.locator('#redoButton').click();
            assert.equal(await page.evaluate(() => audioManager.pipeline[0].vl), 24);
            assert.deepEqual(errors, []);
        });
}
