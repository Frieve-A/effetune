import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../../css/effetune-theme.css') +
    read('../../css/effetune.css').replace('@import url("effetune-theme.css");', '') +
    read('../../css/effetune-mobile.css');
const bundle = await build({
    stdin: {
        contents: `import './js/ui/range-fill.js';
            export { installRangePrecisionControl } from './js/ui/range-precision-controller.js';
            export { MobileNumberKeypad } from './js/ui/mobile-number-keypad.js';
            export { enableStandardSelects } from './js/ui/standard-select.js';
            export { PipelineItemBuilder } from './js/ui/pipeline/pipeline-item-builder.js';
            export { applySerializedState, getSerializablePluginStateLong } from './js/utils/serialization-utils.js';`,
        resolveDir: fileURLToPath(new URL('../../', import.meta.url))
    },
    bundle: true, format: 'iife', globalName: 'PipelineUI', write: false
});

async function mount(page, mobile = false) {
    await page.setContent(`<html class="${mobile ? 'layout-mobile' : ''}"><body class="${mobile ? 'layout-mobile' : ''}">
        <div class="main-container"><div class="pipeline"><div id="pipelineList">
        <div class="pipeline-column"></div></div></div></div><button id="after">After effects</button></body></html>`);
    await page.addStyleTag({ content: css });
    for (const content of [bundle.outputFiles[0].text,
        read('../../plugins/plugin-base.js'), read('../../plugins/basics/volume.js')]) {
        await page.addScriptTag({ content });
    }
    await page.evaluate(() => {
        PipelineUI.installRangePrecisionControl(document);
        PipelineUI.enableStandardSelects(document);
        window.keypad = new PipelineUI.MobileNumberKeypad();
        const manager = { historyManager: {
            saveState() {}, saveStateAtomicallyIfChanged() {},
            withHistorySuppressed: callback => callback()
        } };
        const core = {
            pipelineManager: manager,
            audioManager: { pipeline: [], pipelineManager: manager },
            pluginManager: { effectCategories: { Basics: { plugins: ['Volume'] } } },
            expandedPlugins: new Set(), selectedPlugins: new Set(),
            updatePluginNameDisplayState() {}, handlePluginSelection() {},
            updateWorkletPlugin() {}, updateAllPluginDisplayState() {},
            updateURL() {
                window.savedState = PipelineUI.getSerializablePluginStateLong(window.effect);
            }
        };
        manager.core = core;
        core.itemBuilder = new PipelineUI.PipelineItemBuilder(core);
        window.restoreEffect = (state, type = 'VolumePlugin') => {
            window.effect?.cleanup();
            core.expandedPlugins.clear();
            const effect = new window[type]();
            effect.id = 1;
            if (state) PipelineUI.applySerializedState(effect, state);
            window.effect = effect;
            core.audioManager.pipeline = [effect];
            core.expandedPlugins.add(effect);
            const item = core.itemBuilder.createPipelineItem(effect);
            document.querySelector('.pipeline-column').replaceChildren(item);
        };
        window.restoreEffect();
    });
}

