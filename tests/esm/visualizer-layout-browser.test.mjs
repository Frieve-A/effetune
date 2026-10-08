import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../../css/effetune-theme.css') +
    read('../../css/effetune.css').replace('@import url("effetune-theme.css");', '') +
    read('../../css/effetune-mobile.css') + read('../../css/effetune-library.css');
const viewSource = read('../../js/visualizer/visualizer-history.js').replace(/^export /gm, '') +
    read('../../js/visualizer/visualizer-view.js')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export class VisualizerView', 'window.VisualizerView = class VisualizerView');
const modelSource = read('../../js/visualizer/visualizer-model.js')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '') + '\nwindow.createDefaultLayout = createDefaultLayout; window.createItem = createItem; window.normalizeEffect = normalizeEffect;';
const palettePresetsSource = read('../../js/visualizer/visualizer-palette-presets.js').replace(/^export /gm, '');
const editorSource = read('../../js/ui/range-fill.js').replace(/^export /gm, '') +
    `\nfunction visualizerFieldLabel(row) { return row.querySelector('label')?.textContent.replace(/\\s*\\([^)]*\\):$|:$/g, ''); }\n` +
    read('../../js/visualizer/visualizer-editor.js')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export class VisualizerEditor', 'window.VisualizerEditor = class VisualizerEditor');

test('Visualizer language updates translate the toolbar and open editor while preserving the layout and editing state', async () => {
    const locales = Object.fromEntries(['en', 'ja'].map(locale => [locale,
        JSON.parse(read(`../../js/locales/${locale}.json5`).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))]));
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body class="view-visualizer"><div class="main-container"></div></body>');
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: `
            window.VisualizerPresetStore = class { saveCurrent() {} };
            window.VisualizerSources = class { setLayout() {} };
            window.VisualizerRenderer = class {};
        ` });
        for (const source of [modelSource, palettePresetsSource, editorSource, viewSource]) await page.addScriptTag({ content: source });
        const result = await page.evaluate(locales => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            VisualizerView.prototype.initialize = async () => {};
            const manager = { locale: 'en', t(key) { return locales[this.locale][key] || key; }, audioManager: {} };
            const view = new VisualizerView(manager), editor = view.editor;
            view.setLayout({ ...createDefaultLayout(), items: [createItem('spectrum', 'spectrum')] });
            view.layout.items[0].params.sc = 'linear'; view.changed();
            editor.selection.add('spectrum'); view.setEditing(true);
            editor.zoom = 1.5; editor.panX = 40; editor.panY = -20;
            const quality = view.qualityLabel.querySelector('select');
            quality.value = 'high'; quality.dispatchEvent(new Event('change'));
            view.notice('visualizer.importFailed', 'Could not read the link.');
            const state = () => JSON.stringify({ layout: view.layout, history: view.history.entries,
                historyIndex: view.history.index, selection: [...editor.selection], open: editor.open,
                zoom: editor.zoom, pan: [editor.panX, editor.panY], quality: view.quality,
                qualityValue: quality.value, undoDisabled: view.undoButton.disabled });
            const before = state(), updates = [];
            for (const locale of ['ja', 'en']) {
                manager.locale = locale;
                view.updateUITexts();
                updates.push({ locale, state: state(),
                    preset: [view.presetButton.querySelector('span').textContent, view.presetButton.title, view.presetButton.getAttribute('aria-label')],
                    undo: view.undoButton.title, copy: view.copyButton.getAttribute('aria-label'),
                    quality: view.qualityLabel.querySelector('span').textContent,
                    options: [...quality.options].map(option => option.textContent),
                    navigation: editor.navigationContent.querySelector('h3').textContent,
                    inspector: editor.root.querySelector('h3').textContent,
                    scaleLabel: [...editor.root.querySelectorAll('label')].some(label => label.textContent === locales[locale]['visualizer.param.sc']),
                    scaleValue: [...editor.root.querySelectorAll('select')].find(select => [...select.options].some(option => option.value === 'log-hq')).value,
                    zoomOut: [editor.zoomOutButton.title, editor.zoomOutButton.getAttribute('aria-label')],
                    fit: [editor.fitButton.textContent, editor.fitButton.title, editor.fitButton.getAttribute('aria-label')],
                    hint: view.stage.getAttribute('aria-description'), expand: view.expandButton.title,
                    notice: view.status.textContent, sameQualityControl: quality === view.qualityLabel.querySelector('select') });
            }
            view.setExpanded(true); manager.locale = 'ja'; view.updateUITexts();
            const restore = [view.expandButton.title, view.expandButton.getAttribute('aria-label')];
            view.setExpanded(false); view.setEditing(true);
            return { before, updates, restore, reopened: editor.root.querySelector('h3').textContent };
        }, locales);
        for (const update of result.updates) {
            const t = key => locales[update.locale][key];
            assert.equal(update.state, result.before);
            assert.deepEqual(update.preset, Array(3).fill(t('ui.title.visualizerPresets')));
            assert.equal(update.undo, t('ui.title.undo'));
            assert.equal(update.copy, t('visualizer.copy'));
            assert.equal(update.quality, t('visualizer.quality'));
            assert.deepEqual(update.options, ['auto', 'high', 'low'].map(value => t(`visualizer.quality.${value}`)));
            assert.equal(update.navigation, t('visualizer.layout'));
            assert.equal(update.inspector, t('visualizer.properties'));
            assert.equal(update.scaleLabel, true);
            assert.equal(update.scaleValue, 'linear');
            assert.deepEqual(update.zoomOut, Array(2).fill(t('visualizer.zoomOut')));
            assert.deepEqual(update.fit, Array(3).fill(t('visualizer.fitView')));
            assert.equal(update.hint, t('visualizer.navigationHint'));
            assert.equal(update.expand, t('visualizer.expand'));
            assert.equal(update.notice, t('visualizer.importFailed'));
            assert.equal(update.sameQualityControl, true);
        }
        assert.deepEqual(result.restore, Array(2).fill(locales.ja['visualizer.restore']));
        assert.equal(result.reopened, locales.ja['visualizer.properties']);
    } finally {
        await browser.close();
    }
});

test('Ctrl+wheel over the editing canvas zooms its artboard without changing page zoom', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body><button id="outside">Outside</button><div id="visualizerView"><div class="visualizer-stage-host" style="position:relative;width:800px;height:500px;overflow:clip"><div class="visualizer-stage" style="position:absolute"><canvas style="display:block;width:100%;height:100%"></canvas></div></div></div></body>');
        for (const source of [modelSource, palettePresetsSource, editorSource]) await page.addScriptTag({ content: source });
        await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView'), stage = root.querySelector('.visualizer-stage');
            window.layoutChanges = 0;
            const view = { root, stage, stageHost: root.querySelector('.visualizer-stage-host'),
                canvas: stage.querySelector('canvas'), layout: createDefaultLayout(), updateEditButtons() {},
                t: (_, fallback) => fallback, changed() { window.layoutChanges++; }, commitPending() {}, warn() {} };
            window.editor = new VisualizerEditor(view);
            root.append(editor.navigation, editor.root);
            editor.setOpen(true);
            document.body.style.zoom = '1';
            window.pageZoomCalls = 0;
            // Model Electron's document-level page zoom, which is independent of the browser default action.
            document.addEventListener('wheel', event => {
                if (!event.ctrlKey) return;
                event.preventDefault();
                window.pageZoomCalls++;
                document.body.style.zoom = String(parseFloat(document.body.style.zoom) + .1);
            }, { passive: false });
        });
        const canvas = page.locator('.visualizer-stage canvas'), box = await canvas.boundingBox();
        const cursor = { clientX: Math.round(box.x + box.width * .35), clientY: Math.round(box.y + box.height * .65) };
        const before = await page.evaluate(cursor => ({ zoom: editor.zoom, point: editor.point(cursor),
            layout: JSON.stringify(editor.view.layout) }), cursor);
        await page.mouse.move(cursor.clientX, cursor.clientY);
        const wheel = async () => {
            await page.keyboard.down('Control');
            await page.mouse.wheel(0, -120);
            await page.keyboard.up('Control');
        };
        await wheel();
        await page.waitForFunction(zoom => editor.zoom > zoom, before.zoom);
        const editing = await page.evaluate(cursor => ({ pageZoom: parseFloat(document.body.style.zoom),
            calls: pageZoomCalls, point: editor.point(cursor), zoom: editor.zoom,
            layout: JSON.stringify(editor.view.layout), changes: layoutChanges }), cursor);
        const zoomedBox = await canvas.boundingBox();
        assert.equal(editing.pageZoom, 1);
        assert.equal(editing.calls, 0);
        // Allow the browser's subpixel layout rounding when measuring the cursor anchor.
        assert.ok(Math.abs(editing.point.x - before.point.x) * zoomedBox.width < .5);
        assert.ok(Math.abs(editing.point.y - before.point.y) * zoomedBox.height < .5);
        assert.equal(editing.layout, before.layout);
        assert.equal(editing.changes, 0);

        await page.locator('#outside').hover();
        await wheel();
        await page.waitForFunction(() => pageZoomCalls === 1);
        assert.equal(await page.evaluate(() => parseFloat(document.body.style.zoom)), 1.1);
        await page.evaluate(() => editor.setOpen(false));
        await canvas.hover();
        await wheel();
        await page.waitForFunction(() => pageZoomCalls === 2);
        assert.ok(Math.abs(await page.evaluate(() => parseFloat(document.body.style.zoom)) - 1.2) < 1e-9);
        assert.equal(await page.evaluate(() => editor.zoom), editing.zoom);
    } finally {
        await browser.close();
    }
});

test('Visualizer Edit channel dropdown automatically uses the shared themed list', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body class="view-visualizer"><div id="visualizerView"><div class="visualizer-stage"></div></div></body>');
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: read('../../js/ui/standard-select.js').replace(/^export /gm, '') +
            '\nenableStandardSelects(document);' });
        await page.addScriptTag({ content: modelSource });
        await page.addScriptTag({ content: palettePresetsSource });
        await page.addScriptTag({ content: editorSource });
        await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView');
            const layout = createDefaultLayout();
            const view = { root, stage: root.querySelector('.visualizer-stage'), layout, updateEditButtons() {},
                t: (_, fallback) => fallback, changed() {}, notice() {}, commitPending() {}, warn() {} };
            window.editor = new VisualizerEditor(view);
            root.append(editor.navigation, editor.root);
            editor.selection = new Set([layout.items[0].id]);
            editor.setOpen(true);
        });
        const channel = page.locator('.visualizer-editor-inspector .parameter-row')
            .filter({ has: page.locator('label', { hasText: /^Channel$/ }) }).locator('select');
        await channel.click();
        const list = page.locator('.standard-select-list:not([hidden])');
        assert.equal(await list.count(), 1);
        assert.equal(await list.evaluate(list => list.scrollHeight > list.clientHeight), true);
        await list.locator('.standard-select-option').filter({ hasText: /^R$/ }).click();
        assert.equal(await page.evaluate(() => editor.view.layout.items[0].channel), 'R');
        await page.evaluate(() => editor.render());
        await channel.focus();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Home');
        await page.keyboard.press('Enter');
        assert.equal(await page.evaluate(() => editor.view.layout.items[0].channel), null);
        assert.equal(await channel.inputValue(), '');
    } finally {
        await browser.close();
    }
});

test('Visualizer gradients preview every preset before applying, reversing, and saving radial direction', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body class="view-visualizer"><div id="visualizerView"><div class="visualizer-stage"></div></div></body>');
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: read('../../js/ui/standard-select.js').replace(/^export /gm, '') +
            '\nenableStandardSelects(document);' });
        for (const source of [modelSource, palettePresetsSource, editorSource]) await page.addScriptTag({ content: source });
        await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView'), layout = createDefaultLayout();
            layout.items[0].palette.mode = 'gradient';
            window.savedPalettes = [];
            const view = { root, stage: root.querySelector('.visualizer-stage'), layout, updateEditButtons() {},
                t: (_, fallback) => fallback, commitPending() {},
                changed() { savedPalettes.push(structuredClone(layout.items[0].palette)); } };
            window.editor = new VisualizerEditor(view);
            root.append(editor.navigation, editor.root);
            editor.selection = new Set([layout.items[0].id]); editor.setOpen(true);
        });
        const gradient = page.getByLabel('Gradient', { exact: true });
        const list = page.locator('.standard-select-list:not([hidden])');
        const initial = await page.evaluate(() => structuredClone(editor.view.layout.items[0].palette));
        await gradient.click();
        const previews = await list.locator('.standard-select-option').evaluateAll(rows => rows.map(row => {
            const preview = row.querySelector('.standard-select-gradient-preview');
            const rect = preview.getBoundingClientRect();
            return { name: row.textContent, image: getComputedStyle(preview).backgroundImage,
                width: rect.width, height: rect.height, hiddenFromReader: preview.getAttribute('aria-hidden') };
        }));
        assert.equal(previews.length, 24);
        assert.ok(previews.every(preview => preview.width > 0 && preview.height > 0 &&
            preview.image.startsWith('linear-gradient(') && preview.hiddenFromReader === 'true'));
        assert.equal(await list.locator('.standard-select-option').evaluateAll(rows =>
            rows.every(row => row.scrollWidth <= row.clientWidth)), true, 'Preset names fit beside their previews');
        assert.ok(previews.some(preview => preview.name === 'Gold' && preview.image.includes('rgb(212, 175, 55)')));
        await list.getByRole('option', { name: 'Gold', exact: true }).click();
        assert.deepEqual(await page.evaluate(() => editor.view.layout.items[0].palette), initial);
        assert.equal(await page.evaluate(() => savedPalettes.length), 0);
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        assert.equal(await gradient.inputValue(), 'gold', 'Applying keeps the chosen preset in the dropdown');
        const gold = await page.evaluate(() => editor.view.layout.items[0].palette.stops);
        assert.deepEqual(gold, [{ pos: 0, color: '#8c5a14' }, { pos: .5, color: '#d4af37' }, { pos: 1, color: '#fff1a8' }]);
        await page.getByRole('button', { name: 'Reverse gradient', exact: true }).click();
        assert.deepEqual(await page.evaluate(() => editor.view.layout.items[0].palette.stops), gold.map(stop =>
            ({ pos: 1 - stop.pos, color: stop.color })).reverse());
        assert.equal(await page.evaluate(() => savedPalettes.length), 2);
        await page.getByRole('radio', { name: 'Radial', exact: true }).check();
        assert.equal(await page.evaluate(() => savedPalettes.at(-1).direction), 'radial');
        assert.equal(await gradient.inputValue(), 'gold', 'Reversing and changing direction preserve the preset choice');
        await gradient.focus();
        await page.keyboard.press('r');
        await page.keyboard.press('Enter');
        assert.equal(await gradient.inputValue(), 'rainbow');
        assert.equal(await page.evaluate(() => savedPalettes.length), 3, 'Choosing a preset does not apply it');
        await page.getByRole('button', { name: 'Apply', exact: true }).click();
        assert.equal(await gradient.inputValue(), 'rainbow', 'Applying a keyboard choice also keeps the preset selected');
        const applied = await page.evaluate(() => structuredClone(editor.view.layout.items[0].palette));
        const reverseMotion = page.getByLabel('Reverse color motion', { exact: true });
        assert.equal(await reverseMotion.count(), 0);
        await page.getByRole('radio', { name: 'hue', exact: true }).check();
        await reverseMotion.check();
        assert.equal(await page.evaluate(() => savedPalettes.at(-1).motion.reverse), true);
        await page.getByRole('radio', { name: 'scroll', exact: true }).check();
        assert.equal(await reverseMotion.isChecked(), true);
        await page.getByRole('radio', { name: 'none', exact: true }).check();
        assert.equal(await reverseMotion.count(), 0);
        await page.getByRole('radio', { name: 'hue', exact: true }).check();
        assert.equal(await reverseMotion.isChecked(), true);
        await reverseMotion.uncheck();
        const saved = await page.evaluate(() => savedPalettes.at(-1));
        assert.deepEqual(saved.motion, { mode: 'hue', speed: applied.motion.speed, reverse: false });
        assert.deepEqual(saved.stops, applied.stops);
    } finally {
        await browser.close();
    }
});

