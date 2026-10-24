import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json5': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

test('measurement analysis tabs preserve selection, calculation and exports in the production UI', { timeout: 120000 }, async () => {
    const browser = await chromium.launch({ headless: true,
        ...(process.env.MEASUREMENT_BROWSER_CHANNEL ? { channel: process.env.MEASUREMENT_BROWSER_CHANNEL } : {}) });
    try {
        const context = await browser.newContext({ viewport: { width: 1450, height: 1100 }, deviceScaleFactor: 2, locale: 'en-US' });
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
        const tabs = ['frequency', 'impulse', 'distortion', 'waterfall', 'details'];
        const screenshotDir = process.env.MEASUREMENT_ANALYSIS_SCREENSHOTS;
        if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
        for (const viewport of [{ width: 1450, height: 1100, name: 'wide' }, { width: 430, height: 1000, name: 'narrow' }]) {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.evaluate(mobile => {
                document.documentElement.classList.toggle('layout-mobile', mobile);
                document.body.classList.toggle('layout-mobile', mobile);
            }, viewport.width < 600);
            for (const tab of tabs) {
                await page.locator(`#${tab}AnalysisTab`).click();
                if (tab !== 'details') await page.waitForFunction(tab => document.getElementById(`${tab}AnalysisPanel`).getAttribute('aria-busy') !== 'true', tab);
                const state = await page.evaluate(tab => {
                    const controller = window.analysisFixture.ui.analysisController;
                    const panel = document.getElementById(`${tab}AnalysisPanel`);
                    const canvas = panel.querySelector('canvas');
                    return { tab: controller.activeTab, point: controller.target?.pointIndex,
                        error: document.getElementById(`${tab}AnalysisStatus`)?.textContent,
                        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
                        width: canvas?.width, cssWidth: canvas?.getBoundingClientRect().width, dpr: devicePixelRatio,
                        series: controller.currentPlotState?.series.length };
                }, tab);
                assert.equal(state.tab, tab);
                assert.equal(state.horizontalOverflow, false, `${viewport.name} ${tab} overflows`);
                if (['impulse', 'distortion', 'waterfall'].includes(tab)) assert.equal(state.point, 0);
                if (tab !== 'details') {
                    assert.equal(state.error, '', `${tab}: ${state.error}`);
                    assert.ok(Math.abs(state.width - state.cssWidth * state.dpr) <= 1);
                }
                if (screenshotDir) await page.locator('#measurementResults').screenshot({ path: path.join(screenshotDir, `${viewport.name}-${tab}.png`) });
            }
        }
        await page.locator('#frequencyAnalysisTab').click();
        assert.equal(await page.evaluate(() => window.analysisFixture.ui.measurementDisplay.selectedPointIndex), 'all');
        const before = await page.evaluate(() => JSON.stringify(window.analysisFixture.measurement));
        await page.locator('#analysis-frequency-smoothing').fill('0');
        await page.locator('#analysis-frequency-smoothing').dispatchEvent('change');
        await page.locator('#analysis-frequency-yMax').fill('12');
        await page.locator('#analysis-frequency-yMax').dispatchEvent('change');
        assert.equal(await page.evaluate(() => JSON.stringify(window.analysisFixture.measurement)), before);
        await page.locator('#resultsGraph').focus(); await page.keyboard.press('ArrowRight');
        assert.match(await page.locator('#frequencyAnalysisReadout').textContent(), /Hz/);
        await page.evaluate(() => window.analysisFixture.ui.measurementDisplay.selectPoint(0));
        await page.locator('#analysis-frequency-source').selectOption('ir');
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.frequencyResponse.length > 0);
        assert.equal(await page.locator('#analysis-frequency-before').isDisabled(), false);
        await page.locator('#analysis-frequency-source').selectOption('saved');
        await page.locator('#impulseAnalysisTab').click();
        await page.locator('#exportImpulseResponseWav').click();
        assert.deepEqual(await page.evaluate(() => window.exportedIR), { original: true, rate: 8000, length: 4096 });
        await page.locator('#distortionAnalysisTab').click();
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.maxOrder === 3);
        await page.locator('#analysis-distortion-unit').selectOption('dBr');
        const ratio = await page.evaluate(() => {
            const s = window.analysisFixture.ui.analysisController.currentPlotState.series.find(series => series.label === 'H2');
            return s.points.find(([, value]) => value !== null)?.[1];
        });
        assert.ok(Math.abs(ratio + 40) < 0.01);
        await page.locator('#analysis-distortion-maxOrder').selectOption('2');
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.maxOrder === 2);
        assert.equal(await page.locator('#analysis-distortion-h3').isChecked(), true);
        const ceiling = await page.evaluate(() => {
            const controller = window.analysisFixture.ui.analysisController;
            return { labels: controller.currentPlotState.series.map(series => series.label),
                thd: controller.analysisResult.thd.find(Number.isFinite) };
        });
        assert.deepEqual(ceiling.labels, ['THD (2–2)', 'H2', 'H3']);
        assert.ok(Math.abs(ceiling.thd - 0.01) < 1e-6);
        await page.locator('#analysis-distortion-maxOrder').selectOption('3');
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.maxOrder === 3);
        await page.evaluate(async () => {
            const fixture = window.analysisFixture;
            fixture.record.harmonicAnalysis.quality.valid = false;
            await fixture.i18n.setLanguage('ja');
            document.documentElement.setAttribute('data-theme', 'paper');
            await fixture.ui.analysisController.refresh();
        });
        assert.match(await page.locator('#distortionAnalysisStatus').textContent(), /歪率データ/);
        assert.equal(await page.locator('#distortionAnalysisGraph').isVisible(), false);
        if (screenshotDir) await page.locator('#measurementResults').screenshot({ path: path.join(screenshotDir, 'narrow-ja-missing-distortion.png') });
        await page.locator('#frequencyAnalysisTab').focus(); await page.keyboard.press('ArrowRight');
        assert.equal(await page.locator('#impulseAnalysisTab').getAttribute('aria-selected'), 'true');
        await page.locator('#impulseAnalysisPanel summary').click();
        if (screenshotDir) await page.locator('#measurementResults').screenshot({ path: path.join(screenshotDir, 'narrow-ja-paper-impulse-collapsed-focus.png') });
        await page.setViewportSize({ width: 1450, height: 1100 });
        await page.evaluate(async () => {
            document.documentElement.classList.remove('layout-mobile'); document.body.classList.remove('layout-mobile');
            await window.analysisFixture.i18n.setLanguage('fr');
            window.analysisFixture.ui.analysisController.selectTab('frequency');
        });
        await page.locator('#analysis-frequency-source').selectOption('ir');
        await page.waitForFunction(() => window.analysisFixture.ui.analysisController.analysisResult?.frequencyResponse.length > 0);
        if (screenshotDir) await page.locator('#measurementResults').screenshot({ path: path.join(screenshotDir, 'wide-fr-paper-frequency.png') });
        const regressions = await page.evaluate(async () => {
            const f = window.analysisFixture, c = f.ui.analysisController, display = f.ui.measurementDisplay;
            await f.i18n.setLanguage('en');
            c.selectTab('impulse'); await c.refresh();
            c.settings.impulse.xMin = -100; c.settings.impulse.xMax = 1000; c.draw();
            const plot = c.plots.impulse;
            const blankRead = plot.read(plot.scaleX(900), plot.plot.top + 20);
            const original = f.record.data;
            f.record.data = new Float32Array(80); f.record.data[16] = 1;
            c.loadedRecordKey = null; c.cache.clear();
            c.selectTab('waterfall'); await c.refresh();
            const initialLength = c.settings.waterfall.length;
            c.reset('waterfall'); await c.refresh();
            const shortReset = { initialLength, resetLength: c.settings.waterfall.length,
                slices: c.analysisResult?.slices.length, status: document.getElementById('waterfallAnalysisStatus').textContent };
            f.record.data = original; c.loadedRecordKey = null; c.cache.clear();
            f.measurement.outputChannels = ['left', 'right'];
            f.measurement.channelResponses = ['left', 'right'].map(channel => ({ channel, averageFrequencyResponse: f.measurement.averageFrequencyResponse }));
            f.measurement.points = [{ pointId: 1, name: 'Stereo point', channels: ['left', 'right'].map((channel, i) => ({
                channel, irId: i + 1, ir: { stored: true, sampleRate: 8000, length: 4096, onsetIndex: 16 },
                frequencyResponse: f.measurement.averageFrequencyResponse, maxSignalLevel: i === 0 ? -36 : -0.5
            })) }];
            c.selectTab('frequency');
            display.displayMeasurementDetails(f.measurement.id, true); await c.refresh();
            const handler = f.ui.correctionHandler;
            handler.calculatePEQParametersForResponse = async (_response, _settings, _measurement, channel) =>
                [{ frequency: 500, gain: -1, Q: 1, testChannel: channel }];
            handler.requestCorrectionUpdate(); c.selectTab('impulse');
            await new Promise(resolve => setTimeout(resolve, 100));
            display.selectChannel('right'); await c.refresh();
            const queued = { target: display.selectedChannel, calculated: f.measurement.peqParameters?.[0].testChannel,
                analysisChannel: c.target.channel };
            const loaded = { ...f.measurement, id: 'loaded-in-analysis', name: 'Loaded in analysis' };
            f.storage.measurements.push(loaded);
            await display.selectMeasurement(loaded.id);
            await new Promise(resolve => setTimeout(resolve, 100));
            const load = { target: display.selectedChannel, calculated: loaded.peqParameters?.[0].testChannel };
            c.selectTab('frequency'); await c.refresh();
            let finish;
            handler.calculatePEQParametersForResponse = (_response, _settings, _measurement, channel) =>
                new Promise(resolve => { finish = () => resolve([{ frequency: 500, gain: -1, Q: 1, testChannel: channel }]); });
            const pending = handler.calculatePEQParameters(handler.getTargetSettings());
            c.selectTab('impulse'); display.selectChannel('right');
            finish(); await pending;
            const inFlight = { target: display.selectedChannel, calculated: loaded.peqParameters?.[0].testChannel };
            handler.calculatePEQParametersForResponse = async () => [];
            c.selectTab('frequency'); display.selectPoint(0); await c.refresh();
            const warningsAll = document.getElementById('frequencyLevelWarning').textContent;
            const warningVisible = getComputedStyle(document.getElementById('frequencyLevelWarning')).visibility;
            display.selectChannel('left'); await c.refresh();
            const warningLow = document.getElementById('frequencyLevelWarning').textContent;
            loaded.points[0].channels[0].maxSignalLevel = -20; await c.refresh();
            const warningCleared = document.getElementById('frequencyLevelWarning').hidden;
            if (handler.updateCorrectionTimeout) { clearTimeout(handler.updateCorrectionTimeout); handler.updateCorrectionTimeout = null; }
            return { blankRead, shortReset, queued, load, inFlight, warningsAll, warningVisible, warningLow, warningCleared };
        });
        assert.equal(regressions.blankRead, null);
        assert.equal(regressions.shortReset.resetLength, regressions.shortReset.initialLength);
        assert.ok(regressions.shortReset.slices > 0);
        assert.equal(regressions.shortReset.status, '');
        assert.deepEqual(regressions.queued, { target: 'all', calculated: 'all', analysisChannel: 'right' });
        assert.deepEqual(regressions.load, { target: 'all', calculated: 'all' });
        assert.deepEqual(regressions.inFlight, { target: 'all', calculated: 'all' });
        assert.match(regressions.warningsAll, /too low on Ch 1/);
        assert.match(regressions.warningsAll, /too high on Ch 2/);
        assert.equal(regressions.warningVisible, 'visible');
        assert.match(regressions.warningLow, /too low to give accurate results/);
        assert.equal(regressions.warningCleared, true);
        if (screenshotDir) {
            await page.evaluate(async () => {
                const f = window.analysisFixture;
                f.storage.getMeasurementById(f.ui.selectedMeasurementId).points[0].channels[0].maxSignalLevel = -36;
                f.ui.measurementDisplay.selectChannel('all'); await f.ui.analysisController.refresh();
                clearTimeout(f.ui.correctionHandler.updateCorrectionTimeout);
                f.ui.correctionHandler.updateCorrectionTimeout = null;
                document.getElementById('loading-spinner-results').style.display = 'none';
            });
            await page.locator('#measurementResults').screenshot({ path: path.join(screenshotDir, 'round1-frequency-level-warnings.png') });
        }
        const keyboardReadout = await page.evaluate(async () => {
            const f = window.analysisFixture, controller = f.ui.analysisController, display = f.ui.measurementDisplay;
            f.storage.getImpulseResponse = async (_id, key) => ({ ...f.record, pointId: key,
                data: Float32Array.from({ length: 4096 }, () => key === 1 ? 0.1 : 0.7) });
            controller.selectTab('impulse'); display.selectChannel('left'); await controller.refresh();
            Object.assign(controller.settings.impulse, { normalize: false, xMin: -2, xMax: 30 });
            controller.draw();
            const plot = controller.plots.impulse;
            const output = document.getElementById('impulseAnalysisReadout');
            const press = key => plot.canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            plot.canvas.focus(); press('ArrowRight');
            const first = output.textContent;
            display.selectChannel('right'); await controller.refresh();
            const afterSwitch = output.textContent;
            press('ArrowRight');
            const second = output.textContent;
            controller.settings.impulse.xMax = 1000; controller.draw();
            const afterRange = output.textContent;
            press('Home');
            const observed = output.textContent;
            press('End');
            return { first, afterSwitch, second, afterRange, observed, blank: output.textContent,
                selected: controller.target.channel };
        });
        assert.match(keyboardReadout.first, /0\.1000/);
        assert.equal(keyboardReadout.afterSwitch, '');
        assert.match(keyboardReadout.second, /0\.7000/);
        assert.equal(keyboardReadout.afterRange, '');
        assert.match(keyboardReadout.observed, /0\.7000/);
        assert.equal(keyboardReadout.blank, '');
        assert.equal(keyboardReadout.selected, 'right');
        const copyRefresh = await page.evaluate(async () => {
            const f = window.analysisFixture, controller = f.ui.analysisController;
            const plot = controller.plots.impulse;
            const button = document.getElementById('impulseCopyGraph');
            const status = document.getElementById('impulseCopyGraphStatus');
            const images = [], captions = [];
            const renderImage = plot.renderImage.bind(plot);
            plot.renderImage = options => {
                captions.push({ title: options.title, subtitle: options.subtitle, sample: plot.state.record.data[16] });
                return renderImage(options);
            };
            let releaseCopy, enteredCopy;
            const copyEntered = new Promise(resolve => { enteredCopy = resolve; });
            const copyGate = new Promise(resolve => { releaseCopy = resolve; });
            window.electronAPI = { writeClipboardImage: async bytes => {
                images.push(bytes);
                if (images.length === 1) { enteredCopy(); await copyGate; }
                return true;
            } };
            const priorCopy = controller.copyImage('impulse');
            await copyEntered;
            const oldState = plot.state;
            const next = { ...f.storage.getMeasurementById(f.ui.selectedMeasurementId),
                id: 'copy-refresh-new', name: 'Bedroom NEW measurement' };
            f.storage.measurements.push(next);
            f.ui.selectedMeasurementId = next.id;
            let releaseRecord;
            f.storage.getImpulseResponse = () => new Promise(resolve => { releaseRecord = resolve; });
            const refreshing = controller.refresh();
            const disabledAtStart = button.disabled;
            controller.draw();
            const disabledAfterDraw = button.disabled;
            await controller.copyImage('impulse');
            const noPendingExport = captions.length === 1 && plot.state === oldState;
            releaseCopy(); await priorCopy;
            const priorCompletion = { disabled: button.disabled, status: status.textContent };
            const record = { ...f.record, data: Float32Array.from({ length: 4096 }, () => 0.3) };
            releaseRecord(record); await refreshing;
            const enabledAfterRefresh = !button.disabled;
            await controller.copyImage('impulse');
            const image = await createImageBitmap(new Blob([images[1]], { type: 'image/png' }));
            const final = { caption: captions[1], bytes: images[1].length, width: image.width,
                status: status.textContent, enabled: !button.disabled };
            image.close();
            f.storage.getImpulseResponse = async () => { throw new Error('Fixture record unavailable'); };
            await controller.refresh(); controller.draw(); await controller.copyImage('impulse');
            const failed = { disabled: button.disabled, cleared: plot.state === null, count: images.length };
            f.ui.selectedMeasurementId = 'missing-measurement';
            await controller.refresh(); controller.draw(); await controller.copyImage('impulse');
            const empty = { disabled: button.disabled, count: images.length };
            return { disabledAtStart, disabledAfterDraw, noPendingExport, priorCompletion, enabledAfterRefresh, final, failed, empty };
        });
        assert.equal(copyRefresh.disabledAtStart, true);
        assert.equal(copyRefresh.disabledAfterDraw, true);
        assert.equal(copyRefresh.noPendingExport, true);
        assert.deepEqual(copyRefresh.priorCompletion, { disabled: true, status: '' });
        assert.equal(copyRefresh.enabledAfterRefresh, true);
        assert.match(copyRefresh.final.caption.subtitle, /^Bedroom NEW measurement ·/);
        assert.equal(copyRefresh.final.caption.title, 'Impulse Response');
        assert.ok(Math.abs(copyRefresh.final.caption.sample - 0.3) < 1e-7);
        assert.ok(copyRefresh.final.bytes > 1000);
        assert.ok(copyRefresh.final.width >= 1600);
        assert.equal(copyRefresh.final.status, 'Graph image copied.');
        assert.equal(copyRefresh.final.enabled, true);
        assert.deepEqual(copyRefresh.failed, { disabled: true, cleared: true, count: 2 });
        assert.deepEqual(copyRefresh.empty, { disabled: true, count: 2 });
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