test('locks block pointer and keyboard edits and survive pipeline save and restore', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        await mount(page);
        const slider = page.locator('.plugin-ui input[type="range"]');
        await slider.focus();
        await page.keyboard.press('ArrowRight');
        const value = await page.evaluate(() => window.effect.vl);
        assert.notEqual(value, 0);
        await page.locator('.lock-button').click();
        const rect = await slider.boundingBox();
        await page.mouse.click(rect.x + rect.width - 3, rect.y + rect.height / 2);
        await slider.evaluate(element => element.focus());
        assert.equal(await slider.evaluate(element => element === document.activeElement), true);
        await page.keyboard.press('ArrowRight');
        assert.equal(await page.evaluate(() => window.effect.vl), value);
        assert.equal(await page.locator('.reset-effect-button').isDisabled(), true);
        assert.equal(await page.locator('.preset-button').isDisabled(), true);
        assert.equal(await page.locator('.routing-button').isDisabled(), true);
        await page.locator('.lock-button').focus();
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.className), 'delete-button');
        await page.keyboard.press('Tab');
        assert.equal(await slider.evaluate(element => element === document.activeElement), true);

        await page.locator('.plugin-name').click();
        const saved = await page.evaluate(() => window.savedState);
        assert.deepEqual(saved.parameters, { vl: value, _uiCollapsed: true, _uiLocked: true });
        await page.evaluate(state => window.restoreEffect(state), saved);
        assert.equal(await page.locator('.plugin-ui').isVisible(), false);
        assert.equal(await page.locator('.lock-button').getAttribute('aria-pressed'), 'true');
        await page.locator('.plugin-name').click();
        assert.equal(await page.locator('.plugin-ui').getAttribute('data-parameters-locked'), 'true');
        await page.locator('.lock-button').click();
        await slider.focus();
        await page.keyboard.press('ArrowRight');
        assert.ok(await page.evaluate(previous => window.effect.vl > previous, value));
        assert.equal(await page.evaluate(() => '_uiLocked' in window.savedState.parameters), false);
        assert.equal(await page.evaluate(() => '_uiCollapsed' in window.savedState.parameters), false);
    } finally {
        await browser.close();
    }
});

test('locked controls blink the padlock on mouse and touch attempts without changing settings', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const mobile of [false, true]) {
            const page = await browser.newPage({
                viewport: { width: mobile ? 375 : 1440, height: 900 }, hasTouch: mobile
            });
            await mount(page, mobile);
            await page.locator('.lock-button').click();
            const press = async selector => {
                const rect = await page.locator(selector).boundingBox();
                const x = rect.x + rect.width / 2;
                const y = rect.y + rect.height / 2;
                if (mobile) await page.touchscreen.tap(x, y);
                else await page.mouse.click(x, y);
            };
            await press('.plugin-ui input[type="range"]');
            const fadedOpacity = await page.locator('.lock-button svg').evaluate(async icon => {
                const animation = icon.getAnimations()[0];
                await animation.ready;
                animation.pause();
                animation.currentTime = 200;
                window.previousLockFeedback = animation;
                return getComputedStyle(icon).opacity;
            });
            assert.ok(Number(fadedOpacity) < 0.3);
            await press('.plugin-ui input[type="range"]');
            assert.equal(await page.locator('.lock-button svg').evaluate(icon =>
                icon.getAnimations()[0] !== window.previousLockFeedback), true);
            await page.waitForFunction(() => !document.querySelector('.lock-button').classList.contains('lock-feedback'));
            assert.equal(await page.locator('.lock-button svg').evaluate(icon => getComputedStyle(icon).opacity), '1');
            assert.equal(await page.locator('.plugin-ui').evaluate(ui => getComputedStyle(ui).opacity), '1');
            assert.equal(await page.evaluate(() => window.effect.vl), 0);
            await press('.plugin-ui input[type="number"]');
            assert.equal(await page.evaluate(() => Boolean(window.keypad.target)), false);

            const slider = page.locator('.plugin-ui input[type="range"]');
            const sliderRect = await slider.boundingBox();
            await page.keyboard.down('Shift');
            await page.mouse.move(sliderRect.x + 10, sliderRect.y + sliderRect.height / 2);
            await page.mouse.down();
            await page.mouse.move(sliderRect.x + 90, sliderRect.y + sliderRect.height / 2);
            await page.mouse.up();
            await page.keyboard.up('Shift');
            assert.equal(await page.evaluate(() => window.effect.vl), 0);
            await page.waitForFunction(() => !document.querySelector('.lock-button').classList.contains('lock-feedback'));

            await page.locator('.toggle-button').click();
            assert.equal(await page.locator('.lock-button.lock-feedback').count(), 0);
            for (const selector of ['.routing-button', '.preset-button', '.reset-effect-button']) {
                await press(selector);
                assert.equal(await page.locator('.lock-button.lock-feedback').count(), 1);
            }
            await page.locator('.lock-button').click();
            assert.equal(await page.locator('.lock-button.lock-feedback').count(), 0);
            await press('.plugin-ui input[type="range"]');
            assert.equal(await page.locator('.lock-button.lock-feedback').count(), 0);
            await slider.focus();
            await page.keyboard.press('ArrowRight');
            assert.notEqual(await page.evaluate(() => window.effect.vl), 0);
            await page.close();
        }
    } finally {
        await browser.close();
    }
});