test('Visualizer item arrows move one list position and layer buttons move to either end', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body><div id="visualizerView"><div class="visualizer-stage"></div></div></body>');
        await page.addScriptTag({ content: modelSource });
        await page.addScriptTag({ content: palettePresetsSource });
        await page.addScriptTag({ content: editorSource });
        const result = await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true,
                value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView');
            const layout = window.createDefaultLayout();
            layout.items = ['back', 'middle', 'selected', 'front'].map(id => window.createItem('title', id));
            const savedOrders = [];
            const view = { root, stage: root.querySelector('.visualizer-stage'), layout, updateEditButtons() {},
                t: (_, fallback) => fallback,
                changed() { savedOrders.push(layout.items.map(item => item.id)); }, commitPending() {} };
            const editor = new window.VisualizerEditor(view);
            root.append(editor.navigation, editor.root);
            editor.selection = new Set(['selected']); editor.setOpen(true);
            const state = () => ({
                order: layout.items.map(item => item.id),
                selection: [...editor.selection].join(),
                disabled: [...editor.root.querySelectorAll('.visualizer-editor-actions button')]
                    .slice(0, 4).map(button => button.disabled),
                activeLabel: editor.navigation.querySelector('.visualizer-item-list .active').textContent,
                heading: editor.root.querySelector('.visualizer-item-name').textContent
            });
            const labels = [...editor.root.querySelectorAll('.visualizer-editor-actions button')]
                .map(button => [button.title, button.getAttribute('aria-label')]);
            const states = [state()];
            for (const selector of ['.move-up-button', '.move-down-button', '.bring-to-front-button',
                '.move-down-button', '.send-to-back-button', '.move-up-button']) {
                editor.root.querySelector(`.visualizer-editor-actions ${selector}`).click();
                states.push(state());
            }
            layout.items = [layout.items[0]]; editor.render();
            const single = state();
            editor.clearSelection(); editor.render();
            return { states, single, savedOrders, labels,
                backgroundActions: editor.root.querySelectorAll('.visualizer-editor-actions button').length };
        });
        const initial = ['back', 'middle', 'selected', 'front'];
        const movedUp = ['back', 'selected', 'middle', 'front'];
        const movedFront = ['back', 'middle', 'front', 'selected'];
        const movedBack = ['selected', 'back', 'middle', 'front'];
        assert.deepEqual(result.states.map(state => state.order),
            [initial, movedUp, initial, movedFront, movedFront, movedBack, movedBack]);
        assert.deepEqual(result.savedOrders, [movedUp, initial, movedFront, movedBack]);
        assert.deepEqual(result.states.map(state => state.disabled), [
            [false, false, false, false], [false, false, false, false], [false, false, false, false],
            [false, true, true, false], [false, true, true, false], [true, false, false, true], [true, false, false, true]
        ]);
        assert.ok(result.states.every(state => state.selection === 'selected' && state.activeLabel === state.heading));
        assert.deepEqual(result.single.disabled, [true, true, true, true]);
        assert.equal(result.backgroundActions, 0);
        assert.deepEqual(result.labels, ['Move up', 'Move down', 'Bring to front', 'Send to back', 'Delete']
            .map(label => [label, label]));
    } finally {
        await browser.close();
    }
});

test('Multi-selection edits every same-type item, reorders the group, and shows alignment buttons', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body><div id="visualizerView"><div class="visualizer-stage"></div></div></body>');
        await page.addScriptTag({ content: modelSource });
        await page.addScriptTag({ content: palettePresetsSource });
        await page.addScriptTag({ content: editorSource });
        const result = await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView');
            const layout = window.createDefaultLayout();
            layout.items = ['a', 'b', 'c'].map(id => window.createItem('spectrum', id));
            layout.items.push(window.createItem('title', 't'));
            let changes = 0;
            const view = { root, stage: root.querySelector('.visualizer-stage'), layout, updateEditButtons() {},
                t: (_, fallback) => fallback, changed() { changes++; }, commitPending() {} };
            const editor = new window.VisualizerEditor(view);
            root.append(editor.navigation, editor.root);
            editor.selection = new Set(['a', 'b']); editor.setOpen(true);
            const panel = () => ({
                order: layout.items.map(item => item.id).join(),
                disabled: [...editor.root.querySelectorAll('.visualizer-editor-actions button')].slice(0, 4).map(button => button.disabled),
                align: [...editor.root.querySelectorAll('.visualizer-align-actions button')].map(button => button.title),
                note: !!editor.root.querySelector('.visualizer-bulk-note'),
                settings: editor.root.querySelectorAll('.parameter-row').length > 0
            });
            const same = panel();
            const channel = [...editor.root.querySelectorAll('.parameter-row')]
                .find(row => row.querySelector('label')?.textContent === 'Channel').querySelector('select');
            channel.value = 'R'; channel.dispatchEvent(new Event('change'));
            const channels = layout.items.map(item => item.channel);
            const editChanges = changes;
            editor.root.querySelector('.visualizer-editor-actions .move-down-button').click();
            const moved = panel();
            editor.root.querySelector('.visualizer-align-actions .align-right-button').click();
            editor.selection = new Set(['a', 't']); editor.render();
            return { same, channels, editChanges, moved, changes, mixed: panel() };
        });
        const align = ['Align left edges', 'Align horizontal centers', 'Align right edges', 'Align top edges',
            'Align vertical centers', 'Align bottom edges'];
        assert.deepEqual(result.same, { order: 'a,b,c,t', disabled: [true, false, false, true], align, note: true, settings: true });
        assert.deepEqual(result.channels, ['R', 'R', null, null]);
        assert.equal(result.editChanges, 1);
        assert.deepEqual(result.moved, { ...result.same, order: 'c,a,b,t', disabled: [false, false, false, false] });
        assert.equal(result.changes, 3);
        assert.deepEqual(result.mixed, { order: 'c,a,b,t', disabled: [false, false, false, false], align, note: false, settings: false });
    } finally {
        await browser.close();
    }
});

test('Rainbow stop sliders retain fractional positions and update the saved and drawn gradient', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body><div id="visualizerView"><div class="visualizer-stage"></div></div></body>');
        await page.addScriptTag({ content: modelSource + '\nwindow.normalizeLayout = normalizeLayout;' });
        await page.addScriptTag({ content: read('../../js/visualizer/visualizer-effects.js').replace(/\bexport /g, '') +
            '\nwindow.paletteGradient = paletteGradient;' });
        await page.addScriptTag({ content: palettePresetsSource });
        await page.addScriptTag({ content: editorSource });
        const result = await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true,
                value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView');
            const layout = createDefaultLayout();
            layout.items[0].palette.mode = 'gradient';
            const view = { root, stage: root.querySelector('.visualizer-stage'), layout, updateEditButtons() {},
                t: (_, fallback) => fallback, changed() {}, notice() {}, commitPending() {}, warn() {} };
            const editor = new VisualizerEditor(view);
            editor.selection = new Set([layout.items[0].id]);
            editor.setOpen(true);
            const dbRange = [...editor.root.querySelectorAll('.visualizer-field')]
                .find(row => visualizerFieldLabel(row) === 'DB Range').querySelector('input').value;
            const preset = [...editor.root.querySelectorAll('select')]
                .find(select => [...select.options].some(option => option.value === 'rainbow'));
            const presetCount = preset.options.length;
            preset.value = 'rainbow';
            preset.closest('.visualizer-select-action-row').querySelector('button').click();
            const sliders = [...editor.root.querySelectorAll('.visualizer-stop > .visualizer-field input[type="range"]')];
            const initial = sliders.map(input => ({ value: Number(input.value), min: input.min, max: input.max, step: input.step }));
            const draw = () => {
                const canvas = document.createElement('canvas'); canvas.width = 100; canvas.height = 1;
                const context = canvas.getContext('2d');
                context.fillStyle = paletteGradient(context, layout.items[0].palette, 100, 0);
                context.fillRect(0, 0, 100, 1);
                return [...context.getImageData(20, 0, 1, 1).data];
            };
            const before = draw();
            sliders[1].value = '.3';
            sliders[1].dispatchEvent(new Event('input', { bubbles: true }));
            const after = draw();
            const saved = normalizeLayout(layout).items[0].palette.stops[1].pos;
            const stops = layout.items[0].palette.stops.map(stop => stop.pos);
            preset.value = GRADIENT_PRESETS[3].id;
            preset.closest('.visualizer-select-action-row').querySelector('button').click();
            const expandedPreset = layout.items[0].palette.stops.every((stop, index) =>
                stop.color === GRADIENT_PRESETS[3].colors[index] &&
                stop.pos === (GRADIENT_PRESETS[3].colors.length === 1 ? 0 : index / (GRADIENT_PRESETS[3].colors.length - 1)));
            editor.clearSelection();
            const stereo = createItem('stereo'); layout.items.push(stereo);
            editor.selection = new Set([stereo.id]); editor.render();
            const windowRange = [...editor.root.querySelectorAll('.visualizer-field')]
                .find(row => visualizerFieldLabel(row) === 'Window').querySelector('input').value;
            return { initial, stops, edited: sliders[1].value, saved, before, after, dbRange, windowRange,
                presetCount, expandedPreset };
        });
        assert.deepEqual(result.initial.map(stop => stop.value), [0, .2, .4, .6, .8, 1]);
        assert.ok(result.initial.every(stop => stop.min === '0' && stop.max === '1' && stop.step === '0.01'));
        assert.deepEqual(result.stops, [0, .3, .4, .6, .8, 1]);
        assert.equal(result.edited, '0.3');
        assert.equal(result.saved, .3);
        assert.equal(result.presetCount, 24);
        assert.equal(result.expandedPreset, true);
        assert.notDeepEqual(result.after, result.before);
        assert.equal(result.dbRange, '-96');
        assert.equal(result.windowRange, '0.1');
    } finally {
        await browser.close();
    }
});

test('Editor additions respect saved item and effect limits and recover after deletion', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body><div id="visualizerView"><div class="visualizer-stage"></div></div></body>');
        await page.addScriptTag({ content: modelSource + '\nwindow.normalizeLayout = normalizeLayout;' });
        await page.addScriptTag({ content: palettePresetsSource });
        await page.addScriptTag({ content: editorSource });
        const result = await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true,
                value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView');
            const layout = createDefaultLayout();
            layout.items = Array.from({ length: 63 }, () => createItem('title'));
            const view = { root, stage: root.querySelector('.visualizer-stage'), layout, updateEditButtons() {},
                t: (_, fallback) => fallback, changed() {}, notice() {}, commitPending() {}, warn() {} };
            const editor = new VisualizerEditor(view);
            editor.setOpen(true);
            const addItem = () => editor.navigation.querySelector('.visualizer-navigation-add-row button');
            addItem().click();
            const itemDisabled = addItem().disabled;
            addItem().click();
            addItem().dispatchEvent(new Event('click'));
            const duplicateBlocked = editor.insertCopies([layout.items[0]], true) === null;
            const itemLimit = layout.items.length;
            editor.deleteSelected();
            const itemReenabled = !addItem().disabled;
            addItem().click();
            const itemRestored = layout.items.length;
            const effects = [];
            for (const target of [layout.items.at(-1), layout.background]) {
                target.effects = Array.from({ length: 15 }, () => normalizeEffect({ type: 'opacity' }));
                editor.selection = new Set(target.id ? [target.id] : []);
                editor.render();
                const addEffect = () => [...editor.root.querySelectorAll('.visualizer-select-action-row')]
                    .find(row => row.querySelector('select option[value="opacity"]')).querySelector('button');
                addEffect().click();
                const disabled = addEffect().disabled;
                addEffect().click();
                addEffect().dispatchEvent(new Event('click'));
                const limit = target.effects.length;
                editor.root.querySelector('.visualizer-effect-actions .delete-button').click();
                const reenabled = !addEffect().disabled;
                addEffect().click();
                effects.push({ disabled, limit, reenabled, restored: target.effects.length });
            }
            return { itemDisabled, duplicateBlocked, itemLimit, itemReenabled, itemRestored, effects,
                layout, restored: normalizeLayout(JSON.parse(JSON.stringify(layout))) };
        });
        assert.equal(result.itemDisabled && result.duplicateBlocked && result.itemReenabled, true);
        assert.equal(result.itemLimit, 64);
        assert.equal(result.itemRestored, 64);
        assert.deepEqual(result.effects, Array(2).fill({ disabled: true, limit: 16, reenabled: true, restored: 16 }));
        assert.deepEqual(result.restored, result.layout);
    } finally {
        await browser.close();
    }
});

test('Chroma octave sliders retain pointer and keyboard interaction while synchronizing crossed bounds', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body><div id="visualizerView"><div class="visualizer-stage"></div></div></body>');
        await page.addScriptTag({ content: modelSource + '\nwindow.normalizeLayout = normalizeLayout;' });
        await page.addScriptTag({ content: palettePresetsSource });
        await page.addScriptTag({ content: editorSource });
        await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true,
                value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView');
            const layout = createDefaultLayout();
            const item = createItem('chroma');
            item.params.hi = 3;
            layout.items = [item];
            const view = { root, stage: root.querySelector('.visualizer-stage'), layout, updateEditButtons() {},
                t: (_, fallback) => fallback, changed() {}, notice() {}, commitPending() {}, warn() {} };
            const editor = new VisualizerEditor(view);
            root.append(editor.root);
            editor.selection = new Set([item.id]);
            editor.setOpen(true);
            const fields = [...editor.root.querySelectorAll('.visualizer-field')];
            const slider = label => fields.find(row => visualizerFieldLabel(row) === label.replace(/\s*\([^)]*\)$/, '')).querySelector('input');
            const low = slider('Lowest Octave'), high = slider('Highest Octave');
            low.style.width = '400px';
            window.__octaves = { layout, low, high, inputCount: 0, refreshed: [] };
            low.addEventListener('input', () => window.__octaves.inputCount++);
            window.uiManager = { refreshRangeFillStyling: input => window.__octaves.refreshed.push(input.value) };
        });
        const readState = () => page.evaluate(() => {
            const { layout, low, high, inputCount, refreshed } = window.__octaves;
            return { values: [layout.items[0].params.lo, layout.items[0].params.hi],
                inputs: [Number(low.value), Number(high.value)],
                outputs: [low.nextElementSibling.value, high.nextElementSibling.value],
                connected: low.isConnected && high.isConnected, inputCount, refreshed,
                saved: normalizeLayout(JSON.parse(JSON.stringify(layout))).items[0].params };
        });
        await page.getByRole('slider', { name: 'Lowest Octave:', exact: true }).focus();
        for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
        const raised = await readState();
        assert.deepEqual(raised.values, [5, 5]);
        assert.deepEqual(raised.inputs, [5, 5]);
        assert.deepEqual(raised.outputs, ['5', '5']);
        await page.getByRole('slider', { name: 'Highest Octave:', exact: true }).focus();
        for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowLeft');
        const lowered = await readState();
        assert.deepEqual(lowered.values, [2, 2]);
        assert.deepEqual(lowered.inputs, [2, 2]);
        assert.deepEqual(lowered.outputs, ['2', '2']);
        const box = await page.getByRole('slider', { name: 'Lowest Octave:', exact: true }).boundingBox();
        await page.mouse.move(box.x + box.width * .15, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(box.x + box.width * .95, box.y + box.height / 2, { steps: 12 });
        await page.mouse.up();
        const dragged = await readState();
        assert.equal(dragged.connected, true);
        assert.ok(dragged.inputCount >= lowered.inputCount + 3);
        assert.ok(dragged.values[0] >= 7);
        assert.deepEqual(dragged.inputs, dragged.values);
        assert.deepEqual(dragged.outputs, dragged.values.map(String));
        assert.deepEqual([dragged.saved.lo, dragged.saved.hi], dragged.values);
        assert.ok(await page.evaluate(() => window.__octaves.high.style.getPropertyValue('--et-range-fill') !== ''));
    } finally {
        await browser.close();
    }
});

