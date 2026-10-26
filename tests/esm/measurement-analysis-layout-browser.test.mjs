import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json5': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

test('analysis drags preserve completed pixels, captions and layout throughout reanalysis', { timeout: 180000 }, async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.MEASUREMENT_BROWSER_CHANNEL ? { channel: process.env.MEASUREMENT_BROWSER_CHANNEL } : {}) });
    try {
        const context = await browser.newContext({ viewport: { width: 1450, height: 1100 }, locale: 'en-US' });
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.hostname !== 'measurement.test') return route.abort();
            const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname));
            if (!filename.startsWith(root)) return route.abort();
            if (url.pathname === '/features/measurement/app.js') return route.fulfill({ body: '', contentType: 'text/javascript' });
            try { await route.fulfill({ body: await fs.readFile(filename), contentType: mime[path.extname(filename)] || 'application/octet-stream' }); }
            catch { await route.fulfill({ status: 404, body: '' }); }
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://measurement.test/features/measurement/measurement.html');
        await page.evaluate(async () => {
            const { UIManager } = await import('/features/measurement/ui/ui-manager.js');
            const { default: storage } = await import('/features/measurement/dataStorage.js');
            const { default: i18n } = await import('/features/measurement/i18n.js');
            await i18n.initI18n();
            const response = [[20, 0], [3500, 0]];
            const record = { measurementId: 'layout-fixture', pointId: 1, sampleRate: 8000, onsetIndex: 16, refScale: 1,
                data: new Float32Array(4096) };
            record.data[16] = 1;
            for (let i = 17; i < record.data.length; i++) record.data[i] = Math.exp(-(i - 16) / 400) * Math.sin(i * 0.3) * 0.02;
            record.harmonicAnalysis = { version: 2, method: 'ess', sampleRate: 8000, reference: 'unit-input',
                calibration: 'uncorrected-system', quality: { valid: true, reasons: [] },
                excitation: { startFrequency: 20, endFrequency: 3500, durationSeconds: 2, sweepSamples: 16000, levelDb: -12 },
                orders: [1, 2, 3].map(order => {
                    const data = new Float32Array(512); data[16] = [1, 0.01, 0.003][order - 1];
                    const referenceData = new Float32Array(512); if (order === 1) referenceData[16] = 1;
                    const harmonicReferenceData = new Float32Array(512); harmonicReferenceData[16] = 1;
                    return { order, data, referenceData, ...(order > 1 ? { harmonicReferenceData } : {}),
                        onsetIndex: 16, validMinFrequency: 22, validMaxFrequency: 3150 / order };
                }) };
            const measurement = { id: 'layout-fixture', name: 'Living room', sampleRate: 8000, timestamp: new Date().toISOString(),
                inputChannel: 'left', outputChannel: 'left', sweepLength: 16000, averaging: 1, sweepMinFreq: 20, sweepMaxFreq: 3500,
                averageFrequencyResponse: response, points: [{ pointId: 1, name: 'Listening position', frequencyResponse: response,
                    ir: { stored: true, sampleRate: 8000, length: 4096, onsetIndex: 16 } }] };
            storage.measurements = [measurement]; storage.getImpulseResponse = async () => record;
            const ui = new UIManager(); ui.selectedMeasurementId = measurement.id; ui.initializeEventListeners();
            ui.showScreen('resultsDisplayScreen'); ui.measurementDisplay.displayMeasurementDetails(measurement.id, true);
            document.body.style.visibility = 'visible';
            const controller = ui.analysisController;
            controller.selectTab('distortion'); await controller.refresh();
            window.layoutFixture = { controller, storage, ui, i18n, defaults: structuredClone(controller.settings) };
            window.layoutSnapshot = () => {
                const tab = controller.activeTab;
                const selectors = ['.analysis-tabs', '.analysis-tabs button', '#analysisTarget', `#${tab}AnalysisGraph`,
                    `#${tab}AnalysisConditions`, `#${tab}AnalysisReadout`, `#${tab}AnalysisSettings`,
                    `#${tab}AnalysisPanel .analysis-settings`, `#${tab}AnalysisPanel .parameter-row`,
                    `#${tab}AnalysisPanel input`, `#${tab}AnalysisPanel select`, `#${tab}AnalysisPanel button`,
                    `#${tab}AnalysisPanel summary`];
                return { scrollX, scrollY, rectangles: [...new Set(selectors.flatMap(selector => [...document.querySelectorAll(selector)]))]
                    .map((element, index) => { const rect = element.getBoundingClientRect(); return {
                        id: element.id || `${element.className}-${index}`, x: rect.x, y: rect.y, width: rect.width, height: rect.height
                    }; }).filter(rect => rect.height > 0) };
            };
            window.visualSnapshot = () => {
                const tab = controller.activeTab, plot = controller.plots[tab];
                const conditions = document.getElementById(`${tab}AnalysisConditions`);
                return { samePixels: plot.canvas.toDataURL() === window.layoutBaselinePng,
                    conditions: conditions.textContent, visibility: getComputedStyle(conditions).visibility,
                    legend: plot.mount.querySelector('.graph-readout-legend')?.textContent || '',
                    statusHidden: document.getElementById(`${tab}AnalysisStatus`).hidden };
            };
        });
        const directory = process.env.MEASUREMENT_LAYOUT_SCREENSHOTS;
        if (directory) await fs.mkdir(directory, { recursive: true });
        const evidence = [];
        for (const [language, width] of [['en', 1450], ['ja', 1450], ['en', 430], ['ja', 430], ['ja', 360]]) {
            await page.setViewportSize({ width, height: 1100 });
            await page.waitForFunction(mobile => document.body.classList.contains('layout-mobile') === mobile, width <= 1158);
            await page.evaluate(async language => {
                const { controller, i18n, defaults } = window.layoutFixture;
                await i18n.setLanguage(language);
                controller.settings = structuredClone(defaults);
                controller.validateSettings('distortion'); controller.syncControls('distortion');
                await controller.refresh(); await document.fonts.ready;
                await Promise.all(document.getAnimations().map(animation => animation.finished));
            }, language);
            for (const [mode, keys] of [['distortion', ['before', 'after']], ['waterfall', ['start', 'end']],
                ['frequency', ['before']], ['impulse', ['before']], ['burst', ['startCycles', 'endCycles']]]) {
                const tab = mode === 'burst' ? 'waterfall' : mode;
                await page.evaluate(async ({ tab, mode }) => {
                    const { controller: c, defaults, ui } = window.layoutFixture;
                    c.settings = structuredClone(defaults);
                    if (mode === 'burst') c.settings.waterfall.mode = 'burst';
                    if (tab === 'frequency') { ui.measurementDisplay.selectedPointIndex = 0; c.settings.frequency.source = 'ir'; }
                    c.selectTab(tab); await c.refresh();
                }, { tab, mode });
                await page.waitForFunction(() => {
                    const c = window.layoutFixture.controller; return c.readyGeneration === c.generation;
                });
                for (const key of keys) for (const position of (tab === 'distortion' ? [0, 0.5, 1] : [0.5])) {
                    const name = `${language}-${width}-${mode}-${key}-${position}`;
                    const slider = page.locator(`#analysis-${tab}-${key}-slider`);
                    assert.equal(await page.locator(`#${tab}CopyGraph`).isDisabled(), false, `${name}: complete initial plot`);
                    await slider.scrollIntoViewIfNeeded();
                    await slider.evaluate(element => element.focus({ preventScroll: true }));
                    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                    const before = await page.evaluate(() => {
                        const c = window.layoutFixture.controller; c.cache.clear();
                        window.layoutBaselinePng = c.plots[c.activeTab].canvas.toDataURL();
                        window.layoutBaselineVisual = window.visualSnapshot();
                        const object = c.activeTab === 'impulse' ? window.layoutFixture.storage : c.worker;
                        const method = c.activeTab === 'impulse' ? 'getImpulseResponse' : 'run';
                        const original = object[method];
                        const gate = new Promise(resolve => { window.layoutRelease = resolve; });
                        object[method] = async function (...args) { const result = await original.apply(this, args); await gate; return result; };
                        window.layoutRestore = () => { object[method] = original; window.layoutRelease(); };
                        window.layoutSamples = []; window.layoutSampling = true;
                        const sample = () => { if (!window.layoutSampling) return; window.layoutSamples.push({ layout: window.layoutSnapshot(), pending: c.readyGeneration !== c.generation, visual: window.visualSnapshot() }); requestAnimationFrame(sample); };
                        requestAnimationFrame(sample);
                        return window.layoutSnapshot();
                    });
                    if (directory && position === 0.5) await page.screenshot({ path: path.join(directory, `${name}-before.png`) });
                    const box = await slider.boundingBox();
                    const y = box.y + box.height / 2;
                    // Start at an interior position so even an unchanged endpoint produces real input.
                    await page.mouse.move(box.x + box.width * (position === 0.5 ? 0.2 : 0.5), y);
                    await page.mouse.down();
                    await page.mouse.move(box.x + Math.max(2, Math.min(box.width - 2, box.width * position)), y, { steps: 6 });
                    await page.waitForFunction(tab => document.getElementById(tab + 'AnalysisPanel').getAttribute('aria-busy') === 'true', tab);
                    const during = await page.evaluate(() => window.layoutSnapshot());
                    assert.deepEqual(await page.evaluate(() => window.visualSnapshot()), await page.evaluate(() => window.layoutBaselineVisual), `${name}: retained pending pixels and captions`);
                    assert.equal(await page.locator(`#${tab}CopyGraph`).isDisabled(), true);
                    if (directory && position === 0.5) await page.screenshot({ path: path.join(directory, `${name}-during.png`) });
                    await page.mouse.up();
                    const pending = await page.evaluate(() => window.layoutSnapshot());
                    await page.evaluate(() => window.layoutRestore());
                    await page.waitForFunction(() => { const c = window.layoutFixture.controller; return c.readyGeneration === c.generation; });
                    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                    const { after, samples, value, min, max } = await page.evaluate(key => {
                        window.layoutSampling = false;
                        const c = window.layoutFixture.controller, input = c.controls[c.activeTab][key];
                        return { after: window.layoutSnapshot(), samples: window.layoutSamples, value: c.settings[c.activeTab][key],
                            min: Number(input.min), max: Number(input.max) };
                    }, key);
                    evidence.push({ name, before, during, pending, after, value, min, max, samples });
                    if (directory) await fs.writeFile(path.join(directory, 'reanalysis-layout.json'), JSON.stringify(evidence, null, 2));
                    assert.deepEqual(during, before, `${name}: pointer drag`);
                    assert.deepEqual(pending, before, `${name}: worker pending after pointer release`);
                    assert.deepEqual(after, before, `${name}: completed analysis`);
                    const baselineVisual = await page.evaluate(() => window.layoutBaselineVisual);
                    for (const [index, sample] of samples.entries()) {
                        assert.deepEqual(sample.layout, before, `${name}: animation frame ${index}`);
                        if (sample.pending) assert.deepEqual(sample.visual, baselineVisual, `${name}: pending pixels/captions frame ${index}`);
                    }
                    if (position === 0) assert.equal(value, min, `${name}: minimum reached`);
                    if (position === 1) assert.equal(value, max, `${name}: maximum reached`);
                    if (directory && position === 0.5) await page.screenshot({ path: path.join(directory, `${name}-after.png`) });
                }
            }
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