test('locked EQ graphs keep hover readouts and band tabs while rejecting edits', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
        await mount(page);
        for (const file of ['graph-point-interaction.js', 'graph-readout.js', 'eq/fifteen_band_peq.js']) {
            await page.addScriptTag({ content: read(`../../plugins/${file}`) });
        }
        for (const file of ['graph-readout.css', 'eq/fifteen_band_peq.css']) {
            await page.addStyleTag({ content: read(`../../plugins/${file}`) });
        }
        await page.evaluate(() => window.restoreEffect(null, 'FifteenBandPEQPlugin'));
        await page.locator('.lock-button').click();
        const parameters = await page.evaluate(() => window.effect.getParameters());
        const graph = await page.locator('.fifteen-band-peq-graph').boundingBox();
        await page.mouse.move(graph.x + graph.width * 0.4, graph.y + graph.height * 0.25);
        await page.waitForFunction(() => document.querySelector('.graph-readout-cursor').textContent);
        const readout = await page.locator('.graph-readout-cursor').textContent();
        await page.mouse.move(graph.x + graph.width * 0.7, graph.y + graph.height * 0.25);
        await page.waitForFunction(previous =>
            document.querySelector('.graph-readout-cursor').textContent !== previous, readout);
        assert.equal(await page.locator('.graph-readout-box').isVisible(), true);

        await page.locator('.fifteen-band-peq-band-tab').nth(1).locator('span').last().click();
        assert.equal(await page.evaluate(() => window.effect.currentBandIndex), 1);
        assert.equal(await page.locator('.lock-button.lock-feedback').count(), 0);
        await page.locator('.fifteen-band-peq-band-tab-checkbox').nth(1).click();
        assert.equal(await page.locator('.fifteen-band-peq-band-tab-checkbox').nth(1).isChecked(), true);

        const select = page.locator('.fifteen-band-peq-band-content.active select');
        await select.click();
        assert.equal(await page.locator('.standard-select-list').isVisible(), false);
        await select.focus();
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.locator('.standard-select-list').isVisible(), false);

        const marker = await page.locator('.fifteen-band-peq-marker').nth(1).boundingBox();
        const x = marker.x + marker.width / 2;
        const y = marker.y + marker.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 60, y - 40, { steps: 5 });
        await page.mouse.up();
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, 120);
        await page.mouse.click(x, y, { button: 'right' });
        assert.deepEqual(await page.evaluate(() => window.effect.getParameters()), parameters);

        await page.locator('.lock-button').click();
        await page.mouse.move(x, y);
        await page.mouse.wheel(0, 120);
        await page.waitForFunction(previous => window.effect.q1 !== previous, parameters.q1);
    } finally {
        await browser.close();
    }
});