test('Trail Feedback sliders save zoom, rotation, and horizontal and vertical flow', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body><div id="visualizerView"><div class="visualizer-stage"></div></div></body>');
        await page.addScriptTag({ content: modelSource + '\nwindow.normalizeLayout = normalizeLayout;' });
        await page.addScriptTag({ content: palettePresetsSource });
        await page.addScriptTag({ content: editorSource });
        const result = await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true,
                value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView');
            const layout = createDefaultLayout();
            layout.items[0].effects = [normalizeEffect({ type: 'trail-feedback' })];
            const view = { root, stage: root.querySelector('.visualizer-stage'), layout, updateEditButtons() {},
                t: (_, fallback) => fallback, changed() {}, notice() {}, commitPending() {}, warn() {} };
            const editor = new VisualizerEditor(view);
            editor.selection = new Set([layout.items[0].id]);
            editor.setOpen(true);
            const slider = label => [...editor.root.querySelectorAll('.visualizer-field')]
                .find(row => visualizerFieldLabel(row) === label.replace(/\s*\([^)]*\)$/, ''))?.querySelector('input');
            const inputs = [slider('Zoom'), slider('Rotation angle (°)'),
                slider('Horizontal flow'), slider('Vertical flow')];
            const types = inputs.map(input => input?.type);
            for (const [input, value] of inputs.map((input, index) => [input, [-1.5, -2, .5, -.6][index]])) {
                input.value = String(value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return { types, ranges: inputs.map(input => [input.min, input.max, input.step]),
                values: inputs.map(input => input.nextElementSibling?.value),
                effect: normalizeLayout(layout).items[0].effects[0] };
        });
        assert.deepEqual(result.types, ['range', 'range', 'range', 'range']);
        assert.deepEqual(result.ranges, [['-2', '2', '0.05'], ['-3', '3', '0.05'],
            ['-1', '1', '0.05'], ['-1', '1', '0.05']]);
        assert.deepEqual(result.values, ['-1.5', '-2', '0.5', '-0.6']);
        assert.deepEqual([result.effect.zoom, result.effect.angle, result.effect.flowX, result.effect.flowY],
            [-1.5, -2, .5, -.6]);
    } finally {
        await browser.close();
    }
});

test('Visualizer expand icon is centered and names both view-area actions', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 860, height: 600 } });
        await page.setContent('<!doctype html><body class="view-visualizer"><div class="main-container"></div></body>');
        await page.addStyleTag({ content: `${css}\n* { transition: none !important; }` });
        await page.addScriptTag({ content: `
            window.createDefaultLayout = () => ({ aspect: '16:9' });
            window.VisualizerPresetStore = class {};
            window.VisualizerSources = class {};
            window.VisualizerRenderer = class {};
            window.VisualizerEditor = class {
                constructor() {
                    this.navigation = document.createElement('aside'); this.root = document.createElement('aside');
                    this.navigationContent = document.createElement('div');
                    this.navigation.appendChild(this.navigationContent);
                    this.open = false; this.selection = new Set();
                }
                setOpen(open) { this.open = open; }
                updateUITexts() {}
            };
        ` });
        await page.addScriptTag({ content: viewSource });
        const result = await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null } });
            window.VisualizerView.prototype.initialize = async () => {};
            const view = new window.VisualizerView({ t: key => key, audioManager: {}, layoutMode: {} });
            view.showControls = () => {};
            const button = view.expandButton, svg = button.querySelector('svg');
            const rect = element => element.getBoundingClientRect();
            const buttonRect = rect(button), svgRect = rect(svg);
            const centered = Math.abs((buttonRect.left + buttonRect.right - svgRect.left - svgRect.right) / 2) < 1 &&
                Math.abs((buttonRect.top + buttonRect.bottom - svgRect.top - svgRect.bottom) / 2) < 1;
            const initial = [button.title, button.getAttribute('aria-label'), button.getAttribute('aria-pressed')];
            let presetOpens = 0;
            view.openPresets = () => { presetOpens++; return Promise.resolve(); };
            view.presetButton.click();
            const toolbarOrder = view.toolbar.children[0] === view.editButton &&
                [view.presetButton, view.shareButton, view.importButton, view.qualityLabel]
                    .every((control, index, controls) => !index || controls[index - 1].nextElementSibling === control) &&
                view.qualityLabel === view.toolbar.lastElementChild;
            const toolbarButtons = [view.presetButton, view.editButton].map(control => {
                const icon = control.querySelector('svg'), label = control.querySelector('span');
                const bounds = control.getBoundingClientRect(), iconBounds = icon.getBoundingClientRect();
                const labelBounds = label.getBoundingClientRect();
                return { markup: control.firstElementChild === icon && icon.nextElementSibling === label,
                    size: [iconBounds.width, iconBounds.height],
                    aligned: Math.abs((bounds.top + bounds.bottom - iconBounds.top - iconBounds.bottom) / 2) < 1 &&
                        Math.abs((labelBounds.top + labelBounds.bottom - iconBounds.top - iconBounds.bottom) / 2) < 2,
                    gap: labelBounds.left - iconBounds.right };
            });
            const editIcon = view.editButton.querySelector('svg');
            view.editButton.click(); const editOpened = view.editor.open;
            const playerActive = document.createElement('button');
            playerActive.className = 'player-button'; playerActive.dataset.active = 'true';
            document.body.appendChild(playerActive);
            const appearance = element => {
                const style = getComputedStyle(element);
                return [style.backgroundImage, style.borderTopColor, style.color, style.boxShadow];
            };
            const editMatchesPlayer = JSON.stringify(appearance(view.editButton)) === JSON.stringify(appearance(playerActive));
            playerActive.remove();
            view.editButton.click(); const editClosed = !view.editor.open && view.editButton.querySelector('svg') === editIcon;
            button.click();
            const expanded = [button.title, button.getAttribute('aria-label'), button.getAttribute('aria-pressed'),
                document.body.classList.contains('visualizer-expanded')];
            button.click();
            const restored = [button.title, button.getAttribute('aria-label'), button.getAttribute('aria-pressed'),
                document.body.classList.contains('visualizer-expanded')];
            return { centered, decorative: svg.getAttribute('aria-hidden'), initial, expanded, restored,
                toolbarButtons, toolbarOrder, presetOpens, editOpened, editClosed, editMatchesPlayer };
        });
        assert.equal(result.centered, true);
        assert.equal(result.decorative, 'true');
        assert.equal(result.presetOpens, 1);
        assert.equal(result.toolbarOrder, true);
        assert.equal(result.editOpened && result.editClosed, true);
        assert.equal(result.editMatchesPlayer, true);
        assert.ok(result.toolbarButtons.every(value => value.markup && value.aligned &&
            value.size[0] === 16 && value.size[1] === 16 && value.gap >= 5), JSON.stringify(result.toolbarButtons));
        assert.deepEqual(result.initial, ['Fill app window', 'Fill app window', 'false']);
        assert.deepEqual(result.expanded, ['Restore Visualizer size', 'Restore Visualizer size', 'true', true]);
        assert.deepEqual(result.restored, ['Fill app window', 'Fill app window', 'false', false]);
    } finally {
        await browser.close();
    }
});

test('Visualizer fills the available width on first display and after leaving expanded mode', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.setContent(`<!doctype html><body class="view-visualizer">
            <div class="title-container">EffeTune</div>
            <div class="main-container" style="width:1100px;height:400px"></div>
            <section id="visualizerView"><div class="visualizer-toolbar"><button>Visualizer Presets</button><label class="visualizer-quality-label"><span>Quality</span><select></select></label></div>
                <div class="visualizer-workspace"><aside class="visualizer-editor visualizer-editor-navigation" hidden><div class="visualizer-navigation-content"></div></aside><div class="visualizer-stage-host">
                    <div class="visualizer-stage" style="aspect-ratio:16/9"><canvas></canvas></div>
                </div><aside class="visualizer-editor visualizer-editor-inspector" hidden></aside></div>
            </section></body>`);
        await page.addStyleTag({ content: `${css}\n* { transition: none !important; }` });
        await page.addScriptTag({ content: viewSource });
        const sizes = await page.evaluate(() => {
            const stageHost = document.querySelector('.visualizer-stage-host');
            const stage = document.querySelector('.visualizer-stage');
            const root = document.querySelector('#visualizerView');
            const navigation = document.querySelector('.visualizer-editor-navigation');
            const inspector = document.querySelector('.visualizer-editor-inspector');
            const qualityLabel = document.querySelector('.visualizer-quality-label');
            const toolbar = document.querySelector('.visualizer-toolbar');
            const view = Object.assign(Object.create(window.VisualizerView.prototype), {
                visible: true, layout: { aspect: '16:9' }, root, toolbar, qualityLabel, stageHost, stage,
                canvas: stage.querySelector('canvas'), status: {},
                renderer: { quality: 0, draw() {} }, sources: { getStatus: () => 'ready' },
                uiManager: { t: key => key }, editor: { open: false, navigation, navigationContent: navigation.firstElementChild,
                    setOpen(open) { this.open = open; navigation.hidden = !open; inspector.hidden = !open; root.classList.toggle('is-editing', open); } },
                editButton: { setAttribute() {} }, expandButton: { setAttribute() {} }, showControls() {}
            });
            window.requestAnimationFrame = () => 1;
            const measure = () => {
                view.frame(0);
                const host = stageHost.getBoundingClientRect(), rect = stage.getBoundingClientRect();
                return { hostWidth: host.width, hostHeight: host.height, width: rect.width, height: rect.height,
                    center: rect.x + rect.width / 2, hostCenter: host.x + host.width / 2 };
            };
            const initial = measure();
            view.setEditing(true);
            const editing = measure();
            const navigationRect = navigation.getBoundingClientRect();
            const hostRect = stageHost.getBoundingClientRect();
            const inspectorRect = inspector.getBoundingClientRect();
            const editingOrder = navigationRect.right < hostRect.left && hostRect.right < inspectorRect.left;
            const qualityInNavigation = qualityLabel.parentNode === navigation;
            view.setEditing(false);
            const qualityReturned = qualityLabel.parentNode === toolbar;
            view.setExpanded(true);
            const expanded = measure();
            view.setExpanded(false);
            const restored = measure();
            document.body.classList.remove('view-visualizer');
            const effectsWidth = document.querySelector('.main-container').getBoundingClientRect().width;
            const effectsBodyDisplay = getComputedStyle(document.body).display;
            document.body.classList.add('view-library');
            const libraryWidth = document.querySelector('.main-container').getBoundingClientRect().width;
            const libraryBodyDisplay = getComputedStyle(document.body).display;
            document.body.classList.remove('view-library');
            document.body.classList.add('view-visualizer');
            const reopened = measure();
            document.body.style.zoom = '0.8';
            const zoomed = measure();
            document.body.style.zoom = '';
            document.body.classList.add('layout-mobile');
            const mobile = measure();
            view.setEditing(true);
            const mobileEditing = measure();
            const mobileOrder = navigation.getBoundingClientRect().bottom < stageHost.getBoundingClientRect().top &&
                stageHost.getBoundingClientRect().bottom < inspector.getBoundingClientRect().top;
            view.setEditing(false);
            document.body.classList.remove('layout-mobile');
            document.body.classList.add('layout-mini-player');
            const mini = measure();
            return { initial, editing, editingOrder, qualityInNavigation, qualityReturned, expanded, restored, reopened, zoomed, mobile, mobileEditing, mobileOrder, mini,
                effectsWidth, effectsBodyDisplay, libraryWidth, libraryBodyDisplay };
        });
        assert.equal(sizes.initial.hostWidth, 1240, JSON.stringify(sizes));
        assert.equal(sizes.editingOrder, true, JSON.stringify(sizes));
        assert.equal(sizes.qualityInNavigation, true);
        assert.equal(sizes.qualityReturned, true);
        assert.ok(sizes.editing.hostWidth < sizes.initial.hostWidth);
        assert.ok(sizes.editing.hostWidth > 300);
        assert.ok(Math.abs(sizes.editing.width / sizes.editing.height - 16 / 9) < .001);
        assert.ok(Math.abs(sizes.editing.center - sizes.editing.hostCenter) < 1);
        for (const size of [sizes.initial, sizes.restored, sizes.reopened, sizes.zoomed, sizes.mobile]) {
            assert.ok(Math.abs(size.width / size.height - 16 / 9) < 0.001);
            assert.ok(Math.abs(size.width - Math.min(size.hostWidth, size.hostHeight * 16 / 9)) < 1);
            assert.ok(Math.abs(size.center - size.hostCenter) < 1);
        }
        assert.deepEqual(sizes.restored, sizes.initial);
        assert.deepEqual(sizes.reopened, sizes.initial);
        assert.ok(Math.abs(sizes.zoomed.hostWidth - (1280 - 40 * 0.8)) < 1);
        assert.equal(sizes.effectsWidth, 1100);
        assert.equal(sizes.effectsBodyDisplay, 'inline-block');
        assert.equal(sizes.libraryWidth, 1100);
        assert.equal(sizes.libraryBodyDisplay, 'inline-block');
        assert.equal(sizes.mobile.hostWidth, 1264);
        assert.equal(sizes.mobileOrder, true, JSON.stringify(sizes));
        assert.ok(Math.abs(sizes.mobileEditing.width / sizes.mobileEditing.height - 16 / 9) < .001);
        for (const size of [sizes.expanded, sizes.mini]) {
            assert.equal(size.hostWidth, 1280);
            assert.ok(Math.abs(size.width - Math.max(size.hostWidth, size.hostHeight * 16 / 9)) < 1);
        }
    } finally {
        await browser.close();
    }
});

