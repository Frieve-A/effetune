import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json5': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const labelGeometry = () => [...document.querySelectorAll('.plugin-parameter-ui .parameter-row > :is(label, .setting-label)')]
    .filter(label => label.getBoundingClientRect().height).map(label => {
        const rect = label.getBoundingClientRect(), css = getComputedStyle(label);
        const text = label.querySelector('.parameter-label-text'), textRect = text.getBoundingClientRect();
        const controls = [...label.parentElement.children].filter(el => el.matches('input, select') && !el.hidden);
        return { text: label.textContent, title: label.title, rowWidth: label.parentElement.getBoundingClientRect().width,
            width: rect.width, height: rect.height, textHeight: textRect.height,
            numeric: controls.some(el => el.type === 'range') && controls.some(el => el.type === 'number'),
            style: Object.fromEntries(['font', 'lineHeight', 'display', 'alignItems', 'whiteSpace'].map(key => [key, css[key]])),
            clamp: getComputedStyle(text).webkitLineClamp,
            controls: controls.map(el => { const r = el.getBoundingClientRect(); return {
                width: r.width, inside: r.left >= -0.5 && r.right <= innerWidth + 0.5,
                separate: r.left >= rect.right || r.right <= rect.left || r.top >= rect.bottom || r.bottom <= rect.top,
                wrapped: r.top >= rect.bottom
            }; }) };
    });