test('locked custom EQ editors retain passive graph events and display-only controls', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        for (const [file, type, selector] of [
            ['eq/group_delay_peq', 'GroupDelayPEQPlugin', '.group-delay-peq-marker'],
            ['spatial/phase_select_eq', 'PhaseSelectEqPlugin', '.phase-select-eq-map canvas']
        ]) {
            const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, hasTouch: true });
            await mount(page);
            for (const script of ['graph-point-interaction', 'graph-readout', file]) {
                await page.addScriptTag({ content: read(`../../plugins/${script}.js`) });
            }
            await page.addStyleTag({ content: read(`../../plugins/${file}.css`) + read('../../plugins/graph-readout.css') });
            await page.evaluate(type => window.restoreEffect(null, type), type);
            const parameters = await page.evaluate(() => window.effect.getParameters());
            await page.locator('.lock-button').click();
            const control = page.locator(selector).first();
            await control.scrollIntoViewIfNeeded();
            const rect = await control.boundingBox();
            const x = rect.x + rect.width / 2 + (type === 'PhaseSelectEqPlugin' ? 12 : 0);
            const y = rect.y + rect.height / 2;
            await control.evaluate(element => {
                window.passiveGraphEvents = 0;
                element.addEventListener('pointerdown', () => window.passiveGraphEvents++);
            });
            const drag = async () => {
                await page.mouse.move(x, y);
                await page.mouse.down();
                await page.mouse.move(x + 30, y - 25, { steps: 5 });
                await page.mouse.up();
            };
            await drag();
            await page.touchscreen.tap(x, y);
            assert.equal(await page.evaluate(() => window.passiveGraphEvents), 2);
            assert.deepEqual(await page.evaluate(() => window.effect.getParameters()), parameters);
            if (type === 'PhaseSelectEqPlugin') {
                await page.waitForFunction(() => document.querySelector('.graph-readout-cursor').textContent);
                await page.locator('.phase-select-eq-axis-controls input[value="balance"]').check();
                assert.equal(await page.evaluate(() => window.effect.xAxisMode), 'balance');
                assert.deepEqual(await page.evaluate(() => window.effect.getParameters()), parameters);
                await page.locator('.phase-select-eq-axis-controls input[value="phase"]').check();
            }
            await page.locator('.lock-button').click();
            await control.scrollIntoViewIfNeeded();
            await drag();
            assert.notDeepEqual(await page.evaluate(() => window.effect.getParameters()), parameters);
            await page.close();
        }
    } finally {
        await browser.close();
    }
});

test('mobile keeps the name, toggle, lock and delete together above the other effect actions', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await mount(page, true);
        for (const width of [320, 375, 430, 640]) {
            await page.setViewportSize({ width, height: 900 });
            for (const routed of [false, true]) {
                await page.evaluate(routed => {
                    window.restoreEffect({ name: 'Multiband Compressor with a long effect name', enabled: true,
                        inputBus: routed ? 2 : null, channel: routed ? '1112' : null, parameters: { vl: 0 } });
                }, routed);
                const layout = await page.evaluate(() => {
                    const header = document.querySelector('.pipeline-item-header');
                    const rect = selector => {
                        const bounds = header.querySelector(selector).getBoundingClientRect();
                        return { x: bounds.x, right: bounds.right, top: bounds.top,
                            bottom: bounds.bottom, center: bounds.top + bounds.height / 2 };
                    };
                    return {
                        toggle: rect('.toggle-button'), name: rect('.plugin-name'),
                        lock: rect('.lock-button'), remove: rect('.delete-button'),
                        actions: rect('.plugin-header-actions'),
                        buttons: [...header.querySelector('.plugin-header-actions').children]
                            .map(button => ({ left: button.getBoundingClientRect().left,
                                right: button.getBoundingClientRect().right })),
                        right: header.getBoundingClientRect().right,
                        viewport: window.innerWidth
                    };
                });
                for (const control of [layout.toggle, layout.name, layout.lock, layout.remove]) {
                    assert.ok(Math.abs(control.center - layout.toggle.center) < 2, `First row at ${width}px`);
                }
                assert.ok(layout.name.right <= layout.lock.x);
                assert.ok(layout.lock.right < layout.remove.x);
                assert.ok(layout.remove.right <= layout.right);
                assert.ok(layout.right - layout.remove.right <= 11);
                assert.ok(layout.actions.top >= layout.name.bottom);
                assert.equal(layout.buttons.length, 7);
                for (const button of layout.buttons) {
                    assert.ok(button.left >= 0 && button.right <= layout.viewport, `Action fits at ${width}px`);
                }
            }
        }
    } finally {
        await browser.close();
    }
});