test('Mobile Visualizer expansion hides the bottom tabs and leaves its restore button reachable', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
        await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
            <body class="layout-mobile view-visualizer"><section id="visualizerView">
                <div class="visualizer-toolbar">Edit</div><div class="visualizer-workspace">
                    <div class="visualizer-stage-host show-controls"><button class="visualizer-expand">Restore</button></div>
                </div></section><button class="mobile-plugin-fab">+</button>
                <nav class="mobile-bottom-nav">Player Library Effects</nav></body>`);
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: viewSource });
        const result = await page.evaluate(() => {
            const root = document.querySelector('#visualizerView');
            const button = root.querySelector('.visualizer-expand');
            const tabs = document.querySelector('.mobile-bottom-nav');
            const fab = document.querySelector('.mobile-plugin-fab');
            const view = Object.assign(Object.create(window.VisualizerView.prototype), {
                expanded: false, historyDepth: 1, expandButton: button,
                uiManager: { t: key => key }, setEditing() {}, showControls() {}
            });
            const visibleBefore = getComputedStyle(tabs).display !== 'none';
            view.setExpanded(true, { fromHistory: true });
            const bounds = button.getBoundingClientRect();
            const exposed = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) === button;
            const hiddenExpanded = getComputedStyle(tabs).display === 'none';
            view.setExpanded(false, { fromHistory: true });
            return { visibleBefore, hiddenExpanded, exposed,
                fabHidden: getComputedStyle(fab).display === 'none',
                visibleRestored: getComputedStyle(tabs).display !== 'none' };
        });
        assert.deepEqual(result, { visibleBefore: true, hiddenExpanded: true, exposed: true,
            fabHidden: true, visibleRestored: true });
    } finally {
        await browser.close();
    }
});

test('Mobile Visualizer Edit fits the artboard and keeps a page scroll lane outside its touch viewport', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true });
        await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
            <body class="layout-mobile view-visualizer"><div class="title-container">EffeTune</div>
            <div class="main-container"></div><section id="visualizerView">
                <div class="visualizer-toolbar">Edit</div><div class="visualizer-workspace">
                    <div class="visualizer-stage-host"><div class="visualizer-stage"><canvas></canvas></div></div>
                </div></section><nav class="mobile-bottom-nav">Player Library Effects</nav></body>`);
        await page.addStyleTag({ content: css });
        for (const source of [modelSource, palettePresetsSource, editorSource, viewSource]) await page.addScriptTag({ content: source });
        const result = await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView');
            const host = root.querySelector('.visualizer-stage-host');
            const stage = root.querySelector('.visualizer-stage');
            const canvas = stage.querySelector('canvas');
            const view = Object.assign(Object.create(window.VisualizerView.prototype), {
                visible: true, layout: { ...createDefaultLayout(), aspect: '9:16' }, root, stageHost: host, stage, canvas,
                status: {}, renderer: { quality: 0, draw() {} }, sources: { getStatus: () => 'ready' },
                uiManager: { mobileNav: { nav: document.querySelector('.mobile-bottom-nav') } },
                updateEditButtons() {}, t: (_, fallback) => fallback, metadata: () => null, commitPending() {}
            });
            view.editor = new VisualizerEditor(view);
            const workspace = root.querySelector('.visualizer-workspace');
            workspace.insertBefore(view.editor.navigation, host);
            workspace.appendChild(view.editor.root);
            view.editor.setOpen(true);
            window.testVisualizerView = view;
            window.requestAnimationFrame = () => 1;
            const measure = aspect => {
                view.layout.aspect = aspect;
                stage.style.aspectRatio = aspect.replace(':', '/');
                for (let i = 0; i < 3; i++) view.frame(0);
                const hostRect = host.getBoundingClientRect();
                const stageRect = stage.getBoundingClientRect();
                return { gutter: host.classList.contains('scroll-gutters'),
                    left: stageRect.left, right: stageRect.right, hostLeft: hostRect.left, hostRight: hostRect.right,
                    top: stageRect.top, bottom: stageRect.bottom, hostTop: hostRect.top, hostBottom: hostRect.bottom };
            };
            const tall = measure('9:16');
            const navTop = document.querySelector('.mobile-bottom-nav').getBoundingClientRect().top;
            const laneX = tall.hostLeft - 12;
            const laneY = Math.min(navTop - 30, tall.top + 180);
            return { tall, navTop, laneX, laneY,
                laneIsCanvas: stage.contains(document.elementFromPoint(laneX, laneY)),
                bodyOverflow: getComputedStyle(document.body).overflowY,
                scrollHeight: document.documentElement.scrollHeight };
        });
        assert.equal(result.tall.gutter, true, JSON.stringify(result));
        assert.ok(result.tall.left >= result.tall.hostLeft && result.tall.right <= result.tall.hostRight, JSON.stringify(result));
        assert.ok(result.tall.top >= result.tall.hostTop && result.tall.bottom <= result.tall.hostBottom, JSON.stringify(result));
        assert.ok(result.tall.hostLeft >= 24 && result.tall.hostRight <= 320 - 24, JSON.stringify(result));
        assert.equal(result.laneIsCanvas, false);
        assert.equal(result.bodyOverflow, 'visible');
        assert.ok(result.scrollHeight > 568);
        const session = await page.context().newCDPSession(page);
        const x = result.laneX;
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: result.laneY }] });
        for (let y = result.laneY - 30; y >= 90; y -= 30) {
            await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
        }
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(100);
        const scrolled = await page.evaluate(() => {
            window.testVisualizerView.frame(0);
            return { distance: scrollY,
                inspectorTop: document.querySelector('.visualizer-editor-inspector').getBoundingClientRect().top,
                navTop: document.querySelector('.mobile-bottom-nav').getBoundingClientRect().top,
                gutter: document.querySelector('.visualizer-stage-host').classList.contains('scroll-gutters') };
        });
        assert.ok(scrolled.distance > 0, JSON.stringify(scrolled));
        assert.ok(scrolled.inspectorTop < scrolled.navTop, JSON.stringify(scrolled));
        assert.equal(scrolled.gutter, true);
        await page.setViewportSize({ width: 390, height: 640 });
        const widened = await page.evaluate(() => {
            for (let i = 0; i < 3; i++) window.testVisualizerView.frame(0);
            const host = document.querySelector('.visualizer-stage-host');
            const stage = host.querySelector('.visualizer-stage');
            return { gutter: host.classList.contains('scroll-gutters'),
                hostLeft: host.getBoundingClientRect().left, hostRight: host.getBoundingClientRect().right,
                stageLeft: stage.getBoundingClientRect().left, stageRight: stage.getBoundingClientRect().right };
        });
        assert.equal(widened.gutter, true, JSON.stringify(widened));
        assert.ok(widened.hostLeft >= 24 && widened.hostRight <= 390 - 24, JSON.stringify(widened));
        assert.ok(widened.stageLeft >= widened.hostLeft && widened.stageRight <= widened.hostRight, JSON.stringify(widened));
    } finally {
        await browser.close();
    }
});