test('measurement shared layout keeps actions, history and analysis selectors stable across tabs and languages', { timeout: 120000 }, async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.MEASUREMENT_BROWSER_CHANNEL ? { channel: process.env.MEASUREMENT_BROWSER_CHANNEL } : {}) });
    try {
        const context = await browser.newContext({ viewport: { width: 1450, height: 1100 }, deviceScaleFactor: 2, locale: 'en-US' });
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'measurement.test') return route.abort();
            if (url.pathname === '/effect-controls.html') return route.fulfill({ contentType: 'text/html', body:
                '<!doctype html><link rel="stylesheet" href="/css/effetune.css"><link rel="stylesheet" href="/css/effetune-mobile.css"><link rel="stylesheet" href="/plugins/eq/room_eq.css"><script src="/plugins/plugin-base.js"></script><body><div class="room-eq-tabs"><button class="room-eq-tab">Measurement</button><button class="room-eq-tab active">Filter</button></div><button class="reset-effect-button">R</button><div class="plugin-parameter-ui" id="label-reference"></div></body>' });
            if (url.pathname === '/calibration-controls.js') {
                // Exercise the production row builder without starting acquisition or application initialization.
                const source = await fs.readFile(path.join(root, 'features/measurement/app.js'), 'utf8');
                const builder = source.slice(source.indexOf('function rebuildPerChannelCalibrationRows('), source.indexOf('\nfunction parseCalibrationValue('));
                return route.fulfill({ contentType: 'text/javascript', body:
                    `import { channelDisplayLabel } from '/features/measurement/audio-utils/channel-selection.js';\nexport ${builder}` });
            }
            const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
            if (!filename.startsWith(root)) return route.abort();
            if (url.pathname === '/features/measurement/app.js') return route.fulfill({ body: '', contentType: 'text/javascript' });
            try { await route.fulfill({ body: await fs.readFile(filename), contentType: mime[path.extname(filename)] || 'application/octet-stream' }); }
            catch { await route.fulfill({ status: 404, body: '' }); }
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') console.error('UI console:', message.text()); });
        page.on('requestfailed', request => console.error('UI asset request failed:', request.url(), request.failure()?.errorText));
        page.on('response', response => { if (response.status() >= 400) console.error('UI asset response:', response.status(), response.url()); });
        await page.goto('http://measurement.test/features/measurement/measurement.html');
        await page.evaluate(async () => {
            const { UIManager } = await import('/features/measurement/ui/ui-manager.js');
            const { default: storage } = await import('/features/measurement/dataStorage.js');
            const { default: i18n } = await import('/features/measurement/i18n.js');
            const { default: audio } = await import('/features/measurement/audio-utils/index.js');
            await i18n.initI18n();
            const response = Array.from({ length: 100 }, (_, i) => [20 * 175 ** (i / 99), Math.sin(i / 12) * 4]);
            const record = { measurementId: 'analysis-fixture', pointId: 1, sampleRate: 8000, onsetIndex: 16, refScale: 1,
                prerollSamples: 16, trimStartSamples: 0, outputTimeReference: 'unknown', data: new Float32Array(4096) };
            record.data[16] = 1;
            for (let i = 17; i < record.data.length; i++) record.data[i] = Math.exp(-(i - 16) / 400) * Math.sin(i * 0.3) * 0.02;
            record.harmonicAnalysis = { version: 2, method: 'ess', sampleRate: 8000, reference: 'unit-input',
                calibration: 'uncorrected-system', quality: { valid: true, reasons: [] },
                excitation: { startFrequency: 20, endFrequency: 3500, durationSeconds: 2, sweepSamples: 16000, levelDb: -12 },
                orders: [1, 2, 3].map(order => {
                    const data = new Float32Array(512); data[16] = [1, 0.01, 0.003][order - 1];
                    const referenceData = new Float32Array(512);
                    if (order === 1) referenceData[16] = 1;
                    const harmonicReferenceData = new Float32Array(512); harmonicReferenceData[16] = 1;
                    return { order, data, referenceData, ...(order > 1 ? { harmonicReferenceData } : {}),
                        onsetIndex: 16, validMinFrequency: 22, validMaxFrequency: 3150 / order };
                }) };
            const measurement = { id: 'analysis-fixture', name: 'Living room · ESS', sampleRate: 8000,
                timestamp: new Date().toISOString(), inputChannel: 'left', outputChannel: 'left', sweepLength: 16000,
                averaging: 1, sweepMinFreq: 20, sweepMaxFreq: 3500, averageFrequencyResponse: response,
                points: [0, 1].map(index => ({ pointId: index + 1, name: `Listening position ${index + 1}`, frequencyResponse: response,
                    ir: { stored: true, sampleRate: 8000, length: 4096, onsetIndex: 16 } })),
                peqParameters: [{ frequency: 500, gain: -2, Q: 1 }] };
            storage.measurements = [measurement];
            storage.getImpulseResponse = async (_id, key) => ({ ...record, pointId: key });
            const ui = new UIManager();
            ui.selectedMeasurementId = measurement.id;
            ui.initializeEventListeners();
            ui.showScreen('resultsDisplayScreen');
            ui.measurementDisplay.displayMeasurementDetails(measurement.id, true);
            document.body.style.visibility = 'visible';
            audio.exportWAV = (data, rate) => { window.exportedIR = { original: data === ui.analysisController.record.data, rate, length: data.length }; };
            window.analysisFixture = { ui, storage, record, i18n, measurement };
            await ui.analysisController.refresh();
        });
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.currentPlotState?.series.length > 0);
        const evidence = [];
        const reference = await context.newPage();
        await reference.goto('http://measurement.test/effect-controls.html');
        await reference.evaluate(async () => {
            await import('/js/ui/range-fill.js');
            const plugin = Object.create(PluginBase.prototype); plugin.id = 'label-reference'; plugin._registerUIControl = () => {};
            window.labelPlugin = plugin;
        });
        // Compare settled visual states without sampling border transitions midway.
        for (const target of [page, reference]) await target.addStyleTag({ content: '* { transition-duration: 0s !important; animation: none !important; }' });
        await page.bringToFront();
        const tabStyle = element => {
            const css = getComputedStyle(element);
            return Object.fromEntries(['height', 'minHeight', 'padding', 'font', 'borderTop', 'borderBottom', 'borderRadius',
                'backgroundImage', 'color', 'boxShadow', 'outlineStyle'].map(key => [key, css[key]]));
        };
        const effectStyles = {};
        for (const mobile of [false, true]) {
            await reference.evaluate(mobile => document.body.classList.toggle('layout-mobile', mobile), mobile);
            effectStyles[mobile] = {
                inactive: await reference.locator('.room-eq-tab:not(.active)').evaluate(tabStyle),
                active: await reference.locator('.room-eq-tab.active').evaluate(tabStyle),
                actionHeight: await reference.locator('.reset-effect-button').evaluate(el => el.getBoundingClientRect().height)
            };
        }
        const screenshotDir = process.env.MEASUREMENT_LAYOUT_SCREENSHOTS;
        if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
        let wrappedLabels = 0, wrappedControls = 0;
        const checkLabels = async (language, width, screen) => {
            const actual = await page.evaluate(labelGeometry);
            const expected = await reference.evaluate(({ actual, mobile }) => {
                document.body.classList.toggle('layout-mobile', mobile);
                const host = document.getElementById('label-reference'); host.replaceChildren();
                return actual.map(item => {
                    const row = window.labelPlugin.createParameterControl('Reference', 0, 100, 1, 50, () => {});
                    row.style.width = `${item.rowWidth}px`; host.append(row);
                    const label = row.querySelector('label'); label.textContent = item.text;
                    const css = getComputedStyle(label);
                    const rect = label.getBoundingClientRect();
                    return { width: rect.width, height: rect.height,
                        controls: [...row.querySelectorAll('input')].map(el => ({ width: el.getBoundingClientRect().width, wrapped: el.getBoundingClientRect().top >= rect.bottom })),
                        style: Object.fromEntries(['font', 'lineHeight', 'display', 'alignItems', 'whiteSpace'].map(key => [key, css[key]])) };
                });
            }, { actual, mobile: width <= 1158 });
            for (const [index, label] of actual.entries()) {
                const prefix = `${language} ${width} ${screen} ${label.text}`;
                assert.deepEqual(label.style, expected[index].style, `${prefix}: actual Effect label style`);
                assert.equal(label.height, expected[index].height, `${prefix}: Effect centered label height`);
                assert.ok(Math.abs(label.width - Math.min(expected[index].width, label.rowWidth)) < 1, `${prefix}: Effect intrinsic/fixed label width`);
                assert.equal(label.title, label.text, `${prefix}: complete translated title`);
                assert.equal(label.clamp, '2', `${prefix}: two-line ceiling`);
                assert.ok(label.textHeight <= 2 * parseFloat(label.style.font) * 1.6, `${prefix}: two line boxes fit`);
                if (label.textHeight > 24) wrappedLabels++;
                for (const control of label.controls) {
                    assert.ok(control.inside && control.separate, `${prefix}: control stays visible without label overlap`);
                    if (control.wrapped) wrappedControls++;
                }
                if (label.numeric) for (const [controlIndex, control] of label.controls.entries()) {
                    assert.equal(control.wrapped, expected[index].controls[controlIndex].wrapped, `${prefix}: Effect control wrapping`);
                    assert.ok(Math.abs(control.width - expected[index].controls[controlIndex].width) < 1, `${prefix}: Effect field width ${control.width}/${expected[index].controls[controlIndex].width}`);
                }
            }
            evidence.push({ language, width, screen, labels: actual });
            const choices = await page.locator('.plugin-parameter-ui :is(.channel-checkbox-group, .radio-choice-group) label:visible').evaluateAll(elements => elements.map(element => {
                const rect = element.getBoundingClientRect();
                return { text: element.textContent, left: rect.left, right: rect.right, scroll: element.scrollWidth, client: element.clientWidth,
                    inside: rect.left >= -0.5 && rect.right <= innerWidth + 0.5, unclipped: element.scrollWidth <= element.clientWidth };
            }));
            for (const choice of choices) assert.ok(choice.inside && choice.unclipped, `${language} ${width} ${screen}: channel choice keeps its full label: ${JSON.stringify(choice)}`);
        };
        const scenarios = ['en', 'ja', 'ar', 'es', 'fr', 'hi', 'ko', 'pt', 'ru', 'zh'].flatMap(language =>
            [1450, 360, 1160].map(width => ({ language, width })));
        scenarios.push({ language: 'ja', width: 430 });
        for (const { language, width } of scenarios) {
            await page.setViewportSize({ width, height: 1100 });
            await page.waitForFunction(width => document.body.classList.contains('layout-mobile') === (width <= 1158), width);
            await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished)); });
            await page.evaluate(async ({ language }) => {
                const f = window.analysisFixture;
                await f.i18n.setLanguage(language);
                f.measurement.outputChannels = ['left', 'right'];
                f.measurement.channelResponses = ['left', 'right'].map(channel => ({ channel, averageFrequencyResponse: f.measurement.averageFrequencyResponse }));
                f.measurement.points = [{ pointId: 1, name: 'Point 1', channels: ['left', 'right'].map((channel, i) => ({
                    channel, irId: i + 1, ir: { stored: true, sampleRate: 8000, length: 4096, onsetIndex: 16 },
                    frequencyResponse: f.measurement.averageFrequencyResponse
                })) }];
                f.ui.measurementDisplay.updateMeasurementList();
                f.ui.measurementDisplay.displayMeasurementDetails(f.measurement.id, true);
                await f.ui.analysisController.refresh();
            }, { language, width });
            let frequencyGeometry;
            for (const tab of ['frequency', 'impulse', 'distortion', 'waterfall', 'details']) {
                await page.evaluate(async tab => {
                    const controller = window.analysisFixture.ui.analysisController;
                    controller.selectTab(tab); await controller.refresh(); window.scrollTo(0, 0);
                }, tab);
                const result = await page.evaluate(({ language, width, tab }) => {
                    const box = selector => {
                        const r = document.querySelector(selector).getBoundingClientRect();
                        return { x: r.x, y: r.y, width: r.width, height: r.height };
                    };
                    const allPoint = document.querySelector('.point-item[data-index="all"]');
                    const allChannel = document.querySelector('.channel-filter-button[data-channel="all"]');
                    return { language, width, tab, new: box('#newMeasurementBtn'), import: box('#importBtn'),
                        history: box('.measurement-item'), points: box('#pointsGrid'), channels: box('#resultsChannelFilter'),
                        tabs: box('.analysis-tabs'), target: box('#analysisTarget'),
                        tabButtons: [...document.querySelectorAll('[data-analysis-tab]')].map(element => {
                            const rect = element.getBoundingClientRect();
                            return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
                        }),
                        panel: box(`[data-analysis-panel="${tab}"]`),
                        allDisabled: allPoint.getAttribute('aria-disabled') === 'true' && allChannel.disabled,
                        targetPoint: window.analysisFixture.ui.analysisController.target?.pointIndex,
                        overflow: document.documentElement.scrollWidth > innerWidth + 1,
                        controlRows: [...document.querySelectorAll(`[data-analysis-panel="${tab}"] .parameter-row`)].filter(row => row.getBoundingClientRect().height).map(row => ({ height: row.getBoundingClientRect().height, type: row.querySelector('select') ? 'select' : row.querySelector('input[type=checkbox]') ? 'checkbox' : 'number' })),
                        exportGap: tab === 'details' ? document.getElementById('exportAnalysisJson').getBoundingClientRect().top -
                            document.querySelector('#detailsAnalysisPanel [data-i18n="help:roomEq"]').getBoundingClientRect().bottom : null };
                }, { language, width, tab });
                const label = `${language} ${width} ${tab}`;
                const near = (a, b, description) => assert.ok(Math.abs(a - b) < 1, `${label}: ${description} (${a}, ${b})`);
                assert.equal(result.overflow, false, `${label}: horizontal overflow`);
                for (const [index, rect] of result.tabButtons.entries()) {
                    assert.ok(rect.left >= -0.5 && rect.right <= width + 0.5, `${label}: tab ${index} stays inside viewport`);
                    for (const previous of result.tabButtons.slice(0, index)) {
                        assert.ok(rect.left >= previous.right || rect.right <= previous.left ||
                            rect.top >= previous.bottom || rect.bottom <= previous.top, `${label}: tab ${index} does not overlap another tab`);
                    }
                }
                for (const row of result.controlRows) assert.ok(row.height >= (width <= 1158 ? 40 : 26), `${row.type} Effect minimum row height`);
                await checkLabels(language, width, tab);
                const expected = effectStyles[width <= 1158];
                assert.deepEqual(await page.locator('.analysis-tabs .active').evaluate(tabStyle), expected.active, `${label}: RoomEQ active tab style`);
                assert.deepEqual(await page.locator('.analysis-tabs .tab-button:not(.active)').first().evaluate(tabStyle), expected.inactive, `${label}: RoomEQ inactive tab style`);
                const actionHeights = await page.locator('[data-analysis-panel]:not([hidden])').evaluate(panel =>
                    [...panel.querySelectorAll('.analysis-setting-actions button, .analysis-correction button, .export-section button, .impulse-response-controls button, .impulse-response-export button, .analysis-graph-header button, #exportAnalysisJson')]
                        .filter(el => el.getBoundingClientRect().height).map(el => el.getBoundingClientRect().height));
                for (const height of actionHeights) near(height, expected.actionHeight, 'Effect action height');
                if (tab !== 'details') {
                    const copy = page.locator(`#${tab}CopyGraph`);
                    const translated = await page.evaluate(() => window.analysisFixture.i18n.t('analysis:copyGraph'));
                    assert.equal(await copy.getAttribute('title'), translated, `${label}: localized camera tooltip`);
                    assert.equal(await copy.locator('svg[aria-hidden=true]').count(), 1, `${label}: camera survives translation`);
                    assert.equal(await page.getByRole('button', { name: translated, exact: true }).count(), 1, `${label}: camera accessible name`);
                }
                near(result.new.y + result.new.height / 2, result.import.y + result.import.height / 2, 'sidebar actions share a row');
                assert.ok(result.import.x >= result.new.x + result.new.width, `${label}: Import remains beside New`);
                if (width > 1158) near(result.history.y, result.points.y, 'history/point card top alignment');
                if (tab === 'frequency') frequencyGeometry = result;
                else {
                    assert.equal(result.allDisabled, true, `${label}: averages disabled`);
                    assert.equal(result.targetPoint, 0, `${label}: real analysis point`);
                    for (const key of ['points', 'channels', 'tabs', 'target']) {
                        near(result[key].y, frequencyGeometry[key].y, `${key} top stability`);
                        near(result[key].height, frequencyGeometry[key].height, `${key} height stability`);
                    }
                    near(result.panel.y, frequencyGeometry.panel.y, 'panel start stability');
                }
                if (tab === 'details') assert.ok(result.exportGap >= 10, `${label}: JSON export breathing room`);
                evidence.push(result);
                if (screenshotDir && language === 'ru' && [360, 1160].includes(width) && tab === 'impulse') {
                    await page.locator('.analysis-tabs').screenshot({ path: path.join(screenshotDir, `ru-${width}-tabs.png`) });
                    await page.locator('.impulse-response-export').screenshot({ path: path.join(screenshotDir, `ru-${width}-wav-action.png`) });
                }
                if (screenshotDir && language === 'ja' && [1450, 430, 360].includes(width)) {
                    await page.screenshot({ path: path.join(screenshotDir, `${language}-${width}-${tab}.png`) });
                    if (tab !== 'details') await page.locator(`#${tab}AnalysisSettings`).screenshot({ path: path.join(screenshotDir, `${language}-${width}-${tab}-settings.png`) });
                    if (tab === 'frequency') await page.locator('.correction-controls').screenshot({ path: path.join(screenshotDir, `${language}-${width}-correction.png`) });
                    if (tab === 'impulse') await page.locator('#impulseResponseGraph').screenshot({ path: path.join(screenshotDir, `${language}-${width}-impulse-graph.png`) });
                }
            }
            await page.evaluate(async () => {
                const { rebuildPerChannelCalibrationRows } = await import('/calibration-controls.js');
                document.getElementById('advancedSettings').open = true;
                for (const id of ['sweepBandCommonInputs', 'sweepBandChannelInputs', 'calibrationAssignmentControls']) document.getElementById(id).hidden = false;
                document.getElementById('calibrationAssignMode').value = 'perChannel';
                rebuildPerChannelCalibrationRows(['left', 'right']);
                rebuildPerChannelCalibrationRows(['left', 'right']);
                window.analysisFixture.ui.showScreen('measurementConfigScreen');
            });
            await checkLabels(language, width, 'setup');
            assert.equal(await page.locator('.channel-calibration-select:visible').count(), 2);
            if (screenshotDir && ['ja', 'ru'].includes(language)) await page.locator('#measurementConfigScreen').screenshot({ path: path.join(screenshotDir, `${language}-${width}-setup.png`) });
            await page.evaluate(() => {
                document.getElementById('noiseChannelControls').hidden = false;
                window.analysisFixture.ui.showScreen('levelAdjustmentScreen');
            });
            await checkLabels(language, width, 'level');
            if (screenshotDir && language === 'ja') await page.locator('#levelAdjustmentScreen').screenshot({ path: path.join(screenshotDir, `${language}-${width}-level.png`) });
            await page.evaluate(() => window.analysisFixture.ui.showScreen('resultsDisplayScreen'));
        }
        assert.ok(wrappedLabels > 0, 'long setting labels actually use a second line');
        assert.ok(wrappedControls > 0, 'narrow Effect controls naturally wrap below intrinsic labels');
        await page.setViewportSize({ width: 1450, height: 1100 });
        await page.waitForFunction(() => !document.body.classList.contains('layout-mobile'));
        for (const mode of ['hover', 'focus']) {
            const actualTab = page.locator('.analysis-tabs .tab-button:not(.active)').first();
            const expectedTab = reference.locator('.room-eq-tab:not(.active)');
            await reference.evaluate(() => document.body.classList.remove('layout-mobile'));
            if (mode === 'hover') { await actualTab.hover(); await expectedTab.hover(); }
            else { await page.mouse.move(0, 0); await reference.mouse.move(0, 0); await actualTab.focus(); await expectedTab.focus(); }
            await page.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished)); });
            await reference.evaluate(async () => { await Promise.all(document.getAnimations().map(animation => animation.finished)); });
            assert.deepEqual(await actualTab.evaluate(tabStyle), await expectedTab.evaluate(tabStyle), `RoomEQ ${mode} tab style`);
        }
        await reference.close();
        await page.evaluate(async () => {
            await Promise.all(document.getAnimations().map(animation => animation.finished));
            const f = window.analysisFixture;
            await f.i18n.setLanguage('en');
            f.ui.analysisController.selectTab('frequency');
            await f.ui.analysisController.refresh();
            f.ui.correctionHandler.requestCorrectionUpdate = () => {};
        });
        await page.locator('#targetLowFreqValue').fill('100');
        await page.locator('#targetLowFreqValue').blur();
        const correction = await page.evaluate(() => {
            const f = window.analysisFixture;
            const slider = document.getElementById('targetLowFreqSlider');
            const lowFreq = f.ui.correctionHandler.getTargetSettings().lowFreq;
            slider.value = f.ui.correctionHandler.valueToLogSlider(200, 20, 1000);
            slider.dispatchEvent(new Event('input', { bubbles: true }));
            return { lowFreq, number: Number(document.getElementById('targetLowFreqValue').value),
                border: getComputedStyle(slider).borderWidth, padding: getComputedStyle(slider).padding,
                label: slider.previousElementSibling.textContent };
        });
        assert.ok(Math.abs(correction.lowFreq - 100) < 1e-6);
        assert.equal(correction.number, 200);
        assert.equal(correction.border, '0px'); assert.equal(correction.padding, '0px');
        assert.match(correction.label, /\(Hz\):$/);
        await page.evaluate(async () => {
            const c = window.analysisFixture.ui.analysisController;
            c.selectTab('waterfall'); await c.refresh();
            const run = c.worker.run.bind(c.worker); window.analysisCalls = 0;
            c.worker.run = (...args) => { window.analysisCalls++; return run(...args); };
            window.surfaceData = c.analysisResult;
        });
        const graph = page.locator('#waterfallAnalysisGraph');
        await graph.scrollIntoViewIfNeeded();
        const bounds = await graph.boundingBox();
        const angle = await page.locator('#analysis-waterfall-angle').inputValue();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + 50, bounds.y + bounds.height / 2 + 20); await page.mouse.up();
        assert.notEqual(await page.locator('#analysis-waterfall-angle').inputValue(), angle);
        await graph.focus(); await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.press('+');
        await page.keyboard.press('ArrowRight');
        assert.match(await page.locator('#waterfallAnalysisReadout').textContent(), /Hz · λ [\d.]+ m/);
        assert.deepEqual(await page.evaluate(() => ({ calls: window.analysisCalls, same: window.surfaceData === window.analysisFixture.ui.analysisController.analysisResult })), { calls: 0, same: true });
        assert.equal(await page.locator('#analysis-waterfall-normalization').inputValue(), 'none');
        assert.deepEqual(await page.locator('#analysis-waterfall-normalization option').evaluateAll(options => options.map(option => option.value)), ['none', 'global', 'frequency']);
        const checkNormalized = async normalization => {
            const before = await page.evaluate(() => {
                const c = window.analysisFixture.ui.analysisController;
                window.normalizationSource = c.analysisResult;
                return window.analysisCalls;
            });
            await page.locator('#analysis-waterfall-normalization').selectOption(normalization);
            const normalized = await page.evaluate(() => {
                const c = window.analysisFixture.ui.analysisController;
                const mesh = c.plots.waterfall.surface.mesh;
                const point = c.plots.waterfall.surface.keyboardPoint(0.5);
                return { calls: window.analysisCalls, same: c.analysisResult === window.normalizationSource,
                    state: c.copySnapshots.waterfall.state.normalization, caption: c.copySnapshots.waterfall.subtitle,
                    offset: mesh.levelOffset, point: point?.level,
                    maximum: Math.max(...mesh.triangles.flatMap(triangle => triangle.map(vertex => vertex.level))) };
            });
            assert.equal(normalized.calls, before, 'normalization is view-only');
            assert.equal(normalized.same, true); assert.equal(normalized.state, normalization);
            assert.match(normalized.caption, normalization === 'global' ? /Overall peak = 0 dB/ : /Each frequency peak = 0 dB/);
            assert.ok(Number.isFinite(normalized.offset)); assert.ok(normalized.maximum <= 1e-8);
            assert.ok(Number.isFinite(normalized.point) && normalized.point <= 1e-8, 'readout uses normalized levels');
        };
        await checkNormalized('global');
        await checkNormalized('frequency');
        if (screenshotDir) await page.locator('#waterfallAnalysisPanel').screenshot({ path: path.join(screenshotDir, 'waterfall-normalized.png') });
        await page.locator('#analysis-waterfall-normalization').selectOption('none');
        assert.doesNotMatch(await page.evaluate(() => window.analysisFixture.ui.analysisController.copySnapshots.waterfall.subtitle), /peak = 0 dB/);
        await page.locator('#analysis-waterfall-mode').selectOption('burst');
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.mode === 'burst');
        assert.equal(await page.evaluate(() => window.analysisFixture.ui.analysisController.analysisResult.depthUnit), 'cycles');
        await page.locator('#analysis-waterfall-depthUnit').selectOption('seconds');
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.depthUnit === 'seconds');
        assert.equal(await page.locator('#waterfallAnalysisStatus').textContent(), '');
        await checkNormalized('global');
        await checkNormalized('frequency');
        if (screenshotDir) await page.locator('#waterfallAnalysisPanel').screenshot({ path: path.join(screenshotDir, 'burst-seconds.png') });
        await page.locator('#analysis-waterfall-depthUnit').selectOption('cycles');
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.depthUnit === 'cycles');
        await checkNormalized('global');
        await checkNormalized('frequency');
        if (screenshotDir) await page.locator('#waterfallAnalysisPanel').screenshot({ path: path.join(screenshotDir, 'burst-cycles.png') });
        // Exercise the real button and PNG encoding while keeping the OS clipboard untouched.
        await page.evaluate(() => {
            window.ClipboardItem = class { constructor(data) { this.data = data; } };
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: async items => {
                const blob = await items[0].data['image/png'];
                const bitmap = await createImageBitmap(blob);
                window.copiedGraph = { width: bitmap.width, height: bitmap.height, bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
                bitmap.close();
            } } });
        });
        for (const tab of ['frequency', 'impulse', 'distortion', 'waterfall']) {
            await page.evaluate(async tab => { const c = window.analysisFixture.ui.analysisController; c.selectTab(tab); await c.refresh(); }, tab);
            const canvas = page.locator(tab === 'frequency' ? '#resultsGraph' : tab === 'impulse' ? '#impulseResponseGraph' : `#${tab}AnalysisGraph`);
            await canvas.focus(); await page.keyboard.press('ArrowRight');
            const keyboardReadout = await page.locator(`#${tab}AnalysisReadout`).textContent();
            if (tab === 'impulse') assert.doesNotMatch(keyboardReadout, /λ|Hz/);
            else assert.match(keyboardReadout, /Hz · λ [\d.]+ m/);
            const pointer = await page.evaluate(tab => {
                const plot = window.analysisFixture.ui.analysisController.plots[tab];
                const point = tab === 'waterfall' ? plot.surface.keyboardPoint(0.5) :
                    { x: plot.scaleX(tab === 'impulse' ? 0 : 1000), y: plot.plot.top + plot.plot.height / 2 };
                const rect = plot.canvas.getBoundingClientRect();
                return { x: rect.left + point.x, y: rect.top + point.y };
            }, tab);
            await page.mouse.move(pointer.x, pointer.y);
            const readout = page.locator(`#${tab}AnalysisPanel .graph-readout-${tab === 'waterfall' ? 'box' : 'legend'}`);
            const cursor = readout.locator('.graph-readout-cursor');
            await cursor.waitFor({ state: 'visible' });
            if (tab === 'impulse') assert.match(await cursor.textContent(), /^-?[\d.]+ ms$/);
            else {
                assert.match(await cursor.textContent(), /Hz · λ\s*[\d.]+\s*m/);
                if (tab !== 'waterfall') assert.match(await cursor.textContent(), /1000.0 Hz · λ\s*0.34\s*m/);
            }
            const values = readout.locator('.graph-readout-value');
            for (const value of await values.all()) {
                assert.equal(await value.isVisible(), true, `${tab}: hover value is visible`);
                assert.match(await value.textContent(), /\d/, `${tab}: hover value is numerical`);
            }
            assert.equal(await values.count(), tab === 'distortion' ? 3 : 1);
            if (tab === 'impulse') assert.match(await values.first().textContent(), /[\d.]+ … [\d.]+ ×$/);
            if (tab === 'distortion') assert.match(await values.nth(1).textContent(), /^1 %$/);
            if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `${tab}-hover-values.png`) });
            const previous = await page.evaluate(tab => {
                const c = window.analysisFixture.ui.analysisController; const p = c.plots[tab];
                return { settings: JSON.stringify(c.settings), calls: window.analysisCalls, pixels: p.canvas.toDataURL(), readout: p.output.textContent };
            }, tab);
            await page.locator(`#${tab}CopyGraph`).click();
            await page.waitForFunction(tab => document.getElementById(`${tab}CopyGraphStatus`).textContent === 'Graph image copied.', tab);
            const copied = await page.evaluate(() => window.copiedGraph);
            assert.ok(copied.width >= 1600); assert.ok(copied.height > 0);
            const after = await page.evaluate(tab => {
                const c = window.analysisFixture.ui.analysisController; const p = c.plots[tab];
                return { settings: JSON.stringify(c.settings), calls: window.analysisCalls, pixels: p.canvas.toDataURL(), readout: p.output.textContent };
            }, tab);
            assert.deepEqual(after, previous, `${tab}: exporting does not alter live view or reanalyze`);
            if (screenshotDir) await fs.writeFile(path.join(screenshotDir, `copied-${tab}.png`), Buffer.from(copied.bytes));
        }
        await page.evaluate(async () => {
            const c = window.analysisFixture.ui.analysisController;
            c.reset('waterfall'); await c.refresh();
        });
        assert.equal(await page.locator('#analysis-waterfall-normalization').inputValue(), 'none', 'Reset restores the original level reference');
        await page.setViewportSize({ width: 360, height: 1100 });
        await page.waitForFunction(() => document.body.classList.contains('layout-mobile'));
        await page.evaluate(async () => {
            await Promise.all(document.getAnimations().map(animation => animation.finished));
            const c = window.analysisFixture.ui.analysisController;
            window.analysisFixture.measurement.peqParameters = [{ frequency: 500, gain: -2, Q: 1 }];
            c.selectTab('frequency'); await c.refresh();
        });
        await page.locator('#resultsGraph').focus(); await page.keyboard.press('ArrowRight');
        const wrappedReadout = await page.locator('#frequencyAnalysisReadout').textContent();
        assert.match(wrappedReadout, /Original Response.*Correction EQ.*Corrected Response/);
        assert.match(wrappedReadout, /Hz · λ [\d.]+ m/);
        assert.ok(await page.locator('#frequencyAnalysisReadout').evaluate(element => element.getBoundingClientRect().height > parseFloat(getComputedStyle(element).fontSize) * 2));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.locator('#frequencyAnalysisReadout').textContent(), wrappedReadout, 'wrapping keyboard text does not redraw and clear its graph');
        if (screenshotDir) await page.locator('#frequencyAnalysisPanel').screenshot({ path: path.join(screenshotDir, 'narrow-wrapped-readout.png') });
        if (screenshotDir) await fs.writeFile(path.join(screenshotDir, 'coordinates.json'), JSON.stringify(evidence, null, 2));
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