test('Visualizer editor uses unboxed settings sections and pipeline parameter rows without clipped controls', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 860, height: 760 } });
        await page.setContent('<!doctype html><body class="view-visualizer"><section id="visualizerView"><div class="visualizer-workspace"><div class="visualizer-stage-host"><div class="visualizer-stage" style="width:320px;height:180px"></div></div></div></section></body>');
        await page.addStyleTag({ content: `${css}\n* { transition: none !important; }` });
        await page.addScriptTag({ content: `${read('../../plugins/plugin-base.js')}\nwindow.TestPluginBase = PluginBase;` });
        await page.addScriptTag({ content: viewSource });
        await page.addScriptTag({ content: modelSource });
        await page.addScriptTag({ content: palettePresetsSource });
        await page.addScriptTag({ content: editorSource });
        const result = await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true,
                value: () => String(++nextId) });
            let themeTrace = 'rgba(12, 34, 56, 1)';
            window.ThemePalette = { get: () => themeTrace };
            const root = document.querySelector('#visualizerView');
            const stage = root.querySelector('.visualizer-stage');
            const layout = window.createDefaultLayout();
            layout.items[0].palette.mode = 'gradient';
            layout.items[0].params.showAxes = true;
            layout.items.push(window.createItem('artwork'));
            const view = Object.assign(Object.create(window.VisualizerView.prototype), { root, stage, layout, updateEditButtons() {},
                t: (key, fallback) => ({ 'visualizer.type.spectrum': 'Spectrum',
                    'visualizer.gradient': 'グラデーション', 'visualizer.apply': '適用',
                    'visualizer.effect': '演出', 'visualizer.add': '追加' })[key] || fallback, changes: 0,
                changed() { this.changes++; }, notice() {}, commitPending() {}, warn() {} });
            const editor = new window.VisualizerEditor(view);
            const workspace = root.querySelector('.visualizer-workspace');
            workspace.insertBefore(editor.navigation, workspace.firstChild);
            workspace.appendChild(editor.root);
            editor.selection = new Set([layout.items[0].id]);
            editor.setOpen(true);
            const qualityRow = document.createElement('label');
            qualityRow.className = 'visualizer-quality-label';
            qualityRow.innerHTML = '<span>Quality</span><select><option>Auto</option></select>';
            editor.navigation.insertBefore(qualityRow, editor.navigationContent);
            const itemList = editor.navigation.querySelector('.visualizer-item-list');
            const layoutFields = [...editor.navigation.querySelector('.visualizer-section').querySelectorAll(':scope > .visualizer-field')];
            const leftAddRow = editor.navigation.querySelector('.visualizer-navigation-add-row');
            const leftMetrics = {
                settingPitch: layoutFields[1].getBoundingClientRect().top - layoutFields[0].getBoundingClientRect().top,
                settingHeight: layoutFields[0].getBoundingClientRect().height,
                addHeight: leftAddRow.getBoundingClientRect().height,
                qualityHeight: qualityRow.getBoundingClientRect().height,
                qualityMargin: [getComputedStyle(qualityRow).marginTop, getComputedStyle(qualityRow).marginBottom],
                listPitch: itemList.children[1].getBoundingClientRect().top - itemList.children[0].getBoundingClientRect().top,
                listHeight: itemList.children[0].getBoundingClientRect().height,
                addParts: ['label', 'select', 'button'].map(tag => leftAddRow.querySelector(tag).getBoundingClientRect().width),
                fits: editor.navigation.scrollWidth <= editor.navigation.clientWidth + 1
            };
            const gridSelect = layoutFields[2].querySelector('select');
            const gridLabelLinked = layoutFields[2].querySelector('label').htmlFor === gridSelect.id;
            gridSelect.value = '8'; gridSelect.dispatchEvent(new Event('change', { bubbles: true }));
            const gridLabelWorks = gridLabelLinked && editor.gridDivisions === 8;
            const listInitial = itemList.children.length === 3 &&
                itemList.children[1].classList.contains('active') &&
                itemList.children[1].getAttribute('aria-pressed') === 'true';
            itemList.children[2].click();
            const listSelects = [...editor.selection].join() === layout.items[1].id &&
                editor.root.querySelector('.visualizer-item-name').textContent.includes('artwork');
            editor.navigation.querySelector('.visualizer-item-list').children[1].click();
            const pipelineCard = document.createElement('div');
            pipelineCard.className = 'pipeline-item'; document.body.appendChild(pipelineCard);
            const pluginUI = document.createElement('div');
            pluginUI.className = 'plugin-ui expanded'; pipelineCard.appendChild(pluginUI);
            const reference = document.createElement('div');
            reference.className = 'compressor-plugin-ui plugin-parameter-ui'; pluginUI.appendChild(reference);
            const native = Object.create(window.TestPluginBase.prototype);
            Object.assign(native, { id: 'fixture', name: 'Compressor', _registerUIControl() {} });
            for (const label of ['Threshold', 'Attack', 'Release']) {
                reference.appendChild(native.createParameterControl(label, 0, 100, 1, 50, () => {}, 'dB', label));
            }
            const standardSelectRow = native.createSelectControl('Mode', ['One', 'Two'], 'One', () => {});
            reference.appendChild(standardSelectRow);
            const controlMetric = element => {
                const style = getComputedStyle(element);
                return { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
                    boxSizing: style.boxSizing, cssHeight: style.height, minHeight: style.minHeight,
                    padding: style.padding, border: style.borderWidth, borderRadius: style.borderRadius,
                    lineHeight: style.lineHeight };
            };
            const standardSelectMetric = controlMetric(standardSelectRow.querySelector('select'));
            standardSelectRow.remove();
            const backgroundSection = [...editor.navigationContent.querySelectorAll(':scope > .visualizer-section')]
                .find(section => section.querySelector(':scope > h3')?.textContent === 'Background');
            const themeSection = backgroundSection.querySelector('.visualizer-theme-colors');
            const backgroundColor = backgroundSection.querySelector('input[type="color"]');
            const themeColors = [...themeSection.querySelectorAll('.visualizer-field')].map(row => ({
                inputLeft: row.querySelector('input').getBoundingClientRect().left,
                labelRight: row.querySelector('label').getBoundingClientRect().right
            }));
            const themeColorAlignment = themeColors.every(({ inputLeft, labelRight }) =>
                Math.abs(inputLeft - backgroundColor.getBoundingClientRect().left) <= .5 && labelRight < inputLeft);
            const removeImageButton = backgroundSection.querySelector(':scope > button');
            const resetThemeButton = themeSection.querySelector(':scope > button');
            const currentLayoutSection = editor.navigationContent.querySelector('.visualizer-section');
            const navControlMetrics = {
                standardSelect: standardSelectMetric,
                aspectSelect: controlMetric(currentLayoutSection.querySelector(':scope > .visualizer-field select')),
                itemSelect: controlMetric(editor.navigation.querySelector('.visualizer-navigation-add-row select')),
                removeImage: { ...controlMetric(removeImageButton), left: removeImageButton.getBoundingClientRect().left,
                    right: removeImageButton.getBoundingClientRect().right,
                    parentLeft: backgroundSection.getBoundingClientRect().left,
                    parentRight: backgroundSection.getBoundingClientRect().right,
                    margin: getComputedStyle(removeImageButton).margin },
                resetTheme: { ...controlMetric(resetThemeButton), left: resetThemeButton.getBoundingClientRect().left,
                    right: resetThemeButton.getBoundingClientRect().right,
                    parentLeft: themeSection.getBoundingClientRect().left,
                    parentRight: themeSection.getBoundingClientRect().right,
                    margin: getComputedStyle(resetThemeButton).margin },
                color: { ...controlMetric(backgroundColor),
                    wrapperPadding: getComputedStyle(backgroundColor, '::-webkit-color-swatch-wrapper').padding,
                    swatchBorder: getComputedStyle(backgroundColor, '::-webkit-color-swatch').borderWidth }
            };
            const config = document.createElement('div');
            config.className = 'config-dialog'; config.innerHTML = '<select><option>One</option><option>Two</option></select>';
            document.body.appendChild(config);
            const navigationStyle = getComputedStyle(editor.navigation);
            const inspectorStyle = getComputedStyle(editor.root);
            const navigationOption = getComputedStyle(editor.navigation.querySelector('select option:nth-child(2)'));
            const configOption = getComputedStyle(config.querySelector('option:nth-child(2)'));
            const paneStyle = { navBackground: navigationStyle.backgroundImage, inspectorBackground: inspectorStyle.backgroundImage,
                pipelineBackground: getComputedStyle(pipelineCard).backgroundImage,
                navBorder: navigationStyle.borderStyle, inspectorBorder: inspectorStyle.borderStyle,
                navPadding: parseFloat(navigationStyle.paddingLeft), optionBackground: navigationOption.backgroundColor,
                optionText: navigationOption.color, configBackground: configOption.backgroundColor, configText: configOption.color };
            const activeListButton = editor.navigation.querySelector('.visualizer-item-list .active');
            const referenceListButton = document.createElement('button');
            referenceListButton.className = 'player-playlist-item active'; document.body.appendChild(referenceListButton);
            const listStyle = { selectedBackground: getComputedStyle(activeListButton).backgroundImage ===
                    getComputedStyle(referenceListButton).backgroundImage,
                selectedAccent: getComputedStyle(activeListButton).boxShadow === getComputedStyle(referenceListButton).boxShadow,
                itemHeight: activeListButton.getBoundingClientRect().height,
                fits: activeListButton.parentElement.scrollWidth <= activeListButton.parentElement.clientWidth + 1 };
            referenceListButton.remove();
            const itemHeading = editor.root.querySelector('.visualizer-item-name').textContent;
            const itemHeader = editor.root.querySelector('.visualizer-item-header');
            const itemTitle = itemHeader.querySelector('.visualizer-item-name');
            const itemOrder = itemHeader.querySelector('.visualizer-editor-actions');
            const titleBox = itemTitle.getBoundingClientRect();
            const orderBox = itemOrder.getBoundingClientRect();
            const headerBox = itemHeader.getBoundingClientRect();
            const itemHeaderAligned = Math.abs((titleBox.top + titleBox.bottom) / 2 -
                (orderBox.top + orderBox.bottom) / 2) < 3 &&
                Math.abs(orderBox.right - headerBox.right) < 2 && titleBox.right < orderBox.left;
            itemTitle.textContent = 'An unusually long analyzer component name that must leave space for the action buttons';
            const longTitleFits = itemHeader.scrollWidth <= itemHeader.clientWidth + 1 &&
                Math.abs(itemOrder.getBoundingClientRect().right - itemHeader.getBoundingClientRect().right) < 2;
            itemTitle.textContent = itemHeading;
            const itemActions = [...editor.root.querySelectorAll('.visualizer-editor-actions button')].map(button => ({
                className: button.className, label: button.getAttribute('aria-label'), svg: !!button.querySelector('svg'),
                width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height
            }));
            const bounds = { count: editor.itemBounds.children.length,
                pointerEvents: getComputedStyle(editor.itemBounds).pointerEvents,
                itemId: editor.itemBounds.firstElementChild?.dataset.itemId,
                handles: editor.overlay.querySelectorAll('.visualizer-handle').length };
            const selectionRect = editor.overlay.getBoundingClientRect();
            bounds.sidePlacement = ['n', 'e', 's', 'w'].every(side => {
                const handle = editor.overlay.querySelector(`.visualizer-handle.${side}`);
                const box = handle.getBoundingClientRect();
                const centered = side === 'n' || side === 's' ?
                    Math.abs((box.left + box.right - selectionRect.left - selectionRect.right) / 2) < 1 :
                    Math.abs((box.top + box.bottom - selectionRect.top - selectionRect.bottom) / 2) < 1;
                const onEdge = { n: Math.abs(box.top - selectionRect.top),
                    e: Math.abs(box.right - selectionRect.right),
                    s: Math.abs(box.bottom - selectionRect.bottom),
                    w: Math.abs(box.left - selectionRect.left) }[side] <= 2;
                return centered && onEdge && getComputedStyle(handle).cursor ===
                    (side === 'n' || side === 's' ? 'ns-resize' : 'ew-resize');
            });
            const boundsRect = editor.itemBounds.firstElementChild.getBoundingClientRect();
            bounds.hitTestClear = !editor.itemBounds.contains(document.elementFromPoint(boundsRect.left + 2, boundsRect.top + 2));
            const fields = [...editor.root.querySelectorAll('.visualizer-field')];
            const rowMetric = row => { const style = getComputedStyle(row);
                return { height: row.getBoundingClientRect().height, marginTop: style.marginTop,
                    marginBottom: style.marginBottom, alignItems: style.alignItems };
            };
            const visualRows = ['DB Range', 'Points', 'Frequency Scale']
                .map(label => fields.find(field => field.textContent.includes(label)));
            const rowPitch = rows => rows.slice(1).map((row, index) =>
                row.getBoundingClientRect().top - rows[index].getBoundingClientRect().top);
            const referenceRows = [...reference.children];
            const propertySection = visualRows[0].parentElement;
            propertySection.style.display = 'block';
            const collapsedPitch = rowPitch(visualRows);
            propertySection.style.display = '';
            const rowMetrics = {
                reference: referenceRows.map(rowMetric), visual: visualRows.map(rowMetric),
                referencePitch: rowPitch(referenceRows), visualPitch: rowPitch(visualRows), collapsedPitch
            };
            const associated = [...root.querySelectorAll('label[for]')].every(label =>
                document.getElementById(label.htmlFor));
            const clipped = fields.filter(field => field.scrollWidth > field.clientWidth + 1)
                .map(field => field.textContent.trim());
            const sectionBorder = getComputedStyle(editor.navigation.querySelector('.visualizer-section')).borderStyle;
            const axis = fields.find(field => field.textContent.includes('Axes and grid'));
            axis.querySelector('label').click();
            const motion = [...editor.root.querySelectorAll('.visualizer-radio')]
                .find(group => group.getAttribute('aria-label') === 'Color motion');
            motion.querySelector('input[value="hue"] + label').click();
            const radioGeometry = group => {
                const title = group.querySelector('.visualizer-radio-title').getBoundingClientRect();
                const options = group.querySelector('.visualizer-radio-options');
                const positions = [...options.children].map(option => option.getBoundingClientRect());
                return { titleRight: title.right, optionsLeft: options.getBoundingClientRect().left,
                    wrapped: new Set(positions.map(position => Math.round(position.top))).size > 1,
                    clipped: options.scrollWidth > options.clientWidth + 1,
                    widths: [options.scrollWidth, options.clientWidth, ...positions.map(position => position.width)],
                    indented: positions.every(position => position.left >= title.right - 1) };
            };
            const narrowRadio = radioGeometry([...editor.root.querySelectorAll('.visualizer-radio')]
                .find(group => group.getAttribute('aria-label') === 'Color motion'));
            const effectAddRow = [...editor.root.querySelectorAll('.visualizer-select-action-row')][1];
            effectAddRow.querySelector('select').value = 'glow';
            const actionRowGeometry = row => {
                const bounds = row.getBoundingClientRect();
                const labelNode = row.querySelector('label');
                const buttonNode = row.querySelector('button');
                const label = labelNode.getBoundingClientRect();
                const select = row.querySelector('select').getBoundingClientRect();
                const button = buttonNode.getBoundingClientRect();
                const textCenter = node => {
                    const range = document.createRange(); range.selectNodeContents(node);
                    const text = range.getBoundingClientRect(); return (text.top + text.bottom) / 2;
                };
                return { sameLine: Math.abs((label.top + label.bottom) / 2 - (select.top + select.bottom) / 2) < 5 &&
                        Math.abs((button.top + button.bottom) / 2 - (select.top + select.bottom) / 2) < 5,
                    captionAligned: Math.abs(textCenter(labelNode) - textCenter(buttonNode)) < 2,
                    order: label.right < select.left && select.right < button.left,
                    sameHeight: Math.abs(select.height - button.height) < 2,
                    rightAligned: Math.abs(button.right - bounds.right) < 5,
                    fits: row.scrollWidth <= row.clientWidth + 1,
                    geometry: { row: [bounds.left, bounds.right], label: [label.left, label.right, label.top, label.bottom],
                        select: [select.left, select.right, select.top, select.bottom],
                        button: [button.left, button.right, button.top, button.bottom],
                        text: [textCenter(labelNode), textCenter(buttonNode)] } };
            };
            const effectAddGeometry = actionRowGeometry(effectAddRow);
            effectAddRow.querySelector('button').click();
            const effect = editor.root.querySelector('.visualizer-effect-heading');
            const effectBlock = effect.parentElement;
            const effectGroup = effectBlock.parentElement;
            const activeAddRow = effectGroup.querySelector('.visualizer-select-action-row');
            const dividerGeometry = {
                occupied: effect.getBoundingClientRect().top - activeAddRow.getBoundingClientRect().bottom,
                lineFromStart: effectBlock.getBoundingClientRect().top + .5 -
                    activeAddRow.getBoundingClientRect().bottom
            };
            const effectFields = [...effect.parentElement.children].filter(child => child.classList.contains('visualizer-field'));
            const depth = effectFields.find(field => field.textContent.includes('Depth'));
            const speed = effectFields.find(field => field.textContent.includes('Speed'));
            const paletteStop = editor.root.querySelector('.visualizer-stop');
            const colorField = paletteStop.querySelector('.visualizer-stop-color-row .visualizer-field');
            const positionField = paletteStop.querySelector(':scope > .visualizer-field');
            const nestedPitch = {
                effect: speed.getBoundingClientRect().top - depth.getBoundingClientRect().top,
                palette: positionField.getBoundingClientRect().top - colorField.getBoundingClientRect().top
            };
            const actionStyle = [...effect.querySelectorAll('.visualizer-effect-actions button')].map(button => {
                const computed = getComputedStyle(button);
                const reference = document.createElement('button');
                reference.className = button.className; document.body.appendChild(reference);
                const expected = getComputedStyle(reference);
                const equal = computed.width === expected.width && computed.height === expected.height &&
                    computed.color === expected.color && computed.backgroundImage === expected.backgroundImage &&
                    computed.borderColor === expected.borderColor;
                reference.remove();
                return { className: button.className, equal, svg: !!button.querySelector('svg') };
            });
            const toggle = effect.querySelector('.toggle-button');
            toggle.click();
            const effectDisabled = !layout.items[0].effects[0].enabled &&
                editor.root.querySelector('.visualizer-effect-heading .toggle-button.off')?.getAttribute('aria-pressed') === 'false' &&
                editor.root.querySelector('.visualizer-effect-heading')?.parentElement.querySelector('input[type="range"]')?.disabled;
            const presetRow = editor.root.querySelector('.visualizer-select-action-row');
            const presetGeometry = actionRowGeometry(presetRow);
            const addStopRow = editor.root.querySelector('.visualizer-add-stop-row');
            const addStopIndented = addStopRow.querySelector('button').getBoundingClientRect().left >=
                addStopRow.getBoundingClientRect().left + 100;
            addStopRow.querySelector('button').click();
            const stop = editor.root.querySelector('.visualizer-stop');
            const color = stop.querySelector('input[type="color"]');
            const paletteColorMetric = controlMetric(color);
            color.value = '#00ff00'; color.dispatchEvent(new Event('input', { bubbles: true }));
            const changedColor = layout.items[0].palette.stops[0].color;
            const remove = stop.querySelector('.visualizer-stop-color-row > button');
            const currentPresetRow = editor.root.querySelector('.visualizer-select-action-row');
            const currentScale = [...editor.root.querySelectorAll('.visualizer-field')]
                .find(field => field.textContent.includes('Frequency Scale')).querySelector('select');
            const stopRightEdges = {
                remove: remove.getBoundingClientRect().right,
                apply: currentPresetRow.querySelector('button').getBoundingClientRect().right,
                select: currentScale.getBoundingClientRect().right,
                stop: stop.getBoundingClientRect().right,
                colorRow: stop.querySelector('.visualizer-stop-color-row').getBoundingClientRect().right,
                removeMargin: getComputedStyle(remove).marginRight,
                applyMargin: getComputedStyle(currentPresetRow.querySelector('button')).marginRight
            };
            const colorBounds = color.getBoundingClientRect();
            const removeBounds = remove.getBoundingClientRect();
            const positionBounds = stop.querySelector('input[type="range"]').getBoundingClientRect();
            const stopColorAligned = Math.abs((colorBounds.top + colorBounds.bottom) / 2 -
                (removeBounds.top + removeBounds.bottom) / 2) < 5 && removeBounds.bottom < positionBounds.top;
            remove.click();
            editor.root.querySelector('.visualizer-effect-actions .delete-button').click();
            const effectRemoved = layout.items[0].effects.length === 0;
            editor.clearSelection(); editor.render();
            const backgroundHeading = editor.root.querySelector('.visualizer-item-name').textContent;
            editor.selection = new Set([layout.items[0].id]); editor.render();
            const axes = layout.items[0].params.showAxes;
            const motionMode = layout.items[0].palette.motion.mode;
            const stopCount = layout.items[0].palette.stops.length;
            editor.root.querySelector('.visualizer-editor-actions .bring-to-front-button').click();
            const sentFront = layout.items.at(-1)?.id === 'main-spectrum';
            editor.root.querySelector('.visualizer-editor-actions .send-to-back-button').click();
            const sentBack = layout.items[0]?.id === 'main-spectrum';
            editor.root.querySelector('.visualizer-editor-actions .delete-button').click();
            const itemDeleted = layout.items.length === 1 && editor.selection.size === 0;
            const replacement = window.createItem('spectrum');
            layout.items.unshift(replacement); editor.selection = new Set([replacement.id]); editor.render();
            const theme = editor.navigation.querySelector('.visualizer-theme-colors');
            const themeInputs = [...theme.querySelectorAll('input[type="color"]')];
            const themeDefaults = themeInputs.length === 8 && themeInputs.every((input, index) =>
                input.value === DEFAULT_THEME_COLORS[THEME_COLOR_ROLES[index]].slice(0, 7));
            themeInputs[0].value = '#ff8040';
            themeInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
            const themeSaved = Object.keys(layout.background.themeColors).length === 1 &&
                layout.background.themeColors['graph-bg-deep'] === '#ff8040';
            themeInputs[3].value = '#123456';
            themeInputs[3].dispatchEvent(new Event('input', { bubbles: true }));
            const themeAlphaSaved = layout.background.themeColors['graph-grid-soft'] === '#12345633';
            theme.querySelector('button').click();
            const themeReset = themeAlphaSaved && !Object.hasOwn(layout.background, 'themeColors') &&
                editor.navigation.querySelector('.visualizer-theme-colors input[type="color"]').value === '#000000';
            const itemAddRow = editor.navigation.querySelector('.visualizer-navigation-add-row');
            const itemAddSelect = itemAddRow.querySelector('select');
            const itemAddButton = itemAddRow.querySelector('button');
            const itemAddBounds = itemAddRow.getBoundingClientRect();
            const itemSelectBounds = itemAddSelect.getBoundingClientRect();
            const itemButtonBounds = itemAddButton.getBoundingClientRect();
            const itemAddAligned = Math.abs((itemSelectBounds.top + itemSelectBounds.bottom) / 2 -
                (itemButtonBounds.top + itemButtonBounds.bottom) / 2) < 2 &&
                Math.abs(itemSelectBounds.height - itemButtonBounds.height) < 2 &&
                Math.abs(itemButtonBounds.right - itemAddBounds.right) < 2 &&
                itemSelectBounds.right < itemButtonBounds.left &&
                itemAddRow.scrollWidth <= itemAddRow.clientWidth + 1;
            itemAddSelect.value = 'level-meter'; itemAddButton.click();
            const itemAdded = layout.items.length === 3 && layout.items.at(-1).type === 'level-meter' &&
                [...editor.selection].join() === layout.items.at(-1).id;
            const firstThemedItem = layout.items.at(-1);
            themeTrace = 'rgba(220, 40, 80, 1)';
            const secondAddRow = editor.navigation.querySelector('.visualizer-navigation-add-row');
            secondAddRow.querySelector('button').click();
            const themeSolidColors = firstThemedItem.palette.color === '#00ff00' &&
                layout.items.at(-1).palette.color === '#00ff00' && firstThemedItem.palette.mode === 'solid';
            layout.items.pop();
            editor.selection = new Set([replacement.id]); editor.render();
            const drawn = [];
            let frameRequests = 0;
            window.requestAnimationFrame = () => ++frameRequests;
            const visualCanvas = document.createElement('canvas'); stage.appendChild(visualCanvas);
            Object.assign(view, { stageHost: root.querySelector('.visualizer-stage-host'), canvas: visualCanvas,
                status: { hidden: true }, sources: { getStatus: () => 'ready' },
                renderer: { quality: 0, draw: current => drawn.push(current.items.map(value => value.id)) },
                visible: true, quality: 'high', uiManager: {}, editor });
            view.frame = window.VisualizerView.prototype.frame;
            view.frame(0);
            // Delete is handled on the document so it also works after clicking the item list.
            document.addEventListener('keydown', event => window.VisualizerView.prototype.onEditKeyDown.call(view, event));
            stage.focus();
            const deleteEvent = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
            stage.dispatchEvent(deleteEvent);
            view.frame(16);
            const deleteKeepsDrawing = deleteEvent.defaultPrevented &&
                editor.selection.size === 0 && frameRequests === 2 && drawn.length === 2 &&
                drawn[0].includes(replacement.id) && !drawn[1].includes(replacement.id) &&
                drawn[1].includes(layout.items[0].id) && drawn[1].includes(layout.items[1].id);
            const postDelete = window.createItem('spectrum');
            layout.items.unshift(postDelete); editor.selection = new Set([postDelete.id]); editor.render();
            const notes = window.createItem('notes');
            layout.items.push(notes); editor.selection = new Set([notes.id]); editor.render();
            const noteRow = label => [...editor.root.querySelectorAll('.visualizer-field')]
                .find(field => visualizerFieldLabel(field) === label.replace(/\s*\([^)]*\)$/, ''));
            const lowRow = noteRow('Lowest note'), highRow = noteRow('Highest note');
            const lowSlider = lowRow.querySelector('input'), highSlider = highRow.querySelector('input');
            const noteRangeInitial = lowSlider.type === 'range' && highSlider.type === 'range' &&
                lowSlider.min === '21' && lowSlider.max === '108' && lowSlider.step === '1' &&
                lowRow.querySelector('input[type=number]').title === 'E1' &&
                highRow.querySelector('input[type=number]').title === 'G6' &&
                lowRow.getBoundingClientRect().height === 26 &&
                highRow.getBoundingClientRect().top - lowRow.getBoundingClientRect().top === 30;
            lowSlider.value = '100'; lowSlider.dispatchEvent(new Event('input', { bubbles: true }));
            const noteRangeUp = notes.params.mn === 100 && notes.params.mx === 100 &&
                lowRow.querySelector('input[type=number]').title === 'E7' &&
                highRow.querySelector('input[type=number]').title === 'E7';
            highSlider.value = '21'; highSlider.dispatchEvent(new Event('input', { bubbles: true }));
            const noteRangeDown = notes.params.mn === 21 && notes.params.mx === 21 &&
                lowRow.querySelector('input[type=number]').title === 'A0' &&
                highRow.querySelector('input[type=number]').title === 'A0' &&
                lowSlider.isConnected && highSlider.isConnected;
            notes.params.mn = 28; notes.params.mx = 91; editor.render();
            window.__notesSliderTest = { editor, notes };
            const keyboard = [...editor.root.querySelectorAll('.visualizer-field')]
                .find(field => field.querySelector('label')?.textContent === 'Keyboard');
            const notesKeyboardDefault = notes.params.kb === false && keyboard.querySelector('input').checked === false;
            keyboard.querySelector('label').click();
            const notesKeyboardSaved = notes.params.kb === true;
            const dividerItem = layout.items[0];
            dividerItem.effects = ['glow', 'opacity'].map(type => window.normalizeEffect({ type }, 'item'));
            editor.selection = new Set([dividerItem.id]); editor.render();
            const effectHeaders = [...editor.root.querySelectorAll('.visualizer-effect-heading')];
            const nextDivider = {
                occupied: effectHeaders[1].getBoundingClientRect().top -
                    effectHeaders[0].parentElement.getBoundingClientRect().bottom,
                lineFromStart: effectHeaders[1].parentElement.getBoundingClientRect().top + .5 -
                    effectHeaders[0].parentElement.getBoundingClientRect().bottom
            };
            const beforeSideDrag = { ...dividerItem.rect };
            const north = editor.overlay.querySelector('.visualizer-handle.n');
            const northBox = north.getBoundingClientRect();
            stage.setPointerCapture = () => {};
            north.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 1,
                clientX: (northBox.left + northBox.right) / 2, clientY: (northBox.top + northBox.bottom) / 2 }));
            stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1,
                clientX: (northBox.left + northBox.right) / 2, clientY: (northBox.top + northBox.bottom) / 2 + 18 }));
            stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
            const sideDrag = dividerItem.rect.y > beforeSideDrag.y &&
                Math.abs(dividerItem.rect.y + dividerItem.rect.h - beforeSideDrag.y - beforeSideDrag.h) < 1e-9 &&
                dividerItem.rect.x === beforeSideDrag.x && dividerItem.rect.w === beforeSideDrag.w &&
                editor.dragging === null;
            const titleItem = window.createItem('title');
            layout.items.push(titleItem); editor.selection = new Set([titleItem.id]); editor.render();
            const textRows = [...editor.root.querySelectorAll('.visualizer-field')];
            const fontRow = textRows.find(row => row.querySelector('select option[value="system-ui"]'));
            const fontSelect = fontRow.querySelector('select');
            const styleRow = editor.root.querySelector('.visualizer-style-row');
            const styleButtons = [...styleRow.querySelectorAll('button')];
            const fontChoices = [...fontSelect.options].map(option => option.value);
            const fontRowPitch = fontRow.getBoundingClientRect().top - styleRow.getBoundingClientRect().top;
            const styleGeometry = { rowHeight: styleRow.getBoundingClientRect().height,
                buttonHeights: styleButtons.map(button => button.getBoundingClientRect().height),
                sameLine: styleButtons.every(button => Math.abs(button.getBoundingClientRect().top - styleButtons[0].getBoundingClientRect().top) < .5),
                fits: styleRow.scrollWidth <= styleRow.clientWidth + 1 };
            const styleGroupLabel = [styleRow.querySelector('span')?.textContent,
                styleRow.getAttribute('aria-label')];
            const textStyleOrder = styleButtons.map(button => button.dataset.style);
            const textStyleLabels = styleButtons.map(button => [button.title, button.getAttribute('aria-label')]);
            const textStyleIcons = styleButtons.every(button => button.querySelector('svg[aria-hidden="true"]'));
            const idleBorder = getComputedStyle(styleButtons[0]).borderColor;
            fontSelect.value = 'Georgia, "Times New Roman", serif';
            fontSelect.dispatchEvent(new Event('change', { bubbles: true }));
            for (const button of styleButtons) button.click();
            const pressedAccent = getComputedStyle(styleButtons[0]).borderColor !== idleBorder;
            const playerActive = document.createElement('button');
            playerActive.className = 'player-button'; playerActive.dataset.active = 'true';
            document.body.appendChild(playerActive);
            const activeAppearance = element => {
                const style = getComputedStyle(element);
                return [style.backgroundImage, style.borderTopColor, style.color, style.boxShadow];
            };
            const styleMatchesPlayer = JSON.stringify(activeAppearance(styleButtons[0])) ===
                JSON.stringify(activeAppearance(playerActive));
            playerActive.remove();
            const fontSaved = titleItem.style.fontFamily === fontSelect.value &&
                titleItem.flipX && titleItem.flipY && titleItem.style.bold && titleItem.style.italic &&
                styleButtons.every(button => button.getAttribute('aria-pressed') === 'true');
            editor.render();
            const textStyleRestored = [...editor.root.querySelectorAll('.visualizer-style-row button')]
                .every(button => button.getAttribute('aria-pressed') === 'true');
            editor.selection = new Set([notes.id]); editor.render();
            notes.palette.motion.mode = 'hue';
            const savedStops = JSON.stringify(notes.palette.stops);
            const paletteMode = () => [...editor.root.querySelectorAll('select')]
                .find(select => select.querySelector('option[value="note-colors"]'));
            const modeChoices = [...paletteMode().options].map(option => option.value);
            const solidPicker = editor.root.querySelector('input[type="color"]');
            const solidRow = solidPicker.closest('.visualizer-field');
            const colorModeRow = paletteMode().closest('.visualizer-field');
            const solidGeometry = [solidPicker.getBoundingClientRect().height,
                solidRow.getBoundingClientRect().height,
                solidRow.getBoundingClientRect().top - colorModeRow.getBoundingClientRect().top];
            const solidDefault = paletteMode().value === 'solid' && solidPicker.value === '#40dfff' &&
                !editor.root.querySelector('.visualizer-stop');
            solidPicker.value = '#123456'; solidPicker.dispatchEvent(new Event('input', { bubbles: true }));
            const solidSaved = notes.palette.color === '#123456';
            const fixedChoice = paletteMode(); fixedChoice.value = 'note-colors';
            fixedChoice.dispatchEvent(new Event('change', { bubbles: true }));
            const fixedPalette = notes.palette.mode === 'note-colors' &&
                !editor.root.querySelector('.visualizer-stop') &&
                !editor.root.querySelector('.visualizer-radio[aria-label="Color mapping"]') &&
                JSON.stringify(notes.palette.stops) === savedStops && notes.palette.motion.mode === 'hue';
            const gradientChoice = paletteMode(); gradientChoice.value = 'gradient';
            gradientChoice.dispatchEvent(new Event('change', { bubbles: true }));
            const restoredPalette = notes.palette.mode === 'gradient' &&
                !!editor.root.querySelector('.visualizer-stop') &&
                !!editor.root.querySelector('.visualizer-radio[aria-label="Color mapping"]') &&
                JSON.stringify(notes.palette.stops) === savedStops && notes.palette.motion.mode === 'hue';
            const solidAgain = paletteMode(); solidAgain.value = 'solid';
            solidAgain.dispatchEvent(new Event('change', { bubbles: true }));
            const solidRestored = notes.palette.color === '#123456' &&
                editor.root.querySelector('input[type="color"]')?.value === '#123456';
            const chroma = window.createItem('chroma');
            chroma.palette.mode = 'gradient';
            layout.items.push(chroma); editor.selection = new Set([chroma.id]); editor.render();
            const chromaField = label => [...editor.root.querySelectorAll('.visualizer-field')]
                .find(field => visualizerFieldLabel(field) === label.replace(/\s*\([^)]*\)$/, ''));
            const display = chromaField('Display').querySelector('select');
            display.value = '1'; display.dispatchEvent(new Event('change', { bubbles: true }));
            chromaField('Lowest Octave').querySelector('input').value = '8';
            chromaField('Lowest Octave').querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
            const raisedHigh = chroma.params.lo === 8 && chroma.params.hi === 8;
            chromaField('Highest Octave').querySelector('input').value = '2';
            chromaField('Highest Octave').querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
            const chromaControls = chroma.params.dm === 1 && raisedHigh &&
                chroma.params.lo === 2 && chroma.params.hi === 2 &&
                !!editor.root.querySelector('.visualizer-radio[aria-label="Color mapping"]') &&
                !chromaField('Input gain');
            const styleByType = ['title', 'album', 'artist', 'spectrum', 'spectrogram', 'stereo', 'level-meter', 'notes', 'chroma']
                .map(type => {
                    const specimen = window.createItem(type);
                    layout.items.push(specimen); editor.selection = new Set([specimen.id]); editor.render();
                    const buttons = [...editor.root.querySelectorAll('.visualizer-style-row button')];
                    const order = buttons.map(button => button.dataset.style);
                    const colorMode = [...editor.root.querySelectorAll('select')]
                        .find(select => select.querySelector('option[value="solid"]'));
                    const paletteChoices = [...colorMode.options].map(option => option.value);
                    const picker = colorMode.closest('.visualizer-section').querySelector('input[type="color"]');
                    picker.value = '#abcdef'; picker.dispatchEvent(new Event('input', { bubbles: true }));
                    const paletteSaved = specimen.palette.color === '#abcdef' &&
                        specimen.palette.mode === 'solid';
                    const meterFields = type === 'level-meter'
                        ? [...editor.root.querySelector('.visualizer-section').querySelectorAll('.visualizer-field > label')]
                            .map(label => label.textContent.replace(/\s*\([^)]*\):$|:$/g, '')) : null;
                    let spectrumOrientationSaved = null, spectrumQuantizeSaved = null;
                    if (type === 'spectrum') {
                        const spectrumField = label => [...editor.root.querySelectorAll('.visualizer-field')]
                            .find(row => visualizerFieldLabel(row) === label.replace(/\s*\([^)]*\)$/, ''));
                        const display = spectrumField('Display').querySelector('select');
                        const quantize = spectrumField('Quantize').querySelector('input');
                        const defaultQuantize = quantize.checked && quantize.disabled;
                        display.value = 'bar'; display.dispatchEvent(new Event('change', { bubbles: true }));
                        const enabledQuantize = !quantize.disabled;
                        quantize.click();
                        display.value = 'line'; display.dispatchEvent(new Event('change', { bubbles: true }));
                        spectrumQuantizeSaved = defaultQuantize && enabledQuantize && quantize.disabled &&
                            specimen.params.quantizeBars === false;
                        const field = [...editor.root.querySelectorAll('.visualizer-field')]
                            .find(row => row.querySelector('label')?.textContent === 'Orientation');
                        const orientation = field.querySelector('select');
                        const defaultHorizontal = orientation.value === 'horizontal';
                        orientation.value = 'vertical'; orientation.dispatchEvent(new Event('change', { bubbles: true }));
                        spectrumOrientationSaved = defaultHorizontal && specimen.params.orientation === 'vertical' &&
                            specimen.params.sc === 'log-hq' && specimen.params.dm === 'line';
                    }
                    let meterSaved = null;
                    if (type === 'level-meter') {
                        const fields = [...editor.root.querySelectorAll('.visualizer-field')];
                        const dbRange = fields.find(field => visualizerFieldLabel(field) === 'DB Range').querySelector('input');
                        const orientation = fields.find(field => field.querySelector('label')?.textContent === 'Orientation').querySelector('select');
                        const levelValues = fields.find(field => field.querySelector('label')?.textContent === 'Level values').querySelector('input');
                        dbRange.value = '-61'; dbRange.dispatchEvent(new Event('input', { bubbles: true }));
                        orientation.value = 'vertical'; orientation.dispatchEvent(new Event('change', { bubbles: true }));
                        levelValues.click();
                        meterSaved = specimen.params.dr === -61 && specimen.params.orientation === 'vertical' && specimen.params.showLevelValues === true &&
                            specimen.params.showAxisNumbers === false;
                    }
                    buttons[0].click(); buttons[1].click();
                    const saved = specimen.flipX && specimen.flipY && buttons.slice(0, 2)
                        .every(button => button.getAttribute('aria-pressed') === 'true');
                    layout.items.pop();
                    return { type, order, saved, paletteChoices, paletteSaved, meterFields, meterSaved,
                        spectrumOrientationSaved, spectrumQuantizeSaved };
                });
            const levelMeterAvailable = !!editor.navigation.querySelector('.visualizer-navigation-add-row option[value="level-meter"]');
            notes.palette.mode = 'gradient'; editor.selection = new Set([notes.id]); editor.render();
            return { fieldCount: fields.length, clipped, associated, sectionBorder, paneStyle, itemHeading,
                itemHeaderAligned, longTitleFits, rowMetrics, themeDefaults, themeSaved, themeReset,
                listInitial, listSelects, listStyle, leftMetrics, navControlMetrics, themeColorAlignment, gridLabelWorks, deleteKeepsDrawing, nestedPitch,
                notesKeyboardDefault, notesKeyboardSaved, noteRangeInitial, noteRangeUp, noteRangeDown,
                itemAddAligned, itemAdded, themeSolidColors, bounds,
                fieldsets: root.querySelectorAll('fieldset').length,
                pipelineClass: editor.root.classList.contains('plugin-parameter-ui'),
                axes, motion: motionMode,
                narrowRadio, effectDisabled, duplicateEnabled: !!editor.root.querySelector('.visualizer-effect-heading + .checkbox-row'),
                presetGeometry, effectAddGeometry, dividerGeometry, nextDivider, sideDrag,
                fontChoices, fontRowPitch, fontSaved, styleGeometry, textStyleOrder, textStyleLabels,
                textStyleIcons, textStyleRestored, styleGroupLabel, pressedAccent, styleMatchesPlayer, styleByType,
                levelMeterAvailable,
                modeChoices, solidGeometry, solidDefault, solidSaved, solidRestored,
                fixedPalette, restoredPalette, chromaControls,
                effectRemoved, backgroundHeading,
                actionStyle, itemActions, sentFront, sentBack, itemDeleted,
                addStopIndented, stopRightEdges, stopColorAligned, stopColor: changedColor,
                paletteColorMetric,
                stopCount, changes: view.changes };
        });
        assert.ok(result.fieldCount > 10);
        for (const button of [result.navControlMetrics.removeImage, result.navControlMetrics.resetTheme]) {
            assert.ok(Math.abs(button.left - button.parentLeft) <= .5 &&
                Math.abs(button.right - button.parentRight) <= .5, JSON.stringify(button));
        }
        for (const select of [result.navControlMetrics.aspectSelect, result.navControlMetrics.itemSelect]) {
            assert.equal(select.height, result.navControlMetrics.standardSelect.height);
            assert.equal(select.boxSizing, result.navControlMetrics.standardSelect.boxSizing);
            assert.equal(select.minHeight, result.navControlMetrics.standardSelect.minHeight);
            assert.equal(select.padding, result.navControlMetrics.standardSelect.padding);
        }
        for (const color of [result.navControlMetrics.color, result.paletteColorMetric]) {
            assert.equal(color.width, 42);
            assert.equal(color.height, 26);
            assert.equal(color.border, '1px');
            assert.equal(color.borderRadius, '4px');
            assert.equal(color.padding, '2px');
        }
        assert.equal(result.leftMetrics.settingPitch, 30, JSON.stringify(result.leftMetrics));
        assert.equal(result.leftMetrics.addHeight, 26, JSON.stringify(result.leftMetrics));
        assert.equal(result.leftMetrics.qualityHeight, 26, JSON.stringify(result.leftMetrics));
        assert.deepEqual(result.leftMetrics.qualityMargin, ['2px', '16px']);
        assert.equal(result.leftMetrics.listPitch, 30, JSON.stringify(result.leftMetrics));
        assert.equal(result.leftMetrics.fits && result.gridLabelWorks, true);
        assert.ok(result.leftMetrics.addParts[1] >= 60, JSON.stringify(result.leftMetrics));
        assert.deepEqual(result.clipped, []);
        assert.equal(result.associated, true);
        assert.equal(result.sectionBorder, 'none');
        assert.equal(result.paneStyle.navBackground, result.paneStyle.pipelineBackground);
        assert.equal(result.paneStyle.inspectorBackground, result.paneStyle.pipelineBackground);
        assert.equal(result.paneStyle.navBorder, 'solid');
        assert.equal(result.paneStyle.inspectorBorder, 'solid');
        assert.ok(result.paneStyle.navPadding >= 10);
        assert.equal(result.paneStyle.optionBackground, result.paneStyle.configBackground);
        assert.equal(result.paneStyle.optionText, result.paneStyle.configText);
        assert.notEqual(result.paneStyle.optionBackground, result.paneStyle.optionText);
        assert.equal(result.itemHeading, '1. Spectrum');
        assert.equal(result.itemHeaderAligned, true);
        assert.equal(result.longTitleFits, true);
        assert.equal(result.listInitial && result.listSelects, true);
        assert.equal(result.listStyle.selectedBackground && result.listStyle.selectedAccent && result.listStyle.fits, true);
        assert.equal(result.listStyle.itemHeight, 26);
        assert.equal(result.deleteKeepsDrawing, true);
        assert.equal(result.notesKeyboardDefault && result.notesKeyboardSaved, true);
        assert.equal(result.noteRangeInitial && result.noteRangeUp && result.noteRangeDown, true);
        assert.deepEqual(result.rowMetrics.visual, result.rowMetrics.reference);
        assert.deepEqual(result.rowMetrics.referencePitch, [30, 30]);
        assert.deepEqual(result.rowMetrics.collapsedPitch, [28, 28]);
        assert.deepEqual(result.rowMetrics.visualPitch, result.rowMetrics.referencePitch);
        assert.equal(result.nestedPitch.effect, 30);
        assert.ok(Math.abs(result.nestedPitch.palette - 30) <= 1, JSON.stringify(result.nestedPitch));
        assert.equal(result.themeDefaults && result.themeSaved && result.themeReset, true);
        assert.equal(result.themeColorAlignment, true);
        assert.equal(result.itemAddAligned && result.itemAdded && result.themeSolidColors, true);
        assert.equal(result.bounds.count, 1);
        assert.equal(result.bounds.pointerEvents, 'none');
        assert.equal(result.bounds.hitTestClear, true);
        assert.equal(result.bounds.handles, 8);
        assert.equal(result.bounds.sidePlacement, true);
        assert.equal(result.sideDrag, true);
        assert.equal(result.fontChoices.length, 9);
        assert.equal(result.fontRowPitch, 30);
        assert.equal(result.fontSaved, true);
        assert.deepEqual(result.textStyleOrder, ['flipX', 'flipY', 'bold', 'italic']);
        assert.deepEqual(result.textStyleLabels, [['Flip horizontally', 'Flip horizontally'],
            ['Flip vertically', 'Flip vertically'], ['Bold', 'Bold'], ['Italic', 'Italic']]);
        assert.equal(result.textStyleIcons && result.textStyleRestored, true);
        assert.deepEqual(result.styleGroupLabel, ['Style', 'Style']);
        assert.equal(result.pressedAccent, true);
        assert.equal(result.styleMatchesPlayer, true);
        assert.equal(result.styleGeometry.rowHeight, 26);
        assert.equal(result.styleGeometry.sameLine && result.styleGeometry.fits, true);
        assert.deepEqual(result.styleGeometry.buttonHeights, [26, 26, 26, 26]);
        for (const specimen of result.styleByType) {
            assert.deepEqual(specimen.order, ['title', 'album', 'artist'].includes(specimen.type)
                ? ['flipX', 'flipY', 'bold', 'italic'] : ['flipX', 'flipY']);
            assert.equal(specimen.saved, true);
            assert.deepEqual(specimen.paletteChoices,
                ['spectrum', 'chroma'].includes(specimen.type)
                    ? ['solid', 'gradient', 'note-colors', 'heatmap']
                    : ['spectrogram', 'level-meter'].includes(specimen.type)
                        ? ['solid', 'gradient', 'heatmap']
                        : specimen.type === 'notes'
                            ? ['solid', 'gradient', 'note-colors'] : ['solid', 'gradient']);
            assert.equal(specimen.paletteSaved, true);
            if (specimen.type === 'spectrum') {
                assert.equal(specimen.spectrumOrientationSaved, true);
                assert.equal(specimen.spectrumQuantizeSaved, true);
            }
            if (specimen.type === 'level-meter') {
                assert.deepEqual(specimen.meterFields, ['Channel', 'DB Range', 'Orientation', 'dB per Segment', 'Level values', 'Fall Time', 'Peak', 'Peak Hold', 'Peak Fall Time', 'Axes and grid', 'Axis labels and numbers']);
                assert.equal(specimen.meterSaved, true);
            }
        }
        assert.equal(result.levelMeterAvailable, true);
        assert.deepEqual(result.modeChoices, ['solid', 'gradient', 'note-colors']);
        assert.deepEqual(result.solidGeometry, [26, 26, 30]);
        assert.equal(result.solidDefault && result.solidSaved && result.solidRestored &&
            result.fixedPalette && result.restoredPalette && result.chromaControls, true);
        assert.equal(result.fieldsets, 0);
        assert.equal(result.pipelineClass, true);
        assert.equal(result.axes, false);
        assert.equal(result.motion, 'hue');
        assert.equal(result.narrowRadio.wrapped, true, JSON.stringify(result.narrowRadio));
        assert.equal(result.narrowRadio.indented, true);
        assert.equal(result.narrowRadio.clipped, false, JSON.stringify(result.narrowRadio));
        assert.equal(result.effectDisabled, true);
        assert.equal(result.duplicateEnabled, false);
        assert.ok(['sameLine', 'captionAligned', 'order', 'sameHeight', 'rightAligned', 'fits'].every(key => result.presetGeometry[key]), JSON.stringify(result.presetGeometry));
        assert.ok(['sameLine', 'captionAligned', 'order', 'sameHeight', 'rightAligned', 'fits'].every(key => result.effectAddGeometry[key]), JSON.stringify(result.effectAddGeometry));
        assert.ok(Math.abs(result.dividerGeometry.occupied - 30) <= .5 &&
            Math.abs(result.dividerGeometry.lineFromStart - 15) <= .5,
        JSON.stringify(result.dividerGeometry));
        assert.ok(Math.abs(result.nextDivider.occupied - 30) <= .5 &&
            Math.abs(result.nextDivider.lineFromStart - 15) <= .5,
        JSON.stringify(result.nextDivider));
        assert.equal(result.effectRemoved, true);
        assert.equal(result.backgroundHeading, 'Background');
        assert.deepEqual(result.actionStyle.map(action => action.className), ['move-up-button', 'move-down-button', 'delete-button']);
        assert.ok(result.actionStyle.every(action => action.equal && action.svg), JSON.stringify(result.actionStyle));
        assert.deepEqual(result.itemActions.map(action => action.className), ['move-up-button', 'move-down-button', 'header-button bring-to-front-button', 'header-button send-to-back-button', 'delete-button']);
        assert.deepEqual(result.itemActions.map(action => action.label), ['Move up', 'Move down', 'Bring to front', 'Send to back', 'Delete']);
        assert.ok(result.itemActions.every(action => action.svg && action.width === 24 && action.height === 24));
        assert.equal(result.sentFront && result.sentBack && result.itemDeleted, true);
        assert.equal(result.addStopIndented, true);
        assert.ok(Math.abs(result.stopRightEdges.remove - result.stopRightEdges.apply) <= .5,
            JSON.stringify(result.stopRightEdges));
        assert.ok(Math.abs(result.stopRightEdges.remove - result.stopRightEdges.select) <= .5,
            JSON.stringify(result.stopRightEdges));
        assert.equal(result.stopColorAligned, true);
        assert.equal(result.stopColor, '#00ff00');
        assert.equal(result.stopCount, 1);
        assert.ok(result.changes >= 5);
        await page.setViewportSize({ width: 1440, height: 760 });
        const wideRadio = await page.evaluate(() => {
            const group = [...document.querySelectorAll('.visualizer-radio')]
                .find(element => element.getAttribute('aria-label') === 'Color motion');
            const title = group.querySelector('.visualizer-radio-title').getBoundingClientRect();
            const options = [...group.querySelectorAll('.radio-option')].map(option => option.getBoundingClientRect());
            const navigation = document.querySelector('.visualizer-editor-navigation');
            const fields = [...navigation.querySelector('.visualizer-section').querySelectorAll(':scope > .visualizer-field')];
            const addSelect = navigation.querySelector('.visualizer-navigation-add-row select');
            return { oneLine: options.every(option => Math.abs(option.top - options[0].top) < 1),
                indented: options.every(option => option.left >= title.right - 1),
                leftPitch: fields[1].getBoundingClientRect().top - fields[0].getBoundingClientRect().top,
                addSelectWidth: addSelect.getBoundingClientRect().width,
                navigationFits: navigation.scrollWidth <= navigation.clientWidth + 1 };
        });
        assert.equal(wideRadio.oneLine, true);
        assert.equal(wideRadio.indented, true);
        assert.equal(wideRadio.leftPitch, 30);
        assert.ok(wideRadio.addSelectWidth >= 60 && wideRadio.navigationFits, JSON.stringify(wideRadio));
        const sliderBox = await page.evaluate(() => {
            const { editor, notes } = window.__notesSliderTest;
            editor.selection = new Set([notes.id]); editor.render();
            const row = [...editor.root.querySelectorAll('.visualizer-field')]
                .find(field => visualizerFieldLabel(field) === 'Lowest note');
            const slider = row.querySelector('input');
            window.__draggedNoteSlider = slider;
            window.__noteInputCount = 0;
            slider.addEventListener('input', () => window.__noteInputCount++);
            const rect = slider.getBoundingClientRect();
            return { left: rect.left, width: rect.width, y: rect.top + rect.height / 2 };
        });
        await page.mouse.move(sliderBox.left + sliderBox.width * .08, sliderBox.y);
        await page.mouse.down();
        await page.mouse.move(sliderBox.left + sliderBox.width * .6, sliderBox.y, { steps: 4 });
        await page.mouse.move(sliderBox.left + sliderBox.width * .97, sliderBox.y, { steps: 4 });
        await page.mouse.up();
        const dragResult = await page.evaluate(() => {
            const { editor, notes } = window.__notesSliderTest;
            const highRow = [...editor.root.querySelectorAll('.visualizer-field')]
                .find(field => visualizerFieldLabel(field) === 'Highest note');
            return { events: window.__noteInputCount, connected: window.__draggedNoteSlider.isConnected,
                low: notes.params.mn, high: notes.params.mx,
                highSlider: Number(highRow.querySelector('input').value),
                highName: highRow.querySelector('input[type=number]').title };
        });
        assert.ok(dragResult.events >= 2 && dragResult.connected && dragResult.low > 91 &&
            dragResult.high === dragResult.low && dragResult.highSlider === dragResult.high &&
            dragResult.highName.length >= 2, JSON.stringify(dragResult));
    } finally {
        await browser.close();
    }
});

test('Visualizer Edit history and clipboard buttons keep Pipeline sizing and show only while editing', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const measure = async (width, mobile) => {
            const page = await browser.newPage({ viewport: { width, height: 700 } });
            await page.setContent(`<!doctype html><body class="view-visualizer${mobile ? ' layout-mobile' : ''}">
                <div class="pipeline-header-right"><div class="pipeline-toolbar-group"><button type="button" class="header-button undo-button" id="reference">↶</button></div></div>
                <div class="main-container"></div></body>`);
            await page.addStyleTag({ content: css });
            await page.addScriptTag({ content: `
                window.createDefaultLayout = () => ({ aspect: '16:9' });
                window.VisualizerPresetStore = class {};
                window.VisualizerSources = class {};
                window.VisualizerRenderer = class {};
                window.VisualizerEditor = class {
                    constructor(view) {
                        this.view = view; this.selection = new Set(); this.open = false;
                        this.navigation = document.createElement('aside'); this.root = document.createElement('aside');
                        this.navigationContent = document.createElement('div');
                        this.navigation.appendChild(this.navigationContent);
                    }
                    setOpen(open) { this.open = open; this.view.root.classList.toggle('is-editing', open); }
                    updateUITexts() {}
                };
            ` });
            await page.addScriptTag({ content: viewSource });
            return page.evaluate(() => {
                Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: () => null } });
                window.VisualizerView.prototype.initialize = async () => {};
                const view = new window.VisualizerView({ t: key => key, audioManager: {}, layoutMode: {} });
                const group = view.root.querySelector('.pipeline-header-right');
                const shown = element => getComputedStyle(element).display !== 'none';
                const size = element => {
                    const style = getComputedStyle(element);
                    return [style.width, style.height, style.padding].join(' ');
                };
                const idle = { group: shown(group), importLink: shown(view.importButton) };
                view.editor.setOpen(true);
                const toolbar = view.toolbar;
                return {
                    idle,
                    editing: { group: shown(group), importLink: shown(view.importButton) },
                    reference: size(document.querySelector('#reference')),
                    sizes: [view.undoButton, view.redoButton, view.cutButton, view.copyButton, view.pasteButton].map(size),
                    fits: toolbar.scrollWidth <= toolbar.clientWidth + 1 &&
                        [...toolbar.querySelectorAll('button')].every(button => button.getBoundingClientRect().right <= innerWidth + 0.5)
                };
            });
        };
        for (const [width, mobile] of [[1280, false], [375, true]]) {
            const result = await measure(width, mobile);
            assert.deepEqual(result.idle, { group: false, importLink: true });
            assert.deepEqual(result.editing, { group: true, importLink: false });
            assert.deepEqual(result.sizes, Array(5).fill(result.reference));
            assert.equal(result.fits, true, `toolbar fits at ${width}px`);
        }
    } finally {
        await browser.close();
    }
});

test('Visualizer multi-selection shows plain selected bounds and the marquee only while dragging', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
        await page.setContent('<!doctype html><body class="view-visualizer"><div id="visualizerView"><div class="visualizer-stage" tabindex="-1" style="position:relative;width:400px;height:200px"><canvas></canvas></div></div></body>');
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: modelSource });
        await page.addScriptTag({ content: palettePresetsSource });
        await page.addScriptTag({ content: editorSource });
        await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            const root = document.querySelector('#visualizerView');
            const layout = createDefaultLayout();
            layout.items = [createItem('title'), createItem('artist'), createItem('album')];
            layout.items[0].rect = { x: .1, y: .1, w: .2, h: .2 };
            layout.items[1].rect = { x: .35, y: .1, w: .2, h: .2 };
            layout.items[2].rect = { x: .7, y: .6, w: .2, h: .2 };
            const stage = root.querySelector('.visualizer-stage');
            const view = { root, stage, canvas: stage.querySelector('canvas'), layout, updateEditButtons() {},
                t: (_, fallback) => fallback, changed() {}, notice() {}, commitPending() {}, warn() {} };
            window.editor = new VisualizerEditor(view);
            root.append(editor.navigation, editor.root);
            editor.selection = new Set([layout.items[0].id, layout.items[1].id]);
            editor.setOpen(true);
        });
        const bounds = await page.evaluate(() => ({
            handles: getComputedStyle(editor.overlay).display,
            selected: [...editor.itemBounds.querySelectorAll('div.selected')].map(div => getComputedStyle(div).borderTopStyle),
            unselected: [...editor.itemBounds.querySelectorAll('div:not(.selected)')].map(div => getComputedStyle(div).borderTopStyle)
        }));
        assert.deepEqual(bounds, { handles: 'none', selected: ['solid', 'solid'], unselected: ['dashed'] });
        const stage = await page.locator('.visualizer-stage').boundingBox();
        // Drag from the empty lower-left area around the third item only.
        await page.mouse.move(stage.x + stage.width * .65, stage.y + stage.height * .5);
        await page.mouse.down();
        await page.mouse.move(stage.x + stage.width * .95, stage.y + stage.height * .95, { steps: 3 });
        const during = await page.evaluate(() => {
            const rect = editor.marquee.getBoundingClientRect();
            return { shown: getComputedStyle(editor.marquee).display !== 'none' && rect.width > 0 && rect.height > 0,
                selection: [...editor.selection].map(id => editor.view.layout.items.findIndex(item => item.id === id)) };
        });
        await page.mouse.up();
        const after = await page.evaluate(() => getComputedStyle(editor.marquee).display);
        assert.deepEqual(during, { shown: true, selection: [2] });
        assert.equal(after, 'none');
    } finally {
        await browser.close();
    }
});


test('Every Visualizer numeric slider supports unit-aware input, history, and the mobile keypad', async t => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body class="view-visualizer"><div class="main-container"></div></body>');
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: `
            window.VisualizerPresetStore = class { saveCurrent() {} };
            window.VisualizerSources = class { setLayout() {} };
            window.VisualizerRenderer = class {};
        ` });
        for (const source of [modelSource, palettePresetsSource, editorSource, viewSource,
            read('../../js/ui/mobile-number-keypad.js').replace(/^export /gm, '')]) {
            await page.addScriptTag({ content: source });
        }
        const result = await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            VisualizerView.prototype.initialize = async () => {};
            const view = new VisualizerView({ t: key => key, audioManager: {} }), editor = view.editor;
            window.view = view;
            view.setEditing(true);
            const violations = [], counts = {};
            const inspect = type => {
                const sliders = [...view.root.querySelectorAll('.visualizer-field > input[type=range]')];
                counts[type] = Math.max(counts[type] ?? 0, sliders.length);
                for (const slider of sliders) {
                    const row = slider.parentElement, input = row.querySelector('input[type=number]');
                    const label = row.querySelector('label').textContent;
                    if (!input || !Number.isFinite(Number(input.value)) || input.value === '' ||
                        !Number.isFinite(Number(input.min)) || !Number.isFinite(Number(input.max)) ||
                        !(Number(input.step) > 0) || input.disabled !== slider.disabled ||
                        !label.endsWith(':') || row.querySelector('output') ||
                        input !== row.lastElementChild || getComputedStyle(input).textAlign !== 'right') {
                        violations.push(`${type}: ${label}`);
                    }
                }
            };
            for (const type of ITEM_TYPES) {
                const item = createItem(type);
                item.palette.mode = 'gradient';
                item.effects = Object.entries(EFFECT_CATALOG).filter(([, effect]) => effect.allowedOn.includes('item'))
                    .filter(([key]) => key !== 'ken-burns' || type === 'artwork')
                    .map(([key]) => normalizeEffect({ type: key }, 'item'));
                for (const effect of item.effects) { effect.mod.source = 'time'; effect.palette.mode = 'gradient'; }
                if (type === 'analog-meter') item.params.needleTip = 'arrow';
                view.setLayout({ ...createDefaultLayout(), items: [item] });
                editor.selection = new Set([item.id]); editor.render(); inspect(type);
                if (type === 'spectrum') { view.layout.items[0].params.dm = 'bar'; editor.render(); inspect(type); }
                if (type === 'shape') for (const shape of SHAPES) { view.layout.items[0].style.shape = shape; editor.render(); inspect(type); }
            }
            const select = type => {
                const item = createItem(type);
                view.setLayout({ ...createDefaultLayout(), items: [item] });
                editor.selection = new Set([item.id]); editor.render();
                return view.layout.items[0];
            };
            const number = label => [...editor.root.querySelectorAll('.visualizer-field')]
                .find(row => visualizerFieldLabel(row) === label).querySelector('input[type=number]');
            const type = (input, value, commit = 'blur') => {
                input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
                if (commit === 'Enter') input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
                else input.dispatchEvent(new Event(commit));
            };
            const shape = select('shape'), opacity = number('Fill opacity');
            const before = view.history.entries.length, originalOpacity = shape.style.fillOpacity;
            opacity.value = '3'; opacity.dispatchEvent(new Event('input', { bubbles: true }));
            opacity.value = '33'; opacity.dispatchEvent(new Event('input', { bubbles: true }));
            const typing = [shape.style.fillOpacity, opacity.value, view.history.entries.length - before];
            opacity.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
            opacity.dispatchEvent(new Event('blur'));
            const committed = [view.history.entries.length - before,
                opacity.previousElementSibling.style.getPropertyValue('--et-range-fill')];
            view.stepHistory('undo'); const undone = view.layout.items[0].style.fillOpacity;
            view.stepHistory('redo'); const redone = view.layout.items[0].style.fillOpacity;
            const stereo = select('stereo'); type(number('Window'), '150');
            const scope = select('oscilloscope'); type(number('Holdoff'), '1.5');
            const spectrum = select('spectrum'), frequency = number('Max Frequency'); type(frequency, '15');
            const converted = [stereo.params.wt, scope.params.ho, spectrum.params.mf];
            const range = number('DB Range'), initial = spectrum.params.dr;
            range.value = '-999'; range.dispatchEvent(new Event('input', { bubbles: true }));
            const invalidUnapplied = spectrum.params.dr === initial;
            range.dispatchEvent(new Event('blur'));
            const clamped = [spectrum.params.dr, range.value, range.previousElementSibling.value];
            type(range, ''); const restored = range.value;
            const bands = number('Bands'), segment = number('dB per Segment');
            const initialDisabled = bands.disabled && segment.disabled;
            const display = [...editor.root.querySelectorAll('select')].find(input => [...input.options].some(option => option.value === 'bar'));
            display.value = 'bar'; display.dispatchEvent(new Event('change'));
            const enabled = !bands.disabled && !segment.disabled;
            display.value = 'line'; display.dispatchEvent(new Event('change'));
            const disabled = bands.disabled && segment.disabled;
            const notes = select('notes'); type(number('Lowest note'), '100.2');
            const noteRange = [notes.params.mn, notes.params.mx, number('Highest note').value, number('Highest note').title];
            type(number('Highest note'), ''); const peerRestored = number('Highest note').value;
            const rhythm = select('rhythm-analyzer'); type(number('Max BPM'), '120'); type(number('Min BPM'), '180.2');
            const bpmRange = [rhythm.params.mn, rhythm.params.mx, number('Max BPM').value];
            const mobileItem = select('spectrum'); document.body.classList.add('layout-mobile');
            const keypad = new MobileNumberKeypad(), mobileInput = number('Max Frequency');
            mobileInput.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, isPrimary: true }));
            const inspectorKeypad = keypad.target === mobileInput;
            keypad.edit('clear'); keypad.edit('2'); keypad.edit('4'); keypad.commit();
            const scale = editor.navigation.querySelector('input[type=number]');
            scale.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, isPrimary: true }));
            const navigationKeypad = keypad.target === scale;
            keypad.edit('clear'); keypad.edit('2'); keypad.commit();
            const mobile = [inspectorKeypad, mobileItem.params.mf, navigationKeypad, view.layout.graphScale,
                scale.previousElementSibling.style.getPropertyValue('--et-range-fill')];
            keypad.dispose();
            return { violations, counts, typing, committed, originalOpacity, undone, redone, converted,
                invalidUnapplied, clamped, restored, initialDisabled, enabled, disabled, noteRange, peerRestored, bpmRange, mobile };
        });
        assert.deepEqual(result.violations, []);
        assert.equal(Object.keys(result.counts).length, 17);
        assert.ok(Object.values(result.counts).every(count => count > 0));
        assert.deepEqual(result.typing, [.33, '33', 0]);
        assert.deepEqual(result.committed, [1, '33%']);
        assert.equal(result.undone, result.originalOpacity); assert.equal(result.redone, .33);
        assert.deepEqual(result.converted, [.15, .0015, 15000]);
        assert.equal(result.invalidUnapplied, true);
        assert.deepEqual(result.clamped, [-144, '-144', '-144']); assert.equal(result.restored, '-144');
        assert.equal(result.initialDisabled && result.enabled && result.disabled, true);
        assert.deepEqual(result.noteRange, [100, 100, '100', 'E7']); assert.equal(result.peerRestored, '100');
        assert.deepEqual(result.bpmRange, [180, 225, '225']);
        assert.deepEqual(result.mobile, [true, 24000, true, 2, '60%']);
        await page.setViewportSize({ width: 1024, height: 768 });
        await page.evaluate(() => {
            document.body.classList.remove('layout-mobile');
            document.body.classList.add('layout-desktop');
        });
        const slider = page.locator('.visualizer-editor-navigation input[type=range]').first();
        const geometry = await slider.evaluate(range => {
            const row = range.parentElement, number = row.querySelector('input[type=number]');
            const rowRect = row.getBoundingClientRect(), numberRect = number.getBoundingClientRect();
            return { sliderWidth: range.getBoundingClientRect().width, numberWidth: numberRect.width,
                rightMargin: rowRect.right - numberRect.right, rightAligned: getComputedStyle(number).textAlign,
                overflow: row.scrollWidth - row.clientWidth };
        });
        t.diagnostic(`1024px navigation numeric row: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.sliderWidth >= 100, 'Graph scale slider remains usable at the minimum desktop width');
        assert.equal(geometry.numberWidth, 80);
        assert.ok(Math.abs(geometry.rightMargin) < 1);
        assert.equal(geometry.rightAligned, 'right');
        assert.ok(geometry.overflow <= 1);
        const box = await slider.boundingBox();
        await page.mouse.move(box.x + box.width * .25, box.y + box.height / 2);
        await page.mouse.down();
        const startValue = await slider.inputValue();
        await page.mouse.move(box.x + box.width * .85, box.y + box.height / 2, { steps: 6 });
        await page.mouse.up();
        const dragged = await slider.evaluate(range => ({ value: Number(range.value),
            number: Number(range.nextElementSibling.value), model: view.layout.graphScale,
            fill: parseFloat(range.style.getPropertyValue('--et-range-fill')),
            expectedFill: (Number(range.value) - Number(range.min)) / (Number(range.max) - Number(range.min)) * 100 }));
        assert.ok(dragged.value > Number(startValue), 'dragging right increases Graph scale');
        assert.equal(dragged.number, dragged.value);
        assert.equal(dragged.model, dragged.value);
        assert.ok(Math.abs(dragged.fill - dragged.expectedFill) < .01);
    } finally {
        await browser.close();
    }
});


test('Visualizer number edits commit one canonical step value after native blur, Enter, or keypad OK', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
        const page = await browser.newPage();
        await page.setContent('<!doctype html><body class="view-visualizer"><div class="main-container"></div></body>');
        await page.addStyleTag({ content: css });
        await page.addScriptTag({ content: `
            window.VisualizerPresetStore = class { saveCurrent() {} };
            window.VisualizerSources = class { setLayout() {} };
            window.VisualizerRenderer = class {};
        ` });
        for (const source of [modelSource, palettePresetsSource, editorSource, viewSource,
            read('../../js/ui/mobile-number-keypad.js').replace(/^export /gm, '')]) {
            await page.addScriptTag({ content: source });
        }
        await page.evaluate(() => {
            Object.defineProperty(window, 'localStorage', { configurable: true,
                value: { getItem: () => null, setItem() {} } });
            let nextId = 0;
            Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => String(++nextId) });
            VisualizerView.prototype.initialize = async () => {};
            window.view = new VisualizerView({ t: key => key, audioManager: {} });
            window.editor = view.editor; view.setEditing(true);
            window.pick = type => {
                const item = createItem(type);
                view.setLayout({ ...createDefaultLayout(), items: [item] });
                editor.selection = new Set([item.id]); editor.render();
                return view.layout.items[0];
            };
            pick('shape'); window.beforeHistory = view.history.entries.length;
        });
        const scale = page.locator('.visualizer-editor-navigation input[type=number]');
        await scale.click(); await scale.press('Control+a'); await scale.pressSequentially('20');
        await page.locator('.visualizer-item-name').click();
        assert.deepEqual(await page.evaluate(() => ({ value: view.layout.graphScale,
            history: view.history.entries.slice(beforeHistory - 1).map(entry => JSON.parse(entry.json).graphScale) })),
        { value: 3, history: [1, 3] });
        await page.evaluate(() => view.stepHistory('undo'));
        assert.equal(await page.evaluate(() => view.layout.graphScale), 1);
        await page.evaluate(() => view.stepHistory('redo'));
        assert.equal(await page.evaluate(() => view.layout.graphScale), 3);

        const frequency = page.getByRole('spinbutton', { name: 'Max Frequency(kHz):', exact: true });
        await page.evaluate(() => pick('spectrum'));
        await frequency.fill('12.5'); await frequency.press('Enter');
        await scale.fill('1.23'); await scale.press('Enter');
        assert.deepEqual(await page.evaluate(() => {
            const state = (input, model) => {
                const slider = input.previousElementSibling, applied = editor.rangeControls.get(slider).applied.value;
                return [model, input.value, slider.value, applied, slider.style.getPropertyValue('--et-range-fill')];
            };
            return {
                frequency: state(editor.root.querySelector('input[aria-label="Max Frequency(kHz):"]'), view.layout.items[0].params.mf),
                scale: state(editor.navigation.querySelector('input[type=number]'), view.layout.graphScale),
                persisted: [JSON.parse(view.history.entries.at(-1).json).graphScale,
                    normalizeLayout(view.layout).graphScale, normalizeLayout(view.layout).items[0].params.mf]
            };
        }), { frequency: [13000, '13', '13000', 13, `${12000 / 39000 * 100}%`],
            scale: [1.25, '1.25', '1.25', 1.25, '30%'], persisted: [1.25, 1.25, 13000] });

        await page.evaluate(() => pick('shape'));
        const opacity = page.getByRole('spinbutton', { name: 'Fill opacity(%):', exact: true });
        await opacity.fill('33.3'); await opacity.press('Enter');
        assert.deepEqual(await page.evaluate(() => [view.layout.items[0].style.fillOpacity,
            editor.root.querySelector('input[aria-label="Fill opacity(%):"]').value]), [.33, '33']);
        await page.evaluate(() => pick('oscilloscope'));
        const holdoff = page.getByRole('spinbutton', { name: 'Holdoff(ms):', exact: true });
        await holdoff.fill('1.55'); await holdoff.press('Enter');
        assert.deepEqual(await page.evaluate(() => [view.layout.items[0].params.ho,
            editor.root.querySelector('input[aria-label="Holdoff(ms):"]').value]), [.0016, '1.6']);

        await page.evaluate(() => {
            pick('shape'); document.body.classList.add('layout-mobile');
            window.keypad = new MobileNumberKeypad(); window.beforeHistory = view.history.entries.length;
        });
        await scale.click();
        await page.locator('[data-key="clear"]').click(); await page.locator('[data-key="9"]').click();
        await page.locator('.mobile-number-keypad-ok').click();
        assert.deepEqual(await page.evaluate(() => [view.layout.graphScale,
            editor.navigation.querySelector('input[type=number]').value,
            view.history.entries.slice(beforeHistory - 1).map(entry => JSON.parse(entry.json).graphScale)]), [3, '3', [1, 3]]);
        await page.evaluate(() => { keypad.dispose(); view.stepHistory('undo'); });
        assert.equal(await page.evaluate(() => view.layout.graphScale), 1);
    } finally {
        await browser.close();
    }
});
